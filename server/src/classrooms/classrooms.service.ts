// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/actor';
import { AccessService } from '../common/access.service';
import { CLASS_COLORS, pick } from '../common/colors';
import { err } from '../common/errors';
import { PasswordService } from '../common/passwords';
import { publicRole, userView } from '../common/views';
import { Classroom, ClassroomMember, ClassRole, Conversation, DEFAULT_CLASSROOM_SETTINGS, User } from '../database/entities';
import { GroupsService } from '../groups/groups.service';
import { ConversationsService } from '../messaging/conversations.service';
import { RealtimeService, rooms } from '../realtime/realtime.service';
import { AccountsService } from '../users/accounts.service';
import { AddMembersDto, AddStudentsDto, ClassroomSettingsDto, CreateClassroomDto, UpdateClassroomDto } from './dto';

@Injectable()
export class ClassroomsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(Classroom) private readonly classrooms: Repository<Classroom>,
    @InjectRepository(ClassroomMember) private readonly members: Repository<ClassroomMember>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    private readonly access: AccessService,
    private readonly passwords: PasswordService,
    private readonly accounts: AccountsService,
    private readonly convs: ConversationsService,
    private readonly groups: GroupsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  private async views(list: { classroom: Classroom; role: ClassRole }[]) {
    if (!list.length) return [];
    const ids = list.map((l) => l.classroom.id);
    const [counts, teachers] = await Promise.all([
      this.db.query(`SELECT classroom_id, count(*)::int AS n FROM classroom_members WHERE role = 'student' AND classroom_id = ANY($1) GROUP BY classroom_id`, [ids]) as Promise<
        { classroom_id: string; n: number }[]
      >,
      this.db.query(
        `SELECT m.classroom_id, u.id, u.display_name FROM classroom_members m JOIN users u ON u.id = m.user_id
         WHERE m.role = 'teacher' AND m.classroom_id = ANY($1) ORDER BY m.joined_at, u.id`,
        [ids],
      ) as Promise<{ classroom_id: string; id: string; display_name: string }[]>,
    ]);
    return list.map(({ classroom: c, role }) => ({
      id: c.id,
      name: c.name,
      subject: c.subject,
      level: c.level,
      color: c.color,
      archived: c.archived,
      settings: c.settings,
      myRole: role,
      studentCount: counts.find((x) => x.classroom_id === c.id)?.n ?? 0,
      teachers: teachers.filter((t) => t.classroom_id === c.id).map((t) => ({ id: t.id, displayName: t.display_name })),
      createdAt: c.createdAt,
    }));
  }

  private async view(classroom: Classroom, role: ClassRole) {
    return (await this.views([{ classroom, role }]))[0];
  }

  /** Membres de la classe ; le nom d'utilisateur n'est montré qu'aux enseignants (et à soi). */
  async roster(classroomId: string, viewerRole: ClassRole, viewerId: string) {
    const rows: { id: string; display_name: string; username: string; avatar_color: string; last_seen_at: Date | null; role: ClassRole }[] = await this.db.query(
      `SELECT u.id, u.display_name, u.username, u.avatar_color, u.last_seen_at, m.role FROM classroom_members m
       JOIN users u ON u.id = m.user_id WHERE m.classroom_id = $1
       ORDER BY CASE m.role WHEN 'teacher' THEN 0 ELSE 1 END, u.display_name, u.id`,
      [classroomId],
    );
    return rows.map((r) => ({
      userId: r.id,
      displayName: r.display_name,
      username: viewerRole === 'teacher' || r.id === viewerId ? r.username : null,
      role: r.role,
      avatarColor: r.avatar_color,
      lastSeenAt: r.last_seen_at,
      online: this.realtime.isOnline(r.id),
    }));
  }

  private mergeSettings(base: typeof DEFAULT_CLASSROOM_SETTINGS, dto?: ClassroomSettingsDto) {
    const s = { ...base };
    if (dto?.allowStudentGroups !== undefined) s.allowStudentGroups = dto.allowStudentGroups;
    if (dto?.maxGroupSize !== undefined) s.maxGroupSize = dto.maxGroupSize;
    if (dto?.allowStudentDirectMessages !== undefined) s.allowStudentDirectMessages = dto.allowStudentDirectMessages;
    return s;
  }

  async list(actor: Actor, archived: boolean) {
    const rows = await this.members
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.classroom', 'c')
      .where('m.user_id = :uid AND c.archived = :archived AND c.school_id = :sid', { uid: actor.id, archived, sid: actor.schoolId })
      .orderBy('c.name', 'ASC')
      .getMany();
    return this.views(rows.map((m) => ({ classroom: m.classroom!, role: m.role })));
  }

  async create(actor: Actor, dto: CreateClassroomDto) {
    this.access.requireStaff(actor);
    this.access.requirePlan(actor);
    const { classroom, conv } = await this.db.transaction(async (m) => {
      const classroom = await m.save(
        m.create(Classroom, {
          schoolId: actor.schoolId,
          name: dto.name,
          subject: dto.subject || null,
          level: dto.level || null,
          color: dto.color ?? pick(CLASS_COLORS),
          archived: false,
          settings: this.mergeSettings(DEFAULT_CLASSROOM_SETTINGS, dto.settings),
        }),
      );
      await m.save(m.create(ClassroomMember, { classroomId: classroom.id, userId: actor.id, role: 'teacher' }));
      const conv = await this.convs.createForClassroom(m, actor.schoolId, classroom.id);
      return { classroom, conv };
    });
    this.realtime.join([actor.id], [rooms.class(classroom.id)]);
    await this.convs.announce(conv.id, actor.schoolId, [actor.id]);
    return this.view(classroom, 'teacher');
  }

  async get(actor: Actor, id: string) {
    const { classroom, role } = await this.access.classroom(actor, id);
    return { ...(await this.view(classroom, role)), members: await this.roster(id, role, actor.id) };
  }

  async update(actor: Actor, id: string, dto: UpdateClassroomDto) {
    const c = await this.access.teacherClassroom(actor, id);
    const wasArchived = c.archived;
    if (dto.name !== undefined) c.name = dto.name;
    if (dto.subject !== undefined) c.subject = dto.subject || null;
    if (dto.level !== undefined) c.level = dto.level || null;
    if (dto.color !== undefined) c.color = dto.color;
    if (dto.archived !== undefined) c.archived = dto.archived;
    c.settings = this.mergeSettings(c.settings, dto.settings);
    const saved = await this.classrooms.save(c);
    if (saved.archived !== wasArchived) {
      await this.audit.record({
        schoolId: actor.schoolId,
        actorId: actor.id,
        action: saved.archived ? 'classroom.archived' : 'classroom.unarchived',
        targetType: 'classroom',
        targetId: saved.id,
        details: { name: saved.name },
      });
    }
    return this.view(saved, 'teacher');
  }

  /** Comptes élèves créés et inscrits ; mots de passe provisoires rendus une seule fois. */
  async addStudents(actor: Actor, id: string, dto: AddStudentsDto) {
    const classroom = await this.access.teacherClassroom(actor, id);
    const passwords = dto.students.map(() => this.passwords.temporary());
    const hashes = await Promise.all(passwords.map((p) => this.passwords.hash(p)));
    const created = await this.db.transaction(async (m) => {
      const users = await this.accounts.create(
        m,
        actor.schoolId,
        dto.students.map((s, i) => ({
          displayName: s.displayName,
          username: s.username,
          role: 'student' as const,
          passwordHash: hashes[i],
          mustChangePassword: dto.requirePasswordChange ?? false,
        })),
      );
      await m.save(users.map((u) => m.create(ClassroomMember, { classroomId: classroom.id, userId: u.id, role: 'student' })));
      // Une ligne par lot (jusqu'à 200 comptes) : le journal reste court.
      await this.audit.record(
        {
          schoolId: actor.schoolId,
          actorId: actor.id,
          action: 'user.created',
          targetType: 'classroom',
          targetId: classroom.id,
          details: { role: 'student', count: users.length, classroomName: classroom.name, usernames: users.map((u) => u.username) },
        },
        m,
      );
      return users;
    });
    return created.map((u, i) => ({ user: userView(u), temporaryPassword: passwords[i] }));
  }

  async addMembers(actor: Actor, id: string, dto: AddMembersDto) {
    const classroom = await this.access.teacherClassroom(actor, id);
    const ids = [...new Set(dto.userIds)];
    const users = await this.users.findBy({ id: In(ids), schoolId: actor.schoolId });
    if (users.length !== ids.length) throw err.notFound('User');
    const existing = await this.members.findBy({ classroomId: id, userId: In(ids) });
    const fresh = users.filter((u) => !existing.some((e) => e.userId === u.id));
    if (fresh.length) {
      await this.members
        .createQueryBuilder()
        .insert()
        .values(fresh.map((u) => ({ classroomId: id, userId: u.id, role: publicRole(u.role) })))
        .orIgnore()
        .execute();
      await this.joinRooms(classroom, fresh);
    }
    return this.roster(id, 'teacher', actor.id);
  }

  /** Nouveaux membres connectés : salles de la classe, conversation de classe, groupes pour les enseignants. */
  private async joinRooms(classroom: Classroom, users: User[]) {
    const ids = users.map((u) => u.id);
    const teacherIds = users.filter((u) => u.role !== 'student').map((u) => u.id);
    this.realtime.join(ids, [rooms.class(classroom.id)]);
    const conv = await this.conversations.findOneBy({ kind: 'class', classroomId: classroom.id });
    if (conv) await this.convs.announce(conv.id, classroom.schoolId, ids);
    if (teacherIds.length) {
      const { groupIds, convIds } = await this.groups.classroomGroupRooms(classroom.id);
      this.realtime.join(teacherIds, groupIds.map(rooms.group));
      for (const cid of convIds) await this.convs.announce(cid, classroom.schoolId, teacherIds);
    }
  }

  async removeMember(actor: Actor, id: string, userId: string) {
    const classroom = await this.access.teacherClassroom(actor, id);
    const member = await this.members.findOneBy({ classroomId: id, userId });
    if (!member) throw err.notFound('Member');
    if (member.role === 'teacher') {
      const teachers = await this.members.countBy({ classroomId: id, role: 'teacher' });
      if (teachers <= 1) throw err.forbidden('A classroom needs at least one teacher');
    } else {
      await this.groups.detachFromClassroom(id, userId);
    }
    await this.members.delete({ classroomId: id, userId });

    this.realtime.leave([userId], [rooms.class(classroom.id)]);
    const conv = await this.conversations.findOneBy({ kind: 'class', classroomId: id });
    if (conv) this.convs.withdraw(conv.id, [userId]);
    if (member.role === 'teacher') {
      const { groupIds, convIds } = await this.groups.classroomGroupRooms(id);
      this.realtime.leave([userId], groupIds.map(rooms.group));
      for (const cid of convIds) this.convs.withdraw(cid, [userId]);
    }
  }
}
