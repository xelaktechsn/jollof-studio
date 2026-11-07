// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Petite trousse d'interface de l'espace classe : avatars, pastilles d'état, dates relatives,
// boîtes de dialogue, notifications éphémères, anneau de score, états vides.
import { tl, locale, isEn } from '../i18n/index.js';
import { icon, hydrateIcons } from '../ui/icons.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { icon };
export const COLORS = ['#e0703a', '#3b82f6', '#3fb27f', '#9b7be0', '#f2c94c', '#e5484d', '#3fbfbf', '#d36bb0'];

export const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
/** Pastille ronde d'une personne : initiales sur sa couleur, point vert si en ligne. */
export const avatar = (p, size = 32) => `<span class="av${p && p.online ? ' on' : ''}" style="--s:${size}px;--c:${esc((p && p.avatarColor) || COLORS[0])}" title="${esc(p && p.displayName)}">${esc(initials(p && p.displayName))}</span>`;
export const avatars = (list, max = 4) => `<span class="avs">${list.slice(0, max).map(p => avatar(p, 26)).join('')}${list.length > max ? `<span class="av more" style="--s:26px">+${list.length - max}</span>` : ''}</span>`;

/* ---------- Dates ---------- */
const fmt = (d, o) => new Date(d).toLocaleString(locale(), o);
export const dateTime = d => fmt(d, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const dateOnly = d => fmt(d, { weekday: 'short', day: 'numeric', month: 'short' });
export const timeOnly = d => fmt(d, { hour: '2-digit', minute: '2-digit' });
export function relTime(d) {
  const s = Math.round((Date.now() - new Date(d)) / 1000);
  if (s < 45) return tl('à l’instant');
  const m = Math.round(s / 60); if (m < 60) return tl('il y a {0} min', m);
  const h = Math.round(m / 60); if (h < 24) return tl('il y a {0} h', h);
  const j = Math.round(h / 24); if (j < 7) return j === 1 ? tl('hier') : tl('il y a {0} j', j);
  return dateOnly(d);
}
/** Échéance : « dans 3 j », « demain 18:00 », « en retard de 2 h ». */
export function due(d) {
  if (!d) return { text: tl('Sans échéance'), cls: 'none' };
  const ms = new Date(d) - Date.now(), h = ms / 3600000;
  if (ms < 0) { const late = -h < 24 ? tl('{0} h', Math.max(1, Math.round(-h))) : tl('{0} j', Math.round(-h / 24)); return { text: tl('En retard de {0}', late), cls: 'late' }; }
  if (h < 24) return { text: tl('Aujourd’hui {0}', timeOnly(d)), cls: 'soon' };
  if (h < 48) return { text: tl('Demain {0}', timeOnly(d)), cls: 'soon' };
  return { text: tl('Pour le {0}', dateOnly(d)), cls: h < 24 * 4 ? 'near' : 'far' };
}
export const clock = ms => { const s = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };

/* ---------- États ---------- */
export const STATUS = {
  not_started: () => ({ label: tl('À faire'), cls: 'todo', ic: 'inbox' }),
  in_progress: () => ({ label: tl('En cours'), cls: 'doing', ic: 'edit' }),
  submitted: () => ({ label: tl('Envoyé'), cls: 'sent', ic: 'send' }),
  graded: () => ({ label: tl('Corrigé'), cls: 'graded', ic: 'check' }),
  returned: () => ({ label: tl('Rendu'), cls: 'returned', ic: 'award' }),
  draft: () => ({ label: tl('Brouillon'), cls: 'draft', ic: 'edit' }),
  published: () => ({ label: tl('Publié'), cls: 'published', ic: 'send' }),
  closed: () => ({ label: tl('Clos'), cls: 'closed', ic: 'lock' })
};
export const chip = (status, extra = '') => { const s = (STATUS[status] || STATUS.not_started)(); return `<span class="pill ${s.cls}">${icon(s.ic)}${s.label}${extra}</span>`; };
export const kindLabel = k => (k === 'evaluation' ? tl('Évaluation') : tl('Exercice'));
export const kindChip = k => `<span class="kind ${k}">${icon(k === 'evaluation' ? 'award' : 'edit')}${kindLabel(k)}</span>`;
export const num = v => (v == null ? '—' : (Math.round(v * 10) / 10).toString().replace('.', isEn ? '.' : ','));
export const score = (s, max) => (s == null ? '—' : `${num(s)}<small>/${num(max)}</small>`);

/** Anneau de progression (score sur le maximum). */
export function ring(value, max, size = 64) {
  const r = 26, c = 2 * Math.PI * r, p = max ? Math.max(0, Math.min(1, value / max)) : 0;
  const col = p >= 0.75 ? 'var(--ok)' : p >= 0.5 ? 'var(--warn)' : 'var(--danger)';
  return `<svg class="ring" viewBox="0 0 64 64" style="width:${size}px;height:${size}px"><circle cx="32" cy="32" r="${r}" class="track"/><circle cx="32" cy="32" r="${r}" class="bar" style="stroke:${col};stroke-dasharray:${c};stroke-dashoffset:${c * (1 - p)}"/><text x="32" y="36">${value == null ? '—' : Math.round(p * 100) + '%'}</text></svg>`;
}
/** État vide illustré. */
export const empty = (ic, title, text, action = '') => `<div class="emptyState"><div class="emptyArt">${icon(ic)}</div><b>${title}</b>${text ? `<p>${text}</p>` : ''}${action}</div>`;
export const skeleton = (n = 3) => `<div class="skel">${'<div></div>'.repeat(n)}</div>`;

/* ---------- Notifications éphémères ---------- */
let toastBox = null;
export function toast(text, kind = 'ok', ms = 3800) {
  if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toasts'; document.body.appendChild(toastBox); }
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.innerHTML = `${icon(kind === 'err' ? 'alert' : kind === 'warn' ? 'info' : 'check')}<span>${esc(text)}</span>`;
  toastBox.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

/* ---------- Boîtes de dialogue ---------- */
/**
 * Boîte modale. body : HTML ou élément. actions : [{ label, value, kind: 'primary'|'danger'|'' }].
 * onAction(value, root) peut renvoyer false pour garder la boîte ouverte. Résout avec la valeur (null si annulé).
 */
export function dialog({ title, body = '', actions = [{ label: tl('Fermer'), value: null }], width = 480, onAction, onOpen, cls = '' }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'sDialogWrap';
    wrap.innerHTML = `<div class="sDialog ${cls}" role="dialog" aria-modal="true" style="--w:${width}px"><header><h3>${title}</h3><button type="button" class="iconBtn" data-x aria-label="${tl('Fermer')}">${icon('x')}</button></header><div class="sBody"></div><footer>${actions.map((a, i) => `<button type="button" class="btn ${a.kind || ''}" data-a="${i}">${a.label}</button>`).join('')}</footer></div>`;
    const bodyEl = wrap.querySelector('.sBody');
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    document.body.appendChild(wrap); hydrateIcons(wrap);
    const close = v => { document.removeEventListener('keydown', key, true); wrap.classList.add('out'); setTimeout(() => wrap.remove(), 160); resolve(v); };
    const key = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(null); } if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const p = actions.findIndex(a => a.kind === 'primary'); if (p >= 0) { e.preventDefault(); wrap.querySelector(`[data-a="${p}"]`).click(); } } };
    document.addEventListener('keydown', key, true);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(null); });
    wrap.addEventListener('click', async e => {
      if (e.target.closest('[data-x]')) return close(null);
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = actions[+b.dataset.a];
      if (onAction) { b.disabled = true; let r; try { r = await onAction(a.value, bodyEl); } finally { b.disabled = false; } if (r === false) return; if (r !== undefined && r !== true) return close(r); }
      close(a.value);
    });
    if (onOpen) onOpen(bodyEl, close);
    const f = bodyEl.querySelector('input, textarea, select'); if (f) setTimeout(() => f.focus(), 30);
  });
}
export const confirm = (title, text, label = tl('Confirmer'), danger = false) =>
  dialog({ title, body: `<p class="dlgText">${text}</p>`, actions: [{ label: tl('Annuler'), value: false }, { label, value: true, kind: danger ? 'danger solid' : 'primary' }] }).then(v => !!v);
export function ask(title, label, value = '', { placeholder = '', multiline = false, ok = tl('Valider') } = {}) {
  const field = multiline ? `<textarea class="sInput" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="sInput" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
  return dialog({
    title, body: `<label class="sField"><span>${label}</span>${field}</label>`,
    actions: [{ label: tl('Annuler'), value: null }, { label: ok, value: 'ok', kind: 'primary' }],
    onAction: (v, root) => (v === 'ok' ? root.querySelector('.sInput').value.trim() || false : undefined)
  });
}
/** Petit menu contextuel sous un bouton. items : [{ label, icon, value, danger }]. */
export function menu(anchor, items) {
  return new Promise(resolve => {
    document.querySelectorAll('.sMenu').forEach(m => m.remove());
    const m = document.createElement('div'); m.className = 'sMenu';
    m.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button type="button" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon) : ''}<span>${it.label}</span></button>`)).join('');
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(), w = m.offsetWidth, hgt = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
    m.style.top = (r.bottom + hgt + 8 > innerHeight ? r.top - hgt - 6 : r.bottom + 6) + 'px';
    const done = v => { m.remove(); document.removeEventListener('mousedown', out, true); resolve(v); };
    const out = e => { if (!m.contains(e.target)) done(null); };
    setTimeout(() => document.addEventListener('mousedown', out, true));
    m.onclick = e => { const b = e.target.closest('[data-i]'); if (b) done(items[+b.dataset.i].value); };
  });
}
export const debounce = (fn, ms) => {
  let t = null, args = [];
  const d = (...a) => { args = a; clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  d.flush = () => { if (t === null) return Promise.resolve(); clearTimeout(t); t = null; return Promise.resolve(fn(...args)); };
  d.cancel = () => { clearTimeout(t); t = null; };
  d.pending = () => t !== null;
  return d;
};
/** Enregistre un texte (CSV…) sous un nom donné : boîte de dialogue dans l'application, téléchargement dans un navigateur. */
export async function download(text, name, type = 'text/csv') {
  const ext = (name.split('.').pop() || 'txt').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'txt';
  const { saveFile } = await import('../native.js');
  return saveFile(new Blob([text], { type }), name, ext.toUpperCase(), ext);
}
