// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du débogueur (compilation en mode débogage + exécution pas à pas), sous Node :
// node --test src/prog/debug.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './lang.js';
import { createRuntime } from './runtime.js';
import { BOARDS } from '../sim/boards.js';

/** Carte Uno sans montage : D2 suit `pins.D2` (pour les interruptions), A0 lit 2,5 V. */
function start(src, { debug = true, pins = {} } = {}) {
  const c = compile(src, { board: 'uno', boardLabel: 'Arduino Uno', debug });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const hw = {
    kind: 'uno', label: 'Arduino Uno', prof: BOARDS.uno,
    read: k => (k in pins ? { d: pins[k] } : k === 'A0' ? { v: 2.5 } : null),
    echo: () => null, onPin: () => null, bus: () => [], data: () => null
  };
  const rt = createRuntime(c.js, hw, c.debug || { globals: c.globals });
  return { rt, c };
}
/** Fait tourner jusqu'à l'arrêt (ou n images de 16 ms). */
function until(rt, n = 400) { for (let i = 0; i < n && !rt.debug.paused; i++) rt.run(16); return rt.debug.at; }
const lineOf = (src, re) => src.split('\n').findIndex(l => re.test(l)) + 1;
const val = (list, name) => (list.find(v => v.name === name) || {}).text;

const PROG = `int compteur = 0;
float temp = 21.5;
char lettre = 'A';
String nom = "Awa";
bool actif = true;
int tab[4] = {1, 2, 3};

int carre(int x) {
  int r = x * x;
  return r;
}

void setup() {
  Serial.begin(9600);
}

void loop() {
  int a = 3;
  int b = carre(a);
  compteur = compteur + b;
  delay(100);
}`;

test('compilation : métadonnées en mode débogage, sortie normale inchangée sauf G', () => {
  const n = compile(PROG, { board: 'uno' }), d = compile(PROG, { board: 'uno', debug: true });
  assert.ok(!n.js.includes('$.D'), 'pas d’arrêt hors débogage');
  assert.match(n.js, /G:\(\)=>\[v_compteur,v_temp,v_lettre,v_nom,v_actif,v_tab\]\};$/);
  assert.equal(n.debug, undefined);
  assert.deepEqual(n.globals.map(g => g.name), ['compteur', 'temp', 'lettre', 'nom', 'actif', 'tab']);
  assert.ok(d.debug.lines.has(lineOf(PROG, /int b = carre/)));
  assert.ok(!d.debug.lines.has(1), 'pas d’arrêt dans __init');
  assert.ok(!d.debug.lines.has(lineOf(PROG, /^void loop/)));
  const h = d.debug.hooks.find(x => x.line === lineOf(PROG, /compteur = compteur/));
  assert.equal(h.fn, 'loop');
  assert.deepEqual(h.names, ['a', 'b']);
  assert.deepEqual(h.types, ['int', 'int']);
  assert.deepEqual(d.debug.globals.map(g => g.t), ['int', 'float', 'char', 'String', 'bool', 'int[]']);
});

test('point d’arrêt dans loop() : ligne, fonction, variables locales et globales', () => {
  const { rt } = start(PROG), L = lineOf(PROG, /compteur = compteur/);
  rt.debug.setBreakpoints([L]);
  assert.deepEqual(until(rt), { line: L, fn: 'loop' });
  assert.equal(rt.state, 'paused');
  const loc = rt.debug.locals();
  assert.equal(val(loc, 'a'), '3');
  assert.equal(val(loc, 'b'), '9');
  const g = rt.debug.globals();
  assert.equal(val(g, 'compteur'), '0');
  assert.equal(val(g, 'temp'), '21.5');
  assert.equal(val(g, 'lettre'), "65 'A'");
  assert.equal(val(g, 'nom'), '"Awa"');
  assert.equal(val(g, 'actif'), 'true');
  assert.equal(val(g, 'tab'), '(4) {1, 2, 3, 0}');
  // Continuer : arrêt au tour suivant, compteur augmenté de 9.
  rt.debug.resume();
  assert.equal(until(rt).line, L);
  assert.equal(val(rt.debug.globals(), 'compteur'), '9');
});

test('pas à pas principal : passe par-dessus l’appel de fonction', () => {
  const { rt } = start(PROG), L = lineOf(PROG, /int b = carre/);
  rt.debug.setBreakpoints([L]);
  until(rt);
  rt.debug.setBreakpoints([]);
  rt.debug.step('over');
  assert.deepEqual(until(rt), { line: L + 1, fn: 'loop' });
  assert.equal(val(rt.debug.locals(), 'b'), '9');
});

test('entrer dans la fonction, puis en sortir', () => {
  const { rt } = start(PROG), L = lineOf(PROG, /int b = carre/);
  rt.debug.setBreakpoints([L]);
  until(rt);
  rt.debug.setBreakpoints([]);
  rt.debug.step('into');
  assert.deepEqual(until(rt), { line: lineOf(PROG, /int r = x \* x/), fn: 'carre' });
  assert.deepEqual(rt.debug.locals().map(v => [v.name, v.text]), [['x', '3']]);
  rt.debug.step('into');
  assert.equal(until(rt).line, lineOf(PROG, /return r/));
  assert.equal(val(rt.debug.locals(), 'r'), '9');
  rt.debug.step('out');
  assert.deepEqual(until(rt), { line: L + 1, fn: 'loop' });
});

test('sortir de loop() : arrêt au début du tour suivant', () => {
  const { rt } = start(PROG), L = lineOf(PROG, /compteur = compteur/);
  rt.debug.setBreakpoints([L]);
  until(rt);
  rt.debug.setBreakpoints([]);
  rt.debug.step('out');
  assert.deepEqual(until(rt), { line: lineOf(PROG, /int a = 3/), fn: 'loop' });
  assert.equal(val(rt.debug.globals(), 'compteur'), '9');
});

test('boucle for : sa ligne s’arrête à chaque tour, avec la variable de boucle', () => {
  const src = `int s = 0;
void setup() {}
void loop() {
  for (int i = 0; i < 3; i++) {
    s += i;
  }
  delay(10);
}`;
  const { rt } = start(src);
  rt.debug.setBreakpoints([4]);
  assert.equal(until(rt).line, 4);
  const seen = [];
  rt.debug.setBreakpoints([]);
  for (let k = 0; k < 8; k++) { rt.debug.step('over'); const at = until(rt); seen.push(at.line + (at.line === 5 ? ':' + val(rt.debug.locals(), 'i') : '')); }
  assert.deepEqual(seen, ['5:0', '4', '5:1', '4', '5:2', '7', '4', '5:0']);
});

test('point d’arrêt dans une interruption : ignoré, l’interruption s’exécute', () => {
  const src = `volatile int fronts = 0;
void compte() {
  fronts++;
}
void setup() {
  attachInterrupt(digitalPinToInterrupt(2), compte, RISING);
}
void loop() {
  delay(10);
}`;
  const pins = { D2: 0 }, { rt } = start(src, { pins });
  rt.debug.setBreakpoints([3]);
  for (let i = 0; i < 60; i++) { pins.D2 = (i >> 2) & 1; rt.run(16); }
  assert.equal(rt.debug.paused, false);
  assert.equal(rt.state, 'run');
  assert.ok(+val(rt.debug.globals(), 'fronts') >= 5);
});

test('horloge figée pendant l’arrêt, millis() reprend exactement', () => {
  const src = `unsigned long t = 0;
void setup() {}
void loop() {
  t = millis();
  delay(100);
}`;
  const { rt } = start(src);
  rt.debug.setBreakpoints([5]);
  until(rt);
  const t0 = rt.clock(), m0 = +val(rt.debug.globals(), 't');
  for (let i = 0; i < 100; i++) rt.run(16);
  assert.equal(rt.clock(), t0, 'l’heure virtuelle ne bouge pas');
  assert.equal(rt.debug.at.line, 5);
  rt.debug.resume();
  until(rt);
  assert.equal(+val(rt.debug.globals(), 't'), m0 + 100);
});

test('pas à pas au-dessus de delay() : l’attente dure exactement le délai', () => {
  const src = `int n = 0;
void setup() {}
void loop() {
  delay(500);
  n++;
}`;
  const { rt } = start(src);
  rt.debug.setBreakpoints([4]);
  until(rt);
  const t0 = rt.clock();
  rt.debug.setBreakpoints([]);
  rt.debug.step('over');
  rt.run(16);
  assert.equal(rt.debug.paused, false, 'la carte attend');
  assert.deepEqual(until(rt), { line: 5, fn: 'loop' });
  assert.equal(rt.clock() - t0, 500);
});

test('pause : immédiate dans un delay(), sinon à l’instruction suivante', () => {
  const src = `int n = 0;
void setup() {}
void loop() {
  n++;
  delay(1000);
}`;
  const { rt } = start(src);
  for (let i = 0; i < 10; i++) rt.run(16);
  rt.debug.pause();
  assert.equal(rt.debug.paused, true);
  assert.deepEqual(rt.debug.at, { line: 5, fn: 'loop' });
  assert.deepEqual(rt.debug.locals(), []);
  rt.debug.step('over');
  assert.equal(until(rt).line, 4, 'après le delay, tour suivant');
  // Programme qui tourne sans attendre : la pause tombe sur une instruction, avec les locales.
  const busy = start(`long k = 0;\nvoid setup() {}\nvoid loop() {\n  int j = 2;\n  k += j;\n}`).rt;
  busy.run(16);
  busy.debug.pause();
  assert.equal(busy.debug.paused, false);
  const at = until(busy);
  assert.ok(at.line === 4 || at.line === 5);
});

test('programme compilé sans débogage : pause en fin de tranche, globales seulement', () => {
  const { rt } = start(PROG, { debug: false });
  assert.equal(rt.debug.enabled, false);
  rt.run(16); rt.run(16);
  rt.debug.pause();
  assert.equal(rt.debug.paused, true);
  assert.ok(rt.debug.at.line > 0);
  assert.deepEqual(rt.debug.locals(), []);
  assert.equal(rt.debug.globals().length, 6);
  const t0 = rt.clock();
  rt.run(16);
  assert.equal(rt.clock(), t0);
  rt.debug.step('over');
  rt.run(16);
  assert.equal(rt.debug.paused, true, 'un pas = une tranche');
});

test('switch : une variable d’un autre case se lit sans erreur', () => {
  const src = `int m = 1;
void setup() {}
void loop() {
  switch (m) {
    case 0:
      int y = 5;
      break;
    case 1:
      m = 2;
      break;
  }
  delay(10);
}`;
  const { rt } = start(src);
  rt.debug.setBreakpoints([9]);
  until(rt);
  assert.deepEqual(rt.debug.locals(), [{ name: 'y', type: 'int', text: '—' }]);
});

test('traceur série : chaque écriture arrive avec son heure virtuelle', () => {
  const { rt } = start(`void setup() { Serial.begin(9600); }\nvoid loop() { Serial.print("a:"); Serial.println(millis()); delay(250); }`, { debug: false });
  const got = [];
  rt.setSerialTap((s, t) => got.push([s, t]));
  for (let i = 0; i < 40; i++) rt.run(16);
  assert.deepEqual(got.slice(0, 4), [['a:', 0], ['0\n', 0], ['a:', 250], ['250\n', 250]]);
});
