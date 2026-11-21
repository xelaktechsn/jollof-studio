// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de la logique pure de la trousse réseau : arbre, tableau, grille de propriétés.
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexTree, ancestors, filterTree, flatten, defaultOpen, rangeKeys, highlightParts, sortRows, filterRows, compareCells, mergeValues, parseValue, fmtValue, getPath, setPath } from './model.js';

const T = [
  { key: 's', label: 'Site', open: true, children: [
    { key: 'b1', label: 'Bâtiment A', open: true, children: [
      { key: 'f1', label: 'Rez-de-chaussée', children: [{ key: 'r1', label: 'Bureau 12', children: [{ key: 'd1', label: 'PC-01', sub: 'Poste' }] }, { key: 'd2', label: 'AP-01', terms: 'wifi' }] },
      { key: 'f2', label: 'Étage 1', children: [] }] }] },
  { key: 'u', label: 'Non placés', children: [{ key: 'd3', label: 'Switch cœur' }] }
];

test('index, ancêtres, ouverture par défaut', () => {
  const idx = indexTree(T);
  assert.equal(idx.size, 9);
  assert.equal(idx.get('d1').depth, 4);
  assert.deepEqual(ancestors(idx, 'd1'), ['r1', 'f1', 'b1', 's']);
  assert.deepEqual([...defaultOpen(T)].sort(), ['b1', 's']);
});
test('aplatir : seules les branches ouvertes', () => {
  const rows = flatten(T, new Set(['s', 'b1']));
  assert.deepEqual(rows.map(r => r.node.key), ['s', 'b1', 'f1', 'f2', 'u']);
  assert.equal(rows.find(r => r.node.key === 'f2').kids, false); // étage vide : pas de flèche
  assert.equal(rows.find(r => r.node.key === 'f1').open, false);
});
test('filtre : correspondances, ancêtres ouverts, sans accents, mots dans le désordre', () => {
  const f = filterTree(T, 'batiment');
  assert.ok(f.match.has('b1'));
  const g = filterTree(T, '01 pc');
  assert.deepEqual([...g.match], ['d1']);
  const rows = flatten(T, new Set(), g);
  assert.deepEqual(rows.map(r => r.node.key), ['s', 'b1', 'f1', 'r1', 'd1']);
  assert.deepEqual([...filterTree(T, 'wifi').match], ['d2']); // terms
  assert.deepEqual([...filterTree(T, 'poste').match], ['d1']); // sous-titre
  assert.equal(filterTree(T, '   '), null);
  assert.equal(flatten(T, new Set(), filterTree(T, 'zzz')).length, 0);
});
test('plage de sélection dans les deux sens', () => {
  const rows = flatten(T, new Set(['s', 'b1', 'f1']));
  assert.deepEqual(rangeKeys(rows, 'f1', 'd2'), ['f1', 'r1', 'd2']);
  assert.deepEqual(rangeKeys(rows, 'd2', 'f1'), ['f1', 'r1', 'd2']);
  assert.deepEqual(rangeKeys(rows, 'nope', 'd2'), ['d2']);
});
test('repérage des mots dans le libellé', () => {
  assert.deepEqual(highlightParts('Bureau 12', 'reau'), [['Bu', false], ['reau', true], [' 12', false]]);
  assert.deepEqual(highlightParts('Étage 1', 'etage'), [['Étage', true], [' 1', false]]);
  assert.deepEqual(highlightParts('abc', ''), [['abc', false]]);
});
test('arbre de 3 000 équipements : aplatir et filtrer vite', () => {
  const big = [{ key: 'root', label: 'Site', children: Array.from({ length: 30 }, (_, r) => ({ key: 'r' + r, label: 'Baie ' + r, children: Array.from({ length: 100 }, (_, i) => ({ key: `d${r}-${i}`, label: `SW-${r}-${i}` })) })) }];
  const t0 = performance.now();
  const exp = new Set(['root', ...Array.from({ length: 30 }, (_, r) => 'r' + r)]);
  for (let k = 0; k < 10; k++) flatten(big, exp);
  const f = filterTree(big, 'sw-7-');
  const ms = (performance.now() - t0) / 10;
  assert.equal(flatten(big, exp).length, 3031);
  assert.ok(f.match.size >= 100);
  assert.ok(ms < 30, `trop lent : ${ms} ms`);
});

test('tableau : comparaison naturelle, vides en dernier, tri stable', () => {
  assert.ok(compareCells('PB1-2', 'PB1-10') < 0);
  assert.ok(compareCells('', 'a') > 0);
  assert.ok(compareCells(2, 10, true) < 0);
  const rows = [{ id: 1, n: 'b', v: 3 }, { id: 2, n: '', v: 1 }, { id: 3, n: 'a', v: 3 }, { id: 4, n: 'a', v: null }];
  const col = { key: 'n' }, num = { key: 'v', num: true };
  assert.deepEqual(sortRows(rows, col, 1).map(r => r.id), [3, 4, 1, 2]);
  assert.deepEqual(sortRows(rows, col, -1).map(r => r.id), [1, 3, 4, 2]);
  assert.deepEqual(sortRows(rows, num, 1).map(r => r.id), [2, 1, 3, 4]);
  assert.deepEqual(sortRows(rows, num, -1).map(r => r.id), [1, 3, 2, 4]);
  assert.deepEqual(sortRows(rows, null).map(r => r.id), [1, 2, 3, 4]);
});
test('tableau : filtre par mots et par colonne', () => {
  const cols = [{ key: 'rack', label: 'Baie' }, { key: 'vlan', label: 'VLAN' }, { key: 'dev', label: 'Équipement', text: r => r.dev + ' ' + r.alias }];
  const rows = [{ rack: 'B1', vlan: 20, dev: 'SW1', alias: 'cœur' }, { rack: 'B2', vlan: 120, dev: 'SW2', alias: '' }, { rack: 'B1', vlan: 30, dev: 'AP', alias: '' }];
  assert.equal(filterRows(rows, cols, 'b1').length, 2);
  assert.equal(filterRows(rows, cols, '20').length, 2); // 20 et 120
  assert.equal(filterRows(rows, cols, 'vlan:12').length, 1);
  assert.equal(filterRows(rows, cols, 'baie:b2').length, 1);
  assert.equal(filterRows(rows, cols, 'coeur').length, 1);
  assert.equal(filterRows(rows, cols, 'b1 ap').length, 1);
  assert.equal(filterRows(rows, cols, '').length, 3);
});

test('propriétés : valeurs fusionnées (mêlées, absentes, chemins)', () => {
  const fields = [{ key: 'name' }, { key: 'loc.h', type: 'number' }, { key: 'p.vlan', type: 'number', applies: o => o.type === 'pc' }, { key: 'cat', get: o => o.c }];
  const list = [{ name: 'A', type: 'pc', loc: { h: 0.3 }, p: { vlan: 20 }, c: 'cat6' }, { name: 'B', type: 'ap', loc: { h: 0.3 }, c: 'cat6' }, { name: 'C', type: 'pc', loc: { h: 0.3 }, p: { vlan: 30 }, c: 'cat6' }];
  const m = mergeValues(list, fields);
  assert.deepEqual(m.name, { value: 'A', mixed: true, n: 3 });
  assert.deepEqual(m['loc.h'], { value: 0.3, mixed: false, n: 3 });
  assert.deepEqual(m['p.vlan'], { value: 20, mixed: true, n: 2 });
  assert.equal(m.cat.value, 'cat6');
  assert.equal(mergeValues([], fields).name.n, 0);
  assert.equal(mergeValues([{ a: [1, 2] }, { a: [1, 2] }], [{ key: 'a' }]).a.mixed, false);
});
test('propriétés : lecture et contrôle des saisies', () => {
  const n = { type: 'number', min: 0, max: 30 };
  assert.deepEqual(parseValue(n, '2,5'), { ok: true, value: 2.5, error: null });
  assert.equal(parseValue(n, '1e1').value, 10);
  assert.equal(parseValue(n, 'abc').ok, false);
  assert.equal(parseValue(n, '-1').error, 'Au moins {0}');
  assert.equal(parseValue(n, '31').ok, false);
  assert.equal(parseValue(n, '').value, null);
  assert.equal(parseValue({ ...n, required: true }, '').ok, false);
  assert.equal(parseValue({ type: 'number', int: true }, '2.5').ok, false);
  assert.equal(parseValue({ type: 'number', int: true, min: 1, max: 4094 }, '4094').value, 4094);
  const s = { type: 'select', options: [['cat6', 'Cat 6'], ['cat6a', 'Cat 6A']] };
  assert.equal(parseValue(s, 'cat6a').value, 'cat6a');
  assert.equal(parseValue(s, 'cat9').ok, false);
  assert.equal(parseValue({ type: 'select', options: () => [1, 2] }, '2').value, 2);
  assert.equal(parseValue({ type: 'text', maxlength: 3 }, ' abcd ').ok, false);
  assert.equal(parseValue({ type: 'text' }, '  ab ').value, 'ab');
  assert.equal(parseValue({ type: 'text', pattern: '^[A-Z]+$' }, 'abc').ok, false);
  assert.equal(parseValue({ type: 'text', validate: v => (v === 'x' ? 'non' : null) }, 'x').error, 'non');
  assert.equal(parseValue({ type: 'bool' }, 1).value, true);
  assert.equal(parseValue(n, '3', (t, v) => t.replace('{0}', v)).value, 3);
});
test('propriétés : affichage et chemins', () => {
  assert.equal(fmtValue({ type: 'number' }, 2.5), '2,5');
  assert.equal(fmtValue({ type: 'number' }, 2.5, true), '2.5');
  assert.equal(fmtValue({ type: 'number', digits: 1 }, 1.26, true), '1.3');
  assert.equal(fmtValue({}, null), '');
  const o = {}; setPath(o, 'loc.h', 2); assert.equal(getPath(o, 'loc.h'), 2); assert.equal(getPath(o, 'x.y'), undefined);
});
