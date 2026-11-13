// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Repères qui relient le plan pneumatique au montage : node --test src/pneu/links.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tagsOf } from './links.js';
import { clean } from './clean.js';

test('tutoriel : Y1 (bobine du 5/2), B1 et B2 (capteurs du vérin), dans l’ordre du plan', () => {
  const tp = JSON.parse(fs.readFileSync(new URL('../lab/pneu/pn00-tutoriel-electropneumatique.json', import.meta.url), 'utf8'));
  const plan = clean(tp.solution.project.settings.modules.pneu.circuit);
  assert.deepEqual(tagsOf(plan).map(t => [t.name, t.kind, t.type]), [['Y1', 'coil', 'coil24'], ['B1', 'sensor', 'cylsensor'], ['B2', 'sensor', 'cylsensor']]);
});
test('seules les commandes électriques comptent ; un repère n’apparaît qu’une fois (sans la casse)', () => {
  const c = clean({ elements: [
    { id: 'a', type: 'v52', x: 0, y: 0, p: { left: 'push', right: 'spring', coilL: 'Y9' } }, // bouton poussoir : pas de bobine
    { id: 'b', type: 'v53', x: 0, y: 10, p: { left: 'sol', right: 'sol', coilL: '1Y1', coilR: '1Y2', center: 'closed' } },
    { id: 'c', type: 'v32', x: 0, y: 20, p: { act: 'sol', normal: 'nc', coil: '1y1' } }, // même repère, autre casse
    { id: 'd', type: 'pswitch', x: 0, y: 30, p: { sensor: 'S1', bar: 3 } },
    { id: 'e', type: 'cyl1', x: 0, y: 40, p: { s0: '', s1: 'B4' } }
  ], tubes: [] });
  assert.deepEqual(tagsOf(c).map(t => `${t.name}:${t.type}:${t.el}`), ['1Y1:coil24:b', '1Y2:coil24:b', 'S1:pressostat:d', 'B4:cylsensor:e']);
  assert.deepEqual(tagsOf({ elements: [], tubes: [] }), []);
});
