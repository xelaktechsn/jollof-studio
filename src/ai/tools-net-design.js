// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outils de l'IA pour la conception réseau professionnelle (partie design). Descriptions en anglais (lues par l'IA).
// h : { netWs() → plan de travail (data(), commit(), lan(), …), netNode, netDev, netPort, netName, fail, norm }.
// Les modules du réseau se chargent à la demande (import() dans run) : rien ici n'alourdit le démarrage.
const lim = (a, n) => (Array.isArray(a) ? a.slice(0, n) : a);
/** Fusion profonde (objets seulement) : les réglages donnés par l'IA complètent ceux du projet. */
function merge(a, b) {
  const o = { ...(a && typeof a === 'object' ? a : {}) };
  for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? merge(o[k], v) : v;
  return o;
}
export function tools(h) {
  const mods = () => Promise.all([import('../net/dimension.js'), import('../net/docs.js')]);
  return [
    {
      name: 'design_get',
      description: 'Structured-cabling design parameters of the network project (data.design): work-area density (area m² per work area, outlets per work area, per-room-usage overrides: office, open, meeting, classroom, lab, corridor, storage, tech, other), spare ports %, oversubscription target (n:1), uplinks per access switch, patch panel size (24|48), switch size (auto|24|48), PoE classes planned for phones/APs/cameras and PoE margin %, cable category, cable box length (m) and waste %, slack at the rack (slack.tr) and at the outlet (slack.wa) in metres, rack height (U), UPS margin %, labelling scheme (preset auto|tia|campus|rack|custom and formats with tokens {b} building, {f} floor, {s} space letter, {fs} space id, {r} rack number, {u} rack unit, {p} panel letter, {n} port), unit prices and currency, labour lines, project info (client, site, author, date, rev), per-room overrides (rooms: { roomId: { tr: rackId, outlets } }) and the IPv4 plan settings (ip: { block, gw: first|last, growth % }). Defaults of 10 m² per work area and 2 outlets per work area follow TIA-569/TIA-568 as quoted by public guides.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      async run() { const W = await h.netWs(), [D, docs] = await mods(); const d = D.cleanDesign(W.data().design); return { design: d, labelFormats: docs.labelFormats({ ...W.data(), design: d }) }; }
    },
    {
      name: 'design_set',
      description: 'Change structured-cabling design parameters (same keys as design_get; objects are merged, so { "slack": { "tr": 5 } } keeps slack.wa). Values are clamped to sensible ranges. Undoable.',
      inputSchema: { type: 'object', properties: { settings: { type: 'object', description: 'Partial design object, e.g. { "area": 8, "spare": 25, "cat": "cat6a", "prices": { "outlet2": 9.5 }, "currency": "XOF", "project": { "client": "ACME" } }' } }, required: ['settings'] },
      async run({ settings }) {
        if (!settings || typeof settings !== 'object') h.fail('settings must be an object');
        const W = await h.netWs(), [D] = await mods(), data = W.data();
        data.design = D.cleanDesign(merge(D.cleanDesign(data.design), settings));
        W.commit();
        return { design: data.design };
      }
    },
    {
      name: 'design_dimension',
      description: 'Run the dimensioning assistant on the project (nothing is changed): from the rooms of the floor plans (usage + area) it derives work areas and outlets per room, the serving telecom room (nearest rack on the same floor, or a room override; floors without a rack get a "to create" space), switch ports with spare, patch panels, access switches (24/48) and stacking, uplinks and oversubscription, PoE demand vs switch budgets, rack units, UPS load, copper cable quantity (real route lengths when cables exist, otherwise an estimate flagged est: true) and boxes, backbone fibre strands. Returns totals, per-telecom-room results, per-floor results, rooms (first 300) and warnings.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      async run() {
        const W = await h.netWs(), [D, docs] = await mods(), data = W.data(), r = D.dimension(data), L = docs.labeler(data);
        return {
          totals: r.totals, cable: { total_m: r.cable.total, with_waste_m: r.cable.withWaste, boxes: r.cable.boxes, box_m: r.cable.box, category: r.cable.cat, estimated: r.trs.some(t => t.cable.est && t.outlets) }, fibre: r.fibre,
          telecom_rooms: r.trs.map(t => ({ id: L.space(t.key) || t.key, floor: t.floor, to_create: t.virtual, racks: t.racks, rooms: t.rooms.length, outlets: t.outlets, ports_with_spare: t.ports, patch_panels: `${t.panels} x ${t.panelPorts}`, switches: t.switches.map(s => ({ type: s.type, ports: s.ports, n: s.n })), uplinks: t.uplinks, oversubscription: t.oversub, oversubscription_ok: t.oversubOk, poe_w: t.poe, rack_units: t.u, racks_needed: t.racksNeeded, ups_w: t.ups.sizedW, cable: t.cable })),
          floors: r.floors, rooms: lim(r.rooms.map(x => ({ id: x.id, name: x.name, floor: x.floor, usage: x.usage, area_m2: x.area, work_areas: x.wa, outlets: x.outlets, placed: x.placed, telecom_room: L.space(x.tr) || x.tr, est_link_m: x.run })), 300), warnings: r.warnings
        };
      }
    },
    {
      name: 'design_apply',
      description: 'Generator: place everything the dimensioning asks for, in one undoable step — double outlets along the walls of each room (single ceiling outlets for planned APs and cameras), racks in telecom rooms that have none, patch panels and access switches mounted in the racks, permanent links (outlet back to panel back, automatic routing), patch cords (panel front to switch port), uplinks to a core L3 switch in the main room (fibre through fibre panels between rooms when those types exist) and base VLANs DATA 10, VOICE 20, WIFI 30, MGMT 99 (work-area ports with planned phones get the voice VLAN; APs the WIFI VLAN; when the VLANs are already addressed, the core also gets its SVIs and DHCP). Rooms that already have outlets are left untouched. Optional rooms: names or ids to limit the generation; vlans: false to skip VLANs. The same objects then appear in the logical, plan and rack views.',
      inputSchema: { type: 'object', properties: { rooms: { type: 'array', items: { type: 'string' } }, vlans: { type: 'boolean' }, preview: { type: 'boolean', description: 'true: only report what would be created' } } },
      async run({ rooms, vlans, preview }) {
        const W = await h.netWs(), [D] = await mods(), data = W.data();
        let ids;
        if (Array.isArray(rooms) && rooms.length) {
          const all = D.floorsOf(data).flatMap(x => x.f.rooms || []);
          ids = rooms.map(r => { const s = h.norm(r); const m = all.find(x => x.id === r) || all.find(x => h.norm(x.name || '') === s); if (!m) h.fail(`no room "${r}" (see design_dimension)`); return m.id; });
        }
        const opts = { rooms: ids, vlans: vlans !== false };
        if (preview) { const p = D.previewDesign(data, opts); return { preview: true, ...p }; }
        const res = D.applyDesign(data, opts);
        if (res.notes.includes('types')) h.fail('structured-cabling device types are missing in this version');
        W.commit();
        return res;
      }
    },
    {
      name: 'labels_get',
      description: 'TIA-606-style identifiers computed by the labelling scheme: telecom spaces (fs, e.g. "1A"), racks, patch panels, outlet ports (horizontal link id fs-an, e.g. "1A-B04", the same id as the panel port the permanent link lands on), plus duplicates and outlets without an id (no permanent link). Optional kind filter (space|rack|panel|outlet|cable) and limit (default 300).',
      inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['space', 'rack', 'panel', 'outlet', 'cable'] }, limit: { type: 'number' } } },
      annotations: { readOnlyHint: true },
      async run({ kind, limit }) {
        const W = await h.netWs(), [, docs] = await mods(), data = W.data();
        const rows = docs.labelTable(data).filter(r => !kind || r.kind === kind), li = docs.labelIssues(data);
        return { formats: docs.labelFormats(data), count: rows.length, labels: lim(rows, Math.max(1, Math.min(3000, limit || 300))), duplicates: li.dups.map(g => ({ label: g.label, items: g.items.map(i => ({ kind: i.kind, id: i.id })) })), outlets_without_id: li.empty.map(id => h.netName(W, id)) };
      }
    },
    {
      name: 'bom_get',
      description: 'Bill of materials from the model with the project unit prices: devices by type, RJ45 keystones of the outlets, copper cable in boxes (links per box from the average length and waste), patch cords, backbone fibre (m), fibre jumpers, SFP modules, racks, labels, then labour lines; per-line totals, group subtotals (active, passive, cable, rack, terminal, labour), grand total, currency and the keys of lines without a price (set them with design_set { prices: { key: value } }).',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      async run() { const W = await h.netWs(), [, docs] = await mods(); return docs.bom(W.data()); }
    },
    {
      name: 'schedule_get',
      description: 'Cable schedule (which: "cables": id, label, kind horizontal|cord|backbone|other, from, to, media, type/category, length m, route mode, pathways crossed) or patching schedule (which: "patching": rack, panel, port identifier, device, device port, VLAN, outlet and outlet port at the far end of the permanent link, permanent link and cord lengths). limit default 500.',
      inputSchema: { type: 'object', properties: { which: { type: 'string', enum: ['cables', 'patching'] }, limit: { type: 'number' } }, required: ['which'] },
      annotations: { readOnlyHint: true },
      async run({ which, limit }) {
        const W = await h.netWs(), [, docs] = await mods(), data = W.data(), n = Math.max(1, Math.min(6000, limit || 500));
        if (which === 'patching') {
          const rows = docs.patchingRows(data, W.lan());
          return { count: rows.length, rows: lim(rows, n) };
        }
        const rows = docs.cableSchedule(data);
        return { count: rows.length, rows: lim(rows, n) };
      }
    },
    {
      name: 'ip_plan',
      description: 'IPv4 VLSM address plan for the project VLANs: from a parent block (default the project setting, e.g. "10.10.0.0/16") and each VLAN\'s planned host count (hosts: { "10": 200, "20": 80 } sets them), keeps the networks already in place when they are aligned, large enough (hosts + growth, at least the project minimum size) and do not overlap (keep: false re-splits everything), allocates the others in aligned free slots largest first (RFC 4632), gateway at the first or last usable address, optional growth %, reports utilisation, VLANs that do not fit and overlaps of the networks already set. Each subnet has a status kept|new|changed|nofit and `changes` counts the VLANs whose network or gateway would change; call first without apply to show the user the changes. apply: true writes net, gw (and hosts) of the changed VLANs only and configures the core L3 switch: one SVI per addressed VLAN at the gateway address, routing on, DHCP relay to the project DHCP server (static-IP server serving DHCP) with the missing scopes added there, otherwise DHCP scopes on the core (management VLAN 99 excluded). Undoable and idempotent.',
      inputSchema: { type: 'object', properties: { block: { type: 'string' }, gw: { type: 'string', enum: ['first', 'last'] }, growth: { type: 'number' }, hosts: { type: 'object' }, keep: { type: 'boolean' }, apply: { type: 'boolean' } } },
      async run({ block, gw, growth, hosts, keep, apply }) {
        const W = await h.netWs(), [D] = await mods(), S = await import('../net/subnet.js'), data = W.data(), vl = data.vlans || [];
        if (!vl.length) h.fail('the project has no VLAN: create them first (design_apply creates DATA, VOICE, WIFI, MGMT)');
        const d = D.cleanDesign(data.design), ip = { ...d.ip, ...(block ? { block } : {}), ...(gw ? { gw } : {}), ...(growth != null ? { growth } : {}) };
        if (block && !S.parseCidr(block)) h.fail(`"${block}" is not an IPv4 block like 10.10.0.0/16`);
        const want = new Map(Object.entries(hosts || {}).map(([k, v]) => [String(k), Math.max(0, Math.round(+v || 0))]));
        let counted = null; try { const U = await import('../net/ui/ipplan.js'); counted = v => U.hostsFor(data, v).n; } catch (e) { counted = v => v.hosts ?? 0; }
        const plan = S.planKeep(ip.block, vl.map(v => ({ id: v.id, name: v.name, hosts: want.has(String(v.id)) ? want.get(String(v.id)) : counted(v), net: v.net, gw: v.gw })), { gw: ip.gw, growth: ip.growth, minHosts: ip.minHosts, keep: keep !== false && ip.keep });
        const existing = S.overlaps(vl.filter(v => v.net).map(v => ({ id: v.id, net: v.net })));
        let l3 = null;
        if (apply) {
          for (const v of vl) { if (want.has(String(v.id))) v.hosts = want.get(String(v.id)); const s = plan.subnets.find(x => x.id === v.id && x.fit); if (s && (s.cidr !== v.net || s.gw !== v.gw)) { v.net = s.cidr; v.gw = s.gw; } }
          data.design = D.cleanDesign({ ...d, ip }); l3 = D.applyL3(data); W.commit();
        }
        return { applied: !!apply, ...plan, overlaps_before: existing, core_l3: apply ? l3 || null : null };
      }
    }
  ];
}
