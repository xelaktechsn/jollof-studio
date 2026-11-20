// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mesure des tests de performance du réseau (src/net/*.test.mjs). On mesure le temps CPU du processus (process.cpuUsage)
// et non l'heure murale : node --test lance chaque fichier dans son propre processus, et les autres fichiers qui tournent
// en même temps (émulateurs, compilations) allongent l'heure murale sans changer le travail fait ici. Le temps CPU du
// processus compte aussi les fils de V8 (compilation et ramasse-miettes en tâche de fond) : avant chaque passage, une
// courte pause les laisse finir ce que les passages d'avant ont lancé, et on garde le meilleur de plusieurs passages
// (best) ou leur médiane (median). Pas de ramasse-miettes forcé : il laisserait du balayage à faire pendant la mesure.
// JOLLOF_PERF_LOG=fichier : chaque mesure y est ajoutée (étiquette, ms, seuil), pour suivre les marges.
import fs from 'node:fs';

/** Seuils stricts demandés (mesure seule) : les seuils CPU sont les mêmes ; la variable reste pour les scripts. */
export const STRICT = !!process.env.JOLLOF_PERF_STRICT;
/** Facteur des seuils de temps : 1, les seuils sont tenus en temps CPU même dans la suite complète. */
export const PERF = 1;

const pause = new Int32Array(new SharedArrayBuffer(4));
/** Pause (ms) sans rendre la main : les fils de V8 finissent leur travail en cours. */
export const settle = (ms = 25) => { Atomics.wait(pause, 0, 0, ms); };
/** Temps CPU (ms) de f() : { ms, value }. */
export function cpu(f) {
  const c = process.cpuUsage(), value = f(), d = process.cpuUsage(c);
  return { ms: (d.user + d.system) / 1000, value };
}
/** Temps CPU (ms) d'un seul passage de f() (mesure à froid : premier calcul, générateur) : { ms, value }. */
export function once(f) { settle(); return cpu(f); }
/** Meilleur temps CPU (ms) de n passages de f(), après warm passages d'échauffement ; before() avant chaque passage. */
export function best(f, n = 5, warm = 1, before = null) {
  for (let i = 0; i < warm; i++) { if (before) before(); f(); }
  let m = Infinity;
  for (let i = 0; i < n; i++) { if (before) before(); settle(); m = Math.min(m, cpu(f).ms); }
  return m;
}
/** Médiane des temps CPU (ms) de n passages de f(), après warm passages ; before() avant chaque passage (hors mesure). */
export function median(f, n = 7, warm = 1, before = null) {
  for (let i = 0; i < warm; i++) { if (before) before(); f(); }
  const a = [];
  for (let i = 0; i < n; i++) { if (before) before(); settle(); a.push(cpu(f).ms); }
  a.sort((x, y) => x - y);
  return a[a.length >> 1];
}
/** Note une mesure (JOLLOF_PERF_LOG) et rend le message d'assertion : « étiquette : 12.3 ms (seuil 50 ms) ». */
export function note(label, ms, limit) {
  const msg = `${label} : ${ms.toFixed(2)} ms CPU (seuil ${limit} ms)`;
  if (process.env.JOLLOF_PERF_LOG) { try { fs.appendFileSync(process.env.JOLLOF_PERF_LOG, `${label}\t${ms.toFixed(3)}\t${limit}\n`); } catch (e) { /* journal facultatif */ } }
  return msg;
}
