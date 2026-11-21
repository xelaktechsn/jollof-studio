// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du navigateur du projet réseau (src/net/browse.js) : arbre des objets, recherche, chemin, modification groupée.
// node --test src/net/browse.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDesign, applyDesign } from './dimension.js';
import { labeler, cableKind } from './docs.js';
import { cleanNet } from './clean.js';
import { projectTree, findItems, findRank, pathTo, resolveSel, bulkFields, applyBulk, accessPortOf, parseKey, keyOf, descendants, renameItem, removeItems, duplicateDevs, canDrop, moveDevs, crumbsFor } from './browse.js';
import { indexTree, flatten, filterTree, mergeValues } from '../net/ui/kit/model.js';
import { fixture, bigFixture } from './dimension.fixture.mjs';
import { best, note } from './perf.mjs';

const built = (f = fixture) => { const d = f(); d.design = cleanDesign({}); applyDesign(d); return d; };
const opts = d => { const L = labeler(d), devs = new Map(d.devices.map(x => [x.id, x])); return { label: x => x.tag || L.of(x.id) || x.name, cableKind: c => cableKind(d, c, devs), cableLabel: c => L.cable(c) }; };

test('arbre : site → bâtiment → étage → pièce → baie → équipements ; rien n’est perdu', () => {
  const d = built(), roots = projectTree(d, opts(d)), idx = indexTree(roots);
  assert.equal(roots[0].key, 'site');
  const b = roots[0].children[0]; assert.equal(b.kind, 'building');
  assert.deepEqual(b.children.map(f => f.id), ['f1', 'f0']); // étage le plus haut d'abord
  const lt = idx.get('room:f0-lt'); assert.ok(lt, 'local technique');
  const rk = lt.node.children.find(n => n.kind === 'rack'); assert.equal(rk.id, 'rk1');
  assert.ok(rk.children.length > 0, 'équipements de la baie');
  assert.equal(idx.get('rack:rk1').parent, 'room:f0-lt');
  // chaque équipement et chaque câble apparaît une fois
  for (const x of d.devices) assert.ok(idx.has(keyOf('dev', x.id)), x.id);
  for (const c of d.cables) assert.ok(idx.has(keyOf('cable', c.id)), c.id);
  // une prise posée dans un bureau est sous ce bureau
  const out = d.devices.find(x => x.type.startsWith('outlet') && x.loc);
  assert.equal(idx.get(keyOf('dev', out.id)).parent.startsWith('room:'), true);
  // câbles par genre
  const cg = roots.find(r => r.key === 'grp:cables');
  assert.ok(cg.children.some(g => g.key === 'grp:cables:horizontal'));
});
test('arbre : projet sans plan → liste « Équipements » ouverte ; étages sans pièces', () => {
  const d = cleanNet({ devices: [{ id: 'r1', type: 'router', name: 'BOX', x: 0, y: 0 }, { id: 'p1', type: 'pc', name: 'PC1', x: 0, y: 0 }, { id: 's1', type: 'switch', name: 'SW1', x: 0, y: 0 }], cables: [] });
  const roots = projectTree(d, {});
  assert.equal(roots.length, 1); assert.equal(roots[0].open, true);
  assert.deepEqual(roots[0].children.map(n => n.id), ['r1', 's1', 'p1']); // routeur, switch, poste
});
test('arbre : défauts du vérificateur marqués, IP cherchable', () => {
  const d = built(), pc = d.devices.find(x => x.type.startsWith('outlet'));
  const roots = projectTree(d, { ...opts(d), issues: new Map([[pc.id, 'err']]) });
  assert.equal(indexTree(roots).get(keyOf('dev', pc.id)).node.dot, 'err');
});
test('recherche classée et chemin (fil d’Ariane)', () => {
  const d = built(), roots = projectTree(d, opts(d)), items = findItems(roots);
  assert.ok(!items.some(i => i.kind === 'grp'));
  const r = findRank(items, 'local tech');
  assert.deepEqual(r.slice(0, 2).map(x => x.key).sort(), ['room:f0-lt', 'room:f1-lt']);
  assert.equal(r.find(x => x.key === 'room:f0-lt').where, 'RDC');
  const p = pathTo(roots, 'rack:rk1').map(x => x.label);
  assert.deepEqual(p, ['Siège', 'Siège', 'RDC', 'Local technique', 'Baie 1']);
  assert.deepEqual(pathTo(roots, 'nope'), []);
  assert.equal(findRank(items, '').length, 0);
  assert.equal(findRank(items, 'zzzz').length, 0);
  assert.deepEqual(parseKey('dev:a:b'), { kind: 'dev', id: 'a:b' });
});
test('modification groupée : hauteur, catégorie, mêlées, application', () => {
  const d = built(), outs = d.devices.filter(x => x.loc).slice(0, 3);
  outs[0].loc.h = 0.3; outs[1].loc.h = 0.3; outs[2].loc.h = 1.1;
  const cab = d.cables.slice(0, 2);
  const items = resolveSel(d, [...outs.map(x => ({ kind: 'dev', id: x.id })), ...cab.map(c => ({ kind: 'cable', id: c.id })), { kind: 'dev', id: 'absent' }]);
  assert.equal(items.length, 5);
  const fields = bulkFields(d, items), m = mergeValues(items, fields);
  assert.equal(m['dev:loc.h'].mixed, true);
  assert.equal(m['dev:loc.h'].n, 3);
  assert.ok(fields.every(f => f.group), 'groupes par genre');
  assert.equal(fields.some(f => f.key === 'dev:tag'), false, 'étiquette imposée : un seul équipement');
  const h = fields.find(f => f.key === 'dev:loc.h');
  assert.equal(applyBulk(d, items, h, 0.5), 3);
  assert.deepEqual(outs.map(x => x.loc.h), [0.5, 0.5, 0.5]);
  const cat = fields.find(f => f.key === 'cable:cat');
  applyBulk(d, items, cat, 'cat6a');
  assert.ok(cab.every(c => c.cat === 'cat6a'));
  assert.equal(mergeValues(items, fields)['dev:loc.h'].mixed, false);
});
test('modification groupée : VLAN d’accès écrit sur le port du switch, à travers prise et panneau', () => {
  const d = cleanNet({
    devices: [{ id: 'sw', type: 'switch24', name: 'SW', x: 0, y: 0 }, { id: 'pb', type: 'patch24', name: 'PB', x: 0, y: 0 }, { id: 'pr', type: 'outlet', name: 'PR', x: 0, y: 0 }, { id: 'pc', type: 'pc', name: 'PC', x: 0, y: 0 }, { id: 'pc2', type: 'pc', name: 'PC2', x: 0, y: 0 }],
    cables: [{ id: 'c1', a: ['pc', 'eth0'], b: ['pr', 'front'] }, { id: 'c2', a: ['pr', 'back'], b: ['pb', 'b3'] }, { id: 'c3', a: ['pb', 'f3'], b: ['sw', 'p5'] }]
  });
  const a = accessPortOf(d, 'pc');
  assert.ok(a, 'port trouvé'); assert.equal(a.sw.id, 'sw'); assert.equal(a.port, 'p5');
  assert.equal(accessPortOf(d, 'pc2'), null);
  const items = resolveSel(d, [{ kind: 'dev', id: 'pc' }, { kind: 'dev', id: 'pc2' }]);
  const f = bulkFields(d, items).find(x => x.key === 'dev:vlan');
  assert.equal(mergeValues(items, [f])['dev:vlan'].n, 1);
  applyBulk(d, items, f, 20);
  assert.deepEqual(d.devices.find(x => x.id === 'sw').p.ports.p5, { mode: 'access', vlan: 20 });
});
test('3 000 objets : arbre, aplatissement et filtre rapides', () => {
  const d = built(() => bigFixture(3, 4));
  // gonfler jusqu'à ~3000 équipements hors plan
  for (let i = d.devices.length; i < 3000; i++) d.devices.push({ id: 'x' + i, type: 'pc', name: 'PC' + i, x: 0, y: 0, p: {} });
  const o = opts(d);
  const ms = best(() => { const roots = projectTree(d, o); const all = new Set([...indexTree(roots).keys()]); flatten(roots, all); filterTree(roots, 'pc12'); }, 3);
  console.log(`    navigateur : ${d.devices.length} équipements, ${d.cables.length} câbles ; ${ms.toFixed(1)} ms`);
  assert.ok(ms < 100, note('arbre du projet (construire, tout aplatir, filtrer)', ms, 100));
});

test('actions : renommer, enfants d’un nœud, retirer (câbles et murs avec), dupliquer', () => {
  const d = built(), roots = projectTree(d, opts(d)), idx = indexTree(roots);
  assert.ok(renameItem(d, { kind: 'rack', id: 'rk1' }, '  Baie A  ')); assert.equal(d.racks[0].name, 'Baie A');
  assert.ok(renameItem(d, { kind: 'room', id: 'f0-b1' }, 'Direction'));
  assert.equal(renameItem(d, { kind: 'room', id: 'f0-b1' }, '   '), false);
  const c0 = d.cables[0]; assert.ok(renameItem(d, { kind: 'cable', id: c0.id }, 'X-01')); assert.equal(c0.tag, 'X-01');
  const inRack = descendants(idx.get('rack:rk1').node, ['dev']);
  assert.ok(inRack.length > 0 && inRack.every(x => x.kind === 'dev'));
  // retirer un équipement retire ses câbles
  const sw = d.devices.find(x => x.rack && /switch/.test(x.type)), nc = d.cables.filter(c => c.a[0] === sw.id || c.b[0] === sw.id).length;
  const n0 = d.cables.length; assert.equal(removeItems(d, [{ kind: 'dev', id: sw.id }]), 1); assert.equal(d.cables.length, n0 - nc);
  // une baie retirée : ses équipements restent, hors baie
  const left = d.devices.filter(x => x.rack && x.rack.id === 'rk1').map(x => x.id);
  assert.equal(removeItems(d, [{ kind: 'rack', id: 'rk1' }]), 1);
  assert.ok(left.every(id => d.devices.some(x => x.id === id && !x.rack)));
  // un mur retiré emporte ses portes
  const f = d.site.buildings[0].floors[0]; f.doors.push({ id: 'dd', wall: f.walls[0].id, at: 0.5, w: 0.9 });
  removeItems(d, [{ kind: 'wall', id: f.walls[0].id }]); assert.equal(f.doors.some(x => x.id === 'dd'), false);
  // dupliquer : réglages recopiés, décalé de 1 m
  const out = d.devices.find(x => x.loc); let k = 0;
  const made = duplicateDevs(d, [out.id], (type, at) => { const n = { id: 'dup' + (++k), type, name: 'N' + k, x: at.x, y: at.y }; d.devices.push(n); return n; });
  assert.equal(made.length, 1); assert.equal(made[0].loc.x, out.loc.x + 1); assert.deepEqual(made[0].p, out.p); assert.notEqual(made[0].p, out.p);
});
test('glisser-déposer : en baie (place libre), dans une pièce, hors plan ; refus', () => {
  const d = built(), roots = projectTree(d, opts(d)), idx = indexTree(roots);
  const sw = d.devices.find(x => x.rack && /switch/.test(x.type)), pc = { id: 'pcx', type: 'pc', name: 'PCX', x: 0, y: 0, p: {} }; d.devices.push(pc);
  const node = k => idx.get(k).node;
  assert.equal(canDrop([node(keyOf('dev', sw.id))], node('rack:rk1')), true);
  assert.equal(canDrop([node('rack:rk1')], node('room:f0-b1')), false);
  assert.equal(canDrop([node(keyOf('dev', sw.id))], node(keyOf('dev', sw.id))), false);
  // dans une pièce d'un autre étage
  let r = moveDevs(d, [sw.id, 'pcx'], { kind: 'room', id: 'f1-b2', key: 'room:f1-b2' });
  assert.deepEqual(r, { moved: 2, refused: 0 });
  assert.equal(sw.rack, undefined); assert.equal(sw.loc.floor, 'f1'); assert.ok(sw.loc.x > 5 && sw.loc.x < 10);
  // en baie : le switch se range, le PC est refusé (pas montable)
  r = moveDevs(d, [sw.id, 'pcx'], { kind: 'rack', id: 'rk1', key: 'rack:rk1' });
  assert.deepEqual(r, { moved: 1, refused: 1 });
  assert.equal(sw.rack.id, 'rk1'); assert.ok(sw.rack.u >= 1); assert.equal(sw.loc, undefined);
  const occ = d.devices.filter(x => x.rack && x.rack.id === 'rk1' && x !== sw);
  assert.ok(!occ.some(x => x.rack.u === sw.rack.u && x.rack.face === 'front'), 'pas sur un autre équipement');
  r = moveDevs(d, [sw.id], { kind: 'grp', key: 'grp:loose' }); assert.equal(r.moved, 1); assert.equal(sw.rack, undefined);
  assert.equal(moveDevs(d, [sw.id], { kind: 'floor', id: 'f0', key: 'floor:f0' }).moved, 1); assert.equal(sw.loc.floor, 'f0');
});

test('fil d’Ariane direct = chemin dans l’arbre', () => {
  const d = built(), o = opts(d), roots = projectTree(d, o);
  const pick = [{ kind: 'rack', id: 'rk1' }, { kind: 'room', id: 'f1-b2' }, { kind: 'floor', id: 'f0' }, { kind: 'building', id: 'b1' }, ...d.devices.filter((x, i) => i % 17 === 0).map(x => ({ kind: 'dev', id: x.id })), ...d.cables.slice(0, 3).map(c => ({ kind: 'cable', id: c.id }))];
  for (const s of pick) {
    const a = crumbsFor(d, s, o).map(x => x.key), b = pathTo(roots, keyOf(s.kind, s.id)).map(x => x.key);
    if (s.kind === 'cable') assert.deepEqual([a[0], a[a.length - 1]], [b[0], b[b.length - 1]]); // l'arbre range aussi par genre
    else assert.deepEqual(a, b, s.kind + ' ' + s.id);
  }
  assert.deepEqual(crumbsFor(d, null), []);
});
test('recherche : adresses IP des réglages (poste, box, interfaces, SVI) et VLAN', async () => {
  const { ipsOf } = await import('./browse.js');
  const d = cleanNet({ devices: [
    { id: 'r', type: 'routerpro', name: 'RT', x: 0, y: 0, p: { ifs: [{ port: 'ge0', vlan: 0, mode: 'static', ip: '10.10.255.2', prefix: 30 }] } },
    { id: 'c', type: 'l3switch', name: 'CORE', x: 0, y: 0, p: { svis: [{ vlan: 10, ip: '10.10.10.1', prefix: 24 }] } },
    { id: 'p', type: 'pc', name: 'PC', x: 0, y: 0, p: { ip: { mode: 'static', ip: '10.10.10.20', prefix: 24, gw: '' } } }], cables: [], vlans: [{ id: 10, name: 'DATA', net: '10.10.10.0/24', gw: '10.10.10.1' }] });
  assert.ok(ipsOf(d.devices[0]).some(x => x.startsWith('10.10.255.2')));
  assert.ok(ipsOf(d.devices[1]).some(x => x.startsWith('10.10.10.1')));
  const items = findItems(projectTree(d, {}), d.vlans);
  const r = findRank(items, '10.10');
  assert.ok(r.length >= 4, r.map(x => x.label).join());
  assert.ok(r.some(x => x.kind === 'vlan'));
  assert.equal(findRank(items, '10.10.255')[0].id, 'r');
});
