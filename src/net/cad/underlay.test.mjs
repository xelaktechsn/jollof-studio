// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du fond de plan compact (underlay.js) : emballage / déballage, découpe à la zone, calques, textes,
// remplissages, version, taille, accrochage aux extrémités, intersections et milieux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseDxf, KINDS } from './dxf.js';
import { packUnderlay, unpackUnderlay, snapPoints, nearestSnap, clipSeg, segX, UNDERLAY_VERSION } from './underlay.js';

const FIX = new URL('./fixtures/', import.meta.url);
const load = name => parseDxf(fs.readFileSync(new URL(name, FIX)));
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

/** Petit CadDoc fabriqué à la main (unités : mm). */
function fakeDoc(segs, layerOf, extra = {}) {
  const n = segs.length / 4;
  return {
    units: 'mm', toMetre: 0.001, origin: [1000, 2000], extents: [0, 0, 10000, 10000],
    layers: [{ id: 0, name: '0', color: '#ffffff' }, { id: 1, name: 'MURS', color: '#ff0000' }, { id: 2, name: 'OFF', color: '#00ff00', off: true }],
    segs: Float32Array.from(segs), segLayer: Uint16Array.from({ length: n }, (_, i) => layerOf(i)), segKind: new Uint8Array(n), segColor: new Uint16Array(n),
    palette: ['#000000'], texts: [], inserts: [], fills: null, clusters: [], ...extra
  };
}

test('aller-retour : segments au mm près, mètres relatifs au coin de la zone, y vers le haut', async () => {
  const d = await load('blocks.dxf');
  const { meta, bytes } = packUnderlay(d, { layers: new Set(d.layers.map(l => l.id)) });
  assert.equal(bytes[0], UNDERLAY_VERSION); assert.equal(meta.v, 1);
  assert.equal(meta.segs, d.segLayer.length); assert.equal(meta.bytes, bytes.length);
  const u = unpackUnderlay(meta, bytes);
  assert.equal(u.segLayer.length, d.segLayer.length);
  const [rx, ry] = meta.region;
  // chaque segment d'origine est retrouvé à 1 mm près (d'abord trié pour comparer sans dépendre de l'ordre)
  const key = (a, b, c, e) => [a, b, c, e].map(v => Math.round(v * 1000)).join(',');
  const want = new Set(), got = new Set();
  for (let i = 0; i < d.segLayer.length; i++) want.add(key(d.segs[i * 4] - rx, d.segs[i * 4 + 1] - ry, d.segs[i * 4 + 2] - rx, d.segs[i * 4 + 3] - ry));
  for (let i = 0; i < u.segLayer.length; i++) got.add(key(u.segs[i * 4], u.segs[i * 4 + 1], u.segs[i * 4 + 2], u.segs[i * 4 + 3]));
  assert.deepEqual([...got].sort(), [...want].sort());
  // calques : indices du paquet, nom et couleur d'origine
  const names = new Set([...u.segLayer].map(i => u.layers[i].name));
  assert.deepEqual([...names].sort(), ['DOORS', 'FIXED']);
  assert.equal(u.layers.find(l => l.name === 'DOORS').color, '#00ff00');
  assert.ok(u.layers.every((l, i) => l.id === i));
  // couleur par entité (BYBLOCK rouge) conservée
  assert.ok([...u.segColor].some(c => c && u.colors[c - 1] === '#ff0000'));
  // textes (attribut et cote)
  assert.deepEqual(u.texts.map(t => t.text).sort(), ['50', 'P-01']);
  const t = u.texts.find(x => x.text === '50'); assert.equal(t.ha, 1); assert.equal(t.va, 1); assert.ok(near(t.h, 1));
  assert.deepEqual(u.bbox, [0, 0, meta.size[0], meta.size[1]]);
});

test('zone, calques choisis, découpe et unités corrigées', () => {
  // 3 segments en mm : un dedans, un qui traverse le bord, un dehors ; un sur un calque non retenu
  const d = fakeDoc([100, 100, 200, 100, 150, 150, 400, 150, 900, 900, 950, 950, 100, 120, 200, 120], i => (i === 3 ? 2 : 1));
  const { meta, bytes } = packUnderlay(d, { region: [0, 0, 300, 300] });
  const u = unpackUnderlay(meta, bytes);
  assert.equal(u.segLayer.length, 2, 'calque éteint et segment hors zone retirés');
  const s = [...u.segs];
  assert.deepEqual(s.slice(0, 4).map(v => +v.toFixed(3)), [0.1, 0.1, 0.2, 0.1]);
  assert.deepEqual(s.slice(4, 8).map(v => +v.toFixed(3)), [0.15, 0.15, 0.3, 0.15], 'découpé au bord de la zone');
  assert.deepEqual(meta.size, [0.3, 0.3]);
  // l'utilisateur corrige l'unité (cm au lieu de mm) et choisit les calques
  const p2 = packUnderlay(d, { region: [0, 0, 300, 300], toMetre: 0.01, layers: [2, 1] });
  const u2 = unpackUnderlay(p2.meta, p2.bytes);
  assert.equal(u2.segLayer.length, 3);
  assert.ok(near(u2.segs[2], 2, 1e-6));
  assert.deepEqual(clipSeg(0, 0, 10, 0, 2, -1, 5, 1), [2, 0, 5, 0]);
  assert.equal(clipSeg(0, 5, 10, 5, 0, 0, 3, 3), null);
});

test('enchaînement et taille : 10 000 segments chaînés ≈ 2 octets par segment ; remplissages et textes', () => {
  const S = [];
  for (let i = 0; i < 10000; i++) { const a = (i / 10000) * Math.PI * 2, b = ((i + 1) / 10000) * Math.PI * 2; S.push(5000 + 4000 * Math.cos(a), 5000 + 4000 * Math.sin(a), 5000 + 4000 * Math.cos(b), 5000 + 4000 * Math.sin(b)); }
  const d = fakeDoc(S, () => 1, {
    texts: [{ x: 10, y: 20, h: 2.5, rot: Math.PI / 2, text: 'Bureau 12 — étage', layer: 1, ha: 2, va: 3, mirror: true }],
    fills: { tris: Float32Array.from([0, 0, 10, 0, 0, 10, 20000, 0, 20010, 0, 20000, 10]), layer: Uint16Array.from([1, 1]) }
  });
  const { meta, bytes } = packUnderlay(d, { region: [0, 0, 10000, 10000] });
  assert.ok(bytes.length < 10000 * 3, `${bytes.length} octets`);
  const u = unpackUnderlay(meta, bytes);
  assert.equal(u.segLayer.length, 10000);
  assert.equal(u.tris.length, 6, 'triangle hors zone retiré'); assert.equal(u.triLayer.length, 1);
  const t = u.texts[0];
  assert.equal(t.text, 'Bureau 12 — étage'); assert.ok(near(t.rot, Math.PI / 2, 1e-4)); assert.equal(t.ha, 2); assert.equal(t.va, 3); assert.equal(t.mirror, true);
  assert.ok(near(t.x, 0.01) && near(t.y, 0.02) && near(t.h, 0.0025, 1e-3));
  assert.throws(() => unpackUnderlay(meta, Uint8Array.from([9, 0, 0, 0])), /version/);
  assert.throws(() => unpackUnderlay(meta, bytes.subarray(0, 50)), /tronqu/);
  const empty = packUnderlay(d, { region: [-100, -100, -50, -50], texts: false, fills: false });
  assert.equal(unpackUnderlay(empty.meta, empty.bytes).segLayer.length, 0);
});

test('accrochage : extrémités, intersections, milieux, grille et plus proche point', () => {
  // un « dièse » : 2 horizontales et 2 verticales (mm), 4 intersections
  const d = fakeDoc([0, 1000, 3000, 1000, 0, 2000, 3000, 2000, 1000, 0, 1000, 3000, 2000, 0, 2000, 3000], () => 1);
  const u = unpackUnderlay(...Object.values(packUnderlay(d, { region: [0, 0, 3000, 3000] })));
  const all = snapPoints(u, [-1, -1, 4, 4]);
  const by = k => all.filter(p => p.kind === k);
  assert.equal(by('end').length, 8); assert.equal(by('int').length, 4); assert.equal(by('mid').length, 4);
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) assert.ok(by('int').some(p => near(p.x, x) && near(p.y, y)), `${x},${y}`);
  const box = snapPoints(u, [0.9, 0.9, 1.1, 1.1]);
  assert.deepEqual(box.map(p => p.kind), ['int']);
  const s = nearestSnap(u, 1.05, 0.98, 0.2);
  assert.equal(s.kind, 'int'); assert.ok(near(s.x, 1) && near(s.y, 1));
  assert.equal(nearestSnap(u, 2.95, 2.1, 0.2).kind, 'end');
  assert.equal(nearestSnap(u, 10, 10, 0.5), null);
  assert.deepEqual(snapPoints(u, [0, 0, 3, 3], { max: 3 }).length, 3);
  assert.equal(segX(0, 0, 1, 0, 0, 1, 1, 1), null);
  assert.deepEqual(segX(0, 0, 2, 2, 0, 2, 2, 0), [1, 1]);
});

test('accrochage sur un vrai fond : grille construite une fois, requêtes rapides', async () => {
  const d = await load('hatch.dxf');
  const p = packUnderlay(d, {}); const u = unpackUnderlay(p.meta, p.bytes);
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) snapPoints(u, [i % 20, 0, (i % 20) + 2, 2]);
  assert.ok(performance.now() - t0 < 500);
  assert.ok(snapPoints(u, [-1, -1, 200, 200]).some(p => p.kind === 'end'));
  assert.ok(KINDS.includes('hatch'));
});

test('format v2 : entité d’origine par polyligne et par texte, table des poignées ; v1 inchangé', async () => {
  const { createDxfWriter } = await import('./dxfwrite.js');
  const w = createDxfWriter({ units: 'm' });
  w.block('B', {}, b => b.circle(0, 0, 0.5));
  w.line(0, 0, 5, 0, { layer: 'A' }); w.line(5, 0, 5, 5, { layer: 'A' }); // jointives mais deux entités
  w.insert('B', 2, 2, { layer: 'A' }); w.text(1, 1, 0.2, 'Bureau', { layer: 'A' });
  const d = await parseDxf(w.toString());
  const p = packUnderlay(d, { ents: true });
  assert.equal(p.bytes[0], 3); assert.equal(p.meta.ents, 4); assert.deepEqual(p.meta.entTypes.slice().sort(), ['INSERT', 'LINE', 'TEXT']);
  const u = unpackUnderlay(p.meta, p.bytes);
  assert.equal(u.segEnt.length, u.segLayer.length);
  // chaque segment déballé retrouve la poignée de son entité dans le CadDoc
  const want = new Set([...d.segEnt].map(i => d.entHandle[i])), got = new Set([...u.segEnt].map(i => u.entHandle[i]));
  assert.deepEqual([...got].sort(), [...want].sort());
  const lines = [...u.segEnt].filter(i => u.entTypes[u.entType[i]] === 'LINE');
  assert.equal(new Set(lines).size, 2, 'deux LINE jointives restent deux entités');
  assert.equal(u.entTypes[u.entType[u.texts[0].ent]], 'TEXT');
  const v1 = packUnderlay(d, {}); assert.equal(v1.bytes[0], 1);
  const u1 = unpackUnderlay(v1.meta, v1.bytes); assert.equal(u1.segEnt, undefined); assert.equal(u1.segLayer.length, u.segLayer.length);
  assert.ok(v1.bytes.length < p.bytes.length);
});

test('format v2 (ancien) toujours lisible', () => {
  // v2 : 1 suite (calque 0, couleur 0), 1 polyligne de 2 points (entité 0) ; 0 texte ; 0 triangle ; table : poignée 0x101, type 0, calque 0
  const b = Uint8Array.from([2, 1, 0, 0, 1, 2, 0, 0, 0, 0xd0, 0x0f, 0, 0, 0, 1, 0x82, 0x02, 0, 0]);
  const u = unpackUnderlay({ step: 0.001, segs: 1, entTypes: ['LINE'], layers: [{ id: 0, name: 'A', color: '#ffffff' }] }, b);
  assert.deepEqual([...u.segs].map(v => +v.toFixed(3)), [0, 0, 1, 0]);
  assert.equal(u.entHandle[0], 0x101); assert.equal(u.entTypes[u.entType[u.segEnt[0]]], 'LINE');
});
