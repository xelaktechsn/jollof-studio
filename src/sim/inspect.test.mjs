// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests des erreurs de câblage (circuit.js inspect, faults.js) : node --test src/sim/inspect.test.mjs
// Instantané des codes d'erreur de chaque exemple et de chaque TP (montage de départ et solution).
// Seule différence voulue avec la version d'avant les condensateurs et le transistor : les deux
// fausses erreurs « nogpio » des LED alimentées par la pile du TP04 ont disparu.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BOARDS, boardOf } from './boards.js';
import { PARTS, partOf } from './parts.js';
import { analyze, bbGroups, inspect, pid } from './circuit.js';
import { collectFaults } from './faults.js';

const EX = new URL('../../exemples/', import.meta.url), TP = new URL('../lab/tp/', import.meta.url);
const LEGS = { diode: ['A', 'K'], lm7805: ['IN', 'GND', 'OUT'], mb102: ['+5V', 'GND', '+3V3'], bat9v: ['+', '-'], bat18650: ['+', '-'], psu24: ['+', '-'] };
const keys = type => {
  const prof = BOARDS[type];
  if (prof) return [...Object.keys(prof.gpio), ...Object.keys(prof.power), 'GND', ...[2, 3, 4, 5, 6, 7, 8].map(n => `GND (${n})`), 'VIN', 'EN', 'RST', 'AREF', 'IOREF', 'VSYS', 'VBUS', '3V3_EN', 'RUN'];
  if (/^breadboard/.test(type)) return bbGroups({ type }).flatMap(g => g.keys);
  if (/^res-/.test(type)) return ['1', '2'];
  if (LEGS[type]) return LEGS[type];
  const sp = PARTS[type];
  return sp && sp.pins ? sp.pins.map(p => p.pin) : [];
};
/** Montage comme le construit src/lab/validate.mjs : composants du projet, fils [id, clé]. */
function build(project, wires) {
  const comps = project.comps.map(c => ({ ...c, name: c.name || c.id, pins: Object.fromEntries(keys(c.type).map(k => [k, {}])), inp: { ...(c.inp || {}) } }));
  const by = Object.fromEntries(comps.map(c => [c.id, c]));
  return { comps, wires: wires.map(w => ({ a: { comp: by[w.a[0]], key: w.a[1] }, b: { comp: by[w.b[0]], key: w.b[1] }, progress: 1 })) };
}
function faults({ comps, wires }) {
  const A = analyze(comps, wires);
  const boardFor = c => { for (const k in c.pins) { const g = A.wnet({ comp: c, key: k }).gpio[0]; if (g) return g.comp; } return comps.find(x => boardOf(x)) || null; };
  return collectFaults(comps, wires, A, { dist: () => 0, boardFor });
}
const codes = m => faults(m).map(f => `${f.level}:${f.key}`).sort();

const SNAPSHOT = {
  '01-station-meteo.jollof': [],
  '02-led-bouton-breadboard.jollof': [],
  '03-radar-de-recul.jollof': [],
  '04-thermometre-ds18b20.jollof': [],
  '05-arrosage-automatique.jollof': [],
  '06-moteur-vitesse.jollof': [],
  '07-a-corriger.jollof': [
    'err:cap|dht22_1|DATA',
    'err:overvolt|bmp280_1|VCC',
    'err:reversed|led-green_1',
    'err:short-g|esp32_1|3V3|esp32_1|GND',
    'err:undervolt|hcsr04_1|VCC',
    'warn:pullup|ds18b20_1|DQ'
  ],
  '08-verin-electropneumatique.jollof': []
};

test('Instantané des erreurs : exemples, puis départ et solution de chaque TP', () => {
  const got = {};
  for (const f of fs.readdirSync(EX).filter(f => f.endsWith('.jollof')).sort()) {
    const d = JSON.parse(fs.readFileSync(new URL(f, EX), 'utf8'));
    got[f] = codes(build(d, d.wires));
  }
  assert.deepEqual(got, SNAPSHOT);
  // Un TP : rien au départ (non câblé, pas une faute), rien dans la solution.
  for (const f of fs.readdirSync(TP).filter(f => f.endsWith('.json')).sort()) {
    const tp = JSON.parse(fs.readFileSync(new URL(f, TP), 'utf8'));
    assert.deepEqual(codes(build(tp.start, [])), [], `${f} départ`);
    assert.deepEqual(codes(build(tp.start, tp.solution.wires || [])), [], `${f} solution`);
  }
});

/** Petit montage : add(type, id) puis fils [a, ka, b, kb]. */
function circuit(parts, wires) {
  return build({ comps: parts.map(([type, id]) => ({ id, type, name: id })) }, wires.map(([a, ka, b, kb]) => ({ a: [a, ka], b: [b, kb] })));
}
const ins = (m, id) => { const A = analyze(m.comps, m.wires), c = m.comps.find(x => x.id === id); return inspect(c, A, partOf(c)); };

test('LED alimentée par une pile ou par le 5 V à travers sa résistance : pas d’erreur (flags.direct)', () => {
  const bat = circuit([['bat9v', 'P'], ['res-1k', 'R'], ['led-red', 'L']], [['P', '+', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'P', '-']]);
  assert.deepEqual(codes(bat), []);
  const i = ins(bat, 'L');
  assert.equal(i.level, 'ok'); assert.equal(i.flags.direct, true);
  const five = circuit([['uno', 'U'], ['res-220', 'R'], ['led-green', 'L']], [['U', '5V', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'U', 'GND']]);
  assert.deepEqual(codes(five), []);
  // Sans résistance, directement sur l'alimentation : l'erreur reste.
  const raw = circuit([['uno', 'U'], ['led-red', 'L']], [['U', '5V', 'L', 'A'], ['L', 'K', 'U', 'GND']]);
  assert.deepEqual(codes(raw), ['err:topwr|L|A']);
  // Anode reliée à la masse à travers la résistance : toujours signalée.
  const lost = circuit([['uno', 'U'], ['res-220', 'R'], ['led-red', 'L']], [['U', 'GND', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'U', 'GND (2)']]);
  assert.deepEqual(codes(lost), ['err:nogpio|L|A']);
});

test('Transistor NPN : LED commutée par le collecteur (flags.switched), base sans résistance signalée', () => {
  const sw = circuit([['uno', 'U'], ['res-1k', 'R1'], ['res-220', 'R2'], ['led-red', 'L'], ['npn', 'Q']],
    [['U', 'D8', 'R1', '1'], ['R1', '2', 'Q', 'B'], ['U', '5V', 'R2', '1'], ['R2', '2', 'L', 'A'], ['L', 'K', 'Q', 'C'], ['Q', 'E', 'U', 'GND']]);
  assert.deepEqual(codes(sw), []);
  const l = ins(sw, 'L'), q = ins(sw, 'Q');
  assert.equal(l.flags.switched, true); assert.equal(l.flags.direct, true);
  assert.equal(q.level, 'ok'); assert.equal(q.board.id, 'U'); assert.equal(q.io.B.key, 'D8');
  assert.equal(q.pins.C.level, 'free');
  // Cathode sur autre chose qu'un collecteur : la masse manque toujours.
  const bad = circuit([['uno', 'U'], ['res-220', 'R2'], ['led-red', 'L'], ['npn', 'Q']], [['U', '5V', 'R2', '1'], ['R2', '2', 'L', 'A'], ['L', 'K', 'Q', 'B']]);
  assert.ok(codes(bad).includes('err:nognd|L|K'), codes(bad).join(' '));
  // Base directement sur la broche : avertissement, correction propre au transistor.
  const nb = circuit([['uno', 'U'], ['npn', 'Q']], [['U', 'D8', 'Q', 'B'], ['Q', 'E', 'U', 'GND']]);
  const f = faults(nb);
  assert.deepEqual(f.map(x => `${x.level}:${x.key}`), ['warn:nores|Q|B']);
  assert.match(f[0].fix, /1 kΩ/); assert.match(f[0].fix, /base/);
  assert.match(f[0].why, /base/);
  // Condensateurs : pattes expliquées, jamais en faute de câblage.
  const caps = circuit([['uno', 'U'], ['cap-100u', 'C1'], ['cap-100n', 'C2']], [['U', '5V', 'C1', '-'], ['C1', '+', 'U', 'GND'], ['U', '5V', 'C2', '1']]);
  assert.deepEqual(codes(caps), []);
});

test('Graphe des broches (adj) : liaisons internes, fils, bouton appuyé', () => {
  const m = circuit([['uno', 'U'], ['breadboard', 'BB'], ['button', 'B']], [['U', 'D2', 'BB', 'A10'], ['B', '1', 'BB', 'B10'], ['B', '2', 'U', 'GND']]);
  const A = analyze(m.comps, m.wires), bb = m.comps[1], btn = m.comps[2];
  const adj = A.adj(), nb = p => (adj.get(p) || []).map(e => e[0]);
  assert.equal(A.pid, pid);
  assert.equal(adj, A.adj()); // construit une fois
  assert.ok(nb(pid(bb, 'A10')).includes(pid(bb, 'B10')), 'bande de breadboard');
  assert.ok(nb(pid(m.comps[0], 'GND')).includes(pid(m.comps[0], 'GND (2)')), 'broches GND doublées');
  assert.ok(adj.get(pid(bb, 'A10')).some(e => e[1] === m.wires[0]), 'fil');
  assert.ok(!nb(pid(btn, '1')).includes(pid(btn, '2')), 'bouton relâché');
  btn.inp.pressed = true;
  const P = analyze(m.comps, m.wires);
  assert.ok(P.adj().get(pid(btn, '1')).some(e => e[0] === pid(btn, '2') && e[1] === null), 'bouton appuyé : liaison virtuelle');
  assert.deepEqual(P.path({ comp: m.comps[0], key: 'D2' }, { comp: m.comps[0], key: 'GND' }).length, 3);
});

test('Bouton : interrupteur sans carte, dans les deux sens, appuyé ou non ; court-circuit signalé', () => {
  const press = (m, on) => { m.comps.find(c => c.type === 'button').inp.pressed = on; return m; };
  const high = () => circuit([['bat9v', 'P'], ['button', 'S'], ['res-1k', 'R'], ['led-red', 'L']], [['P', '+', 'S', '1'], ['S', '2', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'P', '-']]);
  const low = () => circuit([['bat9v', 'P'], ['res-1k', 'R'], ['led-red', 'L'], ['button', 'S']], [['P', '+', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'S', '2'], ['S', '1', 'P', '-']]);
  for (const mk of [high, low]) for (const on of [false, true]) {
    const m = press(mk(), on);
    assert.deepEqual(codes(m), [], `${mk.name} appuyé=${on}`);
    assert.equal(ins(m, 'S').flags.inline, true);
    assert.equal(ins(m, 'L').level, 'ok');
  }
  // Bouton seul entre le + et le − : appuyer met la pile en court-circuit.
  const sh = circuit([['bat9v', 'P'], ['button', 'S']], [['P', '+', 'S', '2'], ['S', '1', 'P', '-']]);
  assert.deepEqual(codes(sh), ['err:swshort|S|2']);
  // Pas d'étincelles tant qu'on n'appuie pas ; « Retirer le fil » débranche le côté masse.
  const fs0 = faults(sh)[0];
  assert.equal(fs0.fx, null); assert.ok(fs0.actions.includes('cut'));
  assert.equal(fs0.cutWire, sh.wires[1]); assert.equal(fs0.other.key, '1');
  // Une seule patte reliée, du côté du + : il manque le retour vers la masse.
  const half = circuit([['bat9v', 'P'], ['button', 'S'], ['led-red', 'L']], [['P', '+', 'S', '1'], ['L', 'K', 'P', '-']]);
  assert.ok(codes(half).includes('warn:nognd|S|2'), codes(half).join(' '));
});

test('Bouton sur une carte : monté dans l’autre sens, ou vers le 5 V avec résistance de rappel', () => {
  // Sens inverse : patte 2 sur l'entrée, patte 1 à la masse.
  const rev = circuit([['uno', 'U'], ['button', 'B']], [['U', 'D2', 'B', '2'], ['B', '1', 'U', 'GND']]);
  assert.deepEqual(codes(rev), []);
  const r = ins(rev, 'B');
  assert.equal(r.io['2'].key, 'D2'); assert.equal(r.io['1'], undefined); assert.ok(!r.flags.activeHigh);
  // Montage de l'exemple Arduino « Button » : 5 V → bouton → D2, 10 kΩ de D2 à la masse. Appuyé = HIGH.
  const pd = circuit([['uno', 'U'], ['button', 'B'], ['res-10k', 'R']], [['U', '5V', 'B', '1'], ['B', '2', 'U', 'D2'], ['U', 'D2', 'R', '1'], ['R', '2', 'U', 'GND']]);
  for (const on of [false, true]) { pd.comps[1].inp.pressed = on; assert.deepEqual(codes(pd), [], `appuyé=${on}`); }
  const p = ins(pd, 'B');
  assert.equal(p.flags.activeHigh, true); assert.equal(p.io['2'].key, 'D2'); assert.equal(p.board.id, 'U');
  // Sans la résistance de rappel : l'entrée flotte au repos.
  const fl = circuit([['uno', 'U'], ['button', 'B']], [['U', '5V', 'B', '1'], ['B', '2', 'U', 'D2']]);
  assert.deepEqual(codes(fl), ['warn:pulldown|B|2']);
  const pf = faults(fl)[0];
  assert.ok(pf.actions.includes('tognd')); assert.equal(pf.other.key, '1');
  // Corrigé comme le fait « Relier à la masse » : l'autre patte passe du 5 V à GND, plus rien à signaler.
  const fixed = circuit([['uno', 'U'], ['button', 'B']], [['U', 'GND', 'B', '1'], ['B', '2', 'U', 'D2']]);
  assert.deepEqual(codes(fixed), []); assert.ok(!ins(fixed, 'B').flags.activeHigh);
  // 5 V sur une carte 3,3 V : avertissement de niveau.
  const esp = circuit([['esp32', 'E'], ['button', 'B'], ['res-10k', 'R']], [['E', 'VIN', 'B', '1'], ['B', '2', 'E', 'D4'], ['E', 'D4', 'R', '1'], ['R', '2', 'E', 'GND']]);
  assert.ok(codes(esp).includes('warn:lv5|B|2'), codes(esp).join(' '));
  const lf = faults(esp).find(f => f.code === 'lv5');
  assert.ok(lf.actions.includes('to3v3')); assert.match(lf.fix, /3V3/);
  const esp3 = circuit([['esp32', 'E'], ['button', 'B'], ['res-10k', 'R']], [['E', '3V3', 'B', '1'], ['B', '2', 'E', 'D4'], ['E', 'D4', 'R', '1'], ['R', '2', 'E', 'GND']]);
  assert.deepEqual(codes(esp3), []);
  // Deux boutons sur la même entrée, l'un appuyé : aucun des deux n'est « relié à la masse ».
  const two = circuit([['uno', 'U'], ['breadboard', 'BB'], ['button', 'B1'], ['button', 'B2']],
    [['U', 'D2', 'BB', 'A10'], ['B1', '1', 'BB', 'B10'], ['B2', '1', 'BB', 'C10'], ['B1', '2', 'U', 'GND'], ['B2', '2', 'U', 'GND (2)']]);
  two.comps[2].inp.pressed = true;
  assert.deepEqual(codes(two), []);
  // Entrée reliée directement au 5 V, bouton vers la masse : appuyer ferait un court-circuit, toujours signalé.
  const tp = circuit([['uno', 'U'], ['breadboard', 'BB'], ['button', 'B']], [['U', 'D2', 'BB', 'A10'], ['B', '1', 'BB', 'B10'], ['BB', 'C10', 'U', '5V'], ['B', '2', 'U', 'GND']]);
  assert.deepEqual(codes(tp), ['err:topwr|B|1']);
});
