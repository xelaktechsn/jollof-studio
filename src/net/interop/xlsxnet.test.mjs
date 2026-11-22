// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du classeur du projet réseau (src/net/interop/xlsxnet.js) : onglets et en-têtes, formules de la nomenclature,
// aller-retour sans changement, modifications relues par ID (refusées, inconnues, absentes, conflits), application, tarif.
// node --test src/net/interop/xlsxnet.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { cleanDesign, applyDesign } from '../dimension.js';
import { csvTables, bom } from '../docs.js';
import { portCfg } from '../vlan.js';
import { fixture } from '../dimension.fixture.mjs';
import { networkWorkbook, diffWorkbook, applyChanges, priceList, matchPrices, applyPrices, unmatchedPrices, bomLines, readXlsx, WORKBOOK_TAG } from './xlsxnet.js';
import { writeXlsx } from './xlsx.js';

const built = () => { const d = fixture(); d.design = cleanDesign({}); applyDesign(d); return d; };
const sheet = (wb, name) => wb.sheets.find(s => s.name === name);
const rowOf = (sh, id) => sh.rows.find(r => r[0] === id);
const col = (sh, h) => sh.rows[0].indexOf(h);

test('classeur : un onglet par tableau, colonne ID, en-têtes standard ou locaux, propriétés', () => {
  const d = built(), { bytes, sheets } = networkWorkbook(d, null, {});
  assert.deepEqual(sheets, ['Cables', 'Patching', 'Outlets', 'Devices', 'Bill of Materials', 'IP Plan', 'Labels', 'Test Results']);
  const wb = readXlsx(bytes);
  for (const s of wb.sheets) assert.equal(s.rows[0][0], 'ID', s.name);
  assert.equal(sheet(wb, 'Cables').rows.length - 1, d.cables.length, 'une ligne par câble');
  assert.equal(sheet(wb, 'Cables').rows[0][1], 'Cable ID');
  assert.equal(wb.props.custom[WORKBOOK_TAG], '1');
  const loc = networkWorkbook(d, null, { headers: 'local', tables: ['cables', 'bom'] });
  assert.deepEqual(loc.sheets, ['Câbles', 'Nomenclature']);
  assert.equal(readXlsx(loc.bytes).sheets[0].rows[0][1], 'Étiquette');
});

test('nomenclature : total = quantité × prix (formule), somme en bas, valeurs en cache justes', () => {
  const d = built(); d.design.prices = { switch24: 1150.5 };
  const { bytes } = networkWorkbook(d, null, { tables: ['bom'] });
  const xml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
  assert.match(xml, /<f>IF\(H2=&quot;&quot;,&quot;&quot;,F2\*H2\)<\/f>/);
  assert.match(xml, /<f>SUM\(I2:I\d+\)<\/f>/);
  const sh = readXlsx(bytes).sheets[0], tot = sh.rows[sh.rows.length - 1];
  assert.equal(tot[0], 'TOTAL'); assert.equal(tot[8], bom(d).total);
  const sw = rowOf(sh, 'switch24'); assert.ok(sw, 'ligne switch24');
  assert.equal(sw[8], +(sw[5] * 1150.5).toFixed(2));
  // ligne de total en dehors du filtre automatique
  assert.match(xml, new RegExp(`<autoFilter ref="A1:J${sh.rows.length - 1}"/>`));
});

test('aller-retour sans modification : aucun changement', () => {
  const d = built(), wb = readXlsx(networkWorkbook(d, null, {}).bytes), r = diffWorkbook(d, null, wb);
  assert.equal(r.ours, true);
  assert.deepEqual(r.tables, ['cables', 'patching', 'outlets', 'devices', 'bom', 'ipplan']);
  assert.deepEqual([r.changes.length, r.invalid.length, r.unknown.length], [0, 0, 0]);
  assert.deepEqual(r.missing, {});
  // en-têtes locaux : relus aussi
  const loc = readXlsx(networkWorkbook(d, null, { headers: 'local' }).bytes), r2 = diffWorkbook(d, null, loc);
  assert.equal(r2.changes.length, 0); assert.equal(r2.tables.length, 6);
});

test('modifications relues par ID : changements, valeurs refusées, lignes inconnues, objets absents, conflits', () => {
  const d = built(), wb = readXlsx(networkWorkbook(d, null, {}).bytes);
  const C = sheet(wb, 'Cables'), P = sheet(wb, 'Patching'), O = sheet(wb, 'Outlets'), D = sheet(wb, 'Devices'), B = sheet(wb, 'Bill of Materials'), I = sheet(wb, 'IP Plan');
  const c1 = rowOf(C, 'c1'); c1[col(C, 'Category')] = 'Cat 6'; c1[col(C, 'Length (m)')] = 25; c1[col(C, 'Forced Label')] = 'X-01';
  rowOf(C, 'c2')[col(C, 'Length (m)')] = 'beaucoup';
  C.rows.splice(C.rows.indexOf(rowOf(C, 'c3')), 1);
  C.rows.push(['c-inconnu', 'x']);
  D.rows[1][col(D, 'Name')] = 'PB-RENOMME';
  D.rows[2][col(D, 'Name')] = '';
  const bl = B.rows[1]; bl[col(B, 'Unit Price')] = 12.5;
  rowOf(I, '10')[col(I, 'Name')] = 'DONNEES';
  // la prise pr1:back1 et la ligne de brassage du même port de switch : deux VLAN différents → conflit
  const T = csvTables(d, null, { headers: 'standard' }), o = T.outlets.rows.find(r => `${r._dev}:${r._port}` === 'pr1:back1'), pid = `${o._sw}:${o._swp}`;
  rowOf(O, 'pr1:back1')[col(O, 'Data VLAN')] = 30;
  rowOf(P, pid)[col(P, 'VLAN')] = 40;
  const r = diffWorkbook(d, null, wb), ch = r.changes.filter(c => !c.conflict);
  const key = c => `${c.table}:${c.id}:${c.field}=${c.to}`;
  assert.deepEqual(ch.map(key).sort(), [`bom:${bl[0]}:price=12.5`, 'cables:c1:cat=cat6', 'cables:c1:len=25', 'cables:c1:tag=X-01', `devices:${D.rows[1][0]}:name=PB-RENOMME`, 'ipplan:10:name=DONNEES'].sort());
  assert.deepEqual(r.invalid.map(x => `${x.table}:${x.field}`).sort(), ['cables:len', 'devices:name']);
  assert.deepEqual(r.unknown, [{ table: 'cables', id: 'c-inconnu' }]);
  assert.equal(r.missing.cables, 1);
  const conf = r.changes.filter(c => c.conflict);
  assert.deepEqual(conf.map(c => c.to).sort(), [30, 40]);
  assert.equal(new Set(conf.map(c => c.target)).size, 1, 'même cible : le port du switch');
  assert.equal(conf[0].target, `port:${pid}:vlan`);

  // application : changements retenus + un seul côté du conflit
  const keep = [...ch, conf.find(c => c.to === 30)];
  assert.equal(applyChanges(d, null, keep), keep.length);
  const cable = d.cables.find(c => c.id === 'c1');
  assert.equal(cable.cat, 'cat6'); assert.equal(cable.len, 25); assert.equal(cable.tag, 'X-01');
  assert.ok(!cable.route || cable.route.mode !== 'auto', 'longueur imposée : tracé manuel');
  assert.equal(d.devices.find(x => x.id === D.rows[1][0]).name, 'PB-RENOMME');
  assert.equal(d.vlans.find(v => String(v.id) === '10').name, 'DONNEES');
  assert.equal(d.design.prices[bl[0]], 12.5);
  const [swId, ...pp] = pid.split(':'), cfg = portCfg(d.devices.find(x => x.id === swId), pp.join(':'));
  assert.equal(cfg.mode, 'access'); assert.equal(cfg.vlan, 30);
  // nouvel export : plus aucune différence
  assert.equal(diffWorkbook(d, null, readXlsx(networkWorkbook(d, null, {}).bytes)).changes.length, 0);
});

test('classeur d\'un autre outil : pas de marque Jollof, tableaux non reconnus', () => {
  const d = built(), other = readXlsx(writeXlsx({ sheets: [{ name: 'Feuil1', cols: [{ header: 'a' }], rows: [[1]] }] }));
  const r = diffWorkbook(d, null, other);
  assert.equal(r.ours, false); assert.deepEqual(r.tables, []);
});

test('tarif : colonnes devinées, rapprochement par référence puis désignation, application', () => {
  const d = built(), T = csvTables(d, null, { headers: 'standard' });
  const withPart = T.bom.rows.find(r => r.part && !/^labour/.test(r.key)), other = T.bom.rows.find(r => r !== withPart && !/^labour/.test(r.key) && r.name.length >= 6);
  // tarif écrit puis relu comme un fichier fournisseur (titre, ligne vide, en-têtes, prix « 7,5 » en texte)
  const rows = [['Tarif fournisseur 2026'], [], ['Réf.', 'Désignation', 'Prix unitaire HT', 'Devise'],
    [withPart.part.toLowerCase().replace(/-/g, ' '), 'autre libellé', 12.34, 'eur'], [null, other.name, '7,5', 'EUR'], ['ZZZ-0', 'Rien à voir', 1, 'EUR'], ['A', 'B', 'n/a', 'EUR']];
  const cols = ['Tarif fournisseur 2026', '', '', ''].map(header => ({ header }));
  const sh = readXlsx(writeXlsx({ sheets: [{ name: 'Tarif', cols, rows: rows.slice(1), filter: false, freeze: 0 }] })).sheets[0];
  const L = priceList(sh);
  assert.equal(L.header.join('|'), 'Réf.|Désignation|Prix unitaire HT|Devise');
  assert.deepEqual(L.mapping, { part: 0, desc: 1, price: 2, currency: 3 });
  assert.deepEqual(L.items.map(i => i.price), [12.34, 7.5, 1], 'prix illisible ignoré');
  assert.equal(L.items[0].currency, 'EUR');
  const m = matchPrices(d, null, L);
  const a = m.find(x => x.key === withPart.key), b = m.find(x => x.key === other.key);
  assert.equal(a.by, 'part'); assert.equal(a.price, 12.34);
  assert.equal(b.by, 'desc'); assert.equal(b.price, 7.5);
  assert.ok(!m.some(x => /^labour/.test(x.key)), 'main-d\'œuvre jamais tarifée par un fournisseur');
  // colonnes réglées à la main
  assert.equal(priceList(sh, { part: -1 }).mapping.part, -1);
  assert.equal(applyPrices(d, [a, b], 'XOF'), 2);
  assert.equal(d.design.prices[withPart.key], 12.34); assert.equal(d.design.currency, 'XOF');
  assert.ok(bom(d).total > 0);
});

test('nom avec espace final ou plus long que 24 caractères : pas de faux changement', () => {
  const d = built(); d.devices[0].name = 'PR-AP-Salle des '; d.devices[1].name = 'Switch de distribution du bâtiment principal';
  assert.equal(diffWorkbook(d, null, readXlsx(networkWorkbook(d, null, {}).bytes)).changes.length, 0);
});

test('tarif : lignes non retrouvées et leur raison, lignes de nomenclature à associer', () => {
  const d = built(), L = bomLines(d, null), a = L.find(l => l.part), b = L.find(l => l !== a);
  assert.ok(L.length > 3 && !L.some(l => /^labour/.test(l.key)));
  const sheet = { rows: [['Référence', 'Désignation', 'Prix'], [a.part, '', 10], [a.part, 'doublon', 11], ['ZZZ-0', 'Inconnu', 1], ['', 'Rien de pareil ici', 2], ['', b.name, 3]] };
  const list = priceList(sheet), m = matchPrices(d, null, list), miss = unmatchedPrices(d, null, list, m);
  assert.equal(m.length, 2);
  assert.deepEqual(miss.map(x => [x.item.price, x.reason]), [[11, 'dup'], [1, 'part'], [2, 'desc']]);
  // associée à la main, la ligne n'est plus « non retrouvée »
  const hand = { key: L[2].key, item: miss[1].item };
  assert.equal(unmatchedPrices(d, null, list, [...m, hand]).length, 2);
});
