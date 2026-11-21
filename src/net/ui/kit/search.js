// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Champ de recherche de la trousse réseau : loupe, bouton d'effacement, compteur facultatif, Échap efface (puis rend
// la main), saisie retardée (debounce) pour les longues listes.
//
// searchBox(host | null, { placeholder, label, value, delay (ms, défaut 120), onInput(q), onEnter(q, ev), onKey(ev) → bool,
//   onEscape() }) → { el, input, value(), set(q, fire?), focus(select?), clear(), count(text) }
import './kit.css';
import { icon } from '../../../ui/icons.js';
import { tl } from '../../../i18n/index.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function searchBox(host, o = {}) {
  const el = document.createElement('div'); el.className = 'ntKSearch';
  el.innerHTML = `${icon('search')}<input type="search" autocomplete="off" spellcheck="false" placeholder="${esc(o.placeholder || tl('Rechercher'))}" aria-label="${esc(o.label || o.placeholder || tl('Rechercher'))}"><span class="ntKCount" hidden></span><button type="button" class="ntKClr" aria-label="${tl('Effacer la recherche')}" hidden>${icon('x')}</button>`;
  const input = el.querySelector('input'), clr = el.querySelector('.ntKClr'), cnt = el.querySelector('.ntKCount');
  if (o.value) input.value = o.value;
  let t = 0;
  const fire = () => { clearTimeout(t); t = 0; if (o.onInput) o.onInput(input.value); };
  const paint = () => { clr.hidden = !input.value; };
  input.addEventListener('input', () => { paint(); clearTimeout(t); t = setTimeout(fire, o.delay ?? 120); });
  input.addEventListener('keydown', e => {
    if (o.onKey && o.onKey(e)) { e.preventDefault(); return; }
    if (e.key === 'Escape') {
      if (input.value) { input.value = ''; paint(); fire(); e.preventDefault(); e.stopPropagation(); }
      else if (o.onEscape) { o.onEscape(); e.preventDefault(); e.stopPropagation(); }
    } else if (e.key === 'Enter') { if (t) fire(); if (o.onEnter) { o.onEnter(input.value, e); e.preventDefault(); } }
  });
  clr.addEventListener('click', () => { input.value = ''; paint(); fire(); input.focus(); });
  paint();
  if (host) host.appendChild(el);
  return {
    el, input,
    value: () => input.value,
    set(q, now = true) { input.value = q ?? ''; paint(); if (now) fire(); },
    focus(sel = true) { input.focus(); if (sel) input.select(); },
    clear() { input.value = ''; paint(); fire(); },
    /** Texte discret à droite du champ (« 12 / 340 ») ; vide : caché. */
    count(text) { cnt.textContent = text || ''; cnt.hidden = !text; input.style.paddingRight = text ? (34 + 7 * String(text).length) + 'px' : ''; }
  };
}
