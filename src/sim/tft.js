// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Écrans couleur TFT en SPI : ST7735 (1,8", 128 × 160, version « black tab ») et ILI9341 (2,4" / 2,8", 240 × 320).
// Un seul modèle du contrôleur, au niveau des commandes de la fiche technique, partagé par les deux moteurs :
//   - les processeurs émulés (src/emu/devices/tft.js) lui passent chaque octet SPI, commande ou donnée selon la broche
//     DC (D/CX) : SWRESET, SLPIN/SLPOUT, NORON, INVOFF/INVON, DISPOFF/DISPON, CASET, RASET, RAMWR, MADCTL, COLMOD ; les
//     autres commandes (réglages d'alimentation, gamma, fréquence…) sont acceptées et leurs paramètres ignorés ;
//   - l'interpréteur (src/prog/runtime.js) dessine par TftGfx, qui reprend les algorithmes d'Adafruit_GFX et écrit par
//     fenêtres (CASET/RASET) puis suites de pixels, exactement comme la vraie bibliothèque.
// Adressage (fiches ST7735S § 10.1.27 et ILI9341 § 8.2.29, MADCTL) : CASET borne le premier compteur, RASET le second ;
// les pixels remplissent la fenêtre colonne après colonne puis ligne après ligne. MV échange les deux compteurs (le
// premier adresse alors les lignes de la mémoire), MX et MY renversent la colonne et la ligne de la mémoire, BGR échange
// le rouge et le bleu à l'écriture.
// Dalle : celle qui fait que la rotation 0 d'Adafruit (ST7735 : MX | MY ; ILI9341 : MX | BGR) s'affiche à l'endroit.
// ST7735 « black tab » : la dalle montre la mémoire tournée d'un demi-tour, couleurs justes avec BGR = 0. ILI9341 : la
// dalle montre la mémoire retournée de gauche à droite, couleurs justes avec BGR = 1. Les autres réglages (rotations 1 à
// 3) donnent alors les mêmes images que sur les vrais modules.
// Image publiée (comp.progScreen) : { rgb: Uint16Array(w × h) en RGB565, lignes de haut en bas de l'écran tenu en
// portrait (connecteur en haut), w, h, on (affichage allumé et réveillé), inv (INVON), ver, text? (texte écrit par le
// simulateur intégré, pour l'étiquette) }. Le tableau rgb est l'image vivante du contrôleur (pas de copie) : ver change
// à chaque modification.
import { FONT } from './gfxfont.js';

export const TFT_TYPES = ['st7735', 'ili9341'];
export const isTft = t => TFT_TYPES.includes(t);
/** Dalles : taille (pixels, portrait), sens de lecture de la mémoire, ordre des couleurs de la dalle (bgr), broche MOSI. */
export const TFT = {
  st7735: { w: 128, h: 160, flip: 'rot180', bgr: 0, mosi: 'SDA', pins: ['VCC', 'GND', 'CS', 'RESET', 'DC', 'SDA', 'SCK', 'LED'] },
  ili9341: { w: 240, h: 320, flip: 'mirror', bgr: 1, mosi: 'MOSI', pins: ['VCC', 'GND', 'CS', 'RESET', 'DC', 'MOSI', 'SCK', 'LED', 'MISO'] }
};
const MADCTL_MY = 0x80, MADCTL_MX = 0x40, MADCTL_MV = 0x20, MADCTL_BGR = 0x08;
const swapRB = v => ((v & 0x1f) << 11) | (v & 0x07e0) | (v >> 11);

/** Contrôleur d'un écran : command(octet), data(octet) → octet lu sur MISO, reset(), et l'image (rgb) qu'il montre. */
export function createTft(type) {
  const P = TFT[type] || TFT.st7735, W = P.w, H = P.h;
  const rgb = new Uint16Array(W * H);
  const s = { t: type, W, H, rgb, cmd: -1, n: 0, acc: 0, pix: [], madctl: 0, colmod: 0x66, sleep: true, on: false, inv: false, xs: 0, xe: W - 1, ys: 0, ye: H - 1, cx: 0, cy: 0, dirty: true, ver: 0 };
  /** Remise à zéro (broche RESET ou SWRESET) : valeurs de la fiche, affichage éteint et en sommeil ; mémoire inchangée. */
  function reset() {
    Object.assign(s, { cmd: -1, n: 0, pix: [], madctl: 0, colmod: 0x66, sleep: true, on: false, inv: false, xs: 0, xe: W - 1, ys: 0, ye: H - 1, cx: 0, cy: 0, dirty: true });
  }
  /** Pixel suivant de RAMWR, à la position des compteurs, puis les compteurs avancent dans la fenêtre. */
  function put(v) {
    const m = s.madctl;
    let col = m & MADCTL_MV ? s.cy : s.cx, row = m & MADCTL_MV ? s.cx : s.cy;
    if (m & MADCTL_MX) col = W - 1 - col;
    if (m & MADCTL_MY) row = H - 1 - row;
    if (col >= 0 && col < W && row >= 0 && row < H) {
      if (((m & MADCTL_BGR) ? 1 : 0) !== P.bgr) v = swapRB(v);
      const i = P.flip === 'rot180' ? (H - 1 - row) * W + (W - 1 - col) : row * W + (W - 1 - col);
      if (rgb[i] !== v) { rgb[i] = v; s.dirty = true; }
    }
    if (++s.cx > s.xe) { s.cx = s.xs; if (++s.cy > s.ye) s.cy = s.ys; }
  }
  const tft = {
    state: s, rgb, W, H,
    reset,
    command(c) {
      s.cmd = c; s.n = 0; s.acc = 0; s.pix = [];
      switch (c) {
        case 0x01: reset(); s.cmd = 0x01; break;
        case 0x10: s.sleep = true; s.dirty = true; break;
        case 0x11: s.sleep = false; s.dirty = true; break;
        case 0x20: case 0x21: s.inv = c === 0x21; s.dirty = true; break;
        case 0x28: case 0x29: s.on = c === 0x29; s.dirty = true; break;
        case 0x2c: s.cx = s.xs; s.cy = s.ys; break; // RAMWR : départ au coin de la fenêtre
      }
    },
    /** Octet de données (DC à 1) ; rend l'octet que présente MISO (commandes de lecture de l'ILI9341). */
    data(b) {
      b &= 0xff;
      const n = s.n++;
      switch (s.cmd) {
        case 0x2a: case 0x2b: {
          // Début puis fin, 16 bits chacun, octet de poids fort d'abord.
          if (n > 3) return 0;
          s.acc = ((s.acc << 8) | b) & 0xffff;
          if (n === 1) { if (s.cmd === 0x2a) s.xs = s.acc; else s.ys = s.acc; }
          if (n === 3) { if (s.cmd === 0x2a) s.xe = s.acc; else s.ye = s.acc; }
          return 0;
        }
        case 0x36: if (n === 0) s.madctl = b; return 0;
        case 0x3a: if (n === 0) s.colmod = b; return 0;
        case 0x2c: case 0x3c: {
          // 16 bits par pixel (COLMOD x5) : deux octets RGB565 ; 18 bits (x6) : trois octets, 6 bits utiles chacun.
          s.pix.push(b);
          if ((s.colmod & 7) === 6) { if (s.pix.length === 3) { const [r, g, bb] = s.pix; s.pix = []; put(((r >> 3) << 11) | ((g >> 2) << 5) | (bb >> 3)); } }
          else if (s.pix.length === 2) { const v = (s.pix[0] << 8) | s.pix[1]; s.pix = []; put(v); }
          return 0;
        }
        // Lectures (ILI9341, readcommand8) : état de l'affichage, MADCTL, COLMOD, autodiagnostic.
        // RDDPM : D7 survolteur, D4 hors sommeil, D3 mode normal, D2 affichage allumé (0x9C une fois initialisé).
        case 0x0a: return (s.sleep ? 0 : 0x90) | 0x08 | (s.on ? 0x04 : 0);
        case 0x0b: return s.madctl;
        case 0x0c: return s.colmod;
        case 0x0f: return 0xc0;
        default: return 0;
      }
    },
    /** Fenêtre d'écriture (comme CASET puis RASET puis RAMWR), pour le simulateur intégré. */
    window(x0, y0, x1, y1) { s.xs = x0; s.xe = x1; s.ys = y0; s.ye = y1; s.cx = x0; s.cy = y0; s.cmd = 0x2c; s.pix = []; },
    /** n pixels de la couleur v (RGB565), dans la fenêtre. */
    fill(v, n) { v &= 0xffff; for (let i = 0; i < n; i++) put(v); },
    pixel(v) { put(v & 0xffff); },
    setMadctl(m) { s.madctl = m & 0xff; },
    setColmod(m) { s.colmod = m & 0xff; }
  };
  return tft;
}

/** Contrôleur de l'écran (sur comp.icState : remis à zéro à l'arrêt de la simulation, comme les puces logiques). */
export function tftOf(comp) {
  let s = comp.icState;
  if (!s || s.t !== comp.type || !s.tft) s = comp.icState = { t: comp.type, tft: createTft(comp.type), ver: (comp.progScreen && comp.progScreen.ver) || 0 };
  return s.tft;
}
/** Publie l'image si elle a changé (text : texte écrit, pour l'étiquette). Rend true si publiée. */
export function tftPublish(comp, text) {
  const st = comp.icState; if (!st || !st.tft) return false;
  const s = st.tft.state, on = s.on && !s.sleep;
  const p = comp.progScreen;
  if (!s.dirty && p && p.rgb === s.rgb && p.on === on && p.inv === s.inv && (text === undefined || p.text === text)) return false;
  s.dirty = false;
  comp.progScreen = { rgb: s.rgb, w: s.W, h: s.H, on, inv: s.inv, ver: ++st.ver, ...(text !== undefined ? { text } : p && p.text ? { text: p.text } : {}) };
  return true;
}

/* ---------- Dessin à la manière d'Adafruit_GFX, pour le simulateur intégré ---------- */
/** Rotation (0 à 3) → MADCTL envoyé par la bibliothèque Adafruit. ST7735 : selon l'onglet (BGR sauf black tab et mini 160x80). */
function madctlOf(type, r, rgbTab) {
  if (type === 'ili9341') return [MADCTL_MX | MADCTL_BGR, MADCTL_MV | MADCTL_BGR, MADCTL_MY | MADCTL_BGR, MADCTL_MX | MADCTL_MY | MADCTL_MV | MADCTL_BGR][r];
  const o = rgbTab ? 0 : MADCTL_BGR;
  return [MADCTL_MX | MADCTL_MY | o, MADCTL_MY | MADCTL_MV | o, o, MADCTL_MX | MADCTL_MV | o][r];
}
/** Onglets de l'ST7735 (Adafruit_ST7735.h) : INITR_GREENTAB 0, REDTAB 1, BLACKTAB 2, 144GREENTAB 1 (même code), MINI160x80 4. */
export const INITR = { INITR_GREENTAB: 0x00, INITR_REDTAB: 0x01, INITR_BLACKTAB: 0x02, INITR_18GREENTAB: 0x00, INITR_18REDTAB: 0x01, INITR_18BLACKTAB: 0x02, INITR_144GREENTAB: 0x01, INITR_MINI160x80: 0x04, INITR_HALLOWING: 0x05, INITR_MINI160x80_PLUGIN: 0x06 };

/**
 * Écran TFT vu par une bibliothèque Adafruit (Adafruit_ST7735, Adafruit_ILI9341) dans le simulateur intégré.
 * host : { find() → composant relié ou null, warn(message), fmt(x, f, tag) → texte, tl } ; type : 'st7735' | 'ili9341'.
 */
export class TftGfx {
  constructor(type, host, args) {
    this.type = type; this.host = host; this.args = args; this.c = null;
    this.W0 = TFT[type].w; this.H0 = TFT[type].h; this.w = this.W0; this.h = this.H0;
    this.rot = 0; this.tab = 2; this.col0 = 0; this.row0 = 0; this.xs = 0; this.ys = 0;
    this.cx = 0; this.cy = 0; this.size = 1; this.sizeY = 1; this.fg = 0xffff; this.bg = 0xffff; this.wrap = true; this.cp = false; this.text = '';
  }
  ctl() {
    if (!this.c) { this.c = this.host.find(); if (!this.c) return null; }
    return tftOf(this.c);
  }
  pub() { if (this.c) tftPublish(this.c, this.text.slice(-60)); }
  init(tab) {
    this.c = this.host.find();
    if (!this.c) return;
    const t = tftOf(this.c);
    t.command(0x01); t.command(0x11); t.command(0x3a); t.data(this.type === 'ili9341' ? 0x55 : 0x05);
    if (this.type === 'st7735') {
      this.tab = tab;
      // Décalages de la mémoire selon l'onglet (Adafruit_ST7735::initR) ; 128 × 128 pour le 1,44", 80 × 160 pour le mini.
      [this.col0, this.row0, this.W0, this.H0] = tab === INITR.INITR_GREENTAB ? [2, 1, 128, 160] : tab === INITR.INITR_144GREENTAB ? [2, 3, 128, 128] : tab === INITR.INITR_MINI160x80 ? [24, 0, 80, 160] : [0, 0, 128, 160];
    }
    this.setRotation(0);
    t.command(0x13); t.command(0x29);
    this.pub();
  }
  // Adafruit_ST7735 : initR(onglet), initB() ; Adafruit_ILI9341 : begin(fréquence).
  initR(tab = INITR.INITR_GREENTAB) { this.init(tab | 0); }
  initB() { this.init(INITR.INITR_REDTAB); }
  begin() { this.init(INITR.INITR_BLACKTAB); }
  setRotation(r) {
    this.rot = (r | 0) & 3;
    const t = this.ctl(); if (!t) return;
    const rgbTab = this.tab === INITR.INITR_BLACKTAB || this.tab === INITR.INITR_MINI160x80;
    t.setMadctl(madctlOf(this.type, this.rot, rgbTab));
    if (this.rot & 1) { this.w = this.H0; this.h = this.W0; this.xs = this.row0; this.ys = this.col0; } else { this.w = this.W0; this.h = this.H0; this.xs = this.col0; this.ys = this.row0; }
  }
  getRotation() { return this.rot; }
  width() { return this.w; } height() { return this.h; }
  /** Rectangle plein, découpé au bord de l'écran : une fenêtre et w × h pixels, comme writeFillRect. */
  rect(x, y, w, h, col) {
    x = Math.trunc(x); y = Math.trunc(y); w = Math.trunc(w); h = Math.trunc(h);
    if (w < 0) { x += w + 1; w = -w; } if (h < 0) { y += h + 1; h = -h; }
    let x1 = x + w - 1, y1 = y + h - 1;
    if (x < 0) x = 0; if (y < 0) y = 0; if (x1 >= this.w) x1 = this.w - 1; if (y1 >= this.h) y1 = this.h - 1;
    if (x1 < x || y1 < y) return;
    const t = this.ctl(); if (!t) return;
    t.window(x + this.xs, y + this.ys, x1 + this.xs, y1 + this.ys); t.fill(col, (x1 - x + 1) * (y1 - y + 1));
  }
  px(x, y, col) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.rect(x, y, 1, 1, col); }
  drawPixel(x, y, c) { this.px(Math.trunc(x), Math.trunc(y), c); this.pub(); }
  fillScreen(c) { this.text = ''; this.rect(0, 0, this.w, this.h, c); this.pub(); }
  fillRect(x, y, w, h, c) { this.rect(x, y, w, h, c); this.pub(); }
  drawFastHLine(x, y, w, c) { this.rect(x, y, w, 1, c); this.pub(); }
  drawFastVLine(x, y, h, c) { this.rect(x, y, 1, h, c); this.pub(); }
  drawRect(x, y, w, h, c) { this.rect(x, y, w, 1, c); this.rect(x, y + h - 1, w, 1, c); this.rect(x, y, 1, h, c); this.rect(x + w - 1, y, 1, h, c); this.pub(); }
  line(x0, y0, x1, y1, c) {
    [x0, y0, x1, y1] = [x0, y0, x1, y1].map(Math.trunc);
    if (x0 === x1) { this.rect(x0, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, c); return; }
    if (y0 === y1) { this.rect(Math.min(x0, x1), y0, Math.abs(x1 - x0) + 1, 1, c); return; }
    // Bresenham, comme Adafruit_GFX::writeLine.
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    if (steep) { [x0, y0] = [y0, x0]; [x1, y1] = [y1, x1]; }
    if (x0 > x1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
    const dx = x1 - x0, dy = Math.abs(y1 - y0), ys = y0 < y1 ? 1 : -1;
    let err = dx >> 1;
    for (; x0 <= x1; x0++) { if (steep) this.px(y0, x0, c); else this.px(x0, y0, c); err -= dy; if (err < 0) { y0 += ys; err += dx; } }
  }
  drawLine(x0, y0, x1, y1, c) { this.line(x0, y0, x1, y1, c); this.pub(); }
  circlePts(x0, y0, r, corners, c) {
    let f = 1 - r, ddx = 1, ddy = -2 * r, x = 0, y = r;
    while (x < y) {
      if (f >= 0) { y--; ddy += 2; f += ddy; }
      x++; ddx += 2; f += ddx;
      if (corners & 4) { this.px(x0 + x, y0 + y, c); this.px(x0 + y, y0 + x, c); }
      if (corners & 2) { this.px(x0 + x, y0 - y, c); this.px(x0 + y, y0 - x, c); }
      if (corners & 8) { this.px(x0 - y, y0 + x, c); this.px(x0 - x, y0 + y, c); }
      if (corners & 1) { this.px(x0 - y, y0 - x, c); this.px(x0 - x, y0 - y, c); }
    }
  }
  drawCircle(x0, y0, r, c) {
    [x0, y0, r] = [x0, y0, r].map(Math.trunc);
    this.px(x0, y0 + r, c); this.px(x0, y0 - r, c); this.px(x0 + r, y0, c); this.px(x0 - r, y0, c);
    this.circlePts(x0, y0, r, 15, c); this.pub();
  }
  fillHelper(x0, y0, r, corners, delta, c) {
    let f = 1 - r, ddx = 1, ddy = -2 * r, x = 0, y = r, px = x, py = y;
    delta++;
    while (x < y) {
      if (f >= 0) { y--; ddy += 2; f += ddy; }
      x++; ddx += 2; f += ddx;
      if (x < y + 1) { if (corners & 1) this.rect(x0 + x, y0 - y, 1, 2 * y + delta, c); if (corners & 2) this.rect(x0 - x, y0 - y, 1, 2 * y + delta, c); }
      if (y !== py) { if (corners & 1) this.rect(x0 + py, y0 - px, 1, 2 * px + delta, c); if (corners & 2) this.rect(x0 - py, y0 - px, 1, 2 * px + delta, c); py = y; }
      px = x;
    }
  }
  fillCircle(x0, y0, r, c) { [x0, y0, r] = [x0, y0, r].map(Math.trunc); this.rect(x0, y0 - r, 1, 2 * r + 1, c); this.fillHelper(x0, y0, r, 3, 0, c); this.pub(); }
  drawRoundRect(x, y, w, h, r, c) {
    [x, y, w, h, r] = [x, y, w, h, r].map(Math.trunc); r = Math.min(r, Math.min(w, h) >> 1);
    this.rect(x + r, y, w - 2 * r, 1, c); this.rect(x + r, y + h - 1, w - 2 * r, 1, c); this.rect(x, y + r, 1, h - 2 * r, c); this.rect(x + w - 1, y + r, 1, h - 2 * r, c);
    this.circlePts(x + r, y + r, r, 1, c); this.circlePts(x + w - r - 1, y + r, r, 2, c); this.circlePts(x + w - r - 1, y + h - r - 1, r, 4, c); this.circlePts(x + r, y + h - r - 1, r, 8, c);
    this.pub();
  }
  fillRoundRect(x, y, w, h, r, c) {
    [x, y, w, h, r] = [x, y, w, h, r].map(Math.trunc); r = Math.min(r, Math.min(w, h) >> 1);
    this.rect(x + r, y, w - 2 * r, h, c);
    this.fillHelper(x + w - r - 1, y + r, r, 1, h - 2 * r - 1, c); this.fillHelper(x + r, y + r, r, 2, h - 2 * r - 1, c);
    this.pub();
  }
  drawTriangle(x0, y0, x1, y1, x2, y2, c) { this.line(x0, y0, x1, y1, c); this.line(x1, y1, x2, y2, c); this.line(x2, y2, x0, y0, c); this.pub(); }
  fillTriangle(x0, y0, x1, y1, x2, y2, c) {
    [x0, y0, x1, y1, x2, y2] = [x0, y0, x1, y1, x2, y2].map(Math.trunc);
    // Adafruit_GFX::fillTriangle : sommets triés par y, lignes horizontales.
    if (y0 > y1) { [y0, y1] = [y1, y0]; [x0, x1] = [x1, x0]; }
    if (y1 > y2) { [y2, y1] = [y1, y2]; [x2, x1] = [x1, x2]; }
    if (y0 > y1) { [y0, y1] = [y1, y0]; [x0, x1] = [x1, x0]; }
    if (y0 === y2) { const a = Math.min(x0, x1, x2), b = Math.max(x0, x1, x2); this.rect(a, y0, b - a + 1, 1, c); this.pub(); return; }
    const dx01 = x1 - x0, dy01 = y1 - y0, dx02 = x2 - x0, dy02 = y2 - y0, dx12 = x2 - x1, dy12 = y2 - y1;
    let sa = 0, sb = 0, y;
    const last = y1 === y2 ? y1 : y1 - 1;
    for (y = y0; y <= last; y++) {
      let a = x0 + Math.trunc(sa / dy01), b = x0 + Math.trunc(sb / dy02); sa += dx01; sb += dx02;
      if (a > b) [a, b] = [b, a];
      this.rect(a, y, b - a + 1, 1, c);
    }
    sa = dx12 * (y - y1); sb = dx02 * (y - y0);
    for (; y <= y2; y++) {
      let a = x1 + Math.trunc(sa / dy12), b = x0 + Math.trunc(sb / dy02); sa += dx12; sb += dx02;
      if (a > b) [a, b] = [b, a];
      this.rect(a, y, b - a + 1, 1, c);
    }
    this.pub();
  }
  /** Caractère de la police classique 5 × 7 (cellule 6 × 8), agrandi size fois ; fond seulement s'il diffère de l'encre. */
  char(x, y, ch, col, bg, sx, sy = sx) {
    if (x >= this.w || y >= this.h || x + 6 * sx - 1 < 0 || y + 8 * sy - 1 < 0) return;
    if (!this.cp && ch >= 176) ch++; // décalage historique de la police (cp437(false))
    ch &= 255;
    for (let i = 0; i < 6; i++) {
      let line = i < 5 ? FONT[ch * 5 + i] : 0;
      for (let j = 0; j < 8; j++, line >>= 1) {
        if (line & 1) { if (sx === 1 && sy === 1) this.px(x + i, y + j, col); else this.rect(x + i * sx, y + j * sy, sx, sy, col); }
        else if (bg !== col) { if (sx === 1 && sy === 1) this.px(x + i, y + j, bg); else this.rect(x + i * sx, y + j * sy, sx, sy, bg); }
      }
    }
  }
  drawChar(x, y, ch, c, bg, size = 1, sy) { this.char(Math.trunc(x), Math.trunc(y), typeof ch === 'number' ? ch & 255 : String(ch).charCodeAt(0) & 255, c, bg === undefined ? c : bg, Math.max(1, size | 0), Math.max(1, (sy ?? size) | 0)); this.pub(); }
  put(str) {
    for (const ch of String(str)) {
      const code = ch.charCodeAt(0) & 255;
      if (ch === '\n') { this.cx = 0; this.cy += this.sizeY * 8; continue; }
      if (ch === '\r') continue;
      if (this.wrap && this.cx + this.size * 6 > this.w) { this.cx = 0; this.cy += this.sizeY * 8; }
      this.char(this.cx, this.cy, code, this.fg, this.bg, this.size, this.sizeY);
      this.cx += this.size * 6;
    }
    this.text = (this.text + String(str).replace(/\s+/g, ' ')).slice(-200);
    this.pub();
    return String(str).length;
  }
  print(x, f, tag) { return this.put(this.host.fmt(x, f, tag)); }
  println(x, f, tag) { return this.put((x === undefined ? '' : this.host.fmt(x, f, tag)) + '\n'); }
  write(x) { return this.put(typeof x === 'number' ? String.fromCharCode(x & 255) : String(x)); }
  setCursor(x, y) { this.cx = Math.trunc(x); this.cy = Math.trunc(y); }
  getCursorX() { return this.cx; } getCursorY() { return this.cy; }
  setTextColor(c, bg) { this.fg = c & 0xffff; this.bg = bg === undefined ? this.fg : bg & 0xffff; }
  setTextSize(s, sy) { this.size = Math.max(1, s | 0); this.sizeY = Math.max(1, (sy ?? s) | 0); }
  setTextWrap(w) { this.wrap = !!w; }
  cp437(x = true) { this.cp = !!x; }
  color565(r, g, b) { return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | ((b & 0xff) >> 3); }
  invertDisplay(i) { const t = this.ctl(); if (t) { t.command(i ? 0x21 : 0x20); this.pub(); } }
  enableDisplay(e) { const t = this.ctl(); if (t) { t.command(e ? 0x29 : 0x28); this.pub(); } }
  enableSleep(e) { const t = this.ctl(); if (t) { t.command(e ? 0x10 : 0x11); this.pub(); } }
  /** Image d'un bit par pixel (bit de poids fort à gauche), lignes complétées à l'octet. */
  drawBitmap(x, y, bmp, w, h, c, bg) {
    if (!Array.isArray(bmp)) { this.host.warn(this.host.tl('drawBitmap() attend un tableau d’octets, par exemple const unsigned char image[] PROGMEM = {…}')); return; }
    const bw = (w + 7) >> 3;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const on = (bmp[j * bw + (i >> 3)] << (i & 7)) & 0x80;
      if (on) this.px(x + i, y + j, c); else if (bg !== undefined) this.px(x + i, y + j, bg);
    }
    this.pub();
  }
  /** Image en couleurs RGB565, un entier de 16 bits par pixel. */
  drawRGBBitmap(x, y, bmp, w, h) {
    if (!Array.isArray(bmp)) { this.host.warn(this.host.tl('drawRGBBitmap() attend un tableau de couleurs de 16 bits')); return; }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, bmp[j * w + i] & 0xffff);
    this.pub();
  }
  getTextBounds() {}
  // Fonctions sans effet visible dans la simulation (vitesse du bus SPI, écriture groupée).
  setSPISpeed() {} startWrite() {} endWrite() {} sendCommand() {}
  readcommand8(reg) {
    const t = this.ctl(); if (!t) return 0;
    t.command(reg & 0xff); return t.data(0);
  }
}

/* ---------- Image de l'écran sur la scène ---------- */
let scratch = null;
const canvasOf = (w, h) => {
  if (scratch && scratch.width === w && scratch.height === h) return scratch;
  scratch = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : null;
  return scratch;
};
const css565 = v => `rgb(${((v >> 11) & 31) * 255 / 31 | 0},${((v >> 5) & 63) * 255 / 63 | 0},${(v & 31) * 255 / 31 | 0})`;
/**
 * Dessine l'écran sur le contexte x, dans la zone (0, 0, physW × k, physH × k) (k : pixels du canevas par mm).
 * scr : null (image de présentation), [] (écran éteint), liste de lignes (mesures des capteurs, sans programme), ou
 * l'image publiée { rgb, w, h, on, inv }.
 */
export function paintTft(x, k, scr, physW, physH) {
  const W = physW * k, H = physH * k;
  x.fillStyle = '#05070a'; x.fillRect(0, 0, W, H);
  if (Array.isArray(scr)) {
    if (!scr.length) return;
    x.fillStyle = '#0b1a3a'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#ffffff'; x.textBaseline = 'top'; x.font = `600 ${Math.round(H / 14)}px "JetBrains Mono", ui-monospace, monospace`;
    scr.slice(0, 10).forEach((l, i) => x.fillText(String(l).slice(0, 18), W * 0.05, H * (0.06 + i * 0.09)));
    return;
  }
  if (!scr) {
    // Présentation : bandes de couleur et titre, comme l'exemple graphicstest de la bibliothèque.
    const cols = ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff'];
    cols.forEach((c, i) => { x.fillStyle = c; x.fillRect(0, H * 0.55 + i * H * 0.075, W, H * 0.075 + 1); });
    x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `700 ${Math.round(W / 6)}px "Instrument Sans", system-ui, sans-serif`;
    x.fillText('Jollof', W / 2, H * 0.22);
    x.font = `500 ${Math.round(W / 11)}px "JetBrains Mono", ui-monospace, monospace`; x.fillText('TFT', W / 2, H * 0.38);
    x.textAlign = 'left';
    return;
  }
  if (!scr.rgb || scr.on === false) return;
  const w = scr.w, h = scr.h, inv = scr.inv ? 0xffff : 0, cv = canvasOf(w, h);
  if (cv && typeof ImageData !== 'undefined') {
    const g = cv.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    for (let i = 0; i < w * h; i++) {
      const v = scr.rgb[i] ^ inv, o = i * 4;
      d[o] = ((v >> 11) & 31) * 527 + 23 >> 6; d[o + 1] = ((v >> 5) & 63) * 259 + 33 >> 6; d[o + 2] = (v & 31) * 527 + 23 >> 6; d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const smooth = x.imageSmoothingEnabled;
    x.imageSmoothingEnabled = false; x.drawImage(cv, 0, 0, W, H); x.imageSmoothingEnabled = smooth;
    return;
  }
  // Sans canevas hors écran : suites de pixels de même couleur.
  const sx = W / w, sy = H / h;
  for (let j = 0; j < h; j++) {
    let run = 0;
    for (let i = 1; i <= w; i++) {
      if (i < w && scr.rgb[j * w + i] === scr.rgb[j * w + run]) continue;
      x.fillStyle = css565(scr.rgb[j * w + run] ^ inv); x.fillRect(run * sx, j * sy, (i - run) * sx + 0.5, sy + 0.5);
      run = i;
    }
  }
}
/** Couleur RGB565 d'un pixel de l'image publiée, en « #rrggbb » (tests, étiquettes). */
export function tftHex(scr, x, y) {
  if (!scr || !scr.rgb || x < 0 || y < 0 || x >= scr.w || y >= scr.h) return null;
  const v = scr.rgb[y * scr.w + x] ^ (scr.inv ? 0xffff : 0), r = ((v >> 11) & 31) * 255 / 31, g = ((v >> 5) & 63) * 255 / 63, b = (v & 31) * 255 / 31;
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
}
