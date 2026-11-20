// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vue Plans : étage d'exemple (bureaux autour d'un couloir, local technique avec sa baie, chemin de câbles, prises,
// points d'accès, liens permanents au tracé automatique) et choix des ports d'un lien. Module pur : sert à la vue
// (bouton « Étage d'exemple »), à l'IA et aux tests.
import { DEVICES, newDevice, portsOf } from '../devices.js';
import { makeCable } from '../cable.js';
import { siteIds, uid, MATERIALS, USAGES, detectRooms } from '../site.js';
import { tl } from '../../i18n/index.js';

/** Port libre d'un équipement pour un lien permanent : côté mur d'une prise ou d'un panneau, sinon un port actif. */
export function freePort(data, d, prefer = 'punch') {
  const used = new Set(); for (const c of data.cables) { if (c.a[0] === d.id) used.add(c.a[1]); if (c.b[0] === d.id) used.add(c.b[1]); }
  const ps = portsOf(d).filter(p => !used.has(p.id) && !p.sfp && !p.fibre);
  const pick = prefer === 'punch' ? ps.find(p => p.punch) || ps.find(p => !p.passive) : ps.find(p => !p.punch) || ps[0];
  return pick ? pick.id : null;
}
const freeId = (data, type) => { const p = (DEVICES[type].prefix || 'n').toLowerCase(); let i = 1; while (data.devices.some(d => d.id === p + i)) i++; return p + i; };
/** Pose un équipement (place logique et place sur un étage) ; rend l'équipement. */
export function addDevice(data, type, at, loc, extra = {}) {
  const d = newDevice(type, new Set(data.devices.map(z => z.name)), at); d.id = freeId(data, type);
  if (loc) d.loc = loc; Object.assign(d, extra); data.devices.push(d); return d;
}
/** Câble entre deux ports (id libre) ; route : 'auto' pour un lien permanent tracé par les cheminements. */
export function addLink(data, a, b, o = {}) {
  let i = 1; while (data.cables.some(c => c.id === 'c' + i)) i++;
  const c = { id: 'c' + i, a, b, cat: o.cat || 'cat6', len: o.len || 3, wire: makeCable('straight') };
  if (o.route) c.route = { mode: o.route };
  data.cables.push(c); return c;
}

/**
 * Ajoute au modèle un bâtiment avec un étage de bureaux réaliste (40 × 18 m) : murs, portes, pièces, local technique et
 * sa baie (si data.racks est géré), chemin de câbles du couloir, crochets vers le plateau, goulotte d'énergie, prises,
 * points d'accès et caméra reliés au panneau de brassage. Rend { building, floor }.
 */
export function addDemoFloor(data, o = {}) {
  data.site = data.site || { name: '', north: 0, seg: 'b', buildings: [] };
  const used = siteIds(data.site), id = (w, p) => uid(w, p, used);
  const bx = data.site.buildings.length ? Math.max(...data.site.buildings.map(b => b.x)) + 80 : 0;
  const F = { id: id('F1', 'F'), name: tl('Niveau 1'), level: 1, elev: 3.5, height: 3.5, ceil: 2.7, plenum: 0.6, raised: 0, walls: [], doors: [], rooms: [] };
  const B = { id: id('B1', 'B'), name: o.name || tl('Siège'), x: bx, y: 0, floors: [F] };
  data.site.buildings.push(B);
  const W = (a, b, mat = 'drywall') => { const w = { id: id('', 'w'), a, b, t: MATERIALS[mat].t, mat }; F.walls.push(w); return w; };
  const R = (name, usage, x0, y0, x1, y1) => F.rooms.push({ id: id('', 'rm'), name, usage, poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  const D = (w, at, wd = 0.9) => F.doors.push({ id: id('', 'dr'), wall: w.id, at, w: wd });
  // Enveloppe en béton, couloir est-ouest, cloisons.
  W([0, 0], [10, 0], 'concrete'); W([10, 0], [20, 0], 'glass'); W([20, 0], [40, 0], 'concrete'); W([40, 0], [40, 18], 'concrete'); W([40, 18], [0, 18], 'concrete'); W([0, 18], [0, 0], 'concrete');
  const wn = [[0, 4], [4, 12], [12, 20], [20, 30], [30, 40]].map(([a, b]) => W([a, 7.5], [b, 7.5], a === 0 ? 'block' : 'drywall'));
  const ws = [[0, 24], [24, 34], [34, 40]].map(([a, b]) => W([a, 10.5], [b, 10.5]));
  W([4, 0], [4, 7.5], 'block'); W([12, 0], [12, 7.5]); W([20, 0], [20, 7.5]); W([30, 0], [30, 7.5]);
  W([24, 10.5], [24, 18]); W([34, 10.5], [34, 18], 'brick');
  wn.forEach(w => D(w, Math.min(1, (w.b[0] - w.a[0]) / 2))); ws.forEach(w => D(w, 1.2));
  R(tl('LT 1'), 'tr', 0, 0, 4, 7.5); R(tl('Bureau 101'), 'office', 4, 0, 12, 7.5); R(tl('Bureau 102'), 'office', 12, 0, 20, 7.5);
  R(tl('Salle de réunion'), 'meeting', 20, 0, 30, 7.5); R(tl('Bureau 103'), 'office', 30, 0, 40, 7.5);
  R(tl('Couloir'), 'corridor', 0, 7.5, 40, 10.5); R(tl('Plateau'), 'open', 0, 10.5, 24, 18); R(tl('Salle de formation'), 'classroom', 24, 10.5, 34, 18); R(tl('Sanitaires'), 'sanitary', 34, 10.5, 40, 18);
  // Cheminements : descente du local technique, chemin de câbles du couloir, crochets vers le plateau, énergie.
  data.paths = data.paths || [];
  const P = (kind, pts, extra = {}) => { let i = 1; while (data.paths.some(p => p.id === 'pa' + i)) i++; const p = { id: 'pa' + i, floor: F.id, kind, name: '', pts, z: kind === 'ceiling' ? 2.9 : kind === 'trunking' ? 2.6 : 2.75, ...extra }; data.paths.push(p); return p; };
  P('tray', [[2, 4.5], [2, 9], [38.5, 9]], { name: tl('CdC couloir'), w: 300, h: 60, shield: 'perforated' });
  for (const x of [8, 16, 25, 35]) P('ceiling', [[x, 9], [x, 3.5]], { name: '' });
  P('ceiling', [[8, 9], [8, 16]], { name: tl('Crochets plateau ouest') });
  P('ceiling', [[29, 9], [29, 15.5]], { name: '' });
  P('ceiling', [[17, 9], [17, 16]], { name: tl('Crochets plateau est') });
  P('trunking', [[1, 10.2], [39, 10.2]], { name: tl('Goulotte énergie'), w: 100, h: 50, power: true, circuits: 6 });
  // Baie, panneau de brassage, switch (dans la baie si les baies sont gérées, sinon posés au local technique).
  let rack = null;
  if (Array.isArray(data.racks) && o.newRack) { rack = o.newRack(data, 'floor', { floor: F.id, x: 2, y: 2.4, rot: 180 }); if (rack) data.racks.push(rack); }
  const inRack = (u) => (rack ? { rack: { id: rack.id, u, face: 'front' } } : {});
  const lx = bx * 10;
  const pp = addDevice(data, 'patch24', { x: lx, y: 0 }, rack ? null : { floor: F.id, x: 1.5, y: 2, h: 1.6 }, inRack(40));
  const sw = addDevice(data, 'switch24', { x: lx, y: 120 }, rack ? null : { floor: F.id, x: 2.5, y: 2, h: 1.5 }, inRack(38));
  // Prises, points d'accès, caméra : chacun relié au panneau par un lien permanent au tracé automatique, puis brassé.
  const spots = [
    ['outlet2', 6, 1.0], ['outlet2', 10, 6.4], ['outlet2', 14, 1.0], ['outlet2', 18, 6.4], ['outlet2', 22, 1.0], ['outlet2', 28, 1.0], ['outlet2', 35, 1.0],
    ['outlet2', 3, 17], ['outlet2', 8, 17], ['outlet2', 13, 17], ['outlet2', 20, 17], ['outlet2', 29, 17],
    ['ap', 10, 12.5, 2.7], ['ap', 25, 5.6, 2.7], ['ap', 31, 12.6, 2.7], ['camera', 37, 9.4, 2.6]
  ];
  let port = 1;
  spots.forEach(([type, x, y, h], i) => {
    const d = addDevice(data, type, { x: lx - 300 + (i % 8) * 90, y: 300 + Math.floor(i / 8) * 110 }, { floor: F.id, x, y, h: h ?? 0.3 });
    const dp = freePort(data, d, 'punch'), bp = 'b' + port, fp = 'f' + port, sp = 'p' + port; port++;
    addLink(data, [pp.id, bp], [d.id, dp], { route: 'auto', cat: 'cat6a' });
    addLink(data, [pp.id, fp], [sw.id, sp], { len: 1, cat: 'cat6a' });
  });
  return { building: B, floor: F, rack, patch: pp, sw };
}

/**
 * Crée les pièces fermées par les murs d'un étage qu'aucune pièce ne couvre encore (detectRooms de site.js) : usage
 * donné, nom libre « Pièce n ». Rend les pièces créées (à enregistrer : commit).
 */
export function addDetectedRooms(data, floor, usage = 'office', o = {}) {
  const polys = detectRooms(floor, o), used = siteIds(data.site), names = new Set(floor.rooms.map(r => r.name));
  let n = 1; const out = [];
  for (const poly of polys) {
    while (names.has(tl('Pièce {0}', n))) n++;
    const name = tl('Pièce {0}', n); names.add(name);
    const r = { id: uid('', 'rm', used), name, usage: USAGES[usage] ? usage : 'office', poly };
    floor.rooms.push(r); out.push(r);
  }
  return out;
}
/**
 * Retire une baie du modèle : ses équipements restent dans le projet, hors baie (d.rack effacé). Utilise removeRack de
 * rack.js s'il existe (partie baies), sinon le fait ici. Rend le nombre d'équipements sortis de la baie, ou -1.
 */
export function removeRackFrom(data, id, RK = null) {
  if (!(data.racks || []).some(r => r.id === id)) return -1;
  if (RK && typeof RK.removeRack === 'function') { const r = RK.removeRack(data, id, { unrack: true }); return r && r.unracked ? r.unracked.length : 0; }
  let n = 0;
  data.racks = data.racks.filter(r => r.id !== id);
  for (const d of data.devices) if (d.rack && d.rack.id === id) { delete d.rack; n++; }
  return n;
}
