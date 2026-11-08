// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Import d'une pièce Fritzing (.fzpz : archive d'un fichier .fzp en XML et de ses dessins SVG), d'après le format
// publié de Fritzing. On lit le titre, les propriétés et les connecteurs (id, nom, description) du .fzp, puis la
// place de chaque connecteur dans le dessin « breadboard » (éléments connectorNpin / connectorNterminal, avec les
// transformations des groupes) : elle donne la position de la broche sur une plaquette où le dessin est peint.
// Le résultat est un brouillon de paquet .jpart (rôles des broches devinés d'après leur nom) que l'on complète
// dans l'éditeur de composant. Aucun code n'est repris de Fritzing.
import { unzipSync, strFromU8 } from 'fflate';
import { parseXml, find, findAll, localName, textOf, walk, sanitizeSvg } from './xml.js';
import { guessRole } from '../sim/custom.js';
import { PKG_CATEGORIES } from '../library/jpart.js';
import { tl } from '../i18n/index.js';

const MAX_ZIP = 16 * 1024 * 1024, MAX_FILE = 4 * 1024 * 1024;

/* ---------- Géométrie SVG ---------- */
const nums = s => (String(s || '').match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number);
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const ID = [1, 0, 0, 1, 0, 0];
/** Matrice [a b c d e f] d'un attribut transform (matrix, translate, scale, rotate, skewX, skewY). */
export function parseTransform(s) {
  let m = ID;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(String(s || '')))) {
    const v = nums(t[2]);
    let k = ID;
    switch (t[1]) {
      case 'matrix': if (v.length >= 6) k = v.slice(0, 6); break;
      case 'translate': k = [1, 0, 0, 1, v[0] || 0, v[1] || 0]; break;
      case 'scale': k = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const a = (v[0] || 0) * Math.PI / 180, c = Math.cos(a), si = Math.sin(a), r = [c, si, -si, c, 0, 0];
        k = v.length >= 3 ? mul(mul([1, 0, 0, 1, v[1], v[2]], r), [1, 0, 0, 1, -v[1], -v[2]]) : r; break;
      }
      case 'skewX': k = [1, 0, Math.tan((v[0] || 0) * Math.PI / 180), 1, 0, 0]; break;
      case 'skewY': k = [1, Math.tan((v[0] || 0) * Math.PI / 180), 0, 1, 0, 0]; break;
      default: break;
    }
    m = mul(m, k);
  }
  return m;
}
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Points d'un tracé (commandes M L H V C S Q T A Z, absolues et relatives) : extrémités et points de contrôle. */
function pathPoints(d) {
  const out = [], toks = String(d || '').match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  const isCmd = t => /^[a-zA-Z]$/.test(t), NEED = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7 };
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = null;
  const has = k => { for (let j = 0; j < k; j++) if (i + j >= toks.length || isCmd(toks[i + j])) return false; return true; };
  const n = () => +toks[i++];
  while (i < toks.length && out.length < 20000) {
    if (isCmd(toks[i])) {
      cmd = toks[i++];
      if (cmd === 'Z' || cmd === 'z') { cx = sx; cy = sy; out.push([cx, cy]); cmd = null; continue; }
    }
    const C = cmd && cmd.toUpperCase(), rel = !!cmd && cmd !== C, need = C && NEED[C];
    if (!need || !has(need)) { i++; continue; } // tracé mal formé : on avance
    const pt = (x, y) => (rel ? [cx + x, cy + y] : [x, y]);
    if (C === 'H') { cx = rel ? cx + n() : n(); out.push([cx, cy]); continue; }
    if (C === 'V') { cy = rel ? cy + n() : n(); out.push([cx, cy]); continue; }
    if (C === 'A') { const r1 = Math.abs(n()), r2 = Math.abs(n()); i += 3; const p = pt(n(), n()); out.push(p, [p[0] - r1, p[1] - r2], [p[0] + r1, p[1] + r2]); [cx, cy] = p; continue; }
    const vals = []; for (let j = 0; j < need; j += 2) vals.push(pt(n(), n()));
    out.push(...vals); [cx, cy] = vals[vals.length - 1];
    if (C === 'M') { sx = cx; sy = cy; cmd = rel ? 'l' : 'L'; } // coordonnées suivantes : des lignes
  }
  return out.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}
/** Points qui délimitent un élément SVG, dans son propre repère (enfants compris pour un groupe). */
function shapePoints(el) {
  const a = el.attrs, f = k => +(a[k] || 0), tag = localName(el.tag);
  switch (tag) {
    case 'rect': return [[f('x'), f('y')], [f('x') + f('width'), f('y') + f('height')]];
    case 'circle': return [[f('cx') - f('r'), f('cy') - f('r')], [f('cx') + f('r'), f('cy') + f('r')]];
    case 'ellipse': return [[f('cx') - f('rx'), f('cy') - f('ry')], [f('cx') + f('rx'), f('cy') + f('ry')]];
    case 'line': return [[f('x1'), f('y1')], [f('x2'), f('y2')]];
    case 'polygon': case 'polyline': { const v = nums(a.points); const p = []; for (let i = 0; i + 1 < v.length; i += 2) p.push([v[i], v[i + 1]]); return p; }
    case 'path': return pathPoints(a.d);
    case 'g': case 'svg': case 'symbol': return el.children.flatMap(ch => shapePoints(ch).map(p => apply(parseTransform(ch.attrs.transform), p)));
    default: return [];
  }
}
/** Centre d'un élément dans le repère du document (transformations de ses groupes appliquées). */
function centerOf(el, anc) {
  let m = ID;
  for (const g of anc) if (g.attrs.transform) m = mul(m, parseTransform(g.attrs.transform));
  if (el.attrs.transform) m = mul(m, parseTransform(el.attrs.transform));
  const pts = shapePoints(el).map(p => apply(m, p));
  if (!pts.length) return null;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
/** Longueur SVG en millimètres (in, mm, cm, pt, pc, px à 90 ppp comme Fritzing ; sans unité : px). */
export function toMm(s) {
  const m = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*(in|mm|cm|pt|pc|px)?\s*$/i.exec(String(s || ''));
  if (!m) return null;
  const v = +m[1], u = (m[2] || 'px').toLowerCase();
  return v * { in: 25.4, mm: 1, cm: 10, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 90 }[u];
}
/**
 * Dessin « breadboard » : taille réelle (mm) et position (mm, depuis le coin haut gauche) des éléments d'id donnés.
 * Rend { w, l, at: id → [x, y] }.
 */
export function svgGeometry(svgText, ids) {
  const root = parseXml(svgText);
  const vb = nums(root.attrs.viewBox);
  const W = toMm(root.attrs.width), H = toMm(root.attrs.height);
  const vw = vb.length === 4 ? vb[2] : (W != null ? W / (25.4 / 90) : 100), vh = vb.length === 4 ? vb[3] : (H != null ? H / (25.4 / 90) : 100);
  const w = W ?? vw * 25.4 / 90, l = H ?? vh * 25.4 / 90;
  const sx = w / vw, sy = l / vh, ox = vb.length === 4 ? vb[0] : 0, oy = vb.length === 4 ? vb[1] : 0;
  const want = new Set(ids), at = {};
  walk(root, (el, anc) => {
    const id = el.attrs.id; if (!id || !want.has(id) || at[id]) return;
    const c = centerOf(el, anc.slice(1)); // la racine <svg> : viewBox traitée à part
    if (c) at[id] = [(c[0] - ox) * sx, (c[1] - oy) * sy];
  });
  return { w, l, at };
}

/* ---------- Pièce .fzp ---------- */
const stripTags = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
/** Nom de broche accepté par le format .jpart (lettres, chiffres, + - _ . / ~), unique. */
function pinName(raw, used, i) {
  let n = String(raw || '').trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9+\-_./~]/g, '').slice(0, 16) || `P${i + 1}`;
  if (used.has(n)) { let k = 2; while (used.has((n.slice(0, 14) + k).slice(0, 16))) k++; n = (n.slice(0, 14) + k).slice(0, 16); }
  used.add(n); return n;
}
const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'piece';
/** Petit condensé (identifiant stable d'une même pièce). */
export function hash(s) { let h = 2166136261 >>> 0; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h.toString(36).slice(0, 6); }
/** Catégorie de la bibliothèque devinée d'après le titre, la famille et les mots-clés. */
export function guessCategory(text) {
  const t = String(text).toLowerCase();
  const rules = [[/sensor|capteur|thermistor|photo|ldr|accel|gyro|humid|temperature|gas|ultrason|pir/, 'Capteurs'], [/display|lcd|oled|screen|segment|matrix|écran/, 'Affichage'],
    [/motor|servo|stepper|moteur/, 'Moteurs'], [/bluetooth|wifi|wi-fi|radio|rf|gsm|rfid|nrf|xbee|lora|serial/, 'Communication'], [/battery|power|regulator|alimentation|pile/, 'Alimentation'],
    [/button|switch|potentiometer|keypad|joystick|encoder|bouton/, 'Entrées'], [/led|buzzer|relay|speaker|relais/, 'Sorties'], [/resistor|capacitor|diode|transistor|inductor/, 'Passifs']];
  for (const [re, cat] of rules) if (re.test(t)) return cat;
  return PKG_CATEGORIES[0];
}
/** Rôle probable d'une broche d'après son nom brut (« VCC +5V », « GND2 », « NO ») ; sinon custom.js (guessRole). */
export function roleOf(raw) {
  const n = String(raw || '').trim().toUpperCase();
  if (/^(VCC|VDD|VIN|V\+|\+?5V|\+?3V3|\+?3\.3V|PWR|POWER)\b/.test(n)) return 'pwr';
  if (/^(GND|VSS|0V|AGND|DGND)\d*\b/.test(n)) return 'gnd';
  if (/^(NO|NC|COM)\d*$/.test(n)) return 'contact';
  return guessRole(n.replace(/\s+/g, ''));
}
/** Rôle → broche du format .jpart : alimentation à la tension logique, masse, contact, ou signal io. */
export function pinFromRole(role) {
  if (role === 'pwr' || role === 'pwr33' || role === 'pwr5') return { kind: 'pwr', v: 'logic' };
  if (role === 'gnd') return { kind: 'gnd' };
  if (role === 'nc') return { kind: 'nc' };
  if (role === 'contact') return { kind: 'contact' };
  return { kind: 'io', need: role };
}

/** Fichiers d'une archive .fzpz (octets) : { nom: texte }, seulement le .fzp et les .svg, tailles bornées. */
export function readFzpz(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length > MAX_ZIP) throw new Error(tl('pièce Fritzing trop lourde'));
  let raw;
  try { raw = unzipSync(u8, { filter: e => /\.(fzp|svg)$/i.test(e.name) && e.originalSize <= MAX_FILE }); }
  catch (e) { throw new Error(tl('archive .fzpz illisible : {0}', e.message || e)); }
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, strFromU8(v)]));
}

/**
 * Pièce Fritzing → brouillon de paquet : { manifest, svg, report }. files : { nom: texte } (readFzpz). Le
 * manifeste est valide tel quel (alimentations à la tension logique, rôles devinés) ; report liste ce qui reste à
 * vérifier : connecteurs placés d'après le dessin ou estimés, rôles devinés.
 */
export function importFritzing(files) {
  const fzpName = Object.keys(files).find(k => /\.fzp$/i.test(k));
  if (!fzpName) throw new Error(tl('fichier .fzp introuvable dans l’archive'));
  const mod = parseXml(files[fzpName]);
  if (localName(mod.tag) !== 'module') throw new Error(tl('.fzp : la racine doit être <module>'));
  const child = name => mod.children.find(c => localName(c.tag) === name);
  const title = stripTags(textOf(child('title') || { text: '', children: [] })) || fzpName.replace(/^part\.|\.fzp$/gi, '');
  const props = (find(mod, 'properties') ? findAll(find(mod, 'properties'), 'property') : []).map(p => [stripTags(p.attrs.name), stripTags(textOf(p))]).filter(([a, b]) => a && b).slice(0, 12);
  const tags = findAll(mod, 'tag').map(t => stripTags(textOf(t))).filter(Boolean);
  const label = stripTags(textOf(child('label') || { text: '', children: [] })).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  // Dessin breadboard : l'image de la vue, rangée dans l'archive sous « svg.breadboard.<nom> ».
  const bbView = find(mod, 'breadboardView'), layers = bbView && find(bbView, 'layers'), image = layers && layers.attrs.image;
  const base = image ? image.split('/').pop() : null;
  const svgName = Object.keys(files).find(k => base && (k === `svg.breadboard.${base}` || k.endsWith('/' + base) || k === base))
    || Object.keys(files).find(k => /breadboard.*\.svg$/i.test(k));
  const conns = findAll(find(mod, 'connectors') || { tag: 'x', children: [], attrs: {} }, 'connector').slice(0, 64);
  if (!conns.length) throw new Error(tl('aucun connecteur dans la pièce'));
  const bbOf = c => { const v = find(c, 'breadboardView'); const p = v && v.children.find(x => localName(x.tag) === 'p'); return p ? p.attrs : {}; };
  const ids = conns.flatMap(c => { const p = bbOf(c), id = c.attrs.id || ''; return [p.svgId || `${id}pin`, p.terminalId || `${id}terminal`]; });
  const geo = svgName ? svgGeometry(files[svgName], ids) : null;
  const w = geo ? Math.max(4, Math.min(300, geo.w)) : Math.max(10, conns.length * 2.54 + 4), l = geo ? Math.max(4, Math.min(300, geo.l)) : 12;
  const used = new Set(), report = { placed: [], estimated: [], guessed: [] };
  const missing = [];
  const pins = conns.map((c, i) => {
    const p = bbOf(c), id = c.attrs.id || `connector${i}`;
    const name = pinName(c.attrs.name || id, used, i);
    const role = roleOf(c.attrs.name || name), pin = { name, ...pinFromRole(role) };
    const why = stripTags(textOf(find(c, 'description') || { text: '', children: [] }));
    if (why && why.toLowerCase() !== name.toLowerCase()) pin.why = why.slice(0, 400);
    report.guessed.push(`${name} → ${role}`);
    const at = geo && (geo.at[p.terminalId || `${id}terminal`] || geo.at[p.svgId || `${id}pin`]);
    if (at) { pin.x = +(at[0] - w / 2).toFixed(2); pin.z = +(at[1] - l / 2).toFixed(2); report.placed.push(name); }
    else missing.push(pin);
    pin.y = 4.1;
    return pin;
  });
  // Connecteurs absents du dessin : en rangée au pas de 2,54 mm sur le bord avant de la plaquette.
  missing.forEach((pin, i) => { pin.x = +((i - (missing.length - 1) / 2) * 2.54).toFixed(2); pin.z = +(l / 2 - 1.5).toFixed(2); report.estimated.push(pin.name); });
  const desc = stripTags(textOf(child('description') || { text: '', children: [] })).slice(0, 400);
  const author = stripTags(textOf(child('author') || { text: '', children: [] })).slice(0, 80);
  const svg = svgName ? sanitizeSvg(files[svgName]) : null;
  const manifest = {
    format: 1, id: `pk-${slug(title)}-${hash(files[fzpName])}`, version: 1, name: title.slice(0, 60), category: guessCategory([title, ...tags, ...props.map(p => p[1])].join(' ')),
    prefix: /^[A-Z]/.test(label) ? label : 'U', ...(desc && { description: desc }), ...(author && { author: tl('{0} (pièce Fritzing)', author) }),
    pins: pins.map(p => ({ ...p, x: Math.max(-300, Math.min(300, p.x)), z: Math.max(-300, Math.min(300, p.z)) })),
    docs: { ...(desc && { text: desc }), ...(props.length && { specs: props.map(([a, b]) => [a.slice(0, 60), b.slice(0, 200)]) }) },
    look: svg ? { kind: 'svg', size: [+w.toFixed(2), 1.6, +l.toFixed(2)] } : { kind: 'module', size: [+w.toFixed(2), 1.6, +l.toFixed(2)] }
  };
  return { manifest, svg, report: { ...report, title, svg: svgName || null } };
}
