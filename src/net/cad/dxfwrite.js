// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Écriture DXF ASCII AutoCAD 2000 (AC1015), écrite d'après la référence publique d'Autodesk (« DXF Reference »,
// AutoCAD 2014, mars 2013 : types des codes p. 2-4, règles d'écriture p. 256 — LTYPE avant LAYER, BLOCKS avant
// ENTITIES, EOF obligatoire —, codes communs des entités p. 69-72, tables p. 41-64, LAYOUT p. 196-199, PLOTSETTINGS
// p. 210-213, VIEWPORT p. 168-171). Relue par dxf.js et contrôlée par dxflint.js.
//
// Pourquoi AC1015 (R2000) : c'est la plus ancienne version qui a LWPOLYLINE, MTEXT, les objets LAYOUT et les poignées
// partout, et le dénominateur commun lu par AutoCAD (2000 → 2025), BricsCAD, DraftSight, LibreCAD, QCAD, la
// bibliothèque ODA et LibreDWG ; AC1027 (2013) n'apporte rien d'utile ici et exclut les lecteurs plus anciens. La vraie
// couleur (code 420, R2004+) est écrite EN PLUS de l'indice ACI (62) : un lecteur R2000 ignore le code inconnu, comme
// le demande la référence (« ignore undefined group codes », p. 2) ; option trueColor: false pour un R2000 strict.
//
// const w = createDxfWriter({ units: 'm', trueColor: true });   // 'm' | 'cm' | 'mm' | 'in' | 'ft' | 'unitless'
// w.ltype('DASHED', { desc, pattern: [tiret, -espace, …] (unités du dessin) });  w.style('LABEL', { font: 'arial.ttf' });
// w.layer('T-COMM-CABL', { color: '#3b82f6' | 5, ltype, lw (centièmes de mm), plot, off, frozen, locked });
// w.line / polyline(pts, { closed, bulges }) / circle / arc(x, y, r, a0, a1 (degrés)) / text(x, y, h, s, { style, rot,
//   align, valign }) / mtext(x, y, h, s, { style, width, attach, rot }) / insert(name, x, y, { sx, sy, rot, attribs })
//   — o commun : { layer, color, ltype, lw }.
// w.block(name, { base }, b => { b.circle(…); b.attdef('ID', { x, y, h, prompt, default, invisible, layer, align }); });
//   les ATTRIB d'un insert() reprennent la position, la hauteur et la visibilité de l'ATTDEF du même nom.
// w.layout('A3', { paper: [420, 297] (mm) }, p => { p.polyline(…); p.viewport({ center, size, view: { center, height } }) })
//   présentation (espace papier, unités = mm du papier) avec son cartouche et ses fenêtres sur l'espace objet.
// w.toString() → texte DXF (CRLF ; caractères hors ASCII en \U+XXXX).
import { aciRgb } from './dxf.js';

export const DXF_VERSION = 'AC1015';
const UNITS = { unitless: 0, in: 1, ft: 2, mm: 4, cm: 5, m: 6, km: 7, dm: 14 };
const TO_M = { unitless: 0.001, in: 0.0254, ft: 0.3048, mm: 0.001, cm: 0.01, m: 1, km: 1000, dm: 0.1 };
const num = v => { v = +v; if (!Number.isFinite(v)) v = 0; const r = Math.round(v * 1e9) / 1e9; return Number.isInteger(r) ? r.toFixed(1) : String(r); };
const int = v => String(Math.trunc(+v || 0));
/** Texte DXF sûr : une ligne, caractères hors ASCII en \U+XXXX. */
const esc = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, c => { const p = c.codePointAt(0); return p > 0xffff ? '?' : '\\U+' + p.toString(16).toUpperCase().padStart(4, '0'); });
const mesc = s => esc(String(s ?? '').replace(/\\/g, '\\\\').replace(/[{}]/g, c => '\\' + c).replace(/\r?\n/g, ' ')).replace(/\\U\+2029/g, '\\P');
/** Nom de table sûr (calque, bloc, style, type de ligne) : pas de caractères interdits <>/\":;?*|=` ni de virgule. */
const sym = s => esc(String(s ?? '').replace(/[<>/\\":;?*|=`,]/g, '_').trim().slice(0, 255)) || '0';

/** Couleur → { aci, rgb } (ACI le plus proche ; la vraie couleur est gardée à part). */
export function colorOf(c) {
  if (typeof c === 'number' && c >= 1 && c <= 255) return { aci: c | 0, rgb: aciRgb(c) };
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || ''));
  if (!m) return { aci: 7, rgb: 0xffffff };
  const rgb = parseInt(m[1], 16);
  let best = 7, bd = Infinity;
  for (let i = 1; i < 256; i++) {
    const q = aciRgb(i), dr = ((q >> 16) & 255) - ((rgb >> 16) & 255), dg = ((q >> 8) & 255) - ((rgb >> 8) & 255), db = (q & 255) - (rgb & 255);
    const d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = i; }
  }
  return { aci: best, rgb };
}

export function createDxfWriter({ units = 'm', trueColor = true } = {}) {
  if (!(units in UNITS)) units = 'unitless';
  let next = 0x100;
  const H = () => (next++).toString(16).toUpperCase();
  const mm = 0.001 / TO_M[units]; // 1 mm en unités du dessin (motifs des types de ligne par défaut)
  const layers = new Map([['0', { name: '0', aci: 7, rgb: -1, ltype: 'Continuous', lw: -3, plot: true }]]);
  const ltypes = new Map([
    ['ByBlock', { desc: '', pattern: [] }], ['ByLayer', { desc: '', pattern: [] }], ['Continuous', { desc: 'Solid line', pattern: [] }],
    ['DASHED', { desc: 'Dashed __ __ __', pattern: [6 * mm, -3 * mm] }], ['HIDDEN', { desc: 'Hidden _ _ _', pattern: [3 * mm, -1.5 * mm] }],
    ['CENTER', { desc: 'Center ____ _ ____', pattern: [12 * mm, -3 * mm, 3 * mm, -3 * mm] }], ['DASHDOT', { desc: 'Dash dot __ . __', pattern: [6 * mm, -3 * mm, 0, -3 * mm] }]
  ]);
  const styles = new Map([['Standard', { font: 'txt' }]]);
  const blocks = new Map(); // nom → { name, base, rec, items, attdefs }
  const model = { name: '*Model_Space', base: [0, 0], rec: H(), items: [], layoutH: H() };
  const layouts = []; // { name, rec, layoutH, items, paper, block }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ext = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  const useLayer = name => { const n = sym(name ?? '0'); if (!layers.has(n)) layers.set(n, { name: n, aci: 7, rgb: -1, ltype: 'Continuous', lw: -3, plot: true }); return n; };
  const useLtype = name => { const n = sym(name); return ltypes.has(n) ? n : (ltypes.set(n, { desc: n, pattern: [] }), n); };
  const useStyle = name => { const n = sym(name); if (!styles.has(n)) styles.set(n, { font: 'txt' }); return n; };

  /** Méthodes de dessin vers une liste d'entités. space : 'model' | 'paper' | 'block'. */
  const drawer = (into, space) => {
    const head = (type, o, sub, h = H(), owner = into.rec) => {
      const g = [[0, type], [5, h], [330, owner], [100, 'AcDbEntity']];
      if (space === 'paper') g.push([67, 1]);
      g.push([8, useLayer(o?.layer)]);
      if (o?.ltype) g.push([6, useLtype(o.ltype)]);
      if (o?.color != null) { const c = colorOf(o.color); g.push([62, c.aci]); if (trueColor && typeof o.color === 'string') g.push([420, c.rgb]); }
      if (o?.lw != null) g.push([370, int(o.lw)]);
      g.push([100, sub]); return g;
    };
    const P = (x, y) => { if (space === 'model') ext(+x, +y); };
    /** Groupes TEXT communs à TEXT, ATTRIB, ATTDEF (sous-classe AcDbText). */
    const textGroups = (x, y, h, str, o) => {
      const hj = { left: 0, center: 1, right: 2 }[o.align] ?? 0, vj = { baseline: 0, bottom: 1, middle: 2, top: 3 }[o.valign] ?? 0;
      const g = [[10, num(x)], [20, num(y)], [30, '0.0'], [40, num(h > 0 ? h : 1)], [1, esc(str)]];
      if (o.rot) g.push([50, num(o.rot)]);
      if (o.style) g.push([7, useStyle(o.style)]);
      if (hj || vj) g.push([72, hj], [11, num(x)], [21, num(y)], [31, '0.0']);
      return { g, vj };
    };
    const d = {
      line(ax, ay, bx, by, o) { P(ax, ay); P(bx, by); into.items.push([...head('LINE', o, 'AcDbLine'), [10, num(ax)], [20, num(ay)], [30, '0.0'], [11, num(bx)], [21, num(by)], [31, '0.0']]); return d; },
      polyline(pts, o = {}) {
        const flat = Array.isArray(pts[0]) ? pts.flatMap(p => [p[0], p[1]]) : pts, n = flat.length / 2;
        if (n < 2) return d;
        const g = [...head('LWPOLYLINE', o, 'AcDbPolyline'), [90, n], [70, o.closed ? 1 : 0], [43, '0.0']];
        for (let i = 0; i < n; i++) { P(flat[i * 2], flat[i * 2 + 1]); g.push([10, num(flat[i * 2])], [20, num(flat[i * 2 + 1])]); const b = o.bulges?.[i]; if (b) g.push([42, num(b)]); }
        into.items.push(g); return d;
      },
      circle(x, y, r, o) { P(x - r, y - r); P(x + r, y + r); into.items.push([...head('CIRCLE', o, 'AcDbCircle'), [10, num(x)], [20, num(y)], [30, '0.0'], [40, num(r)]]); return d; },
      arc(x, y, r, a0, a1, o) { P(x - r, y - r); P(x + r, y + r); into.items.push([...head('ARC', o, 'AcDbCircle'), [10, num(x)], [20, num(y)], [30, '0.0'], [40, num(r)], [100, 'AcDbArc'], [50, num(a0)], [51, num(a1)]]); return d; },
      text(x, y, h, str, o = {}) {
        P(x, y);
        const { g, vj } = textGroups(x, y, h, str, o);
        const out = [...head('TEXT', o, 'AcDbText'), ...g, [100, 'AcDbText']]; if (vj) out.push([73, vj]);
        into.items.push(out); return d;
      },
      mtext(x, y, h, str, o = {}) {
        P(x, y);
        const g = [...head('MTEXT', o, 'AcDbMText'), [10, num(x)], [20, num(y)], [30, '0.0'], [40, num(h > 0 ? h : 1)], [41, num(o.width || 0)], [71, Math.min(9, Math.max(1, o.attach || 1))], [72, 1]];
        // morceaux de 250 caractères au plus, sans couper un échappement \U+XXXX ou \P
        let s = mesc(str);
        while (s.length > 250) {
          let k = 250; const b = s.lastIndexOf('\\', k - 1);
          if (b >= 0 && b > k - 8) k = b;
          if (k <= 0) k = 250;
          g.push([3, s.slice(0, k)]); s = s.slice(k);
        }
        g.push([1, s]);
        if (o.style) g.push([7, useStyle(o.style)]);
        if (o.rot) { const r = (o.rot * Math.PI) / 180; g.push([11, num(Math.cos(r))], [21, num(Math.sin(r))], [31, '0.0']); }
        into.items.push(g); return d;
      },
      insert(name, x, y, o = {}) {
        P(x, y);
        const bn = sym(name), blk = blocks.get(bn), h = H();
        const at = o.attribs && Object.keys(o.attribs).length ? o.attribs : null;
        const sx = o.sx ?? 1, sy = o.sy ?? o.sx ?? 1, rot = o.rot || 0;
        const g = [...head('INSERT', o, 'AcDbBlockReference', h)];
        if (at) g.push([66, 1]);
        g.push([2, bn], [10, num(x)], [20, num(y)], [30, '0.0'], [41, num(sx)], [42, num(sy)], [43, '1.0'], [50, num(rot)]);
        into.items.push(g);
        if (at) {
          // ATTRIB : propriétaire = l'INSERT ; position, hauteur, visibilité de l'ATTDEF du bloc (transformées), sinon en pile
          const co = Math.cos((rot * Math.PI) / 180), si = Math.sin((rot * Math.PI) / 180);
          let k = 0; const ah = o.attribH || 0.2;
          for (const [tag0, val] of Object.entries(at)) {
            const tag = sym(String(tag0).toUpperCase().replace(/\s+/g, '_')), def = blk?.attdefs.get(tag);
            let ax, ay, hh, ar = rot, al = o.layer, fl = 0, align, valign;
            if (def) {
              const lx = (def.x - blk.base[0]) * sx, ly = (def.y - blk.base[1]) * sy;
              ax = x + lx * co - ly * si; ay = y + lx * si + ly * co; hh = def.h * Math.abs(sy); ar = rot + (def.rot || 0);
              if (def.layer && def.layer !== '0') al = def.layer; fl = def.invisible ? 1 : 0; align = def.align; valign = def.valign;
            } else { ax = x; ay = y - ah * 1.5 * ++k; hh = ah; }
            const { g: tg, vj } = textGroups(ax, ay, hh, val, { rot: ar, style: o.style, align, valign });
            const a = [...head('ATTRIB', { layer: al, color: o.color }, 'AcDbText', H(), h), ...tg, [100, 'AcDbAttribute'], [2, tag], [70, fl], [73, 0]];
            if (vj) a.push([74, vj]);
            into.items.push(a);
          }
          into.items.push([[0, 'SEQEND'], [5, H()], [330, h], [100, 'AcDbEntity'], ...(space === 'paper' ? [[67, 1]] : []), [8, useLayer(o.layer)]]);
        }
        return d;
      }
    };
    if (space === 'block') {
      d.attdef = (tag0, o = {}) => {
        const tag = sym(String(tag0).toUpperCase().replace(/\s+/g, '_')), h = o.h > 0 ? o.h : 0.2;
        into.attdefs.set(tag, { x: +o.x || 0, y: +o.y || 0, h, rot: +o.rot || 0, invisible: !!o.invisible, layer: o.layer && sym(o.layer), align: o.align, valign: o.valign });
        const { g, vj } = textGroups(+o.x || 0, +o.y || 0, h, o.default ?? '', o);
        const a = [...head('ATTDEF', o, 'AcDbText'), ...g, [100, 'AcDbAttributeDefinition'], [3, esc(o.prompt ?? tag)], [2, tag], [70, o.invisible ? 1 : 0], [73, 0]];
        if (vj) a.push([74, vj]);
        into.items.push(a); return d;
      };
    }
    if (space === 'paper') {
      d.viewport = (o = {}) => {
        const L = into, c = o.center || [L.paper[0] / 2, L.paper[1] / 2], s = o.size || [L.paper[0] * 0.8, L.paper[1] * 0.8];
        let vc = o.view?.center, vh = o.view?.height;
        if (!vc || !(vh > 0)) { // vue par défaut : tout l'espace objet dans la fenêtre
          const ok = x0 <= x1, w = ok ? x1 - x0 : 1, hh = ok ? y1 - y0 : 1;
          vc = ok ? [(x0 + x1) / 2, (y0 + y1) / 2] : [0, 0]; vh = Math.max(hh, (w * s[1]) / s[0], 1e-6) * 1.05;
        }
        L.vps.push({ c, s, vc, vh, layer: o.layer });
        return d;
      };
    }
    return d;
  };

  const w = drawer(model, 'model');
  w.layer = (name, o = {}) => {
    const c = colorOf(o.color ?? 7), n = sym(name);
    layers.set(n, { name: n, aci: c.aci, rgb: typeof o.color === 'string' ? c.rgb : -1, ltype: o.ltype ? useLtype(o.ltype) : 'Continuous', lw: o.lw ?? -3,
      plot: o.plot !== false, off: !!o.off, frozen: !!o.frozen, locked: !!o.locked });
    return w;
  };
  w.ltype = (name, o = {}) => { ltypes.set(sym(name), { desc: o.desc ?? String(name), pattern: (o.pattern || []).map(Number).filter(Number.isFinite).slice(0, 12) }); return w; };
  w.style = (name, o = {}) => { styles.set(sym(name), { font: o.font || 'txt', height: +o.height || 0, width: +o.width || 1 }); return w; };
  w.block = (name, o = {}, fn) => {
    const b = { name: sym(name), base: o.base || [0, 0], rec: H(), items: [], attdefs: new Map() };
    blocks.set(b.name, b); if (fn) fn(drawer(b, 'block'));
    return w;
  };
  w.layout = (name, o = {}, fn) => {
    const L = { name: esc(name || 'Layout' + (layouts.length + 1)), rec: H(), layoutH: H(), items: [], vps: [], paper: o.paper || [420, 297] };
    layouts.push(L); if (fn) fn(drawer(L, 'paper'));
    return w;
  };
  w.toString = () => {
    if (!layouts.length) w.layout('Layout1', {});
    const out = [];
    const G = (c, v) => { out.push(String(c).padStart(3), String(v)); };
    const all = g => { for (const [c, v] of g) G(c, v); };
    const T = { vport: H(), ltype: H(), layer: H(), style: H(), view: H(), ucs: H(), appid: H(), dim: H(), brec: H() };
    const O = { root: H(), group: H(), layout: H(), mls: H(), mlsStd: H(), plot: H() };
    const styleH = new Map([...styles.keys()].map(k => [k, H()]));
    // fenêtres : celle de la feuille entière (id 1) + celles demandées, avec leurs poignées
    layouts.forEach((L, i) => { L.block = i === 0 ? '*Paper_Space' : '*Paper_Space' + (i - 1); L.vpH = L.vps.length ? [H(), ...L.vps.map(() => H())] : []; });
    const table = (name, h, n, sub = null) => { all([[0, 'TABLE'], [2, name], [5, h], [330, 0], [100, 'AcDbSymbolTable'], [70, n]]); if (sub) all(sub); };
    const rec = (type, h, owner, sub) => all([[0, type], [type === 'DIMSTYLE' ? 105 : 5, h], [330, owner], [100, 'AcDbSymbolTableRecord'], [100, sub]]);
    const ok = x0 <= x1, E0 = ok ? [x0, y0] : [0, 0], E1 = ok ? [x1, y1] : [0, 0];
    // en-tête
    all([[0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, DXF_VERSION], [9, '$ACADMAINTVER'], [70, 6], [9, '$DWGCODEPAGE'], [3, 'ANSI_1252'],
      [9, '$INSBASE'], [10, '0.0'], [20, '0.0'], [30, '0.0'],
      [9, '$EXTMIN'], [10, num(E0[0])], [20, num(E0[1])], [30, '0.0'], [9, '$EXTMAX'], [10, num(E1[0])], [20, num(E1[1])], [30, '0.0'],
      [9, '$LIMMIN'], [10, num(E0[0])], [20, num(E0[1])], [9, '$LIMMAX'], [10, num(E1[0])], [20, num(E1[1])],
      [9, '$LTSCALE'], [40, '1.0'], [9, '$TEXTSTYLE'], [7, 'Standard'], [9, '$CLAYER'], [8, '0'], [9, '$CELTYPE'], [6, 'ByLayer'],
      [9, '$CECOLOR'], [62, 256], [9, '$LUNITS'], [70, 2], [9, '$LUPREC'], [70, 4], [9, '$AUNITS'], [70, 0],
      [9, '$INSUNITS'], [70, UNITS[units]], [9, '$MEASUREMENT'], [70, units === 'in' || units === 'ft' ? 0 : 1],
      [9, '$PSLTSCALE'], [70, 1], [9, '$HANDSEED'], [5, '@SEED'], [0, 'ENDSEC']]);
    all([[0, 'SECTION'], [2, 'CLASSES'], [0, 'ENDSEC'], [0, 'SECTION'], [2, 'TABLES']]);
    // VPORT *Active
    table('VPORT', T.vport, 1);
    rec('VPORT', H(), T.vport, 'AcDbViewportTableRecord');
    const cxv = (E0[0] + E1[0]) / 2, cyv = (E0[1] + E1[1]) / 2, hv = ok ? Math.max(E1[1] - E0[1], (E1[0] - E0[0]) / 1.6, 1e-6) * 1.1 : 10;
    all([[2, '*Active'], [70, 0], [10, '0.0'], [20, '0.0'], [11, '1.0'], [21, '1.0'], [12, num(cxv)], [22, num(cyv)], [13, '0.0'], [23, '0.0'], [14, '1.0'], [24, '1.0'],
      [15, '1.0'], [25, '1.0'], [16, '0.0'], [26, '0.0'], [36, '1.0'], [17, '0.0'], [27, '0.0'], [37, '0.0'], [40, num(hv)], [41, '1.6'], [42, '50.0'], [43, '0.0'], [44, '0.0'],
      [50, '0.0'], [51, '0.0'], [71, 0], [72, 1000], [73, 1], [74, 3], [75, 0], [76, 0], [77, 0], [78, 0], [0, 'ENDTAB']]);
    // LTYPE (avant LAYER, p. 256)
    table('LTYPE', T.ltype, ltypes.size);
    for (const [n, L] of ltypes) {
      rec('LTYPE', H(), T.ltype, 'AcDbLinetypeTableRecord');
      all([[2, n], [70, 0], [3, esc(L.desc)], [72, 65], [73, L.pattern.length], [40, num(L.pattern.reduce((a, v) => a + Math.abs(v), 0))]]);
      for (const v of L.pattern) all([[49, num(v)], [74, 0]]);
    }
    G(0, 'ENDTAB');
    // LAYER
    table('LAYER', T.layer, layers.size);
    for (const L of layers.values()) {
      rec('LAYER', H(), T.layer, 'AcDbLayerTableRecord');
      all([[2, L.name], [70, (L.frozen ? 1 : 0) | (L.locked ? 4 : 0)], [62, L.off ? -L.aci : L.aci]]);
      if (trueColor && L.rgb >= 0) G(420, L.rgb);
      all([[6, ltypes.has(L.ltype) ? L.ltype : 'Continuous']]);
      if (!L.plot) G(290, 0);
      G(370, int(L.lw));
    }
    G(0, 'ENDTAB');
    // STYLE
    table('STYLE', T.style, styles.size);
    for (const [n, S] of styles) {
      rec('STYLE', styleH.get(n), T.style, 'AcDbTextStyleTableRecord');
      all([[2, n], [70, 0], [40, num(S.height || 0)], [41, num(S.width || 1)], [50, '0.0'], [71, 0], [42, '2.5'], [3, esc(S.font)], [4, '']]);
    }
    G(0, 'ENDTAB');
    table('VIEW', T.view, 0); G(0, 'ENDTAB');
    table('UCS', T.ucs, 0); G(0, 'ENDTAB');
    table('APPID', T.appid, 1);
    rec('APPID', H(), T.appid, 'AcDbRegAppTableRecord'); all([[2, 'ACAD'], [70, 0], [0, 'ENDTAB']]);
    table('DIMSTYLE', T.dim, 1, [[100, 'AcDbDimStyleTable'], [71, 0]]);
    rec('DIMSTYLE', H(), T.dim, 'AcDbDimStyleTableRecord');
    all([[2, 'Standard'], [70, 0], [40, '1.0'], [41, num(2.5 * mm)], [42, num(0.625 * mm)], [43, num(3.75 * mm)], [44, num(1.25 * mm)], [140, num(2.5 * mm)], [147, num(0.625 * mm)],
      [340, styleH.get('Standard')], [0, 'ENDTAB']]);
    // BLOCK_RECORD
    const spaces = [model, ...layouts], recs = [...spaces.map(s => ({ name: s === model ? s.name : s.block, rec: s.rec, layoutH: s.layoutH })), ...blocks.values()];
    table('BLOCK_RECORD', T.brec, recs.length);
    for (const b of recs) {
      rec('BLOCK_RECORD', b.rec, T.brec, 'AcDbBlockTableRecord');
      G(2, b.name); if (b.layoutH) G(340, b.layoutH);
      // 70 (unités d'insertion) = 0 : aucune mise à l'échelle automatique à l'insertion. Une valeur non nulle, pourtant
      // permise (référence p. 45), fait perdre le contenu des blocs à LibreDWG 0.14 (dxf2dwg) — vérifié.
      all([[70, 0], [280, 1], [281, 0]]);
    }
    all([[0, 'ENDTAB'], [0, 'ENDSEC']]);
    // BLOCKS
    all([[0, 'SECTION'], [2, 'BLOCKS']]);
    const blockOut = (name, rec, base, items, paper, flags = 0) => {
      all([[0, 'BLOCK'], [5, H()], [330, rec], [100, 'AcDbEntity'], ...(paper ? [[67, 1]] : []), [8, '0'], [100, 'AcDbBlockBegin'], [2, name], [70, flags],
        [10, num(base[0])], [20, num(base[1])], [30, '0.0'], [3, name], [1, '']]);
      for (const g of items) all(g);
      all([[0, 'ENDBLK'], [5, H()], [330, rec], [100, 'AcDbEntity'], ...(paper ? [[67, 1]] : []), [8, '0'], [100, 'AcDbBlockEnd']]);
    };
    blockOut(model.name, model.rec, [0, 0], [], false);
    layouts.forEach((L, i) => blockOut(L.block, L.rec, [0, 0], i === 0 ? [] : paperItems(L), true));
    for (const b of blocks.values()) blockOut(b.name, b.rec, b.base, b.items, false, b.attdefs.size ? 2 : 0);
    G(0, 'ENDSEC');
    // ENTITIES : espace objet puis présentation active
    all([[0, 'SECTION'], [2, 'ENTITIES']]);
    for (const g of model.items) all(g);
    for (const g of paperItems(layouts[0])) all(g);
    G(0, 'ENDSEC');
    // OBJECTS : dictionnaire racine, groupes, présentations, style de multiligne
    all([[0, 'SECTION'], [2, 'OBJECTS'],
      [0, 'DICTIONARY'], [5, O.root], [330, 0], [100, 'AcDbDictionary'], [281, 1],
      [3, 'ACAD_GROUP'], [350, O.group], [3, 'ACAD_LAYOUT'], [350, O.layout], [3, 'ACAD_MLINESTYLE'], [350, O.mls], [3, 'ACAD_PLOTSETTINGS'], [350, O.plot]]);
    const dict = (h, entries) => { all([[0, 'DICTIONARY'], [5, h], [102, '{ACAD_REACTORS'], [330, O.root], [102, '}'], [330, O.root], [100, 'AcDbDictionary'], [281, 1]]); for (const [k, v] of entries) all([[3, k], [350, v]]); };
    dict(O.group, []);
    dict(O.layout, [['Model', model.layoutH], ...layouts.map(L => [L.name, L.layoutH])]);
    dict(O.mls, [['Standard', O.mlsStd]]);
    dict(O.plot, []);
    all([[0, 'MLINESTYLE'], [5, O.mlsStd], [102, '{ACAD_REACTORS'], [330, O.mls], [102, '}'], [330, O.mls], [100, 'AcDbMlineStyle'], [2, 'Standard'], [70, 0], [3, ''],
      [62, 256], [51, '90.0'], [52, '90.0'], [71, 2], [49, '0.5'], [62, 256], [6, 'BYLAYER'], [49, '-0.5'], [62, 256], [6, 'BYLAYER']]);
    const layoutObj = (h, name, tab, recH, paper, lim0, lim1, vpH) => {
      all([[0, 'LAYOUT'], [5, h], [102, '{ACAD_REACTORS'], [330, O.layout], [102, '}'], [330, O.layout], [100, 'AcDbPlotSettings'],
        [1, ''], [2, 'none_device'], [4, ''], [6, ''], [40, '0.0'], [41, '0.0'], [42, '0.0'], [43, '0.0'], [44, num(paper[0])], [45, num(paper[1])],
        [46, '0.0'], [47, '0.0'], [48, '0.0'], [49, '0.0'], [140, '0.0'], [141, '0.0'], [142, '1.0'], [143, '1.0'],
        [70, tab ? 688 : 1712], [72, 1], [73, 0], [74, tab ? 5 : 0], [7, ''], [75, tab ? 16 : 0], [147, '1.0'], [148, '0.0'], [149, '0.0'],
        [100, 'AcDbLayout'], [1, name], [70, 1], [71, tab], [10, num(lim0[0])], [20, num(lim0[1])], [11, num(lim1[0])], [21, num(lim1[1])],
        [12, '0.0'], [22, '0.0'], [32, '0.0'], [14, num(lim0[0])], [24, num(lim0[1])], [34, '0.0'], [15, num(lim1[0])], [25, num(lim1[1])], [35, '0.0'],
        [146, '0.0'], [13, '0.0'], [23, '0.0'], [33, '0.0'], [16, '1.0'], [26, '0.0'], [36, '0.0'], [17, '0.0'], [27, '1.0'], [37, '0.0'], [76, 0], [330, recH]]);
      if (vpH) G(331, vpH);
    };
    layoutObj(model.layoutH, 'Model', 0, model.rec, [0, 0], E0, E1, null);
    layouts.forEach((L, i) => layoutObj(L.layoutH, L.name, i + 1, L.rec, L.paper, [0, 0], L.paper, L.vpH[0] || null));
    all([[0, 'ENDSEC'], [0, 'EOF']]);
    out[out.indexOf('@SEED')] = H();
    return out.join('\r\n') + '\r\n';

    /** Entités d'une présentation : fenêtre de la feuille (id 1), fenêtres demandées (id 2…), puis le dessin papier. */
    function paperItems(L) {
      const items = [];
      const vp = (h, id, c, s, vc, vh, layer) => [[0, 'VIEWPORT'], [5, h], [330, L.rec], [100, 'AcDbEntity'], [67, 1], [8, useLayer(layer ?? '0')], [100, 'AcDbViewport'],
        [10, num(c[0])], [20, num(c[1])], [30, '0.0'], [40, num(s[0])], [41, num(s[1])], [68, id === 1 ? 1 : 2], [69, id],
        [12, num(vc[0])], [22, num(vc[1])], [13, '0.0'], [23, '0.0'], [14, '1.0'], [24, '1.0'], [15, '1.0'], [25, '1.0'],
        [16, '0.0'], [26, '0.0'], [36, '1.0'], [17, '0.0'], [27, '0.0'], [37, '0.0'], [42, '50.0'], [43, '0.0'], [44, '0.0'], [45, num(vh)],
        [50, '0.0'], [51, '0.0'], [72, 1000], [90, 32864], [281, 0], [71, 1], [74, 0],
        [110, '0.0'], [120, '0.0'], [130, '0.0'], [111, '1.0'], [121, '0.0'], [131, '0.0'], [112, '0.0'], [122, '1.0'], [132, '0.0'], [79, 0], [146, '0.0']];
      if (L.vpH.length) {
        const p = L.paper;
        items.push(vp(L.vpH[0], 1, [p[0] / 2, p[1] / 2], [p[0] * 1.2, p[1] * 1.2], [p[0] / 2, p[1] / 2], p[1] * 1.2));
        L.vps.forEach((v, k) => items.push(vp(L.vpH[k + 1], k + 2, v.c, v.s, v.vc, v.vh, v.layer)));
      }
      return [...items, ...L.items];
    }
  };
  return w;
}
