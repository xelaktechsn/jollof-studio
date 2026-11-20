// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Le réseau simulé, commun à tous les moteurs : le plan réseau (src/net/ui), l'interpréteur (src/prog/runtime.js :
// Ethernet, Wi-Fi, PubSubClient, Modbus), les vrais programmes sur avr8js, rp2040js et l'ESP32 (modèle W5500 de
// src/emu/devices/w5500.js), le vérificateur (issues.js), les TP et les outils de l'IA.
//
// Couches simulées, sans horloge (tout se recalcule quand le plan change) :
//   1. physique : alimentation PoE (budget, classes), canal de chaque port (câbles bout à bout à travers prises et
//      panneau), carte de câblage, négociation du lien (vitesse, Auto-MDIX, paires, catégorie, longueur) ;
//   2. liaison : domaines de diffusion (switchs, ports LAN d'une box, points d'accès et leurs clients Wi-Fi), boucles
//      (pas de Spanning Tree sur un switch non administrable : tempête de diffusion), tables MAC apprises ;
//   3. réseau : adresses (fixes, DHCP, locale au lien 169.254 quand aucun serveur ne répond), passerelle, routage de la
//      box (LAN ↔ WAN avec traduction d'adresses), ping avec la raison d'un échec ;
//   4. transport et services : connexions TCP (flux d'octets), datagrammes UDP (DHCP), et les services des équipements
//      (DHCP, pages web d'état, broker MQTT, serveur Modbus TCP).
// Les nœuds « externes » viennent du montage électronique (module W5500, carte Wi-Fi) : ext() les donne à chaque appel.
import { DEVICES, EXTERNAL, specOf, portsOf, portOf } from './devices.js';
import { analyzeChain, CATS } from './cable.js';
import { NET } from './limits.js';
import { ipNum, ipStr, maskOf, sameNet, hostOk, macFor, isLinkLocal } from './ip.js';
import { createBroker } from './mqtt.js';
import { createModbusServer } from './modbus.js';
import { createHttpServer } from './http.js';
import { statusPage } from './pages.js';
import { dhcpServerPacket, parseDhcp } from './dhcp.js';
import { parseDnsQuery, dnsResponse } from './dns.js';
import { byteStr, fromBytes, bytesOf } from './bytes.js';
export { byteStr, fromBytes, bytesOf };

const LIM = k => NET[k].v;
const key = (n, p) => n + '|' + p;
/** Longueur au-delà de laquelle le signal n'arrive plus du tout (modèle : 1,5 fois le canal normalisé). */
const DEAD_M = 150;

/**
 * src : { data() → { devices, cables } (plan réseau du projet), ext() → nœuds du montage, plc?(device) → registres de
 * l'automate du projet (Ladder) ou null }. Rend l'objet réseau (voir la fin du fichier).
 */
export function createLan(src) {
  let S = null, ver = 0; // état calculé (refresh)
  const listeners = new Map(); // nœud|port → accept(sock)
  const udpBinds = new Map(); // nœud|port → fn(datagramme)
  const leases = new Map(); // serveur DHCP → Map(mac → ip)
  const macTables = new Map(); // switch → Map(mac → { port, t })
  const assoc = new Map(); // nœud Wi-Fi → id du point d'accès (cartes : rejoint par le programme)
  const hooks = new Set();
  const services = new Map(); // nœud → { kind, stop } (services intégrés des équipements)
  const brokers = new Map(), modbus = new Map();
  let events = [];
  const emit = e => { e.at = Date.now(); events.push(e); if (events.length > 200) events = events.slice(-150); hooks.forEach(f => { try { f(e); } catch (err) { console.error(err); } }); };

  /* ---------- Nœuds ---------- */
  function nodes() {
    const d = src.data() || {}, out = [];
    for (const x of d.devices || []) if (DEVICES[x.type]) out.push({ ...x, ext: false });
    for (const x of (src.ext ? src.ext() : []) || []) if (EXTERNAL[x.type]) out.push({ ...x, ext: true, p: x.p || {} });
    return out;
  }
  const cablesOf = () => ((src.data() || {}).cables || []);

  /* ---------- 1. Canaux : câbles bout à bout à travers les prises passives ---------- */
  /** Canal depuis le port (n, p) : segments, câbles, longueur, catégorie, extrémité active, analyse. */
  function channelFrom(byId, byPort, n, p) {
    const segs = [], cables = [], seen = new Set();
    let cur = { n, p }, far = null, len = 0, rank = 9, perm = 0, dead = false;
    for (let guard = 0; guard < 16; guard++) {
      const c = byPort.get(key(cur.n, cur.p)); if (!c || seen.has(c.id)) { dead = true; break; }
      seen.add(c.id);
      const flip = !(c.a[0] === cur.n && c.a[1] === cur.p);
      segs.push({ ...c.wire, flip }); cables.push(c);
      len += +c.len || 0; rank = Math.min(rank, (CATS[c.cat] || CATS.cat5e).rank);
      const other = flip ? c.a : c.b, od = byId.get(other[0]);
      if (!od) { dead = true; break; }
      const op = portOf(od, other[1]);
      if (op && op.passive) {
        // Lien permanent : câble entre deux ports « mur » (dos de prise, dos du panneau).
        const prev = portOf(byId.get(cur.n), cur.p);
        if (op.punch && prev && prev.punch) perm += +c.len || 0;
        cur = { n: other[0], p: op.passive };
        continue;
      }
      far = { n: other[0], p: other[1] }; break;
    }
    const an = segs.length ? analyzeChain(segs) : null;
    return { segs, cables, far: dead ? null : far, len, rank: rank === 9 ? 0 : rank, cat: Object.keys(CATS).find(k => CATS[k].rank === rank) || null, perm, cords: len - perm, an };
  }

  /* ---------- Négociation du lien entre deux ports ---------- */
  function negotiate(pa, pb, ch) {
    const an = ch.an, pr = an ? an.pairs : null, notes = [];
    if (!an || an.kind === 'none') return { up: false, speed: 0, why: 'crimp', notes };
    if (ch.len > DEAD_M) return { up: false, speed: 0, why: 'length', notes };
    const modes = pt => (pt.mdix === 'auto' ? ['mdi', 'mdix'] : [pt.mdix]);
    // 10BASE-T / 100BASE-TX : émission sur 1-2 (MDI) ou 3-6 (MDI-X), réception sur l'autre paire.
    let two = null;
    for (const cx of modes(pa)) for (const cy of modes(pb)) {
      if (two) break;
      const atx = cx === 'mdi' ? 0 : 1, arx = 1 - atx, btx = cy === 'mdi' ? 0 : 1, brx = 1 - btx;
      const p1 = pr[atx], p2 = pr[arx];
      if (p1.ok && p1.to === brx && p2.ok && p2.to === btx) two = { cx, cy, rev: p1.rev || p2.rev, split: p1.split || p2.split };
    }
    // 1000BASE-T et 10GBASE-T : les quatre paires, droites ou toutes croisées (fonction de croisement, IEEE 802.3 40.8).
    const all = pr.every(x => x.ok), straight4 = all && pr.every((x, k) => x.to === k), cross4 = all && pr[0].to === 1 && pr[1].to === 0 && pr[2].to === 3 && pr[3].to === 2;
    const auto = pa.mdix === 'auto' || pb.mdix === 'auto';
    const four = (straight4 && (auto || pa.mdix !== pb.mdix)) || (cross4 && (auto || pa.mdix === pb.mdix));
    let speed = Math.min(pa.speed, pb.speed);
    if (!two && !(four && speed >= 1000)) return { up: false, speed: 0, why: auto ? 'pairs' : 'mdix', notes };
    if (speed >= 1000 && !four) { speed = 100; notes.push('downshift'); }
    if (speed < 1000 && !two) return { up: false, speed: 0, why: 'pairs', notes };
    // Catégorie : 10GBASE-T demande du Cat 6A ; sur Cat 6, 55 m au plus (TSB-155). Sinon la carte retombe à 1 Gb/s.
    if (speed === 10000 && ch.rank < LIM('SPEED_CAT')[10000]) {
      if (!(ch.cat === 'cat6' && ch.len <= LIM('CAT6_10G_MAX_M'))) { speed = 1000; notes.push('catlow'); }
    }
    let errors = false;
    if (ch.len > LIM('CHANNEL_M')) { if (speed >= 1000) { speed = 100; notes.push('downshift'); } errors = true; notes.push('length'); }
    const usedSplit = speed >= 1000 ? pr.some(x => x.split) : !!(two && two.split);
    if (usedSplit) { errors = true; notes.push('split'); }
    // Auto-MDIX a-t-il dû croiser ? (réglages d'usine : hôte en MDI, switch et box en MDI-X)
    const da = pa.mdix === 'auto' ? pa.def : pa.mdix, db = pb.mdix === 'auto' ? pb.def : pb.mdix;
    const crossed = speed >= 1000 ? (cross4 ? da !== db : da === db) : !!(two && (two.cx !== da || two.cy !== db));
    return { up: true, speed, why: null, notes, errors, mdix: auto && crossed, rev: !!(two && two.rev) };
  }

  /* ---------- Calcul complet ---------- */
  function refresh() {
    ver++;
    const all = nodes(), byId = new Map(all.map(n => [n.id, n]));
    const byPort = new Map();
    for (const c of cablesOf()) { if (!c || !c.a || !c.b) continue; byPort.set(key(c.a[0], c.a[1]), c); byPort.set(key(c.b[0], c.b[1]), c); }
    // Canaux depuis chaque port actif câblé.
    const chans = new Map();
    for (const n of all) for (const p of portsOf(n)) if (!p.passive && byPort.has(key(n.id, p.id))) chans.set(key(n.id, p.id), channelFrom(byId, byPort, n.id, p.id));
    // Alimentation PoE : détection sur les paires 1-2 et 3-6 (mode A), classes, budget de chaque switch.
    const power = new Map(), poe = new Map();
    for (const n of all) {
      const s = specOf(n);
      if (!n.ext && s.ports(n.p || {}).some(p => p.poe === 'pd') && (n.p || {}).power !== 'adapter') power.set(n.id, { on: false, why: 'nopoe', w: 0, pse: null });
      else power.set(n.id, { on: true, why: null, w: 0, pse: null });
    }
    for (const n of all) {
      const ps = portsOf(n).filter(p => p.poe === 'pse'); if (!ps.length) continue;
      const P = n.p || {}, budget = +P.budget || 0, maxClass = LIM('POE_TYPE_MAXCLASS')[P.pseType || 'at'] ?? 4, info = { budget, used: 0, ports: [] };
      for (const p of ps) {
        const ch = chans.get(key(n.id, p.id)); if (!ch || !ch.far) continue;
        const pd = byId.get(ch.far.n), pdp = pd && portOf(pd, ch.far.p);
        if (!pd || !pdp || pdp.poe !== 'pd' || (pd.p || {}).power === 'adapter') continue;
        const st = power.get(pd.id); if (st.on) continue;
        const pr = ch.an.pairs, shorted = ch.an.faults.some(f => f.type === 'short' && f.pins.some(x => [1, 2, 3, 6].includes(x)));
        const pairsOk = pr[0].ok && pr[1].ok && [0, 1].includes(pr[0].to) && [0, 1].includes(pr[1].to);
        const cls = Math.max(0, Math.min(8, (pd.p || {}).poeClass | 0)), w = LIM('POE_PSE_W')[cls];
        if (shorted || !pairsOk) { st.why = shorted ? 'short' : 'pairs'; continue; }
        if (cls > maxClass) { st.why = 'class'; st.cls = cls; st.maxClass = maxClass; info.ports.push({ port: p.id, node: pd.id, w: 0, cls, denied: 'class' }); continue; }
        if (P.portW && w > +P.portW) { st.why = 'class'; st.cls = cls; continue; }
        if (info.used + w > budget) { st.why = 'budget'; info.ports.push({ port: p.id, node: pd.id, w, cls, denied: 'budget' }); continue; }
        info.used += w; Object.assign(st, { on: true, why: null, w, pse: { n: n.id, p: p.id }, cls });
        info.ports.push({ port: p.id, node: pd.id, w, cls });
      }
      poe.set(n.id, info);
    }
    // Liens.
    const links = new Map();
    for (const [k, ch] of chans) {
      if (links.has(k)) continue;
      const [nid, pid] = k.split('|'), n = byId.get(nid), pa = portOf(n, pid);
      if (!ch.far) { links.set(k, { up: false, speed: 0, why: 'open', notes: [], ch }); continue; }
      const m = byId.get(ch.far.n), pb = portOf(m, ch.far.p);
      if (!pb) { links.set(k, { up: false, speed: 0, why: 'open', notes: [], ch }); continue; }
      const off = !power.get(nid).on || !power.get(m.id).on;
      const def = d => (specOf(d).role === 'switch' || (specOf(d).role === 'router') ? 'mdix' : 'mdi');
      const r = off ? { up: false, speed: 0, why: 'power', notes: [] } : negotiate({ ...pa, def: pid === 'wan' ? 'mdi' : def(n) }, { ...pb, def: ch.far.p === 'wan' ? 'mdi' : def(m) }, ch);
      const back = chans.get(key(m.id, pb.id));
      links.set(k, { ...r, ch, peer: { n: m.id, p: pb.id } });
      links.set(key(m.id, pb.id), { ...r, ch: back || ch, peer: { n: nid, p: pid } });
    }
    // Wi-Fi : portables (réglage), cartes (rejointes par leur programme).
    const aps = all.filter(n => (specOf(n).role === 'ap' && power.get(n.id).on) || (n.type === 'router' && n.p && n.p.wifi && n.p.wifi.on));
    const ssidOf = n => (n.type === 'router' ? n.p.wifi.ssid : (n.p || {}).ssid) || '';
    const passOf = n => (n.type === 'router' ? n.p.wifi.pass : (n.p || {}).pass) || '';
    const wifiAssoc = new Map(), wifiWhy = new Map();
    for (const n of all) {
      if (n.type === 'laptop') {
        const w = (n.p || {}).wifi || {}; if (!w.ssid) continue;
        if (links.get(key(n.id, 'eth0')) && links.get(key(n.id, 'eth0')).up) continue; // câblé : le câble passe d'abord
        const ap = aps.find(a => ssidOf(a) === w.ssid);
        if (!ap) wifiWhy.set(n.id, 'nossid'); else if (passOf(ap) && passOf(ap) !== w.pass) wifiWhy.set(n.id, 'auth'); else wifiAssoc.set(n.id, ap.id);
      }
    }
    for (const [nid, apId] of assoc) if (byId.has(nid) && aps.some(a => a.id === apId)) wifiAssoc.set(nid, apId);
    // Domaines de diffusion : sommets = hôtes (leur interface), ponts (switch, AP, LAN d'une box) et WAN des box.
    const vOf = (nid, pid) => { const n = byId.get(nid); return n && n.type === 'router' && pid === 'wan' ? 'wan:' + nid : 'n:' + nid; };
    const isBridge = v => { if (!v.startsWith('n:')) return false; const r = specOf(byId.get(v.slice(2))).role; return r === 'switch' || r === 'ap' || r === 'router'; };
    const parent = new Map(), find = v => { if (!parent.has(v)) parent.set(v, v); let r = v; while (parent.get(r) !== r) r = parent.get(r); parent.set(v, r); return r; };
    const edges = [], loopV = new Set();
    for (const [k, l] of links) {
      if (!l.up || !l.peer) continue;
      const [nid, pid] = k.split('|'); if (nid > l.peer.n || (nid === l.peer.n && pid > l.peer.p)) continue; // une fois par lien
      const a = vOf(nid, pid), b = vOf(l.peer.n, l.peer.p);
      edges.push({ a, b, an: { n: nid, p: pid }, bn: l.peer, link: l });
      if (find(a) === find(b)) { if (isBridge(a) && isBridge(b)) loopV.add(a); } else parent.set(find(a), find(b));
    }
    for (const [nid, apId] of wifiAssoc) {
      const a = 'n:' + nid, b = 'n:' + apId; edges.push({ a, b, an: { n: nid, p: 'wifi' }, bn: { n: apId, p: 'wifi' }, link: { up: true, speed: 0, wifi: true, notes: [] } });
      if (find(a) !== find(b)) parent.set(find(a), find(b));
    }
    for (const n of all) { find('n:' + n.id); if (n.type === 'router') find('wan:' + n.id); }
    const storm = new Set([...loopV].map(find));
    // Adresses : fixes d'abord (les baux DHCP les évitent), puis baux dans l'ordre des identifiants.
    const ifaces = []; // { node, v (sommet), ip, prefix, gw, src, role: 'host' | 'lan' | 'wan' }
    const domOf = v => find(v);
    const statics = new Map(); // domaine → Set(ip)
    const addStatic = (v, ip) => { const d = domOf(v); if (!statics.has(d)) statics.set(d, new Set()); statics.get(d).add(ip); };
    for (const n of all) {
      const P = n.p || {}, s = specOf(n);
      if (n.type === 'router') {
        ifaces.push({ node: n.id, v: 'n:' + n.id, ip: P.lan.ip, prefix: P.lan.prefix, gw: '', src: 'static', role: 'lan' }); addStatic('n:' + n.id, P.lan.ip);
        if (P.wan && P.wan.mode === 'static' && P.wan.ip) { ifaces.push({ node: n.id, v: 'wan:' + n.id, ip: P.wan.ip, prefix: P.wan.prefix, gw: P.wan.gw, src: 'static', role: 'wan' }); addStatic('wan:' + n.id, P.wan.ip); }
      } else if (s.role === 'host' && !n.ext && P.ip && P.ip.mode === 'static' && P.ip.ip) addStatic('n:' + n.id, P.ip.ip);
      else if (n.ext && n.ipcfg) { const c = n.ipcfg(); if (c && c.ip && c.ip !== '0.0.0.0' && !c.dhcp) addStatic('n:' + n.id, c.ip); }
    }
    const servers = d => ifaces.filter(f => f.role === 'lan' && domOf(f.v) === d && byId.get(f.node).p.dhcp && byId.get(f.node).p.dhcp.on);
    const st = { all, byId, byPort, chans, links, power, poe, edges, find, storm, ifaces, wifiAssoc, wifiWhy, aps, ssidOf, passOf, servers, statics, ver };
    S = st;
    const lease = (nid, v, mac) => {
      const d = domOf(v), sv = servers(d);
      if (!sv.length) return null;
      // Plusieurs serveurs : le premier qui répond gagne ; il change d'un client à l'autre (hachage), comme en vrai.
      let best = sv[0], bh = Infinity;
      for (const f of sv) { const h = hash(mac + f.node); if (h < bh) { bh = h; best = f; } }
      return { ...leaseFrom(best, mac, d), server: best.node };
    };
    st.lease = lease;
    for (const n of all.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const P = n.p || {}, s = specOf(n);
      if (n.type === 'router' && P.wan && P.wan.mode === 'dhcp') {
        const l = lease(n.id, 'wan:' + n.id, macFor(n.id + ':wan'));
        if (l) ifaces.push({ node: n.id, v: 'wan:' + n.id, ip: l.ip, prefix: l.prefix, gw: l.gw, src: 'dhcp', role: 'wan', server: l.server });
        continue;
      }
      if (s.role !== 'host') continue;
      const v = 'n:' + n.id, connected = edges.some(e => e.a === v || e.b === v);
      if (n.ext) {
        const c = n.ipcfg ? n.ipcfg() : null;
        if (c && c.ip && c.ip !== '0.0.0.0') ifaces.push({ node: n.id, v, ip: c.ip, prefix: c.prefix ?? 24, gw: c.gw || '', src: c.dhcp ? 'dhcp' : 'program', role: 'host' });
        else ifaces.push({ node: n.id, v, ip: '', prefix: 0, gw: '', src: 'none', role: 'host' });
        continue;
      }
      const c = P.ip || { mode: 'dhcp' };
      if (c.mode === 'static') { ifaces.push({ node: n.id, v, ip: c.ip || '', prefix: c.prefix ?? 24, gw: c.gw || '', src: 'static', role: 'host' }); continue; }
      const l = connected ? lease(n.id, v, macFor(n.id)) : null;
      if (l) ifaces.push({ node: n.id, v, ip: l.ip, prefix: l.prefix, gw: l.gw, src: 'dhcp', role: 'host', server: l.server });
      else if (connected) { const h = hash(n.id); ifaces.push({ node: n.id, v, ip: `169.254.${1 + (h % 254)}.${1 + ((h >>> 8) % 254)}`, prefix: 16, gw: '', src: 'apipa', role: 'host' }); }
      else ifaces.push({ node: n.id, v, ip: '', prefix: 0, gw: '', src: 'none', role: 'host' });
    }
    syncServices(all);
    return st;
  }
  const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  /** Bail d'un serveur DHCP (box) : la même adresse pour la même MAC, la première libre de la plage sinon. */
  function leaseFrom(f, mac, dom) {
    const box = S.byId.get(f.node), P = box.p, tab = leases.get(f.node) || new Map(); leases.set(f.node, tab);
    const net = (ipNum(f.ip) & maskOf(f.prefix)) >>> 0;
    if (!tab.has(mac)) {
      const used = new Set([...tab.values(), ...(S.statics.get(dom) || [])]);
      for (let x = Math.max(1, P.dhcp.from | 0); x <= Math.min(254, P.dhcp.to | 0); x++) { const ip = ipStr((net + x) >>> 0); if (!used.has(ip) && ip !== f.ip) { tab.set(mac, ip); break; } }
    }
    const ip = tab.get(mac); if (!ip) return { ip: '', prefix: 0, gw: '', dns: '', full: true };
    return { ip, prefix: f.prefix, gw: f.ip, dns: f.ip };
  }
  let lastSig = null;
  /** État calculé ; recalculé si un nœud du montage a changé d'adresse (src.sig : signature de ces adresses). */
  const state = () => { if (src.sig) { const g = src.sig(); if (g !== lastSig) { lastSig = g; return refresh(); } } return S || refresh(); };

  /* ---------- Services intégrés ---------- */
  function syncServices(all) {
    const want = new Map();
    for (const n of all) { const s = specOf(n); if (n.type === 'router') want.set(n.id, 'router'); else if (s.service) want.set(n.id, s.service); }
    for (const [id, sv] of services) if (want.get(id) !== sv.kind) { sv.stop(); services.delete(id); brokers.delete(id); modbus.delete(id); }
    for (const [id, kind] of want) {
      if (services.has(id)) continue;
      const stops = [];
      if (kind === 'router') {
        stops.push(udpBind(id, 67, dg => dhcpPacket(id, dg)));
        stops.push(udpBind(id, 53, dg => dnsPacket(id, dg))); // relais DNS : noms des appareils du plan
        stops.push(listen(id, 80, createHttpServer(req => statusPage(api, id, req))));
      } else if (kind === 'http') stops.push(listen(id, 80, createHttpServer(req => statusPage(api, id, req))));
      else if (kind === 'mqtt') {
        const b = createBroker({ log: e => emit({ t: 'mqtt', node: id, ...e }) }); brokers.set(id, b);
        stops.push(listen(id, 1883, sock => b.accept(sock)));
      } else if (kind === 'modbus') {
        const m = createModbusServer({ bank: () => bankOf(id), log: e => emit({ t: 'modbus', node: id, ...e }) }); modbus.set(id, m);
        stops.push(listen(id, 502, sock => m.accept(sock)));
      }
      services.set(id, { kind, stop: () => stops.forEach(f => f()) });
    }
  }
  /** Registres d'un automate : ceux du programme Ladder du projet (src.plc), sinon les siens (plan réseau). */
  function bankOf(id) {
    const d = state().byId.get(id); if (!d) return null;
    const ext = src.plc ? src.plc(d) : null; if (ext) return ext;
    const r = d.p.regs || (d.p.regs = { coils: new Array(16).fill(0), di: new Array(16).fill(0), hr: new Array(16).fill(0), ir: new Array(16).fill(0) });
    return {
      read: (t, a) => (r[t] && a < r[t].length ? r[t][a] | 0 : null),
      write: (t, a, v) => { if ((t !== 'coils' && t !== 'hr') || !r[t] || a >= r[t].length) return false; r[t][a] = t === 'coils' ? (v ? 1 : 0) : v & 0xffff; if (src.changed) src.changed('regs'); return true; },
      size: t => (r[t] ? r[t].length : 0)
    };
  }
  /** Serveur DHCP de la box (UDP 67) : DISCOVER → OFFER, REQUEST → ACK (RFC 2131), réponses en diffusion vers le port 68. */
  /** Relais DNS de la box (UDP 53) : une question de type A sur un nom du plan reçoit son adresse (src/net/dns.js). */
  function dnsPacket(boxId, dg) {
    const q = parseDnsQuery(dg.bytes); if (!q || !dg.from || dg.from === '0.0.0.0') return;
    const ip = q.qtype === 1 || q.qtype === 255 ? resolve(q.name) : null;
    emit({ t: 'dns', node: boxId, to: dg.fromNode, name: q.name, ip });
    udpSend(boxId, 53, dg.from, dg.sport, dnsResponse(dg.bytes, q, ip));
  }
  function dhcpPacket(boxId, dg) {
    const m = parseDhcp(dg.bytes); if (!m || m.op !== 1) return;
    const st = state(), f = st.ifaces.find(x => x.node === boxId && x.role === 'lan'); if (!f) return;
    const d = st.find(f.v), srcDom = st.find('n:' + dg.fromNode);
    if (d !== srcDom || !st.byId.get(boxId).p.dhcp.on) return;
    const l = leaseFrom(f, m.mac, d); if (!l.ip) return;
    const type = m.type === 1 ? 2 : m.type === 3 ? 5 : 0; if (!type) return;
    const bytes = dhcpServerPacket({ type, xid: m.xid, mac: m.mac, yiaddr: l.ip, server: f.ip, prefix: f.prefix, gw: f.ip, dns: f.ip, lease: 86400 });
    emit({ t: 'dhcp', node: boxId, to: dg.fromNode, ip: l.ip, kind: type === 2 ? 'OFFER' : 'ACK' });
    learnPath(dg.fromNode, boxId, m.mac);
    for (const [k, fn] of udpBinds) { const [nid, port] = k.split('|'); if (+port === 68 && st.find('n:' + nid) === d) fn({ from: f.ip, sport: 67, bytes, fromNode: boxId }); }
  }

  /* ---------- 2. Chemins et tables MAC ---------- */
  /** Chemin de liaison entre deux sommets d'un même domaine (liste d'arêtes orientées), ou null. */
  function l2path(va, vb) {
    const st = state(); if (va === vb) return [];
    const adj = new Map();
    for (const e of st.edges) { (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push({ to: e.b, e, from: e.an, into: e.bn }); (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push({ to: e.a, e, from: e.bn, into: e.an }); }
    const prev = new Map([[va, null]]), q = [va];
    while (q.length) {
      const v = q.shift(); if (v === vb) break;
      for (const x of adj.get(v) || []) if (!prev.has(x.to)) { prev.set(x.to, { v, x }); q.push(x.to); }
    }
    if (!prev.has(vb)) return null;
    const out = []; let v = vb;
    while (prev.get(v)) { const { v: u, x } = prev.get(v); out.unshift({ from: u, to: v, out: x.from, in: x.into, link: x.e.link }); v = u; }
    return out;
  }
  function learnPath(fromNode, toNode, mac) {
    const p = l2path('n:' + fromNode, 'n:' + toNode); if (!p) return;
    for (const h of p) {
      const n = state().byId.get(h.in.n); if (!n || specOf(n).role !== 'switch') continue;
      const t = macTables.get(n.id) || new Map(); macTables.set(n.id, t);
      t.set(mac, { port: h.in.p, t: Date.now() });
    }
  }
  const macOfNode = id => { const n = state().byId.get(id), m = n && n.ext && n.mac ? (typeof n.mac === 'function' ? n.mac() : n.mac) : ''; return m || macFor(id); };

  /* ---------- 3. Adresses et routage ---------- */
  const ifaceOf = id => state().ifaces.find(f => f.node === id && f.role === 'host') || state().ifaces.find(f => f.node === id && f.role === 'lan') || null;
  const ifacesAt = (dom, ip) => state().ifaces.filter(f => f.ip === ip && state().find(f.v) === dom);
  /** Nom ou adresse → adresse. */
  function resolve(t) {
    const s = String(t || '').trim(); if (ipNum(s) != null) return s;
    const low = s.toLowerCase().replace(/\.(local|lan)$/, '');
    const n = state().all.find(x => String(x.name || '').toLowerCase() === low); if (!n) return null;
    const f = ifaceOf(n.id); return f && f.ip ? f.ip : null;
  }
  /**
   * Envoie un paquet de l'interface f vers l'adresse dst (ttl : routeurs traversés au plus). Rend { ok, why, to (interface
   * atteinte), hops: [ { node, path } ], nat (adresse source vue par la destination), errors }.
   */
  function deliver(f, dst, ttl = 6, natSrc = null) {
    const st = state(), dom = st.find(f.v), hops = [];
    if (!f.ip) return { ok: false, why: 'noip', hops };
    if (st.storm.has(dom)) return { ok: false, why: 'storm', hops };
    const local = sameNet(f.ip, dst, f.prefix);
    let nextIp = dst;
    if (!local) {
      if (!f.gw) return { ok: false, why: isLinkLocal(f.ip) ? 'apipa' : 'nogw', hops };
      if (!sameNet(f.ip, f.gw, f.prefix)) return { ok: false, why: 'gwout', hops };
      nextIp = f.gw;
    }
    const cands = ifacesAt(dom, nextIp).filter(x => x !== f);
    if (!cands.length) return { ok: false, why: local ? 'arp' : 'gwunreach', hops };
    const t = cands[0], path = l2path(f.v, t.v);
    if (!path) return { ok: false, why: local ? 'arp' : 'gwunreach', hops };
    const errors = path.some(h => h.link && h.link.errors);
    hops.push({ node: t.node, path, dup: cands.length > 1 });
    if (local || t.ip === dst) return { ok: true, to: t, hops, errors, dup: cands.length > 1, nat: natSrc || f.ip };
    // La passerelle doit router : une box (LAN ↔ WAN).
    const r = st.byId.get(t.node); if (!r || r.type !== 'router' || ttl <= 0) return { ok: false, why: 'gwnotrouter', hops };
    const own = st.ifaces.filter(x => x.node === r.id);
    const hit = own.find(x => x.ip === dst); if (hit) return { ok: true, to: hit, hops, errors, nat: natSrc || f.ip };
    let out = own.find(x => x.ip && sameNet(x.ip, dst, x.prefix) && x !== t);
    if (!out) out = own.find(x => x.role === 'wan' && x.ip && x.gw);
    if (!out) return { ok: false, why: 'noroute', hops };
    if (t.role === 'wan' && out.role === 'lan') return { ok: false, why: 'nat', hops }; // l'extérieur n'entre pas (traduction d'adresses)
    const nat = out.role === 'wan' && t.role === 'lan' ? out.ip : natSrc || f.ip;
    const r2 = deliver(out, dst, ttl - 1, nat);
    return { ...r2, hops: hops.concat(r2.hops), errors: errors || r2.errors };
  }
  /** Ping de from (id) vers target (adresse ou nom). Rend { ok, why, ip, hops, ms, text? }. */
  function ping(from, target) {
    const st = state(), n = st.byId.get(from); if (!n) return { ok: false, why: 'nonode' };
    const dst = resolve(target); if (!dst) return { ok: false, why: 'dns', target };
    const f = ifaceOf(from);
    const v = 'n:' + from, linked = st.edges.some(e => e.a === v || e.b === v);
    if (!linked && specOf(n).role === 'host') return { ok: false, why: n.type === 'laptop' && st.wifiWhy.get(from) ? 'wifi:' + st.wifiWhy.get(from) : 'nolink', ip: dst };
    if (!f || !f.ip) return { ok: false, why: 'noip', ip: dst };
    if (f.ip === dst) return { ok: true, ip: dst, hops: [], ms: 0, self: true };
    const go = deliver(f, dst);
    if (!go.ok) { emit({ t: 'ping', from, ip: dst, ok: false, why: go.why }); return { ok: false, why: go.why, ip: dst, hops: go.hops }; }
    const back = deliver(go.to, go.nat);
    const ok = back.ok && !go.errors && !back.errors;
    const why = !back.ok ? 'reply:' + back.why : go.errors || back.errors ? 'errors' : null;
    if (back.ok) { learnPath(from, go.hops[0].node, macOfNode(from)); learnPath(go.hops[0].node, from, macOfNode(go.hops[0].node)); for (const h of go.hops) learnPath(h.node, from, macOfNode(h.node)); }
    const ms = ok ? 1 + go.hops.length + Math.round((go.hops[0].path || []).length * 0.3) : null;
    emit({ t: 'ping', from, to: go.to.node, ip: dst, ok, why, hops: go.hops.map(h => h.node) });
    return { ok, why, ip: dst, to: go.to.node, hops: go.hops, ms, dup: !!go.dup };
  }

  /* ---------- 4. TCP et UDP ---------- */
  function listen(node, port, accept) { const k = key(node, port); listeners.set(k, accept); return () => { if (listeners.get(k) === accept) listeners.delete(k); }; }
  function udpBind(node, port, fn) { const k = key(node, port); udpBinds.set(k, fn); return () => { if (udpBinds.get(k) === fn) udpBinds.delete(k); }; }
  /** Connexion TCP : rend { ok, why, sock } ; sock : { write(octets ou texte), onData(fn), onClose(fn), close(), rx, open, remote }. */
  function connect(from, ip, port) {
    const st = state(), f = ifaceOf(from);
    if (!f || !f.ip) return { ok: false, why: 'noip' };
    let to;
    if (f.ip === ip) to = { node: from, ip };
    else {
      const go = deliver(f, ip); if (!go.ok) return { ok: false, why: go.why };
      const back = deliver(go.to, go.nat); if (!back.ok) return { ok: false, why: 'reply:' + back.why };
      if (go.errors || back.errors) return { ok: false, why: 'errors' };
      to = { node: go.to.node, ip: go.to.ip, nat: go.nat };
    }
    const acc = listeners.get(key(to.node, port));
    if (!acc) { emit({ t: 'tcp', from, to: to.node, port, ok: false }); return { ok: false, why: 'refused' }; }
    const [a, b] = pipe({ ip, port }, { ip: to.nat || f.ip, port: 49152 + (hash(from + ip + port + Date.now()) % 16000) });
    a.node = from; b.node = to.node;
    emit({ t: 'tcp', from, to: to.node, port, ok: true });
    void st;
    try { acc(b); } catch (e) { console.error(e); }
    return { ok: true, sock: a };
  }
  /** Datagramme UDP (255.255.255.255 : tout le domaine de diffusion de l'émetteur). Rend true s'il est remis. */
  function udpSend(from, sport, ip, dport, bytes) {
    const st = state(), f = ifaceOf(from), dom = st.find('n:' + from);
    if (st.storm.has(dom)) return false;
    const dg = { from: f && f.ip ? f.ip : '0.0.0.0', sport, bytes: Uint8Array.from(bytes), fromNode: from };
    if (ip === '255.255.255.255') {
      let n = 0;
      for (const [k, fn] of udpBinds) { const [nid, port] = k.split('|'); if (+port === dport && nid !== from && st.find('n:' + nid) === dom) { fn(dg); n++; } }
      return n > 0;
    }
    if (!f || !f.ip) return false;
    const go = deliver(f, ip); if (!go.ok || go.errors) return false;
    const fn = udpBinds.get(key(go.to.node, dport)); if (!fn) return false;
    fn({ ...dg, from: go.nat }); return true;
  }

  /* ---------- Wi-Fi ---------- */
  /** Réseaux visibles : points d'accès alimentés et Wi-Fi des box. */
  const wifiNetworks = () => state().aps.map(a => ({ ssid: state().ssidOf(a), pass: state().passOf(a), rssi: a.type === 'router' ? -48 : -44, node: a.id }));
  /** Une carte rejoint un réseau (WiFi.begin) : { ok, why: 'nossid' | 'auth', lease } ; le bail vient du DHCP du domaine. */
  function wifiJoin(node, ssid, pass, mac) {
    const ap = wifiNetworks().find(x => x.ssid === ssid);
    if (!ap) { assoc.delete(node); refresh(); return { ok: false, why: 'nossid' }; }
    if (ap.pass && ap.pass !== pass) { assoc.delete(node); refresh(); return { ok: false, why: 'auth' }; }
    assoc.set(node, ap.node); refresh();
    const l = state().lease(node, 'n:' + node, mac || macFor(node));
    if (l) learnPath(node, l.server, mac || macFor(node));
    return { ok: true, ap: ap.node, lease: l };
  }
  function wifiLeave(node) { if (assoc.delete(node)) refresh(); }
  /** Bail DHCP demandé par un programme (Ethernet.begin(mac) sur l'interpréteur) : null si aucun serveur ne répond. */
  function dhcpLease(node, mac) {
    const st = state(), v = 'n:' + node; if (!st.edges.some(e => e.a === v || e.b === v)) return null;
    const l = st.lease(node, v, mac || macFor(node)); if (l && l.ip) { learnPath(node, l.server, mac || macFor(node)); emit({ t: 'dhcp', node: l.server, to: node, ip: l.ip, kind: 'ACK' }); }
    return l && l.ip ? l : null;
  }

  /* ---------- Client HTTP (navigateur du PC) ---------- */
  /** Requête GET/POST de from vers une adresse http://… : Promise({ code, type, body, why }). */
  function http(from, url, o = {}) {
    const m = /^http:\/\/([^/:?#\s]+)(?::(\d+))?([^#\s]*)/i.exec(String(url || '').trim());
    if (!m) return Promise.resolve({ code: 0, why: 'url' });
    const ip = resolve(m[1]); if (!ip) return Promise.resolve({ code: 0, why: 'dns' });
    const c = connect(from, ip, m[2] ? +m[2] : 80); if (!c.ok) return Promise.resolve({ code: 0, why: c.why });
    const path = m[3] || '/', body = o.body || '';
    const req = `${o.method || 'GET'} ${path.startsWith('/') ? path : '/' + path} HTTP/1.1\r\nHost: ${m[1]}\r\nUser-Agent: JollofBrowser/1.0\r\nConnection: close\r\n${body ? `Content-Type: application/x-www-form-urlencoded\r\nContent-Length: ${body.length}\r\n` : ''}\r\n${body}`;
    return new Promise(res => {
      let buf = '', done = false;
      const finish = why => {
        if (done) return; done = true; clearTimeout(t);
        const i = buf.indexOf('\r\n\r\n'), head = i >= 0 ? buf.slice(0, i) : buf, rest = i >= 0 ? buf.slice(i + 4) : '';
        const code = +((/^HTTP\/\d\.\d\s+(\d+)/.exec(head) || [])[1] || 0), type = (/\r\ncontent-type:\s*([^\r\n]+)/i.exec('\r\n' + head) || [])[1] || 'text/html';
        res({ code, type, body: fromBytes(code ? rest : buf), why: code ? null : why || 'noreply', raw: buf });
        try { c.sock.close(); } catch (e) { /* déjà fermée */ }
      };
      const t = setTimeout(() => finish('timeout'), o.timeout || 4000);
      c.sock.onData(d => {
        buf += d;
        const i = buf.indexOf('\r\n\r\n'), len = /\r\ncontent-length:\s*(\d+)/i.exec('\r\n' + buf.slice(0, i));
        if (i >= 0 && len && buf.length - i - 4 >= +len[1]) finish();
      });
      c.sock.onClose(() => finish('closed'));
      c.sock.write(req);
    });
  }

  const api = {
    refresh, state, nodes, ping, resolve, connect, listen, udpBind, udpSend, http, wifiJoin, wifiLeave, wifiNetworks, dhcpLease,
    get version() { return ver; },
    /** Port (nœud, port) : { up, speed, why, notes, errors, mdix, peer, ch } ou null (rien de branché). */
    port: (n, p) => state().links.get(key(n, p)) || null,
    channel: (n, p) => state().chans.get(key(n, p)) || null,
    power: n => state().power.get(n) || null,
    poe: n => state().poe.get(n) || null,
    ipOf: id => ifaceOf(id),
    ifaces: () => state().ifaces.slice(),
    wifiOf: id => ({ ap: state().wifiAssoc.get(id) || null, why: state().wifiWhy.get(id) || null }),
    macTable(id) { const t = macTables.get(id); return t ? [...t].map(([mac, x]) => ({ mac, port: x.port, node: nodeByMac(mac) })) : []; },
    clearMac(id) { macTables.delete(id); },
    macOf: macOfNode,
    broker: id => brokers.get(id) || null,
    modbus: id => modbus.get(id) || null,
    bank: id => bankOf(id),
    on(fn) { hooks.add(fn); return () => hooks.delete(fn); },
    events: () => events.slice(),
    /** Tout oublier (nouveau projet) : baux, tables MAC, associations, services. */
    reset() { leases.clear(); macTables.clear(); assoc.clear(); for (const s of services.values()) s.stop(); services.clear(); brokers.clear(); modbus.clear(); events = []; S = null; }
  };
  const nodeByMac = mac => { const st = state(); const n = st.all.find(x => macOfNode(x.id) === mac); return n ? n.id : null; };
  return api;
}

/** Deux bouts d'une connexion TCP : ce que l'un écrit arrive chez l'autre (texte ou octets, rendus en texte latin-1). */
export function pipe(ra, rb) {
  const mk = remote => ({ rx: [], open: true, remote, fns: [], closes: [], node: null,
    onData(fn) { this.fns.push(fn); if (this.rx.length) { const d = this.rx.splice(0).join(''); fn(d); } },
    onClose(fn) { this.closes.push(fn); },
    write(d) { if (!this.open || !this.peer.open) return 0; const s = byteStr(d); if (this.peer.fns.length) this.peer.fns.forEach(f => f(s)); else this.peer.rx.push(s); return s.length; },
    read() { return this.rx.splice(0).join(''); },
    close() { if (!this.open) return; this.open = false; const p = this.peer; if (p.open) { p.open = false; p.closes.forEach(f => f()); } this.closes.forEach(f => f()); }
  });
  const a = mk(ra), b = mk(rb); a.peer = b; b.peer = a;
  return [a, b];
}
export { hostOk };
