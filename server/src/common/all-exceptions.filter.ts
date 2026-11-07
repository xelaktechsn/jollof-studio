// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { AppError, ErrorCode } from './errors';

const BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION',
  401: 'AUTH_TOKEN_INVALID',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'FILE_TYPE',
  429: 'RATE_LIMITED',
};

interface Shaped {
  status: number;
  body: Record<string, unknown>;
}

/** Toute erreur sort au format du contrat : { statusCode, code, message } (+ champs propres). */
export function shapeError(exception: unknown): Shaped {
  if (exception instanceof AppError) {
    return { status: exception.getStatus(), body: exception.getResponse() as Record<string, unknown> };
  }
  if (exception instanceof ThrottlerException) {
    return { status: 429, body: { statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests' } };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const res = exception.getResponse();
    let message = typeof res === 'string' ? res : (res as { message?: unknown }).message;
    if (Array.isArray(message)) message = message.join('; ');
    let code = BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION');
    // Multer traduit sa limite de taille en 413 « File too large ».
    if (status === 413 && message === 'File too large') code = 'FILE_TOO_LARGE';
    return { status, body: { statusCode: status, code, message: String(message ?? exception.message) } };
  }
  // Erreurs levées par body-parser avant Nest (JSON trop gros ou mal formé).
  const e = exception as { type?: string; status?: number; message?: string };
  if (e && e.type === 'entity.too.large') {
    return { status: 413, body: { statusCode: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } };
  }
  if (e && typeof e.status === 'number' && e.status >= 400 && e.status < 500) {
    return { status: e.status, body: { statusCode: e.status, code: BY_STATUS[e.status] ?? 'VALIDATION', message: e.message ?? 'Bad request' } };
  }
  // Valeur refusée par PostgreSQL (uuid ou date mal formés passés au travers) : faute du client.
  if (exception instanceof QueryFailedError && ['22P02', '22007', '22008'].includes((exception as { code?: string }).code ?? '')) {
    return { status: 400, body: { statusCode: 400, code: 'VALIDATION', message: 'Invalid value' } };
  }
  return { status: 500, body: { statusCode: 500, code: 'INTERNAL', message: 'Internal server error' } };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = shapeError(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    if (res.headersSent) return;
    if (status === 429) {
      // Toujours `retryAfter` (secondes) dans le corps et l'en-tête Retry-After : la limite par IP
      // (throttler) pose l'en-tête, les limites par compte et par utilisateur mettent le champ.
      const header = Number(res.getHeader('Retry-After'));
      const retryAfter = typeof body.retryAfter === 'number' ? body.retryAfter : Number.isFinite(header) && header > 0 ? Math.ceil(header) : 60;
      body.retryAfter = retryAfter;
      res.setHeader('Retry-After', String(retryAfter));
    }
    res.status(status).json(body);
  }
}
