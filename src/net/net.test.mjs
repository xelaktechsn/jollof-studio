// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du réseau simulé (src/net) : node --test src/net/net.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCable, makeCable, T568A, T568B, endOf, cableOk } from './cable.js';
import { createLan } from './lan.js';
import { newDevice } from './devices.js';
import { connectPacket, subscribePacket, publishPacket, mqttReader, parsePublish, MQTT, topicMatch } from './mqtt.js';
import { modbusRequest, readPdu, writeRegPdu, parseResponse } from './modbus.js';
import { dhcpClientPacket, parseDhcp } from './dhcp.js';
import { bytesOf } from './bytes.js';
import { netIssues } from './issues.js';
import { cleanNet } from './clean.js';

const end = order => ({ order, crimped: true, shorts: [] });

test('câbles : droit, croisé, défauts de la carte de câblage', () => {
  assert.equal(analyzeCable(makeCable()).kind, 'straight');
  assert.ok(cableOk(analyzeCable(makeCable())));
  assert.equal(analyzeCable(makeCable('crossover')).kind, 'crossover');
  // Paire séparée : continuité broche à broche bonne, mais 3-6 et 4-5 mélangent deux paires.
  const sp = ['wo', 'o', 'wg', 'g', 'wbl', 'bl', 'wbr', 'br'];
  const r = analyzeCable({ a: end(sp), b: end(sp), cut: [] });
  assert.equal(r.kind, 'straight'); assert.ok(r.faults.some(f => f.type === 'split')); assert.ok(!cableOk(r));
  // Conducteur absent : ouvert.
  const o = T568B.slice(); o[6] = null;
  assert.deepEqual(analyzeCable({ a: end(o), b: end(T568B), cut: [] }).faults.find(f => f.type === 'open').pins, [7]);
  // Paire inversée (1 et 2 permutés d'un côté).
  const rv = T568B.slice(); [rv[0], rv[1]] = [rv[1], rv[0]];
  const rr = analyzeCable({ a: end(rv), b: end(T568B), cut: [] });
  assert.equal(rr.kind, 'fault'); assert.equal(rr.faults[0].type, 'reversed');
  // Court-circuit (défaut de sertissage).
  const sh = analyzeCable({ a: { ...end(T568B), shorts: [[4, 5]] }, b: end(T568B), cut: [] });
  assert.ok(sh.faults.some(f => f.type === 'short'));
  // Bleu et vert permutés d'un côté seulement : paires croisées (pas un câble croisé conforme).
  const cr = T568B.slice(); [cr[2], cr[5], cr[3], cr[4]] = ['bl', 'wbl', 'wg', 'g'];
  assert.equal(analyzeCable({ a: end(cr), b: end(T568B), cut: [] }).kind, 'fault');
  // Câble non serti.
  assert.equal(analyzeCable(makeCable('blank')).kind, 'none');
  // Inversé de bout en bout (rouleau).
  assert.equal(analyzeCable({ a: end(T568B), b: end(T568B.slice().reverse()), cut: [] }).kind, 'fault');
  assert.ok(T568A.length === 8);
});

/** Petit plan : devices et câbles, ids donnés. */
function plan(devs, cables) {
  const used = new Set(), data = { devices: [], cables: [] };
  for (const [id, type, p] of devs) { const d = newDevice(type, used); used.add(d.name); d.id = id; d.name = id.toUpperCase(); if (p) Object.assign(d.p, p); data.devices.push(d); }
  cables.forEach(([a, b, o = {}], i) => data.cables.push({ id: 'c' + i, a, b, cat: o.cat || 'cat6', len: o.len ?? 3, wire: o.wire || makeCable(o.kind || 'straight') }));
  return data;
}

test('réseau : DHCP de la box, ping, table MAC, passerelle', () => {
  const data = plan([['box', 'router'], ['sw', 'switch'], ['pc1', 'pc'], ['pc2', 'pc']],
    [[['box', 'lan1'], ['sw', 'p1']], [['pc1', 'eth0'], ['sw', 'p2']], [['pc2', 'eth0'], ['sw', 'p3']]]);
  const lan = createLan({ data: () => data });
  const a = lan.ipOf('pc1'), b = lan.ipOf('pc2');
  assert.equal(a.src, 'dhcp'); assert.match(a.ip, /^192\.168\.1\.1\d\d$/); assert.notEqual(a.ip, b.ip); assert.equal(a.gw, '192.168.1.1');
  const l = lan.port('pc1', 'eth0'); assert.ok(l.up); assert.equal(l.speed, 1000);
  const p = lan.ping('pc1', b.ip); assert.ok(p.ok, JSON.stringify(p));
  assert.ok(lan.ping('pc1', 'PC2').ok); // par le nom
  const mac = lan.macTable('sw'); assert.ok(mac.some(m => m.node === 'pc1' && m.port === 'p2'));
  assert.equal(lan.ping('pc1', '192.168.1.250').why, 'arp');
  assert.equal(lan.ping('pc1', '10.0.0.5').why === 'noroute' || lan.ping('pc1', '10.0.0.5').why === 'reply:noroute' || !lan.ping('pc1', '10.0.0.5').ok, true);
  // Adresse fixe dans un autre sous-réseau, sans passerelle.
  data.devices[3].p.ip = { mode: 'static', ip: '10.0.0.7', prefix: 24, gw: '' }; lan.refresh();
  assert.equal(lan.ping('pc2', a.ip).why, 'nogw');
  data.devices[3].p.ip = { mode: 'static', ip: '10.0.0.7', prefix: 24, gw: '192.168.1.1' }; lan.refresh();
  assert.equal(lan.ping('pc2', a.ip).why, 'gwout');
});

test('Auto-MDIX, appareils anciens, longueur, catégorie', () => {
  const data = plan([['pc1', 'pc'], ['pc2', 'pc']], [[['pc1', 'eth0'], ['pc2', 'eth0'], { kind: 'straight' }]]);
  const lan = createLan({ data: () => data });
  assert.ok(lan.port('pc1', 'eth0').up); assert.ok(lan.port('pc1', 'eth0').mdix); // deux PC en direct : Auto-MDIX croise
  data.devices.forEach(d => { d.p.legacy = true; }); lan.refresh();
  assert.equal(lan.port('pc1', 'eth0').up, false); // sans Auto-MDIX, il faut un câble croisé
  data.cables[0].wire = makeCable('crossover'); lan.refresh();
  assert.ok(lan.port('pc1', 'eth0').up); assert.equal(lan.port('pc1', 'eth0').speed, 100);
  // Câble de 120 m : lien dégradé (erreurs) ; 200 m : plus de lien.
  data.devices.forEach(d => { d.p.legacy = false; }); data.cables[0].len = 120; lan.refresh();
  const l = lan.port('pc1', 'eth0'); assert.ok(l.up && l.errors && l.speed === 100);
  data.cables[0].len = 200; lan.refresh(); assert.equal(lan.port('pc1', 'eth0').up, false);
  // 10GBASE-T sur Cat 5e : retombe à 1 Gb/s.
  const d2 = plan([['nas', 'nas'], ['nas2', 'nas']], [[['nas', 'eth0'], ['nas2', 'eth0'], { cat: 'cat5e', len: 20 }]]);
  const l2 = createLan({ data: () => d2 });
  assert.equal(l2.port('nas', 'eth0').speed, 1000);
  d2.cables[0].cat = 'cat6a'; l2.refresh(); assert.equal(l2.port('nas', 'eth0').speed, 10000);
  // Paires 4-5 et 7-8 coupées : 1000BASE-T impossible, le lien retombe à 100 Mb/s.
  const c = makeCable(); c.cut = ['bl', 'wbl', 'wbr', 'br'];
  const d3 = plan([['pc1', 'pc'], ['pc2', 'pc']], [[['pc1', 'eth0'], ['pc2', 'eth0'], { wire: c }]]);
  assert.equal(createLan({ data: () => d3 }).port('pc1', 'eth0').speed, 100);
});

test('prise murale et panneau de brassage : canal, lien permanent', () => {
  const data = plan([['sw', 'switch'], ['pb', 'patch'], ['pr', 'outlet'], ['pc', 'pc']], [
    [['sw', 'p1'], ['pb', 'f1'], { len: 1 }], [['pb', 'b1'], ['pr', 'back'], { len: 85 }], [['pr', 'front'], ['pc', 'eth0'], { len: 3 }]]);
  const lan = createLan({ data: () => data });
  const ch = lan.channel('pc', 'eth0');
  assert.equal(ch.len, 89); assert.equal(ch.perm, 85); assert.equal(ch.far.n, 'sw');
  assert.ok(lan.port('pc', 'eth0').up);
});

test('PoE : budget, classe trop haute, boucle entre switchs, deux serveurs DHCP', () => {
  const data = plan([['sw', 'poeswitch', { budget: 20 }], ['cam1', 'camera'], ['cam2', 'camera'], ['tel', 'phone']],
    [[['sw', 'p1'], ['cam1', 'eth0']], [['sw', 'p2'], ['cam2', 'eth0']], [['sw', 'p3'], ['tel', 'eth0']]]);
  const lan = createLan({ data: () => data });
  assert.ok(lan.power('cam1').on); assert.equal(lan.power('cam2').why, 'budget'); assert.ok(lan.power('tel').on);
  assert.equal(lan.port('cam2', 'eth0').up, false);
  data.devices[0].p.pseType = 'af'; data.devices[1].p.poeClass = 4; lan.refresh();
  assert.equal(lan.power('cam1').why, 'class');
  // Boucle : deux câbles entre deux switchs.
  const d2 = plan([['s1', 'switch'], ['s2', 'switch'], ['pc', 'pc']], [[['s1', 'p1'], ['s2', 'p1']], [['s1', 'p2'], ['s2', 'p2']], [['pc', 'eth0'], ['s1', 'p3']]]);
  const l2 = createLan({ data: () => d2 });
  assert.equal(l2.state().storm.size, 1);
  const iss = netIssues(l2, d2);
  assert.ok(iss.some(i => i.code === 'J1206'));
  const d3 = plan([['b1', 'router'], ['b2', 'router'], ['sw', 'switch'], ['pc', 'pc']], [[['b1', 'lan1'], ['sw', 'p1']], [['b2', 'lan1'], ['sw', 'p2']], [['pc', 'eth0'], ['sw', 'p3']]]);
  const l3 = createLan({ data: () => d3 });
  assert.ok(netIssues(l3, d3).some(i => i.code === 'J1207'));
});

test('services : page de la box, MQTT, Modbus, DHCP octet par octet', async () => {
  const data = plan([['box', 'router'], ['sw', 'switch'], ['pc', 'pc'], ['mq', 'broker'], ['api', 'plc']],
    [[['box', 'lan1'], ['sw', 'p1']], [['pc', 'eth0'], ['sw', 'p2']], [['mq', 'eth0'], ['sw', 'p3']], [['api', 'eth0'], ['sw', 'p4']]]);
  const lan = createLan({ data: () => data });
  const page = await lan.http('pc', 'http://192.168.1.1/');
  assert.equal(page.code, 200); assert.match(page.body, /Baux DHCP|DHCP/);
  // MQTT : un client s'abonne, un autre publie.
  const c1 = lan.connect('pc', '192.168.1.10', 1883); assert.ok(c1.ok, c1.why);
  const rd = mqttReader(), got = [];
  c1.sock.onData(d => rd.push(d).forEach(p => got.push(p)));
  c1.sock.write(connectPacket('pc')); c1.sock.write(subscribePacket(1, [['atelier/#', 0]]));
  lan.broker('mq').publish('atelier/temp', '23.5');
  const pub = got.find(p => p.type === MQTT.PUBLISH); assert.ok(pub); assert.equal(parsePublish(pub).text, '23.5');
  assert.ok(topicMatch('a/+/c', 'a/b/c') && !topicMatch('a/+', 'a/b/c') && topicMatch('#', 'x/y'));
  // Modbus : écrire puis lire le registre 3.
  const m = lan.connect('pc', '192.168.1.50', 502); assert.ok(m.ok);
  const resp = []; m.sock.onData(d => resp.push(bytesOf(d)));
  m.sock.write(modbusRequest(1, 1, writeRegPdu(3, 1234))); m.sock.write(modbusRequest(2, 1, readPdu(3, 3, 1)));
  assert.equal(parseResponse(resp[1].slice(7), 1).values[0], 1234);
  // DHCP en octets (comme Dhcp.cpp par le W5500) : DISCOVER → OFFER.
  const offers = []; lan.udpBind('pc', 68, dg => offers.push(parseDhcp(dg.bytes)));
  lan.udpSend('pc', 68, '255.255.255.255', 67, dhcpClientPacket({ type: 1, xid: 0x1234, mac: '02:00:00:00:00:99' }));
  assert.equal(offers[0].type, 2); assert.match(offers[0].yiaddr, /^192\.168\.1\.\d+$/);
  assert.ok(cleanNet(JSON.parse(JSON.stringify(data))).devices.length === 5);
  assert.ok(endOf('A').order[0] === 'wg');
});
