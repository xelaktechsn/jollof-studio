// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Menus d'un projet réseau (menus.js) : par type de projet, entrées conditionnelles, états, raccourcis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { menusFor, flatItems, shortcutRows, globalKeys, matchKey, keyLabel, hasNet, netOnly, MENUS } from './menus.js';

const base = (o = {}) => ({ kind: 'net', view: 'logic', cap: {}, floors: [], racks: [], sel: null, sim: {}, layers: null, has: () => false, ...o });
const ids = env => flatItems(env).map(x => x.id);

test('seuls les projets avec un plan réseau ont des menus', () => {
  for (const k of ['elec', 'analog', 'pneu', 'epneu', 'logic']) assert.deepEqual(menusFor(base({ kind: k })), [], k);
  assert.equal(hasNet('net'), true); assert.equal(hasNet('iot'), true); assert.equal(hasNet('elec'), false);
  assert.equal(netOnly('net'), true); assert.equal(netOnly('iot'), false);
  const net = menusFor(base()).map(m => m.id), iot = menusFor(base({ kind: 'iot' })).map(m => m.id);
  assert.deepEqual(net, ['file', 'edit', 'view', 'insert', 'net', 'design', 'tests', 'docs', 'help']);
  assert.deepEqual(iot, net);
  assert.deepEqual(menusFor(null), []);
});

test('identifiants uniques, libellés non vides', () => {
  const all = [], walk = list => { for (const it of list) { if (it.sep) continue; all.push(it.id); assert.ok(it.label(), it.id); if (Array.isArray(it.sub)) walk(it.sub); } };
  for (const m of MENUS) walk(m.items);
  assert.equal(new Set(all).size, all.length);
  const env = base({ cap: { cad: true, dxf: true, pdf: true }, floors: [{ id: 'F1', name: 'RDC' }], racks: [{ id: 'R1', name: 'Baie 1' }], has: () => true });
  const flat = ids(env); assert.equal(new Set(flat).size, flat.length);
});

test('entrées des autres parties : visibles seulement si elles existent', () => {
  const off = ids(base());
  for (const id of ['file.importCad', 'file.exportDxf', 'file.exportPdf', 'docs.sheets', 'edit.find', 'edit.goto', 'view.layers', 'view.browser', 'view.dockPatch', 'net.wifiPlan', 'tests.exam']) assert.ok(!off.includes(id), id);
  const on = ids(base({ pro: true, cap: { cad: true, dxf: true, pdf: true }, has: id => ['net.find', 'net.layers', 'net.exam'].includes(id) }));
  // Mode examen : au menu dans l'édition Pro, ou pour sortir d'un examen en cours ; jamais en appât dans l'édition libre.
  assert.ok(!ids(base({ has: () => true })).includes('tests.exam'));
  assert.ok(ids(base({ exam: true, has: () => true })).includes('tests.exam'));
  for (const id of ['file.importCad', 'file.exportDxf', 'file.exportPdf', 'docs.sheets', 'edit.find', 'view.layers', 'tests.exam']) assert.ok(on.includes(id), id);
  assert.ok(!on.includes('edit.goto'));
});

test('états : vue cochée, calques, VLAN, grisés', () => {
  const env = base({ view: 'plan', layers: { wifi: true, image: false, routes: true }, sim: { vlan: true }, canUndo: false, sel: null });
  const f = Object.fromEntries(flatItems(env).map(x => [x.id, x]));
  assert.equal(f['view.plan'].checked, true); assert.equal(f['view.plan'].radio, true); assert.equal(f['view.logic'].checked, false);
  assert.equal(f['view.wifi'].checked, true); assert.equal(f['view.underlay'].checked, false); assert.equal(f['view.vlan'].checked, true); assert.equal(f['view.passive'].checked, false);
  assert.equal(f['edit.undo'].disabled, true); assert.equal(f['edit.redo'].disabled, false); assert.equal(f['edit.delete'].disabled, true);
  assert.ok(f['edit.selectAll'], 'tout choisir : vue Plans');
  assert.ok(ids(base({ view: 'logic' })).includes('edit.selectAll'));
  assert.ok(!ids(base({ view: 'design' })).includes('edit.selectAll'), 'pas de presse-papiers en Conception');
  for (const id of ['edit.cut', 'edit.copy', 'edit.paste', 'edit.duplicate']) assert.ok(!ids(base({ view: 'design' })).includes(id), id);
  assert.deepEqual(['edit.copy', 'edit.paste', 'edit.duplicate'].map(id => ids(base({ view: 'racks' })).includes(id)), [true, true, true]);
  assert.equal(f['edit.copy'].disabled, true); assert.equal(f['edit.paste'].disabled, false);
  assert.equal(f['edit.selectAll'].label, 'Tout sélectionner sur l’étage');
  // Touche seule d'une vue (R : salle en Plans, traceroute en Logique) : montrée seulement dans sa vue.
  assert.equal(f['ins.room'].keys, 'R'); assert.equal(f['tests.trace'].keys, '');
  assert.equal(base({ sel: { kind: 'dev', id: 'x' } }) && Object.fromEntries(flatItems(base({ sel: { kind: 'dev', id: 'x' } })).map(x => [x.id, x]))['edit.delete'].disabled, false);
});

test('sous-menus : étages et baies du projet, grisés sans contenu', () => {
  const empty = Object.fromEntries(flatItems(base()).map(x => [x.id, x]));
  assert.equal(empty['docs.floors'].disabled, true); assert.equal(empty['docs.racks'].disabled, true);
  const env = base({ floors: [{ id: 'F1', name: 'Rez-de-chaussée' }, { id: 'F2', name: 'Niveau 1' }], racks: [{ id: 'R1', name: 'LT1-B1' }] });
  const docs = menusFor(env).find(m => m.id === 'docs').items.find(x => x.id === 'docs.floors');
  assert.deepEqual(docs.sub.map(x => [x.label, x.act]), [['Rez-de-chaussée', 'svg-floor:F1'], ['Niveau 1', 'svg-floor:F2']]);
  assert.equal(docs.disabled, false);
  const csv = menusFor(env).find(m => m.id === 'file').items.find(x => x.id === 'file.export').sub.find(x => x.id === 'file.exportCsv');
  assert.equal(csv.sub.length, 5);
});

test('pas de séparateur en tête, en fin ni en double', () => {
  for (const env of [base(), base({ kind: 'iot', view: null }), base({ cap: { cad: true, dxf: true, pdf: true }, has: () => true })]) {
    for (const m of menusFor(env)) {
      const it = m.items; assert.ok(!it[0].sep && !it[it.length - 1].sep, m.id);
      for (let i = 1; i < it.length; i++) assert.ok(!(it[i].sep && it[i - 1].sep), m.id);
    }
  }
});

test('raccourcis : uniques par combinaison et action, reconnus, écrits à la façon du système', () => {
  const env = base({ cap: { cad: true, dxf: true, pdf: true }, has: () => true });
  const byKey = new Map();
  for (const it of flatItems(env)) if (it.keys) { const k = it.scope + '|' + it.keys, a = it.cmd || it.act; if (byKey.has(k)) assert.equal(byKey.get(k), a, k + ' : deux actions'); byKey.set(k, a); }
  const rows = shortcutRows(env);
  assert.ok(rows.some(([k]) => k === 'Alt+1…4')); assert.ok(!rows.some(([k]) => k === 'Alt+2')); assert.ok(rows.some(([k]) => k === 'Mod+I')); assert.ok(!rows.some(([k]) => k === 'W' || k === 'Mod+S'));
  assert.equal(new Set(rows.map(r => r[0])).size, rows.length);
  assert.deepEqual(globalKeys().map(g => g[0]).sort(), ['Mod+Alt+B', 'Mod+I', 'Mod+P', 'Mod+Shift+E', 'Mod+Shift+K']);
  assert.equal(matchKey({ key: 'e', code: 'KeyE', ctrlKey: true, shiftKey: true }, 'Mod+Shift+E'), true);
  assert.equal(matchKey({ key: 'E', code: 'KeyE', metaKey: true, shiftKey: true }, 'Mod+Shift+E'), true);
  assert.equal(matchKey({ key: 'e', code: 'KeyE', ctrlKey: true }, 'Mod+Shift+E'), false);
  assert.equal(matchKey({ key: '©', code: 'KeyI', metaKey: true, altKey: true }, 'Mod+I'), false);
  assert.equal(matchKey({ key: '&', code: 'Digit1', altKey: true }, 'Alt+1'), true);
  assert.equal(matchKey({ key: 'F7', code: 'F7' }, 'F7'), true);
  assert.equal(keyLabel('Mod+Shift+E', true), '⌘⇧E');
  assert.equal(keyLabel('Mod+Shift+E', false, false), 'Ctrl+Maj+E');
  assert.equal(keyLabel('Mod+Shift+E', false, true), 'Ctrl+Shift+E');
  assert.equal(keyLabel('Del', false, false), 'Suppr'); assert.equal(keyLabel('', false), '');
});

test('chaque entrée fait quelque chose', () => {
  const env = base({ cap: { cad: true, dxf: true, pdf: true }, floors: [{ id: 'F1', name: 'A' }], racks: [{ id: 'R1', name: 'B' }], has: () => true });
  for (const it of flatItems(env)) if (!it.sub) assert.ok(it.act || it.cmd, it.id);
});

test('commandes de l’application de bureau : signalées dans la version web, toujours ouvrables', () => {
  const env = d => base({ desktop: d, cap: { dwg: true, netbox: true, dxf: true } });
  const web = Object.fromEntries(flatItems(env(false)).map(x => [x.id, x])), desk = Object.fromEntries(flatItems(env(true)).map(x => [x.id, x]));
  for (const id of ['file.exportDwg', 'docs.dwg', 'docs.netbox']) { assert.equal(web[id].tag, 'application de bureau', id); assert.equal(web[id].disabled, false, id); assert.equal(desk[id].tag, '', id); }
  assert.equal(web['file.exportDxf'].tag, '');
});
