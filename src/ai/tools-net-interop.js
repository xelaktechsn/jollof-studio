// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outils de l'IA pour les échanges du réseau avec d'autres logiciels (partie IFC). Descriptions en anglais (lues par
// l'IA). h : { netWs() → plan de travail (data(), commit(), ctx(), …), fail, norm }. Modules chargés à la demande.
const MAX_TEXT = 8e6;
export function tools(h) {
  const ifc = () => import('../net/interop/ifc.js');
  const text = s => { if (typeof s !== 'string' || !/ISO-10303-21/.test(s.slice(0, 2000))) h.fail('ifc must be the text of a .ifc file (STEP, starting with ISO-10303-21;)'); if (s.length > MAX_TEXT) h.fail('IFC text too long for this tool (8 MB max): use File > Import an IFC model'); return s; };
  return [
    {
      name: 'ifc_export',
      description: 'Export the network project as an IFC4 model (STEP .ifc) for BIM tools: site/buildings/storeys, rooms as IfcSpace (footprint extruded to storey height), walls and doors (optional), cable pathways as IfcCableCarrierSegment, cables as IfcCableSegment along their route (declares ReferenceView_V1.2 by default), switches/routers/APs/patch panels as IfcCommunicationsAppliance, outlets as IfcOutlet (DATAOUTLET), racks as IfcFurniture, an IfcDistributionSystem (DATA), ports and port connections, property sets (Pset_* and JOLLOF_Network: Label, Type, VLAN, IP, Rack, U, Category, Length). GlobalIds are stable across exports. Simplified geometry (boxes, extruded profiles, tubes). save=true opens the save dialog; otherwise only reports what the file would contain.',
      inputSchema: { type: 'object', properties: { save: { type: 'boolean' }, walls: { type: 'boolean', description: 'export walls and doors (default true)' }, cables: { type: 'boolean', description: 'cable tube geometry (default true; axis lines are always written)' }, ports: { type: 'boolean', description: 'IfcDistributionPort + IfcRelConnectsPorts (default true)' }, view: { type: 'string', enum: ['rv', 'design'], description: 'rv (default): declares ReferenceView_V1.2 and uses only its concepts; design: adds wall/pathway/cable axes, material layer sets and cable tubes (no view declared)' } } },
      async run({ save, walls, cables, ports, view } = {}) {
        const W = await h.netWs(), m = await import('../net/ui/ifcexport.js'), o = {};
        if (walls === false) { o.walls = false; o.doors = false; }
        if (cables === false) o.cables = false;
        if (ports === false) o.ports = false;
        if (view === 'design') o.view = 'design';
        if (save) { const r = await m.exportIfc(W.ctx(), { ...o, direct: true }); return r ? { saved: r.path, stats: r.stats } : { saved: null, note: 'nothing exported (no floor, or the save dialog was cancelled)' }; }
        const r = m.buildIfc(W.ctx(), o);
        return { file: r.name, schema: 'IFC4', bytes: r.text.length, stats: r.stats };
      }
    },
    {
      name: 'ifc_read',
      description: 'Read the text of an IFC file (IFC4 or IFC2X3, STEP .ifc, up to 8 MB) and summarise it without changing the project: schema, length unit, buildings and storeys (elevation, height, counts of spaces, walls, doors, network appliances/outlets, cable carriers, cables), warnings.',
      inputSchema: { type: 'object', properties: { ifc: { type: 'string', description: 'full text of the .ifc file' } }, required: ['ifc'] },
      annotations: { readOnlyHint: true },
      async run({ ifc: src }) { const I = await ifc(); return I.ifcSummary(I.readIfc(text(src))); }
    },
    {
      name: 'ifc_import_summary',
      description: 'Summary of the IFC file currently (or last) opened in the IFC import wizard (File > Import an IFC model): schema, unit, storeys with their content counts, warnings. Returns null when no IFC file was read in this session.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      async run() { const m = await import('../net/ui/ifcimport.js'); return { summary: m.lastIfcSummary() }; }
    },
    {
      name: 'ifc_import',
      description: 'Import an IFC file given as text into the project, in one undoable step: each selected storey becomes a new floor (in a new building named after the IFC building), with its rooms (IfcSpace footprints), walls (axis, thickness, material) and doors; optionally network appliances/outlets as placed devices and cable carriers as pathways. Lengths are converted from the file unit (or the forced unit).',
      inputSchema: { type: 'object', properties: {
        ifc: { type: 'string', description: 'full text of the .ifc file' },
        storeys: { type: 'array', items: { type: 'string' }, description: 'storey names to import (default: all)' },
        devices: { type: 'boolean', description: 'also import appliances and outlets as devices (default false)' },
        paths: { type: 'boolean', description: 'also import cable carriers as pathways (default false)' },
        unit: { type: 'string', enum: ['auto', 'm', 'cm', 'mm', 'ft', 'in'], description: 'force the length unit (default: the file unit)' }
      }, required: ['ifc'] },
      async run({ ifc: src, storeys, devices, paths, unit }) {
        const I = await ifc(), W = await h.netWs(), m0 = I.readIfc(text(src));
        const U = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 }, k = unit && U[unit] ? U[unit] / (m0.units.length.toMetre || 1) : 1, m = I.scaleModel(m0, k);
        const want = Array.isArray(storeys) && storeys.length ? new Set(storeys.map(h.norm)) : null, choice = { storeys: {}, what: { rooms: true, walls: true, doors: true, devices: !!devices, paths: !!paths } };
        for (const b of m.buildings) for (const s of b.storeys) choice.storeys[s.key] = { on: !want || want.has(h.norm(s.name)), target: 'new', building: 'new' };
        if (!Object.values(choice.storeys).some(x => x.on)) h.fail('no storey matches (see ifc_read)');
        const ctx = W.ctx(), r = I.applyIfc(W.data(), m, choice, { newDevice: ctx && ctx.newDevice ? (t, at) => ctx.newDevice(t, at) : null });
        W.commit();
        return { floors: r.floors, counts: r.counts, skipped: r.skipped, unit: m0.units.length, warnings: m0.warnings };
      }
    }
  ];
}
