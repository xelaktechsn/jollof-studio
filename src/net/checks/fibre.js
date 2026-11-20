// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérifications du plan réseau (partie fibre), fusionnées par src/net/issues.js (codes J12xx) et contrôles de TP
// fusionnés par src/net/labcheck.js.
//   J1240 bilan optique dépassé · J1241 liaison plus longue que la portée du module · J1242 module qui ne va pas avec la
//   fibre (SR sur monomode, LR sur multimode, LX sur multimode sans cordon de conditionnement, monomode et multimode
//   mélangés) · J1243 support : module cuivre sur fibre, module optique sur cuivre, fibre sur un port RJ45 · J1244 modules
//   différents aux deux bouts · J1245 cage SFP câblée sans module · J1246 marge faible (moins de 3 dB sur le bilan de
//   puissance) · J1247 types de fibre mélangés dans un canal · J1248 module qui n'entre pas dans la cage (10G dans une cage
//   1G) · J1249 récepteur saturé (pas assez de perte : il faut un atténuateur).
// Les liens se lisent dans la simulation quand elle les calcule (lan.port(n, p).fibre), sinon ils sont calculés ici depuis
// le plan (mêmes fonctions de fibre.js) : les contrôles marchent dans les deux cas.
import { tl, isEn } from '../../i18n/index.js';
import { portOf, specOf } from '../devices.js';
import { NET } from '../limits.js';
import { fibreChannel, fibreLink, walkChannel, moduleAt, moduleOf, cageFits, isFibre, FIBRE_TYPES } from '../fibre.js';

/** Niveau de chaque code : 'error' | 'warning'. */
export const CODES = {
  J1240: 'error', J1241: 'error', J1242: 'error', J1243: 'error', J1244: 'error', J1245: 'error', J1246: 'warning', J1247: 'warning', J1248: 'error', J1249: 'error'
};
const MODSRC = ['cisco1gSfp', 'cisco10gSfpPlus', 'cisco25gSfp28'];
/** Sources de chaque code (clés de src/check/sources.js). */
export const SRC = {
  J1240: ['foaLossBudget', 'foaLinkspec', 'flukeOmOsFiber', 'corningTugOfWar', ...MODSRC],
  J1241: ['foaLinkspec', 'flukeOmOsFiber', ...MODSRC],
  J1242: ['flukeOmOsFiber', 'cisco1gSfp', 'cisco10gSfpPlus', 'ciscoMcpBulletin'],
  J1243: ['cisco1gSfp', 'cisco10gSfpPlus'],
  J1244: ['foaLossBudget', ...MODSRC],
  J1245: ['cisco1gSfp', 'cisco10gSfpPlus'],
  J1246: NET.FIBRE_MARGIN_DB.src,
  J1247: ['flukeOmOsFiber', 'foaSmfTypes'],
  J1248: NET.FIBRE_CAGE.src,
  J1249: ['foaLossBudget', 'cisco10gSfpPlus']
};

/* ---------- Liaisons ---------- */
// Coût : le vérificateur tourne à chaque changement du plan (et à chaque recalcul du réseau). Les ports d'un équipement
// sont lus dans une table gardée par équipement (devices.js reconstruit sa liste à chaque appel) ; avec la simulation,
// les canaux viennent de lan.state().chans (déjà calculés) ; les défauts d'une liaison sont gardés tant que sa signature
// (noms, modules, cages, champs des câbles, résultat du lien) ne change pas.
// Les ports utiles ici (cage SFP, port passif) ne dépendent que du type ; ses réglages ne changent que vitesse et Auto-MDIX.
const portTables = new Map(); // type → Map(id du port → port)
function tablePort(d, pid) {
  let m = portTables.get(d.type);
  if (!m) { const s = specOf(d); m = new Map((s ? s.ports(d.p || {}) : []).map(x => [x.id, x])); portTables.set(d.type, m); }
  return m.get(pid) || null;
}
/** Le type de cet équipement a-t-il des cages SFP ? (gardé par type : les cages ne dépendent pas des réglages). */
const sfpTypes = new Map();
function sfpType(d) {
  let v = sfpTypes.get(d.type);
  if (v === undefined) { const s = specOf(d); v = !!s && s.ports(d.p || {}).some(x => x.sfp); sfpTypes.set(d.type, v); }
  return v;
}
/**
 * Liaisons brutes (sans calcul) : fn({ key, an, ap, bn, bp, cables, passes, d, fd, pa, pb, lp }) pour chaque liaison qui touche
 * une cage SFP ou un câble fibre, une fois par liaison. L'objet passé est réutilisé : le copier pour le garder.
 */
function eachLink(data, lan, ports, fn) {
  const cur = {}; // liaison brute en cours, réutilisée (rien n'est alloué pour une liaison inchangée)
  const devs = (data && data.devices) || [], cables = (data && data.cables) || [];
  const pt = ports === portOf ? tablePort : (d, pid) => { try { return ports(d, pid); } catch (e) { return null; } };
  const st = lan && typeof lan.state === 'function' ? safe(() => lan.state()) : null;
  if (st && st.chans instanceof Map && st.byId instanceof Map) {
    // Canaux de la simulation : chaque port actif câblé, déjà parcouru à travers les ports passifs ; ses nœuds (copies des
    // équipements du plan, mêmes réglages p) ; les nœuds du montage (modules Ethernet) n'ont pas de cage.
    const byId = st.byId;
    const sfpOf = ports === portOf ? sfpType : () => true;
    for (const [k, ch] of st.chans) {
      const cs = ch && ch.cables, far = ch && ch.far;
      if (!far || !cs || !cs.length) continue;
      // Bout proche lu dans le premier câble (sans découper la clé) ; une fois par liaison (ordre des deux bouts).
      const c0 = cs[0], near = k.length === c0.a[0].length + 1 + c0.a[1].length && k.startsWith(c0.a[0]) && k.endsWith(c0.a[1]) ? c0.a : c0.b;
      const n = near[0], p = near[1];
      if (far.n < n || (far.n === n && far.p < p)) continue;
      const d = byId.get(n), fd = byId.get(far.n); if (!d || !fd) continue;
      let fib = false; for (const c of cs) if (c.media === 'fibre') { fib = true; break; }
      if (!fib && !sfpOf(d) && !sfpOf(fd)) continue;
      const pa = pt(d, p), pb = pt(fd, far.p); if (!pa || !pb) continue;
      if (!pa.sfp && !pb.sfp && !fib) continue;
      fn(fill(cur, k, n, p, far.n, far.p, cs, cs.length - 1, d, fd, pa, pb, st.links ? st.links.get(k) : null));
    }
    return;
  }
  // Sans simulation : parcours du plan.
  const byId = new Map(); for (const d of devs) byId.set(d.id, d);
  const byPort = new Map();
  for (const c of cables) { byPort.set(c.a[0] + '|' + c.a[1], c); byPort.set(c.b[0] + '|' + c.b[1], c); }
  const done = new Set();
  for (const c of cables) for (const end of [c.a, c.b]) {
    const d = byId.get(end[0]), pa = d && pt(d, end[1]);
    if (!pa || pa.passive) continue;
    const w = walkChannel(data, byId, byPort, pt, end[0], end[1]);
    if (!w.far) continue;
    const fd = byId.get(w.far.n), pb = fd && pt(fd, w.far.p); if (!pb) continue;
    if (!pa.sfp && !pb.sfp && !w.cables.some(isFibre)) continue;
    const k = [end.join('|'), w.far.n + '|' + w.far.p].sort().join('#'); if (done.has(k)) continue; done.add(k);
    fn(fill(cur, k, end[0], end[1], w.far.n, w.far.p, w.cables, w.passes, d, fd, pa, pb, lan && typeof lan.port === 'function' ? safe(() => lan.port(end[0], end[1])) : null));
  }
}
const fill = (o, key, an, ap, bn, bp, cables, passes, d, fd, pa, pb, lp) => {
  o.key = key; o.an = an; o.ap = ap; o.bn = bn; o.bp = bp; o.cables = cables; o.passes = passes; o.d = d; o.fd = fd; o.pa = pa; o.pb = pb; o.lp = lp; return o;
};
/** Liaison calculée depuis une liaison brute : { a, b, cables, passes, ch, link, modA, modB, cageA, cageB }. */
function build(r) {
  const modA = r.pa.sfp ? moduleAt(r.d, r.ap) : null, modB = r.pb.sfp ? moduleAt(r.fd, r.bp) : null;
  const ch = fibreChannel(r.cables, r.passes);
  const link = r.lp && r.lp.fibre ? r.lp.fibre : fibreLink(ch, modA, modB);
  return { a: { n: r.an, p: r.ap }, b: { n: r.bn, p: r.bp }, cables: r.cables, passes: r.passes, ch, link, modA, modB, cageA: r.pa.sfp || null, cageB: r.pb.sfp || null };
}
/**
 * Liaisons du plan qui touchent une cage SFP ou un câble fibre : [{ a: { n, p }, b: { n, p }, cables, passes, ch (fibreChannel),
 * link (fibreLink), modA, modB, cageA, cageB }]. data : plan propre ; lan (facultatif) : réseau simulé (ses canaux et ses
 * liens .fibre servent alors) ; ports (tests) : (équipement, id) → port, à la place de devices.js.
 */
export function fibreLinks(data, lan, ports = portOf) {
  const out = []; eachLink(data, lan, ports, r => out.push(build(r))); return out;
}
const safe = f => { try { return f(); } catch (e) { return null; } };
/**
 * Empreinte d'une liaison brute : tout ce dont dépendent ses défauts (noms, ports, cages, modules, câbles et leurs champs,
 * résultat du lien de la simulation), à plat dans un tableau ; same() compare sans rien construire.
 */
function snapshot(r, name) {
  const v = [name(r.an), name(r.bn), r.ap, r.bp, r.pa.sfp, r.pb.sfp, r.pa.sfp ? moduleAt(r.d, r.ap) : null, r.pb.sfp ? moduleAt(r.fd, r.bp) : null, r.cables.length];
  for (const c of r.cables) v.push(c.id, c.len, c.media, c.fibre, c.splices, c.attn, c.mcp);
  const f = r.lp && r.lp.fibre; v.push(!!f); if (f) v.push(f.up, f.why, f.loss, f.budget, f.overload, f.need);
  return v;
}
function same(v, r, name) {
  if (v[2] !== r.ap || v[3] !== r.bp || v[4] !== r.pa.sfp || v[5] !== r.pb.sfp || v[8] !== r.cables.length) return false;
  if (v[6] !== (r.pa.sfp ? moduleAt(r.d, r.ap) : null) || v[7] !== (r.pb.sfp ? moduleAt(r.fd, r.bp) : null)) return false;
  if (v[0] !== name(r.an) || v[1] !== name(r.bn)) return false;
  let i = 9;
  for (const c of r.cables) {
    if (v[i] !== c.id || v[i + 1] !== c.len || v[i + 2] !== c.media || v[i + 3] !== c.fibre || v[i + 4] !== c.splices || v[i + 5] !== c.attn || v[i + 6] !== c.mcp) return false;
    i += 7;
  }
  const f = r.lp && r.lp.fibre;
  if (v[i] !== !!f) return false;
  return !f || (v[i + 1] === f.up && v[i + 2] === f.why && v[i + 3] === f.loss && v[i + 4] === f.budget && v[i + 5] === f.overload && v[i + 6] === f.need);
}
let memo = new Map(); // clé de la liaison → { v (empreinte), list (défauts) }

/** Défauts d'une liaison : [{ code, id, text }] (sans le nom des équipements : h.name). */
function linkIssues(L, h) {
  const out = [], name = id => (h && h.name ? h.name(id) : id), who = tl('{0} ↔ {1}', name(L.a.n), name(L.b.n));
  const cid = (L.cables.find(isFibre) || L.cables[0] || {}).id ?? null, push = (code, id, text) => out.push({ code, id, text });
  const ch = L.ch, lk = L.link || {}, fib = ch.media !== 'copper';
  // Bouts : port RJ45 sur une fibre, cage vide, module qui n'entre pas dans sa cage.
  let endBad = false;
  for (const [end, cage, mod] of [[L.a, L.cageA, L.modA], [L.b, L.cageB, L.modB]]) {
    if (!cage) { if (fib) { push('J1243', end.n, tl('Liaison {0} : la fibre arrive sur un port RJ45 de {1}, qui n’a pas de cage SFP.', who, name(end.n))); endBad = true; } continue; }
    if (!mod) { push('J1245', end.n, tl('{0} : la cage {1} est câblée mais vide, sans module SFP.', name(end.n), end.p)); endBad = true; continue; }
    if (!moduleOf(mod)) { push('J1245', end.n, tl('{0} : module « {1} » inconnu dans la cage {2}.', name(end.n), mod, end.p)); endBad = true; continue; }
    if (!cageFits(cage, mod)) { push('J1248', end.n, tl('{0} : un module {1} n’entre pas dans la cage {2} ({3}) : il lui faut une cage {4}.', name(end.n), mod, end.p, cage.toUpperCase(), moduleOf(mod).form.toUpperCase())); endBad = true; }
  }
  if (ch.mixed && ch.modes.length === 1) push('J1247', cid, tl('Liaison {0} : fibres {1} mélangées dans le même canal ; le calcul prend la plus faible.', who, ch.types.map(t => FIBRE_TYPES[t].name).join(' + ')));
  if (endBad) return out;
  const m = moduleOf(L.modA) || moduleOf(L.modB), mname = m ? m.name : '?';
  switch (lk.why) {
    case 'media':
      if (ch.media === 'mixed') push('J1243', cid, tl('Liaison {0} : câbles cuivre et fibre bout à bout ; il faut un convertisseur de média entre les deux.', who));
      else if (ch.media === 'copper') push('J1243', cid, tl('Liaison {0} : module optique {1} sur un câble cuivre.', who, mname));
      else push('J1243', cid, tl('Liaison {0} : module cuivre {1} sur une fibre.', who, [L.modA, L.modB].find(x => moduleOf(x) && moduleOf(x).media === 'copper') || mname));
      break;
    case 'mismatch': push('J1244', cid, tl('Liaison {0} : {1} d’un côté, {2} de l’autre ; les deux bouts doivent porter le même module.', who, L.modA, L.modB)); break;
    case 'fibretype':
      if (lk.need === 'mcp') push('J1242', cid, tl('Liaison {0} : {1} sur fibre multimode sans cordon de conditionnement de mode.', who, mname));
      else if (ch.modes.length > 1) push('J1242', cid, tl('Liaison {0} : fibre monomode et multimode dans le même canal.', who));
      else push('J1242', cid, tl('Liaison {0} : {1} ne fonctionne pas sur fibre {2}.', who, mname, ch.types.map(t => FIBRE_TYPES[t].name).join(' + ')));
      break;
    case 'reach': push('J1241', cid, tl('Liaison {0} : {1} m, au-delà des {2} m de {3} sur ce support.', who, Math.round(ch.len), lk.reach, mname)); break;
    case 'budget': push('J1240', cid, tl('Liaison {0} : {1} dB de perte pour {2} dB tolérés par {3}.', who, fmt(lk.loss), fmt(lk.budget), mname)); break;
    case 'nomodule': push('J1245', L.a.n, tl('Liaison {0} : il manque un module à un bout.', who)); break;
    default:
      if (lk.up && lk.overload > 0) push('J1249', cid, tl('Liaison {0} : {1} dB de perte seulement, le récepteur de {2} sature ; ajoutez un atténuateur d’au moins {3} dB.', who, fmt(lk.loss), mname, fmt(lk.overload)));
      else if (lk.up && lk.basis === 'power' && lk.margin != null && lk.margin < NET.FIBRE_MARGIN_DB.v) push('J1246', cid, tl('Liaison {0} : marge de {1} dB seulement sur le bilan de {2} ({3} dB conseillés).', who, fmt(lk.margin), mname, NET.FIBRE_MARGIN_DB.v));
  }
  return out;
}
const fmt = x => (x == null ? '?' : (Math.round(x * 100) / 100).toLocaleString(isEn ? 'en' : 'fr-FR'));

/** data : plan propre (clean.js) ; lan : réseau simulé ; h : { name(id) }. Rend [{ code, id, text }]. */
export function issues(data, lan, h, ports = portOf) {
  const out = [], next = new Map(), name = id => (h && h.name ? h.name(id) : id);
  eachLink(data, lan, ports, r => {
    let m = memo.get(r.key);
    if (!m || !same(m.v, r, name)) m = { v: snapshot(r, name), list: linkIssues(build(r), h) };
    next.set(r.key, m);
    for (const i of m.list) out.push(i);
  });
  memo = next; // seulement les liaisons d'aujourd'hui : la table ne grossit pas
  return out;
}

/* ---------- Contrôle de TP ---------- */
/**
 * { type: 'net-fibre', min?: 1, speed?: 10000, margin?: dB }   au moins min liaisons fibre ; chacune établie, sans défaut
 * J1240–J1249 (sauf l'avertissement de marge), d'au moins speed Mb/s et avec au moins margin dB de marge.
 */
export const LAB = {
  'net-fibre': {
    check(c, env) {
      const data = env.netData ? env.netData() : null; if (!data) return { ok: false, why: 'none', links: [] };
      const name = id => { const d = data.devices.find(x => x.id === id); return d ? d.name || id : id; };
      const all = fibreLinks(data, null).filter(L => L.ch.media !== 'copper');
      const links = all.map(L => ({ a: name(L.a.n), b: name(L.b.n), up: !!L.link.up, speed: L.link.speed || 0, loss: L.link.loss, budget: L.link.budget, margin: L.link.margin, issues: linkIssues(L, { name }).filter(i => i.code !== 'J1246' && i.code !== 'J1247') }));
      if (links.length < (c.min ?? 1)) return { ok: false, why: 'none', links };
      const bad = links.find(l => !l.up || l.issues.length || (c.speed && l.speed < c.speed) || (c.margin != null && (l.margin ?? -1) < c.margin));
      return { ok: !bad, why: bad ? 'link' : null, bad: bad || null, links };
    },
    text(c, r) {
      if (r.why === 'none') return tl('Aucune liaison fibre complète dans le plan (il en faut {0}).', c.min ?? 1);
      const b = r.bad; if (!b) return tl('Liaison fibre à revoir.');
      if (b.issues.length) return b.issues[0].text;
      if (c.speed && b.speed < c.speed) return tl('Liaison {0} ↔ {1} : {2} Mb/s, il en faut {3}.', b.a, b.b, b.speed, c.speed);
      if (c.margin != null && b.up) return tl('Liaison {0} ↔ {1} : marge de {2} dB, il en faut au moins {3}.', b.a, b.b, fmt(b.margin), c.margin);
      return tl('Liaison {0} ↔ {1} : pas de lien.', b.a, b.b);
    }
  }
};
