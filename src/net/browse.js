// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Navigateur du projet réseau, partie pure (sans page, testée sous Node) : arbre des objets (site → bâtiment → étage →
// pièce → baie → équipement, groupes Cheminements, Hors plan, Câbles), éléments à chercher (Ctrl+F, aller à), fil
// d'Ariane d'un objet, et modification groupée (champs communs à une sélection, application à tous).
//
// Clés des nœuds : `${kind}:${id}` avec kind = la sélection partagée des vues ('building', 'floor', 'room', 'rack',
// 'dev', 'path', 'cable') ; groupes : 'grp:…' (non sélectionnables comme objets).
// projectTree(data, o) → [nœud] ; o : { label(dev) → nom affiché (étiquette), issues: Map id → 'err'|'warn',
//   cableKind(c) → 'horizontal'|'cord'|'backbone'|'other' }.
import { tl } from '../i18n/index.js';
import { specOf, portsOf } from './devices.js';
import { USAGES, MATERIALS, inRoom, roomArea, bbox, roomPoint, floorOf } from './site.js';
import * as RK from './rack.js';
import { PATH_KINDS } from './route.js';
import { CATS, CAT_IDS } from './cable.js';
import { MANAGED, portCfg } from './vlan.js';

const f1 = (v, en) => { const t = String(Math.round(v * 10) / 10); return en ? t : t.replace('.', ','); };
export const keyOf = (kind, id) => kind + ':' + id;
export function parseKey(k) { const i = String(k).indexOf(':'); return i < 0 ? null : { kind: k.slice(0, i), id: k.slice(i + 1) }; }
export const isGroupKey = k => String(k).startsWith('grp:') || k === 'site';
const COLL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byName = (a, b) => COLL.compare(String(a.label), String(b.label));

/** Pièce d'un point d'étage, avec un index des emprises par étage (des milliers d'équipements). */
function roomIndex(f) {
  const list = (f.rooms || []).map(r => ({ r, b: bbox(r.poly), a: roomArea(r) }));
  return (x, y) => { let best = null, ba = Infinity; for (const e of list) { if (x < e.b[0] || x > e.b[2] || y < e.b[1] || y > e.b[3]) continue; if (e.a < ba && inRoom([x, y], e.r)) { best = e.r; ba = e.a; } } return best; };
}
const CABLE_KIND = { horizontal: () => tl('Liens permanents'), cord: () => tl('Cordons'), backbone: () => tl('Rocades'), other: () => tl('Autres câbles') };

/**
 * Adresses IP écrites dans les réglages d'un équipement (cherchables : Ctrl+F, Ctrl+G) : poste, box (LAN, WAN), interfaces
 * et sous-interfaces d'un routeur, SVI d'un switch de niveau 3, serveur ; les adresses reçues par DHCP viennent de o.ipOf.
 */
export function ipsOf(d) {
  const P = (d && d.p) || {}, out = [];
  const add = x => { if (x && typeof x === 'object' && x.ip) out.push(x.prefix != null ? `${x.ip}/${x.prefix}` : x.ip); else if (typeof x === 'string' && /\d+\.\d+/.test(x)) out.push(x); };
  add(P.ip); add(P.lan); add(P.wan);
  for (const k of ['ifs', 'svis']) if (Array.isArray(P[k])) P[k].forEach(add);
  return out;
}
/** Nom d'un type (lu une fois par construction de l'arbre). */
let TN = new Map();
const typeName = (type, s) => { let n = TN.get(type); if (n == null) { n = s ? s.name() : type; TN.set(type, n); } return n; };
/** Nœud d'un équipement. */
function devNode(d, o) {
  const s = specOf(d), lab = o.label ? o.label(d) : '', P = d.p || {};
  const tn = typeName(d.type, s), name = d.name || lab || d.id;
  // Libellé : le nom ; à côté, l'étiquette (identifiant du plan de câblage) quand elle diffère, la place en baie, le type.
  const sub = `${lab && lab !== name ? lab + ' · ' : ''}${d.rack ? `U${d.rack.u}${d.rack.face === 'rear' ? ' ' + tl('face arrière') : ''} · ` : ''}${tn}`;
  const lv = o.issues && o.issues.get(d.id);
  return { key: keyOf('dev', d.id), kind: 'dev', id: d.id, label: name, sub, icon: s ? s.icon : 'box', terms: `${d.name || ''} ${d.tag || ''} ${d.type} ${d.id} ${ipsOf(d).join(' ')} ${o.ipOf ? o.ipOf(d.id) || '' : ''}`, dot: lv || null };
}

export function projectTree(data, o = {}) {
  TN = new Map();
  const en = !!o.en, issues = o.issues || new Map(), devs = data.devices || [];
  const dot = id => issues.get(id) || null;
  // Équipements rangés : par baie ; posés sur un plan : par étage.
  const inRack = new Map(), onFloor = new Map(), loose = [];
  const racks = new Map((data.racks || []).map(r => [r.id, r]));
  for (const d of devs) {
    if (d.rack && racks.has(d.rack.id)) { if (!inRack.has(d.rack.id)) inRack.set(d.rack.id, []); inRack.get(d.rack.id).push(d); }
    else if (d.loc && d.loc.floor) { if (!onFloor.has(d.loc.floor)) onFloor.set(d.loc.floor, []); onFloor.get(d.loc.floor).push(d); }
    else loose.push(d);
  }
  const rackNode = r => {
    const list = (inRack.get(r.id) || []).slice().sort((a, b) => (b.rack.u || 0) - (a.rack.u || 0) || String(a.name).localeCompare(String(b.name)));
    return { key: keyOf('rack', r.id), kind: 'rack', id: r.id, label: r.name, sub: `${r.u} U${r.kind === 'wall' ? ' · ' + tl('coffret mural') : ''}`, icon: 'rack', badge: list.length || '', dot: dot(r.id), terms: r.id, children: list.map(d => devNode(d, o)) };
  };
  const placed = new Set();
  const roots = [];
  const site = data.site || { buildings: [] }, bs = site.buildings || [];
  const nFloors = bs.reduce((s, b) => s + (b.floors || []).length, 0);
  const siteKids = [];
  for (const b of bs) {
    const fl = [];
    for (const f of (b.floors || []).slice().sort((x, y) => y.level - x.level)) {
      const at = roomIndex(f), rooms = new Map((f.rooms || []).map(r => [r.id, { r, kids: [] }])), direct = [];
      for (const r of data.racks || []) {
        if (r.floor !== f.id) continue; placed.add(r.id);
        const room = (r.room && rooms.get(r.room)) || (() => { const x = at(r.x, r.y); return x ? rooms.get(x.id) : null; })();
        (room ? room.kids : direct).push(rackNode(r));
      }
      for (const d of onFloor.get(f.id) || []) {
        const x = at(d.loc.x, d.loc.y), n = devNode(d, o);
        (x ? rooms.get(x.id).kids : direct).push(n);
      }
      const roomNodes = [...rooms.values()].map(({ r, kids }) => {
        kids.sort((a, c) => (a.kind === c.kind ? byName(a, c) : a.kind === 'rack' ? -1 : 1));
        const u = USAGES[r.usage];
        return { key: keyOf('room', r.id), kind: 'room', id: r.id, label: r.name || (u ? u.name() : tl('Pièce sans nom')), sub: `${u && r.name ? u.name() + ' · ' : ''}${f1(roomArea(r), en)} m²`, icon: 'room', badge: kids.length || '', dot: dot(r.id), terms: `${r.id} ${u ? u.name() : ''}`, children: kids };
      }).sort(byName);
      direct.sort((a, c) => (a.kind === c.kind ? byName(a, c) : a.kind === 'rack' ? -1 : 1));
      const paths = (data.paths || []).filter(p => p.floor === f.id).map(p => ({ key: keyOf('path', p.id), kind: 'path', id: p.id, label: p.name || (PATH_KINDS[p.kind] ? PATH_KINDS[p.kind].name() : p.kind), sub: PATH_KINDS[p.kind] && p.name ? PATH_KINDS[p.kind].name() : '', icon: 'cableTray', dot: dot(p.id), terms: p.id })).sort(byName);
      const kids = [...roomNodes, ...direct];
      if (paths.length) kids.push({ key: 'grp:paths:' + f.id, kind: 'grp', label: tl('Cheminements'), icon: 'cableTray', badge: paths.length, children: paths });
      fl.push({ key: keyOf('floor', f.id), kind: 'floor', id: f.id, label: f.name, sub: tl('niveau {0}', f.level), icon: 'floorPlan', dot: dot(f.id), open: nFloors <= 2, terms: f.id, children: kids });
    }
    siteKids.push({ key: keyOf('building', b.id), kind: 'building', id: b.id, label: b.name, sub: tl('{0} étage(s)', (b.floors || []).length), icon: 'building', dot: dot(b.id), open: bs.length <= 3, terms: b.id, children: fl });
  }
  if (siteKids.length) roots.push({ key: 'site', kind: 'grp', label: site.name || tl('Site'), icon: 'globe', open: true, children: siteKids });
  // Baies sans étage (vue Baies seulement) et équipements hors plan.
  const freeRacks = (data.racks || []).filter(r => !placed.has(r.id)).map(rackNode).sort(byName);
  const looseNodes = loose.map(d => devNode(d, o));
  // Hors plan : routeurs, switchs, points d'accès, postes, passifs, puis le reste.
  const RANK = { router: 0, switch: 1, ap: 2, host: 3, passive: 4, mech: 5 }, rank = new Map(loose.map(d => { const s = specOf(d); return [d.id, (s && RANK[s.role]) ?? 6]; }));
  looseNodes.sort((a, c) => rank.get(a.id) - rank.get(c.id) || byName(a, c));
  if (freeRacks.length || looseNodes.length) roots.push({ key: 'grp:loose', kind: 'grp', label: siteKids.length ? tl('Hors plan') : tl('Équipements'), sub: siteKids.length ? tl('ni sur un plan ni dans une baie') : '', icon: 'network', open: !siteKids.length, badge: freeRacks.length + looseNodes.length, children: [...freeRacks, ...looseNodes] });
  // Câbles par genre.
  const cables = data.cables || [];
  if (cables.length) {
    const groups = new Map(Object.keys(CABLE_KIND).map(k => [k, []]));
    const nm = new Map(devs.map(d => [d.id, o.label ? o.label(d) : d.name]));
    for (const c of cables) {
      const k = (o.cableKind && o.cableKind(c)) || 'other';
      const lab = (o.cableLabel && o.cableLabel(c)) || c.tag || c.id;
      const sub = `${nm.get(c.a[0]) || c.a[0]} ↔ ${nm.get(c.b[0]) || c.b[0]} · ${f1(+c.len || 0, en)} m`;
      (groups.get(k) || groups.get('other')).push({ key: keyOf('cable', c.id), kind: 'cable', id: c.id, label: lab, sub, icon: c.media === 'fibre' ? 'fibre' : 'cable', dot: dot(c.id), terms: `${c.id} ${c.tag || ''} ${c.cat || ''} ${c.media || ''}` });
    }
    const kids = [...groups].filter(([, l]) => l.length).map(([k, l]) => ({ key: 'grp:cables:' + k, kind: 'grp', label: CABLE_KIND[k](), icon: 'cable', badge: l.length, children: l.sort(byName) }));
    roots.push({ key: 'grp:cables', kind: 'grp', label: tl('Câbles'), icon: 'cable', badge: cables.length, children: kids });
  }
  return roots;
}

/** Objets à chercher (Ctrl+F, aller à) : tous les nœuds qui ne sont pas des groupes, avec leur chemin. */
export function findItems(roots, vlans = []) {
  const out = [];
  const walk = (list, path) => {
    for (const n of list || []) {
      if (n.kind !== 'grp' && n.id != null) out.push({ key: n.key, kind: n.kind, id: n.id, label: n.label, sub: n.sub || '', icon: n.icon, terms: n.terms || '', where: path.join(' › ') });
      // Chemin : sans le site (un seul) ni le bâtiment quand il est seul.
      const skip = n.kind === 'grp' || (n.kind === 'building' && single);
      if (n.children && n.children.length) walk(n.children, skip ? path : [...path, n.label]);
    }
  };
  const site = (roots || []).find(r => r.key === 'site'), single = !!site && site.children.length === 1;
  walk(roots, []);
  for (const v of vlans || []) out.push({ key: 'vlan:' + v.id, kind: 'vlan', id: String(v.id), label: `VLAN ${v.id}${v.name ? ' · ' + v.name : ''}`, sub: [v.net, v.gw ? tl('passerelle {0}', v.gw) : ''].filter(Boolean).join(' · '), icon: 'vlanTag', terms: `vlan ${v.id} ${v.net || ''} ${v.gw || ''}`, where: tl('Base des VLAN') });
  return out;
}
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/œ/g, 'oe');
/**
 * Recherche classée : libellé exact, puis début du libellé, puis mot du libellé, puis ailleurs (sous-titre, nom, type,
 * adresse IP). Rend au plus max éléments { …item, score }.
 */
export function findRank(items, q, max = 200) {
  const words = fold(q).trim().split(/\s+/).filter(Boolean); if (!words.length) return [];
  const out = [];
  for (const it of items) {
    const lab = fold(it.label), all = `${lab} ${fold(it.sub)} ${fold(it.terms)}`; // pas le chemin : « salle » ne prend pas tout ce qu'une salle contient
    let s = 0;
    for (const w of words) {
      if (lab === w) s += 100; else if (lab.startsWith(w)) s += 50; else if (lab.includes(w)) s += 25; else if (all.includes(w)) s += 8; else { s = 0; break; }
    }
    if (s) out.push({ ...it, score: s - Math.min(10, lab.length / 10) });
  }
  out.sort((a, b) => b.score - a.score || COLL.compare(String(a.label), String(b.label)));
  return out.slice(0, max);
}

/** Chemin d'un objet dans l'arbre : [{ key, kind, id, label, icon }] de la racine à l'objet (groupes compris). */
export function pathTo(roots, key) {
  const stack = [];
  const walk = list => { for (const n of list || []) { stack.push(n); if (n.key === key) return true; if (n.children && walk(n.children)) return true; stack.pop(); } return false; };
  return walk(roots) ? stack.map(n => ({ key: n.key, kind: n.kind, id: n.id, label: n.label, icon: n.icon })) : [];
}

/**
 * Fil d'Ariane d'un objet sans construire tout l'arbre (appelé à chaque sélection) : mêmes éléments que pathTo.
 * Site › bâtiment › étage › pièce › baie › équipement ; câble : Câbles › câble ; hors plan : Hors plan › équipement.
 */
export function crumbsFor(data, sel, o = {}) {
  if (!sel) return [];
  const site = data.site || { buildings: [] }, out = [], push = (kind, id, label, icon) => out.push({ key: kind === 'grp' ? id : keyOf(kind, id), kind, id: kind === 'grp' ? undefined : id, label, icon });
  const siteNode = () => push('grp', 'site', site.name || tl('Site'), 'globe');
  const floorChain = fid => { for (const b of site.buildings || []) for (const f of b.floors || []) if (f.id === fid) { siteNode(); push('building', b.id, b.name, 'building'); push('floor', f.id, f.name, 'floorPlan'); return f; } return null; };
  const roomOf = (f, x, y) => roomIndex(f)(x, y);
  const roomNode = r => { const u = USAGES[r.usage]; push('room', r.id, r.name || (u ? u.name() : tl('Pièce sans nom')), 'room'); };
  const rackChain = r => { const f = r.floor ? floorChain(r.floor) : null; if (f) { const rm = (r.room && f.rooms.find(x => x.id === r.room)) || roomOf(f, r.x, r.y); if (rm) roomNode(rm); } else push('grp', 'grp:loose', tl('Hors plan'), 'network'); push('rack', r.id, r.name, 'rack'); };
  const k = sel.kind, id = sel.id;
  if (k === 'building') { const b = (site.buildings || []).find(x => x.id === id); if (b) { siteNode(); push('building', b.id, b.name, 'building'); } }
  else if (k === 'floor') floorChain(id);
  else if (k === 'room' || k === 'wall' || k === 'door') { const hit = (() => { for (const b of site.buildings || []) for (const f of b.floors || []) { const L = k === 'room' ? f.rooms : k === 'wall' ? f.walls : f.doors; const x = L.find(z => z.id === id); if (x) return { f, x }; } return null; })(); if (hit) { floorChain(hit.f.id); if (k === 'room') roomNode(hit.x); else push(k, id, hit.x.name || (k === 'wall' ? tl('Mur') : tl('Porte')), k); } }
  else if (k === 'path') { const p = (data.paths || []).find(x => x.id === id); if (p) { floorChain(p.floor); push('grp', 'grp:paths:' + p.floor, tl('Cheminements'), 'cableTray'); push('path', p.id, p.name || (PATH_KINDS[p.kind] ? PATH_KINDS[p.kind].name() : p.kind), 'cableTray'); } }
  else if (k === 'rack') { const r = (data.racks || []).find(x => x.id === id); if (r) rackChain(r); }
  else if (k === 'dev') {
    const d = (data.devices || []).find(x => x.id === id); if (!d) return [];
    const r = d.rack && (data.racks || []).find(x => x.id === d.rack.id);
    if (r) rackChain(r);
    else if (d.loc && d.loc.floor) { const f = floorChain(d.loc.floor); if (f) { const rm = roomOf(f, d.loc.x, d.loc.y); if (rm) roomNode(rm); } }
    else push('grp', 'grp:loose', (site.buildings || []).length ? tl('Hors plan') : tl('Équipements'), 'network');
    const s = specOf(d); push('dev', d.id, d.name || (o.label && o.label(d)) || d.id, s ? s.icon : 'box');
  } else if (k === 'cable') { const c = (data.cables || []).find(x => x.id === id); if (c) { push('grp', 'grp:cables', tl('Câbles'), 'cable'); push('cable', c.id, (o.cableLabel && o.cableLabel(c)) || c.tag || c.id, c.media === 'fibre' ? 'fibre' : 'cable'); } }
  return out;
}

/* ---------- Modification groupée ---------- */
/** Objets du modèle pour une sélection [{ kind, id }] : [{ kind, id, o }] (les absents sont ignorés). */
export function resolveSel(data, list) {
  const devs = new Map((data.devices || []).map(d => [d.id, d])), cables = new Map((data.cables || []).map(c => [c.id, c]));
  const paths = new Map((data.paths || []).map(p => [p.id, p])), racks = new Map((data.racks || []).map(r => [r.id, r]));
  const site = new Map();
  for (const b of (data.site && data.site.buildings) || []) { site.set(b.id, b); for (const f of b.floors || []) { site.set(f.id, f); for (const k of ['rooms', 'walls', 'doors']) for (const x of f[k] || []) site.set(x.id, x); } }
  const out = [];
  for (const s of list || []) {
    const o = s.kind === 'dev' ? devs.get(s.id) : s.kind === 'cable' ? cables.get(s.id) : s.kind === 'path' ? paths.get(s.id) : s.kind === 'rack' ? racks.get(s.id) : site.get(s.id);
    if (o) out.push({ kind: s.kind, id: s.id, o });
  }
  return out;
}
/** Port de switch administrable au bout du câblage d'un équipement terminal (à travers prises et panneaux), ou null. */
export function accessPortOf(data, devId) {
  const byId = new Map((data.devices || []).map(d => [d.id, d])), at = new Map();
  for (const c of data.cables || []) { at.set(c.a[0] + '|' + c.a[1], c); at.set(c.b[0] + '|' + c.b[1], c); }
  const d = byId.get(devId); if (!d || MANAGED.has(d.type)) return null;
  const s = specOf(d); if (!s || s.role === 'passive' || s.role === 'mech') return null;
  for (const p of portsOf(d)) {
    let cur = [d.id, p.id];
    for (let guard = 0; guard < 12; guard++) {
      const c = at.get(cur[0] + '|' + cur[1]); if (!c) break;
      const other = c.a[0] === cur[0] && c.a[1] === cur[1] ? c.b : c.a, od = byId.get(other[0]); if (!od) break;
      if (MANAGED.has(od.type)) return { sw: od, port: other[1] };
      const op = portsOf(od).find(x => x.id === other[1]);
      if (!op || !op.passive) break;
      cur = [od.id, op.passive];
    }
  }
  return null;
}
const SEL_NAME = { dev: () => tl('Équipements'), cable: () => tl('Câbles'), room: () => tl('Pièces du plan'), wall: () => tl('Murs'), path: () => tl('Cheminements'), rack: () => tl('Baies'), door: () => tl('Portes'), floor: () => tl('Étages'), building: () => tl('Bâtiments') };
export const kindTitle = k => (SEL_NAME[k] ? SEL_NAME[k]() : k);
/**
 * Champs modifiables ensemble pour une sélection (objets de resolveSel) : propriétés de la grille (kit/propgrid.js),
 * chacun avec set(item, valeur, data) qui écrit le modèle. Un champ ne s'affiche que s'il s'applique à un des objets.
 * La valeur lue est celle de chaque objet (valeurs mêlées : « Valeurs multiples »).
 */
export function bulkFields(data, items) {
  const kinds = new Set(items.map(x => x.kind)), out = [], g = k => (kinds.size > 1 ? `${kindTitle(k)} (${items.filter(x => x.kind === k).length})` : kindTitle(k));
  const F = (kind, f) => out.push({ group: g(kind), ...f, key: kind + ':' + f.key, applies: it => it.kind === kind && (!f.when || f.when(it.o)), get: it => f.read(it.o, it), set: (it, v) => f.write(it.o, v, it) });
  if (kinds.has('dev')) {
    const sw = new Map(); // port d'accès de chaque équipement terminal (lu une fois)
    const acc = it => { if (!sw.has(it.id)) sw.set(it.id, accessPortOf(data, it.id)); return sw.get(it.id); };
    F('dev', { key: 'loc.h', label: tl('Hauteur de pose'), type: 'number', unit: 'm', min: 0, max: 30, digits: 2, when: d => !!d.loc, read: d => d.loc.h, write: (d, v) => { if (d.loc && v != null) d.loc.h = v; } });
    F('dev', { key: 'vlan', label: tl('VLAN d’accès'), type: 'number', int: true, min: 1, max: 4094, hint: tl('VLAN d’accès (port du switch)') + ' : ' + tl('Écrit sur le port du switch administrable qui dessert l’équipement (mode accès).'),
      when: d => !!acc({ id: d.id }), read: (d, it) => { const a = acc(it); return a ? portCfg(a.sw, a.port).vlan : null; },
      write: (d, v, it) => { const a = acc(it); if (!a || v == null) return; const p = a.sw.p || (a.sw.p = {}); const ports = p.ports || (p.ports = {}); ports[a.port] = { ...(ports[a.port] || {}), mode: 'access', vlan: v }; } });
    if (items.filter(x => x.kind === 'dev').length === 1) F('dev', { key: 'tag', label: tl('Étiquette imposée'), type: 'text', maxlength: 32, read: d => d.tag || '', write: (d, v) => { if (v) d.tag = v; else delete d.tag; } });
  }
  if (kinds.has('cable')) {
    F('cable', { key: 'cat', label: tl('Catégorie'), type: 'select', options: CAT_IDS.map(k => [k, CATS[k].name]), when: c => c.media !== 'fibre', read: c => c.cat, write: (c, v) => { c.cat = v; } });
    F('cable', { key: 'route', label: tl('Longueur'), type: 'select', options: [['auto', tl('suit les cheminements')], ['manual', tl('saisie à la main')]], read: c => (c.route && c.route.mode) || 'manual', write: (c, v) => { c.route = { ...(c.route || {}), mode: v }; } });
    F('cable', { key: 'len', label: tl('Longueur saisie'), type: 'number', unit: 'm', min: 0.1, max: 100000, digits: 1, when: c => !c.route || c.route.mode !== 'auto', read: c => c.len, write: (c, v) => { if (v != null) c.len = v; } });
  }
  if (kinds.has('room')) F('room', { key: 'usage', label: tl('Usage'), type: 'select', options: Object.entries(USAGES).map(([k, u]) => [k, u.name()]), read: r => r.usage, write: (r, v) => { r.usage = v; } });
  if (kinds.has('wall')) {
    F('wall', { key: 'mat', label: tl('Matériau'), type: 'select', options: Object.entries(MATERIALS).map(([k, m]) => [k, m.name()]), read: w => w.mat, write: (w, v) => { w.mat = v; } });
    F('wall', { key: 't', label: tl('Épaisseur'), type: 'number', unit: 'm', min: 0.01, max: 2, digits: 2, read: w => w.t, write: (w, v) => { if (v != null) w.t = v; } });
  }
  if (kinds.has('path')) {
    F('path', { key: 'kind', label: tl('Genre'), type: 'select', options: Object.entries(PATH_KINDS).map(([k, p]) => [k, p.name()]), read: p => p.kind, write: (p, v) => { p.kind = v; } });
    F('path', { key: 'z', label: tl('Hauteur'), type: 'number', unit: 'm', min: -5, max: 30, digits: 2, read: p => p.z, write: (p, v) => { if (v != null) p.z = v; } });
    F('path', { key: 'w', label: tl('Largeur'), type: 'number', unit: 'mm', min: 0, max: 2000, int: true, when: p => p.w != null, read: p => p.w, write: (p, v) => { if (v != null) p.w = v; } });
    F('path', { key: 'h', label: tl('Hauteur de l’aile'), type: 'number', unit: 'mm', min: 0, max: 500, int: true, when: p => p.h != null, read: p => p.h, write: (p, v) => { if (v != null) p.h = v; } });
  }
  if (kinds.has('rack')) {
    F('rack', { key: 'u', label: tl('Hauteur utile'), type: 'number', unit: 'U', min: 1, max: 60, int: true, read: r => r.u, write: (r, v) => { if (v != null) r.u = v; } });
    F('rack', { key: 'w', label: tl('Largeur'), type: 'number', unit: 'mm', min: 300, max: 1200, int: true, read: r => r.w, write: (r, v) => { if (v != null) r.w = v; } });
    F('rack', { key: 'd', label: tl('Profondeur'), type: 'number', unit: 'mm', min: 200, max: 1400, int: true, read: r => r.d, write: (r, v) => { if (v != null) r.d = v; } });
  }
  return out;
}
/** Applique une valeur à tous les objets concernés ; rend le nombre d'objets modifiés (l'appelant fait ctx.commit()). */
export function applyBulk(data, items, field, value) {
  let n = 0;
  for (const it of items) { if (field.applies && !field.applies(it)) continue; field.set(it, value, data); n++; }
  return n;
}

/* ---------- Actions du navigateur (modèle muté ; l'appelant fait ctx.commit()) ---------- */
/** Objets d'un nœud et de tout ce qu'il contient (groupes compris), sans les groupes : [{ kind, id }]. */
export function descendants(node, kinds = null) {
  const out = [];
  const walk = n => { if (n.kind !== 'grp' && n.id != null && (!kinds || kinds.includes(n.kind))) out.push({ kind: n.kind, id: n.id }); for (const c of n.children || []) walk(c); };
  walk(node);
  return out;
}
/** Renomme un objet : nom (équipement, pièce, baie, étage, bâtiment, cheminement) ou étiquette imposée (câble). */
export function renameItem(data, item, text) {
  const v = String(text ?? '').trim().slice(0, item.kind === 'cable' ? 32 : 40); if (!v) return false;
  const [it] = resolveSel(data, [item]); if (!it) return false;
  if (item.kind === 'cable') it.o.tag = v;
  else if (item.kind === 'dev' || item.kind === 'rack') it.o.name = v.slice(0, 24);
  else if (['room', 'floor', 'building', 'path'].includes(item.kind)) it.o.name = v;
  else return false;
  return true;
}
export const canRename = kind => ['dev', 'rack', 'room', 'floor', 'building', 'path', 'cable'].includes(kind);
export const canRemove = kind => ['dev', 'cable', 'room', 'path', 'rack', 'wall', 'door'].includes(kind);
/** Retire des objets (équipements avec leurs câbles, baies : leurs équipements restent hors baie) ; rend le nombre retiré. */
export function removeItems(data, list) {
  let n = 0;
  const gone = new Set(list.filter(x => x.kind === 'dev').map(x => x.id));
  if (gone.size) { const before = data.devices.length; data.devices = data.devices.filter(d => !gone.has(d.id)); n += before - data.devices.length; data.cables = data.cables.filter(c => !gone.has(c.a[0]) && !gone.has(c.b[0])); }
  const cab = new Set(list.filter(x => x.kind === 'cable').map(x => x.id));
  if (cab.size) { const before = data.cables.length; data.cables = data.cables.filter(c => !cab.has(c.id)); n += before - data.cables.length; }
  const pth = new Set(list.filter(x => x.kind === 'path').map(x => x.id));
  if (pth.size) { const before = (data.paths || []).length; data.paths = (data.paths || []).filter(p => !pth.has(p.id)); n += before - data.paths.length; }
  for (const x of list) if (x.kind === 'rack' && RK.removeRack(data, x.id, { unrack: true }).rack) n++;
  const site = new Set(list.filter(x => x.kind === 'room' || x.kind === 'wall' || x.kind === 'door').map(x => x.id));
  if (site.size) for (const b of (data.site && data.site.buildings) || []) for (const f of b.floors || []) {
    const walls = new Set(f.walls.filter(w => site.has(w.id)).map(w => w.id));
    const r0 = f.rooms.length + f.walls.length + f.doors.length;
    f.rooms = f.rooms.filter(r => !site.has(r.id)); f.walls = f.walls.filter(w => !walls.has(w.id)); f.doors = f.doors.filter(d => !site.has(d.id) && !walls.has(d.wall));
    n += r0 - (f.rooms.length + f.walls.length + f.doors.length);
  }
  return n;
}
/**
 * Duplique des équipements : make(type, { x, y }) crée l'équipement (ctx.newDevice : nom et id libres) ; réglages
 * recopiés, sans les câbles ; sur un plan : décalé de 1 m ; en baie : place libre la plus proche, sinon hors baie.
 * Rend les nouveaux équipements.
 */
export function duplicateDevs(data, ids, make) {
  const out = [], racks = new Map((data.racks || []).map(r => [r.id, r]));
  for (const id of ids) {
    const d = (data.devices || []).find(x => x.id === id); if (!d) continue;
    const c = make(d.type, { x: (d.x || 0) + 40, y: (d.y || 0) + 40 }); if (!c) continue;
    if (d.p) c.p = JSON.parse(JSON.stringify(d.p));
    if (d.loc) c.loc = { ...d.loc, x: d.loc.x + 1, y: d.loc.y + 1 };
    const r = d.rack && racks.get(d.rack.id);
    if (r) { const u = RK.findFree(data, r, c, d.rack.face || 'front', d.rack.u); if (u > 0) c.rack = { id: r.id, u, face: d.rack.face || 'front' }; }
    out.push(c);
  }
  return out;
}
/** Peut-on déposer ces objets sur ce nœud ? Équipements → baie (montables), pièce, étage, « Hors plan ». */
export function canDrop(nodes, target) {
  if (!nodes.length || nodes.some(n => n.kind !== 'dev')) return false;
  return ['rack', 'room', 'floor'].includes(target.kind) || target.key === 'grp:loose';
}
/**
 * Range des équipements : dans une baie (place libre, de haut en bas), dans une pièce (près de son centre, en grille de
 * 0,8 m), sur un étage (centre de son emprise), ou hors plan. Rend { moved, refused (pas montables ou baie pleine) }.
 */
export function moveDevs(data, ids, target) {
  const devs = ids.map(id => (data.devices || []).find(x => x.id === id)).filter(Boolean);
  let moved = 0, refused = 0;
  const grid = (c, i) => { const k = Math.ceil(Math.sqrt(devs.length)); return [c[0] + ((i % k) - (k - 1) / 2) * 0.8, c[1] + (Math.floor(i / k) - (k - 1) / 2) * 0.8]; };
  if (target.kind === 'rack') {
    const r = (data.racks || []).find(x => x.id === target.id); if (!r) return { moved, refused: devs.length };
    for (const d of devs) {
      if (!RK.rackable(d.type)) { refused++; continue; }
      const was = d.rack; delete d.rack;
      const u = RK.findFree(data, r, d, 'front', r.u);
      if (u > 0) { d.rack = { id: r.id, u, face: 'front' }; delete d.loc; moved++; } else { if (was) d.rack = was; refused++; }
    }
  } else if (target.key === 'grp:loose') { for (const d of devs) { if (d.rack || d.loc) { delete d.rack; delete d.loc; moved++; } } }
  else {
    let f = null, c = null;
    if (target.kind === 'room') { for (const b of (data.site && data.site.buildings) || []) for (const fl of b.floors || []) { const r = fl.rooms.find(x => x.id === target.id); if (r) { f = fl; c = roomPoint(r); } } }
    else if (target.kind === 'floor') { const F = floorOf(data.site, target.id); if (F) { f = F.f; const P = [...f.walls.flatMap(w => [w.a, w.b]), ...f.rooms.flatMap(r => r.poly)]; const b = P.length ? bbox(P) : [0, 0, 10, 10]; c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; } }
    if (!f) return { moved, refused: devs.length };
    devs.forEach((d, i) => { const [x, y] = grid(c, i); d.loc = { floor: f.id, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, h: d.loc ? d.loc.h : /^(ap|camera)/.test(d.type) ? 2.7 : /^outlet/.test(d.type) ? 0.3 : 1 }; delete d.rack; moved++; });
  }
  return { moved, refused };
}
