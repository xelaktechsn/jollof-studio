// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outils de l'IA pour la conception réseau professionnelle (partie sim) : base des VLAN, ports (accès, trunk), agrégats,
// Spanning Tree, interfaces de niveau 3, routes, étendues DHCP, listes d'accès, traduction d'adresses, DNS, traceroute.
// Descriptions en anglais (lues par l'IA).
// h : { netWs() → plan de travail (data(), commit(), lan(), …), netNode, netDev, netPort, netName, fail, norm }.
// Les modules du réseau se chargent à la demande (import() dans run) : rien ici n'alourdit le démarrage.

/** « p1-p6,p24 » ou ['p1', 'p2'] → liste de ports. */
function portList(spec) {
  const out = [];
  for (const t of (Array.isArray(spec) ? spec : String(spec ?? '').split(',')).map(x => String(x).trim()).filter(Boolean)) {
    const m = /^([a-z]+)(\d+)-(?:[a-z]+)?(\d+)$/i.exec(t);
    if (m) for (let i = +m[2]; i <= +m[3] && out.length < 200; i++) out.push(m[1] + i); else out.push(t);
  }
  return out;
}

export function tools(h) {
  const { netWs, netDev, netNode, netName, fail } = h;
  /** Équipement nettoyé après une modification (mêmes règles qu'un fichier) ; rend ses réglages propres. */
  async function reclean(d) {
    const { cleanNet } = await import('../net/clean.js');
    const c = cleanNet({ devices: [d], cables: [] }).devices[0]; if (!c) fail('invalid settings');
    d.p = c.p; return d.p;
  }
  const need = (d, types, what) => { if (!types.includes(d.type)) fail(`${d.name} (${d.type}) has no ${what}: use ${types.join(' or ')}`); };
  /** État de niveau 2 et 3 d'un équipement administrable, en anglais. */
  async function status(W, d) {
    const lan = W.lan(), { portCfg } = await import('../net/vlan.js'), { portsOf } = await import('../net/devices.js');
    const st = lan.stp(d.id), lags = lan.lags(d.id);
    const ports = portsOf(d).filter(p => !p.passive).map(p => {
      const l = lan.port(d.id, p.id), c = portCfg(d, p.id), r = lan.l2port(d.id, p.id);
      return { port: p.id, link: l ? (l.up ? `${l.speed} Mb/s` : `down (${l.why})`) : 'free', peer: l && l.peer ? `${netName(W, l.peer.n)}.${l.peer.p}` : null, mode: c.mode, vlan: c.mode === 'access' ? c.vlan : undefined, voice: c.voice || undefined, native: c.mode === 'trunk' ? c.native : undefined, allowed: c.mode === 'trunk' ? c.allowed : undefined, lag: c.lag || undefined, stp_role: r.role || undefined, forwarding: r.fwd, blocked_vlans: r.blocked.length ? r.blocked : undefined, shut: c.shut || undefined };
    }).filter(p => p.link !== 'free' || p.mode !== 'access' || p.vlan !== 1);
    return {
      device: d.name, type: d.type,
      stp: st ? { mode: d.p.stp.mode, root: netName(W, st.root), is_root: st.isRoot, priority: st.prio, root_cost: st.cost, root_port: st.rootPort } : (d.p.stp ? { enabled: d.p.stp.on } : undefined),
      stp_per_vlan: st && d.p.stp.mode !== 'rstp' ? [...lan.stpInstances()].filter(([v, m]) => v && m.has(d.id)).map(([v, m]) => { const x = m.get(d.id); return { vlan: v, root: netName(W, x.root), is_root: x.isRoot, priority: x.prio, blocked: [...x.ports].filter(([, r]) => !r.fwd).map(([p]) => p) }; }) : undefined,
      lags: lags ? [...lags.values()].map(g => ({ id: g.id, mode: g.mode, formed: g.ok, reason: g.why, active: g.active, standby: g.standby, speed_mbps: g.speed, peer: g.peer ? netName(W, g.peer) : null })) : undefined,
      interfaces: lan.ifacesOf(d.id).filter(f => f.role !== 'host').map(f => ({ port: f.port || f.role, vlan: f.vlan || undefined, ip: f.ip ? `${f.ip}/${f.prefix}` : null, up: f.up !== false, helper: f.helper || undefined, nat: f.nat || undefined, acl_in: f.aclIn || undefined, acl_out: f.aclOut || undefined })),
      routes: lan.routes(d.id).map(r => ({ net: `${[r.net >>> 24, (r.net >>> 16) & 255, (r.net >>> 8) & 255, r.net & 255].join('.')}/${r.prefix}`, via: r.via || null, out: r.iface.port || r.iface.role, kind: r.kind })),
      ports
    };
  }
  return [
    {
      name: 'vlan_db',
      description: 'Read or edit the project VLAN database (802.1Q, ids 1–4094): action "list" (default), "set" (add or replace entries: id, name, net "10.0.10.0/24", gw, hosts) or "remove" (ids). VLANs are then used on managed switch ports (port_config), VLAN interfaces (route_interface) and router subinterfaces. Undoable.',
      inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'set', 'remove'] }, vlans: { type: 'array', items: { type: 'object' } }, ids: { type: 'array', items: { type: 'number' } } } },
      async run({ action = 'list', vlans = [], ids = [] } = {}) {
        const W = await netWs(), data = W.data(), { cleanVlans } = await import('../net/vlan.js');
        if (action === 'set') { const m = new Map((data.vlans || []).map(v => [v.id, v])); for (const v of vlans) m.set(+v.id, { ...(m.get(+v.id) || {}), ...v, id: +v.id }); data.vlans = cleanVlans([...m.values()]); W.commit(); }
        if (action === 'remove') { data.vlans = (data.vlans || []).filter(v => !ids.includes(v.id)); W.commit(); }
        return { vlans: data.vlans || [] };
      }
    },
    {
      name: 'vlan_status',
      description: 'Layer 2/3 state of a managed device (switch24, switch48, l3switch, routerpro): per-port mode, access VLAN, trunk native/allowed VLANs, aggregate, Spanning Tree role (root, designated, alternate, backup) and forwarding state; Spanning Tree root and priority; aggregates (formed or why not); layer 3 interfaces and routing table.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' } }, required: ['device'] },
      annotations: { readOnlyHint: true },
      async run({ device }) { const W = await netWs(); return status(W, netDev(W, device)); }
    },
    {
      name: 'port_config',
      description: 'Configure ports of a managed switch (switch24: p1–p24 RJ45 PoE+, x1–x4 SFP+; switch48: p1–p48, x1–x4; l3switch: x1–x24 SFP+, p1–p4 10GBASE-T). ports: "p1-p12,p24" or a list. Settings: mode "access"|"trunk", vlan (access VLAN), voice (voice VLAN of an access port: an IP phone on it joins that VLAN; 0 = none), native (trunk native VLAN, untagged), allowed ("all", "none" or "10,20,30-40"), lag ("Po1" or "" to leave), cost (Spanning Tree port cost, 0 = by speed), edge (edge port / PortFast), shut (administratively down). Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, ports: {}, mode: { type: 'string', enum: ['access', 'trunk'] }, vlan: { type: 'number' }, voice: { type: 'number' }, native: { type: 'number' }, allowed: { type: 'string' }, lag: { type: 'string' }, cost: { type: 'number' }, edge: { type: 'boolean' }, shut: { type: 'boolean' } }, required: ['device', 'ports'] },
      async run(a) {
        const W = await netWs(), d = netDev(W, a.device); need(d, ['switch24', 'switch48', 'l3switch'], 'configurable switch ports');
        const { portsOf } = await import('../net/devices.js'), ids = portsOf(d).map(p => p.id), list = portList(a.ports);
        const bad = list.filter(p => !ids.includes(p)); if (bad.length) fail(`${d.name} has no port ${bad.join(', ')}. Ports: ${ids.join(', ')}`);
        if (a.lag && !(d.p.lags || []).some(g => g.id.toLowerCase() === String(a.lag).toLowerCase())) fail(`no aggregate ${a.lag} on ${d.name}: create it with lag_set first`);
        d.p.ports = d.p.ports || {};
        for (const p of list) { const c = { ...(d.p.ports[p] || {}) }; for (const k of ['mode', 'vlan', 'voice', 'native', 'allowed', 'lag', 'cost', 'edge', 'shut']) if (a[k] !== undefined) c[k] = a[k]; d.p.ports[p] = c; }
        await reclean(d); W.commit();
        return status(W, d);
      }
    },
    {
      name: 'lag_set',
      description: 'Create, change or remove a link aggregate (EtherChannel / 802.3ad LACP) on a managed switch: id "Po1"…"Po64", mode "active" | "passive" (LACP) or "on" (static), ports to put in it ("x1-x2"). Both ends must use compatible modes (active+active or active+passive; on+on), go to the same neighbour, at the same speed. remove: true deletes it. Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, id: { type: 'string' }, mode: { type: 'string', enum: ['active', 'passive', 'on'] }, ports: {}, remove: { type: 'boolean' } }, required: ['device', 'id'] },
      async run(a) {
        const W = await netWs(), d = netDev(W, a.device); need(d, ['switch24', 'switch48', 'l3switch'], 'link aggregates');
        const id = 'Po' + (parseInt(String(a.id).replace(/\D/g, ''), 10) || 1);
        d.p.lags = (d.p.lags || []).filter(g => g.id !== id); d.p.ports = d.p.ports || {};
        for (const [p, c] of Object.entries(d.p.ports)) if (c.lag === id) d.p.ports[p] = { ...c, lag: '' };
        if (!a.remove) { d.p.lags.push({ id, mode: a.mode || 'active' }); for (const p of portList(a.ports)) d.p.ports[p] = { ...(d.p.ports[p] || {}), lag: id }; }
        await reclean(d); W.commit();
        return status(W, d);
      }
    },
    {
      name: 'stp_set',
      description: 'Spanning Tree of a managed switch: on (true/false), mode "rpvst" (Rapid PVST+, one RSTP instance per VLAN, Catalyst default) or "rstp" (one instance for all VLANs), priority (0–61440, multiple of 4096, default 32768; lowest priority then lowest MAC becomes root — set the core switch to 4096), and per-VLAN priorities vlan_priority { "10": 4096, "20": 8192 } (Rapid PVST+: load-share trunks by making different switches root of different VLANs). Returns the resulting root, roles and blocked ports. Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, on: { type: 'boolean' }, mode: { type: 'string', enum: ['rpvst', 'rstp'] }, priority: { type: 'number' }, vlan_priority: { type: 'object' } }, required: ['device'] },
      async run({ device, on, mode, priority, vlan_priority: vp }) {
        const W = await netWs(), d = netDev(W, device); need(d, ['switch24', 'switch48', 'l3switch'], 'Spanning Tree');
        d.p.stp = { ...(d.p.stp || {}), ...(on !== undefined ? { on } : {}), ...(mode ? { mode } : {}), ...(priority !== undefined ? { prio: priority } : {}), ...(vp ? { vlans: { ...((d.p.stp || {}).vlans || {}), ...vp } } : {}) };
        await reclean(d); W.commit();
        return status(W, d);
      }
    },
    {
      name: 'route_interface',
      description: 'Add, change or remove a layer 3 interface. l3switch: VLAN interface (SVI) given by vlan. routerpro: interface on port ge0–ge3 or sfp0, vlan 0 for the plain interface or 1–4094 for an 802.1Q subinterface (router-on-a-stick). Fields: ip, prefix, mode ("static" or "dhcp", routerpro), helper (DHCP relay / ip helper-address: DHCP server address), option82 (relay adds the RFC 3046 relay agent information: circuit = this interface), nat ("inside" | "outside" | "", routerpro), acl_in, acl_out (names of ACLs from acl_set). remove: true deletes it. Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, port: { type: 'string' }, vlan: { type: 'number' }, ip: { type: 'string' }, prefix: {}, mode: { type: 'string', enum: ['static', 'dhcp'] }, helper: { type: 'string' }, option82: { type: 'boolean' }, nat: { type: 'string', enum: ['inside', 'outside', ''] }, acl_in: { type: 'string' }, acl_out: { type: 'string' }, remove: { type: 'boolean' } }, required: ['device'] },
      async run(a) {
        const W = await netWs(), d = netDev(W, a.device); need(d, ['l3switch', 'routerpro'], 'layer 3 interfaces');
        const set = o => { for (const [k, f] of [['ip', 'ip'], ['prefix', 'prefix'], ['mode', 'mode'], ['helper', 'helper'], ['option82', 'o82'], ['nat', 'nat'], ['acl_in', 'aclIn'], ['acl_out', 'aclOut']]) if (a[k] !== undefined) o[f] = a[k]; return o; };
        if (d.type === 'l3switch') {
          if (!a.vlan) fail('vlan is required for a VLAN interface');
          const rest = (d.p.svis || []).filter(s => s.vlan !== +a.vlan), cur = (d.p.svis || []).find(s => s.vlan === +a.vlan) || { vlan: +a.vlan, prefix: 24 };
          d.p.svis = a.remove ? rest : [...rest, set({ ...cur })];
        } else {
          if (!a.port) fail('port is required (ge0–ge3, sfp0)');
          const v = +a.vlan || 0, rest = (d.p.ifs || []).filter(f => !(f.port === a.port && f.vlan === v)), cur = (d.p.ifs || []).find(f => f.port === a.port && f.vlan === v) || { port: a.port, vlan: v, prefix: 24, mode: 'static' };
          d.p.ifs = a.remove ? rest : [...rest, set({ ...cur })];
        }
        await reclean(d); W.commit();
        return status(W, d);
      }
    },
    {
      name: 'route_add',
      description: 'Add a static route on a routerpro or l3switch: net "172.16.0.0/16" (0.0.0.0/0 = default route) via next-hop address, which must be on a network connected to the router. Longest prefix wins. Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, net: { type: 'string' }, via: { type: 'string' } }, required: ['device', 'net', 'via'] },
      async run({ device, net, via }) {
        const W = await netWs(), d = netDev(W, device); need(d, ['l3switch', 'routerpro'], 'routes');
        d.p.routes = [...(d.p.routes || []), { net, via }]; await reclean(d); W.commit();
        const st = await status(W, d), bad = W.lan().routes(d.id).bad || [];
        return { ...st, unusable_routes: bad.map(r => `${r.net} via ${r.via}: next hop on no connected network`) };
      }
    },
    {
      name: 'route_remove',
      description: 'Remove static routes of a routerpro or l3switch matching net (and via if given). Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, net: { type: 'string' }, via: { type: 'string' } }, required: ['device', 'net'] },
      async run({ device, net, via }) {
        const W = await netWs(), d = netDev(W, device); need(d, ['l3switch', 'routerpro'], 'routes');
        const before = (d.p.routes || []).length;
        d.p.routes = (d.p.routes || []).filter(r => !(r.net === net && (!via || r.via === via))); W.commit();
        return { removed: before - d.p.routes.length, ...(await status(W, d)) };
      }
    },
    {
      name: 'dhcp_scope',
      description: 'DHCP scopes of a routerpro, l3switch or server: action "set" (add or replace the scope of net: from, to, gw, dns, on) or "remove". The server picks the scope containing the address of the interface that hears the request, or the relay address (giaddr) when a VLAN interface relays to it (route_interface helper). Returns leases and full scopes. Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, action: { type: 'string', enum: ['set', 'remove'] }, net: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, gw: { type: 'string' }, dns: { type: 'string' }, on: { type: 'boolean' } }, required: ['device', 'net'] },
      async run(a) {
        const W = await netWs(), d = netDev(W, a.device); need(d, ['routerpro', 'l3switch', 'server'], 'DHCP scopes');
        const { parseNet } = await import('../net/vlan.js'), n = parseNet(a.net); if (!n) fail('net must look like 10.0.10.0/24');
        const rest = (d.p.dhcp || []).filter(s => s.net !== n.text);
        d.p.dhcp = a.action === 'remove' ? rest : [...rest, { net: n.text, from: a.from || '', to: a.to || '', gw: a.gw || '', dns: a.dns || '', on: a.on !== false }];
        await reclean(d); W.commit();
        const lan = W.lan();
        return { scopes: d.p.dhcp, leases: lan.state().ifaces.filter(f => f.server === d.id).map(f => ({ device: netName(W, f.node), ip: f.ip, relay: f.relay ? netName(W, f.relay) : null })), full: lan.full().filter(e => e.node === d.id) };
      }
    },
    {
      name: 'acl_set',
      description: 'Define (or remove) a named access list on a routerpro or l3switch. rules in order, first match wins, implicit deny at the end of a non-empty list: { act "permit"|"deny", proto "any"|"icmp"|"tcp"|"udp", src "any"|"10.0.20.0/24"|host IP, dst, port (TCP/UDP destination port, 0 = any), sport (source port), est (TCP "established": return segments with ACK/RST) }. Filtering is stateless like a real router ACL: replies are checked too, so an inbound list must permit them (e.g. permit tcp any any est, or sport 80). Apply it with route_interface acl_in / acl_out. Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, name: { type: 'string' }, rules: { type: 'array', items: { type: 'object' } }, remove: { type: 'boolean' } }, required: ['device', 'name'] },
      async run({ device, name, rules = [], remove }) {
        const W = await netWs(), d = netDev(W, device); need(d, ['l3switch', 'routerpro'], 'access lists');
        const rest = (d.p.acls || []).filter(x => x.name !== name);
        d.p.acls = remove ? rest : [...rest, { name, rules }]; await reclean(d); W.commit();
        return { acls: d.p.acls };
      }
    },
    {
      name: 'nat_set',
      description: 'Address translation of a routerpro: interface roles (inside / outside, list of { port, vlan?, nat }) for masquerade (inside sources leave with the outside address, RFC 3022) and port forwards (forwards: [{ proto "tcp"|"udp", port (on the outside address), to (inside server IP), toPort }], replaces the list). Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, interfaces: { type: 'array', items: { type: 'object' } }, forwards: { type: 'array', items: { type: 'object' } } }, required: ['device'] },
      async run({ device, interfaces, forwards }) {
        const W = await netWs(), d = netDev(W, device); need(d, ['routerpro'], 'address translation');
        for (const x of interfaces || []) { const f = (d.p.ifs || []).find(i => i.port === x.port && i.vlan === (+x.vlan || 0)); if (!f) fail(`no interface ${x.port}${x.vlan ? '.' + x.vlan : ''} on ${d.name}`); f.nat = x.nat || ''; }
        if (forwards) d.p.fwd = forwards;
        await reclean(d); W.commit();
        return { interfaces: d.p.ifs.map(f => ({ port: f.port, vlan: f.vlan, nat: f.nat })), forwards: d.p.fwd };
      }
    },
    {
      name: 'dns_record',
      description: 'DNS server of a routerpro or server: on (serve DNS on UDP 53), add a manual A record (name, ip) or remove one (remove: true). Device names of the plan resolve automatically. Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, on: { type: 'boolean' }, name: { type: 'string' }, ip: { type: 'string' }, remove: { type: 'boolean' } }, required: ['device'] },
      async run({ device, on, name, ip, remove }) {
        const W = await netWs(), d = netDev(W, device); need(d, ['routerpro', 'server'], 'a DNS server');
        const D = d.p.dns || { on: true, records: [] }; if (on !== undefined) D.on = on;
        if (name) { const k = String(name).toLowerCase(); D.records = D.records.filter(r => r.name !== k); if (!remove) D.records.push({ name: k, ip }); }
        d.p.dns = D; await reclean(d); W.commit();
        return { dns: d.p.dns, resolves: name && !remove ? W.lan().resolve(name) : undefined };
      }
    },
    {
      name: 'route_ospf',
      description: 'OSPF (single area) of a routerpro or l3switch: on, router_id (else the highest interface address), reference_mbps (default 100: cost = reference / link speed, at least 1), originate_default (advertise its default route), networks [{ net "10.0.0.0/8", area 0 }] ("network … area": an interface joins OSPF when the first matching statement covers its address), interfaces { "ge1" | "ge1.10" | "vlan10": { cost, hello (10), dead (40), passive } }. Neighbours need the same subnet/mask, area and hello/dead timers, and different router IDs. Returns neighbours (up or why not) and OSPF routes (administrative distance 110). Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, on: { type: 'boolean' }, router_id: { type: 'string' }, reference_mbps: { type: 'number' }, originate_default: { type: 'boolean' }, networks: { type: 'array', items: { type: 'object' } }, interfaces: { type: 'object' } }, required: ['device'] },
      async run(a) {
        const W = await netWs(), d = netDev(W, a.device); need(d, ['l3switch', 'routerpro'], 'OSPF');
        const O = { ...(d.p.ospf || {}) };
        if (a.on !== undefined) O.on = a.on; if (a.router_id !== undefined) O.rid = a.router_id; if (a.reference_mbps) O.ref = a.reference_mbps;
        if (a.originate_default !== undefined) O.originate = a.originate_default; if (a.networks) O.nets = a.networks;
        if (a.interfaces) O.ifs = { ...(O.ifs || {}), ...a.interfaces };
        d.p.ospf = O; await reclean(d); W.commit();
        const o = W.lan().ospf(), mine = o.adj.filter(e => e.a === d.id || e.b === d.id);
        return { ospf: d.p.ospf, router_id: o.rid.get(d.id) || null, neighbours: mine.map(e => { const me = e.a === d.id; return { interface: (me ? e.fa : e.fb).name, neighbour: netName(W, me ? e.b : e.a), up: e.up, reason: e.why }; }), routes: (o.routes.get(d.id) || []).map(r => ({ net: `${[r.net >>> 24, (r.net >>> 16) & 255, (r.net >>> 8) & 255, r.net & 255].join('.')}/${r.prefix}`, via: r.via, metric: r.metric })) };
      }
    },
    {
      name: 'net_trace',
      description: 'Traceroute from a device (name) to an address or device name: each router on the way answers from its incoming interface (TTL exceeded), then the destination; on failure, the hop where it stops and why (no route, access list, NAT, VLAN not carried, loop…). Honours VLANs, Spanning Tree blocking, routes, ACLs and NAT.',
      inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      annotations: { readOnlyHint: true },
      async run({ from, to }) {
        const W = await netWs(), n = netNode(W, from), r = W.lan().trace(n.id, to), { whyText } = await import('../net/labcheck.js');
        return { ok: r.ok, destination: r.ip || null, reason: r.ok ? null : whyText(r.why), hops: r.hops.map(x => ({ hop: x.n, device: x.node ? netName(W, x.node) : '*', ip: x.ip || '*', answered: x.ok, reason: x.why ? whyText(x.why) : undefined })) };
      }
    }
  ];
}
