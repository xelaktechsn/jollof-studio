// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mode examen du plan réseau (exam.js) : drapeau gardé par cleanNet, verrou pendant une séance, champ « exam » des TP.
// node --test src/net/exam.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isExam, examLocked, examTpError } from './exam.js';
import { cleanNet } from './clean.js';

test('drapeau exam : gardé seulement s’il vaut true, stable au nettoyage', () => {
  const a = cleanNet({ exam: true, devices: [], cables: [] });
  assert.equal(a.exam, true); assert.ok(isExam(a));
  assert.deepEqual(cleanNet(a), a, 'idempotent');
  for (const bad of ['true', 1, {}, null, false]) assert.equal('exam' in cleanNet({ exam: bad }), false, JSON.stringify(bad));
  assert.equal(isExam(null), false); assert.equal(isExam({}), false);
});

test('verrou : pas de changement pendant une séance (TP, devoir, copie)', () => {
  assert.equal(examLocked(null), false);
  assert.equal(examLocked({ current: null }), false);
  assert.equal(examLocked({ current: { kind: 'assignment' } }), true);
});

test('champ exam d’un TP : booléen, et le plan réseau du départ (et de la solution) le porte', () => {
  const net = exam => ({ settings: { modules: { net: { devices: [], cables: [], ...(exam ? { exam: true } : {}) } } } });
  assert.equal(examTpError({ start: net(false) }), null, 'pas de champ : rien à vérifier');
  assert.equal(examTpError({ exam: true, start: net(true), solution: { project: net(true) } }), null);
  assert.equal(examTpError({ exam: false, start: net(false) }), null);
  assert.match(examTpError({ exam: 'oui', start: net(true) }), /true ou false/);
  assert.match(examTpError({ exam: true, start: net(false) }), /départ/);
  assert.match(examTpError({ exam: true, start: net(true), solution: { project: net(false) } }), /solution/);
  assert.match(examTpError({ exam: false, start: net(true) }), /départ a exam: true/);
  assert.match(examTpError({ exam: true, start: {} }), /départ/);
});
