// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique pure de la manipulation d'un fond de plan DXF (plan-underlay.js) : entités (par poignée DXF quand le paquet
// la porte, segEnt ; sinon chaînes de traits consécutifs reliés du même calque), choix au point et au cadre, fiche d'une
// sélection (longueur, contour fermé, aire), contours et chaînes pour la conversion, comparaison de deux versions d'un
// même plan (par poignée quand les deux en ont, sinon par géométrie arrondie au pas du paquet, calque par calque).
// Repère : celui du paquet déballé (mètres, y vers le haut), sans DOM. Testé dans underlay-edit.test.mjs.

/**
 * Entités d'un fond déballé : { of: Uint32Array (entité de chaque segment), start: Uint32Array (premier segment de
 * chaque entité, + n à la fin), n, byHandle }. Avec segEnt (paquet v2), une entité = un même identifiant ; les segments
 * d'une entité sont consécutifs dans le paquet, mais on ne le suppose pas.
 */
export function entities(un) {
  const n = un.segLayer.length, of = new Uint32Array(n), s = un.segs, L = un.segLayer, eps = (un.step || 0.001) * 0.5;
  if (un.segEnt && un.segEnt.length === n) {
    const map = new Map(); let k = 0;
    for (let i = 0; i < n; i++) { const e = un.segEnt[i]; let j = map.get(e); if (j === undefined) { j = k++; map.set(e, j); } of[i] = j; }
    return group(of, k, n, [...map.keys()]);
  }
  let k = -1;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const joined = i > 0 && L[i] === L[i - 1] && Math.abs(s[p] - s[p - 2]) <= eps && Math.abs(s[p + 1] - s[p - 1]) <= eps;
    if (!joined) k++;
    of[i] = k;
  }
  return group(of, k + 1, n, null);
}
function group(of, k, n, src) {
  const cnt = new Uint32Array(k + 1); for (let i = 0; i < n; i++) cnt[of[i] + 1]++;
  for (let j = 0; j < k; j++) cnt[j + 1] += cnt[j];
  const order = new Uint32Array(n), fill = cnt.slice(0, k);
  for (let i = 0; i < n; i++) order[fill[of[i]]++] = i;
  return { of, start: cnt, order, n: k, src };
}
/** Segments d'une entité (indices). */
export function entSegs(E, e) { return E.order.subarray(E.start[e], E.start[e + 1]); }

/** Distance d'un point à un segment. */
export function segDist(x, y, s, i) {
  const p = i * 4, ax = s[p], ay = s[p + 1], dx = s[p + 2] - ax, dy = s[p + 3] - ay, L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}
/** Entité la plus proche de (x, y) à moins de r parmi les segments candidats (itérable d'indices) ; skip(layer) : calque exclu. */
export function pick(un, E, cand, x, y, r, skip) {
  let best = -1, bd = r;
  for (const i of cand) { if (skip && skip(un.segLayer[i])) continue; const d = segDist(x, y, un.segs, i); if (d <= bd) { bd = d; best = i; } }
  return best < 0 ? -1 : E.of[best];
}
/** Entités entièrement dans le cadre [x0, y0, x1, y1] (cross = true : il suffit qu'un segment le touche). */
export function boxSelect(un, E, cand, box, cross = false, skip) {
  const [x0, y0, x1, y1] = box, s = un.segs, inB = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const touch = new Set(), out = new Set();
  for (const i of cand) {
    if (skip && skip(un.segLayer[i])) continue;
    const p = i * 4, a = inB(s[p], s[p + 1]), b = inB(s[p + 2], s[p + 3]), e = E.of[i];
    if (a || b) touch.add(e);
    if (!(a && b)) out.add(e);
  }
  if (cross) return [...touch];
  // Entités dont aucun segment ne sort du cadre (les segments hors candidats sont vérifiés aussi).
  return [...touch].filter(e => !out.has(e) && [...entSegs(E, e)].every(i => { const p = i * 4; return inB(s[p], s[p + 1]) && inB(s[p + 2], s[p + 3]); }));
}
/** Entités d'un calque. */
export function layerEnts(un, E, layer) {
  const out = new Set(); for (let i = 0; i < un.segLayer.length; i++) if (un.segLayer[i] === layer) out.add(E.of[i]); return [...out];
}

/** Aire signée d'une suite de points (x, y, x, y…). */
const area2 = P => { let a = 0; for (let i = 0, n = P.length / 2; i < n; i++) { const j = (i + 1) % n; a += P[2 * i] * P[2 * j + 1] - P[2 * j] * P[2 * i + 1]; } return a / 2; };
/**
 * Chaînes ordonnées des segments donnés (indices) : [{ pts: [x, y, …], closed }]. Deux segments se suivent quand leurs
 * bouts se touchent (à eps près). Parcours glouton, borné.
 */
export function chainsOf(un, idx, eps = 0.005) {
  const s = un.segs, key = (x, y) => Math.round(x / eps) + ',' + Math.round(y / eps), ends = new Map(), used = new Uint8Array(idx.length);
  idx.forEach((i, k) => { for (const e of [0, 1]) { const kk = key(s[i * 4 + 2 * e], s[i * 4 + 2 * e + 1]); let a = ends.get(kk); if (!a) ends.set(kk, (a = [])); a.push(k); } });
  const out = [];
  for (let k0 = 0; k0 < idx.length; k0++) {
    if (used[k0]) continue; used[k0] = 1;
    const i0 = idx[k0], pts = [s[i0 * 4], s[i0 * 4 + 1], s[i0 * 4 + 2], s[i0 * 4 + 3]];
    for (const dir of [1, 0]) { // vers l'avant depuis la fin, puis vers l'arrière depuis le début
      for (let guard = 0; guard < 200000; guard++) {
        const x = dir ? pts[pts.length - 2] : pts[0], y = dir ? pts[pts.length - 1] : pts[1];
        const k = (ends.get(key(x, y)) || []).find(q => !used[q]); if (k === undefined) break;
        used[k] = 1; const i = idx[k], p = i * 4, fwd = Math.abs(s[p] - x) <= eps && Math.abs(s[p + 1] - y) <= eps;
        const nx = fwd ? s[p + 2] : s[p], ny = fwd ? s[p + 3] : s[p + 1];
        if (dir) pts.push(nx, ny); else pts.unshift(nx, ny);
      }
    }
    const n = pts.length, closed = n >= 8 && Math.abs(pts[0] - pts[n - 2]) <= eps && Math.abs(pts[1] - pts[n - 1]) <= eps;
    out.push({ pts: closed ? pts.slice(0, n - 2) : pts, closed });
  }
  return out;
}
/**
 * Fiche d'une sélection d'entités : { ents, segs, length (m), layers: Map(calque → nombre d'entités), closed (contours
 * fermés), area (m², somme des contours fermés), box: [x0, y0, x1, y1], handles: [poignée hex…] (si connues), types }.
 */
export function selInfo(un, E, ents, step = 0.001) {
  const s = un.segs, layers = new Map(), handles = [], types = new Map();
  let segs = 0, length = 0, closed = 0, area = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of ents) {
    const idx = [...entSegs(E, e)]; if (!idx.length) continue;
    segs += idx.length;
    const l = un.segLayer[idx[0]]; layers.set(l, (layers.get(l) || 0) + 1);
    for (const i of idx) { const p = i * 4; length += Math.hypot(s[p + 2] - s[p], s[p + 3] - s[p + 1]); x0 = Math.min(x0, s[p], s[p + 2]); y0 = Math.min(y0, s[p + 1], s[p + 3]); x1 = Math.max(x1, s[p], s[p + 2]); y1 = Math.max(y1, s[p + 1], s[p + 3]); }
    for (const c of chainsOf(un, idx, step * 2)) if (c.closed) { closed++; area += Math.abs(area2(c.pts)); }
    if (E.src && un.entHandle) { const h = un.entHandle[E.src[e]]; if (Number.isFinite(h) && handles.length < 50) handles.push(h.toString(16).toUpperCase()); }
    if (E.src && un.entType) { const t = un.entType[E.src[e]]; types.set(t, (types.get(t) || 0) + 1); }
  }
  return { ents: ents.length, segs, length, layers, closed, area, box: segs ? [x0, y0, x1, y1] : null, handles, types };
}

/* ---------- Comparaison de deux versions ---------- */
/** Clé d'un segment indépendante du sens, arrondie au pas q (m). */
export function segKey(s, i, q) {
  const p = i * 4, a = Math.round(s[p] / q), b = Math.round(s[p + 1] / q), c = Math.round(s[p + 2] / q), d = Math.round(s[p + 3] / q);
  return a < c || (a === c && b <= d) ? a + ',' + b + ',' + c + ',' + d : c + ',' + d + ',' + a + ',' + b;
}
/**
 * Différences entre l'ancienne et la nouvelle version d'un fond (paquets déballés dans la même zone, donc même repère).
 * nameOf(un, layerIdx) → nom du calque (les numéros changent d'une version à l'autre, les noms restent).
 * Rend { layers: [{ name, added, removed, changed, same }] (entités ; changed : même poignée, géométrie autre),
 *        added: Float32Array (segments nouveaux), removed: Float32Array (segments disparus), byHandle, box, total }.
 * Sans poignées des deux côtés, la comparaison est géométrique : une entité modifiée compte comme retirée + ajoutée.
 */
export function diffUnderlays(a, b, nameOf, q = 0.001, cap = 200000) {
  // Par poignée seulement si les deux versions en portent vraiment (DXF R12 ou écrit sans poignées : NaN partout).
  const handled = un => { if (!un.segEnt || !un.entHandle || !un.entHandle.length) return false; let k = 0; for (const h of un.entHandle) if (Number.isFinite(h)) k++; return k >= 0.9 * un.entHandle.length; };
  const byHandle = handled(a) && handled(b);
  const stats = new Map(), st = n => { let x = stats.get(n); if (!x) stats.set(n, (x = { name: n, added: 0, removed: 0, changed: 0, same: 0 })); return x; };
  const addS = [], remS = [], s1 = a.segs, s2 = b.segs;
  let box = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (s, i) => { const p = i * 4; box = [Math.min(box[0], s[p], s[p + 2]), Math.min(box[1], s[p + 1], s[p + 3]), Math.max(box[2], s[p], s[p + 2]), Math.max(box[3], s[p + 1], s[p + 3])]; };
  const push = (arr, s, i) => { if (arr.length < cap * 4) { const p = i * 4; arr.push(s[p], s[p + 1], s[p + 2], s[p + 3]); } grow(s, i); };
  if (byHandle) {
    // Entité = poignée ; signature = calque + clés triées de ses segments.
    // Entité sans poignée : clé = sa géométrie (une entité identique se retrouve, une autre compte comme ajoutée/retirée).
    const ents = un => {
      const g = new Map();
      for (let i = 0; i < un.segLayer.length; i++) { const k = un.segEnt[i]; let e = g.get(k); if (!e) g.set(k, (e = { layer: nameOf(un, un.segLayer[i]), keys: [], idx: [], h: un.entHandle[k] })); e.keys.push(segKey(un.segs, i, q)); e.idx.push(i); }
      const m = new Map();
      for (const e of g.values()) { e.sig = e.layer + '|' + e.keys.sort().join(';'); let k = Number.isFinite(e.h) ? 'h' + e.h : 'g' + e.sig; while (m.has(k)) k += '+'; m.set(k, e); }
      return m;
    };
    const A = ents(a), B = ents(b);
    for (const [k, e] of A) {
      const f = B.get(k);
      if (!f) { st(e.layer).removed++; for (const i of e.idx) push(remS, s1, i); }
      else if (f.sig !== e.sig) { st(f.layer).changed++; for (const i of e.idx) push(remS, s1, i); for (const i of f.idx) push(addS, s2, i); }
      else st(e.layer).same++;
    }
    for (const [k, f] of B) if (!A.has(k)) { st(f.layer).added++; for (const i of f.idx) push(addS, s2, i); }
  } else {
    // Multi-ensembles de segments par calque ; on compte en segments puis en chaînes reliées (≈ entités).
    const count = new Map();
    for (let i = 0; i < a.segLayer.length; i++) { const k = nameOf(a, a.segLayer[i]) + '|' + segKey(s1, i, q); count.set(k, (count.get(k) || 0) + 1); }
    const addIdx = new Map(), remIdx = new Map(), seen = new Map();
    for (let i = 0; i < b.segLayer.length; i++) {
      const n = nameOf(b, b.segLayer[i]), k = n + '|' + segKey(s2, i, q), c = count.get(k) || 0;
      if (c > 0) { count.set(k, c - 1); seen.set(n, (seen.get(n) || 0) + 1); }
      else { let l = addIdx.get(n); if (!l) addIdx.set(n, (l = [])); l.push(i); push(addS, s2, i); }
    }
    for (let i = 0; i < a.segLayer.length; i++) {
      const n = nameOf(a, a.segLayer[i]), k = n + '|' + segKey(s1, i, q), c = count.get(k) || 0;
      if (c > 0) { count.set(k, c - 1); let l = remIdx.get(n); if (!l) remIdx.set(n, (l = [])); l.push(i); push(remS, s1, i); }
    }
    for (const [n, l] of addIdx) st(n).added = chainsOf(b, l, q * 2).length;
    for (const [n, l] of remIdx) st(n).removed = chainsOf(a, l, q * 2).length;
    for (const [n, c] of seen) st(n).same = c;
  }
  const layers = [...stats.values()].sort((x, y) => (y.added + y.removed + y.changed) - (x.added + x.removed + x.changed) || x.name.localeCompare(y.name));
  const total = layers.reduce((t, l) => ({ added: t.added + l.added, removed: t.removed + l.removed, changed: t.changed + l.changed }), { added: 0, removed: 0, changed: 0 });
  return { layers, added: Float32Array.from(addS), removed: Float32Array.from(remS), byHandle, box: box[0] <= box[2] ? box : null, total };
}

/**
 * Réglages des calques d'une nouvelle version : ceux de l'ancienne gardés par nom (visible, atténué, verrouillé, couleur
 * choisie), les nouveaux avec leur couleur. newLayers : [{ id, name, color }].
 */
export function mergeLayerSettings(oldLayers, newLayers) {
  const by = new Map((oldLayers || []).map(l => [l.name, l]));
  return (newLayers || []).map(l => { const o = by.get(l.name); return o ? { id: l.id, name: l.name, color: o.recolor ? o.color : l.color, on: o.on !== false, dim: !!o.dim, lock: !!o.lock, ...(o.recolor ? { recolor: true } : {}) } : { id: l.id, name: l.name, color: l.color, on: true, dim: false, lock: false }; });
}

/** Zone d'un fond exprimée pour un autre document : même rectangle absolu (origine + zone relative). */
export function regionFor(u, doc) {
  const o = u.origin || [0, 0], d = doc.origin || [0, 0];
  return [u.region[0] + o[0] - d[0], u.region[1] + o[1] - d[1], u.region[2] + o[0] - d[0], u.region[3] + o[1] - d[1]];
}
/** Boîtes (repère du paquet) des changements, en cases de taille c mètres fusionnées par calque : sert à reconvertir localement. */
export function changeBoxes(segs, c = 4) {
  const cells = new Map();
  for (let i = 0; i < segs.length; i += 4) for (const [x, y] of [[segs[i], segs[i + 1]], [segs[i + 2], segs[i + 3]]]) cells.set(Math.floor(x / c) + ',' + Math.floor(y / c), 1);
  return [...cells.keys()].map(k => { const [i, j] = k.split(',').map(Number); return [i * c - 0.5, j * c - 0.5, (i + 1) * c + 0.5, (j + 1) * c + 0.5]; });
}
