// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Navigation commune des plans de travail (scène 3D, schéma, logique, pneumatique) : une barre flottante, la même
// partout, au bord droit du plan.
//   Outils : sélection (V), orbite (O, scène 3D), main (H : glisser déplace la vue), loupe (Z : tracer la zone à
//   agrandir ; clic : zoomer, Alt + clic : dézoomer). Espace maintenu : la main, le temps du geste.
//   Zoom : −, +, pourcentage (menu : tout voir, sélection, 50 %, 100 %, 200 %, 400 %).
//   Tout voir (F, Maj+1), cadrer la sélection (Maj+F, Maj+2), 100 % (Maj+0), mini-carte (M), raccourcis (?).
// Chaque plan de travail fournit un adaptateur (voir createNavDock) ; la barre ne connaît rien de son contenu.
import { tl, isEn } from '../i18n/index.js';
import { icon } from './icons.js';
import { menu as popMenu } from '../school/ui.js';
import './navdock.css';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const MINI_KEY = 'jollof-minimap';
const pref = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TOOLS = {
  select: { ic: 'pointer', key: 'v', tip: () => tl('Sélection · V : cliquer pour choisir, glisser dans le vide pour encadrer'), name: () => tl('Sélection') },
  orbit: { ic: 'orbit', key: 'o', tip: () => tl('Orbite · O : glisser pour tourner autour du montage'), name: () => tl('Orbite') },
  pan: { ic: 'hand', key: 'h', tip: () => tl('Main · H : glisser pour déplacer la vue (ou Espace maintenu)'), name: () => tl('Main : déplacer la vue') },
  zoom: { ic: 'zoomArea', key: 'z', tip: () => tl('Loupe · Z : tracer la zone à agrandir (clic : zoomer, Alt + clic : dézoomer)'), name: () => tl('Loupe : tracer la zone à agrandir') }
};

/** Touches d'un raccourci, à la façon du système : « Shift+F|Shift+2 » → ⇧F ou ⇧2 sur Mac, Maj+F ou Maj+2 ailleurs. */
export function keysHtml(s) {
  const word = {
    Shift: MAC ? '⇧' : tl('Maj'), Mod: MAC ? '⌘' : 'Ctrl', Alt: MAC ? '⌥' : 'Alt', Space: tl('Espace'),
    Wheel: tl('Molette'), Drag: tl('glisser'), Click: tl('clic'), Plus: '+', Minus: '−', Del: tl('Suppr'), Esc: tl('Échap')
  };
  // Sur Mac, ⇧ ⌘ ⌥ se collent à la touche (⇧F, ⌘A) ; un mot (Espace, glisser) garde « + ».
  const sym = t => MAC && ['Shift', 'Mod', 'Alt'].includes(t);
  const combo = alt => alt.split('+').map((t, i, a) => esc(word[t] || t) + (i < a.length - 1 ? (sym(t) && a[i + 1].length === 1 ? '' : ' + ') : '')).join('');
  return s.split('|').map(alt => `<kbd>${combo(alt)}</kbd>`).join(`<span class="ndOr">${tl('ou')}</span>`);
}

/**
 * Trace un rectangle au glisser (coordonnées de la fenêtre) depuis l'événement e (pointerdown).
 * done(r, ev, moved) à la fin : r = { x, y, w, h } ; moved = faux pour un simple clic. cls : classe en plus.
 */
export function dragRect(e, done, cls = '') {
  const x0 = e.clientX, y0 = e.clientY;
  let moved = false;
  const box = document.createElement('div'); box.className = 'ndRect' + (cls ? ' ' + cls : ''); box.hidden = true;
  document.body.appendChild(box);
  const rect = ev => ({ x: Math.min(x0, ev.clientX), y: Math.min(y0, ev.clientY), w: Math.abs(ev.clientX - x0), h: Math.abs(ev.clientY - y0) });
  const mv = ev => {
    const r = rect(ev);
    if (!moved && Math.hypot(r.w, r.h) > 4) moved = true;
    if (!moved) return;
    Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }); box.hidden = false;
  };
  const end = ev => {
    removeEventListener('pointermove', mv, true); removeEventListener('pointerup', end, true); removeEventListener('pointercancel', end, true);
    box.remove(); done(rect(ev), ev, moved && ev.type === 'pointerup');
  };
  addEventListener('pointermove', mv, true); addEventListener('pointerup', end, true); addEventListener('pointercancel', end, true);
}

/**
 * host : conteneur positionné du plan de travail (la barre et la mini-carte s'y ajoutent).
 * A (adaptateur) :
 *   active() → le plan est affiché ; target() → surface qui reçoit le pointeur (canevas, SVG) ;
 *   tools() → outils proposés, le premier par défaut (« select », « orbit », « pan », « zoom ») ; tips : bulles propres ;
 *   zoomBy(f, x, y) (x, y : pixels dans la surface ; sans eux, le centre) ; panBy(dx, dy) : le contenu suit de dx, dy pixels ;
 *   zoomPct() → pourcentage ou null ; setZoomPct(p) ; fit() ; fitSel() → faux si rien n'est choisi ; hasSel() ;
 *   zoomRect(r, surfaceRect) → faux pour le calcul commun ; status(msg) ; title : nom du plan (aide) ;
 *   shortcuts() → [[touches, action]] propres au plan ; onTool(t) ;
 *   mini : { data() → { bounds: [x0, y0, x1, y1], boxes: [[x, y, w, h, choisi]], view: [x0, y0, x1, y1] ou [[x, y]…] } ou null,
 *            centerOn(x, y) } (coordonnées du plan, y vers le bas).
 */
export function createNavDock(host, A) {
  const tools = () => (A.tools ? A.tools() : ['select', 'pan', 'zoom']);
  let tool = tools()[0], toolsKey = '', space = false, panning = false, help = null, raf = 0;
  const kept = {}; // outil choisi pour chaque jeu d'outils (scène 3D, schéma) : on le retrouve en y revenant
  let miniOn = pref(MINI_KEY, '0') === '1', miniDrag = false, ext = null;
  const active = () => (A.active ? A.active() : true) && !host.hidden;

  const dock = document.createElement('div');
  dock.className = 'ndDock' + (A.cls ? ' ' + A.cls : '');
  dock.setAttribute('role', 'toolbar'); dock.setAttribute('aria-orientation', 'vertical'); dock.setAttribute('aria-label', tl('Navigation du plan de travail'));
  const mini = document.createElement('div');
  mini.className = 'ndMini' + (A.cls ? ' ' + A.cls : ''); mini.hidden = true;
  mini.setAttribute('aria-label', tl('Mini-carte : cliquer ou glisser pour s’y rendre'));
  mini.innerHTML = '<canvas></canvas>';
  host.append(dock, mini);
  const cv = mini.querySelector('canvas'), g = cv.getContext('2d');

  const tipOf = t => (A.tips && A.tips[t]) || TOOLS[t].tip();
  function build() {
    const ts = tools(), key = ts.join();
    if (toolsKey && key !== toolsKey) tool = kept[key] || ts[0];
    toolsKey = key;
    if (!ts.includes(tool)) tool = ts[0];
    const b = (nd, ic, tip, extra = '') => `<button type="button" class="ndB" data-nd="${nd}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"${extra}>${icon(ic)}</button>`;
    dock.innerHTML = `<div class="ndG">${ts.map(t => b('tool:' + t, TOOLS[t].ic, tipOf(t), ` aria-pressed="${t === tool}"`)).join('')}</div>`
      + `<div class="ndG">${b('in', 'zoomIn', tl('Zoomer · +'))}<button type="button" class="ndB ndPct" data-nd="pct" data-tip="${esc(tl('Niveau de zoom'))}" aria-label="${esc(tl('Niveau de zoom'))}" aria-haspopup="menu" hidden></button>${b('out', 'zoomOut', tl('Dézoomer · −'))}</div>`
      + `<div class="ndG">${b('fit', 'fitAll', tl('Tout voir · F'))}${A.fitSel ? b('sel', 'focus', tl('Cadrer la sélection · Maj+F')) : ''}</div>`
      + `<div class="ndG">${A.mini ? b('mini', 'minimap', tl('Mini-carte · M'), ` aria-pressed="${miniOn}"`) : ''}${b('help', 'keyboard', tl('Raccourcis · ?'))}</div>`;
  }
  // Un clic sur la barre ne prend pas le focus : le clavier reste au plan de travail.
  dock.addEventListener('mousedown', e => e.preventDefault());
  dock.addEventListener('click', e => {
    const b = e.target.closest('[data-nd]'); if (!b || b.disabled) return;
    const a = b.dataset.nd;
    if (a.startsWith('tool:')) setTool(a.slice(5));
    else if (a === 'in') zoomStep(1.25);
    else if (a === 'out') zoomStep(0.8);
    else if (a === 'pct') pctMenu(b);
    else if (a === 'fit') A.fit();
    else if (a === 'sel') fitSel();
    else if (a === 'mini') setMini(!miniOn);
    else if (a === 'help') toggleHelp();
    update();
  });

  function setTool(t) {
    if (!tools().includes(t)) return;
    tool = t; kept[toolsKey] = t; if (A.onTool) A.onTool(t);
    if (t === 'zoom' && A.status) A.status(tl('Loupe : tracez la zone à agrandir. Clic : zoomer, Alt + clic : dézoomer. Échap : retour à la sélection.'));
    update();
  }
  const zoomStep = f => { A.zoomBy(f); update(); };
  function fitSel() {
    if (A.fitSel && A.fitSel()) { update(); return; }
    if (A.status) A.status(tl('Rien n’est sélectionné : cliquez sur un élément, ou encadrez-en plusieurs.'));
  }
  async function pctMenu(anchor) {
    const items = [{ label: tl('Tout voir · F'), icon: 'fitAll', value: 'fit' }];
    if (A.fitSel) items.push({ label: tl('Cadrer la sélection · Maj+F'), icon: 'focus', value: 'sel' });
    if (A.setZoomPct) items.push('-', ...[50, 100, 200, 400].map(p => ({ label: (isEn ? p + '%' : p + ' %') + (p === 100 ? ' · ' + (MAC ? '⇧0' : tl('Maj') + '+0') : ''), value: p })));
    const v = await popMenu(anchor, items);
    if (v === 'fit') A.fit(); else if (v === 'sel') fitSel(); else if (typeof v === 'number') A.setZoomPct(v);
    update();
  }

  /* ---------- Main et loupe : le geste est pris avant le plan de travail ---------- */
  host.addEventListener('pointerdown', e => {
    if (!active() || e.button !== 0) return;
    const surf = A.target(); if (!surf || !surf.contains(e.target)) return;
    const t = space ? 'pan' : tool;
    if (t !== 'pan' && t !== 'zoom') return;
    e.stopPropagation(); e.preventDefault();
    if (t === 'pan') panDrag(e); else zoomDrag(e, surf);
  }, true);
  function panDrag(e) {
    let x = e.clientX, y = e.clientY; panning = true; paintCursor();
    const mv = ev => { A.panBy(ev.clientX - x, ev.clientY - y); x = ev.clientX; y = ev.clientY; update(); };
    const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true); panning = false; paintCursor(); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
  }
  function zoomDrag(e, surf) {
    dragRect(e, (r, ev, moved) => {
      const sr = surf.getBoundingClientRect();
      if (!moved) { if (ev.type === 'pointerup') A.zoomBy(ev.altKey ? 0.5 : 2, ev.clientX - sr.left, ev.clientY - sr.top); update(); return; }
      zoomToRect({ x: r.x - sr.left, y: r.y - sr.top, w: r.w, h: r.h }, sr); update();
    }, 'ndZoomRect');
  }
  function zoomToRect(r, sr) {
    if (A.zoomRect && A.zoomRect(r, sr) !== false) return;
    const W = sr.width, H = sr.height, f = Math.min(W / Math.max(8, r.w), H / Math.max(8, r.h)) * 0.95;
    A.panBy(W / 2 - (r.x + r.w / 2), H / 2 - (r.y + r.h / 2)); A.zoomBy(f, W / 2, H / 2);
  }

  /* ---------- Clavier (appelé par le plan de travail, avant ses propres raccourcis) ---------- */
  function key(e) {
    if (e.type === 'keyup') { if (e.key === ' ' && space) { space = false; paintCursor(); } return false; }
    if (!active() || e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key, lk = k.toLowerCase();
    if (k === ' ') { if (!space) { space = true; paintCursor(); } return true; }
    if (help && (k === 'Escape' || k === '?')) { toggleHelp(false); return true; }
    if (k === '?') { toggleHelp(true); return true; }
    if (k === '+' || k === '=') { zoomStep(1.25); return true; }
    if (k === '-' || k === '_') { zoomStep(0.8); return true; }
    if (e.shiftKey) {
      if (e.code === 'Digit1') { A.fit(); update(); return true; }
      if (e.code === 'Digit2' || lk === 'f') { fitSel(); return true; }
      if (e.code === 'Digit0' && A.setZoomPct) { A.setZoomPct(100); update(); return true; }
      return false;
    }
    if (lk === 'f') { A.fit(); update(); return true; }
    if (lk === 'm' && A.mini) { setMini(!miniOn); return true; }
    const t = Object.keys(TOOLS).find(n => TOOLS[n].key === lk);
    if (t && tools().includes(t)) { setTool(t); return true; }
    if (k === 'Escape' && tool !== tools()[0]) { setTool(tools()[0]); return true; }
    return false;
  }
  /** Fenêtre quittée pendant qu'Espace était enfoncé : la main ne reste pas active. */
  addEventListener('blur', () => { if (space) { space = false; paintCursor(); } });

  /* ---------- Aide : raccourcis ---------- */
  function toggleHelp(v = !help) {
    if (!v) { if (help) { help.remove(); help = null; } return; }
    if (help) return;
    const ts = tools(), row = ([k, label]) => `<div class="ndRow"><span>${esc(label)}</span><span>${keysHtml(k)}</span></div>`;
    const nav = [
      ['Wheel', tl('Zoomer vers le curseur')],
      ['Space+Drag', tl('Déplacer la vue')],
      ...ts.map(t => [TOOLS[t].key.toUpperCase(), TOOLS[t].name()]),
      ['F|Shift+1', tl('Tout voir')],
      ...(A.fitSel ? [['Shift+F|Shift+2', tl('Cadrer la sélection')]] : []),
      ['Plus|Minus', tl('Zoomer, dézoomer')],
      ...(A.setZoomPct ? [['Shift+0', tl('Zoom à 100 %')]] : []),
      ...(A.mini ? [['M', tl('Mini-carte')]] : []),
      ['?', tl('Afficher ou masquer cette aide')]
    ];
    const own = A.shortcuts ? A.shortcuts() : [];
    help = document.createElement('div'); help.className = 'ndHelp';
    help.setAttribute('role', 'dialog'); help.setAttribute('aria-label', tl('Raccourcis du plan de travail'));
    help.innerHTML = `<div class="ndHelpCard"><header><b>${icon('keyboard')}${tl('Raccourcis du plan de travail')}</b><button type="button" class="ndB" data-close aria-label="${esc(tl('Fermer'))}">${icon('x')}</button></header>
      <div class="ndCols"><section><h4>${tl('Navigation')}</h4>${nav.map(row).join('')}</section>${own.length ? `<section><h4>${esc(A.title || tl('Édition'))}</h4>${own.map(row).join('')}</section>` : ''}</div></div>`;
    document.body.appendChild(help); // fenêtre entière : lisible même dans un plan étroit (vue partagée)
    help.addEventListener('click', e => { if (e.target === help || e.target.closest('[data-close]')) toggleHelp(false); });
  }

  /* ---------- Mini-carte ---------- */
  function setMini(v) { miniOn = v; setPref(MINI_KEY, v ? '1' : '0'); const b = dock.querySelector('[data-nd="mini"]'); if (b) b.setAttribute('aria-pressed', String(v)); update(); }
  const MW = 188, MH = 124;
  function drawMini() {
    const d = miniOn && A.mini && active() ? A.mini.data() : null;
    mini.hidden = !d; if (!d) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(MW * dpr)) { cv.width = Math.round(MW * dpr); cv.height = Math.round(MH * dpr); cv.style.width = MW + 'px'; cv.style.height = MH + 'px'; }
    const v = d.view, poly = Array.isArray(v[0]) ? v : [[v[0], v[1]], [v[2], v[1]], [v[2], v[3]], [v[0], v[3]]];
    if (!miniDrag || !ext) {
      // Emprise : le dessin et la partie visible, sans laisser une vue très lointaine écraser le dessin.
      let [x0, y0, x1, y1] = d.bounds;
      const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0), lim = [x0 - bw * 1.5, y0 - bh * 1.5, x1 + bw * 1.5, y1 + bh * 1.5];
      for (const [x, y] of poly) {
        const cx = Math.max(lim[0], Math.min(lim[2], x)), cy = Math.max(lim[1], Math.min(lim[3], y));
        x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      }
      const pw = (x1 - x0) * 0.06 + 1, ph = (y1 - y0) * 0.06 + 1; x0 -= pw; x1 += pw; y0 -= ph; y1 += ph;
      const s = Math.min(MW / (x1 - x0), MH / (y1 - y0));
      ext = { s, ox: (MW - (x1 - x0) * s) / 2 - x0 * s, oy: (MH - (y1 - y0) * s) / 2 - y0 * s };
    }
    const { s, ox, oy } = ext, X = x => ox + x * s, Y = y => oy + y * s;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, MW, MH);
    for (const [x, y, w, h, on] of d.boxes) {
      g.fillStyle = on ? '#60a5fa' : '#4b5b69';
      g.fillRect(X(x), Y(y), Math.max(1.5, w * s), Math.max(1.5, h * s));
    }
    g.beginPath(); poly.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath();
    g.fillStyle = '#3b82f622'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#60a5fa'; g.stroke();
  }
  const goMini = e => {
    if (!ext) return;
    const r = cv.getBoundingClientRect();
    A.mini.centerOn((e.clientX - r.left - ext.ox) / ext.s, (e.clientY - r.top - ext.oy) / ext.s); update();
  };
  mini.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); miniDrag = true; mini.setPointerCapture(e.pointerId); goMini(e); });
  mini.addEventListener('pointermove', e => { if (miniDrag) goMini(e); });
  const miniUp = () => { if (!miniDrag) return; miniDrag = false; update(); };
  mini.addEventListener('pointerup', miniUp); mini.addEventListener('pointercancel', miniUp);
  mini.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); A.zoomBy(Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.0018)); update(); }, { passive: false });

  /* ---------- Affichage ---------- */
  function paintCursor() {
    const s = A.target(); if (!s) return;
    s.classList.add('ndSurf');
    s.classList.toggle('ndPan', active() && (tool === 'pan' || space));
    s.classList.toggle('ndZoom', active() && tool === 'zoom' && !space);
    s.classList.toggle('ndPanning', panning);
  }
  function paint() {
    if (tools().join() !== toolsKey) build();
    const on = active(); dock.hidden = !on;
    if (!on) { mini.hidden = true; if (help) toggleHelp(false); return; }
    const p = A.zoomPct ? A.zoomPct() : null, pb = dock.querySelector('.ndPct');
    pb.hidden = p == null; if (p != null) pb.textContent = (p >= 995 ? Math.round(p / 100) / 10 + 'k' : Math.round(p)) + '%';
    const sb = dock.querySelector('[data-nd="sel"]'); if (sb) sb.disabled = !(A.hasSel && A.hasSel());
    dock.querySelectorAll('[data-nd^="tool:"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.nd.slice(5) === tool)));
    paintCursor(); drawMini();
  }
  /** À appeler quand la vue, le contenu ou la sélection changent (regroupé à l'image suivante). */
  function update() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; paint(); }); }
  build(); update();

  return {
    key, update,
    tool: () => (space ? 'pan' : tool), setTool,
    /** Outil par défaut remis (projet ouvert, plan de travail quitté). */
    reset() { space = false; panning = false; if (tool !== tools()[0]) setTool(tools()[0]); toggleHelp(false); update(); },
    get el() { return dock; }
  };
}
