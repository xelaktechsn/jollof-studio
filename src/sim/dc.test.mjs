// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du solveur continu (dc.js), sous Node sans la scène 3D : node --test src/sim/dc.test.mjs
// Les montages sont faits à la main ou repris des projets d'exemple, comme le ferait main.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BOARDS, boardOf } from './boards.js';
import { PARTS } from './parts.js';
import { INPUTS } from './models.js';
import { analyze, bbGroups } from './circuit.js';
import { solveDC, resetDynamic } from './dc.js';
import { elecFaults } from './faults.js';

const EX = new URL('../../exemples/', import.meta.url);
// Broches des composants sans fiche de câblage (parts.js ne décrit pas leurs pattes).
const LEGS = { diode: ['A', 'K'], 'cap-100n': ['1', '2'], 'cap-100u': ['+', '-'], npn: ['C', 'B', 'E'], lm7805: ['IN', 'GND', 'OUT'], mb102: ['+5V', 'GND', '+3V3'], bat9v: ['+', '-'], bat18650: ['+', '-'] };
const keys = type => {
  const prof = BOARDS[type];
  if (prof) return [...Object.keys(prof.gpio), ...Object.keys(prof.power), 'GND', ...[2, 3, 4, 5, 6, 7, 8].map(n => `GND (${n})`), 'VIN', 'EN', 'RST', 'AREF', 'IOREF', 'VSYS', 'VBUS', '3V3_EN', 'RUN'];
  if (/^breadboard/.test(type)) return bbGroups({ type }).flatMap(g => g.keys);
  if (/^res-/.test(type)) return ['1', '2'];
  if (LEGS[type]) return LEGS[type];
  const sp = PARTS[type];
  return sp && sp.pins ? sp.pins.map(p => p.pin) : [];
};
const make = (type, id, inp) => ({ id, type, name: id, pins: Object.fromEntries(keys(type).map(k => [k, {}])), inp: { ...(INPUTS[type] || {}), ...(inp || {}) } });

/** Petit montage fait à la main : add(type, inp) puis wire(a, 'k', b, 'k'). */
function bench() {
  const comps = [], wires = [];
  return {
    comps, wires,
    add(type, inp) { const c = make(type, type + '_' + comps.length, inp); comps.push(c); return c; },
    wire(a, ka, b, kb) { wires.push({ a: { comp: a, key: ka }, b: { comp: b, key: kb }, progress: 1 }); },
    solve(ctx) { return solveDC(comps, analyze(comps, wires), ctx); }
  };
}
function load(file) {
  const d = JSON.parse(fs.readFileSync(new URL(file, EX), 'utf8'));
  const comps = d.comps.map(c => make(c.type, c.id, c.inp)), byId = Object.fromEntries(comps.map(c => [c.id, c]));
  const wires = d.wires.map(w => ({ a: { comp: byId[w.a[0]], key: w.a[1] }, b: { comp: byId[w.b[0]], key: w.b[1] }, progress: 1 }));
  return { comps, wires, byId };
}
/** ctx d'un programme figé : pins = { D7: { mode: 1, d: 1 } }, sensors = { 'id|AO': 1.2 }. */
const ctxOf = (pins = {}, sensors = {}) => ({
  prof: boardOf,
  pinState: (c, k) => (boardOf(c) ? pins[k] || null : null),
  sensorVolts: (c, k) => sensors[c.id + '|' + k] ?? null
});
const OUT = d => ({ mode: 1, d, pwm: null });
const near = (got, want, tol, what) => assert.ok(got != null && Math.abs(got - want) <= tol, `${what} : ${got} au lieu de ${want} ± ${tol}`);

/** Carte → broche → 220 Ω → LED → GND. */
function ledCircuit(board, pin, led = 'led-red') {
  const b = bench(), u = b.add(board), r = b.add('res-220'), l = b.add(led);
  b.wire(u, pin, r, '1'); b.wire(r, '2', l, 'A'); b.wire(l, 'K', u, 'GND');
  return { ...b, u, r, l };
}

test('LED + 220 Ω sur une sortie 5 V : ≈ 11,5 mA, anode ≈ 2,2 V ; LOW : éteinte', () => {
  const c = ledCircuit('uno', 'D7');
  const s = c.solve(ctxOf({ D7: OUT(1) }));
  const want = (5 - 2.0) / (220 + 15 + 25) * 1000;
  assert.equal(s.ok, true);
  near(s.leds.get(c.l).mA, want, want * 0.05, 'courant LED');
  near(s.current(c.r), want, want * 0.05, 'courant résistance');
  near(s.volts({ comp: c.l, key: 'A' }), 2.2, 0.06, 'anode');
  near(s.volts({ comp: c.u, key: 'D7' }), 5 - 0.025 * want, 0.01, 'broche D7');
  assert.equal(s.leds.get(c.l).on, true);
  assert.equal(s.volts({ comp: c.l, key: 'K' }), 0);
  const low = c.solve(ctxOf({ D7: OUT(0) }));
  assert.equal(low.leds.get(c.l).mA, 0);
  assert.equal(low.leds.get(c.l).on, false);
  near(low.volts({ comp: c.l, key: 'A' }), 0, 1e-3, 'anode à LOW');
});

test('Carte 3,3 V et LED bleue (3,0 V) : courant faible mais cohérent', () => {
  for (const [board, pin] of [['esp32', 'D13'], ['pico', 'GP15']]) {
    const c = ledCircuit(board, pin, 'led-blue');
    const s = c.solve(ctxOf({ [pin]: OUT(1) })), mA = s.leds.get(c.l).mA, va = s.volts({ comp: c.l, key: 'A' });
    assert.ok(mA >= 0 && mA < 2, `${board} : ${mA} mA`);
    near(mA, (3.3 - 3.0) / 260 * 1000, 0.1, `${board} courant`);
    assert.ok(va > 2.95 && va < 3.3, `${board} anode ${va} V`);
    // Une rouge sur la même broche : (3,3 − 2,0) / 260 ≈ 5 mA.
    const red = ledCircuit(board, pin, 'led-red'), sr = red.solve(ctxOf({ [pin]: OUT(1) }));
    near(sr.leds.get(red.l).mA, 1.3 / 260 * 1000, 0.25, `${board} LED rouge`);
  }
});

test('Pont diviseur 10 kΩ / 10 kΩ sur 5 V : 2,5 V au milieu', () => {
  const b = bench(), u = b.add('uno'), r1 = b.add('res-10k'), r2 = b.add('res-10k');
  b.wire(u, '5V', r1, '1'); b.wire(r1, '2', r2, '1'); b.wire(r2, '2', u, 'GND (2)');
  const s = b.solve(ctxOf());
  near(s.volts({ comp: r1, key: '2' }), 2.5, 0.005, 'milieu');
  near(s.current(r1), 0.25, 0.001, 'courant');
  near(s.volts({ comp: u, key: '5V' }), 5, 1e-3, '5V');
  near(s.volts({ comp: u, key: '3V3' }), 3.3, 1e-3, '3V3');
});

test('Bouton avec INPUT_PULLUP : ≈ 5 V relâché, ≈ 0 V appuyé', () => {
  const b = bench(), u = b.add('uno'), bb = b.add('breadboard'), btn = b.add('button');
  b.wire(u, 'D2', bb, 'A10'); b.wire(btn, '1', bb, 'B10'); b.wire(btn, '2', bb, 'B-3'); b.wire(u, 'GND', bb, 'B-1');
  const ctx = ctxOf({ D2: { mode: 2, d: 0, pwm: null } }), pin = { comp: u, key: 'D2' };
  near(b.solve(ctx).volts(pin), 5, 0.01, 'relâché');
  near(b.solve(ctx).volts({ comp: bb, key: 'E10' }), 5, 0.01, 'trou de la même bande');
  const before = analyze(b.comps, b.wires);
  btn.inp.pressed = true; // appui vu par une nouvelle analyse (main.js la refait à chaque pas)…
  near(b.solve(ctx).volts(pin), 0, 0.01, 'appuyé');
  near(solveDC(b.comps, before, ctx).volts(pin), 0, 0.01, 'appuyé, analyse d’avant l’appui'); // … ou par le seul modèle du bouton
  // Sans programme, la broche flotte : pas de valeur.
  btn.inp.pressed = false;
  assert.equal(b.solve(ctxOf()).volts(pin), null);
});

test('Exemple 02 (LED et bouton sur breadboard) : D7 HIGH allume la LED, 10 à 15 mA', () => {
  const { comps, wires, byId } = load('02-led-bouton-breadboard.jollof');
  const A = analyze(comps, wires), led = byId['led-red_1'], uno = byId.uno_1;
  const s = solveDC(comps, A, ctxOf({ D7: OUT(1), D2: { mode: 2, d: 0, pwm: null } }));
  const mA = s.leds.get(led).mA;
  assert.equal(s.leds.get(led).on, true);
  assert.ok(mA >= 10 && mA <= 15, `${mA} mA`);
  near(s.volts({ comp: uno, key: 'D2' }), 5, 0.01, 'D2 relâché');
  near(s.volts({ comp: byId.breadboard_1, key: 'B-8' }), 0, 1e-6, 'rail de masse');
  assert.ok(s.iterations <= 4, `${s.iterations} itérations`);
  const off = solveDC(comps, A, ctxOf({ D7: OUT(0) }));
  assert.equal(off.leds.get(led).on, false);
});

test('Exemple 04 (DS18B20 sur Pico) : DQ tirée à 3,3 V par la 4,7 kΩ, rails reliés', () => {
  const { comps, wires, byId } = load('04-thermometre-ds18b20.jollof');
  const s = solveDC(comps, analyze(comps, wires), ctxOf({ GP6: { mode: 1, d: 0, pwm: null } }));
  near(s.volts({ comp: byId.ds18b20_1, key: 'VDD' }), 3.3, 1e-3, 'VDD');
  assert.equal(s.volts({ comp: byId.ds18b20_1, key: 'GND' }), 0);
  // GP6 à LOW (la sonde répond) : 3,3 V / (4,7 kΩ + 25 Ω) ≈ 0,70 mA dans la résistance.
  near(s.current(byId['res-4k7_1']), -3.3 / 4725 * 1000, 0.005, 'courant de tirage');
  near(s.volts({ comp: byId.ds18b20_1, key: 'DQ' }), 3.3 * 25 / 4725, 0.002, 'DQ à LOW');
});

test('Montage sans source : ok false, aucune tension', () => {
  const b = bench(), r = b.add('res-220'), l = b.add('led-red');
  b.wire(r, '2', l, 'A');
  const s = b.solve(ctxOf());
  assert.equal(s.ok, false);
  assert.equal(s.volts({ comp: l, key: 'A' }), null);
  assert.equal(s.current(r), 0);
  assert.equal(s.leds.get(l).on, false);
  assert.equal(solveDC([], analyze([], []), {}).ok, false);
});

test('Pile 9 V, 1 kΩ et LED, sans carte : la masse est le − de la pile', () => {
  const b = bench(), bat = b.add('bat9v'), r = b.add('res-1k'), l = b.add('led-red');
  b.wire(bat, '+', r, '1'); b.wire(r, '2', l, 'A'); b.wire(l, 'K', bat, '-');
  const s = b.solve(ctxOf()), want = 7 / (1000 + 15 + 1.5) * 1000;
  near(s.leds.get(l).mA, want, 0.01, 'LED');
  near(s.current(bat), want, 0.01, 'pile');
  near(s.volts({ comp: bat, key: '+' }), 9 - 1.5 * want / 1000, 1e-3, 'borne +');
  // À l'envers : bloquée.
  const b2 = bench(), bat2 = b2.add('bat9v'), r2 = b2.add('res-1k'), l2 = b2.add('led-red');
  b2.wire(bat2, '+', r2, '1'); b2.wire(r2, '2', l2, 'K'); b2.wire(l2, 'A', bat2, '-');
  const s2 = b2.solve(ctxOf());
  assert.equal(s2.leds.get(l2).mA, 0);
  near(s2.volts({ comp: r2, key: '2' }), 9, 0.01, 'cathode');
});

test('PWM : la moyenne des deux niveaux, comme un multimètre', () => {
  const c = ledCircuit('uno', 'D9'), full = (5 - 2.0) / 260 * 1000;
  const s = c.solve(ctxOf({ D9: { mode: 1, d: 1, pwm: 0.25 } }));
  near(s.leds.get(c.l).mA, full * 0.25, 0.01, 'courant moyen');
  near(s.volts({ comp: c.u, key: 'D9' }), 0.25 * (5 - 0.025 * full), 0.01, 'tension moyenne');
  // Trois couleurs à des rapports différents : chaque canal garde sa propre moyenne.
  const b = bench(), u = b.add('uno'), rgb = b.add('led-rgb'), rs = ['R', 'G', 'B'].map(() => b.add('res-220'));
  [['D9', 'R'], ['D10', 'G'], ['D11', 'B']].forEach(([p, k], i) => { b.wire(u, p, rs[i], '1'); b.wire(rs[i], '2', rgb, k); });
  b.wire(rgb, 'GND', u, 'GND');
  const t = b.solve(ctxOf({ D9: { mode: 1, d: 1, pwm: 1 }, D10: { mode: 1, d: 1, pwm: 0.5 }, D11: { mode: 1, d: 1, pwm: 0.2 } })), ch = t.leds.get(rgb).ch;
  near(ch.R.mA, 3 / 260 * 1000, 0.05, 'rouge');
  // Vert et bleu d'une LED RVB : InGaN, seuil ≈ 3,1 V.
  near(ch.G.mA, 0.5 * 1.9 / 260 * 1000, 0.05, 'vert');
  near(ch.B.mA, 0.2 * 1.9 / 260 * 1000, 0.05, 'bleu');
  assert.equal(t.leds.get(rgb).on, true);
});

test('Potentiomètre, régulateur et alimentations des cartes', () => {
  const b = bench(), u = b.add('uno'), pot = b.add('pot', { pos: 25 });
  b.wire(pot, '1', u, 'GND'); b.wire(pot, '3', u, '5V');
  near(b.solve(ctxOf()).volts({ comp: pot, key: 'W' }), 1.25, 0.005, 'curseur à 25 %');
  pot.inp.pos = 100;
  near(b.solve(ctxOf()).volts({ comp: pot, key: 'W' }), 5, 0.005, 'curseur à 100 %');
  // VIN d'un Uno sur USB ; avec une pile, c'est la pile qui l'impose.
  near(b.solve(ctxOf()).volts({ comp: u, key: 'VIN' }), 4.5, 0.01, 'VIN sur USB');
  const bat = b.add('bat9v'); b.wire(bat, '+', u, 'VIN'); b.wire(bat, '-', u, 'GND (2)');
  near(b.solve(ctxOf()).volts({ comp: u, key: 'VIN' }), 9, 0.01, 'VIN sur pile');
  // LM7805 sur pile 9 V : 5 V en sortie, le courant de la LED est pris à la pile.
  const k = bench(), p9 = k.add('bat9v'), reg = k.add('lm7805'), r = k.add('res-220'), l = k.add('led-green');
  k.wire(p9, '+', reg, 'IN'); k.wire(p9, '-', reg, 'GND'); k.wire(reg, 'OUT', r, '1'); k.wire(r, '2', l, 'A'); k.wire(l, 'K', reg, 'GND');
  const s = k.solve(ctxOf()), want = (5 - 2.2) / 235 * 1000;
  near(s.volts({ comp: reg, key: 'OUT' }), 5, 0.01, 'sortie 7805');
  near(s.leds.get(l).mA, want, 0.05, 'LED sur 7805');
  near(s.current(p9), want, 0.05, 'courant de la pile');
  // Accu 3,7 V : pas assez pour le 7805, sortie flottante.
  const q = bench(), li = q.add('bat18650'), reg2 = q.add('lm7805');
  q.wire(li, '+', reg2, 'IN'); q.wire(li, '-', reg2, 'GND');
  assert.equal(q.solve(ctxOf()).volts({ comp: reg2, key: 'OUT' }), null);
  // ESP32 : VIN tient 5 V par sa diode, mais une pile 9 V reliée l'emporte.
  const e = bench(), esp = e.add('esp32');
  near(e.solve(ctxOf()).volts({ comp: esp, key: 'VIN' }), 5, 0.01, 'VIN ESP32');
  const p2 = e.add('bat9v'); e.wire(p2, '+', esp, 'VIN'); e.wire(p2, '-', esp, 'GND');
  const se = e.solve(ctxOf());
  near(se.volts({ comp: esp, key: 'VIN' }), 9, 0.01, 'VIN ESP32 sur pile');
  near(se.current(p2), 0, 1e-3, 'la pile ne débite pas dans l’USB');
});

test('Capteur : sa sortie est une source de 1 kΩ ; LED en parallèle de couleurs différentes', () => {
  const b = bench(), u = b.add('uno'), ldr = b.add('ldr'), r = b.add('res-1k');
  b.wire(ldr, 'AO', u, 'A0'); b.wire(r, '1', u, 'A0'); b.wire(r, '2', u, 'GND');
  near(b.solve(ctxOf({}, { [ldr.id + '|AO']: 2 })).volts({ comp: u, key: 'A0' }), 1, 0.01, 'capteur chargé par 1 kΩ');
  const c = bench(), uno = c.add('uno'), rr = c.add('res-220'), red = c.add('led-red'), blue = c.add('led-blue');
  c.wire(uno, 'D7', rr, '1'); c.wire(rr, '2', red, 'A'); c.wire(rr, '2', blue, 'A'); c.wire(red, 'K', uno, 'GND'); c.wire(blue, 'K', uno, 'GND');
  const s = c.solve(ctxOf({ D7: OUT(1) }));
  assert.equal(s.leds.get(red).on, true);
  assert.equal(s.leds.get(blue).on, false); // la rouge tient l'anode vers 2,2 V, sous le seuil de la bleue
  assert.ok(s.iterations < 20);
  // Composants inconnus ou mal formés : ignorés, jamais d'exception.
  const z = bench(), uz = z.add('uno'), cap = z.add('cap-100u'), q = z.add('npn'), odd = { id: 'x', type: 'zzz', name: 'x', pins: { a: {} }, inp: {} };
  z.comps.push(odd); z.wire(uz, '5V', cap, '+'); z.wire(cap, '-', uz, 'GND'); z.wire(q, 'B', uz, 'D3');
  const sz = z.solve(ctxOf({ D3: OUT(1) }));
  assert.equal(sz.ok, true);
  assert.equal(sz.dyn, true);
  assert.equal(sz.current(cap), 0); // en continu, un condensateur est ouvert
  near(sz.capV(cap), 5, 1e-3, 'condensateur sur 5 V');
  assert.equal(sz.volts({ comp: odd, key: 'a' }), null);
  assert.equal(sz.volts({ comp: cap, key: '-' }), 0);
});

test('Tous les exemples se résolvent sans erreur, en continu comme pas à pas', () => {
  for (const f of fs.readdirSync(EX).filter(f => f.endsWith('.jollof'))) {
    const { comps, wires } = load(f), A = analyze(comps, wires);
    const ctx = ctxOf(Object.fromEntries(['D2', 'D4', 'D7', 'D13', 'GP15', 'D9'].map(k => [k, OUT(1)])));
    const s = solveDC(comps, A, ctx), t = solveDC(comps, A, { ...ctx, dt: 0.1, commit: true });
    assert.equal(s.ok, true, f);
    assert.equal(s.dyn, comps.some(c => /^(cap-|npn$|pn2222$)/.test(c.type)), f); // « dynamique » : un condensateur ou un transistor
    assert.ok(s.iterations < 20, `${f} : ${s.iterations} itérations`);
    for (const c of comps) for (const k in c.pins) {
      const r = { comp: c, key: k }, v = s.volts(r);
      assert.ok(v === null || Number.isFinite(v), `${f} ${c.name} ${k}`);
      assert.equal(t.volts(r), v, `${f} ${c.name} ${k} pas à pas`); // sans condensateur, le temps ne change rien
    }
  }
});

test('Courants par broche (injections) et across() : loi des nœuds, signes', () => {
  const c = ledCircuit('uno', 'D7'), s = c.solve(ctxOf({ D7: OUT(1) })), inj = s.injections(), I = s.current(c.r);
  const at = (comp, k) => inj.get(comp.id + '|' + k) || 0;
  assert.equal(s.injections(), inj); // calculé une fois
  // À la fuite gmin près (1 nS × 5 V = 5 nA) : current() arrondit sous 0,1 µA, pas les injections.
  near(at(c.u, 'D7'), I, 1e-5, 'D7 fournit');
  near(at(c.r, '1'), -I, 1e-5, 'R1 reçoit par 1');
  near(at(c.r, '2'), I, 1e-5, 'R1 rend par 2');
  near(at(c.l, 'A'), -I, 1e-5, 'anode');
  near(at(c.l, 'K'), I, 1e-5, 'cathode');
  near(at(c.u, 'GND'), -I, 1e-4, 'retour par GND'); // les fuites des broches 5V et 3V3 aussi
  const ar = s.across(c.r), al = s.across(c.l);
  assert.equal(ar.kind, 'res'); near(ar.v, I * 0.22, 1e-3, 'U = R·I'); near(ar.extra.ohms, 220, 1e-9, 'R');
  assert.equal(al.kind, 'led'); assert.equal(al.extra.on, true); near(al.v, 2.0 + 0.015 * I, 1e-3, 'U LED');
  assert.equal(s.across({ id: 'x' }), null);
  // Pile : courant sortant par +, rentrant par −.
  const b = bench(), bat = b.add('bat9v'), r = b.add('res-1k');
  b.wire(bat, '+', r, '1'); b.wire(r, '2', bat, '-');
  const t = b.solve(ctxOf()), ab = t.across(bat), jb = t.injections();
  assert.equal(ab.kind, 'bat'); near(ab.mA, 9 / 1001.5 * 1000, 1e-3, 'pile');
  near(jb.get(bat.id + '|+'), ab.mA, 1e-5, '+'); near(jb.get(bat.id + '|-'), -ab.mA, 1e-5, '−');
});

/** D7 → 10 kΩ → 100 µF → GND, pour la charge d'un condensateur. */
function rcCircuit() {
  const b = bench(), u = b.add('uno'), r = b.add('res-10k'), c = b.add('cap-100u');
  b.wire(u, 'D7', r, '1'); b.wire(r, '2', c, '+'); b.wire(c, '-', u, 'GND');
  return { ...b, u, r, c, tau: (10e3 + 25) * 100e-6 }; // la sortie de la broche (25 Ω) s'ajoute à R
}
/** Avance par pas de dt jusqu'à ce que la tension franchisse `target` ; instant interpolé entre deux pas. */
function crossing(c, d, target, dt, tmax) {
  let t = 0, prev = c.c.dcS ? c.c.dcS.v : 0, s = null;
  while (t < tmax) {
    s = c.solve({ ...ctxOf({ D7: OUT(d) }), dt, commit: true });
    const v = s.capV(c.c);
    if ((v - target) * (prev - target) <= 0 && v !== prev) return { t: t + dt * (target - prev) / (v - prev), s };
    prev = v; t += dt;
  }
  return { t: null, s };
}

test('Condensateur 100 µF chargé par D7 à travers 10 kΩ : 63,2 % en τ = R·C, puis décharge', t => {
  const c = rcCircuit(), dt = 0.01;
  // En continu (sans dt) : ouvert, donc déjà à 5 V, aucun courant ; rien n'est écrit sur le composant.
  const dc = c.solve(ctxOf({ D7: OUT(1) }));
  assert.equal(dc.dyn, true); assert.equal(dc.current(c.c), 0); near(dc.capV(c.c), 5, 1e-3, 'continu');
  assert.equal(c.c.dcS, undefined);
  // Premier pas : condensateur vide, tout le courant passe (≈ 5 V / 10 kΩ).
  const s0 = c.solve({ ...ctxOf({ D7: OUT(1) }), dt, commit: true }), i0 = 5 / (10e3 + 25) * 1000;
  near(s0.current(c.c), i0 * Math.exp(-dt / c.tau), i0 * 0.01, 'courant initial');
  const a0 = s0.across(c.c);
  assert.equal(a0.kind, 'cap'); near(a0.v, 5 * (1 - Math.exp(-dt / c.tau)), 0.01, 'U après un pas'); assert.equal(a0.extra.farads, 100e-6);
  resetDynamic(c.comps);
  assert.equal(c.c.dcS, null);
  const up = crossing(c, 1, 0.632 * 5, dt, 3 * c.tau);
  t.diagnostic(`charge : 63,2 % atteints en ${up.t.toFixed(4)} s pour τ = ${c.tau.toFixed(4)} s (écart ${((up.t / c.tau - 1) * 100).toFixed(2)} %)`);
  near(up.t, c.tau, 0.05 * c.tau, 'τ de charge');
  near(c.solve(ctxOf({ D7: OUT(1) })).volts({ comp: c.c, key: '+' }), 5, 1e-3, 'mesure de TP en continu');
  // Une mesure (sans commit) ne fait pas avancer le temps.
  const v = c.c.dcS.v;
  c.solve({ ...ctxOf({ D7: OUT(1) }), dt: 0.5 });
  assert.equal(c.c.dcS.v, v);
  for (let i = 0; i < 700; i++) c.solve({ ...ctxOf({ D7: OUT(1) }), dt: 0.01, commit: true }); // 8τ en tout : chargé
  const full = c.c.dcS.v;
  assert.ok(full > 4.98, `chargé : ${full} V`);
  // Décharge par D7 à LOW : 36,8 % en τ, courant négatif (le condensateur rend sa charge).
  const down = crossing(c, 0, 0.368 * full, dt, 3 * c.tau);
  t.diagnostic(`décharge : 36,8 % atteints en ${down.t.toFixed(4)} s (écart ${((down.t / c.tau - 1) * 100).toFixed(2)} %)`);
  near(down.t, c.tau, 0.05 * c.tau, 'τ de décharge');
  assert.ok(down.s.current(c.c) < 0, 'courant de décharge');
  // Un grand pas reste stable (Euler implicite) même borné à 10 sous-pas.
  resetDynamic(c.comps);
  const big = c.solve({ ...ctxOf({ D7: OUT(1) }), dt: 5, commit: true, maxSub: 10 });
  assert.ok(big.capV(c.c) > 4.9 && big.capV(c.c) <= 5.0001, `grand pas : ${big.capV(c.c)} V`);
});

test('Condensateur 100 nF non polarisé, en PWM : charge à la tension moyenne', () => {
  const b = bench(), u = b.add('uno'), r = b.add('res-10k'), c = b.add('cap-100n');
  b.wire(u, 'D9', r, '1'); b.wire(r, '2', c, '1'); b.wire(c, '2', u, 'GND');
  let s;
  for (let i = 0; i < 20; i++) s = b.solve({ ...ctxOf({ D9: { mode: 1, d: 1, pwm: 0.25 } }), dt: 0.01, commit: true }); // τ = 1 ms
  near(s.capV(c), 1.25, 0.01, 'moyenne de la PWM');
  assert.equal(s.across(c).kind, 'cap');
});

/** D8 → Rb → B ; 5V → 220 Ω → LED rouge → C ; E → GND. */
function npnSwitch(rb = 'res-1k') {
  const b = bench(), u = b.add('uno'), r1 = b.add(rb), r2 = b.add('res-220'), l = b.add('led-red'), q = b.add('npn');
  b.wire(u, 'D8', r1, '1'); b.wire(r1, '2', q, 'B'); b.wire(u, '5V', r2, '1'); b.wire(r2, '2', l, 'A'); b.wire(l, 'K', q, 'C'); b.wire(q, 'E', u, 'GND');
  return { ...b, u, r1, r2, l, q };
}

test('Transistor NPN en interrupteur : saturé, Ic ≈ (5 − 2 − 0,2) / 235 Ω, LED allumée', t => {
  const c = npnSwitch(), s = c.solve(ctxOf({ D8: OUT(1) })), x = s.across(c.q);
  const want = (5 - 2 - 0.2) / (220 + 15) * 1000;
  t.diagnostic(`Ic = ${s.current(c.q).toFixed(3)} mA (attendu ≈ ${want.toFixed(3)}), Ib = ${x.extra.ib.toFixed(3)} mA, Vce = ${x.extra.vce.toFixed(3)} V, ${s.iterations} itérations`);
  assert.equal(s.dyn, true);
  assert.equal(x.kind, 'npn');
  assert.equal(x.extra.state, 'sat');
  near(s.current(c.q), want, want * 0.05, 'Ic');
  near(x.extra.ic, s.current(c.q), 1e-9, 'extra.ic');
  near(x.extra.vce, 0.2, 0.05, 'Vce(sat)');
  near(x.extra.ib, (5 - 0.65) / (1000 + 25 + 50) * 1000, 0.05, 'Ib');
  near(s.leds.get(c.l).mA, s.current(c.q), 1e-6, 'le courant de la LED traverse le collecteur');
  assert.equal(s.leds.get(c.l).on, true);
  assert.ok(s.iterations < 20, `${s.iterations} itérations`);
  // Loi des nœuds au transistor : Ie = Ic + Ib.
  const inj = s.injections(), at = k => inj.get(c.q.id + '|' + k);
  near(at('E'), -(at('C') + at('B')), 1e-9, 'Ie'); near(-at('C'), s.current(c.q), 1e-6, 'C');
  // Base à LOW : bloqué, LED éteinte.
  const off = c.solve(ctxOf({ D8: OUT(0) }));
  assert.equal(off.across(c.q).extra.state, 'off');
  assert.equal(off.current(c.q), 0);
  assert.equal(off.leds.get(c.l).on, false);
  // PWM 50 % sur la base : la moitié du courant en moyenne.
  near(c.solve(ctxOf({ D8: { mode: 1, d: 1, pwm: 0.5 } })).current(c.q), s.current(c.q) / 2, want * 0.03, 'PWM');
  // Pas à pas avec commit : l'état est gardé pour le calcul suivant.
  c.solve({ ...ctxOf({ D8: OUT(1) }), dt: 0.1, commit: true });
  assert.equal(c.q.dcS.q, 2);
  const again = c.solve({ ...ctxOf({ D8: OUT(1) }), dt: 0.1, commit: true });
  assert.ok(again.iterations <= 2, `départ de l'état gardé : ${again.iterations} itérations`);
  near(again.current(c.q), s.current(c.q), 1e-6, 'même point');
});

test('Transistor NPN en régime linéaire : Ic = β·Ib (base par 1 MΩ)', t => {
  const b = bench(), u = b.add('uno'), rb = b.add('res-1M'), rc = b.add('res-1k'), q = b.add('npn');
  b.wire(u, 'D8', rb, '1'); b.wire(rb, '2', q, 'B'); b.wire(u, '5V', rc, '1'); b.wire(rc, '2', q, 'C'); b.wire(q, 'E', u, 'GND (2)');
  const s = b.solve(ctxOf({ D8: OUT(1) })), x = s.across(q), ib = (5 - 0.65) / (1e6 + 75) * 1000;
  t.diagnostic(`Ib = ${(x.extra.ib * 1000).toFixed(3)} µA, Ic = ${x.extra.ic.toFixed(4)} mA, Ic/Ib = ${(x.extra.ic / x.extra.ib).toFixed(2)}, Vce = ${x.extra.vce.toFixed(3)} V`);
  assert.equal(x.extra.state, 'active');
  near(x.extra.ic / x.extra.ib, 200, 4, 'β');
  near(x.extra.ib, ib, ib * 0.01, 'Ib');
  near(x.extra.vce, 5 - x.extra.ic, 0.01, 'Vce = 5 V − Rc·Ic');
  assert.ok(s.iterations < 20, `${s.iterations} itérations`);
});

test('Électrolytique à l’envers : elecFaults signale capreversed', () => {
  const b = bench(), u = b.add('uno'), c = b.add('cap-100u'), n = b.add('cap-100n');
  b.wire(u, '5V', c, '-'); b.wire(c, '+', u, 'GND');
  b.wire(u, '5V', n, '2'); b.wire(n, '1', u, 'GND (2)'); // non polarisé : aucun sens interdit
  const A = analyze(b.comps, b.wires), s = solveDC(b.comps, A, ctxOf());
  near(s.capV(c), -5, 1e-3, 'tension inverse');
  const f = elecFaults(s, b.comps, A);
  assert.equal(f.length, 1);
  assert.equal(f[0].code, 'capreversed'); assert.equal(f[0].level, 'err'); assert.equal(f[0].fx, 'smoke');
  assert.equal(f[0].comp, c); assert.equal(f[0].wires.length, 2); assert.deepEqual(f[0].swap, ['+', '-']);
  for (const k of ['title', 'why', 'fix', 'where']) assert.ok(typeof f[0][k] === 'string' && f[0][k].length > 5, k);
  // Pas à pas aussi, dès que la tension inverse dépasse 1 V.
  let t = null;
  for (let i = 0; i < 10; i++) t = solveDC(b.comps, A, { ...ctxOf(), dt: 0.01, commit: true });
  assert.equal(elecFaults(t, b.comps).length, 1);
  // Dans le bon sens : rien.
  const g = bench(), ug = g.add('uno'), cg = g.add('cap-100u');
  g.wire(ug, '5V', cg, '+'); g.wire(cg, '-', ug, 'GND');
  assert.equal(elecFaults(g.solve(ctxOf()), g.comps).length, 0);
  assert.deepEqual(elecFaults(null, g.comps), []);
});

/** Moyenne en ms de n résolutions. */
function time(n, fn) { fn(); const t = performance.now(); for (let i = 0; i < n; i++) fn(i); return (performance.now() - t) / n; }

test('Performance : exemple 01 résolu 1000 fois, < 2 ms par résolution', t => {
  const { comps, wires } = load('01-station-meteo.jollof'), A = analyze(comps, wires);
  // Programme chargé : toutes les GPIO en sortie, une sur trois en PWM, chaque sortie de module pilotée.
  const esp = comps.find(c => boardOf(c)), pins = {}, sensors = {};
  Object.keys(BOARDS.esp32.gpio).forEach((k, i) => { pins[k] = { mode: 1, d: i % 2, pwm: i % 3 ? null : 0.2 + 0.15 * (i % 4) }; });
  for (const c of comps) for (const k in c.pins) sensors[c.id + '|' + k] = 1.65;
  const idle = time(1000, () => solveDC(comps, A, ctxOf()));
  const busy = time(1000, () => solveDC(comps, A, ctxOf(pins, sensors)));
  // Analyse nouvelle à chaque appel (main.js la refait 10 fois par seconde) : topologie reconstruite.
  const cold = time(1000, () => solveDC(comps, { ...A }, ctxOf(pins, sensors)));
  const s = solveDC(comps, A, ctxOf(pins, sensors));
  t.diagnostic(`exemple 01 : ${idle.toFixed(4)} ms sans programme, ${busy.toFixed(4)} ms programme chargé (${s.iterations} itérations), ${cold.toFixed(4)} ms topologie comprise`);
  assert.ok(esp && s.ok);
  assert.ok(idle < 2 && busy < 2 && cold < 2, `${idle} / ${busy} / ${cold} ms`);
});

test('Performance : ~50 nœuds (échelle de 40 résistances, 8 LED en PWM)', t => {
  const b = bench(), u = b.add('uno'), rs = [];
  for (let i = 0; i < 40; i++) { const r = b.add('res-1k'); if (i) b.wire(rs[i - 1], '2', r, '1'); rs.push(r); }
  b.wire(u, '5V', rs[0], '1'); b.wire(rs[39], '2', u, 'GND');
  const pins = {}, leds = [];
  ['D2', 'D3', 'D4', 'D5', 'D6', 'D9', 'D10', 'D11'].forEach((k, i) => {
    const r = b.add('res-220'), l = b.add(['led-red', 'led-green', 'led-blue', 'led-yellow'][i % 4]);
    b.wire(u, k, r, '1'); b.wire(r, '2', l, 'A'); b.wire(l, 'K', rs[5 * i], '2'); // cathodes sur l'échelle : couplage voulu
    pins[k] = { mode: 1, d: 1, pwm: i % 2 ? (i + 1) / 10 : null }; leds[5 * i] = l;
  });
  const A = analyze(b.comps, b.wires), ctx = ctxOf(pins);
  const warm = time(1000, () => solveDC(b.comps, A, ctx)), cold = time(300, () => solveDC(b.comps, { ...A }, ctx));
  const s = solveDC(b.comps, A, ctx);
  // Loi des nœuds à chaque jonction de l'échelle : ce qui entre (résistance d'avant + LED) ressort,
  // à la fuite gmin près (1 nS × quelques volts, soit quelques nA).
  for (let i = 0; i < 39; i++) near(s.current(rs[i]) + (leds[i] ? s.leds.get(leds[i]).mA : 0), s.current(rs[i + 1]), 1e-4, `jonction ${i}`);
  // Loi des mailles le long de l'échelle : la somme des chutes fait 5 V (moins la source).
  near(rs.reduce((a, r) => a + s.volts({ comp: r, key: '1' }) - s.volts({ comp: r, key: '2' }), 0), s.volts({ comp: u, key: '5V' }), 1e-6, 'mailles');
  t.diagnostic(`~56 nœuds : ${warm.toFixed(4)} ms par résolution (${s.iterations} itérations), ${cold.toFixed(4)} ms topologie comprise`);
  assert.ok(warm < 2 && cold < 4, `${warm} / ${cold} ms`);
});

test('Performance : charge RC en 25 sous-pas, < 2 ms par appel', t => {
  const c = rcCircuit(), A = analyze(c.comps, c.wires), ctx = { ...ctxOf({ D7: OUT(1) }), dt: 0.05, commit: true }; // 0,05 s / 2 ms = 25 sous-pas
  const warm = time(500, () => solveDC(c.comps, A, ctx)), cold = time(300, () => solveDC(c.comps, { ...A }, ctx));
  const s = solveDC(c.comps, A, ctx);
  // Transistor et LED en plus, au pas d'une simulation (0,1 s) : la commutation ne coûte presque rien.
  const q = npnSwitch(), Aq = analyze(q.comps, q.wires), qctx = { ...ctxOf({ D8: { mode: 1, d: 1, pwm: 0.3 } }), dt: 0.1, commit: true };
  const sw = time(500, () => solveDC(q.comps, Aq, qctx));
  t.diagnostic(`RC 25 sous-pas : ${warm.toFixed(4)} ms par appel, ${cold.toFixed(4)} ms topologie comprise (${s.iterations} itérations par sous-pas) ; NPN + PWM : ${sw.toFixed(4)} ms`);
  assert.ok(warm < 2 && cold < 2 && sw < 2, `${warm} / ${cold} / ${sw} ms`);
});

/* ---------- Effecteurs sur le calcul du circuit ---------- */
import { motorSpeed } from './actuators.js';
import { inspect } from './circuit.js';
import { partOf } from './parts.js';
const codesOf = (b, c) => { const i = inspect(c, analyze(b.comps, b.wires), partOf(c)); return Object.values(i.pins).flatMap(p => p.msgs.map(m => m.code)); };

test('Moteur sur une pile 9 V : courant d’une charge de 30 Ω, vitesse au-delà du nominal, câblage accepté', () => {
  const b = bench(), p = b.add('bat9v'), m = b.add('dcmotor');
  b.wire(p, '+', m, 'M+'); b.wire(m, 'M-', p, '-');
  const a = b.solve(ctxOf()).across(m);
  assert.equal(a.kind, 'motor');
  near(a.mA, 9 / 31.5 * 1000, 2, 'courant');
  near(a.v, 9 * 30 / 31.5, 0.02, 'tension');
  assert.ok(motorSpeed('dcmotor', a.v) > 1.3, 'tourne vite');
  assert.deepEqual(codesOf(b, m), []);
  // À l'envers : tourne dans l'autre sens.
  const r = bench(), p2 = r.add('bat9v'), m2 = r.add('dcmotor');
  r.wire(p2, '+', m2, 'M-'); r.wire(m2, 'M+', p2, '-');
  assert.ok(motorSpeed('dcmotor', r.solve(ctxOf()).across(m2).v) < -1);
  // Directement sur une broche : erreur de câblage et broche surchargée.
  const g = bench(), u = g.add('uno'), m3 = g.add('dcmotor');
  g.wire(u, 'D7', m3, 'M+'); g.wire(m3, 'M-', u, 'GND');
  const s = g.solve(ctxOf({ D7: OUT(1) }));
  assert.ok(codesOf(g, m3).includes('drvdirect'));
  assert.ok(elecFaults(s, g.comps, analyze(g.comps, g.wires)).some(f => f.code === 'gpioover'), 'surcharge de D7');
});

test('Moteur commandé par un transistor : tourne quand la base reçoit HIGH, arrêté sur LOW', () => {
  const b = bench(), u = b.add('uno'), p = b.add('bat9v'), m = b.add('dcmotor'), q = b.add('npn'), r = b.add('res-1k');
  b.wire(p, '+', m, 'M+'); b.wire(m, 'M-', q, 'C'); b.wire(q, 'E', u, 'GND'); b.wire(p, '-', u, 'GND (2)');
  b.wire(u, 'D8', r, '1'); b.wire(r, '2', q, 'B');
  const on = b.solve(ctxOf({ D8: OUT(1) })).across(m), off = b.solve(ctxOf({ D8: OUT(0) })).across(m);
  near(on.mA, (9 - 0.2) / 33.5 * 1000, 3, 'courant, transistor saturé (Vce 0,2 V + 2 Ω)');
  assert.ok(Math.abs(off.mA) < 0.01, `arrêté : ${off.mA}`);
  assert.deepEqual(codesOf(b, m), []);
});

test('Pilote L298N : IN1/IN2 donnent le sens, la PWM sur ENA la tension moyenne, le courant vient de la pile', () => {
  const { comps, wires, byId } = load('06-moteur-vitesse.jollof');
  const m = comps.find(c => c.type === 'dcmotor'), bat = comps.find(c => c.type === 'bat9v');
  const A = analyze(comps, wires), run = pins => solveDC(comps, A, ctxOf(pins));
  const full = run({ D2: OUT(1), D4: OUT(0), D3: OUT(1) }).across(m);
  near(full.mA, (9 - 1.4 - 0.2) / 32 * 1000, 8, 'pleine vitesse');
  const half = run({ D2: OUT(1), D4: OUT(0), D3: { mode: 1, d: 1, pwm: 0.5 } }), h = half.across(m);
  near(h.v, full.v / 2, 0.15, 'PWM 50 %');
  near(half.across(bat).mA, h.mA, 3, 'la pile fournit le courant du moteur');
  assert.ok(run({ D2: OUT(0), D4: OUT(1), D3: OUT(1) }).across(m).v < -5, 'sens inverse');
  assert.ok(Math.abs(run({ D2: OUT(1), D4: OUT(0), D3: OUT(0) }).across(m).mA) < 0.01, 'ENA à LOW : roue libre');
  assert.equal(half.dyn, false);
  assert.ok(byId);
});

test('Relais : COM–NO alimente un ventilateur quand la bobine colle ; la bobine tire son courant', () => {
  const b = bench(), u = b.add('uno'), k = b.add('relay'), p = b.add('bat9v'), f = b.add('fan');
  b.wire(u, '5V', k, 'VCC'); b.wire(u, 'GND', k, 'GND'); b.wire(u, 'D7', k, 'IN');
  b.wire(p, '+', k, 'COM'); b.wire(k, 'NO', f, '+'); b.wire(f, '-', p, '-');
  assert.ok(Math.abs(b.solve(ctxOf({ D7: OUT(1) })).across(f).mA) < 0.01, 'au repos : arrêté');
  k.relayOn = true;
  const s = b.solve(ctxOf({ D7: OUT(0) })), a = s.across(f);
  near(a.v, 9 * 50 / 51.5, 0.1, 'contact fermé');
  assert.ok(motorSpeed('fan', a.v) > 1, 'tourne');
  near(s.across(k).mA, 5 / 70 * 1000, 3, 'bobine');
  assert.deepEqual(codesOf(b, f), []);
  assert.deepEqual(codesOf(b, k), []);
  // Ventilateur branché à l'envers : ne tourne pas, signalé.
  const r = bench(), p2 = r.add('bat18650'), f2 = r.add('fan');
  r.wire(p2, '+', f2, '-'); r.wire(f2, '+', p2, '-');
  const s2 = r.solve(ctxOf());
  assert.equal(motorSpeed('fan', s2.across(f2).v), 0);
  assert.ok(elecFaults(s2, r.comps, analyze(r.comps, r.wires)).some(x => x.code === 'fanrev'));
});

test('Servo : l’impulsion se lit en tension moyenne sur SIG ; buzzer et pompe sur une pile', () => {
  const b = bench(), u = b.add('uno'), sv = b.add('servo');
  b.wire(u, '5V', sv, 'VCC'); b.wire(u, 'GND', sv, 'GND'); b.wire(u, 'D9', sv, 'SIG');
  const s = b.solve(ctxOf({ D9: { mode: 1, d: 0, pwm: null, servo: 90 } }));
  near(s.volts({ comp: sv, key: 'SIG' }), 5 * (0.544 + 0.928) / 20, 0.02, 'SIG à 90°');
  near(s.across(sv).mA, 10, 1, 'servo au repos');
  sv.servoBusy = true;
  near(b.solve(ctxOf({ D9: { mode: 1, d: 0, servo: 90 } })).across(sv).mA, 200, 10, 'servo qui tourne');
  const z = bench(), p = z.add('bat9v'), bz = z.add('buzzer'), pm = z.add('pump');
  z.wire(p, '+', bz, '+'); z.wire(bz, '-', p, '-'); z.wire(p, '+', pm, '+'); z.wire(pm, '-', p, '-');
  const sz = z.solve(ctxOf());
  assert.ok(sz.across(bz).v > 2.5, 'le buzzer sonne');
  assert.deepEqual(codesOf(z, bz), []);
  assert.ok(elecFaults(sz, z.comps, analyze(z.comps, z.wires)).some(x => x.code === 'motorover' && x.comp === pm), 'pompe 5 V sur 9 V');
});
