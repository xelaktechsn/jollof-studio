// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tableau de la trousse réseau (onglets du panneau du bas, listes longues) : seules les lignes visibles existent dans
// la page, tri par colonne (clic sur l'en-tête, encore : sens inverse ; comparaison naturelle, vides en dernier), filtre
// par mots (« col:valeur » pour une colonne), ligne active au clavier (flèches, Entrée), clic : onActivate.
//
// createTable(host, { columns, rows, rowKey(row), onActivate(row, ev), onContext(row, ev), placeholder, empty(),
//   tools (html à droite de la barre), sortKey, sortDir, label }) → { el, setRows(rows), setFilter(q), refresh(), destroy() }
// columns : [{ key, label, width ('120px', '1fr'…), num (alignée à droite, tri numérique), value(row) (valeur triée),
//   text(row) (texte cherché), html(row) (cellule ; sinon le texte échappé), title(row) }]
import './kit.css';
import { icon } from '../../../ui/icons.js';
import { tl } from '../../../i18n/index.js';
import { sortRows, filterRows } from './model.js';
import { searchBox } from './search.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createTable(host, o) {
  const RH = 24, OVER = 10, cols = o.columns;
  const el = document.createElement('div'); el.className = 'ntKTbl';
  el.innerHTML = `<div class="ntKTbar"><span class="ntKTs"></span><span class="ntKTn" aria-live="polite"></span><span class="grow"></span><span class="ntKTtools">${o.tools || ''}</span></div>
    <div class="ntKTwrap" tabindex="0" role="grid" aria-label="${esc(o.label || '')}"><div class="ntKThead" role="row"></div><div class="ntKTbody" role="rowgroup"></div></div>`;
  host.appendChild(el);
  const wrap = el.querySelector('.ntKTwrap'), head = el.querySelector('.ntKThead'), body = el.querySelector('.ntKTbody'), count = el.querySelector('.ntKTn');
  const grid = cols.map(c => c.width || 'minmax(90px, 1fr)').join(' ');
  // En-tête et lignes de même largeur (au moins la somme des largeurs mini des colonnes : défilement horizontal au-delà).
  const minW = cols.reduce((s, c) => { const m = /^(?:minmax\()?(\d+)px/.exec(c.width || ''); return s + (m ? +m[1] : 90); }, 0);
  head.style.gridTemplateColumns = grid; head.style.minWidth = minW + 'px'; body.style.minWidth = minW + 'px';
  let all = [], shown = [], q = '', sortKey = o.sortKey || null, dir = o.sortDir || 1, act = -1, raf = 0;
  const search = searchBox(el.querySelector('.ntKTs'), { placeholder: o.placeholder || tl('Filtrer'), onInput: v => { q = v; act = -1; apply(); } });
  const keyOf = r => (o.rowKey ? o.rowKey(r) : r.id);

  function paintHead() {
    head.innerHTML = cols.map(c => `<button type="button" role="columnheader" data-c="${esc(c.key)}" class="${c.num ? 'num' : ''}" aria-sort="${sortKey === c.key ? (dir > 0 ? 'ascending' : 'descending') : 'none'}" title="${esc(c.tip || c.label)}">${esc(c.label)}${sortKey === c.key ? icon(dir > 0 ? 'chevUp' : 'chevDown') : ''}</button>`).join('');
  }
  function apply() {
    const f = filterRows(all, cols, q);
    shown = sortRows(f, cols.find(c => c.key === sortKey), dir);
    count.textContent = q ? tl('{0} sur {1}', shown.length, all.length) : tl('{0:# ligne|# lignes}', all.length);
    body.style.height = shown.length * RH + 'px';
    paint();
  }
  function paint() { if (!raf) raf = requestAnimationFrame(paintNow); }
  function paintNow() {
    raf = 0;
    if (!shown.length) { body.style.height = ''; body.innerHTML = `<div class="ntKEmpty">${q ? tl('Aucune ligne ne correspond à ce filtre.') : o.empty ? o.empty() : tl('Rien à montrer.')}</div>`; return; }
    const top = Math.max(0, wrap.scrollTop - head.offsetHeight), h = wrap.clientHeight || 300;
    const i0 = Math.max(0, Math.floor(top / RH) - OVER), i1 = Math.min(shown.length, Math.ceil((top + h) / RH) + OVER);
    let html = '';
    for (let i = i0; i < i1; i++) {
      const r = shown[i];
      html += `<div class="ntKTr${i === act ? ' act' : ''}" role="row" data-i="${i}" style="top:${i * RH}px;grid-template-columns:${grid}"${o.rowTitle ? ` title="${esc(o.rowTitle(r))}"` : ''}>${cols.map(c => {
        const v = c.value ? c.value(r) : r[c.key];
        return `<span role="gridcell" class="${c.num ? 'num' : ''}"${c.title ? ` title="${esc(c.title(r))}"` : ''}>${c.html ? c.html(r) : esc(v ?? '')}</span>`;
      }).join('')}</div>`;
    }
    body.innerHTML = html;
  }
  wrap.addEventListener('scroll', paint, { passive: true });
  const ro = new ResizeObserver(paint); ro.observe(wrap);
  head.addEventListener('click', e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    if (sortKey === b.dataset.c) dir = -dir; else { sortKey = b.dataset.c; dir = 1; }
    paintHead(); apply();
  });
  const activate = (i, ev) => { const r = shown[i]; if (!r) return; act = i; paint(); if (o.onActivate) o.onActivate(r, ev); };
  body.addEventListener('click', e => { const r = e.target.closest('.ntKTr'); if (r) activate(+r.dataset.i, e); });
  body.addEventListener('contextmenu', e => { const r = e.target.closest('.ntKTr'); if (!r || !o.onContext) return; e.preventDefault(); act = +r.dataset.i; paint(); o.onContext(shown[act], e); });
  wrap.addEventListener('keydown', e => {
    const page = Math.max(1, Math.floor(wrap.clientHeight / RH) - 2);
    const go = i => { if (!shown.length) return; act = Math.max(0, Math.min(shown.length - 1, i)); const t = act * RH, hh = wrap.clientHeight - head.offsetHeight; if (t < wrap.scrollTop) wrap.scrollTop = t; else if (t + RH > wrap.scrollTop + hh) wrap.scrollTop = t + RH - hh; paint(); };
    if (e.key === 'ArrowDown') go(act + 1); else if (e.key === 'ArrowUp') go(act - 1);
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(shown.length - 1);
    else if (e.key === 'PageDown') go(act + page); else if (e.key === 'PageUp') go(act - page);
    else if (e.key === 'Enter') activate(act, e);
    else return;
    e.preventDefault(); e.stopPropagation();
  });
  paintHead();
  const api = {
    el, search,
    /** Nouvelles lignes : la ligne active reste la même (même clé) quand elle existe encore. */
    setRows(rows) { const k = act >= 0 && shown[act] ? keyOf(shown[act]) : null; all = rows || []; apply(); if (k != null) { act = shown.findIndex(r => keyOf(r) === k); paint(); } },
    setFilter(v) { search.set(v); },
    rows: () => shown,
    refresh: () => paint(),
    destroy() { ro.disconnect(); el.remove(); }
  };
  if (o.rows) api.setRows(o.rows);
  return api;
}
