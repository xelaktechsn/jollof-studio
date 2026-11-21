// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Rendu rapide d'un grand dessin vectoriel (un million de segments) dans un canevas 2D, partagé par le fond de plan de
// la vue Plans (plan-underlay.js) et l'aperçu de l'assistant d'import (cadimport.js).
// - Index spatial : grille uniforme (tableaux compacts : début de chaque case + numéros des segments), les segments très
//   longs à part ; requête par rectangle sans doublon (tampon par segment).
// - Tuiles : 256 px de l'écran, par niveau de zoom (puissance de 2) ; une tuile se dessine une fois puis se recopie
//   (déplacement et zoom fluides) ; cache des plus récentes. Les tuiles manquantes sont dessinées dans un budget de
//   temps par image, en attendant on montre le niveau voisin ou la vue d'ensemble (une image de tout le dessin).
// - Niveau de détail : un segment de moins d'un demi-pixel n'est pas tracé, un texte de moins de 3 px non plus.
// Repère des tuiles : x à droite, y vers le bas ; une source au y vers le haut (DXF) passe yUp: true.
const T = 256;

/** Index en grille des segments (segs : x0,y0,x1,y1 à la suite). */
export function segIndex(segs, n = segs.length >> 2) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0, k = 0; i < n; i++, k += 4) {
    const a = segs[k], b = segs[k + 1], c = segs[k + 2], d = segs[k + 3];
    if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
    if (a < x0) x0 = a; if (c < x0) x0 = c; if (a > x1) x1 = a; if (c > x1) x1 = c;
    if (b < y0) y0 = b; if (d < y0) y0 = d; if (b > y1) y1 = b; if (d > y1) y1 = d;
  }
  if (!(x1 >= x0)) return { x0: 0, y0: 0, x1: 0, y1: 0, cs: 1, nx: 1, ny: 1, start: new Uint32Array(2), items: new Uint32Array(0), long: new Uint32Array(0), n, stamp: new Uint32Array(n), tick: 0 };
  const w = Math.max(x1 - x0, 1e-9), h = Math.max(y1 - y0, 1e-9), cells = Math.max(1, Math.min(1 << 20, n / 6));
  let cs = Math.sqrt((w * h) / cells) || Math.max(w, h);
  let nx = Math.min(1024, Math.max(1, Math.ceil(w / cs))), ny = Math.min(1024, Math.max(1, Math.ceil(h / cs)));
  cs = Math.max(w / nx, h / ny) * (1 + 1e-9);
  const cell = (v, o, m) => Math.max(0, Math.min(m - 1, Math.floor((v - o) / cs)));
  const cnt = new Uint32Array(nx * ny + 1), longs = [], MAXC = 48;
  const each = (k, fn) => {
    const a = segs[k], b = segs[k + 1], c = segs[k + 2], d = segs[k + 3];
    const ix0 = cell(Math.min(a, c), x0, nx), ix1 = cell(Math.max(a, c), x0, nx), iy0 = cell(Math.min(b, d), y0, ny), iy1 = cell(Math.max(b, d), y0, ny);
    if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > MAXC) return false;
    for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) fn(iy * nx + ix);
    return true;
  };
  const ok = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const k = i * 4; if (!Number.isFinite(segs[k] + segs[k + 1] + segs[k + 2] + segs[k + 3])) continue; if (each(k, c => cnt[c + 1]++)) ok[i] = 1; else longs.push(i); }
  for (let c = 0; c < nx * ny; c++) cnt[c + 1] += cnt[c];
  const items = new Uint32Array(cnt[nx * ny]), fill = cnt.slice(0, nx * ny);
  for (let i = 0; i < n; i++) if (ok[i]) each(i * 4, c => { items[fill[c]++] = i; });
  return { x0, y0, x1, y1, cs, nx, ny, start: cnt, items, long: Uint32Array.from(longs), n, stamp: new Uint32Array(n), tick: 0 };
}
/** Appelle fn(i) pour chaque segment dont la case touche le rectangle [qx0, qy0, qx1, qy1] (une fois par segment). */
export function query(ix, qx0, qy0, qx1, qy1, fn) {
  if (qx1 < ix.x0 || qy1 < ix.y0 || qx0 > ix.x1 || qy0 > ix.y1) { for (const i of ix.long) fn(i); return; }
  if (++ix.tick === 0xffffffff) { ix.stamp.fill(0); ix.tick = 1; }
  const t = ix.tick, st = ix.stamp, cs = ix.cs;
  const a = Math.max(0, Math.floor((qx0 - ix.x0) / cs)), b = Math.min(ix.nx - 1, Math.floor((qx1 - ix.x0) / cs));
  const c = Math.max(0, Math.floor((qy0 - ix.y0) / cs)), d = Math.min(ix.ny - 1, Math.floor((qy1 - ix.y0) / cs));
  for (let iy = c; iy <= d; iy++) for (let ix_ = a; ix_ <= b; ix_++) {
    const k = iy * ix.nx + ix_;
    for (let p = ix.start[k], e = ix.start[k + 1]; p < e; p++) { const i = ix.items[p]; if (st[i] !== t) { st[i] = t; fn(i); } }
  }
  for (const i of ix.long) fn(i);
}

/** Points d'aimantation près de (x, y) dans un rayon r (repère de la source) : bouts de segments et croisements. */
export function snapNear(src, ix, x, y, r, max = 400) {
  const s = src.segs, hidden = src.hidden, cand = [];
  query(ix, x - r, y - r, x + r, y + r, i => { if (cand.length < max && !(hidden && hidden(src.segLayer[i]))) cand.push(i); });
  let best = null, bd = r;
  const take = (px, py, kind) => { const d = Math.hypot(px - x, py - y); if (d < bd || (best && kind === 'end' && best.kind === 'x' && d <= bd + 1e-9)) { bd = d; best = { x: px, y: py, kind }; } };
  for (const i of cand) { const k = i * 4; take(s[k], s[k + 1], 'end'); take(s[k + 2], s[k + 3], 'end'); }
  if (best && best.kind === 'end' && bd < r * 0.5) return best;
  for (let p = 0; p < cand.length; p++) {
    const k = cand[p] * 4, ax = s[k], ay = s[k + 1], bx = s[k + 2], by = s[k + 3], ex = bx - ax, ey = by - ay;
    for (let q = p + 1; q < cand.length; q++) {
      const m = cand[q] * 4, cx = s[m], cy = s[m + 1], fx = s[m + 2] - cx, fy = s[m + 3] - cy, den = ex * fy - ey * fx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((cx - ax) * fy - (cy - ay) * fx) / den, u = ((cx - ax) * ey - (cy - ay) * ex) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      take(ax + t * ex, ay + t * ey, 'x');
    }
  }
  return best;
}

/**
 * Moteur de rendu d'une source { segs, segLayer, segColor? (0 : couleur du calque, sinon indice de couleur propre),
 * texts?: [{ x, y, h, rot (radians, sens trigo du dessin), text, layer (id), ha, va }] }.
 * o : { yUp (source au y vers le haut), font }. Style : setStyle({ color(layer, colorIdx) → couleur CSS ou null (caché),
 * alpha(layer) → 0..1, text (couleur des textes, null : couleur du calque), width (px) }).
 * draw(g, M, W, H, budgetMs) : M = [a, b, c, d, e, f] du repère des tuiles (y vers le bas) vers les pixels du canevas ;
 * rend true si tout est net, false s'il reste des tuiles à dessiner (redemander une image).
 */
export function createSegRenderer(src, o = {}) {
  const ys = o.yUp ? -1 : 1, n = src.segLayer.length;
  let ix = null, style = { color: () => '#888', alpha: () => 1, text: null, width: 1 }, ver = 0, overview = null;
  const tiles = new Map(); let cap = 220;
  const index = () => ix || (ix = segIndex(src.segs, n));
  /** Emprise dans le repère des tuiles. */
  function bounds() { const q = index(); return ys > 0 ? [q.x0, q.y0, q.x1, q.y1] : [q.x0, -q.y1, q.x1, -q.y0]; }
  // Les textes : rangés une fois (emprise approchée) pour les requêtes par tuile.
  let texts = null;
  function textList() {
    if (texts) return texts;
    texts = [];
    for (const t of src.texts || []) {
      if (!t || !t.text || !(t.h > 0)) continue;
      const w = t.h * 0.62 * String(t.text).length, y = t.y * ys, R = Math.hypot(w, t.h);
      texts.push({ t, x: t.x, y, x0: t.x - R, y0: y - R, x1: t.x + R, y1: y + R });
    }
    return texts;
  }
  /** Dessine une zone [wx0, wy0] → canevas g à l'échelle s (px par unité), origine du canevas en (ox, oy) px. */
  function paintArea(g, s, wx0, wy0, wx1, wy1, ox, oy, minPx = 0.5) {
    const q = index(), segs = src.segs, L = src.segLayer, C = src.segColor, buckets = new Map(), lim = minPx / s;
    const qy0 = ys > 0 ? wy0 : -wy1, qy1 = ys > 0 ? wy1 : -wy0, m = 1 / s;
    query(q, wx0 - m, qy0 - m, wx1 + m, qy1 + m, i => {
      const k = i * 4, dx = segs[k + 2] - segs[k], dy = segs[k + 3] - segs[k + 1];
      if (Math.abs(dx) + Math.abs(dy) < lim) return;
      const l = L[i], c = C ? C[i] : 0, key = l * 65536 + c; let b = buckets.get(key);
      if (b === undefined) { b = style.color(l, c) ? [] : null; buckets.set(key, b); }
      if (b) b.push(i);
    });
    g.lineWidth = style.width || 1; g.lineCap = 'round';
    for (const [key, b] of buckets) {
      if (!b || !b.length) continue;
      const l = Math.floor(key / 65536);
      g.strokeStyle = style.color(l, key % 65536); g.globalAlpha = style.alpha(l); g.beginPath();
      for (const i of b) { const k = i * 4; g.moveTo((segs[k] - wx0) * s + ox, (segs[k + 1] * ys - wy0) * s + oy); g.lineTo((segs[k + 2] - wx0) * s + ox, (segs[k + 3] * ys - wy0) * s + oy); }
      g.stroke();
    }
    // Textes lisibles à cette échelle.
    const tl = textList(); if (!tl.length) { g.globalAlpha = 1; return; }
    const HA = ['left', 'center', 'right'], VA = ['alphabetic', 'bottom', 'middle', 'top'];
    for (const e of tl) {
      if (e.x1 < wx0 || e.x0 > wx1 || e.y1 < wy0 || e.y0 > wy1) continue;
      const t = e.t, px = t.h * s; if (px < 3) continue;
      const c = style.color(t.layer); if (!c) continue;
      g.globalAlpha = style.alpha(t.layer); g.fillStyle = style.text || c;
      g.font = `${px.toFixed(1)}px ${o.font || 'sans-serif'}`;
      g.textAlign = HA[t.ha] || 'left'; g.textBaseline = VA[t.va] || 'alphabetic';
      g.save(); g.translate((e.x - wx0) * s + ox, (e.y - wy0) * s + oy); if (t.rot) g.rotate(-t.rot); g.fillText(String(t.text), 0, 0); g.restore(); // (sens trigo du dessin = sens trigo à l'écran)
    }
    g.globalAlpha = 1;
  }
  const mk = (w, h) => { const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }); return c; };
  function renderTile(L, i, j) {
    const s = 2 ** L, cv = mk(T, T), g = cv.getContext('2d');
    paintArea(g, s, i * T / s, j * T / s, (i + 1) * T / s, (j + 1) * T / s, 0, 0);
    return cv;
  }
  /** Vue d'ensemble : tout le dessin dans une image d'au plus 2 048 px (secours pendant le dessin des tuiles). */
  function ensureOverview() {
    if (overview && overview.ver === ver) return overview;
    const b = bounds(), w = Math.max(1e-9, b[2] - b[0]), h = Math.max(1e-9, b[3] - b[1]), s = 2048 / Math.max(w, h);
    const cv = mk(Math.max(1, Math.ceil(w * s)), Math.max(1, Math.ceil(h * s))), g = cv.getContext('2d');
    paintArea(g, s, b[0], b[1], b[2], b[3], 0, 0, 0.7);
    overview = { cv, s, x: b[0], y: b[1], ver };
    return overview;
  }
  const keyOf = (L, i, j) => L + ':' + i + ':' + j;
  function get(L, i, j) { const k = keyOf(L, i, j), t = tiles.get(k); if (t) { tiles.delete(k); tiles.set(k, t); } return t; }
  function put(L, i, j, cv) { tiles.set(keyOf(L, i, j), cv); while (tiles.size > cap) tiles.delete(tiles.keys().next().value); }

  function draw(g, M, W, H, budget = 12) {
    const t0 = performance.now(), det = M[0] * M[3] - M[1] * M[2], sc = Math.sqrt(Math.abs(det)); if (!(sc > 0)) return true;
    const L = Math.round(Math.log2(sc)), s = 2 ** L;
    // Zone visible dans le repère des tuiles (inverse de M sur les quatre coins), coupée à l'emprise du dessin.
    const inv = [M[3] / det, -M[1] / det, -M[2] / det, M[0] / det], P = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => [inv[0] * (x - M[4]) + inv[2] * (y - M[5]), inv[1] * (x - M[4]) + inv[3] * (y - M[5])]);
    const b = bounds(), pad = 2 / sc;
    const vx0 = Math.max(b[0] - pad, Math.min(...P.map(p => p[0]))), vx1 = Math.min(b[2] + pad, Math.max(...P.map(p => p[0])));
    const vy0 = Math.max(b[1] - pad, Math.min(...P.map(p => p[1]))), vy1 = Math.min(b[3] + pad, Math.max(...P.map(p => p[1])));
    if (vx1 < vx0 || vy1 < vy0) return true;
    const i0 = Math.floor(vx0 * s / T), i1 = Math.floor(vx1 * s / T), j0 = Math.floor(vy0 * s / T), j1 = Math.floor(vy1 * s / T);
    const count = (i1 - i0 + 1) * (j1 - j0 + 1);
    cap = Math.max(220, count * 2 + 40);
    g.save(); g.imageSmoothingEnabled = true;
    // Trop de tuiles (zoom très éloigné) : la vue d'ensemble suffit.
    if (count > 600) { const ov = ensureOverview(); g.setTransform(M[0] / ov.s, M[1] / ov.s, M[2] / ov.s, M[3] / ov.s, M[0] * ov.x + M[2] * ov.y + M[4], M[1] * ov.x + M[3] * ov.y + M[5]); g.drawImage(ov.cv, 0, 0); g.restore(); return true; }
    const at = (LL, ii, jj, cv) => { const ss = 2 ** LL; g.setTransform(M[0] / ss, M[1] / ss, M[2] / ss, M[3] / ss, M[4], M[5]); g.drawImage(cv, ii * T, jj * T); };
    const missing = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const t = get(L, i, j); if (t) at(L, i, j, t); else missing.push([i, j]); }
    if (missing.length) {
      // Secours : vue d'ensemble sous les tuiles manquantes, puis le niveau voisin s'il est en cache.
      // (la vue d'ensemble coûte un passage complet : construite seulement quand rien d'autre n'est montrable)
      const ov = missing.length === count ? ensureOverview() : overview && overview.ver === ver ? overview : null;
      // Niveaux plus grossiers en cache (jusqu'à 8 fois), sinon la vue d'ensemble si elle n'est pas trop floue.
      for (const [i, j] of missing) {
        let up = null, d = 1;
        for (; d <= 3 && !up; d++) up = get(L - d, i >> d, j >> d);
        if (up) { d--; g.save(); clipTile(g, M, s, i, j); at(L - d, i >> d, j >> d, up); g.restore(); continue; }
        if (ov && sc / ov.s < 6) { g.save(); clipTile(g, M, s, i, j); g.setTransform(M[0] / ov.s, M[1] / ov.s, M[2] / ov.s, M[3] / ov.s, M[0] * ov.x + M[2] * ov.y + M[4], M[1] * ov.x + M[3] * ov.y + M[5]); g.drawImage(ov.cv, 0, 0); g.restore(); }
      }
      // Les tuiles du centre d'abord, dans le budget de temps.
      const ci = (i0 + i1) / 2, cj = (j0 + j1) / 2;
      missing.sort((a, c) => Math.hypot(a[0] - ci, a[1] - cj) - Math.hypot(c[0] - ci, c[1] - cj));
      let done = 0;
      for (const [i, j] of missing) {
        if (done && performance.now() - t0 > budget) break;
        const cv = renderTile(L, i, j); put(L, i, j, cv); at(L, i, j, cv); done++;
      }
      g.restore();
      return done === missing.length;
    }
    g.restore();
    return true;
  }
  function clipTile(g, M, s, i, j) {
    g.setTransform(M[0] / s, M[1] / s, M[2] / s, M[3] / s, M[4], M[5]);
    g.beginPath(); g.rect(i * T, j * T, T, T); g.clip();
  }
  return {
    draw, bounds, index,
    /** Vue d'ensemble { cv, s, x, y } (repère des tuiles). */
    overview: () => ensureOverview(),
    /** Dessine directement (sans tuiles) la zone [x0, y0, x1, y1] du repère des tuiles dans g, à s px par unité (vignettes). */
    paintArea: (g, s, x0, y0, x1, y1, ox = 0, oy = 0) => paintArea(g, s, x0, y0, x1, y1, ox, oy, 0.6),
    /** Change le style (couleurs, calques cachés) : toutes les tuiles sont à redessiner. */
    setStyle(st) { style = { ...style, ...st }; ver++; tiles.clear(); overview = null; },
    /** Point d'aimantation le plus proche dans le repère de la source (y de la source). */
    snap: (x, y, r) => snapNear({ ...src, hidden: l => !style.color(l) }, index(), x, y, r),
    tiles: () => tiles.size,
    clear() { tiles.clear(); overview = null; }
  };
}

/* ---------- Couleurs ---------- */
export const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
export const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
export const mix = (c, t, f) => c.map((v, i) => v + (t[i] - v) * f);
export const css = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
export function parseCss(s) {
  s = String(s || '').trim();
  if (/^#[0-9a-f]{6}/i.test(s)) return hexRgb(s);
  const m = /rgba?\(([^)]+)\)/.exec(s); if (m) return m[1].split(',').slice(0, 3).map(v => +v / 255);
  return [0.5, 0.5, 0.5];
}
/** Luminance relative (WCAG 2) et rapport de contraste entre deux couleurs [r, g, b] (0..1). */
export const relLum = c => { const f = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
export const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const rgbHsl = ([r, g, b]) => { const M = Math.max(r, g, b), m = Math.min(r, g, b), l = (M + m) / 2, d = M - m; if (!d) return [0, 0, l]; const s = d / (1 - Math.abs(2 * l - 1)); const h = M === r ? ((g - b) / d + 6) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h * 60, s, l]; };
const hslRgb = ([h, s, l]) => { const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return [r + m, g + m, b + m]; };
/**
 * Couleur d'un calque lisible sur le fond : blanc/noir (couleur 7 du DXF) → couleur du texte de l'interface ; une couleur
 * dont le contraste avec le fond est sous `min` (3:1, seuil WCAG des éléments graphiques) est assombrie (fond clair) ou
 * éclaircie (fond sombre) en gardant sa teinte, jusqu'au seuil. bg : couleur du fond [r, g, b], ou un booléen « sombre ».
 */
export function themeColor(hex, fg, bg, min = 3) {
  const back = Array.isArray(bg) ? bg : bg ? [0.06, 0.075, 0.086] : [0.953, 0.961, 0.973], dark = relLum(back) < 0.18;
  const c = /^#[0-9a-f]{6}$/i.test(hex) ? hexRgb(hex) : [1, 1, 1], L = lum(c);
  if ((c[0] === c[1] && c[1] === c[2]) && (L > 0.97 || L < 0.03)) return css(fg);
  if (contrast(c, back) >= min) return css(c);
  const [h, s0, l0] = rgbHsl(c);
  let lo = dark ? l0 : 0, hi = dark ? 1 : l0, best = dark ? [1, 1, 1] : [0, 0, 0];
  for (let k = 0; k < 18; k++) { // dichotomie sur la luminosité : la plus proche de l'origine qui passe le seuil
    const l = (lo + hi) / 2, t = hslRgb([h, s0, l]);
    // (petite marge au-dessus du seuil : l'arrondi à 8 bits)
    if (contrast(t, back) >= min + 0.08) { best = t; if (dark) hi = l; else lo = l; } else if (dark) lo = l; else hi = l;
  }
  return css(best);
}

/** Transformation du fond : repère du fond (m) → étage (m), et inverse. */
export function ulMatrix(t) {
  const a = (t.rot || 0) * Math.PI / 180, s = t.scale || 1, c = Math.cos(a) * s, n = Math.sin(a) * s;
  return {
    to: (x, y) => [c * x - n * y + t.dx, n * x + c * y + t.dy],
    from: (X, Y) => { const x = X - t.dx, y = Y - t.dy, d = s * s; return [(c * x + n * y) / d, (-n * x + c * y) / d]; },
    m: [c, n, -n, c, t.dx, t.dy], s
  };
}
/** Transformation qui envoie p1 → q1 et p2 → q2 (repère du fond → étage) ; keepScale : rotation et déplacement seuls. */
export function alignTwo(p1, p2, q1, q2, scale, keepScale) {
  const dp = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), dq = Math.hypot(q2[0] - q1[0], q2[1] - q1[1]);
  if (dp < 1e-9 || dq < 1e-9) return null;
  const s = keepScale ? scale : dq / dp, a = Math.atan2(q2[1] - q1[1], q2[0] - q1[0]) - Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
  const c = Math.cos(a) * s, n = Math.sin(a) * s;
  // Échelle gardée : le milieu des deux points tombe au milieu des deux cibles.
  const pm = keepScale ? [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2] : p1, qm = keepScale ? [(q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2] : q1;
  return { dx: qm[0] - (c * pm[0] - n * pm[1]), dy: qm[1] - (n * pm[0] + c * pm[1]), rot: ((a * 180 / Math.PI) % 360 + 360) % 360, scale: s };
}
