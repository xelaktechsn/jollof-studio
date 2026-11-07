// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import request from 'supertest';
import { anon, createApp, login, registerSchool, Session, setupClass, TestApp, uid } from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

describe('Messagerie, fichiers et notifications', () => {
  let t: TestApp;
  let teacher: Session;
  let classroom: { id: string; name: string };
  let s: Session[];
  let classConv: string;

  beforeAll(async () => {
    t = await createApp();
    teacher = await registerSchool(t);
    ({ classroom, students: s } = await setupClass(t, teacher, 3));
    classConv = (await teacher.get('/conversations')).body.find((c: { kind: string }) => c.kind === 'class').id;
  });
  afterAll(() => t.close());

  const upload = (who: Session, buf: Buffer, name: string) =>
    request(t.app.getHttpServer()).post('/api/v1/files').set('Authorization', `Bearer ${who.token}`).attach('file', buf, name);

  it('conversation de classe : messages, ordre, non-lus, lecture', async () => {
    const list = await s[0].get('/conversations').expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({ id: classConv, kind: 'class', classroomId: classroom.id, groupId: null, title: classroom.name, other: null, settings: { studentsCanPost: true }, lastMessage: null, unreadCount: 0 }),
    ]);
    const m1 = await teacher.post(`/conversations/${classConv}/messages`, { body: 'Bonjour la classe' }).expect(201);
    expect(m1.body).toMatchObject({ conversationId: classConv, body: 'Bonjour la classe', attachments: [], editedAt: null, deleted: false, sender: { id: teacher.user.id, displayName: teacher.user.displayName, role: 'teacher' } });
    await s[1].post(`/conversations/${classConv}/messages`, { body: 'Bonjour madame' }).expect(201);
    expect((await s[1].post(`/conversations/${classConv}/messages`, { body: '   ' })).body.code).toBe('VALIDATION');
    expect((await s[1].post(`/conversations/${classConv}/messages`, { body: 'x'.repeat(4001) })).body.code).toBe('VALIDATION');

    const c0 = (await s[0].get('/conversations')).body[0];
    expect(c0.unreadCount).toBe(2);
    expect(c0.lastMessage.body).toBe('Bonjour madame');
    // Écrire vaut lecture de ce qui précède.
    expect((await s[1].get('/conversations')).body[0].unreadCount).toBe(0);

    const msgs = await s[0].get(`/conversations/${classConv}/messages`).expect(200);
    expect(msgs.body.map((m: { body: string }) => m.body)).toEqual(['Bonjour la classe', 'Bonjour madame']);
    await s[0].post(`/conversations/${classConv}/read`, { messageId: m1.body.id }).expect(204);
    expect((await s[0].get('/conversations')).body[0].unreadCount).toBe(1);
    await s[0].post(`/conversations/${classConv}/read`, { messageId: msgs.body[1].id }).expect(204);
    // Relire un message plus ancien ne fait pas reculer la position.
    await s[0].post(`/conversations/${classConv}/read`, { messageId: m1.body.id }).expect(204);
    expect((await s[0].get('/conversations')).body[0].unreadCount).toBe(0);

    // Pagination : `before` et `limit`, ordre chronologique.
    for (let i = 0; i < 5; i++) await teacher.post(`/conversations/${classConv}/messages`, { body: `n${i}` }).expect(201);
    const last2 = await s[0].get(`/conversations/${classConv}/messages?limit=2`).expect(200);
    expect(last2.body.map((m: { body: string }) => m.body)).toEqual(['n3', 'n4']);
    const before = await s[0].get(`/conversations/${classConv}/messages?limit=3&before=${last2.body[0].id}`).expect(200);
    expect(before.body.map((m: { body: string }) => m.body)).toEqual(['n0', 'n1', 'n2']);
    expect((await s[0].get(`/conversations/${classConv}/messages?limit=101`)).body.code).toBe('VALIDATION');
  });

  it('studentsCanPost : seuls les enseignants écrivent quand c’est coupé', async () => {
    expect((await s[0].patch(`/conversations/${classConv}/settings`, { studentsCanPost: false })).status).toBe(403);
    const off = await teacher.patch(`/conversations/${classConv}/settings`, { studentsCanPost: false }).expect(200);
    expect(off.body.settings).toEqual({ studentsCanPost: false });
    const denied = await s[0].post(`/conversations/${classConv}/messages`, { body: 'Puis-je ?' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('POSTING_DISABLED');
    await teacher.post(`/conversations/${classConv}/messages`, { body: 'Silence' }).expect(201);
    await teacher.patch(`/conversations/${classConv}/settings`, { studentsCanPost: true }).expect(200);
    await s[0].post(`/conversations/${classConv}/messages`, { body: 'Merci' }).expect(201);
  });

  it('modification (15 min) et suppression (auteur, enseignant de la classe)', async () => {
    const m = await s[0].post(`/conversations/${classConv}/messages`, { body: 'Erreur de frappe' }).expect(201);
    const edited = await s[0].patch(`/messages/${m.body.id}`, { body: 'Corrigé' }).expect(200);
    expect(edited.body.body).toBe('Corrigé');
    expect(edited.body.editedAt).toBeTruthy();
    expect((await s[1].patch(`/messages/${m.body.id}`, { body: 'Pirate' })).status).toBe(403);
    expect((await teacher.patch(`/messages/${m.body.id}`, { body: 'Prof' })).status).toBe(403);
    await t.db.query(`UPDATE messages SET created_at = now() - interval '16 minutes' WHERE id = $1`, [m.body.id]);
    const late = await s[0].patch(`/messages/${m.body.id}`, { body: 'Trop tard' });
    expect(late.status).toBe(403);
    expect(late.body.code).toBe('EDIT_WINDOW_PASSED');

    expect((await s[1].del(`/messages/${m.body.id}`)).status).toBe(403);
    await teacher.del(`/messages/${m.body.id}`).expect(204);
    const msgs = (await s[1].get(`/conversations/${classConv}/messages`)).body;
    expect(msgs.find((x: { id: string }) => x.id === m.body.id)).toMatchObject({ body: null, deleted: true, attachments: [] });
    const own = await s[1].post(`/conversations/${classConv}/messages`, { body: 'À effacer' }).expect(201);
    await s[1].del(`/messages/${own.body.id}`).expect(204);
    expect((await s[1].patch(`/messages/${own.body.id}`, { body: 'x' })).status).toBe(404);
  });

  it('messages directs : règles enseignant/élève/élève, idempotence', async () => {
    const dm = await s[0].post('/conversations/direct', { userId: teacher.user.id }).expect(200);
    expect(dm.body).toMatchObject({ kind: 'direct', classroomId: null, title: teacher.user.displayName, other: { id: teacher.user.id, role: 'teacher' } });
    expect((await teacher.post('/conversations/direct', { userId: s[0].user.id }).expect(200)).body.id).toBe(dm.body.id);
    await teacher.post(`/conversations/${dm.body.id}/messages`, { body: 'Viens me voir' }).expect(201);
    expect((await s[0].get('/conversations')).body.find((c: { id: string }) => c.id === dm.body.id).unreadCount).toBe(1);
    expect((await s[1].get(`/conversations/${dm.body.id}/messages`)).status).toBe(403);

    // Élève ↔ élève : seulement si la classe le permet.
    const denied = await s[0].post('/conversations/direct', { userId: s[1].user.id });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');
    await teacher.patch(`/classrooms/${classroom.id}`, { settings: { allowStudentDirectMessages: true } }).expect(200);
    const pair = await s[0].post('/conversations/direct', { userId: s[1].user.id }).expect(200);
    await s[1].post(`/conversations/${pair.body.id}/messages`, { body: 'Salut' }).expect(201);
    // Option retirée : la conversation reste lisible, mais on n'y écrit plus.
    await teacher.patch(`/classrooms/${classroom.id}`, { settings: { allowStudentDirectMessages: false } }).expect(200);
    expect((await s[1].post(`/conversations/${pair.body.id}/messages`, { body: 'Encore' })).status).toBe(403);
    await s[0].get(`/conversations/${pair.body.id}/messages`).expect(200);

    // Enseignant ↔ enseignant de l'école ; enseignant ↔ élève sans classe commune : non.
    const t2 = await teacher.post('/school/teachers', { displayName: 'Collègue', email: `c-${uid()}@test.dev` }).expect(201);
    const colleague = await login(t, t2.body.user.email, t2.body.temporaryPassword);
    await colleague.post('/conversations/direct', { userId: teacher.user.id }).expect(200);
    expect((await colleague.post('/conversations/direct', { userId: s[0].user.id })).status).toBe(403);
    expect((await s[0].post('/conversations/direct', { userId: s[0].user.id })).body.code).toBe('VALIDATION');
  });

  it('fichiers : envoi, téléchargement par clé, types et taille', async () => {
    const up = await upload(s[0], PNG, 'schéma.png').expect(201);
    expect(up.body).toMatchObject({ name: 'schéma.png', mime: 'image/png', size: PNG.length });
    expect(up.body.url).toMatch(new RegExp(`^/api/v1/files/${up.body.id}/[A-Za-z0-9_-]{32}$`));
    const got = await anon(t).get(up.body.url.replace('/api/v1', '')).expect(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(got.headers['content-disposition']).toMatch(/^inline;/);
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(got.body, PNG)).toBe(0);
    expect((await anon(t).get(`/files/${up.body.id}/${'A'.repeat(32)}`)).status).toBe(404);

    const json = await upload(s[0], Buffer.from('{"version":1}'), 'montage.jollof').expect(201);
    expect(json.body.mime).toBe('application/vnd.jollof+json');
    const dl = await anon(t).get(json.body.url.replace('/api/v1', '')).expect(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    await upload(s[0], Buffer.from('void setup() {}'), 'sketch.ino').expect(201);
    await upload(s[0], Buffer.from('%PDF-1.4\n%…'), 'cours.pdf').expect(201);

    const exe = await upload(s[0], Buffer.from('MZ\x90\x00binary'), 'virus.exe');
    expect(exe.status).toBe(415);
    expect(exe.body.code).toBe('FILE_TYPE');
    // Une page HTML déguisée en image est refusée (le contenu fait foi).
    expect((await upload(s[0], Buffer.from('<html><script>alert(1)</script></html>'), 'photo.png')).body.code).toBe('FILE_TYPE');
    expect((await upload(s[0], Buffer.from('{pas du json'), 'x.json')).body.code).toBe('FILE_TYPE');
    const big = await upload(s[0], Buffer.alloc(10 * 1024 * 1024 + 1, 0x20), 'gros.txt');
    expect(big.status).toBe(413);
    expect(big.body.code).toBe('FILE_TOO_LARGE');
    expect((await request(t.app.getHttpServer()).post('/api/v1/files').attach('file', PNG, 'a.png')).status).toBe(401);

    // Pièces jointes : ses propres fichiers seulement.
    const msg = await s[0].post(`/conversations/${classConv}/messages`, { body: 'Mon schéma', attachmentIds: [up.body.id] }).expect(201);
    expect(msg.body.attachments).toEqual([up.body]);
    expect((await s[1].post(`/conversations/${classConv}/messages`, { body: 'Vol', attachmentIds: [up.body.id] })).body.code).toBe('VALIDATION');
  });

  it('fichiers : CSP stricte, jamais de HTML/SVG/JS stocké ni servi en ligne', async () => {
    const CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
    const img = await upload(s[0], PNG, 'logo.png').expect(201);
    const got = await anon(t).get(img.body.url.replace('/api/v1', '')).expect(200);
    expect(got.headers['content-security-policy']).toBe(CSP);
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    // Pages, scripts et SVG refusés, quel que soit le nom.
    for (const [body, name] of [
      ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'dessin.svg'],
      ['<!doctype html><script>alert(1)</script>', 'page.html'],
      ['<!doctype html><script>alert(1)</script>', 'page.htm'],
      ['alert(document.cookie)', 'script.js'],
      ['<?xml version="1.0"?><x/>', 'data.xml'],
    ]) {
      const r = await upload(s[0], Buffer.from(body), name);
      expect(r.status).toBe(415);
      expect(r.body.code).toBe('FILE_TYPE');
    }
    // Du HTML dans un .txt reste du texte, à télécharger, jamais affiché comme une page.
    const txt = await upload(s[0], Buffer.from('<html><script>alert(1)</script></html>'), 'notes.txt').expect(201);
    const dl = await anon(t).get(txt.body.url.replace('/api/v1', '')).expect(200);
    expect(dl.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['content-security-policy']).toBe(CSP);
    // Type dangereux arrivé en base par un autre chemin : servi comme binaire à télécharger.
    await t.db.query(`UPDATE files SET mime = 'text/html' WHERE id = $1`, [txt.body.id]);
    const forced = await anon(t).get(txt.body.url.replace('/api/v1', '')).expect(200);
    expect(forced.headers['content-type']).toBe('application/octet-stream');
    expect(forced.headers['content-disposition']).toMatch(/^attachment;/);
    await t.db.query(`UPDATE files SET mime = 'image/svg+xml' WHERE id = $1`, [img.body.id]);
    const svg = await anon(t).get(img.body.url.replace('/api/v1', '')).expect(200);
    expect(svg.headers['content-type']).toBe('application/octet-stream');
    expect(svg.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('envoi de messages limité : 20 par 10 s et par utilisateur, puis 429 RATE_LIMITED', async () => {
    // Élève qui n'a encore rien envoyé (toute tentative compte, même refusée ensuite).
    const { students: [fresh] } = await setupClass(t, teacher, 1);
    const dm = await teacher.post('/conversations/direct', { userId: fresh.user.id }).expect(200);
    for (let i = 0; i < 20; i++) await fresh.post(`/conversations/${dm.body.id}/messages`, { body: `m${i}` }).expect(201);
    const r = await fresh.post(`/conversations/${dm.body.id}/messages`, { body: 'encore' });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(r.body.retryAfter).toBeGreaterThanOrEqual(1);
    expect(r.body.retryAfter).toBeLessThanOrEqual(10);
    expect(Number(r.headers['retry-after'])).toBe(r.body.retryAfter);
    // Chacun son compteur : l'enseignant écrit toujours.
    await teacher.post(`/conversations/${dm.body.id}/messages`, { body: 'Doucement' }).expect(201);
  });

  it('réponses JSON compressées à partir de 1 Ko seulement', async () => {
    const big = await teacher.get(`/conversations/${classConv}/messages?limit=100`).set('Accept-Encoding', 'gzip').expect(200);
    expect(JSON.stringify(big.body).length).toBeGreaterThan(1024);
    expect(big.headers['content-encoding']).toBe('gzip');
    const small = await anon(t).get('/health').set('Accept-Encoding', 'gzip').expect(200);
    expect(small.headers['content-encoding']).toBeUndefined();
    // Les fichiers (images) ne sont pas recompressés.
    const img = await upload(s[0], Buffer.concat([PNG, Buffer.alloc(4096)]), 'grand.png').expect(201);
    const file = await anon(t).get(img.body.url.replace('/api/v1', '')).set('Accept-Encoding', 'gzip').expect(200);
    expect(file.headers['content-encoding']).toBeUndefined();
  });

  it('notifications : liste, non lues, marquage', async () => {
    const a = await teacher.post(`/classrooms/${classroom.id}/assignments`, { kind: 'exercise', title: 'N1' }).expect(201);
    await teacher.post(`/assignments/${a.body.id}/publish`).expect(200);
    const b = await teacher.post(`/classrooms/${classroom.id}/assignments`, { kind: 'exercise', title: 'N2' }).expect(201);
    await teacher.post(`/assignments/${b.body.id}/publish`).expect(200);
    const all = await s[2].get('/notifications').expect(200);
    expect(all.body.map((n: { data: { assignmentTitle: string } }) => n.data.assignmentTitle)).toEqual(['N2', 'N1']);
    expect((await s[2].get('/notifications?limit=1')).body).toHaveLength(1);
    await s[2].post('/notifications/read', { ids: [all.body[0].id] }).expect(204);
    const unread = await s[2].get('/notifications?unread=true').expect(200);
    expect(unread.body.map((n: { id: string }) => n.id)).toEqual([all.body[1].id]);
    // Les notifications d'un autre ne sont pas touchées.
    await s[1].post('/notifications/read', { all: true }).expect(204);
    expect((await s[2].get('/notifications?unread=true')).body).toHaveLength(1);
    await s[2].post('/notifications/read', { all: true }).expect(204);
    expect((await s[2].get('/notifications?unread=true')).body).toEqual([]);
    expect((await s[2].get('/notifications')).body[0].readAt).toBeTruthy();
  });
});
