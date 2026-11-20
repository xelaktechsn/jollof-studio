// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Site du projet réseau : bâtiments, étages, pièces, murs, portes, plan importé (à l'échelle, en mètres), et calculs de
// géométrie communs (aire, point dans une pièce, distances). Module pur, sans interface (lu par clean.js, route.js, les
// vérifications, l'IA et la vue Plans).
//
// Modèle (data.site), unités : mètres, origine en haut à gauche de chaque étage, y vers le bas :
//   site : { name, north (degrés, 0 = haut du plan), seg (classe de ségrégation EN 50174-2 des câbles de données : 'a' à
//     'd', 'b' par défaut, celle du câble U/UTP courant), access (accès sans cheminement au plus, m, réglage de conception :
//     ACCESS_M), buildings: [bâtiment] }
//   bâtiment : { id, name, x, y (place sur le plan de masse, m), floors: [étage] }
//   étage : { id, name, level (numéro : 0 rez-de-chaussée, -1 sous-sol…), elev (altitude du sol, m), height (hauteur
//     d'étage, sol à sol, m), ceil (hauteur sous plafond, m), plenum (faux plafond, m), raised (faux plancher, m),
//     image?: { id (clé de data.images), x, y, scale (m par pixel), iw, ih (pixels), rot, opacity, lock },
//     walls: [{ id, a: [x, y], b: [x, y], t (épaisseur, m), mat (MATERIALS) }],
//     doors: [{ id, wall, at (m depuis l'extrémité a du mur), w (largeur, m) }],
//     rooms: [{ id, name, usage (USAGES), poly: [[x, y]…] }] }
//   Place d'un équipement sur un étage (devices[i].loc) : { floor, x, y, h (hauteur de pose au-dessus du sol, m) }.
// Tolérant : tout champ absent ou faux reçoit une valeur sûre (fichier ancien, IA, générateur de la conception) ; les
// identifiants sont uniques dans tout le site (un mur et une pièce ne partagent pas un id) ; cleanSite(cleanSite(x))
// rend la même chose. Un équipement peut désigner n'importe quel étage : un étage disparu rend juste sa place nulle.
import { tl } from '../i18n/index.js';
import { cleanText } from '../sanitize.js';

/** Plafonds : un grand site (plusieurs bâtiments de plusieurs étages, des centaines de pièces). */
export const SITE_MAX = { buildings: 30, floors: 80, walls: 4000, doors: 2000, rooms: 1500, poly: 200, images: 60, imageChars: 12e6 };
/**
 * Matériaux des murs (id stables : le calque Wi-Fi leur associe un affaiblissement dans son propre module) ; t :
 * épaisseur proposée au dessin (m), réglage modifiable, pas une norme.
 */
export const MATERIALS = {
  concrete: { t: 0.2, name: () => tl('Béton') },
  brick: { t: 0.2, name: () => tl('Brique') },
  block: { t: 0.2, name: () => tl('Parpaing') },
  stone: { t: 0.4, name: () => tl('Pierre') },
  drywall: { t: 0.1, name: () => tl('Plaque de plâtre (cloison)') },
  plaster: { t: 0.1, name: () => tl('Carreau de plâtre') },
  glass: { t: 0.02, name: () => tl('Vitrage') },
  wood: { t: 0.05, name: () => tl('Bois') },
  metal: { t: 0.05, name: () => tl('Métal') },
  elevator: { t: 0.2, name: () => tl('Gaine d’ascenseur (béton armé)') }
};
/** Usages des pièces ; tr : local technique d'étage (LT), er : salle des équipements, ef : arrivée des opérateurs. */
export const USAGES = {
  office: { name: () => tl('Bureau') },
  open: { name: () => tl('Plateau de bureaux') },
  classroom: { name: () => tl('Salle de classe') },
  lab: { name: () => tl('Laboratoire, atelier') },
  meeting: { name: () => tl('Salle de réunion') },
  corridor: { name: () => tl('Circulation') },
  hall: { name: () => tl('Hall, accueil') },
  tr: { name: () => tl('Local technique d’étage (LT)'), tech: true },
  er: { name: () => tl('Salle des équipements (SR)'), tech: true },
  ef: { name: () => tl('Local d’arrivée des opérateurs'), tech: true },
  storage: { name: () => tl('Rangement') },
  sanitary: { name: () => tl('Sanitaires') },
  other: { name: () => tl('Autre') }
};
/**
 * Accès horizontal sans cheminement au plus (m) entre un équipement et le cheminement le plus proche : réglage de
 * conception modifiable (site.access), pas une norme ; au-delà, il faut dessiner les crochets ou la goulotte qui portent
 * le câble (J1262).
 */
export const ACCESS_M = 6;
/** Classes de ségrégation de l'EN 50174-2 (a : la plus exigeante, d : câble très bien écranté). */
export const SEG_CLASSES = ['a', 'b', 'c', 'd'];
/** Pièces qui accueillent une baie de distribution (point de départ du câblage horizontal). */
export const isTechRoom = r => !!(r && USAGES[r.usage] && USAGES[r.usage].tech);

const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
const r3 = v => Math.round(v * 1000) / 1000;
const C = 1e4; // coordonnées bornées à ±10 km
const pt = p => (Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) ? [r3(num(p[0], -C, C, 0)), r3(num(p[1], -C, C, 0))] : null);
const txt = (v, n) => cleanText(String(v ?? ''), n).trim();
/** Identifiant libre et unique : id proposé s'il est propre, sinon préfixe + numéro. */
export function uid(want, pre, used) {
  let id = typeof want === 'string' && /^[\w.:-]{1,40}$/.test(want) ? want : '';
  if (!id || used.has(id)) { let i = used.size + 1; do id = pre + i++; while (used.has(id)); }
  used.add(id); return id;
}

/** Étage propre ; used : ids déjà pris dans le site. */
function cleanFloor(raw, i, used, prevTop) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const level = Math.round(num(f.level, -20, 200, i)), height = r3(num(f.height, 2, 30, 3.5));
  const o = {
    id: uid(f.id, 'F', used), name: txt(f.name, 40) || (level === 0 ? tl('Rez-de-chaussée') : tl('Niveau {0}', level)), level,
    elev: r3(num(f.elev, -100, 1000, prevTop)), height, ceil: r3(num(f.ceil, 2, 30, Math.min(height, 2.7))),
    plenum: r3(num(f.plenum, 0, 5, 0.6)), raised: r3(num(f.raised, 0, 2, 0)), walls: [], doors: [], rooms: []
  };
  const im = f.image;
  if (im && typeof im === 'object' && typeof im.id === 'string' && im.id) {
    o.image = { id: txt(im.id, 40), x: r3(num(im.x, -C, C, 0)), y: r3(num(im.y, -C, C, 0)), scale: num(im.scale, 1e-5, 10, 0.02), iw: Math.round(num(im.iw, 1, 40000, 1000)), ih: Math.round(num(im.ih, 1, 40000, 1000)), rot: num(im.rot, -360, 360, 0), opacity: num(im.opacity, 0.05, 1, 0.5), lock: !!im.lock };
  }
  for (const w of (Array.isArray(f.walls) ? f.walls : []).slice(0, SITE_MAX.walls)) {
    const a = pt(w && w.a), b = pt(w && w.b); if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
    const mat = MATERIALS[w.mat] ? w.mat : 'block';
    o.walls.push({ id: uid(w.id, 'w', used), a, b, t: r3(num(w.t, 0.01, 2, MATERIALS[mat].t)), mat });
  }
  const wl = new Map(o.walls.map(w => [w.id, w]));
  for (const d of (Array.isArray(f.doors) ? f.doors : []).slice(0, SITE_MAX.doors)) {
    const w = d && wl.get(d.wall); if (!w) continue;
    const L = dist(w.a, w.b), dw = r3(num(d.w, 0.5, Math.max(0.5, L), 0.9));
    o.doors.push({ id: uid(d.id, 'dr', used), wall: w.id, at: r3(num(d.at, dw / 2, Math.max(dw / 2, L - dw / 2), L / 2)), w: dw });
  }
  for (const r of (Array.isArray(f.rooms) ? f.rooms : []).slice(0, SITE_MAX.rooms)) {
    const poly = (Array.isArray(r && r.poly) ? r.poly : []).slice(0, SITE_MAX.poly).map(pt).filter(Boolean);
    if (poly.length < 3 || polyArea(poly) < 0.05) continue;
    o.rooms.push({ id: uid(r.id, 'rm', used), name: txt(r.name, 40), usage: USAGES[r.usage] ? r.usage : 'office', poly });
  }
  return o;
}
/** Site propre : { name, north, buildings: [{ id, name, x, y, floors: [...] }] } (voir le modèle en tête du fichier). */
export function cleanSite(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}, used = new Set(), buildings = [];
  for (const b of (Array.isArray(s.buildings) ? s.buildings : []).slice(0, SITE_MAX.buildings)) {
    if (!b || typeof b !== 'object') continue;
    const o = { id: uid(b.id, 'B', used), name: txt(b.name, 40) || tl('Bâtiment {0}', buildings.length + 1), x: r3(num(b.x, -C, C, 0)), y: r3(num(b.y, -C, C, 0)), floors: [] };
    // Étages rangés par niveau ; une altitude absente suit l'étage du dessous.
    const fl = (Array.isArray(b.floors) ? b.floors : []).slice(0, SITE_MAX.floors).filter(f => f && typeof f === 'object');
    const order = fl.map((f, i) => [f, i]).sort((p, q) => num(p[0].level, -20, 200, p[1]) - num(q[0].level, -20, 200, q[1]) || p[1] - q[1]);
    let top = null;
    for (const [f, i] of order) {
      const lv = Math.round(num(f.level, -20, 200, i));
      const c = cleanFloor(f, i, used, top ?? lv * num(f.height, 2, 30, 3.5));
      o.floors.push(c); top = c.elev + c.height;
    }
    buildings.push(o);
  }
  return { name: txt(s.name, 60), north: num(s.north, -360, 360, 0), access: num(s.access, 0.5, 100, ACCESS_M), seg: SEG_CLASSES.includes(s.seg) ? s.seg : 'b', buildings };
}
/** Place d'un équipement sur un plan : { floor, x, y, h } ou null. h par défaut : 0,3 m (prise murale basse, réglable). */
export function cleanLoc(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.floor !== 'string' || !/^[\w.:-]{1,40}$/.test(raw.floor)) return null;
  const p = pt([raw.x, raw.y]); if (!p) return null;
  return { floor: raw.floor, x: p[0], y: p[1], h: r3(num(raw.h, 0, 30, 0.3)) };
}
/** Images des plans importés : { id: 'data:image/png|jpeg|webp;base64,…' } (hors de l'historique d'annulation). */
export function cleanImages(raw) {
  const out = {}; if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw).slice(0, SITE_MAX.images)) {
    if (!/^[\w.:-]{1,40}$/.test(k) || typeof v !== 'string' || v.length > SITE_MAX.imageChars) continue;
    if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) out[k] = v;
  }
  return out;
}

/* ---------- Géométrie ---------- */
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** Aire d'un polygone (m², toujours positive). */
export function polyArea(p) { let s = 0; for (let i = 0, n = p.length; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
export function polyPerimeter(p) { let s = 0; for (let i = 0, n = p.length; i < n; i++) s += dist(p[i], p[(i + 1) % n]); return s; }
/** Centre de gravité d'un polygone (pour l'étiquette d'une pièce). */
export function centroid(p) {
  let a = 0, x = 0, y = 0;
  for (let i = 0, n = p.length; i < n; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % n], c = x0 * y1 - x1 * y0; a += c; x += (x0 + x1) * c; y += (y0 + y1) * c; }
  if (Math.abs(a) < 1e-9) { const n = p.length || 1; return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n]; }
  return [x / (3 * a), y / (3 * a)];
}
/** Point dans un polygone (règle pair-impair). */
export function inPoly(q, p) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
/** Projection de q sur le segment ab : { t (0…1), x, y, d (distance) }. */
export function project(q, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2)) : 0;
  const x = a[0] + t * dx, y = a[1] + t * dy;
  return { t, x, y, d: Math.hypot(q[0] - x, q[1] - y) };
}
/** Longueur d'une polyligne. */
export function polyLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; }
/** Boîte englobante [x0, y0, x1, y1] d'une liste de points. */
export function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}

/* ---------- Recherche dans le site ---------- */
/** Tous les étages : [{ b (bâtiment), f (étage) }]. */
export function allFloors(site) { const out = []; for (const b of (site && site.buildings) || []) for (const f of b.floors || []) out.push({ b, f }); return out; }
/** Étage par id : { b, f } ou null. Index mis en cache sur l'objet site (reconstruit si le site change d'objet). */
const FIDX = new WeakMap();
export function floorOf(site, id) {
  if (!site || !id) return null;
  let m = FIDX.get(site);
  if (!m || !m.has(id)) { m = new Map(allFloors(site).map(x => [x.f.id, x])); FIDX.set(site, m); }
  const x = m.get(id) || null;
  // Index périmé (étage retiré puis id réutilisé) : on vérifie qu'il est toujours dans le site.
  return x && x.b.floors.includes(x.f) && site.buildings.includes(x.b) ? x : null;
}
/** Pièce qui contient le point (x, y) d'un étage, ou null (la plus petite si elles s'emboîtent). */
export function roomAt(floor, x, y) {
  let best = null, ba = Infinity;
  for (const r of (floor && floor.rooms) || []) if (inPoly([x, y], r.poly)) { const a = polyArea(r.poly); if (a < ba) { best = r; ba = a; } }
  return best;
}
/** Objet du site par id : { kind: 'building'|'floor'|'room'|'wall'|'door', o, b, f } ou null. */
export function findSiteObj(site, id) {
  for (const b of (site && site.buildings) || []) {
    if (b.id === id) return { kind: 'building', o: b, b, f: null };
    for (const f of b.floors) {
      if (f.id === id) return { kind: 'floor', o: f, b, f };
      for (const [k, kind] of [['rooms', 'room'], ['walls', 'wall'], ['doors', 'door']]) { const o = f[k].find(x => x.id === id); if (o) return { kind, o, b, f }; }
    }
  }
  return null;
}
/** Identifiants déjà pris dans le site (pour en créer de nouveaux). */
export function siteIds(site) { const s = new Set(); for (const b of (site && site.buildings) || []) { s.add(b.id); for (const f of b.floors) { s.add(f.id); for (const k of ['rooms', 'walls', 'doors']) for (const o of f[k]) s.add(o.id); } } return s; }

/* ---------- Pièces fermées par les murs ---------- */
/** Point sûrement intérieur d'un polygone (le centre de gravité ne l'est pas toujours : pièce en L). */
export function innerPoint(p) {
  const c = centroid(p); if (inPoly(c, p)) return c;
  // Milieu de chaque côté, décalé de quelques centimètres vers l'intérieur.
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], L = dist(a, b) || 1, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const s of [0.05, -0.05]) { const q = [m[0] - (b[1] - a[1]) / L * s, m[1] + (b[0] - a[0]) / L * s]; if (inPoly(q, p)) return q; }
  }
  return c;
}
/**
 * Pièces fermées par les murs d'un étage : graphe plan des axes des murs (bouts rapprochés à moins de tol mètres,
 * murs coupés aux croisements et aux jonctions en T), murs pendants retirés, puis faces minimales (en suivant toujours le
 * mur le plus à droite). Rend les polygones (sommets alignés retirés) des faces d'au moins minArea m² qu'aucune pièce
 * existante ne couvre. Modèle simplifié : la pièce suit l'axe des murs (sa surface compte la moitié de leur épaisseur).
 */
export function detectRooms(floor, o = {}) {
  const tol = o.tol ?? 0.15, minArea = o.minArea ?? 0.5, walls = (floor && floor.walls) || [];
  if (walls.length < 3) return [];
  // Sommets rapprochés (bouts de murs à moins de tol) : un seul nœud.
  const P = [], nodeOf = q => { for (let i = 0; i < P.length; i++) if (dist(P[i], q) <= tol) return i; P.push([q[0], q[1]]); return P.length - 1; };
  const segs = walls.map(w => [nodeOf(w.a), nodeOf(w.b)]).filter(([i, j]) => i !== j);
  // Coupes : croisements, bout d'un mur sur un autre (jonction en T, à tol près).
  const cuts = segs.map(() => []);
  for (let s = 0; s < segs.length; s++) {
    const [a, b] = segs[s].map(i => P[i]);
    for (let t = 0; t < segs.length; t++) {
      if (s === t) continue;
      const [c, d] = segs[t].map(i => P[i]);
      for (const k of segs[t]) { if (segs[s].includes(k)) continue; const pr = project(P[k], a, b); if (pr.d <= tol && pr.t > 1e-6 && pr.t < 1 - 1e-6) { if (pr.d > 1e-9) P[k] = [pr.x, pr.y]; cuts[s].push([pr.t, k]); } }
      if (t < s) continue;
      const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) continue;
      const qx = c[0] - a[0], qy = c[1] - a[1], u = (qx * sy - qy * sx) / den, v = (qx * ry - qy * rx) / den;
      if (u > 1e-6 && u < 1 - 1e-6 && v > 1e-6 && v < 1 - 1e-6) { const k = nodeOf([a[0] + u * rx, a[1] + u * ry]); cuts[s].push([u, k]); cuts[t].push([v, k]); }
    }
  }
  const adj = new Map(), key = (i, j) => (i < j ? i + ':' + j : j + ':' + i), seen = new Set();
  const link = (i, j) => { if (i === j || seen.has(key(i, j))) return; seen.add(key(i, j)); (adj.get(i) || adj.set(i, new Set()).get(i)).add(j); (adj.get(j) || adj.set(j, new Set()).get(j)).add(i); };
  segs.forEach(([i, j], s) => { const list = [[0, i], ...cuts[s].sort((x, y) => x[0] - y[0]), [1, j]]; for (let k = 1; k < list.length; k++) link(list[k - 1][1], list[k][1]); });
  // Murs pendants (un bout libre) : retirés jusqu'à ce qu'il n'en reste plus.
  for (let again = true; again;) { again = false; for (const [i, n] of adj) if (n.size < 2) { for (const j of n) adj.get(j).delete(i); adj.delete(i); again = true; } }
  // Voisins de chaque nœud rangés par angle.
  const ang = (i, j) => Math.atan2(P[j][1] - P[i][1], P[j][0] - P[i][0]);
  const order = new Map([...adj].map(([i, n]) => [i, [...n].sort((x, y) => ang(i, x) - ang(i, y))]));
  const used = new Set(), faces = [];
  for (const [i, n] of order) for (const j of n) {
    if (used.has(i + '>' + j)) continue;
    const face = []; let u = i, v = j, guard = 0;
    while (!used.has(u + '>' + v) && guard++ < 10000) {
      used.add(u + '>' + v); face.push(u);
      // Arête suivante : autour de v, le voisin qui précède u dans l'ordre des angles.
      const L = order.get(v), k = L.indexOf(u), w = L[(k - 1 + L.length) % L.length];
      u = v; v = w;
    }
    if (face.length >= 3) faces.push(face.map(x => P[x]));
  }
  const signed = p => { let s = 0; for (let k = 0; k < p.length; k++) { const a = p[k], b = p[(k + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  // Faces bornées : signe positif (repère y vers le bas) ; la face extérieure de chaque groupe de murs a l'autre signe.
  const out = [];
  for (const f of faces) {
    if (signed(f) <= 0) continue;
    let poly = f.filter((q, k) => { const a = f[(k - 1 + f.length) % f.length], b = f[(k + 1) % f.length]; return Math.abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) > 1e-6 * Math.max(1, dist(a, b)); });
    poly = poly.map(q => [r3(q[0]), r3(q[1])]);
    if (poly.length < 3 || polyArea(poly) < minArea) continue;
    const ip = innerPoint(poly);
    if ((floor.rooms || []).some(r => inPoly(ip, r.poly))) continue;
    out.push(poly);
  }
  return out;
}
