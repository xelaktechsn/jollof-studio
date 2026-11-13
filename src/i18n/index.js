// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Langue de l'interface : français (langue source du code) ou anglais.
// Elle est fixée à l'installation : l'installateur Windows demande la langue et l'écrit à côté de
// l'application (lue au démarrage, voir checkInstallLanguage) ; une construction peut aussi être
// faite pour une seule langue (VITE_LANG=fr ou en, voir scripts/release.mjs). À défaut, la langue
// du système. Elle est connue avant le chargement des modules : les tables de libellés peuvent
// donc appeler t() dès leur définition.
// Dictionnaire anglais : chargé par boot.js avant l'application, seulement si la langue est l'anglais.
const EN = {};

const KEY = 'jollof-lang';
const ok = l => l === 'fr' || l === 'en';
function resolve() {
  if (typeof window === 'undefined') {
    // Travailleur en arrière-plan (vérificateur) : la langue lui est donnée par son premier message (self.JOLLOF_LANG).
    if (typeof self !== 'undefined' && ok(self.JOLLOF_LANG)) return self.JOLLOF_LANG;
    const e = typeof process !== 'undefined' && process.env ? process.env.JOLLOF_LANG : null; return ok(e) ? e : 'fr'; // tests sous Node
  }
  try { const q = new URLSearchParams(location.search).get('lang'); if (ok(q)) { localStorage.setItem(KEY, q); return q; } } catch (e) { /* adresse illisible */ }
  const built = import.meta.env && import.meta.env.VITE_LANG;
  if (ok(built)) return built;
  try { const s = localStorage.getItem(KEY); if (ok(s)) return s; } catch (e) { /* stockage indisponible */ }
  return /^fr/i.test(navigator.language || '') ? 'fr' : 'en';
}
export const LANG = resolve();
export const isEn = LANG === 'en';
/** Bouton « Annuler » d'une boîte de dialogue : en anglais « Cancel » (la clé « Annuler » d'en.js veut dire « Undo »). */
export const CANCEL = isEn ? 'Cancel' : 'Annuler';

/**
 * Traduit un texte français. Les espaces autour du texte sont conservés ; {0}, {1}… sont remplacés
 * par les arguments. Un texte absent du dictionnaire reste en français.
 */
export function t(s, ...args) {
  let out = s;
  if (isEn && typeof s === 'string') {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), tr = EN[m[2]];
    if (tr != null) { const lead = /^[:;,.!?)]/.test(tr) ? '' : m[1]; out = lead + tr + m[3]; }
  }
  return args.length ? String(out).replace(/\{(\d+)\}/g, (x, i) => (args[i] ?? '')) : out;
}
/** Ajoute des traductions (dictionnaire des modules Pro, chargé avec eux). */
export function addDictionary(d) { if (isEn) Object.assign(EN, d); }
/** Charge le dictionnaire anglais (à faire avant d'importer les modules de l'interface). */
export const loadLanguage = () => (isEn ? import('./en.js').then(m => addDictionary(m.default)) : Promise.resolve());
/** Alias court utilisé dans le code (« t » sert souvent de variable de temps). */
export const tl = t;
/** Citation : « texte » en français, “text” en anglais. */
export const quote = s => (isEn ? `“${s}”` : `« ${s} »`);
/** Nombre décimal écrit à la manière de la langue : 3,3 en français, 3.3 en anglais. */
export const dec = s => (isEn ? String(s).replace(',', '.') : String(s).replace('.', ','));
/** Séparateur décimal : virgule en français, point en anglais. */
export const DEC = isEn ? '.' : ',';
/** Deux-points entre un libellé et sa valeur : « Temp : 21 » en français, “Temp: 21” en anglais. */
export const COLON = isEn ? ': ' : ' : ';
/** Locale des dates. */
export const locale = () => (isEn ? 'en-GB' : 'fr-FR');

/** Traduit le HTML statique (index.html) : textes et attributs title, aria-label, placeholder, data-tip, alt. */
export function translateDom(root = document.body) {
  document.documentElement.lang = LANG;
  if (!isEn) return;
  document.title = t(document.title);
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { if (n.nodeValue.trim()) n.nodeValue = t(n.nodeValue); }
  root.querySelectorAll('[title],[aria-label],[placeholder],[data-tip],[alt]').forEach(el => {
    for (const a of ['title', 'aria-label', 'placeholder', 'data-tip', 'alt']) if (el.hasAttribute(a)) el.setAttribute(a, t(el.getAttribute(a)));
  });
}
/**
 * Langue choisie par l'installateur : si elle diffère de la langue en cours, elle est retenue et
 * l'application redémarre une fois dans cette langue.
 */
export async function checkInstallLanguage(read) {
  const built = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_LANG;
  if (ok(built)) return; // construction pour une seule langue
  let inst = null;
  try { inst = await read(); } catch (e) { inst = null; }
  if (!ok(inst)) return;
  let stored = null; try { stored = localStorage.getItem(KEY); } catch (e) { /* stockage indisponible */ }
  if (stored === inst && inst === LANG) return;
  try { localStorage.setItem(KEY, inst); } catch (e) { return; }
  if (inst !== LANG) location.reload();
}
