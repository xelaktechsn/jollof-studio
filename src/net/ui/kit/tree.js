// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Arbre de la trousse réseau : seules les lignes visibles existent dans la page (des milliers de nœuds sans ralentir),
// sélection multiple (Ctrl/⌘+clic, Maj+clic, Ctrl+A), clavier complet (flèches, Début/Fin, Pg préc./suiv., Entrée,
// Espace, F2, Suppr, touche Menu ou Maj+F10, première lettre), renommage sur place, glisser-déposer entre nœuds.
// Rôles ARIA tree/treeitem, focus sur l'arbre et ligne active désignée par aria-activedescendant.
//
// createTree(host, o) → { el, setRoots(roots), setFilter(q) → nombre trouvé, select(keys, { reveal, focus, silent }),
//   selected() → [clés], active() → clé, expand(key, open), expandAll(), collapseAll(), reveal(key), focus(), rename(key),
//   rows() → lignes visibles, node(key), destroy() }
// Nœuds : voir model.js (key, label, sub, icon, children, open, terms) + badge (texte à droite), dot ('warn'|'err'), dim.
// o : { label (nom accessible), rowHeight (26), empty() → html, onSelect(keys, ev), onActivate(node, ev) → true si fait,
//   onContext(node, keys, ev), canRename(node), onRename(node, text), onDelete(keys), onKey(ev, node) → true si fait,
//   drag: { can(nodes) → bool, over(nodes, target) → bool, drop(nodes, target) } }
import './kit.css';
import { icon } from '../../../ui/icons.js';
import { indexTree, ancestors, filterTree, flatten, defaultOpen, rangeKeys, highlightParts, norm } from './model.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let seq = 0;

export function createTree(host, o = {}) {
  const RH = o.rowHeight || 26, uid = 'ntKt' + (++seq), OVER = 8;
  const el = document.createElement('div');
  el.className = 'ntKTree'; el.tabIndex = 0; el.setAttribute('role', 'tree'); el.setAttribute('aria-multiselectable', 'true');
  if (o.label) el.setAttribute('aria-label', o.label);
  el.innerHTML = '<div class="ntKTreeIn" role="presentation"></div>';
  const inner = el.firstChild;
  host.appendChild(el);

  let roots = [], idx = new Map(), expanded = new Set(), seeded = new Set(), filter = null, q = '', rows = [], rowAt = new Map();
  let sel = new Set(), act = null, anchor = null, raf = 0, renaming = null;

  const nodeOf = k => (idx.get(k) || {}).node || null;
  function recompute() {
    rows = flatten(roots, expanded, filter);
    rowAt = new Map(rows.map((r, i) => [r.node.key, i]));
    inner.style.height = rows.length * RH + 'px';
    paint();
  }
  function paint() { if (!raf) raf = requestAnimationFrame(paintNow); }
  function paintNow() {
    raf = 0;
    if (!rows.length) { inner.style.height = ''; inner.innerHTML = o.empty ? `<div class="ntKEmpty">${o.empty(q)}</div>` : ''; el.removeAttribute('aria-activedescendant'); return; }
    const top = el.scrollTop, h = el.clientHeight || 400;
    const i0 = Math.max(0, Math.floor(top / RH) - OVER), i1 = Math.min(rows.length, Math.ceil((top + h) / RH) + OVER);
    let html = '';
    for (let i = i0; i < i1; i++) {
      const { node: n, depth, kids, open } = rows[i], on = sel.has(n.key);
      const lab = renaming === n.key ? `<input class="ntKRen" value="${esc(n.label)}" aria-label="${esc(n.label)}">` : `<span class="ntKLb">${q ? highlightParts(n.label, q).map(([t, m]) => (m ? `<mark>${esc(t)}</mark>` : esc(t))).join('') : esc(n.label)}</span>`;
      html += `<div class="ntKRow${n.key === act ? ' act' : ''}${n.dim ? ' dim' : ''}" role="treeitem" id="${uid}-${i}" data-i="${i}" aria-level="${depth + 1}" aria-selected="${on}"${kids ? ` aria-expanded="${open}"` : ''} style="top:${i * RH}px;padding-left:${4 + depth * 14}px"${n.hint ? ` title="${esc(n.hint)}"` : ''}>`
        + `<span class="ntKTw" data-tw>${kids ? icon('chevRight') : ''}</span>${n.icon ? icon(n.icon, 'ntKIc') : ''}${lab}${n.sub ? `<span class="ntKSub">${esc(n.sub)}</span>` : ''}${n.dot ? `<i class="ntKDot ${n.dot === 'err' ? 'err' : ''}"></i>` : ''}${n.badge != null && n.badge !== '' ? `<span class="ntKBadge">${esc(n.badge)}</span>` : ''}</div>`;
    }
    inner.innerHTML = html;
    // Libellé coupé : le sous-titre s'efface (il reste dans l'infobulle) plutôt que deux textes tronqués.
    for (const r of inner.children) {
      const lb = r.querySelector('.ntKLb'), sb = r.querySelector('.ntKSub'); if (!lb || !sb || lb.scrollWidth <= lb.clientWidth + 1) continue;
      sb.remove(); if (!r.title) { const n = rows[+r.dataset.i].node; r.title = n.sub ? `${n.label} · ${n.sub}` : n.label; }
    }
    const ai = act != null ? rowAt.get(act) : null;
    if (ai != null && ai >= i0 && ai < i1) el.setAttribute('aria-activedescendant', `${uid}-${ai}`); else el.removeAttribute('aria-activedescendant');
    if (renaming) { const inp = inner.querySelector('.ntKRen'); if (inp && document.activeElement !== inp) { inp.focus(); inp.select(); } }
  }
  el.addEventListener('scroll', paint, { passive: true });
  const ro = new ResizeObserver(paint); ro.observe(el);

  /* ---------- Sélection ---------- */
  const emit = ev => { if (o.onSelect) o.onSelect([...sel], ev || null); };
  function scrollTo(i) {
    const top = i * RH, h = el.clientHeight;
    if (top < el.scrollTop) el.scrollTop = top; else if (top + RH > el.scrollTop + h) el.scrollTop = top + RH - h;
  }
  function setAct(k, scroll = true) { act = k; const i = rowAt.get(k); if (scroll && i != null) scrollTo(i); paint(); }
  function pick(k, ev, how = 'one') {
    if (how === 'toggle') { if (sel.has(k)) sel.delete(k); else sel.add(k); anchor = k; }
    else if (how === 'range') { const r = rangeKeys(rows, anchor ?? k, k); sel = new Set(ev && (ev.ctrlKey || ev.metaKey) ? [...sel, ...r] : r); }
    else { sel = new Set([k]); anchor = k; }
    setAct(k); emit(ev);
  }
  function toggleOpen(k, want) {
    const r = rows[rowAt.get(k)]; if (!r || !r.kids || filter) return false;
    const on = want ?? !expanded.has(k); if (on === expanded.has(k)) return false;
    if (on) expanded.add(k); else expanded.delete(k);
    recompute(); return true;
  }
  function reveal(k) {
    if (!idx.has(k)) return false;
    for (const a of ancestors(idx, k)) expanded.add(a);
    if (filter && !filter.keep.has(k)) { filter = null; q = ''; }
    recompute(); act = k; const i = rowAt.get(k); if (i != null) { const h = el.clientHeight; if (i * RH < el.scrollTop || i * RH + RH > el.scrollTop + h) el.scrollTop = Math.max(0, i * RH - h / 2); }
    paint(); return true;
  }

  /* ---------- Souris ---------- */
  const rowEl = t => t && t.closest && t.closest('.ntKRow');
  const rowNode = r => (r ? rows[+r.dataset.i] : null);
  let press = null, drag = null;
  el.addEventListener('pointerdown', e => {
    const r = rowEl(e.target); if (!r || e.target.closest('.ntKRen')) return;
    const row = rowNode(r); if (!row) return;
    el.focus({ preventScroll: true });
    const k = row.node.key;
    if (e.target.closest('[data-tw]') && row.kids && e.button === 0) { act = k; toggleOpen(k); e.preventDefault(); return; }
    if (e.button === 2) { if (!sel.has(k)) pick(k, e); else setAct(k, false); return; }
    if (e.button !== 0) return;
    if (e.shiftKey) pick(k, e, 'range');
    else if (e.ctrlKey || e.metaKey) pick(k, e, 'toggle');
    else if (sel.has(k) && sel.size > 1) { press = { k, x: e.clientX, y: e.clientY, defer: true }; setAct(k, false); }
    else pick(k, e);
    if (!press) press = { k, x: e.clientX, y: e.clientY, defer: false };
    e.preventDefault();
  });
  const onMove = e => {
    if (!press || !o.drag) return;
    if (!drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
      const nodes = [...sel].map(nodeOf).filter(Boolean);
      if (!nodes.length || !o.drag.can || !o.drag.can(nodes)) { press = null; return; }
      const g = document.createElement('div'); g.className = 'ntKGhost';
      g.textContent = nodes.length > 1 ? `${nodes[0].label} +${nodes.length - 1}` : nodes[0].label;
      document.body.appendChild(g); drag = { nodes, ghost: g, target: null };
    }
    drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px';
    const r = rowEl(document.elementFromPoint(e.clientX, e.clientY));
    const t = r && el.contains(r) ? rowNode(r) : null, tn = t ? t.node : null;
    const ok = tn && !drag.nodes.includes(tn) && (!o.drag.over || o.drag.over(drag.nodes, tn));
    inner.querySelectorAll('.ntKRow.drop').forEach(x => x.classList.remove('drop'));
    drag.target = ok ? tn : null; if (ok) r.classList.add('drop');
    // Bord haut ou bas : l'arbre défile.
    const b = el.getBoundingClientRect();
    if (e.clientY < b.top + 18) el.scrollTop -= 12; else if (e.clientY > b.bottom - 18) el.scrollTop += 12;
  };
  const endDrag = drop => {
    if (!drag) return;
    drag.ghost.remove(); inner.querySelectorAll('.ntKRow.drop').forEach(x => x.classList.remove('drop'));
    const d = drag; drag = null;
    if (drop && d.target && o.drag.drop) { try { o.drag.drop(d.nodes, d.target); } catch (err) { console.error(err); } }
  };
  const onUp = e => {
    if (!press) return;
    const p = press; press = null;
    if (drag) { endDrag(true); return; }
    if (p.defer && !e.shiftKey && !e.ctrlKey && !e.metaKey) pick(p.k, e);
  };
  const onEsc = e => { if (drag && e.key === 'Escape') { press = null; endDrag(false); e.stopPropagation(); e.preventDefault(); } };
  addEventListener('pointermove', onMove, true); addEventListener('pointerup', onUp, true); addEventListener('keydown', onEsc, true);
  el.addEventListener('dblclick', e => {
    const r = rowEl(e.target); if (!r || e.target.closest('[data-tw]') || e.target.closest('.ntKRen')) return;
    const row = rowNode(r); if (!row) return;
    const done = o.onActivate ? o.onActivate(row.node, e) : false;
    if (!done && row.kids) toggleOpen(row.node.key);
  });
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    const r = rowEl(e.target), row = r ? rowNode(r) : null;
    if (o.onContext) o.onContext(row ? row.node : null, [...sel], e);
  });

  /* ---------- Clavier ---------- */
  let ta = '', taT = 0;
  el.addEventListener('keydown', e => {
    if (e.target !== el) return; // champ de renommage
    const i = act != null && rowAt.has(act) ? rowAt.get(act) : -1, row = i >= 0 ? rows[i] : null, k = e.key, mod = e.ctrlKey || e.metaKey;
    if (o.onKey && o.onKey(e, row ? row.node : null)) { e.preventDefault(); e.stopPropagation(); return; }
    const page = Math.max(1, Math.floor(el.clientHeight / RH) - 1);
    const go = j => { if (!rows.length) return; j = Math.max(0, Math.min(rows.length - 1, j)); const kk = rows[j].node.key; if (e.shiftKey) pick(kk, e, 'range'); else if (mod) setAct(kk); else pick(kk, e); };
    if (k === 'ArrowDown') go(i + 1);
    else if (k === 'ArrowUp') go(i < 0 ? 0 : i - 1);
    else if (k === 'Home') go(0);
    else if (k === 'End') go(rows.length - 1);
    else if (k === 'PageDown') go(i + page);
    else if (k === 'PageUp') go(i - page);
    else if (k === 'ArrowRight') { if (row && row.kids && !row.open) toggleOpen(row.node.key, true); else if (row && row.open) go(i + 1); }
    else if (k === 'ArrowLeft') { if (row && row.open && !filter) toggleOpen(row.node.key, false); else if (row) { const p = (idx.get(row.node.key) || {}).parent; if (p != null && rowAt.has(p)) go(rowAt.get(p)); } }
    else if (k === 'Enter') { if (row && o.onActivate && !o.onActivate(row.node, e) && row.kids) toggleOpen(row.node.key); }
    else if (k === ' ') { if (row) pick(row.node.key, e, mod ? 'toggle' : 'one'); }
    else if (k === 'F2') { if (row) api.rename(row.node.key); }
    else if (k === 'Delete' || (k === 'Backspace' && mod)) { if (sel.size && o.onDelete) o.onDelete([...sel]); }
    else if (mod && k.toLowerCase() === 'a') { sel = new Set(rows.map(r => r.node.key)); paint(); emit(e); }
    else if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) {
      if (o.onContext) { const r = i >= 0 ? inner.querySelector(`[data-i="${i}"]`) : null; o.onContext(row ? row.node : null, [...sel], r || el); }
    } else if (k === 'Escape') { if (!sel.size) return; sel.clear(); paint(); emit(e); }
    else if (k.length === 1 && !mod && !e.altKey && /\S/.test(k)) {
      clearTimeout(taT); ta += norm(k); taT = setTimeout(() => { ta = ''; }, 700);
      const n = rows.length;
      for (let j = ta.length > 1 ? 0 : 1; j <= n; j++) { const r2 = rows[(i + j + n) % n]; if (norm(r2.node.label).startsWith(ta)) { go((i + j + n) % n); break; } }
    } else return;
    e.preventDefault(); e.stopPropagation();
  });

  /* ---------- Renommage ---------- */
  function endRename(save) {
    const k = renaming; if (k == null) return;
    const inp = inner.querySelector('.ntKRen'), v = inp ? inp.value.trim() : '';
    renaming = null; recompute(); el.focus({ preventScroll: true });
    const n = nodeOf(k); if (save && n && v && v !== n.label && o.onRename) o.onRename(n, v);
  }
  inner.addEventListener('keydown', e => { if (!e.target.classList.contains('ntKRen')) return; e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); endRename(true); } else if (e.key === 'Escape') { e.preventDefault(); endRename(false); } });
  inner.addEventListener('focusout', e => { if (e.target.classList && e.target.classList.contains('ntKRen')) setTimeout(() => { if (renaming != null && !inner.querySelector('.ntKRen:focus')) endRename(true); }); });

  const api = {
    el,
    /** Nouvelles données : ouverture, sélection et ligne active gardées quand leurs clés existent encore. */
    setRoots(r) {
      roots = r || []; idx = indexTree(roots);
      for (const k of defaultOpen(roots)) if (!seeded.has(k)) { seeded.add(k); expanded.add(k); }
      for (const k of [...sel]) if (!idx.has(k)) sel.delete(k);
      if (q) filter = filterTree(roots, q);
      if (act != null && !idx.has(act)) act = null;
      recompute();
    },
    setFilter(text) { q = String(text || '').trim(); filter = q ? filterTree(roots, q) : null; el.scrollTop = 0; recompute(); return filter ? filter.match.size : null; },
    /** Sélection imposée (autre vue) : reveal ouvre les parents et fait défiler ; silent : pas d'onSelect. */
    select(keys, so = {}) {
      sel = new Set((keys || []).filter(k => idx.has(k)));
      const last = [...sel].pop() ?? null;
      if (last != null) { anchor = last; if (so.reveal) reveal(last); else { act = last; paint(); } } else paint();
      if (so.focus) el.focus({ preventScroll: true });
      if (!so.silent) emit(null);
    },
    selected: () => [...sel], active: () => act,
    expand(k, on = true) { if (on) expanded.add(k); else expanded.delete(k); recompute(); },
    expandAll() { for (const [k, e] of idx) if (e.node.children && e.node.children.length) expanded.add(k); recompute(); },
    collapseAll() { expanded.clear(); recompute(); },
    reveal, focus: () => el.focus({ preventScroll: true }),
    rename(k) { const n = nodeOf(k); if (!n || (o.canRename && !o.canRename(n))) return false; reveal(k); renaming = k; paint(); return true; },
    rows: () => rows, node: nodeOf, filtered: () => !!filter,
    destroy() { ro.disconnect(); removeEventListener('pointermove', onMove, true); removeEventListener('pointerup', onUp, true); removeEventListener('keydown', onEsc, true); el.remove(); }
  };
  return api;
}
