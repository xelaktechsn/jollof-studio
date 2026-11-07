// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outils de tracé partagés par l'oscilloscope du banc de mesure (bench.js) et le traceur série
// (prog/plotter.js) : couleurs des voies, unités lisibles, graduations « rondes » et quadrillage.
import { DEC } from '../i18n/index.js';

/** Couleurs des voies et des séries, bien distinctes sur fond sombre. */
export const COLORS = ['#f2c94c', '#3fbfbf', '#e0703a', '#b07be0', '#6fcf6f', '#5b9cf5', '#f07178', '#c9d1d6'];

/** Nombre arrondi à d décimales, avec la virgule de la langue. */
export const fmt = (v, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace('.', DEC);

/** Valeur avec son unité à la bonne échelle : 0,42 V → 420 mV, 0,5 mA → 500 µA, 1 500 Hz → 1,50 kHz. */
export function si(v, unit) {
  const a = Math.abs(v);
  if (unit === 'V') return a < 1 && a > 0 ? `${fmt(v * 1000, 0)} mV` : `${fmt(v, 2)} V`;
  if (unit === 'mA') return a < 1 && a > 0 ? `${fmt(v * 1000, 0)} µA` : `${fmt(v, a < 10 ? 2 : 1)} mA`;
  if (unit === 'Hz') return a >= 1000 ? `${fmt(v / 1000, 2)} kHz` : `${fmt(v, a < 10 ? 2 : 0)} Hz`;
  return `${fmt(v)} ${unit}`;
}

/** Pas de graduation « rond » (1, 2 ou 5 × 10ⁿ) pour couper `span` en `n` intervalles environ. */
export function niceStep(span, n = 5) {
  const raw = Math.abs(span) / Math.max(1, n);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
/** Graduations rondes couvrant [lo, hi] : bornes élargies au pas, liste des valeurs, décimales utiles. */
export function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) { const c = Number.isFinite(lo) ? lo : 0, d = Math.abs(c) > 1 ? Math.abs(c) * 0.1 : 1; lo = c - d; hi = c + d; }
  const step = niceStep(hi - lo, n), ia = Math.floor(lo / step + 1e-9), ib = Math.ceil(hi / step - 1e-9);
  const at = k => +(k * step).toPrecision(12) || 0, list = [];
  for (let k = ia; k <= ib && list.length < 50; k++) list.push(at(k));
  return { lo: at(ia), hi: at(ib), step, list, dec: Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9))) };
}
/** Texte d'une graduation : décimales du pas, virgule de la langue, grands nombres abrégés (12k). */
export function tickText(v, dec = 0) {
  const a = Math.abs(v);
  const short = (x, u) => fmt(x, 1).replace(/\D0$/, '') + u;
  if (a >= 1e6) return short(v / 1e6, 'M');
  if (a >= 1e4) return short(v / 1e3, 'k');
  return fmt(v, dec);
}

/** Fond et quadrillage d'un écran de mesure : lignes aux abscisses xs et aux ordonnées ys (en pixels). */
export function paintGrid(g, W, H, xs, ys, bg = '#071012', line = '#173238') {
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = line; g.lineWidth = 1; g.beginPath();
  for (const x of xs) { const X = Math.round(x) + 0.5; g.moveTo(X, 0); g.lineTo(X, H); }
  for (const y of ys) { const Y = Math.round(y) + 0.5; g.moveTo(0, Y); g.lineTo(W, Y); }
  g.stroke();
}
/** Positions régulières : n − 1 lignes intérieures sur une longueur L. */
export const divisions = (L, n) => Array.from({ length: Math.max(0, n - 1) }, (_, i) => (L * (i + 1)) / n);
