// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Serveur MCP des assistants IA : protocole (initialize, tools/list, tools/call, erreurs), outils sans montage
// (bibliothèque, fiches, format d'un composant), manifeste complété et validé, sessions accordées par l'utilisateur.
// node --test src/ai/mcp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const i18n = await import('../i18n/index.js');
await i18n.loadLanguage();
const { createTools, prepareManifest } = await import('./tools.js');
const { createMcp, PROTOCOLS, clientKey } = await import('./mcp.js');
const J = await import('../library/jpart.js');

/** Hôte factice : un montage vide, juste assez pour les outils de lecture. */
const host = { comps: () => [], wires: () => [], projectTitle: () => 'essai', simOn: () => false, prog: { ai: {} } };
const calls = [];
const mcp = createMcp({ tools: createTools(host), info: { name: 'jollof-studio', version: '0' }, onCall: (n, a, out, err) => calls.push([n, !!err]) });
const rpc = (id, method, params) => mcp.handle({ jsonrpc: '2.0', id, method, params });
const text = r => r.result.content.map(c => c.text).join('');

test('initialize : version négociée, outils annoncés, instructions', async () => {
  const r = await rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } });
  assert.equal(r.result.protocolVersion, '2025-03-26');
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.match(r.result.instructions, /auto_wire/);
  assert.equal((await rpc(2, 'initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, PROTOCOLS[0]);
  assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'notification : pas de réponse');
  assert.deepEqual((await rpc(3, 'ping')).result, {});
});

test('tools/list : chaque outil a un nom, une description et un schéma objet', async () => {
  const { tools } = (await rpc(4, 'tools/list')).result;
  assert.ok(tools.length >= 20);
  for (const t of tools) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.ok(t.description.length > 20, t.name);
    assert.equal(t.inputSchema.type, 'object', t.name);
  }
  for (const n of ['add_part', 'auto_wire', 'connect', 'check_circuit', 'set_program', 'add_rule', 'simulate', 'read_simulation', 'create_part', 'screenshot', 'pneumatic_link_bench', 'grafcet_program']) assert.ok(tools.some(t => t.name === n), n);
});

test('erreurs : méthode inconnue, outil inconnu, argument manquant ou du mauvais type', async () => {
  assert.equal((await rpc(5, 'resources/list')).error.code, -32601);
  assert.equal((await rpc(6, 'tools/call', { name: 'fly' })).error.code, -32602);
  const miss = await rpc(7, 'tools/call', { name: 'get_part', arguments: {} });
  assert.equal(miss.result.isError, true); assert.match(text(miss), /missing argument "type"/);
  const bad = await rpc(8, 'tools/call', { name: 'simulate', arguments: { run: 'oui' } });
  assert.equal(bad.result.isError, true); assert.match(text(bad), /true or false/);
  assert.equal((await mcp.handle([1, 2])).error.code, -32600);
});

test('bibliothèque et fiches : list_parts, get_part (capteur, carte), part_format', async () => {
  const l = JSON.parse(text(await rpc(9, 'tools/call', { name: 'list_parts', arguments: { query: 'temperature' } })));
  assert.ok(l.parts.some(p => p.type === 'dht22') && l.parts.some(p => p.type === 'bme280'));
  const boards = JSON.parse(text(await rpc(10, 'tools/call', { name: 'list_parts', arguments: { category: 'boards' } })));
  assert.ok(boards.parts.every(p => p.board) && boards.parts.some(p => p.type === 'esp32s3'));
  const d = JSON.parse(text(await rpc(11, 'tools/call', { name: 'get_part', arguments: { type: 'dht22' } })));
  assert.ok(d.pins.some(p => p.name === 'DATA'));
  assert.ok(d.signals.some(s => s.signal === 'temp' && s.unit === '°C'));
  assert.ok(d.environment.some(e => e.quantity === 'temp'));
  assert.match(d.arduino_example, /DHT/);
  const uno = JSON.parse(text(await rpc(12, 'tools/call', { name: 'get_part', arguments: { type: 'uno' } })));
  assert.ok(uno.board && uno.pins.some(p => p.name === 'D13' && p.code === '13'));
  const relay = JSON.parse(text(await rpc(13, 'tools/call', { name: 'get_part', arguments: { type: 'relay' } })));
  assert.ok(relay.actions.some(a => a.action === 'on'));
  const f = JSON.parse(text(await rpc(14, 'tools/call', { name: 'part_format', arguments: {} })));
  assert.ok(f.pin.kinds.io && f.behaviour.quantities.temp && f.examples.length >= 2);
  assert.ok(calls.length >= 5 && calls.every(c => typeof c[0] === 'string'));
});

test('composant créé par une IA : manifeste complété (format, id, catégorie anglaise, broches en ligne) et validé', () => {
  const ex = JSON.parse(JSON.stringify((createTools(host).find(t => t.name === 'part_format').run()).examples));
  for (const m of ex) {
    const v = J.validateManifest(prepareManifest(m));
    assert.ok(v.ok, JSON.stringify(v.errors));
  }
  const m = prepareManifest(ex[0]);
  assert.equal(m.format, 1); assert.equal(m.id, 'pk-rain-sensor-module'); assert.equal(m.category, 'Capteurs');
  assert.deepEqual(m.pins.map(p => p.x), [-3.81, -1.27, 1.27, 3.81]);
  // Une erreur précise, que l'IA peut corriger.
  const v = J.validateManifest(prepareManifest({ name: 'X', category: 'Sensors', prefix: 'X', pins: [{ name: 'S', kind: 'io' }] }));
  assert.equal(v.ok, false); assert.ok(v.errors.some(e => /pins\[0\]\.need/.test(e)), v.errors.join('\n'));
});

test('sessions : un assistant n’agit qu’après l’accord de l’utilisateur, et plus du tout une fois retiré', async () => {
  const asked = [];
  let answer = false;
  const m = createMcp({ tools: createTools(host), info: { name: 'jollof-studio', version: '0' }, approve: async c => { asked.push(c.name); return answer; } });
  const init = sid => m.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-ai', title: 'Claude' } } }, sid);
  const list = sid => m.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid);
  // Refusé : erreur, aucune session ; les autres requêtes de cette session sont refusées.
  const no = await init('s1');
  assert.equal(no.error.code, -32001); assert.deepEqual(asked, ['claude-ai']);
  assert.equal((await list('s1')).error.code, -32001);
  assert.equal((await m.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_project', arguments: {} } }, 's1')).error.code, -32001);
  // Accordé : la session passe ; une session inventée non.
  answer = true;
  assert.ok((await init('s2')).result.serverInfo);
  assert.ok((await list('s2')).result.tools.length > 20);
  assert.equal((await list('autre')).error.code, -32001);
  assert.deepEqual(m.sessions().map(s => s.sid), ['s2']);
  // Retiré par l'utilisateur : plus rien ne passe.
  assert.deepEqual(m.endClient('claude-ai'), ['s2']);
  assert.equal((await list('s2')).error.code, -32001);
});

test('un assistant à plusieurs connexions : une seule demande, une seule ligne, relais arrêtés oubliés', async () => {
  let asked = 0, release;
  const gate = new Promise(r => { release = r; });
  const m = createMcp({ tools: createTools(host), info: { name: 'jollof-studio', version: '0' }, approve: async (c, o) => { if (o.silent) return false; asked++; await gate; return true; } });
  const init = (sid, meta) => m.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-ai', title: 'Claude' }, ...(meta ? { _meta: meta } : {}) } }, sid);
  // Claude Desktop ouvre trois connexions en même temps : une seule demande, que les trois attendent.
  const three = [init('a'), init('b'), init('c')];
  await new Promise(r => setTimeout(r, 20));
  assert.equal(asked, 1);
  release();
  assert.ok((await Promise.all(three)).every(r => r.result));
  assert.equal(m.connected().length, 1);
  assert.deepEqual(m.connected()[0], { key: 'claude-ai', client: { name: 'claude-ai', title: 'Claude' }, count: 3 });
  assert.equal(clientKey({ name: 'claude-ai' }), 'claude-ai');
  // Rejouée par le relais (silencieuse) pour un assistant jamais autorisé : refusée sans demande.
  const quiet = createMcp({ tools: createTools(host), info: { name: 'x', version: '0' }, approve: async (c, o) => !o.silent });
  assert.equal((await quiet.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'x' }, _meta: { 'sn.jollof/silent': true } } }, 'q')).error.code, -32001);
  // Relais arrêtés sans prévenir : plus de nouvelles depuis longtemps, sessions oubliées ; un relais vivant reste.
  await m.handle({ jsonrpc: '2.0', id: 9, method: 'ping' }, 'c');
  const later = Date.now() + 1000;
  assert.deepEqual(m.prune(500, later).sort(), ['a', 'b', 'c']);
  assert.deepEqual(m.connected(), []);
});
