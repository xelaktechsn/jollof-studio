// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérifications du plan réseau (partie wifi), fusionnées par src/net/issues.js (codes J12xx) et contrôles de TP
// fusionnés par src/net/labcheck.js. Modèle de couverture (simplifié) : src/net/wifi.js.
//   J1265 trou de couverture : une pièce qui attend du Wi-Fi (bureau, salle de classe, réunion, plateau…) a moins de
//   cover % de sa surface au-dessus du signal visé · J1266 recouvrement co-canal entre deux points d'accès du même étage
//   · J1267 canal 2,4 GHz hors de 1, 6 et 11 · J1268 puissance au-delà de la fiche du point d'accès (conduite, ou PIRE
//   en Europe) · J1269 point d'accès placé sur aucun plan alors que le projet a des plans · J1270 canal trop large
//   (40 MHz à 2,4 GHz, ou plus de voisins entendus que de canaux de cette largeur à 5 GHz) · J1271 canal interdit dans
//   le domaine réglementaire, largeur que la radio n'a pas, ou canal qui ne forme pas de canal de cette largeur
//   · J1272 point d'accès aux deux radios coupées. (Un point d'accès sans PoE : J1212, déjà vérifié.)
import { tl, dec } from '../../i18n/index.js';
import { NET } from '../limits.js';
import * as WF from '../wifi.js';

/** Niveau de chaque code : 'error' | 'warning'. */
export const CODES = { J1265: 'warning', J1266: 'warning', J1267: 'warning', J1268: 'error', J1269: 'warning', J1270: 'warning', J1271: 'error', J1272: 'warning' };
/** Sources de chaque code (clés de src/check/sources.js). */
export const SRC = {
  J1265: [...NET.WIFI_TARGET_DBM.src, 'itu1238_13', 'itu1238_10', 'itu2040_4'],
  J1266: ['merakiChannelPlanning', 'tplinkChannelFaq', 'ciscoVowlanSurvey'],
  J1267: NET.WIFI_CH24.src,
  J1268: ['tplinkEap225Radio', 'tplinkEap670'],
  J1269: ['ciscoVowlanSurvey', 'itu1238_13'],
  J1270: ['merakiChannelBonding', 'tplinkChannelFaq', 'extremeCca'],
  J1271: ['tplinkChannelFaq', 'tplinkEap225Radio', 'tplinkEap670'],
  J1272: ['tplinkEap225Radio']
};
const BN = { b24: dec('2,4') + ' GHz', b5: '5 GHz', b6: '6 GHz' };
const regName = reg => (reg === 'us' ? tl('États-Unis (FCC)') : reg === 'us-sp' ? tl('États-Unis, puissance standard (AFC supposée accordée)') : tl('Europe (CE)'));
const pct = v => Math.round(v);

/** Défauts de réglage d'un point d'accès (sans calcul de couverture) : [{ code, id, text }]. */
export function radioIssues(ap, set, name) {
  const out = [], { d, r } = ap, n = name(d.id);
  if (!WF.BANDS.some(b => WF.radio(r, b).on)) { out.push({ code: 'J1272', id: d.id, text: tl('{0} : toutes ses radios sont coupées, il ne diffuse aucun réseau Wi-Fi.', n) }); return out; }
  for (const b of WF.BANDS) {
    const x = WF.radio(r, b); if (!x.on) continue;
    const f = WF.radioFault(d.type, b, x, set.reg);
    if (f && f.why === 'width') out.push({ code: 'J1271', id: d.id, text: tl('{0} : largeur de {1} MHz à {2}, que sa radio n’a pas ({3} MHz).', n, x.w, BN[b], f.widths.join(', ')) });
    else if (f && f.why === 'reg') out.push({ code: 'J1271', id: d.id, text: tl('{0} : canal {1} à {2} interdit dans le domaine {3}.', n, x.ch, BN[b], regName(set.reg)) });
    else if (f && f.why === 'block') out.push({ code: 'J1271', id: d.id, text: tl('{0} : le canal {1} ne forme pas de canal de {2} MHz à {3}.', n, x.ch, x.w, BN[b]) });
    const p = WF.powerFault(d.type, b, x, set.reg);
    if (p && p.kind === 'tx') out.push({ code: 'J1268', id: d.id, text: tl('{0} : {1} dBm à {2}, au-delà des {3} dBm de sa fiche.', n, p.have, BN[b], p.max) });
    else if (p && p.kind === 'lpi' && set.reg === 'us-sp') out.push({ code: 'J1268', id: d.id, text: tl('{0} : PIRE de {1} dBm à 6 GHz (puissance + gain d’antenne), au-delà des {2} dBm permis à un point d’accès de puissance standard sur {3} MHz.', n, p.have, p.max, x.w) });
    else if (p && p.kind === 'lpi') out.push({ code: 'J1268', id: d.id, text: tl('{0} : PIRE de {1} dBm à 6 GHz (puissance + gain d’antenne), au-delà des {2} dBm permis à un point d’accès d’intérieur (LPI) en {3} sur {4} MHz.', n, p.have, p.max, regName(set.reg), x.w) });
    else if (p) out.push({ code: 'J1268', id: d.id, text: tl('{0} : PIRE de {1} dBm à {2} (puissance + gain d’antenne), au-delà des {3} dBm que sa fiche permet en Europe.', n, p.have, BN[b], p.max) });
    if (b === 'b24' && x.w === 40) out.push({ code: 'J1270', id: d.id, text: tl('{0} : canal de 40 MHz à 2,4 GHz, qui occupe presque toute la bande (un seul canal sans chevauchement).', n) });
    else if (b === 'b24' && !NET.WIFI_CH24.v.clear.includes(x.ch)) out.push({ code: 'J1267', id: d.id, text: tl('{0} : canal {1} à 2,4 GHz, qui chevauche les canaux voisins ; prenez 1, 6 ou 11.', n, x.ch) });
  }
  return out;
}

/** Étages à vérifier : ceux des bâtiments où au moins un point d'accès est placé. */
function wifiFloors(data) {
  const aps = WF.apsOf(data).filter(a => a.loc), bld = new Set();
  for (const a of aps) { const at = WF.findFloor(data, a.loc.floor); if (at) bld.add(at.building); }
  return WF.floorsOf(data).filter(x => bld.has(x.building));
}
/** Recouvrements co-canal de tout le projet (paires dédoublonnées) : [{ a, b, band, pct, kind }]. */
export function projectOverlaps(data, set = WF.wifiSettings(data), bands = WF.BANDS) {
  const seen = new Set(), out = [], used = bands.filter(b => WF.apsOf(data).some(a => WF.radio(a.r, b).on));
  for (const { floor } of wifiFloors(data)) for (const b of used) {
    const res = WF.coverage(data, floor.id, b, { set, step: WF.STAT_STEP }); if (!res || res.aps.filter(a => a.same).length < 2) continue;
    for (const o of WF.overlapsOf(res)) { const k = [o.a, o.b].sort().join('|') + b; if (!seen.has(k)) { seen.add(k); out.push(o); } }
  }
  return out;
}
/** Pièces à couvrir et leur couverture : [{ room, floor, pct }]. */
export function projectRooms(data, set = WF.wifiSettings(data)) {
  const out = [];
  for (const { floor } of wifiFloors(data)) for (const x of WF.roomsCoverage(data, floor.id, set.band, { set })) if (x.needs) out.push({ room: x.room, floor, pct: x.pct });
  return out;
}

/** data : plan propre (clean.js) ; lan : réseau simulé ; h : { name(id) }. Rend [{ code, id, text }]. */
export function issues(data0, lan, h) {
  const aps = WF.apsOf(data0); if (!aps.length) return [];
  // Couverture et recouvrements : un point d'accès éteint (sans PoE) n'émet rien ; ses réglages restent vérifiés.
  const data = WF.powered(data0, lan);
  const out = [], set = WF.wifiSettings(data), name = id => (h && h.name ? h.name(id) : id), plan = WF.hasPlan(data);
  for (const ap of aps) {
    out.push(...radioIssues(ap, set, name));
    if (plan && (!ap.loc || !WF.findFloor(data, ap.loc.floor))) out.push({ code: 'J1269', id: ap.d.id, text: tl('{0} n’est placé sur aucun plan d’étage : sa couverture ne peut pas être calculée.', name(ap.d.id)) });
  }
  if (!plan) return out;
  // 5 et 6 GHz : un canal large n'a de sens que s'il reste assez de canaux de cette largeur pour les voisins entendus.
  for (const b of ['b5', 'b6']) {
    const nb = WF.neighbours(data, b, set), deg = new Map();
    for (const e of nb.edges) { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); }
    for (const a of nb.aps) {
      const w = a.r[b].w, k = WF.clearCount(b, set.reg, w), n = deg.get(a.d.id) || 0;
      if (w > 20 && n >= k) out.push({ code: 'J1270', id: a.d.id, text: tl('{0} : canal de {1} MHz à {2} avec {3} voisin(s) entendu(s), pour {4} canal(aux) de cette largeur ; passez à une largeur plus étroite.', name(a.d.id), w, BN[b], n, k) });
    }
  }
  for (const o of projectOverlaps(data, set)) {
    const A = aps.find(x => x.d.id === o.a), B = aps.find(x => x.d.id === o.b);
    if (!A || !B) continue;
    out.push({ code: 'J1266', id: o.a, text: o.kind === 'adj'
      ? tl('{0} (canal {1}) et {2} (canal {3}) : canaux voisins qui se chevauchent à 2,4 GHz, cellules recouvertes sur {4} %.', name(o.a), A.r.b24.ch, name(o.b), B.r.b24.ch, pct(o.pct))
      : tl('{0} et {1} sur le canal {2} à {3} : leurs cellules se recouvrent sur {4} % (au-delà de {5} %).', name(o.a), name(o.b), A.r[o.band].ch, BN[o.band], pct(o.pct), set.cci) });
  }
  for (const x of projectRooms(data, set)) if (x.pct < set.cover) out.push({ code: 'J1265', id: x.room.id, text: tl('Pièce « {0} » ({1}) : {2} % de la surface reçoit au moins {3} dBm (objectif {4} %).', x.room.name || x.room.id, x.floor.name || x.floor.id, pct(x.pct), set.target, set.cover) });
  return out;
}

/** Contrôles de TP : { 'net-…': { check(c, env) → { ok, … }, text(c, r) → texte de l'échec } } ; env : voir labcheck.js. */
export const LAB = {
  // { type: 'net-wifi-cover', rooms?: ['Salle 1', …], floor?: nom ou id, min?: %, target?: dBm }
  //   les pièces (par défaut : toutes celles qui attendent du Wi-Fi) ont au moins min % de leur surface ≥ target.
  'net-wifi-cover': {
    check(c, env) {
      const raw = env.netData ? env.netData() : null; if (!raw) return { ok: false, why: 'none', rooms: [] };
      const data = WF.powered(raw, env.lan ? env.lan() : null);
      const set0 = WF.wifiSettings(data), set = { ...set0, target: Number.isFinite(+c.target) ? +c.target : set0.target }, min = Number.isFinite(+c.min) ? +c.min : set0.cover;
      const low = s => String(s ?? '').trim().toLowerCase(), want = Array.isArray(c.rooms) ? new Set(c.rooms.map(low)) : null;
      const rooms = [];
      for (const { floor } of WF.floorsOf(data)) {
        if (c.floor != null && low(floor.name) !== low(c.floor) && low(floor.id) !== low(c.floor)) continue;
        for (const x of WF.roomsCoverage(data, floor.id, set.band, { set })) {
          if (want ? !(want.has(low(x.room.name)) || want.has(low(x.room.id))) : !x.needs) continue;
          rooms.push({ name: x.room.name || x.room.id, pct: Math.round(x.pct) });
        }
      }
      if (!rooms.length) return { ok: false, why: 'none', rooms };
      const bad = rooms.filter(r => r.pct < min);
      return { ok: !bad.length, why: bad.length ? 'cover' : null, bad, rooms, min, target: set.target };
    },
    text(c, r) {
      if (r.why === 'none') return tl('Aucune pièce à couvrir sur le plan.');
      return tl('Couverture insuffisante (au moins {0} % de la surface à {1} dBm) : {2}.', r.min, r.target, r.bad.map(b => `${b.name} ${b.pct} %`).join(', '));
    }
  },
  // { type: 'net-wifi-chan', band?: 'b24' | 'b5', min?: n points d'accès placés }
  //   aucun recouvrement co-canal, aucun canal hors de 1/6/11, aucun canal interdit ou trop large pour la radio.
  'net-wifi-chan': {
    check(c, env) {
      const raw = env.netData ? env.netData() : null; if (!raw) return { ok: false, why: 'noap' };
      const data = WF.powered(raw, env.lan ? env.lan() : null);
      const set = WF.wifiSettings(data), aps = WF.apsOf(data).filter(a => a.loc && WF.findFloor(data, a.loc.floor));
      if (aps.length < (c.min ?? 1)) return { ok: false, why: 'noap', n: aps.length };
      const name = id => { const d = data.devices.find(x => x.id === id); return d ? d.name || id : id; };
      const bands = c.band === 'b24' || c.band === 'b5' ? [c.band] : WF.BANDS;
      const chan = aps.flatMap(a => radioIssues(a, set, name)).filter(i => i.code === 'J1267' || i.code === 'J1271');
      if (chan.length) return { ok: false, why: 'chan', text: chan[0].text };
      const ov = projectOverlaps(data, set, bands);
      if (ov.length) return { ok: false, why: 'overlap', a: name(ov[0].a), b: name(ov[0].b), band: ov[0].band, pct: Math.round(ov[0].pct) };
      return { ok: true };
    },
    text(c, r) {
      if (r.why === 'noap') return tl('Aucun point d’accès placé sur un plan d’étage.');
      if (r.why === 'chan') return r.text;
      return tl('{0} et {1} se recouvrent sur le même canal à {2} ({3} %).', r.a, r.b, BN[r.band], r.pct);
    }
  }
};
