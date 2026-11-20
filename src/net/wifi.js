// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Wi-Fi du plan réseau : réglages radio des points d'accès, plan de canaux et carte de couverture d'un étage. Module pur
// (aucun DOM), testé dans src/net/wifi.test.mjs ; le calque du plan (ui/wifilayer.js), les vérifications (checks/wifi.js)
// et les outils de l'IA (src/ai/tools-net-wifi.js) s'en servent.
//
// MODÈLE SIMPLIFIÉ (affiché comme tel) :
//   signal reçu (dBm) = Ptx + Gant − PL(d) − Σ pertes des murs traversés
//   PL(d) = 20 log10 f − 28 + N log10 d        (UIT-R P.1238, f en MHz, d ≥ 1 m, distance 3D)
//   - environnement « walls » (défaut) : N = 20 (vue directe, grande salle) et chaque mur du plan compté un par un ;
//     « office » / « residential » : N du tableau 2 de P.1238-10, qui comprend déjà les murs (ils ne sont pas recomptés) ;
//   - mur : perte d'une dalle homogène à incidence normale (UIT-R P.2040, éq. 37a, 43b, 44, 59), matériau du tableau 3,
//     épaisseur du mur (t) ou épaisseur par défaut du matériau ; l'incidence oblique, la diffraction et les réflexions
//     sont ignorées ; une porte compte comme du bois ;
//   - étage voisin du même bâtiment : facteur de plancher Lf de P.1238 (n = 1), murs de l'autre étage ignorés ; les étages
//     plus éloignés sont ignorés ;
//   - bruit : plancher supposé (-92 dBm par défaut) ; SNR = signal − bruit ;
//   - SINR = signal du serveur / (bruit + Σ brouilleurs) : chaque autre point d'accès de la même bande compte au prorata du
//     spectre que son canal partage avec celui du serveur (hypothèse : pas de gabarit spectral ni de réjection du canal
//     adjacent) et tous émettent en même temps (pire cas, sans l'accès au canal de 802.11) ;
//   - 6 GHz : N des bureaux par le modèle général de P.1238-13 (tableau 2) ; perte d'un plancher extrapolée de la ligne
//     5,8 GHz (aucune valeur à 6 GHz) ; murs par P.2040 à 6185 MHz ; canaux et puissances des points d'accès d'intérieur
//     à faible puissance (LPI) d'Europe et des États-Unis, ou de puissance standard aux États-Unis (domaine 'us-sp' :
//     l'AFC, qui accorde canaux et puissance, n'est pas simulée : elle est supposée tout accorder).
// Réglages du projet : data.wifi = { reg: 'eu'|'us'|'us-sp', env, target (dBm), noise (dBm), snr, sinr (dB), cover (%), cci (%),
// rxH (m), band }.
// Réglages d'un point d'accès : d.p.radios = { b24: { on, ch, w, tx, gain }, b5: { … }, b6?: { … } } (tx : puissance
// conduite en dBm, sans le gain d'antenne ; w : largeur en MHz ; b6 seulement pour un point d'accès Wi-Fi 6E), hauteur de
// pose d.loc.h (plafond par défaut).
import { NET } from './limits.js';

const L = k => NET[k].v;
const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, +v)) : d);
export const BANDS = ['b24', 'b5', 'b6'];
export const BAND_NAME = { b24: '2,4 GHz', b5: '5 GHz', b6: '6 GHz' };
/** Bandes vues sur une carte : chacune, ou la meilleure des trois. */
export const VIEW_BANDS = [...BANDS, 'any'];
/** Radio coupée (bande absente d'un point d'accès). */
export const OFF = Object.freeze({ on: false, ch: 0, w: 20, tx: 0, gain: 0 });
/** Réglage d'une bande, ou OFF si le point d'accès ne l'a pas. */
export const radio = (r, b) => (r && r[b]) || OFF;
export const ENVS = ['walls', 'office', 'residential'];
/** Types d'équipements qui ont une radio Wi-Fi réglable. */
export const AP_TYPES = ['ap', 'ap6', 'ap6e'];
/** Réglages modifiables par l'utilisateur (pas des normes) : couverture voulue, recouvrement admis, hauteurs. */
export const DESIGN = { cover: 90, cci: 10, rxH: 1, apH: 2.7, maxCells: 25000 };
/** Épaisseur par défaut des matériaux (m), réglage modifiable : celle du mur (t) l'emporte. */
export const MAT_T = { concrete: 0.2, brick: 0.1, plasterboard: 0.025, wood: 0.04, glass: 0.006, ceiling: 0.015, chipboard: 0.019, plywood: 0.018, marble: 0.02, metal: 0.002 };
/** Matériau supposé pour un identifiant inconnu (affiché « matériau inconnu : brique de 10 cm supposée »), à son épaisseur par défaut. */
export const UNKNOWN_MAT = 'brick';
/** Perte plafonnée d'une paroi (dB) : borne de calcul, le métal bloque tout. */
export const WALL_CAP = 99;
// Identifiants de matériaux des plans (MATERIALS de site.js) et synonymes → classes du tableau 3 de P.2040. Pas de classe
// « parpaing » ni « pierre » dans P.2040 : comptés comme du béton plein (majorant) ; gaine d'ascenseur : béton.
const ALIAS = {
  concrete: 'concrete', beton: 'concrete', reinforced: 'concrete', block: 'concrete', parpaing: 'concrete', stone: 'concrete', pierre: 'concrete', elevator: 'concrete', ascenseur: 'concrete',
  brick: 'brick', brique: 'brick', plasterboard: 'plasterboard', drywall: 'plasterboard', plaster: 'plasterboard', placo: 'plasterboard', gypsum: 'plasterboard', partition: 'plasterboard', cloison: 'plasterboard',
  wood: 'wood', bois: 'wood', door: 'wood', porte: 'wood', glass: 'glass', verre: 'glass', window: 'glass', vitre: 'glass', glazing: 'glass',
  ceiling: 'ceiling', chipboard: 'chipboard', agglo: 'chipboard', plywood: 'plywood', marble: 'marble', marbre: 'marble', tile: 'marble',
  metal: 'metal', steel: 'metal', acier: 'metal'
};
/**
 * Épaisseur de matière d'un mur creux : une cloison en plaques de plâtre (drywall) compte deux plaques de 12,5 mm,
 * l'ossature et le vide ignorés (simplification).
 */
const SOLID = { drywall: t => Math.min(t, 0.025), plasterboard: t => Math.min(t, 0.025), placo: t => Math.min(t, 0.025), cloison: t => Math.min(t, 0.025), partition: t => Math.min(t, 0.025) };
/** Classe P.2040 d'un matériau du plan, ou null s'il est inconnu. */
export function matOf(id) {
  const s = String(id || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  if (ALIAS[s]) return ALIAS[s];
  for (const k of Object.keys(ALIAS)) if (k.length > 3 && s.startsWith(k)) return ALIAS[k];
  return null;
}

/* ---------- Réglages ---------- */
/** Réglages Wi-Fi du projet, bornés. */
export function cleanWifi(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    reg: ['us', 'us-sp'].includes(r.reg) ? r.reg : 'eu', env: ENVS.includes(r.env) ? r.env : 'walls',
    target: num(r.target, -90, -40, L('WIFI_TARGET_DBM')), noise: num(r.noise, -110, -70, L('WIFI_NOISE_DBM')), snr: num(r.snr, 0, 60, L('WIFI_SNR_DB')),
    // SINR visé : par défaut le même objectif que le SNR (25 dB, guides Cisco), modifiable.
    sinr: num(r.sinr, -10, 60, L('WIFI_SNR_DB')),
    cover: num(r.cover, 0, 100, DESIGN.cover), cci: num(r.cci, 0, 100, DESIGN.cci), rxH: num(r.rxH, 0, 3, DESIGN.rxH),
    band: VIEW_BANDS.includes(r.band) ? r.band : 'any'
  };
}
export const wifiSettings = data => cleanWifi(data && data.wifi);
/** Fiche radio d'un type de point d'accès (lim/wifi.js AP_RADIO), ou null. */
export const radioSpec = type => L('AP_RADIO')[type] || null;
/** Bandes qu'a la radio d'un type de point d'accès. */
export const bandsOf = type => BANDS.filter(b => (radioSpec(type) || radioSpec('ap'))[b]);
/**
 * Réglages radio par défaut (modifiables) : 2,4 GHz canal 1 / 20 MHz / 14 dBm, 5 GHz canal 36 / 40 MHz / 17 dBm,
 * 6 GHz canal 5 (PSC) / 80 MHz / 14 dBm.
 */
export function defaultRadios(type) {
  const s = radioSpec(type) || radioSpec('ap'), out = { b24: { on: true, ch: 1, w: 20, tx: 14, gain: s.b24.gain }, b5: { on: true, ch: 36, w: 40, tx: 17, gain: s.b5.gain } };
  if (s.b6) out.b6 = { on: true, ch: 5, w: 80, tx: 14, gain: s.b6.gain };
  return out;
}
/** Réglages radio d'un point d'accès, bornés (une puissance au-delà de la fiche reste : le vérificateur la signale). */
export function cleanRadios(raw, type) {
  const d = defaultRadios(type), r = raw && typeof raw === 'object' ? raw : {}, out = {};
  for (const b of bandsOf(type)) {
    const s = r[b] && typeof r[b] === 'object' ? r[b] : {}, def = d[b];
    const okCh = b === 'b24' ? c => c >= 1 && c <= 13 : b === 'b6' ? c => c >= 1 && c <= 233 && c % 4 === 1 : c => L('WIFI_CH5').us.includes(c);
    const ch = Math.round(num(s.ch, 0, 240, def.ch));
    out[b] = { on: s.on === undefined ? def.on : !!s.on, ch: okCh(ch) ? ch : def.ch, w: [20, 40, 80, 160].includes(+s.w) ? +s.w : def.w, tx: Math.round(num(s.tx, -10, 36, def.tx) * 2) / 2, gain: num(s.gain, 0, 20, def.gain) };
    if (b === 'b24' && out[b].w > 40) out[b].w = 20;
  }
  return out;
}
/** Réglages radio effectifs d'un équipement (ceux du fichier, sinon les défauts). */
export const radiosOf = d => (d && d.p && d.p.radios ? cleanRadios(d.p.radios, d.type) : defaultRadios(d && d.type));

/* ---------- Canaux ---------- */
/** Sous-bande 5 GHz d'un canal : 'u1' | 'u2a' | 'u2c' | 'u3' | null. */
export function subband(ch) { const t = L('WIFI_CH5'); for (const k of ['u1', 'u2a', 'u2c', 'u3']) if (t[k].includes(ch)) return k; return null; }
/** Bloc de canaux de 20 MHz qui forme le canal (ch, w) à 5 GHz : [premier, dernier] ou null. */
export function block5(ch, w) {
  if (w === 20) return L('WIFI_CH5').us.includes(ch) ? [ch, ch] : null;
  return (L('WIFI_BLOCKS')[w] || []).find(([a, b]) => ch >= a && ch <= b && (ch - a) % 4 === 0) || null;
}
/** Bloc de canaux de 20 MHz qui forme le canal (ch, w) à 6 GHz (blocs alignés sur le canal 1) : [premier, dernier] ou null. */
export function block6(ch, w) {
  if (!(ch >= 1 && ch <= 233 && ch % 4 === 1) || ![20, 40, 80, 160].includes(w)) return null;
  const n = w / 20, i = Math.floor((ch - 1) / 4 / n) * n, a = 1 + 4 * i, b = a + 4 * (n - 1);
  return b <= 233 ? [a, b] : null;
}
/** Tous les canaux de 20 MHz d'un bloc [premier, dernier] sont-ils dans la liste ok ? */
const blockIn = (bl, ok) => { for (let c = bl[0]; c <= bl[1]; c += 4) if (!ok.includes(c)) return false; return true; };
/** Le canal (ch, w) à 6 GHz est-il utilisable dans le domaine ? */
export const ok6 = (ch, w, reg) => { const bl = block6(ch, w); return !!bl && blockIn(bl, allowed('b6', reg)); };
/** Canal de balayage préféré (PSC, 6 GHz) ? */
export const isPsc = ch => L('WIFI_CH6').psc.includes(ch);
/**
 * Occupation d'un canal en MHz : [bas, haut]. 2,4 GHz : fréquences relatives (5 MHz par canal, 22 MHz de large ; en
 * 40 MHz le second canal est 4 canaux plus haut, ou plus bas au-delà du canal 7 : simplification). 5 GHz : 5000 + 5 × canal ;
 * 6 GHz : 5950 + 5 × canal.
 */
export function span(band, ch, w) {
  if (band === 'b6') { const bl = block6(ch, w) || [ch, ch]; return [5950 + 5 * bl[0] - 10, 5950 + 5 * bl[1] + 10]; }
  if (band === 'b24') {
    const t = L('WIFI_CH24'), f = t.step * ch, h = t.width / 2;
    if (w === 40) return ch <= 7 ? [f - h, f + 4 * t.step + h] : [f - 4 * t.step - h, f + h];
    return [f - h, f + h];
  }
  const bl = block5(ch, w) || [ch, ch];
  return [5000 + 5 * bl[0] - 10, 5000 + 5 * bl[1] + 10];
}
export const overlap = (a, b) => a[0] < b[1] && b[0] < a[1];
/** Canaux de 20 MHz autorisés dans le domaine réglementaire. */
export function allowed(band, reg) {
  const k = reg === 'eu' || !reg ? 'eu' : 'us';
  if (band === 'b24') return Array.from({ length: L('WIFI_CH24')[k] }, (_, i) => i + 1);
  if (band === 'b6') {
    const all = Array.from({ length: (L('WIFI_CH6')[k] - 1) / 4 + 1 }, (_, i) => 1 + 4 * i);
    // Puissance standard : canaux de 20 MHz entièrement dans 5925–6425 ou 6525–6875 MHz.
    return reg === 'us-sp' ? all.filter(c => L('WIFI_SP6').bands.some(([lo, hi]) => 5950 + 5 * c - 10 >= lo && 5950 + 5 * c + 10 <= hi)) : all;
  }
  return L('WIFI_CH5')[k];
}
/** Canaux primaires possibles pour une largeur (premier canal de chaque bloc entièrement autorisé). */
export function channels(band, reg, w = 20) {
  const ok = allowed(band, reg);
  if (band === 'b24') return w === 40 ? ok.filter(c => (c <= 7 ? ok.includes(c + 4) : ok.includes(c - 4))) : ok;
  if (w === 20) return ok;
  if (band === 'b6') {
    // Un canal par bloc entièrement autorisé : le canal de balayage préféré (PSC) qu'il contient, sinon son premier canal.
    const out = [];
    for (let a = 1; a <= 233; a += w / 5) { const bl = block6(a, w); if (!bl || !blockIn(bl, ok)) continue; let p = bl[0]; for (let c = bl[0]; c <= bl[1]; c += 4) if (isPsc(c)) { p = c; break; } out.push(p); }
    return out;
  }
  return (L('WIFI_BLOCKS')[w] || []).filter(([a, b]) => { for (let c = a; c <= b; c += 4) if (!ok.includes(c)) return false; return true; }).map(([a]) => a);
}
/** Canaux sans chevauchement disponibles pour une largeur (nombre de blocs ou 1/6/11). */
export function clearCount(band, reg, w) { return band === 'b24' ? (w === 40 ? 1 : L('WIFI_CH24').clear.length) : channels(band, reg, w).length; }
/**
 * Défaut d'un réglage de canal : null, 'reg' (canal interdit dans ce domaine), 'width' (largeur que la radio n'a pas),
 * 'block' (le canal ne forme pas de canal de cette largeur), 'power' (au-delà de la fiche : { max, kind: 'tx'|'eirp' }).
 */
export function radioFault(type, band, r, reg) {
  const spec = radioSpec(type); if (!spec) return null;
  const bs = spec[band]; if (!bs) return null;
  if (!bs.widths.includes(r.w)) return { why: 'width', widths: bs.widths };
  const ok = allowed(band, reg);
  if (band === 'b24') {
    if (!ok.includes(r.ch)) return { why: 'reg' };
    if (r.w === 40 && !channels('b24', reg, 40).includes(r.ch)) return { why: 'block' };
  } else if (band === 'b6') {
    const bl = block6(r.ch, r.w); if (!bl) return { why: 'block' };
    if (!blockIn(bl, ok)) return { why: 'reg' };
  } else {
    const bl = block5(r.ch, r.w); if (!bl) return { why: 'block' };
    for (let c = bl[0]; c <= bl[1]; c += 4) if (!ok.includes(c)) return { why: 'reg' };
  }
  return null;
}
/**
 * PIRE maximale d'un point d'accès à 6 GHz (dBm) : la plus petite de la PIRE maximale et de la densité × largeur
 * (LPI Europe : 23 dBm, 10 dBm/MHz ; LPI États-Unis : 30 dBm, 5 dBm/MHz ; puissance standard États-Unis : 36 dBm, 23 dBm/MHz).
 */
export function lpiMax(reg, w) { const l = reg === 'us-sp' ? L('WIFI_SP6') : L('WIFI_LPI')[reg === 'us' ? 'us' : 'eu']; return Math.round(Math.min(l.eirp, l.psd + 10 * Math.log10(w)) * 10) / 10; }
/**
 * Puissance au-delà de la fiche ou de la règle : null, ou { kind: 'tx' (conduite, fiche) | 'eirp' (PIRE de la fiche en
 * Europe) | 'lpi' (PIRE au-delà de la limite LPI à 6 GHz), max, have }.
 */
export function powerFault(type, band, r, reg) {
  const spec = radioSpec(type); if (!spec) return null;
  const bs = spec[band]; if (!bs) return null;
  if (r.tx > bs.tx) return { kind: 'tx', max: bs.tx, have: r.tx };
  if (band === 'b6') { const max = lpiMax(reg, r.w); return r.tx + r.gain > max ? { kind: 'lpi', max, have: r.tx + r.gain } : null; }
  if (reg === 'eu') {
    const max = band === 'b24' ? bs.eirp : bs.eirp && bs.eirp[subband(r.ch)];
    if (max && r.tx + r.gain > max) return { kind: 'eirp', max, have: r.tx + r.gain };
  }
  return null;
}

/* ---------- Site ---------- */
/** Étages du site : [{ building, floor }]. */
export function floorsOf(data) {
  const out = [], s = data && data.site;
  for (const b of (s && Array.isArray(s.buildings) ? s.buildings : [])) for (const f of Array.isArray(b.floors) ? b.floors : []) out.push({ building: b, floor: f });
  return out;
}
export const findFloor = (data, id) => floorsOf(data).find(x => x.floor.id === id) || null;
/** Le projet a-t-il un plan d'étage dessiné (murs ou pièces) ? */
export const hasPlan = data => floorsOf(data).some(({ floor: f }) => (f.walls && f.walls.length) || (f.rooms && f.rooms.length));
/**
 * Plan où les points d'accès éteints (pas de PoE, budget épuisé : lan.state().power) ont leurs radios coupées : un point
 * d'accès sans courant n'émet rien. lan absent : le plan tel quel.
 */
export function powered(data, lan) {
  let st = null; try { st = lan && lan.state ? lan.state() : null; } catch { st = null; }
  if (!st || !st.power || !data || !Array.isArray(data.devices)) return data;
  const off = new Set(data.devices.filter(d => AP_TYPES.includes(d.type) && st.power.has(d.id) && !st.power.get(d.id).on).map(d => d.id));
  if (!off.size) return data;
  return { ...data, devices: data.devices.map(d => (off.has(d.id) ? { ...d, p: { ...d.p, radios: Object.fromEntries(Object.entries(radiosOf(d)).map(([b, r]) => [b, { ...r, on: false }])) }, unpowered: true } : d)) };
}
/** Points d'accès du projet : [{ d, r (radios), loc }]. */
export const apsOf = data => ((data && data.devices) || []).filter(d => AP_TYPES.includes(d.type)).map(d => ({ d, r: radiosOf(d), loc: d.loc || null }));
const elev = f => num(f.elev, -1000, 10000, 0);
const apHeight = (loc, f) => (Number.isFinite(+loc.h) && +loc.h > 0 ? +loc.h : Number.isFinite(+f.ceil) && +f.ceil > 0 ? +f.ceil : DESIGN.apH);
/** Usages de pièce (USAGES de site.js) où le Wi-Fi est attendu : bureaux, plateaux, salles de classe, laboratoires, réunion, hall. */
export const WIFI_USAGES = ['office', 'open', 'classroom', 'lab', 'meeting', 'hall'];
export const needsWifi = room => !!room && WIFI_USAGES.includes(String(room.usage || '').toLowerCase());

/* ---------- Pertes ---------- */
// Nombres complexes réduits au strict nécessaire.
const C = (re, im) => ({ re, im });
const cm = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cd = (a, b) => { const d = b.re * b.re + b.im * b.im; return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const cs = (a, b) => C(a.re - b.re, a.im - b.im), ca = (a, b) => C(a.re + b.re, a.im + b.im);
const csqrt = a => { const r = Math.hypot(a.re, a.im); return C(Math.sqrt((r + a.re) / 2), (a.im < 0 ? -1 : 1) * Math.sqrt(Math.max(0, (r - a.re) / 2))); };
const cexp = a => { const e = Math.exp(a.re); return C(e * Math.cos(a.im), e * Math.sin(a.im)); };
const slabCache = new Map();
/**
 * Perte (dB) d'une paroi de matériau mat (classe P.2040), d'épaisseur t (m), à la fréquence fMHz : dalle homogène,
 * incidence normale. ε = a − j·17,98·σ/f (éq. 59), R' = (1 − √ε)/(1 + √ε) (éq. 37a à θ = 0), q = 2π t √ε / λ (éq. 44),
 * T = (1 − R'²) e^(−jq) / (1 − R'² e^(−2jq)) (éq. 43b) ; perte = −20 log10 |T|.
 */
export function slabLoss(mat, t, fMHz) {
  const k = mat + '|' + t + '|' + fMHz; if (slabCache.has(k)) return slabCache.get(k);
  const m = L('WIFI_MAT')[mat]; if (!m) return 0;
  const f = fMHz / 1000, sigma = m[1] * f ** m[2], er = C(m[0], -17.98 * sigma / f), n = csqrt(er), one = C(1, 0);
  const R = cd(cs(one, n), ca(one, n)), R2 = cm(R, R), lam = 0.299792458 / f, q = cm(C(2 * Math.PI * t / lam, 0), n);
  const T = cd(cm(cs(one, R2), cexp(cm(C(0, -1), q))), cs(one, cm(R2, cexp(cm(C(0, -2), q)))));
  const a = Math.hypot(T.re, T.im), db = a > 0 && Number.isFinite(a) ? Math.min(WALL_CAP, Math.max(0, -20 * Math.log10(a))) : WALL_CAP;
  slabCache.set(k, db);
  return db;
}
/** Perte d'un mur du plan dans une bande (matériau inconnu : brique de 10 cm supposée). */
export function wallLoss(wall, band) {
  const id = String((wall && wall.mat) || ''), mat = matOf(id) || UNKNOWN_MAT;
  let t = matOf(id) && Number.isFinite(+wall.t) && +wall.t > 0 ? Math.min(2, +wall.t) : MAT_T[mat];
  if (SOLID[id]) t = SOLID[id](t);
  return slabLoss(mat, t, L('WIFI_F')[band]);
}
/** Affaiblissement de propagation (dB) sur d mètres, UIT-R P.1238 : 20 log10 f − 28 + N log10 d (d ≥ 1 m). */
export function pathLoss(d, band, env = 'walls') {
  const f = L('WIFI_F')[band], N = (L('WIFI_N')[env] || L('WIFI_N').walls)[band];
  return 20 * Math.log10(f) - 28 + N * Math.log10(Math.max(1, d));
}
/** Perte d'un plancher (P.1238, Lf pour n = 1) ; l'environnement « walls » prend la valeur des bureaux. */
export const floorLoss = (band, env) => (L('WIFI_LF')[env === 'residential' ? 'residential' : 'office'])[band];

/* ---------- Scène d'un étage ---------- */
const BUCKET = 3; // côté des cases de la grille des murs (m)
/** Murs d'un étage prêts pour le lancer de rayons : tableaux plats (coordonnées, pertes par bande), portes, grille de cases. */
function wallGrid(floor) {
  const list = [], doors = Array.isArray(floor.doors) ? floor.doors : [];
  for (const w of Array.isArray(floor.walls) ? floor.walls : []) {
    if (!w || !Array.isArray(w.a) || !Array.isArray(w.b)) continue;
    const x1 = +w.a[0], y1 = +w.a[1], x2 = +w.b[0], y2 = +w.b[1]; if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    const len = Math.hypot(x2 - x1, y2 - y1); if (len < 1e-6) continue;
    // Portes : ouverture [début, fin] le long du mur (at : position du centre en mètres depuis a, w : largeur).
    const op = doors.filter(d => d && d.wall === w.id).map(d => { const c = num(d.at, 0, len, len / 2), hw = num(d.w, 0.3, 10, 0.9) / 2; return [(c - hw) / len, (c + hw) / len]; });
    list.push({ id: w.id, x1, y1, x2, y2, loss: BANDS.map(b => wallLoss(w, b)), op });
  }
  const m = list.length, wx = new Float64Array(m), wy = new Float64Array(m), ex = new Float64Array(m), ey = new Float64Array(m);
  const loss = Object.fromEntries(BANDS.map(b => [b, new Float64Array(m)])), op = list.map(w => (w.op.length ? w.op : null));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  list.forEach((w, i) => {
    wx[i] = w.x1; wy[i] = w.y1; ex[i] = w.x2 - w.x1; ey[i] = w.y2 - w.y1; BANDS.forEach((b, k) => { loss[b][i] = w.loss[k]; });
    x0 = Math.min(x0, w.x1, w.x2); y0 = Math.min(y0, w.y1, w.y2); x1 = Math.max(x1, w.x1, w.x2); y1 = Math.max(y1, w.y1, w.y2);
  });
  const door = Object.fromEntries(BANDS.map(b => [b, slabLoss('wood', MAT_T.wood, L('WIFI_F')[b])]));
  const g = { walls: list, m, wx, wy, ex, ey, loss, op, door, nx: 0, ny: 0, x0: 0, y0: 0, start: new Int32Array(1), idx: new Int32Array(0) };
  if (!m) return g;
  const nx = Math.max(1, Math.ceil((x1 - x0) / BUCKET) + 1), ny = Math.max(1, Math.ceil((y1 - y0) / BUCKET) + 1), cells = Array.from({ length: nx * ny }, () => []);
  // Cases traversées par chaque mur (parcours DDA du segment), rangées à plat (start[c] … start[c + 1]).
  list.forEach((w, i) => walkCells(w.x1, w.y1, w.x2, w.y2, x0, y0, nx, ny, c => { cells[c].push(i); }));
  const start = new Int32Array(nx * ny + 1); let k = 0;
  for (let c = 0; c < cells.length; c++) { start[c] = k; k += cells[c].length; } start[cells.length] = k;
  const idx = new Int32Array(k); k = 0; for (const cl of cells) for (const i of cl) idx[k++] = i;
  return Object.assign(g, { nx, ny, x0, y0, start, idx });
}
/** Parcourt les cases de la grille traversées par le segment (ax, ay) → (bx, by) ; f(index de case). */
function walkCells(ax, ay, bx, by, gx, gy, nx, ny, f) {
  let cx = Math.floor((ax - gx) / BUCKET), cy = Math.floor((ay - gy) / BUCKET);
  const ex = Math.floor((bx - gx) / BUCKET), ey = Math.floor((by - gy) / BUCKET);
  const dx = bx - ax, dy = by - ay, sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const tdx = dx ? Math.abs(BUCKET / dx) : Infinity, tdy = dy ? Math.abs(BUCKET / dy) : Infinity;
  let tx = dx ? ((sx > 0 ? (cx + 1) * BUCKET + gx - ax : ax - (cx * BUCKET + gx)) / Math.abs(dx)) : Infinity;
  let ty = dy ? ((sy > 0 ? (cy + 1) * BUCKET + gy - ay : ay - (cy * BUCKET + gy)) / Math.abs(dy)) : Infinity;
  for (let k = 0; k < 4096; k++) {
    if (cx >= 0 && cy >= 0 && cx < nx && cy < ny) f(cy * nx + cx);
    if (cx === ex && cy === ey) break;
    if (tx < ty) { if (tx > 1) break; tx += tdx; cx += sx; } else { if (ty > 1) break; ty += tdy; cy += sy; }
  }
}
/**
 * Somme des pertes des murs coupés par le segment (ax, ay) → (bx, by) dans une bande (même parcours DDA que walkCells,
 * écrit à plat : c'est la boucle la plus chaude du calcul). stamp/ray : un mur présent dans plusieurs cases compte une fois.
 */
function raySum(g, ax, ay, bx, by, band, stamp, ray) {
  const loss = g.loss[band], door = g.door[band], { wx, wy, ex, ey, op, start, idx, nx, ny } = g;
  const dx = bx - ax, dy = by - ay, sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  let cx = Math.floor((ax - g.x0) / BUCKET), cy = Math.floor((ay - g.y0) / BUCKET);
  const fx = Math.floor((bx - g.x0) / BUCKET), fy = Math.floor((by - g.y0) / BUCKET);
  const tdx = dx ? Math.abs(BUCKET / dx) : Infinity, tdy = dy ? Math.abs(BUCKET / dy) : Infinity;
  let tx = dx ? ((sx > 0 ? (cx + 1) * BUCKET + g.x0 - ax : ax - (cx * BUCKET + g.x0)) / Math.abs(dx)) : Infinity;
  let ty = dy ? ((sy > 0 ? (cy + 1) * BUCKET + g.y0 - ay : ay - (cy * BUCKET + g.y0)) / Math.abs(dy)) : Infinity;
  let sum = 0;
  for (let k = 0; k < 4096; k++) {
    if (cx >= 0 && cy >= 0 && cx < nx && cy < ny) {
      const c = cy * nx + cx;
      for (let p = start[c], e = start[c + 1]; p < e; p++) {
        const i = idx[p]; if (stamp[i] === ray) continue; stamp[i] = ray;
        const wex = ex[i], wey = ey[i], den = dx * wey - dy * wex; if (den > -1e-12 && den < 1e-12) continue;
        const qx = wx[i] - ax, qy = wy[i] - ay, t = (qx * wey - qy * wex) / den; if (t <= 1e-9 || t > 1) continue;
        const u = (qx * dy - qy * dx) / den; if (u < 0 || u > 1) continue;
        let l = loss[i]; const o = op[i];
        if (o) for (const s of o) if (u >= s[0] && u <= s[1]) { l = door; break; }
        sum += l;
      }
    }
    if (cx === fx && cy === fy) break;
    if (tx < ty) { if (tx > 1) break; tx += tdx; cx += sx; } else { if (ty > 1) break; ty += tdy; cy += sy; }
  }
  return sum;
}
const gridCache = new Map();
function wallGridOf(floor) {
  const key = floor.id + '|' + JSON.stringify([floor.walls || [], floor.doors || []]);
  let g = gridCache.get(key);
  if (!g) { g = wallGrid(floor); gridCache.set(key, g); if (gridCache.size > 64) gridCache.delete(gridCache.keys().next().value); }
  return g;
}
/** Points d'accès qui éclairent l'étage : ceux de l'étage, et ceux des étages voisins du même bâtiment (plancher Lf). */
export function sceneOf(data, floorId) {
  const at = findFloor(data, floorId); if (!at) return null;
  const { building, floor } = at, lvl = num(floor.level, -50, 200, 0);
  const near = new Map(building.floors.map(f => [f.id, f]));
  const aps = [];
  for (const { d, r, loc } of apsOf(data)) {
    if (!loc || !near.has(loc.floor)) continue;
    const f = near.get(loc.floor), dl = Math.abs(num(f.level, -50, 200, 0) - lvl);
    if (dl > 1) continue;
    aps.push({ id: d.id, name: d.name, type: d.type, x: +loc.x || 0, y: +loc.y || 0, z: elev(f) + apHeight(loc, f), same: f.id === floor.id, r, ...(d.unpowered ? { off: true } : {}) });
  }
  return { building, floor, aps, z0: elev(floor), grid: wallGridOf(floor) };
}
/** Étendue d'un étage (murs, pièces, points d'accès de l'étage), avec 1 m de marge : { x0, y0, x1, y1 } ou null. */
export function extentOf(floor, aps = []) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const w of floor.walls || []) if (w && w.a && w.b) { add(+w.a[0], +w.a[1]); add(+w.b[0], +w.b[1]); }
  for (const r of floor.rooms || []) for (const p of (r && r.poly) || []) add(+p[0], +p[1]);
  for (const a of aps) if (a.same) add(a.x, a.y);
  if (x0 === Infinity) return null;
  return { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 };
}
/** Pas de la grille : 0,5 à 1 m selon la surface (au plus DESIGN.maxCells cases). */
export const stepFor = (ext, maxCells = DESIGN.maxCells) => Math.min(1, Math.max(0.5, Math.ceil(Math.sqrt(((ext.x1 - ext.x0) * (ext.y1 - ext.y0)) / maxCells) * 10) / 10));

/* ---------- Carte de couverture ---------- */
const covCache = new Map();
/**
 * Carte d'un étage dans une bande ('b24' | 'b5' | 'b6') : grille { x0, y0, step, nx, ny } (centres des cases en x0 + (i + ½)·step),
 * et par case : best (dBm, -Infinity si rien), srv (index du point d'accès le plus fort, -1), cci (points d'accès sur un
 * canal qui chevauche celui du serveur, entendus au-dessus du seuil de détection), sinr (dB, voir en tête). rssi[k] : signal de chaque point
 * d'accès (Float32Array). aps : points d'accès (ordre des index). Résultat mis en cache tant que rien ne change.
 */
export function coverage(data, floorId, band, o = {}) {
  const sc = sceneOf(data, floorId); if (!sc) return null;
  const set = o.set || wifiSettings(data), ext = o.ext || extentOf(sc.floor, sc.aps); if (!ext) return null;
  const step = o.step || stepFor(ext, o.maxCells);
  const key = JSON.stringify([floorId, band, step, ext, set, sc.aps, sc.floor.walls || [], sc.floor.doors || []]);
  if (covCache.has(key)) return covCache.get(key);
  const nx = Math.max(1, Math.ceil((ext.x1 - ext.x0) / step)), ny = Math.max(1, Math.ceil((ext.y1 - ext.y0) / step)), n = nx * ny;
  const stamp = new Int32Array(sc.grid.m); let ray = 0;
  const N = (L('WIFI_N')[set.env] || L('WIFI_N').walls)[band] / 2, walls = set.env === 'walls' && sc.grid.m > 0;
  const rssi = sc.aps.map(ap => {
    const a = new Float32Array(n).fill(-Infinity), r = radio(ap.r, band); if (!r.on) return a;
    // Constantes du point d'accès : PIRE − (20 log10 f − 28) − plancher ; N log10 d = (N/2) log10 d².
    const k0 = r.tx + r.gain - pathLoss(1, band, set.env) - (ap.same ? 0 : floorLoss(band, set.env)), dz2 = (sc.z0 + set.rxH - ap.z) ** 2, wl = walls && ap.same;
    for (let j = 0; j < ny; j++) {
      const y = ext.y0 + (j + 0.5) * step, dy2 = (y - ap.y) ** 2 + dz2;
      for (let i = 0; i < nx; i++) {
        const x = ext.x0 + (i + 0.5) * step, d2 = (x - ap.x) ** 2 + dy2;
        a[j * nx + i] = k0 - (d2 > 1 ? N * Math.log10(d2) : 0) - (wl ? raySum(sc.grid, ap.x, ap.y, x, y, band, stamp, ++ray) : 0);
      }
    }
    return a;
  });
  const spans = sc.aps.map(ap => { const r = radio(ap.r, band); return r.on ? span(band, r.ch, r.w) : [0, 0]; });
  // Part du spectre de chaque brouilleur k qui tombe dans le canal du serveur s (hypothèse du SINR, voir en tête).
  const share = spans.map(a => spans.map(b => { const o = Math.min(a[1], b[1]) - Math.max(a[0], b[0]), wa = a[1] - a[0]; return o > 0 && wa > 0 ? o / wa : 0; }));
  const best = new Float32Array(n).fill(-Infinity), srv = new Int16Array(n).fill(-1), cci = new Uint8Array(n), sinr = new Float32Array(n).fill(-Infinity);
  // Brouilleurs plus de 20 dB sous le bruit négligés (moins de 1 % du bruit) : calcul plus court, même résultat à 0,05 dB près.
  const heard = set.noise + L('WIFI_SD_SNR_DB'), noiseMw = 10 ** (set.noise / 10), floorI = set.noise - 20, K = Math.LN10 / 10;
  for (let c = 0; c < n; c++) {
    let b = -Infinity, s = -1;
    for (let k = 0; k < rssi.length; k++) if (rssi[k][c] > b) { b = rssi[k][c]; s = k; }
    best[c] = b; srv[c] = s;
    if (s >= 0) {
      let m = 0, im = 0;
      for (let k = 0; k < rssi.length; k++) {
        if (k === s) continue;
        const v = rssi[k][c]; if (v < floorI) continue;
        const f = share[k][s]; if (!f) continue;
        if (v >= heard) m++;
        im += f * Math.exp(v * K);
      }
      cci[c] = Math.min(255, m); sinr[c] = b - 10 * Math.log10(noiseMw + im);
    }
  }
  const res = { floor: floorId, band, x0: ext.x0, y0: ext.y0, step, nx, ny, best, srv, cci, sinr, rssi, aps: sc.aps, spans, set };
  covCache.set(key, res); if (covCache.size > 32) covCache.delete(covCache.keys().next().value);
  return res;
}
/**
 * Meilleure des bandes, case par case (même grille) : best, srv (point d'accès), sinr, cci de la bande qui sert ; band
 * 'any'. La bande de 6 GHz n'est calculée que si un point d'accès de l'étage (ou voisin) l'a.
 */
export function coverageAny(data, floorId, o = {}) {
  const a = coverage(data, floorId, 'b24', o); if (!a) return null;
  // Même étendue, même pas : même grille (et même cache).
  const parts = { b24: a, b5: coverage(data, floorId, 'b5', { ...o, step: a.step }) };
  if (a.aps.some(x => radio(x.r, 'b6').on)) parts.b6 = coverage(data, floorId, 'b6', { ...o, step: a.step });
  const n = a.nx * a.ny, best = new Float32Array(n), srv = new Int16Array(n), sinr = new Float32Array(n), cci = new Uint8Array(n);
  const list = Object.values(parts);
  for (let c = 0; c < n; c++) {
    let p = list[0]; for (const q of list) if (q.best[c] > p.best[c]) p = q;
    best[c] = p.best[c]; srv[c] = p.srv[c]; sinr[c] = p.sinr[c]; cci[c] = p.cci[c];
  }
  return { ...a, band: 'any', best, srv, sinr, cci, parts };
}
/** Carte d'une bande ou de la meilleure des bandes. */
export const coverageOf = (data, floorId, band, o) => (band === 'any' ? coverageAny(data, floorId, o) : coverage(data, floorId, band, o));

/* ---------- Statistiques ---------- */
/** Point dans un polygone (règle pair-impair). */
export function inPoly(x, y, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
/** Cases d'une grille dans un polygone (hors de ses trous : cour, patio d'une pièce) : liste d'index. */
export function cellsIn(res, poly, holes) {
  const out = []; if (!Array.isArray(poly) || poly.length < 3) return out;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const i0 = Math.max(0, Math.floor((x0 - res.x0) / res.step)), i1 = Math.min(res.nx - 1, Math.ceil((x1 - res.x0) / res.step));
  const j0 = Math.max(0, Math.floor((y0 - res.y0) / res.step)), j1 = Math.min(res.ny - 1, Math.ceil((y1 - res.y0) / res.step));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = res.x0 + (i + 0.5) * res.step, y = res.y0 + (j + 0.5) * res.step; if (inPoly(x, y, poly) && !(holes || []).some(hh => inPoly(x, y, hh))) out.push(j * res.nx + i); }
  return out;
}
/** Part (%) des cases au-dessus du seuil, parmi cells (toutes les cases si absent). */
export function pctAbove(res, thr, cells, field = 'best') {
  let n = 0, ok = 0; const a = res[field];
  if (cells) for (const c of cells) { n++; if (a[c] >= thr) ok++; }
  else for (let c = 0; c < a.length; c++) { n++; if (a[c] >= thr) ok++; }
  return n ? (100 * ok) / n : 0;
}
/** Pas des statistiques (m) : le même partout (vérificateur, IA, légende), quel que soit celui de la carte affichée. */
export const STAT_STEP = 1;
/** Couverture des pièces d'un étage : [{ room, needs, pct, area (m²) }] (pct : part de la surface ≥ objectif). */
export function roomsCoverage(data, floorId, band, o = {}) {
  const at = findFloor(data, floorId); if (!at) return [];
  const set = o.set || wifiSettings(data), res = coverageOf(data, floorId, band || set.band, { step: STAT_STEP, ...o, set });
  return (at.floor.rooms || []).filter(r => r && Array.isArray(r.poly) && r.poly.length >= 3).map(room => {
    const cells = res ? cellsIn(res, room.poly, room.holes) : [];
    return { room, needs: needsWifi(room), pct: res && cells.length ? pctAbove(res, set.target, cells) : 0, area: cells.length * (res ? res.step * res.step : 0) };
  });
}
/** Part (%) de l'étage au-dessus du seuil : sur ses pièces dessinées (sans la marge autour du bâtiment), sinon toute la grille. */
export function floorPct(res, floor, thr, field = 'best') {
  const rooms = ((floor && floor.rooms) || []).filter(r => r && Array.isArray(r.poly) && r.poly.length >= 3);
  if (!rooms.length) return pctAbove(res, thr, null, field);
  const all = new Set(); for (const r of rooms) for (const c of cellsIn(res, r.poly, r.holes)) all.add(c);
  return pctAbove(res, thr, all.size ? all : null, field);
}
/** Couverture de tout le projet : [{ floor, building, pct (pièces de l'étage, ou étage entier), rooms: [...] }]. */
export function siteCoverage(data, band, o = {}) {
  const set = o.set || wifiSettings(data), b = band || set.band;
  return floorsOf(data).map(({ building, floor }) => {
    const res = coverageOf(data, floor.id, b, { step: STAT_STEP, ...o, set });
    return { building, floor, pct: res ? floorPct(res, floor, set.target) : 0, sinrPct: res ? floorPct(res, floor, set.sinr, 'sinr') : 0, rooms: roomsCoverage(data, floor.id, b, { ...o, set }) };
  });
}
/**
 * Recouvrements co-canal sur un étage, dans une bande : paires de points d'accès de l'étage sur des canaux qui se
 * chevauchent, dont les cellules (signal ≥ objectif) se recouvrent sur plus de set.cci % de la plus petite.
 * kind 'co' (même canal ou canaux larges qui se recoupent) | 'adj' (2,4 GHz : canaux voisins qui se chevauchent).
 */
export function overlapsOf(res) {
  const out = [], set = res.set, thr = set.target, n = res.best.length;
  const cnt = res.rssi.map(a => { let m = 0; for (let c = 0; c < n; c++) if (a[c] >= thr) m++; return m; });
  for (let i = 0; i < res.aps.length; i++) for (let j = i + 1; j < res.aps.length; j++) {
    const A = res.aps[i], B = res.aps[j];
    if (!A.same || !B.same || !radio(A.r, res.band).on || !radio(B.r, res.band).on || !overlap(res.spans[i], res.spans[j])) continue;
    const ra = res.rssi[i], rb = res.rssi[j]; let both = 0;
    for (let c = 0; c < n; c++) if (ra[c] >= thr && rb[c] >= thr) both++;
    const pct = Math.min(cnt[i], cnt[j]) ? (100 * both) / Math.min(cnt[i], cnt[j]) : 0;
    if (pct > set.cci) out.push({ a: A.id, b: B.id, band: res.band, pct, kind: res.band === 'b24' && A.r.b24.ch !== B.r.b24.ch ? 'adj' : 'co' });
  }
  return out;
}

/* ---------- Plan de canaux automatique ---------- */
/** Signal (dBm) du point d'accès a reçu par le point d'accès b (à leurs hauteurs), dans une bande. */
function apToAp(data, a, b, band, set) {
  const r = radio(a.r, band); if (!r.on) return -Infinity;
  const fa = findFloor(data, a.loc.floor), fb = findFloor(data, b.loc.floor); if (!fa || !fb || fa.building !== fb.building) return -Infinity;
  const dl = Math.abs(num(fa.floor.level, -50, 200, 0) - num(fb.floor.level, -50, 200, 0)); if (dl > 1) return -Infinity;
  const za = elev(fa.floor) + apHeight(a.loc, fa.floor), zb = elev(fb.floor) + apHeight(b.loc, fb.floor);
  let loss = pathLoss(Math.hypot(+a.loc.x - +b.loc.x, +a.loc.y - +b.loc.y, za - zb), band, set.env);
  if (dl) loss += floorLoss(band, set.env);
  else if (set.env === 'walls') { const g = wallGridOf(fa.floor); if (g.m) loss += raySum(g, +a.loc.x, +a.loc.y, +b.loc.x, +b.loc.y, band, new Int32Array(g.m), 1); }
  return r.tx + r.gain - loss;
}
/** Voisins radio : pour chaque paire de points d'accès placés, le signal le plus fort entre eux (dBm), s'il est entendu. */
export function neighbours(data, band, set = wifiSettings(data)) {
  const aps = apsOf(data).filter(a => a.loc && radio(a.r, band).on), heard = set.noise + L('WIFI_SD_SNR_DB'), edges = [];
  for (let i = 0; i < aps.length; i++) for (let j = i + 1; j < aps.length; j++) {
    const s = Math.max(apToAp(data, aps[i], aps[j], band, set), apToAp(data, aps[j], aps[i], band, set));
    if (s >= heard) edges.push({ a: aps[i].d.id, b: aps[j].d.id, dbm: s });
  }
  return { aps, edges };
}
/**
 * Plan de canaux automatique (coloration gloutonne du graphe des voisins) : les points d'accès les plus entourés
 * d'abord, chacun prend le canal (1/6/11 à 2,4 GHz ; premier canal de chaque bloc autorisé à 5 GHz, PSC du bloc à 6 GHz, à sa largeur) qui
 * minimise la puissance reçue des voisins déjà servis sur un canal qui chevauche ; à égalité, le moins utilisé.
 * Rend [{ id, band, from, ch }] (seulement les changements) ; rien n'est modifié.
 */
export function autoChannels(data, band, set = wifiSettings(data)) {
  const { aps, edges } = neighbours(data, band, set), adj = new Map(aps.map(a => [a.d.id, []]));
  for (const e of edges) { const w = 10 ** (e.dbm / 10); adj.get(e.a).push([e.b, w]); adj.get(e.b).push([e.a, w]); }
  const order = [...aps].sort((x, y) => adj.get(y.d.id).reduce((s, e) => s + e[1], 0) - adj.get(x.d.id).reduce((s, e) => s + e[1], 0) || (x.d.id < y.d.id ? -1 : 1));
  const got = new Map(), use = new Map(), out = [];
  for (const a of order) {
    const r = a.r[band], w = band === 'b24' ? 20 : (radioSpec(a.d.type) || radioSpec('ap'))[band].widths.includes(r.w) ? r.w : 20;
    let cands = band === 'b24' ? L('WIFI_CH24').clear.filter(c => allowed('b24', set.reg).includes(c)) : channels(band, set.reg, w);
    if (!cands.length) cands = [r.ch];
    let bestC = cands[0], bestCost = Infinity;
    for (const c of cands) {
      const sp = span(band, c, w);
      let cost = 0; for (const [nb, wt] of adj.get(a.d.id)) { const g = got.get(nb); if (g && overlap(sp, g)) cost += wt; }
      const tie = (use.get(c) || 0) * 1e-30;
      if (cost + tie < bestCost - 1e-40) { bestCost = cost + tie; bestC = c; }
    }
    got.set(a.d.id, span(band, bestC, w)); use.set(bestC, (use.get(bestC) || 0) + 1);
    if (bestC !== r.ch || w !== r.w) out.push({ id: a.d.id, band, from: r.ch, ch: bestC, w });
  }
  return out;
}
/** Applique des changements de canaux (autoChannels) au plan : rend le nombre de points d'accès modifiés. */
export function applyChannels(data, changes) {
  let n = 0;
  for (const c of changes) {
    const d = (data.devices || []).find(x => x.id === c.id); if (!d) continue;
    d.p.radios = radiosOf(d); d.p.radios[c.band].ch = c.ch; if (c.w) d.p.radios[c.band].w = c.w; n++;
  }
  return n;
}
