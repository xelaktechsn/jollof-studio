// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { anon, createApp, login, registerSchool, session, Session, TestApp, uid } from './helpers';

describe('Authentification et comptes', () => {
  let t: TestApp;
  let admin: Session & { password: string };

  beforeAll(async () => {
    t = await createApp();
    admin = await registerSchool(t, 'Lycée Blaise Diagne');
  });
  afterAll(() => t.close());

  it('register-school crée une école en essai et son administrateur', async () => {
    expect(admin.user).toMatchObject({ role: 'admin', displayName: 'Awa Ndiaye', mustChangePassword: false, username: 'awa.ndiaye' });
    expect(admin.user.passwordHash).toBeUndefined();
    expect(admin.school.plan).toBe('trial');
    const days = (new Date(admin.school.trialEndsAt).getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(typeof admin.token).toBe('string');
    expect(typeof admin.refreshToken).toBe('string');
  });

  it('refuse un courriel déjà pris, un mot de passe court et les champs inconnus', async () => {
    const email = admin.user.email;
    const dup = await anon(t).post('/auth/register-school', { schoolName: 'X', displayName: 'Y', email: email.toUpperCase(), password: '12345678' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('EMAIL_TAKEN');
    const short = await anon(t).post('/auth/register-school', { schoolName: 'X', displayName: 'Y', email: `${uid()}@t.dev`, password: 'court' });
    expect(short.status).toBe(400);
    expect(short.body).toMatchObject({ statusCode: 400, code: 'VALIDATION' });
    const extra = await anon(t).post('/auth/login', { login: 'a', password: 'b', admin: true });
    expect(extra.body.code).toBe('VALIDATION');
  });

  it('connexion par courriel ou nom d’utilisateur, sans tenir compte de la casse', async () => {
    const byEmail = await anon(t).post('/auth/login', { login: admin.user.email.toUpperCase(), password: admin.password }).expect(200);
    expect(byEmail.body.user.id).toBe(admin.user.id);
    expect(byEmail.body.school.id).toBe(admin.school.id);
    const byName = await anon(t).post('/auth/login', { login: 'AWA.Ndiaye', password: admin.password }).expect(200);
    expect(byName.body.user.id).toBe(admin.user.id);
    const bad = await anon(t).post('/auth/login', { login: admin.user.email, password: 'mauvais-mot' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    const unknown = await anon(t).post('/auth/login', { login: 'personne', password: 'mauvais-mot' });
    expect(unknown.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('GET /me exige un jeton valide', async () => {
    const me = await admin.get('/me').expect(200);
    expect(me.body.user.id).toBe(admin.user.id);
    expect(me.body.school.name).toBe('Lycée Blaise Diagne');
    const none = await anon(t).get('/me');
    expect(none.status).toBe(401);
    expect(none.body.code).toBe('AUTH_TOKEN_INVALID');
    const forged = await anon(t).get('/me').set('Authorization', 'Bearer abc.def.ghi');
    expect(forged.body.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('rafraîchissement : rotation, puis réutilisation détectée (toute la famille révoquée)', async () => {
    const s = await login(t, admin.user.email, admin.password);
    const r1 = await anon(t).post('/auth/refresh', { refreshToken: s.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    expect(r1.body.user.id).toBe(admin.user.id);
    expect(r1.body.school.id).toBe(admin.school.id);
    // L'ancien jeton rejoué : refusé, et le nouveau de la même famille tombe aussi.
    const reuse = await anon(t).post('/auth/refresh', { refreshToken: s.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('AUTH_TOKEN_INVALID');
    const after = await anon(t).post('/auth/refresh', { refreshToken: r1.body.refreshToken });
    expect(after.status).toBe(401);
    // Une autre session n'est pas touchée.
    await anon(t).post('/auth/refresh', { refreshToken: admin.refreshToken }).expect(200);
  });

  it('logout révoque le jeton de rafraîchissement', async () => {
    const s = await login(t, admin.user.email, admin.password);
    await anon(t).post('/auth/logout', { refreshToken: s.refreshToken }).expect(204);
    const r = await anon(t).post('/auth/refresh', { refreshToken: s.refreshToken });
    expect(r.body.code).toBe('AUTH_TOKEN_INVALID');
    await anon(t).post('/auth/logout', { refreshToken: 'inconnu' }).expect(204);
  });

  it('PATCH /me et POST /me/password', async () => {
    // Corps vide : rien ne change.
    expect((await admin.patch('/me', {}).expect(200)).body.displayName).toBe('Awa Ndiaye');
    const p = await admin.patch('/me', { displayName: 'Awa N.', avatarColor: '#123abc' }).expect(200);
    expect(p.body).toMatchObject({ displayName: 'Awa N.', avatarColor: '#123abc' });
    expect((await admin.patch('/me', { avatarColor: 'red' })).body.code).toBe('VALIDATION');
    const wrong = await admin.post('/me/password', { currentPassword: 'faux-mot-de-passe', newPassword: 'nouveau-mot-1' });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect((await admin.post('/me/password', { currentPassword: admin.password, newPassword: 'court' })).body.code).toBe('VALIDATION');
    await admin.post('/me/password', { currentPassword: admin.password, newPassword: 'nouveau-mot-1' }).expect(204);
    const fresh = await login(t, admin.user.email, 'nouveau-mot-1');
    expect((await anon(t).post('/auth/login', { login: admin.user.email, password: admin.password })).status).toBe(401);
    // Le jeton d'accès d'avant le changement ne vaut plus rien (version des jetons) : on repart de la nouvelle session.
    expect((await admin.get('/me')).body.code).toBe('AUTH_TOKEN_INVALID');
    admin = Object.assign(fresh, { password: 'nouveau-mot-1' });
  });

  it('enseignant créé par l’administrateur : mot de passe provisoire à changer', async () => {
    const res = await admin.post('/school/teachers', { displayName: 'Ousmane Sène', email: `prof-${uid()}@test.dev` }).expect(201);
    expect(res.body.temporaryPassword).toMatch(/^[a-z]+-[a-z]+-\d{3}$/);
    expect(res.body.user).toMatchObject({ role: 'teacher', mustChangePassword: true, username: 'ousmane.sene' });
    const teacher = await login(t, res.body.user.email, res.body.temporaryPassword);
    expect(teacher.user.mustChangePassword).toBe(true);
    await teacher.post('/me/password', { currentPassword: res.body.temporaryPassword, newPassword: 'mon-mot-secret' }).expect(204);
    // La session qui change le mot de passe reste ouverte : son jeton se renouvelle, comme le fait le client.
    const renewed = session(t, (await anon(t).post('/auth/refresh', { refreshToken: teacher.refreshToken }).expect(200)).body);
    expect((await renewed.get('/me')).body.user.mustChangePassword).toBe(false);

    const list = await admin.get('/school/teachers').expect(200);
    expect(list.body.map((u: { id: string }) => u.id)).toEqual(expect.arrayContaining([admin.user.id, res.body.user.id]));
    expect(list.body.every((u: Record<string, unknown>) => !('passwordHash' in u))).toBe(true);
    // Réservé à l'administrateur.
    expect((await renewed.get('/school/teachers')).body.code).toBe('FORBIDDEN');
    expect((await renewed.patch('/school', { name: 'Pirate' })).status).toBe(403);
    expect((await admin.patch('/school', { name: 'Lycée B. Diagne' }).expect(200)).body.name).toBe('Lycée B. Diagne');
    const dupEmail = await admin.post('/school/teachers', { displayName: 'Autre', email: res.body.user.email });
    expect(dupEmail.body.code).toBe('EMAIL_TAKEN');
  });

  it('compte désactivé : connexion, jeton et rafraîchissement refusés (AUTH_DISABLED)', async () => {
    const created = await admin.post('/school/teachers', { displayName: 'Prof Désactivé', email: `off-${uid()}@test.dev` }).expect(201);
    const teacher = await login(t, created.body.user.username, created.body.temporaryPassword);
    const off = await admin.patch(`/users/${created.body.user.id}`, { disabled: true }).expect(200);
    expect(off.body.disabled).toBe(true);
    const l = await anon(t).post('/auth/login', { login: created.body.user.username, password: created.body.temporaryPassword });
    expect(l.status).toBe(403);
    expect(l.body.code).toBe('AUTH_DISABLED');
    expect((await teacher.get('/me')).body.code).toBe('AUTH_DISABLED');
    expect((await anon(t).post('/auth/refresh', { refreshToken: teacher.refreshToken })).status).toBeGreaterThanOrEqual(401);
    await admin.patch(`/users/${created.body.user.id}`, { disabled: false }).expect(200);
    await login(t, created.body.user.username, created.body.temporaryPassword);
    // Personne ne se gère soi-même par cette route.
    expect((await admin.patch(`/users/${admin.user.id}`, { disabled: true })).status).toBe(403);
  });

  it('forfait : PLAN_REQUIRED pour les actions enseignant, lecture permise', async () => {
    const key = { 'X-Platform-Key': 'e2e-platform-key' };
    expect((await anon(t).post(`/platform/schools/${admin.school.id}/plan`, { plan: 'pro' }).set('X-Platform-Key', 'faux')).status).toBe(403);
    expect((await anon(t).post(`/platform/schools/${admin.school.id}/plan`, { plan: 'pro' })).status).toBe(403);
    const expired = await anon(t).post(`/platform/schools/${admin.school.id}/plan`, { plan: 'expired' }).set(key).expect(200);
    expect(expired.body.plan).toBe('expired');
    const c = await admin.post('/classrooms', { name: 'Seconde S' });
    expect(c.status).toBe(403);
    expect(c.body.code).toBe('PLAN_REQUIRED');
    await admin.get('/classrooms').expect(200);
    // Essai échu = expiré.
    await anon(t).post(`/platform/schools/${admin.school.id}/plan`, { plan: 'trial', trialEndsAt: new Date(Date.now() - 1000).toISOString() }).set(key).expect(200);
    expect((await admin.post('/classrooms', { name: 'Seconde S' })).body.code).toBe('PLAN_REQUIRED');
    await anon(t).post(`/platform/schools/${admin.school.id}/plan`, { plan: 'pro', trialEndsAt: null }).set(key).expect(200);
    await admin.post('/classrooms', { name: 'Seconde S' }).expect(201);
  });

  it('exploitation : health, corps trop gros, CORS, id invalide, route inconnue', async () => {
    expect((await anon(t).get('/health').expect(200)).body).toEqual({ ok: true, db: true });
    const big = await admin.patch('/me', { displayName: 'x'.repeat(7 * 1024 * 1024) });
    expect(big.status).toBe(413);
    expect(big.body.code).toBe('PAYLOAD_TOO_LARGE');
    const ok = await anon(t).get('/health').set('Origin', 'tauri://localhost');
    expect(ok.headers['access-control-allow-origin']).toBe('tauri://localhost');
    const evil = await anon(t).get('/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    expect((await admin.get('/classrooms/not-a-uuid')).body.code).toBe('VALIDATION');
    expect((await admin.get('/nowhere')).body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });
});
