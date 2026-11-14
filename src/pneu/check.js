// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : vérification du circuit sans le simuler. Une source d'air, des distributeurs alimentés, des vérins
// raccordés, et des repères (Y1, B1…) qui existent dans le montage électronique, chacun à un seul endroit.
// bench : { coils: [noms des électrovannes coil24], sensors: [noms des capteurs de vérin cylsensor], inputs: [boutons
// et capteurs du montage, lus par le GRAFCET] }. Le GRAFCET du circuit (s'il commande) excite lui aussi des
// électrovannes et lit les capteurs des vérins : ses repères n'ont pas besoin du montage.
import { tl } from '../i18n/index.js';
import { DEFS, props, portsOf, camTarget } from './elements.js';
import { compileGrafcet } from './grafcet.js';

export function checkPneu(c, bench = { coils: [], sensors: [] }) {
  const out = [], linked = new Set();
  const G = c.grafcet && c.grafcet.steps && c.grafcet.steps.length ? compileGrafcet(c.grafcet) : null;
  const drives = G && c.grafcet.drive !== false, gOut = drives ? G.outputs : new Set(), gVars = G ? G.vars : new Set();
  for (const t of c.tubes || []) { linked.add(`${t.a[0]}:${t.a[1]}`); linked.add(`${t.b[0]}:${t.b[1]}`); }
  const els = c.elements.filter(e => DEFS[e.type]), name = e => (props(e).label || DEFS[e.type].name());
  const has = (e, p) => linked.has(`${e.id}:${p}`);
  if (els.length && !els.some(e => e.type === 'supply')) out.push({ level: 'error', text: tl('Aucune source d’air comprimé : rien ne peut bouger.') });
  const coilUse = new Map(), sensorUse = new Map();
  for (const e of els) {
    const P = props(e);
    if ((e.type === 'v32' || e.type === 'v52' || e.type === 'v53') && !has(e, '1')) out.push({ level: 'error', text: tl('{0} : l’orifice 1 (alimentation) n’est pas raccordé.', name(e)) });
    if ((e.type === 'v52' || e.type === 'v53') && !has(e, '4') && !has(e, '2')) out.push({ level: 'warning', text: tl('{0} : ni 4 ni 2 n’est raccordé à un vérin.', name(e)) });
    if (e.type === 'v32' && !has(e, '2')) out.push({ level: 'warning', text: tl('{0} : l’orifice 2 (utilisation) n’est pas raccordé.', name(e)) });
    if (e.type === 'v32' && P.act === 'tempo' && !has(e, '12')) out.push({ level: 'warning', text: tl('{0} : l’orifice de pilotage 12 n’est pas raccordé : le temporisateur ne démarrera jamais.', name(e)) });
    for (const p of portsOf(e)) if (/^1[24]$/.test(p.id) && !has(e, p.id)) out.push({ level: 'error', text: tl('{0} : l’orifice de pilotage {1} n’est pas raccordé.', name(e), p.id) });
    if (e.type === 'v32' && P.act === 'roller') {
      if (!P.cam) out.push({ level: 'error', text: tl('{0} : choisissez le vérin dont la tige actionne ce galet.', name(e)) });
      else if (!camTarget(els, P.cam)) out.push({ level: 'error', text: tl('{0} : aucun vérin {1} dans le circuit pour actionner ce galet.', name(e), P.cam) });
    }
    const coils = e.type === 'v32' ? (P.act === 'sol' ? [P.coil] : []) : e.type === 'v52' || e.type === 'v53' ? [P.left === 'sol' ? P.coilL : null, P.right === 'sol' ? P.coilR : null].filter(x => x !== null) : [];
    for (const y of coils) {
      if (!y) { out.push({ level: 'error', text: tl('{0} : donnez à son électroaimant le repère d’une électrovanne du montage (Y1…).', name(e)) }); continue; }
      coilUse.set(y, (coilUse.get(y) || 0) + 1);
      if (!bench.coils.includes(y) && !gOut.has(y)) out.push({ level: 'error', text: G ? tl('{0} : l’électroaimant {1} n’est commandé ni par le GRAFCET ni par une électrovanne du montage.', name(e), y) : tl('{0} : aucune électrovanne {1} dans le montage électronique.', name(e), y) });
    }
    if (e.type === 'pswitch') {
      if (!has(e, '1')) out.push({ level: 'warning', text: tl('{0} : son orifice n’est pas raccordé.', name(e)) });
      if (!P.sensor) out.push({ level: 'warning', text: tl('{0} : donnez-lui le repère d’un pressostat du montage (S1…).', name(e)) });
      else { sensorUse.set(P.sensor, (sensorUse.get(P.sensor) || 0) + 1); if (!bench.sensors.includes(P.sensor)) out.push({ level: 'warning', text: tl('{0} : aucun contact {1} dans le montage électronique.', name(e), P.sensor) }); }
    }
    if (e.type === 'cyl1' || e.type === 'cyl2') {
      if (!has(e, '1')) out.push({ level: 'error', text: tl('{0} : la chambre arrière (orifice 1) n’est pas raccordée.', name(e)) });
      if (e.type === 'cyl2' && !has(e, '2')) out.push({ level: 'warning', text: tl('{0} : la chambre avant (orifice 2) n’est pas raccordée ; la tige ne rentrera que poussée.', name(e)) });
      for (const s of [P.s0, P.s1]) {
        if (!s) continue;
        sensorUse.set(s, (sensorUse.get(s) || 0) + 1);
        if (!bench.sensors.includes(s) && !gVars.has(s.toLowerCase())) out.push({ level: 'warning', text: tl('{0} : aucun capteur de vérin {1} dans le montage électronique.', name(e), s) });
      }
      if (P.s0 && P.s0 === P.s1) out.push({ level: 'error', text: tl('{0} : le même capteur {1} aux deux fins de course.', name(e), P.s0) });
    }
  }
  for (const [y, n] of coilUse) if (n > 1) out.push({ level: 'warning', text: tl('L’électrovanne {0} commande {1} distributeurs à la fois.', y, n) });
  for (const [s, n] of sensorUse) if (n > 1) out.push({ level: 'error', text: tl('Le capteur {0} est placé sur {1} fins de course.', s, n) });
  if (G) {
    for (const e of G.errors) out.push({ level: 'error', text: tl('GRAFCET : {0}', e.text) });
    // Variables lues : boutons du pupitre, capteurs du plan (vérins, pressostats), entrées du montage.
    const known = new Set([...G.inputNames, ...[...sensorUse.keys()].map(x => x.toLowerCase()), ...(bench.inputs || []).map(x => x.toLowerCase()), ...(bench.sensors || []).map(x => x.toLowerCase())]);
    for (const v of G.vars) if (!known.has(v)) out.push({ level: 'warning', text: tl('GRAFCET : « {0} » n’est ni un bouton du pupitre, ni un capteur du circuit, ni une entrée du montage (il reste à 0).', v) });
    const used = new Set(coilUse.keys());
    if (drives) for (const y of G.outputs) if (!used.has(y)) out.push({ level: 'warning', text: tl('GRAFCET : l’action {0} ne commande aucun électroaimant du circuit.', y) });
    if (G.trans.some(t => !t.expr)) out.push({ level: 'warning', text: tl('GRAFCET : une transition n’a pas de réceptivité (elle ne sera jamais franchie).') });
  }
  return out;
}
