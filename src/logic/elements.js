// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique : bibliothèque des éléments (portes, bascules, circuits combinatoires et séquentiels,
// entrées, sorties). Chaque élément décrit ses broches (en unités de grille), son comportement et
// son symbole. Le symbole est une liste d'ordres de dessin abstraits (traits, cercles, textes) :
// la même liste donne le SVG de l'éditeur et le PDF du compte-rendu. Deux styles de symboles :
// ANSI (formes distinctives) et CEI (rectangles « & », « ≥1 », « =1 »).
// Indépendant de l'interface : sert aussi à la simulation sous Node (tests, vérification des TP).
import { tl, DEC } from '../i18n/index.js';

/** Niveaux logiques : 0, 1, X (inconnu ou conflit), Z (haute impédance, non piloté). */
export const L0 = 0, L1 = 1, X = 2, Z = 3;
export const LEVEL_TXT = ['0', '1', 'X', 'Z'];
const isB = v => v === 0 || v === 1;
export const NOT = v => (v === 0 ? 1 : v === 1 ? 0 : X);
export function AND(a) { let x = false; for (const v of a) { if (v === 0) return 0; if (v !== 1) x = true; } return x ? X : 1; }
export function OR(a) { let x = false; for (const v of a) { if (v === 1) return 1; if (v !== 0) x = true; } return x ? X : 0; }
export function XOR(a) { let p = 0; for (const v of a) { if (!isB(v)) return X; p ^= v; } return p; }
/** Nombre lu sur des bits (0 en premier) ; null si un bit est inconnu. */
export function word(bits) { let n = 0; for (let i = 0; i < bits.length; i++) { if (!isB(bits[i])) return null; n |= bits[i] << i; } return n; }

/* ---------- Géométrie des symboles ---------- */
// Ordres : { t: 'path', pts, close, fill: 'body'|'ink'|'none'|couleur, w } ; { t: 'circle', x, y, r, fill } ;
// { t: 'text', x, y, str, s, a: 'l'|'m'|'r', b, ov (barre au-dessus), mono }. Coordonnées en unités de grille.
const P = (pts, o = {}) => ({ t: 'path', pts, fill: 'none', ...o });
const C = (x, y, r, o = {}) => ({ t: 'circle', x, y, r, fill: 'body', ...o });
const T = (x, y, str, o = {}) => ({ t: 'text', x, y, str: String(str), s: 0.9, a: 'm', ...o });
/** Courbe de Bézier quadratique échantillonnée (sans le premier point). */
function quad(p0, c, p1, n = 10) { const out = []; for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]); } return out; }
/** Arc d'ellipse de a0 à a1 (radians, sens horaire à l'écran). */
function arc(cx, cy, rx, ry, a0, a1, n = 14) { const out = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } return out; }
/** Petit rond de négation. */
const bubble = (x, y) => C(x + 0.25, y, 0.25);
/** Marque d'horloge (triangle) sur le bord gauche d'un boîtier, en y. Rond devant si front descendant. */
function clockMark(x, y, fall) {
  const o = [P([[x, y - 0.35], [x + 0.45, y], [x, y + 0.35]])];
  return fall ? [bubble(x - 0.5, y), ...o] : o;
}

/* ---------- Broches ---------- */
// Broche : { name, dir: 'in'|'out'|'io', x, y, side: 'l'|'r'|'t'|'b'|'c', label?, ov? (nom barré), clk?, neg?,
// opt? (valeur si non reliée), bus? (noms des bits d'une broche de bus, bit 0 en premier), weak? (sortie faible) }
const pin = (name, dir, x, y, side, o = {}) => ({ name, dir, x, y, side, ...o });
/** Clés d'une broche dans les équipotentielles : une par bit pour une broche de bus, sinon son nom. */
export const pinKeys = p => p.bus || [p.name];
/** Nombre de bits transportés par une broche. */
export const pinWidth = p => (p.bus ? p.bus.length : 1);
const LETTERS = 'ABCDEFGH';
/** Entrées d'une porte à n entrées : positions 1…h−1, sans le milieu si n est pair (la sortie y est). */
function gateGeom(n) {
  if (n <= 1) return { h: 2, ys: [1], out: 1 };
  const h = n % 2 ? n + 1 : n + 2, mid = h / 2, ys = [];
  for (let y = 1; y < h && ys.length < n; y++) if (n % 2 || y !== mid) ys.push(y);
  return { h, ys, out: mid };
}

/* ---------- Portes ---------- */
const GATE = {
  buf: { fn: a => a[0], neg: false, iec: '1', min: 1 },
  not: { fn: a => a[0], neg: true, iec: '1', min: 1 },
  and: { fn: AND, neg: false, iec: '&' },
  nand: { fn: AND, neg: true, iec: '&' },
  or: { fn: OR, neg: false, iec: '≥1' },
  nor: { fn: OR, neg: true, iec: '≥1' },
  xor: { fn: XOR, neg: false, iec: '=1' },
  xnor: { fn: XOR, neg: true, iec: '=1' }
};
function gateSym(kind, n, style) {
  const g = GATE[kind], { h, ys, out } = gateGeom(n), w = n <= 1 ? 4 : 5, ops = [];
  const end = g.neg ? w - 1.5 : w - 1; // fin du corps (avant le rond de négation)
  if (style === 'iec') {
    ops.push(P([[1, 0], [end, 0], [end, h], [1, h]], { close: true, fill: 'body' }));
    ops.push(T((1 + end) / 2, 1.15, g.iec, { s: n <= 1 ? 0.95 : 1.05, b: true }));
    ys.forEach(y => ops.push(P([[0, y], [1, y]])));
  } else if (kind === 'buf' || kind === 'not') {
    ops.push(P([[1, 0], [end, 1], [1, 2]], { close: true, fill: 'body' }));
    ops.push(P([[0, 1], [1, 1]]));
  } else if (kind === 'and' || kind === 'nand') {
    const rx = Math.min(h / 2, 2), xa = end - rx;
    ops.push(P([[1, 0], [xa, 0], ...arc(xa, h / 2, rx, h / 2, -Math.PI / 2, Math.PI / 2, 18), [1, h]], { close: true, fill: 'body' }));
    ys.forEach(y => ops.push(P([[0, y], [1, y]])));
  } else {
    const xor = kind === 'xor' || kind === 'xnor', xb = xor ? 1.35 : 1; // dos du corps
    const back = t => xb + 1.6 * t * (1 - t); // abscisse du dos concave à la hauteur relative t
    const body = [[xb, 0], ...quad([xb, 0], [end - 1.2, 0], [end, h / 2], 12), ...quad([end, h / 2], [end - 1.2, h], [xb, h], 12), ...quad([xb, h], [xb + 0.8, h / 2], [xb, 0], 10)];
    ops.push(P(body, { close: true, fill: 'body' }));
    if (xor) ops.push(P([[xb - 0.4, 0], ...quad([xb - 0.4, 0], [xb + 0.4, h / 2], [xb - 0.4, h], 10)]));
    ys.forEach(y => ops.push(P([[0, y], [(xor ? back(y / h) - 0.4 : back(y / h)), y]])));
  }
  if (g.neg) { ops.push(bubble(end, out)); ops.push(P([[end + 0.5, out], [w, out]])); }
  else ops.push(P([[end, out], [w, out]]));
  return ops;
}
function gateDef(kind, name, full, doc) {
  const g = GATE[kind], single = g.min === 1;
  return {
    cat: 'gates', kind: 'gate', name, full, doc,
    props: single ? [] : [{ k: 'n', label: () => tl('Nombre d’entrées'), type: 'int', min: 2, max: 8, def: 2 }],
    layout(p) {
      const n = single ? 1 : p.n || 2, { h, ys, out } = gateGeom(n), w = single ? 4 : 5;
      return { w, h, pins: [...ys.map((y, i) => pin(LETTERS[i], 'in', 0, y, 'l')), pin('Y', 'out', w, out, 'r')] };
    },
    ev(I, p) { const n = single ? 1 : p.n || 2, a = []; for (let i = 0; i < n; i++) a.push(I[LETTERS[i]]); const v = g.fn(a); return { Y: g.neg ? NOT(v) : (isB(v) ? v : X) }; },
    sym: (p, style) => gateSym(kind, single ? 1 : p.n || 2, style),
    fn: kind
  };
}

/* ---------- Boîtiers rectangulaires (bascules, circuits intégrés) ---------- */
/**
 * Boîtier : corps de x=1 à x=w−1, broches à gauche (entrées) et à droite (sorties), en haut et en bas
 * (entrées asynchrones, sélection). title : texte en haut du corps.
 */
function boxSym(L, title, style, o = {}) {
  const { w, h } = L, top = L.pins.some(p => p.side === 't') ? 1 : 0, bot = L.pins.some(p => p.side === 'b') ? 1 : 0;
  const ops = [], x0 = 1, x1 = w - 1, y0 = top, y1 = h - bot;
  if (o.trap && style !== 'iec') { // multiplexeur : trapèze (ANSI)
    const k = o.trap;
    ops.push(P([[x0, y0], [x1, y0 + k], [x1, y1 - k], [x0, y1]], { close: true, fill: 'body' }));
  } else if (o.trapR && style !== 'iec') { // démultiplexeur : trapèze inversé
    const k = o.trapR;
    ops.push(P([[x0, y0 + k], [x1, y0], [x1, y1], [x0, y1 - k]], { close: true, fill: 'body' }));
  } else ops.push(P([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { close: true, fill: 'body' }));
  if (title) ops.push(T((x0 + x1) / 2, y0 + (o.titleY ?? 1.05), title, { s: 0.85, b: true }));
  for (const p of L.pins) {
    const lab = p.label ?? p.name, stub = p.bus ? { w: 0.3 } : {}; // broche de bus : patte épaisse
    if (p.side === 'l') {
      ops.push(P([[0, p.y], [p.neg ? x0 - 0.5 : x0, p.y]], stub)); if (p.neg) ops.push(bubble(x0 - 0.5, p.y));
      if (p.clk) ops.push(...clockMark(x0, p.y, false));
      if (lab) ops.push(T(x0 + (p.clk ? 0.6 : 0.25), p.y + 0.3, lab, { s: 0.68, a: 'l', ov: p.ov }));
    } else if (p.side === 'r') {
      ops.push(P([[x1, p.y], [w, p.y]], stub));
      if (lab) ops.push(T(x1 - 0.25, p.y + 0.3, lab, { s: 0.68, a: 'r', ov: p.ov }));
    } else if (p.side === 't') {
      ops.push(P([[p.x, 0], [p.x, y0]]));
      if (lab) ops.push(T(p.x, y0 + 0.8, lab, { s: 0.62 }));
    } else if (p.side === 'b') {
      ops.push(P([[p.x, h], [p.x, y1 - (o.trapB ? o.trapB(p.x) : 0)]]));
      if (lab) ops.push(T(p.x, y1 - 0.3 - (o.trapB ? o.trapB(p.x) : 0), lab, { s: 0.62 }));
    }
  }
  return ops;
}
const EDGE = { k: 'edge', label: () => tl('Front actif'), type: 'enum', def: 'rise', opts: [['rise', () => tl('Montant ↑')], ['fall', () => tl('Descendant ↓')]] };
/** Front actif sur l'horloge : st.clk garde la valeur précédente. */
function edge(st, clk, p) {
  const prev = st.clk; st.clk = clk;
  if (st.powerUp) return false; // mise sous tension : les niveaux s'établissent, aucun front n'est compté
  if (prev == null || !isB(prev) || !isB(clk)) return false;
  return p.edge === 'fall' ? prev === 1 && clk === 0 : prev === 0 && clk === 1;
}
const qOut = q => ({ Q: q, QN: NOT(q) });
/** Rond de front descendant devant la broche d'horloge d'un boîtier. */
const clkBubble = L => { const c = L.pins.find(q => q.clk); return bubble(0.5, c ? c.y : 1); };
/** Bascule à entrées asynchrones PR (mise à 1) et CLR (mise à 0), actives à 1, facultatives. */
function ffLayout(ins) {
  const pins = [];
  const ys = ins.length === 2 ? [2, 4] : [2, 3, 4];
  ins.forEach((n, i) => pins.push(pin(n, 'in', 0, ys[i], 'l', { clk: n === 'CLK', label: n === 'CLK' ? '' : n })));
  pins.push(pin('Q', 'out', 6, 2, 'r'), pin('QN', 'out', 6, 4, 'r', { label: 'Q', ov: true }));
  pins.push(pin('PR', 'in', 3, 0, 't', { opt: 0 }), pin('CLR', 'in', 3, 6, 'b', { opt: 0 }));
  return { w: 6, h: 6, pins };
}
function asyncSet(I, st) {
  if (I.CLR === 1 && I.PR === 1) { st.q = 0; return { Q: 0, QN: 0 }; } // état interdit : les deux sorties à 0
  if (I.CLR === 1) { st.q = 0; return qOut(0); }
  if (I.PR === 1) { st.q = 1; return qOut(1); }
  if (!isB(I.CLR) || !isB(I.PR)) { st.q = X; return qOut(X); }
  return null;
}
function ffDef(id, ins, name, full, doc, next) {
  return {
    cat: 'ff', kind: 'ff', seq: true, name, full, doc, props: [EDGE],
    layout: () => ffLayout(ins),
    init: () => ({ q: 0, clk: null }),
    ev(I, p, st) {
      const e = edge(st, I.CLK, p);
      const a = asyncSet(I, st); if (a) return a;
      if (e) st.q = next(I, st.q);
      return qOut(st.q);
    },
    sym(p, style) {
      const L = ffLayout(ins), ops = boxSym(L, '', style);
      if (p.edge === 'fall') ops.push(bubble(0.5, 3 + (ins.length === 2 ? 1 : 0)));
      return ops;
    }
  };
}
const nextVal = (cond, v) => (isB(cond) ? v : X);

/* ---------- Vecteurs de bits ---------- */
const range = n => Array.from({ length: n }, (_, i) => i);
const BITS = (def, min = 1, max = 8, label = () => tl('Nombre de bits'), k = 'bits') => ({ k, label, type: 'int', min, max, def });
/** Option « broches en bus » : un nombre de n bits passe par une seule broche (un fil épais) au lieu de n. */
const BUS = { k: 'bus', label: () => tl('Broches des nombres'), type: 'enum', def: 0, opts: [[0, () => tl('Un fil par bit')], [1, () => tl('Un bus')]] };
const YESNO = (k, label) => ({ k, label, type: 'enum', def: 0, opts: [[0, () => tl('Non')], [1, () => tl('Oui')]] });
/** Noms des bits d'un nombre : A pour un seul bit (sauf indexed), sinon A0, A1… (bit 0 = poids faible). */
const bitNames = (name, n, indexed = false) => (n === 1 && !indexed ? [name] : range(n).map(i => name + i));
/** Nombre lu sur les bits d'un groupe (null si un bit est inconnu). */
const rd = (I, name, n, indexed) => word(bitNames(name, n, indexed).map(k => I[k]));
/** Écrit un nombre (null : inconnu) sur les bits d'un groupe de sorties. */
function wr(o, name, n, v, indexed) { bitNames(name, n, indexed).forEach((k, i) => (o[k] = v == null ? X : (v >> i) & 1)); return o; }
/**
 * Boîtier à colonnes de broches : left (entrées), right (sorties), bottom (broches du bas, x imposé).
 * Élément d'une colonne : { name, dir, n?, bus?, indexed?, gap? (lignes sautées avant), ...options de broche }.
 * Un groupe de n bits donne n broches (A0, A1…) ou, avec bus, une seule broche de bus « A ».
 */
function boxLayout({ w = 7, left = [], right = [], bottom = [], minH = 3 }) {
  const pins = [];
  const column = (list, x, side) => {
    let y = 1;
    for (const g of list) {
      if (!g) continue;
      const { name, dir, n = 1, bus, indexed, gap = 0, ...o } = g, names = bitNames(name, n, indexed);
      y += gap;
      if (bus && n > 1) { pins.push(pin(name, dir, x, y, side, { bus: names, ...o })); y += 1; }
      else for (const nm of names) { pins.push(pin(nm, dir, x, y, side, o)); y += 1; }
    }
    return y;
  };
  let h = Math.max(column(left, 0, 'l'), column(right, w, 'r'), minH);
  if (bottom.length) { h += 1; for (const { name, dir, x, ...o } of bottom) pins.push(pin(name, dir, x, h, 'b', o)); }
  return { w, h, pins };
}
/** Contenu d'une mémoire morte : mots hexadécimaux séparés par des espaces (adresse 0 en premier). */
const memCache = new Map();
export function memWords(data, abits, dbits) {
  const key = `${abits}|${dbits}|${data || ''}`;
  let m = memCache.get(key);
  if (!m) {
    const words = String(data || '').match(/[0-9a-f]+/gi) || [], mask = (1 << dbits) - 1;
    m = range(1 << abits).map(i => (i < words.length ? parseInt(words[i].slice(-4), 16) & mask : 0));
    if (memCache.size > 60) memCache.clear();
    memCache.set(key, m);
  }
  return m;
}
/** Disposition d'un bloc (sous-circuit) d'après son interface io = { t: nom, ins: [{ n, w, c }], outs: [{ n, w }] }. */
function blockLayout(io) {
  const ins = (io && io.ins) || [], outs = (io && io.outs) || [], t = String((io && io.t) || '?');
  const len = list => list.reduce((m, q) => Math.max(m, String(q.n).length + (q.c ? 1 : 0)), 0);
  const w = Math.max(5, Math.ceil(Math.max(t.length * 0.52 + 2.6, (len(ins) + len(outs)) * 0.42 + 3.3)));
  const sub = q => (q.w > 1 ? { bus: range(q.w).map(i => q.n + '#' + i) } : {});
  const pins = [...ins.map((q, i) => pin(q.n, 'in', 0, i + 2, 'l', { ...sub(q), clk: !!q.c || undefined })), ...outs.map((q, i) => pin(q.n, 'out', w, i + 2, 'r', sub(q)))];
  return { w, h: Math.max(ins.length, outs.length, 1) + 2, pins };
}
/** Chiffres hexadécimaux en 7 segments (a…g). */
export const SEG7 = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];
/** Dessin d'un afficheur 7 segments dans le rectangle (x, y, largeur w, hauteur h) ; on : bits a…g, dp. */
function digit(x, y, w, h, on, color) {
  const ops = [], t = Math.min(w, h) * 0.13, m = h / 2;
  const seg = [
    [[x + t, y], [x + w - t, y]], [[x + w, y + t], [x + w, y + m - t]], [[x + w, y + m + t], [x + w, y + h - t]],
    [[x + t, y + h], [x + w - t, y + h]], [[x, y + m + t], [x, y + h - t]], [[x, y + t], [x, y + m - t]], [[x + t, y + m], [x + w - t, y + m]]
  ];
  seg.forEach((s, i) => ops.push(P(s, { w: t * 1.25, color: on && on[i] === 1 ? color : 'off', cap: true })));
  if (on && on.length > 7) ops.push(C(x + w + t * 2.2, y + h, t * 0.8, { fill: on[7] === 1 ? color : 'off', noStroke: true }));
  return ops;
}

/* ---------- Catalogue ---------- */
export const CATS = [
  ['io-in', () => tl('Entrées'), 'toggle'],
  ['io-out', () => tl('Sorties'), 'bulb'],
  ['gates', () => tl('Portes logiques'), 'logic'],
  ['ff', () => tl('Bascules'), 'flipflop'],
  ['comb', () => tl('Combinatoire'), 'puzzle'],
  ['arith', () => tl('Arithmétique'), 'plus'],
  ['seq', () => tl('Séquentiel'), 'clock'],
  ['mem', () => tl('Mémoires'), 'box'],
  ['wire', () => tl('Câblage et notes'), 'cable']
];
/** Touches du clavier hexadécimal, ligne par ligne. */
const KEYS = '123A456B789CE0FD';
const KEY0 = 0.55, KEYW = 1.25; // coin et pas de la grille des touches
/** Touche sous un point (coordonnées locales du clavier), ou -1. */
export function keypadKey(x, y) {
  const c = Math.floor((x - KEY0) / KEYW), r = Math.floor((y - KEY0) / KEYW);
  return c >= 0 && c < 4 && r >= 0 && r < 4 ? parseInt(KEYS[r * 4 + c], 16) : -1;
}
/** Valeur affichée d'un nombre (afficheur de valeur, sonde de bus). */
export function fmtValue(v, n, mode = 'dec') {
  if (v == null) return 'X';
  if (mode === 'hex') return '0x' + v.toString(16).toUpperCase().padStart(Math.ceil(n / 4), '0');
  if (mode === 'bin') return v.toString(2).padStart(n, '0');
  if (mode === 'sdec' && v >> (n - 1)) return String(v - (1 << n));
  return String(v);
}
const freqTxt = v => String(v).replace('.', DEC) + ' Hz';
const LED_COLORS = { red: '#ff5257', green: '#4ade80', yellow: '#facc15', blue: '#60a5fa', white: '#f1f5f9' };
const LABEL = { k: 'label', label: () => tl('Repère'), type: 'text' };

export const DEFS = {
  /* ----- Entrées ----- */
  switch: {
    cat: 'io-in', kind: 'in', name: () => tl('Interrupteur'), full: () => tl('Interrupteur (entrée 0 ou 1)'), labelAt: 'l', auto: 'in',
    doc: () => tl('Entrée logique : cliquez dessus pour la faire passer de 0 à 1. Il garde sa position.'),
    props: [LABEL, { k: 'value', label: () => tl('Position'), type: 'enum', def: 0, opts: [[0, () => '0'], [1, () => '1']] }],
    layout: () => ({ w: 4, h: 2, pins: [pin('Q', 'out', 4, 1, 'r')] }),
    ev: (I, p) => ({ Q: p.value ? 1 : 0 }),
    sym(p, style, live) {
      const on = p.value ? 1 : 0;
      return [P([[0.3, 0.2], [3, 0.2], [3, 1.8], [0.3, 1.8]], { close: true, fill: 'body', r: 0.4 }),
        P([[0.8, 1], [2.5, 1]], { w: 0.55, color: on ? 'hi' : 'lo', cap: true }), C(on ? 2.4 : 0.9, 1, 0.42, { fill: on ? 'hi' : 'knob' }),
        P([[3, 1], [4, 1]]), T(on ? 1.05 : 2.25, 1.3, on, { s: 0.75, mono: true, color: 'mut' })];
    }
  },
  button: {
    cat: 'io-in', kind: 'in', name: () => tl('Bouton-poussoir'), full: () => tl('Bouton-poussoir (1 tant qu’il est appuyé)'), labelAt: 'l', auto: 'in',
    doc: () => tl('Entrée logique momentanée : vaut 1 tant que vous maintenez le clic dessus, 0 sinon.'),
    props: [LABEL],
    layout: () => ({ w: 4, h: 2, pins: [pin('Q', 'out', 4, 1, 'r')] }),
    ev: (I, p) => ({ Q: p.pressed ? 1 : 0 }),
    sym: p => [P([[0.3, 0.2], [3, 0.2], [3, 1.8], [0.3, 1.8]], { close: true, fill: 'body', r: 0.4 }), C(1.65, 1, 0.55, { fill: p.pressed ? 'hi' : 'knob' }), P([[3, 1], [4, 1]])]
  },
  clock: {
    cat: 'io-in', kind: 'in', clock: true, name: () => tl('Horloge'), full: () => tl('Horloge (signal carré)'), labelAt: 'l', auto: 'clk',
    doc: () => tl('Produit un signal carré : 0, 1, 0, 1… à la fréquence choisie, quand l’horloge est lancée (bouton ▶ sous le plan de travail). « Pas » avance d’un front.'),
    props: [LABEL, { k: 'freq', label: () => tl('Fréquence'), type: 'enum', def: 1, opts: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].map(v => [v, () => freqTxt(v)]) }],
    layout: () => ({ w: 4, h: 2, pins: [pin('Q', 'out', 4, 1, 'r')] }),
    ev: (I, p) => ({ Q: p.value ? 1 : 0 }),
    sym: p => [P([[0.3, 0.2], [3, 0.2], [3, 1.8], [0.3, 1.8]], { close: true, fill: 'body', r: 0.3 }),
      P([[0.7, 1.4], [1.2, 1.4], [1.2, 0.6], [1.7, 0.6], [1.7, 1.4], [2.2, 1.4], [2.2, 0.6], [2.6, 0.6]], { w: 0.14, color: p.value ? 'hi' : 'ink' }), P([[3, 1], [4, 1]])]
  },
  const: {
    cat: 'io-in', kind: 'const', name: () => tl('Niveau constant'), full: () => tl('Niveau logique constant (0 ou 1)'), labelAt: 'l',
    doc: () => tl('Un 1 ou un 0 permanent : pour forcer une entrée (par exemple une validation toujours active).'),
    props: [{ k: 'value', label: () => tl('Valeur'), type: 'enum', def: 1, opts: [[0, () => '0'], [1, () => '1']] }],
    layout: () => ({ w: 3, h: 2, pins: [pin('Q', 'out', 3, 1, 'r')] }),
    ev: (I, p) => ({ Q: p.value ? 1 : 0 }),
    sym: p => [P([[0.4, 0.3], [2, 0.3], [2, 1.7], [0.4, 1.7]], { close: true, fill: 'body' }), T(1.2, 1.33, p.value ? '1' : '0', { s: 0.95, b: true, mono: true }), P([[2, 1], [3, 1]])]
  },
  dip: {
    cat: 'io-in', kind: 'in', name: () => tl('Interrupteurs DIP'), full: () => tl('Bloc d’interrupteurs (un nombre binaire)'), labelAt: 't', auto: 'in',
    doc: () => tl('Plusieurs interrupteurs côte à côte : ils forment un nombre binaire. Le bit 0 (poids faible) est en haut. Cliquez sur un interrupteur pour le basculer.'),
    props: [LABEL, BITS(4, 2, 8), BUS],
    layout: p => {
      const n = p.bits || 4, names = range(n).map(String);
      return { w: 4, h: n + 1, pins: p.bus ? [pin('Q', 'out', 4, 1, 'r', { bus: names })] : names.map((s, i) => pin(s, 'out', 4, i + 1, 'r')) };
    },
    ev: (I, p) => { const o = {}, n = p.bits || 4, v = p.value || 0; for (let i = 0; i < n; i++) o[i] = (v >> i) & 1; return o; },
    sym(p) {
      const n = p.bits || 4, v = p.value || 0, ops = [P([[0.3, 0.3], [3, 0.3], [3, n + 0.7], [0.3, n + 0.7]], { close: true, fill: 'body' })];
      for (let i = 0; i < n; i++) {
        const on = (v >> i) & 1, y = i + 1;
        ops.push(P([[1.2, y], [2.6, y]], { w: 0.5, color: on ? 'hi' : 'lo', cap: true }), C(on ? 2.55 : 1.25, y, 0.3, { fill: on ? 'hi' : 'knob' }), T(0.7, y + 0.28, i, { s: 0.6, mono: true, color: 'mut' }));
        if (!p.bus) ops.push(P([[3, y], [4, y]]));
      }
      if (p.bus) ops.push(P([[3, 1], [4, 1]], { w: 0.3 }));
      return ops;
    }
  },
  numin: {
    cat: 'io-in', kind: 'in', name: () => tl('Entrée numérique'), full: () => tl('Entrée d’un nombre (n bits)'), labelAt: 't', auto: 'in',
    doc: () => tl('Donne un nombre binaire sur ses sorties (Q0 poids faible). Cliquez sur la moitié haute pour ajouter 1, sur la moitié basse pour retirer 1.'),
    props: [LABEL, BITS(4, 1, 8), BUS],
    layout(p) {
      const n = p.bits || 4, one = n === 1 || p.bus;
      return { w: 6, h: one ? 3 : n + 1, pins: one ? [pin('Q', 'out', 6, 1, 'r', n > 1 ? { bus: bitNames('Q', n) } : {})] : bitNames('Q', n).map((s, i) => pin(s, 'out', 6, i + 1, 'r')) };
    },
    ev: (I, p) => wr({}, 'Q', p.bits || 4, (p.value || 0) & ((1 << (p.bits || 4)) - 1)),
    sym(p) {
      const L = DEFS.numin.layout(p), { w, h } = L, n = p.bits || 4, v = (p.value || 0) & ((1 << n) - 1), cx = (1.6 + w - 1) / 2, cy = h / 2;
      const ops = [P([[0.3, 0.3], [w - 1, 0.3], [w - 1, h - 0.3], [0.3, h - 0.3]], { close: true, fill: 'body' }),
        P([[0.75, 1.15], [1.1, 0.7], [1.45, 1.15]], { w: 0.13 }), P([[0.75, h - 1.15], [1.1, h - 0.7], [1.45, h - 1.15]], { w: 0.13 }),
        T(cx, cy + 0.15, v, { s: 1.05, b: true, mono: true, color: 'hi' }), T(cx, cy + 0.85, fmtValue(v, n, 'hex'), { s: 0.5, mono: true, color: 'mut' })];
      for (const q of L.pins) ops.push(P([[w - 1, q.y], [w, q.y]], q.bus ? { w: 0.3 } : {}));
      return ops;
    }
  },
  keypad: {
    cat: 'io-in', kind: 'in', name: () => tl('Clavier hexadécimal'), full: () => tl('Clavier de 16 touches (0 à F)'), labelAt: 't',
    doc: () => tl('Cliquez sur une touche : D0 à D3 donnent son numéro en binaire (il reste affiché après), V vaut 1 tant que la touche est appuyée. Pour un digicode, une serrure, un menu…'),
    props: [LABEL, BUS],
    layout: p => ({ w: 7, h: 6, pins: [...(p.bus ? [pin('D', 'out', 7, 1, 'r', { bus: bitNames('D', 4) })] : bitNames('D', 4).map((s, i) => pin(s, 'out', 7, i + 1, 'r'))), pin('V', 'out', 7, 5, 'r')] }),
    ev: (I, p) => ({ ...wr({}, 'D', 4, (p.value || 0) & 15), V: p.pressed ? 1 : 0 }),
    sym(p) {
      const L = DEFS.keypad.layout(p), ops = [P([[0.3, 0.3], [5.8, 0.3], [5.8, 5.8], [0.3, 5.8]], { close: true, fill: 'body' })];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        const ch = KEYS[r * 4 + c], x = KEY0 + c * KEYW + 0.08, y = KEY0 + r * KEYW + 0.08, s = KEYW - 0.16, on = p.pressed && (p.value || 0) === parseInt(ch, 16);
        ops.push(P([[x, y], [x + s, y], [x + s, y + s], [x, y + s]], { close: true, fill: on ? 'hi' : 'off', w: 0.08 }), T(x + s / 2, y + s / 2 + 0.24, ch, { s: 0.62, b: true, mono: true, color: on ? 'body' : 'ink' }));
      }
      for (const q of L.pins) ops.push(P([[5.8, q.y], [7, q.y]], q.bus ? { w: 0.3 } : {}), T(6.7, q.y - 0.18, q.name, { s: 0.42, a: 'r', color: 'mut' }));
      return ops;
    }
  },
  /* ----- Sorties ----- */
  led: {
    cat: 'io-out', kind: 'out', name: () => tl('LED'), full: () => tl('LED témoin (allumée à 1)'), labelAt: 'r', auto: 'out',
    doc: () => tl('Sortie : la LED s’allume quand son entrée vaut 1. Rouge si l’entrée est inconnue (X) : elle n’est pas reliée ou deux sorties se contredisent.'),
    props: [LABEL, { k: 'color', label: () => tl('Couleur'), type: 'enum', def: 'red', opts: [['red', () => tl('Rouge')], ['green', () => tl('Verte')], ['yellow', () => tl('Jaune')], ['blue', () => tl('Bleue')], ['white', () => tl('Blanche')]] }],
    layout: () => ({ w: 3, h: 2, pins: [pin('A', 'in', 0, 1, 'l')] }),
    sym(p, style, live) {
      const v = live ? live.ins.A : null, col = LED_COLORS[p.color] || LED_COLORS.red;
      return [P([[0, 1], [1.05, 1]]), ...(v === 1 ? [C(1.9, 1, 1.05, { fill: col, alpha: 0.28, noStroke: true })] : []), C(1.9, 1, 0.82, { fill: v === 1 ? col : v === X ? 'x' : 'off' })];
    }
  },
  probe: {
    cat: 'io-out', kind: 'out', name: () => tl('Sonde'), full: () => tl('Sonde logique (affiche 0, 1, X ou Z)'), labelAt: 'r', auto: 'out',
    doc: () => tl('Affiche le niveau d’un fil : 0, 1, X (inconnu ou conflit) ou Z (non piloté).'),
    props: [LABEL],
    layout: () => ({ w: 3, h: 2, pins: [pin('A', 'in', 0, 1, 'l')] }),
    sym(p, style, live) { const v = live ? live.ins.A : Z; return [P([[0, 1], [0.9, 1]]), P([[0.9, 0.25], [2.7, 0.25], [2.7, 1.75], [0.9, 1.75]], { close: true, fill: 'body' }), T(1.8, 1.36, LEVEL_TXT[v ?? Z], { s: 1, b: true, mono: true, color: v === 1 ? 'hi' : v === X ? 'x' : v === Z ? 'z' : 'ink' })]; }
  },
  seg7: {
    cat: 'io-out', kind: 'out', name: () => tl('Afficheur 7 segments'), full: () => tl('Afficheur 7 segments (a à g, point)'), labelAt: 't',
    doc: () => tl('Chaque entrée allume un segment : a en haut, puis b, c… dans le sens des aiguilles d’une montre, g au milieu, dp le point.'),
    props: [LABEL, { k: 'color', label: () => tl('Couleur'), type: 'enum', def: 'red', opts: [['red', () => tl('Rouge')], ['green', () => tl('Verte')], ['yellow', () => tl('Jaune')], ['blue', () => tl('Bleue')]] }],
    layout: () => ({ w: 7, h: 9, pins: [...'abcdefg'.split('').map((s, i) => pin(s, 'in', 0, i + 1, 'l')), pin('dp', 'in', 0, 8, 'l', { opt: 0 })] }),
    sym(p, style, live) {
      const L = DEFS.seg7.layout(p), ops = boxSym(L, '', style), on = live ? 'abcdefg'.split('').concat('dp').map(s => live.ins[s]) : null;
      return ops.concat(digit(2.9, 1.6, 2.4, 5.6, on, LED_COLORS[p.color] || LED_COLORS.red));
    }
  },
  hex: {
    cat: 'io-out', kind: 'out', name: () => tl('Afficheur hexadécimal'), full: () => tl('Afficheur hexadécimal (nombre de 4 bits)'), labelAt: 't', auto: 'out',
    doc: () => tl('Affiche en chiffre (0 à 9, puis A à F) le nombre binaire reçu sur ses 4 entrées. D0 est le bit de poids faible.'),
    props: [LABEL, BUS],
    layout: p => ({ w: 6, h: 5, pins: p.bus ? [pin('D', 'in', 0, 1, 'l', { bus: bitNames('D', 4) })] : range(4).map(i => pin('D' + i, 'in', 0, i + 1, 'l')) }),
    sym(p, style, live) {
      const L = DEFS.hex.layout(p), ops = boxSym(L, '', style);
      const n = live ? word([0, 1, 2, 3].map(i => live.ins['D' + i])) : null, on = n == null ? null : range(7).map(i => (SEG7[n] >> i) & 1);
      return ops.concat(digit(2.7, 0.8, 1.7, 3.4, on, LED_COLORS.red));
    }
  },
  numout: {
    cat: 'io-out', kind: 'out', name: () => tl('Afficheur de valeur'), full: () => tl('Afficheur d’un nombre (décimal, hexadécimal, binaire)'), labelAt: 't', auto: 'out',
    doc: () => tl('Affiche le nombre reçu sur ses entrées (A0 poids faible), en décimal, en décimal signé (complément à 2), en hexadécimal ou en binaire. Pratique au bout d’un bus.'),
    props: [LABEL, BITS(4, 1, 8), { k: 'mode', label: () => tl('Format d’affichage'), type: 'enum', def: 'dec', opts: [['dec', () => tl('Décimal')], ['sdec', () => tl('Signé')], ['hex', () => tl('Hexa')], ['bin', () => tl('Binaire')]] }, BUS],
    layout(p) {
      const n = p.bits || 4, one = n === 1 || p.bus;
      return { w: 7, h: one ? 3 : n + 1, pins: one ? [pin('A', 'in', 0, 1, 'l', n > 1 ? { bus: bitNames('A', n) } : {})] : bitNames('A', n).map((s, i) => pin(s, 'in', 0, i + 1, 'l')) };
    },
    sym(p, style, live) {
      const L = DEFS.numout.layout(p), { w, h } = L, n = p.bits || 4, v = live ? rd(live.ins, 'A', n) : null;
      const ops = [P([[1, 0.3], [w - 0.3, 0.3], [w - 0.3, h - 0.3], [1, h - 0.3]], { close: true, fill: 'body' })];
      const txt = live ? fmtValue(v, n, p.mode) : '—';
      ops.push(T((1 + w - 0.3) / 2, h / 2 + 0.38, txt, { s: txt.length > 6 ? 0.75 : 1.05, b: true, mono: true, color: live && v == null ? 'x' : 'hi' }));
      for (const q of L.pins) ops.push(P([[0, q.y], [1, q.y]], q.bus ? { w: 0.3 } : {}));
      return ops;
    }
  },
  bar: {
    cat: 'io-out', kind: 'out', name: () => tl('Bargraphe'), full: () => tl('Rangée de LED (bargraphe)'), labelAt: 't', auto: 'out',
    doc: () => tl('Une LED par entrée (A0 en haut), allumée à 1. Pour voir d’un coup un nombre, un registre ou un chenillard.'),
    props: [LABEL, BITS(5, 2, 8, () => tl('Nombre de LED')), { k: 'color', label: () => tl('Couleur'), type: 'enum', def: 'red', opts: [['red', () => tl('Rouge')], ['green', () => tl('Verte')], ['yellow', () => tl('Jaune')], ['blue', () => tl('Bleue')]] }, BUS],
    layout: p => { const n = p.bits || 5, names = bitNames('A', n); return { w: 4, h: n + 1, pins: p.bus ? [pin('A', 'in', 0, 1, 'l', { bus: names })] : names.map((s, i) => pin(s, 'in', 0, i + 1, 'l')) }; },
    sym(p, style, live) {
      const n = p.bits || 5, col = LED_COLORS[p.color] || LED_COLORS.red, ops = [P([[0.9, 0.3], [3.7, 0.3], [3.7, n + 0.7], [0.9, n + 0.7]], { close: true, fill: 'body' })];
      for (let i = 0; i < n; i++) {
        const v = live ? live.ins['A' + i] : null, y = i + 1;
        ops.push(P([[1.3, y - 0.32], [3.3, y - 0.32], [3.3, y + 0.32], [1.3, y + 0.32]], { close: true, fill: v === 1 ? col : v === X ? 'x' : 'off', w: 0.06 }));
        if (!p.bus) ops.push(P([[0, y], [0.9, y]]));
      }
      if (p.bus) ops.push(P([[0, 1], [0.9, 1]], { w: 0.3 }));
      return ops;
    }
  },
  buzzer: {
    cat: 'io-out', kind: 'out', name: () => tl('Buzzer'), full: () => tl('Buzzer (sonne à 1)'), labelAt: 'r', auto: 'out',
    doc: () => tl('Sortie sonore : le buzzer sonne tant que son entrée vaut 1 (alarme, sonnette, fin de minuterie). Le son peut être coupé dans ses propriétés.'),
    props: [LABEL, { k: 'tone', label: () => tl('Son'), type: 'enum', def: 880, opts: [[440, () => tl('Grave')], [880, () => tl('Moyen')], [1760, () => tl('Aigu')]] }, { k: 'sound', label: () => tl('Haut-parleur'), type: 'enum', def: 1, opts: [[1, () => tl('Activé')], [0, () => tl('Coupé')]] }],
    layout: () => ({ w: 3, h: 2, pins: [pin('A', 'in', 0, 1, 'l')] }),
    sym(p, style, live) {
      const on = live && live.ins.A === 1, ops = [P([[0, 1], [0.8, 1]]), P([[0.8, 0.65], [1.25, 0.65], [1.9, 0.2], [1.9, 1.8], [1.25, 1.35], [0.8, 1.35]], { close: true, fill: on ? 'hi' : 'body' })];
      if (on) ops.push(P(arc(1.9, 1, 0.45, 0.45, -0.9, 0.9, 8), { color: 'hi', w: 0.12 }), P(arc(1.9, 1, 0.85, 0.85, -0.9, 0.9, 10), { color: 'hi', w: 0.12 }));
      if (!p.sound) ops.push(P([[2.2, 0.55], [2.9, 1.45]], { color: 'mut', w: 0.1 }), P([[2.9, 0.55], [2.2, 1.45]], { color: 'mut', w: 0.1 }));
      return ops;
    }
  },
  /* ----- Portes ----- */
  buf: gateDef('buf', () => tl('OUI'), () => tl('Porte OUI (tampon)'), () => tl('Recopie son entrée : Y = A. Sert à renforcer ou retarder un signal.')),
  not: gateDef('not', () => tl('NON'), () => tl('Porte NON (inverseur)'), () => tl('Inverse son entrée : Y = Ā. 0 donne 1, 1 donne 0.')),
  and: gateDef('and', () => tl('ET'), () => tl('Porte ET (AND)'), () => tl('Y = 1 seulement si toutes les entrées valent 1.')),
  or: gateDef('or', () => tl('OU'), () => tl('Porte OU (OR)'), () => tl('Y = 1 dès qu’au moins une entrée vaut 1.')),
  nand: gateDef('nand', () => tl('NON-ET'), () => tl('Porte NON-ET (NAND)'), () => tl('Contraire du ET : Y = 0 seulement si toutes les entrées valent 1. Avec elle seule, on construit toutes les autres portes.')),
  nor: gateDef('nor', () => tl('NON-OU'), () => tl('Porte NON-OU (NOR)'), () => tl('Contraire du OU : Y = 1 seulement si toutes les entrées valent 0.')),
  xor: gateDef('xor', () => tl('OU exclusif'), () => tl('Porte OU exclusif (XOR)'), () => tl('Y = 1 si les entrées sont différentes (avec plus de deux entrées : si le nombre de 1 est impair).')),
  xnor: gateDef('xnor', () => tl('NON-OU exclusif'), () => tl('Porte NON-OU exclusif (XNOR)'), () => tl('Y = 1 si les entrées sont égales : c’est un comparateur d’égalité.')),
  tri: {
    cat: 'gates', kind: 'gate', name: () => tl('Tampon 3 états'), full: () => tl('Tampon trois états'), doc: () => tl('Recopie A quand EN vaut 1 ; sinon la sortie est déconnectée (Z), ce qui permet à plusieurs sorties de partager un même fil (un bus).'),
    props: [],
    layout: () => ({ w: 4, h: 3, pins: [pin('A', 'in', 0, 2, 'l'), pin('EN', 'in', 2, 0, 't'), pin('Y', 'out', 4, 2, 'r')] }),
    ev: I => ({ Y: I.EN === 1 ? (isB(I.A) ? I.A : X) : I.EN === 0 ? Z : X }),
    sym: (p, style) => style === 'iec'
      ? [P([[1, 1], [3, 1], [3, 3], [1, 3]], { close: true, fill: 'body' }), T(2, 2.35, '1▽', { s: 0.75, b: true }), P([[0, 2], [1, 2]]), P([[2, 0], [2, 1]]), P([[3, 2], [4, 2]])]
      : [P([[1, 1], [3, 2], [1, 3]], { close: true, fill: 'body' }), P([[0, 2], [1, 2]]), P([[2, 0], [2, 1.5]]), P([[3, 2], [4, 2]])]
  },
  /* ----- Bascules ----- */
  srlatch: {
    cat: 'ff', kind: 'ff', seq: true, name: () => tl('Verrou RS'), full: () => tl('Bascule RS asynchrone (verrou)'),
    doc: () => tl('Mémoire d’un bit. S = 1 met Q à 1, R = 1 met Q à 0, S = R = 0 garde l’état. S = R = 1 est interdit (les deux sorties passent à 0).'),
    props: [],
    layout: () => ({ w: 6, h: 4, pins: [pin('S', 'in', 0, 1, 'l'), pin('R', 'in', 0, 3, 'l'), pin('Q', 'out', 6, 1, 'r'), pin('QN', 'out', 6, 3, 'r', { label: 'Q', ov: true })] }),
    init: () => ({ q: 0 }),
    ev(I, p, st) {
      if (I.S === 1 && I.R === 1) { st.q = 0; return { Q: 0, QN: 0 }; }
      if (I.S === 1) st.q = 1; else if (I.R === 1) st.q = 0; else if (!isB(I.S) || !isB(I.R)) st.q = X;
      return qOut(st.q);
    },
    sym: (p, style) => boxSym(DEFS.srlatch.layout(p), '', style)
  },
  dlatch: {
    cat: 'ff', kind: 'ff', seq: true, name: () => tl('Verrou D'), full: () => tl('Verrou D (transparent quand EN = 1)'),
    doc: () => tl('Tant que EN vaut 1, Q recopie D (le verrou est « transparent ») ; quand EN passe à 0, Q garde la dernière valeur.'),
    props: [],
    layout: () => ({ w: 6, h: 4, pins: [pin('D', 'in', 0, 1, 'l'), pin('EN', 'in', 0, 3, 'l'), pin('Q', 'out', 6, 1, 'r'), pin('QN', 'out', 6, 3, 'r', { label: 'Q', ov: true })] }),
    init: () => ({ q: 0 }),
    ev(I, p, st) { if (I.EN === 1) st.q = isB(I.D) ? I.D : X; else if (!isB(I.EN)) st.q = X; return qOut(st.q); },
    sym: (p, style) => boxSym(DEFS.dlatch.layout(p), '', style)
  },
  dff: ffDef('dff', ['D', 'CLK'], () => tl('Bascule D'), () => tl('Bascule D (sur front d’horloge)'),
    () => tl('Au front actif de l’horloge, Q prend la valeur de D, puis la garde jusqu’au front suivant. PR et CLR (facultatives) forcent Q à 1 ou à 0 immédiatement.'),
    I => nextVal(I.D, I.D)),
  jkff: ffDef('jkff', ['J', 'CLK', 'K'], () => tl('Bascule JK'), () => tl('Bascule JK (sur front d’horloge)'),
    () => tl('Au front actif : J = K = 0 garde l’état, J = 1 met Q à 1, K = 1 met Q à 0, J = K = 1 inverse Q (basculement).'),
    (I, q) => (!isB(I.J) || !isB(I.K) ? X : I.J && I.K ? NOT(q) : I.J ? 1 : I.K ? 0 : q)),
  tff: ffDef('tff', ['T', 'CLK'], () => tl('Bascule T'), () => tl('Bascule T (sur front d’horloge)'),
    () => tl('Au front actif, Q s’inverse si T vaut 1 et reste tel quel si T vaut 0. Avec T = 1, elle divise la fréquence par deux.'),
    (I, q) => (!isB(I.T) ? X : I.T ? NOT(q) : q)),
  srff: ffDef('srff', ['S', 'CLK', 'R'], () => tl('Bascule RS synchrone'), () => tl('Bascule RS synchrone (sur front d’horloge)'),
    () => tl('Comme le verrou RS, mais S et R ne sont lus qu’au front actif de l’horloge. S = R = 1 est interdit.'),
    (I, q) => (!isB(I.S) || !isB(I.R) ? X : I.S && I.R ? X : I.S ? 1 : I.R ? 0 : q)),
  /* ----- Combinatoire ----- */
  mux: {
    cat: 'comb', kind: 'msi', name: () => tl('Multiplexeur'), full: () => tl('Multiplexeur (aiguillage de 2, 4 ou 8 entrées vers une sortie)'),
    doc: () => tl('Recopie sur Y l’entrée I choisie par le nombre binaire S (S0 poids faible). Avec 2 entrées : Y = I0 si S = 0, Y = I1 si S = 1.'),
    props: [{ k: 'sel', label: () => tl('Entrées'), type: 'enum', def: 1, opts: [[1, () => '2'], [2, () => '4'], [3, () => '8']] }],
    layout(p) {
      const s = +p.sel || 1, k = 1 << s, ys = k === 2 ? [1, 3] : range(k).map(i => i + 1), bodyH = k === 2 ? 4 : k + 2, w = s + 4;
      return { w, h: bodyH + 1, pins: [...ys.map((y, i) => pin('I' + i, 'in', 0, y, 'l')), ...range(s).map(i => pin('S' + i, 'in', w - 2 - i, bodyH + 1, 'b')), pin('Y', 'out', w, bodyH / 2, 'r')] };
    },
    ev(I, p) { const s = +p.sel || 1, n = word(range(s).map(i => I['S' + i])); if (n == null) return { Y: X }; const v = I['I' + n]; return { Y: isB(v) ? v : X }; },
    sym(p, style) { const L = DEFS.mux.layout(p), bodyH = L.h - 1, w = L.w; return boxSym(L, 'MUX', style, { trap: 0.8, trapB: x => 0.8 * (x - 1) / (w - 2), titleY: 1.6 }); }
  },
  demux: {
    cat: 'comb', kind: 'msi', name: () => tl('Démultiplexeur'), full: () => tl('Démultiplexeur (une entrée vers 2, 4 ou 8 sorties)'),
    doc: () => tl('Envoie l’entrée D sur la sortie Y choisie par S ; les autres sorties restent à 0.'),
    props: [{ k: 'sel', label: () => tl('Sorties'), type: 'enum', def: 1, opts: [[1, () => '2'], [2, () => '4'], [3, () => '8']] }],
    layout(p) {
      const s = +p.sel || 1, k = 1 << s, ys = k === 2 ? [1, 3] : range(k).map(i => i + 1), bodyH = k === 2 ? 4 : k + 2, w = s + 4;
      return { w, h: bodyH + 1, pins: [pin('D', 'in', 0, bodyH / 2, 'l'), ...range(s).map(i => pin('S' + i, 'in', w - 2 - i, bodyH + 1, 'b')), ...ys.map((y, i) => pin('Y' + i, 'out', w, y, 'r'))] };
    },
    ev(I, p) { const s = +p.sel || 1, k = 1 << s, n = word(range(s).map(i => I['S' + i])), o = {}; for (let i = 0; i < k; i++) o['Y' + i] = n == null ? X : i === n ? (isB(I.D) ? I.D : X) : 0; return o; },
    sym(p, style) { const L = DEFS.demux.layout(p), w = L.w; return boxSym(L, 'DEMUX', style, { trapR: 0.8, trapB: x => 0.8 * (w - 1 - x) / (w - 2), titleY: 1.6 }); }
  },
  decoder: {
    cat: 'comb', kind: 'msi', name: () => tl('Décodeur'), full: () => tl('Décodeur binaire (2 vers 4, 3 vers 8)'),
    doc: () => tl('Active (met à 1) la seule sortie Y dont le numéro est le nombre binaire reçu sur A. EN (facultative) doit valoir 1.'),
    props: [{ k: 'n', label: () => tl('Entrées'), type: 'enum', def: 2, opts: [[1, () => '1 → 2'], [2, () => '2 → 4'], [3, () => '3 → 8']] }],
    layout(p) {
      const n = +p.n || 2, k = 1 << n, bodyH = Math.max(k, n + 1) + 1, w = 6;
      return { w, h: bodyH + 1, pins: [...range(n).map(i => pin('A' + i, 'in', 0, i + 1, 'l')), pin('EN', 'in', 3, bodyH + 1, 'b', { opt: 1 }), ...range(k).map(i => pin('Y' + i, 'out', w, i + 1, 'r'))] };
    },
    ev(I, p) { const n = +p.n || 2, k = 1 << n, a = word(range(n).map(i => I['A' + i])), o = {}; for (let i = 0; i < k; i++) o['Y' + i] = I.EN === 0 ? 0 : a == null || I.EN !== 1 ? X : +(i === a); return o; },
    sym: (p, style) => boxSym(DEFS.decoder.layout(p), 'DEC', style, { titleY: -0.35 })
  },
  encoder: {
    cat: 'comb', kind: 'msi', name: () => tl('Encodeur de priorité'), full: () => tl('Encodeur de priorité (4 vers 2, 8 vers 3)'),
    doc: () => tl('Donne en binaire sur A le numéro de l’entrée I active la plus haute. V vaut 1 si au moins une entrée est active.'),
    props: [{ k: 'n', label: () => tl('Entrées'), type: 'enum', def: 2, opts: [[2, () => '4 → 2'], [3, () => '8 → 3']] }],
    layout(p) {
      const n = +p.n || 2, k = 1 << n, w = 6;
      return { w, h: k + 1, pins: [...range(k).map(i => pin('I' + i, 'in', 0, i + 1, 'l')), ...range(n).map(i => pin('A' + i, 'out', w, i + 1, 'r')), pin('V', 'out', w, n + 2, 'r')] };
    },
    ev(I, p) {
      const n = +p.n || 2, k = 1 << n, o = {};
      let hi = -1, x = false;
      for (let i = k - 1; i >= 0; i--) { const v = I['I' + i]; if (v === 1) { hi = i; break; } if (!isB(v)) x = true; }
      for (let i = 0; i < n; i++) o['A' + i] = hi < 0 ? (x ? X : 0) : (hi >> i) & 1;
      o.V = hi >= 0 ? 1 : x ? X : 0; return o;
    },
    sym: (p, style) => boxSym(DEFS.encoder.layout(p), 'ENC', style, { titleY: -0.35 })
  },
  ha: {
    cat: 'arith', kind: 'msi', name: () => tl('Demi-additionneur'), full: () => tl('Demi-additionneur (A + B)'),
    doc: () => tl('Additionne deux bits : S est la somme (A ⊕ B), C la retenue (A · B).'),
    props: [],
    layout: () => ({ w: 6, h: 4, pins: [pin('A', 'in', 0, 1, 'l'), pin('B', 'in', 0, 3, 'l'), pin('S', 'out', 6, 1, 'r'), pin('C', 'out', 6, 3, 'r')] }),
    ev: I => ({ S: XOR([I.A, I.B]), C: AND([I.A, I.B]) }),
    sym: (p, style) => boxSym(DEFS.ha.layout(p), 'Σ', style, { titleY: 2.35 })
  },
  fa: {
    cat: 'arith', kind: 'msi', name: () => tl('Additionneur complet'), full: () => tl('Additionneur complet (A + B + retenue)'),
    doc: () => tl('Additionne trois bits : A, B et la retenue entrante Ci. S est la somme, Co la retenue sortante. En chaîne, ils additionnent des nombres de plusieurs bits.'),
    props: [],
    layout: () => ({ w: 6, h: 4, pins: [pin('A', 'in', 0, 1, 'l'), pin('B', 'in', 0, 2, 'l'), pin('Ci', 'in', 0, 3, 'l'), pin('S', 'out', 6, 1, 'r'), pin('Co', 'out', 6, 3, 'r')] }),
    ev(I) { const a = [I.A, I.B, I.Ci]; if (!a.every(isB)) return { S: X, Co: X }; const s = I.A + I.B + I.Ci; return { S: s & 1, Co: s >> 1 }; },
    sym: (p, style) => boxSym(DEFS.fa.layout(p), 'Σ', style, { titleY: 2.35 })
  },
  adder: {
    cat: 'arith', kind: 'msi', name: () => tl('Additionneur n bits'), full: () => tl('Additionneur de deux nombres de n bits'),
    doc: () => tl('Additionne les nombres A et B (bit 0 en haut) et la retenue Ci (facultative) : S = A + B + Ci, Co est la retenue finale.'),
    props: [BITS(4, 2, 8), BUS],
    layout(p) {
      const n = p.bits || 4, bus = !!p.bus;
      return boxLayout({ w: 7, left: [{ name: 'A', dir: 'in', n, bus }, { name: 'B', dir: 'in', n, bus }, { name: 'Ci', dir: 'in', opt: 0 }], right: [{ name: 'S', dir: 'out', n, bus }, { name: 'Co', dir: 'out' }] });
    },
    ev(I, p) {
      const n = p.bits || 4, a = rd(I, 'A', n), b = rd(I, 'B', n), c = isB(I.Ci) ? I.Ci : null, o = {};
      const s = a == null || b == null || c == null ? null : a + b + c;
      wr(o, 'S', n, s); o.Co = s == null ? X : (s >> n) & 1; return o;
    },
    sym: (p, style) => boxSym(DEFS.adder.layout(p), 'Σ', style, { titleY: -0.35 })
  },
  sub: {
    cat: 'arith', kind: 'msi', name: () => tl('Soustracteur'), full: () => tl('Soustracteur de deux nombres (A − B)'),
    doc: () => tl('Calcule D = A − B − Bi (Bi : emprunt entrant, facultatif). Bo vaut 1 quand le résultat est négatif : il faut emprunter au rang suivant. Avec 1 bit, c’est un soustracteur complet.'),
    props: [BITS(4, 1, 8), BUS],
    layout(p) {
      const n = p.bits || 4, bus = !!p.bus;
      return boxLayout({ w: 7, left: [{ name: 'A', dir: 'in', n, bus }, { name: 'B', dir: 'in', n, bus }, { name: 'Bi', dir: 'in', opt: 0 }], right: [{ name: 'D', dir: 'out', n, bus }, { name: 'Bo', dir: 'out' }], minH: 4 });
    },
    ev(I, p) {
      const n = p.bits || 4, a = rd(I, 'A', n), b = rd(I, 'B', n), c = isB(I.Bi) ? I.Bi : null, o = {};
      const s = a == null || b == null || c == null ? null : a - b - c;
      wr(o, 'D', n, s == null ? null : (s + (2 << n)) & ((1 << n) - 1)); o.Bo = s == null ? X : +(s < 0); return o;
    },
    sym: (p, style) => boxSym(DEFS.sub.layout(p), 'A−B', style, { titleY: -0.35 })
  },
  mul: {
    cat: 'arith', kind: 'msi', name: () => tl('Multiplieur'), full: () => tl('Multiplieur de deux nombres (A × B)'),
    doc: () => tl('Calcule le produit P = A × B. Avec deux nombres de n bits, le produit a 2n bits.'),
    props: [BITS(2, 1, 4), BUS],
    layout(p) {
      const n = p.bits || 2, bus = !!p.bus;
      return boxLayout({ w: 7, left: [{ name: 'A', dir: 'in', n, bus }, { name: 'B', dir: 'in', n, bus }], right: [{ name: 'P', dir: 'out', n: 2 * n, bus, indexed: true }], minH: 4 });
    },
    ev(I, p) { const n = p.bits || 2, a = rd(I, 'A', n), b = rd(I, 'B', n); return wr({}, 'P', 2 * n, a == null || b == null ? null : a * b, true); },
    sym: (p, style) => boxSym(DEFS.mul.layout(p), 'A×B', style, { titleY: -0.35 })
  },
  alu: {
    cat: 'arith', kind: 'msi', name: () => tl('UAL'), full: () => tl('Unité arithmétique et logique (UAL)'),
    doc: () => tl('Le code S2 S1 S0 choisit l’opération sur A et B : 0 A + B + Ci, 1 A − B − Ci, 2 A ET B, 3 A OU B, 4 A OU exclusif B, 5 NON A, 6 A + 1, 7 A − 1. Co : retenue (ou emprunt), Z vaut 1 si le résultat F est nul.'),
    props: [BITS(4, 1, 8), BUS],
    layout(p) {
      const n = p.bits || 4, bus = !!p.bus, w = 8;
      return boxLayout({ w, left: [{ name: 'A', dir: 'in', n, bus }, { name: 'B', dir: 'in', n, bus }, { name: 'Ci', dir: 'in', opt: 0 }], right: [{ name: 'F', dir: 'out', n, bus }, { name: 'Co', dir: 'out' }, { name: 'Z', dir: 'out' }], bottom: [0, 1, 2].map(i => ({ name: 'S' + i, dir: 'in', x: w - 2 - i })), minH: 4 });
    },
    ev(I, p) {
      const n = p.bits || 4, M = (1 << n) - 1, a = rd(I, 'A', n), b = rd(I, 'B', n), c = isB(I.Ci) ? I.Ci : null, op = word([I.S0, I.S1, I.S2]), o = {};
      if (a == null || b == null || c == null || op == null) { wr(o, 'F', n, null); o.Co = X; o.Z = X; return o; }
      let f = 0, co = 0;
      if (op === 0) { const s = a + b + c; f = s & M; co = (s >> n) & 1; }
      else if (op === 1) { const s = a - b - c; f = (s + (2 << n)) & M; co = +(s < 0); }
      else if (op === 2) f = a & b; else if (op === 3) f = a | b; else if (op === 4) f = a ^ b; else if (op === 5) f = ~a & M;
      else if (op === 6) { f = (a + 1) & M; co = +(a === M); } else { f = (a - 1 + (1 << n)) & M; co = +(a === 0); }
      wr(o, 'F', n, f); o.Co = co; o.Z = +(f === 0); return o;
    },
    sym: (p, style) => boxSym(DEFS.alu.layout(p), tl('UAL'), style, { titleY: -0.35 })
  },
  cmp: {
    cat: 'arith', kind: 'msi', name: () => tl('Comparateur'), full: () => tl('Comparateur de deux nombres'),
    doc: () => tl('Compare A et B : une seule des sorties vaut 1, A>B, A=B ou A<B.'),
    props: [BITS(1, 1, 8), BUS],
    layout(p) {
      const n = p.bits || 1, bus = !!p.bus;
      return boxLayout({ w: 7, left: [{ name: 'A', dir: 'in', n, bus }, { name: 'B', dir: 'in', n, bus, gap: n === 1 || bus ? 1 : 0 }], right: [{ name: 'GT', dir: 'out', label: 'A>B' }, { name: 'EQ', dir: 'out', label: 'A=B' }, { name: 'LT', dir: 'out', label: 'A<B' }], minH: 4 });
    },
    ev(I, p) {
      const n = p.bits || 1, a = rd(I, 'A', n), b = rd(I, 'B', n);
      if (a == null || b == null) return { GT: X, EQ: X, LT: X };
      return { GT: +(a > b), EQ: +(a === b), LT: +(a < b) };
    },
    sym: (p, style) => boxSym(DEFS.cmp.layout(p), '', style)
  },
  bcd7: {
    cat: 'comb', kind: 'msi', name: () => tl('Décodeur 7 segments'), full: () => tl('Décodeur binaire → 7 segments'),
    doc: () => tl('Transforme un nombre de 4 bits (D0 poids faible) en segments a à g pour un afficheur. En mode BCD, l’afficheur s’éteint au-delà de 9.'),
    props: [{ k: 'mode', label: () => tl('Chiffres'), type: 'enum', def: 'hex', opts: [['hex', () => tl('0 à F (hexadécimal)')], ['bcd', () => tl('0 à 9 (BCD)')]] }],
    layout: () => ({ w: 6, h: 8, pins: [...range(4).map(i => pin('D' + i, 'in', 0, i + 1, 'l')), ...'abcdefg'.split('').map((s, i) => pin(s, 'out', 6, i + 1, 'r'))] }),
    ev(I, p) {
      const n = word(range(4).map(i => I['D' + i])), o = {};
      const bits = n == null ? null : p.mode === 'bcd' && n > 9 ? 0 : SEG7[n];
      'abcdefg'.split('').forEach((s, i) => (o[s] = bits == null ? X : (bits >> i) & 1));
      return o;
    },
    sym: (p, style) => boxSym(DEFS.bcd7.layout(p), '', style)
  },
  /* ----- Séquentiel ----- */
  counter: {
    cat: 'seq', kind: 'msi', seq: true, name: () => tl('Compteur'), full: () => tl('Compteur binaire synchrone'),
    doc: () => tl('À chaque front d’horloge (si EN vaut 1), Q augmente de 1 (ou diminue en mode décompteur) et revient à 0 après le modulo. R remet à 0 tout de suite. TC vaut 1 sur la dernière valeur avant le retour. Options : sens choisi par l’entrée U/D (1 : compte, 0 : décompte), chargement parallèle (LD = 1 au front : Q prend D).'),
    props: [BITS(4, 1, 8), { k: 'mod', label: () => tl('Modulo (0 : 2ⁿ)'), type: 'int', min: 0, max: 256, def: 0 }, { k: 'down', label: () => tl('Sens'), type: 'enum', def: 0, opts: [[0, () => tl('Compteur')], [1, () => tl('Décompteur')], [2, () => tl('Entrée U/D')]] }, YESNO('load', () => tl('Chargement parallèle')), EDGE, BUS],
    layout(p) {
      const n = p.bits || 4, bus = !!p.bus;
      return boxLayout({ w: 7, minH: 4,
        left: [{ name: 'CLK', dir: 'in', clk: true, label: '' }, { name: 'EN', dir: 'in', opt: 1 }, { name: 'R', dir: 'in', opt: 0 }, p.down === 2 && { name: 'UD', dir: 'in', opt: 1, label: 'U/D' }, p.load && { name: 'LD', dir: 'in', opt: 0 }, p.load && { name: 'D', dir: 'in', n, bus, indexed: true }],
        right: [{ name: 'Q', dir: 'out', n, bus, indexed: true }, { name: 'TC', dir: 'out' }] });
    },
    init: () => ({ n: 0, clk: null }),
    ev(I, p, st) {
      const bits = p.bits || 4, m = p.mod > 0 ? Math.min(p.mod, 1 << bits) : 1 << bits, e = edge(st, I.CLK, p), o = {};
      const up = p.down === 2 ? I.UD : p.down ? 0 : 1;
      if (I.R === 1) st.n = 0;
      else if (!isB(I.R)) st.n = null;
      else if (e) {
        if (p.load && I.LD === 1) st.n = rd(I, 'D', bits, true);
        else if (p.load && !isB(I.LD)) st.n = null;
        else if (st.n != null) { if (I.EN === 1) st.n = !isB(up) ? null : up ? (st.n + 1) % m : (st.n + m - 1) % m; else if (!isB(I.EN)) st.n = null; }
      }
      wr(o, 'Q', bits, st.n, true);
      o.TC = st.n == null || !isB(up) ? X : +(I.EN !== 0 && st.n === (up ? m - 1 : 0)); return o;
    },
    sym(p, style) { const L = DEFS.counter.layout(p), ops = boxSym(L, p.down === 1 ? 'CTR ↓' : p.down === 2 ? 'CTR ↕' : 'CTR', style, { titleY: -0.35 }); if (p.edge === 'fall') ops.push(clkBubble(L)); return ops; }
  },
  shift: {
    cat: 'seq', kind: 'msi', seq: true, name: () => tl('Registre à décalage'), full: () => tl('Registre à décalage (entrée série, sorties parallèles)'),
    doc: () => tl('À chaque front d’horloge, chaque bit avance d’un cran : Q0 prend DIN, Q1 prend l’ancien Q0, etc. R remet tout à 0. Options : décalage dans l’autre sens (DIN entre par le dernier bit, les bits vont vers Q0), sens choisi par l’entrée DIR (0 : vers le dernier bit, DIN entre en Q0 ; 1 : vers Q0, DL entre par le dernier bit), chargement parallèle (LD = 1 au front : Q prend D).'),
    props: [BITS(4, 2, 8), { k: 'dir', label: () => tl('Sens du décalage'), type: 'enum', def: 'r', opts: [['r', () => tl('Q0 → Qn')], ['l', () => tl('Qn → Q0')], ['pin', () => tl('Entrée DIR')]] }, YESNO('load', () => tl('Chargement parallèle')), EDGE, BUS],
    layout(p) {
      const n = p.bits || 4, bus = !!p.bus, pinDir = p.dir === 'pin';
      return boxLayout({ w: 7, minH: 4,
        left: [{ name: 'DIN', dir: 'in' }, { name: 'CLK', dir: 'in', clk: true, label: '' }, { name: 'R', dir: 'in', opt: 0 }, pinDir && { name: 'DL', dir: 'in', opt: 0 }, pinDir && { name: 'DIR', dir: 'in', opt: 0 }, p.load && { name: 'LD', dir: 'in', opt: 0 }, p.load && { name: 'D', dir: 'in', n, bus, indexed: true }],
        right: [{ name: 'Q', dir: 'out', n, bus, indexed: true }] });
    },
    init: p => ({ q: range(p.bits || 4).map(() => 0), clk: null }),
    ev(I, p, st) {
      const n = p.bits || 4, e = edge(st, I.CLK, p), bit = v => (isB(v) ? v : X);
      if (!st.q || st.q.length !== n) st.q = range(n).map(() => 0);
      if (I.R === 1) st.q = st.q.map(() => 0);
      else if (e) {
        const left = p.dir === 'l' ? 1 : p.dir === 'pin' ? I.DIR : 0;
        if (p.load && I.LD === 1) st.q = range(n).map(i => bit(I['D' + i]));
        else if ((p.load && !isB(I.LD)) || !isB(left)) st.q = st.q.map(() => X);
        else if (!left) st.q = [bit(I.DIN), ...st.q.slice(0, -1)];
        else st.q = [...st.q.slice(1), bit(p.dir === 'pin' ? I.DL : I.DIN)];
      }
      const o = {}; st.q.forEach((v, i) => (o['Q' + i] = v)); return o;
    },
    sym(p, style) { const L = DEFS.shift.layout(p), ops = boxSym(L, p.dir === 'l' ? 'SRG ←' : p.dir === 'pin' ? 'SRG ↔' : 'SRG', style, { titleY: -0.35 }); if (p.edge === 'fall') ops.push(clkBubble(L)); return ops; }
  },
  register: {
    cat: 'seq', kind: 'msi', seq: true, name: () => tl('Registre'), full: () => tl('Registre n bits (chargement parallèle)'),
    doc: () => tl('Mémorise un nombre : au front d’horloge, si EN vaut 1 (facultative), Q prend la valeur de D. R remet à 0.'),
    props: [BITS(4, 1, 8), EDGE, BUS],
    layout(p) {
      const n = p.bits || 4, bus = !!p.bus;
      return boxLayout({ w: 7, left: [{ name: 'D', dir: 'in', n, bus, indexed: true }, { name: 'CLK', dir: 'in', clk: true, label: '' }, { name: 'EN', dir: 'in', opt: 1 }, { name: 'R', dir: 'in', opt: 0 }], right: [{ name: 'Q', dir: 'out', n, bus, indexed: true }] });
    },
    init: p => ({ q: range(p.bits || 4).map(() => 0), clk: null }),
    ev(I, p, st) {
      const n = p.bits || 4, e = edge(st, I.CLK, p);
      if (!st.q || st.q.length !== n) st.q = range(n).map(() => 0);
      if (I.R === 1) st.q = st.q.map(() => 0);
      else if (e && I.EN === 1) st.q = range(n).map(i => (isB(I['D' + i]) ? I['D' + i] : X));
      else if (e && !isB(I.EN)) st.q = st.q.map(() => X);
      const o = {}; st.q.forEach((v, i) => (o['Q' + i] = v)); return o;
    },
    sym(p, style) { const L = DEFS.register.layout(p), ops = boxSym(L, 'REG', style, { titleY: -0.35 }); if (p.edge === 'fall') ops.push(clkBubble(L)); return ops; }
  },
  /* ----- Mémoires ----- */
  rom: {
    cat: 'mem', kind: 'msi', name: () => tl('Mémoire morte (ROM)'), full: () => tl('Mémoire morte (ROM) programmable'),
    doc: () => tl('Donne sur D le mot rangé à l’adresse A. Le contenu s’écrit dans ses propriétés : un mot hexadécimal par adresse, l’adresse 0 en premier. OE = 0 (facultative) déconnecte les sorties (Z), pour partager un bus.'),
    props: [BITS(4, 1, 8, () => tl('Bits d’adresse'), 'abits'), BITS(4, 1, 8, () => tl('Bits de données'), 'dbits'), { k: 'data', label: () => tl('Contenu'), type: 'mem', def: '' }, BUS],
    layout(p) {
      const a = p.abits || 4, d = p.dbits || 4, bus = !!p.bus;
      return boxLayout({ w: 7, minH: 4, left: [{ name: 'A', dir: 'in', n: a, bus }, { name: 'OE', dir: 'in', opt: 1 }], right: [{ name: 'D', dir: 'out', n: d, bus }] });
    },
    ev(I, p) {
      const a = p.abits || 4, d = p.dbits || 4, o = {};
      if (I.OE === 0) { for (const k of bitNames('D', d)) o[k] = Z; return o; }
      const ad = rd(I, 'A', a);
      return wr(o, 'D', d, ad == null || !isB(I.OE) ? null : memWords(p.data, a, d)[ad]);
    },
    sym: (p, style) => boxSym(DEFS.rom.layout(p), 'ROM', style, { titleY: -0.35 })
  },
  ram: {
    cat: 'mem', kind: 'msi', seq: true, name: () => tl('Mémoire vive (RAM)'), full: () => tl('Mémoire vive (RAM)'),
    doc: () => tl('Q donne le mot rangé à l’adresse A. Au front d’horloge, si WE vaut 1, le mot présent sur D est écrit à l’adresse A. Le contenu s’efface à la réinitialisation ; il s’affiche dans l’inspecteur.'),
    props: [BITS(4, 1, 6, () => tl('Bits d’adresse'), 'abits'), BITS(4, 1, 8, () => tl('Bits de données'), 'dbits'), EDGE, BUS],
    layout(p) {
      const a = p.abits || 4, d = p.dbits || 4, bus = !!p.bus;
      return boxLayout({ w: 7, minH: 4, left: [{ name: 'A', dir: 'in', n: a, bus }, { name: 'D', dir: 'in', n: d, bus }, { name: 'WE', dir: 'in' }, { name: 'CLK', dir: 'in', clk: true, label: '' }], right: [{ name: 'Q', dir: 'out', n: d, bus }] });
    },
    init: p => ({ mem: range(1 << (p.abits || 4)).map(() => 0), clk: null }),
    ev(I, p, st) {
      const a = p.abits || 4, d = p.dbits || 4, e = edge(st, I.CLK, p);
      if (!Array.isArray(st.mem) || st.mem.length !== 1 << a) st.mem = range(1 << a).map(() => 0);
      const ad = rd(I, 'A', a);
      if (e && I.WE === 1) { if (ad == null) st.mem = st.mem.map(() => null); else st.mem[ad] = rd(I, 'D', d); }
      else if (e && !isB(I.WE) && ad != null) st.mem[ad] = null;
      return wr({}, 'Q', d, ad == null ? null : st.mem[ad]);
    },
    sym(p, style) { const L = DEFS.ram.layout(p), ops = boxSym(L, 'RAM', style, { titleY: -0.35 }); if (p.edge === 'fall') ops.push(clkBubble(L)); return ops; }
  },
  /* ----- Câblage et notes ----- */
  junction: {
    cat: 'wire', kind: 'wire', name: () => tl('Jonction'), full: () => tl('Nœud de connexion'),
    doc: () => tl('Point où plusieurs fils se rejoignent. Il apparaît aussi tout seul quand vous tirez un fil depuis un autre fil.'),
    props: [{ k: 'bits', type: 'int', hidden: true, min: 1, max: 8, def: 1 }],
    layout: p => ({ w: 0, h: 0, pins: [pin('J', 'io', 0, 0, 'c', p.bits > 1 ? { bus: bitNames('J', p.bits) } : {})] }),
    sym: () => []
  },
  tunnel: {
    cat: 'wire', kind: 'wire', name: () => tl('Étiquette'), full: () => tl('Étiquette de liaison (relie les fils de même nom)'),
    doc: () => tl('Deux étiquettes qui portent le même nom sont reliées, sans fil entre elles : pratique pour l’horloge ou un signal utilisé loin.'),
    props: [{ k: 'label', label: () => tl('Nom'), type: 'text' }, BITS(1, 1, 8, () => tl('Largeur (bits)'))],
    layout: p => { const w = Math.max(3, Math.ceil(String(p.label || '?').length * 0.62 + 2)); return { w, h: 2, pins: [pin('T', 'io', 0, 1, 'l', p.bits > 1 ? { bus: bitNames('T', p.bits) } : {})] }; },
    sym(p) { const w = DEFS.tunnel.layout(p).w; return [P([[0, 1], [0.8, 0.25], [w, 0.25], [w, 1.75], [0.8, 1.75]], { close: true, fill: 'body', w: p.bits > 1 ? 0.24 : 0.12 }), T((w + 0.8) / 2, 1.3, p.label || '?', { s: 0.8, b: true, mono: true })]; }
  },
  split: {
    cat: 'wire', kind: 'wire', name: () => tl('Séparateur de bus'), full: () => tl('Séparateur de bus (un bus ↔ des fils)'),
    doc: () => tl('Relie un bus (fil épais de plusieurs bits, à gauche) à ses bits séparés (à droite, bit 0 en haut). Il marche dans les deux sens : pour regrouper des fils en bus, ou pour sortir des bits d’un bus. Avec « bits par branche », il coupe un bus de 8 bits en deux bus de 4 bits, par exemple.'),
    props: [BITS(4, 2, 8), { k: 'grp', label: () => tl('Bits par branche'), type: 'enum', def: 1, opts: [[1, () => '1'], [2, () => '2'], [4, () => '4']] }],
    layout(p) {
      const n = p.bits || 4, g = Math.min(+p.grp || 1, n), k = Math.ceil(n / g), keys = bitNames('b', n, true), pins = [pin('B', 'io', 0, 0, 'l', { bus: keys })];
      for (let i = 0; i < k; i++) { const part = keys.slice(i * g, (i + 1) * g); pins.push(g === 1 ? pin(part[0], 'io', 2, i + 1, 'r') : pin('o' + i, 'io', 2, i + 1, 'r', { bus: part })); }
      return { w: 2, h: k, pins };
    },
    sym(p) {
      const L = DEFS.split.layout(p), n = p.bits || 4, g = Math.min(+p.grp || 1, n), k = L.h, ops = [P([[0, 0], [0.7, 0], [1, 0.3], [1, k]], { w: 0.3 })];
      for (let i = 0; i < k; i++) {
        const a = i * g, b = Math.min(n, a + g) - 1;
        ops.push(P([[1, i + 1], [2, i + 1]], b > a ? { w: 0.3 } : {}), T(1.6, i + 0.82, b > a ? `${a}-${b}` : a, { s: 0.42, color: 'mut', mono: true }));
      }
      return ops;
    }
  },
  pull: {
    cat: 'wire', kind: 'const', name: () => tl('Résistance de tirage'), full: () => tl('Résistance de tirage (au 1 ou au 0)'),
    doc: () => tl('Donne un niveau par défaut à un fil que rien ne pilote (Z) : 1 pour une résistance de rappel au 1 (pull-up), 0 au 0 (pull-down). Une vraie sortie l’emporte toujours. Utile sur un bus partagé par des tampons 3 états.'),
    props: [{ k: 'value', label: () => tl('Tire vers'), type: 'enum', def: 1, opts: [[1, () => tl('1 (pull-up)')], [0, () => tl('0 (pull-down)')]] }],
    layout: () => ({ w: 2, h: 3, pins: [pin('A', 'out', 1, 3, 'b', { weak: true })] }),
    ev: (I, p) => ({ A: p.value ? 1 : 0 }),
    sym: p => [T(1, 0.72, p.value ? '1' : '0', { s: 0.8, b: true, mono: true }), P([[0.45, 0.95], [1.55, 0.95]]),
      P([[1, 0.95], [1, 1.15], [1.35, 1.3], [0.65, 1.55], [1.35, 1.8], [0.65, 2.05], [1.35, 2.3], [1, 2.45], [1, 3]])]
  },
  text: {
    cat: 'wire', kind: 'deco', name: () => tl('Texte'), full: () => tl('Texte libre (titre, consigne, note)'),
    doc: () => tl('Un texte posé sur le plan de travail. Double-cliquez dessus pour le modifier.'),
    props: [{ k: 'text', label: () => tl('Texte'), type: 'text', def: '' }],
    layout: p => ({ w: Math.max(2, Math.ceil(String(p.text || tl('Texte')).length * 0.62)), h: 2, pins: [] }),
    sym: p => [T(0, 1.35, p.text || tl('Texte'), { s: 1, a: 'l', color: 'note' })]
  },
  /* ----- Blocs (sous-circuits faits par l'élève, voir blocks.js) ----- */
  block: {
    cat: 'blocks', kind: 'block', name: () => tl('Bloc'), full: () => tl('Bloc (circuit réutilisable)'), labelAt: 't',
    doc: () => tl('Un circuit que vous avez construit, posé comme un seul élément. Ses broches sont les entrées et les sorties nommées de son circuit. Double-cliquez dessus pour l’ouvrir et le modifier.'),
    props: [LABEL, { k: 'ref', type: 'hidden' }, { k: 'io', type: 'hidden' }],
    layout: p => blockLayout(p.io),
    sym: (p, style) => boxSym(blockLayout(p.io), String((p.io && p.io.t) || '?'), style)
  }
};
for (const [id, d] of Object.entries(DEFS)) d.id = id;
Object.setPrototypeOf(DEFS, null); // un type lu dans un fichier (« constructor », « __proto__ »…) n'y trouve rien d'hérité

/* ---------- Outils ---------- */
/** Propriétés d'un élément, valeurs par défaut comprises. */
export function propsOf(el) {
  const d = DEFS[el.type], p = { ...(el.p || {}) };
  if (d) for (const pr of d.props || []) if (p[pr.k] == null && pr.def != null) p[pr.k] = pr.def;
  return p;
}
const layoutCache = new Map();
/** Boîte et broches d'un élément (avant rotation). */
export function layoutOf(el) {
  const d = DEFS[el.type]; if (!d) return { w: 2, h: 2, pins: [] };
  const p = propsOf(el), key = el.type + JSON.stringify(p);
  let L = layoutCache.get(key);
  if (!L) { L = d.layout(p); if (layoutCache.size > 500) layoutCache.clear(); layoutCache.set(key, L); }
  return L;
}
/** Rotation (0, 90, 180, 270, sens horaire) d'un point local d'une boîte w × h. */
export function rotPt(x, y, w, h, r) {
  return r === 90 ? [h - y, x] : r === 180 ? [w - x, h - y] : r === 270 ? [y, w - x] : [x, y];
}
const SIDES = ['t', 'r', 'b', 'l'];
export const rotSide = (s, r) => (s === 'c' ? 'c' : SIDES[(SIDES.indexOf(s) + (r / 90 | 0)) % 4]);
/** Dimensions après rotation. */
export function sizeOf(el) { const L = layoutOf(el), r = el.r || 0; return r % 180 ? { w: L.h, h: L.w } : { w: L.w, h: L.h }; }
/** Broches d'un élément en coordonnées du plan de travail. */
export function pinsOf(el) {
  const L = layoutOf(el), r = el.r || 0;
  return L.pins.map(p => { const [x, y] = rotPt(p.x, p.y, L.w, L.h, r); return { ...p, wx: el.x + x, wy: el.y + y, wside: rotSide(p.side, r) }; });
}
export function pinPos(el, name) { const p = pinsOf(el).find(q => q.name === name); return p ? [p.wx, p.wy, p.wside] : null; }
/** Nom affiché d'une broche (« Q̄ » pour QN). */
export const pinLabel = p => (p.ov ? (p.label || p.name) + '̄' : p.label ?? p.name);
export const isInput = el => DEFS[el.type] && DEFS[el.type].kind === 'in';
export const isOutput = el => DEFS[el.type] && DEFS[el.type].kind === 'out';
