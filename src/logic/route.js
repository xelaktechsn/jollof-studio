// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique : tracé des fils, à angle droit. Un fil va d'une broche à une autre en passant par ses
// points de passage (via), posés par l'élève en cliquant pendant le tracé. Sans point de passage,
// un fil d'une sortie vers une entrée fait un « Z » ; vers une entrée placée en arrière (rebouclage),
// il contourne par en dessous ou au-dessus.
import { pinPos } from './elements.js';

const horiz = s => s === 'l' || s === 'r' || s === 'c';
const DIR = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1], c: [0, 0] };
/** Supprime les points en double et les points alignés. */
export function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && q[0] === p[0] && q[1] === p[1]) continue;
    if (out.length >= 2) { const o = out[out.length - 2]; if ((o[0] === q[0] && q[0] === p[0]) || (o[1] === q[1] && q[1] === p[1])) out.pop(); }
    out.push(p);
  }
  return out;
}
/**
 * Tracé entre deux points munis d'un côté de sortie (l, r, t, b, ou c pour un point libre).
 * a, b : [x, y, côté]. via : points de passage.
 */
export function route(a, b, via = []) {
  const pts = [[a[0], a[1]]];
  let cur = [a[0], a[1]], hFirst = horiz(a[2]);
  const targets = [...via.map(v => [v[0], v[1], 'c']), b];
  targets.forEach((t, i) => {
    const last = i === targets.length - 1;
    if (cur[0] === t[0] || cur[1] === t[1]) { hFirst = cur[1] !== t[1]; pts.push([t[0], t[1]]); cur = [t[0], t[1]]; return; } // après un tronçon horizontal, repartir à la verticale
    if (last && i === 0 && horiz(a[2]) && horiz(t[2]) && a[2] !== 'c' && t[2] !== 'c') {
      // Sortie → entrée sans point de passage : en Z, ou en contournant si l'entrée est en arrière.
      const da = DIR[a[2]][0], db = DIR[t[2]][0];
      const forward = da > 0 ? t[0] > cur[0] + 1 : da < 0 ? t[0] < cur[0] - 1 : true;
      if (forward && db === -da) {
        const mx = Math.round((cur[0] + t[0]) / 2);
        pts.push([mx, cur[1]], [mx, t[1]], [t[0], t[1]]);
      } else {
        const x1 = cur[0] + (da || 1), x2 = t[0] + (db || -1), my = Math.abs(cur[1] - t[1]) >= 4 ? Math.round((cur[1] + t[1]) / 2) : Math.max(cur[1], t[1]) + 3;
        pts.push([x1, cur[1]], [x1, my], [x2, my], [x2, t[1]], [t[0], t[1]]);
      }
      cur = [t[0], t[1]]; return;
    }
    // Dernier tronçon vers une broche : arriver dans l'axe de la broche.
    let h = hFirst;
    if (last && t[2] !== 'c') h = !horiz(t[2]);
    const corner = h ? [t[0], cur[1]] : [cur[0], t[1]];
    pts.push(corner, [t[0], t[1]]);
    hFirst = !h; cur = [t[0], t[1]];
  });
  return simplify(pts);
}
/** Tracé d'un fil du circuit (null si une extrémité a disparu). */
export function routeWire(circuit, w, byId = null) {
  const find = id => (byId ? byId.get(id) : circuit.elements.find(e => e.id === id));
  const ea = find(w.a[0]), eb = find(w.b[0]);
  if (!ea || !eb) return null;
  const a = pinPos(ea, w.a[1]), b = pinPos(eb, w.b[1]);
  if (!a || !b) return null;
  return route(a, b, w.via || []);
}
/** Point du tracé le plus proche de (x, y), arrondi à la grille, et le tronçon où il se trouve. */
export function nearestOnRoute(pts, x, y) {
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const px = ax === bx ? ax : Math.max(Math.min(ax, bx), Math.min(Math.max(ax, bx), Math.round(x)));
    const py = ay === by ? ay : Math.max(Math.min(ay, by), Math.min(Math.max(ay, by), Math.round(y)));
    const d = Math.hypot(px - x, py - y);
    if (!best || d < best.d) best = { x: px, y: py, seg: i, d };
  }
  return best;
}
