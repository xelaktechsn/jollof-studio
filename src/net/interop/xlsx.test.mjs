// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du classeur .xlsx (src/net/interop/xlsx.js) : aller-retour, types de cellules, dates du système 1900, structure
// du paquet (zip + XML bien formé, vérifié strictement ici sans dépendance). openpyxl, s'il est installé dans un
// environnement d'essai (JOLLOF_OPENPYXL=chemin de python), relit aussi le classeur ; sinon ce test est sauté.
// node --test src/net/interop/xlsx.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { writeXlsx, readXlsx, colName, colIndex, dateSerial, serialDate, sheetName, xmlEsc } from './xlsx.js';

/** Contrôle strict d'un document XML 1.0 : prologue, une racine, balises équilibrées, attributs entre guillemets et
 *  uniques, entités connues, pas de « < » ni de « & » nus, caractères autorisés. Rend '' ou la première faute. */
export function xmlFault(s) {
  if (!s.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')) return 'prologue';
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/.test(s)) return 'caractère interdit';
  let i = s.indexOf('?>') + 2, roots = 0;
  const stack = [], NAME = /^[A-Za-z_][\w.:-]*/;
  const text = t => { if (/<|&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(t)) return 'texte : ' + t.slice(0, 30); return ''; };
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const t = s.slice(i, lt < 0 ? s.length : lt);
    if (!stack.length && t.trim()) return 'texte hors racine';
    const f = text(t); if (f) return f;
    if (lt < 0) break;
    if (s.startsWith('</', lt)) {
      const m = NAME.exec(s.slice(lt + 2)); if (!m) return 'fin sans nom';
      const close = s.indexOf('>', lt); if (s.slice(lt + 2 + m[0].length, close).trim()) return 'fin mal formée';
      if (stack.pop() !== m[0]) return 'balise croisée ' + m[0];
      i = close + 1; continue;
    }
    const m = NAME.exec(s.slice(lt + 1)); if (!m) return 'balise sans nom @' + lt;
    let j = lt + 1 + m[0].length; const seen = new Set();
    for (;;) {
      const r = /^\s*(\/?>)|^\s+([A-Za-z_][\w.:-]*)\s*=\s*"([^"<]*)"/.exec(s.slice(j));
      if (!r) return 'attribut mal formé dans ' + m[0];
      j += r[0].length;
      if (r[1]) { if (r[1] === '>') stack.push(m[0]); else if (!stack.length) roots++; if (r[1] === '>' && stack.length === 1) roots++; break; }
      if (seen.has(r[2])) return 'attribut en double ' + r[2]; seen.add(r[2]);
      const f2 = text(r[3]); if (f2) return 'valeur : ' + f2;
    }
    i = j;
  }
  if (stack.length) return 'non fermé ' + stack.join('>');
  return roots === 1 ? '' : 'racines : ' + roots;
}

const sample = () => writeXlsx({
  currency: 'EUR',
  props: { title: 'Essai <&>', creator: 'Test', company: 'École', created: new Date(Date.UTC(2026, 10, 21)), custom: { 'Jollof.Network': '1' } },
  sheets: [
    { name: 'Câbles', cols: [{ header: 'ID' }, { header: 'Nom', width: 30 }, { header: 'Longueur', fmt: 'dec1' }, { header: 'Prix', fmt: 'money' }, { header: 'Taux', fmt: 'percent' }, { header: 'Date', fmt: 'date' }, { header: 'OK' }, { header: 'Cat', list: ['cat6', 'cat6a'] }, { header: 'Total', fmt: 'money' }],
      rows: [
        ['c1', 'A & B <x> "q" ’', 12.5, 3.25, 0.2, new Date(Date.UTC(2026, 0, 15)), true, 'cat6', { f: 'C2*D2', v: 40.625 }],
        ['c2', 'Nom\u0001 avec caractère interdit', 7, null, 0, null, false, 'cat6a', { f: 'C3*D3' }],
        ['TOTAL', null, null, null, null, null, null, null, { f: 'SUM(I2:I3)', v: 40.625 }]
      ], totalRows: 1 },
    { name: 'a/b:c*?[x]' + 'z'.repeat(40), cols: [{ header: 'n' }], rows: [[1], [2]], hidden: true },
    { name: 'Vide', cols: [{ header: 'x' }], rows: [] }
  ]
});

test('références de colonnes et noms d\'onglets', () => {
  assert.deepEqual([0, 25, 26, 51, 52, 701, 702].map(colName), ['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
  for (const i of [0, 7, 25, 26, 300, 16383]) assert.equal(colIndex(colName(i)), i);
  assert.equal(sheetName('a/b:c'), 'a b c'); assert.equal(sheetName('x'.repeat(50)).length, 31); assert.equal(sheetName(''), 'Sheet');
  assert.equal(xmlEsc('a<b>&"c"\u0002'), 'a&lt;b&gt;&amp;&quot;c&quot;');
});

test('dates du système 1900 (ECMA-376 § 18.17.4.1)', () => {
  assert.equal(dateSerial(new Date(Date.UTC(1899, 11, 30))), 0);
  assert.equal(dateSerial(new Date(Date.UTC(1900, 2, 1))), 61, '1er mars 1900 = 61 (jour fictif du 29 février 1900 compris)');
  assert.equal(dateSerial(new Date(Date.UTC(2026, 0, 15, 12))), 46037.5);
  assert.equal(serialDate(46037.5).toISOString(), '2026-01-15T12:00:00.000Z');
});

test('paquet : parties attendues, zip et XML bien formés', () => {
  const files = unzipSync(sample()), names = Object.keys(files).sort();
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml'])
    assert.ok(names.includes(p), p);
  for (const n of names) { const s = strFromU8(files[n]); assert.equal(xmlFault(s), '', n); }
  const ct = strFromU8(files['[Content_Types].xml']), rels = strFromU8(files['xl/_rels/workbook.xml.rels']);
  for (const n of names.filter(n => n.startsWith('xl/worksheets/'))) { assert.ok(ct.includes(`PartName="/${n}"`), n); assert.ok(rels.includes(n.slice(3)), n); }
  const s1 = strFromU8(files['xl/worksheets/sheet1.xml']), wb = strFromU8(files['xl/workbook.xml']);
  assert.match(s1, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(s1, /<autoFilter ref="A1:I3"\/>/, 'la ligne de total reste hors du filtre');
  assert.match(s1, /<dataValidation type="list"[^>]*sqref="H2:H3"><formula1>&quot;cat6,cat6a&quot;<\/formula1>/);
  assert.match(s1, /<f>SUM\(I2:I3\)<\/f><v>40.625<\/v>/);
  assert.match(s1, /<col min="2" max="2" width="30"/);
  assert.match(wb, /<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Câbles'!\$A\$1:\$I\$3<\/definedName>/);
  assert.match(wb, /state="hidden"/);
  assert.match(strFromU8(files['xl/styles.xml']), /numFmtId="165" formatCode="#,##0.00\\ &quot;€&quot;"/);
  // un caractère de contrôle est retiré, pas écrit
  assert.ok(!strFromU8(files['xl/sharedStrings.xml']).includes('\u0001'));
});

test('aller-retour : textes, nombres, booléens, dates, formules (valeur en cache), propriétés', () => {
  const wb = readXlsx(sample());
  assert.deepEqual(wb.sheets.map(s => s.name), ['Câbles', sheetName('a/b:c*?[x]' + 'z'.repeat(40)), 'Vide']);
  assert.equal(wb.sheets[1].name, 'a b c   x ' + 'z'.repeat(21));
  assert.equal(wb.sheets[1].hidden, true);
  const r = wb.sheets[0].rows;
  assert.deepEqual(r[0], ['ID', 'Nom', 'Longueur', 'Prix', 'Taux', 'Date', 'OK', 'Cat', 'Total']);
  assert.equal(r[1][1], 'A & B <x> "q" ’'); assert.equal(r[1][2], 12.5); assert.equal(r[1][3], 3.25); assert.equal(r[1][4], 0.2);
  assert.ok(r[1][5] instanceof Date); assert.equal(r[1][5].toISOString().slice(0, 10), '2026-01-15');
  assert.equal(r[1][6], true); assert.equal(r[2][6], false);
  assert.equal(r[1][8], 40.625, 'valeur en cache de la formule'); assert.equal(r[2][8], null, 'formule sans cache');
  assert.equal(r[2][1], 'Nom avec caractère interdit'); assert.equal(r[2][3], null);
  assert.equal(r[3][0], 'TOTAL');
  assert.deepEqual(wb.sheets[2].rows, [['x']]);
  assert.equal(wb.props.title, 'Essai <&>'); assert.equal(wb.props.creator, 'Test'); assert.equal(wb.props.custom['Jollof.Network'], '1');
});

test('lecture d\'un classeur d\'un autre outil : chaînes en ligne, str, erreurs, d, date1904, styles de date', () => {
  const X = s => strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s);
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files = {
    '[Content_Types].xml': X('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    '_rels/.rels': X('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': X(`<workbook ${NS}><workbookPr date1904="1"/><sheets><sheet name="Tarif" sheetId="1" r:id="rId7"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': X('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/feuille.xml"/></Relationships>'),
    'xl/styles.xml': X(`<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="170" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="170"/><xf numFmtId="14"/></cellXfs></styleSheet>`),
    'xl/worksheets/feuille.xml': X(`<worksheet ${NS}><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><r><t>Réf</t></r><r><t xml:space="preserve">érence </t></r></is></c><c r="C1" t="str"><f>"P"&amp;"rix"</f><v>Prix</v></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>X&amp;1</t></is></c><c r="B3" t="e"><v>#N/A</v></c><c r="C3"><v>1.5E1</v></c><c r="D3" s="1"><v>0</v></c><c r="E3" s="2"><v>1</v></c><c r="F3" t="d"><v>2026-03-04T00:00:00Z</v></c></row>
    </sheetData></worksheet>`)
  };
  const wb = readXlsx(zipSync(files));
  assert.equal(wb.sheets[0].name, 'Tarif');
  const r = wb.sheets[0].rows;
  assert.deepEqual(r[0], ['Référence ', null, 'Prix']);
  assert.deepEqual(r[1], [], 'ligne 2 absente du fichier : vide');
  assert.equal(r[2][0], 'X&1'); assert.equal(r[2][1], '#N/A'); assert.equal(r[2][2], 15);
  assert.equal(r[2][3].toISOString().slice(0, 10), '1904-01-01', 'système 1904 : 0 = 1er janvier 1904');
  assert.equal(r[2][4].toISOString().slice(0, 10), '1904-01-02');
  assert.equal(r[2][5].toISOString().slice(0, 10), '2026-03-04');
});

test('fichier qui n\'est pas un classeur : erreur claire', () => {
  assert.throws(() => readXlsx(new Uint8Array([1, 2, 3])));
  assert.throws(() => readXlsx(zipSync({ 'a.txt': strToU8('x') })), /workbook/i);
});

// Relecture par openpyxl (outil d'essai, hors dépôt) : JOLLOF_OPENPYXL=/chemin/vers/python avec openpyxl installé.
const PY = process.env.JOLLOF_OPENPYXL;
test('relecture par openpyxl (outil d\'essai facultatif)', { skip: !(PY && existsSync(PY)) && 'JOLLOF_OPENPYXL absent' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'xl-')), f = join(dir, 't.xlsx');
  try {
    writeFileSync(f, sample());
    const out = execFileSync(PY, ['-I', '-c', `
import sys, warnings, openpyxl
warnings.simplefilter('error')
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb['Câbles']
print(wb.sheetnames, ws.freeze_panes, ws.auto_filter.ref, ws['I4'].value, ws['F2'].is_date, ws['D2'].number_format, len(ws.data_validations.dataValidation), wb.properties.title)
`, f], { encoding: 'utf8' });
    assert.match(out, /'Câbles'/); assert.match(out, /A2 A1:I3 =SUM\(I2:I3\) True .*€.* 1 Essai <&>/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
