// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Barre d'application : menu du projet, ouvert depuis son nom (nouveau, ouvrir, enregistrer,
// enregistrer sous, importer). Les entrées gardent les identifiants des anciens boutons
// (#newBtn, #openBtn, #importBtn) : leurs actions sont branchées ailleurs, une seule fois.
import { isEn } from '../i18n/index.js';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/** Raccourci affiché à la façon du système : ⌘⇧S sur Mac, Ctrl+Maj+S ailleurs. */
export const shortcut = (key, shift = false) => (MAC ? `⌘${shift ? '⇧' : ''}${key}` : `Ctrl+${shift ? (isEn ? 'Shift+' : 'Maj+') : ''}${key}`);

export function installProjectMenu() {
  const btn = document.getElementById('projBtn'), menu = document.getElementById('projMenu');
  if (!btn || !menu) return;
  menu.querySelectorAll('kbd[data-key]').forEach(k => { k.textContent = shortcut(k.dataset.key, !!k.dataset.shift); });
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')].filter(b => !b.disabled && b.offsetParent !== null);
  const isOpen = () => !menu.hidden;
  function open(focusFirst = false) {
    menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', onKey, true); // WebKit ne donne pas le focus au bouton cliqué : le clavier est écouté ici
    if (focusFirst) items()[0]?.focus();
  }
  function close(refocus = false) {
    if (!isOpen()) return;
    menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('keydown', onKey, true);
    if (refocus) btn.focus();
  }
  const outside = e => { if (!menu.contains(e.target) && !btn.contains(e.target)) close(); };
  function onKey(e) {
    const list = items(), i = list.indexOf(document.activeElement);
    const go = k => { e.preventDefault(); e.stopPropagation(); list[(k + list.length) % list.length]?.focus(); };
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i < 0 ? -1 : i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(-1);
    else if (e.key === 'Tab') close();
  }
  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  btn.addEventListener('keydown', e => {
    if (!isOpen() && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(true); }
  });
  // Une entrée choisie ferme le menu (son action, branchée sur le bouton, a déjà eu lieu).
  menu.addEventListener('click', e => { if (e.target.closest('[role="menuitem"]')) close(); });
}
