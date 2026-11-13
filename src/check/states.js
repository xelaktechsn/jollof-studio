// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// États atteignables d'un montage : tout ce qui peut changer pendant qu'il fonctionne. Boutons relâchés ou
// appuyés, relais au repos ou collés, potentiomètres aux deux butées et au milieu, sorties des capteurs à
// leurs extrêmes, et chaque broche que le programme commande, à l'état bas comme à l'état haut (ce qui
// borne aussi la PWM : le courant d'une impulsion est celui de l'état haut).
// Jusqu'à MAX états, on les essaie tous (preuve) ; au-delà, coins, une variable à la fois et tirage au sort.
import { boardOf, base } from '../sim/boards.js';
import { tl, DEC } from '../i18n/index.js';
import { pinRole } from './program.js';
import { pkgSensorOut } from '../sim/pkgparts.js';
import { genRange } from '../sim/analog-parts.js';

export const MAX_STATES = 4096;
// Sorties des capteurs simulés (models.js) : broche → [min, max] en fraction de leur alimentation ; abs : volts fixes
// (le PIR et la sonde d'humidité du sol ont leur propre régulateur 3,3 V). ECHO du HC-SR04 : 0 ou VCC.
const SENSOR_OUT = {
  pir: { OUT: [0, 3.3, true] }, ldr: { AO: [0.035, 0.98], DO: [0, 1] }, soil: { AOUT: [1.2, 3.0, true] }, hcsr04: { ECHO: [0, 1] },
  mq2: { AO: [0.049, 0.615], DO: [0, 1] }, sound: { AO: [0, 1], DO: [0, 1] }, joystick: { VRx: [0, 1], VRy: [0, 1] },
  'tilt-sw': { S: [0, 1] }, hall: { S: [0, 1] }, flame: { AO: [0.08, 0.95], DO: [0, 1] }, rain: { AO: [0.1, 0.95], DO: [0, 1] }, water: { S: [0, 0.7] },
  irobst: { OUT: [0, 1] }, line: { DO: [0, 1], AO: [0.1, 0.85] }, shock: { DO: [0, 1] },
  lm35: { VOUT: [0.02, 1.5, true] }, // 10 mV par °C, de 2 à 150 °C : volts fixes, quelle que soit l'alimentation
  ttp223: { SIG: [0, 1] }, rcwl0516: { OUT: [0, 3.3, true] }, mq135: { AO: [0.2, 0.39], DO: [0, 1] }, hx711: { DT: [0, 1] }
};
// Générateur de fonctions : sa sortie parcourt [décalage − amplitude, décalage + amplitude], en volts.
export const sensorOutputs = c => SENSOR_OUT[c.type] || (c.type === 'siggen' ? { OUT: [...genRange(c.inp), true] } : null) || pkgSensorOut(c.type) || null;

/**
 * Variables d'état : [{ comp, key?, pin? (broche de carte), id, values: [...], text(v), apply(v, ctx) }].
 * ctx (rempli par apply) : { pins: Map carte → Map clé → état de broche, sensors: Map « id|clé » → volts }.
 * facts : Map carte → faits du programme (program.js) ; wired(ref) : la broche est-elle reliée ?
 * supplyOf(c) : tension d'alimentation d'un capteur (ses sorties analogiques en sont une fraction).
 */
export function stateVars(comps, facts, wired, supplyOf = () => 5) {
  const vars = [], fixed = [];
  for (const c of comps) {
    const n = c.name;
    if (c.type === 'pressostat' && c.pins['1']) vars.push({ comp: c, id: `${c.id}|pressed`, values: [false, true], text: v => (v ? tl('{0} : pression atteinte', n) : tl('{0} : sous le seuil', n)), apply: v => { c.inp.pressed = v; } });
    if (c.type === 'cylsensor' && c.pins['1']) vars.push({ comp: c, id: `${c.id}|pressed`, values: [false, true], text: v => (v ? tl('{0} : piston devant', n) : tl('{0} : piston absent', n)), apply: v => { c.inp.pressed = v; } });
    if (c.type === 'button' && c.pins['1']) vars.push({ comp: c, id: `${c.id}|pressed`, values: [false, true], text: v => (v ? tl('{0} appuyé', n) : tl('{0} relâché', n)), apply: v => { c.inp.pressed = v; } });
    if (c.type === 'joystick' && c.pins.SW) vars.push({ comp: c, id: `${c.id}|sw`, values: [false, true], text: v => (v ? tl('{0} enfoncé', n) : tl('{0} relâché', n)), apply: v => { c.inp.sw = v; } });
    if (c.type === 'pot') vars.push({ comp: c, id: `${c.id}|pos`, values: [50, 0, 100], text: v => tl('{0} à {1} %', n, v), apply: v => { c.inp.pos = v; } });
    // Minuterie NE555 : sa bascule, sortie basse (décharge fermée) ou haute ; imposée au calcul comme une sortie de capteur.
    if (c.type === 'ne555' && ['OUT', 'DIS'].some(k => c.pins[k] && wired({ comp: c, key: k }))) vars.push({ comp: c, id: `${c.id}|q`, values: [0, 1], text: v => (v ? tl('{0} sortie haute', n) : tl('{0} sortie basse', n)), apply: (v, cx) => cx.sensors.set(`${c.id}|q`, v) });
    if (c.type === 'relay' && c.pins.COM && ['COM', 'NO', 'NC'].some(k => wired({ comp: c, key: k }))) vars.push({ comp: c, id: `${c.id}|on`, values: [false, true], text: v => (v ? tl('{0} collé', n) : tl('{0} au repos', n)), apply: v => { c.relayOn = v; } });
    const so = sensorOutputs(c); // capteurs de la bibliothèque et capteurs en paquet (.jpart)
    if (so) for (const [k, [lo, hi, abs]] of Object.entries(so)) {
      if (!c.pins[k] || !wired({ comp: c, key: k })) continue;
      const sup = supplyOf(c), vs = abs ? [lo, hi] : [lo * sup, hi * sup].map(x => Math.round(x * 100) / 100);
      vars.push({ comp: c, id: `${c.id}|${k}`, values: vs, text: v => `${n} ${k} = ${String(v).replace('.', DEC)} V`, apply: (v, cx) => cx.sensors.set(`${c.id}|${k}`, v) });
    }
    // Servo et pas à pas : toujours au pire (en mouvement, ils tirent leur plus grand courant).
    if (c.type === 'servo') fixed.push(() => { c.servoBusy = true; });
    if (c.type === 'stepper') fixed.push(() => { c.stepBusy = true; });
    const p = boardOf(c), f = p && facts.get(c);
    if (!p || !f) continue;
    const keys = new Set();
    for (const [k, pf] of f.pins) {
      const role = pinRole(pf); keys.add(k);
      const ref = { comp: c, key: k };
      if (role === 'out' && wired(ref)) vars.push({ comp: c, key: k, pin: true, id: `${c.id}|${k}`, values: [0, 1], text: v => `${n} ${k} = ${v ? 'HIGH' : 'LOW'}`, apply: (v, cx) => pinOf(cx, c).set(k, { mode: 1, d: v, pwm: null }) });
      else if (role === 'pullup' || role === 'pulldown' || role === 'in') { const st = { mode: role === 'pullup' ? 2 : role === 'pulldown' ? 3 : 0, d: 0, pwm: null }; fixed.push((cx) => pinOf(cx, c).set(k, st)); }
    }
    // Programme à broches calculées : toute autre broche reliée peut être une sortie (prudence).
    if (f.dynamic) for (const k in p.gpio) {
      if (keys.has(k) || !wired({ comp: c, key: k })) continue;
      vars.push({ comp: c, key: k, pin: true, id: `${c.id}|${k}`, values: [0, 1], text: v => `${n} ${k} = ${v ? 'HIGH' : 'LOW'}`, apply: (v, cx) => pinOf(cx, c).set(k, { mode: 1, d: v, pwm: null }), dyn: true });
    }
  }
  return { vars, fixed };
}
const pinOf = (cx, c) => { if (!cx.pins.has(c)) cx.pins.set(c, new Map()); return cx.pins.get(c); };

/** Nombre d'états de l'espace complet. */
export const spaceSize = vars => vars.reduce((t, v) => t * v.values.length, 1);

/**
 * Suite d'affectations (tableaux d'indices de valeurs). Complet si l'espace tient en MAX_STATES,
 * sinon coins + une variable à la fois + tirage reproductible : { list, complete }.
 */
export function assignments(vars, max = MAX_STATES) {
  const n = vars.length, size = spaceSize(vars);
  if (size <= max) {
    const list = [], idx = new Array(n).fill(0);
    for (let s = 0; s < size; s++) {
      list.push(idx.slice());
      for (let i = 0; i < n; i++) { idx[i]++; if (idx[i] < vars[i].values.length) break; idx[i] = 0; }
    }
    return { list, complete: true };
  }
  const seen = new Set(), list = [], push = a => { const k = a.join(','); if (!seen.has(k)) { seen.add(k); list.push(a); } };
  push(new Array(n).fill(0)); push(vars.map(v => v.values.length - 1));
  for (let i = 0; i < n; i++) for (let j = 1; j < vars[i].values.length; j++) { const a = new Array(n).fill(0); a[i] = j; push(a); const b = vars.map(v => v.values.length - 1); b[i] = j - 1; push(b); }
  // Tirage reproductible (mulberry32) : les bits de poids faible d'un générateur congruentiel alterneraient.
  let seed = 12345;
  const rnd = k => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % k; };
  for (let t = 0; list.length < max && t < max * 4; t++) push(vars.map(v => rnd(v.values.length)));
  return { list, complete: false };
}

/** Texte d'un état : les variables hors repos (la première valeur est le repos), ou toutes s'il y en a peu. */
export function stateText(vars, a) {
  const all = vars.length <= 4;
  const parts = vars.map((v, i) => (all || a[i] !== 0 ? v.text(v.values[a[i]]) : null)).filter(Boolean);
  return parts.length ? parts.join(', ') : tl('au repos');
}
export { base };
