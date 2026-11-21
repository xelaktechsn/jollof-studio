// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Export DXF de la conception réseau (module pur, sans interface) : pièces, murs, cheminements, tracés des câbles (cuivre
// et fibre), baies, prises, points d'accès et autres équipements placés, chacun sur le calque de son rôle, nommé selon un
// schéma de calques reconnu (AIA / NCS par défaut, ISO 13567, ou simple JOLLOF-*), couleurs et types de ligne par calque.
// Prises, points d'accès, baies et équipements sont des blocs avec attributs (ATTDEF dans le bloc quand l'écrivain le
// permet, ATTRIB à chaque insertion) : identifiant, VLAN, port, SSID, canaux, PoE, adresse IP, baie, U…
// Un étage qui a un fond de plan importé (data.underlays) est écrit DANS LES COORDONNÉES DU DESSIN D'ORIGINE (unités du
// fichier de l'architecte) : le DXF exporté se superpose à son fichier. Sans fond : mètres du plan (y vers le haut).
//
// Repères (voir cad/store.js et ui/plan-underlay.js) : un point de l'étage W (m, y vers le bas) → repère du fond
// p = T⁻¹(W) (transform { dx, dy, rot, scale } : tourner, mettre à l'échelle, décaler) → dessin X = origine + région.x0 +
// p.x / toMetre, Y = origine + région.y1 − p.y / toMetre (le fond garde le haut du dessin en haut : y retourné).
import { tl } from '../i18n/index.js';
import { createDxfWriter } from './cad/dxfwrite.js';
import { floorsOf, polyCentroid } from './dimension.js';
import { labeler } from './docs.js';
import { specOf } from './devices.js';
import { NET } from './limits.js';
import * as ROUTE from './route.js';
import * as WIFI from './wifi.js';
import * as LAYERS from './cad/layers.js';

/**
 * Rôles des calques → [nom, couleur ACI, type de ligne]. AIA / NCS : discipline T (télécommunications), groupes majeurs
 * JACK, EQPM, CABL, DATA, modificateurs IDEN (étiquettes), TEXT, SHBD-TTLB (cartouche), architecture A-AREA, A-WALL
 * (convention publique qui suit les AIA CAD Layer Guidelines : NET.DXF_NCS_LAYERS). ISO 13567 : agent (2) + élément (6)
 * + présentation (2) ; les codes d'élément sont propres au projet (la norme laisse le choix de la classification).
 */
const NCS = NET.DXF_NCS_LAYERS.v, ISO = NET.ISO13567_FIELDS.v;
const iso = (agent, el, pres) => (agent.padEnd(ISO.agent, '-') + el.padEnd(ISO.element, '-') + pres.padEnd(ISO.presentation, '-')).toUpperCase();
export const DXF_SCHEMES = {
  standard: {
    name: () => tl('AIA / NCS (T-JACK, T-CABL…)'),
    layers: {
      rooms: [NCS.area, 8, 'Continuous'], roomText: [NCS.area + '-IDEN', 8, 'Continuous'], walls: [NCS.wall, 250, 'Continuous'],
      pathways: [NCS.tray, 30, 'DASHED'], cables: [NCS.cable, 5, 'Continuous'], fibre: [NCS.fibre, 40, 'HIDDEN'],
      racks: [NCS.equipment, 170, 'Continuous'], rackText: [NCS.equipment + '-IDEN', 170, 'Continuous'],
      outlets: [NCS.jack, 150, 'Continuous'], outletText: [NCS.jack + '-IDEN', 7, 'Continuous'],
      aps: [NCS.data + '-EQPM', 3, 'Continuous'], apText: [NCS.data + '-IDEN', 3, 'Continuous'],
      devices: [NCS.data, 4, 'Continuous'], deviceText: [NCS.data + '-TEXT', 4, 'Continuous'],
      titles: ['T-TEXT', 7, 'Continuous'], titleBlock: ['T-SHBD-TTLB', 7, 'Continuous']
    }
  },
  iso: {
    name: () => tl('ISO 13567 (T-JACK--E-…)'),
    layers: {
      rooms: [iso('A', 'AREA', 'E'), 8, 'Continuous'], roomText: [iso('A', 'AREA', 'T'), 8, 'Continuous'], walls: [iso('A', 'WALL', 'E'), 250, 'Continuous'],
      pathways: [iso('T', 'TRAY', 'E'), 30, 'DASHED'], cables: [iso('T', 'CABL', 'E'), 5, 'Continuous'], fibre: [iso('T', 'CABLFI', 'E'), 40, 'HIDDEN'],
      racks: [iso('T', 'EQPM', 'E'), 170, 'Continuous'], rackText: [iso('T', 'EQPM', 'T'), 170, 'Continuous'],
      outlets: [iso('T', 'JACK', 'E'), 150, 'Continuous'], outletText: [iso('T', 'JACK', 'T'), 7, 'Continuous'],
      aps: [iso('T', 'WLAN', 'E'), 3, 'Continuous'], apText: [iso('T', 'WLAN', 'T'), 3, 'Continuous'],
      devices: [iso('T', 'DATA', 'E'), 4, 'Continuous'], deviceText: [iso('T', 'DATA', 'T'), 4, 'Continuous'],
      titles: [iso('T', 'ANNO', 'T'), 7, 'Continuous'], titleBlock: [iso('T', 'SHBD', 'E'), 7, 'Continuous']
    }
  },
  simple: {
    name: () => tl('Simple (JOLLOF-OUTLETS…)'),
    layers: {
      rooms: ['JOLLOF-ROOMS', 8, 'Continuous'], roomText: ['JOLLOF-ROOMS', 8, 'Continuous'], walls: ['JOLLOF-WALLS', 250, 'Continuous'],
      pathways: ['JOLLOF-PATHWAYS', 30, 'DASHED'], cables: ['JOLLOF-CABLES', 5, 'Continuous'], fibre: ['JOLLOF-CABLES', 5, 'Continuous'],
      racks: ['JOLLOF-RACKS', 170, 'Continuous'], rackText: ['JOLLOF-LABELS', 7, 'Continuous'],
      outlets: ['JOLLOF-OUTLETS', 150, 'Continuous'], outletText: ['JOLLOF-LABELS', 7, 'Continuous'],
      aps: ['JOLLOF-APS', 3, 'Continuous'], apText: ['JOLLOF-LABELS', 7, 'Continuous'],
      devices: ['JOLLOF-DEVICES', 4, 'Continuous'], deviceText: ['JOLLOF-LABELS', 7, 'Continuous'],
      titles: ['JOLLOF-TITLES', 7, 'Continuous'], titleBlock: ['JOLLOF-TITLES', 7, 'Continuous']
    }
  }
};
/** Correspondance de nos schémas avec ceux de cad/layers.js (partie lecture/écriture CAO), et de nos rôles avec ses clés. */
const SCHEME_IDS = { standard: 'ncs', iso: 'iso13567', simple: 'jollof', ncs: 'ncs', iso13567: 'iso13567', jollof: 'jollof' };
const ROLE_KEY = { rooms: 'rooms', roomText: 'labels', walls: 'walls', pathways: 'pathways', cables: 'cables', fibre: 'fibre', racks: 'racks', rackText: 'labels', outlets: 'outlets', outletText: 'labels', aps: 'aps', apText: 'labels', devices: 'devices', deviceText: 'labels', titles: 'titles', titleBlock: 'sheet' };
/**
 * Calques d'un schéma : ceux de cad/layers.js (layerDefs : nom, couleur, type de ligne, épaisseur, impression) quand il
 * existe — un seul jeu de noms pour toute l'application —, sinon les nôtres. Rend { rôle: [nom, couleur, type de ligne, lw, plot] }.
 */
export function schemeOf(name) {
  if (typeof LAYERS.layerDefs === 'function') {
    const defs = new Map(LAYERS.layerDefs({ scheme: SCHEME_IDS[name] || 'ncs' }).map(d => [d.key, d]));
    if (defs.size) return Object.fromEntries(Object.entries(ROLE_KEY).map(([role, key]) => { const d = defs.get(key) || defs.get('labels'); return [role, [d.name, d.color, d.ltype || 'Continuous', d.lw, d.plot]]; }));
  }
  return (DXF_SCHEMES[name] || DXF_SCHEMES.standard).layers;
}
/** Schémas proposés à l'utilisateur : [[id, nom affiché]]. */
export function schemeChoices() {
  if (LAYERS.LAYER_SCHEMES) return [['standard', tl('AIA / NCS (T-JACK, T-CABL…)')], ['iso', tl('ISO 13567 (T-JACK--E-…)')], ['simple', tl('Simple (JOLLOF-OUTLETS…)')]].filter(([k]) => LAYERS.LAYER_SCHEMES[SCHEME_IDS[k]]);
  return Object.entries(DXF_SCHEMES).map(([k, v]) => [k, v.name()]);
}
/** Ancien nom (simple) gardé pour les appelants : calques JOLLOF-*. */
export const DXF_LAYERS = Object.fromEntries(Object.entries(DXF_SCHEMES.simple.layers).map(([k, v]) => [k, v]));
/** Types de ligne écrits dans la table LTYPE (motifs en mètres de l'étage, mis à l'échelle de sortie). */
const LTYPES = { DASHED: { desc: 'Dashed __ __ __', pattern: [0.5, -0.25] }, HIDDEN: { desc: 'Hidden _ _ _ _', pattern: [0.25, -0.125] } };
const TO_M = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048, unitless: 1 };
/** Unités DXF d'un facteur vers le mètre (le plus proche connu). */
const unitOf = tm => Object.keys(TO_M).find(k => k !== 'unitless' && Math.abs(TO_M[k] - tm) / tm < 1e-6) || 'unitless';

/** Fond de plan d'un étage, avec le repère de son paquet (meta) quand il existe. */
export function underlayOf(data, floorId) {
  const u = data.underlays && data.underlays[floorId]; if (!u) return null;
  const m = u.pack && Array.isArray(u.pack.region) ? u.pack : u;
  const region = m.region, toMetre = +m.toMetre || +u.toMetre || 1, origin = m.origin || u.origin || [0, 0];
  if (!Array.isArray(region) || !(region[2] > region[0]) || !(region[3] > region[1])) return null;
  return { u, region, toMetre, origin, transform: u.transform || { dx: 0, dy: 0, rot: 0, scale: 1 }, units: (u.source && u.source.units) || unitOf(toMetre) };
}
/**
 * Passage du repère de l'étage (m, y vers le bas) au repère du DXF. o : { toMetre (unité de sortie), off: [x, y] (étage sans
 * fond, décalage en unités de sortie) }. Rend { map(x, y) → [X, Y], k (mètres de l'étage → unités de sortie), under }.
 */
export function floorMapper(data, floorId, o = {}) {
  const out = o.toMetre || 1, ul = underlayOf(data, floorId);
  if (!ul) { const off = o.off || [0, 0]; return { map: (x, y) => [x / out + off[0], -y / out + off[1]], k: 1 / out, under: false }; }
  const t = ul.transform, a = (t.rot || 0) * Math.PI / 180, s = t.scale || 1, c = Math.cos(a) * s, n = Math.sin(a) * s, d = s * s;
  const f = ul.toMetre / out; // unités du fond → unités de sortie
  return {
    map(X, Y) {
      const x = X - (t.dx || 0), y = Y - (t.dy || 0), px = (c * x + n * y) / d, py = (-n * x + c * y) / d;
      return [(ul.origin[0] + ul.region[0] + px / ul.toMetre) * f, (ul.origin[1] + ul.region[3] - py / ul.toMetre) * f];
    },
    k: 1 / (s * out), under: true
  };
}
/** Bas des fonds exportés (unités de sortie) : les étages sans fond se rangent dessous. */
function underMinY(data, fls, out) {
  let m = Infinity;
  for (const { f } of fls) { const ul = underlayOf(data, f.id); if (ul) m = Math.min(m, (ul.origin[1] + ul.region[1]) * ul.toMetre / out); }
  return Number.isFinite(m) ? m : 0;
}
/** Angle (degrés, sens trigo du DXF) d'une direction de l'étage (radians, y vers le bas) une fois passée par map. */
const angleOf = (M, x, y, a = 0) => { const p = M.map(x, y), q = M.map(x + Math.cos(a), y + Math.sin(a)); return Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI; };

/* ---------- Attributs des blocs ---------- */
/** Port de switch au bout d'un port d'appareil, à travers prises et panneaux (ports passifs) : [switch, port] ou null. */
export function switchPortOf(data, at, devs, devId, portId) {
  let cur = [devId, portId];
  for (let hop = 0; hop < 8; hop++) {
    const c = at.get(cur.join('|')); if (!c) return null;
    const far = c.a[0] === cur[0] && c.a[1] === cur[1] ? c.b : c.a, d = devs.get(far[0]); if (!d) return null;
    const s = specOf(d), p = s && s.ports(d.p || {}).find(x => x.id === far[1]); if (!p) return null;
    if (!p.passive) return (s.role === 'switch' ? [d, far[1]] : null);
    cur = [far[0], p.passive];
  }
  return null;
}
const vlanAt = sp => { if (!sp) return ''; const c = sp[0].p && sp[0].p.ports && sp[0].p.ports[sp[1]]; return c ? (c.mode === 'trunk' ? 'trunk' : String(c.vlan ?? 1)) + (c.voice ? '+' + c.voice : '') : '1'; };
const ipOf = d => { const ip = d.p && d.p.ip; return ip ? (ip.mode === 'static' && ip.ip ? `${ip.ip}/${ip.prefix ?? 24}` : ip.mode === 'dhcp' ? 'DHCP' : '') : ''; };
const ATTRS = { outlet: ['LABEL', 'ID', 'VLAN', 'PORT'], ap: ['NAME', 'SSID', 'CHANNELS', 'POE'], rack: ['NAME', 'U', 'ROOM'], device: ['NAME', 'TYPE', 'IP', 'VLAN', 'RACK', 'U'] };

/**
 * DXF de la conception. o : { floors: [ids] (défaut : tous), scheme: 'standard'|'iso'|'simple' (défaut : celui du projet,
 * data.design.exports.dxfScheme), titleBlock (projet, client… : cartouche dans l'espace papier si l'écrivain le permet) }.
 * Unités : celles du premier fond de plan exporté, sinon le mètre. Les étages sans fond sont placés en ligne, sous ce qui est
 * déjà dessiné, chacun titré. Rend { text, units, floors, under (étages exportés sur leur fond), scheme, layers: [noms],
 * counts: { outlets, aps, racks, devices, cables, paths, rooms }, features: { attdef, ltype, style, layout } }.
 */
export function designDxf(data, o = {}) {
  const all = floorsOf(data), want = Array.isArray(o.floors) && o.floors.length ? new Set(o.floors) : null;
  const fls = all.filter(x => !want || want.has(x.f.id));
  const first = fls.map(x => underlayOf(data, x.f.id)).find(Boolean), toMetre = first ? first.toMetre : 1;
  const units = first ? unitOf(toMetre) : 'm';
  const schemeName = DXF_SCHEMES[o.scheme] ? o.scheme : DXF_SCHEMES[((data.design || {}).exports || {}).dxfScheme] ? data.design.exports.dxfScheme : 'standard';
  const S = schemeOf(schemeName), LY = k => S[k][0];
  const w = createDxfWriter({ units: units === 'unitless' ? 'unitless' : units });
  // Possibilités de l'écrivain (cad/dxfwrite.js) : types de ligne, style de texte, définitions d'attributs, espace papier.
  const features = { ltype: typeof w.ltype === 'function', style: typeof w.style === 'function', attdef: false, layout: typeof w.layout === 'function' };
  const sc = 1 / toMetre; // longueur d'un mètre d'étage en unités de sortie (sans échelle de fond)
  if (features.ltype) for (const [n, L] of Object.entries(LTYPES)) w.ltype(n, { desc: L.desc, pattern: L.pattern.map(v => v * sc) });
  if (features.style) w.style('JOLLOF', { font: 'arial.ttf' });
  const textO = features.style ? { style: 'JOLLOF' } : {};
  const done = new Set();
  for (const k of Object.keys(S)) { const [n, c, lt, lw, plot] = S[k]; if (done.has(n)) continue; done.add(n); w.layer(n, { color: c, ltype: features.ltype && LTYPES[lt] ? lt : 'Continuous', ...(lw != null ? { lw } : {}), ...(plot === false ? { plot: false } : {}) }); }
  // Blocs (un mètre de côté, mis à l'échelle à l'insertion), avec leurs définitions d'attributs.
  const blockWith = (name, tags, draw) => w.block(name, { base: [0, 0] }, b => {
    draw(b);
    if (typeof b.attdef === 'function') { features.attdef = true; tags.forEach((t, i) => b.attdef(t, { x: 0.7, y: -0.2 - i * 0.3, h: 0.2, prompt: t, invisible: i > 0, layer: '0' })); }
  });
  blockWith('JOLLOF_OUTLET', ATTRS.outlet, b => { b.polyline([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], { layer: '0', closed: true }); b.line(-0.5, -0.5, 0.5, 0.5, { layer: '0' }); });
  blockWith('JOLLOF_AP', ATTRS.ap, b => { b.circle(0, 0, 0.5, { layer: '0' }); b.circle(0, 0, 0.2, { layer: '0' }); });
  blockWith('JOLLOF_RACK', ATTRS.rack, b => { b.polyline([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], { layer: '0', closed: true }); b.line(-0.5, 0.35, 0.5, 0.35, { layer: '0' }); });
  blockWith('JOLLOF_DEVICE', ATTRS.device, b => { b.polyline([[0, 0.5], [0.5, 0], [0, -0.5], [-0.5, 0]], { layer: '0', closed: true }); });
  const Lb = labeler(data), devList = data.devices || [], devs = new Map(devList.map(d => [d.id, d])), at = new Map();
  for (const c of data.cables || []) { at.set(c.a.join('|'), c); at.set(c.b.join('|'), c); }
  const counts = { outlets: 0, aps: 0, racks: 0, devices: 0, cables: 0, paths: 0, rooms: 0 };
  const g = (data.paths || []).length && typeof ROUTE.graphOf === 'function' ? (() => { try { return ROUTE.graphOf(data); } catch (e) { return null; } })() : null;
  const legsOf = new Map(); // étage → [{ pts, fibre }]
  if (typeof ROUTE.routeCable === 'function') for (const c of data.cables || []) {
    if (!c.route || c.route.mode !== 'auto') continue;
    let r = null; try { r = ROUTE.routeCable(data, c, true, g || undefined); } catch (e) { r = null; }
    for (const leg of (r && r.legs) || []) if (leg.pts.length > 1) { if (!legsOf.has(leg.floor)) legsOf.set(leg.floor, []); legsOf.get(leg.floor).push({ pts: leg.pts, fibre: c.media === 'fibre' }); }
  }
  let rowX = 0, rowY = 0, placed = false, under = 0;
  const bb = [Infinity, Infinity, -Infinity, -Infinity]; // étendue écrite (pour la fenêtre de la présentation)
  const extentM = f => { const pts = []; for (const r of f.rooms || []) pts.push(...(r.poly || [])); for (const wl of f.walls || []) pts.push(wl.a, wl.b); for (const d of devList) if (d.loc && d.loc.floor === f.id) pts.push([d.loc.x, d.loc.y]); if (!pts.length) return [0, 0, 10, 10]; return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))]; };
  for (const { b, f } of fls) {
    let M = floorMapper(data, f.id, { toMetre });
    if (!M.under) {
      const e = extentM(f);
      if (!placed && first) { rowY = underMinY(data, fls, toMetre) - 20 / toMetre; placed = true; } // sous le dessin d'origine
      M = floorMapper(data, f.id, { toMetre, off: [rowX - e[0] / toMetre, rowY + e[1] / toMetre] });
      rowX += (e[2] - e[0] + 10) / toMetre;
    } else under++;
    const k = M.k, P = (x, y) => { const q = M.map(x, y); if (q[0] < bb[0]) bb[0] = q[0]; if (q[1] < bb[1]) bb[1] = q[1]; if (q[0] > bb[2]) bb[2] = q[0]; if (q[1] > bb[3]) bb[3] = q[1]; return q; }, T = (x, y, h, s, lay, extra = {}) => w.text(...P(x, y), h * k, s, { layer: LY(lay), rot: angleOf(M, x, y), ...textO, ...extra });
    const top = (f.rooms || []).flatMap(r => r.poly || []).concat((f.walls || []).flatMap(x => [x.a, x.b]));
    const tx = top.length ? Math.min(...top.map(p => p[0])) : 0, ty = top.length ? Math.min(...top.map(p => p[1])) - 1.5 : -1.5;
    T(tx, ty, 0.6, `${b.name || b.id} - ${f.name || f.id}`, 'titles');
    for (const r of f.rooms || []) {
      if (!(r.poly || []).length) continue; counts.rooms++;
      w.polyline(r.poly.map(p => P(p[0], p[1])), { layer: LY('rooms'), closed: true });
      const c = polyCentroid(r.poly); T(c[0], c[1], 0.3, r.name || r.id, 'roomText', { align: 'center', valign: 'middle' });
    }
    if (!M.under) for (const wl of f.walls || []) w.line(...P(...wl.a), ...P(...wl.b), { layer: LY('walls') });
    for (const p of data.paths || []) {
      if (p.floor !== f.id) continue; counts.paths++;
      if (p.kind === 'riser') { w.circle(...P(...p.pts[0]), 0.3 * k, { layer: LY('pathways') }); continue; }
      if (p.kind === 'outdoor') continue; // fourreau extérieur : deux étages
      w.polyline(p.pts.map(q => P(q[0], q[1])), { layer: LY('pathways') });
    }
    for (const l of legsOf.get(f.id) || []) { w.polyline(l.pts.map(q => P(q[0], q[1])), { layer: LY(l.fibre ? 'fibre' : 'cables') }); counts.cables++; }
    for (const r of data.racks || []) {
      if (r.floor !== f.id) continue; counts.racks++;
      const wM = (+r.w || 600) / 1000, dM = (+r.d || 800) / 1000, room = (f.rooms || []).find(x => x.id === r.room);
      w.insert('JOLLOF_RACK', ...P(r.x, r.y), { layer: LY('racks'), sx: wM * k, sy: dM * k, rot: angleOf(M, r.x, r.y, (+r.rot || 0) * Math.PI / 180), attribH: 0.15 * k, attribs: { NAME: Lb.rack(r.id), U: String(r.u || ''), ROOM: room ? room.name || room.id : '' } });
      T(r.x, r.y - dM / 2 - 0.3, 0.25, Lb.rack(r.id), 'rackText', { align: 'center' });
    }
    for (const d of devList) {
      if (!d.loc || d.loc.floor !== f.id) continue;
      const [X, Y] = P(d.loc.x, d.loc.y), rot = angleOf(M, d.loc.x, d.loc.y), s = specOf(d);
      if (d.type === 'outlet' || d.type === 'outlet2') {
        counts.outlets++; const lab = Lb.of(d.id) || d.name, sps = s.ports(d.p || {}).filter(p => p.passive && !p.punch).map(p => switchPortOf(data, at, devs, d.id, p.passive)).filter(Boolean);
        w.insert('JOLLOF_OUTLET', X, Y, { layer: LY('outlets'), sx: 0.3 * k, sy: 0.3 * k, rot, attribH: 0.15 * k, attribs: { LABEL: lab, ID: d.id, VLAN: [...new Set(sps.map(vlanAt))].join(' '), PORT: sps.map(sp => `${sp[0].name}:${sp[1]}`).join(' ') } });
        T(d.loc.x + 0.3, d.loc.y, 0.18, lab, 'outletText', { valign: 'middle' });
      } else if (WIFI.AP_TYPES ? WIFI.AP_TYPES.includes(d.type) : /^ap/.test(d.type)) {
        counts.aps++;
        let ch = ''; try { const r = WIFI.radiosOf(d); ch = Object.entries(r).filter(([, x]) => x && x.on).map(([bnd, x]) => `${WIFI.BAND_NAME ? WIFI.BAND_NAME[bnd] : bnd} ch${x.ch}${x.w ? '/' + x.w : ''}`).join(', '); } catch (e) { ch = ''; }
        const sp = switchPortOf(data, at, devs, d.id, (s.ports(d.p || {})[0] || {}).id);
        w.insert('JOLLOF_AP', X, Y, { layer: LY('aps'), sx: 0.5 * k, sy: 0.5 * k, rot, attribH: 0.15 * k, attribs: { NAME: d.name, SSID: (d.p && (d.p.ssid || (d.p.wlans && d.p.wlans[0] && d.p.wlans[0].ssid))) || '', CHANNELS: ch, POE: d.p && d.p.power === 'adapter' ? 'adapter' : `class ${d.p && d.p.poeClass != null ? d.p.poeClass : ''}${sp ? ' ' + sp[0].name + ':' + sp[1] : ''}` } });
        T(d.loc.x + 0.35, d.loc.y, 0.2, d.name, 'apText', { valign: 'middle' });
      } else if (s && s.role !== 'mech' && s.role !== 'passive') {
        counts.devices++; const sp = switchPortOf(data, at, devs, d.id, (s.ports(d.p || {})[0] || {}).id);
        w.insert('JOLLOF_DEVICE', X, Y, { layer: LY('devices'), sx: 0.4 * k, sy: 0.4 * k, rot, attribH: 0.15 * k, attribs: { NAME: d.name, TYPE: d.type, IP: ipOf(d), VLAN: vlanAt(sp), RACK: d.rack ? Lb.rack(d.rack.id) : '', U: d.rack ? String(d.rack.u) : '' } });
        T(d.loc.x + 0.3, d.loc.y, 0.18, d.name, 'deviceText', { valign: 'middle' });
      }
    }
  }
  // Cartouche dans l'espace papier (si l'écrivain sait faire une présentation).
  if (features.layout && o.titleBlock !== false) {
    const D = data.design || {}, P = D.project || {}, tb = o.titleBlock || {};
    try {
      w.layout('JOLLOF-A3', { paper: [420, 297], units: 'mm' }, p => {
        p.polyline([[10, 10], [410, 10], [410, 287], [10, 287]], { layer: LY('titleBlock'), closed: true });
        p.polyline([[235, 10], [410, 10], [410, 56], [235, 56]], { layer: LY('titleBlock'), closed: true });
        const rows = [['Project', tb.site || P.site || (data.site && data.site.name) || ''], ['Client', tb.client || P.client || ''], ['Author', P.author || ''], ['Date', P.date || ''], ['Revision', P.rev || '']];
        rows.forEach(([k2, v], i) => p.text(238, 50 - i * 8, 3, `${k2}: ${v}`, { layer: LY('titleBlock'), ...textO }));
        if (typeof p.viewport === 'function' && Number.isFinite(bb[0])) { const wv = bb[2] - bb[0], hv = bb[3] - bb[1]; p.viewport({ center: [210, 168], size: [390, 216], view: { center: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], height: Math.max(hv, (wv * 216) / 390) * 1.08 } }); }
      });
    } catch (e) { features.layout = false; }
  }
  return { text: w.toString(), units, floors: fls.length, under, scheme: schemeName, layers: [...done], counts, features };
}
