// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de l'échange IFC : node --test src/net/interop/ifc.test.mjs
// Lecture STEP (step.js), GlobalId, lecture des fixtures écrites à la main (IFC4 en mètres et en millimètres, IFC2X3 en
// pieds), export du projet (ifcwrite.js) puis relecture (aller-retour des comptes, noms, jeux de propriétés, géométrie),
// import dans un projet (applyIfc), idempotence. Validation par IfcOpenShell si un Python qui l'a est trouvé
// (JOLLOF_IFC_PY, sinon python3) : sinon le test est sauté (outil d'essai, jamais livré).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stepIndex, parseArgs, decodeString, encodeString, encodeReal, stepWriter, ref, E, INT, T, DERIVED } from './step.js';
import { compressGuid, expandGuid, hash128, ifcGuid, writeIfc, devClass, simplify3 } from './ifcwrite.js';
import { readIfc, applyIfc, scaleModel, matOfName, usageOfName, devTypeOf, ifcSummary } from './ifc.js';
import { cleanNet } from '../clean.js';
import { newDevice, DEVICES } from '../devices.js';
import { fixture } from '../dimension.fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = n => fs.readFileSync(path.join(HERE, 'fixtures', n));
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
const ptEq = (p, q, e = 1e-3) => near(p[0], q[0], e) && near(p[1], q[1], e);

/* ---------- STEP ---------- */
test('STEP : chaînes codées \\X2\\ \\X\\ \\S\\ \\PA\\, apostrophes, barre oblique inverse', () => {
  assert.equal(decodeString("Salle de r\\X2\\00E9\\X0\\union"), 'Salle de réunion');
  assert.equal(decodeString('Mur b\\X\\E9ton'), 'Mur béton');
  assert.equal(decodeString('Caf\\S\\i'), 'Café');
  assert.equal(decodeString('\\PA\\\\S\\D'), 'Ä');
  assert.equal(decodeString("l''axe \\\\ x"), "l'axe \\ x");
  assert.equal(decodeString('\\X4\\0001F600\\X0\\'), '😀');
  for (const s of ['Bâtiment « A »', "l'été", 'a\\b', '😀 ok', 'Ωmega', '']) assert.equal(decodeString(encodeString(s).slice(1, -1)), s);
  assert.match(encodeString('é'), /^'\\X2\\00E9\\X0\\'$/);
  assert.ok(/^'[\x20-\x7e]*'$/.test(encodeString('Ünïcödé « » 😀')), 'ASCII imprimable seulement');
});
test('STEP : réels toujours avec un point, valeurs de toutes sortes', () => {
  assert.equal(encodeReal(1), '1.'); assert.equal(encodeReal(0), '0.'); assert.equal(encodeReal(-0), '0.'); assert.equal(encodeReal(0.25), '0.25');
  assert.equal(encodeReal(1e-5), '1.E-5'); assert.equal(encodeReal(-2.5), '-2.5');
  const s = "#5=X((1,2.5,-3.E2),$,*,.T.,#12,'a''b',IFCLABEL('x'),IFCINTEGER(3),(IFCLINEINDEX((1,2))),\"0F\");";
  const a = parseArgs(s, s.indexOf('(') + 1);
  assert.deepEqual(a[0], [1, 2.5, -300]); assert.equal(a[1], null); assert.equal(a[2], DERIVED); assert.deepEqual(a[3], { e: 'T' });
  assert.deepEqual(a[4], { r: 12 }); assert.equal(a[5], "a'b"); assert.deepEqual(a[6], { t: 'IFCLABEL', v: 'x' }); assert.deepEqual(a[7], { t: 'IFCINTEGER', v: 3 });
  assert.deepEqual(a[8], [{ t: 'IFCLINEINDEX', v: [1, 2] }]); assert.deepEqual(a[9], { bin: '0F' });
});
test('STEP : index (en-tête, commentaires, chaînes avec « ; », instances complexes), erreurs', () => {
  const W = stepWriter();
  const p = W.add('IFCCARTESIANPOINT', [[0, 0, 0]]);
  W.add('IFCLABELTEST', ["texte ; avec ) et /* pas un commentaire */", ref(p), E('X'), INT(4), T('IFCLABEL', 'é')]);
  let txt = W.text({ name: 'n.ifc', schema: 'IFC4' });
  txt = txt.replace('DATA;', 'DATA;\n/* commentaire ; ( */\n#99=(IFCA()IFCB(1));');
  const X = stepIndex(txt);
  assert.deepEqual(X.schema, ['IFC4']);
  assert.equal(X.header.FILE_NAME[0], 'n.ifc');
  assert.equal(X.count, 3);
  const e = X.get(2);
  assert.equal(e.type, 'IFCLABELTEST'); assert.equal(e.args[0], 'texte ; avec ) et /* pas un commentaire */'); assert.deepEqual(e.args[1], { r: 1 }); assert.equal(e.args[3], 4); assert.deepEqual(e.args[4], { t: 'IFCLABEL', v: 'é' });
  assert.equal(X.get(99).type, '(COMPLEX)');
  assert.throws(() => stepIndex('hello'), /STEP/);
  assert.throws(() => stepIndex('ISO-10303-21;\nHEADER;\nENDSEC;\n'), /DATA/);
});

/* ---------- GlobalId ---------- */
test('GlobalId : 22 caractères de l’alphabet IFC, aller-retour, vecteurs connus, stabilité', () => {
  assert.equal(compressGuid(new Uint8Array(16)), '0000000000000000000000');
  assert.equal(compressGuid(new Uint8Array(16).fill(255)), '3$$$$$$$$$$$$$$$$$$$$$');
  // Vecteur calculé par IfcOpenShell 0.9 (ifcopenshell.guid.compress('0f1e2d3c4b5a69788796a5b4c3d2e1f0'), outil d'essai).
  const b = Uint8Array.from('0f1e2d3c4b5a69788796a5b4c3d2e1f0'.match(/../g).map(h => parseInt(h, 16)));
  assert.equal(compressGuid(b), '0F7YqyIrffU8UMfRJ3qk7m');
  for (let i = 0; i < 200; i++) {
    const g = ifcGuid('sel', 'objet' + i);
    assert.match(g, /^[0-3][0-9A-Za-z_$]{21}$/);
    assert.deepEqual([...expandGuid(g)], [...hash128('sel\u0001objet' + i)]);
  }
  assert.equal(ifcGuid('a', 'x'), ifcGuid('a', 'x'));
  assert.notEqual(ifcGuid('a', 'x'), ifcGuid('b', 'x'));
  const seen = new Set(); for (let i = 0; i < 20000; i++) seen.add(ifcGuid('p', 'dev:sw' + i)); assert.equal(seen.size, 20000);
  assert.equal(expandGuid('trop court'), null); assert.equal(expandGuid('4' + '0'.repeat(21)), null);
});

/* ---------- Lecture des fixtures ---------- */
test('lecture IFC4 en mètres : bâtiment tourné, pièces, murs (axe, corps seul), porte, réseau, jeux', () => {
  const m = readIfc(FX('office-ifc4.ifc'));
  assert.equal(m.schema, 'IFC4'); assert.equal(m.units.length.toMetre, 1); assert.deepEqual(m.warnings, []);
  assert.equal(m.buildings.length, 1);
  const B = m.buildings[0]; assert.equal(B.name, 'Office block'); assert.deepEqual(B.shift, [1, 7]);
  const [s0, s1] = B.storeys;
  assert.equal(s0.name, 'Level 0'); assert.equal(s0.elev, 0); assert.equal(s0.height, 3.2); assert.equal(s0.level, 0);
  assert.equal(s1.elev, 3.2); assert.equal(s1.level, 1); assert.equal(s1.height, 3);
  const office = s0.spaces.find(x => x.name === '101');
  assert.equal(office.label, '101 Office'); assert.equal(office.from, 'extrusion');
  for (const q of [[1, 7], [7, 7], [7, 3], [1, 3]]) assert.ok(office.poly.some(p => ptEq(p, q)), 'sommet ' + q);
  const corr = s0.spaces.find(x => x.name === '102'); assert.ok(corr.poly.some(p => ptEq(p, [1, 1])) && corr.poly.some(p => ptEq(p, [7, 3])));
  assert.equal(s1.spaces[0].label, '201 Salle de réunion');
  assert.ok(s1.spaces[0].poly.some(p => ptEq(p, [5, 3])));
  const w1 = s0.walls.find(w => w.name === 'W1'), w2 = s0.walls.find(w => w.name === 'W2'), w3 = s0.walls.find(w => w.name === 'W3');
  assert.ok(ptEq(w1.a, [1, 7]) && ptEq(w1.b, [7, 7])); assert.equal(w1.t, 0.2); assert.equal(w1.mat, 'brick'); assert.equal(w1.matName, 'Brick masonry');
  assert.ok(ptEq(w2.a, [7, 7]) && ptEq(w2.b, [7, 1]));
  assert.equal(w3.t, 0.1); assert.equal(w3.mat, 'drywall'); assert.ok([w3.a, w3.b].some(p => ptEq(p, [1, 3])) && [w3.a, w3.b].some(p => ptEq(p, [7, 3])));
  assert.equal(s0.doors.length, 1); const d = s0.doors[0]; assert.equal(d.wall, w1.key); assert.equal(d.at, 2.45); assert.equal(d.w, 0.9); assert.equal(d.via, 'opening');
  const sw = s0.devices.find(x => x.name === 'SW-01'); assert.equal(sw.pt, 'NETWORKBRIDGE'); assert.ok(near(sw.x, 6.5) && near(sw.y, 6) && near(sw.h, 2));
  assert.equal(sw.psets.Pset_ManufacturerTypeInformation.Manufacturer, 'Acme');
  assert.equal(devTypeOf(sw), 'switch24'); assert.equal(devTypeOf(s0.devices.find(x => x.name === 'Outlet A')), 'outlet2'); assert.equal(devTypeOf(s0.devices.find(x => x.name === 'AP-01')), 'ap');
  const tray = s0.carriers[0]; assert.deepEqual(tray.pts, [[1.5, 2], [6.5, 2], [6.5, 6]]); assert.equal(tray.z, 2.7); assert.equal(tray.psets.Pset_CableCarrierSegmentTypeCableTraySegment.NominalWidth, 0.3);
  assert.equal(s0.cables.length, 1); assert.equal(m.systems[0].pt, 'DATA');
  assert.deepEqual(m.counts, { spaces: 3, walls: 3, doors: 1, devices: 3, carriers: 1, cables: 1 });
});
test('lecture IFC2X3 en pieds (IfcConversionBasedUnit), IfcWallStandardCase, nom \\S\\', () => {
  const m = readIfc(FX('annex-ifc2x3-feet.ifc'));
  assert.equal(m.schema, 'IFC2X3'); assert.equal(m.units.length.name, 'FOOT'); assert.equal(m.units.length.toMetre, 0.3048); assert.equal(m.units.length.kind, 'conversion');
  const s = m.buildings[0].storeys[0];
  assert.equal(s.elev, 3.048); assert.equal(s.height, 2.743);
  assert.equal(s.spaces[0].label, 'B-1 Café');
  const xs = s.spaces[0].poly.map(p => p[0]), ys = s.spaces[0].poly.map(p => p[1]);
  assert.ok(near(Math.max(...xs) - Math.min(...xs), 6.096) && near(Math.max(...ys) - Math.min(...ys), 4.572));
  const a = s.walls.find(w => w.name === 'Wall A'); assert.equal(a.t, 0.152); assert.equal(a.mat, 'concrete'); assert.ok(near(Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]), 6.096));
  assert.equal(s.walls.find(w => w.name === 'Wall B').t, 0.152);
  assert.equal(s.doors[0].wall, a.key); assert.ok(near(s.doors[0].at, 1.981) && near(s.doors[0].w, 0.914));
});
test('lecture IFC4 en millimètres : IfcIndexedPolyCurve, boîte englobante, mur découpé, IfcMappedItem, \\X\\', () => {
  const m = readIfc(FX('hall-ifc4-mm.ifc'));
  assert.equal(m.units.length.toMetre, 0.001); assert.equal(m.units.length.name, 'MILLIMETRE');
  assert.deepEqual(m.warnings.map(w => w.code), ['spaceBbox']);
  const s = m.buildings[0].storeys[0];
  const L = s.spaces.find(x => x.name === 'L1'); assert.equal(L.poly.length, 6); assert.ok(L.poly.some(p => ptEq(p, [5, 4])));
  const box = s.spaces.find(x => x.name === 'S2'); assert.equal(box.from, 'bbox'); assert.ok(box.poly.some(p => ptEq(p, [10, 5])) && box.poly.some(p => ptEq(p, [13, 7])));
  assert.equal(usageOfName(box.label), 'tr');
  const w = s.walls[0]; assert.equal(w.name, 'Mur béton'); assert.equal(w.t, 0.2); assert.equal(w.mat, 'concrete'); assert.equal(w.matName, 'Béton armé');
  assert.ok(near(Math.abs(w.b[0] - w.a[0]), 8) && near(w.a[1], 7.1));
  const r = s.devices[0]; assert.equal(r.pt, 'ROUTER'); assert.ok(near(r.x, 3) && near(r.y, 5.5) && near(r.h, 2.7)); assert.equal(devTypeOf(r), 'routerpro');
});
test('mots-clés : matériaux et usages', () => {
  assert.equal(matOfName('Plaque de plâtre BA13', 0.07), 'drywall'); assert.equal(matOfName('Parpaing creux', 0.2), 'block'); assert.equal(matOfName('Verre feuilleté'), 'glass');
  assert.equal(matOfName('', 0.1), 'drywall'); assert.equal(matOfName('', 0.25), 'block');
  assert.equal(usageOfName('Salle de réunion 2'), 'meeting'); assert.equal(usageOfName('WC hommes'), 'sanitary'); assert.equal(usageOfName('Couloir'), 'corridor'); assert.equal(usageOfName('Office 12'), 'office');
});

/* ---------- Export ---------- */
/** Petit projet : deux étages du gabarit de conception, des équipements placés, câbles, cheminement, baie, VLAN. */
function project() {
  const d = fixture();
  d.site.buildings[0].floors[0].doors = [{ id: 'dr1', wall: 'f0-b1-w0', at: 2.5, w: 0.9 }];
  const used = new Set(), add = (type, id, at) => { const x = newDevice(type, used, { x: 0, y: 0 }); x.id = id; used.add(x.name); Object.assign(x, at); d.devices.push(x); return x; };
  add('switch24', 'sw1', { rack: { id: 'rk1', u: 40, face: 'front' } });
  add('patch24', 'pp1', { rack: { id: 'rk1', u: 42, face: 'front' } });
  add('outlet2', 'o1', { loc: { floor: 'f0', x: 2, y: 0.2, h: 0.3 } });
  add('outlet2', 'o2', { loc: { floor: 'f1', x: 4, y: 0.2, h: 0.3 } });
  add('ap6', 'ap1', { loc: { floor: 'f0', x: 20, y: 5, h: 2.8 } });
  add('pc', 'pc1', { loc: { floor: 'f0', x: 2.2, y: 1, h: 0.75 } });
  add('pc', 'pc9', {}); // sans place
  d.devices.find(x => x.id === 'sw1').p.ports = { p1: { vlan: 20 }, p2: { vlan: 30 } };
  d.paths = [{ id: 'pa1', floor: 'f0', kind: 'tray', name: 'Couloir', pts: [[1, 6], [33, 6]], z: 2.7, w: 300, h: 60 }, { id: 'pa2', floor: 'f0', kind: 'conduit', pts: [[2, 6], [2, 1]], z: 2.5, dia: 25 }, { id: 'pa3', floor: 'f0', kind: 'riser', pts: [[31, 7]], top: 'f1' }];
  d.cables = [
    { id: 'c1', a: ['o1', 'back1'], b: ['pp1', 'b1'], cat: 'cat6a', len: 20, route: { mode: 'auto' } },
    { id: 'c2', a: ['pp1', 'f1'], b: ['sw1', 'p1'], cat: 'cat6a', len: 1 },
    { id: 'c3', a: ['pc1', 'eth0'], b: ['o1', 'front1'], cat: 'cat6', len: 3 },
    { id: 'c4', a: ['ap1', 'eth0'], b: ['sw1', 'p2'], cat: 'cat6a', len: 30, route: { mode: 'auto' } },
    { id: 'c5', a: ['o2', 'back1'], b: ['pp1', 'b2'], cat: 'cat6a', len: 25, route: { mode: 'auto' } }
  ];
  d.vlans = [{ id: 20, name: 'DATA' }, { id: 30, name: 'WIFI' }];
  return cleanNet(d);
}
test('export : IFC4 valide pour notre lecteur, aller-retour des comptes, noms, jeux et géométrie', () => {
  const data = project(), r = writeIfc(data, { time: '2026-11-21T10:00:00' });
  assert.match(r.text, /^ISO-10303-21;\nHEADER;/); assert.match(r.text, /FILE_SCHEMA\(\('IFC4'\)\);/); assert.ok(/^[\x0a\x20-\x7e]*$/.test(r.text), 'fichier ASCII');
  const st = r.stats;
  assert.equal(st.storeys, 2); assert.equal(st.spaces, 14); assert.equal(st.walls, 56); assert.equal(st.doors, 1);
  assert.equal(st.appliances, 5); assert.equal(st.outlets, 2); assert.equal(st.cables, 5); assert.equal(st.carriers, 3); assert.equal(st.racks, 1); assert.equal(st.unplaced, 1);
  assert.equal(st.connections, 10);
  // GlobalId : tous valables et tous différents.
  const ids = [...r.text.matchAll(/=IFC[A-Z0-9]+\('([0-9A-Za-z_$]{22})'/g)].map(x => x[1]);
  assert.ok(ids.length > 300); assert.equal(new Set(ids).size, ids.length); for (const g of ids) assert.ok(expandGuid(g), g);
  // Relecture.
  const m = readIfc(r.text);
  assert.deepEqual(m.warnings, []); assert.equal(m.schema, 'IFC4'); assert.deepEqual(m.buildings[0].shift, [0, 0]);
  const [s0, s1] = m.buildings[0].storeys;
  assert.equal(s0.name, 'RDC'); assert.equal(s1.name, 'R+1'); assert.equal(s1.elev, 3.5); assert.equal(s0.height, 3.5);
  const F0 = data.site.buildings[0].floors[0];
  assert.deepEqual(s0.spaces.map(x => x.label).sort(), F0.rooms.map(x => x.name).sort());
  for (const room of F0.rooms) { const sp = s0.spaces.find(x => x.label === room.name); for (const q of room.poly) assert.ok(sp.poly.some(p => ptEq(p, q)), room.name); assert.equal(sp.psets.JOLLOF_Network.Usage, room.usage); }
  for (const w of F0.walls) { const x = s0.walls.find(k => k.name === w.id); assert.ok(ptEq(x.a, w.a) && ptEq(x.b, w.b)); assert.equal(x.t, w.t); assert.equal(x.mat, w.mat); }
  assert.equal(s0.doors[0].at, 2.5); assert.equal(s0.doors[0].w, 0.9); assert.equal(s0.doors[0].via, 'opening');
  const ap = s0.devices.find(x => x.psets.JOLLOF_Network.Type === 'ap6');
  assert.equal(ap.cls, 'IFCCOMMUNICATIONSAPPLIANCE'); assert.equal(ap.pt, 'USERDEFINED'); assert.equal(ap.ot, 'WIRELESSACCESSPOINT'); assert.ok(near(ap.x, 20) && near(ap.y, 5) && near(ap.h, 2.8));
  assert.equal(ap.psets.JOLLOF_Network.VLAN, '30');
  const sw = s0.devices.find(x => x.psets.JOLLOF_Network.Type === 'switch24');
  assert.equal(sw.pt, 'NETWORKBRIDGE'); assert.equal(sw.psets.JOLLOF_Network.Rack, 'Baie 1'); assert.equal(sw.psets.JOLLOF_Network.U, 40); assert.equal(sw.psets.JOLLOF_Network.VLAN, '20,30');
  assert.equal(s0.devices.find(x => x.psets.JOLLOF_Network.Type === 'pc').psets.JOLLOF_Network.VLAN, '20', 'VLAN atteint au travers de la prise et du panneau');
  const cab = s0.cables.find(x => x.psets.JOLLOF_Network.Id === 'c1');
  assert.equal(cab.psets.JOLLOF_Network.Category, 'Cat 6A'); assert.equal(cab.psets.JOLLOF_Network.Media, 'copper'); assert.ok(cab.psets.JOLLOF_Network.Length > 0); assert.ok(cab.psets.Pset_CableSegmentTypeCableSegment.OverallDiameter > 0.004);
  const tray = s0.carriers.find(x => x.name === 'Couloir'); assert.equal(tray.pt, 'CABLETRAYSEGMENT'); assert.deepEqual(tray.pts, [[1, 6], [33, 6]]); assert.equal(tray.psets.Pset_CableCarrierSegmentTypeCableTraySegment.NominalWidth, 0.3);
  assert.equal(s0.carriers.find(x => x.psets.JOLLOF_Network.Id === 'pa3').vertical, true);
  assert.equal(m.systems.length, 1); assert.equal(m.systems[0].pt, 'DATA');
  // Ports et connexions : chaque câble entre deux équipements exportés relie deux ports.
  const X = stepIndex(r.text); assert.equal(X.ofType('IFCRELCONNECTSPORTS').length, 10); assert.equal(X.ofType('IFCDISTRIBUTIONSYSTEM').length, 1);
  assert.equal(X.ofType('IFCRELASSIGNSTOGROUP').length, 1); assert.equal(X.get(X.ofType('IFCRELASSIGNSTOGROUP')[0]).args[4].length, 12);
});
test('export : idempotent (mêmes GlobalId et même texte), options sans murs ni ports', () => {
  const a = writeIfc(project(), { time: '2026-11-21T10:00:00' }).text, b = writeIfc(project(), { time: '2026-11-21T10:00:00' }).text;
  assert.equal(a, b);
  const c = writeIfc(project(), { time: '2026-11-21T10:00:00', walls: false, ports: false, cables: false });
  assert.equal(c.stats.walls, 0); assert.equal(c.stats.ports, 0); assert.ok(!/IFCSWEPTDISKSOLID/.test(c.text)); assert.ok(/IFCCABLESEGMENT/.test(c.text));
  const g = t => [...t.matchAll(/IFCSPACE\('([^']+)'/g)].map(x => x[1]).sort();
  assert.deepEqual(g(a), g(c.text), 'les pièces gardent leur GlobalId');
});
test('export : Reference View 1.2 par défaut (concepts de la vue seulement), vue « conception » avec axes et couches', () => {
  const rv = writeIfc(project(), { time: '2026-11-21T10:00:00' }).text, de = writeIfc(project(), { time: '2026-11-21T10:00:00', view: 'design' }).text;
  assert.match(rv, /FILE_DESCRIPTION\(\('ViewDefinition \[ReferenceView_V1\.2\]'/);
  for (const t of ['IFCPOLYLINE(', 'IFCRECTANGLEPROFILEDEF', 'IFCCIRCLEPROFILEDEF', 'IFCAXIS2PLACEMENT2D', 'IFCMATERIALLAYERSETUSAGE', 'IFCSWEPTDISKSOLID', "'Axis'"]) assert.ok(!rv.includes(t), 'RV sans ' + t);
  assert.ok(rv.includes('IFCINDEXEDPOLYCURVE') && rv.includes('IFCARBITRARYCLOSEDPROFILEDEF'));
  assert.match(de, /ViewDefinition \[NotAssigned\]/);
  for (const t of ['IFCMATERIALLAYERSETUSAGE', 'IFCSWEPTDISKSOLID', "'Axis'"]) assert.ok(de.includes(t), 'conception avec ' + t);
  // Les deux se relisent de même (murs : axe en conception, corps en RV).
  const a = readIfc(rv), b = readIfc(de);
  assert.deepEqual(a.counts, b.counts);
  const wa = a.buildings[0].storeys[0].walls, wb = b.buildings[0].storeys[0].walls;
  wa.forEach((w, i) => { assert.ok(ptEq(w.a, wb[i].a) && ptEq(w.b, wb[i].b), w.name); assert.equal(w.t, wb[i].t); });
});
test('export : choix des étages', () => {
  const data = project(), f1 = data.site.buildings[0].floors[1].id, r = writeIfc(data, { time: '2026-11-21T10:00:00', floors: [f1] });
  assert.equal(r.stats.storeys, 1); assert.equal(r.stats.spaces, 7); assert.equal(r.stats.outlets, 1);
  const m = readIfc(r.text); assert.deepEqual(m.buildings[0].storeys.map(s => s.name), ['R+1']);
});
test('correspondances : classes et énumérations IFC4 des équipements', () => {
  assert.deepEqual(devClass('switch48'), { cls: 'IFCCOMMUNICATIONSAPPLIANCE', pt: 'NETWORKBRIDGE', ot: null });
  assert.deepEqual(devClass('routerpro'), { cls: 'IFCCOMMUNICATIONSAPPLIANCE', pt: 'ROUTER', ot: null });
  assert.deepEqual(devClass('outlet'), { cls: 'IFCOUTLET', pt: 'DATAOUTLET', ot: null });
  assert.equal(devClass('l3switch').ot, 'L3SWITCH'); assert.equal(devClass('cablemgr'), null);
  const enumOk = new Set(['ANTENNA', 'COMPUTER', 'FAX', 'GATEWAY', 'MODEM', 'NETWORKAPPLIANCE', 'NETWORKBRIDGE', 'NETWORKHUB', 'PRINTER', 'REPEATER', 'ROUTER', 'SCANNER', 'USERDEFINED', 'NOTDEFINED']);
  for (const t of Object.keys(DEVICES)) { const k = devClass(t); if (k && k.cls === 'IFCCOMMUNICATIONSAPPLIANCE') { assert.ok(enumOk.has(k.pt), t); assert.equal(!!k.ot, k.pt === 'USERDEFINED', t); } }
});
test('polyligne des câbles : sans aller-retour ni points alignés', () => {
  assert.deepEqual(simplify3([[0, 0, 0], [0, 0, 1], [2, 0, 1], [1, 0, 1], [1, 0, 0]]), [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]]);
  assert.deepEqual(simplify3([[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0]]), [[0, 0, 0], [2, 0, 0], [2, 1, 0]]);
});

/* ---------- Import dans le projet ---------- */
test('import : un seul passage, étages neufs, murs et portes reliés, re-import sans doublon', () => {
  const data = cleanNet({});
  const nd = (type, at) => { const x = newDevice(type, new Set(data.devices.map(z => z.name)), at); x.id = type + data.devices.length; data.devices.push(x); return x; };
  const m = readIfc(FX('office-ifc4.ifc'));
  const r = applyIfc(data, m, { what: { rooms: true, walls: true, doors: true, devices: true, paths: true } }, { newDevice: nd });
  assert.deepEqual(r.counts, { rooms: 3, walls: 3, doors: 1, devices: 3, paths: 1, floors: 2, buildings: 1 });
  const c = cleanNet(data), b = c.site.buildings[0], f0 = b.floors[0];
  assert.equal(b.name, 'Office block'); assert.equal(f0.name, 'Level 0'); assert.equal(b.floors[1].elev, 3.2);
  assert.equal(f0.rooms.length, 2); assert.equal(f0.walls.length, 3); assert.equal(f0.doors.length, 1);
  assert.equal(f0.doors[0].wall, f0.walls.find(w => w.mat === 'brick' && near(w.a[1], 7) && near(w.b[1], 7)).id);
  assert.equal(f0.rooms.find(x => x.name === '102 Corridor').usage, 'corridor');
  assert.deepEqual(c.devices.map(x => x.type).sort(), ['ap', 'outlet2', 'switch24']);
  assert.deepEqual(c.devices.find(x => x.type === 'switch24').loc, { floor: f0.id, x: 6.5, y: 6, h: 2 });
  assert.equal(c.paths[0].kind, 'tray'); assert.equal(c.paths[0].w, 300); assert.ok(near(c.paths[0].z, 2.67));
  // Re-import des mêmes étages, vers ces étages : remplacé, pas doublé.
  const choice = { storeys: {}, what: { rooms: true, walls: true, doors: true, devices: true, paths: true } };
  m.buildings[0].storeys.forEach((s, i) => { choice.storeys[s.key] = { on: true, building: b.id, target: b.floors[i].id }; });
  applyIfc(c, m, choice, { newDevice: (type, at) => { const x = newDevice(type, new Set(c.devices.map(z => z.name)), at); x.id = 'n' + c.devices.length; c.devices.push(x); return x; } });
  const c2 = cleanNet(c);
  assert.equal(c2.site.buildings.length, 1); assert.equal(c2.site.buildings[0].floors[0].rooms.length, 2); assert.equal(c2.site.buildings[0].floors[0].walls.length, 3);
  assert.equal(c2.devices.length, 3); assert.equal(c2.paths.length, 1);
  assert.deepEqual(cleanNet(c2), c2, 'modèle stable');
});
test('import : unité corrigée (scaleModel), étage décoché, sans équipements par défaut', () => {
  const m = readIfc(FX('hall-ifc4-mm.ifc')), k = 0.5, s = scaleModel(m, k);
  assert.ok(near(s.buildings[0].storeys[0].walls[0].t, 0.1));
  const data = cleanNet({}), r = applyIfc(data, s, {}, {});
  assert.equal(r.counts.devices, 0); assert.equal(r.counts.rooms, 2);
  const data2 = cleanNet({}), key = m.buildings[0].storeys[0].key;
  assert.equal(applyIfc(data2, m, { storeys: { [key]: { on: false } } }).floors.length, 0);
});
test('aller-retour complet : export du gabarit puis import dans un projet vide', () => {
  const src = project(), m = readIfc(writeIfc(src, { time: '2026-11-21T10:00:00' }).text);
  const data = cleanNet({});
  const nd = (type, at) => { const x = newDevice(type, new Set(data.devices.map(z => z.name)), at); x.id = 'i' + data.devices.length; data.devices.push(x); return x; };
  applyIfc(data, m, { what: { rooms: true, walls: true, doors: true, devices: true, paths: true } }, { newDevice: nd });
  const c = cleanNet(data), A = src.site.buildings[0].floors, B = c.site.buildings[0].floors;
  for (let i = 0; i < 2; i++) {
    assert.equal(B[i].rooms.length, A[i].rooms.length); assert.equal(B[i].walls.length, A[i].walls.length); assert.equal(B[i].doors.length, A[i].doors.length);
    A[i].rooms.forEach(r => { const q = B[i].rooms.find(x => x.name === r.name); assert.equal(q.usage, r.usage); r.poly.forEach((p, k) => assert.ok(ptEq(p, q.poly[k]), r.name)); });
  }
  assert.equal(B[0].doors[0].at, 2.5);
  // Équipements (ceux rangés en baie deviennent des équipements placés ; celui sans place reste sans place) : mêmes types.
  assert.deepEqual(c.devices.map(d => d.type).sort(), src.devices.map(d => d.type).sort());
  assert.equal(c.devices.filter(d => !d.loc).length, 1);
  const p = c.paths.find(x => x.name === 'Couloir'); assert.deepEqual(p.pts, [[1, 6], [33, 6]]); assert.ok(near(p.z, 2.7)); assert.equal(p.w, 300); assert.equal(p.h, 60);
  assert.equal(c.paths.find(x => x.kind === 'conduit').dia, 25); assert.equal(c.paths.filter(x => x.kind === 'riser').length, 1);
  assert.equal(ifcSummary(m).counts.cables, 5);
});

/* ---------- Échelle ---------- */
test('échelle : export et relecture d’un projet de 3 bâtiments × 4 étages en moins de 2 s', async () => {
  const { bigFixture } = await import('../dimension.fixture.mjs');
  const d = bigFixture(3, 4), used = new Set();
  for (const b of d.site.buildings) for (const f of b.floors) for (const r of f.rooms) for (let i = 0; i < 4; i++) { const x = newDevice('outlet2', used, {}); x.id = `o${used.size}`; used.add(x.name); x.loc = { floor: f.id, x: r.poly[0][0] + 0.5 + i, y: r.poly[0][1] + 0.2, h: 0.3 }; d.devices.push(x); }
  const data = cleanNet(d), t0 = performance.now(), r = writeIfc(data, { time: '2026-11-21T10:00:00' }), t1 = performance.now(), m = readIfc(r.text), t2 = performance.now();
  assert.ok(r.stats.outlets > 500, String(r.stats.outlets));
  assert.equal(m.counts.devices, r.stats.outlets);
  assert.ok(t2 - t0 < 2000, `export ${Math.round(t1 - t0)} ms, lecture ${Math.round(t2 - t1)} ms`);
});

/* ---------- Validation indépendante (outil d'essai) ---------- */
function ifcPython() {
  const cands = [process.env.JOLLOF_IFC_PY, 'python3'].filter(Boolean);
  for (const py of cands) { const r = spawnSync(py, ['-I', '-c', 'import ifcopenshell, ifcopenshell.validate'], { encoding: 'utf8', cwd: os.tmpdir() }); if (r.status === 0) return py; }
  return null;
}
const PY = ifcPython();
test('IfcOpenShell : fixtures et export sans erreur de schéma ni de règle', { skip: PY ? false : 'IfcOpenShell absent (JOLLOF_IFC_PY)' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jollof-ifc-')), out = path.join(dir, 'export.ifc');
  fs.writeFileSync(out, writeIfc(project(), { time: '2026-11-21T10:00:00' }).text);
  const out2 = path.join(dir, 'export-design.ifc'); fs.writeFileSync(out2, writeIfc(project(), { time: '2026-11-21T10:00:00', view: 'design' }).text);
  const files = [out, out2, ...['office-ifc4.ifc', 'annex-ifc2x3-feet.ifc', 'hall-ifc4-mm.ifc'].map(n => path.join(HERE, 'fixtures', n))];
  const code = 'import sys, ifcopenshell, ifcopenshell.validate\nbad = 0\nfor p in sys.argv[1:]:\n    lg = ifcopenshell.validate.json_logger()\n    ifcopenshell.validate.validate(ifcopenshell.open(p), lg, express_rules=True)\n    print(p, len(lg.statements))\n    bad += len(lg.statements)\nsys.exit(1 if bad else 0)';
  const r = spawnSync(PY, ['-I', '-c', code, ...files], { encoding: 'utf8', cwd: dir });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
