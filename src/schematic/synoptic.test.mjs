// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du synoptique (synoptic.js) : node --test src/schematic/synoptic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { links, place, synopticSvg } from './synoptic.js';

const blocks = [
  { id: 'u', name: 'UNO', model: 'Arduino Uno', role: 'board' }, { id: 'd', name: 'DHT1', model: 'DHT22', role: 'in' },
  { id: 'r', name: 'R1', model: '220 Ω', role: 'other' }, { id: 'l', name: 'LED1', model: 'LED rouge', role: 'out' },
  { id: 'o', name: 'OLED1', model: 'OLED', role: 'out' }, { id: 'x', name: 'BZ1', model: 'Buzzer', role: 'out' }
];
const nets = [
  { name: '+5V', kind: 'pwr', pins: [['u', '5V'], ['d', 'VCC'], ['o', 'VCC']] },
  { name: 'GND', kind: 'gnd', pins: [['u', 'GND'], ['d', 'GND'], ['l', 'K'], ['o', 'GND'], ['bb', 'T-1']] },
  { name: 'D4', kind: 'sig', pins: [['u', 'D4'], ['d', 'DATA']] },
  { name: 'D7', kind: 'sig', pins: [['u', 'D7'], ['r', '1']] },
  { name: 'N1', kind: 'sig', pins: [['r', '2'], ['l', 'A']] },
  { name: 'A4', kind: 'sig', pins: [['u', 'A4 (2)'], ['o', 'SDA']] }, { name: 'A5', kind: 'sig', pins: [['u', 'A5'], ['o', 'SCL']] }
];

test('liens : depuis la carte avec ses broches, chaîne sans la carte, alimentations en étiquettes', () => {
  const { edges, power } = links(blocks, nets), e = (a, b) => edges.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  assert.equal(edges.length, 4);
  assert.deepEqual(e('u', 'd').labels, ['D4']);
  assert.deepEqual(e('u', 'o').labels, ['A4', 'A5'], 'deux nœuds, un seul lien ; suffixe de doublon retiré');
  assert.deepEqual(e('r', 'l').labels, [], 'nœud sans nom : lien sans étiquette');
  assert.equal(e('u', 'l'), undefined, 'la LED passe par la résistance');
  assert.deepEqual(power.get('d'), { rails: ['+5V'], gnd: true });
  assert.deepEqual(power.get('l'), { rails: [], gnd: true });
  assert.deepEqual(power.get('x'), { rails: [], gnd: false });
});

test('placement : carte au centre, entrées à gauche, sorties à droite, chaîne plus loin, isolés à part', () => {
  const { edges } = links(blocks, nets), { pos, lone } = place(blocks, edges);
  assert.equal(pos.get('u').col, 0);
  assert.equal(pos.get('d').col, -1);
  assert.equal(pos.get('o').col, 1);
  assert.equal(pos.get('r').col, 1, 'la résistance mène à une sortie : à droite');
  assert.equal(pos.get('l').col, 2, 'la LED est une colonne plus loin, du même côté que sa résistance');
  assert.deepEqual(lone, ['x']);
});

test('sans carte : le bloc le plus relié sert de centre', () => {
  const b = [{ id: 'a', name: 'BAT', role: 'other' }, { id: 'r', name: 'R1', role: 'other' }, { id: 'l', name: 'LED1', role: 'out' }];
  const n = [{ name: 'N1', kind: 'sig', pins: [['a', '+'], ['r', '1']] }, { name: 'N2', kind: 'sig', pins: [['r', '2'], ['l', 'A']] }];
  const { pos, lone } = place(b, links(b, n).edges);
  assert.equal(pos.get('r').col, 0); assert.equal(lone.length, 0);
});

test('SVG : autonome, un groupe par bloc, textes échappés', () => {
  const svg = synopticSvg({ title: 'Station <météo>', blocks: [...blocks, { id: 'z', name: '<b>X</b>', model: '"q"', role: 'other' }], nets, labels: { in: 'Entrées', out: 'Sorties', none: 'Non reliés' } });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.equal((svg.match(/class="bk /g) || []).length, 7);
  assert.equal((svg.match(/class="lk"/g) || []).length, 4);
  assert.ok(svg.includes('Station &lt;météo&gt;') && svg.includes('&lt;b&gt;X&lt;/b&gt;'));
  assert.equal(svg.includes('<b>'), false);
  assert.ok(svg.includes('A4, A5') && svg.includes('+5V · GND') && svg.includes('Non reliés'));
  assert.equal(/NaN|undefined/.test(svg), false);
  assert.ok(synopticSvg({ blocks: [], nets: [] }).includes('<svg'));
});
