// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : l'éditeur du plan de travail (SVG). On pose des éléments (glisser ou cliquer dans la bibliothèque),
// on tire des tuyaux d'orifice en orifice, on déplace, on supprime (Suppr). Pendant la simulation, les tuyaux prennent
// la couleur de leur état (sous pression, à l'échappement, fermé), les distributeurs basculent, les tiges sortent ;
// un distributeur à bouton poussoir s'actionne en maintenant le clic dessus. Molette : zoom ; deux doigts, Maj + molette,
// clic du milieu, Alt ou Espace + glisser : se déplacer. Glisser dans le vide : encadrer plusieurs éléments (Maj : en
// ajouter) ; Maj + clic : ajouter ou retirer un élément ; Ctrl+A, C, X, V, D : tout choisir, copier, couper, coller, dupliquer.
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
  const ports = portIndex(c), sel = o.sel || null, isSel = id => (sel instanceof Set ? sel.has(id) : sel === id);
  let out = '';
  for (const t of c.tubes || []) {
    const a = ports.get(`${t.a[0]}:${t.a[1]}`), b = ports.get(`${t.b[0]}:${t.b[1]}`); if (!a || !b) continue;
    const s = st ? STATE_CLS[portState(st, t.a[0], t.a[1])] || '' : '', d = tubePath(a, b);
    out += `<g class="pnTubeG${isSel(t.id) ? ' sel' : ''}" data-tube="${esc(t.id)}"><path class="pnTubeHit" d="${d}"/><path class="pnTube ${s}" d="${d}"/></g>`;
  }
  for (const e of c.elements) {
    const D = DEFS[e.type]; if (!D) continue;
    const [w, h] = sizeOf(e), v = st ? viewOf(st, e) : null, leak = st && (st.leaks || []).some(l => l.el === e.id);
    out += `<g class="pnEl${isSel(e.id) ? ' sel' : ''}${leak ? ' leak' : ''}" data-id="${esc(e.id)}" transform="translate(${e.x * G} ${e.y * G})"><rect class="pnHit" x="-4" y="-4" width="${w * G + 8}" height="${h * G + 8}"/>${D.draw(e, v)}${tagOf(e)}${e.type === 'cyl1' || e.type === 'cyl2' ? camMarks(c, e, v) : ''}</g>`;
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
 * selected(sel) (sélection changée : { el }, { els } (plusieurs éléments), { tube } ou null), view() (vue changée) }.
 */
export function createPneuEditor(host, api) {
  let C = { elements: [], tubes: [] }, view = { k: 1.6, tx: 80, ty: 80 }, mode = null, n = 1, pan = false;
  // Sélection : des éléments (un ou plusieurs) ou un tuyau.
  let pick = new Set(), tubeSel = null, clip = null, pasteN = 0;
  const undo = [], redo = [];
  host.insertAdjacentHTML('afterbegin', `<svg class="pnSvg" tabindex="0" aria-label="${esc(tl('Plan de travail pneumatique'))}"><defs><pattern id="pnGrid" width="${G}" height="${G}" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.7" class="pnDot"/></pattern></defs><g class="pnWorld"></g></svg>`);
  const svg = host.querySelector('.pnSvg'), world = svg.querySelector('.pnWorld');
  const snap = () => JSON.stringify(C);
  let liveBefore = null; // état d'avant un réglage en cours de glissement (setProp live)
  const commit = before => { undo.push(before); if (undo.length > 200) undo.shift(); redo.length = 0; api.changed(); };
  const toWorld = ev => { const r = svg.getBoundingClientRect(); return [(ev.clientX - r.left - view.tx) / view.k, (ev.clientY - r.top - view.ty) / view.k]; };
  const freeId = p => { let i = n; const used = new Set([...C.elements.map(e => e.id), ...(C.tubes || []).map(t => t.id)]); while (used.has(p + i)) i++; n = i + 1; return p + i; };
  const byId = id => C.elements.find(e => e.id === id);
  const viewChanged = () => { if (api.view) api.view(); };

  function render() {
    world.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`);
    const marked = tubeSel ? new Set([tubeSel]) : pick;
    let html = `<rect class="pnGridBg" x="-4000" y="-4000" width="8000" height="8000" fill="url(#pnGrid)"/>` + circuitSvg(C, api.sim(), { sel: marked });
    if (mode && mode.tube && mode.to) {
      const p = mode.from;
      html += `<path class="pnRubber" d="M${p.ax * G} ${p.ay * G} L${mode.to[0]} ${mode.to[1]}"/>`;
    }
    if (mode && mode.place && mode.at) {
      const e = { id: '_ghost', type: mode.place, x: mode.at[0], y: mode.at[1], p: mode.props || {} };
      html += `<g class="pnGhost" transform="translate(${e.x * G} ${e.y * G})">${DEFS[e.type].draw(e, null)}</g>`;
    }
    world.innerHTML = html;
    viewChanged();
  }
  const selection = () => (tubeSel ? { tube: tubeSel } : pick.size === 1 ? { el: [...pick][0] } : pick.size ? { els: [...pick] } : null);
  function emitSel() {
    const s = selection();
    api.selected(s ? (s.el ? { el: byId(s.el) } : s.tube ? { tube: (C.tubes || []).find(t => t.id === s.tube) } : { els: s.els.map(byId).filter(Boolean) }) : null);
  }
  /** s : { el }, { els: [ids] }, { tube } ou null. */
  function setSel(s) {
    pick = new Set(s && s.el ? [s.el] : s && s.els ? s.els : []); tubeSel = s && s.tube ? s.tube : null;
    emitSel(); render();
  }
  const toggle = id => { tubeSel = null; if (pick.has(id)) pick.delete(id); else pick.add(id); emitSel(); render(); };

  /* ---------- Souris ---------- */
  svg.addEventListener('pointerdown', ev => {
    if (ev.button === 1 || (ev.button === 0 && ev.altKey)) { mode = { pan: [ev.clientX, ev.clientY, view.tx, view.ty] }; pan = true; svg.classList.add('pnPanning'); svg.setPointerCapture(ev.pointerId); ev.preventDefault(); return; }
    if (ev.button !== 0) return;
    svg.focus({ preventScroll: true });
    const port = ev.target.closest('[data-port]'), elG = ev.target.closest('[data-id]'), tube = ev.target.closest('[data-tube]');
    if (port && !api.sim()) {
      const ports = portIndex(C); mode = { tube: true, fromKey: port.dataset.port, from: ports.get(port.dataset.port), to: toWorld(ev) };
      svg.setPointerCapture(ev.pointerId); render(); return;
    }
    if (elG) {
      const e = byId(elG.dataset.id); if (!e) return;
      // Simulation : un distributeur à bouton poussoir s'actionne tant qu'on maintient le clic.
      if (api.sim()) {
        setSel({ el: e.id });
        if (['v32', 'v52', 'v53'].includes(e.type)) {
          const [wx] = toWorld(ev), [w] = sizeOf(e), right = (e.p || {}).right === 'push' && wx / G > e.x + w / 2;
          const k = right ? `${e.id}:R` : e.id; mode = { push: k }; api.press(k, true); svg.setPointerCapture(ev.pointerId);
        }
        return;
      }
      if (ev.shiftKey) { toggle(e.id); return; }
      if (!pick.has(e.id)) setSel({ el: e.id });
      // Glisser : tous les éléments choisis suivent.
      const [wx, wy] = toWorld(ev), orig = new Map([...pick].map(id => byId(id)).filter(Boolean).map(x => [x.id, [x.x, x.y]]));
      mode = { move: e.id, w0: [wx / G, wy / G], orig, before: snap(), moved: false };
      svg.setPointerCapture(ev.pointerId); return;
    }
    if (tube) { setSel({ tube: tube.dataset.tube }); return; }
    // Fond : encadrer (Maj : ajouter à la sélection) ; un simple clic désélectionne.
    const w0 = toWorld(ev);
    mode = { box: true, x0: ev.clientX, y0: ev.clientY, w0, cur: w0, add: ev.shiftKey, moved: false };
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', ev => {
    if (!mode) return;
    if (mode.pan) { view.tx = mode.pan[2] + ev.clientX - mode.pan[0]; view.ty = mode.pan[3] + ev.clientY - mode.pan[1]; render(); return; }
    if (mode.tube) { mode.to = toWorld(ev); render(); return; }
    if (mode.move) {
      const [wx, wy] = toWorld(ev), dx = Math.round(wx / G - mode.w0[0]), dy = Math.round(wy / G - mode.w0[1]);
      let changed = false;
      for (const [id, [x, y]] of mode.orig) { const e = byId(id); if (e && (e.x !== x + dx || e.y !== y + dy)) { e.x = x + dx; e.y = y + dy; changed = true; } }
      if (changed) { mode.moved = true; render(); }
      return;
    }
    if (mode.box) {
      mode.cur = toWorld(ev); mode.moved = mode.moved || Math.hypot(ev.clientX - mode.x0, ev.clientY - mode.y0) > 4;
      if (mode.moved) drawBox();
    }
  });
  function drawBox() {
    render();
    const m = mode, x = Math.min(m.w0[0], m.cur[0]), y = Math.min(m.w0[1], m.cur[1]), w = Math.abs(m.cur[0] - m.w0[0]), h = Math.abs(m.cur[1] - m.w0[1]);
    world.insertAdjacentHTML('beforeend', `<rect class="pnMarquee" x="${x}" y="${y}" width="${w}" height="${h}" vector-effect="non-scaling-stroke"/>`);
  }
  /** Éléments touchés par un rectangle du monde (px). */
  function inBox(x0, y0, x1, y1) {
    return C.elements.filter(e => { if (!DEFS[e.type]) return false; const [w, h] = sizeOf(e), ex = e.x * G, ey = e.y * G; return ex < x1 && ex + w * G > x0 && ey < y1 && ey + h * G > y0; }).map(e => e.id);
  }
  const end = ev => {
    if (!mode) return;
    const m = mode; mode = null;
    if (m.pan) { pan = false; svg.classList.remove('pnPanning'); viewChanged(); return; }
    if (m.push) api.press(m.push, false);
    if (m.move && m.moved) commit(m.before);
    if (m.box) {
      if (!m.moved) { if (!m.add) setSel(null); else render(); return; }
      const ids = inBox(Math.min(m.w0[0], m.cur[0]), Math.min(m.w0[1], m.cur[1]), Math.max(m.w0[0], m.cur[0]), Math.max(m.w0[1], m.cur[1]));
      setSel({ els: m.add ? [...new Set([...pick, ...ids])] : ids });
      if (ids.length > 1) api.status(tl('{0} éléments sélectionnés : glissez-les ensemble, Suppr pour les retirer, Ctrl+D pour les dupliquer.', pick.size));
      return;
    }
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
  svg.addEventListener('pointercancel', () => { if (mode && mode.push) api.press(mode.push, false); if (mode && mode.pan) svg.classList.remove('pnPanning'); mode = null; pan = false; render(); });
  // Molette : zoom vers le curseur ; pavé tactile (deux doigts) ou Maj : déplacement ; Ctrl ou pincer : zoom.
  svg.addEventListener('wheel', ev => {
    ev.preventDefault();
    const f = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1, r = svg.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const trackpad = Math.abs(ev.deltaX) > 0.5 || (ev.deltaMode === 0 && !Number.isInteger(ev.deltaY));
    if (ev.ctrlKey || ev.metaKey) { zoomAt(Math.exp(-ev.deltaY * f * 0.01), mx, my); return; }
    if (ev.shiftKey && !Math.abs(ev.deltaX)) { panBy(-ev.deltaY * f, 0); return; }
    if (ev.shiftKey || trackpad) { panBy(-ev.deltaX * f, -ev.deltaY * f); return; }
    zoomAt(Math.exp(-Math.max(-120, Math.min(120, ev.deltaY * f)) * 0.0015), mx, my);
  }, { passive: false });
  const split = k => { const i = k.lastIndexOf(':'); return [k.slice(0, i), k.slice(i + 1)]; };
  function zoomAt(f, mx, my) {
    if (mx == null) { const r = svg.getBoundingClientRect(); mx = r.width / 2; my = r.height / 2; }
    const k = Math.max(0.3, Math.min(6, view.k * f)); f = k / view.k;
    view.tx = mx - (mx - view.tx) * f; view.ty = my - (my - view.ty) * f; view.k = k; render();
  }
  /** Le plan suit de dx, dy pixels. */
  function panBy(dx, dy) { view.tx += dx; view.ty += dy; render(); }

  /* ---------- Édition ---------- */
  function add(type, x, y, p) {
    const before = snap(), e = { id: freeId('e'), type, x, y, p: { ...(p || {}) } };
    C.elements.push(e); commit(before); setSel({ el: e.id });
    return e;
  }
  function remove() {
    if (!pick.size && !tubeSel) return false;
    const before = snap();
    if (pick.size) { C.elements = C.elements.filter(e => !pick.has(e.id)); C.tubes = (C.tubes || []).filter(t => !pick.has(t.a[0]) && !pick.has(t.b[0])); }
    if (tubeSel) C.tubes = (C.tubes || []).filter(t => t.id !== tubeSel);
    commit(before); setSel(null); return true;
  }
  /** Copie des éléments choisis et des tuyaux qui les relient entre eux. */
  function copy() {
    if (!pick.size) return false;
    const els = C.elements.filter(e => pick.has(e.id)), tubes = (C.tubes || []).filter(t => pick.has(t.a[0]) && pick.has(t.b[0]));
    clip = JSON.parse(JSON.stringify({ elements: els, tubes })); pasteN = 0;
    return true;
  }
  function paste() {
    if (!clip || !clip.elements.length) return false;
    pasteN++;
    const before = snap(), map = new Map(), d = 3 * pasteN;
    for (const e of clip.elements) { const ne = { ...JSON.parse(JSON.stringify(e)), id: freeId('e'), x: e.x + d, y: e.y + d }; map.set(e.id, ne.id); C.elements.push(ne); }
    for (const t of clip.tubes) (C.tubes || (C.tubes = [])).push({ id: freeId('t'), a: [map.get(t.a[0]), t.a[1]], b: [map.get(t.b[0]), t.b[1]] });
    commit(before); setSel({ els: [...map.values()] });
    api.status(tl('{0} élément{1} collé{2}.', map.size, map.size > 1 ? 's' : '', map.size > 1 ? 's' : ''), 'ok');
    return true;
  }
  function nudge(dx, dy) {
    if (!pick.size || api.sim()) return false;
    if (!nudge.before) nudge.before = snap();
    for (const id of pick) { const e = byId(id); if (e) { e.x += dx; e.y += dy; } }
    render(); clearTimeout(nudge.t); nudge.t = setTimeout(() => { commit(nudge.before); nudge.before = null; }, 400);
    return true;
  }
  /** Cadre une emprise en pas de grille [x0, y0, x1, y1]. */
  function frameBox(b, maxK = 2.6) {
    const r = svg.getBoundingClientRect(); if (!r.width) return;
    const W = r.width - 56; // la barre de navigation, à droite
    const w = (b[2] - b[0] + 4) * G, h = (b[3] - b[1] + 4) * G, k = Math.max(0.3, Math.min(maxK, Math.min(W / w, (r.height - 90) / h)));
    view = { k, tx: W / 2 - ((b[0] + b[2]) / 2) * G * k, ty: (r.height - 40) / 2 - ((b[1] + b[3]) / 2) * G * k };
    render();
  }
  function fit() {
    const b = boundsOf(C), r = svg.getBoundingClientRect();
    if (!b || !r.width) { view = { k: 1.6, tx: r.width / 2 - 80, ty: r.height / 2 - 60 }; render(); return; }
    frameBox(b);
  }
  function fitSel() {
    const els = [...pick].map(byId).filter(Boolean);
    if (!els.length && tubeSel) { const t = (C.tubes || []).find(x => x.id === tubeSel); if (t) els.push(...[byId(t.a[0]), byId(t.b[0])].filter(Boolean)); }
    if (!els.length) return false;
    frameBox(boundsOf({ elements: els }), 4); return true;
  }
  const restore = s => { liveBefore = null; C = JSON.parse(s); pick = new Set([...pick].filter(id => C.elements.some(e => e.id === id))); if (tubeSel && !(C.tubes || []).some(t => t.id === tubeSel)) tubeSel = null; render(); api.changed(); };
  return {
    render, fit, fitSel, add, remove, panBy,
    zoom: f => zoomAt(f),
    zoomAt,
    /** Zoom en % : 100 % = un pixel du plan pour un pixel d'écran. */
    zoomPct: () => view.k * 100,
    setZoomPct: p => zoomAt((p / 100) / view.k),
    hasSel: () => pick.size > 0 || !!tubeSel,
    /** Mini-carte : emprise du circuit, éléments, partie visible (pixels du plan). */
    mini() {
      const b = boundsOf(C), r = svg.getBoundingClientRect(); if (!b || !r.width) return null;
      return {
        bounds: [b[0] * G, b[1] * G, b[2] * G, b[3] * G],
        boxes: C.elements.filter(e => DEFS[e.type]).map(e => { const [w, h] = sizeOf(e); return [e.x * G, e.y * G, w * G, h * G, pick.has(e.id)]; }),
        view: [-view.tx / view.k, -view.ty / view.k, (r.width - view.tx) / view.k, (r.height - view.ty) / view.k]
      };
    },
    centerOn(x, y) { const r = svg.getBoundingClientRect(); view.tx = r.width / 2 - x * view.k; view.ty = r.height / 2 - y * view.k; render(); },
    get svg() { return svg; },
    circuit: () => C,
    setCircuit(c) { C = c && Array.isArray(c.elements) ? c : { elements: [], tubes: [] }; C.tubes = C.tubes || []; pick.clear(); tubeSel = null; undo.length = 0; redo.length = 0; render(); },
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
      pick.delete(id); if (tubeSel === id) tubeSel = null;
      commit(before); render();
    },
    /** Réglages d'un élément (fusionnés), annulable. */
    setProps(id, p) { const e = byId(id); if (!e) throw new Error(`no element "${id}"`); const before = snap(); e.p = { ...(e.p || {}), ...p }; commit(before); render(); return e; },
    /** Remplace tout le circuit (exemple), annulable. */
    replace(c) { const before = snap(); C = c; C.tubes = C.tubes || []; pick.clear(); tubeSel = null; commit(before); render(); },
    /** Réglage du circuit (modèle « physical » ou tout ou rien), annulable. */
    setCircuitProp(k, v) { const before = snap(); if (v == null || v === '') delete C[k]; else C[k] = v; commit(before); render(); },
    /**
     * Réglage d'un élément. live : pendant un glissement (curseur), le plan suit sans entrée d'historique ni
     * « changed » ; l'appel suivant sans live enregistre le tout comme une seule modification.
     */
    setProp(id, k, v, live = false) {
      const e = byId(id); if (!e) return;
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
    selected: selection,
    select: s => setSel(s),
    selectAll() { setSel({ els: C.elements.map(e => e.id) }); },
    key(e) {
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod) {
        if (k === 'a') { setSel({ els: C.elements.map(x => x.id) }); return true; }
        if (api.sim()) return false;
        if (k === 'c') return copy();
        if (k === 'x') { if (copy()) remove(); return true; }
        if (k === 'v') return paste();
        if (k === 'd') { if (copy()) paste(); return true; }
        return false;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (pick.size || tubeSel) && !api.sim()) { remove(); return true; }
      if (e.key === 'Escape' && (mode || pick.size || tubeSel)) { mode = null; setSel(null); return true; }
      if (k === 'f' && !e.shiftKey) { fit(); return true; }
      const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
      if (arrows) {
        const st = e.shiftKey ? 4 : 1;
        if (pick.size && !api.sim()) return nudge(arrows[0] * st, arrows[1] * st);
        panBy(-arrows[0] * 60 * st, -arrows[1] * 60 * st); return true;
      }
      return false;
    },
    history: {
      undo() { if (!undo.length) return; redo.push(snap()); restore(undo.pop()); },
      redo() { if (!redo.length) return; undo.push(snap()); restore(redo.pop()); },
      canUndo: () => undo.length > 0, canRedo: () => redo.length > 0
    }
  };
}
