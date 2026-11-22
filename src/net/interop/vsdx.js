// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Dessin Visio (.vsdx) : écriture des vues du projet réseau (modèle neutre de diagram.js) et lecture d'un fichier .vsdx
// (le nôtre pour la vérification, ou celui d'un autre outil pour l'import). Module pur (octets ⇄ objets), sans interface.
// Écrit de zéro, d'après la documentation publique de Microsoft (rien n'est repris d'un autre programme) :
//   - « Introduction to the Visio file format (.vsdx) » et « Manipulate the Visio file format programmatically »
//     (learn.microsoft.com/office/client-developer/visio) : paquet OPC (zip + parties XML + relations), parties
//     /visio/document.xml, /docProps/app.xml, core.xml, custom.xml, cellules en <Cell N V U F>, sections et lignes en
//     <Section N>/<Row IX|N T> ; propriété « RecalcDocument » de custom.xml (fmtid {D5CDD505-…}) : Visio recalcule le
//     dessin à l'ouverture, ce qui recolle les connecteurs ;
//   - [MS-VSDX] v20251113 (learn.microsoft.com/openspecs/sharepoint_protocols/ms-vsdx) : 2.3.3.3 Document, 2.3.3.8 Page,
//     2.3.3.9 Pages, Masters et Master XML Parts (types de contenu, relations, éléments racines VisioDocument, Pages,
//     PageContents, Masters, MasterContents) ; 2.4.4.94-96 DrawingScale, DrawingScaleType (4 métrique), DrawingSizeType
//     (3 taille propre) ; 2.4.4.165 LayerMember (rangs de calque base 0 séparés par « ; ») ; 2.5.8.1 et 2.5.8.3 : unités
//     internes, angles en radians, longueurs en pouces ; grammaire des formules : couleur « # » + 6 chiffres hexadécimaux ;
//   - référence Visio XML (même site) : éléments Shape, Page, Master, Connect (FromSheet, FromCell, FromPart, ToSheet,
//     ToCell, ToPart ; espace de noms http://schemas.microsoft.com/office/visio/2012/main du client Visio), cellules des
//     sections Layer (Name, Visible, Print, Active, Lock, Snap, Glue, Color : 255 = sans couleur) et Shape Data (Label,
//     Prompt, Type 0 chaîne / 2 nombre, Format, Value, SortKey, Invisible) ;
//   - énumérations VisFromParts (visBegin 9, visEnd 12) et VisToParts (visConnectionPoint = 100 + rang du point) ;
//   - « Creating a Connected Drawing from a Program » (collage : BeginX/EndX vers Connections.Xi d'une autre forme),
//     fonctions PAR et PNT (point ramené au repère du parent), « Creating Routable … 1-D Connectors » (ObjType 2).
// Zip par fflate (MIT, déjà une dépendance). Pas de windows.xml : la partie n'est pas citée parmi les relations du
// document ([MS-VSDX] 2.3.3.3) et Visio ouvre alors la première page.
//
// writeVsdx(views, { title, creator, company, date }) → Uint8Array (views : buildViews de diagram.js)
// readVsdx(octets) → { parts: [noms], types: { partie: type }, rels: { source: [{ id, type, target }] }, pages: [{ name,
//   width, height, scale, layers: [{ name }], shapes: [{ id, name, master, type, text, x, y, w, h, angle, oneD, begin,
//   end, layers: [rangs], props: { clé: { label, value } }, geom: [[{ t, x, y }]] }], connects: [{ from, fromCell,
//   fromPart, to, toCell, toPart }] }], masters: [{ id, name, shape }], props: { custom } }
// checkVsdx(lu, { ours }) → [messages] : intégrité (types de contenu, relations, Connect vers des formes existantes, données).
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { NET } from '../limits.js';
import { PROP_KEYS, DEVICE_KEYS } from './diagram.js';
import { parseTree, kids, kid, xmlEsc as E } from './xmltree.js';

const NS = NET.VISIO_NS.v.main, RNS = NET.VISIO_NS.v.r, P = NET.VISIO_PARTS.v, DP = NET.VISIO_DOCPROPS.v;
const CON = NET.VISIO_CONNECT.v, PT = NET.VISIO_PROP_TYPES.v, LY = NET.VISIO_LAYERS.v, UN = NET.VISIO_UNITS.v, ONED = NET.VISIO_ONED.v;
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const CORE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
const CORE_CT = 'application/vnd.openxmlformats-package.core-properties+xml';
const XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
/** Pouces par unité de page (diagram.js) : écran 100 par pouce (comme draw.io), millimètres, mètres. */
const PER_IN = { px: 1 / NET.DRAWIO_PX_PER_IN.v, mm: 1 / UN.mmPerInch, m: 1000 / UN.mmPerInch };
const UNIT_U = { px: 'MM', mm: 'MM', m: 'M' };
const n6 = v => { const r = Math.round(v * 1e6) / 1e6; return Object.is(r, -0) ? '0' : String(r); };
const PT_IN = pt => pt / 72;
/** Couleur « #rrggbb » ([MS-VSDX] color-value). */
const col = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : '#000000');

/** GUID déterministe (même projet → mêmes identifiants de gabarits) au format {8-4-4-4-12}. */
function guid(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); h3 = Math.imul(h3 ^ c, 3266489909); h4 = Math.imul(h4 ^ c, 668265263); }
  const x = [h1, h2, h3, h4].map(v => (v >>> 0).toString(16).padStart(8, '0')).join('').toUpperCase();
  return `{${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-8${x.slice(17, 20)}-${x.slice(20, 32)}}`;
}

/* ---------- Écriture des cellules ---------- */
const cell = (n, v, u, f) => `<Cell N="${n}" V="${E(v)}"${u ? ` U="${u}"` : ''}${f ? ` F="${E(f)}"` : ''}/>`;
const row = (attrs, cells) => `<Row ${attrs}>${cells.join('')}</Row>`;
function lineFill(st = {}, o = {}) {
  const out = [];
  if (st.line === 'none' || o.noLine) out.push(cell('LinePattern', 0)); else { out.push(cell('LineWeight', n6(PT_IN(st.lw ?? 0.75)), 'PT'), cell('LineColor', col(st.line || '#334155')), cell('LinePattern', st.dash ? 2 : 1)); }
  if (!st.fill || st.fill === 'none' || o.noFill) out.push(cell('FillPattern', 0)); else out.push(cell('FillForegnd', col(st.fill)), cell('FillBkgnd', col(st.fill)), cell('FillPattern', 1));
  return out.join('');
}
function charPara(st = {}) {
  const al = st.align === 'left' ? 0 : st.align === 'right' ? 2 : 1;
  return `<Section N="Character">${row('IX="0"', [cell('Size', n6(PT_IN(st.font || 8)), 'PT'), cell('Color', col(st.ink || '#0f172a')), cell('Style', st.bold ? 1 : 0)])}</Section>`
    + `<Section N="Paragraph">${row('IX="0"', [cell('HorzAlign', al)])}</Section>`;
}
const RECT = ['MoveTo', [0, 0], 'LineTo', [1, 0], 'LineTo', [1, 1], 'LineTo', [0, 1], 'LineTo', [0, 0]];
/** Géométrie relative à la taille (formules Width*k, Height*k : la forme suit son redimensionnement). */
function relGeom(kind, w, h, noFill) {
  const head = [cell('NoFill', noFill ? 1 : 0), cell('NoLine', 0), cell('NoShow', 0), cell('NoSnap', 0)].join('');
  if (kind === 'ellipse') return `<Section N="Geometry" IX="0">${head}${row('T="Ellipse" IX="1"', [cell('X', n6(w / 2), '', 'Width*0.5'), cell('Y', n6(h / 2), '', 'Height*0.5'), cell('A', n6(w), '', 'Width*1'), cell('B', n6(h / 2), '', 'Height*0.5'), cell('C', n6(w / 2), '', 'Width*0.5'), cell('D', n6(h), '', 'Height*1')])}</Section>`;
  const rows = [];
  for (let i = 0; i < RECT.length; i += 2) { const [fx, fy] = RECT[i + 1]; rows.push(row(`T="${RECT[i]}" IX="${i / 2 + 1}"`, [cell('X', n6(w * fx), '', `Width*${fx}`), cell('Y', n6(h * fy), '', `Height*${fy}`)])); }
  return `<Section N="Geometry" IX="0">${head}${rows.join('')}</Section>`;
}
/** Géométrie absolue (pièces, cheminements) : anneaux en coordonnées locales (pouces), un IX par anneau. */
function absGeom(rings, closed, u) {
  return rings.map((ring, k) => {
    const pts = closed && ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ? [...ring, ring[0]] : ring;
    const rows = pts.map((p, i) => row(`T="${i ? 'LineTo' : 'MoveTo'}" IX="${i + 1}"`, [cell('X', n6(p[0]), u), cell('Y', n6(p[1]), u)]));
    return `<Section N="Geometry" IX="${k}">${cell('NoFill', closed ? 0 : 1)}${cell('NoLine', 0)}${cell('NoShow', 0)}${cell('NoSnap', 0)}${rows.join('')}</Section>`;
  }).join('');
}
/** Points de connexion des gabarits : gauche, droite, haut, bas (rangs 0 à 3). */
const CPTS = [[0, 0.5], [1, 0.5], [0.5, 1], [0.5, 0]];
const connSection = (w, h) => `<Section N="Connection">${CPTS.map(([fx, fy], i) => row(`IX="${i}"`, [cell('X', n6(w * fx), '', `Width*${fx}`), cell('Y', n6(h * fy), '', `Height*${fy}`), cell('DirX', 0), cell('DirY', 0), cell('Type', 0), cell('AutoGen', 0)])).join('')}</Section>`;
/**
 * Section Shape Data. mode 'def' : toutes les lignes définies, valeurs vides (gabarit) ; 'full' : lignes définies pour les
 * valeurs présentes (forme sans gabarit) ; 'value' : la seule cellule Value des valeurs présentes (instance d'un gabarit).
 */
function propSection(props, names, mode) {
  if (!props) return '';
  const rows = [];
  (mode === 'def' ? DEVICE_KEYS : PROP_KEYS).forEach((k, i) => {
    const v = props[k], has = v != null && v !== '';
    if (mode !== 'def' && !has) return;
    const isNum = k === 'Length', val = has ? String(v) : '', vu = isNum && has ? '' : 'STR';
    rows.push(mode === 'value'
      ? row(`N="${k}"`, [cell('Value', val, vu)])
      : row(`N="${k}"`, [cell('Label', names[k] || k), cell('Prompt', isNum ? 'm' : ''), cell('Type', isNum ? PT.number : PT.string), cell('Format', ''), cell('Value', val, vu), cell('SortKey', String(i).padStart(2, '0')), cell('Invisible', 0), cell('Verify', 0)]));
  });
  return rows.length ? `<Section N="Property">${rows.join('')}</Section>` : '';
}
const textEl = t => (t ? `<Text>${E(t)}</Text>` : '');

/* ---------- Gabarits ---------- */
const MW = 1, MH = 0.6; // taille d'un gabarit (pouces) : chaque instance donne la sienne
function masterXml(m, names) {
  const st = m.style || {};
  return XMLH + `<MasterContents xmlns="${NS}" xmlns:r="${RNS}"><Shapes><Shape ID="5" NameU="${E(m.key)}" Name="${E(m.name)}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">`
    + cell('PinX', n6(MW / 2), 'MM', 'Width*0.5') + cell('PinY', n6(MH / 2), 'MM', 'Height*0.5') + cell('Width', n6(MW), 'MM') + cell('Height', n6(MH), 'MM')
    + cell('LocPinX', n6(MW / 2), 'MM', 'Width*0.5') + cell('LocPinY', n6(MH / 2), 'MM', 'Height*0.5') + cell('Angle', 0, 'DEG') + cell('FlipX', 0) + cell('FlipY', 0) + cell('ResizeMode', 0)
    + lineFill(st) + (m.geom === 'rect' ? cell('Rounding', n6(0.04), 'MM') : '') + cell('VerticalAlign', 1) + cell('ObjType', 1)
    + charPara(st) + connSection(MW, MH) + propSection({}, names, 'def') + relGeom(m.geom, MW, MH)
    + '</Shape></Shapes></MasterContents>';
}

/* ---------- Pages ---------- */
function pageGeometry(pg) {
  const f = PER_IN[pg.unit] || PER_IN.px, b = pg.box;
  return { f, X: x => (x - b.x0) * f, Y: y => (b.y1 - y) * f, W: (b.x1 - b.x0) * f, H: (b.y1 - b.y0) * f, u: UNIT_U[pg.unit] || 'MM' };
}
function pageSheet(pg) {
  const G = pageGeometry(pg), cells = [cell('PageWidth', n6(G.W), G.u), cell('PageHeight', n6(G.H), G.u)];
  if (pg.unit === 'm') { cells.push(cell('PageScale', n6(10 / UN.mmPerInch), 'CM'), cell('DrawingScale', n6(10 * pg.scale / UN.mmPerInch), 'M'), cell('DrawingScaleType', UN.scaleTypeMetric)); }
  else if (pg.unit === 'mm') { cells.push(cell('PageScale', n6(1 / UN.mmPerInch), 'MM'), cell('DrawingScale', n6(pg.scale / UN.mmPerInch), 'MM'), cell('DrawingScaleType', UN.scaleTypeMetric)); }
  else cells.push(cell('PageScale', n6(1 / UN.mmPerInch), 'MM'), cell('DrawingScale', n6(1 / UN.mmPerInch), 'MM'), cell('DrawingScaleType', 0));
  cells.push(cell('DrawingSizeType', UN.sizeTypeCustom), cell('InhibitSnap', 0));
  const layers = pg.layers.map((L, i) => row(`IX="${i}"`, [cell('Name', L.name), cell('NameUniv', L.key), cell('Visible', 1), cell('Print', 1), cell('Active', 0), cell('Lock', 0), cell('Snap', 1), cell('Glue', 1), cell('Color', LY.noColor)]));
  return `<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">${cells.join('')}<Section N="Layer">${layers.join('')}</Section></PageSheet>`;
}
/** Rangs des calques d'une forme ([MS-VSDX] 2.4.4.165). */
const memberOf = (pg, keys) => (keys || []).map(k => pg.layers.findIndex(L => L.key === k)).filter(i => i >= 0).join(';');

function pageXml(pg, masterIds, names) {
  const G = pageGeometry(pg), out = [], ids = new Map(), centre = new Map();
  let next = 1;
  for (const s of pg.shapes) ids.set(s.id, next++);
  const nameU = (s, id) => `${s.kind}.${id}`;
  for (const s of pg.shapes) {
    const id = ids.get(s.id), st = s.style || {}, w = Math.max(1e-4, s.w * G.f), h = Math.max(1e-4, s.h * G.f);
    const cx = G.X(s.x + s.w / 2), cy = G.Y(s.y + s.h / 2), ang = -(s.rot || 0) * Math.PI / 180;
    centre.set(s.id, { cx, cy, w, h });
    const mid = s.master != null ? masterIds.get(s.master) : null;
    let x = `<Shape ID="${id}" NameU="${E(nameU(s, id))}" Name="${E(nameU(s, id))}" Type="Shape"${mid ? ` Master="${mid}"` : ' LineStyle="0" FillStyle="0" TextStyle="0"'}>`;
    x += cell('PinX', n6(cx), G.u) + cell('PinY', n6(cy), G.u) + cell('Width', n6(w), G.u) + cell('Height', n6(h), G.u)
      + cell('LocPinX', n6(w / 2), G.u, 'Width*0.5') + cell('LocPinY', n6(h / 2), G.u, 'Height*0.5') + cell('Angle', n6(ang), 'DEG') + cell('FlipX', 0) + cell('FlipY', 0);
    const mem = memberOf(pg, s.layers); if (mem !== '') x += cell('LayerMember', mem);
    if (s.textOut) { // étiquette à droite du symbole (prises, points d'accès sur un plan)
      const tw = Math.max(w * 8, 1.2 * G.f * (pg.unit === 'm' ? pg.scale / 100 : 1));
      x += cell('TxtPinX', n6(w * 1.15), G.u, 'Width*1.15') + cell('TxtPinY', n6(h / 2), G.u, 'Height*0.5') + cell('TxtWidth', n6(tw), G.u) + cell('TxtHeight', n6(h * 1.2), G.u)
        + cell('TxtLocPinX', 0, G.u, 'TxtWidth*0') + cell('TxtLocPinY', n6(h * 0.6), G.u, 'TxtHeight*0.5') + cell('TxtAngle', 0, 'DEG');
    }
    if (s.vtext) { // texte vertical (PDU 0 U) : bloc de texte tourné d'un quart de tour
      x += cell('TxtPinX', n6(w / 2), G.u, 'Width*0.5') + cell('TxtPinY', n6(h / 2), G.u, 'Height*0.5') + cell('TxtWidth', n6(h), G.u, 'Height*1') + cell('TxtHeight', n6(w), G.u, 'Width*1')
        + cell('TxtLocPinX', n6(h / 2), G.u, 'TxtWidth*0.5') + cell('TxtLocPinY', n6(w / 2), G.u, 'TxtHeight*0.5') + cell('TxtAngle', n6(Math.PI / 2), 'DEG');
    }
    if (mid) {
      x += propSection(s.props, names, 'value');
      if (st.font) x += `<Section N="Character">${row('IX="0"', [cell('Size', n6(PT_IN(st.font)), 'PT')])}</Section>`; // taille ajustée au nom
      if (s.textOut) x += `<Section N="Paragraph">${row('IX="0"', [cell('HorzAlign', 0)])}</Section>`;
    } else if (s.geom === 'text') {
      x += lineFill({}, { noLine: true, noFill: true }) + cell('VerticalAlign', 1) + charPara(st);
    } else if (s.geom === 'poly') {
      const lx = p => G.X(p[0]) - (cx - w / 2), ly = p => G.Y(p[1]) - (cy - h / 2);
      x += lineFill(st) + charPara(st) + propSection(s.props, names, 'full') + absGeom(s.rings.map(r => r.map(p => [lx(p), ly(p)])), true, G.u);
    } else if (s.geom === 'line') {
      const lx = p => G.X(p[0]) - (cx - w / 2), ly = p => G.Y(p[1]) - (cy - h / 2);
      x += lineFill(st, { noFill: true }) + charPara(st) + propSection(s.props, names, 'full') + absGeom([s.pts.map(p => [lx(p), ly(p)])], false, G.u);
    } else {
      x += lineFill(st) + cell('VerticalAlign', 1) + charPara(st) + propSection(s.props, names, 'full') + relGeom(s.geom === 'ellipse' ? 'ellipse' : 'rect', w, h);
    }
    x += textEl(s.text) + '</Shape>';
    out.push(x);
  }
  // Câbles : connecteurs 1-D collés aux points de connexion des formes (formules PAR(PNT(…)) et éléments Connect).
  const connects = [];
  for (const e of pg.edges) {
    const A = centre.get(e.from), B = centre.get(e.to), ia = ids.get(e.from), ib = ids.get(e.to); if (!A || !B) continue;
    const id = next++, st = e.style || {};
    const side = (P, Q) => (Math.abs(Q.cx - P.cx) / Math.max(P.w, 1e-6) >= Math.abs(Q.cy - P.cy) / Math.max(P.h, 1e-6) ? (Q.cx >= P.cx ? 1 : 0) : (Q.cy >= P.cy ? 2 : 3));
    const ra = side(A, B), rb = side(B, A);
    const at = (P, r) => [P.cx - P.w / 2 + P.w * CPTS[r][0], P.cy - P.h / 2 + P.h * CPTS[r][1]];
    const [bx, by] = at(A, ra), [ex, ey] = at(B, rb), len = Math.hypot(ex - bx, ey - by);
    const glue = (sheet, r) => NET.VISIO_GLUE.v.replace(/\{sheet\}/g, `Sheet.${sheet}`).replace(/\{n\}/g, String(r + 1));
    let x = `<Shape ID="${id}" NameU="Cable.${id}" Name="Cable.${id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">`;
    x += cell('PinX', n6((bx + ex) / 2), G.u, '(BeginX+EndX)/2') + cell('PinY', n6((by + ey) / 2), G.u, '(BeginY+EndY)/2') + cell('Width', n6(len), G.u, ONED.width)
      + cell('Height', 0, G.u) + cell('LocPinX', n6(len / 2), G.u, 'Width*0.5') + cell('LocPinY', 0, G.u, 'Height*0.5') + cell('Angle', n6(Math.atan2(ey - by, ex - bx)), 'DEG', 'ATAN2(EndY-BeginY,EndX-BeginX)')
      + cell('FlipX', 0) + cell('FlipY', 0)
      + cell('BeginX', n6(bx), G.u, glue(ia, ra)) + cell('BeginY', n6(by), G.u, glue(ia, ra)) + cell('EndX', n6(ex), G.u, glue(ib, rb)) + cell('EndY', n6(ey), G.u, glue(ib, rb))
      + cell('ObjType', ONED.objType) + cell('GlueType', 0) + lineFill(st, { noFill: true }) + cell('BeginArrow', 0) + cell('EndArrow', 0);
    const mem = memberOf(pg, e.layers); if (mem !== '') x += cell('LayerMember', mem);
    x += charPara({ font: st.font || 6, ink: st.ink }) + propSection(e.props, names, 'full')
      + `<Section N="Geometry" IX="0">${cell('NoFill', 1)}${cell('NoLine', 0)}${cell('NoShow', 0)}${cell('NoSnap', 0)}${row('T="MoveTo" IX="1"', [cell('X', 0, '', 'Width*0'), cell('Y', 0, '', 'Height*0')])}${row('T="LineTo" IX="2"', [cell('X', n6(len), '', 'Width*1'), cell('Y', 0, '', 'Height*0')])}</Section>`
      + textEl(e.text) + '</Shape>';
    out.push(x);
    connects.push(`<Connect FromSheet="${id}" FromCell="BeginX" FromPart="${CON.begin}" ToSheet="${ia}" ToCell="Connections.X${ra + 1}" ToPart="${CON.point + ra}"/>`);
    connects.push(`<Connect FromSheet="${id}" FromCell="EndX" FromPart="${CON.end}" ToSheet="${ib}" ToCell="Connections.X${rb + 1}" ToPart="${CON.point + rb}"/>`);
  }
  return XMLH + `<PageContents xmlns="${NS}" xmlns:r="${RNS}"><Shapes>${out.join('')}</Shapes>${connects.length ? `<Connects>${connects.join('')}</Connects>` : ''}</PageContents>`;
}

/* ---------- Document et propriétés ---------- */
function documentXml() {
  const base = [cell('LineWeight', n6(PT_IN(0.75)), 'PT'), cell('LineColor', '#000000'), cell('LinePattern', 1), cell('Rounding', 0, 'MM'), cell('BeginArrow', 0), cell('EndArrow', 0), cell('LineCap', 0),
    cell('FillForegnd', '#ffffff'), cell('FillBkgnd', '#ffffff'), cell('FillPattern', 1), cell('ShdwPattern', 0),
    cell('LeftMargin', n6(PT_IN(2)), 'PT'), cell('RightMargin', n6(PT_IN(2)), 'PT'), cell('TopMargin', n6(PT_IN(2)), 'PT'), cell('BottomMargin', n6(PT_IN(2)), 'PT'), cell('VerticalAlign', 1)];
  const style0 = `<StyleSheet ID="0" NameU="No Style" IsCustomNameU="1" Name="No Style" IsCustomName="1">${base.join('')}${cell('LayerMember', '')}`
    + `<Section N="Character">${row('IX="0"', [cell('Size', n6(PT_IN(8)), 'PT'), cell('Color', '#000000'), cell('Style', 0)])}</Section>`
    + `<Section N="Paragraph">${row('IX="0"', [cell('HorzAlign', 1)])}</Section></StyleSheet>`;
  return XMLH + `<VisioDocument xmlns="${NS}" xmlns:r="${RNS}"><DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0"/><StyleSheets>${style0}</StyleSheets></VisioDocument>`;
}

/** Paquet .vsdx des vues (voir l'en-tête). */
export function writeVsdx(views, o = {}) {
  const names = views.props || {}, files = {}, overrides = [];
  const add = (path, ct, xml) => { files[path] = strToU8(xml); overrides.push(`<Override PartName="/${path}" ContentType="${ct}"/>`); };
  const relsXml = rels => XMLH + `<Relationships xmlns="${PKG_REL}">${rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${E(target)}"/>`).join('')}</Relationships>`;
  // Gabarits : ID à partir de 2 (le 0 et le 1 sont laissés libres).
  const masterIds = new Map(), mrels = [], mlist = [];
  views.masters.forEach((m, i) => {
    const id = i + 2, part = `master${i + 1}.xml`; masterIds.set(m.key, id);
    add(`visio/masters/${part}`, P.master.ct, masterXml(m, names)); mrels.push([`rId${i + 1}`, P.master.rel, part]);
    mlist.push(`<Master ID="${id}" NameU="${E(m.key)}" IsCustomNameU="1" Name="${E(m.name)}" IsCustomName="1" Prompt="" IconSize="1" AlignName="2" MatchByName="0" IconUpdate="1" UniqueID="${guid('u:' + m.key)}" BaseID="${guid('b:' + m.key)}" PatternFlags="0" Hidden="0"><PageSheet LineStyle="0" FillStyle="0" TextStyle="0">${cell('PageWidth', n6(MW), 'MM')}${cell('PageHeight', n6(MH), 'MM')}${cell('PageScale', n6(1 / UN.mmPerInch), 'MM')}${cell('DrawingScale', n6(1 / UN.mmPerInch), 'MM')}${cell('DrawingSizeType', 4)}${cell('DrawingScaleType', 0)}</PageSheet><Rel r:id="rId${i + 1}"/></Master>`);
  });
  const prels = [], plist = [];
  views.pages.forEach((pg, i) => {
    const part = `page${i + 1}.xml`, G = pageGeometry(pg);
    add(`visio/pages/${part}`, P.page.ct, pageXml(pg, masterIds, names)); prels.push([`rId${i + 1}`, P.page.rel, part]);
    plist.push(`<Page ID="${i}" NameU="${E(pg.name)}" IsCustomNameU="1" Name="${E(pg.name)}" IsCustomName="1" ViewScale="-1" ViewCenterX="${n6(G.W / 2)}" ViewCenterY="${n6(G.H / 2)}">${pageSheet(pg)}<Rel r:id="rId${i + 1}"/></Page>`);
  });
  add('visio/pages/pages.xml', P.pages.ct, XMLH + `<Pages xmlns="${NS}" xmlns:r="${RNS}">${plist.join('')}</Pages>`);
  files['visio/pages/_rels/pages.xml.rels'] = strToU8(relsXml(prels));
  const drels = [['rId1', P.pages.rel, 'pages/pages.xml']];
  if (mlist.length) {
    add('visio/masters/masters.xml', P.masters.ct, XMLH + `<Masters xmlns="${NS}" xmlns:r="${RNS}">${mlist.join('')}</Masters>`);
    files['visio/masters/_rels/masters.xml.rels'] = strToU8(relsXml(mrels));
    drels.push(['rId2', P.masters.rel, 'masters/masters.xml']);
  }
  add('visio/document.xml', P.document.ct, documentXml());
  files['visio/_rels/document.xml.rels'] = strToU8(relsXml(drels));
  const when = (o.date instanceof Date ? o.date : new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  add('docProps/core.xml', CORE_CT, XMLH + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${E(o.title || views.title || '')}</dc:title><dc:creator>${E(o.creator || '')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified></cp:coreProperties>`);
  add('docProps/app.xml', DP.app, XMLH + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Jollof Studio</Application>${o.company ? `<Company>${E(o.company)}</Company>` : ''}<Pages>${views.pages.length}</Pages></Properties>`);
  add('docProps/custom.xml', DP.custom, XMLH + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="${DP.fmtid}" pid="2" name="${DP.recalc}"><vt:bool>true</vt:bool></property></Properties>`);
  files['_rels/.rels'] = strToU8(relsXml([['rId1', P.document.rel, 'visio/document.xml'], ['rId2', CORE_REL, 'docProps/core.xml'], ['rId3', OD_REL + 'extended-properties', 'docProps/app.xml'], ['rId4', OD_REL + 'custom-properties', 'docProps/custom.xml']]));
  files['[Content_Types].xml'] = strToU8(XMLH + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join('')}</Types>`);
  // [Content_Types].xml et _rels/.rels en tête du zip (lus en premier par les lecteurs OPC).
  const order = ['[Content_Types].xml', '_rels/.rels', ...Object.keys(files).filter(k => k !== '[Content_Types].xml' && k !== '_rels/.rels')];
  const sorted = {}; for (const k of order) sorted[k] = [files[k], { level: 6, mtime: new Date('2026-01-01T00:00:00Z') }];
  return zipSync(sorted);
}

/* ---------- Lecture ---------- */
const relsOf = (files, part) => {
  const i = part.lastIndexOf('/'), path = (i < 0 ? '' : part.slice(0, i + 1)) + '_rels/' + part.slice(i + 1) + '.rels';
  if (!files[path]) return [];
  return kids(parseTree(strFromU8(files[path])), 'Relationship').map(r => ({ id: r.attrs.Id, type: r.attrs.Type, target: r.attrs.Target, mode: r.attrs.TargetMode || '' }));
};
const resolve = (from, target) => {
  if (target.startsWith('/')) return target.slice(1);
  const base = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '', out = [];
  for (const seg of (base + target).split('/')) { if (seg === '..') out.pop(); else if (seg !== '.' && seg !== '') out.push(seg); }
  return out.join('/');
};
const cellsOf = n => { const c = {}; for (const k of kids(n, 'Cell')) c[k.attrs.N] = { v: k.attrs.V, u: k.attrs.U || '', f: k.attrs.F || '' }; return c; };
const numOf = (c, k, d = 0) => (c[k] && c[k].v != null && c[k].v !== '' && Number.isFinite(+c[k].v) ? +c[k].v : d);
function sectionsOf(n) { const s = {}; for (const sec of kids(n, 'Section')) { (s[sec.attrs.N] = s[sec.attrs.N] || []).push(sec); } return s; }
/** Formule simple d'un gabarit (« Width*0.5 », « Height*1 ») évaluée pour une taille donnée, sinon la valeur. */
const relVal = (c, w, h) => { const m = /^(Width|Height)\*(-?[\d.]+)$/.exec(c.f || ''); return m ? (m[1] === 'Width' ? w : h) * +m[2] : +c.v || 0; };
function geomOf(n, w, h) {
  const rings = [];
  for (const sec of (sectionsOf(n).Geometry || [])) {
    const g = cellsOf(sec); if (g.NoShow && +g.NoShow.v) continue;
    const ring = { noFill: !!(g.NoFill && +g.NoFill.v), pts: [] };
    for (const r of kids(sec, 'Row')) {
      const c = cellsOf(r), t = r.attrs.T;
      if (t === 'Ellipse' && c.X && c.Y && c.A && c.B && c.C && c.D) ring.ellipse = { x: relVal(c.X, w, h), y: relVal(c.Y, w, h), a: relVal(c.A, w, h), b: relVal(c.B, w, h), c: relVal(c.C, w, h), d: relVal(c.D, w, h) };
      else if (c.X && c.Y) ring.pts.push({ t, x: relVal(c.X, w, h), y: relVal(c.Y, w, h) });
    }
    rings.push(ring);
  }
  return rings;
}
function shapeOf(n, masters) {
  const c = cellsOf(n), S = sectionsOf(n), m = n.attrs.Master ? masters.get(+n.attrs.Master) : null;
  const mc = m ? cellsOf(m.node) : {}, val = (k, d) => (c[k] ? numOf(c, k, d) : numOf(mc, k, d));
  const w = val('Width', 0), h = val('Height', 0);
  const props = {};
  const addProps = node => { for (const sec of (sectionsOf(node).Property || [])) for (const r of kids(sec, 'Row')) { const rc = cellsOf(r), k = r.attrs.N || 'Row' + r.attrs.IX; const o = props[k] || (props[k] = { label: '', value: '' }); if (rc.Label) o.label = rc.Label.v; if (rc.Value) o.value = rc.Value.v ?? ''; } };
  if (m) addProps(m.node); addProps(n);
  const lm = c.LayerMember ? String(c.LayerMember.v || '') : '';
  const own = geomOf(n, w, h);
  return {
    id: +n.attrs.ID, name: n.attrs.NameU || n.attrs.Name || '', master: m ? m.id : null, masterName: m ? m.name : '', type: n.attrs.Type || 'Shape',
    text: (() => { const t = kid(n, 'Text'); if (!t) return ''; return (t.text + t.children.map(x => x.text).join('')).replace(/\s+/g, ' ').trim(); })(),
    x: val('PinX', 0), y: val('PinY', 0), w, h, locX: val('LocPinX', w / 2), locY: val('LocPinY', h / 2), angle: val('Angle', 0),
    oneD: !!c.BeginX, begin: c.BeginX ? [numOf(c, 'BeginX'), numOf(c, 'BeginY')] : null, end: c.EndX ? [numOf(c, 'EndX'), numOf(c, 'EndY')] : null,
    glue: c.BeginX ? [c.BeginX.f, c.EndX ? c.EndX.f : ''] : null,
    txt: c.TxtPinX ? { x: numOf(c, 'TxtPinX'), y: numOf(c, 'TxtPinY'), w: numOf(c, 'TxtWidth'), h: numOf(c, 'TxtHeight'), lx: numOf(c, 'TxtLocPinX'), ly: numOf(c, 'TxtLocPinY') } : null,
    layers: lm === '' ? [] : lm.split(';').map(Number), props,
    geom: own.length ? own : m ? geomOf(m.node, w, h) : [],
    fill: (c.FillForegnd || mc.FillForegnd || {}).v || '', line: (c.LineColor || mc.LineColor || {}).v || '', linePattern: c.LinePattern ? numOf(c, 'LinePattern') : numOf(mc, 'LinePattern', 1),
    fillPattern: c.FillPattern ? numOf(c, 'FillPattern') : numOf(mc, 'FillPattern', 1), lineWeight: val('LineWeight', 0.01),
    font: (() => { const ch = (S.Character || [])[0] || ((sectionsOf(m ? m.node : { children: [] }).Character || [])[0]); const r = ch && kids(ch, 'Row')[0]; const rc = r ? cellsOf(r) : {}; return { size: numOf(rc, 'Size', 0.11), color: (rc.Color || {}).v || '#000000' }; })(),
    sections: Object.keys(S)
  };
}
/** Lecture d'un paquet .vsdx (voir l'en-tête) ; lève une erreur si ce n'est pas un dessin Visio. */
export function readVsdx(bytes) {
  let files;
  try { files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); } catch (e) { throw new Error('VSDX : archive zip illisible'); }
  const ctx = files['[Content_Types].xml']; if (!ctx) throw new Error('VSDX : [Content_Types].xml absent');
  const T = parseTree(strFromU8(ctx)), types = {}, defaults = {};
  for (const d of kids(T, 'Default')) defaults[(d.attrs.Extension || '').toLowerCase()] = d.attrs.ContentType;
  for (const ov of kids(T, 'Override')) types[(ov.attrs.PartName || '').replace(/^\//, '')] = ov.attrs.ContentType;
  const typeOf = p => types[p] || defaults[p.slice(p.lastIndexOf('.') + 1).toLowerCase()] || '';
  const rels = { '': relsOf(files, '') };
  const pkg = (files['_rels/.rels'] ? kids(parseTree(strFromU8(files['_rels/.rels'])), 'Relationship') : []).map(r => ({ id: r.attrs.Id, type: r.attrs.Type, target: r.attrs.Target }));
  rels[''] = pkg;
  const docRel = pkg.find(r => r.type === P.document.rel); if (!docRel) throw new Error('VSDX : pas de relation vers le document Visio');
  const docPart = resolve('', docRel.target);
  if (!files[docPart]) throw new Error('VSDX : document Visio absent');
  parseTree(strFromU8(files[docPart])); // forme
  rels[docPart] = relsOf(files, docPart);
  const masters = new Map(), mastersOut = [];
  const mRel = rels[docPart].find(r => r.type === P.masters.rel);
  if (mRel) {
    const mp = resolve(docPart, mRel.target), MT = parseTree(strFromU8(files[mp])); rels[mp] = relsOf(files, mp);
    for (const M of kids(MT, 'Master')) {
      const rel = kid(M, 'Rel'), r = rel && rels[mp].find(x => x.id === rel.attrs['r:id']); if (!r) continue;
      const part = resolve(mp, r.target); if (!files[part]) continue;
      const MC = parseTree(strFromU8(files[part])), sh = kid(kid(MC, 'Shapes'), 'Shape');
      const m = { id: +M.attrs.ID, name: M.attrs.NameU || M.attrs.Name || '', title: M.attrs.Name || '', node: sh || { children: [], attrs: {} }, part };
      masters.set(m.id, m); mastersOut.push({ id: m.id, name: m.name, title: m.title, part });
    }
  }
  const pages = [];
  const pRel = rels[docPart].find(r => r.type === P.pages.rel);
  if (pRel) {
    const pp = resolve(docPart, pRel.target), PG = parseTree(strFromU8(files[pp])); rels[pp] = relsOf(files, pp);
    for (const pg of kids(PG, 'Page')) {
      const rel = kid(pg, 'Rel'), r = rel && rels[pp].find(x => x.id === rel.attrs['r:id']); if (!r) continue;
      const part = resolve(pp, r.target); if (!files[part]) continue;
      const sheet = kid(pg, 'PageSheet'), sc = sheet ? cellsOf(sheet) : {};
      const layers = []; for (const sec of (sheet ? sectionsOf(sheet).Layer || [] : [])) for (const lr of kids(sec, 'Row')) { const c = cellsOf(lr); layers.push({ name: (c.Name || {}).v || '', key: (c.NameUniv || {}).v || '', color: (c.Color || {}).v }); }
      const PC = parseTree(strFromU8(files[part])), shapes = [];
      const walk = (node, depth) => { for (const s of kids(kid(node, 'Shapes'), 'Shape')) { const o = shapeOf(s, masters); o.depth = depth; shapes.push(o); if (depth < 8) walk(s, depth + 1); } };
      walk(PC, 0);
      const connects = kids(kid(PC, 'Connects'), 'Connect').map(c => ({ from: +c.attrs.FromSheet, fromCell: c.attrs.FromCell || '', fromPart: +c.attrs.FromPart, to: +c.attrs.ToSheet, toCell: c.attrs.ToCell || '', toPart: +c.attrs.ToPart }));
      const ps = numOf(sc, 'PageScale', 1), ds = numOf(sc, 'DrawingScale', 1);
      pages.push({ id: +pg.attrs.ID, name: pg.attrs.NameU || pg.attrs.Name || '', title: pg.attrs.Name || '', part, width: numOf(sc, 'PageWidth', 8.5), height: numOf(sc, 'PageHeight', 11), scale: ps > 0 ? ds / ps : 1, units: (sc.DrawingScale || {}).u || '', layers, shapes, connects });
    }
  }
  let custom = {};
  const cRel = pkg.find(r => r.type === OD_REL + 'custom-properties');
  if (cRel && files[resolve('', cRel.target)]) for (const p of kids(parseTree(strFromU8(files[resolve('', cRel.target)])), 'property')) custom[p.attrs.name] = (p.children[0] || {}).text || '';
  return { parts: Object.keys(files), types: Object.fromEntries(Object.keys(files).map(p => [p, typeOf(p)])), rels, pages, masters: mastersOut, props: { custom }, files };
}

/**
 * Contrôle d'intégrité d'un paquet lu : chaque partie XML bien formée, chaque partie a un type de contenu, chaque relation
 * mène à une partie présente, les parties Visio ont le type attendu, chaque Connect désigne des formes de la page (et un
 * connecteur 1-D), chaque forme d'équipement porte ses données. Rend la liste des défauts (vide : rien à redire).
 */
export function checkVsdx(r, o = {}) {
  const ours = o.ours !== false; // nos conventions (formules PAR(PNT(…)), donnée Label) : pas pour un fichier d'un autre outil
  const bad = [];
  for (const p of r.parts) {
    if (!r.types[p] && !p.endsWith('.rels')) bad.push(`partie sans type de contenu : ${p}`);
    if (/\.(xml|rels)$/.test(p)) { try { parseTree(strFromU8(r.files[p])); } catch (e) { bad.push(`${p} : ${e.message}`); } }
  }
  for (const [src, list] of Object.entries(r.rels)) for (const x of list) { if (x.mode === 'External') continue; const t = resolve(src, x.target); if (!r.files[t]) bad.push(`relation ${x.id} de « ${src || '/'} » vers une partie absente : ${t}`); }
  const want = { document: 'visio/document.xml', pages: 'visio/pages/pages.xml' };
  for (const [k, p] of Object.entries(want)) if (r.files[p] && r.types[p] !== P[k].ct) bad.push(`type de contenu de ${p} : ${r.types[p]}`);
  for (const pg of r.pages) {
    if (r.types[pg.part] !== P.page.ct) bad.push(`type de contenu de ${pg.part}`);
    const ids = new Map(); for (const s of pg.shapes) { if (ids.has(s.id)) bad.push(`${pg.name} : forme ${s.id} en double`); ids.set(s.id, s); }
    for (const c of pg.connects) {
      const a = ids.get(c.from), b = ids.get(c.to);
      if (!a) bad.push(`${pg.name} : Connect depuis une forme absente (${c.from})`); else if (!a.oneD) bad.push(`${pg.name} : Connect depuis une forme qui n'est pas un connecteur (${c.from})`);
      if (!b) bad.push(`${pg.name} : Connect vers une forme absente (${c.to})`);
      if (a && c.fromCell && !a.glue) bad.push(`${pg.name} : connecteur ${c.from} sans cellules BeginX/EndX`);
      if (ours && a && a.glue && !a.glue.some(f => f.includes(`Sheet.${c.to}!`))) bad.push(`${pg.name} : connecteur ${c.from} sans formule de collage vers ${c.to}`);
    }
    for (const s of pg.shapes) {
      if (s.layers.some(i => i < 0 || i >= pg.layers.length)) bad.push(`${pg.name} : forme ${s.id} sur un calque inexistant`);
      if (s.master != null && !r.masters.some(m => m.id === s.master)) bad.push(`${pg.name} : forme ${s.id} d'un gabarit absent (${s.master})`);
      if (ours && s.master != null && !(s.props.Label && 'value' in s.props.Label)) bad.push(`${pg.name} : forme ${s.id} sans donnée Label`);
    }
  }
  return bad;
}
