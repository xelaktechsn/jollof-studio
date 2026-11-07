// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Données de démonstration : `npm run seed` (ou `node dist/database/seed.js` dans le conteneur).
// Recrée l'école de démonstration à chaque passage ; les autres écoles ne sont pas touchées.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { AssignmentsService } from '../assignments/assignments.service';
import { SubmissionsService } from '../assignments/submissions.service';
import { AuthService } from '../auth/auth.service';
import type { Actor } from '../auth/actor';
import { ClassroomsService } from '../classrooms/classrooms.service';
import { GroupsService } from '../groups/groups.service';
import { MessagingService } from '../messaging/messaging.service';
import { ProjectsService } from '../projects/projects.service';
import { User } from './entities';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@demo.jollof.school';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'jollof-demo-2026';

const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

// Montage « LED et bouton » des exemples de l'application.
const LED_PROJECT = {
  app: 'jollof-studio',
  version: 1,
  name: 'LED et bouton sur breadboard',
  description: 'Arduino Uno, une LED avec sa résistance de 220 Ω et un bouton poussoir.',
  comps: [
    { id: 'uno_1', type: 'uno', name: 'UNO', x: 0, z: 0, r: 0 },
    { id: 'breadboard_1', type: 'breadboard', name: 'BB1', x: 0, z: 76, r: 0 },
    { id: 'res-220_1', type: 'res-220', name: 'R1', x: -36, z: 122, r: 0 },
    { id: 'led-red_1', type: 'led-red', name: 'LED1', x: -12, z: 122, r: 0 },
    { id: 'button_1', type: 'button', name: 'BTN1', x: 26, z: 122, r: 0, inp: { pressed: false } },
  ],
  wires: [
    { a: ['uno_1', 'GND (2)'], b: ['breadboard_1', 'T-3'], color: '#3a3f45', role: 'Masse vers le rail' },
    { a: ['breadboard_1', 'T-25'], b: ['breadboard_1', 'B-25'], color: '#3a3f45', role: 'Pont entre les rails −' },
    { a: ['uno_1', 'D7'], b: ['res-220_1', '1'], color: '#f2c94c', role: 'Commande' },
    { a: ['res-220_1', '2'], b: ['led-red_1', 'A'], color: '#f08a3c', role: 'Résistance série (Anode)' },
    { a: ['led-red_1', 'K'], b: ['breadboard_1', 'B-8'], color: '#3a3f45', role: 'Cathode vers la masse' },
    { a: ['uno_1', 'D2'], b: ['button_1', '1'], color: '#3b82f6', role: 'Entrée (INPUT_PULLUP)' },
    { a: ['button_1', '2'], b: ['breadboard_1', 'B-14'], color: '#3a3f45', role: 'Bouton vers la masse' },
  ],
  settings: { dur: 1.2 },
};

const STUDENTS = ['Moussa Diop', 'Fatou Sall', 'Ibrahima Fall', 'Aïssatou Diallo', 'Cheikh Gueye', 'Khady Sarr'];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const db = app.get(DataSource);
    const actor = async (id: string) => (await db.getRepository(User).findOneOrFail({ where: { id }, relations: { school: true } })) as Actor;

    const previous: { school_id: string }[] = await db.query('SELECT school_id FROM users WHERE email = $1', [ADMIN_EMAIL]);
    if (previous.length) await db.query('DELETE FROM schools WHERE id = $1', [previous[0].school_id]);

    const reg = await app.get(AuthService).registerSchool({
      schoolName: 'École de démonstration Jollof',
      displayName: 'Mariama Diallo',
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    // Démonstration sans échéance d'essai.
    await db.query(`UPDATE schools SET plan = 'pro', trial_ends_at = NULL WHERE id = $1`, [reg.school.id]);
    const teacher = await actor(reg.user.id);

    const classrooms = app.get(ClassroomsService);
    const classroom = await classrooms.create(teacher, { name: '4e B — Technologie', subject: 'Technologie', level: '4e', color: '#2a9d8f' });
    const created = await classrooms.addStudents(teacher, classroom.id, { students: STUDENTS.map((displayName) => ({ displayName })), requirePasswordChange: false });
    const students = await Promise.all(created.map((c) => actor(c.user.id)));

    const assignments = app.get(AssignmentsService);
    const exercise = await assignments.create(teacher, classroom.id, {
      kind: 'exercise',
      title: 'Allumer une LED avec l’Arduino',
      instructions: doc('Câblez une LED rouge sur la broche D7 de l’Uno, avec sa résistance de 220 Ω, puis répondez aux questions.'),
      items: [
        { id: 'intro', type: 'text', content: doc('Rappel : la patte longue de la LED est l’anode (A).') },
        {
          id: 'q1',
          type: 'choice',
          prompt: doc('Pourquoi place-t-on une résistance en série avec la LED ?'),
          options: [
            { id: 'a', text: 'Pour limiter le courant' },
            { id: 'b', text: 'Pour augmenter la tension' },
            { id: 'c', text: 'Pour que la LED clignote' },
          ],
          multiple: false,
          correct: ['a'],
          points: 2,
        },
        {
          id: 'q2',
          type: 'choice',
          prompt: doc('Quelles broches de l’Uno sont des masses ?'),
          options: [
            { id: 'a', text: 'GND' },
            { id: 'b', text: '5V' },
            { id: 'c', text: 'D7' },
          ],
          multiple: true,
          correct: ['a'],
          points: 2,
        },
        {
          id: 'c1',
          type: 'circuit',
          prompt: doc('Réalisez le montage : D7 → résistance → LED → GND.'),
          points: 6,
          solution: { nets: [['UNO.D7', 'R1.1'], ['R1.2', 'LED1.A'], ['LED1.K', 'UNO.GND']] },
          requireNoFaults: false,
        },
      ],
      starterProject: { app: 'jollof-studio', version: 1, name: 'Départ', comps: [{ id: 'uno_1', type: 'uno', name: 'UNO', x: 0, z: 0, r: 0 }], wires: [] },
      dueAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });
    await assignments.publish(teacher, exercise.id, undefined);

    // Une copie déjà envoyée, pour que le carnet de notes ne soit pas vide.
    const submissions = app.get(SubmissionsService);
    const sub = await submissions.start(students[0], exercise.id);
    await submissions.write(
      students[0],
      sub.id,
      { answers: { q1: { selected: ['a'] }, q2: { selected: ['a'] } }, circuit: { nets: [['UNO.D7', 'R1.1'], ['R1.2', 'LED1.A'], ['LED1.K', 'UNO.GND']], faults: 0 } },
      true,
    );

    const group = await app.get(GroupsService).create(students[0], classroom.id, { name: 'Équipe Volta', color: '#e76f51', memberIds: [students[1].id, students[2].id] });
    await app.get(ProjectsService).create(students[0], group.id, {
      title: 'LED et bouton',
      description: 'Notre premier montage partagé',
      data: LED_PROJECT,
      message: 'Première version',
    });

    const messaging = app.get(MessagingService);
    const classConv = (await messaging.list(teacher)).find((c) => c.kind === 'class')!;
    await messaging.post(teacher, classConv.id, { body: 'Bienvenue dans l’espace de la classe ! Le premier exercice est publié.' });
    await messaging.post(students[1], classConv.id, { body: 'Merci madame, on commence tout de suite.' });
    await messaging.post(students[0], group.conversationId!, { body: 'J’ai mis le montage de départ dans le projet du groupe.' });
    await messaging.post(students[2], group.conversationId!, { body: 'Super, je prends le verrou pour ajouter le bouton.' });

    const rows = [
      ['Rôle', 'Identifiant', 'Mot de passe'],
      ['Administrateur (enseignant)', ADMIN_EMAIL, ADMIN_PASSWORD],
      ...created.map((c) => [`Élève — ${c.user.displayName}`, c.user.username, c.temporaryPassword]),
    ];
    const w = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length)));
    console.log(`\nÉcole de démonstration créée (${reg.school.id}) : classe « ${classroom.name} », exercice publié, groupe « ${group.name} » et son projet.\n`);
    for (const r of rows) console.log(`  ${r.map((c, i) => c.padEnd(w[i])).join('   ')}`);
    console.log('');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
