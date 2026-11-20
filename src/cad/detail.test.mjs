// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de la finesse de maillage (detail.js) : node --test src/cad/detail.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readWithin, trisOf, budgetFor, LEVELS } from './detail.js';

const mesh = tris => ({ index: { array: new Uint32Array(tris * 3) } });
const reader = counts => { const calls = []; return { calls, read: l => { calls.push(l); const n = counts[calls.length - 1]; return n == null ? null : [mesh(n)]; } }; };

test('trisOf : somme des triangles, maillage sans indices compté pour zéro', () => {
  assert.equal(trisOf([mesh(10), mesh(5), {}]), 15);
});
test('modèle léger : une seule lecture, au niveau le plus fin', () => {
  const r = reader([40000]), out = readWithin(r.read, 250000);
  assert.equal(r.calls.length, 1); assert.equal(out.level, 0); assert.equal(out.tris, 40000); assert.equal(out.first, 40000);
});
test('modèle lourd : relu plus grossièrement jusqu’à tenir dans le budget', () => {
  const r = reader([736000, 410000, 190000, 90000]), out = readWithin(r.read, 250000);
  assert.equal(r.calls.length, 3); assert.equal(out.level, 2); assert.equal(out.tris, 190000); assert.equal(out.first, 736000);
  assert.deepEqual(r.calls[2], LEVELS[2]);
});
test('budget jamais atteint : le niveau le plus grossier est gardé', () => {
  const out = readWithin(reader([900000, 800000, 700000, 600000]).read, 1000);
  assert.equal(out.level, 3); assert.equal(out.tris, 600000);
});
test('lecture grossière qui échoue ou n’allège pas : la précédente est gardée', () => {
  assert.equal(readWithin(reader([500000, null]).read, 1000).tris, 500000);
  const same = readWithin(reader([500000, 500000, 100]).read, 1000);
  assert.equal(same.level, 0); assert.equal(same.tris, 500000);
  assert.equal(readWithin(reader([null]).read, 1000), null);
});
test('budget : plus serré en mode léger', () => { assert.ok(budgetFor(true) < budgetFor(false)); });
