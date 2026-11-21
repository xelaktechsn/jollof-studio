// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de la manipulation des fonds DXF (underlay-edit.js) : entités, choix, fiche, chaînes, comparaison de versions.
// node --test src/net/ui/underlay-edit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { entities, entSegs, pick, boxSelect, layerEnts, chainsOf, selInfo, segKey, diffUnderlays, mergeLayerSettings, regionFor, changeBoxes } from './underlay-edit.js';

/** Fond déballé de test : un carré 4×4 (calque 0, une polyligne), une ligne (calque 1), une ligne seule (calque 0). */
function un(extra = []) {
  const segs = [0, 0, 4, 0, 4, 0, 4, 4, 4, 4, 0, 4, 0, 4, 0, 0, 10, 0, 12, 0, 6, 6, 8, 6, ...extra.flat()];
  return { segs: new Float32Array(segs), segLayer: new Uint16Array([0, 0, 0, 0, 1, 0, ...extra.map(e => e[4] ?? 0)].slice(0, segs.length / 4)), step: 0.001, layers: [{ name: 'MURS' }, { name: 'CFA' }] };
}
const all = u => [...Array(u.segLayer.length).keys()];
test('entities : chaînes consécutives reliées, ou poignées du paquet', () => {
  const u = un(), E = entities(u);
  assert.equal(E.n, 3); assert.deepEqual([...E.of], [0, 0, 0, 0, 1, 2]); assert.deepEqual([...entSegs(E, 0)], [0, 1, 2, 3]);
  const v = { ...u, segEnt: new Uint32Array([7, 7, 9, 9, 7, 3]) }, F = entities(v);
  assert.equal(F.n, 3); assert.deepEqual([...F.of], [0, 0, 1, 1, 0, 2]); assert.deepEqual(F.src, [7, 9, 3]);
});
test('pick, boxSelect, layerEnts', () => {
  const u = un(), E = entities(u);
  assert.equal(pick(u, E, all(u), 2, 0.1, 0.3), 0); assert.equal(pick(u, E, all(u), 11, 0.2, 0.3), 1);
  assert.equal(pick(u, E, all(u), 20, 20, 0.3), -1); assert.equal(pick(u, E, all(u), 11, 0.2, 0.3, l => l === 1), -1);
  assert.deepEqual(boxSelect(u, E, all(u), [-1, -1, 5, 5]).sort(), [0]);
  assert.deepEqual(boxSelect(u, E, all(u), [-1, -1, 2, 2], true).sort(), [0]);
  assert.deepEqual(boxSelect(u, E, all(u), [-1, -1, 2, 2]), [], 'le carré dépasse : pas pris en mode fenêtre');
  assert.deepEqual(layerEnts(u, E, 0).sort(), [0, 2]);
});
test('chainsOf et selInfo : contour fermé, aire, longueur', () => {
  const u = un(), E = entities(u);
  const c = chainsOf(u, [2, 0, 3, 1]); assert.equal(c.length, 1); assert.equal(c[0].closed, true); assert.equal(c[0].pts.length, 8);
  assert.equal(chainsOf(u, [4]).length, 1); assert.equal(chainsOf(u, [4])[0].closed, false);
  const i = selInfo(u, E, [0, 1]);
  assert.equal(i.ents, 2); assert.equal(i.segs, 5); assert.ok(Math.abs(i.length - 18) < 1e-6); assert.equal(i.closed, 1); assert.ok(Math.abs(i.area - 16) < 1e-6);
  assert.deepEqual([...i.layers], [[0, 1], [1, 1]]); assert.deepEqual(i.box, [0, 0, 12, 4]);
  const h = { ...u, segEnt: new Uint32Array([0, 0, 0, 0, 1, 2]), entHandle: new Float64Array([0x2a, 0xff, NaN]), entType: new Uint8Array([1, 0, 0]) };
  assert.deepEqual(selInfo(h, entities(h), [0, 1, 2]).handles, ['2A', 'FF']);
});
test('segKey : indépendante du sens', () => {
  const s = new Float32Array([1, 2, 3, 4, 3, 4, 1, 2]); assert.equal(segKey(s, 0, 0.001), segKey(s, 1, 0.001));
});
const nameOf = (u, l) => u.layers[l].name;
test('diffUnderlays géométrique : ajouts et retraits par calque', () => {
  const a = un(), b = un([[20, 20, 21, 20, 1]]);
  b.segs[20] = 6; b.segs[21] = 7; b.segs[22] = 8; b.segs[23] = 7; // la ligne seule des murs a bougé
  const d = diffUnderlays(a, b, nameOf);
  assert.equal(d.byHandle, false);
  const murs = d.layers.find(l => l.name === 'MURS'), cfa = d.layers.find(l => l.name === 'CFA');
  assert.deepEqual([murs.added, murs.removed, murs.same], [1, 1, 4]); assert.deepEqual([cfa.added, cfa.removed], [1, 0]);
  assert.equal(d.added.length, 8); assert.equal(d.removed.length, 4); assert.deepEqual(d.total, { added: 2, removed: 1, changed: 0 });
  const z = diffUnderlays(a, un(), nameOf); assert.deepEqual(z.total, { added: 0, removed: 0, changed: 0 }); assert.equal(z.box, null);
  // Numéros de calques différents, mêmes noms : rien ne change.
  const c = { ...un(), layers: [{ name: 'CFA' }, { name: 'MURS' }], segLayer: new Uint16Array([1, 1, 1, 1, 0, 1]) };
  assert.deepEqual(diffUnderlays(a, c, nameOf).total, { added: 0, removed: 0, changed: 0 });
});
test('diffUnderlays par poignée : modifiée, ajoutée, retirée', () => {
  const H = (u, ents, handles) => ({ ...u, segEnt: new Uint32Array(ents), entHandle: new Float64Array(handles), entType: new Uint8Array(handles.length) });
  const a = H(un(), [0, 0, 0, 0, 1, 2], [0x10, 0x11, 0x12]);
  const bb = un(); bb.segs[2] = 5; // le carré (poignée 10) déformé
  const b = H(bb, [0, 0, 0, 0, 1, 2], [0x10, 0x11, 0x13]); // 12 disparu, 13 nouveau (même géométrie)
  const d = diffUnderlays(a, b, nameOf);
  assert.equal(d.byHandle, true);
  const murs = d.layers.find(l => l.name === 'MURS');
  assert.deepEqual([murs.changed, murs.added, murs.removed], [1, 1, 1]); assert.equal(d.layers.find(l => l.name === 'CFA').same, 1);
});
test('mergeLayerSettings : réglages gardés par nom', () => {
  const m = mergeLayerSettings([{ id: 3, name: 'MURS', color: '#123456', on: false, dim: true, lock: true, recolor: true }, { id: 4, name: 'CFA', color: '#0000ff', on: true }], [{ id: 0, name: 'CFA', color: '#00ffff' }, { id: 1, name: 'MURS', color: '#ffffff' }, { id: 2, name: 'NEW', color: '#ff0000' }]);
  assert.deepEqual(m, [{ id: 0, name: 'CFA', color: '#00ffff', on: true, dim: undefined, lock: false }, { id: 1, name: 'MURS', color: '#123456', on: false, dim: true, lock: true, recolor: true }, { id: 2, name: 'NEW', color: '#ff0000', on: true, dim: false, lock: false }].map(x => ({ ...x, dim: !!x.dim })));
});
test('regionFor et changeBoxes : même zone absolue, cases des changements', () => {
  assert.deepEqual(regionFor({ origin: [100, 200], region: [1, 2, 11, 12] }, { origin: [90, 205] }), [11, -3, 21, 7]);
  assert.deepEqual(regionFor({ region: [0, 0, 1, 1] }, {}), [0, 0, 1, 1]);
  const b = changeBoxes(new Float32Array([1, 1, 2, 2, 1.5, 1.5, 3, 3, 50, 50, 51, 50]));
  assert.equal(b.length, 2); assert.deepEqual(b[0], [-0.5, -0.5, 4.5, 4.5]);
});
test('diffUnderlays : poignées absentes (NaN) → comparaison géométrique, pas de faux « modifiés »', () => {
  const H = (u, ents, handles) => ({ ...u, segEnt: new Uint32Array(ents), entHandle: new Float64Array(handles), entType: new Uint8Array(handles.length) });
  const a = H(un(), [0, 0, 0, 0, 1, 2], [NaN, NaN, NaN]);
  const b = H(un([[20, 20, 21, 20, 1]]), [1, 1, 1, 1, 2, 3, 0], [NaN, NaN, NaN, NaN]); // une entité insérée en tête : indices décalés
  const d = diffUnderlays(a, b, nameOf);
  assert.equal(d.byHandle, false); assert.deepEqual(d.total, { added: 1, removed: 0, changed: 0 });
});
