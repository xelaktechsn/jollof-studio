// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Analyse électrique du montage : regroupe les broches reliées en nœuds (nets),
// repère alimentations, masses et GPIO, signale les courts-circuits, puis vérifie
// broche par broche qu'un composant est câblé comme sa fiche le demande.
import { BOARDS, SOURCES, DERIVED, NEED_CAPS, CAP_WORDS, base, volts, vrange, boardOf, isGnd } from './boards.js';
import { NPNS } from './parts.js';
import { MOSFETS, ANALOG_PARTS } from './analog-parts.js';
/** Broche de sortie d'un composant analogique qui fournit son propre signal (analog-parts.js, drives). */
const drivesPin = m => { const sp = ANALOG_PARTS[m.comp.type], q = sp && sp.pins.find(x => x.pin === m.key); return !!(q && q.drives); };
import { pkgOhms, isResistor } from './pkgparts.js';
import { tl } from '../i18n/index.js';

/** Identifiant d'une broche, « id|clé » : clé des nœuds, du graphe (adj) et des courants du solveur. */
export const pid = (c, k) => c.id + '|' + k;
const EMPTY = { src: [], gnd: [], gpio: [] };
// Broches répétées sur un même composant et reliées en interne (GND, GND (2)...).
const DUP = new Set(['GND', '3V3', 'RST', 'COM', '5V', 'VIN']);

class UF {
  constructor() { this.p = new Map(); }
  add(k) { this.p.set(k, k); }
  find(k) {
    let r = k; while (this.p.get(r) !== r) r = this.p.get(r);
    while (this.p.get(k) !== r) { const n = this.p.get(k); this.p.set(k, r); k = n; }
    return r;
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
}

export const isBreadboard = c => c.type === 'breadboard' || c.type === 'breadboard-mini';
/** Valeur d'une résistance d'après son type : res-220, res-4k7, res-10k, res-1M…, résistance en paquet (0 si ce n'en est pas une). */
export function ohms(type) {
  const m = /^res-(\d+)(?:([kKM])(\d*))?$/.exec(type);
  if (!m) return pkgOhms(type);
  return parseFloat(m[1] + '.' + (m[3] || '0')) * (m[2] === 'M' ? 1e6 : m[2] ? 1e3 : 1);
}
const isQ = c => !!NPNS[c.type];
// Interrupteur côté masse : collecteur d'un NPN ou drain d'un MOSFET ; sa commande est la base ou la grille.
const isLowSide = m => (isQ(m.comp) && m.key === 'C') || (!!MOSFETS[m.comp.type] && m.key === 'D');
const ctlKey = c => (MOSFETS[c.type] ? 'G' : 'B');
/**
 * Groupes de trous reliés d'une breadboard : rails (+ ou −, 25 trous) puis bandes de 5 trous.
 * Dans une bande a–e, le trou E est au bord de la rainure centrale.
 */
export function bbGroups(c) {
  const out = [];
  if (c.type === 'breadboard') ['T+', 'T-', 'B+', 'B-'].forEach(r => out.push({ name: r, rail: r[1], keys: Array.from({ length: 25 }, (_, j) => r + (j + 1)) }));
  const cols = c.type === 'breadboard' ? 30 : 17;
  for (let i = 1; i <= cols; i++) out.push({ name: `a–e ${i}`, keys: [...'ABCDE'].map(r => r + i) }, { name: `f–j ${i}`, keys: [...'FGHIJ'].map(r => r + i) });
  return out;
}

/** Liaisons internes d'un composant : broches dupliquées, bandes de breadboard, alias de carte. */
function internal(c) {
  const out = [], groups = {};
  Object.keys(c.pins).forEach(k => { const b = base(k); if (DUP.has(b)) (groups[b] = groups[b] || []).push(k); });
  Object.values(groups).forEach(g => g.length > 1 && out.push(g));
  if (isBreadboard(c)) bbGroups(c).forEach(g => out.push(g.keys));
  const prof = boardOf(c);
  if (prof && prof.alias) out.push(...prof.alias);
  return out;
}

/** Contacts d'un composant fermés en ce moment : bouton appuyé (1–2), relais collé (COM–NO) ou au repos (COM–NC). */
export function closedContacts(c) {
  if (c.type === 'button') return c.inp && c.inp.pressed && c.pins['1'] && c.pins['2'] ? [['1', '2']] : [];
  if (c.type === 'relay' && c.pins.COM) { const k = c.relayOn ? 'NO' : 'NC'; return c.pins[k] ? [['COM', k]] : []; }
  return [];
}
/** Tous les contacts possibles d'un composant (fermés ou non), avec leur état : [a, b, fermé]. */
function contacts(c) {
  if (c.type === 'button') return c.pins['1'] && c.pins['2'] ? [['1', '2', !!(c.inp && c.inp.pressed)]] : [];
  if (c.type === 'relay' && c.pins.COM) return ['NO', 'NC'].filter(k => c.pins[k]).map(k => ['COM', k, !!c.relayOn === (k === 'NO')]);
  return [];
}

/**
 * Construit les nœuds du montage. Seuls les fils entièrement tracés comptent, ce qui
 * permet aux capteurs de « s'allumer » au fil de l'animation du câblage.
 * Deux niveaux : `net` (liaisons directes) et `wnet` (qui traverse aussi les résistances).
 * opts.open : tous les contacts ouverts (boutons relâchés, relais au repos sans NC), pour dessiner le schéma.
 */
export function analyze(comps, wires, opts = {}) {
  const allOpen = !!opts.open;
  const S = new UF(), W = new UF(), ref = new Map(), deg = new Map();
  for (const c of comps) for (const k in c.pins) { const i = pid(c, k); ref.set(i, { comp: c, key: k }); S.add(i); W.add(i); }
  const both = (a, b) => { S.union(a, b); W.union(a, b); };
  for (const c of comps) {
    for (const g of internal(c)) for (let j = 1; j < g.length; j++) if (c.pins[g[0]] && c.pins[g[j]]) both(pid(c, g[0]), pid(c, g[j]));
    if (!allOpen) for (const [a, b] of closedContacts(c)) both(pid(c, a), pid(c, b));
    if (isResistor(c.type)) W.union(pid(c, '1'), pid(c, '2'));
  }
  for (const w of wires) {
    if ((w.progress ?? 1) < 1) continue;
    const a = pid(w.a.comp, w.a.key), b = pid(w.b.comp, w.b.key);
    if (!ref.has(a) || !ref.has(b)) continue;
    both(a, b); deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1);
  }

  // Rôles électriques des broches.
  const roles = [];
  for (const c of comps) {
    const prof = boardOf(c), src = SOURCES[c.type];
    for (const k in c.pins) {
      const b = base(k), i = pid(c, k), r = { i, comp: c, key: k };
      if (prof) {
        if (prof.power[b] != null) roles.push({ ...r, kind: 'src', v: prof.power[b], diode: prof.diode.includes(b) });
        else if (isGnd(prof, b)) roles.push({ ...r, kind: 'gnd' });
        else if (prof.gpio[b]) roles.push({ ...r, kind: 'gpio', prof, g: prof.gpio[b] });
      } else if (src && src[k] != null) roles.push(src[k] ? { ...r, kind: 'src', v: src[k] } : { ...r, kind: 'gnd' });
    }
  }
  const summarize = uf => {
    const m = new Map();
    for (const role of roles) {
      const root = uf.find(role.i);
      if (!m.has(root)) m.set(root, { src: [], gnd: [], gpio: [] });
      m.get(root)[role.kind].push(role);
    }
    return m;
  };
  // Régulateurs alimentés : leur sortie devient une source.
  let Sn = summarize(S);
  let more = false;
  for (const c of comps) {
    const d = DERIVED[c.type]; if (!d || !c.pins[d.from] || !c.pins[d.out]) continue;
    const n = Sn.get(S.find(pid(c, d.from)));
    if (n && n.src.some(s => s.v >= d.min)) { roles.push({ i: pid(c, d.out), comp: c, key: d.out, kind: 'src', v: d.v }); more = true; }
  }
  if (more) Sn = summarize(S);
  const Wn = summarize(W);

  const members = uf => { const m = new Map(); for (const [i, r] of ref) { const root = uf.find(i); if (!m.has(root)) m.set(root, []); m.get(root).push(r); } return m; };
  let Sm = null, Wm = null;

  // Courts-circuits : chacun garde les deux broches en cause pour pouvoir les montrer.
  const issues = [], seen = new Set(), nm = s => `${s.comp.name} ${s.key}`;
  const issue = (text, code, a, b) => { if (!seen.has(text)) { seen.add(text); issues.push({ level: 'err', text, code, a, b }); } };
  for (const n of Sn.values()) {
    const hard = n.src.filter(s => !s.diode), other = hard.find(s => s.v !== hard[0].v);
    if (other) issue(tl('Court-circuit : {0} et {1} sont reliées alors qu’elles sont à {2} et {3}.', nm(hard[0]), nm(other), volts(hard[0].v), volts(other.v)), 'short-v', hard[0], other);
    const dio = n.src.find(s => s.diode && hard.some(h => h.v < s.v - 0.3));
    if (dio) { const low = hard.find(h => h.v < dio.v - 0.3); issue(tl('Court-circuit : {0} pousse {1} dans {2}.', nm(dio), volts(dio.v), nm(low)), 'short-v', dio, low); }
    if (n.src.length && n.gnd.length) issue(tl('Court-circuit : {0} est reliée directement à la masse ({1}).', nm(n.src[0]), nm(n.gnd[0])), 'short-g', n.src[0], n.gnd[0]);
  }

  // Graphe broche → broche (fils tracés et liaisons internes) pour retrouver le chemin d'une erreur
  // et faire circuler le courant animé. Un bouton appuyé y est une liaison de plus, comme dans S.
  const id = r => pid(r.comp, r.key);
  let adj = null;
  const graph = () => {
    adj = new Map();
    const link = (a, b, w) => { if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a).push([b, w]); adj.get(b).push([a, w]); };
    for (const c of comps) {
      for (const g of internal(c)) for (let j = 1; j < g.length; j++) if (c.pins[g[0]] && c.pins[g[j]]) link(pid(c, g[0]), pid(c, g[j]), null);
      if (!allOpen) for (const [a, b] of closedContacts(c)) link(pid(c, a), pid(c, b), null);
    }
    for (const w of wires) if ((w.progress ?? 1) >= 1 && ref.has(id(w.a)) && ref.has(id(w.b))) link(id(w.a), id(w.b), w);
    return adj;
  };
  /** Fils du plus court chemin entre deux broches (vide si elles ne sont pas reliées). */
  const path = (a, b) => {
    const g = adj || graph(), start = id(a), goal = id(b), prev = new Map([[start, null]]), queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === goal) break;
      for (const [nx, w] of g.get(cur) || []) if (!prev.has(nx)) { prev.set(nx, [cur, w]); queue.push(nx); }
    }
    if (!prev.has(goal)) return [];
    const out = [];
    for (let k = goal; prev.get(k); k = prev.get(k)[0]) if (prev.get(k)[1]) out.unshift(prev.get(k)[1]);
    return out;
  };
  // Graphe des liaisons avec leur nature (fil ou liaison interne, résistance, bouton), pour suivre un nœud
  // en choisissant ce qu'on traverse : un bouton fermé ou ouvert quel que soit son état, une résistance.
  let rg = null, roleMap = null;
  const rgraph = () => {
    rg = new Map(); roleMap = new Map();
    const link = (a, b, k, c, shut = false) => { if (!rg.has(a)) rg.set(a, []); if (!rg.has(b)) rg.set(b, []); rg.get(a).push([b, k, c, shut]); rg.get(b).push([a, k, c, shut]); };
    for (const c of comps) {
      for (const g of internal(c)) for (let j = 1; j < g.length; j++) if (c.pins[g[0]] && c.pins[g[j]]) link(pid(c, g[0]), pid(c, g[j]), 'n');
      if (c.pins['1'] && c.pins['2'] && isResistor(c.type)) link(pid(c, '1'), pid(c, '2'), 'r', c);
      for (const [a, b, shut] of contacts(c)) link(pid(c, a), pid(c, b), 'b', c, shut);
    }
    for (const w of wires) if ((w.progress ?? 1) >= 1 && ref.has(id(w.a)) && ref.has(id(w.b))) link(id(w.a), id(w.b), 'n');
    for (const role of roles) { if (!roleMap.has(role.i)) roleMap.set(role.i, []); roleMap.get(role.i).push(role); }
  };
  /**
   * Ce qu'atteint une broche : { src, gnd, gpio, members }. Options : res (traverse les résistances),
   * closed (boutons tous fermés) ou open (tous ouverts, même appuyés ; sinon chacun selon son état), skip (bouton laissé ouvert).
   */
  const reach = (r, o = {}) => {
    if (!rg) rgraph();
    const start = id(r), seen = new Set([start]), stack = [start], out = { src: [], gnd: [], gpio: [], members: [] };
    while (stack.length) {
      const cur = stack.pop(); out.members.push(ref.get(cur));
      for (const role of roleMap.get(cur) || []) out[role.kind].push(role);
      for (const [nx, k, c, shut] of rg.get(cur) || []) {
        if (seen.has(nx) || (k === 'r' && !o.res)) continue;
        if (k === 'b' && (c === o.skip || o.open || !(o.closed || (shut && !allOpen)))) continue;
        seen.add(nx); stack.push(nx);
      }
    }
    return out;
  };
  return {
    reach,
    net: r => Sn.get(S.find(id(r))) || EMPTY,
    wnet: r => Wn.get(W.find(id(r))) || EMPTY,
    members: r => ((Sm = Sm || members(S)).get(S.find(id(r))) || []),
    wmembers: r => ((Wm = Wm || members(W)).get(W.find(id(r))) || []),
    deg: r => deg.get(id(r)) || 0,
    wiresAt: r => wires.filter(w => (w.progress ?? 1) >= 1 && ((w.a.comp === r.comp && w.a.key === r.key) || (w.b.comp === r.comp && w.b.key === r.key))),
    /** Graphe des broches : Map pid → [[pid voisine, fil ou null (liaison interne)], …]. */
    adj: () => adj || graph(),
    pid, path, issues
  };
}

const RANK = { ok: 0, free: 0, warn: 1, err: 2 };
const KIND_ORDER = { pwr: 0, ext: 0, vin: 0, gnd: 1 };
const BUS = { sda: 'I2C SDA', scl: 'I2C SCL', sck: 'SPI SCK', mosi: 'SPI MOSI', miso: 'SPI MISO' };

/**
 * Vérifie le câblage d'un composant d'après sa fiche (parts.js).
 * Retourne l'état global, l'état de chaque broche, la carte reliée, la tension
 * d'alimentation et, pour chaque signal, la broche GPIO atteinte.
 */
export function inspect(comp, A, spec) {
  const out = { level: 'ok', pins: {}, io: {}, board: null, prof: null, v: null, flags: {}, link: {} };
  if (!spec || !spec.pins) return out;
  // Chaque message garde un code (pour l'explication) et la broche fautive à l'autre bout (culprit).
  const set = (k, level, text, code, culprit, extra) => {
    const p = out.pins[k];
    if (RANK[level] > RANK[p.level]) p.level = level;
    if (text) p.msgs.push({ text, code, level, culprit, ...extra });
    if (RANK[level] > RANK[out.level]) out.level = level;
  };
  const required = p => (p.when ? p.when.some(k => A.deg({ comp, key: k }) > 0) : !p.opt);
  if (comp.type === 'button' && A.reach && inspectButton(comp, A, out, set)) return out;
  // Ce qu'atteint une broche quand les boutons du circuit sont fermés : une LED allumée par un interrupteur est bien câblée.
  const shut = (r, res) => (A.reach ? A.reach(r, { closed: true, res }) : EMPTY);
  // La carte : celle qu'atteint le premier signal relié.
  for (const p of spec.pins) {
    if (p.kind !== 'io' || !comp.pins[p.pin]) continue;
    const r = { comp, key: p.pin }, g = A.wnet(r).gpio[0] || (bridge(A, r) || {}).g;
    if (g) { out.board = g.comp; out.prof = g.prof; break; }
  }
  const list = spec.pins.filter(p => comp.pins[p.pin]).sort((a, b) => (KIND_ORDER[a.kind] ?? 2) - (KIND_ORDER[b.kind] ?? 2));
  for (const p of list) {
    const k = p.pin, r = { comp, key: k }, n = A.net(r), wn = A.wnet(r);
    out.pins[k] = { level: 'ok', msgs: [] };
    if (p.kind === 'nc' || p.kind === 'vin' || p.kind === 'contact') { out.pins[k].level = 'free'; continue; }
    if (p.kind === 'pwr' || p.kind === 'ext') {
      let srcs = n.src;
      if (!srcs.length) { srcs = shut(r).src; if (srcs.length) out.flags.switched = true; }
      if (!srcs.length) { set(k, 'err', tl('non alimentée'), 'nopower'); continue; }
      const top = srcs.reduce((a, b) => (b.v > a.v ? b : a)), v = top.v; out.v = Math.max(out.v ?? 0, v);
      const [lo, hi] = vrange(p.v, out.prof);
      if (v < lo - 0.15) set(k, 'err', tl('reçoit {0}, il faut au moins {1}', volts(v), volts(lo)), 'undervolt', top, { v, lo, hi });
      else if (v > hi + 0.15) set(k, 'err', tl('reçoit {0}, au-delà de {1} : risque de destruction', volts(v), volts(hi)), 'overvolt', top, { v, lo, hi });
      continue;
    }
    if (p.kind === 'gnd') {
      const net = p.via ? wn : n;
      // Masse commutée : la charge rejoint la masse par le collecteur d'un transistor NPN, dont la base dit quelle carte la commande.
      const q = !net.gnd.length && (p.via ? A.wmembers : A.members)(r).find(isLowSide);
      if (q) {
        out.flags.switched = true;
        const g = A.wnet({ comp: q.comp, key: ctlKey(q.comp) }).gpio[0];
        if (g && !out.board) { out.board = g.comp; out.prof = g.prof; }
        continue;
      }
      // Masse atteinte à travers un bouton (interrupteur côté masse) : le circuit se ferme quand on appuie.
      if (!net.gnd.length && shut(r, !!p.via).gnd.length) { out.flags.switched = true; continue; }
      if (!net.gnd.length) set(k, 'err', tl('non reliée à la masse'), 'nognd');
      else if (out.board && !net.gnd.some(g => g.comp === out.board)) set(k, 'err', tl('masse non commune avec {0} : reliez aussi les deux masses', out.board.name), 'commongnd', net.gnd[0]);
      if (p.via && n.gnd.length) set(k, 'warn', tl('reliée sans résistance : courant non limité'), 'nores', n.gnd[0]);
      continue;
    }
    if (p.kind === 'drv') {
      if (n.gpio.length) { set(k, 'err', tl('directement sur une broche de la carte : il faut un pilote de moteur'), 'drvdirect', n.gpio[0]); continue; }
      // Bien alimenté : une sortie de pilote L298N, ou bien une borne vers l'alimentation et l'autre vers le retour
      // (masse, collecteur d'un transistor), directement ou à travers un interrupteur, un contact de relais, une résistance.
      const other = spec.pins.find(q => q.kind === 'drv' && q.pin !== k), mine = drvSide(A, r), theirs = other && comp.pins[other.pin] ? drvSide(A, { comp, key: other.pin }) : null;
      if (mine === 'drv' || (mine && theirs && (mine !== theirs || theirs === 'drv'))) continue;
      set(k, 'err', mine ? tl('l’autre borne doit rejoindre {0}', mine === 'src' ? tl('la masse (ou le collecteur d’un transistor)') : tl('l’alimentation')) : tl('à relier à une alimentation : pile, pilote L298N, transistor ou relais'), 'drvmissing');
      continue;
    }
    // Signal vers un GPIO : directement, ou par un pont diviseur, une résistance série, une voie d'adaptateur de niveau.
    const net = p.via ? wn : n;
    let g = net.gpio.find(x => !out.board || x.comp === out.board), br = null;
    if (!g && !p.via && !n.src.length && !n.gnd.length) { br = bridge(A, r); if (br && (!out.board || br.g.comp === out.board)) g = br.g; else br = null; }
    if (!g) {
      if (!required(p)) { out.pins[k].level = 'free'; continue; }
      // Alimentée à travers sa résistance par une pile ou le 5 V, sans programme : c'est voulu.
      if (p.via && wn.src.length && !n.src.length && !n.gnd.length) { out.flags.direct = true; continue; }
      // Pareil depuis la sortie d'un composant qui pilote lui-même (NE555, ampli-op, générateur : drives dans sa fiche).
      if ((p.via ? A.wmembers : A.members)(r).some(m => m.comp !== comp && drivesPin(m))) { out.flags.direct = true; continue; }
      // Pareil à travers un bouton monté en interrupteur (côté alimentation) : allumée tant qu'on appuie.
      if (p.via && !n.src.length && !n.gnd.length && !shut(r, true).gpio.length && shut(r, true).src.length) { out.flags.direct = out.flags.switched = true; continue; }
      // Buzzer actif sur une pile, le 5 V, un interrupteur ou un relais : il sonne tant qu'il est alimenté, c'est voulu.
      if (comp.type === 'buzzer' && !n.gnd.length && !n.gpio.length && shut(r).src.length) { out.flags.direct = true; continue; }
      if (n.src.length) set(k, 'err', tl('reliée directement à une alimentation'), 'topwr', n.src[0]);
      else if (n.gnd.length && !p.switch) set(k, 'err', tl('reliée directement à la masse'), 'togn', n.gnd[0]);
      else set(k, 'err', tl('non reliée à une broche de la carte'), 'nogpio', null, { need: p.need });
      continue;
    }
    if (n.src.length) set(k, 'err', tl('reliée directement à une alimentation'), 'topwr', n.src[0]);
    if (n.gnd.length && !p.switch) set(k, 'err', tl('reliée directement à la masse'), 'togn', n.gnd[0]);
    out.io[k] = g;
    const caps = g.g.caps;
    if (caps.has('flash')) { set(k, 'err', tl('{0} est {1}', g.key, g.g.note), 'flash', g); continue; }
    const miss = (NEED_CAPS[p.need] || ['in']).filter(c => !caps.has(c));
    if (miss.length) set(k, 'err', tl('{0} n’offre pas de {1}', g.key, miss.map(c => CAP_WORDS[c]).join(tl(' ni de '))), 'cap', g, { miss, need: p.need });
    if (caps.has('uart0')) set(k, 'warn', tl('{0} sert au port série USB : téléversement et moniteur série seront perturbés', g.key), 'uart0', g);
    if (BUS[p.need]) {
      const want = (p.need === 'sda' || p.need === 'scl' ? g.prof.i2c : g.prof.spi)[p.need];
      if (!(br ? A.net({ comp: g.comp, key: g.key }) : net).gpio.some(x => x.comp === g.comp && base(x.key) === want))
        set(k, g.prof.fixedBus ? 'err' : 'warn', g.prof.fixedBus ? tl('le {0} matériel de cette carte est sur {1}', BUS[p.need], want) : tl('{0} est la broche {1} par défaut : ailleurs, précisez les broches dans le code', want, BUS[p.need]), 'bus', g, { want, bus: BUS[p.need] });
    }
    if (p.pull && !n.src.length && !wn.src.length) { set(k, 'warn', tl('résistance de tirage manquante vers l’alimentation'), 'pullup', null); out.flags.nopull = true; }
    if (p.via && n.gpio.length) set(k, 'warn', tl('reliée sans résistance : courant non limité'), 'nores', n.gpio[0]);
    if (br) out.link[k] = br;
    levels(p, g, br, out.v, (lv, text) => set(k, 'warn', text, lv, g));
  }
  return out;
}

// Sens d'un signal : le module le reçoit de la carte (FROM_BOARD), le lui envoie (TO_BOARD), ou les deux (bus, 1-Wire).
const FROM_BOARD = new Set(['out', 'pwm', 'mosi', 'sck', 'ss', 'rx', 'sda', 'scl', 'io']);
const TO_BOARD = new Set(['in', 'adc', 'miso', 'tx', 'sda', 'scl', 'io', 'pullup']);
const fmt = v => volts(Math.round(v * 100) / 100);
/**
 * Niveaux logiques entre un module et la carte. lv5 : le module sort du 5 V vers une carte 3,3 V ; lv3 : module en
 * logique 3,3 V commandé par une carte 5 V. Accepté : pont diviseur dont le point milieu tombe dans la plage de
 * l'entrée (au plus logique + 0,3 V, au moins 70 % de la logique pour lire HIGH), ou voie d'adaptateur de niveau,
 * chaque côté à sa tension. report(code, texte).
 */
function levels(p, g, br, vMod, report) {
  const logic = g.prof.logic;
  if (p.lv5 && TO_BOARD.has(p.need) && (vMod ?? 0) > 4 && logic < 4) {
    if (br && br.kind === 'shift') { if (br.side !== 'HV') report('lv5', tl('branché côté LV de {0} : le module 5 V va côté HV, la carte côté LV', br.sh.name)); }
    else if (br && br.kind === 'div' && br.tap === 'board') {
      const v = vMod * br.ratio;
      if (v > logic + 0.3) report('lv5', tl('le pont diviseur laisse {0} sur {1} (au plus {2}) : agrandissez la résistance du bas', fmt(v), g.key, fmt(logic + 0.3)));
      else if (v < 0.7 * logic) report('lv5', tl('le pont diviseur ne laisse que {0} : la carte risque de lire LOW (il faut au moins {1})', fmt(v), fmt(0.7 * logic)));
    } else report('lv5', tl('signal à {0} sur une carte 3,3 V : passez par un pont diviseur (4,7 kΩ / 10 kΩ) ou un adaptateur de niveau', volts(vMod)));
  }
  if (p.lv3 && FROM_BOARD.has(p.need) && logic > 4) {
    if (br && br.kind === 'shift') { if (br.side !== 'LV') report('lv3', tl('branché côté HV de {0} : le module 3,3 V va côté LV, la carte côté HV', br.sh.name)); }
    else if (br && br.kind === 'div' && br.tap === 'module') {
      const v = logic * br.ratio;
      if (v > 3.6) report('lv3', tl('le pont diviseur laisse {0} au module (au plus 3,6 V) : agrandissez la résistance du bas', fmt(v)));
      else if (v < 2.3) report('lv3', tl('le pont diviseur ne laisse que {0} au module : il risque de lire LOW (il faut au moins 2,3 V)', fmt(v)));
    } else report('lv3', tl('module en logique 3,3 V commandé par une carte 5 V : passez par un pont diviseur (4,7 kΩ / 10 kΩ) ou un adaptateur de niveau'));
  }
}

/**
 * Broche de carte atteinte à travers un adaptateur : voie d'un adaptateur de niveau (side : côté du module, 'LV' ou 'HV'),
 * ou résistance série, avec, s'il y en a une, la résistance qui tire l'un des deux côtés à la masse (pont diviseur :
 * tap 'board' quand le point milieu est sur la broche de la carte, 'module' quand il est sur le module).
 * Rend { kind: 'shift' | 'div' | 'series', g, … } ou null.
 */
export function bridge(A, r) {
  const mem = A.members(r);
  for (const m of mem) {
    const ch = m.comp.type === 'lvlshift' && /^(LV|HV)([1-4])$/.exec(m.key);
    if (!ch) continue;
    const g = A.net({ comp: m.comp, key: (ch[1] === 'LV' ? 'HV' : 'LV') + ch[2] }).gpio[0];
    if (g) return { kind: 'shift', g, side: ch[1], sh: m.comp };
  }
  for (const m of mem) {
    const top = ohms(m.comp.type);
    if (!top || m.comp === r.comp) continue;
    const far = { comp: m.comp, key: m.key === '1' ? '2' : '1' }, fn = A.net(far), g = fn.gpio[0];
    if (!g || fn.src.length || fn.gnd.length) continue;
    // Résistance vers la masse sur l'un des deux nœuds : le bas du pont.
    const down = list => list.map(x => (x.comp !== m.comp && ohms(x.comp.type) ? { x, o: { comp: x.comp, key: x.key === '1' ? '2' : '1' } } : null))
      .find(y => y && A.net(y.o).gnd.length);
    const atBoard = down(A.members(far)), atMod = !atBoard && down(mem);
    const bot = atBoard || atMod;
    if (!bot) return { kind: 'series', g, res: m.comp, top };
    const b = ohms(bot.x.comp.type);
    return { kind: 'div', g, res: m.comp, top, bottom: b, ratio: b / (top + b), tap: atBoard ? 'board' : 'module' };
  }
  return null;
}

/**
 * Bouton poussoir : ses deux pattes sont équivalentes. Montages acceptés :
 *  - une patte sur une entrée de la carte, l'autre à la masse (tirage interne ou externe : appuyé = LOW) ;
 *  - une patte sur une entrée tirée vers la masse par une résistance, l'autre à l'alimentation (appuyé = HIGH) ;
 *  - sans carte, en interrupteur dans le circuit d'une pile ou d'une alimentation.
 * Les nœuds sont suivis bouton ouvert : un bouton appuyé ne change pas le diagnostic.
 * Rend false (rien décidé) quand aucun de ces cas ne s'applique : la fiche générale reprend la main.
 */
function inspectButton(comp, A, out, set) {
  if (!comp.pins['1'] || !comp.pins['2']) return false;
  const side = key => {
    const r = { comp, key };
    return { key, r, wired: A.deg(r) > 0, open: A.reach(r, { open: true }), openW: A.reach(r, { open: true, res: true }), shut: A.reach(r, { closed: true, skip: comp }), shutW: A.reach(r, { closed: true, skip: comp, res: true }) };
  };
  const s = [side('1'), side('2')], withIo = s.filter(x => x.open.gpio.length);
  if (withIo.length > 1) return false;
  s.forEach(x => (out.pins[x.key] = { level: 'ok', msgs: [] }));
  if (withIo.length) {
    const x = withIo[0], y = s.find(o => o !== x), g = x.open.gpio[0];
    out.board = g.comp; out.prof = g.prof; out.io[x.key] = g;
    if (x.open.src.length) set(x.key, 'err', tl('reliée directement à une alimentation'), 'topwr', x.open.src[0]);
    if (x.open.gnd.length) set(x.key, 'err', tl('reliée directement à la masse'), 'togn', x.open.gnd[0]);
    // L'autre patte : à la masse (appuyé = LOW) ou à l'alimentation (appuyé = HIGH), directement ou par une résistance.
    const low = y.shut.gnd.length || (!y.shut.src.length && y.shutW.gnd.length), high = !low && (y.shut.src.length || y.shutW.src.length);
    let need = 'in';
    if (low) { if (!x.openW.src.length) need = 'pullup'; }
    else if (high) {
      out.flags.activeHigh = true;
      const top = (y.shut.src.length ? y.shut : y.shutW).src.reduce((a, b) => (b.v > a.v ? b : a)); out.v = top.v;
      if (!x.openW.gnd.length) set(x.key, 'warn', tl('résistance de rappel vers la masse manquante : au repos l’entrée flotte'), 'pulldown', null);
      if (top.v > 4 && g.prof.logic < 4) set(x.key, 'warn', tl('signal à {0} sur une carte 3,3 V : passez par un pont diviseur (1 kΩ / 2 kΩ) ou un adaptateur de niveau', volts(top.v)), 'lv5', g);
    } else set(y.key, 'err', tl('non reliée à la masse'), 'nognd');
    const caps = g.g.caps;
    if (caps.has('flash')) set(x.key, 'err', tl('{0} est {1}', g.key, g.g.note), 'flash', g);
    else {
      const miss = NEED_CAPS[need].filter(c => !caps.has(c));
      if (miss.length) set(x.key, 'err', tl('{0} n’offre pas de {1}', g.key, miss.map(c => CAP_WORDS[c]).join(tl(' ni de '))), 'cap', g, { miss, need });
      if (caps.has('uart0')) set(x.key, 'warn', tl('{0} sert au port série USB : téléversement et moniteur série seront perturbés', g.key), 'uart0', g);
    }
    return true;
  }
  // Sans carte : interrupteur dans un circuit alimenté.
  if (s.some(x => x.openW.gpio.length)) return false;
  const [a, b] = s;
  if (!a.wired || !b.wired) {
    const w = a.wired ? a : b, f = a.wired ? b : a;
    if (!w.shutW.src.length && !w.shutW.gnd.length) return false;
    set(f.key, 'err', w.shutW.src.length ? tl('non reliée à la masse') : tl('non alimentée'), w.shutW.src.length ? 'nognd' : 'nopower');
    return true;
  }
  const src = a.shut.src.length ? a : b.shut.src.length ? b : null, gnd = src && (src === a ? b : a);
  if (src && gnd.shut.gnd.length) { set(src.key, 'err', tl('appuyer relie directement l’alimentation à la masse'), 'swshort', gnd.shut.gnd[0]); return true; }
  out.flags.inline = true;
  return true;
}

/** Côté d'une borne de moteur : 'drv' (sortie de pilote), 'src' (alimentation), 'ret' (masse, collecteur) ou null. */
function drvSide(A, r) {
  const m = A.reach ? A.reach(r, { closed: true, res: true }) : { src: A.net(r).src, gnd: A.net(r).gnd, members: A.members(r) };
  if (m.members.some(x => x.comp.type === 'l298n' && /^OUT/.test(x.key))) return 'drv';
  if (m.src.length) return 'src';
  if (m.gnd.length || m.members.some(isLowSide)) return 'ret';
  return null;
}

/** Premier message d'erreur, sous la forme « VCC non alimentée ». */
export function firstMsg(ins, level = 'err') {
  for (const k in ins.pins) { const p = ins.pins[k]; if (p.level === level && p.msgs.length) return `${k} ${p.msgs[0].text}`; }
  return '';
}
