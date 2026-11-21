// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Grille de propriétés de la trousse réseau : champs typés avec unités, contrôle de la saisie (message sous le champ,
// la valeur fausse n'est pas appliquée), valeurs mêlées d'une sélection multiple (« ≠ », champ vide avec « Valeurs
// multiples » : une saisie s'applique à tous), groupes repliables, Échap rend la valeur d'avant, Entrée valide.
//
// propGrid(el, fields, values, onChange, o?) → { el, update(values), focus(key), destroy() }
//   fields : [{ key ('a.b' : chemin), label, type: 'text'|'number'|'select'|'bool'|'color'|'readonly', unit?, min?, max?,
//             int?, step?, digits?, options? ([[valeur, libellé]] ou fonction), placeholder?, required?, maxlength?,
//             pattern?, patternText?, validate?(v) → message|null, get?(obj), applies?(obj), disabled?, group?, hint? }]
//   values : un objet, ou une liste d'objets (sélection multiple : valeurs fusionnées par mergeValues).
//   onChange(key, value, { field, mixed, list }) : appelé une fois par saisie validée (l'appelant modifie le modèle et
//   fait ctx.commit()). o : { en (nombres à la virgule si faux), collapsed: Set des groupes repliés, id (préfixe) }.
import './kit.css';
import { icon } from '../../../ui/icons.js';
import { tl, isEn } from '../../../i18n/index.js';
import { mergeValues, parseValue, fmtValue } from './model.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let seq = 0;

export function propGrid(el, fields, values, onChange, o = {}) {
  const en = o.en ?? isEn, uid = o.id || 'ntKp' + (++seq);
  const root = document.createElement('div'); root.className = 'ntKProps';
  el.appendChild(root);
  let list = [], merged = {};
  const shut = new Set(o.collapsed || []);
  const opts = f => ((typeof f.options === 'function' ? f.options() : f.options) || []).map(x => (Array.isArray(x) ? x : [x, x]));

  function control(f, m) {
    const id = `${uid}-${f.key}`, mixed = m && m.mixed, v = m ? m.value : undefined;
    const ph = mixed ? tl('Valeurs multiples') : f.placeholder || '';
    const dis = f.disabled || (m && m.n === 0) ? ' disabled' : '';
    const req = f.required ? ' aria-required="true"' : '';
    switch (f.type) {
      case 'readonly': return `<span class="ntKRo${mixed ? ' mixed' : ''}" id="${id}">${mixed ? tl('Valeurs multiples') : esc(fmtValue(f, v, en) || '—')}</span>`;
      case 'bool': return `<input type="checkbox" id="${id}" data-k="${esc(f.key)}"${v && !mixed ? ' checked' : ''}${dis}>`;
      case 'select': return `<select id="${id}" data-k="${esc(f.key)}"${dis}${req}>${mixed || v == null ? `<option value="" disabled selected>${mixed ? tl('Valeurs multiples') : '—'}</option>` : ''}${opts(f).map(([k, l]) => `<option value="${esc(k)}"${!mixed && String(k) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      case 'color': return `<input type="color" id="${id}" data-k="${esc(f.key)}" value="${esc(mixed || !v ? '#3b82f6' : v)}"${dis}>`;
      case 'number': return `<input type="text" inputmode="decimal" id="${id}" data-k="${esc(f.key)}" value="${mixed ? '' : esc(fmtValue(f, v, en))}" placeholder="${esc(ph)}"${dis}${req}>`;
      default: return `<input type="text" id="${id}" data-k="${esc(f.key)}" value="${mixed ? '' : esc(v ?? '')}" placeholder="${esc(ph)}"${f.maxlength ? ` maxlength="${f.maxlength}"` : ''}${dis}${req}>`;
    }
  }
  function row(f) {
    const m = merged[f.key];
    if (list.length > 1 && m && m.n === 0) return ''; // champ sans objet dans cette sélection
    return `<div class="ntKPr${m && m.mixed ? ' mixed' : ''}" data-row="${esc(f.key)}"${f.hint ? ` title="${esc(f.hint)}"` : ''}><label for="${uid}-${esc(f.key)}"${f.required ? ' class="req"' : ''}>${esc(f.label)}</label><div class="ntKPv">${control(f, m)}${f.unit ? `<span class="ntKU">${esc(f.unit)}</span>` : ''}</div></div>`;
  }
  function render() {
    const groups = new Map();
    for (const f of fields) { const g = f.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(f); }
    let h = '';
    for (const [g, fs] of groups) {
      const rows = fs.map(row).join(''); if (!rows) continue;
      h += g ? `<fieldset class="ntKPg${shut.has(g) ? ' shut' : ''}" data-g="${esc(g)}"><button type="button" aria-expanded="${!shut.has(g)}">${icon('chevRight')}<span>${esc(g)}</span></button>${rows}</fieldset>` : rows;
    }
    root.innerHTML = h;
  }
  function update(vals) {
    list = Array.isArray(vals) ? vals : vals ? [vals] : [];
    merged = mergeValues(list, fields);
    const a = document.activeElement, k = a && root.contains(a) && a.dataset.k;
    render();
    if (k) { const n = root.querySelector(`[data-k="${CSS.escape(k)}"]`); if (n) n.focus({ preventScroll: true }); }
  }
  const fieldOf = k => fields.find(f => f.key === k);
  function setErr(rowEl, msg) {
    rowEl.classList.toggle('bad', !!msg);
    let e = rowEl.querySelector('.ntKPe');
    const inp = rowEl.querySelector('[data-k]');
    if (!msg) { if (e) e.remove(); if (inp) inp.removeAttribute('aria-invalid'); return; }
    if (!e) { e = document.createElement('div'); e.className = 'ntKPe'; e.id = inp.id + '-e'; e.setAttribute('role', 'alert'); rowEl.appendChild(e); }
    e.textContent = msg; inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('aria-describedby', e.id);
  }
  function commit(inp) {
    const f = fieldOf(inp.dataset.k); if (!f) return;
    const rowEl = inp.closest('.ntKPr'), m = merged[f.key];
    const raw = f.type === 'bool' ? inp.checked : inp.value;
    if (inp.dataset.last === String(raw)) return; // Entrée puis perte du focus : une seule application
    // Champ mêlé laissé vide : rien à appliquer.
    if (m && m.mixed && f.type !== 'bool' && raw === '') { setErr(rowEl, null); return; }
    const r = parseValue(f, raw, tl);
    if (!r.ok) { setErr(rowEl, r.error); return; }
    setErr(rowEl, null); inp.dataset.last = String(raw);
    if (m && !m.mixed && JSON.stringify(m.value ?? null) === JSON.stringify(r.value ?? null)) return;
    try { onChange(f.key, r.value, { field: f, mixed: !!(m && m.mixed), list }); } catch (e) { console.error(e); }
  }
  root.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.k) commit(t); });
  root.addEventListener('keydown', e => {
    const t = e.target; if (!t.dataset || !t.dataset.k) return;
    if (e.key === 'Enter' && t.tagName === 'INPUT') { e.preventDefault(); commit(t); }
    else if (e.key === 'Escape' && t.tagName === 'INPUT' && t.type === 'text') {
      const f = fieldOf(t.dataset.k), m = merged[t.dataset.k];
      t.value = m && !m.mixed ? fmtValue(f, m.value, en) : ''; setErr(t.closest('.ntKPr'), null); e.stopPropagation();
    }
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('.ntKPg > button'); if (!b) return;
    const fs = b.parentElement, g = fs.dataset.g, on = !fs.classList.toggle('shut');
    b.setAttribute('aria-expanded', String(on)); if (on) shut.delete(g); else shut.add(g);
  });
  update(values);
  return {
    el: root, update,
    focus(k) { const n = root.querySelector(`[data-k="${CSS.escape(k)}"]`); if (n) n.focus(); },
    destroy() { root.remove(); }
  };
}
