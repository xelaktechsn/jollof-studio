// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppError, err } from '../common/errors';
import { Role, User } from '../database/entities';
import { Actor, IS_PUBLIC, ROLES } from './actor';
import { TokensService } from './tokens.service';

/** Garde globale : jeton d'accès obligatoire sauf @Public(), puis rôles (@Roles). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // La passerelle temps réel authentifie à la poignée de main.
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Missing bearer token');
    const payload = await this.tokens.verifyAccess(match[1]);
    const user = await this.users.findOne({ where: { id: payload.sub }, relations: { school: true } });
    if (!user || !user.school) throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Unknown user');
    if (user.disabled) throw new AppError(403, 'AUTH_DISABLED', 'This account is disabled');
    // Jeton émis avant un changement de mot de passe ou une révocation : refusé tout de suite.
    if (!TokensService.matches(payload, user)) throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Token revoked');
    req.actor = Object.assign(user, { sessionFamily: payload.fam }) as Actor;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.some((r) => r === user.role || (r === 'teacher' && user.role === 'admin'))) {
      throw err.forbidden(roles.includes('student') ? 'Students only' : roles.includes('teacher') ? 'Teachers only' : 'Administrators only');
    }
    return true;
  }
}
