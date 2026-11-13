// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Instantané des signaux pour la supervision : node --test src/supervision/signals.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSignals } from './signals.js';

const uno = { id: 'u1', type: 'uno', name: 'UNO', inp: {} };
const comps = [uno,
  { id: 'b', type: 'button', name: 'BTN1', inp: { pressed: true } },
  { id: 'p', type: 'pot', name: 'POT1', inp: { pos: 42 } },
  { id: 'y', type: 'coil24', name: 'Y1', inp: {}, coilOn: true },
  { id: 'k', type: 'relay', name: 'K1', inp: {}, relayOn: false },
  { id: 'l', type: 'led-red', name: 'LED1', inp: {}, led: { mat: { emissiveIntensity: 0.9 } } }];
const wires = [{ a: { comp: comps[1], key: '1' }, b: { comp: uno, key: 'D7' } }, { a: { comp: uno, key: 'D2' }, b: { comp: comps[3], key: '-' } }, { a: { comp: uno, key: 'D7' }, b: { comp: comps[2], key: '1' } }];
const app = (kind, pins) => ({
  comps: () => comps, wires: () => wires, kind: () => kind, dcPin: (id, key) => (id === 'u1' ? pins[key] ?? null : null),
  pneu: { circuit: () => ({ elements: [{ id: 'e3', type: 'cyl2', p: { label: '1A' } }, { id: 'e4', type: 'cyl1', p: {} }, { id: 'v', type: 'v52', p: {} }] }), state: () => ({ x: { e3: 0.5 } }) }
});

test('entrées, effecteurs, broches câblées et vérins ; une mesure inconnue reste absente (jamais zéro)', () => {
  const s = Object.fromEntries(collectSignals(app('epneu', { D7: 4.99 })).map(x => [x.id, x.value]));
  assert.deepEqual(s, { 'BTN1.pressed': 1, 'POT1.pos': 42, 'Y1.on': 1, 'K1.on': 0, 'LED1.on': 1, 'UNO.D7': 4.99, 'UNO.D2': null, '1A.x': 0.5, 'e4.x': 0 });
});
test('identifiants uniques ; pas de signal pneumatique hors d’un projet électropneumatique', () => {
  const list = collectSignals(app('elec', { D7: NaN }));
  assert.equal(new Set(list.map(x => x.id)).size, list.length);
  assert.ok(!list.some(x => /\.x$/.test(x.id)));
  assert.equal(list.find(x => x.id === 'UNO.D7').value, null, 'valeur non finie : absente');
});
