// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Banc de mesure : un oscilloscope (analyseur logique à 4 voies) et un multimètre, comme sur
// une paillasse d'électronique. Fenêtre flottante sur le plan de travail.
// Oscilloscope : chaque voie suit une broche d'une carte ; les fronts des sorties arrivent du
// programme avec leur heure virtuelle exacte (aucun front perdu), les entrées sont échantillonnées
// à chaque image. Défilement continu (mode « roll ») ; fréquence, rapport cyclique et tension mesurés.
// Multimètre : tension entre deux points du montage, ou courant dans un composant (calcul du
// circuit en continu, sim/dc.js). Dessin en canevas 2D, cadencé, seulement quand c'est visible.
// D'autres instruments s'y ajoutent en onglets (addTab : oscilloscope 2 voies de sim/instruments.js) ; la tension
// alternative efficace du multimètre (V∿) vient d'eux (setAc), calculée sur une fenêtre de transitoire.
import { tl } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { COLORS, si, paintGrid, divisions } from './plotkit.js';

const SPANS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]; // ms par division
const KEEP = 12000; // ms de signal gardés par voie
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * ctx : { boards() → [{ id, name, rt, pins: [clé…] }], probes() → [{ id, label, ref }] (points de mesure),
 *         parts() → [{ id, label, comp }] (composants traversés par un courant), dc() → résultat du calcul ou null,
 *         simOn(), fps (cadence d'affichage), onShow(visible) }
 */
export function createBench(host, ctx) {
  const el = document.createElement('div');
  el.className = 'bench'; el.hidden = true;
  el.innerHTML = `<header class="bhHead"><div class="bhTabs" role="tablist"><button type="button" data-tab="scope" class="on">${icon('activity')}${tl('Oscilloscope')}</button><button type="button" data-tab="meter">${icon('gauge') || icon('zap')}${tl('Multimètre')}</button></div><span class="grow"></span><button type="button" class="tb" data-bclose aria-label="${tl('Fermer le banc de mesure')}">${icon('x')}</button></header>
    <div class="bhScope"><div class="chans"></div><canvas width="560" height="170"></canvas><div class="scopeBar"><label>${tl('Base de temps')} <select data-span>${SPANS.map(s => `<option value="${s}"${s === 50 ? ' selected' : ''}>${s < 1000 ? s + ' ms' : s / 1000 + ' s'}/div</option>`).join('')}</select></label><button type="button" class="btn small" data-hold>${icon('stop')}<span>${tl('Figer')}</span></button><span class="muted small" data-note></span></div></div>
    <div class="bhMeter" hidden><div class="dmm"><div class="lcd"><span data-read>——</span><small data-unit></small></div>
      <div class="dmmModes"><button type="button" data-mode="V" class="on">V ⎓</button><button type="button" data-mode="VAC" data-tip="${tl('Tension alternative efficace (RMS), calculée sur une fenêtre de temps')}">V ∿</button><button type="button" data-mode="mA">mA ⎓</button></div></div>
      <div class="dmmProbes" data-v><label><i class="probe red"></i>${tl('Pointe rouge')}<select data-red></select></label><label><i class="probe black"></i>${tl('Pointe noire')}<select data-black></select></label></div>
      <div class="dmmProbes" data-i hidden><label>${tl('Composant traversé')}<select data-part></select></label></div>
      <p class="muted small dmmHint"></p></div>`;
  host.appendChild(el);
  const $ = s => el.querySelector(s), canvas = $('canvas'), g = canvas.getContext('2d');
  let tab = 'scope', hold = false, span = 50, mode = 'V', lastDraw = 0, lastMeter = 0;
  const extra = []; // onglets ajoutés : { id, el, onShow(visible), draw(now) }
  // Composants traversés par un courant : ceux du contexte, plus ceux qu'ajoute un instrument (api.extraParts).
  const partsAll = () => { const a = ctx.parts(), ids = new Set(a.map(p => p.id)); return api.extraParts ? [...a, ...api.extraParts().filter(p => !ids.has(p.id))] : a; };
  const showTab = id => {
    tab = id;
    el.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === id));
    $('.bhScope').hidden = id !== 'scope'; $('.bhMeter').hidden = id !== 'meter';
    for (const x of extra) { x.el.hidden = x.id !== id; if (x.onShow) x.onShow(!el.hidden && x.id === id); }
    if (id === 'meter') paintProbes();
  };
  const chans = [0, 1, 2, 3].map(i => ({ i, color: COLORS[i], board: null, key: null, buf: [], last: null }));

  /* ---------- Voies ---------- */
  function paintChans() {
    const bs = ctx.boards();
    const opts = sel => `<option value="">${tl('— voie libre —')}</option>${bs.map(b => `<optgroup label="${esc(b.name)}">${b.pins.map(k => `<option value="${esc(b.id + '|' + k)}"${sel === b.id + '|' + k ? ' selected' : ''}>${esc(k)}</option>`).join('')}</optgroup>`).join('')}`;
    $('.chans').innerHTML = chans.map(c => `<div class="chan"><i style="background:${c.color}"></i><select data-ch="${c.i}" aria-label="${tl('Voie {0}', c.i + 1)}">${opts(c.board ? c.board + '|' + c.key : '')}</select><span class="meas" data-m="${c.i}"></span></div>`).join('');
  }
  el.addEventListener('change', e => {
    const s = e.target;
    if (s.dataset.ch != null) { const c = chans[+s.dataset.ch], [b, ...k] = s.value.split('|'); c.board = s.value ? b : null; c.key = s.value ? k.join('|') : null; c.buf = []; c.last = null; attachTraces(); }
    if (s.dataset.span != null) span = +s.value;
    if (s.matches('[data-red],[data-black],[data-part]')) meter(true);
  });
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-tab]');
    if (t) { showTab(t.dataset.tab); return; }
    if (e.target.closest('[data-bclose]')) { api.toggle(false); return; }
    if (e.target.closest('[data-hold]')) { hold = !hold; $('[data-hold] span').textContent = hold ? tl('Reprendre') : tl('Figer'); return; }
    const m = e.target.closest('[data-mode]');
    if (m) { mode = m.dataset.mode; el.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('on', x === m)); $('[data-v]').hidden = mode === 'mA'; $('[data-i]').hidden = mode !== 'mA'; meter(true); }
  });

  /** Chaque carte signale les changements de ses sorties suivies. */
  function attachTraces() {
    for (const b of ctx.boards()) {
      if (!b.rt || !b.rt.setTrace) continue;
      const watched = chans.filter(c => c.board === b.id);
      b.rt.setTrace(watched.length ? (k, st, vt) => { for (const c of watched) if (c.key === k && !hold) push(c, vt, st.d ? b.rt.logic : 0, st.pwm, st.freq); } : null);
    }
  }
  function push(c, t, v, pwm, freq) {
    const L = c.last;
    if (L && L[1] === v && L[2] === pwm && L[3] === freq) return;
    c.last = [t, v, pwm, freq]; c.buf.push(c.last);
    if (c.buf.length > 4000 || (c.buf.length > 2 && t - c.buf[0][0] > KEEP)) { const cut = c.buf.findIndex(x => t - x[0] <= KEEP); c.buf.splice(0, Math.max(1, cut - 1)); }
  }
  /** À chaque image de simulation : entrées échantillonnées (les sorties arrivent par le suivi). */
  function sample() {
    if (el.hidden || hold) return;
    const bs = new Map(ctx.boards().map(b => [b.id, b]));
    for (const c of chans) {
      const b = c.board && bs.get(c.board); if (!b || !b.rt || !b.rt.probe) continue;
      const r = b.rt.probe(c.key), t = b.rt.clock(); if (!r) continue;
      if (!r.out || !c.last) push(c, t, r.out ? (r.d ? b.rt.logic : 0) : r.v, r.pwm, r.freq);
      c.now = t; c.logic = b.rt.logic;
    }
  }

  /* ---------- Dessin ---------- */
  function draw(now) {
    if (el.hidden || tab !== 'scope' || now - lastDraw < 1000 / ctx.fps) return;
    lastDraw = now;
    const W = canvas.width, H = canvas.height, used = chans.filter(c => c.board), n = Math.max(1, used.length), lane = H / n;
    paintGrid(g, W, H, divisions(W, 10), divisions(H, n));
    const win = span * 10;
    used.forEach((c, li) => {
      const t1 = c.now || (c.last ? c.last[0] : 0), t0 = t1 - win, vmax = Math.max(c.logic || 5, ...c.buf.map(x => x[1])) * 1.1;
      const top = li * lane + 6, h = lane - 14, X = t => ((t - t0) / win) * W, Y = v => top + h - (v / vmax) * h;
      g.strokeStyle = c.color; g.lineWidth = 1.6; g.beginPath();
      let started = false, prevY = null;
      const seg = (ta, tb, x) => {
        const xa = Math.max(0, X(ta)), xb = Math.min(W, X(tb)); if (xb <= xa) return;
        const [, v, pwm, freq] = x, hi = Y(c.logic || 5), lo = Y(0);
        const square = (pwm != null && pwm > 0 && pwm < 1) || (freq > 0 && v > 0);
        if (square) {
          const f = freq > 0 && pwm == null ? freq : (x.freq || freq || 490), duty = pwm != null && pwm > 0 && pwm < 1 ? pwm : 0.5, per = 1000 / f, ppx = (per / win) * W;
          if (ppx < 3) { // trop rapide pour être lu : bande pleine (moyenne)
            g.save(); g.globalAlpha = 0.28; g.fillStyle = c.color; g.fillRect(xa, hi, xb - xa, lo - hi); g.restore();
            if (!started) { g.moveTo(xa, Y(duty * (c.logic || 5))); started = true; } else g.lineTo(xa, Y(duty * (c.logic || 5)));
            g.lineTo(xb, Y(duty * (c.logic || 5))); prevY = Y(duty * (c.logic || 5)); return;
          }
          let t = ta - ((ta - t0) % per);
          for (; t < tb; t += per) {
            const a = Math.max(ta, t), m = Math.min(tb, t + duty * per), z = Math.min(tb, t + per);
            if (m > a) { if (!started) { g.moveTo(X(a), hi); started = true; } else { g.lineTo(X(a), prevY ?? hi); g.lineTo(X(a), hi); } g.lineTo(X(m), hi); prevY = hi; }
            if (z > m) { g.lineTo(X(Math.max(m, a)), lo); g.lineTo(X(z), lo); prevY = lo; }
          }
          return;
        }
        const y = Y(v);
        if (!started) { g.moveTo(xa, y); started = true; } else { g.lineTo(xa, prevY ?? y); g.lineTo(xa, y); }
        g.lineTo(xb, y); prevY = y;
      };
      const b = c.buf;
      for (let k = 0; k < b.length; k++) { const ta = b[k][0], tb = k + 1 < b.length ? b[k + 1][0] : t1; if (tb >= t0) seg(Math.max(ta, t0), tb, b[k]); }
      g.stroke();
      g.fillStyle = c.color; g.font = '600 10px ui-monospace, monospace'; g.fillText(`${c.i + 1}`, 4, top + 10);
      const m = measure(c, t0, t1), mEl = el.querySelector(`[data-m="${c.i}"]`); if (mEl) mEl.textContent = m;
    });
    g.fillStyle = '#5f7b80'; g.font = '10px ui-monospace, monospace'; g.fillText(tl('{0}/div', span < 1000 ? span + ' ms' : span / 1000 + ' s'), W - 64, H - 4);
    $('[data-note]').textContent = !ctx.simOn() ? tl('Lancez la simulation pour voir les signaux.') : !used.length ? tl('Choisissez une broche sur une voie.') : hold ? tl('Image figée.') : '';
  }
  /** Mesures sur la fenêtre affichée : fréquence et rapport cyclique, ou tension. */
  function measure(c, t0, t1) {
    const b = c.buf.filter((x, k) => (c.buf[k + 1] ? c.buf[k + 1][0] : t1) >= t0); if (!b.length) return '';
    const L = b[b.length - 1];
    if (L[2] != null && L[2] > 0 && L[2] < 1) return tl('PWM {0} % · {1}', Math.round(L[2] * 100), si(L[3] || 490, 'Hz'));
    if (L[3] > 0 && L[1] > 0) return tl('son {0}', si(L[3], 'Hz'));
    const rises = []; let high = 0;
    for (let k = 0; k < b.length; k++) {
      const ta = Math.max(b[k][0], t0), tb = k + 1 < b.length ? b[k + 1][0] : t1;
      if (b[k][1] > (c.logic || 5) / 2) high += tb - ta;
      if (k && b[k][1] > (c.logic || 5) / 2 && b[k - 1][1] <= (c.logic || 5) / 2) rises.push(b[k][0]);
    }
    const vals = b.map(x => x[1]), analog = vals.some(v => v > 0.05 && Math.abs(v - (c.logic || 5)) > 0.05);
    if (analog) return `${si(L[1], 'V')} (${si(Math.min(...vals), 'V')} – ${si(Math.max(...vals), 'V')})`;
    if (rises.length >= 2) { const per = (rises[rises.length - 1] - rises[0]) / (rises.length - 1); return tl('{0} · {1} % haut', si(1000 / per, 'Hz'), Math.round(100 * high / (t1 - t0))); }
    return L[1] > (c.logic || 5) / 2 ? tl('HIGH · {0}', si(L[1], 'V')) : tl('LOW · 0 V');
  }

  /* ---------- Multimètre ---------- */
  function paintProbes() {
    const P = ctx.probes(), parts = partsAll(), red = $('[data-red]').value, black = $('[data-black]').value, part = $('[data-part]').value;
    const gnd = P.find(p => /\bGND\b/.test(p.label));
    $('[data-red]').innerHTML = `<option value="">${tl('— choisir —')}</option>` + P.map(p => `<option value="${esc(p.id)}"${p.id === red ? ' selected' : ''}>${esc(p.label)}</option>`).join('');
    $('[data-black]').innerHTML = P.map(p => `<option value="${esc(p.id)}"${(black ? p.id === black : gnd && p.id === gnd.id) ? ' selected' : ''}>${esc(p.label)}</option>`).join('');
    $('[data-part]').innerHTML = `<option value="">${tl('— choisir —')}</option>` + parts.map(p => `<option value="${esc(p.id)}"${p.id === part ? ' selected' : ''}>${esc(p.label)}</option>`).join('');
    meter(true);
  }
  function meter(force) {
    if (el.hidden || tab !== 'meter') return;
    const now = performance.now(); if (!force && now - lastMeter < 200) return; lastMeter = now;
    const read = $('[data-read]'), unit = $('[data-unit]'), hint = $('.dmmHint');
    if (mode === 'VAC') { meterAc(read, unit, hint); return; }
    const r = ctx.simOn() ? ctx.dc() : null;
    if (!r || !r.ok) { read.textContent = '——'; unit.textContent = ''; hint.textContent = ctx.simOn() ? tl('Aucune source d’alimentation dans le montage.') : tl('Lancez la simulation pour mesurer.'); return; }
    hint.textContent = '';
    if (mode === 'V') {
      const P = ctx.probes(), a = P.find(p => p.id === $('[data-red]').value), b = P.find(p => p.id === $('[data-black]').value);
      if (!a) { read.textContent = '——'; unit.textContent = ''; hint.textContent = tl('Choisissez où poser la pointe rouge.'); return; }
      const va = r.volts(a.ref), vb = b ? r.volts(b.ref) : 0;
      if (va == null || vb == null) { read.textContent = 'OL'; unit.textContent = ''; hint.textContent = tl('Point non relié au circuit (en l’air).'); return; }
      const t = si(va - vb, 'V').split(' '); read.textContent = t[0]; unit.textContent = t[1];
    } else {
      const p = partsAll().find(x => x.id === $('[data-part]').value);
      if (!p) { read.textContent = '——'; unit.textContent = ''; hint.textContent = tl('Choisissez le composant dont mesurer le courant.'); return; }
      const i = r.current(p.comp);
      if (i == null) { read.textContent = '——'; unit.textContent = ''; return; }
      const t = si(i, 'mA').split(' '); read.textContent = t[0]; unit.textContent = t[1];
      const led = r.leds && r.leds.get(p.comp);
      if (led && led.mA > 20) hint.textContent = tl('Plus de 20 mA : la LED s’use vite (résistance trop faible).');
    }
  }

  /** Tension alternative efficace entre les pointes : fenêtre de transitoire calculée par l'instrument qui la fournit. */
  function meterAc(read, unit, hint) {
    const P = ctx.probes(), a = P.find(p => p.id === $('[data-red]').value), b = P.find(p => p.id === $('[data-black]').value);
    if (!a) { read.textContent = '——'; unit.textContent = ''; hint.textContent = tl('Choisissez où poser la pointe rouge.'); return; }
    const r = api.ac ? api.ac(a.ref, b ? b.ref : null) : null;
    if (!r) { read.textContent = '——'; unit.textContent = ''; hint.textContent = tl('Mesure alternative indisponible.'); return; }
    if (r.pending) { read.textContent = '…'; unit.textContent = ''; hint.textContent = tl('Calcul de la fenêtre de temps (ngspice)…'); return; }
    if (r.error) { read.textContent = 'Err'; unit.textContent = ''; hint.textContent = r.error; return; }
    const t = si(r.rms, 'V').split(' '); read.textContent = t[0]; unit.textContent = t[1] + '∿';
    hint.textContent = tl('Efficace (RMS) de la partie alternative, moyenne {0}{1}.', si(r.mean, 'V'), r.f > 0 ? tl(', fréquence {0}', si(r.f, 'Hz')) : '');
  }

  const api = {
    el, sample, draw: now => { draw(now); meter(false); for (const x of extra) if (x.id === tab && !el.hidden && x.draw) x.draw(now); },
    /** Source de la tension alternative du multimètre : (ref rouge, ref noire | null) → { rms, mean, f } | { pending } | { error } | null. */
    ac: null,
    setAc(fn) { api.ac = fn; },
    /** Composants de plus pour le courant du multimètre : () → [{ id, label, comp }]. */
    extraParts: null,
    /** Onglet de plus : def = { id, label, icon, el (panneau), onShow(visible), draw(now) }. */
    addTab(def) {
      if (extra.some(x => x.id === def.id)) return;
      extra.push(def);
      $('.bhTabs').insertAdjacentHTML('beforeend', `<button type="button" data-tab="${esc(def.id)}">${icon(def.icon || 'activity')}${esc(def.label)}</button>`);
      def.el.hidden = true; el.appendChild(def.el);
    },
    show(id) { if (el.hidden) api.toggle(true); showTab(id); },
    get tab() { return tab; },
    get visible() { return !el.hidden; },
    toggle(on = el.hidden) { el.hidden = !on; if (on) { canvas.width = Math.max(300, Math.round(canvas.clientWidth || 560)); paintChans(); attachTraces(); if (tab === 'meter') paintProbes(); } else ctx.boards().forEach(b => b.rt && b.rt.setTrace && b.rt.setTrace(null)); for (const x of extra) if (x.onShow) x.onShow(on && x.id === tab); if (ctx.onShow) ctx.onShow(on); },
    /** Montage ou programmes changés : listes à jour, suivis rebranchés sur les nouveaux programmes. */
    refresh() { if (el.hidden) return; paintChans(); attachTraces(); if (tab === 'meter') paintProbes(); },
    reset() { chans.forEach(c => { c.buf = []; c.last = null; c.now = 0; }); attachTraces(); }
  };
  return api;
}
