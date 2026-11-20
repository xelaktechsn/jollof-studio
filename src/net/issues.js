// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérifications du plan réseau, codes stables J12xx (famille « Réseau informatique » de src/check/codes.js). La même
// liste sert au panneau du plan réseau, au vérificateur du projet (panneau Problèmes, rapport), aux TP et à l'IA.
// Chaque vérification cite d'où vient sa règle (clés de src/check/sources.js) : src.
//   J1201 câble mal câblé (ouvert, court-circuit, paire inversée ou croisée) · J1202 paire séparée · J1203 canal de
//   plus de 100 m · J1204 lien permanent de plus de 90 m ou cordons de plus de 10 m · J1205 catégorie trop basse pour
//   la vitesse · J1206 boucle entre switchs · J1207 deux serveurs DHCP · J1208 adresse IP en double · J1209 adresse hors
//   du sous-réseau · J1210 passerelle hors du sous-réseau ou absente · J1211 appareil non relié · J1212 PoE : budget
//   dépassé ou classe trop haute · J1213 pas de lien malgré le câble · J1214 Wi-Fi refusé · J1215 10GBASE-T sur Cat 6
//   entre 37 et 55 m · J1216 aucun serveur DHCP (adresse 169.254).
import { tl } from '../i18n/index.js';
// Fiches des sources et explications des codes J12xx : chargées avec le plan réseau (pas au démarrage de l'application).
import '../check/sources-net.js';
import '../check/explain-net.js';
import { specOf } from './devices.js';
import { NET } from './limits.js';
import { CATS, analyzeCable } from './cable.js';
import { sameNet, hostOk, netOf } from './ip.js';
import { simIssues, SIM_CODES, SIM_SRC } from './issues-sim.js';
// Vérifications de la conception professionnelle, une partie par fichier (codes réservés) : cheminements et longueurs
// réelles J1250–J1264 (plan), Wi-Fi J1265–J1272, baies J1273–J1285, certification J1286–J1289, conception J1290–J1295.
// Fibre et modules optiques J1240–J1249 (fibre). La simulation (VLAN, Spanning Tree, agrégation, routage, DHCP :
// J1217–J1239) est vérifiée ici même.
import * as PLAN from './checks/plan.js';
import * as WIFI from './checks/wifi.js';
import * as RACK from './checks/rack.js';
import * as CERT from './checks/cert.js';
import * as DESIGN from './checks/design.js';
import * as FIBRE from './checks/fibre.js';
const PARTS = [PLAN, WIFI, RACK, CERT, DESIGN, FIBRE];

export const NET_CODES = {
  J1201: 'error', J1202: 'error', J1203: 'error', J1204: 'warning', J1205: 'error', J1206: 'error', J1207: 'error', J1208: 'error',
  J1209: 'error', J1210: 'error', J1211: 'warning', J1212: 'error', J1213: 'error', J1214: 'warning', J1215: 'warning', J1216: 'warning',
  ...SIM_CODES,
  ...Object.assign({}, ...PARTS.map(m => m.CODES))
};
/** Sources de chaque règle (clés de src/check/sources.js). */
export const NET_SRC = {
  J1201: ['flukeWireMapBlog', 'beldenCopperDesignGuide', 'flukeT568AvsB'], J1202: ['flukeWireMapBlog'],
  J1203: NET.CHANNEL_M.src, J1204: [...NET.PERMANENT_M.src, NET.CORDS_M.src].flat(), J1205: NET.SPEED_CAT.src,
  J1206: ['ciscoStp', 'ciscoL2Loops'], J1207: ['rfc2131'], J1208: ['rfc1918'], J1209: ['rfc950', 'rfc4632'], J1210: ['rfc950', 'rfc4632'],
  J1211: ['ieee8023_2022'], J1212: [NET.POE_PSE_W.src, NET.POE_TYPE_MAXCLASS.src].flat(), J1213: ['ieeeMaint1115', 'cisco10100Cables'],
  J1214: ['ieee80211_2024'], J1215: NET.CAT6_10G_SURE_M.src, J1216: ['rfc3927', 'rfc2131'],
  ...SIM_SRC,
  ...Object.assign({}, ...PARTS.map(m => m.SRC))
};
const FAULT = { open: () => tl('conducteur coupé ou absent'), short: () => tl('court-circuit'), reversed: () => tl('paire inversée'), crossed: () => tl('paires croisées'), miswire: () => tl('conducteurs mélangés'), split: () => tl('paire séparée') };
export const faultText = t => (FAULT[t] ? FAULT[t]() : t);
const pins = f => f.pins.join(', ');

/**
 * lan : réseau simulé (lan.js) ; data : plan ({ devices, cables }). Rend [{ code, kind: 'err' | 'warn', id (équipement
 * ou câble en cause), text, src }].
 */
export function netIssues(lan, data) {
  const out = [], st = lan.state(), name = id => { const n = st.byId.get(id); return n ? n.name || specOf(n).name() : id; };
  const item = (code, id, text) => out.push({ code, kind: NET_CODES[code] === 'error' ? 'err' : 'warn', id, text, src: NET_SRC[code] });
  const cname = c => tl('{0} ↔ {1}', name(c.a[0]), name(c.b[0]));
  const done = new Set();
  // Câbles : carte de câblage de chaque câble seul.
  for (const c of (data && data.cables) || []) {
    if (c.media === 'fibre') continue; // une fibre n'a pas de carte de câblage (vérifiée par checks/fibre.js)
    const ch = st.chans.get(c.a[0] + '|' + c.a[1]) || st.chans.get(c.b[0] + '|' + c.b[1]);
    const an = ch && ch.cables.length === 1 ? ch.an : null;
    const r = an || lanCable(c);
    if (r.kind === 'none') { item('J1213', c.id, tl('Câble {0} : une fiche n’est pas sertie, aucun signal ne passe.', cname(c))); continue; }
    const bad = r.faults.filter(f => f.type !== 'split');
    if (bad.length) item('J1201', c.id, tl('Câble {0} : {1}.', cname(c), bad.map(f => `${faultText(f.type)} (${tl('broches')} ${pins(f)})`).join(', ')));
    const sp = r.faults.find(f => f.type === 'split');
    if (sp) item('J1202', c.id, tl('Câble {0} : paire séparée sur les broches {1}. Le testeur de continuité passe, mais la diaphonie fait perdre les trames.', cname(c), pins(sp)));
  }
  // Canaux (de port actif à port actif) : longueur, lien permanent, catégorie, lien absent.
  for (const [k, ch] of st.chans) {
    if (!ch.far || (ch.media && ch.media !== 'copper')) continue; // fibre : bilan optique (checks/fibre.js)
    const pair = [k, ch.far.n + '|' + ch.far.p].sort().join('#'); if (done.has(pair)) continue; done.add(pair);
    const [nid] = k.split('|'), l = st.links.get(k), who = tl('{0} ↔ {1}', name(nid), name(ch.far.n)), cid = ch.cables[0] && ch.cables[0].id;
    if (ch.len > NET.CHANNEL_M.v) item('J1203', cid, tl('Liaison {0} : {1} m de câble, au-delà des {2} m d’un canal.', who, Math.round(ch.len), NET.CHANNEL_M.v));
    else if (ch.perm > NET.PERMANENT_M.v) item('J1204', cid, tl('Liaison {0} : lien permanent de {1} m (au plus {2} m entre le panneau et la prise).', who, Math.round(ch.perm), NET.PERMANENT_M.v));
    else if (ch.perm > 0 && ch.cords > NET.CORDS_M.v) item('J1204', cid, tl('Liaison {0} : {1} m de cordons (au plus {2} m en tout).', who, Math.round(ch.cords), NET.CORDS_M.v));
    const n = st.byId.get(nid), m = st.byId.get(ch.far.n), pa = n && portOfSpec(n, k.split('|')[1]), pb = m && portOfSpec(m, ch.far.p);
    if (pa && pb) {
      const want = Math.min(pa.speed, pb.speed), need = NET.SPEED_CAT.v[want] || 1;
      if (ch.rank && ch.rank < need) {
        const cat6Ok = want === 10000 && ch.cat === 'cat6' && ch.len <= NET.CAT6_10G_MAX_M.v;
        if (!cat6Ok) item('J1205', cid, tl('Liaison {0} : {1} pour du {2} : il faut du {3} (la carte retombe à 1 Gb/s).', who, CATS[ch.cat].name, speedText(want), 'Cat 6A'));
        else if (ch.len > NET.CAT6_10G_SURE_M.v) item('J1215', cid, tl('Liaison {0} : 10GBASE-T sur {1} m de Cat 6, sûr seulement jusqu’à {2} m (diaphonie exogène).', who, Math.round(ch.len), NET.CAT6_10G_SURE_M.v));
      }
    }
    if (l && !l.up && ch.an && ch.an.kind !== 'none' && !ch.an.faults.length && (l.why === 'mdix' || l.why === 'pairs')) item('J1213', cid, tl('Pas de lien entre {0} : ni l’un ni l’autre n’a l’Auto-MDIX, il faut un câble {1}.', who, l.why === 'mdix' ? tl('croisé ou droit selon les appareils') : tl('conforme')));
  }
  // PoE.
  for (const n of st.all) {
    const pw = st.power.get(n.id); if (!pw || pw.on) continue;
    const s = specOf(n); if (!s.ports(n.p || {}).some(p => p.poe === 'pd')) continue;
    const cabled = s.ports(n.p || {}).some(p => st.chans.has(n.id + '|' + p.id));
    if (pw.why === 'budget') item('J1212', n.id, tl('{0} n’est pas alimenté : le budget PoE du switch est épuisé ({1} W).', name(n.id), poeBudgetOf(st, n.id)));
    else if (pw.why === 'class') item('J1212', n.id, tl('{0} demande la classe PoE {1}, que ce port ne fournit pas (classe {2} au plus).', name(n.id), pw.cls ?? (n.p || {}).poeClass, pw.maxClass ?? '?'));
    else if (cabled && pw.why === 'nopoe') item('J1212', n.id, tl('{0} attend du PoE mais son câble n’arrive pas à un port PoE alimenté.', name(n.id)));
    else if (pw.why === 'short') item('J1212', n.id, tl('{0} : court-circuit sur les paires d’alimentation, le switch coupe le PoE.', name(n.id)));
  }
  for (const [id, info] of st.poe) if (info.ports.some(p => p.denied === 'budget')) item('J1212', id, tl('{0} : budget PoE de {1} W dépassé (appareils sans courant).', name(id), info.budget));
  // Boucles et serveurs DHCP par domaine.
  const domName = d => { const ns = st.all.filter(n => st.find('n:' + n.id) === d && specOf(n).role === 'switch').map(n => name(n.id)); return ns.join(', '); };
  const mixed = stormManaged(st);
  for (const d of st.storm) if (!mixed.has(d)) item('J1206', null, tl('Boucle entre switchs ({0}) : sans Spanning Tree, les diffusions tournent sans fin et saturent le réseau.', domName(d) || '?'));
  const doms = new Map();
  for (const f of st.ifaces) { const d = st.find(f.v); if (!doms.has(d)) doms.set(d, []); doms.get(d).push(f); }
  for (const [d, fs] of doms) {
    const sv = st.servers(d);
    if (sv.length > 1) item('J1207', sv[1].node, tl('Deux serveurs DHCP sur le même réseau ({0}) : chaque appareil prend l’adresse du premier qui répond.', sv.map(f => name(f.node)).join(', ')));
    const seen = new Map();
    for (const f of fs) { if (!f.ip) continue; if (seen.has(f.ip) && seen.get(f.ip) !== f.node) item('J1208', f.node, tl('Adresse {0} utilisée par {1} et {2}.', f.ip, name(seen.get(f.ip)), name(f.node))); else seen.set(f.ip, f.node); }
    const lanIf = fs.find(f => f.role === 'lan') || fs.find(f => f.role === 'l3' && f.ip && f.up !== false);
    const l3s = lanIf && lanIf.role === 'l3' ? fs.filter(g => g.role === 'l3' && g.ip && g.up !== false) : null;
    const gwHere = new Set(fs.filter(g => isGw(st, g)).map(g => g.ip));
    for (const f of fs) {
      if (f.role !== 'host' || !f.ip || f.src === 'apipa') continue;
      const n = st.byId.get(f.node);
      if (!hostOk(f.ip, f.prefix)) { item('J1209', f.node, tl('{0} : {1}/{2} n’est pas une adresse d’hôte (adresse du réseau ou de diffusion).', name(f.node), f.ip, f.prefix)); continue; }
      if (l3s) { if (!l3s.some(g => sameNet(f.ip, g.ip, g.prefix))) item('J1209', f.node, tl('{0} : {1} n’est dans aucun réseau des interfaces du routeur de ce VLAN ({2}).', name(f.node), f.ip, l3s.map(g => `${netStr(g)}/${g.prefix}`).join(', '))); }
      else if (lanIf && !sameNet(f.ip, lanIf.ip, lanIf.prefix)) item('J1209', f.node, tl('{0} : {1} n’est pas dans le réseau {2}/{3} de la box : il ne joindra personne ici.', name(f.node), f.ip, netStr(lanIf), lanIf.prefix));
      else if (!lanIf) { const other = fs.find(g => g !== f && g.ip && g.role === 'host' && g.src !== 'apipa' && !sameNet(f.ip, g.ip, f.prefix)); if (other && f.src === 'static' && n) item('J1209', f.node, tl('{0} ({1}) et {2} ({3}) ne sont pas dans le même sous-réseau.', name(f.node), f.ip, name(other.node), other.ip)); }
      if (f.gw) {
        if (!sameNet(f.ip, f.gw, f.prefix)) item('J1210', f.node, tl('{0} : passerelle {1} hors de son sous-réseau {2}/{3}.', name(f.node), f.gw, f.ip, f.prefix));
        else if (!gwHere.has(f.gw)) {
          // La passerelle existe ailleurs (autre VLAN) : le VLAN n'arrive pas jusqu'à elle (J1219, simIssues).
          if (!st.ifaces.some(g => g.ip === f.gw && isGw(st, g))) item('J1210', f.node, tl('{0} : aucune box ne répond à la passerelle {1}.', name(f.node), f.gw));
        }
      }
    }
  }
  // Appareils seuls, Wi-Fi refusé, DHCP sans serveur.
  const hostIf = new Map(); for (const x of st.ifaces) if (x.role === 'host' && !hostIf.has(x.node)) hostIf.set(x.node, x);
  for (const n of st.all) {
    const s = specOf(n); if (s.role === 'passive' || s.role === 'mech') continue;
    const v = 'n:' + n.id, linked = (st.linked && st.linked.has(n.id)) || st.edges.some(e => e.a === v || e.b === v), cabled = s.ports(n.p || {}).some(p => st.chans.has(n.id + '|' + p.id));
    const why = st.wifiWhy.get(n.id);
    if (why) item('J1214', n.id, why === 'auth' ? tl('{0} : mot de passe Wi-Fi refusé par « {1} ».', name(n.id), n.p.wifi.ssid) : tl('{0} : aucun réseau Wi-Fi « {1} » visible.', name(n.id), n.p.wifi.ssid));
    else if (!cabled && !linked && !(n.ext && n.type === 'wifi')) item('J1211', n.id, tl('{0} n’est relié à rien.', name(n.id)));
    const f = hostIf.get(n.id);
    if (f && f.src === 'apipa') item('J1216', n.id, tl('{0} attend une adresse du DHCP, mais aucun serveur ne répond : il se donne {1} et ne joint que ses voisins dans le même cas.', name(n.id), f.ip));
  }
  // Simulation professionnelle : VLAN, Spanning Tree, agrégats, routage, DHCP, listes d'accès (issues-sim.js).
  try { for (const i of simIssues(lan, data, { name, st, mixed })) item(i.code, i.id ?? null, i.text); } catch (e) { console.error(e); }
  // Conception professionnelle : cheminements, Wi-Fi, baies, certification, conception.
  const h = { name, st };
  for (const m of PARTS) {
    let list = [];
    try { list = m.issues(data, lan, h) || []; } catch (e) { console.error(e); }
    for (const i of list) if (NET_CODES[i.code]) item(i.code, i.id ?? null, i.text);
  }
  return out;
}
/** Interface qui peut servir de passerelle : LAN d'une box, interface d'un routeur ou d'un switch de niveau 3 qui route. */
const isGw = (st, g) => { const n = st.byId.get(g.node); return !!n && (n.type === 'router' ? g.role === 'lan' || g.role === 'wan' : g.role === 'l3' && g.up !== false && (n.type === 'routerpro' || (n.p || {}).routing !== false)); };
/** Domaines en tempête où passe un switch administrable (boucle « mixte », J1226) : Set des domaines. */
function stormManaged(st) {
  const out = new Set(); if (!st.l2) return out;
  for (const [k, list] of st.l2.attach) {
    const n = st.byId.get(k.split('|')[0]); if (!n || !specOf(n).managed) continue;
    for (const x of list) { const d = st.find(x.v); if (st.storm.has(d)) out.add(d); }
  }
  return out;
}
const netStr = f => { const n = netOf(f.ip, f.prefix); return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); };
const speedText = s => (s >= 10000 ? '10GBASE-T' : s >= 1000 ? '1000BASE-T' : s >= 100 ? '100BASE-TX' : '10BASE-T');
function poeBudgetOf(st, id) { for (const info of st.poe.values()) if (info.ports.some(p => p.node === id)) return info.budget; return '?'; }
const portOfSpec = (n, pid) => specOf(n).ports(n.p || {}).find(p => p.id === pid) || null;
/** Carte de câblage d'un câble seul, gardée en mémoire par le contenu de ses fiches (un grand plan en a des milliers). */
const CABLES = new Map();
const lanCable = c => { const k = JSON.stringify(c.wire || {}); let r = CABLES.get(k); if (!r) { r = analyzeCable(c.wire || {}); if (CABLES.size > 6000) CABLES.clear(); CABLES.set(k, r); } return r; };
