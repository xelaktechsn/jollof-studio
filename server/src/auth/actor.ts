// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role, School, User } from '../database/entities';

/**
 * Utilisateur de la requête, rechargé à chaque appel (compte désactivé = coupé aussitôt).
 * `sessionFamily` : session (famille de jetons de rafraîchissement) du jeton d'accès présenté.
 */
export type Actor = User & { school: School; sessionFamily?: string };

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

export const Public = () => SetMetadata(IS_PUBLIC, true);
/** 'teacher' couvre aussi 'admin' (l'administrateur est aussi enseignant). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  return ctx.switchToHttp().getRequest().actor;
});

export const isStaff = (role: Role) => role === 'admin' || role === 'teacher';
