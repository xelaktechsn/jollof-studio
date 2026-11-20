// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outils de l'IA pour la conception réseau professionnelle (partie rack). Descriptions en anglais (lues par l'IA).
// h : { netWs() → plan de travail (data(), commit(), lan(), …), netNode, netDev, netPort, netName, fail, norm }.
// Les modules du réseau se chargent à la demande (import() dans run) : rien ici n'alourdit le démarrage.
// Outils : rack_add, rack_get, rack_place, rack_remove, rack_power, patch_connect.
export function tools(h) {
  const R = () => import('../net/rack.js');
  const C = () => import('../net/checks/rack.js');
  /** Baie désignée par son nom ou son id (la seule baie si ref est vide). */
  function rackRef(W, ref) {
    const racks = W.data().racks || [];
    if (!ref) { if (racks.length === 1) return racks[0]; h.fail(racks.length ? `several racks: give "rack" (${racks.map(r => r.name).join(', ')})` : 'no rack yet: create one with rack_add'); }
    const r = racks.find(x => x.id === ref) || racks.find(x => h.norm(x.name) === h.norm(ref));
    if (!r) h.fail(`no rack "${ref}". Racks: ${racks.map(x => x.name).join(', ') || '(none)'}`);
    return r;
  }
  async function rackIssues(W, r) {
    const { issues } = await C(), data = W.data(), ids = new Set([r.id, ...data.devices.filter(d => d.rack && d.rack.id === r.id).map(d => d.id)]);
    return issues(data, W.lan(), { name: id => h.netName(W, id) }).filter(i => ids.has(i.id)).map(i => `${i.code} ${i.text}`);
  }
  async function report(W, r) {
    const { rackSummary } = await R(), s = rackSummary(W.data(), r, W.lan());
    return {
      rack: r.name, kind: r.kind, height_u: r.u, width_mm: r.w, depth_mm: r.d, usable_depth_mm: r.depth, load_rating_kg: r.load, floor: r.floor || null,
      used_u: s.usedU, free_u_front: s.freeU,
      elevation: s.devices.map(d => ({ device: d.name, type: d.type, u: d.h ? `${d.u}${d.h > 1 ? '-' + (d.u + d.h - 1) : ''}` : '0U (vertical)', face: d.face, model: d.ref, kg: d.kg })),
      totals: { power_w: s.w, power_basis: s.basis, typical_w: s.typW, max_w: s.maxW, poe_reserved_w: s.poeW, va: s.va, heat_w: s.heatW, heat_btu_h: s.btu, weight_kg: s.kg, weight_unknown_for: s.unknownKg.map(id => h.netName(W, id)) },
      problems: await rackIssues(W, r)
    };
  }
  return [
    {
      name: 'rack_add',
      description: 'Create a 19-inch rack in the network project (Racks view). kind: "floor" (default: 42U, 600 × 1000 mm, usable depth 652.3 mm, 800 kg static load, from a real datasheet) or "wall" (12U wall cabinet, 450 mm deep, 50 kg). Optional: name, u (height in U, 1–60), width_mm, depth_mm, usable_depth_mm (between front and rear rails), load_kg, floor (floor id from the plans), heat_limit_w, runtime_target_min (UPS autonomy target). Undoable.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['floor', 'wall'] }, u: { type: 'number' }, width_mm: { type: 'number' }, depth_mm: { type: 'number' }, usable_depth_mm: { type: 'number' }, load_kg: { type: 'number' }, floor: { type: 'string' }, heat_limit_w: { type: 'number' }, runtime_target_min: { type: 'number' } } },
      async run(a) {
        const W = await h.netWs(), { newRack, cleanRacks } = await R(), data = W.data();
        if (a.name && (data.racks || []).some(r => h.norm(r.name) === h.norm(a.name))) h.fail(`a rack is already named ${a.name}`);
        const base = newRack(data, a.kind === 'wall' ? 'wall' : 'floor');
        const r = cleanRacks([{ ...base, ...(a.name ? { name: a.name } : {}), ...(a.u ? { u: a.u } : {}), ...(a.width_mm ? { w: a.width_mm } : {}), ...(a.depth_mm ? { d: a.depth_mm } : {}), ...(a.usable_depth_mm ? { depth: a.usable_depth_mm } : {}), ...(a.load_kg ? { load: a.load_kg } : {}), ...(a.floor ? { floor: a.floor } : {}), ...(a.heat_limit_w ? { heat: a.heat_limit_w } : {}), ...(a.runtime_target_min != null ? { runtime: a.runtime_target_min } : {}) }])[0];
        data.racks = [...(data.racks || []), r]; W.commit();
        return report(W, r);
      }
    },
    {
      name: 'rack_get',
      description: 'Read the racks: with "rack" (name), its elevation (each device with its U range, face front/rear, model, weight), totals (power typical/max incl. PoE reserved by switches, VA, heat in W and BTU/h, weight vs rating) and its problems (codes J1273–J1285). Without "rack": a summary of every rack and the rack-mountable devices not yet in a rack. Rack-mountable types and their datasheet height/depth/weight/power are listed in "mountable".',
      inputSchema: { type: 'object', properties: { rack: { type: 'string' } } },
      annotations: { readOnlyHint: true },
      async run({ rack }) {
        const W = await h.netWs(), M = await R();
        if (rack) return report(W, rackRef(W, rack));
        const data = W.data();
        return {
          racks: M.racksSummary(data, W.lan()).map(s => ({ rack: s.name, kind: s.kind, height_u: s.u, used_u: s.usedU, power_w: s.w, heat_btu_h: s.btu, weight_kg: s.kg, load_rating_kg: s.load })),
          unracked: M.unracked(data).map(d => ({ device: d.name, type: d.type })),
          mountable: Object.fromEntries(Object.entries(M.MOUNT).map(([t, m]) => [t, { u: m.u, depth_mm: m.depth, kg: m.kg, typical_w: m.typ, max_w: m.max, model: m.ref, ...(m.shelf ? { needs_shelf: true } : {}) }]))
        };
      }
    },
    {
      name: 'rack_place',
      description: 'Put a device into a rack: either an existing device ("device": name) or a new one ("type": e.g. switch48, patch24, cablemgr, shelf, blank, pdu, pdu1u, ups, ups3k, ebm, fan, server; optional "name"). u = bottom U (1 = lowest; omit to take the lowest free slot), face "front" (default) or "rear". Devices deeper than half the usable depth take both faces. Desktop devices (switch, poeswitch, mediaconv) must sit on a shelf directly below. power_w optionally sets the measured/announced power of the device. Fails on collision. Undoable.',
      inputSchema: { type: 'object', properties: { rack: { type: 'string' }, device: { type: 'string' }, type: { type: 'string' }, name: { type: 'string' }, u: { type: 'number' }, face: { type: 'string', enum: ['front', 'rear'] }, power_w: { type: 'number' } } },
      async run(a) {
        const W = await h.netWs(), M = await R(), data = W.data(), r = rackRef(W, a.rack);
        let d = null, made = false;
        if (a.device) d = h.netDev(W, a.device);
        else {
          if (!a.type || !M.MOUNT[a.type]) h.fail(`give "device" or a rack-mountable "type": ${Object.keys(M.MOUNT).join(', ')}`);
          if (a.name && data.devices.some(x => h.norm(x.name) === h.norm(a.name))) h.fail(`a device is already named ${a.name}`);
          d = W.ctx().newDevice(a.type, { x: 0, y: 0 }); made = true;
          if (a.name) d.name = String(a.name).slice(0, 24);
        }
        const undo = () => { if (made) data.devices.splice(data.devices.indexOf(d), 1); };
        const face = a.face ? (a.face === 'rear' ? 'rear' : 'front') : M.MOUNT[d.type] && !M.MOUNT[d.type].u ? 'rear' : 'front'; // PDU verticale : à l'arrière
        if (!M.MOUNT[d.type]) { undo(); h.fail(`${d.name} (${d.type}) does not mount in a 19-inch rack`); }
        const u = a.u != null ? Math.round(a.u) : M.findFree(data, r, d, face);
        if (!u) { undo(); h.fail(`no free slot of ${M.MOUNT[d.type].u}U in ${r.name}`); }
        const ok = M.canPlace(data, r, d, u, face);
        if (!ok.ok) { undo(); h.fail(ok.why === 'outside' ? `U${u} is outside ${r.name} (1–${r.u - M.MOUNT[d.type].u + 1} for this ${M.MOUNT[d.type].u}U device)` : `U${u} is taken by ${h.netName(W, ok.with)}`); }
        d.rack = { id: r.id, u, face, ...(a.power_w != null ? { w: Math.max(0, +a.power_w || 0) } : {}) };
        W.commit();
        return { device: d.name, type: d.type, rack: r.name, u: M.MOUNT[d.type].u ? `${u}${M.MOUNT[d.type].u > 1 ? '-' + (u + M.MOUNT[d.type].u - 1) : ''}` : '0U', face, problems: await rackIssues(W, r) };
      }
    },
    {
      name: 'rack_remove',
      description: 'Take a device out of its rack ("device": name; the device stays in the project), or delete a whole rack ("rack": name, with delete_rack true; its devices are kept, unracked). Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, rack: { type: 'string' }, delete_rack: { type: 'boolean' } } },
      async run({ device, rack, delete_rack }) {
        const W = await h.netWs(), data = W.data();
        if (device) { const d = h.netDev(W, device); if (!d.rack) h.fail(`${d.name} is not in a rack`); delete d.rack; W.commit(); return { device: d.name, unracked: true }; }
        if (rack && delete_rack) {
          const r = rackRef(W, rack), { removeRack } = await R(), out = removeRack(data, r.id); W.commit();
          return { deleted: r.name, devices_unracked: out.unracked.length };
        }
        h.fail('give "device", or "rack" with delete_rack: true');
      }
    },
    {
      name: 'rack_power',
      description: 'Power report of a rack: per device typical and maximum power (W, datasheet values; switches add the PoE power they reserve), total W and VA (W / power factor, a design default), heat (W and BTU/h, 1 W = 3.412 BTU/h), PDU loads (VA vs A × V, outlets), UPS load (%) and estimated runtime (interpolated from the datasheet full-load and half-load points: simplified model, ±15 %) against the rack target. Optional: basis "typ" or "max", power_factor, runtime_target_min, heat_limit_w to change the rack design values (undoable).',
      inputSchema: { type: 'object', properties: { rack: { type: 'string' }, basis: { type: 'string', enum: ['typ', 'max'] }, power_factor: { type: 'number' }, runtime_target_min: { type: 'number' }, heat_limit_w: { type: 'number' } }, required: [] },
      async run(a) {
        const W = await h.netWs(), M = await R(), r = rackRef(W, a.rack);
        const ch = {}; if (a.basis) ch.basis = a.basis; if (a.power_factor) ch.pf = a.power_factor; if (a.runtime_target_min != null) ch.runtime = a.runtime_target_min; if (a.heat_limit_w) ch.heat = a.heat_limit_w;
        if (Object.keys(ch).length) { Object.assign(r, M.cleanRacks([{ ...r, ...ch }])[0]); W.commit(); }
        const devs = W.data().devices.filter(d => d.rack && d.rack.id === r.id), pw = M.rackPower(r, devs, W.lan());
        return {
          rack: r.name, basis: pw.basis, power_factor: pw.pf, supply_v: r.volts,
          devices: devs.filter(d => M.MOUNT[d.type] && !M.MOUNT[d.type].pdu && !M.MOUNT[d.type].ups && !M.MOUNT[d.type].ebmOf).map(d => { const p = M.devicePower(d, W.lan(), pw.basis); return { device: d.name, typical_w: p.typ, max_w: p.max, poe_reserved_w: p.poe, used_w: p.w, ...(p.user ? { set_by_user: true } : {}), ...(p.guess ? { typical_unknown_max_used: true } : {}) }; }),
          total_w: pw.w, typical_w: pw.typW, max_w: pw.maxW, va: pw.va, heat_w: pw.heatW, heat_btu_h: pw.btu, heat_limit_w: r.heat,
          pdus: pw.pdus.map(p => ({ pdu: h.netName(W, p.id), load_w: p.w, load_va: p.va, capacity_va: p.capVA, load_pct: p.pct, current_a: p.amps, plugs: p.plugs, outlets: p.outlets })),
          ups: pw.ups.map(u => ({ ups: h.netName(W, u.id), load_w: u.w, capacity_w: u.capW, load_pct: u.pct, runtime_min: u.runtime === Infinity ? null : u.runtime, extrapolated: u.extra, battery_module: u.ebm ? h.netName(W, u.ebm) : null, target_min: u.target })),
          unplugged: pw.unplugged.map(id => h.netName(W, id)), problems: await rackIssues(W, r)
        };
      }
    },
    {
      name: 'patch_connect',
      description: 'Patch a panel front port to a switch port with a short patch cord (creates a cable): panel_port "PB1.f3", switch_port "SW1.p5" (any device port works). length_m default 0.5, category cat6 by default. Then net_get / rack_get show the link; the patching schedule (outlet → panel port → switch port, VLAN) is returned for the panel. Undoable.',
      inputSchema: { type: 'object', properties: { panel_port: { type: 'string' }, switch_port: { type: 'string' }, length_m: { type: 'number' }, category: { type: 'string', enum: ['cat5e', 'cat6', 'cat6a'] } }, required: ['panel_port', 'switch_port'] },
      async run({ panel_port, switch_port, length_m, category }) {
        const W = await h.netWs(), M = await R(), data = W.data();
        const pa = h.netPort(W, panel_port), pb = h.netPort(W, switch_port), panel = data.devices.find(d => d.id === pa[0]);
        if (!panel || !M.PANELS.has(panel.type)) h.fail(`${panel_port} is not a patch panel port`);
        if (!/^f\d+$/.test(pa[1])) h.fail(`${panel_port}: patch cords go to the front ports (f1, f2, …); back ports b… take the permanent links`);
        const used = p => data.cables.some(c => (c.a[0] === p[0] && c.a[1] === p[1]) || (c.b[0] === p[0] && c.b[1] === p[1]));
        if (used(pa)) h.fail(`${panel_port} already has a cord`); if (used(pb)) h.fail(`${switch_port} already has a cable`);
        const c = W.ctx().addCable(pa, pb, { kind: 'straight', cat: category || 'cat6', len: Math.max(0.1, Math.min(10, +length_m || M.RACK_DESIGN.cord)) });
        W.commit();
        const row = M.patchingSchedule(W.data(), W.lan()).find(x => x.panelId === pa[0] && x.portId === pa[1]);
        return { cable: c.id, schedule: row ? { label: row.label, outlet: row.outlet || null, permanent_link_m: row.permLen, switch: row.switch, switch_port: row.switchPort, vlan: row.vlan, cord_m: row.cordLen, link_up: row.up } : null };
      }
    }
  ];
}
