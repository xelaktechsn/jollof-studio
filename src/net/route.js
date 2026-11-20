// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Cheminements de câbles (chemins de câbles, dalles, conduits, goulottes, faux plafond, faux plancher, colonnes
// montantes, fourreaux extérieurs) et longueurs réelles des câbles horizontaux. Module pur (clean.js, vérifications,
// IA, vue Plans).
//
// Modèle (data.paths) : [{ id, floor, kind (PATH_KINDS), name, pts: [[x, y]…] (m, repère de l'étage), z (hauteur au-dessus
//   du sol de l'étage, m), w, h (section utile d'un chemin de câbles, mm) ou dia (diamètre intérieur d'un conduit, mm),
//   power (cheminement d'énergie : pour la séparation), circuits (nombre de circuits 230 V 20 A qu'il porte), shield
//   ('none' | 'open' | 'perforated' | 'solid' : cheminement métallique ouvert, perforé ou plein, EN 50174-2), rad (rayon
//   de courbure des coudes d'un conduit, mm, 0 = inconnu), top (colonne montante : étage du haut), to, len (fourreau
//   extérieur : étage d'arrivée et longueur, m) }]
//   Colonne montante : un seul point, relie au même endroit tous les étages du bâtiment entre floor et top.
//   Fourreau extérieur : pts[0] sur floor, pts[1] sur l'étage to (autre bâtiment), longueur len donnée.
//   Un conduit est un tronçon entre deux boîtes de tirage : un conduit plus long se dessine en plusieurs tronçons.
// Tracé d'un câble (cables[i].route) : { mode: 'auto' | 'manual', calc? }. En 'auto', applyRoutes calcule la longueur :
//   descente verticale de chaque bout jusqu'au cheminement + accès horizontal au cheminement le plus proche + plus court
//   chemin le long des cheminements de données (Dijkstra sur les polylignes, nœuds aux sommets et aux croisements ; les
//   cheminements d'énergie n'en font pas partie) + colonnes
//   montantes (hauteurs d'étage) + fourreaux extérieurs + mou de service à chaque bout (local technique, poste de travail ;
//   data.design.slack.tr / .wa, sinon SLACK_TR_M / SLACK_WA_M de lim/plan.js). Sans cheminement : distance « en équerre »
//   (|dx| + |dy| + dénivelé), signalée (calc.fallback). calc = { path, drops, slack, access (plus long accès horizontal
//   sans cheminement, m), paths: [ids], fallback }.
import { tl } from '../i18n/index.js';
import { cleanText } from '../sanitize.js';
import { floorOf, roomAt, isTechRoom, project, dist } from './site.js';
import { PLAN_LIM } from './lim/plan.js';

/** Genres de cheminements ; z, w, h, dia : valeurs proposées au dessin (modifiables, pas des normes). */
export const PATH_KINDS = {
  tray: { z: 2.7, w: 300, h: 60, name: () => tl('Chemin de câbles (tôle)') },
  basket: { z: 2.7, w: 200, h: 54, name: () => tl('Chemin de câbles en fil (dalle)') },
  conduit: { z: 2.7, dia: 25, name: () => tl('Conduit') },
  trunking: { z: 0.3, w: 100, h: 50, name: () => tl('Goulotte') },
  ceiling: { z: 2.9, name: () => tl('Faux plafond (crochets)') },
  floor: { z: -0.1, w: 300, h: 50, name: () => tl('Faux plancher') },
  riser: { z: 0, w: 300, h: 100, name: () => tl('Colonne montante') },
  outdoor: { z: -0.8, dia: 100, name: () => tl('Fourreau extérieur') }
};
export const SHIELDS = { none: () => tl('sans (plastique ou à l’air)'), open: () => tl('métallique ouvert (dalle)'), perforated: () => tl('métallique perforé'), solid: () => tl('métallique plein (capot)') };
export const isTrayKind = k => k === 'tray' || k === 'basket' || k === 'trunking' || k === 'floor' || k === 'riser';
export const isConduitKind = k => k === 'conduit' || k === 'outdoor';
export const PATH_MAX = { paths: 6000, pts: 400 };

const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
const r3 = v => Math.round(v * 1000) / 1000;
const okId = v => typeof v === 'string' && /^[\w.:-]{1,40}$/.test(v);
const pt = p => (Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) ? [r3(num(p[0], -1e4, 1e4, 0)), r3(num(p[1], -1e4, 1e4, 0))] : null);

/** Cheminements propres (voir le modèle en tête). */
export function cleanPaths(raw) {
  const out = [], used = new Set();
  for (const p of (Array.isArray(raw) ? raw : []).slice(0, PATH_MAX.paths)) {
    if (!p || typeof p !== 'object' || !okId(p.floor)) continue;
    const kind = PATH_KINDS[p.kind] ? p.kind : 'tray', K = PATH_KINDS[kind];
    let pts = (Array.isArray(p.pts) ? p.pts : []).slice(0, PATH_MAX.pts).map(pt).filter(Boolean);
    pts = pts.filter((q, i) => !i || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
    if (kind === 'riser') pts = pts.slice(0, 1); else if (kind === 'outdoor') pts = pts.slice(0, 2);
    if (kind === 'riser' ? pts.length < 1 : pts.length < 2) continue;
    let id = okId(p.id) ? p.id : ''; if (!id || used.has(id)) { let i = used.size + 1; do id = 'pa' + i++; while (used.has(id)); } used.add(id);
    const o = { id, floor: p.floor, kind, name: cleanText(String(p.name ?? ''), 40).trim(), pts, z: r3(num(p.z, -5, 30, K.z)) };
    if (K.w) { o.w = Math.round(num(p.w, 10, 2000, K.w)); o.h = Math.round(num(p.h, 10, 1000, K.h)); }
    if (K.dia) o.dia = r3(num(p.dia, 5, 500, K.dia));
    if (p.power) { o.power = true; o.circuits = Math.round(num(p.circuits, 1, 500, 1)); }
    o.shield = SHIELDS[p.shield] ? p.shield : 'none';
    if (kind === 'conduit') o.rad = Math.round(num(p.rad, 0, 5000, 0));
    if (kind === 'riser') o.top = okId(p.top) ? p.top : p.floor;
    if (kind === 'outdoor') { o.to = okId(p.to) ? p.to : p.floor; o.len = r3(num(p.len, 1, 100000, Math.max(1, dist(pts[0], pts[1])))); }
    out.push(o);
  }
  return out;
}
/** Réglage du tracé d'un câble : { mode: 'auto' | 'manual' } ou null (calc est recalculé par applyRoutes). */
export function cleanRoute(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return { mode: raw.mode === 'auto' ? 'auto' : 'manual' };
}

/* ---------- Place des équipements ---------- */
/** Hauteur d'une unité de baie (m) : 1,75 pouce. */
const U_M = 0.04445;
const DIDX = new WeakMap();
const devOf = (data, id) => {
  const L = data.devices || []; let m = DIDX.get(L);
  if (!m || m.n !== L.length) { m = new Map(L.map((d, i) => [d.id, i])); m.n = L.length; DIDX.set(L, m); }
  let i = m.get(id), d = i == null ? null : L[i];
  if (d && d.id !== id) { DIDX.delete(L); return L.find(x => x.id === id) || null; }
  return d || null;
};
/**
 * Place d'un équipement dans le bâtiment : { floor, building, x, y, z (altitude, m), h (hauteur au-dessus du sol de son
 * étage), rack? } ou null. De sa place sur un plan (loc) ou de sa baie (data.racks : x, y = centre de l'empreinte ; une baie
 * murale est posée à rack.z, 1,2 m par défaut ; une baie au sol sur un socle de 0,1 m).
 */
export function locate(data, devId) {
  const d = devOf(data, devId); if (!d) return null;
  if (d.loc) {
    const F = floorOf(data.site, d.loc.floor); if (!F) return null;
    return { floor: F.f.id, building: F.b.id, x: d.loc.x, y: d.loc.y, z: F.f.elev + d.loc.h, h: d.loc.h };
  }
  if (d.rack) {
    const r = (data.racks || []).find(k => k.id === d.rack.id); if (!r || !Number.isFinite(+r.x)) return null;
    const F = floorOf(data.site, r.floor); if (!F) return null;
    const base = r.kind === 'wall' ? num(r.z, 0, 10, 1.2) : 0.1, h = base + (Math.max(1, d.rack.u || 1) - 0.5) * U_M;
    return { floor: F.f.id, building: F.b.id, x: +r.x, y: +r.y, z: F.f.elev + h, h, rack: r.id };
  }
  return null;
}
/** Bout « local technique » d'un câble : équipement en baie, dans un local technique, ou panneau de brassage / switch. */
function isTrEnd(data, d, L) {
  if (!d) return false;
  if (L && L.rack) return true;
  if (/^(patch|fibrepanel|switch|poeswitch|l3switch|router|server)/.test(d.type)) return true;
  const F = L && floorOf(data.site, L.floor);
  return !!(F && isTechRoom(roomAt(F.f, L.x, L.y)));
}

/* ---------- Graphe des cheminements ---------- */
const TOL = 0.3; // deux cheminements à moins de 30 cm se rejoignent (croisement, raccord)
let CACHE = { key: null, g: null };
/** Signature de ce dont dépend le graphe : cheminements et étages (altitudes). */
function sigOf(data) {
  let s = JSON.stringify(data.paths || []);
  for (const b of (data.site && data.site.buildings) || []) { s += '|' + b.id + ':' + b.x + ',' + b.y; for (const f of b.floors) s += ';' + f.id + ':' + f.level + ':' + f.elev; }
  return s;
}
/** Intersection des segments ab et cd : [t, u] (0…1) ou null. */
function cross(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1], t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? [Math.max(0, Math.min(1, t)), Math.max(0, Math.min(1, u))] : null;
}
/**
 * Graphe : nœuds (x, y, étage, z relatif) et arêtes [voisin, longueur, index du cheminement]. Par étage : segments
 * (sous-segments entre nœuds) pour accrocher un équipement au cheminement le plus proche, et points (colonnes, fourreaux).
 */
export function graphOf(data) {
  const key = sigOf(data);
  if (CACHE.key === key) return CACHE.g;
  const paths = data.paths || [], X = [], Y = [], Z = [], FL = [], adj = [];
  const node = (x, y, f, z) => { X.push(x); Y.push(y); FL.push(f); Z.push(z); adj.push([]); return X.length - 1; };
  const edge = (i, j, w, p) => { adj[i].push(j, w, p); adj[j].push(i, w, p); };
  const floors = new Map(); // id → { segs: [{ a, b, i, j, p }], pts: [nœud] }
  const FD = id => { let o = floors.get(id); if (!o) floors.set(id, (o = { segs: [], pts: [] })); return o; };
  // Segments bruts par étage.
  const raw = new Map();
  paths.forEach((p, pi) => {
    // Les cheminements d'énergie ne portent pas de câbles de données : hors du graphe.
    if (p.power || p.kind === 'riser' || p.kind === 'outdoor' || !floorOf(data.site, p.floor)) return;
    let L = raw.get(p.floor); if (!L) raw.set(p.floor, (L = []));
    for (let k = 1; k < p.pts.length; k++) L.push({ a: p.pts[k - 1], b: p.pts[k], p: pi, k, cuts: [] });
  });
  for (const [fid, L] of raw) {
    // Croisements et raccords (seaux d'une grille de 4 m : pas de comparaison de tous les segments entre eux).
    const G = new Map(), cell = 4, keyOf = (i, j) => i * 100003 + j;
    L.forEach((s, si) => {
      const x0 = Math.floor((Math.min(s.a[0], s.b[0]) - TOL) / cell), x1 = Math.floor((Math.max(s.a[0], s.b[0]) + TOL) / cell);
      const y0 = Math.floor((Math.min(s.a[1], s.b[1]) - TOL) / cell), y1 = Math.floor((Math.max(s.a[1], s.b[1]) + TOL) / cell);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4000) { (G.get('big') || G.set('big', []).get('big')).push(si); return; }
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const k = keyOf(i, j); let c = G.get(k); if (!c) G.set(k, (c = [])); c.push(si); }
    });
    const seen = new Set(), big = G.get('big') || [];
    const pair = (si, sj) => {
      if (si === sj) return; const k = si < sj ? si * 1e6 + sj : sj * 1e6 + si; if (seen.has(k)) return; seen.add(k);
      const s = L[si], t = L[sj];
      if (s.p === t.p && Math.abs(s.k - t.k) <= 1) return; // segments voisins d'une même polyligne : déjà reliés
      const J = { gap: 0 };
      const c = cross(s.a, s.b, t.a, t.b);
      if (c) { s.cuts.push([c[0], J]); t.cuts.push([c[1], J]); return; }
      // Raccord : un bout à moins de TOL de l'autre segment.
      for (const [u, v, q] of [[s, t, s.a], [s, t, s.b], [t, s, t.a], [t, s, t.b]]) {
        const pr = project(q, v.a, v.b); if (pr.d > TOL) continue;
        const tu = q === u.a ? 0 : 1; J.gap = pr.d; u.cuts.push([tu, J]); v.cuts.push([pr.t, J]); return;
      }
    };
    for (const c of G.values()) for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) pair(c[i], c[j]);
    for (const si of big) for (let sj = 0; sj < L.length; sj++) pair(si, sj);
    // Nœuds : sommets des polylignes (partagés par deux segments voisins), points de coupe.
    const vtx = new Map(), D = FD(fid);
    const vnode = (s, end) => { const k = s.p + ':' + (end ? s.k : s.k - 1); let n = vtx.get(k); if (n == null) { const q = end ? s.b : s.a; n = node(q[0], q[1], fid, paths[s.p].z); vtx.set(k, n); } return n; };
    const jn = new Map(); // jonction → nœuds des deux côtés
    for (const s of L) {
      const list = [[0, vnode(s, 0)]];
      for (const [t, J] of s.cuts.sort((a, b) => a[0] - b[0])) {
        let n;
        if (t < 1e-6) n = list[0][1]; else if (t > 1 - 1e-6) n = vnode(s, 1);
        else n = node(s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t, fid, paths[s.p].z);
        if (t > 1e-6 && t < 1 - 1e-6) list.push([t, n]);
        const o = jn.get(J); if (o) o.push(n); else jn.set(J, [n]);
      }
      list.push([1, vnode(s, 1)]);
      for (let i = 1; i < list.length; i++) {
        const u = list[i - 1][1], v = list[i][1], w = Math.hypot(X[v] - X[u], Y[v] - Y[u]);
        edge(u, v, w, s.p); D.segs.push({ i: u, j: v, p: s.p });
      }
    }
    // Jonctions : passage d'un cheminement à l'autre (écart horizontal + différence de hauteur).
    for (const [J, ns] of jn) { if (ns.length < 2) continue; const [u, v] = ns; if (u !== v) edge(u, v, J.gap + Math.abs(Z[u] - Z[v]), -1); }
  }
  // Accroche d'un point au réseau d'un étage (pour les colonnes et fourreaux) : le sous-segment le plus proche.
  const hook = (fid, x, y, z) => {
    const n = node(x, y, fid, z), D = FD(fid), at = attachSeg(D, X, Y, x, y);
    if (at) { Z[n] = Z[at.s.i]; edge(n, at.s.i, at.d + at.di, -1); edge(n, at.s.j, at.d + at.dj, -1); }
    D.pts.push(n); return n;
  };
  paths.forEach((p, pi) => {
    if (p.power) return;
    if (p.kind === 'riser') {
      const A = floorOf(data.site, p.floor), B = floorOf(data.site, p.top); if (!A || !B || A.b !== B.b) return;
      const lo = Math.min(A.f.level, B.f.level), hi = Math.max(A.f.level, B.f.level), fs = A.b.floors.filter(f => f.level >= lo && f.level <= hi);
      let prev = null, pf = null;
      for (const f of fs) {
        const n = hook(f.id, p.pts[0][0], p.pts[0][1], p.z);
        if (prev != null) edge(prev, n, Math.abs(f.elev + Z[n] - (pf.elev + Z[prev])), pi);
        prev = n; pf = f;
      }
    } else if (p.kind === 'outdoor') {
      const A = floorOf(data.site, p.floor), B = floorOf(data.site, p.to); if (!A || !B) return;
      const a = hook(A.f.id, p.pts[0][0], p.pts[0][1], p.z), b = hook(B.f.id, p.pts[1][0], p.pts[1][1], p.z);
      edge(a, b, p.len, pi);
    }
  });
  const g = { X, Y, Z, FL, adj, floors, paths, dj: new Map(), at: new Map() };
  CACHE = { key, g };
  return g;
}
/** Sous-segment le plus proche de (x, y) : { s, d (accès), di, dj (le long du segment jusqu'à ses deux nœuds), t } ou null. */
function attachSeg(D, X, Y, x, y) {
  let best = null;
  for (const s of D.segs) {
    const pr = project([x, y], [X[s.i], Y[s.i]], [X[s.j], Y[s.j]]);
    if (!best || pr.d < best.d) { const L = Math.hypot(X[s.j] - X[s.i], Y[s.j] - Y[s.i]); best = { s, d: pr.d, di: pr.t * L, dj: (1 - pr.t) * L, t: pr.t }; }
  }
  return best;
}
/** Accroche d'un équipement : { seeds: [[nœud, coût]], d, z (hauteur du cheminement), seg } ou null (rien sur l'étage). */
function attach(g, fid, x, y) {
  const k = fid + '|' + x + '|' + y; if (g.at.has(k)) return g.at.get(k);
  const D = g.floors.get(fid); let r = null;
  if (D) {
    const s = attachSeg(D, g.X, g.Y, x, y);
    if (s) r = { seeds: [[s.s.i, s.di], [s.s.j, s.dj]], d: s.d, z: g.Z[s.s.i], seg: s };
    for (const n of D.pts) { const d = Math.hypot(g.X[n] - x, g.Y[n] - y); if (!r || d < r.d) r = { seeds: [[n, 0]], d, z: g.Z[n], seg: null }; }
  }
  g.at.set(k, r); return r;
}
/** Plus courts chemins depuis une accroche (tas binaire) ; mis en cache par point de départ. */
function dijkstra(g, key, seeds) {
  let c = g.dj.get(key); if (c) return c;
  const n = g.X.length, D = new Float64Array(n).fill(Infinity), P = new Int32Array(n).fill(-1), PP = new Int32Array(n).fill(-1);
  const hk = [], hv = [];
  const push = (v, d) => { hk.push(d); hv.push(v); let i = hk.length - 1; while (i) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; [hk[p], hk[i]] = [hk[i], hk[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; } };
  const pop = () => {
    const v = hv[0], d = hk[0], lk = hk.pop(), lv = hv.pop();
    if (hk.length) { hk[0] = lk; hv[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hk.length && hk[l] < hk[m]) m = l; if (r < hk.length && hk[r] < hk[m]) m = r; if (m === i) break; [hk[m], hk[i]] = [hk[i], hk[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m; } }
    return [v, d];
  };
  for (const [v, d] of seeds) if (d < D[v]) { D[v] = d; push(v, d); }
  while (hk.length) {
    const [u, d] = pop(); if (d > D[u]) continue;
    const A = g.adj[u];
    for (let i = 0; i < A.length; i += 3) { const v = A[i], nd = d + A[i + 1]; if (nd < D[v]) { D[v] = nd; P[v] = u; PP[v] = A[i + 2]; push(v, nd); } }
  }
  c = { D, P, PP }; g.dj.set(key, c); return c;
}

/* ---------- Tracé d'un câble ---------- */
const slackOf = data => {
  const s = (data.design && data.design.slack) || {};
  return { tr: num(s.tr, 0, 50, PLAN_LIM.SLACK_TR_M.v), wa: num(s.wa, 0, 50, PLAN_LIM.SLACK_WA_M.v) };
};
/**
 * Tracé d'un câble dont les deux bouts sont placés : { len, calc, legs? } ou null (un bout sans place). legs (avec
 * withLegs) : [{ floor, pts }] pour le dessiner sur les plans.
 */
export function routeCable(data, c, withLegs = false, g = graphOf(data)) {
  const da = devOf(data, c.a[0]), db = devOf(data, c.b[0]);
  const A = locate(data, c.a[0]), B = locate(data, c.b[0]); if (!A || !B) return null;
  const S = slackOf(data), trA = isTrEnd(data, da, A), trB = isTrEnd(data, db, B);
  // Départ du calcul : le bout « local technique » (beaucoup de câbles partent de la même baie : un seul Dijkstra).
  const [P, Q] = trB && !trA ? [B, A] : [A, B];
  const slack = r1((trA ? S.tr : S.wa) + (trB ? S.tr : S.wa));
  const ap = attach(g, P.floor, P.x, P.y), aq = attach(g, Q.floor, Q.x, Q.y);
  const fall = why => {
    const F = floorOf(data.site, P.floor), G = floorOf(data.site, Q.floor);
    const dx = Math.abs(Q.x + G.b.x - P.x - F.b.x), dy = Math.abs(Q.y + G.b.y - P.y - F.b.y);
    const path = r1(dx + dy + Math.abs(Q.z - P.z));
    const out = { len: clampLen(path + slack), calc: { path, drops: 0, slack, paths: [], fallback: why } };
    if (withLegs) out.legs = P.floor === Q.floor ? [{ floor: P.floor, pts: [[P.x, P.y], [Q.x, P.y], [Q.x, Q.y]], fallback: true }] : [{ floor: P.floor, pts: [[P.x, P.y]], fallback: true }, { floor: Q.floor, pts: [[Q.x, Q.y]], fallback: true }];
    return out;
  };
  if (!ap || !aq) return fall('nopath');
  const key = P.floor + '|' + P.x + '|' + P.y, dj = dijkstra(g, key, ap.seeds);
  let best = Infinity, end = -1;
  for (const [v, w] of aq.seeds) if (dj.D[v] + w < best) { best = dj.D[v] + w; end = v; }
  // Les deux bouts sur le même sous-segment : directement le long de lui.
  let direct = false;
  if (ap.seg && aq.seg && ap.seg.s === aq.seg.s) { const L = ap.seg.di + ap.seg.dj, d = Math.abs(ap.seg.t - aq.seg.t) * L; if (d <= best) { best = d; direct = true; } }
  if (!Number.isFinite(best)) return fall(P.floor === Q.floor || floorOf(data.site, P.floor).b !== floorOf(data.site, Q.floor).b ? 'nopath' : 'noriser');
  const drops = r1(ap.d + Math.abs(ap.z - P.h) + aq.d + Math.abs(aq.z - Q.h));
  // Cheminements empruntés : en remontant les prédécesseurs.
  const used = new Set(), nodes = [];
  if (direct) used.add(ap.seg.s.p);
  else {
    if (aq.seg) used.add(aq.seg.s.p);
    for (let v = end, k = 0; v >= 0 && k < 1e5; v = dj.P[v], k++) { nodes.push(v); if (dj.PP[v] >= 0) used.add(dj.PP[v]); }
    if (ap.seg) used.add(ap.seg.s.p);
  }
  const path = r1(best);
  const out = { len: clampLen(path + drops + slack), calc: { path, drops, slack, access: r1(Math.max(ap.d, aq.d)), paths: [...used].map(i => g.paths[i].id), fallback: null } };
  if (withLegs) {
    // Points dans l'ordre P → Q, coupés par étage.
    const seq = [[P.floor, P.x, P.y]];
    const projOf = a => (a && a.seg ? [g.X[a.seg.s.i] + (g.X[a.seg.s.j] - g.X[a.seg.s.i]) * a.seg.t, g.Y[a.seg.s.i] + (g.Y[a.seg.s.j] - g.Y[a.seg.s.i]) * a.seg.t] : null);
    const pa = projOf(ap), pq = projOf(aq);
    if (pa) seq.push([P.floor, pa[0], pa[1]]);
    if (!direct) for (const v of nodes.reverse()) seq.push([g.FL[v], g.X[v], g.Y[v]]);
    if (pq) seq.push([Q.floor, pq[0], pq[1]]);
    seq.push([Q.floor, Q.x, Q.y]);
    const legs = [];
    for (const [f, x, y] of seq) { const l = legs[legs.length - 1]; if (l && l.floor === f) l.pts.push([x, y]); else legs.push({ floor: f, pts: [[x, y]] }); }
    out.legs = legs;
  }
  return out;
}
const r1 = v => Math.round(v * 10) / 10;
const clampLen = v => Math.max(0.1, Math.min(100000, r1(v)));
/** Recalcule la longueur des câbles au tracé automatique (cables[i].len et route.calc). Rend data. */
export function applyRoutes(data) {
  if (!data || !Array.isArray(data.cables)) return data;
  let g = null;
  for (const c of data.cables) {
    if (!c.route) continue;
    if (c.route.mode !== 'auto') { delete c.route.calc; continue; }
    let r = null;
    try { r = routeCable(data, c, false, g || (g = graphOf(data))); } catch (e) { console.error(e); }
    if (!r) { c.route.calc = { path: 0, drops: 0, slack: 0, paths: [], fallback: 'noloc' }; continue; }
    c.len = r.len; c.route.calc = r.calc;
  }
  return data;
}
/** Distance le long des cheminements entre deux points placés (sans mou) : { len, fallback } (prises loin du local). */
export function pathDistance(data, P, Q, g = graphOf(data)) {
  const ap = attach(g, P.floor, P.x, P.y), aq = attach(g, Q.floor, Q.x, Q.y);
  if (!ap || !aq) return { len: Infinity, fallback: 'nopath' };
  const dj = dijkstra(g, P.floor + '|' + P.x + '|' + P.y, ap.seeds);
  let best = Infinity; for (const [v, w] of aq.seeds) best = Math.min(best, dj.D[v] + w);
  if (ap.seg && aq.seg && ap.seg.s === aq.seg.s) best = Math.min(best, Math.abs(ap.seg.t - aq.seg.t) * (ap.seg.di + ap.seg.dj));
  if (!Number.isFinite(best)) return { len: Infinity, fallback: 'noriser' };
  return { len: r1(best + ap.d + Math.abs(ap.z - (P.h ?? 0)) + aq.d + Math.abs(aq.z - (Q.h ?? 0))), fallback: null };
}

/* ---------- Mesures des cheminements (vérifications, inspecteur) ---------- */
/** Section d'un câble (mm²) d'après son diamètre extérieur (CABLE_OD_MM). */
export function cableArea(c) { const od = cableOd(c); return Math.PI * od * od / 4; }
export const cableOd = c => { const T = PLAN_LIM.CABLE_OD_MM.v; return c.media === 'fibre' ? T.fibre : T[c.cat] || T.cat6; };
/** Section utile d'un cheminement (mm²), ou 0 (faux plafond à crochets : compté en nombre de câbles). */
export function pathArea(p) { if (p.w && p.h) return p.w * p.h; if (p.dia) return Math.PI * p.dia * p.dia / 4; return 0; }
/** Câbles qui empruntent chaque cheminement (tracé automatique calculé) : Map id → [câbles]. */
export function cablesByPath(data) {
  const m = new Map();
  for (const c of data.cables || []) for (const id of (c.route && c.route.calc && c.route.calc.paths) || []) { let l = m.get(id); if (!l) m.set(id, (l = [])); l.push(c); }
  return m;
}
/** Remplissage d'un cheminement : { n, area (mm²), ratio, max, depth (mm, chemins de câbles) }. */
export function fillOf(p, cables) {
  const n = cables.length, area = cables.reduce((s, c) => s + cableArea(c), 0), A = pathArea(p);
  const F = PLAN_LIM.CONDUIT_FILL.v;
  const max = isConduitKind(p.kind) ? F[Math.min(3, Math.max(1, n))] : PLAN_LIM.TRAY_FILL.v;
  return { n, area, ratio: A ? area / A : 0, max, depth: p.w ? area / p.w : 0 };
}
/** Coudes d'un conduit : somme des changements de direction (degrés). */
export function bendsOf(p) {
  let s = 0;
  for (let i = 1; i < p.pts.length - 1; i++) {
    const [a, b, c] = [p.pts[i - 1], p.pts[i], p.pts[i + 1]];
    const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(t2 - t1); if (d > Math.PI) d = 2 * Math.PI - d; s += d;
  }
  return Math.round(s * 180 / Math.PI);
}
/** Facteur P de l'EN 50174-2 pour n circuits 230 V 20 A. */
export function powerFactor(n) { for (const [k, f] of PLAN_LIM.POWER_FACTOR.v) if (n <= k) return f; return 6; }
/** Séparation exigée (mm) entre un cheminement de données (classe de ségrégation cls) et un cheminement d'énergie. */
export function separationMm(cls, dataPath, powerPath) {
  const S = PLAN_LIM.SEGREGATION_MM.v[cls] || PLAN_LIM.SEGREGATION_MM.v.b;
  // Modèle simplifié : on retient le cheminement métallique le plus protecteur des deux.
  const idx = Math.max(['none', 'open', 'perforated', 'solid'].indexOf(dataPath.shield || 'none'), ['none', 'open', 'perforated', 'solid'].indexOf(powerPath.shield || 'none'));
  return S[Math.max(0, idx)] * powerFactor(powerPath.circuits || 1);
}
