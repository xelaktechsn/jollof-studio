// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Documents du projet réseau : étiquetage (identifiants à la manière de TIA-606 : local technique fs, baie, panneau,
// port, lien horizontal fs-an, format réglable par jetons), tableaux (câbles, brassage, étiquettes), nomenclature et
// chiffrage, exports CSV et SVG (plans d'étage avec les identifiants des prises, élévations de baies) et rapport HTML
// prêt à imprimer. Module pur, sans interface : la vue Conception, les vues Plans et Baies (labelOf), les vérifications,
// les TP et l'IA s'en servent.
//
// Jetons des formats (data.design.labels) : {b} bâtiment (B1, B2…), {f} étage (niveau ; S1 pour -1), {s} lettre du local
// sur l'étage, {fs} identifiant du local (format space), {r} numéro de baie dans le local (01…), {u} unité du panneau,
// {p} lettre du panneau dans le local (A…), {n} numéro de port (sur pad chiffres), {room} pièce.
// Formes reprises des guides publics (normes payantes) : fs et fs-an (TIA-606-A, article de Cabling Installation &
// Maintenance), baie-unité:port et extrémité/extrémité (TIA-606-B, guide Panduit) : clés tia606aCim, panduitIdan02.
import { tl } from '../i18n/index.js';
import { roomPath, roomPoint } from './site.js';
import { DEVICES, specOf } from './devices.js';
import { CATS } from './cable.js';
import * as RACK from './rack.js';
import { cleanDesign, spacesOf, spaceLetters, floorsOf, horizontalLinks, mountOf, roomOfDev, PRICE_KEYS, PRESETS } from './dimension.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const designOf = data => (data.design && data.design.usage ? data.design : cleanDesign(data && data.design));
const isOutlet = d => d && (d.type === 'outlet' || d.type === 'outlet2');
const isPanel = d => d && (/^patch/.test(d.type) || d.type === 'fibrepanel');
const portNum = p => { const m = /(\d+)$/.exec(p || ''); return m ? +m[1] : 0; };
const floorCode = lv => (lv < 0 ? 'S' + -lv : String(lv));
/** Remplace les jetons {x} d'un format. */
export const fill = (fmt, t) => String(fmt).replace(/\{(\w+)\}/g, (m, k) => (t[k] != null ? String(t[k]) : ''));

/* ---------- Étiquetage ---------- */
/** Petite empreinte du modèle (ce qui change les étiquettes) : le cache de labeler() la compare. */
function sig(data) {
  let h = 2166136261;
  const add = s => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } };
  for (const c of data.cables || []) add(c.id + c.a[0] + c.a[1] + c.b[0] + c.b[1] + (c.tag || ''));
  for (const d of data.devices || []) add(d.id + d.name + (d.rack ? d.rack.id + d.rack.u : '') + (d.tag || '') + (d.loc ? d.loc.floor : ''));
  for (const r of data.racks || []) add(r.id + r.floor + (r.room || '') + r.x + ',' + r.y);
  add(JSON.stringify((data.design || {}).labels || {}));
  for (const { b, f } of floorsOf(data)) add(b.id + f.id + f.level);
  return (h >>> 0) + ':' + (data.devices || []).length + ':' + (data.cables || []).length;
}
const CACHE = new WeakMap();
const cheap = data => `${(data.devices || []).length}:${(data.cables || []).length}:${(data.racks || []).length}:${JSON.stringify((data.design || {}).labels || {})}`;
/**
 * Étiqueteur du modèle (index construit une fois) : { of(devId, portId?), cable(c), space(key), rack(id) }. Gardé tant
 * que le modèle ne change pas : pendant un même tour d'exécution (une vue qui dessine 600 prises), une empreinte légère
 * suffit ; au tour suivant, l'empreinte complète est recalculée (une modification sur place est alors vue).
 */
export function labeler(data, o = {}) {
  const hit = CACHE.get(data), c = cheap(data);
  if (hit && !o.fresh && hit.tick && hit.cheap === c) return hit.L;
  const s = sig(data);
  if (hit && !o.fresh && hit.sig === s) { hit.tick = true; hit.cheap = c; queueMicrotask(() => { hit.tick = false; }); return hit.L; }
  const e = { sig: s, cheap: c, tick: true, L: buildLabeler(data) }; CACHE.set(data, e); queueMicrotask(() => { e.tick = false; });
  return e.L;
}
/** Formats d'étiquette en vigueur : ceux du préréglage ('auto' : campus dès que le site a plusieurs bâtiments). */
export function labelFormats(data) {
  const F = designOf(data).labels;
  if (F.preset === 'custom') return F;
  const k = F.preset === 'auto' ? (((data.site && data.site.buildings) || []).length > 1 ? 'campus' : 'tia') : F.preset;
  return { ...F, ...PRESETS[k], preset: F.preset, resolved: k };
}
function buildLabeler(data) {
  const F = labelFormats(data), pad = n => String(n).padStart(F.pad, '0');
  const devs = new Map((data.devices || []).map(d => [d.id, d]));
  // Ports de chaque équipement, construits une fois (un switch de 48 ports n'est pas reconstruit pour chaque câble).
  const pc = new Map(), ports = d => { let m = pc.get(d.id); if (!m) { m = specOf(d) ? specOf(d).ports(d.p || {}) : []; pc.set(d.id, m); } return m; };
  const plabel = (d, pid) => { const p = ports(d).find(x => x.id === pid); return p ? p.label || pid : pid; };
  const floors = new Map(floorsOf(data).map(x => [x.f.id, x]));
  const spaces = spacesOf(data), let_ = spaceLetters(spaces);
  const spaceOfRack = new Map(), spaceTok = new Map(), rackNo = new Map();
  for (const sp of spaces) {
    const fl = floors.get(sp.floor), t = { b: 'B' + (sp.bi + 1), f: floorCode(+fl.f.level || 0), s: let_.get(sp.key) };
    t.fs = fill(F.space, t); spaceTok.set(sp.key, t);
    sp.racks.slice().sort((a, b) => (+a.x || 0) - (+b.x || 0) || (a.id < b.id ? -1 : 1)).forEach((r, i) => { spaceOfRack.set(r.id, sp.key); rackNo.set(r.id, String(i + 1).padStart(2, '0')); });
  }
  // Panneaux de chaque local : de la première baie à la dernière, du haut vers le bas.
  const panelLetter = new Map(), bySpace = new Map();
  for (const d of data.devices || []) if (isPanel(d) && d.rack && spaceOfRack.has(d.rack.id)) { const k = spaceOfRack.get(d.rack.id); if (!bySpace.has(k)) bySpace.set(k, []); bySpace.get(k).push(d); }
  for (const list of bySpace.values()) list.sort((a, b) => rackNo.get(a.rack.id).localeCompare(rackNo.get(b.rack.id)) || b.rack.u - a.rack.u || (a.id < b.id ? -1 : 1)).forEach((d, i) => panelLetter.set(d.id, lettersOf(i)));
  // Liens permanents : port arrière d'une prise → port arrière d'un panneau.
  const linkOf = new Map();
  for (const l of horizontalLinks(data)) linkOf.set(l.outlet + '|' + l.oport, l);
  const tokOfPanel = d => {
    const k = d.rack && spaceOfRack.get(d.rack.id); if (!k) return null;
    return { ...spaceTok.get(k), r: rackNo.get(d.rack.id), u: pad(d.rack.u), p: panelLetter.get(d.id) || '' };
  };
  const rackLabel = id => { const k = spaceOfRack.get(id); return k ? fill(F.rack, { ...spaceTok.get(k), r: rackNo.get(id) }) : ((data.racks || []).find(r => r.id === id) || {}).name || id; };
  function of(devId, portId) {
    const d = devs.get(devId); if (!d) return '';
    if (isPanel(d)) {
      const t = tokOfPanel(d);
      if (portId) { const n = portNum(portId); if (d.tag) return d.tag + ':' + pad(n); return t ? fill(F.link, { ...t, n: pad(n) }) : d.name + ':' + portId; }
      return d.tag || (t ? fill(F.panel, t) : d.name);
    }
    if (isOutlet(d)) {
      const backs = ports(d).filter(p => p.punch);
      const lab = bp => { const l = linkOf.get(d.id + '|' + bp); return l ? of(l.panel, l.pport) : ''; };
      if (portId) { const bp = /back/.test(portId) ? portId : portId.replace('front', 'back'); return d.tag ? d.tag + (backs.length > 1 ? '-' + portNum(bp) : '') : lab(bp); }
      if (d.tag) return d.tag;
      return backs.map(p => lab(p.id)).filter(Boolean).join(' / ');
    }
    if (portId) return (d.tag || d.name) + ':' + plabel(d, portId);
    return d.tag || d.name;
  }
  function cable(c) {
    if (c.tag) return c.tag;
    const A = devs.get(c.a[0]), B = devs.get(c.b[0]);
    if (isOutlet(A) && isPanel(B) && /back/.test(c.a[1])) return of(B.id, c.b[1]);
    if (isOutlet(B) && isPanel(A) && /back/.test(c.b[1])) return of(A.id, c.a[1]);
    const cord = (isPanel(A) && !/^b/.test(c.a[1])) || (isPanel(B) && !/^b/.test(c.b[1]));
    return of(c.a[0], c.a[1]) + (cord ? '\\' : '/') + of(c.b[0], c.b[1]);
  }
  return { of, cable, ports, rack: rackLabel, space: k => (spaceTok.get(k) || {}).fs || '', spaceOfRack: id => spaceOfRack.get(id) || null };
}
const lettersOf = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const portLabel = (d, pid) => { const p = specOf(d) && specOf(d).ports(d.p || {}).find(x => x.id === pid); return p ? p.label || pid : pid; };
/** Étiquette d'un équipement, ou d'un de ses ports (prise : identifiant du lien horizontal, ex. « 1A-B04 »). */
export const labelOf = (data, devId, portId) => labeler(data).of(devId, portId);
/** Étiquette d'un câble : lien horizontal → identifiant du lien ; sinon « extrémité/extrémité » (cordon : « \ »). */
export const cableLabel = (data, c) => labeler(data).cable(c);

/** Tableau des étiquettes : locaux, baies, panneaux, ports de prise, câbles ({ kind, id, port, label, where }). */
export function labelTable(data, o = {}) {
  const L = labeler(data), rows = [], fl = floorsOf(data), many = new Set(fl.map(x => x.b.id)).size > 1;
  const fname = id => { const F = fl.find(x => x.f.id === id); return F ? (many ? (F.b.name || F.b.id) + ' · ' : '') + (F.f.name || F.f.id) : id || ''; };
  for (const sp of spacesOf(data)) { const r0 = sp.room && fl.flatMap(x => x.f.rooms || []).find(r => r.id === sp.room); rows.push({ kind: 'space', id: sp.key, label: L.space(sp.key), where: fname(sp.floor) + (r0 ? ' · ' + (r0.name || r0.id) : '') }); }
  for (const r of data.racks || []) rows.push({ kind: 'rack', id: r.id, label: L.rack(r.id), where: fname(r.floor) });
  for (const d of data.devices || []) {
    if (isPanel(d)) rows.push({ kind: 'panel', id: d.id, label: L.of(d.id), where: d.rack ? L.rack(d.rack.id) : '' });
    if (isOutlet(d)) { const room = roomOfDev(data, d); for (const p of L.ports(d).filter(x => x.punch)) rows.push({ kind: 'outlet', id: d.id, port: p.id, label: L.of(d.id, p.id), where: room ? room.name || room.id : '' }); }
  }
  if (o.cables !== false) for (const c of data.cables || []) rows.push({ kind: 'cable', id: c.id, label: L.cable(c), where: '' });
  return rows;
}
/** Étiquettes en double (même texte pour deux objets) et prises sans identifiant : { dups: [{ label, items }], empty: [ids] }. */
export function labelIssues(data) {
  const seen = new Map(), empty = [];
  for (const r of labelTable(data, { cables: false })) { // un lien horizontal porte l'identifiant de sa prise : normal
    if (!r.label) { if (r.kind === 'outlet') empty.push(r.id); continue; }
    const k = r.label.toUpperCase(); if (!seen.has(k)) seen.set(k, []); seen.get(k).push(r);
  }
  const dups = [...seen.entries()].filter(([, v]) => v.length > 1).map(([label, items]) => ({ label, items }));
  return { dups, empty: [...new Set(empty)] };
}

/* ---------- Tableaux ---------- */
/** Genre d'un câble : 'horizontal' (lien permanent), 'cord' (cordon de brassage ou d'équipement), 'backbone' (rocade), 'other'. */
export function cableKind(data, c, devs) {
  const by = devs || new Map((data.devices || []).map(d => [d.id, d])), A = by.get(c.a[0]), B = by.get(c.b[0]);
  if ((isOutlet(A) && isPanel(B)) || (isOutlet(B) && isPanel(A))) return 'horizontal';
  if (isPanel(A) && isPanel(B) && /^b/.test(c.a[1]) && /^b/.test(c.b[1])) return 'backbone';
  if (c.media === 'fibre' && (+c.len || 0) > 15) return 'backbone';
  if ((+c.len || 0) <= 10) return 'cord';
  return 'other';
}
/** Cheminements empruntés par un câble (route.calc du tracé automatique, route.js) : noms ou identifiants. */
function pathsOf(data, c) {
  const calc = c.route && c.route.calc; if (!calc) return [];
  const list = calc.paths || calc.via || calc.ids || calc.segs || [];
  const byId = new Map((data.paths || []).map(p => [p.id, p]));
  return (Array.isArray(list) ? list : []).map(x => (typeof x === 'string' ? x : x && (x.path || x.id))).filter(Boolean).map(id => { const p = byId.get(id); return p ? p.name || id : id; });
}
/** Tableau des câbles : { id, label, kind, from, to, media, type, len, mode, fallback (longueur en équerre, sans cheminement), paths }. */
export function cableSchedule(data) {
  const L = labeler(data), devs = new Map((data.devices || []).map(d => [d.id, d]));
  return (data.cables || []).map(c => ({
    id: c.id, label: L.cable(c), kind: cableKind(data, c, devs),
    from: `${(devs.get(c.a[0]) || { name: c.a[0] }).name} · ${portName(devs, c.a, L)}`, to: `${(devs.get(c.b[0]) || { name: c.b[0] }).name} · ${portName(devs, c.b, L)}`,
    media: c.media === 'fibre' ? 'fibre' : 'copper', type: c.media === 'fibre' ? String(c.fibre || '').toUpperCase() : (CATS[c.cat] || {}).name || c.cat,
    len: +(+c.len || 0).toFixed(1), mode: c.route ? c.route.mode : '', fallback: !!(c.route && c.route.calc && c.route.calc.fallback), paths: pathsOf(data, c)
  }));
}
const portName = (devs, end, L) => { const d = devs.get(end[0]); if (!d) return end[1]; const p = L ? L.ports(d).find(x => x.id === end[1]) : null; return p ? p.label || end[1] : L ? end[1] : portLabel(d, end[1]); };
/** Tableau de brassage (repli quand rack.js n'en fournit pas) : avant de panneau ↔ port d'équipement. */
export function patchRows(data) {
  const L = labeler(data), devs = new Map((data.devices || []).map(d => [d.id, d])), rows = [], at = new Map();
  for (const c of data.cables || []) { at.set(c.a.join('|'), c); at.set(c.b.join('|'), c); }
  for (const c of data.cables || []) {
    const A = devs.get(c.a[0]), B = devs.get(c.b[0]); if (!A || !B) continue;
    const [P, pp, E, ep] = isPanel(A) && !/^b/.test(c.a[1]) && !isPanel(B) ? [A, c.a[1], B, c.b[1]] : isPanel(B) && !/^b/.test(c.b[1]) && !isPanel(A) ? [B, c.b[1], A, c.a[1]] : [];
    if (!P) continue;
    const back = at.get(P.id + '|b' + portNum(pp));
    const far = back ? (back.a[0] === P.id ? back.b : back.a) : null;
    rows.push({ rack: P.rack ? L.rack(P.rack.id) : '', panel: L.of(P.id), port: L.of(P.id, pp), device: E.name, dport: portLabel(E, ep), outlet: far ? L.of(far[0], far[1]) || (devs.get(far[0]) || {}).name || far[0] : '', len: +(+c.len || 0).toFixed(1), cable: c.id });
  }
  return rows.sort((a, b) => (a.port < b.port ? -1 : a.port > b.port ? 1 : 0));
}

/**
 * Tableau de brassage : celui de rack.js (patchingSchedule, partie baies) quand il existe, mis à nos colonnes et à nos
 * identifiants ; sinon patchRows. Lignes { rack, panel, port (identifiant du lien), device, dport, vlan, outlet, oport,
 * permLen, cordLen }.
 */
export function patchingRows(data, lan) {
  if (typeof RACK.patchingSchedule !== 'function') return patchRows(data).map(r => ({ rack: r.rack, panel: r.panel, port: r.port, device: r.device, dport: r.dport, vlan: '', outlet: r.outlet, oport: '', permLen: null, cordLen: r.len }));
  const L = labeler(data);
  let rows = [];
  try { rows = RACK.patchingSchedule(data, lan || null) || []; } catch (e) { console.error(e); return patchRows(data); }
  return rows.map(r => ({
    rack: r.rackId ? L.rack(r.rackId) : r.rack || '', panel: r.panelId ? L.of(r.panelId) : r.panel || '', port: r.panelId && r.portId ? L.of(r.panelId, r.portId) : r.port || '',
    device: r.switch || '', dport: r.switchPort || '', vlan: r.vlan ?? '', outlet: r.outlet || '', oport: r.outletPort || '',
    permLen: r.permLen != null ? +(+r.permLen).toFixed(1) : null, cordLen: r.cordLen != null ? +(+r.cordLen).toFixed(1) : null
  }));
}

/* ---------- Nomenclature et chiffrage ---------- */
const GROUP = { switch: 'active', router: 'active', ap: 'active', host: 'terminal', passive: 'passive', mech: 'rack' };
/**
 * Nomenclature tirée du modèle : équipements par type, embases RJ45 des prises, câble cuivre en tourets (méthode des
 * liens par touret avec la longueur moyenne et les chutes), cordons, fibre (m), modules SFP, baies, étiquettes, puis la
 * main-d'œuvre (lignes libres). Prix : data.design.prices, total par ligne, sous-totaux, total.
 * Rend { lines: [{ key, group, name, unit, qty, price, total, note }], groups: { [g]: total }, total, currency }.
 */
export function bom(data) {
  const D = designOf(data), price = k => +(D.prices[k] || 0), lines = [];
  const add = (key, group, name, unit, qty, note) => { if (qty > 0) lines.push({ key, group, name, unit, qty: +qty.toFixed(2), price: price(key), total: +(qty * price(key)).toFixed(2), note: note || '' }); };
  const count = new Map();
  for (const d of data.devices || []) count.set(d.type, (count.get(d.type) || 0) + 1);
  for (const [t, n] of [...count.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const s = DEVICES[t]; if (!s) continue;
    add(t, GROUP[s.role] || 'active', s.name(), tl('u.'), n);
  }
  const jacks = (data.devices || []).filter(isOutlet).reduce((a, d) => a + specOf(d).ports(d.p || {}).filter(p => p.punch).length, 0);
  add('jack', 'passive', tl('Embase RJ45 (keystone) {0}', (CATS[D.cat] || {}).name || ''), tl('u.'), jacks);
  // Câble cuivre : liens permanents et longs câbles, par catégorie, en tourets.
  const devs = new Map((data.devices || []).map(d => [d.id, d])), cu = new Map();
  let cords = 0, fibreM = 0, jumpers = 0;
  for (const c of data.cables || []) {
    const k = cableKind(data, c, devs);
    if (c.media === 'fibre') { if (k === 'backbone' || k === 'other') fibreM += +c.len || 0; else jumpers++; continue; }
    if (k === 'cord') { cords++; continue; }
    if (!cu.has(c.cat)) cu.set(c.cat, []); cu.get(c.cat).push(+c.len || 0);
  }
  for (const [cat, lens] of cu) {
    const total = lens.reduce((a, b) => a + b, 0), avg = total / lens.length, per = Math.max(1, Math.floor(D.box / (avg * (1 + D.waste / 100)))), boxes = Math.ceil(lens.length / per);
    add('box_' + cat, 'cable', tl('Câble {0} U/UTP, touret de {1} m', (CATS[cat] || {}).name || cat, D.box), tl('touret'), boxes, tl('{0} liens, {1} m, moyenne {2} m, {3} liens par touret', lens.length, Math.round(total), avg.toFixed(1), per));
  }
  add('cord', 'cable', tl('Cordon de brassage RJ45'), tl('u.'), cords);
  add('fibre_m', 'cable', tl('Câble fibre optique de rocade'), 'm', Math.round(fibreM * (1 + D.waste / 100)), tl('chutes comprises ({0} %)', D.waste));
  add('fjumper', 'cable', tl('Jarretière optique'), tl('u.'), jumpers);
  const sfp = (data.devices || []).reduce((a, d) => a + (d.p && d.p.sfp && typeof d.p.sfp === 'object' ? Object.values(d.p.sfp).filter(Boolean).length : 0), 0);
  add('sfp', 'active', tl('Module SFP/SFP+'), tl('u.'), sfp);
  const racks = data.racks || [];
  if (racks.length) add('rack', 'rack', tl('Baie 19 pouces ({0})', [...new Set(racks.map(r => (r.u || '?') + ' U'))].join(', ')), tl('u.'), racks.length);
  const links = horizontalLinks(data).length;
  add('label', 'passive', tl('Étiquette (deux par lien, une par panneau et par baie)'), tl('u.'), links * 2 + (data.devices || []).filter(isPanel).length + racks.length);
  for (const [i, l] of D.labour.entries()) lines.push({ key: 'labour' + i, group: 'labour', name: l.name, unit: l.unit || tl('h'), qty: l.qty, price: l.price, total: +(l.qty * l.price).toFixed(2), note: '', labour: i });
  const groups = {};
  for (const l of lines) groups[l.group] = +((groups[l.group] || 0) + l.total).toFixed(2);
  // Aucun prix par défaut (ils dépendent du pays, du fournisseur, de la date) : une ligne sans prix est « à renseigner » et
  // le total n'est alors que partiel (complete: false).
  const unpriced = lines.filter(l => !l.price).map(l => l.key);
  return { lines, groups, total: +lines.reduce((a, l) => a + l.total, 0).toFixed(2), currency: D.currency, unpriced, complete: !unpriced.length && lines.length > 0 };
}
export const BOM_KEYS = PRICE_KEYS;
/** Montant écrit dans la devise (séparateur de milliers fin, 2 décimales sauf XOF/XAF). */
export function money(v, cur, en) {
  const z = cur === 'XOF' || cur === 'XAF' ? 0 : 2;
  try { return new Intl.NumberFormat(en ? 'en-GB' : 'fr-FR', { style: 'currency', currency: cur, minimumFractionDigits: z, maximumFractionDigits: z }).format(v); } catch (e) { return (+v).toFixed(z) + ' ' + cur; }
}

/* ---------- Exports ---------- */
/**
 * CSV (RFC 4180 : champs entre guillemets si besoin, guillemets doublés, fins de ligne CRLF), UTF-8 avec BOM pour Excel.
 * cols [{ key, name, num? }], rows d'objets ; o : séparateur (';', ',', '\t') ou { sep, decimal: '.'|',' } — les colonnes
 * num s'écrivent avec ce séparateur décimal (virgule pour un tableur réglé en français).
 */
export function toCsv(cols, rows, o = ';') {
  const opt = typeof o === 'string' ? { sep: o } : o || {}, sep = opt.sep || ';', dec = opt.decimal || '.';
  const q = v => { const s = Array.isArray(v) ? v.join(' > ') : String(v ?? ''); return s.includes(sep) || /["\r\n]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const val = (c, r) => { const v = typeof c.key === 'function' ? c.key(r) : r[c.key]; return c.num && typeof v === 'number' && dec !== '.' ? String(v).replace('.', dec) : v; };
  return '﻿' + [cols.map(c => q(c.name)).join(sep), ...rows.map(r => cols.map(c => q(val(c, r))).join(sep))].join('\r\n') + '\r\n';
}
/** Réglages d'export CSV du projet → { sep, decimal, headers } (auto : point-virgule et virgule en français). */
export function csvOptions(data, en) {
  const E = designOf(data).exports, SEP = { semicolon: ';', comma: ',', tab: '\t' };
  const sep = E.csvSep === 'auto' ? (en ? ',' : ';') : SEP[E.csvSep], decimal = E.csvDecimal === 'auto' ? (sep === ';' ? ',' : '.') : E.csvDecimal === 'comma' ? ',' : '.';
  return { sep, decimal, headers: E.csvHeaders };
}
/** Fabricant et référence d'un type, d'après la fiche qui a servi au modèle (rack.js MOUNT.ref). */
const MAKERS = ['Tripp Lite', 'TP-Link', 'UniFi', 'Ubiquiti', 'Cisco', 'Belden', 'Leviton', 'Eaton', 'Dell', 'Pulsar', 'Panduit', 'APC', 'Axis', 'HPE', 'Aruba'];
export function makerOf(type) {
  const ref = RACK.MOUNT && RACK.MOUNT[type] && RACK.MOUNT[type].ref; if (!ref) return { maker: '', part: '' };
  const m = MAKERS.find(x => ref.startsWith(x + ' ')); return m ? { maker: m, part: ref.slice(m.length + 1) } : { maker: '', part: ref };
}
/**
 * Tableaux d'échange (outils de gestion de câblage, tableurs) : câbles, brassage, nomenclature, prises, plan d'adressage,
 * étiquettes. headers 'standard' : en-têtes anglais fixes, ceux des outils courants (« Cable ID, From Device, From Port… »,
 * « Item, Description, Manufacturer, Part Number… ») ; 'local' : dans la langue de l'interface.
 * Rend { [nom]: { cols: [{ key, name, num? }], rows } }.
 */
export function csvTables(data, lan, o = {}) {
  const std = o.headers !== 'local', H = (en, fr) => (std ? en : tl(fr)), L = labeler(data), devs = new Map((data.devices || []).map(d => [d.id, d]));
  const cs = cableSchedule(data), at = new Map();
  for (const c of data.cables || []) { at.set(c.a.join('|'), c); at.set(c.b.join('|'), c); }
  const pname = (d, pid) => { if (!d) return pid; const p = L.ports(d).find(x => x.id === pid); return p ? p.label || pid : pid; };
  const cables = { cols: [
    { key: 'label', name: H('Cable ID', 'Étiquette') }, { key: r => r.c.a[0] && (devs.get(r.c.a[0]) || {}).name, name: H('From Device', 'De') }, { key: r => pname(devs.get(r.c.a[0]), r.c.a[1]), name: H('From Port', 'Port') },
    { key: r => (devs.get(r.c.b[0]) || {}).name, name: H('To Device', 'Vers') }, { key: r => pname(devs.get(r.c.b[0]), r.c.b[1]), name: H('To Port', 'Port') },
    { key: r => (r.media === 'fibre' ? 'Fiber' : 'Copper'), name: H('Type', 'Support') }, { key: 'type', name: H('Category', 'Catégorie') }, { key: 'len', name: H('Length (m)', 'Longueur (m)'), num: 1 },
    { key: r => KINDS_EN[r.kind] || r.kind, name: H('Function', 'Genre') }, { key: r => (r.mode === 'auto' ? 'auto' : r.mode || ''), name: H('Routing', 'Tracé') }, { key: r => r.paths.join(' > '), name: H('Pathways', 'Cheminements') }
  ], rows: cs.map(r => ({ ...r, c: (data.cables || []).find(x => x.id === r.id) })) };
  const pr = patchingRows(data, lan);
  const patching = { cols: [
    { key: 'rack', name: H('Rack', 'Baie') }, { key: 'panel', name: H('Patch Panel', 'Panneau') }, { key: 'port', name: H('Panel Port ID', 'Identifiant') },
    { key: 'device', name: H('Switch', 'Équipement') }, { key: 'dport', name: H('Switch Port', 'Port') }, { key: 'vlan', name: H('VLAN', 'VLAN') },
    { key: 'outlet', name: H('Outlet', 'Prise') }, { key: 'oport', name: H('Outlet Port', 'Port de prise') }, { key: 'permLen', name: H('Permanent Link (m)', 'Lien permanent (m)'), num: 1 }, { key: 'cordLen', name: H('Patch Cord (m)', 'Cordon (m)'), num: 1 }
  ], rows: pr };
  const b = bom(data);
  const bomT = { cols: [
    { key: (r, i) => r.i, name: H('Item', 'Ligne') }, { key: 'name', name: H('Description', 'Désignation') }, { key: 'maker', name: H('Manufacturer', 'Fabricant') }, { key: 'part', name: H('Part Number', 'Référence') },
    { key: 'qty', name: H('Quantity', 'Quantité'), num: 1 }, { key: 'unit', name: H('Unit', 'Unité') }, { key: r => (r.price ? r.price : ''), name: H('Unit Price', 'Prix unitaire'), num: 1 },
    { key: r => (r.price ? r.total : ''), name: H('Total', 'Total'), num: 1 }, { key: () => b.currency, name: H('Currency', 'Devise') }, { key: 'note', name: H('Notes', 'Remarque') }
  ], rows: b.lines.map((l, i) => ({ ...l, i: i + 1, ...(DEVICE_KEYS.has(l.key) ? makerOf(l.key) : { maker: '', part: '' }) })) };
  // Liste des prises : un port par ligne, du mur au switch.
  const orows = [], floors = new Map(floorsOf(data).map(x => [x.f.id, x]));
  for (const d of data.devices || []) {
    if (!isOutlet(d)) continue;
    const room = roomOfDev(data, d), F = d.loc && floors.get(d.loc.floor);
    for (const bp of L.ports(d).filter(p => p.punch)) {
      const link = at.get(d.id + '|' + bp.id), far = link ? (link.a[0] === d.id ? link.b : link.a) : null, P = far && devs.get(far[0]);
      const front = P && isPanel(P) ? at.get(P.id + '|f' + portNum(far[1])) : null, sw = front ? (front.a[0] === P.id ? front.b : front.a) : null, S = sw && devs.get(sw[0]);
      const cfg = S && S.p && S.p.ports ? S.p.ports[sw[1]] : null;
      orows.push({ id: L.of(d.id, bp.id), dev: d.name, port: bp.label || bp.id, room: room ? room.name || room.id : '', floor: F ? F.f.name || F.f.id : '', building: F ? F.b.name || F.b.id : '',
        panel: P ? L.of(P.id) : '', pport: far ? portNum(far[1]) : '', sw: S ? S.name : '', swport: S ? pname(S, sw[1]) : '', vlan: cfg ? cfg.vlan ?? '' : '', voice: cfg && cfg.voice ? cfg.voice : '',
        len: link ? +(+link.len || 0).toFixed(1) : '', x: d.loc ? d.loc.x : '', y: d.loc ? d.loc.y : '', h: d.loc ? d.loc.h : '' });
    }
  }
  const outlets = { cols: [
    { key: 'id', name: H('Outlet ID', 'Identifiant') }, { key: 'dev', name: H('Faceplate', 'Prise') }, { key: 'port', name: H('Port', 'Port') }, { key: 'room', name: H('Room', 'Nom de la pièce') }, { key: 'floor', name: H('Floor', 'Étage') }, { key: 'building', name: H('Building', 'Bâtiment') },
    { key: 'panel', name: H('Patch Panel', 'Panneau') }, { key: 'pport', name: H('Panel Port', 'Port du panneau') }, { key: 'sw', name: H('Switch', 'Switch') }, { key: 'swport', name: H('Switch Port', 'Port du switch') },
    { key: 'vlan', name: H('Data VLAN', 'VLAN de données') }, { key: 'voice', name: H('Voice VLAN', 'VLAN voix') }, { key: 'len', name: H('Link Length (m)', 'Longueur du lien (m)'), num: 1 },
    { key: 'x', name: H('X (m)', 'X (m)'), num: 1 }, { key: 'y', name: H('Y (m)', 'Y (m)'), num: 1 }, { key: 'h', name: H('Height (m)', 'Hauteur (m)'), num: 1 }
  ], rows: orows };
  const iprows = (data.vlans || []).map(v => { const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(v.net || ''); const n = m ? +m[2] : null, size = n != null ? 2 ** (32 - n) : 0; const base = m ? m[1].split('.').reduce((a, x) => a * 256 + +x, 0) : 0; const ip = k => [24, 16, 8, 0].map(s2 => Math.floor(k / 2 ** s2) % 256).join('.'); return { id: v.id, name: v.name, net: m ? m[1] : '', prefix: n ?? '', mask: n != null ? ip(2 ** 32 - size) : '', gw: v.gw || '', first: m && n < 31 ? ip(base + 1) : '', last: m && n < 31 ? ip(base + size - 2) : '', bcast: m ? ip(base + size - 1) : '', hosts: v.hosts ?? '' }; });
  const ipplan = { cols: [
    { key: 'id', name: H('VLAN ID', 'VLAN') }, { key: 'name', name: H('Name', 'Nom') }, { key: 'net', name: H('Network', 'Réseau') }, { key: 'prefix', name: H('Prefix', 'Préfixe') }, { key: 'mask', name: H('Subnet Mask', 'Masque') },
    { key: 'gw', name: H('Gateway', 'Passerelle') }, { key: 'first', name: H('First Host', 'Première adresse') }, { key: 'last', name: H('Last Host', 'Dernière adresse') }, { key: 'bcast', name: H('Broadcast', 'Diffusion') }, { key: 'hosts', name: H('Planned Hosts', 'Hôtes prévus') }
  ], rows: iprows };
  const labels = { cols: [{ key: r => (std ? r.kind : kindName(r.kind)), name: H('Object', 'Objet') }, { key: 'label', name: H('Label', 'Étiquette') }, { key: 'where', name: H('Location', 'Emplacement') }], rows: labelTable(data, { cables: false }) };
  return { cables, patching, bom: bomT, outlets, ipplan, labels };
}
const KINDS_EN = { horizontal: 'Permanent link', cord: 'Patch cord', backbone: 'Backbone', other: 'Other' };
const DEVICE_KEYS = new Set(Object.keys(DEVICES));
/**
 * Plan d'étage en SVG (modèle simplifié, pour l'impression) : pièces avec leur nom, murs, baies, prises avec leur
 * identifiant, points d'accès. Coordonnées en mètres ; échelle graphique. Rend '' si l'étage n'existe pas.
 */
export function floorSvg(data, floorId, o = {}) {
  const F = floorsOf(data).find(x => x.f.id === floorId); if (!F) return '';
  const f = F.f, L = labeler(data), pts = [];
  for (const r of f.rooms || []) for (const p of r.poly || []) pts.push(p);
  for (const w of f.walls || []) pts.push(w.a, w.b);
  const devs = (data.devices || []).filter(d => d.loc && d.loc.floor === floorId), racks = (data.racks || []).filter(r => r.floor === floorId);
  for (const d of devs) pts.push([d.loc.x, d.loc.y]); for (const r of racks) pts.push([r.x, r.y]);
  if (!pts.length) return '';
  const x0 = Math.min(...pts.map(p => p[0])) - 2, y0 = Math.min(...pts.map(p => p[1])) - 2, x1 = Math.max(...pts.map(p => p[0])) + 2, y1 = Math.max(...pts.map(p => p[1])) + 3;
  const W = x1 - x0, H = y1 - y0, fs = Math.max(0.28, Math.min(0.6, W / 90));
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${W} ${H}" width="${o.width || 1000}" height="${Math.round((o.width || 1000) * H / W)}" font-family="Helvetica, Arial, sans-serif">`, `<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="#fff"/>`];
  for (const r of f.rooms || []) {
    if (!(r.poly || []).length) continue;
    const c = roomPoint(r);
    out.push(`<path d="${roomPath(r)}" fill-rule="evenodd" fill="#f1f5f9" stroke="#94a3b8" stroke-width="${fs / 6}"/>`);
    out.push(`<text x="${c[0]}" y="${c[1]}" font-size="${fs * 1.1}" fill="#475569" text-anchor="middle">${esc(r.name || r.id)}</text>`);
  }
  for (const w of f.walls || []) out.push(`<line x1="${w.a[0]}" y1="${w.a[1]}" x2="${w.b[0]}" y2="${w.b[1]}" stroke="#334155" stroke-width="${Math.max(0.08, (+w.t || 100) / 1000)}" stroke-linecap="square"/>`);
  for (const r of racks) out.push(`<rect x="${r.x - 0.3}" y="${r.y - 0.4}" width="0.6" height="0.8" fill="#1e3a8a"/><text x="${r.x}" y="${r.y - 0.6}" font-size="${fs}" font-weight="bold" fill="#1e3a8a" text-anchor="middle">${esc(L.rack(r.id))}</text>`);
  for (const d of devs) {
    const x = d.loc.x, y = d.loc.y;
    if (isOutlet(d)) { const lab = L.of(d.id); out.push(`<rect x="${x - 0.18}" y="${y - 0.18}" width="0.36" height="0.36" fill="#2563eb" stroke="#fff" stroke-width="0.04"/>${o.labels === false ? '' : `<text x="${x + 0.3}" y="${y + fs * 0.35}" font-size="${fs * 0.8}" fill="#0f172a">${esc(lab)}</text>`}`); }
    else if (d.type === 'ap' || d.type === 'ap6' || d.type === 'ap6e') out.push(`<circle cx="${x}" cy="${y}" r="0.3" fill="#16a34a"/><text x="${x + 0.4}" y="${y + fs * 0.35}" font-size="${fs * 0.8}" fill="#166534">${esc(d.name)}</text>`);
    else out.push(`<circle cx="${x}" cy="${y}" r="0.2" fill="#64748b"/>`);
  }
  // Échelle graphique de 5 m.
  out.push(`<g transform="translate(${x0 + 1} ${y1 - 1})"><rect width="5" height="0.15" fill="#0f172a"/><text y="-0.25" font-size="${fs * 0.8}" fill="#0f172a">0</text><text x="5" y="-0.25" font-size="${fs * 0.8}" fill="#0f172a" text-anchor="end">5 m</text></g>`);
  out.push('</svg>');
  return out.join('');
}
/** Élévation d'une baie en SVG (face avant) : chaque unité numérotée, les équipements montés avec leur étiquette. */
export function rackSvg(data, rackId, o = {}) {
  const r = (data.racks || []).find(x => x.id === rackId); if (!r) return '';
  const L = labeler(data), U = +r.u || 42, uh = 16, w = o.width || 300, x0 = 26, h = U * uh + 40;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Helvetica, Arial, sans-serif">`, `<rect width="${w}" height="${h}" fill="#fff"/>`,
    `<text x="${w / 2}" y="14" font-size="12" font-weight="bold" text-anchor="middle" fill="#0f172a">${esc(L.rack(r.id))} · ${U} U</text>`,
    `<rect x="${x0}" y="24" width="${w - x0 - 6}" height="${U * uh}" fill="#f8fafc" stroke="#334155"/>`];
  for (let u = 1; u <= U; u++) { const y = 24 + (U - u) * uh; out.push(`<text x="${x0 - 4}" y="${y + uh - 4}" font-size="8" text-anchor="end" fill="#64748b">${u}</text><line x1="${x0}" y1="${y}" x2="${w - 6}" y2="${y}" stroke="#e2e8f0"/>`); }
  for (const d of data.devices || []) {
    if (!d.rack || d.rack.id !== rackId || (d.rack.face && d.rack.face !== 'front')) continue;
    const mu = mountOf(d.type).u, y = 24 + (U - (d.rack.u + mu - 1)) * uh, role = (specOf(d) || {}).role;
    if (!mu) continue; // PDU verticale (0 U)
    if (d.type === 'blank') { out.push(`<rect x="${x0 + 1}" y="${y + 1}" width="${w - x0 - 8}" height="${uh - 2}" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="0.5"/>`); continue; }
    const fill = isPanel(d) ? '#dbeafe' : role === 'switch' || role === 'router' ? '#1e293b' : role === 'mech' ? '#cbd5e1' : '#e2e8f0', ink = fill === '#1e293b' ? '#f8fafc' : '#0f172a';
    out.push(`<rect x="${x0 + 1}" y="${y + 1}" width="${w - x0 - 8}" height="${mu * uh - 2}" rx="2" fill="${fill}" stroke="#475569" stroke-width="0.6"/><text x="${x0 + 8}" y="${y + mu * uh / 2 + 4}" font-size="10" fill="${ink}">${esc(isPanel(d) ? L.of(d.id) : d.name)}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

/* ---------- Rapport imprimable ---------- */
/**
 * Rapport HTML complet (page autonome, fond blanc, A4) : page de garde (projet, client, site, auteur, date, révision),
 * synthèse du dimensionnement, plans d'étage, élévations de baies, tableaux (câbles, brassage, étiquettes), nomenclature
 * et chiffrage, plan d'adressage, tests, problèmes relevés. o : { dim (dimension()), issues ([{ code, text, kind }]),
 * patching (lignes), cert (html du rapport de tests ou ''), planSvg(data, floorId), rackSvg(data, rackId) (vues des
 * autres modules si elles existent, sinon celles d'ici), en (anglais), body (true : sans <html>, pour une zone
 * d'impression) }.
 */
export function reportHtml(data, o = {}) {
  const D = designOf(data), P = D.project, dim = o.dim, en = !!o.en, b = bom(data);
  const fsvg = o.planSvg || floorSvg, rsvg = o.rackSvg || rackSvg;
  const T = (cols, rows) => `<table><thead><tr>${cols.map(c => `<th${c.num ? ' class="n"' : ''}>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td${c.num ? ' class="n"' : ''}>${esc(typeof c.key === 'function' ? c.key(r) : r[c.key])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="e">${esc(tl('Rien à afficher.'))}</td></tr>`}</tbody></table>`;
  const sec = (title, html, brk = true) => `<section class="${brk ? 'pb' : ''}"><h2>${esc(title)}</h2>${html}</section>`;
  const title = P.site || data.site && data.site.name || tl('Projet réseau');
  const cover = `<section class="cover"><p class="k">${esc(tl('Dossier de câblage structuré'))}</p><h1>${esc(title)}</h1>
    <dl>${[[tl('Client'), P.client], [tl('Site'), P.site || (data.site && data.site.name)], [tl('Auteur'), P.author], [tl('Date'), P.date || new Date().toISOString().slice(0, 10)], [tl('Révision'), P.rev || '—']].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd>`).join('')}</dl>
    <p class="note">${esc(tl('Document produit par Jollof Studio à partir du modèle du projet. Les longueurs estimées et les modèles simplifiés sont signalés comme tels.'))}</p></section>`;
  const parts = [cover];
  if (dim) {
    const t = dim.totals;
    const kv = [[tl('Nombre de pièces'), t.rooms], [tl('Surface'), t.area + ' m²'], [tl('Postes de travail'), t.wa], [tl('Prises (ports)'), t.outlets], [tl('Ports de switch avec réserve'), t.ports], [tl('Panneaux de brassage'), t.panels], [tl('Switchs d’accès'), t.switches], [tl('Locaux techniques'), t.trs], [tl('Baies'), t.racks], [tl('PoE prévu'), t.poeW + ' W'], [tl('Câble cuivre'), t.cableM + ' m'], [tl('Tourets de {0} m', D.box), t.boxes], [tl('Brins de fibre'), t.fibreStrands], [tl('Surréservation maximale'), t.oversubMax + ':1']];
    parts.push(sec(tl('Synthèse du dimensionnement'), `<div class="kv">${kv.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
      <p class="note">${esc(tl('Densité : {0} m² par poste, {1} prises par poste ; réserve {2} % ; surréservation visée {3}:1.', D.area, D.outlets, D.spare, D.oversub))}${dim.trs.some(x => x.cable.est) ? ' ' + esc(tl('Longueurs de câble estimées (modèle simplifié) là où aucun câble n’est encore tracé.')) : ''}</p>
      ${T([{ name: tl('Local'), key: x => x.label || x.letter }, { name: tl('Étage'), key: 'floor' }, { name: tl('Prises'), key: 'outlets', num: 1 }, { name: tl('Ports'), key: 'ports', num: 1 }, { name: tl('Panneaux'), key: 'panels', num: 1 }, { name: tl('Switchs'), key: 'swN', num: 1 }, { name: 'PoE (W)', key: x => x.poe.need + ' / ' + (x.poe.budget || '—'), num: 1 }, { name: tl('Surréservation'), key: x => x.oversub + ':1', num: 1 }, { name: 'U', key: 'u', num: 1 }], dim.trs.map(x => ({ ...x, label: labeler(data).space(x.key) || x.letter, floor: floorName(data, x.floor) })))}`));
  }
  const floors = floorsOf(data);
  if (floors.length) parts.push(sec(tl('Plans d’étage'), floors.map(({ b: bd, f }) => { const s = fsvg(data, f.id, { width: 900 }); return s ? `<figure>${s}<figcaption>${esc((bd.name || bd.id) + ' · ' + (f.name || f.id))}</figcaption></figure>` : ''; }).join('')));
  if ((data.racks || []).length) parts.push(sec(tl('Élévations des baies'), `<div class="racks">${data.racks.map(r => `<figure>${rsvg(data, r.id, { width: 260 })}</figure>`).join('')}</div>`));
  const cs = cableSchedule(data);
  parts.push(sec(tl('Tableau des câbles'), T([{ name: tl('Étiquette'), key: 'label' }, { name: tl('De'), key: 'from' }, { name: tl('Vers'), key: 'to' }, { name: tl('Type'), key: 'type' }, { name: tl('Longueur (m)'), key: 'len', num: 1 }, { name: tl('Cheminements'), key: r => r.paths.join(' > ') }], cs)));
  const pr = o.patching || patchingRows(data, o.lan);
  if (pr.length) parts.push(sec(tl('Tableau de brassage'), T(PATCH_KEYS.map(k => ({ name: PATCH_COLS[k](), key: r => r[k] ?? '', num: /Len$/.test(k) })), pr)));
  const lt = labelTable(data).filter(r => r.kind !== 'cable');
  parts.push(sec(tl('Étiquettes'), T([{ name: tl('Objet'), key: r => KIND[r.kind] ? KIND[r.kind]() : r.kind }, { name: tl('Étiquette'), key: 'label' }, { name: tl('Emplacement'), key: 'where' }], lt)));
  const toFill = tl('à renseigner'), nUn = b.unpriced.length;
  parts.push(sec(tl('Nomenclature et chiffrage'), (nUn ? `<p class="warn">${esc(tl('Prix unitaires à renseigner : Jollof Studio ne fournit aucun prix. {0} ligne(s) sans prix ; le total ci-dessous est partiel.', nUn))}</p>` : '')
    + T([{ name: tl('Désignation'), key: 'name' }, { name: tl('Qté'), key: 'qty', num: 1 }, { name: tl('Unité'), key: 'unit' }, { name: tl('Prix unitaire'), key: r => (r.price ? money(r.price, b.currency, en) : toFill), num: 1 }, { name: tl('Total'), key: r => (r.price ? money(r.total, b.currency, en) : toFill), num: 1 }], b.lines)
    + `<p class="tot">${esc(nUn ? tl('Total partiel (hors lignes à renseigner)') : tl('Total'))} : <b>${esc(money(b.total, b.currency, en))}</b></p>`));
  if ((data.vlans || []).length) parts.push(sec(tl('Plan d’adressage'), T([{ name: 'VLAN', key: 'id', num: 1 }, { name: tl('Nom'), key: 'name' }, { name: tl('Réseau'), key: 'net' }, { name: tl('Passerelle'), key: 'gw' }, { name: tl('Hôtes prévus'), key: v => v.hosts ?? '', num: 1 }], data.vlans)));
  if (o.cert) parts.push(sec(tl('Tests de certification'), o.cert));
  if (o.issues && o.issues.length) parts.push(sec(tl('Problèmes relevés'), T([{ name: tl('Code'), key: 'code' }, { name: tl('Niveau'), key: i => (i.kind === 'err' ? tl('erreur') : tl('avertissement')) }, { name: tl('Description'), key: 'text' }], o.issues)));
  const css = `.ntRp{font:10pt/1.4 Helvetica,Arial,sans-serif;color:#0f172a;background:#fff;max-width:190mm;margin:0 auto}
.ntRp h1{font-size:26pt;margin:8mm 0 6mm}.ntRp h2{font-size:14pt;border-bottom:2px solid #1e3a8a;padding-bottom:2mm;margin:0 0 4mm;color:#1e3a8a}
.ntRp .cover{min-height:240mm;display:flex;flex-direction:column;justify-content:center;break-after:page;page-break-after:always}.ntRp .k{text-transform:uppercase;letter-spacing:.12em;color:#1e3a8a;font-weight:bold}
.ntRp dl{display:grid;grid-template-columns:40mm 1fr;gap:2mm 6mm;font-size:12pt}.ntRp dt{color:#475569}.ntRp dd{margin:0;font-weight:bold}
.ntRp section.pb{break-before:page;page-break-before:always}.ntRp table{width:100%;border-collapse:collapse;font-size:8.5pt;margin:2mm 0}
.ntRp th,.ntRp td{border:1px solid #cbd5e1;padding:1mm 1.5mm;text-align:left;vertical-align:top}.ntRp th{background:#e2e8f0}.ntRp td.n,.ntRp th.n{text-align:right}.ntRp td.e{color:#64748b;text-align:center}
.ntRp tr{break-inside:avoid}.ntRp .kv{display:grid;grid-template-columns:repeat(3,1fr);gap:2mm;margin-bottom:3mm}.ntRp .kv div{border:1px solid #cbd5e1;padding:2mm;border-radius:1mm}.ntRp .kv span{display:block;color:#475569;font-size:8pt}.ntRp .kv b{font-size:13pt}
.ntRp figure{margin:0 0 5mm;break-inside:avoid}.ntRp figure svg{width:100%!important;height:auto!important;display:block;break-after:auto!important;page-break-after:auto!important}.ntRp figcaption{text-align:center;color:#475569;font-size:9pt}
.ntRp .warn{border:1px solid #d97706;background:#fffbeb;color:#78350f;padding:2mm 3mm;border-radius:1mm}.ntRp .racks{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}.ntRp .note{color:#475569;font-size:8.5pt}.ntRp .tot{text-align:right;font-size:12pt}`;
  const body = `<style>${css}@page{size:A4;margin:14mm}</style><div class="ntRp">${parts.join('')}</div>`;
  if (o.body) return body;
  return `<!doctype html><html lang="${en ? 'en' : 'fr'}"><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fff">${body}</body></html>`;
}
const floorName = (data, id) => { const F = floorsOf(data).find(x => x.f.id === id); return F ? `${F.b.name || F.b.id} · ${F.f.name || F.f.id}` : id; };
const KIND = { space: () => tl('Local technique'), rack: () => tl('Baie'), panel: () => tl('Panneau'), outlet: () => tl('Port de prise'), cable: () => tl('Câble') };
export const kindName = k => (KIND[k] ? KIND[k]() : k);
const PATCH_COLS = { rack: () => tl('Baie'), panel: () => tl('Panneau'), port: () => tl('Identifiant'), device: () => tl('Équipement'), dport: () => tl('Port'), vlan: () => 'VLAN', outlet: () => tl('Prise'), oport: () => tl('Port de prise'), permLen: () => tl('Lien permanent (m)'), cordLen: () => tl('Cordon (m)'), len: () => tl('Longueur (m)') };
/** Colonnes du tableau de brassage (patchingRows). */
export const PATCH_KEYS = ['rack', 'panel', 'port', 'device', 'dport', 'vlan', 'outlet', 'oport', 'permLen', 'cordLen'];
export const patchColName = k => (PATCH_COLS[k] ? PATCH_COLS[k]() : k);
