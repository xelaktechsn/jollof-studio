// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Automate en réseau : le serveur Modbus TCP (src-tauri/src/modbus.rs) donne les variables de l'automate simulé à une
// IHM, un SCADA ou un autre automate. Ce module fait le plan des adresses (d'après la table des variables, comme sur un
// vrai automate), calcule l'image dix fois par seconde et l'envoie à Rust quand elle change ; un client qui écrit une
// bobine du pupitre appuie sur le bouton, comme la souris.
//
// Plan (le même que modbus.rs) : entrées TOR 0… = %I (8 par mot) ; bobines 0… = %Q (lecture), 100… = boutons du
// pupitre (lecture et écriture), 200… = mémoires %M ; registres d'entrée 0… = temps écoulé des temporisations %TM
// (dixièmes de seconde), 100… = compteurs %C, 200 = numéro du cycle, 201 = programme en erreur.
import * as native from '../native.js';

export const MB = { pupitre: 100, mem: 200, counters: 100, scan: 200, halted: 201, max: 1024 };
const bit = a => { const m = /^%[IQ](\d+)\.(\d)$/.exec(a || ''); return m ? +m[1] * 8 + +m[2] : null; };
const num = (a, pre) => { const m = new RegExp(`^%${pre}(\\d+)$`).exec(a || ''); return m ? +m[1] : null; };

/**
 * Plan des adresses : vars = table de l'automate ({ name, cls, addr }), inputs = boutons du pupitre. Rend { di, coils,
 * ir, skipped } ; chaque entrée : { addr, name, cls, rw }. skipped : variables sans place (trop nombreuses).
 */
export function modbusMap(vars, inputs) {
  const di = [], coils = [], ir = [], skipped = [];
  const put = (list, addr, v, limit, extra = {}) => { if (addr === null || addr >= limit) { skipped.push(v.name); return; } list.push({ addr, name: v.name, cls: v.cls, rw: false, ...extra }); };
  for (const v of vars || []) {
    if (v.cls === 'in') put(di, bit(v.addr), v, MB.max);
    else if (v.cls === 'out') put(coils, bit(v.addr), v, MB.pupitre);
    else if (v.cls === 'mem') { const n = num(v.addr, 'M'); put(coils, n === null ? null : MB.mem + n, v, MB.max); }
    else if (v.cls === 'timer') put(ir, num(v.addr, 'TM'), v, MB.counters, { unit: 0.1 });
    else if (v.cls === 'counter') { const n = num(v.addr, 'C'); put(ir, n === null ? null : MB.counters + n, v, MB.scan); }
  }
  (inputs || []).slice(0, MB.mem - MB.pupitre).forEach((x, i) => coils.push({ addr: MB.pupitre + i, name: x.name, cls: 'pupitre', rw: true }));
  ir.push({ addr: MB.scan, name: 'cycle', cls: 'sys', rw: false }, { addr: MB.halted, name: 'erreur', cls: 'sys', rw: false });
  const by = (a, b) => a.addr - b.addr;
  return { di: di.sort(by), coils: coils.sort(by), ir: ir.sort(by), skipped };
}

/**
 * Image envoyée à Rust : tables pleines jusqu'à la dernière adresse utilisée. s : { live (état de la simulation ou
 * null), pressed(nom) }.
 */
export function modbusImage(map, s) {
  const Lv = s.live, run = Lv && Lv.run, len = list => (list.length ? list[list.length - 1].addr + 1 : 0);
  const di = new Array(len(map.di)).fill(false), coils = new Array(len(map.coils)).fill(false), writable = new Array(coils.length).fill(false), ir = new Array(len(map.ir)).fill(0);
  const read = n => !!(Lv && Lv.read(String(n).toLowerCase()));
  for (const e of map.di) di[e.addr] = read(e.name);
  for (const e of map.coils) { if (e.rw) { writable[e.addr] = true; coils[e.addr] = !!s.pressed(e.name); } else coils[e.addr] = read(e.name); }
  const w = v => Math.max(0, Math.min(65535, Math.round(v || 0)));
  for (const e of map.ir) {
    const l = e.name.toLowerCase();
    if (e.cls === 'timer') ir[e.addr] = run ? w(((run.timers.get(l) || {}).et || 0) * 10) : 0;
    else if (e.cls === 'counter') ir[e.addr] = run ? w((run.counters.get(l) || {}).cv) : 0;
    else if (e.addr === MB.scan) ir[e.addr] = run ? run.scan & 0xffff : 0;
    else if (e.addr === MB.halted) ir[e.addr] = run && run.halted ? 1 : 0;
  }
  return { di, coils, writable, ir };
}

/**
 * Lien avec le serveur : snapshot() → { vars, inputs, live, pressed }, press(nom, appuyé) (un client écrit un bouton),
 * changed() (état du serveur changé). Rend { start(port, lan), stop(), state(), map() }.
 */
export function createModbusLink({ snapshot, press, changed }) {
  let info = null, timer = null, last = '', map = null, err = '';
  function push() {
    const s = snapshot(); map = modbusMap(s.vars, s.inputs);
    const img = modbusImage(map, s), k = JSON.stringify(img);
    if (k === last) return; last = k;
    native.modbusImage(img).catch(e => { err = String(e && e.message || e); });
  }
  const onWrite = ({ addr, value }) => { const c = map && map.coils.find(x => x.addr === addr && x.rw); if (c) press(c.name, !!value); };
  return {
    async start(port, lan) {
      err = ''; last = '';
      try { info = await native.modbusStart(port, lan, onWrite); } catch (e) { info = null; err = String(e && e.message || e); changed(); throw e; }
      clearInterval(timer); timer = setInterval(push, 100); push(); changed();
      return info;
    },
    async stop() { clearInterval(timer); timer = null; info = null; last = ''; try { await native.modbusStop(); } finally { changed(); } },
    state: () => ({ on: !!info, info, error: err }),
    map: () => { if (!map) { const s = snapshot(); map = modbusMap(s.vars, s.inputs); } return map; },
    refresh() { map = null; }
  };
}
