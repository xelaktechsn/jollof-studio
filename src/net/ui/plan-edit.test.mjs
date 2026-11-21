// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de l'édition des plans (plan-edit.js) : copier-coller entre étages, alignement, répartition, changement d'étage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copySel, pasteClip, alignSel, moveToFloor } from './plan-edit.js';
import { cleanNet } from '../clean.js';
import { addDevice } from './plan-demo.js';

const model = () => cleanNet({
  site: { buildings: [{ id: 'B', floors: [{ id: 'F0', level: 0, walls: [{ id: 'w1', a: [0, 0], b: [4, 0] }], doors: [{ id: 'd1', wall: 'w1', at: 2, w: 0.9 }], rooms: [{ id: 'r1', name: 'A', poly: [[0, 0], [4, 0], [4, 3], [0, 3]] }] }, { id: 'F1', level: 1 }] }] },
  paths: [{ id: 'pa1', floor: 'F0', kind: 'tray', pts: [[0, 1], [4, 1]] }],
  devices: [{ id: 'pr1', type: 'outlet', name: 'PR1', loc: { floor: 'F0', x: 1, y: 2 } }, { id: 'pr2', type: 'outlet', name: 'PR2', loc: { floor: 'F0', x: 3, y: 2.4 } }, { id: 'pb1', type: 'patch', name: 'PB1' }],
  cables: [{ id: 'c1', a: ['pb1', 'b1'], b: ['pr1', 'back'] }]
});
const floorOf = (d, id) => d.site.buildings[0].floors.find(f => f.id === id);
const sel = [{ kind: 'dev', id: 'pr1' }, { kind: 'room', id: 'r1' }, { kind: 'wall', id: 'w1' }, { kind: 'path', id: 'pa1' }];

test('copier-coller vers un autre étage : nouveaux ids, porte suivie, aucun câble recopié', () => {
  const d = model(), F0 = floorOf(d, 'F0'), F1 = floorOf(d, 'F1'), c = copySel(d, F0, sel);
  assert.deepEqual(c.box, [0, 0, 4, 3]);
  const out = pasteClip(d, F1, c, 0, 0, (type, at) => addDevice(d, type, at, null));
  assert.equal(out.length, 4); assert.equal(F1.walls.length, 1); assert.equal(F1.doors.length, 1); assert.equal(F1.doors[0].wall, F1.walls[0].id);
  assert.notEqual(F1.walls[0].id, 'w1'); assert.notEqual(F1.rooms[0].id, 'r1');
  const dv = d.devices.find(x => x.id === out.find(o => o.kind === 'dev').id);
  assert.equal(dv.loc.floor, 'F1'); assert.notEqual(dv.id, 'pr1'); assert.equal(d.cables.length, 1, 'le câble n’est pas recopié');
  assert.ok(d.paths.some(p => p.floor === 'F1' && p.id !== 'pa1'));
  const ids = [...F0.walls, ...F1.walls, ...F0.rooms, ...F1.rooms, ...F0.doors, ...F1.doors].map(x => x.id);
  assert.equal(new Set(ids).size, ids.length, 'ids uniques dans tout le site');
  assert.deepEqual(cleanNet(cleanNet(d)), cleanNet(d));
});

test('coller sur le même étage avec un décalage ; rien à copier', () => {
  const d = model(), F0 = floorOf(d, 'F0');
  pasteClip(d, F0, copySel(d, F0, [{ kind: 'room', id: 'r1' }]), 0.5, 0.5, () => null);
  assert.deepEqual(F0.rooms[1].poly[0], [0.5, 0.5]);
  assert.equal(copySel(d, F0, [{ kind: 'dev', id: 'pb1' }]), null, 'équipement sans place sur l’étage');
});

test('aligner, répartir, changer d’étage', () => {
  const d = model(), F0 = floorOf(d, 'F0'), F1 = floorOf(d, 'F1');
  const two = [{ kind: 'dev', id: 'pr1' }, { kind: 'dev', id: 'pr2' }];
  assert.equal(alignSel(d, F0, two, 'top'), 1); assert.equal(d.devices.find(x => x.id === 'pr2').loc.y, 2);
  addDevice(d, 'outlet', { x: 0, y: 0 }, { floor: 'F0', x: 10, y: 2, h: 0.3 });
  const three = [...two, { kind: 'dev', id: d.devices[d.devices.length - 1].id }];
  alignSel(d, F0, three, 'hdist'); assert.equal(d.devices.find(x => x.id === 'pr2').loc.x, 5.5);
  assert.equal(alignSel(d, F0, [two[0]], 'left'), 0, 'un seul objet : rien');
  const n = moveToFloor(d, F0, F1, [{ kind: 'wall', id: 'w1' }, { kind: 'dev', id: 'pr1' }, { kind: 'path', id: 'pa1' }]);
  assert.equal(n, 4, 'mur, sa porte, prise, cheminement'); assert.equal(F1.walls[0].id, 'w1'); assert.equal(F1.doors[0].id, 'd1'); assert.equal(F0.walls.length, 0);
  assert.equal(d.devices.find(x => x.id === 'pr1').loc.floor, 'F1');
});
