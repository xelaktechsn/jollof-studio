// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modules d'un paquet (.jpart) sur bus I2C ou SPI, ou à impulsions : logique des modules (sim/pkgbus.js) et vrais
// programmes Arduino lus par l'interpréteur (Wire, SPI, attachInterrupt). node --test src/sim/pkgbus.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const i18n = await import('../i18n/index.js');
await i18n.loadLanguage();
const { sensirionCrc, encodeValue, decodeValue, createI2c, createSpi, pulseHz, i2cAddress } = await import('./pkgbus.js');
const J = await import('../library/jpart.js');
const { compile } = await import('../prog/lang.js');
const { createRuntime } = await import('../prog/runtime.js');
const { BOARDS } = await import('./boards.js');
const pack = id => JSON.parse(fs.readFileSync(new URL(`../library/standard/${id}.json`, import.meta.url), 'utf8'));
const manifest = id => { const v = J.validateManifest(pack(id)); assert.ok(v.ok, v.errors && v.errors.join('\n')); J.registerSim(v.manifest); return v.manifest; };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} ≠ ${b}`);

test('CRC Sensirion, codage et décodage des valeurs (signe, décalage, ordre des octets)', () => {
  assert.equal(sensirionCrc([0xbe, 0xef]), 0x92, 'exemple de la fiche technique Sensirion');
  const it = { quantity: 'current', bits: 16, signed: true, scale: 10000 };
  assert.deepEqual(encodeValue(it, { current: -0.25 }), [0xf6, 0x3c]); // −2500
  near(decodeValue(it, encodeValue(it, { current: 1.2345 })), 1.2345, 1e-4, 'aller-retour');
  const v = { quantity: 'voltage', bits: 16, scale: 250, shift: 3 };
  near(decodeValue(v, encodeValue(v, { voltage: 12.34 })), 12.34, 0.004, 'tension sur 13 bits');
  const le = { quantity: 'temp', bits: 16, signed: true, scale: 100, endian: 'little' };
  assert.deepEqual(encodeValue(le, { temp: 21.5 }), [0x66, 0x08]);
  assert.deepEqual(encodeValue({ quantity: 'temp', bits: 8 }, { temp: 999 }), [255], 'saturé à la plage');
  assert.equal(pulseHz({ hzPer: 7.5 }, 10), 75);
  assert.equal(pulseHz({ curve: [[0, 0], [10, 20], [20, 30]] }, 15), 25);
  assert.equal(i2cAddress({ address: 0x44, alt: 0x45 }, true), 0x45);
});

test('I2C : commande et réponse avec CRC (SHT31), registres et pointeur (INA219), adresse de registre sur 16 bits', () => {
  const sht = manifest('pk-sht31').behaviour.i2c, d = createI2c(sht, () => ({ temp: 23.4, hum: 56.7 }));
  d.start(true); d.write(0x24); d.write(0x00); d.stop();
  d.start(false); const b = Array.from({ length: 6 }, () => d.read()); d.stop();
  assert.equal(b[2], sensirionCrc(b.slice(0, 2))); assert.equal(b[5], sensirionCrc(b.slice(3, 5)));
  near(-45 + 175 * ((b[0] << 8) | b[1]) / 65535, 23.4, 0.01, 'température');
  near(100 * ((b[3] << 8) | b[4]) / 65535, 56.7, 0.01, 'humidité');
  const ina = manifest('pk-ina219').behaviour.i2c, r = createI2c(ina, () => ({ current: -0.5, voltage: 11.8 }));
  const reg = (at, n) => { r.start(true); r.write(at); r.start(false); const o = Array.from({ length: n }, () => r.read()); r.stop(); return o; }; // départ répété
  assert.deepEqual(reg(0x00, 2), [0x39, 0x9f], 'registre de configuration');
  near(((reg(0x02, 2)[0] << 8 | reg(0x02, 2)[1]) >> 3) * 0.004, 11.8, 0.004, 'tension du bus');
  const sh = reg(0x01, 2), raw = ((sh[0] << 8) | sh[1]) << 16 >> 16;
  near(raw / 10000, -0.5, 1e-4, 'courant (tension du shunt signée)');
  // Écriture d'un registre (étalonnage) : gardée, relue telle quelle.
  r.start(true); [0x05, 0x10, 0x00].forEach(x => r.write(x)); r.stop();
  assert.deepEqual(reg(0x05, 2), [0x10, 0x00]);
  const w = createI2c({ regBytes: 2, registers: [{ at: 0x0110, quantity: 'dist', bits: 16, scale: 10 }] }, () => ({ dist: 42 }));
  w.start(true); w.write(0x01); w.write(0x10); w.start(false); const mm = (w.read() << 8) | w.read(); w.stop();
  assert.equal(mm, 420);
});

test('SPI : trame (MAX6675) et registres avec bit de lecture', () => {
  const tc = manifest('pk-max6675').behaviour.spi, s = createSpi(tc, () => ({ temp: 250.25 }));
  s.select(); const v = (s.transfer(0) << 8) | s.transfer(0); s.deselect();
  assert.equal((v >> 3) * 0.25, 250.25); assert.equal(v & 4, 0, 'thermocouple branché');
  const g = createSpi({ mode: 'register', readBit: 0x80, readWhenSet: true, addrMask: 0x7f, registers: [{ at: 0x0f, bytes: [0x33] }, { at: 0x28, quantity: 'tilt', bits: 16, signed: true, scale: 100, endian: 'little' }] }, () => ({ tilt: -12.5 }));
  g.select(); g.transfer(0x8f); const id = g.transfer(0); g.deselect();
  assert.equal(id, 0x33, 'WHO_AM_I');
  g.select(); g.transfer(0xa8); const lo = g.transfer(0), hi = g.transfer(0); g.deselect();
  assert.equal((((hi << 8) | lo) << 16 >> 16) / 100, -12.5);
  g.select(); g.transfer(0x20); g.transfer(0x47); g.deselect(); // écriture (bit de lecture à 0)
  g.select(); g.transfer(0xa0); assert.equal(g.transfer(0), 0x47); g.deselect();
});

test('validation : bus et impulsions déclarés avec soin, erreurs précises', () => {
  const bad = { format: 1, id: 'pk-x', name: 'X', category: 'Capteurs', prefix: 'X', pins: [{ name: 'S', x: 0, y: 8, z: 0, kind: 'io', need: 'in' }] };
  const errs = raw => J.validateManifest({ ...bad, ...raw }).errors || [];
  assert.ok(errs({ behaviour: { i2c: { address: 0x44, registers: [{ at: 0, quantity: 'temp' }] } } }).some(e => /« sda »/.test(e)), 'I2C sans broches SDA et SCL');
  assert.ok(errs({ behaviour: { i2c: { address: 0x99 } } }).some(e => /address/.test(e)), 'adresse hors plage');
  assert.ok(errs({ behaviour: { pulseOut: [{ pin: 'S', quantity: 'flow' }] } }).some(e => /hzPer/.test(e)), 'impulsions sans fréquence');
  assert.ok(errs({ behaviour: { pulseOut: [{ pin: 'S', quantity: 'flow', hzPer: 5 }] } }).length === 0);
  const i2c = { ...bad, pins: [{ name: 'SDA', x: 0, y: 8, z: 0, kind: 'io', need: 'sda' }, { name: 'SCL', x: 2.54, y: 8, z: 0, kind: 'io', need: 'scl' }] };
  const e2 = J.validateManifest({ ...i2c, behaviour: { i2c: { address: 0x44, commands: [{ write: [0x24], reply: [{ quantity: 'temp' }, { crc: 'md5' }] }] } } }).errors || [];
  assert.ok(e2.some(e => /crc/.test(e)), e2.join('\n'));
  const ok = J.validateManifest({ ...i2c, behaviour: { i2c: { address: 0x44, registers: [{ at: 0x10, quantity: 'uv', bits: 16, scale: 100 }] } } });
  assert.ok(ok.ok, (ok.errors || []).join('\n'));
  assert.deepEqual(Object.keys(J.signalsOf(ok.manifest)), ['uv']);
});

/** Carte de test : modules I2C (adresse), broches (fils), mesures de chaque module (data), niveaux lus (read). */
function board(kind, o = {}) {
  const wires = o.wires || {};
  return {
    kind, label: kind, prof: BOARDS[kind],
    read: k => (o.read ? o.read(k) : null), echo: () => null,
    onPin: (k, types) => { const h = (wires[k] || []).find(x => types.includes(x.comp.type)); return h ? h.comp : null; },
    at: k => wires[k] || [], bus: types => (o.bus || []).filter(d => types.includes(d.comp.type)), i2c: () => o.bus || [],
    status: () => ({ ok: true, msg: '' }), peers: () => [], data: c => c.data || null, self: () => ({ type: kind, id: 'b', name: kind }),
    mem: () => ({ ee: '', prefs: {} }), memChanged() {}, level: () => null
  };
}
function run(src, hw, steps = 10, dt = 16) {
  const c = compile(src, { board: hw.kind });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  let out = '';
  for (let i = 0; i < steps; i++) { rt.run(dt); out += rt.takeSerial(); }
  assert.notEqual(rt.state, 'error', rt.error && rt.error.msg);
  return out;
}

test('interpréteur : un vrai programme lit le SHT31 et l’INA219 avec Wire, le MAX6675 avec SPI, compte les impulsions du débitmètre', () => {
  manifest('pk-sht31'); manifest('pk-ina219'); manifest('pk-max6675'); manifest('pk-yfs201');
  const sht = { type: 'pk-sht31', id: 's', name: 'SHT1', data: { temp: 27.3, hum: 48 } }, ina = { type: 'pk-ina219', id: 'i', name: 'INA1', data: { current: 0.42, voltage: 5.06 } };
  const out = run(`#include <Wire.h>
void setup() {
  Serial.begin(9600); Wire.begin();
  Wire.beginTransmission(0x44); Wire.write(0x24); Wire.write(0x00); Wire.endTransmission();
  delay(20);
  Wire.requestFrom(0x44, 6);
  uint8_t b[6]; for (int i = 0; i < 6; i++) b[i] = Wire.read();
  float t = -45 + 175.0 * (((long)b[0] << 8) | b[1]) / 65535.0;
  Serial.println(t, 1);
  Wire.beginTransmission(0x40); Wire.write(0x04); Wire.endTransmission(false);
  Wire.requestFrom(0x40, 2);
  int ma = (Wire.read() << 8) | Wire.read();
  Serial.println(ma / 10);
  Serial.println(Wire.requestFrom(0x41, 2));
}
void loop() {}`, board('uno', { bus: [{ comp: sht, addr: [0x44] }, { comp: ina, addr: [0x40] }] }), 4);
  assert.equal(out, '27.3\n420\n0\n');
  const tc = { type: 'pk-max6675', id: 't', name: 'TC1', data: { temp: 180.5 } };
  const out2 = run(`#include <SPI.h>
void setup() {
  Serial.begin(9600); SPI.begin(); pinMode(10, OUTPUT); digitalWrite(10, HIGH);
  digitalWrite(10, LOW);
  int v = (SPI.transfer(0) << 8) | SPI.transfer(0);
  digitalWrite(10, HIGH);
  Serial.println((v >> 3) * 0.25);
  Serial.println(SPI.transfer(0));
}
void loop() {}`, board('uno', { wires: { D10: [{ comp: tc, pin: 'CS' }] } }), 4);
  assert.equal(out2, '180.50\n0\n', 'CS relevée : plus personne ne répond');
  // Débitmètre à 12 L/min : 90 impulsions par seconde, comptées par interruption pendant 2 s.
  const out3 = run(`volatile unsigned long n = 0;
void compter() { n++; }
void setup() { Serial.begin(9600); pinMode(2, INPUT); attachInterrupt(digitalPinToInterrupt(2), compter, RISING); }
void loop() { delay(2000); noInterrupts(); unsigned long c = n; n = 0; interrupts(); Serial.println(c / 2.0 / 7.5, 1); Serial.println(pulseIn(2, HIGH)); }`,
  board('uno', { read: k => (k === 'D2' ? { d: 0, v: 0, hz: 90 } : null) }), 140);
  const lines = out3.trim().split('\n');
  near(+lines[0], 12, 0.2, 'débit mesuré'); near(+lines[1], 5556, 2, 'demi-période en µs');
});
