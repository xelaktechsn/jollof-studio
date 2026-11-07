// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import type { Answer, AssignmentSettings, CircuitAnswer, Item, ItemScore, SubmissionStatus } from '../database/entities';

export const roundHalf = (x: number) => Math.round(x * 2) / 2;

/** Choix : sélection exactement égale à la réponse attendue, sinon 0. */
export function gradeChoice(item: Extract<Item, { type: 'choice' }>, answer: Answer | undefined): ItemScore {
  const selected = answer && 'selected' in answer ? new Set(answer.selected) : new Set<string>();
  const ok = selected.size === item.correct.length && item.correct.every((c) => selected.has(c));
  return { points: ok ? item.points : 0, max: item.points, auto: true, comment: null };
}

/**
 * Circuit : une liaison attendue est juste si toutes ses broches sont dans une même liaison
 * de la copie et que celle-ci ne contient aucune broche d'une autre liaison attendue.
 * points × justes / attendues − faultPenalty % par erreur de câblage, plancher 0, arrondi à 0,5.
 */
export function gradeCircuit(item: Extract<Item, { type: 'circuit' }>, circuit: CircuitAnswer | null, faultPenalty: number): ItemScore {
  const expected = item.solution.nets;
  const given = (circuit?.nets ?? []).map((n) => new Set(n));
  const owner = new Map<string, number>();
  expected.forEach((net, i) => net.forEach((p) => owner.set(p, i)));

  let ok = 0;
  const missing: string[][] = [];
  expected.forEach((net, i) => {
    const good = given.some((g) => net.every((p) => g.has(p)) && [...g].every((p) => !owner.has(p) || owner.get(p) === i));
    if (good) ok++;
    else missing.push(net);
  });
  // Broches câblées dans la copie qui n'appartiennent à aucune liaison attendue.
  const extra = [...new Set(given.filter((g) => g.size > 1).flatMap((g) => [...g]).filter((p) => !owner.has(p)))].sort();

  const faults = Math.max(0, Math.trunc(circuit?.faults ?? 0));
  const total = expected.length;
  let pts = total ? (item.points * ok) / total : 0;
  pts -= (faultPenalty / 100) * item.points * faults;
  pts = Math.min(item.points, roundHalf(Math.max(0, pts)));
  if (item.requireNoFaults && faults > 0) pts = 0;
  return { points: pts, max: item.points, auto: true, comment: null, detail: { ok, total, missing, extra } };
}

export interface AutoGrade {
  itemScores: Record<string, ItemScore>;
  score: number | null;
  status: SubmissionStatus;
}

/** Correction à l'envoi : `graded` sans item ouvert, sinon `submitted` en attendant l'enseignant. */
export function autoGrade(items: Item[], settings: AssignmentSettings, answers: Record<string, Answer>, circuit: CircuitAnswer | null): AutoGrade {
  const itemScores: Record<string, ItemScore> = {};
  let open = false;
  for (const item of items) {
    if (item.type === 'choice') itemScores[item.id] = gradeChoice(item, answers[item.id]);
    else if (item.type === 'circuit') itemScores[item.id] = gradeCircuit(item, circuit, settings.faultPenalty);
    else if (item.type === 'open') {
      itemScores[item.id] = { points: null, max: item.points, auto: false, comment: null };
      open = true;
    }
  }
  return { itemScores, score: open ? null : sumScores(itemScores), status: open ? 'submitted' : 'graded' };
}

export function sumScores(scores: Record<string, ItemScore>): number | null {
  let sum = 0;
  for (const s of Object.values(scores)) {
    if (s.points === null) return null;
    sum += s.points;
  }
  return Math.round(sum * 100) / 100;
}
