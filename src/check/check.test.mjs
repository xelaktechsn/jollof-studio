// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du vérificateur (src/check) : node --test src/check/check.test.mjs
// Exemples et TP : aucune erreur (sauf le montage « à corriger ») ; cas typiques : chaque faute trouvée, avec l'état qui la déclenche.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadProject } from './load.js';
import { checkProject } from './check.js';
import { pinFacts } from './program.js';
import { BOARDS } from '../sim/boards.js';
import { CODES } from './codes.js';

const ROOT = new URL('../../', import.meta.url);
const read = p => JSON.parse(fs.readFileSync(new URL(p, ROOT), 'utf8'));
/** Petit projet : parts [[type, id]], fils [[a, ka, b, kb]], programme de la carte U. */
const project = (parts, links, code = null, allow = []) => loadProject({ comps: parts.map(([type, id]) => ({ id, type, name: id })), wires: links.map(([a, ka, b, kb]) => ({ a: [a, ka], b: [b, kb] })), settings: { check: { allow } } }, code ? { U: code } : null);
const codes = r => r.diags.map(d => `${d.level === 'error' ? 'E' : 'w'}:${d.code}`).sort();
const find = (r, code) => r.diags.find(d => d.code === code);
const prog = (setup, loop = '') => `void setup() { ${setup} }\nvoid loop() { ${loop} }\n`;

test('Exemples et TP : aucune erreur, prouvé dans tous les états ; « à corriger » : ses fautes exactes', () => {
  for (const f of fs.readdirSync(new URL('exemples/', ROOT)).filter(f => f.endsWith('.jollof')).sort()) {
    const r = checkProject(loadProject(read('exemples/' + f)));
    if (f.startsWith('07')) assert.deepEqual(codes(r), ['E:J0101', 'E:J0105', 'E:J0106', 'E:J0204', 'E:J0401', 'w:J0209']);
    else assert.equal(r.errors, 0, `${f} : ${codes(r).join(' ')}`);
    assert.equal(r.proven, true, f);
  }
  for (const f of [...fs.readdirSync(new URL('src/lab/tp/', ROOT)).filter(f => f.endsWith('.json')).map(f => 'tp/' + f), ...fs.readdirSync(new URL('src/lab/pneu/', ROOT)).filter(f => f.endsWith('.json')).map(f => 'pneu/' + f)].sort()) {
    const tp = read('src/lab/' + f);
    const sol = checkProject(loadProject({ ...tp.start, wires: tp.solution.wires || [] }, tp.solution.code || null));
    assert.equal(sol.errors, 0, `${f} solution : ${codes(sol).join(' ')}`);
    assert.equal(checkProject(loadProject(tp.start)).errors, 0, `${f} départ`);
  }
});

test('Tous les codes sont déclarés avec un niveau', () => {
  for (const [code, c] of Object.entries(CODES)) { assert.match(code, /^J\d{4}$/); assert.ok(c.level === 'error' || c.level === 'warning', code); }
});

test('LED sans résistance commandée par le programme : J0301 quand la broche est à HIGH', () => {
  const r = checkProject(project([['uno', 'U'], ['led-red', 'L']], [['U', 'D7', 'L', 'A'], ['L', 'K', 'U', 'GND']], prog('pinMode(7, OUTPUT);', 'digitalWrite(7, HIGH);')));
  const d = find(r, 'J0301');
  assert.ok(d && d.level === 'error', codes(r).join(' '));
  assert.match(d.state, /D7 = HIGH/);
  assert.ok(d.m.value > 30);
});

test('Bouton sur une broche en sortie : J0302 quand on appuie et que la sortie est à HIGH', () => {
  const r = checkProject(project([['uno', 'U'], ['button', 'B']], [['U', 'D2', 'B', '1'], ['B', '2', 'U', 'GND']], prog('pinMode(2, OUTPUT);', 'digitalWrite(2, HIGH);')));
  const d = find(r, 'J0302');
  assert.ok(d && d.level === 'error', codes(r).join(' '));
  assert.match(d.state, /B appuyé/); assert.match(d.state, /D2 = HIGH/);
  assert.equal(d.states, 1, 'un seul état sur quatre');
});

test('Pile court-circuitée par un bouton : J0110 (structure), sans doublon J0103', () => {
  const r = checkProject(project([['bat9v', 'P'], ['button', 'B']], [['P', '+', 'B', '1'], ['B', '2', 'P', '-']]));
  assert.ok(find(r, 'J0110')); assert.ok(!find(r, 'J0103'));
  // Sans le contrôle de structure (relais au lieu d'un bouton) : le calcul trouve le court-circuit quand le relais colle.
  const k = checkProject(project([['bat9v', 'P'], ['relay', 'K']], [['P', '+', 'K', 'COM'], ['K', 'NO', 'P', '-']]));
  const d = find(k, 'J0103');
  assert.ok(d, codes(k).join(' ')); assert.match(d.state, /K collé/);
});

test('Deux sorties sur le même nœud : J0601 ; sortie contre un capteur : J0608', () => {
  const r = checkProject(project([['uno', 'U']], [['U', 'D7', 'U', 'D8']], prog('pinMode(7, OUTPUT); pinMode(8, OUTPUT);', 'digitalWrite(7, HIGH); digitalWrite(8, LOW);')));
  assert.ok(find(r, 'J0601'), codes(r).join(' '));
  const s = checkProject(project([['uno', 'U'], ['pir', 'S']], [['U', 'D4', 'S', 'OUT'], ['U', '5V', 'S', 'VCC'], ['U', 'GND', 'S', 'GND']], prog('pinMode(4, OUTPUT);', 'digitalWrite(4, HIGH);')));
  assert.ok(find(s, 'J0608'), codes(s).join(' '));
});

test('Entrée en l’air : J0602 avec INPUT et un bouton vers la masse, rien avec INPUT_PULLUP', () => {
  const parts = [['uno', 'U'], ['button', 'B']], links = [['U', 'D2', 'B', '1'], ['B', '2', 'U', 'GND']];
  const r = checkProject(project(parts, links, prog('pinMode(2, INPUT);', 'int v = digitalRead(2);')));
  const d = find(r, 'J0602');
  assert.ok(d, codes(r).join(' ')); assert.match(d.state, /B relâché/);
  assert.ok(!find(checkProject(project(parts, links, prog('pinMode(2, INPUT_PULLUP);', 'int v = digitalRead(2);'))), 'J0602'));
});

test('analogWrite sans PWM (J0603), analogRead sans ADC (J0604), broche inconnue (J0609)', () => {
  const r = checkProject(project([['uno', 'U'], ['res-220', 'R'], ['led-red', 'L']], [['U', 'D7', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'U', 'GND']],
    prog('pinMode(7, OUTPUT);', 'analogWrite(7, 100); int a = analogRead(8); digitalWrite(99, HIGH);')));
  assert.ok(find(r, 'J0603') && find(r, 'J0604') && find(r, 'J0609'), codes(r).join(' '));
});

test('Potentiomètre en butée sur une LED : J0301 à 100 %, pas au milieu', () => {
  const r = checkProject(project([['uno', 'U'], ['pot', 'P'], ['led-red', 'L']], [['U', 'GND', 'P', '1'], ['U', '5V', 'P', '3'], ['P', 'W', 'L', 'A'], ['L', 'K', 'U', 'GND (2)']]));
  const d = find(r, 'J0301');
  assert.ok(d && d.level === 'error', codes(r).join(' ')); assert.match(d.state, /P à 100 %/);
});

test('Ventilateur 5 V sur 9 V par un relais (J0311 quand il colle) ; 3V3 d’un Uno surchargée (J0109) ; condensateur sous 18 V (J0307)', () => {
  const f = checkProject(project([['bat9v', 'P'], ['relay', 'K'], ['fan', 'F']], [['P', '+', 'K', 'COM'], ['K', 'NO', 'F', '+'], ['F', '-', 'P', '-']]));
  const d = find(f, 'J0311'); assert.ok(d, codes(f).join(' ')); assert.match(d.state, /K collé/);
  const t = checkProject(project([['uno', 'U'], ['dcmotor', 'M']], [['U', '3V3', 'M', 'M+'], ['M', 'M-', 'U', 'GND']]));
  assert.ok(find(t, 'J0109'), codes(t).join(' '));
  const c = checkProject(project([['bat9v', 'P1'], ['bat9v', 'P2'], ['cap-100u', 'C']], [['P1', '-', 'P2', '+'], ['P1', '+', 'C', '+'], ['C', '-', 'P2', '-']]));
  assert.ok(find(c, 'J0307'), codes(c).join(' '));
});

test('Programme à broches calculées : vérification prudente ; trop d’états : partielle ; avertissements acceptés, erreurs jamais', () => {
  const dyn = checkProject(project([['uno', 'U'], ['res-220', 'R'], ['led-red', 'L']], [['U', 'D5', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'U', 'GND']], prog('for (int p = 2; p < 8; p++) pinMode(p, OUTPUT);', 'for (int p = 2; p < 8; p++) digitalWrite(p, HIGH);')));
  assert.equal(dyn.dynamic, true); assert.equal(dyn.states, 2, 'D5 envisagée comme sortie');
  // 13 boutons sur 12 broches (deux partagent D13) : 12 sous-montages, 8 192 états prouvés en 15 calculs.
  const many = Array.from({ length: 13 }, (_, i) => ['button', 'B' + i]);
  const split = checkProject(project([['uno', 'U'], ...many], many.map(([, id], i) => ['U', 'D' + (i < 12 ? i + 2 : 13), id, '1'])));
  assert.equal(split.proven, true); assert.equal(split.space, 8192); assert.equal(split.states, 8192); assert.equal(split.solved, 15, `${split.solved} calculs`);
  // Les 13 sur le même nœud : un seul sous-montage de 8 192 états, au-delà de 4 096 : vérification partielle.
  const big = checkProject(project([['uno', 'U'], ...many], many.map(([, id]) => ['U', 'D2', id, '1'])));
  assert.equal(big.proven, false); assert.ok(big.states <= 4096 && big.space === 8192);
  // Avertissement accepté (buzzer à 26 mA sur une broche) ; une erreur ne s'accepte pas.
  const parts = [['uno', 'U'], ['buzzer', 'Z']], links = [['U', 'D8', 'Z', '+'], ['Z', '-', 'U', 'GND']], code = prog('pinMode(8, OUTPUT);', 'digitalWrite(8, HIGH);');
  const w = checkProject(project(parts, links, code, [{ code: 'J0302', comp: 'U', reason: 'buzzer de 25 mA, prévu ainsi' }]));
  assert.equal(w.warnings, 0); assert.equal(find(w, 'J0302').accepted, 'buzzer de 25 mA, prévu ainsi');
  const e = checkProject(project([['uno', 'U'], ['led-red', 'L']], [['U', 'D7', 'L', 'A'], ['L', 'K', 'U', 'GND']], prog('pinMode(7, OUTPUT);', 'digitalWrite(7, HIGH);'), [{ code: 'J0301', reason: 'non' }]));
  assert.ok(e.errors > 0 && find(e, 'J0301').accepted == null);
});

test('Câblé mais jamais utilisé (J0606), commandé mais relié à rien (J0605)', () => {
  const r = checkProject(project([['uno', 'U'], ['res-220', 'R'], ['led-red', 'L']], [['U', 'D7', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'U', 'GND']], prog('pinMode(9, OUTPUT);', 'digitalWrite(9, HIGH);')));
  assert.ok(find(r, 'J0606') && find(r, 'J0605'), codes(r).join(' '));
});

test('Faits du programme : constantes, #define, A0, LED_BUILTIN, Servo, DHT, boucle', () => {
  const f = pinFacts(`#include <Servo.h>\n#include <DHT.h>\n#define L 13\nconst int B = 2;\nint z = 8;\nServo s; DHT d(4, DHT22);\nvoid setup() { pinMode(L, OUTPUT); pinMode(B, INPUT_PULLUP); s.attach(9); }\nvoid loop() { digitalWrite(LED_BUILTIN, digitalRead(B)); tone(z, 440); int a = analogRead(A0); }`, 'uno', BOARDS.uno);
  assert.ok(f.ok && !f.dynamic);
  assert.deepEqual([...f.pins.keys()].sort(), ['A0', 'D13', 'D2', 'D4', 'D8', 'D9']);
  assert.ok(f.pins.get('D13').writes.has('d') && f.pins.get('D2').modes.has('pullup') && f.pins.get('D9').writes.has('servo') && f.pins.get('D4').lib);
});

test('Rapport texte à la manière de rustc (outil en ligne de commande)', async () => {
  const { formatReport } = await import('./format.js');
  const p7 = loadProject(read('exemples/07-a-corriger.jollof')), r7 = checkProject(p7), t7 = formatReport(r7, p7.programs);
  assert.match(t7, /^erreur\[J0101\]: /m); assert.match(t7, /^ {2}--> /m); assert.match(t7, /= aide : /);
  assert.match(t7.trim().split('\n').pop(), /ne passe pas la vérification \(5 erreur/);
  const p2 = loadProject(read('exemples/02-led-bouton-breadboard.jollof')), t2 = formatReport(checkProject(p2), p2.programs);
  assert.match(t2, /✓ montage vérifié : 0 erreur ; prouvé sûr dans les 4 états atteignables/);
  // Une erreur de code : extrait souligné sous la colonne fautive.
  const pc = project([['uno', 'U']], [], 'void setup() {}\nvoid loop() { digitalWrite(ledPin, HIGH); }\n'), tc = formatReport(checkProject(pc), pc.programs);
  assert.match(tc, /erreur\[J1101\]/); assert.match(tc, /2 \| void loop\(\) \{ digitalWrite\(ledPin, HIGH\); \}\n {2}\| {28}\^{6}/);
});

/** Clés des diagnostics, sans le texte de l'état (l'ordre d'exploration change le premier contre-exemple trouvé). */
const keysOf = r => r.diags.map(d => `${d.level}|${d.code}|${d.loc.comp ? d.loc.comp.id : ''}|${d.loc.key || ''}|${d.loc.line || ''}`).sort();

test('Preuve par sous-montages : mêmes diagnostics que l’exploration complète, en bien moins de calculs', () => {
  const cases = [];
  for (const f of fs.readdirSync(new URL('exemples/', ROOT)).filter(f => f.endsWith('.jollof'))) cases.push([f, () => loadProject(read('exemples/' + f))]);
  for (const f of fs.readdirSync(new URL('src/lab/tp/', ROOT)).filter(f => f.endsWith('.json'))) {
    const tp = read('src/lab/tp/' + f);
    cases.push([f + ' départ', () => loadProject(tp.start)], [f + ' solution', () => loadProject({ ...tp.start, wires: tp.solution.wires || [] }, tp.solution.code || null)]);
  }
  // Fautes qui ne se voient que dans une combinaison : bouton sur une sortie, LED sans résistance, 3V3 surchargée par plusieurs modules.
  cases.push(['bouton sur sortie', () => project([['uno', 'U'], ['button', 'B'], ['led-red', 'L'], ['res-220', 'R']], [['U', 'D2', 'B', '1'], ['B', '2', 'U', 'GND'], ['U', 'D7', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'U', 'GND (2)']], prog('pinMode(2, OUTPUT); pinMode(7, OUTPUT);', 'digitalWrite(2, HIGH); digitalWrite(7, HIGH);'))]);
  cases.push(['LED nues', () => project([['uno', 'U'], ['led-red', 'L1'], ['led-red', 'L2'], ['led-red', 'L3']], [['U', 'D7', 'L1', 'A'], ['L1', 'K', 'U', 'GND'], ['U', 'D8', 'L2', 'A'], ['L2', 'K', 'U', 'GND'], ['U', 'D9', 'L3', 'A'], ['L3', 'K', 'U', 'GND']], prog('pinMode(7, OUTPUT); pinMode(8, OUTPUT); pinMode(9, OUTPUT);', 'digitalWrite(7, HIGH); digitalWrite(8, HIGH); digitalWrite(9, HIGH);'))]);
  cases.push(['3V3 surchargée', () => project([['uno', 'U'], ['rc522', 'A'], ['nrf24', 'B'], ['res-220', 'R'], ['led-red', 'L']], [['A', '3.3V', 'U', '3V3'], ['A', 'GND', 'U', 'GND'], ['B', 'VCC', 'U', '3V3'], ['B', 'GND', 'U', 'GND'], ['U', '3V3', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'U', 'GND']])]);
  let saved = 0;
  for (const [name, make] of cases) {
    const full = checkProject(make(), { monolithic: true });
    if (!full.proven) continue;
    const split = checkProject(make());
    assert.equal(split.proven, true, name);
    assert.deepEqual(keysOf(split), keysOf(full), name);
    assert.equal(split.space, full.space, name);
    assert.ok(split.solved <= full.solved, `${name} : ${split.solved} calculs contre ${full.solved}`);
    saved += full.solved - split.solved;
  }
  assert.ok(saved > 0);
});

test('Preuve par sous-montages : 6 boutons et 6 LED commandées, 30 boutons — prouvés en quelques millisecondes', () => {
  const pins = ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13'], parts = [['uno', 'U']], links = [];
  let setup = '', loop = '';
  pins.slice(0, 6).forEach((k, i) => { parts.push(['button', 'B' + i]); links.push(['B' + i, '1', 'U', k], ['B' + i, '2', 'U', 'GND']); setup += `pinMode(${k.slice(1)}, INPUT_PULLUP); `; });
  pins.slice(6).forEach((k, i) => { parts.push(['res-220', 'R' + i], ['led-red', 'L' + i]); links.push(['U', k, 'R' + i, '1'], ['R' + i, '2', 'L' + i, 'A'], ['L' + i, 'K', 'U', 'GND']); setup += `pinMode(${k.slice(1)}, OUTPUT); `; loop += `digitalWrite(${k.slice(1)}, digitalRead(${pins[i].slice(1)})); `; });
  const r = checkProject(project(parts, links, prog(setup, loop)));
  assert.equal(r.proven, true); assert.equal(r.errors + r.warnings, 0, codes(r).join(' ')); assert.equal(r.space, 4096); assert.ok(r.solved <= 13, `${r.solved} calculs`);
  // 30 boutons sur un ESP32 et une breadboard de rangées : 2^30 états, chacun indépendant.
  const keys = ['D4', 'D13', 'D14', 'D27', 'D26', 'D25', 'D33', 'D32', 'D19', 'D18', 'D23', 'D5', 'D15', 'D21', 'D22', 'D2', 'D12', 'RX2', 'TX2', 'D34', 'D35', 'VP', 'VN'];
  const bparts = [['esp32', 'U']], blinks = [];
  for (let i = 0; i < 30; i++) { bparts.push(['button', 'B' + i]); blinks.push(['B' + i, '1', 'U', keys[i % keys.length]], ['B' + i, '2', 'U', 'GND']); }
  const t = Date.now(), big = checkProject(project(bparts, blinks));
  assert.equal(big.proven, true); assert.equal(big.space, 2 ** 30); assert.ok(Date.now() - t < 2000);
});

test('Pico sous MicroPython : programme Python jugé par la carte, broches supposées dynamiques', () => {
  const main = 'from machine import Pin\nled = Pin(15, Pin.OUT)\nled.value(1)\n';
  const data = engine => ({
    comps: [{ id: 'P', type: 'pico', name: 'P' }, { id: 'L', type: 'led-red', name: 'L' }, { id: 'R', type: 'res-220', name: 'R' }],
    wires: [{ a: ['P', 'GP15'], b: ['R', '1'] }, { a: ['R', '2'], b: ['L', 'A'] }, { a: ['L', 'K'], b: ['P', 'GND'] }],
    settings: { prog: { boards: { P: { engine, code: '', files: { 'main.py': main, 'lib/aide.py': 'X = 1\n' } } } } }
  });
  const p = loadProject(data('micropython'));
  assert.ok(p.firmware.has('P'));
  assert.ok(!p.auto.has('P'), 'écrit par l’élève, pas généré');
  assert.match(p.programs.get('P'), /from machine import Pin[\s\S]*X = 1/);
  const r = checkProject(p);
  assert.deepEqual(r.diags.filter(d => /^J1/.test(d.code)).map(d => d.code), [], 'pas d’erreur de l’interpréteur sur du Python');
  // Sans le moteur MicroPython, le même texte n'est pas lu comme un programme Python.
  assert.ok(!loadProject(data(undefined)).firmware.has('P'));
});
