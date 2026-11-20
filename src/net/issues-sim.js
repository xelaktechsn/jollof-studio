// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérifications de la simulation professionnelle (partie sim de issues.js, codes J1217–J1239) : VLAN, trunks, Spanning
// Tree, agrégats, routage, DHCP (étendues, relais), listes d'accès, traduction d'adresses.
//   J1217 VLAN différents aux deux bouts d'un lien (accès/accès, accès/trunk) · J1218 VLAN natif différent aux deux bouts
//   d'un trunk · J1219 passerelle ailleurs : le VLAN n'arrive pas jusqu'à elle · J1220 VLAN avec des postes mais sans
//   passerelle · J1221 sous-réseaux qui se chevauchent sur un routeur · J1222 poste hors du sous-réseau de son VLAN ·
//   J1223 étendue DHCP pleine · J1224 étendue DHCP incohérente · J1225 relais DHCP qui n'aboutit pas · J1226 boucle qui
//   passe par un switch administrable sans Spanning Tree · J1227 racine du Spanning Tree mal placée · J1228 agrégat
//   mal formé · J1229 deux VLAN du même nom · J1230 route statique dont la passerelle n'est sur aucun réseau connecté ·
//   J1231 liste d'accès qui bloque le relais DHCP ou tout le trafic · J1232 VLAN utilisé mais absent de la base ·
//   J1233 interface VLAN (SVI) éteinte · J1234 port trunk vers un poste · J1235 redirection de port vers une adresse
//   hors des réseaux intérieurs · J1236 interface hors du sous-réseau de son VLAN · J1237 traduction d'adresses sans
//   intérieur ou sans extérieur · J1238 voisinage OSPF impossible (sous-réseau ou masque, aire, minuteries hello et dead
//   différents) · J1239 deux routeurs OSPF avec le même identifiant · J1296 interface OSPF passive sur un lien vers un autre
//   routeur OSPF (pas de voisinage, le lien ne sert pas de transit).
import { tl } from '../i18n/index.js';
import { specOf } from './devices.js';
import { netOf, ipStr, maskOf, sameNet } from './ip.js';
import { portCfg, parseNet, inNet, aclAllows, SERVES } from './vlan.js';

export const SIM_CODES = {
  J1217: 'error', J1218: 'error', J1219: 'error', J1220: 'warning', J1221: 'error', J1222: 'error', J1223: 'warning', J1224: 'error',
  J1225: 'error', J1226: 'error', J1227: 'warning', J1228: 'error', J1229: 'warning', J1230: 'error', J1231: 'warning', J1232: 'warning',
  J1233: 'warning', J1234: 'warning', J1235: 'warning', J1236: 'error', J1237: 'warning', J1238: 'error', J1239: 'error', J1296: 'warning'
};
export const SIM_SRC = {
  J1217: ['ciscoC9300Vlans', 'ciscoC9300Trunks'], J1218: ['ciscoC9300Trunks', 'cisco9kPvid', 'ciscoRouterOnStick'],
  J1219: ['ciscoC9300Trunks', 'ciscoRouterOnStick', 'ciscoInterVlanL3'], J1220: ['ciscoInterVlanL3', 'ciscoC9300Svi'],
  J1221: ['rfc1812', 'rfc4632'], J1222: ['rfc950', 'rfc4632', 'ciscoInterVlanL3'], J1223: ['rfc2131'], J1224: ['rfc2131', 'ciscoDhcpRelay'],
  J1225: ['rfc2131', 'rfc3046', 'ciscoDhcpRelay'], J1226: ['ciscoC9300Stp', 'ciscoL2Loops', 'ciscoRstp'], J1227: ['ciscoC9300Stp', 'ciscoStpDesign', 'ciscoC9300Stp1717'],
  J1228: ['ciscoC9300EtherChannel', 'ciscoC1300'], J1229: ['ciscoC9300Vlans'], J1230: ['rfc1812'], J1231: ['ciscoC9300Acl', 'ciscoAclConfig', 'ciscoDhcpRelay', 'ciscoReflexiveAcl'],
  J1232: ['ciscoC9300Vlans', 'cisco6500VlanRanges', 'ciscoVoiceVlan'], J1233: ['ciscoC9300Svi'], J1234: ['ciscoC9300Trunks'], J1235: ['rfc3022'],
  J1236: ['ciscoInterVlanL3', 'rfc950'], J1237: ['rfc3022'],
  J1238: ['ciscoOspfNeighbor', 'rfc2328', 'ciscoOspfCmdI'], J1239: ['ciscoOspfDupRid', 'ciscoOspfNeighbor'], J1296: ['ciscoPassiveIf', 'ciscoOspfNeighbor']
};
const netTxt = (ip, p) => `${ipStr(netOf(ip, p))}/${p}`;
const overlap = (a, b) => { const p = Math.min(a.prefix, b.prefix); return ((netOf(a.ip, p) ^ netOf(b.ip, p)) & maskOf(p)) === 0; };
const LAGWHY = {
  peers: () => tl('ses ports vont vers deux voisins différents'), speed: () => tl('ses ports n’ont pas tous la même vitesse'), nopeer: () => tl('les ports d’en face ne sont dans aucun agrégat'),
  peerlag: () => tl('les ports d’en face sont dans des agrégats différents'), mode: () => tl('un côté en statique (« on »), l’autre en LACP'), passive: () => tl('les deux côtés en LACP passif : personne ne lance la négociation')
};
export const lagWhyText = w => (LAGWHY[w] ? LAGWHY[w]() : String(w || ''));

/** lan : réseau simulé ; data : plan propre ; h : { name(id), st, mixed (domaines en tempête avec un switch administrable) }. */
export function simIssues(lan, data, h) {
  const out = [], st = h.st, name = h.name, add = (code, id, text) => out.push({ code, id, text });
  const vdb = new Map(((data && data.vlans) || []).map(v => [v.id, v]));
  const managed = st.all.filter(n => specOf(n) && specOf(n).managed);
  const cableOf = (n, p) => { const ch = st.chans.get(n + '|' + p); return ch && ch.cables[0] ? ch.cables[0].id : n; };

  // VLAN de chaque domaine (switch administrable qui le porte), postes et interfaces de chaque domaine.
  const domVlan = new Map();
  for (const [k, list] of st.l2.attach) {
    if (!st.byId.get(k.split('|')[0]) || !specOf(st.byId.get(k.split('|')[0])).managed) continue;
    for (const x of list) { const m = /^m:.*:(\d+)$/.exec(x.v); if (m && !domVlan.has(st.find(x.v))) domVlan.set(st.find(x.v), +m[1]); }
  }
  for (const n of managed) for (const s of (n.p || {}).svis || []) { const d = st.find(`m:${n.id}:${s.vlan}`); if (!domVlan.has(d)) domVlan.set(d, s.vlan); }
  const hostsOf = new Map(), gwsOf = new Map();
  const push = (m, d, x) => { if (!m.has(d)) m.set(d, []); m.get(d).push(x); };
  for (const f of st.ifaces) { const d = st.find(f.v); if (f.role === 'host') push(hostsOf, d, f); else if (f.ip && f.up !== false) push(gwsOf, d, f); }

  /* ---------- Liens entre switchs : VLAN d'accès, trunks, VLAN natif ---------- */
  const seen = new Set();
  for (const [k, l] of st.links) {
    if (!l.up || !l.peer) continue;
    const [n, p] = k.split('|'), kk = [k, l.peer.n + '|' + l.peer.p].sort().join('#'); if (seen.has(kk)) continue; seen.add(kk);
    const A = st.byId.get(n), B = st.byId.get(l.peer.n); if (!A || !B) continue;
    const sa = specOf(A), sb = specOf(B), who = tl('{0} ↔ {1}', name(A.id), name(B.id));
    for (const [X, px, Y, py] of [[A, p, B, l.peer.p], [B, l.peer.p, A, p]]) {
      const sx = specOf(X), sy = specOf(Y);
      if (sx.managed && sy.role === 'host' && portCfg(X, px).mode === 'trunk') add('J1234', X.id, tl('{0}, port {1} : trunk vers {2}, un poste qui ne lit pas les étiquettes 802.1Q (seul le VLAN natif {3} lui arrive).', name(X.id), px, name(Y.id), portCfg(X, px).native));
      if (sx.managed && Y.type === 'routerpro' && portCfg(X, px).mode === 'access' && ((Y.p || {}).ifs || []).some(f => f.port === py && f.vlan)) add('J1217', cableOf(X.id, px), tl('Liaison {0} : le routeur a des sous-interfaces 802.1Q sur {1}, mais le port {2} du switch est en accès (il faut un trunk).', who, py, px));
    }
    if (!sa.managed || !sb.managed) continue;
    const ca = portCfg(A, p), cb = portCfg(B, l.peer.p);
    if (ca.mode === 'access' && cb.mode === 'access' && ca.vlan !== cb.vlan) add('J1217', cableOf(n, p), tl('Liaison {0} : VLAN {1} d’un côté, VLAN {2} de l’autre : les deux VLAN se mélangent sur ce lien.', who, ca.vlan, cb.vlan));
    else if (ca.mode !== cb.mode) add('J1217', cableOf(n, p), tl('Liaison {0} : un port en accès ({1}), l’autre en trunk ({2}) : seuls le VLAN d’accès et le VLAN natif passent.', who, ca.mode === 'access' ? `${name(A.id)} ${p}` : `${name(B.id)} ${l.peer.p}`, ca.mode === 'trunk' ? `${name(A.id)} ${p}` : `${name(B.id)} ${l.peer.p}`));
    else if (ca.mode === 'trunk' && ca.native !== cb.native) add('J1218', cableOf(n, p), tl('Trunk {0} : VLAN natif {1} d’un côté, {2} de l’autre. Les trames sans étiquette passent d’un VLAN à l’autre.', who, ca.native, cb.native));
  }

  /* ---------- Passerelles, VLAN sans passerelle, adresses hors du VLAN ---------- */
  const anyRouter = st.all.some(n => n.type === 'router' || n.type === 'routerpro' || (n.type === 'l3switch' && (n.p || {}).routing !== false));
  for (const [d, hs] of hostsOf) {
    const vlan = domVlan.get(d), gws = gwsOf.get(d) || [], v = vlan ? vdb.get(vlan) : null, net = v && v.net ? parseNet(v.net) : null;
    for (const f of hs) {
      if (!f.ip || f.src === 'apipa') continue;
      if (net && !inNet(f.ip, net)) add('J1222', f.node, tl('{0} : {1} n’est pas dans le sous-réseau {2} du VLAN {3} ({4}).', name(f.node), f.ip, net.text, vlan, v.name));
      if (f.gw && !gws.some(g => g.ip === f.gw)) {
        const far = st.ifaces.find(g => g.ip === f.gw && g.role !== 'host');
        if (far) add('J1219', f.node, tl('{0}{1} : sa passerelle {2} est sur {3}, mais ce réseau n’y arrive pas (VLAN absent d’un trunk, mauvais VLAN d’accès ?).', name(f.node), vlan ? ` (VLAN ${vlan})` : '', f.gw, name(far.node)));
      }
    }
    if (vlan && v && anyRouter && !gws.length && hs.some(f => f.ip)) {
      const sw = managed.find(n => st.l2.attach && [...st.l2.attach].some(([k, list]) => k.startsWith(n.id + '|') && list.some(x => st.find(x.v) === d)));
      add('J1220', sw ? sw.id : hs[0].node, tl('VLAN {0} ({1}) : {2} poste(s) mais aucune passerelle (ni interface VLAN, ni sous-interface) : ils ne sortent pas de leur VLAN.', vlan, v.name, hs.length));
    }
  }

  /* ---------- Routeurs : chevauchements, routes, interfaces, traduction d'adresses ---------- */
  const ownOf = new Map();
  for (const f of st.ifaces) if (f.ip && f.role !== 'host') push(ownOf, f.node, f);
  for (const n of st.all) {
    if (!ownOf.has(n.id) && !SERVES.has(n.type)) continue;
    const own = ownOf.get(n.id) || [];
    for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) if (overlap(own[i], own[j])) add('J1221', n.id, tl('{0} : {1} et {2} se chevauchent ({3} et {4}) : le routeur ne sait plus par où sortir.', name(n.id), own[i].port || own[i].role, own[j].port || own[j].role, netTxt(own[i].ip, own[i].prefix), netTxt(own[j].ip, own[j].prefix)));
    for (const r of lan.routes(n.id).bad || []) add('J1230', n.id, tl('{0} : route {1} via {2} : cette passerelle n’est sur aucun réseau connecté du routeur.', name(n.id), r.net, r.via));
    for (const f of own) {
      if (f.svi && f.up === false) add('J1233', n.id, tl('{0} : l’interface VLAN {1} est éteinte, aucun port relié ne porte ce VLAN.', name(n.id), f.vlan));
      const v = f.vlan ? vdb.get(f.vlan) : null, net = v && v.net ? parseNet(v.net) : null;
      if (net && !inNet(f.ip, net)) add('J1236', n.id, tl('{0} : l’interface du VLAN {1} a l’adresse {2}, hors du sous-réseau {3} prévu pour ce VLAN.', name(n.id), f.vlan, f.ip, net.text));
      const acl = f.aclIn ? ((n.p || {}).acls || []).find(a => a.name === f.aclIn) : null;
      if (acl && f.helper && !aclAllows(acl, { proto: 'udp', src: '0.0.0.0', dst: '255.255.255.255', port: 67 }).ok) add('J1231', n.id, tl('{0} : la liste d’accès {1} en entrée de {2} bloque les demandes DHCP que l’interface doit relayer.', name(n.id), acl.name, f.port));
      else if (acl && acl.rules.length && acl.rules.every(r => r.act === 'deny')) add('J1231', n.id, tl('{0} : la liste d’accès {1} n’a que des refus : avec le refus implicite final, elle bloque tout le trafic qui entre par {2}.', name(n.id), acl.name, f.port));
    }
    if (n.type === 'routerpro') {
      const ifs = (n.p || {}).ifs || [], ins = ifs.filter(f => f.nat === 'inside'), outs = ifs.filter(f => f.nat === 'outside');
      if (ins.length && !outs.length) add('J1237', n.id, tl('{0} : des interfaces « intérieur » mais aucune « extérieur » : la traduction d’adresses ne se fait pas.', name(n.id)));
      if (outs.length && !ins.length && ((n.p || {}).fwd || []).length) add('J1237', n.id, tl('{0} : des redirections de ports mais aucune interface « intérieur ».', name(n.id)));
      const inside = st.ifaces.filter(f => f.node === n.id && f.nat === 'inside' && f.ip);
      for (const fw of (n.p || {}).fwd || []) if (!inside.some(f => sameNet(f.ip, fw.to, f.prefix))) add('J1235', n.id, tl('{0} : la redirection {1} {2} va vers {3}, hors des réseaux intérieurs du routeur.', name(n.id), fw.proto.toUpperCase(), fw.port, fw.to));
    }
    if (SERVES.has(n.type)) {
      const helpers = st.ifaces.filter(f => f.helper && f.ip && st.ifaces.some(g => g.node === n.id && g.ip === f.helper));
      ((n.p || {}).dhcp || []).forEach((sc, i) => {
        if (!sc.on) return;
        const net = parseNet(sc.net), bad = ['from', 'to', 'gw'].filter(k => sc[k] && !inNet(sc[k], net));
        if (bad.length) add('J1224', n.id, tl('{0}, étendue {1} : {2} hors du sous-réseau de l’étendue.', name(n.id), sc.net, bad.map(k => ({ from: tl('début'), to: tl('fin'), gw: tl('passerelle') })[k]).join(', ')));
        else if (!own.some(f => inNet(f.ip, net)) && !(n.type === 'server' && st.ifaces.some(f => f.node === n.id && inNet(f.ip, net))) && !helpers.some(f => inNet(f.ip, net))) add('J1224', n.id, tl('{0}, étendue {1} : aucune interface de ce sous-réseau ni aucun relais qui le serve : elle ne donnera aucune adresse.', name(n.id), sc.net));
        void i;
      });
    }
  }
  for (const e of lan.full()) add('J1223', e.node, tl('{0} : l’étendue DHCP {1} est pleine ({2} demande(s) sans adresse).', name(e.node), e.scope, e.n));
  for (const [v, r] of lan.relays()) {
    if (r.ok) continue;
    const f = st.ifaces.find(x => x.v === v); if (!f) continue;
    const why = { noserver: tl('aucun appareil n’a l’adresse {0}', f.helper), notdhcp: tl('{0} n’a pas d’étendue DHCP active', name(r.node)), unreach: tl('le serveur {0} n’est pas joignable', f.helper), noscope: tl('{0} n’a pas d’étendue pour le réseau {1}', name(r.node), netTxt(f.ip, f.prefix)) }[r.why] || r.why;
    add('J1225', f.node, tl('{0} : le relais DHCP de {1} vers {2} n’aboutit pas : {3}.', name(f.node), f.port, f.helper, why));
  }

  /* ---------- Spanning Tree, boucles, agrégats ---------- */
  if (h.mixed && h.mixed.size) {
    const off = managed.filter(n => (n.p || {}).stp && n.p.stp.on === false);
    add('J1226', off[0] ? off[0].id : null, tl('Boucle qui passe par des switchs administrables ({0}) : un switch sans Spanning Tree ne la coupe pas, les diffusions tournent sans fin.', off.length ? off.map(n => name(n.id)).join(', ') : '?'));
  }
  // Racine de chaque instance (Rapid PVST+ : une par VLAN) ; un message par racine fautive, avec ses VLAN.
  const bad = new Map();
  for (const [inst, m] of st.l2.stpI) {
    const groups = new Map();
    for (const [id, x] of m) { if (!groups.has(x.root)) groups.set(x.root, []); groups.get(x.root).push(id); }
    for (const [root, ids] of groups) {
      if (ids.length < 2) continue;
      const core = ids.map(i => st.byId.get(i)).filter(n => n.type === 'l3switch');
      const kind = st.byId.get(root).type !== 'l3switch' && core.length ? 'access:' + core.map(n => n.id).join(',') : ids.every(i => m.get(i).prio === m.get(root).prio) ? 'default' : null;
      if (!kind) continue;
      const k = root + '|' + kind; if (!bad.has(k)) bad.set(k, { root, kind, core, vlans: [] }); if (inst) bad.get(k).vlans.push(inst);
    }
  }
  for (const b of bad.values()) {
    const vl = b.vlans.length ? ` (VLAN ${b.vlans.sort((x, y) => x - y).join(', ')})` : '';
    if (b.kind === 'default') add('J1227', b.root, tl('Racine du Spanning Tree choisie par défaut (même priorité partout, MAC la plus basse) : {0}. Fixez la priorité du switch de cœur.', name(b.root) + vl));
    else add('J1227', b.root, tl('La racine du Spanning Tree est {0}, un switch d’accès, alors que {1} (cœur) est dans le même réseau : baissez la priorité du cœur (4096 par exemple).', name(b.root) + vl, b.core.map(n => name(n.id)).join(', ')));
  }
  // OSPF : voisinages impossibles, identifiants en double, interface passive sur un lien de transit.
  if (typeof lan.ospf === 'function' && st.all.some(n => n.p && n.p.ospf && n.p.ospf.on)) {
    const O = lan.ospf(), WHY = { subnet: tl('sous-réseau ou masque différent'), area: tl('aires différentes'), timers: tl('minuteries hello et dead différentes') };
    const seenRid = new Map();
    for (const [r, id] of O.rid) { if (seenRid.has(id)) add('J1239', r, tl('{0} et {1} ont le même identifiant de routeur OSPF {2} : la base de liens est faussée.', name(seenRid.get(id)), name(r), id)); else seenRid.set(id, r); }
    for (const e of O.adj) {
      if (e.up || e.why === 'rid') continue;
      const who = `${name(e.a)} ${e.fa.name} ↔ ${name(e.b)} ${e.fb.name}`;
      if (e.why === 'passive') add('J1296', e.fa.passive ? e.a : e.b, tl('OSPF {0} : interface passive vers un autre routeur OSPF, pas de voisinage sur ce lien.', who));
      else add('J1238', e.a, tl('OSPF {0} : pas de voisinage, {1}.', who, WHY[e.why] || e.why) + (e.why === 'timers' ? ` (${e.fa.hello}/${e.fa.dead} s, ${e.fb.hello}/${e.fb.dead} s)` : e.why === 'area' ? ` (${e.fa.area}, ${e.fb.area})` : ''));
    }
  }
  for (const [nid, m] of st.l2.lags) for (const g of m.values()) if (g.why && g.why !== 'down') add('J1228', nid, tl('{0}, agrégat {1} : {2}.', name(nid), g.id, lagWhyText(g.why)));

  /* ---------- Base des VLAN ---------- */
  const names = new Map();
  for (const v of (data && data.vlans) || []) { const k = v.name.trim().toLowerCase(); if (names.has(k)) add('J1229', null, tl('VLAN {0} et {1} portent le même nom « {2} ».', names.get(k), v.id, v.name)); else names.set(k, v.id); }
  if (vdb.size) {
    const used = new Map();
    for (const n of st.all) {
      const P = n.p || {};
      if (specOf(n) && specOf(n).managed) for (const c of Object.values(P.ports || {})) for (const v of c.mode === 'access' ? [c.vlan, c.voice] : [c.native]) if (v && !used.has(v)) used.set(v, n.id);
      for (const s of P.svis || []) if (!used.has(s.vlan)) used.set(s.vlan, n.id);
      for (const f of P.ifs || []) if (f.vlan && !used.has(f.vlan)) used.set(f.vlan, n.id);
    }
    for (const [v, id] of used) if (v !== 1 && !vdb.has(v)) add('J1232', id, tl('VLAN {0} utilisé par {1} mais absent de la base des VLAN du projet.', v, name(id)));
  }
  return out;
}
