// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Contrôles des TP de réseau informatique (src/lab/net) : fonctions pures, sans interface, qui lisent le plan réseau
// d'un projet à travers le réseau simulé commun (lan.js). Le même code vérifie un TP dans l'application (src/lab/index.js,
// réseau vivant de app.net) et dans les tests (src/lab/validate.mjs, réseau construit ici depuis le fichier).
//
// Équipement désigné (« sel ») : son nom (PC1, BOX1, ETH1… sans la casse), sinon son type (pc, switch, router, camera,
// w5500, wifi…) : alors tous les équipements de ce type. '*' : tous les équipements actifs (ni prise ni panneau).
//
// Contrôles :
//   { type: 'net-devices', require: [{ type: 'pc', n?: 2, name?: 'PC1', p?: { legacy: true } }] }  équipements posés
//   { type: 'net-cable', a?: sel, b?: sel, kind?: 'straight'|'crossover', std?: 'A'|'B', cat?: 'cat6', all?: bool,
//       side?: 'a'|'b' }   un câble (ou tous : all) entre a et b, serti des deux côtés, sans défaut, du genre et de la
//       norme demandés ; side : seulement cette fiche du câble (bout a ou b tel qu'il est posé), sertie selon std
//   { type: 'net-link', a: sel, b: sel, speed?: 100, clean?: true, mdix?: bool, all?: true }
//       chaque équipement de a (all, par défaut) a un lien établi avec un équipement de b, d'au moins speed Mb/s, sans
//       erreurs (clean, par défaut) ; mdix : l'Auto-MDIX a dû croiser (true) ou non (false)
//   { type: 'net-ping', from: sel, to: sel | '192.168.1.1', all?: true }   ping réussi de chaque from vers chaque to
//   { type: 'net-dhcp', of: sel, server?: sel }          chaque équipement de of a une adresse du DHCP (de ce serveur)
//   { type: 'net-poe', of: sel }                          chaque équipement de of est alimenté (PoE ou secteur)
//   { type: 'net-ok', codes?: ['J1201', …], warnings?: bool, min?: 1 }   plan sans erreur J12xx (ou sans ces codes,
//       quel que soit leur niveau ; warnings : sans avertissement non plus)
//   { type: 'net-ip', of: sel, mode?: 'static'|'dhcp', ip?: '192.168.1.10', prefix?: 24, gw?: '192.168.1.1',
//       net?: '192.168.1.0/24' }                         réglage IP d'un équipement (adresse effective pour un module)
//   { type: 'net-wifi', of: sel, ap?: sel }               associé en Wi-Fi (à ce point d'accès ou cette box)
// Contrôles de la simulation professionnelle (partie sim, plus bas : simLab) :
//   { type: 'net-vlan', of: sel | [sel…], vlan: 10 }      chaque équipement de of est dans le VLAN 10
//   { type: 'net-vlan', map: { sel: 10, sel2: 20 } }     chaque groupe dans son VLAN
//   { type: 'net-vlan', apart: [sel, sel] }               les deux groupes sont dans des domaines de diffusion différents
//   { type: 'net-trace', from: sel, to: sel | ip, via?: [sel…], hops?: n }   traceroute réussi, par ces routeurs
//       dans cet ordre (via), en n sauts au plus (hops)
//   { type: 'net-stp', root?: sel, vlan?: 10, alternate?: n }   pas de tempête ; la racine (de l'instance de ce VLAN en Rapid
//       PVST+) est cet équipement ; n ports bloqués au moins
//   { type: 'net-lag', of: sel, id?: 'Po1', min?: 2 }      agrégat formé (LACP ou statique) avec min ports actifs
//   { type: 'net-route', on: sel, to: ip, via?: ip, kind?: 'ospf'|'static'|'connected' }   le routeur a une route vers ip
//       (par cette passerelle, de ce genre : apprise par OSPF par exemple)
// Contrôles « en direct » (le programme de la carte doit tourner : simulation lancée) :
//   { type: 'net-http', from: sel, to: sel | ip, path?: '/', expect?: 'regex' }   page web lue par le navigateur
//   { type: 'net-mqtt', broker?: sel, topic: 'atelier/#', expect?: 'regex', subscribed?: 'atelier/led' }
//       le broker a reçu une publication sur ce sujet (filtre + et #), dont le texte correspond ; ou un client abonné
//   { type: 'net-modbus', plc?: sel, table?: 'hr'|'coils'|'ir'|'di', addr: 0, op?: 'read'|'write', expect?: n }
//       une requête Modbus de ce genre a réussi sur cette adresse ; expect : la valeur du registre de l'automate
import { tl } from '../i18n/index.js';
import { createLan } from './lan.js';
import { specOf, portsOf } from './devices.js';
import { analyzeCable, stdOf, CATS } from './cable.js';
import { netIssues } from './issues.js';
import { cleanNet } from './clean.js';
import { ipNum, sameNet, prefixOf } from './ip.js';
import { topicMatch } from './mqtt.js';
import { NET_AUTO, NET_LIVE, isNetCheck } from './labkinds.js';
import { lagWhyText } from './issues-sim.js';
import { LAB as PLAN_LAB } from './checks/plan.js';
import { LAB as WIFI_LAB } from './checks/wifi.js';
import { LAB as RACK_LAB } from './checks/rack.js';
import { LAB as CERT_LAB } from './checks/cert.js';
import { LAB as DESIGN_LAB } from './checks/design.js';
import { LAB as FIBRE_LAB } from './checks/fibre.js';
export { NET_AUTO, NET_LIVE, isNetCheck };
/** Contrôles de la conception professionnelle, définis avec leurs vérifications (src/net/checks/*.js). */
const PRO_LAB = { ...PLAN_LAB, ...WIFI_LAB, ...RACK_LAB, ...CERT_LAB, ...DESIGN_LAB, ...FIBRE_LAB, ...simLab() };

const low = v => String(v ?? '').trim().toLowerCase();

/* ---------- Réseau d'un projet (fichier) ---------- */
const ETH = ['w5500', 'enc28j60'], WIFI = ['esp32', 'esp32s3', 'esp32c3', 'nodemcu'];
/** Plan réseau d'un projet .jollof (settings.modules.net), ou un plan vide. */
export const netOfProject = p => cleanNet(((((p || {}).settings || {}).modules || {}).net) || {});
/**
 * Nœuds « externes » du montage : modules Ethernet (port 'eth') et cartes Wi-Fi. comps : composants du montage, avec
 * l'état écrit par le programme (periph.eth, periph.wifi) quand il tourne ; kindOf(c) : genre de la carte (esp32…).
 */
export function extNodes(comps, ext = {}, kindOf = c => c.type) {
  const out = [];
  for (const c of comps || []) {
    const pos = ext['e:' + c.id] || ext[c.id] || { x: 0, y: 0 };
    if (ETH.includes(c.type)) out.push({ id: 'e:' + c.id, type: c.type, name: c.name, x: pos.x, y: pos.y, mac: () => (c.periph && c.periph.eth ? c.periph.eth.mac : ''), ipcfg: () => (c.periph && c.periph.eth) || null });
    else if (WIFI.includes(kindOf(c))) {
      const cfg = () => { const w = c.periph && c.periph.wifi; return w && w.lan && w.status === 3 && w.ip ? { ip: w.ip, prefix: w.prefix ?? 24, gw: w.gw, dhcp: !w.fixed } : null; };
      out.push({ id: 'e:' + c.id, type: 'wifi', name: c.name, x: pos.x, y: pos.y, mac: () => '', ipcfg: cfg });
    }
  }
  return out;
}
/**
 * Environnement de contrôle construit depuis un projet (tests, validate.mjs) : { netData(), lan(), comps() }.
 * o.comps : composants vivants (programme en cours) à la place de ceux du fichier ; o.kindOf : genre d'une carte.
 */
export function netEnv(project, o = {}) {
  const data = netOfProject(project), comps = o.comps || (project && project.comps) || [];
  const lan = createLan({ data: () => data, ext: () => extNodes(comps, data.ext, o.kindOf), sig: () => JSON.stringify(comps.map(c => c.periph ? [c.periph.eth, c.periph.wifi && c.periph.wifi.ip] : null)) });
  return { netData: () => data, lan: () => lan, comps: () => comps };
}
/** Réseau à lire : celui de l'environnement (application : réseau vivant), sinon construit depuis son plan. */
function lanOf(env) {
  const l = env.lan ? env.lan() : null; if (l) return l;
  const data = env.netData ? env.netData() || { devices: [], cables: [] } : { devices: [], cables: [] };
  return createLan({ data: () => data, ext: () => extNodes(env.comps ? env.comps() : [], data.ext || {}) });
}
const dataOf = env => (env.netData ? env.netData() : null) || { devices: [], cables: [] };

/* ---------- Désignation des équipements ---------- */
/** Nœuds (du réseau calculé) désignés par sel : nom, sinon type, '*' : tous les équipements actifs. */
export function pick(st, sel) {
  if (sel == null) return [];
  const all = st.all, s = low(sel);
  if (s === '*') return all.filter(n => specOf(n) && specOf(n).role !== 'passive');
  const byName = all.filter(n => low(n.name) === s);
  return byName.length ? byName : all.filter(n => low(n.type) === s);
}
const nameOf = n => (n ? n.name || (specOf(n) ? specOf(n).name() : n.id) : '?');
const deep = (have, want) => Object.entries(want || {}).every(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? deep((have || {})[k], v) : low((have || {})[k]) === low(v)));

/* ---------- Contrôles du plan ---------- */
/** Équipements posés : chaque besoin trouve des équipements différents (n au moins, nom et réglages demandés). */
export function checkNetDevices(c, env) {
  const st = lanOf(env).state(), used = new Set(), missing = [];
  const need = [...(c.require || [])].sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0));
  for (const n of need) {
    const want = n.n || 1, of = st.all.filter(d => !used.has(d) && low(d.type) === low(n.type) && (!n.name || low(d.name) === low(n.name)) && deep(d.p, n.p));
    of.slice(0, want).forEach(d => used.add(d));
    if (of.length < want) missing.push({ ...n, have: of.length });
  }
  return { ok: !missing.length, missing };
}
/** Genre d'un câble seul (carte de câblage) et ses défauts. */
export function cableState(cable) {
  const an = analyzeCable((cable && cable.wire) || {});
  const ends = an.ends || [null, null];
  return { kind: an.kind === 'crossover-full' ? 'crossover' : an.kind, faults: an.faults, ends, crimped: an.kind !== 'none' };
}
/** Câbles entre a et b (ou touchant a, ou tous), du genre et de la norme demandés, sans défaut. */
export function checkNetCable(c, env) {
  const st = lanOf(env).state(), A = c.a ? new Set(pick(st, c.a).map(n => n.id)) : null, B = c.b ? new Set(pick(st, c.b).map(n => n.id)) : null;
  const hit = x => (A && B ? (A.has(x.a[0]) && B.has(x.b[0])) || (A.has(x.b[0]) && B.has(x.a[0])) : A ? A.has(x.a[0]) || A.has(x.b[0]) : true);
  const cables = (dataOf(env).cables || []).filter(hit);
  if (!cables.length) return { ok: false, why: 'nocable' };
  const verdict = x => {
    // Une seule fiche (side : 'a' ou 'b', le bout du câble tel qu'il est posé) : sertie, dans la norme demandée.
    if (c.side) { const e = (x.wire || {})[c.side]; return !e || !e.crimped ? { why: 'crimp', cable: x.id, ends: [null, null] } : c.std && stdOf(e) !== c.std ? { why: 'std1', cable: x.id, end: stdOf(e) } : null; }
    const s = cableState(x);
    if (!s.crimped) return { why: 'crimp', cable: x.id, ends: s.ends };
    if (s.faults.length) return { why: 'faults', cable: x.id, faults: s.faults.map(f => f.type), kind: s.kind };
    if (c.kind && s.kind !== c.kind) return { why: 'kind', cable: x.id, kind: s.kind };
    if (c.std && (c.kind || 'straight') === 'straight' && !(s.ends[0] === c.std && s.ends[1] === c.std)) return { why: 'std', cable: x.id, ends: s.ends };
    if (c.cat && (CATS[x.cat] || CATS.cat6).rank < (CATS[c.cat] || CATS.cat5e).rank) return { why: 'cat', cable: x.id, cat: x.cat };
    return null;
  };
  const bad = cables.map(verdict);
  const ok = c.all ? bad.every(b => !b) : bad.some(b => !b);
  return ok ? { ok: true, n: cables.length } : { ok: false, ...(bad.find(Boolean) || { why: 'nocable' }) };
}
/** Liens établis : chaque équipement de a (ou l'un d'eux si all: false) relié à un équipement de b. */
export function checkNetLink(c, env) {
  const lan = lanOf(env), st = lan.state(), A = pick(st, c.a), B = new Set(pick(st, c.b).map(n => n.id));
  if (!A.length) return { ok: false, why: 'noa' };
  if (!B.size) return { ok: false, why: 'nob' };
  const clean = c.clean !== false, fails = [];
  for (const n of A) {
    let best = null;
    for (const p of portsOf(n)) {
      const l = lan.port(n.id, p.id); if (!l || !l.peer || !B.has(l.peer.n)) { if (l && !l.up && !best) best = { why: l.why || 'down', node: n.id }; continue; }
      if (!l.up) { best = { why: l.why || 'down', node: n.id }; continue; }
      if (c.speed && l.speed < c.speed) { best = { why: 'speed', speed: l.speed, node: n.id }; continue; }
      if (clean && l.errors) { best = { why: 'errors', notes: l.notes, node: n.id }; continue; }
      if (c.mdix != null && !!l.mdix !== !!c.mdix) { best = { why: 'mdix', mdix: !!l.mdix, node: n.id }; continue; }
      best = { ok: true, speed: l.speed }; break;
    }
    if (!best || !best.ok) fails.push(best || { why: 'nocable', node: n.id });
  }
  const ok = c.all === false ? fails.length < A.length : !fails.length;
  return ok ? { ok: true } : { ok: false, ...fails[0], name: nameOf(st.byId.get(fails[0].node)) };
}
/** Adresses visées par « to » : une adresse écrite, ou celles des équipements désignés. */
function targets(lan, st, to) {
  if (ipNum(to) != null) return [{ ip: String(to).trim(), name: String(to).trim() }];
  return pick(st, to).map(n => { const f = lan.ipOf(n.id); return { id: n.id, ip: f && f.ip ? f.ip : null, name: nameOf(n) }; });
}
/** Ping de chaque équipement de from vers chaque cible (ou d'au moins un vers une cible : all: false). */
export function checkNetPing(c, env) {
  const lan = lanOf(env), st = lan.state(), F = pick(st, c.from), T = targets(lan, st, c.to);
  if (!F.length) return { ok: false, why: 'nofrom' };
  if (!T.length) return { ok: false, why: 'noto' };
  const fails = [];
  let any = false;
  for (const f of F) for (const t of T) {
    if (t.id === f.id) continue;
    if (!t.ip) { fails.push({ from: nameOf(f), to: t.name, why: 'noip-target' }); continue; }
    const r = lan.ping(f.id, t.ip);
    if (r.ok) any = true; else fails.push({ from: nameOf(f), to: t.name, ip: t.ip, why: r.why });
  }
  const ok = c.all === false ? any : !fails.length && (any || F.length > 0);
  return ok ? { ok: true } : { ok: false, ...(fails[0] || { why: 'nofrom' }) };
}
/** Adresse donnée par un serveur DHCP à chaque équipement de of (de ce serveur si server). */
export function checkNetDhcp(c, env) {
  const lan = lanOf(env), st = lan.state(), N = pick(st, c.of), S = c.server ? new Set(pick(st, c.server).map(n => n.id)) : null;
  if (!N.length) return { ok: false, why: 'none' };
  for (const n of N) {
    const f = lan.ipOf(n.id);
    if (!f || f.src !== 'dhcp') return { ok: false, why: f ? f.src : 'none', name: nameOf(n), ip: f && f.ip };
    if (S && !S.has(f.server)) return { ok: false, why: 'server', name: nameOf(n), server: nameOf(st.byId.get(f.server)) };
  }
  return { ok: true };
}
/** Équipements alimentés. */
export function checkNetPoe(c, env) {
  const lan = lanOf(env), st = lan.state(), N = pick(st, c.of);
  if (!N.length) return { ok: false, why: 'none' };
  for (const n of N) { const p = lan.power(n.id); if (!p || !p.on) return { ok: false, why: (p && p.why) || 'nopoe', name: nameOf(n) }; }
  return { ok: true };
}
/** Plan sans erreur du vérificateur J12xx (ou sans les codes donnés). */
export function checkNetOk(c, env) {
  const lan = lanOf(env), st = lan.state(), data = dataOf(env);
  if (st.all.filter(n => specOf(n) && specOf(n).role !== 'passive').length < (c.min ?? 1)) return { ok: false, why: 'empty', issues: [] };
  const all = netIssues(lan, data);
  const issues = c.codes ? all.filter(i => c.codes.includes(i.code)) : all.filter(i => i.kind === 'err' || (c.warnings && i.kind === 'warn'));
  return { ok: !issues.length, why: issues.length ? 'issues' : null, issues: issues.map(i => ({ code: i.code, text: i.text })) };
}
/** Réglage IP d'un équipement : celui de son panneau, l'adresse effective pour un module du montage. */
export function checkNetIp(c, env) {
  const lan = lanOf(env), st = lan.state(), N = pick(st, c.of);
  if (!N.length) return { ok: false, why: 'none' };
  for (const n of N) {
    const P = n.p || {}, cfg = n.type === 'router' ? { mode: 'static', ...(P.lan || {}) } : n.ext ? (() => { const f = lan.ipOf(n.id) || {}; return { mode: f.src === 'dhcp' ? 'dhcp' : 'static', ip: f.ip, prefix: f.prefix, gw: f.gw }; })() : P.ip || {};
    const bad = [];
    if (c.mode && low(cfg.mode) !== low(c.mode)) bad.push('mode');
    if (c.ip && cfg.ip !== c.ip) bad.push('ip');
    if (c.prefix != null && +cfg.prefix !== (prefixOf(c.prefix) ?? +c.prefix)) bad.push('prefix');
    if (c.gw != null && (cfg.gw || '') !== c.gw) bad.push('gw');
    if (c.net) { const [ip, pr] = String(c.net).split('/'); if (!cfg.ip || !sameNet(cfg.ip, ip, +pr) || +cfg.prefix !== +pr) bad.push('net'); }
    if (bad.length) return { ok: false, why: 'config', name: nameOf(n), bad, cfg };
  }
  return { ok: true };
}
/** Associé en Wi-Fi (laptop, carte), à un point d'accès désigné si ap. */
export function checkNetWifi(c, env) {
  const lan = lanOf(env), st = lan.state(), N = pick(st, c.of), AP = c.ap ? new Set(pick(st, c.ap).map(n => n.id)) : null;
  if (!N.length) return { ok: false, why: 'none' };
  for (const n of N) {
    const w = lan.wifiOf(n.id);
    if (!w.ap) return { ok: false, why: w.why || 'nowifi', name: nameOf(n) };
    if (AP && !AP.has(w.ap)) return { ok: false, why: 'ap', name: nameOf(n) };
  }
  return { ok: true };
}

/* ---------- Contrôles en direct (programme en marche) ---------- */
/** Page web lue par le navigateur de from : Promise({ ok, why, code }). */
export async function checkNetHttp(c, env) {
  const lan = lanOf(env), st = lan.state(), F = pick(st, c.from), T = targets(lan, st, c.to);
  if (!F.length) return { ok: false, why: 'nofrom' };
  if (!T.length || !T[0].ip) return { ok: false, why: 'noip-target', to: T[0] ? T[0].name : String(c.to) };
  const url = `http://${T[0].ip}${c.path || '/'}`;
  const r = await lan.http(F[0].id, url, { timeout: c.timeout || 3000 });
  if (r.code !== 200) return { ok: false, why: r.code ? 'code' : r.why || 'noreply', code: r.code, url };
  if (c.expect && !new RegExp(c.expect, 'i').test(r.body || '')) return { ok: false, why: 'body', url, body: String(r.body || '').slice(0, 200) };
  return { ok: true, url };
}
/** Publication reçue par le broker (ou client abonné). */
export function checkNetMqtt(c, env) {
  const lan = lanOf(env), st = lan.state(), N = pick(st, c.broker || 'broker');
  if (!N.length) return { ok: false, why: 'nobroker' };
  for (const n of N) {
    const b = lan.broker(n.id); if (!b) continue;
    if (c.subscribed) { if (b.clients().some(k => k.subs.some(s => topicMatch(s, c.subscribed)))) return { ok: true }; continue; }
    const t = b.topics().filter(x => x.from !== 'panneau' && topicMatch(c.topic || '#', x.topic));
    if (t.some(x => !c.expect || new RegExp(c.expect, 'i').test(x.text || ''))) return { ok: true, topic: t[0].topic };
    if (t.length) return { ok: false, why: 'text', topic: t[0].topic, text: t[0].text };
  }
  return { ok: false, why: c.subscribed ? 'nosub' : 'nopub', clients: N.reduce((k, n) => k + (lan.broker(n.id) ? lan.broker(n.id).clients().length : 0), 0) };
}
const MB_READ = { coils: 1, di: 2, hr: 3, ir: 4 }, MB_WRITE = { coils: [5, 15], hr: [6, 16] };
/** Requête Modbus réussie sur l'automate (journal du réseau), ou valeur d'un de ses registres. */
export function checkNetModbus(c, env) {
  const lan = lanOf(env), st = lan.state(), N = pick(st, c.plc || 'plc'), table = c.table || 'hr';
  if (!N.length) return { ok: false, why: 'noplc' };
  for (const n of N) {
    if (c.expect != null) { const b = lan.bank(n.id), v = b ? b.read(table, c.addr | 0) : null; if (v === +c.expect) return { ok: true }; continue; }
    const fns = c.op === 'write' ? MB_WRITE[table] || [] : [MB_READ[table]];
    if (lan.events().some(e => e.t === 'modbus' && e.node === n.id && e.ok && fns.includes(e.fn) && (c.addr == null || e.addr === +c.addr))) return { ok: true };
  }
  const seen = lan.events().filter(e => e.t === 'modbus').length;
  return { ok: false, why: c.expect != null ? 'value' : seen ? 'other' : 'none' };
}

/** Contrôle du réseau (synchrone, sauf net-http qui rend une promesse). */
export function checkNet(c, env) {
  switch (c.type) {
    case 'net-devices': return checkNetDevices(c, env);
    case 'net-cable': return checkNetCable(c, env);
    case 'net-link': return checkNetLink(c, env);
    case 'net-ping': return checkNetPing(c, env);
    case 'net-dhcp': return checkNetDhcp(c, env);
    case 'net-poe': return checkNetPoe(c, env);
    case 'net-ok': return checkNetOk(c, env);
    case 'net-ip': return checkNetIp(c, env);
    case 'net-wifi': return checkNetWifi(c, env);
    case 'net-http': return checkNetHttp(c, env);
    case 'net-mqtt': return checkNetMqtt(c, env);
    case 'net-modbus': return checkNetModbus(c, env);
    default: return PRO_LAB[c.type] ? PRO_LAB[c.type].check(c, env) : { ok: false, why: 'type' };
  }
}

/* ---------- Simulation professionnelle (partie sim) ---------- */
function simLab() {
  const names = (st, ids) => ids.map(id => nameOf(st.byId.get(id))).join(', ');
  return {
    'net-vlan': {
      check(c, env) {
        const lan = lanOf(env), st = lan.state();
        if (c.apart) {
          const [A, B] = c.apart.map(sel => pick(st, sel)); if (!A.length || !B.length) return { ok: false, why: 'none' };
          for (const a of A) for (const b of B) if (lan.domain(a.id) === lan.domain(b.id)) return { ok: false, why: 'same', a: nameOf(a), b: nameOf(b) };
          return { ok: true };
        }
        // map : { sel: vlan } (plusieurs groupes en un contrôle), sinon of (un sélecteur ou une liste) et vlan.
        const want = c.map ? Object.entries(c.map) : [].concat(c.of ?? []).map(sel => [sel, c.vlan]);
        for (const [sel, vlan] of want) {
          const N = pick(st, sel); if (!N.length) return { ok: false, why: 'none', sel };
          for (const n of N) { const v = lan.vlanOf(n.id); if (v !== +vlan) return { ok: false, why: 'vlan', name: nameOf(n), vlan: v, want: +vlan }; }
        }
        return want.length ? { ok: true } : { ok: false, why: 'none' };
      },
      text(c, r) {
        if (r.why === 'none') return tl('Équipement introuvable dans le plan : {0}.', r.sel || c.of || (c.apart || []).join(', '));
        if (r.why === 'same') return tl('{0} et {1} sont encore dans le même réseau de diffusion : séparez-les en VLAN.', r.a, r.b);
        return r.vlan == null ? tl('{0} n’est dans aucun VLAN (port d’accès du switch administrable à régler).', r.name) : tl('{0} est dans le VLAN {1}, pas dans le VLAN {2}.', r.name, r.vlan, r.want);
      }
    },
    'net-trace': {
      check(c, env) {
        const lan = lanOf(env), st = lan.state(), F = pick(st, c.from), T = targets(lan, st, c.to);
        if (!F.length) return { ok: false, why: 'nofrom' };
        if (!T.length || !T[0].ip) return { ok: false, why: 'noto' };
        for (const f of F) {
          const r = lan.trace(f.id, T[0].ip);
          if (!r.ok) return { ok: false, why: r.why, from: nameOf(f), to: T[0].name, hops: r.hops.length };
          const routers = r.hops.slice(0, -1).map(h => h.node);
          if (c.hops && r.hops.length > +c.hops) return { ok: false, why: 'hops', from: nameOf(f), n: r.hops.length };
          if (c.via) {
            const want = c.via.map(sel => new Set(pick(st, sel).map(n => n.id)));
            let i = 0; for (const id of routers) if (i < want.length && want[i].has(id)) i++;
            if (i < want.length) return { ok: false, why: 'via', from: nameOf(f), path: names(st, routers) || '—' };
          }
        }
        return { ok: true };
      },
      text(c, r) {
        if (r.why === 'nofrom' || r.why === 'noto') return tl('Équipement introuvable dans le plan : {0}.', r.why === 'nofrom' ? c.from : c.to);
        if (r.why === 'hops') return tl('Traceroute depuis {0} : {1} sauts, c’est trop.', r.from, r.n);
        if (r.why === 'via') return tl('Traceroute depuis {0} : le chemin passe par {1}, pas par {2}.', r.from, r.path, c.via.join(', '));
        return tl('Traceroute de {0} vers {1} : échec, {2}.', r.from, r.to, whyText(r.why));
      }
    },
    'net-stp': {
      check(c, env) {
        const lan = lanOf(env), st = lan.state();
        if (st.storm.size) return { ok: false, why: 'storm' };
        let alt = 0; const roots = new Set();
        const inst = c.vlan != null && st.l2.stpI.has(+c.vlan) ? st.l2.stpI.get(+c.vlan) : st.l2.single ? st.l2.stpI.get(0) : null;
        for (const [, s] of inst || st.l2.stp) { roots.add(s.root); for (const p of s.ports.values()) if (!p.fwd) alt++; }
        if (c.root) { const R = new Set(pick(st, c.root).map(n => n.id)); if (!R.size) return { ok: false, why: 'none' }; if (![...roots].some(r => R.has(r)) || roots.size !== 1) return { ok: false, why: 'root', root: names(st, [...roots]) || '—' }; }
        if (c.alternate && alt < +c.alternate) return { ok: false, why: 'alternate', n: alt };
        return { ok: true };
      },
      text(c, r) {
        if (r.why === 'storm') return tl('Tempête de diffusion : une boucle n’est pas coupée (Spanning Tree arrêté ?).');
        if (r.why === 'none') return tl('Équipement introuvable dans le plan : {0}.', c.root);
        if (r.why === 'root') return tl('La racine du Spanning Tree est {0}, pas {1} : baissez la priorité de {1}.', r.root, c.root);
        return tl('Aucun port n’est bloqué ({0}) : il manque le lien redondant.', r.n);
      }
    },
    'net-lag': {
      check(c, env) {
        const lan = lanOf(env), st = lan.state(), N = pick(st, c.of); if (!N.length) return { ok: false, why: 'none' };
        for (const n of N) {
          const m = lan.lags(n.id), g = m ? (c.id ? m.get(c.id) : [...m.values()][0]) : null;
          if (!g) return { ok: false, why: 'nolag', name: nameOf(n) };
          if (!g.ok) return { ok: false, why: g.why || 'down', name: nameOf(n), id: g.id };
          if (g.active.length < (+c.min || 2)) return { ok: false, why: 'min', name: nameOf(n), id: g.id, n: g.active.length };
        }
        return { ok: true };
      },
      text(c, r) {
        if (r.why === 'none') return tl('Équipement introuvable dans le plan : {0}.', c.of);
        if (r.why === 'nolag') return tl('{0} n’a pas d’agrégat de liens.', r.name);
        if (r.why === 'min') return tl('{0}, agrégat {1} : {2} port(s) actif(s) seulement.', r.name, r.id, r.n);
        return tl('{0}, agrégat {1} : pas formé ({2}).', r.name, r.id, r.why === 'down' ? tl('aucun port relié') : lagWhyText(r.why));
      }
    },
    'net-route': {
      check(c, env) {
        const lan = lanOf(env), st = lan.state(), N = pick(st, c.on); if (!N.length) return { ok: false, why: 'none' };
        for (const n of N) {
          const r = lan.lookup(n.id, c.to);
          if (!r) return { ok: false, why: 'noroute', name: nameOf(n) };
          if (c.via && r.via !== c.via) return { ok: false, why: 'via', name: nameOf(n), via: r.via || tl('réseau connecté') };
          if (c.kind && r.kind !== c.kind) return { ok: false, why: 'kind', name: nameOf(n), kind: r.kind };
        }
        return { ok: true };
      },
      text(c, r) {
        if (r.why === 'none') return tl('Équipement introuvable dans le plan : {0}.', c.on);
        if (r.why === 'via') return tl('{0} joint {1} par {2}, pas par {3}.', r.name, c.to, r.via, c.via);
        if (r.why === 'kind') return tl('{0} joint {1} par une route {2}, pas {3}.', r.name, c.to, r.kind, c.kind);
        return tl('{0} n’a aucune route vers {1}.', r.name, c.to);
      }
    }
  };
}

/* ---------- Messages ---------- */
const WHY = {
  nolink: () => tl('pas de lien (câble absent ou défectueux)'), noip: () => tl('pas d’adresse IP'), 'noip-target': () => tl('la cible n’a pas d’adresse IP'),
  dns: () => tl('nom inconnu sur le réseau'), arp: () => tl('personne ne répond à cette adresse sur le réseau local'),
  nogw: () => tl('pas de passerelle pour sortir du sous-réseau'), gwout: () => tl('la passerelle est hors du sous-réseau'),
  gwunreach: () => tl('la passerelle ne répond pas'), gwnotrouter: () => tl('la passerelle n’est pas un routeur'), noroute: () => tl('aucune route vers cette adresse'),
  nat: () => tl('la traduction d’adresses de la box bloque l’entrée'), storm: () => tl('tempête de diffusion : une boucle entre switchs sature le réseau'),
  apipa: () => tl('adresse 169.254 : aucun serveur DHCP n’a répondu'), errors: () => tl('trames perdues (câble trop long ou paire séparée)'),
  'wifi:nossid': () => tl('aucun réseau Wi-Fi de ce nom'), 'wifi:auth': () => tl('mot de passe Wi-Fi refusé'),
  crimp: () => tl('une fiche n’est pas sertie'), length: () => tl('câble bien trop long'), pairs: () => tl('paires mal câblées'),
  mdix: () => tl('ni l’un ni l’autre n’a l’Auto-MDIX : il faut l’autre genre de câble'), open: () => tl('le câble n’arrive à aucun appareil actif'),
  power: () => tl('un des deux appareils n’est pas alimenté'), nocable: () => tl('aucun câble branché'), down: () => tl('pas de lien'),
  budget: () => tl('budget PoE du switch épuisé'), class: () => tl('classe PoE trop haute pour ce port'), nopoe: () => tl('pas de PoE sur ce câble'), short: () => tl('court-circuit sur les paires d’alimentation'),
  refused: () => tl('connexion refusée : aucun serveur n’écoute sur ce port'),
  acl: () => tl('bloqué par une liste d’accès d’un routeur'), ttl: () => tl('durée de vie (TTL) épuisée : boucle de routage'), maxhops: () => tl('trop de sauts : le traceroute s’arrête'),
  nonode: () => tl('équipement introuvable'), shut: () => tl('port coupé par l’administrateur'), nomodule: () => tl('cage SFP sans module'),
  cage: () => tl('module qui n’entre pas dans cette cage'), media: () => tl('le support ne va pas avec les ports (fibre sur un port RJ45, module optique sur du cuivre)'),
  mismatch: () => tl('modules différents aux deux bouts'), fibretype: () => tl('module qui ne va pas avec ce type de fibre'), reach: () => tl('liaison plus longue que la portée du module'),
  overload: () => tl('récepteur saturé'), timeout: () => tl('pas de réponse à temps'), noreply: () => tl('pas de réponse'), closed: () => tl('connexion fermée sans réponse')
};
export const whyText = w => { const s = String(w || ''); if (WHY[s]) return WHY[s](); if (s.startsWith('reply:')) return tl('la réponse ne revient pas ({0})', whyText(s.slice(6))); return s; };
const KIND_TXT = { straight: () => tl('droit'), crossover: () => tl('croisé'), fault: () => tl('défectueux'), none: () => tl('non serti') };
const FAULT_TXT = { open: () => tl('conducteur coupé'), short: () => tl('court-circuit'), reversed: () => tl('paire inversée'), crossed: () => tl('paires croisées'), miswire: () => tl('conducteurs mélangés'), split: () => tl('paire séparée') };
const SRC_TXT = { static: () => tl('adresse fixe'), apipa: () => tl('adresse 169.254 (aucun serveur DHCP n’a répondu)'), none: () => tl('aucune adresse'), program: () => tl('adresse fixée par le programme') };
const FIELD_TXT = { mode: () => tl('mode (fixe ou DHCP)'), ip: () => tl('adresse'), prefix: () => tl('masque'), gw: () => tl('passerelle'), net: () => tl('sous-réseau') };

/** Message d'un contrôle du réseau, réussi ou non. */
export function netResultText(c, r) {
  if (r.ok) {
    return ({ 'net-devices': tl('Tous les équipements sont posés.'), 'net-cable': tl('Câble conforme.'), 'net-link': tl('Lien établi.'), 'net-ping': tl('Le ping passe.'), 'net-dhcp': tl('Adresses reçues du serveur DHCP.'), 'net-poe': tl('Appareils alimentés.'), 'net-ok': tl('Plan réseau sans erreur.'), 'net-ip': tl('Réglage IP correct.'), 'net-wifi': tl('Connecté au Wi-Fi.'), 'net-http': tl('La page web s’affiche.'), 'net-mqtt': tl('Le broker reçoit les messages.'), 'net-modbus': tl('L’automate répond en Modbus TCP.'), 'net-fibre': tl('Liaison fibre conforme.'), 'net-vlan': tl('VLAN conformes.'), 'net-trace': tl('Le traceroute passe par le bon chemin.'), 'net-stp': tl('Spanning Tree conforme.'), 'net-lag': tl('Agrégat formé.'), 'net-route': tl('Route présente.') })[c.type] || tl('C’est bien ça.');
  }
  if (PRO_LAB[c.type]) return PRO_LAB[c.type].text(c, r);
  switch (c.type) {
    case 'net-devices': return tl('Il manque dans le plan réseau : {0}.', r.missing.map(m => `${m.n > 1 ? m.n + ' × ' : ''}${m.type}${m.name ? ' ' + m.name : ''}`).join(', '));
    case 'net-cable':
      if (r.why === 'nocable') return tl('Aucun câble à cet endroit : tirez-en un avec l’outil Câble.');
      if (r.why === 'crimp') return tl('Le câble n’est pas serti des deux côtés : sertissez chaque fiche (inspecteur du câble).');
      if (r.why === 'faults') return tl('Le câble a un défaut : {0}. Passez-le au testeur.', r.faults.map(f => (FAULT_TXT[f] ? FAULT_TXT[f]() : f)).join(', '));
      if (r.why === 'kind') return tl('Le câble est {0}, il faut un câble {1}.', KIND_TXT[r.kind] ? KIND_TXT[r.kind]() : r.kind, KIND_TXT[c.kind] ? KIND_TXT[c.kind]() : c.kind);
      if (r.why === 'std1') return tl('La fiche est sertie, mais les conducteurs ne suivent pas l’ordre T568{0} : recommencez-la.', c.std);
      if (r.why === 'crimp' && c.side) return tl('Cette fiche n’est pas encore sertie.');
      if (r.why === 'std') return tl('Les deux fiches doivent suivre la norme T568{0} (ici : {1} et {2}).', c.std, r.ends[0] ? 'T568' + r.ends[0] : '?', r.ends[1] ? 'T568' + r.ends[1] : '?');
      if (r.why === 'cat') return tl('Catégorie trop basse : il faut du {0}.', (CATS[c.cat] || {}).name || c.cat);
      return tl('Câble non conforme.');
    case 'net-link':
      if (r.why === 'noa' || r.why === 'nob') return tl('Équipement introuvable dans le plan : {0}.', r.why === 'noa' ? c.a : c.b);
      if (r.why === 'speed') return tl('{0} : lien à {1} Mb/s seulement, il en faut {2}.', r.name, r.speed, c.speed);
      if (r.why === 'mdix') return r.mdix ? tl('{0} : le lien passe, mais grâce à l’Auto-MDIX. Ici il faut le bon câble sans compter sur lui.', r.name) : tl('{0} : le lien passe sans que l’Auto-MDIX ait à croiser.', r.name);
      return tl('{0} : pas de lien vers {1} ({2}).', r.name, c.b, whyText(r.why));
    case 'net-ping':
      if (r.why === 'nofrom' || r.why === 'noto') return tl('Équipement introuvable dans le plan : {0}.', r.why === 'nofrom' ? c.from : c.to);
      return tl('Ping de {0} vers {1} : échec, {2}.', r.from, r.to, whyText(r.why));
    case 'net-dhcp':
      if (r.why === 'server') return tl('{0} a reçu son adresse de {1}, pas du bon serveur DHCP.', r.name, r.server);
      if (r.why === 'none' && !r.name) return tl('Équipement introuvable dans le plan : {0}.', c.of);
      return tl('{0} n’a pas d’adresse du DHCP : {1}.', r.name, SRC_TXT[r.why] ? SRC_TXT[r.why]() : r.why);
    case 'net-poe': return r.name ? tl('{0} n’est pas alimenté : {1}.', r.name, whyText(r.why)) : tl('Équipement introuvable dans le plan : {0}.', c.of);
    case 'net-ok': return r.why === 'empty' ? tl('Le plan réseau est vide.') : tl('Encore {0} problème(s) : {1}', r.issues.length, r.issues.slice(0, 2).map(i => `${i.code} ${i.text}`).join(' ; '));
    case 'net-ip': return r.name ? tl('{0} : réglez {1} (onglet Réseau de l’inspecteur).', r.name, r.bad.map(k => FIELD_TXT[k] ? FIELD_TXT[k]() : k).join(', ')) : tl('Équipement introuvable dans le plan : {0}.', c.of);
    case 'net-wifi': return r.name ? tl('{0} n’est pas connecté au Wi-Fi ({1}).', r.name, r.why === 'ap' ? tl('mauvais point d’accès') : whyText('wifi:' + r.why)) : tl('Équipement introuvable dans le plan : {0}.', c.of);
    case 'net-http':
      if (r.why === 'body') return tl('La page {0} s’affiche, mais pas ce qui est attendu.', r.url);
      if (r.why === 'code') return tl('{0} répond avec le code {1}.', r.url, r.code);
      if (r.why === 'noip-target') return tl('{0} n’a pas encore d’adresse IP : le programme tourne-t-il ?', r.to || c.to);
      return tl('Le navigateur n’obtient pas la page : {0}.', whyText(r.why));
    case 'net-mqtt':
      if (r.why === 'nobroker') return tl('Il faut un Serveur MQTT dans le plan réseau.');
      if (r.why === 'text') return tl('Le sujet {0} reçoit « {1} », pas ce qui est attendu.', r.topic, r.text);
      if (r.why === 'nosub') return tl('Aucun client n’est abonné à {0}.', c.subscribed);
      return r.clients ? tl('Un client est connecté, mais rien n’arrive sur {0}.', c.topic) : tl('Aucun client connecté au broker : vérifiez l’adresse du serveur et le réseau.');
    case 'net-modbus': return r.why === 'value' ? tl('Le registre {0} de l’automate n’a pas la valeur attendue.', c.addr) : r.why === 'other' ? tl('L’automate reçoit des requêtes, mais pas celle attendue.') : tl('Aucune requête Modbus n’arrive à l’automate.');
    default: return tl('Pas encore.');
  }
}
