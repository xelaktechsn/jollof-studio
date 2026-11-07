// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Simulation dans le temps (mode « Lab analogique ») : le montage est écrit pour ngspice (dc.js, spiceDeck en mode
// transitoire) puis calculé par ngspice compilé en WebAssembly, dans un fil à part. Le solveur continu (dc.js) reste
// le moteur de la simulation en direct et de la preuve du vérificateur ; ngspice montre les formes d'onde
// (oscilloscope : charge d'un condensateur, filtre, PWM lissée, 555…) sur une fenêtre de temps.
import { spiceDeck } from './dc.js';

let engine = null, starting = null;
/** Moteur ngspice (un seul, démarré au premier calcul). */
async function getEngine() {
  if (engine) return engine;
  if (!starting) starting = (async () => { const { Simulation } = await import('eecircuit-engine'); const s = new Simulation(); await s.start(); engine = s; return s; })();
  return starting;
}
/** Calcule un texte SPICE ; rend [{ name, values }] (temps puis tensions et courants). Un calcul à la fois. */
let queue = Promise.resolve();
export function runSpice(text) {
  const job = queue.then(async () => {
    const s = await getEngine();
    s.setNetList(text);
    const r = await s.runSim();
    const err = s.getError().filter(l => /error|fatal|singular|timestep too small/i.test(l));
    if (err.length && !r.numPoints) throw new Error(err.slice(0, 3).join(' · '));
    return r.data.map(d => ({ name: d.name, values: Float64Array.from(d.values) }));
  });
  queue = job.catch(() => {});
  return job;
}

let worker = null, seq = 0;
const pending = new Map();
/** Dans le navigateur : le calcul part dans analog.worker.js ; sous Node (tests) : sur place. */
function compute(text) {
  if (typeof Worker === 'undefined' || typeof window === 'undefined') return runSpice(text);
  if (!worker) {
    worker = new Worker(new URL('./analog.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.resolve(e.data.data) : p.reject(new Error(e.data.error)); };
    worker.onerror = e => { for (const p of pending.values()) p.reject(new Error(e.message || 'ngspice')); pending.clear(); worker = null; };
  }
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); worker.postMessage({ id, text }); });
}

/**
 * Fenêtre de transitoire du montage. ctx : comme solveDC (prof, pinState, sensorVolts). opts : { tstop (s), tstep (s),
 * freqOf(comp, clé) → Hz des sorties PWM }. Rend { t: Float64Array, volts(ref) → Float64Array | null, deck } ou null.
 */
export async function transient(comps, A, ctx, opts = {}) {
  const deck = spiceDeck(comps, A, ctx, 'tran', opts);
  if (!deck) return null;
  const data = await compute(deck.text);
  const time = data.find(d => d.name === 'time'), byNode = new Map(data.map(d => [d.name, d.values]));
  const nodeOf = new Map(deck.probes.flatMap(p => p.members.map(m => [`${m.comp.id}|${m.key}`, p.node])));
  return {
    t: time ? time.values : new Float64Array(0),
    volts(ref) {
      const n = nodeOf.get(`${ref.comp.id}|${ref.key}`); if (!n) return null;
      return byNode.get(`v(${n})`) || null;
    },
    deck
  };
}
