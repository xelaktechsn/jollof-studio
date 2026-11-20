// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du site (src/net/site.js) : nettoyage tolérant et stable, géométrie. node --test src/net/site.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSite, cleanLoc, cleanImages, polyArea, polyPerimeter, centroid, inPoly, project, roomAt, floorOf, findSiteObj, siteIds, allFloors, MATERIALS, USAGES, isTechRoom, uid } from './site.js';
import { cleanNet } from './clean.js';

const SITE = {
  name: 'Campus', buildings: [{ id: 'B1', name: 'Siège', floors: [
    { id: 'F1', level: 1, height: 3.2, walls: [{ id: 'w1', a: [0, 0], b: [10, 0], mat: 'concrete' }], doors: [{ id: 'd1', wall: 'w1', at: 5, w: 0.9 }], rooms: [{ id: 'r1', name: 'Bureau 101', usage: 'office', poly: [[0, 0], [10, 0], [10, 5], [0, 5]] }] },
    { id: 'F0', level: 0, height: 4 }
  ] }]
};

test('cleanSite : tolère tout et rend une structure bornée', () => {
  for (const g of [null, 1, 'x', [], { buildings: 'x' }, { buildings: [null, 3, { floors: [null, { walls: [{ a: [0, 0], b: [0, 0] }, { a: 'x' }] }] }] }]) {
    const s = cleanSite(g); assert.ok(Array.isArray(s.buildings)); assert.equal(typeof s.name, 'string'); assert.equal(s.seg, 'b');
  }
  const s = cleanSite({ buildings: [{ floors: [{ walls: [{ a: [0, 0], b: [0, 0] }, { a: [0, 0], b: [3, 4], t: 99, mat: 'kryptonite' }] }] }] });
  const w = s.buildings[0].floors[0].walls;
  assert.equal(w.length, 1, 'mur de longueur nulle retiré');
  assert.equal(w[0].mat, 'block'); assert.equal(w[0].t, 2, 'épaisseur bornée');
});

test('cleanSite : étages rangés par niveau, altitudes empilées, ids uniques', () => {
  const s = cleanSite(SITE), f = s.buildings[0].floors;
  assert.deepEqual(f.map(x => x.id), ['F0', 'F1']);
  assert.equal(f[0].elev, 0); assert.equal(f[1].elev, 4, 'le niveau 1 commence en haut du rez-de-chaussée');
  assert.equal(f[1].doors[0].wall, 'w1');
  const dup = cleanSite({ buildings: [{ id: 'X', floors: [{ id: 'X', rooms: [{ id: 'X', poly: [[0, 0], [1, 0], [1, 1]] }] }] }] });
  const ids = [dup.buildings[0].id, dup.buildings[0].floors[0].id, dup.buildings[0].floors[0].rooms[0].id];
  assert.equal(new Set(ids).size, 3, 'un id par objet dans tout le site');
});

test('cleanSite est stable (idempotent) et passe par cleanNet', () => {
  const a = cleanSite(SITE), b = cleanSite(a);
  assert.deepEqual(b, a);
  const n = cleanNet({ site: SITE, devices: [{ id: 'o1', type: 'outlet', loc: { floor: 'F1', x: 2, y: 2 } }] });
  assert.deepEqual(n.devices[0].loc, { floor: 'F1', x: 2, y: 2, h: 0.3 });
  assert.deepEqual(cleanNet(n), n);
});

test('portes : sur un mur existant, position bornée', () => {
  const s = cleanSite({ buildings: [{ floors: [{ walls: [{ id: 'w', a: [0, 0], b: [4, 0] }], doors: [{ wall: 'w', at: 99, w: 1 }, { wall: 'nope', at: 1 }] }] }] });
  const d = s.buildings[0].floors[0].doors;
  assert.equal(d.length, 1); assert.equal(d[0].at, 3.5);
});

test('pièces : polygone d’au moins trois points, usage connu', () => {
  const s = cleanSite({ buildings: [{ floors: [{ rooms: [{ poly: [[0, 0], [1, 1]] }, { usage: 'lol', poly: [[0, 0], [2, 0], [2, 2], [0, 2]] }, { usage: 'tr', poly: [[0, 0], [1, 0], [1, 1], [0, 1]] }] }] }] });
  const r = s.buildings[0].floors[0].rooms;
  assert.equal(r.length, 2); assert.equal(r[0].usage, 'office'); assert.ok(isTechRoom(r[1])); assert.ok(!isTechRoom(r[0]));
});

test('cleanLoc et cleanImages', () => {
  assert.equal(cleanLoc(null), null); assert.equal(cleanLoc({ floor: 'a b', x: 1, y: 1 }), null); assert.equal(cleanLoc({ floor: 'F', x: 'q', y: 1 }), null);
  assert.deepEqual(cleanLoc({ floor: 'F', x: 1e9, y: -2, h: 99 }), { floor: 'F', x: 10000, y: -2, h: 30 });
  const im = cleanImages({ a: 'data:image/png;base64,iVBORw0KGgo=', b: 'javascript:alert(1)', c: 'data:image/svg+xml;base64,PHN2Zz4=', 'd e': 'data:image/png;base64,AA==' });
  assert.deepEqual(Object.keys(im), ['a']);
});

test('géométrie : aire, périmètre, centre, point dans un polygone, projection', () => {
  const sq = [[0, 0], [4, 0], [4, 3], [0, 3]];
  assert.equal(polyArea(sq), 12); assert.equal(polyPerimeter(sq), 14); assert.deepEqual(centroid(sq), [2, 1.5]);
  assert.ok(inPoly([1, 1], sq)); assert.ok(!inPoly([5, 1], sq));
  const L = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
  assert.ok(!inPoly([3, 3], L), 'pièce en L'); assert.equal(polyArea(L), 7);
  const p = project([2, 5], [0, 0], [4, 0]); assert.equal(p.t, 0.5); assert.equal(p.d, 5);
  assert.equal(project([9, 0], [0, 0], [4, 0]).t, 1);
});

test('recherche : étage, pièce sous un point, objet par id, ids pris', () => {
  const s = cleanSite(SITE);
  assert.equal(floorOf(s, 'F1').b.id, 'B1'); assert.equal(floorOf(s, 'zz'), null);
  assert.equal(roomAt(floorOf(s, 'F1').f, 3, 3).id, 'r1'); assert.equal(roomAt(floorOf(s, 'F1').f, 30, 3), null);
  assert.equal(findSiteObj(s, 'd1').kind, 'door'); assert.equal(findSiteObj(s, 'B1').kind, 'building');
  assert.ok(siteIds(s).has('w1')); assert.equal(allFloors(s).length, 2);
  const used = new Set(['w1']); assert.notEqual(uid('w1', 'w', used), 'w1');
  assert.ok(Object.keys(MATERIALS).includes('concrete') && Object.keys(USAGES).includes('tr'));
});

import { detectRooms, innerPoint, roomArea, inRoom, roomPoint, roomPath } from './site.js';
const Wl = (a, b) => ({ a, b });
const BOX = [Wl([0, 0], [10, 0]), Wl([10, 0], [10, 6]), Wl([10, 6], [0, 6]), Wl([0, 6], [0, 0])];
const areas = f => detectRooms(f).map(r => roomArea(r)).sort((a, b) => a - b);

test('détection des pièces : rectangle, cloison, jonctions en T', () => {
  assert.deepEqual(areas({ walls: BOX, rooms: [] }), [60]);
  assert.deepEqual(areas({ walls: [...BOX, Wl([4, 0], [4, 6])], rooms: [] }), [24, 36], 'une cloison de bout en bout');
  // Cloison qui dépasse de 10 cm (sous la tolérance) et cloison en T sur la première.
  assert.deepEqual(areas({ walls: [...BOX, Wl([4, 0], [4, 6.1]), Wl([4, 3], [10, 3])], rooms: [] }), [18, 18, 24]);
  // Deux murs qui se croisent au milieu : quatre pièces.
  assert.deepEqual(areas({ walls: [...BOX, Wl([5, 0], [5, 6]), Wl([0, 3], [10, 3])], rooms: [] }), [15, 15, 15, 15]);
});

test('détection des pièces : pièce en L, jours sous la tolérance, murs pendants, pièce déjà dessinée', () => {
  const L = [Wl([0, 0], [6, 0]), Wl([6, 0], [6, 3]), Wl([6, 3], [3, 3]), Wl([3, 3], [3, 6]), Wl([3, 6], [0, 6]), Wl([0, 6.1], [0, 0.05])];
  const r = detectRooms({ walls: L, rooms: [] });
  assert.equal(r.length, 1); assert.equal(r[0].poly.length, 6, 'six sommets'); assert.equal(polyArea(r[0].poly), 27);
  assert.ok(inPoly(innerPoint(r[0].poly), r[0].poly));
  assert.deepEqual(areas({ walls: [...BOX.slice(0, 3), Wl([0, 6], [0, 0.5])], rooms: [] }), [], 'jour de 50 cm : pas fermé');
  assert.deepEqual(areas({ walls: [...BOX, Wl([2, 2], [5, 2])], rooms: [] }), [60], 'mur pendant ignoré');
  assert.deepEqual(areas({ walls: [...BOX, Wl([4, 0], [4, 6])], rooms: [{ poly: [[0, 0], [4, 0], [4, 6], [0, 6]] }] }), [36], 'pièce déjà là');
  assert.deepEqual(detectRooms({ walls: BOX.slice(0, 2), rooms: [] }), []);
});

test('pièces à trous : cour au milieu du bâtiment, pièce enclavée, nettoyage stable', () => {
  const court = [Wl([4, 2], [6, 2]), Wl([6, 2], [6, 4]), Wl([6, 4], [4, 4]), Wl([4, 4], [4, 2])];
  const r = detectRooms({ walls: [...BOX, ...court], rooms: [] }).sort((a, b) => roomArea(b) - roomArea(a));
  assert.equal(r.length, 2, 'la pièce autour et la cour');
  assert.equal(r[0].holes.length, 1); assert.equal(roomArea(r[0]), 56); assert.equal(roomArea(r[1]), 4);
  assert.ok(!inRoom([5, 3], r[0]) && inRoom([1, 1], r[0]) && inRoom(roomPoint(r[0]), r[0]));
  assert.match(roomPath(r[0]), /Z.*M.*Z$/);
  // Pièce enclavée déjà dessinée : seule la pièce autour (avec son trou) est créée.
  const r2 = detectRooms({ walls: [...BOX, ...court], rooms: [{ poly: [[4, 2], [6, 2], [6, 4], [4, 4]] }] });
  assert.equal(r2.length, 1); assert.equal(roomArea(r2[0]), 56);
  // Deux pièces côte à côte dans le bâtiment, la cour dans la seconde.
  const r3 = detectRooms({ walls: [...BOX, Wl([3, 0], [3, 6]), ...court], rooms: [] }).map(x => [roomArea(x), (x.holes || []).length]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(r3, [[4, 0], [18, 0], [38, 1]]);
  const s = cleanSite({ buildings: [{ floors: [{ rooms: [{ id: 'a', poly: BOX.map(w => w.a), holes: [[[4, 2], [6, 2], [6, 4], [4, 4]], [[50, 50], [51, 50], [51, 51]], 'x'] }] }] }] });
  const room = s.buildings[0].floors[0].rooms[0];
  assert.equal(room.holes.length, 1, 'trou hors du contour ou illisible retiré'); assert.deepEqual(cleanSite(s), s);
  assert.equal(roomAt(s.buildings[0].floors[0], 5, 3), null, 'un point dans la cour n’est dans aucune pièce');
});
