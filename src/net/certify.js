// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Certification des liens cuivre (testeur de certification SIMULÉ) : module pur, sans interface. Le testeur (ui/certui.js),
// le vérificateur (checks/cert.js), les TP et les outils de l'IA s'en servent tous.
//
// Ce qui est testé :
//   lien permanent ('pl') : le câble posé entre deux ports « mur » (dos du panneau de brassage, dos de la prise) ;
//   canal ('ch') : d'un port actif à l'autre, à travers cordons, panneaux et prises (les connexions des appareils exclues).
// Limites (lim/cert.js) : tableaux d'ANSI/TIA-568-C.2 (Cat 5e, Cat 6, Cat 6A ; canal et lien permanent) lus dans le guide
// de référence d'Anixter qui les recopie (la norme est payante). Entre deux fréquences du tableau, la limite est
// INTERPOLÉE (droite en log f ; log-log pour l'affaiblissement) : seule approximation des limites, dite à l'écran.
//
// Valeurs « mesurées » : un MODÈLE, pas une mesure. Affaiblissement : chaque câble (tableau du câble horizontal × longueur,
// cordons +50 %) plus ses connexions ; les autres paramètres valent la limite de la catégorie réelle du câble (la plus basse
// du lien) dans la configuration testée, plus la marge nominale d'un système de bonne qualité (CERT_MARGIN), un écart fixe
// par paire et une petite ondulation déterministe (même lien = mêmes courbes). Défauts :
// carte de câblage fausse → ÉCHEC ; paire séparée → diaphonie effondrée sur les paires mêlées (modèle simplifié) ;
// longueur au-delà de la limite (+10 % d'incertitude de NVP : marginal) → ÉCHEC ; câble de catégorie plus basse que la
// limite → ses propres courbes, prolongées au-delà de sa bande (extrapolation). Non modélisé : règles des 3 dB / 4 dB,
// diaphonie exogène, déséquilibre (TCL), résistance de boucle, température.
//
// Verdicts (ANSI/TIA-1152, IEC 61935-1, lus chez Fluke) : par paramètre PASS, PASS* (marge positive mais dans la précision
// du testeur), FAIL* (négative dans la précision), FAIL ; un FAIL ou un FAIL* rend tout le lien en échec.
//
// data.tests (cleanTests) : { at (date du dernier lot), band (précision du testeur simulé, dB : réglage), results: [{ link,
//   kind, cables, ends, limit, verdict, margin, param, pair, f, len, sig (empreinte du lien testé), at, label }] } ou null.
import { analyzeChain, CATS, WIRES, PIN_PAIRS } from './cable.js';
import { portOf, portsOf } from './devices.js';
import { NET } from './limits.js';
import { tl, isEn } from '../i18n/index.js';
import { cleanText } from '../sanitize.js';

const L = k => NET[k].v;
const lg = Math.log10, sqrt = Math.sqrt;
const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
const txt = (v, n) => cleanText(String(v ?? ''), n);

/** Catégorie → classe ISO. */
export const CLASS = { cat5e: 'D', cat6: 'E', cat6a: 'EA' };
/** Limites de test proposées : catégorie × configuration. */
export const LIMIT_IDS = ['cat5e-pl', 'cat5e-ch', 'cat6-pl', 'cat6-ch', 'cat6a-pl', 'cat6a-ch'];
/** Paires (broches) et combinaisons de paires. */
export const PAIRS = ['12', '36', '45', '78'];
export const COMBOS = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
export const comboName = i => PAIRS[COMBOS[i][0]] + '-' + PAIRS[COMBOS[i][1]];
/** Paramètres, dans l'ordre d'un rapport ; dB : marge en dB (sinon m ou ns). */
export const PARAMS = ['wiremap', 'length', 'delay', 'skew', 'il', 'next', 'psnext', 'acrf', 'psacrf', 'rl'];
export const DB_PARAMS = ['il', 'next', 'psnext', 'acrf', 'psacrf', 'rl'];
const PNAME = {
  wiremap: () => tl('Carte de câblage'), length: () => tl('Longueur'), delay: () => tl('Délai de propagation'), skew: () => tl('Décalage de délai'),
  il: () => tl('Affaiblissement (IL)'), next: () => 'NEXT', psnext: () => 'PS NEXT', acrf: () => 'ACR-F', psacrf: () => 'PS ACR-F', rl: () => tl('Réflexion (RL)')
};
export const paramName = p => (PNAME[p] ? PNAME[p]() : p);
/** Bande de précision du testeur simulé (dB), réglage par défaut : la vraie dépend de l'appareil et de la fréquence. */
export const BAND_DEFAULT = 1;
/** Points de fréquence d'un autotest (échelle log, 1 MHz à la fréquence maximale de la limite). */
export const N_POINTS = 32;

/** Limite : { id, cat, cfg, cls, fmax, name }, ou null. */
const infos = new Map();
export function limitInfo(id) {
  if (infos.has(id)) return infos.get(id);
  const [cat, cfg] = String(id || '').split('-');
  let o = null;
  if (CLASS[cat] && ['pl', 'ch'].includes(cfg)) { const cls = CLASS[cat]; o = { id: cat + '-' + cfg, cat, cfg, cls, fmax: L('CERT_FMAX')[cat], name: `${CATS[cat].name} ${cfg === 'pl' ? tl('lien permanent') : tl('canal')}` }; }
  if (typeof id === 'string' && id.length < 20) infos.set(id, o);
  return o;
}

/* ---------- Grille de fréquences ---------- */
const grids = new Map();
/** n fréquences (MHz) espacées en échelle log de 1 MHz à fmax compris : { f, lf (log10 f), rf (√f) }. */
export function freqGrid(fmax, n = 48) {
  const k = fmax + ':' + n; let g = grids.get(k);
  if (!g) {
    const f = Array.from({ length: n }, (_, i) => +(10 ** (lg(fmax) * i / (n - 1))).toPrecision(5)); f[n - 1] = fmax;
    g = { f, lf: f.map(x => lg(x)), rf: f.map(x => sqrt(x)) }; grids.set(k, g);
  }
  return g;
}

/* ---------- Limites (tableaux de lim/cert.js) ---------- */
/**
 * Valeur d'un tableau à la fréquence f : interpolation entre les deux fréquences voisines du tableau, droite en log f
 * (loglog : en log-log, pour l'affaiblissement qui croît comme une puissance de f). Au-delà du dernier point (catégorie
 * mesurée plus loin que sa bande : modèle seulement), prolongement de la dernière pente.
 */
export function tabAt(vals, f, loglog = false) {
  const F = L('CERT_F'), n = vals.length;
  let i = 0; while (i < n - 2 && f > F[i + 1]) i++;
  const x0 = lg(F[i]), x1 = lg(F[i + 1]), t = (lg(f) - x0) / (x1 - x0);
  if (loglog) { const y0 = lg(vals[i]), y1 = lg(vals[i + 1]); return 10 ** (y0 + t * (y1 - y0)); }
  return vals[i] + t * (vals[i + 1] - vals[i]);
}
const table = (cfg, param, cat) => L(cfg === 'pl' ? 'CERT_PL' : 'CERT_CH')[param][cat];
/** Valeur de la limite (catégorie cat, configuration cfg) à f : la même fonction sert au modèle de mesure. */
const shape = (cfg, param, cat, f) => tabAt(table(cfg, param, cat), f, param === 'il');
/** Affaiblissement du câble horizontal par 100 m (tableau du câble). */
const cableIL = (cat, f) => tabAt(L('CERT_CABLE_IL')[cat], f, true);

/** Limite d'un paramètre en dB à la fréquence f (MHz) pour la limite id. */
export function limitAt(param, id, f) {
  const li = limitInfo(id); if (!li || !DB_PARAMS.includes(param)) return NaN;
  return shape(li.cfg, param, li.cat, f);
}
/** Limites de tous les paramètres en dB sur une grille (mémorisées) : { il: [], next: [], … }. */
const limGrids = new Map();
export function limitCurves(id, n = 48) {
  const k = id + ':' + n; let o = limGrids.get(k);
  if (!o) { const li = limitInfo(id), g = freqGrid(li.fmax, n); o = {}; for (const p of DB_PARAMS) o[p] = g.f.map(f => limitAt(p, id, f)); limGrids.set(k, o); }
  return o;
}
/** Limites non fréquentielles : longueur (m), délai et décalage (ns). */
export function scalarLimits(id) {
  const li = limitInfo(id); if (!li) return null;
  return { length: li.cfg === 'pl' ? NET.PERMANENT_M.v : NET.CHANNEL_M.v, delay: L('CERT_DELAY_NS')[li.cfg], skew: L('CERT_SKEW_NS')[li.cfg] };
}

/* ---------- Liens du plan ---------- */
const isFibreCable = c => c && c.media === 'fibre';
const portSafe = (d, id) => { try { return d ? portOf(d, id) : null; } catch (e) { return null; } };
const rankOf = cat => (CATS[cat] || CATS.cat5e).rank;
const lowestCat = cables => cables.reduce((m, c) => (rankOf(c.cat) < rankOf(m) ? c.cat : m), 'cat6a');
/** Connexions de la configuration type (TIA-568-C.2, figures du canal et du lien permanent) : prise, point de consolidation,
 * un panneau (lien permanent) ou deux (canal, interconnexion croisée). */
const TOPO_CONNS = { pl: 3, ch: 4 };
/** Distance (m) d'une extrémité sous laquelle une connexion compte comme « proche » pour le NEXT (modèle). */
const NEAR_M = 20;

/**
 * Liens cuivre à certifier : liens permanents (câble entre deux ports « mur ») puis canaux (port actif ↔ port actif).
 * [{ id, kind: 'pl'|'ch', cables, segs, ends: [[dev, port], [dev, port]], len, cat, conns, near: [n0, n1], cords }]
 */
export function certLinks(data) {
  const devs = (data && data.devices) || [], cables = (data && data.cables) || [];
  const byId = new Map(devs.map(d => [d.id, d])), byPort = new Map();
  for (const c of cables) { if (!c || !c.a || !c.b) continue; byPort.set(c.a[0] + '|' + c.a[1], c); byPort.set(c.b[0] + '|' + c.b[1], c); }
  // Ports de chaque équipement, lus une fois (un panneau de 48 ports ne se reconstruit pas pour chaque câble).
  const pmap = new Map();
  const port = ([n, p]) => {
    let m = pmap.get(n);
    if (!m) { m = new Map(); const d = byId.get(n); if (d) { try { for (const x of portsOf(d)) m.set(x.id, x); } catch (e) { /* type inconnu */ } } pmap.set(n, m); }
    return m.get(p) || null;
  };
  const out = [];
  for (const c of cables) {
    if (!c || !c.a || !c.b || isFibreCable(c)) continue;
    const pa = port(c.a), pb = port(c.b);
    if (pa && pb && pa.punch && pb.punch) out.push({ id: 'pl:' + c.id, kind: 'pl', cables: [c], segs: [{ ...c.wire, flip: false }], ends: [c.a, c.b], len: +c.len || 0, cat: CATS[c.cat] ? c.cat : 'cat6', conns: 2, near: [1, 1], cords: [false] });
  }
  const seen = new Set();
  for (const c of cables) for (const start of c && c.a && c.b ? [c.a, c.b] : []) {
    const sp = port(start); if (!sp || sp.passive || sp.fibre) continue;
    const segs = [], chain = [], visited = new Set(), passAt = [];
    let cur = start, far = null, run = 0, ok = true;
    for (let guard = 0; guard < 16; guard++) {
      const cb = byPort.get(cur[0] + '|' + cur[1]); if (!cb || visited.has(cb.id) || isFibreCable(cb)) { ok = false; break; }
      visited.add(cb.id);
      const flip = !(cb.a[0] === cur[0] && cb.a[1] === cur[1]), other = flip ? cb.a : cb.b, op = port(other);
      segs.push({ ...cb.wire, flip }); chain.push(cb); run += +cb.len || 0;
      if (!op) { ok = false; break; }
      if (op.passive) { passAt.push(run); cur = [other[0], op.passive]; continue; }
      if (op.fibre) { ok = false; break; }
      far = other; break;
    }
    if (!ok || !far) continue;
    const key = [start.join('|'), far.join('|')].sort().join('#'); if (seen.has(key)) continue; seen.add(key);
    const len = chain.reduce((s, x) => s + (+x.len || 0), 0);
    const cords = chain.map(x => { const a = port(x.a), b = port(x.b); return !(a && b && a.punch && b.punch); });
    out.push({ id: 'ch:' + key, kind: 'ch', cables: chain, segs, ends: [start, far], len, cat: lowestCat(chain), conns: passAt.length, near: [passAt.filter(x => x <= NEAR_M).length, passAt.filter(x => len - x <= NEAR_M).length], cords });
  }
  return out;
}
/** Limite par défaut d'un lien : sa catégorie (la plus basse de ses câbles) dans sa configuration. */
export const defaultLimit = link => (link.cat || 'cat6') + '-' + link.kind;

/** Nom lisible d'un lien : « PB1 (3) ↔ PR3 (mur) ». */
export function linkLabel(data, link) {
  const byId = new Map(((data && data.devices) || []).map(d => [d.id, d]));
  const side = ([n, p]) => { const d = byId.get(n), pt = portSafe(d, p); return `${d ? d.name || d.id : n} (${pt ? pt.label || p : p})`; };
  return link.ends ? tl('{0} ↔ {1}', side(link.ends[0]), side(link.ends[1])) : link.id;
}

/* ---------- Empreinte (rapport périmé) ---------- */
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
/** Empreinte de ce qui décide du résultat : limite, câbles (catégorie, longueur, fiches), extrémités. */
export const sigOf = (link, limit) => fnv(JSON.stringify([limit, link.kind, link.ends, link.cables.map(c => [c.id, c.cat, Math.round((+c.len || 0) * 100), c.wire])]));

/* ---------- Modèle de mesure ---------- */
// Écarts fixes au-dessus de la marge nominale (dB) : la combinaison 36-45 est la plus faible (la paire 3-6 enjambe la
// paire 4-5 dans la fiche RJ45) ; facteurs de pas de torsade des paires (la plus longue électriquement : 1-2). Modèle.
const OFF_NEXT = [3, 4, 5, 0, 3.5, 2.5], OFF_ACRF = [2, 3, 2.5, 0, 1.5, 1], OFF_RL = [1.5, 0.5, 0, 1], OFF_PS = [2, 0.5, 0, 1.5];
const LAY = [1, 0.988, 0.976, 0.964];
const CAP_MEAS = 80, LN10_10 = Math.LN10 / 10, DB_LN = 10 / Math.LN10;
function rng(seed) { let a = parseInt(fnv(seed), 36) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Ondulation déterministe (dB) d'une courbe : quelques sinusoïdes en log f, ±amp. */
// Les sinusoïdes sont tabulées une fois par grille (sin(x + φ) = sin x cos φ + cos x sin φ) : une ondulation coûte 4 produits.
const WAVES = [2, 2.5, 3, 3.5, 4, 4.5, 5, 7, 8, 9, 10, 11, 12];
const basis = new Map();
function basisOf(g) {
  let b = basis.get(g); if (!b) { b = WAVES.map(k => [g.lf.map(lf => Math.sin(k * lf * 3.1)), g.lf.map(lf => Math.cos(k * lf * 3.1))]); basis.set(g, b); }
  return b;
}
function ripple(r, amp, B) {
  const a = B[Math.floor(r() * 7)], b = B[7 + Math.floor(r() * 6)], p1 = r() * 6.28, p2 = r() * 6.28;
  const ca = 0.7 * amp * Math.cos(p1), sa = 0.7 * amp * Math.sin(p1), cb = 0.3 * amp * Math.cos(p2), sb = 0.3 * amp * Math.sin(p2);
  return i => a[0][i] * ca + a[1][i] * sa + b[0][i] * cb + b[1][i] * sb;
}
/** Formes tabulées par grille (les mêmes pour tous les liens) : clé → tableau. */
const shapeCache = new Map();
const tab = (g, key, fn) => { const k = g.f.length + ':' + g.f[g.f.length - 1] + ':' + key; let t = shapeCache.get(k); if (!t) { t = g.f.map((f, i) => fn(f, g.lf[i], g.rf[i])); shapeCache.set(k, t); } return t; };
/** Diaphonie d'une paire séparée (modèle simplifié) : les deux paires partagent une paire torsadée, le couplage est énorme. */
const splitNext = lf => Math.max(4, 28 - 12 * lf);
const splitFext = lf => Math.max(3, 24 - 10 * lf);

/** Combinaisons de paires qui partagent une paire torsadée du câble à l'une des fiches (paire séparée). */
function sharedCombos(link) {
  const out = new Set();
  for (const seg of link.segs) for (const E of [seg.a, seg.b]) {
    if (!E || !Array.isArray(E.order)) continue;
    const tp = PIN_PAIRS.map(([p, q]) => new Set([E.order[p - 1], E.order[q - 1]].filter(w => WIRES[w]).map(w => WIRES[w].pair)));
    COMBOS.forEach(([i, j], ci) => { for (const x of tp[i]) if (tp[j].has(x)) out.add(ci); });
  }
  return out;
}
const status = (m, band) => (m >= band ? 'pass' : m >= 0 ? 'pass*' : m > -band ? 'fail*' : 'fail');
const RANK = { pass: 0, 'pass*': 1, 'fail*': 2, fail: 3 };
const worse = (a, b) => (RANK[b] > RANK[a] ? b : a);

/**
 * Autotest simulé d'un lien contre la limite limitId (par défaut : defaultLimit). o : { band (dB), curves (true : courbes
 * pour l'affichage), sig (empreinte déjà calculée) }. Rend { link, kind, limit, verdict, ok, margin (marge la plus faible des
 * paramètres en dB = headroom), param, pair, f, len, wiremap: { ok, kind, faults }, params: { nom: { st, margin, v?, lim?,
 * pair?, f? } }, curves?, sig, simulated: true }.
 */
export function certify(link, limitId, o = {}) {
  const id = limitInfo(limitId) ? limitInfo(limitId).id : defaultLimit(link), li = limitInfo(id);
  const band = num(o.band, 0, 5, BAND_DEFAULT), n = N_POINTS;
  const g = freqGrid(li.fmax, n), M = L('CERT_MARGIN');
  const mcat = CLASS[link.cat] ? link.cat : 'cat6', shared = sharedCombos(link);
  const an = link.segs.length ? analyzeChain(link.segs) : { kind: 'none', faults: [{ type: 'open', pins: [1, 2, 3, 4, 5, 6, 7, 8] }] };
  const wmOk = an.kind === 'straight' && !an.faults.length;
  // Un câble croisé est un câble valable pour un lien, mais pas pour la carte de câblage d'une installation (droit exigé).
  const faults = an.faults.slice();
  if (an.kind === 'crossover') faults.push({ type: 'crossed', pins: [1, 2, 3, 6] });
  if (an.kind === 'crossover-full') faults.push({ type: 'crossed', pins: [1, 2, 3, 4, 5, 6, 7, 8] });
  const sl = scalarLimits(id), params = {};
  params.wiremap = { st: wmOk ? 'pass' : 'fail', faults: faults.map(f => ({ type: f.type, pins: f.pins })) };
  // Longueur : la paire au délai le plus court ; marginal dans l'incertitude de NVP (+10 %).
  const len = link.len * LAY[3], tol = L('CERT_NVP_TOL');
  params.length = { v: +len.toFixed(1), lim: sl.length, margin: +(sl.length - len).toFixed(1), st: len <= sl.length ? 'pass' : len <= sl.length * (1 + tol) ? 'pass*' : 'fail' };
  const nsm = L('CERT_NS_PER_M'), delays = LAY.map(k => +(link.len * nsm * k).toFixed(1));
  const dmax = Math.max(...delays), skew = +(dmax - Math.min(...delays)).toFixed(1);
  params.delay = { v: delays, lim: sl.delay, margin: +(sl.delay - dmax).toFixed(1), st: dmax <= sl.delay ? 'pass' : 'fail' };
  params.skew = { v: skew, lim: sl.skew, margin: +(sl.skew - skew).toFixed(1), st: skew <= sl.skew ? 'pass' : 'fail' };

  // Courbes : limite et valeurs simulées sur la grille ; marges suivies au passage. Même grille partout (testeur,
  // vérificateur, TP) : même lien, même verdict.
  const conns = link.conns, cordLoss = L('CERT_CORD_LOSS'), dConn = L('CERT_IL_CONN')[mcat] * conns, kind = link.kind;
  const R = rng(link.id + '|' + id), B = basisOf(g), rip = amp => ripple(R, amp, B);
  const ripIL = PAIRS.map(() => rip(0.03)), ripN = COMBOS.map(() => [rip(0.6), rip(0.6)]), ripF = COMBOS.map(() => rip(0.5)), ripR = PAIRS.map(() => [rip(0.8), rip(0.8)]);
  const acrfGain = Math.min(20, -L('CERT_ACRF_LEN') * lg(Math.max(1, link.len) / 100)), rlLoss = Math.max(0, conns - TOPO_CONNS[kind]) * 0.7;
  const splitPair = PAIRS.map((_, k) => [...shared].some(ci => COMBOS[ci].includes(k)));
  const byPair = PAIRS.map((_, k) => COMBOS.map((c, ci) => (c.includes(k) ? ci : -1)).filter(x => x >= 0));
  // Affaiblissement : tableau du câble horizontal de chaque câble ; autres paramètres : limite de la catégorie la plus
  // basse du lien dans la configuration testée (modèle : la diaphonie d'un lien est celle de son maillon le plus faible).
  const cabs = link.cables.map((c, k) => { const cc = CLASS[c.cat] ? c.cat : 'cat6'; return [((+c.len || 0) / 100) * (link.cords[k] ? cordLoss : 1), tab(g, 'il' + cc, f => cableIL(cc, f))]; });
  const base = p => tab(g, kind + p + mcat, f => shape(kind, p, mcat, f));
  const nxB = base('next'), psB = base('psnext'), fxBase = base('acrf'), pfBase = base('psacrf'), rlBase = base('rl');
  const ripP = PAIRS.map(() => [rip(0.6), rip(0.6)]), ripPF = PAIRS.map(() => rip(0.5));
  const lim = limitCurves(id, n), curves = !!o.curves;
  const meas = curves ? { il: PAIRS.map(() => []), next: COMBOS.map(() => [[], []]), psnext: PAIRS.map(() => [[], []]), acrf: COMBOS.map(() => []), psacrf: PAIRS.map(() => []), rl: PAIRS.map(() => [[], []]) } : null;
  const W = {}; for (const p of DB_PARAMS) W[p] = { margin: Infinity };
  const upd = (p, m, v, li, pair, end, i) => { if (m < W[p].margin) W[p] = { margin: m, pair, end, f: g.f[i], v, lim: li }; };
  const nx = [new Array(6), new Array(6)], fx = new Array(6);
  for (let i = 0; i < n; i++) {
    const f = g.f[i], lf = g.lf[i], rf = g.rf[i];
    // Affaiblissement : chaque câble à sa catégorie (cordons +50 %), les connexions de la classe la plus basse.
    let il = 0; for (const [k, t] of cabs) il += k * t[i];
    for (let k = 0; k < 4; k++) {
      const v = (1 - M.il) * (il * LAY[k] + dConn * rf) * (1 + ripIL[k](i));
      upd('il', lim.il[i] - v, v, lim.il[i], PAIRS[k], null, i); if (curves) meas.il[k].push(v);
    }
    // NEXT aux deux bouts : câble de la classe la plus basse, connexions proches de ce bout.
    for (let e = 0; e < 2; e++) {
      const nb = nxB[i] + M.next;
      for (let ci = 0; ci < 6; ci++) {
        let v = Math.min(CAP_MEAS, nb + OFF_NEXT[ci] + ripN[ci][e](i));
        if (shared.has(ci)) v = Math.min(v, splitNext(lf) + ripN[ci][e](i) * 0.5);
        nx[e][ci] = v; upd('next', v - lim.next[i], v, lim.next[i], comboName(ci), e, i); if (curves) meas.next[ci][e].push(v);
      }
      for (let k = 0; k < 4; k++) {
        // Somme de puissance : forme de la limite + marge nominale ; une paire séparée l'effondre (somme des NEXT mesurés).
        let v = Math.min(CAP_MEAS, psB[i] + M.psnext + OFF_PS[k] + ripP[k][e](i));
        if (splitPair[k]) { let sum = 0; for (const ci of byPair[k]) sum += Math.exp(-nx[e][ci] * LN10_10); v = Math.min(v, -DB_LN * Math.log(sum)); }
        upd('psnext', v - lim.psnext[i], v, lim.psnext[i], PAIRS[k], e, i); if (curves) meas.psnext[k][e].push(v);
      }
    }
    // ACR-F : terme du câble amélioré pour une longueur plus courte (−10 log(L/100), segment 10GBASE-T d'IEEE 802.3an).
    const fb = fxBase[i] + M.acrf + acrfGain;
    for (let ci = 0; ci < 6; ci++) {
      let v = Math.min(CAP_MEAS, fb + OFF_ACRF[ci] + ripF[ci](i));
      if (shared.has(ci)) v = Math.min(v, splitFext(lf));
      fx[ci] = v; upd('acrf', v - lim.acrf[i], v, lim.acrf[i], comboName(ci), null, i); if (curves) meas.acrf[ci].push(v);
    }
    for (let k = 0; k < 4; k++) {
      let v = Math.min(CAP_MEAS, pfBase[i] + M.psacrf + acrfGain + OFF_PS[k] + ripPF[k](i));
      if (splitPair[k]) { let sum = 0; for (const ci of byPair[k]) sum += Math.exp(-fx[ci] * LN10_10); v = Math.min(v, -DB_LN * Math.log(sum)); }
      upd('psacrf', v - lim.psacrf[i], v, lim.psacrf[i], PAIRS[k], null, i); if (curves) meas.psacrf[k].push(v);
    }
    // Réflexion : une paire séparée perd 3 dB, chaque connexion au-delà de la configuration type 0,7 dB (modèle).
    const rb = rlBase[i] + M.rl - rlLoss;
    for (let k = 0; k < 4; k++) for (let e = 0; e < 2; e++) {
      const v = rb + OFF_RL[k] + ripR[k][e](i) - (splitPair[k] ? 3 : 0);
      upd('rl', v - lim.rl[i], v, lim.rl[i], PAIRS[k], e, i); if (curves) meas.rl[k][e].push(v);
    }
  }
  // Marges : la plus faible sur toutes les fréquences, paires et bouts.
  for (const p of DB_PARAMS) { const x = W[p]; params[p] = { st: status(+x.margin.toFixed(2), p === 'il' ? band / 4 : band), margin: +x.margin.toFixed(2), v: +x.v.toFixed(2), lim: +x.lim.toFixed(2), pair: x.pair, end: x.end, f: x.f }; }
  let verdict = 'pass';
  for (const p of PARAMS) verdict = worse(verdict, params[p].st);
  let w = DB_PARAMS.reduce((m, p) => (params[p].margin < m.margin ? { param: p, ...params[p] } : m), { margin: Infinity });
  if (!wmOk) w = { param: 'wiremap', margin: w.margin, pair: null, f: null };
  else if (params.length.st === 'fail' && RANK[params[w.param].st] < RANK.fail) w = { param: 'length', margin: w.margin, pair: null, f: null };
  const out = {
    link: link.id, kind: link.kind, limit: id, verdict, ok: verdict === 'pass' || verdict === 'pass*', margin: w.margin, param: w.param, pair: w.pair || null, f: w.f || null,
    len: +link.len.toFixed(1), wiremap: { ok: wmOk, kind: an.kind, faults: params.wiremap.faults, map: an.map || [] }, params, sig: o.sig || sigOf(link, id), simulated: true
  };
  if (curves) out.curves = { f: g.f, lim, meas };
  return out;
}

/* ---------- Résultats en cache (vérificateur : recalcul rapide) ---------- */
const cache = new Map();
/** certify() sans courbes, mémorisé par empreinte (un plan de 1500 liens se recalcule vite après un changement). */
export function certifyCached(link, limitId, o = {}) {
  const id = limitInfo(limitId) ? limitInfo(limitId).id : defaultLimit(link), sig = sigOf(link, id), k = sig + '|' + link.id + '|' + (o.band ?? BAND_DEFAULT);
  let r = cache.get(k);
  if (!r) { if (cache.size > 20000) cache.clear(); r = certify(link, id, { band: o.band, sig }); cache.set(k, r); }
  return r;
}

/* ---------- Rapport enregistré (data.tests) ---------- */
const VERDICTS = ['pass', 'pass*', 'fail*', 'fail'];
const MAX_RESULTS = 6000;
/** Rapport de tests nettoyé (fichier, IA) : { at, band, results } ou null. */
export function cleanTests(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const seen = new Set(), results = [];
  const pairOk = v => (typeof v === 'string' && /^[1-8]{2}(-[1-8]{2})?$/.test(v) ? v : null);
  for (const x of Array.isArray(raw.results) ? raw.results.slice(0, MAX_RESULTS) : []) {
    if (!x || typeof x !== 'object') continue;
    const link = txt(x.link, 200); if (!link || seen.has(link)) continue; seen.add(link);
    const end = e => (Array.isArray(e) ? [txt(e[0], 60), txt(e[1], 12)] : null);
    const o = {
      link, kind: x.kind === 'ch' ? 'ch' : 'pl', cables: (Array.isArray(x.cables) ? x.cables : []).slice(0, 16).map(c => txt(c, 40)).filter(Boolean),
      limit: limitInfo(x.limit) ? limitInfo(x.limit).id : 'cat6-pl', verdict: VERDICTS.includes(x.verdict) ? x.verdict : 'fail',
      margin: +num(x.margin, -99, 99, 0).toFixed(2), param: PARAMS.includes(x.param) ? x.param : 'wiremap', pair: pairOk(x.pair),
      f: x.f == null ? null : +num(x.f, 0, 1000, 0).toFixed(2), len: +num(x.len, 0, 100000, 0).toFixed(1), sig: txt(x.sig, 16), at: txt(x.at, 30), label: txt(x.label, 80)
    };
    const ends = Array.isArray(x.ends) ? x.ends.map(end).filter(Boolean).slice(0, 2) : [];
    if (ends.length === 2) o.ends = ends;
    results.push(o);
  }
  return { at: txt(raw.at, 30), band: +num(raw.band, 0, 5, BAND_DEFAULT).toFixed(2), results };
}
/** Ligne de rapport d'un résultat. */
export const resultRow = (res, link, label, at) => ({ link: res.link, kind: res.kind, cables: link.cables.map(c => c.id), ends: link.ends, limit: res.limit, verdict: res.verdict, margin: res.margin, param: res.param, pair: res.pair, f: res.f, len: res.len, sig: res.sig, at, label });
/** Ajoute (ou remplace) des résultats dans data.tests ; rend le rapport. L'appelant fait ctx.commit(). */
export function storeResults(data, rows, at = new Date().toISOString()) {
  const t = cleanTests(data.tests || { results: [] }) || { at: '', band: BAND_DEFAULT, results: [] };
  const by = new Map(t.results.map(x => [x.link, x]));
  for (const r of rows) by.set(r.link, r);
  data.tests = cleanTests({ ...t, at, results: [...by.values()] });
  return data.tests;
}
/**
 * État de chaque lien vis-à-vis du rapport : [{ link, stored (résultat enregistré ou null), stale (le lien a changé depuis le
 * test, ou n'existe plus) }] ; orphans : résultats dont le lien a disparu du plan.
 */
export function testState(data, links = certLinks(data)) {
  const t = data && data.tests, by = new Map(((t && t.results) || []).map(x => [x.link, x])), ids = new Set();
  const rows = links.map(l => { ids.add(l.id); const s = by.get(l.id) || null; return { link: l, stored: s, stale: !!s && s.sig !== sigOf(l, s.limit) }; });
  return { rows, orphans: [...by.values()].filter(x => !ids.has(x.link)) };
}

/* ---------- Export ---------- */
/** D'où viennent les limites (affiché par le testeur, l'onglet Tests et le rapport). */
export const limitsNote = () => tl('Limites : tableaux d’ANSI/TIA-568-C.2 (norme payante, recopiés par le guide des normes d’Anixter), interpolés entre les fréquences du tableau.');
/** Ce que sont les valeurs « mesurées ». */
export const modelNote = () => tl('Valeurs « mesurées » simulées par un modèle à partir du plan (catégorie, longueur, cordons, connexions, sertissage) : ce n’est pas une mesure.');
/** Nombre écrit à la française (virgule) ou à l'anglaise. */
export const fmtNum = (v, d = 1) => { const t = (+v).toFixed(d); return isEn ? t : t.replace('.', ','); };
export const verdictText = v => ({ pass: 'PASS', 'pass*': 'PASS*', 'fail*': 'FAIL*', fail: 'FAIL' }[v] || '—');
const csvCell = v => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
/**
 * Mode examen (src/net/exam.js) : ce que montre le testeur. Restent les mesures (valeurs, courbes), les limites choisies et
 * la carte de câblage brute (broche → broche d'arrivée) ; partent les jugements : PASS/FAIL, marges, paramètre le plus
 * faible, défauts nommés. Carte brute : « 1→1 2→2 3→× … » (× : aucune broche seule en face, ouvert ou court-circuit).
 */
export const rawWireMap = res => [1, 2, 3, 4, 5, 6, 7, 8].map(p => `${p}→${(res.wiremap.map || [])[p] ?? '×'}`).join(' ');
/** Tableau CSV des résultats (une ligne par lien). rows : [{ label, kind, limit, verdict, margin, param, pair, f, len, at, stale? }]. o.exam : sans jugement. */
export function testsCsv(rows, o = {}) {
  if (o.exam) {
    const head = [tl('Lien'), tl('Type'), tl('Limite'), tl('Longueur (m)'), tl('Date'), tl('À jour')];
    return [head, ...rows.map(r => [r.label, r.kind === 'pl' ? tl('lien permanent') : tl('canal'), limitInfo(r.limit) ? limitInfo(r.limit).name : r.limit, r.len, r.at || '', r.stale ? tl('non') : tl('oui')])].map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  const head = [tl('Lien'), tl('Type'), tl('Limite'), tl('Résultat'), tl('Marge (dB)'), tl('Paramètre le plus faible'), tl('Paire'), tl('Fréquence (MHz)'), tl('Longueur (m)'), tl('Date'), tl('À jour')];
  const lines = rows.map(r => [r.label, r.kind === 'pl' ? tl('lien permanent') : tl('canal'), limitInfo(r.limit) ? limitInfo(r.limit).name : r.limit, verdictText(r.verdict), r.margin, paramName(r.param), r.pair || '', r.f ?? '', r.len, r.at || '', r.stale ? tl('non') : tl('oui')]);
  return [head, ...lines].map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/* ---------- Graphique et rapport imprimable (texte SVG / HTML, sans DOM) ---------- */
const SERIES = { il: 'pair', next: 'combo', psnext: 'pair', acrf: 'combo', psacrf: 'pair', rl: 'pair' };
/** Couleurs du rapport imprimé (fond blanc) ; à l'écran, les classes ntCeS0…S5 suivent le thème. */
const PRINT = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#be123c'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Séries affichées d'un paramètre : une par paire (ou combinaison), le pire des deux bouts à chaque fréquence. */
export function seriesOf(res, param) {
  const c = res && res.curves; if (!c || !c.meas[param]) return [];
  return c.meas[param].map((s, i) => ({ name: SERIES[param] === 'combo' ? comboName(i) : PAIRS[i], v: Array.isArray(s[0]) ? s[0].map((x, k) => Math.min(x, s[1][k])) : s }));
}
const fmt = (v, d = 1) => (Number.isFinite(v) ? fmtNum(v, d) : '—');
/**
 * Graphique SVG d'un paramètre : limite (trait épais) et courbes simulées, fréquence en échelle log. o : { w, h, print
 * (couleurs fixes pour l'impression), only (indice de la série à mettre en avant) }.
 */
export function chartSvg(res, param, o = {}) {
  const c = res && res.curves; if (!c) return '';
  const W = o.w || 640, H = o.h || 300, pl = 46, pr = 14, pt = 12, pb = 34, S = seriesOf(res, param), lim = c.lim[param];
  const fmax = c.f[c.f.length - 1], X = f => pl + (lg(f) / lg(fmax)) * (W - pl - pr);
  let lo = Infinity, hi = -Infinity;
  for (const v of [lim, ...S.map(s => s.v)].flat()) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const step = hi - lo > 40 ? 10 : 5; lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step + (hi % step === 0 ? step : 0);
  const Y = v => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  const path = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${X(c.f[i]).toFixed(1)},${Y(Math.max(lo, Math.min(hi, v))).toFixed(1)}`).join('');
  const col = i => (o.print ? ` stroke="${PRINT[i % 6]}"` : '');
  let g = '';
  for (let v = lo; v <= hi + 1e-9; v += step) g += `<line class="ntCeGrid" x1="${pl}" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"${o.print ? ' stroke="#e5e7eb"' : ''}/><text class="ntCeTick" x="${pl - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end"${o.print ? ' fill="#555"' : ''}>${v}</text>`;
  for (const f of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].filter(x => x <= fmax)) g += `<line class="ntCeGrid" x1="${X(f).toFixed(1)}" x2="${X(f).toFixed(1)}" y1="${pt}" y2="${H - pb}"${o.print ? ' stroke="#e5e7eb"' : ''}/><text class="ntCeTick" x="${X(f).toFixed(1)}" y="${H - pb + 14}" text-anchor="middle"${o.print ? ' fill="#555"' : ''}>${f}</text>`;
  g += `<text class="ntCeTick" x="${W - pr}" y="${H - 4}" text-anchor="end"${o.print ? ' fill="#555"' : ''}>MHz</text><text class="ntCeTick" x="4" y="${pt + 8}"${o.print ? ' fill="#555"' : ''}>dB</text>`;
  const lines = S.map((s, i) => `<path class="ntCeS ntCeS${i}${o.only != null && o.only !== i ? ' dim' : ''}" d="${path(s.v)}" fill="none"${col(i)}${o.print ? ' stroke-width="1.4"' : ''}/>`).join('');
  const limLine = `<path class="ntCeLim" d="${path(lim)}" fill="none"${o.print ? ' stroke="#dc2626" stroke-width="2.2" stroke-dasharray="7 4"' : ''}/>`;
  return `<svg class="ntCeChart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(paramName(param))}"><rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}" class="ntCePlot"${o.print ? ' fill="#fff" stroke="#d1d5db"' : ''}/>${g}${lines}${limLine}</svg>`;
}
const stText = s => verdictText(s);
/** Tableau des paramètres d'un résultat (HTML). */
export function paramsTable(res, o = {}) {
  const P = res.params, rows = [];
  if (o.exam) {
    // Mode examen : valeur mesurée et limite seulement.
    const ex = [[paramName('wiremap'), rawWireMap(res), ''], [paramName('length'), `${fmt(P.length.v)} m`, `${P.length.lim} m`],
      [paramName('delay'), `${fmt(Math.max(...P.delay.v), 0)} ns`, `${P.delay.lim} ns`], [paramName('skew'), `${fmt(P.skew.v, 0)} ns`, `${P.skew.lim} ns`]];
    return `<table class="${o.cls || 'ntCeTable'}"><thead><tr><th>${tl('Paramètre')}</th><th>${tl('Valeur')}</th><th>${tl('Limite')}</th></tr></thead><tbody>${ex.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table><p class="${o.cls != null ? '' : 'ntCeNote'}">${tl('Mode examen : les courbes donnent les paramètres en dB face à leur limite ; à vous de conclure.')}</p>`;
  }
  const faults = res.wiremap.faults.length ? res.wiremap.faults.map(f => `${f.type} (${f.pins.join(', ')})`).join(' ; ') : tl('droit, sans défaut');
  rows.push([paramName('wiremap'), stText(P.wiremap.st), esc(faults), '', '', '']);
  rows.push([paramName('length'), stText(P.length.st), `${fmt(P.length.v)} m`, `${P.length.lim} m`, `${fmt(P.length.margin)} m`, '']);
  rows.push([paramName('delay'), stText(P.delay.st), `${fmt(Math.max(...P.delay.v), 0)} ns`, `${P.delay.lim} ns`, `${fmt(P.delay.margin, 0)} ns`, '']);
  rows.push([paramName('skew'), stText(P.skew.st), `${fmt(P.skew.v, 0)} ns`, `${P.skew.lim} ns`, `${fmt(P.skew.margin, 0)} ns`, '']);
  for (const p of DB_PARAMS) rows.push([paramName(p), stText(P[p].st), `${fmt(P[p].v)} dB`, `${fmt(P[p].lim)} dB`, `${fmt(P[p].margin)} dB`, `${P[p].pair || ''}${P[p].f ? ' · ' + fmt(P[p].f, P[p].f < 10 ? 2 : 0) + ' MHz' : ''}`]);
  const cls = st => ({ pass: 'ok', 'pass*': 'mg', 'fail*': 'mg bad', fail: 'bad' }[st] || '');
  return `<table class="${o.cls || 'ntCeTable'}"><thead><tr><th>${tl('Paramètre')}</th><th>${tl('Résultat')}</th><th>${tl('Valeur')}</th><th>${tl('Limite')}</th><th>${tl('Marge')}</th><th>${tl('Pire paire · fréquence')}</th></tr></thead><tbody>${rows.map((r, i) => {
    const st = [P.wiremap, P.length, P.delay, P.skew, ...DB_PARAMS.map(p => P[p])][i].st;
    return `<tr><td>${esc(r[0])}</td><td class="st ${cls(st)}">${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${esc(r[5])}</td></tr>`;
  }).join('')}</tbody></table>`;
}
/**
 * Rapport de certification imprimable (document HTML autonome, en clair pour l'impression) : synthèse puis une page par lien
 * avec ses paramètres et ses courbes. o : { title, project, at, rows (testsCsv), details: [{ label, res (avec courbes) }] }.
 */
export function reportHtml(o) {
  if (o.exam) return reportExam(o);
  const rows = o.rows || [], count = v => rows.filter(r => r.verdict === v).length;
  const cls = v => ({ pass: 'ok', 'pass*': 'mg', 'fail*': 'bad', fail: 'bad' }[v] || '');
  const css = `body{font:12px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 6px}
.sub{color:#555;margin:0 0 14px}.warn{border:1px solid #f59e0b;background:#fffbeb;padding:8px 10px;border-radius:6px;margin:10px 0}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #d1d5db;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f3f4f6}
.ok{color:#15803d;font-weight:600}.mg{color:#b45309;font-weight:600}.bad{color:#b91c1c;font-weight:700}.page{page-break-before:always;break-before:page;padding-top:4px}
.badge{display:inline-block;padding:2px 10px;border-radius:12px;color:#fff;font-weight:700;font-size:14px}.badge.ok{background:#15803d;color:#fff}.badge.mg{background:#b45309;color:#fff}.badge.bad{background:#b91c1c;color:#fff}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:10px}.charts figure{margin:0}.charts figcaption{font-weight:600;margin-bottom:2px}svg{width:100%;height:auto}text{font-size:10px}
@media print{body{margin:10mm}.noprint{display:none}}`;
  const summary = `<table><thead><tr><th>${tl('Lien')}</th><th>${tl('Limite')}</th><th>${tl('Résultat')}</th><th>${tl('Marge (dB)')}</th><th>${tl('Paramètre le plus faible')}</th><th>${tl('Longueur (m)')}</th><th>${tl('Date')}</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(limitInfo(r.limit) ? limitInfo(r.limit).name : r.limit)}</td><td class="${cls(r.verdict)}">${verdictText(r.verdict)}${r.stale ? ' · ' + tl('périmé') : ''}</td><td>${fmt(r.margin, 2)}</td><td>${esc(paramName(r.param))}${r.pair ? ' ' + esc(r.pair) : ''}</td><td>${fmt(r.len)}</td><td>${esc(String(r.at || '').slice(0, 10))}</td></tr>`).join('')}</tbody></table>`;
  const pages = (o.details || []).map(d => {
    const r = d.res, li = limitInfo(r.limit);
    return `<section class="page"><h2>${esc(d.label)}</h2><p class="sub">${esc(li ? li.name : r.limit)} · ${tl('longueur {0} m', fmt(r.len))} · <span class="badge ${cls(r.verdict)}">${verdictText(r.verdict)}</span> · ${tl('marge la plus faible {0} dB ({1})', fmt(r.margin, 2), esc(paramName(r.param)))}</p>
      ${paramsTable(r, { cls: '' })}<div class="charts">${['il', 'next', 'psnext', 'rl'].map(p => `<figure><figcaption>${esc(paramName(p))}</figcaption>${chartSvg(r, p, { print: true, w: 520, h: 250 })}</figure>`).join('')}</div></section>`;
  }).join('');
  return `<!doctype html><html lang="${isEn ? 'en' : 'fr'}"><head><meta charset="utf-8"><title>${esc(o.title || tl('Rapport de certification'))}</title><style>${css}</style></head><body>
<h1>${esc(o.title || tl('Rapport de certification'))}</h1><p class="sub">${esc(o.project || '')}${o.project ? ' · ' : ''}${esc(String(o.at || '').slice(0, 16).replace('T', ' '))}</p>
<p class="warn">${esc(modelNote())} ${esc(limitsNote())}</p>
<p><b>${tl('{0} lien(s)', rows.length)}</b> · <span class="ok">PASS ${count('pass')}</span> · <span class="mg">PASS* ${count('pass*')}</span> · <span class="bad">FAIL* ${count('fail*')}</span> · <span class="bad">FAIL ${count('fail')}</span></p>
${summary}${pages}</body></html>`;
}
/** Rapport du mode examen : liens, limites, mesures et courbes, sans verdict ni marge. */
function reportExam(o) {
  const rows = o.rows || [];
  const css = `body{font:12px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 6px}.sub{color:#555;margin:0 0 14px}
.warn{border:1px solid #f59e0b;background:#fffbeb;padding:8px 10px;border-radius:6px;margin:10px 0}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #d1d5db;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f3f4f6}
.page{page-break-before:always;break-before:page;padding-top:4px}.charts{display:grid;grid-template-columns:1fr 1fr;gap:10px}.charts figure{margin:0}.charts figcaption{font-weight:600;margin-bottom:2px}svg{width:100%;height:auto}text{font-size:10px}@media print{body{margin:10mm}}`;
  const summary = `<table><thead><tr><th>${tl('Lien')}</th><th>${tl('Limite')}</th><th>${tl('Longueur (m)')}</th><th>${tl('Date')}</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(limitInfo(r.limit) ? limitInfo(r.limit).name : r.limit)}</td><td>${fmt(r.len)}</td><td>${esc(String(r.at || '').slice(0, 10))}</td></tr>`).join('')}</tbody></table>`;
  const pages = (o.details || []).map(d => {
    const r = d.res, li = limitInfo(r.limit);
    return `<section class="page"><h2>${esc(d.label)}</h2><p class="sub">${esc(li ? li.name : r.limit)} · ${tl('longueur {0} m', fmt(r.len))}</p>${paramsTable(r, { cls: '', exam: true })}<div class="charts">${['il', 'next', 'psnext', 'rl'].map(p => `<figure><figcaption>${esc(paramName(p))}</figcaption>${chartSvg(r, p, { print: true, w: 520, h: 250 })}</figure>`).join('')}</div></section>`;
  }).join('');
  return `<!doctype html><html lang="${isEn ? 'en' : 'fr'}"><head><meta charset="utf-8"><title>${esc(o.title || tl('Rapport de certification'))}</title><style>${css}</style></head><body>
<h1>${esc(o.title || tl('Rapport de certification'))}</h1><p class="sub">${esc(o.project || '')}${o.project ? ' · ' : ''}${esc(String(o.at || '').slice(0, 16).replace('T', ' '))}</p>
<p class="warn">${esc(tl('Mode examen : mesures et limites, sans verdict.'))} ${esc(modelNote())} ${esc(limitsNote())}</p><p><b>${tl('{0} lien(s)', rows.length)}</b></p>${summary}${pages}</body></html>`;
}
