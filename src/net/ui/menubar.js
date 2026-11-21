// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Barre de menus de la barre d'application (Fichier, Édition, Affichage…), à la manière d'un logiciel de bureau : un
// clic ouvre un menu, le survol passe au voisin tant qu'un menu est ouvert, sous-menus au survol ou par →. Clavier :
// F10 donne le focus à la barre ; ← → changent de menu ; ↑ ↓ Début Fin parcourent ; Entrée ou Espace exécutent ; une
// lettre va à l'entrée qui commence par elle ; Échap referme (le sous-menu d'abord). Les menus sont des données
// (src/net/menus.js), recalculés à chaque ouverture (états cochés, grisés). Trop étroite, la barre se replie en un
// seul bouton dont les menus deviennent des sous-menus. Chargée avec le module réseau (chunk à la demande).
import { icon } from '../../ui/icons.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * o : { after (élément après lequel la barre se pose), model() → [{ id, label, items }], run(item), keyLabel(keys),
 * label (nom de la barre, lecteurs d'écran), more (libellé du bouton replié), when() → la barre se montre,
 * keyFirst(fn) (écoute du clavier avant les plans de travail : shell.js onKeyFirst) }.
 * Rend { el, refresh(), close(), isOpen(), focus() }.
 */
export function createMenuBar(o) {
  const nav = document.createElement('nav');
  nav.className = 'ntMb'; nav.setAttribute('role', 'menubar'); nav.setAttribute('aria-label', o.label || 'Menus');
  o.after.after(nav);
  let menus = [], compact = false, fullW = 0, openI = -1, stack = []; // stack : popups ouverts (racine, sous-menus)

  /* ---------- Barre ---------- */
  function shown() { try { return !o.when || o.when(); } catch (e) { return false; } }
  function paintBar() {
    nav.hidden = !shown();
    if (nav.hidden) { close(); return; }
    menus = o.model();
    const tops = compact ? [{ id: '_all', label: o.more || '☰' }] : menus;
    nav.innerHTML = tops.map((m, i) => `<button type="button" class="ntMbTop${compact ? ' ntMbAll' : ''}" role="menuitem" aria-haspopup="menu" aria-expanded="false" data-m="${i}" tabindex="${i ? -1 : 0}"${compact ? ` aria-label="${esc(m.label)}" data-tip="${esc(m.label)}"` : ''}>${compact ? icon('menuBars') + `<span>${esc(m.label)}</span>` : esc(m.label)}</button>`).join('');
    if (!compact) fullW = nav.scrollWidth;
  }
  /** Repli : la barre entière ne tient plus dans la place laissée par l'application (ou y tient de nouveau). */
  function fit() {
    if (nav.hidden) return;
    const room = nav.clientWidth + spare();
    const want = !compact ? nav.scrollWidth > nav.clientWidth + 1 : fullW > room;
    if (want !== compact) { compact = want; close(); paintBar(); }
  }
  /** Place libre à côté de la barre (l'espace extensible de la barre d'application). */
  const spare = () => { const g = nav.parentElement && nav.parentElement.querySelector(':scope > .grow'); return g ? g.getBoundingClientRect().width : 0; };
  const topBtn = i => nav.querySelector(`[data-m="${i}"]`);
  const modelOf = i => (compact ? { id: '_all', label: o.more, items: menus.map(m => ({ id: 'm.' + m.id, label: m.label, sub: m.items })) } : menus[i]);

  /* ---------- Menus ---------- */
  function rowHtml(it, i) {
    if (it.sep) return '<div class="ntMbSep" role="separator"></div>';
    const role = it.checked != null ? (it.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem';
    const ck = it.checked != null ? `<span class="ntMbCk${it.radio ? ' radio' : ''}" aria-hidden="true">${it.checked ? (it.radio ? '<i class="ntMbDot"></i>' : icon('check')) : ''}</span>` : '<span class="ntMbCk" aria-hidden="true"></span>';
    return `<button type="button" class="ntMbItem" role="${role}" tabindex="-1" data-i="${i}"${it.checked != null ? ` aria-checked="${!!it.checked}"` : ''}${it.disabled ? ' aria-disabled="true"' : ''}${it.sub ? ' aria-haspopup="menu" aria-expanded="false"' : ''}>${ck}<span class="ntMbIc">${it.icon ? icon(it.icon) : ''}</span><span class="ntMbLab">${esc(it.label)}</span>${it.sub ? `<span class="ntMbArrow">${icon('chevRight')}</span>` : `<kbd>${esc(o.keyLabel ? o.keyLabel(it.keys) : it.keys)}</kbd>`}</button>`;
  }
  function popup(items, anchor, level) {
    const p = document.createElement('div');
    p.className = 'ntMbPop'; p.setAttribute('role', 'menu'); p.dataset.level = level;
    p.innerHTML = items.map(rowHtml).join('');
    document.body.appendChild(p);
    const r = anchor.getBoundingClientRect(), W = innerWidth, H = innerHeight, pw = p.offsetWidth, ph = p.offsetHeight;
    let x = level ? r.right - 2 : r.left, y = level ? r.top - 7 : r.bottom + 4;
    if (level && x + pw > W - 6) x = Math.max(6, r.left - pw + 2); // pas de place à droite : à gauche
    x = Math.max(6, Math.min(x, W - pw - 6)); y = Math.max(6, Math.min(y, H - ph - 6));
    p.style.left = x + 'px'; p.style.top = y + 'px';
    if (ph > H - 12) { p.style.maxHeight = (H - 12) + 'px'; p.style.top = '6px'; }
    const entry = { el: p, items, anchor, level, sel: -1 };
    p.addEventListener('pointermove', e => { const b = e.target.closest('.ntMbItem'); if (b) hover(entry, +b.dataset.i); });
    p.addEventListener('click', e => { const b = e.target.closest('.ntMbItem'); if (b) choose(entry, +b.dataset.i, false); });
    p.addEventListener('mousedown', e => e.preventDefault()); // le focus reste dans le menu
    return entry;
  }
  const rows = entry => [...entry.el.querySelectorAll('.ntMbItem')];
  const usable = (entry, i) => { const it = entry.items[i]; return it && !it.sep && !it.disabled; };
  function setSel(entry, i, focus = true) {
    entry.sel = i;
    for (const b of rows(entry)) b.classList.toggle('on', +b.dataset.i === i);
    const b = entry.el.querySelector(`[data-i="${i}"]`); if (b && focus) b.focus({ preventScroll: false });
  }
  let hoverT = 0;
  function hover(entry, i) {
    if (entry.sel === i && stack[stack.length - 1] === entry) return;
    closeFrom(entry.level + 1); setSel(entry, i);
    clearTimeout(hoverT);
    if (entry.items[i] && entry.items[i].sub && usable(entry, i)) hoverT = setTimeout(() => { if (entry.sel === i) openSub(entry, i, false); }, 160);
  }
  function openSub(entry, i, focusFirst) {
    const it = entry.items[i], btn = entry.el.querySelector(`[data-i="${i}"]`); if (!it || !it.sub || !btn) return;
    closeFrom(entry.level + 1);
    btn.setAttribute('aria-expanded', 'true');
    const sub = popup(it.sub, btn, entry.level + 1); stack.push(sub);
    if (focusFirst) move(sub, 1, -1);
  }
  function closeFrom(level) {
    while (stack.length > level) { const e = stack.pop(); e.el.remove(); if (e.anchor && e.anchor.classList.contains('ntMbItem')) e.anchor.setAttribute('aria-expanded', 'false'); }
  }
  function choose(entry, i, kb) {
    const it = entry.items[i]; if (!it || it.sep || it.disabled) return;
    if (it.sub) { openSub(entry, i, kb); return; }
    close(); try { o.run(it); } catch (e) { console.error(e); }
  }
  /** Prochaine entrée utilisable dans le sens d (1, -1), depuis from. */
  function move(entry, d, from = entry.sel) {
    const n = entry.items.length; if (!n) return;
    for (let k = 1; k <= n; k++) { const i = ((from + d * k) % n + n) % n; if (usable(entry, i)) { setSel(entry, i); return; } }
  }

  function openMenu(i, focusFirst = false) {
    closeFrom(0);
    const m = modelOf(i), btn = topBtn(i); if (!m || !btn) return;
    nav.querySelectorAll('.ntMbTop').forEach(b => { b.setAttribute('aria-expanded', String(b === btn)); b.tabIndex = b === btn ? 0 : -1; });
    openI = i; stack.push(popup(m.items, btn, 0));
    if (focusFirst) move(stack[0], 1, -1); else btn.focus({ preventScroll: true });
    document.addEventListener('pointerdown', outside, true);
  }
  function close(refocus = false) {
    clearTimeout(hoverT);
    if (openI < 0 && !stack.length) return;
    const i = openI; closeFrom(0); openI = -1;
    nav.querySelectorAll('.ntMbTop').forEach(b => b.setAttribute('aria-expanded', 'false'));
    document.removeEventListener('pointerdown', outside, true);
    if (refocus) { const b = topBtn(Math.max(0, i)); if (b) b.focus(); }
  }
  const outside = e => { if (!nav.contains(e.target) && !stack.some(s => s.el.contains(e.target))) close(); };
  const tops = () => nav.querySelectorAll('.ntMbTop').length;

  nav.addEventListener('mousedown', e => { if (e.target.closest('.ntMbTop')) e.preventDefault(); });
  nav.addEventListener('click', e => {
    const b = e.target.closest('.ntMbTop'); if (!b) return;
    const i = +b.dataset.m;
    // Un menu ouvert au survol juste avant le clic reste ouvert (sinon le clic le refermerait aussitôt).
    if (openI === i) { if (performance.now() - hoverAt > 400) close(); } else { menus = o.model(); openMenu(i); }
  });
  let hoverAt = -1e9;
  nav.addEventListener('pointerover', e => { const b = e.target.closest('.ntMbTop'); if (b && openI >= 0 && +b.dataset.m !== openI) { hoverAt = performance.now(); openMenu(+b.dataset.m); } });
  // Clavier dans les menus ouverts : vu avant les plans de travail (shell.js, onKeyFirst), dont les raccourcis ne doivent pas partir.
  (o.keyFirst || (f => addEventListener('keydown', e => { if (f(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true)))(e => {
    if (e.key === 'F10' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !nav.hidden && !document.querySelector('.sDialogWrap')) {
      if (stack.length) close(); else { const t = topBtn(0); if (t) t.focus(); } return true;
    }
    if (!stack.length) return topKey(e);
    if (e.ctrlKey || e.metaKey) { close(); return false; } // raccourci de l'application : le menu se referme, la touche passe
    const top = stack[stack.length - 1], k = e.key;
    let took = false; const take = () => { took = true; };
    if (k === 'ArrowDown') { take(); move(top, 1); }
    else if (k === 'ArrowUp') { take(); move(top, -1); }
    else if (k === 'Home') { take(); move(top, 1, -1); }
    else if (k === 'End') { take(); move(top, -1, 0); }
    else if (k === 'ArrowRight') { take(); const it = top.items[top.sel]; if (it && it.sub && usable(top, top.sel)) openSub(top, top.sel, true); else if (tops() > 1) openMenu((openI + 1) % tops(), true); }
    else if (k === 'ArrowLeft') { take(); if (stack.length > 1) { closeFrom(stack.length - 1); const p = stack[stack.length - 1]; setSel(p, p.sel); } else if (tops() > 1) openMenu((openI - 1 + tops()) % tops(), true); }
    else if (k === 'Enter' || k === ' ') { take(); if (top.sel >= 0) choose(top, top.sel, true); }
    else if (k === 'Escape') { take(); if (stack.length > 1) { closeFrom(stack.length - 1); const p = stack[stack.length - 1]; setSel(p, p.sel); } else close(true); }
    else if (k === 'Tab') { take(); close(); }
    else if (k.length === 1 && /\S/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      take();
      const n = top.items.length, q = k.toLowerCase();
      for (let s = 1; s <= n; s++) { const i = (top.sel + s) % n, it = top.items[i]; if (usable(top, i) && String(it.label).toLowerCase().startsWith(q)) { setSel(top, i); break; } }
    }
    void took; return true; // menu ouvert : aucune autre touche ne va au plan de travail
  });
  /** Focus sur la barre (F10, Tab) : ← → changent de menu, ↓ Entrée Espace l'ouvrent, Échap rend le focus. */
  function topKey(e) {
    const b = document.activeElement; if (!b || !b.classList || !b.classList.contains('ntMbTop') || !nav.contains(b) || e.ctrlKey || e.metaKey || e.altKey) return false;
    const i = +b.dataset.m, n = tops();
    const go = j => { const t = topBtn(((j % n) + n) % n); nav.querySelectorAll('.ntMbTop').forEach(x => { x.tabIndex = x === t ? 0 : -1; }); t.focus(); return true; };
    if (e.key === 'ArrowRight') return go(i + 1);
    if (e.key === 'ArrowLeft') return go(i - 1);
    if (e.key === 'Home') return go(0);
    if (e.key === 'End') return go(n - 1);
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { menus = o.model(); openMenu(i, true); return true; }
    if (e.key === 'Escape') { b.blur(); return true; }
    return false;
  }
  addEventListener('resize', () => close());
  addEventListener('blur', () => close());

  paintBar();
  new ResizeObserver(() => fit()).observe(nav.parentElement);
  requestAnimationFrame(fit);
  return {
    el: nav,
    /** Menus ou langue changés, type du projet changé : la barre se refait (les menus ouverts se referment). */
    refresh() { if (stack.length) return; paintBar(); compact = false; paintBar(); requestAnimationFrame(fit); },
    close, isOpen: () => stack.length > 0,
    focus() { const t = topBtn(0); if (t) t.focus(); }
  };
}
