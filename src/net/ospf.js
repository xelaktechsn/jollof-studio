// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// OSPF (version 2, RFC 2328) des routeurs et des switchs de niveau 3 du plan réseau, calculé sans horloge à chaque
// recalcul : interfaces activées par les déclarations « network … area » (la première qui couvre l'adresse), identifiant
// de routeur (réglé, sinon la plus haute adresse), voisinages (même domaine de diffusion, même sous-réseau et masque, même
// aire, mêmes minuteries hello et dead, identifiants différents, interface non passive), coût = bande de référence / débit
// (au moins 1), plus court chemin (Dijkstra) depuis chaque routeur, réseaux annoncés par les interfaces OSPF (passives
// comprises) et route par défaut annoncée (« default-information originate »). Distance administrative 110.
// Modèle simplifié, dit à l'écran : une seule aire de fait (les aires doivent concorder sur chaque lien, il n'y a pas de
// routeur de bordure ni de résumé entre aires), pas d'élection DR/BDR, pas d'authentification ni de MTU, pas de partage de
// charge (une seule route retenue à coût égal).
import { netOf, ipNum } from './ip.js';
import { NET } from './limits.js';
import { parseNet, inNet, ifName, ospfIf } from './vlan.js';

/** Débit (Mb/s) d'une interface : celui du lien de son port ; une interface VLAN compte 1 Gb/s (modèle). */
const bwOf = (f, links) => { if (f.svi) return 1000; const l = links.get(f.node + '|' + f.port); return l && l.up ? l.speed || 1000 : 1000; };

/**
 * st : état du réseau (ifaces, byId, find, links, all). Rend { on (Set des routeurs OSPF), rid: Map, ifs: Map(routeur → [{ f,
 * name, area, cost, hello, dead, passive }]), adj: [{ a, b, fa, fb, up, why }], routes: Map(routeur → [{ net, prefix, iface,
 * via, metric, kind: 'ospf' }]) }.
 */
export function computeOspf(st) {
  const on = new Set(), rid = new Map(), ifs = new Map(), adj = [], routes = new Map();
  for (const n of st.all) {
    const O = (n.p || {}).ospf; if (!O || !O.on || (n.type !== 'routerpro' && n.type !== 'l3switch') || (n.type === 'l3switch' && n.p.routing === false)) continue;
    const own = st.ifaces.filter(f => f.node === n.id && f.role === 'l3' && f.ip && f.up !== false);
    const list = [];
    for (const f of own) {
      const st0 = O.nets.find(x => inNet(f.ip, parseNet(x.net))); if (!st0) continue; // « network … area » : la première qui couvre l'adresse
      const name = ifName(f), c = ospfIf(n.p, name);
      list.push({ f, name, area: st0.area, cost: c.cost || Math.max(1, Math.floor(O.ref / bwOf(f, st.links))), hello: c.hello, dead: c.dead, passive: c.passive });
    }
    on.add(n.id); ifs.set(n.id, list);
    rid.set(n.id, O.rid || own.map(f => f.ip).sort((a, b) => ipNum(b) - ipNum(a))[0] || '0.0.0.0');
  }
  // Voisinages : deux interfaces OSPF non passives de deux routeurs dans le même domaine de diffusion.
  const byDom = new Map();
  for (const [r, list] of ifs) for (const x of list) { const d = st.find(x.f.v); if (!byDom.has(d)) byDom.set(d, []); byDom.get(d).push({ r, x }); }
  for (const list of byDom.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j]; if (A.r === B.r) continue;
      const a = A.x, b = B.x;
      let why = null;
      if (a.passive || b.passive) why = 'passive';
      else if (a.f.prefix !== b.f.prefix || netOf(a.f.ip, a.f.prefix) !== netOf(b.f.ip, b.f.prefix)) why = 'subnet';
      else if (a.area !== b.area) why = 'area';
      else if (a.hello !== b.hello || a.dead !== b.dead) why = 'timers';
      else if (rid.get(A.r) === rid.get(B.r)) why = 'rid';
      adj.push({ a: A.r, b: B.r, fa: a, fb: b, up: !why, why });
    }
  }
  // Plus court chemin depuis chaque routeur (Dijkstra), puis les réseaux annoncés par les routeurs atteints.
  const nbr = new Map([...on].map(r => [r, []]));
  for (const e of adj) if (e.up) { nbr.get(e.a).push({ to: e.b, out: e.fa, via: e.fb.f.ip, cost: e.fa.cost }); nbr.get(e.b).push({ to: e.a, out: e.fb, via: e.fa.f.ip, cost: e.fb.cost }); }
  const hasDefault = r => st.routesNoOspf(r).some(x => x.prefix === 0);
  for (const S of on) {
    const dist = new Map([[S, 0]]), first = new Map([[S, null]]), done = new Set(), q = new Map([[S, 0]]);
    while (q.size) {
      let u = null; for (const [k, d] of q) if (u == null || d < q.get(u)) u = k;
      q.delete(u); done.add(u);
      for (const e of nbr.get(u)) {
        if (done.has(e.to)) continue;
        const d = dist.get(u) + e.cost;
        if (!dist.has(e.to) || d < dist.get(e.to)) { dist.set(e.to, d); first.set(e.to, u === S ? { iface: e.out.f, via: e.via } : first.get(u)); q.set(e.to, d); }
      }
    }
    const mine = new Set((ifs.get(S) || []).map(x => netOf(x.f.ip, x.f.prefix) + '/' + x.f.prefix));
    for (const f of st.ifaces) if (f.node === S && f.ip && f.up !== false) mine.add(netOf(f.ip, f.prefix) + '/' + f.prefix);
    const best = new Map();
    for (const [R, d] of dist) {
      if (R === S || !first.get(R)) continue;
      const ads = (ifs.get(R) || []).map(x => ({ net: netOf(x.f.ip, x.f.prefix), prefix: x.f.prefix, metric: d + x.cost }));
      if (st.byId.get(R).p.ospf.originate && hasDefault(R)) ads.push({ net: 0, prefix: 0, metric: d + 1 });
      for (const a of ads) {
        const k = a.net + '/' + a.prefix; if (mine.has(k)) continue;
        const cur = best.get(k); if (!cur || a.metric < cur.metric) best.set(k, { net: a.net >>> 0, prefix: a.prefix, iface: first.get(R).iface, via: first.get(R).via, metric: a.metric, kind: 'ospf', ad: NET.ADMIN_DIST.v.ospf, from: R });
      }
    }
    routes.set(S, [...best.values()]);
  }
  return { on, rid, ifs, adj, routes };
}
