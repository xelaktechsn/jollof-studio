// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du lecteur de lignes du traceur série : node --test src/prog/plotter.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlotLine } from './plotter.js';

const P = parsePlotLine;
const pairs = s => (P(s) || []).map(x => [x.label, x.value]);

test('valeurs sans étiquette : espaces, tabulations, virgules', () => {
  assert.deepEqual(pairs('1 2 3'), [[null, 1], [null, 2], [null, 3]]);
  assert.deepEqual(pairs('1\t-2.5\t3e2'), [[null, 1], [null, -2.5], [null, 300]]);
  assert.deepEqual(pairs('10,20, 30'), [[null, 10], [null, 20], [null, 30]]);
  assert.deepEqual(pairs('  42  \r'), [[null, 42]]);
  assert.deepEqual(pairs('.5 +7'), [[null, 0.5], [null, 7]]);
});

test('étiquettes label:valeur (format de l’IDE Arduino)', () => {
  assert.deepEqual(pairs('a:1 b:2'), [['a', 1], ['b', 2]]);
  assert.deepEqual(pairs('temp:21.5,hum:40'), [['temp', 21.5], ['hum', 40]]);
  assert.deepEqual(pairs('x:-3\ty:4'), [['x', -3], ['y', 4]]);
  assert.deepEqual(pairs('Min:0,Max:1023,A0:512'), [['Min', 0], ['Max', 1023], ['A0', 512]]);
});

test('tolérant : espaces autour des deux-points, étiquettes avec espaces, unités', () => {
  assert.deepEqual(pairs('temp : 21.5'), [['temp', 21.5]]);
  assert.deepEqual(pairs('Température extérieure: 21.5 Humidité: 40'), [['Température extérieure', 21.5], ['Humidité', 40]]);
  assert.deepEqual(pairs('Capteur 2 : 7, Capteur 3 : 8'), [['Capteur 2', 7], ['Capteur 3', 8]]);
  assert.deepEqual(pairs('temp: 21.5 °C'), [['temp', 21.5]]);
  assert.deepEqual(pairs('tension:3.3V'), [['tension', 3.3]]);
  assert.deepEqual(pairs('1 2 c:3'), [[null, 1], [null, 2], ['c', 3]]);
});

test('nan, inf et ovf (affichages de Serial.print pour un float)', () => {
  const r = P('a:nan b:inf c:-inf d:ovf');
  assert.equal(r.length, 4);
  assert.ok(Number.isNaN(r[0].value));
  assert.equal(r[1].value, Infinity);
  assert.equal(r[2].value, -Infinity);
  assert.ok(Number.isNaN(r[3].value));
  assert.deepEqual(pairs('etat: info'), []);
});

test('lignes qui ne sont pas des mesures : ignorées', () => {
  for (const s of ['', '   ', 'Démarrage du programme', 'Erreur 404', '— UNO démarre —', '192.168.1.10', 'valeur = 12', 'etat:ON', 'OK!', '12abc']) assert.equal(P(s), null, s);
  assert.equal(P(null), null);
});
