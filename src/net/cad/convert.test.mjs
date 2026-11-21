// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de la conversion DAO → modèle (convert.js) sur des dessins synthétiques fabriqués ici (aucun fichier réel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertCad, convertSelection, pairWalls, mergeWalls, cleanCorners, clusters, guessUsage, guessBlockType, applyConversion, removeConverted, blocksIn, TEXT_PATTERNS } from './convert.js';
import { cleanSite, roomArea, siteIds, uid } from '../site.js';
import { cleanNet } from '../clean.js';
import { addDevice } from '../ui/plan-demo.js';

// Dessin en millimètres, y vers le haut (comme un DXF) : un bâtiment 10 × 6 m à murs doubles (20 cm), une cloison double
// (10 cm) à x = 4 m percée d'une porte (1 m, de y = 2 à 3 m) avec son battant et son arc, des textes, un bloc de prise,
// une goulotte électrique de 8 m.
const L = { MURS: 1, CLOISONS: 2, PORTES: 3, TEXTES: 4, ELEC: 5, PRISES: 6 };
function fakeDoc() {
  const S = [], lay = [];
  const seg = (l, ax, ay, bx, by) => { S.push(ax, ay, bx, by); lay.push(l); };
  const rect = (l, x0, y0, x1, y1) => { seg(l, x0, y0, x1, y0); seg(l, x1, y0, x1, y1); seg(l, x1, y1, x0, y1); seg(l, x0, y1, x0, y0); };
  rect(L.MURS, -100, -100, 10100, 6100); rect(L.MURS, 100, 100, 9900, 5900); // faces extérieure et intérieure
  // Cloison double à x = 3950 / 4050, ouverte entre y = 2000 et 3000 (porte).
  seg(L.CLOISONS, 3950, 100, 3950, 2000); seg(L.CLOISONS, 4050, 100, 4050, 2000);
  seg(L.CLOISONS, 3950, 3000, 3950, 5900); seg(L.CLOISONS, 4050, 3000, 4050, 5900);
  // Porte : battant (charnière en 4000, 2000, ouvert à 90°) et arc en segments.
  seg(L.PORTES, 4000, 2000, 5000, 2000);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI / 2, b = ((i + 1) / 8) * Math.PI / 2; seg(L.PORTES, 4000 + 1000 * Math.cos(a), 2000 + 1000 * Math.sin(a), 4000 + 1000 * Math.cos(b), 2000 + 1000 * Math.sin(b)); }
  // Goulotte électrique en trois morceaux reliés.
  seg(L.ELEC, 500, 5500, 3000, 5500); seg(L.ELEC, 3000, 5500, 6000, 5500); seg(L.ELEC, 6000, 5500, 8500, 5500);
  // Petit symbole électrique isolé (moins de 2 m) : ignoré.
  seg(L.ELEC, 9000, 1000, 9200, 1000);
  const n = lay.length;
  return {
    units: 'mm', toMetre: 0.001, origin: [0, 0], extents: [-100, -100, 10100, 6100],
    layers: Object.entries(L).map(([name, id]) => ({ id, name, color: '#888888' })),
    segs: Float32Array.from(S), segLayer: Uint16Array.from(lay), segKind: new Uint8Array(n), segColor: new Uint16Array(n), palette: ['#000000'],
    texts: [{ x: 2000, y: 3000, h: 250, text: 'Bureau 12', layer: L.TEXTES }, { x: 2000, y: 2600, h: 120, text: '23,5 m²', layer: L.TEXTES }, { x: 7000, y: 3000, h: 250, text: 'Salle de réunion', layer: L.TEXTES }, { x: 8000, y: 1000, h: 150, text: 'WIFI 2', layer: L.PRISES }],
    inserts: [{ name: 'PRISE RJ45 DOUBLE', x: 1000, y: 500, rot: 0, sx: 1, sy: 1, layer: L.PRISES, attribs: {} }, { name: 'CHAISE', x: 2000, y: 2000, rot: 0, sx: 1, sy: 1, layer: L.PRISES, attribs: {} }],
    fills: null, clusters: []
  };
}
const OPTS = doc => ({ region: [-200, -200, 10200, 6200], layers: new Set(Object.values(L)), toMetre: 0.001, kinds: { [L.MURS]: 'walls', [L.CLOISONS]: 'partitions', [L.PORTES]: 'doors', [L.TEXTES]: 'text', [L.ELEC]: 'cfo', [L.PRISES]: 'other' }, blocks: Object.fromEntries(blocksIn(doc, [-200, -200, 10200, 6200], new Set(Object.values(L))).filter(b => b.guess).map(b => [b.name, b.guess])), texts: TEXT_PATTERNS });

test('murs doubles → axes avec épaisseur, porte qui relie la cloison, pièces nommées, goulotte, équipements', () => {
  const doc = fakeDoc(), c = convertCad(doc, OPTS(doc));
  const thick = c.walls.filter(w => w.t === 0.2), thin = c.walls.filter(w => w.t === 0.1);
  assert.equal(thick.length, 4, 'quatre murs extérieurs de 20 cm'); assert.equal(thin.length, 1, 'la cloison, d’un seul tenant à travers la porte');
  assert.ok(thick.every(w => w.mat === 'block') && thin[0].mat === 'drywall');
  // Repère de l'étage : y vers le bas, (0, 0) au coin haut gauche de la zone (−200, 6200 mm).
  const part = thin[0]; assert.ok(Math.abs(part.a[0] - 4.2) < 1e-6 && Math.abs(part.b[0] - 4.2) < 1e-6);
    assert.equal(c.doors.length, 1); assert.equal(c.doors[0].wall, part); assert.ok(Math.abs(c.doors[0].w - 1) < 0.05, 'largeur 1 m');
  const rooms = c.rooms.map(r => [r.name, r.usage, Math.round(roomArea(r))]).sort();
  assert.deepEqual(rooms, [['Bureau 12', 'office', 24], ['Salle de réunion', 'meeting', 36]]);
  assert.equal(c.paths.length, 1); assert.ok(c.paths[0].power); assert.equal(c.paths[0].pts.length, 4);
  assert.deepEqual(c.devices.map(d => d.type).sort(), ['ap', 'outlet2']);
});

test('reprise : une deuxième conversion du même fond remplace la première (rien en double), en une seule fois', () => {
  const doc = fakeDoc(), data = cleanNet({ site: { buildings: [{ id: 'B', floors: [{ id: 'F', level: 0 }] }] } }), f = data.site.buildings[0].floors[0];
  f.walls.push({ id: 'mine', a: [0, 20], b: [5, 20], t: 0.2, mat: 'block' });
  const h = { uid: p => uid('', p, siteIds(data.site)), pathId: () => 'pa' + (data.paths.length + 1) + Math.random().toString(36).slice(2, 5), newDevice: (type, d) => addDevice(data, type, { x: d.x * 20, y: d.y * 20 }, null) };
  const n1 = applyConversion(data, f, convertCad(doc, OPTS(doc)), 'cad:U1', h);
  assert.deepEqual(n1, { walls: 5, doors: 1, rooms: 2, paths: 1, devices: 2 });
  const again = applyConversion(data, f, convertCad(doc, { ...OPTS(doc), floor: f, tag: 'cad:U1' }), 'cad:U1', h);
  assert.deepEqual(again, n1);
  assert.equal(f.walls.length, 6, 'mon mur reste, ceux de la conversion ne sont pas doublés'); assert.equal(f.rooms.length, 2);
  assert.equal(data.devices.length, 2); assert.equal(data.paths.length, 1);
  const clean = cleanNet(data); assert.deepEqual(cleanNet(clean), clean, 'étiquettes src gardées et stables');
  assert.ok(clean.site.buildings[0].floors[0].walls.filter(w => w.src === 'cad:U1').length === 5 && clean.devices.every(d => d.src === 'cad:U1'));
  removeConverted(data, f, 'cad:U1');
  assert.equal(f.walls.length, 1); assert.equal(f.rooms.length, 0); assert.equal(data.devices.length, 0); assert.equal(data.paths.length, 0);
});

test('appariement des traits : écart, recouvrement, angle ; fusion à travers une porte seulement', () => {
  const s = [[0, 0, 5, 0, 1], [0, 0.2, 5, 0.2, 1], [0, 3, 5, 3, 1], [0, 3.9, 5, 3.9, 1], [10, 0, 10.4, 0, 1]];
  const w = pairWalls(s);
  assert.equal(w.filter(x => x.t === 0.2).length, 1, '20 cm : un mur'); assert.equal(w.filter(x => x.t !== 0.2).length, 2, '90 cm : deux traits seuls ; 40 cm : retour ignoré');
  const m = mergeWalls([{ a: [0, 0], b: [2, 0], t: 0.1 }, { a: [3, 0], b: [5, 0], t: 0.1 }]);
  assert.equal(m.length, 2, 'une baie sans porte reste ouverte');
  assert.equal(mergeWalls([{ a: [0, 0], b: [2, 0], t: 0.1 }, { a: [3, 0], b: [5, 0], t: 0.1 }], [[2.5, 0.3, 1]]).length, 1);
  assert.equal(clusters([[0, 0, 1, 0], [1, 0, 1, 1], [5, 5, 6, 5]]).length, 2);
  const cc = cleanCorners([{ a: [-0.1, 0], b: [5, 0], t: 0.2 }, { a: [0, -0.1], b: [0, 4], t: 0.2 }]);
  assert.deepEqual(cc.map(w => w.a), [[0, 0], [0, 0]], 'débords d’une demi-épaisseur ramenés au croisement des axes');
});

test('usages et blocs devinés', () => {
  assert.equal(guessUsage('Local technique 2'), 'tr'); assert.equal(guessUsage('LT3'), 'tr'); assert.equal(guessUsage('WC hommes'), 'sanitary');
  assert.equal(guessUsage('Circulation'), 'corridor'); assert.equal(guessUsage('Salle de classe 5'), 'classroom'); assert.equal(guessUsage('Réserve'), 'storage');
  assert.equal(guessUsage('Bureau du directeur'), 'office'); assert.equal(guessUsage('Gaine'), 'shaft'); assert.equal(guessUsage('XYZ'), null);
  assert.equal(guessBlockType('Borne WIFI plafond'), 'ap'); assert.equal(guessBlockType('PRISE_RJ45'), 'outlet'); assert.equal(guessBlockType('caméra dôme'), 'camera'); assert.equal(guessBlockType('Lavabo'), null);
});

test('battants dessinés en arcs sur un calque d’architecture, conversion d’une sélection du fond', async () => {
  const { KINDS } = await import('./dxf.js');
  const doc = fakeDoc(), ARC = KINDS.indexOf('arc');
  // Les traits de la porte passent sur le calque des cloisons, l'arc marqué comme arc, sans battant.
  for (let i = 0; i < doc.segLayer.length; i++) if (doc.segLayer[i] === L.PORTES) { doc.segLayer[i] = L.CLOISONS; doc.segKind[i] = ARC; }
  const c = convertCad(doc, OPTS(doc));
  assert.equal(c.doors.length, 1, 'porte trouvée par son arc');
  assert.equal(c.walls.filter(w => w.t === 0.1 && Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > 2).length, 1, 'la cloison reste d’un seul tenant (le battant isolé devient un trait mince)');
  // Sélection : quatre traits doubles d'un local 3 × 2 m → murs ; puis pièce ; puis une goulotte.
  const data = cleanNet({ site: { buildings: [{ id: 'B', floors: [{ id: 'F', level: 0 }] }] } }), f = data.site.buildings[0].floors[0];
  let commits = 0; const ctx = { data: () => data, commit: () => commits++ };
  const box = (x0, y0, x1, y1) => [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]];
  const n = convertSelection(ctx, f, [...box(0, 0, 3, 2), ...box(0.2, 0.2, 2.8, 1.8)], 'walls');
  assert.equal(n.walls, 4); assert.equal(commits, 1); assert.ok(f.walls.every(w => w.t === 0.2));
  assert.equal(convertSelection(ctx, f, [], 'rooms').rooms, 0);
  assert.equal(convertSelection(ctx, f, box(10, 0, 14, 3), 'rooms').rooms, 1);
  assert.equal(convertSelection(ctx, f, Float32Array.from([0, 5, 4, 5, 4, 5, 8, 5]), 'power').paths, 1);
  assert.ok(data.paths[0].power); assert.equal(commits, 3, 'une sélection vide n’enregistre rien');
});
