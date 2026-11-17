// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modules série de src/sim/serialmods.js (GPS NEO-6M, radio HC-12, RS-485 MAX485) et leurs bibliothèques dans
// l'interpréteur (TinyGPSPlus de src/prog/gpslib.js, SoftwareSerial, Serial1). node --test src/sim/serialmods.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { nmea, nmeaChecksum, nmeaCoord, gpsBurst, gpsSettings, gpsView, hc12Air, hc12Freq } from './serialmods.js';
import { serialDevice, periph } from './models.js';
import { createGpsLib, parseDecimal, parseDegrees } from '../prog/gpslib.js';
import { compile } from '../prog/lang.js';
import { createRuntime } from '../prog/runtime.js';
import { BOARDS } from './boards.js';

let uid = 0;
const comp = (type, x = {}) => ({ type, id: type + ++uid, name: type.toUpperCase() + uid, inp: {}, ...x });
/** Carte interprétée sur un montage factice (fils, modules de tout le montage, niveaux des broches de module). */
function board(kind, o = {}) {
  const wires = o.wires || {};
  return {
    kind, label: kind, prof: BOARDS[kind], read: () => null, echo: () => null, data: () => null,
    onPin: (k, types) => { const h = (wires[k] || []).find(x => types.includes(x.comp.type)); return h ? h.comp : null; },
    at: k => wires[k] || [], bus: () => [], i2c: () => [], status: () => ({ ok: true, msg: '' }),
    peers: types => (o.peers || []).filter(c => types.includes(c.type)).map(c => ({ comp: c, ok: true })),
    mem: () => ({ ee: '', prefs: {} }), level: (c, k) => (o.level ? o.level(c, k) : null), linked: (c, k) => (o.linked ? o.linked(c, k) : [])
  };
}
function start(src, hw) {
  const c = compile(src, { board: hw.kind });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  rt.out = '';
  rt.step = (ms, dt = 16) => { for (let t = 0; t < ms; t += dt) { rt.run(dt); rt.out += rt.takeSerial(); } assert.notEqual(rt.state, 'error', rt.error && rt.error.msg); return rt; };
  return rt;
}

/* ---------- NMEA ---------- */
test('NMEA : sommes de contrôle et coordonnées au format du NEO-6M', () => {
  // Trames connues du NEO-6M sans position (sommes publiées partout).
  assert.equal(nmea('GPRMC,,V,,,,,,,,,,N'), '$GPRMC,,V,,,,,,,,,,N*53\r\n');
  assert.equal(nmea('GPGSV,1,1,00'), '$GPGSV,1,1,00*79\r\n');
  assert.equal(nmeaChecksum('GPGLL,,,,,,V,N'), '64');
  assert.equal(nmeaCoord(14.6928, false), '1441.56800,N');
  assert.equal(nmeaCoord(-17.4467, true), '01726.80200,W');
  assert.equal(nmeaCoord(-33.5, false), '3330.00000,S');
  const b = gpsBurst({ fix: true, lat: 14.6928, lon: -17.4467, alt: 22, speed: 36, course: 90, utc: Date.UTC(2026, 10, 17, 9, 5, 7), sec: 0 });
  const lines = b.trim().split('\r\n');
  assert.deepEqual(lines.map(l => l.slice(1, 6)), ['GPRMC', 'GPVTG', 'GPGGA', 'GPGSA', 'GPGSV', 'GPGSV', 'GPGSV', 'GPGLL']);
  for (const l of lines) { const m = /^\$(.*)\*([0-9A-F]{2})$/.exec(l); assert.ok(m, l); assert.equal(nmeaChecksum(m[1]), m[2], l); }
  assert.match(lines[0], /^\$GPRMC,090507\.00,A,1441\.56800,N,01726\.80200,W,19\.438,90\.00,171126,,,A\*/);
  assert.match(lines[2], /^\$GPGGA,090507\.00,1441\.56800,N,01726\.80200,W,1,08,0\.92,22\.0,M,/);
});

test('NEO-6M : une salve par seconde, sans position pendant le démarrage à froid, puis la position réglée', () => {
  const g = comp('neo6m', { inp: { gpsCold: 3 } }), d = serialDevice(g);
  assert.equal(d.baud, 9600);
  assert.equal(d.drain(9600, 0), '', 'rien avant la première seconde');
  const s1 = d.drain(9600, 1000);
  assert.match(s1, /^\$GPRMC,,V,/); assert.match(s1, /\$GPGGA,,,,,,0,00,/);
  assert.equal(d.drain(9600, 1500), '', 'une seule salve par seconde');
  assert.equal(gpsView(periph(g)).fix, false);
  const s3 = d.drain(9600, 3000);
  assert.equal((s3.match(/\$GPRMC/g) || []).length, 2, 'les secondes 2 et 3');
  assert.match(s3, /\$GPRMC,\d{6}\.00,A,1441\.56800,N,01726\.80200,W,0\.000,,\d{6},,,A\*/);
  assert.equal(gpsView(periph(g)).fix, true);
  assert.notEqual(d.drain(4800, 4000).slice(0, 6), '$GPRMC', 'carte à 4800 bauds : charabia');
});

test('NEO-6M : la position avance selon la vitesse et le cap', () => {
  const g = comp('neo6m', { inp: { gpsCold: 0, gpsLat: 0, gpsLon: 0, gpsSpeed: 36, gpsCourse: 0 } }), d = serialDevice(g);
  d.drain(9600, 0); d.drain(9600, 1000);
  const a = gpsView(periph(g)).lat;
  d.drain(9600, 11000);
  const b = gpsView(periph(g)).lat;
  // 36 km/h vers le nord pendant 10 s : 100 m, soit 0,000899° de latitude.
  assert.ok(Math.abs((b - a) * 111195 - 100) < 1, String((b - a) * 111195));
  assert.deepEqual(gpsSettings({ inp: { gpsCourse: -90 } }).course, 270);
});

/* ---------- TinyGPSPlus ---------- */
test('TinyGPSPlus (interpréteur) : analyse comme la bibliothèque (décimales, degrés, sommes, trames sans position)', () => {
  assert.equal(parseDecimal('19.438'), 1943);
  assert.equal(parseDecimal('-3.5'), -350);
  assert.deepEqual(parseDegrees('1441.56800'), { deg: 14, billionths: 692800000, negative: false });
  let ms = 0;
  const { TinyGPSPlus } = createGpsLib({ now: () => ms });
  const gps = new TinyGPSPlus();
  const feed = s => { let n = 0; for (const ch of s) if (gps.encode(ch)) n++; return n; };
  assert.equal(feed(nmea('GPRMC,,V,,,,,,,,,,N') + nmea('GPGGA,,,,,,0,00,99.99,,,,,,')), 2);
  assert.equal(gps.location.isValid(), false);
  assert.equal(feed('$GPRMC,1,A*00\r\n'), 0);
  assert.equal(gps.failedChecksum(), 1);
  const b = gpsBurst({ fix: true, lat: 14.6928, lon: -17.4467, alt: 22, speed: 36, course: 90, utc: Date.UTC(2026, 10, 17, 9, 5, 7), sec: 0 });
  ms = 1000; feed(b); ms = 1250;
  assert.ok(gps.location.isValid() && gps.location.isUpdated());
  assert.ok(Math.abs(gps.location.lat() - 14.6928) < 1e-7 && Math.abs(gps.location.lng() + 17.4467) < 1e-7);
  assert.equal(gps.location.isUpdated(), false, 'lat() efface « mis à jour »');
  assert.equal(gps.location.age(), 250);
  assert.deepEqual([gps.date.day(), gps.date.month(), gps.date.year(), gps.time.hour(), gps.time.minute(), gps.time.second()], [17, 11, 2026, 9, 5, 7]);
  assert.equal(gps.satellites.value(), 8); assert.equal(gps.hdop.hdop(), 0.92); assert.equal(gps.altitude.meters(), 22);
  assert.ok(Math.abs(gps.speed.kmph() - 19.43 * 1.852) < 1e-9); assert.equal(gps.course.deg(), 90);
  assert.equal(gps.sentencesWithFix(), 2); assert.equal(gps.charsProcessed(), [...nmea('GPRMC,,V,,,,,,,,,,N') + nmea('GPGGA,,,,,,0,00,99.99,,,,,,') + '$GPRMC,1,A*00\r\n' + b].length);
  assert.ok(Math.abs(TinyGPSPlus.distanceBetween(14.6928, -17.4467, 14.7167, -17.4677) - 3501) < 30);
  assert.equal(TinyGPSPlus.cardinal(TinyGPSPlus.courseTo(0, 0, 1, 0)), 'N');
});

const GPS_SKETCH = `#include <TinyGPSPlus.h>
#include <SoftwareSerial.h>
TinyGPSPlus gps;
SoftwareSerial ss(4, 3);
void setup() { Serial.begin(9600); ss.begin(9600); }
void loop() {
  while (ss.available() > 0) {
    if (gps.encode(ss.read()) && gps.location.isUpdated()) {
      Serial.print("POS ");
      Serial.print(gps.location.lat(), 6);
      Serial.print(" ");
      Serial.print(gps.location.lng(), 6);
      Serial.print(" sats ");
      Serial.println(gps.satellites.value());
    }
  }
  if (millis() > 1500 && gps.charsProcessed() < 10) Serial.println("pas de GPS");
}`;

test('TinyGPSPlus sur SoftwareSerial : la carte interprétée lit la position après le démarrage à froid', () => {
  const g = comp('neo6m', { inp: { gpsCold: 2 } });
  const rt = start(GPS_SKETCH, board('uno', { wires: { D4: [{ comp: g, pin: 'TX' }] } }));
  rt.step(1900);
  assert.doesNotMatch(rt.out, /POS/);
  rt.step(1400);
  // Sur un Uno, double fait 32 bits : -17.4467 s'affiche -17.446699, comme sur la vraie carte (Print::printFloat).
  assert.match(rt.out, /POS 14\.692800 -17\.446699 sats 8\n/);
  assert.doesNotMatch(rt.out, /pas de GPS/);
  assert.ok(![...rt.warnings.values()].some(w => /n’est pas relié/.test(w.msg)), 'GPS sans fil RX : normal');
});

/* ---------- HC-12 ---------- */
const HC12_TX = `#include <SoftwareSerial.h>
SoftwareSerial hc12(10, 11);
int n = 0;
void setup() { Serial.begin(9600); hc12.begin(9600); }
void loop() { hc12.print("msg "); hc12.println(n++); delay(200); }`;
const HC12_RX = `#include <SoftwareSerial.h>
SoftwareSerial hc12(10, 11);
void setup() { Serial.begin(9600); hc12.begin(9600); }
void loop() { while (hc12.available()) Serial.write(hc12.read()); }`;

test('HC-12 : deux cartes interprétées se parlent sur le même canal, pas sur deux canaux différents', () => {
  const a = comp('hc12'), b = comp('hc12'), peers = [a, b];
  const ta = start(HC12_TX, board('uno', { peers, wires: { D10: [{ comp: a, pin: 'TXD' }], D11: [{ comp: a, pin: 'RXD' }] } }));
  const tb = start(HC12_RX, board('uno', { peers, wires: { D10: [{ comp: b, pin: 'TXD' }], D11: [{ comp: b, pin: 'RXD' }] } }));
  for (let i = 0; i < 40; i++) { ta.step(16); tb.step(16); }
  assert.match(tb.out, /msg 0\r\nmsg 1\r\nmsg 2\r\n/);
  b.inp.hc12Ch = 5;
  const before = tb.out.length;
  for (let i = 0; i < 40; i++) { ta.step(16); tb.step(16); }
  assert.equal(tb.out.length, before, 'canal 5 : plus rien');
  assert.equal(hc12Freq(5), 435);
  assert.equal(hc12Air(9600), hc12Air(4800));
});

test('HC-12 : SET à LOW, commandes AT à 9600 bauds (AT, AT+C021, AT+B19200, AT+RX), réglages gardés par le module', () => {
  const h = comp('hc12');
  const src = `#include <SoftwareSerial.h>
SoftwareSerial hc12(10, 11);
void setup() {
  Serial.begin(9600); hc12.begin(9600);
  pinMode(5, OUTPUT); digitalWrite(5, LOW); delay(50);
  hc12.print("AT"); delay(100);
  hc12.print("AT+C021"); delay(100);
  hc12.println("AT+B19200"); delay(100);
  hc12.print("AT+RX"); delay(100);
  hc12.print("AT+C200"); delay(100);
}
void loop() { while (hc12.available()) Serial.write(hc12.read()); }`;
  let set = 1;
  const rt = start(src, board('uno', { wires: { D10: [{ comp: h, pin: 'TXD' }], D11: [{ comp: h, pin: 'RXD' }] }, level: (c, k) => (k === 'SET' ? set : null) }));
  set = 0;
  rt.step(800);
  assert.match(rt.out, /^OK\r\nOK\+C021\r\nOK\+B19200\r\nOK\+B19200\r\nOK\+RC021\r\nOK\+RP:\+20dBm\r\nOK\+FU3\r\nERROR\r\n$/);
  assert.equal(h.inp.hc12Ch, 21); assert.equal(h.inp.hc12Baud, 19200);
  set = 1;
  assert.equal(serialDevice(h).baud, 19200, 'SET relâché : le module reprend sa vitesse');
});

/* ---------- RS-485 ---------- */
test('MAX485 : DE et /RE commandent le sens ; A et B croisés donnent du charabia', () => {
  const a = comp('max485'), b = comp('max485'), lv = { [a.id]: { DE: 1, RE: 1 }, [b.id]: { DE: 0, RE: 0 } };
  const bind = (c, other, keyOnA = 'A') => serialDevice(c).bind({ level: k => lv[c.id][k], linked: k => (k === 'A' ? [{ comp: other, key: keyOnA }] : []), peers: () => [] });
  bind(a, b); bind(b, a);
  serialDevice(a).write('Bonjour', 9600, 0);
  assert.equal(serialDevice(b).drain(9600, 0), 'Bonjour');
  assert.notEqual(serialDevice(b).drain(9600, 0), 'Bonjour', 'rien de plus');
  serialDevice(a).write('x', 4800, 0);
  assert.notEqual(serialDevice(b).drain(9600, 0), 'x', 'vitesses différentes : charabia');
  lv[a.id].DE = 0; serialDevice(a).write('perdu', 9600, 0);
  assert.equal(serialDevice(b).drain(9600, 0), '', 'DE à LOW : rien ne part');
  lv[a.id] = { DE: 1, RE: 0 }; serialDevice(a).write('echo', 9600, 0);
  assert.equal(serialDevice(a).drain(9600, 0), 'echo', 'semi-duplex : l’émetteur s’entend');
  assert.equal(serialDevice(b).drain(9600, 0), 'echo');
  lv[b.id].RE = 1; serialDevice(a).write('sourd', 9600, 0);
  assert.equal(serialDevice(b).drain(9600, 0), '', '/RE à HIGH : récepteur coupé');
  lv[b.id].RE = 0; bind(b, a, 'B'); bind(a, b, 'B');
  serialDevice(a).write('AB', 9600, 0);
  assert.notEqual(serialDevice(b).drain(9600, 0), 'AB', 'A et B croisés');
});

test('MAX485 : deux cartes interprétées sur Serial (Mega Serial1) se répondent par le bus', () => {
  const m = comp('max485'), s = comp('max485');
  const linked = (c, k) => (k === 'A' ? [{ comp: c === m ? s : m, key: 'A' }] : k === 'B' ? [{ comp: c === m ? s : m, key: 'B' }] : []);
  const master = `void setup() { Serial.begin(9600); Serial1.begin(9600); pinMode(2, OUTPUT); }
void loop() {
  digitalWrite(2, HIGH); Serial1.print("?T\\n"); Serial1.flush(); digitalWrite(2, LOW);
  delay(100);
  while (Serial1.available()) Serial.write(Serial1.read());
  delay(400);
}`;
  const slave = `void setup() { Serial.begin(9600); Serial1.begin(9600); pinMode(2, OUTPUT); digitalWrite(2, LOW); }
void loop() {
  if (Serial1.available()) {
    String q = Serial1.readStringUntil('\\n');
    if (q == "?T") { digitalWrite(2, HIGH); Serial1.print("T=24.5\\n"); digitalWrite(2, LOW); }
  }
}`;
  const pinsOf = c => ({ D18: [{ comp: c, pin: 'DI' }], D19: [{ comp: c, pin: 'RO' }] });
  let rtM, rtS;
  const lvl = rt => (c, k) => (k === 'DE' || k === 'RE' ? (rt().pins.get('D2') && rt().pins.get('D2').mode === 1 ? rt().pins.get('D2').d : null) : null);
  rtM = start(master, board('mega', { wires: pinsOf(m), linked, level: lvl(() => rtM) }));
  rtS = start(slave, board('mega', { wires: pinsOf(s), linked, level: lvl(() => rtS) }));
  for (let i = 0; i < 70; i++) { rtS.step(16); rtM.step(16); }
  assert.match(rtM.out, /T=24\.5\nT=24\.5\n/);
});
