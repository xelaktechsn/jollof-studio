// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Lecteur DXF en flux (ASCII et binaire, R12 → 2018), écrit à partir de la référence DXF publique : lit le fichier par
// morceaux sans jamais garder tout le texte, développe les blocs (INSERT imbriqués, MINSERT, symétries, OCS) et rend un
// CadDoc compact (tableaux typés) pour le fond de plan, la conversion en modèle et l'export.
//
// parseDxf(source, { onProgress(f 0..1), signal, size, tol, maxSegs, maxTexts, maxTris, fills }) → Promise<CadDoc>
//   source : ArrayBuffer | Uint8Array | ReadableStream<Uint8Array> | Blob/File | string. size = taille totale (octets) si
//   le flux ne la donne pas (progression). signal : AbortSignal (rejette avec une DOMException « AbortError »).
// openCad(file, { onProgress, signal, …mêmes options }) → Promise<CadDoc> : même chose dans un worker (dxf.worker.js),
//   l'annulation termine le worker ; repli sur le fil courant si les workers manquent.
//
// CadDoc (coordonnées du dessin, y vers le haut ; segments RELATIFS à origin pour garder la précision en Float32) :
// { units: 'm'|'cm'|'mm'|'in'|'ft'|'unitless' (+ 'km'|'dm'|'yd'|'mi'|'um' rares), toMetre, unitsGuessed (unité devinée
//     faute de $INSUNITS), insunits, measurement, version ($ACADVER), codepage,
//   origin: [x, y] (Float64, unités du dessin), extents: [x0, y0, x1, y1] (relatifs à origin, géométrie réelle),
//   tol : tolérance de corde des courbes (unités du dessin ; 2 mm par défaut, d'après l'unité connue ou devinée),
//   layers: [{ id, name, color '#rrggbb', aci, ltype, off, frozen, locked, count (segments + textes + triangles),
//              kinds: { line: n, arc: n, … } (segments par genre, text, fill) }],
//   segs: Float32Array [x0,y0,x1,y1,…], segLayer: Uint16Array, segKind: Uint8Array (indice dans KINDS),
//   segColor: Uint16Array (0 = couleur du calque, sinon indice dans palette), palette: ['#rrggbb', …] (palette[0] inutilisé),
//   texts: [{ x, y, h, rot (radians, sens trigo), text, layer, ha (0 gauche 1 centre 2 droite), va (0 ligne de base
//            1 bas 2 milieu 3 haut), color, mirror?, block? (bloc de premier niveau d'où vient le texte), tag? }],
//   inserts: [{ name, x, y, rot (degrés), sx, sy, layer, attribs: { TAG: valeur } }] (INSERT de premier niveau ; leur
//            géométrie est déjà développée), fills: { tris: Float32Array [x0,y0,x1,y1,x2,y2,…], layer: Uint16Array } | null,
//   clusters: [{ x0, y0, x1, y1, count }] (feuilles séparées dans l'espace objet, les plus fournies d'abord),
//   blocks: [{ name, count (entités), xref }], warnings: [{ code, n }],
//   stats: { entities (entités de premier niveau), byType, ms, bytes, segs, texts, tris, truncated } }
// Courbes : arcs, cercles, ellipses et renflements découpés à la tolérance `tol` (flèche maximale, unités du dessin)
// après transformation, donc juste aussi dans les blocs agrandis ; splines par de Boor avec subdivision adaptative.
// Espace papier, VIEWPORT, IMAGE, WIPEOUT, solides ACIS et proxys ignorés. Couleur : BYLAYER, BYBLOCK et calque « 0 »
// des blocs héritent de l'INSERT, comme dans les logiciels de DAO.

export const KINDS = ['line', 'poly', 'arc', 'circle', 'ellipse', 'spline', 'hatch', 'solid', 'dim', 'leader', 'face', 'mline', 'mesh', 'table'];
const K = Object.fromEntries(KINDS.map((k, i) => [k, i]));
export const DEFAULTS = { maxSegs: 5e6, maxTexts: 4e5, maxTris: 2e6, maxDepth: 24, maxArray: 1e4 };

// $INSUNITS → [nom, mètres par unité]
const INSUNITS = { 0: ['unitless', 1], 1: ['in', 0.0254], 2: ['ft', 0.3048], 3: ['mi', 1609.344], 4: ['mm', 0.001], 5: ['cm', 0.01],
  6: ['m', 1], 7: ['km', 1000], 8: ['in', 0.0254e-6], 9: ['in', 0.0254e-3], 10: ['yd', 0.9144], 11: ['m', 1e-10], 12: ['m', 1e-9],
  13: ['um', 1e-6], 14: ['dm', 0.1], 15: ['m', 10], 16: ['m', 100], 17: ['m', 1e9] };
// $DWGCODEPAGE → étiquette WHATWG (TextDecoder)
const CODEPAGES = { ANSI_1250: 'windows-1250', ANSI_1251: 'windows-1251', ANSI_1252: 'windows-1252', ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254', ANSI_1255: 'windows-1255', ANSI_1256: 'windows-1256', ANSI_1257: 'windows-1257', ANSI_1258: 'windows-1258',
  ANSI_874: 'windows-874', ANSI_932: 'shift_jis', ANSI_936: 'gbk', ANSI_949: 'euc-kr', ANSI_950: 'big5', ANSI_1361: 'euc-kr',
  DOS866: 'ibm866', ISO8859_1: 'iso-8859-1', ISO8859_2: 'iso-8859-2', ISO8859_5: 'iso-8859-5', ISO8859_7: 'iso-8859-7',
  ISO8859_15: 'iso-8859-15', BIG5: 'big5', GB2312: 'gbk', KSC5601: 'euc-kr', UTF8: 'utf-8' };

/* ---------- couleurs ACI ---------- */
const ACI = new Int32Array(256);
(() => {
  const base = [0, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0];
  for (let i = 0; i < 10; i++) ACI[i] = base[i];
  const V = [1, 1, 0.65, 0.65, 0.5, 0.5, 0.3, 0.3, 0.15, 0.15];
  for (let c = 10; c < 250; c++) {
    const h = Math.floor((c - 10) / 10) * 15, k = (c - 10) % 10, v = 255 * V[k], lo = k % 2 ? v * 0.5 : 0;
    const f = (n) => { const x = (n + h / 60) % 6; const t = Math.max(0, Math.min(1, Math.min(x, 4 - x))); return Math.floor(v - (v - lo) * t); };
    ACI[c] = (f(5) << 16) | (f(3) << 8) | f(1);
  }
  const g = [0x33, 0x50, 0x69, 0x82, 0xbe, 0xff];
  for (let i = 0; i < 6; i++) ACI[250 + i] = g[i] * 0x10101;
})();
export const aciRgb = n => ACI[Math.abs(n | 0) & 255];
export const hexOf = rgb => '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');
const BYLAYER = -1, BYBLOCK = -2;

/* ---------- types des codes de groupe ---------- */
// 0 ignoré, 1 texte, 2 nombre, 3 marque (101), 4 poignée hexadécimale (5, 105)
const TYPE = new Uint8Array(1072);
const setT = (a, b, t) => { for (let i = a; i <= b; i++) TYPE[i] = t; };
setT(0, 4, 1); setT(6, 9, 1); setT(10, 99, 2); TYPE[101] = 3; setT(110, 149, 2); setT(160, 179, 2); setT(210, 239, 2);
setT(270, 299, 2); setT(370, 389, 2); setT(400, 409, 2); setT(420, 429, 2); setT(440, 469, 2); TYPE[5] = 4; TYPE[105] = 4;
// Codes définis par la référence DXF (Autodesk, « Group Code Value Types Reference », DXF Reference AutoCAD 2014,
// p. 2-4) : un code hors de ces plages est signalé (« unknownGroupCode ») et ignoré. INT : codes à valeur entière.
const VALID = new Uint8Array(1072), INT = new Uint8Array(1072);
for (const [a, b] of [[0, 79], [90, 102], [105, 105], [110, 149], [160, 179], [210, 239], [270, 481], [999, 1071]]) for (let i = a; i <= b; i++) VALID[i] = 1;
for (const [a, b] of [[60, 99], [160, 179], [270, 299], [370, 389], [400, 409], [420, 429], [440, 459], [1060, 1071]]) for (let i = a; i <= b; i++) INT[i] = 1;
// taille des valeurs en DXF binaire : 1 chaîne, 2 double, 3 int16, 4 int32, 5 int64, 6 booléen (1 octet), 7 bloc binaire
const BSIZE = new Uint8Array(1072);
(() => {
  const s = (a, b, t) => { for (let i = a; i <= b; i++) BSIZE[i] = t; };
  s(0, 9, 1); s(10, 59, 2); s(60, 79, 3); s(90, 99, 4); s(100, 109, 1); s(110, 149, 2); s(160, 169, 5); s(170, 179, 3); s(210, 239, 2);
  s(270, 289, 3); s(290, 299, 6); s(300, 309, 1); s(310, 319, 7); s(320, 369, 1); s(370, 389, 3); s(390, 399, 1); s(400, 409, 3);
  s(410, 419, 1); s(420, 429, 4); s(430, 439, 1); s(440, 459, 4); s(460, 469, 2); s(470, 481, 1); s(999, 1003, 1); BSIZE[1004] = 7;
  s(1005, 1009, 1); s(1010, 1059, 2); s(1060, 1070, 3); BSIZE[1071] = 4;
})();

/* ---------- lecture des nombres et des textes depuis les octets ---------- */
const P10 = []; for (let i = 0; i <= 22; i++) P10.push(Number('1e' + i));
let latin1 = null;
let NUMBAD = false; // dernier nombre illisible (remis à zéro par l'appelant)
function slowNum(b, s, e) {
  latin1 ||= new TextDecoder('latin1'); const t = latin1.decode(b.subarray(s, e)).trim();
  const v = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? parseFloat(t) : NaN;
  if (Number.isFinite(v)) return v;
  NUMBAD = true; return 0;
}
/** Nombre décimal ASCII entre s et e (espaces tolérés, exposant E). */
function parseNum(b, s, e) {
  const s0 = s;
  while (s < e && (b[s] === 32 || b[s] === 9)) s++;
  while (e > s && (b[e - 1] === 32 || b[e - 1] === 9)) e--;
  let neg = false, c = b[s];
  if (c === 45) { neg = true; s++; } else if (c === 43) s++;
  let m = 0, exp = 0, nd = 0, any = false;
  for (; s < e; s++) {
    c = b[s] - 48; if (c < 0 || c > 9) break; any = true;
    if (nd < 16) { m = m * 10 + c; if (m) nd++; } else exp++;
  }
  if (s < e && b[s] === 46) {
    for (s++; s < e; s++) {
      c = b[s] - 48; if (c < 0 || c > 9) break; any = true;
      if (nd < 16) { m = m * 10 + c; exp--; if (m) nd++; }
    }
  }
  if (!any) return slowNum(b, s0, e);
  if (s < e && (b[s] === 69 || b[s] === 101)) {
    s++; let en = false;
    if (b[s] === 45) { en = true; s++; } else if (b[s] === 43) s++;
    let x = 0; for (; s < e; s++) { c = b[s] - 48; if (c < 0 || c > 9) break; x = x * 10 + c; }
    exp += en ? -x : x;
  }
  if (s !== e) return slowNum(b, s0, e);
  let v = m;
  if (exp > 0) v = exp <= 22 ? m * P10[exp] : m * Math.pow(10, exp);
  else if (exp < 0) v = exp >= -22 ? m / P10[-exp] : m / Math.pow(10, -exp);
  return neg ? -v : v;
}
function parseIntB(b, s, e) {
  while (s < e && (b[s] === 32 || b[s] === 9)) s++;
  let neg = false; if (b[s] === 45) { neg = true; s++; } else if (b[s] === 43) s++;
  let v = 0, any = false;
  for (; s < e; s++) { const c = b[s] - 48; if (c < 0 || c > 9) break; v = v * 10 + c; any = true; }
  while (s < e && (b[s] === 32 || b[s] === 9)) s++;
  return any && s === e ? (neg ? -v : v) : -9999; // un code de groupe est un entier, rien d'autre
}
/** Poignée hexadécimale → nombre (NaN si illisible ; au-delà de 13 chiffres, les 13 derniers). */
function parseHex(b, s, e) {
  while (s < e && (b[s] === 32 || b[s] === 9)) s++;
  while (e > s && (b[e - 1] === 32 || b[e - 1] === 9)) e--;
  if (e <= s) return NaN;
  if (e - s > 13) s = e - 13;
  let v = 0;
  for (; s < e; s++) { const c = b[s], d = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1; if (d < 0) return NaN; v = v * 16 + d; }
  return v;
}

const UESC = /\\U\+([0-9a-fA-F]{4,5})/g;
/** Remplace les échappements \U+XXXX des chaînes DXF. */
export const unescapeU = s => (s.indexOf('\\U+') < 0 ? s : s.replace(UESC, (_, h) => String.fromCodePoint(parseInt(h, 16))));

class Strings {
  constructor() { this.utf8 = new TextDecoder('utf-8', { fatal: true }); this.cp = null; this.cpName = 'windows-1252'; }
  setCodepage(name) {
    const lab = CODEPAGES[String(name || '').toUpperCase()] || 'windows-1252';
    if (lab === this.cpName && this.cp) return;
    try { this.cp = new TextDecoder(lab); this.cpName = lab; } catch { this.cp = new TextDecoder('windows-1252'); this.cpName = 'windows-1252'; }
  }
  decode(b, s, e) {
    let hi = false;
    for (let i = s; i < e; i++) if (b[i] > 127) { hi = true; break; }
    let str;
    if (!hi) str = e - s < 48 ? String.fromCharCode.apply(null, b.subarray(s, e)) : this.utf8.decode(b.subarray(s, e));
    else {
      // UTF-8 valide d'abord (AC1021+ et convertisseurs modernes), sinon la page de code du fichier
      try { str = this.utf8.decode(b.subarray(s, e)); } catch { this.cp ||= new TextDecoder(this.cpName); str = this.cp.decode(b.subarray(s, e)); }
    }
    return str.indexOf('\\U+') < 0 ? str : unescapeU(str);
  }
}

/* ---------- découpe en groupes : ASCII ---------- */
class AsciiTok {
  constructor(p, str) { this.p = p; this.str = str; this.carry = null; this.code = -1; this.wantCode = true; this.first = true; this.ln = 0; this.cl = 0; }
  push(b) {
    let s = 0;
    if (this.first) { this.first = false; if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) s = 3; }
    if (this.carry) {
      const i = b.indexOf(10);
      if (i < 0) { this.carry = cat(this.carry, b); return; }
      const ln = cat(this.carry, b.subarray(0, i)); this.carry = null;
      this.line(ln, 0, ln.length); s = i + 1;
    }
    for (;;) {
      const i = b.indexOf(10, s); if (i < 0) break;
      this.line(b, s, i); s = i + 1;
    }
    if (s < b.length) this.carry = b.slice(s);
  }
  end() { if (this.carry) { const c = this.carry; this.carry = null; this.line(c, 0, c.length); } }
  line(b, s, e) {
    this.ln++;
    if (e > s && b[e - 1] === 13) e--;
    const p = this.p;
    if (this.wantCode) {
      const c = parseIntB(b, s, e);
      // ligne de code illisible : signalée et sautée (on attend de nouveau un code, ce qui réaligne les paires)
      if (c === -9999) { p.bad('error', 'badGroupCode', snip(b, s, e), this.ln); return; }
      this.code = c; this.cl = this.ln; this.wantCode = false; return;
    }
    this.wantCode = true;
    const c = this.code; p.ln = this.cl;
    if (c < 0 || c >= 1072 || !VALID[c]) { p.bad('info', 'unknownGroupCode', String(c), this.cl); return; }
    const t = TYPE[c];
    if (t === 2) {
      NUMBAD = false; const v = parseNum(b, s, e);
      if (NUMBAD) p.bad('warning', 'badNumber', c + ': ' + snip(b, s, e), this.ln);
      else if (INT[c] && !Number.isInteger(v)) p.bad('warning', 'badInteger', c + ': ' + snip(b, s, e), this.ln);
      p.group(c, v, null);
    } else if (t === 1) p.group(c, 0, this.str.decode(b, s, e));
    else if (t === 4) { const h = parseHex(b, s, e); if (h !== h && p.sec !== 1) p.bad('warning', 'badHandle', snip(b, s, e), this.ln); p.group(c, h, null); }
    else if (t === 3) p.group(c, 0, null);
  }
}
function snip(b, s, e) { latin1 ||= new TextDecoder('latin1'); return latin1.decode(b.subarray(s, Math.min(e, s + 60))); }
function cat(a, b) { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; }

/* ---------- découpe en groupes : binaire ---------- */
const BIN_SENTINEL = 'AutoCAD Binary DXF\r\n\x1a\0';
class BinTok {
  constructor(p, str) { this.p = p; this.str = str; this.carry = null; this.skip = BIN_SENTINEL.length; this.two = null; this.off = 0; p.binary = true; }
  push(chunk) {
    let b = this.carry ? cat(this.carry, chunk) : chunk;
    if (this.carry) this.off -= this.carry.length;
    this.carry = null;
    let s = 0;
    if (this.skip) { if (b.length < this.skip + 2) { this.carry = b; this.off += b.length; return; } s = this.skip; this.skip = 0; this.two = b[s + 1] === 0; }
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = b.length;
    for (;;) {
      let p = s, code;
      if (this.two) { if (p + 2 > n) break; code = dv.getUint16(p, true); p += 2; }
      else { if (p + 1 > n) break; code = b[p++]; if (code === 255) { if (p + 2 > n) break; code = dv.getUint16(p, true); p += 2; } }
      const k = code < 1072 ? BSIZE[code] : 1;
      let v = 0, str = null;
      if (k === 1) { const z = b.indexOf(0, p); if (z < 0) break; if (TYPE[code] === 1) str = this.str.decode(b, p, z); else if (TYPE[code] === 4) v = parseHex(b, p, z); p = z + 1; }
      else if (k === 2) { if (p + 8 > n) break; v = dv.getFloat64(p, true); p += 8; }
      else if (k === 3) { if (p + 2 > n) break; v = dv.getInt16(p, true); p += 2; }
      else if (k === 4) { if (p + 4 > n) break; v = dv.getInt32(p, true); p += 4; }
      else if (k === 5) { if (p + 8 > n) break; v = Number(dv.getBigInt64(p, true)); p += 8; }
      else if (k === 6) { if (p + 1 > n) break; v = b[p]; p += 1; }
      else if (k === 7) { if (p + 1 > n) break; const l = b[p]; if (p + 1 + l > n) break; p += 1 + l; }
      else { const z = b.indexOf(0, p); if (z < 0) break; p = z + 1; }
      this.p.ln = this.off + s; s = p;
      if (code >= 1072 || !VALID[code]) { this.p.bad('info', 'unknownGroupCode', String(code), this.p.ln); continue; }
      const t = TYPE[code];
      if (t === 2) this.p.group(code, v, null); else if (t === 1) this.p.group(code, 0, str); else if (t === 4) this.p.group(code, v, null); else if (t === 3) this.p.group(code, 0, null);
    }
    if (s < n) this.carry = b.slice(s);
    this.off += n;
  }
  end() { if (this.carry && this.carry.length) this.p.bad('error', 'truncated', this.carry.length + ' octets', this.off - this.carry.length); this.carry = null; }
}

/* ---------- géométrie ---------- */
/** Projection OCS → XY du SCG (algorithme de l'axe arbitraire) : [ax, ay, bx, by, nx, ny] (x·A + y·B + z·N). */
function ocsOf(nx, ny, nz) {
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  let ax, ay, az;
  if (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) { ax = nz; ay = 0; az = -nx; } // Wy × N
  else { ax = -ny; ay = nx; az = 0; } // Wz × N
  const la = Math.hypot(ax, ay, az) || 1; ax /= la; ay /= la; az /= la;
  const bx = ny * az - nz * ay, by = nz * ax - nx * az;
  return [ax, ay, bx, by, nx, ny];
}
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ID = [1, 0, 0, 1, 0, 0];
const D2R = Math.PI / 180, TAU = Math.PI * 2;

/** Nombre de cordes pour un arc de rayon r et d'ouverture |sw| à la flèche tol. */
function arcSegs(r, sw, tol) {
  sw = Math.abs(sw);
  if (!(r > 0) || !(sw > 0)) return 1;
  let n;
  if (r <= tol) n = Math.ceil(sw / (Math.PI / 2));
  else n = Math.max(Math.ceil(sw / (2 * Math.acos(1 - tol / r))), Math.ceil(sw / (Math.PI / 4)));
  return Math.min(Math.max(n, 1), 512);
}

/** Arc par renflement de (x0,y0) à (x1,y1) → [cx, cy, r, t0, t1] (t1 - t0 = 4·atan(b)). */
function bulgeArc(x0, y0, x1, y1, bg) {
  const th = 4 * Math.atan(bg), dx = x1 - x0, dy = y1 - y0, c = Math.hypot(dx, dy);
  if (c < 1e-12) return null;
  const r = c / (2 * Math.sin(th / 2)); // signé
  const h = r * Math.cos(th / 2); // distance signée milieu → centre
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const cx = mx - (dy / c) * h, cy = my + (dx / c) * h;
  const t0 = Math.atan2(y0 - cy, x0 - cx);
  return [cx, cy, Math.abs(r), t0, t0 + th];
}

/** Point d'une B-spline (rationnelle) par l'algorithme de de Boor ; P = [x, y, w] * n. */
function deBoor(t, p, U, P, n, out) {
  let k = p;
  const hiK = n - 1;
  while (k < hiK && t >= U[k + 1]) k++;
  const dx = new Float64Array(p + 1), dy = new Float64Array(p + 1), dw = new Float64Array(p + 1);
  for (let j = 0; j <= p; j++) { const i = Math.min(Math.max(j + k - p, 0), n - 1), w = P[i * 3 + 2]; dx[j] = P[i * 3] * w; dy[j] = P[i * 3 + 1] * w; dw[j] = w; }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p, den = U[i + p - r + 1] - U[i];
      const a = den > 0 ? (t - U[i]) / den : 0;
      dx[j] = (1 - a) * dx[j - 1] + a * dx[j]; dy[j] = (1 - a) * dy[j - 1] + a * dy[j]; dw[j] = (1 - a) * dw[j - 1] + a * dw[j];
    }
  }
  const w = dw[p] || 1; out[0] = dx[p] / w; out[1] = dy[p] / w;
}

/** Points d'une spline : contrôle + nœuds (de Boor, subdivision adaptative) ou points de lissage (Catmull-Rom). */
export function splinePoints({ degree = 3, knots = [], ctrl = [], weights = [], fit = [], closed = false }, tol) {
  const n = ctrl.length / 2, out = [];
  if (n >= 2 && knots.length >= n + degree + 1) {
    const p = Math.min(degree, n - 1), P = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) { P[i * 3] = ctrl[i * 2]; P[i * 3 + 1] = ctrl[i * 2 + 1]; P[i * 3 + 2] = weights[i] > 0 ? weights[i] : 1; }
    const U = Float64Array.from(knots), a = U[p], b = U[n];
    const q = [0, 0], m = [0, 0];
    const ev = t => { deBoor(Math.min(t, b - (b - a) * 1e-12), p, U, P, n, q); return [q[0], q[1]]; };
    let prev = ev(a); out.push(prev[0], prev[1]);
    const rec = (t0, p0, t1, p1, d) => {
      const tm = (t0 + t1) / 2; deBoor(tm, p, U, P, n, m); const pm = [m[0], m[1]];
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy);
      const dev = L > 0 ? Math.abs((pm[0] - p0[0]) * dy - (pm[1] - p0[1]) * dx) / L : Math.hypot(pm[0] - p0[0], pm[1] - p0[1]);
      if (d < 10 && (dev > tol || d < 2)) { rec(t0, p0, tm, pm, d + 1); rec(tm, pm, t1, p1, d + 1); }
      else out.push(p1[0], p1[1]);
    };
    for (let i = p; i < n; i++) {
      const t0 = U[i], t1 = U[i + 1]; if (!(t1 > t0)) continue;
      const p1 = ev(i + 1 === n ? b : t1); rec(t0, prev, t1, p1, 0); prev = p1;
      if (out.length > 40000) break;
    }
    return out;
  }
  // points de lissage seulement : Catmull-Rom uniforme (approximation de la courbe d'origine)
  const f = fit.length / 2; if (f < 2) return ctrl.length >= 4 ? ctrl.slice() : [];
  const pt = i => { i = closed ? (i + f) % f : Math.max(0, Math.min(f - 1, i)); return [fit[i * 2], fit[i * 2 + 1]]; };
  out.push(fit[0], fit[1]);
  const spans = closed ? f : f - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = pt(i - 1), p1 = pt(i), p2 = pt(i + 1), p3 = pt(i + 2), N = 8;
    for (let j = 1; j <= N; j++) {
      const t = j / N, t2 = t * t, t3 = t2 * t;
      const c = (a0, a1, a2, a3) => 0.5 * (2 * a1 + (-a0 + a2) * t + (2 * a0 - 5 * a1 + 4 * a2 - a3) * t2 + (-a0 + 3 * a1 - 3 * a2 + a3) * t3);
      out.push(c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]));
    }
  }
  return out;
}

/** Triangulation d'un polygone simple par oreilles (≤ 2000 sommets) → indices, ou null. */
export function earcut2(xy) {
  const n = xy.length / 2; if (n < 3 || n > 2000) return null;
  let area = 0; for (let i = 0, j = n - 1; i < n; j = i++) area += (xy[j * 2] - xy[i * 2]) * (xy[j * 2 + 1] + xy[i * 2 + 1]);
  const idx = []; for (let i = 0; i < n; i++) idx.push(i);
  if (area < 0) idx.reverse(); // sens trigo
  const out = [], X = i => xy[i * 2], Y = i => xy[i * 2 + 1];
  const cross = (a, b, c) => (X(b) - X(a)) * (Y(c) - Y(a)) - (Y(b) - Y(a)) * (X(c) - X(a));
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 0) continue;
      let inside = false;
      for (const p of idx) {
        if (p === a || p === b || p === c) continue;
        if (cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0) { inside = true; break; }
      }
      if (inside) continue;
      out.push(a, b, c); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out.length ? out : null;
}

/* ---------- textes ---------- */
const PCT = { c: 'Ø', d: '°', p: '±', '%': '%' };
/** Codes %% des textes DXF (%%c Ø, %%d °, %%p ±, %%nnn, bascules %%u %%o %%k supprimées). */
export function stripText(s) {
  if (s.indexOf('%%') < 0) return s;
  return s.replace(/%%(\d{3}|.)/g, (_, c) => (c.length === 3 ? String.fromCharCode(+c) : PCT[c.toLowerCase()] ?? ''));
}
/** Texte d'un MTEXT sans mise en forme : \P → saut de ligne, \S fractions, {} et codes \f \H \C … retirés. */
export function stripMtext(s) {
  let out = ''; const n = s.length;
  for (let i = 0; i < n;) {
    const ch = s[i];
    if (ch === '\\') {
      const c = s[i + 1];
      if (c === 'P' || c === 'X') { out += '\n'; i += 2; }
      else if (c === '~') { out += ' '; i += 2; }
      else if (c === '\\' || c === '{' || c === '}') { out += c; i += 2; }
      else if ('LlOoKkN'.includes(c)) i += 2;
      else if ('fFHWQTACcp'.includes(c)) { const j = s.indexOf(';', i); i = j < 0 ? n : j + 1; }
      else if (c === 'S') {
        const j = s.indexOf(';', i), body = s.slice(i + 2, j < 0 ? n : j);
        const m = /^(.*?)[\^/#](.*)$/.exec(body);
        out += m ? (m[1].trim() + '/' + m[2].trim()) : body; i = j < 0 ? n : j + 1;
      } else if (c === 'U' && s[i + 2] === '+' && /^[0-9a-f]{4}$/i.test(s.slice(i + 3, i + 7))) { out += String.fromCodePoint(parseInt(s.slice(i + 3, i + 7), 16)); i += 7; }
      else if (c === undefined) i++;
      else { out += c; i += 2; }
    } else if (ch === '{' || ch === '}') i++;
    else { out += ch; i++; }
  }
  return stripText(out);
}

/* ---------- primitives d'un bloc (repère du bloc) ---------- */
class Grow {
  constructor(T, n = 64) { this.T = T; this.a = new T(n); this.n = 0; }
  room(k) { if (this.n + k > this.a.length) { const b = new this.T(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  trim() { if (this.a.length !== this.n) this.a = this.a.slice(0, this.n); return this; }
}
class Prims {
  constructor(name, flags) {
    this.name = name; this.flags = flags; this.bx = 0; this.by = 0; this.count = 0;
    this.L = new Grow(Float64Array); this.Lm = new Grow(Int32Array); // x0 y0 x1 y1 | layer color kind
    this.A = new Grow(Float64Array); this.Am = new Grow(Int32Array); // cx cy ux uy vx vy t0 t1 | layer color kind
    this.T = new Grow(Float64Array); this.Tm = new Grow(Int32Array); // triangles | layer color
    this.texts = []; this.ins = [];
  }
  line(x0, y0, x1, y1, l, c, k) { const L = this.L; L.room(4); L.a[L.n++] = x0; L.a[L.n++] = y0; L.a[L.n++] = x1; L.a[L.n++] = y1; const M = this.Lm; M.room(3); M.a[M.n++] = l; M.a[M.n++] = c; M.a[M.n++] = k; }
  arc(cx, cy, ux, uy, vx, vy, t0, t1, l, c, k) { const A = this.A; A.room(8); const a = A.a; let n = A.n; a[n++] = cx; a[n++] = cy; a[n++] = ux; a[n++] = uy; a[n++] = vx; a[n++] = vy; a[n++] = t0; a[n++] = t1; A.n = n; const M = this.Am; M.room(3); M.a[M.n++] = l; M.a[M.n++] = c; M.a[M.n++] = k; }
  tri(x0, y0, x1, y1, x2, y2, l, c) { const T = this.T; T.room(6); const a = T.a; let n = T.n; a[n++] = x0; a[n++] = y0; a[n++] = x1; a[n++] = y1; a[n++] = x2; a[n++] = y2; T.n = n; const M = this.Tm; M.room(2); M.a[M.n++] = l; M.a[M.n++] = c; }
  text(t) { this.texts.push(t); }
  insert(name, m, l, c, attribs, kind) { this.ins.push({ name, m, l, c, kind }); }
  done() { for (const g of [this.L, this.Lm, this.A, this.Am, this.T, this.Tm]) g.trim(); }
}

/* ---------- sortie (repère du monde) ---------- */
class Out {
  constructor(o) {
    this.o = o; this.max = o.maxSegs; this.n = 0; this.cap = 0; this.full = false;
    this.s = new Float32Array(0); this.sl = new Uint16Array(0); this.sk = new Uint8Array(0); this.sc = new Uint16Array(0);
    this.ox = NaN; this.oy = NaN; this.layers = null; this.lc = null; this.lk = null;
    this.pal = new Map(); this.palette = ['#000000'];
    this.texts = []; this.tFull = false; this.inserts = [];
    this.tri = new Grow(Float32Array, 0); this.triL = new Grow(Uint16Array, 0); this.trFull = false;
    this.bb = new Grow(Float32Array, 1024); this.bbF = new Grow(Uint8Array, 256); this.rect = 0; this.resetBox();
    // entité de premier niveau d'où vient chaque segment / texte / triangle (poignée DXF, type, calque)
    this.se = new Uint32Array(0); this.ent = 0xffffffff; this.triE = new Grow(Uint32Array, 0);
    this.eh = new Grow(Float64Array, 1024); this.et = new Grow(Uint8Array, 1024); this.el = new Grow(Uint16Array, 1024); this.types = []; this.tmap = new Map();
    this.dropped = 0; this.tDropped = 0; this.trDropped = 0; this.outside = 0;
  }
  newEnt(h, type, l) {
    let t = this.tmap.get(type); if (t === undefined) { t = this.types.length; this.types.push(type); this.tmap.set(type, t); }
    const i = this.eh.n;
    if (i === this.eh.a.length) this.eh.room(1);
    if (i === this.et.a.length) this.et.room(1);
    if (i === this.el.a.length) this.el.room(1);
    this.eh.a[i] = h; this.et.a[i] = t; this.el.a[i] = l; this.eh.n = this.et.n = this.el.n = i + 1;
    return (this.ent = i);
  }
  resetBox() { this.bx0 = Infinity; this.by0 = Infinity; this.bx1 = -Infinity; this.by1 = -Infinity; }
  origin(x, y) { if (this.ox !== this.ox) { this.ox = Math.round(x); this.oy = Math.round(y); } }
  grow() {
    const cap = Math.min(this.max, Math.max(65536, Math.ceil(this.cap * 1.6)));
    const s = new Float32Array(cap * 4); s.set(this.s); this.s = s;
    const sl = new Uint16Array(cap); sl.set(this.sl); this.sl = sl;
    const sk = new Uint8Array(cap); sk.set(this.sk); this.sk = sk;
    const sc = new Uint16Array(cap); sc.set(this.sc); this.sc = sc;
    const se = new Uint32Array(cap); se.set(this.se); this.se = se;
    this.cap = cap;
  }
  colorIdx(rgb, l) {
    if (rgb < 0 || rgb === this.layers[l].rgb) return 0;
    let i = this.pal.get(rgb);
    if (i === undefined) { if (this.palette.length >= 65535) return 0; i = this.palette.length; this.palette.push(hexOf(rgb)); this.pal.set(rgb, i); }
    return i;
  }
  seg(x0, y0, x1, y1, l, rgb, k) {
    if (this.n >= this.cap) { if (this.n >= this.max) { this.full = true; this.dropped++; return; } this.grow(); }
    if (this.ox !== this.ox) this.origin(x0, y0);
    x0 -= this.ox; y0 -= this.oy; x1 -= this.ox; y1 -= this.oy;
    if (!(Math.abs(x0) < 1e15 && Math.abs(y0) < 1e15 && Math.abs(x1) < 1e15 && Math.abs(y1) < 1e15)) { this.outside++; return; }
    const n = this.n, j = n * 4, s = this.s;
    s[j] = x0; s[j + 1] = y0; s[j + 2] = x1; s[j + 3] = y1;
    this.sl[n] = l; this.sk[n] = k; this.sc[n] = rgb < 0 ? 0 : this.colorIdx(rgb, l); this.se[n] = this.ent; this.n = n + 1;
    this.lc[l]++; this.lk[l * 16 + k]++;
    if (x0 < this.bx0) this.bx0 = x0; if (x0 > this.bx1) this.bx1 = x0; if (x1 < this.bx0) this.bx0 = x1; if (x1 > this.bx1) this.bx1 = x1;
    if (y0 < this.by0) this.by0 = y0; if (y0 > this.by1) this.by1 = y0; if (y1 < this.by0) this.by0 = y1; if (y1 > this.by1) this.by1 = y1;
  }
  triangle(x0, y0, x1, y1, x2, y2, l) {
    if (!this.o.fills) return;
    if (this.triL.n >= this.o.maxTris) { this.trFull = true; this.trDropped++; return; }
    if (this.ox !== this.ox) this.origin(x0, y0);
    const T = this.tri; T.room(6); const a = T.a; let n = T.n;
    a[n++] = x0 - this.ox; a[n++] = y0 - this.oy; a[n++] = x1 - this.ox; a[n++] = y1 - this.oy; a[n++] = x2 - this.ox; a[n++] = y2 - this.oy; T.n = n;
    const L = this.triL; L.room(1); L.a[L.n++] = l; this.lc[l]++; this.lk[l * 16 + 15]++;
    const E = this.triE; E.room(1); E.a[E.n++] = this.ent;
  }
  text(t) {
    if (this.texts.length >= this.o.maxTexts) { this.tFull = true; this.tDropped++; return; }
    if (this.ox !== this.ox) this.origin(t.x, t.y);
    t.x -= this.ox; t.y -= this.oy; if (this.ent !== 0xffffffff) t.ent = this.ent; this.texts.push(t); this.lc[t.layer]++; this.lk[t.layer * 16 + 14]++;
    if (t.x < this.bx0) this.bx0 = t.x; if (t.x > this.bx1) this.bx1 = t.x; if (t.y < this.by0) this.by0 = t.y; if (t.y > this.by1) this.by1 = t.y;
  }
  /** Fin d'une entité de premier niveau : sa boîte sert à trouver les feuilles. */
  mark() {
    if (this.bx0 <= this.bx1) {
      const B = this.bb; B.room(4); B.a[B.n++] = this.bx0; B.a[B.n++] = this.by0; B.a[B.n++] = this.bx1; B.a[B.n++] = this.by1;
      const F = this.bbF; F.room(1); F.a[F.n++] = this.rect;
    }
    this.rect = 0; this.resetBox();
  }
}

/** Vue transformée sur la sortie : applique la matrice, l'héritage calque « 0 » / BYBLOCK et le genre forcé. */
class View {
  constructor(P, m, ctxL, ctxC, depth, top, kind, stack) { this.P = P; this.m = m; this.ctxL = ctxL; this.ctxC = ctxC; this.depth = depth; this.top = top; this.kind = kind; this.stack = stack; }
  lay(l) { return l === this.P.layer0 && this.ctxL >= 0 ? this.ctxL : l; }
  col(c) { return c === BYBLOCK ? this.ctxC : c; }
  line(x0, y0, x1, y1, l, c, k) {
    const m = this.m;
    this.P.out.seg(m[0] * x0 + m[2] * y0 + m[4], m[1] * x0 + m[3] * y0 + m[5], m[0] * x1 + m[2] * y1 + m[4], m[1] * x1 + m[3] * y1 + m[5],
      this.lay(l), this.col(c), this.kind >= 0 ? this.kind : k);
  }
  arc(cx, cy, ux, uy, vx, vy, t0, t1, l, c, k) {
    const m = this.m, X = m[0] * cx + m[2] * cy + m[4], Y = m[1] * cx + m[3] * cy + m[5];
    const Ux = m[0] * ux + m[2] * uy, Uy = m[1] * ux + m[3] * uy, Vx = m[0] * vx + m[2] * vy, Vy = m[1] * vx + m[3] * vy;
    const r = Math.max(Math.hypot(Ux, Uy), Math.hypot(Vx, Vy)), sw = t1 - t0, n = arcSegs(r, sw, this.P.tol);
    const out = this.P.out, L = this.lay(l), C = this.col(c), kk = this.kind >= 0 ? this.kind : k;
    let px = X + Ux * Math.cos(t0) + Vx * Math.sin(t0), py = Y + Uy * Math.cos(t0) + Vy * Math.sin(t0);
    for (let i = 1; i <= n; i++) {
      const t = t0 + (sw * i) / n, co = Math.cos(t), si = Math.sin(t);
      const x = X + Ux * co + Vx * si, y = Y + Uy * co + Vy * si;
      out.seg(px, py, x, y, L, C, kk); px = x; py = y;
    }
  }
  tri(x0, y0, x1, y1, x2, y2, l) {
    const m = this.m;
    this.P.out.triangle(m[0] * x0 + m[2] * y0 + m[4], m[1] * x0 + m[3] * y0 + m[5], m[0] * x1 + m[2] * y1 + m[4], m[1] * x1 + m[3] * y1 + m[5],
      m[0] * x2 + m[2] * y2 + m[4], m[1] * x2 + m[3] * y2 + m[5], this.lay(l));
  }
  text(t) {
    const m = this.m, ux = m[0] * t.ux + m[2] * t.uy, uy = m[1] * t.ux + m[3] * t.uy, vx = m[0] * t.vx + m[2] * t.vy, vy = m[1] * t.vx + m[3] * t.vy;
    const layer = this.lay(t.layer), c = this.col(t.color);
    const o = { x: m[0] * t.x + m[2] * t.y + m[4], y: m[1] * t.x + m[3] * t.y + m[5], h: Math.hypot(vx, vy), rot: Math.atan2(uy, ux), text: t.text, layer, ha: t.ha, va: t.va };
    o.color = c < 0 ? 0 : this.P.out.colorIdx(c, layer);
    if (ux * vy - uy * vx < 0) o.mirror = true;
    if (this.top) o.block = this.top;
    if (t.tag) o.tag = t.tag;
    this.P.out.text(o);
  }
  insert(name, m6, l, c, attribs, kind) {
    const P = this.P, b = P.blocks.get(name) || P.blocks.get(String(name).toUpperCase());
    if (!b) { P.warn('missingBlock', 1, name); return; }
    if (P.out.full) { P.out.dropped++; return; }
    if (this.depth >= P.o.maxDepth) { P.warn('depth', 1, name); return; }
    if (this.stack.includes(b)) { P.warn('recursion', 1, name); return; }
    const L = this.lay(l), C = c === BYLAYER ? P.layerRgb(L) : c === BYBLOCK ? this.ctxC : c;
    const m = mul(this.m, mul(m6, [1, 0, 0, 1, -b.bx, -b.by]));
    P.play(b, new View(P, m, L, C, this.depth + 1, this.top || b.name, kind >= 0 ? kind : this.kind, [...this.stack, b]));
  }
}

/* ---------- analyseur ---------- */
const SEC = { HEADER: 1, TABLES: 2, BLOCKS: 3, ENTITIES: 4, OBJECTS: 5, CLASSES: 6, THUMBNAILIMAGE: 7, ACDSDATA: 8 };
// Entités dessinées ; les autres sont comptées (diagnostic « notDrawn ») et ignorées.
const DRAWN = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'CIRCLE', 'ELLIPSE', 'SPLINE', 'TEXT', 'ATTDEF', 'MTEXT', 'INSERT', 'DIMENSION',
  'ACAD_TABLE', 'HATCH', 'SOLID', 'TRACE', '3DFACE', 'LEADER', 'MLINE']);
// Niveau des avertissements historiques (stats.warnings) repris dans les diagnostics.
const WARN_LEVEL = { missingBlock: 'warning', depth: 'warning', recursion: 'warning', minsert: 'warning', fillHoles: 'info', budget: 'warning', textBudget: 'warning', fillBudget: 'warning' };
const PER_SAMPLE = new Set(['notDrawn', 'undefinedLayer', 'missingBlock', 'degenerate', 'unknownGroupCode', 'unknownSection']);
const LEVELS = { error: 0, warning: 1, info: 2 };
const HDR = new Set(['$ACADVER', '$DWGCODEPAGE', '$INSUNITS', '$MEASUREMENT', '$EXTMIN', '$EXTMAX', '$INSBASE']);

class Parser {
  constructor(o) {
    this.o = o; this.str = new Strings(); this.str.setCodepage('ANSI_1252');
    this.sec = 0; this.wantSec = false; this.var = null; this.hdr = {};
    this.rt = null; this.rn = 0; this.rc = new Int32Array(1024); this.rv = new Float64Array(1024); this.rs = []; this.skip = false;
    this.layers = []; this.lmap = new Map(); this.blocks = new Map(); this.blk = null; this.paperBlk = false;
    this.byType = Object.create(null); this.entities = 0; this.warns = new Map();
    this.out = new Out(o); this.out.layers = this.layers; this.inited = false; this.layer0 = -1;
    this.poly = null; this.pins = null; this.world = null;
    this.diags = new Map(); this.ln = -1; this.recLn = -1; this.binary = false; this.eof = false; this.afterEof = 0;
    this.handles = new Grow(Float64Array, 4096); this.hseen = false; this.rtype = null; this.inBlock = false; this.sawHeader = false; this.secName = '';
  }
  /** Diagnostic : { level: 'error'|'warning'|'info', code, n, sample, line (ASCII) | offset (binaire) } — premier cas gardé. */
  diag(level, code, sample = '', n = 1, line = this.recLn) {
    let key = PER_SAMPLE.has(code) ? code + '\0' + sample : code;
    if (!this.diags.has(key) && this.diags.size > 400) key = code;
    let d = this.diags.get(key);
    if (!d) { d = { level, code, n: 0, sample: String(sample ?? '').slice(0, 120) }; if (line >= 0) d[this.binary ? 'offset' : 'line'] = line; this.diags.set(key, d); }
    d.n += n;
  }
  bad(level, code, sample, line) { if (!this.eof) this.diag(level, code, sample, 1, line); }
  warn(code, n = 1, sample = '') { this.warns.set(code, (this.warns.get(code) || 0) + n); this.diag(WARN_LEVEL[code] || 'warning', code, sample, n); }
  layerRgb(l) { const L = this.layers[l]; return L ? L.rgb : 0xffffff; }
  layerId(name) {
    name = name == null || name === '' ? '0' : name;
    let id = this.lmap.get(name);
    if (id === undefined) id = this.lmap.get(name.toUpperCase());
    if (id === undefined) {
      id = this.addLayer({ name, aci: 7, rgb: 0xffffff, ltype: 'Continuous', off: false, frozen: false, locked: false });
      // permis par la référence (calque créé couleur 7, CONTINUOUS), mais signalé
      if (name !== '0') this.diag('info', 'undefinedLayer', name);
    }
    return id;
  }
  addLayer(L) {
    if (this.layers.length >= 65535) return 0;
    const id = this.layers.length; L.id = id; this.layers.push(L);
    this.lmap.set(L.name, id); if (!this.lmap.has(L.name.toUpperCase())) this.lmap.set(L.name.toUpperCase(), id);
    if (this.out.lc) { if (this.layers.length > this.out.lc.length) { const lc = new Uint32Array(this.layers.length * 2); lc.set(this.out.lc); this.out.lc = lc; const lk = new Uint32Array(this.layers.length * 32); lk.set(this.out.lk); this.out.lk = lk; } }
    else if (this.inited) this.allocCounts();
    if (L.name === '0') this.layer0 = id;
    return id;
  }
  allocCounts() { this.out.lc = new Uint32Array(this.layers.length + 64); this.out.lk = new Uint32Array((this.layers.length + 64) * 16); }

  /** Réglages tirés de l'en-tête (unités, tolérance, origine), au plus tard avant la première entité. */
  init() {
    if (this.inited) return; this.inited = true;
    const h = this.hdr, iu = h.$INSUNITS?.[70] ?? 0, mes = h.$MEASUREMENT?.[70] ?? -1;
    const u = INSUNITS[iu] || INSUNITS[0];
    const e0 = h.$EXTMIN, e1 = h.$EXTMAX;
    const okE = e0 && e1 && [e0[10], e0[20], e1[10], e1[20]].every(v => Number.isFinite(v) && Math.abs(v) < 1e15) && e1[10] >= e0[10] && e1[20] >= e0[20];
    let toMetre = u[1], guessed = false;
    if (iu && !INSUNITS[iu]) this.diag('warning', 'badUnits', String(iu), 1, -1);
    if (!iu || !INSUNITS[iu]) { guessed = true; const d = okE ? Math.hypot(e1[10] - e0[10], e1[20] - e0[20]) : 0; toMetre = mes === 0 ? (d > 3000 ? 0.0254 : 0.3048) : d > 5000 ? 0.001 : 1; }
    if (guessed) this.diag('warning', 'unitsGuessed', (h.$INSUNITS ? '$INSUNITS = 0' : '$INSUNITS absent') + ' → ' + toMetre + ' m', 1, -1);
    if (!this.sawHeader) this.diag('info', 'noHeader', '', 1, -1);
    else if (!h.$ACADVER) this.diag('info', 'noVersion', '', 1, -1);
    this.units = iu && INSUNITS[iu] ? u[0] : 'unitless'; this.toMetre = toMetre; this.unitsGuessed = guessed; this.insunits = iu; this.measurement = mes;
    this.tol = this.o.tol > 0 ? this.o.tol : 0.002 / toMetre;
    if (okE) this.out.origin((e0[10] + e1[10]) / 2, (e0[20] + e1[20]) / 2);
    if (this.layer0 < 0) this.layerId('0');
    this.allocCounts();
    this.world = new View(this, ID, -1, -1, 0, null, -1, []);
  }

  group(c, v, s) {
    if (this.eof) { this.afterEof++; return; }
    if (c === 0) { this.flush(); this.recLn = this.ln; this.start(s); return; }
    // poignée propre de l'enregistrement (105 pour DIMSTYLE), pour repérer les doublons
    if ((c === 5 || c === 105) && !this.hseen && this.sec >= 2 && this.sec <= 5 && (c === 105) === (this.rtype === 'DIMSTYLE')) {
      this.hseen = true; if (v === v) { const H = this.handles; H.room(1); H.a[H.n++] = v; }
    }
    if (this.sec === SEC.HEADER) {
      if (c === 9) { this.var = HDR.has(s) ? s : null; if (this.var) this.hdr[this.var] = {}; return; }
      if (this.var) {
        this.hdr[this.var][c] = s ?? v;
        if (this.var === '$DWGCODEPAGE' && c === 3) this.str.setCodepage(s);
      }
      return;
    }
    if (this.wantSec) {
      if (c === 2) { this.sec = SEC[s] || 9; this.secName = s; this.wantSec = false; if (this.sec === 9) this.diag('info', 'unknownSection', s); if (this.sec === 1) this.sawHeader = true; }
      return;
    }
    if (this.skip) return;
    if (c === 101) { this.skip = true; return; } // objet incorporé : la suite ne concerne pas le dessin
    if (this.rn === this.rc.length) { const n = this.rn * 2; const a = new Int32Array(n); a.set(this.rc); this.rc = a; const b = new Float64Array(n); b.set(this.rv); this.rv = b; }
    this.rc[this.rn] = c; this.rv[this.rn] = v; this.rs[this.rn] = s; this.rn++;
  }
  start(type) {
    this.rt = type; this.rtype = type; this.hseen = false; this.rn = 0; this.skip = false;
    if (type === 'SECTION') {
      if (this.sec !== 0 || this.wantSec) this.diag('error', 'unbalancedSection', 'SECTION dans ' + (this.secName || '?'));
      this.endSec(); this.wantSec = true; this.rt = null; return;
    }
    if (type === 'ENDSEC' || type === 'EOF') {
      if (type === 'ENDSEC' && this.sec === 0) this.diag('error', 'unbalancedSection', 'ENDSEC sans SECTION');
      if (type === 'EOF' && this.sec !== 0) this.diag('error', 'unterminatedSection', this.secName);
      this.endSec(); this.sec = 0; this.secName = ''; this.rt = null; if (type === 'EOF') this.eof = true; return;
    }
    if (this.sec === 0) this.diag('warning', 'outsideSection', type);
    if (this.sec >= 5 || this.sec === 0 || this.sec === SEC.HEADER) { this.skip = true; this.rt = null; return; }
    if (this.sec === SEC.TABLES && type !== 'LAYER') { this.skip = true; this.rt = null; }
  }
  endSec() {
    if (this.sec === SEC.HEADER) {
      const v = String(this.hdr.$ACADVER?.[1] || '');
      this.version = v;
      if (this.hdr.$DWGCODEPAGE) this.str.setCodepage(this.hdr.$DWGCODEPAGE[3]);
      this.init();
    }
    if (this.sec === SEC.ENTITIES || this.sec === SEC.BLOCKS) this.flushPending(this.sec === SEC.ENTITIES ? this.world : this.blk);
    if (this.sec === SEC.ENTITIES) this.out.mark();
    if (this.sec === SEC.BLOCKS && this.inBlock) { this.diag('error', 'unclosedBlock', this.blk ? this.blk.name : ''); if (this.blk) this.blk.done(); this.blk = null; this.inBlock = false; this.paperBlk = false; }
  }
  flush() {
    const t = this.rt; if (t === null) return; this.rt = null;
    if (this.sec === SEC.TABLES) { if (t === 'LAYER') this.tableLayer(); return; }
    this.init();
    this.byType[t] = (this.byType[t] || 0) + 1;
    if (this.sec === SEC.BLOCKS) {
      if (t === 'BLOCK') {
        if (this.inBlock) { this.diag('error', 'unclosedBlock', this.blk ? this.blk.name : ''); if (this.blk) { this.flushPending(this.blk); this.blk.done(); } }
        this.inBlock = true; this.beginBlock(); return;
      }
      if (t === 'ENDBLK') {
        if (!this.inBlock) this.diag('error', 'orphanEndblk');
        if (this.blk) this.flushPending(this.blk); if (this.blk) this.blk.done(); this.blk = null; this.paperBlk = false; this.inBlock = false; return;
      }
      if (!this.inBlock) { this.diag('error', 'entityOutsideBlock', t); return; }
      if (this.blk && !this.paperBlk) { this.blk.count++; this.entity(t, this.blk, false); }
      else if (this.paperBlk) { this.flushPending(null); this.diag('info', 'paperSpace', t); }
      return;
    }
    if (this.sec === SEC.ENTITIES) this.entity(t, this.world, true);
    else this.diag('info', 'ignoredRecord', t);
  }

  /* --- tables --- */
  tableLayer() {
    let name = '0', aci = 7, rgb = -1, lt = 'Continuous', fl = 0;
    for (let i = 0; i < this.rn; i++) {
      const c = this.rc[i];
      if (c === 2) name = this.rs[i]; else if (c === 62) aci = this.rv[i]; else if (c === 420) rgb = this.rv[i] & 0xffffff;
      else if (c === 6) lt = this.rs[i]; else if (c === 70) fl = this.rv[i];
    }
    const L = { name, aci: Math.abs(aci) || 7, rgb: rgb >= 0 ? rgb : aciRgb(aci || 7), ltype: lt, off: aci < 0, frozen: !!(fl & 1), locked: !!(fl & 4) };
    const id = this.lmap.get(name);
    if (id !== undefined && this.layers[id].name === name) { if (this.layers[id].fromTable) this.diag('warning', 'duplicateLayer', name); Object.assign(this.layers[id], L, { id }); }
    else this.addLayer(L);
    this.layers[this.lmap.get(name)].fromTable = true;
  }

  /* --- blocs --- */
  beginBlock() {
    let name = '', fl = 0, bx = 0, by = 0;
    for (let i = 0; i < this.rn; i++) {
      const c = this.rc[i];
      if (c === 2) name = this.rs[i]; else if (c === 3 && !name) name = this.rs[i]; else if (c === 70) fl = this.rv[i]; else if (c === 10) bx = this.rv[i]; else if (c === 20) by = this.rv[i];
    }
    const up = name.toUpperCase();
    this.paperBlk = up.startsWith('*PAPER_SPACE') || up.startsWith('*MODEL_SPACE');
    if (this.paperBlk) { this.blk = null; return; }
    const b = new Prims(name, fl); b.bx = bx; b.by = by;
    if (this.blocks.has(name)) this.diag('warning', 'duplicateBlock', name);
    if (!name) this.diag('error', 'unnamedBlock');
    this.blocks.set(name, b); if (!this.blocks.has(up)) this.blocks.set(up, b);
    this.blk = b;
  }
  /** Rejoue un bloc compilé dans une vue. */
  play(b, V) {
    const out = this.out;
    let a = b.L.a, m = b.Lm.a;
    for (let i = 0, j = 0, n = b.L.n; i < n; i += 4, j += 3) { if (out.full) return; V.line(a[i], a[i + 1], a[i + 2], a[i + 3], m[j], m[j + 1], m[j + 2]); }
    a = b.A.a; m = b.Am.a;
    for (let i = 0, j = 0, n = b.A.n; i < n; i += 8, j += 3) { if (out.full) return; V.arc(a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5], a[i + 6], a[i + 7], m[j], m[j + 1], m[j + 2]); }
    a = b.T.a; m = b.Tm.a;
    for (let i = 0, j = 0, n = b.T.n; i < n; i += 6, j += 2) V.tri(a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5], m[j]);
    for (const t of b.texts) V.text(t);
    for (const s of b.ins) V.insert(s.name, s.m, s.l, s.c, null, s.kind);
  }

  /* --- entités --- */
  common() {
    let l = '0', c = BYLAYER, rgb = -1, nx = 0, ny = 0, nz = 1, paper = 0, inv = 0, h = NaN;
    for (let i = 0; i < this.rn; i++) {
      switch (this.rc[i]) {
        case 5: if (h !== h) h = this.rv[i]; break;
        case 8: l = this.rs[i]; break;
        case 62: c = this.rv[i]; break;
        case 420: rgb = this.rv[i] & 0xffffff; break;
        case 210: nx = this.rv[i]; break; case 220: ny = this.rv[i]; break; case 230: nz = this.rv[i]; break;
        case 67: paper = this.rv[i]; break;
        case 60: inv = this.rv[i]; break;
      }
    }
    const col = rgb >= 0 ? rgb : c === 256 ? BYLAYER : c === 0 ? BYBLOCK : (c >= 1 && c <= 255) ? ACI[c] : BYLAYER;
    const flat = Math.abs(nx) < 1e-12 && Math.abs(ny) < 1e-12 && nz > 0;
    return { l: this.layerId(l), c: col, o: flat ? null : ocsOf(nx, ny, nz), paper, inv, h };
  }
  flushPending(S) {
    if (this.poly) { const p = this.poly; this.poly = null; if (S) { if (p.ent !== undefined) this.out.ent = p.ent; this.polyEmit(p, S); if (S === this.world) this.out.mark(); } }
    if (this.pins) { const p = this.pins; this.pins = null; if (S) { if (p.ent !== undefined) this.out.ent = p.ent; this.insEmit(p, S); if (S === this.world) this.out.mark(); } }
  }
  entity(t, S, top) {
    if (this.poly) { if (t === 'VERTEX') { this.vertex(); return; } if (t !== 'SEQEND') this.diag('info', 'missingSeqend', 'POLYLINE'); this.flushPending(S); if (t === 'SEQEND') return; }
    if (this.pins) { if (t === 'ATTRIB') { this.attrib(); return; } if (t !== 'SEQEND') this.diag('info', 'missingSeqend', 'INSERT'); this.flushPending(S); if (t === 'SEQEND') return; }
    if (t === 'SEQEND' || t === 'VERTEX' || t === 'ATTRIB') { this.diag('warning', 'orphan', t); return; }
    const e = this.common();
    if (top && e.paper) { this.diag('info', 'paperSpace', t); if (t === 'POLYLINE' || (t === 'INSERT' && this.insFollows())) this.poly = t === 'POLYLINE' ? { skip: true, v: [] } : null; if (t === 'INSERT' && this.insFollows()) this.pins = { skip: true, attribs: [] }; return; }
    if (e.inv === 1) { this.diag('info', 'invisible', t); if (t === 'POLYLINE') this.poly = { skip: true, v: [] }; if (t === 'INSERT' && this.insFollows()) this.pins = { skip: true, attribs: [] }; return; }
    if (!DRAWN.has(t)) { this.diag('info', 'notDrawn', t); return; }
    if (top) { this.entities++; this.out.newEnt(e.h, t, e.l); }
    switch (t) {
      case 'LINE': this.eLine(e, S); break;
      case 'LWPOLYLINE': this.eLw(e, S); break;
      case 'POLYLINE': this.poly = this.polyHead(e); if (top) this.poly.ent = this.out.ent; return;
      case 'ARC': case 'CIRCLE': this.eArc(t, e, S); break;
      case 'ELLIPSE': this.eEllipse(e, S); break;
      case 'SPLINE': this.eSpline(e, S); break;
      case 'TEXT': this.eText(e, S, false); break;
      case 'ATTDEF': if (top) this.eText(e, S, true); break;
      case 'MTEXT': this.eMtext(e, S); break;
      case 'INSERT': { const p = this.insHead(e); if (p.follow) { this.pins = p; if (top) p.ent = this.out.ent; return; } this.insEmit(p, S); break; }
      case 'DIMENSION': this.eDim(e, S); break;
      case 'ACAD_TABLE': this.eTable(e, S); break;
      case 'HATCH': this.eHatch(e, S); break;
      case 'SOLID': case 'TRACE': this.eSolid(e, S); break;
      case '3DFACE': this.eFace(e, S); break;
      case 'LEADER': this.eLeader(e, S); break;
      case 'MLINE': this.eMline(e, S); break;
      default: return;
    }
    if (top) this.out.mark();
  }
  insFollows() { for (let i = 0; i < this.rn; i++) if (this.rc[i] === 66) return this.rv[i] === 1; return false; }
  degen(t) { this.diag('info', 'degenerate', t); }
  /** Point OCS → XY du SCG. */
  P(e, x, y, z = 0) { const o = e.o; return o ? [x * o[0] + y * o[2] + z * o[4], x * o[1] + y * o[3] + z * o[5]] : [x, y]; }
  V(e, x, y) { const o = e.o; return o ? [x * o[0] + y * o[2], x * o[1] + y * o[3]] : [x, y]; }
  /** Arc OCS (centre, rayon, angles en radians) envoyé à la vue S. */
  arcO(S, e, cx, cy, z, r, t0, t1, k, l = e.l, c = e.c) {
    const C = this.P(e, cx, cy, z), U = this.V(e, r, 0), W = this.V(e, 0, r);
    S.arc(C[0], C[1], U[0], U[1], W[0], W[1], t0, t1, l, c, k);
  }
  /** Polyligne OCS avec renflements : pts [x, y, bulge, …]. */
  polyO(S, e, pts, closed, z, k) {
    const n = pts.length / 3, last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n, x0 = pts[i * 3], y0 = pts[i * 3 + 1], b = pts[i * 3 + 2], x1 = pts[j * 3], y1 = pts[j * 3 + 1];
      if (Math.abs(b) > 1e-9) { const a = bulgeArc(x0, y0, x1, y1, b); if (a) { this.arcO(S, e, a[0], a[1], z, a[2], a[3], a[4], k); continue; } }
      const p = this.P(e, x0, y0, z), q = this.P(e, x1, y1, z);
      if (p[0] !== q[0] || p[1] !== q[1]) S.line(p[0], p[1], q[0], q[1], e.l, e.c, k);
    }
  }
  /** Rectangle fermé aux axes (cadre de feuille possible) : pts [x, y, bulge, …]. */
  isRect(pts, closed) {
    let n = pts.length / 3;
    if (n === 5 && pts[0] === pts[12] && pts[1] === pts[13]) { n = 4; closed = true; }
    if (n !== 4 || !closed) return false;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, dx = pts[j * 3] - pts[i * 3], dy = pts[j * 3 + 1] - pts[i * 3 + 1];
      if (pts[i * 3 + 2] || (Math.abs(dx) > 1e-9 * (1 + Math.abs(dy)) && Math.abs(dy) > 1e-9 * (1 + Math.abs(dx)))) return false;
    }
    return true;
  }
  eLine(e, S) {
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    for (let i = 0; i < this.rn; i++) { switch (this.rc[i]) { case 10: x0 = this.rv[i]; break; case 20: y0 = this.rv[i]; break; case 11: x1 = this.rv[i]; break; case 21: y1 = this.rv[i]; break; } }
    if (x0 === x1 && y0 === y1) { this.degen('LINE'); return; }
    S.line(x0, y0, x1, y1, e.l, e.c, K.line);
  }
  eLw(e, S) {
    const pts = []; let fl = 0, z = 0;
    for (let i = 0; i < this.rn; i++) {
      const c = this.rc[i], v = this.rv[i];
      if (c === 10) pts.push(v, 0, 0); else if (c === 20) pts[pts.length - 2] = v; else if (c === 42 && pts.length) pts[pts.length - 1] = v;
      else if (c === 70) fl = v; else if (c === 38) z = v;
    }
    if (pts.length >= 6) { this.polyO(S, e, pts, !!(fl & 1), z, K.poly); if (S === this.world && !e.o && this.isRect(pts, !!(fl & 1))) this.out.rect = 1; }
    else this.degen('LWPOLYLINE');
  }
  polyHead(e) {
    let fl = 0, z = 0, m = 0, n = 0;
    for (let i = 0; i < this.rn; i++) { const c = this.rc[i], v = this.rv[i]; if (c === 70) fl = v; else if (c === 30) z = v; else if (c === 71) m = v; else if (c === 72) n = v; }
    return { e, fl, z, m, n, v: [], f: [] };
  }
  vertex() {
    const p = this.poly; if (p.skip) return;
    let x = 0, y = 0, z = 0, b = 0, fl = 0; const idx = [0, 0, 0, 0];
    for (let i = 0; i < this.rn; i++) {
      switch (this.rc[i]) {
        case 10: x = this.rv[i]; break; case 20: y = this.rv[i]; break; case 30: z = this.rv[i]; break; case 42: b = this.rv[i]; break;
        case 70: fl = this.rv[i]; break; case 71: idx[0] = this.rv[i]; break; case 72: idx[1] = this.rv[i]; break; case 73: idx[2] = this.rv[i]; break; case 74: idx[3] = this.rv[i]; break;
      }
    }
    if (p.fl & 64) { if ((fl & 128) && !(fl & 64)) p.f.push(idx); else p.v.push(x, y, 0); return; }
    if (fl & 16) return; // cadre de contrôle d'une polyligne lissée
    if (p.v.length > 3e6) return;
    p.v.push(x, y, b); void z;
  }
  polyEmit(p, S) {
    if (p.skip) return;
    const e = p.e, v = p.v;
    if (p.fl & 64) { // maillage polyface : arêtes visibles
      const nv = v.length / 3;
      for (const f of p.f) {
        const ids = f.filter(i => i !== 0);
        for (let i = 0; i < ids.length; i++) {
          const a = ids[i], b = ids[(i + 1) % ids.length]; if (a < 0) continue;
          const ia = Math.abs(a) - 1, ib = Math.abs(b) - 1; if (ia >= nv || ib >= nv) continue;
          S.line(v[ia * 3], v[ia * 3 + 1], v[ib * 3], v[ib * 3 + 1], e.l, e.c, K.mesh);
        }
      }
      return;
    }
    if (p.fl & 16) { // maillage M×N
      const M = p.m, N = p.n; if (M * N * 3 > v.length) return;
      const at = (i, j) => (i * N + j) * 3;
      for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) {
        const a = at(i, j);
        if (j + 1 < N || p.fl & 32) { const b = at(i, (j + 1) % N); S.line(v[a], v[a + 1], v[b], v[b + 1], e.l, e.c, K.mesh); }
        if (i + 1 < M || p.fl & 1) { const b = at((i + 1) % M, j); S.line(v[a], v[a + 1], v[b], v[b + 1], e.l, e.c, K.mesh); }
      }
      return;
    }
    if (p.fl & 8) { const n = v.length / 3, last = p.fl & 1 ? n : n - 1; for (let i = 0; i < last; i++) { const j = (i + 1) % n; S.line(v[i * 3], v[i * 3 + 1], v[j * 3], v[j * 3 + 1], e.l, e.c, K.poly); } return; }
    if (v.length < 6) { this.degen('POLYLINE'); return; }
    if (v.length >= 6) { this.polyO(S, e, v, !!(p.fl & 1), p.z, K.poly); if (S === this.world && !e.o && this.isRect(v, !!(p.fl & 1))) this.out.rect = 1; }
  }
  eArc(t, e, S) {
    let x = 0, y = 0, z = 0, r = 0, a0 = 0, a1 = 360;
    for (let i = 0; i < this.rn; i++) { switch (this.rc[i]) { case 10: x = this.rv[i]; break; case 20: y = this.rv[i]; break; case 30: z = this.rv[i]; break; case 40: r = this.rv[i]; break; case 50: a0 = this.rv[i]; break; case 51: a1 = this.rv[i]; break; } }
    if (!(r > 0)) { this.degen(t); return; }
    if (t === 'CIRCLE') { this.arcO(S, e, x, y, z, r, 0, TAU, K.circle); return; }
    let t0 = a0 * D2R, t1 = a1 * D2R; while (t1 <= t0) t1 += TAU; while (t1 - t0 > TAU) t1 -= TAU;
    this.arcO(S, e, x, y, z, r, t0, t1, K.arc);
  }
  eEllipse(e, S) {
    let x = 0, y = 0, mx = 1, my = 0, mz = 0, ra = 1, p0 = 0, p1 = TAU, nx = 0, ny = 0, nz = 1;
    for (let i = 0; i < this.rn; i++) {
      const v = this.rv[i];
      switch (this.rc[i]) {
        case 10: x = v; break; case 20: y = v; break; case 11: mx = v; break; case 21: my = v; break; case 31: mz = v; break;
        case 40: ra = v; break; case 41: p0 = v; break; case 42: p1 = v; break; case 210: nx = v; break; case 220: ny = v; break; case 230: nz = v; break;
      }
    }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const vx = ra * (ny * mz - nz * my), vy = ra * (nz * mx - nx * mz); // petit axe = ratio · (N × grand axe)
    while (p1 <= p0) p1 += TAU; while (p1 - p0 > TAU + 1e-9) p1 -= TAU;
    S.arc(x, y, mx, my, vx, vy, p0, p1, e.l, e.c, K.ellipse);
  }
  eSpline(e, S) {
    let deg = 3, fl = 0; const knots = [], ctrl = [], w = [], fit = [];
    for (let i = 0; i < this.rn; i++) {
      const c = this.rc[i], v = this.rv[i];
      if (c === 71) deg = v; else if (c === 70) fl = v; else if (c === 40) knots.push(v); else if (c === 41) w.push(v);
      else if (c === 10) ctrl.push(v, 0); else if (c === 20) ctrl[ctrl.length - 1] = v; else if (c === 11) fit.push(v, 0); else if (c === 21) fit[fit.length - 1] = v;
    }
    const pts = splinePoints({ degree: deg, knots, ctrl, weights: w, fit, closed: !!(fl & 1) }, this.tol);
    if (pts.length < 4) { this.degen('SPLINE'); return; }
    for (let i = 2; i < pts.length; i += 2) S.line(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], e.l, e.c, K.spline);
  }
  /** TEXT, ATTRIB, ATTDEF : point d'insertion ou d'alignement, hauteur, rotation, justification. */
  textOf(e, attr) {
    let x = 0, y = 0, z = 0, ax = NaN, ay = 0, h = 1, r = 0, hj = 0, vj = 0, txt = '', tag = '', fl = 0, wf = 1, mir = 0;
    for (let i = 0; i < this.rn; i++) {
      const c = this.rc[i], v = this.rv[i];
      switch (c) {
        case 10: x = v; break; case 20: y = v; break; case 30: z = v; break; case 11: ax = v; break; case 21: ay = v; break;
        case 40: h = v; break; case 50: r = v; break; case 72: hj = v; break; case 41: wf = v; break;
        case 73: if (!attr) vj = v; break; case 74: if (attr) vj = v; break;
        case 1: txt = this.rs[i] ?? ''; break; case 2: tag = this.rs[i] ?? ''; break; case 70: fl = v; break; case 71: mir = v; break;
      }
    }
    void wf;
    const useA = (hj || vj) && hj !== 3 && hj !== 5 && ax === ax;
    const [px, py] = this.P(e, useA ? ax : x, useA ? ay : y, z);
    const co = Math.cos(r * D2R), si = Math.sin(r * D2R);
    let [ux, uy] = this.V(e, co * h, si * h), [vx, vy] = this.V(e, -si * h, co * h);
    if (mir & 2) { ux = -ux; uy = -uy; } if (mir & 4) { vx = -vx; vy = -vy; }
    const ha = hj === 4 ? 1 : hj === 1 || hj === 2 ? hj : 0, va = hj === 4 ? 2 : vj;
    return { x: px, y: py, ux, uy, vx, vy, text: stripText(txt).slice(0, 2000), layer: e.l, color: e.c, ha, va, tag, fl };
  }
  eText(e, S, def) {
    const t = this.textOf(e, def); if (def) { t.text = t.tag; } delete t.fl;
    if (!t.tag) delete t.tag;
    if (t.text) S.text(t); else this.degen(def ? 'ATTDEF' : 'TEXT');
  }
  eMtext(e, S) {
    let x = 0, y = 0, h = 1, r = 0, att = 1, dx = NaN, dy = 0, txt = '';
    for (let i = 0; i < this.rn; i++) {
      const c = this.rc[i], v = this.rv[i];
      switch (c) {
        case 10: x = v; break; case 20: y = v; break; case 40: h = v; break; case 50: r = v; break; case 71: att = v; break;
        case 11: dx = v; break; case 21: dy = v; break; case 1: case 3: txt += this.rs[i] ?? ''; break;
      }
    }
    let ux, uy;
    if (dx === dx && (dx || dy)) { const l = Math.hypot(dx, dy); ux = dx / l; uy = dy / l; }
    else [ux, uy] = this.V(e, Math.cos(r * D2R), Math.sin(r * D2R));
    // haut du texte : direction tournée de +90° (sens inverse si l'OCS est en miroir, N = -Z)
    const sg = e.o && e.o[0] * e.o[3] - e.o[1] * e.o[2] < 0 ? -1 : 1;
    const vx = -uy * sg, vy = ux * sg;
    const text = stripMtext(txt).slice(0, 4000); if (!text.trim()) { this.degen('MTEXT'); return; }
    const a = Math.min(9, Math.max(1, att)) - 1;
    S.text({ x, y, ux: ux * h, uy: uy * h, vx: vx * h, vy: vy * h, text, layer: e.l, color: e.c, ha: a % 3, va: 3 - Math.floor(a / 3) });
  }
  insHead(e) {
    let name = '', x = 0, y = 0, z = 0, sx = 1, sy = 1, r = 0, cols = 1, rows = 1, cs = 0, rs = 0, follow = 0;
    for (let i = 0; i < this.rn; i++) {
      const c = this.rc[i], v = this.rv[i];
      switch (c) {
        case 2: name = this.rs[i]; break; case 10: x = v; break; case 20: y = v; break; case 30: z = v; break;
        case 41: sx = v; break; case 42: sy = v; break; case 50: r = v; break; case 66: follow = v; break;
        case 70: cols = v; break; case 71: rows = v; break; case 44: cs = v; break; case 45: rs = v; break;
      }
    }
    return { e, name, x, y, z, sx: sx || 1, sy: sy || 1, r, cols: Math.max(1, cols | 0), rows: Math.max(1, rows | 0), cs, rs, follow, attribs: [] };
  }
  attrib() { const p = this.pins; if (p.skip) return; const e = this.common(); const t = this.textOf(e, true); p.attribs.push({ t, e }); }
  insEmit(p, S) {
    if (p.skip) return;
    const e = p.e, co = Math.cos(p.r * D2R), si = Math.sin(p.r * D2R);
    const o = e.o || [1, 0, 0, 1, 0, 0];
    let n = p.cols * p.rows;
    if (n > this.o.maxArray) { this.warn('minsert', n); n = 1; p.cols = p.rows = 1; }
    for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
      const ox = p.x + co * c * p.cs - si * r * p.rs, oy = p.y + si * c * p.cs + co * r * p.rs; // décalage du réseau, tourné, non mis à l'échelle
      const local = [co * p.sx, si * p.sx, -si * p.sy, co * p.sy, ox, oy];
      const ocs = [o[0], o[1], o[2], o[3], p.z * o[4], p.z * o[5]];
      S.insert(p.name, mul(ocs, local), e.l, e.c, null, -1);
    }
    const attribs = {};
    for (const { t, e: ae } of p.attribs) {
      if (t.tag) attribs[t.tag] = t.text;
      if (!(t.fl & 1) && t.text) { const { fl, ...u } = t; void fl; u.layer = ae.l; u.color = ae.c; S.text(u); }
    }
    if (S === this.world) {
      const [wx, wy] = this.P(e, p.x, p.y, p.z), ox = this.out.ox === this.out.ox ? this.out.ox : 0, oy = this.out.oy === this.out.oy ? this.out.oy : 0;
      if (this.out.inserts.length < 2e5) this.out.inserts.push({ name: p.name, x: wx - ox, y: wy - oy, rot: p.r, sx: p.sx, sy: p.sy, layer: e.l, attribs });
    }
  }
  eDim(e, S) {
    let name = '', x3 = 0, y3 = 0, x4 = 0, y4 = 0, has = false;
    for (let i = 0; i < this.rn; i++) { const c = this.rc[i], v = this.rv[i]; if (c === 2) name = this.rs[i]; else if (c === 13) { x3 = v; has = true; } else if (c === 23) y3 = v; else if (c === 14) x4 = v; else if (c === 24) y4 = v; }
    if (name && (this.blocks.has(name) || this.blocks.has(name.toUpperCase()))) S.insert(name, ID, e.l, e.c, null, K.dim);
    else if (has) S.line(x3, y3, x4, y4, e.l, e.c, K.dim);
  }
  eTable(e, S) {
    let name = '', x = 0, y = 0;
    for (let i = 0; i < this.rn; i++) { const c = this.rc[i]; if (c === 2 && !name) name = this.rs[i]; else if (c === 10) x = this.rv[i]; else if (c === 20) y = this.rv[i]; }
    if (name) S.insert(name, [1, 0, 0, 1, x, y], e.l, e.c, null, K.table);
  }
  eSolid(e, S) {
    const p = [0, 0, 0, 0, 0, 0, 0, 0]; let z = 0, has3 = false;
    for (let i = 0; i < this.rn; i++) {
      const c = this.rc[i], v = this.rv[i];
      if (c >= 10 && c <= 13) p[(c - 10) * 2] = v; else if (c >= 20 && c <= 23) p[(c - 20) * 2 + 1] = v; else if (c === 30) z = v;
      if (c === 13) has3 = true;
    }
    if (!has3) { p[6] = p[4]; p[7] = p[5]; }
    const q = []; for (let i = 0; i < 4; i++) q.push(this.P(e, p[i * 2], p[i * 2 + 1], z));
    const ring = [q[0], q[1], q[3], q[2]];
    for (let i = 0; i < 4; i++) { const a = ring[i], b = ring[(i + 1) % 4]; if (a[0] !== b[0] || a[1] !== b[1]) S.line(a[0], a[1], b[0], b[1], e.l, e.c, K.solid); }
    S.tri(q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], e.l, e.c);
    if (q[3][0] !== q[2][0] || q[3][1] !== q[2][1]) S.tri(q[1][0], q[1][1], q[3][0], q[3][1], q[2][0], q[2][1], e.l, e.c);
  }
  eFace(e, S) {
    const p = [0, 0, 0, 0, 0, 0, 0, 0]; let fl = 0;
    for (let i = 0; i < this.rn; i++) { const c = this.rc[i], v = this.rv[i]; if (c >= 10 && c <= 13) p[(c - 10) * 2] = v; else if (c >= 20 && c <= 23) p[(c - 20) * 2 + 1] = v; else if (c === 70) fl = v; }
    for (let i = 0; i < 4; i++) { if (fl & (1 << i)) continue; const j = (i + 1) % 4; if (p[i * 2] !== p[j * 2] || p[i * 2 + 1] !== p[j * 2 + 1]) S.line(p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1], e.l, e.c, K.face); }
  }
  eLeader(e, S) {
    const pts = [];
    for (let i = 0; i < this.rn; i++) { const c = this.rc[i]; if (c === 10) pts.push(this.rv[i], 0); else if (c === 20) pts[pts.length - 1] = this.rv[i]; }
    for (let i = 2; i < pts.length; i += 2) S.line(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], e.l, e.c, K.leader);
  }
  eMline(e, S) {
    let fl = 0, nv = 0, ne = 0; const V = []; let i = 0;
    const rc = this.rc, rv = this.rv, n = this.rn;
    for (; i < n; i++) { const c = rc[i]; if (c === 71) fl = rv[i]; else if (c === 72) nv = rv[i]; else if (c === 73) ne = rv[i]; else if (c === 11) break; }
    while (i < n && V.length < nv) {
      if (rc[i] !== 11) { i++; continue; }
      const v = { x: rv[i], y: 0, mx: 0, my: 0, off: [] };
      for (i++; i < n && rc[i] !== 11; i++) {
        const c = rc[i];
        if (c === 21) v.y = rv[i]; else if (c === 13) v.mx = rv[i]; else if (c === 23) v.my = rv[i];
        else if (c === 74) { const k = rv[i]; const ps = []; for (let j = 0; j < k && i + 1 < n && rc[i + 1] === 41; j++) ps.push(rv[++i]); v.off.push(ps[0] || 0); }
      }
      V.push(v);
    }
    if (V.length < 2 || !ne) return;
    const last = fl & 2 ? V.length : V.length - 1;
    for (let k = 0; k < ne; k++) for (let j = 0; j < last; j++) {
      const a = V[j], b = V[(j + 1) % V.length], oa = a.off[k] || 0, ob = b.off[k] || 0;
      const p = this.P(e, a.x + a.mx * oa, a.y + a.my * oa), q = this.P(e, b.x + b.mx * ob, b.y + b.my * ob);
      S.line(p[0], p[1], q[0], q[1], e.l, e.c, K.mline);
    }
  }
  eHatch(e, S) {
    const rc = this.rc, rv = this.rv, n = this.rn;
    let i = 0, z = 0, solid = 0, np = 0;
    for (; i < n; i++) { const c = rc[i]; if (c === 30) z = rv[i]; else if (c === 70) solid = rv[i]; else if (c === 91) { np = rv[i]; i++; break; } }
    const loops = [];
    const seek = code => { while (i < n && rc[i] !== code) i++; return i < n; };
    for (let p = 0; p < np && i < n; p++) {
      if (!seek(92)) break; const pt = rv[i++]; const loop = [];
      if (pt & 2) { // polyligne
        let hb = 0, cl = 0, nv = 0;
        for (; i < n && rc[i] !== 10; i++) { if (rc[i] === 72) hb = rv[i]; else if (rc[i] === 73) cl = rv[i]; else if (rc[i] === 93) nv = rv[i]; }
        const pts = [];
        for (let k = 0; k < nv && i < n; k++) {
          if (!seek(10)) break; const x = rv[i++]; let y = 0, b = 0;
          if (rc[i] === 20) y = rv[i++]; if (hb && rc[i] === 42) b = rv[i++];
          pts.push(x, y, b);
        }
        loop.push({ poly: pts, closed: cl || true });
      } else {
        let ne = 0; if (seek(93)) ne = rv[i++];
        for (let k = 0; k < ne && i < n; k++) {
          if (!seek(72)) break; const et = rv[i++]; const g = {};
          const want = et === 1 ? 4 : et === 2 ? 6 : et === 3 ? 8 : 0;
          if (et === 4) { // spline
            const sp = { degree: 3, knots: [], ctrl: [], weights: [], fit: [] };
            for (; i < n; i++) {
              const c = rc[i]; if (c === 72 || c === 92 || c === 97 || c === 75) break;
              if (c === 94) sp.degree = rv[i]; else if (c === 40) sp.knots.push(rv[i]); else if (c === 42) sp.weights.push(rv[i]);
              else if (c === 10) sp.ctrl.push(rv[i], 0); else if (c === 20) sp.ctrl[sp.ctrl.length - 1] = rv[i];
              else if (c === 11) sp.fit.push(rv[i], 0); else if (c === 21) sp.fit[sp.fit.length - 1] = rv[i];
            }
            loop.push({ spline: sp }); continue;
          }
          let got = 0;
          for (; i < n && got < want; i++) {
            const c = rc[i]; if (c === 72 || c === 92) break;
            if ([10, 20, 11, 21, 40, 50, 51, 73].includes(c)) { g[c] = rv[i]; got++; }
          }
          loop.push({ et, g });
        }
      }
      loops.push(loop);
    }
    if (!loops.length) this.degen('HATCH');
    for (const loop of loops) {
      const ring = []; // points pour le remplissage
      for (const ed of loop) {
        if (ed.poly) { this.polyO(S, e, ed.poly, true, z, K.hatch); for (let k = 0; k < ed.poly.length; k += 3) ring.push(ed.poly[k], ed.poly[k + 1]); continue; }
        if (ed.spline) { const pts = splinePoints(ed.spline, this.tol); for (let k = 2; k < pts.length; k += 2) { const a = this.P(e, pts[k - 2], pts[k - 1], z), b = this.P(e, pts[k], pts[k + 1], z); S.line(a[0], a[1], b[0], b[1], e.l, e.c, K.hatch); } ring.push(...pts); continue; }
        const g = ed.g;
        if (ed.et === 1) { const a = this.P(e, g[10] || 0, g[20] || 0, z), b = this.P(e, g[11] || 0, g[21] || 0, z); S.line(a[0], a[1], b[0], b[1], e.l, e.c, K.hatch); ring.push(g[10] || 0, g[20] || 0); }
        else if (ed.et === 2 || ed.et === 3) {
          const ccw = g[73] !== 0;
          let a0 = (g[50] || 0) * D2R, a1 = (g[51] ?? 360) * D2R;
          if (!ccw) { a0 = -a0; a1 = -a1; } // horaire : angles comptés à l'envers
          let sw = a1 - a0; if (ccw) { while (sw <= 0) sw += TAU; } else { while (sw >= 0) sw -= TAU; } if (Math.abs(sw) > TAU) sw = Math.sign(sw) * TAU;
          let ux, uy, vx, vy;
          if (ed.et === 2) { const r = g[40] || 0; ux = r; uy = 0; vx = 0; vy = r; }
          else { ux = g[11] || 0; uy = g[21] || 0; const ra = g[40] || 1; vx = -uy * ra; vy = ux * ra; }
          const C = this.P(e, g[10] || 0, g[20] || 0, z), U = this.V(e, ux, uy), W = this.V(e, vx, vy);
          S.arc(C[0], C[1], U[0], U[1], W[0], W[1], a0, a0 + sw, e.l, e.c, K.hatch);
          const N = Math.min(64, arcSegs(Math.max(Math.hypot(ux, uy), Math.hypot(vx, vy)), sw, this.tol));
          for (let k = 0; k < N; k++) { const t = a0 + (sw * k) / N; ring.push((g[10] || 0) + ux * Math.cos(t) + vx * Math.sin(t), (g[20] || 0) + uy * Math.cos(t) + vy * Math.sin(t)); }
        }
      }
      if ((solid & 1) && loops.length === 1 && this.o.fills && ring.length >= 6) {
        const tri = earcut2(ring);
        if (tri) for (let k = 0; k < tri.length; k += 3) {
          const a = this.P(e, ring[tri[k] * 2], ring[tri[k] * 2 + 1], z), b = this.P(e, ring[tri[k + 1] * 2], ring[tri[k + 1] * 2 + 1], z), c = this.P(e, ring[tri[k + 2] * 2], ring[tri[k + 2] * 2 + 1], z);
          S.tri(a[0], a[1], b[0], b[1], c[0], c[1], e.l, e.c);
        }
      }
    }
    if ((solid & 1) && loops.length > 1 && this.o.fills) this.warn('fillHoles');
  }

  /* --- résultat --- */
  finish(ms, bytes) {
    this.flush(); this.endSec(); this.init();
    const O = this.out, n = O.n;
    this.recLn = -1;
    if (O.full) this.warn('budget', O.dropped || 1, 'maxSegs = ' + this.o.maxSegs);
    if (O.tFull) this.warn('textBudget', O.tDropped || 1, 'maxTexts = ' + this.o.maxTexts);
    if (O.trFull) this.warn('fillBudget', O.trDropped || 1, 'maxTris = ' + this.o.maxTris);
    if (O.outside) this.diag('warning', 'outOfRange', '|x|,|y| ≥ 1e15', O.outside);
    if (!this.eof) this.diag('warning', 'noEOF', bytes ? '' : 'fichier vide');
    if (this.sec !== 0) this.diag('error', 'unterminatedSection', this.secName);
    if (this.afterEof) this.diag('info', 'afterEOF', '', this.afterEof);
    { // poignées en double (tables, blocs, entités, objets)
      const H = this.handles.a.subarray(0, this.handles.n).slice().sort(); let dup = 0, first = -1;
      for (let i = 1; i < H.length; i++) if (H[i] === H[i - 1]) { dup++; if (first < 0) first = H[i]; }
      if (dup) this.diag('warning', 'duplicateHandle', first.toString(16).toUpperCase(), dup);
    }
    const diagnostics = [...this.diags.values()].sort((a, b) => LEVELS[a.level] - LEVELS[b.level] || b.n - a.n);
    const fit = (a, len) => (a.length === len ? a : a.slice(0, len));
    const segs = fit(O.s, n * 4), segLayer = fit(O.sl, n), segKind = fit(O.sk, n), segColor = fit(O.sc, n);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n * 4; i += 2) { const x = segs[i], y = segs[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    for (const t of O.texts) { if (t.x < x0) x0 = t.x; if (t.x > x1) x1 = t.x; if (t.y < y0) y0 = t.y; if (t.y > y1) y1 = t.y; }
    if (!(x0 <= x1)) { x0 = y0 = x1 = y1 = 0; }
    const tris = O.tri.trim().a, triL = O.triL.trim().a, triE = O.triE.trim().a, segEnt = fit(O.se, n);
    const layers = this.layers.map((L, id) => {
      const kinds = {};
      for (let k = 0; k < 16; k++) { const v = O.lk[id * 16 + k]; if (v) kinds[k === 15 ? 'fill' : k === 14 ? 'text' : KINDS[k]] = v; }
      return { id, name: L.name, color: hexOf(L.rgb), aci: L.aci, ltype: L.ltype, off: L.off, frozen: L.frozen, locked: L.locked, count: O.lc[id], kinds };
    });
    const blocks = []; const seen = new Set();
    for (const b of this.blocks.values()) { if (seen.has(b)) continue; seen.add(b); blocks.push({ name: b.name, count: b.count, xref: !!(b.flags & 4) }); }
    const ox = O.ox === O.ox ? O.ox : 0, oy = O.oy === O.oy ? O.oy : 0;
    return {
      units: this.units, toMetre: this.toMetre, unitsGuessed: this.unitsGuessed, insunits: this.insunits, measurement: this.measurement,
      version: this.version || '', codepage: this.str.cpName,
      origin: [ox, oy], extents: [x0, y0, x1, y1], tol: this.tol,
      layers, segs, segLayer, segKind, segColor, palette: O.palette,
      texts: O.texts, inserts: O.inserts, fills: tris.length ? { tris, layer: triL, ent: triE } : null,
      segEnt, entHandle: O.eh.trim().a, entType: O.et.trim().a, entLayer: O.el.trim().a, entTypes: O.types, diagnostics,
      clusters: clusters(O.bb.trim().a, [x0, y0, x1, y1], O.bbF.trim().a), blocks, ...(this.o.keepBoxes ? { boxes: O.bb.a, boxRect: O.bbF.a } : {}),
      warnings: [...this.warns].map(([code, k]) => ({ code, n: k })),
      errors: diagnostics.filter(d => d.level === 'error').reduce((a, d) => a + d.n, 0),
      stats: { entities: this.entities, byType: this.byType, ms, bytes, segs: n, texts: O.texts.length, tris: triL.length, truncated: O.full }
    };
  }
}

/**
 * Feuilles séparées de l'espace objet, à partir des boîtes des entités de premier niveau (Float32Array
 * [x0,y0,x1,y1,…]) et de rects (Uint8Array, 1 = rectangle fermé aux axes, cadre possible).
 * 1. Cadres : un rectangle qui contient assez d'entités est une feuille, sauf s'il contient lui-même au moins deux
 *    cadres bien remplis (c'est alors un cadre d'assemblage : on descend dans ses enfants).
 * 2. Le reste : boîtes posées sur une grille (≤ 512 cases, tableau de différences), cases voisines réunies (union-find),
 *    groupes qui se chevauchent fusionnés. Une très grande boîte (> 1/8 du dessin) n'y relie rien : si ce qu'elle couvre
 *    la remplit à moitié c'est un cadre et elle réunit son contenu, sinon c'est un trait égaré, ignoré.
 */
export function clusters(boxes, ext, rects = null) {
  const nb = boxes.length / 4; if (!nb) return [];
  const [X0, Y0, X1, Y1] = ext, W = Math.max(X1 - X0, 1e-9), H = Math.max(Y1 - Y0, 1e-9), DM = Math.max(W, H), big = DM / 8;
  const cell = DM / 512, nx = Math.min(512, Math.ceil(W / cell) + 1), ny = Math.min(512, Math.ceil(H / cell) + 1);
  const cx = x => Math.min(nx - 1, Math.max(0, Math.floor((x - X0) / cell))), cy = y => Math.min(ny - 1, Math.max(0, Math.floor((y - Y0) / cell)));
  const minC = Math.max(10, Math.round(nb * 0.0005));
  // centres des entités comptés par case (table des sommes) pour compter vite le contenu d'un cadre
  const SA = new Int32Array((nx + 1) * (ny + 1));
  for (let i = 0; i < nb; i++) SA[(cy((boxes[i * 4 + 1] + boxes[i * 4 + 3]) / 2) + 1) * (nx + 1) + cx((boxes[i * 4] + boxes[i * 4 + 2]) / 2) + 1]++;
  for (let y = 1; y <= ny; y++) for (let x = 1; x <= nx; x++) { const k = y * (nx + 1) + x; SA[k] += SA[k - 1] + SA[k - nx - 1] - SA[k - nx - 2]; }
  const countIn = f => { const a = cx(f.x0), b = cy(f.y0), c = cx(f.x1) + 1, d = cy(f.y1) + 1; return SA[d * (nx + 1) + c] - SA[b * (nx + 1) + c] - SA[d * (nx + 1) + a] + SA[b * (nx + 1) + a]; };
  const inside = (a, b) => a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1 && a !== b;
  let frames = [];
  if (rects) for (let i = 0; i < nb; i++) {
    if (!rects[i]) continue;
    const f = { x0: boxes[i * 4], y0: boxes[i * 4 + 1], x1: boxes[i * 4 + 2], y1: boxes[i * 4 + 3] };
    if (Math.max(f.x1 - f.x0, f.y1 - f.y0) < DM / 200 || Math.min(f.x1 - f.x0, f.y1 - f.y0) < cell * 2) continue;
    f.count = countIn(f); if (f.count >= minC) frames.push(f);
  }
  frames.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
  frames = frames.slice(0, 1500);
  for (let i = 0; i < frames.length; i++) { frames[i].kids = []; for (let j = i - 1; j >= 0; j--) if (inside(frames[i], frames[j])) { frames[j].kids.push(frames[i]); frames[i].par = true; break; } }
  const sheets = [];
  const pick = f => { const k = f.kids.filter(c => c.count >= minC); if (k.length >= 2) k.forEach(pick); else sheets.push(f); };
  for (const f of frames) if (!f.par) pick(f);
  // cases couvertes par une feuille (la plus petite l'emporte)
  const own = new Int32Array(nx * ny).fill(-1);
  sheets.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
  sheets.forEach((f, k) => { for (let y = cy(f.y0); y <= cy(f.y1); y++) for (let x = cx(f.x0); x <= cx(f.x1); x++) own[y * nx + x] = k; });
  const res = sheets.map(f => ({ x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, count: 0 }));
  const D = new Int32Array((nx + 1) * (ny + 1)), bigs = [], rest = [];
  for (let i = 0; i < nb; i++) {
    const x0 = boxes[i * 4], y0 = boxes[i * 4 + 1], x1 = boxes[i * 4 + 2], y1 = boxes[i * 4 + 3];
    const k = own[cy((y0 + y1) / 2) * nx + cx((x0 + x1) / 2)];
    if (k >= 0) { const r = res[k]; r.count++; continue; }
    if (x1 - x0 > big || y1 - y0 > big) { bigs.push({ x0, y0, x1, y1, count: 1 }); continue; }
    rest.push(i);
    const a = cx(x0), b = cy(y0), c = cx(x1) + 1, d = cy(y1) + 1;
    D[b * (nx + 1) + a]++; D[b * (nx + 1) + c]--; D[d * (nx + 1) + a]--; D[d * (nx + 1) + c]++;
  }
  const occ = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const k = y * (nx + 1) + x;
    if (x > 0) D[k] += D[k - 1]; if (y > 0) D[k] += D[k - nx - 1]; if (x > 0 && y > 0) D[k] -= D[k - nx - 2];
    occ[y * nx + x] = D[k] > 0 && own[y * nx + x] < 0 ? 1 : 0;
  }
  const par = new Int32Array(nx * ny); for (let i = 0; i < par.length; i++) par[i] = i;
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = y * nx + x; if (!occ[i]) continue;
    if (x + 1 < nx && occ[i + 1]) uni(i, i + 1);
    if (y + 1 < ny && occ[i + nx]) uni(i, i + nx);
  }
  const g = new Map();
  for (const i of rest) {
    const x0 = boxes[i * 4], y0 = boxes[i * 4 + 1], x1 = boxes[i * 4 + 2], y1 = boxes[i * 4 + 3];
    const r = find(cy((y0 + y1) / 2) * nx + cx((x0 + x1) / 2));
    let c = g.get(r); if (!c) g.set(r, c = { x0, y0, x1, y1, count: 0 });
    if (x0 < c.x0) c.x0 = x0; if (y0 < c.y0) c.y0 = y0; if (x1 > c.x1) c.x1 = x1; if (y1 > c.y1) c.y1 = y1; c.count++;
  }
  const hit = (r, c) => r.x0 <= c.x1 && c.x0 <= r.x1 && r.y0 <= c.y1 && c.y0 <= r.y1;
  const join = (o, c) => { o.x0 = Math.min(o.x0, c.x0); o.y0 = Math.min(o.y0, c.y0); o.x1 = Math.max(o.x1, c.x1); o.y1 = Math.max(o.y1, c.y1); o.count += c.count; };
  const merge = list => {
    for (let changed = true, guard = 0; changed && guard < 50; guard++) {
      changed = false; list.sort((a, b) => a.x0 - b.x0);
      const out = [];
      for (const c of list) { const o = out.find(r => hit(r, c)); if (o) { join(o, c); changed = true; } else out.push(c); }
      list = out;
    }
    return list;
  };
  let list = merge([...g.values()].sort((a, b) => b.count - a.count).slice(0, 4000));
  bigs.sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0));
  for (const B of bigs.slice(0, 2000)) {
    const inn = list.filter(c => hit(B, c)), area = Math.max((B.x1 - B.x0) * (B.y1 - B.y0), 1e-12);
    if (!inn.length) { if (!res.some(r => inside(r, B) || hit(r, B))) list.push(B); continue; }
    const u = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, count: 0 }; for (const c of inn) join(u, c);
    const cov = (Math.min(u.x1, B.x1) - Math.max(u.x0, B.x0)) * (Math.min(u.y1, B.y1) - Math.max(u.y0, B.y0)) / area;
    if (cov >= 0.5) { list = list.filter(c => !inn.includes(c)); join(u, B); list.push(u); list = merge(list); }
    else { inn.sort((a, b) => b.count - a.count); inn[0].count++; } // trait égaré : compté, sans agrandir la feuille
  }
  for (const r of res) r.sheet = true;
  return [...res.filter(r => r.count), ...list].sort((a, b) => b.count - a.count).slice(0, 500);
}

/* ---------- entrée ---------- */
const abortErr = () => (typeof DOMException === 'function' ? new DOMException('Aborted', 'AbortError') : Object.assign(new Error('Aborted'), { name: 'AbortError' }));
const tick = () => new Promise(r => setTimeout(r, 0));

/** Lit un DXF (ASCII ou binaire) en flux → CadDoc. */
export async function parseDxf(source, opts = {}) {
  const o = { ...DEFAULTS, fills: true, ...opts };
  const { onProgress, signal } = o;
  const t0 = (globalThis.performance || Date).now();
  const p = new Parser(o);
  let tok = null, bytes = 0, lastP = 0;
  let size = o.size || 0;
  let pre = null; // premiers octets gardés tant qu'on ne sait pas si le fichier est binaire
  const feed = (b, last) => {
    bytes += b.length;
    if (!tok) {
      if (pre) { b = cat(pre, b); pre = null; }
      if (b.length < 22 && !last) { pre = b; return; }
      const head = String.fromCharCode.apply(null, b.subarray(0, 22));
      tok = head === BIN_SENTINEL ? new BinTok(p, p.str) : new AsciiTok(p, p.str);
    }
    tok.push(b);
    if (onProgress && size) { const f = bytes / size; if (f - lastP >= 0.005) { lastP = f; onProgress(Math.min(1, f)); } }
  };
  if (signal?.aborted) throw abortErr();
  if (typeof source === 'string') source = new TextEncoder().encode(source);
  // File / Blob : lu en flux (File.stream() ; mesuré plus rapide et plus sobre que des tranches dans WebKit)
  if (source && typeof source.stream === 'function' && typeof source.arrayBuffer === 'function') { size ||= source.size; source = source.stream(); }
  if (source instanceof ArrayBuffer) source = new Uint8Array(source);
  if (source instanceof Uint8Array) {
    size ||= source.length;
    const CH = 1 << 22; let t = Date.now();
    for (let s = 0; s < source.length; s += CH) {
      if (signal?.aborted) throw abortErr();
      feed(source.subarray(s, Math.min(source.length, s + CH)));
      if (Date.now() - t > 40) { await tick(); t = Date.now(); }
    }
  } else if (source && typeof source.getReader === 'function') {
    const rd = source.getReader();
    try {
      for (;;) {
        if (signal?.aborted) throw abortErr();
        const { done, value } = await rd.read();
        if (done) break;
        if (value && value.length) {
          // le premier morceau doit contenir l'entête binaire en entier
          feed(value instanceof Uint8Array ? value : new Uint8Array(value));
        }
      }
    } finally { try { rd.releaseLock(); } catch { /* déjà libéré */ } }
    if (signal?.aborted) throw abortErr();
  } else throw new TypeError('parseDxf: source non reconnue');
  if (pre) { bytes -= pre.length; feed(pre, true); }
  if (tok) tok.end();
  const doc = p.finish(Math.round((globalThis.performance || Date).now() - t0), bytes);
  if (onProgress) onProgress(1);
  return doc;
}

/** Tableaux à transférer d'un CadDoc (postMessage). */
export function transferList(doc) {
  const l = [doc.segs.buffer, doc.segLayer.buffer, doc.segKind.buffer, doc.segColor.buffer];
  for (const k of ['segEnt', 'entHandle', 'entType', 'entLayer']) if (doc[k]) l.push(doc[k].buffer);
  if (doc.fills) { l.push(doc.fills.tris.buffer, doc.fills.layer.buffer); if (doc.fills.ent) l.push(doc.fills.ent.buffer); }
  return [...new Set(l)];
}

/**
 * Ouvre un fichier DXF dans un worker (l'interface reste fluide) → CadDoc. file : File/Blob, ArrayBuffer ou Uint8Array.
 * signal : annule (termine le worker). Repli sur le fil courant si les workers ne sont pas disponibles.
 */
export function openCad(file, { onProgress, signal, ...opts } = {}) {
  if (typeof Worker !== 'function') return parseDxf(file, { onProgress, signal, ...opts });
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortErr()); return; }
    let w;
    try { w = new Worker(new URL('./dxf.worker.js', import.meta.url), { type: 'module' }); }
    catch { parseDxf(file, { onProgress, signal, ...opts }).then(resolve, reject); return; }
    const stop = () => { w.terminate(); reject(abortErr()); };
    signal?.addEventListener('abort', stop, { once: true });
    const end = () => { signal?.removeEventListener('abort', stop); w.terminate(); };
    w.onmessage = e => {
      const m = e.data || {};
      if (m.type === 'progress') onProgress?.(m.f);
      else if (m.type === 'done') { end(); resolve(m.doc); }
      else if (m.type === 'error') { end(); reject(Object.assign(new Error(m.message), { name: m.name || 'Error' })); }
    };
    w.onerror = ev => { end(); reject(new Error(ev.message || 'dxf worker')); };
    const msg = { opts };
    const tr = [];
    if (file instanceof ArrayBuffer) { msg.buffer = file; }
    else if (file instanceof Uint8Array) { msg.buffer = file; }
    else msg.file = file;
    w.postMessage(msg, tr);
  });
}
