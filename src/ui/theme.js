// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Thème clair ou sombre. Le choix (clair, sombre, ou suivre le système) est retenu d'une session à l'autre ; par défaut
// sombre, comme l'application l'a toujours été. Le thème résolu est posé sur <html data-theme="light|dark"> avant le
// premier affichage (boot.js) : les feuilles de style ne connaissent que les jetons de :root et leur variante
// :root[data-theme="light"]. Un changement émet « jollof:theme » sur window (detail : { theme, mode }) pour ce qui
// se dessine hors CSS (fond de la scène 3D…).
const KEY = 'jollof-theme';
const MODES = ['dark', 'light', 'auto'];
let mode = 'dark', mq = null;
try { const s = localStorage.getItem(KEY); if (MODES.includes(s)) mode = s; } catch (e) { /* stockage indisponible */ }

/** Réglage choisi : 'dark', 'light' ou 'auto' (système). */
export const themeMode = () => mode;
/** Thème affiché : 'dark' ou 'light'. */
export const theme = () => (mode === 'auto' ? (mq && mq.matches ? 'light' : 'dark') : mode);
export const isLight = () => theme() === 'light';

function apply() {
  const t = theme();
  if (document.documentElement.dataset.theme === t) return;
  document.documentElement.dataset.theme = t;
  try { window.dispatchEvent(new CustomEvent('jollof:theme', { detail: { theme: t, mode } })); } catch (e) { /* navigateur ancien */ }
}
/** Change le réglage et l'applique tout de suite. */
export function setTheme(m) {
  if (!MODES.includes(m)) m = 'dark';
  mode = m;
  try { localStorage.setItem(KEY, m); } catch (e) { /* stockage indisponible */ }
  apply();
}
/** Clair ↔ sombre (un réglage « système » devient le contraire de ce qui est affiché). */
export const toggleTheme = () => setTheme(isLight() ? 'dark' : 'light');
/** À appeler avant le premier affichage : pose le thème et suit le système si c'est le réglage. */
export function initTheme() {
  try { mq = matchMedia('(prefers-color-scheme: light)'); mq.addEventListener('change', () => { if (mode === 'auto') apply(); }); } catch (e) { mq = null; }
  document.documentElement.dataset.theme = theme(); // sans événement : rien n'écoute encore
}
