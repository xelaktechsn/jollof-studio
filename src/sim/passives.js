// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Valeur réglable des composants passifs : résistances, condensateurs, bobines. Le type garde une valeur par défaut
// (res-220, cap-100n, ind-10m…) ; chaque composant peut recevoir la sienne, enregistrée avec le projet dans c.inp.val
// (en Ω, F ou H), et les condensateurs leur tension de service dans c.inp.vmax (V). Le solveur (dc.js), le vérificateur,
// le schéma et les anneaux de couleur la lisent ici. Sans interface (tests sous Node).
import { DEC } from '../i18n/index.js';

/** Familles : unité, symbole, bornes admises, valeur par défaut d'un type. */
const RES = { unit: 'Ω', min: 0.1, max: 100e6 };
const CAP = { unit: 'F', min: 1e-12, max: 1 };
const IND = { unit: 'H', min: 1e-9, max: 100 };
/** Valeurs des types livrés (les anciens projets et les TP les utilisent). */
const DEFAULTS = {
  'cap-100n': { ...CAP, v: 100e-9, vmax: 50, kind: 'ceramic' },
  'cap-100u': { ...CAP, v: 100e-6, vmax: 16, kind: 'electrolytic' },
  'ind-10m': { ...IND, v: 0.01, r: 24 }
};
const resDefault = type => {
  const m = /^res-(\d+)(?:([kKM])(\d*))?$/.exec(type);
  return m ? parseFloat(m[1] + '.' + (m[3] || '0')) * (m[2] === 'M' ? 1e6 : m[2] ? 1e3 : 1) : 0;
};
/** Famille d'un type : 'R', 'C', 'L' ou null. */
export function familyOf(type) {
  if (resDefault(type) > 0) return 'R';
  const d = DEFAULTS[type];
  return d ? (d.unit === 'F' ? 'C' : 'L') : null;
}
const spec = type => (familyOf(type) === 'R' ? { ...RES, v: resDefault(type) } : DEFAULTS[type] || null);
/** Valeur par défaut du type (Ω, F, H), 0 si ce n'est pas un passif réglable. */
export const defaultValue = type => { const s = spec(type); return s ? s.v : 0; };
/** Valeur d'un composant : la sienne (c.inp.val), sinon celle de son type. */
export function valueOf(c) {
  const s = c && spec(c.type); if (!s) return 0;
  const v = c.inp && +c.inp.val;
  return Number.isFinite(v) && v >= s.min && v <= s.max ? v : s.v;
}
/** Tension de service d'un condensateur (V) : la sienne (c.inp.vmax), sinon celle de son type ; 0 si sans objet. */
export function ratingOf(c) {
  const d = c && DEFAULTS[c.type]; if (!d || !d.vmax) return 0;
  const v = c.inp && +c.inp.vmax;
  return Number.isFinite(v) && v > 0 ? v : d.vmax;
}
/** Résistance série d'une bobine (Ω), proportionnelle à la racine de l'inductance (bobine axiale du commerce). */
export function windingOf(c) {
  const d = DEFAULTS[c.type]; if (!d || d.unit !== 'H') return 0;
  return Math.max(0.05, d.r * Math.sqrt(valueOf(c) / d.v));
}
/** Tensions de service proposées pour un condensateur. */
export const RATINGS = { ceramic: [16, 25, 50, 100, 250, 500], electrolytic: [6.3, 10, 16, 25, 35, 50, 63, 100, 160, 250, 400, 450] };
export const capKind = type => (DEFAULTS[type] && DEFAULTS[type].kind) || null;

/* ---------- Écriture et lecture des valeurs ---------- */
const PREFIX = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
/** « 4,7 kΩ », « 100 nF », « 10 mH » : trois chiffres significatifs au plus, séparateur décimal de la langue. */
export function formatValue(v, unit) {
  if (!Number.isFinite(v) || v <= 0) return '';
  const [k, p] = PREFIX.find(([k]) => v >= k * 0.9995) || PREFIX[PREFIX.length - 1];
  let n = v / k;
  n = n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
  return `${String(n).replace('.', DEC)} ${p}${unit}`;
}
/** Valeur d'un composant écrite pour l'interface (schéma, panneau) ; '' si ce n'est pas un passif réglable. */
export function valueText(c) {
  const s = c && spec(c.type); return s ? formatValue(valueOf(c), s.unit) : '';
}
const MUL = { G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, µ: 1e-6, μ: 1e-6, n: 1e-9, p: 1e-12, R: 1, r: 1, '': 1 };
/**
 * Lit une valeur tapée : « 4k7 », « 4,7k », « 4.7 kΩ », « 100n », « 100 nF », « 2M2 », « 0R47 », « 10u », « 1e-6 ».
 * Rend un nombre (unité de base) ou NaN.
 */
export function parseValue(text) {
  const v = parseRaw(text);
  return Number.isFinite(v) ? +v.toPrecision(12) : v; // 47 × 1e-9 → 4,7e-8 exact
}
function parseRaw(text) {
  let s =String(text ?? '').trim().replace(/\s+/g, '').replace(/[ΩΩ]|ohms?|[FfHh]$/g, '').replace(',', '.');
  if (!s) return NaN;
  if (/^[0-9.]+(e[+-]?\d+)?$/i.test(s)) return +s;
  // Notation des schémas : la lettre remplace la virgule (4k7, 2M2, 0R47, 4n7).
  let m = /^(\d+)([GMkKmuµμnpRr])(\d+)$/.exec(s);
  if (m) return parseFloat(`${m[1]}.${m[3]}`) * MUL[m[2]];
  m = /^([0-9]*\.?[0-9]+)([GMkKmuµμnpRr]?)$/.exec(s);
  return m ? parseFloat(m[1]) * MUL[m[2]] : NaN;
}
/** Valeur tapée pour un type : nombre dans les bornes de sa famille, sinon null. */
export function acceptValue(type, text) {
  const s = spec(type), v = parseValue(text);
  return s && Number.isFinite(v) && v >= s.min && v <= s.max ? v : null;
}

/* ---------- Séries normalisées (CEI 60063) ---------- */
export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
export const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
/** Valeurs courantes à proposer pour un type (liste de choix du champ). */
export function suggestions(type) {
  const f = familyOf(type); if (!f) return [];
  const decades = f === 'R' ? [1, 10, 100, 1e3, 10e3, 100e3, 1e6] : f === 'L' ? [1e-6, 10e-6, 100e-6, 1e-3, 10e-3, 100e-3]
    : capKind(type) === 'electrolytic' ? [1e-6, 10e-6, 100e-6, 1e-3] : [1e-12, 10e-12, 100e-12, 1e-9, 10e-9, 100e-9, 1e-6];
  const series = f === 'R' ? E24 : [1.0, 2.2, 3.3, 4.7, 6.8];
  return decades.flatMap(d => series.map(x => Math.round(x * d * 1e12) / 1e12));
}
/** Valeur normalisée la plus proche dans une série (E12 par défaut). */
export function nearest(v, series = E12) {
  if (!(v > 0)) return v;
  const d = Math.pow(10, Math.floor(Math.log10(v) + 1e-9)), n = v / d;
  let best = series[0]; for (const x of [...series, 10]) if (Math.abs(Math.log(x / n)) < Math.abs(Math.log(best / n))) best = x;
  return best * d;
}

/* ---------- Anneaux de couleur d'une résistance (4 anneaux, tolérance or) ---------- */
/** [chiffre 1, chiffre 2, multiplicateur, 'g'] ; multiplicateur 'g' (or, ×0,1) ou 's' (argent, ×0,01) sous 10 Ω. */
export function bandsOf(ohm) {
  if (!(ohm > 0)) return [0, 0, 0, 'g'];
  let e = Math.floor(Math.log10(ohm)) - 1, d = Math.round(ohm / Math.pow(10, e));
  if (d >= 100) { d = Math.round(d / 10); e += 1; }
  const mul = e >= 0 ? Math.min(9, e) : e === -1 ? 'g' : 's';
  return [Math.floor(d / 10), d % 10, mul, 'g'];
}
