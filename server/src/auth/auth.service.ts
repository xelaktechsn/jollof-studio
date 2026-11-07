// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { EnvConfig } from '../config/env';
import { AppError } from '../common/errors';
import { PasswordService } from '../common/passwords';
import { schoolView, userView } from '../common/views';
import { School, User } from '../database/entities';
import { AccountsService } from '../users/accounts.service';
import { LoginDto, RegisterSchoolDto } from './dto';
import { LOCK_FAILURES, LoginAttemptsService } from './login-attempts.service';
import { TokensService } from './tokens.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly tokens: TokensService,
    private readonly passwords: PasswordService,
    private readonly accounts: AccountsService,
    private readonly attempts: LoginAttemptsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async registerSchool(dto: RegisterSchoolDto) {
    const exists = await this.users.existsBy({ email: dto.email });
    if (exists) throw new AppError(409, 'EMAIL_TAKEN', 'Email already in use');
    const passwordHash = await this.passwords.hash(dto.password);
    const trialDays = this.config.get('TRIAL_DAYS', { infer: true });
    return this.db.transaction(async (m) => {
      const school = await m.save(m.create(School, { name: dto.schoolName, plan: 'trial', trialEndsAt: new Date(Date.now() + trialDays * 86400_000) }));
      const [user] = await this.accounts.create(m, school.id, [{ displayName: dto.displayName, role: 'admin', email: dto.email, passwordHash }]);
      await this.audit.record({ schoolId: school.id, actorId: user.id, action: 'school.created', targetType: 'school', targetId: school.id, details: { name: school.name } }, m);
      const pair = await this.tokens.issue(user, undefined, m);
      return { ...pair, user: userView(user), school: schoolView(school) };
    });
  }

  /**
   * Connexion. Chaque identifiant saisi a son compteur d'échecs (LoginAttemptsService) : au-delà
   * de 5, attente croissante (429 RATE_LIMITED + retryAfter), blocage de 15 min à 10. Compte
   * inconnu : même compteur, même empreinte factice, mêmes réponses.
   */
  async login(dto: LoginDto) {
    const failures = await this.attempts.begin(dto.login);
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .leftJoinAndSelect('u.school', 's')
      .where('u.email = :l OR u.username = :l', { l: dto.login })
      .getOne();
    const ok = await this.passwords.verify(dto.password, user?.passwordHash ?? null);
    if (!user || !ok) {
      if (user) {
        await this.audit.login(user, false);
        if (failures === LOCK_FAILURES) {
          await this.audit.record({ schoolId: user.schoolId, actorId: null, action: 'auth.locked', targetType: 'user', targetId: user.id, details: { name: user.displayName, failures } });
        }
      }
      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid login or password');
    }
    await this.attempts.succeeded(dto.login);
    if (user.disabled) throw new AppError(403, 'AUTH_DISABLED', 'This account is disabled');
    await this.audit.login(user, true);
    const pair = await this.tokens.issue(user);
    return { ...pair, user: userView(user), school: schoolView(user.school!) };
  }

  async refresh(raw: string) {
    const { user, accessToken, refreshToken } = await this.tokens.rotate(raw);
    const school = await this.schools.findOneByOrFail({ id: user.schoolId });
    return { accessToken, refreshToken, user: userView(user), school: schoolView(school) };
  }

  logout(raw: string) {
    return this.tokens.revoke(raw);
  }
}
