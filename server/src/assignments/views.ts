// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import type { Assignment, Classroom, Item, ShowResults, Submission, SubmissionStatus } from '../database/entities';

export interface Stats {
  targeted: number;
  started: number;
  submitted: number;
  graded: number;
}

/** Résultats visibles de l'élève : tout de suite une fois corrigée, ou à la remise (sauf « never »). */
export function resultsVisible(showResults: ShowResults, status: SubmissionStatus): boolean {
  return (showResults === 'immediately' && (status === 'graded' || status === 'returned')) || (status === 'returned' && showResults !== 'never');
}

type ClassRef = Pick<Classroom, 'name' | 'color'>;

/**
 * Devoir lu pour une liste : sans `starterProject` (jusqu'à 5 Mo chacun), seulement l'indicateur
 * `hasStarterProject` ; le montage de départ se lit par GET /assignments/:id.
 */
export type AssignmentRow = Assignment & { hasStarterProject?: boolean };

function base(a: AssignmentRow, c: ClassRef) {
  return {
    id: a.id,
    classroomId: a.classroomId,
    classroomName: c.name,
    classroomColor: c.color,
    authorId: a.authorId,
    kind: a.kind,
    title: a.title,
    instructions: a.instructions,
    items: a.items,
    starterProject: a.starterProject ?? null,
    hasStarterProject: a.hasStarterProject ?? a.starterProject != null,
    settings: a.settings,
    status: a.status,
    audience: a.audience,
    dueAt: a.dueAt,
    publishedAt: a.publishedAt,
    totalPoints: a.totalPoints,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export function teacherAssignmentView(a: AssignmentRow, c: ClassRef, stats: Stats) {
  return { ...base(a, c), stats };
}

/** Vue élève : sans `solution` ni `rubric` ; `correct` seulement après remise de sa copie (sauf « never »). */
export function redactItems(items: Item[], revealCorrect: boolean) {
  return items.map((it) => {
    if (it.type === 'choice') {
      const { correct, ...rest } = it;
      return revealCorrect ? { ...rest, correct } : rest;
    }
    if (it.type === 'open') {
      const { rubric: _rubric, ...rest } = it;
      return rest;
    }
    if (it.type === 'circuit') {
      const { solution: _solution, ...rest } = it;
      return rest;
    }
    return it;
  });
}

export function studentAssignmentView(a: AssignmentRow, c: ClassRef, studentId: string, latest: Submission | null) {
  const reveal = !!latest && latest.status === 'returned' && a.settings.showResults !== 'never';
  return {
    ...base(a, c),
    items: redactItems(a.items, reveal),
    // L'élève ne voit pas la liste des autres élèves visés.
    audience: a.audience.all ? { all: true } : { all: false, userIds: [studentId] },
    mySubmission: latest ? summaryView(latest, a, true) : null,
  };
}

export function summaryView(s: Submission, a: Assignment, forStudent: boolean) {
  const visible = !forStudent || resultsVisible(a.settings.showResults, s.status);
  return {
    id: s.id,
    attempt: s.attempt,
    status: s.status,
    score: visible ? s.score : null,
    maxScore: s.maxScore,
    submittedAt: s.submittedAt,
    late: s.late,
  };
}

export function submissionView(s: Submission, a: Assignment, studentName: string, forStudent: boolean) {
  const visible = !forStudent || resultsVisible(a.settings.showResults, s.status);
  return {
    id: s.id,
    assignmentId: s.assignmentId,
    studentId: s.studentId,
    studentName,
    attempt: s.attempt,
    status: s.status,
    answers: s.answers,
    project: s.project,
    circuit: s.circuit,
    itemScores: visible ? s.itemScores : {},
    score: visible ? s.score : null,
    maxScore: s.maxScore,
    feedback: visible ? s.feedback : null,
    late: s.late,
    deadlineAt: s.deadlineAt,
    startedAt: s.startedAt,
    submittedAt: s.submittedAt,
    gradedAt: s.gradedAt,
    returnedAt: s.returnedAt,
  };
}

/** Copie de référence d'un élève dans le carnet : dernière envoyée, sinon celle en cours. */
export function gradebookPick(subs: Submission[]): Submission | null {
  const sorted = [...subs].sort((x, y) => y.attempt - x.attempt);
  return sorted.find((s) => s.status !== 'in_progress') ?? sorted[0] ?? null;
}

export function computeStats(targetedIds: string[], subs: Pick<Submission, 'studentId' | 'attempt' | 'status'>[]): Stats & { toGrade: number } {
  const by = new Map<string, Pick<Submission, 'studentId' | 'attempt' | 'status'>[]>();
  for (const s of subs) by.set(s.studentId, [...(by.get(s.studentId) ?? []), s]);
  const stats = { targeted: targetedIds.length, started: 0, submitted: 0, graded: 0, toGrade: 0 };
  for (const id of targetedIds) {
    const list = by.get(id);
    if (!list?.length) continue;
    stats.started++;
    const final = list.filter((s) => s.status !== 'in_progress').sort((x, y) => y.attempt - x.attempt)[0];
    if (!final) continue;
    stats.submitted++;
    if (final.status === 'graded' || final.status === 'returned') stats.graded++;
    else stats.toGrade++;
  }
  return stats;
}
