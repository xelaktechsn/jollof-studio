// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Afficheurs MAX7219 et TM1637 (sim/displays.js), écran LCD 20×4, horloges DS3231 et DS1307, mémoire AT24C256
// (sim/storage.js) : modèles des puces et bibliothèques du simulateur intégré (prog/devlibs.js).
// node --test src/sim/displays.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../prog/lang.js';
import { createRuntime } from '../prog/runtime.js';
import { BOARDS } from './boards.js';
import { maxChain, maxBytes, maxLoad, maxImage, maxState, tmFrame, tmImage, segText } from './displays.js';
import { storeI2c, localNow, fields } from './storage.js';
import { createBusLog } from './buslog.js';

let uid = 0;
const comp = (type, x = {}) => ({ type, id: type + ++uid, name: type.toUpperCase() + uid, pins: {}, ...x });
/** Carte factice : wires (broche → [{ comp, pin }]), bus I2C, liens entre modules (links : [[a, 'DOUT', b, 'DIN']]). */
function board(kind, o = {}) {
  const wires = o.wires || {}, links = o.links || [], mems = new Map();
  return {
    kind, label: kind, prof: BOARDS[kind],
    read: () => null, echo: () => null,
    onPin: (k, types) => { const h = (wires[k] || []).find(x => types.includes(x.comp.type)); return h ? h.comp : null; },
    at: k => wires[k] || [],
    bus: types => (o.bus || []).filter(d => types.includes(d.comp.type)),
    i2c: () => o.bus || [],
    status: () => ({ ok: true, msg: '' }),
    data: c => c.data || null,
    mem: () => o.mem || (o.mem = { ee: '', prefs: {} }), memChanged: () => {},
    compMem: c => mems.get(c.id) || (mems.set(c.id, o.compMem || {}), mems.get(c.id)),
    linked: (c, k) => links.flatMap(([a, ka, b, kb]) => (a === c && ka === k ? [{ comp: b, key: kb }] : b === c && kb === k ? [{ comp: a, key: ka }] : [])),
    probe: o.probe || null,
    self: () => ({ id: 'b', type: kind, name: kind }), net: () => ({}), netChanged: () => {}, level: () => null
  };
}
function start(src, hw) {
  const c = compile(src, { board: hw.kind });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  rt.out = '';
  rt.step = (n = 1, dt = 16) => { for (let i = 0; i < n; i++) { rt.run(dt); rt.out += rt.takeSerial(); } assert.notEqual(rt.state, 'error', rt.error && rt.error.msg); return rt; };
  return rt;
}
const warned = (rt, re) => [...rt.warnings.values()].some(w => re.test(w.msg));

/* ---------- MAX7219 ---------- */
test('MAX7219 : registres de la fiche, chaîne de deux modules (le premier mot va au plus loin)', () => {
  const a = comp('max7219m'), b = comp('max7219m');
  const linked = (c, k) => (c === a && k === 'DOUT' ? [{ comp: b, key: 'DIN' }] : c === b && k === 'DIN' ? [{ comp: a, key: 'DOUT' }] : []);
  const chain = maxChain(a, linked);
  assert.deepEqual(chain, [a, b]);
  assert.equal(maxImage(a).on, false, 'arrêt à la mise sous tension');
  // Mot pour b (le plus loin) d'abord, puis pour a.
  maxBytes(chain, [0x0c, 0x01, 0x0c, 0x01]); maxLoad(chain); // sortie de l'arrêt
  maxBytes(chain, [0x0b, 0x07, 0x0b, 0x07]); maxLoad(chain); // 8 lignes
  maxBytes(chain, [0x01, 0x81, 0x00, 0x00]); maxLoad(chain); // ligne 0 de b, rien pour a
  assert.equal(maxImage(b).mat[0], 0x81);
  assert.equal(maxImage(a).mat[0], 0);
  maxBytes(chain, [0x0f, 0x01, 0x00, 0x00]); maxLoad(chain); // test d'affichage sur b
  assert.deepEqual(maxImage(b).mat, new Array(8).fill(0xff));
  // Limite de balayage : les lignes au-delà restent éteintes.
  maxBytes(chain, [0x00, 0x00, 0x0b, 0x02]); maxLoad(chain);
  maxBytes(chain, [0x00, 0x00, 0x05, 0xff]); maxLoad(chain);
  assert.equal(maxImage(a).mat[4], 0);
  // 7 segments, décodage code B : DIG0 est le chiffre de droite.
  const s = comp('max7219s');
  for (const w of [[0x0c, 1], [0x0b, 7], [0x09, 0xff], [0x01, 0x05], [0x02, 0x84], [0x03, 0x0a]]) { maxBytes([s], w); maxLoad([s]); }
  const img = maxImage(s);
  assert.equal(segText(img.seg), '00000-4.5', 'code B : un chiffre à 0 affiche « 0 »');
  assert.equal(maxState(s).decode, 0xff);
});

test('LedControl : deux matrices en chaîne, setRow / setLed / setColumn, intensité ; afficheur à 8 chiffres', () => {
  const a = comp('max7219m'), b = comp('max7219m'), hw = board('uno', {
    wires: { D12: [{ comp: a, pin: 'DIN' }], D11: [{ comp: a, pin: 'CLK' }, { comp: b, pin: 'CLK' }], D10: [{ comp: a, pin: 'CS' }, { comp: b, pin: 'CS' }] },
    links: [[a, 'DOUT', b, 'DIN']]
  });
  const rt = start(`#include <LedControl.h>
LedControl lc = LedControl(12, 11, 10, 2);
void setup() {
  for (int i = 0; i < lc.getDeviceCount(); i++) { lc.shutdown(i, false); lc.setIntensity(i, 8); lc.clearDisplay(i); }
  lc.setRow(0, 0, B10100000);
  lc.setLed(1, 7, 7, true);
  lc.setColumn(1, 0, B11000000);
}
void loop() {}`, hw).step(2);
  assert.equal(a.progScreen.mat[0], 0xa0);
  assert.equal(b.progScreen.mat[7], 0x01);
  assert.equal(b.progScreen.mat[0], 0x80); assert.equal(b.progScreen.mat[1], 0x80);
  assert.equal(a.progScreen.on, true);
  assert.ok(Math.abs(a.progScreen.level - 17 / 31) < 1e-9, 'intensité 8 : 17/32 contre 31/32 au plus');
  assert.equal(rt.state, 'run');
  const s = comp('max7219s'), hw2 = board('uno', { wires: { D12: [{ comp: s, pin: 'DIN' }], D11: [{ comp: s, pin: 'CLK' }], D10: [{ comp: s, pin: 'CS' }] } });
  start(`#include <LedControl.h>
LedControl lc = LedControl(12, 11, 10, 1);
void setup() { lc.shutdown(0, false); lc.setDigit(0, 0, 7, false); lc.setDigit(0, 1, 2, true); lc.setChar(0, 2, 'H', false); lc.setChar(0, 3, '-', false); }
void loop() {}`, hw2).step(2);
  assert.equal(s.progScreen.text, '-H2.7');
});

test('MAX7219 : shiftOut et SPI.transfer écrits directement par le programme', () => {
  const m = comp('max7219m'), hw = board('uno', { wires: { D11: [{ comp: m, pin: 'DIN' }], D13: [{ comp: m, pin: 'CLK' }], D10: [{ comp: m, pin: 'CS' }] } });
  start(`void send(byte reg, byte val) { digitalWrite(10, LOW); shiftOut(11, 13, MSBFIRST, reg); shiftOut(11, 13, MSBFIRST, val); digitalWrite(10, HIGH); }
void setup() { pinMode(10, OUTPUT); pinMode(11, OUTPUT); pinMode(13, OUTPUT); digitalWrite(10, HIGH);
  send(0x0C, 1); send(0x0B, 7); send(0x03, 0x3C); }
void loop() {}`, hw).step(2);
  assert.equal(m.progScreen.mat[2], 0x3c);
  const m2 = comp('max7219m'), hw2 = board('uno', { wires: { D11: [{ comp: m2, pin: 'DIN' }], D13: [{ comp: m2, pin: 'CLK' }], D10: [{ comp: m2, pin: 'CS' }] } });
  start(`#include <SPI.h>
void send(byte reg, byte val) { digitalWrite(10, LOW); SPI.transfer(reg); SPI.transfer(val); digitalWrite(10, HIGH); }
void setup() { pinMode(10, OUTPUT); SPI.begin(); send(0x0C, 1); send(0x0B, 7); send(0x08, 0x81); }
void loop() {}`, hw2).step(2);
  assert.equal(m2.progScreen.mat[7], 0x81);
});

test('MD_MAX72XX (FC16_HW) : setPoint, colonne 0 à droite du module 0', () => {
  const a = comp('max7219m'), hw = board('uno', { wires: { D10: [{ comp: a, pin: 'CS' }], D11: [{ comp: a, pin: 'DIN' }], D13: [{ comp: a, pin: 'CLK' }] } });
  start(`#include <MD_MAX72xx.h>
#define HARDWARE_TYPE MD_MAX72XX::FC16_HW
MD_MAX72XX mx = MD_MAX72XX(HARDWARE_TYPE, 10, 1);
void setup() { mx.begin(); mx.control(MD_MAX72XX::INTENSITY, 3); mx.setPoint(0, 0, true); mx.setPoint(2, 7, true); }
void loop() {}`, hw).step(2);
  assert.equal(a.progScreen.mat[0], 0x01, 'colonne 0 : à droite');
  assert.equal(a.progScreen.mat[2], 0x80, 'colonne 7 : à gauche');
});

/* ---------- TM1637 ---------- */
test('TM1637 : trames de la fiche, showNumberDecEx avec deux-points, luminosité', () => {
  const t = comp('tm1637');
  tmFrame(t, [0x40]); tmFrame(t, [0xc0, 0x06, 0x5b | 0x80, 0x4f, 0x66]); tmFrame(t, [0x8f]);
  assert.equal(segText(tmImage(t).seg, true), '12:34');
  assert.equal(tmImage(t).on, true);
  const d = comp('tm1637'), hw = board('uno', { wires: { D2: [{ comp: d, pin: 'CLK' }], D3: [{ comp: d, pin: 'DIO' }] } });
  const rt = start(`#include <TM1637Display.h>
TM1637Display display(2, 3);
int n = 0;
void setup() { display.showNumberDec(42); delay(100); }
void loop() { display.setBrightness(7); display.showNumberDecEx(1205, 0b01000000, true); delay(500); display.showNumberDec(-7, false); delay(1000); }`, hw);
  rt.step(1);
  assert.equal(d.progScreen.on, false, 'luminosité jamais réglée : éteint');
  assert.ok(warned(rt, /setBrightness/));
  rt.step(10);
  assert.equal(d.progScreen.text, '12:05');
  assert.equal(d.progScreen.level, 1);
  rt.step(40);
  assert.equal(d.progScreen.text, '-7');
});

/* ---------- LCD 20×4 ---------- */
test('LCD 20×4 : quatre lignes de 20 caractères', () => {
  const lcd = comp('lcd2004'), hw = board('uno', { bus: [{ comp: lcd, addr: [0x27] }] });
  start(`#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 20, 4);
void setup() { lcd.init(); lcd.backlight(); lcd.setCursor(0, 3); lcd.print("Ligne 4 de vingt car"); lcd.setCursor(2, 2); lcd.print("trois"); }
void loop() {}`, hw).step(2);
  assert.equal(lcd.progScreen.lines.length, 4);
  assert.equal(lcd.progScreen.lines[3], 'Ligne 4 de vingt car');
  assert.equal(lcd.progScreen.lines[2].trimEnd(), '  trois');
});

/* ---------- Horloges ---------- */
test('DS3231 : heure de l’ordinateur au départ, avance avec le temps simulé, adjust, température, analyseur de bus', () => {
  const rtc = comp('ds3231', { data: { temp: 22.6 } }), log = createBusLog();
  const hw = board('uno', { bus: [{ comp: rtc, addr: [0x68, 0x57] }], probe: log.probe('b') });
  const before = localNow();
  const rt = start(`#include <RTClib.h>
RTC_DS3231 rtc;
void setup() {
  Serial.begin(9600);
  if (!rtc.begin()) Serial.println("absent");
  Serial.println(rtc.lostPower() ? "perdu" : "ok");
  DateTime t = rtc.now();
  Serial.println(t.unixtime());
  Serial.println(rtc.getTemperature());
  delay(3000);
  Serial.println(rtc.now().unixtime() - t.unixtime());
  rtc.adjust(DateTime(2030, 2, 28, 23, 59, 58));
  delay(2500);
  DateTime u = rtc.now();
  Serial.println(u.timestamp());
  Serial.println(u.dayOfTheWeek());
  char fmt[] = "DD/MM/YYYY hh:mm";
  Serial.println(u.toString(fmt));
}
void loop() {}`, hw).step(400);
  const lines = rt.out.trim().split('\n');
  assert.equal(lines[0], 'ok');
  assert.ok(Math.abs(+lines[1] - Math.floor(before)) <= 2, `heure de départ ${lines[1]} ≈ ${before}`);
  assert.equal(lines[2], '22.50');
  assert.ok(+lines[3] >= 2 && +lines[3] <= 3, 'trois secondes simulées');
  assert.equal(lines[4], '2030-03-01T00:00:00');
  assert.equal(lines[5], '5', 'vendredi');
  assert.equal(lines[6], '01/03/2030 00:00');
  const frames = log.list().filter(r => r.bus === 'i2c' && r.addr === 0x68);
  assert.ok(frames.length >= 6 && frames.every(r => r.ack && r.dev === rtc.name), 'trames I2C vers 0x68 dans l’analyseur');
});

test('DS3231 : registres BCD, mode 12 h, alarme 1 à la seconde, RAM du DS1307', () => {
  let T = 0; const clock = () => T;
  const c = comp('ds3231'), d = storeI2c(c, { clock });
  const W = bytes => { d.start(true, 0x68); bytes.forEach(b => d.write(b)); d.stop(); };
  const R = (reg, n) => { W([reg]); d.start(false, 0x68); const v = Array.from({ length: n }, () => d.read()); d.stop(); return v; };
  W([0, 0x55, 0x59, 0x40 | 0x20 | 0x11, 1, 0x31, 0x12, 0x29]); // 11:59:55 PM, 31/12/2029
  T += 6;
  const r = R(0, 7);
  assert.deepEqual([r[0], r[1], r[2] & 0x7f, r[4], r[5], r[6]], [0x01, 0x00, 0x40 | 0x12, 0x01, 0x01, 0x30], 'minuit passé : 12:00:01 AM le 1/1/2030');
  W([7, 0x10, 0x80, 0x80, 0x80]); // alarme 1 quand les secondes valent 10
  W([0x0e, 0x1d]);
  T += 3; assert.equal(R(0x0f, 1)[0] & 1, 0);
  T += 8; assert.equal(R(0x0f, 1)[0] & 1, 1, 'A1F levé à hh:mm:10');
  W([0x0f, 0x08]); assert.equal(R(0x0f, 1)[0] & 3, 0, 'A1F effacé');
  const s = comp('ds1307'), mem = {}, e = storeI2c(s, { clock, mem: () => mem });
  e.start(true, 0x68); [0x08, 1, 2, 3].forEach(b => e.write(b)); e.stop();
  e.start(true, 0x68); e.write(0x08); e.stop(); e.start(false, 0x68);
  assert.deepEqual([e.read(), e.read(), e.read()], [1, 2, 3]);
  assert.match(JSON.stringify(mem), /"nv":"010203"/, 'RAM sauvegardée gardée avec le projet');
});

/* ---------- AT24C256 ---------- */
test('AT24C256 : pages de 64 octets (l’adresse fait le tour de la page), cycle d’écriture de 5 ms sans acquittement', () => {
  let T = 0;
  const c = comp('at24c256'), mem = {}, d = storeI2c(c, { clock: () => T, mem: () => mem });
  assert.equal(d.start(true, 0x50), true);
  [0x00, 0x3e, 1, 2, 3, 4].forEach(b => d.write(b)); d.stop();
  assert.equal(d.start(true, 0x50), false, 'occupée pendant le cycle d’écriture');
  T += 0.0051;
  assert.equal(d.start(true, 0x50), true); d.write(0); d.write(0x3e); d.stop();
  d.start(false, 0x50);
  assert.deepEqual([d.read(), d.read()], [1, 2]);
  d.start(true, 0x50); d.write(0); d.write(0); d.stop(); d.start(false, 0x50);
  assert.deepEqual([d.read(), d.read()], [3, 4], 'les octets 3 et 4 sont revenus au début de la page');
  assert.match(JSON.stringify(mem), /"ee":"0304f{120}0102"/);
});

test('I2C_eeprom : écriture à cheval sur deux pages, relecture, contenu gardé ; Wire brut : NACK pendant l’écriture', () => {
  const ee = comp('at24c256'), hw = board('uno', { bus: [{ comp: ee, addr: [0x50] }] });
  const rt = start(`#include <Wire.h>
#include <I2C_eeprom.h>
I2C_eeprom mem(0x50, I2C_DEVICESIZE_24LC256);
void setup() {
  Serial.begin(9600); Wire.begin();
  Serial.println(mem.begin());
  byte data[100];
  for (int i = 0; i < 100; i++) data[i] = i * 2;
  mem.writeBlock(40, data, 100);
  byte back[100];
  mem.readBlock(40, back, 100);
  int bad = 0; for (int i = 0; i < 100; i++) if (back[i] != i * 2) bad++;
  Serial.println(bad);
  Wire.beginTransmission(0x50); Wire.write(0); Wire.write(0); Wire.write(77); Wire.endTransmission();
  Wire.beginTransmission(0x50); Serial.println(Wire.endTransmission());
  delay(6);
  Wire.beginTransmission(0x50); Serial.println(Wire.endTransmission());
}
void loop() {}`, hw).step(20);
  assert.equal(rt.out, '1\n0\n2\n0\n');
  const saved = JSON.parse(JSON.stringify(hw.compMem(ee)));
  assert.equal(saved.ee.slice(0, 2), '4d');
  assert.equal(saved.ee.slice(80, 84), '0002');
});

test('Horloge locale encodée en UTC : les champs sont ceux de l’écran', () => {
  const d = new Date(2026, 10, 17, 8, 30, 15), f = fields(localNow(d));
  assert.deepEqual([f.y, f.mo, f.d, f.h, f.mi, f.s], [2026, 11, 17, 8, 30, 15]);
});
