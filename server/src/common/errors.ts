// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { HttpException } from '@nestjs/common';

export type ErrorCode =
  | 'VALIDATION'
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_TOKEN_INVALID'
  | 'AUTH_DISABLED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'PLAN_REQUIRED'
  | 'EMAIL_TAKEN'
  | 'USERNAME_TAKEN'
  | 'NOT_IN_CLASS'
  | 'ASSIGNMENT_CLOSED'
  | 'ATTEMPTS_EXHAUSTED'
  | 'PAST_DUE'
  | 'TIME_UP'
  | 'SUBMISSION_LOCKED'
  | 'LOCKED'
  | 'LOCK_REQUIRED'
  | 'VERSION_CONFLICT'
  | 'GROUPS_DISABLED'
  | 'GROUP_FULL'
  | 'POSTING_DISABLED'
  | 'EDIT_WINDOW_PASSED'
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/** Erreur métier : le filtre la renvoie telle quelle, `extra` compris (lock, current…). */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super({ statusCode: status, code, message, ...extra }, status);
  }
}

export const err = {
  validation: (message: string) => new AppError(400, 'VALIDATION', message),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  forbidden: (message = 'Forbidden') => new AppError(403, 'FORBIDDEN', message),
  planRequired: () => new AppError(403, 'PLAN_REQUIRED', 'An active trial or Pro plan is required'),
  notInClass: (message = 'User is not a student of this classroom') => new AppError(400, 'NOT_IN_CLASS', message),
  tooLarge: (message: string) => new AppError(413, 'PAYLOAD_TOO_LARGE', message),
  conflict: (code: ErrorCode, message: string, extra?: Record<string, unknown>) => new AppError(409, code, message, extra),
};
