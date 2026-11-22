// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Résultats MESURÉS par un vrai certificateur (importés d'un export de logiciel de gestion de tests, interop/linkware.js),
// rangés dans data.measured, à part des résultats SIMULÉS (data.tests, certify.js) : jamais mélangés, toujours nommés.
//   data.measured : { at (date de l'import), file, results: [{ link (lien du plan, '' si non rattaché), cableId (identifiant
//     du testeur), verdict ('pass'|'pass*'|'fail*'|'fail'), limit (texte du testeur), len (m), margin (dB, marge la plus
//     faible), param (paramètre de cette marge), margins { il, next, psnext, acrf, psacrf, acrn, psacrn, rl } (dB), delay (ns),
//     skew (ns), res (Ω), tester, serial, operator, at (date du test), sw (versions), nvp }] }
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const numOr = (v, lo, hi) => (v != null && v !== '' && Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : null);
export const VERDICTS = ['pass', 'pass*', 'fail*', 'fail'];
export const MARGIN_KEYS = ['il', 'next', 'psnext', 'acrf', 'psacrf', 'acrn', 'psacrn', 'rl'];
export const MAX_MEASURED = 6000;

/** Un résultat mesuré propre, ou null (sans identifiant de câble ni verdict connu). */
export function cleanResult(x) {
  if (!x || typeof x !== 'object') return null;
  const cableId = txt(x.cableId, 80); if (!cableId || !VERDICTS.includes(x.verdict)) return null;
  const o = { link: txt(x.link, 200), cableId, verdict: x.verdict, limit: txt(x.limit, 80) };
  for (const [k, lo, hi, d] of [['len', 0, 100000, 1], ['margin', -99, 99, 2], ['delay', 0, 100000, 0], ['skew', 0, 10000, 0], ['res', 0, 10000, 2], ['nvp', 1, 100, 1]]) { const v = numOr(x[k], lo, hi); if (v != null) o[k] = +v.toFixed(d); }
  const p = txt(x.param, 12); if (MARGIN_KEYS.includes(p) || p === 'length' || p === 'wiremap') o.param = p;
  const mg = {}; if (x.margins && typeof x.margins === 'object') for (const k of MARGIN_KEYS) { const v = numOr(x.margins[k], -99, 99); if (v != null) mg[k] = +v.toFixed(2); }
  if (Object.keys(mg).length) o.margins = mg;
  for (const [k, n] of [['tester', 60], ['serial', 60], ['operator', 60], ['at', 30], ['sw', 60]]) { const v = txt(x[k], n); if (v) o[k] = v; }
  return o;
}
/** data.measured propre, ou null. Un seul résultat par identifiant de câble (le dernier gagne). */
export function cleanMeasured(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const by = new Map();
  for (const x of Array.isArray(raw.results) ? raw.results.slice(0, MAX_MEASURED) : []) { const r = cleanResult(x); if (r) by.set(r.cableId, r); }
  if (!by.size) return null;
  return { at: txt(raw.at, 30), file: txt(raw.file, 120), results: [...by.values()] };
}
/** Résultats mesurés par lien du plan : Map(lien → résultat). */
export function measuredByLink(data) {
  const m = new Map();
  for (const r of (data && data.measured && data.measured.results) || []) if (r.link) m.set(r.link, r);
  return m;
}
/** Ajoute (ou remplace, par identifiant de câble) des résultats mesurés ; rend data.measured. L'appelant fait ctx.commit(). */
export function storeMeasured(data, rows, o = {}) {
  const prev = (data.measured && data.measured.results) || [];
  data.measured = cleanMeasured({ at: o.at || new Date().toISOString(), file: o.file || '', results: [...prev, ...rows] });
  return data.measured;
}
/** Compte par verdict : { pass, 'pass*', 'fail*', fail, total, linked }. */
export function measuredStats(data) {
  const o = { pass: 0, 'pass*': 0, 'fail*': 0, fail: 0, total: 0, linked: 0 };
  for (const r of (data && data.measured && data.measured.results) || []) { o[r.verdict]++; o.total++; if (r.link) o.linked++; }
  return o;
}
