// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de la logique de l'assistant d'import DXF/DWG (cadimport-logic.js). Noms de calques inventés pour les tests.
// node --test src/net/ui/cadimport-logic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { guessKind, baseName, presetLayers, splitPrefix, groupLayers, nodeLayers, searchLayers, clusterAt, clusterOrder, clusterRegion, boxOf, countIn, unitsOf, guessUnits, sizeVerdict, doorWidth, KIND_IDS } from './cadimport-logic.js';

test('guessKind : noms FR/EN et codes AIA', () => {
  const cases = {
    'A-WALL': 'walls', 'A-WALL-PRHT': 'partitions', 'MURS PORTEURS': 'walls', 'Mur béton': 'walls', 'CLOISONS': 'partitions',
    'A-DOOR': 'doors', 'Portes': 'doors', 'Menuiseries ext': 'windows', 'A-GLAZ': 'windows', 'ELECTRICITE': 'elec', 'E-LITE': 'elec',
    'CFO prises': 'cfo', 'CFA': 'cfa', 'Courants faibles': 'cfa', 'VDI': 'cfa', 'MOBILIER': 'furniture', 'A-FURN': 'furniture', 'Mob bureau': 'furniture',
    'TEXTE': 'text', 'A-ANNO-TEXT': 'text', 'COTATIONS': 'dims', 'A-ANNO-DIMS': 'dims', 'Cotes': 'dims', 'DIM': 'dims',
    'HACHURES': 'hatch', 'A-PATT': 'hatch', 'Remplissages': 'hatch', 'POTEAUX': 'structure', 'S-COLS': 'structure', 'T-JACK': 'cfa',
    '0': 'other', 'Defpoints': 'other', 'XREF1$0$A-WALL': 'walls', 'ext|Portes': 'doors', 'Calque 12': 'other'
  };
  for (const [n, k] of Object.entries(cases)) assert.equal(guessKind(n), k, n);
  for (const k of new Set(Object.values(cases))) assert.ok(KIND_IDS.includes(k));
  assert.equal(baseName('A$0$B|MUR'), 'MUR');
});

test('presetLayers : préréglages, calques vides/éteints', () => {
  const L = [{ id: 0, name: 'MURS', count: 5 }, { id: 1, name: 'HACHURES', count: 9 }, { id: 2, name: 'CFA', count: 3 }, { id: 3, name: 'MOBILIER', count: 2 },
    { id: 4, name: 'COTES', count: 1 }, { id: 5, name: 'PORTES', count: 0 }, { id: 6, name: 'CLOISONS', count: 4, off: true }];
  assert.deepEqual([...presetLayers(L, 'clean')].sort(), [0, 2], 'recommandé : sans mobilier');
  assert.deepEqual([...presetLayers(L, 'archi')].sort(), [0]);
  assert.deepEqual([...presetLayers(L, 'archiElec')].sort(), [0, 2]);
  assert.deepEqual([...presetLayers(L, 'all')].sort(), [0, 1, 2, 3, 4, 6]);
  assert.equal(presetLayers(L, 'none').size, 0);
  assert.deepEqual([...presetLayers(L, 'nimporte')].sort(), [0, 2]);
});

test('splitPrefix et groupLayers : références externes et préfixes partagés', () => {
  assert.deepEqual(splitPrefix('X$0$MUR'), { prefix: 'X', rest: 'MUR', sep: '$0$' });
  assert.deepEqual(splitPrefix('ref|MUR_A'), { prefix: 'ref', rest: 'MUR_A', sep: '|' });
  assert.equal(splitPrefix('MUR'), null); assert.equal(splitPrefix('_MUR'), null); assert.equal(splitPrefix('MUR_'), null);
  const names = ['Alpha_MUR', 'Alpha_PORTE', 'Alpha_Beta_MUR', 'Alpha_Beta_TEXTE', 'Alpha_Beta_CFA', 'MUR', 'Lone_X', 'ref|A', 'ref|B', 'Gamma$0$C'];
  const L = names.map((name, id) => ({ id, name, count: id + 1 }));
  const t = groupLayers(L);
  assert.deepEqual(t.groups.map(g => g.label), ['Alpha', 'Gamma', 'ref']);
  const alpha = t.groups[0];
  assert.deepEqual(alpha.groups.map(g => g.label), ['Beta']);
  assert.deepEqual(alpha.groups[0].layers.sort(), [2, 3, 4]);
  assert.deepEqual(alpha.layers.sort(), [0, 1]);
  assert.equal(alpha.n, 5); assert.equal(alpha.count, 1 + 2 + 3 + 4 + 5);
  assert.deepEqual(t.layers.sort(), [5, 6], 'préfixe « _ » seul : pas de groupe');
  assert.equal(t.n, names.length); assert.equal(t.count, L.reduce((s, l) => s + l.count, 0));
  assert.deepEqual(nodeLayers(alpha).sort(), [0, 1, 2, 3, 4]);
  assert.deepEqual(groupLayers([]), { groups: [], layers: [], n: 0, count: 0 });
  // Borné : 5 000 calques au préfixe imbriqué, profondeur limitée.
  const deep = Array.from({ length: 5000 }, (_, i) => ({ id: i, name: 'a_b_c_d_e_f_' + i, count: 1 }));
  const td = groupLayers(deep); assert.equal(td.n, 5000);
  let lvl = 0, g = td; while (g.groups.length) { g = g.groups[0]; lvl++; } assert.equal(lvl, 3);
});

test('searchLayers : mots sans accents ni casse', () => {
  const L = [{ id: 0, name: 'Électricité RDC' }, { id: 1, name: 'MURS RDC' }, { id: 2, name: 'electricite R+1' }];
  assert.deepEqual([...searchLayers(L, 'electr rdc')], [0]);
  assert.deepEqual([...searchLayers(L, 'ELECTRICITÉ')].sort(), [0, 2]);
  assert.equal(searchLayers(L, '  '), null);
});

test('feuilles : choix au point, ordre de lecture, zone', () => {
  const C = [{ x0: 0, y0: 0, x1: 100, y1: 50, count: 10 }, { x0: 120, y0: 0, x1: 220, y1: 50, count: 20 }, { x0: 0, y0: -100, x1: 100, y1: -50, count: 5 }, { x0: 10, y0: 10, x1: 20, y1: 20, count: 1 }];
  assert.equal(clusterAt(C, 50, 25), 0); assert.equal(clusterAt(C, 15, 15), 3); assert.equal(clusterAt(C, 500, 500), -1); assert.equal(clusterAt(null, 0, 0), -1);
  assert.deepEqual(clusterOrder(C.slice(0, 3)), [0, 1, 2]);
  assert.deepEqual(clusterRegion(C[0], 0.1), [-10, -10, 110, 60]);
  assert.deepEqual(boxOf([5, 1], [2, 8]), [2, 1, 5, 8]);
});

/** Petit dessin en mm : deux portes (vantail 900 mm, arc découpé), un mur, un texte. */
function doc(units) {
  const segs = [], segLayer = [];
  const add = (l, x0, y0, x1, y1) => { segs.push(x0, y0, x1, y1); segLayer.push(l); };
  add(0, 0, 0, 10000, 0); add(0, 10000, 0, 10000, 6000);
  for (const ox of [1000, 4000, 7000]) { add(1, ox, 0, ox, 900); for (let a = 0; a < 6; a++) add(1, ox + 900 * Math.sin(a * Math.PI / 12), 900 * Math.cos(a * Math.PI / 12), ox + 900 * Math.sin((a + 1) * Math.PI / 12), 900 * Math.cos((a + 1) * Math.PI / 12)); add(1, ox, 0, ox + 50, 0); }
  return { units, insunits: units === 'mm' ? 4 : 0, extents: [0, 0, 10000, 6000], layers: [{ id: 0, name: 'MURS', count: 2 }, { id: 1, name: 'PORTES', count: 24 }],
    segs: new Float32Array(segs), segLayer: new Uint16Array(segLayer), texts: [{ x: 5000, y: 3000, h: 250, text: 'Bureau', layer: 'MURS' }, { x: 9e9, y: 0, h: 1, text: 'hors', layer: 0 }], clusters: [] };
}
test('unités : en-tête, sinon devinées ; largeur de porte mesurée', () => {
  assert.deepEqual(unitsOf(doc('mm')), { units: 'mm', toMetre: 0.001, from: 'header' });
  assert.equal(unitsOf({ insunits: 6, extents: [0, 0, 1, 1] }).units, 'm');
  assert.equal(unitsOf(doc('unitless')).from, 'size');
  assert.equal(guessUnits(60), 'm'); assert.equal(guessUnits(60000), 'mm'); assert.equal(guessUnits(6000), 'cm'); assert.equal(guessUnits(0), 'm');
  assert.equal(sizeVerdict(1), 'small'); assert.equal(sizeVerdict(50), 'ok'); assert.equal(sizeVerdict(5000), 'large');
  const d = doc('mm'), w = doorWidth(d, null, 0.001);
  assert.ok(w && Math.abs(w.w - 900) < 1, JSON.stringify(w)); assert.equal(w.n, 3);
  const g = doorWidth(d, null); assert.equal(g.units, 'mm');
  assert.equal(doorWidth(d, null, 1), null, 'en mètres, 900 m n’est pas une porte');
  assert.equal(doorWidth({ ...d, layers: [{ id: 0, name: 'MURS' }] }, null, 0.001), null);
});
test('countIn : segments et textes d’une zone pour des calques', () => {
  const d = doc('mm');
  assert.deepEqual(countIn(d, [0, 0, 10000, 6000], null), { segs: d.segLayer.length, texts: 1 });
  assert.deepEqual(countIn(d, [-1, -1, 2000, 1000], new Set([0])), { segs: 1, texts: 0 });
});
import { keywordsToRegex, regexKeywords } from './cadimport-logic.js';
test('motifs de textes : mots-clés ↔ expression régulière', () => {
  const ap = '^\\s*(WIFI|WI-FI|AP|BORNE)\\s*-?\\s*\\d+\\s*$', rj = '^\\s*(RJ\\s*45|PC|PRISE\\s*RJ\\s*45)(\\s*[x×]\\s*\\d)?\\s*$';
  assert.deepEqual(regexKeywords(ap), { words: ['WIFI', 'WI-FI', 'AP', 'BORNE'], suffix: 'number' });
  assert.deepEqual(regexKeywords(rj), { words: ['RJ 45', 'PC', 'PRISE RJ 45'], suffix: 'times' });
  for (const r of [ap, rj]) { const k = regexKeywords(r); assert.equal(keywordsToRegex(k.words, k.suffix), r); }
  const re = new RegExp(keywordsToRegex(['Borne wifi', 'A.P'], 'number'), 'i');
  assert.ok(re.test('borne  wifi-3')); assert.ok(re.test('A.P 12')); assert.ok(!re.test('AXP 12'));
  assert.equal(regexKeywords('^(a+)$'), null); assert.equal(regexKeywords('^\\s*(A[0-9])\\s*$'), null); assert.equal(regexKeywords(''), null);
  assert.equal(keywordsToRegex([]), '');
});
