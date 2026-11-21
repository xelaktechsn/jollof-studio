// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de l'index spatial et de l'aimantation du rendu des fonds de plan (plan-underlay-render.js).
// node --test src/net/ui/plan-underlay-render.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { segIndex, query, snapNear, ulMatrix, alignTwo, themeColor, contrast, hexRgb } from './plan-underlay-render.js';

function grid(n) { // n×n carrés de 1 m, plus une longue ligne en diagonale
  const s = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s.push(i, j, i + 1, j, i, j, i, j + 1);
  s.push(0, 0, n, n);
  return new Float32Array(s);
}
test('segIndex/query : chaque segment touché une seule fois, comme un parcours complet', () => {
  const segs = grid(60), n = segs.length / 4, ix = segIndex(segs);
  assert.equal(ix.n, n); assert.ok(ix.long.length >= 1, 'diagonale rangée à part');
  for (const [a, b, c, d] of [[10.2, 10.2, 12.8, 11.5], [-5, -5, -1, -1], [0, 0, 60, 60], [59.5, 0, 70, 3]]) {
    const got = []; query(ix, a, b, c, d, i => got.push(i));
    assert.equal(new Set(got).size, got.length, 'sans doublon');
    for (let i = 0; i < n; i++) { // tout segment qui coupe la zone est rendu
      const k = i * 4, x0 = Math.min(segs[k], segs[k + 2]), x1 = Math.max(segs[k], segs[k + 2]), y0 = Math.min(segs[k + 1], segs[k + 3]), y1 = Math.max(segs[k + 1], segs[k + 3]);
      if (x1 >= a && x0 <= c && y1 >= b && y0 <= d && (x1 - x0 < 5)) assert.ok(got.includes(i), `segment ${i} manquant pour ${[a, b, c, d]}`);
    }
  }
  const e = segIndex(new Float32Array([NaN, 0, 1, 1])); const got = []; query(e, -1, -1, 2, 2, i => got.push(i)); assert.deepEqual(got, []);
});
test('snapNear : bout de segment, puis croisement', () => {
  const segs = new Float32Array([0, 0, 10, 0, 5, -5, 5, 5, 20, 20, 30, 20]), src = { segs, segLayer: new Uint16Array([0, 0, 1]) }, ix = segIndex(segs);
  assert.deepEqual(snapNear(src, ix, 0.1, 0.05, 0.5), { x: 0, y: 0, kind: 'end' });
  const x = snapNear(src, ix, 5.2, 0.2, 0.5); assert.equal(x.kind, 'x'); assert.ok(Math.abs(x.x - 5) < 1e-6 && Math.abs(x.y) < 1e-6);
  assert.equal(snapNear(src, ix, 15, 15, 0.5), null);
  assert.equal(snapNear({ ...src, hidden: l => l === 1 }, ix, 20.1, 20, 0.5), null, 'calque caché : pas d’aimant');
});
test('segIndex : un million de segments indexés vite', () => {
  const n = 1e6, segs = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const x = (i % 1000) * 0.1, y = Math.floor(i / 1000) * 0.1; segs.set([x, y, x + 0.08, y + 0.03], i * 4); }
  const t = performance.now(), ix = segIndex(segs), ms = performance.now() - t;
  let c = 0; query(ix, 10, 10, 12, 12, () => c++);
  assert.ok(c >= 400 && c < 2000, String(c)); assert.ok(ms < 3000, ms + ' ms');
});
test('ulMatrix et alignTwo : aller-retour, alignement sur deux points', () => {
  const t = { dx: 5, dy: -2, rot: 30, scale: 2 }, T = ulMatrix(t);
  const [X, Y] = T.to(3, 4), [x, y] = T.from(X, Y); assert.ok(Math.abs(x - 3) < 1e-9 && Math.abs(y - 4) < 1e-9);
  const p1 = [0, 0], p2 = [10, 0], q1 = [100, 50], q2 = [100, 70];
  const a = alignTwo(p1, p2, q1, q2, 1, false), A = ulMatrix(a);
  for (const [p, q] of [[p1, q1], [p2, q2]]) { const r = A.to(...p); assert.ok(Math.hypot(r[0] - q[0], r[1] - q[1]) < 1e-9); }
  assert.ok(Math.abs(a.rot - 90) < 1e-9); assert.ok(Math.abs(a.scale - 2) < 1e-12);
  const k = alignTwo(p1, p2, q1, q2, 1, true), K = ulMatrix(k);
  assert.equal(k.scale, 1); const m = K.to(5, 0); assert.ok(Math.hypot(m[0] - 100, m[1] - 60) < 1e-9, 'milieux confondus');
  assert.equal(alignTwo(p1, p1, q1, q2, 1, false), null);
});
test('themeColor : couleur 7 suit le texte, contraste gardé', () => {
  const fg = [0.9, 0.9, 0.9];
  assert.equal(themeColor('#ffffff', fg, true), '#e6e6e6'); assert.equal(themeColor('#000000', [0.1, 0.1, 0.1], false), '#1a1a1a');
  assert.equal(themeColor('#ff0000', fg, true), '#ff0000');
  assert.notEqual(themeColor('#ffff00', fg, false), '#ffff00', 'jaune sur fond clair : assombri');
  assert.notEqual(themeColor('#000080', fg, true), '#000080', 'bleu nuit sur fond sombre : éclairci');
  assert.equal(themeColor('nimporte', fg, true), '#e6e6e6');
  // Contraste d'au moins 3:1 sur les fonds de l'application, teinte gardée (le jaune reste jaune-brun, pas gris).
  const light = hexRgb('#f3f5f8'), dark = hexRgb('#0f1316');
  for (const c of ['#ffff00', '#00ffff', '#c0c0c0', '#00ff00', '#ff00ff', '#ffbf00']) { const t = themeColor(c, fg, light); assert.ok(contrast(hexRgb(t), light) >= 3, c + ' → ' + t); }
  for (const c of ['#0000ff', '#000080', '#404040', '#800000']) { const t = themeColor(c, fg, dark); assert.ok(contrast(hexRgb(t), dark) >= 3, c + ' → ' + t); }
  const y = hexRgb(themeColor('#ffff00', fg, light)); assert.ok(Math.abs(y[0] - y[1]) < 0.02 && y[2] < 0.05, 'jaune assombri, même teinte');
  assert.equal(themeColor('#ff0000', fg, light), '#ff0000'.length && themeColor('#ff0000', fg, light));
});
