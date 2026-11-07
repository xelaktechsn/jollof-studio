// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/actor';
import { AccessService } from '../common/access.service';
import { AppError, err } from '../common/errors';
import { assertProject, returningRows } from '../common/json';
import { ProjectVersion, SharedProject, User } from '../database/entities';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService, rooms } from '../realtime/realtime.service';
import { CreateProjectDto, SaveVersionDto, UpdateProjectDto } from './dto';

export const LOCK_TTL_MS = 120_000;

interface VersionRow {
  id: string;
  number: number;
  author_id: string;
  author_name: string;
  message: string | null;
  size: number;
  created_at: Date;
  data?: Record<string, unknown>;
}

const metaView = (v: VersionRow) => ({
  id: v.id,
  number: v.number,
  authorId: v.author_id,
  authorName: v.author_name,
  message: v.message,
  size: v.size,
  createdAt: v.created_at,
});

const VERSION_SELECT = `SELECT v.id, v.number, v.author_id, u.display_name AS author_name, v.message, v.size, v.created_at
  FROM project_versions v JOIN users u ON u.id = v.author_id`;

@Injectable()
export class ProjectsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(SharedProject) private readonly projects: Repository<SharedProject>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  private async views(list: SharedProject[]) {
    if (!list.length) return [];
    const versionIds = list.map((p) => p.currentVersionId).filter((x): x is string => !!x);
    const now = Date.now();
    const holderIds = list.filter((p) => p.lockUserId && p.lockExpiresAt && p.lockExpiresAt.getTime() > now).map((p) => p.lockUserId!);
    const [versions, holders] = await Promise.all([
      versionIds.length ? (this.db.query(`${VERSION_SELECT} WHERE v.id = ANY($1)`, [versionIds]) as Promise<VersionRow[]>) : Promise.resolve([]),
      holderIds.length ? this.users.find({ select: { id: true, displayName: true }, where: { id: In(holderIds) } }) : Promise.resolve([]),
    ]);
    return list.map((p) => {
      const v = versions.find((x) => x.id === p.currentVersionId);
      const h = holders.find((x) => x.id === p.lockUserId);
      return {
        id: p.id,
        groupId: p.groupId,
        title: p.title,
        description: p.description,
        currentVersion: v ? metaView(v) : null,
        lock: h && p.lockExpiresAt && p.lockExpiresAt.getTime() > now ? { userId: h.id, displayName: h.displayName, expiresAt: p.lockExpiresAt } : null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });
  }

  private async view(p: SharedProject) {
    return (await this.views([p]))[0];
  }

  /** Projet lisible : membre du groupe ou enseignant de la classe. */
  private async load(actor: Actor, id: string) {
    const project = await this.projects.findOneBy({ id });
    if (!project) throw err.notFound('Project');
    const ctx = await this.access.group(actor, project.groupId);
    return { project, ...ctx };
  }

  private async loadAsMember(actor: Actor, id: string) {
    const ctx = await this.load(actor, id);
    if (!ctx.groupRole) throw err.forbidden('Only group members can do this');
    return ctx;
  }

  async list(actor: Actor, groupId: string) {
    await this.access.group(actor, groupId);
    return this.views(await this.projects.find({ where: { groupId }, order: { updatedAt: 'DESC' } }));
  }

  async create(actor: Actor, groupId: string, dto: CreateProjectDto) {
    const { groupRole } = await this.access.group(actor, groupId);
    if (!groupRole) throw err.forbidden('Only group members can create projects');
    const size = dto.data !== undefined ? assertProject(dto.data) : 0;
    const project = await this.db.transaction(async (m) => {
      const p = await m.save(m.create(SharedProject, { groupId, title: dto.title, description: dto.description || null, currentVersionId: null }));
      if (dto.data !== undefined) await this.addVersion(m, p, actor, dto.data, dto.message ?? null, size);
      return p;
    });
    return this.view(project);
  }

  async get(actor: Actor, id: string) {
    return this.view((await this.load(actor, id)).project);
  }

  async update(actor: Actor, id: string, dto: UpdateProjectDto) {
    const { project } = await this.loadAsMember(actor, id);
    if (dto.title !== undefined) project.title = dto.title;
    if (dto.description !== undefined) project.description = dto.description || null;
    return this.view(await this.projects.save(project));
  }

  async remove(actor: Actor, id: string) {
    const { project, groupRole, classRole } = await this.load(actor, id);
    if (groupRole !== 'owner' && classRole !== 'teacher') throw err.forbidden('Only the group owner or a teacher can delete a project');
    await this.projects.delete({ id: project.id });
    this.realtime.toRooms(rooms.group(project.groupId), 'project:lock', { projectId: project.id, lock: null });
  }

  async versions(actor: Actor, id: string) {
    await this.load(actor, id);
    const rows: VersionRow[] = await this.db.query(`${VERSION_SELECT} WHERE v.project_id = $1 ORDER BY v.number DESC`, [id]);
    return rows.map(metaView);
  }

  async version(actor: Actor, id: string, versionId: string) {
    const { project } = await this.load(actor, id);
    const target = versionId === 'current' ? project.currentVersionId : versionId;
    if (!target) throw err.notFound('Version');
    const [row]: VersionRow[] = await this.db.query(
      `SELECT v.id, v.number, v.author_id, u.display_name AS author_name, v.message, v.size, v.created_at, v.data
       FROM project_versions v JOIN users u ON u.id = v.author_id WHERE v.id = $1 AND v.project_id = $2`,
      [target, id],
    );
    if (!row) throw err.notFound('Version');
    return { ...metaView(row), data: row.data };
  }

  // ---- verrou

  private lockPayload(userId: string, displayName: string, expiresAt: Date) {
    return { userId, displayName, expiresAt };
  }

  async lock(actor: Actor, id: string, force: boolean): Promise<{ userId: string; displayName: string; expiresAt: Date }> {
    const { project, group } = await this.loadAsMember(actor, id);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
    const got = returningRows<{ id: string }>(
      await this.db.query(
        `UPDATE shared_projects SET lock_user_id = $2, lock_expires_at = $3
         WHERE id = $1 AND (lock_user_id IS NULL OR lock_user_id = $2 OR lock_expires_at <= $4) RETURNING id`,
        [id, actor.id, expiresAt, now],
      ),
    );
    const lock = this.lockPayload(actor.id, actor.displayName, expiresAt);
    if (got.length) {
      this.realtime.toRooms(rooms.group(project.groupId), 'project:lock', { projectId: id, lock });
      return lock;
    }
    const fresh = await this.projects.findOneByOrFail({ id });
    const holder = fresh.lockUserId ? await this.users.findOneBy({ id: fresh.lockUserId }) : null;
    if (!force) {
      throw new AppError(423, 'LOCKED', 'Another member is editing this project', {
        lock: holder && fresh.lockExpiresAt ? this.lockPayload(holder.id, holder.displayName, fresh.lockExpiresAt) : null,
      });
    }
    // Reprise forcée : seulement si le détenteur n'a pas changé entre-temps, sinon on recommence.
    const taken = returningRows<{ id: string }>(
      await this.db.query(`UPDATE shared_projects SET lock_user_id = $2, lock_expires_at = $3 WHERE id = $1 AND lock_user_id IS NOT DISTINCT FROM $4 RETURNING id`, [
        id,
        actor.id,
        expiresAt,
        fresh.lockUserId,
      ]),
    );
    if (!taken.length) return this.lock(actor, id, true);
    this.realtime.toRooms(rooms.group(project.groupId), 'project:lock', { projectId: id, lock });
    if (fresh.lockUserId && fresh.lockUserId !== actor.id) {
      await this.audit.record({
        schoolId: actor.schoolId,
        actorId: actor.id,
        action: 'project.lock_taken',
        targetType: 'project',
        targetId: id,
        details: { title: project.title, groupId: group.id, groupName: group.name, fromUserId: fresh.lockUserId, fromName: holder?.displayName ?? null },
      });
      this.realtime.toUsers(fresh.lockUserId, 'project:lock-lost', { projectId: id, by: { id: actor.id, displayName: actor.displayName } });
      await this.notifications.notify([fresh.lockUserId], 'project_lock_taken', {
        projectId: id,
        projectTitle: project.title,
        groupId: group.id,
        groupName: group.name,
        byId: actor.id,
        byName: actor.displayName,
      });
    }
    return lock;
  }

  /** Prolonge le verrou tant que personne d'autre ne l'a pris (même s'il vient d'expirer). */
  async renew(actor: Actor, id: string) {
    const { project } = await this.loadAsMember(actor, id);
    const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
    const got = returningRows<{ id: string }>(
      await this.db.query(`UPDATE shared_projects SET lock_expires_at = $3 WHERE id = $1 AND lock_user_id = $2 RETURNING id`, [id, actor.id, expiresAt]),
    );
    if (!got.length) throw new AppError(409, 'LOCK_REQUIRED', 'You no longer hold the lock');
    const lock = this.lockPayload(actor.id, actor.displayName, expiresAt);
    this.realtime.toRooms(rooms.group(project.groupId), 'project:lock', { projectId: id, lock });
    return lock;
  }

  async unlock(actor: Actor, id: string) {
    const { project, classRole } = await this.load(actor, id);
    const holder = project.lockUserId;
    const active = !!holder && !!project.lockExpiresAt && project.lockExpiresAt.getTime() > Date.now();
    if (holder && holder !== actor.id && active && classRole !== 'teacher') throw err.forbidden('Only the lock holder or a teacher can release this lock');
    if (!holder) return;
    const done = returningRows<{ id: string }>(
      await this.db.query(`UPDATE shared_projects SET lock_user_id = NULL, lock_expires_at = NULL WHERE id = $1 AND lock_user_id = $2 RETURNING id`, [id, holder]),
    );
    if (!done.length) return;
    this.realtime.toRooms(rooms.group(project.groupId), 'project:lock', { projectId: id, lock: null });
    if (holder !== actor.id && active) {
      this.realtime.toUsers(holder, 'project:lock-lost', { projectId: id, by: { id: actor.id, displayName: actor.displayName } });
    }
  }

  // ---- versions

  private async addVersion(m: EntityManager, p: SharedProject, actor: Actor, data: Record<string, unknown>, message: string | null, size: number) {
    const [{ n }]: { n: number }[] = await m.query('SELECT COALESCE(MAX(number), 0)::int + 1 AS n FROM project_versions WHERE project_id = $1', [p.id]);
    const v = await m.save(m.create(ProjectVersion, { projectId: p.id, number: n, authorId: actor.id, message, data, size }));
    p.currentVersionId = v.id;
    await m.update(SharedProject, { id: p.id }, { currentVersionId: v.id, updatedAt: new Date() });
    return metaView({ id: v.id, number: v.number, author_id: actor.id, author_name: actor.displayName, message: v.message, size: v.size, created_at: v.createdAt });
  }

  /** Écriture sous verrou ; `baseVersionId` périmé → 409 VERSION_CONFLICT avec la version courante. */
  private async write(actor: Actor, id: string, build: (m: EntityManager, p: SharedProject) => Promise<{ data: Record<string, unknown>; message: string | null; size: number }>, base?: string | null) {
    const { project } = await this.loadAsMember(actor, id);
    const meta = await this.db.transaction(async (m) => {
      const p = await m.getRepository(SharedProject).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!p) throw err.notFound('Project');
      if (p.lockUserId !== actor.id) throw new AppError(409, 'LOCK_REQUIRED', 'Take the lock before saving');
      if (base !== undefined && (p.currentVersionId ?? null) !== (base ?? null)) {
        const [cur]: VersionRow[] = p.currentVersionId ? await m.query(`${VERSION_SELECT} WHERE v.id = $1`, [p.currentVersionId]) : [];
        throw new AppError(409, 'VERSION_CONFLICT', 'The project changed since your base version', { current: cur ? metaView(cur) : null });
      }
      const { data, message, size } = await build(m, p);
      const meta = await this.addVersion(m, p, actor, data, message, size);
      // Enregistrer prouve que l'on travaille encore : le verrou est prolongé.
      await m.update(SharedProject, { id }, { lockExpiresAt: new Date(Date.now() + LOCK_TTL_MS) });
      return meta;
    });
    this.realtime.toRooms(rooms.group(project.groupId), 'project:saved', { projectId: id, groupId: project.groupId, version: meta });
    return meta;
  }

  saveVersion(actor: Actor, id: string, dto: SaveVersionDto) {
    const size = assertProject(dto.data);
    return this.write(actor, id, async () => ({ data: dto.data, message: dto.message ?? null, size }), dto.baseVersionId);
  }

  restore(actor: Actor, id: string, versionId: string) {
    return this.write(actor, id, async (m) => {
      const [old]: { data: Record<string, unknown>; size: number }[] = await m.query('SELECT data, size FROM project_versions WHERE id = $1 AND project_id = $2', [versionId, id]);
      if (!old) throw err.notFound('Version');
      return { data: old.data, message: null, size: old.size };
    });
  }
}
