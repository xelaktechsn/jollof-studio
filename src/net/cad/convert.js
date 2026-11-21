// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Conversion d'un dessin DAO importé (CadDoc de dxf.js) en objets du modèle réseau : murs, portes, pièces nommées,
// cheminements d'énergie (et de données), prises et points d'accès. Module pur, sans interface (l'étape de l'assistant
// est ui/cadconvert.js) ; testé sur des dessins synthétiques (cad/convert.test.mjs).
//
// convertCad(doc, o) → { walls, doors, rooms, paths, devices, stats }
//   o : { region: [x0, y0, x1, y1] (unités du dessin, relatives à doc.origin), layers: Set des calques gardés,
//         toMetre, transform? ({ dx, dy, rot, scale } : repère du fond → étage, comme underlay.transform),
//         kinds: { [layerId]: 'walls'|'partitions'|'doors'|'windows'|'structure'|'elec'|'cfo'|'cfa'|'furniture'|'text'|
//                  'dims'|'hatch'|'other'|'skip' } (genre retenu pour chaque calque),
//         make: { walls, doors, rooms, power, data, devices } (booléens, tout vrai sauf data par défaut),
//         blocks: { [nom de bloc]: type d'équipement } (correspondances), texts: [{ re (texte d'expression régulière), type }],
//         floor (étage visé : ses murs et pièces existants servent à fermer et à ne pas doubler les pièces), tag ('cad:…') }
// Repère de l'étage : mètres, x vers la droite, y vers le BAS, (0, 0) au coin haut gauche de la zone :
//   X → (X − region[0]) · toMetre, Y → (region[3] − Y) · toMetre, puis transform.
// Méthode (modèle simplifié, à vérifier par l'utilisateur) :
//   - Murs : deux traits parallèles (moins de 2° d'écart) distants de 4 à 60 cm et qui se recouvrent sur au moins la
//     moitié du plus court forment un mur d'axe médian et d'épaisseur leur écart, étendu à l'union des deux traits ; un
//     trait seul de plus de 60 cm devient un mur mince ; les retours de 60 cm et moins (tableaux, abouts) sont ignorés.
//     Les murs alignés de même épaisseur sont fusionnés, à travers une baie de porte quand une porte y est reconnue.
//   - Portes : groupes de traits reliés d'un calque de portes (battant et arc), ou arcs d'un quart de cercle de 0,5 à
//     1,5 m sur les calques d'architecture ; la porte est posée sur le mur le plus
//     proche, au milieu de l'emprise du groupe le long du mur, largeur = cette emprise (0,5 à 3 m).
//   - Fenêtres : traits parallèles comme les murs, en vitrage.
//   - Pièces : faces fermées par les murs (detectRooms de site.js), nommées par le plus grand texte qui s'y trouve, usage
//     deviné d'après ses mots.
//   - Cheminements : chaînes de traits reliés des calques électriques (énergie) ou courants faibles (données) d'au moins
//     2 m d'emprise.
//   - Équipements : INSERT dont le nom de bloc est associé à un type, textes qui correspondent à un motif.
import { tl } from '../../i18n/index.js';
import { detectRooms, roomPoint, inRoom, roomArea, USAGES, MATERIALS } from '../site.js';
import { KINDS } from './dxf.js';

/** Genres de calques reconnus et ce qu'ils deviennent. */
export const CONVERT_KINDS = ['walls', 'partitions', 'windows', 'doors', 'structure', 'elec', 'cfo', 'cfa', 'furniture', 'text', 'dims', 'hatch', 'other', 'skip'];
/** Matériau des murs selon le genre du calque (le calque Wi-Fi s'en sert). */
export const KIND_MAT = { walls: 'block', partitions: 'drywall', windows: 'glass', structure: 'concrete' };
/** Types d'équipements proposés pour un bloc ou un texte. */
export const DEVICE_TYPES = ['outlet', 'outlet2', 'ap', 'camera', 'phone', 'pc', 'printer'];
/** Réglages de la méthode (mètres, degrés) : des choix de conversion modifiables, pas des normes. */
export const CONVERT_TOL = { minT: 0.04, maxT: 0.6, angle: 2, overlap: 0.5, minWall: 0.6, join: 0.02, doorGap: 3, minRun: 2, roomTol: 0.15, minRoom: 1 };

/** Correspondances proposées d'après le nom d'un bloc (mots usuels des bibliothèques de symboles, FR et EN). */
export function guessBlockType(name) {
  const n = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (/WIFI|WI-FI|BORNE|\bAP\b|ACCESS.?POINT|POINT.?D.?ACCES/.test(n)) return 'ap';
  if (/CAMERA|\bCAM\b|VIDEO.?SURV|CCTV/.test(n)) return 'camera';
  if (/RJ ?45|PRISE.?(INFO|RESEAU|DATA|VDI)|\bVDI\b|DATA.?OUTLET|\bTO\b|TELECOM.?OUTLET/.test(n)) return /DOUBLE|2X|X2|DUO/.test(n) ? 'outlet2' : 'outlet';
  if (/TELEPHONE|\bTEL\b|PHONE/.test(n)) return 'phone';
  return null;
}
/** Motifs de texte proposés : « WIFI 3 », « AP12 » → point d'accès ; « RJ45 », « PC » → prise. */
export const TEXT_PATTERNS = [{ re: '^\\s*(WIFI|WI-FI|AP|BORNE)\\s*-?\\s*\\d+\\s*$', type: 'ap' }, { re: '^\\s*(RJ\\s*45|PC|PRISE\\s*RJ\\s*45)(\\s*[x×]\\s*\\d)?\\s*$', type: 'outlet' }];

/** Usage d'une pièce deviné d'après son nom (FR et EN), ou null. */
export function guessUsage(text) {
  const t = ' ' + String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  const R = [
    ['shaft', / (gaine|gt|tremie|shaft) /], ['ef', / (arrivee operateur|local operateur|entrance facility) /],
    ['er', / (salle serveur|salle informatique serveur|server room|datacenter|salle des equipements) /],
    ['tr', / (local technique|local info|local vdi|local telecom|lt|lt\d+|tr|baie|repartiteur|sr|telecom room) /],
    ['sanitary', / (wc|sanitaire|sanitaires|toilette|toilettes|douche|douches|vestiaire|vestiaires|toilet|toilets|restroom) /],
    ['storage', / (stock|stockage|rangement|archive|archives|reserve|depot|storage|local menage|menage) /],
    ['corridor', / (couloir|circulation|circ|degagement|corridor|palier|escalier|sas) /], ['hall', / (hall|accueil|entree|reception|lobby) /],
    ['meeting', / (reunion|meeting|conference|visio) /], ['classroom', / (salle de classe|classe|salle de cours|cours|amphi|amphitheatre|classroom|formation) /],
    ['lab', / (labo|laboratoire|atelier|workshop|lab|tp) /], ['open', / (open space|openspace|plateau|open plan) /],
    ['office', / (bureau|bureaux|office|direction|secretariat|administration|admin|cdi|infirmerie) /]
  ];
  for (const [u, re] of R) if (re.test(t)) return u;
  return null;
}
const isLabel = t => { const s = String(t || '').trim(); return s.length >= 2 && !/^[\d\s.,]+(m²|m2|m)?$/i.test(s) && !/^[\d.,]+\s*x\s*[\d.,]+$/i.test(s); };

/* ---------- Géométrie ---------- */
const r3 = v => Math.round(v * 1000) / 1000;
function frame(o) {
  const [x0, , , y1] = o.region, k = o.toMetre || 1, t = o.transform || {};
  const a = ((t.rot || 0) * Math.PI) / 180, s = t.scale || 1, c = Math.cos(a) * s, n = Math.sin(a) * s, dx = t.dx || 0, dy = t.dy || 0;
  return (X, Y) => { const x = (X - x0) * k, y = (y1 - Y) * k; return [c * x - n * y + dx, n * x + c * y + dy]; };
}
const inRegion = (r, x, y) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];

/** Segments gardés de la zone, par genre, dans le repère de l'étage : Map(genre → [[ax, ay, bx, by, calque]]). */
function segsByKind(doc, o, kindOf) {
  const out = new Map(), S = doc.segs, L = doc.segLayer, to = frame(o), r = o.region;
  for (let i = 0, n = L.length; i < n; i++) {
    const l = L[i]; if (!o.layers.has(l)) continue;
    const kd = kindOf(l); if (!kd || kd === 'skip') continue;
    const ax = S[i * 4], ay = S[i * 4 + 1], bx = S[i * 4 + 2], by = S[i * 4 + 3];
    if (!inRegion(r, (ax + bx) / 2, (ay + by) / 2)) continue;
    const p = to(ax, ay), q = to(bx, by);
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-4) continue;
    let a = out.get(kd); if (!a) out.set(kd, (a = [])); a.push([p[0], p[1], q[0], q[1], l]);
  }
  return out;
}
const ARC = KINDS.indexOf('arc');
/** Segments d'arcs (courbes découpées) des calques d'architecture gardés, dans le repère de l'étage. */
function arcSegs(doc, o, kindOf) {
  const out = [], S = doc.segs, L = doc.segLayer, K = doc.segKind, to = frame(o), r = o.region, arch = new Set(['walls', 'partitions', 'doors', 'windows', 'other']);
  if (!K) return out;
  for (let i = 0, n = L.length; i < n; i++) {
    if (K[i] !== ARC || !o.layers.has(L[i]) || !arch.has(kindOf(L[i]))) continue;
    const ax = S[i * 4], ay = S[i * 4 + 1], bx = S[i * 4 + 2], by = S[i * 4 + 3];
    if (!inRegion(r, (ax + bx) / 2, (ay + by) / 2)) continue;
    const p = to(ax, ay), q = to(bx, by); out.push([p[0], p[1], q[0], q[1], L[i]]);
  }
  return out;
}
/** Grille de seaux (côté c mètres) qui enregistre chaque segment dans toutes les cases qu'il traverse. */
function gridOf(segs, c = 1) {
  const g = new Map(), key = (i, j) => i * 1048576 + j;
  segs.forEach((s, k) => {
    const L = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(1, Math.ceil(L / (c / 2))), seen = new Set();
    for (let t = 0; t <= n; t++) {
      const x = s[0] + (s[2] - s[0]) * t / n, y = s[1] + (s[3] - s[1]) * t / n, kk = key(Math.floor(x / c), Math.floor(y / c));
      if (seen.has(kk)) continue; seen.add(kk); let a = g.get(kk); if (!a) g.set(kk, (a = [])); a.push(k);
    }
  });
  return { near(s, pad) {
    const out = new Set(), L = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(1, Math.ceil(L / (c / 2)));
    for (let t = 0; t <= n; t++) {
      const x = s[0] + (s[2] - s[0]) * t / n, y = s[1] + (s[3] - s[1]) * t / n;
      for (let i = Math.floor((x - pad) / c); i <= Math.floor((x + pad) / c); i++) for (let j = Math.floor((y - pad) / c); j <= Math.floor((y + pad) / c); j++) for (const k of g.get(key(i, j)) || []) out.add(k);
    }
    return out;
  } };
}
/**
 * Murs d'axe depuis des traits : paires de traits parallèles → axe + épaisseur ; traits seuls assez longs → murs minces.
 * Rend [{ a, b, t }] (avant fusion).
 */
export function pairWalls(segs, tol = CONVERT_TOL, thin = 0.1) {
  const used = new Uint8Array(segs.length), out = [];
  const cosA = Math.cos(tol.angle * Math.PI / 180), cands = [];
  // Index par direction (cases de 2° sur 180°) et par position (cases de 1 m le long du trait) : seuls les traits de même
  // direction et voisins sont comparés (des centaines de milliers de traits dans un vrai plan).
  const NB = 90, C = 1, idx = new Map(), key = (b, i, j) => (b * 8192 + (i & 8191)) * 8192 + (j & 8191);
  const binOf = (ux, uy) => { let a = Math.atan2(uy, ux); if (a < 0) a += Math.PI; return Math.floor(a / Math.PI * NB) % NB; };
  const cells = (s, pad, f) => { const L = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(1, Math.ceil(L / C)); let last = ''; for (let t = 0; t <= n; t++) { const x = s[0] + (s[2] - s[0]) * t / n, y = s[1] + (s[3] - s[1]) * t / n; for (let i = Math.floor((x - pad) / C); i <= Math.floor((x + pad) / C); i++) for (let j = Math.floor((y - pad) / C); j <= Math.floor((y + pad) / C); j++) { const k = i + ':' + j; if (k === last) continue; f(i, j); } last = ''; } };
  const bins = new Int16Array(segs.length).fill(-1);
  segs.forEach((s, k) => {
    const ux = s[2] - s[0], uy = s[3] - s[1]; if (Math.hypot(ux, uy) < 0.15) return; // arcs découpés, hachures : pas de murs
    const b = bins[k] = binOf(ux, uy), seen = new Set();
    cells(s, 0, (i, j) => { const kk = key(b, i, j); if (seen.has(kk)) return; seen.add(kk); let a = idx.get(kk); if (!a) idx.set(kk, (a = [])); a.push(k); });
  });
  segs.forEach((s, i) => {
    if (bins[i] < 0) return;
    const ux = s[2] - s[0], uy = s[3] - s[1], L = Math.hypot(ux, uy), near = new Set();
    for (const b of [(bins[i] + NB - 1) % NB, bins[i], (bins[i] + 1) % NB]) cells(s, tol.maxT, (ci, cj) => { for (const k of idx.get(key(b, ci, cj)) || []) if (k > i) near.add(k); });
    for (const j of near) {
      const t = segs[j], vx = t[2] - t[0], vy = t[3] - t[1], M = Math.hypot(vx, vy);
      if (Math.abs(ux * vx + uy * vy) / (L * M) < cosA) continue;
      // Écart : distance des extrémités de t à la droite de s ; recouvrement le long de s.
      const nx = -uy / L, ny = ux / L, d1 = (t[0] - s[0]) * nx + (t[1] - s[1]) * ny, d2 = (t[2] - s[0]) * nx + (t[3] - s[1]) * ny;
      const d = (Math.abs(d1) + Math.abs(d2)) / 2; if (d < tol.minT || d > tol.maxT || Math.abs(d1 - d2) > 0.02 + 0.02 * d) continue;
      const p1 = ((t[0] - s[0]) * ux + (t[1] - s[1]) * uy) / L, p2 = ((t[2] - s[0]) * ux + (t[3] - s[1]) * uy) / L;
      const ov = Math.min(L, Math.max(p1, p2)) - Math.max(0, Math.min(p1, p2));
      if (ov < tol.overlap * Math.min(L, M) || ov < 0.1) continue;
      cands.push([d, i, j, (d1 + d2) / 2, p1, p2, L]);
    }
  });
  cands.sort((a, b) => a[0] - b[0]);
  for (const [d, i, j, off, p1, p2, L] of cands) {
    if (used[i] || used[j]) continue; used[i] = used[j] = 1;
    const s = segs[i], ux = (s[2] - s[0]) / L, uy = (s[3] - s[1]) / L, nx = -uy, ny = ux;
    const lo = Math.min(0, p1, p2), hi = Math.max(L, p1, p2), ox = s[0] + nx * off / 2, oy = s[1] + ny * off / 2;
    out.push({ a: [ox + ux * lo, oy + uy * lo], b: [ox + ux * hi, oy + uy * hi], t: Math.round(d * 1000) / 1000 });
  }
  segs.forEach((s, i) => { if (!used[i] && Math.hypot(s[2] - s[0], s[3] - s[1]) > tol.minWall) out.push({ a: [s[0], s[1]], b: [s[2], s[3]], t: thin }); });
  return out;
}
/**
 * Fusion des murs alignés de même épaisseur (à 2 cm près) qui se touchent, ou qu'une porte sépare (gaps : [[x, y, demi-
 * largeur]] centres des portes). Rend [{ a, b, t }].
 */
export function mergeWalls(walls, gaps = [], tol = CONVERT_TOL) {
  const groups = new Map();
  for (const w of walls) {
    let ux = w.b[0] - w.a[0], uy = w.b[1] - w.a[1]; const L = Math.hypot(ux, uy); if (L < 1e-6) continue;
    ux /= L; uy /= L; if (ux < -1e-9 || (Math.abs(ux) < 1e-9 && uy < 0)) { ux = -ux; uy = -uy; }
    const ang = Math.round(Math.atan2(uy, ux) * 180 / Math.PI * 2) / 2, off = -uy * w.a[0] + ux * w.a[1];
    const k = ang + '|' + Math.round(off / 0.05) + '|' + Math.round(w.t / 0.02);
    let g = groups.get(k); if (!g) groups.set(k, (g = { ux, uy, off, t: w.t, iv: [] }));
    const p = ux * w.a[0] + uy * w.a[1], q = ux * w.b[0] + uy * w.b[1]; g.iv.push([Math.min(p, q), Math.max(p, q)]);
  }
  const out = [];
  for (const g of groups.values()) {
    g.iv.sort((a, b) => a[0] - b[0]);
    const doorIn = (lo, hi) => gaps.some(([x, y, r]) => { const p = g.ux * x + g.uy * y, o = -g.uy * x + g.ux * y; return Math.abs(o - g.off) < r * 0.75 + g.t && p > lo - r * 0.5 && p < hi + r * 0.5; });
    let [lo, hi] = g.iv[0];
    const push = () => out.push({ a: [r3(g.ux * lo - g.uy * g.off), r3(g.uy * lo + g.ux * g.off)], b: [r3(g.ux * hi - g.uy * g.off), r3(g.uy * hi + g.ux * g.off)], t: g.t });
    for (let i = 1; i < g.iv.length; i++) {
      const [a, b] = g.iv[i];
      if (a <= hi + tol.join || (a - hi <= tol.doorGap && doorIn(hi, a))) hi = Math.max(hi, b); else { push(); lo = a; hi = b; }
    }
    push();
  }
  return out;
}
/**
 * Angles propres : chaque bout de mur proche (moins de 0,6 × l'épaisseur la plus forte) de l'axe d'un autre mur non
 * parallèle est ramené au point de croisement des deux axes (les traits doubles prolongés débordent d'une demi-épaisseur).
 */
export function cleanCorners(walls) {
  const segs = walls.map(w => [w.a[0], w.a[1], w.b[0], w.b[1]]), G = gridOf(segs, 1);
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    for (const end of ['a', 'b']) {
      const E = w[end], pad = 0.6 * Math.max(w.t, 0.2) + 0.02;
      let best = null;
      for (const j of G.near([E[0], E[1], E[0], E[1]], pad)) {
        if (j === i) continue;
        const v = walls[j], r = 0.6 * Math.max(w.t, v.t) + 0.02;
        const ax = w.b[0] - w.a[0], ay = w.b[1] - w.a[1], bx = v.b[0] - v.a[0], by = v.b[1] - v.a[1], den = ax * by - ay * bx;
        const La = Math.hypot(ax, ay), Lb = Math.hypot(bx, by); if (Math.abs(den) < 0.2 * La * Lb) continue; // presque parallèles
        const t = ((v.a[0] - w.a[0]) * by - (v.a[1] - w.a[1]) * bx) / den, u = ((v.a[0] - w.a[0]) * ay - (v.a[1] - w.a[1]) * ax) / den;
        const X = [w.a[0] + ax * t, w.a[1] + ay * t], d = Math.hypot(X[0] - E[0], X[1] - E[1]);
        if (d > r || u < -r / Lb || u > 1 + r / Lb) continue;
        if (!best || d < best.d) best = { d, X };
      }
      if (best) w[end] = [r3(best.X[0]) + 0, r3(best.X[1]) + 0];
    }
  }
  return walls.filter(w => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > 0.05);
}
/** Groupes de traits reliés (extrémités à moins de eps) : [{ segs, box: [x0, y0, x1, y1] }]. */
export function clusters(segs, eps = 0.03) {
  const par = segs.map((_, i) => i), find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  const g = new Map(), key = (x, y) => Math.round(x / eps) + ',' + Math.round(y / eps);
  segs.forEach((s, i) => { for (const [x, y] of [[s[0], s[1]], [s[2], s[3]]]) { const k = key(x, y), j = g.get(k); if (j == null) g.set(k, i); else par[find(i)] = find(j); } });
  const m = new Map();
  segs.forEach((s, i) => { const r = find(i); let c = m.get(r); if (!c) m.set(r, (c = { segs: [], box: [Infinity, Infinity, -Infinity, -Infinity] })); c.segs.push(s); c.box = [Math.min(c.box[0], s[0], s[2]), Math.min(c.box[1], s[1], s[3]), Math.max(c.box[2], s[0], s[2]), Math.max(c.box[3], s[1], s[3])]; });
  return [...m.values()];
}
/** Chaînes de traits reliés en polylignes (parcours en profondeur des extrémités communes). */
function chains(segs, eps = 0.03) {
  return clusters(segs, eps).map(c => {
    // Polyligne approchée : les points du groupe dans l'ordre du parcours de proche en proche.
    const pts = [[c.segs[0][0], c.segs[0][1]], [c.segs[0][2], c.segs[0][3]]], left = c.segs.slice(1);
    for (let guard = 0; left.length && guard < 5000; guard++) {
      const end = pts[pts.length - 1]; let k = left.findIndex(s => Math.hypot(s[0] - end[0], s[1] - end[1]) < eps * 2 || Math.hypot(s[2] - end[0], s[3] - end[1]) < eps * 2);
      if (k < 0) break; const s = left.splice(k, 1)[0];
      pts.push(Math.hypot(s[0] - end[0], s[1] - end[1]) < eps * 2 ? [s[2], s[3]] : [s[0], s[1]]);
    }
    return { pts: pts.map(p => [r3(p[0]), r3(p[1])]), box: c.box };
  });
}

/** Conversion (voir l'en-tête). */
export function convertCad(doc, o) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const make = { walls: true, doors: true, rooms: true, power: true, data: false, devices: true, ...(o.make || {}) };
  const kinds = o.kinds || {}, kindOf = l => kinds[l] || 'other', tol = { ...CONVERT_TOL, ...(o.tol || {}) };
  const by = segsByKind(doc, o, kindOf), get = k => by.get(k) || [];
  // Objets d'une conversion précédente du même fond (o.tag) : ils seront remplacés, on ne s'appuie pas dessus.
  const keep = x => !o.tag || x.src !== o.tag, fw = ((o.floor && o.floor.walls) || []).filter(keep), fr = ((o.floor && o.floor.rooms) || []).filter(keep);
  const res = { walls: [], doors: [], rooms: [], paths: [], devices: [], stats: {} };
  // Portes d'abord : leurs groupes de traits servent à franchir les baies quand on fusionne les murs.
  const doorGroups = make.doors || make.walls ? clusters(get('doors'), 0.03).filter(c => { const w = Math.max(c.box[2] - c.box[0], c.box[3] - c.box[1]); return w >= 0.45 && w <= 3.2; }) : [];
  // Battants de portes dessinés hors des calques de portes : arcs d'un quart de cercle de 0,5 à 1,5 m de rayon sur les
  // calques d'architecture.
  if (make.doors || make.walls) for (const c of clusters(arcSegs(doc, o, kindOf), 0.03)) {
    const w = c.box[2] - c.box[0], h = c.box[3] - c.box[1];
    if (Math.min(w, h) < 0.5 || Math.max(w, h) > 1.5 || Math.abs(w - h) > 0.25 * Math.max(w, h)) continue;
    const cx = (c.box[0] + c.box[2]) / 2, cy = (c.box[1] + c.box[3]) / 2;
    if (!doorGroups.some(g => Math.abs((g.box[0] + g.box[2]) / 2 - cx) < 0.4 && Math.abs((g.box[1] + g.box[3]) / 2 - cy) < 0.4)) doorGroups.push(c);
  }
  const gaps = doorGroups.map(c => [(c.box[0] + c.box[2]) / 2, (c.box[1] + c.box[3]) / 2, Math.max(c.box[2] - c.box[0], c.box[3] - c.box[1])]);
  if (make.walls) {
    for (const [kd, thin] of [['walls', 0.2], ['partitions', 0.1], ['structure', 0.2], ['windows', 0.05]]) {
      const segs = get(kd); if (!segs.length) continue;
      const mat = KIND_MAT[kd] || 'block';
      for (const w of mergeWalls(pairWalls(segs, tol, thin), kd === 'windows' ? [] : gaps, tol).map(w => ({ ...w, kd }))) {
        if (Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) < 0.05) continue;
        res.walls.push({ a: w.a, b: w.b, t: Math.max(0.01, Math.min(2, w.t)), mat: MATERIALS[mat] ? mat : 'block' });
      }
    }
    res.walls = cleanCorners(res.walls);
  }
  if (make.doors) {
    const all = [...res.walls, ...fw];
    for (const c of doorGroups) {
      const cx = (c.box[0] + c.box[2]) / 2, cy = (c.box[1] + c.box[3]) / 2;
      let best = null;
      for (const w of all) {
        const ux = w.b[0] - w.a[0], uy = w.b[1] - w.a[1], L = Math.hypot(ux, uy); if (L < 0.5) continue;
        const t = Math.max(0, Math.min(1, ((cx - w.a[0]) * ux + (cy - w.a[1]) * uy) / (L * L))), d = Math.hypot(w.a[0] + ux * t - cx, w.a[1] + uy * t - cy);
        if (!best || d < best.d) best = { w, d, L, ux: ux / L, uy: uy / L };
      }
      const size = Math.max(c.box[2] - c.box[0], c.box[3] - c.box[1]);
      if (!best || best.d > size + 0.5) continue;
      // Emprise du groupe le long du mur : la baie.
      const P = c.segs.flatMap(s => [[s[0], s[1]], [s[2], s[3]]]).map(p => (p[0] - best.w.a[0]) * best.ux + (p[1] - best.w.a[1]) * best.uy);
      const lo = Math.max(0, Math.min(...P)), hi = Math.min(best.L, Math.max(...P)), w = Math.max(0.5, Math.min(3, hi - lo));
      if (hi - lo < 0.3) continue;
      res.doors.push({ wall: best.w, at: r3(Math.max(w / 2, Math.min(best.L - w / 2, (lo + hi) / 2))), w: r3(Math.min(w, best.L)) });
    }
  }
  if (make.rooms) {
    const tmp = { walls: [...fw, ...res.walls], rooms: fr };
    const texts = (doc.texts || []).filter(x => o.layers.has(x.layer) || ['text', 'other'].includes(kindOf(x.layer)));
    const to = frame(o), lab = texts.filter(x => inRegion(o.region, x.x, x.y) && isLabel(x.text)).map(x => { const [X, Y] = to(x.x, x.y); return { x: X, y: Y, h: (x.h || 0) * (o.toMetre || 1), text: String(x.text).replace(/\s+/g, ' ').trim() }; });
    for (const r of detectRooms(tmp, { tol: tol.roomTol, minArea: tol.minRoom })) {
      const inside = lab.filter(t => inRoom([t.x, t.y], r)).sort((a, b) => (guessUsage(b.text) ? 1 : 0) - (guessUsage(a.text) ? 1 : 0) || b.h - a.h);
      const name = inside.length ? inside[0].text.slice(0, 40) : '';
      const usage = inside.map(t => guessUsage(t.text)).find(Boolean) || null;
      res.rooms.push({ name, usage: usage && USAGES[usage] ? usage : null, poly: r.poly, ...(r.holes ? { holes: r.holes } : {}) });
    }
  }
  for (const [kd, power] of [['cfo', true], ['elec', true], ['cfa', false]]) {
    if (power ? !make.power : !make.data) continue;
    for (const c of chains(get(kd))) {
      if (Math.hypot(c.box[2] - c.box[0], c.box[3] - c.box[1]) < tol.minRun || c.pts.length < 2) continue;
      res.paths.push({ kind: power ? 'trunking' : 'ceiling', power, pts: c.pts.slice(0, 400) });
    }
  }
  if (make.devices) {
    const to = frame(o), blocks = o.blocks || {}, pats = (o.texts || []).map(p => { try { return { re: new RegExp(p.re, 'i'), type: p.type }; } catch (e) { return null; } }).filter(Boolean);
    const add = (type, X, Y, label) => { const [x, y] = to(X, Y); if (res.devices.some(d => d.type === type && Math.hypot(d.x - x, d.y - y) < 0.5)) return; res.devices.push({ type, x: r3(x), y: r3(y), label }); };
    for (const ins of doc.inserts || []) { const ty = blocks[ins.name]; if (ty && o.layers.has(ins.layer) && inRegion(o.region, ins.x, ins.y)) add(ty, ins.x, ins.y, ins.attribs && Object.values(ins.attribs)[0]); }
    for (const x of doc.texts || []) { if (!inRegion(o.region, x.x, x.y) || !(o.layers.has(x.layer))) continue; const p = pats.find(q => q.re.test(String(x.text))); if (p) add(p.type, x.x, x.y, String(x.text).trim()); }
  }
  res.stats = { ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0), segs: [...by.values()].reduce((s, a) => s + a.length, 0) };
  return res;
}

/** Blocs (INSERT de premier niveau) de la zone sur les calques gardés : [{ name, n, guess }] les plus fréquents d'abord. */
export function blocksIn(doc, region, layers) {
  const m = new Map();
  for (const i of doc.inserts || []) if (layers.has(i.layer) && inRegion(region, i.x, i.y)) m.set(i.name, (m.get(i.name) || 0) + 1);
  return [...m].map(([name, n]) => ({ name, n, guess: guessBlockType(name) })).sort((a, b) => (b.guess ? 1 : 0) - (a.guess ? 1 : 0) || b.n - a.n);
}

/**
 * Applique une conversion au modèle (sans enregistrer : l'appelant fait l'unique commit). Les objets d'une conversion
 * précédente du même fond (même tag) sont d'abord retirés, avec leurs câbles. h : { uid(préfixe), newDevice(type) → appareil
 * avec id unique } ; rend { walls, doors, rooms, paths, devices } (nombres).
 */
export function applyConversion(data, floor, conv, tag, h) {
  removeConverted(data, floor, tag);
  const n = { walls: 0, doors: 0, rooms: 0, paths: 0, devices: 0 }, wid = new Map();
  for (const w of conv.walls) { const o = { id: h.uid('w'), a: w.a, b: w.b, t: r3(w.t), mat: w.mat, src: tag }; floor.walls.push(o); wid.set(w, o); n.walls++; }
  for (const d of conv.doors) { const w = wid.get(d.wall) || d.wall; if (!w || !w.id) continue; floor.doors.push({ id: h.uid('dr'), wall: w.id, at: d.at, w: d.w, src: tag }); n.doors++; }
  let k = 1; const names = new Set(floor.rooms.map(r => r.name));
  for (const r of conv.rooms) {
    let name = r.name; if (!name || names.has(name)) { while (names.has(tl('Pièce {0}', k))) k++; name = name ? `${name} (${k})`.slice(0, 40) : tl('Pièce {0}', k); k++; }
    names.add(name);
    floor.rooms.push({ id: h.uid('rm'), name, usage: r.usage || 'office', poly: r.poly, ...(r.holes ? { holes: r.holes } : {}), src: tag }); n.rooms++;
  }
  data.paths = data.paths || [];
  for (const p of conv.paths) { data.paths.push({ id: h.pathId(), floor: floor.id, kind: p.kind, name: '', pts: p.pts, z: p.power ? 2.6 : 2.9, ...(p.kind === 'trunking' ? { w: 100, h: 50 } : {}), ...(p.power ? { power: true, circuits: 1 } : {}), shield: 'none', src: tag }); n.paths++; }
  for (const d of conv.devices) {
    const dev = h.newDevice(d.type, d); if (!dev) continue;
    dev.loc = { floor: floor.id, x: d.x, y: d.y, h: d.type === 'ap' || d.type === 'camera' ? floor.ceil || 2.7 : d.type.startsWith('outlet') ? 0.3 : 0.75 };
    dev.src = tag; n.devices++;
  }
  return n;
}
/** Retire du modèle les objets créés par une conversion (tag) sur cet étage, et les câbles de ses équipements. */
export function removeConverted(data, floor, tag) {
  if (!tag) return;
  const gone = new Set(floor.walls.filter(w => w.src === tag).map(w => w.id));
  floor.walls = floor.walls.filter(w => w.src !== tag);
  floor.doors = floor.doors.filter(d => d.src !== tag && !gone.has(d.wall));
  floor.rooms = floor.rooms.filter(r => r.src !== tag);
  data.paths = (data.paths || []).filter(p => p.src !== tag);
  const devs = new Set((data.devices || []).filter(d => d.src === tag).map(d => d.id));
  if (devs.size) { data.devices = data.devices.filter(d => !devs.has(d.id)); data.cables = (data.cables || []).filter(c => !devs.has(c.a[0]) && !devs.has(c.b[0])); }
}
export { roomArea, roomPoint };

/**
 * Conversion d'entités choisies sur le fond (outil de sélection du fond, plan-underlay.js) : segs = [[ax, ay, bx, by]…]
 * ou Float32Array à plat, DÉJÀ dans le repère de l'étage (mètres) ; kind : 'walls' | 'partitions' | 'windows' (murs
 * appariés, matériau du genre), 'rooms' (pièces fermées par ces traits et les murs de l'étage, sans créer de murs),
 * 'power' | 'data' (cheminements). Modifie ctx.data() puis un seul ctx.commit() (une annulation). Rend { walls, rooms,
 * paths } (nombres).
 */
export function convertSelection(ctx, floor, segs, kind = 'walls') {
  const list = ArrayBuffer.isView(segs) ? Array.from({ length: segs.length / 4 }, (_, i) => [segs[i * 4], segs[i * 4 + 1], segs[i * 4 + 2], segs[i * 4 + 3], 0]) : (segs || []).map(s => [s[0], s[1], s[2], s[3], 0]);
  const data = ctx.data(), n = { walls: 0, rooms: 0, paths: 0 };
  const ids = new Set(); for (const b of data.site.buildings) { ids.add(b.id); for (const f of b.floors) { ids.add(f.id); for (const k of ['walls', 'doors', 'rooms']) for (const x of f[k]) ids.add(x.id); } }
  const uidOf = p => { let i = ids.size + 1; while (ids.has(p + i)) i++; ids.add(p + i); return p + i; };
  if (!list.length || !floor) return n;
  if (kind === 'walls' || kind === 'partitions' || kind === 'windows') {
    const mat = KIND_MAT[kind] || 'block', thin = kind === 'partitions' ? 0.1 : kind === 'windows' ? 0.05 : 0.2;
    for (const w of cleanCorners(mergeWalls(pairWalls(list, CONVERT_TOL, thin)))) { floor.walls.push({ id: uidOf('w'), a: w.a, b: w.b, t: Math.max(0.01, Math.min(2, w.t)), mat }); n.walls++; }
  } else if (kind === 'rooms') {
    const tmp = { walls: [...floor.walls, ...cleanCorners(mergeWalls(pairWalls(list, CONVERT_TOL, 0.1))), ...list.map(s => ({ a: [s[0], s[1]], b: [s[2], s[3]] }))], rooms: floor.rooms };
    let k = 1; const names = new Set(floor.rooms.map(r => r.name));
    // Seules les faces dont l'intérieur est dans l'emprise de la sélection.
    const bx = [Math.min(...list.map(q => Math.min(q[0], q[2]))), Math.min(...list.map(q => Math.min(q[1], q[3]))), Math.max(...list.map(q => Math.max(q[0], q[2]))), Math.max(...list.map(q => Math.max(q[1], q[3])))];
    for (const r of detectRooms(tmp, { tol: CONVERT_TOL.roomTol, minArea: CONVERT_TOL.minRoom })) {
      const ip = roomPoint(r); if (ip[0] < bx[0] || ip[0] > bx[2] || ip[1] < bx[1] || ip[1] > bx[3]) continue;
      while (names.has(tl('Pièce {0}', k))) k++; const name = tl('Pièce {0}', k); names.add(name);
      floor.rooms.push({ id: uidOf('rm'), name, usage: 'office', poly: r.poly, ...(r.holes ? { holes: r.holes } : {}) }); n.rooms++;
    }
  } else if (kind === 'power' || kind === 'data') {
    data.paths = data.paths || []; const pids = new Set(data.paths.map(p => p.id));
    for (const c of chains(list)) {
      if (c.pts.length < 2) continue; let i = 1; while (pids.has('pa' + i)) i++; pids.add('pa' + i);
      data.paths.push({ id: 'pa' + i, floor: floor.id, kind: kind === 'power' ? 'trunking' : 'ceiling', name: '', pts: c.pts.slice(0, 400), z: kind === 'power' ? 2.6 : 2.9, ...(kind === 'power' ? { w: 100, h: 50, power: true, circuits: 1 } : {}), shield: 'none' }); n.paths++;
    }
  }
  if (n.walls || n.rooms || n.paths) ctx.commit();
  return n;
}
