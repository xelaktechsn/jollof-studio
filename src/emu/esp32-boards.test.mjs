// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Un ESP32 dans QEMU (mode fidèle) et un Mega 2560 émulé (avr8js) dans le même montage : radio LoRa SX1278 et radio
// HC-12 entre les deux, chaque carte avec son vrai programme et ses vraies bibliothèques.
// Le Mega avance en temps virtuel, au rythme de l'ESP32, qui tourne en temps réel.
// Sans QEMU (JOLLOF_QEMU ou installé par l'application), arduino-cli ou le cœur esp32, le test est ignoré.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEsp32Runtime } from './esp32.js';
import { qemuPath, nodeTransport } from './esp32-node.mjs';
import { FQBN } from './boards.js';
import { hasCli, hasEsp32Core, compileSketch, fakeBoard, boot } from './testkit.mjs';

const QEMU = qemuPath(), live = !!QEMU && hasCli && hasEsp32Core();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ESP = `#include <SPI.h>
#include <LoRa.h>
int n = 0;
void setup() {
  Serial.begin(115200);
  LoRa.setPins(15, 14, 26);
  Serial.println(LoRa.begin(433E6) ? "lora ok" : "lora echec");
  Serial2.begin(9600, SERIAL_8N1, 16, 17);            // HC-12
}
void loop() {
  LoRa.beginPacket(); LoRa.print("Bonjour "); LoRa.print(n); LoRa.endPacket();
  Serial2.print("T="); Serial2.println(20 + n);
  n++;
  delay(300);
}`;
const MEGA = `#include <SPI.h>
#include <LoRa.h>
String hc = "";
void setup() {
  Serial.begin(115200);
  LoRa.setPins(53, 9, 2);
  Serial.println(LoRa.begin(433E6) ? "lora ok" : "lora echec");
  Serial1.begin(9600);                                 // HC-12 sur RX1/TX1
}
void loop() {
  int p = LoRa.parsePacket();
  if (p) { Serial.print("lora:"); Serial.println(LoRa.readString()); }
  while (Serial1.available()) { char c = Serial1.read(); if (c == '\\n') { hc.trim(); Serial.print("hc12:"); Serial.println(hc); hc = ""; } else hc += c; }
}`;

test('ESP32 (QEMU) et Mega 2560 (avr8js) : LoRa et HC-12 de l’un à l’autre', { skip: !live && 'QEMU (JOLLOF_QEMU), arduino-cli ou cœur esp32 absent', timeout: 900000 }, async () => {
  const espImg = compileSketch(ESP, FQBN.esp32), megaHex = compileSketch(MEGA, 'arduino:avr:mega');
  const e = fakeBoard({ kind: 'esp32', modules: [
    { type: 'sx1278', id: 'loraE', pins: { NSS: 'D15', RST: 'D14', DIO0: 'D26', SCK: 'D18', MOSI: 'D23', MISO: 'D19' } },
    { type: 'hc12', id: 'hcE', pins: { TXD: 'RX2', RXD: 'TX2' } }
  ] });
  const m = fakeBoard({ kind: 'mega', modules: [
    { type: 'sx1278', id: 'loraM', pins: { NSS: 'D53', RST: 'D9', DIO0: 'D2', SCK: 'D52', MOSI: 'D51', MISO: 'D50' } },
    { type: 'hc12', id: 'hcM', pins: { TXD: 'D19', RXD: 'D18' } }
  ] });
  const all = [...e.comps, ...m.comps];
  for (const b of [e, m]) b.hw.peers = types => all.filter(c => types.includes(c.type)).map(c => ({ comp: c, ok: true }));
  const esp = createEsp32Runtime(espImg, e.hw, { transport: nodeTransport({ qemu: QEMU }) }), mega = boot(megaHex, m.hw);
  let eo = '', mo = '';
  try {
    const end = Date.now() + 90000;
    let last = performance.now();
    while (Date.now() < end) {
      const now = performance.now(), dt = Math.min(50, now - last); last = now;
      esp.run(16);
      if (esp.hw.shimReady()) mega.run(dt);
      eo += esp.takeSerial(); mo += mega.takeSerial();
      assert.notEqual(esp.state, 'error', esp.error && esp.error.msg);
      if (/lora:Bonjour \d+\r\n[^]*lora:Bonjour \d+/.test(mo) && /hc12:T=\d+\r\n[^]*hc12:T=\d+\r\n/.test(mo)) break;
      await sleep(16);
    }
  } finally { esp.stop(); }
  assert.match(eo, /lora ok/);
  assert.match(mo, /lora ok/);
  // Le Mega démarre quand la cale de l'ESP32 est prête : le premier paquet peut partir avant qu'il n'écoute.
  const lora = [...mo.matchAll(/lora:Bonjour (\d+)\r\n/g)].map(m => +m[1]), hc = [...mo.matchAll(/hc12:T=(\d+)\r\n/g)].map(m => +m[1]);
  assert.ok(lora.length >= 2 && lora[1] === lora[0] + 1, mo);
  assert.ok(hc.length >= 2 && hc[1] === hc[0] + 1 && hc[0] >= 20, mo);
});
