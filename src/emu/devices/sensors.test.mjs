// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Capteurs du mode fidèle : BME280 (Adafruit BME280), BH1750 (Christopher Laws) et balance HX711 (Bogdan Necula),
// lus par les vraies bibliothèques compilées pour l'Uno. node --test src/emu/devices/sensors.test.mjs
// (bibliothèques : arduino-cli lib install "Adafruit BME280 Library" "BH1750" "HX711 Arduino Library").
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { hasCli, compileSketch, fakeBoard, boot, runFor } from '../testkit.mjs';
import { rawHum } from './bme280.js';

const libs = hasCli ? spawnSync('arduino-cli', ['lib', 'list'], { encoding: 'utf8' }).stdout || '' : '';
const need = (...names) => (!hasCli ? 'arduino-cli absent' : names.find(n => !libs.includes(n)) ? 'bibliothèque absente' : false);
/** Lance le programme, attend que le moniteur série contienne `until`, rend le texte reçu. */
function serialOf(src, modules, until, ms = 3000) {
  const { hw } = fakeBoard({ modules });
  const rt = boot(compileSketch(src), hw);
  let out = '';
  for (let t = 0; t < ms && !out.includes(until); t += 16) { rt.run(16); out += rt.takeSerial(); }
  assert.equal(rt.state, 'run');
  return out;
}

test('BME280 : la formule d’humidité est inversée (mesure brute croissante)', () => {
  assert.ok(rawHum(30, 25) < rawHum(60, 25) && rawHum(60, 25) < rawHum(90, 25));
  assert.equal(rawHum(0, 25), 0);
});

test('BME280 : température, humidité et pression lues par Adafruit_BME280', { skip: need('Adafruit BME280 Library') }, () => {
  const out = serialOf(`#include <Wire.h>
#include <Adafruit_BME280.h>
Adafruit_BME280 bme;
void setup() {
  Serial.begin(115200);
  if (!bme.begin(0x76)) { Serial.println(F("absent")); return; }
  delay(200);
  Serial.print(F("T=")); Serial.println(bme.readTemperature(), 1);
  Serial.print(F("H=")); Serial.println(bme.readHumidity(), 0);
  Serial.print(F("P=")); Serial.println(bme.readPressure() / 100.0, 0);
  Serial.print(F("ID=")); Serial.println(bme.sensorID(), HEX);
  Serial.println(F("fin"));
}
void loop() {}`, [{ type: 'bme280', addr: [0x76], data: { temp: 23.5, hum: 61, press: 1002 } }], 'fin');
  assert.match(out, /T=23\.[45]\r\n/);
  assert.match(out, /H=6[01]\r\n/);
  assert.match(out, /P=100[12]\r\n/);
  assert.match(out, /ID=60\r\n/);
});

test('BH1750 : éclairement lu par la bibliothèque BH1750, haute et basse résolution', { skip: need('BH1750') }, () => {
  const out = serialOf(`#include <Wire.h>
#include <BH1750.h>
BH1750 lux1;
void setup() {
  Serial.begin(115200);
  Wire.begin();
  Serial.println(lux1.begin() ? F("ok") : F("absent"));
  delay(200);
  Serial.print(F("H=")); Serial.println(lux1.readLightLevel(), 0);
  lux1.configure(BH1750::CONTINUOUS_LOW_RES_MODE);
  delay(50);
  Serial.print(F("L=")); Serial.println(lux1.readLightLevel(), 0);
  Serial.println(F("fin"));
}
void loop() {}`, [{ type: 'bh1750', addr: [0x23], data: { lux: 420 } }], 'fin');
  assert.match(out, /ok\r\n/);
  assert.match(out, /H=4(19|20)\r\n/);
  assert.match(out, /L=4[12]\d\r\n/);
});

test('HX711 : tare, étalonnage et masse lus par la bibliothèque HX711 (DT sur D4, SCK sur D5)', { skip: need('HX711 Arduino Library') }, () => {
  const data = { grams: 0, raw: 52000 };
  const { hw } = fakeBoard({ modules: [{ type: 'hx711', pins: { DT: 'D4', SCK: 'D5' }, data: () => data }] });
  const rt = boot(compileSketch(`#include <HX711.h>
HX711 balance;
void setup() {
  Serial.begin(115200);
  balance.begin(4, 5);
  balance.set_scale(430.0);
  balance.tare();
  Serial.print(F("offset=")); Serial.println(balance.get_offset());
}
void loop() {
  if (balance.is_ready()) { Serial.print(F("g=")); Serial.println(balance.get_units(3), 0); delay(500); }
}`), hw);
  let out = '';
  const until = (re, ms) => { for (let t = 0; t < ms && !re.test(out); t += 16) { rt.run(16); out += rt.takeSerial(); } };
  until(/g=-?\d+\r\n/, 4000);
  assert.match(out, /offset=5(19|20|21)\d\d\r\n/);
  assert.match(out, /g=-?[01]\r\n/);
  data.grams = 750; data.raw = 52000 + 750 * 430;
  out = ''; runFor(rt, 1500); out += rt.takeSerial();
  const done = out.split('\r\n').filter(l => /^g=-?\d+$/.test(l));
  assert.ok(done.length >= 2, out);
  assert.match(done.at(-1), /^g=(749|750|751)$/, out);
});
