// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : l'éditeur du plan de travail (SVG). On pose des éléments (glisser ou cliquer dans la bibliothèque),
// on tire des tuyaux d'orifice en orifice, on déplace, on supprime (Suppr). Pendant la simulation, les tuyaux prennent
// la couleur de leur état (sous pression, à l'échappement, fermé), les distributeurs basculent, les tiges sortent ;
// un distributeur à bouton poussoir s'actionne en maintenant le clic dessus. Molette : zoom ; glisser le fond : se déplacer.
import { tl } from '../i18n/index.js';
import { DEFS, G, sizeOf, portsOf, tagOf, camMarks } from './elements.js';
import { viewOf, portState } from './sim.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const STATE_CLS = { P: 'pnP', CP: 'pnP', E: 'pnE', C0: 'pnC', M: 'pnM' };

/** Tracé orthogonal d'un tuyau entre deux orifices (px) : un pas tout droit à la sortie de chacun, puis en équerre. */
function tubePath(a, b) {
  const [ax, ay] = DIR[a.dir] || [0, 0], [bx, by] = DIR[b.dir] || [0, 0];
  const p0 = [a.ax * G, a.ay * G], p1 = [p0[0] + ax * G, p0[1] + ay * G], q0 = [b.ax * G, b.ay * G], q1 = [q0[0] + bx * G, q0[1] + by * G];
  const pts = [p0, p1];
  if (ay && by) { const my = (p1[1] + q1[1]) / 2; pts.push([p1[0], my], [q1[0], my]); }
  else if (ax && bx) { const mx = (p1[0] + q1[0]) / 2; pts.push([mx, p1[1]], [mx, q1[1]]); }
  else if (ay) pts.push([p1[0], q1[1]]); else pts.push([q1[0], p1[1]]);
  pts.push(q1, q0);
  return 'M' + pts.map(p => p.join(' ')).join(' L');
}
const portIndex = c => { const m = new Map(); for (const e of c.elements) if (DEFS[e.type]) for (const p of portsOf(e)) m.set(`${e.id}:${p.id}`, p); return m; };

/** Dessin d'un circuit (chaîne SVG du monde) : tuyaux, éléments, orifices. st : état de simulation ou null. */
export function circuitSvg(c, st, o = {}) {
  const ports = portIndex(c), sel = o.sel || null;
  let out = '';
  for (const t of c.tubes || []) {
    const a = ports.get(`${t.a[0]}:${t.a[1]}`), b = ports.get(`${t.b[0]}:${t.b[1]}`); if (!a || !b) continue;
    const s = st ? STATE_CLS[portState(st, t.a[0], t.a[1])] || '' : '', d = tubePath(a, b);
    out += `<g class="pnTubeG${sel === t.id ? ' sel' : ''}" data-tube="${esc(t.id)}"><path class="pnTubeHit" d="${d}"/><path class="pnTube ${s}" d="${d}"/></g>`;
  }
  for (const e of c.elements) {
    const D = DEFS[e.type]; if (!D) continue;
    const [w, h] = sizeOf(e), v = st ? viewOf(st, e) : null, leak = st && (st.leaks || []).some(l => l.el === e.id);
    out += `<g class="pnEl${sel === e.id ? ' sel' : ''}${leak ? ' leak' : ''}" data-id="${esc(e.id)}" transform="translate(${e.x * G} ${e.y * G})"><rect class="pnHit" x="-4" y="-4" width="${w * G + 8}" height="${h * G + 8}"/>${D.draw(e, v)}${tagOf(e)}${e.type === 'cyl1' || e.type === 'cyl2' ? camMarks(c, e, v) : ''}</g>`;
  }
  if (!o.noPorts) for (const [k, p] of ports) {
    const s = st ? STATE_CLS[st.press[k]] || '' : '';
    out += `<circle class="pnPort ${s}" data-port="${esc(k)}" cx="${p.ax * G}" cy="${p.ay * G}" r="3.2"><title>${esc(p.id)}</title></circle>`;
  }
  return out;
}
/** Emprise du circuit en pas de grille : [x0, y0, x1, y1]. */
export function boundsOf(c) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of c.elements) { if (!DEFS[e.type]) continue; const [w, h] = sizeOf(e); x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y - 2); x1 = Math.max(x1, e.x + w); y1 = Math.max(y1, e.y + h + 2); }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

/**
 * host : élément qui reçoit le plan. api : { changed(), status(msg, kind), sim() → état ou null, press(id, on),
 * selected(sel) (sélection changée : { el } ou { tube } ou null) }.
 */
export function createPneuEditor(host, api) {
  let C = { elements: [], tubes: [] }, sel = null, view = { k: 1.6, tx: 80, ty: 80 }, mode = null, n = 1;
  const undo = [], redo = [];
  host.insertAdjacentHTML('afterbegin', `<svg class="pnSvg" tabindex="0" aria-label="${esc(tl('Plan de travail pneumatique'))}"><defs><pattern id="pnGrid" width="${G}" height="${G}" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.7" class="pnDot"/></pattern></defs><g class="pnWorld"></g></svg>`);
  const svg = host.querySelector('.pnSvg'), world = svg.querySelector('.pnWorld');
  const snap = () => JSON.stringify(C);
  let liveBefore = null; // état d'avant un réglage en cours de glissement (setProp live)
  const commit = before => { undo.push(before); if (undo.length > 200) undo.shift(); redo.length = 0; api.changed(); };
  const toWorld = ev => { const r = svg.getBoundingClientRect(); return [(ev.clientX - r.left - view.tx) / view.k, (ev.clientY - r.top - view.ty) / view.k]; };
  const freeId = p => { let i = n; const used = new Set([...C.elements.map(e => e.id), ...(C.tubes || []).map(t => t.id)]); while (used.has(p + i)) i++; n = i + 1; return p + i; };

  function render() {
    world.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`);
    let html = `<rect class="pnGridBg" x="-4000" y="-4000" width="8000" height="8000" fill="url(#pnGrid)"/>` + circuitSvg(C, api.sim(), { sel: sel && (sel.el || sel.tube) });
    if (mode && mode.tube && mode.to) {
      const p = mode.from;
      html += `<path class="pnRubber" d="M${p.ax * G} ${p.ay * G} L${mode.to[0]} ${mode.to[1]}"/>`;
    }
    if (mode && mode.place && mode.at) {
      const e = { id: '_ghost', type: mode.place, x: mode.at[0], y: mode.at[1], p: mode.props || {} };
      html += `<g class="pnGhost" transform="translate(${e.x * G} ${e.y * G})">${DEFS[e.type].draw(e, null)}</g>`;
    }
    world.innerHTML = html;
  }
  function setSel(s) { sel = s; api.selected(s ? (s.el ? { el: C.elements.find(e => e.id === s.el) } : { tube: (C.tubes || []).find(t => t.id === s.tube) }) : null); render(); }

  /* ---------- Souris ---------- */
  svg.addEventListener('pointerdown', ev => {
    if (ev.button === 1 || (ev.button === 0 && ev.altKey)) { mode = { pan: [ev.clientX, ev.clientY, view.tx, view.ty] }; svg.setPointerCapture(ev.pointerId); return; }
    if (ev.button !== 0) return;
    svg.focus({ preventScroll: true });
    const port = ev.target.closest('[data-port]'), elG = ev.target.closest('[data-id]'), tube = ev.target.closest('[data-tube]');
    if (port && !api.sim()) {
      const ports = portIndex(C); mode = { tube: true, fromKey: port.dataset.port, from: ports.get(port.dataset.port), to: toWorld(ev) };
      svg.setPointerCapture(ev.pointerId); render(); return;
    }
    if (elG) {
      const e = C.elements.find(x => x.id === elG.dataset.id); if (!e) return;
      setSel({ el: e.id });
      // Simulation : un distributeur à bouton poussoir s'actionne tant qu'on maintient le clic.
      if (api.sim()) {
        if (['v32', 'v52', 'v53'].includes(e.type)) {
          const [wx] = toWorld(ev), [w] = sizeOf(e), right = (e.p || {}).right === 'push' && wx / G > e.x + w / 2;
          const k = right ? `${e.id}:R` : e.id; mode = { push: k }; api.press(k, true); svg.setPointerCapture(ev.pointerId);
        }
        return;
      }
      const [wx, wy] = toWorld(ev);
      mode = { move: e.id, dx: wx / G - e.x, dy: wy / G - e.y, before: snap(), moved: false };
      svg.setPointerCapture(ev.pointerId); return;
    }
    if (tube) { setSel({ tube: tube.dataset.tube }); return; }
    setSel(null);
    mode = { pan: [ev.clientX, ev.clientY, view.tx, view.ty] }; svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', ev => {
    if (!mode) return;
    if (mode.pan) { view.tx = mode.pan[2] + ev.clientX - mode.pan[0]; view.ty = mode.pan[3] + ev.clientY - mode.pan[1]; render(); return; }
    if (mode.tube) { mode.to = toWorld(ev); render(); return; }
    if (mode.move) {
      const e = C.elements.find(x => x.id === mode.move); if (!e) return;
      const [wx, wy] = toWorld(ev), x = Math.round(wx / G - mode.dx), y = Math.round(wy / G - mode.dy);
      if (x !== e.x || y !== e.y) { e.x = x; e.y = y; mode.moved = true; render(); }
    }
  });
  const end = ev => {
    if (!mode) return;
    const m = mode; mode = null;
    if (m.push) api.press(m.push, false);
    if (m.move && m.moved) commit(m.before);
    if (m.tube) {
      const hit = document.elementFromPoint(ev.clientX, ev.clientY), p = hit && hit.closest && hit.closest('[data-port]');
      const to = p && p.dataset.port;
      if (to && to !== m.fromKey && !(C.tubes || []).some(t => [`${t.a[0]}:${t.a[1]}`, `${t.b[0]}:${t.b[1]}`].sort().join() === [m.fromKey, to].sort().join())) {
        const before = snap(), [ai, ap] = split(m.fromKey), [bi, bp] = split(to);
        (C.tubes || (C.tubes = [])).push({ id: freeId('t'), a: [ai, ap], b: [bi, bp] });
        commit(before);
      } else if (to !== m.fromKey) api.status(tl('Relâchez le tuyau sur un autre orifice (petit rond) pour le raccorder.'), 'warn');
    }
    if (m.place) {
      const r = svg.getBoundingClientRect(), inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (inside && m.at) add(m.place, m.at[0], m.at[1], m.props);
    }
    render();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', () => { if (mode && mode.push) api.press(mode.push, false); mode = null; render(); });
  svg.addEventListener('wheel', ev => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top, f = Math.exp(-ev.deltaY * 0.0015);
    zoomAt(f, mx, my);
  }, { passive: false });
  const split = k => { const i = k.lastIndexOf(':'); return [k.slice(0, i), k.slice(i + 1)]; };
  function zoomAt(f, mx, my) {
    const k = Math.max(0.4, Math.min(5, view.k * f)); f = k / view.k;
    view.tx = mx - (mx - view.tx) * f; view.ty = my - (my - view.ty) * f; view.k = k; render();
  }

  /* ---------- Édition ---------- */
  function add(type, x, y, p) {
    const before = snap(), e = { id: freeId('e'), type, x, y, p: { ...(p || {}) } };
    C.elements.push(e); commit(before); setSel({ el: e.id });
    return e;
  }
  function remove() {
    if (!sel) return false;
    const before = snap();
    if (sel.el) { C.elements = C.elements.filter(e => e.id !== sel.el); C.tubes = (C.tubes || []).filter(t => t.a[0] !== sel.el && t.b[0] !== sel.el); }
    if (sel.tube) C.tubes = (C.tubes || []).filter(t => t.id !== sel.tube);
    commit(before); setSel(null); return true;
  }
  function fit() {
    const b = boundsOf(C), r = svg.getBoundingClientRect();
    if (!b || !r.width) { view = { k: 1.6, tx: r.width / 2 - 80, ty: r.height / 2 - 60 }; render(); return; }
    const w = (b[2] - b[0] + 4) * G, h = (b[3] - b[1] + 4) * G, k = Math.max(0.5, Math.min(2.6, Math.min(r.width / w, (r.height - 90) / h)));
    view = { k, tx: r.width / 2 - ((b[0] + b[2]) / 2) * G * k, ty: (r.height - 40) / 2 - ((b[1] + b[3]) / 2) * G * k };
    render();
  }
  const restore = s => { liveBefore = null; C = JSON.parse(s); if (sel && sel.el && !C.elements.some(e => e.id === sel.el)) sel = null; render(); api.changed(); };
  return {
    render, fit, add, remove,
    zoom: f => { const r = svg.getBoundingClientRect(); zoomAt(f, r.width / 2, r.height / 2); },
    circuit: () => C,
    setCircuit(c) { C = c && Array.isArray(c.elements) ? c : { elements: [], tubes: [] }; C.tubes = C.tubes || []; sel = null; undo.length = 0; redo.length = 0; render(); },
    /* ---------- Édition par programme (assistants IA) : chaque opération est annulable ---------- */
    /** Pose un élément ; sans position, à droite du circuit. Rend l'élément. */
    addAt(type, x, y, p) {
      if (x == null || y == null) { const b = boundsOf(C); x = b ? b[2] + 4 : 0; y = b ? b[1] + 2 : 0; }
      return add(type, Math.round(x), Math.round(y), p);
    },
    /** Tuyau entre deux orifices « id:orifice » ; rend son identifiant, ou lève une erreur lisible. */
    connect(a, b) {
      const ports = portIndex(C);
      for (const k of [a, b]) if (!ports.has(k)) throw new Error(`port "${k}" does not exist`);
      if (a === b) throw new Error('a tube needs two different ports');
      if ((C.tubes || []).some(t => [`${t.a[0]}:${t.a[1]}`, `${t.b[0]}:${t.b[1]}`].sort().join() === [a, b].sort().join())) throw new Error('these ports are already connected');
      const before = snap(), [ai, ap] = split(a), [bi, bp] = split(b), id = freeId('t');
      (C.tubes || (C.tubes = [])).push({ id, a: [ai, ap], b: [bi, bp] }); commit(before); render();
      return id;
    },
    /** Retire un élément (et ses tuyaux) ou un tuyau, par identifiant. */
    removeId(id) {
      const before = snap(), n0 = C.elements.length + (C.tubes || []).length;
      C.elements = C.elements.filter(e => e.id !== id); C.tubes = (C.tubes || []).filter(t => t.id !== id && t.a[0] !== id && t.b[0] !== id);
      if (C.elements.length + C.tubes.length === n0) throw new Error(`no element or tube "${id}"`);
      if (sel && (sel.el === id || sel.tube === id)) sel = null;
      commit(before); render();
    },
    /** Réglages d'un élément (fusionnés), annulable. */
    setProps(id, p) { const e = C.elements.find(x => x.id === id); if (!e) throw new Error(`no element "${id}"`); const before = snap(); e.p = { ...(e.p || {}), ...p }; commit(before); render(); return e; },
    /** Remplace tout le circuit (exemple), annulable. */
    replace(c) { const before = snap(); C = c; C.tubes = C.tubes || []; sel = null; commit(before); render(); },
    /** Réglage du circuit (modèle « physical » ou tout ou rien), annulable. */
    setCircuitProp(k, v) { const before = snap(); if (v == null || v === '') delete C[k]; else C[k] = v; commit(before); render(); },
    /** Modifie un réglage de l'élément choisi (annulable). */
    /**
     * Réglage d'un élément. live : pendant un glissement (curseur), le plan suit sans entrée d'historique ni
     * « changed » ; l'appel suivant sans live enregistre le tout comme une seule modification.
     */
    setProp(id, k, v, live = false) {
      const e = C.elements.find(x => x.id === id); if (!e) return;
      if (live) { if (!liveBefore) liveBefore = snap(); e.p = { ...(e.p || {}), [k]: v }; render(); return; }
      const before = liveBefore || snap(); liveBefore = null; e.p = { ...(e.p || {}), [k]: v }; commit(before); render();
    },
    /** Glisser depuis la bibliothèque : l'élément suit le pointeur et se pose là où on relâche sur le plan. */
    startPlace(type, p) {
      mode = { place: type, props: p || {}, at: null };
      const mv = ev => { if (!mode || !mode.place) return; const [wx, wy] = toWorld(ev), [w, h] = DEFS[type].size({ p: {} }); mode.at = [Math.round(wx / G - w / 2), Math.round(wy / G - h / 2)]; render(); };
      const up = ev => { removeEventListener('pointermove', mv, true); if (mode && mode.place) end(ev); };
      addEventListener('pointermove', mv, true); addEventListener('pointerup', up, { capture: true, once: true });
    },
    placeCenter(type, p) { const r = svg.getBoundingClientRect(), [w, h] = DEFS[type].size({ p: p || {} }); return add(type, Math.round(((r.width / 2 - view.tx) / view.k) / G - w / 2), Math.round(((r.height / 2 - view.ty) / view.k) / G - h / 2), p); },
    selected: () => sel,
    select: s => setSel(s),
    key(e) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !api.sim()) { remove(); return true; }
      if (e.key === 'Escape' && (mode || sel)) { mode = null; setSel(null); return true; }
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) { fit(); return true; }
      return false;
    },
    history: {
      undo() { if (!undo.length) return; redo.push(snap()); restore(undo.pop()); },
      redo() { if (!redo.length) return; undo.push(snap()); restore(redo.pop()); },
      canUndo: () => undo.length > 0, canRedo: () => redo.length > 0
    }
  };
}
