// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outils de l'IA pour la conception réseau professionnelle (partie fibre). Descriptions en anglais (lues par l'IA).
// h : { netWs() → plan de travail (data(), commit(), lan(), …), netNode, netDev, netPort, netName, fail, norm }.
// Les modules du réseau se chargent à la demande (import() dans run) : rien ici n'alourdit le démarrage.
const r2 = x => (x == null ? null : Math.round(x * 100) / 100);
const linkOut = (F, ch, lk) => ({
  up: lk.up, speed_mbps: lk.speed || 0, reason: lk.why ? (lk.need === 'mcp' ? 'mcp (LX on multimode needs a mode-conditioning patch cord)' : lk.why) : null,
  loss_db: r2(lk.loss), allowed_db: r2(lk.budget), allowed_from: lk.basis === 'ieee' ? 'IEEE 802.3 max channel insertion loss' : lk.basis === 'power' ? 'module power budget (Tx min - Rx sensitivity)' : null,
  margin_db: r2(lk.margin), reach_m: lk.reach, receiver_overload_db: lk.overload || 0,
  rows: lk.nm ? F.budgetRows(ch, lk).map(r => ({ item: r.key, detail: r.detail, db: r.db })) : []
});

export function tools(h) {
  const { netWs, netName, fail } = h;
  return [
    {
      name: 'fibre_types',
      description: 'Optical fibre types of the network workspace (cable field "fibre"): id, name, multimode/singlemode, maximum cabled attenuation in dB/km per wavelength (850/1300 nm multimode, 1310/1550 nm singlemode; TIA-568.3-D / ISO/IEC 11801 / ITU-T G.652 values read through FOA and Fluke Networks guides), plus the loss per mated connector pair and per splice used by the budget.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      async run() {
        const F = await import('../net/fibre.js'), { NET } = await import('../net/limits.js');
        return {
          types: F.FIBRE_IDS.map(id => ({ id, name: F.FIBRE_TYPES[id].name, mode: F.FIBRE_TYPES[id].mode === 'mmf' ? 'multimode' : 'singlemode', core_um: F.FIBRE_TYPES[id].core, attenuation_db_per_km: F.FIBRE_TYPES[id].att })),
          connector_db: NET.FIBRE_CONN_DB.v, splice_db: NET.FIBRE_SPLICE_DB.v, recommended_margin_db: NET.FIBRE_MARGIN_DB.v,
          model: 'simplified: loss = length x attenuation + one mated pair per passive pass-through (patch panel) x 0.75 dB + splices x 0.3 dB + attenuators; the two connections into the modules are part of the module specs (IEEE 802.3 cabling model)'
        };
      }
    },
    {
      name: 'sfp_modules',
      description: 'Catalogue of SFP/SFP+/SFP28 transceiver modules that can be plugged in the SFP cages of the network devices (device setting sfp: { "<port>": "<module id>" }): id, speed, media (mmf, smf, copper), wavelength, form factor, maximum reach per fibre type, max channel loss per fibre type (IEEE 802.3 via FOA/Fluke) and power budget from Cisco data sheets. Optional cage ("sfp" or "sfp+") lists only the modules that fit.',
      inputSchema: { type: 'object', properties: { cage: { type: 'string', enum: ['sfp', 'sfp+'] } } },
      annotations: { readOnlyHint: true },
      async run({ cage } = {}) {
        const F = await import('../net/fibre.js');
        const ids = cage ? F.modulesFor(cage) : F.MODULE_IDS;
        return {
          modules: ids.map(id => { const m = F.MODULES[id]; return { id, speed_mbps: m.speed, media: m.media, wavelength_nm: m.nm || null, form: m.form, reach_m: m.reach, max_channel_loss_db: m.chan || null, power_budget_db: m.budget, tx_dbm: m.tx || null, rx_dbm: m.rx || null, needs_mode_conditioning_on_multimode: !!m.mcp, ieee: m.ieee }; }),
          notes: 'Both ends of a link need the same module. 1G SFP modules work in SFP+ cages, 10G SFP+ modules do not work in 1G SFP cages. 25G SFP28 modules need SFP28 cages (none in the current devices).'
        };
      }
    },
    {
      name: 'fibre_budget',
      description: 'Optical loss budget. Either for an existing cable of the network (cable id, or "NAME.port" of one end): the whole channel through patch panels with the modules plugged at both ends (or module to try a different one); or hypothetical: length_m, fibre type, connectors (mated pairs at patch panels), splices, attenuator_db and module. Returns the loss rows (fibre, connections, splices), total loss, the loss allowed by the module (IEEE channel loss or power budget), margin, reach and the reason when the link would not come up.',
      inputSchema: {
        type: 'object',
        properties: {
          cable: { type: 'string' }, module: { type: 'string' }, length_m: { type: 'number' }, fibre: { type: 'string' },
          connectors: { type: 'number' }, splices: { type: 'number' }, attenuator_db: { type: 'number' }, mode_conditioning: { type: 'boolean' }
        }
      },
      annotations: { readOnlyHint: true },
      async run(a = {}) {
        const F = await import('../net/fibre.js');
        if (a.module && !F.MODULES[a.module]) fail(`unknown module "${a.module}". Modules: ${F.MODULE_IDS.join(', ')}`);
        if (a.cable) {
          const W = await netWs(), data = W.data(), C = await import('../net/checks/fibre.js');
          const s = String(a.cable), dot = s.lastIndexOf('.');
          let cab = data.cables.find(c => c.id === s);
          if (!cab && dot > 0) {
            const nm = s.slice(0, dot).toLowerCase(), port = s.slice(dot + 1), d = data.devices.find(x => x.id === s.slice(0, dot) || String(x.name).toLowerCase() === nm);
            if (d) cab = data.cables.find(c => (c.a[0] === d.id && c.a[1] === port) || (c.b[0] === d.id && c.b[1] === port));
          }
          if (!cab) fail(`no cable "${s}" (see net_get)`);
          const L = C.fibreLinks(data, W.lan()).find(x => x.cables.some(c => c.id === cab.id));
          const ch = L ? L.ch : F.fibreChannel([cab], 0);
          if (ch.media === 'copper' && !a.module) return { media: 'copper', note: 'copper cable: no optical budget (set media "fibre" on the cable)' };
          const lk = a.module ? F.fibreLink(ch, a.module, a.module) : L ? L.link : F.fibreLink(ch, null, null);
          return {
            link: L ? `${netName(W, L.a.n)}.${L.a.p} <-> ${netName(W, L.b.n)}.${L.b.p}` : null, modules: L ? [L.modA, L.modB] : [], tried: a.module || null,
            channel: { length_m: ch.len, fibre: ch.types, connectors: ch.connectors, splices: ch.splices, attenuator_db: ch.attn, mode_conditioning: ch.mcp },
            ...linkOut(F, ch, lk)
          };
        }
        if (!a.module) fail('give a cable, or a module with length_m and fibre for a hypothetical link');
        const fibre = a.fibre || (F.MODULES[a.module].media === 'smf' ? 'os2' : 'om4');
        if (!F.FIBRE_TYPES[fibre]) fail(`unknown fibre "${fibre}". Types: ${F.FIBRE_IDS.join(', ')}`);
        const cab = { len: Math.max(0.1, Math.min(100000, +a.length_m || 100)), ...F.cleanMedia({ media: 'fibre', fibre, splices: a.splices, attn: a.attenuator_db, mcp: !!a.mode_conditioning }) };
        const ch = F.fibreChannel([cab], Math.max(0, Math.min(20, a.connectors ?? 2) | 0));
        return { channel: { length_m: ch.len, fibre, connectors: ch.connectors, splices: ch.splices, attenuator_db: ch.attn }, module: a.module, ...linkOut(F, ch, F.fibreLink(ch, a.module, a.module)) };
      }
    }
  ];
}
