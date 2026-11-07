// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Test as NestTest } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';

export interface TestApp {
  app: NestExpressApplication;
  db: DataSource;
  port: number;
  close(): Promise<void>;
}

/** Application complète (même configuration que main.ts) sur un port libre ; base vidée. */
export async function createApp(): Promise<TestApp> {
  // Import tardif : la configuration lit process.env au chargement du module.
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/app.setup');
  const moduleRef = await NestTest.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: ['error', 'warn'] });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const db = app.get(DataSource);
  await truncate(db);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  return { app, db, port, close: () => app.close() };
}

export async function truncate(db: DataSource) {
  const [{ name }] = await db.query('SELECT current_database() AS name');
  // Garde-fou : on ne vide jamais une base qui n'est pas une base de test.
  if (!String(name).endsWith('_test')) throw new Error(`Refusing to truncate database "${name}"`);
  const tables: { tablename: string }[] = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`);
  await db.query(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export interface Session {
  token: string;
  refreshToken: string;
  user: any;
  school: any;
  get(path: string): request.Test;
  post(path: string, body?: unknown): request.Test;
  put(path: string, body?: unknown): request.Test;
  patch(path: string, body?: unknown): request.Test;
  del(path: string): request.Test;
}

export function anon(t: TestApp) {
  const server = t.app.getHttpServer();
  return {
    get: (path: string) => request(server).get(`/api/v1${path}`),
    post: (path: string, body?: unknown) => request(server).post(`/api/v1${path}`).send((body ?? {}) as object),
  };
}

export function session(t: TestApp, data: { accessToken: string; refreshToken: string; user: any; school: any }): Session {
  const server = t.app.getHttpServer();
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${data.accessToken}`);
  return {
    token: data.accessToken,
    refreshToken: data.refreshToken,
    user: data.user,
    school: data.school,
    get: (path) => auth(request(server).get(`/api/v1${path}`)),
    post: (path, body) => auth(request(server).post(`/api/v1${path}`)).send((body ?? {}) as object),
    put: (path, body) => auth(request(server).put(`/api/v1${path}`)).send((body ?? {}) as object),
    patch: (path, body) => auth(request(server).patch(`/api/v1${path}`)).send((body ?? {}) as object),
    del: (path) => auth(request(server).delete(`/api/v1${path}`)),
  };
}

export const uid = () => randomUUID().slice(0, 8);

export async function registerSchool(t: TestApp, name = 'École Test'): Promise<Session & { password: string }> {
  const password = 'motdepasse-solide';
  const res = await anon(t)
    .post('/auth/register-school', { schoolName: name, displayName: 'Awa Ndiaye', email: `admin-${uid()}@test.dev`, password })
    .expect(201);
  return Object.assign(session(t, res.body), { password });
}

export async function login(t: TestApp, loginName: string, password: string): Promise<Session> {
  const res = await anon(t).post('/auth/login', { login: loginName, password });
  if (res.status !== 200) throw new Error(`login ${loginName}: ${res.status} ${JSON.stringify(res.body)}`);
  return session(t, res.body);
}

/** Classe + élèves créés par l'enseignant, chacun connecté. */
export async function setupClass(t: TestApp, teacher: Session, count = 3, body: Record<string, unknown> = {}) {
  const c = await teacher.post('/classrooms', { name: `Classe ${uid()}`, ...body }).expect(201);
  const names = ['Moussa Diop', 'Fatou Sall', 'Ibrahima Fall', 'Aminata Ba', 'Cheikh Gueye', 'Khady Sarr', 'Ousmane Kane', 'Mariama Sy'];
  const created = await teacher
    .post(`/classrooms/${c.body.id}/students`, { students: Array.from({ length: count }, (_, i) => ({ displayName: names[i % names.length] })) })
    .expect(201);
  const students: Session[] = [];
  for (const s of created.body) students.push(await login(t, s.user.username, s.temporaryPassword));
  return { classroom: c.body, students };
}

export function connect(t: TestApp, token: string): Promise<Socket> {
  const socket = io(`http://127.0.0.1:${t.port}/rt`, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (e) => {
      socket.close();
      reject(e);
    });
  });
}

/** Prochain événement `event` (vérifiant `match`), sinon échec après `ms`. */
export function next<T = any>(socket: Socket, event: string, match: (p: T) => boolean = () => true, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, ms);
    const handler = (p: T) => {
      if (!match(p)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(p);
    };
    socket.on(event, handler);
  });
}

export const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
