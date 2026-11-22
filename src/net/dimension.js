// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Dimensionnement du câblage structuré : paramètres du projet (data.design), assistant de dimensionnement (pièces →
// postes de travail → prises → ports de switch, panneaux, baies, onduleur, PoE, câble, fibre) et générateur qui pose
// tout cela dans le modèle (prises, panneaux, switchs, liens permanents, cordons, liaisons montantes, VLAN de base).
// Module pur, sans interface : la vue Conception (ui/design.js), les vérifications (checks/design.js), les TP et les
// outils de l'IA s'en servent.
//
// data.design (cleanDesign) :
//   { std: 'tia'|'iso', area (m² par poste de travail), outlets (prises par poste), usage: { [usage]: { area, outlets,
//     phones (par poste), cams (par pièce), min (postes au moins par pièce) } }, apArea (m² par point d'accès estimé
//     quand le plan Wi-Fi n'en a pas ; 0 : aucun), spare (% de ports en réserve), oversub (rapport visé, n:1), uplinks
//     (liaisons montantes par switch d'accès), panel (24|48 ports), sw ('auto'|24|48), poe: { phone, ap, camera }
//     (classes PoE), poeMargin (% de budget PoE gardé libre), cat ('cat5e'|'cat6'|'cat6a'), box (m par touret), waste
//     (% de chutes), cord (m par cordon de brassage), slack: { tr, wa } (m de mou côté baie et côté prise : route.js les
//     lit), rackU, upsMargin (%), labels: { preset, space, link, panel, rack, pad } (docs.js ; preset 'auto' | 'tia' | 'campus' | 'rack' | 'custom'), prices: { [ligne]: prix },
//     currency, labour: [{ name, qty, unit, price }], project: { client, site, author, date, rev }, rooms: { [pièce]:
//     { tr (baie qui la dessert), outlets (nombre imposé) } }, ip: { block, gw: 'first'|'last', growth } (subnet.js),
//     exports: { csvHeaders: 'standard'|'local', csvSep: 'auto'|'semicolon'|'comma'|'tab', csvDecimal: 'auto'|'point'|'comma',
//     dxfScheme (schéma de nommage des calques du DXF, dxfexport.js) } }
//
// Chiffres « de la norme » : 10 m² par poste de travail et 2 prises par poste (TIA-569 et TIA-568, normes payantes,
// lus dans un guide public : clés de lim/design.js) ; 305 m par touret (fiche Leviton) ; 20:1 de surréservation entre
// accès et distribution (guide Cisco). Le reste (réserve, chutes, mou, prix, classes PoE prévues…) : valeurs par défaut
// modifiables, présentées comme telles.
import { cleanText } from '../sanitize.js';
import { DEVICES } from './devices.js';
import { makeCable, CATS } from './cable.js';
import { NET } from './limits.js';
import * as RACK from './rack.js';
import * as ROUTE from './route.js';
import * as VLAN from './vlan.js';

const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== '' && v !== null ? Math.max(lo, Math.min(hi, +v)) : d);
const int = (v, lo, hi, d) => Math.round(num(v, lo, hi, d));
const txt = (v, n) => cleanText(String(v ?? ''), n).trim();
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/* ---------- Usages des pièces ---------- */
/**
 * Densité par usage (valeurs par défaut modifiables) : area m² par poste (0 : pas de poste), outlets par poste, phones
 * par poste, cams par pièce, min postes au moins par pièce. Les bureaux suivent la règle de la norme (10 m², 2 prises).
 */
export const USAGES = {
  office: { area: NET.WA_AREA_M2.v, outlets: NET.WA_OUTLETS.v, phones: 1, cams: 0, min: 1 },
  open: { area: NET.WA_AREA_M2.v, outlets: NET.WA_OUTLETS.v, phones: 1, cams: 0, min: 1 },
  meeting: { area: 20, outlets: 2, phones: 0.5, cams: 0, min: 1 },
  classroom: { area: 30, outlets: 2, phones: 0, cams: 0, min: 2 },
  lab: { area: 5, outlets: 2, phones: 0, cams: 0, min: 1 },
  corridor: { area: 0, outlets: 2, phones: 0, cams: 1, min: 0 },
  storage: { area: 0, outlets: 2, phones: 0, cams: 0, min: 0 },
  tech: { area: 0, outlets: 2, phones: 0, cams: 0, min: 0 },
  other: { area: 10, outlets: 2, phones: 0, cams: 0, min: 0 }
};
export const USAGE_IDS = Object.keys(USAGES);
/** Usage d'une pièce (le plan peut employer d'autres mots) → clé de USAGES. */
const ALIAS = { bureau: 'office', office: 'office', openspace: 'open', open: 'open', 'open-office': 'open', plateau: 'open', reunion: 'meeting', meeting: 'meeting', conference: 'meeting', classe: 'classroom', classroom: 'classroom', salle: 'classroom', class: 'classroom', labo: 'lab', lab: 'lab', laboratory: 'lab', atelier: 'lab', workshop: 'lab', couloir: 'corridor', corridor: 'corridor', circulation: 'corridor', hall: 'corridor', stockage: 'storage', storage: 'storage', archive: 'storage', wc: 'storage', toilets: 'storage', sanitaires: 'storage', tech: 'tech', technical: 'tech', lt: 'tech', tr: 'tech', er: 'tech', ef: 'tech', sanitary: 'storage', server: 'tech', serveur: 'tech', local: 'tech', shaft: 'storage' };
export const usageOf = u => { const k = String(u || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ''); return USAGES[k] ? k : ALIAS[k] || 'other'; };

/* ---------- Paramètres (data.design) ---------- */
export const LABEL_PRESETS = ['auto', 'tia', 'campus', 'rack', 'custom'];
export const PRESETS = {
  /** TIA-606 (bâtiment) : local technique fs (étage + lettre), lien horizontal fs-an (panneau a, port n). */
  tia: { space: '{f}{s}', link: '{fs}-{p}{n}', panel: '{fs}-{p}', rack: '{fs}.R{r}', pad: 2 },
  /** Campus : le bâtiment devant chaque identifiant. */
  campus: { space: '{b}-{f}{s}', link: '{fs}-{p}{n}', panel: '{fs}-{p}', rack: '{fs}.R{r}', pad: 2 },
  /** Par position dans la baie (baie, unité du panneau, port), comme dans les salles informatiques. */
  rack: { space: '{f}{s}', link: '{fs}.R{r}-{u}:{n}', panel: '{fs}.R{r}-{u}', rack: '{fs}.R{r}', pad: 2 }
};
export const CURRENCIES = ['EUR', 'XOF', 'USD', 'GBP', 'CHF', 'CAD', 'MAD', 'XAF'];
/** Prix unitaires par défaut (à remplacer par ceux du projet ; 0 : à renseigner). */
export const PRICE_KEYS = ['outlet2', 'outlet', 'jack', 'patch24', 'patch48', 'patch', 'switch24', 'switch48', 'l3switch', 'poeswitch', 'switch', 'router', 'routerpro', 'server', 'ap', 'ap6', 'ap6e', 'camera', 'phone', 'fibrepanel', 'mediaconv', 'cablemgr', 'pdu', 'ups', 'shelf', 'blank', 'fan', 'rack', 'box_cat5e', 'box_cat6', 'box_cat6a', 'cord', 'fibre_m', 'fjumper', 'sfp', 'label'];
const RX_TOKEN = /^[^<>"'`]*$/;

/** Paramètres de conception propres et bornés (fichier, IA, anciens projets). Idempotent. */
export function cleanDesign(raw) {
  const r = obj(raw), u = obj(r.usage), poe = obj(r.poe), sl = obj(r.slack), lb = obj(r.labels), pr = obj(r.prices), pj = obj(r.project), ip = obj(r.ip), ex = obj(r.exports);
  const usage = {};
  for (const k of USAGE_IDS) {
    const d = USAGES[k], o = obj(u[k]);
    usage[k] = { area: num(o.area, 0, 1000, d.area), outlets: int(o.outlets, 0, 24, d.outlets), phones: num(o.phones, 0, 4, d.phones), cams: int(o.cams, 0, 20, d.cams), min: int(o.min, 0, 50, d.min) };
  }
  // Préréglage : 'auto' (TIA-606 pour un bâtiment, campus dès qu'il y en a plusieurs), un format fixe, ou 'custom'.
  const preset = PRESETS[lb.preset] || ['auto', 'custom'].includes(lb.preset) ? lb.preset : 'auto', P = PRESETS[preset] || PRESETS.tia;
  const fmt = (v, d) => { const s = preset === 'custom' ? txt(v, 60) : ''; return s && RX_TOKEN.test(s) ? s : d; };
  const prices = {};
  for (const [k, v] of Object.entries(pr).slice(0, 200)) { const kk = txt(k, 30); if (/^[\w-]+$/.test(kk) && Number.isFinite(+v) && +v >= 0) prices[kk] = Math.min(1e9, +v); }
  const rooms = {};
  for (const [k, v] of Object.entries(obj(r.rooms)).slice(0, 2000)) {
    const kk = txt(k, 40), o = obj(v); if (!kk) continue;
    const e = {}; const tr = txt(o.tr, 40); if (tr) e.tr = tr; if (o.outlets != null && o.outlets !== '') e.outlets = int(o.outlets, 0, 500, 0);
    if (Object.keys(e).length) rooms[kk] = e;
  }
  const area = num(r.area, 1, 1000, NET.WA_AREA_M2.v), outlets = int(r.outlets, 1, 24, NET.WA_OUTLETS.v);
  // Les bureaux suivent la densité générale (area, outlets) sauf réglage explicite de leur usage.
  if (!u.office) usage.office = { ...usage.office, area, outlets };
  return {
    std: r.std === 'iso' ? 'iso' : 'tia', area, outlets, usage,
    apArea: num(r.apArea, 0, 5000, 0), spare: num(r.spare, 0, 200, NET.DESIGN_SPARE_GROWTH.v), oversub: num(r.oversub, 1, 100, NET.OVERSUB_ACCESS.v),
    uplinks: int(r.uplinks, 1, 4, 1), panel: [24, 48].includes(+r.panel) ? +r.panel : 24, sw: [24, 48].includes(+r.sw) ? +r.sw : 'auto',
    poe: { phone: int(poe.phone, 0, 8, 1), ap: int(poe.ap, 0, 8, 4), camera: int(poe.camera, 0, 8, 3) }, poeMargin: num(r.poeMargin, 0, 90, 20),
    cat: CATS[r.cat] ? r.cat : 'cat6a', box: num(r.box, 50, 2000, NET.CABLE_BOX_M.v), waste: num(r.waste, 0, 100, 10), cord: num(r.cord, 0.3, 10, 1),
    slack: { tr: num(sl.tr, 0, 20, NET.SLACK_TR_M ? NET.SLACK_TR_M.v : 3), wa: num(sl.wa, 0, 5, NET.SLACK_WA_M ? NET.SLACK_WA_M.v : 0.3) },
    rackU: [12, 15, 18, 22, 24, 27, 32, 37, 42, 45, 47, 48].includes(+r.rackU) ? +r.rackU : 42, upsMargin: num(r.upsMargin, 0, 200, 25),
    labels: { preset, space: fmt(lb.space, P.space), link: fmt(lb.link, P.link), panel: fmt(lb.panel, P.panel), rack: fmt(lb.rack, P.rack), pad: int(lb.pad, 1, 4, P.pad) },
    prices, currency: CURRENCIES.includes(r.currency) ? r.currency : 'EUR',
    labour: (Array.isArray(r.labour) ? r.labour : []).slice(0, 50).map(l => obj(l)).map(l => ({ name: txt(l.name, 80), qty: num(l.qty, 0, 1e6, 1), unit: txt(l.unit, 12), price: num(l.price, 0, 1e9, 0) })).filter(l => l.name),
    project: { client: txt(pj.client, 80), site: txt(pj.site, 80), author: txt(pj.author, 80), date: /^\d{4}-\d{2}-\d{2}$/.test(pj.date || '') ? pj.date : '', rev: txt(pj.rev, 12) },
    rooms,
    ip: { block: txt(ip.block, 20) || '10.10.0.0/16', gw: ip.gw === 'last' ? 'last' : 'first', growth: num(ip.growth, 0, 400, 20), keep: ip.keep !== false && ip.keep !== 'no', minHosts: int(ip.minHosts, 1, 65534, 14) },
    exports: { csvHeaders: ex.csvHeaders === 'local' ? 'local' : 'standard', csvSep: ['auto', 'semicolon', 'comma', 'tab'].includes(ex.csvSep) ? ex.csvSep : 'auto', csvDecimal: ['auto', 'point', 'comma'].includes(ex.csvDecimal) ? ex.csvDecimal : 'auto', dxfScheme: typeof ex.dxfScheme === 'string' && /^[\w-]{1,24}$/.test(ex.dxfScheme) ? ex.dxfScheme : 'standard' }
  };
}

/* ---------- Géométrie (mètres) ---------- */
/** Aire d'un polygone [[x, y]…] (formule du lacet), en m². */
export function polyArea(poly) {
  let s = 0; const n = (poly || []).length;
  for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
/** Centre de gravité d'un polygone (moyenne des sommets si l'aire est nulle). */
export function polyCentroid(poly) {
  const n = (poly || []).length; if (!n) return [0, 0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n], f = p[0] * q[1] - q[0] * p[1]; a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f; }
  if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  return [cx / (3 * a), cy / (3 * a)];
}
/** Point dans un polygone (règle du rayon). */
export function inPoly(x, y, poly) {
  let ins = false; const n = (poly || []).length;
  for (let i = 0, j = n - 1; i < n; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) ins = !ins; }
  return ins;
}
/** Pièces à trous (cour, patio : room.holes, voir site.js) : surface, point dans la pièce, centre hors des trous. */
const inHole = (x, y, r) => (r.holes || []).some(hh => inPoly(x, y, hh));
export const inRoomXY = (x, y, r) => inPoly(x, y, r.poly) && !inHole(x, y, r);
export const roomAreaOf = r => Math.max(0, polyArea(r.poly) - (r.holes || []).reduce((s, hh) => s + polyArea(hh), 0));
export function roomCenterOf(r) {
  const c = polyCentroid(r.poly); if (!r.holes || !r.holes.length || inRoomXY(c[0], c[1], r)) return c;
  for (const p of r.poly) for (const t of [0.5, 0.25, 0.75]) { const q = [p[0] + (c[0] - p[0]) * t, p[1] + (c[1] - p[1]) * t]; if (inRoomXY(q[0], q[1], r)) return q; }
  return c;
}
/** Points régulièrement espacés le long du contour, à d mètres vers l'intérieur (prises au pied des murs). */
export function alongWalls(poly, n, inset = 0.3) {
  if (!poly || poly.length < 3 || n <= 0) return [];
  const c = polyCentroid(poly), segs = [];
  let per = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push([a, b, l]); per += l; }
  const out = [], step = per / n;
  for (let k = 0; k < n; k++) {
    let t = (k + 0.5) * step;
    for (const [a, b, l] of segs) {
      if (t > l) { t -= l; continue; }
      const f = l ? t / l : 0, x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
      const dx = c[0] - x, dy = c[1] - y, d = Math.hypot(dx, dy) || 1, k2 = Math.min(inset, d / 2);
      out.push([+(x + (dx / d) * k2).toFixed(2), +(y + (dy / d) * k2).toFixed(2)]);
      break;
    }
  }
  return out;
}

/* ---------- Types d'équipements (selon ce que devices.js connaît) ---------- */
const has = t => !!DEVICES[t];
export const pickType = list => list.find(has) || null;
const portsOfType = t => (has(t) ? DEVICES[t].ports(DEVICES[t].props()) : []);
const isUp = p => !!p.sfp || /^x\d+$/.test(p.id);
/** Ports d'accès (RJ45 hors cages SFP) et ports montants d'un type de switch. */
export function switchPorts(type) {
  const ps = portsOfType(type), up = ps.filter(isUp), acc = ps.filter(p => !isUp(p));
  if (!up.length && acc.length > 1) return { acc: acc.slice(0, -1), up: acc.slice(-1) }; // petit switch : son dernier port monte
  return { acc, up };
}
const panelBack = t => portsOfType(t).filter(p => p.punch);
const panelFront = t => portsOfType(t).filter(p => p.passive && !p.punch);
/** Types retenus pour le générateur : les types professionnels si devices.js les a, sinon les types de base. */
export function designTypes(d) {
  const sw = d.sw === 24 ? ['switch24', 'switch48'] : d.sw === 48 ? ['switch48', 'switch24'] : ['switch48', 'switch24'];
  return {
    outlet: pickType(['outlet2', 'outlet']), single: pickType(['outlet', 'outlet2']),
    panel: pickType(d.panel === 48 ? ['patch48', 'patch24', 'patch'] : ['patch24', 'patch48', 'patch']),
    sw48: pickType([...sw, 'poeswitch', 'switch']), sw24: pickType(['switch24', 'switch48', 'poeswitch', 'switch']),
    core: pickType(['l3switch', 'switch48', 'switch24']), fpanel: pickType(['fibrepanel']), mgr: pickType(['cablemgr']),
    pdu: pickType(['pdu', 'pdu1u']), blank: pickType(['blank']), ups: upsTypes()
  };
}
/** Onduleurs connus de rack.js (MOUNT[type].ups : { va, w, pts }), du plus petit au plus grand. */
const upsTypes = () => (RACK.MOUNT ? Object.keys(RACK.MOUNT).filter(t => has(t) && RACK.MOUNT[t].ups).sort((a, b) => RACK.MOUNT[a].ups.w - RACK.MOUNT[b].ups.w) : []);
/** Onduleur pour une puissance (W) : le plus petit qui la tient, sinon le plus grand. */
export function pickUps(T, w) {
  if (!T.ups || !T.ups.length) return null;
  return T.ups.find(t => RACK.MOUNT[t].ups.w >= w) || T.ups[T.ups.length - 1];
}
/** Hauteur (U), puissance typique (W) d'un type monté en baie : rack.js (MOUNT) si présent, sinon valeurs courantes. */
const U_FALLBACK = { patch: 1, patch24: 1, patch48: 2, switch: 1, poeswitch: 1, switch24: 1, switch48: 1, l3switch: 1, fibrepanel: 1, cablemgr: 1, ups: 2, router: 1, routerpro: 1, server: 1, pdu: 1, shelf: 1, blank: 1, fan: 1 };
export function mountOf(type) {
  const m = RACK.MOUNT && RACK.MOUNT[type];
  if (m) return { u: m.u === 0 ? 0 : +m.u || 1, w: +(m.typ ?? m.max ?? 0) || 0, wmax: +(m.max ?? m.typ ?? 0) || 0, kg: +(m.kg ?? 0) || 0, src: 'rack' };
  return { u: U_FALLBACK[type] || 1, w: 0, wmax: 0, kg: 0, src: 'fallback' };
}
const poeW = cls => (NET.POE_PSE_W.v[Math.max(0, Math.min(8, cls | 0))] || 0);
/** Budget PoE d'un type de switch (W) : celui de ses réglages par défaut (fiche reprise par devices.js), ou 0. */
export const poeBudgetOf = type => { if (!has(type)) return 0; const p = DEVICES[type].props(); return +(p.budget ?? (p.poe && p.poe.budget) ?? 0) || 0; };

/* ---------- Site ---------- */
/** Étages du site, à plat : [{ b (bâtiment), bi (rang), f (étage) }]. */
export function floorsOf(data) {
  const out = [];
  ((data.site && data.site.buildings) || []).forEach((b, bi) => (b.floors || []).forEach(f => out.push({ b, bi, f })));
  return out;
}
/** Locaux techniques : baies regroupées par pièce (ou seules), avec leur position. */
export function spacesOf(data) {
  const fl = new Map(floorsOf(data).map(x => [x.f.id, x])), groups = new Map();
  for (const r of data.racks || []) {
    const F = fl.get(r.floor); if (!F) continue;
    const key = r.floor + '|' + (r.room || r.id);
    if (!groups.has(key)) groups.set(key, { key, floor: r.floor, building: F.b.id, bi: F.bi, level: +F.f.level || 0, elev: +F.f.elev || 0, room: r.room || null, racks: [], x: 0, y: 0, virtual: false });
    groups.get(key).racks.push(r);
  }
  const out = [...groups.values()];
  for (const g of out) { g.x = g.racks.reduce((s, r) => s + (+r.x || 0), 0) / g.racks.length; g.y = g.racks.reduce((s, r) => s + (+r.y || 0), 0) / g.racks.length; }
  return out;
}
/** Lettre de chaque local technique sur son étage (A, B…), de gauche à droite. */
export function spaceLetters(spaces) {
  const by = new Map();
  for (const s of spaces) { if (!by.has(s.floor)) by.set(s.floor, []); by.get(s.floor).push(s); }
  const m = new Map();
  for (const list of by.values()) list.sort((a, b) => a.x - b.x || a.y - b.y || (a.key < b.key ? -1 : 1)).forEach((s, i) => m.set(s.key, letters(i)));
  return m;
}
export const letters = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

/* ---------- Assistant de dimensionnement ---------- */
/**
 * dimension(data) → résultats (rien n'est modifié). Pièces → postes de travail et prises ; chaque pièce est desservie par
 * le local technique imposé (design.rooms[id].tr), sinon le plus proche du même étage, sinon celui de l'étage le plus
 * proche du même bâtiment ; un étage sans baie reçoit un local « à créer » (virtual). Puis, par local : ports avec
 * réserve, panneaux, switchs (24/48), liaisons montantes et surréservation, PoE, unités de baie, onduleur, câble.
 * Longueur de câble : réelle (câbles posés) quand il y en a, sinon estimée (modèle simplifié : trajet en L sous le
 * plafond + descentes + mou).
 */
export function dimension(data, lan) {
  void lan;
  const D = data.design && data.design.usage ? data.design : cleanDesign(data.design), T = designTypes(D);
  const floors = floorsOf(data), spaces = spacesOf(data), warnings = [];
  // Étages sans baie : un local à créer, dans la pièce technique s'il y en a une, sinon au centre de l'étage.
  const withTr = new Set(spaces.map(s => s.floor));
  for (const { b, bi, f } of floors) {
    if (withTr.has(f.id) || !(f.rooms || []).length) continue;
    const tech = (f.rooms || []).find(r => usageOf(r.usage) === 'tech');
    const c = tech ? roomCenterOf(tech) : centerOf(f.rooms);
    spaces.push({ key: f.id + '|new', floor: f.id, building: b.id, bi, level: +f.level || 0, elev: +f.elev || 0, room: tech ? tech.id : null, racks: [], x: +c[0].toFixed(2), y: +c[1].toFixed(2), virtual: true });
  }
  const letter = spaceLetters(spaces), skey = new Map(spaces.map(s => [s.key, s]));
  const rackSpace = new Map(); for (const s of spaces) for (const r of s.racks) rackSpace.set(r.id, s);
  // Prises déjà posées (pour comparer) et appareils PoE du plan, par pièce.
  const placed = devicesByRoom(data, floors);
  // Avec des cheminements tracés (route.js), la longueur estimée suit leur plus court chemin (jusqu'à 400 pièces).
  const nR = floors.reduce((a, x) => a + (x.f.rooms || []).length, 0);
  const viaPaths = (data.paths || []).length && nR <= 400 && typeof ROUTE.pathDistance === 'function' && typeof ROUTE.graphOf === 'function' ? { data, g: ROUTE.graphOf(data) } : null;
  const rooms = [];
  for (const { b, f } of floors) {
    const h = +f.height || 3;
    for (const r of f.rooms || []) {
      const us = usageOf(r.usage), U = D.usage[us], area = roomAreaOf(r), c = roomCenterOf(r), ov = D.rooms[r.id] || {};
      let wa = U.area > 0 ? Math.max(U.min, Math.ceil(area / U.area - 1e-9)) : U.min;
      const aps = placed.get(r.id) ? placed.get(r.id).aps : 0, apEst = !aps && D.apArea > 0 && U.area > 0 ? Math.ceil(area / D.apArea) : 0;
      const cams = U.cams, phones = Math.round(wa * U.phones);
      let outlets = wa * U.outlets + (aps || apEst) + cams;
      if (ov.outlets != null) { outlets = ov.outlets; wa = Math.ceil(outlets / Math.max(1, U.outlets)); }
      // Local qui dessert la pièce.
      let sp = ov.tr ? rackSpace.get(ov.tr) || null : null;
      if (!sp) sp = nearestSpace(spaces, f, b, c);
      const run = sp ? runEstimate(sp, c, f, h, D, floors, viaPaths) : 0;
      rooms.push({ id: r.id, name: r.name || r.id, floor: f.id, building: b.id, usage: us, area: +area.toFixed(1), wa, outlets, phones, cams, aps: aps || apEst, apEst: !aps && apEst > 0, apIds: placed.get(r.id) ? placed.get(r.id).apIds : [], placed: placed.get(r.id) ? placed.get(r.id).ports : 0, tr: sp ? sp.key : null, run: +run.toFixed(1), c });
    }
  }
  const unserved = rooms.filter(r => r.outlets > 0 && !r.tr).map(r => r.id);
  // Câbles horizontaux réels par local (lien permanent : prise ↔ arrière d'un panneau).
  const links = horizontalLinks(data);
  const trs = [];
  for (const s of spaces) {
    const rs = rooms.filter(r => r.tr === s.key), outlets = rs.reduce((a, r) => a + r.outlets, 0);
    const ports = Math.ceil(outlets * (1 + D.spare / 100));
    const panelType = T.panel, pp = panelBack(panelType).length || 24, panels = ports ? Math.ceil(ports / pp) : 0;
    const sw = chooseSwitches(ports, D, T);
    const swN = sw.reduce((a, x) => a + x.n, 0), accPorts = sw.reduce((a, x) => a + x.n * x.ports, 0);
    const upSpeed = sw.length ? Math.max(...sw.map(x => x.upSpeed)) : 10000, accSpeed = sw.length ? Math.max(...sw.map(x => x.accSpeed)) : 1000;
    const upN = swN * D.uplinks, oversub = upN ? (outlets * accSpeed) / (upN * upSpeed) : 0;
    const phones = rs.reduce((a, r) => a + r.phones, 0), aps = rs.reduce((a, r) => a + r.aps, 0), cams = rs.reduce((a, r) => a + r.cams, 0);
    const poeNeed = phones * poeW(D.poe.phone) + aps * poeW(D.poe.ap) + cams * poeW(D.poe.camera);
    const poeBudget = sw.reduce((a, x) => a + x.n * x.budget, 0);
    const fp = T.fpanel && spaces.length > 1 && outlets ? 1 : 0, mgrs = T.mgr ? Math.max(swN, Math.ceil(panels / 2)) + fp : 0;
    const upsT = outlets ? pickUps(T, (sw.reduce((a, x) => a + x.n * mountOf(x.type).w, 0) + 0) * (1 + D.upsMargin / 100)) : null;
    const uNeed = panels * mountOf(panelType).u + sw.reduce((a, x) => a + x.n * mountOf(x.type).u, 0) + mgrs * mountOf(T.mgr || 'cablemgr').u + fp * mountOf('fibrepanel').u + (upsT ? mountOf(upsT).u : 0);
    const loadW = sw.reduce((a, x) => a + x.n * mountOf(x.type).w, 0) + poeNeed;
    const realRuns = links.filter(l => l.space === s.key || (l.rack && rackSpace.get(l.rack) === s));
    const est = !realRuns.length;
    const avg = est ? (rs.length ? rs.reduce((a, r) => a + r.run * r.outlets, 0) / Math.max(1, outlets) : 0) : realRuns.reduce((a, l) => a + l.len, 0) / realRuns.length;
    const runs = est ? outlets : realRuns.length, total = est ? avg * outlets : realRuns.reduce((a, l) => a + l.len, 0);
    const far = rs.filter(r => r.run > NET.PERMANENT_M.v).map(r => r.id);
    if (far.length) warnings.push({ kind: 'far', tr: s.key, rooms: far });
    trs.push({
      key: s.key, letter: letter.get(s.key), floor: s.floor, building: s.building, bi: s.bi, level: s.level, room: s.room, x: s.x, y: s.y, virtual: s.virtual, racks: s.racks.map(r => r.id),
      rooms: rs.map(r => r.id), outlets, ports, panelType, panelPorts: pp, panels, switches: sw, swN, accPorts, stack: swN > 1 ? swN : 0,
      uplinks: upN, upSpeed, oversub: +oversub.toFixed(2), oversubOk: oversub <= D.oversub, phones, aps, cams,
      poe: { need: +poeNeed.toFixed(1), budget: poeBudget, ok: !poeBudget ? poeNeed === 0 : poeNeed <= poeBudget * (1 - D.poeMargin / 100) },
      mgrs, fpanel: fp, u: uNeed, racksNeeded: uNeed ? Math.max(1, Math.ceil(uNeed / (D.rackU * 0.8))) : 0,
      ups: upsOf(loadW, D, sw),
      cable: { est, runs, avg: +avg.toFixed(1), total: Math.round(total) }
    });
  }
  // Câble : tourets (méthode des longueurs par touret : un touret donne floor(box / longueur moyenne) liens).
  const cable = cableTakeoff(trs, D);
  const fibre = fibreTakeoff(data, trs);
  const totals = {
    rooms: rooms.length, area: +rooms.reduce((a, r) => a + r.area, 0).toFixed(1), wa: rooms.reduce((a, r) => a + r.wa, 0), outlets: rooms.reduce((a, r) => a + r.outlets, 0),
    ports: trs.reduce((a, t) => a + t.ports, 0), panels: trs.reduce((a, t) => a + t.panels, 0), switches: trs.reduce((a, t) => a + t.swN, 0),
    sw24: trs.reduce((a, t) => a + t.switches.filter(x => x.ports <= 24).reduce((s, x) => s + x.n, 0), 0), sw48: trs.reduce((a, t) => a + t.switches.filter(x => x.ports > 24).reduce((s, x) => s + x.n, 0), 0),
    phones: trs.reduce((a, t) => a + t.phones, 0), aps: trs.reduce((a, t) => a + t.aps, 0), cams: trs.reduce((a, t) => a + t.cams, 0), poeW: +trs.reduce((a, t) => a + t.poe.need, 0).toFixed(1),
    u: trs.reduce((a, t) => a + t.u, 0), racks: trs.reduce((a, t) => a + Math.max(t.racks.length, t.racksNeeded), 0), newRacks: trs.reduce((a, t) => a + Math.max(0, t.racksNeeded - t.racks.length), 0),
    oversubMax: trs.reduce((a, t) => Math.max(a, t.oversub), 0), upsW: trs.reduce((a, t) => a + t.ups.sizedW, 0), trs: trs.length,
    cableM: cable.total, boxes: cable.boxes, fibreStrands: fibre.strands, fibreM: fibre.len
  };
  const floorsOut = floors.map(({ b, f }) => {
    const rs = rooms.filter(r => r.floor === f.id);
    return { id: f.id, name: f.name || f.id, building: b.id, buildingName: b.name || b.id, level: +f.level || 0, rooms: rs.length, area: +rs.reduce((a, r) => a + r.area, 0).toFixed(1), wa: rs.reduce((a, r) => a + r.wa, 0), outlets: rs.reduce((a, r) => a + r.outlets, 0), trs: trs.filter(t => t.floor === f.id).map(t => t.key) };
  });
  return { params: D, types: T, rooms, trs, floors: floorsOut, totals, cable, fibre, unserved, warnings };
}
/** Onduleur d'un local : charge (switchs typiques + PoE prévu), avec la marge ; VA par le facteur de puissance de rack.js. */
function upsOf(loadW, D, sw) {
  const sized = Math.round(loadW * (1 + D.upsMargin / 100)), pf = RACK.RACK_DESIGN && +RACK.RACK_DESIGN.pf;
  return { loadW: Math.round(loadW), sizedW: sized, va: pf ? Math.round(sized / pf) : null, known: sw.every(x => mountOf(x.type).src === 'rack') };
}
const centerOf = rooms => { const pts = rooms.flatMap(r => r.poly || []); if (!pts.length) return [0, 0]; const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };
function nearestSpace(spaces, f, b, c) {
  let best = null, bd = Infinity;
  for (const s of spaces) if (s.floor === f.id) { const d = Math.abs(s.x - c[0]) + Math.abs(s.y - c[1]); if (d < bd) { bd = d; best = s; } }
  if (best) return best;
  const lv = +f.level || 0;
  for (const s of spaces) if (s.building === b.id) { const d = Math.abs(s.level - lv) * 1000 + Math.abs(s.x - c[0]) + Math.abs(s.y - c[1]); if (d < bd) { bd = d; best = s; } }
  return best;
}
/**
 * Longueur estimée d'un lien (modèle simplifié) : par les cheminements tracés quand il y en a (route.js, du centre de la
 * pièce au local), sinon trajet en L, montée au plafond et descente, écart d'étage ; plus le mou des deux bouts.
 */
function runEstimate(sp, c, f, h, D, floors, via) {
  if (via) {
    try { const r = ROUTE.pathDistance(via.data, { floor: sp.floor, x: sp.x, y: sp.y, h: 1.5 }, { floor: f.id, x: c[0], y: c[1], h: 0.3 }, via.g); if (Number.isFinite(r.len)) return r.len + D.slack.tr + D.slack.wa; } catch (e) { /* repli */ }
  }
  const flo = floors.find(x => x.f.id === sp.floor), dz = flo ? Math.abs((+flo.f.elev || 0) - (+f.elev || 0)) : 0;
  return Math.abs(sp.x - c[0]) + Math.abs(sp.y - c[1]) + 2 * Math.max(0, h - 1) + dz + D.slack.tr + D.slack.wa;
}
/** Switchs d'un local : le moins de switchs possible (48 ports), le dernier en 24 ports s'il suffit. */
function chooseSwitches(ports, D, T) {
  if (!ports) return [];
  const t48 = T.sw48, t24 = T.sw24, info = t => { const sp = switchPorts(t); return { type: t, ports: sp.acc.length, ups: sp.up.length, upSpeed: Math.max(1000, ...sp.up.map(p => p.speed || 1000)), accSpeed: Math.max(100, ...sp.acc.map(p => p.speed || 1000)), budget: poeBudgetOf(t) }; };
  const A = info(t48), B = info(t24);
  if (!A.ports) return [];
  if (D.sw === 24 && B.ports) return [{ ...B, n: Math.ceil(ports / B.ports) }];
  const n48 = Math.floor(ports / A.ports), rem = ports - n48 * A.ports, out = [];
  if (rem > 0 && B.ports && B.type !== A.type && rem <= B.ports && D.sw !== 48) { if (n48) out.push({ ...A, n: n48 }); out.push({ ...B, n: 1 }); }
  else out.push({ ...A, n: n48 + (rem > 0 ? 1 : 0) });
  return out;
}
/** Tourets de câble : liens par touret (longueur moyenne + chutes), tourets par local, total. */
export function cableTakeoff(trs, D) {
  let total = 0, boxes = 0; const per = [];
  for (const t of trs) {
    const len = t.cable.avg * (1 + D.waste / 100), perBox = len > 0 ? Math.max(1, Math.floor(D.box / len)) : 0;
    const n = perBox ? Math.ceil(t.cable.runs / perBox) : 0;
    total += t.cable.total; boxes += n; per.push({ tr: t.key, perBox, boxes: n });
    if (len > D.box) per[per.length - 1].tooLong = true;
  }
  return { total: Math.round(total), withWaste: Math.round(total * (1 + D.waste / 100)), boxes, box: D.box, cat: D.cat, per };
}
/**
 * Fibre de rocade : brins comptés sur les câbles fibre du modèle (fibre.js : champ strands, sinon 2 par câble duplex) ;
 * sans câble fibre, besoin estimé (modèle simplifié) : 2 brins par liaison montante de chaque local hors du local
 * principal, plus la réserve de ports (spare), arrondis à 12 brins.
 */
export function fibreTakeoff(data, trs) {
  const fc = (data.cables || []).filter(c => c.media === 'fibre');
  if (fc.length) return { est: false, cables: fc.length, strands: fc.reduce((a, c) => a + (+c.strands || 2), 0), len: Math.round(fc.reduce((a, c) => a + (+c.len || 0), 0)) };
  const main = mainSpace(trs), sp = 1 + ((data.design && +data.design.spare) || 0) / 100;
  const need = trs.filter(t => t !== main && t.outlets > 0).map(t => ({ tr: t.key, strands: Math.max(12, Math.ceil((t.uplinks * 2 * sp) / 12) * 12) }));
  return { est: true, cables: need.length, strands: need.reduce((a, x) => a + x.strands, 0), len: 0, per: need };
}
/** Local principal (salle informatique) : le plus bas du premier bâtiment, celui qui a le plus de prises à égalité. */
export const mainSpace = trs => trs.slice().sort((a, b) => a.bi - b.bi || a.level - b.level || b.outlets - a.outlets || (a.key < b.key ? -1 : 1))[0] || null;
/** Ports de prise posés et points d'accès, par pièce (place loc dans le polygone de la pièce). */
function devicesByRoom(data, floors) {
  const m = new Map(), roomsOf = new Map(floors.map(x => [x.f.id, x.f.rooms || []]));
  for (const d of data.devices || []) {
    if (!d.loc || !roomsOf.has(d.loc.floor)) continue;
    const r = roomsOf.get(d.loc.floor).find(z => inRoomXY(d.loc.x, d.loc.y, z)); if (!r) continue;
    if (!m.has(r.id)) m.set(r.id, { ports: 0, aps: 0, apIds: [] });
    const e = m.get(r.id);
    if (d.type === 'outlet' || d.type === 'outlet2') e.ports += d.type === 'outlet2' ? 2 : 1;
    if (d.type === 'ap' || d.type === 'ap6' || d.type === 'ap6e') { e.aps++; e.apIds.push(d.id); }
  }
  return m;
}
/** Pièce où se trouve un équipement (par sa place sur le plan) ou null. */
export function roomOfDev(data, d) {
  if (!d || !d.loc) return null;
  for (const { f } of floorsOf(data)) if (f.id === d.loc.floor) return (f.rooms || []).find(z => inRoomXY(d.loc.x, d.loc.y, z)) || null;
  return null;
}
/** Liens permanents du modèle : câble entre l'arrière d'une prise et l'arrière d'un panneau. */
export function horizontalLinks(data) {
  const byId = new Map((data.devices || []).map(d => [d.id, d])), out = [];
  for (const c of data.cables || []) {
    const A = byId.get(c.a[0]), B = byId.get(c.b[0]); if (!A || !B) continue;
    const isO = d => d.type === 'outlet' || d.type === 'outlet2', isP = d => /^patch/.test(d.type);
    const o = isO(A) && isP(B) ? [A, c.a[1], B, c.b[1]] : isO(B) && isP(A) ? [B, c.b[1], A, c.a[1]] : null;
    if (!o || !/back/.test(o[1])) continue;
    out.push({ cable: c.id, outlet: o[0].id, oport: o[1], panel: o[2].id, pport: o[3], len: +c.len || 0, rack: o[2].rack ? o[2].rack.id : null, cat: c.cat });
  }
  return out;
}

/* ---------- Générateur ---------- */
/**
 * applyDesign(data, opts) : pose dans le modèle ce que le dimensionnement demande (data est modifié ; l'appelant fait
 * UN ctx.commit()). Par local : baie (créée s'il n'y en a pas), panneaux et switchs montés de haut en bas, prises
 * doubles le long des murs de chaque pièce (prise simple au plafond pour chaque point d'accès et caméra prévus), liens
 * permanents (arrière de prise ↔ arrière de panneau, tracé automatique), cordons (avant du panneau ↔ port du switch),
 * liaisons montantes vers le cœur de réseau (switch de niveau 3 du local principal ; fibre et panneaux optiques entre
 * locaux quand ces types existent), VLAN de base. Les pièces qui ont déjà des prises sont laissées telles quelles.
 * opts : { rooms?: [ids] (seulement ces pièces), vlans?: bool (true), dry?: bool }.
 * Rend { created: { devices, cables, racks, vlans, outlets, panels, switches }, removed (obturateurs retirés pour faire
 * place), skipped: [pièces déjà équipées], notes }. Les U libres des baies équipées reçoivent des obturateurs (opts.blanks
 * false : non) ; un passage suivant les retire là où il monte un équipement.
 */
export function applyDesign(data, opts = {}) {
  const dim = dimension(data), D = dim.params, T = dim.types;
  for (const k of ['devices', 'cables', 'racks', 'vlans']) if (!Array.isArray(data[k])) data[k] = [];
  const ids = new Set(data.devices.map(d => d.id)), names = new Set(data.devices.map(d => d.name)), cids = new Set(data.cables.map(c => c.id)), rids = new Set(data.racks.map(r => r.id));
  const created = { devices: 0, cables: 0, racks: 0, vlans: 0, outlets: 0, panels: 0, switches: 0 }, notes = [], skipped = [];
  let removed = 0; // obturateurs retirés pour faire place
  if (!T.outlet || !T.panel || !T.sw48) return { created, skipped, notes: ['types'] };
  const usedPorts = new Set(); for (const c of data.cables) { usedPorts.add(c.a.join('|')); usedPorts.add(c.b.join('|')); }
  const fid = p => { let i = 1; while (ids.has(p + i)) i++; ids.add(p + i); return p + i; };
  // Noms des équipements posés : préfixe du type (localisé : OBT/BLK, PASS/CM, OND/UPS…), noms de pièces coupés sur un mot.
  const pre = t => (DEVICES[t] && DEVICES[t].prefix) || 'N';
  // Mots vides retirés, puis mots entiers tant qu'ils tiennent ; le dernier mot est raccourci (4 lettres au moins) plutôt
  // que laissé en suspens (« Salle des » → « Salle profes ») ; jamais d'espace final.
  const STOP = /^(de|des|du|la|le|les|d|l|à|au|aux|et|en|of|the|and|for|a|an)$/i;
  const short = (s, n) => {
    s = String(s || '').trim(); if (s.length <= n) return s;
    let out = '';
    for (const w of s.replace(/[’']/g, ' ').split(/\s+/).filter(x => x && !STOP.test(x))) {
      const room = n - (out ? out.length + 1 : 0); if (room < Math.min(4, w.length)) break;
      out += (out ? ' ' : '') + w.slice(0, room); if (w.length > room) break;
    }
    return out || s.slice(0, n).trim();
  };
  const fname = n => { let s = n.slice(0, 24).trim(), i = 2; while (names.has(s)) s = (n.slice(0, 20).trim() + '-' + i++).slice(0, 24); names.add(s); return s; };
  const cid = () => { let i = data.cables.length + 1; while (cids.has('c' + i)) i++; cids.add('c' + i); return 'c' + i; };
  // Schéma logique : à droite de ce qui existe déjà.
  const x0 = data.devices.length ? Math.max(...data.devices.map(d => d.x)) + 260 : 0, y0 = data.devices.length ? Math.min(...data.devices.map(d => d.y)) : 0;
  const addDev = (type, name, at, extra = {}) => {
    const s = DEVICES[type], d = { id: fid((s.prefix || 'n').toLowerCase()), type, x: Math.round(at.x), y: Math.round(at.y), name: fname(name), p: s.props(), ...extra };
    data.devices.push(d); created.devices++; return d;
  };
  const addCable = (a, b, o = {}) => {
    const ka = a.join('|'), kb = b.join('|'); if (usedPorts.has(ka) || usedPorts.has(kb)) return null;
    usedPorts.add(ka); usedPorts.add(kb);
    const c = { id: cid(), a, b, cat: o.cat || D.cat, len: +(o.len || 3).toFixed(1), wire: makeCable('straight') };
    if (o.route) c.route = o.route; if (o.media) Object.assign(c, o.media);
    data.cables.push(c); created.cables++; return c;
  };
  const only = Array.isArray(opts.rooms) && opts.rooms.length ? new Set(opts.rooms) : null;
  const main = mainSpace(dim.trs), fl = new Map(floorsOf(data).map(x => [x.f.id, x]));
  const rackPos = new Map(); // baie → unités prises
  // Unités occupées en façade : Map(U → équipement) ; un obturateur cède sa place (il est retiré quand on monte à sa place).
  const occ = rack => { if (!rackPos.has(rack.id)) { const s = new Map(); for (const d of data.devices) if (d.rack && d.rack.id === rack.id && d.rack.face !== 'rear') { const u = mountOf(d.type).u; for (let k = 0; k < u; k++) s.set(d.rack.u + k, d); } rackPos.set(rack.id, s); } return rackPos.get(rack.id); };
  /** Monte un équipement dans la première place libre en partant du haut ; une nouvelle baie si tout est plein. */
  const touched = new Map(); // baie → local (finitions : PDU, onduleur, obturateurs)
  const fits = (o, at, u) => { for (let k = 0; k < u; k++) { const d = o.get(at + k); if (d && d.type !== 'blank') return false; } return true; };
  const take = (o, at, u, dev = true) => {
    for (let k = 0; k < u; k++) { const d = o.get(at + k); if (d && d.type === 'blank') { const i = data.devices.indexOf(d); if (i >= 0) { data.devices.splice(i, 1); ids.delete(d.id); names.delete(d.name); removed++; } } o.set(at + k, dev); }
  };
  const mount = (sp, type) => {
    const u = mountOf(type).u;
    for (const rk of sp.rackObjs) {
      const o = occ(rk), top = +rk.u || D.rackU;
      // en gardant les 2 U du bas pour l'onduleur
      for (let at = top - u + 1; at >= 3; at--) if (fits(o, at, u)) { take(o, at, u); touched.set(rk.id, sp); return { id: rk.id, u: at, face: 'front' }; }
    }
    const rk = newRack(sp); sp.rackObjs.push(rk); return mount(sp, type);
  };
  /** Monte en bas de la baie (onduleur). */
  const mountLow = (rk, type) => { const o = occ(rk), u = mountOf(type).u; for (let at = 1; at + u - 1 <= (+rk.u || D.rackU); at++) if (fits(o, at, u)) { take(o, at, u); return { id: rk.id, u: at, face: 'front' }; } return null; };
  const newRack = sp => {
    let i = 1; while (rids.has('rk' + i)) i++; const id = 'rk' + i; rids.add(id);
    const n = sp.rackObjs.length, kind = D.rackU <= 24 ? 'wall' : 'floor';
    const at = { id, name: (sp.label + '.R' + String(n + 1).padStart(2, '0')).slice(0, 24), floor: sp.floor, room: sp.room || '', x: +(sp.x + n * 0.7).toFixed(2), y: +sp.y.toFixed(2), rot: 0, kind, u: D.rackU };
    // Baie de référence de rack.js (largeur, profondeur, charge…) si elle existe, sinon les dimensions courantes.
    let rk = null; if (typeof RACK.newRack === 'function') { try { rk = { ...RACK.newRack(data, kind, at), ...at }; } catch (e) { rk = null; } }
    if (!rk) rk = { ...at, w: 600, d: kind === 'wall' ? 600 : 800 };
    if (!rk.room) delete rk.room;
    data.racks.push(rk); created.racks++; return rk;
  };
  // Disposition du schéma logique : cœur en haut, puis par local une colonne (switchs, panneaux, prises).
  let colX = x0; const COL_GAP = 120;
  const core = { dev: null, next: 1, ports: [] };
  const spaces = dim.trs.map(t => ({ ...t, label: (t.level < 0 ? 'S' + -t.level : String(t.level)) + t.letter, rackObjs: data.racks.filter(r => t.racks.includes(r.id)) }));
  const mainSp = main ? spaces.find(s => s.key === main.key) : null;
  const multi = spaces.filter(s => s.outlets > 0).length > 1;
  /** Cœur de réseau : celui déjà monté dans le local principal, sinon créé au premier besoin. */
  const coreDev = () => {
    if (core.dev || !multi || !T.core || !mainSp) return core.dev;
    core.dev = data.devices.find(d => d.type === T.core && d.rack && mainSp.rackObjs.some(r => r.id === d.rack.id)) || addDev(T.core, pre(T.core) + '-' + mainSp.label, { x: x0 + 200, y: y0 }, { rack: mount(mainSp, T.core) });
    core.ports = switchPorts(core.dev.type).up.concat(switchPorts(core.dev.type).acc).map(p => p.id);
    // Le cœur doit être la racine du Spanning Tree : priorité basse (vlan.js : par pas de 4096).
    if (core.dev.p && core.dev.p.stp && core.dev.p.stp.prio > 4096) core.dev.p.stp = { ...core.dev.p.stp, on: true, prio: 4096 };
    return core.dev;
  };
  const fpanels = new Map(); // local → panneau optique
  // Réglages des ports (vlan.js) : accès DATA (WIFI pour un point d'accès), liaisons montantes en trunk ; module optique
  // de chaque cage montante (fibre.js : 10GBASE-SR sur multimode, 10GBASE-LR sur monomode entre bâtiments).
  const vl = opts.vlans !== false, DATA = BASE_VLANS[0].id, VOICE = BASE_VLANS[1].id, WIFI = BASE_VLANS[2].id;
  // Téléphones : VLAN voix du port d'accès (champ voice de vlan.js, à la manière de Cisco : le téléphone derrière le port
  // le rejoint, le poste reste dans le VLAN de données) sur les postes de travail qui prévoient un téléphone. Si vlan.js
  // n'a pas ce champ (anciennes versions, modèle simplifié) : le second port de la prise double du poste est mis en accès dans
  // le VLAN VOICE.
  const hasVoice = !!(VLAN.PORT_DEFAULT && 'voice' in VLAN.PORT_DEFAULT);
  const accessCfg = s => {
    if (s.ap) return { mode: 'access', vlan: WIFI, edge: true };
    if (s.phone && hasVoice) return { mode: 'access', vlan: DATA, voice: VOICE, edge: true };
    if (s.phone && s.j === 1) return { mode: 'access', vlan: VOICE, edge: true };
    return { mode: 'access', vlan: DATA, edge: true };
  };
  const portCfg = (d, port, cfg) => { if (d.p && d.p.ports && typeof d.p.ports === 'object') d.p.ports[port] = { ...(VLAN.PORT_DEFAULT || {}), ...(d.p.ports[port] || {}), ...cfg }; };
  const trunk = (d, port, fibre) => {
    if (vl) portCfg(d, port, { mode: 'trunk', allowed: 'all' });
    const cageP = portsOfType(d.type).find(p => p.id === port && p.sfp);
    if (cageP && d.p && d.p.sfp && typeof d.p.sfp === 'object') d.p.sfp[port] = fibre === 'os2' ? '10GBASE-LR' : '10GBASE-SR';
  };
  const addFp = (sp, at) => { const d = addDev(T.fpanel, pre(T.fpanel) + '-' + sp.label, at, { rack: mount(sp, T.fpanel) }); if (T.mgr) addDev(T.mgr, pre(T.mgr) + '-' + pre(T.fpanel) + '-' + sp.label, at, { rack: mount(sp, T.mgr) }); return { dev: d, next: 1 }; };
  /** Panneau optique du local principal : un déjà monté qui a des traversées libres, sinon un nouveau. */
  const mainFp = () => {
    if (!T.fpanel || !mainSp) return null;
    if (!fpanels.has(mainSp.key)) {
      const nf = panelFront(T.fpanel).length || 12;
      const old = data.devices.find(d => d.type === T.fpanel && d.rack && mainSp.rackObjs.some(r => r.id === d.rack.id) && freeFp(d, nf) <= nf);
      fpanels.set(mainSp.key, old ? { dev: old, next: freeFp(old, nf) } : addFp(mainSp, { x: x0 + 200, y: y0 + 90 }));
    }
    return fpanels.get(mainSp.key);
  };
  const freeFp = (d, nf) => { let i = 1; while (i <= nf && (usedPorts.has(d.id + '|f' + i) || usedPorts.has(d.id + '|b' + i))) i++; return i; };
  const corePort = () => { const cd = coreDev(); while (cd && core.next <= core.ports.length) { const p = core.ports[core.next++ - 1]; if (!usedPorts.has(cd.id + '|' + p)) return p; } return null; };
  for (const sp of spaces) {
    const rs = dim.rooms.filter(r => r.tr === sp.key && r.outlets > 0 && (!only || only.has(r.id)));
    const todo = rs.filter(r => { if (r.placed > 0) { skipped.push(r.id); return false; } return true; });
    if (!todo.length) continue;
    const outlets = todo.reduce((a, r) => a + r.outlets, 0), ports = Math.ceil(outlets * (1 + D.spare / 100));
    const backs = panelBack(T.panel), fronts = panelFront(T.panel), pp = backs.length;
    const nPanels = Math.ceil(ports / pp), sws = chooseSwitches(ports, D, T);
    const y1 = y0 + 200, colW = Math.max(460, Math.min(12, outlets) * 56);
    // Panneaux et switchs, en alternance (panneaux, passe-câbles, switch) pour des cordons courts.
    const panels = [], switches = [];
    const addPanel = () => { const L = letters(panels.length); panels.push(addDev(T.panel, pre(T.panel) + '-' + sp.label + '-' + L, { x: colX + 200 + (panels.length % 2) * 210, y: y1 + 200 + Math.floor(panels.length / 2) * 60 }, { rack: mount(sp, T.panel) })); };
    const addMgr = () => { if (T.mgr) addDev(T.mgr, pre(T.mgr) + '-' + sp.label + '-' + (panels.length + switches.length), { x: colX, y: y1 }, { rack: mount(sp, T.mgr) }); };
    // Un passe-câbles contre chaque panneau : panneau, passe-câbles, panneau, puis le switch qu'ils servent.
    const group = n => { for (let j = 0; j < n && panels.length < nPanels; j++) { addPanel(); if (j === 0) addMgr(); } };
    for (const s of sws) for (let k = 0; k < s.n; k++) {
      group(Math.max(1, Math.round(s.ports / pp)));
      switches.push(addDev(s.type, pre(s.type) + '-' + sp.label + '-' + (switches.length + 1), { x: colX + (switches.length % 2) * 210, y: y1 + Math.floor(switches.length / 2) * 60 }, { rack: mount(sp, s.type) }));
    }
    while (panels.length < nPanels) group(2);
    created.panels += panels.length; created.switches += switches.length;
    // Prises : doubles le long des murs ; points d'accès et caméras : prise simple au plafond.
    const slots = []; let k = 0;
    for (const r of todo) {
      const rf = fl.get(r.floor), room = rf ? (rf.f.rooms || []).find(z => z.id === r.id) : null, h = rf ? +rf.f.height || 3 : 3;
      const ceiling = r.aps + r.cams, wall = Math.max(0, r.outlets - ceiling), per = (T.outlet === 'outlet2' ? 2 : 1), plates = Math.ceil(wall / per);
      const pts = room ? alongWalls(room.poly, plates, 0.3) : [];
      for (let i = 0; i < plates; i++) {
        const o = addDev(T.outlet, pre(T.outlet) + '-' + short(r.name || r.id, 14) + '-' + (i + 1), { x: colX + (k % 12) * 56, y: y1 + 260 + Math.ceil(nPanels / 2) * 60 + Math.floor(k / 12) * 70 }, pts[i] ? { loc: { floor: r.floor, x: pts[i][0], y: pts[i][1], h: 0.3 } } : {});
        k++; created.outlets++;
        const bk = portsOfType(T.outlet).filter(p => p.punch);
        for (let j = 0; j < Math.min(per, wall - i * per); j++) slots.push({ dev: o, port: bk[j].id, room: r, phone: i < r.phones, j });
      }
      const c = room ? roomCenterOf(room) : null;
      for (let i = 0; i < ceiling; i++) {
        // Point d'accès déjà posé (plan Wi-Fi) : sa prise au plafond à côté de lui, et le cordon qui le relie.
        const ap = i < r.aps && r.apIds[i] ? data.devices.find(d => d.id === r.apIds[i]) : null;
        const at = ap && ap.loc ? { floor: ap.loc.floor, x: +(ap.loc.x + 0.3).toFixed(2), y: +ap.loc.y.toFixed(2), h: +Math.max(2.2, h - 0.3).toFixed(2) } : c ? { floor: r.floor, x: +(c[0] + (i % 2 ? 0.8 : -0.8) * Math.ceil(i / 2)).toFixed(2), y: +c[1].toFixed(2), h: +Math.max(2.2, h - 0.3).toFixed(2) } : null;
        const t1 = T.single || T.outlet, o = addDev(t1, pre(t1) + (i < r.aps ? '-AP-' : '-CAM-') + short(r.name || r.id, 12), { x: colX + (k % 12) * 56, y: y1 + 260 + Math.ceil(nPanels / 2) * 60 + Math.floor(k / 12) * 70 }, at ? { loc: at } : {});
        k++; created.outlets++;
        if (ap) { const pd = portsOfType(ap.type).find(p => !p.passive), fr = portsOfType(t1).find(p => p.passive && !p.punch); if (pd && fr) { addCable([ap.id, pd.id], [o.id, fr.id], { len: 1 }); ap.x = o.x; ap.y = o.y + 70; } }
        slots.push({ dev: o, port: portsOfType(t1).find(p => p.punch).id, room: r, ap: i < r.aps });
      }
    }
    // Liens permanents (dans l'ordre des pièces) et cordons vers les switchs.
    const swPorts = switches.map(s => ({ dev: s, acc: switchPorts(s.type).acc.map(p => p.id), next: 0 }));
    let si = 0;
    slots.forEach((s, i) => {
      const P = panels[Math.floor(i / pp)]; if (!P) return;
      const n = i % pp, len = s.room.run || 30;
      addCable([s.dev.id, s.port], [P.id, backs[n].id], { len, route: { mode: 'auto' } });
      while (si < swPorts.length && swPorts[si].next >= swPorts[si].acc.length) si++;
      const S = swPorts[si]; if (!S) return;
      const sport = S.acc[S.next++];
      if (addCable([P.id, fronts[n].id], [S.dev.id, sport], { len: D.cord }) && vl) portCfg(S.dev, sport, accessCfg(s));
    });
    // Liaisons montantes.
    for (const s of switches) {
      const ups = switchPorts(s.type).up.map(p => p.id).slice(0, D.uplinks);
      for (const up of ups) {
        if (!coreDev()) break;
        const cp = corePort(); if (!cp) { notes.push('core-full'); break; }
        trunk(s, up, 'om4'); trunk(core.dev, cp, 'om4');
        if (sp.key === (mainSp && mainSp.key) || !T.fpanel) { addCable([s.id, up], [core.dev.id, cp], { len: sp.key === (mainSp && mainSp.key) ? 2 : Math.max(10, distSpaces(sp, mainSp, fl)), media: { media: 'fibre', fibre: 'om4' } }); continue; }
        if (!fpanels.has(sp.key)) fpanels.set(sp.key, addFp(sp, { x: colX + colW - 160, y: y1 - 60 }));
        const A = fpanels.get(sp.key), M = mainFp(); if (!M) break;
        const fa = A.next++, fm = M.next++, nf = panelFront(T.fpanel).length || 12; if (fa > nf || fm > nf) { notes.push('fibre-full'); break; }
        const other = sp.building !== (mainSp && mainSp.building), fib = { media: 'fibre', fibre: other ? 'os2' : 'om4' };
        if (other) { trunk(s, up, 'os2'); trunk(core.dev, cp, 'os2'); }
        addCable([s.id, up], [A.dev.id, 'f' + fa], { len: 2, media: fib });
        addCable([A.dev.id, 'b' + fa], [M.dev.id, 'b' + fm], { len: Math.max(10, distSpaces(sp, mainSp, fl)), media: fib, route: { mode: 'auto' } });
        addCable([M.dev.id, 'f' + fm], [core.dev.id, cp], { len: 2, media: fib });
      }
    }
    colX += colW + COL_GAP;
  }
  // Finitions de chaque baie équipée : PDU verticale, onduleur en bas (rack.js : le plus petit qui tient la charge des
  // switchs et le PoE prévu, avec la marge), obturateurs sur les U libres en façade (bonne pratique de refroidissement).
  for (const [rid, sp] of touched) {
    const rk = data.racks.find(r => r.id === rid), devs = data.devices.filter(d => d.rack && d.rack.id === rid), lbl = rk.name;
    if (T.pdu && !devs.some(d => /^pdu/.test(d.type))) addDev(T.pdu, pre(T.pdu) + '-' + lbl, { x: 0, y: 0 }, { rack: { id: rid, u: 1, face: 'rear' } });
    if (T.ups.length && !devs.some(d => RACK.MOUNT[d.type] && RACK.MOUNT[d.type].ups)) {
      const share = sp.rackObjs.length || 1, load = devs.reduce((a, d) => a + mountOf(d.type).w, 0) + (sp.poe ? sp.poe.need / share : 0);
      const t = pickUps(T, load * (1 + D.upsMargin / 100)), at = t && mountLow(rk, t);
      if (at) addDev(t, pre(t) + '-' + lbl, { x: 0, y: 0 }, { rack: at });
    }
    if (opts.blanks !== false && T.blank) { const o = occ(rk); for (let u = 1; u <= (+rk.u || D.rackU); u++) if (!o.has(u)) { o.set(u, { type: 'blank' }); addDev(T.blank, pre(T.blank) + '-' + lbl + '-' + u, { x: 0, y: 0 }, { rack: { id: rid, u, face: 'front' } }); } }
  }
  // VLAN de base (base des VLAN de vlan.js) : seulement ceux qui manquent.
  if (opts.vlans !== false) {
    const have = new Set(data.vlans.map(v => +v.id));
    for (const v of BASE_VLANS) if (!have.has(v.id)) { data.vlans.push({ id: v.id, name: v.name, net: '', gw: '' }); created.vlans++; }
  }
  if (created.devices && ROUTE.applyRoutes) { try { ROUTE.applyRoutes(data); } catch (e) { notes.push('routes'); } }
  const l3 = vl ? applyL3(data) : null;
  return { created, removed, skipped, notes, l3 };
}
/**
 * Niveau 3 du cœur d'après le plan d'adressage (data.vlans net, gw) : une SVI par VLAN adressé sur le switch de niveau 3 de
 * cœur (ip = passerelle, préfixe du réseau), routage activé. DHCP : relais (helper) vers le serveur DHCP du projet s'il y
 * en a un (serveur à adresse fixe qui sert le DHCP), à qui il manque alors les étendues des VLAN ; sinon des étendues sur
 * le cœur lui-même. Le VLAN de gestion (99, MGMT) n'a pas d'étendue : adresses fixes. Idempotent : une SVI existante est
 * mise à jour (ses listes d'accès gardées), une étendue existante pour le même réseau est gardée.
 * Rend { core, svis, scopes, helper } ou null (pas de cœur, ou aucun VLAN adressé).
 */
export function applyL3(data) {
  const cores = (data.devices || []).filter(d => d.type === 'l3switch' && d.p);
  const nets = (data.vlans || []).map(v => ({ v, n: parseNet(v.net) })).filter(x => x.n && x.v.gw);
  if (!cores.length || !nets.length) return null;
  const core = cores.find(d => /^CORE/i.test(d.name)) || cores[0], P = core.p;
  P.routing = true; if (!Array.isArray(P.svis)) P.svis = [];
  const srv = (data.devices || []).find(d => d.type === 'server' && d.p && d.p.ip && d.p.ip.mode === 'static' && d.p.ip.ip && Array.isArray(d.p.dhcp));
  const helper = srv ? srv.p.ip.ip : '', host = srv ? srv.p : P;
  if (!Array.isArray(host.dhcp)) host.dhcp = [];
  let svis = 0, scopes = 0;
  for (const { v, n } of nets) {
    const i = P.svis.findIndex(x => +x.vlan === +v.id), old = i >= 0 ? P.svis[i] : {};
    const svi = { aclIn: '', aclOut: '', ...old, vlan: +v.id, ip: v.gw, prefix: n.prefix, helper: helper || '' };
    if (i >= 0) P.svis[i] = svi; else { P.svis.push(svi); svis++; }
    if (+v.id === 99 || /mgmt|gestion/i.test(v.name || '')) continue;
    if (host.dhcp.some(x => x.net === v.net)) continue;
    const r = scopeRange(n, v.gw); if (!r) continue;
    host.dhcp.push({ net: v.net, from: r[0], to: r[1], gw: v.gw, dns: srv && srv.p.dns && srv.p.dns.on ? helper : '', on: true }); scopes++;
  }
  P.svis.sort((a, b) => a.vlan - b.vlan);
  return { core: core.id, svis, scopes, helper, on: srv ? srv.id : core.id };
}
const ipn = s => { const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(s || '').trim()); return m ? ((+m[1] << 24) >>> 0) + (+m[2] << 16) + (+m[3] << 8) + +m[4] : null; };
const ips = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const parseNet = s => { const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(String(s || '').trim()); if (!m || +m[2] > 30) return null; const a = ipn(m[1]); return a == null ? null : { net: a, prefix: +m[2], size: 2 ** (32 - +m[2]) }; };
/** Plage d'une étendue DHCP : après les dix premières adresses (passerelle, équipements à adresse fixe) quand le réseau
 *  est assez grand, sans la passerelle. Valeur de conception, modifiable ensuite dans l'inspecteur. */
function scopeRange(n, gw) {
  const first = n.net + 1, last = n.net + n.size - 2, g = ipn(gw);
  let from = n.size >= 64 ? n.net + 11 : first, to = last;
  if (g === to) to--; if (g === from) from++;
  return from <= to ? [ips(from >>> 0), ips(to >>> 0)] : null;
}
/** VLAN de base d'un réseau d'entreprise (noms neutres, identifiants usuels, à changer à volonté). */
export const BASE_VLANS = [{ id: 10, name: 'DATA' }, { id: 20, name: 'VOICE' }, { id: 30, name: 'WIFI' }, { id: 99, name: 'MGMT' }];
/** Distance estimée entre deux locaux (rocade) : écart d'étage + trajet en L, ou entre bâtiments (positions du site). */
function distSpaces(a, b, fl) {
  if (!a || !b) return 30;
  const A = fl.get(a.floor), B = fl.get(b.floor);
  const dz = Math.abs(((A && +A.f.elev) || 0) - ((B && +B.f.elev) || 0));
  if (a.building !== b.building && A && B) return Math.round(Math.abs((+A.b.x || 0) - (+B.b.x || 0)) + Math.abs((+A.b.y || 0) - (+B.b.y || 0)) + dz + 20);
  return Math.round(dz + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + 6);
}
/** Ce que le générateur poserait (sans rien modifier) : mêmes nombres que applyDesign. */
export function previewDesign(data, opts = {}) {
  const copy = JSON.parse(JSON.stringify({ ...data, images: undefined }));
  return applyDesign(copy, opts);
}
