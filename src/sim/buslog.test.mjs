// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusLog, describe, toCsv } from './buslog.js';

test('I2C : adresse acquittée, écriture puis lecture ; adresse sans module : NACK', () => {
  let t = 0;
  const log = createBusLog(), p = log.probe('uno', () => t);
  p.i2cStart(); p.i2cConnect(0x76, true, true, 'BMP1'); p.i2cByte(0xd0, true); t = 0.1;
  p.i2cStart(); p.i2cConnect(0x76, false, true, 'BMP1'); p.i2cByte(0x58, false); p.i2cStop();
  p.i2cStart(); p.i2cConnect(0x3c, true, false); p.i2cStop();
  const rows = log.list();
  assert.equal(rows.length, 3);
  assert.equal(describe(rows[0]), '0x76 W : D0');
  assert.equal(describe(rows[1]), '0x76 R : 58*'); // dernier octet lu : non acquitté par la carte (fin de lecture)
  assert.equal(describe(rows[2]), '0x3C W NACK');
  assert.equal(rows[1].dev, 'BMP1'); assert.equal(rows[1].t, 0.1);
});

test('SPI : de la sélection à la désélection ; série : une ligne par transaction', () => {
  let t = 0;
  const log = createBusLog(), p = log.probe('uno', () => t);
  p.spiSelect('RFID1'); p.spiByte(0x37 | 0x80, 0); p.spiByte(0, 0x92); p.spiDeselect();
  for (const ch of 'OK\nT=21\n') p.uart('Serial', 'tx', ch.charCodeAt(0));
  t = 50; p.uart('Serial', 'rx', 0x41);
  const rows = log.list();
  assert.equal(describe(rows[0]), 'MOSI B7 00 | MISO 00 92');
  assert.equal(describe(rows[1]), 'Serial TX « OK\\n »');
  assert.equal(describe(rows[2]), 'Serial TX « T=21\\n »');
  assert.equal(describe(rows[3]), 'Serial RX « A »');
  assert.match(toCsv(rows), /^t_ms;carte;bus;module;detail\n0\.000;"uno";spi;"RFID1";/);
});

test('historique borné, pause, abonnés', () => {
  const log = createBusLog({ max: 5 }), p = log.probe('b'), seen = [];
  log.on(r => r && seen.push(r.id));
  for (let i = 0; i < 8; i++) { p.i2cConnect(i, true, true); p.i2cStop(); }
  assert.equal(log.list().length, 5); assert.equal(log.list()[0].addr, 3);
  log.paused = true; p.i2cConnect(9, true, true); log.paused = false;
  assert.equal(log.list().length, 5); assert.ok(seen.length >= 8);
});
