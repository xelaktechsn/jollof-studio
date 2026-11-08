// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mode fidèle de l'ESP32 (QEMU). Sans émulateur : décodage des registres, signaux du LEDC, port série et démarrages,
// cale (UART1) par un faux transport, refus du Wi-Fi, chaîne de compilation. Avec QEMU (JOLLOF_QEMU ou installé par
// l'application) et le cœur esp32 d'arduino-cli : un vrai programme, de bout en bout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecoder, classify, createEsp32Runtime } from './esp32.js';
import { esp32Refusal, netInclude, UNBRIDGED, unbridgedWarning } from './esp32-limits.js';
import { MODELS } from './devices/index.js';
import { compileFirmware, FQBN, EMULATED } from './compile.js';
import { setQemuReady, QEMU_KINDS } from './boards.js';
import { qemuPath, nodeTransport } from './esp32-node.mjs';
import { fakeBoard, compileSketch, hasCli, hasEsp32Core } from './testkit.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const GPIO = 0x3ff44000, LEDC = 0x3ff59000;

test('Wi-Fi et Bluetooth : le programme reste sur l’interpréteur, avec un message clair', () => {
  assert.equal(netInclude('#include <WiFi.h>\nvoid setup(){}'), 'WiFi.h');
  assert.equal(netInclude('  #include "BluetoothSerial.h"'), 'BluetoothSerial.h');
  assert.equal(netInclude('#include <WebServer.h>'), 'WebServer.h');
  assert.equal(netInclude('#include <Wire.h>\n// #include <WiFi.h> en commentaire'), null);
  assert.match(esp32Refusal('#include <WiFi.h>'), /Wi-Fi.*WiFi\.h.*Débutant/);
  assert.equal(esp32Refusal('#include <Arduino.h>\nvoid setup(){}'), null);
});

test('les modules pas encore reliés à QEMU sont ceux des modèles du mode fidèle', () => {
  assert.deepEqual([...UNBRIDGED].sort(), MODELS.flatMap(m => m.types).sort());
  assert.equal(unbridgedWarning([]), null);
  assert.match(unbridgedWarning([{ name: 'LCD1', type: 'lcd1602' }, { name: 'DHT1', type: 'dht22' }]), /LCD1, DHT1/);
});

test('registres GPIO et LEDC : niveaux, sens, PWM, tone(), servo', () => {
  const d = createDecoder();
  d.write(GPIO + 0x24, 1 << 2); // GPIO_ENABLE_W1TS
  d.write(GPIO + 0x08, 1 << 2); // GPIO_OUT_W1TS
  assert.deepEqual(d.pin(2), { out: true, level: 1, pwm: null });
  d.write(GPIO + 0x0c, 1 << 2);
  assert.equal(d.pin(2).level, 0);
  d.write(GPIO + 0x30, 1 << (33 - 32)); d.write(GPIO + 0x14, 1 << (33 - 32)); // GPIO 33 (registres « 1 »)
  assert.deepEqual(d.pin(33), { out: true, level: 1, pwm: null });
  // analogWrite(25, 64) : canal 0 (vitesse haute), minuterie 0 à 8 bits, 1 kHz depuis l'APB (80 MHz).
  d.write(GPIO + 0x24, 1 << 25); d.write(GPIO + 0x530 + 25 * 4, 71);
  d.write(LEDC + 0x140, 8 | (Math.round(80e6 / 1000 / 256 * 256) << 5) | (1 << 25));
  d.write(LEDC + 0x00, 4); d.write(LEDC + 0x08, 64 << 4);
  const p = d.pin(25).pwm;
  assert.ok(Math.abs(p.duty - 0.25) < 1e-9 && Math.abs(p.freq - 1000) < 1);
  assert.deepEqual(classify(p), { d: 1, pwm: 0.25, freq: 0, servo: null, ledc: p.freq });
  assert.equal(classify({ duty: 0.5, freq: 440 }).freq, 440);
  assert.ok(Math.abs(classify({ duty: 1.472 / 20, freq: 50 }).servo - 90) < 0.5);
  assert.equal(classify({ duty: 0, freq: 1000 }).d, 0);
  d.reset();
  assert.deepEqual(d.pin(25), { out: false, level: 0, pwm: null });
});

/** Faux émulateur : le moteur lui parle comme à QEMU ; le test joue la carte. */
function fakeTransport() {
  const sent = { uart: [], side: [] }, cb = {};
  return {
    sent, cb, stopped: false,
    async start(o) { Object.assign(cb, o); },
    uart(b) { sent.uart.push(...b); }, side(b) { sent.side.push(...b); }, stop() { this.stopped = true; }
  };
}
const frame = (type, pin, value, us) => [type.charCodeAt(0), pin, value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >>> 24) & 255, us & 255, (us >> 8) & 255, (us >> 16) & 255, (us >>> 24) & 255];
const bytes = s => Array.from(s, c => c.charCodeAt(0));

test('port série : messages de démarrage masqués, redémarrages et plantages signalés, boucle de redémarrages arrêtée', async () => {
  const tr = fakeTransport(), { hw } = fakeBoard({ kind: 'esp32' });
  const rt = createEsp32Runtime(new Uint8Array(16), hw, { transport: tr });
  await sleep(0);
  const boot = 'ets Jul 29 2019 12:21:46\r\n\r\nrst:0x1 (POWERON_RESET),boot:0x12 (SPI_FAST_FLASH_BOOT)\r\nconfigsip: 0, SPIWP:0xee\r\nmode:DIO, clock div:1\r\nload:0x3fff0030,len:4604\r\nho 0 tail 12 room 4\r\nentry 0x400805b8\r\n';
  tr.cb.onUart(1, bytes(boot + 'Bonjour\r\n'));
  assert.equal(rt.takeSerial(), 'Bonjour\r\n');
  tr.cb.onUart(2, bytes('Valeur : 42')); // ligne sans fin : montrée à l'image suivante
  rt.run(16);
  assert.equal(rt.takeSerial(), 'Valeur : 42');
  tr.cb.onUart(3, bytes('\r\nGuru Meditation Error: Core  1 panic\'ed (LoadProhibited). Exception was unhandled.\r\n'));
  assert.match(rt.takeSerial(), /Guru Meditation/);
  tr.cb.onUart(4, bytes('ets Jul 29 2019 12:21:46\r\n\r\nrst:0xc (SW_CPU_RESET),boot:0x12 (SPI_FAST_FLASH_BOOT)\r\nentry 0x400805b8\r\nBonjour\r\n'));
  assert.match(rt.takeSerial(), /redémarre : plantage \(LoadProhibited\)[^]*Bonjour/);
  assert.equal(rt.state, 'run');
  for (let i = 0; i < 2; i++) tr.cb.onUart(5, bytes('rst:0x8 (TG1WDT_SYS_RESET),boot:0x12\r\n'));
  assert.equal(rt.state, 'error');
  assert.match(rt.error.msg, /redémarre sans cesse/);
  assert.ok(tr.stopped, 'émulateur arrêté');
});

test('cale (UART1) : heure de la carte, pinMode, entrées et ADC envoyés, sorties lues dans la trace', async () => {
  const tr = fakeTransport(), inputs = { D4: { d: 0 }, D34: { v: 1.65 } };
  const { hw } = fakeBoard({ kind: 'esp32', inputs });
  const rt = createEsp32Runtime(new Uint8Array(16), hw, { transport: tr });
  await sleep(0);
  assert.equal(rt.clock(), 0, 'pas encore démarrée');
  tr.cb.onSide(100, [...frame('J', 0, 1, 500000), ...frame('M', 4, 0x05, 500100)]); // cale prête, pinMode(4, INPUT_PULLUP)
  assert.ok(rt.clock() >= 500 && rt.clock() < 700, `heure de la carte : ${rt.clock()}`);
  // Aussitôt prête, la cale reçoit les niveaux (GPIO 4 à LOW, imposé par le montage) et l'ADC de D34 (GPIO 34).
  const I = tr.sent.side.indexOf(0x49);
  assert.ok(I >= 0);
  assert.equal(tr.sent.side[I + 1] & (1 << 4), 0);
  const A = tr.sent.side.findIndex((b, i) => b === 0x41 && tr.sent.side[i + 1] === 34);
  assert.equal(tr.sent.side[A + 2] | (tr.sent.side[A + 3] << 8), 2048);
  rt.run(16);
  assert.equal(rt.pins.get('D4').mode, 2, 'entrée avec tirage haut');
  tr.sent.side.length = 0;
  inputs.D4 = null; // relâché : le tirage interne le tient à HIGH
  rt.run(16);
  assert.equal(tr.sent.side[0], 0x49);
  assert.equal(tr.sent.side[1] & (1 << 4), 1 << 4);
  // Sortie D2 (GPIO 2) dans la trace.
  tr.cb.onTrace([[GPIO + 0x24, 1 << 2, 101], [GPIO + 0x08, 1 << 2, 102]]);
  rt.run(16);
  assert.deepEqual([rt.pins.get('D2').mode, rt.pins.get('D2').d], [1, 1]);
  rt.send('x');
  assert.deepEqual(tr.sent.uart, [0x78]);
  rt.stop();
  assert.ok(tr.stopped);
});

test('redémarrage de la carte : millis() repart de 0, le temps du moteur ne recule pas', async () => {
  const tr = fakeTransport(), { hw } = fakeBoard({ kind: 'esp32' });
  const rt = createEsp32Runtime(new Uint8Array(16), hw, { transport: tr });
  await sleep(0);
  tr.cb.onSide(10, frame('J', 0, 1, 2_000_000)); // 2 s après le démarrage de la carte
  const before = rt.clock();
  assert.ok(before >= 2000);
  tr.cb.onUart(11, bytes('rst:0xc (SW_CPU_RESET),boot:0x12 (SPI_FAST_FLASH_BOOT)\r\n'));
  assert.ok(rt.clock() >= before, 'pas de retour en arrière pendant le redémarrage');
  tr.cb.onSide(12, frame('J', 0, 1, 300_000)); // la carte a redémarré : millis() = 300
  assert.ok(rt.clock() >= before + 300 - 1, `${rt.clock()} ≥ ${before} + 300`);
  rt.stop();
});

test('compilation : ESP32 en flash DIO, avec la cale, image fusionnée ; Wi-Fi refusé', async () => {
  assert.equal(FQBN.esp32, 'esp32:esp32:esp32:FlashMode=dio');
  assert.ok(QEMU_KINDS.has('esp32'));
  const was = EMULATED.has('esp32');
  setQemuReady(false);
  assert.ok(!EMULATED.has('esp32'), 'sans QEMU, pas de mode fidèle pour l’ESP32');
  setQemuReady(true);
  try {
    const calls = [], img = new Uint8Array(4 << 20);
    const cli = {
      available: () => true,
      run: async a => { calls.push(a.join(' ')); return a[0] === 'core' && a[1] === 'list' ? { code: 0, stdout: '{"platforms":[{"id":"esp32:esp32"}]}' } : { code: 0, stdout: '' }; },
      write: async (code, o) => { calls.push(`write shim=${!!(o && o.shim)}`); return '/s/jollof_sketch'; },
      paths: async () => ['/s/jollof_sketch', '/b/jollof_sketch'],
      read: async ext => { calls.push(`read ${ext}`); return img; }
    };
    const r = await compileFirmware('void setup(){}\nvoid loop(){}', 'esp32', () => {}, cli);
    assert.ok(r.ok && r.image.length === img.length && r.format === 'merged');
    assert.ok(calls.includes('write shim=true'));
    assert.ok(calls.includes('compile --fqbn esp32:esp32:esp32:FlashMode=dio --output-dir /b/jollof_sketch /s/jollof_sketch'));
    assert.ok(calls.includes('read merged.bin'));
    const w = await compileFirmware('#include <WiFi.h>\nvoid setup(){}\nvoid loop(){}', 'esp32', () => {}, cli);
    assert.equal(w.ok, false);
    assert.match(w.errors[0].msg, /Wi-Fi/);
  } finally { setQemuReady(was); }
});

/* ---------- De bout en bout, avec QEMU ---------- */
const QEMU = qemuPath();
const live = !!QEMU && hasCli && hasEsp32Core();
const SKETCH = `// Banc d'essai du mode fidèle ESP32 : clignotement, port série, entrées, ADC, interruptions, PWM, servo.
volatile uint32_t edges = 0;
void IRAM_ATTR onEdge() { edges++; }
void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  pinMode(13, OUTPUT);
  pinMode(4, INPUT_PULLUP);
  attachInterrupt(4, onEdge, CHANGE);
  analogWrite(25, 64);
  ledcAttachChannel(26, 50, 16, 2); // canal 2, minuterie 1 : les canaux 0 et 1 partagent la minuterie 0 (celle d'analogWrite)
  ledcWrite(26, 4915);
  Serial.printf("SETUP D4=%d\\n", digitalRead(4));
}
unsigned long last = 0;
bool led = false;
int prev = -1;
void loop() {
  if (millis() - last >= 250) { last = millis(); led = !led; digitalWrite(2, led); }
  int v = digitalRead(4);
  if (v != prev) { prev = v; digitalWrite(13, v); }
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'a') Serial.printf("ADC %u\\n", analogRead(34));
    else if (c == 'e') Serial.printf("EDGES %lu\\n", edges);
    else if (c != '\\n' && c != '\\r') Serial.printf("ECHO %c\\n", c);
  }
  delay(1);
}
`;

test('vrai programme dans QEMU : clignotement, Serial dans les deux sens, entrées, ADC, interruptions, PWM, servo', { skip: !live && 'QEMU (JOLLOF_QEMU) ou cœur esp32 absent', timeout: 240000 }, async () => {
  const image = compileSketch(SKETCH, FQBN.esp32);
  const inputs = { D4: { d: 0 }, D34: { v: 1.65 } };
  const { hw } = fakeBoard({ kind: 'esp32', inputs });
  const rt = createEsp32Runtime(image, hw, { transport: nodeTransport({ qemu: QEMU }) });
  let serial = '';
  const edges = [];
  rt.setTrace((key, s, t) => { if (key === 'D2') edges.push([t, s.d]); });
  const until = async (fn, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { rt.run(16); serial += rt.takeSerial(); if (fn()) return; assert.notEqual(rt.state, 'error', rt.error && rt.error.msg); await sleep(16); }
    assert.fail(`${what} : délai dépassé\n${serial}`);
  };
  try {
    const t0 = Date.now();
    await until(() => /SETUP/.test(serial), 30000, 'démarrage');
    const bootMs = Date.now() - t0;
    assert.match(serial, /SETUP D4=0/, 'digitalRead() dans setup() lit déjà le montage');
    assert.ok(!/ets Jul|rst:0x|load:0x/.test(serial), 'messages de démarrage masqués');
    // Clignotement : D2 change toutes les 250 ms (temps de la carte).
    await until(() => edges.length >= 9, 6000, 'clignotement');
    const half = edges.slice(1).map((e, i) => e[0] - edges[i][0]).sort((a, b) => a - b);
    const med = half[half.length >> 1];
    assert.ok(Math.abs(med - 250) < 15, `demi-période ${med} ms`);
    // Serial : un octet envoyé revient en écho.
    rt.send('x');
    await until(() => /ECHO x/.test(serial), 3000, 'écho série');
    // Entrées : D4 recopiée sur D13, fronts comptés par attachInterrupt.
    assert.equal(rt.pins.get('D13').d, 0);
    for (const [lv, n] of [[1, 1], [0, 2], [1, 3]]) {
      inputs.D4 = { d: lv };
      await until(() => rt.pins.get('D13').d === lv, 2000, `D4 → D13 (${lv})`);
      void n;
    }
    rt.send('e');
    await until(() => /EDGES \d+/.test(serial), 3000, 'interruptions');
    assert.equal(+/EDGES (\d+)/.exec(serial)[1], 3);
    // ADC : 1,65 V sur D34 → la moitié de 4095.
    rt.send('a');
    await until(() => /ADC \d+/.test(serial), 3000, 'ADC');
    assert.ok(Math.abs(+/ADC (\d+)/.exec(serial)[1] - 2048) <= 2);
    // analogWrite(25, 64) : PWM à 25 %, 1 kHz ; ledcWrite(26, …) à 50 Hz, 1,5 ms : servo vers 93°.
    const p = rt.pins.get('D25'), s = rt.pins.get('D26');
    assert.ok(p.mode === 1 && Math.abs(p.pwm - 0.25) < 0.005 && Math.abs(p.ledc - 1000) < 5, JSON.stringify(p));
    assert.ok(Math.abs(s.servo - 92.7) < 3, JSON.stringify(s));
    assert.ok(rt.clock() > 1000);
    console.log(`  ESP32 dans QEMU : setup() après ${bootMs} ms, demi-période ${med.toFixed(1)} ms`);
  } finally { rt.stop(); }
});
