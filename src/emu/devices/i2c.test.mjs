// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modules I2C du mode fidèle : l'image de l'écran OLED (c.progScreen.bits) après de vrais programmes compilés
// (bibliothèque Adafruit SSD1306 ou commandes à la main), et l'inversion des formules du BMP280.
// node --test src/emu/devices/i2c.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hasCli, compileSketch, fakeBoard, boot } from '../testkit.mjs';
import { rawOf } from './bmp280.js';

const skip = !hasCli && 'arduino-cli absent';
const HEAD = '#include <Wire.h>\n#include <Adafruit_GFX.h>\n#include <Adafruit_SSD1306.h>\n';
/** Lance le programme avec un écran OLED en 0x3C ; at(mot) fait tourner jusqu'à ce que le programme l'écrive. */
function oledRun(src) {
  const { hw, comps } = fakeBoard({ modules: [{ type: 'oled', addr: [0x3c] }] });
  const rt = boot(compileSketch(src), hw), oled = comps[0];
  let serial = '';
  return {
    at(word) {
      for (let g = 0; g < 400 && !serial.includes(word + '\r\n'); g++) { rt.run(16); serial += rt.takeSerial(); }
      assert.ok(serial.includes(word), `« ${word} » attendu, reçu ${JSON.stringify(serial)}`);
      assert.equal(rt.state, 'run');
      return oled.progScreen;
    }
  };
}
const px = (s, x, y) => (s.bits[(y >> 3) * s.w + x] >> (y & 7)) & 1;
const lit = s => s.bits.reduce((n, b) => { for (; b; b &= b - 1) n++; return n; }, 0);

test('BMP280 : mesures brutes de l’exemple de la fiche technique', () => {
  assert.deepEqual(rawOf(25.08, 1006.5327), { adcT: 519888, adcP: 415148 });
});

test('OLED 128×64 : Adafruit SSD1306, pixels, texte, inversion, extinction, défilement', { skip }, () => {
  const run = oledRun(HEAD + `
Adafruit_SSD1306 d(128, 64, &Wire, -1);
void setup() {
  Serial.begin(115200);
  d.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  d.clearDisplay();
  d.drawPixel(0, 0, SSD1306_WHITE); d.drawPixel(127, 63, SSD1306_WHITE);
  d.fillRect(10, 20, 5, 4, SSD1306_WHITE);
  d.setTextColor(SSD1306_WHITE); d.setCursor(64, 40); d.print('A');
  d.display(); Serial.println(F("drawn")); delay(100);
  d.invertDisplay(true); Serial.println(F("inv")); delay(100);
  d.invertDisplay(false); d.ssd1306_command(SSD1306_DISPLAYOFF); Serial.println(F("off")); delay(100);
  d.ssd1306_command(SSD1306_DISPLAYON);
  d.startscrollright(0x00, 0x07); d.startscrolldiagleft(0x00, 0x0F); d.stopscroll();
  d.clearDisplay(); d.drawPixel(5, 6, SSD1306_WHITE); d.display(); Serial.println(F("after"));
}
void loop() {}`);
  let s = run.at('drawn');
  assert.equal(s.w, 128); assert.equal(s.h, 64); assert.equal(s.bits.length, 1024);
  assert.equal(s.on, true); assert.equal(s.inv, false);
  assert.equal(s.bits[0] & 1, 1, 'drawPixel(0, 0) : bit 0 de bits[0]');
  assert.equal(px(s, 127, 63), 1); assert.equal(px(s, 1, 0), 0); assert.equal(px(s, 0, 1), 0);
  for (const [x, y, v] of [[10, 20, 1], [14, 23, 1], [15, 20, 0], [10, 24, 0], [9, 20, 0], [10, 19, 0]]) assert.equal(px(s, x, y), v, `fillRect en (${x}, ${y})`);
  // « A » de la police 5×7 de GFX, en haut de la page 5 (y = 40) : cinq colonnes, puis l'espace.
  assert.deepEqual([...s.bits.subarray(5 * 128 + 64, 5 * 128 + 70)], [0x7c, 0x12, 0x11, 0x12, 0x7c, 0]);
  assert.equal(lit(s), 2 + 20 + 16, 'rien d’autre (l’écran d’accueil a été effacé)');
  const v0 = s.ver;
  s = run.at('inv');
  assert.equal(s.inv, true); assert.ok(s.ver > v0); assert.equal(px(s, 0, 0), 1, 'l’inversion se fait à l’affichage, pas dans la mémoire');
  s = run.at('off');
  assert.equal(s.on, false); assert.equal(s.inv, false);
  s = run.at('after');
  assert.equal(s.on, true);
  assert.equal(lit(s), 1, 'paramètres des commandes de défilement bien consommés'); assert.equal(px(s, 5, 6), 1);
});

test('OLED 128×32 : 32 lignes multiplexées, broches COM séquentielles', { skip }, () => {
  const s = oledRun(HEAD + `
Adafruit_SSD1306 d(128, 32, &Wire, -1);
void setup() {
  Serial.begin(115200);
  d.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  d.clearDisplay(); d.drawPixel(0, 0, SSD1306_WHITE); d.drawPixel(127, 31, SSD1306_WHITE); d.drawFastHLine(0, 16, 128, SSD1306_WHITE);
  d.display(); Serial.println(F("drawn"));
}
void loop() {}`).at('drawn');
  assert.equal(s.h, 32); assert.equal(s.bits.length, 512);
  assert.equal(px(s, 0, 0), 1); assert.equal(px(s, 127, 31), 1); assert.equal(px(s, 64, 16), 1);
  assert.equal(lit(s), 130);
});

test('OLED sans bibliothèque : pompe de charge, retournements, ligne de départ, adressage vertical, câblage COM', { skip }, () => {
  const run = oledRun(`#include <Wire.h>
// Co = 1 : un seul octet (commande 0x80, image 0xC0) ; les paramètres peuvent venir dans une écriture suivante.
void cmd(byte c) { Wire.beginTransmission(0x3C); Wire.write(0x80); Wire.write(c); Wire.endTransmission(); }
void dat(byte b) { Wire.beginTransmission(0x3C); Wire.write(0xC0); Wire.write(b); Wire.endTransmission(); }
void step(const char *s) { Serial.println(s); delay(50); }
void setup() {
  Serial.begin(115200); Wire.begin();
  cmd(0xAF); step("nopump");
  cmd(0x8D); cmd(0x14); dat(0x01); step("raw");
  cmd(0xC8); step("c8");
  cmd(0xA1); dat(0x80); step("a1");
  cmd(0x41); step("start1");
  cmd(0x40);
  Wire.beginTransmission(0x3C); Wire.write(0x00);
  const byte v[] = { 0x20, 0x01, 0x21, 20, 21, 0x22, 0, 7 }; Wire.write(v, sizeof v); Wire.endTransmission();
  Wire.beginTransmission(0x3C); Wire.write(0x40); for (byte i = 0; i < 9; i++) Wire.write(0xFF); Wire.endTransmission();
  step("vert");
  cmd(0xA5); step("allon");
  cmd(0xA4); cmd(0xA8); cmd(0x1F); step("mux32");
  cmd(0xDA); cmd(0x02); step("seq");
  // Défilements : leurs octets « sans effet » valent ici 0xA7 (inversion) si la commande est mal découpée.
  Wire.beginTransmission(0x3C); Wire.write(0x00);
  const byte sc[] = { 0x26, 0, 0, 0, 7, 0, 0xA7, 0x2A, 0, 0, 0, 7, 0xA7, 0xA3, 0, 0xA7, 0x2F, 0x2E };
  Wire.write(sc, sizeof sc); Wire.endTransmission();
  step("scroll");
}
void loop() {}`);
  let s = run.at('nopump');
  assert.equal(s.on, false, 'sans pompe de charge, l’écran reste noir');
  s = run.at('raw');
  assert.equal(s.on, true);
  assert.equal(px(s, 127, 63), 1, 'sans 0xA1 ni 0xC8, la colonne 0 est à droite et la page 0 en bas'); assert.equal(lit(s), 1);
  s = run.at('c8');
  assert.equal(px(s, 127, 0), 1, '0xC8 retourne aussitôt toute l’image'); assert.equal(lit(s), 1);
  s = run.at('a1');
  assert.equal(px(s, 127, 0), 1, '0xA1 ne touche pas aux octets déjà écrits'); assert.equal(px(s, 1, 7), 1); assert.equal(lit(s), 2);
  s = run.at('start1');
  assert.equal(px(s, 1, 6), 1); assert.equal(px(s, 127, 63), 1, 'la ligne 0 de la mémoire passe en bas');
  s = run.at('vert');
  for (let y = 0; y < 64; y++) assert.equal(px(s, 20, y), 1, `colonne 20, ligne ${y}`);
  for (let y = 0; y < 8; y++) assert.equal(px(s, 21, y), 1);
  assert.equal(px(s, 21, 8), 0);
  s = run.at('allon');
  assert.equal(lit(s), 128 * 64);
  s = run.at('mux32');
  assert.equal(s.h, 32);
  let col = 0; for (let y = 0; y < 32; y++) col += px(s, 20, y);
  assert.equal(col, 16, 'broches COM alternées sur une dalle de 32 lignes : une ligne sur deux');
  s = run.at('seq');
  col = 0; for (let y = 0; y < 32; y++) col += px(s, 20, y);
  assert.equal(col, 32); assert.equal(px(s, 1, 7), 1); assert.equal(px(s, 21, 0), 1);
  assert.equal(run.at('scroll').inv, false, 'paramètres des défilements consommés (6, 5 et 2 octets)');
});

test('OLED : programme du corpus (adressage par page)', { skip }, () => {
  const s = oledRun(fs.readFileSync(new URL('../corpus/oled_raw.ino', import.meta.url), 'utf8')).at('done');
  assert.equal(lit(s), 20 * 8);
  for (const [x, y] of [[10, 16], [29, 23]]) assert.equal(px(s, x, y), 1);
  for (const [x, y] of [[9, 16], [30, 16], [10, 15], [10, 24]]) assert.equal(px(s, x, y), 0);
});
