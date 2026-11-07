// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import type { Socket } from 'socket.io-client';
import { connect, createApp, doc, next, registerSchool, Session, setupClass, TestApp } from './helpers';

describe('Temps réel (Socket.IO /rt)', () => {
  let t: TestApp;
  let teacher: Session;
  let classroom: { id: string };
  let s: Session[];
  const sockets: Socket[] = [];
  let classConv: string;

  const open = async (who: Session) => {
    const socket = await connect(t, who.token);
    sockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    t = await createApp();
    teacher = await registerSchool(t);
    ({ classroom, students: s } = await setupClass(t, teacher, 3));
    classConv = (await teacher.get('/conversations')).body[0].id;
  });
  afterAll(async () => {
    sockets.forEach((x) => x.close());
    await t.close();
  });

  it('refuse un jeton invalide (connect_error AUTH_TOKEN_INVALID)', async () => {
    await expect(connect(t, 'pas-un-jeton')).rejects.toThrow('AUTH_TOKEN_INVALID');
    await expect(connect(t, '')).rejects.toThrow('AUTH_TOKEN_INVALID');
  });

  it('présence, message:new, typing, message:updated, message:deleted', async () => {
    const st = await open(teacher);
    const presence = next(st, 'presence', (p: { userId: string }) => p.userId === s[0].user.id);
    const s0 = await open(s[0]);
    expect(await presence).toEqual({ userId: s[0].user.id, online: true });
    expect((await teacher.get(`/classrooms/${classroom.id}`)).body.members.find((m: { userId: string }) => m.userId === s[0].user.id).online).toBe(true);

    const got = next(s0, 'message:new');
    const posted = await teacher.post(`/conversations/${classConv}/messages`, { body: 'En direct' }).expect(201);
    expect(await got).toEqual({ message: posted.body });

    const typing = next(st, 'typing');
    s0.emit('typing', { conversationId: classConv });
    expect(await typing).toEqual({ conversationId: classConv, userId: s[0].user.id, displayName: s[0].user.displayName });

    const updated = next(s0, 'message:updated');
    await teacher.patch(`/messages/${posted.body.id}`, { body: 'En direct !' }).expect(200);
    expect((await updated).message.body).toBe('En direct !');
    const deleted = next(s0, 'message:deleted');
    await teacher.del(`/messages/${posted.body.id}`).expect(204);
    expect(await deleted).toEqual({ id: posted.body.id, conversationId: classConv });

    const offline = next(st, 'presence', (p: { online: boolean }) => !p.online);
    s0.close();
    expect(await offline).toEqual({ userId: s[0].user.id, online: false });
    expect((await teacher.get(`/classrooms/${classroom.id}`)).body.members.find((m: { userId: string }) => m.userId === s[0].user.id).lastSeenAt).toBeTruthy();
  });

  it('publication de devoir : notification + assignment:published ; envoi : submission:updated aux enseignants', async () => {
    const st = await open(teacher);
    const s1 = await open(s[1]);
    const a = await teacher
      .post(`/classrooms/${classroom.id}/assignments`, {
        kind: 'exercise',
        title: 'Temps réel',
        items: [{ id: 'q', type: 'choice', prompt: doc('?'), options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], multiple: false, correct: ['a'], points: 1 }],
      })
      .expect(201);
    const notif = next(s1, 'notification', (p: { notification: { type: string } }) => p.notification.type === 'assignment_published');
    const published = next(s1, 'assignment:published');
    await teacher.post(`/assignments/${a.body.id}/publish`).expect(200);
    expect((await notif).notification).toMatchObject({ type: 'assignment_published', readAt: null, data: { assignmentId: a.body.id } });
    const pub = await published;
    expect(pub.assignment).toMatchObject({ id: a.body.id, mySubmission: null });
    expect(JSON.stringify(pub.assignment.items)).not.toContain('correct');

    const started = next(st, 'submission:updated', (p: { submission: { status: string } }) => p.submission.status === 'in_progress');
    const sub = await s[1].post(`/assignments/${a.body.id}/start`).expect(200);
    expect((await started).assignmentId).toBe(a.body.id);
    const sent = next(st, 'submission:updated', (p: { submission: { status: string } }) => p.submission.status === 'graded');
    const received = next(st, 'notification', (p: { notification: { type: string } }) => p.notification.type === 'submission_received');
    await s[1].post(`/submissions/${sub.body.id}/submit`, { answers: { q: { selected: ['a'] } } }).expect(200);
    expect(await sent).toEqual({
      assignmentId: a.body.id,
      submission: expect.objectContaining({ id: sub.body.id, attempt: 1, status: 'graded', score: 1, maxScore: 1, late: false, studentId: s[1].user.id, studentName: s[1].user.displayName }),
    });
    await received;
  });

  it('nouvelles appartenances : salles rejointes à la volée (groupe, message direct)', async () => {
    const s2 = await open(s[2]);
    const st = await open(teacher);
    const convNew = next(s2, 'conversation:new', (p: { conversation: { kind: string } }) => p.conversation.kind === 'group');
    const teacherConv = next(st, 'conversation:new', (p: { conversation: { kind: string } }) => p.conversation.kind === 'group');
    const added = next(s2, 'notification', (p: { notification: { type: string } }) => p.notification.type === 'group_added');
    const g = await s[0].post(`/classrooms/${classroom.id}/groups`, { name: 'Live', memberIds: [s[2].user.id] }).expect(201);
    expect((await convNew).conversation).toMatchObject({ id: g.body.conversationId, kind: 'group', groupId: g.body.id, title: 'Live' });
    await teacherConv;
    await added;
    const msg = next(s2, 'message:new');
    await s[0].post(`/conversations/${g.body.conversationId}/messages`, { body: 'Bienvenue' }).expect(201);
    expect((await msg).message.body).toBe('Bienvenue');

    // Quitter le groupe : conversation retirée, plus de messages.
    const removed = next(s2, 'conversation:removed');
    await s[2].del(`/groups/${g.body.id}/members/${s[2].user.id}`).expect(204);
    expect(await removed).toEqual({ id: g.body.conversationId });

    const dm = next(s2, 'conversation:new', (p: { conversation: { kind: string } }) => p.conversation.kind === 'direct');
    const conv = await teacher.post('/conversations/direct', { userId: s[2].user.id }).expect(200);
    expect((await dm).conversation).toMatchObject({ id: conv.body.id, other: { id: teacher.user.id } });
    const dmMsg = next(s2, 'message:new');
    await teacher.post(`/conversations/${conv.body.id}/messages`, { body: 'Privé' }).expect(201);
    expect((await dmMsg).message.conversationId).toBe(conv.body.id);
  });

  it('verrou de projet : project:lock, project:lock-lost et project:saved', async () => {
    const g = await s[0].post(`/classrooms/${classroom.id}/groups`, { name: 'Verrou', memberIds: [s[1].user.id] }).expect(201);
    const p = await s[0].post(`/groups/${g.body.id}/projects`, { title: 'P', data: { v: 1 } }).expect(201);
    const s0 = await open(s[0]);
    const s1 = await open(s[1]);
    const locked = next(s1, 'project:lock', (e: { lock: unknown }) => e.lock !== null);
    await s[0].post(`/projects/${p.body.id}/lock`, {}).expect(200);
    expect((await locked).lock.userId).toBe(s[0].user.id);

    const lost = next(s0, 'project:lock-lost');
    const note = next(s0, 'notification', (e: { notification: { type: string } }) => e.notification.type === 'project_lock_taken');
    await s[1].post(`/projects/${p.body.id}/lock`, { force: true }).expect(200);
    expect(await lost).toEqual({ projectId: p.body.id, by: { id: s[1].user.id, displayName: s[1].user.displayName } });
    await note;

    const saved = next(s0, 'project:saved');
    const v = await s[1].post(`/projects/${p.body.id}/versions`, { data: { v: 2 }, baseVersionId: p.body.currentVersion.id }).expect(201);
    expect(await saved).toEqual({ projectId: p.body.id, groupId: g.body.id, version: v.body });
  });

  it('typing : au-delà de 10 par 10 s, ignorés sans erreur ; paquet trop gros : socket fermée', async () => {
    const st = await open(teacher);
    const s1 = await open(s[1]);
    let received = 0;
    st.on('typing', (p: { userId: string }) => {
      if (p.userId === s[1].user.id) received++;
    });
    for (let i = 0; i < 30; i++) s1.emit('typing', { conversationId: classConv });
    await new Promise((r) => setTimeout(r, 500));
    expect(received).toBe(10);
    expect(s1.connected).toBe(true);
    // maxHttpBufferSize (8 Ko) : un paquet de 20 Ko ferme la connexion.
    const gone = new Promise<string>((resolve) => s1.once('disconnect', resolve));
    s1.emit('typing', { conversationId: classConv, junk: 'x'.repeat(20 * 1024) });
    expect(await gone).toBe('transport close');
  });

  it('compte désactivé : sockets fermées', async () => {
    const s2 = await open(s[2]);
    const closed = new Promise((resolve) => s2.once('disconnect', resolve));
    await teacher.patch(`/users/${s[2].user.id}`, { disabled: true }).expect(200);
    await closed;
    await expect(connect(t, s[2].token)).rejects.toThrow('AUTH_DISABLED');
  });
});
