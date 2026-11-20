// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Finesse du maillage d'un modèle CAO importé. Un fichier STEP décrit des surfaces exactes : c'est à la lecture
// qu'on choisit en combien de triangles les découper. Une carte détaillée peut en donner des centaines de milliers,
// et l'atelier ralentit. On relit donc le fichier de plus en plus grossièrement jusqu'à tenir dans un budget :
// les formes restent celles du fichier (rien n'est « simplifié » après coup), seules les courbes ont moins de facettes.
// Module pur : la lecture elle-même est donnée par l'appelant.

/** Niveaux de lecture, du plus fin au plus grossier : écart toléré (part de la taille du modèle) et angle (radians). */
export const LEVELS = [
  { linear: 0.0015, angular: 0.4 },
  { linear: 0.004, angular: 0.6 },
  { linear: 0.01, angular: 0.9 },
  { linear: 0.025, angular: 1.2 }
];
/** Triangles qu'un modèle importé peut compter avant que l'atelier ralentisse ; moins en mode léger. */
export const budgetFor = light => (light ? 80000 : 250000);
/** Nombre de triangles d'une lecture (maillages du lecteur STEP : un tableau d'indices par maillage). */
export const trisOf = meshes => meshes.reduce((n, m) => n + Math.floor(((m.index && m.index.array && m.index.array.length) || 0) / 3), 0);

/**
 * Lit au niveau le plus fin qui tient dans le budget. read(niveau) → maillages, ou null si la lecture échoue.
 * Rend { meshes, tris, level (rang du niveau gardé), first (triangles de la lecture la plus fine) } ; null si même
 * la première lecture échoue. Une lecture plus grossière qui échoue ou n'allège pas garde la précédente.
 */
export function readWithin(read, budget, levels = LEVELS) {
  let best = null, first = 0;
  for (let i = 0; i < levels.length; i++) {
    const meshes = read(levels[i]);
    if (!meshes || !meshes.length) { if (!best) return null; break; }
    const tris = trisOf(meshes);
    if (!best) first = tris;
    if (best && tris >= best.tris) break;
    best = { meshes, tris, level: i };
    if (tris <= budget) break;
  }
  return { ...best, first };
}
