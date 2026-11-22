// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Classeur Excel (.xlsx, SpreadsheetML « Transitional ») : écriture et lecture du sous-ensemble utile aux tableaux du projet
// réseau. Module pur (octets ⇄ objets), sans interface. Écrit de zéro d'après ECMA-376 5e édition, partie 1 (publique) :
//   § 12.2-12.3 (p. 66-67) noms des parties (/xl/workbook.xml, /xl/sharedStrings.xml, /xl/styles.xml,
//   /xl/worksheets/sheetN.xml, /docProps/core.xml, /docProps/app.xml) et relations ;
//   § 18.2.5 definedName (p. 1553) ; § 18.2.27 workbookPr/date1904 (p. 1577) ;
//   § 18.3.1.2 autoFilter (p. 1591) ; § 18.3.1.4 c (p. 1593) et § 18.18.11 ST_CellType (p. 2441 : b, d, e, inlineStr, n, s,
//   str) ; § 18.3.1.13 col (p. 1600 : min, max, width, customWidth, hidden) ; § 18.3.1.32 dataValidation (showDropDown :
//   « whether to display a dropdown » — Excel l'interprète à l'envers, on ne l'écrit donc pas) ; § 18.3.1.66 pane
//   (p. 1665 : xSplit/ySplit = colonnes/lignes figées quand state="frozen", § 18.18.53 p. 2469) ;
//   § 18.8.30 numFmt (p. 1776-1777 : formats intégrés 0 General, 1 « 0 », 2 « 0.00 », 3 « #,##0 », 4 « #,##0.00 »,
//   9 « 0% », 10 « 0.00% », 14 date…, 49 « @ » ; formats propres à partir de 164) ;
//   § 18.17.4.1 (p. 2063-2064) dates : système 1900, date de base 00:00 le 30 décembre 1899 = 0, un jour = 1.
// Paquet ZIP par fflate (licence MIT, déjà une dépendance de l'application, quelques ko compressés). SheetJS (xlsx) n'a
// pas été retenu : la version de npm est figée et ancienne, les versions suivies sont hors npm, sous licence Apache-2.0 et
// pèsent plusieurs centaines de ko pour bien plus que ce dont on a besoin (écrire des tableaux, relire des valeurs).
//
// writeXlsx({ props: { title, subject, creator, company, created: Date, custom: { nom: valeur } }, sheets: [{ name,
//   cols: [{ header, width, fmt: 'text'|'int'|'dec1'|'dec2'|'money'|'percent'|'date', hidden, list: [valeurs] (liste de
//   validation) }], rows: [[valeur | { f: 'SUM(D2:D9)', v: valeur en cache } | Date | null]], freeze (lignes figées, 1 par
//   défaut), filter (filtre automatique, vrai par défaut), totalRows (dernières lignes en gras) }], currency: 'EUR' })
//   → Uint8Array.
// readXlsx(octets) → { sheets: [{ name, rows: [[valeur]], hidden }], props: { title, creator, custom } } ; valeur :
//   string | number | boolean | Date | null ; les formules rendent leur valeur en cache (sinon null).
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { DESIGN_LIM } from '../lim/design.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
/** Caractères interdits en XML 1.0 retirés, puis échappement. */
export const xmlEsc = s => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Référence de colonne : 0 → A, 25 → Z, 26 → AA. */
export const colName = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
export const colIndex = s => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const { base1900, offset1904 } = DESIGN_LIM.XLSX_DATE_SYSTEM.v, DATE_IDS = DESIGN_LIM.XLSX_NUMFMT.v.dateIds;
const DAY = 86400000, BASE = Date.parse(base1900 + 'T00:00:00Z');
/** Date → numéro de série du système 1900 (§ 18.17.4.1), à partir de la date et de l'heure locales du fichier (UTC ici). */
export const dateSerial = d => (d.getTime() - BASE) / DAY;
export const serialDate = n => new Date(BASE + Math.round(n * DAY));
/** Nom de feuille valable : 31 caractères au plus, sans : \ / ? * [ ] (Excel). */
export const sheetName = s => String(s || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';

/* ---------- Écriture ---------- */
const FMT = { text: 49, int: 1, dec2: 2, thousands: 3, percent: 10 };
export function writeXlsx(wb) {
  const sheets = (wb.sheets || []).map((s, i) => ({ ...s, name: uniq(sheetName(s.name), i, wb.sheets) }));
  const cur = String(wb.currency || 'EUR').slice(0, 3);
  // Styles : 0 défaut, 1 en-tête, puis un style par format, en normal et en gras (lignes de total).
  const fmts = [['text', FMT.text], ['int', FMT.int], ['dec1', 164], ['dec2', FMT.dec2], ['money', 165], ['percent', FMT.percent], ['date', 166], ['general', 0]];
  const xfIndex = {}; fmts.forEach(([k], i) => { xfIndex[k] = 2 + i * 2; xfIndex[k + '!b'] = 3 + i * 2; });
  const sst = [], sstMap = new Map();
  const si = s => { s = String(s); let k = sstMap.get(s); if (k == null) { k = sst.length; sst.push(s); sstMap.set(s, k); } return k; };
  const files = {};
  sheets.forEach((s, n) => { files[`xl/worksheets/sheet${n + 1}.xml`] = strToU8(sheetXml(s, si, xfIndex)); });
  const custom = (wb.props && wb.props.custom) || {};
  const hasCustom = Object.keys(custom).length > 0;
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT}sheet.main+xml"/>${sheets.map((s, n) => `<Override PartName="/xl/worksheets/sheet${n + 1}.xml" ContentType="${CT}worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="${CT}styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="${CT}sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${hasCustom ? '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>' : ''}</Types>`);
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}extended-properties" Target="docProps/app.xml"/>${hasCustom ? `<Relationship Id="rId4" Type="${REL}custom-properties" Target="docProps/custom.xml"/>` : ''}</Relationships>`);
  // Filtre automatique : nom défini caché _xlnm._FilterDatabase par feuille (comme l'écrit Excel).
  const names = sheets.map((s, n) => (s.filter !== false && (s.cols || []).length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${n}" hidden="1">'${xmlEsc(s.name.replace(/'/g, "''"))}'!$A$1:$${colName(s.cols.length - 1)}$${Math.max(1, (s.rows || []).length - (s.totalRows || 0) + 1)}</definedName>` : '')).join('');
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${R_NS}"><workbookPr date1904="false"/><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, n) => `<sheet name="${xmlEsc(s.name)}" sheetId="${n + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${n + 1}"/>`).join('')}</sheets>${names ? `<definedNames>${names}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL}">${sheets.map((s, n) => `<Relationship Id="rId${n + 1}" Type="${REL}worksheet" Target="worksheets/sheet${n + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="${REL}sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  // Code de format échappé en entier (les guillemets du symbole sont dans l'attribut) ; la devise est réduite à des lettres.
  const money = xmlEsc(`#,##0.00\\ "${cur === 'EUR' ? '€' : String(cur || '').replace(/[^\p{L}$£¥€]/gu, '').slice(0, 4)}"`);
  const xf = (id, bold) => `<xf numFmtId="${id}" fontId="${bold ? 1 : 0}" fillId="0" borderId="0" xfId="0"${id ? ' applyNumberFormat="1"' : ''}${bold ? ' applyFont="1"' : ''}/>`;
  files['xl/styles.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}"><numFmts count="3"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="${money}"/><numFmt numFmtId="166" formatCode="yyyy\\-mm\\-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF7F8FA6"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${2 + fmts.length * 2}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>${fmts.map(([, id]) => xf(id, false) + xf(id, true)).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  files['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${NS}" count="${sst.length}" uniqueCount="${sst.length}">${sst.map(s => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`);
  const P = wb.props || {}, when = (P.created instanceof Date ? P.created : new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  files['docProps/core.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(P.title || '')}</dc:title><dc:subject>${xmlEsc(P.subject || '')}</dc:subject><dc:creator>${xmlEsc(P.creator || '')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified></cp:coreProperties>`);
  files['docProps/app.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Jollof Studio</Application>${P.company ? `<Company>${xmlEsc(P.company)}</Company>` : ''}</Properties>`);
  if (hasCustom) files['docProps/custom.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${Object.entries(custom).map(([k, v], i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${xmlEsc(k)}"><vt:lpwstr>${xmlEsc(v)}</vt:lpwstr></property>`).join('')}</Properties>`);
  return zipSync(files, { level: 6 });
}
const uniq = (name, i, all) => { const prev = (all || []).slice(0, i).map(s => sheetName(s.name).toLowerCase()); let n = name, k = 2; while (prev.includes(n.toLowerCase())) n = name.slice(0, 28) + ' ' + k++; return n; };
function sheetXml(s, si, X) {
  const cols = s.cols || [], rows = s.rows || [], freeze = s.freeze ?? 1, total = s.totalRows || 0, last = rows.length + 1;
  const width = c => c.width || Math.min(60, Math.max(8, String(c.header || '').length + 2));
  const cellXml = (v, ref, fmt, bold) => {
    const st = X[(fmt || 'general') + (bold ? '!b' : '')] ?? 0;
    if (v == null || v === '') return st ? `<c r="${ref}" s="${st}"/>` : '';
    if (typeof v === 'object' && !(v instanceof Date) && v.f) {
      const cv = v.v; const t = typeof cv === 'string' ? ' t="str"' : typeof cv === 'boolean' ? ' t="b"' : '';
      return `<c r="${ref}" s="${st}"${t}><f>${xmlEsc(v.f)}</f>${cv == null ? '' : `<v>${typeof cv === 'boolean' ? (cv ? 1 : 0) : xmlEsc(cv)}</v>`}</c>`;
    }
    if (v instanceof Date) return `<c r="${ref}" s="${X['date' + (bold ? '!b' : '')]}"><v>${dateSerial(v)}</v></c>`;
    if (typeof v === 'number' && Number.isFinite(v) && fmt !== 'text') return `<c r="${ref}" s="${st}"><v>${v}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}" s="${st}" t="b"><v>${v ? 1 : 0}</v></c>`;
    return `<c r="${ref}" s="${st}" t="s"><v>${si(v)}</v></c>`;
  };
  const head = `<row r="1">${cols.map((c, j) => `<c r="${colName(j)}1" s="1" t="s"><v>${si(c.header || '')}</v></c>`).join('')}</row>`;
  const body = rows.map((r, i) => { const bold = i >= rows.length - total; return `<row r="${i + 2}">${cols.map((c, j) => cellXml(r[j], colName(j) + (i + 2), c.fmt, bold)).join('')}</row>`; }).join('');
  const pane = freeze > 0 ? `<pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${freeze + 1}" sqref="A${freeze + 1}"/>` : '';
  const colsXml = cols.length ? `<cols>${cols.map((c, j) => `<col min="${j + 1}" max="${j + 1}" width="${width(c)}" customWidth="1"${c.hidden ? ' hidden="1"' : ''}/>`).join('')}</cols>` : '';
  const filter = s.filter !== false && cols.length ? `<autoFilter ref="A1:${colName(cols.length - 1)}${Math.max(1, last - total)}"/>` : '';
  const dv = cols.map((c, j) => ({ c, j })).filter(x => Array.isArray(x.c.list) && x.c.list.length && rows.length);
  const lists = dv.map(({ c, j }) => { const f = '"' + c.list.map(v => String(v).replace(/[",]/g, ' ')).join(',') + '"'; return f.length <= 255 ? `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${colName(j)}2:${colName(j)}${Math.max(2, last - total)}"><formula1>${xmlEsc(f)}</formula1></dataValidation>` : ''; }).filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}" xmlns:r="${R_NS}"><dimension ref="A1:${colName(Math.max(0, cols.length - 1))}${last}"/><sheetViews><sheetView workbookViewId="0"${s.tabSelected ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${head}${body}</sheetData>${filter}${lists.length ? `<dataValidations count="${lists.length}">${lists.join('')}</dataValidations>` : ''}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

/* ---------- Lecture ---------- */
const unesc = s => s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (m, e) => (e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(+e.slice(1))));
const attrs = s => { const o = {}; for (const m of s.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) o[m[1].replace(/^\w+:/, '')] = unesc(m[3] ?? m[4] ?? ''); return o; };
/** Éléments <tag …>…</tag> ou <tag …/> (préfixe d'espace de noms ignoré) : [{ a: attributs, inner }]. */
function elems(xml, tag) {
  const out = [], re = new RegExp(`<(?:\\w+:)?${tag}(\\s[^>]*?)?(/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'g');
  for (const m of xml.matchAll(re)) out.push({ a: attrs(m[1] || ''), inner: m[3] ?? '' });
  return out;
}
const textOf = inner => elems(inner, 't').map(t => unesc(t.inner)).join('');
/** Format de date ? (formats intégrés 14-22, 45-47, ou format propre avec y, m, d, h, s hors guillemets et crochets). */
const isDateFmt = (id, code) => DATE_IDS.some(([a, b]) => id >= a && id <= b) || (!!code && /[ymdhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^[#0.,\s%E+-]*$/.test(code));
export function readXlsx(bytes) {
  const z = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), get = p => (z[p] ? strFromU8(z[p]) : null);
  const wbx = get('xl/workbook.xml'); if (!wbx) throw new Error('xlsx: xl/workbook.xml absent');
  const rels = new Map(elems(get('xl/_rels/workbook.xml.rels') || '', 'Relationship').map(r => [r.a.Id, r.a.Target]));
  const sst = elems(get('xl/sharedStrings.xml') || '', 'si').map(s => textOf(s.inner));
  const stx = get('xl/styles.xml') || '';
  const codes = new Map(elems(stx, 'numFmt').map(f => [+f.a.numFmtId, f.a.formatCode]));
  const cellXfs = elems(stx, 'cellXfs')[0], xfs = cellXfs ? elems(cellXfs.inner, 'xf').map(x => +x.a.numFmtId || 0) : [];
  const dateStyle = xfs.map(id => isDateFmt(id, codes.get(id)));
  const date1904 = /date1904\s*=\s*"(1|true)"/.test(wbx);
  const sheets = elems(wbx, 'sheet').map(s => {
    let target = rels.get(s.a.id) || ''; target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const x = get(target) || '', rows = [];
    for (const r of elems(x, 'row')) {
      const ri = (+r.a.r || rows.length + 1) - 1, row = [];
      for (const c of elems(r.inner, 'c')) {
        const ref = /^([A-Z]+)(\d+)$/.exec(c.a.r || ''), j = ref ? colIndex(ref[1]) : row.length;
        const t = c.a.t || 'n', vEl = elems(c.inner, 'v')[0], raw = vEl ? unesc(vEl.inner) : null;
        let v = null;
        if (t === 's') v = raw == null ? null : sst[+raw] ?? null;
        else if (t === 'inlineStr') { const is = elems(c.inner, 'is')[0]; v = is ? textOf(is.inner) : ''; }
        else if (t === 'b') v = raw == null ? null : raw === '1' || raw === 'true';
        else if (t === 'str' || t === 'e') v = raw;
        else if (t === 'd') v = raw ? new Date(raw) : null;
        else if (raw != null && raw !== '') { const n = +raw; v = dateStyle[+c.a.s || 0] ? serialDate(date1904 ? n + offset1904 : n) : n; }
        row[j] = v;
      }
      for (let k = 0; k < row.length; k++) if (row[k] === undefined) row[k] = null;
      rows[ri] = row;
    }
    for (let k = 0; k < rows.length; k++) if (!rows[k]) rows[k] = [];
    return { name: s.a.name, hidden: s.a.state === 'hidden' || s.a.state === 'veryHidden', rows };
  });
  const core = get('docProps/core.xml') || '', one = (xml, t) => { const e = elems(xml, t)[0]; return e ? unesc(e.inner) : ''; };
  const custom = {}; for (const p of elems(get('docProps/custom.xml') || '', 'property')) custom[p.a.name] = unesc(p.inner.replace(/<[^>]+>/g, ''));
  return { sheets, props: { title: one(core, 'title'), creator: one(core, 'creator'), custom } };
}
