// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique : simulation d'un circuit numérique au niveau des portes.
// Circuit : { elements: [{ id, type, x, y, r, p }], wires: [{ id, a: [idÉlément, broche], b: [...], via }] }.
// Les broches reliées (fils, nœuds, étiquettes de même nom) forment des équipotentielles. Chaque
// équipotentielle a un niveau : 0, 1, X (inconnu, ou conflit entre deux sorties) ou Z (rien ne la pilote).
// Simulation par événements, à retard unitaire : tous les éléments touchés par un changement sont
// évalués sur les niveaux du même instant, puis leurs sorties changent ensemble. Une bascule lit donc
// D avant que le front d'horloge n'ait fait changer quoi que ce soit (registre à décalage correct).
// À la mise sous tension, un passage séquentiel (un élément après l'autre) donne un état stable aux
// boucles (verrou RS en portes) au lieu de les faire osciller indéfiniment.
// Bus : une broche de bus (pin.bus) porte plusieurs bits ; un fil entre deux broches de bus relie leurs
// bits un à un (même largeur obligatoire). Blocs : le circuit est d'abord aplati (blocks.js).
// Sorties faibles (résistance de tirage) : elles ne comptent que si aucune vraie sortie ne pilote le fil.
// Indépendant de l'interface : sert à l'éditeur, aux TP et aux tests sous Node.
import { DEFS, X, Z, propsOf, layoutOf, pinKeys, isInput, isOutput } from './elements.js';
import { flatten } from './blocks.js';

const isB = v => v === 0 || v === 1;
/** Niveau d'une équipotentielle pilotée par plusieurs sorties. */
function resolve(vals) {
  let v = Z;
  for (const x of vals) { if (x === Z) continue; if (v === Z) v = x; else if (v !== x) return X; }
  return v;
}

/**
 * Équipotentielles : union des broches reliées (bit par bit pour les bus). Le circuit doit être aplati.
 * Rend { netOf(elId, clé), nets: [{ pins: [[elId, clé]] }], bad: Set(fils de largeurs différentes),
 * badTunnels: Set(noms d'étiquettes de largeurs différentes) }.
 */
export function netlist(circuit) {
  const parent = new Map(), key = (id, p) => id + '\u0000' + p;
  const find = k => { let r = k; while (parent.get(r) !== r) r = parent.get(r); let c = k; while (parent.get(c) !== r) { const n = parent.get(c); parent.set(c, r); c = n; } return r; };
  const add = k => { if (!parent.has(k)) parent.set(k, k); };
  const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const byId = new Map(circuit.elements.map(e => [e.id, e])), pinMap = new Map();
  /** Clés d'une broche d'un élément (null si la broche n'existe pas). */
  const keysOf = (id, name) => {
    let m = pinMap.get(id);
    if (!m) { m = new Map(layoutOf(byId.get(id)).pins.map(p => [p.name, pinKeys(p)])); pinMap.set(id, m); }
    return m.get(name) || null;
  };
  for (const e of circuit.elements) for (const p of layoutOf(e).pins) for (const k of pinKeys(p)) add(key(e.id, k));
  const bad = new Set();
  for (const w of circuit.wires || []) {
    if (!byId.has(w.a[0]) || !byId.has(w.b[0])) continue;
    if (w.id && w.id[0] === '~') { union(key(w.a[0], w.a[1]), key(w.b[0], w.b[1])); continue; } // liaison d'un bloc, bit à bit
    const A = keysOf(w.a[0], w.a[1]), B = keysOf(w.b[0], w.b[1]);
    if (!A || !B) continue;
    if (A.length !== B.length) { bad.add(w.id); continue; }
    A.forEach((k, i) => union(key(w.a[0], k), key(w.b[0], B[i])));
  }
  // Étiquettes de même nom : reliées sans fil (dans un même circuit : celles d'un bloc restent à lui).
  const tun = new Map(), badTunnels = new Set();
  for (const e of circuit.elements) if (e.type === 'tunnel') {
    const n = String((e.p && e.p.label) || '').trim(); if (!n) continue;
    const s = e.id.lastIndexOf('/'), t = (s < 0 ? '' : e.id.slice(0, s)) + '\u0000' + n, ks = keysOf(e.id, 'T').map(k => key(e.id, k));
    if (tun.has(t)) { const f = tun.get(t); if (f.length !== ks.length) badTunnels.add(n); for (let i = 0; i < Math.min(f.length, ks.length); i++) union(ks[i], f[i]); } else tun.set(t, ks);
  }
  const index = new Map(), nets = [];
  for (const k of parent.keys()) {
    const r = find(k); if (!index.has(r)) { index.set(r, nets.length); nets.push({ pins: [] }); }
    const i = k.indexOf('\u0000'); nets[index.get(r)].pins.push([k.slice(0, i), k.slice(i + 1)]);
  }
  return { nets, bad, badTunnels, netOf: (id, p) => { const k = key(id, p); return parent.has(k) ? index.get(find(k)) : -1; } };
}

/**
 * Simulateur. new LogicSim(circuit) ; set(id, props) pour une entrée ; settle() ; level(id, pin).
 * Les propriétés des éléments d'entrée (value, pressed) sont lues dans circuit (même objet que l'éditeur).
 */
export class LogicSim {
  constructor(circuit) {
    this.circuit = circuit;
    const F = flatten(circuit), NL = netlist(F);
    this.flat = F; this.bad = NL.bad; this.badTunnels = NL.badTunnels; this.truncated = !!F.truncated;
    this.netOf = NL.netOf;
    this.nets = NL.nets.map(n => ({ pins: n.pins, drivers: [], readers: [], v: Z }));
    this.els = [];
    this.byId = new Map();
    this.elById = new Map(F.elements.map(e => [e.id, e]));
    for (const e of F.elements) {
      const d = DEFS[e.type]; if (!d || e.port) continue; // entrée ou sortie nommée d'un bloc : simple point de liaison
      const L = layoutOf(e), x = { e, d, L, p: propsOf(e), st: d.init ? d.init(propsOf(e)) : {}, ins: [], outs: [], out: {}, idx: this.els.length };
      for (const p of L.pins) for (const k of pinKeys(p)) {
        const n = NL.netOf(e.id, k);
        if (p.dir === 'in') { x.ins.push({ name: k, net: n, opt: p.opt }); this.nets[n].readers.push(x.idx); }
        else if (p.dir === 'out' && d.kind !== 'block') { x.outs.push({ name: k, net: n }); x.out[k] = Z; this.nets[n].drivers.push([x.idx, k, !!p.weak]); }
      }
      this.els.push(x); this.byId.set(e.id, x);
    }
    this.osc = false; this.conflicts = new Set();
    this.reset();
  }
  /**
   * Reprend l'état d'un simulateur précédent (circuit modifié dans l'éditeur) : bascules, compteurs et mémoires
   * gardent leur contenu si l'élément n'a pas changé de comportement (same(anciennesProps, nouvelles)).
   * Un élément nouveau ou changé voit son horloge au niveau actuel : pas de front fantôme (bascule ajoutée
   * derrière une sortie déjà à 1).
   */
  carryOver(old, same) {
    const fresh = [];
    for (const x of this.els) {
      const o = old.byId.get(x.e.id);
      if (!o || o.d !== x.d || !same(o.p, x.p)) { fresh.push(x); continue; }
      x.st = JSON.parse(JSON.stringify(o.st)); for (const n in x.out) if (n in o.out) x.out[n] = o.out[n];
    }
    this.nets.forEach((n, i) => (n.v = this.netValue(i)));
    for (const x of fresh) if (x.st && 'clk' in x.st) { const c = this.inputs(x).CLK; if (c != null) x.st.clk = c; }
    this.settle();
    return this;
  }
  /** Entrées d'un élément lues sur les équipotentielles (broche facultative non reliée : sa valeur par défaut). */
  inputs(x) {
    const I = {};
    for (const i of x.ins) { let v = this.nets[i.net].v; if (v === Z && i.opt != null) v = i.opt; I[i.name] = v; }
    return I;
  }
  netValue(n) {
    const net = this.nets[n], v = resolve(net.drivers.filter(d => !d[2]).map(([i, p]) => this.els[i].out[p]));
    return v !== Z ? v : resolve(net.drivers.filter(d => d[2]).map(([i, p]) => this.els[i].out[p])); // rien ne pilote : les tirages décident
  }
  /** Mise sous tension : états initiaux, puis passage séquentiel jusqu'à un état stable. */
  reset() {
    // Sorties à 0 à la mise sous tension (une boucle d'inverseurs oscille au lieu de rester inconnue).
    for (const x of this.els) { x.p = propsOf(x.e); x.st = x.d.init ? x.d.init(x.p) : {}; x.st.powerUp = true; for (const o of x.outs) x.out[o.name] = 0; }
    this.nets.forEach((n, i) => (n.v = this.netValue(i)));
    this.osc = false;
    const queue = this.els.filter(x => x.d.ev).map(x => x.idx), queued = new Set(queue);
    let budget = 60 * this.els.length + 200;
    while (queue.length && budget-- > 0) {
      const i = queue.shift(); queued.delete(i);
      const x = this.els[i]; if (!x.d.ev) continue;
      const O = x.d.ev(this.inputs(x), x.p, x.st) || {};
      for (const o of x.outs) {
        const v = O[o.name] ?? X; if (x.out[o.name] === v) continue;
        x.out[o.name] = v;
        const net = this.nets[o.net], nv = this.netValue(o.net);
        if (nv !== net.v) { net.v = nv; for (const r of net.readers) if (!queued.has(r)) { queued.add(r); queue.push(r); } }
      }
    }
    if (queue.length) this.osc = true;
    for (const x of this.els) delete x.st.powerUp; // désormais, chaque front d'horloge compte
    this.findConflicts();
    this.time = 0;
    return this;
  }
  /** Change les propriétés d'un élément (entrée basculée, bouton appuyé…) et propage. */
  set(id, props) {
    const x = this.byId.get(id); if (!x) return false;
    Object.assign(x.e.p || (x.e.p = {}), props); x.p = propsOf(x.e);
    return this.settle([x.idx]);
  }
  /** Propagation par pas de temps unitaires. Rend le nombre de pas ; this.osc si le circuit n'est pas stable. */
  settle(start = null) {
    let pending = new Set(start || this.els.filter(x => x.d.ev).map(x => x.idx)), steps = 0;
    const limit = 400 + 4 * this.els.length;
    while (pending.size) {
      if (++steps > limit) {
        // Boucle qui ne se stabilise pas (état interdit d'un verrou, oscillateur en anneau) : un passage
        // séquentiel départage les verrous ; un vrai oscillateur reste signalé.
        this.osc = !this.sequential(pending); this.findConflicts(); return steps;
      }
      const changes = [];
      for (const i of [...pending].sort((a, b) => a - b)) {
        const x = this.els[i]; if (!x.d.ev) continue;
        const O = x.d.ev(this.inputs(x), x.p, x.st) || {};
        for (const o of x.outs) { const v = O[o.name] ?? X; if (x.out[o.name] !== v) changes.push([x, o, v]); }
      }
      pending = new Set();
      const touched = new Set();
      for (const [x, o, v] of changes) { x.out[o.name] = v; touched.add(o.net); }
      for (const n of touched) {
        const net = this.nets[n], nv = this.netValue(n);
        if (nv !== net.v) { net.v = nv; for (const r of net.readers) pending.add(r); }
      }
    }
    this.osc = false; this.findConflicts();
    return steps;
  }
  sequential(start) {
    const queue = [...start], queued = new Set(queue);
    let budget = 40 * this.els.length + 200;
    while (queue.length && budget-- > 0) {
      const i = queue.shift(); queued.delete(i);
      const x = this.els[i]; if (!x.d.ev) continue;
      const O = x.d.ev(this.inputs(x), x.p, x.st) || {};
      for (const o of x.outs) {
        const v = O[o.name] ?? X; if (x.out[o.name] === v) continue;
        x.out[o.name] = v;
        const net = this.nets[o.net], nv = this.netValue(o.net);
        if (nv !== net.v) { net.v = nv; for (const r of net.readers) if (!queued.has(r)) { queued.add(r); queue.push(r); } }
      }
    }
    return !queue.length;
  }
  findConflicts() {
    this.conflicts = new Set();
    this.nets.forEach((n, i) => { if (n.drivers.length > 1 && n.v === X && n.drivers.filter(([j, p, weak]) => this.els[j].out[p] !== Z && !weak).length > 1) this.conflicts.add(i); });
  }
  /** Niveau d'une broche (entrée ou sortie) d'un élément. */
  level(id, pin) { const n = this.netOf(id, pin); return n < 0 ? Z : this.nets[n].v; }
  /** Niveaux d'une broche bit par bit (un seul pour une broche simple, plusieurs pour un bus). */
  levels(id, pin) {
    const e = this.elById.get(id), q = e && layoutOf(e).pins.find(p => p.name === pin);
    return (q ? pinKeys(q) : [pin]).map(k => this.level(id, k));
  }
  netLevel(n) { return n < 0 ? Z : this.nets[n].v; }
  /** Entrées vues par un élément (pour son dessin : LED allumée, afficheur…). */
  live(id) { const x = this.byId.get(id); return x ? { ins: this.inputs(x), outs: x.out, st: x.st } : null; }
  /** Équipotentielles sans pilote mais lues par un élément : entrées « en l'air ». */
  floating() {
    const out = [];
    this.nets.forEach(n => { if (!n.drivers.length && n.readers.length) for (const r of n.readers) { const x = this.els[r]; for (const i of x.ins) if (this.nets[i.net] === n && i.opt == null) out.push({ id: x.e.id, pin: i.name }); } });
    return out;
  }
}

/* ---------- Entrées et sorties nommées ---------- */
const byPos = (a, b) => a.y - b.y || a.x - b.x;
/**
 * Signaux nommés du circuit, dans l'ordre du plan (de haut en bas) : entrées (interrupteurs,
 * boutons, blocs DIP et entrées numériques bit par bit, poids fort en premier) et sorties (LED,
 * sondes, buzzers, afficheurs hexadécimaux, bargraphes et afficheurs de valeur bit par bit).
 * Un signal : { name, id, bit?, pin? }.
 */
export function signals(circuit) {
  const ins = [], outs = [], clocks = [];
  const els = circuit.elements.filter(e => DEFS[e.type]).slice().sort(byPos);
  for (const e of els) {
    const p = propsOf(e), name = String(p.label || '').trim();
    if (!name) continue;
    if (e.type === 'clock') clocks.push({ name, id: e.id });
    else if (e.type === 'dip' || (e.type === 'numin' && (p.bits || 4) > 1)) for (let i = (p.bits || 4) - 1; i >= 0; i--) ins.push({ name: name + i, id: e.id, bit: i });
    else if (e.type === 'numin') ins.push({ name, id: e.id, bit: 0 });
    else if (e.type === 'keypad') continue; // touche + appui : pas une entrée de table de vérité
    else if (isInput(e)) ins.push({ name, id: e.id });
    else if (e.type === 'hex') for (let i = 3; i >= 0; i--) outs.push({ name: name + i, id: e.id, pin: 'D' + i });
    else if ((e.type === 'bar' || e.type === 'numout') && (p.bits || 4) > 1) for (let i = (p.bits || 4) - 1; i >= 0; i--) outs.push({ name: name + i, id: e.id, pin: 'A' + i });
    else if (isOutput(e) && e.type !== 'seg7') outs.push({ name, id: e.id, pin: 'A' });
  }
  return { ins, outs, clocks };
}
/** Applique une valeur à une entrée nommée (sans propager). */
function applyIn(circuit, sig, v) {
  const e = circuit.elements.find(x => x.id === sig.id); if (!e) return;
  e.p = e.p || {};
  if (sig.bit != null) { const cur = e.p.value || 0; e.p.value = v ? cur | (1 << sig.bit) : cur & ~(1 << sig.bit); }
  else if (e.type === 'button') e.p.pressed = !!v;
  else e.p.value = v ? 1 : 0;
}
/** Copie d'un circuit pour l'essayer sans toucher l'original (les blocs, lus seulement, sont partagés). */
const clone = c => { const o = JSON.parse(JSON.stringify({ elements: c.elements, wires: c.wires || [] })); if (c.blocks) o.blocks = c.blocks; return o; };
/** Le circuit contient-il de la mémoire (bascules, compteurs, ou boucle de portes) ? */
export function isSequential(circuit) {
  const F = flatten(circuit);
  if (F.elements.some(e => DEFS[e.type] && DEFS[e.type].seq)) return true;
  // Boucle combinatoire : une sortie qui revient, par des portes, sur une entrée de la même porte.
  const NL = netlist(F), outNets = new Map(), inNets = new Map();
  for (const e of F.elements) {
    if (!DEFS[e.type] || !DEFS[e.type].ev || e.port) continue;
    for (const p of layoutOf(e).pins) for (const k of pinKeys(p)) {
      const n = NL.netOf(e.id, k);
      if (p.dir === 'out') { if (!outNets.has(e.id)) outNets.set(e.id, []); outNets.get(e.id).push(n); }
      if (p.dir === 'in') { if (!inNets.has(n)) inNets.set(n, []); inNets.get(n).push(e.id); }
    }
  }
  const state = new Map();
  const visit = id => {
    const s = state.get(id); if (s === 1) return true; if (s === 2) return false;
    state.set(id, 1);
    for (const n of outNets.get(id) || []) for (const r of inNets.get(n) || []) if (visit(r)) return true;
    state.set(id, 2); return false;
  };
  return [...outNets.keys()].some(visit);
}
/**
 * Table de vérité : toutes les combinaisons des entrées (première entrée = poids fort).
 * Rend { ins: [noms], outs: [noms], rows: [{ in: [bits], out: [niveaux] }], seq, tooMany } ; au plus 2^maxIn lignes.
 */
export function truthTable(circuit, { ins: want = null, outs: wantOut = null, maxIn = 8, others = null } = {}) {
  const c = clone(circuit), S = signals(c);
  const ins = want ? want.map(n => S.ins.find(s => s.name === n) || null) : S.ins;
  const outs = wantOut ? wantOut.map(n => S.outs.find(s => s.name === n) || null) : S.outs;
  const res = { ins: (want || ins.map(s => s.name)), outs: (wantOut || outs.map(s => s.name)), rows: [], seq: isSequential(c), missingIn: [], missingOut: [], tooMany: false };
  ins.forEach((s, i) => { if (!s) res.missingIn.push(res.ins[i]); });
  outs.forEach((s, i) => { if (!s) res.missingOut.push(res.outs[i]); });
  if (res.missingIn.length || res.missingOut.length) return res;
  if (ins.length > maxIn) { res.tooMany = true; return res; }
  // Les autres entrées restent comme elles sont sur le plan de travail (others : valeur imposée, pour un contrôle).
  if (others != null) S.ins.forEach(s => applyIn(c, s, others));
  ins.forEach(s => applyIn(c, s, 0));
  const sim = new LogicSim(c);
  for (let k = 0; k < 1 << ins.length; k++) {
    const bits = ins.map((s, i) => (k >> (ins.length - 1 - i)) & 1);
    ins.forEach((s, i) => applyIn(c, s, bits[i]));
    ins.forEach(s => { const x = sim.byId.get(s.id); if (x) x.p = propsOf(x.e); });
    sim.settle(ins.map(s => sim.byId.get(s.id).idx));
    res.rows.push({ in: bits, out: outs.map(s => sim.level(s.id, s.pin)) });
  }
  return res;
}
/**
 * Suite d'actions sur un circuit (TP séquentiels) : à partir de la mise sous tension, chaque pas
 * fixe des entrées (set), donne des impulsions (pulse : 0 → 1 → 0 sur une entrée ou une horloge,
 * ou rise / fall : un seul front), puis lit les sorties (expect). Rend [{ ok, got: {nom: niveau} }].
 */
export function runSequence(circuit, steps) {
  const c = clone(circuit), S = signals(c), all = [...S.ins, ...S.clocks];
  // Toutes les entrées partent de 0 (interrupteurs, blocs DIP, boutons, horloges) : le verdict ne dépend pas
  // de la position où l'élève a laissé un interrupteur que la suite ne cite pas.
  c.elements.forEach(e => { if (DEFS[e.type] && (DEFS[e.type].kind === 'in')) { e.p = e.p || {}; e.p.value = 0; e.p.pressed = false; } });
  const sim = new LogicSim(c), out = [];
  const drive = (name, v) => {
    const s = all.find(q => q.name === name); if (!s) return false;
    const e = c.elements.find(x => x.id === s.id);
    if (e.type === 'clock') { e.p.value = v; } else applyIn(c, s, v);
    const x = sim.byId.get(s.id); x.p = propsOf(x.e); sim.settle([x.idx]); return true;
  };
  for (const st of steps) {
    const missing = [];
    for (const [n, v] of Object.entries(st.set || {})) if (!drive(n, v ? 1 : 0)) missing.push(n);
    for (const n of [].concat(st.pulse || [])) { for (let k = 0; k < (st.times || 1); k++) { if (!drive(n, 1)) { missing.push(n); break; } drive(n, 0); } }
    for (const n of [].concat(st.rise || [])) if (!drive(n, 1)) missing.push(n);
    for (const n of [].concat(st.fall || [])) if (!drive(n, 0)) missing.push(n);
    const got = {}, bad = [];
    for (const [n, want] of Object.entries(st.expect || {})) {
      const s = S.outs.find(q => q.name === n);
      if (!s) { missing.push(n); continue; }
      got[n] = sim.level(s.id, s.pin);
      if (got[n] !== want) bad.push(n);
    }
    out.push({ ok: !missing.length && !bad.length, got, bad, missing, osc: sim.osc });
  }
  return out;
}
export const levelOk = isB;
