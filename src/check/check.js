// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérificateur de montage et de programme, sur le modèle de rustc : il ne laisse rien partir vers le monde réel
// (carte branchée, guide de montage, devoir rendu) tant qu'une erreur reste, et il le prouve dans TOUS les états
// atteignables du montage (boutons, relais, potentiomètres, capteurs, broches commandées par le programme).
// Trois passes : structure du câblage (circuit.js, faults.js), programme ↔ montage (program.js), puis calcul du
// circuit dans chaque état (dc.js) contre les valeurs nominales (limits.js). Chaque diagnostic garde un code stable
// (codes.js), sa place, l'état qui le déclenche (contre-exemple), une note et une aide.
// Pur : se teste sous Node (node --test src/check/check.test.mjs).
import { analyze, inspect, pid } from '../sim/circuit.js';
import { collectFaults } from '../sim/faults.js';
import { solveDC } from '../sim/dc.js';
import { boardOf, kindOf, base, SOURCES, DERIVED } from '../sim/boards.js';
import { partOf, MOTORS, NPNS, COILS, acsRange } from '../sim/parts.js';
import { driveOf } from '../sim/drive.js';
import { compile } from '../prog/lang.js';
import { BOARD_CONSTS, isEsp32 } from '../prog/api.js';
import { pinMap } from '../prog/runtime.js';
import { tl } from '../i18n/index.js';
import { CODES, BY_KEY } from './codes.js';
import { EXPLAIN } from './explain.js';
import { pinFacts, pinRole } from './program.js';
import { pyPinFacts } from './pyfacts.js';
import { stateVars, assignments, stateText, sensorOutputs, MAX_STATES } from './states.js';
import * as LIM from './limits.js';
import { OPAMPS, MOSFETS } from '../sim/analog-parts.js';
import { CHIPS } from '../sim/chips.js';
import { ilimOf, stepperLink } from '../sim/motordrv.js';
import { isMax, maxHead, maxChain } from '../sim/displays.js';
import { isResistor, pkgLed, pkgLimit, pkgI2c } from '../sim/pkgparts.js';
import { i2cAddress } from '../sim/pkgbus.js';
import { SENSOR_I2C, sensorAddr } from '../sim/i2csensors.js';
import { ratingOf, valueOf } from '../sim/passives.js';
import { RATINGS, vioMax, vihOf } from './ratings.js';

/** Famille de carte pour le compilateur (même règle que prog/panel.js). */
export const boardKind = kindOf;
const BUS = new Set(['sda', 'scl', 'sck', 'mosi', 'miso', 'ss', 'rx', 'tx']);
// Broches qu'un module pilote lui-même (sortie d'un capteur, écho d'un sonar…) : un nœud qui en contient une n'est jamais en l'air.
const DRIVEN = new Set(['in', 'adc', 'irq', 'io', 'tx', 'miso', 'sda']);
// Un contrôle fait dans tous les états qui redit une erreur de câblage déjà signalée : on garde la première, plus claire.
const COVERED = { J0103: ['J0101', 'J0102', 'J0110'], J0306: ['J0106'], J0302: ['J0201', 'J0202', 'J0501'], J0301: ['J0401'], J0332: ['J0207', 'J0208', 'J0104'], J0303: ['J0207'], J0213: ['J0207', 'J0208'] };
// Niveaux logiques : une entrée qui reçoit plus que sa tension est abîmée (erreur) ; un niveau haut trop faible
// (pont diviseur trop bas, f.low) ne fait que mal lire (avertissement).
const LEVEL_DAMAGE = new Set(['J0207', 'J0208']);
// Signaux d'un module que la carte pilote (sens carte → module), hors I2C (lignes à drain ouvert, vues par le bus).
const TO_MODULE = new Set(['out', 'pwm', 'io', 'sck', 'mosi', 'ss', 'rx']);
/** Le programme se sert-il du Wi-Fi (l'ADC2 de l'ESP32 est alors pris par la radio) ? */
const usesWifi = code => /#include\s*<(?:WiFi|esp_now|WiFiClientSecure|WebServer|HTTPClient)\.h>|\bWiFi\.(?:begin|softAP|mode)\s*\(/.test(code || '');
/** Horloge I2C demandée par le programme : Wire.setClock(…) (100 kHz par défaut), et sa ligne. */
function i2cClock(code) {
  const lines = String(code || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /\bWire\.setClock\s*\(\s*(\d+(?:\.\d+)?(?:[eE]\d+)?)\s*[uUlL]*\s*\)/.exec(lines[i]);
    if (m) return { hz: Number(m[1]), line: i + 1, col: m.index + 1 };
  }
  return { hz: 100000, line: null };
}
const isLed = c => /^led-(red|green|blue|yellow|white)$/.test(c.type);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * proj : { comps, wires, programs: Map id de carte → texte du programme, auto: Set des cartes dont le programme vient
 *         des règles (optionnel), firmware: Set des cartes en mode fidèle (optionnel), allow: [{ code, comp, reason }] }.
 * opts : { dist(a, b) (suggestions de câblage), max (états au plus) }.
 * Rend { diags: [...], errors, warnings, accepted, states, total, proven, dynamic, ms }.
 */
export function checkProject(proj, opts = {}) {
  const it = run(proj, opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
/** Même vérification, découpée en tranches (l'interface ne se fige jamais) ; signal.aborted l'interrompt. */
export async function checkProjectAsync(proj, opts = {}, signal = {}) {
  const it = run(proj, opts);
  let r = it.next(), t = now();
  while (!r.done) {
    if (signal.aborted) return null;
    if (now() - t > (opts.slice || 12)) { await new Promise(res => setTimeout(res, 0)); t = now(); if (signal.aborted) return null; }
    r = it.next();
  }
  return r.value;
}

function* run(proj, opts) {
  const t0 = now(), comps = proj.comps.filter(c => c && c.pins), wires = proj.wires || [];
  const A = analyze(comps, wires, { open: true }), out = new Map();
  // Reliée à un autre composant (les liaisons internes d'une carte, A4 = SDA, ne comptent pas).
  const wired = r => A.members(r).some(m => m.comp !== r.comp);
  const name = r => `${r.comp.name} ${r.key}`;
  const boards = comps.filter(c => boardOf(c));
  const boardFor = c => { for (const k in c.pins) { const g = A.wnet({ comp: c, key: k }).gpio[0]; if (g) return g.comp; } return boards[0] || null; };
  /** Ajoute (ou complète) un diagnostic ; même code au même endroit : un seul, le pire niveau, le premier contre-exemple. */
  const put = (code, level, loc, m, extra = {}, w = 1) => {
    if (COVERED[code] && loc.comp) {
      for (const d of out.values()) if (d.structural && d.level === 'error' && COVERED[code].includes(d.code) && (d.loc.comp === loc.comp || (d.loc.pins || []).some(p => p.comp === loc.comp))) return null;
    }
    const key = `${code}|${loc.comp ? loc.comp.id : ''}|${loc.key || ''}|${loc.board ? loc.board.id : ''}|${loc.line || ''}`;
    const old = out.get(key);
    if (old) {
      old.states += w;
      if (level === 'error' && old.level !== 'error') { if (m) m.soft = false; Object.assign(old, { level, m, ...extra }); old.title = titleOf(code, m, extra.title); old.state = null; }
      if (m && m.value != null && old.m && Math.abs(m.value) > Math.abs(old.m.value)) old.m.value = m.value;
      return old;
    }
    if (m && m.limit != null && level === 'warning') m.soft = true; // limite conseillée, pas maximale
    const d = { key, code, level, loc, m: m || {}, states: w, ...extra };
    d.title = titleOf(code, m, extra.title);
    out.set(key, d);
    return d;
  };

  /* ---------- 1. Structure du câblage : les règles de circuit.js et faults.js, avec leur numéro ---------- */
  const faults = collectFaults(comps, wires, A, { dist: opts.dist || (() => 0), boardFor });
  for (const f of faults) {
    const code = BY_KEY[f.code]; if (!code) continue;
    const level = (f.level === 'err' || (LEVEL_DAMAGE.has(code) && !f.low)) && !f.missing ? 'error' : 'warning';
    put(code, level, { comp: f.comp || (f.pins[0] && f.pins[0].comp), key: f.pins[0] && f.pins[0].key, pins: [...f.pins, ...(f.culprits || [])] }, null,
      { title: f.title, where: f.where, note: f.why, help: f.fix, fault: f, structural: true });
  }

  // Broches lues au démarrage (boards.js strap) tirées au mauvais niveau : une résistance vers l'alimentation ou la masse,
  // ou un module dont la sortie est tirée au niveau haut au repos (I2C, DHT, récepteur IR…).
  const idleHigh = m => { const sp = partOf(m.comp), q = sp && sp.pins && sp.pins.find(x => x.pin === m.key); return !!(q && q.kind === 'io' && (q.idle === 1 || q.need === 'sda' || q.need === 'scl')); };
  for (const b of boards) {
    const prof = boardOf(b);
    for (const [k, want] of Object.entries(prof.strap || {})) {
      if (!b.pins[k] || !wired({ comp: b, key: k })) continue;
      const r = { comp: b, key: k }, w = A.wnet(r), high = w.src.length > 0 || A.wmembers(r).some(m => m.comp !== b && idleHigh(m)), low = w.gnd.length > 0;
      if (want === 0 && high && (LIM.FLASH_STRAP[b.type] || []).includes(k)) put('J0613', 'error', { comp: b, key: k, pins: [r] }, { name: name(r) });
      else if ((want === 0 && high) || (want === 1 && low && !high)) put('J0903', 'warning', { comp: b, key: k, pins: [r] }, { name: name(r), high: want === 0 });
    }
  }
  // Modules I2C d'une même carte à la même adresse.
  const ADDR = { oled: () => 0x3c, lcd1602: () => 0x27, mpu6050: c => (c.pins.AD0 && A.net({ comp: c, key: 'AD0' }).src.length ? 0x69 : 0x68),
    bmp280: c => (A.net({ comp: c, key: 'SDO' }).gnd.length ? 0x76 : A.net({ comp: c, key: 'SDO' }).src.length ? 0x77 : null),
    bme280: c => (A.net({ comp: c, key: 'SDO' }).gnd.length ? 0x76 : A.net({ comp: c, key: 'SDO' }).src.length ? 0x77 : null),
    bh1750: c => (A.net({ comp: c, key: 'ADDR' }).src.length ? 0x5c : 0x23),
    lcd2004: c => { const a = c.inp ? Math.trunc(+c.inp.addr) : 0; return a > 0 && a < 128 ? a : 0x27; }, ds3231: () => 0x68, ds1307: () => 0x68,
    at24c256: c => 0x50 | ['A0', 'A1', 'A2'].reduce((v, k, i) => v | (c.pins[k] && A.net({ comp: c, key: k }).src.length ? 1 << i : 0), 0),
    // Capteurs I2C (sim/i2csensors.js) : VL53L0X et TCS34725 tous deux à 0x29, MAX30102 0x57, CCS811 0x5A/0x5B, BME680 0x77/0x76.
    ...Object.fromEntries(SENSOR_I2C.map(t => [t, c => sensorAddr(c, A)[0]])) };
  const onBus = new Map();
  for (const c of comps) {
    // Module I2C en paquet : son adresse déclarée (l'autre si sa broche d'adresse reçoit l'alimentation).
    const I = pkgI2c(c.type);
    const f = ADDR[c.type] || (I && (cc => i2cAddress(I, !!I.addressPin && A.net({ comp: cc, key: I.addressPin }).src.length > 0))), spec = f && partOf(c); if (!spec) continue;
    const sda = (spec.pins || []).find(p => p.need === 'sda'), ins = inspect(c, A, spec), addr = f(c);
    if (!ins.board || !sda || !ins.io[sda.pin] || addr == null) continue;
    const key = `${ins.board.id}|${addr}`, first = onBus.get(key);
    if (first) put('J0610', 'error', { comp: c, key: 'SDA', pins: [{ comp: c, key: 'SDA' }, { comp: first, key: 'SDA' }] }, { a: first.name, b: c.name, addr: addr.toString(16).toUpperCase() });
    else onBus.set(key, c);
  }

  /* ---------- 2. Programmes : compilation (codes J1xxx), broches utilisées ---------- */
  const facts = new Map();
  for (const b of boards) {
    const code = proj.programs && proj.programs.get(b.id);
    if (!code || !code.trim()) continue;
    const kind = boardKind(b), prof = boardOf(b), firmware = !!(proj.firmware && proj.firmware.has(b.id));
    // Mode fidèle : le vrai C++ est jugé par arduino-cli, pas par l'interpréteur ; ses erreurs ne comptent pas ici.
    if (!firmware) {
      const res = compile(code, { board: kind });
      for (const e of res.errors) put(e.code || 'J1199', 'error', { board: b, line: e.line, col: e.col, len: e.len || 1 }, null, { title: e.msg, help: e.help || null, code: e.code || 'J1199' });
      for (const w of res.warnings || []) put(w.code || 'J1109', 'warning', { board: b, line: w.line, col: w.col, len: w.len || 1 }, null, { title: w.msg });
    }
    let f = pinFacts(code, kind, prof);
    // Programme que l'analyse ne sait pas lire (C++ complet du mode fidèle) : preuve prudente, toute broche reliée
    // peut être une sortie à LOW ou à HIGH.
    // MicroPython : ses broches lues dans le texte Python quand elles sont écrites en clair (pyfacts.js).
    if (!f.ok && firmware) f = pyPinFacts(code, prof) || { ok: true, pins: new Map(), dynamic: true, uses: [] };
    if (!f.ok) continue;
    facts.set(b, f);
    // Broche inexistante sur la carte, PWM ou ADC absents, digitalWrite sans pinMode.
    for (const u of f.uses) {
      if (u.key !== null || u.dyn) continue;
      // ESP32 : GPIO 6 à 11 tiennent la mémoire flash du programme (la carte ne les sort pas).
      if (kind === 'esp32' && LIM.ESP32_PINS.flash.includes(Number(u.value))) put('J0612', 'error', { board: b, line: u.line, col: u.col, len: 1 }, { name: String(u.value) });
      else put('J0609', 'error', { board: b, line: u.line, col: u.col, len: 1 }, { name: String(u.value), b: b.name });
    }
    const wifi = kind === 'esp32' && usesWifi(code);
    const led = pinMap(prof, kind).get((BOARD_CONSTS[kind] || {}).LED_BUILTIN); // LED de la carte : la commander seule est normal
    for (const [k, pf] of f.pins) {
      const g = prof.gpio[k], loc = { comp: b, key: k, board: b, line: pf.at[0].line, col: pf.at[0].col };
      if (!g) continue;
      if (pf.writes.has('pwm') && !g.caps.has('pwm') && !isEsp32(kind)) put('J0603', 'error', loc, { name: name({ comp: b, key: k }) });
      // Broche sans sortie (ESP32 GPIO 34 à 39, A6 et A7 du Nano) mise en sortie ou écrite.
      if (!g.caps.has('out') && (pf.modes.has('out') || pf.writes.size)) put('J0611', 'error', loc, { name: name({ comp: b, key: k }) });
      // ADC2 de l'ESP32 pendant le Wi-Fi : la radio la prend (J0614) ; sans Wi-Fi, la capacité de la broche décide (J0604).
      const adc2 = wifi && pf.reads.has('a') && LIM.ESP32_PINS.adc2.includes(g.n);
      if (adc2) put('J0614', 'error', loc, { name: name({ comp: b, key: k }) });
      else if (pf.reads.has('a') && !g.caps.has('adc')) put('J0604', 'error', loc, { name: name({ comp: b, key: k }) });
      if (pf.writes.has('d') && !pf.modes.has('out') && !pf.writes.has('pwm') && !pf.writes.has('servo') && !pf.writes.has('tone')) put('J0607', 'warning', loc, { name: name({ comp: b, key: k }) });
      if (pinRole(pf) === 'out' && !wired({ comp: b, key: k }) && k !== led) put('J0605', 'warning', loc, { name: name({ comp: b, key: k }) });
    }
  }
  // Deux sorties sur le même nœud (comme deux emprunts mutables), ou une sortie contre celle d'un capteur.
  const outsByNet = new Map();
  for (const [b, f] of facts) for (const [k, pf] of f.pins) {
    if (pinRole(pf) !== 'out') continue;
    const r = { comp: b, key: k }, m = A.members(r);
    if (!outsByNet.has(m)) outsByNet.set(m, []);
    outsByNet.get(m).push(r);
    const sensor = m.find(x => x.comp !== b && sensorOutputs(x.comp) && sensorOutputs(x.comp)[x.key]);
    if (sensor) put('J0608', 'error', { comp: b, key: k, pins: [r, sensor] }, { name: name(r), b: name(sensor) });
  }
  for (const list of outsByNet.values()) if (list.length > 1) put('J0601', 'error', { comp: list[0].comp, key: list[0].key, pins: list }, { a: name(list[0]), b: name(list[1]) });
  // Composant relié à la carte mais jamais commandé ni lu (programme lisible seulement).
  for (const c of comps) {
    if (boardOf(c) || /^breadboard/.test(c.type) || isResistor(c.type)) continue;
    const spec = partOf(c); if (!spec || !spec.pins) continue;
    const ins = inspect(c, A, spec);
    for (const [k, g] of Object.entries(ins.io)) {
      const sp = spec.pins.find(p => p.pin === k), f = facts.get(g.comp);
      // Programme produit par les règles : un composant sans règle n'est pas une faute de l'élève.
      if (!f || f.dynamic || (sp && BUS.has(sp.need)) || f.pins.has(g.key) || (proj.auto && proj.auto.has(g.comp.id))) continue;
      put('J0606', 'warning', { comp: c, key: k, pins: [{ comp: c, key: k }] }, { name: c.name });
    }
  }
  // Bus I2C (UM10204), une ligne SDA à la fois : courant que doit absorber un appareil pour la tirer à 0,4 V (somme des
  // tirages connus : modules dont la carte est chiffrée, résistances vers une alimentation, voies d'un adaptateur de
  // niveau), temps de montée de la ligne, horloge demandée par Wire.setClock() contre l'appareil le plus lent.
  const segs = new Map();
  for (const c of comps) {
    const spec = partOf(c), sda = spec && spec.pins && spec.pins.find(p => p.need === 'sda');
    if (!sda || !c.pins[sda.pin] || !wired({ comp: c, key: sda.pin })) continue;
    const mem = A.members({ comp: c, key: sda.pin });
    if (!segs.has(mem)) segs.set(mem, []);
    segs.get(mem).push({ c, key: sda.pin });
  }
  const supplyV = (c, k) => { const s = A.net({ comp: c, key: k }).src; return s.length ? Math.max(...s.map(x => x.v)) : null; };
  for (const [mem, devs] of segs) {
    const gp = A.wnet({ comp: devs[0].c, key: devs[0].key }).gpio[0], board = gp ? gp.comp : null;
    const pulls = []; let unknown = false;
    for (const { c } of devs) {
      const r = RATINGS[c.type];
      if (!r || r.i2c == null) { unknown = true; continue; }
      const pw = (partOf(c).pins || []).find(p => p.kind === 'pwr'), v = pw && supplyV(c, pw.pin);
      if (r.i2c > 0 && v) pulls.push({ r: r.i2c, v, who: c.name });
    }
    for (const m of mem) {
      if (m.comp.type === 'lvlshift' && /^[LH]V\d$/.test(m.key)) { const v = supplyV(m.comp, m.key.slice(0, 2)); if (v) pulls.push({ r: 10000, v, who: m.comp.name }); }
      if (!isResistor(m.comp.type)) continue;
      const other = Object.keys(m.comp.pins).find(k => k !== m.key), v = other && supplyV(m.comp, other);
      if (v) pulls.push({ r: valueOf(m.comp), v, who: m.comp.name }); // résistance de tirage vers une alimentation
    }
    const first = devs[0], loc = { comp: first.c, key: first.key, pins: devs.map(d => ({ comp: d.c, key: d.key })) };
    const bname = board ? board.name : first.c.name;
    const sink = pulls.reduce((s, p) => s + Math.max(0, p.v - LIM.I2C.vol) / p.r * 1000, 0);
    if (sink > LIM.I2C.iol + 1e-9) put('J0214', 'warning', loc, { name: bname, value: sink, limit: LIM.I2C.iol, n: pulls.length });
    const code = board && proj.programs ? proj.programs.get(board.id) : null, clk = i2cClock(code);
    const fscl = clk.hz <= 100000 ? 100000 : clk.hz <= 400000 ? 400000 : 1000000;
    if (!unknown && pulls.length) {
      const rp = 1 / pulls.reduce((s, p) => s + 1 / p.r, 0), cb = LIM.I2C.ci * (devs.length + (board ? 1 : 0)) + LIM.I2C_WIRING_PF;
      const rmax = LIM.I2C.tr[fscl] * 1e-9 / (0.8473 * cb * 1e-12);
      if (rp > rmax) put('J0215', 'warning', loc, { name: bname, value: rp, limit: rmax, f: fscl });
    }
    // Horloge : l'appareil le plus lent du bus fixe la limite (PCF8574 des écrans LCD : 100 kHz).
    if (board && clk.line) {
      const slow = devs.map(d => ({ c: d.c, f: (RATINGS[d.c.type] || {}).fmax })).filter(d => d.f).sort((a, b) => a.f - b.f)[0];
      if (slow && clk.hz > slow.f) put('J0615', 'error', { board, line: clk.line, col: clk.col, len: 1, comp: board, pins: [{ comp: slow.c, key: 'SDA' }] }, { value: clk.hz, b: slow.c.name, limit: slow.f });
    }
  }
  // Grille d'un MOSFET commandée par la carte sans résistance de rappel : au démarrage (broche en haute impédance), elle
  // flotte et le MOSFET conduit à moitié. Rappel : vers la masse (canal N) ou vers la source (canal P).
  for (const c of comps) {
    const M = MOSFETS[c.type]; if (!M || !c.pins.G || !c.pins.S) continue;
    const g = A.wnet({ comp: c, key: 'G' }); if (!g.gpio.length) continue;
    const sNet = A.members({ comp: c, key: 'S' }), seen = new Set(), stack = [A.members({ comp: c, key: 'G' })];
    let pull = false;
    while (stack.length && !pull) {
      const mem = stack.pop(); if (seen.has(mem)) continue; seen.add(mem);
      for (const m of mem) {
        if (!isResistor(m.comp.type)) continue;
        const other = Object.keys(m.comp.pins).find(k => k !== m.key), om = other && A.members({ comp: m.comp, key: other });
        if (!om) continue;
        const n = A.net({ comp: m.comp, key: other });
        if (om === sNet || (!M.pch && n.gnd.length && !n.gpio.length)) pull = true;
        else if (n.gpio.length && !seen.has(om)) stack.push(om); // résistance série : le rappel peut être côté carte
      }
    }
    if (!pull) put('J0906', 'warning', { comp: c, key: 'G', pins: [{ comp: c, key: 'G' }] }, { name: c.name });
  }
  // LM7805 : condensateurs de la fiche (0,33 µF à l'entrée, 0,1 µF à la sortie), vers la masse.
  for (const c of comps) {
    if (c.type !== 'lm7805' || !c.pins.IN || !c.pins.OUT || !wired({ comp: c, key: 'IN' })) continue;
    const capOn = k => A.members({ comp: c, key: k }).some(m => LIM.CAP_V[m.comp.type] && (() => { const o = Object.keys(m.comp.pins).find(x => x !== m.key); return o && A.net({ comp: m.comp, key: o }).gnd.length > 0; })());
    for (const [k, which] of [['IN', 'in'], ['OUT', 'out']]) if (wired({ comp: c, key: k }) && !capOn(k)) put('J0909', 'warning', { comp: c, key: k, pins: [{ comp: c, key: k }] }, { name: c.name, which });
  }
  // Servo alimenté par la broche 5V d'une carte : TowerPro annonce 0,5 à 2 A pour un SG90, au-delà de ce que donne l'USB.
  for (const c of comps) {
    if (c.type !== 'servo' || !c.pins.VCC) continue;
    const s = A.net({ comp: c, key: 'VCC' }).src.find(x => boardOf(x.comp));
    if (!s) continue;
    const L = LIM.boardLimits(s.comp); if (!L) continue;
    if (RATINGS.servo.i >= L.five) put('J0910', 'warning', { comp: c, key: 'VCC', pins: [{ comp: c, key: 'VCC' }] }, { name: c.name, value: RATINGS.servo.i, limit: L.five, b: s.comp.name });
  }
  // Moteur commandé par un transistor sans diode de roue libre (la bobine renvoie une pointe de tension).
  for (const c of comps) {
    const ind = MOTORS[c.type] || COILS[c.type]; // moteur ou bobine d'électrovanne : une inductance
    if (!ind || c.type === 'fan') continue;
    const d = driveOf(c, A); if (!d || d.kind !== 'npn') continue;
    const [p, m] = [ind.plus, ind.minus], np = A.members({ comp: c, key: p }), nm = A.members({ comp: c, key: m });
    const diode = comps.some(x => x.type === 'diode' && ((np.some(y => y.comp === x && y.key === 'K') && nm.some(y => y.comp === x && y.key === 'A'))));
    if (!diode) put('J0901', 'warning', { comp: c, key: m, pins: [{ comp: c, key: m }] }, { name: c.name });
  }
  // Pilotes pas à pas : courant réglé au potentiomètre (c.inp.ilim) contre la puce, puis contre le moteur ; bobines du
  // moteur sur les bonnes sorties.
  for (const c of comps) {
    const L = LIM.STEP_DRV[c.type];
    if (L) {
      const i = ilimOf(c), loc = { comp: c, key: 'VMOT', pins: [{ comp: c, key: 'VMOT' }] };
      if (i > L.max) put('J0328', 'error', loc, { name: c.name, value: i, limit: L.max });
      else if (i > L.warn) put('J0328', 'warning', loc, { name: c.name, value: i, limit: L.warn });
    }
    const S = LIM.STEPPER_I[c.type], k = S && stepperLink(c, A);
    if (!k) continue;
    const loc = { comp: c, key: 'A+', pins: [{ comp: c, key: 'A+' }, { comp: k.drv, key: 'VMOT' }] };
    if (!k.ok) { if (k.why === 'pair') put('J0503', 'error', loc, { name: c.name, b: k.drv.name }); continue; }
    const i = ilimOf(k.drv);
    if (i > S.max) put('J0329', 'error', loc, { name: c.name, value: i, limit: S.max });
    else if (i > S.warn) put('J0329', 'warning', loc, { name: c.name, value: i, limit: S.warn });
  }
  // Chaîne de MAX7219 alimentée par la broche 5V de la carte : 330 mA par module à pleine intensité, toutes LED allumées.
  const linked = (x, k) => (x.pins[k] ? A.members({ comp: x, key: k }).filter(m => m.comp !== x) : []);
  for (const c of comps) {
    if (!isMax(c.type) || maxHead(c, linked) !== c) continue;
    const chain = maxChain(c, linked), ins = inspect(c, A, partOf(c)), b = ins.board && LIM.boardLimits(ins.board);
    if (!b || !c.pins.VCC || !A.net({ comp: c, key: 'VCC' }).src.some(s => s.comp === ins.board)) continue;
    const i = chain.length * LIM.MAX7219_I.total;
    if (i > b.five) put('J0330', 'warning', { comp: c, key: 'VCC', pins: [{ comp: c, key: 'VCC' }] }, { name: c.name, n: chain.length, value: i, limit: b.five });
  }
  yield;

  /* ---------- 3. Tous les états atteignables : calcul du circuit et valeurs nominales ---------- */
  const supplyOf = c => { const k = ['VCC', '+5V', '3', 'VDD'].find(x => c.pins[x]); const s = k ? A.net({ comp: c, key: k }).src : []; return s.length ? Math.max(...s.map(x => x.v)) : 5; };
  const { vars, fixed } = stateVars(comps, facts, wired, supplyOf);
  const touched = ['pressed', 'sw', 'pos'];
  const saveComps = comps.map(c => ({ c, inp: { ...(c.inp || {}) }, relayOn: c.relayOn, servoBusy: c.servoBusy, stepBusy: c.stepBusy }));
  const restore = () => { for (const s of saveComps) { if (s.c.inp) for (const k of touched) if (k in s.inp) s.c.inp[k] = s.inp[k]; else if (s.c.inp) delete s.c.inp[k]; s.c.relayOn = s.relayOn; s.c.servoBusy = s.servoBusy; s.c.stepBusy = s.stepBusy; } };
  const { probes, budgets } = probeList(comps, A, facts, proj);
  // Sous-montages indépendants (regionsOf) : chacun est essayé dans toutes ses combinaisons, les autres au repos. Le
  // nombre de calculs est la somme des combinaisons de chaque sous-montage, et non leur produit ; la preuve couvre
  // pourtant le produit, puisqu'un sous-montage ne voit pas l'état des autres. opts.monolithic : tout d'un bloc.
  const G = opts.monolithic ? null : regionsOf(comps, A);
  const regOfComp = c => (G ? G.comp(c) : 'all'), regOfPin = (c, k) => (G ? G.pin(c, k) : 'all');
  const varReg = vars.map(v => (v.pin ? regOfPin(v.comp, v.key) : regOfComp(v.comp)));
  const groups = new Map();
  varReg.forEach((r, i) => { if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  const spaceOf = new Map([...groups].map(([r, idx]) => [r, idx.reduce((t, i) => t * vars[i].values.length, 1)]));
  const space = vars.reduce((t, v) => t * v.values.length, 1);
  // Poids d'un constat : nombre d'états du montage complet où il se produit (son sous-montage dans cet état, les autres quelconques).
  const weightOf = r => (r != null && spaceOf.has(r) ? space / spaceOf.get(r) : space);
  for (const p of probes) p.region = p.pin ? regOfPin(p.comp, p.pin) : regOfComp(p.comp);
  for (const b of budgets) for (const x of b.parts) x.region = x.pin ? regOfPin(b.comp, x.pin) : regOfComp(x.comp);
  const ctx = cx => ({ prof: boardOf, pinState: (c, k) => { const m = cx.pins.get(c); return (m && m.get(k)) || null; }, sensorVolts: (c, k) => (cx.sensors.has(`${c.id}|${k}`) ? cx.sensors.get(`${c.id}|${k}`) : null) });
  const solve = a => {
    const cx = { pins: new Map(), sensors: new Map() };
    let dc;
    try {
      fixed.forEach(f => f(cx));
      vars.forEach((v, i) => v.apply(v.values[a[i]], cx));
      dc = solveDC(comps, A, ctx(cx));
    } finally { restore(); }
    return dc && dc.ok ? dc : null;
  };
  // Budgets partagés (toutes les GPIO, broches 5V et 3V3) : la pire contribution de chaque sous-montage, et l'état qui la donne.
  const worst = budgets.map(() => new Map());
  const measure = (dc, a, only) => budgets.forEach((b, bi) => {
    const sum = new Map();
    for (const x of b.parts) if (only == null || x.region === only) sum.set(x.region, (sum.get(x.region) || 0) + x.read(dc));
    for (const [r, v] of sum) { const cur = worst[bi].get(r); if (!cur || Math.max(0, v) > cur.v) worst[bi].set(r, { v: Math.max(0, v), a }); }
  });
  const run1 = (a, only) => {
    const dc = solve(a); if (!dc) return;
    let st = null;
    const text = () => (st == null ? (st = stateText(vars, a)) : st);
    for (const p of probes) {
      if (only != null && p.region !== only) continue;
      const w = weightOf(p.region);
      p.fn(dc, (code, level, loc, m) => { const d = put(code, level, loc, m, {}, w); if (d && !d.state) d.state = text(); });
    }
    measure(dc, a, only);
  };
  let done = 0, complete = true;
  const rest = vars.map(() => 0);
  run1(rest, null); done++;
  for (const [r, idx] of groups) {
    const sub = idx.map(i => vars[i]), { list, complete: ok } = assignments(sub, opts.max || MAX_STATES);
    if (!ok) complete = false;
    for (const s of list) {
      if (s.every(x => x === 0)) continue; // le repos est déjà calculé
      const a = rest.slice(); idx.forEach((i, j) => { a[i] = s[j]; });
      run1(a, r); done++;
      if (done % 64 === 0) yield;
    }
  }
  // Pire combinaison des budgets : chaque sous-montage dans son pire état (atteignable, puisqu'ils sont indépendants).
  budgets.forEach((b, bi) => {
    let total = 0; const a = rest.slice();
    for (const [r, x] of worst[bi]) { total += x.v; (groups.get(r) || []).forEach(i => { a[i] = x.a[i]; }); }
    b.judge(total, (code, level, loc, m) => { const d = put(code, level, loc, m); if (d && !d.state) d.state = stateText(vars, a); });
  });
  const list = { length: complete ? space : done };

  /* ---------- 4. Exceptions acceptées (avertissements seulement), tri ---------- */
  const allow = proj.allow || [];
  // Un conseil de déclassement ne redit pas une valeur nominale déjà dépassée sur le même composant ; le budget USB ne
  // redit pas une broche 5V ou 3V3 déjà surchargée.
  const all = [...out.values()], j03 = new Set(all.filter(d => /^J03(?!3[34])/.test(d.code) && d.loc.comp).map(d => d.loc.comp));
  const rail = new Set(all.filter(d => (d.code === 'J0109' || d.code === 'J0103') && d.loc.comp && boardOf(d.loc.comp)).map(d => d.loc.comp));
  const diags = all.filter(d => !(d.code === 'J0904' && j03.has(d.loc.comp)) && !(d.code === 'J0334' && rail.has(d.loc.comp)));
  for (const d of diags) {
    d.total = space;
    const ex = EXPLAIN[d.code];
    if (ex) { if (!d.note) d.note = ex.why; if (!d.help) d.help = ex.fix; }
    const a = d.level === 'warning' && allow.find(x => x.code === d.code && (!x.comp || (d.loc.comp && d.loc.comp.id === x.comp)));
    d.accepted = a ? a.reason || '' : null;
  }
  diags.sort((x, y) => (x.level === y.level ? (x.accepted == null) - (y.accepted == null) || x.code.localeCompare(y.code) : x.level === 'error' ? -1 : 1));
  const errors = diags.filter(d => d.level === 'error').length, warnings = diags.filter(d => d.level === 'warning' && d.accepted == null).length;
  const dynamic = [...facts.values()].some(f => f.dynamic);
  return { diags, errors, warnings, accepted: diags.filter(d => d.accepted != null).length, states: list.length, space, solved: done, regions: groups.size, proven: complete, dynamic, ms: Math.round(now() - t0) };
}

function titleOf(code, m, given) {
  if (given) return given;
  const c = CODES[code];
  return c && c.title ? c.title(m || {}) : code;
}

/**
 * Contrôles à faire dans chaque état : une fonction (dc, report) par composant ou broche concernés.
 * report(code, level, loc, m) ; m : { name, value, limit, … } pour le titre.
 */
function probeList(comps, A, facts, proj = {}) {
  const P = [], B = [], nm = (c, k) => (k ? `${c.name} ${k}` : c.name);
  const lim = (v, l, onMax, onWarn) => { const a = Math.abs(v); if (a > l.max) onMax(); else if (l.warn != null && a > l.warn) onWarn(); };
  // Déclassement (J0904, EEE-INST-002) : au-delà de la part k de la limite, mais encore sous le seuil d'avertissement
  // de la famille J03 (ou sous le maximum s'il n'y en a pas), le composant s'use : conseil, accepté si voulu.
  const der = (R, loc, name, v, max, k, unit, warn = max) => { const a = Math.abs(v); if (a > k * max && a <= warn) R('J0904', 'warning', loc, { name, value: a, limit: max, pct: Math.round(k * 100), unit }); };
  for (const c of comps) {
    const t = c.type, spec = partOf(c);
    // Chaque contrôle porte son composant (et sa broche pour une carte) : son sous-montage dit dans quels états le faire.
    const P0 = P.length;
    if (isLed(c)) { const LL = LIM.ledLimit(t); P.push((dc, R) => { const l = dc.leds.get(c); if (!l) return; lim(l.mA, LL, () => R('J0301', 'error', { comp: c, key: 'A' }, { name: c.name, value: l.mA, limit: LL.max }), () => R('J0301', 'warning', { comp: c, key: 'A' }, { name: c.name, value: l.mA, limit: LL.warn })); }); }
    if (t === 'led-rgb' || t === '7seg') P.push((dc, R) => { const l = dc.leds.get(c); if (!l || !l.ch) return; for (const [k, x] of Object.entries(l.ch)) { const LL = LIM.ledLimit(t, t === 'led-rgb' ? k : null); lim(x.mA, LL, () => R('J0301', 'error', { comp: c, key: k }, { name: nm(c, k), value: x.mA, limit: LL.max }), () => R('J0301', 'warning', { comp: c, key: k }, { name: nm(c, k), value: x.mA, limit: LL.warn })); } });
    // Résistance (bibliothèque ou paquet .jpart, qui peut citer sa propre limite de puissance).
    if (isResistor(t)) { const PR = pkgLimit(t, 'power') || LIM.POWER.res; P.push((dc, R) => { const a = dc.across(c); if (!a || a.v == null) return; const w = Math.abs(a.v * a.mA) / 1000; lim(w, PR, () => R('J0304', 'error', { comp: c }, { name: c.name, value: w, limit: PR.max }), () => R('J0304', 'warning', { comp: c }, { name: c.name, value: w, limit: PR.warn })); der(R, { comp: c }, c.name, w, PR.max, LIM.DERATE.res, 'W', PR.warn); }); }
    // LED en paquet : courant limité comme une LED de la bibliothèque (ou par la limite citée dans le paquet).
    const pl = pkgLed(t), PL = pl && (pkgLimit(t, 'current') || LIM.LED);
    if (pl) P.push((dc, R) => { const l = dc.leds.get(c); if (!l) return; lim(l.mA, PL, () => R('J0301', 'error', { comp: c, key: pl.anode }, { name: c.name, value: l.mA, limit: PL.max }), () => R('J0301', 'warning', { comp: c, key: pl.anode }, { name: c.name, value: l.mA, limit: PL.warn })); });
    if (t === 'pot') P.push((dc, R) => {
      const inj = dc.injections(), v = k => dc.volts({ comp: c, key: k });
      const parts = [['1', 'W'], ['3', 'W']].map(([e, w]) => { const i = inj.get(pid(c, e)) || 0, a = v(e), b = v(w); return a == null || b == null ? 0 : Math.abs((a - b) * i) / 1000; });
      const w = Math.max(...parts); lim(w, LIM.POWER.pot, () => R('J0314', 'error', { comp: c }, { name: c.name, value: w, limit: LIM.POWER.pot.max }), () => {});
      der(R, { comp: c }, c.name, w, LIM.POWER.pot.max, LIM.DERATE.res, 'W');
    });
    if (t === 'speaker') P.push((dc, R) => { const a = dc.across(c); if (!a || a.v == null) return; const w = Math.abs(a.v * a.mA) / 1000; lim(w, LIM.POWER.speaker, () => R('J0313', 'error', { comp: c }, { name: c.name, value: w, limit: LIM.POWER.speaker.max }), () => {}); });
    // Capteur de courant ACS712 : courant du primaire contre la plage de sa version, puis contre ce qu'il supporte.
    if (t === 'acs712' && c.pins['IP+'] && c.pins['IP-']) P.push((dc, R) => { const i = dc.current(c); if (i == null) return; const a = Math.abs(i), r = LIM.ACS712_I.range[acsRange(c)]; if (a > LIM.ACS712_I.max) R('J0331', 'error', { comp: c, key: 'IP+' }, { name: c.name, value: a, limit: LIM.ACS712_I.max }); else if (a > r) R('J0331', 'warning', { comp: c, key: 'IP+' }, { name: c.name, value: a, limit: r }); });
    if (t === 'buzzer') P.push((dc, R) => { const a = dc.across(c); if (!a || a.v == null) return; lim(a.v, LIM.BUZZER_V, () => R('J0315', 'error', { comp: c }, { name: c.name, value: a.v, limit: LIM.BUZZER_V.max }), () => R('J0315', 'warning', { comp: c }, { name: c.name, value: a.v, limit: LIM.BUZZER_V.warn })); });
    if (NPNS[t]) {
      // Courant de collecteur, puis puissance Vce × Ic : un transistor mal saturé chauffe au lieu de commuter.
      const L = NPNS[t].ic, PW = { warn: NPNS[t].p * 0.8 / 1000, max: NPNS[t].p / 1000 }, driven = c.pins.B && A.wnet({ comp: c, key: 'B' }).gpio.length > 0;
      P.push((dc, R) => {
        const a = dc.across(c); if (!a || !a.extra) return;
        const ic = Math.abs(a.extra.ic || 0); // PNP : courant de l'émetteur vers le collecteur, compté en valeur absolue
        lim(ic, L, () => R('J0305', 'error', { comp: c, key: 'C' }, { name: c.name, value: ic, limit: L.max }), () => R('J0305', 'warning', { comp: c, key: 'C' }, { name: c.name, value: ic, limit: L.warn }));
        const w = Math.abs((a.extra.vce || 0) * ic) / 1000;
        lim(w, PW, () => R('J0316', 'error', { comp: c, key: 'C' }, { name: c.name, value: w, limit: PW.max }), () => R('J0316', 'warning', { comp: c, key: 'C' }, { name: c.name, value: w, limit: PW.warn }));
        der(R, { comp: c, key: 'C' }, c.name, ic, L.max, LIM.DERATE.bjtI, 'mA', L.warn);
        der(R, { comp: c, key: 'C' }, c.name, w, PW.max, LIM.DERATE.bjtP, 'W', PW.warn);
        // Commutation : saturé seulement avec IB ≥ IC ÷ β forcé (conditions d'essai de VCE(sat)). Base pilotée par une carte.
        const ib = Math.abs(a.extra.ib || 0), bs = LIM.SWITCHING[t] && LIM.SWITCHING[t].betaSat;
        if (bs && driven && ic > 1 && ib > 0.01 && ib * bs < ic * 0.98) R('J0908', 'warning', { comp: c, key: 'B' }, { name: c.name, value: ib, limit: ic / bs, beta: bs });
      });
    }
    if (t === 'diode') P.push((dc, R) => { const a = dc.across(c); if (!a) return; lim(a.mA, LIM.DIODE, () => R('J0308', 'error', { comp: c }, { name: c.name, value: a.mA, limit: LIM.DIODE.max }), () => {}); der(R, { comp: c }, c.name, a.mA, LIM.DIODE.max, LIM.DERATE.diode, 'mA', LIM.DIODE.warn); });
    // Zener : puissance |V × I| (en inverse, Vz × Iz) contre Ptot ; signalée en courant, comme la fiche (IZ = Ptot ÷ VZ).
    if (LIM.ZENER_W[t]) {
      const ZW = LIM.ZENER_W[t];
      P.push((dc, R) => {
        const a = dc.across(c); if (!a || a.v == null) return;
        const v = Math.abs(a.v), i = Math.abs(a.mA), w = v * i / 1000; if (!(v > 0.1)) return;
        lim(w, ZW, () => R('J0308', 'error', { comp: c, key: 'K' }, { name: c.name, value: i, limit: ZW.max / v * 1000 }), () => R('J0308', 'warning', { comp: c, key: 'K' }, { name: c.name, value: i, limit: ZW.warn / v * 1000 }));
        der(R, { comp: c, key: 'K' }, c.name, w, ZW.max, LIM.DERATE.zener, 'W', ZW.warn);
      });
    }
    if (LIM.CAP_V[t]) P.push((dc, R) => {
      const v = dc.capV(c); if (v == null) return;
      const vmax = ratingOf(c) || LIM.CAP_V[t]; // tension de service réglée sur le composant, sinon celle du type
      if (Math.abs(v) > vmax) R('J0307', 'error', { comp: c }, { name: c.name, value: Math.abs(v), limit: vmax });
      else der(R, { comp: c }, c.name, v, vmax, t === 'cap-100u' ? LIM.DERATE_ECAP : LIM.DERATE.ceramic, 'V');
      if (t === 'cap-100u' && v < -1) R('J0402', 'error', { comp: c, key: '+' }, { name: c.name, value: v }, null);
    });
    if (COILS[t]) P.push((dc, R) => {
      const m = COILS[t], a = dc.across(c); if (!a || a.v == null) return;
      if (Math.abs(a.v) > m.vMax) R('J0311', 'warning', { comp: c }, { name: c.name, value: Math.abs(a.v), limit: m.vNom });
    });
    if (MOTORS[t]) P.push((dc, R) => {
      const m = MOTORS[t], a = dc.across(c); if (!a || a.v == null) return;
      if (m.polar && a.v < -m.vStart) R('J0403', 'warning', { comp: c, key: m.plus }, { name: c.name, value: a.v });
      else if (Math.abs(a.v) > m.vMax) R('J0311', !m.rev && Math.abs(a.v) > 1.6 * m.vNom ? 'error' : 'warning', { comp: c }, { name: c.name, value: Math.abs(a.v), limit: m.vNom });
    });
    if (t === 'servo') P.push((dc, R) => { const a = dc.across(c); if (a && a.v != null && a.v > 0.5 && a.v < 4.2) R('J0312', 'warning', { comp: c, key: 'VCC' }, { name: c.name, value: a.v }); });
    if (t === 'relay' && c.pins.COM) P.push((dc, R) => { const i = Math.abs(dc.injections().get(pid(c, 'COM')) || 0); if (i > LIM.RELAY_CONTACT) R('J0310', 'error', { comp: c, key: 'COM' }, { name: c.name, value: i, limit: LIM.RELAY_CONTACT }); else der(R, { comp: c, key: 'COM' }, c.name, i, LIM.RELAY_CONTACT, LIM.DERATE.contact, 'mA'); });
    if (t === 'l298n') P.push((dc, R) => { const inj = dc.injections(); for (const k of ['OUT1', 'OUT2', 'OUT3', 'OUT4']) { const i = Math.abs(inj.get(pid(c, k)) || 0); lim(i, LIM.L298N_CH, () => R('J0309', 'error', { comp: c, key: k }, { name: c.name, value: i, limit: LIM.L298N_CH.max }), () => {}); } });
    // L293D (600 mA par voie) et TB6612FNG (1,2 A moyens par voie) : courant de chaque sortie.
    const HB = { l293d: [LIM.L293D_CH, ['OUT1', 'OUT2', 'OUT3', 'OUT4']], tb6612: [LIM.TB6612_CH, ['AO1', 'AO2', 'BO1', 'BO2']] }[t];
    if (HB) P.push((dc, R) => {
      const inj = dc.injections(), [L, outs] = HB;
      for (const k of outs) { const i = Math.abs(inj.get(pid(c, k)) || 0); lim(i, L, () => R('J0309', 'error', { comp: c, key: k }, { name: c.name, value: i, limit: L.max }), () => R('J0309', 'warning', { comp: c, key: k }, { name: c.name, value: i, limit: L.warn })); }
    });
    // Composants analogiques : MOSFET (courant, tensions, échauffement sans radiateur), sortie du NE555, entrées du
    // LM358 (sous la masse, hors de la plage de mode commun), courant d'une bobine.
    // MOSFET : commande de grille sous la tension où la fiche garantit RDS(on), et déclassement (EEE-INST-002).
    const fetExtra = (R, x, id, w, L, W) => {
      const on = LIM.SWITCHING[t].vgsOn, vgs = Math.abs(x.vgs || 0), vds = Math.abs(x.vds || 0);
      if (x.state === 'on' && id > 10 && vgs < on - 0.05) R('J0907', 'warning', { comp: c, key: 'G' }, { name: c.name, value: vgs, limit: on });
      der(R, { comp: c, key: 'D' }, c.name, w, W.max, LIM.DERATE.fetP, 'W', W.warn);
      der(R, { comp: c, key: 'D' }, c.name, vds, L.vds, LIM.DERATE.fetVds, 'V');
      der(R, { comp: c, key: 'G' }, c.name, vgs, L.vgs, LIM.DERATE.fetVgs, 'V');
    };
    if (t === 'irlz44n') {
      const L = LIM.IRLZ44N, W = LIM.IRLZ44N_W;
      P.push((dc, R) => {
        const a = dc.across(c); if (!a || a.kind !== 'mosfet' || !a.extra) return;
        const x = a.extra, id = Math.abs(x.id || 0);
        lim(id, L.id, () => R('J0318', 'error', { comp: c, key: 'D' }, { name: c.name, value: id, limit: L.id.max }), () => R('J0318', 'warning', { comp: c, key: 'D' }, { name: c.name, value: id, limit: L.id.warn }));
        if (x.vgs != null && Math.abs(x.vgs) > L.vgs) R('J0319', 'error', { comp: c, key: 'G' }, { name: c.name, value: Math.abs(x.vgs), limit: L.vgs });
        if (x.vds != null && x.vds > L.vds) R('J0320', 'error', { comp: c, key: 'D' }, { name: c.name, value: x.vds, limit: L.vds });
        const w = Math.abs((x.vds || 0) * (x.id || 0)) / 1000;
        lim(w, W, () => R('J0325', 'error', { comp: c, key: 'D' }, { name: c.name, value: w, limit: W.max }), () => R('J0325', 'warning', { comp: c, key: 'D' }, { name: c.name, value: w, limit: W.warn }));
        fetExtra(R, x, id, w, L, W);
      });
    }
    // IRF9540N (canal P) : mêmes contrôles, tensions en valeur absolue (VDS et VGS sont négatives quand il conduit).
    if (t === 'irf9540n') {
      const L = LIM.IRF9540N, W = LIM.IRF9540N_W;
      P.push((dc, R) => {
        const a = dc.across(c); if (!a || a.kind !== 'mosfet' || !a.extra) return;
        const x = a.extra, id = Math.abs(x.id || 0);
        lim(id, L.id, () => R('J0318', 'error', { comp: c, key: 'D' }, { name: c.name, value: id, limit: L.id.max }), () => R('J0318', 'warning', { comp: c, key: 'D' }, { name: c.name, value: id, limit: L.id.warn }));
        if (x.vgs != null && Math.abs(x.vgs) > L.vgs) R('J0319', 'error', { comp: c, key: 'G' }, { name: c.name, value: Math.abs(x.vgs), limit: L.vgs });
        if (x.vds != null && -x.vds > L.vds) R('J0320', 'error', { comp: c, key: 'D' }, { name: c.name, value: -x.vds, limit: L.vds });
        const w = Math.abs((x.vds || 0) * (x.id || 0)) / 1000;
        lim(w, W, () => R('J0325', 'error', { comp: c, key: 'D' }, { name: c.name, value: w, limit: W.max }), () => R('J0325', 'warning', { comp: c, key: 'D' }, { name: c.name, value: w, limit: W.warn }));
        fetExtra(R, x, id, w, L, W);
      });
    }
    if (t === 'ne555') P.push((dc, R) => { const a = dc.across(c); if (!a || a.kind !== 'timer') return; lim(a.mA, LIM.NE555_OUT, () => R('J0321', 'error', { comp: c, key: 'OUT' }, { name: c.name, value: Math.abs(a.mA), limit: LIM.NE555_OUT.max }), () => R('J0321', 'warning', { comp: c, key: 'OUT' }, { name: c.name, value: Math.abs(a.mA), limit: LIM.NE555_OUT.warn })); der(R, { comp: c, key: 'OUT' }, c.name, a.mA, LIM.NE555_OUT.max, LIM.DERATE.ic, 'mA', LIM.NE555_OUT.warn); });
    if (OPAMPS[t]) P.push((dc, R) => {
      const a = dc.across(c); if (!a || a.kind !== 'opamp') return;
      const g = dc.volts({ comp: c, key: 'GND' }), v = dc.volts({ comp: c, key: 'VCC' }), top = g != null && v != null ? v - g - LIM.LM358_IN.cmr : null;
      for (const ch of a.extra.chans) {
        const keys = OPAMPS[t].chans.find(x => x[2] === ch.out); if (!keys) continue;
        for (const [k, x] of [[keys[0], ch.vp], [keys[1], ch.vn]]) {
          if (x == null || !(A.members({ comp: c, key: k }).length > 1)) continue;
          if (x < LIM.LM358_IN.min - 1e-3) R('J0324', 'error', { comp: c, key: k }, { name: nm(c, k), value: x, limit: LIM.LM358_IN.min });
          else if (top != null && v - g > 0.5 && x > top + 1e-3) R('J0323', 'warning', { comp: c, key: k }, { name: nm(c, k), value: x, limit: top });
        }
      }
    });
    // Puces logiques : courant de chaque sortie reliée, puis courant total par VCC et par GND.
    if (LIM.CHIP_I[t]) {
      const L = LIM.CHIP_I[t], outs = CHIPS[t].outs.filter(k => c.pins[k]);
      P.push((dc, R) => {
        const inj = dc.injections();
        for (const k of outs) { const i = Math.abs(inj.get(pid(c, k)) || 0); lim(i, L.out, () => R('J0326', 'error', { comp: c, key: k }, { name: nm(c, k), value: i, limit: L.out.max }), () => R('J0326', 'warning', { comp: c, key: k }, { name: nm(c, k), value: i, limit: L.out.warn })); }
        for (const [k, x] of [['VCC', L.vcc], ['GND', L.gnd]]) { const i = Math.abs(inj.get(pid(c, k)) || 0); lim(i, x, () => R('J0327', 'error', { comp: c, key: k }, { name: nm(c, k), value: i, limit: x.max }), () => R('J0327', 'warning', { comp: c, key: k }, { name: nm(c, k), value: i, limit: x.warn })); }
      });
    }
    if (LIM.INDUCTOR[t]) P.push((dc, R) => { const a = dc.across(c); if (!a) return; const L = LIM.INDUCTOR[t]; lim(a.mA, L, () => R('J0322', 'error', { comp: c }, { name: c.name, value: Math.abs(a.mA), limit: L.max }), () => R('J0322', 'warning', { comp: c }, { name: c.name, value: Math.abs(a.mA), limit: L.warn })); });
    if (t === 'lm7805') P.push((dc, R) => {
      const a = dc.across(c); if (!a) return;
      lim(a.mA, LIM.LM7805, () => R('J0109', 'error', { comp: c, key: 'OUT' }, { name: c.name, value: a.mA, limit: LIM.LM7805.max }), () => {});
      const vin = dc.volts({ comp: c, key: 'IN' }), vout = dc.volts({ comp: c, key: 'OUT' });
      if (vin == null || vout == null) return;
      const w = Math.max(0, vin - vout) * Math.max(0, a.mA) / 1000;
      lim(w, LIM.LM7805_W, () => R('J0317', 'error', { comp: c, key: 'IN' }, { name: c.name, value: w, limit: LIM.LM7805_W.max }), () => R('J0317', 'warning', { comp: c, key: 'IN' }, { name: c.name, value: w, limit: LIM.LM7805_W.warn }));
    });
    // Modules d'alimentation : courant de sortie (d'entrée pour l'élévateur, qui le prend dans son interrupteur), chaleur
    // du régulateur linéaire, tension d'entrée du chargeur. La plage d'entrée des régulateurs est celle de leur broche pwr.
    const SUPPLY = { ams1117: [LIM.AMS1117, 'OUT', a => a.mA], lm2596: [LIM.LM2596, 'OUT+', a => a.mA], mt3608: [LIM.MT3608, 'IN+', a => a.extra.iin] };
    if (SUPPLY[t]) P.push((dc, R) => {
      const a = dc.across(c); if (!a || a.kind !== 'reg' || !a.extra) return;
      const [L, key, cur] = SUPPLY[t], i = cur(a);
      lim(i, L, () => R('J0109', 'error', { comp: c, key }, { name: nm(c, key), value: i, limit: L.max }), () => R('J0109', 'warning', { comp: c, key }, { name: nm(c, key), value: i, limit: L.warn }));
      if (t !== 'ams1117' || a.extra.vin == null || a.v == null) return;
      const w = Math.max(0, a.extra.vin - a.v) * Math.max(0, a.mA) / 1000, W = LIM.AMS1117_W;
      lim(w, W, () => R('J0317', 'error', { comp: c, key: 'IN' }, { name: c.name, value: w, limit: W.max }), () => R('J0317', 'warning', { comp: c, key: 'IN' }, { name: c.name, value: w, limit: W.warn }));
    });
    if (t === 'tp4056' && c.pins['IN+'] && c.pins['IN-']) P.push((dc, R) => {
      const a = dc.volts({ comp: c, key: 'IN+' }), b = dc.volts({ comp: c, key: 'IN-' });
      if (a != null && b != null && a - b > LIM.TP4056.vin + 0.15) R('J0306', 'error', { comp: c, key: 'IN+' }, { name: nm(c, 'IN+'), value: a - b, limit: LIM.TP4056.vin });
    });
    // Sources : pile, batterie, module d'alimentation. Très au-delà de leur courant : court-circuit.
    const S = SOURCES[t];
    if (S && LIM.SOURCE[t]) P.push((dc, R) => {
      const inj = dc.injections(); let i = 0;
      for (const k in S) if (S[k]) i += Math.max(0, inj.get(pid(c, k)) || 0);
      const l = LIM.SOURCE[t];
      // Court-circuit : bien au-delà de ce que la source sait débiter (un accu 18650 fournit 5 A en pointe).
      if (i > Math.max(LIM.SHORT_MA, 2 * l.max)) R('J0103', 'error', { comp: c }, { name: c.name, value: i });
      else if (i > l.max) R('J0109', 'error', { comp: c }, { name: c.name, value: i, limit: l.max });
      else if (i > l.warn) R('J0902', 'warning', { comp: c }, { name: c.name, value: i, limit: l.warn });
    });
    // Modules : tension d'alimentation calculée, au-delà de ce qu'ils supportent.
    if (spec && spec.pins && !boardOf(c)) {
      const g = spec.pins.find(p => p.kind === 'gnd');
      for (const p of spec.pins) {
        if (p.kind !== 'pwr' || !Array.isArray(p.v) || !c.pins[p.pin] || !g || !c.pins[g.pin]) continue;
        P.push((dc, R) => { const a = dc.volts({ comp: c, key: p.pin }), b = dc.volts({ comp: c, key: g.pin }); if (a == null || b == null) return; if (a - b > p.v[1] + 0.15) R('J0306', 'error', { comp: c, key: p.pin }, { name: nm(c, p.pin), value: a - b, limit: p.v[1] }); });
      }
    }
    // Broches de signal d'un module (hors I2C) : tension au-delà de ce qu'elles tolèrent (J0332, maximum absolu de la
    // fiche), ou niveau haut sous leur seuil VIH (J0213 : la carte 3,3 V qui commande un module 5 V).
    const RT = !boardOf(c) && spec && spec.pins && RATINGS[t];
    if (RT && (RT.vio || RT.vih)) {
      const g = spec.pins.find(p => p.kind === 'gnd'), pw = spec.pins.find(p => p.kind === 'pwr');
      for (const p of spec.pins) {
        if (p.kind !== 'io' || !TO_MODULE.has(p.need) || !c.pins[p.pin] || !(A.members({ comp: c, key: p.pin }).length > 1) || !g || !c.pins[g.pin]) continue;
        P.push((dc, R) => {
          const v0 = dc.volts({ comp: c, key: g.pin }), vp = dc.volts({ comp: c, key: p.pin }); if (v0 == null || vp == null) return;
          const vsAbs = pw && c.pins[pw.pin] ? dc.volts({ comp: c, key: pw.pin }) : null, vs = vsAbs == null ? null : vsAbs - v0, v = vp - v0;
          if (vs == null || vs < 1) return; // module éteint : son alimentation est vérifiée ailleurs (J0104)
          const vmax = vioMax(RT, vs), vih = vihOf(RT, vs), loc = { comp: c, key: p.pin };
          if (vmax != null && v > vmax + 0.05) R('J0332', 'error', loc, { name: nm(c, p.pin), value: v, limit: vmax });
          else if (v < -0.5) R('J0332', 'error', loc, { name: nm(c, p.pin), value: v, limit: -0.5, low: true });
          else if (vih != null && v > Math.min(0.3 * vs, vih - 0.1) && v < vih - 0.01) R('J0213', 'warning', loc, { name: nm(c, p.pin), value: v, limit: vih });
        });
      }
    }
    // Cartes : courant de chaque GPIO et total, broches 5V et 3V3, tension reçue, lecture d'une entrée en l'air.
    const L = LIM.boardLimits(c);
    if (L) {
      const prof = boardOf(c), f = facts.get(c);
      // Entrées lues par le programme, sans tirage ni module qui les pilote : à vérifier dans chaque état.
      const moduleDriven = k => A.members({ comp: c, key: k }).some(m => { if (boardOf(m.comp)) return false; const sp = partOf(m.comp), q = sp && sp.pins && sp.pins.find(x => x.pin === m.key); return !!(q && q.kind === 'io' && DRIVEN.has(q.need)); });
      // VIN / VSYS : vérifiée quand quelque chose y est relié ; « alimentée » quand une source extérieure l'atteint.
      const vinKeys = prof.vin ? Object.keys(c.pins).filter(k => base(k) === prof.vin.pin && A.members({ comp: c, key: k }).some(m => m.comp !== c)) : [];
      const vinFed = k => A.wnet({ comp: c, key: k }).src.some(s => s.comp !== c) || A.members({ comp: c, key: k }).some(m => m.comp.type === 'diode' && m.key === 'K');
      const reads = f ? [...f.pins].filter(([k, pf]) => !pf.lib && pf.reads.size && !['out', 'pullup', 'pulldown'].includes(pinRole(pf)) && !moduleDriven(k)).map(([k]) => k) : [];
      const pinProbe = (k, fn) => P.push({ comp: c, pin: k, fn });
      for (const k in prof.gpio) {
        if (!c.pins[k]) continue;
        pinProbe(k, (dc, R) => {
          const i = Math.abs(dc.injections().get(pid(c, k)) || 0);
          if (i > 0.01) lim(i, L.pin, () => R('J0302', 'error', { comp: c, key: k }, { name: nm(c, k), value: i, limit: L.pin.max }), () => R('J0302', 'warning', { comp: c, key: k }, { name: nm(c, k), value: i, limit: L.pin.warn }));
          const v = dc.volts({ comp: c, key: k });
          if (v != null && (v > L.vmax || v < L.vmin)) R('J0303', 'error', { comp: c, key: k }, { name: nm(c, k), value: v, limit: v > 0 ? L.vmax : L.vmin });
        });
      }
      for (const k of reads) pinProbe(k, (dc, R) => { if (dc.volts({ comp: c, key: k }) == null) R('J0602', 'error', { comp: c, key: k }, { name: nm(c, k) }); });
      // ESP32 : analogRead() sature au-delà de la plage de son atténuation (11 dB par défaut). Signalé quand plus de 10 %
      // du signal est perdu (ESP32-C3 : 2,5 V lus au plus, un potentiomètre sur 3,3 V perd un quart de sa course).
      if (L.adc && f) for (const [k, pf] of f.pins) if (pf.reads.has('a') && c.pins[k]) pinProbe(k, (dc, R) => { const v = dc.volts({ comp: c, key: k }); if (v != null && v > L.adc * 1.1 && v <= L.vmax) R('J0905', 'warning', { comp: c, key: k }, { name: nm(c, k), value: v, limit: L.adc }); });
      // Entrée VIN / VSYS alimentée de l'extérieur : dans la plage de son régulateur.
      for (const k of vinKeys) pinProbe(k, (dc, R) => {
        const v = dc.volts({ comp: c, key: k }); if (v == null) return;
        if (v > prof.vin.max + 0.2) R('J0111', 'error', { comp: c, key: k }, { name: nm(c, k), value: v, lo: prof.vin.min, hi: prof.vin.max });
        else if (vinFed(k) && v < prof.vin.min - 0.2) R('J0112', 'warning', { comp: c, key: k }, { name: nm(c, k), value: v, lo: prof.vin.min });
      });
      // Budgets : toutes les GPIO ensemble ; broches 5V et 3V3 (ce que tirent les composants reliés à chaque nœud d'alimentation).
      const gpioParts = Object.keys(prof.gpio).filter(k => c.pins[k]).map(k => ({ pin: k, read: dc => Math.abs(dc.injections().get(pid(c, k)) || 0) }));
      B.push({ comp: c, parts: gpioParts, judge: (total, R) => { if (total > L.total) R('J0109', 'error', { comp: c, key: 'GPIO' }, { name: tl('{0} (toutes ses broches)', c.name), value: total, limit: L.total }); } });
      // ATmega : sommes des courants fournis (IOH) et absorbés (IOL) par groupe de ports.
      const PG = L.groups && LIM.PORT_GROUPS[L.groups];
      if (PG) for (const gr of PG.groups) {
        const parts = Object.keys(prof.gpio).filter(k => c.pins[k] && prof.gpio[k].caps.has('out') && PG.port(k) && gr.has(PG.port(k)) && !(prof.alias || []).some(([a]) => a === k))
          .map(k => ({ pin: k, read: dc => { const i = dc.injections().get(pid(c, k)) || 0; return Math.max(0, gr.dir === 'source' ? i : -i); } }));
        if (parts.length) B.push({ comp: c, parts, judge: (total, R) => { if (total > gr.max) R('J0333', 'error', { comp: c, key: `${gr.dir}:${gr.name}` }, { name: c.name, value: total, limit: gr.max, group: gr.name, dir: gr.dir }); } });
      }
      // Port USB (500 mA) : modules sur 5V et sur 3V3 (le régulateur 3,3 V prend son courant sur le 5 V de l'USB), plus
      // l'émission Wi-Fi d'une carte ESP dont le programme s'en sert. Seulement quand rien n'alimente la carte par VIN.
      const usbParts = [], usbNodes = new Set(), code = proj.programs ? proj.programs.get(c.id) : null;
      if (!vinKeys.some(vinFed)) {
        for (const k in c.pins) {
          if (prof.power[base(k)] == null) continue;
          const mem = A.members({ comp: c, key: k }); if (usbNodes.has(mem)) continue; usbNodes.add(mem);
          for (const m of mem) if (!boardOf(m.comp)) usbParts.push({ comp: m.comp, read: dc => -(dc.injections().get(pid(m.comp, m.key)) || 0) });
        }
        const radio = L.radio && usesWifi(code) ? L.radio : 0;
        if (usbParts.length) B.push({ comp: c, parts: usbParts, judge: (total, R) => { const all = total + radio; if (all > LIM.SHORT_MA || !(all > L.five)) return; R('J0334', 'error', { comp: c, key: 'USB' }, { name: c.name, value: all, limit: L.five, radio }); } });
      }
      for (const [high, lv, label] of [[true, L.five, '5V'], [false, L.three, '3V3']]) {
        const nodes = new Set(), parts = [];
        for (const k in c.pins) {
          const v = prof.power[base(k)]; if (v == null || (v > 4) !== high) continue;
          const mem = A.members({ comp: c, key: k }); if (nodes.has(mem)) continue; nodes.add(mem);
          for (const m of mem) if (!boardOf(m.comp)) parts.push({ comp: m.comp, read: dc => -(dc.injections().get(pid(m.comp, m.key)) || 0) });
        }
        if (!parts.length) continue;
        B.push({ comp: c, parts, judge: (total, R) => {
          if (total > LIM.SHORT_MA) R('J0103', 'error', { comp: c, key: label }, { name: nm(c, label), value: total });
          else if (total > lv) R('J0109', 'error', { comp: c, key: label }, { name: nm(c, label), value: total, limit: lv });
        } });
      }
    }
    for (let i = P0; i < P.length; i++) if (typeof P[i] === 'function') P[i] = { comp: c, fn: P[i] };
  }
  return { probes: P, budgets: B };
}

/**
 * Sous-montages indépendants : on coupe le montage aux nœuds dont la tension ne dépend de rien (masses, 5V et 3V3
 * d'une carte, VIN alimenté par la seule USB). Un composant relie toutes ses autres broches (prudent : un module
 * entier, un relais avec ses contacts, un pilote avec ses moteurs). Une broche de carte est dans le sous-montage de son
 * nœud ; une broche ou un composant posé sur un nœud fixe forme son propre sous-montage.
 * Rend { comp(c), pin(carte, clé) } → identifiant de sous-montage.
 */
function regionsOf(comps, A) {
  const ids = new Map(), parent = [];
  const netId = r => { const m = A.members(r); let i = ids.get(m); if (i === undefined) { i = parent.length; ids.set(m, i); parent.push(i); } return i; };
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const stiffOf = new Map();
  const stiff = r => {
    const i = netId(r); if (stiffOf.has(i)) return stiffOf.get(i);
    const net = A.net(r), mem = A.members(r);
    const s = net.gnd.length > 0 || net.src.some(x => boardOf(x.comp) && !x.diode)
      || (net.src.length > 0 && net.src.every(x => boardOf(x.comp)) && !mem.some(m => m.comp.type === 'diode' || SOURCES[m.comp.type] || DERIVED[m.comp.type]));
    stiffOf.set(i, s); return s;
  };
  for (const c of comps) {
    if (boardOf(c) || /^breadboard/.test(c.type)) continue;
    let first = -1;
    for (const k in c.pins) {
      const r = { comp: c, key: k }; if (stiff(r)) continue;
      const i = find(netId(r)); if (first < 0) first = i; else if (i !== first) parent[i] = first;
    }
  }
  return {
    comp(c) { for (const k in c.pins) { const r = { comp: c, key: k }; if (!stiff(r)) return 'n' + find(netId(r)); } return 'c:' + c.id; },
    pin(c, k) { const r = { comp: c, key: k }; return stiff(r) ? `p:${c.id}|${k}` : 'n' + find(netId(r)); }
  };
}
export { DERIVED };
