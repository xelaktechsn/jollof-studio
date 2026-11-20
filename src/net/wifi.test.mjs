// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du Wi-Fi du plan réseau (src/net/wifi.js, src/net/checks/wifi.js) : node --test src/net/wifi.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as WF from './wifi.js';
import { issues, LAB, CODES, SRC } from './checks/wifi.js';
import { cleanNet } from './clean.js';
import { NET } from './limits.js';
/** Seuils de temps : stricts avec JOLLOF_PERF_STRICT=1 (mesure seule) ; × 8 sinon (suite complète en parallèle, machine chargée). */
const PERF = process.env.JOLLOF_PERF_STRICT ? 1 : 8;

const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
/** Un étage rectangulaire w × h, murs extérieurs en béton, plus les murs/pièces donnés. */
function floorOf(id, o = {}) {
  const w = o.w || 20, h = o.h || 10, walls = [
    { id: id + 'n', a: [0, 0], b: [w, 0], mat: 'concrete', t: 0.2 }, { id: id + 's', a: [0, h], b: [w, h], mat: 'concrete', t: 0.2 },
    { id: id + 'w', a: [0, 0], b: [0, h], mat: 'concrete', t: 0.2 }, { id: id + 'e', a: [w, 0], b: [w, h], mat: 'concrete', t: 0.2 }, ...(o.walls || [])
  ];
  return { id, name: o.name || id, level: o.level ?? 0, elev: o.elev ?? 0, height: 3.5, ceil: 2.7, walls, doors: o.doors || [], rooms: o.rooms || [] };
}
const ap = (id, floor, x, y, radios = {}, type = 'ap') => ({ id, type, name: id.toUpperCase(), x: 0, y: 0, p: { radios: { ...WF.defaultRadios(type), ...radios } }, loc: { floor, x, y, h: 2.7 } });
const site = (...floors) => ({ buildings: [{ id: 'B1', name: 'B1', floors }] });
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

test('perte d’une paroi (UIT-R P.2040, dalle à incidence normale)', () => {
  // Béton 20 cm : ≈ 14,6 dB à 2,4 GHz, ≈ 25 dB à 5,2 GHz ; plus épais ou plus haut en fréquence : plus de perte.
  near(WF.slabLoss('concrete', 0.2, 2400), 14.6, 0.3);
  assert.ok(WF.slabLoss('concrete', 0.2, 5200) > WF.slabLoss('concrete', 0.2, 2400));
  assert.ok(WF.slabLoss('concrete', 0.3, 2400) > WF.slabLoss('concrete', 0.2, 2400));
  assert.ok(WF.slabLoss('brick', 0.1, 2400) > 2 && WF.slabLoss('brick', 0.1, 2400) < 5);
  assert.ok(WF.slabLoss('plasterboard', 0.025, 2400) < 2);
  assert.equal(WF.slabLoss('metal', 0.002, 2400), WF.WALL_CAP);
  assert.equal(WF.slabLoss('nope', 0.1, 2400), 0);
  // Couche très mince : presque rien.
  assert.ok(WF.slabLoss('wood', 0.001, 2400) < 0.1);
});

test('matériaux du plan : synonymes, cloison creuse, inconnu', () => {
  assert.equal(WF.matOf('Béton'), 'concrete'); assert.equal(WF.matOf('drywall'), 'plasterboard'); assert.equal(WF.matOf('block'), 'concrete');
  assert.equal(WF.matOf('elevator'), 'concrete'); assert.equal(WF.matOf('glass'), 'glass'); assert.equal(WF.matOf('xyz'), null);
  // Cloison en plaques de plâtre de 10 cm : deux plaques de 12,5 mm comptées, pas 10 cm de plâtre plein.
  near(WF.wallLoss({ mat: 'drywall', t: 0.1 }, 'b24'), WF.slabLoss('plasterboard', 0.025, 2400), 1e-9);
  near(WF.wallLoss({ mat: 'plaster', t: 0.1 }, 'b24'), WF.slabLoss('plasterboard', 0.1, 2400), 1e-9);
  // Inconnu : brique de 10 cm, quelle que soit l'épaisseur donnée.
  near(WF.wallLoss({ mat: '???', t: 0.5 }, 'b5'), WF.slabLoss('brick', 0.1, 5200), 1e-9);
});

test('affaiblissement UIT-R P.1238 : 20 log f − 28 + N log d', () => {
  near(WF.pathLoss(1, 'b24'), 20 * Math.log10(2400) - 28, 1e-9);
  near(WF.pathLoss(10, 'b24') - WF.pathLoss(1, 'b24'), 20, 1e-9);
  near(WF.pathLoss(10, 'b24', 'office') - WF.pathLoss(1, 'b24', 'office'), 30, 1e-9);
  near(WF.pathLoss(10, 'b5', 'office') - WF.pathLoss(1, 'b5', 'office'), 31, 1e-9);
  near(WF.pathLoss(0.2, 'b5'), WF.pathLoss(1, 'b5'), 1e-9); // d ≥ 1 m
  assert.equal(WF.floorLoss('b24', 'walls'), 14); assert.equal(WF.floorLoss('b5', 'office'), 16); assert.equal(WF.floorLoss('b24', 'residential'), 10);
});

test('canaux : chevauchements, blocs, domaines', () => {
  const s = (b, c, w = 20) => WF.span(b, c, w);
  assert.ok(!WF.overlap(s('b24', 1), s('b24', 6))); assert.ok(!WF.overlap(s('b24', 6), s('b24', 11)));
  assert.ok(WF.overlap(s('b24', 1), s('b24', 5))); assert.ok(WF.overlap(s('b24', 3), s('b24', 6)));
  assert.ok(WF.overlap(s('b24', 1, 40), s('b24', 6)));
  assert.ok(WF.overlap(s('b5', 36, 80), s('b5', 44))); assert.ok(!WF.overlap(s('b5', 36, 40), s('b5', 44, 40)));
  assert.ok(!WF.overlap(s('b5', 36), s('b5', 40)));
  assert.deepEqual(WF.channels('b5', 'eu', 80), [36, 52, 100, 116]);
  assert.deepEqual(WF.channels('b5', 'us', 80), [36, 52, 100, 116, 132, 149]);
  assert.deepEqual(WF.channels('b5', 'eu', 160), [36, 100]);
  assert.equal(WF.channels('b24', 'eu').length, 13); assert.equal(WF.channels('b24', 'us').length, 11);
  assert.equal(WF.clearCount('b24', 'eu', 20), 3); assert.equal(WF.clearCount('b24', 'eu', 40), 1); assert.equal(WF.clearCount('b5', 'eu', 40), 9);
  assert.deepEqual(WF.block5(40, 80), [36, 48]); assert.equal(WF.block5(165, 40), null); assert.equal(WF.subband(100), 'u2c');
});

test('réglages radio : défauts de la fiche, bornes, domaine', () => {
  const r = { on: true, ch: 36, w: 160, tx: 17, gain: 5 };
  assert.equal(WF.radioFault('ap', 'b5', r, 'eu').why, 'width');
  assert.equal(WF.radioFault('ap6', 'b5', r, 'eu'), null);
  assert.equal(WF.radioFault('ap', 'b5', { ...r, w: 20, ch: 149 }, 'eu').why, 'reg');
  assert.equal(WF.radioFault('ap', 'b5', { ...r, w: 20, ch: 149 }, 'us'), null);
  assert.equal(WF.radioFault('ap', 'b5', { ...r, w: 80, ch: 40 }, 'eu'), null);
  assert.equal(WF.radioFault('ap', 'b5', { ...r, w: 80, ch: 132 }, 'eu').why, 'reg'); // 132–144 : 144 interdit en Europe
  assert.equal(WF.radioFault('ap', 'b5', { ...r, w: 40, ch: 165 }, 'us').why, 'block');
  assert.equal(WF.radioFault('ap', 'b24', { on: true, ch: 13, w: 20, tx: 14, gain: 4 }, 'us').why, 'reg');
  // Puissance : 24 dBm conduits au plus (EAP225, FCC) ; en Europe, PIRE 20 dBm à 2,4 GHz, 23 / 27 dBm à 5 GHz.
  assert.equal(WF.powerFault('ap', 'b24', { ch: 1, w: 20, tx: 25, gain: 4 }, 'us').kind, 'tx');
  assert.equal(WF.powerFault('ap', 'b24', { ch: 1, w: 20, tx: 20, gain: 4 }, 'us'), null);
  assert.deepEqual(WF.powerFault('ap', 'b24', { ch: 1, w: 20, tx: 17, gain: 4 }, 'eu'), { kind: 'eirp', max: 20, have: 21 });
  assert.equal(WF.powerFault('ap', 'b5', { ch: 36, w: 20, tx: 18, gain: 5 }, 'eu'), null);
  assert.equal(WF.powerFault('ap', 'b5', { ch: 100, w: 20, tx: 21, gain: 5 }, 'eu'), null);
  assert.equal(WF.powerFault('ap', 'b5', { ch: 36, w: 20, tx: 19, gain: 5 }, 'eu').kind, 'eirp');
  // Nettoyage : valeurs absurdes bornées, idempotent.
  const c = WF.cleanRadios({ b24: { ch: 99, w: 80, tx: 'x' }, b5: { ch: 37, on: 0, tx: 99 } }, 'ap');
  assert.deepEqual(c.b24, { on: true, ch: 1, w: 20, tx: 14, gain: 4 });
  assert.equal(c.b5.ch, 36); assert.equal(c.b5.on, false); assert.equal(c.b5.tx, 36);
  assert.deepEqual(WF.cleanRadios(c, 'ap'), c);
  const set = WF.cleanWifi({ reg: 'xx', target: -10, cover: 500, env: 'office' });
  assert.equal(set.reg, 'eu'); assert.equal(set.target, -40); assert.equal(set.cover, 100); assert.equal(set.env, 'office');
  assert.deepEqual(WF.cleanWifi(set), set);
  assert.equal(WF.cleanWifi().target, NET.WIFI_TARGET_DBM.v); assert.equal(WF.cleanWifi().noise, -92);
});

test('cleanNet garde les radios des points d’accès (ap et ap6)', () => {
  const n = cleanNet({ devices: [{ id: 'a', type: 'ap', p: { radios: { b5: { ch: 52, w: 80, tx: 15 } } } }, { id: 'b', type: 'ap6', p: {} }] });
  assert.equal(n.devices[0].p.radios.b5.ch, 52); assert.equal(n.devices[0].p.radios.b5.w, 80);
  assert.equal(n.devices[1].p.poeClass, 4); assert.equal(n.devices[1].p.radios.b24.ch, 1);
  assert.deepEqual(cleanNet(n).devices, n.devices);
});

test('carte : signal = Ptx + G − PL − murs, portes, étage voisin', () => {
  const f = floorOf('F1', { walls: [{ id: 'mid', a: [10, 0], b: [10, 10], mat: 'brick', t: 0.1 }], doors: [{ id: 'd1', wall: 'mid', at: 8.5, w: 1 }] });
  const data = { devices: [ap('a1', 'F1', 5, 5)], site: site(f), wifi: { rxH: 2.7 } };
  const res = WF.coverage(data, 'F1', 'b5', { step: 0.5 });
  const at = (x, y) => res.best[Math.floor((y - res.y0) / res.step) * res.nx + Math.floor((x - res.x0) / res.step)];
  const cx = x => res.x0 + (Math.floor((x - res.x0) / res.step) + 0.5) * res.step, cy = y => res.y0 + (Math.floor((y - res.y0) / res.step) + 0.5) * res.step;
  // Même pièce : vue directe (17 dBm + 5 dBi − PL), récepteur à la hauteur du point d'accès.
  const d1 = Math.hypot(cx(8) - 5, cy(5) - 5);
  near(at(8, 5), 22 - WF.pathLoss(d1, 'b5'), 0.01);
  // Derrière le mur de brique : la perte de la brique en plus.
  const d2 = Math.hypot(cx(12) - 5, cy(5) - 5);
  near(at(12, 5), 22 - WF.pathLoss(d2, 'b5') - WF.slabLoss('brick', 0.1, 5200), 0.01);
  // Par la porte (8 à 9 m le long du mur, depuis son extrémité a) : la perte d'une porte en bois à la place.
  const yc = 5 + (cy(9.5) - 5) * (10 - 5) / (cx(12) - 5);
  assert.ok(yc >= 8 && yc <= 9, 'le rayon passe par la porte');
  near(at(12, 9.5), 22 - WF.pathLoss(Math.hypot(cx(12) - 5, cy(9.5) - 5), 'b5') - WF.slabLoss('wood', WF.MAT_T.wood, 5200), 0.01);
  // Environnement « office » : N de P.1238 (31 à 5 GHz), murs non recomptés.
  const off = WF.coverage({ ...data, wifi: { rxH: 2.7, env: 'office' } }, 'F1', 'b5', { step: 0.5 });
  near(off.best[Math.floor((cy(5) - off.y0) / off.step) * off.nx + Math.floor((cx(12) - off.x0) / off.step)], 22 - WF.pathLoss(d2, 'b5', 'office'), 0.01);
  // Point d'accès à l'étage du dessous : facteur de plancher (16 dB à 5 GHz), murs de l'étage ignorés.
  const f0 = floorOf('F0', { level: 0, elev: 0 }), f1 = { ...floorOf('F1b', { level: 1, elev: 3.5 }) };
  const d3 = { devices: [ap('a0', 'F0', 5, 5)], site: site(f0, f1) };
  const r1 = WF.coverage(d3, 'F1b', 'b5', { step: 1 });
  assert.equal(r1.aps.length, 1); assert.equal(r1.aps[0].same, false);
  const c = Math.floor((5.5 - r1.y0) / 1) * r1.nx + Math.floor((5.5 - r1.x0) / 1), px = r1.x0 + (Math.floor((5.5 - r1.x0)) + 0.5), py = r1.y0 + (Math.floor((5.5 - r1.y0)) + 0.5);
  near(r1.best[c], 22 - WF.pathLoss(Math.hypot(px - 5, py - 5, 3.5 + 1 - 2.7), 'b5') - 16, 0.01);
  // Radio coupée : rien.
  const d4 = { devices: [ap('a1', 'F1', 5, 5, { b5: { on: false, ch: 36, w: 20, tx: 17, gain: 5 } })], site: site(f) };
  assert.equal(WF.coverage(d4, 'F1', 'b5').best.every(v => v === -Infinity), true);
  // Mis en cache : même objet tant que rien ne change.
  assert.equal(WF.coverage(data, 'F1', 'b5', { step: 0.5 }), res);
});

test('couverture des pièces, recouvrements co-canal', () => {
  const rooms = [{ id: 'r1', name: 'Salle 1', usage: 'classroom', poly: rect(0, 0, 10, 10) }, { id: 'r2', name: 'Salle 2', usage: 'classroom', poly: rect(10, 0, 20, 10) }, { id: 'r3', name: 'Couloir', usage: 'corridor', poly: rect(20, 0, 22, 10) }];
  const f = floorOf('F1', { w: 22, walls: [{ id: 'm1', a: [10, 0], b: [10, 10], mat: 'concrete', t: 0.3 }, { id: 'm2', a: [20, 0], b: [20, 10], mat: 'concrete', t: 0.3 }], rooms });
  const data = { devices: [ap('a1', 'F1', 5, 5)], site: site(f) };
  const rc = WF.roomsCoverage(data, 'F1', 'b5');
  assert.equal(rc.length, 3); assert.ok(rc[0].pct > 95, 'salle de l’AP couverte'); assert.ok(rc[1].pct < 20, 'salle voisine derrière 30 cm de béton');
  assert.equal(rc[2].needs, false); assert.ok(rc[0].area > 90 && rc[0].area < 110);
  // Deux points d'accès proches sur le même canal : recouvrement ; sur 1 et 6 : aucun.
  const same = { devices: [ap('a1', 'F1', 4, 5), ap('a2', 'F1', 7, 5)], site: site(f) };
  const ov = WF.overlapsOf(WF.coverage(same, 'F1', 'b24', { step: 1 }));
  assert.equal(ov.length, 1); assert.equal(ov[0].kind, 'co');
  same.devices[1].p.radios.b24.ch = 6; same.devices[1].p.radios.b5.ch = 44;
  assert.equal(WF.overlapsOf(WF.coverage(same, 'F1', 'b24', { step: 1 })).length, 0);
  assert.equal(WF.overlapsOf(WF.coverage(same, 'F1', 'b5', { step: 1 })).length, 0);
  same.devices[1].p.radios.b24.ch = 3;
  assert.equal(WF.overlapsOf(WF.coverage(same, 'F1', 'b24', { step: 1 }))[0].kind, 'adj');
  // Bilan du site.
  // À 2,4 GHz, 30 cm de béton à 10 m laissent encore passer l'objectif (perte plus faible qu'à 5 GHz).
  assert.ok(WF.roomsCoverage(data, 'F1', 'b24')[1].pct > rc[1].pct);
  const sc = WF.siteCoverage(data);
  assert.equal(sc.length, 1); assert.ok(sc[0].pct > 0 && sc[0].pct < 100);
});

test('plan de canaux automatique : 1/6/11 et blocs de 5 GHz distincts', () => {
  const f = floorOf('F1', { w: 40, h: 10 });
  const devices = [ap('a', 'F1', 5, 5), ap('b', 'F1', 15, 5), ap('c', 'F1', 25, 5), ap('d', 'F1', 35, 5)];
  const data = { devices, site: site(f) };
  const ch24 = WF.autoChannels(data, 'b24');
  WF.applyChannels(data, ch24);
  const got = devices.map(d => d.p.radios.b24.ch);
  for (const c of got) assert.ok([1, 6, 11].includes(c));
  for (let i = 1; i < got.length; i++) assert.notEqual(got[i], got[i - 1], 'voisins sur des canaux différents');
  WF.applyChannels(data, WF.autoChannels(data, 'b5'));
  const c5 = devices.map(d => d.p.radios.b5.ch);
  assert.equal(new Set(c5).size, 4, '4 blocs de 40 MHz différents');
  for (const c of c5) assert.ok(WF.channels('b5', 'eu', 40).includes(c));
  assert.equal(WF.autoChannels(data, 'b5').length, 0, 'stable');
});

test('vérifications J1265–J1272', () => {
  const rooms = [{ id: 'r1', name: 'Salle 1', usage: 'classroom', poly: rect(0, 0, 10, 10) }, { id: 'r2', name: 'Salle 2', usage: 'classroom', poly: rect(10, 0, 20, 10) }];
  const f = floorOf('F1', { walls: [{ id: 'm1', a: [10, 0], b: [10, 10], mat: 'concrete', t: 0.3 }], rooms });
  const codes = data => issues(data, null, { name: id => id }).map(i => i.code + ':' + i.id).sort();
  const base = () => ({ devices: [ap('a1', 'F1', 5, 5), ap('a2', 'F1', 15, 5, { b24: { on: true, ch: 6, w: 20, tx: 14, gain: 4 }, b5: { on: true, ch: 44, w: 40, tx: 17, gain: 5 } })], site: site(f), wifi: { band: 'b5' } });
  assert.deepEqual(codes(base()), []);
  const d = base(); d.devices[1].loc.x = 5.5; d.devices[1].loc.y = 4; // Salle 2 vide, deux AP dans la salle 1
  const c = codes(d); assert.ok(c.includes('J1265:r2')); assert.ok(!c.includes('J1265:r1'));
  const e = base(); e.devices[1].p.radios.b24.ch = 1; e.devices[1].loc.x = 6; // même canal à 1 m
  assert.ok(codes(e).includes('J1266:a1'));
  const g = base(); g.devices[0].p.radios.b24.ch = 3; assert.ok(codes(g).includes('J1267:a1'));
  g.devices[0].p.radios.b24.tx = 30; assert.ok(codes(g).includes('J1268:a1'));
  const h = base(); delete h.devices[0].loc; assert.ok(codes(h).includes('J1269:a1'));
  const k = base(); k.devices[0].p.radios.b24.w = 40; k.devices[0].p.radios.b24.ch = 1; assert.ok(codes(k).includes('J1270:a1'));
  const m = base(); m.devices[0].p.radios.b5.ch = 149; m.devices[0].p.radios.b5.w = 20; assert.ok(codes(m).includes('J1271:a1'));
  const n = base(); n.devices[0].p.radios.b24.on = false; n.devices[0].p.radios.b5.on = false; assert.ok(codes(n).includes('J1272:a1'));
  // Sans plan : pas de J1269 ni de couverture.
  assert.deepEqual(codes({ devices: [{ ...ap('a1', 'F1', 1, 1), loc: undefined }] }), []);
  for (const code of Object.keys(CODES)) assert.ok(SRC[code] && SRC[code].length, code);
});

test('contrôles de TP net-wifi-cover et net-wifi-chan', () => {
  const rooms = [{ id: 'r1', name: 'Salle 1', usage: 'classroom', poly: rect(0, 0, 10, 10) }, { id: 'r2', name: 'Salle 2', usage: 'classroom', poly: rect(10, 0, 20, 10) }];
  const f = floorOf('F1', { walls: [{ id: 'm1', a: [10, 0], b: [10, 10], mat: 'concrete', t: 0.3 }], rooms });
  const data = { devices: [ap('a1', 'F1', 5, 5), ap('a2', 'F1', 6, 5)], site: site(f), wifi: { band: 'b5' } };
  const env = { netData: () => data };
  const cov = LAB['net-wifi-cover'];
  let r = cov.check({}, env); assert.equal(r.ok, false); assert.equal(r.bad[0].name, 'Salle 2'); assert.match(cov.text({}, r), /Salle 2/);
  assert.equal(cov.check({ rooms: ['Salle 1'] }, env).ok, true);
  const chan = LAB['net-wifi-chan'];
  r = chan.check({}, env); assert.equal(r.ok, false); assert.equal(r.why, 'overlap'); assert.ok(chan.text({}, r));
  data.devices[1].loc.x = 15; data.devices[1].p.radios.b24.ch = 6; data.devices[1].p.radios.b5.ch = 44;
  assert.equal(cov.check({}, env).ok, true); assert.equal(chan.check({}, env).ok, true);
  data.devices[1].p.radios.b24.ch = 4; assert.equal(chan.check({}, env).why, 'chan');
  assert.equal(chan.check({}, { netData: () => ({ devices: [], site: site(f) }) }).why, 'noap');
});

test('performance : étage de 100 × 60 m, 300 murs, 20 points d’accès', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const walls = [], rooms = [];
  for (let i = 0; i <= 10; i++) for (let j = 0; j < 6; j++) walls.push({ id: `v${i}_${j}`, a: [i * 10, j * 10], b: [i * 10, j * 10 + 10], mat: i % 3 ? 'drywall' : 'concrete', t: 0.1 });
  for (let j = 0; j <= 6; j++) for (let i = 0; i < 10; i++) walls.push({ id: `h${i}_${j}`, a: [i * 10, j * 10], b: [i * 10 + 10, j * 10], mat: 'brick', t: 0.2 });
  while (walls.length < 300) { const x = rnd() * 100, y = rnd() * 60; walls.push({ id: 'g' + walls.length, a: [x, y], b: [x + rnd() * 4, y + rnd() * 4], mat: 'glass', t: 0.02 }); }
  for (let i = 0; i < 10; i++) for (let j = 0; j < 6; j++) rooms.push({ id: `R${i}_${j}`, name: `S${i}${j}`, usage: 'classroom', poly: rect(i * 10, j * 10, i * 10 + 10, j * 10 + 10) });
  const devices = Array.from({ length: 20 }, (_, k) => ap('p' + k, 'P', 5 + (k % 5) * 20, 7 + Math.floor(k / 5) * 15));
  const data = { devices, site: { buildings: [{ id: 'B', floors: [{ id: 'P', level: 0, elev: 0, height: 3.5, ceil: 2.7, walls, doors: [], rooms }] }] } };
  WF.coverage(data, 'P', 'b5', { step: 1 }); // échauffement du moteur JS
  devices[0].loc.x += 0.5;
  let t = performance.now(); const res = WF.coverage(data, 'P', 'b5'); const map = performance.now() - t;
  assert.ok(res.nx * res.ny > 15000);
  devices[0].loc.x += 0.5;
  t = performance.now(); const list = issues(data, null, { name: id => id }); const chk = performance.now() - t;
  console.log(`    carte ${res.nx}×${res.ny} (pas ${res.step} m) : ${map.toFixed(0)} ms ; vérifications (2 bandes, pas 1 m) : ${chk.toFixed(0)} ms, ${list.length} remarque(s)`);
  assert.ok(map < 1000 * PERF, `carte en ${map} ms`);
  assert.ok(chk < 1500 * PERF, `vérifications en ${chk} ms`);
});

test('point d’accès sans courant : il n’émet rien', async () => {
  const { createLan } = await import('./lan.js');
  const f = floorOf('F1', { rooms: [{ id: 'r1', name: 'Salle 1', usage: 'classroom', poly: rect(0, 0, 10, 10) }] });
  const data = { devices: [ap('a1', 'F1', 5, 5)], cables: [], site: site(f) };
  const lan = createLan({ data: () => data, ext: () => [] });
  const p = WF.powered(data, lan);
  assert.equal(p.devices[0].unpowered, true); assert.equal(p.devices[0].p.radios.b5.on, false);
  assert.equal(data.devices[0].p.radios.b5.on, true, 'le plan n’est pas modifié');
  assert.equal(WF.powered(data, null), data);
  assert.equal(LAB['net-wifi-cover'].check({}, { netData: () => data, lan: () => lan }).ok, false);
  assert.equal(LAB['net-wifi-cover'].check({}, { netData: () => data }).ok, true);
});

test('outils de l’IA wifi_get, wifi_set, wifi_autochannel, wifi_coverage', async () => {
  const { tools } = await import('../ai/tools-net-wifi.js');
  const f = floorOf('F1', { w: 30, rooms: [{ id: 'r1', name: 'Salle 1', usage: 'classroom', poly: rect(0, 0, 15, 10) }, { id: 'r2', name: 'Salle 2', usage: 'office', poly: rect(15, 0, 30, 10) }] });
  const data = { devices: [ap('a1', 'F1', 5, 5), ap('a2', 'F1', 20, 5)], site: site(f) };
  let commits = 0;
  const T = Object.fromEntries(tools({ netWs: async () => ({ data: () => data, commit: () => { commits++; } }), fail: m => { throw new Error(m); } }).map(t => [t.name, t]));
  const g = await T.wifi_get.run({});
  assert.equal(g.access_points.length, 2); assert.equal(g.settings.target_dbm, -67); assert.deepEqual(g.channels['5GHz_80MHz'], [36, 52, 100, 116]);
  assert.equal(g.overlaps.length, 2, 'même canal à 2,4 et à 5 GHz');
  const a = await T.wifi_autochannel.run({ band: '2.4' }); assert.equal(a.applied, true); assert.equal(commits, 1);
  assert.equal((await T.wifi_get.run({})).overlaps.filter(o => o.band === '2.4GHz').length, 0);
  await T.wifi_set.run({ ap: 'A1', band: '5', width_mhz: 80 }); assert.equal(data.devices[0].p.radios.b5.w, 80); assert.equal(data.devices[0].p.radios.b5.ch, 36);
  await assert.rejects(T.wifi_set.run({ ap: 'A1', band: '5', channel: 149 }), /not a valid/);
  await assert.rejects(T.wifi_set.run({ ap: 'A1', band: '5', width_mhz: 160 }), /not supported/);
  const s = await T.wifi_set.run({ target_dbm: -70, regulatory_domain: 'us' }); assert.equal(s.settings.target_dbm, -70); assert.equal(data.wifi.reg, 'us');
  const c = await T.wifi_coverage.run({ band: '5' }); assert.equal(c.floors.length, 1); assert.equal(c.floors[0].rooms.length, 2); assert.equal(c.target_dbm, -70);
  await assert.rejects(T.wifi_coverage.run({ floor: 'nope' }), /no floor/);
});

test('taille réelle : 3 bâtiments × 4 étages, 80 points d’accès', () => {
  const buildings = [], devices = [];
  for (let b = 0; b < 3; b++) {
    const floors = [];
    for (let l = 0; l < 4; l++) {
      const id = `B${b}F${l}`, walls = [], rooms = [];
      for (let i = 0; i < 8; i++) {
        rooms.push({ id: id + 'n' + i, name: 'N' + i, usage: 'office', poly: rect(i * 8, 0, i * 8 + 8, 8) }, { id: id + 's' + i, name: 'S' + i, usage: 'classroom', poly: rect(i * 8, 12, i * 8 + 8, 20) });
        walls.push({ id: id + 'wn' + i, a: [i * 8, 0], b: [i * 8, 8], mat: 'drywall', t: 0.1 }, { id: id + 'ws' + i, a: [i * 8, 12], b: [i * 8, 20], mat: 'brick', t: 0.2 });
      }
      walls.push({ id: id + 'c1', a: [0, 8], b: [64, 8], mat: 'block', t: 0.2 }, { id: id + 'c2', a: [0, 12], b: [64, 12], mat: 'block', t: 0.2 });
      floors.push({ ...floorOf(id, { w: 64, h: 20, level: l, elev: l * 3.5, walls, rooms }) });
      const n = b * 4 + l < 8 ? 7 : 6;
      for (let k = 0; k < n; k++) devices.push(ap(`${id}a${k}`, id, 4 + k * 9, 10));
    }
    buildings.push({ id: 'B' + b, name: 'B' + b, floors });
  }
  const data = { devices, site: { buildings } };
  assert.equal(devices.length, 80);
  let t = performance.now(); const first = issues(data, null, { name: id => id }); const t1 = performance.now() - t;
  devices[0].loc.x += 1; // un point d'accès déplacé : seuls son étage et ses voisins se recalculent
  t = performance.now(); issues(data, null, { name: id => id }); const t2 = performance.now() - t;
  console.log(`    12 étages, 80 points d’accès : premières vérifications ${t1.toFixed(0)} ms, après un déplacement ${t2.toFixed(0)} ms (${first.length} remarque(s))`);
  assert.ok(t1 < 1500 * PERF && t2 < 500 * PERF);
});

test('6 GHz : canaux, blocs, PSC, domaines, limite LPI', () => {
  assert.equal(WF.allowed('b6', 'eu').length, 24); assert.equal(WF.allowed('b6', 'us').length, 59);
  assert.deepEqual(WF.channels('b6', 'eu', 80), [5, 21, 37, 53, 69, 85], 'un PSC par bloc de 80 MHz');
  assert.equal(WF.channels('b6', 'us', 80).length, 14); assert.equal(WF.channels('b6', 'us', 160).length, 7); assert.equal(WF.channels('b6', 'eu', 160).length, 3);
  assert.equal(WF.channels('b6', 'us', 40).length, 29); assert.equal(WF.clearCount('b6', 'eu', 40), 12);
  assert.deepEqual(WF.block6(37, 80), [33, 45]); assert.deepEqual(WF.block6(37, 160), [33, 61]); assert.equal(WF.block6(3, 20), null);
  assert.ok(WF.isPsc(37) && !WF.isPsc(33));
  near(WF.span('b6', 5, 20)[0], 5965, 1e-9); // 5950 + 5 × 5 − 10
  assert.ok(!WF.overlap(WF.span('b6', 5, 80), WF.span('b6', 21, 80))); assert.ok(WF.overlap(WF.span('b6', 5, 80), WF.span('b6', 9, 20)));
  assert.ok(!WF.overlap(WF.span('b6', 5, 20), WF.span('b5', 165, 20)), 'bandes distinctes');
  // Limite LPI : Europe min(23, 10 + 10 log w) = 23 dBm ; États-Unis min(30, 5 + 10 log w) : 18 / 24 / 27 dBm.
  assert.equal(WF.lpiMax('eu', 20), 23); assert.equal(WF.lpiMax('eu', 160), 23);
  assert.equal(WF.lpiMax('us', 20), 18); assert.equal(WF.lpiMax('us', 80), 24); assert.equal(WF.lpiMax('us', 160), 27);
  const r = { on: true, ch: 101, w: 80, tx: 14, gain: 6 };
  assert.equal(WF.radioFault('ap6e', 'b6', r, 'eu').why, 'reg'); assert.equal(WF.radioFault('ap6e', 'b6', r, 'us'), null);
  assert.equal(WF.radioFault('ap6e', 'b6', { ...r, ch: 5 }, 'eu'), null); assert.equal(WF.radioFault('ap6e', 'b6', { ...r, ch: 3 }, 'eu').why, 'block');
  assert.equal(WF.radioFault('ap6', 'b6', r, 'eu'), null, 'pas de radio 6 GHz : rien à vérifier');
  assert.equal(WF.powerFault('ap6e', 'b6', { ...r, ch: 5, tx: 18 }, 'eu').kind, 'lpi'); // 24 > 23
  assert.equal(WF.powerFault('ap6e', 'b6', { ...r, ch: 5, w: 20, tx: 13 }, 'us').kind, 'lpi'); // 19 > 18
  assert.equal(WF.powerFault('ap6e', 'b6', { ...r, ch: 5, tx: 27 }, 'us').kind, 'tx'); // 27 > 26 (fiche)
  assert.equal(WF.powerFault('ap6e', 'b6', { ...r, ch: 5 }, 'eu'), null);
  // Réglages : seul ap6e a une radio de 6 GHz ; les défauts restent dans les règles.
  assert.deepEqual(WF.bandsOf('ap6e'), ['b24', 'b5', 'b6']); assert.deepEqual(WF.bandsOf('ap'), ['b24', 'b5']);
  assert.equal(WF.defaultRadios('ap').b6, undefined); assert.equal(WF.radio(WF.defaultRadios('ap'), 'b6').on, false);
  const d6 = WF.defaultRadios('ap6e');
  for (const reg of ['eu', 'us']) for (const b of WF.BANDS) { assert.equal(WF.radioFault('ap6e', b, d6[b], reg), null, b + reg); assert.equal(WF.powerFault('ap6e', b, d6[b], reg), null, b + reg); }
  assert.equal(WF.cleanRadios({ b6: { ch: 4 } }, 'ap6e').b6.ch, 5); assert.equal(WF.cleanRadios({ b6: { ch: 233, w: 20 } }, 'ap6e').b6.ch, 233);
  assert.equal(WF.cleanRadios({ b6: { ch: 37 } }, 'ap').b6, undefined);
  // Pertes : P.2040 à 6185 MHz, plus forte qu'à 5,2 GHz pour le béton ; P.1238 extrapolé (N 24, plancher 22 dB).
  assert.ok(WF.wallLoss({ mat: 'concrete', t: 0.2 }, 'b6') > WF.wallLoss({ mat: 'concrete', t: 0.2 }, 'b5'));
  near(WF.pathLoss(10, 'b6', 'office') - WF.pathLoss(1, 'b6', 'office'), 24, 1e-9); assert.equal(WF.floorLoss('b6', 'walls'), 22);
});

test('carte 6 GHz et SINR : brouilleurs au prorata du spectre commun', () => {
  const f = floorOf('F1', { w: 30, rooms: [{ id: 'r1', name: 'Salle 1', usage: 'classroom', poly: rect(0, 0, 30, 10) }] });
  const data = { devices: [ap('a1', 'F1', 5, 5, {}, 'ap6e'), ap('a2', 'F1', 25, 5, {}, 'ap6e')], site: site(f) };
  const r6 = WF.coverage(data, 'F1', 'b6', { step: 1 });
  assert.ok(r6.best.some(v => v > -60), '6 GHz rayonne');
  // Sans brouilleur sur le canal : SINR = SNR ; même canal : le SINR chute près de la frontière des cellules.
  data.devices[1].p.radios.b6.ch = 21; // autre bloc de 80 MHz
  const clear = WF.coverage(data, 'F1', 'b6', { step: 1 });
  const c = Math.floor((5 - clear.y0)) * clear.nx + Math.floor((15 - clear.x0)); // milieu, entre les deux
  near(clear.sinr[c], clear.best[c] - clear.set.noise, 1e-3);
  data.devices[1].p.radios.b6.ch = 5;
  const co = WF.coverage(data, 'F1', 'b6', { step: 1 });
  assert.ok(co.sinr[c] < 3, `SINR au milieu ${co.sinr[c]}`);
  assert.ok(co.sinr[c] > -3);
  // 2,4 GHz : canal 3 face au canal 1 compte au prorata du spectre commun (12 MHz sur 22).
  data.devices[0].p.radios.b24.ch = 1; data.devices[1].p.radios.b24.ch = 3;
  const adj = WF.coverage(data, 'F1', 'b24', { step: 1 });
  const s = adj.srv[c], k = 1 - s, im = (12 / 22) * 10 ** (adj.rssi[k][c] / 10);
  near(adj.sinr[c], adj.best[c] - 10 * Math.log10(10 ** (adj.set.noise / 10) + im), 1e-3);
  // Meilleure bande : 6 GHz incluse quand un point d'accès l'a.
  const any = WF.coverageAny(data, 'F1', { step: 1 }); assert.ok(any.parts.b6); assert.equal(any.sinr.length, any.best.length);
  assert.ok(WF.floorPct(any, f, any.set.sinr, 'sinr') >= 0);
  // Plan automatique à 6 GHz : deux voisins sur deux PSC différents.
  WF.applyChannels(data, WF.autoChannels(data, 'b6'));
  const ch = data.devices.map(d => d.p.radios.b6.ch); assert.notEqual(ch[0], ch[1]); for (const x of ch) assert.ok(WF.isPsc(x));
});

test('vérifications 6 GHz : LPI, domaine, ap6e sans plan', () => {
  const f = floorOf('F1', { rooms: [{ id: 'r1', name: 'Salle 1', usage: 'classroom', poly: rect(0, 0, 20, 10) }] });
  const d = { devices: [ap('a1', 'F1', 10, 5, {}, 'ap6e')], site: site(f) };
  const codes = () => issues(d, null, { name: id => id }).map(i => i.code);
  assert.deepEqual(codes(), []);
  d.devices[0].p.radios.b6.tx = 20; assert.ok(codes().includes('J1268'));
  assert.match(issues(d, null, { name: id => id }).find(i => i.code === 'J1268').text, /LPI/);
  d.devices[0].p.radios.b6.tx = 14; d.devices[0].p.radios.b6.ch = 117; assert.ok(codes().includes('J1271'));
  d.wifi = { reg: 'us' }; assert.ok(!codes().includes('J1271'));
  for (const b of WF.BANDS) d.devices[0].p.radios[b].on = false; assert.ok(codes().includes('J1272'));
});
