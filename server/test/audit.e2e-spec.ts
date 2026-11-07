// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { anon, createApp, login, registerSchool, Session, setupClass, TestApp, uid } from './helpers';

interface Entry {
  id: string;
  action: string;
  actor: { id: string; displayName: string } | null;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

describe('Journal d’audit (GET /school/audit)', () => {
  let t: TestApp;
  let admin: Session & { password: string };
  let other: Session;

  const audit = async (who: Session = admin, q = ''): Promise<Entry[]> => (await who.get(`/school/audit${q}`).expect(200)).body;

  beforeAll(async () => {
    t = await createApp();
    admin = await registerSchool(t, 'Collège Mariama Bâ');
    other = await registerSchool(t, 'Autre école');
  });
  afterAll(() => t.close());

  it('note création d’école et de comptes, réinitialisation, désactivation, archivage, devoirs, verrou repris, connexions', async () => {
    const teacherRes = await admin.post('/school/teachers', { displayName: 'Ndeye Fall', email: `nf-${uid()}@test.dev` }).expect(201);
    const { classroom, students } = await setupClass(t, admin, 3);
    await admin.post(`/users/${students[2].user.id}/reset-password`).expect(200);
    await admin.patch(`/users/${teacherRes.body.user.id}`, { disabled: true }).expect(200);
    await admin.patch(`/users/${teacherRes.body.user.id}`, { disabled: false }).expect(200);
    await admin.patch(`/users/${teacherRes.body.user.id}`, { displayName: 'Ndèye Fall' }).expect(200);

    const a = await admin.post(`/classrooms/${classroom.id}/assignments`, { kind: 'exercise', title: 'Loi d’Ohm' }).expect(201);
    await admin.post(`/assignments/${a.body.id}/publish`).expect(200);
    await admin.post(`/assignments/${a.body.id}/publish`).expect(200); // republier : pas de seconde ligne
    const b = await admin.post(`/classrooms/${classroom.id}/assignments`, { kind: 'evaluation', title: 'Brouillon' }).expect(201);
    await admin.del(`/assignments/${b.body.id}`).expect(204);

    const g = await students[1].post(`/classrooms/${classroom.id}/groups`, { name: 'Volta', memberIds: [students[0].user.id] }).expect(201);
    const p = await students[1].post(`/groups/${g.body.id}/projects`, { title: 'Feu tricolore' }).expect(201);
    await students[1].post(`/projects/${p.body.id}/lock`).expect(200);
    await students[0].post(`/projects/${p.body.id}/lock`, { force: true }).expect(200);

    await admin.patch(`/classrooms/${classroom.id}`, { archived: true }).expect(200);
    await admin.patch(`/classrooms/${classroom.id}`, { name: 'Renommée' }).expect(200); // sans changement d'archivage
    await login(t, admin.user.email, admin.password);
    await anon(t).post('/auth/login', { login: admin.user.email, password: 'mauvais-mot' }).expect(401);

    const list = await audit();
    const actions = list.map((e) => e.action);
    for (const action of [
      'school.created', 'user.created', 'user.password_reset', 'user.disabled', 'user.enabled',
      'assignment.published', 'assignment.deleted', 'project.lock_taken', 'classroom.archived', 'auth.login',
    ]) {
      expect(actions).toContain(action);
    }
    expect(actions.filter((x) => x === 'assignment.published')).toHaveLength(1);
    expect(actions.filter((x) => x === 'classroom.archived')).toHaveLength(1);
    // Récent d'abord.
    expect([...list].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map((e) => e.id)).toEqual(list.map((e) => e.id));

    const by = (action: string) => list.find((e) => e.action === action)!;
    expect(by('user.password_reset')).toMatchObject({ actor: { id: admin.user.id }, targetType: 'user', targetId: students[2].user.id });
    expect(by('assignment.deleted')).toMatchObject({ targetId: b.body.id, details: { title: 'Brouillon', submissions: 0 } });
    expect(by('project.lock_taken')).toMatchObject({ actor: { id: students[0].user.id }, targetId: p.body.id, details: { fromUserId: students[1].user.id, groupName: 'Volta' } });
    const batch = list.find((e) => e.action === 'user.created' && e.targetType === 'classroom')!;
    expect(batch.details).toMatchObject({ role: 'student', count: 3, usernames: students.map((s) => s.user.username) });
    // Connexions résumées : une seule ligne par compte et par jour, avec les compteurs.
    const logins = list.filter((e) => e.action === 'auth.login' && e.targetId === admin.user.id);
    expect(logins).toHaveLength(1);
    expect(logins[0].details).toMatchObject({ ok: 1, failed: 1 });
    // Jamais de secret dans le journal.
    expect(JSON.stringify(list)).not.toMatch(/temporaryPassword|passwordHash|motdepasse|mauvais-mot/);
  });

  it('administrateur seulement ; chaque école ne voit que son journal ; limit et before', async () => {
    const { students } = await setupClass(t, admin, 1);
    expect((await students[0].get('/school/audit')).status).toBe(403);
    const teacherRes = await admin.post('/school/teachers', { displayName: 'Prof', email: `p-${uid()}@test.dev` }).expect(201);
    const teacher = await login(t, teacherRes.body.user.email, teacherRes.body.temporaryPassword);
    expect((await teacher.get('/school/audit')).body.code).toBe('FORBIDDEN');

    const mine = await audit(other);
    expect(mine.every((e) => e.action === 'school.created' || e.targetId === other.user.id || e.actor?.id === other.user.id)).toBe(true);
    expect(JSON.stringify(mine)).not.toContain(admin.user.id);

    const two = await audit(admin, '?limit=2');
    expect(two).toHaveLength(2);
    const next = await audit(admin, `?limit=2&before=${two[1].id}`);
    const all = await audit(admin, '?limit=500');
    const at = all.findIndex((e) => e.id === two[1].id);
    expect(next.map((e) => e.id)).toEqual(all.slice(at + 1, at + 3).map((e) => e.id));
    expect((await admin.get('/school/audit?limit=0')).body.code).toBe('VALIDATION');
    expect((await admin.get('/school/audit?limit=501')).body.code).toBe('VALIDATION');
    expect((await admin.get('/school/audit?before=abc')).body.code).toBe('VALIDATION');
  });

  it('rétention : la purge efface les entrées de plus de 180 jours', async () => {
    const [{ id: old }] = await t.db.query(
      `INSERT INTO audit_log (school_id, action, details, created_at) VALUES ($1, 'user.disabled', '{}', now() - interval '181 days') RETURNING id`,
      [admin.school.id],
    );
    const [{ id: recent }] = await t.db.query(
      `INSERT INTO audit_log (school_id, action, details, created_at) VALUES ($1, 'user.enabled', '{}', now() - interval '179 days') RETURNING id`,
      [admin.school.id],
    );
    const { MaintenanceService } = await import('../src/maintenance/maintenance.service');
    const out = await t.app.get(MaintenanceService).run();
    expect(out.audit).toBe(1);
    const ids = (await audit(admin, '?limit=500')).map((e) => e.id);
    expect(ids).toContain(String(recent));
    expect(ids).not.toContain(String(old));
  });
});
