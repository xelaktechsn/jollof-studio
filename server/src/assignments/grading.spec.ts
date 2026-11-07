// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import type { Item } from '../database/entities';
import { autoGrade, gradeChoice, gradeCircuit, roundHalf } from './grading';

type Circuit = Extract<Item, { type: 'circuit' }>;
type Choice = Extract<Item, { type: 'choice' }>;
const prompt = { type: 'doc', content: [] };

const circuit = (points: number, nets: string[][], requireNoFaults = false): Circuit => ({ id: 'c', type: 'circuit', prompt, points, solution: { nets }, requireNoFaults });
const choice = (correct: string[], multiple = false): Choice => ({
  id: 'q',
  type: 'choice',
  prompt,
  options: ['a', 'b', 'c'].map((id) => ({ id, text: id })),
  multiple,
  correct,
  points: 3,
});

describe('correction automatique', () => {
  it('arrondit à 0,5', () => {
    expect([0.2, 0.25, 0.74, 0.75, 1.4, 2.6].map(roundHalf)).toEqual([0, 0.5, 0.5, 1, 1.5, 2.5]);
  });

  it('choix : tout ou rien, ordre indifférent', () => {
    expect(gradeChoice(choice(['a', 'b'], true), { selected: ['b', 'a'] }).points).toBe(3);
    expect(gradeChoice(choice(['a', 'b'], true), { selected: ['a'] }).points).toBe(0);
    expect(gradeChoice(choice(['a', 'b'], true), { selected: ['a', 'b', 'c'] }).points).toBe(0);
    expect(gradeChoice(choice(['a']), undefined).points).toBe(0);
  });

  const NETS = [
    ['A.1', 'B.1'],
    ['B.2', 'C.1', 'D.1'],
  ];

  it('circuit parfait, broches en plus, liaisons fondues', () => {
    expect(gradeCircuit(circuit(4, NETS), { nets: [['B.1', 'A.1'], ['D.1', 'C.1', 'B.2']], faults: 0 }, 10).points).toBe(4);
    // Une broche étrangère à la solution n'invalide pas la liaison.
    const extra = gradeCircuit(circuit(4, NETS), { nets: [['A.1', 'B.1', 'BB.5'], ['B.2', 'C.1', 'D.1']], faults: 0 }, 10);
    expect(extra.points).toBe(4);
    expect(extra.detail).toEqual({ ok: 2, total: 2, missing: [], extra: ['BB.5'] });
    // Deux liaisons attendues réunies : aucune n'est juste.
    const merged = gradeCircuit(circuit(4, NETS), { nets: [['A.1', 'B.1', 'B.2', 'C.1', 'D.1']], faults: 0 }, 10);
    expect(merged.points).toBe(0);
    expect(merged.detail).toMatchObject({ ok: 0, total: 2, missing: NETS });
    // Liaison incomplète.
    expect(gradeCircuit(circuit(4, NETS), { nets: [['A.1', 'B.1'], ['B.2', 'C.1']], faults: 0 }, 10).points).toBe(2);
    expect(gradeCircuit(circuit(4, NETS), null, 10).points).toBe(0);
  });

  it('circuit : pénalité par erreur, plancher 0, requireNoFaults', () => {
    const perfect = { nets: NETS, faults: 2 };
    // 4 − 2 × 10 % × 4 = 3,2 → 3.
    expect(gradeCircuit(circuit(4, NETS), perfect, 10).points).toBe(3);
    expect(gradeCircuit(circuit(4, NETS), { nets: [], faults: 3 }, 50).points).toBe(0);
    expect(gradeCircuit(circuit(4, NETS, true), { nets: NETS, faults: 1 }, 0).points).toBe(0);
    expect(gradeCircuit(circuit(4, NETS, true), { nets: NETS, faults: 0 }, 10).points).toBe(4);
  });

  it('statut : graded sans question ouverte, sinon submitted avec score null', () => {
    const settings = { maxAttempts: 1, showResults: 'immediately' as const, timeLimitMinutes: null, allowLate: false, faultPenalty: 10 };
    const items: Item[] = [{ id: 't', type: 'text', content: prompt }, choice(['a'])];
    expect(autoGrade(items, settings, { q: { selected: ['a'] } }, null)).toMatchObject({ status: 'graded', score: 3 });
    const withOpen: Item[] = [...items, { id: 'o', type: 'open', prompt, points: 2, rubric: null }];
    const g = autoGrade(withOpen, settings, {}, null);
    expect(g).toMatchObject({ status: 'submitted', score: null });
    expect(g.itemScores.o).toEqual({ points: null, max: 2, auto: false, comment: null });
    expect(g.itemScores.t).toBeUndefined();
  });
});
