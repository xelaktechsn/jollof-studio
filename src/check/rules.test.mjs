// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Contrôles des valeurs nominales et des règles des fiches : node --test src/check/rules.test.mjs
// Chaque code a un cas qui le déclenche (avec l'état qui le prouve quand il dépend de l'état) et un cas voisin, juste,
// qui ne le déclenche pas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from './load.js';
import { checkProject } from './check.js';

/** Petit projet : parts [[type, id, inp?]], fils [[a, ka, b, kb]], programme de la carte U. */
const project = (parts, links, code = null) => loadProject({
  comps: parts.map(([type, id, inp]) => ({ id, type, name: id, ...(inp ? { inp } : {}) })),
  wires: links.map(([a, ka, b, kb]) => ({ a: [a, ka], b: [b, kb] }))
}, code ? { U: code } : null);
const prog = (setup, loop = '', head = '') => `${head}\nvoid setup() { ${setup} }\nvoid loop() { ${loop} }\n`;
const run = (...a) => checkProject(project(...a));
const codes = r => r.diags.map(d => `${d.level === 'error' ? 'E' : 'w'}:${d.code}`).sort().join(' ');
const find = (r, code) => r.diags.find(d => d.code === code);
const has = (r, code, level) => { const d = find(r, code); assert.ok(d && (!level || d.level === level), `${code} attendu : ${codes(r)}`); return d; };
const not = (r, code) => assert.ok(!find(r, code), `${code} inattendu : ${codes(r)}`);

test('J0207 : 5 V sur une GPIO d’ESP32 est une erreur ; pont diviseur trop bas : seulement un avertissement', () => {
  const base = [['esp32', 'U'], ['hcsr04', 'S']], pw = [['S', 'VCC', 'U', 'VIN'], ['S', 'GND', 'U', 'GND'], ['S', 'TRIG', 'U', 'D5']];
  has(run(base, [...pw, ['S', 'ECHO', 'U', 'D18']]), 'J0207', 'error');
  // 10 kΩ en haut, 1 kΩ en bas : 0,45 V, la carte lit LOW sans être abîmée.
  const low = run([...base, ['res-10k', 'RT'], ['res-1k', 'RB']], [...pw, ['S', 'ECHO', 'RT', '1'], ['RT', '2', 'U', 'D18'], ['RB', '1', 'U', 'D18'], ['RB', '2', 'U', 'GND']]);
  assert.equal(find(low, 'J0207').level, 'warning', codes(low));
  // 4,7 kΩ / 10 kΩ : 3,4 V, juste.
  not(run([...base, ['res-4k7', 'RT'], ['res-10k', 'RB']], [...pw, ['S', 'ECHO', 'RT', '1'], ['RT', '2', 'U', 'D18'], ['RB', '1', 'U', 'D18'], ['RB', '2', 'U', 'GND']]), 'J0207');
});

test('J0213 : une carte 3,3 V qui commande un WS2812B alimenté en 5 V (VIH 3,5 V) ; rien sur un Uno', () => {
  const parts = b => [[b, 'U'], ['ws2812', 'L']], code = prog('pinMode(4, OUTPUT);', 'digitalWrite(4, HIGH);');
  const d = has(run(parts('esp32'), [['L', 'VCC', 'U', 'VIN'], ['L', 'GND', 'U', 'GND'], ['L', 'DIN', 'U', 'D4']], code), 'J0213', 'warning');
  assert.match(d.state, /D4 = HIGH/);
  not(run(parts('uno'), [['L', 'VCC', 'U', '5V'], ['L', 'GND', 'U', 'GND'], ['L', 'DIN', 'U', 'D4']], code), 'J0213');
});

test('J0214 : tirages I2C trop forts (plus de 3 mA à 0,4 V) ; J0215 : 10 kΩ trop faibles à 400 kHz', () => {
  const rtc = [['uno', 'U'], ['ds3231', 'T']], w = [['T', 'VCC', 'U', '5V'], ['T', 'GND', 'U', 'GND'], ['T', 'SDA', 'U', 'SDA'], ['T', 'SCL', 'U', 'SCL']];
  // 4,7 kΩ du module et 1 kΩ ajoutée : (5 − 0,4) ÷ 1 kΩ + (5 − 0,4) ÷ 4,7 kΩ ≈ 5,6 mA.
  has(run([...rtc, ['res-1k', 'R']], [...w, ['R', '1', 'T', 'SDA'], ['R', '2', 'U', '5V']]), 'J0214', 'warning');
  not(run(rtc, w), 'J0214');
  const gas = (clock) => run([['esp32', 'U'], ['ccs811', 'G']], [['G', 'VCC', 'U', '3V3'], ['G', 'GND', 'U', 'GND'], ['G', 'SDA', 'U', 'D21'], ['G', 'SCL', 'U', 'D22']],
    prog(`Wire.begin();${clock ? ` Wire.setClock(${clock});` : ''}`, '', '#include <Wire.h>'));
  has(gas(400000), 'J0215', 'warning');
  not(gas(null), 'J0215');
});

test('J0615 : Wire.setClock(400000) avec l’adaptateur PCF8574 d’un LCD (100 kHz)', () => {
  const lcd = clock => run([['uno', 'U'], ['lcd1602', 'D']], [['D', 'VCC', 'U', '5V'], ['D', 'GND', 'U', 'GND'], ['D', 'SDA', 'U', 'SDA'], ['D', 'SCL', 'U', 'SCL']],
    prog(`Wire.begin(); Wire.setClock(${clock});`, '', '#include <Wire.h>'));
  const d = has(lcd(400000), 'J0615', 'error');
  assert.equal(d.loc.line, 2, 'ligne de Wire.setClock');
  not(lcd(100000), 'J0615');
});

test('J0332 : entrée d’un module 3,3 V poussée au-delà de sa tension par une source extérieure', () => {
  const parts = [['esp32', 'U'], ['rc522', 'M'], ['bat9v', 'P'], ['res-1k', 'R']];
  const w = [['M', '3.3V', 'U', '3V3'], ['M', 'GND', 'U', 'GND'], ['P', '-', 'U', 'GND (2)'], ['M', 'RST', 'R', '1']];
  has(run(parts, [...w, ['R', '2', 'P', '+']]), 'J0332', 'error');
  // La même entrée commandée par la carte 3,3 V : rien.
  not(run([['esp32', 'U'], ['rc522', 'M']], [['M', '3.3V', 'U', '3V3'], ['M', 'GND', 'U', 'GND'], ['M', 'RST', 'U', 'D4']], prog('pinMode(4, OUTPUT);', 'digitalWrite(4, HIGH);')), 'J0332');
});

test('J0333 : neuf LED absorbées par les ports B et D5–D7 d’un Uno (100 mA au plus) ; réparties, rien', () => {
  const build = pins => {
    const parts = [['uno', 'U']], links = []; let setup = '', loop = '';
    pins.forEach((p, i) => { parts.push(['res-220', 'R' + i], ['led-red', 'L' + i]); links.push(['U', '5V', 'R' + i, '1'], ['R' + i, '2', 'L' + i, 'A'], ['L' + i, 'K', 'U', 'D' + p]); setup += `pinMode(${p}, OUTPUT); `; loop += `digitalWrite(${p}, LOW); `; });
    return run(parts, links, prog(setup, loop));
  };
  const d = has(build([5, 6, 7, 8, 9, 10, 11, 12, 13]), 'J0333', 'error');
  assert.match(d.title, /PB0–PB5, PD5–PD7/);
  not(build([2, 3, 4, 5, 8, 9, 10, 11]), 'J0333');
});

test('J0334 : ESP32 en Wi-Fi et ruban WS2812B sur VIN : plus que les 500 mA de l’USB', () => {
  const strip = wifi => run([['esp32', 'U'], ['ws2812', 'L']], [['L', 'VCC', 'U', 'VIN'], ['L', 'GND', 'U', 'GND'], ['L', 'DIN', 'U', 'D4']],
    prog(`pinMode(4, OUTPUT);${wifi ? ' WiFi.begin("a", "b");' : ''}`, 'digitalWrite(4, LOW);', wifi ? '#include <WiFi.h>' : ''));
  has(strip(true), 'J0334', 'error');
  not(strip(false), 'J0334');
});

test('J0611 : sortie sur une broche d’entrée seulement (ESP32 GPIO 34) ; J0612 : GPIO 6 (flash)', () => {
  const r = run([['esp32', 'U'], ['res-220', 'R'], ['led-red', 'L']], [['U', 'D34', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'U', 'GND']], prog('pinMode(34, OUTPUT);', 'digitalWrite(34, HIGH);'));
  has(r, 'J0611', 'error');
  not(run([['esp32', 'U'], ['button', 'B'], ['res-10k', 'R']], [['U', 'D34', 'B', '1'], ['B', '2', 'U', '3V3'], ['R', '1', 'U', 'D34'], ['R', '2', 'U', 'GND']], prog('pinMode(34, INPUT);', 'int v = digitalRead(34);')), 'J0611');
  has(run([['esp32', 'U']], [], prog('pinMode(6, OUTPUT);', 'digitalWrite(6, HIGH);')), 'J0612', 'error');
  const uno = run([['uno', 'U']], [], prog('pinMode(6, OUTPUT);', 'digitalWrite(6, HIGH);'));
  not(uno, 'J0612'); not(uno, 'J0609');
});

test('J0613 : GPIO 12 de l’ESP32 tirée vers 3,3 V (flash à 1,8 V) ; tirée vers la masse, rien', () => {
  has(run([['esp32', 'U'], ['res-10k', 'R']], [['R', '1', 'U', 'D12'], ['R', '2', 'U', '3V3']]), 'J0613', 'error');
  const down = run([['esp32', 'U'], ['res-10k', 'R']], [['R', '1', 'U', 'D12'], ['R', '2', 'U', 'GND']]);
  not(down, 'J0613'); not(down, 'J0903');
});

test('J0614 : analogRead sur l’ADC2 (D4) pendant le Wi-Fi ; sur l’ADC1 (D34), rien', () => {
  const pot = pin => run([['esp32', 'U'], ['pot', 'P']], [['P', '1', 'U', 'GND'], ['P', '3', 'U', '3V3'], ['P', 'W', 'U', `D${pin}`]],
    prog('WiFi.begin("a", "b");', `int v = analogRead(${pin});`, '#include <WiFi.h>'));
  has(pot(4), 'J0614', 'error');
  not(pot(34), 'J0614');
});

test('J0904 : résistance de 220 Ω à 190 mW (plus de 60 % de 1/4 W) ; 1 kΩ, rien', () => {
  const lamp = r => run([['bat9v', 'P'], [r, 'R'], ['led-red', 'L']], [['P', '+', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'P', '-']]);
  const d = has(lamp('res-220'), 'J0904', 'warning');
  assert.equal(d.loc.comp.id, 'R'); assert.equal(d.m.pct, 60);
  not(lamp('res-1k'), 'J0904');
});

test('J0905 : potentiomètre sur 3,3 V lu par un ESP32-C3 (2,5 V au plus) ; sur un ESP32, rien', () => {
  const pot = (b, pin) => run([[b, 'U'], ['pot', 'P']], [['P', '1', 'U', 'GND'], ['P', '3', 'U', '3V3'], ['P', 'W', 'U', pin]], prog('', `int v = analogRead(${pin.replace(/^IO|^D/, '')});`));
  const d = has(pot('esp32c3', 'IO0'), 'J0905', 'warning');
  assert.match(d.state, /P à 100 %/);
  not(pot('esp32', 'D34'), 'J0905');
});

test('J0906 : grille d’IRLZ44N sans rappel ; avec 10 kΩ vers la masse, rien. J0907 : grille à 3,3 V', () => {
  const fet = (b, pin, extra = [], el = []) => run([[b, 'U'], ['irlz44n', 'Q'], ['res-220', 'RG'], ['bat9v', 'P'], ['dcmotor', 'M'], ['diode', 'D'], ...extra],
    [['U', pin, 'RG', '1'], ['RG', '2', 'Q', 'G'], ['Q', 'S', 'U', 'GND'], ['P', '-', 'U', 'GND (2)'], ['P', '+', 'M', 'M+'], ['M', 'M-', 'Q', 'D'], ['D', 'K', 'M', 'M+'], ['D', 'A', 'M', 'M-'], ...el],
    prog(`pinMode(${pin.slice(1)}, OUTPUT);`, `digitalWrite(${pin.slice(1)}, HIGH);`));
  has(fet('uno', 'D9'), 'J0906', 'warning');
  const ok = fet('uno', 'D9', [['res-10k', 'RP']], [['RP', '1', 'Q', 'G'], ['RP', '2', 'U', 'GND (3)']]);
  not(ok, 'J0906'); not(ok, 'J0907');
  const d = has(fet('esp32', 'D4', [['res-10k', 'RP']], [['RP', '1', 'Q', 'G'], ['RP', '2', 'U', 'GND']]), 'J0907', 'warning');
  assert.match(d.state, /D4 = HIGH/);
});

test('J0908 : PN2222A et bobine de 125 mA, 1 kΩ de base (4 mA) ; 220 Ω, saturé', () => {
  const coil = r => run([['uno', 'U'], ['pn2222', 'Q'], [r, 'RB'], ['psu24', 'P'], ['coil24', 'K'], ['diode', 'D']],
    [['U', 'D2', 'RB', '1'], ['RB', '2', 'Q', 'B'], ['Q', 'E', 'U', 'GND'], ['P', '-', 'U', 'GND (2)'], ['P', '+', 'K', '+'], ['K', '-', 'Q', 'C'], ['D', 'K', 'K', '+'], ['D', 'A', 'K', '-']],
    prog('pinMode(2, OUTPUT);', 'digitalWrite(2, HIGH);'));
  const d = has(coil('res-1k'), 'J0908', 'warning');
  assert.equal(d.m.beta, 10); assert.match(d.state, /D2 = HIGH/);
  not(coil('res-220'), 'J0908');
});

test('J0909 : LM7805 sans ses condensateurs (0,33 µF et 0,1 µF) ; avec, rien', () => {
  const reg = caps => run([['bat9v', 'P'], ['lm7805', 'V'], ['res-1k', 'R'], ['led-red', 'L'], ...(caps ? [['cap-100n', 'C1'], ['cap-100n', 'C2']] : [])],
    [['P', '+', 'V', 'IN'], ['P', '-', 'V', 'GND'], ['V', 'OUT', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'V', 'GND'],
      ...(caps ? [['C1', '1', 'V', 'IN'], ['C1', '2', 'P', '-'], ['C2', '1', 'V', 'OUT'], ['C2', '2', 'P', '-']] : [])]);
  assert.equal(reg(false).diags.filter(d => d.code === 'J0909').length, 2, codes(reg(false)));
  not(reg(true), 'J0909');
});

test('J0910 : servo sur la broche 5V d’un Uno (avertissement acceptable) ; sur un module d’alimentation, rien', () => {
  const r = run([['uno', 'U'], ['servo', 'S']], [['S', 'VCC', 'U', '5V'], ['S', 'GND', 'U', 'GND'], ['S', 'SIG', 'U', 'D9']]);
  has(r, 'J0910', 'warning');
  not(run([['uno', 'U'], ['servo', 'S'], ['mb102', 'A']], [['S', 'VCC', 'A', '+5V'], ['S', 'GND', 'A', 'GND'], ['A', 'GND', 'U', 'GND'], ['S', 'SIG', 'U', 'D9']]), 'J0910');
});

test('LED verte : 25 mA au plus (Kingbright WP7113GD), pas 30 mA comme la rouge', () => {
  const lamp = led => run([['bat9v', 'P'], ['res-220', 'R'], [led, 'L']], [['P', '+', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'P', '-']]);
  // 9 V et 220 Ω : ≈ 28 mA dans la verte (au-delà de ses 25 mA), ≈ 30 mA dans la rouge (à sa limite, conseillé dépassé).
  const g = has(lamp('led-green'), 'J0301', 'error');
  assert.equal(g.m.limit, 25);
  assert.equal(find(lamp('led-red'), 'J0301').level, 'warning');
});
