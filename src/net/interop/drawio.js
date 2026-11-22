// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Diagramme draw.io (.drawio, XML mxGraph non compressé) : écriture des vues du projet réseau (modèle neutre de
// diagram.js : un diagramme par vue, mêmes calques, formes et données que l'export Visio) et relecture (vérification).
// Module pur, sans interface. Écrit de zéro d'après la référence publique de JGraph : « .drawio file format » et
// « Style reference » (drawio.com/docs/reference), mxfile.xsd et xml-reference.md (dépôt jgraph/drawio-mcp, dossier
// shared) : <mxfile> → <diagram id name> (un onglet par page) → <mxGraphModel> → <root> ; cellules 0 (racine) et 1
// (calque par défaut, parent 0) obligatoires ; un calque est une cellule de parent 0 dont value est le nom ; formes
// vertex="1", liens edge="1" avec source et target ; <mxGeometry as="geometry"> (relative="1" pour un lien), points
// d'un lien dans <Array as="points">, extrémités libres en <mxPoint as="sourcePoint|targetPoint"> ; données dans un
// <object id label placeholders tooltip …> qui enveloppe la cellule (l'id passe à l'enveloppe) ; positions en px,
// x vers la droite, y vers le bas (850 × 1100 = US Letter, soit 100 px par pouce). Styles « clé=valeur; » : rounded,
// whiteSpace, html, fillColor, strokeColor, fontColor, fontSize, fontStyle (1 gras), align, verticalAlign, dashed,
// strokeWidth, rotation (degrés), horizontal=0 (texte vertical), ellipse, text, endArrow/startArrow, labelBackgroundColor, labelPosition,
// verticalLabelPosition, exitX/exitY/entryX/entryY.
// Ce que draw.io n'a pas : polygone quelconque rempli (pièce non rectangulaire → contour en lien à points, sans
// remplissage), échelle de dessin (les plans sont dessinés à l'échelle de la page Visio, indiquée dans le titre).
//
// writeDrawio(views, { date }) → texte ; readDrawio(texte) → { diagrams: [{ id, name, layers: [{ id, name }], cells:
//   [{ id, parent, value, style, vertex, edge, source, target, geo: { x, y, w, h, relative, points, sourcePoint,
//   targetPoint }, data: { attributs } }] }] } ; checkDrawio(lu) → [défauts].
import { NET } from '../limits.js';
import { PROP_KEYS } from './diagram.js';
import { parseTree, kids, kid, xmlEsc as E } from './xmltree.js';

const PX_IN = NET.DRAWIO_PX_PER_IN.v, ST = NET.DRAWIO_STRUCT.v;
const PER_IN = { px: 1 / PX_IN, mm: 1 / NET.VISIO_UNITS.v.mmPerInch, m: 1000 / NET.VISIO_UNITS.v.mmPerInch };
/** Noms des attributs de données (« label » est le texte affiché, « tags » est réservé) : clés du modèle → attributs. */
export const DATA_ATTR = { Label: 'Identifier', Type: 'Model', IP: 'IP', VLAN: 'VLAN', Rack: 'Rack', U: 'U', Category: 'Category', Length: 'Length_m', PortA: 'PortA', PortB: 'PortB' };
const r2 = v => { const r = Math.round(v * 100) / 100; return Object.is(r, -0) ? 0 : r; };
const html = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const col = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : c === 'none' ? 'none' : '#000000');
const styleStr = o => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => (v === true ? k : `${k}=${v}`)).join(';') + ';';
/** Points de sortie d'un équipement (comme les points de connexion Visio) : gauche, droite, haut, bas (y vers le bas). */
const SIDES = [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1]];

function shapeStyle(s, masters) {
  const m = s.master != null ? masters.get(s.master) : null, st = { ...((m && m.style) || {}), ...(s.style || {}) }, lwPx = pt => r2((pt ?? 0.75) * PX_IN / 72);
  if (s.geom === 'text') return styleStr({ text: true, html: 1, whiteSpace: 'wrap', align: st.align || 'center', verticalAlign: 'middle', fontSize: Math.round((st.font || 8) * PX_IN / 72), fontColor: col(st.ink || '#0f172a'), fontStyle: st.bold ? 1 : null, rotation: s.rot ? r2(s.rot) : null });
  const geom = (m && m.geom) || s.geom;
  return styleStr({
    ellipse: geom === 'ellipse' ? true : null, rounded: geom === 'rect' && m ? 1 : 0, whiteSpace: 'wrap', html: 1,
    fillColor: st.fill ? col(st.fill) : 'none', strokeColor: st.line ? col(st.line) : 'none', strokeWidth: lwPx(st.lw), dashed: st.dash ? 1 : null,
    fontSize: Math.round((st.font || 8) * PX_IN / 72), fontColor: col(st.ink || '#0f172a'), fontStyle: st.bold ? 1 : null,
    rotation: s.rot ? r2(s.rot) : null, horizontal: s.vtext ? 0 : null,
    ...(s.textOut ? { labelPosition: 'right', verticalLabelPosition: 'middle', align: 'left', verticalAlign: 'middle', spacingLeft: 2 } : {})
  });
}
function dataAttrs(props, tooltipNames) {
  if (!props) return '';
  const out = [], tip = [];
  for (const k of PROP_KEYS) { const v = props[k]; if (v == null || v === '') continue; out.push(` ${DATA_ATTR[k]}="${E(v)}"`); tip.push(`${tooltipNames[k] || k} : ${v}`); }
  return out.join('') + (tip.length ? ` tooltip="${E(tip.join('\n'))}"` : '');
}

function pageModel(pg, masters, names) {
  const k = PX_IN * (PER_IN[pg.unit] || PER_IN.px) / (pg.unit === 'px' ? 1 : pg.scale || 1); // px par unité de page (à l'échelle du papier)
  const b = pg.box, X = x => r2((x - b.x0) * k), Y = y => r2((y - b.y0) * k);
  const W = Math.max(1, Math.ceil((b.x1 - b.x0) * k)), H = Math.max(1, Math.ceil((b.y1 - b.y0) * k));
  const out = [`<mxCell id="${ST.root}"/>`], layerId = new Map(), cid = new Map();
  pg.layers.forEach((L, i) => { const id = i ? `L${i}` : ST.layer; layerId.set(L.key, id); out.push(`<mxCell id="${id}" value="${E(L.name)}" parent="${ST.root}"/>`); });
  const lay = keys => layerId.get((keys || [])[0]) || ST.layer;
  let n = 0; const nid = () => `c${++n}`;
  const wrap = (id, label, props, cellXml, extra = '') => (props && Object.keys(props).length
    ? `<object id="${id}" label="${E(html(label))}" placeholders="1"${extra}${dataAttrs(props, names)}>${cellXml}</object>`
    : cellXml.replace('<mxCell ', `<mxCell id="${id}" value="${E(html(label))}" `));
  for (const s of pg.shapes) {
    const id = nid(); cid.set(s.id, { id, s });
    const parent = lay(s.layers);
    if (s.geom === 'poly' || s.geom === 'line') {
      // Rectangle droit (pièce à 4 coins d'équerre) → forme remplie ; sinon contour en lien à points (pas de polygone rempli).
      const ring = s.geom === 'poly' ? s.rings[0] : null;
      const isRect = ring && ring.length === 4 && !(s.rings.length > 1) && ring.every((p, i) => { const q = ring[(i + 1) % 4]; return Math.abs(p[0] - q[0]) < 1e-6 || Math.abs(p[1] - q[1]) < 1e-6; });
      if (isRect) {
        out.push(wrap(id, s.text || '', s.props, `<mxCell style="${E(shapeStyle({ ...s, geom: 'rect' }, masters))}" vertex="1" parent="${parent}"><mxGeometry x="${X(s.x)}" y="${Y(s.y)}" width="${r2(s.w * k)}" height="${r2(s.h * k)}" as="geometry"/></mxCell>`));
        continue;
      }
      const lines = s.geom === 'poly' ? s.rings.map(r => [...r, r[0]]) : [s.pts];
      lines.forEach((pts, li) => {
        const lid = li ? nid() : id, st = s.style || {};
        const style = styleStr({ endArrow: 'none', startArrow: 'none', html: 1, rounded: 0, strokeColor: col(st.line || '#334155'), strokeWidth: r2((st.lw ?? 0.75) * PX_IN / 72), dashed: st.dash ? 1 : null });
        const mid = pts.slice(1, -1).map(p => `<mxPoint x="${X(p[0])}" y="${Y(p[1])}"/>`).join('');
        const cell = `<mxCell style="${E(style)}" edge="1" parent="${parent}"><mxGeometry relative="1" as="geometry"><mxPoint x="${X(pts[0][0])}" y="${Y(pts[0][1])}" as="sourcePoint"/><mxPoint x="${X(pts[pts.length - 1][0])}" y="${Y(pts[pts.length - 1][1])}" as="targetPoint"/>${mid ? `<Array as="points">${mid}</Array>` : ''}</mxGeometry></mxCell>`;
        out.push(li ? cell.replace('<mxCell ', `<mxCell id="${lid}" value="" `) : wrap(id, '', s.props, cell));
      });
      continue;
    }
    out.push(wrap(id, s.text || '', s.props, `<mxCell style="${E(shapeStyle(s, masters))}" vertex="1" parent="${parent}"><mxGeometry x="${X(s.x)}" y="${Y(s.y)}" width="${r2(Math.max(0.5, s.w * k))}" height="${r2(Math.max(0.5, s.h * k))}" as="geometry"/></mxCell>`));
  }
  for (const e of pg.edges) {
    const A = cid.get(e.from), B = cid.get(e.to); if (!A || !B) continue;
    const ca = [A.s.x + A.s.w / 2, A.s.y + A.s.h / 2], cb = [B.s.x + B.s.w / 2, B.s.y + B.s.h / 2];
    const side = (P, Q, s) => (Math.abs(Q[0] - P[0]) / Math.max(s.w, 1e-6) >= Math.abs(Q[1] - P[1]) / Math.max(s.h, 1e-6) ? (Q[0] >= P[0] ? 1 : 0) : (Q[1] >= P[1] ? 3 : 2));
    const sa = SIDES[side(ca, cb, A.s)], sb = SIDES[side(cb, ca, B.s)], st = e.style || {};
    const style = styleStr({ endArrow: 'none', startArrow: 'none', html: 1, rounded: 0, exitX: sa[0], exitY: sa[1], entryX: sb[0], entryY: sb[1], strokeColor: col(st.line || '#334155'), strokeWidth: r2((st.lw ?? 0.75) * PX_IN / 72), dashed: st.dash ? 1 : null, fontSize: Math.round((st.font || 6) * PX_IN / 72), fontColor: col(st.ink || '#334155'), labelBackgroundColor: '#ffffff' });
    out.push(wrap(nid(), e.text || '', e.props, `<mxCell style="${E(style)}" edge="1" parent="${lay(e.layers)}" source="${A.id}" target="${B.id}"><mxGeometry relative="1" as="geometry"/></mxCell>`));
  }
  return { xml: `<mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${W}" pageHeight="${H}" math="0" shadow="0"><root>${out.join('')}</root></mxGraphModel>`, k };
}

/** Fichier .drawio des vues (voir l'en-tête). */
export function writeDrawio(views, o = {}) {
  const masters = new Map(views.masters.map(m => [m.key, m])), names = views.props || {};
  const when = (o.date instanceof Date ? o.date : new Date()).toISOString();
  const diagrams = views.pages.map((pg, i) => `<diagram id="${E('jollof-' + (i + 1) + '-' + pg.key.replace(/[^\w:-]/g, '_'))}" name="${E(pg.name)}">${pageModel(pg, masters, names).xml}</diagram>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="Jollof Studio" modified="${when}" agent="Jollof Studio" compressed="false" pages="${views.pages.length}">${diagrams.join('')}</mxfile>\n`;
}

/* ---------- Lecture ---------- */
function cellOf(node, wrapper) {
  const a = node.attrs, g = kid(node, 'mxGeometry'), geo = g ? { x: +(g.attrs.x || 0), y: +(g.attrs.y || 0), w: +(g.attrs.width || 0), h: +(g.attrs.height || 0), relative: g.attrs.relative === '1' } : null;
  if (g) {
    for (const p of kids(g, 'mxPoint')) if (p.attrs.as === 'sourcePoint' || p.attrs.as === 'targetPoint') geo[p.attrs.as] = [+(p.attrs.x || 0), +(p.attrs.y || 0)];
    const arr = kids(g, 'Array').find(x => x.attrs.as === 'points'); if (arr) geo.points = kids(arr, 'mxPoint').map(p => [+(p.attrs.x || 0), +(p.attrs.y || 0)]);
  }
  const data = {}; if (wrapper) for (const [k, v] of Object.entries(wrapper.attrs)) if (k !== 'id' && k !== 'label') data[k] = v;
  return { id: wrapper ? wrapper.attrs.id : a.id, parent: a.parent ?? null, value: wrapper ? wrapper.attrs.label ?? '' : a.value ?? '', style: a.style || '', vertex: a.vertex === '1', edge: a.edge === '1', source: a.source || null, target: a.target || null, visible: a.visible !== '0', geo, data, wrapped: !!wrapper, innerId: wrapper ? a.id || null : null };
}
/** Lecture d'un fichier .drawio non compressé ; lève une erreur si le fichier est compressé ou mal formé. */
export function readDrawio(text) {
  const T = parseTree(String(text));
  const ds = T.tag === 'mxfile' ? kids(T, 'diagram') : T.tag === 'mxGraphModel' ? [{ attrs: { id: 'd1', name: '' }, children: [T] }] : null;
  if (!ds) throw new Error('draw.io : racine <mxfile> attendue');
  return {
    host: T.attrs.host || '', compressed: T.attrs.compressed || '',
    diagrams: ds.map(d => {
      const M = kid(d, 'mxGraphModel'); if (!M) throw new Error('draw.io : diagramme compressé ou vide (non pris en charge)');
      const cells = [];
      for (const c of kid(M, 'root') ? kid(M, 'root').children : []) {
        if (c.tag === 'mxCell') cells.push(cellOf(c, null));
        else if (c.tag === 'object' || c.tag === 'UserObject') { const inner = kid(c, 'mxCell'); if (inner) cells.push(cellOf(inner, c)); }
      }
      const layers = cells.filter(c => c.parent === ST.root).map(c => ({ id: c.id, name: c.value }));
      return { id: d.attrs.id || '', name: d.attrs.name || '', page: { w: +(M.attrs.pageWidth || 0), h: +(M.attrs.pageHeight || 0) }, layers, cells };
    })
  };
}
/** Défauts de structure (référence du format) : racine 0, calques de parent 0, ids uniques, parents, source et target présents. */
export function checkDrawio(r) {
  const bad = [], seenD = new Set();
  for (const d of r.diagrams) {
    if (!d.id || seenD.has(d.id)) bad.push(`diagramme sans id unique : « ${d.name} »`); seenD.add(d.id);
    const by = new Map();
    for (const c of d.cells) { if (!c.id) bad.push(`${d.name} : cellule sans id`); else if (by.has(c.id)) bad.push(`${d.name} : id en double ${c.id}`); by.set(c.id, c); if (c.wrapped && c.innerId) bad.push(`${d.name} : id dans la cellule enveloppée ${c.id}`); }
    const root = by.get(ST.root); if (!root || root.parent != null) bad.push(`${d.name} : cellule racine 0 absente`);
    if (!d.layers.length) bad.push(`${d.name} : aucun calque`);
    for (const c of d.cells) {
      if (c.id === ST.root) continue;
      if (c.parent == null || !by.has(c.parent)) bad.push(`${d.name} : parent absent pour ${c.id}`);
      if (c.vertex && c.edge) bad.push(`${d.name} : ${c.id} à la fois forme et lien`);
      if ((c.vertex || c.edge) && !c.geo) bad.push(`${d.name} : ${c.id} sans géométrie`);
      if (c.edge) {
        for (const k of ['source', 'target']) if (c[k] && !(by.get(c[k]) || {}).vertex) bad.push(`${d.name} : lien ${c.id}, ${k} ${c[k]} n'est pas une forme`);
        if (!c.source && !(c.geo && c.geo.sourcePoint)) bad.push(`${d.name} : lien ${c.id} sans départ`);
        if (!c.target && !(c.geo && c.geo.targetPoint)) bad.push(`${d.name} : lien ${c.id} sans arrivée`);
        if (c.geo && !c.geo.relative) bad.push(`${d.name} : lien ${c.id} sans géométrie relative`);
      }
      if (c.style && !/^([^;=]+(=[^;]*)?;)*$/.test(c.style)) bad.push(`${d.name} : style mal formé pour ${c.id}`);
    }
  }
  return bad;
}
