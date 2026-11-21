// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Couche liaison du réseau simulé (appelée par lan.js à chaque recalcul) : segments, agrégats de liens (LACP), Spanning
// Tree rapide (RSTP), VLAN 802.1Q, domaines de diffusion, boucles, chemins de niveau 2.
//
// Modèle, dit simplifié à l'écran quand il l'est :
//   - Segment : ce que relient les équipements « transparents » (switchs non administrables, points d'accès et leurs
//     clients Wi-Fi, ports LAN d'une box, convertisseurs de média). Ils passent toutes les trames telles quelles, avec ou
//     sans étiquette 802.1Q (la plupart des petits switchs le font ; une trame étiquetée traverse donc un switch non
//     administrable), et les BPDU du Spanning Tree aussi. Une boucle faite seulement de ces équipements : tempête.
//   - Ports « d'attache » sur un segment : postes (trames sans étiquette seulement), interfaces et sous-interfaces d'un
//     routeur (sans étiquette, ou étiquetées de leur VLAN), WAN d'une box, ports des switchs administrables (accès : son
//     VLAN sans étiquette ; trunk : VLAN natif sans étiquette, VLAN autorisés étiquetés).
//   - Domaine de diffusion : (segment, étiquette) relié aux (switch, VLAN). Deux VLAN natifs différents de part et
//     d'autre d'un trunk se rejoignent (comme en vrai) ; le vérificateur le signale.
//   - Spanning Tree : Rapid PVST+ (une instance RSTP 802.1w par VLAN, priorité par VLAN, défaut des Catalyst), ou une
//     seule instance pour tous les VLAN (mode 'rstp'). Élection de la racine (priorité puis MAC), coût de chemin selon la
//     vitesse (table « longue »), port racine, port désigné, port alternatif ou de secours bloqué. Les segments faits de
//     switchs non administrables sont des « LAN partagés » pour le Spanning Tree. Un switch administrable au Spanning Tree
//     coupé n'envoie ni ne relaie de BPDU (choix du modèle : selon les marques, il les relaie ou non) ; une boucle qui
//     passe par lui n'est pas coupée.
//   - Agrégat : les ports d'un agrégat formé ne font qu'un lien logique (débit additionné) pour le Spanning Tree et les
//     VLAN. LACP actif/passif ou statique (« on ») ; passif + passif, on + LACP, vers deux voisins différents, ou des
//     vitesses différentes : pas d'agrégat (ports isolés, l'un des deux côtés seul fait un agrégat statique).
import { portCfg as portCfg0, parseVlanList, allowedHas, MANAGED } from './vlan.js';

const key = (n, p) => n + '|' + p;
/** Coût Spanning Tree d'un lien de speed Mb/s : table « longue » (2·10⁷ / vitesse, au moins 1). */
export function stpCost(speed, table) {
  if (table && table[speed]) return table[speed];
  return Math.max(1, Math.round(20000000 / Math.max(1, speed || 1)));
}

/**
 * x : { all, byId, links (Map 'n|p' → lien), wifiAssoc (Map client → point d'accès), pmap(n) → Map(port id → port),
 * spec(n), vlans (Set des VLAN connus), mac(id), lim: { cost, lacp } }.
 * Rend { find, storm, segOf, stp, lags, member, fwd(n, p), vlanUp, adj, linked, attach, vertices }.
 */
export function computeL2(x) {
  const { all, byId, links, wifiAssoc, pmap, spec, vlans, mac, lim } = x;
  const kindOf = n => {
    const s = spec(n); if (!s) return 'none';
    if (s.managed) return 'managed';
    if (s.role === 'switch' || s.role === 'ap' || s.role === 'router') return 'clear';
    if (s.role === 'l3') return 'l3';
    if (s.role === 'host') return 'host';
    return 'none';
  };
  const kinds = new Map(all.map(n => [n.id, kindOf(n)]));
  // Réglages des ports, lus une fois par recalcul ; VLAN portés par port, aussi.
  const CFG = new Map(), portCfg = (d, p) => { const k = d.id + '|' + p; let c = CFG.get(k); if (!c) { c = portCfg0(d, p); CFG.set(k, c); } return c; };
  const MAC = new Map(), macOf = id => { let m = MAC.get(id); if (!m) { m = mac(id); MAC.set(id, m); } return m; };
  // Un bout de lien est-il « transparent » (dans le segment) ? WAN d'une box : non (point d'attache).
  const clear = (n, p) => kinds.get(n) === 'clear' && !(byId.get(n).type === 'router' && p === 'wan');

  /* ---------- Agrégats ---------- */
  const lags = new Map(), member = new Map(); // nœud → Map(id → état) ; 'n|p' → { lag, state, rep }
  for (const n of all) {
    if (kinds.get(n.id) !== 'managed') continue;
    const P = n.p || {}, groups = P.lags || []; if (!groups.length) continue;
    const m = new Map(); lags.set(n.id, m);
    for (const g of groups) {
      const ports = [...pmap(n).keys()].filter(pid => portCfg(n, pid).lag === g.id);
      const up = ports.filter(pid => { const l = links.get(key(n.id, pid)); return l && l.up && l.peer; });
      const st = { id: g.id, mode: g.mode, members: ports, up, active: [], standby: [], ok: false, why: up.length ? null : 'down', peer: null, speed: 0, rep: null };
      m.set(g.id, st);
      if (!up.length) continue;
      // Voisin le plus fréquent ; vitesse la plus fréquente.
      const count = f => { const c = new Map(); for (const pid of up) { const k = f(pid); c.set(k, (c.get(k) || 0) + 1); } return [...c].sort((a, b) => b[1] - a[1])[0][0]; };
      const peerN = count(pid => links.get(key(n.id, pid)).peer.n), sp = count(pid => links.get(key(n.id, pid)).speed);
      st.peer = peerN;
      const bad = new Map();
      for (const pid of up) {
        const l = links.get(key(n.id, pid));
        if (l.peer.n !== peerN) bad.set(pid, 'peers'); else if (l.speed !== sp) bad.set(pid, 'speed');
      }
      // Côté voisin : ses ports en face doivent être dans un même agrégat compatible.
      const pd = byId.get(peerN), good = up.filter(pid => !bad.has(pid));
      const peerCfg = good.map(pid => { const l = links.get(key(n.id, pid)); return pd && kinds.get(peerN) === 'managed' ? portCfg(pd, l.peer.p).lag : ''; });
      const peerLag = peerCfg[0] || '', peerMode = peerLag ? (((pd.p || {}).lags || []).find(z => z.id === peerLag) || {}).mode : null;
      let why = null;
      if (peerCfg.some(c => c !== peerLag)) why = 'peerlag';
      else if (!peerLag) why = 'nopeer';
      else if (g.mode === 'on' ? peerMode !== 'on' : peerMode === 'on') why = 'mode';
      else if (g.mode === 'passive' && peerMode === 'passive') why = 'passive';
      if ([...bad.values()].includes('peers')) why = why || 'peers';
      for (const [pid, w] of bad) member.set(key(n.id, pid), { lag: g.id, state: 'suspended', why: w });
      st.why = why || (bad.size ? [...bad.values()][0] : null);
      if (why && g.mode !== 'on') { for (const pid of good) member.set(key(n.id, pid), { lag: g.id, state: 'individual', why }); continue; }
      // Agrégat formé (ou statique de ce côté) : 8 ports actifs au plus, les autres en attente.
      st.ok = !why; st.active = good.slice(0, lim.lacp); st.standby = good.slice(lim.lacp);
      st.speed = st.active.reduce((a, pid) => a + links.get(key(n.id, pid)).speed, 0); st.rep = st.active[0] || null;
      for (const pid of st.active) member.set(key(n.id, pid), { lag: g.id, state: 'bundled', rep: pid === st.rep, why });
      for (const pid of st.standby) member.set(key(n.id, pid), { lag: g.id, state: 'standby', why: null });
    }
  }
  /** Le port porte-t-il le trafic de niveau 2 en son nom propre (membre représentant d'un agrégat, ou port seul) ? */
  const carrier = (n, p) => { const m = member.get(key(n, p)); return !m || m.state === 'individual' || (m.state === 'bundled' && m.rep); };

  /* ---------- Segments ---------- */
  const sp = new Map(), sfind = v => { if (!sp.has(v)) sp.set(v, v); let r = v; while (sp.get(r) !== r) r = sp.get(r); let c = v; while (sp.get(c) !== r) { const nx = sp.get(c); sp.set(c, r); c = nx; } return r; };
  const end = (n, p) => (clear(n, p) ? 'T:' + n : 'A:' + key(n, p));
  const physical = []; // { a: {n,p}, b: {n,p}, link }
  const segLoop = new Set();
  // Serveur à deux cartes : seule la première carte reliée sert (l'autre attend).
  const hostPort = new Map();
  for (const n of all) {
    if (kinds.get(n.id) !== 'host') continue;
    for (const pid of pmap(n).keys()) { const l = links.get(key(n.id, pid)); if (l && l.up && l.peer) { hostPort.set(n.id, pid); break; } }
  }
  const usable = (n, p) => {
    const k = kinds.get(n); if (k === 'none') return false;
    if (k === 'host') return hostPort.get(n) === p;
    if (k === 'managed') return carrier(n, p);
    return true;
  };
  for (const [k, l] of links) {
    if (!l.up || !l.peer) continue;
    const i = k.indexOf('|'), n = k.slice(0, i), p = k.slice(i + 1); if (n > l.peer.n || (n === l.peer.n && p > l.peer.p)) continue;
    if (!usable(n, p) || !usable(l.peer.n, l.peer.p)) continue;
    physical.push({ a: { n, p }, b: { n: l.peer.n, p: l.peer.p }, link: l });
  }
  for (const [nid, apId] of wifiAssoc) if (byId.has(nid) && byId.has(apId)) physical.push({ a: { n: nid, p: 'wifi' }, b: { n: apId, p: 'wifi' }, link: { up: true, speed: 0, wifi: true, notes: [] } });
  for (const e of physical) {
    const a = sfind(end(e.a.n, e.a.p)), b = sfind(end(e.b.n, e.b.p));
    if (a === b) segLoop.add(a); else sp.set(a, b);
  }
  for (const n of all) if (kinds.get(n.id) === 'clear') sfind('T:' + n.id);
  const segOf = new Map(); // 'n|p' → segment (racine)
  for (const e of physical) for (const s of [e.a, e.b]) segOf.set(key(s.n, s.p), sfind(end(s.n, s.p)));
  const loopSegs = new Set([...segLoop].map(sfind));

  /* ---------- Spanning Tree ---------- */
  // Rapid PVST+ (défaut des Catalyst) : une instance RSTP par VLAN, priorité par VLAN ; le « LAN » d'une instance est le
  // couple (segment, étiquette) qui porte ce VLAN. Mode 'rstp' sur tous les switchs : une seule instance pour tous les VLAN
  // (instance commune). Modes mélangés : un switch en 'rstp' prend part à l'instance de chaque VLAN avec sa priorité unique
  // (modèle simplifié de l'interopérabilité PVST+ / 802.1w).
  const isBridge = n => kinds.get(n.id) === 'managed' && (n.p || {}).stp && n.p.stp.on !== false;
  const bridges = all.filter(isBridge), byB = new Map(bridges.map(b => [b.id, b]));
  const single = bridges.every(b => b.p.stp.mode === 'rstp');
  const pidx = new Map(); // 'n|p' → rang du port (identifiant de port)
  /** VLAN portés par un port de switch administrable : [{ vlan, tag }] (tag 0 : sans étiquette). */
  const PV = new Map();
  const portVlans = (d, p) => { const k = d.id + '|' + p; let v = PV.get(k); if (!v) { v = portVlans0(d, p); PV.set(k, v); } return v; };
  const portVlans0 = (d, p) => {
    const c = portCfg(d, p);
    if (c.mode === 'access') return c.voice && c.voice !== c.vlan ? [{ vlan: c.vlan, tag: 0 }, { vlan: c.voice, tag: c.voice }] : [{ vlan: c.vlan, tag: 0 }];
    const out = [{ vlan: c.native, tag: 0 }], al = parseVlanList(c.allowed);
    for (const v of vlans) if (v !== c.native && allowedHas(al, v)) out.push({ vlan: v, tag: v });
    return out;
  };
  const insts = new Map(); // instance (0 : instance unique, sinon le VLAN) → [{ b, pid, seg, cost, idx, edge }]
  for (const b of bridges) {
    [...pmap(b).keys()].forEach((pid, i) => pidx.set(key(b.id, pid), i));
    for (const pid of pmap(b).keys()) {
      const k = key(b.id, pid), seg = segOf.get(k); if (!seg) continue;
      const m = member.get(k), l = links.get(k), cfg = portCfg(b, pid);
      const speed = m && m.state === 'bundled' ? lags.get(b.id).get(m.lag).speed : l.speed;
      const base = { b: b.id, pid, cost: cfg.cost || stpCost(speed, lim.cost), idx: pidx.get(k), edge: cfg.edge };
      if (single) { if (!insts.has(0)) insts.set(0, []); insts.get(0).push({ ...base, seg }); continue; }
      for (const { vlan, tag } of portVlans(b, pid)) { if (!insts.has(vlan)) insts.set(vlan, []); insts.get(vlan).push({ ...base, seg: seg + '#' + tag }); }
    }
  }
  /** Priorité d'un pont dans une instance (Rapid PVST+ : priorité du VLAN, sinon celle du pont). */
  const prioOf = (b, inst) => { const S = byB.get(b).p.stp; return inst && S.mode !== 'rstp' && S.vlans && S.vlans[inst] != null ? S.vlans[inst] : S.prio | 0; };
  /** Une instance RSTP : racine (priorité puis MAC), coûts, port racine, ports désignés, alternatifs, de secours. */
  function runStp(inst, entries) {
    const BID = new Map(), bid = b => { let x = BID.get(b); if (!x) { x = [prioOf(b, inst), macOf(b)]; BID.set(b, x); } return x; };
    const cmpBid = (a, b) => { if (a === b) return 0; const x = bid(a), y = bid(b); return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0); };
    const bports = new Map(), segPorts = new Map();
    for (const e of entries) {
      if (!bports.has(e.b)) bports.set(e.b, []); bports.get(e.b).push(e);
      if (!segPorts.has(e.seg)) segPorts.set(e.seg, []); segPorts.get(e.seg).push(e);
    }
    const best = new Map(), group = new Map();
    for (const b0 of bports.keys()) {
      if (group.has(b0)) continue;
      const comp = [], q = [b0]; group.set(b0, b0);
      while (q.length) { const x = q.pop(); comp.push(x); for (const e of bports.get(x)) for (const o of segPorts.get(e.seg)) if (!group.has(o.b)) { group.set(o.b, b0); q.push(o.b); } }
      const root = comp.slice().sort(cmpBid)[0];
      for (const c of comp) group.set(c, root);
      const done = new Set(), cand = new Map([[root, { cost: 0, root, port: null }]]);
      const better = (a, c) => a.cost - c.cost || cmpBid(a.dbid, c.dbid) || a.dport - c.dport || a.own - c.own;
      while (cand.size) {
        let pick = null;
        for (const [id, v] of cand) if (!pick || better(v, pick[1]) < 0) pick = [id, v];
        cand.delete(pick[0]); done.add(pick[0]); best.set(pick[0], pick[1]);
        const X = pick[0], dx = pick[1].cost;
        for (const ex of bports.get(X)) for (const eb of segPorts.get(ex.seg)) {
          if (eb.b === X || done.has(eb.b)) continue;
          const v = { cost: dx + eb.cost, dbid: X, dport: ex.idx, own: eb.idx, port: eb.pid, root };
          const cur = cand.get(eb.b); if (!cur || better(v, cur) < 0) cand.set(eb.b, v);
        }
      }
    }
    const desig = new Map();
    for (const [seg, ps] of segPorts) {
      let d = null;
      for (const e of ps) {
        const be = best.get(e.b); if (!be) continue;
        if (!d || be.cost - best.get(d.b).cost < 0 || (be.cost === best.get(d.b).cost && (cmpBid(e.b, d.b) < 0 || (e.b === d.b && e.idx < d.idx)))) d = e;
      }
      desig.set(seg, d);
    }
    const out = new Map();
    for (const [b, list] of bports) {
      const be = best.get(b) || { cost: 0, root: b, port: null }, ports = new Map();
      for (const e of list) {
        const d = desig.get(e.seg);
        let role = 'designated';
        if (be.port === e.pid && be.root !== b) role = 'root';
        else if (d && d !== e) role = d.b === b ? 'backup' : 'alternate';
        ports.set(e.pid, { role, fwd: role === 'root' || role === 'designated', cost: e.cost, edge: !!e.edge && !(segPorts.get(e.seg).length > 1) });
      }
      out.set(b, { root: be.root, isRoot: be.root === b, cost: be.cost, rootPort: be.root === b ? null : be.port, ports, prio: prioOf(b, inst) + (inst || 0), mac: macOf(b), vlan: inst || null });
    }
    return out;
  }
  const stpI = new Map(); // instance → Map(pont → état)
  for (const [inst, entries] of insts) stpI.set(inst, runStp(inst, entries));
  /** VLAN principal d'un port (accès : son VLAN ; trunk : le natif). */
  const primary = (n, p) => { const c = portCfg(byId.get(n), p); return c.mode === 'access' ? c.vlan : c.native; };
  /** État Spanning Tree d'un pont pour un VLAN (instance unique : la même pour tous) ; sans VLAN : VLAN 1, sinon le plus petit. */
  function stpOf(n, v) {
    if (single) return stpI.has(0) ? stpI.get(0).get(n) || null : null;
    if (v != null) return stpI.has(v) ? stpI.get(v).get(n) || null : null;
    if (stpI.has(1) && stpI.get(1).has(n)) return stpI.get(1).get(n);
    for (const k of [...stpI.keys()].sort((a, b) => a - b)) if (stpI.get(k).has(n)) return stpI.get(k).get(n);
    return null;
  }
  const stp = new Map(); for (const b of bridges) { const s = stpOf(b.id); if (s) stp.set(b.id, s); }
  /** Le port (n, p) laisse-t-il passer le VLAN v (Spanning Tree, agrégat) ? Sans v : son VLAN principal. */
  function fwd(n, p, v) {
    const m = member.get(key(n, p));
    if (m && (m.state === 'suspended' || m.state === 'standby')) return false;
    let pid = p;
    if (m && m.state === 'bundled' && !m.rep) { const g = lags.get(n).get(m.lag); pid = g.rep; }
    if (!byB.has(n)) return true;
    const s = stpOf(n, single ? null : v ?? primary(n, pid)); if (!s) return true;
    const r = s.ports.get(pid); return !r || r.fwd;
  }
  /** VLAN bloqués sur un port (Rapid PVST+ : un trunk peut être bloqué pour un VLAN et passant pour un autre). */
  const blocked = (n, p) => (byB.has(n) ? portVlans(byId.get(n), p).map(x => x.vlan).filter(v => !fwd(n, p, v)) : []);

  /* ---------- Domaines de diffusion ---------- */
  const parent = new Map(), find = v => { if (!parent.has(v)) parent.set(v, v); let r = v; while (parent.get(r) !== r) r = parent.get(r); let c = v; while (parent.get(c) !== r) { const nx = parent.get(c); parent.set(c, r); c = nx; } return r; };
  const union = (a, b) => { const x = find(a), y = find(b); if (x !== y) parent.set(x, y); };
  const verts = new Set(), edges = []; // sommets comptés, arêtes (pour les boucles)
  const segTags = new Map(); // segment → Set(étiquettes)
  const segV = (s, t) => { const v = 'seg:' + s + ':' + t; verts.add(v); if (!segTags.has(s)) segTags.set(s, new Set()); segTags.get(s).add(t); return v; };
  const vlanUp = new Set(); // 'switch|vlan' : au moins un port relié et passant porte ce VLAN (interface VLAN active)
  const attach = new Map(); // 'n|p' → [{ tag, v }]
  /** Sommets d'un port d'attache : [{ tag (0 : sans étiquette), v }]. */
  function sideMap(n, p) {
    const k = kinds.get(n), d = byId.get(n);
    if (k === 'host') {
      // Téléphone IP derrière un port d'accès qui a un VLAN voix : il étiquette sa voix dans ce VLAN (appris par CDP,
      // « switchport voice vlan ») ; modèle simplifié : tout le téléphone est dans le VLAN voix.
      const l = d.type === 'phone' ? links.get(key(n, p)) : null, pd = l && l.peer ? byId.get(l.peer.n) : null;
      if (pd && kinds.get(pd.id) === 'managed') { const c = portCfg(pd, l.peer.p); if (c.mode === 'access' && c.voice && c.voice !== c.vlan) return [{ tag: c.voice, v: 'n:' + n }]; } // VLAN voix = VLAN d'accès : trames non étiquetées
      return [{ tag: 0, v: 'n:' + n }];
    }
    if (k === 'clear') return [{ tag: 0, v: 'wan:' + n }]; // WAN d'une box
    if (k === 'l3') return ((d.p || {}).ifs || []).filter(f => f.port === p).map(f => ({ tag: f.vlan, v: `r:${n}:${p}:${f.vlan}` }));
    if (k === 'managed') {
      return portVlans(d, p).filter(x => fwd(n, p, x.vlan)).map(x => ({ tag: x.tag, v: `m:${n}:${x.vlan}`, vlan: x.vlan }));
    }
    return [];
  }
  for (const e of physical) for (const s of [e.a, e.b]) {
    if (clear(s.n, s.p) && s.p !== 'wifi') continue;
    if (kinds.get(s.n) === 'clear' && s.p === 'wifi') continue; // point d'accès : transparent
    const k = key(s.n, s.p); if (attach.has(k)) continue;
    const seg = segOf.get(k), list = sideMap(s.n, s.p); attach.set(k, list);
    for (const x of list) {
      verts.add(x.v); union(x.v, segV(seg, x.tag)); edges.push(x.v);
      if (x.vlan != null) vlanUp.add(key(s.n, x.vlan));
    }
  }
  // Équipements transparents : leur sommet (sans étiquette) est celui de leur segment (LAN de la box : 'n:box').
  for (const n of all) {
    const k = kinds.get(n.id);
    if (k === 'clear') { const seg = sfind('T:' + n.id); union('n:' + n.id, segV(seg, 0)); if (n.type === 'router') { verts.add('wan:' + n.id); find('wan:' + n.id); } }
    else if (k === 'host') { verts.add('n:' + n.id); find('n:' + n.id); }
    else if (k === 'l3') for (const f of (n.p || {}).ifs || []) { const v = `r:${n.id}:${f.port}:${f.vlan}`; verts.add(v); find(v); }
    else if (k === 'managed') for (const s of (n.p || {}).svis || []) { const v = `m:${n.id}:${s.vlan}`; verts.add(v); find(v); }
  }
  // Boucles : un domaine où les arêtes sont au moins aussi nombreuses que les sommets a un cycle ; une boucle de switchs
  // transparents rend tout son segment (toutes étiquettes) en tempête.
  const V = new Map(), E = new Map();
  for (const v of verts) { const r = find(v); V.set(r, (V.get(r) || 0) + 1); }
  for (const v of edges) { const r = find(v); E.set(r, (E.get(r) || 0) + 1); }
  const storm = new Set();
  for (const [r, e] of E) if (e >= V.get(r)) storm.add(r);
  for (const s of loopSegs) for (const t of segTags.get(s) || [0]) storm.add(find(segV(s, t)));

  /* ---------- Chemins de niveau 2 ---------- */
  // Domaines portés par chaque lien physique : un lien interne à un segment porte toutes ses étiquettes ; un lien vers un
  // port d'attache porte les domaines de ce port.
  // Construits à la première demande d'un chemin (ping, traceroute, tables MAC) : un recalcul qui n'en demande pas s'en passe.
  const linked = new Set();
  for (const e of physical) for (const s of [e.a, e.b]) if (kinds.get(s.n) === 'host') linked.add(s.n);
  let adj0 = null;
  const adjOf = () => {
    if (adj0) return adj0;
    const adj = adj0 = new Map();
    const add = (u, w, out, inn, link, doms) => { if (!adj.has(u)) adj.set(u, []); adj.get(u).push({ to: w, out, in: inn, link, doms }); };
  for (const e of physical) {
    const doms = new Set();
    for (const s of [e.a, e.b]) {
      const at = attach.get(key(s.n, s.p));
      if (at) for (const x of at) doms.add(find(x.v));
    }
    if (!attach.has(key(e.a.n, e.a.p)) && !attach.has(key(e.b.n, e.b.p))) { const seg = segOf.get(key(e.a.n, e.a.p)); for (const t of segTags.get(seg) || [0]) doms.add(find(segV(seg, t))); doms.add(find('seg:' + seg + ':0')); }
    add(e.a.n, e.b.n, e.a, e.b, e.link, doms); add(e.b.n, e.a.n, e.b, e.a, e.link, doms);
  }
    return adj;
  };
  return { find, storm, segOf, loopSegs, stp, stpI, stpOf, single, lags, member, fwd, blocked, portVlans, vlanUp, get adj() { return adjOf(); }, linked, attach, kinds, physical, hostPort };
}

/** Nœud d'un sommet de domaine ('n:x', 'n:x#t', 'm:x:v', 'r:x:p:t', 'wan:x') ou null. */
export function nodeOfVertex(v) {
  const s = String(v || '');
  if (s.startsWith('n:')) return s.slice(2).split('#')[0];
  if (s.startsWith('wan:')) return s.slice(4);
  const parts = s.split(':');
  if (s.startsWith('m:')) return parts.slice(1, -1).join(':');
  if (s.startsWith('r:')) return parts.slice(1, -2).join(':');
  return null;
}
/**
 * Chemin de niveau 2 du nœud a au nœud b dans le domaine dom : [{ from: 'n:u', to: 'n:w', out: {n,p}, in: {n,p}, link }]
 * (largeur d'abord ; on ne traverse ni un poste ni un routeur), ou null. adj : computeL2(...).adj.
 */
export function l2route(L2, a, b, dom, byId, spec) {
  if (a === b) return [];
  const prev = new Map([[a, null]]), q = [a];
  const transit = id => { const s = spec(byId.get(id)); return s && (s.role === 'switch' || s.role === 'ap' || s.role === 'router'); };
  for (let i = 0; i < q.length; i++) {
    const u = q[i]; if (u === b) break;
    if (u !== a && !transit(u)) continue;
    for (const x of L2.adj.get(u) || []) if (!prev.has(x.to) && x.doms.has(dom)) { prev.set(x.to, { u, x }); q.push(x.to); }
  }
  if (!prev.has(b)) return null;
  const out = []; let v = b;
  while (prev.get(v)) { const { u, x } = prev.get(v); out.unshift({ from: 'n:' + u, to: 'n:' + v, out: x.out, in: x.in, link: x.link }); v = u; }
  return out;
}
export { MANAGED };
