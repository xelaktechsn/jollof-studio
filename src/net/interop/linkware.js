// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Import des résultats d'un vrai certificateur de câblage, depuis les exports d'un logiciel de gestion de tests (LinkWare PC
// de Fluke Networks : « File > Export to File > Autotest Summary / Autotest Reports » en CSV ou en texte, « Export to
// XML » — flukeLinkwareExport). Le format natif .flw est binaire et propriétaire : il n'est ni lu ni étudié ici.
//
// À VALIDER AVEC UN EXPORT RÉEL : aucun fichier d'export authentique n'a pu être obtenu publiquement, et Fluke ne publie
// pas la liste des colonnes (elle dépend d'ailleurs des champs cochés dans « Options > CSV »). Le lecteur est donc écrit
// contre les champs que Fluke décrit pour ses rapports (flukeLinkwareReportHeader, flukeLinkwareReportDetails : Cable ID,
// Test Summary, date, opérateur, limite, modèle, numéros de série, version, NVP, longueur, délai, écart de délai,
// résistance, marges d'affaiblissement, NEXT, PS NEXT, ACR-F, PS ACR-F, ACR-N, PS ACR-N, RL), reconnus par synonymes, et
// il est tolérant : séparateur deviné (virgule, point-virgule, tabulation), lignes d'en-tête de fichier ignorées, virgule
// décimale, unités dans la cellule, colonnes inconnues gardées et SIGNALÉES (report.unknown) au lieu d'être perdues.
// Sans DOM. Écrit sans reprendre ni code, ni interface, ni texte du logiciel d'origine.
import { parseTree } from './xmltree.js';
import { cleanResult, MARGIN_KEYS } from '../measured.js';

const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
/** Champs reconnus : nom interne → en-têtes possibles (normalisés : minuscules, sans accent ni ponctuation). */
const SYN = {
  cableId: ['cableid', 'cableidentifier', 'cablelabel', 'cablename', 'cable', 'linkid', 'id', 'identifiant', 'identifiantducable', 'idcable'],
  verdict: ['summary', 'testsummary', 'result', 'overallresult', 'testresult', 'passfail', 'status', 'resultat', 'resume'],
  limit: ['testlimit', 'limit', 'limite', 'limitedetest', 'teststandard', 'standard'],
  cableType: ['cabletype', 'typedecable'],
  len: ['length', 'lengthm', 'lengthft', 'cablelength', 'longueur', 'longueurm'],
  lenLimit: ['lengthlimit', 'limitlength'],
  at: ['datetime', 'date', 'testdate', 'dateandtime', 'datetimeoftest', 'dateheure'],
  time: ['time', 'testtime', 'heure'],
  tester: ['testertype', 'tester', 'testermodel', 'model', 'mainmodel', 'instrument', 'modele', 'testeur'],
  serial: ['mainsn', 'mainserial', 'mainserialnumber', 'serialnumber', 'sn', 'serial', 'numerodeserie'],
  remoteSerial: ['remotesn', 'remoteserial', 'remoteserialnumber', 'smartremotesn'],
  operator: ['operator', 'testername', 'technician', 'user', 'operateur', 'technicien'],
  sw: ['softwareversion', 'software', 'swversion', 'version', 'limitsversion', 'firmware'],
  nvp: ['nvp'],
  site: ['site', 'project', 'projectname', 'folder', 'building', 'projet'],
  headroom: ['headroom', 'worstcasemargin', 'worstmargin', 'margin', 'marge'],
  delay: ['propdelay', 'propagationdelay', 'propdelayns', 'delay', 'delai'],
  skew: ['delayskew', 'skew', 'delayskewns'],
  res: ['resistance', 'loopresistance', 'resistanceohms', 'dcresistance'],
  il: ['insertionlossmargin', 'ilmargin', 'attnmargin', 'attenuationmargin', 'insertionloss', 'attenuation'],
  next: ['nextmargin', 'next', 'worstnextmargin'],
  psnext: ['psnextmargin', 'psnext'],
  acrf: ['acrfmargin', 'acrf', 'elfextmargin', 'elfext'],
  psacrf: ['psacrfmargin', 'psacrf', 'pselfextmargin', 'pselfext'],
  acrn: ['acrnmargin', 'acrn', 'acrmargin', 'acr'],
  psacrn: ['psacrnmargin', 'psacrn', 'psacrmargin', 'psacr'],
  rl: ['rlmargin', 'returnlossmargin', 'rl', 'returnloss']
};
const FIELD_OF = new Map();
for (const [f, list] of Object.entries(SYN)) for (const h of list) if (!FIELD_OF.has(h)) FIELD_OF.set(h, f);
/** Champ interne d'un en-tête, ou null. Les suffixes d'unité et de côté (« (dB) », « main », « remote ») sont tolérés. */
export function fieldOf(header) {
  let h = norm(header);
  if (FIELD_OF.has(h)) return FIELD_OF.get(h);
  h = h.replace(/(db|ns|ohms?|mhz|meters?|feet)$/, '');
  if (FIELD_OF.has(h)) return FIELD_OF.get(h);
  const side = h.replace(/(main|remote|sr|worst|worstcase)/g, '');
  return FIELD_OF.get(side) || null;
}
export const KNOWN_FIELDS = Object.keys(SYN);

/** Verdict d'une cellule : PASS, PASS*, FAIL*, FAIL (l'astérisque marque un résultat dans la précision du testeur). */
export function verdictOf(v) {
  const s = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''), star = s.includes('*');
  const t = s.replace(/[*\s]/g, '');
  if (/^(pass|passed|p|ok|reussi|reussite|conforme|bestanden)$/.test(t)) return star ? 'pass*' : 'pass';
  if (/^(fail|failed|f|ko|echec|echoue|nonconforme)$/.test(t)) return star ? 'fail*' : 'fail';
  if (/^(marginal|marginalpass)$/.test(t)) return 'pass*';
  if (t === 'marginalfail') return 'fail*';
  return null;
}
/** Nombre d'une cellule : « 12,4 dB », « 87.3 », « -1,2 » ; null si ce n'en est pas un. */
export function numOf(v) {
  let s = String(v ?? '').trim(); if (!s) return null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(s.replace(/\s/g, '')); if (!m) return null;
  const n = +m[0].replace(',', '.'); return Number.isFinite(n) ? n : null;
}
const FT = 0.3048;
/** Longueur en mètres : unité lue dans la cellule (« 150 ft »), sinon dans l'en-tête, sinon mètres. */
function lenOf(v, header) {
  const n = numOf(v); if (n == null) return null;
  const s = String(v).toLowerCase(), h = String(header || '').toLowerCase();
  const ft = /\d\s*(ft|feet|')/.test(s) || (!/\d\s*m\b/.test(s) && /\b(ft|feet)\b/.test(h));
  return +(ft ? n * FT : n).toFixed(1);
}
/** Date d'une cellule en ISO quand elle se lit sans ambiguïté, sinon le texte tel quel (jamais réinterprété au hasard). */
function dateOf(v, time) {
  const s = String(v ?? '').trim(); if (!s) return '';
  const full = time && !/\d:\d/.test(s) ? s + ' ' + String(time).trim() : s;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(full);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` + (m[4] ? `T${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}` : '');
  return full.slice(0, 30);
}

/* ---------- Texte délimité (CSV, texte tabulé) ---------- */
/** Découpe un texte délimité (guillemets doublés, retours à la ligne dans une cellule). */
export function splitRows(text, sep) {
  const rows = []; let row = [], cell = '', q = false;
  const t = String(text).replace(/^\ufeff/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell === '') { q = true; continue; }
    if (c === sep) { row.push(cell); cell = ''; continue; }
    if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; continue; }
    cell += c;
  }
  row.push(cell); if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}
/** Séparateur le plus plausible : celui qui donne la ligne d'en-tête la mieux reconnue. */
function guessSep(text) {
  const head = String(text).slice(0, 20000); let best = ',', score = -1;
  for (const sep of [',', ';', '\t', '|']) {
    const rows = splitRows(head, sep).slice(0, 40);
    const s = Math.max(0, ...rows.map(r => (r.some(c => fieldOf(c) === 'cableId') ? r.filter(c => fieldOf(c)).length : 0)));
    if (s > score) { score = s; best = sep; }
  }
  return best;
}
/** Enregistrement brut ({ en-tête: valeur }) → résultat mesuré, avec les en-têtes d'origine pour les unités. */
function toResult(get, headers) {
  const f = k => { const h = headers.find(x => fieldOf(x) === k); return h == null ? undefined : get(h); };
  const hOf = k => headers.find(x => fieldOf(x) === k);
  const verdict = verdictOf(f('verdict'));
  const margins = {};
  for (const k of MARGIN_KEYS) {
    // Seules les colonnes de MARGE comptent (« NEXT Margin ») : une colonne de valeur brute (« NEXT ») n'est pas une marge.
    const h = headers.find(x => fieldOf(x) === k && /marg/i.test(x)); if (h == null) continue;
    const n = numOf(get(h)); if (n != null) margins[k] = n;
  }
  let margin = numOf(f('headroom')), param;
  const ks = Object.keys(margins);
  if (ks.length) { const w = ks.reduce((a, b) => (margins[b] < margins[a] ? b : a)); if (margin == null || margins[w] <= margin) { margin = margins[w]; param = w; } }
  return cleanResult({
    cableId: f('cableId'), verdict, limit: f('limit') || f('cableType') || '', len: lenOf(f('len'), hOf('len')), margin, param, margins,
    delay: numOf(f('delay')), skew: numOf(f('skew')), res: numOf(f('res')), nvp: numOf(f('nvp')),
    tester: f('tester'), serial: f('serial'), operator: f('operator'), sw: f('sw'), at: dateOf(f('at'), f('time'))
  });
}
function parseDelimited(text, report) {
  const sep = guessSep(text), rows = splitRows(text, sep);
  report.sep = sep === '\t' ? 'tab' : sep;
  const hi = rows.slice(0, 60).findIndex(r => r.some(c => fieldOf(c) === 'cableId') && r.filter(c => fieldOf(c)).length >= 2);
  if (hi < 0) { report.error = 'header'; return []; }
  const headers = rows[hi].map(h => h.trim());
  report.columns = headers.filter(h => fieldOf(h)); report.unknown = headers.filter(h => h && !fieldOf(h));
  if (!headers.some(h => fieldOf(h) === 'verdict')) { report.error = 'verdict'; return []; }
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    report.rows++;
    const res = toResult(h => r[headers.indexOf(h)], headers);
    if (res) out.push(res); else report.skipped++;
  }
  return out;
}

/* ---------- XML ---------- */
/** Tout élément qui porte un identifiant de câble (enfant ou attribut) est un enregistrement ; ses enfants sont ses champs. */
function parseXml(text, report) {
  let root; try { root = parseTree(text); } catch (e) { report.error = 'xml'; return []; }
  const out = [], seenH = new Set(), unknown = new Set();
  const flat = (n, into, depth) => {
    for (const [k, v] of Object.entries(n.attrs || {})) if (!(k in into)) into[k] = v;
    for (const c of n.children || []) {
      if (c.children && c.children.length && depth < 3) flat(c, into, depth + 1);
      const t = (c.text || '').trim(); if (t && !(c.tag in into)) into[c.tag] = t;
    }
    return into;
  };
  const walk = n => {
    if (!n) return;
    const direct = [...Object.keys(n.attrs || {}), ...(n.children || []).filter(c => (c.text || '').trim()).map(c => c.tag)];
    if (direct.some(k => fieldOf(k) === 'cableId')) {
      report.rows++;
      const rec = flat(n, {}, 0), headers = Object.keys(rec);
      for (const h of headers) { if (fieldOf(h)) seenH.add(h); else unknown.add(h); }
      const res = toResult(h => rec[h], headers);
      if (res) out.push(res); else report.skipped++;
      return;
    }
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  report.columns = [...seenH]; report.unknown = [...unknown].slice(0, 200);
  if (!report.rows) report.error = 'header';
  return out;
}

/**
 * Lit un export. Rend { results: [résultats mesurés], report: { format: 'csv'|'xml', sep, rows, skipped, columns (reconnues),
 * unknown (colonnes ignorées, à signaler), error? ('flw' fichier natif binaire · 'header' ligne d'en-tête introuvable ·
 * 'verdict' pas de colonne de résultat · 'xml' XML illisible · 'empty') } }.
 */
export function parseTesterExport(input, name = '') {
  const report = { format: 'csv', sep: '', rows: 0, skipped: 0, columns: [], unknown: [] };
  let text = input;
  if (input instanceof Uint8Array) {
    // Fichier natif ou autre binaire : octets nuls dans le début du fichier.
    if (/\.flw$/i.test(name) || input.subarray(0, 4000).some((b, i) => b === 0 && !(i % 2 === 1 && input[0] === 0xff && input[1] === 0xfe))) { report.error = 'flw'; return { results: [], report }; }
    text = input[0] === 0xff && input[1] === 0xfe ? new TextDecoder('utf-16le').decode(input) : new TextDecoder('utf-8').decode(input);
  } else if (/\.flw$/i.test(name)) { report.error = 'flw'; return { results: [], report }; }
  text = String(text || '');
  if (!text.trim()) { report.error = 'empty'; return { results: [], report }; }
  const xml = /^\s*(<\?xml|<[A-Za-z])/.test(text.replace(/^\ufeff/, ''));
  report.format = xml ? 'xml' : 'csv';
  const results = xml ? parseXml(text, report) : parseDelimited(text, report);
  return { results, report };
}

/* ---------- Rattachement aux liens du plan ---------- */
const key = s => String(s ?? '').toLowerCase().replace(/[\s_.\-/\\:()↔]+/g, '');
/**
 * Rattache chaque résultat à un lien du plan par son identifiant de câble. cands : [{ link, names: [textes possibles :
 * étiquette du câble, identifiant, étiquette du port de prise, nom du lien…] }]. Un nom porté par deux liens ne rattache
 * rien (ambigu). map : rattachements imposés à la main { identifiant du testeur: lien | '' }.
 * Rend { results (copie, link rempli), unmatched: [identifiants], ambiguous: [identifiants] }.
 */
export function matchResults(results, cands, map = {}) {
  const idx = new Map(), dup = new Set(), links = new Set(cands.map(c => c.link));
  for (const c of cands) for (const n of new Set(c.names.map(key).filter(Boolean))) { if (idx.has(n) && idx.get(n) !== c.link) dup.add(n); else idx.set(n, c.link); }
  const out = [], unmatched = [], ambiguous = [];
  for (const r of results) {
    const k = key(r.cableId); let link = '';
    if (Object.prototype.hasOwnProperty.call(map, r.cableId)) link = links.has(map[r.cableId]) ? map[r.cableId] : '';
    else if (dup.has(k)) ambiguous.push(r.cableId);
    else link = idx.get(k) || '';
    if (!link && !ambiguous.includes(r.cableId)) unmatched.push(r.cableId);
    out.push({ ...r, link });
  }
  return { results: out, unmatched, ambiguous };
}
