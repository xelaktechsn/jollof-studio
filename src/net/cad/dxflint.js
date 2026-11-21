// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Contrôle d'un DXF ASCII contre les règles de la référence DXF publique d'Autodesk (DXF Reference AutoCAD 2014) :
// types des valeurs par plage de codes (p. 2-4), ordre et équilibre des sections, LTYPE avant LAYER et BLOCKS avant
// ENTITIES (p. 256), EOF final, poignées (code 5, 105 pour DIMSTYLE) uniques et en hexadécimal, références (330, 340,
// 350, 360) vers des poignées existantes, $HANDSEED au-delà de la plus grande poignée, noms de calque / type de ligne /
// style / bloc utilisés et définis, BLOCK_RECORD pour chaque BLOCK, ENDBLK, SEQEND après les ATTRIB, compte des tables.
// Sert aux tests de dxfwrite.js (et à vérifier un DXF reçu). lintDxf(text) → { errors: [msg], warnings: [msg], stats }.

const RANGES = [ // [début, fin, type] — s chaîne, d double, i entier, b booléen, h poignée hexadécimale
  [0, 4, 's'], [5, 5, 'h'], [6, 9, 's'], [10, 59, 'd'], [60, 99, 'i'], [100, 102, 's'], [105, 105, 'h'], [110, 149, 'd'], [160, 179, 'i'],
  [210, 239, 'd'], [270, 289, 'i'], [290, 299, 'b'], [300, 309, 's'], [310, 319, 'x'], [320, 369, 'h'], [370, 389, 'i'], [390, 399, 'h'],
  [400, 409, 'i'], [410, 419, 's'], [420, 429, 'i'], [430, 439, 's'], [440, 459, 'i'], [460, 469, 'd'], [470, 479, 's'], [480, 481, 'h'],
  [999, 1009, 's'], [1010, 1059, 'd'], [1060, 1071, 'i']
];
const TYPE = new Array(1072).fill(null);
for (const [a, b, t] of RANGES) for (let i = a; i <= b; i++) TYPE[i] = t;
const ORDER = ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS', 'THUMBNAILIMAGE', 'ACDSDATA'];
const NUM = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/, INTRE = /^\s*[+-]?\d+\s*$/, HEX = /^[0-9A-Fa-f]{1,16}$/;

export function lintDxf(text) {
  const errors = [], warnings = [];
  const err = (m, ln) => { if (errors.length < 200) errors.push(ln ? `ligne ${ln} : ${m}` : m); };
  const wrn = (m, ln) => { if (warnings.length < 200) warnings.push(ln ? `ligne ${ln} : ${m}` : m); };
  const lines = String(text).split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length % 2) err('nombre de lignes impair (paires code/valeur incomplètes)');
  // 1. paires et types
  const G = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const ln = i + 1, cs = lines[i];
    if (!INTRE.test(cs)) { err(`code de groupe illisible « ${cs.slice(0, 20)} »`, ln); continue; }
    const c = parseInt(cs, 10), v = lines[i + 1], t = c >= 0 && c < 1072 ? TYPE[c] : null;
    if (!t) { err(`code de groupe ${c} hors des plages définies`, ln); continue; }
    if (t === 'd' && !NUM.test(v)) err(`code ${c} : nombre attendu, « ${v.slice(0, 30)} »`, ln + 1);
    else if ((t === 'i' || t === 'b') && !INTRE.test(v)) err(`code ${c} : entier attendu, « ${v.slice(0, 30)} »`, ln + 1);
    else if (t === 'b' && !/^\s*[01]\s*$/.test(v)) err(`code ${c} : booléen 0/1 attendu`, ln + 1);
    else if (t === 'h' && !HEX.test(v.trim())) err(`code ${c} : poignée hexadécimale attendue, « ${v.slice(0, 30)} »`, ln + 1);
    else if (t === 'i' && c >= 60 && c <= 79 && Math.abs(+v) > 32767) err(`code ${c} : entier 16 bits hors limites`, ln + 1);
    if (t === 's' && v.length > 2049) err(`code ${c} : chaîne de plus de 2049 caractères`, ln + 1);
    if (t === 's' && /[^\x09\x20-\x7e]/.test(v)) wrn(`code ${c} : caractère hors ASCII (préférer \\U+XXXX)`, ln + 1);
    G.push({ c, v: t === 's' ? v : v.trim(), ln });
  }
  // 2. sections et enregistrements
  const secs = [], recs = []; let sec = null, cur = null, eof = false;
  for (let k = 0; k < G.length; k++) {
    const g = G[k];
    if (eof) { err('données après EOF', g.ln); break; }
    if (g.c === 0) {
      if (g.v === 'SECTION') {
        if (sec) err(`SECTION ouverte dans ${sec}`, g.ln);
        const n = G[k + 1]; sec = n && n.c === 2 ? n.v : '?'; secs.push(sec); cur = null; k++; continue;
      }
      if (g.v === 'ENDSEC') { if (!sec) err('ENDSEC sans SECTION', g.ln); sec = null; cur = null; continue; }
      if (g.v === 'EOF') { if (sec) err(`EOF dans la section ${sec}`, g.ln); eof = true; continue; }
      if (!sec) { err(`enregistrement ${g.v} hors section`, g.ln); continue; }
      cur = { type: g.v, sec, ln: g.ln, g: [] }; recs.push(cur); continue;
    }
    if (cur) cur.g.push(g); else if (sec !== 'HEADER' && sec !== 'CLASSES' && sec) { /* nom de section */ }
  }
  if (!eof) err('EOF absent à la fin du fichier');
  let last = -1;
  for (const s of secs) { const i = ORDER.indexOf(s); if (i < 0) wrn(`section inconnue ${s}`); else if (i < last) err(`section ${s} hors d'ordre`); else last = i; }
  for (const s of new Set(secs)) if (secs.filter(x => x === s).length > 1) err(`section ${s} en double`);
  // 3. en-tête
  const header = {}; { let v = null;
    let inH = false;
    for (const g of G) {
      if (g.c === 0) { inH = false; }
      if (g.c === 2 && g.v === 'HEADER') { inH = true; continue; }
      if (!inH) continue;
      if (g.c === 9) { v = g.v; header[v] = []; } else if (v) header[v].push(g);
    }
  }
  if (!header.$ACADVER) wrn('$ACADVER absent');
  if (!header.$INSUNITS) wrn('$INSUNITS absent : unités inconnues pour le lecteur');
  // 4. poignées et références
  const handles = new Map(); let maxH = 0;
  for (const r of recs) {
    if (r.sec === 'CLASSES' || r.type === 'ENDTAB') continue; // ENDTAB n'a pas de poignée
    const own = r.g.find(g => g.c === (r.type === 'DIMSTYLE' ? 105 : 5));
    if (!own) { if (r.sec !== 'HEADER') err(`${r.type} sans poignée`, r.ln); continue; }
    const h = parseInt(own.v, 16);
    if (handles.has(h)) err(`poignée ${own.v} en double (${handles.get(h).type} et ${r.type})`, r.ln);
    handles.set(h, r); if (h > maxH) maxH = h;
  }
  const seed = header.$HANDSEED && header.$HANDSEED[0] ? parseInt(header.$HANDSEED[0].v, 16) : NaN;
  if (!(seed > maxH)) err(`$HANDSEED (${header.$HANDSEED ? header.$HANDSEED[0].v : 'absent'}) n'est pas au-delà de la plus grande poignée (${maxH.toString(16).toUpperCase()})`);
  for (const r of recs) for (const g of r.g) {
    if ((g.c === 330 || g.c === 340 || g.c === 350 || g.c === 360) && g.v !== '0' && !handles.has(parseInt(g.v, 16))) err(`${r.type} : référence ${g.c} vers la poignée inexistante ${g.v}`, g.ln);
  }
  // 5. tables : comptes, noms définis
  const tables = {}; let curT = null;
  for (const r of recs) {
    if (r.sec !== 'TABLES') continue;
    if (r.type === 'TABLE') { const n = r.g.find(g => g.c === 2); curT = n ? n.v : '?'; tables[curT] = { n: +(r.g.find(g => g.c === 70) || { v: 0 }).v, names: new Set(), ln: r.ln }; continue; }
    if (r.type === 'ENDTAB') { curT = null; continue; }
    if (!curT) { err(`${r.type} hors TABLE`, r.ln); continue; }
    if (r.type !== curT) err(`entrée ${r.type} dans la table ${curT}`, r.ln);
    const n = r.g.find(g => g.c === 2); if (n) { const k = n.v.toUpperCase(); if (tables[curT].names.has(k)) err(`${curT} : nom « ${n.v} » en double`, r.ln); tables[curT].names.add(k); }
  }
  for (const [t, o] of Object.entries(tables)) if (o.n < o.names.size) wrn(`table ${t} : 70 = ${o.n} pour ${o.names.size} entrées`);
  const tIdx = Object.keys(tables);
  if (tIdx.includes('LTYPE') && tIdx.includes('LAYER') && tIdx.indexOf('LTYPE') > tIdx.indexOf('LAYER')) err('la table LTYPE doit précéder LAYER');
  const has = (t, n) => !tables[t] || tables[t].names.has(String(n).toUpperCase());
  // 6. blocs et entités
  const blockNames = new Set(); let open = null;
  for (const r of recs) {
    if (r.sec === 'BLOCKS') {
      if (r.type === 'BLOCK') { if (open) err(`BLOCK ${open} sans ENDBLK`, r.ln); const n = r.g.find(g => g.c === 2); open = n ? n.v : '?'; if (n) blockNames.add(n.v.toUpperCase()); if (!has('BLOCK_RECORD', open)) err(`bloc ${open} sans BLOCK_RECORD`, r.ln); }
      else if (r.type === 'ENDBLK') { if (!open) err('ENDBLK sans BLOCK', r.ln); open = null; }
      else if (!open) err(`${r.type} hors d'un bloc`, r.ln);
    }
  }
  if (open) err(`BLOCK ${open} sans ENDBLK`);
  const ents = recs.filter(r => (r.sec === 'ENTITIES' || (r.sec === 'BLOCKS' && r.type !== 'BLOCK' && r.type !== 'ENDBLK')));
  let attOpen = null;
  for (const r of ents) {
    const v = c => (r.g.find(g => g.c === c) || {}).v;
    if (!r.g.some(g => g.c === 100 && g.v === 'AcDbEntity')) err(`${r.type} sans marqueur AcDbEntity`, r.ln);
    if (!r.g.some(g => g.c === 330)) err(`${r.type} sans propriétaire (330)`, r.ln);
    const l = v(8); if (l === undefined) err(`${r.type} sans calque (8)`, r.ln); else if (!has('LAYER', l)) wrn(`calque « ${l} » utilisé mais non défini`, r.ln);
    const lt = v(6); if (lt !== undefined && !has('LTYPE', lt)) err(`type de ligne « ${lt} » non défini`, r.ln);
    const st = v(7); if (st !== undefined && !has('STYLE', st)) err(`style « ${st} » non défini`, r.ln);
    if ((r.type === 'INSERT' || r.type === 'DIMENSION') && v(2) !== undefined && !blockNames.has(v(2).toUpperCase())) err(`${r.type} vers le bloc absent « ${v(2)} »`, r.ln);
    if (attOpen && r.type !== 'ATTRIB' && r.type !== 'SEQEND') { err('ATTRIB non terminés par SEQEND', r.ln); attOpen = null; }
    if (r.type === 'INSERT' && v(66) === '1') attOpen = r;
    if (r.type === 'ATTRIB') { if (!attOpen) err('ATTRIB sans INSERT (66 = 1)', r.ln); else if (v(330) !== (attOpen.g.find(g => g.c === 5) || {}).v) err('ATTRIB : le propriétaire (330) doit être l’INSERT', r.ln); }
    if (r.type === 'SEQEND') attOpen = null;
  }
  return { errors, warnings, stats: { lines: lines.length, groups: G.length, records: recs.length, handles: handles.size, sections: secs } };
}
