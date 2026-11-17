// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Écrans TFT ST7735 et ILI9341 (sim/tft.js) : contrôleur au niveau des commandes (CASET, RASET, RAMWR, MADCTL, COLMOD),
// dalle vue à l'endroit pour les rotations d'Adafruit, et bibliothèques simulées de l'interpréteur.
// node --test src/sim/tft.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTft, tftOf, tftPublish, tftHex, TftGfx, paintTft } from './tft.js';
import { compile } from '../prog/lang.js';
import { createRuntime } from '../prog/runtime.js';
import { BOARDS } from './boards.js';
import { FONT } from './gfxfont.js';

/** Envoie une commande et ses paramètres comme le ferait le bus SPI (DC à 0 puis à 1). */
const send = (t, c, ...d) => { t.command(c); d.flat().forEach(b => t.data(b)); };
const win = (t, x0, y0, x1, y1) => { send(t, 0x2a, x0 >> 8, x0 & 255, x1 >> 8, x1 & 255); send(t, 0x2b, y0 >> 8, y0 & 255, y1 >> 8, y1 & 255); };
const px = (t, v, n = 1) => { t.command(0x2c); for (let i = 0; i < n; i++) { t.data(v >> 8); t.data(v & 255); } };
const at = (t, x, y) => t.rgb[y * t.W + x];

test('police classique : 256 caractères de 5 colonnes, « A » reconnaissable', () => {
  assert.equal(FONT.length, 1280);
  assert.deepEqual([...FONT.slice(65 * 5, 65 * 5 + 5)], [0x7c, 0x12, 0x11, 0x12, 0x7c]);
});

test('ST7735 : rotation 0 d’Adafruit (MX | MY) à l’endroit, fenêtre remplie colonne puis ligne', () => {
  const t = createTft('st7735');
  send(t, 0x11); send(t, 0x3a, 0x05); send(t, 0x36, 0xc0); send(t, 0x29);
  win(t, 0, 0, 1, 1); px(t, 0xf800); // (0,0) rouge
  t.data(0x07); t.data(0xe0); // RAMWR continue : (1,0) vert
  assert.equal(at(t, 0, 0), 0xf800);
  assert.equal(at(t, 1, 0), 0x07e0);
  // Rotation 2 (sans drapeau) : (0,0) logique tombe en bas à droite.
  send(t, 0x36, 0x00); win(t, 0, 0, 0, 0); px(t, 0x001f);
  assert.equal(at(t, 127, 159), 0x001f);
  // Rotation 1 (MY | MV), paysage : x logique vers le bas de l'écran en portrait, y vers la gauche.
  send(t, 0x36, 0xa0); win(t, 5, 0, 5, 0); px(t, 0xffff);
  assert.equal(at(t, 127, 5), 0xffff);
  // BGR : rouge et bleu échangés sur une dalle black tab.
  send(t, 0x36, 0xc8); win(t, 10, 10, 10, 10); px(t, 0xf800);
  assert.equal(at(t, 10, 10), 0x001f);
  // 18 bits par pixel : trois octets.
  send(t, 0x36, 0xc0); send(t, 0x3a, 0x06); win(t, 20, 20, 20, 20); t.command(0x2c); t.data(0xfc); t.data(0); t.data(0);
  assert.equal(at(t, 20, 20), 0xf800);
});

test('ILI9341 : rotation 0 (MX | BGR) à l’endroit, RDDPM après initialisation', () => {
  const t = createTft('ili9341');
  assert.equal((t.command(0x0a), t.data(0)), 0x08, 'en sommeil, éteint');
  send(t, 0x11); send(t, 0x3a, 0x55); send(t, 0x36, 0x48); send(t, 0x29);
  win(t, 0, 0, 0, 0); px(t, 0xf800);
  assert.equal(at(t, 0, 0), 0xf800, 'rouge en haut à gauche');
  send(t, 0x36, 0x28); win(t, 0, 0, 0, 0); px(t, 0x07e0); // rotation 1 (MV | BGR)
  assert.equal(at(t, 239, 0), 0x07e0);
  t.command(0x0a); assert.equal(t.data(0), 0x9c);
  send(t, 0x01); assert.equal(t.state.on, false, 'SWRESET éteint');
});

test('publication : image vivante, version à chaque changement, INVON', () => {
  const c = { id: 'tft1', type: 'st7735' }, t = tftOf(c);
  send(t, 0x11); send(t, 0x29);
  assert.ok(tftPublish(c));
  assert.equal(c.progScreen.on, true);
  assert.equal(tftPublish(c), false, 'rien de neuf');
  send(t, 0x21); tftPublish(c);
  assert.equal(c.progScreen.inv, true);
  assert.equal(tftHex(c.progScreen, 0, 0), '#ffffff', 'noir inversé');
});

function gfx(type) {
  const c = { id: 'g', type }, warns = [];
  const g = new TftGfx(type, { find: () => c, warn: m => warns.push(m), fmt: x => String(x), tl: x => x }, [10, 9, 8]);
  return { c, g, warns };
}
test('TftGfx : rotations 0 à 3 posent le pixel (0,0) au bon coin, rectangles et texte', () => {
  const { c, g } = gfx('st7735');
  g.initR(2);
  g.fillScreen(0);
  const corner = r => { g.setRotation(r); g.fillScreen(0); g.drawPixel(0, 0, 0xffff); const s = c.progScreen, p = []; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.rgb[y * s.w + x]) p.push([x, y]); return p; };
  assert.deepEqual(corner(0), [[0, 0]]);
  assert.deepEqual(corner(1), [[127, 0]]);
  assert.deepEqual(corner(2), [[127, 159]]);
  assert.deepEqual(corner(3), [[0, 159]]);
  g.setRotation(1); assert.equal(g.width(), 160); assert.equal(g.height(), 128);
  g.setRotation(0); g.fillScreen(0); g.fillRect(10, 20, 5, 4, 0x07e0);
  assert.equal(tftHex(c.progScreen, 10, 20), '#00ff00'); assert.equal(tftHex(c.progScreen, 14, 23), '#00ff00'); assert.equal(tftHex(c.progScreen, 15, 23), '#000000');
  g.fillScreen(0); g.setTextColor(0xffff); g.setTextSize(2); g.setCursor(0, 0); g.print('A');
  // « A » agrandi deux fois : colonne 0 = 0x7C (lignes 2 à 6 allumées) → pixels (0..1, 4..13).
  assert.equal(tftHex(c.progScreen, 0, 4), '#ffffff'); assert.equal(tftHex(c.progScreen, 1, 13), '#ffffff'); assert.equal(tftHex(c.progScreen, 0, 2), '#000000');
  assert.equal(g.getCursorX(), 12);
  g.fillScreen(0); g.fillCircle(50, 50, 10, 0xf800); g.drawLine(0, 100, 127, 100, 0x001f); g.fillTriangle(10, 120, 30, 120, 20, 140, 0xffe0);
  assert.equal(tftHex(c.progScreen, 50, 50), '#ff0000'); assert.equal(tftHex(c.progScreen, 60, 50), '#ff0000'); assert.equal(tftHex(c.progScreen, 61, 50), '#000000');
  assert.equal(tftHex(c.progScreen, 64, 100), '#0000ff'); assert.equal(tftHex(c.progScreen, 20, 125), '#ffff00');
  g.invertDisplay(true); assert.equal(c.progScreen.inv, true);
});

test('paintTft : présentation, écran éteint, image', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => calls.push([k, ...a])), set: (o, k, v) => { o[k] = v; return true; } });
  paintTft(ctx, 4, null, 28, 35); paintTft(ctx, 4, [], 28, 35);
  const { c, g } = gfx('st7735'); g.initR(2); g.fillScreen(0xf800);
  calls.length = 0; paintTft(ctx, 4, c.progScreen, 28, 35);
  assert.ok(calls.some(x => x[0] === 'fillRect'), 'repli sans canevas : suites de pixels');
});

/** Interpréteur sur un montage factice : l'écran a CS sur D10 et DC sur D9. */
function run(src, type) {
  const scr = { type, id: 'scr', name: 'TFT1' }, wires = { D10: [{ comp: scr, pin: 'CS' }], D9: [{ comp: scr, pin: 'DC' }] };
  const hw = { kind: 'uno', label: 'uno', prof: BOARDS.uno, read: () => null, at: k => wires[k] || [], bus: () => [], i2c: () => [], status: () => ({ ok: true, msg: '' }), data: () => null, onPin: () => null };
  const c = compile(src, { board: 'uno' });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  for (let i = 0; i < 5; i++) rt.run(16);
  assert.notEqual(rt.state, 'error', rt.error && rt.error.msg);
  return { rt, scr };
}
test('simulateur intégré : Adafruit_ST7735 et Adafruit_ILI9341 dessinent sur l’écran câblé', () => {
  const { scr, rt } = run(`#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
Adafruit_ST7735 tft = Adafruit_ST7735(10, 9, 8);
void setup() {
  tft.initR(INITR_BLACKTAB);
  tft.fillScreen(ST77XX_BLACK);
  tft.fillRect(0, 0, 10, 10, ST77XX_RED);
  tft.setRotation(1);
  tft.drawPixel(0, 0, tft.color565(0, 0, 255));
  tft.setCursor(20, 20); tft.setTextColor(ST77XX_WHITE); tft.print("Jollof ");
  tft.println(42);
}
void loop() {}`, 'st7735');
  const s = scr.progScreen;
  assert.equal(s.w, 128); assert.equal(s.on, true);
  assert.equal(tftHex(s, 0, 0), '#ff0000'); assert.equal(tftHex(s, 9, 9), '#ff0000');
  assert.equal(tftHex(s, 127, 0), '#0000ff', 'rotation 1 : (0,0) en haut à droite du portrait');
  assert.match(s.text, /Jollof 42/);
  assert.equal(rt.warnings.size, 0, [...rt.warnings.keys()].join());
  const b = run(`#include <Adafruit_ILI9341.h>
Adafruit_ILI9341 tft(10, 9);
void setup() { tft.begin(); tft.fillScreen(ILI9341_BLACK); tft.fillRect(0, 0, 3, 3, ILI9341_GREEN); tft.drawCircle(120, 160, 30, ILI9341_WHITE); }
void loop() {}`, 'ili9341');
  assert.equal(b.scr.progScreen.w, 240);
  assert.equal(tftHex(b.scr.progScreen, 0, 0), '#00ff00');
  assert.equal(tftHex(b.scr.progScreen, 150, 160), '#ffffff');
});

test('simulateur intégré : écran absent ou d’un autre modèle, avertissement', () => {
  const src = `#include <Adafruit_ILI9341.h>
Adafruit_ILI9341 tft(10, 9);
void setup() { tft.begin(); tft.fillScreen(ILI9341_RED); }
void loop() {}`;
  const { rt } = run(src, 'st7735');
  assert.ok([...rt.warnings.keys()].some(m => /ILI9341/.test(m) && /ST7735/.test(m)));
});
