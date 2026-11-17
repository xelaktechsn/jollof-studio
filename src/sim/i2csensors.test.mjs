// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Capteurs I2C VL53L0X, MAX30102, TCS34725, CCS811 et BME680 (src/sim/i2csensors.js) : registres de chaque puce, leurs
// bibliothèques simulées dans l'interpréteur (src/prog/sensorlibs.js), le vérificateur (adresses en conflit, logique
// 3,3 V, alimentation) et l'analyseur de bus, sur l'interpréteur et sur l'Uno émulé (vraies bibliothèques).
// node --test src/sim/i2csensors.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { sensorI2c, sensorAddr, vlRange, ratioFor, ppgCounts, tcsCounts, ccsValues, bmeRaw, bmeTemp, bmePress, bmeHum, bmeGas, bmeTfine, bmeGasOhm } from './i2csensors.js';
import { MODELS, QUANT, fromSlider, sliderOf, fmtV } from './models.js';
import { compile } from '../prog/lang.js';
import { createRuntime } from '../prog/runtime.js';
import { BOARDS } from './boards.js';
import { createBusLog } from './buslog.js';
import { loadProject } from '../check/load.js';
import { checkProject } from '../check/check.js';
import { hasCli, compileSketch, fakeBoard, boot, runFor } from '../emu/testkit.mjs';

/** Accès I2C au modèle, comme le ferait Wire : écrire un registre, lire n octets à partir d'un registre. */
function bus(dev, addr) {
  return {
    w(reg, ...bytes) { if (dev.start(true, addr) === false) return false; dev.write(reg); bytes.forEach(b => dev.write(b)); dev.stop(); return true; },
    r(reg, n = 1) { if (dev.start(true, addr) === false) return null; dev.write(reg); dev.stop(); dev.start(false, addr); const out = []; for (let i = 0; i < n; i++) out.push(dev.read()); dev.stop(); return out; }
  };
}

/* ---------- Modèles des puces ---------- */
test('VL53L0X : identifiant, mesure unique de 33 ms, hors de portée (8190), nouvelle adresse, XSHUT', () => {
  let t = 0, lv = 1;
  const comp = { type: 'vl53l0x', id: 'v1' }, data = { mm: 734 };
  const dev = sensorI2c(comp, { clock: () => t, data: () => data, level: () => lv }), b = bus(dev, 0x29);
  assert.deepEqual(b.r(0xc0, 3), [0xee, 0xaa, 0x10]);
  b.w(0x00, 0x01);
  assert.equal(b.r(0x00)[0] & 1, 0, 'le bit de départ retombe');
  assert.equal(b.r(0x13)[0] & 7, 0, 'pas encore de mesure');
  t = 0.04;
  assert.equal(b.r(0x13)[0] & 7, 4, 'nouvelle mesure prête');
  const r = b.r(0x14, 12);
  assert.equal((r[10] << 8) | r[11], 734);
  assert.equal((r[0] & 0x78) >> 3, 11, 'mesure valable');
  b.w(0x0b, 0x01);
  assert.equal(b.r(0x13)[0] & 7, 0, 'interruption effacée');
  assert.deepEqual(vlRange(2500), { mm: 8190, dev: 9, sig: 0.05 });
  assert.equal(vlRange(20).dev, 10);
  // Nouvelle adresse : la puce ne répond plus à 0x29.
  b.w(0x8a, 0x30);
  assert.deepEqual(sensorAddr(comp), [0x30]);
  assert.equal(dev.start(true, 0x29), false);
  assert.equal(bus(dev, 0x30).r(0xc0)[0], 0xee);
  lv = 0;
  assert.equal(dev.start(true, 0x30), false, 'XSHUT à LOW : puce éteinte');
});

test('MAX30102 : FIFO remplie à la cadence réglée (100 échantillons/s), débordement, rapport R et SpO₂, température', () => {
  let t = 0;
  const d = { finger: 1, bpm: 60, spo2: 98, temp: 30 }, dev = sensorI2c({ type: 'max30102' }, { clock: () => t, data: () => d }), b = bus(dev, 0x57);
  assert.equal(b.r(0xff)[0], 0x15);
  b.w(0x08, 0x50); b.w(0x09, 0x03); b.w(0x0a, 0x2f); b.w(0x0c, 0x1f); b.w(0x0d, 0x1f); // moyenne de 4, rouge + IR, 400 Hz, 411 µs, 4096 nA
  b.r(0x00); t = 0.1;
  const wr = b.r(0x04)[0], rd = b.r(0x06)[0];
  assert.equal((wr - rd + 32) & 31, 10, '0,1 s à 400 Hz ÷ 4 : 10 échantillons');
  assert.equal(b.r(0x00)[0] & 0x40, 0x40, 'PPG_RDY');
  const s = b.r(0x07, 6), red = ((s[0] << 16) | (s[1] << 8) | s[2]) & 0x3ffff, ir = ((s[3] << 16) | (s[4] << 8) | s[5]) & 0x3ffff;
  assert.ok(ir > 100000 && ir < 115000, `infrarouge ${ir}`);
  assert.ok(red > 80000 && red < 92000, `rouge ${red}`);
  assert.equal((b.r(0x06)[0] - rd + 32) & 31, 1, 'un échantillon lu : pointeur de lecture avancé');
  t = 1; // 90 échantillons de plus : FIFO pleine, les plus anciens recouverts (FIFO_ROLLOVER_EN), compteur de débordement
  assert.equal(b.r(0x05)[0] > 0, true);
  // Formule de Maxim : R qui donne la saturation voulue.
  for (const sp of [85, 90, 95, 98]) { const R = ratioFor(sp); assert.ok(Math.abs(-45.06 * R * R + 30.354 * R + 94.845 - sp) < 1e-6); }
  assert.ok(ppgCounts(1, 1, 0, { finger: 0 }) < 2000, 'sans doigt : lumière ambiante seulement');
  b.w(0x21, 0x01); t += 0.03;
  assert.equal(b.r(0x01)[0] & 2, 2, 'DIE_TEMP_RDY');
  assert.equal((b.r(0x1f)[0] << 24 >> 24) + b.r(0x20)[0] * 0.0625, 30);
});

test('TCS34725 : identifiant, comptes selon l’intégration et le gain, saturation, AVALID', () => {
  let t = 0;
  const dev = sensorI2c({ type: 'tcs34725' }, { clock: () => t, data: () => ({ rgb: 0xffffff, lux: 300 }) }), b = bus(dev, 0x29);
  assert.equal(b.r(0x80 | 0x12)[0], 0x44);
  b.w(0x80 | 0x01, 0x00); b.w(0x80 | 0x0f, 0x00); b.w(0x80 | 0x00, 0x03);
  assert.equal(b.r(0x80 | 0x13)[0] & 1, 0);
  t = 0.62;
  assert.equal(b.r(0x80 | 0x13)[0] & 1, 1, 'AVALID après une intégration de 614 ms');
  const v = b.r(0x80 | 0x14, 8), c = v[0] | (v[1] << 8), r = v[2] | (v[3] << 8);
  assert.equal(r, 575); assert.equal(c, 1725);
  assert.equal(Math.round(-0.32466 * 575 + 1.57837 * 575 - 0.73191 * 575), 300, 'calculateLux d’Adafruit : 300 lx');
  assert.equal(tcsCounts(0xffffff, 100000, 614.4, 60).c, 65535, 'saturé');
  assert.equal(tcsCounts(0xffffff, 100000, 2.4, 60).sat, 1024);
  assert.deepEqual(tcsCounts(0, 300, 614.4, 1), { r: 0, g: 0, b: 0, c: 0, sat: 65535 });
});

test('CCS811 : démarrage du micrologiciel, mode 1 s, ALG_RESULT_DATA, WAKE', () => {
  let t = 0, wake = 0;
  const dev = sensorI2c({ type: 'ccs811' }, { clock: () => t, data: () => ccsValues(1600), level: () => wake }), b = bus(dev, 0x5a);
  assert.equal(b.r(0x20)[0], 0x81);
  assert.equal(b.r(0x00)[0], 0x10, 'chargeur d’amorçage, application valide');
  b.w(0xf4);
  assert.equal(b.r(0x00)[0], 0x90, 'micrologiciel démarré');
  b.w(0x01, 0x10); t = 1.01;
  assert.equal(b.r(0x00)[0] & 0x08, 0x08, 'DATA_READY');
  const a = b.r(0x02, 8);
  assert.equal((a[0] << 8) | a[1], 1600); assert.equal((a[2] << 8) | a[3], 180);
  assert.equal(b.r(0x00)[0] & 0x08, 0, 'lu : DATA_READY effacé');
  wake = 1;
  assert.equal(dev.start(true, 0x5a), false, 'WAKE à HIGH : la puce n’écoute pas');
  assert.deepEqual(ccsValues(9000), { eco2: 8192, tvoc: 1169 });
});

test('BME680 : formules de Bosch inversées, écritures par paires, mesure forcée puis retour en sommeil', () => {
  for (const [T, P, H, G] of [[24, 1013, 55, 120000], [-10, 950, 20, 30000], [40, 1050, 90, 8000]]) {
    const r = bmeRaw(T, P, H, G), tf = bmeTfine(r.t);
    assert.ok(Math.abs(bmeTemp(r.t) - T) < 0.01, 'T'); assert.ok(Math.abs(bmePress(r.p, tf) / 100 - P) < 0.02, 'P');
    assert.ok(Math.abs(bmeHum(r.h, tf) - H) < 0.01, 'H'); assert.ok(Math.abs(bmeGas(r.gas, r.range) / G - 1) < 0.01, 'gaz');
  }
  assert.ok(bmeGasOhm(400) > bmeGasOhm(2000), 'air chargé : résistance plus basse');
  let t = 0;
  const dev = sensorI2c({ type: 'bme680' }, { clock: () => t, data: () => ({ temp: 22, hum: 40, press: 1000, gas: 50000 }) }), b = bus(dev, 0x77);
  assert.equal(b.r(0xd0)[0], 0x61);
  assert.equal(b.w(0x72, 0x02, 0x74, 0x91), true); // paires : ctrl_hum = 2, puis ctrl_meas = suréchantillonnage + mode forcé
  b.w(0x64, 0x59); b.w(0x5a, 0x80); b.w(0x71, 0x10);
  b.w(0x74, 0x91);
  assert.equal(b.r(0x74)[0] & 3, 1, 'mesure en cours');
  t = 0.5;
  assert.equal(b.r(0x74)[0] & 3, 0, 'revenue en sommeil');
  const f = b.r(0x1d, 17);
  assert.equal(f[0] & 0x80, 0x80, 'new_data');
  assert.equal(f[14] & 0x30, 0x30, 'gas_valid et heat_stab');
});

test('Grandeurs de l’environnement : couleur au sélecteur, pouls, SpO₂, doigt ; mesures des capteurs', () => {
  assert.equal(fromSlider('color', '#ff8000'), 0xff8000);
  assert.equal(sliderOf('color', 0x00ff7f), '#00ff7f');
  assert.equal(fmtV('color', 0xff8000), '#FF8000');
  assert.ok(QUANT.bpm && QUANT.spo2 && QUANT.finger.bool && QUANT.air.max >= 8000);
  for (const t of ['vl53l0x', 'max30102', 'tcs34725', 'ccs811', 'bme680']) assert.ok(MODELS[t] && MODELS[t].q.length, t);
  const r = MODELS.vl53l0x.read({ dist: 300 }, {});
  assert.ok(r.data.mm > 2990 && r.data.mm < 3010 && /hors de portée/.test(r.value), 'au-delà de 2 m');
});

/* ---------- Bibliothèques simulées (interpréteur) ---------- */
let uid = 0;
const comp = (type, x = {}) => ({ type, id: type + ++uid, name: type.toUpperCase() + uid, ...x });
function board(kind, o = {}) {
  return {
    kind, label: kind, prof: BOARDS[kind], read: () => null, echo: () => null, onPin: () => null, at: () => [],
    bus: types => (o.bus || []).filter(d => types.includes(d.comp.type)), i2c: () => o.bus || [],
    status: () => ({ ok: true, msg: '' }), peers: () => [], data: c => c.data || null, level: (c, k) => (c.levels ? c.levels[k] ?? null : null),
    mem: () => ({ ee: '', prefs: {} }), probe: o.probe || null
  };
}
function run(src, hw, ms) {
  const c = compile(src, { board: hw.kind });
  assert.ok(c.ok, JSON.stringify(c.errors));
  assert.ok(!c.warnings.some(w => w.code === 'J1109'), 'bibliothèque connue');
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  let out = '';
  for (let t = 0; t < ms; t += 16) { rt.run(16); out += rt.takeSerial(); }
  assert.notEqual(rt.state, 'error', rt.error && rt.error.msg);
  return { out, rt };
}

test('Interpréteur : Adafruit_VL53L0X et VL53L0X de Pololu, mesures et état (hors de portée : RangeStatus 4)', () => {
  const v = comp('vl53l0x', { data: { mm: 257 } });
  const { out } = run(`#include <Adafruit_VL53L0X.h>
Adafruit_VL53L0X lox = Adafruit_VL53L0X();
void setup() { Serial.begin(9600); Serial.println(lox.begin() ? "ok" : "absent"); }
void loop() { VL53L0X_RangingMeasurementData_t m; lox.rangingTest(&m, false); Serial.print(m.RangeMilliMeter); Serial.print(" "); Serial.println(m.RangeStatus); delay(100); }`, board('uno', { bus: [{ comp: v, addr: [0x29] }] }), 500);
  assert.match(out, /^ok\n257 0\n257 0\n/);
  v.data = { mm: 3000 };
  const p = comp('vl53l0x', { data: { mm: 3000 } });
  const { out: o2 } = run(`#include <Wire.h>
#include <VL53L0X.h>
VL53L0X s;
void setup() { Serial.begin(9600); Wire.begin(); s.setTimeout(500); if (!s.init()) Serial.println("echec"); s.startContinuous(); }
void loop() { Serial.println(s.readRangeContinuousMillimeters()); if (s.timeoutOccurred()) Serial.println("TIMEOUT"); delay(40); }`, board('uno', { bus: [{ comp: p, addr: [0x29] }] }), 300);
  assert.match(o2, /^8190\n8190\n/);
  assert.doesNotMatch(o2, /TIMEOUT|echec/);
});

test('Interpréteur : MAX30105 (SparkFun), boucle available()/check() et getFIFORed/IR, battements (checkForBeat) et SpO₂ (spo2_algorithm)', () => {
  const m = comp('max30102', { data: { finger: 1, bpm: 90, spo2: 95, temp: 32 } });
  const { out } = run(`#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"
#include "spo2_algorithm.h"
MAX30105 cap;
uint32_t irB[100], redB[100];
int32_t spo2; int8_t okS; int32_t hr; int8_t okH;
long last = 0; int n = 0;
void setup() {
  Serial.begin(115200);
  if (!cap.begin(Wire, I2C_SPEED_FAST)) Serial.println("absent");
  cap.setup(60, 4, 2, 100, 411, 4096);
  Serial.print("t="); Serial.println(cap.readTemperature(), 1);
  for (byte i = 0; i < 100; i++) { while (cap.available() == false) cap.check(); cap.nextSample(); redB[i] = cap.getFIFORed(); irB[i] = cap.getFIFOIR(); }
  maxim_heart_rate_and_oxygen_saturation(irB, 100, redB, &spo2, &okS, &hr, &okH);
  Serial.print("spo2="); Serial.print(spo2); Serial.print(" ok="); Serial.print(okS); Serial.print(" hr="); Serial.print(hr); Serial.print(" ok="); Serial.println(okH);
  cap.setup();
}
void loop() { long ir = cap.getIR(); if (checkForBeat(ir)) { long d = millis() - last; last = millis(); if (++n > 2) { Serial.print("bpm="); Serial.println(60000L / d); } } }`, board('uno', { bus: [{ comp: m, addr: [0x57] }] }), 9000);
  assert.match(out, /t=32\.0\n/);
  const s = /spo2=(\d+) ok=1 hr=(\d+) ok=1/.exec(out);
  assert.ok(s, out.slice(0, 200));
  assert.ok(Math.abs(+s[1] - 95) <= 2, `SpO2 ${s[1]}`); assert.ok(Math.abs(+s[2] - 90) <= 8, `pouls ${s[2]}`);
  const b = [...out.matchAll(/bpm=(\d+)/g)].map(x => +x[1]);
  assert.ok(b.length >= 3 && b.every(x => Math.abs(x - 90) <= 5), `battements ${b}`);
});

test('Interpréteur : Adafruit_TCS34725, Adafruit_CCS811 et Adafruit_BME680, mêmes valeurs que sur la carte', () => {
  const t = comp('tcs34725', { data: { rgb: 0xff8000, lux: 300 } }), c = comp('ccs811', { data: ccsValues(1250), levels: { WAKE: 0 } }), e = comp('bme680', { data: { temp: 27.4, hum: 61, press: 1009.5, gas: 85000 } });
  const { out } = run(`#include <Wire.h>
#include "Adafruit_TCS34725.h"
#include "Adafruit_CCS811.h"
#include "Adafruit_BME680.h"
Adafruit_TCS34725 tcs = Adafruit_TCS34725(TCS34725_INTEGRATIONTIME_614MS, TCS34725_GAIN_1X);
Adafruit_CCS811 ccs;
Adafruit_BME680 bme;
void setup() {
  Serial.begin(9600);
  Serial.print(tcs.begin()); Serial.print(ccs.begin()); Serial.println(bme.begin());
  uint16_t r, g, b, cl; tcs.getRawData(&r, &g, &b, &cl);
  Serial.print(r); Serial.print(","); Serial.print(g); Serial.print(","); Serial.print(b); Serial.print(","); Serial.print(cl); Serial.print(" K="); Serial.println(tcs.calculateColorTemperature_dn40(r, g, b, cl));
  while (!ccs.available());
  if (!ccs.readData()) { Serial.print("co2="); Serial.print(ccs.geteCO2()); Serial.print(" tvoc="); Serial.println(ccs.getTVOC()); }
  if (bme.performReading()) { Serial.print("T="); Serial.print(bme.temperature); Serial.print(" H="); Serial.print(bme.humidity); Serial.print(" P="); Serial.print(bme.pressure / 100.0); Serial.print(" G="); Serial.println(bme.gas_resistance / 1000.0); }
}
void loop() {}`, board('uno', { bus: [{ comp: t, addr: [0x29] }, { comp: c, addr: [0x5a] }, { comp: e, addr: [0x77] }] }), 4000);
  assert.match(out, /^111\n1148,576,0,1724 K=1391\nco2=1250 tvoc=128\nT=27\.40 H=61\.00 P=1009\.50 G=85\.00\n/);
});

test('Analyseur de bus (interpréteur) : les trames du VL53L0X et du BME680 sont visibles', () => {
  const log = createBusLog({ max: 50000 }), v = comp('vl53l0x', { data: { mm: 500 } }), e = comp('bme680', { data: { temp: 20, hum: 50, press: 1013, gas: 100000 } });
  let rt = null;
  const hw = board('uno', { bus: [{ comp: v, addr: [0x29] }, { comp: e, addr: [0x77] }], probe: log.probe('uno', () => (rt ? rt.clock() : 0)) });
  ({ rt } = run(`#include <Adafruit_VL53L0X.h>
#include <Adafruit_BME680.h>
Adafruit_VL53L0X lox; Adafruit_BME680 bme;
void setup() { Serial.begin(9600); lox.begin(); bme.begin(); Serial.println(lox.readRange()); }
void loop() {}`, hw, 600));
  const i2c = log.list().filter(r => r.bus === 'i2c');
  const id = i2c.find(r => r.addr === 0x29 && !r.write && r.bytes.length && r.bytes[0].v === 0xee);
  assert.ok(id, 'le VL53L0X répond 0xEE à la lecture de son identifiant');
  assert.ok(i2c.some(r => r.addr === 0x77 && !r.write && r.bytes.length && r.bytes[0].v === 0x61), 'le BME680 répond 0x61');
});

/* ---------- Vérificateur ---------- */
const project = (parts, links) => loadProject({ comps: parts.map(([type, id]) => ({ id, type, name: id })), wires: links.map(([a, ka, b, kb]) => ({ a: [a, ka], b: [b, kb] })) }, null);
const codes = r => r.diags.map(d => `${d.level === 'error' ? 'E' : 'w'}:${d.code}`);
const i2cTo = (id, vcc, pwr = '5V') => [[id, vcc, 'U', pwr], [id, 'GND', 'U', 'GND'], [id, 'SDA', 'U', 'A4'], [id, 'SCL', 'U', 'A5']];

test('Vérificateur : VL53L0X et TCS34725 à 0x29 sur le même bus (J0610), logique 3,3 V sur un Uno (J0208), CCS811 en 5 V (J0106)', () => {
  const both = checkProject(project([['uno', 'U'], ['vl53l0x', 'V'], ['tcs34725', 'T']], [...i2cTo('V', 'VIN'), ['T', 'VIN', 'V', 'VIN'], ['T', 'GND', 'U', 'GND (2)'], ['T', 'SDA', 'U', 'SDA'], ['T', 'SCL', 'U', 'SCL']]));
  assert.ok(codes(both).includes('E:J0610'), codes(both).join(' '));
  const one = checkProject(project([['uno', 'U'], ['vl53l0x', 'V']], i2cTo('V', 'VIN')));
  assert.ok(!codes(one).includes('E:J0610'));
  assert.ok(codes(one).includes('E:J0208'), `logique 3,3 V : ${codes(one).join(' ')}`);
  const ccs = checkProject(project([['uno', 'U'], ['ccs811', 'C']], [...i2cTo('C', 'VCC'), ['C', 'WAKE', 'U', 'GND (2)'], ['C', 'ADDR', 'U', 'GND (3)']]));
  // Surtension vue dès le câblage (J0106, qui couvre le J0306 du calcul du circuit).
  assert.ok(codes(ccs).includes('E:J0106') || codes(ccs).includes('E:J0306'), `5 V sur le CCS811 : ${codes(ccs).join(' ')}`);
  const ok = checkProject(project([['uno', 'U'], ['ccs811', 'C']], [...i2cTo('C', 'VCC', '3V3'), ['C', 'WAKE', 'U', 'GND (2)'], ['C', 'ADDR', 'U', 'GND (3)']]));
  assert.ok(!codes(ok).some(c => c === 'E:J0106' || c === 'E:J0306'), codes(ok).join(' '));
});

/* ---------- Mode fidèle : analyseur de bus sur l'Uno émulé ---------- */
test('Analyseur de bus (Uno émulé) : CCS811 avec la vraie bibliothèque, APP_START et lecture des résultats', { skip: !hasCli && 'arduino-cli absent' }, () => {
  const log = createBusLog({ max: 20000 }), { hw } = fakeBoard({ modules: [{ type: 'ccs811', addr: [0x5a], levels: { WAKE: 0 }, data: ccsValues(900) }] });
  let rt = null;
  hw.probe = log.probe('uno', () => (rt ? rt.clock() : 0));
  rt = boot(compileSketch(`#include "Adafruit_CCS811.h"
Adafruit_CCS811 ccs;
void setup() { Serial.begin(9600); if (!ccs.begin()) Serial.println("absent"); while (!ccs.available()); ccs.readData(); Serial.println(ccs.geteCO2()); }
void loop() {}`), hw);
  runFor(rt, 1600);
  assert.match(rt.takeSerial(), /^900\r\n/);
  const i2c = log.list().filter(r => r.bus === 'i2c' && r.addr === 0x5a);
  assert.ok(i2c.some(r => r.write && r.bytes.length === 1 && r.bytes[0].v === 0xf4), 'APP_START (écriture du seul registre 0xF4)');
  assert.ok(i2c.some(r => !r.write && r.bytes.length === 8 && ((r.bytes[0].v << 8) | r.bytes[1].v) === 900), 'ALG_RESULT_DATA lu en 8 octets');
});
