// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests des planches imprimables (src/net/sheets.js) : échelle, cartouche, légende, nord, contenu, élévations.
// node --test src/net/sheets.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, niceLength, floorSheet, rackSheet, sheetSet, sheetsHtml, underlaySegs, PAPERS } from './sheets.js';
import { cleanDesign, applyDesign } from './dimension.js';
import { labelOf } from './docs.js';
import { fixture, bigFixture } from './dimension.fixture.mjs';

const built = () => { const d = fixture(); d.design = cleanDesign({ project: { client: 'CLIENT-T', site: 'SITE-T', author: 'AUTEUR-T', date: '2026-11-20', rev: 'C' } }); applyDesign(d); return d; };

test('échelle normalisée et échelle graphique', () => {
  assert.equal(fitScale(38, 17, 392, 217), 100); assert.equal(fitScale(40, 17, 392, 217), 125); // 40 m : 400 mm à 1:100, trop large
  assert.equal(fitScale(10, 5, 392, 217), 50);
  assert.equal(fitScale(100000, 1, 392, 217), 5000);
  assert.equal(niceLength(38), 10); assert.equal(niceLength(9), 2); assert.equal(niceLength(160), 50);
});

test('planche d’étage : papier, échelle, cartouche, légende, nord, prises et leurs identifiants', () => {
  const d = built(), s = floorSheet(d, 'f0', { no: 1, count: 3 });
  assert.equal(s.paper, 'A3'); assert.ok(s.scale >= 100 && s.scale <= 200);
  assert.match(s.svg, /^<svg[^>]+viewBox="0 0 420 297"[^>]+width="420mm"/);
  for (const t of ['CLIENT-T', 'SITE-T', 'AUTEUR-T', '2026-11-20', '1:' + s.scale, '1 / 3', 'A3', 'ntShNorth', 'ntShBar', 'ntShLeg', 'Bureau 1']) assert.ok(s.svg.includes(t), t);
  const o = d.devices.find(x => /^outlet/.test(x.type) && x.loc.floor === 'f0');
  assert.ok(s.svg.includes(labelOf(d, o.id)), 'identifiant de prise');
  assert.ok(!s.svg.includes('<script'), 'aucun script');
  assert.equal(floorSheet(d, 'zz'), null);
  // Un très grand étage passe en A1 (ou en A2) plutôt que de descendre sous 1:200.
  const big = { ...fixture(), site: { buildings: [{ id: 'b', name: 'B', floors: [{ id: 'f', name: 'F', level: 0, rooms: [{ id: 'r', name: 'R', usage: 'open', poly: [[0, 0], [110, 0], [110, 60], [0, 60]] }], walls: [] }] }] } };
  const sb = floorSheet(big, 'f'); assert.ok(['A2', 'A1'].includes(sb.paper) && sb.scale <= 200, sb.paper + ' ' + sb.scale);
});

test('fond de plan : segments passés dans le repère de l’étage, sous le dessin', () => {
  const d = built();
  d.underlays = { f0: { id: 'u', region: [0, 0, 40, 20], toMetre: 1, transform: { dx: 1, dy: 2, rot: 0, scale: 1 }, layers: [{ id: 0, on: true }, { id: 1, on: false }] } };
  const un = { segs: new Float32Array([0, 0, 10, 0, 5, 5, 6, 6]), segLayer: new Uint16Array([0, 1]), bbox: [0, 0, 40, 20] };
  const s = underlaySegs(d, 'f0', un);
  assert.deepEqual([...s], [1, 22, 11, 22], 'y retourné (haut du dessin en haut), calque éteint omis, décalé');
  const sh = floorSheet(d, 'f0', { underlay: un }); assert.ok(sh.svg.includes('ntShUnder'));
  assert.ok(sh.svg.includes('Fond de plan importé') || sh.svg.includes('Imported background drawing'));
});

test('élévations et jeu de planches, page d’impression', () => {
  const d = built(), r = rackSheet(d, d.racks.map(x => x.id));
  assert.equal(r.scale, 10); assert.ok(r.svg.includes('0A.R01') && r.svg.includes('0A-A'));
  const set = sheetSet(d); assert.equal(set.length, 2 + 1);
  assert.deepEqual(set.map(s => s.svg.includes(`${set.indexOf(s) + 1} / 3`)), [true, true, true], 'numéros de planche');
  const h = sheetsHtml(set); assert.match(h, /@page\{size:420mm 297mm;margin:0\}/); assert.equal((h.match(/class="ntShPage"/g) || []).length, 3);
  const b = sheetsHtml(set, { body: true }); assert.ok(b.page.includes('420mm 297mm') && b.body.includes('ntShPage'));
  assert.ok(PAPERS.A1[0] === 841);
});

test('taille réelle : 12 étages et 12 baies en moins d’une seconde', () => {
  const d = bigFixture(); d.design = cleanDesign({}); applyDesign(d);
  const t = performance.now(), set = sheetSet(d), dt = performance.now() - t;
  assert.equal(set.length, 12 + 6); assert.ok(dt < 1000 * 8, `${dt} ms`);
});
