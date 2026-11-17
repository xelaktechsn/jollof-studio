// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Radio LoRa SX1278 (src/sim/lora.js, src/emu/devices/sx1278.js, src/prog/loralib.js) : temps d'antenne, règles de
// réception, puis de vrais programmes (bibliothèque LoRa de Sandeep Mistry) sur deux cartes émulées (Uno, Pico), une
// réception par interruption sur DIO0, une carte émulée et une carte interprétée qui se parlent, l'analyseur de bus.
// Sans arduino-cli sur la machine, les tests en mode fidèle sont ignorés. node --test src/emu/devices/lora.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCli, hasPicoCore, compileSketch, fakeBoard, boot, runFor } from '../testkit.mjs';
import { airtime, hears, loraChip, loraSettings, loraState, MODE } from '../../sim/lora.js';
import { createBusLog, describe } from '../../sim/buslog.js';
import { compile } from '../../prog/lang.js';
import { createRuntime } from '../../prog/runtime.js';
import { BOARDS } from '../../sim/boards.js';

const skip = !hasCli && 'arduino-cli absent';

/* ---------- Modèle ---------- */
test('temps d’antenne : formule de la fiche Semtech (SF7 et SF12, 125 kHz)', () => {
  // SF7, 125 kHz, 4/5, préambule 8, 10 octets, CRC, en-tête explicite : 12,25 + 28 symboles de 1,024 ms.
  assert.ok(Math.abs(airtime({ sf: 7, bw: 125e3, cr: 1, pre: 8, len: 10, crc: true }) * 1000 - 41.216) < 1e-6);
  // SF12 avec optimisation bas débit : 12,25 + 18 symboles de 32,768 ms.
  assert.ok(Math.abs(airtime({ sf: 12, bw: 125e3, cr: 1, pre: 8, len: 10, crc: true, ldro: true }) * 1000 - 991.232) < 1e-6);
  // En-tête implicite, sans CRC : plus court.
  assert.ok(airtime({ sf: 7, len: 10, crc: false, ih: true }) < airtime({ sf: 7, len: 10, crc: true }));
});

/** Puce prête : mode LoRa, réglages de la bibliothèque (433 MHz, SF7, 125 kHz), dans le mode voulu. */
function radio(id, mode, regs = {}) {
  const comp = { id, type: 'sx1278', name: id.toUpperCase() };
  const chip = loraChip(comp, { now: () => radio.t, peers: () => radio.all.map(c => ({ comp: c, ok: true })) });
  const w = (a, v) => { chip.select(); chip.transfer(a | 0x80); chip.transfer(v); chip.deselect(); };
  const r = a => { chip.select(); chip.transfer(a); const v = chip.transfer(0); chip.deselect(); return v; };
  w(0x01, 0x80); w(0x06, 0x6c); w(0x07, 0x40); w(0x08, 0x00); // 433 MHz
  for (const [a, v] of Object.entries(regs)) w(+a, v);
  w(0x01, 0x80 | mode);
  radio.all.push(comp);
  return { comp, chip, w, r };
}
radio.t = 0; radio.all = [];

test('puce : registres, FIFO, émission vers un récepteur réglé pareil, pas vers les autres', () => {
  radio.t = 0; radio.all = [];
  const tx = radio('tx', MODE.STDBY), rx = radio('rx', MODE.RX_CONTINUOUS), sf9 = radio('sf9', MODE.RX_CONTINUOUS, { 0x1e: 0x94 }), far = radio('far', MODE.RX_CONTINUOUS, { 0x06: 0x6c, 0x07: 0x80 });
  const sync = radio('sync', MODE.RX_CONTINUOUS, { 0x39: 0x34 }), sleepy = radio('sleepy', MODE.STDBY);
  assert.equal(tx.r(0x42), 0x12, 'RegVersion');
  assert.equal(loraSettings(loraState(tx.comp)).sf, 7);
  assert.ok(Math.abs(loraSettings(loraState(tx.comp)).freq - 433e6) < 100);
  // Paquet « Salut » : FIFO à partir de RegFifoTxBaseAddr (0x80 par défaut, mis à 0 ici), longueur, mode TX.
  tx.w(0x0e, 0); tx.w(0x0d, 0); for (const ch of 'Salut') tx.w(0x00, ch.charCodeAt(0)); tx.w(0x22, 5); tx.w(0x01, 0x83);
  assert.equal(tx.r(0x01), 0x83, 'en émission');
  const t = airtime({ len: 5 });
  radio.t = t / 2; tx.chip.tick();
  assert.equal(tx.r(0x12) & 0x08, 0, 'pas encore fini');
  radio.t = t + 1e-6; tx.chip.tick();
  assert.equal(tx.r(0x12) & 0x08, 0x08, 'TxDone');
  assert.equal(tx.r(0x01), 0x81, 'retour en veille');
  assert.equal(rx.r(0x12) & 0x40, 0x40, 'RxDone');
  assert.equal(rx.r(0x13), 5);
  rx.w(0x0d, rx.r(0x10));
  assert.equal(String.fromCharCode(...[0, 1, 2, 3, 4].map(() => rx.r(0x00))), 'Salut');
  const rssi = rx.r(0x1a) - 164;
  assert.ok(rssi <= -43 && rssi >= -73, `RSSI ${rssi}`); // +17 dBm, 60 à 90 dB d’affaiblissement
  for (const o of [sf9, far, sync, sleepy]) assert.equal(o.r(0x12) & 0x40, 0, `${o.comp.id} n’entend pas`);
  rx.w(0x12, 0xff);
  assert.equal(rx.r(0x12), 0, 'drapeaux effacés en écrivant 1');
  // RX simple : retour en veille après le paquet.
  const single = radio('single', MODE.RX_SINGLE);
  tx.w(0x0d, 0); tx.w(0x00, 42); tx.w(0x22, 1); tx.w(0x01, 0x83);
  radio.t += 1; tx.chip.tick();
  assert.equal(single.r(0x01), 0x81);
  assert.equal(single.r(0x13), 1);
});

test('règles de réception : IQ inversé, en-tête implicite, hors de la bande du SX1278', () => {
  const base = { lora: true, mode: MODE.RX_CONTINUOUS, freq: 433e6, bw: 125e3, sf: 7, sync: 0x12, iqTx: false, iqRx: false, ih: false, cr: 1, crc: true, len: 4 };
  assert.ok(hears(base, base));
  assert.ok(!hears({ ...base, iqTx: true }, base));
  assert.ok(hears({ ...base, iqTx: true }, { ...base, iqRx: true }));
  assert.ok(hears({ ...base, freq: 433e6 + 20e3 }, base), 'à 20 kHz : dans le quart de la bande');
  assert.ok(!hears({ ...base, freq: 433e6 + 40e3 }, base));
  assert.ok(!hears({ ...base, freq: 868e6 }, { ...base, freq: 868e6 }), '868 MHz : hors de la bande du SX1278');
  assert.ok(!hears({ ...base, ih: true }, base));
  assert.ok(hears({ ...base, ih: true }, { ...base, ih: true }));
  assert.ok(!hears({ ...base, ih: true, len: 5 }, { ...base, ih: true }));
  assert.ok(!hears(base, { ...base, mode: MODE.STDBY }));
});

/* ---------- Mode fidèle ---------- */
const TX = `#include <SPI.h>
#include <LoRa.h>
int n = 0;
void setup() {
  Serial.begin(115200);
  if (!LoRa.begin(433E6)) { Serial.println("echec"); while (1); }
  Serial.println("tx ok");
}
void loop() {
  LoRa.beginPacket(); LoRa.print("Bonjour "); LoRa.print(n++); LoRa.endPacket();
  Serial.println("envoye");
  delay(200);
}`;
const RX = `#include <SPI.h>
#include <LoRa.h>
void setup() {
  Serial.begin(115200);
  if (!LoRa.begin(433E6)) { Serial.println("echec"); while (1); }
  Serial.println("rx ok");
}
void loop() {
  int n = LoRa.parsePacket();
  if (n) {
    String s = LoRa.readString();
    Serial.print(s); Serial.print(" rssi="); Serial.print(LoRa.packetRssi()); Serial.print(" snr="); Serial.println(LoRa.packetSnr());
  }
}`;
const IRQ_RX = `#include <SPI.h>
#include <LoRa.h>
volatile int got = 0;
String buf;
void onRx(int n) { buf = ""; while (LoRa.available()) buf += (char)LoRa.read(); got = n; }
void setup() {
  Serial.begin(115200);
  if (!LoRa.begin(433E6)) { Serial.println("echec"); while (1); }
  LoRa.onReceive(onRx);
  LoRa.receive();
  Serial.println("ecoute");
}
void loop() { if (got) { noInterrupts(); int n = got; got = 0; interrupts(); Serial.print("irq "); Serial.print(n); Serial.print(" "); Serial.println(buf); } }`;
const LORA_PINS = { NSS: 'D10', RST: 'D9', DIO0: 'D2', SCK: 'D13', MOSI: 'D11', MISO: 'D12' };
/** Carte en mode fidèle avec un SX1278 ; out accumule le port série. */
function fw(src, { kind = 'uno', fqbn = 'arduino:avr:uno', pins = LORA_PINS, id, probe } = {}) {
  const { hw, comps } = fakeBoard({ kind, modules: [{ type: 'sx1278', id, pins }] });
  if (probe) hw.probe = probe;
  const rt = boot(compileSketch(src, fqbn), hw);
  return { rt, hw, comps, out: '', take() { this.out += rt.takeSerial(); return this.out; } };
}
function together(boards, ms, dt = 2) { for (let t = 0; t < ms; t += dt) for (const b of boards) b.rt.run(dt); boards.forEach(b => b.take()); }
function air(...boards) {
  const all = boards.flatMap(b => b.comps || b.radios);
  for (const b of boards) b.hw.peers = types => all.filter(c => types.includes(c.type)).map(c => ({ comp: c, ok: true }));
}

test('LoRa : deux Uno en mode fidèle, l’un émet, l’autre reçoit (parsePacket, readString, packetRssi)', { skip }, () => {
  const a = fw(TX, { id: 'lora-a' }), b = fw(RX, { id: 'lora-b' });
  air(a, b);
  together([b, a], 1200);
  assert.match(a.out, /^tx ok\r\n(envoye\r\n){3,}/);
  assert.match(b.out, /^rx ok\r\nBonjour 0 rssi=-\d+ snr=\d+\.\d+\r\nBonjour 1 rssi=/);
  const rssi = +/rssi=(-\d+)/.exec(b.out)[1];
  assert.ok(rssi <= -40 && rssi >= -80, b.out);
});

test('LoRa : réception par interruption sur DIO0 (onReceive, receive)', { skip }, () => {
  const a = fw(TX, { id: 'lora-a' }), b = fw(IRQ_RX, { id: 'lora-c' });
  air(a, b);
  together([b, a], 900);
  assert.match(b.out, /^ecoute\r\nirq 9 Bonjour 0\r\nirq 9 Bonjour 1\r\n/);
  assert.equal(b.rt.hw.pinApi.level('D2'), 0, 'DIO0 retombée : RxDone effacé');
});

test('LoRa : autre fréquence ou autre facteur d’étalement, rien n’arrive', { skip }, () => {
  for (const change of ['LoRa.setFrequency(434E6);', 'LoRa.setSpreadingFactor(9);', 'LoRa.setSyncWord(0x34);']) {
    const a = fw(TX, { id: 'lora-a' }), b = fw(RX.replace('Serial.println("rx ok");', change + ' Serial.println("rx ok");'), { id: 'lora-b' });
    air(a, b);
    together([b, a], 700);
    assert.match(a.out, /envoye/);
    assert.equal(b.out, 'rx ok\r\n', change);
  }
});

test('LoRa : RST tenue à LOW, la puce ne répond pas (begin échoue)', { skip }, () => {
  const b = fw(RX.replace('if (!LoRa.begin', 'LoRa.setPins(10, 8, 2); pinMode(9, OUTPUT); digitalWrite(9, LOW);\n  if (!LoRa.begin'), { id: 'lora-r' });
  runFor(b.rt, 200); b.take();
  assert.equal(b.out, 'echec\r\n');
});

test('LoRa : un Pico (SPI0 sur GP16 à GP19) parle à un Uno', { skip: skip || (!hasPicoCore() && 'cœur rp2040 absent') }, () => {
  const P = TX.replace('if (!LoRa.begin', 'LoRa.setPins(17, 20, 21);\n  if (!LoRa.begin');
  const a = fw(P, { kind: 'pico', fqbn: 'rp2040:rp2040:rpipico', pins: { NSS: 'GP17', RST: 'GP20', DIO0: 'GP21', SCK: 'GP18', MOSI: 'GP19', MISO: 'GP16' }, id: 'lora-p' });
  const b = fw(RX, { id: 'lora-b' });
  air(a, b);
  runFor(b.rt, 50);
  together([b, a], 1500);
  assert.match(a.out, /tx ok\r\n(envoye\r\n){2,}/);
  assert.match(b.out, /^rx ok\r\nBonjour \d+ rssi=/);
});

/** Carte interprétée sur un pont minimal : fils vers le module LoRa, radios du montage. */
function interp(src, radio, wires) {
  const c = compile(src, { board: 'uno' });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const at = k => wires[k] || [];
  const hw = {
    kind: 'uno', label: 'uno', prof: BOARDS.uno, read: () => null, echo: () => null, data: () => null, at, bus: () => [], i2c: () => [],
    onPin: (k, types) => { const h = at(k).find(x => types.includes(x.comp.type)); return h ? h.comp : null; },
    status: () => ({ ok: true, msg: '' }), mem: () => ({ ee: '', prefs: {} }), level: () => null
  };
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  return { rt, hw, radios: [radio], out: '', take() { this.out += rt.takeSerial(); return this.out; } };
}
const loraWires = r => Object.fromEntries(Object.entries({ D10: 'NSS', D9: 'RST', D2: 'DIO0' }).map(([k, pin]) => [k, [{ comp: r, pin }]]));

test('LoRa : une carte émulée et une carte interprétée se parlent, dans les deux sens', { skip }, () => {
  const a = fw(TX, { id: 'lora-a' }), r = { type: 'sx1278', id: 'lora-i', name: 'LORA2' };
  const b = interp(RX.replace(/\r?\n/g, '\n'), r, loraWires(r));
  air(a, b);
  together([b, a], 900);
  assert.doesNotMatch(b.out, /echec/);
  assert.match(b.out, /rx ok\nBonjour 0 rssi=-\d+ snr=[\d.]+\n/);
  // Carte interprétée (réception par onReceive) ← carte émulée, puis carte interprétée → carte émulée.
  const r2 = { type: 'sx1278', id: 'lora-j', name: 'LORA3' }, c = interp(IRQ_RX, r2, loraWires(r2)), d = fw(TX, { id: 'lora-d' });
  air(c, d);
  together([c, d], 700);
  assert.match(c.out, /ecoute\nirq 9 Bonjour 0\n/);
  const r3 = { type: 'sx1278', id: 'lora-k', name: 'LORA4' }, e = interp(TX, r3, loraWires(r3)), f = fw(RX, { id: 'lora-f' });
  air(e, f);
  runFor(f.rt, 50);
  together([f, e], 900);
  assert.match(e.out, /tx ok\n(envoye\n){2,}/);
  assert.match(f.out, /rx ok\r\nBonjour 0 rssi=-\d+/);
});

test('LoRa : l’analyseur de bus voit les registres en SPI, dans les deux modes', { skip }, () => {
  const log = createBusLog();
  let a = null;
  a = fw(TX, { id: 'lora-a', probe: log.probe('a', () => (a ? a.rt.clock() : 0)) });
  air(a);
  runFor(a.rt, 100);
  const rows = log.list().filter(x => x.bus === 'spi').map(describe);
  assert.ok(rows.includes('MOSI 42 00 | MISO 00 12'), 'lecture de RegVersion : ' + rows.slice(0, 4).join(' / '));
  assert.ok(rows.includes('MOSI 81 83 | MISO 00 00'), 'passage en émission');
  const log2 = createBusLog(), r = { type: 'sx1278', id: 'lora-z', name: 'LORA9' }, b = interp(TX, r, loraWires(r));
  b.hw.probe = log2.probe('b', () => b.rt.clock());
  air(b);
  for (let t = 0; t < 100; t += 4) b.rt.run(4);
  const rows2 = log2.list().filter(x => x.bus === 'spi');
  assert.ok(rows2.some(x => describe(x) === 'MOSI 42 00 | MISO 00 12' && x.dev === 'LORA9'));
  assert.ok(rows2.some(x => describe(x) === 'MOSI 81 83 | MISO 00 00'));
});

/* ---------- Vérificateur ---------- */
test('vérificateur : SX1278 au 5 V (destructif), entrées 3,3 V commandées en 5 V, deux cartes bien câblées', async () => {
  const { loadProject } = await import('../../check/load.js'), { checkProject } = await import('../../check/check.js');
  const codes = r => r.diags.map(d => `${d.level === 'error' ? 'E' : 'w'}:${d.code}`).sort();
  const wired = (board, pwr, pins) => loadProject({
    comps: [{ id: 'U', type: board, name: 'U' }, { id: 'L', type: 'sx1278', name: 'L' }],
    wires: [['L', '3.3V', 'U', pwr], ['L', 'GND', 'U', 'GND'], ...Object.entries(pins).map(([k, v]) => ['L', k, 'U', v])].map(([a, ka, b, kb]) => ({ a: [a, ka], b: [b, kb] }))
  });
  const UNO = { NSS: 'D10', SCK: 'D13', MOSI: 'D11', MISO: 'D12', RST: 'D9', DIO0: 'D2' };
  // Surtension sur l'alimentation : J0106 (câblage) ou J0306 (calcul du circuit), une erreur dans les deux cas.
  const five = checkProject(wired('uno', '5V', UNO)), d = five.diags.find(x => (x.code === 'J0106' || x.code === 'J0306') && x.loc.comp && x.loc.comp.id === 'L');
  assert.ok(d && d.level === 'error' && d.loc.key === '3.3V', codes(five).join(' '));
  // Sur la broche 3V3 de l'Uno : 120 mA en émission pour 50 mA disponibles (J0109), et NSS, SCK, MOSI, RST reçoivent du
  // 5 V, au-delà de ce que tolèrent leurs entrées (J0208, une erreur). Il faut un régulateur 3,3 V (AMS1117) et un
  // adaptateur de niveau.
  const ok3 = checkProject(wired('uno', '3V3', UNO));
  assert.deepEqual([...new Set(codes(ok3).filter(c => c.startsWith('E:')))], ['E:J0109', 'E:J0208'], codes(ok3).join(' '));
  // Pico (3,3 V) : rien à redire.
  const pico = checkProject(wired('pico', '3V3', { NSS: 'GP17', SCK: 'GP18', MOSI: 'GP19', MISO: 'GP16', RST: 'GP20', DIO0: 'GP21' }));
  assert.equal(pico.errors, 0, codes(pico).join(' '));
  assert.ok(!codes(pico).some(c => c.endsWith(':J0208')), codes(pico).join(' '));
});
