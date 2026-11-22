// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//
// Accessibilité commune à toutes les boîtes modales ([role="dialog"][aria-modal="true"] : .sheet des fenêtres de
// index.html, dialog() de src/school/ui.js, palette, assistants du réseau), sans que chacune ait à le refaire :
//  - un nom : aria-labelledby vers le premier titre quand la boîte n'en a pas ;
//  - le focus y entre à l'ouverture (ce que la boîte a choisi, sinon la boîte elle-même) ;
//  - Tab et Maj+Tab y restent ;
//  - à la fermeture, le focus revient au bouton qui l'a ouverte, si elle a été fermée au clavier (à la souris, on ne
//    laisse pas le focus sur un bouton : Espace sert à déplacer la vue).
// Chargé après le démarrage par src/ui/shell.js. Règles : docs/ACCESSIBILITY.md.
import { tl } from '../i18n/index.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, video[controls], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
const MODAL = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
const shown = el => !!(el && el.isConnected && el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';

/** Éléments qui prennent le focus au clavier dans root, dans l'ordre du document. */
export const focusables = root => [...root.querySelectorAll(FOCUSABLE)].filter(el => shown(el) && !el.closest('[inert]'));
/** Boîtes modales affichées ; la dernière du document est au-dessus. */
export const openModals = () => [...document.querySelectorAll(MODAL)].filter(shown);

let uid = 0;
/** Donne un nom à une boîte qui n'en a pas : son premier titre. */
export function nameDialog(d) {
  if (d.getAttribute('aria-label')) return;
  const by = d.getAttribute('aria-labelledby');
  if (by && by.split(/\s+/).some(id => document.getElementById(id))) return;
  const h = d.querySelector('h1, h2, h3, h4, [data-dlg-title]');
  if (h) { if (!h.id) h.id = `dlgTitle${++uid}`; d.setAttribute('aria-labelledby', h.id); }
}

export function installA11y() {
  const openers = new Map(); // boîte → élément qui avait le focus avant elle
  let outside = null, keyboard = false, queued = false;
  const inModal = el => !!(el && el.closest && el.closest(MODAL));
  function sync() {
    queued = false;
    const open = openModals();
    for (const d of open) {
      if (openers.has(d)) continue;
      openers.set(d, outside && !d.contains(outside) ? outside : null);
      nameDialog(d);
      // La boîte choisit souvent son champ un instant après s'être affichée : on ne passe qu'après.
      setTimeout(() => {
        if (!shown(d) || d.contains(document.activeElement)) return;
        const first = d.querySelector('[autofocus]');
        if (first && shown(first)) { first.focus({ preventScroll: true }); return; }
        if (!d.hasAttribute('tabindex')) d.tabIndex = -1;
        d.focus({ preventScroll: true });
      }, 80);
    }
    for (const [d, opener] of openers) {
      if (open.includes(d)) continue;
      openers.delete(d);
      const a = document.activeElement, lost = !a || a === document.body || !shown(a) || d.contains(a);
      if (keyboard && lost && opener && shown(opener) && !opener.disabled) opener.focus({ preventScroll: true });
    }
  }
  const soon = () => { if (!queued) { queued = true; requestAnimationFrame(sync); } };
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-modal'] });
  addEventListener('focusin', e => { if (!inModal(e.target)) outside = e.target; }, true);
  addEventListener('pointerdown', () => { keyboard = false; }, true);
  addEventListener('keydown', e => {
    keyboard = true;
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    const open = openModals(), d = open[open.length - 1]; if (!d) return;
    const f = focusables(d), a = document.activeElement;
    if (!f.length) { e.preventDefault(); d.focus({ preventScroll: true }); return; }
    const first = f[0], last = f[f.length - 1], out = !d.contains(a);
    if (e.shiftKey && (a === first || a === d || out)) { e.preventDefault(); last.focus(); return; }
    if (!e.shiftKey && (a === last || out)) { e.preventDefault(); first.focus(); return; }
    // Le navigateur choisit l'arrêt suivant (WebKit, selon le réglage du système, saute les boutons) : s'il sort de la
    // boîte, on l'y ramène.
    const back = e.shiftKey;
    setTimeout(() => { if (shown(d) && !d.contains(document.activeElement)) { const g = focusables(d); (back ? g[g.length - 1] : g[0])?.focus(); } }, 0);
  }, true);
  // Poignées de partage au clavier (role="separator" focalisable) : une valeur est exigée. Celles qui n'en donnent pas
  // reçoivent leur position dans leur conteneur, de 0 à 100, relue au focus et après chaque réglage.
  const place = g => {
    if (!g.dataset.a11yPos && g.hasAttribute('aria-valuenow')) return;
    const box = (g.offsetParent || document.documentElement).getBoundingClientRect(), r = g.getBoundingClientRect();
    const v = g.getAttribute('aria-orientation') === 'horizontal' ? (r.top - box.top) / (box.height || 1) : (r.left - box.left) / (box.width || 1);
    g.dataset.a11yPos = '1'; g.setAttribute('aria-valuemin', 0); g.setAttribute('aria-valuemax', 100); g.setAttribute('aria-valuenow', Math.round(Math.max(0, Math.min(1, v)) * 100));
  };
  const grips = () => document.querySelectorAll('[role="separator"][tabindex]:not([tabindex="-1"])').forEach(place);
  const onGrip = e => { const g = e.target instanceof Element && e.target.closest('[role="separator"][tabindex]'); if (g) requestAnimationFrame(() => place(g)); };
  addEventListener('focusin', onGrip, true); addEventListener('keyup', onGrip, true); addEventListener('pointerup', onGrip, true);
  // Bouton sans texte ni nom mais avec une infobulle : l'infobulle lui sert de nom (filet de sécurité ; la règle reste
  // d'écrire aria-label, docs/UI.md).
  const names = () => document.querySelectorAll('button[data-tip]:not([aria-label]):not([aria-labelledby])').forEach(b => { if (!b.textContent.trim()) b.setAttribute('aria-label', b.dataset.tip); });
  // Plans de travail dessinés (canvas 3D, SVG) : un nom, et un rôle qui laisse lire les éléments focalisables d'un SVG.
  const AREAS = [['#stage > canvas', 'img', () => tl('Montage 3D')], ['.lgSvg', 'group', () => tl('Plan de travail logique')],
    ['.ntSvg', 'group', () => tl('Schéma logique : équipements, câbles, adresses')], ['.ntPlSvg', 'group', () => tl('Plans')]];
  const areas = () => { for (const [sel, role, name] of AREAS) for (const el of document.querySelectorAll(sel)) { if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', name()); if (!el.hasAttribute('role')) el.setAttribute('role', role); } };
  let later = 0;
  const sweep = () => { later = 0; grips(); names(); areas(); };
  new MutationObserver(() => { if (!later) later = setTimeout(sweep, 400); }).observe(document.body, { childList: true, subtree: true });
  sync(); sweep();
}
