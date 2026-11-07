// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Ce qui commande un moteur (drive.js) et le code généré pour chaque cas : node --test src/sim/drive.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARDS, boardOf } from './boards.js';
import { PARTS, partOf } from './parts.js';
import { analyze, inspect } from './circuit.js';
import { driveOf, driveBoard } from './drive.js';
import { generate } from '../prog/rules.js';

const LEGS = { npn: ['C', 'B', 'E'], bat9v: ['+', '-'] };
const keys = type => (BOARDS[type] ? [...Object.keys(BOARDS[type].gpio), ...Object.keys(BOARDS[type].power), 'GND', 'GND (2)', 'GND (3)'] : /^res-/.test(type) ? ['1', '2'] : LEGS[type] || PARTS[type].pins.map(p => p.pin));
function build(parts, links) {
  const comps = parts.map(([type, id]) => ({ id, type, name: id, pins: Object.fromEntries(keys(type).map(k => [k, {}])), inp: {} }));
  const by = Object.fromEntries(comps.map(c => [c.id, c]));
  const wires = links.map(([a, ka, b, kb]) => ({ a: { comp: by[a], key: ka }, b: { comp: by[b], key: kb }, progress: 1 }));
  const A = analyze(comps, wires), cache = new Map(), insp = c => cache.get(c) || (cache.set(c, inspect(c, A, partOf(c))), cache.get(c));
  return { comps, by, A, insp, code: (rules, states = {}) => generate(by.U, { comps, A, inspect: insp, rules, states }) };
}
const rule = (comp, act, arg) => ({ id: 'r1', src: null, op: 'always', then: [{ kind: 'act', comp, act, arg }], else: [] });

test('Ventilateur par un transistor : base sur D9 (PWM), code analogWrite', () => {
  const m = build([['uno', 'U'], ['bat9v', 'P'], ['fan', 'F'], ['npn', 'Q'], ['res-1k', 'R']],
    [['P', '+', 'F', '+'], ['F', '-', 'Q', 'C'], ['Q', 'E', 'U', 'GND'], ['P', '-', 'U', 'GND (2)'], ['U', 'D9', 'R', '1'], ['R', '2', 'Q', 'B']]);
  const d = driveOf(m.by.F, m.A);
  assert.equal(d.kind, 'npn'); assert.equal(d.npn, m.by.Q); assert.equal(d.gpio.key, 'D9');
  assert.equal(driveBoard(m.by.F, m.A, m.insp), m.by.U);
  const code = m.code([rule('F', 'speed', 60)]);
  assert.match(code, /pinMode\(Q, OUTPUT\)/);
  assert.match(code, /analogWrite\(Q, 153\)/);
  assert.match(m.code([rule('F', 'stop')]), /digitalWrite\(Q, LOW\)/);
});

test('Pompe par un relais (contact NO) : LOW sur IN la fait tourner', () => {
  const m = build([['uno', 'U'], ['bat9v', 'P'], ['pump', 'M'], ['relay', 'K']],
    [['U', '5V', 'K', 'VCC'], ['U', 'GND', 'K', 'GND'], ['U', 'D7', 'K', 'IN'], ['P', '+', 'K', 'COM'], ['K', 'NO', 'M', '+'], ['M', '-', 'P', '-']]);
  const d = driveOf(m.by.M, m.A);
  assert.equal(d.kind, 'relay'); assert.equal(d.contact, 'NO'); assert.equal(d.gpio.key, 'D7');
  const code = m.code([rule('M', 'on')]);
  assert.match(code, /const int K = 7;/, 'le relais garde un nom court malgré ses contacts');
  assert.match(code, /digitalWrite\(K, LOW\);/);
});

test('Moteur sur L298N : sorties d’une même voie ; sur une pile seule : rien à commander', () => {
  const m = build([['uno', 'U'], ['l298n', 'D'], ['dcmotor', 'M'], ['bat9v', 'P']],
    [['D', 'OUT3', 'M', 'M-'], ['D', 'OUT4', 'M', 'M+'], ['U', 'D5', 'D', 'IN3'], ['U', 'D6', 'D', 'IN4'], ['P', '+', 'D', '+12V'], ['P', '-', 'D', 'GND'], ['D', 'GND', 'U', 'GND']]);
  const d = driveOf(m.by.M, m.A);
  assert.equal(d.kind, 'l298n'); assert.deepEqual(d.keys, ['IN3', 'IN4', 'ENB']); assert.equal(d.plusFirst, false);
  const p = build([['uno', 'U'], ['bat9v', 'P'], ['vibro', 'V']], [['P', '+', 'V', '+'], ['V', '-', 'P', '-']]);
  assert.equal(driveOf(p.by.V, p.A).kind, 'direct');
  assert.equal(driveOf(p.by.U, p.A), null, 'une carte n’est pas un moteur');
});
