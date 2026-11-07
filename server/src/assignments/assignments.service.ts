// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsOrder, FindOptionsWhere, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/actor';
import { AccessService } from '../common/access.service';
import { err } from '../common/errors';
import { assertProject, parseDate } from '../common/json';
import { assertDocOrNull } from '../common/rich-doc';
import { Assignment, AssignmentSettings, Audience, Classroom, Submission } from '../database/entities';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AssignmentSettingsDto, AudienceDto, CreateAssignmentDto, UpdateAssignmentDto } from './dto';
import { assertPublishable, defaultSettings, normalizeItems, totalPoints } from './items';
import { SUMMARY_SELECT, SubmissionsService } from './submissions.service';
import { AssignmentRow, computeStats, gradebookPick, studentAssignmentView, summaryView, teacherAssignmentView } from './views';

type ClassRef = Pick<Classroom, 'id' | 'name' | 'color'>;

/** Colonnes d'un devoir pour les listes : tout sauf le montage de départ (jusqu'à 5 Mo). */
export const ASSIGNMENT_LIST_SELECT = {
  id: true, classroomId: true, authorId: true, kind: true, title: true, instructions: true, items: true, settings: true,
  status: true, audience: true, dueAt: true, publishedAt: true, totalPoints: true, createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class AssignmentsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(Assignment) private readonly repo: Repository<Assignment>,
    @InjectRepository(Submission) private readonly subs: Repository<Submission>,
    @InjectRepository(Classroom) private readonly classrooms: Repository<Classroom>,
    private readonly access: AccessService,
    private readonly submissions: SubmissionsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  // ---- aides

  /** Devoirs pour une liste : sans `starterProject`, avec `hasStarterProject`. */
  private async listRows(where: FindOptionsWhere<Assignment>, order?: FindOptionsOrder<Assignment>): Promise<AssignmentRow[]> {
    const list: AssignmentRow[] = await this.repo.find({ select: ASSIGNMENT_LIST_SELECT, where, order });
    if (!list.length) return list;
    const withStarter: { id: string }[] = await this.db.query('SELECT id FROM assignments WHERE id = ANY($1) AND starter_project IS NOT NULL', [list.map((a) => a.id)]);
    const ids = new Set(withStarter.map((r) => r.id));
    for (const a of list) {
      a.starterProject = null;
      a.hasStarterProject = ids.has(a.id);
    }
    return list;
  }

  private async classStudents(classroomIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>(classroomIds.map((id) => [id, []]));
    if (!classroomIds.length) return out;
    const rows: { classroom_id: string; user_id: string }[] = await this.db.query(
      `SELECT classroom_id, user_id FROM classroom_members WHERE role = 'student' AND classroom_id = ANY($1)`,
      [classroomIds],
    );
    rows.forEach((r) => out.get(r.classroom_id)!.push(r.user_id));
    return out;
  }

  private targeted(a: Assignment, students: string[]): string[] {
    const aud = a.audience;
    return aud.all ? students : students.filter((id) => aud.userIds.includes(id));
  }

  private async teacherViews(list: Assignment[], classes: Map<string, ClassRef>) {
    if (!list.length) return [];
    const students = await this.classStudents([...new Set(list.map((a) => a.classroomId))]);
    const rows = await this.subs.find({ select: { assignmentId: true, studentId: true, attempt: true, status: true }, where: { assignmentId: In(list.map((a) => a.id)) } });
    return list.map((a) => {
      const { toGrade, ...stats } = computeStats(this.targeted(a, students.get(a.classroomId) ?? []), rows.filter((r) => r.assignmentId === a.id));
      return { view: teacherAssignmentView(a, classes.get(a.classroomId)!, stats), toGrade };
    });
  }

  private async studentViews(list: Assignment[], classes: Map<string, ClassRef>, studentId: string) {
    if (!list.length) return [];
    const rows = await this.subs.find({ select: SUMMARY_SELECT, where: { studentId, assignmentId: In(list.map((a) => a.id)) } });
    return list.map((a) => {
      const latest = rows.filter((r) => r.assignmentId === a.id).sort((x, y) => y.attempt - x.attempt)[0] ?? null;
      return studentAssignmentView(a, classes.get(a.classroomId)!, studentId, latest);
    });
  }

  private async one(a: Assignment, classroom: ClassRef, actor: Actor, asTeacher: boolean) {
    const classes = new Map([[classroom.id, classroom]]);
    if (asTeacher) return (await this.teacherViews([a], classes))[0].view;
    return (await this.studentViews([a], classes, actor.id))[0];
  }

  private settings(base: AssignmentSettings, dto?: AssignmentSettingsDto): AssignmentSettings {
    if (!dto) return base;
    const s = { ...base };
    if (dto.maxAttempts !== undefined) s.maxAttempts = dto.maxAttempts;
    if (dto.showResults !== undefined) s.showResults = dto.showResults;
    if (dto.timeLimitMinutes !== undefined) s.timeLimitMinutes = dto.timeLimitMinutes;
    if (dto.allowLate !== undefined) s.allowLate = dto.allowLate;
    if (dto.faultPenalty !== undefined) s.faultPenalty = dto.faultPenalty;
    return s;
  }

  private async audience(dto: AudienceDto, classroomId: string): Promise<Audience> {
    if (dto.all) return { all: true };
    const ids = [...new Set(dto.userIds ?? [])];
    const students = (await this.classStudents([classroomId])).get(classroomId)!;
    const outside = ids.find((id) => !students.includes(id));
    if (outside) throw err.notInClass(`User ${outside} is not a student of this classroom`);
    return { all: false, userIds: ids };
  }

  private async apply(a: Assignment, dto: UpdateAssignmentDto | CreateAssignmentDto) {
    if (dto.kind !== undefined) a.kind = dto.kind;
    if (dto.title !== undefined) a.title = dto.title;
    if (dto.instructions !== undefined) a.instructions = assertDocOrNull(dto.instructions, 'instructions');
    if (dto.items !== undefined) a.items = normalizeItems(dto.items);
    if (dto.starterProject !== undefined) {
      if (dto.starterProject !== null) assertProject(dto.starterProject, 'starterProject');
      a.starterProject = dto.starterProject;
    }
    a.settings = this.settings(a.settings ?? defaultSettings(a.kind), dto.settings);
    if (dto.audience !== undefined) a.audience = await this.audience(dto.audience, a.classroomId);
    const dueAt = parseDate(dto.dueAt, 'dueAt');
    if (dueAt !== undefined) a.dueAt = dueAt;
    a.totalPoints = totalPoints(a.items);
    if (a.status !== 'draft') assertPublishable(a.items);
  }

  /** Devoir visible : enseignant de la classe, ou élève visé (publié/clos). */
  private async load(actor: Actor, id: string) {
    const a = await this.repo.findOneBy({ id });
    if (!a) throw err.notFound('Assignment');
    const { classroom, role } = await this.access.classroom(actor, a.classroomId);
    if (role === 'student' && (a.status === 'draft' || !(a.audience.all || a.audience.userIds.includes(actor.id)))) {
      throw err.notFound('Assignment');
    }
    return { a, classroom, role };
  }

  private async teacherLoad(actor: Actor, id: string, plan = true) {
    const a = await this.repo.findOneBy({ id });
    if (!a) throw err.notFound('Assignment');
    const classroom = await this.access.teacherClassroom(actor, a.classroomId, plan);
    return { a, classroom };
  }

  // ---- points d'accès

  async listForClassroom(actor: Actor, classroomId: string) {
    const { classroom, role } = await this.access.classroom(actor, classroomId);
    const classes = new Map([[classroom.id, classroom as ClassRef]]);
    if (role === 'teacher') {
      const list = await this.listRows({ classroomId }, { createdAt: 'DESC' });
      return (await this.teacherViews(list, classes)).map((v) => v.view);
    }
    const list = (await this.listRows({ classroomId, status: In(['published', 'closed']) }, { publishedAt: 'DESC' })).filter(
      (a) => a.audience.all || a.audience.userIds.includes(actor.id),
    );
    return this.studentViews(list, classes, actor.id);
  }

  async create(actor: Actor, classroomId: string, dto: CreateAssignmentDto) {
    const classroom = await this.access.teacherClassroom(actor, classroomId);
    const a = this.repo.create({ classroomId, authorId: actor.id, kind: dto.kind, title: dto.title, items: [], audience: { all: true }, status: 'draft', instructions: null, starterProject: null, dueAt: null });
    a.settings = defaultSettings(dto.kind);
    await this.apply(a, dto);
    const saved = await this.repo.save(a);
    return this.one(saved, classroom, actor, true);
  }

  async get(actor: Actor, id: string) {
    const { a, classroom, role } = await this.load(actor, id);
    return this.one(a, classroom, actor, role === 'teacher');
  }

  async update(actor: Actor, id: string, dto: UpdateAssignmentDto) {
    const { a, classroom } = await this.teacherLoad(actor, id);
    await this.apply(a, dto);
    return this.one(await this.repo.save(a), classroom, actor, true);
  }

  async publish(actor: Actor, id: string, dueAtRaw: string | null | undefined) {
    const { a, classroom } = await this.teacherLoad(actor, id);
    assertPublishable(a.items);
    const dueAt = parseDate(dueAtRaw, 'dueAt');
    if (dueAt !== undefined) a.dueAt = dueAt;
    const first = !a.publishedAt;
    a.status = 'published';
    a.publishedAt ??= new Date();
    const saved = await this.repo.save(a);
    if (first) {
      await this.audit.record({
        schoolId: actor.schoolId,
        actorId: actor.id,
        action: 'assignment.published',
        targetType: 'assignment',
        targetId: saved.id,
        details: { title: saved.title, kind: saved.kind, classroomId: classroom.id, classroomName: classroom.name },
      });
      const targets = this.targeted(saved, (await this.classStudents([classroom.id])).get(classroom.id)!);
      await this.notifications.notify(targets, 'assignment_published', {
        assignmentId: saved.id,
        assignmentTitle: saved.title,
        kind: saved.kind,
        classroomId: classroom.id,
        classroomName: classroom.name,
        dueAt: saved.dueAt,
        byName: actor.displayName,
      });
      // Vue de liste (sans le montage de départ) : un événement par élève, pas 5 Mo chacun.
      const light: AssignmentRow = { ...saved, starterProject: null, hasStarterProject: saved.starterProject != null };
      for (const uid of targets) {
        this.realtime.toUsers(uid, 'assignment:published', { assignment: studentAssignmentView(light, classroom, uid, null) });
      }
    }
    return this.one(saved, classroom, actor, true);
  }

  async close(actor: Actor, id: string) {
    const { a, classroom } = await this.teacherLoad(actor, id);
    if (a.status === 'draft') throw err.validation('A draft cannot be closed');
    const { saved, sent } = await this.db.transaction(async (m) => {
      a.status = 'closed';
      const saved = await m.save(a);
      return { saved, sent: await this.submissions.finalizeAll(m, saved) };
    });
    await this.submissions.emitUpdate(saved, sent);
    return this.one(saved, classroom, actor, true);
  }

  async duplicate(actor: Actor, id: string, classroomId?: string) {
    const { a } = await this.teacherLoad(actor, id);
    const target = classroomId && classroomId !== a.classroomId ? await this.access.teacherClassroom(actor, classroomId) : await this.access.teacherClassroom(actor, a.classroomId);
    const copy = this.repo.create({
      classroomId: target.id,
      authorId: actor.id,
      kind: a.kind,
      title: a.title,
      instructions: a.instructions,
      items: a.items,
      starterProject: a.starterProject,
      settings: a.settings,
      status: 'draft',
      // Les élèves visés appartiennent à la classe d'origine.
      audience: target.id === a.classroomId ? a.audience : { all: true },
      dueAt: null,
      publishedAt: null,
      totalPoints: a.totalPoints,
    });
    return this.one(await this.repo.save(copy), target, actor, true);
  }

  async remove(actor: Actor, id: string) {
    const { a, classroom } = await this.teacherLoad(actor, id);
    const submissions = await this.subs.countBy({ assignmentId: a.id });
    await this.repo.delete({ id: a.id });
    await this.audit.record({
      schoolId: actor.schoolId,
      actorId: actor.id,
      action: 'assignment.deleted',
      targetType: 'assignment',
      targetId: a.id,
      details: { title: a.title, kind: a.kind, status: a.status, classroomId: classroom.id, classroomName: classroom.name, submissions },
    });
  }

  /** Tableau de bord : élève → devoirs qui le visent ; enseignant → devoirs de ses classes, à corriger d'abord. */
  async forMe(actor: Actor) {
    const classes = new Map<string, ClassRef>();
    const rows: { id: string; name: string; color: string; role: string }[] = await this.db.query(
      `SELECT c.id, c.name, c.color, m.role FROM classroom_members m JOIN classrooms c ON c.id = m.classroom_id
       WHERE m.user_id = $1 AND NOT c.archived`,
      [actor.id],
    );
    rows.forEach((r) => classes.set(r.id, r));
    const teacherOf = rows.filter((r) => r.role === 'teacher').map((r) => r.id);
    const studentOf = rows.filter((r) => r.role === 'student').map((r) => r.id);
    const byDue = (x: { dueAt: Date | null }, y: { dueAt: Date | null }) =>
      (x.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (y.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER);

    if (actor.role === 'student') {
      const list = studentOf.length
        ? (await this.listRows({ classroomId: In(studentOf), status: In(['published', 'closed']) })).filter(
            (a) => a.audience.all || a.audience.userIds.includes(actor.id),
          )
        : [];
      return (await this.studentViews(list, classes, actor.id)).sort(byDue);
    }
    const list = teacherOf.length ? await this.listRows({ classroomId: In(teacherOf) }) : [];
    const views = await this.teacherViews(list, classes);
    return views
      .sort((x, y) => (y.toGrade > 0 ? 1 : 0) - (x.toGrade > 0 ? 1 : 0) || byDue(x.view, y.view) || y.view.createdAt.getTime() - x.view.createdAt.getTime())
      .map((v) => v.view);
  }

  /** Carnet de notes : devoirs publiés × élèves ; un élève ne voit que sa ligne. */
  async grades(actor: Actor, classroomId: string) {
    const { classroom, role } = await this.access.classroom(actor, classroomId);
    const asStudent = role === 'student';
    let assignments = await this.repo.find({
      select: { id: true, title: true, kind: true, totalPoints: true, dueAt: true, audience: true, settings: true, status: true, publishedAt: true, createdAt: true },
      where: { classroomId: classroom.id, status: In(['published', 'closed']) },
      order: { publishedAt: 'ASC', createdAt: 'ASC' },
    });
    let students: { id: string; displayName: string }[];
    if (asStudent) {
      students = [{ id: actor.id, displayName: actor.displayName }];
      assignments = assignments.filter((a) => a.audience.all || a.audience.userIds.includes(actor.id));
    } else {
      const rows: { id: string; display_name: string }[] = await this.db.query(
        `SELECT u.id, u.display_name FROM classroom_members m JOIN users u ON u.id = m.user_id
         WHERE m.classroom_id = $1 AND m.role = 'student' ORDER BY u.display_name, u.id`,
        [classroom.id],
      );
      students = rows.map((r) => ({ id: r.id, displayName: r.display_name }));
    }
    const subs = assignments.length && students.length
      ? await this.subs.find({ select: SUMMARY_SELECT, where: { assignmentId: In(assignments.map((a) => a.id)), studentId: In(students.map((s) => s.id)) } })
      : [];
    const cells: Record<string, Record<string, unknown>> = {};
    for (const st of students) {
      const row: Record<string, unknown> = {};
      for (const a of assignments) {
        if (!(a.audience.all || a.audience.userIds.includes(st.id))) continue;
        const pick = gradebookPick(subs.filter((s) => s.assignmentId === a.id && s.studentId === st.id));
        row[a.id] = pick ? summaryView(pick, a, asStudent) : { status: 'not_started' };
      }
      cells[st.id] = row;
    }
    return {
      assignments: assignments.map((a) => ({ id: a.id, title: a.title, kind: a.kind, totalPoints: a.totalPoints, dueAt: a.dueAt })),
      students,
      cells,
    };
  }
}
