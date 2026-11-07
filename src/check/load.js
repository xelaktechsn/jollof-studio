// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Projet .jollof (ou TP) → entrée du vérificateur, hors de l'application : composants avec leurs broches
// (d'après boards.js et parts.js), fils, programme de chaque carte (règles « auto » regénérées comme dans
// l'application). Sert à l'outil en ligne de commande (cli.mjs) et aux tests.
import { BOARDS, boardOf } from '../sim/boards.js';
import { PARTS, partOf } from '../sim/parts.js';
import { INPUTS } from '../sim/models.js';
import { analyze, inspect, bbGroups } from '../sim/circuit.js';
import { generate } from '../prog/rules.js';

const LEGS = { diode: ['A', 'K'], 'cap-100n': ['1', '2'], 'cap-100u': ['+', '-'], npn: ['C', 'B', 'E'], lm7805: ['IN', 'GND', 'OUT'], mb102: ['+5V', 'GND', '+3V3'], bat9v: ['+', '-'], bat18650: ['+', '-'] };
/** Broches d'un type de composant, comme les crée l'application. */
export function pinKeys(type) {
  const prof = BOARDS[type];
  if (prof) return [...Object.keys(prof.gpio), ...Object.keys(prof.power), 'GND', ...[2, 3, 4, 5, 6, 7, 8].map(n => `GND (${n})`), 'VIN', 'EN', 'RST', 'AREF', 'IOREF', 'VSYS', 'VBUS', '3V3_EN', 'RUN'];
  if (/^breadboard/.test(type)) return bbGroups({ type }).flatMap(g => g.keys);
  if (/^res-/.test(type)) return ['1', '2'];
  if (LEGS[type]) return LEGS[type];
  const sp = PARTS[type];
  return sp && sp.pins ? sp.pins.map(p => p.pin) : [];
}

/**
 * data : projet (comps, wires, settings) ; code : { NOM_DE_CARTE: texte } (solution d'un TP) facultatif.
 * Rend { comps, wires, programs: Map id → texte, allow, byId }.
 */
export function loadProject(data, code = null) {
  const comps = (data.comps || []).map(c => ({ ...c, name: c.name || c.id, pins: Object.fromEntries(pinKeys(c.type).map(k => [k, {}])), inp: { ...(INPUTS[c.type] || {}), ...(c.inp || {}) }, group: { position: { x: c.x || 0, z: c.z || 0 } } }));
  const byId = Object.fromEntries(comps.map(c => [c.id, c]));
  const wires = (data.wires || []).filter(w => byId[w.a[0]] && byId[w.b[0]]).map(w => ({ a: { comp: byId[w.a[0]], key: w.a[1] }, b: { comp: byId[w.b[0]], key: w.b[1] }, progress: 1 }));
  const programs = new Map(), auto = new Set(), prog = (data.settings && data.settings.prog) || {};
  const A = analyze(comps, wires), cache = new Map(), insp = c => cache.get(c) || (cache.set(c, inspect(c, A, partOf(c))), cache.get(c));
  for (const b of comps.filter(c => boardOf(c))) {
    let src = code ? code[b.name] || code[b.id] || null : null;
    const e = prog.boards && prog.boards[b.id];
    if (src == null && e) src = e.auto ? generate(b, { comps, A, inspect: insp, rules: prog.rules || [], states: prog.states || {} }) : e.code || '';
    if (src != null && !code && (!e || (e.auto && e.mode !== 'visual'))) auto.add(b.id);
    if (src == null && (prog.rules || []).length) src = generate(b, { comps, A, inspect: insp, rules: prog.rules, states: prog.states || {} });
    if (src) programs.set(b.id, src);
  }
  const allow = (data.settings && data.settings.check && Array.isArray(data.settings.check.allow)) ? data.settings.check.allow : [];
  return { comps, wires, programs, auto, allow, byId };
}
