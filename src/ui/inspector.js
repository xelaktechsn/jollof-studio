// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Inspecteur (panneau de droite : Câblage, Code, Simulation…) : réglages de mise en page retenus
// d'une session à l'autre.
// - largeur : on tire son bord gauche (double-clic : largeur d'origine) ;
// - sections repliables : un clic sur le titre d'une section marquée data-fold ;
// - hauteur de l'éditeur de code et du moniteur série : poignée sous chacun (data-resize) ;
// - filtre de la liste des connexions ; conseils que l'on peut masquer (data-dismiss) ;
// - onglets : libellés dans un <span> pour qu'ils puissent se réduire quand l'inspecteur est étroit.
import { tl } from '../i18n/index.js';

const KEY = { width: 'jollof-insp-w', folds: 'jollof-folds', heights: 'jollof-heights', tips: 'jollof-tips-off' };
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } };
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function installInspector() {
  const app = document.querySelector('.app'), panel = document.querySelector('.panel.right');
  if (!app || !panel) return;
  width(app, panel);
  folds(panel);
  heights(panel);
  tips(panel);
  wireFilter();
  tabLabels(panel.querySelector('.tabs'));
}

/* ---------- Largeur ---------- */
function width(app, panel) {
  const grip = document.createElement('div');
  grip.className = 'insGrip'; grip.tabIndex = 0;
  grip.setAttribute('role', 'separator'); grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-label', tl('Largeur de l’inspecteur'));
  grip.title = tl('Tirer pour régler la largeur · double-clic : largeur d’origine');
  panel.prepend(grip);
  const max = () => Math.min(900, Math.round(innerWidth * 0.62));
  const set = (w, save = true) => {
    if (w == null) { app.style.removeProperty('--insUser'); if (save) write(KEY.width, null); return; }
    w = Math.round(Math.max(300, Math.min(max(), w)));
    app.style.setProperty('--insUser', w + 'px'); grip.setAttribute('aria-valuenow', w);
    if (save) write(KEY.width, w);
  };
  // Le bouton « Agrandir » du code (.wide) et une largeur réglée à la main ne vont pas ensemble.
  const unwide = () => { if (app.classList.contains('wide')) document.getElementById('progWide')?.click(); };
  const saved = read(KEY.width, null);
  if (Number.isFinite(saved)) set(saved, false);
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    const start = panel.getBoundingClientRect().width;
    unwide(); set(start, false);
    app.classList.add('resizing'); document.body.classList.add('colResize');
    const move = ev => set(innerWidth - ev.clientX, false);
    const up = () => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      app.classList.remove('resizing'); document.body.classList.remove('colResize');
      set(panel.getBoundingClientRect().width);
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => { unwide(); set(null); });
  grip.addEventListener('keydown', e => {
    const cur = panel.getBoundingClientRect().width, step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft') { e.preventDefault(); unwide(); set(cur + step); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); unwide(); set(cur - step); }
    else if (e.key === 'Home' || e.key === 'Enter') { e.preventDefault(); unwide(); set(null); }
  });
}

/* ---------- Sections repliables ---------- */
function folds(panel) {
  const shut = new Set(read(KEY.folds, []));
  const head = sec => sec.querySelector(':scope > h2, :scope > .secHead > h2');
  const paint = sec => {
    const h = head(sec); if (!h) return;
    const open = !sec.classList.contains('folded');
    h.setAttribute('aria-expanded', open);
    if (open) sec.classList.remove('unread');
  };
  const prep = sec => {
    if (sec.dataset.foldReady) return;
    const h = head(sec); if (!h) return;
    sec.dataset.foldReady = '1';
    h.setAttribute('role', 'button'); h.tabIndex = 0; h.classList.add('foldHead');
    h.insertAdjacentHTML('afterbegin', '<span class="foldChev" aria-hidden="true"></span>');
    sec.classList.toggle('folded', shut.has(sec.dataset.fold));
    paint(sec);
  };
  const toggle = sec => {
    sec.classList.toggle('folded');
    if (sec.classList.contains('folded')) shut.add(sec.dataset.fold); else shut.delete(sec.dataset.fold);
    write(KEY.folds, [...shut]); paint(sec);
  };
  const scan = () => panel.querySelectorAll('section[data-fold]').forEach(prep);
  scan();
  // Sections ajoutées plus tard (Périphériques, onglet de séance) : seulement quand une section arrive.
  new MutationObserver(recs => {
    if (recs.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && (n.matches('section[data-fold]') || n.querySelector('section[data-fold]'))))) scan();
  }).observe(panel, { childList: true, subtree: true });
  panel.addEventListener('click', e => {
    const h = e.target.closest('.foldHead'); if (!h) return;
    const sec = h.closest('section[data-fold]'); if (sec) toggle(sec);
  });
  panel.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('foldHead')) { e.preventDefault(); e.target.click(); }
  });
  // Moniteur série replié : une pastille signale ce que la carte vient d'écrire.
  const out = document.getElementById('serialOut'), serial = out && out.closest('section[data-fold]');
  if (out && serial) new MutationObserver(() => { if (serial.classList.contains('folded') && out.textContent) serial.classList.add('unread'); })
    .observe(out, { childList: true, characterData: true, subtree: true });
}

/* ---------- Hauteurs (éditeur, moniteur série) ---------- */
function heights(panel) {
  const saved = read(KEY.heights, {});
  panel.querySelectorAll('.vGrip[data-resize]').forEach(grip => {
    const target = document.getElementById(grip.dataset.resize); if (!target) return;
    const key = grip.dataset.resize, min = +grip.dataset.min || 80;
    grip.tabIndex = 0;
    grip.setAttribute('role', 'separator'); grip.setAttribute('aria-orientation', 'horizontal');
    grip.title = tl('Tirer pour régler la hauteur · double-clic : hauteur d’origine');
    const set = (h, save = true) => {
      if (h == null) { target.style.removeProperty('height'); delete saved[key]; }
      else { h = Math.round(Math.max(min, Math.min(innerHeight * 0.85, h))); target.style.height = h + 'px'; saved[key] = h; }
      if (save) write(KEY.heights, saved);
      target.dispatchEvent(new Event('resized'));
    };
    if (Number.isFinite(saved[key])) set(saved[key], false);
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); grip.setPointerCapture(e.pointerId);
      const y0 = e.clientY, h0 = target.getBoundingClientRect().height;
      document.body.classList.add('rowResize');
      const move = ev => set(h0 + ev.clientY - y0, false);
      const up = () => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
        document.body.classList.remove('rowResize'); write(KEY.heights, saved);
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('dblclick', () => set(null));
    grip.addEventListener('keydown', e => {
      const cur = target.getBoundingClientRect().height;
      if (e.key === 'ArrowDown') { e.preventDefault(); set(cur + 20); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); set(cur - 20); }
      else if (e.key === 'Home' || e.key === 'Enter') { e.preventDefault(); set(null); }
    });
  });
}

/* ---------- Conseils masquables ---------- */
function tips(panel) {
  const off = new Set(read(KEY.tips, []));
  panel.querySelectorAll('[data-dismiss]').forEach(b => {
    const el = document.getElementById(b.dataset.dismiss); if (!el) return;
    if (off.has(el.id)) el.hidden = true;
    b.addEventListener('click', () => { el.hidden = true; off.add(el.id); write(KEY.tips, [...off]); });
  });
}

/* ---------- Filtre des connexions ---------- */
function wireFilter() {
  const box = document.getElementById('wireFilterBox'), input = document.getElementById('wireFilter');
  const lists = ['wires', 'nets'].map(id => document.getElementById(id)).filter(Boolean), parts = document.getElementById('wireParts');
  if (!box || !input || !lists.length) return;
  let busy = false;
  const apply = () => {
    if (busy) return; busy = true;
    const q = norm(input.value.trim()), rows = lists[0].querySelectorAll(':scope > li:not(.emptyRow)');
    box.hidden = rows.length < 7 && !q;
    let shown = 0;
    lists.forEach(l => l.querySelectorAll(':scope > li:not(.emptyRow)').forEach(li => {
      const hit = !q || norm(li.textContent).includes(q);
      li.classList.toggle('fx', !hit); if (hit && l === lists[0]) shown++;
    }));
    // Vue par composant : un composant dont le nom correspond garde toutes ses lignes ; les cartes repliées s'ouvrent.
    if (parts) {
      parts.classList.toggle('filtering', !!q);
      parts.querySelectorAll('.wpGroup').forEach(g => {
        const head = !!q && norm(g.querySelector('.wpHead')?.textContent || '').includes(q);
        let any = false;
        g.querySelectorAll('.wpRows > li').forEach(li => { const hit = !q || head || norm(li.textContent).includes(q); li.classList.toggle('fx', !hit); any = any || hit; });
        g.classList.toggle('fx', !!q && !any);
      });
    }
    box.dataset.count = q ? tl('{0} sur {1}', shown, rows.length) : '';
    busy = false;
  };
  input.addEventListener('input', apply);
  input.addEventListener('keydown', e => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; apply(); } });
  [...lists, parts].filter(Boolean).forEach(l => new MutationObserver(apply).observe(l, { childList: true }));
  apply();
}

/* ---------- Onglets ---------- */
function tabLabels(tabs) {
  if (!tabs) return;
  const wrap = () => tabs.querySelectorAll(':scope > .tab').forEach(t => {
    t.childNodes.forEach(n => {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) return;
      const s = document.createElement('span'); s.className = 'tl'; s.textContent = n.nodeValue.trim(); n.replaceWith(s);
    });
    const label = t.querySelector(':scope > .tl, :scope > span:not([class])');
    if (label) t.dataset.tip = label.textContent;
  });
  // Libellés affichés tant qu'ils tiennent ; sinon (inspecteur étroit, pastilles en plus), seul l'onglet choisi garde le sien.
  const fit = () => { tabs.classList.remove('tight'); if (tabs.scrollWidth > tabs.clientWidth + 1) tabs.classList.add('tight'); };
  const update = () => { wrap(); fit(); };
  update();
  new MutationObserver(update).observe(tabs, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-selected'] });
  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(tabs);
}
