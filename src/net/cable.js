// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Câble à paires torsadées et connecteurs RJ45 : ordre des huit conducteurs dans chaque fiche (T568A, T568B ou celui de
// l'élève), sertissage, défauts (conducteur coupé ou absent, court-circuit, paire inversée, croisée ou séparée), carte
// de câblage (wire map) comme la lit un testeur, et paires utilisables par Ethernet. Module pur, sans interface : le
// plan de travail (src/net/ui), le vérificateur (issues.js), les TP et les outils de l'IA s'en servent tous.
//
// Sources : brochages T568A et T568B, paires 1 bleue, 2 orange, 3 verte, 4 marron (ANSI/TIA-568.2-D, cités par
// Belden, Fluke Networks et la FOA : clés beldenCopperDesignGuide, flukeT568AvsB, foaUtpColorCodes de
// src/check/sources.js) ; défauts de carte de câblage : ouvert, court-circuit, paire inversée, paire croisée, paire
// séparée (flukeWireMapBlog) ; une paire séparée passe le test de continuité mais échoue à la diaphonie (NEXT).

/** Conducteurs : identifiant → couleur de l'isolant (blanc rayé ou plein) et paire torsadée (numéro TIA). */
export const WIRES = {
  wbl: { pair: 1, stripe: true, color: '#2563eb' }, bl: { pair: 1, stripe: false, color: '#2563eb' },
  wo: { pair: 2, stripe: true, color: '#f97316' }, o: { pair: 2, stripe: false, color: '#f97316' },
  wg: { pair: 3, stripe: true, color: '#16a34a' }, g: { pair: 3, stripe: false, color: '#16a34a' },
  wbr: { pair: 4, stripe: true, color: '#92400e' }, br: { pair: 4, stripe: false, color: '#92400e' }
};
export const WIRE_IDS = Object.keys(WIRES);
/** Ordre des conducteurs, broche 1 à 8 (TIA-568.2-D). */
export const T568A = ['wg', 'g', 'wo', 'bl', 'wbl', 'o', 'wbr', 'br'];
export const T568B = ['wo', 'o', 'wg', 'bl', 'wbl', 'g', 'wbr', 'br'];
export const STD = { A: T568A, B: T568B };
/** Broches de chaque paire d'une fiche, dans l'ordre de la norme (1-2, 3-6, 4-5, 7-8). */
export const PIN_PAIRS = [[1, 2], [3, 6], [4, 5], [7, 8]];
const pairIndexOfPin = p => PIN_PAIRS.findIndex(x => x.includes(p));
/** Câbles : catégorie, bande passante (MHz) et rang (pour comparer). */
export const CATS = {
  cat5e: { name: 'Cat 5e', mhz: 100, rank: 1, cls: 'D' },
  cat6: { name: 'Cat 6', mhz: 250, rank: 2, cls: 'E' },
  cat6a: { name: 'Cat 6A', mhz: 500, rank: 3, cls: 'EA' }
};
export const CAT_IDS = Object.keys(CATS);

/** Extrémité d'un câble : ordre des conducteurs (null : place vide), sertie ou non, courts-circuits (défaut de sertissage). */
export const endOf = (std = 'B', crimped = true) => ({ order: STD[std].slice(), crimped, shorts: [] });
/** Câble prêt à poser : droit (B-B), croisé (A-B), ou ce qui est donné. */
export function makeCable(kind = 'straight') {
  if (kind === 'crossover') return { a: endOf('B'), b: endOf('A'), cut: [] };
  if (kind === 'blank') return { a: { order: new Array(8).fill(null), crimped: false, shorts: [] }, b: { order: new Array(8).fill(null), crimped: false, shorts: [] }, cut: [] };
  return { a: endOf('B'), b: endOf('B'), cut: [] };
}
/** Norme d'une extrémité ('A', 'B') ou null. */
export function stdOf(end) {
  if (!end || !Array.isArray(end.order)) return null;
  for (const k of ['A', 'B']) if (STD[k].every((w, i) => end.order[i] === w)) return k;
  return null;
}
/** Extrémité nettoyée (fichier, IA) : huit places, chaque conducteur une fois au plus. */
export function cleanEnd(e) {
  const seen = new Set(), order = new Array(8).fill(null);
  const src = e && Array.isArray(e.order) ? e.order : [];
  for (let i = 0; i < 8; i++) { const w = src[i]; if (WIRES[w] && !seen.has(w)) { seen.add(w); order[i] = w; } }
  const shorts = (e && Array.isArray(e.shorts) ? e.shorts : []).filter(s => Array.isArray(s) && s.length === 2 && s.every(p => Number.isInteger(p) && p >= 1 && p <= 8) && s[0] !== s[1]).slice(0, 4).map(s => [s[0], s[1]]);
  return { order, crimped: !!(e && e.crimped), shorts };
}
export const cleanCableEnds = c => ({ a: cleanEnd(c && c.a), b: cleanEnd(c && c.b), cut: (c && Array.isArray(c.cut) ? c.cut : []).filter(w => WIRES[w]).slice(0, 8) });

/* ---------- Carte de câblage ---------- */
// Chaîne de segments : câbles posés bout à bout à travers des prises passives (prise murale, panneau de brassage), qui
// relient la broche n d'un côté à la broche n de l'autre. Chaque segment : { a, b, cut } et flip (parcouru de b vers a).
// Nœuds : (segment, côté, broche). Rend, pour chaque broche 1 à 8 du début, les broches de la fin qu'elle atteint et
// les broches du début qui lui sont reliées (court-circuit).
function uf(n) { const p = Array.from({ length: n }, (_, i) => i); const f = x => (p[x] === x ? x : (p[x] = f(p[x]))); return { find: f, join: (a, b) => { a = f(a); b = f(b); if (a !== b) p[a] = b; } }; }
export function chainMap(segments) {
  const n = segments.length, node = (s, side, pin) => (s * 2 + side) * 8 + (pin - 1), U = uf(Math.max(1, n) * 16);
  if (!n) return { ok: false, reach: Array.from({ length: 9 }, () => []), near: Array.from({ length: 9 }, () => []) };
  segments.forEach((seg, s) => {
    const A = seg.flip ? seg.b : seg.a, B = seg.flip ? seg.a : seg.b, cut = new Set(seg.cut || []);
    if (A && A.crimped && B && B.crimped) {
      for (let i = 0; i < 8; i++) {
        const w = A.order[i]; if (!w || cut.has(w)) continue;
        const j = B.order.indexOf(w); if (j >= 0) U.join(node(s, 0, i + 1), node(s, 1, j + 1));
      }
    }
    for (const [side, E] of [[0, A], [1, B]]) for (const [p, q] of (E && E.crimped && E.shorts) || []) U.join(node(s, side, p), node(s, side, q));
    if (s > 0) for (let p = 1; p <= 8; p++) U.join(node(s - 1, 1, p), node(s, 0, p)); // prise passive : broche n ↔ broche n
  });
  const reach = [[]], near = [[]];
  for (let p = 1; p <= 8; p++) {
    const r = U.find(node(0, 0, p));
    reach.push([1, 2, 3, 4, 5, 6, 7, 8].filter(q => U.find(node(n - 1, 1, q)) === r));
    near.push([1, 2, 3, 4, 5, 6, 7, 8].filter(q => q !== p && U.find(node(0, 0, q)) === r));
  }
  return { ok: true, reach, near };
}

const STRAIGHT = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const CROSS100 = [0, 3, 6, 1, 4, 5, 2, 7, 8];
const CROSS1000 = [0, 3, 6, 1, 7, 8, 2, 4, 5];
const ROLLED = [0, 8, 7, 6, 5, 4, 3, 2, 1];
const same = (m, ref) => m.every((x, i) => i === 0 || x === ref[i]);

/**
 * Analyse d'une chaîne (ou d'un câble seul : [cable]) comme un testeur de câble qualifiant.
 * Rend { kind, faults, map, pairs, leds, ends } :
 *   kind : 'straight' | 'crossover' (paires 2 et 3 croisées, 10/100) | 'crossover-full' (les quatre, 1000BASE-T) |
 *          'rolled' (inversé de bout en bout) | 'fault' | 'none' (pas serti) ;
 *   faults : [{ type: 'open' | 'short' | 'reversed' | 'crossed' | 'split' | 'miswire', pins: [broches du début], pair }] ;
 *   map[p] : broche d'arrivée de la broche p (null si ouverte, court-circuitée ou multiple) ;
 *   pairs[k] (k = 0..3 : paires 1-2, 3-6, 4-5, 7-8 du début) : { to (indice de la paire d'arrivée ou -1), rev, ok, split } ;
 *   leds[p] : broches allumées sur le bouchon distant quand le maître envoie sur p.
 */
export function analyzeChain(segments) {
  const first = segments[0], last = segments[segments.length - 1];
  const E0 = first && (first.flip ? first.b : first.a), E1 = last && (last.flip ? last.a : last.b);
  const notCrimped = segments.some(s => !(s.a && s.a.crimped && s.b && s.b.crimped));
  const cm = chainMap(segments);
  const map = [null], faults = [], leds = cm.reach.map(x => x.slice());
  const opens = [], shorted = new Set();
  for (let p = 1; p <= 8; p++) {
    const r = cm.reach[p];
    if (cm.near[p].length || r.length > 1) { shorted.add(p); cm.near[p].forEach(q => shorted.add(q)); }
    if (!r.length) opens.push(p);
    map.push(r.length === 1 && !cm.near[p].length ? r[0] : null);
  }
  if (notCrimped) return { kind: 'none', faults: [{ type: 'open', pins: [1, 2, 3, 4, 5, 6, 7, 8] }], map, pairs: PIN_PAIRS.map(() => ({ to: -1, rev: false, ok: false, split: false })), leds, ends: [stdOf(E0), stdOf(E1)] };
  if (opens.length) faults.push({ type: 'open', pins: opens });
  if (shorted.size) faults.push({ type: 'short', pins: [...shorted].sort((a, b) => a - b) });
  // Paires torsadées réelles : à chaque bout, deux broches d'une même paire doivent porter les deux conducteurs d'une
  // même paire du câble (sinon : paire séparée, même si la continuité broche à broche est bonne).
  const splitAt = new Set();
  segments.forEach(seg => { for (const E of [seg.a, seg.b]) PIN_PAIRS.forEach(([p, q], k) => { const a = E.order[p - 1], b = E.order[q - 1]; if (a && b && WIRES[a].pair !== WIRES[b].pair) splitAt.add(k); }); });
  const pairs = PIN_PAIRS.map(([p, q], k) => {
    const mp = map[p], mq = map[q];
    if (mp == null || mq == null) return { to: -1, rev: false, ok: false, split: splitAt.has(k) };
    const kp = pairIndexOfPin(mp), kq = pairIndexOfPin(mq);
    if (kp !== kq) return { to: -1, rev: false, ok: false, split: splitAt.has(k), mixed: true };
    const [r0] = PIN_PAIRS[kp];
    return { to: kp, rev: mp !== r0, ok: true, split: splitAt.has(k) };
  });
  let kind = 'fault';
  if (!opens.length && !shorted.size) {
    if (same(map, STRAIGHT)) kind = 'straight';
    else if (same(map, CROSS100)) kind = 'crossover';
    else if (same(map, CROSS1000)) kind = 'crossover-full';
    else if (same(map, ROLLED)) kind = 'rolled';
  }
  if (kind === 'fault' || kind === 'rolled') {
    pairs.forEach((x, k) => {
      const pins = PIN_PAIRS[k].slice();
      if (x.mixed) faults.push({ type: 'miswire', pins, pair: k });
      else if (x.ok && x.rev) faults.push({ type: 'reversed', pins, pair: k });
      else if (x.ok && x.to !== k && !(k < 2 && x.to === 1 - k && pairs[1 - k].to === k)) faults.push({ type: 'crossed', pins, pair: k });
    });
    // Paires 2 et 3 croisées alors que le reste est droit : câble mi-T568A mi-T568B mal fait (croisé partiel).
    if (!faults.some(f => f.type !== 'open' && f.type !== 'short') && kind === 'fault' && pairs[0].to === 1 && pairs[1].to === 0) faults.push({ type: 'crossed', pins: [1, 2, 3, 6], pair: 0 });
  }
  if (kind === 'rolled') { faults.length = 0; faults.push({ type: 'reversed', pins: [1, 2, 3, 4, 5, 6, 7, 8] }); kind = 'fault'; }
  const splitPairs = [...splitAt].sort();
  if (splitPairs.length && !faults.some(f => f.type === 'open' || f.type === 'short')) faults.push({ type: 'split', pins: splitPairs.flatMap(k => PIN_PAIRS[k]), pair: splitPairs[0] });
  if (faults.length && kind !== 'fault') kind = splitPairs.length ? kind : 'fault'; // une paire séparée garde la continuité
  return { kind, faults, map, pairs, leds, ends: [stdOf(E0), stdOf(E1)] };
}
export const analyzeCable = cable => analyzeChain([cable]);
/** Le câble seul est-il conforme (droit ou croisé, sans défaut) ? */
export const cableOk = r => (r.kind === 'straight' || r.kind === 'crossover' || r.kind === 'crossover-full') && !r.faults.length;
