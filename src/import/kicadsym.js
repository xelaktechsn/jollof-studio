// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Import d'une bibliothèque de symboles KiCad (.kicad_sym, expressions S), d'après le format de fichier publié par
// KiCad (version 6 et suivantes, et l'ancien arc à rayon). Chaque symbole donne ses broches (numéro, nom, type
// électrique, d'où l'on devine ce que la broche attend : power_in → alimentation, input → commande de la carte,
// output → sortie lue par la carte, passive → patte libre…) et son dessin (rectangles, traits, cercles, arcs,
// textes) converti au format symbol.json du schéma. Un brouillon de paquet .jpart en est tiré, à compléter dans
// l'éditeur de composant. Lecteur écrit pour Jollof Studio, linéaire, borné en taille.
import { guessRole } from '../sim/custom.js';
import { pinFromRole, guessCategory, hash } from './fritzing.js';
import { tl } from '../i18n/index.js';

const MAX_TEXT = 12 * 1024 * 1024, MAX_NODES = 2e6;

/** Expressions S → tableaux imbriqués de chaînes (atomes et chaînes entre guillemets, échappements \" \\ \n). */
export function parseSexpr(text) {
  if (typeof text !== 'string') throw new Error(tl('texte attendu'));
  if (text.length > MAX_TEXT) throw new Error(tl('fichier trop lourd'));
  const re = /\s*(?:(\()|(\))|"((?:[^"\\]|\\[\s\S])*)"|([^\s()"]+))/y;
  const root = [], stack = [root];
  let m, nodes = 0, pos = 0;
  while (pos < text.length) {
    re.lastIndex = pos;
    if (!(m = re.exec(text))) break;
    pos = re.lastIndex;
    if (m[1]) { const l = []; stack[stack.length - 1].push(l); stack.push(l); if (stack.length > 200) throw new Error(tl('imbrication trop profonde')); }
    else if (m[2]) { if (stack.length < 2) throw new Error(tl('parenthèse fermante en trop')); stack.pop(); }
    else if (m[3] != null) stack[stack.length - 1].push(m[3].replace(/\\(.)/g, (x, c) => (c === 'n' ? '\n' : c)));
    else if (m[4] != null) stack[stack.length - 1].push(m[4]);
    if (++nodes > MAX_NODES) throw new Error(tl('fichier trop chargé'));
  }
  if (/\S/.test(text.slice(pos))) throw new Error(tl('caractère inattendu à {0}', pos));
  if (stack.length !== 1) throw new Error(tl('parenthèse non fermée'));
  if (root.length !== 1 || !Array.isArray(root[0])) throw new Error(tl('une seule expression attendue'));
  return root[0];
}
const kids = (node, name) => node.filter(x => Array.isArray(x) && x[0] === name);
const kid = (node, name) => node.find(x => Array.isArray(x) && x[0] === name) || null;
const xy = n => (n ? [+n[1], +n[2]] : null);
const r2 = v => Math.round(v * 1000) / 1000 + 0; // + 0 : jamais de −0
/** Point KiCad (y vers le haut) → point du schéma (y vers le bas). */
const P = ([x, y]) => [r2(x), r2(-y)];

/** Nom de broche accepté par .jpart : ~{RESET} → RESET ; vide ou « ~ » → numéro ; unique. */
function pinKey(name, number, used) {
  let n = String(name || '').replace(/~\{([^}]*)\}/g, '$1').replace(/[{}]/g, '');
  if (!n || n === '~') n = String(number || '');
  n = n.replace(/\s+/g, '_').replace(/[^A-Za-z0-9+\-_./~]/g, '').slice(0, 16);
  if (!n || n === '~') n = `P${used.size + 1}`;
  if (used.has(n)) { const num = String(number || '').replace(/[^A-Za-z0-9]/g, ''); let k = `${n.slice(0, 12)}_${num}`.slice(0, 16), i = 2; while (used.has(k)) k = `${n.slice(0, 12)}_${i++}`; n = k; }
  used.add(n); return n;
}

/** Type électrique KiCad (et nom) → broche .jpart suggérée : { kind, need?, v? }. */
export function suggestPin(type, name) {
  const n = String(name || '').toUpperCase();
  const g = guessRole(n), bus = ['sda', 'scl', 'sck', 'mosi', 'miso', 'ss', 'tx', 'rx', 'pwm', 'adc'].includes(g) ? g : null;
  switch (type) {
    case 'power_in': return /^(GND|VSS|0V|AGND|DGND|PGND)\d*$/.test(n) || /^(V-|VEE|VSS)/.test(n) ? { kind: 'gnd' } : { kind: 'pwr', v: 'logic' };
    case 'power_out': return { kind: 'passive' };
    case 'passive': return /^(GND|VSS)$/.test(n) ? { kind: 'gnd' } : { kind: 'passive' };
    case 'no_connect': return { kind: 'nc' };
    case 'input': return { kind: 'io', need: bus || 'out' };
    case 'output': return { kind: 'io', need: bus || 'in' };
    case 'open_collector': return { kind: 'io', need: 'pullup' };
    case 'open_emitter': return { kind: 'io', need: 'in' };
    case 'bidirectional': case 'tri_state': return { kind: 'io', need: bus || 'io' };
    default: return pinFromRole(g);
  }
}

/** Cercle passant par trois points (arc KiCad start / mid / end) : centre, rayon, angles de départ et d'arrivée. */
function arc3(a, m, b) {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-9) return null;
  const s = p => p[0] * p[0] + p[1] * p[1];
  const cx = (s(a) * (m[1] - b[1]) + s(m) * (b[1] - a[1]) + s(b) * (a[1] - m[1])) / d;
  const cy = (s(a) * (b[0] - m[0]) + s(m) * (a[0] - b[0]) + s(b) * (m[0] - a[0])) / d;
  const ang = p => Math.atan2(p[1] - cy, p[0] - cx), TAU = 2 * Math.PI;
  let a0 = ang(a), am = ang(m), a1 = ang(b);
  // Sens qui passe par le point du milieu.
  const norm = x => ((x % TAU) + TAU) % TAU;
  if (norm(am - a0) > norm(a1 - a0)) a1 = a0 - norm(a0 - a1); else a1 = a0 + norm(a1 - a0);
  return { x: r2(cx), y: r2(cy), r: r2(Math.hypot(a[0] - cx, a[1] - cy)), a0: r2(a0), a1: r2(a1) };
}

/** Dessin et broches d'un symbole (unité 1 et parties communes, style normal) au format symbol.json. */
function drawingOf(sym, all, depth = 0) {
  const base = kid(sym, 'extends');
  if (base && depth < 4) { const parent = all.get(base[1]); if (parent) return drawingOf(parent, all, depth + 1); }
  const name = sym[1];
  const units = kids(sym, 'symbol').filter(u => { const mm = /_(\d+)_(\d+)$/.exec(u[1]); return !mm || ((mm[1] === '0' || mm[1] === '1') && mm[2] !== '2'); });
  const items = [...units.flatMap(u => u.slice(2)), ...sym.slice(2).filter(x => Array.isArray(x) && x[0] === 'pin')];
  const multi = kids(sym, 'symbol').some(u => { const mm = /_(\d+)_\d+$/.exec(u[1]); return mm && +mm[1] > 1; });
  const out = { lines: [], rects: [], circles: [], arcs: [], texts: [] }, pins = [];
  const width = n => { const st = kid(n, 'stroke'), w = st && kid(st, 'width'); const v = w ? +w[1] : 0.254; return Math.max(0.05, Math.min(2, v || 0.254)); };
  const filled = n => { const f = kid(n, 'fill'), t = f && kid(f, 'type'); return !!t && t[1] === 'outline'; };
  for (const it of items) {
    if (!Array.isArray(it)) continue;
    const tag = it[0];
    if (tag === 'rectangle') {
      const a = P(xy(kid(it, 'start'))), b = P(xy(kid(it, 'end')));
      out.rects.push({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: r2(Math.abs(b[0] - a[0])), h: r2(Math.abs(b[1] - a[1])), lw: width(it), fill: filled(it) });
    } else if (tag === 'polyline') {
      const pts = kids(kid(it, 'pts') || [], 'xy').map(n => P(xy(n))).slice(0, 400);
      if (pts.length >= 2) out.lines.push({ pts, w: width(it), close: false, fill: filled(it) });
    } else if (tag === 'circle') {
      const c = P(xy(kid(it, 'center'))), r = kid(it, 'radius');
      if (r) out.circles.push({ x: c[0], y: c[1], r: Math.max(0.05, r2(+r[1])), w: width(it), fill: filled(it) });
    } else if (tag === 'arc') {
      const rad = kid(it, 'radius');
      if (kid(it, 'mid')) { const a = arc3(P(xy(kid(it, 'start'))), P(xy(kid(it, 'mid'))), P(xy(kid(it, 'end')))); if (a) out.arcs.push({ ...a, w: width(it) }); }
      else if (rad && kid(rad, 'at')) {
        // Ancien format : centre, rayon et angles (degrés, sens trigonométrique KiCad, y vers le haut).
        const c = P(xy(kid(rad, 'at'))), L = kid(rad, 'length'), an = kid(rad, 'angles');
        if (L && an) out.arcs.push({ x: c[0], y: c[1], r: r2(+L[1]), a0: r2(-(+an[1]) * Math.PI / 180), a1: r2(-(+an[2]) * Math.PI / 180), w: width(it) });
      }
    } else if (tag === 'text') {
      const at = kid(it, 'at'), ef = kid(it, 'effects'), font = ef && kid(ef, 'font'), size = font && kid(font, 'size'), just = ef && kid(ef, 'justify');
      if (at && typeof it[1] === 'string' && it[1].trim()) out.texts.push({ x: P(xy(at))[0], y: P(xy(at))[1], t: it[1].trim().slice(0, 60), s: size ? Math.max(0.5, Math.min(10, +size[1])) : 1.27, a: just && just.includes('left') ? 'l' : just && just.includes('right') ? 'r' : 'm' });
    } else if (tag === 'pin') {
      const at = kid(it, 'at'), len = kid(it, 'length'), nm = kid(it, 'name'), num = kid(it, 'number');
      if (!at) continue;
      pins.push({ type: it[1], at: [+at[1], +at[2]], angle: +(at[3] || 0), length: len ? +len[1] : 2.54, name: nm ? nm[1] : '', number: num ? num[1] : '', hidden: it.includes('hide') });
    }
  }
  const pinNames = kid(sym, 'pin_names'), namesHidden = !!pinNames && pinNames.includes('hide');
  return { name, out, pins, multi, namesHidden };
}

/**
 * Symboles d'un fichier .kicad_sym : [{ name, description, datasheet, reference, keywords, multi, pins: [{ key,
 * number, name, type, suggest }], symbol (symbol.json) }].
 */
export function importKicadSymbols(text) {
  const lib = parseSexpr(text);
  if (lib[0] !== 'kicad_symbol_lib') throw new Error(tl('ce fichier n’est pas une bibliothèque de symboles KiCad (.kicad_sym)'));
  const syms = kids(lib, 'symbol').slice(0, 2000), all = new Map(syms.map(s => [s[1], s]));
  return syms.map(sym => {
    // Symbole dérivé (extends) : son nom et ses propriétés, le dessin et les broches de son parent.
    const parent = kid(sym, 'extends') && all.get(kid(sym, 'extends')[1]);
    const prop = k => { for (const s of [sym, parent].filter(Boolean)) { const p = kids(s, 'property').find(x => x[1] === k); if (p && typeof p[2] === 'string') return p[2]; } return ''; };
    const d = drawingOf(sym, all), used = new Set();
    const pins = d.pins.slice(0, 64).map(p => {
      const key = pinKey(p.name, p.number, used);
      // Extrémité de la broche (là où arrive le fil) et direction vers l'extérieur ; trait jusqu'au corps du symbole.
      const a = p.angle * Math.PI / 180, end = P(p.at), inner = P([p.at[0] + p.length * Math.cos(a), p.at[1] + p.length * Math.sin(a)]);
      const dir = { 0: 'l', 90: 'd', 180: 'r', 270: 'u' }[((Math.round(p.angle / 90) * 90) % 360 + 360) % 360];
      return { key, number: p.number, name: p.name, type: p.type, hidden: p.hidden, suggest: suggestPin(p.type, p.name.replace(/~\{([^}]*)\}/g, '$1')), end, inner, dir };
    });
    const sy = { format: 1, ...d.out, pins: {} };
    for (const p of pins) {
      sy.lines.push({ pts: [p.end, p.inner], w: 0.254, close: false, fill: false });
      sy.pins[p.key] = { x: p.end[0], y: p.end[1], dir: p.dir };
      if (!d.namesHidden && p.name && p.name !== '~') {
        const off = { l: [0.6, 0], r: [-0.6, 0], u: [0, 1.6], d: [0, -0.8] }[p.dir], horiz = p.dir === 'l' || p.dir === 'r';
        sy.texts.push({ x: r2(p.inner[0] + off[0]), y: r2(p.inner[1] + off[1] + (horiz ? 0.45 : 0)), t: p.key, s: 1.1, a: p.dir === 'l' ? 'l' : p.dir === 'r' ? 'r' : 'm' });
      }
    }
    return { name: sym[1], description: prop('ki_description') || prop('Description'), datasheet: prop('Datasheet'), reference: prop('Reference'), keywords: prop('ki_keywords'),
      multi: d.multi, pins: pins.map(({ end, inner, dir, ...p }) => p), symbol: sy };
  });
}

/** Brouillon de paquet .jpart d'un symbole : broches en rangée au pas de 2,54 mm sur une plaquette, symbole du schéma. */
export function symbolDraft(s, sourceText = '') {
  const n = s.pins.length, w = Math.max(10, n * 2.54 + 4), l = 14;
  const ref = String(s.reference || 'U').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const name = String(s.name || 'Symbole').slice(0, 60);
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'symbole';
  const manifest = {
    format: 1, id: `pk-${slug}-${hash(name + sourceText.length)}`, version: 1, name, category: guessCategory(`${name} ${s.keywords} ${s.description}`), prefix: /^[A-Z]/.test(ref) ? ref : 'U',
    ...(s.description && { description: s.description.slice(0, 400) }),
    pins: s.pins.map((p, i) => ({ name: p.key, x: +((i - (n - 1) / 2) * 2.54).toFixed(2), y: 8.1, z: +(l / 2 - 2.2).toFixed(2), ...p.suggest,
      ...(p.name && p.name !== '~' && p.name !== p.key ? { role: p.name.slice(0, 40) } : {}), why: tl('Broche {0} du symbole KiCad (type {1}).', p.number || p.key, p.type) })),
    docs: { ...(s.description && { text: s.description.slice(0, 2000) }), specs: [[tl('Symbole KiCad'), name], ...(s.datasheet && s.datasheet !== '~' ? [[tl('Fiche technique'), s.datasheet.slice(0, 200)]] : [])] },
    look: { kind: 'module', size: [+w.toFixed(2), 1.6, l], label: ref || 'U' }
  };
  return { manifest, symbol: s.symbol };
}
