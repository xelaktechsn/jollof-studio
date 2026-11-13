// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Espace classe (édition Pro seulement, chargé par main.js) : connexion, pages de l'élève, messagerie, groupes
// et projets partagés. Les outils de l'enseignant (dépôt privé, classroom/) s'y ajoutent.
import { tl } from '../i18n/index.js';
import { createHub } from './hub.js';
import { createSessions } from './session.js';
import { installStudent } from './student.js';
import { installChat } from './chat.js';
import { installGroups } from './groups.js';

export function installSchool(app) {
  const hub = createHub(app);
  const sessions = createSessions(app, hub);
  hub.sessions = sessions;
  hub.user = () => { try { return JSON.parse(localStorage.getItem('jollof-session') || 'null')?.user || null; } catch (e) { return null; } };
  installStudent(hub, sessions);
  installChat(hub);
  installGroups(hub, sessions);
  return { hub, sessions, afterStart: () => sessions.recover() };
}
