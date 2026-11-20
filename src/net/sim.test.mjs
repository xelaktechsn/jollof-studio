// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de la simulation professionnelle (VLAN, Spanning Tree, agrégats, routage, DHCP par relais, listes d'accès,
// traduction d'adresses, traceroute) : node --test src/net/sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLan } from './lan.js';
import { newDevice } from './devices.js';
import { makeCable } from './cable.js';
import { cleanNet } from './clean.js';
import { netIssues } from './issues.js';
import { parseVlanList, fmtVlanList, cleanVlans, aclAllows, cleanAcls } from './vlan.js';
import { stpCost } from './l2.js';
import { NET } from './limits.js';
import { dhcpClientPacket, parseDhcp } from './dhcp.js';

/** Plan : [id, type, props] et [[a], [b], options] ; passé par cleanNet comme un fichier. */
function plan(devs, cables, extra = {}) {
  const used = new Set(), data = { devices: [], cables: [], ...extra };
  for (const [id, type, p] of devs) { const d = newDevice(type, used); used.add(d.name); d.id = id; d.name = id.toUpperCase(); if (p) Object.assign(d.p, p); data.devices.push(d); }
  cables.forEach(([a, b, o = {}], i) => data.cables.push({ id: 'c' + i, a, b, cat: o.cat || 'cat6', len: o.len ?? 3, wire: makeCable('straight'), ...(o.media ? o : {}) }));
  return cleanNet(data);
}
const lanOf = data => createLan({ data: () => data });
const codes = (lan, data) => netIssues(lan, data).map(i => i.code);

test('listes de VLAN, base des VLAN, ACL', () => {
  assert.deepEqual([...parseVlanList('10,20,30-32').set], [10, 20, 30, 31, 32]);
  assert.equal(fmtVlanList(parseVlanList('32,30,31,10')), '10,30-32');
  assert.ok(parseVlanList('all').all); assert.equal(parseVlanList('none').set.size, 0);
  assert.deepEqual(cleanVlans([{ id: 10, name: 'Admin', net: '10.0.10.7/24' }, { id: 10, name: 'x' }, { id: 5000 }]), [{ id: 10, name: 'Admin', net: '10.0.10.0/24', gw: '' }]);
  const [acl] = cleanAcls([{ name: 'A', rules: [{ act: 'deny', proto: 'icmp', src: '10.0.20.0/24' }, { act: 'permit' }] }]);
  assert.equal(aclAllows(acl, { proto: 'icmp', src: '10.0.20.5', dst: '10.0.10.5' }).ok, false);
  assert.equal(aclAllows(acl, { proto: 'tcp', src: '10.0.20.5', dst: '10.0.10.5', port: 80 }).ok, true);
  // Refus implicite à la fin d'une liste non vide.
  const [only] = cleanAcls([{ name: 'B', rules: [{ act: 'permit', proto: 'tcp', port: 80 }] }]);
  assert.equal(aclAllows(only, { proto: 'icmp', src: '1.1.1.1', dst: '2.2.2.2' }).ok, false);
  // Coûts du Spanning Tree (table « longue »).
  assert.equal(stpCost(1000, NET.STP_COST.v), 20000); assert.equal(stpCost(10000, NET.STP_COST.v), 2000); assert.equal(stpCost(2000, NET.STP_COST.v), 10000);
  // Nettoyage idempotent d'un plan avec équipements administrables.
  const d = plan([['sw', 'switch24', { ports: { p1: { mode: 'trunk', allowed: '10,20', native: 99 }, p30: { mode: 'trunk' } }, lags: [{ id: 'po1', mode: 'passive' }] }], ['rt', 'routerpro']], []);
  assert.deepEqual(cleanNet(JSON.parse(JSON.stringify(d))), d);
  assert.equal(d.devices[0].p.ports.p1.allowed, '10,20'); assert.equal(d.devices[0].p.lags[0].id, 'Po1'); assert.ok(!d.devices[0].p.ports.p30);
});

/** Campus : switch d'accès (VLAN 10 et 20), cœur de niveau 3 (SVI, relais DHCP), serveur DHCP dans le VLAN 99. */
function campus() {
  const svi = (vlan, ip, helper = '10.0.99.10') => ({ vlan, ip, prefix: 24, helper });
  return plan([
    ['core', 'l3switch', { stp: { on: true, prio: 4096 }, svis: [svi(10, '10.0.10.1'), svi(20, '10.0.20.1'), svi(99, '10.0.99.1', '')], ports: { p1: { mode: 'trunk', allowed: '10,20' }, p2: { vlan: 99 } } }],
    ['sw1', 'switch24', { ports: { p1: { vlan: 10 }, p2: { vlan: 20 }, p3: { vlan: 10 }, p24: { mode: 'trunk', allowed: '10,20' } } }],
    ['srv', 'server', { ip: { mode: 'static', ip: '10.0.99.10', prefix: 24, gw: '10.0.99.1' }, dhcp: [{ net: '10.0.10.0/24', from: '10.0.10.100', to: '10.0.10.102', gw: '10.0.10.1', dns: '10.0.99.10' }, { net: '10.0.20.0/24', from: '10.0.20.100', to: '10.0.20.199', gw: '10.0.20.1' }] }],
    ['pc1', 'pc'], ['pc2', 'pc'], ['pc3', 'pc']
  ], [
    [['sw1', 'p24'], ['core', 'p1']], [['srv', 'eth0'], ['core', 'p2']],
    [['pc1', 'eth0'], ['sw1', 'p1']], [['pc2', 'eth0'], ['sw1', 'p2']], [['pc3', 'eth0'], ['sw1', 'p3']]
  ], { vlans: [{ id: 10, name: 'Bureaux', net: '10.0.10.0/24', gw: '10.0.10.1' }, { id: 20, name: 'Atelier', net: '10.0.20.0/24', gw: '10.0.20.1' }, { id: 99, name: 'Serveurs', net: '10.0.99.0/24', gw: '10.0.99.1' }] });
}

test('VLAN, relais DHCP (giaddr), routage inter-VLAN, traceroute', () => {
  const data = campus(), lan = lanOf(data);
  const a = lan.ipOf('pc1'), b = lan.ipOf('pc2');
  assert.equal(a.src, 'dhcp'); assert.match(a.ip, /^10\.0\.10\.10\d$/); assert.equal(a.gw, '10.0.10.1'); assert.equal(a.server, 'srv'); assert.equal(a.relay, 'core');
  assert.match(b.ip, /^10\.0\.20\.1\d\d$/);
  // pc1 et pc2 : deux domaines de diffusion différents ; pc1 et pc3 : le même.
  assert.notEqual(lan.domain('pc1'), lan.domain('pc2')); assert.equal(lan.domain('pc1'), lan.domain('pc3'));
  const p = lan.ping('pc1', b.ip); assert.ok(p.ok, JSON.stringify(p.why)); assert.deepEqual(p.routers, ['core']);
  const t = lan.trace('pc1', 'PC2');
  assert.ok(t.ok); assert.deepEqual(t.hops.map(h => h.ip), ['10.0.10.1', b.ip]);
  assert.ok(lan.ping('pc1', '10.0.99.10').ok);
  // Interface VLAN active (autostate) ; table de routage du cœur : trois réseaux connectés.
  assert.equal(lan.routes('core').filter(r => r.kind === 'connected').length, 3);
  const iss = codes(lan, data);
  assert.ok(!iss.some(c => /J12(1[7-9]|2\d|3\d)/.test(c)), iss.join(' '));
  // Trunk qui ne porte plus le VLAN 20 : pc2 sans DHCP, J1219 si on lui donne une adresse fixe.
  data.devices.find(d => d.id === 'sw1').p.ports.p24.allowed = '10'; lan.refresh();
  assert.equal(lan.ipOf('pc2').src, 'apipa');
  data.devices.find(d => d.id === 'pc2').p.ip = { mode: 'static', ip: '10.0.20.50', prefix: 24, gw: '10.0.20.1', dns: '' }; lan.refresh();
  assert.ok(codes(lan, data).includes('J1219'));
  assert.equal(lan.ping('pc2', '10.0.10.1').why, 'gwunreach');
});

test('DHCP : étendue pleine (J1223), relais sans serveur (J1225), DHCP en octets à travers le relais', () => {
  const data = campus(), lan = lanOf(data);
  // Étendue 10.0.10.100–102 : trois adresses, deux postes dans le VLAN 10 ; un troisième la remplit.
  data.devices.find(d => d.id === 'sw1').p.ports.p4 = { ...data.devices.find(d => d.id === 'sw1').p.ports.p1 };
  data.devices.find(d => d.id === 'sw1').p.ports.p5 = { ...data.devices.find(d => d.id === 'sw1').p.ports.p1 };
  for (const [id, port] of [['pc4', 'p4'], ['pc5', 'p5']]) { const d = newDevice('pc', new Set()); d.id = id; d.name = id.toUpperCase(); data.devices.push(d); data.cables.push({ id: 'k' + id, a: [id, 'eth0'], b: ['sw1', port], cat: 'cat6', len: 3, wire: makeCable('straight') }); }
  lan.refresh();
  assert.ok(codes(lan, data).includes('J1223'));
  // DISCOVER d'un programme (W5500) dans le VLAN 20 : l'offre vient du serveur par le relais.
  const offers = []; lan.udpBind('pc2', 68, dg => offers.push(parseDhcp(dg.bytes)));
  lan.udpSend('pc2', 68, '255.255.255.255', 67, dhcpClientPacket({ type: 1, xid: 7, mac: '02:00:00:00:00:77' }));
  assert.equal(offers[0].type, 2); assert.match(offers[0].yiaddr, /^10\.0\.20\./);
  // Relais vers une adresse où personne n'est.
  data.devices.find(d => d.id === 'core').p.svis[0].helper = '10.0.99.77'; lan.refresh();
  assert.ok(codes(lan, data).includes('J1225'));
});

test('Spanning Tree : anneau de trois switchs, racine, port bloqué ; sans Spanning Tree : tempête (J1226)', () => {
  const data = plan([['s1', 'switch24', { stp: { on: true, prio: 4096 } }], ['s2', 'switch24'], ['s3', 'switch24'], ['pc1', 'pc', { ip: { mode: 'static', ip: '10.0.0.1', prefix: 24 } }], ['pc2', 'pc', { ip: { mode: 'static', ip: '10.0.0.2', prefix: 24 } }]], [
    [['s1', 'p1'], ['s2', 'p1']], [['s2', 'p2'], ['s3', 'p2']], [['s3', 'p3'], ['s1', 'p3']], [['pc1', 'eth0'], ['s2', 'p10']], [['pc2', 'eth0'], ['s3', 'p10']]]);
  const lan = lanOf(data);
  assert.equal(lan.state().storm.size, 0);
  assert.ok(lan.stp('s1').isRoot); assert.equal(lan.stp('s2').root, 's1');
  const roles = ['s1', 's2', 's3'].flatMap(id => [...lan.stp(id).ports].map(([p, r]) => r.role));
  assert.equal(roles.filter(r => r === 'alternate').length, 1); assert.equal(roles.filter(r => r === 'root').length, 2);
  // Le lien s2–s3 a le port bloqué (racine s1, coûts égaux : le pont à la plus haute MAC bloque).
  assert.equal(lan.l2port('s2', 'p2').fwd && lan.l2port('s3', 'p2').fwd, false);
  assert.ok(lan.ping('pc1', '10.0.0.2').ok);
  // Racine choisie : pas d'avertissement ; même priorité partout (racine par la MAC) : J1227.
  assert.ok(!codes(lan, data).includes('J1227'));
  data.devices[0].p.stp.prio = 32768; lan.refresh();
  assert.ok(codes(lan, data).includes('J1227'));
  // Spanning Tree coupé partout : boucle, tempête, J1226 (et pas J1206).
  for (const d of data.devices.filter(x => x.type === 'switch24')) d.p.stp.on = false;
  lan.refresh();
  assert.ok(lan.state().storm.size > 0); assert.equal(lan.ping('pc1', '10.0.0.2').why, 'storm');
  const c = codes(lan, data); assert.ok(c.includes('J1226') && !c.includes('J1206'), c.join(' '));
  // Boucle par un switch non administrable entre deux ports d'un switch au Spanning Tree actif : port de secours bloqué.
  const d2 = plan([['m', 'switch24'], ['u', 'switch']], [[['m', 'p1'], ['u', 'p1']], [['m', 'p2'], ['u', 'p2']]]);
  const l2 = lanOf(d2);
  assert.equal(l2.state().storm.size, 0); assert.equal(l2.l2port('m', 'p2').role, 'backup');
});

test('agrégat LACP : un lien logique, débit additionné ; passif + passif : pas d’agrégat (J1228)', () => {
  const lag = mode => ({ lags: [{ id: 'Po1', mode }], ports: { p23: { lag: 'Po1', mode: 'trunk' }, p24: { lag: 'Po1', mode: 'trunk' } } });
  const data = plan([['a', 'switch24', lag('active')], ['b', 'switch24', lag('passive')]], [[['a', 'p23'], ['b', 'p23']], [['a', 'p24'], ['b', 'p24']]]);
  const lan = lanOf(data);
  const g = lan.lags('a').get('Po1'); assert.ok(g.ok); assert.equal(g.speed, 2000); assert.equal(g.active.length, 2);
  assert.equal(lan.state().storm.size, 0); assert.ok(lan.l2port('a', 'p24').fwd);
  assert.ok(!codes(lan, data).includes('J1228'));
  data.devices[0].p.lags[0].mode = 'passive'; lan.refresh();
  assert.equal(lan.lags('a').get('Po1').ok, false); assert.equal(lan.state().storm.size, 0); // ports isolés : le Spanning Tree bloque
  assert.ok(codes(lan, data).includes('J1228'));
});

test('routeur sur un bâton : sous-interfaces 802.1Q, NAT vers la box, liste d’accès, redirection de port', () => {
  const sub = (vlan, ip, o = {}) => ({ port: 'ge1', vlan, ip, prefix: 24, nat: 'inside', ...o });
  const data = plan([
    ['box', 'router'],
    ['rt', 'routerpro', { ifs: [{ port: 'ge0', mode: 'dhcp', nat: 'outside' }, sub(10, '10.0.10.1'), sub(20, '10.0.20.1', { aclIn: 'NOPING' })], dhcp: [{ net: '10.0.10.0/24', gw: '10.0.10.1', from: '10.0.10.50', to: '10.0.10.90' }, { net: '10.0.20.0/24', gw: '10.0.20.1' }], acls: [{ name: 'NOPING', rules: [{ act: 'deny', proto: 'icmp', dst: '192.168.1.0/24' }, { act: 'permit' }] }], fwd: [{ proto: 'tcp', port: 8080, to: '10.0.10.50', toPort: 80 }] }],
    ['sw', 'switch24', { ports: { p24: { mode: 'trunk' }, p1: { vlan: 10 }, p2: { vlan: 20 } } }],
    ['pc1', 'pc'], ['pc2', 'pc'], ['nas', 'pc']
  ], [[['rt', 'ge0'], ['box', 'lan1']], [['rt', 'ge1'], ['sw', 'p24']], [['pc1', 'eth0'], ['sw', 'p1']], [['pc2', 'eth0'], ['sw', 'p2']], [['nas', 'eth0'], ['box', 'lan2']]]);
  const lan = lanOf(data);
  const wan = lan.ifacesOf('rt').find(f => f.port === 'ge0'); assert.match(wan.ip, /^192\.168\.1\./);
  assert.match(lan.ipOf('pc1').ip, /^10\.0\.10\.(5\d|[6-8]\d|90)$/); assert.match(lan.ipOf('pc2').ip, /^10\.0\.20\./);
  // pc1 → box : routé, traduit (la box voit l'adresse WAN du routeur).
  const p = lan.ping('pc1', '192.168.1.1'); assert.ok(p.ok, p.why);
  const t = lan.trace('pc1', '192.168.1.1'); assert.deepEqual(t.hops.map(h => h.ip), ['10.0.10.1', '192.168.1.1']);
  // pc2 : ICMP vers le LAN de la box refusé par la liste d'accès en entrée.
  const q = lan.ping('pc2', '192.168.1.1'); assert.equal(q.why, 'acl'); assert.equal(q.acl, 'NOPING');
  assert.ok(lan.ping('pc2', '10.0.10.1').ok);
  // L'extérieur n'entre pas sans redirection ; avec la redirection TCP 8080 → pc1:80, il entre.
  const n = lan.ipOf('nas'); assert.ok(n.ip);
  assert.equal(lan.ping('nas', lan.ipOf('pc1').ip).ok, false);
  data.devices.find(d => d.id === 'rt').p.fwd[0].to = lan.ipOf('pc1').ip; lan.refresh();
  lan.listen('pc1', 80, () => {});
  const c = lan.connect('nas', wan.ip, 8080); assert.ok(c.ok, c.why);
  // Route statique dont la passerelle n'est sur aucun réseau connecté : J1230.
  data.devices.find(d => d.id === 'rt').p.routes = [{ net: '172.16.0.0/16', via: '10.9.9.9' }]; lan.refresh();
  assert.ok(codes(lan, data).includes('J1230'));
});

test('VLAN différents, VLAN natif différent, trunk vers un poste', () => {
  const data = plan([['a', 'switch24', { ports: { p1: { vlan: 10 }, p2: { mode: 'trunk', native: 1 }, p3: { mode: 'trunk' } } }], ['b', 'switch24', { ports: { p1: { vlan: 20 }, p2: { mode: 'trunk', native: 99 } } }], ['pc', 'pc']],
    [[['a', 'p1'], ['b', 'p1']], [['a', 'p2'], ['b', 'p2']], [['pc', 'eth0'], ['a', 'p3']]]);
  const lan = lanOf(data), c = codes(lan, data);
  assert.ok(c.includes('J1217') && c.includes('J1218') && c.includes('J1234'), c.join(' '));
});

test('fibre : cages SFP, module absent, liaison optique', () => {
  const data = plan([['a', 'switch24', { sfp: { x1: '10GBASE-SR' } }], ['b', 'l3switch', { sfp: { x1: '10GBASE-SR' } }]],
    [[['a', 'x1'], ['b', 'x1'], { media: 'fibre', fibre: 'om4', len: 120 }]]);
  const lan = lanOf(data), l = lan.port('a', 'x1');
  assert.equal(lan.channel('a', 'x1').media, 'fibre');
  assert.ok(l.up, l.why); assert.equal(l.speed, 10000); assert.ok(l.fibre && l.fibre.margin > 0);
  data.devices[1].p.sfp = {}; lan.refresh();
  assert.equal(lan.port('a', 'x1').why, 'nomodule');
});

test('Rapid PVST+ : une instance par VLAN, priorité par VLAN (partage des liens entre deux trunks)', () => {
  const tr = { mode: 'trunk', allowed: '10,20' };
  const data = plan([
    ['a', 'switch24', { stp: { on: true, prio: 32768, vlans: { 10: 4096 } }, ports: { p1: tr, p2: tr } }],
    ['b', 'switch24', { stp: { on: true, prio: 32768, vlans: { 20: 4096 } }, ports: { p1: tr, p2: tr } }]
  ], [[['a', 'p1'], ['b', 'p1']], [['a', 'p2'], ['b', 'p2']]], { vlans: [{ id: 10, name: 'A' }, { id: 20, name: 'B' }] });
  const lan = lanOf(data);
  assert.equal(lan.state().storm.size, 0);
  assert.equal(lan.stp('a', 10).isRoot, true); assert.equal(lan.stp('b', 20).isRoot, true);
  // VLAN 10 : b bloque p2 ; VLAN 20 : a bloque p2 (chaque trunk porte un VLAN, les deux liens servent).
  assert.equal(lan.l2port('b', 'p2', 10).fwd, false); assert.equal(lan.l2port('a', 'p2', 20).fwd, false);
  assert.equal(lan.l2port('a', 'p2', 10).fwd, true);
  assert.deepEqual(lan.l2port('a', 'p2').blocked, [20]);
  // Mode RSTP partout : une seule instance.
  for (const d of data.devices) d.p.stp.mode = 'rstp';
  lan.refresh();
  assert.equal(lan.state().storm.size, 0); assert.ok(lan.stpInstances().has(0));
});

test('VLAN voix : le téléphone IP rejoint le VLAN voix de son port d’accès', () => {
  const data = plan([['sw', 'switch24', { ports: { p1: { vlan: 10, voice: 50 }, p2: { vlan: 10 }, p3: { vlan: 50 } } }], ['tel', 'phone', { power: 'adapter', ip: { mode: 'static', ip: '10.0.50.5', prefix: 24 } }], ['pc', 'pc', { ip: { mode: 'static', ip: '10.0.10.5', prefix: 24 } }], ['ipbx', 'pc', { ip: { mode: 'static', ip: '10.0.50.1', prefix: 24 } }]],
    [[['tel', 'eth0'], ['sw', 'p1']], [['pc', 'eth0'], ['sw', 'p2']], [['ipbx', 'eth0'], ['sw', 'p3']]], { vlans: [{ id: 10, name: 'Data' }, { id: 50, name: 'Voix' }] });
  const lan = lanOf(data);
  assert.equal(lan.vlanOf('tel'), 50); assert.equal(lan.vlanOf('pc'), 10);
  assert.ok(lan.ping('tel', '10.0.50.1').ok);
  assert.equal(cleanNet(data).devices[0].p.ports.p1.voice, 50);
  data.vlans = [{ id: 10, name: 'Data' }]; lan.refresh();
  assert.ok(codes(lan, data).includes('J1232'));
});

/** Deux routeurs et un cœur en OSPF : R1 (LAN 10.1.0.0/24) – lien 10.0.12.0/30 – CORE – lien 10.0.23.0/30 – R3 (LAN 10.3.0.0/24). */
function ospfNet(o = {}) {
  const os = (nets, extra = {}) => ({ on: true, nets: nets.map(net => ({ net, area: 0 })), ...extra });
  return plan([
    ['r1', 'routerpro', { ifs: [{ port: 'ge0', ip: '10.0.12.1', prefix: 30 }, { port: 'ge1', ip: '10.1.0.1', prefix: 24 }], dhcp: [], ospf: os(['10.0.0.0/8'], o.r1) }],
    ['core', 'l3switch', { svis: [{ vlan: 12, ip: '10.0.12.2', prefix: 30 }, { vlan: 23, ip: '10.0.23.2', prefix: 30 }], ports: { p1: { vlan: 12 }, p2: { vlan: 23 } }, ospf: os(['10.0.0.0/8'], o.core) }],
    ['r3', 'routerpro', { ifs: [{ port: 'ge0', ip: '10.0.23.3', prefix: 30 }, { port: 'ge1', ip: '10.3.0.1', prefix: 24 }], dhcp: [], ospf: os(['10.0.0.0/8'], o.r3) }],
    ['h1', 'pc', { ip: { mode: 'static', ip: '10.1.0.10', prefix: 24, gw: '10.1.0.1' } }], ['h3', 'pc', { ip: { mode: 'static', ip: '10.3.0.10', prefix: 24, gw: '10.3.0.1' } }]
  ], [[['r1', 'ge0'], ['core', 'p1']], [['r3', 'ge0'], ['core', 'p2']], [['h1', 'eth0'], ['r1', 'ge1']], [['h3', 'eth0'], ['r3', 'ge1']]]);
}

test('OSPF : voisinages, plus court chemin, routes apprises (distance 110), erreurs de voisinage', () => {
  let data = ospfNet(), lan = lanOf(data);
  assert.equal(lan.ospf().adj.filter(e => e.up).length, 2);
  const r = lan.lookup('r1', '10.3.0.10'); assert.equal(r.kind, 'ospf'); assert.equal(r.ad, 110); assert.equal(r.via, '10.0.12.2'); assert.equal(r.metric, 3);
  assert.ok(lan.ping('h1', '10.3.0.10').ok);
  assert.deepEqual(lan.trace('h1', '10.3.0.10').hops.map(h => h.ip), ['10.1.0.1', '10.0.12.2', '10.0.23.3', '10.3.0.10']);
  // Une route statique (distance 1) l'emporte sur OSPF pour le même préfixe.
  data.devices[0].p.routes = [{ net: '10.3.0.0/24', via: '10.0.12.2' }]; lan.refresh();
  assert.equal(lan.lookup('r1', '10.3.0.10').kind, 'static');
  // Minuteries différentes : pas de voisinage, J1238, plus de route.
  data = ospfNet({ r3: { ifs: { ge0: { hello: 5, dead: 20 } } } }); lan = lanOf(data);
  assert.equal(lan.lookup('r1', '10.3.0.10'), null); assert.ok(codes(lan, data).includes('J1238'));
  // Interface passive sur le lien : J1296 ; même identifiant : J1239.
  data = ospfNet({ core: { ifs: { vlan23: { passive: true } } } }); lan = lanOf(data); assert.ok(codes(lan, data).includes('J1296'));
  data = ospfNet({ r1: { rid: '1.1.1.1' }, r3: { rid: '1.1.1.1' } }); lan = lanOf(data); assert.ok(codes(lan, data).includes('J1239'));
});

test('listes d’accès sans état : la réponse TCP doit être permise (« established »), option 82 du relais', () => {
  const data = ospfNet(); const lan = lanOf(data);
  lan.listen('h3', 80, () => {});
  // En entrée de r1 côté cœur : seuls les retours web. Sans « established », la réponse est refusée (refus implicite).
  data.devices[0].p.acls = [{ name: 'IN', rules: [{ act: 'permit', proto: 'tcp', src: 'any', dst: 'any', sport: 80 }] }];
  data.devices[0].p.ifs[0].aclIn = 'IN'; lan.refresh();
  assert.ok(lan.connect('h1', '10.3.0.10', 80).ok);
  data.devices[0].p.acls[0].rules = [{ act: 'permit', proto: 'tcp', src: 'any', dst: 'any', port: 80 }]; lan.refresh();
  assert.equal(lan.connect('h1', '10.3.0.10', 80).why, 'reply:acl');
  data.devices[0].p.acls[0].rules.push({ act: 'permit', proto: 'tcp', src: 'any', dst: 'any', est: true }); lan.refresh();
  assert.ok(lan.connect('h1', '10.3.0.10', 80).ok);
  // Option 82 : le bail garde l'interface du relais.
  const c = campus(); c.devices[0].p.svis[0].o82 = true; const l2 = lanOf(cleanNet(c));
  assert.equal(l2.ipOf('pc1').o82.circuit, 'vlan10');
});

/**
 * OSPF à plusieurs aires : A, B, C, D sur un même segment de l'aire 0 (10.0.0.0/29, un switch) ; B est ABR vers l'aire 1
 * (lien 10.1.12.0/30 vers C1, réseau des postes 10.1.5.0/24) ; C est ABR vers l'aire 2 (10.2.0.0/24).
 */
function multiArea(o = {}) {
  const os = (rid, nets, extra = {}) => ({ on: true, rid, nets: nets.map(([net, area]) => ({ net, area })), ...extra });
  return plan([
    ['sw', 'switch'],
    ['ra', 'routerpro', { ifs: [{ port: 'ge0', ip: '10.0.0.1', prefix: 29 }], dhcp: [], ospf: os('3.3.3.3', [['10.0.0.0/29', 0]], o.ra) }],
    ['rb', 'routerpro', { ifs: [{ port: 'ge0', ip: '10.0.0.2', prefix: 29 }, { port: 'ge1', ip: '10.1.12.1', prefix: 30 }], dhcp: [], ospf: os('2.2.2.2', [['10.0.0.0/29', 0], ['10.1.0.0/16', 1]], o.rb) }],
    ['rc', 'routerpro', { ifs: [{ port: 'ge0', ip: '10.0.0.3', prefix: 29 }, { port: 'ge1', ip: '10.2.0.1', prefix: 24 }], dhcp: [], ospf: os('1.1.1.1', [['10.0.0.0/29', 0], ['10.2.0.0/16', o.cArea ?? 2]], o.rc) }],
    ['rd', 'routerpro', { ifs: [{ port: 'ge0', ip: '10.0.0.4', prefix: 29 }], dhcp: [], ospf: os('0.0.0.4', [['10.0.0.0/29', 0]], o.rd) }],
    ['c1', 'routerpro', { ifs: [{ port: 'ge0', ip: '10.1.12.2', prefix: 30 }, { port: 'ge1', ip: '10.1.5.1', prefix: 24 }], dhcp: [], ospf: os('5.5.5.5', [['10.1.0.0/16', 1]]) }],
    ['h1', 'pc', { ip: { mode: 'static', ip: '10.1.5.10', prefix: 24, gw: '10.1.5.1' } }], ['h2', 'pc', { ip: { mode: 'static', ip: '10.2.0.10', prefix: 24, gw: '10.2.0.1' } }]
  ], [[['ra', 'ge0'], ['sw', 'p1']], [['rb', 'ge0'], ['sw', 'p2']], [['rc', 'ge0'], ['sw', 'p3']], [['rd', 'ge0'], ['sw', 'p4']],
    [['rb', 'ge1'], ['c1', 'ge0']], [['h1', 'eth0'], ['c1', 'ge1']], [['h2', 'eth0'], ['rc', 'ge1']]]);
}

test('OSPF multi-aires : ABR, routes inter-aires, DR et BDR (priorité 0), 2-Way entre DROTHER', () => {
  let data = multiArea(), lan = lanOf(data), O = lan.ospf();
  assert.deepEqual([...O.abr].sort(), ['rb', 'rc']);
  const seg = O.segs.find(s => s.net === '10.0.0.0/29');
  assert.equal(seg.dr.r, 'ra'); assert.equal(seg.bdr.r, 'rb'); // plus hauts identifiants
  const st = (a, b) => O.adj.find(e => (e.a === a && e.b === b) || (e.a === b && e.b === a)).state;
  assert.equal(st('rc', 'rd'), '2WAY'); assert.equal(st('ra', 'rd'), 'FULL'); assert.equal(st('rb', 'rc'), 'FULL');
  // C1 (aire 1 seulement) apprend l'aire 2 par l'ABR B : route inter-aire.
  const r = lan.lookup('c1', '10.2.0.10'); assert.equal(r.kind, 'ospf'); assert.equal(r.type, 'inter'); assert.equal(r.via, '10.1.12.1');
  assert.ok(lan.ping('h1', '10.2.0.10').ok);
  assert.deepEqual(lan.trace('h1', '10.2.0.10').hops.map(h => h.ip), ['10.1.5.1', '10.1.12.1', '10.0.0.3', '10.2.0.10']);
  // Priorité 0 sur A : B devient DR, C BDR.
  data = multiArea({ ra: { ifs: { ge0: { prio: 0 } } } }); O = lanOf(data).ospf();
  const s2 = O.segs.find(s => s.net === '10.0.0.0/29'); assert.equal(s2.dr.r, 'rb'); assert.equal(s2.bdr.r, 'rc');
  // Toutes les priorités à 0 : pas de DR, J1299.
  const z = { ifs: { ge0: { prio: 0 } } };
  data = multiArea({ ra: z, rb: z, rc: z, rd: z }); lan = lanOf(data);
  assert.ok(codes(lan, data).includes('J1299')); assert.equal(lan.lookup('ra', '10.2.0.10'), null);
});

test('OSPF : aire sans lien avec l’aire 0 (J1297), ABR sans aire 0 (J1298)', () => {
  // C met son interface du segment commun en aire 3 : l'aire 2 n'a plus d'ABR relié à l'aire 0, C n'a pas l'aire 0.
  const data = multiArea({ rc: { nets: [{ net: '10.0.0.0/29', area: 3 }, { net: '10.2.0.0/16', area: 2 }] } }), lan = lanOf(data);
  const c = codes(lan, data);
  assert.ok(c.includes('J1297') && c.includes('J1298') && c.includes('J1238'), c.join(' '));
  assert.equal(lan.lookup('c1', '10.2.0.10'), null);
});

test('OSPF : chemins de même coût (ECMP), tous dans la route, le premier pour le ping', () => {
  const os = nets => ({ on: true, nets: nets.map(net => ({ net, area: 0 })) });
  const data = plan([
    ['x', 'routerpro', { ifs: [{ port: 'ge0', ip: '10.9.1.1', prefix: 30 }, { port: 'ge1', ip: '10.9.2.1', prefix: 30 }], dhcp: [], ospf: os(['10.9.0.0/16']) }],
    ['y', 'routerpro', { ifs: [{ port: 'ge0', ip: '10.9.1.2', prefix: 30 }, { port: 'ge1', ip: '10.9.3.1', prefix: 30 }], dhcp: [], ospf: os(['10.9.0.0/16']) }],
    ['z', 'routerpro', { ifs: [{ port: 'ge0', ip: '10.9.2.2', prefix: 30 }, { port: 'ge1', ip: '10.9.4.1', prefix: 30 }], dhcp: [], ospf: os(['10.9.0.0/16']) }],
    ['w', 'routerpro', { ifs: [{ port: 'ge0', ip: '10.9.3.2', prefix: 30 }, { port: 'ge1', ip: '10.9.4.2', prefix: 30 }, { port: 'ge2', ip: '10.9.9.1', prefix: 24 }], dhcp: [], ospf: os(['10.9.0.0/16']) }],
    ['hw', 'pc', { ip: { mode: 'static', ip: '10.9.9.10', prefix: 24, gw: '10.9.9.1' } }]
  ], [[['x', 'ge0'], ['y', 'ge0']], [['x', 'ge1'], ['z', 'ge0']], [['y', 'ge1'], ['w', 'ge0']], [['z', 'ge1'], ['w', 'ge1']], [['hw', 'eth0'], ['w', 'ge2']]]);
  const lan = lanOf(data), r = lan.lookup('x', '10.9.9.10');
  assert.equal(r.paths.length, 2); assert.deepEqual(r.paths.map(p => p.via), ['10.9.1.2', '10.9.2.2']); assert.equal(r.via, '10.9.1.2');
  assert.equal(r.metric, 3);
  assert.ok(lan.ping('x', '10.9.9.10').ok);
});
