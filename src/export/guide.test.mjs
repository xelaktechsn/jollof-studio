// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du guide de montage (guide.js) : node --test src/export/guide.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { guideHtml, billOf, wireCount, stepText } from './guide.js';

const PX = 'data:image/jpeg;base64,/9j/4AAQ';
const step = (a, b, color, colorName, extra = {}) => ({ img: PX, a: { comp: a[0], pin: a[1] }, b: { comp: b[0], pin: b[1] }, color, colorName, ...extra });
const base = () => ({
  title: 'Feu <rouge>', lang: 'fr', date: '2026-11-20', cover: PX, checked: true, issues: [], program: true, footer: 'Jollof Studio',
  comps: [{ name: 'UNO1', model: 'Arduino Uno' }, { name: 'LED1', model: 'LED rouge' }, { name: 'LED2', model: 'LED rouge' }, { name: 'R1', model: 'Résistance 220 Ω' }],
  steps: [step(['UNO1', 'D13'], ['R1', '1'], '#e5484d', 'Rouge', { role: 'Commande de la LED' }), step(['R1', '2'], ['LED1', 'A'], '#e5484d', 'Rouge'), step(['LED1', 'K'], ['UNO1', 'GND'], '#3a3f45', 'Noir')]
});

test('matériel regroupé par modèle, fils comptés par couleur', () => {
  assert.deepEqual(billOf(base().comps), [{ name: 'Arduino Uno', refs: ['UNO1'] }, { name: 'LED rouge', refs: ['LED1', 'LED2'] }, { name: 'Résistance 220 Ω', refs: ['R1'] }]);
  assert.deepEqual(wireCount(base().steps), [{ color: '#e5484d', name: 'Rouge', n: 2 }, { color: '#3a3f45', name: 'Noir', n: 1 }]);
});

test('une étape par fil, dans l’ordre, avec ses deux broches', () => {
  const html = guideHtml(base());
  assert.equal((html.match(/class="step"/g) || []).length, 4, 'trois fils et la mise sous tension');
  const i1 = html.indexOf('Étape 1 sur 3'), i2 = html.indexOf('Étape 2 sur 3'), i3 = html.indexOf('Étape 3 sur 3');
  assert.ok(i1 > 0 && i2 > i1 && i3 > i2);
  assert.match(stepText(base().steps[0]), /UNO1.*D13.*R1.*1.*fil rouge/);
  assert.ok(html.includes('Commande de la LED'));
  assert.ok(html.includes('Téléversez'));
  assert.ok(html.includes('Aucun problème détecté'));
  assert.ok(html.startsWith('<!doctype html>'));
});

test('textes échappés, images et couleurs douteuses écartées', () => {
  const o = base();
  o.steps[0].a.comp = '<script>alert(1)</script>'; o.steps[0].color = 'red;background:url(x)'; o.steps[1].img = 'javascript:alert(1)'; o.cover = 'https://exemple.test/x.png';
  o.issues = [{ level: 'error', text: 'LED1 <sans> résistance' }];
  const html = guideHtml(o);
  assert.equal(html.includes('<script>'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Feu &lt;rouge&gt;'));
  assert.equal(html.includes('url(x)'), false);
  assert.equal(html.includes('javascript:'), false);
  assert.equal(html.includes('exemple.test'), false);
  assert.ok(html.includes('LED1 &lt;sans&gt; résistance'));
  assert.match(html, /class="chk err"/);
});

test('sans vérification ni programme : sections absentes', () => {
  const html = guideHtml({ ...base(), checked: false, program: false });
  assert.equal(html.includes('Vérification du montage'), false);
  assert.equal(html.includes('Téléversez'), false);
});
