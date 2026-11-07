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
