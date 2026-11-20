// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du dimensionnement et du générateur (src/net/dimension.js) : node --test src/net/dimension.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyL3, cleanDesign, dimension, applyDesign, previewDesign, polyArea, polyCentroid, inPoly, alongWalls, usageOf, horizontalLinks, mountOf, switchPorts, designTypes, USAGES } from './dimension.js';
import { DEVICES, specOf } from './devices.js';
import { NET } from './limits.js';
import { fixture, bigFixture } from './dimension.fixture.mjs';
/** Seuils de temps : stricts avec JOLLOF_PERF_STRICT=1 (mesure seule) ; × 8 sinon (suite complète en parallèle, machine chargée). */
const PERF = process.env.JOLLOF_PERF_STRICT ? 1 : 8;

/** Meilleur temps de n essais (ms) : la machine peut être chargée par d'autres tâches. */
const best = (f, n = 3) => { let m = Infinity; for (let i = 0; i < n; i++) { const t = performance.now(); f(); m = Math.min(m, performance.now() - t); } return m; };
const withDesign = (o = {}) => { const d = fixture(); d.design = cleanDesign(o); return d; };

test('paramètres : valeurs par défaut, bornes, déchets, idempotence', () => {
  const d = cleanDesign(undefined);
  assert.equal(d.area, NET.WA_AREA_M2.v); assert.equal(d.outlets, NET.WA_OUTLETS.v); assert.equal(d.box, NET.CABLE_BOX_M.v); assert.equal(d.oversub, NET.OVERSUB_ACCESS.v);
  assert.deepEqual(d.slack, { tr: 3, wa: 0.3 }); assert.equal(d.cat, 'cat6a'); assert.equal(d.labels.preset, 'auto');
  assert.equal(cleanDesign({ labels: { preset: 'rack', link: 'zz' } }).labels.link, '{fs}.R{r}-{u}:{n}', 'préréglage : ses formats');
  const g = cleanDesign({ area: -5, spare: 'x', cat: 'cat9', slack: { tr: 99, wa: 'a' }, labels: { link: '', panel: '<b>{fs}', preset: 'custom' }, prices: { outlet2: 12.5, bad: -1, 'x y': 3 }, currency: 'XOF', rooms: { r1: { tr: 'rk1', outlets: 4 }, r2: {} }, labour: [{ name: 'Pose', qty: 10, price: 30 }, { qty: 1 }], project: { date: '2026-11-20', client: 'ACME' }, usage: { office: { area: 8 } } });
  assert.equal(g.area, 1); assert.equal(g.spare, 20); assert.equal(g.cat, 'cat6a'); assert.deepEqual(g.slack, { tr: 20, wa: 0.3 });
  assert.equal(g.labels.link, '{fs}-{p}{n}', 'format vide : celui de TIA-606'); assert.equal(g.labels.panel, 'b{fs}', 'chevrons retirés'); assert.deepEqual(g.prices, { outlet2: 12.5 });
  assert.equal(g.currency, 'XOF'); assert.deepEqual(g.rooms, { r1: { tr: 'rk1', outlets: 4 } }); assert.equal(g.labour.length, 1); assert.equal(g.usage.office.area, 8);
  assert.equal(g.project.date, '2026-11-20');
  assert.deepEqual(cleanDesign(cleanDesign(g)), cleanDesign(g)); assert.deepEqual(cleanDesign(cleanDesign({})), cleanDesign({}));
  for (const k of Object.keys(USAGES)) assert.ok(g.usage[k], k);
});

test('géométrie : aire, centre, appartenance, prises le long des murs', () => {
  const sq = [[0, 0], [4, 0], [4, 3], [0, 3]];
  assert.equal(polyArea(sq), 12); assert.deepEqual(polyCentroid(sq), [2, 1.5]);
  assert.equal(inPoly(1, 1, sq), true); assert.equal(inPoly(5, 1, sq), false);
  const pts = alongWalls(sq, 6, 0.3);
  assert.equal(pts.length, 6); for (const p of pts) assert.ok(inPoly(p[0], p[1], sq), 'à l’intérieur');
  assert.equal(usageOf('Bureau'), 'office'); assert.equal(usageOf('couloir'), 'corridor'); assert.equal(usageOf('???'), 'other');
});

test('dimensionnement : postes, prises, local desservi, réserve, PoE, câble estimé', () => {
  const r = dimension(withDesign());
  const room = n => r.rooms.find(x => x.id === n);
  assert.equal(room('f0-b1').wa, 3); assert.equal(room('f0-b1').outlets, 6); // 25 m² → 3 postes × 2 prises
  assert.equal(room('f0-os').outlets, 30); assert.equal(room('f0-mt').outlets, 4); assert.equal(room('f0-co').outlets, 1); assert.equal(room('f0-lt').outlets, 0);
  assert.equal(r.trs.length, 2, 'la baie du RDC et un local à créer au R+1');
  const [t0, t1] = r.trs; assert.equal(t0.virtual, false); assert.equal(t1.virtual, true);
  assert.equal(t0.outlets, 53); assert.equal(t0.ports, Math.ceil(53 * 1.2));
  assert.ok(t0.accPorts >= t0.ports, 'assez de ports de switch');
  assert.equal(t0.panels, Math.ceil(t0.ports / t0.panelPorts));
  assert.equal(room('f1-b1').tr, t1.key);
  assert.equal(t0.cable.est, true); assert.ok(t0.cable.avg > 5 && t0.cable.avg < NET.PERMANENT_M.v);
  assert.equal(r.totals.outlets, 106); assert.equal(r.totals.phones, 2 * (9 + 15 + 1));
  assert.ok(r.cable.boxes >= Math.ceil(r.cable.total / NET.CABLE_BOX_M.v));
  assert.ok(r.totals.poeW > 0); assert.equal(r.fibre.est, true); assert.ok(r.fibre.strands >= 12);
  assert.ok(t0.u > 0 && t0.racksNeeded >= 1);
});

test('dimensionnement : densité, réserve et pièce imposée changent le résultat', () => {
  const a = dimension(withDesign({ area: 5 })), b = dimension(withDesign({ spare: 50 })), c = dimension(withDesign({ rooms: { 'f0-b1': { outlets: 1 }, 'f1-os': { tr: 'rk1' } } }));
  assert.equal(a.rooms.find(x => x.id === 'f0-b1').outlets, 10);
  assert.equal(b.trs[0].ports, Math.ceil(53 * 1.5));
  assert.equal(c.rooms.find(x => x.id === 'f0-b1').outlets, 1);
  assert.equal(c.rooms.find(x => x.id === 'f1-os').tr, 'f0|f0-lt', 'pièce du R+1 desservie par la baie imposée');
  assert.ok(c.rooms.find(x => x.id === 'f1-os').run > c.rooms.find(x => x.id === 'f0-os').run, 'trajet plus long : un étage de plus');
});

test('générateur : prises dans leurs pièces, liens permanents, cordons, baies sans chevauchement', () => {
  const d = withDesign(), pv = previewDesign(d);
  assert.equal(d.devices.length, 0, 'l’aperçu ne modifie rien');
  const res = applyDesign(d);
  assert.deepEqual(res.created, pv.created, 'l’aperçu annonce ce qui sera posé');
  assert.ok(res.created.outlets > 0 && res.created.panels > 0 && res.created.switches > 0);
  const ids = new Set(d.devices.map(x => x.id)); assert.equal(ids.size, d.devices.length, 'identifiants uniques');
  assert.equal(new Set(d.devices.map(x => x.name)).size, d.devices.length, 'noms uniques');
  // chaque port arrière de prise a son lien permanent
  const links = horizontalLinks(d), linked = new Set(links.map(l => l.outlet + '|' + l.oport));
  let ports = 0;
  for (const o of d.devices.filter(x => /^outlet/.test(x.type))) for (const p of specOf(o).ports(o.p).filter(p => p.punch)) { ports++; assert.ok(linked.has(o.id + '|' + p.id), o.name + ' ' + p.id); }
  assert.equal(ports, 106, 'autant de ports de prise que le dimensionnement');
  for (const l of links) assert.equal((d.cables.find(c => c.id === l.cable).route || {}).mode, 'auto');
  // prises placées dans leur pièce
  const rooms = new Map(d.site.buildings[0].floors.flatMap(f => f.rooms).map(r => [r.id, r]));
  const fr = d.devices.filter(x => /^outlet/.test(x.type) && x.loc);
  assert.equal(fr.length, d.devices.filter(x => /^outlet/.test(x.type)).length, 'chaque prise a sa place sur le plan');
  for (const o of fr) assert.ok([...rooms.values()].some(r => inPoly(o.loc.x, o.loc.y, r.poly)), o.name);
  // chaque port de câble pris une seule fois
  const used = new Set(); for (const c of d.cables) for (const e of [c.a, c.b]) { const k = e.join('|'); assert.ok(!used.has(k), k); used.add(k); }
  // baies : pas deux équipements sur la même unité
  const occ = new Map();
  for (const x of d.devices.filter(x => x.rack)) for (let u = 0; u < mountOf(x.type).u; u++) { const k = x.rack.id + ':' + (x.rack.u + u); assert.ok(!occ.has(k), k); occ.set(k, x.id); }
  assert.equal(d.racks.length, 2, 'une baie créée au R+1'); assert.equal(d.racks[1].floor, 'f1');
  assert.equal(res.created.vlans, 4); assert.deepEqual(d.vlans.map(v => v.id), [10, 20, 30, 99]);
  // cordons : chaque port de switch d'accès relié au plus une fois, autant de cordons que de liens (capacité suffisante)
  const T = designTypes(d.design), swAcc = new Set(d.devices.filter(x => x.type === T.sw48 || x.type === T.sw24).flatMap(s => switchPorts(s.type).acc.map(p => s.id + '|' + p.id)));
  const cords = d.cables.filter(c => swAcc.has(c.a.join('|')) || swAcc.has(c.b.join('|')));
  assert.equal(cords.length, links.length);
  // le câble réel remplace l'estimation
  const r2 = dimension(d); assert.equal(r2.trs[0].cable.est, false); assert.equal(r2.totals.newRacks, 0);
  assert.equal(r2.rooms.find(x => x.id === 'f0-b1').placed, 6);
  // deuxième passage : les pièces déjà équipées sont laissées telles quelles
  const again = applyDesign(d); assert.deepEqual(again.created, { devices: 0, cables: 0, racks: 0, vlans: 0, outlets: 0, panels: 0, switches: 0 }, 'rien de nouveau, pas de second cœur'); assert.ok(again.skipped.length >= 10);
});

test('générateur : point d’accès posé relié à sa prise au plafond, baie finie (PDU, onduleur, obturateurs)', () => {
  const d = withDesign(); d.devices.push({ id: 'ap1', type: DEVICES.ap6 ? 'ap6' : 'ap', x: 0, y: 0, name: 'AP1', p: DEVICES[DEVICES.ap6 ? 'ap6' : 'ap'].props(), loc: { floor: 'f0', x: 20, y: 5, h: 3 } });
  applyDesign(d);
  const c = d.cables.find(x => x.a[0] === 'ap1' || x.b[0] === 'ap1'); assert.ok(c, 'cordon du point d’accès');
  const o = d.devices.find(x => x.id === (c.a[0] === 'ap1' ? c.b[0] : c.a[0])); assert.match(o.type, /^outlet/); assert.ok(o.loc.h > 2, 'au plafond');
  assert.ok(horizontalLinks(d).some(l => l.outlet === o.id), 'sa prise a son lien permanent');
  for (const r of d.racks) {
    const devs = d.devices.filter(x => x.rack && x.rack.id === r.id);
    if (DEVICES.pdu) assert.ok(devs.some(x => /^pdu/.test(x.type)), 'PDU');
    if (DEVICES.ups) assert.ok(devs.some(x => /^ups/.test(x.type)), 'onduleur');
    const used = devs.reduce((a, x) => a + mountOf(x.type).u, 0); if (DEVICES.blank) assert.equal(used, r.u, 'façade pleine (obturateurs)');
  }
});

test('générateur : VLAN voix des postes à téléphone, SVI et DHCP du cœur d’après le plan d’adressage', async () => {
  const VLAN = await import('./vlan.js'), voiceField = 'voice' in (VLAN.PORT_DEFAULT || {});
  const vlans = () => [{ id: 10, name: 'DATA', net: '10.1.0.0/24', gw: '10.1.0.1' }, { id: 20, name: 'VOICE', net: '10.1.1.0/25', gw: '10.1.1.1' }, { id: 30, name: 'WIFI', net: '10.1.2.0/24', gw: '10.1.2.1' }, { id: 99, name: 'MGMT', net: '10.1.3.0/27', gw: '10.1.3.254' }];
  const d = withDesign(); d.vlans = vlans(); const res = applyDesign(d);
  const cfgs = d.devices.filter(x => /^switch(24|48)$/.test(x.type)).flatMap(x => Object.values(x.p.ports)).filter(c => c.mode === 'access');
  if (voiceField) assert.ok(cfgs.some(c => c.vlan === 10 && c.voice === 20), 'VLAN voix sur les ports des postes');
  else assert.ok(cfgs.some(c => c.vlan === 20), 'repli : second port du poste dans le VLAN VOICE');
  assert.ok(cfgs.some(c => c.vlan === 10));
  const core = d.devices.find(x => x.type === 'l3switch'); assert.ok(core && res.l3 && res.l3.core === core.id);
  assert.equal(core.p.routing, true);
  assert.deepEqual(core.p.svis.map(x => [x.vlan, x.ip, x.prefix]), [[10, '10.1.0.1', 24], [20, '10.1.1.1', 25], [30, '10.1.2.1', 24], [99, '10.1.3.254', 27]]);
  assert.deepEqual(core.p.dhcp.map(x => [x.net, x.from, x.to, x.gw]), [['10.1.0.0/24', '10.1.0.11', '10.1.0.254', '10.1.0.1'], ['10.1.1.0/25', '10.1.1.11', '10.1.1.126', '10.1.1.1'], ['10.1.2.0/24', '10.1.2.11', '10.1.2.254', '10.1.2.1']], 'pas d’étendue pour MGMT');
  const again = applyL3(d); assert.equal(again.svis, 0); assert.equal(again.scopes, 0); assert.equal(core.p.svis.length, 4); assert.equal(core.p.dhcp.length, 3);
  // Avec un serveur DHCP : relais vers lui, étendues chez lui.
  const e = withDesign(); e.vlans = vlans();
  e.devices.push({ id: 'srv1', type: 'server', x: 0, y: 0, name: 'SRV1', p: { ...DEVICES.server.props(), ip: { mode: 'static', ip: '10.1.3.10', prefix: 27, gw: '10.1.3.254', dns: '' }, dhcp: [] } });
  applyDesign(e);
  const c2 = e.devices.find(x => x.type === 'l3switch'), srv = e.devices.find(x => x.id === 'srv1');
  assert.ok(c2.p.svis.every(x => x.helper === '10.1.3.10')); assert.equal(srv.p.dhcp.length, 3); assert.ok(!(c2.p.dhcp || []).length);
  assert.equal(applyL3({ devices: [], vlans: vlans() }), null);
});

test('générateur : seulement certaines pièces, puis les autres dans la même baie (obturateurs retirés)', () => {
  const d = withDesign(); const res = applyDesign(d, { rooms: ['f0-b1', 'f0-b2'], vlans: false });
  const more = applyDesign(JSON.parse(JSON.stringify(d)), { rooms: ['f0-b3', 'f0-mt'] });
  assert.equal(more.created.racks, 0, 'pas de nouvelle baie au RDC'); if (DEVICES.blank) assert.ok(more.removed > 0);
  const ports = d.devices.filter(x => /^outlet/.test(x.type)).reduce((a, o) => a + specOf(o).ports(o.p).filter(p => p.punch).length, 0);
  assert.equal(ports, 12); assert.equal(res.created.vlans, 0);
  const T = designTypes(cleanDesign({}));
  assert.equal(T.outlet, DEVICES.outlet2 ? 'outlet2' : 'outlet'); assert.equal(T.panel, DEVICES.patch24 ? 'patch24' : 'patch');
  if (DEVICES.switch48) assert.equal(T.sw48, 'switch48');
});

test('taille réelle : 3 bâtiments × 4 étages, dimensionnement en moins de 50 ms', () => {
  const d = bigFixture(); d.design = cleanDesign({});
  const r = dimension(d), dt = best(() => dimension(d));
  assert.ok(r.totals.outlets > 500, String(r.totals.outlets)); assert.ok(dt < 50 * PERF, `${dt} ms`);
  let t = performance.now(); const res = applyDesign(d); const dg = performance.now() - t;
  assert.ok(res.created.cables > 1000); assert.ok(dg < 1500 * PERF, `générateur ${dg} ms`);
  const r2 = dimension(d), d2 = best(() => dimension(d));
  assert.equal(r2.trs.every(x => !x.cable.est || !x.outlets), true); assert.ok(d2 < 50 * PERF, `après génération ${d2} ms`);
});
