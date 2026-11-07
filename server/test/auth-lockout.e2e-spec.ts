// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { anon, createApp, login, registerSchool, Session, TestApp } from './helpers';

// Limite par compte : 5 échecs libres, puis attente croissante (429 + retryAfter), 15 min de blocage à 10.
describe('Protection de chaque compte contre la devinette de mot de passe', () => {
  let t: TestApp;
  let admin: Session & { password: string };
  let student: { username: string; password: string; id: string };

  const attempt = (loginName: string, password = 'mauvais-mot') => anon(t).post('/auth/login', { login: loginName, password });
  // Fait comme si l'attente imposée était écoulée (sans attendre pour de vrai).
  const elapse = (loginName: string) => t.db.query(`UPDATE login_attempts SET blocked_until = now() - interval '1 second' WHERE login = $1`, [loginName]);
  const failures = async (loginName: string) => (await t.db.query('SELECT failures FROM login_attempts WHERE login = $1', [loginName]))[0]?.failures ?? 0;

  beforeAll(async () => {
    t = await createApp();
    admin = await registerSchool(t);
    const created = await admin.post('/classrooms', { name: 'CM2' }).expect(201);
    const s = await admin.post(`/classrooms/${created.body.id}/students`, { students: [{ displayName: 'Binta Diallo' }] }).expect(201);
    student = { username: s.body[0].user.username, password: s.body[0].temporaryPassword, id: s.body[0].user.id };
  });
  afterAll(() => t.close());

  /** Suite d'échecs : statuts et retryAfter observés, pour comparer compte existant et inconnu. */
  async function run(loginName: string) {
    const seen: (number | string)[] = [];
    for (let i = 1; i <= 5; i++) seen.push((await attempt(loginName)).status);
    const blocked = await attempt(loginName);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
    expect(Number(blocked.headers['retry-after'])).toBe(blocked.body.retryAfter);
    seen.push(`429:${blocked.body.retryAfter}`);
    // Échecs 6 à 9 : chacun après l'attente précédente, qui double.
    for (let i = 6; i <= 10; i++) {
      await elapse(loginName);
      seen.push((await attempt(loginName)).status);
      const r = await attempt(loginName);
      expect(r.body.code).toBe('RATE_LIMITED');
      seen.push(`429:${r.body.retryAfter}`);
    }
    return seen;
  }

  it('5 échecs libres, attente 15 s puis doublée, blocage de 15 min au 10e ; même chose pour un compte inconnu', async () => {
    const known = await run(student.username);
    expect(known).toEqual([401, 401, 401, 401, 401, '429:15', 401, '429:30', 401, '429:60', 401, '429:120', 401, '429:240', 401, '429:900']);
    // Rien ne trahit l'existence du compte : même suite pour un identifiant qui n'existe pas.
    const unknown = await run('personne.inconnue');
    expect(unknown).toEqual(known);
  });

  it('pendant le blocage, même le bon mot de passe est refusé sans être vérifié', async () => {
    const r = await attempt(student.username, student.password);
    expect(r.status).toBe(429);
    expect(r.body.retryAfter).toBeGreaterThan(800);
    expect(r.body.retryAfter).toBeLessThanOrEqual(900);
  });

  it('le journal note le blocage et résume les connexions du jour', async () => {
    const audit = (await admin.get('/school/audit').expect(200)).body as { action: string; targetId: string; details: Record<string, unknown> }[];
    const locked = audit.find((e) => e.action === 'auth.locked' && e.targetId === student.id);
    expect(locked?.details).toMatchObject({ failures: 10 });
    const day = audit.find((e) => e.action === 'auth.login' && e.targetId === student.id);
    expect(day?.details).toMatchObject({ failed: 10 });
    // Aucune trace de l'identifiant inconnu dans le journal de l'école.
    expect(JSON.stringify(audit)).not.toContain('personne.inconnue');
  });

  it('réinitialiser le mot de passe débloque le compte ; une connexion réussie remet le compteur à zéro', async () => {
    const reset = await admin.post(`/users/${student.id}/reset-password`).expect(200);
    const fresh = reset.body.temporaryPassword;
    await login(t, student.username, fresh);
    expect(await failures(student.username)).toBe(0);
    for (let i = 0; i < 4; i++) expect((await attempt(student.username)).status).toBe(401);
    await login(t, student.username, fresh);
    expect(await failures(student.username)).toBe(0);
    // Le compte repart avec ses 5 échecs libres.
    for (let i = 0; i < 5; i++) expect((await attempt(student.username)).status).toBe(401);
    expect((await attempt(student.username, fresh)).status).toBe(429);
  });

  it('échecs anciens oubliés après 24 h ; la purge efface les compteurs périmés', async () => {
    await t.db.query(`UPDATE login_attempts SET last_failure_at = now() - interval '25 hours', blocked_until = NULL WHERE login = $1`, [student.username]);
    expect((await attempt(student.username)).status).toBe(401);
    expect(await failures(student.username)).toBe(1);
    await t.db.query(`UPDATE login_attempts SET last_failure_at = now() - interval '25 hours', blocked_until = NULL`);
    const { MaintenanceService } = await import('../src/maintenance/maintenance.service');
    await t.app.get(MaintenanceService).run();
    expect(Number((await t.db.query('SELECT count(*) FROM login_attempts'))[0].count)).toBe(0);
  });
});
