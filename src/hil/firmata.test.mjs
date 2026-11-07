// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Client Firmata : décodage des messages, puis dialogue avec le vrai StandardFirmata (bibliothèque Firmata de
// l'IDE Arduino) qui tourne sur l'Uno émulé — le même programme que sur une carte réelle branchée en USB.
// node --test src/hil/firmata.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decoder, encode, createFirmata, MODE } from './firmata.js';
import { hasCli, compileSketch, fakeBoard, boot, runFor } from '../emu/testkit.mjs';

test('Décodage : version, nom du programme, entrées, capacités', () => {
  const got = [], feed = decoder(m => got.push(m));
  const name = [...'Std'].flatMap(c => [c.charCodeAt(0) & 0x7f, c.charCodeAt(0) >> 7]);
  feed([0xf9, 2, 5, 0xf0, 0x79, 2, 5, ...name, 0xf7, 0xe3, 0x7f, 0x07, 0x91, 0x05, 0x01]);
  feed([0xf0, 0x6c, 0, 1, 1, 1, 0x7f, 0, 1, 3, 8, 0x7f, 0xf7, 0xf0, 0x6a, 0x7f, 0x7f, 0, 1, 0xf7]);
  assert.deepEqual(got[0], { t: 'version', major: 2, minor: 5 });
  assert.deepEqual(got[1], { t: 'firmware', major: 2, minor: 5, name: 'Std' });
  assert.deepEqual(got[2], { t: 'analog', ch: 3, v: 1023 });
  assert.deepEqual(got[3], { t: 'digital', port: 1, bits: 0x85 });
  assert.deepEqual(got[4].pins[1], [{ mode: 0, res: 1 }, { mode: 3, res: 8 }]);
  assert.deepEqual(got[5].ch, [null, null, 0, 1]);
  // Message coupé en morceaux : même résultat.
  const g2 = [], f2 = decoder(m => g2.push(m));
  for (const b of [0xe0, 0x10, 0x04]) f2([b]);
  assert.deepEqual(g2, [{ t: 'analog', ch: 0, v: 528 }]);
  assert.deepEqual(encode.analogWrite(20, 300), [0xf0, 0x6f, 20, 0x2c, 0x02, 0, 0xf7]);
});

function standardFirmata() {
  const dirs = [path.join(os.homedir(), 'Documents/Arduino/libraries/Firmata/examples/StandardFirmata'), path.join(os.homedir(), 'Arduino/libraries/Firmata/examples/StandardFirmata')];
  const d = dirs.find(x => fs.existsSync(path.join(x, 'StandardFirmata.ino')));
  return d ? fs.readFileSync(path.join(d, 'StandardFirmata.ino'), 'utf8') : null;
}
const SRC = hasCli ? standardFirmata() : null;

test('StandardFirmata sur l’Uno émulé : sorties, PWM, servo, entrées numériques et analogiques', { skip: !SRC && 'arduino-cli ou bibliothèque Firmata absents' }, async () => {
  const inputs = { A0: { v: 2.5 }, D2: { d: 0 }, D4: { d: 1 } };
  const { hw } = fakeBoard({ inputs });
  const rt = boot(compileSketch(SRC), hw);
  let sink = null;
  const transport = { write: bytes => rt.send(String.fromCharCode(...bytes)), onData: fn => { sink = fn; } };
  const fm = createFirmata(transport, { timeout: 8000 });
  // La carte « tourne » pendant que le client attend ses réponses.
  const tick = setInterval(() => { runFor(rt, 10); const s = rt.takeSerial(); if (s && sink) sink([...s].map(c => c.charCodeAt(0) & 0xff)); }, 1);
  const wait = async (ms) => { await new Promise(r => setTimeout(r, ms)); };
  // La carte avance au rythme de la machine : sous charge (tests en parallèle), on attend l'effet, 5 s au plus.
  const until = async (ok) => { for (const end = Date.now() + 5000; !ok() && Date.now() < end;) await wait(20); };
  try {
    const info = await fm.ready();
    assert.match(info.name, /\.ino$/); // StandardFirmata annonce le nom de son fichier
    assert.ok(info.pins >= 20, `${info.pins} broches annoncées`);
    assert.equal(fm.analogPin(0), 14);
    assert.ok(fm.can(9, MODE.PWM) && !fm.can(2, MODE.PWM) && fm.can(9, MODE.SERVO));
    fm.digitalWrite(13, 1); fm.analogWrite(5, 64); fm.servoWrite(9, 90);
    fm.watchAnalog(0); fm.watchDigital(2, true); fm.watchDigital(4, false);
    await wait(250);
    await until(() => rt.pins.get('D9').servo != null && rt.pins.get('D5').pwm != null && fm.analog(0) != null && fm.digital(4) === 1);
    assert.equal(rt.pins.get('D13').d, 1);
    assert.ok(Math.abs(rt.pins.get('D5').pwm - 64 / 255) < 0.02, `PWM ${rt.pins.get('D5').pwm}`);
    assert.ok(Math.abs(rt.pins.get('D9').servo - 90) < 3, `servo ${rt.pins.get('D9').servo}`);
    assert.ok(Math.abs(fm.analog(0) - 512) <= 2, `A0 = ${fm.analog(0)}`);
    assert.equal(fm.digital(2), 0); assert.equal(fm.digital(4), 1);
    inputs.D2 = { d: 1 }; inputs.A0 = { v: 1.25 };
    await wait(250);
    await until(() => fm.digital(2) === 1 && Math.abs(fm.analog(0) - 256) <= 2);
    assert.equal(fm.digital(2), 1); assert.ok(Math.abs(fm.analog(0) - 256) <= 2);
    fm.digitalWrite(13, 0); fm.release();
    await wait(120);
    await until(() => rt.pins.get('D13').d === 0);
    assert.equal(rt.pins.get('D13').d, 0);
  } finally { clearInterval(tick); }
});
