// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outils de l'IA pour la conception réseau professionnelle (partie wifi). Descriptions en anglais (lues par l'IA).
// h : { netWs() → plan de travail (data(), commit(), lan(), …), netNode, netDev, netPort, netName, fail, norm }.
// Les modules du réseau se chargent à la demande (import() dans run) : rien ici n'alourdit le démarrage.
const r1 = x => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const BOUT = { b24: '2.4GHz', b5: '5GHz', b6: '6GHz' }, BIN = { '2.4': 'b24', 5: 'b5', 6: 'b6' };
const MODEL = 'simplified model: RSSI = Tx + antenna gain - PL(d) - sum of wall losses; PL = 20 log10 f(MHz) - 28 + N log10 d (ITU-R P.1238), N = 20 with each drawn wall counted (env "walls") or the P.1238 office/residential N with walls included; wall loss = single homogeneous slab at normal incidence from ITU-R P.2040 material properties; adjacent floor: P.1238 floor penetration factor; noise floor assumed (default -92 dBm); SINR = serving signal / (noise + interferers of the same band weighted by the share of spectrum their channel has in common with the serving one; all APs transmitting at once: worst case, no adjacent-channel rejection mask); 6 GHz: office N = 23.9 from the P.1238-13 site-general model (Table 2, office NLoS, 0.3-255 GHz; matches measured PLE 2.42 at 6.75 GHz), floor factor extrapolated from the 5.8 GHz row of P.1238 (no 6 GHz value), low-power-indoor rules (EU ECC/DEC/(20)01: 5945-6425 MHz, 23 dBm EIRP, 10 dBm/MHz; US 47 CFR 15.407(a)(5): 5925-7125 MHz, 30 dBm, 5 dBm/MHz). Statistics on a 1 m grid. An on-site survey is still needed.';

export function tools(h) {
  const { netWs, fail } = h;
  /** Points d'accès désignés (nom ou id ; tous si absent). */
  const pickAps = (WF, data, ref) => {
    const aps = WF.apsOf(data); if (ref == null) return aps;
    const s = String(ref).trim().toLowerCase(), one = aps.filter(a => a.d.id.toLowerCase() === s || String(a.d.name).toLowerCase() === s);
    if (!one.length) fail(`no access point "${ref}" (types ap / ap6; see wifi_get)`);
    return one;
  };
  const settingsOut = s => ({ regulatory_domain: s.reg, propagation_env: s.env, target_dbm: s.target, noise_floor_dbm: s.noise, snr_target_db: s.snr, coverage_target_pct: s.cover, co_channel_overlap_allowed_pct: s.cci, client_height_m: s.rxH, stats_band: s.band, sinr_target_db: s.sinr });
  return [
    {
      name: 'wifi_get',
      description: 'Wi-Fi design of the network project: settings (regulatory domain eu/us, propagation model, target RSSI default -67 dBm, assumed noise floor, coverage goal %), every access point (types "ap" = TP-Link EAP225 Wi-Fi 5 802.3af, "ap6" = TP-Link EAP670 Wi-Fi 6 802.3at PoE class 4, "ap6e" = Ubiquiti U6 Enterprise Wi-Fi 6E tri-band 2.4/5/6 GHz 802.3at PoE class 4) with floor placement and per-band radio settings (on, channel, width MHz, conducted tx dBm, antenna gain dBi, datasheet max), the channels allowed per width in the domain, co-channel overlaps and the coverage of each room that needs Wi-Fi (office, open, classroom, lab, meeting, hall). ' + MODEL,
      inputSchema: { type: 'object', properties: { ap: { type: 'string', description: 'one access point (name or id); all if omitted' } } },
      annotations: { readOnlyHint: true },
      async run({ ap } = {}) {
        const W = await netWs(), WF = await import('../net/wifi.js'), C = await import('../net/checks/wifi.js'), data = W.data(), set = WF.wifiSettings(data);
        const aps = pickAps(WF, data, ap).map(a => {
          const at = a.loc ? WF.findFloor(data, a.loc.floor) : null, spec = WF.radioSpec(a.d.type);
          return {
            id: a.d.id, name: a.d.name, type: a.d.type, poe_class: a.d.p.poeClass,
            placed: at ? { building: at.building.name, floor: at.floor.name, floor_id: at.floor.id, x: a.loc.x, y: a.loc.y, h: a.loc.h } : null,
            radios: Object.fromEntries(WF.bandsOf(a.d.type).map(b => [BOUT[b], { ...a.r[b], datasheet_max_tx_dbm: spec[b].tx, datasheet_eirp_eu_dbm: spec[b].eirp, ...(b === 'b6' ? { lpi_max_eirp_dbm: WF.lpiMax(set.reg, a.r[b].w), psc: WF.isPsc(a.r[b].ch) } : {}), widths: spec[b].widths, fault: WF.radioFault(a.d.type, b, a.r[b], set.reg), power_fault: WF.powerFault(a.d.type, b, a.r[b], set.reg) }]))
          };
        });
        const overlaps = C.projectOverlaps(data, set).map(o => ({ a: data.devices.find(d => d.id === o.a).name, b: data.devices.find(d => d.id === o.b).name, band: BOUT[o.band], overlap_pct: Math.round(o.pct), kind: o.kind }));
        const rooms = C.projectRooms(data, set).map(x => ({ room: x.room.name || x.room.id, floor: x.floor.name, coverage_pct: Math.round(x.pct), ok: x.pct >= set.cover }));
        return {
          settings: settingsOut(set), access_points: aps, overlaps, rooms_needing_wifi: rooms,
          channels: { '2.4GHz_20MHz': WF.channels('b24', set.reg, 20), '2.4GHz_non_overlapping': [1, 6, 11], '5GHz_20MHz': WF.channels('b5', set.reg, 20), '5GHz_40MHz': WF.channels('b5', set.reg, 40), '6GHz_20MHz': WF.channels('b6', set.reg, 20), '6GHz_80MHz': WF.channels('b6', set.reg, 80), '6GHz_160MHz': WF.channels('b6', set.reg, 160), '6GHz_psc': WF.allowed('b6', set.reg).filter(WF.isPsc), '5GHz_80MHz': WF.channels('b5', set.reg, 80), '5GHz_160MHz': WF.channels('b5', set.reg, 160) },
          model: MODEL
        };
      }
    },
    {
      name: 'wifi_set',
      description: 'Change Wi-Fi settings. Either the radio of access points (ap: name or id, or "*" for all): band "2.4", "5" or "6" (6 GHz only on "ap6e"), with any of on, channel, width_mhz (20/40/80/160 as the radio allows), tx_dbm (conducted power, datasheet max applies; in the EU the EIRP tx+gain is also capped per sub-band; at 6 GHz the low-power-indoor EIRP limit min(max EIRP, PSD + 10 log10 width) applies), gain_dbi, and/or height_m (mounting height above the floor; ceiling by default). Or project settings (no ap): regulatory_domain eu|us|us-sp (us-sp = US 6 GHz standard power, 47 CFR 15.407(a)(4): 36 dBm EIRP, 23 dBm/MHz, 5925-6425 and 6525-6875 MHz only, AFC assumed to grant everything — AFC itself is not simulated), propagation_env walls|office|residential, target_dbm, noise_dbm, coverage_pct, overlap_pct, client_height_m, stats_band b24|b5|b6|any, sinr_target_db. Returns the new settings and the Wi-Fi checker findings. Undoable.',
      inputSchema: {
        type: 'object',
        properties: {
          ap: { type: 'string' }, band: { type: 'string', enum: ['2.4', '5', '6'] }, on: { type: 'boolean' }, channel: { type: 'number' }, width_mhz: { type: 'number' },
          tx_dbm: { type: 'number' }, gain_dbi: { type: 'number' }, height_m: { type: 'number' },
          regulatory_domain: { type: 'string', enum: ['eu', 'us', 'us-sp'] }, propagation_env: { type: 'string', enum: ['walls', 'office', 'residential'] }, target_dbm: { type: 'number' }, noise_dbm: { type: 'number' },
          coverage_pct: { type: 'number' }, overlap_pct: { type: 'number' }, client_height_m: { type: 'number' }, stats_band: { type: 'string', enum: ['b24', 'b5', 'b6', 'any'] }, sinr_target_db: { type: 'number' }
        }
      },
      async run(a = {}) {
        const W = await netWs(), WF = await import('../net/wifi.js'), C = await import('../net/checks/wifi.js'), data = W.data();
        if (a.ap == null) {
          const cur = WF.wifiSettings(data), map = { regulatory_domain: 'reg', propagation_env: 'env', target_dbm: 'target', noise_dbm: 'noise', coverage_pct: 'cover', overlap_pct: 'cci', client_height_m: 'rxH', stats_band: 'band', sinr_target_db: 'sinr' };
          const ch = Object.fromEntries(Object.entries(map).filter(([k]) => a[k] !== undefined).map(([k, v]) => [v, a[k]]));
          if (!Object.keys(ch).length) fail('nothing to change: give ap + radio settings, or project settings');
          data.wifi = WF.cleanWifi({ ...cur, ...ch }); W.commit();
          return { settings: settingsOut(WF.wifiSettings(data)) };
        }
        const aps = a.ap === '*' ? WF.apsOf(data) : pickAps(WF, data, a.ap), b = BIN[a.band] || null;
        if (!aps.length) fail('no access point in the plan');
        const radio = ['on', 'channel', 'width_mhz', 'tx_dbm', 'gain_dbi'].some(k => a[k] !== undefined);
        if (radio && !b) fail('band "2.4", "5" or "6" is required for radio settings');
        const reg = WF.wifiSettings(data).reg;
        for (const x of aps) {
          const r = WF.radiosOf(x.d), spec = WF.radioSpec(x.d.type);
          if (b && !r[b]) fail(`${x.d.name} (${x.d.type}) has no ${a.band} GHz radio (6 GHz: type "ap6e")`);
          if (b) {
            if (a.on !== undefined) r[b].on = !!a.on;
            if (a.width_mhz !== undefined) { if (!spec[b].widths.includes(+a.width_mhz)) fail(`${x.d.name}: ${a.width_mhz} MHz not supported on ${a.band} GHz (${spec[b].widths.join(', ')})`); r[b].w = +a.width_mhz; }
            if (a.channel !== undefined) {
              const ok = WF.channels(b, reg, r[b].w), f = WF.radioFault(x.d.type, b, { ...r[b], ch: +a.channel }, reg);
              if (f || !WF.allowed(b, reg).includes(+a.channel)) fail(`${x.d.name}: channel ${a.channel} is not a valid ${r[b].w} MHz channel in domain ${reg} (e.g. ${ok.join(', ')})`);
              r[b].ch = +a.channel;
            } else if (a.width_mhz !== undefined) { const ok = WF.channels(b, reg, r[b].w); if (ok.length && !ok.includes(r[b].ch)) r[b].ch = ok[0]; }
            if (a.tx_dbm !== undefined) r[b].tx = +a.tx_dbm;
            if (a.gain_dbi !== undefined) r[b].gain = +a.gain_dbi;
          }
          x.d.p.radios = WF.cleanRadios(r, x.d.type);
          if (a.height_m !== undefined) { if (!x.d.loc) fail(`${x.d.name} is not placed on a floor plan`); x.d.loc.h = Math.max(0, Math.min(30, +a.height_m)); }
        }
        W.commit();
        const ids = new Set(aps.map(x => x.d.id)), set = WF.wifiSettings(W.data());
        const findings = C.issues(W.data(), null, { name: id => (W.data().devices.find(d => d.id === id) || {}).name || id }).filter(i => ids.has(i.id) || i.code === 'J1265' || i.code === 'J1266');
        return { access_points: WF.apsOf(W.data()).filter(x => ids.has(x.d.id)).map(x => ({ name: x.d.name, radios: x.r, h: x.d.loc ? x.d.loc.h : null })), settings: settingsOut(set), findings: findings.map(i => ({ code: i.code, text: i.text })) };
      }
    },
    {
      name: 'wifi_autochannel',
      description: 'Automatic channel plan: greedy colouring of the neighbour graph (access points that hear each other above the 802.11 signal-detect level, through the drawn walls and adjacent floors). 2.4 GHz uses only 1/6/11; 5 GHz uses the first channel of each allowed block at each radio\'s width; 6 GHz uses the preferred scanning channel (PSC) of each allowed block (regulatory domain of the project). band "2.4", "5", "6" or omitted for all. dry_run: true only returns the proposal. Undoable.',
      inputSchema: { type: 'object', properties: { band: { type: 'string', enum: ['2.4', '5', '6'] }, dry_run: { type: 'boolean' } } },
      async run({ band, dry_run } = {}) {
        const W = await netWs(), WF = await import('../net/wifi.js'), data = W.data(), set = WF.wifiSettings(data);
        if (!WF.apsOf(data).some(a => a.loc)) fail('no access point placed on a floor plan');
        const bands = BIN[band] ? [BIN[band]] : WF.BANDS;
        const ch = bands.flatMap(b => WF.autoChannels(data, b, set));
        const out = ch.map(c => ({ ap: data.devices.find(d => d.id === c.id).name, band: BOUT[c.band], from: c.from, to: c.ch, width_mhz: c.w }));
        if (!dry_run && ch.length) { WF.applyChannels(data, ch); W.commit(); }
        return { changes: out, applied: !dry_run && ch.length > 0 };
      }
    },
    {
      name: 'wifi_coverage',
      description: 'Wi-Fi coverage statistics: for each floor (or one floor by name/id), the % of the floor area (and of its area at or above the SINR target, default 25 dB) and of each room at or above the target RSSI (default the project target, -67 dBm), in band "2.4", "5", "6" or "any" (best band, default the project stats band). Rooms marked needs_wifi are those whose usage expects Wi-Fi; below the coverage goal they raise J1265. ' + MODEL,
      inputSchema: { type: 'object', properties: { floor: { type: 'string' }, band: { type: 'string', enum: ['2.4', '5', '6', 'any'] }, target_dbm: { type: 'number' } } },
      annotations: { readOnlyHint: true },
      async run({ floor, band, target_dbm } = {}) {
        const W = await netWs(), WF = await import('../net/wifi.js'), data = W.data(), set0 = WF.wifiSettings(data);
        const set = { ...set0, target: Number.isFinite(+target_dbm) && target_dbm !== null ? +target_dbm : set0.target }, b = BIN[band] || (band === 'any' ? 'any' : set.band);
        let floors = WF.siteCoverage(data, b, { set });
        if (floor != null) { const s = String(floor).toLowerCase(); floors = floors.filter(f => f.floor.id.toLowerCase() === s || String(f.floor.name).toLowerCase() === s); if (!floors.length) fail(`no floor "${floor}"`); }
        if (!floors.length) fail('the project has no floor plan (site) yet');
        return {
          band: b, target_dbm: set.target, coverage_goal_pct: set.cover,
          floors: floors.map(f => ({ building: f.building.name, floor: f.floor.name, floor_id: f.floor.id, floor_pct: r1(f.pct), floor_sinr_ok_pct: r1(f.sinrPct), rooms: f.rooms.map(x => ({ room: x.room.name || x.room.id, usage: x.room.usage, needs_wifi: x.needs, area_m2: r1(x.area), coverage_pct: r1(x.pct), ok: !x.needs || x.pct >= set.cover })) })),
          model: MODEL
        };
      }
    }
  ];
}
