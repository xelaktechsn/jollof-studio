// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de l'export DXF de la conception (src/net/dxfexport.js) : écrit, relu par notre lecteur (cad/dxf.js), calques,
// entités et coordonnées, avec et sans fond de plan importé (données synthétiques seulement).
// node --test src/net/dxfexport.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { designDxf, floorMapper, schemeOf, schemeChoices } from './dxfexport.js';
import { parseDxf } from './cad/dxf.js';
import * as LINT from './cad/dxflint.js';
import { cleanDesign, applyDesign } from './dimension.js';
import { labelOf } from './docs.js';
import { fixture } from './dimension.fixture.mjs';

const built = () => { const d = fixture(); d.design = cleanDesign({}); d.paths = [{ id: 'p1', floor: 'f0', kind: 'tray', pts: [[0.5, 6], [37, 6]], z: 2.7, w: 300, h: 60 }]; applyDesign(d); return d; };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b));
const outlets = (d, f) => d.devices.filter(x => /^outlet/.test(x.type) && x.loc && x.loc.floor === f);

test('sans fond : mètres du plan (y vers le haut), calques JOLLOF-…, relu par le lecteur DXF', async () => {
  const d = built(), r = designDxf(d, { scheme: 'simple' }), doc = await parseDxf(r.text);
  assert.equal(r.units, 'm'); assert.equal(doc.units, 'm'); assert.equal(r.under, 0); assert.equal(r.floors, 2);
  assert.match(r.text, /^[\x20-\x7e\r\n]*$/, 'ASCII seulement');
  const names = new Set(doc.layers.map(l => l.name));
  for (const n of ['JOLLOF-ROOMS', 'JOLLOF-OUTLETS', 'JOLLOF-CABLES', 'JOLLOF-RACKS', 'JOLLOF-LABELS']) assert.ok(names.has(n), n);
  const byLayer = n => doc.layers.find(l => l.name === n).count;
  assert.ok(byLayer('JOLLOF-ROOMS') > 0 && byLayer('JOLLOF-PATHWAYS') > 0 && byLayer('JOLLOF-CABLES') > 0 && byLayer('JOLLOF-RACKS') > 0);
  // Une prise par insertion du bloc, à sa place (x, −y) sur le premier étage, avec son identifiant en attribut.
  const o = outlets(d, 'f0')[0], ins = doc.inserts.filter(i => i.name === 'JOLLOF_OUTLET');
  assert.equal(ins.length, d.devices.filter(x => /^outlet/.test(x.type) && x.loc).length);
  const i = ins.find(z => z.attribs.LABEL === labelOf(d, o.id));
  assert.ok(i, 'insertion trouvée par son attribut');
  assert.ok(near(i.x + doc.origin[0], o.loc.x) && near(i.y + doc.origin[1], -o.loc.y), JSON.stringify([i.x + doc.origin[0], i.y + doc.origin[1], o.loc]));
  assert.ok(doc.texts.some(t => t.text === labelOf(d, o.id)), 'identifiant écrit en texte');
  // Le second étage est rangé à droite du premier, sans le recouvrir.
  const o1 = outlets(d, 'f1')[0], i1 = ins.find(z => z.attribs.LABEL === labelOf(d, o1.id));
  assert.ok(i1.x + doc.origin[0] > 38, 'R+1 à droite du RDC');
});

test('avec un fond importé : coordonnées du dessin d’origine (unités, origine, région, transformation)', async () => {
  const d = built();
  d.underlays = { f0: { id: 'u1', region: [-5000, 1000, 45000, 41000], origin: [1e6, 2e6], toMetre: 0.001, transform: { dx: 0, dy: 0, rot: 0, scale: 1 }, source: { units: 'mm' } } };
  const r = designDxf(d, { floors: ['f0'] }), doc = await parseDxf(r.text);
  assert.equal(r.units, 'mm'); assert.equal(doc.units, 'mm'); assert.equal(r.under, 1); assert.equal(r.floors, 1);
  const o = outlets(d, 'f0')[0], i = doc.inserts.find(z => z.attribs.LABEL === labelOf(d, o.id));
  // X = origine + région.x0 + x / toMetre ; Y = origine + région.y1 − y / toMetre
  assert.ok(near(i.x + doc.origin[0], 1e6 - 5000 + o.loc.x * 1000), String(i.x + doc.origin[0]));
  assert.ok(near(i.y + doc.origin[1], 2e6 + 41000 - o.loc.y * 1000), String(i.y + doc.origin[1]));
  assert.ok(near(i.sx, 300), 'symbole de 0,3 m = 300 mm');
  // Le paquet (meta) prime sur les champs du fond quand il existe.
  d.underlays.f0.pack = { region: [0, 0, 100, 100], origin: [10, 20], toMetre: 1 };
  const M = floorMapper(d, 'f0', { toMetre: 1 });
  assert.deepEqual(M.map(3, 4).map(v => +v.toFixed(6)), [13, 116]);
});

test('transformation du fond (rotation, échelle, décalage) : inverse exacte de celle du plan', () => {
  const t = { dx: 12.5, dy: -3, rot: 90, scale: 2 }, region = [100, 200, 300, 400], origin = [0, 0], tm = 0.01;
  const d = { ...fixture(), underlays: { f0: { id: 'u', region, origin, toMetre: tm, transform: t, source: { units: 'cm' } } } };
  const M = floorMapper(d, 'f0', { toMetre: tm });
  // point du fond p (m, y vers le bas) → étage W = T(p) comme la vue Plans (ulMatrix) → doit revenir au dessin.
  const a = t.rot * Math.PI / 180, c = Math.cos(a) * t.scale, n = Math.sin(a) * t.scale;
  for (const p of [[0, 0], [1.5, 0.75], [2, 2]]) {
    const W = [c * p[0] - n * p[1] + t.dx, n * p[0] + c * p[1] + t.dy], X = M.map(...W);
    assert.ok(near(X[0], region[0] + p[0] / tm) && near(X[1], region[3] - p[1] / tm), JSON.stringify([p, X]));
  }
  assert.ok(near(M.k, 1 / (t.scale * tm)), 'longueurs : 1 m d’étage = 1/(échelle × toMetre) unités');
});

test('schémas de calques AIA / NCS et ISO 13567, attributs des blocs (prises, points d’accès, baies, équipements)', async () => {
  const d = built();
  d.paths.push({ id: 'p2', floor: 'f1', kind: 'tray', pts: [[0.5, 6], [37, 6]], z: 2.7, w: 300, h: 60 }, { id: 'r1', floor: 'f0', kind: 'riser', pts: [[32, 6]], top: 'f1', z: 0, w: 300, h: 100 });
  d.devices.push({ id: 'cam1', type: 'camera', x: 0, y: 0, name: 'CAM1', p: { ip: { mode: 'static', ip: '10.1.0.50', prefix: 24, gw: '', dns: '' }, power: 'poe', poeClass: 3 }, loc: { floor: 'f0', x: 5, y: 6, h: 2.6 } });
  const r = designDxf(d), doc = await parseDxf(r.text), names = new Set(doc.layers.map(l => l.name));
  assert.equal(r.scheme, 'standard');
  const S = schemeOf('standard');
  for (const k of ['outlets', 'racks', 'cables', 'fibre', 'pathways', 'rooms', 'walls', 'devices']) assert.ok(names.has(S[k][0]), k + ' ' + S[k][0]);
  assert.match(S.outlets[0], /^T-/, 'discipline T (télécommunications)'); assert.match(S.walls[0], /^A-/, 'discipline A');
  const cnt = n => doc.layers.find(l => l.name === n).count;
  assert.ok(cnt(S.outlets[0]) > 0 && cnt(S.fibre[0]) > 0 && cnt(S.devices[0]) > 0, 'prises, fibre, équipements sur leurs calques');
  const ins = name => doc.inserts.filter(i => i.name === name);
  const o = ins('JOLLOF_OUTLET')[0]; assert.deepEqual(Object.keys(o.attribs).sort(), ['ID', 'LABEL', 'PORT', 'VLAN']);
  assert.match(o.attribs.VLAN, /^10/); assert.match(o.attribs.PORT, /^SW-/);
  const rk = ins('JOLLOF_RACK')[0]; assert.deepEqual(Object.keys(rk.attribs).sort(), ['NAME', 'ROOM', 'U']); assert.equal(rk.attribs.U, '42');
  const cam = ins('JOLLOF_DEVICE').find(i => i.attribs.NAME === 'CAM1'); assert.equal(cam.attribs.IP, '10.1.0.50/24'); assert.equal(cam.attribs.TYPE, 'camera');
  const iso = designDxf(d, { scheme: 'iso' }), di = await parseDxf(iso.text);
  for (const l of di.layers.filter(x => x.name !== '0')) assert.equal(l.name.length, 10, l.name + ' : 2 + 6 + 2 caractères');
  assert.ok(schemeChoices().length >= 3); assert.equal(designDxf(d, { scheme: 'simple' }).layers.every(n => n.startsWith('JOLLOF-')), true);
});

test('conformité à la référence DXF (dxflint) : aucun défaut, pour chaque schéma, avec et sans fond', () => {
  if (typeof LINT.lintDxf !== 'function') return;
  const d = built();
  for (const scheme of ['standard', 'iso', 'simple']) { const r = LINT.lintDxf(designDxf(d, { scheme }).text); assert.deepEqual([r.errors.length, r.warnings.length], [0, 0], scheme + ' ' + JSON.stringify(r.errors.slice(0, 3))); }
  d.underlays = { f0: { id: 'u1', region: [0, 0, 50000, 40000], origin: [1e6, 2e6], toMetre: 0.001, transform: { dx: 0, dy: 0, rot: 0, scale: 1 }, source: { units: 'mm' } } };
  const r = LINT.lintDxf(designDxf(d).text); assert.equal(r.errors.length, 0, JSON.stringify(r.errors.slice(0, 3)));
});
