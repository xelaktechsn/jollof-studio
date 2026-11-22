// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Baies 19 pouces et coffrets muraux : modèle, place des équipements (U, face), occupation et collisions, poids, puissance,
// chaleur, PDU, onduleurs (autonomie), passe-câbles, plan de brassage. Fonctions pures (sans interface), partagées par la
// vue Baies, le vérificateur (checks/rack.js), les outils de l'IA et la conception (nomenclature, documents).
//
// Modèle (data.racks[i], nettoyé par cleanRacks) :
//   { id, name, kind: 'floor' | 'wall', u (hauteur en U), w (largeur, mm), d (profondeur hors tout, mm), depth (profondeur
//     utile entre rails, mm), load (charge statique admise, kg), floor, room, x, y (m), rot (°) — place sur le plan d'étage,
//     tracée par la vue Plans —, heat (chaleur admise, W), runtime (autonomie visée, min), pf (facteur de puissance des
//     équipements), basis: 'typ' | 'max' (puissance retenue), volts (tension d'alimentation, V) }.
//   heat, runtime, pf et basis sont des valeurs de conception modifiables (RACK_DESIGN), pas des normes.
// Place d'un équipement (devices[i].rack, cleanRackPos) : { id (baie), u (U du bas, à partir de 1), face: 'front' | 'rear',
//   w? (puissance imposée, W : mesurée ou annoncée), pdu? (id de la PDU où il est branché) }.
// Géométrie EIA-310 : 1U = 44,45 mm, façade 19 pouces = 482,6 mm (NET.RACK_U_MM, NET.RACK_PANEL_MM).
//
// API (toutes pures) :
//   MOUNT[type] → { u, depth, kg, typ, max, shelf?, poe?, pdu?, ups?, ebmOf?, load?, ref, src } (null : pas en baie)
//   cleanRacks(raw), cleanRackPos(raw), newRack(data, kind) → baie neuve (non ajoutée),
//   removeRack(data, id, { unrack = true }) → { rack, unracked, deleted, cables } (data muté)
//   rackIndex(data) → Map(id de baie → équipements), facesOf(d, rack), spanOf(d)
//   occupancy(rack, devs) → { front, rear (tableaux [U] → id), collisions, outside, freeFront, usedU }
//   canPlace(data, rack, dev, u, face) → { ok, why?: 'type' | 'outside' | 'clash', with? }, findFree(data, rack, dev, face, near)
//   canPlaceGroup(data, rack, [{ dev, u, face }]), findGroupBase(data, rack, [{ dev, du, face }], near, { block }), freeFrontU(rack, devs),
//   managerSlots(rack, devs) → [{ panel, u, face }]
//   devicePower(d, lan, basis), upsRuntime(ups, loadW, ebm), rackPower(rack, devs, lan)
//   cableManagers(rack, devs), blanksNeeded(rack, devs, occ), rackSummary(data, rack, lan, idx), racksSummary(data, lan)
//   patchingSchedule(data, lan, { rack?, all? }) → lignes { rack, rackId, panel, panelId, port, portId, outlet, outletId,
//     outletPort, permLen, switch, switchId, switchPort, vlan, cordLen, cableId, label, up }
import { NET } from './limits.js';
import { specOf, portsOf } from './devices.js';
import { cleanText } from '../sanitize.js';

export const U_MM = NET.RACK_U_MM.v, PANEL_MM = NET.RACK_PANEL_MM.v, BTU_PER_W = NET.BTU_PER_W.v;
export const PRESETS = NET.RACK_PRESETS.v, MOUNT = NET.RACK_MOUNT.v;
/** Hauteurs courantes (U) proposées dans l'inspecteur ; toute hauteur de 1 à 60 U est acceptée. */
export const RACK_U = [6, 9, 12, 15, 18, 22, 24, 27, 32, 36, 42, 45, 47];
export const RACK_W = [550, 600, 800], RACK_D = [450, 600, 800, 1000, 1200];
/**
 * Valeurs de conception modifiables (pas des normes) : chaleur admise par baie (W), autonomie visée des onduleurs (min),
 * facteur de puissance des équipements (VA = W / pf), longueur d'un cordon de brassage neuf (m).
 */
export const RACK_DESIGN = { heat: 3000, runtime: 10, pf: 0.9, cord: 0.5 };
export const MAX_RACKS = 200;
/** Panneaux de brassage (cuivre et fibre) : ports avant f1…, arrière b1…. */
export const PANELS = new Set(['patch', 'patch24', 'patch48', 'fibrepanel']);

const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, +v)) : d);
const txt = (v, n) => cleanText(String(v ?? ''), n);
const r1 = v => Math.round(v * 100) / 100;

export const mountOf = type => MOUNT[type] || null;
/**
 * Montage d'un équipement : celui de son type, ou celui de son modèle réel (d.model, catalog.js) quand il en a un — la
 * fiche du modèle remplace alors hauteur, profondeur, poids et puissances ; un champ que la fiche ne donne pas vaut null
 * (jamais celui du type générique). Sans puissance maximale, un switch PoE garde le majorant « sans PoE + budget ».
 */
const mountMemo = new WeakMap();
export function mountDev(d) {
  if (!d) return null;
  const base = MOUNT[d.type] || null, m = d.model;
  if (!m || !base) return base;
  let o = mountMemo.get(m);
  if (!o || o.base !== base) {
    const poe = !!m.poeBudget, typ = m.w ?? null, max = m.wMax ?? (typ != null && poe ? Math.round((typ + m.poeBudget) * 100) / 100 : typ);
    o = { base, v: { ...base, u: base.u === 0 ? 0 : m.u ?? base.u, depth: m.depth ?? null, kg: m.kg ?? null, typ: base.pdu || base.ups || base.ebmOf ? base.typ : typ, max: base.pdu || base.ups || base.ebmOf ? base.max : max, shelf: !!m.shelf, poe, ref: `${m.vendor} ${m.pn}`, model: true } };
    if (!o.v.shelf) delete o.v.shelf; if (!poe) delete o.v.poe;
    mountMemo.set(m, o);
  }
  return o.v;
}
export const rackable = type => !!MOUNT[type];

/* ---------- Nettoyage ---------- */
/** Baies propres : ids uniques, nombres bornés, au plus MAX_RACKS. */
export function cleanRacks(raw) {
  const out = [], ids = new Set();
  for (const r of Array.isArray(raw) ? raw.slice(0, MAX_RACKS) : []) {
    if (!r || typeof r !== 'object') continue;
    let id = txt(r.id, 40) || 'rk' + (out.length + 1); while (ids.has(id)) id += '_'; ids.add(id);
    const kind = r.kind === 'wall' ? 'wall' : 'floor', P = PRESETS[kind];
    const d = num(r.d, 200, 1400, P.d);
    out.push({
      id, name: txt(r.name, 24) || (kind === 'wall' ? 'COFFRET' : 'BAIE') + (out.length + 1), kind,
      u: Math.round(num(r.u, 1, 60, P.u)), w: num(r.w, 300, 1200, P.w), d, depth: Math.min(d, num(r.depth, 100, 1400, P.depth)),
      load: num(r.load, 1, 5000, P.load), floor: txt(r.floor, 40), room: txt(r.room, 40),
      x: num(r.x, -1e5, 1e5, 0), y: num(r.y, -1e5, 1e5, 0), rot: ((num(r.rot, -3600, 3600, 0) % 360) + 360) % 360,
      heat: num(r.heat, 50, 100000, RACK_DESIGN.heat), runtime: num(r.runtime, 0, 600, RACK_DESIGN.runtime),
      pf: num(r.pf, 0.5, 1, RACK_DESIGN.pf), basis: r.basis === 'max' ? 'max' : 'typ', volts: num(r.volts, 100, 400, 230)
    });
  }
  return out;
}
/** Place d'un équipement dans une baie : { id, u, face, w?, pdu? } ou null. */
export function cleanRackPos(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = txt(raw.id, 40); if (!id) return null;
  const o = { id, u: Math.round(num(raw.u, 1, 60, 1)), face: raw.face === 'rear' ? 'rear' : 'front' };
  if (raw.w != null && raw.w !== '' && Number.isFinite(+raw.w)) o.w = num(raw.w, 0, 20000, 0);
  const pdu = txt(raw.pdu, 40); if (pdu) o.pdu = pdu;
  return o;
}
/** Baie neuve d'après la baie de référence du genre (non ajoutée au modèle) : id et nom libres. */
export function newRack(data, kind = 'floor', at = {}) {
  const used = new Set((data.racks || []).map(r => r.id)), names = new Set((data.racks || []).map(r => r.name));
  let i = 1; while (used.has('rk' + i)) i++;
  const base = kind === 'wall' ? 'COFFRET' : 'BAIE'; let n = 1; while (names.has(base + n)) n++;
  const P = PRESETS[kind === 'wall' ? 'wall' : 'floor'];
  return cleanRacks([{ id: 'rk' + i, name: base + n, kind: P.kind, u: P.u, w: P.w, d: P.d, depth: P.depth, load: P.load, ...at }])[0];
}

/**
 * Retire la baie id du modèle (data muté). o.unrack (par défaut) : ses équipements restent dans le projet, hors baie ;
 * sinon ils sont supprimés avec leurs câbles. Les branchements « pdu » vers une PDU supprimée sont oubliés.
 * Rend { rack (la baie retirée ou null), unracked: [ids], deleted: [ids], cables: [ids des câbles supprimés] }.
 */
export function removeRack(data, id, o = {}) {
  const out = { rack: null, unracked: [], deleted: [], cables: [] };
  const r = (data.racks || []).find(x => x.id === id); if (!r) return out;
  out.rack = r; data.racks = data.racks.filter(x => x !== r);
  const keep = o.unrack !== false, gone = new Set();
  for (const d of data.devices || []) {
    if (!d.rack || d.rack.id !== id) continue;
    if (keep) { delete d.rack; out.unracked.push(d.id); } else { gone.add(d.id); out.deleted.push(d.id); }
  }
  if (gone.size) {
    data.devices = data.devices.filter(d => !gone.has(d.id));
    const before = data.cables || [];
    data.cables = before.filter(c => !gone.has(c.a[0]) && !gone.has(c.b[0]));
    out.cables = before.filter(c => gone.has(c.a[0]) || gone.has(c.b[0])).map(c => c.id);
    for (const d of data.devices) if (d.rack && d.rack.pdu && gone.has(d.rack.pdu)) delete d.rack.pdu;
  }
  return out;
}

/* ---------- Occupation ---------- */
/** Équipements de chaque baie (une passe) : Map(id → [devices]). Les places vers une baie inconnue sont ignorées. */
export function rackIndex(data) {
  const m = new Map();
  for (const r of data.racks || []) m.set(r.id, []);
  for (const d of data.devices || []) if (d.rack && m.has(d.rack.id)) m.get(d.rack.id).push(d);
  return m;
}
/** U occupés : [bas, haut] (null pour une PDU verticale ou un type hors baie). */
export function spanOf(d, u = d.rack && d.rack.u) {
  const m = mountDev(d); if (!m || !m.u) return null;
  return [u, u + m.u - 1];
}
/**
 * Faces prises par un équipement : la sienne ; les deux s'il est plus profond que la moitié de la profondeur utile
 * (règle de conception : un appareil profond ne laisse pas la place d'en monter un autre derrière lui).
 */
export function facesOf(d, rack, face = d.rack && d.rack.face) {
  const m = mountDev(d); if (!m || !m.u) return [];
  if (m.depth != null && m.depth > rack.depth / 2) return ['front', 'rear'];
  return [face === 'rear' ? 'rear' : 'front'];
}
/** Occupation d'une baie : qui tient chaque U de chaque face, collisions (paires), équipements hors de la hauteur. */
export function occupancy(rack, devs) {
  const front = new Array(rack.u + 1).fill(null), rear = new Array(rack.u + 1).fill(null);
  const collisions = [], outside = [], seen = new Set();
  for (const d of devs) {
    const s = spanOf(d); if (!s) continue;
    if (s[0] < 1 || s[1] > rack.u) outside.push(d.id);
    for (const f of facesOf(d, rack)) {
      const arr = f === 'front' ? front : rear;
      for (let k = Math.max(1, s[0]); k <= Math.min(rack.u, s[1]); k++) {
        if (arr[k] && arr[k] !== d.id) { const key = [arr[k], d.id].sort().join('|'); if (!seen.has(key)) { seen.add(key); collisions.push({ a: arr[k], b: d.id, u: k, face: f }); } } else arr[k] = d.id;
      }
    }
  }
  let freeFront = 0, freeBoth = 0;
  for (let k = 1; k <= rack.u; k++) { if (!front[k]) freeFront++; if (!front[k] && !rear[k]) freeBoth++; }
  return { front, rear, collisions, outside, freeFront, freeBoth, usedU: rack.u - freeFront };
}
/** L'équipement dev peut-il aller en U u, face face, dans rack (sans compter sa place actuelle) ? */
export function canPlace(data, rack, dev, u, face = 'front') {
  const m = mountDev(dev); if (!m) return { ok: false, why: 'type' };
  if (!m.u) return { ok: true };
  if (u < 1 || u + m.u - 1 > rack.u) return { ok: false, why: 'outside' };
  const others = (data.devices || []).filter(x => x !== dev && x.id !== dev.id && x.rack && x.rack.id === rack.id);
  const occ = occupancy(rack, others), probe = { ...dev, rack: { id: rack.id, u, face } };
  for (const f of facesOf(probe, rack)) {
    const arr = f === 'front' ? occ.front : occ.rear;
    for (let k = u; k < u + m.u; k++) if (arr[k]) return { ok: false, why: 'clash', with: arr[k] };
  }
  return { ok: true };
}
/** U libre le plus proche de near (par défaut : le plus bas) pour dev, ou 0 s'il n'y en a pas. */
export function findFree(data, rack, dev, face = 'front', near = 1) {
  const m = mountDev(dev); if (!m) return 0; if (!m.u) return 1;
  const order = []; for (let k = 1; k + m.u - 1 <= rack.u; k++) order.push(k);
  order.sort((a, b) => Math.abs(a - near) - Math.abs(b - near) || a - b);
  for (const k of order) if (canPlace(data, rack, dev, k, face).ok) return k;
  return 0;
}

/**
 * Plusieurs équipements placés ensemble (déplacement groupé, collage) : moves = [{ dev, u, face }] ; les autres
 * équipements de la baie restent où ils sont. Rend { ok, why?: 'type' | 'outside' | 'clash', dev?, with? }.
 */
export function canPlaceGroup(data, rack, moves) {
  const moved = new Set(moves.map(x => x.dev.id));
  const others = (data.devices || []).filter(x => x.rack && x.rack.id === rack.id && !moved.has(x.id));
  const front = new Array(rack.u + 2).fill(null), rear = new Array(rack.u + 2).fill(null);
  const mark = (d, u, face, check) => {
    const m = mountDev(d); if (!m || !m.u) return null;
    for (const f of facesOf({ ...d, rack: { id: rack.id, u, face } }, rack, face)) {
      const arr = f === 'front' ? front : rear;
      for (let k = Math.max(1, u); k <= Math.min(rack.u, u + m.u - 1); k++) { if (arr[k] && check) return arr[k]; arr[k] = d.id; }
    }
    return null;
  };
  for (const o of others) mark(o, o.rack.u, o.rack.face, false);
  for (const { dev, u, face } of moves) {
    const m = mountDev(dev); if (!m) return { ok: false, why: 'type', dev: dev.id };
    if (m.u && (u < 1 || u + m.u - 1 > rack.u)) return { ok: false, why: 'outside', dev: dev.id };
    const w = mark(dev, u, face, true); if (w) return { ok: false, why: 'clash', dev: dev.id, with: w };
  }
  return { ok: true };
}
/**
 * U de base où poser un groupe (collage, duplication) : items = [{ dev, du (décalage depuis la base, en U), face }] ; on
 * essaie d'abord near, puis les U les plus proches. Rend la base (U du bas du groupe) ou 0 s'il n'y a pas la place.
 */
export function findGroupBase(data, rack, items, near = 1, o = {}) {
  const top = Math.max(0, ...items.map(it => it.du + ((mountDev(it.dev) || {}).u || 1) - 1));
  const order = []; for (let b = 1; b + top <= rack.u; b++) order.push(b);
  order.sort((a, b) => Math.abs(a - near) - Math.abs(b - near) || a - b);
  // o.block : le groupe garde un seul bloc d'U (rien d'autre entre ses équipements, en façade).
  const ids = new Set(items.map(it => it.dev.id));
  const occ = o.block ? occupancy(rack, (data.devices || []).filter(x => x.rack && x.rack.id === rack.id && !ids.has(x.id))) : null;
  for (const b of order) {
    if (occ) { let busy = false; for (let k = b; k <= b + top; k++) if (occ.front[k]) { busy = true; break; } if (busy) continue; }
    if (canPlaceGroup(data, rack, items.map(it => ({ dev: it.dev, u: b + it.du, face: it.face }))).ok) return b;
  }
  return 0;
}
/** U libres en façade (pour les obturateurs) : ni l'avant ni un équipement profond ne les occupent. */
export function freeFrontU(rack, devs) {
  const occ = occupancy(rack, devs), out = [];
  for (let k = 1; k <= rack.u; k++) if (!occ.front[k]) out.push(k);
  return out;
}
/** Passe-câbles à ajouter : pour chaque panneau sans passe-câbles, un U libre juste au-dessus (sinon au-dessous). */
export function managerSlots(rack, devs) {
  const occ = occupancy(rack, devs), out = [], taken = new Set();
  for (const id of cableManagers(rack, devs).missing) {
    const p = devs.find(d => d.id === id), s = spanOf(p); if (!s) continue;
    const face = p.rack.face === 'rear' ? 'rear' : 'front', arr = face === 'front' ? occ.front : occ.rear;
    const u = [s[1] + 1, s[0] - 1].find(k => k >= 1 && k <= rack.u && !arr[k] && !taken.has(face + k));
    if (u) { taken.add(face + u); out.push({ panel: id, u, face }); }
  }
  return out;
}

/* ---------- Puissance, chaleur, PDU, onduleurs ---------- */
/**
 * Puissance d'un équipement (W) : typ (typique de la fiche, ou max quand la fiche ne donne que lui : majorant), max,
 * PoE réservé par un switch (lan.poe : puissance réservée par classe, comptée en entier — majorant, pertes de
 * l'alimentation non comptées), w : celle retenue (basis). d.rack.w impose la puissance (mesurée ou annoncée).
 */
export function devicePower(d, lan, basis = 'typ') {
  const m = mountDev(d); if (!m) return { typ: 0, max: 0, poe: 0, w: 0, guess: false, user: false };
  if (d.rack && d.rack.w != null) return { typ: d.rack.w, max: d.rack.w, poe: 0, w: d.rack.w, guess: false, user: true };
  let poe = 0;
  if (m.poe && lan && lan.poe) { const i = lan.poe(d.id); poe = i ? +i.used || 0 : 0; }
  const typ = (m.typ ?? m.max ?? 0) + poe, max = Math.max(m.max ?? m.typ ?? 0, typ);
  return { typ: r1(typ), max: r1(max), poe: r1(poe), w: r1(basis === 'max' ? max : typ), guess: m.typ == null && m.max != null && m.max > 0, user: false };
}
/**
 * Autonomie d'un onduleur (min) à loadW : entre les deux points de la fiche (pleine charge, demi-charge), loi de puissance
 * t = t1 · (P1 / P)^k ; sous la demi-charge, extrapolation prudente à énergie constante (t = t2 · P2 / P, extra) — modèle
 * simplifié. Au-delà de la pleine charge : 0 (l'onduleur ne tient pas la charge).
 */
export function upsRuntime(ups, loadW, ebm = false) {
  const pts = (ebm && ups.ebm ? ups.ebm : ups.pts).slice().sort((a, b) => b[0] - a[0]);
  const [[p1, t1], [p2, t2]] = pts;
  if (!(loadW > 0)) return { min: Infinity, extra: true };
  if (loadW > p1 * 1.0001) return { min: 0, extra: false };
  const k = Math.log(t2 / t1) / Math.log(p1 / p2);
  if (loadW < p2) return { min: Math.round((t2 * p2 / loadW) * 10) / 10, extra: true };
  return { min: Math.round(t1 * Math.pow(p1 / loadW, k) * 10) / 10, extra: false };
}
/**
 * Bilan électrique d'une baie : puissance (W, typique et maximale), VA (W / pf), chaleur (toute l'énergie consommée finit
 * en chaleur ; pertes des onduleurs non comptées : modèle simplifié), BTU/h, poids, PDU (charge en VA contre A × V ;
 * branchement : d.rack.pdu, sinon répartition égale entre les PDU de la baie), onduleurs (toute la baie se partage
 * également entre eux ; un module de batteries de leur modèle allonge l'autonomie).
 */
export function rackPower(rack, devs, lan) {
  const basis = rack.basis || 'typ', pf = rack.pf || RACK_DESIGN.pf;
  let typ = 0, max = 0, poe = 0, w = 0, kg = 0;
  const loads = [], unknownKg = [], guess = [];
  for (const d of devs) {
    const m = mountDev(d); if (!m) continue;
    if (m.kg == null) unknownKg.push(d.id); else kg += m.kg;
    if (m.ups || m.ebmOf || m.pdu) continue;
    const p = devicePower(d, lan, basis);
    typ += p.typ; max += p.max; poe += p.poe; w += p.w;
    if (p.guess) guess.push(d.id);
    if (p.w > 0 || m.max > 0) loads.push({ id: d.id, w: p.w, pdu: d.rack && d.rack.pdu });
  }
  const pdus = devs.filter(d => mountDev(d) && mountDev(d).pdu).map(d => ({ id: d.id, type: d.type, spec: mountDev(d).pdu, w: 0, plugs: 0 }));
  const unplugged = [];
  if (pdus.length) {
    const free = [];
    for (const l of loads) { const p = l.pdu && pdus.find(x => x.id === l.pdu); if (p) { p.w += l.w; p.plugs++; } else free.push(l); }
    free.forEach((l, i) => { for (const p of pdus) p.w += l.w / pdus.length; pdus[i % pdus.length].plugs++; });
  } else unplugged.push(...loads.map(l => l.id));
  for (const p of pdus) {
    const capVA = Math.min(p.spec.a * rack.volts, p.spec.w); // A × V, sans dépasser la puissance de la fiche
    p.va = r1(p.w / pf); p.capVA = r1(capVA); p.pct = capVA ? r1((p.va / capVA) * 100) : 0; p.outlets = p.spec.outlets; p.w = r1(p.w);
    p.amps = r1(p.va / rack.volts);
  }
  const upsList = devs.filter(d => mountDev(d) && mountDev(d).ups);
  const ebms = devs.filter(d => mountDev(d) && mountDev(d).ebmOf).map(d => ({ id: d.id, of: mountDev(d).ebmOf, used: false }));
  const ups = upsList.map(d => {
    const s = mountDev(d).ups, load = w / upsList.length, e = ebms.find(x => !x.used && x.of === d.type);
    if (e) e.used = true;
    const rt = upsRuntime(s, load, !!e);
    return { id: d.id, type: d.type, va: s.va, capW: s.w, w: r1(load), loadVA: r1(load / pf), pct: r1(Math.max(load / s.w, load / pf / s.va) * 100), runtime: rt.min, extra: rt.extra, ebm: e ? e.id : null, target: rack.runtime };
  });
  return {
    basis, pf, typW: r1(typ), maxW: r1(max), poeW: r1(poe), w: r1(w), va: r1(w / pf), heatW: r1(w), btu: Math.round(w * BTU_PER_W),
    kg: r1(kg), unknownKg, guess, pdus, ups, unplugged, orphanEbm: ebms.filter(e => !e.used).map(e => e.id), loads: loads.length
  };
}

/* ---------- Bonnes pratiques ---------- */
const isPanel = d => PANELS.has(d.type);
/**
 * Passe-câbles : règle de conception par défaut, un passe-câbles 1U contre chaque panneau de brassage (juste au-dessus
 * ou au-dessous, même face). Rend { need, have, missing: [ids des panneaux sans passe-câbles] }.
 */
export function cableManagers(rack, devs) {
  const mgr = devs.filter(d => d.type === 'cablemgr' && d.rack), panels = devs.filter(d => isPanel(d) && d.rack);
  const missing = [];
  for (const p of panels) {
    const s = spanOf(p); if (!s) continue;
    const near = mgr.some(m => { const t = spanOf(m); return t && (t[1] === s[0] - 1 || t[0] === s[1] + 1) && facesOf(m, rack).some(f => facesOf(p, rack).includes(f)); });
    if (!near) missing.push(p.id);
  }
  return { need: panels.length, have: mgr.length, missing };
}
/** Obturateurs : U libres en façade d'une baie qui contient des équipements alimentés (0 s'il n'y en a pas). */
export function blanksNeeded(rack, devs, occ = occupancy(rack, devs)) {
  const hot = devs.some(d => { const m = mountDev(d); return m && m.u && ((m.typ ?? m.max ?? 0) > 0 || m.ups); });
  return hot ? occ.freeFront : 0;
}

/* ---------- Résumés (vue, conception, IA) ---------- */
/** Tout ce qu'on sait d'une baie : occupation, bilan électrique, profondeurs, passe-câbles, obturateurs, équipements. */
export function rackSummary(data, rack, lan, idx = rackIndex(data)) {
  const devs = idx.get(rack.id) || [], occ = occupancy(rack, devs), pw = rackPower(rack, devs, lan);
  const deep = devs.filter(d => { const m = mountDev(d); return m && m.u && m.depth != null && m.depth > rack.depth; }).map(d => d.id);
  return {
    id: rack.id, name: rack.name, kind: rack.kind, u: rack.u, usedU: occ.usedU, freeU: occ.freeFront, freeBoth: occ.freeBoth,
    collisions: occ.collisions, outside: occ.outside, deep, load: rack.load, ...pw,
    managers: cableManagers(rack, devs), blanks: blanksNeeded(rack, devs, occ), occ,
    devices: devs.map(d => { const m = mountDev(d) || {}; return { id: d.id, name: d.name, type: d.type, u: d.rack.u, h: m.u || 0, face: d.rack.face, kg: m.kg ?? null, ref: m.ref || '', depth: m.depth ?? null }; }).sort((a, b) => b.u - a.u)
  };
}
/** Résumé de toutes les baies (une seule passe d'index). */
export function racksSummary(data, lan) {
  const idx = rackIndex(data);
  return (data.racks || []).map(r => rackSummary(data, r, lan, idx));
}
/** Équipements montables en baie qui ne sont dans aucune baie connue. */
export function unracked(data) {
  const ids = new Set((data.racks || []).map(r => r.id));
  return (data.devices || []).filter(d => mountDev(d) && !(d.rack && ids.has(d.rack.id)));
}

/* ---------- Brassage ---------- */
/** VLAN d'un port d'un switch administrable (configuration de vlan.js : p.ports[port].vlan, sinon pvid / access). */
export function vlanOf(d, port) {
  const pp = d && d.p && d.p.ports && d.p.ports[port];
  if (!pp || typeof pp !== 'object') return null;
  const v = pp.vlan ?? pp.pvid ?? pp.access ?? null;
  return v == null || v === '' ? null : v;
}
/**
 * Plan de brassage : pour chaque port avant d'un panneau, le cordon vers le switch (ou un autre appareil) et, par le
 * lien permanent branché derrière, la prise au bout. o.rack : une baie seulement ; o.all : aussi les ports libres.
 */
export function patchingSchedule(data, lan, o = {}) {
  const byId = new Map((data.devices || []).map(d => [d.id, d])), racks = new Map((data.racks || []).map(r => [r.id, r]));
  const at = new Map();
  for (const c of data.cables || []) { at.set(c.a[0] + '|' + c.a[1], c); at.set(c.b[0] + '|' + c.b[1], c); }
  const other = (c, n, p) => (c.a[0] === n && c.a[1] === p ? c.b : c.a);
  // Ports par type et réglages (un panneau de 48 ports n'est construit qu'une fois, pas une fois par panneau).
  const pcache = new Map(), portsMap = d => { const k = d.type + '|' + JSON.stringify(d.p || {}); let m = pcache.get(k); if (!m) { m = new Map(portsOf(d).map(x => [x.id, x])); pcache.set(k, m); } return m; };
  const label = (d, pid) => { const p = d && portsMap(d).get(pid); return p ? p.label : pid; };
  const rows = [];
  for (const pn of data.devices || []) {
    if (!isPanel(pn)) continue;
    const rk = pn.rack && racks.get(pn.rack.id);
    if (o.rack && (!rk || rk.id !== o.rack)) continue;
    for (const p of portsMap(pn).values()) {
      if (p.punch || !p.passive) continue;
      const cf = at.get(pn.id + '|' + p.id), cb = at.get(pn.id + '|' + p.passive);
      if (!cf && !cb && !o.all) continue;
      const fe = cf ? other(cf, pn.id, p.id) : null, be = cb ? other(cb, pn.id, p.passive) : null;
      const sw = fe && byId.get(fe[0]), ou = be && byId.get(be[0]);
      const role = sw ? (specOf(sw) || {}).role : null;
      const l = lan && sw && lan.port ? lan.port(sw.id, fe[1]) : null;
      rows.push({
        rack: rk ? rk.name : '', rackId: rk ? rk.id : '', panel: pn.name, panelId: pn.id, port: p.label, portId: p.id,
        outlet: ou ? ou.name : '', outletId: ou ? ou.id : '', outletPort: be ? label(ou, be[1]) : '', permLen: cb ? cb.len : null,
        switch: sw ? sw.name : '', switchId: sw ? sw.id : '', switchPort: fe ? label(sw, fe[1]) : '', switchPortId: fe ? fe[1] : '',
        switchRole: role, vlan: sw ? vlanOf(sw, fe[1]) : null, cordLen: cf ? cf.len : null, cableId: cf ? cf.id : '',
        label: `${pn.tag || pn.name}-${p.label}`, up: l ? !!l.up : null
      });
    }
  }
  const nat = NAT.compare;
  return rows.sort((a, b) => nat(a.rack, b.rack) || nat(a.panel, b.panel) || nat(a.portId, b.portId));
}
const NAT = new Intl.Collator(undefined, { numeric: true });
/** Ports libres d'un équipement (pas de câble) : ids. side : 'front' (ports avant d'un panneau) ou tous. */
export function freePorts(data, d, side) {
  const used = new Set();
  for (const c of data.cables || []) { if (c.a[0] === d.id) used.add(c.a[1]); if (c.b[0] === d.id) used.add(c.b[1]); }
  return portsOf(d).filter(p => !used.has(p.id) && (side !== 'front' || !p.punch)).map(p => p.id);
}
/** Poids d'un équipement (kg) ou null. */
export const kgOf = type => (MOUNT[type] ? MOUNT[type].kg : null);
/** Conversion W → BTU/h. */
export const btu = w => Math.round(w * BTU_PER_W);
