// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// OSPF (version 2, RFC 2328) des routeurs et des switchs de niveau 3 du plan réseau, calculé sans horloge à chaque
// recalcul :
//   - interfaces activées par les déclarations « network … area » (la première qui couvre l'adresse), identifiant de
//     routeur (réglé, sinon la plus haute adresse), coût = bande de référence / débit (au moins 1) ;
//   - voisins (« 2-Way ») sur un segment : même domaine de diffusion, même sous-réseau et masque, même aire, mêmes
//     minuteries hello et dead, identifiants différents, interface non passive ;
//   - routeur désigné (DR) et de secours (BDR) de chaque segment (§ 9.4) : priorité la plus haute, puis l'identifiant le
//     plus haut ; priorité 0 : jamais DR ni BDR ; tous les routeurs démarrés ensemble (le DR en place n'est pas gardé
//     comme en vrai quand un routeur plus prioritaire arrive après : modèle simplifié). Adjacence complète (« Full »)
//     avec le DR et le BDR seulement, « 2-Way » entre les autres (§ 10.4) ; sans DR possible, pas d'adjacence ;
//   - aires (§ 3.2, 3.3, 16.1, 16.2) : plus court chemin (Dijkstra) par aire, réseaux de transit (avec un DR) et réseaux
//     terminaux ; les routeurs de bordure (ABR, une interface dans l'aire 0 et une autre aire) annoncent dans l'aire 0 les
//     réseaux de leurs autres aires, et dans chaque autre aire ce qu'ils joignent par l'aire 0 (résumés de type 3, sans
//     agrégation d'adresses). Une aire sans ABR relié à l'aire 0 n'apprend rien des autres (les liens virtuels, § 15, ne
//     sont pas simulés) ;
//   - chemins de même coût (§ 11) : tous gardés dans la route (paths), le premier (adresse la plus basse) sert au ping et
//     au traceroute ;
//   - route par défaut annoncée (« default-information originate ») : comme un réseau 0.0.0.0/0 du routeur qui l'annonce,
//     coût 1 (le type externe E2 n'est pas simulé à part).
// Distance administrative 110. Ni authentification, ni MTU, ni aires terminales (stub), ni agrégation.
import { netOf, ipNum } from './ip.js';
import { NET } from './limits.js';
import { parseNet, inNet, ifName, ospfIf } from './vlan.js';

/** Débit (Mb/s) d'une interface : celui du lien de son port ; une interface VLAN compte 1 Gb/s (modèle). */
const bwOf = (f, links) => { if (f.svi) return 1000; const l = links.get(f.node + '|' + f.port); return l && l.up ? l.speed || 1000 : 1000; };
const ipCmp = (a, b) => (ipNum(a) ?? 0) - (ipNum(b) ?? 0);
const pfx = (n, p) => `${[n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')}/${p}`;

/**
 * st : état du réseau (ifaces, byId, find, links, all, routesNoOspf). Rend {
 *   on: Set des routeurs OSPF, rid: Map(routeur → identifiant), areas: Map(routeur → Set des aires), abr: Set,
 *   ifs: Map(routeur → [{ f, name, area, cost, hello, dead, passive, prio, state: 'DR'|'BDR'|'DROTHER'|'' }]),
 *   adj: [{ a, b, fa, fb, up (voisins), full (adjacence complète), state: 'FULL'|'2WAY'|'', why }],
 *   segs: [{ key, area, net, members: [{ r, x }], dr, bdr }] (segments à deux routeurs ou plus),
 *   routes: Map(routeur → [{ net, prefix, iface, via, paths: [{ iface, via }], metric, kind: 'ospf', ad, type: 'intra'|'inter', area }]),
 *   orphan: [aire sans ABR relié à l'aire 0], noBackbone: [routeur à plusieurs aires sans aire 0], noDr: [segment sans DR possible]
 * }.
 */
export function computeOspf(st) {
  const on = new Set(), rid = new Map(), ifs = new Map(), areas = new Map(), adj = [], segs = [], routes = new Map();
  for (const n of st.all) {
    const O = (n.p || {}).ospf; if (!O || !O.on || (n.type !== 'routerpro' && n.type !== 'l3switch') || (n.type === 'l3switch' && n.p.routing === false)) continue;
    const own = st.ifaces.filter(f => f.node === n.id && f.role === 'l3' && f.ip && f.up !== false);
    const list = [];
    for (const f of own) {
      const st0 = O.nets.find(x => inNet(f.ip, parseNet(x.net))); if (!st0) continue; // « network … area » : la première qui couvre l'adresse
      const name = ifName(f), c = ospfIf(n.p, name);
      list.push({ f, name, area: st0.area, cost: c.cost || Math.max(1, Math.floor(O.ref / bwOf(f, st.links))), hello: c.hello, dead: c.dead, passive: c.passive, prio: c.prio, state: '' });
    }
    on.add(n.id); ifs.set(n.id, list); areas.set(n.id, new Set(list.map(x => x.area)));
    rid.set(n.id, O.rid || own.map(f => f.ip).sort((a, b) => ipCmp(b, a))[0] || '0.0.0.0');
  }
  const abr = new Set([...areas].filter(([, s]) => s.size > 1 && s.has(0)).map(([r]) => r));
  const noBackbone = [...areas].filter(([, s]) => s.size > 1 && !s.has(0)).map(([r]) => r);

  /* ---------- Voisins, DR et BDR de chaque segment ---------- */
  const byDom = new Map();
  for (const [r, list] of ifs) for (const x of list) { const d = st.find(x.f.v); if (!byDom.has(d)) byDom.set(d, []); byDom.get(d).push({ r, x }); }
  const noDr = [], segOf = new Map(); // interface → segment
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
      adj.push({ a: A.r, b: B.r, fa: a, fb: b, up: !why, full: false, state: '', why });
    }
    // Segments : interfaces qui se parlent (mêmes paramètres des hello), non passives.
    const groups = new Map();
    for (const m of list) {
      if (m.x.passive) continue;
      const k = [m.x.area, netOf(m.x.f.ip, m.x.f.prefix), m.x.f.prefix, m.x.hello, m.x.dead, st.find(m.x.f.v)].join('|');
      if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m);
    }
    for (const [k, members] of groups) {
      // Un routeur en double dans le segment (même identifiant) n'y prend pas part.
      const ok = members.filter(m => members.filter(o => o.r !== m.r && rid.get(o.r) === rid.get(m.r)).length === 0);
      const seg = { key: k, area: members[0].x.area, net: pfx(netOf(members[0].x.f.ip, members[0].x.f.prefix), members[0].x.f.prefix), members, dr: null, bdr: null };
      for (const m of members) segOf.set(m.x, seg);
      if (ok.length < 2) { if (members.length >= 2) segs.push(seg); continue; }
      // Élection (§ 9.4, démarrage simultané) : la plus haute priorité, puis le plus haut identifiant ; priorité 0 exclue.
      const el = ok.filter(m => m.x.prio > 0).sort((p, q) => q.x.prio - p.x.prio || ipCmp(rid.get(q.r), rid.get(p.r)));
      seg.dr = el[0] || null; seg.bdr = el[1] || null;
      for (const m of members) m.x.state = m === seg.dr ? 'DR' : m === seg.bdr ? 'BDR' : 'DROTHER';
      if (!seg.dr) noDr.push(seg);
      segs.push(seg);
    }
  }
  for (const e of adj) {
    if (!e.up) continue;
    const seg = segOf.get(e.fa), roles = [e.fa.state, e.fb.state];
    e.full = !!(seg && seg.dr && (roles.includes('DR') || roles.includes('BDR')));
    e.state = e.full ? 'FULL' : '2WAY';
  }

  /* ---------- Plus court chemin par aire ---------- */
  // Nœuds : routeurs 'R:id' et réseaux 'N:clé'. Routeur → réseau : coût de son interface ; réseau de transit (avec un DR)
  // → routeur adjacent au DR : 0 ; réseau terminal (interface passive, routeur seul, sans DR) : une feuille.
  const graphs = new Map(); // aire → Map(nœud → [{ to, cost, x (interface du routeur vers le réseau) }])
  const nets = new Map(); // aire → Map('N:clé' → { net, prefix, members: [{ r, x }] })
  const G = a => { if (!graphs.has(a)) { graphs.set(a, new Map()); nets.set(a, new Map()); } return graphs.get(a); };
  const edge = (g, u, to, cost, x) => { if (!g.has(u)) g.set(u, []); g.get(u).push({ to, cost, x }); };
  for (const [r, list] of ifs) for (const x of list) {
    const g = G(x.area), seg = segOf.get(x), transit = seg && seg.dr && seg.members.length > 1;
    const key = 'N:' + (transit ? seg.key : r + '|' + x.name);
    if (!nets.get(x.area).has(key)) nets.get(x.area).set(key, { net: netOf(x.f.ip, x.f.prefix) >>> 0, prefix: x.f.prefix, members: [] });
    nets.get(x.area).get(key).members.push({ r, x });
    edge(g, 'R:' + r, key, x.cost, x);
    if (transit && (x.state === 'DR' || x.state === 'BDR' || seg.dr)) edge(g, key, 'R:' + r, 0, x);
  }
  // Route par défaut annoncée : un réseau 0.0.0.0/0 du routeur, dans chacune de ses aires.
  const hasDefault = r => st.routesNoOspf(r).some(x => x.prefix === 0);
  for (const r of on) if (st.byId.get(r).p.ospf.originate && hasDefault(r)) for (const a of areas.get(r)) { const g = G(a), k = 'N:default|' + r; nets.get(a).set(k, { net: 0, prefix: 0, members: [], originate: r }); edge(g, 'R:' + r, k, 1, null); }
  /** Dijkstra depuis le routeur S dans l'aire a : Map(nœud → { d, hops: [{ iface, via }] }) ; chemins de même coût gardés. */
  function spf(S, a) {
    const g = graphs.get(a), out = new Map([['R:' + S, { d: 0, hops: [] }]]), done = new Set(), q = new Map([['R:' + S, 0]]);
    while (q.size) {
      let u = null; for (const [k, d] of q) if (u == null || d < q.get(u) || (d === q.get(u) && k < u)) u = k;
      q.delete(u); done.add(u);
      const cu = out.get(u);
      for (const e of g.get(u) || []) {
        if (done.has(e.to)) continue;
        const d = cu.d + e.cost;
        // Premier saut : le réseau voisin de S est connecté ; un routeur derrière ce réseau donne le prochain saut.
        let hops = cu.hops;
        if (u === 'R:' + S) hops = [{ iface: e.x.f, via: '', net: e.to }];
        else if (u.startsWith('N:') && cu.hops.length && cu.hops.every(h => !h.via)) hops = cu.hops.map(h => ({ iface: h.iface, via: e.x.f.ip }));
        const cur = out.get(e.to);
        if (!cur || d < cur.d) { out.set(e.to, { d, hops: hops.slice() }); q.set(e.to, d); }
        else if (d === cur.d) for (const h of hops) if (!cur.hops.some(x => x.iface === h.iface && x.via === h.via)) cur.hops.push(h);
      }
    }
    return out;
  }
  // Tables : réseaux de chaque aire (intra-aire), puis résumés des ABR (inter-aire).
  const intra = new Map(); // routeur → Map(préfixe → { metric, hops, area })
  const sp = new Map(); // routeur|aire → résultat de spf
  for (const r of on) {
    const m = new Map(); intra.set(r, m);
    for (const a of areas.get(r)) {
      const res = spf(r, a); sp.set(r + '|' + a, res);
      for (const [k, info] of nets.get(a)) {
        const x = res.get(k); if (!x) continue;
        const key = pfx(info.net, info.prefix), cur = m.get(key);
        if (!cur || x.d < cur.metric) m.set(key, { metric: x.d, hops: x.hops.slice(), area: a, net: info.net, prefix: info.prefix });
        else if (x.d === cur.metric) for (const h of x.hops) if (!cur.hops.some(y => y.iface === h.iface && y.via === h.via)) cur.hops.push(h);
      }
    }
  }
  /** Ajoute à la table t les routes vers les destinations que les ABR de l'aire a annoncent (summary : coût de l'ABR). */
  function inter(r, a, t, summaries) {
    const res = sp.get(r + '|' + a); if (!res) return;
    for (const B of abr) {
      if (B === r || !areas.get(B).has(a)) continue;
      const toB = res.get('R:' + B); if (!toB) continue;
      for (const [key, s] of summaries(B, a)) {
        if (intra.get(r).has(key)) continue;
        const metric = toB.d + s.metric, cur = t.get(key);
        if (!cur || metric < cur.metric) t.set(key, { metric, hops: toB.hops.slice(), area: a, net: s.net, prefix: s.prefix, type: 'inter' });
        else if (metric === cur.metric) for (const h of toB.hops) if (!cur.hops.some(y => y.iface === h.iface && y.via === h.via)) cur.hops.push(h);
      }
    }
  }
  // Ce qu'un ABR annonce dans l'aire 0 : ses réseaux intra-aire des autres aires.
  const toBackbone = B => new Map([...intra.get(B)].filter(([, v]) => v.area !== 0));
  const full = new Map(); // routeur → table complète
  // 1. Routeurs de l'aire 0 (ABR compris) : intra + résumés des ABR dans l'aire 0 (un ABR n'examine que ceux-là, § 16.2).
  for (const r of on) {
    if (!areas.get(r).has(0)) continue;
    const t = new Map(intra.get(r)); inter(r, 0, t, B => toBackbone(B)); full.set(r, t);
  }
  // 2. Autres aires : ce que chaque ABR joint par ailleurs (sa table complète, hors l'aire où il annonce).
  for (const r of on) {
    if (full.has(r)) continue;
    const t = new Map(intra.get(r));
    for (const a of areas.get(r)) inter(r, a, t, (B, area) => new Map([...(full.get(B) || new Map())].filter(([, v]) => v.area !== area)));
    full.set(r, t);
  }
  const ad = NET.ADMIN_DIST.v.ospf;
  for (const [r, t] of full) {
    const mine = new Set(st.ifaces.filter(f => f.node === r && f.ip && f.up !== false).map(f => pfx(netOf(f.ip, f.prefix), f.prefix)));
    const list = [];
    for (const [key, v] of t) {
      if (mine.has(key) || !v.hops.length || v.hops.every(h => !h.via)) continue;
      const paths = v.hops.filter(h => h.via).sort((x, y) => ipCmp(x.via, y.via) || (x.iface.port < y.iface.port ? -1 : 1));
      list.push({ net: v.net >>> 0, prefix: v.prefix, iface: paths[0].iface, via: paths[0].via, paths: paths.map(h => ({ iface: h.iface, via: h.via })), metric: v.metric, kind: 'ospf', ad, type: v.type || 'intra', area: v.area });
    }
    routes.set(r, list);
  }
  // Aires sans ABR relié à l'aire 0 (hors aire 0).
  const allAreas = new Set([...areas.values()].flatMap(s => [...s]));
  const orphan = [...allAreas].filter(a => a !== 0 && allAreas.has(0) && ![...abr].some(B => areas.get(B).has(a)));
  return { on, rid, areas, abr, ifs, adj, segs, routes, orphan, noBackbone, noDr };
}
