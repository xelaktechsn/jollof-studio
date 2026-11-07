// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Espace classe (édition gratuite et Pro) : connexion, pages de l'élève, messagerie, groupes et
// projets partagés. L'édition Pro y ajoute les outils de l'enseignant (src/pro/classroom).
import './school.css';
import { tl } from '../i18n/index.js';
import { createHub } from './hub.js';
import { createSessions } from './session.js';
import { installStudent } from './student.js';
import { installChat } from './chat.js';
import { installGroups } from './groups.js';
import { icon, empty } from './ui.js';

export function installSchool(app, { pro = false } = {}) {
  const hub = createHub(app, { pro });
  const sessions = createSessions(app, hub);
  hub.sessions = sessions;
  hub.user = () => { try { return JSON.parse(localStorage.getItem('jollof-session') || 'null')?.user || null; } catch (e) { return null; } };
  installStudent(hub, sessions);
  installChat(hub);
  installGroups(hub, sessions);
  // Enseignant connecté avec l'édition gratuite : messagerie et groupes, et l'invitation à passer à Pro.
  hub.nav('home', tl('Accueil'), 'school', ['teacher'], 10);
  hub.page('home', ctx => {
    ctx.head(tl('Espace enseignant'));
    ctx.el.innerHTML = `<div class="proUpsell">${empty('sparkle', tl('Les outils enseignant sont dans Jollof Studio Pro'), tl('Créer des classes et des comptes élèves, rédiger des exercices et des évaluations en texte enrichi, les envoyer, corriger et suivre les notes : installez l’édition Pro. La messagerie et les groupes restent disponibles ici.'), `<button type="button" class="btn primary" data-go="messages">${icon('message')}<span>${tl('Ouvrir la messagerie')}</span></button>`)}</div>`;
  }, { roles: ['teacher'] });
  return { hub, sessions, afterStart: () => sessions.recover() };
}
