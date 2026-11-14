// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : simulation « tout ou rien », sans modèle physique. À chaque pas :
// - chaque distributeur prend sa position (bobine excitée, bouton appuyé, pilotage sous pression, ressort ; un
//   distributeur bistable garde la dernière) ;
// - chaque orifice est sous pression (relié à une source), à l'échappement (relié à l'air libre) ou fermé (il garde
//   l'air qu'il avait) ; les liaisons internes suivent la position des distributeurs et des clapets ;
// - un vérin avance quand une chambre est sous pression et que l'autre peut s'échapper, à la vitesse fixée par sa
//   durée de course, ralentie par le réducteur de débit le plus fermé sur le chemin de l'air ;
// - les capteurs de fin de course se ferment quand le piston est en bout de course.
// Un orifice laissé libre est à l'air libre : sous pression, c'est une fuite (signalée), sauf un échappement.
import { DEFS, props, portsOf, camTarget, delayOf } from './elements.js';

const key = (id, p) => `${id}:${p}`;
/** Éléments qui laissent l'air s'échapper par un orifice non raccordé (la source et le manomètre, non). */
export const VENTS = new Set(['frl', 'v32', 'v52', 'v53', 'cyl1', 'cyl2', 'flowctl', 'shuttle', 'twopress']);
/** Fin de course : tolérance sur la position du piston (0 rentré, 1 sorti). */
export const END = 0.02;

/** État de simulation vide : positions des distributeurs, des pistons, pression des orifices. */
/** Bouton poussoir d'un distributeur : côté 14 (à gauche, l'identifiant seul) ou côté 12 (à droite, « id:R »). */
export const pushKey = (id, side) => (side === 'R' ? `${id}:R` : id);
export const createState = () => ({ pos: {}, x: {}, press: {}, rightOn: {}, gate: {}, closed: {}, tm: {}, leaks: [], t: 0 });

/**
 * Position d'un distributeur d'après ses commandes (active(e, genre, bobine, orifice de pilotage) → actionnée ?) :
 * 3/2 et 5/2 monostables 0 ou 1 ; 5/2 bistable : garde la dernière ; 5/3 : 1 (côté 14), -1 (côté 12), 0 (centré
 * par ses ressorts). Partagé par les deux modèles (tout ou rien, physique).
 */
export function valvePos(e, P, was, active, st) {
  // Temporisateur : il bascule quand son pilotage est resté sous pression pendant tout le retard (st.tm, compté par le modèle).
  if (e.type === 'v32' && P.act === 'tempo') return ((st.tm || {})[e.id] || 0) >= delayOf(P) - 1e-9 ? 1 : 0;
  if (e.type === 'v32') return active(e, P.act, P.coil, '12', 'L') ? 1 : 0;
  if (e.type === 'v52') {
    const L = active(e, P.left, P.coilL, '14', 'L'), Rt = P.right === 'spring' ? false : active(e, P.right, P.coilR, '12', 'R');
    st.rightOn[e.id] = Rt;
    return P.right === 'spring' ? (L ? 1 : 0) : L && !Rt ? 1 : Rt && !L ? 0 : was; // bistable : mémoire
  }
  if (e.type === 'v53') {
    const L = active(e, P.left, P.coilL, '14', 'L'), Rt = active(e, P.right, P.coilR, '12', 'R');
    return L && !Rt ? 1 : Rt && !L ? -1 : 0;
  }
  return was;
}
/** Passages internes d'un distributeur ou d'une unité FRL dans sa position : [[orifice, orifice], …]. */
export function passages(e, P, pos) {
  switch (e.type) {
    case 'frl': return [['1', '2']];
    case 'v32': return (P.normal === 'no' ? !pos : pos) ? [['1', '2']] : [['2', '3']];
    case 'v52': return pos ? [['1', '4'], ['2', '3']] : [['1', '2'], ['4', '5']];
    case 'v53': return pos === 1 ? [['1', '4'], ['2', '3']] : pos === -1 ? [['1', '2'], ['4', '5']]
      : P.center === 'exhaust' ? [['4', '5'], ['2', '3']] : P.center === 'pressure' ? [['1', '4'], ['1', '2']] : [];
    default: return [];
  }
}

/** Galet actionné : le vérin de sa came est à la fin de course choisie (position du pas précédent). Partagé par les deux modèles. */
export function camOn(els, st, P) {
  const c = camTarget(els, P.cam); if (!c) return false;
  const x = st.x[c.id] || 0;
  return P.end === '0' ? x <= END : x >= 1 - END;
}
/** Graphe du circuit : orifices, tuyaux (liaisons sans pertes), orifices raccordés. */
function graphOf(circuit) {
  const els = circuit.elements.filter(e => DEFS[e.type]);
  const ports = new Map(), linked = new Set();
  for (const e of els) for (const p of portsOf(e)) ports.set(key(e.id, p.id), { el: e, port: p });
  const tubes = [];
  for (const t of circuit.tubes || []) {
    const a = key(t.a[0], t.a[1]), b = key(t.b[0], t.b[1]);
    if (!ports.has(a) || !ports.has(b) || a === b) continue;
    tubes.push([a, b]); linked.add(a); linked.add(b);
  }
  return { els, ports, tubes, linked };
}

/** Plus large chemin (le débit est limité par le passage le plus étroit) depuis les départs, dans le sens des arêtes. */
function widest(starts, edges, back = false) {
  const f = new Map(starts.map(s => [s, 1]));
  for (let k = 0, more = true; more && k < 400; k++) {
    more = false;
    for (const [a, b, fab, fba] of edges) {
      // Avant : de a vers b (fab) et de b vers a (fba). Arrière (vers un échappement) : u rejoint v par l'arête u → v.
      const pairs = back ? [[b, a, fab], [a, b, fba]] : [[a, b, fab], [b, a, fba]];
      for (const [u, v, w] of pairs) {
        const fu = f.get(u); if (!fu || !w) continue;
        const nv = Math.min(fu, w); if (nv > (f.get(v) || 0) + 1e-9) { f.set(v, nv); more = true; }
      }
    }
  }
  return f;
}

/**
 * Un pas de simulation. io : { coil(nom) → bobine excitée ?, pushed(id) → bouton du distributeur appuyé ? }.
 * Rend { sensors: Map(nom → fermé ?), leaks: [{ el, port }] } ; st est mis à jour (positions, pistons, pressions).
 */
export function step(circuit, st, io, dt) {
  const { els, ports, tubes, linked } = graphOf(circuit);
  const on = k => st.press[k] === 'P' || st.press[k] === 'CP'; // sous pression (ou air sous pression enfermé)
  const active = (e, kind, coil, pilot, side) => (kind === 'sol' ? !!(coil && io.coil(coil)) : kind === 'push' ? !!io.pushed(pushKey(e.id, side)) : kind === 'pilot' ? on(key(e.id, pilot)) : kind === 'roller' ? camOn(els, st, props(e)) : false);
  let leaks = [];
  // Temporisateurs : le temps court tant que le pilotage 12 est sous pression ; il repart de zéro dès qu'il retombe
  // (le réservoir se vide aussitôt par le clapet anti-retour).
  st.tm = st.tm || {};
  for (const e of els) if (e.type === 'v32' && props(e).act === 'tempo') st.tm[e.id] = on(key(e.id, '12')) ? (st.tm[e.id] || 0) + dt : 0;
  for (let round = 0; round < 8; round++) {
    // 1. Positions des distributeurs.
    let moved = false;
    for (const e of els) {
      const P = props(e), was = st.pos[e.id] || 0, pos = valvePos(e, P, was, active, st);
      if (pos !== was) { st.pos[e.id] = pos; moved = true; }
    }
    // 2. Liaisons : tuyaux, puis passages internes selon les positions des distributeurs.
    const edges = tubes.map(([a, b]) => [a, b, 1, 1]);
    const link = (list, e, p, q, fpq = 1, fqp = 1) => { const a = key(e.id, p), b = key(e.id, q); if (ports.has(a) && ports.has(b)) list.push([a, b, fpq, fqp]); };
    const gates = [];
    for (const e of els) {
      const P = props(e), pos = st.pos[e.id] || 0;
      switch (e.type) {
        case 'frl': case 'v32': case 'v52': case 'v53': for (const [p, q] of passages(e, P, pos)) link(edges, e, p, q); break;
        case 'flowctl': link(edges, e, '1', '2', 1, Math.max(0.05, Math.min(1, (+P.open || 0) / 100))); break; // libre de 1 vers 2, réglé de 2 vers 1
        case 'shuttle': case 'twopress': gates.push(e); break;
        default: break;
      }
    }
    // Sélecteur (OU) et double pression (ET) : chacun décide d'après la pression de ses entrées, calculée sans ses
    // propres passages (sinon la sortie renverrait la pression d'une entrée vers l'autre).
    const srcs = els.filter(e => e.type === 'supply').map(e => key(e.id, '1')).filter(k => linked.has(k));
    const gateLinks = id => { const out = []; const e = els.find(x => x.id === id); for (const [p, q] of st.gate[id] || [['1', '2'], ['3', '2']]) link(out, e, p, q); return out; };
    st.gate = st.gate || {};
    for (const g of gates) {
      const others = gates.filter(x => x !== g).flatMap(x => gateLinks(x.id));
      const up = widest(srcs, [...edges, ...others]);
      const x = !!up.get(key(g.id, '1')) || st.press[key(g.id, '1')] === 'CP', y = !!up.get(key(g.id, '3')) || st.press[key(g.id, '3')] === 'CP';
      const pick = g.type === 'shuttle'
        ? (x && !y ? [['1', '2']] : y && !x ? [['3', '2']] : [['1', '2'], ['3', '2']]) // la bille ferme le côté le moins pressé
        : (x && y ? [['1', '2'], ['3', '2']] : x ? [['3', '2']] : y ? [['1', '2']] : [['1', '2'], ['3', '2']]); // la sortie suit l'entrée la moins pressée
      if (JSON.stringify(pick) !== JSON.stringify(st.gate[g.id])) { st.gate[g.id] = pick; moved = true; }
    }
    for (const g of gates) edges.push(...gateLinks(g.id));
    // 3. Pression : relié à une source, sinon à l'air libre, sinon fermé (garde son air).
    const sources = srcs;
    const vents = [...ports].filter(([k, v]) => VENTS.has(v.el.type) && !linked.has(k)).map(([k]) => k);
    const sup = widest(sources, edges), ven = widest(vents, edges, true);
    const press = {};
    for (const k of ports.keys()) press[k] = sup.get(k) ? 'P' : ven.get(k) ? 'E' : on(k) ? 'CP' : 'C0';
    leaks = vents.filter(k => sup.get(k) && !ports.get(k).port.exhaust).map(k => ({ el: ports.get(k).el.id, port: ports.get(k).port.id }));
    const changed = Object.keys(press).some(k => press[k] !== st.press[k]);
    st.press = press; st.sup = sup; st.ven = ven;
    if (!moved && !changed) break;
  }
  st.leaks = leaks;
  // 4. Vérins : la chambre sous pression pousse si l'autre s'échappe ; débit limité par le passage le plus étroit.
  for (const e of els) {
    if (e.type !== 'cyl1' && e.type !== 'cyl2') continue;
    const P = props(e), T = Math.max(0.1, +P.time || 1), A = key(e.id, '1'), B = key(e.id, '2');
    let x = st.x[e.id] || 0, v = 0;
    const pa = st.press[A], pb = e.type === 'cyl2' ? st.press[B] : 'E';
    const fs = k => st.sup.get(k) || 0, fe = k => (e.type === 'cyl1' && k === B ? 1 : st.ven.get(k) || 0);
    if (pa === 'P' && pb === 'E') v = Math.min(fs(A), fe(B)) / T;
    else if (e.type === 'cyl2' && pb === 'P' && pa === 'E') v = -Math.min(fs(B), fe(A)) / T;
    else if (e.type === 'cyl1' && pa === 'E') v = -fe(A) / T; // ressort de rappel
    else if (pa === 'P' && pb === 'P') v = 0.25 * Math.min(fs(A), fs(B)) / T; // section du piston plus grande côté arrière
    st.x[e.id] = Math.max(0, Math.min(1, x + v * dt));
  }
  st.t += dt;
  // 5. Capteurs : fins de course des vérins, pressostats (fermés quand leur orifice est sous pression).
  const sensors = new Map();
  for (const e of els) if (e.type === 'pswitch') { const c = on(key(e.id, '1')); st.closed[e.id] = c; const n = props(e).sensor; if (n) sensors.set(n, (sensors.get(n) || false) || c); }
  for (const e of els) {
    if (e.type !== 'cyl1' && e.type !== 'cyl2') continue;
    const P = props(e), x = st.x[e.id] || 0;
    if (P.s0) sensors.set(P.s0, (sensors.get(P.s0) || false) || x <= END);
    if (P.s1) sensors.set(P.s1, (sensors.get(P.s1) || false) || x >= 1 - END);
  }
  return { sensors, leaks };
}

/** État d'un élément pour son dessin : position, piston, pression de ses orifices. */
export const viewOf = (st, e) => ({ tm: (st.tm || {})[e.id] || 0, pos: st.pos[e.id] || 0, x: st.x[e.id] || 0, rightOn: !!st.rightOn[e.id], closed: !!(st.closed || {})[e.id], bar: p => (st.bar ? st.bar[key(e.id, p)] : null), press: p => st.press[key(e.id, p)], on: p => ['P', 'CP'].includes(st.press[key(e.id, p)]) });
/** État d'un orifice (pour la couleur des tuyaux). */
export const portState = (st, id, p) => st.press[key(id, p)] || null;
