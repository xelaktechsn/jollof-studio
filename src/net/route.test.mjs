// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests des cheminements et des longueurs réelles (src/net/route.js) et des vérifications du plan (checks/plan.js).
// node --test src/net/route.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPaths, cleanRoute, applyRoutes, locate, routeCable, fillOf, bendsOf, powerFactor, separationMm, pathDistance, cablesByPath } from './route.js';
import { cleanNet } from './clean.js';
import { issues, parallelGap, LAB } from './checks/plan.js';
/** Seuils de temps : stricts avec JOLLOF_PERF_STRICT=1 (mesure seule) ; × 8 sinon (suite complète en parallèle, machine chargée). */
const PERF = process.env.JOLLOF_PERF_STRICT ? 1 : 8;

const site = (extra = {}) => ({ buildings: [{ id: 'B1', floors: [
  { id: 'F0', level: 0, height: 3.5, rooms: [{ id: 'lt', usage: 'tr', poly: [[0, 0], [3, 0], [3, 3], [0, 3]] }, { id: 'of', usage: 'open', poly: [[3, 0], [40, 0], [40, 20], [3, 20]] }] },
  { id: 'F1', level: 1, height: 3.5, rooms: [{ id: 'of1', usage: 'open', poly: [[0, 0], [40, 0], [40, 20], [0, 20]] }] }] }, ...(extra.buildings || [])] });
const base = (paths, devs = [], cabs = [], more = {}) => cleanNet({
  site: site(more), paths,
  devices: [{ id: 'pp', type: 'patch', loc: { floor: 'F0', x: 1, y: 1, h: 1.5 } }, ...devs],
  cables: cabs, ...more.top
});
const out = (id, floor, x, y) => ({ id, type: 'outlet', loc: { floor, x, y, h: 0.3 } });
const cab = (id, port, to) => ({ id, a: ['pp', port], b: [to, 'back'], route: { mode: 'auto' } });

test('cleanPaths : tolère tout, borne, garde le genre de chaque cheminement', () => {
  assert.deepEqual(cleanPaths(null), []);
  const p = cleanPaths([null, { floor: 'F0' }, { floor: 'F0', kind: 'zz', pts: [[0, 0], [0, 0], [5, 0]], w: 1e9 }, { floor: 'F0', kind: 'riser', pts: [[1, 1], [2, 2]] }, { floor: 'F0', kind: 'outdoor', pts: [[0, 0], [3, 4]] }, { floor: 'F0', kind: 'conduit', pts: [[0, 0], [1, 0]], power: 1, circuits: 9999, shield: 'gold' }]);
  assert.equal(p.length, 4);
  assert.equal(p[0].kind, 'tray'); assert.equal(p[0].pts.length, 2, 'point répété retiré'); assert.equal(p[0].w, 2000);
  assert.equal(p[1].pts.length, 1); assert.equal(p[1].top, 'F0');
  assert.equal(p[2].len, 5, 'longueur par défaut d’un fourreau extérieur');
  assert.equal(p[3].circuits, 500); assert.equal(p[3].shield, 'none'); assert.equal(p[3].dia, 25);
  assert.equal(new Set(p.map(x => x.id)).size, 4);
  assert.deepEqual(cleanPaths(p), p, 'stable');
  assert.equal(cleanRoute('x'), null); assert.deepEqual(cleanRoute({ mode: 'auto', calc: { path: 3 } }), { mode: 'auto' });
});

test('locate : place sur un plan, ou dans une baie (hauteur depuis l’unité)', () => {
  const d = base([], [out('o1', 'F1', 5, 5)]);
  assert.deepEqual(locate(d, 'o1'), { floor: 'F1', building: 'B1', x: 5, y: 5, z: 3.8, h: 0.3 });
  d.racks = [{ id: 'R1', floor: 'F0', x: 2, y: 2, kind: 'floor', u: 42 }];
  d.devices.push({ id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, p: {}, rack: { id: 'R1', u: 10, face: 'front' } });
  const L = locate(d, 'sw'); assert.equal(L.rack, 'R1'); assert.ok(Math.abs(L.h - (0.1 + 9.5 * 0.04445)) < 1e-9);
  assert.equal(locate(d, 'nope'), null);
});

test('longueur réelle : descente + accès + chemin de câbles + mou de service', () => {
  const d = base([{ id: 'T1', floor: 'F0', kind: 'tray', pts: [[1, 4], [30, 4]], z: 2.7 }, { id: 'T2', floor: 'F0', kind: 'tray', pts: [[20, 0], [20, 18]], z: 2.7 }], [out('o1', 'F0', 20, 15)], [cab('c1', 'b1', 'o1')]);
  const c = d.cables[0];
  // Panneau : 3 m d'accès + 1,2 m de montée ; 19 m + 11 m de chemins ; prise : 2,4 m de descente ; mou 3 + 0,3 m.
  assert.deepEqual(c.route.calc, { path: 30, drops: 6.6, slack: 3.3, access: 3, paths: ['T2', 'T1'], fallback: null });
  assert.equal(c.len, 39.9);
  assert.deepEqual(cleanNet(d), d, 'cleanNet(cleanNet(x)) stable avec les tracés');
  d.design = { slack: { tr: 5, wa: 1 } }; applyRoutes(d);
  assert.equal(d.cables[0].route.calc.slack, 6, 'mou réglé dans la conception');
  const legs = routeCable(d, d.cables[0], true).legs;
  assert.equal(legs.length, 1); assert.deepEqual(legs[0].pts[0], [1, 1]); assert.deepEqual(legs[0].pts.at(-1), [20, 15]);
});

test('tracé manuel : la longueur saisie reste ; sans tracé : rien ne change', () => {
  const d = base([{ id: 'T1', floor: 'F0', kind: 'tray', pts: [[1, 4], [30, 4]] }], [out('o1', 'F0', 20, 4)], [{ ...cab('c1', 'b1', 'o1'), route: { mode: 'manual' }, len: 42 }, { id: 'c2', a: ['pp', 'f1'], b: ['o1', 'front'], len: 7 }]);
  assert.equal(d.cables[0].len, 42); assert.equal(d.cables[0].route.calc, undefined); assert.equal(d.cables[1].len, 7);
});

test('colonne montante entre étages, et câble sans colonne signalé (J1256)', () => {
  const paths = [{ id: 'T1', floor: 'F0', kind: 'tray', pts: [[1, 4], [30, 4]], z: 2.7 }, { id: 'R1', floor: 'F0', kind: 'riser', top: 'F1', pts: [[2, 4]] }, { id: 'J1', floor: 'F1', kind: 'ceiling', pts: [[2, 4], [10, 4]], z: 2.9 }];
  const d = base(paths, [out('o2', 'F1', 9, 6)], [cab('c2', 'b2', 'o2')]);
  const c = d.cables[0].route.calc;
  assert.equal(c.path, 11.7, '1 m + 3,7 m de colonne (3,5 + 2,9 − 2,7) + 7 m'); assert.deepEqual(c.paths.sort(), ['J1', 'R1', 'T1']);
  const e = base(paths.filter(p => p.id !== 'R1'), [out('o2', 'F1', 9, 6)], [cab('c2', 'b2', 'o2')]);
  assert.equal(e.cables[0].route.calc.fallback, 'noriser');
  assert.deepEqual(issues(e, null, { name: id => id }).filter(i => i.code === 'J1256').map(i => i.id), ['c2']);
});

test('un cheminement d’énergie ne porte pas les câbles de données', () => {
  const d = base([{ id: 'E1', floor: 'F0', kind: 'trunking', power: true, pts: [[1, 4], [30, 4]] }], [out('o1', 'F0', 20, 6)], [cab('c1', 'b1', 'o1')]);
  assert.equal(d.cables[0].route.calc.fallback, 'nopath');
});

test('sans cheminement : longueur en équerre, signalée (J1255)', () => {
  const d = base([], [out('o1', 'F0', 21, 11)], [cab('c1', 'b1', 'o1')]);
  const c = d.cables[0];
  assert.equal(c.route.calc.fallback, 'nopath'); assert.equal(c.len, 20 + 10 + 1.2 + 3.3);
  assert.ok(issues(d, null, {}).some(i => i.code === 'J1255' && i.id === 'c1'));
});

test('fourreau extérieur entre deux bâtiments', () => {
  const more = { buildings: [{ id: 'B2', x: 100, floors: [{ id: 'G0', level: 0 }] }] };
  const paths = [{ id: 'T1', floor: 'F0', kind: 'tray', pts: [[1, 4], [30, 4]] }, { id: 'X1', floor: 'F0', kind: 'outdoor', to: 'G0', pts: [[30, 4], [0, 4]], len: 120 }, { id: 'U1', floor: 'G0', kind: 'tray', pts: [[0, 4], [10, 4]] }];
  const d = base(paths, [out('o3', 'G0', 10, 4)], [cab('c3', 'b3', 'o3')], more);
  assert.deepEqual(d.cables[0].route.calc.paths.sort(), ['T1', 'U1', 'X1']);
  assert.equal(d.cables[0].route.calc.path, 29 + 120 + 10);
});

test('remplissage, coudes, facteur de puissance, séparation', () => {
  const cs = n => Array.from({ length: n }, () => ({ cat: 'cat6' }));
  assert.equal(fillOf({ kind: 'conduit', dia: 25 }, cs(1)).max, 0.53);
  assert.equal(fillOf({ kind: 'conduit', dia: 25 }, cs(2)).max, 0.31);
  assert.equal(fillOf({ kind: 'conduit', dia: 25 }, cs(7)).max, 0.4);
  const f = fillOf({ kind: 'tray', w: 100, h: 50 }, cs(10)); assert.ok(Math.abs(f.ratio - 10 * Math.PI * 5.69 ** 2 / 4 / 5000) < 1e-9);
  assert.equal(bendsOf({ pts: [[0, 0], [5, 0], [5, 5], [10, 5], [10, 0]] }), 270);
  assert.equal(powerFactor(1), 0.2); assert.equal(powerFactor(15), 1); assert.equal(powerFactor(80), 6);
  assert.equal(separationMm('b', { shield: 'none' }, { circuits: 15 }), 100);
  assert.equal(separationMm('a', { shield: 'perforated' }, { circuits: 20 }), 300);
  assert.equal(separationMm('c', { shield: 'none' }, { circuits: 3, shield: 'solid' }), 0);
  assert.equal(parallelGap({ pts: [[0, 0], [10, 0]], w: 100, z: 2.7 }, { pts: [[0, 0.5], [10, 0.5]], w: 200, z: 2.7 }), 350);
  assert.equal(parallelGap({ pts: [[0, 0], [10, 0]] }, { pts: [[5, -5], [5, 5]] }), null, 'croisement à angle droit');
});

test('vérifications : remplissage, conduit, séparation, pièces, local technique', () => {
  const devs = [], cabs = [];
  for (let i = 1; i <= 12; i++) { devs.push(out('o' + i, 'F0', 5 + i * 2, 8)); cabs.push(cab('c' + i, 'b' + i, 'o' + i)); }
  devs.push(out('o99', 'F0', 60, 40), out('o98', 'F1', 5, 5));
  const d = base([{ id: 'C1', floor: 'F0', kind: 'conduit', dia: 20, pts: [[1, 4], [35, 4]], rad: 50 }, { id: 'P1', floor: 'F0', kind: 'tray', power: true, circuits: 5, pts: [[1, 4.15], [35, 4.15]] }], devs, cabs);
  const got = issues(d, null, { name: id => id }), codes = c => got.filter(i => i.code === c).map(i => i.id);
  assert.deepEqual(codes('J1250'), ['C1']); assert.deepEqual(codes('J1251'), ['C1']); assert.deepEqual(codes('J1252'), ['C1']);
  assert.deepEqual(codes('J1253'), ['C1']); assert.deepEqual(codes('J1254'), ['o99']); assert.deepEqual(codes('J1257'), ['F1']);
  assert.equal(cablesByPath(d).get('C1').length, 12);
});

test('prise à plus de 90 m du local technique le long des cheminements (J1258), surface desservie (J1259)', () => {
  const big = { top: {} };
  const d = base([{ id: 'T1', floor: 'F0', kind: 'tray', pts: [[1, 4], [39, 4], [39, 19], [4, 19], [4, 8], [36, 8], [36, 15], [8, 15]] }], [out('o1', 'F0', 8, 15)], [], big);
  const P = { floor: 'F0', x: 1, y: 1, h: 1.5 }, L = pathDistance(d, P, { floor: 'F0', x: 8, y: 15, h: 0.3 });
  assert.ok(L.len > 90 && Number.isFinite(L.len));
  assert.ok(issues(d, null, { name: id => id }).some(i => i.code === 'J1258' && i.id === 'o1'));
  d.site.buildings[0].floors[0].rooms.push({ id: 'h', usage: 'open', poly: [[0, 20], [40, 20], [40, 50], [0, 50]] });
  assert.ok(issues(d, null, {}).some(i => i.code === 'J1259'), '740 + 1200 m² pour un local');
});

test('câble trop loin d’un cheminement sans support (J1262), accès réglable par le site', () => {
  const d = base([{ id: 'T1', floor: 'F0', kind: 'tray', pts: [[1, 4], [30, 4]] }], [out('o1', 'F0', 20, 12)], [cab('c1', 'b1', 'o1')]);
  assert.equal(d.cables[0].route.calc.access, 8);
  assert.deepEqual(issues(d, null, { name: id => id }).filter(i => i.code === 'J1262').map(i => i.id), ['c1']);
  d.site.access = 10; assert.equal(issues(d, null, {}).filter(i => i.code === 'J1262').length, 0);
});

test('contrôles de TP net-plan et net-path', () => {
  const env = d => ({ netData: () => d });
  const ok = base([{ id: 'T1', floor: 'F0', kind: 'tray', pts: [[1, 4], [30, 4]] }], [out('o1', 'F0', 20, 6)], [cab('c1', 'b1', 'o1')]);
  ok.site.buildings[0].floors.pop();
  assert.deepEqual(LAB['net-plan'].check({}, env(ok)), { ok: true });
  assert.equal(LAB['net-path'].check({}, env(ok)).ok, true);
  assert.equal(LAB['net-path'].check({ max: 20 }, env(ok)).why, 'long');
  const none = base([], [out('o1', 'F0', 20, 6)], [cab('c1', 'b1', 'o1')]);
  const r = LAB['net-path'].check({}, env(none)); assert.equal(r.why, 'issues'); assert.equal(r.issues[0].code, 'J1255');
  assert.match(LAB['net-path'].text({}, r), /J1255/);
  assert.equal(LAB['net-plan'].check({ floors: 3 }, env(ok)).why, 'floors');
});

test('performance : 3 bâtiments × 4 étages, 1 500 câbles au tracé automatique, moins de 50 ms', () => {
  const buildings = [], paths = [], devices = [], cables = [];
  for (let b = 0; b < 3; b++) {
    const floors = [];
    for (let f = 0; f < 4; f++) {
      const id = `B${b}F${f}`; floors.push({ id, level: f, height: 3.5 });
      paths.push({ id: id + 'T', floor: id, kind: 'tray', pts: [[2, 10], [100, 10]] });
      for (let k = 0; k < 20; k++) paths.push({ id: id + 'b' + k, floor: id, kind: 'basket', pts: [[5 + k * 5, 10], [5 + k * 5, 40]] });
      if (f) paths.push({ id: id + 'R', floor: `B${b}F0`, top: id, kind: 'riser', pts: [[2, 10]] });
    }
    buildings.push({ id: 'B' + b, x: b * 200, floors });
    if (b) paths.push({ id: 'X' + b, floor: 'B0F0', kind: 'outdoor', to: `B${b}F0`, pts: [[2, 10], [2, 10]], len: 200 * b });
  }
  let n = 0;
  for (let p = 0; p < 125; p++) {
    const b = p % 3, pid = 'pp' + p; devices.push({ id: pid, type: 'patch', loc: { floor: `B${b}F0`, x: 1, y: 2 + (p % 5) * 0.1, h: 1 } });
    for (let i = 1; i <= 12 && n < 1500; i++, n++) {
      const f = n % 4, oid = 'o' + n; devices.push({ id: oid, type: 'outlet', loc: { floor: `B${b}F${f}`, x: 5 + (n % 97), y: 12 + (n % 27), h: 0.3 } });
      cables.push({ id: 'c' + n, a: [pid, 'b' + i], b: [oid, 'back'], route: { mode: 'auto' } });
    }
  }
  const d = cleanNet({ site: { buildings }, paths, devices, cables });
  assert.equal(d.cables.length, 1500); assert.ok(d.cables.every(c => c.route.calc && !c.route.calc.fallback), 'tous portés par les cheminements');
  // Graphe à refaire à chaque passe (cheminement modifié) ; meilleur de trois passes (machine partagée).
  let cold = Infinity, t;
  for (let k = 0; k < 3; k++) { d.paths[0].pts[1][0] = 101 + k; t = performance.now(); applyRoutes(d); cold = Math.min(cold, performance.now() - t); }
  t = performance.now(); applyRoutes(d); const warm = performance.now() - t;
  t = performance.now(); issues(d, null, { name: id => id }); const chk = performance.now() - t;
  console.log(`  applyRoutes ${cold.toFixed(1)} ms (graphe neuf), ${warm.toFixed(1)} ms (en cache) ; vérifications ${chk.toFixed(1)} ms`);
  assert.ok(cold < 50 * PERF, `applyRoutes ${cold} ms`); assert.ok(warm < 50 * PERF); assert.ok(chk < 100 * PERF, `issues ${chk} ms`);
});

test('colonnes montantes de données et d’énergie côte à côte (J1253), séparées assez loin : rien', () => {
  const two = { buildings: [{ id: 'B1', floors: [{ id: 'F0', level: 0, height: 3.5 }, { id: 'F1', level: 1, height: 3.5 }, { id: 'F2', level: 2, height: 3.5 }] }] };
  const mk = (x, circuits) => cleanNet({ site: two, paths: [{ id: 'RD', floor: 'F0', top: 'F2', kind: 'riser', pts: [[2, 2]], w: 300 }, { id: 'RE', floor: 'F1', top: 'F2', kind: 'riser', power: true, circuits, pts: [[x, 2]], w: 300 }] });
  const near = issues(mk(2.5, 40), null, {}).filter(i => i.code === 'J1253');
  assert.deepEqual(near.map(i => i.id), ['RD'], 'gaines voisines : 200 mm < 3 × 100 mm (40 circuits), sur 3,5 m');
  assert.match(near[0].text, /3,5|3\.5/);
  assert.equal(issues(mk(3, 40), null, {}).filter(i => i.code === 'J1253').length, 0, '700 mm : assez loin');
  const apart = cleanNet({ site: two, paths: [{ id: 'RD', floor: 'F0', top: 'F1', kind: 'riser', pts: [[2, 2]] }, { id: 'RE', floor: 'F1', top: 'F2', kind: 'riser', power: true, pts: [[2, 2]] }] });
  assert.equal(issues(apart, null, {}).filter(i => i.code === 'J1253').length, 0, 'pas d’étage commun');
});

test('retirer une baie depuis les plans : ses équipements restent, hors baie', async () => {
  const { removeRackFrom } = await import('./ui/plan-demo.js');
  const d = { racks: [{ id: 'R1' }, { id: 'R2' }], devices: [{ id: 'a', rack: { id: 'R1', u: 1 } }, { id: 'b', rack: { id: 'R2', u: 1 } }, { id: 'c' }] };
  assert.equal(removeRackFrom(d, 'R1'), 1);
  assert.deepEqual(d.racks.map(r => r.id), ['R2']); assert.equal(d.devices.length, 3); assert.equal(d.devices[0].rack, undefined); assert.ok(d.devices[1].rack);
  assert.equal(removeRackFrom(d, 'nope'), -1);
  // Avec removeRack de la partie baies (équipements gardés, hors baie).
  const RK = await import('./rack.js'), e = cleanNet({ racks: [{ id: 'R1', floor: 'F0', x: 1, y: 1 }], devices: [{ id: 'sw', type: 'switch24', rack: { id: 'R1', u: 3, face: 'front' } }] });
  assert.equal(removeRackFrom(e, 'R1', RK), 1); assert.equal(e.racks.length, 0); assert.equal(e.devices.length, 1); assert.equal(e.devices[0].rack, undefined);
});
