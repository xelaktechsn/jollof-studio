// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { createApp, registerSchool, Session, setupClass, TestApp } from './helpers';

describe('Groupes de travail et projets partagés', () => {
  let t: TestApp;
  let teacher: Session;
  let classroom: { id: string; name: string };
  let s: Session[];

  beforeAll(async () => {
    t = await createApp();
    teacher = await registerSchool(t);
    ({ classroom, students: s } = await setupClass(t, teacher, 5, { settings: { maxGroupSize: 3 } }));
  });
  afterAll(() => t.close());

  const ids = (list: { id: string }[]) => list.map((x) => x.id);

  it('un élève crée un groupe : il en est propriétaire, la conversation existe, les membres sont prévenus', async () => {
    const g = await s[0].post(`/classrooms/${classroom.id}/groups`, { name: 'Les Ohms', memberIds: [s[1].user.id] }).expect(201);
    expect(g.body).toMatchObject({ name: 'Les Ohms', classroomId: classroom.id, classroomName: classroom.name, createdBy: s[0].user.id, projectCount: 0 });
    expect(g.body.members).toEqual([
      expect.objectContaining({ userId: s[0].user.id, role: 'owner' }),
      expect.objectContaining({ userId: s[1].user.id, role: 'member' }),
    ]);
    expect(g.body.conversationId).toBeTruthy();
    const note = (await s[1].get('/notifications')).body[0];
    expect(note).toMatchObject({ type: 'group_added', data: { groupId: g.body.id, groupName: 'Les Ohms', byName: s[0].user.displayName } });
    // La conversation du groupe : membres et enseignants.
    for (const who of [s[0], s[1], teacher]) {
      expect(ids((await who.get('/conversations')).body)).toContain(g.body.conversationId);
    }
    expect(ids((await s[2].get('/conversations')).body)).not.toContain(g.body.conversationId);
    expect((await s[2].get(`/conversations/${g.body.conversationId}/messages`)).status).toBe(403);

    // GET /groups/:id : membres et enseignants seulement.
    expect((await s[1].get(`/groups/${g.body.id}`).expect(200)).body.classroomName).toBe(classroom.name);
    await teacher.get(`/groups/${g.body.id}`).expect(200);
    expect((await s[2].get(`/groups/${g.body.id}`)).status).toBe(403);
    const outsider = await registerSchool(t, 'Ailleurs');
    expect((await outsider.get(`/groups/${g.body.id}`)).status).toBe(404);

    // Listes : l'enseignant voit tout, l'élève les siens.
    expect(ids((await teacher.get(`/classrooms/${classroom.id}/groups`)).body)).toEqual([g.body.id]);
    expect((await s[2].get(`/classrooms/${classroom.id}/groups`)).body).toEqual([]);
  });

  it('taille maximale, élèves de la classe seulement, droits du propriétaire', async () => {
    const g = await s[2].post(`/classrooms/${classroom.id}/groups`, { name: 'Trio', memberIds: [s[3].user.id] }).expect(201);
    const full = await s[2].post(`/groups/${g.body.id}/members`, { userIds: [s[4].user.id, s[0].user.id] });
    expect(full.status).toBe(409);
    expect(full.body.code).toBe('GROUP_FULL');
    expect((await s[2].post(`/classrooms/${classroom.id}/groups`, { name: 'Trop', memberIds: [s[0].user.id, s[1].user.id, s[3].user.id] })).body.code).toBe('GROUP_FULL');
    expect((await s[2].post(`/groups/${g.body.id}/members`, { userIds: [teacher.user.id] })).body.code).toBe('NOT_IN_CLASS');
    const added = await s[2].post(`/groups/${g.body.id}/members`, { userIds: [s[4].user.id] }).expect(200);
    expect(added.body.members).toHaveLength(3);
    expect((await s[4].get('/notifications')).body[0].type).toBe('group_added');

    // Un simple membre ne gère pas le groupe.
    expect((await s[3].patch(`/groups/${g.body.id}`, { name: 'Pirates' })).status).toBe(403);
    expect((await s[3].del(`/groups/${g.body.id}/members/${s[4].user.id}`)).status).toBe(403);
    expect((await s[2].patch(`/groups/${g.body.id}`, { name: 'Trio+', color: '#112233' }).expect(200)).body).toMatchObject({ name: 'Trio+', color: '#112233' });
    await teacher.patch(`/groups/${g.body.id}`, { name: 'Trio' }).expect(200);

    // Le propriétaire part : la propriété passe au plus ancien ; le dernier qui part supprime le groupe.
    await s[2].del(`/groups/${g.body.id}/members/${s[2].user.id}`).expect(204);
    const after = await s[3].get(`/groups/${g.body.id}`).expect(200);
    expect(after.body.members.find((m: { userId: string }) => m.userId === s[3].user.id).role).toBe('owner');
    await s[3].del(`/groups/${g.body.id}/members/${s[4].user.id}`).expect(204);
    await s[3].del(`/groups/${g.body.id}/members/${s[3].user.id}`).expect(204);
    expect((await teacher.get(`/groups/${g.body.id}`)).status).toBe(404);
  });

  it('groupes d’élèves désactivés ; l’enseignant forme et supprime des groupes', async () => {
    await teacher.patch(`/classrooms/${classroom.id}`, { settings: { allowStudentGroups: false } }).expect(200);
    const denied = await s[3].post(`/classrooms/${classroom.id}/groups`, { name: 'Interdit', memberIds: [] });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('GROUPS_DISABLED');
    const g = await teacher.post(`/classrooms/${classroom.id}/groups`, { name: 'Imposé', memberIds: [s[3].user.id, s[4].user.id] }).expect(201);
    expect(g.body.members.every((m: { role: string }) => m.role === 'member')).toBe(true);
    expect((await s[3].del(`/groups/${g.body.id}`)).status).toBe(403);
    await teacher.del(`/groups/${g.body.id}`).expect(204);
    expect((await s[3].get(`/groups/${g.body.id}`)).status).toBe(404);
    expect(ids((await s[3].get('/conversations')).body)).not.toContain(g.body.conversationId);
    await teacher.patch(`/classrooms/${classroom.id}`, { settings: { allowStudentGroups: true } }).expect(200);
  });

  it('élève retiré de la classe : il quitte aussi ses groupes', async () => {
    const g = await s[3].post(`/classrooms/${classroom.id}/groups`, { name: 'Éphémère', memberIds: [s[4].user.id] }).expect(201);
    await teacher.del(`/classrooms/${classroom.id}/members/${s[3].user.id}`).expect(204);
    const after = await teacher.get(`/groups/${g.body.id}`).expect(200);
    expect(after.body.members).toEqual([expect.objectContaining({ userId: s[4].user.id, role: 'owner' })]);
    await teacher.post(`/classrooms/${classroom.id}/members`, { userIds: [s[3].user.id] }).expect(200);
    await teacher.del(`/groups/${g.body.id}`).expect(204);
  });

  describe('projets', () => {
    let gid: string;
    let pid: string;
    let v1: { id: string; number: number };

    beforeAll(async () => {
      const g = await s[0].post(`/classrooms/${classroom.id}/groups`, { name: 'Projet LED', memberIds: [s[1].user.id] }).expect(201);
      gid = g.body.id;
    });

    it('création (version 1), lecture, versions', async () => {
      const p = await s[0].post(`/groups/${gid}/projects`, { title: 'Feu tricolore', description: 'Trois LED', data: { version: 1, parts: ['LED1'] }, message: 'Départ' }).expect(201);
      pid = p.body.id;
      expect(p.body).toMatchObject({ groupId: gid, title: 'Feu tricolore', description: 'Trois LED', lock: null });
      expect(p.body.currentVersion).toMatchObject({ number: 1, authorId: s[0].user.id, authorName: s[0].user.displayName, message: 'Départ' });
      expect(p.body.currentVersion.size).toBeGreaterThan(0);
      v1 = p.body.currentVersion;
      const empty = await s[1].post(`/groups/${gid}/projects`, { title: 'Vide' }).expect(201);
      expect(empty.body.currentVersion).toBeNull();
      expect((await teacher.post(`/groups/${gid}/projects`, { title: 'Prof' })).status).toBe(403);
      expect((await s[2].get(`/projects/${pid}`)).status).toBe(403);
      await teacher.get(`/projects/${pid}`).expect(200);
      expect((await s[0].get(`/groups/${gid}/projects`)).body).toHaveLength(2);
      expect((await s[0].get(`/groups/${gid}`)).body.projectCount).toBe(2);
      const cur = await s[1].get(`/projects/${pid}/versions/current`).expect(200);
      expect(cur.body).toMatchObject({ id: v1.id, number: 1, data: { version: 1, parts: ['LED1'] } });
      expect((await s[1].get(`/projects/${pid}/versions/nope`)).body.code).toBe('VALIDATION');
      expect((await s[1].patch(`/projects/${pid}`, { title: 'Feu' }).expect(200)).body.title).toBe('Feu');
    });

    it('verrou : pris, refusé (423), forcé, renouvelé, libéré', async () => {
      const lock = await s[0].post(`/projects/${pid}/lock`, {}).expect(200);
      expect(lock.body).toMatchObject({ userId: s[0].user.id, displayName: s[0].user.displayName });
      const ttl = new Date(lock.body.expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(110_000);
      expect(ttl).toBeLessThanOrEqual(120_000);
      expect((await s[0].get(`/projects/${pid}`)).body.lock.userId).toBe(s[0].user.id);

      const refused = await s[1].post(`/projects/${pid}/lock`, {});
      expect(refused.status).toBe(423);
      expect(refused.body).toMatchObject({ code: 'LOCKED', lock: { userId: s[0].user.id } });
      expect((await s[1].post(`/projects/${pid}/versions`, { data: { x: 1 }, baseVersionId: v1.id })).body.code).toBe('LOCK_REQUIRED');
      expect((await teacher.post(`/projects/${pid}/lock`, {})).status).toBe(403);

      // Reprise forcée : l'ancien détenteur est prévenu et perd le droit d'écrire.
      const taken = await s[1].post(`/projects/${pid}/lock`, { force: true }).expect(200);
      expect(taken.body.userId).toBe(s[1].user.id);
      const note = (await s[0].get('/notifications')).body[0];
      expect(note).toMatchObject({ type: 'project_lock_taken', data: { projectId: pid, byName: s[1].user.displayName } });
      expect((await s[0].post(`/projects/${pid}/lock/renew`)).body.code).toBe('LOCK_REQUIRED');
      expect((await s[0].post(`/projects/${pid}/versions`, { data: { x: 1 }, baseVersionId: v1.id })).body.code).toBe('LOCK_REQUIRED');
      const renewed = await s[1].post(`/projects/${pid}/lock/renew`).expect(200);
      expect(new Date(renewed.body.expiresAt).getTime()).toBeGreaterThanOrEqual(new Date(taken.body.expiresAt).getTime());
      // Un membre qui ne détient pas le verrou ne le libère pas.
      expect((await s[0].del(`/projects/${pid}/lock`)).status).toBe(403);
    });

    it('versions : écriture, conflit, restauration, taille maximale', async () => {
      expect((await s[1].post(`/projects/${pid}/versions`, { data: { x: 1 } })).body.code).toBe('VALIDATION');
      const v2 = await s[1].post(`/projects/${pid}/versions`, { data: { version: 2, parts: ['LED1', 'LED2'] }, baseVersionId: v1.id, message: 'Deuxième LED' }).expect(201);
      expect(v2.body).toMatchObject({ number: 2, authorId: s[1].user.id, message: 'Deuxième LED' });
      const conflict = await s[1].post(`/projects/${pid}/versions`, { data: { x: 3 }, baseVersionId: v1.id });
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({ code: 'VERSION_CONFLICT', current: { id: v2.body.id, number: 2 } });
      expect((await s[1].post(`/projects/${pid}/versions`, { data: { x: 3 }, baseVersionId: null })).body.code).toBe('VERSION_CONFLICT');

      const restored = await s[1].post(`/projects/${pid}/versions/${v1.id}/restore`).expect(201);
      expect(restored.body.number).toBe(3);
      expect((await s[0].get(`/projects/${pid}/versions/current`)).body.data).toEqual({ version: 1, parts: ['LED1'] });
      const list = await s[0].get(`/projects/${pid}/versions`).expect(200);
      expect(list.body.map((v: { number: number }) => v.number)).toEqual([3, 2, 1]);
      expect(list.body[0].data).toBeUndefined();

      const huge = await s[1].post(`/projects/${pid}/versions`, { data: { blob: 'x'.repeat(5 * 1024 * 1024 + 10) }, baseVersionId: restored.body.id });
      expect(huge.status).toBe(413);
      expect(huge.body.code).toBe('PAYLOAD_TOO_LARGE');
      expect((await s[0].get(`/projects/${pid}`)).body.currentVersion.number).toBe(3);
    });

    it('libération par l’enseignant et suppression', async () => {
      await teacher.del(`/projects/${pid}/lock`).expect(204);
      expect((await s[0].get(`/projects/${pid}`)).body.lock).toBeNull();
      await s[0].post(`/projects/${pid}/lock`, {}).expect(200);
      await s[0].del(`/projects/${pid}/lock`).expect(204);
      expect((await s[1].del(`/projects/${pid}`)).status).toBe(403);
      await s[0].del(`/projects/${pid}`).expect(204);
      expect((await s[0].get(`/projects/${pid}`)).status).toBe(404);
    });
  });
});
