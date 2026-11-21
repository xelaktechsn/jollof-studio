// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique pure de l'assistant d'import DXF/DWG (cadimport.js) : genre d'un calque deviné d'après son nom (FR/EN, codes
// AIA du type A-WALL), regroupement des calques par préfixe de référence externe liée (« X$0$ », « X| », « X_ »),
// unités du dessin et contrôle de vraisemblance (largeur de porte mesurée), choix d'une feuille (groupe d'entités) dans
// l'espace objet, comptage dans une zone. Aucun accès au DOM : testé dans cadimport-logic.test.mjs.

/** Facteurs vers le mètre ; $INSUNITS (DXF) → unité. */
export const UNIT_M = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };
export const INSUNITS = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };

/* ---------- Genre des calques ---------- */
// Ordre : du plus précis au plus général (le premier qui convient l'emporte). Motifs sur le nom en majuscules sans
// accents ; « tok » : mot entier (séparé par tout ce qui n'est ni lettre ni chiffre), « sub » : n'importe où dans le nom.
const KINDS = [
  ['hatch', { sub: ['HATCH', 'HACHUR', 'REMPLISSAGE', 'A-PATT', 'SOLID FILL'], tok: ['FILL', 'FILLS', 'PATT', 'POCHE'] }],
  ['dims', { sub: ['COTATION', 'DIMENSION', 'A-ANNO-DIMS'], tok: ['COTE', 'COTES', 'DIM', 'DIMS', 'COTATIONS'] }],
  ['text', { sub: ['TEXT', 'ANNOTATION', 'A-ANNO'], tok: ['TXT', 'LABEL', 'LABELS', 'NOTE', 'NOTES', 'ANNO', 'ETIQUETTE', 'ETIQUETTES', 'NOM', 'NOMS'] }],
  ['doors', { sub: ['PORTE', 'A-DOOR', 'DOOR'], tok: ['PTE', 'PTES'] }],
  ['windows', { sub: ['FENETRE', 'WINDOW', 'A-GLAZ', 'VITRAGE', 'MENUISERIE'], tok: ['GLAZ', 'BAIE', 'BAIES'] }],
  ['partitions', { sub: ['CLOISON', 'PARTITION', 'A-WALL-PRHT'], tok: [] }],
  ['walls', { sub: ['A-WALL', 'WALL', 'MUR', 'MACONNERIE', 'VOILE'], tok: ['MURS'] }],
  ['structure', { sub: ['STRUCT', 'POTEAU', 'POUTRE', 'COLUMN', 'BEAM', 'CHARPENTE', 'TOITURE', 'ROOF'], tok: ['TOIT', 'AXE', 'AXES', 'GRID', 'A-COLS'] }],
  ['cfa', { sub: ['CFA', 'COURANT FAIBLE', 'COURANTS FAIBLES', 'TELECOM', 'VDI', 'RESEAU', 'NETWORK', 'INFORMATIQUE', 'T-COMM'], tok: ['DATA', 'LAN', 'COM', 'IT', 'WIFI', 'SSI', 'VIDEO', 'CCTV'] }],
  ['cfo', { sub: ['CFO', 'COURANT FORT', 'COURANTS FORTS', 'E-POWR', 'PUISSANCE'], tok: ['POWER', 'PRISES', 'TGBT'] }],
  ['elec', { sub: ['ELEC', 'ECLAIRAGE', 'LIGHTING', 'E-LITE'], tok: ['LUM', 'LIGHT'] }],
  ['furniture', { sub: ['MOBILIER', 'FURN', 'FURNITURE', 'EQUIP', 'SANITAIRE', 'GONDOLE'], tok: ['MOB', 'MEUBLE', 'MEUBLES'] }]
];
/** Genres connus (ordre d'affichage) ; 'other' : le reste. */
export const KIND_IDS = ['walls', 'partitions', 'doors', 'windows', 'structure', 'elec', 'cfo', 'cfa', 'furniture', 'text', 'dims', 'hatch', 'other'];
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Genre d'un calque d'après son nom (sans le préfixe de référence externe). */
export function guessKind(name) {
  // « Murs porteurs » ne sont pas des portes.
  const n = norm(baseName(name)).replace(/PORTEU(R|SE)S?/g, ' '), toks = new Set(n.split(/[^A-Z0-9]+/).filter(Boolean));
  for (const [id, k] of KINDS) {
    if (k.sub.some(s => n.includes(s))) return id;
    if (k.tok.some(t => toks.has(t))) return id;
  }
  // Codes AIA (S-…, E-…, T-…) dont le groupe n'a rien dit : la discipline seule.
  const aia = /^([A-Z])-[A-Z]/.exec(n);
  return (aia && { S: 'structure', E: 'elec', T: 'cfa' }[aia[1]]) || 'other';
}
/** Nom sans le préfixe de référence externe liée (« X$0$ », « X| ») ni les préfixes « Nouveau_ / New_ » reconnus. */
export function baseName(name) {
  let s = String(name || '');
  for (;;) {
    const i = s.indexOf('$0$'); if (i > 0) { s = s.slice(i + 3); continue; }
    const j = s.indexOf('|'); if (j > 0) { s = s.slice(j + 1); continue; }
    return s;
  }
}
/** Préréglages proposés par l'assistant : genres gardés. 'clean' est celui de départ (sans hachures, cotes ni mobilier). */
export const PRESETS = {
  clean: KIND_IDS.filter(k => k !== 'hatch' && k !== 'dims' && k !== 'furniture'),
  archi: ['walls', 'partitions', 'doors', 'windows', 'structure'],
  archiElec: ['walls', 'partitions', 'doors', 'windows', 'structure', 'elec', 'cfo', 'cfa'],
  all: KIND_IDS.slice(),
  none: []
};
/** Genres affichés atténués par défaut (le mobilier ne doit pas cacher le réseau). */
export const DIM_KINDS = new Set(['furniture']);
/**
 * Calques gardés pour un préréglage : Set des id. Les calques éteints ou gelés dans le DXF, ou vides, ne sont gardés
 * que par « tout ».
 */
export function presetLayers(layers, preset) {
  const keep = new Set(PRESETS[preset] || PRESETS.clean), out = new Set();
  for (const l of layers || []) {
    if (!l || !(l.count > 0)) continue;
    if (preset !== 'all' && (l.off || l.frozen)) continue;
    if (keep.has(l.kind || guessKind(l.name))) out.add(l.id);
  }
  return out;
}

/* ---------- Regroupement par préfixe ---------- */
/** Préfixe d'un nom : { prefix, rest, sep } ou null. « $0$ » et « | » (références externes) d'abord, puis « _ ». */
export function splitPrefix(name) {
  const s = String(name || '');
  for (const sep of ['$0$', '|', '_']) {
    const i = s.indexOf(sep);
    if (i > 0 && i + sep.length < s.length) return { prefix: s.slice(0, i), rest: s.slice(i + sep.length), sep };
  }
  return null;
}
/**
 * Arbre des calques : { groups: [nœud], layers: [id] } ; nœud = { key, label, sep, groups, layers, n (calques), count
 * (entités) }. Un préfixe « $0$ » ou « | » fait toujours un groupe ; un préfixe « _ » seulement s'il est partagé par au
 * moins `min` calques. Récursif (préfixes imbriqués, ex. « Nouveau_New_… ») jusqu'à `depth` niveaux.
 */
export function groupLayers(layers, { min = 3, depth = 3 } = {}) {
  const items = (layers || []).map(l => ({ l, rest: String(l.name || '') }));
  return group(items, '', min, depth);
}
function group(items, path, min, depth) {
  const by = new Map(), direct = [];
  if (depth > 0) for (const it of items) {
    const p = splitPrefix(it.rest);
    if (!p) { direct.push(it); continue; }
    const k = p.sep + '\u0000' + p.prefix;
    if (!by.has(k)) by.set(k, { prefix: p.prefix, sep: p.sep, items: [] });
    by.get(k).items.push({ l: it.l, rest: p.rest, it });
  } else direct.push(...items);
  const groups = [];
  for (const g of by.values()) {
    if (g.sep === '_' && g.items.length < min) { direct.push(...g.items.map(x => x.it)); continue; }
    const key = path + g.prefix + g.sep, sub = group(g.items.map(x => ({ l: x.l, rest: x.rest })), key, min, depth - 1);
    groups.push({ key, label: g.prefix.trim() || g.prefix, sep: g.sep, groups: sub.groups, layers: sub.layers, n: sub.n, count: sub.count });
  }
  // Un même nom de groupe venu de deux séparateurs : rare, gardés séparés (clé différente).
  groups.sort((a, b) => a.label.localeCompare(b.label));
  direct.sort((a, b) => String(a.l.name).localeCompare(String(b.l.name)));
  const n = direct.length + groups.reduce((s, g) => s + g.n, 0);
  const count = direct.reduce((s, it) => s + (it.l.count || 0), 0) + groups.reduce((s, g) => s + g.count, 0);
  return { groups, layers: direct.map(it => it.l.id), n, count };
}
/** Tous les id de calques d'un nœud (et de ses sous-groupes). */
export function nodeLayers(node, out = []) { out.push(...node.layers); for (const g of node.groups) nodeLayers(g, out); return out; }
/** Filtre de recherche : calques dont le nom contient tous les mots (sans accents ni casse). */
export function searchLayers(layers, q) {
  const words = norm(q).split(/\s+/).filter(Boolean); if (!words.length) return null;
  const out = new Set(); for (const l of layers || []) { const n = norm(l.name); if (words.every(w => n.includes(w))) out.add(l.id); }
  return out;
}

/* ---------- Feuilles (groupes d'entités séparés dans l'espace objet) ---------- */
const area = c => Math.max(0, c.x1 - c.x0) * Math.max(0, c.y1 - c.y0);
/** Feuille sous le point (la plus petite qui le contient), sinon -1. */
export function clusterAt(clusters, x, y) {
  let best = -1, ba = Infinity;
  (clusters || []).forEach((c, i) => { if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1 && area(c) < ba) { ba = area(c); best = i; } });
  return best;
}
/** Ordre de lecture des feuilles (rangées de haut en bas, puis de gauche à droite ; y du DXF vers le haut). */
export function clusterOrder(clusters) {
  const cs = (clusters || []).map((c, i) => ({ c, i }));
  if (!cs.length) return [];
  const h = cs.reduce((s, x) => s + (x.c.y1 - x.c.y0), 0) / cs.length || 1;
  const row = x => Math.round(-((x.c.y0 + x.c.y1) / 2) / h);
  return cs.sort((a, b) => row(a) - row(b) || a.c.x0 - b.c.x0).map(x => x.i);
}
/** Zone d'une feuille avec une marge (fraction de sa taille). */
export function clusterRegion(c, pad = 0.02) {
  const m = Math.max(c.x1 - c.x0, c.y1 - c.y0) * pad;
  return [c.x0 - m, c.y0 - m, c.x1 + m, c.y1 + m];
}
/** Zone normalisée à partir de deux coins. */
export const boxOf = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];

/** Segments (et entités de texte) d'une zone pour des calques donnés : { segs, texts }. Segment gardé si un bout est dedans. */
export function countIn(doc, region, layers) {
  const s = doc.segs, L = doc.segLayer, [x0, y0, x1, y1] = region; let segs = 0, texts = 0;
  const inR = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  for (let i = 0, n = L.length; i < n; i++) {
    if (layers && !layers.has(L[i])) continue;
    const k = i * 4; if (inR(s[k], s[k + 1]) || inR(s[k + 2], s[k + 3])) segs++;
  }
  const byName = layerIndex(doc);
  for (const t of doc.texts || []) { const id = byName(t.layer); if ((!layers || layers.has(id)) && inR(t.x, t.y)) texts++; }
  return { segs, texts };
}
/** Numéro de calque d'un texte (le texte peut porter l'id ou le nom de son calque). */
export function layerIndex(doc) {
  const m = new Map(); for (const l of doc.layers || []) m.set(l.name, l.id);
  return v => (typeof v === 'number' ? v : m.has(v) ? m.get(v) : -1);
}

/* ---------- Unités et vraisemblance ---------- */
/** Unité de départ : celle de l'en-tête ($INSUNITS), sinon devinée d'après la taille du dessin. */
export function unitsOf(doc) {
  const u = doc.units && UNIT_M[doc.units] ? doc.units : INSUNITS[doc.insunits];
  if (u) return { units: u, toMetre: UNIT_M[u], from: 'header' };
  const e = doc.extents || [0, 0, 0, 0], size = Math.max(e[2] - e[0], e[3] - e[1]);
  return { units: guessUnits(size), toMetre: UNIT_M[guessUnits(size)], from: 'size' };
}
/** Unité la plus plausible pour un dessin de cette taille (unités du dessin) : un site de 10 à 1 000 m. */
export function guessUnits(size) {
  if (!(size > 0)) return 'm';
  let best = 'm', bd = Infinity;
  for (const [u, k] of Object.entries(UNIT_M)) { const d = Math.abs(Math.log10(size * k) - Math.log10(80)); if (d < bd) { bd = d; best = u; } }
  return best;
}
/** Verdict sur la taille d'une zone (m) : 'ok' | 'small' | 'large'. Un bâtiment fait de 3 m à 2 km. */
export const sizeVerdict = m => (m < 3 ? 'small' : m > 2000 ? 'large' : 'ok');
/**
 * Largeur de porte typique mesurée (unités du dessin) sur les calques de portes d'une zone : longueur la plus fréquente
 * des segments droits plausibles (vantail). Rend { w, n } ou null. toMetre : unité supposée (pour borner 0,5–1,6 m) ;
 * sans toMetre, essaie chaque unité et rend aussi l'unité où la porte est la plus vraisemblable (`units`).
 */
export function doorWidth(doc, region, toMetre) {
  const doors = new Set((doc.layers || []).filter(l => (l.kind || guessKind(l.name)) === 'doors').map(l => l.id));
  if (!doors.size) return null;
  const s = doc.segs, L = doc.segLayer, lens = [];
  const [x0, y0, x1, y1] = region || [-Infinity, -Infinity, Infinity, Infinity];
  for (let i = 0, n = L.length; i < n && lens.length < 200000; i++) {
    if (!doors.has(L[i])) continue;
    const k = i * 4; if (s[k] < x0 || s[k] > x1 || s[k + 1] < y0 || s[k + 1] > y1) continue;
    lens.push(Math.hypot(s[k + 2] - s[k], s[k + 3] - s[k + 1]));
  }
  if (!lens.length) return null;
  const at = k => { // mode des longueurs entre 0,5 et 1,6 m, par classes de 5 cm
    const bins = new Map(); for (const v of lens) { const m = v * k; if (m >= 0.5 && m <= 1.6) { const b = Math.round(m / 0.05); bins.set(b, (bins.get(b) || 0) + 1); } }
    let bb = null, bn = 0; for (const [b, c] of bins) if (c > bn || (c === bn && b < bb)) { bb = b; bn = c; }
    if (bb == null) return null;
    const near = lens.filter(v => Math.abs(v * k - bb * 0.05) <= 0.05).sort((a, b) => a - b);
    return { w: near[near.length >> 1], n: bn };
  };
  if (toMetre) { const r = at(toMetre); return r && r.n >= 2 ? r : null; }
  // À effectif égal, l'unité où la porte est la plus proche de 0,9 m l'emporte.
  let best = null;
  for (const [u, k] of Object.entries(UNIT_M)) {
    const r = at(k); if (!r || r.n < 2) continue;
    const e = Math.abs(r.w * k - 0.9);
    if (!best || r.n > best.n || (r.n === best.n && e < best.e)) best = { ...r, units: u, e };
  }
  if (best) delete best.e;
  return best;
}
/** Taille estimée du paquet binaire (octets) pour n segments et t textes : modèle simple, réglé sur packUnderlay. */
export const estimateBytes = (segs, texts) => Math.round(segs * 7 + texts * 24 + 2048);

/* ---------- Motifs de textes en mots-clés (étape de conversion) ---------- */
// Un motif « textes → équipements » se montre en mots-clés quand il a l'une de ces formes simples ; sinon il reste en
// expression régulière (réglage avancé). Suffixes reconnus : aucun, numéro (« AP 12 », « AP-12 »), multiplicateur (« RJ45 x2 »).
export const PATTERN_SUFFIX = { none: '', number: '\\s*-?\\s*\\d+', times: '(\\s*[x×]\\s*\\d)?' };
const reEsc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Mots-clés → expression régulière (insensible à la casse côté appelant) ; un espace dans un mot = espaces facultatifs. */
export function keywordsToRegex(words, suffix = 'none') {
  const ws = (words || []).map(w => String(w).trim()).filter(Boolean).slice(0, 40);
  if (!ws.length) return '';
  return '^\\s*(' + ws.map(w => w.split(/\s+/).map(reEsc).join('\\s*')).join('|') + ')' + (PATTERN_SUFFIX[suffix] ?? '') + '\\s*$';
}
/** Expression régulière → { words, suffix } si elle a une forme simple, sinon null (à montrer en mode avancé). */
export function regexKeywords(re) {
  const m = /^\^\\s\*\((.+?)\)(.*)\\s\*\$$/.exec(String(re || '')); if (!m) return null;
  const suffix = Object.keys(PATTERN_SUFFIX).find(k => PATTERN_SUFFIX[k] === m[2]); if (suffix == null) return null;
  const words = [];
  for (const alt of m[1].split('|')) {
    const w = alt.replace(/\\s\*/g, ' ').replace(/\\(.)/g, '$1');
    if (!w.trim() || /[()[\]{}*+?^$|\\]/.test(alt.replace(/\\s\*/g, '').replace(/\\[.\-]/g, ''))) return null;
    words.push(w.trim());
  }
  return { words, suffix };
}
