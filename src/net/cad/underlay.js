// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fond de plan compact : une zone d'un CadDoc (dxf.js) emballée en octets pour être gardée dans le projet
// (data.blobs, voir store.js), déballée pour le dessin, et accrochage aux extrémités / intersections / milieux.
//
// packUnderlay(doc, { region, layers, toMetre, step, texts, fills }) → { meta, bytes: Uint8Array }
//   region : [x0, y0, x1, y1] en unités du dessin RELATIVES à doc.origin (défaut doc.extents) ; les segments sont
//   découpés à la zone. layers : Set (ou tableau) d'identifiants de calques du CadDoc à garder (défaut : tous sauf
//   éteints ou gelés). toMetre : défaut doc.toMetre (l'utilisateur peut corriger l'unité). step : pas de quantification
//   en mètres (défaut 0,001 = 1 mm). texts / fills : garder les textes / les remplissages (défaut oui).
// unpackUnderlay(meta, bytes) → { segs: Float32Array [x0,y0,x1,y1,…], segLayer: Uint16Array, segColor: Uint16Array,
//   texts: [{ x, y, h, rot (radians), text, layer, ha, va, mirror? }], tris: Float32Array, triLayer: Uint16Array,
//   layers: meta.layers, colors: meta.colors, bbox: [0, 0, w, h], step }
//   Coordonnées en MÈTRES relatives au coin bas-gauche de la zone, x vers la droite, y vers le HAUT (repère du dessin).
//   layer = indice dans meta.layers ({ id: indice, src: id du calque dans le CadDoc, name, color }) ; segColor 0 =
//   couleur du calque, sinon meta.colors[segColor - 1].
// snapPoints(unpacked, [x0, y0, x1, y1], { max, mids }) → [{ x, y, kind: 'end'|'int'|'mid' }] dans la boîte
//   (grille spatiale construite une fois par fond) ; nearestSnap(unpacked, x, y, r) → le meilleur point ou null.
//
// Format des octets (version 1), entiers en varint LEB128, différences signées en zigzag :
//   [1] octet de version = 1
//   nRuns, puis par suite : calque, couleur (0 = calque), nPolys, puis par polyligne : nPoints (≥ 2) et nPoints × (dx, dy)
//     en pas de quantification ; le curseur (x, y) part de (0, 0) et continue d'une polyligne à l'autre. Les segments
//     consécutifs qui se touchent sont enchaînés en polylignes (arcs et polylignes découpés le sont presque toujours).
//   nTexts, puis par texte : calque, dx, dy (curseur propre aux textes), hauteur (pas), rotation (centièmes de degré,
//     0…35999), octet (ha | va << 2 | miroir << 4), longueur UTF-8, octets UTF-8.
//   nTriRuns, puis par suite : calque, nTris, puis 3 × (dx, dy) par triangle (curseur propre aux triangles).
// Version 2 (option ents: true, si le CadDoc porte segEnt) : identique, plus l'entité DXF d'origine de chaque
//   polyligne (après nPoints : différence zigzag avec l'entité précédente ; une polyligne ne mélange jamais deux
//   entités) et de chaque texte (après l'octet de justification : entité + 1, 0 = aucune), puis une table finale
//   nEnts × (poignée + 1 (0 = sans poignée), type (indice dans meta.entTypes), calque du paquet). Déballé : segEnt,
//   entHandle (Float64Array, NaN sans poignée), entType, texts[].ent.

// Version 3 (écrite à la place de 2, 2 reste lisible) : table des entités compacte — par entité, poignée en différence
//   zigzag avec la précédente + 1 (0 = sans poignée ; les poignées croissent presque toujours), puis calque × nTypes + type.
export const UNDERLAY_VERSION = 1, UNDERLAY_VERSION_ENTS = 3;

class W {
  constructor(n = 1 << 16) { this.a = new Uint8Array(n); this.n = 0; }
  room(k) { if (this.n + k > this.a.length) { const b = new Uint8Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  byte(v) { this.room(1); this.a[this.n++] = v; }
  u(v) { // varint non signé (jusqu'à 2^53)
    this.room(10);
    while (v >= 128) { this.a[this.n++] = (v % 128) | 128; v = Math.floor(v / 128); }
    this.a[this.n++] = v;
  }
  s(v) { this.u(v < 0 ? -2 * v - 1 : 2 * v); }
  bytes(b) { this.room(b.length); this.a.set(b, this.n); this.n += b.length; }
}
class R {
  constructor(a) { this.a = a; this.p = 0; }
  u() {
    let v = 0, m = 1, b;
    do { if (this.p >= this.a.length) throw new Error('underlay: données tronquées'); b = this.a[this.p++]; v += (b & 127) * m; m *= 128; } while (b & 128);
    return v;
  }
  s() { const v = this.u(); return v % 2 ? -(v + 1) / 2 : v / 2; }
  byte() { if (this.p >= this.a.length) throw new Error('underlay: données tronquées'); return this.a[this.p++]; }
}

/** Découpe d'un segment à une boîte (Liang-Barsky) → [x0, y0, x1, y1] ou null. */
export function clipSeg(x0, y0, x1, y1, bx0, by0, bx1, by1) {
  let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
  const P = [-dx, dx, -dy, dy], Q = [x0 - bx0, bx1 - x0, y0 - by0, by1 - y0];
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Q[i] < 0) return null; continue; }
    const r = Q[i] / P[i];
    if (P[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

/** Emballe une zone d'un CadDoc. */
export function packUnderlay(doc, opts = {}) {
  const region = (opts.region || doc.extents).map(Number);
  const [rx0, ry0, rx1, ry1] = region;
  const toMetre = opts.toMetre > 0 ? opts.toMetre : doc.toMetre || 1;
  const step = opts.step > 0 ? opts.step : 0.001;
  const k = toMetre / step; // unités du dessin → pas
  const want = opts.layers ? new Set(opts.layers) : new Set(doc.layers.filter(l => !l.off && !l.frozen).map(l => l.id));
  const E = opts.ents && doc.segEnt ? doc.segEnt : null; // v2 : entités d'origine
  const emap = new Map(), ents = []; // entité du CadDoc → indice compact du paquet
  const ei = e => { if (e === 0xffffffff || e === undefined) return 0xffffffff; let i = emap.get(e); if (i === undefined) { i = ents.length; emap.set(e, i); ents.push(e); } return i; };
  const q = (v, o) => Math.round((v - o) * k);
  const map = new Map(), layers = [];
  const li = id => { let i = map.get(id); if (i === undefined) { const L = doc.layers[id] || { name: String(id), color: '#ffffff' }; i = layers.length; map.set(id, i); layers.push({ id: i, src: id, name: L.name, color: L.color }); } return i; };
  const colors = [], cmap = new Map();
  const ci = c => { if (!c) return 0; let i = cmap.get(c); if (i === undefined) { colors.push(doc.palette?.[c] || '#ffffff'); i = colors.length; cmap.set(c, i); } return i; };
  // segments gardés, regroupés par (calque, couleur), dans l'ordre du dessin
  const runs = new Map(); const S = doc.segs, n = doc.segLayer.length;
  let nseg = 0;
  for (let i = 0; i < n; i++) {
    const l = doc.segLayer[i]; if (!want.has(l)) continue;
    let x0 = S[i * 4], y0 = S[i * 4 + 1], x1 = S[i * 4 + 2], y1 = S[i * 4 + 3];
    if ((x0 < rx0 && x1 < rx0) || (x0 > rx1 && x1 > rx1) || (y0 < ry0 && y1 < ry0) || (y0 > ry1 && y1 > ry1)) continue;
    if (x0 < rx0 || x1 < rx0 || x0 > rx1 || x1 > rx1 || y0 < ry0 || y1 < ry0 || y0 > ry1 || y1 > ry1) {
      const c = clipSeg(x0, y0, x1, y1, rx0, ry0, rx1, ry1); if (!c) continue; [x0, y0, x1, y1] = c;
    }
    const a = q(x0, rx0), b = q(y0, ry0), c = q(x1, rx0), d = q(y1, ry0);
    if (a === c && b === d) continue;
    const key = li(l) * 65536 + ci(doc.segColor ? doc.segColor[i] : 0);
    let r = runs.get(key); if (!r) runs.set(key, r = E ? { p: [], e: [] } : []);
    if (E) { r.p.push(a, b, c, d); r.e.push(ei(E[i])); } else r.push(a, b, c, d);
    nseg++;
  }
  const w = new W(); w.byte(E ? UNDERLAY_VERSION_ENTS : UNDERLAY_VERSION);
  w.u(runs.size);
  let px = 0, py = 0;
  let pe = 0;
  for (const [key, rr] of runs) {
    w.u(Math.floor(key / 65536)); w.u(key % 65536);
    const r = E ? rr.p : rr, re = E ? rr.e : null;
    // enchaînement : une polyligne continue tant que le début du segment suivant est la fin du précédent (et, en v2,
    // qu'il vient de la même entité)
    const polys = [], pent = [];
    let cur = null;
    for (let i = 0, j = 0; i < r.length; i += 4, j++) {
      if (cur && cur[cur.length - 2] === r[i] && cur[cur.length - 1] === r[i + 1] && (!re || re[j] === pent[pent.length - 1])) cur.push(r[i + 2], r[i + 3]);
      else { cur = [r[i], r[i + 1], r[i + 2], r[i + 3]]; polys.push(cur); if (re) pent.push(re[j]); }
    }
    w.u(polys.length);
    polys.forEach((p, k) => {
      w.u(p.length / 2);
      if (re) { const e = pent[k] === 0xffffffff ? -1 : pent[k]; w.s(e - pe); pe = e; }
      for (let i = 0; i < p.length; i += 2) { w.s(p[i] - px); w.s(p[i + 1] - py); px = p[i]; py = p[i + 1]; }
    });
  }
  // textes
  const enc = new TextEncoder(), T = [];
  if (opts.texts !== false) for (const t of doc.texts) {
    if (!want.has(t.layer) || t.x < rx0 || t.x > rx1 || t.y < ry0 || t.y > ry1 || !t.text) continue;
    T.push(t);
  }
  w.u(T.length); let tx = 0, ty = 0;
  for (const t of T) {
    const x = q(t.x, rx0), y = q(t.y, ry0);
    w.u(li(t.layer)); w.s(x - tx); w.s(y - ty); tx = x; ty = y;
    w.u(Math.max(0, Math.round(t.h * k)));
    w.u(((Math.round(t.rot * 18000 / Math.PI) % 36000) + 36000) % 36000);
    w.byte((t.ha & 3) | ((t.va & 3) << 2) | (t.mirror ? 16 : 0));
    if (E) { const e = t.ent === undefined ? 0xffffffff : ei(t.ent); w.u(e === 0xffffffff ? 0 : e + 1); }
    const b = enc.encode(String(t.text).slice(0, 4000)); w.u(b.length); w.bytes(b);
  }
  // triangles de remplissage (gardés si leurs trois sommets sont dans la zone)
  const truns = new Map(); let ntri = 0;
  if (opts.fills !== false && doc.fills) {
    const F = doc.fills.tris, FL = doc.fills.layer;
    for (let i = 0; i < FL.length; i++) {
      if (!want.has(FL[i])) continue;
      let ok = true; for (let j = 0; j < 3; j++) { const x = F[i * 6 + j * 2], y = F[i * 6 + j * 2 + 1]; if (x < rx0 || x > rx1 || y < ry0 || y > ry1) { ok = false; break; } }
      if (!ok) continue;
      const l = li(FL[i]); let r = truns.get(l); if (!r) truns.set(l, r = []);
      for (let j = 0; j < 6; j += 2) r.push(q(F[i * 6 + j], rx0), q(F[i * 6 + j + 1], ry0));
      ntri++;
    }
  }
  w.u(truns.size); let fx = 0, fy = 0;
  for (const [l, r] of truns) {
    w.u(l); w.u(r.length / 6);
    for (let i = 0; i < r.length; i += 2) { w.s(r[i] - fx); w.s(r[i + 1] - fy); fx = r[i]; fy = r[i + 1]; }
  }
  const entTypes = [];
  if (E) { // table des entités : poignée, type, calque
    const tmap = new Map(), tl = [];
    for (const e of ents) {
      const tn = doc.entTypes ? doc.entTypes[doc.entType[e]] : '';
      let t = tmap.get(tn); if (t === undefined) { t = entTypes.length; entTypes.push(tn); tmap.set(tn, t); }
      tl.push(t, doc.entLayer ? li(doc.entLayer[e]) : 0);
    }
    const NT = Math.max(1, entTypes.length);
    w.u(ents.length); w.u(NT); let ph = 0;
    ents.forEach((e, k) => {
      const h = doc.entHandle ? doc.entHandle[e] : NaN;
      if (h === h && h >= 0) { const dz = h - ph; w.u((dz < 0 ? -2 * dz - 1 : 2 * dz) + 1); ph = h; } else w.u(0);
      w.u(tl[k * 2 + 1] * NT + tl[k * 2]);
    });
  }
  const bytes = w.a.slice(0, w.n);
  const meta = {
    v: UNDERLAY_VERSION, step, toMetre, origin: [...(doc.origin || [0, 0])], region: [rx0, ry0, rx1, ry1],
    size: [(rx1 - rx0) * toMetre, (ry1 - ry0) * toMetre], layers, colors, segs: nseg, texts: T.length, tris: ntri, bytes: bytes.length,
    ...(E ? { ents: ents.length, entTypes } : {})
  };
  return { meta, bytes };
}

/** Déballe un fond (mètres, relatif au coin bas-gauche de la zone, y vers le haut). */
export function unpackUnderlay(meta, bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const r = new R(bytes), v = r.byte();
  if (v !== 1 && v !== 2 && v !== 3) throw new Error('underlay: version ' + v + ' inconnue');
  const V2 = v >= 2;
  let sE = V2 ? new Uint32Array(Math.max(4, meta.segs || 0)) : null, ce = 0, pe = 0;
  const st = meta.step > 0 ? meta.step : 0.001;
  let segsA = new Float32Array(Math.max(16, (meta.segs || 0) * 4)), sL = new Uint16Array(Math.max(4, meta.segs || 0)), sC = new Uint16Array(sL.length), n = 0;
  const push = (a, b, c, d, l, col) => {
    if (n === sL.length) { const g = new Float32Array(segsA.length * 2); g.set(segsA); segsA = g; const h = new Uint16Array(sL.length * 2); h.set(sL); sL = h; const k = new Uint16Array(sC.length * 2); k.set(sC); sC = k; }
    if (sE && n === sE.length) { const g = new Uint32Array(sE.length * 2); g.set(sE); sE = g; }
    const j = n * 4; segsA[j] = a * st; segsA[j + 1] = b * st; segsA[j + 2] = c * st; segsA[j + 3] = d * st; sL[n] = l; sC[n] = col; if (sE) sE[n] = ce; n++;
  };
  let px = 0, py = 0;
  const nr = r.u();
  for (let i = 0; i < nr; i++) {
    const l = r.u(), col = r.u(), np = r.u();
    for (let p = 0; p < np; p++) {
      const m = r.u(); let lx = 0, ly = 0;
      if (V2) { pe += r.s(); ce = pe < 0 ? 0xffffffff : pe; }
      for (let k = 0; k < m; k++) {
        px += r.s(); py += r.s();
        if (k) push(lx, ly, px, py, l, col);
        lx = px; ly = py;
      }
    }
  }
  const dec = new TextDecoder(), texts = [];
  const nt = r.u(); let tx = 0, ty = 0;
  for (let i = 0; i < nt; i++) {
    const layer = r.u(); tx += r.s(); ty += r.s();
    const h = r.u() * st, rot = (r.u() * Math.PI) / 18000, f = r.byte(), te = V2 ? r.u() : 0, len = r.u();
    if (r.p + len > bytes.length) throw new Error('underlay: données tronquées');
    const text = dec.decode(bytes.subarray(r.p, r.p + len)); r.p += len;
    const t = { x: tx * st, y: ty * st, h, rot, text, layer, ha: f & 3, va: (f >> 2) & 3 };
    if (f & 16) t.mirror = true;
    if (te) t.ent = te - 1;
    texts.push(t);
  }
  const tris = [], tl = [];
  const nf = r.u(); let fx = 0, fy = 0;
  for (let i = 0; i < nf; i++) {
    const l = r.u(), m = r.u();
    for (let k = 0; k < m; k++) { for (let j = 0; j < 3; j++) { fx += r.s(); fy += r.s(); tris.push(fx * st, fy * st); } tl.push(l); }
  }
  let ent = {};
  if (V2) {
    const ne = r.u(), eh = new Float64Array(ne), et = new Uint8Array(ne), el = new Uint16Array(ne);
    if (v === 2) for (let i = 0; i < ne; i++) { const h = r.u(); eh[i] = h ? h - 1 : NaN; et[i] = r.u(); el[i] = r.u(); }
    else {
      const NT = r.u(); let ph = 0;
      for (let i = 0; i < ne; i++) {
        const z = r.u(); if (z) { const q = z - 1; ph += q % 2 ? -(q + 1) / 2 : q / 2; eh[i] = ph; } else eh[i] = NaN;
        const tl = r.u(); et[i] = tl % NT; el[i] = Math.floor(tl / NT);
      }
    }
    ent = { segEnt: sE.slice(0, n), entHandle: eh, entType: et, entLayer: el, entTypes: meta.entTypes || [] };
  }
  const size = meta.size || [0, 0];
  return { ...ent,
    segs: segsA.slice(0, n * 4), segLayer: sL.slice(0, n), segColor: sC.slice(0, n), texts,
    tris: Float32Array.from(tris), triLayer: Uint16Array.from(tl), layers: meta.layers || [], colors: meta.colors || [],
    bbox: [0, 0, size[0], size[1]], step: st
  };
}

/* ---------- accrochage ---------- */
/** Grille spatiale (CSR) des segments d'un fond déballé, construite une fois. */
function gridOf(u) {
  if (u._grid) return u._grid;
  const S = u.segs, n = S.length / 4;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < S.length; i += 2) { const x = S[i], y = S[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!(x0 <= x1)) { x0 = y0 = 0; x1 = y1 = 1; }
  const w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6);
  let cs = Math.sqrt((w * h * 6) / Math.max(1, n)); cs = Math.max(cs, Math.max(w, h) / 1024, 1e-4);
  const nx = Math.min(1024, Math.ceil(w / cs) + 1), ny = Math.min(1024, Math.ceil(h / cs) + 1);
  const cxf = x => Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / cs))), cyf = y => Math.min(ny - 1, Math.max(0, Math.floor((y - y0) / cs)));
  // cases traversées par un segment (échantillonnage à demi-case, suffisant pour l'accrochage)
  const visit = (i, fn) => {
    const ax = S[i * 4], ay = S[i * 4 + 1], bx = S[i * 4 + 2], by = S[i * 4 + 3];
    const a = cxf(Math.min(ax, bx)), b = cyf(Math.min(ay, by)), c = cxf(Math.max(ax, bx)), d = cyf(Math.max(ay, by));
    if ((c - a + 1) * (d - b + 1) <= 4) { for (let y = b; y <= d; y++) for (let x = a; x <= c; x++) fn(y * nx + x); return; }
    const m = Math.ceil((Math.hypot(bx - ax, by - ay) / cs) * 2) + 1; let last = -1;
    for (let k = 0; k <= m; k++) { const c2 = cyf(ay + ((by - ay) * k) / m) * nx + cxf(ax + ((bx - ax) * k) / m); if (c2 !== last) { fn(c2); last = c2; } }
  };
  const cnt = new Uint32Array(nx * ny + 1);
  for (let i = 0; i < n; i++) visit(i, c => { cnt[c + 1]++; });
  for (let i = 1; i <= nx * ny; i++) cnt[i] += cnt[i - 1];
  const fill = cnt.slice(0, nx * ny), items = new Uint32Array(cnt[nx * ny]);
  for (let i = 0; i < n; i++) { let prev = -1; visit(i, c => { if (c === prev) return; prev = c; items[fill[c]++] = i; }); }
  const g = { x0, y0, cs, nx, ny, start: cnt, items, cxf, cyf, stamp: new Uint32Array(n), tick: 0 };
  Object.defineProperty(u, '_grid', { value: g, enumerable: false, configurable: true });
  return g;
}

/** Points d'accrochage dans une boîte : extrémités, intersections, milieux (mids: false pour les omettre). */
export function snapPoints(u, bbox, { max = 2000, mids = true } = {}) {
  const S = u.segs; if (!S || !S.length) return [];
  const g = gridOf(u), [bx0, by0, bx1, by1] = bbox;
  const a = g.cxf(bx0), b = g.cyf(by0), c = g.cxf(bx1), d = g.cyf(by1);
  const out = [], seen = new Set(), tol = g.cs * 1e-4 + 1e-6;
  const add = (x, y, kind) => {
    if (x < bx0 || x > bx1 || y < by0 || y > by1 || out.length >= max) return;
    const key = Math.round(x / tol) + ':' + Math.round(y / tol); if (seen.has(key)) return; seen.add(key);
    out.push({ x, y, kind });
  };
  if (++g.tick === 0xffffffff) { g.stamp.fill(0); g.tick = 1; }
  const T = g.tick;
  for (let y = b; y <= d; y++) for (let x = a; x <= c; x++) {
    const cell = y * g.nx + x, s0 = g.start[cell], s1 = g.start[cell + 1];
    for (let k = s0; k < s1; k++) {
      const i = g.items[k]; if (g.stamp[i] === T) continue; g.stamp[i] = T;
      add(S[i * 4], S[i * 4 + 1], 'end'); add(S[i * 4 + 2], S[i * 4 + 3], 'end');
    }
  }
  // intersections : par case, paires de segments de la case, point gardé s'il tombe dans cette case
  for (let y = b; y <= d && out.length < max; y++) for (let x = a; x <= c; x++) {
    const cell = y * g.nx + x, s0 = g.start[cell], s1 = g.start[cell + 1];
    if (s1 - s0 < 2 || s1 - s0 > 96) continue;
    const cx0 = g.x0 + x * g.cs, cy0 = g.y0 + y * g.cs;
    for (let p = s0; p < s1; p++) for (let q = p + 1; q < s1; q++) {
      const i = g.items[p], j = g.items[q];
      const r = segX(S[i * 4], S[i * 4 + 1], S[i * 4 + 2], S[i * 4 + 3], S[j * 4], S[j * 4 + 1], S[j * 4 + 2], S[j * 4 + 3]);
      if (r && r[0] >= cx0 && r[0] < cx0 + g.cs && r[1] >= cy0 && r[1] < cy0 + g.cs) add(r[0], r[1], 'int');
    }
  }
  if (mids) {
    g.tick++; const T2 = g.tick;
    for (let y = b; y <= d; y++) for (let x = a; x <= c; x++) {
      const cell = y * g.nx + x;
      for (let k = g.start[cell]; k < g.start[cell + 1]; k++) {
        const i = g.items[k]; if (g.stamp[i] === T2) continue; g.stamp[i] = T2;
        add((S[i * 4] + S[i * 4 + 2]) / 2, (S[i * 4 + 1] + S[i * 4 + 3]) / 2, 'mid');
      }
    }
  }
  return out;
}

/** Intersection propre de deux segments (extrémités comprises) → [x, y] ou null (parallèles : null). */
export function segX(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12 * (Math.abs(rx * sy) + Math.abs(ry * sx) + 1e-30)) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [ax + t * rx, ay + t * ry];
}

const RANK = { end: 0, int: 1, mid: 2 };
/** Meilleur point d'accrochage à moins de r de (x, y) : extrémité, puis intersection, puis milieu (le plus proche). */
export function nearestSnap(u, x, y, r) {
  let best = null, bs = Infinity;
  for (const p of snapPoints(u, [x - r, y - r, x + r, y + r], { max: 4000 })) {
    const d = Math.hypot(p.x - x, p.y - y); if (d > r) continue;
    const s = RANK[p.kind] * r + d;
    if (s < bs) { bs = s; best = { ...p, d }; }
  }
  return best;
}
