// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Contrôles des TP de réseau (src/net/labcheck.js) sur un petit plan construit en Node : node --test src/lab/netcheck.test.mjs
// (validate.mjs vérifie en plus chaque TP de src/lab/net : départ qui échoue, solution qui réussit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newDevice } from '../net/devices.js';
import { makeCable, T568B } from '../net/cable.js';
import { checkNet, netEnv, netResultText, pick, NET_AUTO, NET_LIVE } from '../net/labcheck.js';
import { AUTO_CHECKS } from './engine.js';

/** Projet « Réseau » : box, switch PoE, deux PC, une caméra, un broker ; o.wire : câble de PC2. */
function plan(o = {}) {
  const used = new Set(), devices = [];
  for (const [id, type, p] of [['box1', 'router'], ['sw1', 'poeswitch'], ['pc1', 'pc'], ['pc2', 'pc'], ['cam1', 'camera'], ['mq1', 'broker'], ['ap1', 'ap', { power: 'adapter' }], ['pt1', 'laptop', { wifi: { ssid: 'Atelier', pass: 'jollof2024' } }]]) {
    const d = newDevice(type, used); used.add(d.name); d.id = id; d.name = id.toUpperCase(); if (p) Object.assign(d.p, p); devices.push(d);
  }
  const c = (id, a, b, wire = makeCable()) => ({ id, a, b, cat: 'cat6', len: 3, wire });
  const cables = [c('c1', ['box1', 'lan1'], ['sw1', 'p8']), c('c2', ['pc1', 'eth0'], ['sw1', 'p5']), c('c3', ['pc2', 'eth0'], ['sw1', 'p6'], o.wire || makeCable()), c('c4', ['cam1', 'eth0'], ['sw1', 'p1']), c('c5', ['mq1', 'eth0'], ['sw1', 'p7']), c('c6', ['ap1', 'eth0'], ['sw1', 'p2'])];
  return { app: 'jollof-studio', version: 1, name: 't', comps: [], wires: [], settings: { kind: 'net', modules: { net: { view: 'net', devices, cables, ext: {} } } } };
}

test('désignation : nom, sinon type, « * »', () => {
  const st = netEnv(plan()).lan().state();
  assert.deepEqual(pick(st, 'pc1').map(n => n.id), ['pc1']);
  assert.deepEqual(pick(st, 'pc').map(n => n.id).sort(), ['pc1', 'pc2']);
  assert.ok(pick(st, '*').length >= 7);
});

test('plan conforme : chaque contrôle réussit', () => {
  const env = netEnv(plan());
  for (const c of [
    { type: 'net-devices', require: [{ type: 'pc', n: 2 }, { type: 'router', name: 'BOX1' }] },
    { type: 'net-cable', a: 'PC2', b: 'SW1', kind: 'straight', std: 'B' },
    { type: 'net-cable', all: true },
    { type: 'net-link', a: 'pc', b: 'SW1', speed: 1000 },
    { type: 'net-ping', from: 'pc', to: 'BOX1' },
    { type: 'net-ping', from: 'PC1', to: '192.168.1.1' },
    { type: 'net-dhcp', of: 'pc', server: 'BOX1' },
    { type: 'net-poe', of: 'camera' },
    { type: 'net-ok' },
    { type: 'net-ip', of: 'BOX1', ip: '192.168.1.1', prefix: 24 },
    { type: 'net-wifi', of: 'PT1', ap: 'AP1' }
  ]) { const r = checkNet(c, env); assert.ok(r.ok, `${c.type} ${JSON.stringify(r)}`); assert.equal(typeof netResultText(c, r), 'string'); }
});

test('défauts : chaque contrôle échoue avec sa raison', () => {
  const half = makeCable(); half.b = { order: T568B.slice(), crimped: false, shorts: [] };
  const env = netEnv(plan({ wire: half }));
  const fail = (c, why) => { const r = checkNet(c, env); assert.equal(r.ok, false, c.type); if (why) assert.equal(r.why, why, `${c.type} ${JSON.stringify(r)}`); assert.ok(netResultText(c, r).length > 3); return r; };
  fail({ type: 'net-devices', require: [{ type: 'pc', n: 3 }] });
  fail({ type: 'net-cable', a: 'PC2', b: 'SW1' }, 'crimp');
  fail({ type: 'net-cable', a: 'PC2', b: 'SW1', side: 'b', std: 'B' }, 'crimp');
  assert.ok(checkNet({ type: 'net-cable', a: 'PC2', b: 'SW1', side: 'a', std: 'B' }, env).ok);
  fail({ type: 'net-cable', a: 'PC1', b: 'SW1', kind: 'crossover' }, 'kind');
  fail({ type: 'net-link', a: 'PC2', b: 'SW1' }, 'crimp');
  fail({ type: 'net-link', a: 'CAM1', b: 'SW1', speed: 1000 }, 'speed'); // caméra 100 Mb/s
  fail({ type: 'net-ping', from: 'PC2', to: 'BOX1' }, 'nolink');
  fail({ type: 'net-ping', from: 'nobody', to: 'BOX1' }, 'nofrom');
  fail({ type: 'net-dhcp', of: 'PC2' }, 'none');
  fail({ type: 'net-ok' }, 'issues');
  assert.ok(checkNet({ type: 'net-ok', codes: ['J1206'] }, env).ok);
  fail({ type: 'net-ip', of: 'PC1', mode: 'static' }, 'config');
  fail({ type: 'net-mqtt', topic: 'atelier/#' }, 'nopub');
  fail({ type: 'net-modbus' }, 'noplc');
});

test('PoE : budget dépassé', () => {
  const p = plan(), net = p.settings.modules.net;
  net.devices.find(d => d.id === 'sw1').p.budget = 10;
  const r = checkNet({ type: 'net-poe', of: 'CAM1' }, netEnv(p));
  assert.equal(r.ok, false); assert.equal(r.why, 'budget');
});

test('MQTT et page web en direct', async () => {
  const env = netEnv(plan()), lan = env.lan();
  lan.state(); // services des équipements démarrés au premier calcul
  lan.broker('mq1').publish('atelier/temp', '23.5'); // publication du panneau : ne compte pas pour un objet
  assert.equal(checkNet({ type: 'net-mqtt', topic: 'atelier/#' }, env).ok, false);
  const r = await checkNet({ type: 'net-http', from: 'PC1', to: 'BOX1', expect: 'DHCP' }, env);
  assert.ok(r.ok, JSON.stringify(r));
});

test('les contrôles du plan se valident seuls dans un tutoriel, pas ceux en direct', () => {
  for (const t of NET_AUTO) assert.ok(AUTO_CHECKS.has(t));
  for (const t of NET_LIVE) assert.ok(!AUTO_CHECKS.has(t));
});
