// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique : l'éditeur du plan de travail (SVG). On y pose des éléments (glisser depuis la
// bibliothèque), on tire des fils de broche en broche (clic pendant le tracé : point de passage ;
// relâcher sur un fil : nœud), on déplace, tourne (R), supprime (Suppr), copie (Ctrl+C / Ctrl+V).
// La simulation est toujours active : cliquer sur un interrupteur le bascule, les fils prennent la
// couleur de leur niveau (1 vif, 0 sombre, X rouge, Z bleu). Les horloges tournent quand on lance le
// temps (▶) ; « Pas » avance d'un front. Les signaux nommés sont enregistrés pour le chronogramme.
// Bus : un fil entre deux broches de bus est épais et porte sa largeur ; deux broches de largeurs
// différentes ne se relient pas. Blocs : double-cliquer sur un bloc posé l'ouvre (api.openBlock).
import { tl, DEC } from '../i18n/index.js';
import { DEFS, propsOf, layoutOf, sizeOf, pinsOf, pinKeys, pinWidth, keypadKey, fmtValue, X, Z } from './elements.js';
import { LogicSim, signals } from './sim.js';
import { opsSvg, elTransform, labelPos, wireWidth, busMark } from './render.js';
import { blocksUsed } from './blocks.js';
import { route, routeWire, nearestOnRoute } from './route.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LV = ['lv0', 'lv1', 'lvX', 'lvZ'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtT = t => (Math.round(t * 100) / 100).toFixed(2).replace('.', DEC);
const IN_SEQ = 'ABCDEFGHIJKLMNOPQRTUVW'.split('');

/** Valeur d'un bus en texte : décimal et hexadécimal, ou les bits (X, Z) si l'un est inconnu. */
export function busText(levels) {
  if (levels.every(v => v === Z)) return 'Z';
  if (levels.some(v => v > 1)) return levels.slice().reverse().map(v => ['0', '1', 'X', 'Z'][v]).join('');
  const n = levels.reduce((a, v, i) => a | (v << i), 0);
  return `${n} · ${fmtValue(n, levels.length, 'hex')}`;
}
/** Point du plan ramené aux coordonnées locales d'un élément (avant rotation). */
function toLocal(it, x, y) {
  const L = layoutOf(it), r = it.r || 0, dx = x - it.x, dy = y - it.y;
  return r === 90 ? [dy, L.h - dx] : r === 180 ? [L.w - dx, L.h - dy] : r === 270 ? [L.w - dy, dx] : [dx, dy];
}

/**
 * host : élément qui reçoit le plan de travail. api : { changed(kind) (« struct » : structure modifiée,
 * « input » : entrée basculée), status(msg, kind), menu(anchor, items), ask(title, label, value), style(),
 * openBlock(ref) (ouvrir un bloc), blockDefs() (blocs du projet), adoptBlocks(defs) (blocs collés), sound(tons) }.
 */
export function createLogicEditor(host, api) {
  const el = document.createElement('div');
  el.className = 'lgView';
  el.innerHTML = `<svg class="lgSvg" xmlns="http://www.w3.org/2000/svg" stroke-linejoin="round" font-family="var(--sans)"><g class="lgWorld"><g class="lgWires"></g><g class="lgEls"></g><g class="lgOver"></g></g></svg><div class="lgTip" hidden></div>`;
  host.appendChild(el);
  const svg = el.querySelector('svg'), world = svg.querySelector('.lgWorld'), gW = svg.querySelector('.lgWires'), gE = svg.querySelector('.lgEls'), gO = svg.querySelector('.lgOver'), tip = el.querySelector('.lgTip');

  let C = { elements: [], wires: [] }, sim = null, byId = new Map();
  let k = 18, ox = 80, oy = 60; // zoom (pixels par carreau) et décalage de l'origine
  let sel = new Set(), selWire = null, hover = null, mode = null, spaceDown = false, cursor = [0, 0];
  const listeners = new Set(), emit = kind => listeners.forEach(f => { try { f(kind); } catch (e) { console.error(e); } });
  let dirty = true, frame = 0;

  /* ---------- Historique (annuler / rétablir) ---------- */
  let H = { undo: [], redo: [], snap: null }, ctx0 = null;
  const contexts = new Map(); // historique et vue de chaque circuit ouvert (principal, blocs)
  // Circuit principal : ses blocs font partie de l'historique (exemple chargé, bloc supprimé : Ctrl+Z les rend).
  // Le circuit d'un bloc ouvert voit les blocs par un accesseur (non énumérable) : il n'en garde pas de copie.
  const isRoot = () => { const d = Object.getOwnPropertyDescriptor(C, 'blocks'); return !(d && d.get); };
  const snapOf = () => JSON.stringify(isRoot() ? { elements: C.elements, wires: C.wires, blocks: C.blocks || null } : { elements: C.elements, wires: C.wires });
  function commit() {
    const s = snapOf(); if (s === H.snap) return;
    if (H.snap != null) { H.undo.push(H.snap); if (H.undo.length > 120) H.undo.shift(); H.redo.length = 0; }
    H.snap = s; api.changed('struct'); emit('history');
  }
  function travel(from, to) {
    if (!from.length) return false;
    to.push(H.snap); H.snap = from.pop();
    // Les entrées gardent leur position du moment : annuler un geste ne rebascule pas les interrupteurs.
    const now = new Map(C.elements.filter(e => DEFS[e.type] && DEFS[e.type].kind === 'in').map(e => [e.id, e.p && e.p.value]));
    const d = JSON.parse(H.snap);
    for (const e of d.elements) if (now.has(e.id) && e.type !== 'clock') { e.p = e.p || {}; if (now.get(e.id) == null) delete e.p.value; else e.p.value = now.get(e.id); }
    C.elements.splice(0, C.elements.length, ...d.elements); C.wires.splice(0, C.wires.length, ...d.wires);
    if ('blocks' in d) { if (d.blocks) C.blocks = d.blocks; else delete C.blocks; }
    if (api.sync) api.sync(); // interface des blocs posés : celle de leur définition actuelle
    sel.clear(); selWire = null; mode = null;
    structural(); api.changed('struct'); emit('history'); emit('select');
    return true;
  }

  /* ---------- Simulation, horloges, chronogramme ---------- */
  let running = false, speed = 1, T = 0, last = 0, raf = 0;
  const next = new Map(); // horloge → instant de son prochain front
  const trace = new Map(); // signal → { name, kind: 'bit'|'bus', samples: [[t, v]] }
  function rebuildSim() {
    const old = sim;
    byId = new Map(C.elements.map(e => [e.id, e]));
    sim = new LogicSim(C);
    if (old) {
      // L'état mémorisé (bascules, compteurs) survit aux modifications du circuit.
      sim.carryOver(old, (a, b) => behaviour(a) === behaviour(b));
    }
    for (const id of [...next.keys()]) if (!byId.has(id)) next.delete(id);
    for (const e of C.elements) if (e.type === 'clock' && !next.has(e.id)) next.set(e.id, T + half(e));
  }
  const half = e => 0.5 / Math.max(0.1, +propsOf(e).freq || 1);
  /** Propriétés qui changent le comportement (pas le nom, l'affichage au chronogramme ni la position d'une entrée). */
  const behaviour = p => JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !['label', 'watch', 'pressed', 'value', 'text'].includes(k))));
  function structural() { rebuildSim(); record(); dirty = true; draw(); emit('struct'); }
  /** Signaux enregistrés : entrées, sorties, et les éléments marqués « au chronogramme ». */
  function watched() {
    const S = signals(C), out = [];
    for (const c of S.clocks) out.push({ key: c.id, name: c.name, id: c.id, pin: 'Q', kind: 'bit' });
    // Une entrée ou sortie de plusieurs bits (bloc DIP, entrée numérique, afficheurs) s'enregistre comme un nombre.
    const sig = (e, name, dir) => {
      const keys = layoutOf(e).pins.filter(q => q.dir === dir && q.opt == null && q.name !== 'V').flatMap(pinKeys);
      return keys.length > 1 ? { key: e.id, name, id: e.id, kind: 'bus', pins: keys } : keys.length ? { key: e.id, name, id: e.id, pin: keys[0], kind: 'bit' } : null;
    };
    const named = kind => C.elements.filter(e => DEFS[e.type] && DEFS[e.type].kind === kind && e.type !== 'seg7').sort((a, b) => a.y - b.y || a.x - b.x);
    for (const e of named('in')) { if (e.type === 'clock') continue; const name = String(propsOf(e).label || '').trim(), s = name && sig(e, name, 'out'); if (s) out.push(s); }
    for (const e of C.elements) if (e.p && e.p.watch && DEFS[e.type]) {
      const o = layoutOf(e).pins.find(q => q.dir === 'out'); if (!o) continue;
      const name = String(propsOf(e).label || '').trim() || `${DEFS[e.type].name()} ${o.name}`;
      out.push(o.bus ? { key: e.id + '.' + o.name, name, id: e.id, kind: 'bus', pins: o.bus } : { key: e.id + '.' + o.name, name, id: e.id, pin: o.name, kind: 'bit' });
    }
    for (const e of named('out')) { const name = String(propsOf(e).label || '').trim(), s = name && sig(e, name, 'in'); if (s) out.push(s); }
    return out;
  }
  function valueOf(s) {
    if (s.kind === 'bit') return sim.level(s.id, s.pin);
    let n = 0; for (let i = 0; i < s.pins.length; i++) { const v = sim.level(s.id, s.pins[i]); if (v > 1) return null; n |= v << i; }
    return n;
  }
  function record() {
    if (!sim) return;
    const seen = new Set();
    for (const s of watched()) {
      seen.add(s.key);
      let tr = trace.get(s.key);
      if (!tr) { tr = { name: s.name, kind: s.kind, bits: s.pins ? s.pins.length : 1, samples: [] }; trace.set(s.key, tr); }
      tr.name = s.name; tr.order = seen.size;
      const v = valueOf(s), lastS = tr.samples[tr.samples.length - 1];
      if (!lastS || lastS[1] !== v) tr.samples.push([T, v]);
      while (tr.samples.length > 2 && tr.samples[1][0] < T - 300) tr.samples.shift();
    }
    for (const key of [...trace.keys()]) if (!seen.has(key)) trace.delete(key);
    emit('levels');
  }
  /** Une entrée vient d'être changée à la main : à l'arrêt, le temps avance d'un petit pas pour qu'on la voie au chronogramme. */
  function manualTick() {
    if (!running) { const d = 0.25; T += d; for (const [id, t] of next) next.set(id, t + d); }
    record(); dirty = true; draw(); api.changed('input');
  }
  function toggleClocks(at) {
    const due = [...next].filter(([, t]) => t <= at + 1e-9).map(([id]) => id);
    for (const id of due) {
      const e = byId.get(id); if (!e) { next.delete(id); continue; }
      e.p = e.p || {}; e.p.value = e.p.value ? 0 : 1;
      next.set(id, next.get(id) + half(e));
      sim.set(id, { value: e.p.value });
    }
    return due.length;
  }
  function advance(dt) {
    const target = T + dt * speed;
    for (let guard = 0; guard < 2000; guard++) {
      let t = Infinity; for (const v of next.values()) t = Math.min(t, v);
      if (t > target) break;
      T = t; toggleClocks(t); record();
    }
    T = target; record(); dirty = true;
  }
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    advance(dt); draw(); emit('tick');
    raf = requestAnimationFrame(loop);
  }
  function setRunning(on) {
    if (on && !C.elements.some(e => e.type === 'clock')) { api.status(tl('Ajoutez une horloge (Entrées → Horloge) pour faire avancer le temps.'), 'warn'); on = false; }
    running = on; cancelAnimationFrame(raf);
    if (on) { last = performance.now(); raf = requestAnimationFrame(loop); }
    emit('run');
  }
  function step() {
    let t = Infinity; for (const v of next.values()) t = Math.min(t, v);
    if (t === Infinity) { api.status(tl('Ajoutez une horloge (Entrées → Horloge) pour avancer d’un front.'), 'warn'); return; }
    T = t; toggleClocks(t); record(); dirty = true; draw(); emit('tick');
  }
  function resetSim() {
    for (const e of C.elements) if (e.type === 'clock' || e.type === 'button') { e.p = e.p || {}; e.p.value = 0; e.p.pressed = false; }
    T = 0; next.clear(); trace.clear(); sim = null; rebuildSim(); record(); dirty = true; draw(); emit('tick'); emit('struct');
  }

  /* ---------- Coordonnées ---------- */
  const applyView = () => { world.setAttribute('transform', `translate(${ox} ${oy}) scale(${k})`); el.style.setProperty('--gk', k + 'px'); el.style.setProperty('--gx', ox + 'px'); el.style.setProperty('--gy', oy + 'px'); emit('view'); };
  function toWorld(e) { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k]; }
  const snap = p => [Math.round(p[0]), Math.round(p[1])];
  function zoomAt(f, cx, cy) {
    const r = svg.getBoundingClientRect(); if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    const nk = clamp(k * f, 3, 60); ox = cx - (cx - ox) * nk / k; oy = cy - (cy - oy) * nk / k; k = nk; applyView();
  }
  function bounds(list = C.elements) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of list) { if (!DEFS[e.type]) continue; const { w, h } = sizeOf(e); x0 = Math.min(x0, e.x - 3); y0 = Math.min(y0, e.y - 2); x1 = Math.max(x1, e.x + w + 3); y1 = Math.max(y1, e.y + h + 2); }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  }
  function fit() {
    const b = bounds(), r = svg.getBoundingClientRect();
    if (!b || !r.width) { k = 18; ox = r.width / 3 || 80; oy = r.height / 3 || 60; applyView(); return; }
    frameBox(b, 30);
  }
  function frameBox(b, maxK) {
    const r = svg.getBoundingClientRect(); if (!r.width) return;
    const W = r.width - 56; // la barre de navigation, à droite
    k = clamp(Math.min((W - 80) / (b.x1 - b.x0), (r.height - 150) / (b.y1 - b.y0)), 3, maxK); // grand circuit : tout tient, même petit
    ox = (W - (b.x1 - b.x0) * k) / 2 - b.x0 * k; oy = (r.height - (b.y1 - b.y0) * k) / 2 - b.y0 * k + 6; applyView();
  }
  /** Cadre la sélection (éléments, ou les deux bouts du fil choisi) ; faux si rien n'est choisi. */
  function fitSel() {
    let list = [...sel].map(id => byId.get(id)).filter(Boolean);
    if (!list.length && selWire) { const w = C.wires.find(q => q.id === selWire); if (w) list = [byId.get(w.a[0]), byId.get(w.b[0])].filter(Boolean); }
    const b = list.length && bounds(list); if (!b) return false;
    frameBox(b, 40); return true;
  }

  /* ---------- Dessin ---------- */
  function wireCount() {
    const m = new Map();
    for (const w of C.wires) for (const [id, pin] of [w.a, w.b]) { const key = id + '|' + pin; m.set(key, (m.get(key) || 0) + 1); }
    return m;
  }
  function draw() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { drawNow(); });
  }
  function drawNow() {
    if (!sim) rebuildSim();
    const style = api.style(), counts = wireCount(), conflicts = sim.conflicts;
    // Fils
    const wl = [], dots = [];
    for (const w of C.wires) {
      const pts = routeWire(C, w, byId); if (!pts) continue;
      const d = 'M' + pts.map(p => p.join(' ')).join('L'), n = wireWidth(byId, w), bad = sim.bad.has(w.id);
      let cls;
      if (bad) cls = 'lvX lvBad';
      else if (n > 1) {
        // Bus : couleur propre, rouge si un bit est inconnu, pointillé si rien ne le pilote.
        const lv = sim.levels(w.a[0], w.a[1]);
        cls = 'bus ' + (lv.some(v => v === X) ? 'lvX' : lv.every(v => v === Z) ? 'lvZ' : 'lvB');
      } else { const net = sim.netOf(w.a[0], w.a[1]); cls = LV[sim.netLevel(net)] + (conflicts.has(net) ? ' lvC' : ''); }
      wl.push(`<path class="lgW ${cls}${selWire === w.id ? ' sel' : ''}" d="${d}"/><path class="lgWHit" data-w="${esc(w.id)}" d="${d}"/>`);
      if (n > 1) { const m = busMark(pts, n); wl.push(`<path class="lgBusMark" d="M${m.x - 0.35} ${m.y + 0.35}L${m.x + 0.35} ${m.y - 0.35}"/><text class="lgBusN" x="${m.horiz ? m.x : m.x + 0.6}" y="${m.horiz ? m.y - 0.55 : m.y + 0.3}" text-anchor="${m.horiz ? 'middle' : 'start'}">${n}</text>`); }
    }
    // Points de jonction (nœuds, et broches d'où partent plusieurs fils)
    for (const e of C.elements) {
      if (!DEFS[e.type]) continue;
      for (const p of pinsOf(e)) {
        const n = counts.get(e.id + '|' + p.name) || 0;
        if (e.type === 'junction' || n >= 2) dots.push(`<circle class="lgDot ${p.bus ? 'bus' : LV[sim.level(e.id, p.name)]}" cx="${p.wx}" cy="${p.wy}" r="${p.bus ? 0.34 : e.type === 'junction' ? 0.24 : 0.2}"/>`);
      }
    }
    gW.innerHTML = wl.join('') + dots.join('');
    // Éléments
    const out = [], wiring = mode && mode.kind === 'wire';
    for (const e of C.elements) {
      const d = DEFS[e.type]; if (!d || e.type === 'junction') { if (e.type === 'junction') out.push(junctionSvg(e, counts)); continue; }
      const p = propsOf(e), L = layoutOf(e), { w, h } = sizeOf(e), live = sim.live(e.id), isSel = sel.has(e.id), hov = hover && hover.id === e.id;
      const pins = pinsOf(e).map(q => {
        const n = counts.get(e.id + '|' + q.name) || 0, v = q.bus ? null : sim.level(e.id, q.name), open = !n;
        const show = open || hov || wiring || isSel;
        const warn = open && q.dir === 'in' && q.opt == null;
        const hot = hover && hover.pin === q.name && hover.id === e.id;
        return `${show ? `<circle class="lgPin ${open ? 'open' : q.bus ? 'bus' : LV[v]}${q.bus ? ' busPin' : ''}${warn ? ' warn' : ''}${hot ? ' hot' : ''}" cx="${q.wx}" cy="${q.wy}" r="${hot ? 0.36 : q.bus ? 0.3 : 0.24}"/>` : ''}<circle class="lgPinHit" data-e="${esc(e.id)}" data-p="${esc(q.name)}" cx="${q.wx}" cy="${q.wy}" r="0.55"/>`;
      }).join('');
      const lab = String(p.label || '').trim(), lp = labelPos(e);
      out.push(`<g class="lgEl${isSel ? ' sel' : ''}${hov ? ' hov' : ''} t-${e.type}" data-e="${esc(e.id)}">
        <rect class="lgHit" x="${e.x - 0.2}" y="${e.y - 0.2}" width="${w + 0.4}" height="${h + 0.4}" rx="0.4"/>
        <g transform="${elTransform(e)}">${opsSvg(d.sym(p, style, live), e.r || 0)}</g>
        ${lab && e.type !== 'tunnel' ? `<text class="lgLab" x="${lp.x}" y="${lp.y}" text-anchor="${lp.a}">${esc(lab)}</text>` : ''}
        ${p.watch ? `<path class="lgWatch" d="M${e.x + w - 0.1} ${e.y - 0.9}h0.35v-0.35h0.35v0.35h0.35" />` : ''}
        ${pins}</g>`);
    }
    gE.innerHTML = out.join('');
    drawOverlay();
    dirty = false;
    el.classList.toggle('empty', !C.elements.length);
    // Buzzers à 1 : le module joue le son (le plus aigu s'il y en a plusieurs).
    if (api.sound) api.sound(C.elements.filter(e => e.type === 'buzzer' && sim.level(e.id, 'A') === 1 && propsOf(e).sound).map(e => +propsOf(e).tone || 880));
  }
  function junctionSvg(e, counts) {
    const hov = hover && hover.id === e.id, bus = propsOf(e).bits > 1;
    return `<g class="lgEl t-junction${sel.has(e.id) ? ' sel' : ''}" data-e="${esc(e.id)}"><circle class="lgPinHit" data-e="${esc(e.id)}" data-p="J" cx="${e.x}" cy="${e.y}" r="0.55"/>${hov || sel.has(e.id) || !(counts.get(e.id + '|J')) ? `<circle class="lgPin ${!counts.get(e.id + '|J') ? 'open' : bus ? 'bus' : LV[sim.level(e.id, 'J')]}${hov ? ' hot' : ''}" cx="${e.x}" cy="${e.y}" r="${bus ? 0.4 : 0.32}"/>` : ''}</g>`;
  }
  function drawOverlay() {
    const o = [];
    for (const id of sel) { const e = byId.get(id); if (!e || e.type === 'junction') continue; const { w, h } = sizeOf(e); o.push(`<rect class="lgSelBox" x="${e.x - 0.45}" y="${e.y - 0.45}" width="${w + 0.9}" height="${h + 0.9}" rx="0.5"/>`); }
    if (mode && mode.kind === 'wire') {
      const a = mode.fromPos, b = mode.target ? mode.target.pos : [mode.cur[0], mode.cur[1], 'c'];
      const pts = route(a, b, mode.via);
      o.push(`<path class="lgW rubber" d="M${pts.map(p => p.join(' ')).join('L')}"/>`);
      mode.via.forEach(v => o.push(`<circle class="lgVia" cx="${v[0]}" cy="${v[1]}" r="0.18"/>`));
    }
    if (mode && mode.kind === 'box' && mode.moved) {
      const [x0, y0] = mode.w0, [x1, y1] = mode.cur;
      o.push(`<rect class="lgBand" x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}" width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}"/>`);
    }
    if (mode && mode.kind === 'place' && mode.in) {
      const g = { id: '_ghost', type: mode.type, x: mode.at[0], y: mode.at[1], r: mode.r || 0, p: mode.props };
      const d = DEFS[mode.type];
      o.push(`<g class="lgGhost"><g transform="${elTransform(g)}">${mode.type === 'junction' ? '<circle r="0.3" fill="var(--lgInk)"/>' : opsSvg(d.sym(propsOf(g), api.style(), null), g.r)}</g></g>`);
    }
    gO.innerHTML = o.join('');
  }

  /* ---------- Modifications ---------- */
  function newId(prefix) { const used = new Set([...C.elements.map(e => e.id), ...C.wires.map(w => w.id)]); let i = 1; while (used.has(prefix + i)) i++; return prefix + i; }
  function freeLabel(kind) {
    const used = new Set(C.elements.map(e => String((e.p && e.p.label) || '').trim()).filter(Boolean));
    if (kind === 'in') return IN_SEQ.find(l => !used.has(l)) || (() => { let i = 1; while (used.has('E' + i)) i++; return 'E' + i; })();
    if (kind === 'clk') { if (!used.has('CLK')) return 'CLK'; let i = 2; while (used.has('CLK' + i)) i++; return 'CLK' + i; }
    let i = 1; while (used.has('S' + i)) i++; return 'S' + i;
  }
  function addElement(type, x, y, props = {}, r = 0) {
    const d = DEFS[type]; if (!d) return null;
    const p = { ...props };
    if (d.auto && p.label == null) p.label = freeLabel(d.auto);
    const e = { id: newId(type === 'junction' ? 'j' : 'e'), type, x, y, r, p };
    C.elements.push(e); return e;
  }
  /** Ajoute un fil (sans doublon, sans boucle sur la même broche). */
  function addWire(a, b, via = []) {
    if (a.id === b.id && a.pin === b.pin) return null;
    if (C.wires.some(w => (w.a[0] === a.id && w.a[1] === a.pin && w.b[0] === b.id && w.b[1] === b.pin) || (w.b[0] === a.id && w.b[1] === a.pin && w.a[0] === b.id && w.a[1] === b.pin))) return null;
    const w = { id: newId('w'), a: [a.id, a.pin], b: [b.id, b.pin] }; if (via.length) w.via = via.map(v => [v[0], v[1]]);
    C.wires.push(w);
    // Deux sorties reliées : prévenir tout de suite (le fil passera au rouge).
    const pa = pinOf(a), pb = pinOf(b);
    if (pa && pb && pa.dir === 'out' && pb.dir === 'out') api.status(tl('Attention : deux sorties reliées entre elles. Si elles ne donnent pas le même niveau, le fil passe en X (conflit).'), 'warn');
    return w;
  }
  const pinOf = r => { const e = byId.get(r.id) || C.elements.find(x => x.id === r.id); return e ? layoutOf(e).pins.find(p => p.name === r.pin) : null; };
  /** Coupe un fil en (x, y) par un nœud ; rend la référence de broche du nœud. */
  function splitWire(wid, x, y) {
    const w = C.wires.find(q => q.id === wid); if (!w) return null;
    const pts = routeWire(C, w, byId); if (!pts) return null;
    const near = nearestOnRoute(pts, x, y);
    if (!near) return null; // fil de longueur nulle (deux broches au même point)
    const A = pts[0], B = pts[pts.length - 1];
    if (near.x === A[0] && near.y === A[1]) return { id: w.a[0], pin: w.a[1] };
    if (near.x === B[0] && near.y === B[1]) return { id: w.b[0], pin: w.b[1] };
    const n = wireWidth(byId, w), J = addElement('junction', near.x, near.y, n > 1 ? { bits: n } : {}); // nœud de bus sur un bus
    const before = pts.slice(1, near.seg + 1), after = pts.slice(near.seg + 1, -1);
    const w2 = { id: newId('w'), a: [J.id, 'J'], b: w.b }; if (after.length) w2.via = after;
    w.b = [J.id, 'J']; if (before.length) w.via = before; else delete w.via;
    C.wires.push(w2); byId.set(J.id, J);
    return { id: J.id, pin: 'J' };
  }
  function cleanJunctions() {
    const counts = wireCount();
    for (let i = C.elements.length - 1; i >= 0; i--) { const e = C.elements[i]; if (e.type === 'junction' && !counts.get(e.id + '|J')) C.elements.splice(i, 1); }
  }
  function removeElements(ids) {
    for (let i = C.elements.length - 1; i >= 0; i--) if (ids.has(C.elements[i].id)) C.elements.splice(i, 1);
    for (let i = C.wires.length - 1; i >= 0; i--) { const w = C.wires[i]; if (ids.has(w.a[0]) || ids.has(w.b[0])) C.wires.splice(i, 1); }
    cleanJunctions();
  }
  function deleteSelection() {
    if (selWire) { const i = C.wires.findIndex(w => w.id === selWire); if (i >= 0) C.wires.splice(i, 1); selWire = null; cleanJunctions(); structural(); commit(); emit('select'); return true; }
    if (!sel.size) return false;
    removeElements(sel); sel.clear(); structural(); commit(); emit('select'); return true;
  }
  function rotateSelection(dir = 1) {
    if (mode && mode.kind === 'place') { mode.r = ((mode.r || 0) + 90 * dir + 360) % 360; drawOverlay(); return true; }
    const list = [...sel].map(id => byId.get(id)).filter(e => e && e.type !== 'junction');
    if (!list.length) return false;
    for (const e of list) {
      // Rotation autour du centre de l'élément, gardée sur la grille.
      const before = sizeOf(e), cx = e.x + before.w / 2, cy = e.y + before.h / 2;
      e.r = ((e.r || 0) + 90 * dir + 360) % 360;
      const after = sizeOf(e); e.x = Math.round(cx - after.w / 2); e.y = Math.round(cy - after.h / 2);
    }
    structural(); commit(); return true;
  }
  let clip = null;
  function copySelection() {
    const ids = new Set([...sel].filter(id => byId.has(id)));
    if (!ids.size) return false;
    clip = { elements: C.elements.filter(e => ids.has(e.id)), wires: C.wires.filter(w => ids.has(w.a[0]) && ids.has(w.b[0])) };
    // Les blocs posés emportent leur définition : on peut les coller dans un autre projet.
    clip.blocks = [...blocksUsed(api.blockDefs ? api.blockDefs() : [], clip.elements).values()];
    clip = JSON.parse(JSON.stringify(clip));
    return true;
  }
  function paste(dx = 2, dy = 2) {
    if (!clip) return false;
    // Blocs collés : leur définition est reprise, sous un autre identifiant si celui-ci est déjà pris par un autre bloc.
    const refs = clip.blocks && clip.blocks.length && api.adoptBlocks ? api.adoptBlocks(clip.blocks) : null;
    const map = new Map(); sel.clear(); selWire = null;
    for (const e0 of clip.elements) {
      // Un bloc ne se pose pas dans lui-même (ni dans un bloc qu'il contient).
      if (e0.type === 'block' && api.canPlace && !api.canPlace(e0.p && e0.p.ref)) { api.status(tl('Un bloc ne peut pas se contenir lui-même.'), 'warn'); continue; }
      const d = DEFS[e0.type]; const p = { ...(e0.p || {}) };
      if (e0.type === 'block' && refs && refs.has(p.ref)) p.ref = refs.get(p.ref);
      // Repères des entrées et sorties : un nouveau s'il est déjà pris.
      if (d && d.auto && p.label && C.elements.some(x => x.p && x.p.label === p.label)) p.label = freeLabel(d.auto);
      const e = { id: newId(e0.type === 'junction' ? 'j' : 'e'), type: e0.type, x: e0.x + dx, y: e0.y + dy, r: e0.r || 0, p };
      C.elements.push(e); map.set(e0.id, e.id); sel.add(e.id);
    }
    for (const w of clip.wires) { if (!map.has(w.a[0]) || !map.has(w.b[0])) continue; const nw = { id: newId('w'), a: [map.get(w.a[0]), w.a[1]], b: [map.get(w.b[0]), w.b[1]] }; if (w.via) nw.via = w.via.map(v => [v[0] + dx, v[1] + dy]); C.wires.push(nw); }
    clip = { ...clip, elements: clip.elements.map(e => ({ ...e, x: e.x + dx, y: e.y + dy })), wires: clip.wires.map(w => ({ ...w, via: w.via && w.via.map(v => [v[0] + dx, v[1] + dy]) })) };
    if (api.sync) api.sync();
    structural(); commit(); emit('select'); return true;
  }
  function setProps(id, props) {
    const e = byId.get(id); if (!e) return;
    e.p = { ...(e.p || {}), ...props };
    for (const [key, v] of Object.entries(props)) if (v === undefined || v === '') delete e.p[key];
    // Broches disparues (moins d'entrées) : leurs fils partent avec elles.
    const names = new Set(layoutOf(e).pins.map(p => p.name));
    for (let i = C.wires.length - 1; i >= 0; i--) { const w = C.wires[i]; if ((w.a[0] === id && !names.has(w.a[1])) || (w.b[0] === id && !names.has(w.b[1]))) C.wires.splice(i, 1); }
    cleanJunctions(); structural(); commit();
  }
  /** Entrée basculée à la main (interrupteur, bloc DIP, bouton) : pas d'historique. */
  function poke(e, props) { Object.assign(e.p || (e.p = {}), props); sim.set(e.id, props); manualTick(); }

  /* ---------- Souris ---------- */
  function hit(e) {
    // Sous le curseur (et non e.target : pendant un glisser, la souris est capturée par le SVG).
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const t = under && svg.contains(under) ? under : e.target;
    const pinEl = t.closest && t.closest('[data-p]');
    if (pinEl) return { kind: 'pin', id: pinEl.dataset.e, pin: pinEl.dataset.p };
    const w = t.closest && t.closest('[data-w]');
    if (w) return { kind: 'wire', id: w.dataset.w };
    const g = t.closest && t.closest('[data-e]');
    if (g) return { kind: 'el', id: g.dataset.e };
    return { kind: 'bg' };
  }
  const pinRef = h => { const e = byId.get(h.id); const p = e && pinsOf(e).find(q => q.name === h.pin); return p ? { id: h.id, pin: h.pin, pos: [p.wx, p.wy, p.wside], dir: p.dir, w: pinWidth(p) } : null; };
  /** Deux largeurs différentes ne se relient pas : message, et false. */
  function sameWidth(a, b) {
    if (a === b) return true;
    api.status(a === 1 || b === 1 ? tl('Un fil simple (1 bit) ne se branche pas sur un bus de {0} bits : passez par un séparateur de bus.', Math.max(a, b)) : tl('Largeurs différentes : un bus de {0} bits et un bus de {1} bits.', a, b), 'warn');
    return false;
  }
  const wireW = id => { const w = C.wires.find(q => q.id === id); return w ? wireWidth(byId, w) : 1; };
  function startWire(ref, e, click = false) {
    mode = { kind: 'wire', from: ref, fromPos: ref.pos, via: [], cur: snap(toWorld(e)), click, x0: e.clientX, y0: e.clientY, moved: false, target: null };
    sel.clear(); selWire = null; emit('select'); draw();
  }
  /** split : un fil vient d'être coupé par un nœud (modification à garder même si le nouveau fil est refusé). */
  function finishWire(to, split = false) {
    const m = mode; mode = null;
    let w = null;
    if (to && !(to.id === m.from.id && to.pin === m.from.pin) && sameWidth(m.from.w, to.w)) {
      // Le fil part de préférence d'une sortie.
      const fromOut = m.from.dir === 'out' || to.dir === 'in';
      w = fromOut ? addWire(m.from, to, m.via) : addWire(to, m.from, [...m.via].reverse());
    }
    if (w || split) { structural(); commit(); } else draw();
  }
  svg.addEventListener('pointerdown', e => {
    tip.hidden = true;
    const h = hit(e), wpt = toWorld(e);
    if (e.button === 1 || (e.button === 0 && spaceDown)) { mode = { kind: 'pan', x0: e.clientX, y0: e.clientY, ox, oy }; svg.setPointerCapture(e.pointerId); el.classList.add('panning'); e.preventDefault(); return; }
    if (e.button !== 0) return;
    if (mode && mode.kind === 'place') {
      const e2 = addElement(mode.type, mode.at[0], mode.at[1], mode.props, mode.r || 0);
      sel = new Set([e2.id]); selWire = null;
      if (!e.shiftKey) mode = null;
      structural(); commit(); emit('select'); return;
    }
    if (mode && mode.kind === 'wire' && mode.click) {
      if (h.kind === 'pin') { finishWire(pinRef(h)); return; }
      if (h.kind === 'wire') { if (!sameWidth(mode.from.w, wireW(h.id))) return; const j = splitWire(h.id, wpt[0], wpt[1]); if (j) { byId = new Map(C.elements.map(x => [x.id, x])); finishWire(pinRef(j), true); } return; }
      mode.via.push(snap(wpt)); drawOverlay(); return;
    }
    svg.setPointerCapture(e.pointerId);
    if (h.kind === 'pin') { const r = pinRef(h); if (r) startWire(r, e); return; }
    if (h.kind === 'el') {
      const it = byId.get(h.id);
      if (e.shiftKey) { if (sel.has(h.id)) sel.delete(h.id); else sel.add(h.id); selWire = null; emit('select'); draw(); return; }
      if (!sel.has(h.id)) { sel = new Set([h.id]); selWire = null; emit('select'); }
      const orig = new Map([...sel].map(id => [id, byId.get(id)]).filter(([, x]) => x).map(([id, x]) => [id, [x.x, x.y]]));
      const vias = new Map(C.wires.filter(w => w.via && sel.has(w.a[0]) && sel.has(w.b[0])).map(w => [w.id, w.via.map(v => [...v])]));
      mode = { kind: 'press', id: h.id, x0: e.clientX, y0: e.clientY, w0: wpt, orig, vias, moved: false };
      if (it && it.type === 'button') { mode.button = true; poke(it, { pressed: true }); }
      if (it && it.type === 'keypad') { const key = keypadKey(...toLocal(it, wpt[0], wpt[1])); if (key >= 0) { mode.button = true; poke(it, { value: key, pressed: true }); } }
      draw(); return;
    }
    if (h.kind === 'wire') { mode = { kind: 'pressWire', id: h.id, x0: e.clientX, y0: e.clientY, w0: wpt }; return; }
    mode = { kind: 'box', x0: e.clientX, y0: e.clientY, w0: wpt, cur: wpt, moved: false, add: e.shiftKey };
  });
  svg.addEventListener('pointermove', e => {
    const wpt = toWorld(e); cursor = wpt;
    if (!mode || mode.kind === 'wire' || mode.kind === 'place') {
      const h = hit(e), nh = h.kind === 'pin' ? { id: h.id, pin: h.pin } : h.kind === 'el' ? { id: h.id } : h.kind === 'wire' ? { wire: h.id } : null;
      if (JSON.stringify(nh) !== JSON.stringify(hover)) { hover = nh; draw(); }
      showTip(h, e);
    }
    if (!mode) return;
    const moved = Math.hypot(e.clientX - mode.x0, e.clientY - mode.y0) > 4;
    if (mode.kind === 'pan') { ox = mode.ox + e.clientX - mode.x0; oy = mode.oy + e.clientY - mode.y0; applyView(); return; }
    if (mode.kind === 'place') { mode.in = true; const L = layoutOf({ type: mode.type, p: mode.props }), r = mode.r || 0, w = r % 180 ? L.h : L.w, h = r % 180 ? L.w : L.h; mode.at = [Math.round(wpt[0] - w / 2), Math.round(wpt[1] - h / 2)]; drawOverlay(); return; }
    if (mode.kind === 'wire') {
      mode.cur = snap(wpt); if (moved) mode.moved = true;
      const h = hit(e); mode.target = h.kind === 'pin' && !(h.id === mode.from.id && h.pin === mode.from.pin) ? pinRef(h) : null;
      drawOverlay(); return;
    }
    if (mode.kind === 'press' && (moved || mode.moved)) {
      if (!mode.moved && mode.button) { const it = byId.get(mode.id); if (it) poke(it, { pressed: false }); }
      mode.moved = true;
      const dx = Math.round(wpt[0] - mode.w0[0]), dy = Math.round(wpt[1] - mode.w0[1]);
      for (const [id, [x, y]] of mode.orig) { const it = byId.get(id); if (it) { it.x = x + dx; it.y = y + dy; } }
      for (const [wid, via] of mode.vias) { const w = C.wires.find(q => q.id === wid); if (w) w.via = via.map(v => [v[0] + dx, v[1] + dy]); }
      draw(); return;
    }
    if (mode.kind === 'pressWire' && moved) {
      // Tirer depuis un fil : un nœud est posé sur le fil, et un nouveau fil en part.
      const j = splitWire(mode.id, mode.w0[0], mode.w0[1]);
      mode = null;
      if (j) { structural(); commit(); const r = pinRef(j); if (r) startWire(r, e); } // le nœud est gardé même si le tracé est abandonné
      return;
    }
    if (mode.kind === 'box') { mode.cur = wpt; mode.moved = mode.moved || moved; drawOverlay(); }
  });
  svg.addEventListener('pointerup', e => {
    if (!mode) return;
    const h = hit(e), wpt = toWorld(e), m = mode;
    if (m.kind === 'pan') { mode = null; el.classList.remove('panning'); return; }
    if (m.kind === 'wire' && !m.click) {
      if (h.kind === 'pin' && !(h.id === m.from.id && h.pin === m.from.pin)) { finishWire(pinRef(h)); return; }
      if (h.kind === 'wire' && m.moved && sameWidth(m.from.w, wireW(h.id))) { const j = splitWire(h.id, wpt[0], wpt[1]); if (j) { byId = new Map(C.elements.map(x => [x.id, x])); finishWire(pinRef(j), true); } return; }
      // Relâché ailleurs : le tracé continue au clic (chaque clic pose un point de passage).
      if (m.moved) m.via.push(snap(wpt));
      m.click = true; drawOverlay(); api.status(tl('Cliquez pour poser des points de passage, puis sur une broche ou un fil pour terminer. Échap : annuler.'));
      return;
    }
    if (m.kind === 'press') {
      mode = null;
      const it = byId.get(m.id);
      if (m.moved) { structural(); commit(); return; }
      if (it && m.button) { poke(it, { pressed: false }); return; }
      if (it && it.type === 'switch') { poke(it, { value: propsOf(it).value ? 0 : 1 }); return; }
      if (it && it.type === 'dip') {
        // Bit sous le curseur : ligne de l'interrupteur dans le bloc (non tourné ou tourné).
        const p = propsOf(it), bit = clamp(Math.round(toLocal(it, wpt[0], wpt[1])[1]) - 1, 0, (p.bits || 4) - 1);
        poke(it, { value: (p.value || 0) ^ (1 << bit) }); return;
      }
      if (it && it.type === 'numin') {
        // Moitié haute : +1 ; moitié basse : −1 (le nombre fait le tour).
        const p = propsOf(it), m = 1 << (p.bits || 4), up = toLocal(it, wpt[0], wpt[1])[1] < layoutOf(it).h / 2;
        poke(it, { value: ((p.value || 0) + (up ? 1 : m - 1)) % m }); return;
      }
      draw(); return;
    }
    if (m.kind === 'pressWire') { mode = null; selWire = m.id; sel.clear(); emit('select'); draw(); return; }
    if (m.kind === 'box') {
      mode = null;
      if (!m.moved) { if (sel.size || selWire) { sel.clear(); selWire = null; emit('select'); } draw(); return; }
      const [x0, x1] = [Math.min(m.w0[0], m.cur[0]), Math.max(m.w0[0], m.cur[0])], [y0, y1] = [Math.min(m.w0[1], m.cur[1]), Math.max(m.w0[1], m.cur[1])];
      if (!m.add) sel.clear();
      for (const it of C.elements) { const { w, h: hh } = sizeOf(it); if (it.x >= x0 && it.y >= y0 && it.x + w <= x1 && it.y + hh <= y1) sel.add(it.id); }
      selWire = null; emit('select'); draw();
    }
  });
  svg.addEventListener('dblclick', async e => {
    const h = hit(e); if (h.kind !== 'el') return;
    const it = byId.get(h.id); if (!it) return;
    const d = DEFS[it.type];
    if (it.type === 'text') { const v = await api.ask(tl('Texte'), tl('Texte affiché sur le plan de travail'), propsOf(it).text || ''); if (v != null && v !== false) setProps(it.id, { text: String(v).slice(0, 80) }); return; }
    if (it.type === 'block') { if (api.openBlock) api.openBlock(propsOf(it).ref); return; }
    if (['switch', 'dip', 'button', 'numin', 'keypad'].includes(it.type)) return; // double clic = deux bascules
    if ((d.props || []).some(p => p.k === 'label')) editLabel(it);
  });
  async function editLabel(it) {
    const v = await api.ask(tl('Repère'), tl('Nom de l’élément (A, B, S1, CLK…) : les TP et la table de vérité s’en servent'), propsOf(it).label || '');
    if (v == null || v === false) return;
    const name = String(v).replace(/#/g, '').trim().slice(0, 12); // « # » est réservé aux bits des bus
    if (name && C.elements.some(x => x !== it && x.p && x.p.label === name && x.type !== 'tunnel')) { api.status(tl('Le repère {0} est déjà pris.', name), 'warn'); return; }
    setProps(it.id, { label: name || undefined });
  }
  svg.addEventListener('contextmenu', async e => {
    e.preventDefault();
    if (mode && mode.kind === 'wire') { mode = null; draw(); return; }
    if (mode && mode.kind === 'place') { mode = null; drawOverlay(); return; }
    const h = hit(e), anchor = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }) };
    if (h.kind === 'el' || (h.kind === 'pin' && byId.get(h.id) && byId.get(h.id).type !== 'junction')) {
      const it = byId.get(h.id); if (!it) return;
      if (!sel.has(it.id)) { sel = new Set([it.id]); selWire = null; emit('select'); draw(); }
      const d = DEFS[it.type], hasOut = layoutOf(it).pins.some(p => p.dir === 'out') && d.kind !== 'in';
      const items = [{ label: tl('Tourner · R'), icon: 'rotate', value: 'rot' }, { label: tl('Dupliquer · Ctrl+D'), icon: 'copy', value: 'dup' }];
      if (it.type === 'block') items.unshift({ label: tl('Ouvrir le bloc'), icon: 'edit', value: 'open' });
      if ((d.props || []).some(p => p.k === 'label')) items.push({ label: tl('Renommer…'), icon: 'tag', value: 'label' });
      if (hasOut) items.push({ label: it.p && it.p.watch ? tl('Retirer du chronogramme') : tl('Afficher au chronogramme'), icon: 'activity', value: 'watch' });
      items.push('-', { label: tl('Supprimer · Suppr'), icon: 'trash', value: 'del', danger: true });
      const v = await api.menu(anchor, items);
      if (v === 'open' && api.openBlock) api.openBlock(propsOf(it).ref);
      if (v === 'rot') rotateSelection(); else if (v === 'dup') { copySelection(); paste(); } else if (v === 'label') editLabel(it);
      else if (v === 'watch') setProps(it.id, { watch: it.p && it.p.watch ? undefined : 1 }); else if (v === 'del') deleteSelection();
      return;
    }
    if (h.kind === 'wire') {
      selWire = h.id; sel.clear(); emit('select'); draw();
      const v = await api.menu(anchor, [{ label: tl('Redresser le fil'), icon: 'route', value: 'straight' }, '-', { label: tl('Supprimer le fil'), icon: 'trash', value: 'del', danger: true }]);
      if (v === 'straight') { const w = C.wires.find(q => q.id === h.id); if (w) { delete w.via; structural(); commit(); } } else if (v === 'del') deleteSelection();
      return;
    }
    const v = await api.menu(anchor, [{ label: tl('Coller · Ctrl+V'), icon: 'copy', value: 'paste' }, { label: tl('Tout sélectionner · Ctrl+A'), icon: 'frame', value: 'all' }, { label: tl('Cadrer · F'), icon: 'expand', value: 'fit' }]);
    if (v === 'paste') { const at = snap(toWorld(e)); const b = clip && bounds(clip.elements); paste(b ? at[0] - b.x0 - 3 : 2, b ? at[1] - b.y0 - 2 : 2); } else if (v === 'all') selectAll(); else if (v === 'fit') fit();
  });
  // Molette : zoom ; pavé tactile (deux doigts) ou Maj : déplacement ; Ctrl/pincer : zoom.
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const f = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1, r = svg.getBoundingClientRect();
    const trackpad = Math.abs(e.deltaX) > 0.5 || (e.deltaMode === 0 && !Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey) { zoomAt(Math.exp(-e.deltaY * f * 0.01), e.clientX - r.left, e.clientY - r.top); return; }
    if (e.shiftKey && !Math.abs(e.deltaX)) { ox -= e.deltaY * f; applyView(); return; }
    if (e.shiftKey || trackpad) { ox -= e.deltaX * f; oy -= e.deltaY * f; applyView(); return; }
    zoomAt(Math.exp(-e.deltaY * f * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; if (mode && mode.kind === 'place') { mode.in = false; drawOverlay(); } if (hover) { hover = null; draw(); } });
  function showTip(h, e) {
    if (h.kind !== 'pin' || (mode && mode.kind !== 'wire')) { tip.hidden = true; return; }
    const it = byId.get(h.id), q = it && layoutOf(it).pins.find(p => p.name === h.pin); if (!q) { tip.hidden = true; return; }
    const name = it.type === 'junction' ? tl('Jonction') : `${esc(String(propsOf(it).label || '') || (it.type === 'block' && it.p.io ? it.p.io.t : DEFS[it.type].name()))} · ${q.ov ? `<span class="ov">${esc(q.label || q.name)}</span>` : esc(q.label || q.name)}`;
    let val;
    if (q.bus) { const lv = sim.levels(h.id, h.pin); val = `<b class="${lv.some(v => v === X) ? 'lvX' : lv.every(v => v === Z) ? 'lvZ' : 'lvB'}">${esc(busText(lv))}</b><small>${tl('bus de {0} bits', lv.length)}</small>`; }
    else { const v = sim.level(h.id, h.pin); val = `<b class="${LV[v]}">${['0', '1', 'X', 'Z'][v]}</b>`; }
    tip.innerHTML = `${name} ${val}${q.dir === 'in' ? `<small>${tl('entrée')}</small>` : q.dir === 'out' ? `<small>${tl('sortie')}</small>` : ''}`;
    const r = el.getBoundingClientRect(); tip.style.left = (e.clientX - r.left + 14) + 'px'; tip.style.top = (e.clientY - r.top + 12) + 'px'; tip.hidden = false;
  }
  function selectAll() { sel = new Set(C.elements.map(e => e.id)); selWire = null; emit('select'); draw(); }

  /* ---------- Clavier (appelé par le module quand le plan de travail logique est affiché) ---------- */
  function key(e) {
    const mod = e.ctrlKey || e.metaKey, kk = e.key.toLowerCase();
    if (e.type === 'keyup') { if (e.key === ' ') { spaceDown = false; el.classList.remove('grab'); } return false; }
    if (e.key === ' ' && !mod) { spaceDown = true; el.classList.add('grab'); return true; }
    if (kk === 'escape') {
      if (mode) { mode = null; draw(); return true; }
      if (sel.size || selWire) { sel.clear(); selWire = null; emit('select'); draw(); return true; }
      return false;
    }
    if (mod && kk === 'c') return copySelection();
    if (mod && kk === 'x') { if (copySelection()) deleteSelection(); return true; }
    if (mod && kk === 'v') return paste();
    if (mod && kk === 'd') { if (copySelection()) paste(); return true; }
    if (mod && kk === 'a') { selectAll(); return true; }
    if (mod && kk === 'k') { setRunning(!running); return true; }
    if (mod) return false;
    if (kk === 'delete' || kk === 'backspace') return deleteSelection() || true;
    if (kk === 'r') return rotateSelection(e.shiftKey ? -1 : 1) || true;
    if (kk === 'f') { fit(); return true; }
    if (kk === 't') { step(); return true; }
    if (kk === '+' || kk === '=') { zoomAt(1.2); return true; }
    if (kk === '-') { zoomAt(1 / 1.2); return true; }
    const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[kk];
    if (arrows) {
      if (sel.size) {
        const st = e.shiftKey ? 4 : 1;
        for (const id of sel) { const it = byId.get(id); if (it) { it.x += arrows[0] * st; it.y += arrows[1] * st; } }
        for (const w of C.wires) if (w.via && sel.has(w.a[0]) && sel.has(w.b[0])) w.via = w.via.map(v => [v[0] + arrows[0] * st, v[1] + arrows[1] * st]);
        structural(); clearTimeout(key.t); key.t = setTimeout(commit, 400);
      } else { ox -= arrows[0] * 60; oy -= arrows[1] * 60; applyView(); }
      return true;
    }
    return false;
  }

  /* ---------- Placement depuis la bibliothèque ---------- */
  function startPlace(type, props = {}) { mode = { kind: 'place', type, props: { ...props }, at: snap(cursor), in: false, r: 0 }; sel.clear(); selWire = null; emit('select'); draw(); api.status(tl('Cliquez sur le plan de travail pour poser l’élément (Maj : en poser plusieurs, R : tourner, Échap : annuler).')); }
  /** Glisser-déposer depuis la bibliothèque : l'élément suit la souris dès qu'elle entre dans le plan de travail. */
  function dragPlace(type, ev, props = {}) {
    let placed = false;
    const move = e => {
      const r = svg.getBoundingClientRect(), inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!mode || !mode.drag) mode = { kind: 'place', type, props: { ...props }, at: [0, 0], in: false, r: 0, drag: true }; // remplace un placement au clic en attente
      mode.in = inside;
      if (inside) { const wpt = toWorld(e), L = layoutOf({ type, p: props }); mode.at = [Math.round(wpt[0] - L.w / 2), Math.round(wpt[1] - L.h / 2)]; }
      drawOverlay();
    };
    const up = e => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      if (mode && mode.kind === 'place' && mode.drag) {
        if (mode.in) { const e2 = addElement(type, mode.at[0], mode.at[1], props, mode.r || 0); sel = new Set([e2.id]); selWire = null; placed = true; mode = null; structural(); commit(); emit('select'); }
        else { mode = null; drawOverlay(); }
      }
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    return () => placed;
  }

  /* ---------- Interface publique ---------- */
  const ro = new ResizeObserver(() => applyView()); ro.observe(el);
  applyView();
  return {
    el,
    /** Remplace le circuit affiché (objet partagé, modifié sur place par l'éditeur). */
    /**
     * Remplace le circuit affiché. ctx : nom du circuit (« root », « b:id » pour un bloc) ; un circuit déjà
     * ouvert sous ce nom retrouve son historique (annuler) et sa vue. Sans ctx, tout repart de zéro.
     */
    load(c, { keepView = false, ctx = null, fresh = false } = {}) {
      if (fresh) { contexts.clear(); ctx0 = null; }
      if (ctx0) contexts.set(ctx0, { H, view: [k, ox, oy] });
      C = c; C.elements = C.elements || []; C.wires = C.wires || [];
      sel.clear(); selWire = null; mode = null; hover = null; sim = null;
      for (const e of C.elements) if ((e.type === 'button' || e.type === 'keypad') && e.p) e.p.pressed = false;
      T = 0; next.clear(); trace.clear(); setRunning(false);
      const back = ctx ? contexts.get(ctx) : null;
      if (!ctx) contexts.clear();
      ctx0 = ctx; if (ctx) contexts.delete(ctx);
      if (back) { H = back.H; [k, ox, oy] = back.view; applyView(); } else { H = { undo: [], redo: [], snap: snapOf() }; }
      rebuildSim(); record(); dirty = true; drawNow();
      if (back) commit(); // le circuit a pu changer pendant l'absence (interface d'un bloc) : nouvelle étape
      else if (!keepView) requestAnimationFrame(fit);
      emit('struct'); emit('select'); emit('history');
    },
    /** Oublie l'historique d'un circuit (bloc supprimé) ; sans argument, celui de tous les blocs (exemple chargé). */
    forget(ctx) { if (ctx) contexts.delete(ctx); else for (const key of [...contexts.keys()]) if (key.startsWith('b:')) contexts.delete(key); },
    circuit: () => C, sim: () => sim, draw, redraw: () => { dirty = true; draw(); }, fit, fitSel, zoom: f => zoomAt(f), zoomLevel: () => k / 18,
    /* Navigation (src/ui/navdock.js) : 100 % = 18 pixels par carreau. */
    zoomAt: (f, x, y) => zoomAt(f, x, y), panBy(dx, dy) { ox += dx; oy += dy; applyView(); },
    setZoomPct: p => zoomAt((p / 100) * 18 / k), hasSel: () => sel.size > 0 || !!selWire, get svg() { return svg; },
    mini() {
      const b = bounds(), r = svg.getBoundingClientRect(); if (!b || !r.width) return null;
      return {
        bounds: [b.x0, b.y0, b.x1, b.y1],
        boxes: C.elements.filter(e => DEFS[e.type] && e.type !== 'junction').map(e => { const { w, h } = sizeOf(e); return [e.x, e.y, w, h, sel.has(e.id)]; }),
        view: [-ox / k, -oy / k, (r.width - ox) / k, (r.height - oy) / k]
      };
    },
    centerOn(x, y) { const r = svg.getBoundingClientRect(); ox = r.width / 2 - x * k; oy = r.height / 2 - y * k; applyView(); },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    selection: () => ({ els: [...sel].map(id => byId.get(id)).filter(Boolean), wire: selWire ? C.wires.find(w => w.id === selWire) || null : null }),
    select(ids) { sel = new Set(ids); selWire = null; emit('select'); draw(); },
    setProps, editLabel, deleteSelection, rotateSelection, duplicate: () => { if (copySelection()) paste(); }, startPlace, dragPlace,
    poke(id, props) { const it = byId.get(id); if (it) poke(it, props); },
    /** Applique plusieurs entrées d'un coup (ligne de la table de vérité choisie). */
    setInputs(list) { for (const [id, props] of list) { const it = byId.get(id); if (it) { Object.assign(it.p || (it.p = {}), props); sim.set(id, props); } } manualTick(); },
    key, releaseKeys() { spaceDown = false; el.classList.remove('grab', 'panning'); if (mode && mode.kind === 'pan') mode = null; }, running: () => running, setRunning, step, reset: resetSim, time: () => T, speed: () => speed, setSpeed: v => { speed = v; emit('run'); },
    trace: () => [...trace.values()].sort((a, b) => a.order - b.order), clearTrace() { trace.clear(); record(); emit('tick'); },
    history: { undo: () => travel(H.undo, H.redo), redo: () => travel(H.redo, H.undo), canUndo: () => H.undo.length > 0, canRedo: () => H.redo.length > 0 },
    commit, structural, bounds, timeText: () => fmtT(T),
    clocks: () => C.elements.some(e => e.type === 'clock')
  };
}
