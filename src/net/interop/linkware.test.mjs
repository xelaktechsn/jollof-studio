// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Import de résultats de testeurs réels : node --test src/net/interop/linkware.test.mjs
// Les fichiers de fixtures/ sont ÉCRITS POUR CE TEST d'après les champs que Fluke décrit pour ses rapports : ce ne sont pas
// des exports authentiques (aucun n'a pu être obtenu publiquement). Le lecteur reste à valider avec un export réel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTesterExport, matchResults, fieldOf, verdictOf, numOf, splitRows, KNOWN_FIELDS } from './linkware.js';
import { cleanMeasured, storeMeasured, measuredByLink, measuredStats } from '../measured.js';
import { linkCandidates } from '../measuredmap.js';
import { cleanNet } from '../clean.js';
import { certLinks, testsCsv, reportHtml, measuredHtml } from '../certify.js';
import { issues } from '../checks/cert.js';
import { NET } from '../limits.js';
import { networkWorkbook, readXlsx } from './xlsxnet.js';

const fx = n => readFileSync(new URL('./fixtures/' + n, import.meta.url));
const plan = () => cleanNet({
  devices: [{ id: 'pb', type: 'patch', name: 'PB1' }, { id: 'o1', type: 'outlet', name: 'PR1' }, { id: 'o2', type: 'outlet', name: 'PR2' }, { id: 'o3', type: 'outlet', name: 'PR3' }],
  cables: [{ id: 'h1', a: ['pb', 'b1'], b: ['o1', 'back'], cat: 'cat6', len: 23 }, { id: 'h2', a: ['pb', 'b2'], b: ['o2', 'back'], cat: 'cat6', len: 60 }, { id: 'h3', a: ['pb', 'b3'], b: ['o3', 'back'], cat: 'cat6', len: 93, tag: 'L-0003' }]
});

test('en-têtes reconnus par synonymes, verdicts, nombres', () => {
  assert.equal(fieldOf('Cable ID'), 'cableId'); assert.equal(fieldOf('NEXT Margin (dB)'), 'next'); assert.equal(fieldOf('PS ACR-F Margin'), 'psacrf');
  assert.equal(fieldOf('Prop. Delay (ns)'), 'delay'); assert.equal(fieldOf('Date / Time'), 'at'); assert.equal(fieldOf('Main S/N'), 'serial');
  assert.equal(fieldOf('Longueur (m)'), 'len'); assert.equal(fieldOf('Outlet Colour'), null);
  assert.deepEqual(['PASS', 'pass*', ' Fail ', 'FAIL*', 'Réussite', 'Échec', '?'].map(verdictOf), ['pass', 'pass*', 'fail', 'fail*', 'pass', 'fail', null]);
  assert.deepEqual(['12,4 dB', '-1.8', '87', '', 'n/a'].map(numOf), [12.4, -1.8, 87, null, null]);
  assert.deepEqual(splitRows('a;"b;c";"d ""e"""\r\n1;2;3', ';'), [['a', 'b;c', 'd "e"'], ['1', '2', '3']]);
  for (const f of NET.TESTER_FIELDS.v) assert.ok(KNOWN_FIELDS.includes(f), f);
});
test('CSV : préambule ignoré, point-virgule et virgule décimale, colonnes inconnues signalées, lignes sans identifiant écartées', () => {
  const { results, report } = parseTesterExport(new Uint8Array(fx('tester-summary.csv')), 'export.csv');
  assert.equal(report.error, undefined); assert.equal(report.format, 'csv'); assert.equal(report.sep, ';');
  assert.deepEqual(report.unknown, ['Remote S/N', 'Outlet Colour'].filter(h => fieldOf(h) === null)); assert.ok(report.unknown.includes('Outlet Colour'));
  assert.equal(report.rows, 5); assert.equal(report.skipped, 1); assert.equal(results.length, 4);
  const [a, b, c, d] = results;
  assert.deepEqual([a.cableId, a.verdict, a.len, a.margin, a.param, a.delay, a.skew, a.res, a.nvp], ['PR1', 'pass', 23.4, 5.2, 'rl', 118, 7, 4.1, 69]);
  assert.equal(a.limit, 'TIA Cat 6 Perm. Link'); assert.equal(a.tester, 'DSX-5000'); assert.equal(a.serial, '1234567'); assert.equal(a.operator, 'A. Diop'); assert.equal(a.at, '2026-11-18T09:12:44');
  assert.deepEqual(a.margins, { il: 25.3, next: 6.1, psnext: 7.4, acrf: 14.2, psacrf: 15, rl: 5.2 });
  assert.deepEqual([b.verdict, b.margin, b.param], ['pass*', 0.3, 'next']);
  assert.deepEqual([c.cableId, c.verdict, c.margin], ['PR3, salle 12', 'fail', -1.8]);
  assert.equal(d.verdict, 'fail*');
});
test('CSV à virgules et tabulations, en-têtes en désordre, pieds en longueur', () => {
  const csv = 'Result,Cable ID,Length (ft),NEXT Margin,Mystery\r\nPASS,A-01,100,4.5,zz\r\nFAIL,A-02,328 ft,-2,zz\r\n';
  const r = parseTesterExport(csv, 'x.csv');
  assert.equal(r.report.sep, ','); assert.deepEqual(r.report.unknown, ['Mystery']);
  assert.deepEqual(r.results.map(x => [x.cableId, x.verdict, x.len, x.margin]), [['A-01', 'pass', 30.5, 4.5], ['A-02', 'fail', 100, -2]]);
  const t = parseTesterExport('Cable ID\tSummary\tLength\nB1\tPASS\t12.5 m\n', 'x.txt');
  assert.equal(t.report.sep, 'tab'); assert.equal(t.results[0].len, 12.5);
  const u16 = new Uint8Array([0xff, 0xfe, ...[...'Cable ID,Summary\nZ9,PASS\n'].flatMap(ch => [ch.charCodeAt(0), 0])]);
  assert.equal(parseTesterExport(u16, 'u.csv').results[0].cableId, 'Z9');
});
test('XML : enfants ou attributs, éléments imbriqués, pieds', () => {
  const { results, report } = parseTesterExport(new Uint8Array(fx('tester-results.xml')), 'export.xml');
  assert.equal(report.format, 'xml'); assert.equal(results.length, 2); assert.ok(report.unknown.includes('Extra'));
  assert.deepEqual([results[0].cableId, results[0].verdict, results[0].len, results[0].margin, results[0].param, results[0].tester], ['PR1', 'pass', 23.4, 5.2, 'rl', 'DSX-8000']);
  assert.deepEqual([results[1].cableId, results[1].verdict, results[1].margin], ['PR2', 'fail*', -0.3]);
});
test('erreurs dites clairement : format natif, sans en-tête, sans résultat, vide', () => {
  assert.equal(parseTesterExport(new Uint8Array([70, 76, 87, 0, 0, 1, 2, 0]), 'projet.flw').report.error, 'flw');
  assert.equal(parseTesterExport(new Uint8Array([1, 0, 0, 0, 5, 0]), 'x.csv').report.error, 'flw');
  assert.equal(parseTesterExport('a,b,c\n1,2,3\n', 'x.csv').report.error, 'header');
  assert.equal(parseTesterExport('Cable ID,Length\nA,3\n', 'x.csv').report.error, 'verdict');
  assert.equal(parseTesterExport('  ', 'x.csv').report.error, 'empty');
  assert.equal(parseTesterExport('<a><b></a>', 'x.xml').report.error, 'xml');
});
test('rattachement aux liens : par nom de prise, étiquette imposée, à la main ; ambigu et inconnu laissés', () => {
  const data = plan(), cands = linkCandidates(data), { results } = parseTesterExport(new Uint8Array(fx('tester-summary.csv')), 'e.csv');
  assert.equal(cands.length, certLinks(data).length);
  const m = matchResults(results, cands);
  const link = id => m.results.find(r => r.cableId === id).link;
  assert.equal(link('PR1'), 'pl:h1'); assert.equal(link('PR2'), 'pl:h2'); assert.equal(link('PR3, salle 12'), ''); assert.equal(link('INCONNU-7'), '');
  assert.deepEqual(m.unmatched, ['PR3, salle 12', 'INCONNU-7']);
  const m2 = matchResults(results, cands, { 'PR3, salle 12': 'pl:h3', 'INCONNU-7': 'pl:nope' });
  assert.equal(m2.results.find(r => r.cableId === 'PR3, salle 12').link, 'pl:h3'); assert.deepEqual(m2.unmatched, ['INCONNU-7']);
  assert.equal(matchResults([{ cableId: 'l 0003', verdict: 'pass' }], cands).results[0].link, 'pl:h3', 'étiquette imposée, espaces et tirets ignorés');
  const amb = matchResults([{ cableId: 'X', verdict: 'pass' }], [{ link: 'a', names: ['X'] }, { link: 'b', names: ['x'] }]);
  assert.deepEqual(amb.ambiguous, ['X']); assert.equal(amb.results[0].link, '');
});
test('rangement à part des résultats simulés, conservé par le fichier', () => {
  const data = plan(), cands = linkCandidates(data), { results } = parseTesterExport(new Uint8Array(fx('tester-summary.csv')), 'e.csv');
  storeMeasured(data, matchResults(results, cands, { 'PR3, salle 12': 'pl:h3' }).results, { file: 'e.csv', at: '2026-11-20T10:00:00Z' });
  assert.equal(data.tests, null, 'les résultats simulés ne sont pas touchés');
  assert.deepEqual(measuredStats(data), { pass: 1, 'pass*': 1, 'fail*': 1, fail: 1, total: 4, linked: 3 });
  const again = cleanNet(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(again.measured, data.measured);
  assert.equal(measuredByLink(again).get('pl:h3').verdict, 'fail');
  assert.equal(cleanMeasured({ results: [{ cableId: 'a', verdict: 'maybe' }, { verdict: 'pass' }] }), null);
  storeMeasured(data, [{ cableId: 'PR1', verdict: 'fail', link: 'pl:h1' }]);
  assert.equal(data.measured.results.length, 4, 'même identifiant : remplacé'); assert.equal(measuredByLink(data).get('pl:h1').verdict, 'fail');
});
test('vérificateur : J1301 échec mesuré, J1302 marginal mesuré, J1303 longueur loin du plan ; rien en mode examen', () => {
  const data = plan(), cands = linkCandidates(data), { results } = parseTesterExport(new Uint8Array(fx('tester-summary.csv')), 'e.csv');
  storeMeasured(data, matchResults(results, cands, { 'PR3, salle 12': 'pl:h3' }).results);
  const iss = issues(data, null, null), of = c => iss.filter(i => i.code === c);
  assert.deepEqual(of('J1301').map(i => i.id), ['h3']); assert.match(of('J1301')[0].text, /FAIL/);
  assert.deepEqual(of('J1302').map(i => i.id), ['h2']);
  assert.deepEqual(of('J1303').map(i => i.id), ['h2'], '88,9 m mesurés pour 60 m ; 23,4 pour 23 et 93,5 pour 93 restent dans la tolérance');
  assert.equal(issues({ ...data, exam: true }, null, null).some(i => /^J130/.test(i.code)), false);
});
test('partout nommés « mesuré » : CSV, rapport, classeur', () => {
  const data = plan(), cands = linkCandidates(data), { results } = parseTesterExport(new Uint8Array(fx('tester-summary.csv')), 'e.csv');
  storeMeasured(data, matchResults(results, cands).results, { file: 'e.csv' });
  const M = measuredByLink(data);
  const csv = testsCsv([{ link: 'pl:h1', kind: 'pl', label: 'L1', limit: 'cat6-pl', verdict: 'pass', margin: 3, param: 'next', len: 23, at: '', meas: M.get('pl:h1') }]);
  assert.match(csv.split('\r\n')[0], /Résultat simulé.*Résultat mesuré.*Testeur/); assert.match(csv.split('\r\n')[1], /PASS,3,.*,PASS,5\.2,23\.4,TIA Cat 6 Perm\. Link,DSX-5000 1234567/);
  const html = measuredHtml(data.measured.results.map(r => ({ ...r, label: '' })), data.measured);
  assert.match(html, /Résultats mesurés \(testeur réel\)/); assert.match(html, /INCONNU-7/); assert.match(html, /non rattaché/);
  assert.match(reportHtml({ rows: [], details: [], measured: data.measured.results }), /Résultats mesurés/);
  assert.doesNotMatch(reportHtml({ rows: [], details: [] }), /Résultats mesurés/);
  const wb = readXlsx(networkWorkbook(data, null, { tables: ['tests'] }).bytes), sh = Object.values(wb.sheets || wb)[0];
  const flat = JSON.stringify(sh);
  assert.match(flat, /measured/); assert.match(flat, /DSX-5000/);
});
