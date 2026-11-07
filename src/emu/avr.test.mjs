// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mode fidèle de l'Uno : le vrai programme compilé (fixtures/blink.uno.hex) tourne dans l'ATmega328P émulé.
// node --test src/emu/avr.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAvrRuntime } from './avr.js';
import { parseHex } from './hex.js';
import { BOARDS } from '../sim/boards.js';

const HEX = fs.readFileSync(new URL('./fixtures/blink.uno.hex', import.meta.url), 'utf8');
/** Pont minimal vers le montage : A0 à 2,5 V, D2 en l'air (le tirage interne la tient à HIGH), ou à la masse. */
const hwOf = (d2 = null) => ({ prof: BOARDS.uno, kind: 'uno', read: k => (k === 'A0' ? { v: 2.5 } : k === 'D2' && d2 != null ? { d: d2 } : null) });
/** Fait tourner ms millisecondes de temps virtuel par tranches de 16 ms (une image). */
function runFor(rt, ms) { const t0 = rt.clock(); let guard = 0; while (rt.clock() < t0 + ms && guard++ < 10000) rt.run(16); }

test('HEX : lecture, sommes de contrôle', () => {
  const f = parseHex(HEX);
  assert.ok(f.some(b => b !== 0));
  assert.throws(() => parseHex(':0100000001FF\n'), /contrôle/);
});

test('Uno fidèle : sortie, PWM, série, ADC, tirage interne, tone(), servo', () => {
  const rt = createAvrRuntime(HEX, hwOf());
  let serial = '';
  rt.setSerialTap(t => { serial += t; });
  runFor(rt, 300);
  const d13 = rt.pins.get('D13'), d6 = rt.pins.get('D6'), d8 = rt.pins.get('D8'), d7 = rt.pins.get('D7'), d2 = rt.pins.get('D2');
  assert.equal(d13.mode, 1); assert.equal(d13.d, 1, 'D13 à HIGH pendant la première demi-seconde');
  assert.ok(Math.abs(d6.pwm - 64 / 255) < 0.02, `PWM de D6 : ${d6.pwm}`);
  assert.ok(Math.abs(d8.freq - 1000) < 30, `tone(8, 1000) : ${d8.freq} Hz`);
  assert.ok(d7.servo != null && Math.abs(d7.servo - 90) < 4, `servo sur D7 : ${d7.servo}°`);
  assert.equal(d2.mode, 2, 'INPUT_PULLUP');
  assert.match(serial, /A0=51[0-3]\r\n/);
  assert.match(serial, /^A0=51[0-3]\r\nD2=1\r\n/, 'le tirage interne agit dès pinMode, avant la première lecture');
  runFor(rt, 400);
  assert.equal(rt.pins.get('D13').d, 0, 'D13 retombe après delay(500)');
  assert.ok(rt.clock() >= 700);
  assert.equal(rt.state, 'run');
});

test('Uno fidèle : entrée mise à la masse, envoi série, sonde', () => {
  const rt = createAvrRuntime(HEX, hwOf(0));
  runFor(rt, 200);
  assert.match(rt.takeSerial(), /D2=0/);
  assert.deepEqual(rt.probe('D13').out, true);
  assert.equal(rt.probe('A0').v, 2.5);
});
