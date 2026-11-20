// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérifications du plan réseau (partie design), fusionnées par src/net/issues.js (codes J12xx) et contrôles de TP
// fusionnés par src/net/labcheck.js. Elles ne jouent que dans un projet de câblage structuré (au moins une baie) : les
// petits plans des TP d'initiation n'en reçoivent aucune.
//   J1290 réserve de ports d'un local technique sous la cible · J1291 surréservation d'un switch d'accès au-dessus de la
//   cible · J1292 réserve PoE d'un switch sous la marge visée (budget pas encore dépassé : sinon J1212) · J1293 étiquette
//   en double · J1294 prise sans lien permanent vers un panneau de brassage · J1295 pièce équipée de moins de prises que
//   le dimensionnement n'en demande.
import { tl } from '../../i18n/index.js';
import { specOf } from '../devices.js';
import { NET } from '../limits.js';
import { cleanDesign, dimension, switchPorts, horizontalLinks, spacesOf, roomOfDev } from '../dimension.js';
import { labeler, labelIssues, bom, kindName } from '../docs.js';
import { parseCidr, overlaps, contains, usableOf } from '../subnet.js';
import { hostOk } from '../ip.js';

/** Niveau de chaque code : 'error' | 'warning'. */
export const CODES = { J1290: 'warning', J1291: 'warning', J1292: 'warning', J1293: 'warning', J1294: 'warning', J1295: 'warning' };
/** Sources de chaque code (clés de src/check/sources.js). */
export const SRC = {
  J1290: NET.DESIGN_SPARE_GROWTH.src, J1291: NET.OVERSUB_ACCESS.src, J1292: NET.POE_PSE_W.src,
  J1293: ['tia606aCim', 'panduitIdan02'], J1294: ['tia606aCim', 'nsTpwCabling'], J1295: NET.WA_AREA_M2.src
};
const designOf = data => (data.design && data.design.usage ? data.design : cleanDesign(data.design));
const isOutlet = d => d.type === 'outlet' || d.type === 'outlet2';
/** Le projet est-il un projet de câblage structuré (baies posées) ? */
export const active = data => !!(data && (data.racks || []).length);

/** Ports d'accès des switchs de chaque local technique : { key → { total, used, sw: [ids], rack } }. */
function portsBySpace(data, used) {
  const rackSpace = new Map(); for (const s of spacesOf(data)) for (const r of s.racks) rackSpace.set(r.id, s.key);
  const out = new Map();
  for (const d of data.devices || []) {
    if (!d.rack || (specOf(d) || {}).role !== 'switch') continue;
    const k = rackSpace.get(d.rack.id); if (!k) continue;
    if (!out.has(k)) out.set(k, { total: 0, used: 0, sw: [], rack: d.rack.id });
    const e = out.get(k), sp = switchPorts(d.type); e.sw.push(d.id);
    e.total += sp.acc.length; e.used += sp.acc.filter(p => used.has(d.id + '|' + p.id)).length;
  }
  return out;
}
/** data : plan propre (clean.js) ; lan : réseau simulé ; h : { name(id) }. Rend [{ code, id, text }]. */
export function issues(data, lan, h) {
  if (!active(data)) return [];
  const D = designOf(data), out = [], name = id => (h && h.name ? h.name(id) : id);
  const used = new Set(); for (const c of data.cables || []) { used.add(c.a.join('|')); used.add(c.b.join('|')); }
  const L = labeler(data);
  // J1290 : réserve de ports par local.
  for (const [k, e] of portsBySpace(data, used)) {
    if (!e.used) continue;
    const want = Math.ceil(e.used * (1 + D.spare / 100));
    if (e.total < want) out.push({ code: 'J1290', id: e.rack, text: tl('Local {0} : {1} ports d’accès utilisés sur {2}, réserve de {3} % (visée {4} %).', L.space(k) || k, e.used, e.total, Math.round(((e.total - e.used) / e.used) * 100), D.spare) });
  }
  // J1291 : surréservation de chaque switch d'accès (ports d'accès câblés / liaisons montantes câblées).
  for (const d of data.devices || []) {
    if ((specOf(d) || {}).role !== 'switch' || d.type === 'l3switch') continue;
    const sp = switchPorts(d.type), acc = sp.acc.filter(p => used.has(d.id + '|' + p.id)), up = sp.up.filter(p => used.has(d.id + '|' + p.id));
    if (!acc.length || !up.length) continue;
    const r = acc.reduce((a, p) => a + (p.speed || 1000), 0) / up.reduce((a, p) => a + (p.speed || 1000), 0);
    if (r > D.oversub) out.push({ code: 'J1291', id: d.id, text: tl('{0} : surréservation de {1}:1 vers le cœur de réseau (visée {2}:1 au plus).', name(d.id), +r.toFixed(1), D.oversub) });
  }
  // J1292 : marge PoE (les refus de budget sont déjà J1212).
  const st = lan && lan.state ? lan.state() : null;
  if (st && st.poe) for (const [id, info] of st.poe) {
    if (!info.budget || info.ports.some(p => p.denied)) continue;
    const lim = info.budget * (1 - D.poeMargin / 100);
    if (info.used > lim) out.push({ code: 'J1292', id, text: tl('{0} : {1} W de PoE réservés sur {2} W, il reste moins des {3} % de marge visés.', name(id), +info.used.toFixed(1), info.budget, D.poeMargin) });
  }
  // J1293 : étiquettes en double.
  for (const g of labelIssues(data).dups.slice(0, 50)) out.push({ code: 'J1293', id: g.items[0].id, text: tl('Étiquette « {0} » portée par {1} objets ({2}).', g.label, g.items.length, [...new Set(g.items.map(i => kindName(i.kind)))].join(', ')) });
  // J1294 : prises sans lien permanent.
  const linked = new Set(horizontalLinks(data).map(l => l.outlet + '|' + l.oport));
  for (const d of data.devices || []) {
    if (!isOutlet(d)) continue;
    const miss = specOf(d).ports(d.p || {}).filter(p => p.punch && !linked.has(d.id + '|' + p.id));
    if (miss.length) out.push({ code: 'J1294', id: d.id, text: tl('Prise {0} : {1} sans lien permanent vers un panneau de brassage.', d.name, miss.map(p => p.label || p.id).join(', ')) });
  }
  // J1295 : pièces commencées mais sous-équipées.
  const dim = dimension(data);
  for (const r of dim.rooms) if (r.placed > 0 && r.placed < r.outlets) out.push({ code: 'J1295', id: r.id, text: tl('{0} : {1} prises posées pour {2} prévues par le dimensionnement.', r.name, r.placed, r.outlets) });
  return out;
}

/* ---------- Contrôles de TP ---------- */
/** Prises posées par pièce (ports). */
function outletsByRoom(data) {
  const m = new Map();
  for (const d of data.devices || []) { if (!isOutlet(d)) continue; const r = roomOfDev(data, d); if (r) m.set(r.id, (m.get(r.id) || 0) + specOf(d).ports(d.p || {}).filter(p => p.punch).length); }
  return m;
}
/** Contrôles de TP : { 'net-…': { check(c, env) → { ok, … }, text(c, r) → texte de l'échec } } ; env : voir labcheck.js. */
export const LAB = {
  /**
   * { type: 'net-dim', area?: m² par poste au plus (réglage du dimensionnement), spare?: % au moins, rooms?: [noms] }
   * chaque pièce (ou celles nommées) a au moins les prises que demande le dimensionnement, chacune reliée à un panneau,
   * et chaque local a la réserve de ports voulue.
   */
  'net-dim': {
    check(c, env) {
      const data = env.netData(), D = designOf(data);
      if (c.area != null && D.area > c.area) return { ok: false, why: 'area', v: D.area };
      if (c.spare != null && D.spare < c.spare) return { ok: false, why: 'spare-set', v: D.spare };
      const dim = dimension(data), have = outletsByRoom(data), want = c.rooms ? new Set(c.rooms.map(s => String(s).toLowerCase())) : null;
      const rooms = dim.rooms.filter(r => r.outlets > 0 && (!want || want.has(String(r.name).toLowerCase()) || want.has(r.id)));
      if (!rooms.length) return { ok: false, why: 'rooms' };
      for (const r of rooms) if ((have.get(r.id) || 0) < r.outlets) return { ok: false, why: 'room', room: r.name, n: have.get(r.id) || 0, need: r.outlets };
      const linked = new Set(horizontalLinks(data).map(l => l.outlet + '|' + l.oport));
      for (const d of data.devices || []) if (isOutlet(d) && specOf(d).ports(d.p || {}).some(p => p.punch && !linked.has(d.id + '|' + p.id))) return { ok: false, why: 'link', name: d.name };
      const used = new Set(); for (const x of data.cables || []) { used.add(x.a.join('|')); used.add(x.b.join('|')); }
      const L = labeler(data);
      for (const [k, e] of portsBySpace(data, used)) if (e.used && e.total < Math.ceil(e.used * (1 + D.spare / 100))) return { ok: false, why: 'spare', space: L.space(k) || k };
      if (!portsBySpace(data, used).size) return { ok: false, why: 'switch' };
      return { ok: true };
    },
    text(c, r) {
      return ({
        area: () => tl('La densité réglée ({0} m² par poste) est plus faible que demandé ({1} m² au plus).', r.v, c.area),
        'spare-set': () => tl('La réserve de ports réglée ({0} %) est sous les {1} % demandés.', r.v, c.spare),
        rooms: () => tl('Aucune pièce à équiper : dessinez les pièces sur le plan.'),
        room: () => tl('{0} : {1} prises posées, il en faut {2}.', r.room, r.n, r.need),
        link: () => tl('La prise {0} n’est pas reliée à un panneau de brassage.', r.name),
        spare: () => tl('Local {0} : pas assez de ports de switch libres pour la réserve.', r.space),
        switch: () => tl('Aucun switch d’accès dans les baies.')
      }[r.why] || (() => tl('Dimensionnement incomplet.')))();
    }
  },
  /** { type: 'net-labels', match?: 'regex' } chaque port de prise a un identifiant, aucun en double, au format voulu. */
  'net-labels': {
    check(c, env) {
      const data = env.netData(), L = labeler(data), outs = (data.devices || []).filter(isOutlet);
      if (!outs.length) return { ok: false, why: 'none' };
      const li = labelIssues(data);
      if (li.empty.length) return { ok: false, why: 'empty', name: (outs.find(d => d.id === li.empty[0]) || {}).name };
      if (li.dups.length) return { ok: false, why: 'dup', label: li.dups[0].label };
      if (c.match) { let re; try { re = new RegExp(c.match); } catch (e) { return { ok: false, why: 'regex' }; } for (const d of outs) for (const p of specOf(d).ports(d.p || {}).filter(x => x.punch)) { const s = L.of(d.id, p.id); if (!re.test(s)) return { ok: false, why: 'format', label: s }; } }
      return { ok: true };
    },
    text(c, r) {
      return ({ none: () => tl('Aucune prise posée.'), empty: () => tl('La prise {0} n’a pas d’identifiant (pas de lien vers un panneau).', r.name), dup: () => tl('Identifiant « {0} » en double.', r.label), format: () => tl('« {0} » ne suit pas le format demandé.', r.label), regex: () => tl('Format demandé illisible.') }[r.why] || (() => tl('Étiquetage incomplet.')))();
    }
  },
  /** { type: 'net-bom', min?: total minimal } chaque ligne de la nomenclature a un prix (et le total atteint min). */
  'net-bom': {
    check(c, env) {
      const b = bom(env.netData());
      if (!b.lines.length) return { ok: false, why: 'empty' };
      if (b.unpriced.length) return { ok: false, why: 'price', key: b.lines.find(l => !l.price).name };
      if (c.min != null && b.total < c.min) return { ok: false, why: 'min', total: b.total };
      return { ok: true, total: b.total };
    },
    text(c, r) { return ({ empty: () => tl('La nomenclature est vide.'), price: () => tl('Ligne sans prix : {0}.', r.key), min: () => tl('Total de {0}, attendu au moins {1}.', r.total, c.min) }[r.why] || (() => tl('Chiffrage incomplet.')))(); }
  },
  /**
   * { type: 'net-subnet', block?: 'a.b.c.d/nn', vlans?: [ids] } chaque VLAN (ou ceux donnés) a un réseau dans le bloc,
   * assez grand pour ses hôtes prévus et la passerelle, une passerelle d'hôte dans son réseau, sans chevauchement.
   */
  'net-subnet': {
    check(c, env) {
      const data = env.netData(), all = data.vlans || [], list = c.vlans ? all.filter(v => c.vlans.includes(v.id)) : all;
      if (!list.length || (c.vlans && list.length < c.vlans.length)) return { ok: false, why: 'vlans' };
      for (const v of list) {
        const n = parseCidr(v.net); if (!n || !n.aligned) return { ok: false, why: 'net', id: v.id };
        if (c.block && !(contains(c.block, v.net.split('/')[0]) && n.prefix >= parseCidr(c.block).prefix)) return { ok: false, why: 'block', id: v.id };
        if (v.hosts != null && usableOf(n.prefix) < (+v.hosts || 0) + 1) return { ok: false, why: 'small', id: v.id };
        if (!v.gw || !contains(v.net, v.gw) || !hostOk(v.gw, n.prefix)) return { ok: false, why: 'gw', id: v.id };
      }
      const ov = overlaps(list.map(v => ({ id: v.id, net: v.net })));
      if (ov.length) return { ok: false, why: 'overlap', a: ov[0][0], b: ov[0][1] };
      return { ok: true };
    },
    text(c, r) {
      return ({ vlans: () => tl('Les VLAN demandés n’existent pas encore.'), net: () => tl('VLAN {0} : réseau absent ou mal aligné (adresse du réseau attendue).', r.id), block: () => tl('VLAN {0} : réseau hors du bloc {1}.', r.id, c.block), small: () => tl('VLAN {0} : réseau trop petit pour ses hôtes et la passerelle.', r.id), gw: () => tl('VLAN {0} : passerelle absente ou hors du réseau.', r.id), overlap: () => tl('Les réseaux des VLAN {0} et {1} se chevauchent.', r.a, r.b) }[r.why] || (() => tl('Plan d’adressage incomplet.')))();
    }
  }
};
