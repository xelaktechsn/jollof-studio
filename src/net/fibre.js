// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fibre optique : types de fibre, modules SFP/SFP+/SFP28, canal optique et bilan (perte de la liaison face à ce que les
// modules tolèrent). Fonctions pures : la simulation (lan.js) les appelle pour chaque lien, le vérificateur
// (checks/fibre.js), la calculette de bilan (ui/fibreui.js), les TP et l'IA aussi. Les chiffres et leurs sources sont dans
// lim/fibre.js.
//
// Champs « support » d'un câble fibre (cleanMedia) : { media: 'fibre', fibre: 'om1'…'om5'|'os1'|'os2', splices: n (épissures),
//   attn?: dB (atténuateur fixe), mcp?: true (cordon de conditionnement de mode, pour un module 1000BASE-LX sur multimode) }.
//   Un câble cuivre n'a aucun de ces champs ; `len` est en mètres (jusqu'à 100 km).
//
// Modèle simplifié, dit comme tel à l'écran :
//   - perte = longueur × affaiblissement maximal du câble à la longueur d'onde du module + connexions × 0,75 dB + épissures
//     × 0,3 dB + atténuateurs (valeurs maximales de la TIA-568, lues via FOA et Fluke) ;
//   - connexions comptées : une par traversée passive (panneau, tiroir optique), comme le modèle de câblage de l'IEEE 802.3
//     (deux panneaux = 1,5 dB) ; les deux connexions aux modules font partie des spécifications des modules ;
//   - ce que la liaison tolère : la perte maximale du canal de l'IEEE 802.3 pour ce type de fibre quand elle existe (FOA,
//     Fluke), sinon le bilan de puissance du module (émission minimale - sensibilité, fiche Cisco). L'IEEE donne la perte
//     à la portée maximale : un canal plus court tolère en vrai un peu plus de connexions, le modèle ne le compte pas ;
//   - les deux bouts doivent porter le même module (même norme) ; un module 1G marche dans une cage SFP+, pas l'inverse ;
//   - 1000BASE-LX sur multimode : seulement avec un cordon de conditionnement de mode (fiche Cisco, quel que soit la longueur).
import { NET } from './limits.js';
import { tl, dec } from '../i18n/index.js';

const L = k => NET[k].v;
const r2 = x => Math.round(x * 100) / 100;

/** Types de fibre : { name, mode 'mmf'|'smf', core (µm), att { nm: dB/km } }. */
export const FIBRE_TYPES = {
  om1: { name: 'OM1 62,5/125', mode: 'mmf', core: 62.5, att: L('FIBRE_ATT_MM').om1 },
  om2: { name: 'OM2 50/125', mode: 'mmf', core: 50, att: L('FIBRE_ATT_MM').om2 },
  om3: { name: 'OM3 50/125', mode: 'mmf', core: 50, att: L('FIBRE_ATT_MM').om3 },
  om4: { name: 'OM4 50/125', mode: 'mmf', core: 50, att: L('FIBRE_ATT_MM').om4 },
  om5: { name: 'OM5 50/125', mode: 'mmf', core: 50, att: L('FIBRE_ATT_MM').om5 },
  os1: { name: 'OS1 9/125', mode: 'smf', core: 9, att: L('FIBRE_ATT_SM').os1 },
  os2: { name: 'OS2 9/125', mode: 'smf', core: 9, att: L('FIBRE_ATT_SM').os2 }
};
export const FIBRE_IDS = Object.keys(FIBRE_TYPES);

const MOD_KEYS = {
  '1000BASE-SX': 'FIBRE_MOD_1000SX', '1000BASE-LX': 'FIBRE_MOD_1000LX', '1000BASE-EX': 'FIBRE_MOD_1000EX', '1000BASE-ZX': 'FIBRE_MOD_1000ZX',
  '1000BASE-T': 'FIBRE_MOD_1000T', '10GBASE-SR': 'FIBRE_MOD_10GSR', '10GBASE-LR': 'FIBRE_MOD_10GLR', '10GBASE-ER': 'FIBRE_MOD_10GER',
  '10GBASE-ZR': 'FIBRE_MOD_10GZR', '10GBASE-T': 'FIBRE_MOD_10GT', '25GBASE-SR': 'FIBRE_MOD_25GSR', '25GBASE-LR': 'FIBRE_MOD_25GLR'
};
/**
 * Modules : { id: { name, speed, media, nm, form, reach { type: m }, chan? { type: dB }, budget (dB, bilan de puissance), tx?, rx?,
 * mcp?, ieee (norme IEEE 802.3 ou module constructeur), src (clés de sources) } }.
 */
export const MODULES = Object.fromEntries(Object.entries(MOD_KEYS).map(([id, k]) => {
  const m = NET[k].v, budget = m.tx && m.rx ? r2(m.tx[0] - m.rx[0]) : null;
  return [id, { name: id, ...m, budget, ieee: !/ZR|EX|ZX/.test(id), src: NET[k].src }];
}));
export const MODULE_IDS = Object.keys(MODULES);
/** Module désigné par son id (ou déjà l'objet) ; null si inconnu. */
export const moduleOf = m => (m && typeof m === 'object' ? (m.media ? m : null) : MODULES[String(m ?? '')] || null);
/** Le module m entre-t-il dans une cage 'sfp' | 'sfp+' ? */
export const cageFits = (cage, m) => { const x = moduleOf(m), ok = L('FIBRE_CAGE')[cage]; return !!(x && ok && ok.includes(x.form)); };
/** Modules qui entrent dans une cage (liste d'ids). */
export const modulesFor = cage => MODULE_IDS.filter(id => cageFits(cage, id));
/** Affaiblissement (dB/km) d'un type de fibre à une longueur d'onde (1310 nm d'un module = fenêtre 1300 nm du multimode). */
export function attOf(type, nm) {
  const t = FIBRE_TYPES[type]; return t ? t.att[windowOf(type, nm)] ?? null : null;
}
/** Fenêtre de longueur d'onde où l'affaiblissement d'un type de fibre est donné (850/1300 nm multimode, 1310/1550 monomode). */
export function windowOf(type, nm) {
  const t = FIBRE_TYPES[type]; if (!t) return nm;
  return t.mode === 'mmf' ? (nm >= 1200 ? 1300 : 850) : (nm >= 1450 ? 1550 : 1310);
}

/* ---------- Câble ---------- */
const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
/** Champs « support » d'un câble : fibre → { media, fibre, splices, attn?, mcp? } (bornés), cuivre → {}. */
export function cleanMedia(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const isFibre = c.media === 'fibre' || (c.media == null && FIBRE_TYPES[c.fibre]);
  if (!isFibre) return {};
  const o = { media: 'fibre', fibre: FIBRE_TYPES[c.fibre] ? c.fibre : 'om4', splices: num(c.splices, 0, 200, 0) | 0 };
  const attn = Math.round(num(c.attn, 0, 30, 0) * 10) / 10; if (attn) o.attn = attn;
  if (c.mcp === true) o.mcp = true;
  return o;
}
export const isFibre = c => !!(c && c.media === 'fibre');

/* ---------- Canal ---------- */
/**
 * Canal optique : cables dans l'ordre (de bout en bout), passes = traversées passives (chacune ajoute une connexion).
 * Rend { media 'fibre'|'copper'|'mixed', len, lens { type: m }, connectors (connexions comptées dans la perte), ends (2
 * connexions aux modules, dans leur spécification), splices, attn, mcp, fibre (type le plus long), types, mixed (plusieurs
 * types), modes ('mmf'|'smf'…) }.
 */
export function fibreChannel(cables, passes = 0) {
  const lens = {}, list = Array.isArray(cables) ? cables : [];
  let len = 0, splices = 0, attn = 0, mcp = false, fib = 0, cu = 0;
  for (const c of list) {
    const l = Math.max(0, +(c && c.len) || 0); len += l;
    if (isFibre(c)) {
      fib++; const t = FIBRE_TYPES[c.fibre] ? c.fibre : 'om4';
      lens[t] = (lens[t] || 0) + l; splices += Math.max(0, c.splices | 0); attn += Math.max(0, +c.attn || 0); if (c.mcp) mcp = true;
    } else cu++;
  }
  const types = Object.keys(lens), modes = [...new Set(types.map(t => FIBRE_TYPES[t].mode))];
  const fibre = types.sort((a, b) => lens[b] - lens[a])[0] || null;
  return {
    media: fib && cu ? 'mixed' : fib ? 'fibre' : 'copper', len: r2(len), lens, connectors: Math.max(0, passes | 0), ends: 2,
    splices, attn: r2(attn), mcp, fibre, types: Object.keys(lens), mixed: types.length > 1, modes
  };
}

/** Perte du canal à la longueur d'onde nm : { fibre (dB), conn, splice, attn, total }. */
export function channelLoss(ch, nm) {
  let fibre = 0;
  for (const [t, l] of Object.entries(ch.lens || {})) fibre += (l / 1000) * (attOf(t, nm) ?? 0);
  const conn = (ch.connectors || 0) * L('FIBRE_CONN_DB'), splice = (ch.splices || 0) * L('FIBRE_SPLICE_DB'), attn = ch.attn || 0;
  return { fibre: r2(fibre), conn: r2(conn), splice: r2(splice), attn: r2(attn), total: r2(fibre + conn + splice + attn) };
}

/**
 * Lien optique entre deux modules sur un canal : { up, speed, why: null|'nomodule'|'mismatch'|'media'|'fibretype'|'reach'|
 * 'budget', loss (dB), budget (perte tolérée, dB), margin (dB), reach (m), basis 'ieee'|'power' (d'où vient la perte tolérée),
 * overload (dB d'atténuation qui manquent : récepteur saturé, 0 sinon), errors, need ('mcp' : cordon de conditionnement),
 * nm, module }. Un module en cuivre (1000BASE-T, 10GBASE-T) sur un canal cuivre : sa portée seulement ; sur un canal cuivre,
 * null à un bout veut dire un port RJ45 ordinaire.
 */
export function fibreLink(ch, modA, modB) {
  const c = ch || fibreChannel([], 0), a = moduleOf(modA), b = moduleOf(modB);
  const out = (o = {}) => ({ up: false, speed: 0, why: null, loss: null, budget: null, margin: null, reach: null, basis: null, overload: 0, errors: false, need: null, nm: null, module: a ? a.name : b ? b.name : null, ...o });
  if (c.media === 'mixed') return out({ why: 'media' });
  if (c.media === 'copper') {
    // Canal cuivre : un module optique n'y a rien à faire ; un module cuivre se comporte comme un port RJ45 de sa vitesse.
    const ms = [a, b].filter(Boolean), raw = [modA, modB].filter(x => x != null && x !== '');
    if (raw.length > ms.length) return out({ why: 'nomodule' });
    if (ms.some(m => m.media !== 'copper')) return out({ why: 'media' });
    if (!ms.length) return out({ up: true, speed: 0 });
    const reach = Math.min(...ms.map(m => m.reach.copper)), speed = Math.min(...ms.map(m => m.speed));
    if (c.len > reach) return out({ why: 'reach', reach });
    return out({ up: true, speed, reach });
  }
  if (!a || !b) return out({ why: 'nomodule' });
  if (a.media === 'copper' || b.media === 'copper') return out({ why: 'media' });
  if (a.name !== b.name) return out({ why: 'mismatch' });
  const m = a, types = c.types && c.types.length ? c.types : [];
  if (!types.length) return out({ why: 'fibretype' });
  if (c.modes && c.modes.length > 1) return out({ why: 'fibretype' });
  for (const t of types) if (m.reach[t] == null) return out({ why: 'fibretype' });
  const mmfLx = m.mcp && FIBRE_TYPES[types[0]].mode === 'mmf';
  if (mmfLx && !c.mcp) return out({ why: 'fibretype', need: 'mcp' });
  const reach = Math.min(...types.map(t => m.reach[t]));
  const chan = types.map(t => (m.chan ? m.chan[t] : undefined)).filter(x => x != null);
  const budget = chan.length ? Math.min(...chan) : m.budget, basis = chan.length ? 'ieee' : 'power';
  const loss = channelLoss(c, m.nm).total, margin = r2(budget - loss);
  const base = { loss, budget, margin, reach, basis, nm: m.nm, speed: m.speed };
  if (c.len > reach) return out({ ...base, speed: 0, why: 'reach' });
  if (loss > budget + 1e-9) return out({ ...base, speed: 0, why: 'budget' });
  // Récepteur saturé : la perte doit être au moins émission maximale - surcharge du récepteur (FOA : ajouter un atténuateur).
  const minLoss = m.tx && m.rx ? m.tx[1] - m.rx[1] : 0, overload = minLoss > loss ? r2(minLoss - loss) : 0;
  return out({ ...base, up: true, overload, errors: overload > 0 });
}

/* ---------- Calculette ---------- */
const fmt = (x, d = 2) => (x == null ? '—' : dec(Number(x).toFixed(d).replace(/\.?0+$/, '') || '0'));
/**
 * Lignes du bilan optique (calculette, outil de l'IA) : [{ key, label, detail, db }] puis total, perte tolérée, marge.
 * ch : fibreChannel ; link : fibreLink (ou { module, nm }).
 */
export function budgetRows(ch, link) {
  const m = moduleOf(link && link.module), nm = (link && link.nm) || (m && m.nm) || 1310, rows = [];
  for (const [t, l] of Object.entries((ch && ch.lens) || {})) {
    const a = attOf(t, nm);
    rows.push({ key: 'fibre', label: tl('Fibre {0}', FIBRE_TYPES[t].name), detail: tl('{0} km × {1} dB/km à {2} nm', fmt(l / 1000, 3), fmt(a), windowOf(t, nm)), db: r2((l / 1000) * (a ?? 0)) });
  }
  const loss = channelLoss(ch || {}, nm);
  rows.push({ key: 'conn', label: tl('Connexions'), detail: tl('{0} × {1} dB', ch ? ch.connectors : 0, fmt(L('FIBRE_CONN_DB'))), db: loss.conn });
  rows.push({ key: 'splice', label: tl('Épissures'), detail: tl('{0} × {1} dB', ch ? ch.splices : 0, fmt(L('FIBRE_SPLICE_DB'))), db: loss.splice });
  if (loss.attn) rows.push({ key: 'attn', label: tl('Atténuateur'), detail: '', db: loss.attn });
  rows.push({ key: 'total', label: tl('Perte totale'), detail: '', db: loss.total });
  if (link && link.budget != null) {
    rows.push({ key: 'budget', label: link.basis === 'ieee' ? tl('Perte maximale du canal (IEEE 802.3)') : tl('Bilan de puissance du module'), detail: m ? m.name : '', db: link.budget });
    rows.push({ key: 'margin', label: tl('Marge'), detail: link.margin < L('FIBRE_MARGIN_DB') && link.basis === 'power' ? tl('moins des {0} dB conseillés', L('FIBRE_MARGIN_DB')) : '', db: r2(link.budget - loss.total) });
  }
  return rows;
}

/* ---------- Canaux d'un plan (sans la simulation) ---------- */
/**
 * Canal optique depuis le port (n, p) d'un plan propre, en traversant les ports passifs : { cables, passes, far: { n, p } | null }.
 * portOf(dev, pid) : port d'un équipement (devices.js), passé en paramètre pour garder ce fichier léger.
 */
export function walkChannel(data, byId, byPort, portOf, n, p) {
  const cables = [], seen = new Set();
  let cur = { n, p }, far = null;
  for (let guard = 0; guard < 16; guard++) {
    const c = byPort.get(cur.n + '|' + cur.p); if (!c || seen.has(c.id)) break;
    seen.add(c.id); cables.push(c);
    const other = c.a[0] === cur.n && c.a[1] === cur.p ? c.b : c.a, od = byId.get(other[0]);
    if (!od) break;
    const op = portOf(od, other[1]);
    if (op && op.passive) { cur = { n: other[0], p: op.passive }; continue; }
    far = { n: other[0], p: other[1] }; break;
  }
  return { cables, passes: Math.max(0, cables.length - 1), far };
}
/** Module posé dans la cage (n, p) : id ou null. */
export const moduleAt = (dev, pid) => { const s = dev && dev.p && dev.p.sfp; const v = s && typeof s === 'object' ? s[pid] : null; return v ? String(v) : null; };
