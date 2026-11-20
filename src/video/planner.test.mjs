// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests des plans de caméra automatiques (planner.js), sous Node : node --test src/video/planner.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { directions, fit, project, hidden, planWire, planOverview, planAll, stillGood } from './planner.js';

const wire = (id, a, b) => ({ id, a, b, pts: [a, [a[0], a[1] + 12, a[2]], [b[0], b[1] + 12, b[2]], b] });
const inFrame = (cam, q, m = 1) => { const s = project(cam, q); return Math.abs(s.x) <= m && Math.abs(s.y) <= m; };

test('directions : vecteurs unité, hauteur de vue dans les bornes, toujours les mêmes', () => {
  const d = directions(48, 18, 72);
  assert.equal(d.length, 48);
  for (const v of d) {
    assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9);
    const el = Math.asin(v[1]) * 180 / Math.PI;
    assert.ok(el >= 18 && el <= 72);
  }
  assert.deepEqual(d, directions(48, 18, 72));
});

test('fit : tous les points tiennent dans la marge, la caméra regarde le sujet', () => {
  const pts = [[0, 0, 0], [80, 0, 0], [80, 10, 40], [0, 10, 40], [40, 30, 20]];
  for (const dir of directions(12)) {
    const cam = fit(dir, pts, { minDist: 1 });
    for (const q of pts) assert.ok(inFrame(cam, q, 0.7 + 1e-6), 'point hors de la marge');
    // Au moins un point touche la marge : la caméra n'est pas plus loin que nécessaire.
    const edge = Math.max(...pts.map(q => { const s = project(cam, q); return Math.max(Math.abs(s.x), Math.abs(s.y)); }));
    assert.ok(edge > 0.69, `cadrage trop large (${edge})`);
  }
});

test('fit : distance minimale respectée pour un petit sujet', () => {
  const cam = fit([0, 0.6, 0.8], [[0, 0, 0], [1, 0, 0]]);
  assert.ok(cam.dist >= 100);
});

test('hidden : un composant entre l’œil et la broche la cache, pas le composant qui la porte', () => {
  const wall = { min: [-20, 0, 10], max: [20, 40, 14] };
  assert.equal(hidden([0, 10, 100], [0, 5, 0], [wall]), true);
  assert.equal(hidden([0, 100, 0], [0, 5, 0], [wall]), false);
  // Broche sur le dessus de sa carte : la boîte de la carte la contient, elle reste visible d'en haut.
  const board = { min: [-30, 0, -10], max: [30, 9, 10] };
  assert.equal(hidden([0, 120, 60], [0, 8, 0], [board]), false);
  // Vue de dessous à travers la carte : cachée.
  assert.equal(hidden([0, -120, 0], [0, 8, 0], [{ min: [-30, -30, -10], max: [30, 2, 10] }]), true);
});

test('planWire : contourne un obstacle et garde les deux broches dans le cadre', () => {
  // Un mur haut devant le fil (côté z positif, celui qu'on préfère sans obstacle).
  const w = wire('w1', [-15, 4, 0], [15, 4, 0]), wall = { min: [-40, 0, 12], max: [40, 60, 16] };
  const free = planWire(w, []), s = planWire(w, [wall]);
  assert.equal(free.clear, true);
  assert.equal(s.clear, true);
  assert.equal(hidden(s.p, w.a, [wall]), false);
  assert.equal(hidden(s.p, w.b, [wall]), false);
  assert.ok(inFrame(s, w.a, 0.8) && inFrame(s, w.b, 0.8));
  assert.notDeepEqual(free.dir, s.dir);
});

test('planWire : la continuité garde la direction précédente quand elle convient', () => {
  const w = wire('w1', [-15, 4, 0], [15, 4, 0]), prev = [0.6, 0.6, Math.sqrt(1 - 0.72)];
  const s = planWire(w, [], prev);
  const cos = s.dir[0] * prev[0] + s.dir[1] * prev[1] + s.dir[2] * prev[2];
  assert.ok(cos > 0.8, `la vue a trop tourné (cos ${cos})`);
});

test('planOverview : tout le montage est dans le cadre', () => {
  const boxes = [{ min: [-60, 0, -20], max: [10, 12, 20] }, { min: [40, 0, 30], max: [90, 25, 70] }];
  const ws = [wire('w1', [0, 12, 0], [50, 25, 40])];
  const o = planOverview(ws, boxes);
  for (const b of boxes) for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) assert.ok(inFrame(o, [x, y, z], 0.83));
  assert.equal(planOverview([], []), null);
});

test('planAll : fils voisins sur le même plan, fil éloigné sur un autre ; résultat stable', () => {
  const boxes = [{ min: [-40, 0, -12], max: [40, 8, 12] }, { min: [300, 0, 300], max: [360, 8, 330] }];
  const ws = [wire('w1', [-10, 8, 0], [10, 8, 5]), wire('w2', [-8, 8, 2], [12, 8, 2]), wire('w3', [310, 8, 310], [345, 8, 318])];
  const r = planAll(ws, boxes);
  assert.ok(r.overview);
  assert.deepEqual(r.shots.map(s => s.ws), [['w1', 'w2'], ['w3']]);
  assert.ok(stillGood(r.shots[0], ws[1], boxes));
  assert.equal(stillGood(r.shots[0], ws[2], boxes), false);
  assert.deepEqual(planAll(ws, boxes), r);
  for (const s of r.shots) for (const v of [...s.p, ...s.t]) assert.ok(Number.isFinite(v));
});
