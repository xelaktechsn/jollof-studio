// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Capteur de courant ACS712 : primaire de 1,2 mΩ dans le calcul du circuit (dc.js), sortie VCC/2 + sensibilité × I
// (models.js), versions 5, 20 et 30 A, limites du vérificateur (J0331). node --test src/sim/acs712.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARDS } from './boards.js';
import { PARTS, ACS712, acsRange } from './parts.js';
import { MODELS, ENV, advance, sample } from './models.js';
import { analyze } from './circuit.js';
import { solveDC } from './dc.js';
import { loadProject } from '../check/load.js';
import { checkProject } from '../check/check.js';

const make = (type, id, inp = {}) => ({ id, type, name: id, inp, pins: Object.fromEntries((type === 'psu24' || type === 'bat9v' ? ['+', '-'] : /^res-/.test(type) ? ['1', '2'] : PARTS[type].pins.map(p => p.pin)).map(k => [k, {}])) });
/** Alimentation, n résistances de 22 Ω en parallèle, à travers le primaire de l'ACS712 (IP+ côté +, ou à l'envers). */
function circuit(src, n, reverse = false, inp = {}) {
  const ps = make(src, 'PS'), acs = make('acs712', 'ACS', inp), rs = Array.from({ length: n }, (_, i) => make('res-22', 'R' + i)), wires = [];
  const w = (a, ka, b, kb) => wires.push({ a: { comp: a, key: ka }, b: { comp: b, key: kb }, progress: 1 });
  const [kin, kout] = reverse ? ['IP-', 'IP+'] : ['IP+', 'IP-'];
  w(ps, '+', acs, kin);
  for (const r of rs) { w(acs, kout, r, '1'); w(r, '2', ps, '-'); }
  const comps = [ps, acs, ...rs];
  return { acs, dc: solveDC(comps, analyze(comps, wires), {}) };
}
/** Lecture du modèle sous 5 V, sur une carte 5 V. */
function read(acs, dc, current = 0) {
  ENV.current = current; acs.simS = null;
  advance(acs, MODELS.acs712, 0);
  return sample(acs, MODELS.acs712, { prof: BOARDS.uno, v: 5, io: {}, flags: {}, dc }, 0);
}

test('ACS712 : le courant du circuit traverse le primaire (1,2 mΩ) et règle la sortie', () => {
  const { acs, dc } = circuit('bat9v', 1);
  const mA = dc.current(acs);
  assert.ok(Math.abs(mA - 9 / 22 * 1000) < 40, String(mA)); // la pile a sa résistance interne
  const r = read(acs, dc);
  assert.ok(Math.abs(r.out.OUT.v - (2.5 + 0.185 * mA / 1000)) < 0.02, JSON.stringify(r.out));
  assert.equal(r.data.amps, mA / 1000);
  // Dans l'autre sens, la sortie descend sous 2,5 V.
  const back = circuit('bat9v', 1, true), r2 = read(back.acs, back.dc);
  assert.ok(back.dc.current(back.acs) < 0 && r2.out.OUT.v < 2.45, String(r2.out.OUT.v));
});

test('ACS712 : versions 5, 20, 30 A (sensibilité), saturation, courant réglé quand le primaire est hors circuit', () => {
  assert.deepEqual(Object.keys(ACS712).map(Number), [5, 20, 30]);
  assert.equal(acsRange({ inp: {} }), 5); assert.equal(acsRange({ inp: { range: 30 } }), 30); assert.equal(acsRange({ inp: { range: 7 } }), 5);
  const lone = make('acs712', 'A2', { range: 20 }), lone30 = make('acs712', 'A3', { range: 30 });
  delete lone.pins['IP+']; delete lone30.pins['IP+'];
  assert.ok(Math.abs(read(lone, null, 10).out.OUT.v - 3.5) < 0.02);
  assert.ok(Math.abs(read(lone30, null, -10).out.OUT.v - 1.84) < 0.02);
  const sat = read(make('acs712', 'A4'), null, 30);
  assert.equal(sat.out.OUT.v, 4.75);
  assert.match(sat.warn, /sature/);
});

const project = (parts, links, inp = {}) => loadProject({ comps: parts.map(([type, id]) => ({ id, type, name: id, inp: inp[id] })), wires: links.map(([a, ka, b, kb]) => ({ a: [a, ka], b: [b, kb] })) });
test('Vérificateur : J0331 quand le courant du primaire dépasse la plage de la version', () => {
  // 24 V dans cinq résistances de 22 Ω en parallèle : ≈ 5,4 A.
  const parts = [['psu24', 'PS'], ['acs712', 'ACS'], ...[0, 1, 2, 3, 4].map(i => ['res-22', 'R' + i])];
  const links = [['PS', '+', 'ACS', 'IP+'], ...[0, 1, 2, 3, 4].flatMap(i => [['ACS', 'IP-', 'R' + i, '1'], ['R' + i, '2', 'PS', '-']])];
  const r5 = checkProject(project(parts, links)), d = r5.diags.find(x => x.code === 'J0331');
  assert.ok(d && d.level === 'warning', r5.diags.map(x => x.code).join(' '));
  const r20 = checkProject(project(parts, links, { ACS: { range: 20 } }));
  assert.ok(!r20.diags.some(x => x.code === 'J0331'));
});
