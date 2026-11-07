// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/actor';
import { LoginAttemptsService } from '../auth/login-attempts.service';
import { TokensService } from '../auth/tokens.service';
import { AccessService } from '../common/access.service';
import { AppError, err } from '../common/errors';
import { parseDate } from '../common/json';
import { PasswordService } from '../common/passwords';
import { schoolView, userView } from '../common/views';
import { School, User } from '../database/entities';
import { AccountsService } from './accounts.service';
import { ChangePasswordDto, CreateTeacherDto, SetPlanDto, UpdateMeDto, UpdateUserDto } from './dto';

/** Champs fournis seulement (un PATCH vide ne touche à rien). */
const defined = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

@Injectable()
export class UsersService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly access: AccessService,
    private readonly passwords: PasswordService,
    private readonly accounts: AccountsService,
    private readonly tokens: TokensService,
    private readonly attempts: LoginAttemptsService,
    private readonly audit: AuditService,
  ) {}

  me(actor: Actor) {
    return { user: userView(actor), school: schoolView(actor.school) };
  }

  async updateMe(actor: Actor, dto: UpdateMeDto) {
    const patch = defined({ displayName: dto.displayName, avatarColor: dto.avatarColor });
    if (Object.keys(patch).length) await this.users.update({ id: actor.id }, patch);
    return userView(await this.users.findOneByOrFail({ id: actor.id }));
  }

  async changePassword(actor: Actor, dto: ChangePasswordDto) {
    const row = await this.users.createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id: actor.id }).getOneOrFail();
    // 403 et non 401 : un mauvais mot de passe actuel ne doit pas déclencher la reconnexion du client.
    if (!(await this.passwords.verify(dto.currentPassword, row.passwordHash))) {
      throw new AppError(403, 'AUTH_INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.users.update({ id: actor.id }, { passwordHash, mustChangePassword: false });
    // Les autres sessions sont coupées ; celle-ci reste ouverte (le client renouvelle son jeton d'accès).
    await this.tokens.endSessions(actor.id, actor.sessionFamily);
    await this.attempts.clear([actor.username, actor.email]);
    await this.audit.record({ schoolId: actor.schoolId, actorId: actor.id, action: 'user.password_changed', targetType: 'user', targetId: actor.id });
  }

  async teachers(actor: Actor) {
    const rows = await this.users.find({ where: { schoolId: actor.schoolId, role: In(['admin', 'teacher']) }, order: { displayName: 'ASC' } });
    return rows.map(userView);
  }

  async createTeacher(actor: Actor, dto: CreateTeacherDto) {
    this.access.requirePlan(actor);
    const temporaryPassword = this.passwords.temporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const [user] = await this.db.transaction(async (m) => {
      const created = await this.accounts.create(m, actor.schoolId, [{ displayName: dto.displayName, email: dto.email, role: 'teacher', passwordHash, mustChangePassword: true }]);
      await this.audit.record(
        { schoolId: actor.schoolId, actorId: actor.id, action: 'user.created', targetType: 'user', targetId: created[0].id, details: { role: 'teacher', name: created[0].displayName, username: created[0].username } },
        m,
      );
      return created;
    });
    return { user: userView(user), temporaryPassword };
  }

  async updateSchool(actor: Actor, name: string) {
    await this.schools.update({ id: actor.schoolId }, { name });
    return schoolView(await this.schools.findOneByOrFail({ id: actor.schoolId }));
  }

  /** Compte géré : l'administrateur gère toute l'école, un enseignant les élèves de ses classes. */
  private async managed(actor: Actor, id: string): Promise<User> {
    const target = await this.users.findOneBy({ id });
    if (!target || target.schoolId !== actor.schoolId) throw err.notFound('User');
    if (target.id === actor.id) throw err.forbidden('Use /me to manage your own account');
    if (actor.role === 'admin') return target;
    if (actor.role === 'teacher' && target.role === 'student') {
      const shared: unknown[] = await this.db.query(
        `SELECT 1 FROM classroom_members t JOIN classroom_members s ON s.classroom_id = t.classroom_id
         WHERE t.user_id = $1 AND t.role = 'teacher' AND s.user_id = $2 AND s.role = 'student' LIMIT 1`,
        [actor.id, target.id],
      );
      if (shared.length) return target;
    }
    throw err.forbidden('You cannot manage this account');
  }

  async resetPassword(actor: Actor, id: string) {
    const target = await this.managed(actor, id);
    this.access.requirePlan(actor);
    const temporaryPassword = this.passwords.temporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    await this.users.update({ id: target.id }, { passwordHash, mustChangePassword: true });
    // Toutes les sessions ouvertes avec l'ancien mot de passe tombent aussitôt (jetons et sockets).
    await this.tokens.endSessions(target.id);
    await this.attempts.clear([target.username, target.email]);
    await this.audit.record({ schoolId: actor.schoolId, actorId: actor.id, action: 'user.password_reset', targetType: 'user', targetId: target.id, details: { name: target.displayName } });
    return { temporaryPassword };
  }

  async updateUser(actor: Actor, id: string, dto: UpdateUserDto) {
    const target = await this.managed(actor, id);
    this.access.requirePlan(actor);
    const patch = defined({ displayName: dto.displayName, disabled: dto.disabled });
    if (Object.keys(patch).length) await this.users.update({ id: target.id }, patch);
    if (dto.disabled === true) await this.tokens.endSessions(target.id);
    if (dto.disabled !== undefined && dto.disabled !== target.disabled) {
      await this.audit.record({
        schoolId: actor.schoolId,
        actorId: actor.id,
        action: dto.disabled ? 'user.disabled' : 'user.enabled',
        targetType: 'user',
        targetId: target.id,
        details: { name: target.displayName },
      });
    }
    return userView(await this.users.findOneByOrFail({ id: target.id }));
  }

  async setPlan(schoolId: string, dto: SetPlanDto) {
    const school = await this.schools.findOneBy({ id: schoolId });
    if (!school) throw err.notFound('School');
    const trialEndsAt = parseDate(dto.trialEndsAt, 'trialEndsAt');
    school.plan = dto.plan;
    if (trialEndsAt !== undefined) school.trialEndsAt = trialEndsAt;
    return schoolView(await this.schools.save(school));
  }
}
