// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { err } from './errors';

export const KB = 1024;
export const MB = 1024 * 1024;
export const PROJECT_MAX_BYTES = 5 * MB;

export const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Projet Jollof : un objet JSON de 5 Mo au plus. Renvoie sa taille. */
export function assertProject(value: unknown, field = 'data'): number {
  if (!isPlainObject(value)) throw err.validation(`${field} must be a Jollof project object`);
  const size = jsonBytes(value);
  if (size > PROJECT_MAX_BYTES) throw err.tooLarge(`${field} exceeds 5 MB`);
  return size;
}

/** Date ISO 8601 du client → Date, null pour effacer, undefined si absent. */
export function parseDate(v: unknown, field: string): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const d = typeof v === 'string' ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw err.validation(`${field} must be an ISO 8601 date`);
  return d;
}

/**
 * Lignes renvoyées par un UPDATE … RETURNING passé à `query()` : TypeORM les livre
 * sous la forme [lignes, nombre] pour UPDATE/DELETE, et en simple tableau sinon.
 */
export function returningRows<T>(result: unknown): T[] {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') return result[0] as T[];
  return result as T[];
}
