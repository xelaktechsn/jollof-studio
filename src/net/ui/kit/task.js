// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tâches longues et notifications de la trousse réseau, sans bloquer l'interface : une carte dans la pile des
// notifications de l'application (.toasts de school/ui.js), avec roue, barre de progression, bouton « Annuler ».
//
// task(label, fn, { cancel (bouton Annuler), done (texte de fin ; false : rien), quiet (pas de carte de fin),
//   delay (ms avant d'afficher la carte : une tâche courte ne clignote pas, défaut 250) }) → Promise<résultat de fn>
//   fn({ signal, progress(f 0..1 | null, texte?), check() }) : peut être async ; check() lève une AbortError si annulée.
//   Annulée : la promesse est rejetée avec une erreur de nom 'AbortError' (rien d'autre n'est affiché).
//   Erreur : carte d'erreur (message) restée 8 s, puis la promesse est rejetée avec l'erreur.
// notify(text, kind ('ok'|'warn'|'err'|'info'), { action: { label, run }, ms, detail }) → { close() } :
//   notification avec une action (« 3 objets retirés · Annuler »).
import './kit.css';
import { icon } from '../../../ui/icons.js';
import { tl, CANCEL } from '../../../i18n/index.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function box() {
  let b = document.querySelector('body > .toasts');
  if (!b) { b = document.createElement('div'); b.className = 'toasts'; document.body.appendChild(b); }
  if (!b.hasAttribute('role')) { b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'polite'); }
  return b;
}
const card = (cls, html) => { const el = document.createElement('div'); el.className = 'toast ntKToast ' + cls; el.innerHTML = html; box().appendChild(el); return el; };
const drop = el => { if (!el || !el.isConnected) return; el.classList.add('out'); setTimeout(() => el.remove(), 300); };
const ICON = { ok: 'check', warn: 'alert', err: 'alert', info: 'info' };

export function notify(text, kind = 'ok', o = {}) {
  const el = card(kind, `${icon(ICON[kind] || 'info')}<span>${esc(text)}${o.detail ? `<br><small>${esc(o.detail)}</small>` : ''}</span>${o.action ? `<button type="button" class="ntKAct">${esc(o.action.label)}</button>` : ''}<button type="button" class="ntKAct" data-x aria-label="${tl('Fermer')}">${icon('x')}</button>`);
  let t = setTimeout(() => drop(el), o.ms ?? (o.action ? 7000 : 3800));
  el.addEventListener('pointerenter', () => clearTimeout(t));
  el.addEventListener('pointerleave', () => { t = setTimeout(() => drop(el), 2500); });
  el.addEventListener('click', e => {
    const b = e.target.closest('.ntKAct'); if (!b) return;
    if (!b.hasAttribute('data-x') && o.action) { try { o.action.run(); } catch (err) { console.error(err); } }
    clearTimeout(t); drop(el);
  });
  return { el, close: () => { clearTimeout(t); drop(el); } };
}

export function task(label, fn, o = {}) {
  const ctl = new AbortController();
  let el = null, frac = null, note = '', shownAt = 0;
  const abortErr = () => { const e = new Error(tl('Annulé')); e.name = 'AbortError'; return e; };
  const paint = () => {
    if (!el) return;
    el.querySelector('.ntKTxt').innerHTML = `${esc(label)}${note ? `<br><small>${esc(note)}</small>` : ''}`;
    const bar = el.querySelector('.ntKBar'); bar.classList.toggle('ind', frac == null);
    bar.firstChild.style.width = frac == null ? '' : Math.round(frac * 100) + '%';
    bar.setAttribute('aria-valuenow', frac == null ? '' : String(Math.round(frac * 100)));
  };
  const show = () => {
    if (el || ctl.signal.aborted) return;
    shownAt = Date.now();
    el = card('busy', `<i class="ntKSpin" aria-hidden="true"></i><span class="ntKTxt"></span>${o.cancel ? `<button type="button" class="ntKAct">${esc(CANCEL)}</button>` : ''}<div class="ntKBar ind" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100"><i></i></div>`);
    if (o.cancel) el.querySelector('.ntKAct').onclick = () => ctl.abort();
    paint();
  };
  const timer = setTimeout(show, o.delay ?? 250);
  const api = {
    signal: ctl.signal,
    progress(f, text) { frac = f == null ? null : Math.max(0, Math.min(1, +f || 0)); if (text != null) note = String(text); paint(); },
    check() { if (ctl.signal.aborted) throw abortErr(); }
  };
  const close = () => { clearTimeout(timer); const e = el; el = null; if (e) setTimeout(() => drop(e), Math.max(0, 400 - (Date.now() - shownAt))); };
  return new Promise((resolve, reject) => {
    ctl.signal.addEventListener('abort', () => { close(); reject(abortErr()); });
    Promise.resolve().then(() => fn(api)).then(v => {
      if (ctl.signal.aborted) return;
      close();
      if (!o.quiet && o.done !== false && (shownAt || typeof o.done === 'string')) notify(typeof o.done === 'string' ? o.done : tl('{0} : terminé', label), 'ok', { ms: 2500 });
      resolve(v);
    }, err => {
      if (ctl.signal.aborted) return;
      close();
      if (err && err.name === 'AbortError') { reject(err); return; }
      console.error(err);
      notify(tl('{0} : échec', label), 'err', { detail: err && err.message ? err.message : String(err), ms: 8000 });
      reject(err);
    });
  });
}
