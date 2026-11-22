// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Synchronisation avec un outil de documentation d'infrastructure (DCIM/IPAM : NetBox, plus tard Nautobot) : partie
// commune, pure, sans HTTP ni interface. Le projet devient un « modèle canonique » (objets à clé stable : site, lieux,
// fabricants, rôles, types, baies, VLAN, préfixes, équipements, ports, câbles, adresses) ; un adaptateur (netbox.js)
// traduit ce modèle vers son API et en lit les objets ; ce module apparie les deux côtés, calcule les différences
// (une ligne par objet et par champ), applique un envoi (créations, mises à jour, suppressions optionnelles, groupées,
// annulables) ou un import dans le projet.
//
// Objet canonique : { kind, key, label, f: { champ: valeur }, lvl? } ; une référence est { $: clé } (liste : [{ $ }]).
// Clés stables tirées des ids du projet : 'site', 'loc:<id>', 'mfr:<slug>', 'role:<slug>', 'dt:<slug>', 'rack:<id>',
// 'vlan:<vid>', 'pfx:<réseau>', 'dev:<id>', 'rp:<dev>:<port>', 'fp:<dev>:<port>', 'if:<dev>:<port>', 'cab:<id>',
// 'ip:<dev>:<interface>'. Côté serveur, un objet sans correspondance a la clé 'nb:<kind>:<id>'.
//
// Adaptateur A (voir netbox.js) : { name, KINDS ordre de dépendance, parse(kind, raw, refKey) → { f }, cfOf(raw) → clé
// | '', mine(raw) → bool, labelOf(kind, raw), payload(kind, obj, resolve, M, fields?) → { body } | { missing: clé },
// endpoint(kind), fetch(bridge, ours, o) → { raws: { kind: [] }, … }, components(bridge, kind, deviceIds) → [raw] }.
// bridge : { get(path, query, max) → { results }, write(method, path, body) → réponse } (Rust, ou faux serveur en test).
import { DEVICES, portsOf, newDevice } from '../devices.js';
import { MOUNT, mountDev } from '../rack.js';
import { makerOf, cableLabel } from '../docs.js';
import { portCfg, parseVlanList, vlansInUse, ifName, MANAGED } from '../vlan.js';
import { floorOf, roomAt, roomPoint, allFloors } from '../site.js';
import { newRack } from '../rack.js';
import { cleanNet } from '../clean.js';

export const KINDS = ['site', 'location', 'manufacturer', 'role', 'dtype', 'rack', 'vlan', 'prefix', 'device', 'rearport', 'frontport', 'interface', 'cable', 'ip'];
const R = key => ({ $: key });
const refOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? v.$ ?? null : null);
/** Identifiant d'URL (slug) : minuscules, chiffres, tirets ; accents retirés. */
export const slugify = (s, n = 100) => (String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/, '') || 'x');
const r2 = v => Math.round(v * 100) / 100;

/* ---------- Catalogue : type du projet → fabricant, modèle, rôle ---------- */
// Fabricant et référence : fiche qui a servi au modèle (rack.js MOUNT.ref, lue par docs.js makerOf) ; pour les types
// hors baie, la fiche citée dans devices.js ; sinon un modèle « générique ».
const EXTRA = { ap: ['TP-Link', 'EAP225'], ap6: ['TP-Link', 'EAP670'], ap6e: ['Ubiquiti', 'U6 Enterprise'], camera: ['Axis', 'M2035-LE'], phone: ['Cisco', 'IP Phone 7841'], outlet2: ['Leviton', '41080-2WP'] };
const GENERIC = { pc: 'Desktop PC', laptop: 'Laptop', printer: 'Network printer', router: 'Internet router (box)', outlet: 'RJ45 wall outlet', broker: 'MQTT broker', plc: 'Modbus TCP PLC', patch: '12-port patch panel' };
/** Rôles (noms anglais fixes : un serveur partagé n'a qu'une langue) : [slug, nom, couleur hex]. */
const ROLES = {
  switch: ['switch', 'Switch', '2563eb'], core: ['core-switch', 'Core switch', '1d4ed8'], router: ['router', 'Router', '7c3aed'], ap: ['access-point', 'Access point', '0891b2'],
  server: ['server', 'Server', '475569'], workstation: ['workstation', 'Workstation', '64748b'], printer: ['printer', 'Printer', '78716c'], camera: ['camera', 'IP camera', 'be123c'],
  phone: ['ip-phone', 'IP phone', '0d9488'], plc: ['plc', 'PLC', 'b45309'], patch: ['patch-panel', 'Patch panel', '6b7280'], outlet: ['wall-outlet', 'Wall outlet', '9ca3af'],
  accessory: ['rack-accessory', 'Rack accessory', 'a1a1aa'], power: ['power', 'Power', 'f59e0b'], media: ['media-converter', 'Media converter', '0ea5e9']
};
const ROLE_OF = {
  switch: 'switch', poeswitch: 'switch', switch24: 'switch', switch48: 'switch', l3switch: 'core', router: 'router', routerpro: 'router', ap: 'ap', ap6: 'ap', ap6e: 'ap',
  server: 'server', nas: 'server', broker: 'server', pc: 'workstation', laptop: 'workstation', printer: 'printer', camera: 'camera', phone: 'phone', plc: 'plc',
  patch: 'patch', patch24: 'patch', patch48: 'patch', fibrepanel: 'patch', outlet: 'outlet', outlet2: 'outlet', mediaconv: 'media', pdu: 'power', pdu1u: 'power', ups: 'power', ups3k: 'power', ebm: 'power', ebm3k: 'power'
};
/** Fiche d'un type : { maker, model, slug, mslug, u (hauteur en U, 0 hors baie ou sur tablette), role }. */
export function catalogue(type) {
  let maker, model;
  const mk = makerOf(type);
  if (mk.part) { maker = mk.maker === 'UniFi' ? 'Ubiquiti' : mk.maker || 'Generic'; model = mk.part; }
  else if (EXTRA[type]) [maker, model] = EXTRA[type];
  else { maker = 'Generic'; model = GENERIC[type] || 'Jollof ' + type; }
  const M = MOUNT[type], u = M && !M.shelf ? +M.u || 0 : 0;
  const generic = maker === 'Generic';
  return { maker, mslug: slugify(maker), model, slug: generic ? 'jollof-' + slugify(type) : slugify(maker + ' ' + model), u, role: ROLE_OF[type] || 'accessory' };
}
/** Fiche d'un équipement : son modèle réel du catalogue (fabricant, référence, hauteur de la fiche) ou celle de son type. */
export function catalogueDev(d) {
  const c = catalogue(d.type), m = d.model;
  if (!m) return c;
  const M = mountDev(d), maker = m.vendor, model = m.pn;
  return { ...c, maker, mslug: slugify(maker), model, slug: slugify(maker + ' ' + model), u: M && !M.shelf ? +M.u || 0 : 0 };
}
let REV = null;
/** Type du projet d'après le slug d'un type d'équipement (ceux que l'on a créés, ou d'une même fiche). */
export function typeOfSlug(slug) {
  if (!REV) { REV = new Map(); for (const t of Object.keys(DEVICES)) { const c = catalogue(t); if (!REV.has(c.slug)) REV.set(c.slug, t); } }
  return REV.get(String(slug || '')) || null;
}

/* ---------- Ports ---------- */
const IF_SPEED = { 100: '100base-tx', 1000: '1000base-t', 2500: '2.5gbase-t', 10000: '10gbase-t' };
/** Type d'interface (choix de NetBox, dcim/choices.py InterfaceTypeChoices) d'après la cage ou la vitesse RJ45. */
export const ifType = p => (p.sfp ? (p.sfp === 'sfp+' ? '10gbase-x-sfpp' : '1000base-x-sfp') : IF_SPEED[p.speed] || 'other');
/** Port passif : arrière (câble du bâtiment, « punch ») ou avant (cordon). */
const isRear = p => !!p.punch;
const passiveDev = d => DEVICES[d.type] && DEVICES[d.type].role === 'passive';
const activeDev = d => DEVICES[d.type] && DEVICES[d.type].role !== 'passive' && DEVICES[d.type].role !== 'mech';
/** Clé du point de raccordement d'un câble (interface, port avant ou arrière). */
export function termKey(d, pid) {
  if (!d) return null;
  if (passiveDev(d)) { const p = portsOf(d).find(x => x.id === pid); return p ? (isRear(p) ? 'rp:' : 'fp:') + d.id + ':' + pid : null; }
  return activeDev(d) ? 'if:' + d.id + ':' + pid : null;
}
/** Type de câble (CableTypeChoices) : catégorie cuivre ou fibre. */
const FIBRE_CABLE = { om1: 'mmf-om1', om2: 'mmf-om2', om3: 'mmf-om3', om4: 'mmf-om4', om5: 'mmf-om5', os1: 'smf-os1', os2: 'smf-os2' };
export const cableType = c => (c.media === 'fibre' ? FIBRE_CABLE[c.fibre] || 'mmf' : ['cat5e', 'cat6', 'cat6a'].includes(c.cat) ? c.cat : 'cat6');

/* ---------- Modèle canonique du projet ---------- */
/**
 * Modèle canonique : { objs: Map clé → objet, warnings: [texte] }. o.siteName : nom du site s'il manque au projet.
 * Les noms en double (deux baies « BAIE1 ») reçoivent un suffixe : le serveur exige des noms uniques par lieu.
 */
export function ourModel(data, o = {}) {
  const objs = new Map(), warnings = [];
  const add = (kind, key, label, f, extra) => { const x = { kind, key, label, f, ...extra }; objs.set(key, x); return x; };
  const devs = new Map((data.devices || []).map(d => [d.id, d]));
  const siteName = String((data.site && data.site.name) || o.siteName || 'Jollof').trim().slice(0, 100);
  add('site', 'site', siteName, { name: siteName, slug: slugify(siteName), status: 'active' });

  // Lieux : bâtiment → étage → pièce (noms uniques sous un même parent).
  const roomsOf = new Map();
  const uniq = (set, name) => { let n = name, i = 2; while (set.has(n.toLowerCase())) n = `${name} (${i++})`; set.add(n.toLowerCase()); return n; };
  const top = new Set();
  for (const b of (data.site && data.site.buildings) || []) {
    const bn = uniq(top, b.name || b.id);
    add('location', 'loc:' + b.id, bn, { name: bn, slug: slugify(bn), parent: null, site: R('site'), status: 'active' }, { lvl: 'building' });
    const fl = new Set();
    for (const f of b.floors || []) {
      const fn = uniq(fl, f.name || f.id);
      add('location', 'loc:' + f.id, `${bn} / ${fn}`, { name: fn, slug: slugify(bn + ' ' + fn), parent: R('loc:' + b.id), site: R('site'), status: 'active' }, { lvl: 'floor' });
      const rn = new Set();
      for (const r of f.rooms || []) {
        const nm = uniq(rn, r.name || r.id);
        add('location', 'loc:' + r.id, `${bn} / ${fn} / ${nm}`, { name: nm, slug: slugify(`${bn} ${fn} ${nm}`), parent: R('loc:' + f.id), site: R('site'), status: 'active' }, { lvl: 'room' });
        roomsOf.set(r.id, f.id);
      }
    }
  }
  const locOf = (floor, room) => (room && objs.has('loc:' + room) ? R('loc:' + room) : floor && objs.has('loc:' + floor) ? R('loc:' + floor) : null);

  // Baies.
  const rackNames = new Set(), rackLoc = new Map();
  for (const r of data.racks || []) {
    const name = uniq(rackNames, r.name || r.id), loc = locOf(r.floor, r.room);
    rackLoc.set(r.id, loc);
    add('rack', 'rack:' + r.id, name, { name, site: R('site'), location: loc, u_height: r.u, width: 19, form_factor: r.kind === 'wall' ? 'wall-cabinet' : '4-post-cabinet', outer_width: r.w, outer_depth: r.d, outer_unit: 'mm', status: 'active' });
  }

  // VLAN (base du projet et VLAN utilisés sur les ports) et leurs préfixes.
  const vlanDb = new Map((data.vlans || []).map(v => [v.id, v]));
  const used = vlansInUse(data);
  for (const vid of [...new Set([...vlanDb.keys(), ...used])].sort((a, b) => a - b)) {
    const v = vlanDb.get(vid), name = (v && v.name) || (vid === 1 ? 'default' : 'VLAN' + vid);
    add('vlan', 'vlan:' + vid, `VLAN ${vid} ${name}`, { vid, name: name.slice(0, 64), site: R('site'), status: 'active' });
    if (v && v.net) add('prefix', 'pfx:' + v.net, v.net, { prefix: v.net, vlan: R('vlan:' + vid), scope: R('site'), status: 'active', description: name.slice(0, 200) });
  }
  const vref = vid => (objs.has('vlan:' + vid) ? R('vlan:' + vid) : null);

  // Fabricants, rôles, types : seulement ceux des équipements du projet.
  const devNames = new Set();
  for (const d of data.devices || []) {
    const spec = DEVICES[d.type]; if (!spec) continue;
    const c = catalogueDev(d), [rslug, rname, color] = ROLES[c.role];
    if (!objs.has('mfr:' + c.mslug)) add('manufacturer', 'mfr:' + c.mslug, c.maker, { name: c.maker, slug: c.mslug });
    if (!objs.has('role:' + rslug)) add('role', 'role:' + rslug, rname, { name: rname, slug: rslug, color });
    if (!objs.has('dt:' + c.slug)) add('dtype', 'dt:' + c.slug, `${c.maker} ${c.model}`, { manufacturer: R('mfr:' + c.mslug), model: c.model, slug: c.slug, u_height: c.u, is_full_depth: false });
    // Équipement : en baie (lieu de la baie), sinon dans la pièce (ou l'étage) où il est posé.
    let location = null, rack = null, position = null, face = null;
    if (d.rack && objs.has('rack:' + d.rack.id)) {
      rack = R('rack:' + d.rack.id); location = rackLoc.get(d.rack.id) || null;
      if (c.u > 0) { position = d.rack.u; face = d.rack.face || 'front'; } else face = null;
    } else if (d.loc) {
      const F = floorOf(data.site, d.loc.floor), rm = F && roomAt(F.f, d.loc.x, d.loc.y);
      location = locOf(d.loc.floor, rm && rm.id);
    }
    const name = uniq(devNames, d.name || d.id);
    add('device', 'dev:' + d.id, name, { name, device_type: R('dt:' + c.slug), role: R('role:' + rslug), site: R('site'), location, rack, position, face, status: 'active' });

    // Ports.
    if (spec.role === 'passive') {
      for (const p of portsOf(d)) {
        const t = p.fibre ? 'lc' : '8p8c';
        if (isRear(p)) add('rearport', `rp:${d.id}:${p.id}`, `${name} ${p.id}`, { device: R('dev:' + d.id), name: p.id, label: String(p.label || ''), type: t, positions: 1 });
      }
      for (const p of portsOf(d)) {
        if (isRear(p)) continue;
        const t = p.fibre ? 'lc' : '8p8c';
        add('frontport', `fp:${d.id}:${p.id}`, `${name} ${p.id}`, { device: R('dev:' + d.id), name: p.id, label: String(p.label || ''), type: t, rear_port: p.passive ? R(`rp:${d.id}:${p.passive}`) : null, rear_pos: 1 });
      }
    } else if (spec.role !== 'mech') {
      const managed = MANAGED.has(d.type);
      for (const p of portsOf(d)) {
        const f = { device: R('dev:' + d.id), name: p.id, label: String(p.label || ''), type: ifType(p), enabled: true, mode: '', untagged_vlan: null, tagged_vlans: [] };
        if (managed) {
          const cfg = portCfg(d, p.id);
          f.enabled = !cfg.shut;
          if (cfg.mode === 'trunk') {
            const l = parseVlanList(cfg.allowed);
            f.mode = l.all ? 'tagged-all' : 'tagged'; f.untagged_vlan = vref(cfg.native);
            if (!l.all) f.tagged_vlans = [...l.set].filter(v => v !== cfg.native && objs.has('vlan:' + v)).sort((a, b) => a - b).map(v => R('vlan:' + v));
          } else { f.mode = 'access'; f.untagged_vlan = vref(cfg.vlan); }
        }
        add('interface', `if:${d.id}:${p.id}`, `${name} ${p.id}`, f);
      }
      // Interfaces de niveau 3 : SVI d'un switch L3, sous-interfaces 802.1Q d'un routeur (virtuelles).
      const virt = (nm, parent) => add('interface', `if:${d.id}:${nm}`, `${name} ${nm}`, { device: R('dev:' + d.id), name: nm, label: '', type: 'virtual', enabled: true, mode: '', untagged_vlan: null, tagged_vlans: [], parent });
      for (const s of (d.p && d.p.svis) || []) virt('vlan' + s.vlan, null);
      for (const x of (d.p && d.p.ifs) || []) if (x.vlan) virt(ifName(x), R(`if:${d.id}:${x.port}`));
      // Adresses fixes.
      const ip = (nm, addr, pfx) => { if (addr && objs.has(`if:${d.id}:${nm}`)) add('ip', `ip:${d.id}:${nm}`, `${addr}/${pfx}`, { address: `${addr}/${pfx}`, iface: R(`if:${d.id}:${nm}`), status: 'active' }); };
      const P = d.p || {};
      if (P.ip && P.ip.mode === 'static') ip(portsOf(d)[0] && portsOf(d)[0].id, P.ip.ip, P.ip.prefix);
      for (const s of P.svis || []) ip('vlan' + s.vlan, s.ip, s.prefix);
      for (const x of P.ifs || []) if (x.mode === 'static') ip(ifName(x), x.ip, x.prefix);
    }
  }

  // Câbles (extrémités : interface, port avant ou arrière ; les nœuds du montage électronique ne sont pas envoyés).
  let skipped = 0;
  for (const c of data.cables || []) {
    const a = termKey(devs.get(c.a[0]), c.a[1]), b = termKey(devs.get(c.b[0]), c.b[1]);
    if (!a || !b || !objs.has(a) || !objs.has(b)) { skipped++; continue; }
    const color = typeof c.color === 'string' && /^#?[0-9a-f]{6}$/i.test(c.color) ? c.color.replace('#', '').toLowerCase() : '';
    const label = String(cableLabel(data, c) || c.tag || c.id).slice(0, 100);
    add('cable', 'cab:' + c.id, label, { ends: [R(a), R(b)], type: cableType(c), length: r2(c.len), length_unit: 'm', color, label, status: 'connected' });
  }
  if (skipped) warnings.push({ code: 'cableSkip', n: skipped });
  return { objs, warnings };
}

/* ---------- Comparaison ---------- */
/** Valeur comparable : vide = null, nombres arrondis au centième, listes triées, références par clé. */
export function norm(v) {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) { const a = v.map(norm).filter(x => x != null).map(String).sort(); return a.length ? a.join('|') : null; }
  if (typeof v === 'object') return refOf(v) ?? JSON.stringify(v);
  if (typeof v === 'number') return String(r2(v));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v).trim(), n = Number(s);
  return s !== '' && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(s) ? String(r2(n)) : s;
}
/** Clé naturelle d'un objet (références déjà traduites en clés) : correspondance sans champ personnalisé. */
export function natKey(kind, f) {
  const k = x => refOf(x) || '', low = s => String(s ?? '').trim().toLowerCase();
  switch (kind) {
    case 'site': case 'manufacturer': case 'role': case 'dtype': return low(f.slug);
    case 'location': return `${k(f.parent)}|${low(f.name)}`;
    case 'rack': case 'device': return low(f.name);
    case 'vlan': return String(f.vid);
    case 'prefix': return low(f.prefix);
    case 'rearport': case 'frontport': case 'interface': return `${k(f.device)}|${low(f.name)}`;
    case 'cable': return (f.ends || []).map(k).sort().join('|');
    case 'ip': return low(f.address);
    default: return '';
  }
}
/** Champs propres au projet que l'on ne demande pas au serveur de reprendre en import (lecture seule de ce côté). */
const PULL_FIELDS = {
  location: ['name'], rack: ['name', 'u_height'], device: ['name', 'position', 'face'], vlan: ['name'], prefix: ['prefix'],
  cable: ['type', 'length', 'label'], interface: ['mode', 'untagged_vlan', 'tagged_vlans', 'enabled'], ip: ['address'], site: ['name']
};

/**
 * Appariement : raws { kind: [objets du serveur] } → { theirs: Map clé → { kind, key, id, label, f, mine }, keyId, idKey }.
 * Ordre : champ personnalisé (clé stable), sinon clé naturelle ; o.siteId force le site choisi.
 */
export function match(A, ours, raws, o = {}) {
  const theirs = new Map(), keyId = new Map(), idKey = new Map(), taken = new Set();
  const nat = new Map();
  for (const x of ours.objs.values()) { const n = natKey(x.kind, x.f); if (n) nat.set(x.kind + '#' + n, x.key); }
  const refKey = (kind, id) => (id == null ? null : idKey.get(kind + ':' + id) || 'nb:' + kind + ':' + id);
  for (const kind of A.KINDS) {
    let list = (raws[kind] || []).slice();
    if (A.order) list = A.order(kind, list);
    for (const raw of list) {
      if (!raw || raw.id == null) continue;
      const t = A.parse(kind, raw, refKey); if (!t) continue;
      const cf = A.cfOf(raw);
      let key = null;
      if (kind === 'site' && o.siteId != null && raw.id === o.siteId) key = 'site';
      else if (cf && ours.objs.has(cf) && ours.objs.get(cf).kind === kind && !taken.has(cf)) key = cf;
      else { const k = nat.get(kind + '#' + natKey(kind, t.f)); if (k && !taken.has(k) && !(kind === 'site' && o.siteId != null)) key = k; }
      if (!key) key = cf && !taken.has(cf) && !ours.objs.has(cf) ? cf : 'nb:' + kind + ':' + raw.id;
      taken.add(key); idKey.set(kind + ':' + raw.id, key); keyId.set(key, raw.id);
      theirs.set(key, { kind, key, id: raw.id, label: A.labelOf(kind, raw), f: t.f, mine: !!cf || !!A.mine(raw) });
    }
  }
  return { theirs, keyId, idKey };
}

/**
 * Différences, une ligne par objet et par champ :
 *   { rid, kind, key, label, field, ours, theirs (valeurs brutes), op: 'create'|'update'|'delete'|'import', accept }.
 * dir 'push' : créations (objets absents du serveur), mises à jour (champs différents), suppressions (o.deletes : objets
 * créés par nous sur le serveur et retirés du projet ; jamais cochées d'avance). dir 'pull' : objets du serveur absents
 * du projet (import), champs différents repris du serveur (ceux que le projet sait recevoir).
 */
export function diff(ours, M, o = {}) {
  const rows = [], dir = o.dir || 'push';
  const push = (x, field, a, b, op, accept = true) => rows.push({ rid: x.key + '#' + field, kind: x.kind, key: x.key, label: x.label, field, ours: a, theirs: b, op, accept });
  if (dir === 'push') {
    for (const x of ours.objs.values()) {
      const t = M.theirs.get(x.key);
      if (!t) { push(x, '', x.f, null, 'create'); continue; }
      for (const [k, v] of Object.entries(x.f)) {
        if (k === 'slug' && (x.kind === 'location' || x.kind === 'site')) continue; // le slug d'un objet apparié reste le sien
        if (!(k in t.f)) continue;
        if (norm(v) !== norm(t.f[k])) push(x, k, v, t.f[k], 'update');
      }
    }
    if (o.deletes) for (const t of M.theirs.values()) if (!ours.objs.has(t.key) && t.mine && t.kind !== 'site') push(t, '', null, t.f, 'delete', false);
  } else {
    for (const t of M.theirs.values()) {
      const x = ours.objs.get(t.key);
      if (!x) { if (!['manufacturer', 'role', 'dtype'].includes(t.kind)) push(t, '', null, t.f, 'import'); continue; }
      for (const k of PULL_FIELDS[x.kind] || []) if (k in t.f && norm(x.f[k]) !== norm(t.f[k])) push(x, k, x.f[k], t.f[k], 'update');
    }
  }
  const rank = new Map(KINDS.map((k, i) => [k, i]));
  return rows.sort((a, b) => (rank.get(a.kind) - rank.get(b.kind)) || (a.op === 'delete') - (b.op === 'delete') || String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
}
/** Comptes par opération (lignes cochées) : { create, update, delete, import, objects }. */
export function counts(rows) {
  const c = { create: 0, update: 0, delete: 0, import: 0, objects: 0 }, seen = new Set();
  for (const r of rows) if (r.accept) { c[r.op]++; if (!seen.has(r.key)) { seen.add(r.key); c.objects++; } }
  return c;
}

/* ---------- Envoi ---------- */
const CHUNK = 50;
const abortErr = () => { const e = new Error('Annulé'); e.name = 'AbortError'; return e; };
/**
 * Applique les lignes cochées d'un envoi. o : { signal, progress(f, texte), meta (champ personnalisé, étiquette : voir
 * netbox.js ensureMeta) }. Créations groupées par paquets de 50 (en cas de refus, objet par objet pour isoler l'erreur),
 * dans l'ordre des dépendances ; les références vers un objet non créé font sauter l'objet (erreur « dépend de »).
 * Rend { created, updated, deleted, errors: [{ key, label, message, fields }] }.
 */
export async function applyPush(A, bridge, rows, ours, M, o = {}) {
  const out = { created: 0, updated: 0, deleted: 0, errors: [] };
  const sel = rows.filter(r => r.accept);
  const creates = new Set(sel.filter(r => r.op === 'create').map(r => r.key));
  const updates = new Map(); for (const r of sel) if (r.op === 'update') { if (!updates.has(r.key)) updates.set(r.key, []); updates.get(r.key).push(r.field); }
  const deletes = sel.filter(r => r.op === 'delete');
  const total = Math.max(1, creates.size + updates.size + deletes.length);
  let done = 0;
  const step = n => { done += n; if (o.progress) o.progress(done / total); };
  const check = () => { if (o.signal && o.signal.aborted) throw abortErr(); };
  const resolve = key => M.keyId.get(key);
  const fail = (x, e) => out.errors.push({ key: x.key, kind: x.kind, label: x.label, message: (e && e.message) || String(e), fields: (e && e.fields) || [] });
  const newDevices = [];

  async function send(method, kind, items, done1) {
    // items : [{ x, body }] ; groupé, puis un par un si le paquet est refusé (écriture « tout ou rien » côté serveur).
    for (let i = 0; i < items.length; i += CHUNK) {
      check();
      const part = items.slice(i, i + CHUNK);
      try {
        const res = await bridge.write(method, A.endpoint(kind), part.map(p => p.body));
        part.forEach((p, j) => done1(p, Array.isArray(res) ? res[j] : null));
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        if (part.length === 1 || !(e && (e.kind === 'invalid' || e.status === 400))) {
          if (part.length === 1) { fail(part[0].x, e); continue; }
          if (e && (e.kind === 'auth' || e.kind === 'net' || e.kind === 'tls' || e.kind === 'timeout' || e.kind === 'cancel')) throw e;
        }
        for (const p of part) {
          check();
          try { const res = await bridge.write(method, A.endpoint(kind), [p.body]); done1(p, Array.isArray(res) ? res[0] : res); } catch (e2) { if (e2 && e2.name === 'AbortError') throw e2; fail(p.x, e2); }
        }
      }
      step(part.length);
    }
  }

  for (const kind of A.KINDS) {
    check();
    // Composants créés d'office par le serveur (modèles du type d'équipement) : repris par leur nom, mis à jour.
    if (['rearport', 'frontport', 'interface'].includes(kind) && newDevices.length && A.components) {
      const found = await A.components(bridge, kind, newDevices);
      for (const raw of found) {
        const t = A.parse(kind, raw, (k, id) => M.idKey.get(k + ':' + id) || 'nb:' + k + ':' + id);
        const key = [...creates].find(k => ours.objs.get(k).kind === kind && natKey(kind, ours.objs.get(k).f) === natKey(kind, t.f));
        if (!key) continue;
        creates.delete(key); M.keyId.set(key, raw.id); M.idKey.set(kind + ':' + raw.id, key);
        updates.set(key, Object.keys(ours.objs.get(key).f));
      }
    }
    // Créations, par vagues : un lieu attend son parent, une interface virtuelle son interface parente.
    let pending = [...creates].filter(k => ours.objs.get(k).kind === kind).map(k => ours.objs.get(k));
    const dep = p => `dépend de « ${(ours.objs.get(p.missing) || {}).label || p.missing} », qui n’existe pas sur le serveur`;
    while (pending.length) {
      const waiting = new Set(pending.map(x => x.key)), items = [], later = [];
      for (const x of pending) {
        const p = A.payload(kind, x, resolve, o.meta || {});
        if (p.missing && waiting.has(p.missing)) { later.push(x); continue; }
        if (p.missing) { fail(x, { message: dep(p) }); step(1); continue; }
        items.push({ x, body: p.body });
      }
      if (!items.length) { for (const x of later) { fail(x, { message: dep(A.payload(kind, x, resolve, o.meta || {})) }); step(1); } break; }
      await send('POST', kind, items, (p, res) => {
        if (!res || res.id == null) { fail(p.x, { message: 'réponse sans identifiant' }); return; }
        M.keyId.set(p.x.key, res.id); M.idKey.set(kind + ':' + res.id, p.x.key); out.created++;
        if (kind === 'device') newDevices.push(res.id);
      });
      pending = later;
    }
    // Mises à jour (champs cochés seulement).
    const items = [];
    for (const [key, fields] of updates) {
      const x = ours.objs.get(key); if (!x || x.kind !== kind) continue;
      const id = M.keyId.get(key); if (id == null) continue;
      const p = A.payload(kind, x, resolve, o.meta || {}, fields);
      if (p.missing) { fail(x, { message: `dépend de « ${(ours.objs.get(p.missing) || {}).label || p.missing} », qui n’existe pas sur le serveur` }); step(1); continue; }
      items.push({ x, body: { id, ...p.body } });
    }
    await send('PATCH', kind, items, () => { out.updated++; });
  }
  // Suppressions : dans l'ordre inverse des dépendances (câbles avant ports, ports avant équipements…).
  for (const kind of [...A.KINDS].reverse()) {
    const items = deletes.filter(r => r.kind === kind && M.keyId.get(r.key) != null).map(r => ({ x: { key: r.key, kind, label: r.label }, body: { id: M.keyId.get(r.key) } }));
    await send('DELETE', kind, items, () => { out.deleted++; });
  }
  if (o.progress) o.progress(1);
  return out;
}

/* ---------- Import dans le projet ---------- */
/** Type du projet pour un équipement du serveur : par son type (créé par nous), sinon d'après son rôle et ses ports. */
export function guessType(dt, roleSlug, ports) {
  const t = dt && typeOfSlug(dt.slug); if (t) return t;
  const r = String(roleSlug || '').toLowerCase(), nIf = ports.interfaces.filter(p => p.type !== 'virtual').length, nFront = ports.front.length;
  if (!nIf && (nFront || ports.rear.length)) {
    if (ports.front.some(p => /^(lc|sc|st|fc|mpo|mtrj|cs|sn|mdc|mu|lsh|lx5)/.test(String(p.type)))) return 'fibrepanel';
    return /outlet|prise|wall/.test(r) || nFront <= 2 ? (nFront <= 1 ? 'outlet' : 'outlet2') : nFront <= 12 ? 'patch' : nFront <= 24 ? 'patch24' : 'patch48';
  }
  if (/core|l3|distribution|aggregation/.test(r) || ports.interfaces.some(p => /^vlan\d+$/i.test(p.name))) return 'l3switch';
  if (/switch/.test(r) || nIf >= 9) return nIf > 28 ? 'switch48' : nIf > 8 ? 'switch24' : 'switch';
  if (/router|firewall|gateway/.test(r)) return 'routerpro';
  if (/access-point|wireless|wifi|\bap\b/.test(r)) return 'ap';
  if (/server|storage|nas|hypervisor/.test(r)) return 'server';
  if (/printer/.test(r)) return 'printer';
  if (/camera/.test(r)) return 'camera';
  if (/phone/.test(r)) return 'phone';
  if (/plc|automate/.test(r)) return 'plc';
  if (/pdu|power/.test(r)) return 'pdu';
  if (/ups|onduleur/.test(r)) return 'ups';
  return 'pc';
}
const idOfKey = key => String(key).split(':').slice(1).join(':');
const lenM = (v, u) => { const k = { km: 1000, m: 1, cm: 0.01, mi: 1609.344, ft: 0.3048, in: 0.0254 }[u || 'm'] || 1; return Number.isFinite(+v) && +v > 0 ? +v * k : null; };
const catOf = t => { const s = String(t || ''); if (/^mmf-(om\d)/.test(s)) return { media: 'fibre', fibre: s.slice(4) }; if (/^smf-(os\d)/.test(s)) return { media: 'fibre', fibre: s.slice(4) }; if (s === 'mmf') return { media: 'fibre', fibre: 'om4' }; if (s === 'smf') return { media: 'fibre', fibre: 'os2' }; return { cat: ['cat5e', 'cat6', 'cat6a'].includes(s) ? s : s === 'cat7' || s === 'cat7a' || s === 'cat8' ? 'cat6a' : 'cat6' }; };

/**
 * Applique les lignes cochées d'un import au projet (data muté puis nettoyé par cleanNet, identité de data gardée).
 * Rend { created: { kind: n }, updated, skipped: [{ label, why }], notes: [codes] }. Pièces importées sans géométrie :
 * carrés de 4 m rangés sur l'étage (à redessiner) ; équipements hors baie sans pièce : seulement au schéma logique.
 */
export function applyPull(data, rows, ours, M) {
  const out = { created: {}, updated: 0, skipped: [], notes: [] };
  const sel = rows.filter(r => r.accept), T = M.theirs;
  const inc = k => { out.created[k] = (out.created[k] || 0) + 1; };
  data.site = data.site || { name: '', buildings: [] }; data.site.buildings = data.site.buildings || [];
  data.devices = data.devices || []; data.cables = data.cables || []; data.racks = data.racks || []; data.vlans = data.vlans || [];
  const devById = new Map(data.devices.map(d => [d.id, d]));
  const usedIds = new Set([...devById.keys(), ...data.cables.map(c => c.id), ...data.racks.map(r => r.id)]);
  for (const { b, f } of allFloors(data.site)) { usedIds.add(b.id); usedIds.add(f.id); for (const r of f.rooms) usedIds.add(r.id); }
  const fresh = (want, pre) => { let id = /^[\w.:-]{1,40}$/.test(want || '') && !usedIds.has(want) ? want : ''; let i = 1; while (!id || usedIds.has(id)) id = pre + i++; usedIds.add(id); return id; };
  const made = new Map(); // clé → id du projet (lieux, baies, équipements) ou [dev, port]
  const idOf = key => (made.has(key) ? made.get(key) : ours.objs.has(key) ? (key.startsWith('vlan:') ? +idOfKey(key) : idOfKey(key)) : null);
  const want = key => (key && !key.startsWith('nb:') ? idOfKey(key) : '');
  const keysOf = new Set(sel.filter(r => r.op === 'import').map(r => r.key));
  const byKind = kind => [...keysOf].map(k => T.get(k)).filter(t => t && t.kind === kind);

  // Lieux : profondeur d'après la chaîne des parents (racine : bâtiment ; puis étage ; au-delà : pièce).
  const lvlOf = key => { if (ours.objs.has(key)) return ours.objs.get(key).lvl; let n = 0, k = key; while (k && T.get(k) && refOf(T.get(k).f.parent)) { k = refOf(T.get(k).f.parent); n++; if (ours.objs.has(k)) { n += { building: 0, floor: 1, room: 2 }[ours.objs.get(k).lvl] || 0; break; } } return ['building', 'floor', 'room'][Math.min(2, n)]; };
  const findLoc = id => { for (const b of data.site.buildings) { if (b.id === id) return { kind: 'building', o: b }; for (const f of b.floors) { if (f.id === id) return { kind: 'floor', o: f, b }; for (const r of f.rooms) if (r.id === id) return { kind: 'room', o: r, f, b }; } } return null; };
  const floorFor = key => { let k = key; for (let i = 0; k && i < 20; i++) { const L = findLoc(idOf(k)); if (L && L.kind === 'floor') return L.o; if (L && L.kind === 'room') return L.f; const t = T.get(k); k = t ? refOf(t.f.parent) : null; } return null; };
  const locs = byKind('location');
  for (let pass = 0; pass < 6 && locs.length; pass++) {
    for (let i = 0; i < locs.length; i++) {
      const t = locs[i], pk = refOf(t.f.parent), lvl = lvlOf(t.key);
      if (pk && idOf(pk) == null && keysOf.has(pk)) continue; // parent pas encore créé
      const name = String(t.f.name || '').slice(0, 40);
      if (lvl === 'building' || !pk) { const id = fresh(want(t.key), 'B'); data.site.buildings.push({ id, name, x: 0, y: 0, floors: [] }); made.set(t.key, id); inc('location'); }
      else if (lvl === 'floor') {
        const P = findLoc(idOf(pk)); if (!P || P.kind !== 'building') { out.skipped.push({ label: t.label, why: 'parent' }); locs.splice(i--, 1); continue; }
        const level = P.o.floors.length, id = fresh(want(t.key), 'F');
        P.o.floors.push({ id, name, level, elev: level * 3.5, height: 3.5, ceil: 2.7, plenum: 0.6, raised: 0, walls: [], doors: [], rooms: [] }); made.set(t.key, id); inc('location');
      } else {
        const F = floorFor(pk); if (!F) { out.skipped.push({ label: t.label, why: 'parent' }); locs.splice(i--, 1); continue; }
        const P = findLoc(idOf(pk)), full = P && P.kind === 'room' ? `${P.o.name} / ${name}`.slice(0, 40) : name;
        const n = F.rooms.length, x0 = 1 + (n % 8) * 5, y0 = 1 + Math.floor(n / 8) * 5, id = fresh(want(t.key), 'rm');
        F.rooms.push({ id, name: full, usage: 'office', poly: [[x0, y0], [x0 + 4, y0], [x0 + 4, y0 + 4], [x0, y0 + 4]] }); made.set(t.key, id); inc('location');
        if (!out.notes.includes('roomsNoGeometry')) out.notes.push('roomsNoGeometry');
      }
      locs.splice(i--, 1);
    }
  }
  for (const t of locs) out.skipped.push({ label: t.label, why: 'parent' });
  const placeIn = key => { const L = key && findLoc(idOf(key)); if (!L) return null; if (L.kind === 'room') { const p = roomPoint(L.o); return { floor: L.f.id, room: L.o.id, x: p[0], y: p[1] }; } if (L.kind === 'floor') return { floor: L.o.id, room: '', x: 1, y: 1 }; return null; };

  // Baies.
  for (const t of byKind('rack')) {
    const at = placeIn(refOf(t.f.location)), kind = /^wall/.test(String(t.f.form_factor || '')) ? 'wall' : 'floor';
    const r = newRack(data, kind, { id: fresh(want(t.key), 'rk'), name: String(t.f.name || '').slice(0, 24), u: t.f.u_height || undefined, ...(t.f.outer_unit === 'mm' && t.f.outer_width ? { w: t.f.outer_width } : {}), ...(t.f.outer_unit === 'mm' && t.f.outer_depth ? { d: t.f.outer_depth } : {}), ...(at ? { floor: at.floor, room: at.room, x: at.x, y: at.y } : {}) });
    data.racks.push(r); made.set(t.key, r.id); inc('rack');
  }
  // VLAN, puis leurs préfixes.
  const vlanByKey = key => { const id = idOf(key) ?? (T.get(key) && T.get(key).f.vid); return data.vlans.find(v => v.id === +id) || null; };
  for (const t of byKind('vlan')) { if (data.vlans.some(v => v.id === +t.f.vid)) { made.set(t.key, +t.f.vid); continue; } data.vlans.push({ id: +t.f.vid, name: String(t.f.name || '').slice(0, 32), net: '', gw: '' }); made.set(t.key, +t.f.vid); inc('vlan'); }
  for (const t of byKind('prefix')) { const v = refOf(t.f.vlan) && vlanByKey(refOf(t.f.vlan)); if (!v) { out.skipped.push({ label: t.label, why: 'noVlan' }); continue; } if (!v.net) { v.net = t.f.prefix; inc('prefix'); } }

  // Équipements : ports du serveur regroupés par équipement (pour deviner le type et faire correspondre les ports).
  const portsBy = new Map();
  for (const t of T.values()) if (['interface', 'frontport', 'rearport'].includes(t.kind)) {
    const dk = refOf(t.f.device); if (!portsBy.has(dk)) portsBy.set(dk, { interfaces: [], front: [], rear: [] });
    portsBy.get(dk)[t.kind === 'interface' ? 'interfaces' : t.kind === 'frontport' ? 'front' : 'rear'].push({ key: t.key, name: String(t.f.name || ''), type: t.f.type });
  }
  const used = new Set(data.devices.map(d => d.name));
  const maxY = data.devices.reduce((m, d) => Math.max(m, d.y || 0), 0);
  const portMap = new Map(); // clé de port du serveur → [dev, port]
  let n = 0;
  for (const t of byKind('device')) {
    const ports = portsBy.get(t.key) || { interfaces: [], front: [], rear: [] };
    const dt = T.get(refOf(t.f.device_type)) || ours.objs.get(refOf(t.f.device_type));
    const role = T.get(refOf(t.f.role)) || ours.objs.get(refOf(t.f.role));
    const type = guessType(dt && dt.f, role && role.f.slug, ports);
    const d = newDevice(type, used, { x: 120 + (n % 10) * 190, y: maxY + 160 + Math.floor(n / 10) * 130 }); n++;
    d.id = fresh(want(t.key), 'n'); d.name = String(t.f.name || d.name).slice(0, 24); used.add(d.name);
    const rk = refOf(t.f.rack) && idOf(refOf(t.f.rack));
    if (rk != null) d.rack = { id: rk, u: Math.max(1, Math.round(+t.f.position || 1)), face: t.f.face === 'rear' ? 'rear' : 'front' };
    else { const at = placeIn(refOf(t.f.location)); if (at) d.loc = { floor: at.floor, x: at.x + (n % 5) * 0.4, y: at.y, h: 0.3 }; }
    data.devices.push(d); devById.set(d.id, d); made.set(t.key, d.id); inc('device');
    // Ports : même nom, sinon dans l'ordre (interfaces ↔ ports actifs ; avant ↔ avant, arrière ↔ arrière).
    const mine = portsOf(d), take = new Set();
    const pairs = (theirsList, oursList) => {
      const rest = [];
      for (const p of theirsList) { const m = oursList.find(q => !take.has(q.id) && (q.id.toLowerCase() === p.name.toLowerCase() || String(q.label).toLowerCase() === p.name.toLowerCase())); if (m) { take.add(m.id); portMap.set(p.key, [d.id, m.id]); } else rest.push(p); }
      const free = oursList.filter(q => !take.has(q.id));
      rest.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).forEach((p, i) => { if (free[i]) { take.add(free[i].id); portMap.set(p.key, [d.id, free[i].id]); } });
    };
    if (passiveDev(d)) { pairs(ports.front, mine.filter(p => !isRear(p))); pairs(ports.rear, mine.filter(isRear)); }
    else pairs(ports.interfaces.filter(p => p.type !== 'virtual'), mine);
  }
  const endOf = key => { if (portMap.has(key)) return portMap.get(key); const x = ours.objs.get(key); if (x && ['interface', 'frontport', 'rearport'].includes(x.kind)) { const [, dev, ...pp] = key.split(':'); return [dev, pp.join(':')]; } return null; };

  // Interfaces des switchs administrables : mode et VLAN.
  const setIf = (key, f) => {
    const e = endOf(key); if (!e) return false;
    const d = devById.get(e[0]); if (!d || !MANAGED.has(d.type)) return false;
    d.p.ports = d.p.ports || {}; const c = { ...portCfg(d, e[1]) };
    const vid = k => { const v = k && (idOf(k) ?? (T.get(k) && T.get(k).f.vid)); return Number.isFinite(+v) ? +v : 1; };
    if ('enabled' in f) c.shut = f.enabled === false;
    if (f.mode === 'access') { c.mode = 'access'; c.vlan = vid(refOf(f.untagged_vlan)); }
    else if (f.mode === 'tagged' || f.mode === 'tagged-all') { c.mode = 'trunk'; c.native = vid(refOf(f.untagged_vlan)); c.allowed = f.mode === 'tagged-all' ? 'all' : (f.tagged_vlans || []).map(x => vid(refOf(x))).join(',') || 'none'; }
    d.p.ports[e[1]] = c; return true;
  };
  for (const t of byKind('interface')) if (t.f.mode) setIf(t.key, t.f);

  // Câbles.
  const busy = new Set(data.cables.flatMap(c => [c.a.join('|'), c.b.join('|')]));
  for (const t of byKind('cable')) {
    const [ka, kb] = (t.f.ends || []).map(refOf), a = ka && endOf(ka), b = kb && endOf(kb);
    if (!a || !b) { out.skipped.push({ label: t.label, why: 'ends' }); continue; }
    if (busy.has(a.join('|')) || busy.has(b.join('|'))) { out.skipped.push({ label: t.label, why: 'busy' }); continue; }
    busy.add(a.join('|')); busy.add(b.join('|'));
    const len = lenM(t.f.length, t.f.length_unit);
    data.cables.push({ id: fresh(want(t.key), 'c'), a, b, len: len ? r2(len) : 3, ...catOf(t.f.type), ...(t.f.label ? { tag: String(t.f.label).slice(0, 40) } : {}), ...(t.f.color ? { color: '#' + t.f.color } : {}) });
    inc('cable');
  }
  // Adresses : poste ou serveur (adresse fixe), SVI d'un switch L3.
  const setIp = (key, address) => {
    const t = T.get(key) || ours.objs.get(key); const ik = t && refOf(t.f.iface); const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(String(address || ''));
    if (!ik || !m) return false;
    const ifo = T.get(ik) || ours.objs.get(ik), name = ifo ? String(ifo.f.name) : '';
    const e = endOf(ik), dk = refOf(ifo && ifo.f.device), d = devById.get(e ? e[0] : idOf(dk)); if (!d) return false;
    const P = d.p || (d.p = {});
    if (P.ip) { P.ip = { ...P.ip, mode: 'static', ip: m[1], prefix: +m[2] }; return true; }
    const sv = /^vlan(\d+)$/i.exec(name);
    if (sv && Array.isArray(P.svis)) { const s = P.svis.find(x => x.vlan === +sv[1]); if (s) Object.assign(s, { ip: m[1], prefix: +m[2] }); else P.svis.push({ vlan: +sv[1], ip: m[1], prefix: +m[2] }); return true; }
    if (Array.isArray(P.ifs)) { const port = e ? e[1] : name; const x = P.ifs.find(f => ifName(f) === name || f.port === port); if (x) Object.assign(x, { mode: 'static', ip: m[1], prefix: +m[2] }); else P.ifs.push({ port, vlan: 0, mode: 'static', ip: m[1], prefix: +m[2] }); return true; }
    return false;
  };
  for (const t of byKind('ip')) { if (setIp(t.key, t.f.address)) inc('ip'); else out.skipped.push({ label: t.label, why: 'ip' }); }

  // Champs repris du serveur sur des objets du projet.
  for (const r of sel.filter(x => x.op === 'update')) {
    const id = idOfKey(r.key), v = r.theirs; let ok = true;
    if (r.kind === 'site' && r.field === 'name') data.site.name = String(v || '').slice(0, 60);
    else if (r.kind === 'location') { const L = findLoc(id); if (L) L.o.name = String(v || '').slice(0, 40); else ok = false; }
    else if (r.kind === 'rack') { const k = data.racks.find(x => x.id === id); if (!k) ok = false; else if (r.field === 'name') k.name = String(v || '').slice(0, 24); else if (r.field === 'u_height' && +v > 0) k.u = Math.round(+v); }
    else if (r.kind === 'device') { const d = devById.get(id); if (!d) ok = false; else if (r.field === 'name') d.name = String(v || '').slice(0, 24); else if (d.rack && r.field === 'position' && +v > 0) d.rack.u = Math.round(+v); else if (d.rack && r.field === 'face') d.rack.face = v === 'rear' ? 'rear' : 'front'; else ok = false; }
    else if (r.kind === 'vlan') { const x = data.vlans.find(q => q.id === +id); if (x) x.name = String(v || '').slice(0, 32); else ok = false; }
    else if (r.kind === 'prefix') { const x = ours.objs.get(r.key); const vl = x && vlanByKey(refOf(x.f.vlan)); if (vl) vl.net = String(v || ''); else ok = false; }
    else if (r.kind === 'cable') { const c = data.cables.find(q => q.id === id); if (!c) ok = false; else if (r.field === 'length') { const t = T.get(r.key); const L = lenM(v, t && t.f.length_unit); if (L) c.len = r2(L); } else if (r.field === 'label') c.tag = String(v || '').slice(0, 40); else if (r.field === 'type') Object.assign(c, catOf(v)); }
    else if (r.kind === 'interface') { const t = T.get(r.key); ok = !!t && setIf(r.key, { [r.field]: v, ...(r.field === 'mode' ? {} : { mode: t.f.mode }), untagged_vlan: t.f.untagged_vlan, tagged_vlans: t.f.tagged_vlans }); }
    else if (r.kind === 'ip') ok = setIp(r.key, v);
    else ok = false;
    if (ok) out.updated++; else out.skipped.push({ label: r.label, why: 'field' });
  }
  // Nettoyage du modèle entier (bornes, ids, câbles entre ports existants), même objet data.
  const clean = cleanNet({ ...data, view: 'net' });
  for (const k of Object.keys(clean)) data[k] = clean[k];
  return out;
}
