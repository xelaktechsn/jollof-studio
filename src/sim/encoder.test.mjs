// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Entrées : encodeur rotatif KY-040 (sim/encoder.js, prog/inputlibs.js, emu/devices/ky040.js) et télécommande
// infrarouge seule (irremote) qui vise tous les récepteurs du montage. node --test src/sim/encoder.test.mjs
// Les essais en mode fidèle (vrai programme compilé par arduino-cli) sont ignorés sans arduino-cli.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncTrack, stoffregen, CW, CCW, STEP_MS, GAP_MS } from './encoder.js';
import { encTurn, encPress, remotePress, periph, MODELS } from './models.js';
import { compile } from '../prog/lang.js';
import { createRuntime } from '../prog/runtime.js';
import { BOARDS } from './boards.js';
import { hasCli, compileSketch, fakeBoard, boot, runFor } from '../emu/testkit.mjs';

const enc = () => ({ id: 'enc' + Math.random(), type: 'ky040', name: 'ENC1', inp: { sw: false } });

test('KY-040 : quadrature d’un cran, CLK mène dans le sens horaire, DT dans l’autre ; crans à la suite', () => {
  assert.deepEqual(CW, [[0, 1], [0, 0], [1, 0], [1, 1]]);
  assert.deepEqual(CCW, [[1, 0], [0, 0], [0, 1], [1, 1]]);
  const c = enc(), tr = createEncTrack(c);
  encTurn(c, 1, 2); encTurn(c, -1);
  assert.equal(periph(c).pos, 1);
  const f = tr.pull(100);
  assert.equal(f.length, 12);
  assert.deepEqual(f.slice(0, 4).map(x => [x.clk, x.dt]), CW);
  assert.deepEqual(f.slice(8).map(x => [x.clk, x.dt]), CCW);
  assert.equal(f[0].t, 100); assert.equal(f[3].t, 100 + 3 * STEP_MS);
  assert.equal(f[4].t, f[3].t + GAP_MS, 'pause entre deux crans');
  for (let i = 1; i < f.length; i++) assert.ok(f[i].t > f[i - 1].t);
  assert.deepEqual(tr.pull(500), [], 'chaque cran ne se déroule qu’une fois');
  // Un suivi créé après coup ignore les crans déjà tournés.
  assert.deepEqual(createEncTrack(c).pull(0), []);
});

test('KY-040 : machine à états de la bibliothèque Encoder, 4 fronts par cran et signe selon l’ordre des broches', () => {
  const count = (seq, swap) => { let st = 3, pos = 0; for (const [a, b] of seq) { const r = stoffregen(st, swap ? b : a, swap ? a : b); st = r.state; pos += r.delta; } return pos; };
  assert.equal(count(CW, false), -4); // Encoder(CLK, DT)
  assert.equal(count(CW, true), 4); // Encoder(DT, CLK)
  assert.equal(count(CCW, true), -4);
  assert.equal(stoffregen(0, 1, 1).delta, 2); // front manqué : la bibliothèque compte 2 (cas 12)
});

test('KY-040 : modèle de l’onglet Simulation (position, SW)', () => {
  const c = enc();
  encTurn(c, 1, 3); encPress(c, true);
  const r = MODELS.ky040.read({}, { comp: c, inp: c.inp, v: 5 });
  assert.match(r.value, /3/);
  assert.deepEqual(r.out.SW, { d: 0, v: 0 });
  assert.equal(r.out.CLK.d, 1);
  encPress(c, false);
  assert.equal(MODELS.ky040.read({}, { comp: c, inp: c.inp, v: 5 }).out.SW, undefined);
});

/** Interpréteur sur un pont minimal : KY-040 sur D2 (CLK), D3 (DT), D4 (SW). */
function interp(src, c) {
  const wires = { D2: [{ comp: c, pin: 'CLK' }], D3: [{ comp: c, pin: 'DT' }], D4: [{ comp: c, pin: 'SW' }] };
  const k = compile(src, { board: 'uno' });
  assert.ok(k.ok, JSON.stringify(k.errors));
  const hw = { kind: 'uno', label: 'uno', prof: BOARDS.uno, read: () => null, echo: () => null, data: () => null, at: x => wires[x] || [], bus: () => [], i2c: () => [], onPin: () => null, status: () => ({ ok: true, msg: '' }), mem: () => ({ ee: '', prefs: {} }), level: () => null };
  const rt = createRuntime(k.js, hw, { globals: k.globals });
  return { rt, step(ms) { for (let t = 0; t < ms; t += 16) rt.run(16); }, lines() { return rt.takeSerial().trim().split('\n'); } };
}

test('KY-040 (interpréteur) : bibliothèque Encoder, 3 crans horaires (+12) puis un antihoraire, bouton SW', () => {
  const c = enc(), r = interp(`#include <Encoder.h>
Encoder e(3, 2);
long last = 0;
void setup() { Serial.begin(9600); pinMode(4, INPUT_PULLUP); }
void loop() { long p = e.read(); if (p != last && p % 4 == 0) { last = p; Serial.println(p); } if (digitalRead(4) == LOW) { Serial.println("SW"); delay(60); } }`, c);
  r.step(50); encTurn(c, 1, 3); r.step(200); encTurn(c, -1); r.step(100); encPress(c, true); r.step(40); encPress(c, false); r.step(80);
  assert.deepEqual(r.lines(), ['4', '8', '12', '8', 'SW']);
});

test('KY-040 (interpréteur) : lecture en boucle sans delay(), aucun front perdu, CLK et DT cohérents', () => {
  const c = enc(), r = interp(`int n = 0; int lastClk;
void setup() { Serial.begin(9600); lastClk = digitalRead(2); }
void loop() { int a = digitalRead(2); if (a != lastClk) { if (digitalRead(3) != a) n++; else n--; Serial.println(n); } lastClk = a; }`, c);
  r.step(30); encTurn(c, 1, 3); r.step(150); encTurn(c, -1, 2); r.step(150);
  assert.deepEqual(r.lines(), ['1', '2', '3', '4', '5', '6', '5', '4', '3', '2']);
});

test('KY-040 (interpréteur) : interruption sur CLK, chaque front à son heure malgré delay(100)', () => {
  const c = enc(), r = interp(`volatile int n = 0; volatile unsigned long t[8]; volatile int k = 0; int shown = 0;
void isr() { if (digitalRead(3) != digitalRead(2)) n++; else n--; if (k < 8) t[k++] = millis(); }
void setup() { Serial.begin(9600); attachInterrupt(digitalPinToInterrupt(2), isr, CHANGE); }
void loop() { delay(100); if (n != shown) { shown = n; Serial.println(n); } if (k == 4) { Serial.println(t[1] - t[0]); k = 9; } }`, c);
  r.step(30); encTurn(c, 1, 2); r.step(300); encTurn(c, -1, 3); r.step(300);
  const out = r.lines();
  assert.equal(out[0], '4');
  assert.ok(out.includes('-2'), out.join(' '));
  assert.equal(+out[1], 2 * STEP_MS, 'deux fronts de CLK d’un même cran : 2 × STEP_MS');
});

test('Télécommande seule : une touche atteint tous les récepteurs infrarouges du montage (IRrecv de l’interpréteur)', () => {
  const ir1 = { id: 'ir1', type: 'ir', name: 'IR1' }, ir2 = { id: 'ir2', type: 'ir', name: 'IR2' }, led = { id: 'l', type: 'led-red' };
  assert.equal(remotePress([ir1, led, ir2], 0x45), 2);
  assert.equal(periph(ir1).frames.at(-1).cmd, 0x45);
  assert.equal(periph(ir2).frames.at(-1).cmd, 0x45);
  const k = compile(`void setup() { Serial.begin(9600); IrReceiver.begin(2); }
void loop() { if (IrReceiver.decode()) { Serial.println(IrReceiver.decodedIRData.command, HEX); IrReceiver.resume(); } }`, { board: 'uno' });
  assert.ok(k.ok, JSON.stringify(k.errors));
  const ir = { id: 'ir3', type: 'ir', name: 'IR3' };
  const hw = { kind: 'uno', label: 'uno', prof: BOARDS.uno, read: () => null, echo: () => null, data: () => null, at: () => [], bus: () => [], i2c: () => [], onPin: (key, types) => (key === 'D2' && types.includes('ir') ? ir : null), status: () => ({ ok: true, msg: '' }), mem: () => ({ ee: '', prefs: {} }), level: () => null };
  const rt = createRuntime(k.js, hw, { globals: k.globals });
  rt.run(16); remotePress([ir], 0x5e); for (let i = 0; i < 5; i++) rt.run(16);
  assert.equal(rt.takeSerial(), '5E\n');
});

const skip = !hasCli && 'arduino-cli absent';
test('Télécommande seule (mode fidèle) : IRremote décode la touche reçue par le récepteur', { skip }, () => {
  const { hw, comps } = fakeBoard({ modules: [{ type: 'ir', pins: { OUT: 'D2' } }] });
  const rt = boot(compileSketch(`#include <IRremote.hpp>
void setup() { Serial.begin(115200); IrReceiver.begin(2, DISABLE_LED_FEEDBACK); }
void loop() { if (IrReceiver.decode()) { Serial.print("cmd=0x"); Serial.println(IrReceiver.decodedIRData.command, HEX); IrReceiver.resume(); } }`), hw);
  runFor(rt, 200);
  assert.equal(remotePress(comps, 0x40), 1);
  runFor(rt, 400);
  assert.match(rt.takeSerial(), /cmd=0x40\r\n/);
});

test('KY-040 (mode fidèle) : bibliothèque Encoder sur un vrai programme, sens et bouton', { skip }, () => {
  const { hw, comps } = fakeBoard({ modules: [{ type: 'ky040', pins: { CLK: 'D2', DT: 'D3', SW: 'D4' } }] });
  const rt = boot(compileSketch(`#include <Encoder.h>
Encoder e(2, 3);
long last = 0;
void setup() { Serial.begin(115200); pinMode(4, INPUT_PULLUP); }
void loop() { long p = e.read(); if (p != last && p % 4 == 0) { last = p; Serial.print("p="); Serial.println(p); } if (digitalRead(4) == LOW) { Serial.println("SW"); delay(200); } }`), hw);
  const c = comps[0];
  runFor(rt, 100); encTurn(c, 1, 2); runFor(rt, 200); encPress(c, true); runFor(rt, 100); encPress(c, false); runFor(rt, 300);
  // Encoder(CLK, DT) : le sens horaire compte en négatif, comme avec la vraie bibliothèque.
  assert.equal(rt.takeSerial(), 'p=-4\r\np=-8\r\nSW\r\n');
});
