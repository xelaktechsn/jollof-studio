// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThan, Repository } from 'typeorm';
import type { Actor } from '../auth/actor';
import { AccessService } from '../common/access.service';
import { AppError, err } from '../common/errors';
import { assertProject, isPlainObject } from '../common/json';
import { assertDocOrNull } from '../common/rich-doc';
import { Assignment, Classroom, ClassRole, ItemScore, Submission, User } from '../database/entities';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { GradeDto, SaveSubmissionDto } from './dto';
import { autoGrade, sumScores } from './grading';
import { normalizeAnswers, normalizeCircuit } from './items';
import { submissionView, summaryView } from './views';

// Marge réseau après l'échéance d'une copie minutée : une sauvegarde partie à temps n'est pas perdue.
export const DEADLINE_GRACE_MS = 10_000;
const SWEEP_MS = 30_000;

const LIST_SELECT = {
  id: true, assignmentId: true, studentId: true, attempt: true, status: true, answers: true, circuit: true, itemScores: true,
  score: true, maxScore: true, feedback: true, late: true, deadlineAt: true, startedAt: true, submittedAt: true, gradedAt: true, returnedAt: true,
} as const;
export const SUMMARY_SELECT = {
  id: true, assignmentId: true, studentId: true, attempt: true, status: true, score: true,
  maxScore: true, submittedAt: true, late: true,
} as const;
// Devoir lu pour corriger ou contrôler une copie : sans montage de départ ni consigne.
const ASSIGNMENT_CORE_SELECT = {
  id: true, classroomId: true, authorId: true, kind: true, title: true, items: true, settings: true, status: true,
  audience: true, dueAt: true, publishedAt: true, totalPoints: true, createdAt: true, updatedAt: true,
} as const;

interface Loaded {
  submission: Submission;
  assignment: Assignment;
  classroom: Classroom;
  role: ClassRole;
}

// Les colonnes jsonb (Record<…>) ne passent pas le typage profond d'update() : forme vérifiée ici.
type Patch = Parameters<EntityManager['update']>[2];

const expired = (s: Submission, now: number) => s.status === 'in_progress' && !!s.deadlineAt && now > s.deadlineAt.getTime() + DEADLINE_GRACE_MS;

@Injectable()
export class SubmissionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Submissions');
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(Submission) private readonly subs: Repository<Submission>,
    @InjectRepository(Assignment) private readonly assignments: Repository<Assignment>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  // Copies minutées abandonnées : envoyées d'office une fois l'échéance passée.
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => this.sweep().catch((e) => this.logger.warn(`sweep: ${e.message}`)), SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(assignmentId?: string) {
    const cutoff = new Date(Date.now() - DEADLINE_GRACE_MS);
    const due = await this.subs.find({
      select: { id: true },
      where: { status: 'in_progress', deadlineAt: LessThan(cutoff), ...(assignmentId ? { assignmentId } : {}) },
    });
    for (const { id } of due) {
      const done = await this.db.transaction(async (m) => {
        const s = await m.getRepository(Submission).findOne({ select: LIST_SELECT, where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!s || !expired(s, Date.now())) return null;
        const a = await m.getRepository(Assignment).findOneOrFail({ select: ASSIGNMENT_CORE_SELECT, where: { id: s.assignmentId } });
        await this.finalize(m, s, a);
        return { s, a };
      });
      if (done) await this.afterSubmit(done.a, done.s, true);
    }
  }

  // ---- chargement et droits

  /** Copie et droits ; `full` : avec le projet de l'élève (jusqu'à 5 Mo), seulement pour le renvoyer. */
  private async load(actor: Actor, id: string, full = false): Promise<Loaded> {
    const submission = await this.subs.findOne({ where: { id }, ...(full ? {} : { select: LIST_SELECT }) });
    if (!submission) throw err.notFound('Submission');
    const assignment = await this.assignments.findOne({ select: ASSIGNMENT_CORE_SELECT, where: { id: submission.assignmentId } });
    if (!assignment) throw err.notFound('Submission');
    const { classroom, role } = await this.access.classroom(actor, assignment.classroomId);
    // Un élève ne voit que ses propres copies ; celles des autres n'existent pas pour lui.
    if (role !== 'teacher' && submission.studentId !== actor.id) throw err.notFound('Submission');
    return { submission, assignment, classroom, role };
  }

  private async loadOwn(actor: Actor, id: string): Promise<Loaded> {
    const l = await this.load(actor, id);
    if (l.submission.studentId !== actor.id) throw err.forbidden('Only the student can edit this submission');
    return l;
  }

  /** Devoir publié (ou clos) visant cet élève. */
  async targetedFor(actor: Actor, assignmentId: string): Promise<{ assignment: Assignment; classroom: Classroom }> {
    const assignment = await this.assignments.findOne({ select: ASSIGNMENT_CORE_SELECT, where: { id: assignmentId } });
    if (!assignment) throw err.notFound('Assignment');
    const { classroom, role } = await this.access.classroom(actor, assignment.classroomId);
    if (role !== 'student') throw err.forbidden('Students only');
    const targeted = assignment.audience.all || assignment.audience.userIds.includes(actor.id);
    if (assignment.status === 'draft' || !targeted) throw err.notFound('Assignment');
    return { assignment, classroom };
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.users.find({ select: { id: true, displayName: true }, where: { id: In([...new Set(ids)]) } });
    return new Map(rows.map((u) => [u.id, u.displayName]));
  }

  async view(s: Submission, a: Assignment, forStudent: boolean) {
    const names = await this.names([s.studentId]);
    return submissionView(s, a, names.get(s.studentId) ?? '', forStudent);
  }

  // ---- cycle de vie d'une copie

  /** Envoi : correction automatique, statut graded/submitted, retard éventuel. */
  async finalize(m: EntityManager, s: Submission, a: Assignment, now = new Date()) {
    const g = autoGrade(a.items, a.settings, s.answers, s.circuit);
    const fields = {
      itemScores: g.itemScores,
      score: g.score,
      status: g.status,
      maxScore: a.totalPoints,
      submittedAt: now,
      gradedAt: g.status === 'graded' ? now : null,
      late: s.late || (!!a.dueAt && now.getTime() > a.dueAt.getTime()),
    };
    // update() et non save() : save relirait toute la ligne (projet compris) pour comparer.
    await m.update(Submission, { id: s.id }, fields as Patch);
    return Object.assign(s, fields);
  }

  /** Après envoi : enseignants prévenus (temps réel + notification, sauf envoi groupé à la clôture). */
  async afterSubmit(a: Assignment, s: Submission, notify: boolean) {
    await this.emitUpdate(a, [s]);
    if (!notify) return;
    const [teachers, classroom, names] = await Promise.all([
      this.teacherIds(a.classroomId),
      this.db.getRepository(Classroom).findOneBy({ id: a.classroomId }),
      this.names([s.studentId]),
    ]);
    await this.notifications.notify(teachers, 'submission_received', {
      assignmentId: a.id,
      assignmentTitle: a.title,
      classroomId: a.classroomId,
      classroomName: classroom?.name ?? '',
      submissionId: s.id,
      studentId: s.studentId,
      studentName: names.get(s.studentId) ?? '',
      byName: names.get(s.studentId) ?? '',
    });
  }

  private async teacherIds(classroomId: string): Promise<string[]> {
    const rows: { user_id: string }[] = await this.db.query(`SELECT user_id FROM classroom_members WHERE classroom_id = $1 AND role = 'teacher'`, [classroomId]);
    return rows.map((r) => r.user_id);
  }

  async emitUpdate(a: Assignment, list: Submission[]) {
    if (!list.length) return;
    const [teachers, names] = await Promise.all([this.teacherIds(a.classroomId), this.names(list.map((s) => s.studentId))]);
    for (const s of list) {
      this.realtime.toUsers(teachers, 'submission:updated', {
        assignmentId: a.id,
        submission: { ...summaryView(s, a, false), studentId: s.studentId, studentName: names.get(s.studentId) ?? '' },
      });
    }
  }

  async start(actor: Actor, assignmentId: string) {
    const { assignment } = await this.targetedFor(actor, assignmentId);
    const result = await this.db.transaction(async (m) => {
      // Un élève qui double-clique ne crée pas deux tentatives.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`start:${assignmentId}:${actor.id}`]);
      const repo = m.getRepository(Submission);
      const a = await m.getRepository(Assignment).findOneOrFail({ select: ASSIGNMENT_CORE_SELECT, where: { id: assignmentId } });
      const now = new Date();
      let finished: Submission | null = null;
      const current = await repo.findOneBy({ assignmentId, studentId: actor.id, status: 'in_progress' });
      if (current) {
        if (!expired(current, now.getTime())) return { s: current, created: false, finished };
        finished = await this.finalize(m, current, a, now);
      }
      if (a.status !== 'published') throw new AppError(409, 'ASSIGNMENT_CLOSED', 'This assignment is closed');
      const attempts = await repo.countBy({ assignmentId, studentId: actor.id });
      if (a.settings.maxAttempts > 0 && attempts >= a.settings.maxAttempts) throw new AppError(409, 'ATTEMPTS_EXHAUSTED', 'No attempts left');
      const late = !!a.dueAt && now.getTime() > a.dueAt.getTime();
      if (late && !a.settings.allowLate) throw new AppError(409, 'PAST_DUE', 'The due date has passed');
      const s = await repo.save(
        repo.create({
          assignmentId,
          studentId: actor.id,
          attempt: attempts + 1,
          status: 'in_progress',
          answers: {},
          itemScores: {},
          maxScore: a.totalPoints,
          late,
          startedAt: now,
          deadlineAt: a.settings.timeLimitMinutes ? new Date(now.getTime() + a.settings.timeLimitMinutes * 60_000) : null,
        }),
      );
      return { s, created: true, finished };
    });
    if (result.finished) await this.afterSubmit(assignment, result.finished, true);
    if (result.created) await this.emitUpdate(assignment, [result.s]);
    return this.view(result.s, assignment, true);
  }

  private prepare(dto: SaveSubmissionDto, a: Assignment) {
    return {
      answers: dto.answers != null ? normalizeAnswers(dto.answers, a.items) : undefined,
      project: dto.project === undefined ? undefined : dto.project === null ? null : (assertProject(dto.project, 'project'), dto.project),
      circuit: dto.circuit === undefined ? undefined : dto.circuit === null ? null : normalizeCircuit(dto.circuit),
    };
  }

  /** Sauvegarde (submit=false) ou envoi (submit=true) d'une copie en cours. */
  async write(actor: Actor, id: string, dto: SaveSubmissionDto, submit: boolean) {
    const { assignment } = await this.loadOwn(actor, id);
    const patch = this.prepare(dto, assignment);
    const out = await this.db.transaction(async (m) => {
      const s = await m.getRepository(Submission).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!s) throw err.notFound('Submission');
      if (s.status !== 'in_progress') throw new AppError(409, 'SUBMISSION_LOCKED', 'This submission was already sent');
      const a = await m.getRepository(Assignment).findOneOrFail({ select: ASSIGNMENT_CORE_SELECT, where: { id: s.assignmentId } });
      // Temps écoulé : la copie part avec ce qui était déjà enregistré.
      if (expired(s, Date.now())) return { s: await this.finalize(m, s, a), a, timeUp: true };
      const changes: Partial<Pick<Submission, 'answers' | 'project' | 'circuit'>> = {};
      if (patch.answers) changes.answers = { ...s.answers, ...patch.answers };
      if (patch.project !== undefined) changes.project = patch.project;
      if (patch.circuit !== undefined) changes.circuit = patch.circuit;
      if (Object.keys(changes).length) {
        await m.update(Submission, { id }, changes as Patch);
        Object.assign(s, changes);
      }
      return { s: submit ? await this.finalize(m, s, a) : s, a, timeUp: false };
    });
    if (out.timeUp || submit) await this.afterSubmit(out.a, out.s, true);
    if (out.timeUp) throw new AppError(409, 'TIME_UP', 'Time is up: the submission was sent with its saved content');
    return this.view(out.s, out.a, true);
  }

  async get(actor: Actor, id: string) {
    let { submission, assignment, role } = await this.load(actor, id, true);
    if (expired(submission, Date.now())) {
      await this.sweep(assignment.id);
      submission = await this.subs.findOneByOrFail({ id });
    }
    return this.view(submission, assignment, role !== 'teacher');
  }

  async mine(actor: Actor, assignmentId: string) {
    const { assignment } = await this.targetedFor(actor, assignmentId);
    await this.sweep(assignmentId);
    // Toutes les tentatives, mais le projet (jusqu'à 5 Mo) de la dernière seulement ; les
    // précédentes ont `project: null` (GET /submissions/:id les donne en entier).
    const list = await this.subs.find({ select: LIST_SELECT, where: { assignmentId, studentId: actor.id }, order: { attempt: 'ASC' } });
    const last = list[list.length - 1];
    if (last) {
      const row = await this.subs.findOne({ select: { id: true, project: true }, where: { id: last.id } });
      last.project = row?.project ?? null;
    }
    return list.map((s) => submissionView({ ...s, project: s.project ?? null }, assignment, actor.displayName, true));
  }

  /** Une ligne par élève visé : sa dernière tentative, ou « not_started ». */
  async listForAssignment(actor: Actor, assignmentId: string) {
    const a = await this.assignments.findOne({ select: ASSIGNMENT_CORE_SELECT, where: { id: assignmentId } });
    if (!a) throw err.notFound('Assignment');
    await this.access.teacherClassroom(actor, a.classroomId, false);
    await this.sweep(assignmentId);
    const students: { id: string; display_name: string }[] = await this.db.query(
      `SELECT u.id, u.display_name FROM classroom_members m JOIN users u ON u.id = m.user_id
       WHERE m.classroom_id = $1 AND m.role = 'student' ORDER BY u.display_name, u.id`,
      [a.classroomId],
    );
    const targeted = students.filter((st) => a.audience.all || a.audience.userIds.includes(st.id));
    const summaries = await this.subs.find({ select: SUMMARY_SELECT, where: { assignmentId } });
    const latestId = new Map<string, Submission>();
    for (const s of summaries) {
      const cur = latestId.get(s.studentId);
      if (!cur || s.attempt > cur.attempt) latestId.set(s.studentId, s);
    }
    const ids = targeted.map((st) => latestId.get(st.id)?.id).filter((x): x is string => !!x);
    // Liste : sans le projet de chaque élève (jusqu'à 5 Mo chacun) ; GET /submissions/:id le donne.
    const full = ids.length ? await this.subs.find({ where: { id: In(ids) }, select: LIST_SELECT }) : [];
    const byStudent = new Map(full.map((s) => [s.studentId, s]));
    return targeted.map((st) => {
      const s = byStudent.get(st.id);
      return s ? { ...submissionView(s, a, st.display_name, false), project: null } : { studentId: st.id, studentName: st.display_name, status: 'not_started' as const };
    });
  }

  async grade(actor: Actor, id: string, dto: GradeDto) {
    const { assignment: a, role } = await this.load(actor, id);
    if (role !== 'teacher') throw err.forbidden('Only teachers of this classroom can grade');
    this.access.requirePlan(actor);

    const items = new Map(a.items.map((it) => [it.id, it]));
    const updates: Record<string, { points: number; comment?: string | null }> = {};
    for (const [itemId, v] of Object.entries(dto.itemScores ?? {})) {
      const item = items.get(itemId);
      if (!item || item.type === 'text') throw err.validation(`itemScores.${itemId}: unknown or ungraded item`);
      if (!isPlainObject(v)) throw err.validation(`itemScores.${itemId} must be { points, comment? }`);
      const { points, comment } = v;
      if (typeof points !== 'number' || !Number.isFinite(points) || points < 0 || points > item.points) {
        throw err.validation(`itemScores.${itemId}.points must be between 0 and ${item.points}`);
      }
      if (comment !== undefined && comment !== null && (typeof comment !== 'string' || comment.length > 2000)) {
        throw err.validation(`itemScores.${itemId}.comment must be a string (max 2000)`);
      }
      updates[itemId] = { points, comment: comment as string | null | undefined };
    }
    const feedback = dto.feedback === undefined ? undefined : assertDocOrNull(dto.feedback, 'feedback');

    const out = await this.db.transaction(async (m) => {
      const s = await m.getRepository(Submission).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!s) throw err.notFound('Submission');
      if (s.status === 'in_progress') throw new AppError(409, 'SUBMISSION_LOCKED', 'This submission has not been sent yet');
      const prev = s.status;
      const scores: Record<string, ItemScore> = { ...s.itemScores };
      // Items absents (devoir modifié après l'envoi) : à corriger à la main.
      for (const it of a.items) {
        if (it.type !== 'text' && !scores[it.id]) scores[it.id] = { points: null, max: it.points, auto: false, comment: null };
      }
      for (const [itemId, u] of Object.entries(updates)) {
        const cur = scores[itemId];
        scores[itemId] = {
          ...cur,
          points: u.points,
          max: (items.get(itemId) as { points: number }).points,
          auto: cur.auto && cur.points === u.points,
          comment: u.comment === undefined ? cur.comment : u.comment,
        };
      }
      const score = sumScores(scores);
      const complete = score !== null;
      if (dto.return === true && !complete) throw err.validation('Every open item must be scored before returning the submission');
      const returned = dto.return === true || (prev === 'returned' && dto.return !== false && complete);
      const now = new Date();
      const fields = {
        itemScores: scores,
        score,
        maxScore: a.totalPoints,
        feedback: feedback !== undefined ? feedback : s.feedback,
        status: (returned ? 'returned' : complete ? 'graded' : 'submitted') as Submission['status'],
        gradedAt: complete ? now : null,
        returnedAt: returned ? (prev === 'returned' && s.returnedAt ? s.returnedAt : now) : null,
      };
      await m.update(Submission, { id }, fields as Patch);
      return { s: Object.assign(s, fields), prev };
    });

    const s = out.s;
    await this.emitUpdate(a, [s]);
    const classroom = await this.db.getRepository(Classroom).findOneBy({ id: a.classroomId });
    const data = { assignmentId: a.id, assignmentTitle: a.title, classroomId: a.classroomId, classroomName: classroom?.name ?? '', submissionId: s.id, byName: actor.displayName };
    if (s.status === 'returned' && out.prev !== 'returned') {
      await this.notifications.notify([s.studentId], 'submission_returned', data);
    } else if (s.status === 'graded' && out.prev === 'submitted' && a.settings.showResults === 'immediately') {
      await this.notifications.notify([s.studentId], 'submission_graded', data);
    }
    return this.view(s, a, false);
  }

  /** Clôture : les copies en cours partent telles quelles. */
  async finalizeAll(m: EntityManager, a: Assignment): Promise<Submission[]> {
    const open = await m.getRepository(Submission).find({ select: LIST_SELECT, where: { assignmentId: a.id, status: 'in_progress' }, lock: { mode: 'pessimistic_write' } });
    const now = new Date();
    const out: Submission[] = [];
    for (const s of open) out.push(await this.finalize(m, s, a, now));
    return out;
  }
}
