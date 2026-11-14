// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : le modèle physique, au choix du circuit (« Modèle : physique »). Sur les mêmes distributeurs et les
// mêmes tuyaux que le modèle tout ou rien (sim.js), il calcule :
// - la pression de chaque volume (orifices reliés par des tuyaux, chambres des vérins), air parfait à 20 °C,
//   isotherme : p·V = m·r·T ;
// - le débit de chaque passage (distributeur, réducteur, clapet, source, échappement) selon la norme ISO 6358 :
//   conductance sonique C (dm³/(s·bar)), rapport critique b = 0,5 ; débit bloqué (sonique) sous b ;
// - le mouvement de chaque piston : force = pression × section (côté tige : section annulaire), moins la charge, le
//   ressort (simple effet) et les frottements (sec et visqueux), sur la masse mobile ; butées en fin de course.
// Les conductances sont des ordres de grandeur de catalogue : un distributeur 5/2 de la série AirTAC 4V200 a une
// section équivalente de 14 mm², soit C ≈ S ÷ 5 = 2,8 dm³/(s·bar) ; un 3/2 de petite taille, environ 1,5.
import { DEFS, props, portsOf } from './elements.js';
import { valvePos, passages, VENTS, pushKey, camOn } from './sim.js';

export const P0 = 101325;            // pression atmosphérique (Pa)
const RT = 287.05 * 293.15;          // r·T de l'air à 20 °C (J/kg)
const RHO0 = 1.185;                  // masse volumique de l'air dans les conditions de référence ISO 8778 (kg/m³)
const B = 0.5;                       // rapport de pression critique (ISO 6358)
const H = 2e-4;                      // pas de calcul (s)
/** Conductances soniques (dm³/(s·bar)) par élément. */
const COND = { v32: 1.5, v52: 2.8, v53: 2.8, frl: 5, shuttle: 1.5, twopress: 1.5, flowctl: 2, supply: 10 };
const V_PORT = 1e-6, V_TUBE = 6e-6, V_DEAD = 2e-6; // volumes (m³) : orifice, tuyau de 50 cm (Ø 4 mm), espace mort d'une chambre
const key = (id, p) => `${id}:${p}`;
const bar = p => (p - P0) / 1e5;

/** Débit massique (kg/s) à travers une conductance C (dm³/(s·bar)) d'une pression amont pu vers une pression aval pd. */
export function flow(C, pu, pd) {
  if (pu <= pd || C <= 0) return 0;
  const Cs = C * 1e-8, r = pd / pu; // dm³/(s·bar) → m³/(s·Pa)
  return r <= B ? Cs * pu * RHO0 : Cs * pu * RHO0 * Math.sqrt(1 - ((r - B) / (1 - B)) ** 2);
}

/** Vérin : sections (m²), course (m), masse (kg), charge (N), ressort (simple effet). */
export function cylOf(e) {
  const P = props(e), D = (+P.bore || 25) / 1000, d = Math.min((+P.rod || 10) / 1000, D * 0.8);
  const A = Math.PI * D * D / 4, Ar = Math.PI * d * d / 4;
  return { A, Aa: A - Ar, S: Math.max(0.005, (+P.stroke || 100) / 1000), M: Math.max(0.05, +P.mass || 1), load: +P.load || 0, Fc: 10 + 0.03 * A * 6e5, c: 40, single: e.type === 'cyl1' };
}

/** Un pas du modèle physique (même contrat que step() de sim.js). */
export function stepPhysical(circuit, st, io, dt) {
  const els = circuit.elements.filter(e => DEFS[e.type]);
  const ports = new Map(), linked = new Set(), tubes = [];
  for (const e of els) for (const p of portsOf(e)) ports.set(key(e.id, p.id), { el: e, port: p });
  for (const t of circuit.tubes || []) {
    const a = key(t.a[0], t.a[1]), b = key(t.b[0], t.b[1]);
    if (ports.has(a) && ports.has(b) && a !== b) { tubes.push([a, b]); linked.add(a); linked.add(b); }
  }
  // Volumes : orifices reliés par des tuyaux (sans perte) ; un orifice libre d'un élément qui laisse passer l'air
  // est à l'air libre (ATM).
  const parent = new Map([...ports.keys()].map(k => [k, k]));
  const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (const [a, b] of tubes) parent.set(find(a), find(b));
  const net = k => (!linked.has(k) && VENTS.has(ports.get(k).el.type) ? 'ATM' : find(k));
  st.pr = st.pr || {}; st.v = st.v || {}; st.xm = st.xm || {}; st.F = st.F || {}; st.closed = st.closed || {};
  const cyls = els.filter(e => e.type === 'cyl1' || e.type === 'cyl2').map(e => ({ e, g: cylOf(e) }));
  for (const { e, g } of cyls) if (st.xm[e.id] == null) st.xm[e.id] = (st.x[e.id] || 0) * g.S;
  const tubesIn = new Map();
  for (const [a] of tubes) { const n = net(a); tubesIn.set(n, (tubesIn.get(n) || 0) + 1); }
  const supply = els.find(e => e.type === 'supply'), pS = P0 + 1e5 * (supply ? +props(supply).bar || 6 : 6);
  const members = new Map();
  for (const [k, v] of ports) { const n = net(k); if (!members.has(n)) members.set(n, []); members.get(n).push(v); }
  const volumeOf = n => {
    let V = (tubesIn.get(n) || 0) * V_TUBE;
    for (const v of members.get(n) || []) {
      V += V_PORT;
      if (v.el.type === 'cyl1' || v.el.type === 'cyl2') { const g = cylOf(v.el), x = st.xm[v.el.id] || 0; V += v.port.id === '1' ? g.A * x + V_DEAD : g.Aa * (g.S - x) + V_DEAD; }
    }
    return V;
  };
  const nets = [...new Set([...ports.keys()].map(net))].filter(n => n !== 'ATM');
  const pOf = n => (n === 'ATM' ? P0 : n === 'SUP' ? pS : st.pr[n] ?? P0);
  for (const n of nets) if (st.pr[n] == null) st.pr[n] = P0;
  const pilotOn = k => { const n = net(k), b = bar(pOf(n)); return b >= 2 || (b >= 1 && (st.pilot || {})[k]); };
  const active = (e, kind, coil, pilot, side) => {
    if (kind === 'sol') return !!(coil && io.coil(coil));
    if (kind === 'push') return !!io.pushed(pushKey(e.id, side));
    if (kind === 'roller') return camOn(els, st, props(e));
    if (kind === 'pilot') { const k = key(e.id, pilot), on = pilotOn(k); (st.pilot = st.pilot || {})[k] = on; return on; }
    return false;
  };
  const leaks = new Map();
  for (let t = 0; t < dt - 1e-9; t += H) {
    const h = Math.min(H, dt - t);
    // 1. Distributeurs, puis passages : [volume a, volume b, C de a vers b, C de b vers a, orifice libre éventuel].
    const conns = [];
    const add = (e, p, q, Cpq, Cqp = Cpq) => { const a = key(e.id, p), b = key(e.id, q); if (ports.has(a) && ports.has(b)) conns.push([net(a), net(b), Cpq, Cqp, [a, b]]); };
    for (const e of els) {
      const P = props(e);
      if (e.type === 'v32' && P.act === 'tempo') { st.tm = st.tm || {}; st.tm[e.id] = active(e, 'pilot', '', '12', 'L') ? (st.tm[e.id] || 0) + h : 0; } // temporisateur : temps de pilotage
      if (e.type === 'v32' || e.type === 'v52' || e.type === 'v53') st.pos[e.id] = valvePos(e, P, st.pos[e.id] || 0, active, st);
      const pos = st.pos[e.id] || 0;
      if (['frl', 'v32', 'v52', 'v53'].includes(e.type)) for (const [p, q] of passages(e, P, pos)) add(e, p, q, COND[e.type]);
      if (e.type === 'flowctl') add(e, '1', '2', COND.flowctl, COND.flowctl * Math.max(0.02, Math.min(1, (+P.open || 0) / 100)));
      if (e.type === 'shuttle' || e.type === 'twopress') {
        const p1 = pOf(net(key(e.id, '1'))), p3 = pOf(net(key(e.id, '3'))), hi = e.type === 'shuttle' ? p1 >= p3 : p1 <= p3;
        // OU : la bille laisse passer l'entrée la plus pressée ; ET : la sortie suit l'entrée la moins pressée.
        if (Math.abs(p1 - p3) < 2000) { add(e, '1', '2', COND[e.type]); add(e, '3', '2', COND[e.type]); } else add(e, hi ? '1' : '3', '2', COND[e.type]);
      }
      if (e.type === 'supply' && linked.has(key(e.id, '1'))) conns.push(['SUP', net(key(e.id, '1')), COND.supply, 0, null]);
    }
    // 2. Débits, limités à ce qui égalise les deux pressions sur ce pas (pas d'oscillation numérique).
    const dm = new Map(), V = new Map(nets.map(n => [n, volumeOf(n)]));
    for (const [a, b, Cab, Cba, pk] of conns) {
      if (a === b) continue;
      const pa = pOf(a), pb = pOf(b), up = pa >= pb ? a : b, dn = up === a ? b : a, pu = Math.max(pa, pb), pd = Math.min(pa, pb);
      let q = flow(up === a ? Cab : Cba, pu, pd) * h;
      const inv = (V.has(up) ? 1 / V.get(up) : 0) + (V.has(dn) ? 1 / V.get(dn) : 0);
      if (inv > 0) q = Math.min(q, (pu - pd) / (RT * inv));
      if (V.has(up)) dm.set(up, (dm.get(up) || 0) - q);
      if (V.has(dn)) dm.set(dn, (dm.get(dn) || 0) + q);
      // Orifice de travail laissé libre, sous pression : une fuite.
      if (pk && (a === 'ATM' || b === 'ATM') && q / h > 2e-5) for (const k of pk) if (net(k) === 'ATM' && !ports.get(k).port.exhaust) leaks.set(k, { el: ports.get(k).el.id, port: ports.get(k).port.id });
    }
    // 3. Masses d'air, puis pistons (forces aux pressions de ce pas), puis pressions dans les nouveaux volumes.
    const m = new Map(nets.map(n => [n, pOf(n) * V.get(n) / RT + (dm.get(n) || 0)]));
    for (const { e, g } of cyls) {
      const pA = pOf(net(key(e.id, '1'))), pB = g.single ? P0 : pOf(net(key(e.id, '2'))), x = st.xm[e.id], v = st.v[e.id] || 0;
      let F = (pA - P0) * g.A - (pB - P0) * g.Aa - g.load;
      if (g.single) F -= g.A * 6e5 * (0.1 + 0.1 * x / g.S); // ressort de rappel : 10 % de la poussée à 6 bar tige rentrée, 20 % tige sortie
      st.F[e.id] = F;
      let a = 0;
      if (Math.abs(v) < 1e-6 && Math.abs(F) <= g.Fc) a = 0; // adhérence : le piston ne part pas
      else a = (F - Math.sign(v || F) * g.Fc - g.c * v) / g.M;
      let nv = v + a * h, nx = x + nv * h;
      if (v !== 0 && Math.sign(nv) !== Math.sign(v) && Math.abs(F) <= g.Fc) nv = 0; // le frottement l'arrête sans le renvoyer
      if (nx <= 0) { nx = 0; if (nv < 0) nv = 0; }
      if (nx >= g.S) { nx = g.S; if (nv > 0) nv = 0; }
      st.xm[e.id] = nx; st.v[e.id] = nv; st.x[e.id] = nx / g.S;
    }
    for (const n of nets) st.pr[n] = Math.max(P0 * 0.2, m.get(n) * RT / volumeOf(n));
  }
  st.leaks = [...leaks.values()];
  st.t = (st.t || 0) + dt;
  // 4. État pour l'affichage (couleur des tuyaux, manomètres) et capteurs.
  st.press = {}; st.bar = {};
  const sb = (pS - P0) / 1e5;
  for (const k of ports.keys()) {
    const b = bar(pOf(net(k)));
    st.bar[k] = b; st.press[k] = b >= 0.5 * sb ? 'P' : b < 0.3 ? 'E' : 'M';
  }
  st.sup = new Map(); st.ven = new Map();
  const sensors = new Map(), END = 0.02;
  for (const { e } of cyls) {
    const P = props(e), x = st.x[e.id] || 0;
    if (P.s0) sensors.set(P.s0, (sensors.get(P.s0) || false) || x <= END);
    if (P.s1) sensors.set(P.s1, (sensors.get(P.s1) || false) || x >= 1 - END);
  }
  for (const e of els) if (e.type === 'pswitch') {
    const P = props(e), b = st.bar[key(e.id, '1')] || 0, was = !!st.closed[e.id];
    const c = was ? b >= (+P.bar || 3) - 0.3 : b >= (+P.bar || 3); // hystérésis de 0,3 bar
    st.closed[e.id] = c; if (P.sensor) sensors.set(P.sensor, (sensors.get(P.sensor) || false) || c);
  }
  return { sensors, leaks: st.leaks };
}
