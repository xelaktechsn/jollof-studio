// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Rangement automatique des fils. Chaque fil monte de sa broche, file à angle droit
// (selon x puis z, ou z puis x) au-dessus des composants, et redescend sur l'autre broche.
// Deux fils dont les tracés se croisent ou se longent passent à des hauteurs différentes ;
// un fil qui survole la broche d'un autre passe au-dessus de son fil. Les recherches de
// voisins passent par une grille de cases (hachage spatial) : le calcul reste rapide
// avec des centaines de fils.

const CELL = 24;     // taille d'une case de la grille (mm)
const LAT = 1.8;     // deux tracés parallèles plus proches que ceci se gênent (fil de 1,1 mm)
const GAP = 2.3;     // écart vertical entre deux fils qui se croisent
const CLEAR = 2.6;   // marge au-dessus d'un composant survolé
const RISE = 4.5;    // le fil sort du connecteur, 4,5 mm au-dessus de la broche
const EPS = 0.7;
const LANE = 2.54;   // pas des couloirs (celui des broches)
const MAXL = 14;     // couloirs essayés au plus, par direction

const key = (i, j) => i * 73856093 ^ j * 19349663;
function cellsOf(x0, z0, x1, z1, pad = 0) {
  const out = [];
  const i0 = Math.floor((Math.min(x0, x1) - pad) / CELL), i1 = Math.floor((Math.max(x0, x1) + pad) / CELL);
  const j0 = Math.floor((Math.min(z0, z1) - pad) / CELL), j1 = Math.floor((Math.max(z0, z1) + pad) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) out.push(key(i, j));
  return out;
}
class Grid {
  constructor() { this.m = new Map(); }
  add(k, v) { let a = this.m.get(k); if (!a) this.m.set(k, (a = [])); a.push(v); }
  near(keys) { const s = new Set(); for (const k of keys) { const a = this.m.get(k); if (a) for (const v of a) s.add(v); } return s; }
}

/** Tracé au sol (plan xz) : segments alignés sur x ou sur z. */
function pathXZ(A, B, xFirst) {
  const dx = Math.abs(A.x - B.x), dz = Math.abs(A.z - B.z);
  if (dx < EPS || dz < EPS) return [[A.x, A.z], [B.x, B.z]]; // presque aligné : tout droit
  return xFirst ? [[A.x, A.z], [B.x, A.z], [B.x, B.z]] : [[A.x, A.z], [A.x, B.z], [B.x, B.z]];
}
const segs = p => p.slice(1).map((q, i) => [p[i], q]);
/** Deux segments alignés sur les axes se gênent-ils (croisement, ou parallèles trop proches) ? */
function clash(s, t) {
  const sh = Math.abs(s[0][1] - s[1][1]) < 1e-6, th = Math.abs(t[0][1] - t[1][1]) < 1e-6;
  const lo = (a, b) => Math.min(a, b), hi = (a, b) => Math.max(a, b);
  if (sh && th) return Math.abs(s[0][1] - t[0][1]) < LAT && lo(hi(s[0][0], s[1][0]), hi(t[0][0], t[1][0])) - hi(lo(s[0][0], s[1][0]), lo(t[0][0], t[1][0])) > -EPS;
  if (!sh && !th) return Math.abs(s[0][0] - t[0][0]) < LAT && lo(hi(s[0][1], s[1][1]), hi(t[0][1], t[1][1])) - hi(lo(s[0][1], s[1][1]), lo(t[0][1], t[1][1])) > -EPS;
  const [h, v] = sh ? [s, t] : [t, s], z = h[0][1], x = v[0][0];
  return x > lo(h[0][0], h[1][0]) - EPS && x < hi(h[0][0], h[1][0]) + EPS && z > lo(v[0][1], v[1][1]) - EPS && z < hi(v[0][1], v[1][1]) + EPS;
}
const clashPaths = (p, q) => { for (const s of segs(p)) for (const t of segs(q)) if (clash(s, t)) return true; return false; };
/** Le tracé passe-t-il au-dessus du point (x, z) (une broche) ? */
function over(p, x, z) {
  for (const [a, b] of segs(p)) {
    if (Math.abs(a[1] - b[1]) < 1e-6) { if (Math.abs(z - a[1]) < LAT && x > Math.min(a[0], b[0]) - 0.2 && x < Math.max(a[0], b[0]) + 0.2) return true; }
    else if (Math.abs(x - a[0]) < LAT && z > Math.min(a[1], b[1]) - 0.2 && z < Math.max(a[1], b[1]) + 0.2) return true;
  }
  return false;
}

/**
 * Range les fils.
 * items : [{ id, A: {x, y, z}, B: {x, y, z}, own: Set des composants des deux broches, fixed?: { p, h } }]
 *   fixed : tracé déjà calculé, gardé tel quel (pendant un glisser, seuls les fils du composant déplacé bougent).
 * boxes : [{ comp, x0, z0, x1, z1, top }] emprise et hauteur de chaque composant
 * Retourne Map id → { pts: points du fil [[x, y, z], …] (coins compris), p: tracé au sol, h: hauteur }.
 */
export function routeWires(items, boxes) {
  // Grille des composants : hauteur à franchir sous un tracé.
  const obst = new Grid();
  boxes.forEach((b, i) => cellsOf(b.x0, b.z0, b.x1, b.z1).forEach(k => obst.add(k, i)));
  const clearance = (p, own) => {
    let top = -Infinity;
    for (const [a, b] of segs(p)) {
      for (const i of obst.near(cellsOf(a[0], a[1], b[0], b[1]))) {
        const o = boxes[i]; if (own.has(o.comp) || o.top <= top) continue;
        const x0 = Math.min(a[0], b[0]) - 0.6, x1 = Math.max(a[0], b[0]) + 0.6, z0 = Math.min(a[1], b[1]) - 0.6, z1 = Math.max(a[1], b[1]) + 0.6;
        if (x1 > o.x0 && x0 < o.x1 && z1 > o.z0 && z0 < o.z1) top = o.top;
      }
    }
    return top;
  };
  // Broches de tous les fils : un tracé évite de passer au-dessus de celles des autres.
  const ends = new Grid();
  items.forEach((it, i) => { ends.add(key(Math.floor(it.A.x / CELL), Math.floor(it.A.z / CELL)), [i, it.A]); ends.add(key(Math.floor(it.B.x / CELL), Math.floor(it.B.z / CELL)), [i, it.B]); });
  const foreign = (i, p) => { let n = 0; for (const [a, b] of segs(p)) for (const [j, P] of ends.near(cellsOf(a[0], a[1], b[0], b[1], LAT))) if (j !== i && over(p, P.x, P.z)) n++; return n; };
  // Couloirs : un fil peut faire un décroché sur un couloir libre (pas de 2,54 mm) au lieu de longer ses voisins.
  const big = items.length > 300, maxl = big ? 6 : MAXL;
  const lanes = (a, b) => {
    const lo = Math.min(a, b) + LANE / 2, hi = Math.max(a, b) - LANE / 2, out = [];
    for (let v = Math.ceil(lo / LANE) * LANE; v <= hi + 1e-6; v += LANE) out.push(v);
    if (out.length <= maxl) return out;
    const step = (out.length - 1) / (maxl - 1); return Array.from({ length: maxl }, (_, k) => out[Math.round(k * step)]);
  };
  const plen = p => segs(p).reduce((t, [a, b]) => t + Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 0);
  const W = items.map((it, i) => {
    if (it.fixed) return { it, cands: [{ p: it.fixed.p }], pick: 0, base: 0, len: 0, h: it.fixed.h, fixed: true };
    const { A, B } = it, paths = [];
    if (Math.abs(A.x - B.x) < EPS || Math.abs(A.z - B.z) < EPS) paths.push(pathXZ(A, B, true));
    else if (big && Math.abs(A.x - B.x) + Math.abs(A.z - B.z) > 400) paths.push(pathXZ(A, B, true), pathXZ(A, B, false));
    else {
      paths.push(pathXZ(A, B, true), pathXZ(A, B, false));
      for (const xm of lanes(A.x, B.x)) paths.push([[A.x, A.z], [xm, A.z], [xm, B.z], [B.x, B.z]]);
      for (const zm of lanes(A.z, B.z)) paths.push([[A.x, A.z], [A.x, zm], [B.x, zm], [B.x, B.z]]);
    }
    // Hauteur à franchir et broches survolées : calculées seulement si le tracé peut encore gagner (voir cost).
    const cands = paths.map(p => ({ p, clear: undefined, under: undefined, bends: p.length - 2, len: plen(p) }));
    return { it, cands, pick: 0, base: Math.max(A.y, B.y) + RISE, len: Math.abs(A.x - B.x) + Math.abs(A.z - B.z), h: 0 };
  });
  const path = w => w.cands[w.pick].p;
  // Choix du tracé, fil par fil (les courts d'abord), puis une seconde passe qui reprend chaque fil
  // au vu de tous les autres : le moins de croisements, de broches survolées, de hauteur et de coudes.
  const chosen = new Grid(), has = W.map(w => !!w.fixed);
  const put = i => { for (const [a, b] of segs(path(W[i]))) cellsOf(a[0], a[1], b[0], b[1], LAT).forEach(k => chosen.add(k, i)); };
  W.forEach((w, i) => { if (w.fixed) put(i); });
  // Coût d'un tracé, calculé du moins cher au plus cher, abandonné dès qu'il dépasse le meilleur trouvé.
  const cost = (i, c, bound) => {
    let v = c.bends * 1.2 + c.len * 0.02;
    if (v >= bound) return Infinity;
    if (c.clear === undefined) c.clear = clearance(c.p, W[i].it.own);
    v += Math.max(0, c.clear - W[i].base) * 0.35;
    if (v >= bound) return Infinity;
    if (c.under === undefined) c.under = foreign(i, c.p);
    v += c.under * 4;
    if (v >= bound) return Infinity;
    const seen = new Set();
    for (const [a, b] of segs(c.p)) for (const j of chosen.near(cellsOf(a[0], a[1], b[0], b[1], LAT))) {
      if (j === i || !has[j] || seen.has(j)) continue;
      seen.add(j);
      if (clashPaths(c.p, path(W[j]))) { v += 10; if (v >= bound) return Infinity; }
    }
    return v;
  };
  const free = W.map((w, i) => i).filter(i => !W[i].fixed).sort((a, b) => W[a].len - W[b].len);
  const best = i => {
    // Le tracé actuel d'abord : il fixe la borne, les autres doivent faire mieux.
    const cs = W[i].cands, first = W[i].pick;
    let bi = first, bc = cost(i, cs[first], Infinity);
    cs.forEach((c, k) => { if (k === first) return; const v = cost(i, c, bc); if (v < bc) { bc = v; bi = k; } });
    return bi;
  };
  for (const i of free) { W[i].pick = best(i); has[i] = true; put(i); }
  for (const i of free) { has[i] = false; const k = best(i); has[i] = true; if (k !== W[i].pick) { W[i].pick = k; put(i); } }
  const g = new Grid(); W.forEach((w, i) => { for (const [a, b] of segs(path(w))) cellsOf(a[0], a[1], b[0], b[1], LAT).forEach(k => g.add(k, i)); });
  const conflicts = W.map((w, i) => {
    if (w.fixed) return [];
    const out = new Set();
    for (const [a, b] of segs(path(w))) for (const j of g.near(cellsOf(a[0], a[1], b[0], b[1], LAT))) if (j !== i && clashPaths(path(w), path(W[j]))) out.add(j);
    return [...out];
  });
  // Broches survolées : le fil qui passe au-dessus doit dépasser le fil qui monte de cette broche.
  const under = W.map((w, i) => {
    if (w.fixed) return [];
    const out = new Set();
    for (const [a, b] of segs(path(w))) for (const [j, P] of ends.near(cellsOf(a[0], a[1], b[0], b[1], LAT))) if (j !== i && over(path(w), P.x, P.z)) out.add(j);
    return [...out];
  });
  // Hauteurs : les fils courts et bas d'abord, chacun au plus bas sans gêner ceux déjà posés.
  for (const i of free) { const c = W[i].cands[W[i].pick]; if (c.clear === undefined) c.clear = clearance(c.p, W[i].it.own); }
  const order = free.slice().sort((a, b) => Math.max(W[a].base, W[a].cands[W[a].pick].clear + CLEAR) - Math.max(W[b].base, W[b].cands[W[b].pick].clear + CLEAR) || W[a].len - W[b].len);
  const placed = W.map(w => !!w.fixed);
  const settle = i => {
    const w = W[i];
    let h = Math.max(w.base, w.cands[w.pick].clear + CLEAR, w.h);
    for (const j of under[i]) if (placed[j]) h = Math.max(h, W[j].h + GAP);
    const hs = conflicts[i].filter(j => placed[j]).map(j => W[j].h).sort((a, b) => a - b);
    for (const y of hs) if (Math.abs(h - y) < GAP) h = y + GAP;
    // Une seconde passe : un saut au-dessus d'un fil peut retomber près d'un fil plus haut.
    for (let k = 0; k < 4; k++) { let moved = false; for (const y of hs) if (Math.abs(h - y) < GAP - 1e-6) { h = y + GAP; moved = true; } if (!moved) break; }
    return h;
  };
  for (const i of order) { W[i].h = settle(i); placed[i] = true; }
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const i of order) {
      const need = under[i].reduce((m, j) => Math.max(m, W[j].h + GAP), -Infinity);
      if (W[i].h < need - 1e-6) { W[i].h = need; W[i].h = settle(i); changed = true; }
    }
    if (!changed) break;
  }
  const out = new Map();
  for (const w of W) {
    const { A, B } = w.it, p = path(w), h = w.h, pts = [[A.x, A.y + RISE, A.z]];
    if (h - (A.y + RISE) > 0.05) pts.push([A.x, h, A.z]);
    for (const q of p.slice(1, -1)) pts.push([q[0], h, q[1]]);
    if (h - (B.y + RISE) > 0.05) pts.push([B.x, h, B.z]);
    pts.push([B.x, B.y + RISE, B.z]);
    out.set(w.it.id, { p, h, pts: pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1], q[2] - pts[i - 1][2]) > 1e-3) });
  }
  return out;
}
