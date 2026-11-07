// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { anon, createApp, doc, registerSchool, Session, setupClass, TestApp } from './helpers';

const NETS = [
  ['LED1.A', 'R1.2'],
  ['R1.1', 'UNO.D13'],
  ['LED1.K', 'UNO.GND'],
];

const ITEMS = [
  { id: 'intro', type: 'text', content: doc('Lisez la consigne.') },
  {
    id: 'q1',
    type: 'choice',
    prompt: doc('Quelle résistance pour une LED ?'),
    options: [
      { id: 'a', text: '220 Ω' },
      { id: 'b', text: '10 Ω' },
    ],
    multiple: false,
    correct: ['a'],
    points: 2,
  },
  {
    id: 'q2',
    type: 'choice',
    prompt: doc('Broches d’alimentation ?'),
    options: [
      { id: 'a', text: '5V' },
      { id: 'b', text: 'GND' },
      { id: 'c', text: 'D13' },
    ],
    multiple: true,
    correct: ['a', 'b'],
    points: 2,
  },
  { id: 'c1', type: 'circuit', prompt: doc('Câblez la LED sur D13.'), points: 6, solution: { nets: NETS }, requireNoFaults: false },
];

describe('Devoirs et copies', () => {
  let t: TestApp;
  let teacher: Session;
  let classroom: { id: string; name: string; color: string };
  let students: Session[];

  beforeAll(async () => {
    t = await createApp();
    teacher = await registerSchool(t);
    ({ classroom, students } = await setupClass(t, teacher, 3));
  });
  afterAll(() => t.close());

  const create = (body: Record<string, unknown>) => teacher.post(`/classrooms/${classroom.id}/assignments`, { kind: 'exercise', title: 'Devoir', ...body });

  it('valide les documents riches et les items', async () => {
    const bad = [
      { instructions: { type: 'doc', content: [{ type: 'script', text: 'x' }] } },
      { instructions: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] } },
      { instructions: { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://evil.example/x.png' } }] } },
      { instructions: { type: 'doc', content: [{ type: 'heading', attrs: { level: 5 }, content: [] }] } },
      { items: [{ id: 'x', type: 'video' }] },
      { items: [{ ...ITEMS[1], correct: ['zz'] }] },
      { items: [ITEMS[1], ITEMS[1]] },
      { items: [{ ...ITEMS[1], correct: ['a', 'b'] }] },
      { kind: 'quiz' },
    ];
    for (const body of bad) {
      const r = await create(body);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('VALIDATION');
    }
    const big = await create({ instructions: doc('x'.repeat(210 * 1024)) });
    expect(big.body.code).toBe('PAYLOAD_TOO_LARGE');
    const ok = await create({
      instructions: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Titre', marks: [{ type: 'bold' }] }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'lien', marks: [{ type: 'link', attrs: { href: 'https://jollof.example' } }] }] },
          { type: 'image', attrs: { src: '/api/v1/files/0b7c1c0e-5f2a-4c1e-9a43-3f7f6f1f2a10/abcdefghijklmnopqrstuv' } },
          { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph' }] }] },
        ],
      },
    });
    expect(ok.status).toBe(201);
  });

  it('cycle complet : brouillon invisible, publication, vue élève expurgée, correction automatique', async () => {
    const a = await create({ title: 'Allumer une LED', items: ITEMS, instructions: doc('Consigne') }).expect(201);
    expect(a.body).toMatchObject({
      status: 'draft',
      totalPoints: 10,
      classroomName: classroom.name,
      classroomColor: classroom.color,
      settings: { maxAttempts: 1, showResults: 'immediately', timeLimitMinutes: null, allowLate: false, faultPenalty: 10 },
      audience: { all: true },
      stats: { targeted: 3, started: 0, submitted: 0, graded: 0 },
    });
    const id = a.body.id;
    // Brouillon : invisible pour les élèves.
    expect((await students[0].get(`/assignments/${id}`)).status).toBe(404);
    expect((await students[0].get(`/classrooms/${classroom.id}/assignments`)).body).toEqual([]);
    expect((await students[0].post(`/assignments/${id}/start`)).status).toBe(404);

    const pub = await teacher.post(`/assignments/${id}/publish`, {}).expect(200);
    expect(pub.body.status).toBe('published');
    expect(pub.body.publishedAt).toBeTruthy();
    const notes = await students[0].get('/notifications').expect(200);
    expect(notes.body[0]).toMatchObject({ type: 'assignment_published', readAt: null, data: { assignmentId: id, assignmentTitle: 'Allumer une LED', classroomName: classroom.name } });

    const view = await students[0].get(`/assignments/${id}`).expect(200);
    expect(view.body.classroomName).toBe(classroom.name);
    expect(view.body.mySubmission).toBeNull();
    expect(view.body.stats).toBeUndefined();
    const json = JSON.stringify(view.body.items);
    expect(json).not.toContain('"correct"');
    expect(json).not.toContain('"solution"');
    expect(view.body.items.find((i: { id: string }) => i.id === 'q1').options).toHaveLength(2);

    const start = await students[0].post(`/assignments/${id}/start`).expect(200);
    expect(start.body).toMatchObject({ status: 'in_progress', attempt: 1, answers: {}, itemScores: {}, score: null, maxScore: 10, deadlineAt: null, studentName: students[0].user.displayName });
    const again = await students[0].post(`/assignments/${id}/start`).expect(200);
    expect(again.body.id).toBe(start.body.id);
    const sid = start.body.id;

    // Sauvegardes : fusion par item ; réponses contrôlées.
    await students[0].put(`/submissions/${sid}`, { answers: { q1: { selected: ['b'] } } }).expect(200);
    const saved = await students[0].put(`/submissions/${sid}`, { answers: { q2: { selected: ['b', 'a'] } }, project: { version: 1, parts: [] } }).expect(200);
    expect(saved.body.answers).toEqual({ q1: { selected: ['b'] }, q2: { selected: ['b', 'a'] } });
    expect((await students[0].put(`/submissions/${sid}`, { answers: { zz: { selected: [] } } })).body.code).toBe('VALIDATION');
    expect((await students[0].put(`/submissions/${sid}`, { answers: { q1: { selected: ['a', 'b'] } } })).body.code).toBe('VALIDATION');
    expect((await students[1].put(`/submissions/${sid}`, { answers: {} })).status).toBe(404);
    expect((await teacher.put(`/submissions/${sid}`, { answers: {} })).status).toBe(403);

    // Envoi : q1 corrigée en a (2 pts), q2 juste (2 pts), circuit : 2 liaisons fondues + 1 erreur de câblage.
    const sub = await students[0]
      .post(`/submissions/${sid}/submit`, {
        answers: { q1: { selected: ['a'] } },
        circuit: { nets: [['LED1.A', 'R1.2', 'BTN1.1'], ['R1.1', 'UNO.D13', 'LED1.K', 'UNO.GND']], faults: 1 },
      })
      .expect(200);
    expect(sub.body.status).toBe('graded');
    expect(sub.body.itemScores.q1).toEqual({ points: 2, max: 2, auto: true, comment: null });
    expect(sub.body.itemScores.q2.points).toBe(2);
    // 6 × 1/3 = 2, − 10 % × 6 × 1 = 1,4 → arrondi 1,5.
    expect(sub.body.itemScores.c1).toMatchObject({
      points: 1.5,
      max: 6,
      auto: true,
      detail: { ok: 1, total: 3, missing: [NETS[1], NETS[2]], extra: ['BTN1.1'] },
    });
    expect(sub.body.score).toBe(5.5);
    expect(sub.body.submittedAt).toBeTruthy();
    expect(sub.body.late).toBe(false);

    expect((await students[0].put(`/submissions/${sid}`, { answers: {} })).body.code).toBe('SUBMISSION_LOCKED');
    expect((await students[0].post(`/submissions/${sid}/submit`, {})).body.code).toBe('SUBMISSION_LOCKED');
    expect((await students[0].post(`/assignments/${id}/start`)).body.code).toBe('ATTEMPTS_EXHAUSTED');

    // Résultat visible tout de suite (exercice) ; `correct` seulement après remise.
    const mine = await students[0].get(`/assignments/${id}`).expect(200);
    expect(mine.body.mySubmission).toMatchObject({ id: sid, status: 'graded', score: 5.5, maxScore: 10, attempt: 1, late: false });
    expect(JSON.stringify(mine.body.items)).not.toContain('"correct"');

    const teacherNotes = await teacher.get('/notifications?unread=true').expect(200);
    expect(teacherNotes.body[0]).toMatchObject({ type: 'submission_received', data: { submissionId: sid, studentName: students[0].user.displayName } });

    const rows = await teacher.get(`/assignments/${id}/submissions`).expect(200);
    expect(rows.body).toHaveLength(3);
    const done = rows.body.find((r: { studentId: string }) => r.studentId === students[0].user.id);
    expect(done).toMatchObject({ id: sid, status: 'graded', score: 5.5 });
    expect(rows.body.filter((r: { status: string }) => r.status === 'not_started')).toHaveLength(2);
    expect((await students[0].get(`/assignments/${id}/submissions`)).status).toBe(403);
    const stats = (await teacher.get(`/assignments/${id}`)).body.stats;
    expect(stats).toEqual({ targeted: 3, started: 1, submitted: 1, graded: 1 });

    // Remise : `correct` alors rendu à l'élève.
    const returned = await teacher.post(`/submissions/${sid}/grade`, { return: true }).expect(200);
    expect(returned.body.status).toBe('returned');
    const after = await students[0].get(`/assignments/${id}`).expect(200);
    expect(after.body.items.find((i: { id: string }) => i.id === 'q1').correct).toEqual(['a']);
    expect(JSON.stringify(after.body.items)).not.toContain('"solution"');
    expect((await students[0].get('/notifications')).body[0].type).toBe('submission_returned');
    // Les autres élèves ne voient toujours pas la réponse.
    expect(JSON.stringify((await students[1].get(`/assignments/${id}`)).body.items)).not.toContain('"correct"');
  });

  it('requireNoFaults : 0 point dès une erreur de câblage', async () => {
    const a = await create({ items: [{ ...ITEMS[3], requireNoFaults: true }] }).expect(201);
    await teacher.post(`/assignments/${a.body.id}/publish`).expect(200);
    const s = await students[1].post(`/assignments/${a.body.id}/start`).expect(200);
    const r = await students[1].post(`/submissions/${s.body.id}/submit`, { circuit: { nets: NETS, faults: 1 } }).expect(200);
    expect(r.body.itemScores.c1.points).toBe(0);
    expect(r.body.itemScores.c1.detail.ok).toBe(3);
    const s2 = await students[2].post(`/assignments/${a.body.id}/start`).expect(200);
    const r2 = await students[2].post(`/submissions/${s2.body.id}/submit`, { circuit: { nets: NETS, faults: 0 } }).expect(200);
    expect(r2.body.score).toBe(6);
  });

  it('évaluation avec question ouverte : correction enseignant, visibilité selon showResults', async () => {
    const items = [ITEMS[1], { id: 'o1', type: 'open', prompt: doc('Expliquez.'), points: 4, rubric: doc('Mentionner la loi d’Ohm') }];
    const a = await create({ kind: 'evaluation', title: 'Évaluation', items }).expect(201);
    expect(a.body.settings.showResults).toBe('after_return');
    await teacher.post(`/assignments/${a.body.id}/publish`).expect(200);
    const view = await students[0].get(`/assignments/${a.body.id}`).expect(200);
    expect(JSON.stringify(view.body.items)).not.toContain('rubric');

    const s = await students[0].post(`/assignments/${a.body.id}/start`).expect(200);
    const sent = await students[0].post(`/submissions/${s.body.id}/submit`, { answers: { q1: { selected: ['a'] }, o1: { doc: doc('U = R × I') } } }).expect(200);
    expect(sent.body).toMatchObject({ status: 'submitted', score: null, itemScores: {}, feedback: null });

    const full = await teacher.get(`/submissions/${s.body.id}`).expect(200);
    expect(full.body.itemScores).toEqual({ q1: { points: 2, max: 2, auto: true, comment: null }, o1: { points: null, max: 4, auto: false, comment: null } });
    expect(full.body.score).toBeNull();

    expect((await teacher.post(`/submissions/${s.body.id}/grade`, { itemScores: { o1: { points: 5 } } })).body.code).toBe('VALIDATION');
    expect((await teacher.post(`/submissions/${s.body.id}/grade`, { itemScores: { zz: { points: 1 } } })).body.code).toBe('VALIDATION');
    expect((await teacher.post(`/submissions/${s.body.id}/grade`, { return: true })).body.code).toBe('VALIDATION');
    expect((await students[0].post(`/submissions/${s.body.id}/grade`, { itemScores: { o1: { points: 1 } } })).status).toBe(403);

    const graded = await teacher
      .post(`/submissions/${s.body.id}/grade`, { itemScores: { o1: { points: 3.5, comment: 'Bien' } }, feedback: doc('Bon travail') })
      .expect(200);
    expect(graded.body).toMatchObject({ status: 'graded', score: 5.5 });
    expect(graded.body.itemScores.o1).toEqual({ points: 3.5, max: 4, auto: false, comment: 'Bien' });
    // after_return : rien de visible avant la remise.
    const hidden = await students[0].get(`/submissions/${s.body.id}`).expect(200);
    expect(hidden.body).toMatchObject({ status: 'graded', score: null, itemScores: {}, feedback: null });
    expect((await students[0].get('/notifications')).body.some((n: { type: string }) => n.type === 'submission_graded')).toBe(false);

    await teacher.post(`/submissions/${s.body.id}/grade`, { return: true }).expect(200);
    const visible = await students[0].get(`/submissions/${s.body.id}`).expect(200);
    expect(visible.body).toMatchObject({ status: 'returned', score: 5.5, feedback: doc('Bon travail') });
    expect(visible.body.itemScores.o1.comment).toBe('Bien');
    expect((await students[1].get(`/submissions/${s.body.id}`)).status).toBe(404);

    // showResults = never : copie rendue mais résultats et réponses cachés.
    const n = await create({ kind: 'evaluation', items: [ITEMS[1]], settings: { showResults: 'never' } }).expect(201);
    await teacher.post(`/assignments/${n.body.id}/publish`).expect(200);
    const ns = await students[1].post(`/assignments/${n.body.id}/start`).expect(200);
    await students[1].post(`/submissions/${ns.body.id}/submit`, { answers: { q1: { selected: ['a'] } } }).expect(200);
    await teacher.post(`/submissions/${ns.body.id}/grade`, { return: true }).expect(200);
    const never = await students[1].get(`/submissions/${ns.body.id}`).expect(200);
    expect(never.body).toMatchObject({ status: 'returned', score: null, itemScores: {} });
    expect(JSON.stringify((await students[1].get(`/assignments/${n.body.id}`)).body.items)).not.toContain('"correct"');
  });

  it('public visé, tentatives multiples, échéance et retard', async () => {
    const only = await create({ items: [ITEMS[1]], audience: { all: false, userIds: [students[0].user.id] }, settings: { maxAttempts: 2 } }).expect(201);
    expect((await create({ audience: { all: false, userIds: [teacher.user.id] } })).body.code).toBe('NOT_IN_CLASS');
    await teacher.post(`/assignments/${only.body.id}/publish`).expect(200);
    expect((await students[1].get(`/assignments/${only.body.id}`)).status).toBe(404);
    expect((await students[1].post(`/assignments/${only.body.id}/start`)).status).toBe(404);
    expect((await students[0].get(`/assignments/${only.body.id}`).expect(200)).body.audience).toEqual({ all: false, userIds: [students[0].user.id] });
    expect((await teacher.get(`/assignments/${only.body.id}/submissions`)).body).toHaveLength(1);

    const s1 = await students[0].post(`/assignments/${only.body.id}/start`).expect(200);
    await students[0].post(`/submissions/${s1.body.id}/submit`, { answers: { q1: { selected: ['b'] } } }).expect(200);
    const s2 = await students[0].post(`/assignments/${only.body.id}/start`).expect(200);
    expect(s2.body.attempt).toBe(2);
    await students[0].post(`/submissions/${s2.body.id}/submit`, { answers: { q1: { selected: ['a'] } } }).expect(200);
    expect((await students[0].post(`/assignments/${only.body.id}/start`)).body.code).toBe('ATTEMPTS_EXHAUSTED');
    const all = await students[0].get(`/assignments/${only.body.id}/my-submissions`).expect(200);
    expect(all.body.map((s: { attempt: number; score: number }) => [s.attempt, s.score])).toEqual([
      [1, 0],
      [2, 2],
    ]);

    // Échéance passée : refusé, sauf retard permis (copie marquée « late »).
    const past = new Date(Date.now() - 3600_000).toISOString();
    const due = await create({ items: [ITEMS[1]], dueAt: past }).expect(201);
    await teacher.post(`/assignments/${due.body.id}/publish`).expect(200);
    expect((await students[0].post(`/assignments/${due.body.id}/start`)).body.code).toBe('PAST_DUE');
    await teacher.patch(`/assignments/${due.body.id}`, { settings: { allowLate: true } }).expect(200);
    const late = await students[0].post(`/assignments/${due.body.id}/start`).expect(200);
    expect(late.body.late).toBe(true);
    const sent = await students[0].post(`/submissions/${late.body.id}/submit`, {}).expect(200);
    expect(sent.body.late).toBe(true);
  });

  it('listes légères : sans montage de départ (hasStarterProject) ni anciens projets d’élève', async () => {
    const starter = { app: 'jollof-studio', version: 1, comps: [{ id: 'uno_1', type: 'uno' }], wires: [], pad: 'x'.repeat(50_000) };
    const a = await create({ title: 'Avec montage', items: [ITEMS[1]], starterProject: starter, settings: { maxAttempts: 0 } }).expect(201);
    expect(a.body).toMatchObject({ starterProject: starter, hasStarterProject: true });
    const bare = await create({ title: 'Sans montage', items: [ITEMS[1]] }).expect(201);
    expect(bare.body).toMatchObject({ starterProject: null, hasStarterProject: false });
    await teacher.post(`/assignments/${a.body.id}/publish`).expect(200);
    await teacher.post(`/assignments/${bare.body.id}/publish`).expect(200);

    const lists = [
      (await teacher.get(`/classrooms/${classroom.id}/assignments`).expect(200)).body,
      (await teacher.get('/me/assignments').expect(200)).body,
      (await students[1].get(`/classrooms/${classroom.id}/assignments`).expect(200)).body,
      (await students[1].get('/me/assignments').expect(200)).body,
    ];
    for (const list of lists) {
      const row = list.find((x: { id: string }) => x.id === a.body.id);
      expect(row).toMatchObject({ starterProject: null, hasStarterProject: true, items: expect.any(Array), title: 'Avec montage' });
      expect(list.find((x: { id: string }) => x.id === bare.body.id)).toMatchObject({ starterProject: null, hasStarterProject: false });
      expect(JSON.stringify(list)).not.toContain(starter.pad);
    }
    // Le détail donne le montage.
    expect((await students[1].get(`/assignments/${a.body.id}`).expect(200)).body).toMatchObject({ starterProject: starter, hasStarterProject: true });

    // Tentatives : le projet de la dernière seulement (le client « revoit » la dernière), le détail les donne toutes.
    const first = await students[1].post(`/assignments/${a.body.id}/start`).expect(200);
    await students[1].post(`/submissions/${first.body.id}/submit`, { answers: { q1: { selected: ['b'] } }, project: { v: 1 } }).expect(200);
    const second = await students[1].post(`/assignments/${a.body.id}/start`).expect(200);
    const saved = await students[1].put(`/submissions/${second.body.id}`, { project: { v: 2 } }).expect(200);
    expect(saved.body).toMatchObject({ project: { v: 2 }, answers: {} });
    // Sauvegarde partielle : les réponses s'ajoutent, le projet reste.
    const merged = await students[1].put(`/submissions/${second.body.id}`, { answers: { q1: { selected: ['a'] } } }).expect(200);
    expect(merged.body).toMatchObject({ project: { v: 2 }, answers: { q1: { selected: ['a'] } } });
    const mine = (await students[1].get(`/assignments/${a.body.id}/my-submissions`).expect(200)).body;
    expect(mine.map((x: { attempt: number; project: unknown }) => [x.attempt, x.project])).toEqual([
      [1, null],
      [2, { v: 2 }],
    ]);
    expect((await students[1].get(`/submissions/${first.body.id}`).expect(200)).body.project).toEqual({ v: 1 });
    // Envoi, correction et clôture passent par des mises à jour ciblées : rien n'est perdu.
    const sent = await students[1].post(`/submissions/${second.body.id}/submit`, {}).expect(200);
    expect(sent.body).toMatchObject({ status: 'graded', score: 2, project: { v: 2 }, answers: { q1: { selected: ['a'] } } });
    const graded = await teacher.post(`/submissions/${second.body.id}/grade`, { itemScores: { q1: { points: 1, comment: 'Presque' } }, return: true }).expect(200);
    expect(graded.body).toMatchObject({ status: 'returned', score: 1, project: { v: 2 } });
    const third = await students[1].post(`/assignments/${a.body.id}/start`).expect(200);
    await students[1].put(`/submissions/${third.body.id}`, { answers: { q1: { selected: ['a'] } }, project: { v: 3 } }).expect(200);
    await teacher.post(`/assignments/${a.body.id}/close`).expect(200);
    expect((await students[1].get(`/submissions/${third.body.id}`).expect(200)).body).toMatchObject({ status: 'graded', score: 2, project: { v: 3 } });
  });

  it('temps limité : une sauvegarde après l’échéance envoie la copie et répond TIME_UP', async () => {
    const a = await create({ items: [ITEMS[1]], settings: { timeLimitMinutes: 30 } }).expect(201);
    await teacher.post(`/assignments/${a.body.id}/publish`).expect(200);
    const s = await students[2].post(`/assignments/${a.body.id}/start`).expect(200);
    const span = new Date(s.body.deadlineAt).getTime() - new Date(s.body.startedAt).getTime();
    expect(span).toBe(30 * 60_000);
    await students[2].put(`/submissions/${s.body.id}`, { answers: { q1: { selected: ['a'] } } }).expect(200);
    // On avance l'horloge de la copie : échéance dépassée.
    await t.db.query(`UPDATE submissions SET deadline_at = now() - interval '1 minute' WHERE id = $1`, [s.body.id]);
    const late = await students[2].put(`/submissions/${s.body.id}`, { answers: { q1: { selected: ['b'] } } });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('TIME_UP');
    const sent = await students[2].get(`/submissions/${s.body.id}`).expect(200);
    expect(sent.body).toMatchObject({ status: 'graded', answers: { q1: { selected: ['a'] } }, score: 2 });

    // Copie minutée abandonnée : envoyée d'office quand l'enseignant consulte.
    const s2 = await students[1].post(`/assignments/${a.body.id}/start`).expect(200);
    await t.db.query(`UPDATE submissions SET deadline_at = now() - interval '1 minute' WHERE id = $1`, [s2.body.id]);
    const rows = await teacher.get(`/assignments/${a.body.id}/submissions`).expect(200);
    expect(rows.body.find((r: { id: string }) => r.id === s2.body.id).status).toBe('graded');
  });

  it('clôture, duplication, suppression', async () => {
    const a = await create({ items: [ITEMS[1]], settings: { maxAttempts: 0 } }).expect(201);
    expect((await teacher.post(`/assignments/${a.body.id}/close`)).body.code).toBe('VALIDATION');
    await teacher.post(`/assignments/${a.body.id}/publish`).expect(200);
    const s = await students[0].post(`/assignments/${a.body.id}/start`).expect(200);
    await students[0].put(`/submissions/${s.body.id}`, { answers: { q1: { selected: ['a'] } } }).expect(200);
    const closed = await teacher.post(`/assignments/${a.body.id}/close`).expect(200);
    expect(closed.body.status).toBe('closed');
    expect((await students[0].get(`/submissions/${s.body.id}`)).body).toMatchObject({ status: 'graded', score: 2 });
    expect((await students[1].post(`/assignments/${a.body.id}/start`)).body.code).toBe('ASSIGNMENT_CLOSED');
    // Un devoir clos reste visible.
    await students[1].get(`/assignments/${a.body.id}`).expect(200);

    const other = await teacher.post('/classrooms', { name: 'Autre classe' }).expect(201);
    const dup = await teacher.post(`/assignments/${a.body.id}/duplicate`, { classroomId: other.body.id }).expect(201);
    expect(dup.body).toMatchObject({ status: 'draft', classroomId: other.body.id, classroomName: 'Autre classe', publishedAt: null, dueAt: null, items: closed.body.items });
    expect((await students[0].post(`/assignments/${a.body.id}/duplicate`, {})).status).toBe(403);
    expect((await teacher.patch(`/assignments/${dup.body.id}`, { title: 'Copie' }).expect(200)).body.title).toBe('Copie');

    expect((await students[0].del(`/assignments/${a.body.id}`)).status).toBe(403);
    await teacher.del(`/assignments/${a.body.id}`).expect(204);
    expect((await teacher.get(`/assignments/${a.body.id}`)).status).toBe(404);
    expect((await teacher.get(`/submissions/${s.body.id}`)).status).toBe(404);
  });

  it('carnet de notes et tableau de bord', async () => {
    const { classroom: c, students: st } = await setupClass(t, teacher, 2);
    const a1 = await teacher.post(`/classrooms/${c.id}/assignments`, { kind: 'exercise', title: 'E1', items: [ITEMS[1]] }).expect(201);
    const a2 = await teacher.post(`/classrooms/${c.id}/assignments`, { kind: 'evaluation', title: 'E2', items: [ITEMS[1]], dueAt: new Date(Date.now() + 86400_000).toISOString() }).expect(201);
    await teacher.post(`/classrooms/${c.id}/assignments`, { kind: 'exercise', title: 'Brouillon' }).expect(201);
    await teacher.post(`/assignments/${a1.body.id}/publish`).expect(200);
    await teacher.post(`/assignments/${a2.body.id}/publish`).expect(200);
    const s = await st[0].post(`/assignments/${a1.body.id}/start`).expect(200);
    await st[0].post(`/submissions/${s.body.id}/submit`, { answers: { q1: { selected: ['a'] } } }).expect(200);
    const e = await st[0].post(`/assignments/${a2.body.id}/start`).expect(200);
    await st[0].post(`/submissions/${e.body.id}/submit`, { answers: { q1: { selected: ['a'] } } }).expect(200);

    const g = await teacher.get(`/classrooms/${c.id}/grades`).expect(200);
    expect(g.body.assignments.map((a: { title: string }) => a.title)).toEqual(['E1', 'E2']);
    expect(g.body.assignments[0]).toEqual({ id: a1.body.id, title: 'E1', kind: 'exercise', totalPoints: 2, dueAt: null });
    expect(g.body.students.map((x: { id: string }) => x.id).sort()).toEqual(st.map((x) => x.user.id).sort());
    expect(g.body.cells[st[0].user.id][a1.body.id]).toMatchObject({ id: s.body.id, status: 'graded', score: 2, maxScore: 2, attempt: 1, late: false });
    expect(g.body.cells[st[0].user.id][a2.body.id]).toMatchObject({ status: 'graded', score: 2 });
    expect(g.body.cells[st[1].user.id][a1.body.id]).toEqual({ status: 'not_started' });

    const mine = await st[0].get(`/classrooms/${c.id}/grades`).expect(200);
    expect(mine.body.students).toEqual([{ id: st[0].user.id, displayName: st[0].user.displayName }]);
    expect(Object.keys(mine.body.cells)).toEqual([st[0].user.id]);
    // Évaluation non rendue : note masquée à l'élève.
    expect(mine.body.cells[st[0].user.id][a2.body.id]).toMatchObject({ status: 'graded', score: null });
    expect(mine.body.cells[st[0].user.id][a1.body.id].score).toBe(2);

    const dash = await st[0].get('/me/assignments').expect(200);
    expect(dash.body.map((a: { title: string }) => a.title)).toEqual(['E2', 'E1']);
    expect(dash.body[0]).toMatchObject({ classroomName: c.name, classroomColor: c.color, mySubmission: { status: 'graded', score: null } });

    const tdash = await teacher.get('/me/assignments').expect(200);
    expect(tdash.body.every((a: { stats?: object; classroomName: string }) => a.stats && a.classroomName)).toBe(true);
    const list = await teacher.get(`/classrooms/${c.id}/assignments`).expect(200);
    expect(list.body).toHaveLength(3);
    expect(list.body.every((a: { classroomColor: string }) => a.classroomColor === c.color)).toBe(true);
  });

  it('forfait échu : écriture refusée, lecture permise', async () => {
    const a = await create({ items: [ITEMS[1]] }).expect(201);
    await teacher.post(`/assignments/${a.body.id}/publish`).expect(200);
    const s = await students[1].post(`/assignments/${a.body.id}/start`).expect(200);
    await students[1].post(`/submissions/${s.body.id}/submit`, {}).expect(200);
    await anon(t).post(`/platform/schools/${teacher.school.id}/plan`, { plan: 'expired' }).set('X-Platform-Key', 'e2e-platform-key').expect(200);
    expect((await create({})).body.code).toBe('PLAN_REQUIRED');
    expect((await teacher.patch(`/assignments/${a.body.id}`, { title: 'x' })).body.code).toBe('PLAN_REQUIRED');
    expect((await teacher.post(`/submissions/${s.body.id}/grade`, { return: true })).body.code).toBe('PLAN_REQUIRED');
    await teacher.get(`/assignments/${a.body.id}/submissions`).expect(200);
    await teacher.get(`/classrooms/${classroom.id}/grades`).expect(200);
    // Les élèves continuent de travailler.
    const b = await students[2].post(`/assignments/${a.body.id}/start`).expect(200);
    await students[2].post(`/submissions/${b.body.id}/submit`, {}).expect(200);
    await anon(t).post(`/platform/schools/${teacher.school.id}/plan`, { plan: 'pro' }).set('X-Platform-Key', 'e2e-platform-key').expect(200);
  });
});
