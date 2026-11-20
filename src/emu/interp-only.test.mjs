// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Module ENC28J60 : la carte (Uno, Mega, Pico, ESP32) tourne sur l'interpréteur, sans passer par le mode fidèle où le
// module ne répondrait pas. Raison claire (journal et barre d'état), choix du moteur dans src/prog/panel.js, puis le
// programme des règles d'un Uno + ENC28J60 sur l'interpréteur : bail DHCP de la box, connexion au serveur MQTT.
// node --test src/emu/interp-only.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { INTERP_ONLY, interpOnlyReason, UNBRIDGED } from './esp32-limits.js';

test('INTERP_ONLY : l’ENC28J60, avec une raison qui nomme le module', () => {
  assert.deepEqual(INTERP_ONLY, ['enc28j60']);
  assert.ok(INTERP_ONLY.every(t => UNBRIDGED.includes(t)), 'aussi hors du mode fidèle de l’ESP32');
  assert.equal(interpOnlyReason([]), null);
  assert.equal(interpOnlyReason([{ type: 'w5500', name: 'ETH1' }, { type: 'dht22', name: 'DHT1' }]), null, 'le W5500 tourne en mode fidèle');
  assert.equal(interpOnlyReason([{ type: 'enc28j60', name: 'ETH2' }]), 'module Ethernet ETH2 (ENC28J60) : sa pile TCP/IP n’existe que dans le simulateur intégré, qui le relie au plan réseau');
  assert.match(interpOnlyReason([{ type: 'enc28j60', name: 'ETH1' }, { type: 'enc28j60', name: 'ETH2' }]), /ETH1, ETH2/);
});

test('panel.js : un ENC28J60 relié à la carte écarte le mode fidèle (toute carte), la raison est donnée', () => {
  const src = fs.readFileSync(new URL('../prog/panel.js', import.meta.url), 'utf8');
  const realOk = src.slice(src.indexOf('function realOk('), src.indexOf('function espModules('));
  assert.match(realOk, /if \(interpMods\(b\)\.length\) return false;/);
  assert.ok(realOk.indexOf('interpMods(b)') < realOk.indexOf('QEMU_KINDS.has(kind)) return true'), 'avant le retour des cartes AVR et RP2040');
  const why = src.slice(src.indexOf('function whyInterp('), src.indexOf('const pyOf ='));
  assert.match(why, /interpOnlyReason\(interpMods\(b\)\)/);
  assert.match(src, /interpMods\(b\)\.length\) app\.status\(tl\('\{0\} tourne sur le simulateur intégré : \{1\}\.'/);
});

test('Uno + ENC28J60 sur l’interpréteur : le programme des règles obtient un bail DHCP et se connecte au serveur MQTT', async () => {
  const { bench, netRules } = await import('../prog/rulekit.mjs');
  const { compile } = await import('../prog/lang.js');
  const { createRuntime } = await import('../prog/runtime.js');
  const { BOARDS } = await import('../sim/boards.js');
  const { createLan } = await import('../net/lan.js');
  const { newDevice } = await import('../net/devices.js');
  const { makeCable } = await import('../net/cable.js');
  const M = bench('uno', ['enc28j60', 'pot', 'led-red']), code = M.code(netRules(M)), mod = M.c('ETH1');
  assert.match(code, /#include <EthernetENC\.h>/);
  const used = new Set(), data = { devices: [], cables: [] };
  for (const [id, type] of [['box', 'router'], ['sw', 'switch'], ['mq', 'broker']]) { const d = newDevice(type, used); used.add(d.name); d.id = id; d.name = id.toUpperCase(); data.devices.push(d); }
  [[['box', 'lan1'], ['sw', 'p1']], [['mq', 'eth0'], ['sw', 'p2']], [['e:' + mod.id, 'eth'], ['sw', 'p3']]].forEach(([a, b], i) => data.cables.push({ id: 'c' + i, a, b, cat: 'cat6', len: 2, wire: makeCable('straight') }));
  const eth = () => (mod.periph && mod.periph.eth) || null;
  const lan = createLan({ data: () => data, ext: () => [{ id: 'e:' + mod.id, type: 'enc28j60', name: 'ETH1', x: 0, y: 0, mac: () => (eth() ? eth().mac : ''), ipcfg: () => eth() }], sig: () => JSON.stringify(eth()) });
  const c = compile(code, { board: 'uno' }); assert.ok(c.ok, JSON.stringify(c.errors));
  const store = { ee: '', prefs: {} };
  const hw = { kind: 'uno', label: 'uno', prof: BOARDS.uno, read: () => ({ v: 2 }), echo: () => null, at: () => [], onPin: () => null, data: () => null, bus: () => [], i2c: () => [], status: () => ({ ok: true, msg: '' }),
    mem: () => store, memChanged: () => {}, level: () => null, comps: types => (types.includes('enc28j60') ? [mod] : []), peers: () => [], self: () => M.board, lan: () => lan };
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  let out = '';
  for (let i = 0; i < 600 && !/MQTT : connecté/.test(out); i++) { rt.run(16); out += rt.takeSerial(); await new Promise(r => setImmediate(r)); }
  assert.match(out, /Réseau : adresse 192\.168\.1\.1\d\d/, out);
  assert.match(out, /MQTT : connecté/, out);
  assert.equal(lan.port('e:' + mod.id, 'eth').speed, 10, 'ENC28J60 : 10BASE-T');
  rt.stop();
});
