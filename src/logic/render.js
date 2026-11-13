// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique : dessin des symboles. Les ordres abstraits de elements.js deviennent du SVG (éditeur,
// vignettes de la bibliothèque) ou des ordres du PDF (compte-rendu de TP, impression du circuit).
import { DEFS, propsOf, layoutOf, sizeOf, pinsOf, rotPt, pinWidth, LEVEL_TXT } from './elements.js';
import { routeWire } from './route.js';

const n3 = v => +(+v).toFixed(3);
const escX = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Couleur d'un jeton (variables CSS du thème) ou couleur littérale. */
const TOK = { body: 'var(--lgBody)', ink: 'var(--lgInk)', hi: 'var(--lg1)', lo: 'var(--lg0)', knob: 'var(--lgKnob)', off: 'var(--lgOff)', x: 'var(--lgX)', z: 'var(--lgZ)', mut: 'var(--lgMut)', note: 'var(--lgNote)', none: 'none' };
const col = t => (t == null ? TOK.ink : TOK[t] || t);
const textW = (str, s) => String(str).length * s * 0.6;

/** Ordres → éléments SVG (coordonnées locales). r : rotation de l'élément, pour garder les textes droits. */
export function opsSvg(ops, r = 0) {
  const out = [];
  for (const o of ops) {
    if (o.t === 'path') {
      const d = 'M' + o.pts.map(p => `${n3(p[0])} ${n3(p[1])}`).join('L') + (o.close ? 'Z' : '');
      out.push(`<path d="${d}" fill="${o.fill && o.fill !== 'none' ? col(o.fill) : 'none'}" stroke="${col(o.color)}" stroke-width="${n3(o.w ?? 0.12)}"${o.cap ? ' stroke-linecap="round"' : ''}/>`);
    } else if (o.t === 'circle') {
      out.push(`<circle cx="${n3(o.x)}" cy="${n3(o.y)}" r="${n3(o.r)}" fill="${col(o.fill || 'body')}"${o.alpha ? ` fill-opacity="${o.alpha}"` : ''}${o.noStroke ? '' : ` stroke="${col('ink')}" stroke-width="0.12"`}/>`);
    } else if (o.t === 'text') {
      const anchor = o.a === 'm' ? 'middle' : o.a === 'r' ? 'end' : 'start';
      const rot = r ? ` transform="rotate(${-r} ${n3(o.x)} ${n3(o.y - o.s * 0.33)})"` : '';
      out.push(`<text x="${n3(o.x)}" y="${n3(o.y)}" font-size="${n3(o.s)}" text-anchor="${anchor}" fill="${col(o.color)}"${o.b ? ' font-weight="650"' : ''}${o.mono ? ' class="mono"' : ''}${rot}>${escX(o.str)}</text>`);
      if (o.ov) {
        const w = textW(o.str, o.s), x0 = o.a === 'm' ? o.x - w / 2 : o.a === 'r' ? o.x - w : o.x;
        out.push(`<path d="M${n3(x0)} ${n3(o.y - o.s * 0.82)}H${n3(x0 + w)}" stroke="${col(o.color)}" stroke-width="0.07"${rot}/>`);
      }
    }
  }
  return out.join('');
}
/** Transformation SVG d'un élément tourné (rotation autour de sa boîte). */
export function elTransform(el) {
  const L = layoutOf(el), r = el.r || 0;
  if (r === 90) return `translate(${el.x + L.h} ${el.y}) rotate(90)`;
  if (r === 180) return `translate(${el.x + L.w} ${el.y + L.h}) rotate(180)`;
  if (r === 270) return `translate(${el.x} ${el.y + L.w}) rotate(270)`;
  return `translate(${el.x} ${el.y})`;
}
/** Position du repère d'un élément (coordonnées du plan) : à gauche, à droite ou au-dessus selon le type. */
export function labelPos(el) {
  const d = DEFS[el.type], { w, h } = sizeOf(el), at = (d && d.labelAt) || 't';
  if (at === 'l') return { x: el.x - 0.4, y: el.y + h / 2 + 0.35, a: 'end' };
  if (at === 'r') return { x: el.x + w + 0.4, y: el.y + h / 2 + 0.35, a: 'start' };
  return { x: el.x + w / 2, y: el.y - 0.45, a: 'middle' };
}
/** Largeur (en bits) d'un fil : celle de sa première broche. */
export function wireWidth(byId, w) {
  const e = byId.get(w.a[0]), q = e && layoutOf(e).pins.find(p => p.name === w.a[1]);
  return q ? pinWidth(q) : 1;
}
/** Repère de largeur d'un bus : petit trait oblique et nombre de bits, sur le premier tronçon assez long. */
export function busMark(pts, n) {
  let i = 0; while (i < pts.length - 2 && Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) < 2) i++;
  const [ax, ay] = pts[i], [bx, by] = pts[i + 1] || pts[i], L = Math.hypot(bx - ax, by - ay) || 1, t = Math.min(1.2, L / 2) / L;
  const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, horiz = Math.abs(bx - ax) >= Math.abs(by - ay);
  return { x, y, horiz, n };
}
/** Vignette SVG d'un type d'élément (bibliothèque). */
export function thumbSvg(type, style, props = {}) {
  const d = DEFS[type]; if (!d) return '';
  const p = { ...propsOf({ type, p: props }) };
  if (type === 'tunnel' && !p.label) p.label = 'CLK';
  if (type === 'text') p.text = 'Aa';
  const L = d.layout(p), pad = 0.4;
  const w = Math.max(L.w, 1), h = Math.max(L.h, 1);
  const body = type === 'junction' ? `<circle cx="0" cy="0" r="0.35" fill="var(--lgInk)"/>` : opsSvg(d.sym(p, style, null));
  const vb = type === 'junction' ? '-1 -1 2 2' : `${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`;
  return `<svg class="lgThumb" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${body}</svg>`;
}

/* ---------- PDF (src/schematic/draw.js) ---------- */
const PDF_COL = { body: '#ffffff', ink: '#000000', hi: '#1f9d57', lo: '#9fb8a8', knob: '#ffffff', off: '#ffffff', x: '#d33', z: '#4a7bd0', mut: '#666666', note: '#333333' };
const pcol = t => (t == null ? '#000000' : PDF_COL[t] || t);
/** Dessine un circuit sur une feuille : d (Draw), cadre { x0, y0, x1, y1 } en mm. Rend l'échelle utilisée. */
export function drawCircuitPdf(d, circuit, area, style = 'ansi', sim = null) {
  const els = circuit.elements.filter(e => DEFS[e.type]);
  if (!els.length) return 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) { const { w, h } = sizeOf(e); x0 = Math.min(x0, e.x - (DEFS[e.type].labelAt === 'l' ? 3 : 1)); y0 = Math.min(y0, e.y - 1.5); x1 = Math.max(x1, e.x + w + (DEFS[e.type].labelAt === 'r' ? 4 : 1)); y1 = Math.max(y1, e.y + h + 1); }
  const k = Math.min((area.x1 - area.x0) / (x1 - x0), (area.y1 - area.y0) / (y1 - y0), 4.5);
  const ox = area.x0 + ((area.x1 - area.x0) - (x1 - x0) * k) / 2 - x0 * k, oy = area.y0 + ((area.y1 - area.y0) - (y1 - y0) * k) / 2 - y0 * k;
  const P = (x, y) => [ox + x * k, oy + y * k];
  const byId = new Map(circuit.elements.map(e => [e.id, e]));
  for (const w of circuit.wires || []) {
    const pts = routeWire(circuit, w, byId); if (!pts) continue;
    const n = wireWidth(byId, w);
    d.line(pts.map(p => P(p[0], p[1])), { w: n > 1 ? 0.6 : 0.25 });
    if (n > 1) { // bus : trait oblique et nombre de bits
      const m = busMark(pts, n), [mx, my] = P(m.x, m.y), s = 0.35 * k;
      d.line([[mx - s, my + s], [mx + s, my - s]], { w: 0.2 });
      d.text(mx + (m.horiz ? 0 : s + 0.6), my + (m.horiz ? -s - 0.4 : 0.3), String(n), { s: 0.55 * k, a: m.horiz ? 'm' : 'l', color: '#333333' });
    }
  }
  // Points de jonction : nœuds et broches où arrivent au moins trois fils
  const count = new Map();
  for (const w of circuit.wires || []) for (const [id, pin] of [w.a, w.b]) { const key = id + '|' + pin; count.set(key, (count.get(key) || 0) + 1); }
  for (const e of els) {
    const L = layoutOf(e), r = e.r || 0, p = propsOf(e), live = sim ? sim.live(e.id) : null;
    for (const o of DEFS[e.type].sym(p, style, live)) {
      const tp = (x, y) => { const [a, b] = rotPt(x, y, L.w, L.h, r); return P(e.x + a, e.y + b); };
      // Sur papier (trait noir seulement), les pistes colorées des interrupteurs et segments restent fines.
      const thin = o.color && o.color !== 'ink' && (o.w ?? 0) > 0.2;
      if (o.t === 'text' && (e.type === 'switch' || e.type === 'dip')) continue; // la valeur est écrite dessous
      if (o.t === 'path') d.line(o.pts.map(q => tp(q[0], q[1])), { w: (thin ? 0.08 : o.w ?? 0.12) * k * 0.9, close: !!o.close, fill: o.fill && o.fill !== 'none' ? pcol(o.fill) : null });
      else if (o.t === 'circle') { const [cx, cy] = tp(o.x, o.y); d.circle(cx, cy, o.r * k, { w: 0.2, fill: pcol(o.fill || 'body'), stroke: !o.noStroke }); }
      else if (o.t === 'text') {
        const [tx, ty] = tp(o.x, o.y), a = o.a === 'm' ? 'm' : o.a === 'r' ? 'r' : 'l';
        d.text(tx, ty, o.str, { s: o.s * k * 0.95, a, b: !!o.b, color: o.color === 'mut' ? '#666666' : '#000000' });
        if (o.ov) { const tw = textW(o.str, o.s) * k, xs = a === 'm' ? tx - tw / 2 : a === 'r' ? tx - tw : tx; d.line([[xs, ty - o.s * k * 0.82], [xs + tw, ty - o.s * k * 0.82]], { w: 0.15 }); }
      }
    }
    for (const q of pinsOf(e)) if (e.type === 'junction' || (count.get(e.id + '|' + q.name) || 0) >= 2) { const [cx, cy] = P(q.wx, q.wy); d.circle(cx, cy, (q.bus ? 0.32 : 0.22) * k, { fill: '#000000', w: 0.1 }); }
    const lab = String(p.label || '').trim();
    if (lab && e.type !== 'tunnel') { const lp = labelPos(e), [lx, ly] = P(lp.x, lp.y); d.text(lx, ly, lab, { s: 0.95 * k, a: lp.a === 'end' ? 'r' : lp.a === 'start' ? 'l' : 'm', b: true }); }
    if (sim && (e.type === 'switch' || e.type === 'led' || e.type === 'probe')) {
      const v = e.type === 'switch' ? (p.value ? 1 : 0) : sim.level(e.id, 'A'), { w, h } = sizeOf(e), [vx, vy] = P(e.x + w / 2, e.y + h + 0.9);
      d.text(vx, vy, LEVEL_TXT[v], { s: 0.7 * k, a: 'm', color: '#555555' });
    }
  }
  return k;
}
