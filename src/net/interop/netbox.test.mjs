// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de la synchronisation NetBox (dcimsync.js + netbox.js) contre un faux serveur en mémoire (netbox.fake.mjs) :
// correspondances, plan, envoi idempotent, mises à jour, suppressions, versions 4.4 / 4.5, droits refusés, erreurs par
// champ, import dans un projet vide, import d'un NetBox rempli à la main, temps de calcul.
// node --test src/net/interop/netbox.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanNet } from '../clean.js';
import { catalogue, ourModel, counts, typeOfSlug, guessType } from './dcimsync.js';
import { plan, push, pull, capsOf, parseVersion, createAdapter, listSites, CF } from './netbox.js';
import { fakeNetbox } from './netbox.fake.mjs';

const school = () => cleanNet(JSON.parse(readFileSync(new URL('../../../exemples/pro/17-college-reseau-deux-etages.jollof', import.meta.url), 'utf8')).settings.modules.net);
const connectFake = nb => nb.status().then(s => capsOf(s.version));

test('catalogue : fabricant et modèle des fiches, rôle, hauteur', () => {
  assert.deepEqual(catalogue('switch24'), { maker: 'Cisco', mslug: 'cisco', model: 'Catalyst C1000-24FP-4X-L', slug: 'cisco-catalyst-c1000-24fp-4x-l', u: 1, role: 'switch' });
  assert.equal(catalogue('server').model, 'PowerEdge R250');
  assert.equal(catalogue('patch48').u, 2);
  assert.equal(catalogue('ap').model, 'EAP225'); assert.equal(catalogue('ap').u, 0);
  assert.equal(catalogue('mediaconv').u, 0, 'sur une tablette : pas de position');
  assert.equal(catalogue('pc').slug, 'jollof-pc');
  assert.equal(typeOfSlug('cisco-catalyst-c1000-48fp-4x-l'), 'switch48');
  assert.deepEqual([parseVersion('4.5.2-Docker-3.4').minor, capsOf('4.4.7').frontList, capsOf('4.5.0').frontList, capsOf('4.1.3').scope, capsOf('3.7.8').ok], [5, false, true, false, false]);
});

test('modèle canonique du collège : lieux, baies, ports, câbles, VLAN, adresses', () => {
  const data = school(), { objs } = ourModel(data);
  const of = k => [...objs.values()].filter(x => x.kind === k);
  assert.equal(of('location').length, 1 + 2 + 26);
  assert.equal(of('rack').length, 2);
  assert.equal(of('device').length, data.devices.length);
  const sw = data.devices.find(d => d.type === 'switch48');
  assert.equal(objs.get(`if:${sw.id}:x1`).f.type, '10gbase-x-sfpp');
  assert.equal(objs.get(`if:${sw.id}:p1`).f.type, '1000base-t');
  const pp = data.devices.find(d => d.type === 'patch24');
  assert.equal(objs.get(`fp:${pp.id}:f1`).f.rear_port.$, `rp:${pp.id}:b1`);
  assert.equal(objs.get(`rp:${pp.id}:b1`).f.type, '8p8c');
  const fp = data.devices.find(d => d.type === 'fibrepanel');
  assert.equal(objs.get(`rp:${fp.id}:b1`).f.type, 'lc');
  assert.equal(of('cable').length, data.cables.length, 'tous les câbles ont deux extrémités connues');
  assert.ok(of('cable').some(c => /^mmf-om|^smf-os/.test(c.f.type)), 'rocade fibre');
  assert.ok(of('interface').some(i => i.f.mode === 'tagged' || i.f.mode === 'tagged-all'), 'trunks');
  assert.ok(of('interface').some(i => i.f.type === 'virtual' && /^vlan\d+$/.test(i.f.name)), 'SVI du cœur');
  assert.equal(of('prefix').length, 5);
  assert.ok(of('ip').length >= 5);
  // Équipement en baie : position, face, lieu de la baie.
  const inRack = data.devices.find(d => d.rack && d.type === 'switch48'), x = objs.get('dev:' + inRack.id);
  assert.equal(x.f.position, inRack.rack.u); assert.equal(x.f.rack.$, 'rack:' + inRack.rack.id);
  assert.equal(x.f.location && x.f.location.$, objs.get('rack:' + inRack.rack.id).f.location.$);
});

test('envoi dans un NetBox vide, puis aucune différence (idempotent)', async () => {
  const data = school(), nb = fakeNetbox(), caps = await connectFake(nb);
  const P = await plan(nb, data, { caps });
  const c = counts(P.rows);
  assert.equal(c.update, 0); assert.equal(c.delete, 0);
  assert.equal(c.create, P.ours.objs.size);
  const r = await push(nb, P);
  assert.deepEqual(r.errors, []);
  assert.equal(r.created, P.ours.objs.size);
  assert.equal(nb.db.device.size, data.devices.length);
  assert.equal(nb.db.cable.size, data.cables.length);
  assert.ok([...nb.db.device.values()].every(d => typeof d.custom_fields[CF] === 'string' && d.tags.length === 1));
  // Écritures groupées : bien moins de requêtes que d'objets.
  const writes = nb.calls.filter(x => x[0] !== 'GET').length;
  assert.ok(writes < P.ours.objs.size / 10, `${writes} écritures pour ${P.ours.objs.size} objets`);
  const P2 = await plan(nb, data, { caps, deletes: true });
  assert.deepEqual(P2.rows.map(x => `${x.op} ${x.key} ${x.field}`), []);
});

test('modification locale : une mise à jour par champ, appliquée par PATCH', async () => {
  const data = school(), nb = fakeNetbox(), caps = await connectFake(nb);
  await push(nb, await plan(nb, data, { caps }));
  const sw = data.devices.find(d => d.type === 'switch48'); sw.name = 'SW-RENAMED';
  const c = data.cables.find(k => k.len > 5); c.len = 42.5;
  data.vlans.find(v => v.id === 10).name = 'DATA-USERS';
  const P = await plan(nb, data, { caps });
  // Les étiquettes des câbles suivent le nom de l'équipement (étiquetage du projet), la description du préfixe le nom du VLAN.
  const got = [...new Set(P.rows.map(r => `${r.op}:${r.kind}:${r.field}`))].sort();
  assert.deepEqual(got, ['update:cable:label', 'update:cable:length', 'update:device:name', 'update:prefix:description', 'update:vlan:name']);
  assert.ok(P.rows.filter(r => r.field === 'label').every(r => String(r.ours).includes('SW-RENAMED')));
  const r = await push(nb, P);
  assert.deepEqual([r.errors.length, r.created], [0, 0]);
  assert.equal(nb.db.device.get(P.M.keyId.get('dev:' + sw.id)).name, 'SW-RENAMED');
  assert.equal((await plan(nb, data, { caps })).rows.length, 0);
});

test('lignes décochées : rien n’est envoyé pour elles', async () => {
  const data = school(), nb = fakeNetbox(), caps = await connectFake(nb);
  const P = await plan(nb, data, { caps });
  for (const r of P.rows) if (r.kind === 'cable' || r.kind === 'ip') r.accept = false;
  const out = await push(nb, P);
  assert.equal(out.errors.length, 0);
  assert.equal(nb.db.cable.size, 0); assert.equal(nb.db.ip.size, 0);
  const P2 = await plan(nb, data, { caps });
  assert.deepEqual(new Set(P2.rows.map(r => r.kind)), new Set(['cable', 'ip']));
});

test('suppressions : proposées seulement sur demande, décochées, objets créés par nous', async () => {
  const data = school(), nb = fakeNetbox(), caps = await connectFake(nb);
  await push(nb, await plan(nb, data, { caps }));
  const foreign = nb.seed('vlan', { vid: 777, name: 'OTHER', site: [...nb.db.site.keys()][0], status: 'active' });
  const pc = data.devices.find(d => d.type === 'pc');
  data.cables = data.cables.filter(c => c.a[0] !== pc.id && c.b[0] !== pc.id);
  data.devices = data.devices.filter(d => d !== pc);
  const P0 = await plan(nb, data, { caps });
  assert.equal(P0.rows.filter(r => r.op === 'delete').length, 0, 'pas de suppression par défaut');
  const P = await plan(nb, data, { caps, deletes: true });
  const del = P.rows.filter(r => r.op === 'delete');
  assert.ok(del.length >= 2 && del.every(r => !r.accept), 'proposées, jamais cochées d’avance');
  assert.ok(!del.some(r => r.key === 'nb:vlan:' + foreign), 'un objet qui n’est pas à nous n’est jamais proposé');
  for (const r of del) r.accept = true;
  const out = await push(nb, P);
  assert.deepEqual([out.errors.length, out.deleted], [0, del.length]);
  assert.ok(nb.db.vlan.has(foreign));
  assert.equal([...nb.db.device.values()].filter(d => d.name === pc.name).length, 0);
});

test('NetBox 4.4 : ports avant en champs plats ; 4.5+ : liste rear_ports', async () => {
  for (const [version, list] of [['4.4.9', false], ['4.7.1', true]]) {
    const data = school(), nb = fakeNetbox({ version }), caps = await connectFake(nb);
    const out = await push(nb, await plan(nb, data, { caps }));
    assert.deepEqual(out.errors, [], version);
    const fp = [...nb.db.frontport.values()][0];
    if (list) { assert.equal(fp.rear_ports.length, 1); assert.ok(nb.db.rearport.has(fp.rear_ports[0].rear_port)); }
    else { assert.ok(nb.db.rearport.has(fp.rear_port)); assert.equal(fp.rear_port_position, 1); }
    assert.equal((await plan(nb, data, { caps })).rows.length, 0, version + ' : idempotent');
  }
  // Portée des préfixes : scope_type + scope_id depuis 4.2, site avant.
  const A = createAdapter(capsOf('4.1')), x = { kind: 'prefix', key: 'pfx:a', f: { prefix: '10.0.0.0/24', vlan: null, scope: { $: 'site' }, status: 'active', description: '' } };
  assert.deepEqual(A.payload('prefix', x, () => 7).body.site, 7);
  assert.deepEqual(createAdapter(capsOf('4.5')).payload('prefix', x, () => 7).body.scope_type, 'dcim.site');
});

test('sans droit de créer le champ personnalisé : correspondance par les noms, toujours idempotent', async () => {
  const data = school(), nb = fakeNetbox({ deny: new Set(['cf', 'tag']) }), caps = await connectFake(nb);
  const r = await push(nb, await plan(nb, data, { caps }));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.notes.map(n => n.code).sort(), ['cfPerm', 'tagPerm']);
  assert.ok([...nb.db.device.values()].every(d => !d.custom_fields));
  assert.equal((await plan(nb, data, { caps })).rows.length, 0);
});

test('erreur par champ dans un paquet : les autres objets passent, l’erreur nomme l’objet et le champ', async () => {
  const data = school(), nb = fakeNetbox({ reject: (kind, b) => kind === 'device' && b.name === 'CORE1' }), caps = await connectFake(nb);
  const core = data.devices.find(d => d.type === 'l3switch'); core.name = 'CORE1';
  const r = await push(nb, await plan(nb, data, { caps }));
  const e = r.errors.find(x => x.key === 'dev:' + core.id);
  assert.ok(e && e.fields.some(f => f.field === 'name'), JSON.stringify(r.errors.slice(0, 2)));
  assert.equal(nb.db.device.size, data.devices.length - 1);
  // Ses ports et ses câbles dépendent de lui : signalés, pas envoyés à l'aveugle.
  assert.ok(r.errors.some(x => x.key.startsWith(`if:${core.id}:`) && /dépend de/.test(x.message)));
});

test('annulation : l’envoi s’arrête entre deux paquets', async () => {
  const data = school(), nb = fakeNetbox(), caps = await connectFake(nb), ctl = new AbortController();
  const P = await plan(nb, data, { caps });
  let n = 0; const bridge = { ...nb, write: async (...a) => { if (++n === 3) ctl.abort(); return nb.write(...a); } };
  await assert.rejects(push(bridge, P, { signal: ctl.signal }), e => e.name === 'AbortError');
  assert.ok(nb.db.cable.size === 0);
});

test('import dans un projet vide : même contenu, puis rien à renvoyer', async () => {
  const src = school(), nb = fakeNetbox(), caps = await connectFake(nb);
  await push(nb, await plan(nb, src, { caps }));
  const sites = await listSites(nb);
  assert.equal(sites.length, 1);
  const data = cleanNet({ view: 'net' });
  const P = await plan(nb, data, { caps, dir: 'pull', siteId: sites[0].id });
  assert.ok(P.rows.every(r => r.op === 'import' || r.op === 'update'));
  const r = pull(data, P);
  assert.deepEqual(r.skipped.filter(s => s.why !== 'noVlan'), []);
  assert.equal(data.devices.length, src.devices.length);
  assert.equal(data.cables.length, src.cables.length);
  assert.equal(data.racks.length, 2);
  assert.equal(data.site.buildings[0].floors.length, 2);
  assert.equal(data.site.buildings[0].floors.reduce((s, f) => s + f.rooms.length, 0), 26);
  assert.deepEqual(data.vlans.map(v => [v.id, v.net]).filter(v => v[1]), src.vlans.map(v => [v.id, v.net]));
  // Mêmes types, mêmes ports, mêmes positions en baie.
  const typeOf = new Map(src.devices.map(d => [d.id, d])), sw = src.devices.find(d => d.type === 'switch48' && d.rack);
  for (const d of data.devices) assert.equal(d.type, typeOf.get(d.id).type, d.name);
  assert.deepEqual(data.devices.find(d => d.id === sw.id).rack, sw.rack);
  const trunk = Object.entries(sw.p.ports).find(([, c]) => c.mode === 'trunk');
  if (trunk) assert.equal(data.devices.find(d => d.id === sw.id).p.ports[trunk[0]].mode, 'trunk');
  assert.ok(r.notes.includes('roomsNoGeometry'));
  // Renvoyé tel quel : aucune création ni mise à jour d'équipement ou de câble.
  const back = await plan(nb, data, { caps, siteId: sites[0].id });
  assert.deepEqual(back.rows.filter(x => ['device', 'cable', 'interface', 'vlan', 'rack'].includes(x.kind)).map(x => `${x.op} ${x.key} ${x.field}`), []);
});

test('import d’un NetBox rempli à la main (noms Cisco, sans champ personnalisé)', async () => {
  const nb = fakeNetbox(), caps = await connectFake(nb);
  const S = nb.seed('site', { name: 'Campus Nord', slug: 'campus-nord', status: 'active' });
  const B = nb.seed('location', { name: 'Bât. A', slug: 'bat-a', site: S, parent: null, status: 'active' });
  const F = nb.seed('location', { name: 'RDC', slug: 'rdc', site: S, parent: B, status: 'active' });
  const L = nb.seed('location', { name: 'Local technique', slug: 'lt', site: S, parent: F, status: 'active' });
  const RK = nb.seed('rack', { name: 'R01', site: S, location: L, u_height: 42, status: 'active', form_factor: '4-post-cabinet' });
  const MF = nb.seed('manufacturer', { name: 'Cisco', slug: 'cisco' });
  const DT = nb.seed('dtype', { manufacturer: MF, model: 'C9300-48P', slug: 'c9300-48p', u_height: 1 });
  const RO = nb.seed('role', { name: 'Access Switch', slug: 'access-switch', color: 'ff0000' });
  const RP = nb.seed('role', { name: 'Patch Panel', slug: 'patch-panel', color: '999999' });
  const PT = nb.seed('dtype', { manufacturer: MF, model: 'Panel 24', slug: 'panel-24', u_height: 1 });
  const SW = nb.seed('device', { name: 'sw-a-01', device_type: DT, role: RO, site: S, location: L, rack: RK, position: 40, face: 'front', status: 'active' });
  const PP = nb.seed('device', { name: 'pp-a-01', device_type: PT, role: RP, site: S, location: L, rack: RK, position: 41, face: 'front', status: 'active' });
  const V = nb.seed('vlan', { vid: 20, name: 'STAFF', site: S, status: 'active' });
  nb.seed('prefix', { prefix: '10.20.0.0/24', vlan: V, scope_type: 'dcim.site', scope_id: S, status: 'active' });
  let gi3 = null;
  for (let i = 1; i <= 48; i++) { const id = nb.seed('interface', { device: SW, name: `GigabitEthernet1/0/${i}`, type: '1000base-t', enabled: true, mode: i === 3 ? 'access' : '', untagged_vlan: i === 3 ? V : null, tagged_vlans: [] }); if (i === 3) gi3 = id; }
  const rps = [], fps = [];
  for (let i = 1; i <= 24; i++) rps.push(nb.seed('rearport', { device: PP, name: `R${i}`, type: '8p8c', positions: 1 }));
  for (let i = 1; i <= 24; i++) fps.push(nb.seed('frontport', { device: PP, name: `F${i}`, type: '8p8c', rear_ports: [{ position: 1, rear_port: rps[i - 1], rear_port_position: 1 }] }));
  nb.seed('cable', { a_terminations: [{ object_type: 'dcim.interface', object_id: gi3 }], b_terminations: [{ object_type: 'dcim.frontport', object_id: fps[2] }], type: 'cat6a', length: 150, length_unit: 'cm', label: 'C-003', status: 'connected' });
  const data = cleanNet({ view: 'net' });
  const P = await plan(nb, data, { caps, dir: 'pull', siteId: S });
  const r = pull(data, P);
  const sw = data.devices.find(d => d.name === 'sw-a-01'), pp = data.devices.find(d => d.name === 'pp-a-01');
  assert.equal(sw.type, 'switch48'); assert.equal(pp.type, 'patch24');
  assert.deepEqual(sw.rack, { id: data.racks[0].id, u: 40, face: 'front' });
  assert.equal(data.racks[0].u, 42);
  assert.equal(data.site.name, 'Campus Nord');
  assert.equal(data.cables.length, 1);
  const c = data.cables[0];
  assert.deepEqual([c.a, c.b, c.cat, c.len, c.tag], [[sw.id, 'p3'], [pp.id, 'f3'], 'cat6a', 1.5, 'C-003']);
  assert.equal(sw.p.ports.p3.vlan, 20);
  assert.equal(data.vlans.find(v => v.id === 20).net, '10.20.0.0/24');
  assert.equal(r.created.device, 2);
});

test('types devinés d’après le rôle et les ports', () => {
  const P = (nIf, nF = 0, typ = '8p8c') => ({ interfaces: Array.from({ length: nIf }, (_, i) => ({ name: 'e' + i, type: '1000base-t' })), front: Array.from({ length: nF }, () => ({ type: typ })), rear: [] });
  assert.equal(guessType(null, 'firewall', P(4)), 'routerpro');
  assert.equal(guessType(null, 'wireless-ap', P(1)), 'ap');
  assert.equal(guessType(null, '', P(0, 12, 'lc-upc')), 'fibrepanel');
  assert.equal(guessType(null, 'wall-outlet', P(0, 2)), 'outlet2');
  assert.equal(guessType(null, 'core', P(24)), 'l3switch');
  assert.equal(guessType({ slug: 'dell-poweredge-r250' }, 'x', P(2)), 'server');
});

test('grand campus : modèle et comparaison en temps raisonnable', async () => {
  const { bigCampus } = await import('../sim.fixture.mjs');
  const data = bigCampus(), nb = fakeNetbox(), caps = await connectFake(nb);
  const t0 = performance.now(); const P = await plan(nb, data, { caps }); const t1 = performance.now();
  await push(nb, P); const t2 = performance.now();
  const P2 = await plan(nb, data, { caps }); const t3 = performance.now();
  console.log(`    campus : ${P.ours.objs.size} objets ; plan ${(t1 - t0).toFixed(0)} ms, envoi (faux serveur) ${(t2 - t1).toFixed(0)} ms, replan ${(t3 - t2).toFixed(0)} ms`);
  assert.equal(P2.rows.length, 0);
  assert.ok(t3 - t2 < 3000);
});
