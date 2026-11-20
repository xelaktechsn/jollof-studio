// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Réseaux virtuels (802.1Q) et configuration des équipements administrables : base des VLAN du projet, réglages des
// ports (accès, trunk, VLAN natif, VLAN autorisés, agrégat, coût Spanning Tree), Spanning Tree (RSTP), agrégats (LACP),
// interfaces de niveau 3 (SVI d'un switch de niveau 3, interfaces et sous-interfaces 802.1Q d'un routeur), routes
// statiques, étendues DHCP et relais, listes de contrôle d'accès, traduction d'adresses, enregistrements DNS. Fonctions
// pures (nettoyage, lecture) ; la simulation est dans lan.js et l2.js.
//
// Modèle (data = settings.modules.net) :
//   data.vlans : [{ id (1–4094), name, net: 'a.b.c.d/nn' | '', gw: 'a.b.c.d' | '', hosts?: postes prévus, color?: '#rrggbb' }]
//     (la vue Conception peut écrire net, gw et hosts ; rien d'autre). Un VLAN utilisé sur un port mais absent de la base
//     est simulé quand même (le vérificateur le signale).
//   Switchs administrables (switch24, switch48, l3switch), dans d.p :
//     ports: { [portId]: { mode: 'access'|'trunk', vlan (accès), voice: 0 | VLAN voix (port d'accès : le téléphone IP y
//              est placé, « switchport voice vlan »), native (trunk), allowed: 'all'|'none'|'10,20,30-40',
//              lag: ''|'Po1', cost: 0 (0 = selon la vitesse), edge: bool (port de bord, PortFast), shut: bool } }
//            (seuls les ports réglés y figurent ; les autres : accès VLAN 1) ;
//     stp: { on: bool, mode: 'rpvst' (une instance par VLAN, défaut des Catalyst) | 'rstp' (une seule instance),
//            prio: 0–61440 par pas de 4096, vlans: { [vlan]: priorité de ce VLAN } } ;
//     lags: [{ id: 'Po1', mode: 'active'|'passive'|'on' }] ;
//     sfp: { [cage]: module } (fibre.js) ; switch24/48 : budget, pseType, portW (PoE).
//     l3switch en plus : routing: bool, svis: [{ vlan, ip, prefix, helper, o82, aclIn, aclOut }], routes, dhcp, acls, ospf.
//   OSPF (l3switch, routerpro), aire unique : ospf: { on, rid: '' (sinon la plus haute adresse), ref: 100 (bande de
//     référence, Mb/s), originate: bool (annonce la route par défaut), nets: [{ net: 'a.b.c.d/nn', area }] (« network … area »),
//     ifs: { [nom d'interface : 'ge1', 'ge1.10', 'vlan10']: { cost: 0, hello: 10, dead: 40, passive: bool, prio: 0–255 (1 :
//     élection du routeur désigné ; 0 : jamais DR) } }. Aires : 0 (dorsale) et autres, routeurs de bordure (ospf.js).
//   Routeur professionnel (routerpro), dans d.p :
//     ifs: [{ port: 'ge0'…'sfp0', vlan: 0 (interface) | 1–4094 (sous-interface 802.1Q), mode: 'static'|'dhcp', ip, prefix,
//            helper (relais DHCP vers ce serveur), o82 (option 82 du relais), nat: ''|'inside'|'outside', aclIn, aclOut }] ;
//     routes: [{ net: 'a.b.c.d/nn', via: 'a.b.c.d' }] (0.0.0.0/0 : route par défaut) ;
//     dhcp: [{ net, from, to, gw, dns, on }] (étendues) ; acls: [{ name, rules: [{ act: 'permit'|'deny', proto:
//            'any'|'icmp'|'tcp'|'udp', src: 'any'|préfixe, dst: 'any'|préfixe, port: 0 | n (destination), sport: 0 | n (source),
//            est: bool (« established » : segments TCP de retour) }] }] ; filtrage sans état, paquet par paquet ;
//     fwd: [{ proto: 'tcp'|'udp', port, to, toPort }] (redirection de port sur l'interface « outside ») ;
//     dns: { on, records: [{ name, ip }] } ; sfp: { sfp0: module }.
//   Serveur (server) : ip (comme un poste), dhcp (étendues), dns.
import { isIp, prefixOf, ipNum, maskOf, ipStr } from './ip.js';
import { cleanText } from '../sanitize.js';
import { NET } from './limits.js';

const L = k => NET[k].v;
const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
const txt = (v, n) => cleanText(String(v ?? ''), n).trim();
const ipOr = v => (isIp(v) ? String(v).trim() : '');
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Types administrables (VLAN, Spanning Tree, agrégats) ; types qui routent ; types qui servent DHCP et DNS. */
export const MANAGED = new Set(['switch24', 'switch48', 'l3switch']);
export const ROUTERS = new Set(['routerpro', 'l3switch']);
export const SERVES = new Set(['routerpro', 'l3switch', 'server']);
export const vlanOk = v => Number.isInteger(+v) && +v >= L('VLAN_RANGE')[0] && +v <= L('VLAN_RANGE')[1];
const vid = (v, d = 1) => (vlanOk(v) ? +v : d);

/* ---------- Listes de VLAN ---------- */
/** « 10,20,30-40 » | 'all' | 'none' → { all, set } (set : VLAN listés). */
export function parseVlanList(s) {
  const t = String(s ?? 'all').trim().toLowerCase();
  if (t === '' || t === 'all' || t === 'tous') return { all: true, set: new Set() };
  const set = new Set();
  if (t === 'none' || t === 'aucun') return { all: false, set };
  for (const part of t.split(/[,; ]+/)) {
    const m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(part); if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let v = Math.max(1, Math.min(a, b)); v <= Math.min(4094, Math.max(a, b)) && set.size < 4094; v++) set.add(v);
  }
  return { all: false, set };
}
/** Écriture compacte d'un ensemble de VLAN : « 10,20,30-40 ». */
export function fmtVlanList(list) {
  if (list.all) return 'all';
  const v = [...list.set].sort((a, b) => a - b), out = [];
  for (let i = 0; i < v.length;) { let j = i; while (j + 1 < v.length && v[j + 1] === v[j] + 1) j++; out.push(j > i ? `${v[i]}-${v[j]}` : String(v[i])); i = j + 1; }
  return out.length ? out.join(',') : 'none';
}
const cleanList = s => fmtVlanList(parseVlanList(typeof s === 'string' ? s.slice(0, 200) : 'all'));
export const allowedHas = (list, v) => list.all || list.set.has(v);

/* ---------- Base des VLAN ---------- */
const netOk = s => { const m = /^\s*(\d+\.\d+\.\d+\.\d+)\s*\/\s*(\d{1,2})\s*$/.exec(String(s ?? '')); if (!m || !isIp(m[1]) || +m[2] > 32) return ''; return `${ipStr((ipNum(m[1]) & maskOf(+m[2])) >>> 0)}/${+m[2]}`; };
/** Préfixe écrit « a.b.c.d/nn » → { net (entier), prefix } ou null. */
export function parseNet(s) { const t = netOk(s); if (!t) return null; const [ip, p] = t.split('/'); return { net: ipNum(ip), prefix: +p, text: t }; }
export const inNet = (ip, n) => n && ipNum(ip) != null && ((ipNum(ip) & maskOf(n.prefix)) >>> 0) === n.net;
/** Base des VLAN : ids uniques (1–4094), triés ; noms bornés ; préfixe et passerelle valables ou vides. */
export function cleanVlans(raw) {
  const out = [], seen = new Set();
  for (const v of arr(raw, 4094)) {
    if (!v || typeof v !== 'object' || !vlanOk(v.id) || seen.has(+v.id)) continue;
    seen.add(+v.id);
    const o = { id: +v.id, name: txt(v.name, 32) || 'VLAN' + v.id, net: netOk(v.net), gw: ipOr(v.gw) };
    if (Number.isFinite(+v.hosts) && +v.hosts > 0) o.hosts = Math.min(100000, +v.hosts | 0);
    if (typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color)) o.color = v.color;
    out.push(o);
  }
  return out.sort((a, b) => a.id - b.id);
}

/* ---------- Ports d'un switch administrable ---------- */
export const PORT_DEFAULT = Object.freeze({ mode: 'access', vlan: 1, voice: 0, native: 1, allowed: 'all', lag: '', cost: 0, edge: false, shut: false });
const lagId = s => { const m = /^po(\d{1,2})$/i.exec(String(s ?? '').trim()); return m && +m[1] >= 1 && +m[1] <= 64 ? 'Po' + +m[1] : ''; };
function cleanPort(p) {
  const o = obj(p);
  return {
    mode: o.mode === 'trunk' ? 'trunk' : 'access', vlan: vid(o.vlan), voice: vlanOk(o.voice) ? +o.voice : 0, native: vid(o.native), allowed: cleanList(o.allowed),
    lag: lagId(o.lag), cost: num(o.cost, 0, 200000000, 0) | 0, edge: !!o.edge, shut: !!o.shut
  };
}
const same = (a, b) => Object.keys(PORT_DEFAULT).every(k => a[k] === b[k]);
/** Réglages des ports : seuls les ports existants et réglés autrement que par défaut sont gardés. */
export function cleanPorts(raw, ids) {
  const out = {}, src = obj(raw);
  for (const id of ids) if (src[id]) { const c = cleanPort(src[id]); if (!same(c, PORT_DEFAULT)) out[id] = c; }
  return out;
}
/** Réglage complet d'un port (défauts compris). */
export const portCfg = (d, pid) => ({ ...PORT_DEFAULT, ...(((d && d.p && d.p.ports) || {})[pid] || {}) });
export function cleanStp(raw) {
  const o = obj(raw), P = NET.STP_PRIO, step = P.step, pr = v => Math.round(num(v, 0, P.max, P.v) / step) * step;
  const vlans = {};
  for (const [k, v] of Object.entries(obj(o.vlans)).slice(0, 4094)) if (vlanOk(k)) vlans[+k] = pr(v);
  return { on: o.on !== false, mode: o.mode === 'rstp' ? 'rstp' : 'rpvst', prio: pr(o.prio), vlans };
}
export function cleanLags(raw) {
  const out = [], seen = new Set();
  for (const g of arr(raw, 64)) { const id = lagId(g && g.id); if (!id || seen.has(id)) continue; seen.add(id); out.push({ id, mode: ['active', 'passive', 'on'].includes(g.mode) ? g.mode : 'active' }); }
  return out;
}

/* ---------- Niveau 3 ---------- */
const aclName = s => txt(s, 24).replace(/[^\w.-]/g, '');
const l3 = o => ({ ip: ipOr(o.ip), prefix: prefixOf(o.prefix) ?? 24, helper: ipOr(o.helper), o82: !!o.o82, aclIn: aclName(o.aclIn), aclOut: aclName(o.aclOut) });
export function cleanSvis(raw) {
  const out = [], seen = new Set();
  for (const s of arr(raw, 256)) { const o = obj(s); if (!vlanOk(o.vlan) || seen.has(+o.vlan)) continue; seen.add(+o.vlan); out.push({ vlan: +o.vlan, ...l3(o) }); }
  return out.sort((a, b) => a.vlan - b.vlan);
}
/** Interfaces d'un routeur : port existant, VLAN 0 (interface) ou 802.1Q (sous-interface), unique par (port, VLAN). */
export function cleanIfs(raw, ports) {
  const out = [], seen = new Set();
  for (const s of arr(raw, 128)) {
    const o = obj(s), port = String(o.port ?? ''); if (!ports.includes(port)) continue;
    const vlan = vlanOk(o.vlan) ? +o.vlan : 0, k = port + '.' + vlan; if (seen.has(k)) continue; seen.add(k);
    out.push({ port, vlan, mode: o.mode === 'dhcp' ? 'dhcp' : 'static', ...l3(o), nat: ['inside', 'outside'].includes(o.nat) ? o.nat : '' });
  }
  return out;
}
export function cleanRoutes(raw) {
  const out = [], seen = new Set();
  for (const r of arr(raw, 256)) { const o = obj(r), n = netOk(o.net), via = ipOr(o.via); if (!n || !via || seen.has(n + via)) continue; seen.add(n + via); out.push({ net: n, via }); }
  return out;
}
export function cleanScopes(raw) {
  const out = [];
  for (const s of arr(raw, 64)) {
    const o = obj(s), n = netOk(o.net); if (!n) continue;
    out.push({ net: n, from: ipOr(o.from), to: ipOr(o.to), gw: ipOr(o.gw), dns: ipOr(o.dns), on: o.on !== false });
  }
  return out;
}
const pfx = s => { const t = String(s ?? 'any').trim().toLowerCase(); if (t === 'any' || t === '') return 'any'; if (isIp(t)) return t + '/32'; return netOk(t) || 'any'; };
export function cleanAcls(raw) {
  const out = [], seen = new Set();
  for (const a of arr(raw, 32)) {
    const o = obj(a), name = aclName(o.name); if (!name || seen.has(name)) continue; seen.add(name);
    const rules = arr(o.rules, 64).map(r => {
      const x = obj(r), proto = ['icmp', 'tcp', 'udp'].includes(x.proto) ? x.proto : 'any', ports = proto === 'tcp' || proto === 'udp' || proto === 'any';
      const out = { act: x.act === 'deny' ? 'deny' : 'permit', proto, src: pfx(x.src), dst: pfx(x.dst), port: ports ? num(x.port, 0, 65535, 0) | 0 : 0 };
      if (ports && +x.sport) out.sport = num(x.sport, 0, 65535, 0) | 0;
      if (proto === 'tcp' && x.est) out.est = true;
      return out;
    });
    out.push({ name, rules });
  }
  return out;
}
export function cleanFwd(raw) {
  return arr(raw, 64).map(f => { const o = obj(f); return { proto: o.proto === 'udp' ? 'udp' : 'tcp', port: num(o.port, 1, 65535, 80) | 0, to: ipOr(o.to), toPort: num(o.toPort ?? o.port, 1, 65535, 80) | 0 }; }).filter(f => f.to);
}
export function cleanDns(raw) {
  const o = obj(raw), records = [], seen = new Set();
  for (const r of arr(o.records, 256)) { const x = obj(r), name = txt(x.name, 63).toLowerCase().replace(/[^a-z0-9.-]/g, ''), ip = ipOr(x.ip); if (!name || !ip || seen.has(name)) continue; seen.add(name); records.push({ name, ip }); }
  return { on: o.on !== false, records };
}
/** Nom d'une interface de niveau 3 (OSPF, journaux) : 'ge1', 'ge1.10' (sous-interface), 'vlan10' (SVI). */
export const ifName = f => (f.svi || /^vlan\d+$/.test(f.port) ? 'vlan' + f.vlan : f.vlan ? `${f.port}.${f.vlan}` : f.port);
/** OSPF d'un routeur : aire unique, déclarations « network », réglages par interface (minuterie, coût, passive). */
export function cleanOspf(raw) {
  const o = obj(raw), nets = [], ifs = {};
  for (const n of arr(o.nets, 64)) { const x = obj(n), t = netOk(x.net); if (t) nets.push({ net: t, area: num(x.area, 0, 4294967295, 0) | 0 }); }
  for (const [k, v] of Object.entries(obj(o.ifs)).slice(0, 256)) {
    const name = String(k).replace(/[^\w.]/g, '').slice(0, 24), x = obj(v); if (!name) continue;
    const T = L('OSPF_TIMERS'), P0 = NET.OSPF_PRIO, c = { cost: num(x.cost, 0, L('OSPF_COST')[1], 0) | 0, hello: num(x.hello, 1, 65535, T.hello) | 0, dead: num(x.dead, 1, 65535, T.dead) | 0, passive: !!x.passive, prio: num(x.prio, 0, P0.max, P0.v) | 0 };
    if (c.cost || c.hello !== T.hello || c.dead !== T.dead || c.passive || c.prio !== P0.v) ifs[name] = c;
  }
  return { on: !!o.on, rid: ipOr(o.rid), ref: num(o.ref, 1, 4294967, L('OSPF_REF_MBPS')) | 0, originate: !!o.originate, nets, ifs };
}
/** Réglages OSPF d'une interface (défauts : minuterie 10 s / 40 s, coût selon la bande de référence). */
export const ospfIf = (P, name) => ({ cost: 0, hello: L('OSPF_TIMERS').hello, dead: L('OSPF_TIMERS').dead, passive: false, prio: L('OSPF_PRIO'), ...(((P && P.ospf && P.ospf.ifs) || {})[name] || {}) });
const cleanSfp = (raw, cages) => { const o = obj(raw), out = {}; for (const c of cages) if (typeof o[c] === 'string' && o[c].trim()) out[c] = txt(o[c], 24); return out; };

/**
 * Nettoyeur des propriétés d'un équipement administrable (spec.clean de devices.js) : s brut, d défauts du type, ports
 * (liste des ports du type), cages (ports SFP). Garde les champs propres au type (PoE, IP du serveur) qu'on lui passe.
 */
export function cleanManaged(type, s, d, ports, cages) {
  const o = obj(s), out = { ...d };
  if (MANAGED.has(type)) {
    out.ports = cleanPorts(o.ports, ports); out.stp = cleanStp(o.stp || d.stp); out.lags = cleanLags(o.lags);
    // Un port qui cite un agrégat absent n'y appartient pas.
    for (const c of Object.values(out.ports)) if (c.lag && !out.lags.some(g => g.id === c.lag)) c.lag = '';
  }
  if (type === 'l3switch') { out.routing = o.routing !== false; out.svis = cleanSvis(o.svis); }
  if (type === 'routerpro') { out.ifs = cleanIfs('ifs' in o ? o.ifs : d.ifs, ports); out.fwd = cleanFwd(o.fwd); }
  if (ROUTERS.has(type)) out.routes = cleanRoutes(o.routes);
  if (SERVES.has(type)) out.dhcp = cleanScopes('dhcp' in o ? o.dhcp : d.dhcp);
  if (ROUTERS.has(type)) { out.acls = cleanAcls(o.acls); out.ospf = cleanOspf(o.ospf); }
  if (type === 'routerpro' || type === 'server') out.dns = cleanDns('dns' in o ? o.dns : d.dns);
  if (cages && cages.length) out.sfp = cleanSfp(o.sfp, cages);
  return out;
}

/* ---------- Lecture ---------- */
/** VLAN connus d'un plan : base, ports, SVI, sous-interfaces (toujours le VLAN 1). */
export function vlansInUse(data) {
  const s = new Set([1]);
  for (const v of (data && data.vlans) || []) s.add(v.id);
  for (const d of (data && data.devices) || []) {
    const P = d.p || {};
    for (const c of Object.values(P.ports || {})) { s.add(c.vlan); s.add(c.native); if (c.voice) s.add(c.voice); if (c.mode === 'trunk') { const l = parseVlanList(c.allowed); if (!l.all) for (const v of l.set) if (s.size < 4094) s.add(v); } }
    for (const x of P.svis || []) s.add(x.vlan);
    for (const x of P.ifs || []) if (x.vlan) s.add(x.vlan);
  }
  return s;
}
/** Règle d'une ACL qui s'applique au paquet { proto, src, dst, port } : la première qui correspond, sinon null. */
export function aclMatch(acl, pkt) {
  for (const r of acl.rules) {
    if (r.proto !== 'any' && r.proto !== pkt.proto) continue;
    if (r.src !== 'any' && !inNet(pkt.src, parseNet(r.src))) continue;
    if (r.dst !== 'any' && !inNet(pkt.dst, parseNet(r.dst))) continue;
    if (r.port && (pkt.proto === 'icmp' || pkt.port !== r.port)) continue;
    if (r.sport && (pkt.proto === 'icmp' || pkt.sport !== r.sport)) continue;
    if (r.est && !(pkt.proto === 'tcp' && pkt.est)) continue;
    return r;
  }
  return null;
}
/** Verdict d'une ACL (première règle qui correspond ; refus implicite à la fin d'une liste non vide). */
export function aclAllows(acl, pkt) {
  if (!acl || !acl.rules.length) return { ok: true, rule: -1 };
  const r = aclMatch(acl, pkt);
  if (!r) return { ok: false, rule: acl.rules.length, implicit: true };
  return { ok: r.act === 'permit', rule: acl.rules.indexOf(r) };
}
/** Couleur d'un VLAN (schéma) : celle de la base, sinon une teinte stable tirée de son numéro. */
export const vlanHue = id => (id * 137.508) % 360;
