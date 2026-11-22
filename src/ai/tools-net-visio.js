// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outil de l'IA pour l'export des schémas du réseau vers Visio (.vsdx) et draw.io (.drawio). Description en anglais (lue
// par l'IA). h : { netWs() → plan de travail (data(), ctx(), …), fail }. Modules chargés à la demande.
export function tools(h) {
  return [{
    name: 'diagram_export',
    description: 'Export the network views as diagrams for Microsoft Visio (.vsdx) or draw.io (.drawio): one page per view — the logical diagram (devices as shapes from one master per device type, cables as 1-D connectors glued to the devices), one elevation per rack (front and rear faces, 1:10, real millimetres), one plan per floor (rooms, walls, pathways, racks, outlets, access points, at a 1:50…1:2000 scale in real metres). Layers per page; shape data on every shape: Label, Model, IP, VLAN, Rack, U, Category, Length. Without save, only reports the pages that would be written. racks / floors: true (all), false (none) or a list of ids.',
    inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['vsdx', 'drawio'] }, save: { type: 'boolean' }, logic: { type: 'boolean' }, racks: { anyOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'string' } }] }, floors: { anyOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'string' } }] } } },
    async run({ format = 'vsdx', save, logic, racks, floors } = {}) {
      if (format !== 'vsdx' && format !== 'drawio') h.fail('format must be "vsdx" or "drawio"');
      const W = await h.netWs(), views = { logic: logic !== false, racks: racks ?? true, floors: floors ?? true };
      if (save) {
        const m = await import('../net/ui/visioexport.js');
        const r = await (format === 'drawio' ? m.exportDrawio : m.exportVsdx)(W.ctx(), { views });
        return r ? { saved: r.path, stats: r.stats } : { saved: null, note: 'nothing exported (empty project, or the save dialog was cancelled)' };
      }
      const { buildViews } = await import('../net/interop/diagram.js'), V = buildViews(W.data(), { views });
      return { format, pages: V.pages.map(p => ({ name: p.name, kind: p.kind, scale: p.unit === 'px' ? null : `1:${p.scale}`, shapes: p.shapes.length, connectors: p.edges.length, layers: p.layers.map(L => L.name) })), stats: V.stats };
    }
  }];
}
