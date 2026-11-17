// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseValue, formatValue, valueOf, defaultValue, familyOf, acceptValue, bandsOf, nearest, ratingOf, windingOf, suggestions } from './passives.js';

const near = (a, b) => assert.ok(Math.abs(a - b) <= Math.abs(b) * 1e-9, `${a} ≠ ${b}`);

test('lecture des valeurs tapées', () => {
  near(parseValue('4k7'), 4700); near(parseValue('4,7k'), 4700); near(parseValue('4.7 kΩ'), 4700);
  near(parseValue('2M2'), 2.2e6); near(parseValue('0R47'), 0.47); near(parseValue('220'), 220);
  near(parseValue('100n'), 100e-9); near(parseValue('100 nF'), 100e-9); near(parseValue('10u'), 10e-6); near(parseValue('10µF'), 10e-6);
  near(parseValue('4n7'), 4.7e-9); near(parseValue('10 mH'), 0.01); near(parseValue('1e-6'), 1e-6);
  assert.ok(Number.isNaN(parseValue(''))); assert.ok(Number.isNaN(parseValue('abc')));
});
test('écriture des valeurs', () => {
  assert.equal(formatValue(4700, 'Ω'), '4,7 kΩ'); assert.equal(formatValue(220, 'Ω'), '220 Ω'); assert.equal(formatValue(100e-9, 'F'), '100 nF');
  assert.equal(formatValue(1e6, 'Ω'), '1 MΩ'); assert.equal(formatValue(0.01, 'H'), '10 mH'); assert.equal(formatValue(10e-12, 'F'), '10 pF');
});
test('valeur par type et par composant', () => {
  assert.equal(familyOf('res-4k7'), 'R'); assert.equal(familyOf('cap-100u'), 'C'); assert.equal(familyOf('ind-10m'), 'L'); assert.equal(familyOf('led-red'), null);
  near(defaultValue('res-4k7'), 4700); near(defaultValue('cap-100n'), 100e-9);
  near(valueOf({ type: 'res-220', inp: {} }), 220); near(valueOf({ type: 'res-220', inp: { val: 1000 } }), 1000);
  near(valueOf({ type: 'res-220', inp: { val: -5 } }), 220); // hors bornes : valeur du type
  assert.equal(acceptValue('cap-100n', '47n'), 47e-9); assert.equal(acceptValue('cap-100n', '5'), null); assert.equal(acceptValue('led-red', '1k'), null);
  assert.equal(ratingOf({ type: 'cap-100u', inp: {} }), 16); assert.equal(ratingOf({ type: 'cap-100u', inp: { vmax: 63 } }), 63); assert.equal(ratingOf({ type: 'res-1k', inp: {} }), 0);
  near(windingOf({ type: 'ind-10m', inp: {} }), 24); assert.ok(windingOf({ type: 'ind-10m', inp: { val: 1e-3 } }) < 24);
});
test('anneaux de couleur et séries', () => {
  assert.deepEqual(bandsOf(220), [2, 2, 1, 'g']); assert.deepEqual(bandsOf(4700), [4, 7, 2, 'g']); assert.deepEqual(bandsOf(10e3), [1, 0, 3, 'g']);
  assert.deepEqual(bandsOf(22), [2, 2, 0, 'g']); assert.deepEqual(bandsOf(4.7), [4, 7, 'g', 'g']); assert.deepEqual(bandsOf(1e6), [1, 0, 5, 'g']);
  near(nearest(4600), 4700); near(nearest(1.25e3), 1.2e3);
  assert.ok(suggestions('res-1k').includes(4700)); assert.ok(suggestions('cap-100u').includes(470e-6));
});
