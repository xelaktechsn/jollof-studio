// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Paquet de composant .jpart : une archive zip qui décrit un composant sans une ligne de code.
//   part.json   (obligatoire) le manifeste : nom, catégorie, broches et ce qu'elles attendent, consommation,
//               limites qui citent leurs fiches techniques, documentation, comportement déclaratif ;
//   model.glb   (facultatif) le modèle 3D ; symbol.json (facultatif) le symbole du schéma ;
//   look.svg    (facultatif) le dessin vu de dessus, posé sur une plaquette (pièces Fritzing).
// Tout est vérifié strictement (champs connus seulement, tailles bornées, textes nettoyés) puis converti vers les
// tables de l'application : fiche de câblage (PARTS), modèle de capteur (MODELS), documentation (DOCS), sources
// (SOURCES) et comportement électrique (sim/pkgparts.js). Rien n'est jamais exécuté.
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { cleanText } from '../sanitize.js';
import { PARTS } from '../sim/parts.js';
import { MODELS, QUANT } from '../sim/models.js';
import { DOCS } from './docs.js';
import { SOURCES } from '../check/sources.js';
import { PKG } from '../sim/pkgparts.js';
import { pulseHz } from '../sim/pkgbus.js';
import { SIGNALS, ACTIONS } from '../prog/rules.js';
import { volts } from '../sim/boards.js';
import { sanitizeSvg } from '../import/xml.js';
import { tl, DEC } from '../i18n/index.js';

export const FORMAT = 1;
/** Tailles maximales (octets) : archive, et chaque fichier une fois décompressé. */
export const LIMITS = { zip: 16 * 1024 * 1024, total: 24 * 1024 * 1024, 'part.json': 256 * 1024, 'model.glb': 12 * 1024 * 1024, 'symbol.json': 256 * 1024, 'look.svg': 2 * 1024 * 1024 };
const ENTRIES = ['part.json', 'model.glb', 'symbol.json', 'look.svg'];
/** Catégories de la bibliothèque (noms français, traduits à l'affichage) ; cartes et prototypage exclus. */
export const PKG_CATEGORIES = ['Capteurs', 'Entrées', 'Affichage', 'Sorties', 'Moteurs', 'Passifs', 'Alimentation', 'Communication'];
export const PIN_KINDS = ['pwr', 'gnd', 'io', 'nc', 'drv', 'contact', 'passive'];
export const NEEDS = ['io', 'in', 'out', 'pullup', 'pwm', 'adc', 'irq', 'sda', 'scl', 'sck', 'mosi', 'miso', 'ss', 'rx', 'tx'];
/** Résistances de la bibliothèque qu'une broche peut demander en série (via) ou en tirage (pull). */
export const RESISTORS = ['res-22', 'res-220', 'res-330', 'res-1k', 'res-4k7', 'res-10k'];
export const LOOKS = ['module', 'block', 'led', 'resistor', 'glb', 'svg'];
export const LED_COLORS = { red: '#d8322f', green: '#2fbf5a', blue: '#2f6fe0', yellow: '#f2c94c', white: '#f2f2ee', orange: '#f28c28' };
const ID = /^pk-[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY = /^[A-Za-z][\w-]{0,39}$/;
const PIN_NAME = /^[A-Za-z0-9+\-_./~]{1,16}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const URL_OK = /^https?:\/\/[^\s<>"'`]{3,500}$/;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/* ---------- Validation stricte du manifeste ---------- */
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
/** Texte nettoyé (sanitize.js) ; les apostrophes et guillemets droits deviennent typographiques au lieu de disparaître. */
export const cleanStr = (v, max) => cleanText(String(v).replace(/'/g, '’').replace(/"/g, '”'), max);
const num = v => typeof v === 'number' && Number.isFinite(v);

/** Petit vérificateur : chaque champ lu est contrôlé, tout champ inconnu est une erreur. */
function reader(errors) {
  const fail = (path, msg) => { if (errors.length < 40) errors.push(`${path} : ${msg}`); };
  const keys = (o, path, allowed) => {
    if (!isObj(o)) { fail(path, tl('objet attendu')); return false; }
    for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${path}.${k}`, tl('champ inconnu'));
    return true;
  };
  const str = (v, path, max, { req = false, re = null } = {}) => {
    if (v == null) { if (req) fail(path, tl('obligatoire')); return undefined; }
    if (typeof v !== 'string') { fail(path, tl('texte attendu')); return undefined; }
    const s = cleanStr(v, max).trim();
    if (v.length > max * 4) fail(path, tl('texte trop long ({0} caractères au plus)', max));
    if (req && !s) { fail(path, tl('obligatoire')); return undefined; }
    if (re && !re.test(s)) { fail(path, tl('valeur invalide')); return undefined; }
    return s || undefined;
  };
  const number = (v, path, lo, hi, { req = false, int = false } = {}) => {
    if (v == null) { if (req) fail(path, tl('obligatoire')); return undefined; }
    if (!num(v) || v < lo || v > hi || (int && !Number.isInteger(v))) { fail(path, tl('nombre entre {0} et {1} attendu', lo, hi)); return undefined; }
    return v;
  };
  const bool = (v, path) => { if (v == null) return undefined; if (typeof v !== 'boolean') { fail(path, tl('vrai ou faux attendu')); return undefined; } return v || undefined; };
  const oneOf = (v, path, list, req = false) => {
    if (v == null) { if (req) fail(path, tl('obligatoire')); return undefined; }
    if (!list.includes(v)) { fail(path, tl('valeur invalide')); return undefined; }
    return v;
  };
  const arr = (v, path, max) => {
    if (v == null) return [];
    if (!Array.isArray(v)) { fail(path, tl('liste attendue')); return []; }
    if (v.length > max) { fail(path, tl('{0} éléments au plus', max)); return v.slice(0, max); }
    return v;
  };
  return { fail, keys, str, number, bool, oneOf, arr };
}

/** Clés interdites (pollution de prototype) et profondeur, avant toute lecture. */
function scan(v, path, errors, depth = 0) {
  if (depth > 8) { errors.push(`${path} : ${tl('imbrication trop profonde')}`); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => scan(x, `${path}[${i}]`, errors, depth + 1)); return; }
  if (v && typeof v === 'object') for (const k of Object.keys(v)) {
    if (FORBIDDEN.has(k)) { errors.push(`${path}.${k} : ${tl('clé interdite')}`); continue; }
    scan(v[k], `${path}.${k}`, errors, depth + 1);
  }
  else if (typeof v === 'function') errors.push(`${path} : ${tl('code interdit')}`);
}

const srcList = s => (s == null ? [] : Array.isArray(s) ? s : [s]);

/**
 * Vérifie un manifeste (objet lu dans part.json). Rend { ok: true, manifest } (copie propre, seuls les champs
 * connus) ou { ok: false, errors: [texte] }. Règles : broches uniques et cohérentes ; toute tension v chiffrée,
 * toute consommation ma et toute limite cite une source complète ; comportement déclaratif seulement.
 */
export function validateManifest(raw) {
  const errors = [];
  if (!isObj(raw)) return { ok: false, errors: [tl('part.json : objet attendu')] };
  scan(raw, 'part', errors);
  if (errors.length) return { ok: false, errors };
  const R = reader(errors), { fail, keys, str, number, bool, oneOf, arr } = R;
  keys(raw, 'part', ['format', 'id', 'version', 'name', 'category', 'prefix', 'description', 'author', 'license', 'pins', 'ma', 'ds', 'limits', 'sources', 'docs', 'behaviour', 'look']);
  if (raw.format !== FORMAT) fail('part.format', tl('format {0} attendu', FORMAT));
  const m = { format: FORMAT };
  m.id = str(raw.id, 'part.id', 40, { req: true, re: ID });
  m.version = number(raw.version ?? 1, 'part.version', 1, 1e6, { int: true }) || 1;
  m.name = str(raw.name, 'part.name', 60, { req: true });
  m.category = oneOf(raw.category, 'part.category', PKG_CATEGORIES, true);
  m.prefix = str(raw.prefix, 'part.prefix', 8, { req: true, re: /^[A-Z][A-Z0-9]{0,7}$/ });
  const opt = (k, max) => { const v = str(raw[k], `part.${k}`, max); if (v) m[k] = v; };
  opt('description', 400); opt('author', 80); opt('license', 80);

  // Sources : fiches techniques citées par les limites (même forme que check/sources.js).
  m.sources = {};
  if (raw.sources != null) {
    if (!isObj(raw.sources)) fail('part.sources', tl('objet attendu'));
    else {
      const ks = Object.keys(raw.sources);
      if (ks.length > 16) fail('part.sources', tl('{0} éléments au plus', 16));
      for (const k of ks.slice(0, 16)) {
        const s = raw.sources[k], p = `part.sources.${k}`;
        if (!KEY.test(k)) { fail(p, tl('nom de source invalide')); continue; }
        if (!keys(s, p, ['title', 'publisher', 'url', 'section'])) continue;
        const e = { title: str(s.title, `${p}.title`, 200, { req: true }), publisher: str(s.publisher, `${p}.publisher`, 120, { req: true }), section: str(s.section, `${p}.section`, 600, { req: true }) };
        if (typeof s.url !== 'string' || !URL_OK.test(s.url.trim())) fail(`${p}.url`, tl('adresse http(s) attendue'));
        else e.url = s.url.trim();
        m.sources[k] = e;
      }
    }
  }
  const cite = (src, path, why) => {
    const list = srcList(src);
    if (!list.length) { fail(path, tl('{0} : citez la fiche technique (source)', why)); return undefined; }
    for (const k of list) if (typeof k !== 'string' || !m.sources[k]) { fail(path, tl('source inconnue : {0}', String(k).slice(0, 40))); return undefined; }
    return list.length === 1 ? list[0] : list;
  };

  // Limites : courant d'une LED (mA), puissance d'une résistance (W) ; src cite les sources.
  m.limits = {};
  if (raw.limits != null && keys(raw.limits, 'part.limits', ['current', 'power', 'src'])) {
    for (const [k, hi] of [['current', 5000], ['power', 100]]) {
      const l = raw.limits[k]; if (l == null) continue;
      const p = `part.limits.${k}`;
      if (!keys(l, p, ['warn', 'max'])) continue;
      const max = number(l.max, `${p}.max`, 0.001, hi, { req: true }), warn = number(l.warn, `${p}.warn`, 0.001, hi);
      if (max != null && warn != null && warn > max) fail(p, tl('warn doit rester sous max'));
      if (max != null) m.limits[k] = { ...(warn != null && { warn }), max };
    }
    if (raw.limits.src != null) m.limits.src = cite(raw.limits.src, 'part.limits.src', tl('limites'));
    if ((m.limits.current || m.limits.power) && m.limits.src == null) cite(null, 'part.limits.src', tl('limites'));
  }
  if (raw.ma != null) {
    m.ma = number(raw.ma, 'part.ma', 0, 5000);
    if (m.ma != null) m.ds = cite(raw.ds ?? m.limits.src, 'part.ds', tl('consommation ma'));
  } else if (raw.ds != null) fail('part.ds', tl('sans ma, pas de source de consommation'));

  // Broches.
  const pins = arr(raw.pins, 'part.pins', 64);
  if (!pins.length) fail('part.pins', tl('au moins une broche'));
  const names = new Set();
  m.pins = [];
  pins.forEach((p, i) => {
    const path = `part.pins[${i}]`;
    if (!keys(p, path, ['name', 'x', 'y', 'z', 'kind', 'need', 'role', 'why', 'v', 'ds', 'via', 'pull', 'opt', 'when', 'switch', 'lv5', 'lv3', 'idle'])) return;
    const q = { name: str(p.name, `${path}.name`, 16, { req: true, re: PIN_NAME }) };
    if (q.name && names.has(q.name)) fail(`${path}.name`, tl('broche en double : {0}', q.name));
    if (q.name) names.add(q.name);
    for (const k of ['x', 'y', 'z']) q[k] = number(p[k], `${path}.${k}`, -300, 300, { req: true });
    q.kind = oneOf(p.kind, `${path}.kind`, PIN_KINDS, true);
    if (q.kind === 'io') q.need = oneOf(p.need, `${path}.need`, NEEDS, true);
    else if (p.need != null) fail(`${path}.need`, tl('seulement pour une broche io'));
    const role = str(p.role, `${path}.role`, 40), why = str(p.why, `${path}.why`, 400);
    if (role) q.role = role; if (why) q.why = why;
    if (p.v != null) {
      if (q.kind !== 'pwr') fail(`${path}.v`, tl('seulement pour une alimentation'));
      else if (p.v === 'logic') q.v = 'logic';
      else if (Array.isArray(p.v) && p.v.length === 2 && p.v.every(x => num(x) && x >= 0 && x <= 60) && p.v[0] <= p.v[1]) {
        q.v = [p.v[0], p.v[1]];
        q.ds = cite(p.ds ?? m.limits.src, `${path}.ds`, tl('tension v'));
      } else fail(`${path}.v`, tl('« logic » ou [min, max] en volts attendu'));
    } else if (q.kind === 'pwr') fail(`${path}.v`, tl('obligatoire pour une alimentation'));
    if (p.ds != null && !Array.isArray(q.v)) fail(`${path}.ds`, tl('seulement avec une tension v chiffrée'));
    if (p.via != null) { if (q.kind === 'io' || q.kind === 'gnd') q.via = oneOf(p.via, `${path}.via`, RESISTORS); else fail(`${path}.via`, tl('seulement pour io ou gnd')); }
    if (p.pull != null) { if (q.kind === 'io') q.pull = oneOf(p.pull, `${path}.pull`, RESISTORS); else fail(`${path}.pull`, tl('seulement pour io')); }
    for (const k of ['opt', 'switch', 'lv5', 'lv3']) { const b = bool(p[k], `${path}.${k}`); if (b) q[k] = true; }
    if (p.idle != null) q.idle = oneOf(p.idle, `${path}.idle`, [0, 1]);
    if (p.when != null) q.when = arr(p.when, `${path}.when`, 8).map((w, j) => str(w, `${path}.when[${j}]`, 16, { req: true, re: PIN_NAME })).filter(Boolean);
    m.pins.push(q);
  });
  m.pins.forEach((q, i) => (q.when || []).forEach(w => { if (!names.has(w)) fail(`part.pins[${i}].when`, tl('broche inconnue : {0}', w)); }));
  const pinOf = name => m.pins.find(q => q.name === name);
  const pin = (v, path, req = true) => { const s = str(v, path, 16, { req, re: PIN_NAME }); if (s && !pinOf(s)) { fail(path, tl('broche inconnue : {0}', s)); return undefined; } return s; };

  // Comportement déclaratif : aucune formule, aucun code ; des pins, des nombres et des grandeurs connues.
  m.behaviour = {};
  if (raw.behaviour != null && keys(raw.behaviour, 'part.behaviour', ['load', 'led', 'analogOut', 'digitalOut', 'pulseOut', 'i2c', 'spi', 'sample'])) {
    const B = raw.behaviour;
    if (B.load != null && keys(B.load, 'part.behaviour.load', ['pin', 'to', 'ohms'])) {
      const g = m.pins.find(q => q.kind === 'gnd');
      const L = { pin: pin(B.load.pin, 'part.behaviour.load.pin'), to: B.load.to != null ? pin(B.load.to, 'part.behaviour.load.to') : g && g.name, ohms: number(B.load.ohms, 'part.behaviour.load.ohms', 0.01, 1e9, { req: true }) };
      if (!L.to) fail('part.behaviour.load.to', tl('obligatoire (aucune masse)'));
      else if (L.pin && L.pin === L.to) fail('part.behaviour.load.to', tl('deux broches différentes'));
      if (L.pin && L.to && L.ohms) m.behaviour.load = L;
    }
    if (B.led != null && keys(B.led, 'part.behaviour.led', ['anode', 'cathode', 'color', 'vf'])) {
      const L = { anode: pin(B.led.anode, 'part.behaviour.led.anode'), cathode: pin(B.led.cathode, 'part.behaviour.led.cathode'), vf: number(B.led.vf, 'part.behaviour.led.vf', 0.5, 5, { req: true }) };
      const c = B.led.color ?? 'red';
      if (typeof c === 'string' && (LED_COLORS[c] || COLOR.test(c))) L.color = c; else fail('part.behaviour.led.color', tl('couleur invalide'));
      if (L.anode && L.anode === L.cathode) fail('part.behaviour.led.cathode', tl('deux broches différentes'));
      if (L.anode && L.cathode && L.vf) m.behaviour.led = L;
    }
    if (m.behaviour.load && m.behaviour.led) fail('part.behaviour', tl('une LED ou une charge, pas les deux'));
    const outs = new Set();
    const quantity = (v, path, bool) => { const q = oneOf(v, path, Object.keys(QUANT), true); if (q && !bool && QUANT[q].bool) { fail(path, tl('grandeur tout-ou-rien : utilisez digitalOut')); return undefined; } return q; };
    const list = v => (Array.isArray(v) ? v : v == null ? [] : [v]);
    const pair = (v, path, lo, hi) => (Array.isArray(v) && v.length === 2 && v.every(x => num(x) && x >= lo && x <= hi) && v[0] !== v[1] ? [v[0], v[1]] : (fail(path, tl('[a, b] attendu, entre {0} et {1}', lo, hi)), undefined));
    const out = (o, path) => { const p = pin(o.pin, `${path}.pin`); if (p && outs.has(p)) fail(`${path}.pin`, tl('sortie en double : {0}', p)); if (p) outs.add(p); return p; };
    m.behaviour.analogOut = list(B.analogOut).slice(0, 8).map((o, i) => {
      const path = `part.behaviour.analogOut[${i}]`;
      if (!keys(o, path, ['pin', 'quantity', 'from', 'to', 'ratio', 'curve'])) return null;
      const A = { pin: out(o, path), quantity: quantity(o.quantity, `${path}.quantity`) };
      const Q = A.quantity && QUANT[A.quantity];
      A.from = pair(o.from ?? (Q ? [Q.min, Q.max] : null), `${path}.from`, -1e6, 1e6);
      A.ratio = bool(o.ratio, `${path}.ratio`) || false;
      A.to = pair(o.to, `${path}.to`, 0, A.ratio ? 1 : 60);
      if (o.curve != null) {
        const pts = arr(o.curve, `${path}.curve`, 64);
        const c = pts.map((x, j) => (Array.isArray(x) && x.length === 2 && x.every(num) ? [x[0], x[1]] : (fail(`${path}.curve[${j}]`, tl('[grandeur, sortie] attendu')), null))).filter(Boolean);
        if (c.some((x, j) => j && x[0] <= c[j - 1][0])) fail(`${path}.curve`, tl('grandeurs strictement croissantes attendues'));
        if (A.to && c.some(x => x[1] < Math.min(...A.to) - 1e-9 || x[1] > Math.max(...A.to) + 1e-9)) fail(`${path}.curve`, tl('sorties hors de la plage to'));
        if (c.length >= 2) A.curve = c; else fail(`${path}.curve`, tl('au moins deux points'));
      }
      return A.pin && A.quantity && A.from && A.to ? A : null;
    }).filter(Boolean);
    m.behaviour.digitalOut = list(B.digitalOut).slice(0, 8).map((o, i) => {
      const path = `part.behaviour.digitalOut[${i}]`;
      if (!keys(o, path, ['pin', 'quantity', 'threshold', 'activeLow'])) return null;
      const D = { pin: out(o, path), quantity: quantity(o.quantity, `${path}.quantity`, true), activeLow: bool(o.activeLow, `${path}.activeLow`) || false };
      if (D.quantity && !QUANT[D.quantity].bool) D.threshold = number(o.threshold, `${path}.threshold`, -1e6, 1e6, { req: true });
      return D.pin && D.quantity && (QUANT[D.quantity].bool || D.threshold != null) ? D : null;
    }).filter(Boolean);
    // Impulsions : fréquence proportionnelle à une grandeur (débitmètre, anémomètre), comptée par une interruption.
    m.behaviour.pulseOut = list(B.pulseOut).slice(0, 4).map((o, i) => {
      const path = `part.behaviour.pulseOut[${i}]`;
      if (!keys(o, path, ['pin', 'quantity', 'hzPer', 'curve'])) return null;
      const P = { pin: out(o, path), quantity: quantity(o.quantity, `${path}.quantity`) };
      if (o.curve != null) {
        const c = arr(o.curve, `${path}.curve`, 64).map((x, j) => (Array.isArray(x) && x.length === 2 && x.every(num) && x[1] >= 0 && x[1] <= 1e5 ? [x[0], x[1]] : (fail(`${path}.curve[${j}]`, tl('[grandeur, fréquence en Hz] attendu')), null))).filter(Boolean);
        if (c.some((x, j) => j && x[0] <= c[j - 1][0])) fail(`${path}.curve`, tl('grandeurs strictement croissantes attendues'));
        if (c.length >= 2) P.curve = c; else fail(`${path}.curve`, tl('au moins deux points'));
      } else P.hzPer = number(o.hzPer, `${path}.hzPer`, 0.0001, 1e5, { req: true });
      return P.pin && P.quantity && (P.curve || P.hzPer) ? P : null;
    }).filter(Boolean);
    for (const o of [...m.behaviour.analogOut, ...m.behaviour.digitalOut]) {
      const q = pinOf(o.pin);
      if (q && !(q.kind === 'io' && ['in', 'adc', 'io'].includes(q.need))) fail('part.behaviour', tl('la sortie {0} doit être une broche io (in, adc ou io)', o.pin));
    }
    for (const o of m.behaviour.pulseOut) {
      const q = pinOf(o.pin);
      if (q && !(q.kind === 'io' && ['irq', 'in', 'io'].includes(q.need))) fail('part.behaviour', tl('la sortie à impulsions {0} doit être une broche io (irq conseillé : broche à interruption)', o.pin));
    }
    // Valeur codée sur un bus : grandeur → brut = arrondi(grandeur × scale + offset), bits, signe, décalage, ordre des octets.
    const byteList = (v, path, max) => arr(v, path, max).map((b, j) => (Number.isInteger(b) && b >= 0 && b <= 255 ? b : (fail(`${path}[${j}]`, tl('octet 0 à 255 attendu')), 0)));
    const item = (o, path, { crc = false, at = null } = {}) => {
      const extra = at != null ? ['at'] : [];
      if (o && o.crc != null) {
        if (!crc) { fail(path, tl('CRC seulement dans une réponse ou une trame')); return null; }
        if (!keys(o, path, ['crc'])) return null;
        return o.crc === 'sensirion' ? { crc: 'sensirion' } : (fail(`${path}.crc`, tl('« sensirion » attendu')), null);
      }
      if (o && o.bytes != null) {
        if (!keys(o, path, ['bytes', ...extra])) return null;
        const b = byteList(o.bytes, `${path}.bytes`, 32);
        return b.length ? { bytes: b } : (fail(`${path}.bytes`, tl('au moins un octet')), null);
      }
      if (!keys(o, path, ['quantity', 'bits', 'signed', 'scale', 'offset', 'shift', 'endian', ...extra])) return null;
      const V = { quantity: oneOf(o.quantity, `${path}.quantity`, Object.keys(QUANT), true) };
      V.bits = o.bits == null ? 16 : oneOf(o.bits, `${path}.bits`, [8, 16, 24, 32]);
      if (bool(o.signed, `${path}.signed`)) V.signed = true;
      V.scale = o.scale == null ? 1 : number(o.scale, `${path}.scale`, -1e9, 1e9, { req: true });
      if (V.scale === 0) fail(`${path}.scale`, tl('ne peut pas valoir 0'));
      if (o.offset != null) V.offset = number(o.offset, `${path}.offset`, -1e12, 1e12);
      if (o.shift != null) V.shift = number(o.shift, `${path}.shift`, 0, 7, { int: true });
      if (o.endian != null) V.endian = oneOf(o.endian, `${path}.endian`, ['big', 'little']);
      return V.quantity && V.bits ? V : null;
    };
    const regs = (v, path, maxAt) => arr(v, path, 64).map((o, j) => {
      const at = number(o && o.at, `${path}[${j}].at`, 0, maxAt, { int: true, req: true }), it = o ? item(o, `${path}[${j}]`, { at }) : null;
      return it && at != null ? { at, ...it } : null;
    }).filter(Boolean);
    const busPin = (need, why) => { const q = m.pins.find(p => p.kind === 'io' && p.need === need); if (!q) fail('part.pins', tl('{0} : une broche io « {1} » est nécessaire', why, need)); return q; };
    if (B.i2c != null && keys(B.i2c, 'part.behaviour.i2c', ['address', 'alt', 'addressPin', 'regBytes', 'regSize', 'registers', 'commands'])) {
      const I = B.i2c, path = 'part.behaviour.i2c';
      busPin('sda', 'I2C'); busPin('scl', 'I2C');
      const S = { address: number(I.address, `${path}.address`, 0x03, 0x77, { int: true, req: true }), regBytes: I.regBytes == null ? 1 : oneOf(I.regBytes, `${path}.regBytes`, [1, 2]) };
      if (I.regSize != null) S.regSize = oneOf(I.regSize, `${path}.regSize`, [1, 2, 4]);
      if (I.alt != null) S.alt = number(I.alt, `${path}.alt`, 0x03, 0x77, { int: true });
      if (I.addressPin != null) { S.addressPin = pin(I.addressPin, `${path}.addressPin`); if (S.alt == null) fail(`${path}.alt`, tl('obligatoire avec addressPin')); }
      S.registers = regs(I.registers, `${path}.registers`, S.regBytes === 2 ? 0xffff : 0xff);
      S.commands = arr(I.commands, `${path}.commands`, 16).map((c, j) => {
        const p2 = `${path}.commands[${j}]`;
        if (!keys(c, p2, ['write', 'reply'])) return null;
        const w = byteList(c.write, `${p2}.write`, 4), r = arr(c.reply, `${p2}.reply`, 24).map((x, k) => item(x, `${p2}.reply[${k}]`, { crc: true })).filter(Boolean);
        if (!w.length) fail(`${p2}.write`, tl('au moins un octet'));
        if (!r.length) fail(`${p2}.reply`, tl('au moins un élément'));
        return w.length && r.length ? { write: w, reply: r } : null;
      }).filter(Boolean);
      if (!S.registers.some(r => r.quantity) && !S.commands.some(c => c.reply.some(x => x.quantity))) fail(path, tl('aucune mesure : déclarez un registre ou une commande qui rend une grandeur'));
      if (S.address) m.behaviour.i2c = S;
    }
    if (B.spi != null && keys(B.spi, 'part.behaviour.spi', ['mode', 'cs', 'frame', 'registers', 'readBit', 'readWhenSet', 'addrMask'])) {
      const P2 = B.spi, path = 'part.behaviour.spi';
      busPin('sck', 'SPI'); busPin('miso', 'SPI');
      const S = { mode: oneOf(P2.mode, `${path}.mode`, ['frame', 'register'], true), cs: pin(P2.cs, `${path}.cs`) };
      const csq = S.cs && pinOf(S.cs);
      if (csq && !(csq.kind === 'io' && csq.need === 'ss')) fail(`${path}.cs`, tl('la broche de sélection doit être io, need « ss »'));
      if (S.mode === 'frame') {
        S.frame = arr(P2.frame, `${path}.frame`, 24).map((x, k) => item(x, `${path}.frame[${k}]`, { crc: true })).filter(Boolean);
        if (!S.frame.some(x => x.quantity)) fail(`${path}.frame`, tl('aucune mesure dans la trame'));
      } else if (S.mode === 'register') {
        busPin('mosi', 'SPI');
        S.registers = regs(P2.registers, `${path}.registers`, 0xff);
        S.readBit = P2.readBit == null ? 0x80 : number(P2.readBit, `${path}.readBit`, 0, 255, { int: true });
        S.readWhenSet = P2.readWhenSet == null ? true : !!bool(P2.readWhenSet, `${path}.readWhenSet`);
        S.addrMask = P2.addrMask == null ? 0x7f : number(P2.addrMask, `${path}.addrMask`, 1, 255, { int: true });
        if (!S.registers.some(r => r.quantity)) fail(`${path}.registers`, tl('aucune mesure : déclarez un registre qui rend une grandeur'));
      }
      if (S.mode && S.cs) m.behaviour.spi = S;
    }
    if (B.sample != null && keys(B.sample, 'part.behaviour.sample', ['period', 'tau'])) {
      m.behaviour.sample = { period: number(B.sample.period ?? 0.2, 'part.behaviour.sample.period', 0.02, 10), tau: number(B.sample.tau ?? 0.3, 'part.behaviour.sample.tau', 0, 60) };
    }
    if (!m.behaviour.analogOut.length) delete m.behaviour.analogOut;
    if (!m.behaviour.digitalOut.length) delete m.behaviour.digitalOut;
    if (!m.behaviour.pulseOut.length) delete m.behaviour.pulseOut;
  }

  // Documentation.
  if (raw.docs != null && keys(raw.docs, 'part.docs', ['text', 'specs', 'uses', 'mistakes'])) {
    const d = {};
    const t = str(raw.docs.text, 'part.docs.text', 2000); if (t) d.text = t;
    d.specs = arr(raw.docs.specs, 'part.docs.specs', 24).map((r, i) => (Array.isArray(r) && r.length === 2 ? [str(r[0], `part.docs.specs[${i}][0]`, 60, { req: true }), str(r[1], `part.docs.specs[${i}][1]`, 200, { req: true })] : (fail(`part.docs.specs[${i}]`, tl('[libellé, valeur] attendu')), null))).filter(r => r && r[0] && r[1]);
    for (const k of ['uses', 'mistakes']) d[k] = arr(raw.docs[k], `part.docs.${k}`, 12).map((x, i) => str(x, `part.docs.${k}[${i}]`, 300, { req: true })).filter(Boolean);
    for (const k of ['specs', 'uses', 'mistakes']) if (!d[k].length) delete d[k];
    m.docs = d;
  }

  // Apparence 3D : modèle .glb, dessin SVG, ou forme simple dessinée par l'application.
  m.look = { kind: 'module' };
  if (raw.look != null && keys(raw.look, 'part.look', ['kind', 'color', 'label', 'bands', 'size'])) {
    const L = { kind: oneOf(raw.look.kind ?? 'module', 'part.look.kind', LOOKS, true) || 'module' };
    if (raw.look.color != null) { if (typeof raw.look.color === 'string' && COLOR.test(raw.look.color)) L.color = raw.look.color; else fail('part.look.color', tl('couleur #rrggbb attendue')); }
    const lab = str(raw.look.label, 'part.look.label', 24); if (lab) L.label = lab;
    if (raw.look.bands != null) L.bands = arr(raw.look.bands, 'part.look.bands', 5).map((b, i) => (Number.isInteger(b) && b >= 0 && b <= 9) || b === 'g' ? b : (fail(`part.look.bands[${i}]`, tl('chiffre 0 à 9 ou « g »')), 0));
    if (raw.look.size != null) { const s = raw.look.size; if (Array.isArray(s) && s.length === 3 && s.every(x => num(x) && x >= 1 && x <= 300)) L.size = [s[0], s[1], s[2]]; else fail('part.look.size', tl('[largeur, hauteur, profondeur] en mm attendu')); }
    m.look = L;
  }
  return errors.length ? { ok: false, errors } : { ok: true, manifest: m };
}

/* ---------- Symbole du schéma ---------- */
const DIRS = ['l', 'r', 'u', 'd'];
/** Vérifie symbol.json : traits, rectangles, cercles, arcs, textes (mm, y vers le bas) et ancres des broches. */
export function validateSymbol(raw, pinNames = null) {
  const errors = [];
  if (!isObj(raw)) return { ok: false, errors: [tl('symbol.json : objet attendu')] };
  scan(raw, 'symbol', errors);
  if (errors.length) return { ok: false, errors };
  const { fail, keys, str, number, bool, oneOf, arr } = reader(errors);
  keys(raw, 'symbol', ['format', 'lines', 'rects', 'circles', 'arcs', 'texts', 'pins']);
  if (raw.format != null && raw.format !== FORMAT) fail('symbol.format', tl('format {0} attendu', FORMAT));
  const C = 300, coord = (v, p) => number(v, p, -C, C, { req: true }), w = (v, p) => number(v ?? 0.25, p, 0.05, 2);
  let count = 0;
  const lim = (list, name) => { const l = arr(list, `symbol.${name}`, 2000); count += l.length; return l; };
  const s = { format: FORMAT };
  s.lines = lim(raw.lines, 'lines').map((l, i) => {
    const p = `symbol.lines[${i}]`; if (!keys(l, p, ['pts', 'w', 'close', 'fill'])) return null;
    const pts = arr(l.pts, `${p}.pts`, 400).map((q, j) => (Array.isArray(q) && q.length === 2 ? [coord(q[0], `${p}.pts[${j}]`), coord(q[1], `${p}.pts[${j}]`)] : (fail(`${p}.pts[${j}]`, tl('[x, y] attendu')), null))).filter(q => q && q.every(num));
    if (pts.length < 2) { fail(`${p}.pts`, tl('au moins deux points')); return null; }
    return { pts, w: w(l.w, `${p}.w`), close: bool(l.close, `${p}.close`) || false, fill: bool(l.fill, `${p}.fill`) || false };
  }).filter(Boolean);
  s.rects = lim(raw.rects, 'rects').map((r, i) => {
    const p = `symbol.rects[${i}]`; if (!keys(r, p, ['x', 'y', 'w', 'h', 'lw', 'fill'])) return null;
    return { x: coord(r.x, `${p}.x`), y: coord(r.y, `${p}.y`), w: number(r.w, `${p}.w`, -C, C, { req: true }), h: number(r.h, `${p}.h`, -C, C, { req: true }), lw: w(r.lw, `${p}.lw`), fill: bool(r.fill, `${p}.fill`) || false };
  }).filter(Boolean);
  s.circles = lim(raw.circles, 'circles').map((c, i) => {
    const p = `symbol.circles[${i}]`; if (!keys(c, p, ['x', 'y', 'r', 'w', 'fill'])) return null;
    return { x: coord(c.x, `${p}.x`), y: coord(c.y, `${p}.y`), r: number(c.r, `${p}.r`, 0.05, C, { req: true }), w: w(c.w, `${p}.w`), fill: bool(c.fill, `${p}.fill`) || false };
  }).filter(Boolean);
  s.arcs = lim(raw.arcs, 'arcs').map((a, i) => {
    const p = `symbol.arcs[${i}]`; if (!keys(a, p, ['x', 'y', 'r', 'a0', 'a1', 'w'])) return null;
    return { x: coord(a.x, `${p}.x`), y: coord(a.y, `${p}.y`), r: number(a.r, `${p}.r`, 0.05, C, { req: true }), a0: number(a.a0, `${p}.a0`, -20, 20, { req: true }), a1: number(a.a1, `${p}.a1`, -20, 20, { req: true }), w: w(a.w, `${p}.w`) };
  }).filter(Boolean);
  s.texts = lim(raw.texts, 'texts').map((t, i) => {
    const p = `symbol.texts[${i}]`; if (!keys(t, p, ['x', 'y', 't', 's', 'a'])) return null;
    return { x: coord(t.x, `${p}.x`), y: coord(t.y, `${p}.y`), t: str(t.t, `${p}.t`, 60, { req: true }), s: number(t.s ?? 1.6, `${p}.s`, 0.5, 10), a: oneOf(t.a ?? 'm', `${p}.a`, ['l', 'm', 'r']) };
  }).filter(Boolean);
  if (count > 4000) fail('symbol', tl('dessin trop chargé'));
  s.pins = {};
  if (!isObj(raw.pins) || !Object.keys(raw.pins).length) fail('symbol.pins', tl('au moins une broche'));
  else for (const [k, q] of Object.entries(raw.pins).slice(0, 64)) {
    const p = `symbol.pins.${k}`;
    if (!PIN_NAME.test(k)) { fail(p, tl('nom de broche invalide')); continue; }
    if (pinNames && !pinNames.includes(k)) { fail(p, tl('broche inconnue : {0}', k)); continue; }
    if (!keys(q, p, ['x', 'y', 'dir'])) continue;
    s.pins[k] = { x: coord(q.x, `${p}.x`), y: coord(q.y, `${p}.y`), dir: oneOf(q.dir, `${p}.dir`, DIRS, true) };
  }
  return errors.length ? { ok: false, errors } : { ok: true, symbol: s };
}

/* ---------- Archive .jpart ---------- */
const GLB_MAGIC = 0x46546c67; // « glTF »
/** Un fichier glTF binaire (version 2), de la longueur annoncée par son en-tête. */
export function isGlb(u8) {
  if (!(u8 instanceof Uint8Array) || u8.length < 20) return false;
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return v.getUint32(0, true) === GLB_MAGIC && v.getUint32(4, true) === 2 && v.getUint32(8, true) <= u8.length;
}
const fail = msg => { throw new Error(msg); };

/**
 * Archive .jpart (octets) d'un composant : { manifest, glb?, symbol?, svg? }. Le manifeste et le symbole sont
 * vérifiés ; une erreur décrit le premier problème.
 */
export function packJpart({ manifest, glb = null, symbol = null, svg = null }) {
  const v = validateManifest(manifest);
  if (!v.ok) fail(v.errors.join('\n'));
  const files = { 'part.json': strToU8(JSON.stringify(v.manifest, null, 1)) };
  if (glb) { if (!isGlb(glb)) fail(tl('model.glb : fichier glTF binaire attendu')); files['model.glb'] = [glb, { level: 0 }]; }
  if (v.manifest.look.kind === 'glb' && !glb) fail(tl('apparence « glb » sans model.glb'));
  if (v.manifest.look.kind === 'svg' && !svg) fail(tl('apparence « svg » sans look.svg'));
  if (symbol) { const s = validateSymbol(symbol, v.manifest.pins.map(p => p.name)); if (!s.ok) fail(s.errors.join('\n')); files['symbol.json'] = strToU8(JSON.stringify(s.symbol)); }
  if (svg) files['look.svg'] = strToU8(sanitizeSvg(svg));
  const out = zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') });
  if (out.length > LIMITS.zip) fail(tl('paquet trop lourd ({0} Mo au plus)', LIMITS.zip / 1048576));
  return out;
}

/**
 * Lit une archive .jpart (octets) : { manifest, glb, symbol, svg } vérifiés. Refuse une archive trop lourde, un
 * fichier inconnu ou trop gros (y compris une « bombe » de compression : les tailles sont bornées avant de
 * décompresser), un manifeste ou un symbole invalides.
 */
export function unpackJpart(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length > LIMITS.zip) fail(tl('paquet trop lourd ({0} Mo au plus)', LIMITS.zip / 1048576));
  if (u8.length < 22 || u8[0] !== 0x50 || u8[1] !== 0x4b) fail(tl('ce fichier n’est pas un paquet .jpart (zip)'));
  const bad = [];
  let total = 0, files;
  try {
    files = unzipSync(u8, {
      filter: e => {
        if (!ENTRIES.includes(e.name)) { bad.push(tl('fichier inattendu : {0}', cleanText(e.name, 60))); return false; }
        if (e.originalSize > LIMITS[e.name]) { bad.push(tl('{0} trop lourd', e.name)); return false; }
        total += e.originalSize;
        if (total > LIMITS.total) { bad.push(tl('contenu trop lourd')); return false; }
        return true;
      }
    });
  } catch (e) { fail(tl('archive illisible : {0}', e.message || e)); }
  if (bad.length) fail(bad.join('\n'));
  if (!files['part.json']) fail(tl('part.json manquant'));
  for (const [k, f] of Object.entries(files)) if (f.length > LIMITS[k]) fail(tl('{0} trop lourd', k));
  let raw;
  try { raw = JSON.parse(strFromU8(files['part.json'])); } catch (e) { fail(tl('part.json illisible : {0}', e.message || e)); }
  const v = validateManifest(raw);
  if (!v.ok) fail(v.errors.join('\n'));
  const out = { manifest: v.manifest, glb: null, symbol: null, svg: null };
  if (files['model.glb']) { if (!isGlb(files['model.glb'])) fail(tl('model.glb : fichier glTF binaire attendu')); out.glb = files['model.glb']; }
  if (files['symbol.json']) {
    let s; try { s = JSON.parse(strFromU8(files['symbol.json'])); } catch (e) { fail(tl('symbol.json illisible : {0}', e.message || e)); }
    const r = validateSymbol(s, v.manifest.pins.map(p => p.name)); if (!r.ok) fail(r.errors.join('\n'));
    out.symbol = r.symbol;
  }
  if (files['look.svg']) out.svg = sanitizeSvg(strFromU8(files['look.svg']));
  if (out.manifest.look.kind === 'glb' && !out.glb) fail(tl('apparence « glb » sans model.glb'));
  if (out.manifest.look.kind === 'svg' && !out.svg) fail(tl('apparence « svg » sans look.svg'));
  return out;
}

/** Base64 (stockage dans la bibliothèque personnelle et dans les projets). */
export function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
export function fromB64(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

/* ---------- Conversion vers les tables de l'application ---------- */
/** Clé d'une source du paquet dans SOURCES : préfixée par le type, sans collision avec la bibliothèque. */
const srcKey = (id, k) => `${id}:${k}`;
const ns = (id, s) => (s == null ? undefined : Array.isArray(s) ? s.map(k => srcKey(id, k)) : srcKey(id, s));
/** Texte du paquet : traduit s'il reprend mot pour mot un texte de l'application, tel quel sinon. */
const T = s => (s == null ? s : tl(s));

/** Fiche de câblage (forme de PARTS) : les pattes passives n'y figurent pas (comme une résistance). */
export function specOf(m) {
  const pins = m.pins.filter(p => p.kind !== 'passive').map(p => {
    const o = { pin: p.name, kind: p.kind };
    if (p.need) o.need = p.need;
    if (p.role) o.role = T(p.role);
    if (p.why) o.why = T(p.why);
    if (p.v != null) o.v = p.v;
    if (p.ds != null) o.ds = ns(m.id, p.ds);
    for (const k of ['via', 'pull', 'opt', 'when', 'switch', 'lv5', 'lv3', 'idle']) if (p[k] != null) o[k] = p[k];
    return o;
  });
  const spec = { what: T(m.description) || T(m.name), pkg: m.id };
  if (pins.length) spec.pins = pins;
  if (m.ma != null) { spec.ma = m.ma; spec.ds = ns(m.id, m.ds); }
  return spec;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Sortie (entre to[0] et to[1]) d'une sortie analogique pour la grandeur q : courbe par points, sinon droite. */
export function analogValue(o, q) {
  if (o.curve) {
    const c = o.curve;
    if (q <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) if (q <= c[i][0]) { const [x0, y0] = c[i - 1], [x1, y1] = c[i]; return y0 + (y1 - y0) * (q - x0) / (x1 - x0); }
    return c[c.length - 1][1];
  }
  const [a, b] = o.from, t = clamp((q - a) / (b - a), 0, 1);
  return o.to[0] + (o.to[1] - o.to[0]) * t;
}
const fmt = (v, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace('.', DEC);

/** Grandeurs lues sur un bus (I2C, SPI) : celles des registres, des réponses et des trames. */
export function busQuantities(B) {
  const items = [...((B.i2c && B.i2c.registers) || []), ...((B.i2c && B.i2c.commands) || []).flatMap(c => c.reply), ...((B.spi && (B.spi.frame || B.spi.registers)) || [])];
  return [...new Set(items.filter(x => x.quantity).map(x => x.quantity))];
}
/** Modèle de capteur (forme de MODELS) pour les sorties déclarées (analogiques, tout-ou-rien, impulsions, bus), ou null. */
export function modelOf(m) {
  const B = m.behaviour || {}, A = B.analogOut || [], D = B.digitalOut || [], PU = B.pulseOut || [], BQ = busQuantities(B);
  if (!A.length && !D.length && !PU.length && !BQ.length) return null;
  const q = [...new Set([...A, ...D, ...PU].map(o => o.quantity).concat(BQ))];
  return {
    q, period: (B.sample && B.sample.period) || 0.2, tau: B.sample && B.sample.tau != null ? B.sample.tau : 0.3, pkg: m.id,
    read(phy, cx) {
      const out = {}, parts = [], sup = cx.v || (cx.prof ? cx.prof.logic : 5);
      let warn = null, short = null;
      for (const o of A) {
        const y = analogValue(o, +phy[o.quantity]), v = o.ratio ? sup * y : Math.min(y, sup);
        out[o.pin] = { v };
        const pr = cx.prof, max = pr ? 2 ** (pr.adcRead || pr.adcBits) - 1 : 0, raw = pr ? clamp(Math.round(v / pr.vref * max), 0, max) : null;
        parts.push(raw != null ? `${o.pin} ${raw} · ${fmt(v)} V` : `${o.pin} ${fmt(v)} V`);
        if (short == null) short = `${m.prefix} ${raw ?? fmt(v)}`;
        if (pr && v > pr.vref + 0.05) warn = tl('{0} dépasse la plage de l’ADC ({1}) : valeur saturée, et la broche souffre', `${fmt(v)} V`, volts(pr.vref));
      }
      for (const o of D) {
        const x = phy[o.quantity], on = QUANT[o.quantity].bool ? !!x : +x > o.threshold, d = on !== o.activeLow ? 1 : 0;
        out[o.pin] = { d, v: d ? sup : 0 };
        parts.push(`${o.pin} ${d ? 'HIGH' : 'LOW'}`);
        if (short == null) short = `${m.prefix} ${d ? 'HIGH' : 'LOW'}`;
      }
      // Impulsions : la carte lit un signal carré à cette fréquence (digitalRead, attachInterrupt, pulseIn).
      for (const o of PU) {
        const hz = pulseHz(o, +phy[o.quantity]);
        out[o.pin] = { d: 0, v: 0, hz };
        parts.push(`${o.pin} ${fmt(hz, hz < 10 ? 1 : 0)} Hz`);
        if (short == null) short = `${m.prefix} ${fmt(hz, 0)} Hz`;
      }
      const fmtQ = k => { const Q = QUANT[k]; return Q.bool ? (phy[k] ? tl('oui') : tl('non')) : `${fmt(+phy[k], Q.dec || 0)}${Q.unit ? ' ' + Q.unit : ''}`; };
      if (BQ.length) { parts.push(BQ.map(fmtQ).join(' · ')); if (short == null) short = `${m.prefix} ${fmtQ(BQ[0])}`; }
      const detail = q.map(k => `${QUANT[k].label} : ${fmtQ(k)}`).join(' · ') + (B.i2c ? ` · I2C 0x${B.i2c.address.toString(16).toUpperCase()}` : B.spi ? ' · SPI' : '');
      // data : les grandeurs mesurées, codées par le module à chaque lecture du bus (sim/pkgbus.js).
      const DQ = [...new Set([...BQ, ...PU.map(o => o.quantity)])];
      const data = DQ.length ? Object.fromEntries(DQ.map(k => [k, QUANT[k].bool ? !!phy[k] : +phy[k]])) : undefined;
      return { value: parts.join(' · '), detail, short, warn, out, ...(data ? { data } : {}) };
    }
  };
}

/** Sorties d'un capteur pour le vérificateur (forme de SENSOR_OUT, check/states.js) : broche → [min, max, volts ?]. */
export function sensorOutOf(m) {
  const B = m.behaviour || {}, out = {};
  for (const o of B.analogOut || []) out[o.pin] = [Math.min(...o.to), Math.max(...o.to), !o.ratio];
  for (const o of B.digitalOut || []) out[o.pin] = [0, 1];
  for (const o of B.pulseOut || []) out[o.pin] = [0, 1];
  return Object.keys(out).length ? out : null;
}

/** Page de documentation (forme de DOCS) : caractéristiques, fonctionnement, limites citées. */
export function docOf(m) {
  const d = m.docs || {}, specs = (d.specs || []).map(([a, b]) => [T(a), T(b)]);
  const L = m.limits || {}, both = (l, u) => (l.warn != null ? tl('{0} conseillés, {1} au plus', `${String(l.warn).replace('.', DEC)} ${u}`, `${String(l.max).replace('.', DEC)} ${u}`) : tl('{0} au plus', `${String(l.max).replace('.', DEC)} ${u}`));
  if (L.current) specs.push([tl('Courant'), both(L.current, 'mA')]);
  if (L.power) specs.push([tl('Puissance'), both(L.power, 'W')]);
  for (const k of new Set([...srcList(L.src), ...srcList(m.ds), ...m.pins.flatMap(p => srcList(p.ds))])) {
    const s = m.sources[k]; if (s) specs.push([tl('Source'), `${s.title} (${s.publisher}), ${s.section}`]);
  }
  if (m.author) specs.push([tl('Auteur'), m.author]);
  if (m.license) specs.push([tl('Licence'), m.license]);
  return { specs, how: T(d.text), uses: (d.uses || []).map(T), mistakes: (d.mistakes || []).map(T) };
}

/**
 * Règles du programme (prog/rules.js) : une LED en paquet a les actions d'une LED ; un capteur en paquet, une mesure
 * par sortie déclarée (valeur lue sur sa broche analogique, ou état de sa sortie tout-ou-rien).
 */
export function signalsOf(m) {
  const B = m.behaviour || {}, out = {};
  const v = pin => `${pin.toLowerCase().replace(/[^a-z0-9]/g, '_')}`, opt = pin => { const q = m.pins.find(p => p.name === pin); return !!(q && q.opt); };
  for (const o of B.analogOut || []) out[o.pin] = { label: tl('{0} (valeur lue)', QUANT[o.quantity].label.toLowerCase()), adc: true, def: 0.5, v: v(o.pin), pin: o.pin, opt: opt(o.pin) };
  for (const o of B.digitalOut || []) out[o.pin] = { label: tl('{0} est actif', o.pin), neg: tl('{0} est au repos', o.pin), kind: 'bool', v: v(o.pin), pin: o.pin, low: o.activeLow, short: o.pin, opt: opt(o.pin) };
  // Impulsions : la grandeur (hz par unité), sinon la fréquence ; comptées par une interruption pendant 1 s.
  for (const o of B.pulseOut || []) {
    const Q = QUANT[o.quantity], key = o.hzPer && !out[o.quantity] ? o.quantity : o.pin;
    out[key] = o.hzPer
      ? { label: Q.label.toLowerCase(), unit: Q.unit, def: (Q.min + Q.max) / 2, range: [Q.min, Q.max], v: o.quantity, type: 'float', pulse: { pin: o.pin, hzPer: o.hzPer } }
      : { label: tl('fréquence de {0}', o.pin), unit: 'Hz', def: 10, range: [0, 1000], v: `${v(o.pin)}_hz`, type: 'float', pulse: { pin: o.pin, hzPer: 1 } };
  }
  // Bus : une mesure par grandeur, lue par le code généré (Wire ou SPI), sans bibliothèque.
  for (const k of busQuantities(B)) {
    const Q = QUANT[k];
    if (out[k]) continue;
    out[k] = Q.bool ? { label: Q.label.toLowerCase(), neg: tl('{0} : non', Q.label), kind: 'bool', v: k, bus: B.i2c ? 'i2c' : 'spi', quantity: k }
      : { label: Q.label.toLowerCase(), unit: Q.unit, def: (Q.min + Q.max) / 2, range: [Q.min, Q.max], v: k, type: 'float', bus: B.i2c ? 'i2c' : 'spi', quantity: k };
  }
  return Object.keys(out).length ? out : null;
}

/** Comportement électrique (sim/pkgparts.js). */
function behaviourOf(m) {
  const B = m.behaviour || {}, led = B.led && { ...B.led, color: LED_COLORS[B.led.color] || B.led.color };
  return {
    pins: m.pins.map(p => p.name), led: led || null, load: B.load ? { ...B.load } : null, limits: { current: m.limits.current || null, power: m.limits.power || null }, sensorOut: sensorOutOf(m),
    i2c: B.i2c || null, spi: B.spi || null, pulse: B.pulseOut || null
  };
}

/** Manifestes installés (type → manifeste) : la vérification en arrière-plan les reçoit pour les installer à son tour. */
export const INSTALLED = new Map();

/**
 * Installe le côté « simulation » d'un paquet vérifié : fiche de câblage, modèle de capteur, documentation,
 * sources et comportement électrique. Sans 3D : sert aussi au travailleur du vérificateur et aux tests.
 */
export function registerSim(m) {
  const t = m.id;
  unregisterSim(t);
  PARTS[t] = specOf(m);
  const model = modelOf(m); if (model) MODELS[t] = model;
  DOCS[t] = docOf(m);
  for (const [k, s] of Object.entries(m.sources || {})) SOURCES[srcKey(t, k)] = { ...s };
  PKG[t] = behaviourOf(m);
  const sig = signalsOf(m); if (sig) SIGNALS[t] = sig;
  if (m.behaviour.led) ACTIONS[t] = ACTIONS['led-red'];
  INSTALLED.set(t, m);
  return t;
}
export function unregisterSim(t) {
  const m = INSTALLED.get(t);
  if (m) for (const k of Object.keys(m.sources || {})) delete SOURCES[srcKey(t, k)];
  delete PARTS[t]; delete MODELS[t]; delete DOCS[t]; delete PKG[t]; delete SIGNALS[t]; delete ACTIONS[t];
  INSTALLED.delete(t);
}
