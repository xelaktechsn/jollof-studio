// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Plans de caméra automatiques : pour chaque fil, la vue d'où ses deux broches se voient le mieux,
// et une vue d'ensemble pour ouvrir et fermer la vidéo. Module pur (ni DOM ni THREE) : main.js lui
// donne les emprises des composants et le tracé des fils, et reçoit des plans { p, t } comme ceux
// qu'on pose à la main. Même entrée, même résultat : rien n'est tiré au hasard.
//
// Méthode : des directions réparties sur la demi-sphère (spirale de Fibonacci), la caméra reculée
// juste assez pour cadrer le sujet, puis une note par direction : broches non cachées par un
// composant, écart des deux broches à l'écran, tracé visible, hauteur de vue agréable, et peu de
// mouvement depuis le plan d'avant. Un fil que le plan précédent montre déjà bien le garde.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const round = a => a.map(x => +x.toFixed(2));
const RAD = Math.PI / 180;

export const DEFAULTS = { fov: 36, aspect: 16 / 9, margin: 0.7, minDist: 100, pad: 20, n: 48, elMin: 18, elMax: 72 };

/** n directions (vecteurs unité, du sujet vers la caméra) entre deux hauteurs de vue, en degrés. */
export function directions(n = DEFAULTS.n, elMin = DEFAULTS.elMin, elMax = DEFAULTS.elMax) {
  const out = [], golden = Math.PI * (3 - Math.sqrt(5)), y0 = Math.sin(elMin * RAD), y1 = Math.sin(elMax * RAD);
  for (let i = 0; i < n; i++) {
    const y = y0 + (y1 - y0) * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * golden;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
}

/** Repère de la caméra pour une direction : droite, haut (l'axe y du monde reste vertical à l'image). */
function basis(dir) {
  const r = unit(cross([0, 1, 0], dir)), u = cross(dir, r);
  return { r, u };
}

/**
 * Cadre des points : caméra placée dans la direction `dir`, reculée juste assez pour que tous
 * tiennent dans la part `margin` de l'image. Rend { p, t, dist }.
 */
export function fit(dir, pts, opt = {}) {
  const o = { ...DEFAULTS, ...opt }, { r, u } = basis(dir);
  const tv = Math.tan(o.fov * RAD / 2) * o.margin, th = tv * o.aspect;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zs = 0;
  for (const q of pts) { const x = dot(q, r), y = dot(q, u); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); zs += dot(q, dir); }
  // Cible : milieu du sujet tel qu'on le voit, à sa profondeur moyenne.
  const t = add(add(add([0, 0, 0], r, (x0 + x1) / 2), u, (y0 + y1) / 2), dir, zs / pts.length);
  let dist = o.minDist;
  for (const q of pts) { const d = sub(q, t), z = dot(d, dir); dist = Math.max(dist, Math.abs(dot(d, r)) / th + z, Math.abs(dot(d, u)) / tv + z); }
  return { p: add(t, dir, dist), t, dist };
}

/** Position d'un point à l'image, de −1 à 1 sur chaque axe (hors de ces bornes : hors cadre). */
export function project(cam, q, opt = {}) {
  const o = { ...DEFAULTS, ...opt }, dir = unit(sub(cam.p, cam.t)), { r, u } = basis(dir);
  const d = sub(q, cam.p), z = -dot(d, dir), tv = Math.tan(o.fov * RAD / 2);
  if (z <= 1e-6) return { x: Infinity, y: Infinity, z };
  return { x: dot(d, r) / (z * tv * o.aspect), y: dot(d, u) / (z * tv), z };
}

/**
 * Le segment qui va de l'œil au point est-il coupé par un composant ? Une entrée dans une boîte à
 * moins de `tol` mm du point ne compte pas : une broche touche son propre composant.
 * boxes : [{ min: [x, y, z], max: [x, y, z] }]
 */
export function hidden(eye, q, boxes, tol = 6) {
  const d = sub(q, eye), L = len(d);
  if (L < 1e-6) return false;
  for (const b of boxes) {
    let t0 = 0, t1 = 1, hit = true;
    for (let k = 0; k < 3 && hit; k++) {
      if (Math.abs(d[k]) < 1e-9) { if (eye[k] < b.min[k] || eye[k] > b.max[k]) hit = false; continue; }
      let a = (b.min[k] - eye[k]) / d[k], c = (b.max[k] - eye[k]) / d[k];
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) hit = false;
    }
    if (hit && (1 - t0) * L > tol) return true;
  }
  return false;
}

/** Points à cadrer pour un fil : son tracé, et un peu d'espace autour de chaque broche. */
function subjectPts(w, pad) {
  const pts = w.pts.map(q => [...q]);
  for (const e of [w.a, w.b]) for (const k of [0, 2]) for (const s of [-pad, pad]) { const q = [...e]; q[k] += s; pts.push(q); }
  pts.push(add(w.a, [0, pad, 0]), add(w.b, [0, pad, 0]));
  return pts;
}

/** Note d'une vue pour un fil : broches visibles d'abord, puis lisibilité et continuité. */
function scoreWire(cam, dir, w, boxes, prev, o) {
  const va = hidden(cam.p, w.a, boxes) ? 0 : 1, vb = hidden(cam.p, w.b, boxes) ? 0 : 1;
  const A = project(cam, w.a, o), B = project(cam, w.b, o);
  const sep = Math.min(1, Math.hypot((A.x - B.x) * o.aspect, A.y - B.y) / (0.7 * o.aspect));
  let seen = 0; for (const q of w.pts) if (!hidden(cam.p, q, boxes, 3)) seen++;
  const el = Math.asin(Math.max(-1, Math.min(1, dir[1]))) / RAD, elev = Math.max(0, 1 - Math.abs(el - 40) / 45);
  const cont = prev ? (1 + dot(prev, dir)) / 2 : 0.5 + 0.5 * dir[2];
  return { score: 4 * (va + vb) / 2 + 1.5 * sep + (w.pts.length ? seen / w.pts.length : 1) + 0.6 * elev + 1.2 * cont + 0.4 * (0.5 + 0.5 * dir[2]), clear: va + vb === 2 };
}

/** Meilleure vue d'un fil. `prev` : direction du plan d'avant (elle est essayée en premier). */
export function planWire(w, boxes, prev = null, opt = {}) {
  const o = { ...DEFAULTS, ...opt }, pts = subjectPts(w, o.pad);
  let best = null;
  for (const dir of [...(prev ? [prev] : []), ...directions(o.n, o.elMin, o.elMax)]) {
    const cam = fit(dir, pts, o), s = scoreWire(cam, dir, w, boxes, prev, o);
    if (!best || s.score > best.score + 1e-9) best = { ...cam, dir, ...s };
  }
  return best;
}

/** Le plan en cours montre-t-il déjà bien ce fil (broches visibles, dans le cadre, pas trop petit) ? */
export function stillGood(cam, w, boxes, opt = {}) {
  const o = { ...DEFAULTS, ...opt };
  if (hidden(cam.p, w.a, boxes) || hidden(cam.p, w.b, boxes)) return false;
  for (const e of [w.a, w.b]) { const q = project(cam, e, o); if (Math.abs(q.x) > 0.8 || Math.abs(q.y) > 0.74) return false; }
  const dir = unit(sub(cam.p, cam.t));
  return fit(dir, subjectPts(w, o.pad), o).dist >= 0.45 * len(sub(cam.p, cam.t));
}

/** Vue d'ensemble : tout le montage dans le cadre, le plus de broches visibles, vu de face et d'assez haut. */
export function planOverview(wires, boxes, opt = {}) {
  const o = { ...DEFAULTS, ...opt, margin: Math.min(0.82, (opt.margin ?? DEFAULTS.margin) + 0.1) }, pts = [];
  for (const b of boxes) for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) pts.push([x, y, z]);
  for (const w of wires) pts.push(...w.pts);
  if (!pts.length) return null;
  const ends = []; for (const w of wires) ends.push(w.a, w.b);
  const step = Math.max(1, Math.ceil(ends.length / 60)), sample = ends.filter((_, i) => i % step === 0);
  let best = null, near = Infinity;
  const cands = directions(o.n, 28, 62).map(dir => ({ dir, cam: fit(dir, pts, o) }));
  for (const c of cands) near = Math.min(near, c.cam.dist);
  for (const { dir, cam } of cands) {
    let seen = 0; for (const e of sample) if (!hidden(cam.p, e, boxes)) seen++;
    const el = Math.asin(dir[1]) / RAD;
    const score = 3 * (sample.length ? seen / sample.length : 1) + 1.5 * near / cam.dist + 1.6 * (0.5 + 0.5 * dir[2]) + 0.4 * dir[0] + 0.8 * Math.max(0, 1 - Math.abs(el - 42) / 40);
    if (!best || score > best.score + 1e-9) best = { ...cam, dir, score };
  }
  return best;
}

/**
 * Tous les plans d'un montage.
 * wires : [{ id, a: [x, y, z], b: [x, y, z], pts: [[x, y, z], …] }] dans l'ordre du câblage
 * boxes : [{ min, max }] emprise de chaque composant
 * Rend { overview: { p, t } | null, shots: [{ p, t, ws: [identifiants des fils montrés], clear }] }.
 */
export function planAll(wires, boxes, opt = {}) {
  const overview = planOverview(wires, boxes, opt), shots = [];
  let cur = null;
  for (const w of wires) {
    if (cur && stillGood(cur, w, boxes, opt)) { cur.ws.push(w.id); continue; }
    const s = planWire(w, boxes, cur ? cur.dir : overview && overview.dir, opt);
    cur = { p: s.p, t: s.t, dir: s.dir, ws: [w.id], clear: s.clear };
    shots.push(cur);
  }
  return {
    overview: overview && { p: round(overview.p), t: round(overview.t) },
    shots: shots.map(s => ({ p: round(s.p), t: round(s.t), ws: s.ws, clear: s.clear }))
  };
}
