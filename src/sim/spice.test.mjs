// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Le solveur (dc.js) comparé à ngspice, le simulateur de circuits de référence (étape 4.1 de la feuille de route) :
//   - mêmes modèles par morceaux (« pwl ») : ngspice doit retrouver chaque tension au millivolt près, ce qui vérifie
//     le calcul lui-même (états des diodes, sources, régulateur, transistors, matrice) ;
//   - modèles physiques de ngspice (« phys ») : l'écart borne l'erreur des modèles simplifiés (seuils des LED,
//     Vbe fixe…), résumée en fin de test et dans docs/PROVEN.md.
// Montages : les projets d'exemple, des montages types (LED, bouton, pont diviseur, transistor, régulateur,
// diode) et 60 montages tirés au hasard. ngspice tourne ici compilé en WebAssembly (paquet eecircuit-engine, le
// même moteur que le mode analogique de l'application). node --test src/sim/spice.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boardOf } from './boards.js';
import { analyze } from './circuit.js';
import { solveDC, spiceDeck } from './dc.js';
import { loadProject } from '../check/load.js';

let engine = null;
/** Tensions des nœuds calculées par ngspice (analyse .op). */
async function ngspice(text) {
  if (!engine) { const { Simulation } = await import('eecircuit-engine'); engine = new Simulation(); await engine.start(); }
  engine.setNetList(text);
  const r = await engine.runSim(), v = new Map();
  for (const d of r.data) { const m = /^v\((n\d+)\)$/.exec(d.name); if (m) v.set(m[1], d.values[0]); }
  return { v, log: engine.getError().join('\n') };
}

/** Compare dc.js et ngspice sur un montage ; rend les écarts { worst, n } et les écarts trop grands. */
async function compare(comps, wires, ctx, mode, tol) {
  const A = analyze(comps, wires), deck = spiceDeck(comps, A, ctx, mode);
  if (!deck) return null;
  const dc = solveDC(comps, A, ctx), sp = await ngspice(deck.text);
  let worst = 0, n = 0;
  const bad = [];
  for (const p of deck.probes) {
    const a = dc.volts(p.ref), b = sp.v.get(p.node);
    if (a == null || b == null) continue;
    // Modèles physiques : un nœud que presque aucun courant ne traverse (derrière un transistor bloqué, une LED
    // éteinte) n'a pas de tension définie, elle dépend des fuites de chaque modèle. Seuls comptent les nœuds actifs.
    if (mode === 'phys') {
      const cur = p.members.map(m => dc.current(m.comp)).filter(x => x != null);
      if (cur.length && cur.every(x => Math.abs(x) < 0.01)) continue;
    }
    const d = Math.abs(a - b); n++;
    if (d > worst) worst = d;
    if (d > tol(a, b)) bad.push(`${p.ref.comp.id}.${p.ref.key} : dc.js ${a.toFixed(4)} V, ngspice ${b.toFixed(4)} V`);
  }
  if (!sp.v.size && deck.probes.length) bad.push('ngspice sans résultat :\n' + sp.log.slice(0, 600));
  return { worst, n, bad, deck };
}

/* ---------- Montages ---------- */
const LEGS = { diode: ['A', 'K'], 'cap-100n': ['1', '2'], 'cap-100u': ['+', '-'], npn: ['C', 'B', 'E'], lm7805: ['IN', 'GND', 'OUT'], bat9v: ['+', '-'], bat18650: ['+', '-'] };
function bench() {
  const data = { comps: [], wires: [] };
  return {
    data,
    add(type, inp) { const id = `${type}_${data.comps.length}`; data.comps.push({ id, type, inp }); return id; },
    wire(a, ka, b, kb) { data.wires.push({ a: [a, ka], b: [b, kb] }); },
    load() { return loadProject(data); }
  };
}
const OUT = d => ({ mode: 1, d, pwm: null }), PULL = { mode: 2, d: 0, pwm: null };
const ctxOf = (pins = {}) => ({ prof: boardOf, pinState: (c, k) => (boardOf(c) ? pins[k] || null : null), sensorVolts: () => null });

function circuits() {
  const list = [];
  // LED et résistance sur une sortie, au niveau haut et bas.
  for (const [led, res] of [['led-red', 'res-220'], ['led-blue', 'res-330'], ['led-green', 'res-1k']]) for (const d of [1, 0]) {
    const b = bench(), u = b.add('uno'), r = b.add(res), l = b.add(led);
    b.wire(u, 'D7', r, '1'); b.wire(r, '2', l, 'A'); b.wire(l, 'K', u, 'GND');
    list.push({ name: `${led} ${res} D7=${d}`, ...b.load(), ctx: ctxOf({ D7: OUT(d) }) });
  }
  // Bouton avec tirage interne, ouvert et fermé.
  for (const pressed of [false, true]) {
    const b = bench(), u = b.add('uno'), k = b.add('button', { pressed });
    b.wire(u, 'D2', k, '1'); b.wire(k, '2', u, 'GND');
    list.push({ name: `bouton ${pressed ? 'appuyé' : 'relâché'}`, ...b.load(), ctx: ctxOf({ D2: PULL }) });
  }
  // Pont diviseur 10 k / 4,7 k sur 5 V, lu par A0.
  { const b = bench(), u = b.add('uno'), r1 = b.add('res-10k'), r2 = b.add('res-4k7');
    b.wire(u, '5V', r1, '1'); b.wire(r1, '2', r2, '1'); b.wire(r2, '2', u, 'GND'); b.wire(r1, '2', u, 'A0');
    list.push({ name: 'pont diviseur', ...b.load(), ctx: ctxOf() }); }
  // Transistor NPN : buzzer et LED commandés par la base (bloqué, saturé), puis base trop faible (linéaire).
  for (const [res, d] of [['res-1k', 1], ['res-1k', 0], ['res-10k', 1]]) {
    const b = bench(), u = b.add('uno'), rb = b.add(res), q = b.add('npn'), rl = b.add('res-220'), l = b.add('led-red'), rc = b.add('res-22');
    b.wire(u, 'D9', rb, '1'); b.wire(rb, '2', q, 'B'); b.wire(q, 'E', u, 'GND');
    b.wire(u, '5V', rl, '1'); b.wire(rl, '2', l, 'A'); b.wire(l, 'K', rc, '1'); b.wire(rc, '2', q, 'C');
    list.push({ name: `NPN base ${res} D9=${d}`, ...b.load(), ctx: ctxOf({ D9: OUT(d) }) });
  }
  // Pile 9 V, régulateur LM7805, deux LED ; diode 1N4007 en série.
  { const b = bench(), bat = b.add('bat9v'), reg = b.add('lm7805'), d = b.add('diode'), r1 = b.add('res-330'), l1 = b.add('led-yellow'), r2 = b.add('res-1k'), l2 = b.add('led-white');
    b.wire(bat, '+', d, 'A'); b.wire(d, 'K', reg, 'IN'); b.wire(bat, '-', reg, 'GND');
    b.wire(reg, 'OUT', r1, '1'); b.wire(r1, '2', l1, 'A'); b.wire(l1, 'K', reg, 'GND');
    b.wire(reg, 'OUT', r2, '1'); b.wire(r2, '2', l2, 'A'); b.wire(l2, 'K', reg, 'GND');
    list.push({ name: 'pile, diode, LM7805, deux LED', ...b.load(), ctx: ctxOf() }); }
  // Montages au hasard (graine fixe) : résistances, LED et diodes entre 5V, 3V3, GND et des sorties de l'Uno.
  let s = 12345;
  const rnd = n => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % n; };
  const RES = ['res-220', 'res-330', 'res-1k', 'res-4k7', 'res-10k'], TWO = [...RES, ...RES, 'led-red', 'led-green', 'led-blue', 'diode'];
  for (let k = 0; k < 60; k++) {
    const b = bench(), u = b.add('uno'), pins = {}, nodes = [[u, '5V'], [u, 'GND'], [u, '3V3']];
    for (const p of ['D3', 'D4', 'D5']) if (rnd(2)) { pins[p] = OUT(rnd(2)); nodes.push([u, p]); }
    const parts = [];
    for (let j = 0, m = 3 + rnd(6); j < m; j++) {
      const t = TWO[rnd(TWO.length)], id = b.add(t), [ka, kb] = /^res-/.test(t) ? ['1', '2'] : t === 'diode' ? ['A', 'K'] : ['A', 'K'];
      parts.push([id, ka, kb]);
    }
    // Chaque patte reliée à un nœud existant ou à une patte d'un autre composant (un fil par broche suffit ici).
    const ends = parts.flatMap(([id, ka, kb]) => [[id, ka], [id, kb]]);
    for (const e of ends) { const to = nodes[rnd(nodes.length)]; b.wire(e[0], e[1], to[0], to[1]); if (rnd(3) === 0) nodes.push(e); }
    list.push({ name: `hasard ${k}`, ...b.load(), ctx: ctxOf(pins) });
  }
  // Projets d'exemple, sans programme (broches en haute impédance).
  const EX = new URL('../../exemples/', import.meta.url);
  for (const f of fs.readdirSync(EX).filter(f => f.endsWith('.jollof'))) list.push({ name: f, ...loadProject(JSON.parse(fs.readFileSync(new URL(f, EX), 'utf8'))), ctx: ctxOf() });
  return list;
}

test('dc.js et ngspice, mêmes modèles : mêmes tensions au millivolt près', async () => {
  const bad = [];
  let nodes = 0, worst = 0, runs = 0;
  for (const c of circuits()) {
    const r = await compare(c.comps, c.wires, c.ctx, 'pwl', () => 0.012);
    if (!r) continue;
    runs++; nodes += r.n; worst = Math.max(worst, r.worst);
    if (r.bad.length) bad.push(`${c.name}\n  ${r.bad.join('\n  ')}`);
  }
  console.log(`# pwl : ${runs} montages, ${nodes} nœuds, écart maximal ${(worst * 1000).toFixed(2)} mV`);
  assert.deepEqual(bad, [], bad.join('\n'));
  assert.ok(runs >= 70 && nodes >= 250, `${runs} montages, ${nodes} nœuds`);
});

test('dc.js et ngspice, modèles physiques : erreur des modèles simplifiés bornée', async () => {
  const bad = [], errs = [];
  for (const c of circuits()) {
    // Erreur admise : 0,35 V (seuil fixe d'une LED ou Vbe fixe contre exponentielle : l'écart grandit aux faibles
    // courants, où une LED réelle s'allume sous son seuil nominal), ou 8 % de la tension.
    const r = await compare(c.comps, c.wires, c.ctx, 'phys', (a, b) => Math.max(0.35, 0.08 * Math.max(Math.abs(a), Math.abs(b))));
    if (!r) continue;
    errs.push(r.worst);
    if (r.bad.length) bad.push(`${c.name}\n  ${r.bad.join('\n  ')}`);
  }
  errs.sort((a, b) => a - b);
  const q = p => errs[Math.min(errs.length - 1, Math.floor(p * errs.length))];
  console.log(`# phys : ${errs.length} montages, écart par montage : médiane ${(q(0.5) * 1000).toFixed(0)} mV, 90 % ${(q(0.9) * 1000).toFixed(0)} mV, max ${(errs[errs.length - 1] * 1000).toFixed(0)} mV`);
  assert.deepEqual(bad, [], bad.join('\n'));
});

/* ---------- Composants analogiques (étape 3.2) : ampli-op, bobine, MOSFET, NE555, générateur ---------- */
function analogCircuits() {
  const list = [], GEN = off => ({ wave: 'dc', off });
  // LM358 non inverseur, gain 1 + R2 / R1, en linéaire puis saturé en haut et en bas.
  for (const [r2t, off] of [['res-10k', 1], ['res-4k7', 1.2], ['res-10k', 2.4], ['res-10k', -0.3]]) {
    const b = bench(), u = b.add('uno'), op = b.add('lm358'), g = b.add('siggen', GEN(off)), r1 = b.add('res-10k'), r2 = b.add(r2t), rl = b.add('res-1k');
    b.wire(op, 'VCC', u, '5V'); b.wire(op, 'GND', u, 'GND'); b.wire(g, 'GND', u, 'GND (2)'); b.wire(g, 'OUT', op, '1IN+');
    b.wire(op, '1IN-', r1, '1'); b.wire(r1, '2', u, 'GND (3)'); b.wire(op, '1OUT', r2, '1'); b.wire(r2, '2', op, '1IN-'); b.wire(rl, '1', op, '1OUT'); b.wire(rl, '2', u, 'GND (4)');
    list.push({ name: `LM358 non inverseur ${r2t} ${off} V`, ...b.load(), ctx: ctxOf() });
  }
  // LM358 inverseur autour de 3,3 V / 2 (alimentation simple), sur l'ampli B.
  for (const off of [1.4, 1.65, 1.9]) {
    const b = bench(), u = b.add('uno'), op = b.add('lm358'), g = b.add('siggen', GEN(off)), ra = b.add('res-10k'), rb = b.add('res-10k'), r1 = b.add('res-1k'), r2 = b.add('res-4k7');
    b.wire(op, 'VCC', u, '5V'); b.wire(op, 'GND', u, 'GND'); b.wire(g, 'GND', u, 'GND (2)'); b.wire(ra, '1', u, '3V3'); b.wire(ra, '2', op, '2IN+'); b.wire(rb, '1', op, '2IN+'); b.wire(rb, '2', u, 'GND (3)');
    b.wire(g, 'OUT', r1, '1'); b.wire(r1, '2', op, '2IN-'); b.wire(r2, '1', op, '2IN-'); b.wire(r2, '2', op, '2OUT');
    list.push({ name: `LM358 inverseur ${off} V`, ...b.load(), ctx: ctxOf() });
  }
  // Suiveur dont l'entrée dépasse la plage de mode commun (V+ − 1,5 V).
  { const b = bench(), u = b.add('uno'), op = b.add('lm358'), g = b.add('siggen', GEN(4.4)), rl = b.add('res-10k');
    b.wire(op, 'VCC', u, '5V'); b.wire(op, 'GND', u, 'GND'); b.wire(g, 'GND', u, 'GND (2)'); b.wire(g, 'OUT', op, '1IN+'); b.wire(op, '1OUT', op, '1IN-'); b.wire(rl, '1', op, '1OUT'); b.wire(rl, '2', u, 'GND (3)');
    list.push({ name: 'LM358 suiveur hors plage', ...b.load(), ctx: ctxOf() }); }
  // Bobine en série avec une résistance (en continu : un fil de 24 Ω).
  for (const r of ['res-22', 'res-220']) {
    const b = bench(), g = b.add('siggen', GEN(5)), rr = b.add(r), l = b.add('ind-10m');
    b.wire(g, 'OUT', rr, '1'); b.wire(rr, '2', l, '1'); b.wire(l, '2', g, 'GND');
    list.push({ name: `générateur, ${r}, bobine 10 mH`, ...b.load(), ctx: ctxOf() });
  }
  // IRLZ44N commandé par une sortie 5 V et 3,3 V (pile 9 V, charge 22 Ω et diode de roue libre), bloqué et passant.
  for (const [board, pin] of [['uno', 'D9'], ['esp32', 'D13'], ['pico', 'GP15']]) for (const d of [1, 0]) {
    const b = bench(), u = b.add(board), q = b.add('irlz44n'), rg = b.add('res-220'), rp = b.add('res-10k'), rl = b.add('res-22'), bat = b.add('bat9v'), fd = b.add('diode');
    b.wire(u, pin, rg, '1'); b.wire(rg, '2', q, 'G'); b.wire(rp, '1', q, 'G'); b.wire(rp, '2', u, 'GND'); b.wire(q, 'S', u, 'GND (2)'); b.wire(bat, '-', u, 'GND (3)');
    b.wire(bat, '+', rl, '1'); b.wire(rl, '2', q, 'D'); b.wire(fd, 'A', q, 'D'); b.wire(fd, 'K', bat, '+');
    list.push({ name: `IRLZ44N ${board} ${pin}=${d}`, ...b.load(), ctx: ctxOf({ [pin]: OUT(d) }) });
  }
  // NE555 en astable (LED sur la sortie), dans chacun des deux états de sa bascule.
  for (const q of [0, 1]) {
    const b = bench(), u = b.add('uno'), t = b.add('ne555'), ra = b.add('res-1k'), rb = b.add('res-10k'), c = b.add('cap-100n'), rl = b.add('res-330'), l = b.add('led-green');
    b.wire(t, 'VCC', u, '5V'); b.wire(t, 'RESET', t, 'VCC'); b.wire(t, 'GND', u, 'GND'); b.wire(ra, '1', t, 'VCC'); b.wire(ra, '2', t, 'DIS'); b.wire(rb, '1', t, 'DIS'); b.wire(rb, '2', t, 'THR');
    b.wire(t, 'TRIG', t, 'THR'); b.wire(c, '1', t, 'TRIG'); b.wire(c, '2', u, 'GND (2)'); b.wire(t, 'OUT', rl, '1'); b.wire(rl, '2', l, 'A'); b.wire(l, 'K', u, 'GND (3)');
    const L = b.load(); L.byId[t].timerQ = q;
    list.push({ name: `NE555 astable, sortie ${q ? 'haute' : 'basse'}`, ...L, ctx: ctxOf() });
  }
  return list;
}

test('Composants analogiques : dc.js et ngspice d’accord (mêmes modèles au millivolt, macro-modèles bornés)', async () => {
  const bad = [];
  let nodes = 0, worstPwl = 0, worstPhys = 0, runs = 0;
  for (const c of analogCircuits()) {
    const r = await compare(c.comps, c.wires, c.ctx, 'pwl', () => 0.012), p = await compare(c.comps, c.wires, c.ctx, 'phys', (a, b) => Math.max(0.35, 0.08 * Math.max(Math.abs(a), Math.abs(b))));
    assert.ok(r && p, c.name);
    runs++; nodes += r.n; worstPwl = Math.max(worstPwl, r.worst); worstPhys = Math.max(worstPhys, p.worst);
    if (r.bad.length) bad.push(`${c.name} (pwl)\n  ${r.bad.join('\n  ')}`);
    if (p.bad.length) bad.push(`${c.name} (phys)\n  ${p.bad.join('\n  ')}`);
  }
  console.log(`# analogique : ${runs} montages, ${nodes} nœuds, pwl ${(worstPwl * 1000).toFixed(2)} mV, phys ${(worstPhys * 1000).toFixed(0)} mV au plus`);
  assert.deepEqual(bad, [], bad.join('\n'));
  assert.ok(runs >= 17 && nodes >= 80, `${runs} montages, ${nodes} nœuds`);
});

test('Ampli-op : gains mesurés par dc.js et par le macro-modèle de ngspice', async () => {
  // Non inverseur 1 + 4,7 k / 10 k = 1,47 ; inverseur −4,7 k / (1 k + 50 Ω du générateur) autour de 1,65 V.
  const [ni] = analogCircuits().filter(c => c.name === 'LM358 non inverseur res-4k7 1.2 V'), inv = analogCircuits().filter(c => /^LM358 inverseur/.test(c.name));
  const out = async (c, key) => { const A = analyze(c.comps, c.wires), d = spiceDeck(c.comps, A, c.ctx, 'phys'), sp = await ngspice(d.text), op = c.comps.find(x => x.type === 'lm358');
    const p = d.probes.find(x => x.members.some(m => m.comp === op && m.key === key)); return [solveDC(c.comps, A, c.ctx).volts({ comp: op, key }), sp.v.get(p.node)]; };
  const [a, b] = await out(ni, '1OUT');
  assert.ok(Math.abs(a - 1.2 * 1.47) < 0.005 && Math.abs(b - 1.2 * 1.47) < 0.005, `non inverseur : ${a} / ${b}`);
  const pts = [];
  for (const c of inv) { const g = c.comps.find(x => x.type === 'siggen').inp.off; pts.push([g, ...(await out(c, '2OUT'))]); }
  const gain = (k) => (pts[2][k] - pts[0][k]) / (pts[2][0] - pts[0][0]);
  assert.ok(Math.abs(gain(1) + 4700 / 1050) < 0.02, `gain dc.js ${gain(1)}`);
  assert.ok(Math.abs(gain(2) + 4700 / 1050) < 0.02, `gain ngspice ${gain(2)}`);
});

test('Transitoire ngspice : bobine (τ = L / R) et NE555 astable (f = 1,44 / ((RA + 2 RB) C))', async () => {
  const { transient } = await import('./analog.js');
  const [rl] = analogCircuits().filter(c => c.name === 'générateur, res-220, bobine 10 mH');
  const g = rl.comps.find(c => c.type === 'siggen'), L = rl.comps.find(c => c.type === 'ind-10m'), R = rl.comps.find(c => c.type === 'res-220');
  g.inp = { wave: 'square', freq: 1000, amp: 2.5, off: 2.5 };
  const r = await transient(rl.comps, analyze(rl.comps, rl.wires), rl.ctx, { tstop: 5e-4, tstep: 1e-6 });
  // Courant de la bobine lu sur la résistance : (V(R.1) − V(R.2)) / 220 (L.2 est la masse du générateur).
  const vr = r.volts({ comp: R, key: '2' }), v1 = r.volts({ comp: R, key: '1' }), tau = 0.01 / (50 + 220 + 24), Iinf = 5 / (50 + 220 + 24);
  assert.ok(L && vr && v1, 'points relevés');
  let worst = 0;
  for (let i = 0; i < r.t.length; i++) if (r.t[i] > 5e-6 && r.t[i] < 4.9e-4) worst = Math.max(worst, Math.abs((v1[i] - vr[i]) / 220 - Iinf * (1 - Math.exp(-r.t[i] / tau))));
  assert.ok(worst < 0.03 * Iinf, `RL : écart ${worst * 1000} mA, τ = ${tau * 1e6} µs`);
  const [as] = analogCircuits().filter(c => /NE555 astable, sortie basse/.test(c.name)), t = as.comps.find(c => c.type === 'ne555');
  t.timerQ = undefined;
  const tr = await transient(as.comps, analyze(as.comps, as.wires), as.ctx, { tstop: 0.012, tstep: 1e-5 }), o = tr.volts({ comp: t, key: 'OUT' }), th = tr.volts({ comp: t, key: 'THR' });
  const rises = [];
  for (let i = 1; i < tr.t.length; i++) if (o[i] > 2 && o[i - 1] <= 2) rises.push(tr.t[i]);
  const f = (rises.length - 2) / (rises[rises.length - 1] - rises[1]), want = 1.44 / ((1000 + 20000) * 100e-9);
  console.log(`# NE555 transitoire : ${f.toFixed(1)} Hz (formule ${want.toFixed(1)} Hz) ; RL : écart ${(worst * 1e3).toFixed(3)} mA`);
  assert.ok(Math.abs(f - want) < 0.04 * want, `NE555 : ${f} Hz au lieu de ${want}`);
  const late = th.filter((v, i) => tr.t[i] > 0.004);
  assert.ok(Math.abs(Math.min(...late) - 5 / 3) < 0.1 && Math.abs(Math.max(...late) - 10 / 3) < 0.1, 'condensateur entre 1/3 et 2/3 de VCC');
});
