// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Le réseau simulé, commun à tous les moteurs : le plan réseau (src/net/ui), l'interpréteur (src/prog/runtime.js :
// Ethernet, Wi-Fi, PubSubClient, Modbus), les vrais programmes sur avr8js, rp2040js et l'ESP32 (modèle W5500 de
// src/emu/devices/w5500.js), le vérificateur (issues.js), les TP et les outils de l'IA.
//
// Couches simulées, sans horloge (tout se recalcule quand le plan change) :
//   1. physique : alimentation PoE (budget, classes), canal de chaque port (câbles bout à bout à travers prises et
//      panneau), carte de câblage, négociation du lien (vitesse, Auto-MDIX, paires, catégorie, longueur) ;
//      cages SFP et fibre (modules, bilan optique : fibre.js) ;
//   2. liaison (l2.js) : segments, VLAN 802.1Q, Spanning Tree rapide des switchs administrables, agrégats LACP, domaines
//      de diffusion, boucles (pas de Spanning Tree sur un switch non administrable : tempête de diffusion), tables MAC ;
//   3. réseau : adresses (fixes, DHCP local ou par relais, locale au lien 169.254 quand aucun serveur ne répond),
//      passerelle, routage saut par saut (box : LAN ↔ WAN ; routeurs et switchs de niveau 3 : routes connectées, statiques,
//      par défaut, plus long préfixe, TTL), listes d'accès, traduction d'adresses et redirection de ports, ping et
//      traceroute avec la raison d'un échec ;
//   4. transport et services : connexions TCP (flux d'octets), datagrammes UDP (DHCP), et les services des équipements
//      (DHCP, pages web d'état, broker MQTT, serveur Modbus TCP).
// Les nœuds « externes » viennent du montage électronique (module W5500, carte Wi-Fi) : ext() les donne à chaque appel.
import { DEVICES, EXTERNAL, specOf, portsOf } from './devices.js';
import { analyzeChain, CATS } from './cable.js';
import { NET } from './limits.js';
import { ipNum, ipStr, maskOf, sameNet, hostOk, macFor, isLinkLocal, netOf } from './ip.js';
import { computeL2, l2route, nodeOfVertex } from './l2.js';
import { vlansInUse, aclAllows, parseNet, inNet, portCfg, SERVES, ifName } from './vlan.js';
import * as FIB from './fibre.js';
import { computeOspf } from './ospf.js';
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
/** Carte de câblage d'un canal, gardée en mémoire (un grand plan a des milliers de canaux qui changent rarement). */
/** Canal (câbles bout à bout d'un port actif à l'autre) ; segs (fiches de chaque câble, retournées ou non) n'est calculé
 *  que quand on le lit (testeur, carte de câblage pas encore en mémoire). */
class Chan {
  constructor(o) { Object.assign(this, o); this._segs = null; }
  get segs() { return this._segs || (this._segs = this.cables.map((c, i) => ({ ...c.wire, flip: this.flips[i] }))); }
}
/**
 * Numéro du contenu des fiches d'un câble (clé de la mémoire des cartes de câblage). Gardé par objet : il reste valable tant
 * que les fiches (a, b) et les conducteurs coupés (cut) sont les mêmes objets (les éditeurs les remplacent à chaque
 * modification) ; sinon le contenu est relu.
 */
const WIRE_IDS = new WeakMap();
function wireId(w) {
  if (!w || typeof w !== 'object') return '-';
  const m = WIRE_IDS.get(w); if (m && m.a === w.a && m.b === w.b && m.cut === w.cut) return m.id;
  const j = JSON.stringify(w); let id = WIRES.get(j);
  if (id == null) { if (WIRES.size > 20000) { WIRES.clear(); CHAINS.clear(); } id = String(WIRES.size); WIRES.set(j, id); }
  WIRE_IDS.set(w, { a: w.a, b: w.b, cut: w.cut, id }); return id;
}
const TYPE_PORTS = new Map(); // type → Map(port → port) pour les types aux ports fixes
const CAT_OF_RANK = Object.fromEntries(Object.keys(CATS).map(k => [CATS[k].rank, k]).reverse());
const CHAINS = new Map(), WIRES = new Map(); // carte par suite de fiches ; numéro de chaque fiche (contenu → n°)
function chainOf(segsOf, k) {
  let r = CHAINS.get(k);
  if (!r) { r = analyzeChain(segsOf()); if (CHAINS.size > 6000) CHAINS.clear(); CHAINS.set(k, r); }
  return r;
}
/** Durée de vie d'un paquet (sauts de routeur au plus) : valeur du simulateur, pour arrêter une boucle de routage. */
const TTL = 64;
/** Le nœud route-t-il ? Box, routeur d'entreprise, switch de niveau 3 au routage actif. */
const isRouter = n => !!n && (n.type === 'router' || n.type === 'routerpro' || (n.type === 'l3switch' && (n.p || {}).routing !== false));

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
  // Ports de chaque nœud, calculés une fois par nœud (les nœuds sont recopiés à chaque recalcul).
  const PM = new WeakMap();
  // Types aux ports fixes (la plupart) : une seule table par type, gardée d'un recalcul à l'autre.
  const pmap = n => {
    let m = PM.get(n); if (m) return m;
    const sp = specOf(n), fixed = sp && sp.ports.length === 0 && !n.ext;
    if (fixed && TYPE_PORTS.has(n.type)) m = TYPE_PORTS.get(n.type);
    else { m = new Map(portsOf(n).map(p => [p.id, p])); if (fixed) TYPE_PORTS.set(n.type, m); }
    PM.set(n, m); return m;
  };
  const portOf = (n, id) => (n ? pmap(n).get(id) || null : null);
  let WJ = new Map();
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
    const flips = [], cables = [], keys = [];
    let cur = { n, p }, far = null, len = 0, rank = 9, perm = 0, dead = false, nf = 0;
    for (let guard = 0; guard < 16; guard++) {
      const c = byPort.get(key(cur.n, cur.p)); if (!c || cables.includes(c)) { dead = true; break; }
      const flip = !(c.a[0] === cur.n && c.a[1] === cur.p);
      flips.push(flip); cables.push(c); if (c.media === 'fibre') nf++;
      let w = WJ.get(c.id); if (w == null) { w = wireId(c.wire); WJ.set(c.id, w); } keys.push(flip ? '~' + w : w);
      len += +c.len || 0; if (c.media !== 'fibre') rank = Math.min(rank, (CATS[c.cat] || CATS.cat5e).rank);
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
    // Support : cuivre, fibre, ou mélange des deux (un câble fibre n'a pas de carte de câblage).
    const media = !nf ? 'copper' : nf === cables.length ? 'fibre' : 'mixed';
    const ch = new Chan({ cables, flips, far: dead ? null : far, len, rank: rank === 9 ? 0 : rank, cat: CAT_OF_RANK[rank] || null, perm, cords: len - perm, an: null, media, keys });
    ch.an = cables.length && media === 'copper' ? chainOf(() => ch.segs, keys.join('|')) : null;
    return ch;
  }

  /** Le même canal vu de l'autre bout (n, p) : câbles dans l'ordre inverse, chaque fiche retournée. */
  function reverseOf(ch, n, p) {
    const keys = ch.keys.slice().reverse().map(k => (k[0] === '~' ? k.slice(1) : '~' + k));
    const r = new Chan({ cables: ch.cables.slice().reverse(), flips: ch.flips.slice().reverse().map(f => !f), far: { n, p }, len: ch.len, rank: ch.rank, cat: ch.cat, perm: ch.perm, cords: ch.cords, an: null, media: ch.media, keys });
    r.an = r.cables.length && r.media === 'copper' ? chainOf(() => r.segs, keys.join('|')) : null;
    return r;
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

  /**
   * Lien entre deux ports, cages SFP et fibre comprises (fibre.js) : un module cuivre se comporte comme un port RJ45 de sa
   * vitesse ; un module optique sur un canal fibre : bilan optique (fibreLink), rangé dans le lien (.fibre).
   */
  function linkOf(n, pa, m, pb, ch) {
    const fib = ch.media !== 'copper';
    if (!pa.sfp && !pb.sfp && !fib) return negotiate(pa, pb, ch);
    if (typeof FIB.fibreLink !== 'function') {
      // Sans le module fibre : une cage se comporte comme un port RJ45 de sa vitesse.
      if (fib) return { up: false, speed: 0, why: 'media', notes: [] };
      return negotiate(pa, pb, ch);
    }
    if ((!pa.sfp || !pb.sfp) && fib) return { up: false, speed: 0, why: 'media', notes: [] }; // port RJ45 au bout d'une fibre
    const at = (d, p) => (p.sfp ? FIB.moduleAt(d, p.id) : null), ma = at(n, pa), mb = at(m, pb);
    if ((pa.sfp && !ma) || (pb.sfp && !mb)) return { up: false, speed: 0, why: 'nomodule', notes: [] };
    if (typeof FIB.cageFits === 'function' && ((ma && !FIB.cageFits(pa.sfp, ma)) || (mb && !FIB.cageFits(pb.sfp, mb)))) return { up: false, speed: 0, why: 'cage', notes: [] };
    const fl = FIB.fibreLink(FIB.fibreChannel(ch.cables, Math.max(0, ch.cables.length - 1)), ma, mb);
    if (!fl.up) return { up: false, speed: 0, why: fl.why || 'media', notes: [], fibre: fl };
    if (!fib) {
      const sp = (p, mod) => (mod && FIB.MODULES[mod] ? { ...p, speed: FIB.MODULES[mod].speed, mdix: 'auto' } : p);
      return { ...negotiate(sp(pa, ma), sp(pb, mb), ch), fibre: fl };
    }
    return { up: true, speed: fl.speed, why: null, notes: fl.errors ? ['overload'] : [], errors: !!fl.errors, mdix: false, rev: false, fibre: fl };
  }

  /* ---------- Calcul complet ---------- */
  function refresh() {
    ver++;
    const all = nodes(), byId = new Map(all.map(n => [n.id, n]));
    const byPort = new Map();
    for (const c of cablesOf()) { if (!c || !c.a || !c.b) continue; byPort.set(key(c.a[0], c.a[1]), c); byPort.set(key(c.b[0], c.b[1]), c); }
    // Canaux depuis chaque port actif câblé.
    const chans = new Map();
    WJ = new Map(); // fiches de chaque câble, écrites une fois par recalcul (clé de la mémoire des cartes de câblage)
    for (const n of all) for (const p of pmap(n).values()) {
      const k = key(n.id, p.id); if (p.passive || chans.has(k) || !byPort.has(k)) continue;
      const ch = channelFrom(byId, byPort, n.id, p.id); chans.set(k, ch);
      // L'autre bout : le même canal retourné (un seul parcours par liaison).
      if (ch.far) { const fk = key(ch.far.n, ch.far.p), fp = portOf(byId.get(ch.far.n), ch.far.p); if (fp && !fp.passive && !chans.has(fk)) chans.set(fk, reverseOf(ch, n.id, p.id)); }
    }
    // Alimentation PoE : détection sur les paires 1-2 et 3-6 (mode A), classes, budget de chaque switch.
    const power = new Map(), poe = new Map();
    for (const n of all) {
      const s = specOf(n);
      if (!n.ext && [...pmap(n).values()].some(p => p.poe === 'pd') && (n.p || {}).power !== 'adapter') power.set(n.id, { on: false, why: 'nopoe', w: 0, pse: null });
      else power.set(n.id, { on: true, why: null, w: 0, pse: null });
    }
    for (const n of all) {
      const ps = [...pmap(n).values()].filter(p => p.poe === 'pse'); if (!ps.length) continue;
      const P = n.p || {}, budget = +P.budget || 0, maxClass = LIM('POE_TYPE_MAXCLASS')[P.pseType || 'at'] ?? 4, info = { budget, used: 0, ports: [] };
      for (const p of ps) {
        const ch = chans.get(key(n.id, p.id)); if (!ch || !ch.far || !ch.an) continue;
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
    // Liens (un port coupé par l'administrateur n'a pas de lien).
    const links = new Map();
    const shut = (d, pid) => !!(specOf(d).managed && portCfg(d, pid).shut);
    for (const [k, ch] of chans) {
      if (links.has(k)) continue;
      const [nid, pid] = k.split('|'), n = byId.get(nid), pa = portOf(n, pid);
      if (!ch.far) { links.set(k, { up: false, speed: 0, why: 'open', notes: [], ch }); continue; }
      const m = byId.get(ch.far.n), pb = portOf(m, ch.far.p);
      if (!pb) { links.set(k, { up: false, speed: 0, why: 'open', notes: [], ch }); continue; }
      const off = !power.get(nid).on || !power.get(m.id).on;
      const def = d => (specOf(d).role === 'switch' || (specOf(d).role === 'router') ? 'mdix' : 'mdi');
      const r = shut(n, pid) || shut(m, pb.id) ? { up: false, speed: 0, why: 'shut', notes: [] }
        : off ? { up: false, speed: 0, why: 'power', notes: [] } : linkOf(n, { ...pa, def: pid === 'wan' ? 'mdi' : def(n) }, m, { ...pb, def: ch.far.p === 'wan' ? 'mdi' : def(m) }, ch);
      if (r.fibre && !r.up && r.fibre.why) r.why = r.fibre.why;
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
    // Liaison : segments, agrégats, Spanning Tree, VLAN, domaines de diffusion, boucles (l2.js).
    const L2 = computeL2({ all, byId, links, wifiAssoc, pmap, spec: specOf, vlans: vlansInUse(src.data() || {}), mac: macFor, lim: { cost: LIM('STP_COST'), lacp: LIM('LACP_ACTIVE') } });
    const find = L2.find, storm = L2.storm;
    const edges = L2.physical.map(e => ({ a: 'n:' + e.a.n, b: 'n:' + e.b.n, an: e.a, bn: e.b, link: e.link }));
    // Adresses : fixes d'abord (les baux DHCP les évitent), puis baux dans l'ordre des identifiants.
    const ifaces = []; // { node, v (sommet), ip, prefix, gw, src, role: 'host' | 'lan' | 'wan' | 'l3', up, port?, vlan?, nat?, helper?, aclIn?, aclOut? }
    const domOf = v => find(v);
    const statics = new Map(); // domaine → Set(ip)
    const addStatic = (v, ip) => { const d = domOf(v); if (!statics.has(d)) statics.set(d, new Set()); statics.get(d).add(ip); };
    const early = new Set(); // nœuds dont l'interface est déjà posée
    const portUp = (nid, pid) => { const l = links.get(key(nid, pid)); return !!(l && l.up); };
    for (const n of all) {
      const P = n.p || {}, s = specOf(n);
      if (n.type === 'router') {
        ifaces.push({ node: n.id, v: 'n:' + n.id, ip: P.lan.ip, prefix: P.lan.prefix, gw: '', src: 'static', role: 'lan' }); addStatic('n:' + n.id, P.lan.ip);
        if (P.wan && P.wan.mode === 'static' && P.wan.ip) { ifaces.push({ node: n.id, v: 'wan:' + n.id, ip: P.wan.ip, prefix: P.wan.prefix, gw: P.wan.gw, src: 'static', role: 'wan' }); addStatic('wan:' + n.id, P.wan.ip); }
      } else if (n.type === 'routerpro') {
        for (const f of P.ifs || []) {
          if (f.mode === 'dhcp') continue;
          const v = `r:${n.id}:${f.port}:${f.vlan}`;
          ifaces.push({ node: n.id, v, ip: f.ip, prefix: f.prefix, gw: '', src: 'static', role: 'l3', up: portUp(n.id, f.port), port: f.port, vlan: f.vlan, nat: f.nat, helper: f.helper, o82: !!f.o82, aclIn: f.aclIn, aclOut: f.aclOut });
          if (f.ip) addStatic(v, f.ip);
        }
      } else if (n.type === 'l3switch') {
        for (const f of P.svis || []) {
          const v = `m:${n.id}:${f.vlan}`;
          ifaces.push({ node: n.id, v, ip: f.ip, prefix: f.prefix, gw: '', src: 'static', role: 'l3', up: L2.vlanUp.has(key(n.id, f.vlan)), port: 'vlan' + f.vlan, vlan: f.vlan, nat: '', helper: f.helper, o82: !!f.o82, aclIn: f.aclIn, aclOut: f.aclOut, svi: true });
          if (f.ip) addStatic(v, f.ip);
        }
      } else if (s.role === 'host' && !n.ext && P.ip && P.ip.mode === 'static' && P.ip.ip) {
        addStatic('n:' + n.id, P.ip.ip);
        // Un serveur à adresse fixe est connu dès maintenant (il peut servir le DHCP aux autres).
        if (n.type === 'server') { ifaces.push({ node: n.id, v: 'n:' + n.id, ip: P.ip.ip, prefix: P.ip.prefix ?? 24, gw: P.ip.gw || '', src: 'static', role: 'host' }); early.add(n.id); }
      }
      else if (n.ext && n.ipcfg) { const c = n.ipcfg(); if (c && c.ip && c.ip !== '0.0.0.0' && !c.dhcp) addStatic('n:' + n.id, c.ip); }
    }
    const st = { all, byId, byPort, chans, links, power, poe, edges, find, storm, ifaces, wifiAssoc, wifiWhy, aps, ssidOf, passOf, statics, ver, l2: L2, linked: L2.linked, full: new Map(), relays: new Map(), rt: new Map(), rt0: new Map() };
    st.servers = d => sourcesOf(st, d);
    S = st;
    const lease = (nid, v, mac) => {
      const d = domOf(v), sv = sourcesOf(st, d);
      if (!sv.length) return null;
      // Plusieurs serveurs : le premier qui répond gagne ; il change d'un client à l'autre (hachage), comme en vrai.
      let best = sv[0], bh = Infinity;
      for (const f of sv) { const h = hash(mac + f.node + (f.f ? f.f.v : '')); if (h < bh) { bh = h; best = f; } }
      // Relais avec l'option 82 (RFC 3046) : le serveur reçoit l'interface du relais (circuit) et son adresse MAC (distant).
      const o82 = best.kind === 'relay' && best.f.o82 ? { circuit: ifName(best.f), remote: macFor(best.f.node) } : null;
      return { ...leaseFrom(best, mac, d), server: best.node, relay: best.kind === 'relay' ? best.f.node : null, o82 };
    };
    st.lease = lease;
    for (const n of all.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const P = n.p || {}, s = specOf(n);
      if (n.type === 'router' && P.wan && P.wan.mode === 'dhcp') {
        const l = lease(n.id, 'wan:' + n.id, macFor(n.id + ':wan'));
        if (l) ifaces.push({ node: n.id, v: 'wan:' + n.id, ip: l.ip, prefix: l.prefix, gw: l.gw, src: 'dhcp', role: 'wan', server: l.server });
        continue;
      }
      if (n.type === 'routerpro') {
        for (const f of P.ifs || []) {
          if (f.mode !== 'dhcp') continue;
          const v = `r:${n.id}:${f.port}:${f.vlan}`, l = portUp(n.id, f.port) ? lease(n.id, v, macFor(`${n.id}:${f.port}.${f.vlan}`)) : null;
          ifaces.push({ node: n.id, v, ip: l ? l.ip : '', prefix: l ? l.prefix : 0, gw: l ? l.gw : '', dns: l ? l.dns : '', src: 'dhcp', role: 'l3', up: portUp(n.id, f.port), port: f.port, vlan: f.vlan, nat: f.nat, helper: f.helper, o82: !!f.o82, aclIn: f.aclIn, aclOut: f.aclOut, server: l ? l.server : null });
        }
        continue;
      }
      if (s.role !== 'host' || early.has(n.id)) continue;
      const v = 'n:' + n.id, connected = L2.linked.has(n.id);
      if (n.ext) {
        const c = n.ipcfg ? n.ipcfg() : null;
        if (c && c.ip && c.ip !== '0.0.0.0') ifaces.push({ node: n.id, v, ip: c.ip, prefix: c.prefix ?? 24, gw: c.gw || '', src: c.dhcp ? 'dhcp' : 'program', role: 'host' });
        else ifaces.push({ node: n.id, v, ip: '', prefix: 0, gw: '', src: 'none', role: 'host' });
        continue;
      }
      const c = P.ip || { mode: 'dhcp' };
      if (c.mode === 'static') { ifaces.push({ node: n.id, v, ip: c.ip || '', prefix: c.prefix ?? 24, gw: c.gw || '', src: 'static', role: 'host' }); continue; }
      const l = connected ? lease(n.id, v, macFor(n.id)) : null;
      if (l) ifaces.push({ node: n.id, v, ip: l.ip, prefix: l.prefix, gw: l.gw, dns: l.dns, src: 'dhcp', role: 'host', server: l.server, relay: l.relay, o82: l.o82 });
      else if (connected) { const h = hash(n.id); ifaces.push({ node: n.id, v, ip: `169.254.${1 + (h % 254)}.${1 + ((h >>> 8) % 254)}`, prefix: 16, gw: '', src: 'apipa', role: 'host' }); }
      else ifaces.push({ node: n.id, v, ip: '', prefix: 0, gw: '', src: 'none', role: 'host' });
    }
    syncServices(all);
    return st;
  }
  const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  /** Bail d'un serveur DHCP (box) : la même adresse pour la même MAC, la première libre de la plage sinon. */
  /**
   * Sources d'adresses DHCP d'un domaine de diffusion : la box (serveur de son LAN) ; l'étendue d'un routeur, d'un switch de
   * niveau 3 ou d'un serveur dont une interface est dans le domaine (celle du sous-réseau de cette interface) ; un relais
   * (interface avec une adresse d'assistance, « ip helper ») : le serveur joint choisit l'étendue qui contient l'adresse du
   * relais (giaddr, RFC 2131 §4.3.1). Calculées une fois par recalcul.
   */
  function sourcesOf(st, d) {
    if (!st.srcs) {
      const m = st.srcs = new Map(), put = (dom, x) => { if (!m.has(dom)) m.set(dom, []); m.get(dom).push(x); };
      for (const f of st.ifaces.slice()) {
        const n = st.byId.get(f.node); if (!n || !f.ip || f.up === false) continue;
        const dom = st.find(f.v);
        if (n.type === 'router') { if (f.role === 'lan' && n.p.dhcp && n.p.dhcp.on) put(dom, { kind: 'box', node: n.id, f, ip: f.ip }); continue; }
        if (SERVES.has(n.type)) {
          const list = n.p.dhcp || [], i = list.findIndex(s => s.on && inNet(f.ip, parseNet(s.net)));
          if (i >= 0) put(dom, { kind: 'scope', node: n.id, f, scope: list[i], idx: i, giaddr: f.ip, ip: f.ip });
        }
        if (f.helper && f.role === 'l3') {
          const r = relayOf(st, f); st.relays.set(f.v, r);
          if (r.ok) put(dom, { kind: 'relay', node: r.node, f, scope: r.scope, idx: r.idx, giaddr: f.ip, ip: r.ip });
        }
      }
    }
    return st.srcs.get(d) || [];
  }
  /** Relais DHCP de l'interface f : { ok, node (serveur), scope, idx, ip } ou { ok: false, why: 'noserver'|'notdhcp'|'unreach'|'noscope' }. */
  function relayOf(st, f) {
    const tgt = st.ifaces.find(x => x.ip === f.helper && x.up !== false && x.node !== f.node);
    if (!tgt) return { ok: false, why: 'noserver' };
    const n = st.byId.get(tgt.node), list = (n.p || {}).dhcp;
    if (!SERVES.has(n.type) || !Array.isArray(list) || !list.some(s => s.on)) return { ok: false, why: 'notdhcp', node: n.id };
    const go = deliver(f, f.helper, { proto: 'udp', port: 67 });
    if (!go.ok) return { ok: false, why: 'unreach', reach: go.why, node: n.id };
    const back = deliver(go.to, go.nat, { proto: 'udp', port: 67, sport: 67, reply: true });
    if (!back.ok) return { ok: false, why: 'unreach', reach: 'reply:' + back.why, node: n.id };
    const idx = list.findIndex(s => s.on && inNet(f.ip, parseNet(s.net)));
    if (idx < 0) return { ok: false, why: 'noscope', node: n.id };
    return { ok: true, node: n.id, scope: list[idx], idx, ip: tgt.ip };
  }
  /** Bail d'une source DHCP : la même adresse pour la même MAC, la première libre de la plage sinon (étendue pleine : full). */
  function leaseFrom(src, mac, dom) {
    if (src.kind === 'box') {
      const f = src.f, box = S.byId.get(f.node), P = box.p, tab = leases.get(f.node) || new Map(); leases.set(f.node, tab);
      const net = (ipNum(f.ip) & maskOf(f.prefix)) >>> 0;
      if (!tab.has(mac)) {
        const used = new Set([...tab.values(), ...(S.statics.get(dom) || [])]);
        for (let x = Math.max(1, P.dhcp.from | 0); x <= Math.min(254, P.dhcp.to | 0); x++) { const ip = ipStr((net + x) >>> 0); if (!used.has(ip) && ip !== f.ip) { tab.set(mac, ip); break; } }
      }
      const ip = tab.get(mac); if (!ip) return { ip: '', prefix: 0, gw: '', dns: '', full: true };
      return { ip, prefix: f.prefix, gw: f.ip, dns: f.ip };
    }
    const sc = src.scope, n = parseNet(sc.net); if (!n) return { ip: '', prefix: 0, gw: '', dns: '', full: true };
    const bc = (n.net | (~maskOf(n.prefix) >>> 0)) >>> 0;
    const lo = sc.from && inNet(sc.from, n) ? ipNum(sc.from) : n.net + 1, hi = sc.to && inNet(sc.to, n) ? ipNum(sc.to) : bc - 1;
    const tk = `${src.node}#${sc.net}#${lo}-${hi}`, tab = leases.get(tk) || new Map(); leases.set(tk, tab);
    const take = () => {
      const used = new Set([...tab.values(), ...(S.statics.get(dom) || []), sc.gw, src.giaddr, src.ip]);
      for (let x = lo, k = 0; x <= hi && k < 65536; x++, k++) { const ip = ipStr(x >>> 0); if (!used.has(ip)) { tab.set(mac, ip); return true; } }
      return false;
    };
    if (!tab.has(mac) && !take()) {
      // Étendue pleine : on oublie les baux d'appareils qui ne sont plus dans le plan, puis on réessaie.
      const alive = new Set(S.all.map(x => macOfNode(x.id)));
      for (const m of [...tab.keys()]) if (!alive.has(m)) tab.delete(m);
      take();
    }
    const ip = tab.get(mac);
    if (!ip) { const e = S.full.get(tk) || { node: src.node, scope: sc.net, n: 0 }; e.n++; S.full.set(tk, e); return { ip: '', prefix: 0, gw: '', dns: '', full: true }; }
    return { ip, prefix: n.prefix, gw: sc.gw || src.giaddr, dns: sc.dns || '' };
  }
  let lastSig = null;
  /** État calculé ; recalculé si un nœud du montage a changé d'adresse (src.sig : signature de ces adresses). */
  const state = () => { if (src.sig) { const g = src.sig(); if (g !== lastSig) { lastSig = g; return refresh(); } } return S || refresh(); };

  /* ---------- Services intégrés ---------- */
  function syncServices(all) {
    const want = new Map();
    for (const n of all) { const s = specOf(n); if (n.type === 'router') want.set(n.id, 'router'); else if (SERVES.has(n.type)) want.set(n.id, 'pro'); else if (s.service) want.set(n.id, s.service); }
    for (const [id, sv] of services) if (want.get(id) !== sv.kind) { sv.stop(); services.delete(id); brokers.delete(id); modbus.delete(id); }
    for (const [id, kind] of want) {
      if (services.has(id)) continue;
      const stops = [];
      if (kind === 'router') {
        stops.push(udpBind(id, 67, dg => dhcpPacket(id, dg)));
        stops.push(udpBind(id, 53, dg => dnsPacket(id, dg))); // relais DNS : noms des appareils du plan
        stops.push(listen(id, 80, createHttpServer(req => statusPage(api, id, req))));
      } else if (kind === 'pro') {
        // Routeur, switch de niveau 3, serveur : DHCP (étendues, relais) et DNS selon leurs réglages, page d'état.
        stops.push(udpBind(id, 67, dg => dhcpPacket(id, dg)));
        stops.push(udpBind(id, 53, dg => dnsPacket(id, dg)));
        if ((specOf(all.find(x => x.id === id)) || {}).service === 'http') stops.push(listen(id, 80, createHttpServer(req => statusPage(api, id, req))));
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
  /** Relais DNS (box) ou serveur DNS (routeur, serveur) sur UDP 53 : une question de type A reçoit l'adresse (src/net/dns.js). */
  function dnsPacket(srvId, dg) {
    const q = parseDnsQuery(dg.bytes); if (!q || !dg.from || dg.from === '0.0.0.0') return;
    const d = state().byId.get(srvId); if (!d || (d.type !== 'router' && !((d.p || {}).dns && d.p.dns.on))) return;
    const ip = q.qtype === 1 || q.qtype === 255 ? resolve(q.name) : null;
    emit({ t: 'dns', node: srvId, to: dg.fromNode, name: q.name, ip });
    udpSend(srvId, 53, dg.from, dg.sport, dnsResponse(dg.bytes, q, ip));
  }
  /**
   * Serveur DHCP (UDP 67) de la box, d'un routeur, d'un switch de niveau 3 ou d'un serveur : DISCOVER → OFFER, REQUEST → ACK
   * (RFC 2131), réponses en diffusion vers le port 68 du domaine du client (par le relais quand il y en a un).
   */
  function dhcpPacket(srvId, dg) {
    const m = parseDhcp(dg.bytes); if (!m || m.op !== 1) return;
    const st = state(), d = st.find('n:' + dg.fromNode);
    const sv = sourcesOf(st, d).find(x => x.node === srvId); if (!sv) return;
    const l = leaseFrom(sv, m.mac, d); if (!l.ip) return;
    const type = m.type === 1 ? 2 : m.type === 3 ? 5 : 0; if (!type) return;
    const sip = sv.ip, from = sv.kind === 'relay' ? sv.giaddr : sip;
    const bytes = dhcpServerPacket({ type, xid: m.xid, mac: m.mac, yiaddr: l.ip, server: sip, prefix: l.prefix, gw: l.gw, dns: l.dns || sip, lease: 86400 });
    emit({ t: 'dhcp', node: srvId, to: dg.fromNode, ip: l.ip, kind: type === 2 ? 'OFFER' : 'ACK', relay: sv.kind === 'relay' ? sv.f.node : null, o82: sv.kind === 'relay' && sv.f.o82 ? { circuit: ifName(sv.f), remote: macFor(sv.f.node) } : null });
    learnPath(dg.fromNode, sv.kind === 'relay' ? sv.f.node : srvId, m.mac);
    for (const [k, fn] of udpBinds) { const [nid, port] = k.split('|'); if (+port === 68 && st.find('n:' + nid) === d) fn({ from, sport: 67, bytes, fromNode: srvId }); }
  }

  /* ---------- 2. Chemins et tables MAC ---------- */
  /** Chemin de liaison entre deux sommets d'un même domaine : [{ from: 'n:u', to: 'n:w', out, in, link }], ou null. */
  function l2path(va, vb) {
    const st = state(), dom = st.find(va); if (va === vb) return [];
    if (st.find(vb) !== dom) return null;
    const a = nodeOfVertex(va), b = nodeOfVertex(vb); if (!a || !b) return null;
    return l2route(st.l2, a, b, dom, st.byId, specOf);
  }
  function learnPath(fromNode, toNode, mac) {
    const fa = ifaceOf(fromNode), fb = ifaceOf(toNode);
    const p = l2path(fa ? fa.v : 'n:' + fromNode, fb ? fb.v : 'n:' + toNode); if (!p) return;
    for (const h of p) {
      const n = state().byId.get(h.in.n); if (!n || specOf(n).role !== 'switch') continue;
      const t = macTables.get(n.id) || new Map(); macTables.set(n.id, t);
      t.set(mac, { port: h.in.p, t: Date.now() });
    }
  }
  const macOfNode = id => { const n = state().byId.get(id), m = n && n.ext && n.mac ? (typeof n.mac === 'function' ? n.mac() : n.mac) : ''; return m || macFor(id); };

  /* ---------- 3. Adresses et routage ---------- */
  /** Interface d'un nœud : celle d'un poste, le LAN d'une box, sinon la première interface active d'un routeur. */
  const ifaceOf = id => { const fs = state().ifaces; return fs.find(f => f.node === id && f.role === 'host') || fs.find(f => f.node === id && f.role === 'lan') || fs.find(f => f.node === id && f.role === 'l3' && f.ip && f.up !== false) || fs.find(f => f.node === id && f.role === 'l3') || null; };
  /** Interfaces d'adresse ip dans le domaine dom (index par adresse, refait quand la liste grandit). */
  function ifacesAt(dom, ip) {
    const st = state();
    if (!st.ipIdx || st.ipIdxN !== st.ifaces.length) { st.ipIdx = new Map(); for (const f of st.ifaces) if (f.ip) { if (!st.ipIdx.has(f.ip)) st.ipIdx.set(f.ip, []); st.ipIdx.get(f.ip).push(f); } st.ipIdxN = st.ifaces.length; }
    return (st.ipIdx.get(ip) || []).filter(f => st.find(f.v) === dom);
  }
  /** Enregistrements DNS saisis sur les serveurs DNS du plan (routeur, serveur) : nom → adresse. */
  function dnsRecords() {
    const st = state(); if (st.dnsRec) return st.dnsRec;
    const m = new Map();
    for (const n of st.all) { const D = (n.p || {}).dns; if (D && D.on && Array.isArray(D.records)) for (const r of D.records) if (!m.has(r.name)) m.set(r.name, r.ip); }
    return (st.dnsRec = m);
  }
  /** Nom ou adresse → adresse (enregistrements DNS saisis, puis noms des appareils du plan). */
  function resolve(t) {
    const s = String(t || '').trim(); if (ipNum(s) != null) return s;
    const low = s.toLowerCase().replace(/\.(local|lan)$/, '');
    const rec = dnsRecords(); if (rec.has(s.toLowerCase())) return rec.get(s.toLowerCase()); if (rec.has(low)) return rec.get(low);
    const n = state().all.find(x => String(x.name || '').toLowerCase() === low); if (!n) return null;
    const f = ifaceOf(n.id); return f && f.ip ? f.ip : null;
  }
  /**
   * Table de routage d'un nœud qui route : routes connectées (interfaces actives), route par défaut de la box (WAN) ou
   * apprise par DHCP, routes statiques dont la passerelle est sur un réseau connecté. [{ net, prefix, iface, via, kind }].
   */
  // Distances administratives (Cisco) : connectée 0, statique 1, OSPF 110, route par défaut apprise par DHCP 254.
  const AD = { ...LIM('ADMIN_DIST'), default: LIM('ADMIN_DIST').static };
  function routesNoOspf(nid) {
    const st = state(); if (st.rt0.has(nid)) return st.rt0.get(nid);
    const n = st.byId.get(nid), out = [], bad = [];
    const own = st.ifaces.filter(f => f.node === nid && f.ip && f.up !== false && f.role !== 'host');
    for (const f of own) out.push({ net: netOf(f.ip, f.prefix), prefix: f.prefix, iface: f, via: '', kind: 'connected', ad: AD.connected });
    if (n && n.type === 'router') { const w = own.find(f => f.role === 'wan' && f.gw); if (w) out.push({ net: 0, prefix: 0, iface: w, via: w.gw, kind: 'default', ad: AD.default }); }
    for (const f of own) if (f.src === 'dhcp' && f.gw && n.type === 'routerpro') out.push({ net: 0, prefix: 0, iface: f, via: f.gw, kind: 'dhcp', ad: AD.dhcp });
    for (const r of (n && n.p && n.p.routes) || []) {
      const pn = parseNet(r.net), f = own.find(x => sameNet(x.ip, r.via, x.prefix));
      if (pn && f) out.push({ net: pn.net, prefix: pn.prefix, iface: f, via: r.via, kind: 'static', ad: AD.static }); else bad.push(r);
    }
    out.bad = bad; st.rt0.set(nid, out);
    return out;
  }
  /** OSPF du plan, calculé une fois par recalcul (ospf.js). */
  function ospfOf() { const st = state(); if (!st.ospf) { st.routesNoOspf = routesNoOspf; st.ospf = computeOspf(st); } return st.ospf; }
  /**
   * Table de routage d'un nœud qui route : routes connectées (interfaces actives), route par défaut de la box (WAN) ou
   * apprise par DHCP, routes statiques dont la passerelle est sur un réseau connecté, routes OSPF. [{ net, prefix, iface,
   * via, kind, ad, metric? }] ; .bad : routes statiques inutilisables.
   */
  function routesOf(nid) {
    const st = state(); if (st.rt.has(nid)) return st.rt.get(nid);
    const base = routesNoOspf(nid), n = st.byId.get(nid);
    const o = n && n.p && n.p.ospf && n.p.ospf.on ? ospfOf().routes.get(nid) || [] : [];
    const out = [...base, ...o]; out.bad = base.bad; st.rt.set(nid, out);
    return out;
  }
  /**
   * Route vers dst : la plus longue correspondance (RFC 1812 §5.2.4.3) ; à longueur égale, la plus petite distance
   * administrative, puis la plus petite métrique ; ou null.
   */
  function lookup(nid, dst) {
    const d = ipNum(dst); if (d == null) return null;
    let best = null;
    for (const r of routesOf(nid)) {
      if (((d & maskOf(r.prefix)) >>> 0) !== r.net) continue;
      if (!best || r.prefix > best.prefix || (r.prefix === best.prefix && (r.ad - best.ad || (r.metric || 0) - (best.metric || 0)) < 0)) best = r;
    }
    return best;
  }
  const aclOf = (n, name) => (name ? ((n.p || {}).acls || []).find(a => a.name === name) || { name, rules: [] } : null);
  /**
   * Envoie un paquet de l'interface f vers l'adresse dst, saut par saut. pkt : { proto: 'icmp'|'tcp'|'udp', port, reply }
   * (une réponse TCP/UDP ne repasse pas les listes d'accès : modèle « avec état », simplifié). Rend { ok, why, to (interface
   * atteinte), hops: [{ node, path }], routers: [{ node, in, out, src }], nat (adresse source vue par la destination),
   * errors, at (interface où le paquet s'arrête), acl }.
   */
  function deliver(f, dst, pkt = {}, natSrc = null) {
    const st = state(), hops = [], routers = [];
    const P = { proto: pkt.proto || 'icmp', port: pkt.port | 0, sport: pkt.sport | 0, est: !!pkt.est, reply: !!pkt.reply };
    // Listes d'accès sans état : chaque paquet est filtré, réponses comprises (une réponse TCP porte l'indicateur ACK :
    // le mot-clé « established » la laisse passer).
    const acl = (r, name, dir, at) => { const a = aclOf(r, name); if (!a) return null; const v = aclAllows(a, { proto: P.proto, src, dst: d, port: P.port, sport: P.sport, est: P.est }); return v.ok ? null : fail('acl', { at, acl: a.name, dir, rule: v.rule, implicit: !!v.implicit, listed: dir === 'out' }); };
    let src = natSrc || (f && f.ip), d = dst, errors = false, ttl = TTL, dnat = false, nextIp, cur = f, first = true, dup = false;
    const fail = (why, x = {}) => ({ ok: false, why, hops, routers, errors, ...x });
    if (!f || !f.ip) return fail('noip');
    const fn = st.byId.get(f.node);
    if (f.role !== 'host' && isRouter(fn)) {
      // Paquet émis par un routeur : il choisit sa sortie dans sa table.
      const hit = st.ifaces.find(x => x.node === fn.id && x.ip === d);
      if (hit) return { ok: true, to: hit, hops, routers, errors, nat: src };
      const r = lookup(fn.id, d); if (!r) return fail('noroute', { at: f });
      cur = r.iface; nextIp = r.via || d; if (!natSrc) src = cur.ip;
    } else {
      const local = sameNet(f.ip, d, f.prefix);
      nextIp = d;
      if (!local) {
        if (!f.gw) return fail(isLinkLocal(f.ip) ? 'apipa' : 'nogw');
        if (!sameNet(f.ip, f.gw, f.prefix)) return fail('gwout');
        nextIp = f.gw;
      }
    }
    for (let guard = 0; guard < 4 * TTL; guard++) {
      const dom = st.find(cur.v);
      if (st.storm.has(dom)) return fail('storm', { at: cur });
      const cands = ifacesAt(dom, nextIp).filter(x => x !== cur && x.up !== false), miss = nextIp === d ? 'arp' : 'gwunreach';
      if (!cands.length) return fail(miss, { at: cur });
      const t = cands[0], path = l2path(cur.v, t.v);
      if (!path) return fail(miss, { at: cur });
      if (path.some(h => h.link && h.link.errors)) errors = true;
      hops.push({ node: t.node, path, dup: cands.length > 1 });
      if (first) dup = cands.length > 1;
      first = false;
      const r = st.byId.get(t.node);
      if (t.role === 'l3') { const no = acl(r, t.aclIn, 'in', t); if (no) return no; }
      // Redirection de port : une connexion qui arrive sur l'adresse « extérieur » du routeur repart vers un serveur intérieur.
      const fwHere = t.ip === d && t.nat === 'outside' && !P.reply && (P.proto === 'tcp' || P.proto === 'udp') ? ((r.p || {}).fwd || []).find(z => z.proto === P.proto && z.port === P.port) : null;
      if (fwHere) { d = fwHere.to; P.port = fwHere.toPort; dnat = true; }
      else if (t.ip === d) return { ok: true, to: t, hops, routers, errors, dup, nat: src, port: P.port, dnat };
      if (t.role === 'host' || !isRouter(r)) return fail('gwnotrouter', { at: t });
      if (r.type === 'router') {
        // Box : LAN ↔ WAN, traduction d'adresses à la sortie, l'extérieur n'entre pas.
        if (--ttl <= 0) return fail('ttl', { at: t, listed: true });
        const own = st.ifaces.filter(x => x.node === r.id);
        const hit = own.find(x => x.ip === d); if (hit) return { ok: true, to: hit, hops, routers, errors, dup, nat: src };
        const out = own.find(x => x.ip && sameNet(x.ip, d, x.prefix) && x !== t) || own.find(x => x.role === 'wan' && x.ip && x.gw);
        if (!out) return fail('noroute', { at: t, listed: true });
        if (t.role === 'wan' && out.role === 'lan') return fail('nat', { at: t });
        routers.push({ node: r.id, in: t, out, src });
        if (out.role === 'wan' && t.role === 'lan') src = out.ip;
        cur = out;
        if (sameNet(out.ip, d, out.prefix)) nextIp = d;
        else { if (!out.gw) return fail('nogw', { at: out }); if (!sameNet(out.ip, out.gw, out.prefix)) return fail('gwout', { at: out }); nextIp = out.gw; }
        continue;
      }
      // Routeur d'entreprise ou switch de niveau 3.
      const own = st.ifaces.filter(x => x.node === r.id && x.up !== false), hit = own.find(x => x.ip === d);
      if (hit) {
        const fw = hit.nat === 'outside' && !P.reply && (P.proto === 'tcp' || P.proto === 'udp') ? ((r.p || {}).fwd || []).find(z => z.proto === P.proto && z.port === P.port) : null;
        if (!fw) return { ok: true, to: hit, hops, routers, errors, dup, nat: src, port: P.port, dnat };
        d = fw.to; P.port = fw.toPort; dnat = true; // redirection de port vers un serveur de l'intérieur
      }
      if (--ttl <= 0) return fail('ttl', { at: t, listed: true });
      const rt = lookup(r.id, d); if (!rt) return fail('noroute', { at: t, listed: true });
      const out = rt.iface;
      { const no = acl(r, out.aclOut, 'out', out); if (no) return no; }
      if (t.nat === 'outside' && out.nat === 'inside' && !dnat) return fail('nat', { at: t });
      routers.push({ node: r.id, in: t, out, src });
      if (t.nat === 'inside' && out.nat === 'outside') src = out.ip; // traduction d'adresses (masquerade, RFC 3022)
      if (out === t && !rt.via && nextIp === d) return fail('arp', { at: out });
      cur = out; nextIp = rt.via || d;
    }
    return fail('ttl');
  }
  /** Ping de from (id) vers target (adresse ou nom). Rend { ok, why, ip, hops, ms, text? }. */
  function ping(from, target) {
    const st = state(), n = st.byId.get(from); if (!n) return { ok: false, why: 'nonode' };
    const dst = resolve(target); if (!dst) return { ok: false, why: 'dns', target };
    const f = ifaceOf(from);
    if (!st.linked.has(from) && specOf(n).role === 'host') return { ok: false, why: n.type === 'laptop' && st.wifiWhy.get(from) ? 'wifi:' + st.wifiWhy.get(from) : 'nolink', ip: dst };
    if (!f || !f.ip) return { ok: false, why: 'noip', ip: dst };
    if (f.ip === dst || st.ifaces.some(x => x.node === from && x.ip === dst)) return { ok: true, ip: dst, hops: [], ms: 0, self: true };
    const go = deliver(f, dst);
    if (!go.ok) { emit({ t: 'ping', from, ip: dst, ok: false, why: go.why }); return { ok: false, why: go.why, ip: dst, hops: go.hops, at: go.at ? go.at.node : null, acl: go.acl || null }; }
    const back = deliver(go.to, go.nat);
    const ok = back.ok && !go.errors && !back.errors;
    const why = !back.ok ? 'reply:' + back.why : go.errors || back.errors ? 'errors' : null;
    if (back.ok) { learnPath(from, go.hops[0].node, macOfNode(from)); learnPath(go.hops[0].node, from, macOfNode(go.hops[0].node)); for (const h of go.hops) learnPath(h.node, from, macOfNode(h.node)); }
    const ms = ok ? 1 + go.hops.length + Math.round(((go.hops[0] && go.hops[0].path) || []).length * 0.3) : null;
    emit({ t: 'ping', from, to: go.to.node, ip: dst, ok, why, hops: go.hops.map(h => h.node) });
    return { ok, why, ip: dst, to: go.to.node, hops: go.hops, ms, dup: !!go.dup, routers: go.routers.map(x => x.node) };
  }
  /**
   * Traceroute de from vers target : chaque routeur traversé répond (ICMP « durée de vie dépassée », RFC 792 et RFC 1812
   * §5.3.1) depuis son interface d'entrée, puis la destination. Rend { ok, why, ip, hops: [{ n, node, ip, ms, ok, why? }] }.
   */
  function trace(from, target, max = 30) {
    const st = state(), n = st.byId.get(from); if (!n) return { ok: false, why: 'nonode', hops: [] };
    const dst = resolve(target); if (!dst) return { ok: false, why: 'dns', target, hops: [] };
    const f = ifaceOf(from);
    if (!st.linked.has(from) && specOf(n).role === 'host') return { ok: false, why: 'nolink', ip: dst, hops: [] };
    if (!f || !f.ip) return { ok: false, why: 'noip', ip: dst, hops: [] };
    const go = deliver(f, dst), hops = [];
    const answer = (iface, to) => { const b = deliver(iface, to); return b.ok; };
    for (const x of go.routers.slice(0, max)) hops.push({ n: hops.length + 1, node: x.node, ip: x.in.ip, ok: answer(x.in, x.src), ms: hops.length + 1 });
    if (hops.length >= max && !(go.ok && go.routers.length < max)) { emit({ t: 'trace', from, ip: dst, ok: false, why: 'maxhops' }); return { ok: false, why: 'maxhops', ip: dst, hops }; }
    if (go.ok) {
      const b = deliver(go.to, go.nat), ok = b.ok && !go.errors;
      hops.push({ n: hops.length + 1, node: go.to.node, ip: dst, ok, ms: hops.length + 1, why: ok ? null : b.ok ? 'errors' : 'reply:' + b.why });
      emit({ t: 'trace', from, ip: dst, ok, hops: hops.map(h => h.node) });
      return { ok, why: ok ? null : hops[hops.length - 1].why, ip: dst, hops };
    }
    if (go.at && go.listed && go.at.node !== from) hops.push({ n: hops.length + 1, node: go.at.node, ip: go.at.ip, ok: answer(go.at, f.ip), ms: hops.length + 1 });
    hops.push({ n: hops.length + 1, node: null, ip: null, ok: false, why: go.why });
    emit({ t: 'trace', from, ip: dst, ok: false, why: go.why });
    return { ok: false, why: go.why, ip: dst, hops, at: go.at ? go.at.node : null, acl: go.acl || null };
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
      const go = deliver(f, ip, { proto: 'tcp', port }); if (!go.ok) return { ok: false, why: go.why };
      const eph = 49152 + (hash(from + ip + port) % 16000); // port éphémère du client (stable : le même pour un même essai)
      const back = deliver(go.to, go.nat, { proto: 'tcp', port: eph, sport: go.dnat ? go.port : port, est: true, reply: true }); if (!back.ok) return { ok: false, why: 'reply:' + back.why };
      if (go.errors || back.errors) return { ok: false, why: 'errors' };
      to = { node: go.to.node, ip: go.to.ip, nat: go.nat, port: go.dnat ? go.port : port };
    }
    const acc = listeners.get(key(to.node, to.port || port));
    if (!acc) { emit({ t: 'tcp', from, to: to.node, port, ok: false }); return { ok: false, why: 'refused' }; }
    const [a, b] = pipe({ ip, port }, { ip: to.nat || f.ip, port: 49152 + (hash(from + ip + port + Date.now()) % 16000) });
    a.node = from; b.node = to.node;
    emit({ t: 'tcp', from, to: to.node, port, ok: true });
    void st;
    try { acc(b); } catch (e) { console.error(e); }
    return { ok: true, sock: a };
  }
  /** Datagramme UDP (255.255.255.255 : tout le domaine de diffusion de l'émetteur ; DHCP : relayé). Rend true s'il est remis. */
  function udpSend(from, sport, ip, dport, bytes) {
    const st = state(), f = ifaceOf(from), dom = st.find(f ? f.v : 'n:' + from);
    if (st.storm.has(dom)) return false;
    const dg = { from: f && f.ip ? f.ip : '0.0.0.0', sport, bytes: Uint8Array.from(bytes), fromNode: from };
    if (ip === '255.255.255.255') {
      let n = 0; const got = new Set();
      const inDom = nid => st.find('n:' + nid) === dom || st.ifaces.some(x => x.node === nid && x.role !== 'host' && st.find(x.v) === dom);
      for (const [k, fn] of udpBinds) { const [nid, port] = k.split('|'); if (+port === dport && nid !== from && inDom(nid)) { fn(dg); n++; got.add(nid); } }
      // Serveurs DHCP du domaine, relais compris : la demande part vers leur serveur, ailleurs (RFC 2131, RFC 3046).
      if (dport === 67) for (const s of sourcesOf(st, dom)) if (!got.has(s.node)) { const fn = udpBinds.get(key(s.node, 67)); if (fn) { fn(dg); n++; got.add(s.node); } }
      return n > 0;
    }
    if (!f || !f.ip) return false;
    const go = deliver(f, ip, { proto: 'udp', port: dport, sport }); if (!go.ok || go.errors) return false;
    const fn = udpBinds.get(key(go.to.node, go.dnat ? go.port : dport)); if (!fn) return false;
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
    const st = state(), v = 'n:' + node; if (!st.linked.has(node)) return null;
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
    refresh, state, nodes, ping, trace, resolve, connect, listen, udpBind, udpSend, http, wifiJoin, wifiLeave, wifiNetworks, dhcpLease,
    get version() { return ver; },
    /** Port (nœud, port) : { up, speed, why, notes, errors, mdix, peer, ch } ou null (rien de branché). */
    port: (n, p) => state().links.get(key(n, p)) || null,
    channel: (n, p) => state().chans.get(key(n, p)) || null,
    power: n => state().power.get(n) || null,
    poe: n => state().poe.get(n) || null,
    ipOf: id => ifaceOf(id),
    /** Interfaces de niveau 3 d'un nœud (box, routeur, switch de niveau 3, poste). */
    ifacesOf: id => state().ifaces.filter(f => f.node === id),
    /** Table de routage d'un nœud qui route (routes connectées, par défaut, statiques) ; .bad : routes statiques inutilisables. */
    routes: id => (isRouter(state().byId.get(id)) ? routesOf(id) : []),
    lookup: (id, ip) => lookup(id, ip),
    /** Spanning Tree d'un switch administrable : { root, isRoot, cost, rootPort, prio, mac, ports: Map(port → { role, fwd, cost, edge }) } ou null. */
    stp: (id, vlan) => state().l2.stpOf(id, vlan) || null,
    /** Instances Spanning Tree : Map(VLAN → Map(pont → état)) ; une seule (clé 0) en mode RSTP. */
    stpInstances: () => state().l2.stpI,
    /** OSPF : { on, rid, ifs, adj: [{ a, b, fa, fb, up, why }], routes }. */
    ospf: () => ospfOf(),
    /** Agrégats d'un switch : Map(id → { ok, why, mode, members, up, active, standby, speed, peer, rep }) ou null. */
    lags: id => state().l2.lags.get(id) || null,
    /** État de niveau 2 d'un port : { fwd, role (Spanning Tree), lag (état dans l'agrégat) }. */
    l2port: (n, p, vlan) => { const st = state(), s = st.l2.stpOf(n, vlan), r = s ? s.ports.get(p) : null; return { fwd: st.l2.fwd(n, p, vlan), role: r ? r.role : null, cost: r ? r.cost : null, edge: r ? r.edge : false, lag: st.l2.member.get(key(n, p)) || null, blocked: st.l2.blocked(n, p) }; },
    /** Domaine de diffusion d'une interface (ou d'un nœud) : identifiant comparable. */
    domain: id => { const st = state(), f = ifaceOf(id); return st.find(f ? f.v : 'n:' + id); },
    /** VLAN où se trouve un nœud (domaine relié au VLAN d'un switch administrable), ou null (réseau sans VLAN). */
    vlanOf: id => {
      const st = state();
      if (!st.domVlan) {
        st.domVlan = new Map();
        for (const [k, list] of st.l2.attach) { const n = st.byId.get(k.split('|')[0]); if (!n || !specOf(n).managed) continue; for (const x of list) { const m = /^m:.*:(\d+)$/.exec(x.v); if (m && !st.domVlan.has(st.find(x.v))) st.domVlan.set(st.find(x.v), +m[1]); } }
        for (const n of st.all) for (const v of (n.p || {}).svis || []) { const d = st.find(`m:${n.id}:${v.vlan}`); if (!st.domVlan.has(d)) st.domVlan.set(d, v.vlan); }
      }
      const f = ifaceOf(id); return st.domVlan.get(st.find(f ? f.v : 'n:' + id)) ?? null;
    },
    /** Relais DHCP calculés : Map(sommet d'interface → { ok, why, node, … }). */
    relays: () => { const st = state(); sourcesOf(st, null); return st.relays; },
    /** Étendues pleines : [{ node, scope, n (clients sans adresse) }]. */
    full: () => [...state().full.values()],
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
