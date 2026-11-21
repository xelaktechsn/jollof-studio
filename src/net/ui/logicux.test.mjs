// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests des gestes du schéma logique (logicux.js) : node --test src/net/ui/logicux.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { align, distribute, copyOf, paste, freeName, guides, inMarquee } from './logicux.js';

const R = [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }, { id: 'b', x: 50, y: 20, w: 20, h: 10 }, { id: 'c', x: 100, y: 5, w: 10, h: 30 }];

test('aligner, répartir', () => {
  assert.deepEqual(align(R, 'left').map(o => o.x), [0, 0, 0]);
  assert.deepEqual(align(R, 'right').map(o => o.x), [100, 90, 100]);
  assert.deepEqual(align(R, 'top').map(o => o.y), [0, 0, 0]);
  assert.deepEqual(align(R, 'middle').map(o => o.y), [12.5, 12.5, 2.5]);
  // Répartition : écarts égaux entre a (0–10), b (largeur 20) et c (100–110) → écart 35.
  assert.deepEqual(distribute(R, 'x').map(o => [o.id, o.x]), [['a', 0], ['b', 45], ['c', 100]]);
  assert.deepEqual(align([R[0]], 'left'), []); assert.deepEqual(distribute(R.slice(0, 2), 'x'), []);
});

test('copier, coller avec ou sans les câbles, noms libres', () => {
  const data = { devices: [{ id: 'pc1', type: 'pc', name: 'PC1', x: 0, y: 0, p: {}, loc: { floor: 'f' } }, { id: 'sw1', type: 'switch', name: 'SW1', x: 0, y: 100, p: {} }, { id: 'pc2', type: 'pc', name: 'PC2', x: 50, y: 0, p: {} }],
    cables: [{ id: 'c1', a: ['pc1', 'eth0'], b: ['sw1', 'p1'] }, { id: 'c2', a: ['pc2', 'eth0'], b: ['sw1', 'p2'] }] };
  const clip = copyOf(data, ['pc1', 'sw1']);
  assert.equal(clip.devices.length, 2); assert.equal(clip.cables.length, 1);
  let k = 0; const names = new Set(data.devices.map(d => d.name));
  const o = { dx: 20, dy: 20, newId: t => t + 'x' + ++k, newName: (t, n) => { const v = freeName(names, n); names.add(v); return v; } };
  const ids = paste(data, clip, { ...o, cables: true });
  assert.equal(ids.length, 2); assert.equal(data.devices.length, 5); assert.equal(data.cables.length, 3);
  const nc = data.cables[2]; assert.deepEqual([nc.a[0], nc.b[0]], ids); assert.notEqual(nc.id, 'c1');
  assert.equal(data.devices[3].name, 'PC3'); assert.equal(data.devices[3].loc, undefined); assert.equal(data.devices[3].x, 20);
  paste(data, clip, { ...o, cables: false }); assert.equal(data.cables.length, 3); assert.equal(data.devices.length, 7);
  assert.equal(freeName(new Set(['BOX', 'BOX-2']), 'BOX'), 'BOX-3');
});

test('guides d’alignement, rectangle de sélection', () => {
  const g = guides({ x: 1, y: 40, w: 10, h: 10 }, [R[0]], 4);
  assert.equal(g.dx, -1); assert.equal(g.lines.length, 1);
  assert.equal(guides({ x: 30, y: 40, w: 10, h: 10 }, [R[0]], 4).lines.length, 0);
  assert.deepEqual(inMarquee(R, 60, 0, -5, 25), ['a', 'b']);
});
