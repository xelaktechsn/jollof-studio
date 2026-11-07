// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { assertDoc, assertDocOrNull } from '../common/rich-doc';
import { err } from '../common/errors';
import { isPlainObject } from '../common/json';
import type { Answer, AssignmentSettings, CircuitAnswer, Item } from '../database/entities';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ITEMS = 200;
const MAX_OPTIONS = 20;
const MAX_NETS = 2000;
const MAX_PINS = 500;

function points(v: unknown, where: string, def = 1): number {
  if (v === undefined) return def;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000) throw err.validation(`${where}.points must be a number between 0 and 1000`);
  return v;
}

function pin(v: unknown, where: string): string {
  if (typeof v !== 'string' || !v.trim() || v.length > 64) throw err.validation(`${where}: pins must be "REF.PIN" strings`);
  return v.trim();
}

/** Liaisons d'un circuit : liste de groupes de broches. */
export function normalizeNets(v: unknown, where: string, minPins = 1): string[][] {
  if (!Array.isArray(v) || v.length > MAX_NETS) throw err.validation(`${where} must be an array of pin groups`);
  return v.map((net, i) => {
    if (!Array.isArray(net) || net.length < minPins || net.length > MAX_PINS) throw err.validation(`${where}[${i}] must be an array of pins`);
    return [...new Set(net.map((p) => pin(p, `${where}[${i}]`)))];
  });
}

/** Items du devoir : reconstruits champ par champ (rien d'inconnu n'est stocké). */
export function normalizeItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) throw err.validation('items must be an array');
  if (raw.length > MAX_ITEMS) throw err.validation(`At most ${MAX_ITEMS} items`);
  const seen = new Set<string>();
  return raw.map((it, i): Item => {
    const where = `items[${i}]`;
    if (!isPlainObject(it)) throw err.validation(`${where} must be an object`);
    if (typeof it.id !== 'string' || !ID.test(it.id)) throw err.validation(`${where}.id must match ${ID}`);
    if (seen.has(it.id)) throw err.validation(`${where}.id is duplicated`);
    seen.add(it.id);
    switch (it.type) {
      case 'text':
        return { id: it.id, type: 'text', content: assertDoc(it.content, `${where}.content`) };
      case 'choice': {
        if (!Array.isArray(it.options) || it.options.length > MAX_OPTIONS) throw err.validation(`${where}.options must be an array (max ${MAX_OPTIONS})`);
        const optIds = new Set<string>();
        const options = it.options.map((o, j) => {
          if (!isPlainObject(o) || typeof o.id !== 'string' || !ID.test(o.id) || optIds.has(o.id)) throw err.validation(`${where}.options[${j}].id invalid or duplicated`);
          if (typeof o.text !== 'string' || o.text.length > 500) throw err.validation(`${where}.options[${j}].text must be a string (max 500)`);
          optIds.add(o.id);
          return { id: o.id, text: o.text };
        });
        const multiple = it.multiple === true;
        const correct = it.correct === undefined ? [] : it.correct;
        if (!Array.isArray(correct) || correct.some((c) => typeof c !== 'string' || !optIds.has(c))) throw err.validation(`${where}.correct must list option ids`);
        const uniq = [...new Set(correct as string[])];
        if (!multiple && uniq.length > 1) throw err.validation(`${where}.correct: single choice has one correct option`);
        return { id: it.id, type: 'choice', prompt: assertDoc(it.prompt, `${where}.prompt`), options, multiple, correct: uniq, points: points(it.points, where) };
      }
      case 'open':
        return {
          id: it.id,
          type: 'open',
          prompt: assertDoc(it.prompt, `${where}.prompt`),
          points: points(it.points, where),
          rubric: it.rubric === undefined ? null : assertDocOrNull(it.rubric, `${where}.rubric`),
        };
      case 'circuit': {
        if (!isPlainObject(it.solution)) throw err.validation(`${where}.solution must be { nets }`);
        return {
          id: it.id,
          type: 'circuit',
          prompt: assertDoc(it.prompt, `${where}.prompt`),
          points: points(it.points, where),
          solution: { nets: normalizeNets(it.solution.nets, `${where}.solution.nets`, 2) },
          requireNoFaults: it.requireNoFaults === true,
        };
      }
      default:
        throw err.validation(`${where}.type must be text, choice, open or circuit`);
    }
  });
}

/** Contrôles de publication : un devoir publié doit pouvoir se corriger. */
export function assertPublishable(items: Item[]) {
  items.forEach((it, i) => {
    if (it.type === 'choice') {
      if (it.options.length < 2) throw err.validation(`items[${i}]: a choice needs at least 2 options`);
      if (it.correct.length === 0) throw err.validation(`items[${i}]: a choice needs a correct option`);
    }
    if (it.type === 'circuit' && it.solution.nets.length === 0) throw err.validation(`items[${i}]: a circuit needs a solution`);
  });
}

export const totalPoints = (items: Item[]) => items.reduce((s, it) => s + (it.type === 'text' ? 0 : it.points), 0);

export function defaultSettings(kind: 'exercise' | 'evaluation'): AssignmentSettings {
  return {
    maxAttempts: 1,
    // Exercice : résultats tout de suite ; évaluation : à la remise des copies.
    showResults: kind === 'exercise' ? 'immediately' : 'after_return',
    timeLimitMinutes: null,
    allowLate: false,
    faultPenalty: 10,
  };
}

/** Réponses d'une copie : seulement pour des items existants, de la bonne forme. */
export function normalizeAnswers(raw: unknown, items: Item[]): Record<string, Answer> {
  if (!isPlainObject(raw)) throw err.validation('answers must be an object');
  const byId = new Map(items.map((it) => [it.id, it]));
  const out: Record<string, Answer> = {};
  for (const [itemId, a] of Object.entries(raw)) {
    const item = byId.get(itemId);
    const where = `answers.${itemId}`;
    if (!item) throw err.validation(`${where}: unknown item`);
    if (!isPlainObject(a)) throw err.validation(`${where} must be an object`);
    if (item.type === 'choice') {
      const optIds = new Set(item.options.map((o) => o.id));
      if (!Array.isArray(a.selected) || a.selected.some((s) => typeof s !== 'string' || !optIds.has(s))) throw err.validation(`${where}.selected must list option ids`);
      const selected = [...new Set(a.selected as string[])];
      if (!item.multiple && selected.length > 1) throw err.validation(`${where}: single choice`);
      out[itemId] = { selected };
    } else if (item.type === 'open') {
      out[itemId] = { doc: assertDoc(a.doc, `${where}.doc`) };
    } else {
      throw err.validation(`${where}: this item takes no answer`);
    }
  }
  return out;
}

export function normalizeCircuit(raw: unknown): CircuitAnswer {
  if (!isPlainObject(raw)) throw err.validation('circuit must be { nets, faults }');
  const faults = raw.faults === undefined ? 0 : raw.faults;
  if (typeof faults !== 'number' || !Number.isInteger(faults) || faults < 0 || faults > 10000) throw err.validation('circuit.faults must be a non-negative integer');
  return { nets: normalizeNets(raw.nets, 'circuit.nets'), faults };
}
