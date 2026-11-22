// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Lecture d'un fichier IFC (STEP .ifc, schémas IFC4 et IFC2X3) pour le plan réseau : structure spatiale (projet, site,
// bâtiments, étages), pièces, murs, portes, et les objets de réseau (équipements de communication, prises, chemins de
// câbles, câbles) avec leurs jeux de propriétés. Module pur : readIfc(source) → modèle lu ; applyIfc(data, modèle,
// choix, { newDevice }) le verse dans le projet (avant l'unique ctx.commit() de l'assistant).
//
// Ce qui est lu (attributs par leur rang dans IFC4.exp et IFC2X3_TC1.exp, identiques pour tout ce qui sert ici) :
// - unités : IfcUnitAssignment → LENGTHUNIT en IfcSIUnit (préfixes MILLI, CENTI, DECI, KILO…) ou IfcConversionBasedUnit
//   (FOOT, INCH… : facteur de IfcMeasureWithUnit, sinon d'après le nom) ; mètre par défaut (signalé) ;
// - placements : chaînes IfcLocalPlacement / IfcAxis2Placement3D (Axis, RefDirection) ; IfcGridPlacement non suivi ;
// - structure : IfcRelAggregates (projet → site → bâtiment → étages → pièces), IfcRelContainedInSpatialStructure ;
// - étage : Name, Elevation (sinon la hauteur de son placement), hauteur d'étage = écart avec l'étage suivant ;
// - pièce (IfcSpace) : Name, LongName ; contour d'un IfcExtrudedAreaSolid (IfcArbitraryClosedProfileDef, …WithVoids,
//   IfcRectangleProfileDef, IfcCircleProfileDef ; courbes IfcPolyline, IfcIndexedPolyCurve, IfcCompositeCurve,
//   IfcTrimmedCurve par leurs points), au travers de IfcBooleanClippingResult et IfcMappedItem ; sinon une
//   représentation « FootPrint » ; sinon le rectangle englobant de sa géométrie (IfcBoundingBox ou ses points) ;
// - mur (IfcWall, IfcWallStandardCase) : axe d'une représentation « Axis » (polyligne : un mur par segment), sinon le
//   grand côté de son corps extrudé ; épaisseur d'IfcMaterialLayerSetUsage / IfcMaterialLayerSet (somme des couches),
//   sinon du corps ; matériau (nom → nos matériaux par mots-clés) ;
// - porte (IfcDoor) : OverallWidth, place sur son mur par IfcRelFillsElement → IfcOpeningElement → IfcRelVoidsElement
//   (sinon le mur le plus proche) ;
// - réseau : IfcCommunicationsAppliance, IfcOutlet, IfcCableCarrierSegment, IfcCableSegment, IfcDistributionSystem,
//   jeux de propriétés (IfcRelDefinesByProperties → IfcPropertySet → IfcPropertySingleValue).
// Repère : celui de chaque bâtiment (sa rotation retirée), x → x du plan, Y → −y du plan (y vers le bas), mètres ; si le
// bâtiment sort du premier quadrant, il est décalé (shift) pour commencer à 1 m de l'origine.
import { stepIndex } from './step.js';
import { uid, siteIds, polyArea, MATERIALS, USAGES } from '../site.js';
import { PATH_KINDS } from '../route.js';
import { DEVICES } from '../devices.js';
import { IFC_LIM } from '../lim/ifc.js';

/** Schémas lus. */
export const IFC_READ_SCHEMAS = IFC_LIM.IFC_SCHEMAS.v.read;
/** Préfixes SI (IfcSIPrefix). */
const SI_PREFIX = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 10, DECI: 0.1, CENTI: 0.01, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9 };
/** Unités de longueur par conversion, par nom (quand le facteur manque). */
const CONV_NAMES = { FOOT: 0.3048, FEET: 0.3048, FT: 0.3048, INCH: 0.0254, IN: 0.0254, YARD: 0.9144, MILE: 1609.344 };

/* ---------- Petite géométrie : repère = [ax, ay, az, bx, by, bz, cx, cy, cz, tx, ty, tz] (axes X, Y, Z, origine) ---------- */
const ID = () => [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const apply = (M, p) => [M[9] + M[0] * p[0] + M[3] * p[1] + M[6] * (p[2] || 0), M[10] + M[1] * p[0] + M[4] * p[1] + M[7] * (p[2] || 0), M[11] + M[2] * p[0] + M[5] * p[1] + M[8] * (p[2] || 0)];
const applyV = (M, v) => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];
/** M1 ∘ M2 : d'abord M2, puis M1. */
function mul(A, B) {
  const a = applyV(A, [B[0], B[1], B[2]]), b = applyV(A, [B[3], B[4], B[5]]), c = applyV(A, [B[6], B[7], B[8]]), t = apply(A, [B[9], B[10], B[11]]);
  return [...a, ...b, ...c, ...t];
}
/** Inverse d'un repère orthonormé. */
function inv(M) {
  const t = [M[9], M[10], M[11]], R = [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];
  const ti = [-(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]), -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]), -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2])];
  return [...R, ...ti];
}
const norm3 = v => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const r3 = v => Math.round(v * 1000) / 1000;
const lower = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Valeur d'une propriété (valeur typée → sa valeur ; énumération → son nom ; .T./.F. → booléen). */
function plain(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') {
    if ('t' in v) return plain(v.v);
    if ('e' in v) return v.e === 'T' ? true : v.e === 'F' ? false : v.e === 'U' ? null : v.e;
    if ('r' in v) return null;
    if ('int' in v) return v.int;
    return null;
  }
  return v;
}

/**
 * Lit un fichier IFC (texte ou octets). Rend { schema, supported, header, units, project, site, buildings: [{ key, gid,
 * name, shift: [dx, dy], storeys: [{ key, gid, name, elev, height, level, spaces, walls, doors, devices, carriers,
 * cables, counts }] }], systems, stats: { entities, ms, byType }, warnings: [{ code, n?, text? }] }. Coordonnées en
 * mètres, repère du plan (y vers le bas). Lève une erreur si le fichier n'est pas du STEP.
 */
export function readIfc(src, o = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const X = stepIndex(src, o);
  const schema = (X.schema[0] || '').toUpperCase().replace(/_.*$/, '');
  const warn = new Map(), W = (code, text) => { const w = warn.get(code) || { code, n: 0 }; w.n++; if (text && !w.text) w.text = text; warn.set(code, w); };
  if (!/^IFC/.test(schema)) throw new Error('not-ifc');
  if (!IFC_READ_SCHEMAS.includes(schema)) W('schema', schema);
  const g = id => X.get(id), A = (e, i) => (e && e.args ? e.args[i] : null);
  const name = e => { const v = A(e, 2); return typeof v === 'string' ? v : ''; };
  const gid = e => { const v = A(e, 0); return typeof v === 'string' ? v : ''; };
  const ofType = (...t) => X.ofType(...t);
  const isA = (e, ...t) => !!e && t.includes(e.type);

  /* ---------- Unités ---------- */
  let L = 1, lenName = 'METRE', lenKind = 'default';
  const siFactor = u => { const pre = A(u, 2); return (pre && pre.e && SI_PREFIX[pre.e]) || 1; };
  function lengthOf(u, depth = 0) {
    if (!u || depth > 4) return null;
    if (u.type === 'IFCSIUNIT') { const n = A(u, 3); if (n && n.e === 'METRE') return { f: siFactor(u), name: ((A(u, 2) || {}).e || '') + 'METRE', kind: 'si' }; return null; }
    if (u.type === 'IFCCONVERSIONBASEDUNIT' || u.type === 'IFCCONVERSIONBASEDUNITWITHOFFSET') {
      const nm = String(A(u, 2) || '').toUpperCase(), mwu = g(A(u, 3));
      let f = null;
      if (mwu) { const v = plain(A(mwu, 0)), base = lengthOf(g(A(mwu, 1)), depth + 1); if (Number.isFinite(+v) && +v > 0) f = +v * (base ? base.f : 1); }
      if (!f) f = CONV_NAMES[nm.replace(/S$/, '')] || CONV_NAMES[nm] || null;
      return f ? { f, name: nm || 'CONVERSION', kind: 'conversion' } : null;
    }
    return null;
  }
  const projE = g(ofType('IFCPROJECT')[0]);
  {
    const uaId = projE ? A(projE, 8) : null, ua = uaId ? g(uaId) : g(ofType('IFCUNITASSIGNMENT')[0]);
    for (const u of (ua && A(ua, 0)) || []) {
      const e = g(u); if (!e) continue;
      const ty = A(e, 1);
      if (ty && ty.e === 'LENGTHUNIT') { const l = lengthOf(e); if (l) { L = l.f; lenName = l.name; lenKind = l.kind; } }
    }
    if (lenKind === 'default') W('noUnits');
  }
  const len = v => (Number.isFinite(+v) ? +v * L : null);

  /* ---------- Placements ---------- */
  const pt = id => { const e = g(id); const c = e && A(e, 0); return Array.isArray(c) ? [len(c[0]) || 0, len(c[1]) || 0, len(c[2] || 0) || 0] : [0, 0, 0]; };
  const dir = id => { const e = g(id); const c = e && A(e, 0); return Array.isArray(c) ? [+c[0] || 0, +c[1] || 0, +c[2] || 0] : null; };
  /** IfcAxis2Placement3D / 2D → repère. */
  function axisM(id) {
    const e = g(id); if (!e) return ID();
    const loc = pt(A(e, 0));
    if (e.type === 'IFCAXIS2PLACEMENT2D') { const x = norm3(dir(A(e, 1)) || [1, 0, 0]); return [x[0], x[1], 0, -x[1], x[0], 0, 0, 0, 1, loc[0], loc[1], 0]; }
    if (e.type !== 'IFCAXIS2PLACEMENT3D') return [1, 0, 0, 0, 1, 0, 0, 0, 1, ...loc];
    const z = norm3(dir(A(e, 1)) || [0, 0, 1]); let x = dir(A(e, 2)) || (Math.abs(z[2]) > 0.99 ? [1, 0, 0] : [0, 0, 1]);
    x = norm3([x[0] - dot(x, z) * z[0], x[1] - dot(x, z) * z[1], x[2] - dot(x, z) * z[2]]);
    const y = cross(z, x);
    return [...x, ...y, ...z, ...loc];
  }
  const plCache = new Map();
  /** Repère monde d'un IfcObjectPlacement. */
  function placeM(id, depth = 0) {
    if (id == null) return ID();
    const key = id.r ?? id; if (plCache.has(key)) return plCache.get(key);
    const e = g(id); let M = ID();
    if (e && e.type === 'IFCLOCALPLACEMENT' && depth < 40) M = mul(A(e, 0) ? placeM(A(e, 0), depth + 1) : ID(), axisM(A(e, 1)));
    else if (e && e.type === 'IFCGRIDPLACEMENT') W('grid');
    plCache.set(key, M); return M;
  }
  const productM = e => placeM(A(e, 5));

  /* ---------- Courbes et profils (repère local, 2D) ---------- */
  function curvePts(id, depth = 0) {
    const e = g(id); if (!e || depth > 8) return [];
    switch (e.type) {
      case 'IFCPOLYLINE': return (A(e, 0) || []).map(pt);
      case 'IFCINDEXEDPOLYCURVE': {
        const pl = g(A(e, 0)), coords = ((pl && A(pl, 0)) || []).map(c => [len(c[0]) || 0, len(c[1]) || 0, len(c[2] || 0) || 0]), segs = A(e, 1);
        if (!Array.isArray(segs)) return coords;
        const out = []; for (const s of segs) { const ix = Array.isArray(s && s.v) ? s.v : [s && s.v]; for (const i of ix.flat()) { const q = coords[(+i || 1) - 1]; if (q && (!out.length || out[out.length - 1] !== q)) out.push(q); } }
        return out;
      }
      case 'IFCCOMPOSITECURVE': case 'IFCCOMPOSITECURVEONSURFACE': {
        const out = []; for (const s of A(e, 0) || []) { const se = g(s); if (!se) continue; let p = curvePts(A(se, 2), depth + 1); const same = A(se, 1); if (same && same.e === 'F') p = p.slice().reverse(); for (const q of p) if (!out.length || Math.hypot(q[0] - out[out.length - 1][0], q[1] - out[out.length - 1][1]) > 1e-9) out.push(q); }
        return out;
      }
      case 'IFCTRIMMEDCURVE': {
        const trim = t => { for (const x of t || []) { if (x && x.r) { const p = g(x); if (p && p.type === 'IFCCARTESIANPOINT') return pt(x); } } return null; };
        const a = trim(A(e, 1)), b = trim(A(e, 2)), sense = A(e, 3);
        if (a && b) return sense && sense.e === 'F' ? [b, a] : [a, b];
        return curvePts(A(e, 0), depth + 1);
      }
      case 'IFCCIRCLE': { const M = axisM(A(e, 0)), r = len(A(e, 1)) || 0; return Array.from({ length: 24 }, (_, i) => apply(M, [r * Math.cos(i * Math.PI / 12), r * Math.sin(i * Math.PI / 12), 0])); }
      default: return [];
    }
  }
  /** Profil → { outer: [[x, y]…], holes: [[[x, y]…]…] } dans son repère. */
  function profile(id) {
    const e = g(id); if (!e) return null;
    const ring = ps => { const r = ps.map(q => [q[0], q[1]]); if (r.length > 2 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 1e-9) r.pop(); return r; };
    if (e.type === 'IFCARBITRARYCLOSEDPROFILEDEF') return { outer: ring(curvePts(A(e, 2))), holes: [] };
    if (e.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS') return { outer: ring(curvePts(A(e, 2))), holes: (A(e, 3) || []).map(c => ring(curvePts(c))).filter(r => r.length >= 3) };
    if (/^IFC(ROUNDED)?RECTANGLE(HOLLOW)?PROFILEDEF$/.test(e.type)) {
      const M = A(e, 2) ? axisM(A(e, 2)) : ID(), x = (len(A(e, 3)) || 0) / 2, y = (len(A(e, 4)) || 0) / 2;
      return { outer: [[-x, -y], [x, -y], [x, y], [-x, y]].map(q => apply(M, [q[0], q[1], 0]).slice(0, 2)), holes: [], rect: [2 * x, 2 * y], M };
    }
    if (e.type === 'IFCCIRCLEPROFILEDEF' || e.type === 'IFCCIRCLEHOLLOWPROFILEDEF') {
      const M = A(e, 2) ? axisM(A(e, 2)) : ID(), r = len(A(e, 3)) || 0;
      return { outer: Array.from({ length: 24 }, (_, i) => apply(M, [r * Math.cos(i * Math.PI / 12), r * Math.sin(i * Math.PI / 12), 0]).slice(0, 2)), holes: [], circle: r };
    }
    return null;
  }

  /* ---------- Représentations : solides extrudés, courbes, points ---------- */
  function reps(e) {
    const ps = g(A(e, 6)); if (!ps) return [];
    return ((A(ps, 2)) || []).map(g).filter(Boolean).map(r => ({ ident: String(A(r, 1) || ''), type: String(A(r, 2) || ''), items: A(r, 3) || [] }));
  }
  /** Éléments géométriques d'une représentation, dans le repère M : [{ kind: 'extrusion', poly, holes, z0, z1, dirW, depth, M, prof } | { kind: 'curve', pts } | { kind: 'points', pts }]. */
  function items(list, M, out = [], depth = 0) {
    for (const it of list) {
      const e = g(it); if (!e || depth > 6) continue;
      if (e.type === 'IFCEXTRUDEDAREASOLID' || e.type === 'IFCEXTRUDEDAREASOLIDTAPERED') {
        const P = mul(M, A(e, 1) ? axisM(A(e, 1)) : ID()), pr = profile(A(e, 0)); if (!pr || pr.outer.length < 2) continue;
        const d = norm3(dir(A(e, 2)) || [0, 0, 1]), depthV = len(A(e, 3)) || 0, dw = applyV(P, d);
        const base = pr.outer.map(q => apply(P, [q[0], q[1], 0])), holes = pr.holes.map(h => h.map(q => apply(P, [q[0], q[1], 0])));
        const zs = base.map(q => q[2]), z0 = Math.min(...zs), z1 = Math.max(...zs.map(z => z + dw[2] * depthV));
        out.push({ kind: 'extrusion', poly: base, holes, z0: Math.min(z0, z1), z1: Math.max(z0, z1, z0 + dw[2] * depthV), depth: depthV, dirW: dw, M: P, prof: pr });
      } else if (e.type === 'IFCBOOLEANCLIPPINGRESULT' || e.type === 'IFCBOOLEANRESULT') {
        items([A(e, 1)], M, out, depth + 1);
      } else if (e.type === 'IFCMAPPEDITEM') {
        const map = g(A(e, 0)), op = g(A(e, 1)); if (!map) continue;
        const origin = axisM(A(map, 0)), rep = g(A(map, 1));
        let T = ID();
        if (op && /^IFCCARTESIANTRANSFORMATIONOPERATOR3D/.test(op.type)) {
          const x = norm3(dir(A(op, 0)) || [1, 0, 0]), z0 = dir(A(op, 4)) || [0, 0, 1], y0 = dir(A(op, 1));
          const z = norm3(z0), y = y0 ? norm3(y0) : cross(z, x), s = Number.isFinite(+A(op, 3)) ? +A(op, 3) : 1;
          T = [...x.map(v => v * s), ...y.map(v => v * s), ...z.map(v => v * s), ...pt(A(op, 2))];
        }
        if (rep) items(A(rep, 3) || [], mul(M, mul(T, origin)), out, depth + 1);
      } else if (e.type === 'IFCPOLYLINE' || e.type === 'IFCINDEXEDPOLYCURVE' || e.type === 'IFCCOMPOSITECURVE' || e.type === 'IFCTRIMMEDCURVE') {
        out.push({ kind: 'curve', pts: curvePts(it).map(q => apply(M, q)) });
      } else if (e.type === 'IFCGEOMETRICCURVESET' || e.type === 'IFCGEOMETRICSET') {
        items(A(e, 0) || [], M, out, depth + 1);
      } else if (e.type === 'IFCBOUNDINGBOX') {
        const c = pt(A(e, 0)), x = len(A(e, 1)) || 0, y = len(A(e, 2)) || 0, z = len(A(e, 3)) || 0;
        out.push({ kind: 'points', pts: [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, y, z]].map(q => apply(M, [c[0] + q[0], c[1] + q[1], c[2] + q[2]])) });
      } else {
        const pts = []; collectPts(it, pts, new Set(), 0);
        if (pts.length) out.push({ kind: 'points', pts: pts.map(q => apply(M, q)) });
      }
    }
    return out;
  }
  /** Tous les points d'une géométrie quelconque (B-rep, maillage…), pour son rectangle englobant. */
  function collectPts(id, out, seen, depth) {
    const k = id && id.r; if (!k || seen.has(k) || depth > 12 || out.length > 50000) return;
    seen.add(k); const e = g(id); if (!e) return;
    if (e.type === 'IFCCARTESIANPOINT') { out.push(pt(id)); return; }
    if (e.type === 'IFCCARTESIANPOINTLIST3D' || e.type === 'IFCCARTESIANPOINTLIST2D') { for (const c of A(e, 0) || []) out.push([len(c[0]) || 0, len(c[1]) || 0, len(c[2] || 0) || 0]); return; }
    const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && v.r) collectPts(v, out, seen, depth + 1); };
    walk(e.args);
  }
  /** Géométrie d'un produit dans le repère monde : { body: [...], axis: [...], foot: [...], all: [...] }. */
  function geomOf(e) {
    const M = productM(e), out = { M, body: [], axis: [], foot: [], box: [], all: [] };
    for (const r of reps(e)) {
      const its = items(r.items, M), id = r.ident.toLowerCase();
      if (id === 'axis') out.axis.push(...its); else if (id === 'footprint') out.foot.push(...its); else if (id === 'box') out.box.push(...its); else out.body.push(...its);
      out.all.push(...its);
    }
    return out;
  }

  /* ---------- Relations ---------- */
  const children = new Map(), containedIn = new Map(), elementsOf = new Map();
  for (const id of ofType('IFCRELAGGREGATES', 'IFCRELNESTS')) {
    const r = g(id); if (!r || r.type === 'IFCRELNESTS') continue;
    const parent = A(r, 4) && A(r, 4).r; if (!parent) continue;
    const l = children.get(parent) || []; for (const c of A(r, 5) || []) if (c && c.r) l.push(c.r); children.set(parent, l);
  }
  for (const id of ofType('IFCRELCONTAINEDINSPATIALSTRUCTURE')) {
    const r = g(id), s = A(r, 5) && A(r, 5).r; if (!s) continue;
    const l = elementsOf.get(s) || [];
    for (const c of A(r, 4) || []) if (c && c.r) { l.push(c.r); containedIn.set(c.r, s); }
    elementsOf.set(s, l);
  }
  const fills = new Map(), voids = new Map(); // porte → ouverture ; ouverture → mur
  for (const id of ofType('IFCRELFILLSELEMENT')) { const r = g(id); if (A(r, 4) && A(r, 5)) fills.set(A(r, 5).r, A(r, 4).r); }
  for (const id of ofType('IFCRELVOIDSELEMENT')) { const r = g(id); if (A(r, 4) && A(r, 5)) voids.set(A(r, 5).r, A(r, 4).r); }
  const matOf = new Map(), typeOf = new Map();
  for (const id of ofType('IFCRELASSOCIATESMATERIAL')) { const r = g(id); for (const o of A(r, 4) || []) if (o && o.r) matOf.set(o.r, A(r, 5)); }
  for (const id of ofType('IFCRELDEFINESBYTYPE')) { const r = g(id); for (const o of A(r, 4) || []) if (o && o.r) typeOf.set(o.r, A(r, 5)); }
  const psetRel = new Map();
  for (const id of ofType('IFCRELDEFINESBYPROPERTIES')) { const r = g(id); const def = A(r, 5); for (const o of A(r, 4) || []) if (o && o.r) { const l = psetRel.get(o.r) || []; l.push(def); psetRel.set(o.r, l); } }
  /** Jeux de propriétés d'un objet : { NomDuJeu: { Propriété: valeur } } (longueurs non converties : voir lenProp). */
  function psetsOf(id) {
    const out = {};
    for (const d of psetRel.get(id) || []) {
      const ps = g(d); if (!ps || ps.type !== 'IFCPROPERTYSET') continue;
      const o = out[String(A(ps, 2) || '')] = {};
      for (const p of A(ps, 4) || []) { const e = g(p); if (e && e.type === 'IFCPROPERTYSINGLEVALUE') { const v = A(e, 2); o[String(A(e, 0) || '')] = { v: plain(v), t: v && v.t ? v.t : null }; } }
    }
    const flat = {}; for (const [k, o] of Object.entries(out)) { flat[k] = {}; for (const [n, x] of Object.entries(o)) flat[k][n] = /LENGTHMEASURE$/.test(x.t || '') && Number.isFinite(+x.v) ? r3(+x.v * L) : x.v; }
    return flat;
  }

  /* ---------- Matériau d'un mur ---------- */
  function material(id) {
    let m = matOf.get(id); if (!m && typeOf.get(id)) m = matOf.get(typeOf.get(id).r);
    const e = m && g(m); if (!e) return null;
    const layers = s => { const ls = (A(s, 0) || []).map(g).filter(Boolean); return { t: ls.reduce((a, l) => a + (len(A(l, 1)) || 0), 0), names: ls.map(l => { const mt = g(A(l, 0)); return mt ? String(A(mt, 0) || '') : String(A(l, 3) || ''); }).filter(Boolean), setName: String(A(s, 1) || '') }; };
    if (e.type === 'IFCMATERIALLAYERSETUSAGE') { const s = g(A(e, 0)); return s ? layers(s) : null; }
    if (e.type === 'IFCMATERIALLAYERSET') return layers(e);
    if (e.type === 'IFCMATERIAL') return { t: 0, names: [String(A(e, 0) || '')] };
    if (e.type === 'IFCMATERIALLIST') return { t: 0, names: (A(e, 0) || []).map(g).filter(Boolean).map(x => String(A(x, 0) || '')) };
    if (e.type === 'IFCMATERIALCONSTITUENTSET') return { t: 0, names: (A(e, 2) || []).map(g).filter(Boolean).map(c => { const mt = g(A(c, 2)); return mt ? String(A(mt, 0) || '') : String(A(c, 0) || ''); }) };
    return null;
  }

  /* ---------- Structure spatiale ---------- */
  const buildings = [];
  const bE = ofType('IFCBUILDING').map(g).filter(Boolean);
  const storeyParent = new Map();
  for (const b of bE) for (const c of children.get(b.id) || []) { const e = g(c); if (e && e.type === 'IFCBUILDINGSTOREY') storeyParent.set(c, b.id); }
  const orphanStoreys = ofType('IFCBUILDINGSTOREY').filter(s => !storeyParent.has(s));
  const bList = bE.map(b => ({ e: b, storeys: (children.get(b.id) || []).filter(c => { const e = g(c); return e && e.type === 'IFCBUILDINGSTOREY'; }) }));
  if (orphanStoreys.length) bList.push({ e: null, storeys: orphanStoreys });
  if (!ofType('IFCBUILDINGSTOREY').length) W('noStorey');
  const spaceStorey = new Map();
  const counts = { spaces: 0, walls: 0, doors: 0, devices: 0, carriers: 0, cables: 0 };

  for (const B of bList) {
    const BM = B.e ? productM(B.e) : ID(), BI = inv(BM);
    const toLocal = p => apply(BI, p);
    const st = B.storeys.map(id => {
      const e = g(id), M = productM(e), elev = Number.isFinite(+A(e, 9)) && A(e, 9) != null ? len(A(e, 9)) : toLocal([M[9], M[10], M[11]])[2];
      return { key: id, e, gid: gid(e), name: name(e) || String(A(e, 7) || '') || '#' + id, elev: r3(elev), M, spaces: [], walls: [], doors: [], devices: [], carriers: [], cables: [], other: 0 };
    }).sort((a, b) => a.elev - b.elev);
    const near = z => st.reduce((best, s) => (!best || Math.abs(s.elev - z) < Math.abs(best.elev - z) ? s : best), null);
    // Pièces : agrégées sous l'étage (ou sous une autre pièce).
    const spacesUnder = (id, out, d = 0) => { for (const c of children.get(id) || []) { const e = g(c); if (e && e.type === 'IFCSPACE') { out.push(c); if (d < 4) spacesUnder(c, out, d + 1); } } return out; };
    for (const s of st) for (const sp of spacesUnder(s.key, [])) spaceStorey.set(sp, s);
    if (B.e) for (const sp of spacesUnder(B.e.id, [])) { const e = g(sp), z = toLocal(apply(productM(e), [0, 0, 0]))[2]; const s = near(z); if (s) spaceStorey.set(sp, s); }
    // Éléments : contenus dans un étage, une pièce, ou le bâtiment (étage le plus proche).
    const elemStorey = new Map();
    for (const s of st) {
      for (const el of elementsOf.get(s.key) || []) elemStorey.set(el, s);
      for (const [sp, ss] of spaceStorey) if (ss === s) for (const el of elementsOf.get(sp) || []) elemStorey.set(el, s);
    }
    if (B.e) for (const el of elementsOf.get(B.e.id) || []) { const e = g(el); if (!e) continue; const z = toLocal(apply(productM(e), [0, 0, 0]))[2]; const s = near(z); if (s) elemStorey.set(el, s); }

    const P2 = p => { const q = toLocal(p); return [q[0], -q[1]]; };
    // Pièces.
    for (const [sp, s] of spaceStorey) {
      if (!st.includes(s)) continue;
      const e = g(sp), G = geomOf(e);
      let poly = null, holes = [], from = '', top = null;
      const ex = G.body.concat(G.all).filter(x => x.kind === 'extrusion').sort((a, b) => polyArea(b.poly.map(P2)) - polyArea(a.poly.map(P2)))[0];
      if (ex) { poly = ex.poly.map(P2); holes = ex.holes.map(h => h.map(P2)); from = 'extrusion'; top = ex.z1 - ex.z0; }
      if (!poly) { const fc = G.foot.find(x => x.kind === 'curve' && x.pts.length >= 3); if (fc) { poly = fc.pts.map(P2); from = 'footprint'; } }
      if (!poly) {
        const ps = G.box.concat(G.all).flatMap(x => x.pts || x.poly || []);
        if (ps.length >= 2) { const q = ps.map(P2), xs = q.map(v => v[0]), ys = q.map(v => v[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); if (x1 - x0 > 0.05 && y1 - y0 > 0.05) { poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; from = 'bbox'; W('spaceBbox'); } }
      }
      if (poly && poly.length > 2 && Math.hypot(poly[0][0] - poly[poly.length - 1][0], poly[0][1] - poly[poly.length - 1][1]) < 1e-6) poly.pop();
      if (!poly || poly.length < 3) { W('spaceNoGeom', name(e)); continue; }
      const nm = name(e), ln = String(A(e, 7) || '');
      s.spaces.push({ key: sp, gid: gid(e), name: nm, longName: ln, label: (ln && nm && ln !== nm ? `${nm} ${ln}` : ln || nm || '#' + sp).trim(), poly: poly.map(q => [r3(q[0]), r3(q[1])]), holes: holes.filter(h => h.length >= 3).map(h => h.map(q => [r3(q[0]), r3(q[1])])), from, height: top && top > 0.5 ? r3(top) : null, psets: psetsOf(sp) });
      counts.spaces++;
    }
    // Murs, portes, réseau.
    const wallSegs = new Map(); // id du mur IFC → [{ key, a, b }]
    const doorsTodo = [];
    for (const [el, s] of elemStorey) {
      const e = g(el); if (!e) continue;
      if (e.type === 'IFCWALL' || e.type === 'IFCWALLSTANDARDCASE' || e.type === 'IFCWALLELEMENTEDCASE' || e.type === 'IFCCURTAINWALL') {
        const G = geomOf(e), mt = material(el);
        const segs = [];
        const axis = G.axis.find(x => x.kind === 'curve' && x.pts.length >= 2);
        let bodyT = null;
        const ex = G.body.find(x => x.kind === 'extrusion');
        if (axis) { for (let i = 1; i < axis.pts.length; i++) segs.push([P2(axis.pts[i - 1]), P2(axis.pts[i])]); }
        if (ex) {
          const q = ex.poly.map(P2);
          // Grand côté du contour : direction du mur ; largeur dans l'autre sens : épaisseur.
          let best = null; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length], L2 = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!best || L2 > best.L) best = { a, b, L: L2 }; }
          if (best && best.L > 1e-6) {
            const ux = (best.b[0] - best.a[0]) / best.L, uy = (best.b[1] - best.a[1]) / best.L;
            const us = q.map(p => p[0] * ux + p[1] * uy), vs = q.map(p => -p[0] * uy + p[1] * ux);
            const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs), vm = (v0 + v1) / 2;
            bodyT = v1 - v0;
            if (!segs.length && u1 - u0 > 0.05) segs.push([[u0 * ux - vm * uy, u0 * uy + vm * ux], [u1 * ux - vm * uy, u1 * uy + vm * ux]]);
          }
        }
        if (!segs.length) { W('wallNoGeom', name(e)); continue; }
        const t = mt && mt.t > 0.005 ? mt.t : bodyT && bodyT > 0.005 && bodyT <= 2.001 ? bodyT : null;
        const matName = mt ? (mt.names || []).filter(Boolean).join(' / ') || mt.setName || '' : '';
        const own = (psetsOf(el).JOLLOF_Network || {}).Material; // nos propres exports : le matériau exact
        const list = [];
        segs.forEach((sg, i) => { if (Math.hypot(sg[1][0] - sg[0][0], sg[1][1] - sg[0][1]) < 0.01) return; const w = { key: el + (segs.length > 1 ? '.' + i : ''), gid: gid(e), name: name(e), a: sg[0].map(r3), b: sg[1].map(r3), t: t ? r3(t) : null, matName, mat: MATERIALS[own] ? own : matOfName(matName, t) }; s.walls.push(w); list.push(w); counts.walls++; });
        wallSegs.set(el, list);
      } else if (e.type === 'IFCDOOR') {
        doorsTodo.push([el, e, s]);
      } else if (e.type === 'IFCCOMMUNICATIONSAPPLIANCE' || e.type === 'IFCOUTLET') {
        const M = productM(e), p = toLocal([M[9], M[10], M[11]]);
        s.devices.push({ key: el, gid: gid(e), cls: e.type, name: name(e), placed: !!A(e, 5), tag: String(A(e, 7) || ''), pt: (A(e, 8) || {}).e || '', ot: String(A(e, 4) || ''), x: r3(p[0]), y: r3(-p[1]), h: r3(p[2] - s.elev), psets: psetsOf(el) });
        counts.devices++;
      } else if (e.type === 'IFCCABLECARRIERSEGMENT') {
        const G = geomOf(e), axis = G.axis.find(x => x.kind === 'curve' && x.pts.length >= 2);
        let pts3 = axis ? axis.pts.map(toLocal) : [];
        if (!pts3.length) for (const x of G.body.filter(b => b.kind === 'extrusion')) { const o0 = [x.M[9], x.M[10], x.M[11]], o1 = [o0[0] + x.dirW[0] * x.depth, o0[1] + x.dirW[1] * x.depth, o0[2] + x.dirW[2] * x.depth]; const a = toLocal(o0), b = toLocal(o1); if (!pts3.length || Math.hypot(pts3[pts3.length - 1][0] - a[0], pts3[pts3.length - 1][1] - a[1]) > 1e-3) pts3.push(a); pts3.push(b); }
        const vertical = pts3.length >= 2 && pts3.every(q => Math.hypot(q[0] - pts3[0][0], q[1] - pts3[0][1]) < 0.01);
        s.carriers.push({ key: el, gid: gid(e), name: name(e), pt: (A(e, 8) || {}).e || '', ot: String(A(e, 4) || ''), pts: (vertical ? pts3.slice(0, 1) : pts3).map(q => [r3(q[0]), r3(-q[1])]), z: pts3.length ? r3(pts3.reduce((a, q) => a + q[2], 0) / pts3.length - s.elev) : null, vertical, psets: psetsOf(el) });
        counts.carriers++;
      } else if (e.type === 'IFCCABLESEGMENT') {
        s.cables.push({ key: el, gid: gid(e), name: name(e), tag: String(A(e, 7) || ''), psets: psetsOf(el) }); counts.cables++;
      } else s.other++;
    }
    // Portes : ouverture → mur ; position projetée sur le mur.
    for (const [el, e, s] of doorsTodo) {
      const op = fills.get(el), wallId = op ? voids.get(op) : null;
      const w0 = +A(e, 9) > 0 ? len(A(e, 9)) : null;
      let c = null, wOp = null;
      if (op) { const oe = g(op), G = geomOf(oe), ex = G.body.find(x => x.kind === 'extrusion'); if (ex) { const q = ex.poly.map(P2); c = [q.reduce((a, v) => a + v[0], 0) / q.length, q.reduce((a, v) => a + v[1], 0) / q.length]; if (ex.prof && ex.prof.rect) wOp = ex.prof.rect[0]; } }
      if (!c) { const M = productM(e), o0 = P2([M[9], M[10], M[11]]), xa = P2([M[9] + M[0], M[10] + M[1], M[11] + M[2]]), dx = xa[0] - o0[0], dy = xa[1] - o0[1]; const half = (w0 || 0.9) / 2; c = [o0[0] + dx * half, o0[1] + dy * half]; }
      const width = w0 || wOp || 0.9;
      const cands = wallId && wallSegs.get(wallId) ? wallSegs.get(wallId) : s.walls;
      let best = null;
      for (const w of cands) { const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L2 = dx * dx + dy * dy; if (!L2) continue; const t = Math.max(0, Math.min(1, ((c[0] - w.a[0]) * dx + (c[1] - w.a[1]) * dy) / L2)); const d = Math.hypot(w.a[0] + dx * t - c[0], w.a[1] + dy * t - c[1]); if (!best || d < best.d) best = { w, d, at: t * Math.sqrt(L2) }; }
      if (!best || (!wallId && best.d > 0.6)) { W('doorNoWall', name(e)); continue; }
      s.doors.push({ key: el, gid: gid(e), name: name(e), wall: best.w.key, at: r3(best.at), w: r3(width), via: wallId ? 'opening' : 'nearest' });
      counts.doors++;
    }
    // Hauteur d'étage : écart avec le suivant, sinon la plus haute pièce, sinon 3 m.
    st.forEach((s, i) => {
      const nx = st[i + 1], sh = Math.max(0, ...s.spaces.map(x => x.height || 0));
      s.height = r3(nx && nx.elev - s.elev >= 2 && nx.elev - s.elev <= 30 ? nx.elev - s.elev : sh >= 2 && sh <= 30 ? sh : 3);
    });
    // Niveaux : 0 pour l'étage le plus proche de l'altitude 0.
    const z0 = st.reduce((b, s, i) => (b < 0 || Math.abs(s.elev) < Math.abs(st[b].elev) ? i : b), -1);
    st.forEach((s, i) => { s.level = i - Math.max(0, z0); });
    // Décalage : un bâtiment hors du premier quadrant commence à 1 m de l'origine.
    const all = st.flatMap(s => [...s.spaces.flatMap(x => x.poly), ...s.walls.flatMap(w => [w.a, w.b]), ...s.devices.map(d => [d.x, d.y]), ...s.carriers.flatMap(c => c.pts)]);
    let shift = [0, 0];
    if (all.length) {
      const xs = all.map(q => q[0]), ys = all.map(q => q[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
      if (x0 < 0 || y0 < 0 || x1 > 9000 || y1 > 9000) shift = [r3(1 - x0), r3(1 - y0)];
    }
    if (shift[0] || shift[1]) {
      const sh = q => [r3(q[0] + shift[0]), r3(q[1] + shift[1])];
      for (const s of st) {
        for (const x of s.spaces) { x.poly = x.poly.map(sh); x.holes = x.holes.map(h => h.map(sh)); }
        for (const w of s.walls) { w.a = sh(w.a); w.b = sh(w.b); }
        for (const d of s.devices) [d.x, d.y] = sh([d.x, d.y]);
        for (const c of s.carriers) c.pts = c.pts.map(sh);
      }
    }
    for (const s of st) { s.counts = { spaces: s.spaces.length, walls: s.walls.length, doors: s.doors.length, devices: s.devices.length, carriers: s.carriers.length, cables: s.cables.length }; delete s.e; delete s.M; }
    buildings.push({ key: B.e ? B.e.id : 0, gid: B.e ? gid(B.e) : '', name: B.e ? name(B.e) || String(A(B.e, 7) || '') : '', shift, storeys: st });
  }
  const systems = ofType('IFCDISTRIBUTIONSYSTEM', 'IFCSYSTEM').map(g).filter(Boolean).map(e => ({ gid: gid(e), name: name(e), type: e.type, pt: (A(e, 6) || {}).e || '' }));
  if (ofType('(COMPLEX)').length) W('complex');
  const hd = X.header, fn = hd.FILE_NAME || [];
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const site = g(ofType('IFCSITE')[0]);
  return {
    schema, supported: IFC_READ_SCHEMAS.includes(schema),
    header: { name: String(fn[0] || ''), time: String(fn[1] || ''), author: (fn[2] || []).filter(Boolean).join(', '), org: (fn[3] || []).filter(Boolean).join(', '), app: String(fn[5] || fn[4] || ''), description: (hd.FILE_DESCRIPTION && hd.FILE_DESCRIPTION[0] || []).join(' ') },
    units: { length: { name: lenName, toMetre: L, kind: lenKind } },
    project: { name: projE ? name(projE) || String(A(projE, 5) || '') : '' }, site: { name: site ? name(site) : '' },
    buildings, systems, counts,
    stats: { entities: X.count, ms: Math.round(t1 - t0), byType: X.byType() },
    warnings: [...warn.values()]
  };
}

/** Nom de matériau → nos matériaux (site.js MATERIALS), par mots-clés ; sinon d'après l'épaisseur (≤ 12 cm : cloison). */
export function matOfName(nm, t) {
  const s = lower(nm);
  const R = [[/ascenseur|elevator|lift shaft/, 'elevator'], [/glass|verre|vitr|glaz/, 'glass'], [/brick|brique/, 'brick'], [/parpaing|block|agglo|cmu|masonry|maconn/, 'block'],
    [/gypsum|plasterboard|placo|drywall|plaque|ba ?13|stud/, 'drywall'], [/plaster|platre|carreau/, 'plaster'], [/concrete|beton|ciment|cement/, 'concrete'], [/stone|pierre/, 'stone'], [/wood|bois|timber/, 'wood'], [/metal|steel|acier|alumin/, 'metal']];
  for (const [re, m] of R) if (re.test(s)) return m;
  return Number.isFinite(t) && t > 0 && t <= 0.12 ? 'drywall' : 'block';
}
/** Usage d'une pièce d'après son nom (mots courants, français et anglais) ; « office » par défaut. */
export function usageOfName(nm) {
  const s = lower(nm);
  const R = [[/local tech|baie|server|serveur|telecom|\bit\b|informatique|\blt\b|\bsr\b|\bmdf\b|\bidf\b|data ?room/, 'tr'], [/couloir|circulation|corridor|hall(way)?|degagement|palier/, 'corridor'],
    [/accueil|entree|lobby|reception|foyer/, 'hall'], [/reunion|meeting|conference/, 'meeting'], [/classe|classroom|cours/, 'classroom'], [/labo|atelier|workshop/, 'lab'],
    [/wc|toilet|sanitaire|douche|lavabo|restroom/, 'sanitary'], [/stock|rangement|storage|archive|reserve|depot/, 'storage'], [/gaine|shaft|tremie|ascenseur|elevator/, 'shaft'],
    [/open ?space|plateau|open ?office/, 'open'], [/bureau|office/, 'office']];
  for (const [re, u] of R) if (re.test(s)) return u;
  return 'office';
}
/** Type d'équipement du projet pour un objet IFC (jeu JOLLOF_Network.Type d'abord, puis le type IFC), ou null. */
export function devTypeOf(d) {
  const own = d.psets && d.psets.JOLLOF_Network && d.psets.JOLLOF_Network.Type;
  if (typeof own === 'string' && DEVICES[own]) return own;
  if (d.cls === 'IFCOUTLET') return d.pt === 'DATAOUTLET' || d.pt === 'COMMUNICATIONSOUTLET' || d.pt === 'TELEPHONEOUTLET' ? 'outlet2' : null;
  const ot = String(d.ot || '').toUpperCase();
  const map = { NETWORKBRIDGE: 'switch24', NETWORKHUB: 'switch', ROUTER: 'routerpro', GATEWAY: 'routerpro', MODEM: 'router', COMPUTER: 'pc', PRINTER: 'printer', ANTENNA: 'ap', REPEATER: 'ap' };
  if (d.pt && d.pt !== 'USERDEFINED' && d.pt !== 'NOTDEFINED') return map[d.pt] || null;
  const R = [[/ACCESSPOINT|WIFI|WAP|WLAN/, 'ap'], [/L3|CORE/, 'l3switch'], [/SWITCH/, 'switch24'], [/FIBRE.*PANEL|FIBER.*PANEL|ODF/, 'fibrepanel'], [/PATCH/, 'patch24'], [/MEDIACONV/, 'mediaconv'],
    [/SERVER|SERVEUR/, 'server'], [/NAS/, 'nas'], [/CAMERA/, 'camera'], [/PHONE/, 'phone'], [/ROUTER|FIREWALL/, 'routerpro']];
  for (const [re, t] of R) if (re.test(ot)) return t;
  return null;
}
/** Genre de cheminement pour un IfcCableCarrierSegment (jeu JOLLOF_Network.Kind d'abord). */
export function pathKindOf(c) {
  const own = c.psets && c.psets.JOLLOF_Network && c.psets.JOLLOF_Network.Kind;
  if (typeof own === 'string' && PATH_KINDS[own]) return own;
  if (c.vertical) return 'riser';
  return { CABLETRAYSEGMENT: 'tray', CABLELADDERSEGMENT: 'tray', CABLETRUNKINGSEGMENT: 'trunking', CONDUITSEGMENT: 'conduit' }[c.pt] || 'tray';
}

/** Modèle lu remis à une autre échelle (unité corrigée par l'utilisateur) : copie, longueurs multipliées par k. */
export function scaleModel(m, k) {
  if (!(k > 0) || k === 1) return m;
  const P = q => [r3(q[0] * k), r3(q[1] * k)], S = v => (Number.isFinite(v) ? r3(v * k) : v);
  const c = JSON.parse(JSON.stringify(m));
  for (const b of c.buildings) {
    b.shift = b.shift.map(S);
    for (const s of b.storeys) {
      s.elev = S(s.elev); s.height = S(s.height);
      for (const x of s.spaces) { x.poly = x.poly.map(P); x.holes = x.holes.map(h => h.map(P)); x.height = S(x.height); }
      for (const w of s.walls) { w.a = P(w.a); w.b = P(w.b); w.t = S(w.t); }
      for (const d of s.doors) { d.at = S(d.at); d.w = S(d.w); }
      for (const d of s.devices) { d.x = S(d.x); d.y = S(d.y); d.h = S(d.h); }
      for (const p of s.carriers) { p.pts = p.pts.map(P); p.z = S(p.z); }
    }
  }
  c.units = { ...c.units, scaled: k };
  return c;
}

/** Résumé court d'un modèle lu (assistant, IA). */
export function ifcSummary(m) {
  return {
    schema: m.schema, units: m.units.length, project: m.project.name, site: m.site.name,
    buildings: m.buildings.map(b => ({ name: b.name, shift: b.shift, storeys: b.storeys.map(s => ({ name: s.name, elev: s.elev, height: s.height, ...s.counts })) })),
    counts: m.counts, systems: m.systems.length, entities: m.stats.entities, warnings: m.warnings
  };
}

/**
 * Verse le modèle lu dans le projet (data, modifié sur place ; l'appelant fait ctx.commit()). choice : {
 *   storeys: { [clé d'étage]: { on, target: 'new' | id d'étage existant, building: 'new' | id de bâtiment } },
 *   what: { rooms, walls, doors, devices, paths }, replace (true : retire ce qu'un import précédent du même étage a posé) }.
 * deps.newDevice(type, { x, y }) crée un équipement dans data.devices (ctx.newDevice) ; sans lui, pas d'équipements.
 * Rend { floors: [ids], counts: { rooms, walls, doors, devices, paths, floors, buildings }, skipped: { devices } }.
 */
export function applyIfc(data, m, choice = {}, deps = {}) {
  const what = { rooms: true, walls: true, doors: true, devices: false, paths: false, ...(choice.what || {}) };
  data.site = data.site || { buildings: [] }; data.site.buildings = data.site.buildings || [];
  const used = siteIds(data.site), counts = { rooms: 0, walls: 0, doors: 0, devices: 0, paths: 0, floors: 0, buildings: 0 }, skipped = { devices: 0 }, floors = [];
  const newBld = new Map();
  const srcKey = s => 'ifc:' + String(s.gid || s.key).replace(/[^\w.:-]/g, '.').slice(0, 50);
  for (const B of m.buildings) for (const s of B.storeys) {
    const c = (choice.storeys || {})[s.key] || { on: true, target: 'new', building: 'new' };
    if (c.on === false) continue;
    // Bâtiment : existant, ou un nouveau par bâtiment IFC.
    let b = data.site.buildings.find(x => x.id === c.building);
    if (!b) {
      b = newBld.get(B.key);
      if (!b) { const n = data.site.buildings.length; b = { id: uid('', 'B', used), name: (B.name || m.project.name || 'IFC').slice(0, 40), x: n ? Math.max(...data.site.buildings.map(x => +x.x || 0)) + 80 : 0, y: 0, floors: [] }; data.site.buildings.push(b); newBld.set(B.key, b); counts.buildings++; }
    }
    let f = b.floors.find(x => x.id === c.target);
    if (!f) {
      f = { id: uid('', 'F', used), name: String(s.name || '').slice(0, 40), level: s.level, elev: s.elev, height: s.height, ceil: Math.min(s.height, 2.7), plenum: 0.6, raised: 0, walls: [], doors: [], rooms: [] };
      b.floors.push(f); b.floors.sort((x, y) => x.level - y.level); counts.floors++;
    }
    floors.push(f.id);
    const src = srcKey(s);
    if (choice.replace !== false) {
      const old = new Set(f.walls.filter(w => w.src === src).map(w => w.id));
      f.walls = f.walls.filter(w => w.src !== src); f.rooms = f.rooms.filter(r => r.src !== src); f.doors = f.doors.filter(d => d.src !== src && !old.has(d.wall));
      if (Array.isArray(data.paths)) data.paths = data.paths.filter(p => p.src !== src);
      if (Array.isArray(data.devices)) data.devices = data.devices.filter(d => d.src !== src);
    }
    if (what.rooms) for (const r of s.spaces) {
      const own = r.psets && r.psets.JOLLOF_Network && r.psets.JOLLOF_Network.Usage;
      const room = { id: uid('', 'rm', used), name: r.label.slice(0, 40), usage: USAGES[own] ? own : usageOfName(r.label), poly: r.poly.map(q => q.slice()), src };
      if (r.holes && r.holes.length) room.holes = r.holes.map(h => h.map(q => q.slice()));
      f.rooms.push(room); counts.rooms++;
    }
    const wallIds = new Map();
    if (what.walls) for (const w of s.walls) {
      const mat = MATERIALS[w.mat] ? w.mat : 'block', id = uid('', 'w', used);
      f.walls.push({ id, a: w.a.slice(), b: w.b.slice(), t: w.t || MATERIALS[mat].t, mat, src }); wallIds.set(w.key, id); counts.walls++;
    }
    if (what.walls && what.doors) for (const d of s.doors) {
      const wid = wallIds.get(d.wall); if (!wid) continue;
      f.doors.push({ id: uid('', 'dr', used), wall: wid, at: d.at, w: d.w, src }); counts.doors++;
    }
    if (what.devices && deps.newDevice) for (const d of s.devices) {
      const type = devTypeOf(d); if (!type) { skipped.devices++; continue; }
      const k = counts.devices, dev = deps.newDevice(type, { x: 80 + (k % 12) * 110, y: 80 + Math.floor(k / 12) * 110 });
      if (!dev) { skipped.devices++; continue; }
      if (d.name) dev.name = d.name.slice(0, 24);
      if (d.placed !== false) dev.loc = { floor: f.id, x: d.x, y: d.y, h: Math.max(0, Math.min(10, d.h || 0)) }; // sans placement : schéma logique seulement
      dev.src = src; counts.devices++;
    }
    if (what.paths) for (const c of s.carriers) {
      if (!c.pts.length || (!c.vertical && c.pts.length < 2)) continue;
      const kind = pathKindOf(c), K = PATH_KINDS[kind] || {}, ps = c.psets || {};
      const nom = Object.keys(ps).find(k => /^Pset_CableCarrierSegmentType/.test(k) && k !== 'Pset_CableCarrierSegmentTypeCommon');
      const wm = nom && +ps[nom].NominalWidth > 0 ? Math.round(ps[nom].NominalWidth * 1000) : null, hm = nom && +ps[nom].NominalHeight > 0 ? Math.round(ps[nom].NominalHeight * 1000) : null;
      data.paths = data.paths || [];
      let id = 'pa' + (data.paths.length + 1), i = data.paths.length + 1; while (data.paths.some(p => p.id === id)) id = 'pa' + ++i;
      const p = { id, floor: f.id, kind, name: (c.name || '').slice(0, 40), pts: c.pts.map(q => q.slice()), z: Number.isFinite(c.z) ? Math.max(-5, Math.min(10, c.z - (K.dia || kind === 'conduit' || kind === 'outdoor' ? 0 : (hm || K.h || 0) / 2000))) : K.z, src };
      if (K.dia) p.dia = wm || K.dia; else { if (wm) p.w = wm; if (hm) p.h = hm; }
      data.paths.push(p); counts.paths++;
    }
  }
  return { floors, counts, skipped };
}
