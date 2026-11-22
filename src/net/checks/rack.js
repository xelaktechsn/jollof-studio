// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérifications du plan réseau (partie rack), fusionnées par src/net/issues.js (codes J12xx) et contrôles de TP
// fusionnés par src/net/labcheck.js.
//   J1273 deux équipements sur les mêmes U · J1274 équipement hors de la hauteur de la baie · J1275 baie (ou tablette)
//   trop chargée · J1276 PDU surchargée · J1277 onduleur surchargé · J1278 autonomie sous l'objectif · J1279 équipement
//   plus profond que la baie · J1280 U libres sans obturateur (bonne pratique) · J1281 panneau sans passe-câbles (bonne
//   pratique) · J1282 chaleur au-delà de la limite de conception · J1283 équipement dans une baie d'un autre étage ·
//   J1284 place impossible (baie inconnue, type non montable, appareil de bureau sans tablette) · J1285 prises : pas de
//   PDU, ou plus d'appareils que de prises.
import { tl, isEn } from '../../i18n/index.js';
import { NET } from '../limits.js';
import { MOUNT, mountDev, rackIndex, occupancy, rackPower, cableManagers, blanksNeeded, spanOf, patchingSchedule } from '../rack.js';

/** Niveau de chaque code : 'error' | 'warning'. */
export const CODES = {
  J1273: 'error', J1274: 'error', J1275: 'error', J1276: 'error', J1277: 'error', J1278: 'warning', J1279: 'error',
  J1280: 'warning', J1281: 'warning', J1282: 'warning', J1283: 'warning', J1284: 'warning', J1285: 'warning'
};
const PDU_SRC = ['trippPdumv20hv', 'trippPdu1230'];
/** Sources de chaque code (clés de src/check/sources.js). */
export const SRC = {
  J1273: [...NET.RACK_U_MM.src], J1274: [...NET.RACK_U_MM.src, ...NET.RACK_PRESETS.src], J1275: [...NET.RACK_PRESETS.src, 'trippSrshelf2p1u'],
  J1276: PDU_SRC, J1277: ['eaton5pxG2Brochure'], J1278: ['eaton5pxG2Brochure'], J1279: ['sanwaEia', ...NET.RACK_PRESETS.src],
  J1280: [...NET.RACK_PRACTICE.src], J1281: [...NET.RACK_PRACTICE.src], J1282: [...NET.BTU_PER_W.src], J1283: [...NET.RACK_PRESETS.src],
  J1284: [...NET.RACK_MOUNT.src], J1285: PDU_SRC
};
const fmt = v => (Math.round(v * 10) / 10).toLocaleString(isEn ? 'en-US' : 'fr-FR');

/** data : plan propre (clean.js) ; lan : réseau simulé ; h : { name(id) }. Rend [{ code, id, text }]. */
export function issues(data, lan, h) {
  const out = [], racks = new Map((data.racks || []).map(r => [r.id, r])), idx = rackIndex(data);
  const name = id => (h && h.name ? h.name(id) : id), add = (code, id, text) => out.push({ code, id, text });
  for (const d of data.devices || []) {
    if (!d.rack) continue;
    if (!racks.has(d.rack.id)) add('J1284', d.id, tl('{0} est rangé dans une baie qui n’existe plus.', name(d.id)));
    else if (!mountDev(d)) add('J1284', d.id, tl('{0} ne se monte pas dans une baie 19 pouces.', name(d.id)));
  }
  for (const r of data.racks || []) {
    const devs = idx.get(r.id) || [], occ = occupancy(r, devs), pw = rackPower(r, devs, lan);
    for (const c of occ.collisions) add('J1273', c.b, tl('{0} et {1} occupent tous deux l’U {2} ({3}) de {4}.', name(c.a), name(c.b), c.u, c.face === 'rear' ? tl('à l’arrière') : tl('à l’avant'), r.name));
    for (const id of occ.outside) add('J1274', id, tl('{0} dépasse de {1} : la baie n’a que {2} U.', name(id), r.name, r.u));
    // Appareils de bureau : sur une tablette, juste au-dessus d'elle ; charge de chaque tablette.
    const shelves = devs.filter(d => d.type === 'shelf'), onShelf = new Map(shelves.map(s => [s.id, 0]));
    for (const d of devs) {
      const m = mountDev(d); if (!m || !m.shelf) continue;
      const s = shelves.find(x => { const t = spanOf(x); return t && t[1] === d.rack.u - 1; });
      if (!s) add('J1284', d.id, tl('{0} est un appareil de bureau : posez-le sur une tablette, juste au-dessus d’elle.', name(d.id)));
      else onShelf.set(s.id, onShelf.get(s.id) + (m.kg || 0));
    }
    for (const s of shelves) if (onShelf.get(s.id) > MOUNT.shelf.load) add('J1275', s.id, tl('{0} porte {1} kg, pour {2} kg au plus.', name(s.id), fmt(onShelf.get(s.id)), MOUNT.shelf.load));
    if (pw.kg > r.load) add('J1275', r.id, tl('{0} porte {1} kg d’équipements, pour {2} kg admis (charge statique).', r.name, fmt(pw.kg), r.load));
    for (const p of pw.pdus) {
      if (p.pct > 100) add('J1276', p.id, tl('{0} : {1} VA demandés pour {2} VA ({3} %).', name(p.id), fmt(p.va), fmt(p.capVA), Math.round(p.pct)));
      if (p.plugs > p.outlets) add('J1285', p.id, tl('{0} : {1} appareils à brancher pour {2} prises.', name(p.id), p.plugs, p.outlets));
    }
    if (!pw.pdus.length && pw.unplugged.length) add('J1285', r.id, tl('{0} : {1:# appareil alimenté|# appareils alimentés} mais aucune PDU pour les brancher.', r.name, pw.unplugged.length));
    for (const u of pw.ups) {
      if (u.pct > 100) add('J1277', u.id, tl('{0} : {1} W pour {2} W ({3} %) : il ne tiendra pas la charge.', name(u.id), fmt(u.w), u.capW, Math.round(u.pct)));
      else if (r.runtime > 0 && u.w > 0 && u.runtime < r.runtime) add('J1278', u.id, tl('{0} : environ {1} min d’autonomie à {2} W, pour {3} min visées.', name(u.id), fmt(u.runtime), fmt(u.w), r.runtime));
    }
    for (const d of devs) {
      const m = mountDev(d);
      if (m && m.u && m.depth != null && m.depth > r.depth) add('J1279', d.id, tl('{0} fait {1} mm de profondeur, la baie {2} n’offre que {3} mm entre rails.', name(d.id), fmt(m.depth), r.name, fmt(r.depth)));
    }
    const nb = blanksNeeded(r, devs, occ);
    if (nb) add('J1280', r.id, tl('{0} : {1} U libres en façade sans obturateur (l’air chaud revient vers l’avant).', r.name, nb));
    for (const id of cableManagers(r, devs).missing) add('J1281', id, tl('{0} n’a pas de passe-câbles 1U juste au-dessus ou au-dessous.', name(id)));
    if (pw.heatW > r.heat) add('J1282', r.id, tl('{0} dégage {1} W ({2} BTU/h), au-delà des {3} W prévus.', r.name, fmt(pw.heatW), pw.btu, r.heat));
    for (const d of devs) if (d.loc && d.loc.floor && r.floor && d.loc.floor !== r.floor) add('J1283', d.id, tl('{0} est placé sur un autre étage que sa baie {1}.', name(d.id), r.name));
  }
  return out;
}

/* ---------- Contrôles de TP ---------- */
const low = v => String(v ?? '').trim().toLowerCase();
const rackOf = (data, sel) => (data.racks || []).find(r => !sel || low(r.name) === low(sel) || r.id === sel) || null;
/** Équipements désignés : nom (sans la casse) ou type. */
const pick = (data, sel) => { const s = low(sel); const byName = (data.devices || []).filter(d => low(d.name) === s); return byName.length ? byName : (data.devices || []).filter(d => d.type === sel); };
const nameOf = (env, id) => { const d = (env.netData().devices || []).find(x => x.id === id); return d ? d.name : id; };
const lanOf = env => (env.lan ? env.lan() : null);

/**
 * Contrôles de TP :
 *   { type: 'net-rack', rack?: 'BAIE1', require?: [{ sel: 'switch48' | 'SW1', n?: 1 }] }   les équipements sont dans la
 *     baie, sans chevauchement, dans sa hauteur, sous sa charge, pas plus profonds qu'elle (J1273 J1274 J1275 J1279 J1284)
 *   { type: 'net-power', rack?, runtime?: min, ups?: true }   PDU et onduleur présents, ni surchargés ni prises
 *     manquantes (J1276 J1277 J1285), autonomie au moins égale à runtime (sinon celle visée par la baie)
 *   { type: 'net-patching', rack?, n?: 1, up?: true }   au moins n ports de panneau brassés vers un switch et reliés par
 *     leur lien permanent à une prise (up : avec un lien établi)
 */
export const LAB = {
  'net-rack': {
    check(c, env) {
      const data = env.netData(), r = rackOf(data, c.rack); if (!r) return { ok: false, why: 'norack' };
      const missing = [];
      for (const q of c.require || []) {
        const n = q.n ?? 1, got = pick(data, q.sel).filter(d => d.rack && d.rack.id === r.id).length;
        if (got < n) missing.push(`${q.sel}${n > 1 ? ' ×' + n : ''}`);
      }
      if (missing.length) return { ok: false, why: 'missing', missing, rack: r.name };
      const ids = new Set([r.id, ...data.devices.filter(d => d.rack && d.rack.id === r.id).map(d => d.id)]);
      const bad = issues(data, lanOf(env), { name: id => nameOf(env, id) }).filter(i => ['J1273', 'J1274', 'J1275', 'J1279', 'J1284'].includes(i.code) && ids.has(i.id));
      return bad.length ? { ok: false, why: 'issues', rack: r.name, issue: bad[0].text, code: bad[0].code } : { ok: true, rack: r.name };
    },
    text: (c, r) => (r.why === 'norack' ? (c.rack ? tl('Il n’y a pas de baie {0}.', c.rack) : tl('Il n’y a aucune baie dans le projet.')) : r.why === 'missing' ? tl('Il manque dans {0} : {1}.', r.rack, r.missing.join(', ')) : tl('{0} : {1}', r.code, r.issue))
  },
  'net-power': {
    check(c, env) {
      const data = env.netData(), r = rackOf(data, c.rack); if (!r) return { ok: false, why: 'norack' };
      const devs = data.devices.filter(d => d.rack && d.rack.id === r.id), pw = rackPower(r, devs, lanOf(env));
      if (!pw.pdus.length) return { ok: false, why: 'nopdu', rack: r.name };
      if (c.ups !== false && !pw.ups.length) return { ok: false, why: 'noups', rack: r.name };
      const ids = new Set([r.id, ...devs.map(d => d.id)]);
      const bad = issues(data, lanOf(env), { name: id => nameOf(env, id) }).filter(i => ['J1276', 'J1277', 'J1285'].includes(i.code) && ids.has(i.id));
      if (bad.length) return { ok: false, why: 'issues', issue: bad[0].text, code: bad[0].code };
      const want = c.runtime ?? r.runtime, low1 = pw.ups.find(u => u.runtime < want);
      if (low1) return { ok: false, why: 'runtime', got: low1.runtime, want };
      return { ok: true, w: pw.w };
    },
    text: (c, r) => (r.why === 'norack' ? tl('Il n’y a aucune baie dans le projet.') : r.why === 'nopdu' ? tl('{0} n’a pas de PDU.', r.rack) : r.why === 'noups' ? tl('{0} n’a pas d’onduleur.', r.rack) : r.why === 'runtime' ? tl('Autonomie de {0} min, il en faut {1}.', fmt(r.got), r.want) : tl('{0} : {1}', r.code, r.issue))
  },
  'net-patching': {
    check(c, env) {
      const data = env.netData(), r = rackOf(data, c.rack); if (!r) return { ok: false, why: 'norack' };
      const rows = patchingSchedule(data, lanOf(env), { rack: r.id }).filter(x => x.outletId && x.switchId && ['switch', 'router'].includes(x.switchRole) && (!c.up || x.up));
      const n = c.n ?? 1;
      return rows.length >= n ? { ok: true, n: rows.length } : { ok: false, why: 'few', got: rows.length, n };
    },
    text: (c, r) => (r.why === 'norack' ? tl('Il n’y a aucune baie dans le projet.') : tl('{0:# prise brassée|# prises brassées} jusqu’au switch, il en faut {1}.', r.got, r.n))
  }
};
