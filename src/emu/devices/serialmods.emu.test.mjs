// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Radio HC-12 et RS-485 MAX485 en mode fidèle, d'une carte émulée à l'autre (src/sim/serialmods.js par
// src/emu/devices/uart.js) : SoftwareSerial d'un Uno vers Serial1 d'un Mega, commandes AT avec SET à LOW, bus RS-485
// à deux Uno (sens commandé par DE et /RE), carte émulée et carte interprétée sur la même radio.
// Sans arduino-cli sur la machine, ces tests sont ignorés. node --test src/emu/devices/serialmods.emu.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCli, compileSketch, fakeBoard, boot } from '../testkit.mjs';
import { compile } from '../../prog/lang.js';
import { createRuntime } from '../../prog/runtime.js';
import { BOARDS } from '../../sim/boards.js';
import { createBusLog } from '../../sim/buslog.js';

const skip = !hasCli && 'arduino-cli absent';
function fw(src, modules, kind = 'uno', probe = null) {
  const { hw, comps } = fakeBoard({ kind, modules });
  if (probe) hw.probe = probe(() => rt.clock());
  var rt = boot(compileSketch(src, kind === 'mega' ? 'arduino:avr:mega' : 'arduino:avr:uno'), hw);
  return { rt, hw, comps, out: '', take() { this.out += rt.takeSerial(); return this.out; } };
}
function together(boards, ms, dt = 2) { for (let t = 0; t < ms; t += dt) for (const b of boards) b.rt.run(dt); boards.forEach(b => b.take()); }
function air(...boards) {
  const all = boards.flatMap(b => b.comps);
  for (const b of boards) b.hw.peers = types => all.filter(c => types.includes(c.type)).map(c => ({ comp: c, ok: true }));
}

const TX = `#include <SoftwareSerial.h>
SoftwareSerial hc12(10, 11); // RX, TX
int n = 0;
void setup() { Serial.begin(9600); hc12.begin(9600); }
void loop() { hc12.print("T="); hc12.println(20 + n++); delay(150); }`;
const RX_MEGA = `void setup() { Serial.begin(9600); Serial1.begin(9600); }
void loop() { while (Serial1.available()) Serial.write(Serial1.read()); }`;

test('HC-12 : un Uno (SoftwareSerial) envoie, un Mega (Serial1) reçoit sur le même canal', { skip }, () => {
  const a = fw(TX, [{ type: 'hc12', id: 'radioA', pins: { TXD: 'D10', RXD: 'D11' } }]);
  const b = fw(RX_MEGA, [{ type: 'hc12', id: 'radioB', pins: { TXD: 'D19', RXD: 'D18' } }], 'mega');
  air(a, b);
  together([a, b], 600);
  assert.match(b.out, /T=20\r\nT=21\r\nT=22\r\n/);
  // Autre canal : plus rien.
  b.comps[0].inp.hc12Ch = 9;
  const n = b.out.length;
  together([a, b], 400);
  assert.equal(b.out.length, n);
});

test('HC-12 : SET à LOW, AT+C005 puis AT+RX ; SET relevé, la radio passe sur le canal 5', { skip }, () => {
  const src = `#include <SoftwareSerial.h>
SoftwareSerial hc12(10, 11);
void cmd(const char *c) { hc12.print(c); delay(80); while (hc12.available()) Serial.write(hc12.read()); }
void setup() {
  Serial.begin(9600); hc12.begin(9600);
  pinMode(7, OUTPUT); digitalWrite(7, LOW); delay(50);
  cmd("AT"); cmd("AT+C005"); cmd("AT+RX");
  digitalWrite(7, HIGH); delay(50);
  Serial.println("fin");
}
void loop() {}`;
  const a = fw(src, [{ type: 'hc12', pins: { TXD: 'D10', RXD: 'D11', SET: 'D7' } }]);
  air(a);
  together([a], 800);
  assert.match(a.out, /^OK\r\nOK\+C005\r\nOK\+B9600\r\nOK\+RC005\r\nOK\+RP:\+20dBm\r\nOK\+FU3\r\nfin\r\n$/);
  assert.equal(a.comps[0].inp.hc12Ch, 5);
});

test('HC-12 : une carte émulée et une carte interprétée se parlent', { skip }, () => {
  const a = fw(TX, [{ type: 'hc12', id: 'radioA', pins: { TXD: 'D10', RXD: 'D11' } }]);
  const r = { type: 'hc12', id: 'radio-interp', name: 'HC12', inp: {}, periph: null };
  const c = compile(`#include <SoftwareSerial.h>
SoftwareSerial hc12(10, 11);
void setup() { Serial.begin(9600); hc12.begin(9600); }
void loop() { while (hc12.available()) Serial.write(hc12.read()); }`, { board: 'uno' });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const wires = { D10: [{ comp: r, pin: 'TXD' }], D11: [{ comp: r, pin: 'RXD' }] }, at = k => wires[k] || [];
  const hw = { kind: 'uno', label: 'uno', prof: BOARDS.uno, read: () => null, echo: () => null, data: () => null, at, bus: () => [], i2c: () => [], status: () => ({ ok: true, msg: '' }), mem: () => ({ ee: '', prefs: {} }), level: () => null, onPin: () => null };
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  const b = { rt, hw, comps: [r], out: '', take() { this.out += rt.takeSerial(); return this.out; } };
  air(a, b);
  together([a, b], 500);
  assert.match(b.out, /T=20\r\nT=21\r\n/);
});

const MASTER = `#include <SoftwareSerial.h>
SoftwareSerial rs(10, 11); // RO sur D10, DI sur D11
void setup() { Serial.begin(9600); rs.begin(9600); pinMode(2, OUTPUT); digitalWrite(2, LOW); }
void loop() {
  digitalWrite(2, HIGH); rs.print("?T\\n"); digitalWrite(2, LOW);
  unsigned long t0 = millis();
  while (millis() - t0 < 150) if (rs.available()) Serial.write(rs.read());
}`;
const SLAVE = `#include <SoftwareSerial.h>
SoftwareSerial rs(10, 11);
char buf[8]; byte n = 0;
void setup() { Serial.begin(9600); rs.begin(9600); pinMode(2, OUTPUT); digitalWrite(2, LOW); }
void loop() {
  while (rs.available()) {
    char c = rs.read();
    if (c != '\\n') { if (n < 7) buf[n++] = c; continue; }
    buf[n] = 0; n = 0;
    if (!strcmp(buf, "?T")) { delay(5); digitalWrite(2, HIGH); rs.print("T=24.5\\n"); digitalWrite(2, LOW); Serial.println("reponse"); }
  }
}`;

test('MAX485 : deux Uno sur une paire RS-485, question et réponse (DE et /RE sur D2) ; l’analyseur de bus voit les octets', { skip }, () => {
  const pins = { RO: 'D10', DI: 'D11', DE: 'D2', RE: 'D2' }, log = createBusLog();
  const m = fw(MASTER, [{ type: 'max485', id: 'rsM', pins, links: { A: [['rsS', 'A']], B: [['rsS', 'B']] } }]);
  const s = fw(SLAVE, [{ type: 'max485', id: 'rsS', pins, links: { A: [['rsM', 'A']], B: [['rsM', 'B']] } }], 'uno', clock => log.probe('S', clock));
  // Les modules de l'autre carte : fakeBoard ne connaît que les siens.
  const all = [...m.comps, ...s.comps];
  for (const b of [m, s]) b.hw.linked = (c, k) => ((c._m.links && c._m.links[k]) || []).map(([id, key]) => ({ comp: all.find(x => x.id === id), key }));
  together([m, s], 400);
  assert.match(s.out, /reponse\r\n/);
  assert.match(m.out, /T=24\.5\n/);
  const rows = log.list();
  assert.ok(rows.some(r => r.bus === 'uart' && r.dir === 'rx' && String.fromCharCode(...r.bytes).includes('?T')), JSON.stringify(rows.slice(0, 3)));
  assert.ok(rows.some(r => r.bus === 'uart' && r.dir === 'tx' && String.fromCharCode(...r.bytes).includes('T=24.5')));
});
