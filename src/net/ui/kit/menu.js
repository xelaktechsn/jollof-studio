// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Menu contextuel de la trousse réseau : le menu de l'application (school/ui.js menu, même apparence .sMenu, mêmes
// éléments { label, icon, value, danger }) étendu aux raccourcis affichés, sous-menus, éléments grisés, cases cochées,
// titres de section et au clavier complet (flèches, Entrée, Échap, Début/Fin, première lettre).
//
// ctxMenu(at, items, o?) → Promise<valeur choisie | null>
//   at    : événement souris (au pointeur), événement clavier ou élément (sous l'élément), ou { x, y } (écran).
//   items : '-' (séparateur) | { label, icon?, keys? ('Ctrl+D', 'Suppr'…), value?, run?(), disabled?, danger?,
//           checked? (true/false : case), hint? (infobulle), items? (sous-menu), header? (titre de section, non cliquable),
//           hover?(on) (élément survolé ou choisi au clavier : surligner ce qu'il désigne) }
//   Un élément choisi appelle run() s'il en a un, puis la promesse rend value (ou l'élément sans value).
//   o : { restore: élément à qui rendre le focus (défaut : celui qui l'avait) }.
import './kit.css';
import { icon } from '../../../ui/icons.js';
import { keyLabel as fmtKeys } from '../../menus.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
/** Raccourci affiché selon le système : Ctrl → ⌘ sur Mac. */
/** Raccourci à la façon du système et de la langue (⌘⇧D sur Mac ; Ctrl+Maj+D, Suppr, Échap en français) : menus.js keyLabel. */
export const keyLabel = k => fmtKeys(k, isMac);

let open = null; // menu ouvert (un seul à la fois, sous-menus compris)

function place(m, x, y, alt) {
  const w = m.offsetWidth, h = m.offsetHeight, W = innerWidth, H = innerHeight;
  let l = x, t = y;
  if (l + w + 6 > W) l = alt != null ? alt - w : W - w - 6;
  if (t + h + 6 > H) t = Math.max(6, H - h - 6);
  m.style.left = Math.max(6, l) + 'px'; m.style.top = Math.max(6, t) + 'px';
}

function build(items, level, done) {
  const m = document.createElement('div');
  m.className = 'sMenu ntKMenu'; m.setAttribute('role', 'menu'); m.tabIndex = -1; m.dataset.level = level;
  m.innerHTML = items.map((it, i) => {
    if (it === '-' || it == null) return '<hr role="separator">';
    if (it.header) return `<div class="ntKMh" role="presentation">${esc(it.header)}</div>`;
    const sub = Array.isArray(it.items) && it.items.length, dis = !!it.disabled, chk = typeof it.checked === 'boolean';
    // Case à cocher avec icône : l'icône à sa place, la coche en fin de ligne ; sans icône : la coche à la place de l'icône.
    const ic = chk && !it.icon ? (it.checked ? icon('check') : '<span></span>') : it.icon ? icon(it.icon) : '<span></span>';
    const tail = sub ? icon('chevRight', 'ntKMs') : chk && it.icon && it.checked ? icon('check', 'ntKMs') : '<span></span>';
    return `<button type="button" class="ntKMi${it.danger ? ' danger' : ''}" role="${chk ? 'menuitemcheckbox' : 'menuitem'}" data-i="${i}" tabindex="-1"${dis ? ' aria-disabled="true"' : ''}${chk ? ` aria-checked="${it.checked}"` : ''}${sub ? ' aria-haspopup="menu" aria-expanded="false"' : ''}${it.hint ? ` title="${esc(it.hint)}"` : ''}>${ic}<span>${esc(it.label)}</span>${it.keys ? `<kbd>${esc(keyLabel(it.keys))}</kbd>` : '<span></span>'}${tail}</button>`;
  }).join('');
  document.body.appendChild(m);
  const btns = () => [...m.querySelectorAll('.ntKMi:not([aria-disabled="true"])')];
  let child = null;
  const closeChild = () => { if (child) { child.close(); child = null; } m.querySelectorAll('[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false')); };
  let lit = null; // élément survolé (hover : surligner ce qu'il désigne dans la vue)
  const light = it => { if (lit === it) return; if (lit && lit.hover) { try { lit.hover(false); } catch (e) { /* rien */ } } lit = it; if (it && it.hover) { try { it.hover(true); } catch (e) { /* rien */ } } };
  const focusBtn = b => { if (!b) return; m.querySelectorAll('.ntKMi.on').forEach(x => x.classList.remove('on')); b.classList.add('on'); b.focus({ preventScroll: true }); light(items[+b.dataset.i]); };
  const openSub = (b, viaKey) => {
    const it = items[+b.dataset.i]; if (!it || !it.items || b.getAttribute('aria-disabled')) return;
    closeChild();
    const r = b.getBoundingClientRect();
    child = build(it.items, level + 1, done); child.parent = api;
    place(child.el, r.right + 2, r.top - 5, r.left - 2);
    b.setAttribute('aria-expanded', 'true');
    // Pointeur arrivé dans le sous-menu en diagonale : on annule la fermeture en attente et l'entrée parente reste allumée.
    child.el.addEventListener('pointerenter', () => { clearTimeout(hoverT); if (!b.classList.contains('on')) { m.querySelectorAll('.ntKMi.on').forEach(x => x.classList.remove('on')); b.classList.add('on'); } });
    if (viaKey) child.first();
  };
  const choose = b => {
    const it = items[+b.dataset.i]; if (!it || b.getAttribute('aria-disabled')) return;
    if (it.items) { openSub(b, true); return; }
    done(it);
  };
  let hoverT = 0;
  m.addEventListener('pointermove', e => {
    const b = e.target.closest('.ntKMi'); if (!b || b.classList.contains('on')) return;
    focusBtn(b); clearTimeout(hoverT);
    // Sous-menu déjà ouvert : délai plus long, le temps de traverser une autre entrée pour l'atteindre.
    hoverT = setTimeout(() => { if (b.getAttribute('aria-haspopup')) openSub(b, false); else closeChild(); }, child ? 320 : 140);
  });
  m.addEventListener('click', e => { const b = e.target.closest('.ntKMi'); if (b) choose(b); });
  m.addEventListener('contextmenu', e => e.preventDefault());
  m.addEventListener('keydown', e => {
    const list = btns(), cur = list.indexOf(document.activeElement), k = e.key;
    const go = i => focusBtn(list[(i + list.length) % list.length]);
    if (k === 'ArrowDown') go(cur + 1);
    else if (k === 'ArrowUp') go(cur < 0 ? list.length - 1 : cur - 1);
    else if (k === 'Home') go(0);
    else if (k === 'End') go(list.length - 1);
    else if (k === 'ArrowRight') { if (cur >= 0 && list[cur].getAttribute('aria-haspopup')) openSub(list[cur], true); }
    else if (k === 'ArrowLeft') { if (api.parent) { const p = api.parent; p.closeChild(); p.refocus(); } }
    else if (k === 'Enter' || k === ' ') { if (cur >= 0) choose(list[cur]); }
    else if (k === 'Escape') { if (api.parent) { const p = api.parent; p.closeChild(); p.refocus(); } else done(null); }
    else if (k === 'Tab') done(null);
    else if (k.length === 1 && /\S/.test(k)) {
      const q = k.toLowerCase(), n = list.length;
      for (let j = 1; j <= n; j++) { const b = list[(cur + j + n) % n]; if (b.textContent.trim().toLowerCase().startsWith(q)) { focusBtn(b); break; } }
    } else return;
    e.preventDefault(); e.stopPropagation();
  });
  const api = {
    el: m, parent: null,
    first() { focusBtn(btns()[0]); if (!btns().length) m.focus(); },
    refocus() { const b = m.querySelector('.ntKMi.on') || btns()[0]; if (b) b.focus({ preventScroll: true }); else m.focus(); },
    closeChild,
    close() { clearTimeout(hoverT); closeChild(); light(null); m.remove(); },
    contains: t => m.contains(t) || (child && child.contains(t))
  };
  return api;
}

export function ctxMenu(at, items, o = {}) {
  if (open) open.cancel();
  document.querySelectorAll('.sMenu').forEach(m => m.remove()); // menu de l'application encore ouvert
  const back = o.restore || document.activeElement;
  return new Promise(resolve => {
    let root = null;
    const finish = it => {
      if (!root) return;
      root.close(); root = null; open = null;
      removeEventListener('pointerdown', out, true); removeEventListener('blur', cancel); removeEventListener('resize', cancel);
      if (back && back.focus && document.contains(back)) { try { back.focus({ preventScroll: true }); } catch (e) { /* rien */ } }
      if (it && typeof it.run === 'function') { try { it.run(); } catch (e) { console.error(e); } }
      resolve(it ? (it.value !== undefined ? it.value : it) : null);
    };
    const cancel = () => finish(null);
    const out = e => { if (root && !root.contains(e.target)) { finish(null); if (e.button === 2) e.stopPropagation(); } };
    root = build(items.filter(x => x !== false && x != null), 0, finish);
    // Position : pointeur, élément (dessous), clavier (sous l'élément visé), point.
    let x = 0, y = 0, alt = null;
    if (at && typeof at.clientX === 'number' && (at.clientX || at.clientY)) { x = at.clientX; y = at.clientY; }
    else {
      const elx = at instanceof Element ? at : at && at.target instanceof Element ? at.target : null;
      if (elx) { const r = elx.getBoundingClientRect(); x = r.left; y = r.bottom + 4; alt = r.right; }
      else if (at && Number.isFinite(at.x)) { x = at.x; y = at.y; }
    }
    if (at && at.preventDefault && at.type === 'contextmenu') at.preventDefault();
    place(root.el, x, y, alt);
    open = { cancel };
    setTimeout(() => { addEventListener('pointerdown', out, true); addEventListener('blur', cancel); addEventListener('resize', cancel); });
    // Le premier élément prend le focus (les flèches marchent tout de suite, au clavier comme à la souris).
    root.first();
  });
}

/** Menu sous un bouton, même forme que school/ui.js menu(anchor, items). */
export const menuAt = (anchor, items, o) => ctxMenu(anchor, items, o);
/** Ferme le menu ouvert (changement de vue, projet fermé). */
export function closeMenus() { if (open) open.cancel(); }

/**
 * Amène el en vue en ne faisant défiler que son panneau (premier ancêtre qui défile vraiment en hauteur) :
 * scrollIntoView déplace aussi les ancêtres en overflow: hidden (la fenêtre entière glisse).
 */
export function scrollWithin(el, block = 'start', smooth = true) {
  let p = el && el.parentElement;
  for (; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 1) break; }
  if (!p) return false;
  const a = el.getBoundingClientRect(), b = p.getBoundingClientRect();
  let top = p.scrollTop + a.top - b.top - 8;
  if (block === 'center') top -= Math.max(0, (p.clientHeight - a.height) / 2 - 8);
  else if (block === 'nearest') { if (a.top >= b.top && a.bottom <= b.bottom) return true; if (a.top >= b.top) top = p.scrollTop + a.bottom - b.bottom + 8; }
  top = Math.max(0, Math.min(p.scrollHeight - p.clientHeight, top));
  if (smooth && p.scrollTo && !matchMedia('(prefers-reduced-motion: reduce)').matches) p.scrollTo({ top, behavior: 'smooth' }); else p.scrollTop = top;
  return true;
}

