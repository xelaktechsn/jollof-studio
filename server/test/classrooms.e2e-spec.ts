// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { anon, createApp, login, registerSchool, Session, setupClass, TestApp, uid } from './helpers';

describe('Classes, comptes élèves et isolation des écoles', () => {
  let t: TestApp;
  let admin: Session;
  let other: Session;

  beforeAll(async () => {
    t = await createApp();
    admin = await registerSchool(t, 'Collège A');
    other = await registerSchool(t, 'Collège B');
  });
  afterAll(() => t.close());

  it('crée une classe (et sa conversation) avec les réglages par défaut', async () => {
    const res = await admin.post('/classrooms', { name: '4e B', subject: 'Technologie', level: '4e' }).expect(201);
    expect(res.body).toMatchObject({
      name: '4e B',
      subject: 'Technologie',
      level: '4e',
      archived: false,
      myRole: 'teacher',
      studentCount: 0,
      settings: { allowStudentGroups: true, maxGroupSize: 6, allowStudentDirectMessages: false },
      teachers: [{ id: admin.user.id, displayName: admin.user.displayName }],
    });
    expect(res.body.color).toMatch(/^#[0-9a-f]{6}$/i);
    const convs = await admin.get('/conversations').expect(200);
    expect(convs.body).toEqual([expect.objectContaining({ kind: 'class', classroomId: res.body.id, title: '4e B' })]);
    expect((await admin.post('/classrooms', { name: '' })).body.code).toBe('VALIDATION');
  });

  it('crée des comptes élèves : prenom.nom sans accents, suffixe si pris, mot de passe provisoire', async () => {
    const c = await admin.post('/classrooms', { name: '3e A' }).expect(201);
    const res = await admin
      .post(`/classrooms/${c.body.id}/students`, {
        students: [
          { displayName: 'Aïssatou Diallo' },
          { displayName: 'Aïssatou  Diallo' },
          { displayName: 'Jean-Pierre Mendy' },
          { displayName: 'Zoé', username: 'Zoe.Perso' },
          { displayName: 'Maïmouna Bâ Ndiaye' },
        ],
      })
      .expect(201);
    expect(res.body.map((r: { user: { username: string } }) => r.user.username)).toEqual([
      'aissatou.diallo',
      'aissatou.diallo2',
      'jean-pierre.mendy',
      'zoe.perso',
      'maimouna.ndiaye',
    ]);
    for (const r of res.body) {
      expect(r.temporaryPassword).toMatch(/^[a-z]+-[a-z]+-\d{3}$/);
      expect(r.user).toMatchObject({ role: 'student', mustChangePassword: false, email: null });
      expect(r.user.passwordHash).toBeUndefined();
    }
    // Lot suivant : le suffixe continue.
    const more = await admin.post(`/classrooms/${c.body.id}/students`, { students: [{ displayName: 'Aissatou DIALLO' }], requirePasswordChange: true }).expect(201);
    expect(more.body[0].user).toMatchObject({ username: 'aissatou.diallo3', mustChangePassword: true });
    const s = await login(t, 'aissatou.diallo3', more.body[0].temporaryPassword);
    expect(s.user.mustChangePassword).toBe(true);

    const taken = await admin.post(`/classrooms/${c.body.id}/students`, { students: [{ displayName: 'X', username: 'zoe.perso' }] });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('USERNAME_TAKEN');
    expect((await admin.post(`/classrooms/${c.body.id}/students`, { students: [] })).body.code).toBe('VALIDATION');
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ displayName: `E ${i}` }));
    expect((await admin.post(`/classrooms/${c.body.id}/students`, { students: tooMany })).body.code).toBe('VALIDATION');
    expect((await admin.get(`/classrooms/${c.body.id}`)).body.studentCount).toBe(6);
  });

  it('membres : noms d’utilisateur réservés aux enseignants, rôles, élèves et classes', async () => {
    const { classroom, students } = await setupClass(t, admin, 3);
    const asTeacher = await admin.get(`/classrooms/${classroom.id}`).expect(200);
    expect(asTeacher.body.members).toHaveLength(4);
    expect(asTeacher.body.members[0]).toMatchObject({ userId: admin.user.id, role: 'teacher', online: false });
    expect(asTeacher.body.members.every((m: { username: string | null }) => typeof m.username === 'string')).toBe(true);

    const asStudent = await students[0].get(`/classrooms/${classroom.id}`).expect(200);
    expect(asStudent.body.myRole).toBe('student');
    for (const m of asStudent.body.members) {
      expect(m.username).toBe(m.userId === students[0].user.id ? students[0].user.username : null);
    }
    const mine = await students[0].get('/classrooms').expect(200);
    expect(mine.body.map((c: { id: string }) => c.id)).toEqual([classroom.id]);

    // Un élève ne gère pas la classe.
    expect((await students[0].patch(`/classrooms/${classroom.id}`, { name: 'Pirate' })).body.code).toBe('FORBIDDEN');
    expect((await students[0].post('/classrooms', { name: 'X' })).status).toBe(403);
    expect((await students[0].post(`/classrooms/${classroom.id}/students`, { students: [{ displayName: 'X' }] })).status).toBe(403);
  });

  it('PATCH : réglages fusionnés, archivage', async () => {
    const c = await admin.post('/classrooms', { name: 'Archivable', settings: { maxGroupSize: 4 } }).expect(201);
    expect(c.body.settings).toEqual({ allowStudentGroups: true, maxGroupSize: 4, allowStudentDirectMessages: false });
    const p = await admin.patch(`/classrooms/${c.body.id}`, { settings: { allowStudentDirectMessages: true }, subject: null }).expect(200);
    expect(p.body.settings).toEqual({ allowStudentGroups: true, maxGroupSize: 4, allowStudentDirectMessages: true });
    expect(p.body.subject).toBeNull();
    expect((await admin.patch(`/classrooms/${c.body.id}`, { settings: { maxGroupSize: 1 } })).body.code).toBe('VALIDATION');
    await admin.patch(`/classrooms/${c.body.id}`, { archived: true }).expect(200);
    expect((await admin.get('/classrooms')).body.some((x: { id: string }) => x.id === c.body.id)).toBe(false);
    const archived = await admin.get('/classrooms?archived=true').expect(200);
    expect(archived.body.map((x: { id: string }) => x.id)).toEqual([c.body.id]);
  });

  it('ajout et retrait de membres ; la classe garde au moins un enseignant', async () => {
    const { classroom, students } = await setupClass(t, admin, 2);
    const t2 = await admin.post('/school/teachers', { displayName: 'Prof Deux', email: `p2-${uid()}@test.dev` }).expect(201);
    const teacher2 = await login(t, t2.body.user.email, t2.body.temporaryPassword);
    expect((await teacher2.get(`/classrooms/${classroom.id}`)).status).toBe(403);

    const roster = await admin.post(`/classrooms/${classroom.id}/members`, { userIds: [t2.body.user.id] }).expect(200);
    expect(roster.body.find((m: { userId: string }) => m.userId === t2.body.user.id)).toMatchObject({ role: 'teacher' });
    expect((await teacher2.get(`/classrooms/${classroom.id}`).expect(200)).body.myRole).toBe('teacher');

    // Retrait d'un élève : le compte reste.
    await teacher2.del(`/classrooms/${classroom.id}/members/${students[0].user.id}`).expect(204);
    expect((await students[0].get(`/classrooms/${classroom.id}`)).status).toBe(403);
    await students[0].get('/me').expect(200);
    expect((await admin.del(`/classrooms/${classroom.id}/members/${students[0].user.id}`)).body.code).toBe('NOT_FOUND');
    // Réinscription par ajout de membre.
    await admin.post(`/classrooms/${classroom.id}/members`, { userIds: [students[0].user.id] }).expect(200);
    await students[0].get(`/classrooms/${classroom.id}`).expect(200);

    await admin.del(`/classrooms/${classroom.id}/members/${admin.user.id}`).expect(204);
    const last = await teacher2.del(`/classrooms/${classroom.id}/members/${t2.body.user.id}`);
    expect(last.status).toBe(403);
    expect(last.body.code).toBe('FORBIDDEN');
  });

  it('réinitialisation de mot de passe et désactivation selon le rôle', async () => {
    const { classroom, students } = await setupClass(t, admin, 2);
    const t2 = await admin.post('/school/teachers', { displayName: 'Prof Trois', email: `p3-${uid()}@test.dev` }).expect(201);
    const teacher2 = await login(t, t2.body.user.email, t2.body.temporaryPassword);
    // Enseignant hors de la classe : interdit ; une fois inscrit : permis.
    expect((await teacher2.post(`/users/${students[0].user.id}/reset-password`)).status).toBe(403);
    await admin.post(`/classrooms/${classroom.id}/members`, { userIds: [t2.body.user.id] }).expect(200);
    const reset = await teacher2.post(`/users/${students[0].user.id}/reset-password`).expect(200);
    expect(reset.body.temporaryPassword).toMatch(/^[a-z]+-[a-z]+-\d{3}$/);
    const s = await login(t, students[0].user.username, reset.body.temporaryPassword);
    expect(s.user.mustChangePassword).toBe(true);
    // L'ancienne session ne se rafraîchit plus.
    expect((await anon(t).post('/auth/refresh', { refreshToken: students[0].refreshToken })).status).toBe(401);
    // Un enseignant ne gère pas un autre enseignant ; l'administrateur si.
    expect((await teacher2.post(`/users/${admin.user.id}/reset-password`)).status).toBe(403);
    await admin.post(`/users/${t2.body.user.id}/reset-password`).expect(200);
    expect((await students[1].post(`/users/${students[0].user.id}/reset-password`)).status).toBe(403);

    const renamed = await admin.patch(`/users/${students[1].user.id}`, { displayName: 'Fatou S.' }).expect(200);
    expect(renamed.body.displayName).toBe('Fatou S.');
  });

  it('isolation : une autre école ne voit rien (NOT_FOUND)', async () => {
    const { classroom, students } = await setupClass(t, admin, 1);
    const conv = (await admin.get('/conversations')).body.find((c: { classroomId: string }) => c.classroomId === classroom.id);
    const a = await admin.post(`/classrooms/${classroom.id}/assignments`, { kind: 'exercise', title: 'Secret' }).expect(201);
    const g = await admin.post(`/classrooms/${classroom.id}/groups`, { name: 'G', memberIds: [students[0].user.id] }).expect(201);
    const checks = await Promise.all([
      other.get(`/classrooms/${classroom.id}`),
      other.patch(`/classrooms/${classroom.id}`, { name: 'x' }),
      other.post(`/classrooms/${classroom.id}/members`, { userIds: [students[0].user.id] }),
      other.get(`/classrooms/${classroom.id}/grades`),
      other.get(`/assignments/${a.body.id}`),
      other.get(`/groups/${g.body.id}`),
      other.get(`/groups/${g.body.id}/projects`),
      other.get(`/conversations/${conv.id}/messages`),
      other.post(`/users/${students[0].user.id}/reset-password`),
      other.patch(`/users/${students[0].user.id}`, { disabled: true }),
      other.post('/conversations/direct', { userId: admin.user.id }),
    ]);
    for (const r of checks) {
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('NOT_FOUND');
    }
    // Inscrire dans sa classe un élève d'une autre école : impossible.
    const mine = await other.post('/classrooms', { name: 'B1' }).expect(201);
    expect((await other.post(`/classrooms/${mine.body.id}/members`, { userIds: [students[0].user.id] })).body.code).toBe('NOT_FOUND');
    expect((await other.get('/classrooms')).body.map((c: { id: string }) => c.id)).toEqual([mine.body.id]);
  });
});
