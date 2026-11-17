// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : un pas de la partie commande et de la partie opérative, partagé par l'application, le vérificateur
// des TP et les tests. Dans l'ordre : le GRAFCET lit ses entrées (capteurs du pas précédent, boutons du pupitre,
// montage) et évolue ; l'automate (Ladder) fait son cycle (il lit aussi les étapes du GRAFCET) ; leurs actions
// s'ajoutent aux bobines excitées par la carte ; le circuit avance (tout ou rien ou modèle physique) ; les mouvements
// des vérins sont relevés.
import { createState, step } from './sim.js';
import { stepPhysical } from './physics.js';
import { compileGrafcet, createGrafRun, scanGrafcet, receptivities } from './grafcet.js';
import { compilePlc, createPlcRun, scanPlc } from '../plc/ladder.js';
import { createRecorder, record } from './seq.js';
import { processOf, createProcess, stepProcess, processSensors, cylPositions } from './process.js';

/** Bouton du pupitre du GRAFCET dans l'ensemble des boutons appuyés : « @dcy ». */
export const inputKey = name => '@' + String(name).toLowerCase();
const compiledCache = new WeakMap();
/** GRAFCET compilé (gardé tant que l'objet ne change pas : chaque modification en crée un nouveau). */
export function compiled(g) {
  if (!g || !Array.isArray(g.steps) || !g.steps.length) return null;
  let c = compiledCache.get(g); if (!c) { c = compileGrafcet(g); compiledCache.set(g, c); }
  return c;
}
const plcCache = new WeakMap();
/** Automate compilé (gardé tant que l'objet ne change pas). */
export function compiledPlc(p) {
  if (!p || !Array.isArray(p.rungs) || !p.rungs.length) return null;
  let c = plcCache.get(p); if (!c) { c = compilePlc(p); plcCache.set(p, c); }
  return c;
}
/** Simulation vide : état du circuit, du GRAFCET, de l'automate, relevé des mouvements, temps. */
export const createRunner = () => ({ st: createState(), g: createGrafRun(), p: createPlcRun(), rec: createRecorder(), t: 0, res: null, out: new Set(), gOut: new Set(), pOut: new Set(), proc: null });

/** Lecture d'une variable du GRAFCET (nom en minuscules) : bouton du pupitre, capteur du plan, entrée du montage. */
function readerOf(R, C, io) {
  const sens = new Map(); if (R.res) for (const [k, v] of R.res.sensors) sens.set(k.toLowerCase(), (sens.get(k.toLowerCase()) || false) || v);
  return n => (C.inputNames.has(n) ? !!io.pushed(inputKey(n)) : sens.has(n) ? sens.get(n) : !!(io.input && io.input(n)));
}

/**
 * Un pas de dt s. io : { coil(repère) → bobine excitée par la carte, pushed(clé) → bouton appuyé (distributeur, ou
 * « @nom » pour le pupitre du GRAFCET), input(nom) → entrée du montage (bouton, capteur) }. Rend le résultat du pas.
 */
export function runStep(R, circuit, io, dt) {
  const C = compiled(circuit.grafcet);
  if (C) {
    const r = scanGrafcet(C, R.g, readerOf(R, C, io), dt);
    R.gOut = r.outputs; R.out = circuit.grafcet.drive === false ? new Set() : r.outputs;
  } else { R.gOut = new Set(); R.out = new Set(); }
  const P = compiledPlc(circuit.plc);
  if (P) {
    const r = scanPlc(P, R.p, plcReader(R, P, C, io), dt);
    R.pOut = r.outputs; if (circuit.plc.drive !== false) for (const n of r.outputs) R.out.add(n);
  } else R.pOut = new Set();
  const io2 = { coil: n => !!io.coil(n) || R.out.has(String(n).toUpperCase()), pushed: io.pushed };
  R.res = (circuit.model === 'physical' ? stepPhysical : step)(circuit, R.st, io2, dt);
  // Le procédé de la machine (magasin, embouteillage, barrière) avance avec les vérins ; ses capteurs s'ajoutent à ceux
  // du plan et sont lus au pas suivant, comme les fins de course.
  // Le jumeau construit (scène « twin ») lit aussi les sorties (convoyeur, voyant, ventouse, bec) ; sa structure
  // changée (key) repart d'un état neuf.
  const D = processOf(circuit.scene);
  if (D) {
    if (!R.proc || R.proc.kind !== D.kind || (D.key && R.proc.key !== D.key)) R.proc = createProcess(D);
    stepProcess(R.proc, dt, cylPositions(circuit, R.st.x), io2.coil, D);
    for (const [n, v] of processSensors(circuit.scene, R.proc)) R.res.sensors.set(n, v);
  } else R.proc = null;
  R.t += dt; record(R.rec, circuit, R.st, R.t);
  return R.res;
}
/**
 * Lecture d'une entrée de l'automate (nom en minuscules) : bouton du pupitre (le sien ou celui du GRAFCET), étape
 * active du GRAFCET (x3), capteur du plan, entrée du montage.
 */
function plcReader(R, P, C, io) {
  const sens = new Map(); if (R.res) for (const [k, v] of R.res.sensors) sens.set(k.toLowerCase(), (sens.get(k.toLowerCase()) || false) || v);
  return n => {
    if (P.inputs.has(n) || (C && C.inputNames.has(n))) return !!io.pushed(inputKey(n));
    const m = /^x(\d+)$/.exec(n); if (m && C) return !!(R.g.X && R.g.X.has(+m[1]));
    if (sens.has(n)) return sens.get(n);
    return !!(io.input && io.input(n));
  };
}
/** Valeur d'une variable lue par l'automate (affichage de la table) : comme pendant le cycle. */
export function readPlcVar(R, circuit, io, name) {
  const P = compiledPlc(circuit.plc) || { inputs: new Set() }, l = String(name).toLowerCase();
  if (P.written && P.written.has(l)) return !!R.p.bits.get(l);
  if (P.timers && P.timers.has(l)) return !!(R.p.timers.get(l) || {}).q;
  if (P.counters && P.counters.has(l)) return !!(R.p.counters.get(l) || {}).q;
  if (l === 'init') return R.p.scan === 1;
  return plcReader(R, P, compiled(circuit.grafcet), io)(l);
}
/** Valeur de chaque réceptivité du GRAFCET maintenant (affichage), alignée sur compiled(g).trans. */
export function liveReceptivities(R, circuit, io) {
  const C = compiled(circuit.grafcet); if (!C) return [];
  return receptivities(C, R.g, readerOf(R, C, io));
}
/** Valeur d'une variable du GRAFCET (affichage des capteurs du pupitre). */
export function readVar(R, circuit, io, name) {
  const C = compiled(circuit.grafcet) || { inputNames: new Set() };
  return readerOf(R, C, io)(String(name).toLowerCase());
}
