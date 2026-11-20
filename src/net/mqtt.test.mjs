// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Broker MQTT (mqtt.js) octet par octet, sur des connexions factices : QoS 2 dans les deux sens (PUBREC, PUBREL,
// PUBCOMP), une seule distribution malgré les reprises, QoS rabaissée à celle de l'abonnement, identifiants libres,
// messages retenus (drapeau RETAIN, QoS gardée), paquets malformés. Puis le PubSubClient de l'interpréteur (netlib.js)
// face au broker : ce que la vraie bibliothèque 2.8 accepte (PUBACK des QoS 1) et ignore (abonnement en QoS 2).
// node --test src/net/mqtt.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBroker, connectPacket, publishPacket, subscribePacket, ackPacket, mqttReader, parsePublish, packet, MQTT } from './mqtt.js';
import { byteStr } from './bytes.js';

/** Client brut relié au broker : envoie des paquets, garde ce qu'il reçoit. */
function client(br, id) {
  let onData = null, onClose = null;
  const rd = mqttReader(), got = [];
  const sock = { open: true, write: p => { got.push(...rd.push(byteStr(p))); }, close() { if (sock.open) { sock.open = false; if (onClose) onClose(); } }, onData: f => { onData = f; }, onClose: f => { onClose = f; } };
  br.accept(sock);
  const c = { sock, got, send: p => onData(byteStr(p)), take: () => got.splice(0), ids: t => got.filter(p => p.type === t).map(p => (p.body[0] << 8) | p.body[1]) };
  c.send(connectPacket(id));
  assert.deepEqual(c.take().map(p => p.type), [MQTT.CONNACK]);
  return c;
}
const pubs = c => c.got.filter(p => p.type === MQTT.PUBLISH).map(parsePublish);

test('QoS 2 reçu : PUBREC, reprise sans doublon, PUBREL → PUBCOMP, puis le même identifiant est une nouvelle publication', () => {
  const log = [], br = createBroker({ log: e => log.push(e) }), pub = client(br, 'capteur'), sub = client(br, 'tableau');
  sub.send(subscribePacket(1, [['usine/#', 0]])); sub.take();
  const msg = publishPacket('usine/compteur', '41', { qos: 2, id: 7 });
  pub.send(msg);
  assert.deepEqual(pub.take().map(p => [p.type, p.flags, [...p.body]]), [[MQTT.PUBREC, 0, [0, 7]]]);
  assert.deepEqual(pubs(sub).map(m => [m.topic, m.text, m.qos]), [['usine/compteur', '41', 0]], 'distribué dès le PUBLISH (méthode B), QoS 0 vers un abonnement QoS 0');
  // Reprise du PUBLISH (PUBREC perdu) : nouveau PUBREC, aucune nouvelle distribution.
  pub.send(msg); pub.send(msg);
  assert.deepEqual(pub.ids(MQTT.PUBREC), [7, 7]); pub.take();
  assert.equal(pubs(sub).length, 1, 'exactement une fois');
  assert.equal(br.count, 1); assert.equal(log.filter(e => e.kind === 'publish').length, 1);
  pub.send(ackPacket(MQTT.PUBREL, 7));
  assert.deepEqual(pub.take().map(p => [p.type, [...p.body]]), [[MQTT.PUBCOMP, [0, 7]]]);
  // Après le PUBCOMP : le même identifiant porte un nouveau message.
  pub.send(publishPacket('usine/compteur', '42', { qos: 2, id: 7 }));
  assert.deepEqual(pubs(sub).map(m => m.text), ['41', '42']);
  assert.equal(br.topics().find(t => t.topic === 'usine/compteur').qos, 2);
  // Deux identifiants en cours à la fois, indépendants.
  pub.send(publishPacket('usine/a', '1', { qos: 2, id: 8 })); pub.send(publishPacket('usine/b', '2', { qos: 2, id: 9 }));
  pub.send(publishPacket('usine/a', '1', { qos: 2, id: 8 }));
  assert.deepEqual(pubs(sub).map(m => m.text), ['41', '42', '1', '2']);
});

test('QoS 2 envoyé à un abonné QoS 2 : identifiant libre, PUBREL au PUBREC, terminé au PUBCOMP ; QoS 1 terminé au PUBACK', () => {
  const br = createBroker(), pub = client(br, 'p'), s2 = client(br, 's2'), s1 = client(br, 's1');
  s2.send(subscribePacket(3, [['ligne/+', 2]]));
  assert.deepEqual(s2.take().map(p => [p.type, [...p.body]]), [[MQTT.SUBACK, [0, 3, 2]]], 'QoS 2 accordée');
  s1.send(subscribePacket(4, [['ligne/+', 1]])); s1.take();
  pub.send(publishPacket('ligne/vitesse', '120', { qos: 2, id: 1 }));
  pub.send(publishPacket('ligne/arret', '0', { qos: 2, id: 2 }));
  const [a, b] = pubs(s2); s2.take();
  assert.deepEqual([a.qos, b.qos, a.retain], [2, 2, false]);
  assert.ok(a.id > 0 && b.id > 0 && a.id !== b.id, 'identifiants libres, distincts tant qu’ils sont en cours');
  assert.equal(br.clients().find(c => c.id === 's2').inflight, 2);
  s2.send(ackPacket(MQTT.PUBREC, a.id));
  assert.deepEqual(s2.take().map(p => [p.type, p.flags, (p.body[0] << 8) | p.body[1]]), [[MQTT.PUBREL, 2, a.id]], 'PUBREL, drapeaux 0010');
  s2.send(ackPacket(MQTT.PUBREC, a.id)); // PUBREC répété : PUBREL de nouveau tant que le PUBCOMP manque
  s2.send(ackPacket(MQTT.PUBCOMP, a.id));
  s2.send(ackPacket(MQTT.PUBREC, b.id)); s2.send(ackPacket(MQTT.PUBCOMP, b.id));
  assert.equal(br.clients().find(c => c.id === 's2').inflight, 0);
  s2.send(ackPacket(MQTT.PUBCOMP, 999)); // identifiant inconnu : ignoré
  // L'abonné QoS 1 reçoit la plus petite des deux QoS : 1, terminée par son PUBACK.
  const q1 = pubs(s1); assert.deepEqual(q1.map(m => m.qos), [1, 1]);
  for (const m of q1) s1.send(ackPacket(MQTT.PUBACK, m.id));
  assert.equal(br.clients().find(c => c.id === 's1').inflight, 0);
  // Publication QoS 0 vers l'abonné QoS 2 : QoS 0, sans identifiant.
  pub.send(publishPacket('ligne/vitesse', '90'));
  assert.deepEqual(pubs(s2).map(m => [m.qos, m.id]), [[0, 0]]);
});

test('abonnements qui se recouvrent : la plus grande QoS accordée ; les identifiants tournent sans reprendre un identifiant en cours', () => {
  const br = createBroker(), s = client(br, 's');
  s.send(subscribePacket(1, [['a/#', 0], ['a/b', 2]])); s.take();
  br.publish('a/b', 'x', false, 2); br.publish('a/c', 'y', false, 2);
  assert.deepEqual(pubs(s).map(m => [m.topic, m.qos]), [['a/b', 2], ['a/c', 0]], 'une seule copie par message');
  const first = pubs(s)[0].id; s.take();
  for (let i = 0; i < 65535; i++) { br.publish('a/b', String(i), false, 1); const m = s.take().map(parsePublish)[0]; s.send(ackPacket(MQTT.PUBACK, m.id)); assert.notEqual(m.id, first); }
  assert.equal(br.clients()[0].inflight, 1, 'seul le QoS 2 du début reste en cours');
});

test('messages retenus : QoS gardée, RETAIN = 1 pour un nouvel abonnement, 0 pour les abonnements établis, vide = effacé', () => {
  const br = createBroker(), pub = client(br, 'p'), old = client(br, 'ancien');
  old.send(subscribePacket(1, [['maison/#', 2]])); old.take();
  pub.send(publishPacket('maison/consigne', '19', { qos: 2, id: 5, retain: true }));
  assert.deepEqual(pubs(old).map(m => [m.retain, m.qos]), [[false, 2]], 'abonnement établi : RETAIN à 0');
  const n2 = client(br, 'nouveau2'), n1 = client(br, 'nouveau1');
  n2.send(subscribePacket(1, [['maison/+', 2]])); n1.send(subscribePacket(1, [['maison/consigne', 1]]));
  assert.deepEqual(pubs(n2).map(m => [m.topic, m.text, m.retain, m.qos]), [['maison/consigne', '19', true, 2]]);
  assert.deepEqual(pubs(n1).map(m => [m.retain, m.qos]), [[true, 1]], 'QoS du message retenu rabaissée à celle accordée');
  // Nouvel abonnement d'un client qui en a déjà : seul le nouveau filtre ramène les messages retenus.
  n1.take(); n1.send(subscribePacket(2, [['jardin/#', 0]]));
  assert.equal(pubs(n1).length, 0);
  pub.send(publishPacket('maison/consigne', '', { retain: true }));
  const n3 = client(br, 'nouveau3'); n3.send(subscribePacket(1, [['maison/#', 0]]));
  assert.equal(pubs(n3).length, 0, 'message retenu vide : effacé');
});

test('paquets malformés : QoS 3 dans PUBLISH ou SUBSCRIBE, PUBREL sans ses drapeaux 0010 → connexion fermée', () => {
  const br = createBroker();
  const a = client(br, 'a'); a.send(packet(MQTT.PUBLISH, 6, [0, 1, 120, 0, 1, 65])); assert.equal(a.sock.open, false);
  const b = client(br, 'b'); b.send(subscribePacket(1, [['x', 3]])); assert.equal(b.sock.open, false);
  assert.equal(b.got.some(p => p.type === MQTT.SUBACK), false);
  const c = client(br, 'c'); c.send(packet(MQTT.PUBREL, 0, [0, 1])); assert.equal(c.sock.open, false);
  assert.equal(br.clients().length, 0);
});

/* ---------- PubSubClient de l'interpréteur face au broker ---------- */
const { compile } = await import('../prog/lang.js');
const { createRuntime } = await import('../prog/runtime.js');
const { BOARDS } = await import('../sim/boards.js');
const { createLan } = await import('./lan.js');
const { newDevice } = await import('./devices.js');
const { makeCable } = await import('./cable.js');

test('PubSubClient (interpréteur) : abonnement QoS 1 acquitté par PUBACK après le rappel, QoS 2 refusé, publications en QoS 0', async () => {
  const used = new Set(), data = { devices: [], cables: [] };
  for (const [id, type] of [['box', 'router'], ['sw', 'switch'], ['mq', 'broker']]) { const d = newDevice(type, used); used.add(d.name); d.id = id; d.name = id.toUpperCase(); data.devices.push(d); }
  [[['box', 'lan1'], ['sw', 'p1']], [['mq', 'eth0'], ['sw', 'p2']], [['e:eth1', 'eth'], ['sw', 'p3']]].forEach(([a, b], i) => data.cables.push({ id: 'c' + i, a, b, cat: 'cat6', len: 2, wire: makeCable('straight') }));
  const mod = { id: 'eth1', type: 'w5500', name: 'ETH1' }, eth = () => (mod.periph && mod.periph.eth) || null;
  const lan = createLan({ data: () => data, ext: () => [{ id: 'e:eth1', type: 'w5500', name: 'ETH1', x: 0, y: 0, mac: () => (eth() ? eth().mac : ''), ipcfg: () => eth() }], sig: () => JSON.stringify(eth()) });
  const code = `#include <SPI.h>
#include <Ethernet.h>
#include <PubSubClient.h>
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x21 };
IPAddress ip(192, 168, 1, 70);
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
  mqtt.setServer(IPAddress(192, 168, 1, 10), 1883);
  mqtt.setCallback(recu);
  if (mqtt.connect("carte")) {
    Serial.print("q2="); Serial.println(mqtt.subscribe("cmd/deux", 2));
    Serial.print("q1="); Serial.println(mqtt.subscribe("cmd/un", 1));
    mqtt.publish("etat", "pret", true);
  }
}
void loop() { mqtt.loop(); }`;
  const c = compile(code, { board: 'uno' }); assert.ok(c.ok, JSON.stringify(c.errors));
  const store = { ee: '', prefs: {} };
  const hw = { kind: 'uno', label: 'uno', prof: BOARDS.uno, read: () => null, echo: () => null, at: () => [], onPin: () => null, data: () => null, bus: () => [], i2c: () => [], status: () => ({ ok: true, msg: '' }),
    mem: () => store, memChanged: () => {}, level: () => null, comps: types => (types.includes('w5500') ? [mod] : []), peers: () => [], self: () => ({ id: 'uno1', type: 'uno' }), lan: () => lan };
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  let out = '';
  const frames = []; lan.on(e => { if (e.t === 'mqtt') frames.push(e); });
  const step = async (ok, n = 400) => { for (let i = 0; i < n && !ok(); i++) { rt.run(16); out += rt.takeSerial(); await new Promise(r => setImmediate(r)); } assert.ok(ok(), out); };
  await step(() => /q1=1/.test(out));
  assert.match(out, /q2=0\s/, 'subscribe(…, 2) : faux, comme la vraie bibliothèque');
  const br = lan.broker('mq');
  assert.deepEqual(br.clients()[0].qos, { 'cmd/un': 1 });
  await step(() => br.topics().some(t => t.topic === 'etat'));
  assert.deepEqual(br.topics().filter(t => t.topic === 'etat').map(t => [t.text, t.qos, t.retained]), [['pret', 0, true]]);
  // QoS 2 publié par le panneau : la carte le reçoit en QoS 1 (accordée), le rappel s'exécute, PUBACK rendu.
  br.publish('cmd/un', 'marche', false, 2);
  assert.equal(br.clients()[0].inflight, 1);
  await step(() => /recu cmd\/un marche\s/.test(out));
  await step(() => br.clients()[0].inflight === 0, 50);
  br.publish('cmd/deux', 'jamais', false, 2);
  for (let i = 0; i < 20; i++) { rt.run(16); out += rt.takeSerial(); }
  assert.doesNotMatch(out, /jamais/);
  rt.stop();
});
