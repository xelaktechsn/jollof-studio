// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vues du projet réseau mises à plat pour les échanges de schémas (Visio .vsdx : vsdx.js ; draw.io : drawio.js) : module
// pur, sans interface. Une page par vue : le schéma logique, l'élévation de chaque baie (faces avant et arrière côte à
// côte), le plan de chaque étage (pièces, murs, cheminements, baies, prises, points d'accès, autres équipements placés).
// Les deux écrivains partent de ce même modèle neutre, ce qui garde les deux formats cohérents (mêmes pages, calques,
// formes, données).
//
// buildViews(data, o) → { title, pages, masters, stats }
//   o : { views: { logic: bool, racks: bool | [ids], floors: bool | [ids] } (défaut : tout), ipOf(devId) → 'a.b.c.d/nn'
//         (adresses de la simulation, sinon les réglages statiques), names: {…} (libellés traduits, défaut : tl) }
//   page : { key, kind: 'logic'|'rack'|'floor', name, unit: 'px'|'mm'|'m', scale (1:scale, papier:réel), box: { x0, y0,
//            x1, y1 } (unités de la page, y vers le bas), layers: [{ key, name }], shapes, edges }
//   forme : { id (unique dans la page), kind, master? (clé de masters), layers: [clés], geom: 'rect'|'ellipse'|'poly'|'line'|
//            'text', x, y, w, h (boîte avant rotation, coin haut gauche), rot (degrés, sens horaire à l'écran), rings (poly :
//            anneaux, le premier est le contour, les suivants des trous), pts (line : polyligne), text, style: { fill, line,
//            lw (pt), dash, font (pt), ink, bold, align }, props: { Label, IP, VLAN, Rack, U, Category, Length, Type },
//            ref: { kind, id } (objet du projet) }
//   lien : { id, from, to (formes de la page), text, layers, style, props, ref }
// Les unités : schéma logique en unités de l'écran (100 par pouce, comme draw.io), baies en millimètres réels (1:10), plans
// en mètres réels, l'échelle choisie pour que l'étage tienne sur une grande feuille de 840 × 594 mm (1:50 … 1:2000, choix de mise en page).
import { tl } from '../../i18n/index.js';
import { DEVICES, specOf } from '../devices.js';
import { CATS } from '../cable.js';
import { FIBRE_TYPES } from '../fibre.js';
import { USAGES, roomPoint, bbox as bboxA } from '../site.js';
import { PATH_KINDS } from '../route.js';
import { floorsOf } from '../dimension.js';
import { labeler } from '../docs.js';
import { U_MM, PANEL_MM, mountDev } from '../rack.js';

/**
 * Clés des données de forme (lignes de la section Shape Data de Visio, attributs de draw.io), dans l'ordre d'affichage.
 * PortA / PortB : ports des deux bouts d'un câble (identifiants du projet), relus par l'import pour rebrancher au même port.
 */
export const PROP_KEYS = ['Label', 'Type', 'IP', 'VLAN', 'Rack', 'U', 'Category', 'Length', 'PortA', 'PortB'];
/** Lignes définies dans les gabarits d'équipements (les ports ne concernent que les câbles). */
export const DEVICE_KEYS = PROP_KEYS.filter(k => !k.startsWith('Port'));
export const propNames = () => ({ Label: tl('Étiquette'), Type: tl('Modèle'), IP: tl('Adresse IP'), VLAN: 'VLAN', Rack: tl('Baie'), U: tl('Unité (U)'), Category: tl('Catégorie'), Length: tl('Longueur (m)'), PortA: tl('Port de départ'), PortB: tl('Port d’arrivée') });
/** Calques : clé → nom affiché. */
export const layerNames = () => ({
  devices: tl('Équipements'), cables: tl('Câbles'), labels: tl('Étiquettes'), rooms: tl('Salles'), walls: tl('Murs'), pathways: tl('Cheminements'),
  racks: tl('Baies'), outlets: tl('Prises'), aps: tl('Points d’accès'), frame: tl('Châssis')
});
/**
 * Échelles des plans (1:n), essayées de la plus grande à la plus petite, et feuille visée [largeur, hauteur, marge] en mm :
 * choix de mise en page (pas une règle), l'utilisateur change l'échelle ensuite dans Visio (Mise en page) s'il le veut.
 */
const PLAN_SCALES = [50, 100, 200, 500, 1000, 2000], SHEET = [840, 594, 15];
const RACK_SCALE = 10, RAIL_MM = PANEL_MM; // largeur d'une façade 19 pouces (rack.js)
const num = v => (Number.isFinite(+v) ? +v : 0);
const r3 = v => Math.round(v * 1000) / 1000;
const isOutlet = d => d.type === 'outlet' || d.type === 'outlet2';
const isAp = d => (specOf(d) || {}).role === 'ap';
const bbox = pts => { const [x0, y0, x1, y1] = bboxA(pts); return { x0, y0, x1, y1 }; };
const isPanel = d => /^patch/.test(d.type) || d.type === 'fibrepanel';

/* ---------- Couleurs (styles cohérents d'un format à l'autre) ---------- */
const FAM = {
  switch: { fill: '#dbeafe', line: '#1d4ed8' }, router: { fill: '#ede9fe', line: '#6d28d9' }, ap: { fill: '#dcfce7', line: '#15803d' },
  host: { fill: '#f1f5f9', line: '#475569' }, passive: { fill: '#fef3c7', line: '#b45309' }, mech: { fill: '#e2e8f0', line: '#64748b' }
};
const famOf = type => { const r = (DEVICES[type] || {}).role; return r === 'switch' ? 'switch' : r === 'router' || r === 'l3' ? 'router' : r === 'ap' ? 'ap' : r === 'passive' ? 'passive' : r === 'mech' ? 'mech' : 'host'; };
const INK = '#0f172a';

/* ---------- Données d'un équipement ---------- */
/** Port de switch au bout d'un port d'appareil (à travers prises et panneaux) : [switch, port] ou null. */
function switchPort(at, devs, devId, portId) {
  let cur = [devId, portId];
  for (let hop = 0; hop < 8; hop++) {
    const c = at.get(cur.join('|')); if (!c) return null;
    const far = c.a[0] === cur[0] && c.a[1] === cur[1] ? c.b : c.a, d = devs.get(far[0]); if (!d) return null;
    const s = specOf(d), p = s && s.ports(d.p || {}).find(x => x.id === far[1]); if (!p) return null;
    if (!p.passive) return s.role === 'switch' ? [d, far[1]] : null;
    cur = [far[0], p.passive];
  }
  return null;
}
const vlanOfPort = sp => { if (!sp) return ''; const c = sp[0].p && sp[0].p.ports && sp[0].p.ports[sp[1]]; return c ? (c.mode === 'trunk' ? 'trunk' : String(c.vlan ?? 1)) + (c.voice ? '+' + c.voice : '') : '1'; };
const staticIp = d => { const ip = d.p && d.p.ip; return ip ? (ip.mode === 'static' && ip.ip ? `${ip.ip}/${ip.prefix ?? 24}` : ip.mode === 'dhcp' ? 'DHCP' : '') : ''; };

function context(data, o) {
  const devs = new Map((data.devices || []).map(d => [d.id, d])), at = new Map();
  for (const c of data.cables || []) { at.set(c.a.join('|'), c); at.set(c.b.join('|'), c); }
  const L = labeler(data);
  const racks = new Map((data.racks || []).map(r => [r.id, r]));
  /** VLAN d'un équipement : celui du port de switch où mène son premier port (prise et panneau traversés). */
  function vlanOf(d) {
    const s = specOf(d); if (!s) return '';
    if (isOutlet(d)) { const ports = s.ports(d.p || {}); for (const p of ports) { const sp = switchPort(at, devs, d.id, p.id); if (sp) return vlanOfPort(sp); } return ''; }
    if (s.role === 'switch' || s.role === 'passive' || s.role === 'mech') return '';
    for (const p of s.ports(d.p || {})) { const c = at.get(d.id + '|' + p.id); if (!c) continue; const far = c.a[0] === d.id ? c.b : c.a, F = devs.get(far[0]); if (!F) continue; const fs = specOf(F), fp = fs && fs.ports(F.p || {}).find(x => x.id === far[1]); const sp = fp && fp.passive ? switchPort(at, devs, far[0], fp.passive) : fs && fs.role === 'switch' ? [F, far[1]] : null; if (sp) return vlanOfPort(sp); }
    return '';
  }
  function devProps(d) {
    const s = specOf(d) || {}, ip = (o.ipOf && o.ipOf(d.id)) || staticIp(d), mu = d.rack ? (mountDev(d) || {}).u : 0;
    return {
      Label: (isOutlet(d) || isPanel(d) ? L.of(d.id) : '') || d.tag || d.name || d.id, Type: s.name ? s.name() : d.type, IP: ip || '', VLAN: vlanOf(d),
      Rack: d.rack ? L.rack(d.rack.id) || (racks.get(d.rack.id) || {}).name || d.rack.id : '', U: d.rack ? (mu > 1 ? `${d.rack.u}-${d.rack.u + mu - 1}` : String(d.rack.u)) : '',
      Category: '', Length: ''
    };
  }
  const catOf = c => (c.media === 'fibre' ? (FIBRE_TYPES[c.fibre] ? FIBRE_TYPES[c.fibre].name || String(c.fibre).toUpperCase() : String(c.fibre || 'fibre').toUpperCase()) : (CATS[c.cat] || {}).name || c.cat || '');
  const cableProps = c => ({ Label: L.cable(c) || c.tag || c.id, Type: c.media === 'fibre' ? tl('Fibre optique') : tl('Cuivre'), IP: '', VLAN: '', Rack: '', U: '', Category: catOf(c), Length: r3(num(c.len)), PortA: c.a[1], PortB: c.b[1] });
  return { devs, L, racks, devProps, cableProps };
}

/**
 * Taille du texte (pt) pour qu'un nom tienne dans la largeur de sa forme sur le papier (pouces) : de 8 pt à 5 pt
 * (estimation : un caractère ≈ 0,55 × la taille) ; au-delà, le texte passe à la ligne dans la forme.
 */
export const fitFont = (text, wIn, base = 8) => { const n = Math.max(1, String(text || '').length), f = wIn * 72 * 0.9 / (0.55 * n); return Math.round(Math.max(5, Math.min(base, f)) * 2) / 2; };
/**
 * Texte et taille pour une forme de wIn × hIn pouces sur le papier : la taille de fitFont, puis, si le nom ne tient
 * toujours pas (lignes de 1,2 × la taille dans la hauteur), il est coupé par « … » ; le nom entier reste dans les données de forme.
 */
export function fitText(text, wIn, hIn, base = 8) {
  const t = String(text || ''), font = fitFont(t, wIn, base);
  const perLine = Math.max(1, Math.floor(wIn * 72 * 0.9 / (0.55 * font))), lines = Math.max(1, Math.floor((hIn * 72 - 4) / (1.2 * font))); // 2 pt de marge en haut et en bas
  const cap = lines > 1 ? Math.floor(perLine * lines * 0.85) : perLine; // retour à la ligne : marge pour les coupures entre les mots
  return { font, text: t.length > cap ? t.slice(0, Math.max(1, cap - 1)).trimEnd() + '…' : t };
}
/* ---------- Gabarits (masters Visio, styles draw.io) : un par type d'équipement utilisé ---------- */
function masterOf(masters, type) {
  if (!masters.has(type)) {
    const s = DEVICES[type] || {}, f = FAM[famOf(type)];
    masters.set(type, { key: type, name: s.name ? s.name() : type, geom: famOf(type) === 'ap' ? 'ellipse' : 'rect', style: { fill: f.fill, line: f.line, lw: 1, font: 8, ink: INK } });
  }
  return type;
}

/* ---------- Schéma logique ---------- */
/**
 * Formes qui se chevauchent (positions jamais montrées : la vue logique regroupe les appareils derrière leur switch)
 * poussées vers la droite, rangée par rangée, pour qu'aucune n'en cache une autre dans le fichier. Grille de seaux : linéaire.
 */
function separate(shapes, gap = 14) {
  const cell = 240, grid = new Map(), keyOf = (i, j) => i * 100003 + j;
  const cells = s => { const out = []; for (let i = Math.floor(s.x / cell); i <= Math.floor((s.x + s.w) / cell); i++) for (let j = Math.floor(s.y / cell); j <= Math.floor((s.y + s.h) / cell); j++) out.push(keyOf(i, j)); return out; };
  const hit = s => { for (const k of cells(s)) for (const o of grid.get(k) || []) if (s.x < o.x + o.w + gap && o.x < s.x + s.w + gap && s.y < o.y + o.h && o.y < s.y + s.h) return o; return null; };
  const order = [...shapes].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const s of order) {
    for (let n = 0, o; n < 400 && (o = hit(s)); n++) s.x = o.x + o.w + gap;
    for (const k of cells(s)) { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s); }
  }
}
function logicPage(data, C, masters, N) {
  const shapes = [], edges = [], sid = new Map();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of data.devices || []) {
    const s = specOf(d); if (!s || s.role === 'mech') continue;
    const w = s.w || 72, h = s.h || 60, x = num(d.x), y = num(d.y);
    const id = 'd:' + d.id; sid.set(d.id, id);
    const ft = fitText(d.name || d.id, w / 100 * (famOf(d.type) === 'ap' ? 0.75 : 1), h / 100 * (famOf(d.type) === 'ap' ? 0.75 : 1));
    shapes.push({ id, kind: 'dev', master: masterOf(masters, d.type), layers: ['devices'], geom: famOf(d.type) === 'ap' ? 'ellipse' : 'rect', x, y, w, h, rot: 0, text: ft.text, style: { font: ft.font }, props: C.devProps(d), ref: { kind: 'dev', id: d.id } });
  }
  separate(shapes);
  for (const s of shapes) { x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + s.w); y1 = Math.max(y1, s.y + s.h); }
  for (const c of data.cables || []) {
    const a = sid.get(c.a[0]), b = sid.get(c.b[0]); if (!a || !b || a === b) continue;
    const fibre = c.media === 'fibre', P = C.cableProps(c);
    edges.push({ id: 'c:' + c.id, from: a, to: b, text: P.Label, layers: ['cables'], props: P, ref: { kind: 'cable', id: c.id },
      style: { line: fibre ? '#c2410c' : '#334155', lw: fibre ? 1.5 : 1, dash: fibre, font: 6, ink: '#334155' } });
  }
  if (!shapes.length) return null;
  const m = 60;
  const box = { x0: x0 - m, y0: y0 - m - 30, x1: x1 + m, y1: y1 + m };
  shapes.push({ id: 't:title', kind: 'title', layers: ['labels'], geom: 'text', x: box.x0 + 20, y: box.y0 + 10, w: Math.max(200, (box.x1 - box.x0) - 40), h: 28, rot: 0, text: N.title, style: { font: 14, ink: INK, bold: true, align: 'left' } });
  return { key: 'logic', kind: 'logic', name: tl('Schéma logique'), unit: 'px', scale: 1, box, layers: ['devices', 'cables', 'labels'], shapes, edges };
}

/* ---------- Élévations de baies (faces avant et arrière) ---------- */
/** Nom d'une baie : son nom (« Baie RDC »), suivi de son identifiant d'étiquetage (« 0A.R01 ») s'il diffère. */
const rackName = (L, r) => { const id = L.rack(r.id) || '', n = (r.name || '').trim(); return n && id && n !== id ? `${n} (${id})` : n || id || r.id; };
function rackPage(data, C, masters, r, N) {
  const U = Math.max(1, num(r.u) || 42), uh = U_MM, rw = Math.max(480, num(r.w) || 600), H = U * uh, gap = 300, top = 160, shapes = [];
  const label = rackName(C.L, r);
  const devsIn = (data.devices || []).filter(d => d.rack && d.rack.id === r.id);
  ['front', 'rear'].forEach((face, fi) => {
    const ox = fi * (rw + gap);
    shapes.push({ id: `f:${face}`, kind: 'frame', layers: ['frame'], geom: 'rect', x: ox, y: top, w: rw, h: H + 40, rot: 0, text: '', style: { fill: '#f8fafc', line: '#334155', lw: 1.5 } });
    shapes.push({ id: `t:${face}`, kind: 'label', layers: ['labels'], geom: 'text', x: ox, y: top - 70, w: rw, h: 50, rot: 0, text: `${label} · ${face === 'front' ? tl('face avant') : tl('face arrière')} · ${U} U`, style: { font: 10, ink: INK, bold: true } });
    for (let u = 1; u <= U; u++) {
      const y = top + 20 + (U - u) * uh;
      shapes.push({ id: `u:${face}:${u}`, kind: 'unum', layers: ['labels'], geom: 'text', x: ox + 4, y, w: (rw - RAIL_MM) / 2 - 8, h: uh, rot: 0, text: String(u), style: { font: 5, ink: '#64748b', align: 'right' } });
    }
    // Équipements 0 U (PDU verticales) : bandes dans l'espace libre à droite des montants, sur toute la hauteur.
    const zero = devsIn.filter(d => (d.rack.face || 'front') === face && !(mountDev(d) || {}).u), side = (rw - RAIL_MM) / 2 - 16;
    zero.forEach((d, i) => {
      const w = Math.max(8, side / zero.length - 4), P = C.devProps(d);
      shapes.push({ id: `d:${d.id}`, kind: 'dev', master: masterOf(masters, d.type), layers: ['devices'], geom: 'rect', x: ox + (rw + RAIL_MM) / 2 + 8 + i * (w + 4), y: top + 20, w, h: H, rot: 0, ...(ft => ({ text: ft.text, style: { font: ft.font } }))(fitText(d.name || P.Label, H / 25.4 / RACK_SCALE, w / 25.4 / RACK_SCALE, 6)), vtext: true, props: P, ref: { kind: 'dev', id: d.id } });
    });
    for (const d of devsIn) {
      const f = d.rack.face || 'front'; if (f !== face) continue;
      const mu = (mountDev(d) || {}).u; if (!mu) continue; // 0 U : dessinées plus haut
      const y = top + 20 + (U - (d.rack.u + mu - 1)) * uh, P = C.devProps(d);
      const text = P.Label === d.name ? d.name : `${P.Label}${d.name && d.name !== P.Label ? ' · ' + d.name : ''}`;
      shapes.push({ id: `d:${d.id}`, kind: 'dev', master: masterOf(masters, d.type), layers: ['devices'], geom: 'rect', x: ox + (rw - RAIL_MM) / 2, y, w: RAIL_MM, h: mu * uh, rot: 0,
        ...(ft => ({ text: ft.text, style: { font: ft.font } }))(fitText(text, RAIL_MM / 25.4 / RACK_SCALE, mu * uh / 25.4 / RACK_SCALE)), props: P, ref: { kind: 'dev', id: d.id } });
    }
  });
  return { key: 'rack:' + r.id, kind: 'rack', name: label, unit: 'mm', scale: RACK_SCALE, box: { x0: -150, y0: 0, x1: 2 * rw + gap + 150, y1: top + H + 160 }, layers: ['frame', 'devices', 'labels'], shapes, edges: [], ref: { kind: 'rack', id: r.id } };
}

/* ---------- Plans d'étage ---------- */
function floorPage(data, C, masters, b, f, N, multi) {
  const shapes = [], pts = [];
  const devs = (data.devices || []).filter(d => d.loc && d.loc.floor === f.id), racks = (data.racks || []).filter(r => r.floor === f.id), paths = (data.paths || []).filter(p => p.floor === f.id);
  for (const r of f.rooms || []) for (const p of r.poly || []) pts.push(p);
  for (const w of f.walls || []) pts.push(w.a, w.b);
  for (const d of devs) pts.push([d.loc.x, d.loc.y]);
  for (const r of racks) pts.push([r.x, r.y]);
  for (const p of paths) for (const q of p.pts || []) pts.push(q);
  if (!pts.length) return null;
  const B = bbox(pts), m = 2;
  const box = { x0: B.x0 - m, y0: B.y0 - m - 1.5, x1: B.x1 + m, y1: B.y1 + m + 1 };
  const W = box.x1 - box.x0, H = box.y1 - box.y0;
  const avail = [SHEET[0] - 2 * SHEET[2], SHEET[1] - 2 * SHEET[2]], land = W >= H;
  const fits = n => (land ? W * 1000 / n <= avail[0] && H * 1000 / n <= avail[1] : W * 1000 / n <= avail[1] && H * 1000 / n <= avail[0]);
  const scale = PLAN_SCALES.find(fits) || PLAN_SCALES[PLAN_SCALES.length - 1];
  const k = scale / 100; // taille des symboles et des textes : constante sur le papier (1 cm à 1:100 = 1 m)
  for (const r of f.rooms || []) {
    if (!(r.poly || []).length) continue;
    const rings = [r.poly, ...(r.holes || [])], bb = bbox(r.poly);
    shapes.push({ id: 'r:' + r.id, kind: 'room', layers: ['rooms'], geom: 'poly', x: bb.x0, y: bb.y0, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0, rot: 0, rings, text: '',
      style: { fill: '#f1f5f9', line: '#94a3b8', lw: 0.5 }, props: { Label: r.name || r.id, Category: USAGES[r.usage] ? USAGES[r.usage].name() : r.usage || '' }, ref: { kind: 'room', id: r.id } });
    const c = roomPoint(r);
    shapes.push({ id: 'n:' + r.id, kind: 'label', layers: ['labels'], geom: 'text', x: c[0] - 2.5 * k, y: c[1] - 0.35 * k, w: 5 * k, h: 0.7 * k, rot: 0, text: r.name || r.id, style: { font: fitFont(r.name || r.id, 5 / 2.54, 7), ink: '#475569' } });
  }
  for (const w of f.walls || []) {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy); if (len < 1e-6) continue;
    const t = Math.max(0.05, num(w.t) / 1000 || 0.1), cx = (w.a[0] + w.b[0]) / 2, cy = (w.a[1] + w.b[1]) / 2;
    shapes.push({ id: 'w:' + w.id, kind: 'wall', layers: ['walls'], geom: 'rect', x: cx - len / 2, y: cy - t / 2, w: len, h: t, rot: Math.atan2(dy, dx) * 180 / Math.PI, text: '', style: { fill: '#334155', line: '#334155', lw: 0.25 }, ref: { kind: 'wall', id: w.id } });
  }
  for (const p of paths) {
    if (!p.pts || p.pts.length < 2) continue;
    const bb = bbox(p.pts), K = PATH_KINDS[p.kind] || {};
    shapes.push({ id: 'p:' + p.id, kind: 'path', layers: ['pathways'], geom: 'line', x: bb.x0, y: bb.y0, w: Math.max(1e-3, bb.x1 - bb.x0), h: Math.max(1e-3, bb.y1 - bb.y0), rot: 0, pts: p.pts, text: '',
      style: { line: '#ea580c', lw: 2, dash: p.kind === 'ceiling' || p.kind === 'conduit' }, props: { Label: p.name || p.id, Category: K.name ? K.name() : p.kind, Length: r3(p.pts.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p.pts[i - 1][0], q[1] - p.pts[i - 1][1]) : 0), 0)) }, ref: { kind: 'path', id: p.id } });
  }
  for (const r of racks) {
    const w = Math.max(0.3, num(r.w) / 1000 || 0.6), dp = Math.max(0.2, num(r.d) / 1000 || 0.8);
    shapes.push({ id: 'k:' + r.id, kind: 'rack', layers: ['racks'], geom: 'rect', x: r.x - w / 2, y: r.y - dp / 2, w, h: dp, rot: num(r.rot), ...(ft => ({ text: ft.text, style: { fill: '#1e3a8a', line: '#1e3a8a', lw: 0.5, font: ft.font, ink: '#ffffff' } }))(fitText(C.L.rack(r.id) || r.name || r.id, w * 1000 / scale / 25.4, dp * 1000 / scale / 25.4, 7)),
      props: { Label: C.L.rack(r.id) || r.name || r.id, Type: `${num(r.u) || 42} U`, Rack: r.name || r.id }, ref: { kind: 'rack', id: r.id } });
  }
  for (const d of devs) {
    const P = C.devProps(d), x = d.loc.x, y = d.loc.y;
    if (isOutlet(d)) {
      const s = 0.36 * k; masterOf(masters, d.type);
      shapes.push({ id: 'd:' + d.id, kind: 'dev', master: d.type, layers: ['outlets'], geom: 'rect', x: x - s / 2, y: y - s / 2, w: s, h: s, rot: 0, text: P.Label, textOut: true, props: P, ref: { kind: 'dev', id: d.id } });
    } else if (isAp(d)) {
      const s = 0.6 * k; masterOf(masters, d.type);
      shapes.push({ id: 'd:' + d.id, kind: 'dev', master: d.type, layers: ['aps'], geom: 'ellipse', x: x - s / 2, y: y - s / 2, w: s, h: s, rot: 0, text: d.name || d.id, textOut: true, props: P, ref: { kind: 'dev', id: d.id } });
    } else {
      const s = 0.45 * k; masterOf(masters, d.type);
      shapes.push({ id: 'd:' + d.id, kind: 'dev', master: d.type, layers: ['devices'], geom: 'rect', x: x - s / 2, y: y - s / 2, w: s, h: s, rot: 0, text: d.name || d.id, textOut: true, props: P, ref: { kind: 'dev', id: d.id } });
    }
  }
  const name = multi ? `${b.name || b.id} · ${f.name || f.id}` : f.name || f.id;
  shapes.push({ id: 't:title', kind: 'title', layers: ['labels'], geom: 'text', x: box.x0 + 0.5 * k, y: box.y0 + 0.3 * k, w: Math.min(W - k, 30 * k), h: 1.2 * k, rot: 0, text: `${N.title} · ${name} · 1:${scale}`, style: { font: 12, ink: INK, bold: true, align: 'left' } });
  // Échelle graphique de 5 m (10 m au-delà de 1:200).
  const bar = scale > 200 ? 10 : 5;
  shapes.push({ id: 't:bar', kind: 'scalebar', layers: ['labels'], geom: 'rect', x: box.x0 + k, y: box.y1 - 0.9 * k, w: bar, h: 0.12 * k, rot: 0, text: '', style: { fill: INK, line: INK, lw: 0.25 } });
  shapes.push({ id: 't:barText', kind: 'label', layers: ['labels'], geom: 'text', x: box.x0 + k, y: box.y1 - 1.6 * k, w: bar, h: 0.6 * k, rot: 0, text: `0 — ${bar} m`, style: { font: 7, ink: INK, align: 'left' } });
  return { key: 'floor:' + f.id, kind: 'floor', name, unit: 'm', scale, box, layers: ['rooms', 'walls', 'pathways', 'racks', 'outlets', 'aps', 'devices', 'labels'], shapes, edges: [], ref: { kind: 'floor', id: f.id } };
}

const want = (sel, id) => sel == null || sel === true || (Array.isArray(sel) && sel.includes(id));
/** Pages des vues du projet (voir l'en-tête). */
export function buildViews(data, o = {}) {
  const V = o.views || {}, C = context(data, o), masters = new Map(), pages = [];
  const p = (data.design && data.design.project) || {};
  const N = { title: o.title || p.site || (data.site && data.site.name) || tl('Réseau') };
  if (V.logic !== false) { const pg = logicPage(data, C, masters, N); if (pg) pages.push(pg); }
  if (V.racks !== false) for (const r of data.racks || []) if (want(V.racks, r.id)) pages.push(rackPage(data, C, masters, r, N));
  if (V.floors !== false) {
    const fls = floorsOf(data), multi = new Set(fls.map(x => x.b.id)).size > 1;
    for (const { b, f } of fls) if (want(V.floors, f.id)) { const pg = floorPage(data, C, masters, b, f, N, multi); if (pg) pages.push(pg); }
  }
  // Noms de pages uniques (Visio : NameU unique ; draw.io : onglets distincts).
  const seen = new Map();
  for (const pg of pages) { const k = pg.name.toLowerCase(); const n = (seen.get(k) || 0) + 1; seen.set(k, n); if (n > 1) pg.name += ` (${n})`; }
  const LN = layerNames();
  for (const pg of pages) pg.layers = pg.layers.map(k => ({ key: k, name: LN[k] || k }));
  const stats = { pages: pages.length, shapes: pages.reduce((s, pg) => s + pg.shapes.length, 0), edges: pages.reduce((s, pg) => s + pg.edges.length, 0), logic: pages.some(pg => pg.kind === 'logic'), racks: pages.filter(pg => pg.kind === 'rack').length, floors: pages.filter(pg => pg.kind === 'floor').length };
  return { title: N.title, pages, masters: [...masters.values()], props: propNames(), stats };
}

/** Choix offerts par la boîte d'export : vues disponibles du projet. */
export function availableViews(data) {
  const L = labeler(data);
  const shown = (data.devices || []).filter(d => { const s = specOf(d); return s && s.role !== 'mech'; }), ids = new Set(shown.map(d => d.id));
  const logic = shown.length ? { devices: shown.length, cables: (data.cables || []).filter(c => ids.has(c.a[0]) && ids.has(c.b[0])).length } : null;
  const racks = (data.racks || []).map(r => ({ id: r.id, name: rackName(L, r) }));
  const floors = floorsOf(data).filter(({ f }) => (f.rooms || []).length || (f.walls || []).length || (data.devices || []).some(d => d.loc && d.loc.floor === f.id)).map(({ b, f }) => ({ id: f.id, name: `${b.name || b.id} · ${f.name || f.id}` }));
  return { logic, racks, floors };
}
