// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : un pas de la partie commande et de la partie opérative, partagé par l'application, le vérificateur
// des TP et les tests. Dans l'ordre : le GRAFCET lit ses entrées (capteurs du pas précédent, boutons du pupitre,
// montage) et évolue ; ses actions s'ajoutent aux bobines excitées par la carte ; le circuit avance (tout ou rien ou
// modèle physique) ; les mouvements des vérins sont relevés.
import { createState, step } from './sim.js';
import { stepPhysical } from './physics.js';
import { compileGrafcet, createGrafRun, scanGrafcet, receptivities } from './grafcet.js';
import { createRecorder, record } from './seq.js';

/** Bouton du pupitre du GRAFCET dans l'ensemble des boutons appuyés : « @dcy ». */
export const inputKey = name => '@' + String(name).toLowerCase();
const compiledCache = new WeakMap();
/** GRAFCET compilé (gardé tant que l'objet ne change pas : chaque modification en crée un nouveau). */
export function compiled(g) {
  if (!g || !Array.isArray(g.steps) || !g.steps.length) return null;
  let c = compiledCache.get(g); if (!c) { c = compileGrafcet(g); compiledCache.set(g, c); }
  return c;
}
/** Simulation vide : état du circuit, du GRAFCET, relevé des mouvements, temps. */
export const createRunner = () => ({ st: createState(), g: createGrafRun(), rec: createRecorder(), t: 0, res: null, out: new Set(), gOut: new Set() });

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
  const io2 = { coil: n => !!io.coil(n) || R.out.has(String(n).toUpperCase()), pushed: io.pushed };
  R.res = (circuit.model === 'physical' ? stepPhysical : step)(circuit, R.st, io2, dt);
  R.t += dt; record(R.rec, circuit, R.st, R.t);
  return R.res;
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
