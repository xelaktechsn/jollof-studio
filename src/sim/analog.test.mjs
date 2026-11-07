// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Simulation dans le temps par ngspice (WebAssembly) : charge d'un condensateur (constante de temps RC) et PWM
// lissée par un filtre RC (valeur moyenne = rapport cyclique × 5 V). node --test src/sim/analog.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { boardOf } from './boards.js';
import { analyze } from './circuit.js';
import { transient } from './analog.js';
import { loadProject } from '../check/load.js';

const at = (t, v, x) => { let i = 0; while (i < t.length - 1 && t[i] < x) i++; return v[i]; };
function rc(res, duty) {
  const data = { comps: [{ id: 'u', type: 'uno' }, { id: 'r', type: res }, { id: 'c', type: 'cap-100u' }],
    wires: [{ a: ['u', 'D9'], b: ['r', '1'] }, { a: ['r', '2'], b: ['c', '+'] }, { a: ['c', '-'], b: ['u', 'GND'] }] };
  const { comps, wires } = loadProject(data);
  const pin = duty === 1 ? { mode: 1, d: 1, pwm: null } : { mode: 1, d: 1, pwm: duty };
  const ctx = { prof: boardOf, pinState: (c, k) => (boardOf(c) && k === 'D9' ? pin : null), sensorVolts: () => null };
  return { comps, wires, ctx, cap: comps.find(c => c.id === 'c') };
}

test('Charge d’un condensateur de 100 µF par 1 kΩ : 63 % de 5 V après RC', async () => {
  const { comps, wires, ctx, cap } = rc('res-1k', 1);
  const r = await transient(comps, analyze(comps, wires), ctx, { tstop: 0.3, tstep: 0.0005 });
  const v = r.volts({ comp: cap, key: '+' }), tau = (1000 + 25) * 100e-6; // 25 Ω : sortie de la broche
  assert.ok(v && r.t.length > 100);
  assert.ok(Math.abs(at(r.t, v, tau) - 5 * (1 - Math.exp(-1))) < 0.08, `v(τ) = ${at(r.t, v, tau)}`);
  assert.ok(Math.abs(at(r.t, v, 0.29) - 5 * (1 - Math.exp(-0.29 / tau))) < 0.05);
});

test('PWM 25 % à 490 Hz filtrée par 10 kΩ / 100 µF : moyenne 1,25 V, ondulation faible', async () => {
  const { comps, wires, ctx, cap } = rc('res-10k', 0.25);
  // Condensateur déjà chargé à la valeur moyenne : on regarde le régime établi.
  cap.dcS = { v: 1.25 };
  const r = await transient(comps, analyze(comps, wires), ctx, { tstop: 0.05, tstep: 1e-5, freqOf: () => 490 });
  const v = r.volts({ comp: cap, key: '+' }), late = [];
  for (let i = 0; i < r.t.length; i++) if (r.t[i] > 0.03) late.push(v[i]);
  const mean = late.reduce((a, b) => a + b, 0) / late.length, ripple = Math.max(...late) - Math.min(...late);
  assert.ok(Math.abs(mean - 1.25) < 0.05, `moyenne ${mean}`);
  assert.ok(ripple > 0.001 && ripple < 0.05, `ondulation ${ripple}`);
  assert.match(r.deck.text, /PULSE\(0 5 /);
});
