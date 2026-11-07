// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Traceur série : les nombres que le programme écrit sur Serial deviennent des courbes, comme le
// « Serial Plotter » de l'IDE Arduino. Une ligne = un instant ; valeurs séparées par des espaces,
// tabulations ou virgules, avec une étiquette facultative (« temp:21.5 hum:40 »).
// L'abscisse est l'heure virtuelle de la carte au moment de l'écriture (pas l'heure de l'écran) :
// une courbe garde ses vraies durées, même si l'ordinateur est lent. Mémoire en anneau par carte,
// dessin en canevas 2D cadencé, seulement quand le traceur est affiché.
import { tl, DEC } from '../i18n/index.js';
import { COLORS, paintGrid, niceTicks, tickText } from '../sim/plotkit.js';

const MAX_SERIES = 8;
const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?|[-+]?(?:nan|inf|ovf)(?![a-z])';
// Étiquette (peut contenir des espaces, ne commence pas par un chiffre) puis « : » puis un nombre.
const RE_PAIR = new RegExp(`([^\\s\\d:,+\\-.][^:,\\t]*?)\\s*:\\s*(${NUM})`, 'iy');
const RE_NUM = new RegExp(`(${NUM})(?=[\\s,]|$)`, 'iy');
const RE_SEP = /[\s,]+/y, RE_WORD = /[^\s,]+/y;
const num = s => { const l = s.toLowerCase(); return /nan|ovf/.test(l) ? NaN : /inf/.test(l) ? (l[0] === '-' ? -Infinity : Infinity) : parseFloat(s); };
const at = (re, s, i) => { re.lastIndex = i; return re.exec(s); };

/**
 * Lit une ligne du port série au format du traceur de l'IDE Arduino.
 * Retourne [{ label, value }] (label null pour une valeur sans étiquette), ou null si la ligne
 * n'est pas une ligne de mesures (texte, message…). Tolérant : « temp : 21.5 », étiquettes avec
 * des espaces, unité après une valeur étiquetée (« temp: 21.5 °C »).
 */
export function parsePlotLine(line) {
  const s = String(line ?? '').trim();
  if (!s) return null;
  const out = [];
  let i = 0, junk = 0, labeled = 0, m;
  while (i < s.length) {
    if ((m = at(RE_SEP, s, i))) { i = RE_SEP.lastIndex; continue; }
    if ((m = at(RE_PAIR, s, i))) { out.push({ label: m[1].trim().slice(0, 40), value: num(m[2]) }); labeled++; i = RE_PAIR.lastIndex; continue; }
    if ((m = at(RE_NUM, s, i))) { out.push({ label: null, value: num(m[1]) }); i = RE_NUM.lastIndex; continue; }
    at(RE_WORD, s, i); i = RE_WORD.lastIndex; junk++;
  }
  // Sans étiquette, la ligne ne doit contenir que des nombres (« Erreur 404 » n'est pas une mesure).
  if (!out.length || (junk && !labeled)) return null;
  return out;
}

/**
 * o : { canvas, legend, win (groupe des boutons de durée), hold, clear, csv,
 *       fps, light, shown() → traceur affiché, clock(id) → heure virtuelle de la carte ou null,
 *       name(id) → nom de la carte, save(blob, nom) }
 */
export function createPlotter(o) {
  const cv = o.canvas, g = cv.getContext('2d'), N = o.light ? 1500 : 4000;
  const dpr = () => (o.light ? 1 : Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
  const boards = new Map();
  let cur = null, win = 5000, hold = null, raf = 0, last = 0, lastT1 = null, dirty = true, idle = 0, mouse = null, legendSig = '', legendAt = 0;
  const yr = { lo: 0, hi: 1, ok: false }; // échelle verticale affichée (grandit vite, rétrécit lentement)

  /* ---------- Mémoire par carte ---------- */
  const board = id => {
    let b = boards.get(id);
    if (!b) boards.set(id, (b = { t: new Float64Array(N), series: [], count: 0, w: 0, pend: '' }));
    return b;
  };
  /** Ajoute un instant : une valeur par série présente sur la ligne (les autres restent vides). */
  function push(b, vt, vals) {
    const slot = b.w;
    b.t[slot] = vt;
    for (const s of b.series) s.v[slot] = NaN;
    vals.forEach((x, k) => {
      const label = x.label || tl('valeur {0}', k + 1);
      let s = b.series.find(y => y.label === label);
      if (!s) {
        if (b.series.length >= MAX_SERIES) return;
        s = { label, color: COLORS[b.series.length], on: true, v: new Float32Array(N).fill(NaN), last: NaN };
        b.series.push(s);
      }
      if (Number.isFinite(x.value)) { s.v[slot] = x.value; s.last = x.value; }
    });
    b.w = (slot + 1) % N; if (b.count < N) b.count++;
  }
  /** Indice dans l'anneau du k-ième instant gardé (0 = le plus ancien). */
  const slotOf = (b, k) => (b.w - b.count + k + N) % N;
  /** Premier instant gardé à l'heure t ou après (recherche dichotomique). */
  function firstAfter(b, t) {
    let lo = 0, hi = b.count;
    while (lo < hi) { const m = (lo + hi) >> 1; if (b.t[slotOf(b, m)] < t) lo = m + 1; else hi = m; }
    return lo;
  }

  /* ---------- Dessin ---------- */
  const PAD = { l: 46, r: 8, t: 8, b: 18 };
  function draw() {
    const W = cv.width, H = cv.height, k = dpr();
    if (W < 20 || H < 20) return;
    const b = cur && boards.get(cur), clock = cur ? o.clock(cur) : null;
    const t1 = hold != null ? hold : clock != null ? clock : b && b.count ? b.t[slotOf(b, b.count - 1)] : 0, t0 = t1 - win;
    lastT1 = t1;
    g.setTransform(k, 0, 0, k, 0, 0);
    const w = W / k, h = H / k, px = PAD.l, py = PAD.t, pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;
    g.fillStyle = '#0a0d10'; g.fillRect(0, 0, w, h);
    // Échelle verticale : valeurs visibles des séries affichées.
    let lo = Infinity, hi = -Infinity, k0 = 0;
    const shownS = b ? b.series.filter(s => s.on) : [];
    if (b) {
      k0 = Math.max(0, firstAfter(b, t0) - 1);
      for (const s of shownS) for (let i = k0; i < b.count; i++) { const v = s.v[slotOf(b, i)]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    }
    if (lo <= hi) {
      const m = (hi - lo) * 0.06, tg = niceTicks(lo - m, hi + m, 5); // une marge : les courbes ne collent pas au cadre
      if (!yr.ok) { yr.lo = tg.lo; yr.hi = tg.hi; yr.ok = true; }
      else {
        yr.lo = tg.lo < yr.lo ? tg.lo : yr.lo + (tg.lo - yr.lo) * 0.08;
        yr.hi = tg.hi > yr.hi ? tg.hi : yr.hi + (tg.hi - yr.hi) * 0.08;
        if (Math.abs(yr.lo - tg.lo) < (tg.hi - tg.lo) * 1e-3) yr.lo = tg.lo;
        if (Math.abs(yr.hi - tg.hi) < (tg.hi - tg.lo) * 1e-3) yr.hi = tg.hi;
      }
    }
    const span = yr.hi - yr.lo || 1, X = t => px + ((t - t0) / win) * pw, Y = v => py + ph - ((v - yr.lo) / span) * ph;
    const yt = niceTicks(yr.lo, yr.hi, 5), xt = niceTicks(t0 / 1000, t1 / 1000, Math.max(2, Math.round(pw / 90)));
    const ys = yt.list.filter(v => v >= yr.lo - 1e-9 && v <= yr.hi + 1e-9), xs = xt.list.filter(v => v >= 0 && v * 1000 >= t0 && v * 1000 <= t1); // pas d'heure avant le démarrage
    g.save(); g.translate(px, py);
    paintGrid(g, pw, ph, xs.map(v => X(v * 1000) - px), ys.map(v => Y(v) - py));
    g.restore();
    g.fillStyle = '#5f7b80'; g.font = '10px ui-monospace, monospace'; g.textBaseline = 'middle'; g.textAlign = 'right';
    for (const v of ys) g.fillText(tickText(v, yt.dec), px - 5, Y(v));
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    for (const v of xs) g.fillText(`${tickText(v, xt.dec)} s`, X(v * 1000), h - 5);
    // Courbes : au plus deux points par colonne de pixels (minimum et maximum).
    g.save(); g.beginPath(); g.rect(px, py, pw, ph); g.clip();
    g.lineWidth = 1.6; g.lineJoin = 'round';
    for (const s of shownS) {
      g.strokeStyle = s.color; g.beginPath();
      let started = false, col = null, mn = 0, mx = 0, lastY = 0;
      const flush = () => { if (col == null) return; if (!started) { g.moveTo(col, mn); started = true; } else g.lineTo(col, mn); if (mx !== mn) g.lineTo(col, mx); g.lineTo(col, lastY); };
      for (let i = k0; i < b.count; i++) {
        const sl = slotOf(b, i), v = s.v[sl]; if (v !== v) continue;
        const x = Math.round(X(b.t[sl])), y = Y(v);
        if (x !== col) { flush(); col = x; mn = mx = y; } else { if (y < mn) mn = y; if (y > mx) mx = y; }
        lastY = y;
      }
      flush(); g.stroke();
    }
    g.restore();
    // Réticule : heure et valeur de chaque série sous le pointeur.
    if (mouse && b && mouse.x >= px && mouse.x <= px + pw) {
      const t = t0 + ((mouse.x - px) / pw) * win, i = firstAfter(b, t) - 1; // dernier instant avant le pointeur
      g.strokeStyle = '#ffffff55'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(mouse.x) + 0.5, py); g.lineTo(Math.round(mouse.x) + 0.5, py + ph); g.stroke();
      const rows = [`${tickText(t / 1000, 3)} s`];
      if (i >= 0) for (const s of shownS) {
        let j = i; while (j >= 0 && s.v[slotOf(b, j)] !== s.v[slotOf(b, j)]) j--;
        if (j < 0) continue;
        const v = s.v[slotOf(b, j)];
        rows.push([s.color, `${s.label} ${tickText(v, Math.abs(v) < 10 ? 3 : Math.abs(v) < 1000 ? 2 : 0)}`]);
        g.fillStyle = s.color; g.beginPath(); g.arc(X(b.t[slotOf(b, j)]), Y(v), 2.6, 0, Math.PI * 2); g.fill();
      }
      g.font = '10.5px ui-monospace, monospace'; g.textAlign = 'left'; g.textBaseline = 'top';
      const bw = Math.max(...rows.map(r => g.measureText(typeof r === 'string' ? r : r[1]).width)) + 14, bh = rows.length * 14 + 6;
      const bx = mouse.x + 10 + bw > px + pw ? mouse.x - 10 - bw : mouse.x + 10, by = py + 4;
      g.fillStyle = '#11151ae8'; g.fillRect(bx, by, bw, bh); g.strokeStyle = '#2d3740'; g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      rows.forEach((r, n) => { g.fillStyle = typeof r === 'string' ? '#b6bec4' : r[0]; g.fillText(typeof r === 'string' ? r : r[1], bx + 7, by + 4 + n * 14); });
    }
    if (!b || !b.series.length) {
      g.fillStyle = '#7d8891'; g.font = '12px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const msg = clock == null ? tl('Lancez la simulation : les nombres écrits avec Serial.println() s’affichent en courbes.') : tl('Écrivez des nombres sur une ligne, par exemple : Serial.print("temp:"); Serial.println(t);');
      // Message coupé en lignes qui tiennent dans le cadre.
      const lines = [], words = msg.split(' ');
      for (const wd of words) { const l = lines.length ? lines[lines.length - 1] + ' ' + wd : wd; if (lines.length && g.measureText(l).width <= pw - 24) lines[lines.length - 1] = l; else lines.push(wd); }
      lines.forEach((l, n) => g.fillText(l, px + pw / 2, py + ph / 2 + (n - (lines.length - 1) / 2) * 16));
    }
    legend(b);
  }
  /** Légende : une pastille par série (cliquer l'affiche ou la cache), avec sa dernière valeur. */
  function legend(b) {
    const list = b ? b.series : [], sig = list.map(s => s.label + s.on).join('|');
    if (sig !== legendSig) {
      legendSig = sig;
      o.legend.innerHTML = list.map((s, k) => `<button type="button" class="plotChip" data-s="${k}" aria-pressed="${s.on}"><i style="background:${s.color}"></i><span></span><b></b></button>`).join('');
      [...o.legend.children].forEach((el, k) => { el.querySelector('span').textContent = list[k].label; });
      legendAt = 0;
    }
    const now = performance.now(); if (now - legendAt < 250) return; legendAt = now;
    [...o.legend.children].forEach((el, k) => { const s = list[k], v = s && s.last, t = s && Number.isFinite(v) ? tickText(v, Math.abs(v) < 10 ? 2 : Math.abs(v) < 1000 ? 1 : 0) : '—'; const bEl = el.querySelector('b'); if (bEl.textContent !== t) bEl.textContent = t; });
  }

  /* ---------- Cadence : une image au plus par 1/fps s, seulement si le traceur est affiché ---------- */
  function tick(now) {
    raf = 0;
    if (!o.shown()) return;
    const clock = cur ? o.clock(cur) : null;
    if (hold == null && clock != null && clock !== lastT1) dirty = true;
    if (dirty && now - last >= 1000 / o.fps) { dirty = false; last = now; idle = 0; draw(); }
    else if (!dirty) idle++;
    if (dirty || idle < 60) raf = requestAnimationFrame(tick); // au repos : la boucle s'arrête, kick() la relance
  }
  const kick = () => { if (!raf && typeof requestAnimationFrame === 'function') { idle = 0; raf = requestAnimationFrame(tick); } };
  const redraw = () => { dirty = true; kick(); };
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => {
    const k = dpr(), w = Math.round(cv.clientWidth * k), h = Math.round(cv.clientHeight * k);
    if (w && h && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; redraw(); }
  }).observe(cv);

  /* ---------- Commandes ---------- */
  o.legend.addEventListener('click', e => {
    const c = e.target.closest('[data-s]'), b = cur && boards.get(cur); if (!c || !b) return;
    const s = b.series[+c.dataset.s]; if (!s) return;
    s.on = !s.on; yr.ok = false; redraw();
  });
  o.win.addEventListener('click', e => {
    const w = e.target.closest('[data-win]'); if (!w) return;
    win = +w.dataset.win;
    o.win.querySelectorAll('[data-win]').forEach(x => x.setAttribute('aria-pressed', x === w));
    redraw();
  });
  o.hold.onclick = () => {
    hold = hold == null ? lastT1 : null;
    o.hold.setAttribute('aria-pressed', hold != null);
    o.hold.querySelector('span').textContent = hold != null ? tl('Reprendre') : tl('Figer');
    redraw();
  };
  o.clear.onclick = () => { if (cur) api.clear(cur); };
  o.csv.onclick = () => {
    const b = cur && boards.get(cur); if (!b || !b.count) return;
    // Excel en français attend le point-virgule et la virgule décimale.
    const sep = DEC === ',' ? ';' : ',', n = v => (v === v ? String(+v.toPrecision(7)).replace('.', DEC) : '');
    const q = s => (/["\n;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const rows = [[tl('temps (s)'), ...b.series.map(s => q(s.label))].join(sep)];
    for (let i = 0; i < b.count; i++) { const sl = slotOf(b, i); rows.push([String(+(b.t[sl] / 1000).toFixed(3)).replace('.', DEC), ...b.series.map(s => n(s.v[sl]))].join(sep)); }
    const name = `${tl('traceur')}-${String(o.name(cur) || 'carte').replace(/[^\w-]+/g, '_')}.csv`;
    o.save(new Blob(['﻿' + rows.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }), name);
  };
  cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; redraw(); });
  cv.addEventListener('pointerleave', () => { mouse = null; redraw(); });

  const api = {
    /** Texte écrit par une carte (traceur branché sur Serial) : chaque ligne complète devient un instant. */
    feed(id, text, vt) {
      const b = board(id);
      let s = b.pend + text, i;
      while ((i = s.indexOf('\n')) >= 0) {
        const vals = parsePlotLine(s.slice(0, i));
        if (vals) { push(b, vt, vals); if (id === cur) dirty = true; }
        s = s.slice(i + 1);
      }
      b.pend = s.length > 2000 ? '' : s; // ligne sans fin : abandonnée
      if (dirty && id === cur) kick();
    },
    /** Efface les courbes d'une carte (programme relancé : son heure repart de zéro). */
    clear(id) { boards.delete(id); if (id === cur) { yr.ok = false; hold = null; o.hold.setAttribute('aria-pressed', false); o.hold.querySelector('span').textContent = tl('Figer'); redraw(); } },
    reset() { boards.clear(); yr.ok = false; redraw(); },
    /** Carte affichée dans l'onglet Code. */
    select(id) { if (id !== cur) { cur = id; yr.ok = false; mouse = null; legendSig = ''; redraw(); } },
    /** Relance la cadence d'affichage (traceur de nouveau visible) : une image seulement si quelque chose a changé. */
    kick() { if (o.shown()) kick(); },
    /** Séries d'une carte (tests, intégration) : [{ label, last, count }]. */
    series(id) { const b = boards.get(id); return b ? b.series.map(s => ({ label: s.label, last: s.last, on: s.on })) : []; },
    count(id) { const b = boards.get(id); return b ? b.count : 0; }
  };
  return api;
}
