// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du moteur de TP : node --test src/lab/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BOARDS } from '../sim/boards.js';
import { PARTS } from '../sim/parts.js';
import { analyze, bbGroups } from '../sim/circuit.js';
import { checkWire, checkQuiz, checkCode } from './engine.js';
import { compile } from '../prog/lang.js';

const tp = JSON.parse(fs.readFileSync(new URL('./tp/tp01-led-bouton.json', import.meta.url), 'utf8'));
const keysOf = c => (BOARDS[c.type] ? [...Object.keys(BOARDS[c.type].gpio), ...Object.keys(BOARDS[c.type].power), 'GND', 'GND (2)', 'GND (3)'] : /^breadboard/.test(c.type) ? bbGroups(c).flatMap(g => g.keys) : /^res-/.test(c.type) ? ['1', '2'] : (PARTS[c.type] || { pins: [] }).pins.map(p => p.pin));
function env(wires) {
  const comps = tp.start.comps.map(c => ({ ...c, pins: Object.fromEntries(keysOf(c).map(k => [k, {}])), inp: {} }));
  const by = Object.fromEntries(comps.map(c => [c.id, c]));
  const ws = wires.map(([a, ka, b, kb]) => ({ a: { comp: by[a], key: ka }, b: { comp: by[b], key: kb }, progress: 1 }));
  const A = analyze(comps, ws);
  return { comps: () => comps, analyze: () => A };
}
const step3 = tp.steps[2].check; // D7 → R1 → LED1.A

test('résistance posée normalement : validé, dans les deux sens', () => {
  assert.ok(checkWire(step3, env([['uno_1', 'D7', 'res-220_1', '1'], ['res-220_1', '2', 'led-red_1', 'A']])).ok);
  assert.ok(checkWire(step3, env([['uno_1', 'D7', 'res-220_1', '2'], ['res-220_1', '1', 'led-red_1', 'A']])).ok);
});
test('deux fils sur la même patte (résistance contournée) : refusé', () => {
  const r = checkWire(step3, env([['uno_1', 'D7', 'res-220_1', '1'], ['res-220_1', '1', 'led-red_1', 'A']]));
  assert.equal(r.ok, false); assert.equal(r.missing[0].why, 'short');
});
test('rien de câblé : refusé', () => assert.equal(checkWire(step3, env([])).ok, false));
test('quiz', () => { assert.ok(checkQuiz({ answer: 1 }, 1).ok); assert.ok(!checkQuiz({ answer: 1 }, 0).ok); assert.ok(checkQuiz({ answer: [0, 2] }, [2, 0]).ok); });
test('programme : la solution passe, un programme vide ou incomplet échoue', () => {
  const c = tp.steps[4].check, e = code => ({ program: () => ({ code, kind: 'uno' }), compile: (s, k) => compile(s, { board: k }) });
  assert.ok(checkCode(c, e(tp.solution.code.UNO)).ok);
  assert.equal(checkCode(c, e('')).ok, false);
  assert.equal(checkCode(c, e('void setup(){ pinMode(7, OUTPUT); } void loop(){ digitalWrite(7, HIGH); }')).ok, false);
  assert.equal(checkCode(c, e('void setup() { pinMode(7, OUTPUT) } void loop() {}')).why, 'compile');
});
