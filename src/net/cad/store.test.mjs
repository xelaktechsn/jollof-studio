// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du rangement des fonds de plan vectoriels (src/net/cad/store.js) : nettoyage tolérant, borné, stable ; réserve
// de session des données binaires. node --test src/net/cad/store.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUnderlays, cleanUnderlay, cleanBlobs, clearPool, rememberBlob, cleanJson, bytesToDataUrl, dataUrlToBytes, blobBytes, UL_MAX } from './store.js';
import { cleanNet } from '../clean.js';

const B64 = 'data:application/octet-stream;base64,';
const UL = { id: 'cad1', name: 'Plan RDC', source: { file: 'plan.dxf', units: 'mm', insunits: 4 }, origin: [1e6, 2e6], toMetre: 0.001,
  region: [0, 0, 5000, 3000], transform: { dx: 2, dy: 3, rot: -90, scale: 1 }, layers: [{ id: 0, name: 'MURS', color: '#FF0000', on: true }, { id: 3, name: 'TEXTE', color: 'blue', dim: 1 }],
  mono: 0, opacity: 3, pack: { v: 1, n: 12, layers: [{ id: 0, name: 'MURS' }] }, stats: { segs: 12, texts: 1, bytes: 300 } };
const SITE = { buildings: [{ id: 'B1', name: 'B', floors: [{ id: 'F0', level: 0 }, { id: 'F1', level: 1 }] }] };

test('cleanUnderlay : bornes et valeurs par défaut', () => {
  const u = cleanUnderlay(UL);
  assert.equal(u.opacity, 1); assert.equal(u.mono, false); assert.equal(u.transform.rot, 270);
  assert.deepEqual(u.layers.map(l => [l.id, l.color, l.on, l.dim]), [[0, '#ff0000', true, false], [3, '#ffffff', true, true]]);
  assert.equal(u.source.units, 'mm'); assert.equal(u.toMetre, 0.001); assert.deepEqual(u.origin, [1e6, 2e6]);
  for (const g of [null, 1, 'x', [], {}, { id: '../../etc' }, { id: 'x'.repeat(41) }]) assert.equal(cleanUnderlay(g), null);
  const w = cleanUnderlay({ id: 'a', region: [5, 5, 1, 1], toMetre: -3, transform: { scale: 0, dx: 1e9 }, layers: [{ id: 1 }, { id: 1 }, { id: -2 }, null, { id: 'x' }] });
  assert.deepEqual(w.region, [0, 0, 0, 0]); assert.equal(w.toMetre, 1e-6); assert.equal(w.transform.scale, 1e-4); assert.equal(w.transform.dx, 1e5);
  assert.equal(w.layers.length, 1);
});

test('cleanUnderlay : verrou, couleur choisie, révision bornée', () => {
  const u = cleanUnderlay({ ...UL, layers: [{ id: 0, name: 'A', color: '#00ff00', lock: 1, recolor: 'oui' }], rev: { n: -4, file: 'x'.repeat(300), at: 'z', added: 1e12, removed: 3, changed: NaN } });
  assert.deepEqual(u.layers[0], { id: 0, name: 'A', color: '#00ff00', on: true, dim: false, lock: true, recolor: true });
  assert.deepEqual(u.rev, { n: 1, file: 'x'.repeat(160), at: 0, added: 1e9, removed: 3, changed: 0 });
  assert.equal('rev' in cleanUnderlay(UL), false);
  assert.deepEqual(cleanUnderlay(u), u);
});

test('cleanUnderlays : un fond par étage existant, paquets non partagés, idempotent', () => {
  const raw = { F0: UL, F1: { ...UL }, F9: { ...UL, id: 'cad9' }, 'bad key!': UL, F2: null };
  const a = cleanUnderlays(raw, ['F0', 'F1']);
  assert.deepEqual(Object.keys(a), ['F0']);
  assert.deepEqual(cleanUnderlays(a, ['F0', 'F1']), a);
  assert.deepEqual(cleanUnderlays(null), {}); assert.deepEqual(cleanUnderlays('x'), {});
  const many = {}; for (let i = 0; i < 500; i++) many['F' + i] = { ...UL, id: 'c' + i };
  assert.equal(Object.keys(cleanUnderlays(many)).length, UL_MAX.underlays);
});

test('cleanJson : en-tête borné', () => {
  const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
  assert.equal(cleanJson(deep).a.b.c.d.e.f, null);
  assert.deepEqual(cleanJson({ x: NaN, 'bad key': 1, s: 'y'.repeat(500), l: [1, 'a', null] }), { x: 0, s: 'y'.repeat(200), l: [1, 'a', null] });
  const big = cleanUnderlay({ ...UL, pack: { list: Array.from({ length: 4000 }, () => 'z'.repeat(100)) } });
  assert.deepEqual(big.pack, {});
});

test('cleanBlobs : seuls les paquets des fonds, format vérifié, réserve pour « rétablir »', () => {
  clearPool();
  const und = cleanUnderlays({ F0: UL });
  const ok = B64 + 'AAECAwQ=';
  assert.deepEqual(cleanBlobs({ cad1: ok, orphan: ok }, und), { cad1: ok });
  assert.deepEqual(cleanBlobs({ cad1: 'data:image/png;base64,AAAA' }, und), { cad1: ok }, 'mauvais format : la réserve rend le dernier bon');
  clearPool();
  assert.deepEqual(cleanBlobs({ cad1: B64 + 'AA$A' }, und), {});
  assert.deepEqual(cleanBlobs({ cad1: B64 + 'AAA' }, und), {}, 'longueur base64 invalide');
  assert.deepEqual(cleanBlobs(null, und), {}); assert.deepEqual(cleanBlobs({ cad1: ok }, null), {});
  const b = cleanBlobs({ cad1: ok }, und); assert.deepEqual(cleanBlobs(b, und), b);
  clearPool(); rememberBlob('cad1', ok); rememberBlob('../x', ok); rememberBlob('cad2', 'nope');
  assert.deepEqual(cleanBlobs({}, und), { cad1: ok }, 'paquet retiré puis « annuler » : rendu par la réserve');
  clearPool();
  for (let i = 0; i < 100; i++) rememberBlob('k' + i, ok);
  assert.deepEqual(cleanBlobs({}, cleanUnderlays({ F0: { ...UL, id: 'k0' } })), {}, 'réserve bornée : les plus anciens partent');
});

test('cleanNet : fonds et paquets traversent le nettoyage, hors étages retirés ; stable', () => {
  clearPool();
  const ok = B64 + 'AAECAwQ=';
  const n = cleanNet({ site: SITE, underlays: { F1: UL, F7: { ...UL, id: 'cad7' } }, blobs: { cad1: ok, cad7: ok } });
  assert.deepEqual(Object.keys(n.underlays), ['F1']); assert.deepEqual(Object.keys(n.blobs), ['cad1']);
  assert.deepEqual(cleanNet(cleanNet(n)), n);
  // Annuler puis rétablir : l'historique ne porte pas les paquets, la réserve les rend.
  const snap = JSON.parse(JSON.stringify(n, (k, v) => (k === 'blobs' ? undefined : v)));
  assert.equal(cleanNet(snap).blobs.cad1, ok);
  const empty = cleanNet({}); assert.deepEqual(empty.underlays, {}); assert.deepEqual(empty.blobs, {});
});

test('codage base64 aller-retour et taille', async () => {
  const bytes = new Uint8Array(1000).map((_, i) => (i * 37) & 255);
  const url = await bytesToDataUrl(bytes);
  assert.ok(url.startsWith(B64)); assert.equal(blobBytes(url), 1000);
  assert.deepEqual(await dataUrlToBytes(url), bytes);
  await assert.rejects(dataUrlToBytes('data:image/png;base64,AA=='));
});
