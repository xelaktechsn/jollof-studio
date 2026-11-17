// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Parité de comportement (Node seulement) : le même programme C++ tourne dans l'interpréteur (lang.js + runtime.js) et,
// compilé par arduino-cli, sur l'ATmega328P émulé (src/emu/avr.js). Les mêmes stimulations (niveaux, tensions, texte
// reçu par le port série) arrivent aux mêmes heures ; aux instants choisis, on relève l'état des broches et le texte
// du moniteur série des deux côtés, puis on les compare.
//
//   parity(src, {
//     kind: 'uno',                                   // 'uno', 'nano' ou 'mega'
//     inputs: [{ at: 120, pin: 'D2', d: 0 },          // niveau imposé sur une entrée (d : 0 ou 1)
//              { at: 300, pin: 'A0', v: 2.5 },        // tension sur une entrée analogique
//              { at: 400, pin: 'D2', release: true }],// plus rien d'imposé (tirage interne)
//     serialIn: [{ at: 50, text: 'ON\n' }],           // texte envoyé à la carte par le moniteur série
//     probes: [100, 250, 600],                        // instants (ms) des relevés
//     pins: ['D13', 'D9'],                            // broches relevées
//     modules: [],                                    // faux modules (voir fakeBoard de src/emu/testkit.mjs)
//     until: 800,                                     // durée totale (par défaut : 50 ms après le dernier évènement)
//     mem: { ee: '' },                                // EEPROM de départ (hexadécimal, comme prog.mem)
//     serialLag: 15,                                  // ms de retard admis pour le texte série de la carte émulée
//     tol: { pwm: 0.03, servo: 3, freq: 0.03 }        // écarts admis (rapport cyclique, degrés, fréquence relative)
//   })
//   → { interp, avr, diff }
//
// interp et avr : { samples: [{ t, pins: { D13: { mode, d, pwm?, servo?, freq? } }, serial }], serial, mem, warnings }.
// serial : tout le texte reçu jusqu'à l'instant (les \r de println sont retirés). diff : liste des différences, en
// clair ; [] quand les deux exécutions concordent. Un relevé compare le niveau des sorties (d), le mode, le rapport
// cyclique de la PWM, l'angle d'un servo et la fréquence d'un tone() ; la carte émulée mesure ces grandeurs sur une
// fenêtre de 60 ms : relevez-les au moins 60 ms après un changement, et loin des transitions (± 2 ms d'écart possible).
// Le texte série de la carte émulée sort au rythme du débit (≈ 87 µs par caractère à 115200 bauds) : serialLag en tient
// compte. Sans arduino-cli, compileSketch lève une erreur : protégez les tests par { skip: !hasCli }.
import { compile } from './lang.js';
import { createRuntime } from './runtime.js';
import { BOARDS } from '../sim/boards.js';
import { hasCli, compileSketch, fakeBoard, boot } from '../emu/testkit.mjs';

export { hasCli };
const FQBN = { uno: 'arduino:avr:uno', nano: 'arduino:avr:nano', mega: 'arduino:avr:mega' };

/** Pont factice commun aux deux côtés : les entrées viennent de `inputs` (objet partagé, modifié au fil du temps). */
function bridge(kind, modules, inputs, mem) {
  const { hw, comps } = fakeBoard({ kind, modules, inputs });
  const store = { ee: mem && mem.ee ? mem.ee : '', prefs: {} };
  hw.label = kind; hw.mem = () => store;
  hw.echo = () => null;
  hw.onPin = (k, types) => { const h = hw.at(k).find(x => types.includes(x.comp.type)); return h ? h.comp : null; };
  hw.i2c = () => hw.bus(comps.map(c => c.type));
  return { hw, comps, store };
}

/** État comparable d'une broche. */
function snap(rt, k) {
  const p = rt.pins.get(k);
  if (!p) return { mode: 0, d: 0 };
  const o = { mode: p.mode, d: p.mode === 1 ? p.d : 0 };
  // analogWrite(…, 0) et analogWrite(…, 255) : un niveau fixe sur la carte (le cœur Arduino fait un digitalWrite).
  if (p.mode === 1 && p.pwm != null && p.pwm > 0.001 && p.pwm < 0.999) o.pwm = Math.round(p.pwm * 1000) / 1000;
  if (p.mode === 1 && p.servo != null) o.servo = Math.round(p.servo * 10) / 10;
  if (p.mode === 1 && p.freq && !(p.toneEnd && rt.clock() > p.toneEnd)) o.freq = Math.round(p.freq);
  return o;
}

/** Exécute src d'un côté (make : compile et lance), en appliquant les évènements ; rend la trace. */
function play(make, o) {
  const inputs = {}, { hw, store } = bridge(o.kind, o.modules, inputs, o.mem), rt = make(hw);
  const events = [
    ...o.inputs.map(e => ({ at: e.at, run: () => { if (e.release) delete inputs[e.pin]; else inputs[e.pin] = e.v != null ? { v: e.v } : { d: e.d ? 1 : 0, v: e.d ? hw.prof.logic : 0 }; } })),
    ...o.serialIn.map(e => ({ at: e.at, run: () => rt.send(e.text) }))
  ].sort((a, b) => a.at - b.at);
  const chunks = [], samples = [], probes = [...o.probes].sort((a, b) => a - b);
  const take = () => { const s = rt.takeSerial().replace(/\r/g, ''); if (s) chunks.push([rt.clock(), s]); };
  // Carte émulée : des octets (UTF-8 pour les accents) ; interpréteur : du texte.
  const utf8 = t => (make.bytes ? Buffer.from(t, 'latin1').toString('utf8') : t);
  const textAt = t => utf8(chunks.filter(c => c[0] <= t + 1e-9).map(c => c[1]).join(''));
  let ev = 0, pr = 0;
  while (ev < events.length && events[ev].at <= 0) events[ev++].run();
  rt.run(0); take();
  for (let t = 0; t < o.until; t++) {
    while (ev < events.length && events[ev].at <= t) events[ev++].run();
    const target = t + 1;
    rt.run(1);
    for (let g = 0; rt.clock() < target - 1e-9 && g < 100; g++) rt.run(0); // rattrape une tranche coupée par l'horloge murale
    take();
    if (rt.state === 'error') throw new Error(`erreur à ${t} ms : ${rt.error && rt.error.msg}`);
    while (pr < probes.length && probes[pr] <= target) {
      const at = probes[pr++], pins = {};
      for (const k of o.pins) pins[k] = snap(rt, k);
      samples.push({ t: at, pins });
    }
  }
  for (const s of samples) s.serial = textAt(s.t + (make.lag || 0));
  return { samples, serial: utf8(chunks.map(c => c[1]).join('')), mem: store.ee, warnings: [...rt.warnings.values()].map(w => w.msg), rt };
}

/** Deux relevés d'une broche concordent-ils ? (tolérances de mesure de la carte émulée) */
function same(a, b, tol) {
  if (a.mode !== b.mode) return false;
  if (a.mode !== 1) return true;
  // analogWrite(…, 128) : un créneau à 50 % que la carte émulée prend pour un tone() à 490 / 980 Hz.
  const halfPwm = (x, y) => x.pwm != null && Math.abs(x.pwm - 0.5) < 0.06 && y.freq && [490, 980].some(f => Math.abs(y.freq - f) < 20);
  if (halfPwm(a, b) || halfPwm(b, a)) return true;
  if ((a.servo != null) !== (b.servo != null)) return false;
  if (a.servo != null) return Math.abs(a.servo - b.servo) <= tol.servo;
  if ((a.pwm != null) !== (b.pwm != null)) return false;
  if (a.pwm != null) return Math.abs(a.pwm - b.pwm) <= tol.pwm;
  if (!!a.freq !== !!b.freq) return false;
  if (a.freq) return Math.abs(a.freq - b.freq) <= tol.freq * a.freq;
  return a.d === b.d;
}

/**
 * Exécute src dans l'interpréteur et sur la carte AVR émulée avec les mêmes stimulations ; rend les deux traces et
 * leurs différences (voir l'en-tête du fichier).
 */
export function parity(src, opts = {}) {
  const o = {
    kind: 'uno', inputs: [], serialIn: [], probes: [], pins: [], modules: [], mem: null, serialLag: 15, ...opts,
    tol: { pwm: 0.03, servo: 3, freq: 0.03, ...(opts.tol || {}) }
  };
  const last = Math.max(0, ...o.probes, ...o.inputs.map(e => e.at), ...o.serialIn.map(e => e.at));
  o.until = opts.until || last + 50;
  const c = compile(src, { board: o.kind, boardLabel: o.kind });
  if (!c.ok) throw new Error('interpréteur : ' + c.errors.map(e => `ligne ${e.line} : ${e.msg}`).join(' ; '));
  const hex = compileSketch(src, FQBN[o.kind] || FQBN.uno);
  const interp = play(hw => createRuntime(c.js, hw, { globals: c.globals }), o);
  const emu = Object.assign(hw => boot(hex, hw), { lag: o.serialLag, bytes: true });
  const avr = play(emu, o);
  const diff = [];
  interp.samples.forEach((s, i) => {
    const a = avr.samples[i];
    for (const k of o.pins) if (!same(s.pins[k], a.pins[k], o.tol)) diff.push(`${s.t} ms, ${k} : interpréteur ${JSON.stringify(s.pins[k])}, carte ${JSON.stringify(a.pins[k])}`);
    if (s.serial !== a.serial) diff.push(`${s.t} ms, série : interpréteur ${JSON.stringify(s.serial.slice(-120))}, carte ${JSON.stringify(a.serial.slice(-120))}`);
  });
  if (interp.serial !== avr.serial) diff.push(`série à la fin : interpréteur ${JSON.stringify(interp.serial.slice(-200))}, carte ${JSON.stringify(avr.serial.slice(-200))}`);
  if (interp.mem !== avr.mem) diff.push(`EEPROM : interpréteur ${interp.mem}, carte ${avr.mem}`);
  delete interp.rt; delete avr.rt;
  return { interp, avr, diff };
}
