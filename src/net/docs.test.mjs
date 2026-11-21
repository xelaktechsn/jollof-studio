// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests des documents du projet réseau (src/net/docs.js) : étiquettes, tableaux, nomenclature, exports.
// node --test src/net/docs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDesign, applyDesign, horizontalLinks } from './dimension.js';
import { csvTables, csvOptions, makerOf, labelOf, cableLabel, labelTable, labelIssues, cableSchedule, patchRows, bom, toCsv, floorSvg, rackSvg, reportHtml, fill, labeler, money } from './docs.js';
import { issues, LAB, CODES } from './checks/design.js';
import { fixture, bigFixture } from './dimension.fixture.mjs';
// Temps : temps CPU du processus (src/net/perf.mjs), seuils tenus même dans la suite complète.
import { best, note } from './perf.mjs';

const built = (o = {}) => { const d = fixture(); d.design = cleanDesign(o); applyDesign(d); return d; };

test('jetons des formats', () => {
  assert.equal(fill('{fs}-{p}{n}', { fs: '1A', p: 'B', n: '04' }), '1A-B04');
  assert.equal(fill('{b}-{x}', { b: 'B1' }), 'B1-');
});

test('étiquettes TIA-606 : local fs, lien horizontal fs-an, uniques', () => {
  const d = built(), rows = labelTable(d);
  const outs = rows.filter(r => r.kind === 'outlet');
  assert.equal(outs.length, 106);
  for (const r of outs) assert.match(r.label, /^\d+[A-Z]+-[A-Z]+\d{2}$/, r.label);
  assert.deepEqual(rows.filter(r => r.kind === 'space').map(r => r.label), ['0A', '1A']);
  assert.deepEqual(rows.filter(r => r.kind === 'rack').map(r => r.label), ['0A.R01', '1A.R01']);
  assert.equal(labelIssues(d).dups.length, 0); assert.equal(labelIssues(d).empty.length, 0);
  // l'étiquette d'une prise est celle du port du panneau où arrive son câble ; le câble porte la même
  const l = horizontalLinks(d)[0], c = d.cables.find(x => x.id === l.cable);
  assert.equal(labelOf(d, l.outlet, l.oport), labelOf(d, l.panel, l.pport));
  assert.equal(cableLabel(d, c), labelOf(d, l.outlet, l.oport));
  assert.equal(labelOf(d, l.outlet, l.oport.replace('back', 'front')), labelOf(d, l.outlet, l.oport), 'devant ou derrière : même lien');
  // cordon : extrémité\extrémité
  const cord = d.cables.find(x => x.a[0] === l.panel && /^f/.test(x.a[1]));
  assert.ok(cableLabel(d, cord).includes('\\'));
});

test('étiquettes : préréglages, étiquette imposée, doublons, cache', () => {
  const d = built({ labels: { preset: 'rack' } }), l = horizontalLinks(d)[0];
  assert.match(labelOf(d, l.outlet, l.oport), /^0A\.R01-\d{2}:\d{2}$/);
  const c = built({ labels: { preset: 'campus' } }); assert.match(labelTable(c).find(r => r.kind === 'outlet').label, /^B1-0A-A01$/);
  const o = d.devices.find(x => x.id === l.outlet); o.tag = 'SALLE-1';
  assert.equal(labelOf(d, o.id), 'SALLE-1', 'étiquette imposée');
  const p = d.devices.find(x => /^patch/.test(x.type)), q = d.devices.filter(x => /^patch/.test(x.type))[1]; p.tag = 'PP'; q.tag = 'pp';
  const dups = labelIssues(d).dups; assert.ok(dups.some(g => g.label === 'PP' && g.items.length >= 2), 'doublon insensible à la casse');
  // le cache suit les modifications du modèle
  const l2 = horizontalLinks(d).find(x => x.outlet !== o.id), before = labelOf(d, l2.outlet, l2.oport); const cab = d.cables.find(x => x.id === l2.cable); d.cables.splice(d.cables.indexOf(cab), 1);
  assert.notEqual(labelOf(d, l2.outlet, l2.oport), before); assert.equal(labelOf(d, l2.outlet, l2.oport), ''); assert.equal(labeler(d), labeler(d));
});

test('tableaux : câbles et brassage', () => {
  const d = built(), cs = cableSchedule(d);
  assert.equal(cs.length, d.cables.length);
  assert.equal(cs.filter(r => r.kind === 'horizontal').length, 106);
  assert.ok(cs.filter(r => r.kind === 'cord').length >= 100);
  const h = cs.find(r => r.kind === 'horizontal'); assert.equal(h.mode, 'auto'); assert.ok(h.len > 0); assert.equal(h.type, 'Cat 6A');
  const pr = patchRows(d); assert.ok(pr.length >= 100); assert.ok(pr[0].panel && pr[0].port && pr[0].device && pr[0].outlet);
});

test('nomenclature : quantités du modèle, tourets, prix, main-d’œuvre, total', () => {
  const d = built({ prices: { jack: 4, cord: 3 }, labour: [{ name: 'Pose et raccordement', qty: 106, unit: 'u', price: 15 }], currency: 'EUR' });
  const b = bom(d), line = k => b.lines.find(l => l.key === k);
  assert.equal(line('jack').qty, 106); assert.equal(line('jack').total, 424);
  assert.ok(line('box_cat6a').qty >= 1); assert.match(line('box_cat6a').note, /106/);
  assert.equal(line('cord').total, line('cord').qty * 3);
  assert.equal(line('rack').qty, 2);
  assert.equal(b.groups.labour, 1590);
  assert.equal(b.total, +b.lines.reduce((a, l) => a + l.total, 0).toFixed(2));
  assert.ok(b.unpriced.includes('rack')); assert.equal(b.complete, false);
  const html = reportHtml(d, {}); assert.ok(html.includes('à renseigner') || html.includes('to be filled in'), 'prix à renseigner dans le rapport');
  assert.equal(bom(built()).lines.every(l => !l.price), true, 'aucun prix par défaut');
  assert.match(money(1234.5, 'EUR', true), /1,234\.50/); assert.match(money(1000, 'XOF', false), /1\s?000/);
});

test('exports : CSV, SVG, rapport', () => {
  const csv = toCsv([{ key: 'a', name: 'A' }, { key: 'b', name: 'B;b' }], [{ a: 'x"y', b: ['p', 'q'] }, { a: ' z', b: 1 }]);
  assert.equal(csv, '﻿A;"B;b"\r\n"x""y";p > q\r\n" z";1\r\n');
  const d = built(), svg = floorSvg(d, 'f0');
  assert.match(svg, /^<svg[^>]+viewBox/); assert.ok(svg.includes('0A-A01')); assert.ok(svg.includes('Bureau 1'));
  assert.equal(floorSvg(d, 'nope'), '');
  const rk = rackSvg(d, 'rk1'); assert.ok(rk.includes('0A.R01')); assert.ok(rk.includes('0A-A'));
  const html = reportHtml(d, { issues: [{ code: 'J1294', kind: 'warn', text: 'x' }] });
  assert.match(html, /^<!doctype html>/); for (const s of ['0A-A01', 'J1294', '<svg', 'ntRp']) assert.ok(html.includes(s), s);
  assert.ok(!reportHtml(d, { body: true }).startsWith('<!doctype'));
  assert.ok(!html.includes('<script'), 'aucun script dans le rapport');
});

test('vérifications J1290–J1295 : rien sur un projet bien dimensionné, et chaque défaut repéré', () => {
  const d = built(), h = { name: id => (d.devices.find(x => x.id === id) || {}).name || id };
  const ok = issues(d, null, h);
  assert.deepEqual(ok.map(i => i.code), [], JSON.stringify(ok.slice(0, 3)));
  assert.deepEqual(issues(fixture(), null, h).filter(i => i.code === 'J1294'), [], 'sans prise rien à dire');
  assert.deepEqual(issues({ ...fixture(), racks: [] }, null, h), [], 'pas de baie : pas de vérification');
  // prise sans lien, pièce sous-équipée, doublon, réserve trop faible
  const l = horizontalLinks(d)[0]; d.cables = d.cables.filter(c => c.id !== l.cable);
  const gone = horizontalLinks(d).find(x => x.outlet !== l.outlet); d.devices = d.devices.filter(x => x.id !== gone.outlet); d.cables = d.cables.filter(c => c.a[0] !== gone.outlet && c.b[0] !== gone.outlet);
  const p = d.devices.filter(x => /^patch/.test(x.type)); p[0].tag = 'X'; p[1].tag = 'X';
  d.design.spare = 200;
  const codes = new Set(issues(d, null, h).map(i => i.code));
  for (const c of ['J1290', 'J1293', 'J1294', 'J1295']) assert.ok(codes.has(c), c);
  for (const c of codes) assert.ok(CODES[c], c);
  // surréservation : cible très basse
  const e = built({ oversub: 1 }); assert.ok(issues(e, null, h).some(i => i.code === 'J1291') || !e.devices.some(x => x.type === 'l3switch'));
  // marge PoE (simulation simplifiée : un switch au budget presque plein)
  const lan = { state: () => ({ poe: new Map([['sw1', { budget: 100, used: 90, ports: [] }], ['sw2', { budget: 100, used: 120, ports: [{ denied: 'budget' }] }]]) }) };
  const poe = issues(d, lan, h).filter(i => i.code === 'J1292'); assert.equal(poe.length, 1); assert.equal(poe[0].id, 'sw1');
});

test('contrôles de TP : net-dim, net-labels, net-bom, net-subnet', () => {
  const env = d => ({ netData: () => d, lan: () => null });
  const start = fixture(); start.design = cleanDesign({});
  assert.equal(LAB['net-dim'].check({ type: 'net-dim' }, env(start)).ok, false);
  const d = built();
  assert.equal(LAB['net-dim'].check({ type: 'net-dim', spare: 20, area: 10 }, env(d)).ok, true);
  assert.equal(LAB['net-dim'].check({ type: 'net-dim', spare: 30 }, env(d)).why, 'spare-set');
  assert.equal(LAB['net-labels'].check({ match: '^\\d+[A-Z]-[A-Z]+\\d{2}$' }, env(d)).ok, true);
  assert.equal(LAB['net-labels'].check({ match: '^X' }, env(d)).why, 'format');
  assert.equal(LAB['net-labels'].check({}, env(start)).why, 'none');
  assert.equal(LAB['net-bom'].check({}, env(d)).why, 'price');
  const priced = built(); priced.design.prices = Object.fromEntries(bom(priced).lines.map(l => [l.key, 10]));
  assert.equal(LAB['net-bom'].check({}, env(priced)).ok, true, JSON.stringify(LAB['net-bom'].check({}, env(priced))));
  const v = { ...fixture(), vlans: [{ id: 10, name: 'DATA', net: '10.1.0.0/24', gw: '10.1.0.1', hosts: 200 }, { id: 20, name: 'VOICE', net: '10.1.1.0/25', gw: '10.1.1.1', hosts: 100 }] };
  assert.equal(LAB['net-subnet'].check({ block: '10.1.0.0/16' }, env(v)).ok, true);
  v.vlans[1].net = '10.1.0.128/25'; v.vlans[1].gw = '10.1.0.129';
  assert.equal(LAB['net-subnet'].check({}, env(v)).why, 'overlap');
  v.vlans[1] = { id: 20, net: '10.1.1.0/27', gw: '10.1.1.1', hosts: 100 }; assert.equal(LAB['net-subnet'].check({}, env(v)).why, 'small');
  assert.equal(LAB['net-subnet'].check({ vlans: [30] }, env(v)).why, 'vlans');
  for (const k of Object.keys(LAB)) assert.equal(typeof LAB[k].text({}, { why: 'zzz' }), 'string');
});

test('taille réelle : étiquettes, vérifications et nomenclature d’un campus de 600 prises en moins de 50 ms', () => {
  const d = bigFixture(); d.design = cleanDesign({}); applyDesign(d);
  const rows = labelTable(d), dl = best(() => labeler(d, { fresh: true }) && labelTable(d));
  assert.ok(rows.filter(r => r.kind === 'outlet').length > 500); assert.ok(dl < 100, note('étiquettes', dl, 100));
  const dc = best(() => { for (const o of d.devices) labelOf(d, o.id); }); assert.ok(dc < 50, note('étiquettes en cache', dc, 50));
  const di = best(() => issues(d, null, { name: x => x })); assert.ok(di < 100, note('vérifications (conception)', di, 100));
  const db = best(() => { bom(d); cableSchedule(d); }); assert.ok(db < 100, note('nomenclature', db, 100));
  assert.equal(labelIssues(d).dups.length, 0, 'auto : campus (bâtiment devant chaque identifiant)');
  d.design.labels.preset = 'tia'; assert.ok(labelIssues(d).dups.length > 0, 'TIA-606 d’un seul bâtiment sur un campus : doublons');
});

test('échanges CSV : en-têtes standard des outils courants, séparateur, virgule décimale, BOM, RFC 4180', () => {
  const d = built({ prices: { switch24: 1150.5 } }), T = csvTables(d, null, { headers: 'standard' });
  assert.deepEqual(T.cables.cols.slice(0, 8).map(c => c.name), ['Cable ID', 'From Device', 'From Port', 'To Device', 'To Port', 'Type', 'Category', 'Length (m)']);
  assert.deepEqual(T.bom.cols.slice(0, 8).map(c => c.name), ['Item', 'Description', 'Manufacturer', 'Part Number', 'Quantity', 'Unit', 'Unit Price', 'Total']);
  assert.deepEqual(T.outlets.cols.slice(0, 3).map(c => c.name), ['Outlet ID', 'Faceplate', 'Port']);
  assert.deepEqual(T.ipplan.cols.slice(0, 6).map(c => c.name), ['VLAN ID', 'Name', 'Network', 'Prefix', 'Subnet Mask', 'Gateway']);
  assert.equal(T.cables.rows.length, d.cables.length); assert.equal(T.outlets.rows.length, 106);
  const sw = T.bom.rows.find(r => r.key === 'switch24' || r.key === 'switch48'); assert.ok(sw && sw.maker === 'Cisco' && /C1000/.test(sw.part), JSON.stringify(sw));
  assert.deepEqual(makerOf('cablemgr'), { maker: 'Tripp Lite', part: 'SRCABLERING1U' });
  const o = T.outlets.rows[0]; assert.match(o.id, /^0A-A0\d$/); assert.equal(o.vlan, 10); assert.ok(o.sw && o.swport);
  // séparateur ; et virgule décimale (tableur en français) ; virgule et point (outils, anglais) ; BOM UTF-8
  d.design.exports.csvSep = 'auto';
  const fr = csvOptions(d, false), en = csvOptions(d, true);
  assert.deepEqual([fr.sep, fr.decimal, en.sep, en.decimal], [';', ',', ',', '.']);
  const a = toCsv(T.cables.cols, T.cables.rows.slice(0, 1), fr), b = toCsv(T.cables.cols, T.cables.rows.slice(0, 1), en);
  assert.ok(a.startsWith('\ufeffCable ID;From Device;') && b.startsWith('\ufeffCable ID,From Device,'));
  assert.match(a.split('\r\n')[1], /;\d+,\d;|;\d+;/, 'longueur avec virgule décimale');
  assert.match(b.split('\r\n')[1], /,\d+(\.\d)?,/);
  assert.equal(toCsv([{ key: 'a', name: 'A' }], [{ a: 'x;y' }], { sep: ';' }), '\ufeffA\r\n"x;y"\r\n');
  assert.equal(toCsv([{ key: 'a', name: 'A' }], [{ a: 'x;y' }], { sep: ',' }), '\ufeffA\r\nx;y\r\n', 'pas de guillemets inutiles');
  const L = csvTables(d, null, { headers: 'local' }); assert.equal(L.cables.cols[0].name === 'Cable ID', false);
});
