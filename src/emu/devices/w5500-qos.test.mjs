// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Broker du plan réseau (src/net/mqtt.js, QoS 0 à 2) face au vrai PubSubClient 2.8 compilé, sur l'Uno émulé avec le
// W5500 fidèle : abonnement en QoS 1 (la bibliothèque refuse 2), message publié en QoS 2 reçu en QoS 1 puis acquitté
// par le PUBACK du programme, publication QoS 0 retenue. Sans arduino-cli ou sans Ethernet / PubSubClient : ignoré.
// node --test src/emu/devices/w5500-qos.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { hasCli, compileSketch, fakeBoard, boot, runFor } from '../testkit.mjs';
import { createLan } from '../../net/lan.js';
import { newDevice } from '../../net/devices.js';
import { makeCable } from '../../net/cable.js';

const libs = hasCli ? spawnSync('arduino-cli', ['lib', 'list'], { encoding: 'utf8' }).stdout || '' : '';
const skip = !hasCli ? 'arduino-cli absent' : !/^Ethernet\s/m.test(libs) || !/^PubSubClient\s/m.test(libs) ? 'bibliothèques Ethernet et PubSubClient absentes' : false;

const SKETCH = `#include <SPI.h>
#include <Ethernet.h>
#include <PubSubClient.h>
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x22 };
IPAddress ip(192, 168, 1, 71);
IPAddress broker(192, 168, 1, 10);
EthernetClient eth;
PubSubClient mqtt(eth);
void recu(char* topic, byte* payload, unsigned int length) {
  Serial.print("recu "); Serial.print(topic); Serial.print(" ");
  for (unsigned int i = 0; i < length; i++) Serial.write(payload[i]);
  Serial.println();
}
void setup() {
  Serial.begin(115200);
  Ethernet.begin(mac, ip);
  mqtt.setServer(broker, 1883);
  mqtt.setCallback(recu);
  if (mqtt.connect("carteqos")) {
    Serial.print("q2="); Serial.println(mqtt.subscribe("cmd/deux", 2));
    Serial.print("q1="); Serial.println(mqtt.subscribe("cmd/un", 1));
    mqtt.publish("etat", "pret", true);
  }
}
void loop() { mqtt.loop(); }`;

test('PubSubClient compilé (Uno + W5500) : QoS 2 du broker reçu en QoS 1 et acquitté, abonnement QoS 2 refusé par la bibliothèque', { skip, timeout: 300000 }, () => {
  const used = new Set(), data = { devices: [], cables: [] };
  for (const [id, type] of [['box', 'router'], ['sw', 'switch'], ['mq', 'broker']]) { const d = newDevice(type, used); used.add(d.name); d.id = id; d.name = id.toUpperCase(); data.devices.push(d); }
  [[['box', 'lan1'], ['sw', 'p1']], [['mq', 'eth0'], ['sw', 'p2']], [['e:q1', 'eth'], ['sw', 'p3']]].forEach(([a, b], i) => data.cables.push({ id: 'c' + i, a, b, cat: 'cat6', len: 2, wire: makeCable('straight') }));
  const { hw, comps } = fakeBoard({ kind: 'uno', modules: [{ type: 'w5500', id: 'q1', pins: { CS: 'D10', SCK: 'D13', MOSI: 'D11', MISO: 'D12' } }] });
  const comp = comps[0], eth = () => (comp.periph && comp.periph.eth) || null;
  const lan = createLan({ data: () => data, ext: () => [{ id: 'e:q1', type: 'w5500', name: comp.name, x: 0, y: 0, mac: () => (eth() ? eth().mac : ''), ipcfg: () => eth() }], sig: () => JSON.stringify(eth()) });
  hw.lan = () => lan;
  const rt = boot(compileSketch(SKETCH, 'arduino:avr:uno'), hw);
  let out = '';
  const until = (ok, ms) => { const end = rt.clock() + ms; while (rt.clock() < end && !ok()) { runFor(rt, 20); out += rt.takeSerial(); } return ok(); };
  assert.ok(until(() => /q1=1\r\n/.test(out), 4000), out);
  assert.match(out, /q2=0\r\n/);
  const br = lan.broker('mq');
  assert.ok(until(() => br.topics().some(t => t.topic === 'etat'), 1000));
  assert.deepEqual(br.topics().filter(t => t.topic === 'etat').map(t => [t.text, t.qos, t.retained]), [['pret', 0, true]]);
  assert.deepEqual(br.clients()[0].qos, { 'cmd/un': 1 });
  br.publish('cmd/un', 'marche', false, 2);
  assert.equal(br.clients()[0].inflight, 1, 'QoS 1 en cours vers la carte');
  assert.ok(until(() => /recu cmd\/un marche\r\n/.test(out), 1000), out);
  assert.ok(until(() => br.clients()[0].inflight === 0, 500), 'PUBACK de PubSubClient');
  br.publish('cmd/deux', 'jamais', false, 2);
  until(() => false, 300);
  assert.doesNotMatch(out, /jamais/);
});
