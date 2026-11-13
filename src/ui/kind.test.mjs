// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Type de projet : plans de travail montrés, type déduit d'un projet d'avant les types. node --test src/ui/kind.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KINDS, KIND_IDS, spacesOf, inferKind } from './kind.js';

const read = f => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), 'utf8'));
test('seul l’électropneumatique réunit deux plans de travail', () => {
  assert.deepEqual(KIND_IDS.filter(k => spacesOf(k).length > 1), ['epneu']);
  assert.deepEqual(spacesOf('epneu'), ['elec', 'pneu']);
  assert.deepEqual(spacesOf('pneu'), ['pneu']);
  assert.deepEqual(spacesOf('inconnu'), ['elec']);
  for (const k of KIND_IDS) assert.ok(KINDS[k].name() && KINDS[k].text() && KINDS[k].icon, k);
});
test('type déclaré gardé, sinon déduit du contenu', () => {
  const pneu = { circuit: { elements: [{ id: 'e1', type: 'supply' }] } }, logic = { circuit: { elements: [{ id: 'g1', type: 'and' }] } };
  assert.equal(inferKind({ comps: [], settings: { kind: 'analog' } }), 'analog');
  assert.equal(inferKind({ comps: [{}], settings: { kind: 'bidon', modules: { pneu } } }), 'epneu');
  assert.equal(inferKind({ comps: [], settings: { modules: { pneu } } }), 'pneu');
  assert.equal(inferKind({ comps: [], settings: { modules: { logic } } }), 'logic');
  assert.equal(inferKind({ comps: [{}], settings: { modules: { logic } } }), 'elec');
  assert.equal(inferKind({ comps: [{}] }), 'elec');
  assert.equal(inferKind(null), 'elec');
});
test('exemple 08 et TP : électropneumatique avec une carte, pneumatique sans', () => {
  assert.equal(inferKind(read('../../exemples/08-verin-electropneumatique.jollof')), 'epneu');
  assert.equal(inferKind(read('../lab/pneu/pn05-porte-electropneumatique.json').start), 'epneu');
  assert.equal(inferKind(read('../lab/pneu/pn00-tutoriel-electropneumatique.json').start), 'epneu');
  assert.equal(inferKind(read('../lab/tp/tp01-led-bouton.json').start), 'elec');
});
