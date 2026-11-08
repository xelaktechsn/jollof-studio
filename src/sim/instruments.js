// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Instruments de la paillasse analogique : oscilloscope 2 voies sur n'importe quel point du montage (onglet du banc de
// mesure), réglages des générateurs de fonctions (onglet Simulation) et tension alternative efficace du multimètre.
// Deux sources pour l'oscilloscope : le calcul en direct (dc.js relève chaque sous-pas des points suivis, setTap) et le
// « Lab analogique », où ngspice (analog.js, dans un fil à part) calcule une fenêtre de temps exacte, même pour des
// signaux de plusieurs kilohertz que le calcul en direct ne peut que moyenner.
import { tl } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { COLORS, si, fmt, paintGrid, divisions } from './plotkit.js';
import { setTap } from './dc.js';
import { transient } from './analog.js';
import { GEN_DEFAULT, WAVES, genRange } from './analog-parts.js';

const TDIV = [1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5, 1]; // s par division
const VDIV = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]; // V par division
const CAP = 1 << 15; // points gardés par voie en direct
const AMP_TYPES = /^(ind-|irlz44n$|dcmotor$|fan$|pump$|vibro$)/;
const WAVE_NAME = { sine: () => tl('Sinus'), square: () => tl('Carré'), triangle: () => tl('Triangle'), dc: () => tl('Continu') };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tText = s => (s >= 1 ? `${fmt(s, s < 10 ? 1 : 0)} s` : s >= 1e-3 ? `${fmt(s * 1e3, s < 1e-2 ? 1 : 0).replace(/[,.]0$/, '')} ms` : `${fmt(s * 1e6, 0)} µs`);
const vText = v => (v < 1 ? `${fmt(v * 1e3, 0)} mV` : `${fmt(v, 0)} V`);
const clampN = (v, lo, hi, d) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };

/** Mesures d'une forme d'onde : min, max, moyenne, efficace de la partie alternative, fréquence (passages par la moyenne). */
export function waveStats(t, v, i0 = 0, i1 = v.length) {
  let n = 0, s = 0, mn = Infinity, mx = -Infinity;
  for (let i = i0; i < i1; i++) { const x = v[i]; if (x !== x) continue; n++; s += x; if (x < mn) mn = x; if (x > mx) mx = x; }
  if (!n) return null;
  const mean = s / n;
  let q = 0;
  for (let i = i0; i < i1; i++) { const x = v[i]; if (x === x) q += (x - mean) * (x - mean); }
  const rms = Math.sqrt(q / n), hyst = (mx - mn) * 0.1, rises = [];
  let low = false;
  for (let i = i0; i < i1; i++) { const x = v[i]; if (x !== x) continue; if (x < mean - hyst) low = true; else if (low && x > mean + hyst) { low = false; rises.push(t[i]); } }
  const f = rises.length >= 2 && mx - mn > 1e-3 ? (rises.length - 1) / (rises[rises.length - 1] - rises[0]) : 0;
  return { min: mn, max: mx, pp: mx - mn, mean, rms, f };
}

/**
 * app : { bench() → banc de mesure (bench.js), comps(), analyze() → analyse du montage, simOn(), dc() → dernier calcul,
 *         ctx() → contexte du solveur (broches des programmes), freqOf(comp, clé) → Hz d'une sortie PWM, changed(),
 *         invalidate() }.
 */
export function installInstruments(app) {
  const comps = () => app.comps() || [];
  const sig = () => comps().map(c => c.id).join() + '|' + (app.wires ? app.wires().length : 0);

  /* ---------- Générateurs : section de l'onglet Simulation ---------- */
  let gsec = null, glist = null, gsig = '';
  function mountGens() {
    if (gsec) return true;
    const after = document.getElementById('probeSec'); if (!after) return false;
    after.insertAdjacentHTML('afterend', `<section id="genSec" hidden><h2>${icon('activity')}${tl('Générateurs')}</h2><ul class="probes gens" id="gens"></ul></section>`);
    gsec = document.getElementById('genSec'); glist = document.getElementById('gens');
    glist.addEventListener('input', e => editGen(e, false));
    glist.addEventListener('change', e => editGen(e, true));
    return true;
  }
  const gens = () => comps().filter(c => c.type === 'siggen');
  function genRow(c) {
    const g = { ...GEN_DEFAULT, ...(c.inp || {}) }, n = esc(c.name);
    return `<li data-id="${esc(c.id)}"><div class="ph"><b>${n}</b><span class="sig" data-range></span></div>
      <div class="gctl">
        <label>${tl('Forme')}<select data-g="wave" aria-label="${tl('Forme du signal de {0}', n)}">${WAVES.map(w => `<option value="${w}"${w === g.wave ? ' selected' : ''}>${WAVE_NAME[w]()}</option>`).join('')}</select></label>
        <label>${tl('Fréquence (Hz)')}<input type="number" data-g="freq" min="0.01" max="1000000" step="any" value="${g.freq}" aria-label="${tl('Fréquence de {0} en hertz', n)}"></label>
        <label>${tl('Amplitude (V)')}<input type="number" data-g="amp" min="0" max="10" step="0.05" value="${g.amp}" aria-label="${tl('Amplitude crête de {0} en volts', n)}"></label>
        <label>${tl('Décalage (V)')}<input type="number" data-g="off" min="-10" max="10" step="0.05" value="${g.off}" aria-label="${tl('Décalage de {0} en volts', n)}"></label>
      </div><p class="muted small" data-gnote></p></li>`;
  }
  function genNote(li, c) {
    const g = { ...GEN_DEFAULT, ...c.inp }, [lo, hi] = genRange(g);
    li.querySelector('[data-range]').textContent = g.wave === 'dc' ? si(g.off, 'V') : `${si(lo, 'V')} → ${si(hi, 'V')}`;
    li.querySelector('[data-gnote]').textContent = g.wave !== 'dc' && +g.freq > 25
      ? tl('Au-delà de 25 Hz, la simulation en direct ne voit que la moyenne ({0}) : l’oscilloscope en mode Lab analogique montre le vrai signal.', si(g.off, 'V'))
      : tl('Signal entre OUT et GND, résistance interne 50 Ω.');
    const fq = li.querySelector('[data-g="freq"]'); if (fq) fq.disabled = g.wave === 'dc';
  }
  function editGen(e, done) {
    const f = e.target.dataset.g, li = e.target.closest('li[data-id]'); if (!f || !li) return;
    const c = comps().find(x => x.id === li.dataset.id); if (!c) return;
    const v = e.target.value, inp = c.inp || (c.inp = { ...GEN_DEFAULT });
    if (f === 'wave') inp.wave = WAVES.includes(v) ? v : 'sine';
    else if (f === 'freq') inp.freq = clampN(v, 0.01, 1e6, inp.freq);
    else if (f === 'amp') inp.amp = clampN(v, 0, 10, inp.amp);
    else if (f === 'off') inp.off = clampN(v, -10, 10, inp.off);
    genNote(li, c); paintGenScreen(c); scope.stale = true; acCache.clear();
    if (done && app.changed) app.changed();
  }
  /** Écran 3D du générateur (library/analog.js) redessiné avec ses réglages. */
  function paintGenScreen(c) {
    const s = c.group && c.group.userData && c.group.userData.genScreen; if (!s) return;
    const key = JSON.stringify(c.inp || {}); if (s.key === key) return; s.key = key;
    const tex = s.mesh.material.map, x = tex.image.getContext('2d');
    x.clearRect(0, 0, tex.image.width, tex.image.height); s.paint(x, s.k, c.inp); tex.needsUpdate = true;
    if (app.invalidate) app.invalidate();
  }
  function refreshGens() {
    if (!mountGens()) return;
    const list = gens(), s = list.map(c => c.id + ':' + c.name).join();
    list.forEach(paintGenScreen);
    if (s === gsig) return;
    gsig = s; gsec.hidden = !list.length;
    glist.innerHTML = list.map(genRow).join('');
    for (const li of glist.children) { const c = list.find(x => x.id === li.dataset.id); if (c) genNote(li, c); }
  }

  /* ---------- Oscilloscope 2 voies ---------- */
  const scope = {
    src: 'live', tdiv: 1e-3, hold: false, stale: true, busy: false, last: 0, err: '', note: '',
    ch: [{ id: '', vdiv: 1, pos: -3 }, { id: '', vdiv: 1, pos: -3 }],
    trig: { ch: 0, edge: 'up', level: 1, mode: 'auto' },
    frame: null, // { t: Float64Array, v: [Float64Array|null, …], t0, t1 } affiché
    lab: null, // dernière fenêtre ngspice
    buf: { t: new Float64Array(CAP), v: [new Float64Array(CAP), new Float64Array(CAP)], n: 0, w: 0, clock: 0, lastPush: 0 }
  };
  let panel = null, canvas = null, g = null, visible = false, tapRefs = null, optsSig = '', lastNodes = 0;
  /** Points de mesure : chaque broche reliée, celles de l'oscilloscope d'abord. */
  function nodes() {
    const A = app.analyze(), out = [];
    if (!A) return out;
    const list = comps().filter(c => !/^breadboard/.test(c.type)).sort((a, b) => (b.type === 'scope') - (a.type === 'scope'));
    for (const c of list) for (const key of Object.keys(c.pins || {})) {
      if (c.type === 'scope' && key === 'GND') continue;
      if (A.members({ comp: c, key }).length < 2) continue;
      out.push({ id: c.id + '|' + key, label: `${c.name} · ${key}`, ref: { comp: c, key } });
    }
    return out;
  }
  const refOf = id => { if (!id) return null; const i = id.lastIndexOf('|'), c = comps().find(x => x.id === id.slice(0, i)); return c && c.pins[id.slice(i + 1)] ? { comp: c, key: id.slice(i + 1) } : null; };
  /** Masse de mesure d'une voie : la pince GND de l'oscilloscope quand la voie est l'une de ses entrées et qu'elle est reliée. */
  function gndOf(ref) {
    if (!ref || ref.comp.type !== 'scope' || !ref.comp.pins.GND) return null;
    const A = app.analyze(), r = { comp: ref.comp, key: 'GND' };
    return A && A.members(r).length > 1 ? r : null;
  }
  function autoPick(list) {
    const sc = comps().find(c => c.type === 'scope');
    scope.ch.forEach((ch, i) => {
      if (ch.id && list.some(o => o.id === ch.id)) return;
      const want = sc && list.find(o => o.id === `${sc.id}|CH${i + 1}`);
      ch.id = want ? want.id : '';
    });
  }

  function build() {
    panel = document.createElement('div');
    panel.className = 'bhScope2';
    panel.innerHTML = `<div class="s2chans">${[0, 1].map(i => `<div class="s2ch"><i style="background:${COLORS[i]}"></i><select data-node="${i}" aria-label="${tl('Point observé par la voie {0}', i + 1)}"></select>
        <select data-vdiv="${i}" aria-label="${tl('Sensibilité de la voie {0}', i + 1)}">${VDIV.map(v => `<option value="${v}"${v === 1 ? ' selected' : ''}>${vText(v)}/div</option>`).join('')}</select>
        <label class="s2pos" title="${tl('Position du zéro (divisions)')}">⇕<input type="number" data-pos="${i}" min="-4" max="4" step="0.5" value="-3" aria-label="${tl('Position du zéro de la voie {0}', i + 1)}"></label>
        <span class="meas" data-m2="${i}"></span></div>`).join('')}</div>
      <canvas width="560" height="220"></canvas>
      <div class="scopeBar s2bar">
        <label>${tl('Temps')} <select data-tdiv>${TDIV.map(s => `<option value="${s}"${s === 1e-3 ? ' selected' : ''}>${tText(s)}/div</option>`).join('')}</select></label>
        <label>${tl('Déclenchement')} <select data-tch><option value="0">CH1</option><option value="1">CH2</option></select><select data-tedge aria-label="${tl('Front de déclenchement')}"><option value="up">↑</option><option value="down">↓</option></select><input type="number" data-tlevel step="0.1" value="1" aria-label="${tl('Niveau de déclenchement en volts')}"> V</label>
        <select data-tmode aria-label="${tl('Mode de déclenchement')}"><option value="auto">${tl('Auto')}</option><option value="normal">${tl('Normal')}</option></select>
      </div>
      <div class="scopeBar s2bar"><div class="seg" role="group" aria-label="${tl('Source des courbes')}"><button type="button" data-src="live" class="on" data-tip="${tl('Courbes du calcul en direct, pendant la simulation')}">${tl('Direct')}</button><button type="button" data-src="lab" data-tip="${tl('ngspice calcule une fenêtre de temps exacte, même pour des signaux rapides')}">${icon('activity')}${tl('Lab analogique')}</button></div>
        <button type="button" class="btn small" data-s2hold>${icon('stop')}<span>${tl('Figer')}</span></button><button type="button" class="btn small" data-s2run hidden>${icon('play')}<span>${tl('Recalculer')}</span></button><span class="muted small" data-s2note></span></div>`;
    canvas = panel.querySelector('canvas'); g = canvas.getContext('2d');
    panel.addEventListener('change', onChange);
    panel.addEventListener('click', onClick);
  }
  function onChange(e) {
    const s = e.target, d = s.dataset;
    if (d.node != null) { scope.ch[+d.node].id = s.value; retap(); scope.stale = true; }
    if (d.vdiv != null) scope.ch[+d.vdiv].vdiv = +s.value;
    if (d.pos != null) scope.ch[+d.pos].pos = clampN(s.value, -4, 4, -3);
    if (d.tdiv != null) { scope.tdiv = +s.value; scope.stale = true; }
    if (d.tch != null) scope.trig.ch = +s.value;
    if (d.tedge != null) scope.trig.edge = s.value;
    if (d.tlevel != null) scope.trig.level = clampN(s.value, -50, 50, 1);
    if (d.tmode != null) scope.trig.mode = s.value;
  }
  function onClick(e) {
    const b = e.target.closest('[data-src]');
    if (b) { scope.src = b.dataset.src; panel.querySelectorAll('[data-src]').forEach(x => x.classList.toggle('on', x === b)); panel.querySelector('[data-s2run]').hidden = scope.src !== 'lab'; scope.stale = true; scope.frame = null; retap(); return; }
    if (e.target.closest('[data-s2hold]')) { scope.hold = !scope.hold; panel.querySelector('[data-s2hold] span').textContent = scope.hold ? tl('Reprendre') : tl('Figer'); return; }
    if (e.target.closest('[data-s2run]')) { scope.stale = true; runLab(); }
  }
  function paintNodes() {
    const list = nodes(), s = list.map(o => o.id).join();
    autoPick(list);
    if (s + '|' + scope.ch.map(c => c.id).join() === optsSig) return;
    optsSig = s + '|' + scope.ch.map(c => c.id).join();
    panel.querySelectorAll('[data-node]').forEach(sel => {
      const i = +sel.dataset.node;
      sel.innerHTML = `<option value="">${tl('— voie libre —')}</option>` + list.map(o => `<option value="${esc(o.id)}"${o.id === scope.ch[i].id ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    });
    retap();
  }

  /* ----- Direct : relevé de chaque sous-pas du calcul ----- */
  function retap() {
    const live = visible && scope.src === 'live';
    const refs = scope.ch.map(c => refOf(c.id)), grounds = refs.map(gndOf);
    if (!live || !refs.some(Boolean)) { setTap(null); tapRefs = null; return; }
    tapRefs = [...refs, ...grounds];
    scope.buf.n = 0; scope.buf.w = 0;
    setTap({ refs: tapRefs, push: onTap });
  }
  function put(t, a, b) {
    const B = scope.buf, k = B.w;
    B.t[k] = t; B.v[0][k] = a; B.v[1][k] = b;
    B.w = (k + 1) % CAP; if (B.n < CAP) B.n++;
  }
  function onTap(f) {
    if (scope.hold) return;
    const B = scope.buf, v = f.v, val = (i, k) => (v[i] ? v[i][k] - (v[i + 2] ? v[i + 2][k] : 0) : NaN);
    for (let k = 0; k < f.n; k++) { B.clock += f.h; put(B.clock, val(0, k), val(1, k)); }
    B.lastPush = performance.now();
  }
  /** Circuit sans élément dynamique : le calcul en direct ne fait pas de pas de temps ; on relève une valeur par image. */
  function sampleStatic(now) {
    const B = scope.buf, dc = app.dc();
    if (scope.hold || !app.simOn() || !dc || !dc.ok || now - B.lastPush < 300) return;
    const dt = B.lastSample ? Math.min(0.25, (now - B.lastSample) / 1000) : 0.05; B.lastSample = now;
    const rd = i => { const r = refOf(scope.ch[i].id); if (!r) return NaN; const v = dc.volts(r), gr = gndOf(r), vg = gr ? dc.volts(gr) : 0; return v == null || vg == null ? NaN : v - vg; };
    B.clock += dt; put(B.clock, rd(0), rd(1));
  }
  /** Copie ordonnée des points en direct de [t0, t1]. */
  function liveSlice(t0, t1) {
    const B = scope.buf, n = B.n, start = (B.w - n + CAP) % CAP, t = [], a = [], b = [];
    for (let j = 0; j < n; j++) { const k = (start + j) % CAP, x = B.t[k]; if (x < t0 || x > t1) continue; t.push(x); a.push(B.v[0][k]); b.push(B.v[1][k]); }
    return { t: Float64Array.from(t), v: [Float64Array.from(a), Float64Array.from(b)] };
  }
  /**
   * Front de déclenchement le plus récent dans [lo, hi] (temps), ou null. En mode Auto, un signal qui ne franchit pas le
   * niveau choisi se déclenche à mi-hauteur (comme le « 50 % » d'un vrai oscilloscope).
   */
  function findTrig(t, v, lo, hi) {
    let f = trigAt(t, v, lo, hi, scope.trig.level);
    scope.autoLevel = null;
    if (f == null && scope.trig.mode === 'auto') {
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < t.length; i++) if (t[i] >= lo && t[i] <= hi && v[i] === v[i]) { if (v[i] < mn) mn = v[i]; if (v[i] > mx) mx = v[i]; }
      if (mx - mn > 1e-3) { f = trigAt(t, v, lo, hi, (mn + mx) / 2); if (f != null) scope.autoLevel = (mn + mx) / 2; }
    }
    return f;
  }
  function trigAt(t, v, lo, hi, L) {
    const up = scope.trig.edge === 'up';
    let found = null;
    for (let i = 1; i < t.length; i++) {
      if (t[i] < lo || t[i] > hi) continue;
      const a = v[i - 1], b = v[i];
      if (a !== a || b !== b) continue;
      if (up ? a < L && b >= L : a > L && b <= L) found = t[i - 1] + (t[i] - t[i - 1]) * (L - a) / ((b - a) || 1);
    }
    return found;
  }
  function liveFrame() {
    const B = scope.buf, W = 10 * scope.tdiv, now = B.clock, pre = 0.2 * W;
    if (!B.n) return null;
    const data = liveSlice(now - 3 * W, now), tv = data.v[scope.trig.ch];
    const tr = findTrig(data.t, tv, now - 2 * W, now - W + pre);
    if (tr != null) return { ...data, t0: tr - pre, t1: tr - pre + W, trig: tr };
    if (scope.trig.mode === 'normal' && scope.frame && !scope.frame.lab) return scope.frame;
    return { ...data, t0: now - W, t1: now, trig: null };
  }

  /* ----- Lab analogique : fenêtre ngspice ----- */
  function labOpts(W) {
    const tstop = 3 * W;
    return { tstop, tstep: W / 400, freqOf: app.freqOf || (() => 490) };
  }
  async function runLab() {
    if (scope.busy || !visible || scope.src !== 'lab') return;
    const refs = scope.ch.map(c => refOf(c.id));
    if (!refs.some(Boolean)) { scope.note = tl('Choisissez un point sur une voie.'); return; }
    scope.busy = true; scope.stale = false; scope.err = ''; scope.note = tl('ngspice calcule…');
    const W = 10 * scope.tdiv, t0 = performance.now();
    try {
      const A = app.analyze(), r = await transient(comps(), A, app.ctx(), labOpts(W));
      if (!r || !r.t.length) throw new Error(tl('rien à calculer : le montage n’a pas de source'));
      // Le nœud de référence (masse) n'a pas de courbe dans ngspice : 0 V.
      const at = x => (x ? r.volts(x) || (A && A.net(x).gnd.length ? new Float64Array(r.t.length) : null) : null);
      const tracks = refs.map(ref => {
        const v = at(ref), gr = gndOf(ref), vg = gr ? at(gr) : null;
        if (!v) return null;
        return vg ? v.map((x, i) => x - vg[i]) : v;
      });
      const tv = tracks[scope.trig.ch] || tracks.find(Boolean), tr = tv ? findTrig(r.t, tv, W, 2.2 * W) : null, pre = 0.2 * W;
      const start = tr != null ? tr - pre : r.t[r.t.length - 1] - W;
      scope.lab = { t: r.t, v: tracks, t0: start, t1: start + W, trig: tr, lab: true };
      scope.note = tl('Lab analogique : fenêtre de {0} calculée par ngspice en {1} ms.', tText(3 * W), Math.round(performance.now() - t0));
    } catch (e) {
      scope.err = tl('Calcul impossible : {0}', String(e && e.message || e).slice(0, 160)); scope.lab = null;
    } finally { scope.busy = false; scope.last = performance.now(); }
  }

  /* ----- Dessin ----- */
  function draw(now) {
    if (!visible || !panel) return;
    if (now - lastNodes > 500) { lastNodes = now; paintNodes(); } // liste des points : deux fois par seconde suffit
    const W = canvas.width = Math.max(300, Math.round(canvas.clientWidth || 560)), H = canvas.height;
    paintGrid(g, W, H, divisions(W, 10), divisions(H, 8));
    // Axe central plus visible, comme sur un vrai écran.
    g.strokeStyle = '#21464d'; g.beginPath(); g.moveTo(0, H / 2 + 0.5); g.lineTo(W, H / 2 + 0.5); g.moveTo(W / 2 + 0.5, 0); g.lineTo(W / 2 + 0.5, H); g.stroke();
    let fr;
    if (scope.src === 'lab') {
      if (scope.stale || (app.simOn() && now - scope.last > 2000 && !scope.hold)) runLab();
      fr = scope.lab;
    } else {
      sampleStatic(now);
      fr = scope.hold && scope.frame ? scope.frame : liveFrame();
    }
    if (fr) scope.frame = fr;
    const note = panel.querySelector('[data-s2note]');
    if (!fr) note.textContent = scope.err || (scope.src === 'lab' ? scope.note : app.simOn() ? tl('Choisissez un point sur une voie.') : tl('Lancez la simulation, ou passez en Lab analogique.'));
    else note.textContent = scope.err || (scope.src === 'lab' ? scope.note : fr.trig != null ? (scope.autoLevel != null ? tl('Déclenché à mi-hauteur ({0}).', si(scope.autoLevel, 'V')) : tl('Déclenché.')) : tl('Défilement (aucun front au niveau choisi).'));
    if (!fr) return;
    const span = fr.t1 - fr.t0, X = t => ((t - fr.t0) / span) * W;
    scope.ch.forEach((ch, i) => {
      const v = fr.v[i], el = panel.querySelector(`[data-m2="${i}"]`);
      if (!v || !ch.id) { if (el) el.textContent = ''; return; }
      const Y = x => H / 2 - ((x / ch.vdiv) + ch.pos) * (H / 8);
      g.strokeStyle = COLORS[i]; g.lineWidth = 1.6; g.beginPath();
      let started = false, i0 = -1, i1 = -1;
      for (let k = 0; k < fr.t.length; k++) {
        const t = fr.t[k]; if (t < fr.t0 - span * 0.01 || t > fr.t1 + span * 0.01) continue;
        if (i0 < 0) i0 = k; i1 = k + 1;
        const x = v[k]; if (x !== x) { started = false; continue; }
        const px = X(t), py = Math.max(-4, Math.min(H + 4, Y(x)));
        if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
      }
      g.stroke();
      // Repère du zéro de la voie, à gauche.
      g.fillStyle = COLORS[i]; const z = Y(0); g.beginPath(); g.moveTo(0, z - 4); g.lineTo(7, z); g.lineTo(0, z + 4); g.fill();
      const st = i0 >= 0 ? waveStats(fr.t, v, i0, i1) : null;
      if (el) el.textContent = st ? `${si(st.pp, 'V')} c-c · ${tl('moy.')} ${si(st.mean, 'V')} · ${tl('eff.')}∿ ${si(st.rms, 'V')}${st.f > 0 ? ` · ${si(st.f, 'Hz')}` : ''}` : '';
    });
    // Niveau et instant de déclenchement.
    const tc = scope.ch[scope.trig.ch];
    if (tc && tc.id) { const y = H / 2 - (((scope.autoLevel ?? scope.trig.level) / tc.vdiv) + tc.pos) * (H / 8); g.strokeStyle = '#e0703a'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]); }
    if (fr.trig != null) { const x = X(fr.trig); g.fillStyle = '#e0703a'; g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 7); g.fill(); }
    g.fillStyle = '#5f7b80'; g.font = '10px ui-monospace, monospace';
    g.fillText(`${tText(scope.tdiv)}/div`, W - 70, H - 5);
    scope.ch.forEach((c, i) => { if (c.id) { g.fillStyle = COLORS[i]; g.fillText(`CH${i + 1} ${vText(c.vdiv)}/div`, 6 + i * 110, H - 5); } });
  }

  /* ----- Multimètre : tension alternative efficace ----- */
  const acCache = new Map();
  function acWindow() {
    // Dix périodes du générateur le plus lent (ou de la PWM), dont on garde la seconde moitié (régime établi).
    let f = 0;
    for (const c of gens()) { const g0 = { ...GEN_DEFAULT, ...c.inp }; if (g0.wave !== 'dc' && +g0.freq > 0) f = f ? Math.min(f, +g0.freq) : +g0.freq; }
    if (!f && comps().some(c => c.type === 'ne555')) f = 1;
    const T = f ? Math.min(4, Math.max(2e-3, 20 / f)) : 0.1;
    return { tstop: T, tstep: T / 4000, freqOf: app.freqOf || (() => 490) };
  }
  function ac(ra, rb) {
    const key = `${ra.comp.id}|${ra.key}|${rb ? rb.comp.id + '|' + rb.key : ''}|${sig()}`, hit = acCache.get(key), now = performance.now();
    if (hit && (hit.pending || now - hit.at < (app.simOn() ? 2500 : 60000))) return hit.res || { pending: true };
    const ent = { pending: true, at: now, res: hit && hit.res };
    acCache.set(key, ent);
    (async () => {
      try {
        const A = app.analyze(), r = await transient(comps(), A, app.ctx(), acWindow());
        if (!r) throw new Error(tl('montage sans source'));
        const get = ref => { const v = ref ? r.volts(ref) : null; return v || (ref && A.net(ref).gnd.length ? new Float64Array(r.t.length) : null); };
        const va = get(ra), vb = rb ? get(rb) : new Float64Array(r.t.length);
        if (!va || !vb) throw new Error(tl('point non relié au circuit'));
        const d = va.map((x, i) => x - vb[i]), half = r.t.findIndex(t => t >= r.t[r.t.length - 1] / 2);
        const st = waveStats(r.t, d, Math.max(0, half), d.length);
        ent.res = st ? { rms: st.rms, mean: st.mean, f: st.f } : { error: tl('aucune valeur') };
      } catch (e) { ent.res = { error: String(e && e.message || e).slice(0, 120) }; }
      ent.pending = false; ent.at = performance.now();
    })();
    return ent.res || { pending: true };
  }

  /* ----- Installation ----- */
  let tries = 0;
  const hook = () => {
    const b = app.bench && app.bench();
    if (!b) { if (tries++ < 200) setTimeout(hook, 100); return; }
    build();
    b.addTab({ id: 'scope2', label: tl('Oscilloscope 2 voies'), icon: 'activity', el: panel, onShow: on => { visible = on; if (on) { optsSig = ''; paintNodes(); scope.stale = true; } retap(); }, draw });
    b.setAc(ac);
    // Ampèremètre : bobines, MOSFET (courant de drain) et moteurs s'ajoutent aux composants mesurables.
    b.extraParts = () => comps().filter(c => AMP_TYPES.test(c.type)).map(c => ({ id: c.id, label: `${c.name} · ${c.type === 'irlz44n' ? tl('courant de drain') : c.type === 'ind-10m' ? tl('bobine') : tl('moteur')}`, comp: c }));
  };
  hook();
  setInterval(() => { refreshGens(); if (visible && sig() !== scope.sig) { scope.sig = sig(); optsSig = ''; scope.stale = true; acCache.clear(); } }, 500);
  return { scope, waveStats, refresh: refreshGens, show: () => { const b = app.bench && app.bench(); if (b) b.show('scope2'); } };
}
