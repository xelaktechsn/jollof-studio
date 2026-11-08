// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modèles analogiques du solveur (dc.js) : bobine, ampli-op LM358, MOSFET IRLZ44N, minuterie NE555, générateur de
// fonctions, relevé de l'oscilloscope. Montages faits à la main, comparés aux formules du cours et aux fiches
// techniques. node --test src/sim/analog-models.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { boardOf } from './boards.js';
import { INPUTS } from './models.js';
import { analyze } from './circuit.js';
import { solveDC, resetDynamic, setTap } from './dc.js';
import { pinKeys } from '../check/load.js';
import { genValue, genRange, rdsOn, MOSFETS } from './analog-parts.js';

const make = (type, id, inp) => ({ id, type, name: id, pins: Object.fromEntries(pinKeys(type).map(k => [k, {}])), inp: { ...(INPUTS[type] || {}), ...(inp || {}) } });
function bench() {
  const comps = [], wires = [];
  let A = null;
  return {
    comps, wires,
    add(type, inp) { const c = make(type, `${type}_${comps.length}`, inp); comps.push(c); A = null; return c; },
    wire(a, ka, b, kb) { wires.push({ a: { comp: a, key: ka }, b: { comp: b, key: kb }, progress: 1 }); A = null; },
    get A() { return A || (A = analyze(comps, wires)); },
    solve(ctx = {}) { return solveDC(comps, this.A, { prof: boardOf, pinState: () => null, sensorVolts: () => null, ...ctx }); }
  };
}
const near = (got, want, tol, what) => assert.ok(got != null && Math.abs(got - want) <= tol, `${what} : ${got} au lieu de ${want} ± ${tol}`);
const pins = map => (c, k) => (boardOf(c) ? map[k] || null : null);

test('Générateur : valeur moyenne sur un pas, plage, continu = décalage', () => {
  near(genValue({ wave: 'sine', freq: 1, amp: 2, off: 1 }, 0.25), 3, 1e-9, 'crête');
  near(genValue({ wave: 'sine', freq: 1, amp: 1, off: 0 }, 0, 0.5), 2 / Math.PI, 1e-9, 'moyenne d’une alternance');
  near(genValue({ wave: 'square', freq: 50, amp: 2.5, off: 2.5 }, 0.003), 5, 1e-9, 'carré haut');
  near(genValue({ wave: 'triangle', freq: 1, amp: 1, off: 0 }, 0.25, 0.5), 0.5, 1e-9, 'triangle');
  near(genValue({ wave: 'sine', freq: 1000, amp: 1, off: 1.5 }, 0.1234, 0.01), 1.5, 1e-9, 'période plus courte que le pas');
  assert.deepEqual(genRange({ wave: 'sine', amp: 1, off: 1.5 }), [0.5, 2.5]);
  assert.deepEqual(genRange({ wave: 'dc', amp: 1, off: 3 }), [3, 3]);
  const b = bench(), g = b.add('siggen', { wave: 'square', freq: 10, amp: 2.5, off: 2.5 }), r = b.add('res-1k');
  b.wire(g, 'OUT', r, '1'); b.wire(r, '2', g, 'GND');
  const s = b.solve();
  assert.equal(s.ok, true, 'le générateur suffit comme référence');
  near(s.volts({ comp: r, key: '1' }), 2.5 * 1000 / 1050, 1e-3, 'continu : décalage derrière 50 Ω');
  // Vérificateur : la sortie imposée (extrême de la plage).
  near(b.solve({ sensorVolts: (c, k) => (c === g && k === 'OUT' ? 5 : null) }).volts({ comp: r, key: '1' }), 5000 / 1050, 1e-3, 'valeur imposée');
});

test('Bobine 10 mH : un fil de 24 Ω en continu, courant établi en τ = L / R', () => {
  const b = bench(), g = b.add('siggen', { wave: 'dc', off: 5 }), r = b.add('res-220'), l = b.add('ind-10m');
  b.wire(g, 'OUT', r, '1'); b.wire(r, '2', l, '1'); b.wire(l, '2', g, 'GND');
  const Rt = 50 + 220 + 24, Iinf = 5 / Rt * 1000;
  near(b.solve().current(l), Iinf, 0.01, 'courant en continu (mA)');
  assert.equal(b.solve().across(l).kind, 'ind');
  // Transitoire : pas de 2 µs, comparé à I∞ (1 − e^(−t/τ)).
  resetDynamic(b.comps);
  const tau = 0.01 / Rt, h = 2e-6;
  let t = 0, worst = 0;
  for (let k = 0; k < 150; k++) {
    const s = b.solve({ dt: h, commit: true, maxSub: 1 }); t += h;
    worst = Math.max(worst, Math.abs(s.current(l) - Iinf * (1 - Math.exp(-t / tau))));
  }
  assert.ok(worst < 0.03 * Iinf, `écart max ${worst} mA (τ = ${(tau * 1e6).toFixed(1)} µs)`);
});

test('LM358 non inverseur (gain 2), saturation à VCC − 1,5 V, plage d’entrée', () => {
  const b = bench(), u = b.add('uno'), op = b.add('lm358'), g = b.add('siggen', { wave: 'dc', off: 1 }), r1 = b.add('res-10k'), r2 = b.add('res-10k');
  b.wire(op, 'VCC', u, '5V'); b.wire(op, 'GND', u, 'GND'); b.wire(g, 'GND', u, 'GND (2)');
  b.wire(g, 'OUT', op, '1IN+'); b.wire(op, '1IN-', r1, '1'); b.wire(r1, '2', u, 'GND (3)'); b.wire(op, '1OUT', r2, '1'); b.wire(r2, '2', op, '1IN-');
  let s = b.solve();
  near(s.volts({ comp: op, key: '1OUT' }), 2, 1e-3, 'sortie = 2 × 1 V');
  near(s.volts({ comp: op, key: '1IN-' }), 1, 1e-3, 'entrées au même potentiel (contre-réaction)');
  assert.equal(s.across(op).extra.chans[0].state, 'lin');
  g.inp.off = 2.2; s = b.solve();
  near(s.volts({ comp: op, key: '1OUT' }), 3.5, 0.01, 'saturée à 5 − 1,5 V');
  assert.equal(s.across(op).extra.chans[0].state, 'high');
  g.inp.off = -0.2; s = b.solve();
  near(s.volts({ comp: op, key: '1OUT' }), 0.005, 0.002, 'saturée en bas (5 mV)');
  // Suiveur avec une entrée au-dessus de VCC − 1,5 V : l'entrée est bornée, la sortie aussi.
  const f = bench(), uf = f.add('uno'), of = f.add('lm358'), gf = f.add('siggen', { wave: 'dc', off: 4.5 });
  f.wire(of, 'VCC', uf, '5V'); f.wire(of, 'GND', uf, 'GND'); f.wire(gf, 'GND', uf, 'GND (2)');
  f.wire(gf, 'OUT', of, '2IN+'); f.wire(of, '2OUT', of, '2IN-');
  const sf = f.solve(), ch = sf.across(of).extra.chans[0];
  assert.equal(ch.clip, true, 'entrée hors de sa plage de mode commun');
  near(ch.v, 3.5, 0.01, 'suiveur borné');
});

test('LM358 inverseur en alimentation simple : G = −R2 / R1 autour de VCC / 2, courant de sortie pris sur VCC', () => {
  const b = bench(), u = b.add('uno'), op = b.add('lm358'), g = b.add('siggen', { wave: 'dc', off: 2.7 });
  const ra = b.add('res-10k'), rb = b.add('res-10k'), r1 = b.add('res-1k'), r2 = b.add('res-4k7'), rl = b.add('res-1k');
  b.wire(op, 'VCC', u, '5V'); b.wire(op, 'GND', u, 'GND'); b.wire(g, 'GND', u, 'GND (2)');
  b.wire(ra, '1', u, '3V3'); // pont de référence alimenté autrement : 3,3 V / 2
  b.wire(ra, '2', op, '1IN+'); b.wire(rb, '1', op, '1IN+'); b.wire(rb, '2', u, 'GND (3)');
  b.wire(g, 'OUT', r1, '1'); b.wire(r1, '2', op, '1IN-'); b.wire(r2, '1', op, '1IN-'); b.wire(r2, '2', op, '1OUT');
  b.wire(rl, '1', op, '1OUT'); b.wire(rl, '2', u, 'GND (4)');
  const s = b.solve(), vref = 1.65, vin = 2.7, want = vref - (4700 / 1050) * (vin - vref);
  near(s.volts({ comp: op, key: '1OUT' }), Math.max(0.005, want), 0.01, 'sortie inverseuse');
  g.inp.off = 1.5;
  const s2 = b.solve(), w2 = vref - (4700 / 1050) * (1.5 - vref), vo = s2.volts({ comp: op, key: '1OUT' });
  near(vo, w2, 0.01, 'sortie inverseuse (2)');
  // La charge de 1 kΩ tire vo / 1 kΩ, fourni par VCC : la broche VCC du LM358 l'injecte en plus de sa consommation.
  const inj = s2.injections(), iv = -(inj.get(`${op.id}|VCC`) || 0);
  assert.ok(iv > vo / 1000 * 1000 * 0.9, `courant pris sur VCC : ${iv} mA`);
});

test('IRLZ44N : RDS(on) de la fiche à 4 et 5 V, bloqué sous le seuil, diode interne', () => {
  near(rdsOn(MOSFETS.irlz44n, 5), 0.025, 1e-6, 'RDS(on) à 5 V'); near(rdsOn(MOSFETS.irlz44n, 4), 0.035, 1e-6, 'à 4 V'); near(rdsOn(MOSFETS.irlz44n, 10), 0.022, 1e-6, 'à 10 V');
  for (const [board, pin, vg] of [['uno', 'D9', 5], ['esp32', 'D13', 3.3]]) {
    const b = bench(), u = b.add(board), q = b.add('irlz44n'), rl = b.add('res-22'), bat = b.add('bat9v');
    b.wire(u, pin, q, 'G'); b.wire(q, 'S', u, 'GND'); b.wire(bat, '-', u, 'GND (2)'); b.wire(bat, '+', rl, '1'); b.wire(rl, '2', q, 'D');
    const s = b.solve({ pinState: pins({ [pin]: { mode: 1, d: 1, pwm: null } }) }), a = s.across(q);
    assert.equal(a.extra.state, 'on', board);
    const rds = 0.0875 / (vg - 1.5), id = 9 / (22 + 1.5 + Math.max(0.022, rds)) * 1000;
    near(a.extra.id, id, id * 0.01, `${board} : courant de drain`);
    near(a.extra.vds, id / 1000 * Math.max(0.022, rds), 2e-3, `${board} : VDS = ID × RDS(on)`);
    const off = b.solve({ pinState: pins({ [pin]: { mode: 1, d: 0, pwm: null } }) }).across(q);
    assert.equal(off.extra.state, 'off'); near(off.mA, 0, 1e-3, 'bloqué');
  }
  // Charge inductive coupée : la diode interne conduit quand la source passe au-dessus du drain.
  const d = bench(), u = d.add('uno'), q = d.add('irlz44n'), r = d.add('res-220');
  d.wire(q, 'D', u, 'GND'); d.wire(q, 'S', r, '1'); d.wire(r, '2', u, '5V'); d.wire(q, 'G', u, 'GND (2)');
  const sd = d.solve();
  assert.ok(sd.volts({ comp: q, key: 'S' }) > 0.6 && sd.volts({ comp: q, key: 'S' }) < 0.9, `diode interne : ${sd.volts({ comp: q, key: 'S' })} V`);
});

/** NE555 en astable RA / RB / C sur le 5 V d'un Uno, LED sur la sortie. */
function astable(ra, rb, cap) {
  const b = bench(), u = b.add('uno'), t = b.add('ne555'), a = b.add(ra), bb = b.add(rb), c = b.add(cap), rl = b.add('res-330'), led = b.add('led-red');
  b.wire(t, 'VCC', u, '5V'); b.wire(t, 'RESET', t, 'VCC'); b.wire(t, 'GND', u, 'GND');
  b.wire(a, '1', t, 'VCC'); b.wire(a, '2', t, 'DIS'); b.wire(bb, '1', t, 'DIS'); b.wire(bb, '2', t, 'THR'); b.wire(t, 'TRIG', t, 'THR');
  b.wire(c, cap === 'cap-100u' ? '+' : '1', t, 'TRIG'); b.wire(c, cap === 'cap-100u' ? '-' : '2', u, 'GND (2)');
  b.wire(t, 'OUT', rl, '1'); b.wire(rl, '2', led, 'A'); b.wire(led, 'K', u, 'GND (3)');
  return { ...b, t, c, led, b };
}

test('NE555 astable 1 kΩ / 10 kΩ / 100 µF : oscille dans la simulation en direct, f ≈ 1,44 / ((RA + 2 RB) C)', () => {
  const m = astable('res-1k', 'res-10k', 'cap-100u');
  const fr = 1.44 / ((1000 + 20000) * 100e-6), dt = 0.05;
  const rises = [], falls = [];
  let prev = null, t = 0, vmin = 9, vmax = 0;
  for (let k = 0; k < 200; k++) { // 10 s, comme 200 images de 50 ms
    const s = m.b.solve({ dt, commit: true });
    t += dt;
    const q = s.across(m.t).extra.q, vc = s.capV(m.c);
    if (t > 2) { vmin = Math.min(vmin, vc); vmax = Math.max(vmax, vc); }
    if (prev != null && q !== prev) (q ? rises : falls).push(t);
    prev = q;
    if (q) assert.equal(s.leds.get(m.led).on, true, 'LED allumée quand la sortie est haute');
  }
  assert.ok(rises.length >= 5, `${rises.length} fronts montants`);
  const per = (rises[rises.length - 1] - rises[1]) / (rises.length - 2);
  near(1 / per, fr, fr * 0.06, 'fréquence (Hz)');
  near(vmin, 5 / 3, 0.12, 'le condensateur oscille entre 1/3…'); near(vmax, 10 / 3, 0.12, '… et 2/3 de VCC');
  const s = m.b.solve();
  near(s.across(m.t).extra.cv, 10 / 3, 0.01, 'CONT à 2/3 de VCC');
  // Sortie haute : VCC − 1,4 V moins la chute dans 3 Ω (courant de la LED).
  m.t.timerQ = 1; const hi = m.b.solve().across(m.t); m.t.timerQ = 0; const lo = m.b.solve().across(m.t); m.t.timerQ = undefined;
  assert.ok(hi.v > 3.4 && hi.v < 3.6, `sortie haute ${hi.v} V`); assert.ok(lo.v < 0.1, `sortie basse ${lo.v} V`);
  assert.ok(hi.mA > 3 && hi.mA < 6, `courant de sortie ${hi.mA} mA`);
  resetDynamic(m.comps);
});

test('NE555 monostable : un appui sur TRIG donne une impulsion de 1,1 × R × C ; RESET à la masse la coupe', () => {
  const b = bench(), u = b.add('uno'), t = b.add('ne555'), r = b.add('res-10k'), c = b.add('cap-100u'), rp = b.add('res-10k'), btn = b.add('button');
  b.wire(t, 'VCC', u, '5V'); b.wire(t, 'RESET', t, 'VCC'); b.wire(t, 'GND', u, 'GND');
  b.wire(r, '1', t, 'VCC'); b.wire(r, '2', t, 'DIS'); b.wire(t, 'THR', t, 'DIS'); b.wire(c, '+', t, 'THR'); b.wire(c, '-', u, 'GND (2)');
  b.wire(rp, '1', u, '3V3'); b.wire(rp, '2', t, 'TRIG'); b.wire(btn, '1', t, 'TRIG'); b.wire(btn, '2', u, 'GND (3)');
  const dt = 0.02;
  let q = 0, t0 = null, t1 = null, time = 0;
  for (let k = 0; k < 150; k++) {
    btn.inp.pressed = k >= 25 && k < 30; // appui de 0,1 s à t = 0,5 s
    const s = solveDC(b.comps, analyze(b.comps, b.wires), { prof: boardOf, dt, commit: true });
    time += dt;
    const nq = s.across(t).extra.q;
    if (nq && !q && t0 == null) t0 = time;
    if (!nq && q && t0 != null && t1 == null) t1 = time;
    q = nq;
  }
  assert.ok(t0 != null && t1 != null, 'impulsion complète');
  near(t1 - t0, 1.1 * 10e3 * 100e-6, 0.06, 'durée de l’impulsion (s)');
  // Pendant l'impulsion, RESET à la masse la coupe aussitôt.
  resetDynamic(b.comps);
  t.dcS = { v: 0, q: 1 };
  const w = { a: { comp: t, key: 'RESET' }, b: { comp: u, key: 'GND (4)' }, progress: 1 };
  b.wires.splice(b.wires.findIndex(x => x.a.comp === t && x.a.key === 'RESET'), 1, w);
  const s = solveDC(b.comps, analyze(b.comps, b.wires), { prof: boardOf, dt, commit: true });
  assert.equal(s.across(t).extra.q, 0);
});

test('Oscilloscope : la simulation en direct relève chaque sous-pas des points suivis', () => {
  const b = bench(), g = b.add('siggen', { wave: 'sine', freq: 5, amp: 1, off: 2 }), r = b.add('res-1k'), sc = b.add('scope');
  b.wire(g, 'OUT', r, '1'); b.wire(r, '2', g, 'GND'); b.wire(sc, 'CH1', g, 'OUT');
  const got = [];
  setTap({ refs: [{ comp: sc, key: 'CH1' }, { comp: r, key: '2' }], push: f => got.push(f) });
  try {
    for (let k = 0; k < 10; k++) b.solve({ dt: 0.02, commit: true });
  } finally { setTap(null); }
  assert.equal(got.length, 10);
  assert.equal(got[0].n, 10); near(got[0].h, 0.002, 1e-12, 'pas');
  const all = got.flatMap(f => [...f.v[0]]);
  assert.ok(Math.max(...all) > 2.85 && Math.min(...all) < 1.15, `sinus relevé : ${Math.min(...all)} à ${Math.max(...all)}`);
  assert.ok(got.every(f => f.v[1].every(v => v === 0)), 'masse à 0 V');
  b.solve({ dt: 0.02, commit: true });
  assert.equal(got.length, 10, 'plus de relevé une fois le suivi coupé');
});
