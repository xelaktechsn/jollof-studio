// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Dessin vectoriel d'une feuille de schéma, en millimètres (origine en haut à gauche).
// Une même liste d'ordres sert à l'aperçu (SVG) et au fichier PDF, écrit ici sans
// bibliothèque : le PDF reste vectoriel, net à toutes les échelles et à l'impression.

/** Liste d'ordres de dessin, avec une transformation courante (échelle puis translation). */
import { tl } from '../i18n/index.js';
export class Draw {
  constructor() { this.ops = []; this.k = 1; this.tx = 0; this.ty = 0; }
  setTransform(k, tx, ty) { this.k = k; this.tx = tx; this.ty = ty; }
  P(x, y) { return [this.tx + x * this.k, this.ty + y * this.k]; }
  W(w) { return w * this.k; }
  line(pts, o = {}) { this.ops.push({ t: 'path', pts: pts.map(p => this.P(p[0], p[1])), w: this.W(o.w ?? 0.25), close: !!o.close, fill: o.fill || null, dash: o.dash || null, stroke: o.stroke !== false }); }
  rect(x, y, w, h, o = {}) { this.line([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], { ...o, close: true }); }
  circle(cx, cy, r, o = {}) { const [X, Y] = this.P(cx, cy); this.ops.push({ t: 'circle', x: X, y: Y, r: this.W(r), w: this.W(o.w ?? 0.25), fill: o.fill || null, stroke: o.stroke !== false }); }
  /** Arc de cercle approché par des segments (a0 → a1 en radians). */
  arc(cx, cy, r, a0, a1, o = {}) { const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 0.2)), pts = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } this.line(pts, o); }
  /** Texte : y est la ligne de base ; a = l | m | r ; rot = 0 ou -90 (vertical, de bas en haut). */
  text(x, y, str, o = {}) { const [X, Y] = this.P(x, y); this.ops.push({ t: 'text', x: X, y: Y, s: Math.max(this.W(o.s ?? 2), 1.1), str: String(str), a: o.a || 'l', b: !!o.b, rot: o.rot || 0, color: o.color || '#000' }); }
}
// Chasses de Helvetica (millièmes de cadratin, caractères 32 à 126), d'après ses métriques AFM.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const EXTRA = { '°': 400, '·': 278, '’': 222, 'Ω': 768, 'µ': 556, '×': 584, '–': 556, '—': 1000, '…': 1000, '«': 556, '»': 556, '→': 987 };
/** Largeur d'un texte en Helvetica (mm). */
export function textWidth(str, size, bold) {
  let w = 0;
  for (const ch of String(str)) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) w += HELV[c - 32];
    else if (EXTRA[ch]) w += EXTRA[ch];
    else { const base = ch.normalize('NFD')[0].charCodeAt(0); w += base >= 32 && base <= 126 ? HELV[base - 32] : 556; }
  }
  return w / 1000 * size * (bold ? 1.05 : 1);
}

/* ---------------- SVG ---------------- */
const escX = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = v => +v.toFixed(3);
export function toSvg(page, cls = '') {
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="0 0 ${page.w} ${page.h}" width="${page.w}mm" height="${page.h}mm" font-family="Helvetica, Arial, sans-serif"><rect width="${page.w}" height="${page.h}" fill="#fff"/>`];
  for (const o of page.ops) {
    if (o.t === 'path') {
      const d = 'M' + o.pts.map(p => `${n(p[0])} ${n(p[1])}`).join('L') + (o.close ? 'Z' : '');
      out.push(`<path d="${d}" fill="${o.fill || 'none'}" stroke="${o.stroke ? '#000' : 'none'}" stroke-width="${n(o.w)}" stroke-linejoin="round" stroke-linecap="round"${o.dash ? ` stroke-dasharray="${o.dash.join(' ')}"` : ''}/>`);
    } else if (o.t === 'circle') out.push(`<circle cx="${n(o.x)}" cy="${n(o.y)}" r="${n(o.r)}" fill="${o.fill || 'none'}" stroke="${o.stroke ? '#000' : 'none'}" stroke-width="${n(o.w)}"/>`);
    else if (o.t === 'text') {
      const anchor = o.a === 'm' ? 'middle' : o.a === 'r' ? 'end' : 'start';
      out.push(`<text x="${n(o.x)}" y="${n(o.y)}" font-size="${n(o.s)}" text-anchor="${anchor}" fill="${o.color}"${o.b ? ' font-weight="bold"' : ''}${o.rot ? ` transform="rotate(${o.rot} ${n(o.x)} ${n(o.y)})"` : ''}>${escX(o.str)}</text>`);
    }
  }
  out.push('</svg>');
  return out.join('');
}

/* ---------------- PDF ---------------- */
// Polices standard du PDF (aucune police à embarquer) : Helvetica en codage WinAnsi, et Symbol pour Ω.
const WIN = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
const SYMBOL = { 'Ω': 0x57, 'µ': 0x6d, '→': 0xae, '≈': 0xbb, '±': 0xb1, '×': 0xb4, '−': 0x2d, '←': 0xac, '↔': 0xab, '≤': 0xa3, '≥': 0xb3, '÷': 0xb8, '∞': 0xa5, 'Δ': 0x44, 'π': 0x70, '√': 0xd6 };
/** Caractères absents des deux polices : remplacés par un équivalent lisible plutôt que « ? ». */
const FALLBACK = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '⁰': '0', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '✓': 'v', '✔': 'v', '✕': 'x', '✗': 'x', '⎓': '=', '′': "'", '″': '"', '‑': '-', '‐': '-', '⁄': '/', '∕': '/', '·': '·', '↗': '^', '↘': 'v', '⇒': '=>', '★': '*', '•': '•' };
/** Découpe un texte en morceaux d'une même police. */
function runs(str) {
  const out = [];
  for (const ch of [...str].map(x => FALLBACK[x] || x).join('').replace(/[  ]/g, ' ')) {
    const c = ch.codePointAt(0);
    let font = 'F', code;
    if (SYMBOL[ch] && ch !== 'µ' && ch !== '±' && ch !== '×') { font = 'S'; code = SYMBOL[ch]; }
    else if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) code = c;
    else if (WIN[c]) code = WIN[c];
    else if (SYMBOL[ch]) { font = 'S'; code = SYMBOL[ch]; }
    else code = 0x3f; // ?
    const last = out[out.length - 1];
    if (last && last.font === font) last.codes.push(code); else out.push({ font, codes: [code] });
  }
  return out;
}
const pdfStr = codes => '(' + codes.map(c => (c === 0x28 || c === 0x29 || c === 0x5c ? '\\' + String.fromCharCode(c) : c < 0x20 || c > 0x7e ? '\\' + c.toString(8).padStart(3, '0') : String.fromCharCode(c))).join('') + ')';
const MM = 72 / 25.4;
/** Couleur « #rgb » ou « #rrggbb » → opérateur de couleur de remplissage du PDF. */
const rgb = c => { let h = String(c || '#000').slice(1); if (h.length === 3) h = h.replace(/./g, x => x + x); const v = [0, 2, 4].map(i => n(parseInt(h.slice(i, i + 2), 16) / 255)); return `${v[0]} ${v[1]} ${v[2]} rg`; };

/** Pages → fichier PDF (Uint8Array). Chaque page : { w, h (mm), ops }. */
export function toPdf(pages, meta = {}) {
  const objs = []; // texte de chaque objet, indexé à partir de 1
  const add = s => { objs.push(s); return objs.length; };
  const fontF = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontB = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const fontS = add('<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>');
  const pagesId = add(null), kids = [];
  for (const pg of pages) {
    const H = pg.h * MM, f = v => n(v * MM), Y = v => n(H - v * MM), c = [];
    c.push('1 J 1 j');
    for (const o of pg.ops) {
      if (o.t === 'path') {
        c.push(`${f(o.w)} w ${o.dash ? `[${o.dash.map(f).join(' ')}] 0 d` : '[] 0 d'}`);
        if (o.fill) c.push(rgb(o.fill));
        c.push(o.pts.map((p, i) => `${f(p[0])} ${Y(p[1])} ${i ? 'l' : 'm'}`).join(' ') + (o.close ? ' h' : ''));
        c.push(o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S');
      } else if (o.t === 'circle') {
        const k = 0.5523 * o.r, x = o.x, y = o.y, r = o.r, pt = (a, b) => `${f(a)} ${Y(b)}`;
        c.push(`${f(o.w)} w [] 0 d`);
        if (o.fill) c.push(rgb(o.fill));
        c.push(`${pt(x + r, y)} m ${pt(x + r, y + k)} ${pt(x + k, y + r)} ${pt(x, y + r)} c ${pt(x - k, y + r)} ${pt(x - r, y + k)} ${pt(x - r, y)} c ${pt(x - r, y - k)} ${pt(x - k, y - r)} ${pt(x, y - r)} c ${pt(x + k, y - r)} ${pt(x + r, y - k)} ${pt(x + r, y)} c h`);
        c.push(o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S');
      } else if (o.t === 'text') {
        const rs = runs(o.str), size = o.s * MM;
        const width = textWidth(o.str, o.s, o.b) * MM;
        const dx = o.a === 'm' ? -width / 2 : o.a === 'r' ? -width : 0;
        const rad = -o.rot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
        const x0 = o.x * MM + dx * cos, y0 = H - o.y * MM + dx * sin;
        c.push(rgb(o.color));
        c.push(`BT ${n(cos)} ${n(sin)} ${n(-sin)} ${n(cos)} ${n(x0)} ${n(y0)} Tm`);
        for (const r of rs) c.push(`/${r.font === 'S' ? 'S' : o.b ? 'B' : 'F'} ${n(size)} Tf ${pdfStr(r.codes)} Tj`);
        c.push('ET');
      }
    }
    const stream = c.join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(pg.w * MM)} ${n(H)}] /Resources << /Font << /F ${fontF} 0 R /B ${fontB} 0 R /S ${fontS} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const infoStr = s => pdfStr(runs(s).flatMap(r => r.codes));
  const info = add(`<< /Title ${infoStr(meta.title || tl('Schéma'))} /Producer (Jollof Studio) /Creator (Jollof Studio) >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 255;
  return bytes;
}
