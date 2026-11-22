// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fichier STEP « physique » (ISO 10303-21, texte clair) : lecture et écriture du sous-ensemble dont l'IFC a besoin.
// Module pur, sans dépendance (lu par ifc.js et ifcwrite.js).
//
// Lecture : stepIndex(texte) repère l'en-tête (HEADER) et chaque instance de la section DATA (#id = TYPE(…);) sans
// analyser ses arguments ; ils le sont à la demande (get(id)), ce qui garde rapide un gros fichier dont on n'utilise
// qu'une partie. Valeurs rendues :
//   $ → null · * → DERIVED · nombre → number · 'texte' → string (décodé) · .ENUM. → { e: 'ENUM' } (aussi .T. .F. .U.)
//   #12 → { r: 12 } · (a, b) → [a, b] · IFCLABEL('x') → { t: 'IFCLABEL', v: 'x' } · "0AF" → { bin: '0AF' }
// Codage des chaînes, d'après la page « String Encoding & Decoding » de buildingSMART (qui renvoie à l'ISO 10303-21,
// payante) : caractères 32 à 126 tels quels, apostrophe doublée, \\ pour la barre oblique inverse, \S\c (code de c
// + 128, page ISO 8859-1 par défaut), \PA\ (choix de la page ISO 8859-x : seule la page A, latin-1, est suivie ;
// les autres sont lues comme latin-1, approximation dite), \X\hh (un octet ISO 10646 rangée 0), \X2\hhhh…\X0\
// (UTF-16), \X4\hhhhhhhh…\X0\ (points de code sur 32 bits).
// Écriture : stepWriter() numérote les instances et écrit les valeurs ; un nombre JS est un réel (toujours avec un
// point), INT(n) un entier, E('X') une énumération, ref(id) une référence, T('IFCLABEL', v) une valeur typée.

export const DERIVED = Object.freeze({ derived: true });

/* ---------- Lecture ---------- */
const isWs = c => c === 32 || c === 9 || c === 10 || c === 13;
const isUpper = c => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 45;

/** Octets ou texte → texte. Un fichier IFC est en ASCII (codages \X2\…) ; un UTF-8 brut est lu tel quel, sinon latin-1. */
export function stepText(src) {
  if (typeof src === 'string') return src;
  const u8 = src instanceof Uint8Array ? src : new Uint8Array(src);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return new TextDecoder('latin1').decode(u8); }
}

/** Erreur de lecture avec sa ligne. */
export class StepError extends Error {
  constructor(msg, s, at) { super(msg + (s != null && at != null ? ` (ligne ${lineOf(s, at)})` : '')); this.name = 'StepError'; }
}
function lineOf(s, at) { let n = 1; for (let i = 0; i < at && i < s.length; i++) if (s.charCodeAt(i) === 10) n++; return n; }

/** Passe les blancs et les commentaires à partir de i. */
function skip(s, i, end) {
  for (;;) {
    while (i < end && isWs(s.charCodeAt(i))) i++;
    if (s.charCodeAt(i) === 47 && s.charCodeAt(i + 1) === 42) { const j = s.indexOf('*/', i + 2); i = j < 0 ? end : j + 2; continue; }
    return i;
  }
}
/** Fin d'une chaîne qui commence à i (apostrophe) : index après l'apostrophe fermante. */
function strEnd(s, i, end) {
  for (let j = i + 1; j < end; j++) {
    if (s.charCodeAt(j) === 39) { if (s.charCodeAt(j + 1) === 39) { j++; continue; } return j + 1; }
  }
  throw new StepError('chaîne non fermée', s, i);
}
/** Index après la parenthèse fermante qui répond à celle de i. */
function closeParen(s, i, end) {
  let d = 0;
  for (let j = i; j < end; j++) {
    const c = s.charCodeAt(j);
    if (c === 39) { j = strEnd(s, j, end) - 1; continue; }
    if (c === 34) { const k = s.indexOf('"', j + 1); if (k < 0) break; j = k; continue; }
    if (c === 47 && s.charCodeAt(j + 1) === 42) { const k = s.indexOf('*/', j + 2); j = k < 0 ? end : k + 1; continue; }
    if (c === 40) d++;
    else if (c === 41 && --d === 0) return j + 1;
  }
  throw new StepError('parenthèse non fermée', s, i);
}

/** Décodage d'une chaîne STEP (sans les apostrophes). */
export function decodeString(raw) {
  if (raw.indexOf('\\') < 0) return raw.replace(/''/g, "'");
  let out = '';
  const s = raw.replace(/''/g, "'");
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c !== '\\') { out += c; i++; continue; }
    const n = s[i + 1];
    if (n === '\\') { out += '\\'; i += 2; continue; }
    if (n === 'S' && s[i + 2] === '\\' && i + 3 < s.length) { out += String.fromCharCode(s.charCodeAt(i + 3) + 128); i += 4; continue; }
    if (n === 'P' && s[i + 3] === '\\') { i += 4; continue; } // page ISO 8859-x : lue comme latin-1
    if (n === 'X' && s[i + 2] === '\\') { out += String.fromCharCode(parseInt(s.substr(i + 3, 2), 16) || 0); i += 5; continue; }
    if (n === 'X' && (s[i + 2] === '2' || s[i + 2] === '4') && s[i + 3] === '\\') {
      const w = s[i + 2] === '2' ? 4 : 8, j = s.indexOf('\\X0\\', i + 4), hex = s.slice(i + 4, j < 0 ? s.length : j);
      for (let k = 0; k + w <= hex.length; k += w) { const v = parseInt(hex.substr(k, w), 16); if (Number.isFinite(v)) out += w === 4 ? String.fromCharCode(v) : String.fromCodePoint(Math.min(v, 0x10ffff)); }
      i = j < 0 ? s.length : j + 4; continue;
    }
    if (n === 'N' && s[i + 2] === '\\') { out += '\n'; i += 3; continue; }
    out += c; i++;
  }
  return out;
}

/** Arguments d'une instance, du texte s[a] (après la parenthèse ouvrante) jusqu'à la parenthèse fermante. */
export function parseArgs(s, a, end = s.length) {
  let i = a;
  function value() {
    i = skip(s, i, end);
    const c = s.charCodeAt(i);
    if (c === 36) { i++; return null; } // $
    if (c === 42) { i++; return DERIVED; } // *
    if (c === 39) { const j = strEnd(s, i, end); const v = decodeString(s.slice(i + 1, j - 1)); i = j; return v; }
    if (c === 35) { let j = i + 1; while (j < end && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j++; const v = { r: +s.slice(i + 1, j) }; i = j; return v; }
    if (c === 46) { const j = s.indexOf('.', i + 1); const v = { e: s.slice(i + 1, j).toUpperCase() }; i = j + 1; return v; }
    if (c === 40) { i++; return list(); }
    if (c === 34) { const j = s.indexOf('"', i + 1); const v = { bin: s.slice(i + 1, j) }; i = j + 1; return v; }
    if (c === 45 || c === 43 || (c >= 48 && c <= 57)) {
      let j = i + 1; while (j < end && /[0-9.Ee+-]/.test(s[j])) j++;
      const v = +s.slice(i, j); i = j; return Number.isFinite(v) ? v : 0;
    }
    if (isUpper(c)) { // valeur typée : NOM(valeur)
      let j = i; while (j < end && isUpper(s.charCodeAt(j))) j++;
      const t = s.slice(i, j).toUpperCase(); i = skip(s, j, end);
      if (s.charCodeAt(i) !== 40) throw new StepError('valeur typée sans parenthèse', s, i);
      i++; const args = list();
      return { t, v: args.length === 1 ? args[0] : args };
    }
    throw new StepError(`caractère inattendu « ${s[i] || 'fin'} »`, s, i);
  }
  function list() { // après « ( » : valeurs jusqu'à « ) »
    const out = [];
    i = skip(s, i, end);
    if (s.charCodeAt(i) === 41) { i++; return out; }
    for (;;) {
      out.push(value());
      i = skip(s, i, end);
      const c = s.charCodeAt(i);
      if (c === 44) { i++; continue; }
      if (c === 41) { i++; return out; }
      throw new StepError('« , » ou « ) » attendu', s, i);
    }
  }
  return list();
}

/**
 * Index d'un fichier STEP : { schema: ['IFC4'], header: { FILE_DESCRIPTION: [...], FILE_NAME: [...], FILE_SCHEMA: [...] },
 * count, types: Map<TYPE, id[]>, get(id) → { id, type, args } | null, ofType(...types) → ids, byType() → { TYPE: n } }.
 * Lève StepError sur un fichier qui n'est pas du STEP (pas d'ISO-10303-21, pas de section DATA).
 */
export function stepIndex(src, { onProgress } = {}) {
  const s = stepText(src), end = s.length;
  let i = skip(s, 0, end);
  if (!s.startsWith('ISO-10303-21', i)) throw new StepError('ce fichier n’est pas un fichier STEP (ISO-10303-21 attendu au début)');
  const hs = s.indexOf('HEADER;', i), ds = s.indexOf('DATA;', i);
  if (ds < 0) throw new StepError('section DATA absente');
  const header = {};
  if (hs >= 0 && hs < ds) {
    let j = hs + 7;
    for (;;) {
      j = skip(s, j, ds);
      if (s.startsWith('ENDSEC', j) || j >= ds) break;
      let k = j; while (k < ds && isUpper(s.charCodeAt(k))) k++;
      const name = s.slice(j, k).toUpperCase(); k = skip(s, k, ds);
      if (s.charCodeAt(k) !== 40) break;
      const ce = closeParen(s, k, ds);
      try { header[name] = parseArgs(s, k + 1, ce); } catch (e) { header[name] = []; }
      j = s.indexOf(';', ce); if (j < 0) break; j++;
    }
  }
  const schema = header.FILE_SCHEMA && Array.isArray(header.FILE_SCHEMA[0]) ? header.FILE_SCHEMA[0].map(x => String(x).toUpperCase()) : [];
  // Instances : id → position des arguments (début, fin) et type.
  const pos = new Map(), types = new Map();
  let j = ds + 5, n = 0, last = 0;
  for (;;) {
    j = skip(s, j, end);
    if (j >= end || s.startsWith('ENDSEC', j)) break;
    if (s.charCodeAt(j) !== 35) throw new StepError('instance attendue (#…)', s, j);
    let k = j + 1; while (k < end && s.charCodeAt(k) >= 48 && s.charCodeAt(k) <= 57) k++;
    const id = +s.slice(j + 1, k);
    k = skip(s, k, end);
    if (s.charCodeAt(k) !== 61) throw new StepError('« = » attendu', s, k);
    k = skip(s, k + 1, end);
    let type = '', a, ce;
    if (s.charCodeAt(k) === 40) { // instance complexe (plusieurs types) : gardée sans être lue
      ce = closeParen(s, k, end); type = '(COMPLEX)'; a = k + 1;
    } else {
      let m = k; while (m < end && isUpper(s.charCodeAt(m))) m++;
      type = s.slice(k, m).toUpperCase(); m = skip(s, m, end);
      if (s.charCodeAt(m) !== 40) throw new StepError('« ( » attendu après ' + type, s, m);
      a = m + 1; ce = closeParen(s, m, end);
    }
    pos.set(id, [a, ce - 1, type]);
    let l = types.get(type); if (!l) types.set(type, l = []); l.push(id);
    j = s.indexOf(';', ce); if (j < 0) throw new StepError('« ; » attendu', s, ce); j++;
    if (onProgress && ++n - last > 20000) { last = n; onProgress(j / end); }
  }
  const cache = new Map();
  return {
    schema, header, count: pos.size, types,
    get(id) {
      if (id && typeof id === 'object') id = id.r;
      if (cache.has(id)) return cache.get(id);
      const p = pos.get(id); if (!p) return null;
      let o;
      try { o = { id, type: p[2], args: p[2] === '(COMPLEX)' ? [] : parseArgs(s, p[0], p[1] + 1) }; } catch (e) { o = { id, type: p[2], args: [], err: e.message }; }
      cache.set(id, o); return o;
    },
    ofType(...ts) { const out = []; for (const t of ts) { const l = types.get(t.toUpperCase()); if (l) out.push(...l); } return out; },
    byType() { const o = {}; for (const [t, l] of types) o[t] = l.length; return o; }
  };
}

/* ---------- Écriture ---------- */
export const INT = n => ({ int: Math.round(+n || 0) });
export const E = name => ({ e: String(name).toUpperCase() });
export const ref = id => ({ r: id });
export const T = (type, v) => ({ t: String(type).toUpperCase(), v });
export const BOOL = b => ({ e: b ? 'T' : 'F' });

/** Chaîne STEP (avec ses apostrophes) : ASCII imprimable tel quel, le reste en \X2\…\X0\ (ou \X4\ hors du plan de base). */
export function encodeString(str) {
  let out = "'", run = '';
  const flush = () => { if (run) { out += '\\X2\\' + run + '\\X0\\'; run = ''; } };
  for (const ch of String(str ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp >= 32 && cp <= 126) { flush(); out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch; continue; }
    if (cp > 0xffff) { flush(); out += '\\X4\\' + cp.toString(16).toUpperCase().padStart(8, '0') + '\\X0\\'; continue; }
    run += cp.toString(16).toUpperCase().padStart(4, '0');
  }
  flush();
  return out + "'";
}
/** Réel STEP : toujours un point décimal (1. , 0.25 , 1.5E-05). */
export function encodeReal(v) {
  let x = +v; if (!Number.isFinite(x)) x = 0;
  if (Object.is(x, -0)) x = 0;
  let t = Math.abs(x) >= 1e-4 || x === 0 ? String(Math.round(x * 1e9) / 1e9) : x.toExponential();
  t = t.toUpperCase();
  if (t.includes('E')) { let [m, ex] = t.split('E'); if (!m.includes('.')) m += '.'; return m + 'E' + (ex[0] === '+' ? ex.slice(1) : ex); }
  return t.includes('.') ? t : t + '.';
}
/** Une valeur (voir l'en-tête du module) en texte STEP. */
export function encodeValue(v) {
  if (v === null || v === undefined) return '$';
  if (v === DERIVED) return '*';
  if (typeof v === 'number') return encodeReal(v);
  if (typeof v === 'string') return encodeString(v);
  if (typeof v === 'boolean') return v ? '.T.' : '.F.';
  if (Array.isArray(v)) return '(' + v.map(encodeValue).join(',') + ')';
  if ('r' in v) return '#' + v.r;
  if ('int' in v) return String(v.int);
  if ('e' in v) return '.' + v.e + '.';
  if ('t' in v) return v.t + '(' + encodeValue(v.v) + ')';
  throw new Error('valeur STEP inconnue');
}

/**
 * Rédacteur : add(TYPE, [args]) → id ; ref d'une instance : W.add(...) rend l'id, ref(id) le désigne. text({ description,
 * name, time, author, org, preprocessor, system, authorization, schema }) rend le fichier complet.
 */
export function stepWriter() {
  const lines = [];
  let next = 1;
  return {
    add(type, args) { const id = next++; lines.push('#' + id + '=' + type.toUpperCase() + '(' + args.map(encodeValue).join(',') + ');'); return id; },
    get count() { return lines.length; },
    text(h = {}) {
      const hd = [
        'ISO-10303-21;', 'HEADER;',
        `FILE_DESCRIPTION((${(h.description || ['']).map(encodeString).join(',')}),'2;1');`,
        `FILE_NAME(${encodeString(h.name || '')},${encodeString(h.time || '')},(${encodeString(h.author || '')}),(${encodeString(h.org || '')}),${encodeString(h.preprocessor || '')},${encodeString(h.system || '')},${encodeString(h.authorization || '')});`,
        `FILE_SCHEMA((${encodeString(h.schema || 'IFC4')}));`, 'ENDSEC;', 'DATA;'
      ];
      return hd.concat(lines, ['ENDSEC;', 'END-ISO-10303-21;', '']).join('\n');
    }
  };
}
