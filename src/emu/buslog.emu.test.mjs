// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Analyseur de bus sur le vrai programme : un balayage I2C et une lecture de BMP280 compilés par arduino-cli et
// exécutés sur l'ATmega328P émulé ; l'analyseur doit voir chaque adresse (NACK sans module, ACK pour le BMP280),
// les octets échangés et le texte du port série. Sans arduino-cli, ignoré. node --test src/emu/buslog.emu.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hasCli, compileSketch, fakeBoard, boot, runFor } from './testkit.mjs';
import { createBusLog, describe } from '../sim/buslog.js';

const src = f => fs.readFileSync(new URL(`./corpus/${f}`, import.meta.url), 'utf8');

test('Analyseur de bus : balayage I2C et BMP280 sur l’Uno émulé', { skip: !hasCli && 'arduino-cli absent' }, () => {
  const log = createBusLog({ max: 20000 });
  const { hw } = fakeBoard({ modules: [{ type: 'bmp280', addr: [0x76] }] });
  let rt = null;
  hw.probe = log.probe('uno', () => (rt ? rt.clock() : 0));
  rt = boot(compileSketch(src('i2c_scan.ino')), hw);
  runFor(rt, 800);
  const i2c = log.list().filter(r => r.bus === 'i2c');
  assert.ok(i2c.length >= 100, `balayage : ${i2c.length} adresses vues`);
  const at = a => i2c.filter(r => r.addr === a);
  assert.ok(at(0x76).length && at(0x76).every(r => r.ack), 'le BMP280 acquitte 0x76');
  assert.ok(at(0x3c).length && at(0x3c).every(r => !r.ack), 'adresse vide : NACK');
  const tx = log.list().filter(r => r.bus === 'uart' && r.dir === 'tx').map(r => String.fromCharCode(...r.bytes)).join('');
  assert.match(tx, /found=1/, 'le texte du port série passe aussi par l’analyseur (un module trouvé : le BMP280)');

  const log2 = createBusLog({ max: 20000 }), b2 = fakeBoard({ modules: [{ type: 'bmp280', addr: [0x76] }] });
  let rt2 = null;
  b2.hw.probe = log2.probe('uno', () => (rt2 ? rt2.clock() : 0));
  rt2 = boot(compileSketch(src('bmp280_raw.ino')), b2.hw);
  runFor(rt2, 600);
  const id = log2.list().find(r => r.bus === 'i2c' && r.addr === 0x76 && r.write && r.bytes.length && r.bytes[0].v === 0xd0);
  assert.ok(id, 'registre d’identification 0xD0 adressé : ' + log2.list().slice(0, 4).map(describe).join(' / '));
  const reply = log2.list().find(r => r.bus === 'i2c' && r.addr === 0x76 && !r.write && r.id > id.id);
  assert.ok(reply && reply.bytes[0].v === 0x58, 'le BMP280 répond 0x58 : ' + (reply ? describe(reply) : 'rien'));
});

test('Analyseur de bus : horloge DS3231 et mémoire AT24C256 (NACK pendant le cycle d’écriture) sur l’Uno émulé', { skip: !hasCli && 'arduino-cli absent' }, () => {
  const run = (file, modules, ms) => {
    const log = createBusLog({ max: 20000 }), { hw } = fakeBoard({ modules });
    let rt = null;
    hw.probe = log.probe('uno', () => (rt ? rt.clock() : 0));
    rt = boot(compileSketch(src(file)), hw);
    runFor(rt, ms);
    return log.list().filter(r => r.bus === 'i2c');
  };
  const rtc = run('ds3231_rtclib.ino', [{ type: 'ds3231', addr: [0x68, 0x57], data: { temp: 21.3 } }], 600);
  const set = rtc.find(r => r.addr === 0x68 && r.write && r.bytes.length === 8 && r.bytes[0].v === 0);
  assert.ok(set, 'adjust() : pointeur 0 puis 7 registres de l’heure');
  assert.deepEqual(set.bytes.slice(1).map(b => b.v), [0x59, 0x59, 0x23, 4, 0x28, 0x02, 0x30], '23:59:59, jeudi 28/02/2030 en BCD');
  assert.ok(rtc.some(r => r.addr === 0x68 && !r.write && r.ack && r.bytes.length === 7), 'now() : 7 octets lus');
  const ee = run('at24c256_wire.ino', [{ type: 'at24c256', addr: [0x50], mem: { ee: '48656c6c6f' } }], 300);
  assert.ok(ee.some(r => r.addr === 0x50 && !r.write && r.bytes.map(b => b.v).join() === '72,101,108,108,111'), '« Hello » relu');
  assert.ok(ee.some(r => r.addr === 0x50 && r.write && !r.ack), 'adresse non acquittée pendant le cycle d’écriture');
});
