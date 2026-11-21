// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Plan d'adressage IPv4 à masques de longueur variable (VLSM) : module pur, sans interface. À partir d'un bloc parent
// (« 10.20.0.0/16 ») et du nombre d'hôtes de chaque VLAN, il découpe des sous-réseaux alignés, du plus grand au plus
// petit (RFC 4632 : préfixes de longueur quelconque ; RFC 950 : adresse du réseau et de diffusion réservées), place la
// passerelle (première ou dernière adresse utilisable, au choix) et signale les chevauchements. Les blocs privés sont
// ceux de la RFC 1918 (10/8, 172.16/12, 192.168/16) : un bloc public est permis mais signalé.
import { ipNum, ipStr, maskOf } from './ip.js';

/** Blocs privés (RFC 1918). */
export const PRIVATE = [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16]].map(([a, p]) => ({ net: ipNum(a), prefix: p }));
const size = p => 2 ** (32 - p);
/** « a.b.c.d/nn » → { net (adresse du réseau, alignée), prefix, aligned (l'adresse donnée était celle du réseau) } ou null. */
export function parseCidr(s) {
  const m = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s*\/\s*(\d{1,2})\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  const ip = ipNum(m[1]), p = +m[2]; if (ip == null || p > 32) return null;
  const net = (ip & maskOf(p)) >>> 0;
  return { net, prefix: p, aligned: net === ip };
}
export const cidrStr = (net, p) => `${ipStr(net)}/${p}`;
/** Adresses utilisables d'un préfixe : 2^(32-p) - 2 (réseau et diffusion réservés), /31 : 2 (lien point à point), /32 : 1. */
export const usableOf = p => (p >= 32 ? 1 : p === 31 ? 2 : size(p) - 2);
/** Plus long préfixe (plus petit réseau) qui loge n hôtes, passerelle comprise si gw ; au plus /30 pour un LAN. */
export function prefixFor(hosts, gw = true) {
  const need = Math.max(1, Math.ceil(+hosts || 0)) + (gw ? 1 : 0);
  for (let p = 30; p >= 0; p--) if (usableOf(p) >= need) return p;
  return 0;
}
export const isPrivate = (net, p) => PRIVATE.some(b => p >= b.prefix && ((net & maskOf(b.prefix)) >>> 0) === b.net);
/** Détail d'un sous-réseau : adresses, masque, première et dernière utilisables, diffusion. */
export function describe(net, p) {
  const n = size(p), bc = (net + n - 1) >>> 0;
  const first = p >= 31 ? net : net + 1, last = p >= 31 ? bc : bc - 1;
  return { net: ipStr(net), prefix: p, cidr: cidrStr(net, p), mask: ipStr(maskOf(p)), first: ipStr(first), last: ipStr(last), bcast: ipStr(bc), size: n, usable: usableOf(p) };
}

/**
 * Plan VLSM. block : « 10.20.0.0/16 » ; reqs : [{ id, name, hosts }] (hosts : appareils à adresser, hors passerelle) ;
 * o : { gw: 'first' | 'last' (passerelle), growth: % de réserve ajouté aux hôtes (0 par défaut) }.
 * Rend { ok, block, subnets: [{ id, name, hosts, need, prefix, net, cidr, mask, gw, first, last, bcast, size, usable,
 * util (hôtes / utilisables) }], used (adresses prises), free, util (part du bloc prise), fail: [ids sans place],
 * error: null | 'block' }. Les sous-réseaux sont rendus dans l'ordre des demandes ; leur placement suit l'ordre
 * décroissant de taille : chaque réseau commence alors à un multiple de sa taille (alignement), sans trou inutile.
 */
export function planVlsm(block, reqs, o = {}) {
  const b = parseCidr(block);
  if (!b) return { ok: false, error: 'block', block: String(block ?? ''), subnets: [], used: 0, free: 0, util: 0, fail: (reqs || []).map(r => r.id) };
  const grow = Math.max(0, Math.min(400, +o.growth || 0)) / 100, gwLast = o.gw === 'last';
  const list = (Array.isArray(reqs) ? reqs : []).map((r, i) => {
    const hosts = Math.max(0, Math.round(+r.hosts || 0)), need = Math.ceil(hosts * (1 + grow));
    return { i, id: r.id, name: r.name || String(r.id), hosts, need, prefix: prefixFor(need, true) };
  });
  const order = list.slice().sort((x, y) => x.prefix - y.prefix || x.i - y.i);
  const end = b.net + size(b.prefix); let at = b.net, used = 0;
  const fail = [], placed = new Map();
  for (const r of order) {
    if (r.prefix < b.prefix || at + size(r.prefix) > end) { fail.push(r.id); continue; }
    placed.set(r.i, at); at += size(r.prefix); used += size(r.prefix);
  }
  const subnets = list.map(r => {
    if (!placed.has(r.i)) return { id: r.id, name: r.name, hosts: r.hosts, need: r.need, prefix: r.prefix, fit: false };
    const d = describe(placed.get(r.i), r.prefix);
    return { id: r.id, name: r.name, hosts: r.hosts, need: r.need, fit: true, ...d, gw: gwLast ? d.last : d.first, util: d.usable ? (r.hosts + 1) / d.usable : 0 };
  });
  const total = size(b.prefix);
  return { ok: !fail.length, error: null, block: cidrStr(b.net, b.prefix), private: isPrivate(b.net, b.prefix), subnets, used, free: total - used, util: used / total, fail };
}

/**
 * Chevauchements entre réseaux : items [{ id, net: 'a.b.c.d/nn' }] → [[idA, idB]] (une paire par chevauchement).
 * Tri par adresse de début puis balayage : O(n log n) même pour des centaines de VLAN.
 */
export function overlaps(items) {
  const iv = [];
  for (const it of items || []) { const c = parseCidr(it.net); if (c) iv.push({ id: it.id, a: c.net, b: c.net + size(c.prefix) }); }
  iv.sort((x, y) => x.a - y.a || y.b - x.b);
  const out = [], open = [];
  for (const x of iv) {
    for (let k = open.length - 1; k >= 0; k--) if (open[k].b <= x.a) open.splice(k, 1);
    for (const y of open) out.push([y.id, x.id]);
    open.push(x);
  }
  return out;
}
/** Une adresse (« 10.0.0.1 ») est-elle dans ce réseau (« 10.0.0.0/24 ») ? */
export function contains(cidr, ip) {
  const c = parseCidr(cidr), n = ipNum(ip); if (!c || n == null) return false;
  return ((n & maskOf(c.prefix)) >>> 0) === c.net;
}

/**
 * Plan qui GARDE les réseaux en place quand ils conviennent (alignés, assez grands pour le besoin, sans chevauchement) et
 * ne place que les autres, du plus grand au plus petit, dans les trous alignés du bloc. reqs : [{ id, name, hosts, net
 * (en place, facultatif), gw (en place) }] ; o : { gw: 'first'|'last', growth (%), minHosts (taille minimale d'un réseau,
 * en hôtes), keep: bool (défaut vrai) }. Rend { ok, block, private, subnets: [{ id, name, hosts, need, prefix, fit,
 * status: 'kept'|'new'|'changed'|'nofit', from (réseau en place), fromGw, cidr, gw, first, last, bcast, mask, size,
 * usable, util }], used, free, util, fail, changes (nombre de VLAN dont le réseau ou la passerelle change) }.
 */
export function planKeep(block, reqs, o = {}) {
  const b = parseCidr(block), grow = Math.max(0, Math.min(400, +o.growth || 0)) / 100, min = Math.max(1, Math.round(+o.minHosts || 1)), gwLast = o.gw === 'last';
  const list = (Array.isArray(reqs) ? reqs : []).map((r, i) => {
    const hosts = Math.max(0, Math.round(+r.hosts || 0)), need = Math.max(min, Math.ceil(hosts * (1 + grow)));
    // Un réseau en place se garde s'il loge les hôtes (réserve comprise) : la taille minimale ne vaut que pour un nouveau
    // réseau (une liaison /30 ou un petit VLAN existant ne sont pas agrandis pour elle).
    return { i, id: r.id, name: r.name || String(r.id), hosts, need, keepNeed: Math.ceil(hosts * (1 + grow)), prefix: prefixFor(need, true), cur: parseCidr(r.net), net: r.net || '', gwOld: r.gw || '' };
  });
  const used = []; // [début, fin)
  const free = (a, n) => used.every(u => a + n <= u[0] || a >= u[1]);
  const out = new Map();
  // 1. Réseaux en place qui conviennent.
  if (o.keep !== false) for (const r of list) {
    // (un lien point à point /30 ou /31 qui relie deux équipements reste tel quel)
    const c = r.cur; if (!c || !c.aligned || (usableOf(c.prefix) < r.keepNeed + 1 && !(c.prefix >= 30 && r.hosts <= 2))) continue;
    const n = size(c.prefix); if (!free(c.net, n)) continue;
    used.push([c.net, c.net + n]);
    const d = describe(c.net, c.prefix), gwOk = r.gwOld && contains(d.cidr, r.gwOld);
    // passerelle : celle en place si elle est dans le réseau ; aucune en place (lien de transit…) : on n'en impose pas
    out.set(r.i, { ...d, gw: gwOk ? r.gwOld : r.gwOld ? (gwLast ? d.last : d.first) : '', fit: true, status: 'kept' });
  }
  // 2. Les autres, du plus grand au plus petit, dans le premier trou aligné du bloc.
  const fail = [];
  if (b) for (const r of list.filter(x => !out.has(x.i)).sort((x, y) => x.prefix - y.prefix || x.i - y.i)) {
    const n = size(r.prefix), end = b.net + size(b.prefix); let at = null;
    if (r.prefix >= b.prefix) for (let a = b.net; a + n <= end; a += n) if (free(a, n)) { at = a; break; }
    if (at == null) { fail.push(r.id); continue; }
    used.push([at, at + n]);
    const d = describe(at, r.prefix);
    out.set(r.i, { ...d, gw: gwLast ? d.last : d.first, fit: true, status: r.cur ? 'changed' : 'new' });
  } else for (const r of list) if (!out.has(r.i)) fail.push(r.id);
  const subnets = list.map(r => {
    const x = out.get(r.i), base = { id: r.id, name: r.name, hosts: r.hosts, need: r.need, prefix: x ? x.prefix : r.prefix, from: r.net, fromGw: r.gwOld };
    if (!x) return { ...base, fit: false, status: 'nofit' };
    const status = x.status === 'kept' && x.gw !== r.gwOld ? 'changed' : x.status;
    return { ...base, ...x, status, util: x.usable ? (r.hosts + 1) / x.usable : 0 };
  });
  const total = b ? size(b.prefix) : 0, inBlock = b ? used.filter(u => u[0] >= b.net && u[1] <= b.net + total).reduce((a, u) => a + u[1] - u[0], 0) : 0;
  return { ok: !fail.length && !!b, error: b ? null : 'block', block: b ? cidrStr(b.net, b.prefix) : String(block ?? ''), private: b ? isPrivate(b.net, b.prefix) : null, subnets, used: inBlock, free: total - inBlock, util: total ? inBlock / total : 0, fail, changes: subnets.filter(s => s.fit && (s.cidr !== s.from || s.gw !== s.fromGw)).length };
}
