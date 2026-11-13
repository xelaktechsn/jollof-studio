// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Composants standard en paquet (.jpart, src/library/standard) dans le mode fidèle : vrai programme compilé pour l'Uno, qui lit un SHT31 et un INA219
// déclarés (I2C), un MAX6675 (SPI) et compte les impulsions d'un débitmètre (interruption sur D2).
// node --test src/emu/devices/pkg.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hasCli, compileSketch, fakeBoard, boot } from '../testkit.mjs';

const i18n = await import('../../i18n/index.js');
await i18n.loadLanguage();
const J = await import('../../library/jpart.js');
for (const id of ['pk-sht31', 'pk-ina219', 'pk-max6675', 'pk-yfs201']) {
  const v = J.validateManifest(JSON.parse(fs.readFileSync(new URL(`../../library/standard/${id}.json`, import.meta.url), 'utf8')));
  J.registerSim(v.manifest);
}
const skip = !hasCli && 'arduino-cli absent';
function serialOf(src, modules, until, ms = 4000) {
  const { hw } = fakeBoard({ modules });
  const rt = boot(compileSketch(src), hw);
  let out = '';
  for (let t = 0; t < ms && !out.includes(until); t += 16) { rt.run(16); out += rt.takeSerial(); }
  assert.equal(rt.state, 'run');
  return out;
}

test('mode fidèle : SHT31 (commande + CRC) et INA219 (registres de 16 bits) lus par Wire', { skip }, () => {
  const out = serialOf(`#include <Wire.h>
uint8_t crc(uint8_t a, uint8_t b) { uint8_t c = 0xFF; uint8_t d[2] = { a, b }; for (int k = 0; k < 2; k++) { c ^= d[k]; for (int i = 0; i < 8; i++) c = (c & 0x80) ? (c << 1) ^ 0x31 : c << 1; } return c; }
void setup() {
  Serial.begin(115200); Wire.begin();
  Wire.beginTransmission(0x44); Wire.write(0x24); Wire.write(0x00); Wire.endTransmission();
  delay(20);
  Wire.requestFrom(0x44, 6);
  uint8_t b[6]; for (int i = 0; i < 6; i++) b[i] = Wire.read();
  // (uint16_t) : sur l'AVR, b[3] << 8 est un int de 16 bits signé ; au-delà de 32767, il deviendrait négatif.
  Serial.print(F("T=")); Serial.println(-45 + 175.0 * (uint16_t)((b[0] << 8) | b[1]) / 65535.0, 1);
  Serial.print(F("H=")); Serial.println(100.0 * (uint16_t)((b[3] << 8) | b[4]) / 65535.0, 0);
  Serial.print(F("CRC=")); Serial.println(crc(b[0], b[1]) == b[2] && crc(b[3], b[4]) == b[5] ? F("ok") : F("faux"));
  Wire.beginTransmission(0x40); Wire.write(0x02); Wire.endTransmission(false);
  Wire.requestFrom(0x40, 2);
  uint16_t bus = (Wire.read() << 8) | Wire.read();
  Serial.print(F("V=")); Serial.println((bus >> 3) * 0.004, 2);
  Wire.beginTransmission(0x40); Wire.write(0x01); Wire.endTransmission(false);
  Wire.requestFrom(0x40, 2);
  int16_t sh = (Wire.read() << 8) | Wire.read();
  Serial.print(F("I=")); Serial.println(sh / 10000.0, 3);
  Serial.println(F("fin"));
}
void loop() {}`, [{ type: 'pk-sht31', addr: [0x44], data: { temp: 24.6, hum: 61 } }, { type: 'pk-ina219', addr: [0x40], data: { current: -0.125, voltage: 7.4 } }], 'fin');
  assert.match(out, /T=24\.6\r\n/);
  assert.match(out, /H=61\r\n/);
  assert.match(out, /CRC=ok\r\n/);
  assert.match(out, /V=7\.40\r\n/);
  assert.match(out, /I=-0\.125\r\n/);
});

test('mode fidèle : MAX6675 lu par SPI (CS sur D10) et débitmètre compté par interruption sur D2', { skip }, () => {
  const out = serialOf(`#include <SPI.h>
volatile unsigned long n = 0;
void compter() { n++; }
void setup() {
  Serial.begin(115200); SPI.begin(); pinMode(10, OUTPUT); digitalWrite(10, HIGH);
  digitalWrite(10, LOW);
  uint16_t v = (SPI.transfer(0) << 8) | SPI.transfer(0);
  digitalWrite(10, HIGH);
  Serial.print(F("TC=")); Serial.println((v >> 3) * 0.25);
  pinMode(2, INPUT); attachInterrupt(digitalPinToInterrupt(2), compter, RISING);
  delay(1000);
  noInterrupts(); unsigned long c = n; interrupts();
  Serial.print(F("F=")); Serial.println(c / 7.5, 1);
  Serial.println(F("fin"));
}
void loop() {}`, [{ type: 'pk-max6675', pins: { CS: 'D10' }, data: { temp: 412.75 } }, { type: 'pk-yfs201', pins: { OUT: 'D2' }, data: { flow: 8 } }], 'fin');
  assert.match(out, /TC=412\.75\r\n/);
  const f = +/F=([\d.]+)/.exec(out)[1];
  assert.ok(Math.abs(f - 8) <= 0.3, `débit ${f} L/min`);
});
