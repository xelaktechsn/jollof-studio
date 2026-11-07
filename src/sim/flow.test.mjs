// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du courant dans les fils (flow.js) : node --test src/sim/flow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BOARDS, boardOf } from './boards.js';
import { PARTS } from './parts.js';
import { analyze, bbGroups, pid } from './circuit.js';
import { solveDC } from './dc.js';
import { wireFlows } from './flow.js';

const EX = new URL('../../exemples/', import.meta.url);
const LEGS = { 'cap-100u': ['+', '-'], npn: ['C', 'B', 'E'], bat9v: ['+', '-'] };
const keys = type => {
  const prof = BOARDS[type];
  if (prof) return [...Object.keys(prof.gpio), ...Object.keys(prof.power), 'GND', 'GND (2)', 'GND (3)', 'VIN'];
  if (/^breadboard/.test(type)) return bbGroups({ type }).flatMap(g => g.keys);
  if (/^res-/.test(type)) return ['1', '2'];
  if (LEGS[type]) return LEGS[type];
  return (PARTS[type] && PARTS[type].pins || []).map(p => p.pin);
};
const make = (type, id, inp) => ({ id, type, name: id, pins: Object.fromEntries(keys(type).map(k => [k, {}])), inp: { ...(inp || {}) } });
function bench() {
  const comps = [], wires = [];
  return {
    comps, wires,
    add(type, inp) { const c = make(type, type + '_' + comps.length, inp); comps.push(c); return c; },
    wire(a, ka, b, kb, progress = 1) { const w = { a: { comp: a, key: ka }, b: { comp: b, key: kb }, progress }; wires.push(w); return w; },
    flows(ctx) { const A = analyze(comps, wires), dc = solveDC(comps, A, ctx); return { A, dc, f: wireFlows(A, dc, wires) }; }
  };
}
const ctxOf = (pins = {}) => ({ prof: boardOf, pinState: (c, k) => (boardOf(c) ? pins[k] || null : null), sensorVolts: () => null });
const OUT = d => ({ mode: 1, d, pwm: null });
const near = (got, want, tol, what) => assert.ok(got != null && Math.abs(got - want) <= tol, `${what} : ${got} au lieu de ${want} ± ${tol}`);

/** Loi des nœuds à chaque broche : ce qu'elle injecte repart par ses fils. */
function kcl(dc, wires, f, tol = 1e-4) {
  const inj = dc.injections(), bal = new Map(inj);
  for (const w of wires) {
    const o = f.get(w); if (!o) continue;
    const a = pid(w.a.comp, w.a.key), b = pid(w.b.comp, w.b.key);
    bal.set(a, (bal.get(a) || 0) - o.mA); bal.set(b, (bal.get(b) || 0) + o.mA);
  }
  for (const [p, x] of bal) near(x, 0, tol, `loi des nœuds en ${p}`);
}

test('Série pile → R → LED : chaque fil porte le courant de la résistance, signé de + vers −', () => {
  const b = bench(), bat = b.add('bat9v'), r = b.add('res-1k'), l = b.add('led-red');
  const w1 = b.wire(bat, '+', r, '1'), w2 = b.wire(l, 'A', r, '2'), w3 = b.wire(l, 'K', bat, '-'); // w2 tracé à rebours
  const { dc, f } = b.flows(ctxOf()), I = dc.current(r);
  assert.ok(I > 6, `${I} mA`);
  near(f.get(w1).mA, I, 1e-4, '+ → R');
  near(f.get(w2).mA, -I, 1e-4, 'LED.A ← R : négatif, tracé contre le courant');
  near(f.get(w3).mA, I, 1e-4, 'K → −');
  near(f.get(w1).v, dc.volts({ comp: bat, key: '+' }), 1e-9, 'potentiel du fil');
  near(f.get(w3).v, 0, 1e-9, 'potentiel du −');
  kcl(dc, b.wires, f);
});

test('Loi des nœuds à chaque broche : deux LED en parallèle et un pont diviseur', () => {
  const b = bench(), u = b.add('uno'), r = b.add('res-220'), l1 = b.add('led-red'), l2 = b.add('led-red'), r2 = b.add('res-10k'), r3 = b.add('res-4k7');
  b.wire(u, 'D7', r, '1'); b.wire(r, '2', l1, 'A'); b.wire(r, '2', l2, 'A'); b.wire(l1, 'K', u, 'GND'); b.wire(l2, 'K', u, 'GND');
  b.wire(u, '5V', r2, '1'); b.wire(r2, '2', r3, '1'); b.wire(r3, '2', u, 'GND');
  const { dc, f } = b.flows(ctxOf({ D7: OUT(1) }));
  kcl(dc, b.wires, f);
  near(f.get(b.wires[1]).mA + f.get(b.wires[2]).mA, dc.current(r), 1e-4, 'les deux branches se partagent le courant');
  near(f.get(b.wires[1]).mA, dc.leds.get(l1).mA, 1e-4, 'branche 1');
  near(f.get(b.wires[6]).mA, 5 / 14.7, 1e-3, 'pont diviseur');
});

test('Boucle : deux fils en parallèle, l’un porte tout, l’autre 0 ; triangle de fils, une arête à 0', () => {
  const b = bench(), bat = b.add('bat9v'), r = b.add('res-1k'), l = b.add('led-red');
  b.wire(bat, '+', r, '1'); const p1 = b.wire(r, '2', l, 'A'), p2 = b.wire(r, '2', l, 'A'); b.wire(l, 'K', bat, '-');
  const { dc, f } = b.flows(ctxOf()), I = dc.current(r);
  near(f.get(p1).mA + f.get(p2).mA, I, 1e-4, 'somme');
  assert.ok(f.get(p1).mA === 0 || f.get(p2).mA === 0, 'une arête hors de l’arbre');
  kcl(dc, b.wires, f);
  // Triangle : bat + → R.1, R.1 → LED.K… non : trois fils entre les broches d'un même nœud.
  const t = bench(), u = t.add('uno'), ra = t.add('res-1k'), rb = t.add('res-1k');
  t.wire(u, '5V', ra, '1'); t.wire(ra, '1', rb, '1'); t.wire(rb, '1', u, '5V'); // 5V, ra.1, rb.1 en triangle
  t.wire(ra, '2', u, 'GND'); t.wire(rb, '2', u, 'GND');
  const g = t.flows(ctxOf()), tri = t.wires.slice(0, 3).map(w => g.f.get(w).mA);
  assert.equal(tri.filter(x => x === 0).length, 1, `une arête du triangle à 0 : ${tri}`);
  kcl(g.dc, t.wires, g.f);
});

test('Breadboard (exemple 02) : le courant suit les bandes et le pont entre les rails', () => {
  const d = JSON.parse(fs.readFileSync(new URL('02-led-bouton-breadboard.jollof', EX), 'utf8'));
  const comps = d.comps.map(c => make(c.type, c.id, c.inp)), by = Object.fromEntries(comps.map(c => [c.id, c]));
  const wires = d.wires.map(w => ({ a: { comp: by[w.a[0]], key: w.a[1] }, b: { comp: by[w.b[0]], key: w.b[1] }, progress: 1 }));
  const A = analyze(comps, wires), dc = solveDC(comps, A, ctxOf({ D7: OUT(1), D2: { mode: 2, d: 0, pwm: null } })), f = wireFlows(A, dc, wires);
  const I = dc.leds.get(by['led-red_1']).mA, of = (a, k) => f.get(wires.find(w => w.a.comp.id === a && w.a.key === k)).mA;
  near(of('uno_1', 'D7'), I, 1e-4, 'D7 → R');
  near(of('led-red_1', 'K'), I, 1e-4, 'K → rail');
  near(of('breadboard_1', 'T-25'), -I, 1e-4, 'pont entre les rails, du rail du bas vers celui du haut');
  near(of('uno_1', 'GND (2)'), -I, 1e-4, 'retour vers GND (2)');
  near(of('uno_1', 'D2'), 0, 1e-4, 'bouton relâché');
  // Bouton appuyé : le tirage de D2 passe par le bouton (liaison virtuelle 1–2 du graphe).
  by.button_1.inp.pressed = true;
  const A2 = analyze(comps, wires), dc2 = solveDC(comps, A2, ctxOf({ D2: { mode: 2, d: 0, pwm: null } })), f2 = wireFlows(A2, dc2, wires);
  const ip = 5 / 35e3 * 1000, of2 = (a, k) => f2.get(wires.find(w => w.a.comp.id === a && w.a.key === k)).mA;
  near(of2('uno_1', 'D2'), ip, 1e-3, 'D2 → bouton');
  near(of2('button_1', '2'), ip, 1e-3, 'bouton → rail');
});

test('Fils en cours de tracé ignorés ; sans calcul, courant nul', () => {
  const b = bench(), bat = b.add('bat9v'), r = b.add('res-1k');
  const w1 = b.wire(bat, '+', r, '1'), w2 = b.wire(r, '2', bat, '-', 0.5);
  const { A, dc, f } = b.flows(ctxOf());
  assert.equal(f.has(w2), false);
  assert.equal(f.get(w1).mA, 0); // circuit ouvert
  const none = wireFlows(A, { ok: false }, b.wires);
  assert.deepEqual(none.get(w1), { mA: 0, v: null });
  assert.equal(wireFlows(A, null, []).size, 0);
  assert.ok(dc.ok);
});

test('Performance : exemple 01, < 0,5 ms par calcul des courants', t => {
  const d = JSON.parse(fs.readFileSync(new URL('01-station-meteo.jollof', EX), 'utf8'));
  const comps = d.comps.map(c => make(c.type, c.id, c.inp)), by = Object.fromEntries(comps.map(c => [c.id, c]));
  const wires = d.wires.map(w => ({ a: { comp: by[w.a[0]], key: w.a[1] }, b: { comp: by[w.b[0]], key: w.b[1] }, progress: 1 }));
  const A = analyze(comps, wires), sensors = {};
  for (const c of comps) for (const k in c.pins) sensors[c.id + '|' + k] = 1.65;
  const ctx = { ...ctxOf(), sensorVolts: (c, k) => sensors[c.id + '|' + k] ?? null };
  wireFlows(A, solveDC(comps, A, ctx), wires);
  const n = 1000, t0 = performance.now();
  for (let i = 0; i < n; i++) wireFlows(A, solveDC(comps, A, ctx), wires); // résultat neuf : injections recalculées
  const ms = (performance.now() - t0) / n;
  t.diagnostic(`exemple 01 (${wires.length} fils) : ${ms.toFixed(4)} ms par calcul (solveur compris)`);
  assert.ok(ms < 0.5, `${ms} ms`);
});
