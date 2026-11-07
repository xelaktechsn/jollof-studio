// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Import des projets Wokwi : composants, broches, breadboards remplacées par des fils, programme et mode.
// node --test src/import/wokwi.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { importWokwi, ohms, stripOf } from './wokwi.js';
import { PARTS as JPARTS } from '../sim/parts.js';

const BLINK = 'void setup(){ pinMode(13, OUTPUT); }\nvoid loop(){ digitalWrite(13, HIGH); delay(500); digitalWrite(13, LOW); delay(500); }\n';
/** Un fil par broche : aucune broche n'apparaît dans deux fils. */
const onePerPin = wires => { const seen = new Set(); for (const w of wires) for (const r of [w.a, w.b]) { const k = r.join('|'); if (seen.has(k)) return k; seen.add(k); } return null; };
/** Broches reliées (à travers fils et bandes de breadboard). */
function linked(project) {
  const p = new Map(), f = k => { if (!p.has(k)) p.set(k, k); while (p.get(k) !== k) k = p.get(k); return k; }, u = (a, b) => p.set(f(a), f(b));
  for (const w of project.wires) u(w.a.join('|'), w.b.join('|'));
  for (const c of project.comps.filter(c => c.type === 'breadboard')) {
    const keys = project.wires.flatMap(w => [w.a, w.b]).filter(r => r[0] === c.id).map(r => r[1]);
    const grp = k => (/^[TB][+-]/.test(k) ? k.slice(0, 2) : /^[A-E]/.test(k) ? 't' + k.slice(1) : 'b' + k.slice(1));
    for (const a of keys) for (const b of keys) if (grp(a) === grp(b)) u(c.id + '|' + a, c.id + '|' + b);
  }
  // Les broches GND d'une carte sont un seul conducteur.
  const ends = project.wires.flatMap(w => [w.a, w.b]);
  for (const a of ends) for (const b of ends) if (a[0] === b[0] && /^GND/.test(a[1]) && /^GND/.test(b[1])) u(a.join('|'), b.join('|'));
  return (a, b) => f(a.join('|')) === f(b.join('|'));
}
const has = (wires, a, b) => wires.some(w => (w.a.join() === a.join() && w.b.join() === b.join()) || (w.a.join() === b.join() && w.b.join() === a.join()));

test('Uno + LED + résistance en direct : composants, broches, couleurs, programme interprété', () => {
  const diagram = {
    version: 1, author: 'test', editor: 'wokwi',
    parts: [
      { type: 'wokwi-arduino-uno', id: 'uno', top: 0, left: 0, attrs: {} },
      { type: 'wokwi-led', id: 'led1', top: -80, left: 120, attrs: { color: 'green' } },
      { type: 'wokwi-resistor', id: 'r1', top: -40, left: 90, rotate: 90, attrs: { value: '220' } }
    ],
    connections: [['uno:13', 'r1:1', 'green', ['v0']], ['r1:2', 'led1:A', 'green', []], ['led1:C', 'uno:GND.1', 'black', []]]
  };
  const { project, report } = importWokwi({ 'diagram.json': JSON.stringify(diagram), 'sketch.ino': BLINK }, 'blink');
  assert.deepEqual(project.comps.map(c => c.type), ['uno', 'led-green', 'res-220']);
  const [uno, led, r] = project.comps.map(c => c.id);
  assert.ok(has(project.wires, [uno, 'D13'], [r, '1']));
  assert.ok(has(project.wires, [r, '2'], [led, 'A']));
  assert.ok(has(project.wires, [led, 'K'], [uno, 'GND']));
  assert.equal(project.wires.find(w => w.a[1] === 'K' || w.b[1] === 'K').color, '#3a3f45');
  assert.equal(project.comps[0].x, 0); assert.equal(project.comps[0].z, 0); // recentré sur la carte
  assert.equal(project.settings.prog.boards[uno].code, BLINK);
  assert.equal(project.settings.prog.boards[uno].engine, undefined);
  assert.equal(report.engine, 'interp');
  assert.deepEqual(report.unknown, []); assert.deepEqual(report.dropped, []);
});

test('Breadboard : les bandes et les rails deviennent des fils directs', () => {
  const diagram = {
    parts: [
      { type: 'wokwi-breadboard-half', id: 'bb1', top: 100, left: 0 },
      { type: 'wokwi-arduino-nano', id: 'nano', top: 0, left: 0 },
      { type: 'wokwi-pushbutton', id: 'btn1', top: 120, left: 60, attrs: { color: 'red' } },
      { type: 'wokwi-led', id: 'led1', top: 120, left: 140, attrs: { color: 'red' } },
      { type: 'wokwi-resistor', id: 'r1', top: 140, left: 120, attrs: { value: '4.7k' } }
    ],
    connections: [
      ['nano:2', 'bb1:10t.a', 'blue', []], ['btn1:1.l', 'bb1:10t.c', '', []], ['btn1:2.r', 'bb1:12t.c', '', []],
      ['bb1:12t.e', 'bb1:tn.5', 'black', []], ['nano:GND.2', 'bb1:tn.1', 'black', []],
      ['nano:5', 'bb1:20b.f', 'orange', []], ['r1:1', 'bb1:20b.h', '', []], ['r1:2', 'bb1:22b.h', '', []], ['led1:A', 'bb1:22b.g', '', []], ['led1:C', 'bb1:bn.3', '', []], ['bb1:bn.1', 'bb1:tn.20', 'black', []]
    ]
  };
  const { project, report } = importWokwi({ 'diagram.json': diagram });
  assert.equal(project.comps.length, 4); // la breadboard a disparu
  const id = t => project.comps.find(c => c.type === t).id;
  const W = project.wires, L = linked(project);
  assert.equal(onePerPin(W), null);
  assert.ok(has(W, [id('nano'), 'D2'], [id('button'), '1']));
  assert.ok(L([id('button'), '2'], [id('nano'), 'GND']));
  assert.ok(has(W, [id('nano'), 'D5'], [id('res-4k7'), '1']));
  assert.ok(has(W, [id('res-4k7'), '2'], [id('led-red'), 'A']));
  // LED (rail bas) et masse de la carte (rail haut) : reliées par le fil entre les deux rails ; trois masses,
  // deux broches GND sur la Nano : pas besoin de breadboard.
  assert.ok(L([id('led-red'), 'K'], [id('nano'), 'GND']));
  assert.ok(!project.comps.some(c => c.type === 'breadboard'));
  assert.deepEqual(report.unknown, []);
  assert.equal(stripOf('wokwi-breadboard', '7t.b'), '7t'); assert.equal(stripOf('wokwi-breadboard', 'bp.12'), 'bp');
});

test('Un fil par broche : alimentation et bus partagés passent par une breadboard de la bibliothèque', () => {
  const diagram = {
    parts: [
      { type: 'wokwi-arduino-uno', id: 'uno', top: 0, left: 0 },
      ...[1, 2, 3, 4].map(i => ({ type: 'wokwi-led', id: 'l' + i, top: -100, left: 40 * i })),
      { type: 'board-ssd1306', id: 'oled', top: 200, left: 0 }, { type: 'wokwi-lcd1602', id: 'lcd', top: 200, left: 200, attrs: { pins: 'i2c' } },
      { type: 'wokwi-dht22', id: 'dht', top: 200, left: 400 }
    ],
    connections: [
      ...[1, 2, 3, 4].map(i => [`l${i}:C`, `uno:GND.${Math.min(i, 3)}`, 'black', []]), ...[1, 2, 3, 4].map(i => [`l${i}:A`, `uno:${i + 2}`, 'green', []]),
      ['uno:5V', 'oled:VCC', 'red', []], ['uno:5V', 'lcd:VCC', 'red', []], ['uno:5V', 'dht:VCC', 'red', []],
      ['uno:A4', 'oled:SDA', 'blue', []], ['uno:SDA', 'lcd:SDA', 'blue', []], ['uno:A5', 'oled:SCL', '', []], ['uno:A5', 'lcd:SCL', '', []],
      ['oled:GND', 'lcd:GND', 'black', []], ['dht:GND', 'lcd:GND', 'black', []], ['dht:SDA', 'uno:7', 'yellow', []], ['dht:GND', 'uno:GND.1', 'black', []]
    ]
  };
  const { project } = importWokwi({ 'diagram.json': diagram });
  const W = project.wires, L = linked(project), id = t => project.comps.find(c => c.type === t).id;
  assert.equal(onePerPin(W), null);
  assert.ok(project.comps.some(c => c.type === 'breadboard'));
  for (const t of ['oled', 'lcd1602', 'dht22']) { assert.ok(L([id(t), 'VCC'], ['uno_1', '5V'])); assert.ok(L([id(t), 'GND'], ['uno_1', 'GND'])); }
  assert.ok(L([id('oled'), 'SDA'], [id('lcd1602'), 'SDA'])); assert.ok(L([id('oled'), 'SDA'], ['uno_1', 'A4']));
  assert.ok(L([id('oled'), 'SCL'], ['uno_1', 'A5']));
  assert.ok(has(W, [id('dht22'), 'DATA'], ['uno_1', 'D7']));
  for (let i = 1; i <= 4; i++) assert.ok(L([`led-red_${i}`, 'K'], ['uno_1', 'GND']));
  // Les fils vers les rails de masse et d'alimentation : noir et rouge.
  assert.ok(W.filter(w => w.a[1].startsWith('T-') || w.b[1].startsWith('T-')).every(w => w.color === '#3a3f45'));
});

test('Programme hors interpréteur : mode fidèle sur Uno ; composants inconnus et broches perdues listés', () => {
  const code = '#include <avr/io.h>\nvolatile uint8_t *p = &PORTB;\ntemplate<typename T> T twice(T x){ return x * 2; }\nvoid setup(){ DDRB |= _BV(5); }\nvoid loop(){ *p ^= _BV(5); }\n';
  const diagram = {
    parts: [
      { type: 'wokwi-arduino-uno', id: 'uno', top: 0, left: 0 },
      { type: 'wokwi-ili9341', id: 'lcd', top: 0, left: 300 },
      { type: 'wokwi-lcd1602', id: 'lcd2', top: 200, left: 0, attrs: { pins: 'i2c' } },
      { type: 'wokwi-lcd1602', id: 'lcd3', top: 300, left: 0 },
      { type: 'wokwi-led', id: 'led1', top: 0, left: 200 }
    ],
    connections: [['uno:5V', 'lcd2:VCC', 'red', []], ['uno:A4', 'lcd2:SDA', '', []], ['uno:A5', 'lcd2:SCL', '', []], ['uno:GND.2', 'lcd2:GND', '', []], ['uno:10', 'lcd:CS', '', []], ['led1:X', 'uno:3', '', []]]
  };
  const { project, report } = importWokwi({ 'diagram.json': diagram, 'sketch.ino': code, 'libraries.txt': '# Wokwi\nLiquidCrystal I2C\n' });
  assert.deepEqual(project.comps.map(c => c.type), ['uno', 'lcd1602', 'led-red']);
  assert.deepEqual(report.unknown.map(u => u.type), ['wokwi-ili9341', 'wokwi-lcd1602']);
  assert.ok(report.unknown[1].why); // LCD parallèle : la raison est donnée
  assert.equal(report.dropped.length, 1); // led1:X
  assert.equal(project.settings.prog.boards.uno_1.engine, 'firmware');
  assert.equal(report.engine, 'firmware');
  assert.ok(report.notes.some(n => /LiquidCrystal I2C/.test(n)));
});

test('Toutes les broches de la table existent dans la bibliothèque', () => {
  // Pour les modules (fiches de câblage connues), chaque broche cible existe dans la fiche.
  return import('./wokwi.js').then(({ PARTS }) => {
    const bad = [];
    for (const [wt, M] of Object.entries(PARTS)) {
      const t = typeof M.type === 'function' ? M.type({ pins: 'i2c', color: 'red', value: '220' }) : M.type, type = t && typeof t === 'object' ? t.type : t;
      const J = JPARTS[type]; if (!J || !J.pins || !J.pins.length) continue;
      const names = new Set(J.pins.map(p => p.pin));
      for (const k of Object.values(M.pins)) if (!names.has(k)) bad.push(`${wt} → ${type}.${k}`);
    }
    assert.deepEqual(bad, []);
  });
});

test('Valeurs de résistance', () => {
  assert.equal(ohms('220'), 220); assert.equal(ohms('4.7k'), 4700); assert.equal(ohms('1M'), 1e6); assert.equal(ohms(undefined), 1000);
});
