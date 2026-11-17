// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Langage des règles : phrases, migration, code généré pour chaque construction. node --test src/prog/rules.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bench, rule, act, wait, set, goTo, variable, seq, step, go } from './rulekit.mjs';
import { ruleText, migrate, condText, SIGNALS } from './rules.js';

const M = bench('uno', ['button', 'led-red', 'servo', 'dht22', 'lcd1602']);
const L = M.c('LED1'), SV = M.c('SERVO1'), DHT = M.comps.find(c => c.type === 'dht22');
const byAny = rules => id => M.comps.find(c => c.id === id) || rules.find(r => r.id === id) || null;

test('phrases : dès que, depuis, marge, et / ou, variables, attentes, séquences', () => {
  const n = variable('compteur', 'int', 0, { persist: true }), A = step('Rouge'), B = step('Vert');
  A.go = [go(B, { after: 5000 })];
  const Q = seq('Feu', [A, B]);
  const r = rule(M.src('BTN1'), [set(n, '+', 1), act(L, 'on'), wait(2000), act(L, 'off'), goTo(Q, B)], [], { edge: true, more: [{ link: 'and', src: { comp: DHT.id, sig: 'temp' }, op: '>', v: 30, hyst: 2, hold: 10000 }] });
  const all = [n, Q, r], txt = ruleText(migrate(r), byAny(all), null);
  assert.equal(txt, 'Dès que BTN1 est appuyé et DHT221 · température dépasse 30 °C (retombe sous 28 °C) depuis 10 s : ajoute 1 à compteur, LED1 s’allume, attend 2 s, puis LED1 s’éteint, passe à l’étape Feu › Vert.'.replace('DHT221', DHT.name));
  assert.equal(ruleText(n, byAny(all), null), 'Variable compteur : nombre entier, 0 au départ, gardée hors tension.');
  assert.match(ruleText(Q, byAny(all), null), /^Séquence Feu : Rouge \(rien ; après 5 s → Vert\) · Vert \(rien\)\.$/);
  assert.equal(condText(migrate(rule({ every: 2000 }, [])), byAny(all), null), 'Toutes les 2 s');
  assert.equal(condText(migrate(rule({ comp: '@serial', sig: 'line' }, [], [], { op: '==', v: 'marche' })), byAny(all), null), 'Quand la ligne reçue reçoit « marche »');
});

test('migration : éléments inconnus retirés, champs bornés, ancien format', () => {
  const r = migrate({ src: null, dst: { comp: L.id, act: 'on' }, then: undefined, more: [{ src: null }], hold: -5 });
  assert.equal(r.kind, 'rule'); assert.equal(r.then[0].act, 'on'); assert.equal(r.more, undefined); assert.equal(r.hold, undefined);
  const v = migrate({ kind: 'var', name: '2 compteurs!', type: 'text', init: 'x'.repeat(100), len: 500 });
  assert.equal(v.name, '_2_compteurs_'); assert.equal(v.len, 64); assert.equal(v.init.length, 64);
  const q = migrate({ kind: 'seq', name: 'Feu', steps: [{ name: 'A', do: [{ kind: 'bogus' }, { kind: 'wait', ms: -3 }], go: [{ after: -1, to: null }] }] });
  assert.equal(q.steps[0].do.length, 1); assert.equal(q.steps[0].do[0].ms, 1); assert.equal(q.steps[0].go[0].after, 0);
});

test('code : sans String ni delay(), servo réécrit seulement quand l’angle change, mesure ratée écartée', () => {
  const code = M.code([rule(M.src('BTN1'), [act(SV, 'angle', 400)], [act(SV, 'angle', 10)])]);
  assert.ok(!/\bString\b/.test(code));
  assert.match(code, /if \(servo1_ordre != -2\) \{\n\s+servo1_ordre = -2;\n\s+servo1\.write\(180\);/, 'angle borné à 180 et écrit une seule fois');
  assert.match(code, new RegExp(`if \\(isnan\\(x\\)\\) \\{\\n\\s+if \\(${DHT.name.toLowerCase()}_echecs < 255\\)`), 'mesure ratée : la précédente reste');
  assert.match(code, /sleep_mode\(\);/);
  assert.ok(!/delay\(10\)/.test(code));
});

test('fait varier : plage vide sans division par zéro, mesure à virgule convertie en float', () => {
  const code = M.code([rule({ comp: DHT.id, sig: 'temp' }, [act(SV, 'follow', [0, 180])], [], { op: 'follow', from: [20, 20] })]);
  assert.match(code, /lroundf\(0 \+ \(constrain\(\w+, 20, 21\) - 20\) \* 180f\)/);
  assert.ok(Object.keys(SIGNALS.dht22).includes('fault'), 'le DHT22 a « est en panne »');
});
