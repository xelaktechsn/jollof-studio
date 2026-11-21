// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du plan d'adressage VLSM (src/net/subnet.js) : node --test src/net/subnet.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCidr, prefixFor, usableOf, planVlsm, planKeep, overlaps, contains, describe, isPrivate } from './subnet.js';
import { ipNum } from './ip.js';
// Temps : temps CPU du processus (src/net/perf.mjs), seuils tenus même dans la suite complète.
import { once, note } from './perf.mjs';

test('lecture d’un réseau CIDR', () => {
  assert.deepEqual(parseCidr('10.20.0.0/16'), { net: ipNum('10.20.0.0'), prefix: 16, aligned: true });
  assert.equal(parseCidr('10.20.1.5/16').aligned, false);
  assert.equal(parseCidr('10.20.1.5/16').net, ipNum('10.20.0.0'));
  for (const bad of ['10.0.0.0', '10.0.0.0/33', '300.0.0.0/8', '', null, 'a.b.c.d/8']) assert.equal(parseCidr(bad), null, String(bad));
});

test('taille des sous-réseaux (RFC 950 : réseau et diffusion réservés)', () => {
  assert.equal(usableOf(24), 254); assert.equal(usableOf(30), 2); assert.equal(usableOf(31), 2); assert.equal(usableOf(32), 1);
  assert.equal(prefixFor(50), 26); // 50 hôtes + passerelle = 51 ≤ 62
  assert.equal(prefixFor(61), 26); assert.equal(prefixFor(62), 25);
  assert.equal(prefixFor(1), 30); assert.equal(prefixFor(254, false), 24); assert.equal(prefixFor(254), 23);
  const d = describe(ipNum('192.168.10.0'), 26);
  assert.deepEqual([d.first, d.last, d.bcast, d.mask, d.usable], ['192.168.10.1', '192.168.10.62', '192.168.10.63', '255.255.255.192', 62]);
});

test('VLSM : du plus grand au plus petit, alignés, dans l’ordre des demandes', () => {
  const r = planVlsm('10.10.0.0/22', [{ id: 99, name: 'MGMT', hosts: 10 }, { id: 10, name: 'DATA', hosts: 300 }, { id: 20, name: 'VOICE', hosts: 100 }, { id: 30, name: 'WIFI', hosts: 200 }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.subnets.map(s => s.cidr), ['10.10.3.128/28', '10.10.0.0/23', '10.10.3.0/25', '10.10.2.0/24']);
  assert.deepEqual(r.subnets.map(s => s.gw), ['10.10.3.129', '10.10.0.1', '10.10.3.1', '10.10.2.1']);
  for (const s of r.subnets) { const c = parseCidr(s.cidr); assert.equal(c.net % 2 ** (32 - c.prefix), 0, 'aligné'); assert.ok(s.usable >= s.hosts + 1); }
  assert.equal(overlaps(r.subnets.map(s => ({ id: s.id, net: s.cidr }))).length, 0);
  assert.equal(r.used, 512 + 256 + 128 + 16); assert.ok(r.util > 0.8 && r.util < 0.9);
  assert.equal(r.private, true);
});

test('VLSM : passerelle en dernière adresse, réserve de croissance, manque de place', () => {
  const r = planVlsm('192.168.1.0/24', [{ id: 1, hosts: 100 }, { id: 2, hosts: 50 }], { gw: 'last', growth: 20 });
  assert.equal(r.subnets[0].cidr, '192.168.1.0/25'); assert.equal(r.subnets[0].gw, '192.168.1.126');
  assert.equal(r.subnets[1].need, 60); assert.equal(r.subnets[1].cidr, '192.168.1.128/26');
  const k = planVlsm('192.168.1.0/24', [{ id: 1, hosts: 200 }, { id: 2, hosts: 100 }]);
  assert.equal(k.ok, false); assert.deepEqual(k.fail, [2]); assert.equal(k.subnets[1].fit, false);
  assert.equal(planVlsm('nope', [{ id: 1, hosts: 2 }]).error, 'block');
  assert.equal(planVlsm('8.8.0.0/16', []).private, false);
  assert.equal(isPrivate(ipNum('172.20.0.0'), 16), true); assert.equal(isPrivate(ipNum('172.32.0.0'), 16), false);
});

test('chevauchements et appartenance', () => {
  const ov = overlaps([{ id: 'a', net: '10.0.0.0/24' }, { id: 'b', net: '10.0.0.128/25' }, { id: 'c', net: '10.0.1.0/24' }, { id: 'd', net: '10.0.0.0/16' }, { id: 'e', net: 'x' }]);
  const key = ov.map(p => p.slice().sort().join('-')).sort();
  assert.deepEqual(key, ['a-b', 'a-d', 'b-d', 'c-d']);
  assert.equal(contains('10.0.0.0/24', '10.0.0.200'), true); assert.equal(contains('10.0.0.0/24', '10.0.1.1'), false); assert.equal(contains('bad', '10.0.0.1'), false);
});

test('VLSM : 300 VLAN en quelques millisecondes', () => {
  const reqs = Array.from({ length: 300 }, (_, i) => ({ id: i + 2, hosts: (i * 37) % 250 + 2 }));
  const o = once(() => planVlsm('10.0.0.0/8', reqs)), r = o.value, dt = o.ms;
  assert.equal(r.ok, true); assert.equal(overlaps(r.subnets.map(s => ({ id: s.id, net: s.cidr }))).length, 0);
  assert.ok(dt < 50, note('VLSM 300 VLAN', dt, 50));
});

test('plan qui garde les réseaux en place : rien ne change quand ils conviennent, seuls les autres sont placés', () => {
  const inPlace = [{ id: 10, hosts: 0, net: '10.10.10.0/24', gw: '10.10.10.1' }, { id: 20, hosts: 120, net: '10.10.20.0/24', gw: '10.10.20.1' }, { id: 99, hosts: 4, net: '10.10.99.0/24', gw: '10.10.99.1' }];
  const k = planKeep('10.10.0.0/16', inPlace, { minHosts: 14, growth: 20 });
  assert.equal(k.changes, 0, 'des /24 qui suffisent ne bougent pas (pas de /30 proposés)'); assert.ok(k.subnets.every(x => x.status === 'kept'));
  const g = planKeep('10.10.0.0/16', [...inPlace.slice(0, 1), { id: 20, hosts: 300, net: '10.10.20.0/24', gw: '10.10.20.1' }, { id: 30, hosts: 0 }], { minHosts: 14, growth: 20 });
  const s = id => g.subnets.find(x => x.id === id);
  assert.equal(s(10).status, 'kept'); assert.equal(s(20).status, 'changed'); assert.equal(s(20).prefix, 23); assert.equal(s(30).status, 'new'); assert.equal(s(30).prefix, 27, 'taille minimale : 14 hôtes et la passerelle');
  assert.equal(g.changes, 2);
  assert.equal(overlaps(g.subnets.map(x => ({ id: x.id, net: x.cidr }))).length, 0, 'les nouveaux évitent ceux qui restent');
  // chevauchement en place : le second est déplacé ; keep: false redécoupe tout
  const o = planKeep('10.0.0.0/16', [{ id: 1, hosts: 10, net: '10.0.0.0/24', gw: '10.0.0.1' }, { id: 2, hosts: 10, net: '10.0.0.128/25', gw: '10.0.0.129' }], { minHosts: 1 });
  assert.equal(o.subnets[0].status, 'kept'); assert.equal(o.subnets[1].status, 'changed');
  assert.ok(planKeep('10.10.0.0/16', inPlace, { keep: false, minHosts: 14 }).changes > 0);
  assert.equal(planKeep('x', inPlace).error, 'block');
});
