// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du remplacement de composant (replace.js) : node --test src/sim/replace.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapPins, clashes, simple } from './replace.js';

test('mêmes noms : chaque fil garde sa broche', () => {
  assert.deepEqual(mapPins(['VCC', 'GND', 'OUT'], ['GND', 'OUT', 'VCC', 'NC']), { VCC: 'VCC', GND: 'GND', OUT: 'OUT' });
});
test('noms simplifiés : casse, ponctuation, suffixe de doublon', () => {
  assert.equal(simple('GND (2)'), 'gnd');
  assert.deepEqual(mapPins(['3V3', 'GND (2)'], ['3v3', 'gnd']), { '3V3': '3v3', 'GND (2)': 'gnd' });
});
test('familles : masse, alimentation, signal, bus', () => {
  assert.deepEqual(mapPins(['VCC', 'GND', 'DATA'], ['+', '-', 'S']), { VCC: '+', GND: '-', DATA: 'S' });
  assert.deepEqual(mapPins(['SDA', 'SCL', 'VIN'], ['VCC', 'GND', 'SCL', 'SDA']), { SDA: 'SDA', SCL: 'SCL', VIN: 'VCC' });
  assert.deepEqual(mapPins(['A', 'K'], ['anode', 'cathode']), { A: 'anode', K: 'cathode' });
});
test('un nom exact passe avant une famille, une broche n’est donnée qu’une fois', () => {
  const m = mapPins(['GND', 'GND (2)', 'VCC'], ['GND', 'VCC']);
  assert.equal(m.GND, 'GND'); assert.equal(m.VCC, 'VCC'); assert.equal(m['GND (2)'], null);
  assert.deepEqual(clashes(m), []);
});
test('deux pattes contre deux pattes : dans l’ordre ; sinon à choisir', () => {
  assert.deepEqual(mapPins(['1', '2'], ['P', 'N']), { 1: 'P', 2: 'N' });
  assert.deepEqual(mapPins(['X', 'Y', 'Z'], ['P', 'Q', 'R']), { X: null, Y: null, Z: null });
});
test('clashes : la même broche choisie deux fois', () => {
  assert.deepEqual(clashes({ a: 'P', b: 'P', c: 'Q', d: null }).sort(), ['a', 'b']);
});
