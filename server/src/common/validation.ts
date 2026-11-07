// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { ParseUUIDPipe, ValidationError, ValidationPipe } from '@nestjs/common';
import { AppError } from './errors';

function flatten(errors: ValidationError[], prefix = ''): string[] {
  const out: string[] = [];
  for (const e of errors) {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    // Les messages de class-validator commencent déjà par le nom du champ.
    if (e.constraints) out.push(...Object.values(e.constraints).map((m) => (prefix ? `${prefix}.${m}` : m)));
    if (e.children?.length) out.push(...flatten(e.children, path));
  }
  return out;
}

export function buildValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new AppError(400, 'VALIDATION', flatten(errors).join('; ') || 'Invalid request'),
  });
}

/** Identifiant de chemin : UUID v4, sinon VALIDATION. */
export const UUID = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () => new AppError(400, 'VALIDATION', 'Invalid id (UUID v4 expected)'),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
