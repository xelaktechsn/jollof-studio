// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import jwt from 'jsonwebtoken';
import type { Socket } from 'socket.io-client';
import { anon, connect, createApp, login, registerSchool, Session, session, TestApp, uid } from './helpers';

const SECRET = 'e2e-only-secret-0123456789abcdefghijklmnopqrstuvwxyz';

/** Attend la fermeture de la socket par le serveur (ou échoue après `ms`). */
const closed = (s: Socket, ms = 3000) =>
  new Promise<string>((resolve, reject) => {
    if (!s.connected) return resolve('already');
    const timer = setTimeout(() => reject(new Error('socket still open')), ms);
    s.once('disconnect', (reason) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
const stillOpen = async (s: Socket) => {
  await new Promise((r) => setTimeout(r, 300));
  return s.connected;
};

describe('Révocation des sessions et vérification des jetons', () => {
  let t: TestApp;
  let admin: Session & { password: string };
  const sockets: Socket[] = [];
  const open = async (who: Session) => {
    const s = await connect(t, who.token);
    sockets.push(s);
    return s;
  };

  beforeAll(async () => {
    t = await createApp();
    admin = await registerSchool(t);
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await t.close();
  });

  async function teacher() {
    const res = await admin.post('/school/teachers', { displayName: 'Prof Test', email: `prof-${uid()}@test.dev` }).expect(201);
    return { id: res.body.user.id as string, email: res.body.user.email as string, password: res.body.temporaryPassword as string };
  }

  it('changer son mot de passe coupe les autres sessions (jetons, rafraîchissement, sockets) et garde la sienne', async () => {
    const who = await teacher();
    const here = await login(t, who.email, who.password);
    const elsewhere = await login(t, who.email, who.password);
    const [hereSocket, otherSocket] = [await open(here), await open(elsewhere)];
    const gone = closed(otherSocket);

    await here.post('/me/password', { currentPassword: who.password, newPassword: 'nouveau-secret-1' }).expect(204);

    // Autre session : jeton d'accès refusé tout de suite, rafraîchissement révoqué, socket fermée.
    expect((await elsewhere.get('/me')).body.code).toBe('AUTH_TOKEN_INVALID');
    expect((await anon(t).post('/auth/refresh', { refreshToken: elsewhere.refreshToken })).status).toBe(401);
    expect(await gone).toBe('io server disconnect');
    // Cette session : son jeton d'accès doit être renouvelé (le client le fait seul sur 401), sa socket reste.
    expect((await here.get('/me')).status).toBe(401);
    const renewed = session(t, (await anon(t).post('/auth/refresh', { refreshToken: here.refreshToken }).expect(200)).body);
    await renewed.get('/me').expect(200);
    expect(await stillOpen(hereSocket)).toBe(true);
    // L'ancien jeton d'accès ne rouvre pas de socket.
    await expect(connect(t, elsewhere.token)).rejects.toThrow('AUTH_TOKEN_INVALID');
  });

  it('réinitialisation par l’administrateur : toutes les sessions tombent aussitôt', async () => {
    const who = await teacher();
    const a = await login(t, who.email, who.password);
    const b = await login(t, who.email, who.password);
    const [sa, sb] = [await open(a), await open(b)];
    const gone = Promise.all([closed(sa), closed(sb)]);
    const reset = await admin.post(`/users/${who.id}/reset-password`).expect(200);
    await gone;
    for (const s of [a, b]) {
      expect((await s.get('/me')).body.code).toBe('AUTH_TOKEN_INVALID');
      expect((await anon(t).post('/auth/refresh', { refreshToken: s.refreshToken })).status).toBe(401);
    }
    await login(t, who.email, reset.body.temporaryPassword);
    await expect(connect(t, a.token)).rejects.toThrow('AUTH_TOKEN_INVALID');
  });

  it('désactivation : jetons, rafraîchissement et sockets coupés ; reconnexion refusée (AUTH_DISABLED)', async () => {
    const who = await teacher();
    const s = await login(t, who.email, who.password);
    const socket = await open(s);
    const gone = closed(socket);
    await admin.patch(`/users/${who.id}`, { disabled: true }).expect(200);
    await gone;
    expect((await s.get('/me')).status).toBeGreaterThanOrEqual(401);
    expect((await anon(t).post('/auth/refresh', { refreshToken: s.refreshToken })).status).toBeGreaterThanOrEqual(401);
    await expect(connect(t, s.token)).rejects.toThrow(/AUTH_(DISABLED|TOKEN_INVALID)/);
    // Réactivé : les anciens jetons restent morts, une nouvelle connexion marche.
    await admin.patch(`/users/${who.id}`, { disabled: false }).expect(200);
    expect((await s.get('/me')).body.code).toBe('AUTH_TOKEN_INVALID');
    await login(t, who.email, who.password);
  });

  it('JWT : HS256 seulement, émetteur, type, école et version vérifiés', async () => {
    const base = jwt.decode(admin.token) as Record<string, unknown>;
    expect(base).toMatchObject({ sub: admin.user.id, sch: admin.school.id, typ: 'access', ver: 0, iss: 'jollof' });
    expect(jwt.decode(admin.token, { complete: true })!.header.alg).toBe('HS256');
    const claims = { sub: base.sub, sch: base.sch, typ: 'access', ver: base.ver, fam: base.fam };
    const call = (token: string) => anon(t).get('/me').set('Authorization', `Bearer ${token}`);

    // Témoin : bien signé, accepté.
    await call(jwt.sign(claims, SECRET, { algorithm: 'HS256', issuer: 'jollof', expiresIn: 60 })).expect(200);
    const refused = [
      jwt.sign(claims, SECRET, { algorithm: 'HS512', issuer: 'jollof', expiresIn: 60 }),
      jwt.sign(claims, SECRET, { algorithm: 'HS384', issuer: 'jollof', expiresIn: 60 }),
      // « alg: none » : pas de signature.
      `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ ...claims, iss: 'jollof', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')}.`,
      jwt.sign(claims, 'un-autre-secret-de-plus-de-32-caracteres!!', { algorithm: 'HS256', issuer: 'jollof', expiresIn: 60 }),
      jwt.sign(claims, SECRET, { algorithm: 'HS256', issuer: 'quelqu-un', expiresIn: 60 }),
      jwt.sign({ ...claims, typ: 'refresh' }, SECRET, { algorithm: 'HS256', issuer: 'jollof', expiresIn: 60 }),
      jwt.sign({ ...claims, ver: 7 }, SECRET, { algorithm: 'HS256', issuer: 'jollof', expiresIn: 60 }),
      // Jeton valide d'un compte, présenté avec l'école d'une autre : refusé.
      jwt.sign({ ...claims, sch: '00000000-0000-4000-8000-000000000000' }, SECRET, { algorithm: 'HS256', issuer: 'jollof', expiresIn: 60 }),
      jwt.sign(claims, SECRET, { algorithm: 'HS256', issuer: 'jollof', expiresIn: -10 }),
    ];
    for (const token of refused) {
      const r = await call(token);
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('AUTH_TOKEN_INVALID');
      await expect(connect(t, token)).rejects.toThrow('AUTH_TOKEN_INVALID');
    }
  });
});
