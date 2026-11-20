// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests des baies (src/net/rack.js, checks/rack.js) : node --test src/net/rack.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOUNT, U_MM, PANEL_MM, BTU_PER_W, PRESETS, cleanRacks, cleanRackPos, newRack, rackIndex, occupancy, facesOf, canPlace, findFree,
  devicePower, upsRuntime, rackPower, removeRack, cableManagers, blanksNeeded, rackSummary, racksSummary, patchingSchedule, unracked, freePorts, vlanOf
} from './rack.js';
import { issues, CODES, SRC, LAB } from './checks/rack.js';
import { RACK_DEVICES, RACK_GROUPS } from './rackdev.js';
import { DEVICES } from './devices.js';
import { cleanNet } from './clean.js';
import { createLan } from './lan.js';
import { makeCable } from './cable.js';
import { SOURCES } from '../check/sources.js';
import '../check/sources-net.js';
import { EXPLAIN } from '../check/explain.js';
import '../check/explain-net.js';
import { CODES as ALL_CODES } from '../check/codes.js';
// Temps : temps CPU du processus (src/net/perf.mjs), seuils tenus même dans la suite complète.
import { best, note } from './perf.mjs';

const rk = (o = {}) => cleanRacks([{ id: 'r1', name: 'BAIE1', ...o }])[0];
const dev = (id, type, u, face = 'front', extra = {}) => ({ id, type, name: id.toUpperCase(), x: 0, y: 0, p: DEVICES[type] ? DEVICES[type].props() : {}, rack: { id: 'r1', u, face }, ...extra });
const data = (devices, racks = [rk()], cables = []) => ({ devices, cables, racks });
const names = { name: id => id.toUpperCase() };
const codes = list => list.map(i => i.code).sort();

test('géométrie EIA et conversion W → BTU/h', () => {
  assert.equal(U_MM, 44.45); assert.equal(PANEL_MM, 482.6);
  assert.ok(Math.abs(BTU_PER_W - 3.412) < 0.001);
  // La fiche TP-Link donne 11,52 W ↔ 39,30 BTU/h : même conversion.
  assert.ok(Math.abs(11.52 * BTU_PER_W - 39.3) < 0.05);
});

test('chaque équipement de baie a son encombrement, sourcé', () => {
  for (const t of Object.keys(RACK_DEVICES)) {
    assert.ok(MOUNT[t], `MOUNT.${t}`);
    assert.equal(DEVICES[t].role, 'mech'); assert.deepEqual(DEVICES[t].ports({}), []);
  }
  for (const [g, types] of RACK_GROUPS) { assert.ok(g()); for (const t of types) assert.ok(RACK_DEVICES[t]); }
  for (const t of ['switch', 'poeswitch', 'nas', 'patch', 'switch24', 'switch48', 'l3switch', 'routerpro', 'server', 'mediaconv', 'fibrepanel', 'patch24', 'patch48']) assert.ok(MOUNT[t], t);
  for (const [t, m] of Object.entries(MOUNT)) {
    assert.ok(Number.isInteger(m.u) && m.u >= 0 && m.u <= 4, `${t}.u`);
    assert.ok(m.depth > 0 && m.depth < 1000, `${t}.depth`);
    assert.ok(m.kg === null || (m.kg > 0 && m.kg < 100), `${t}.kg`);
    assert.ok(m.max === null || m.max >= 0, `${t}.max`);
    assert.ok(m.typ === null || m.max === null || m.typ <= m.max, `${t}.typ ≤ max`);
    assert.ok(m.ref && m.src.length, `${t}.src`); for (const k of m.src) assert.ok(SOURCES[k], `${t} : ${k}`);
  }
  assert.ok(!MOUNT.router && !MOUNT.broker && !MOUNT.pc, 'pas de place en baie pour la box, le broker, le PC');
});

test('cleanRacks : déchets, bornes, ids uniques, stable', () => {
  assert.deepEqual(cleanRacks(null), []); assert.deepEqual(cleanRacks('x'), []);
  const r = cleanRacks([null, 5, { id: 'a', u: 999, d: 50, depth: 9999, load: -3, rot: -90, pf: 7, basis: 'max', name: 'x'.repeat(60) }, { id: 'a', kind: 'wall' }, {}]);
  assert.equal(r.length, 3); assert.deepEqual(r.map(x => x.id), ['a', 'a_', 'rk3']);
  assert.equal(r[0].u, 60); assert.equal(r[0].d, 200); assert.equal(r[0].depth, 200); assert.equal(r[0].load, 1); assert.equal(r[0].rot, 270);
  assert.equal(r[0].pf, 1); assert.equal(r[0].basis, 'max'); assert.equal(r[0].name.length, 24);
  assert.equal(r[1].kind, 'wall'); assert.equal(r[1].u, PRESETS.wall.u); assert.equal(r[1].load, PRESETS.wall.load); assert.equal(r[1].name, 'COFFRET2');
  assert.equal(r[2].u, 42); assert.equal(r[2].load, 800); assert.equal(r[2].depth, 652.3);
  assert.deepEqual(cleanRacks(cleanRacks(r)), r);
  assert.equal(cleanRacks(Array.from({ length: 500 }, (_, i) => ({ id: 'r' + i }))).length, 200);
  const n = newRack({ racks: r }, 'wall'); assert.equal(n.id, 'rk1'); assert.equal(n.kind, 'wall'); assert.equal(n.name, 'COFFRET1');
});

test('cleanRackPos', () => {
  assert.equal(cleanRackPos(null), null); assert.equal(cleanRackPos({ u: 3 }), null);
  assert.deepEqual(cleanRackPos({ id: 'r1', u: 3.6, face: 'x' }), { id: 'r1', u: 4, face: 'front' });
  assert.deepEqual(cleanRackPos({ id: 'r1', u: -5, face: 'rear', w: 99999, pdu: 'p1' }), { id: 'r1', u: 1, face: 'rear', w: 20000, pdu: 'p1' });
  const p = cleanRackPos({ id: 'r1', u: 7, w: 120 }); assert.deepEqual(cleanRackPos(p), p);
  // Passe par cleanNet : la place est gardée, une baie inconnue aussi (le vérificateur la signale).
  const net = cleanNet({ devices: [dev('sw', 'switch48', 3)], racks: [{ id: 'r1' }] });
  assert.deepEqual(net.devices[0].rack, { id: 'r1', u: 3, face: 'front' }); assert.equal(net.racks.length, 1);
  assert.deepEqual(cleanNet(net).racks, net.racks);
});

test('occupation : collisions, faces, profondeur, hors hauteur', () => {
  const r = rk({ u: 12 });
  // Panneau peu profond devant, passe-câbles derrière au même U : pas de collision.
  let o = occupancy(r, [dev('pp', 'patch24', 5), dev('cm', 'cablemgr', 5, 'rear')]);
  assert.equal(o.collisions.length, 0); assert.equal(o.front[5], 'pp'); assert.equal(o.rear[5], 'cm');
  // Onduleur (447 mm > 652,3 / 2) : prend les deux faces.
  assert.deepEqual(facesOf(dev('u', 'ups', 1), r), ['front', 'rear']);
  o = occupancy(r, [dev('u', 'ups', 1), dev('b', 'blank', 2, 'rear')]);
  assert.equal(o.collisions.length, 1); assert.deepEqual([o.collisions[0].a, o.collisions[0].b, o.collisions[0].u], ['u', 'b', 2]);
  o = occupancy(r, [dev('s', 'switch48', 12), dev('n', 'nas', 12)]);
  assert.deepEqual(o.outside, ['n']); assert.equal(o.collisions.length, 1);
  assert.equal(o.usedU, 1); assert.equal(o.freeFront, 11);
  // PDU verticale : aucun U.
  o = occupancy(r, [dev('p', 'pdu', 1, 'rear')]); assert.equal(o.usedU, 0);
});

test('canPlace et findFree', () => {
  const r = rk({ u: 6 }), d = data([dev('a', 'ups', 1), dev('b', 'switch48', 4)], [r]);
  const n = { id: 'n', type: 'nas' };
  assert.deepEqual(canPlace(d, r, n, 2), { ok: false, why: 'clash', with: 'a' });
  assert.deepEqual(canPlace(d, r, n, 6), { ok: false, why: 'outside' });
  assert.equal(canPlace(d, r, n, 5).ok, true);
  assert.equal(canPlace(d, r, { id: 'x', type: 'router' }, 1).why, 'type');
  assert.equal(findFree(d, r, n), 5);
  assert.equal(findFree(d, r, { id: 'z', type: 'blank' }, 'front', 6), 6);
  // Son propre emplacement ne le bloque pas.
  assert.equal(canPlace(d, r, d.devices[1], 3).ok, true);
  assert.equal(findFree(data([dev('a', 'ups', 1), dev('c', 'ups', 3), dev('e', 'ups', 5)], [r]), r, n), 0);
});

test('puissance : typique, maximale, PoE réservé, imposée', () => {
  const lan = { poe: id => (id === 'sw' ? { used: 120.4, budget: 740 } : null) };
  assert.deepEqual(devicePower(dev('sw', 'switch48', 1), lan), { typ: 182.66, max: 802.26, poe: 120.4, w: 182.66, guess: false, user: false });
  assert.equal(devicePower(dev('sw', 'switch48', 1), lan, 'max').w, 802.26);
  const s = devicePower(dev('srv', 'server', 1), null); assert.equal(s.w, MOUNT.server.max); assert.equal(s.guess, true);
  const u = devicePower({ ...dev('srv', 'server', 1), rack: { id: 'r1', u: 1, face: 'front', w: 250 } }, null); assert.equal(u.w, 250); assert.equal(u.user, true);
  assert.equal(devicePower({ type: 'pc' }, null).w, 0);
});

test('autonomie des onduleurs : points de la fiche, interpolation, surcharge', () => {
  const s = MOUNT.ups.ups;
  assert.equal(upsRuntime(s, 1500).min, 5); assert.equal(upsRuntime(s, 750).min, 14);
  assert.equal(upsRuntime(s, 1500, true).min, 25); assert.equal(upsRuntime(s, 750, true).min, 57);
  const mid = upsRuntime(s, 1000).min; assert.ok(mid > 5 && mid < 14, String(mid)); assert.equal(upsRuntime(s, 1000).extra, false);
  assert.equal(upsRuntime(s, 300).min, 35); assert.equal(upsRuntime(s, 300).extra, true); // 14 min × 750 / 300 : énergie constante
  assert.equal(upsRuntime(s, 1600).min, 0); assert.equal(upsRuntime(s, 0).min, Infinity);
  assert.equal(upsRuntime(MOUNT.ups3k.ups, 3000).min, 3); assert.equal(upsRuntime(MOUNT.ups3k.ups, 1500).min, 9);
});

test('bilan d’une baie : PDU, onduleur, chaleur, poids', () => {
  const r = rk({ u: 22, runtime: 10, pf: 0.9 });
  const devs = [dev('sw', 'switch48', 20), dev('srv', 'server', 18), dev('u', 'ups', 1, 'front'), dev('p1', 'pdu', 1, 'rear'), dev('p2', 'pdu', 1, 'rear'), dev('pp', 'patch24', 21)];
  devs[1].rack.w = 300;
  const pw = rackPower(r, devs, null);
  assert.equal(pw.w, 362.26); assert.equal(pw.heatW, 362.26); assert.equal(pw.btu, Math.round(362.26 * BTU_PER_W));
  assert.equal(pw.va, Math.round((362.26 / 0.9) * 100) / 100);
  assert.equal(pw.kg, Math.round((5.82 + 12.48 + MOUNT.ups.kg + 2 * 2.36 + MOUNT.patch24.kg) * 100) / 100);
  assert.equal(pw.pdus.length, 2); assert.equal(pw.pdus[0].w, 181.13); assert.equal(pw.pdus[0].capVA, 3680);
  assert.equal(pw.pdus[0].plugs + pw.pdus[1].plugs, 2);
  assert.equal(pw.ups.length, 1); assert.equal(pw.ups[0].w, 362.26); assert.ok(pw.ups[0].runtime > 14);
  // Branchement imposé sur une PDU.
  devs[0].rack.pdu = 'p1'; devs[1].rack.pdu = 'p1';
  const pw2 = rackPower(r, devs, null); assert.equal(pw2.pdus[0].w, 362.26); assert.equal(pw2.pdus[1].w, 0);
  // Sans PDU : appareils non branchés.
  assert.equal(rackPower(r, [dev('sw', 'switch48', 1)], null).unplugged.length, 1);
  // Module de batteries du bon modèle.
  const e = rackPower(r, [dev('srv', 'server', 10), dev('u', 'ups', 1), dev('e', 'ebm', 3), dev('e2', 'ebm3k', 5)], null);
  assert.equal(e.ups[0].ebm, 'e'); assert.deepEqual(e.orphanEbm, ['e2']); assert.ok(e.ups[0].runtime > upsRuntime(MOUNT.ups.ups, MOUNT.server.max).min);
});

test('passe-câbles et obturateurs', () => {
  const r = rk({ u: 10 });
  assert.deepEqual(cableManagers(r, [dev('p', 'patch24', 5), dev('c', 'cablemgr', 4)]).missing, []);
  assert.deepEqual(cableManagers(r, [dev('p', 'patch24', 5), dev('c', 'cablemgr', 6)]).missing, []);
  assert.deepEqual(cableManagers(r, [dev('p', 'patch24', 5), dev('c', 'cablemgr', 8)]).missing, ['p']);
  assert.deepEqual(cableManagers(r, [dev('p', 'patch24', 5), dev('c', 'cablemgr', 4, 'rear')]).missing, ['p']);
  assert.equal(blanksNeeded(r, [dev('p', 'patch24', 5)]), 0, 'baie passive : pas d’obturateurs exigés');
  assert.equal(blanksNeeded(r, [dev('s', 'switch48', 5)]), 9);
});

/** Petit plan : 4 prises, panneau 24 ports, switch 48 ports, liens permanents et cordons. */
function patched(nCords = 4) {
  const devices = [dev('sw', 'switch48', 20), dev('pp', 'patch24', 21), dev('cm', 'cablemgr', 22)];
  const cables = [];
  for (let i = 1; i <= 4; i++) {
    devices.push({ id: 'o' + i, type: 'outlet', name: 'PR' + i, x: 0, y: 0, p: {} });
    cables.push({ id: 'l' + i, a: ['o' + i, 'back'], b: ['pp', 'b' + i], cat: 'cat6', len: 30 + i, wire: makeCable('straight') });
    if (i <= nCords) cables.push({ id: 'k' + i, a: ['pp', 'f' + i], b: ['sw', 'p' + i], cat: 'cat6', len: 0.5, wire: makeCable('straight') });
  }
  return { devices, cables, racks: [rk({ u: 22 })] };
}

test('plan de brassage', () => {
  const d = patched(3);
  const rows = patchingSchedule(d, null);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { rack: 'BAIE1', rackId: 'r1', panel: 'PP', panelId: 'pp', port: '1', portId: 'f1', outlet: 'PR1', outletId: 'o1', outletPort: 'mur', permLen: 31, switch: 'SW', switchId: 'sw', switchPort: '1', switchPortId: 'p1', switchRole: 'switch', vlan: null, cordLen: 0.5, cableId: 'k1', label: 'PP-1', up: null });
  assert.equal(rows[3].switch, ''); assert.equal(rows[3].outlet, 'PR4');
  assert.equal(patchingSchedule(d, null, { all: true }).length, 24);
  assert.equal(patchingSchedule(d, null, { rack: 'nope' }).length, 0);
  assert.equal(vlanOf({ p: { ports: { p1: { vlan: 20 } } } }, 'p1'), 20); assert.equal(vlanOf({ p: {} }, 'p1'), null);
  const net = cleanNet(d), lan = createLan({ data: () => net });
  const lr = patchingSchedule(net, lan); assert.equal(lr.filter(x => x.up === true).length, 0, 'prises sans appareil : pas de lien');
  assert.deepEqual(freePorts(d, d.devices[1], 'front').slice(0, 2), ['f4', 'f5']);
});

test('vérifications J1273–J1285', () => {
  const lan = null;
  // Baie propre : rien.
  const ok = { devices: [dev('sw', 'switch48', 20), dev('pp', 'patch24', 21), dev('cm', 'cablemgr', 22), dev('p', 'pdu', 1, 'rear'), dev('u', 'ups', 1)], cables: [], racks: [rk({ u: 22 })] };
  for (let k = 3; k <= 19; k++) ok.devices.push(dev('b' + k, 'blank', k));
  assert.deepEqual(codes(issues(ok, lan, names)), []);
  const bad = {
    devices: [
      dev('a', 'switch48', 3), dev('b', 'switch24', 3), dev('c', 'nas', 12), dev('srv', 'server', 5), dev('pp', 'patch24', 8),
      dev('m', 'mediaconv', 9), { ...dev('x', 'router', 1) }, { ...dev('y', 'switch48', 1), rack: { id: 'ghost', u: 1, face: 'front' } },
      { ...dev('f', 'fan', 10), loc: { floor: 'f2', x: 0, y: 0, h: 1 } }, dev('u', 'ups', 6, 'front')
    ],
    cables: [], racks: [rk({ u: 12, load: 20, heat: 100, runtime: 30, floor: 'f1', depth: 500 })]
  };
  const got = new Set(codes(issues(bad, lan, names)));
  for (const c of ['J1273', 'J1274', 'J1275', 'J1279', 'J1280', 'J1281', 'J1282', 'J1283', 'J1284', 'J1285']) assert.ok(got.has(c), c);
  // PDU et onduleur surchargés, autonomie courte.
  const hot = { devices: [dev('p', 'pdu', 1, 'rear'), dev('u', 'ups', 1)], cables: [], racks: [rk({ u: 42, runtime: 30 })] };
  for (let k = 3; k <= 8; k++) hot.devices.push({ ...dev('s' + k, 'server', k), rack: { id: 'r1', u: k, face: 'front', w: 700 } });
  const h = codes(issues(hot, lan, names));
  assert.ok(h.includes('J1276') && h.includes('J1277'), h.join());
  const mild = { devices: [dev('p', 'pdu', 1, 'rear'), dev('u', 'ups', 1), { ...dev('s', 'server', 3), rack: { id: 'r1', u: 3, face: 'front', w: 1000 } }], cables: [], racks: [rk({ u: 4, runtime: 30, depth: 877.3 })] };
  mild.devices.push(dev('bl', 'blank', 4));
  assert.deepEqual(codes(issues(mild, lan, names)), ['J1278']);
  // Tablette : appareil de bureau posé dessus, plus de J1284.
  const shelf = { devices: [dev('t', 'shelf', 1), dev('m', 'mediaconv', 2), dev('p', 'pdu', 1, 'rear'), dev('b', 'blank', 3)], cables: [], racks: [rk({ u: 3 })] };
  assert.deepEqual(codes(issues(shelf, lan, names)), []);
  // Chaque code : niveau, source, explication, entrée dans codes.js.
  for (const c of Object.keys(CODES)) {
    assert.ok(/^J12(7[3-9]|8[0-5])$/.test(c)); assert.ok(SRC[c].length, c); for (const k of SRC[c]) assert.ok(SOURCES[k], `${c} : ${k}`);
    assert.ok(EXPLAIN ? EXPLAIN[c] : true, c); assert.equal(ALL_CODES[c].level, CODES[c], c);
  }
});

test('contrôles de TP net-rack, net-power, net-patching', () => {
  const env = d => { const n = cleanNet(d); const lan = createLan({ data: () => n }); return { netData: () => n, lan: () => lan }; };
  const d = patched(4);
  d.devices.push(dev('p', 'pdu', 1, 'rear'), dev('u', 'ups', 1));
  const R = LAB['net-rack'], P = LAB['net-power'], B = LAB['net-patching'];
  assert.equal(R.check({ require: [{ sel: 'switch48' }, { sel: 'patch24' }] }, env(d)).ok, true);
  assert.equal(R.check({ rack: 'AUTRE' }, env(d)).why, 'norack');
  const miss = R.check({ require: [{ sel: 'patch24', n: 2 }] }, env(d)); assert.equal(miss.why, 'missing'); assert.ok(R.text({}, miss).includes('patch24'));
  const clash = patched(4); clash.devices[1].rack.u = 20;
  const rc = R.check({}, env(clash)); assert.equal(rc.why, 'issues'); assert.equal(rc.code, 'J1273');
  assert.equal(P.check({}, env(d)).ok, true);
  assert.equal(P.check({}, env(patched(4))).why, 'nopdu');
  assert.equal(P.check({ runtime: 9999 }, env(d)).why, 'runtime');
  assert.equal(B.check({ n: 4 }, env(d)).ok, true);
  const few = B.check({ n: 4 }, env(patched(2))); assert.equal(few.ok, false); assert.equal(few.got, 2); assert.ok(B.text({}, few));
});

test('résumés et équipements hors baie', () => {
  const d = patched(4); d.devices.push({ id: 'z', type: 'server', name: 'SRV', x: 0, y: 0, p: {} });
  const s = racksSummary(d, null);
  assert.equal(s.length, 1); assert.equal(s[0].usedU, 3); assert.equal(s[0].devices[0].id, 'cm');
  assert.deepEqual(unracked(d).map(x => x.id), ['z']);
  assert.equal(rackSummary(d, d.racks[0], null, rackIndex(d)).managers.missing.length, 0);
});

test('taille réelle : 30 baies, 3000 équipements, vérification en moins de 50 ms', () => {
  const racks = [], devices = [], cables = [];
  for (let r = 0; r < 30; r++) {
    racks.push({ id: 'r' + r, name: 'B' + r, u: 42 });
    for (let k = 0; k < 40; k++) devices.push({ id: `d${r}_${k}`, type: k % 2 ? 'patch24' : 'switch48', name: `D${r}_${k}`, x: 0, y: 0, p: {}, rack: { id: 'r' + r, u: k + 1, face: 'front' } });
  }
  for (let i = 0; i < 1800; i++) devices.push({ id: 'o' + i, type: 'outlet', name: 'O' + i, x: 0, y: 0, p: {} });
  for (let i = 0; i < 1800; i++) { const r = i % 30, k = 2 * (Math.floor(i / 30) % 20) + 1; cables.push({ id: 'c' + i, a: ['o' + i, 'back'], b: [`d${r}_${k}`, 'b' + (1 + Math.floor(i / 600))], cat: 'cat6', len: 40, wire: makeCable('straight') }); }
  const d = { devices, cables, racks: cleanRacks(racks) };
  issues(d, null, names); patchingSchedule(d, null);
  // Meilleur de 3 passes en temps CPU (src/net/perf.mjs).
  let list = [], rows = [];
  const dt = best(() => { list = issues(d, null, names); rows = patchingSchedule(d, null); racksSummary(d, null); }, 3, 0);
  assert.ok(list.length > 0 && rows.length > 0);
  assert.ok(dt < 50, note('baies, 30 baies', dt, 50));
});

test('removeRack : équipements hors baie, ou supprimés avec leurs câbles', () => {
  const mk = () => { const d = patched(4); d.devices.push(dev('p', 'pdu', 1, 'rear')); d.devices[0].rack.pdu = 'p'; d.racks.push(cleanRacks([{ id: 'r2' }])[0]); return d; };
  let d = mk(); const n = d.devices.length, c = d.cables.length;
  let r = removeRack(d, 'r1');
  assert.equal(r.rack.id, 'r1'); assert.deepEqual(d.racks.map(x => x.id), ['r2']);
  assert.deepEqual(r.unracked.sort(), ['cm', 'p', 'pp', 'sw']); assert.deepEqual(r.deleted, []);
  assert.equal(d.devices.length, n); assert.equal(d.cables.length, c); assert.ok(d.devices.every(x => !x.rack));
  d = mk(); r = removeRack(d, 'r1', { unrack: false });
  assert.deepEqual(r.deleted.sort(), ['cm', 'p', 'pp', 'sw']); assert.equal(d.devices.length, n - 4);
  assert.equal(r.cables.length, 8); assert.equal(d.cables.length, 0);
  assert.deepEqual(removeRack(d, 'nope'), { rack: null, unracked: [], deleted: [], cables: [] });
});
