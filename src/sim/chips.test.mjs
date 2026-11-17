// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Circuits logiques (sim/chips.js) : 74HC595, 74HC165, MCP23017, PCF8574, PCA9685. Calcul du circuit (sorties qui
// allument une LED, surcharges vues par le vérificateur), simulateur intégré (shiftOut, shiftIn, bibliothèques
// Adafruit_MCP23X17, PCF8574, Adafruit_PWMServoDriver) et registres I2C d'après les fiches.
// node --test src/sim/chips.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARDS, boardOf } from './boards.js';
import { PARTS } from './parts.js';
import { INPUTS } from './models.js';
import { analyze, inspect } from './circuit.js';
import { solveDC } from './dc.js';
import { chipState, chipOut, chipI2c, chipDriver, netLevel, chipAddr, resetChips } from './chips.js';
import { driveActuators } from './actuators.js';
import { compile } from '../prog/lang.js';
import { createRuntime } from '../prog/runtime.js';
import { loadProject } from '../check/load.js';
import { checkProject } from '../check/check.js';

/* ---------- Montage fait à la main, analyse réelle ---------- */
const keys = t => (BOARDS[t] ? [...Object.keys(BOARDS[t].gpio), ...Object.keys(BOARDS[t].power), 'GND'] : /^res-/.test(t) ? ['1', '2'] : PARTS[t].pins.map(p => p.pin));
function bench() {
  const comps = [], wires = [];
  const b = {
    comps, wires,
    add(type) { const c = { id: type + '_' + comps.length, type, name: type.toUpperCase() + comps.length, pins: Object.fromEntries(keys(type).map(k => [k, {}])), inp: { ...(INPUTS[type] || {}) } }; comps.push(c); return c; },
    wire(a, ka, c, kc) { wires.push({ a: { comp: a, key: ka }, b: { comp: c, key: kc }, progress: 1 }); },
    A: () => analyze(comps, wires),
    solve(rt) { return solveDC(comps, b.A(), { prof: boardOf, pinState: (c, k) => (rt && boardOf(c) ? rt.pins.get(k) || null : null), sensorVolts: () => null }); },
    /** Pont vers le montage pour le simulateur intégré, comme makeHw (src/prog/panel.js). */
    hw(kind, u, bus = []) {
      let rt = null;
      const gpio = g => { const p = rt && g.comp === u && rt.pins.get(g.key); return p && p.mode === 1 ? (p.d ? 1 : 0) : null; };
      const at = k => { const A = b.A(), out = []; for (const m of A.members({ comp: u, key: k })) if (m.comp !== u) out.push({ comp: m.comp, pin: m.key }); return out; };
      return {
        kind, label: kind, prof: BOARDS[kind], read: () => null, echo: () => null, onPin: () => null, at,
        bus: types => bus.filter(d => types.includes(d.comp.type)).map(c => ({ comp: c.comp, addr: chipAddr(c.comp, b.A()) })),
        i2c: () => bus.map(c => ({ comp: c.comp, addr: chipAddr(c.comp, b.A()) })),
        status: () => ({ ok: true, msg: '' }), data: () => null,
        node: (c, k) => netLevel(b.A(), { comp: c, key: k }, gpio),
        set rt(r) { rt = r; }
      };
    }
  };
  return b;
}
function run(src, hw, ms = 200) {
  const c = compile(src, { board: hw.kind });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  hw.rt = rt;
  for (let t = 0; t < ms; t += 16) rt.run(16);
  assert.notEqual(rt.state, 'error', rt.error && rt.error.msg);
  rt.out = rt.takeSerial();
  return rt;
}
/** 74HC595 alimenté par la carte : OE à la masse, MR au 5 V. */
function hc595On(b, u) {
  const ic = b.add('hc595');
  b.wire(ic, 'VCC', u, '5V'); b.wire(ic, 'GND', u, 'GND'); b.wire(ic, 'OE', u, 'GND'); b.wire(ic, 'MR', u, '5V');
  return ic;
}
/** LED et sa résistance entre une sortie de puce et la masse. */
function ledOn(b, u, ic, key, res = 'res-220') {
  const r = b.add(res), l = b.add('led-red');
  b.wire(ic, key, r, '1'); b.wire(r, '2', l, 'A'); b.wire(l, 'K', u, 'GND');
  return l;
}

/* ---------- Calcul du circuit ---------- */
test('74HC595 : une LED sur Q3 s’allume quand le bit 3 est à 1, s’éteint quand il est à 0', () => {
  const b = bench(), u = b.add('uno'), ic = hc595On(b, u), l = ledOn(b, u, ic, 'Q3');
  chipState(ic).latch = 0b00001000;
  let d = b.solve();
  assert.ok(d.ok);
  const on = d.leds.get(l);
  assert.ok(on.on && on.mA > 8 && on.mA < 13, `LED allumée (${on.mA} mA)`); // (5 − 2) ÷ (220 + 50 + 15) ≈ 10,5 mA
  assert.ok(Math.abs(d.injections().get(`${ic.id}|VCC`) + on.mA) < 0.01, 'le courant de la sortie entre par VCC');
  chipState(ic).latch = 0b11110111;
  d = b.solve();
  assert.ok(!d.leds.get(l).on, 'bit 3 à 0 : éteinte');
  // OE au niveau haut : sorties en haute impédance.
  const b2 = bench(), u2 = b2.add('uno'), ic2 = b2.add('hc595');
  b2.wire(ic2, 'VCC', u2, '5V'); b2.wire(ic2, 'GND', u2, 'GND'); b2.wire(ic2, 'OE', u2, '5V'); b2.wire(ic2, 'MR', u2, '5V');
  const l2 = ledOn(b2, u2, ic2, 'Q0'); chipState(ic2).latch = 1;
  assert.ok(!b2.solve().leds.get(l2).on, 'OE haut : LED éteinte');
});

test('Vérificateur : sortie de 74HC595 surchargée (J0326), huit LED à 220 Ω dépassent les 70 mA de la puce (J0327)', () => {
  const parts = [['uno', 'U'], ['hc595', 'IC'], ['led-red', 'L']];
  const base = [['IC', 'VCC', 'U', '5V'], ['IC', 'GND', 'U', 'GND'], ['IC', 'OE', 'U', 'GND'], ['IC', 'MR', 'U', '5V'], ['IC', 'DS', 'U', 'D11'], ['IC', 'SHCP', 'U', 'D12'], ['IC', 'STCP', 'U', 'D8']];
  const r = checkProject(loadProject({ comps: parts.map(([type, id]) => ({ id, type, name: id })), wires: [...base, ['IC', 'Q0', 'L', 'A'], ['L', 'K', 'U', 'GND']].map(([a, ka, c, kc]) => ({ a: [a, ka], b: [c, kc] })) }));
  const d = r.diags.find(x => x.code === 'J0326');
  assert.ok(d && d.level === 'error', r.diags.map(x => x.code).join(' '));
  assert.match(d.state, /toutes les sorties à 1/);
  assert.ok(d.m.value > 35);
  // Huit LED avec 220 Ω : ≈ 10,5 mA chacune, sous la limite par sortie, mais 84 mA pour toute la puce.
  const comps = [['uno', 'U'], ['hc595', 'IC']], links = [...base];
  for (let i = 0; i < 8; i++) { comps.push(['res-220', 'R' + i], ['led-red', 'L' + i]); links.push(['IC', 'Q' + i, 'R' + i, '1'], ['R' + i, '2', 'L' + i, 'A'], ['L' + i, 'K', 'U', 'GND']); }
  const all = checkProject(loadProject({ comps: comps.map(([type, id]) => ({ id, type, name: id })), wires: links.map(([a, ka, c, kc]) => ({ a: [a, ka], b: [c, kc] })) }));
  const t = all.diags.find(x => x.code === 'J0327');
  assert.ok(t && t.level === 'error', all.diags.map(x => x.code).join(' '));
  assert.ok(t.m.value > 70 && t.m.value < 100, `courant total ${t.m.value}`);
  assert.ok(!all.diags.some(x => x.code === 'J0326' && x.level === 'error'), 'chaque sortie reste sous 35 mA');
  // Avec 1 kΩ, tout passe.
  const ok = checkProject(loadProject({ comps: comps.map(([type, id]) => ({ id, type: type === 'res-220' ? 'res-1k' : type, name: id })), wires: links.map(([a, ka, c, kc]) => ({ a: [a, ka], b: [c, kc] })) }));
  assert.ok(!ok.diags.some(x => x.code === 'J0326' || x.code === 'J0327'), ok.diags.map(x => x.code).join(' '));
});

/* ---------- Simulateur intégré ---------- */
const SHIFT_OUT = `const int dataPin = 11, clockPin = 12, latchPin = 8;
void setup() {
  pinMode(dataPin, OUTPUT); pinMode(clockPin, OUTPUT); pinMode(latchPin, OUTPUT);
  digitalWrite(latchPin, LOW);
  shiftOut(dataPin, clockPin, MSBFIRST, 0b00100100); // Q5 et Q2
  digitalWrite(latchPin, HIGH);
}
void loop() {}`;

test('shiftOut + verrou : les LED de Q2 et Q5 s’allument, pas les autres', () => {
  const b = bench(), u = b.add('uno'), ic = hc595On(b, u);
  b.wire(ic, 'DS', u, 'D11'); b.wire(ic, 'SHCP', u, 'D12'); b.wire(ic, 'STCP', u, 'D8');
  const leds = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ledOn(b, u, ic, 'Q' + i));
  const rt = run(SHIFT_OUT, b.hw('uno', u));
  assert.equal(chipState(ic).latch, 0b00100100);
  const d = b.solve(rt);
  assert.deepEqual(leds.map(l => (d.leds.get(l).on ? 1 : 0)), [0, 0, 1, 0, 0, 1, 0, 0]);
});

test('Deux 74HC595 en cascade (Q7S → DS) : 16 bits avec deux shiftOut', () => {
  const b = bench(), u = b.add('uno'), a = hc595On(b, u), c = hc595On(b, u);
  for (const ic of [a, c]) { b.wire(ic, 'SHCP', u, 'D12'); b.wire(ic, 'STCP', u, 'D8'); }
  b.wire(a, 'DS', u, 'D11'); b.wire(a, 'Q7S', c, 'DS');
  run(`void setup() { pinMode(11, OUTPUT); pinMode(12, OUTPUT); pinMode(8, OUTPUT);
  digitalWrite(8, LOW); shiftOut(11, 12, MSBFIRST, 0xA5); shiftOut(11, 12, MSBFIRST, 0x3C); digitalWrite(8, HIGH); }
void loop() {}`, b.hw('uno', u));
  assert.equal(chipState(a).latch, 0x3c, 'première puce : le dernier octet');
  assert.equal(chipState(c).latch, 0xa5, 'seconde puce : le premier octet, passé par Q7S');
});

test('Bit à bit sans shiftOut (digitalWrite seulement) : le 74HC595 suit aussi', () => {
  const b = bench(), u = b.add('uno'), ic = hc595On(b, u);
  b.wire(ic, 'DS', u, 'D2'); b.wire(ic, 'SHCP', u, 'D3'); b.wire(ic, 'STCP', u, 'D4');
  run(`void setup() { pinMode(2, OUTPUT); pinMode(3, OUTPUT); pinMode(4, OUTPUT);
  for (int i = 7; i >= 0; i--) { digitalWrite(2, (0x81 >> i) & 1); digitalWrite(3, HIGH); digitalWrite(3, LOW); }
  digitalWrite(4, HIGH); digitalWrite(4, LOW); }
void loop() {}`, b.hw('uno', u));
  assert.equal(chipState(ic).latch, 0x81);
});

test('shiftIn + 74HC165 : huit boutons (tirage 10 kΩ, appui vers la masse) lus en un octet', () => {
  const b = bench(), u = b.add('uno'), ic = b.add('hc165');
  b.wire(ic, 'VCC', u, '5V'); b.wire(ic, 'GND', u, 'GND'); b.wire(ic, 'DS', u, 'GND'); b.wire(ic, 'CE', u, 'GND');
  b.wire(ic, 'PL', u, 'D8'); b.wire(ic, 'CP', u, 'D12'); b.wire(ic, 'Q7', u, 'D11');
  const pressed = [1, 0, 0, 1, 0, 1, 1, 0]; // D0 … D7
  pressed.forEach((p, i) => {
    const r = b.add('res-10k'), bt = b.add('button');
    b.wire(r, '1', u, '5V'); b.wire(r, '2', ic, 'D' + i); b.wire(bt, '1', ic, 'D' + i); b.wire(bt, '2', u, 'GND');
    bt.inp.pressed = !!p;
  });
  const rt = run(`void setup() {
  Serial.begin(9600);
  pinMode(8, OUTPUT); pinMode(12, OUTPUT); pinMode(11, INPUT);
  digitalWrite(12, HIGH); // horloge haute avant le chargement : pas de front avant la lecture de D7
  digitalWrite(8, LOW); delayMicroseconds(5); digitalWrite(8, HIGH);
  byte v = shiftIn(11, 12, MSBFIRST);
  Serial.println(v, BIN);
}
void loop() {}`, b.hw('uno', u));
  // Appuyé = 0 : D7 … D0 = 1 0 0 1 0 1 1 0.
  assert.equal(rt.out.trim(), '10010110');
});

test('Adafruit_MCP23X17 : digitalWrite sur GPA0 allume la LED, un bouton sur GPB0 se lit avec INPUT_PULLUP', () => {
  const b = bench(), u = b.add('uno'), m = b.add('mcp23017'), bt = b.add('button');
  b.wire(m, 'VCC', u, '5V'); b.wire(m, 'GND', u, 'GND'); b.wire(m, 'SDA', u, 'A4'); b.wire(m, 'SCL', u, 'A5');
  b.wire(bt, '1', m, 'GPB0'); b.wire(bt, '2', u, 'GND'); bt.inp.pressed = true;
  const l = ledOn(b, u, m, 'GPA0');
  const rt = run(`#include <Adafruit_MCP23X17.h>
Adafruit_MCP23X17 mcp;
void setup() {
  Serial.begin(9600);
  if (!mcp.begin_I2C()) Serial.println("absent");
  mcp.pinMode(0, OUTPUT);
  mcp.digitalWrite(0, HIGH);
  mcp.pinMode(8, INPUT_PULLUP); mcp.pinMode(9, INPUT_PULLUP);
  Serial.print(mcp.digitalRead(8)); Serial.println(mcp.digitalRead(9));
}
void loop() {}`, b.hw('uno', u, [{ comp: m }]));
  assert.equal(rt.out.trim(), '01', 'bouton appuyé : 0 ; GPB1 libre, tirée : 1');
  const d = b.solve(rt);
  assert.ok(d.leds.get(l).on && d.leds.get(l).mA > 5, `LED allumée (${d.leds.get(l).mA} mA)`);
  assert.deepEqual([chipState(m).reg[0x00], chipState(m).reg[0x14], chipState(m).reg[0x0d]], [0xfe, 0x01, 0x03], 'IODIRA, OLATA, GPPUB');
  assert.equal(chipAddr(m, b.A())[0], 0x20);
});

test('Adafruit_PWMServoDriver : setPWM(0, 0, 307) à 50 Hz place le servo à ≈ 90° (impulsion de 1,5 ms)', () => {
  const b = bench(), u = b.add('uno'), p = b.add('pca9685'), sv = b.add('servo');
  b.wire(p, 'VCC', u, '5V'); b.wire(p, 'GND', u, 'GND'); b.wire(p, 'SDA', u, 'A4'); b.wire(p, 'SCL', u, 'A5');
  b.wire(sv, 'SIG', p, 'PWM0'); b.wire(sv, 'VCC', u, '5V'); b.wire(sv, 'GND', u, 'GND');
  const l = ledOn(b, u, p, 'PWM4', 'res-330');
  const rt = run(`#include <Adafruit_PWMServoDriver.h>
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);
void setup() {
  Serial.begin(9600);
  pwm.begin();
  pwm.setPWMFreq(50);
  pwm.setPWM(0, 0, 307);
  pwm.setPWM(4, 0, 1024);
  Serial.println(pwm.readPrescale());
}
void loop() {}`, b.hw('uno', u, [{ comp: p }]));
  assert.equal(rt.out.trim(), '121', 'prescale = round(25 MHz ÷ (4096 × 50)) − 1');
  const o = chipOut(p, 'PWM0'), ms = o.duty * 1000 / o.freq;
  assert.ok(Math.abs(o.freq - 50) < 0.1 && Math.abs(ms - 1.5) < 0.02, `${o.freq} Hz, ${ms} ms`);
  assert.ok(Math.abs(o.servo - 90) < 4, `angle ${o.servo}`);
  // Le servo branché sur la voie 0 tourne vers cet angle (src/sim/actuators.js).
  const A = b.A(), ins = new Map(b.comps.map(c => [c, inspect(c, A, PARTS[c.type])])), d = b.solve(rt);
  assert.notEqual(ins.get(sv).level, 'err', 'servo bien câblé : sa commande vient du PCA9685');
  assert.ok(chipDriver(A, { comp: sv, key: 'SIG' }));
  sv.servoA = 0;
  for (let i = 0; i < 10; i++) driveActuators(b.comps, { ins, rts: new Map(), A, dc: d }, 0.1);
  assert.ok(Math.abs(sv.servoA - 90) < 4, `servo à ${sv.servoA}°`);
  // LED à 25 % : courant moyen ≈ un quart de celui de l'état haut.
  const led = d.leds.get(l);
  assert.ok(led.mA > 0.5 && led.mA < 3, `LED en PWM : ${led.mA} mA moyens`);
});

test('PCF8574 (Rob Tillaart) : un 0 allume une LED reliée au VCC, un 1 laisse lire un bouton', () => {
  const b = bench(), u = b.add('uno'), x = b.add('pcf8574'), bt = b.add('button'), r = b.add('res-330'), l = b.add('led-red');
  b.wire(x, 'VCC', u, '5V'); b.wire(x, 'GND', u, 'GND'); b.wire(x, 'SDA', u, 'A4'); b.wire(x, 'SCL', u, 'A5'); b.wire(x, 'A0', u, '5V');
  b.wire(r, '1', u, '5V'); b.wire(r, '2', l, 'A'); b.wire(l, 'K', x, 'P0');
  b.wire(bt, '1', x, 'P7'); b.wire(bt, '2', u, 'GND'); bt.inp.pressed = true;
  assert.equal(chipAddr(x, b.A())[0], 0x21, 'A0 au VCC : 0x21');
  const rt = run(`#include <PCF8574.h>
PCF8574 pcf(0x21);
void setup() { Serial.begin(9600); Wire.begin(); pcf.begin(); pcf.write(0, LOW); Serial.print(pcf.read(7)); Serial.println(pcf.read(6)); }
void loop() {}`, b.hw('uno', u, [{ comp: x }]));
  assert.equal(rt.out.trim(), '01');
  const d = b.solve(rt);
  assert.ok(d.leds.get(l).on, 'LED active à l’état bas allumée');
  chipState(x).out = 0xff;
  assert.ok(!b.solve(rt).leds.get(l).on, 'un 1 (100 µA) ne l’allume pas');
});

/* ---------- Registres d'après les fiches ---------- */
test('MCP23017 : valeurs à la mise sous tension, pointeur auto-incrémenté qui revient à 00h, mode octet (SEQOP)', () => {
  const c = { id: 'm', type: 'mcp23017', pins: {} }, d = chipI2c(c);
  d.start(true); d.write(0x00); d.stop();
  d.start(false); const r = Array.from({ length: 0x17 }, () => d.read()); d.stop();
  assert.deepEqual(r.slice(0, 2), [0xff, 0xff], 'IODIR = 1111 1111');
  assert.equal(r[0x16], 0xff, 'après OLATB (15h), retour à IODIRA (00h)');
  d.start(true); d.write(0x0a); d.write(0x20); d.stop(); // IOCON.SEQOP = 1
  d.start(true); d.write(0x14); d.write(0x11); d.write(0x22); d.write(0x33); d.stop();
  assert.deepEqual([c.icState.reg[0x14], c.icState.reg[0x15]], [0x33, 0x22], 'la paire OLATA/OLATB, en alternance');
  resetChips([c]); assert.equal(c.icState, null);
});

test('PCA9685 : MODE1 = 0x11, PRE_SCALE modifiable seulement en sommeil, ALL_LED, priorité de « toujours éteinte »', () => {
  const c = { id: 'p', type: 'pca9685', pins: {} }, d = chipI2c(c), w = (...b) => { d.start(true); b.forEach(x => d.write(x)); d.stop(); };
  const rd = r => { d.start(true); d.write(r); d.start(false); const v = d.read(); d.stop(); return v; };
  assert.equal(rd(0x00), 0x11); assert.equal(rd(0xfe), 0x1e);
  w(0x00, 0x01); w(0xfe, 0x79); assert.equal(rd(0xfe), 0x1e, 'réveillé : PRE_SCALE ignoré');
  w(0x00, 0x11); w(0xfe, 0x01); assert.equal(rd(0xfe), 3, 'au moins 3');
  w(0x00, 0x21); // réveillé, auto-incrément
  w(0xfa, 0x00, 0x00, 0x00, 0x08); // ALL_LED : ON = 0, OFF = 2048
  assert.ok(Math.abs(chipOut(c, 'PWM9').duty - 0.5) < 1e-9);
  w(0x06 + 4 * 2, 0x00, 0x10, 0x00, 0x10); // voie 2 : toujours allumée ET toujours éteinte
  assert.equal(chipOut(c, 'PWM2').duty, 0);
  assert.equal(chipOut(c, 'PWM2', 1).duty, 0, 'OE haut');
});
