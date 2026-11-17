// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// ESP32-S3 (qemu-system-xtensa, machine esp32s3) et ESP32-C3 (qemu-system-riscv32, machine esp32c3) en mode fidèle :
// le même programme que sur l'ESP32 — clignotement, port série dans les deux sens, entrée, bus I2C (BMP280), DHT22 —
// compilé pour chaque puce avec la cale. Limites constatées (docs/ESP32-QEMU-TRIAL.md, 14.4) : la PWM du LEDC n'est pas
// décodée sur ces puces (QEMU n'a pas de modèle de LEDC pour elles), et le DHT ne répond pas encore sur l'ESP32-C3.
// Sans QEMU (JOLLOF_QEMU, qemu-system-riscv32 à côté ou JOLLOF_QEMU_RISCV32), arduino-cli ou le cœur esp32 : ignoré.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEsp32Runtime } from './esp32.js';
import { qemuPath, nodeTransport } from './esp32-node.mjs';
import { FQBN } from './boards.js';
import { hasCli, hasEsp32Core, compileSketch, fakeBoard } from './testkit.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SKETCH = `#include <Wire.h>
#include <Adafruit_BMP280.h>
#include <DHT.h>
Adafruit_BMP280 bmp;
DHT dht(5, DHT22);
unsigned long last = 0;
bool led = false;
void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  pinMode(4, INPUT_PULLUP);
  analogWrite(3, 64);
  Wire.begin();
  Serial.printf("SETUP D4=%d\\n", digitalRead(4));
  Serial.print("bmp="); Serial.print(bmp.begin(0x76)); Serial.print(" T="); Serial.println(bmp.readTemperature());
  dht.begin();
  Serial.print("dht T="); Serial.println(dht.readTemperature());
}
void loop() {
  if (millis() - last >= 250) { last = millis(); led = !led; digitalWrite(2, led); }
  while (Serial.available()) { char c = Serial.read(); if (c == 'r') Serial.printf("D4=%d\\n", digitalRead(4)); }
  delay(1);
}
`;

for (const [kind, arch] of [['esp32s3', 'xtensa'], ['esp32c3', 'riscv32']]) {
  const live = !!qemuPath(arch) && hasCli && hasEsp32Core();
  test(`${kind} dans QEMU : clignotement, Serial, entrée, I2C${kind === 'esp32s3' ? ', DHT22' : ''}`, { skip: !live && `QEMU (qemu-system-${arch}), arduino-cli ou cœur esp32 absent`, timeout: 900000 }, async () => {
    const image = compileSketch(SKETCH, FQBN[kind]);
    const inputs = { IO4: { d: 0 }, IO5: { d: 1 } };
    const { hw } = fakeBoard({ kind, inputs, modules: [
      { type: 'bmp280', addr: [0x76], data: { temp: 24.5, press: 1007 } },
      { type: 'dht22', pins: { DATA: 'IO5' }, data: { temp: 21.5, hum: 40 } }
    ] });
    const rt = createEsp32Runtime(image, hw, { transport: nodeTransport() });
    let serial = '';
    const edges = [];
    rt.setTrace((key, s, t) => { if (key === 'IO2') edges.push(t); });
    const until = async (fn, ms, what) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { rt.run(16); serial += rt.takeSerial(); if (fn()) return; assert.notEqual(rt.state, 'error', rt.error && rt.error.msg); await sleep(16); }
      assert.fail(`${what} : délai dépassé\n${serial}`);
    };
    try {
      await until(() => /dht T=[^\r\n]*\r?\n/.test(serial), 60000, 'démarrage');
      assert.match(serial, /SETUP D4=0/);
      assert.match(serial, /bmp=1 T=24\.50/);
      if (kind === 'esp32s3') assert.match(serial, /dht T=21\.50/);
      assert.ok(!/ESP-ROM:|rst:0x|load:0x/.test(serial), 'messages de démarrage masqués');
      await until(() => edges.length >= 6, 6000, 'clignotement');
      const half = edges.slice(1).map((e, i) => e - edges[i]).sort((a, b) => a - b), med = half[half.length >> 1];
      assert.ok(Math.abs(med - 250) < 20, `demi-période ${med} ms`);
      inputs.IO4 = { d: 1 };
      await sleep(100);
      rt.send('r');
      await until(() => /D4=1/.test(serial), 4000, 'entrée');
    } finally { rt.stop(); }
  });
}
