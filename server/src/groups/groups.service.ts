// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type { Actor } from '../auth/actor';
import { AccessService } from '../common/access.service';
import { CLASS_COLORS, pick } from '../common/colors';
import { AppError, err } from '../common/errors';
import { returningRows } from '../common/json';
import { Classroom, Conversation, Group, GroupMember } from '../database/entities';
import { ConversationsService } from '../messaging/conversations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService, rooms } from '../realtime/realtime.service';
import { AddGroupMembersDto, CreateGroupDto, UpdateGroupDto } from './dto';

@Injectable()
export class GroupsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    private readonly access: AccessService,
    private readonly convs: ConversationsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async views(list: Group[]) {
    if (!list.length) return [];
    const ids = list.map((g) => g.id);
    const [members, counts, convs, classes] = await Promise.all([
      this.db.query(
        `SELECT gm.group_id, gm.user_id, gm.role, u.display_name, u.avatar_color FROM group_members gm
         JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ANY($1) ORDER BY gm.joined_at, gm.user_id`,
        [ids],
      ) as Promise<{ group_id: string; user_id: string; role: string; display_name: string; avatar_color: string }[]>,
      this.db.query(`SELECT group_id, count(*)::int AS n FROM shared_projects WHERE group_id = ANY($1) GROUP BY group_id`, [ids]) as Promise<
        { group_id: string; n: number }[]
      >,
      this.conversations.find({ select: { id: true, groupId: true }, where: { kind: 'group', groupId: In(ids) } }),
      this.db.getRepository(Classroom).find({ select: { id: true, name: true }, where: { id: In([...new Set(list.map((g) => g.classroomId))]) } }),
    ]);
    const countBy = new Map(counts.map((c) => [c.group_id, c.n]));
    const convBy = new Map(convs.map((c) => [c.groupId, c.id]));
    const classBy = new Map(classes.map((c) => [c.id, c.name]));
    return list.map((g) => ({
      id: g.id,
      classroomId: g.classroomId,
      classroomName: classBy.get(g.classroomId) ?? '',
      name: g.name,
      color: g.color,
      createdBy: g.createdBy,
      members: members
        .filter((m) => m.group_id === g.id)
        .map((m) => ({ userId: m.user_id, displayName: m.display_name, avatarColor: m.avatar_color, role: m.role })),
      projectCount: countBy.get(g.id) ?? 0,
      conversationId: convBy.get(g.id) ?? null,
      createdAt: g.createdAt,
    }));
  }

  async view(g: Group) {
    return (await this.views([g]))[0];
  }

  private async teacherIds(classroomId: string): Promise<string[]> {
    const rows: { user_id: string }[] = await this.db.query(`SELECT user_id FROM classroom_members WHERE classroom_id = $1 AND role = 'teacher'`, [classroomId]);
    return rows.map((r) => r.user_id);
  }

  /** Élèves de la classe, sinon NOT_IN_CLASS. */
  private async assertStudents(classroomId: string, ids: string[]) {
    if (!ids.length) return;
    const rows: { user_id: string }[] = await this.db.query(
      `SELECT user_id FROM classroom_members WHERE classroom_id = $1 AND role = 'student' AND user_id = ANY($2)`,
      [classroomId, ids],
    );
    if (rows.length !== ids.length) throw err.notInClass('Group members must be students of this classroom');
  }

  async list(actor: Actor, classroomId: string) {
    const { role } = await this.access.classroom(actor, classroomId);
    const list =
      role === 'teacher'
        ? await this.groups.find({ where: { classroomId }, order: { createdAt: 'ASC' } })
        : await this.groups
            .createQueryBuilder('g')
            .innerJoin(GroupMember, 'gm', 'gm.group_id = g.id AND gm.user_id = :uid', { uid: actor.id })
            .where('g.classroom_id = :cid', { cid: classroomId })
            .orderBy('g.created_at', 'ASC')
            .getMany();
    return this.views(list);
  }

  async get(actor: Actor, id: string) {
    const { group } = await this.access.group(actor, id);
    return this.view(group);
  }

  async create(actor: Actor, classroomId: string, dto: CreateGroupDto) {
    const { classroom, role } = await this.access.classroom(actor, classroomId);
    const student = role === 'student';
    if (student && !classroom.settings.allowStudentGroups) throw new AppError(403, 'GROUPS_DISABLED', 'Student groups are disabled in this classroom');
    const others = [...new Set(dto.memberIds)].filter((id) => id !== actor.id);
    if (!student && others.length === 0) throw err.validation('memberIds must not be empty');
    await this.assertStudents(classroomId, others);
    if (others.length + (student ? 1 : 0) > classroom.settings.maxGroupSize) {
      throw new AppError(409, 'GROUP_FULL', `A group has at most ${classroom.settings.maxGroupSize} members`);
    }

    const { group, conv } = await this.db.transaction(async (m) => {
      const group = await m.save(m.create(Group, { classroomId, name: dto.name, color: dto.color ?? pick(CLASS_COLORS), createdBy: actor.id }));
      // Le créateur élève est propriétaire ; un groupe formé par l'enseignant n'a pas de propriétaire.
      const rows = [
        ...(student ? [{ groupId: group.id, userId: actor.id, role: 'owner' as const }] : []),
        ...others.map((userId) => ({ groupId: group.id, userId, role: 'member' as const })),
      ];
      // Heures d'arrivée explicites : dans une transaction, now() est le même pour toutes les
      // lignes, et l'ordre (propriétaire d'abord) dépendrait des identifiants.
      const t0 = Date.now();
      for (const [i, r] of rows.entries()) await m.save(m.create(GroupMember, { ...r, joinedAt: new Date(t0 + i) }));
      const conv = await this.convs.createForGroup(m, actor.schoolId, classroomId, group.id);
      return { group, conv };
    });

    const memberIds = student ? [actor.id, ...others] : others;
    const teachers = await this.teacherIds(classroomId);
    this.realtime.join([...memberIds, ...teachers], [rooms.group(group.id)]);
    await this.convs.announce(conv.id, actor.schoolId, [...memberIds, ...teachers]);
    await this.notifyAdded(others, group, classroom, actor);
    return this.view(group);
  }

  private notifyAdded(userIds: string[], group: Group, classroom: Classroom, actor: Actor) {
    return this.notifications.notify(userIds, 'group_added', {
      groupId: group.id,
      groupName: group.name,
      classroomId: classroom.id,
      classroomName: classroom.name,
      byId: actor.id,
      byName: actor.displayName,
    });
  }

  /** Propriétaire du groupe ou enseignant de la classe. */
  private async manageable(actor: Actor, id: string) {
    const ctx = await this.access.group(actor, id);
    if (ctx.groupRole !== 'owner' && ctx.classRole !== 'teacher') throw err.forbidden('Only the group owner or a teacher can do this');
    return ctx;
  }

  async update(actor: Actor, id: string, dto: UpdateGroupDto) {
    const { group } = await this.manageable(actor, id);
    if (dto.name !== undefined) group.name = dto.name;
    if (dto.color !== undefined) group.color = dto.color;
    return this.view(await this.groups.save(group));
  }

  async addMembers(actor: Actor, id: string, dto: AddGroupMembersDto) {
    const { group, classroom } = await this.manageable(actor, id);
    const ids = [...new Set(dto.userIds)];
    await this.assertStudents(classroom.id, ids);
    const added = await this.db.transaction(async (m) => {
      // Verrou du groupe : deux ajouts simultanés ne dépassent pas la taille maximale.
      await m.query('SELECT id FROM groups WHERE id = $1 FOR UPDATE', [group.id]);
      const current = await m.getRepository(GroupMember).findBy({ groupId: group.id });
      const fresh = ids.filter((uid) => !current.some((c) => c.userId === uid));
      if (current.length + fresh.length > classroom.settings.maxGroupSize) {
        throw new AppError(409, 'GROUP_FULL', `A group has at most ${classroom.settings.maxGroupSize} members`);
      }
      const t0 = Date.now();
      for (const [i, userId] of fresh.entries()) await m.save(m.create(GroupMember, { groupId: group.id, userId, role: 'member', joinedAt: new Date(t0 + i) }));
      return fresh;
    });
    if (added.length) {
      this.realtime.join(added, [rooms.group(group.id)]);
      const conv = await this.conversations.findOneBy({ kind: 'group', groupId: group.id });
      if (conv) await this.convs.announce(conv.id, actor.schoolId, added);
      await this.notifyAdded(added, group, classroom, actor);
    }
    return this.view(group);
  }

  async removeMember(actor: Actor, id: string, userId: string) {
    const ctx = await this.access.group(actor, id);
    const self = userId === actor.id;
    if (!self && ctx.groupRole !== 'owner' && ctx.classRole !== 'teacher') throw err.forbidden('Only the group owner or a teacher can remove members');
    const target = await this.members.findOneBy({ groupId: id, userId });
    if (!target) throw err.notFound('Group member');
    await this.detach(ctx.group, userId);
  }

  /**
   * Retire un membre : ses verrous de projet tombent, la propriété passe au plus ancien,
   * et le groupe disparaît avec son dernier membre.
   */
  async detach(group: Group, userId: string) {
    const out = await this.db.transaction(async (m) => {
      await m.query('SELECT id FROM groups WHERE id = $1 FOR UPDATE', [group.id]);
      const removed = await m.getRepository(GroupMember).findOneBy({ groupId: group.id, userId });
      if (!removed) return null;
      await m.delete(GroupMember, { groupId: group.id, userId });
      const released = returningRows<{ id: string }>(
        await m.query(`UPDATE shared_projects SET lock_user_id = NULL, lock_expires_at = NULL WHERE group_id = $1 AND lock_user_id = $2 RETURNING id`, [
          group.id,
          userId,
        ]),
      );
      const rest = await m.getRepository(GroupMember).find({ where: { groupId: group.id }, order: { joinedAt: 'ASC', userId: 'ASC' } });
      const conv = await m.getRepository(Conversation).findOneBy({ kind: 'group', groupId: group.id });
      if (rest.length === 0) {
        await m.delete(Group, { id: group.id });
        return { deleted: true, released: [] as { id: string }[], conv };
      }
      if (removed.role === 'owner' && !rest.some((r) => r.role === 'owner')) {
        await m.update(GroupMember, { groupId: group.id, userId: rest[0].userId }, { role: 'owner' });
      }
      return { deleted: false, released, conv };
    });
    if (!out) return;
    if (out.deleted) {
      await this.afterDelete(group, out.conv, [userId]);
      return;
    }
    for (const p of out.released) this.realtime.toRooms(rooms.group(group.id), 'project:lock', { projectId: p.id, lock: null });
    this.realtime.leave([userId], [rooms.group(group.id)]);
    if (out.conv) this.convs.withdraw(out.conv.id, [userId]);
  }

  async remove(actor: Actor, id: string) {
    const { group } = await this.manageable(actor, id);
    const [conv, members] = await Promise.all([
      this.conversations.findOneBy({ kind: 'group', groupId: group.id }),
      this.members.findBy({ groupId: group.id }),
    ]);
    await this.groups.delete({ id: group.id });
    await this.afterDelete(group, conv, members.map((mb) => mb.userId));
  }

  private async afterDelete(group: Group, conv: Conversation | null, extra: string[]) {
    const teachers = await this.teacherIds(group.classroomId);
    if (conv) {
      this.convs.withdraw(conv.id, [...extra, ...teachers]);
      this.realtime.evacuate(rooms.conv(conv.id), [rooms.conv(conv.id)]);
    }
    this.realtime.evacuate(rooms.group(group.id), [rooms.group(group.id)]);
  }

  /** Élève retiré d'une classe : il quitte aussi les groupes de cette classe. */
  async detachFromClassroom(classroomId: string, userId: string) {
    const list = await this.groups
      .createQueryBuilder('g')
      .innerJoin(GroupMember, 'gm', 'gm.group_id = g.id AND gm.user_id = :uid', { uid: userId })
      .where('g.classroom_id = :cid', { cid: classroomId })
      .getMany();
    for (const g of list) await this.detach(g, userId);
  }

  /** Salles et conversations de groupe d'une classe (pour un enseignant qui arrive ou part). */
  async classroomGroupRooms(classroomId: string): Promise<{ groupIds: string[]; convIds: string[] }> {
    const rows: { id: string; conv_id: string | null }[] = await this.db.query(
      `SELECT g.id, c.id AS conv_id FROM groups g LEFT JOIN conversations c ON c.group_id = g.id AND c.kind = 'group' WHERE g.classroom_id = $1`,
      [classroomId],
    );
    return { groupIds: rows.map((r) => r.id), convIds: rows.map((r) => r.conv_id).filter((x): x is string => !!x) };
  }
}
