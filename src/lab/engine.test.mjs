// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du moteur de TP : node --test src/lab/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BOARDS } from '../sim/boards.js';
import { PARTS } from '../sim/parts.js';
import { analyze, bbGroups } from '../sim/circuit.js';
import { checkWire, checkQuiz, checkCode, checkParts, checkWired, checkPneuParts, checkPneuTube, checkGrafcet, checkUiState, observePneu } from './engine.js';
import { clean as cleanPneu } from '../pneu/clean.js';
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

/* ---------- Tutoriel électropneumatique : contrôles qui ne dépendent d'aucun identifiant ---------- */
const tuto = JSON.parse(fs.readFileSync(new URL('./pneu/pn00-tutoriel-electropneumatique.json', import.meta.url), 'utf8'));
const proj = tuto.solution.project, checkOf = type => tuto.steps.find(s => s.check && s.check.type === type).check;
const fullKeys = c => (BOARDS[c.type] ? [...Object.keys(BOARDS[c.type].gpio), ...Object.keys(BOARDS[c.type].power), 'GND', 'GND (2)', 'GND (3)', 'VIN', 'AREF', 'IOREF'] : /^breadboard/.test(c.type) ? bbGroups(c).flatMap(g => g.keys) : /^res-/.test(c.type) ? ['1', '2'] : c.type === 'psu24' ? ['+', '-'] : (PARTS[c.type] && PARTS[c.type].pins ? PARTS[c.type].pins.map(p => p.pin) : ['A', 'K']));
function bench(compsIn, wiresIn) {
  const comps = compsIn.map(c => ({ ...c, pins: Object.fromEntries(fullKeys(c).map(k => [k, {}])), inp: {} })), by = Object.fromEntries(comps.map(c => [c.id, c]));
  const A = analyze(comps, wiresIn.map(w => ({ a: { comp: by[w.a[0]], key: w.a[1] }, b: { comp: by[w.b[0]], key: w.b[1] }, progress: 1 })));
  return { comps: () => comps, analyze: () => A };
}
const plan = cleanPneu(proj.settings.modules.pneu.circuit);
test('tutoriel : composants du montage, par type et repère (sans la casse)', () => {
  const c = checkOf('parts');
  assert.ok(checkParts(c, bench(proj.comps, [])).ok);
  const r = checkParts(c, bench(proj.comps.filter(x => x.name !== 'B2'), []));
  assert.equal(r.ok, false); assert.deepEqual(r.missing.map(m => m.name), ['B2']);
  // Un capteur nommé autrement ne compte pas pour B1 : chaque besoin prend un composant différent.
  const renamed = proj.comps.map(x => (x.name === 'B1' ? { ...x, name: 'B7' } : x));
  assert.deepEqual(checkParts(c, bench(renamed, [])).missing.map(m => m.name), ['B1']);
  assert.ok(checkParts(c, bench(proj.comps.map(x => (x.name === 'Y1' ? { ...x, name: 'y1' } : x)), [])).ok);
});
test('tutoriel : câblage terminé (rien à câbler, aucune erreur), sinon les repères en cause', () => {
  assert.ok(checkWired({}, bench(proj.comps, proj.wires)).ok);
  const r = checkWired({}, bench(proj.comps, proj.wires.filter(w => !proj.comps.some(c => c.name === 'B2' && (w.a[0] === c.id || w.b[0] === c.id)))));
  assert.equal(r.ok, false); assert.deepEqual(r.unwired, ['B2']);
  assert.equal(checkWired({}, bench([], [])).why, 'empty');
});
test('tutoriel : éléments du plan et réglages, tuyaux désignés par type (~v52:4)', () => {
  const env = { pneu: () => plan };
  assert.ok(checkPneuParts(checkOf('pneu-parts'), env).ok);
  const off = cleanPneu({ ...plan, elements: plan.elements.map(e => (e.type === 'cyl2' ? { ...e, p: { ...e.p, label: '' } } : e)) });
  const r = checkPneuParts(checkOf('pneu-parts'), { pneu: () => off });
  assert.equal(r.ok, false); assert.deepEqual(r.wrong[0].diff, ['label']);
  assert.ok(checkPneuTube(checkOf('pneu-tube'), env).ok);
  const swapped = { ...plan, tubes: plan.tubes.map(t => (t.a[1] === '4' ? { ...t, a: [t.a[0], '2'] } : t.a[1] === '2' && t.a[0] === 'e2' ? { ...t, a: [t.a[0], '4'] } : t)) };
  assert.equal(checkPneuTube(checkOf('pneu-tube'), { pneu: () => swapped }).ok, false);
});
test('tutoriel : GRAFCET (sorties, variables lues, erreurs) et état de l’interface', () => {
  const c = checkOf('grafcet');
  assert.ok(checkGrafcet(c, { pneu: () => plan }).ok);
  assert.equal(checkGrafcet(c, { pneu: () => ({ ...plan, grafcet: null }) }).why, 'empty');
  const noY = { ...plan.grafcet, steps: plan.grafcet.steps.map(s => (s.n === 1 ? { ...s, act: 'Y2' } : s)) };
  assert.deepEqual(checkGrafcet(c, { pneu: () => ({ ...plan, grafcet: noY }) }), { ok: false, why: 'outputs', names: ['Y1'] });
  const bad = { ...plan.grafcet, steps: plan.grafcet.steps.map(s => (s.n === 0 ? { ...s, r: 'BTN1 . (' } : s)) };
  assert.equal(checkGrafcet(c, { pneu: () => ({ ...plan, grafcet: bad }) }).why, 'errors');
  assert.deepEqual(checkUiState({ need: ['sim', 'split'] }, { ui: n => n === 'sim' }), { ok: false, missing: ['split'] });
});
test('observation d’un vérin par son repère (1A) aussi bien que par son identifiant', () => {
  const env = { pneu: () => plan, pneuState: () => ({ x: { e3: 1 } }) };
  assert.equal(observePneu(env, '1A'), 'out');
  assert.equal(observePneu(env, 'e3'), 'out');
  assert.equal(observePneu(env, '2A'), null);
});
