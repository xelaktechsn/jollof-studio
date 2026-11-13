// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Réglage à part d'un capteur (comp.env) : deux capteurs du même type voient deux mesures différentes, le reste suit
// l'environnement commun. node --test src/sim/env.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const i18n = await import('../i18n/index.js');
await i18n.loadLanguage();
const { ENV, QUANT, MODELS, envOf, cleanEnv, advance, sample } = await import('./models.js');

test('envOf : réglage à part, sinon environnement commun ; cleanEnv borne et ignore l’inconnu', () => {
  ENV.dist = 100;
  assert.equal(envOf({}, 'dist'), 100);
  assert.equal(envOf({ env: { dist: 10 } }, 'dist'), 10);
  assert.equal(envOf({ env: { temp: 30 } }, 'dist'), 100, 'autre grandeur : commune');
  assert.deepEqual(cleanEnv({ dist: 9999, magnet: 1, nope: 3, temp: 'x' }), { dist: QUANT.dist.max, magnet: 1 });
  assert.equal(cleanEnv({ nope: 1 }), undefined);
  assert.equal(cleanEnv(null), undefined);
});

test('Deux capteurs infrarouges : l’un réglé à part détecte, l’autre suit la distance commune', () => {
  ENV.dist = 100;
  const m = MODELS.irobst, cx = { v: 5, prof: { logic: 5, adcBits: 10, vref: 5 } };
  const a = { type: 'irobst', inp: {}, env: { dist: 5 } }, b = { type: 'irobst', inp: {} };
  for (const c of [a, b]) { advance(c, m, 1); sample(c, m, cx, 0); }
  assert.notDeepEqual(a.simS.out.out, b.simS.out.out, 'sorties différentes');
  assert.equal(a.simS.phy.dist, 5); assert.equal(b.simS.phy.dist, 100);
  ENV.dist = 5; advance(b, m, 1);
  assert.equal(b.simS.phy.dist, 5, 'le commun suit l’environnement');
});
