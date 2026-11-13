// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique : blocs (sous-circuits). Un bloc est un circuit rangé avec le projet (circuit.blocks :
// [{ id, name, circuit }]) et posé comme un seul élément (type « block », p.ref = id du bloc).
// Ses broches sont les entrées et sorties nommées de son circuit : interrupteurs, boutons, horloges,
// blocs DIP et entrées numériques donnent ses entrées ; LED, sondes, buzzers et afficheurs ses sorties.
// Un bloc peut contenir d'autres blocs (jamais lui-même). Pour simuler, le circuit est « aplati » :
// chaque bloc posé est remplacé par une copie de son circuit (identifiants préfixés « idDuBloc/ »),
// dont les entrées et sorties nommées deviennent de simples points de liaison (port) reliés aux
// broches du bloc par des fils invisibles (identifiants commençant par « ~ »).
import { propsOf, layoutOf, pinKeys } from './elements.js';

export const MAX_DEPTH = 6;
/** Taille maximale d'un circuit aplati : un fichier trafiqué (blocs posés des centaines de fois les uns dans les autres) ne bloque pas l'application. */
export const MAX_FLAT = 20000;
const byPos = (a, b) => a.y - b.y || a.x - b.x;
const IN_PORT = new Set(['switch', 'button', 'clock', 'dip', 'numin']);
const OUT_PORT = new Set(['led', 'probe', 'buzzer', 'hex', 'bar', 'numout']);
export const isPortType = t => IN_PORT.has(t) || OUT_PORT.has(t);

/**
 * Broches d'un bloc d'après son circuit : [{ n, dir, w, clk?, map: [[idIntérieur, clé de broche] par bit] }],
 * entrées puis sorties, chacune dans l'ordre du plan (de haut en bas). Un bloc DIP, une entrée numérique
 * ou un afficheur de plusieurs bits donnent une broche par bit (A0, A1…) ou, s'ils sont réglés en bus,
 * une seule broche de bus.
 */
export function blockPorts(c) {
  const ins = [], outs = [], seen = new Set();
  const els = ((c && c.elements) || []).filter(e => isPortType(e.type)).slice().sort(byPos);
  for (const e of els) {
    const p = propsOf(e), name = String(p.label || '').replace(/#/g, '').trim(); if (!name) continue; // « # » sépare les bits d'un bus
    const input = IN_PORT.has(e.type), list = input ? ins : outs, dir = input ? 'in' : 'out';
    const keys = layoutOf(e).pins.filter(q => q.dir === (input ? 'out' : 'in') && q.opt == null).flatMap(pinKeys);
    if (!keys.length) continue;
    const add = port => { if (seen.has(port.n)) return; seen.add(port.n); list.push(port); };
    if (keys.length > 1 && !p.bus) keys.forEach((k, i) => add({ n: name + i, dir, w: 1, map: [[e.id, k]] }));
    else add({ n: name, dir, w: keys.length, clk: e.type === 'clock' || undefined, map: keys.map(k => [e.id, k]) });
  }
  return [...ins, ...outs];
}
/** Interface d'un bloc, gardée dans chaque élément posé (p.io) pour le dessiner : { t, ins: [{ n, w, c? }], outs }. */
export function blockIo(def) {
  const P = blockPorts(def && def.circuit), pick = q => (q.clk ? { n: q.n, w: q.w, c: 1 } : { n: q.n, w: q.w });
  return { t: String((def && def.name) || '?'), ins: P.filter(q => q.dir === 'in').map(pick), outs: P.filter(q => q.dir === 'out').map(pick) };
}
/** Le bloc a contient-il (directement ou non) le bloc b ? (a === b compte : un bloc ne se contient pas.) */
export function usesBlock(defs, a, b, seen = new Set()) {
  if (a === b) return true;
  if (seen.has(a)) return false; seen.add(a);
  const d = (defs || []).find(x => x.id === a); if (!d) return false;
  return d.circuit.elements.some(e => e.type === 'block' && e.p && usesBlock(defs, e.p.ref, b, seen));
}

/** Nombre d'éléments d'un bloc une fois aplati (mémorisé dans memo) ; Infinity s'il se contient. */
export function blockSize(defs, id, memo = new Map(), stack = []) {
  if (memo.has(id)) return memo.get(id);
  if (stack.includes(id) || stack.length > MAX_DEPTH) return Infinity;
  const d = (defs || []).find(x => x.id === id); if (!d) return 0;
  let n = 0;
  for (const e of d.circuit.elements) {
    n += 1;
    if (e.type === 'block') n += blockSize(defs, e.p && e.p.ref, memo, [...stack, id]);
    if (n > MAX_FLAT) { n = Infinity; break; }
  }
  memo.set(id, n); return n;
}
/** Circuit sans blocs, pour la simulation. Sans bloc posé, rend le circuit lui-même. truncated : des blocs n'ont pas été copiés (trop gros). */
export function flatten(c) {
  if (!c.elements.some(e => e.type === 'block')) return c;
  const out = { elements: [], wires: [] };
  add(c, '', c.blocks || [], 0, out, [], null, new Map());
  return out;
}
function add(c, prefix, defs, depth, out, stack, ports, memo) {
  for (const e of c.elements) {
    const id = prefix + e.id;
    out.elements.push(prefix ? { ...e, id, port: (ports && ports.has(e.id)) || undefined } : e);
    if (e.type !== 'block') continue;
    // Bloc posé : sa copie intérieure, et un fil invisible par bit de chaque broche.
    const def = defs.find(b => b.id === (e.p && e.p.ref));
    if (!def || depth >= MAX_DEPTH || stack.includes(def.id)) continue;
    if (out.elements.length + blockSize(defs, def.id, memo) > MAX_FLAT) { out.truncated = true; continue; }
    const P = blockPorts(def.circuit);
    add(def.circuit, id + '/', defs, depth + 1, out, [...stack, def.id], new Set(P.flatMap(q => q.map.map(m => m[0]))), memo);
    for (const q of P) q.map.forEach(([inner, k], i) => out.wires.push({ id: `~${id}/${q.n}/${i}`, a: [id, q.w > 1 ? q.n + '#' + i : q.n], b: [id + '/' + inner, k] }));
  }
  for (const w of c.wires || []) out.wires.push(prefix ? { id: prefix + w.id, a: [prefix + w.a[0], w.a[1]], b: [prefix + w.b[0], w.b[1]] } : w);
}

/**
 * Met à jour l'interface (p.io) des blocs posés, dans le circuit principal et dans les blocs.
 * drop : retire aussi les fils dont la broche a disparu (au retour du bloc modifié). Rend true si quelque chose a changé.
 */
export function syncBlocks(root, { drop = false } = {}) {
  const defs = root.blocks || [], io = new Map(defs.map(d => [d.id, blockIo(d)]));
  let changed = false;
  const fix = c => {
    for (const e of c.elements) {
      if (e.type !== 'block') continue;
      const v = io.get(e.p && e.p.ref); if (!v) continue;
      if (JSON.stringify(e.p.io) !== JSON.stringify(v)) { e.p = { ...e.p, io: v }; changed = true; }
    }
    if (!drop) return;
    const byId = new Map(c.elements.map(e => [e.id, e]));
    for (let i = c.wires.length - 1; i >= 0; i--) {
      const w = c.wires[i];
      const gone = [w.a, w.b].some(([id, pin]) => { const e = byId.get(id); return e && e.type === 'block' && !layoutOf(e).pins.some(q => q.name === pin); });
      if (gone) { c.wires.splice(i, 1); changed = true; }
    }
  };
  fix(root); defs.forEach(d => fix(d.circuit));
  return changed;
}
/** Retire un bloc : sa définition et tous les éléments qui le posent (et leurs fils). */
export function removeBlock(root, id) {
  root.blocks = (root.blocks || []).filter(d => d.id !== id);
  const strip = c => {
    const gone = new Set(c.elements.filter(e => e.type === 'block' && e.p && e.p.ref === id).map(e => e.id));
    if (!gone.size) return;
    c.elements.splice(0, c.elements.length, ...c.elements.filter(e => !gone.has(e.id)));
    c.wires.splice(0, c.wires.length, ...c.wires.filter(w => !gone.has(w.a[0]) && !gone.has(w.b[0])));
  };
  strip(root); root.blocks.forEach(d => strip(d.circuit));
}
/** Blocs utilisés par une liste d'éléments, avec ceux qu'ils contiennent (pour copier-coller vers un autre projet). */
export function blocksUsed(defs, elements, out = new Map()) {
  for (const e of elements) {
    if (e.type !== 'block' || !e.p || out.has(e.p.ref)) continue;
    const d = (defs || []).find(x => x.id === e.p.ref); if (!d) continue;
    out.set(d.id, d); blocksUsed(defs, d.circuit.elements, out);
  }
  return out;
}
