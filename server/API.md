# Jollof Studio — API de l'espace classe (contrat)

Serveur NestJS + PostgreSQL, **source unique de vérité** des écoles, classes, comptes, devoirs,
copies, groupes, projets partagés, messages et notifications. Plusieurs écoles sur un même serveur
(chaque école est isolée). Les élèves utilisent l'édition gratuite (connexion), les enseignants
l'édition Pro.

## Conventions

- Base : `/api/v1`. JSON (UTF-8). Identifiants : UUID v4. Dates : ISO 8601 (UTC).
- Authentification : `Authorization: Bearer <accessToken>` (JWT, 15 min). Jeton de
  rafraîchissement opaque (30 jours, à usage unique, stocké haché).
- Erreurs : `{ "statusCode": 403, "code": "FORBIDDEN", "message": "…" }`. Le client affiche un texte
  traduit d'après `code` ; `message` (anglais) sert au débogage. Codes : `VALIDATION`,
  `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_INVALID`, `AUTH_DISABLED`, `FORBIDDEN`, `NOT_FOUND`,
  `PLAN_REQUIRED`, `EMAIL_TAKEN`, `USERNAME_TAKEN`, `NOT_IN_CLASS`, `ASSIGNMENT_CLOSED`,
  `ATTEMPTS_EXHAUSTED`, `PAST_DUE`, `TIME_UP`, `SUBMISSION_LOCKED`, `LOCKED`, `LOCK_REQUIRED`,
  `VERSION_CONFLICT`, `GROUPS_DISABLED`, `GROUP_FULL`, `POSTING_DISABLED`, `EDIT_WINDOW_PASSED`,
  `FILE_TOO_LARGE`, `FILE_TYPE`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INTERNAL` (erreur 500 imprévue).
- `RATE_LIMITED` (429) porte toujours `retryAfter` (secondes avant un nouvel essai), aussi dans
  l'en-tête `Retry-After` : `{ "statusCode": 429, "code": "RATE_LIMITED", "message": "…", "retryAfter": 15 }`.
- Contenu riche (consignes, questions, commentaires) : document **TipTap/ProseMirror JSON**
  (`{ "type": "doc", "content": [...] }`), stocké tel quel (jsonb), 200 Ko max. Nœuds admis :
  doc, paragraph, text, heading (1-3), bulletList, orderedList, listItem, taskList, taskItem,
  blockquote, codeBlock, horizontalRule, hardBreak, image (src = URL de fichier du serveur) ;
  marques : bold, italic, underline, strike, code, link (http/https), highlight, textStyle.
  Le serveur refuse (`VALIDATION`) tout autre type de nœud/marque ou un lien non http(s).
- Projet Jollof : le JSON d'un fichier `.jollof` (objet), 5 Mo max (`PAYLOAD_TOO_LARGE`).
- Liaisons d'un circuit (`nets`) : liste de groupes de broches `"REPERE.BROCHE"`, ex.
  `[["LED1.A","R1.2"],["BTN1.1","UNO.D2"]]`. Calculées par l'application.

## Rôles et forfait

- `admin` (administrateur de l'école, aussi enseignant), `teacher`, `student`.
- École : `plan` = `trial` (essai, `trialEndsAt`) | `pro` | `expired`. Les actions
  **enseignant** (créer classes, comptes, devoirs, corriger) exigent `trial` non échu ou `pro`,
  sinon `PLAN_REQUIRED`. Lecture et messagerie restent permises.
- Isolation : un utilisateur ne voit jamais les données d'une autre école (`NOT_FOUND`).

## Objets

```
User        { id, schoolId, role, displayName, username, email|null, avatarColor, mustChangePassword, lastSeenAt|null, createdAt, disabled }
School      { id, name, plan, trialEndsAt|null, createdAt }
Member      { userId, displayName, username|null, role: 'teacher'|'student', avatarColor, lastSeenAt|null, online }
              (username : visible des enseignants seulement, null pour les élèves)
Classroom   { id, name, subject|null, level|null, color, archived, settings, myRole, studentCount, teachers: [{id, displayName}], createdAt }
  settings  { allowStudentGroups: true, maxGroupSize: 6, allowStudentDirectMessages: false }
Assignment  { id, classroomId, classroomName, classroomColor, authorId, kind: 'exercise'|'evaluation', title, instructions: Doc|null,
              items: Item[], starterProject: Project|null, hasStarterProject: bool, settings, status: 'draft'|'published'|'closed',
              audience: { all: true } | { all: false, userIds: [] }, dueAt|null, publishedAt|null,
              totalPoints, createdAt, updatedAt,
              stats?: { targeted, started, submitted, graded }        (enseignant)
              mySubmission?: SubmissionSummary|null }                   (élève)
              (listes et événement temps réel : `starterProject: null`, `hasStarterProject` dit s'il existe ;
               le montage se lit par GET /assignments/:id)
  settings  { maxAttempts: 1 (0 = illimité), showResults: 'immediately'|'after_return'|'never',
              timeLimitMinutes: null|int, allowLate: false, faultPenalty: 10 (en % des points de l'item, par erreur de câblage) }
Item =
  { id, type: 'text',    content: Doc }                                                    (0 point)
  { id, type: 'choice',  prompt: Doc, options: [{ id, text }], multiple: bool, correct: [optionId], points }
  { id, type: 'open',    prompt: Doc, points, rubric: Doc|null }                           (corrigé par l'enseignant)
  { id, type: 'circuit', prompt: Doc, points, solution: { nets: string[][] }, requireNoFaults: bool }
  (côté élève, `correct`, `solution` et `rubric` sont retirés ; `correct` est rendu à l'élève
   seulement quand sa copie est rendue (`returned`) et que showResults ≠ 'never')
Submission  { id, assignmentId, studentId, studentName, attempt, status: 'in_progress'|'submitted'|'graded'|'returned',
              answers: { [itemId]: { selected: [optionId] } | { doc: Doc } },
              project: Project|null, circuit: { nets: string[][], faults: int }|null,
              itemScores: { [itemId]: { points, max, auto: bool, comment: string|null, detail?: object } },
              score|null, maxScore, feedback: Doc|null, late, deadlineAt|null,
              startedAt, submittedAt|null, gradedAt|null, returnedAt|null }
  (élève : `itemScores`, `score`, `feedback` visibles si showResults = 'immediately' et statut ≥ graded,
   ou si statut = 'returned' et showResults ≠ 'never' ; sinon null / {})
SubmissionSummary { id, attempt, status, score|null, maxScore, submittedAt|null, late }
Group       { id, classroomId, classroomName, name, color, createdBy, members: [{ userId, displayName, avatarColor, role: 'owner'|'member' }], projectCount, conversationId, createdAt }
SharedProject { id, groupId, title, description|null, currentVersion: VersionMeta|null, lock: Lock|null, createdAt, updatedAt }
VersionMeta { id, number, authorId, authorName, message|null, size, createdAt }
Lock        { userId, displayName, expiresAt }
Conversation { id, kind: 'class'|'group'|'direct', classroomId|null, groupId|null, title, other: {id, displayName, avatarColor, role}|null,
               settings: { studentsCanPost: true }, lastMessage: Message|null, unreadCount, updatedAt }
Message     { id, conversationId, sender: { id, displayName, avatarColor, role }, body|null, attachments: FileRef[], createdAt, editedAt|null, deleted }
FileRef     { id, name, mime, size, url }        url = "/api/v1/files/<id>/<key>" (clé aléatoire : lien non devinable)
Notification { id, type, data, readAt|null, createdAt }
AuditEntry  { id (chaîne), action, actor: { id, displayName }|null, targetType: 'user'|'school'|'classroom'|'assignment'|'project'|null,
              targetId|null, details: object, createdAt }   (voir « Journal d'audit »)
  types : assignment_published, submission_received (enseignant), submission_graded, submission_returned,
          group_added, project_lock_taken.   data : identifiants + libellés utiles (classroomName, assignmentTitle, groupName, byName…)
```

## Points et correction automatique (à l'envoi d'une copie)

- `choice` : sélection exactement égale à `correct` → tous les points, sinon 0.
- `circuit` : pour chaque liaison attendue, juste si toutes ses broches sont dans **une même**
  liaison de la copie et que cette liaison ne contient aucune broche d'une **autre** liaison
  attendue. `points × justes / attendues`, moins `faultPenalty %` des points par erreur de
  câblage (`circuit.faults`), plancher 0, arrondi à 0,5. Si `requireNoFaults` et `faults > 0` : 0.
  `detail` : `{ ok, total, missing: [[…]], extra: […] }`.
- `open` : `points: null` jusqu'à la correction de l'enseignant.
- Statut après envoi : `graded` s'il n'y a aucun item `open`, sinon `submitted`. `score` = somme des
  points connus (null s'il reste un item `open` non corrigé).
- Délai : avec `timeLimitMinutes`, `deadlineAt = startedAt + limite` ; une sauvegarde après
  l'échéance envoie la copie (contenu déjà enregistré) et répond `409 TIME_UP`. Après `dueAt` :
  `start` refusé (`PAST_DUE`) sauf `allowLate` (copie marquée `late`).

## Points d'accès

### Authentification et compte
| Méthode | Chemin | Qui | Corps → Réponse |
|---|---|---|---|
| POST | /auth/register-school | public | `{schoolName, displayName, email, password}` → `{accessToken, refreshToken, user, school}` (école en essai 30 jours, utilisateur `admin`) |
| POST | /auth/login | public (10/min/IP, et par compte) | `{login, password}` (login = email ou nom d'utilisateur, insensible à la casse) → `{accessToken, refreshToken, user, school}` ; trop d'échecs : `429 RATE_LIMITED` + `retryAfter` (voir « Protection des comptes ») |
| POST | /auth/refresh | public | `{refreshToken}` → nouvelle paire (l'ancien jeton est révoqué ; réutiliser un jeton révoqué révoque toute la famille) |
| POST | /auth/logout | public | `{refreshToken}` → 204 |
| GET | /me | connecté | → `{user, school}` |
| PATCH | /me | connecté | `{displayName?, avatarColor?}` → `User` |
| POST | /me/password | connecté | `{currentPassword, newPassword (≥ 8)}` → 204, `mustChangePassword=false` ; les **autres** sessions sont fermées (jetons et sockets), celle-ci reste : son jeton d'accès répond ensuite 401 et se renouvelle par `/auth/refresh` |
| GET | /me/assignments | connecté | élève : devoirs publiés qui le visent, toutes classes (`Assignment` + `mySubmission` + `classroomName`), tri échéance ; enseignant : devoirs de ses classes avec `stats`, ceux à corriger d'abord |

### École (administrateur)
| GET | /school/teachers | admin | → `User[]` |
| POST | /school/teachers | admin | `{displayName, email}` → `{user, temporaryPassword}` (`mustChangePassword=true`) |
| PATCH | /school | admin | `{name}` → `School` |
| GET | /school/audit | admin | `?limit=100` (1-500) `&before=<id>` (entrée suivante après celle-ci) → `AuditEntry[]` (récent d'abord) |
| POST | /users/:id/reset-password | admin (enseignants, élèves) ; enseignant (élèves de ses classes) | → `{temporaryPassword}` ; toutes les sessions du compte tombent aussitôt (jetons d'accès et de rafraîchissement, sockets) et son blocage de connexion est levé |
| PATCH | /users/:id | idem | `{displayName?, disabled?}` → `User` (un compte désactivé ne peut plus se connecter : `AUTH_DISABLED` ; ses sessions tombent comme ci-dessus) |

### Classes
| GET | /classrooms | connecté | → `Classroom[]` (les miennes ; `?archived=true` pour les archivées) |
| POST | /classrooms | enseignant | `{name, subject?, level?, color?, settings?}` → `Classroom` (crée aussi la conversation de classe) |
| GET | /classrooms/:id | membre | → `Classroom & { members: Member[] }` |
| PATCH | /classrooms/:id | enseignant de la classe | `{name?, subject?, level?, color?, archived?, settings?}` → `Classroom` |
| POST | /classrooms/:id/students | enseignant de la classe | `{students: [{displayName, username?}], requirePasswordChange?: false}` (1 à 200) → `[{user, temporaryPassword}]` : comptes créés et inscrits. Nom d'utilisateur : `prenom.nom` sans accents, suffixe numérique si pris |
| POST | /classrooms/:id/members | enseignant de la classe | `{userIds}` (élèves ou enseignants de l'école) → `Member[]` |
| DELETE | /classrooms/:id/members/:userId | enseignant de la classe | → 204 (le compte reste) |
| GET | /classrooms/:id/grades | membre | → `{ assignments: [{id, title, kind, totalPoints, dueAt}], students: [{id, displayName}], cells: { [studentId]: { [assignmentId]: SubmissionSummary|{status:'not_started'} } } }` (élève : sa ligne seulement) |

Mot de passe provisoire : deux mots simples sans accents + 3 chiffres (ex. `lune-sable-482`).

### Devoirs (exercices et évaluations)
| GET | /classrooms/:id/assignments | membre | enseignant : tous (+`stats`) ; élève : publiés/clos qui le visent (+`mySubmission`) |
| POST | /classrooms/:id/assignments | enseignant de la classe | `{kind, title, instructions?, items?, starterProject?, settings?, audience?, dueAt?}` → `Assignment` (brouillon) |
| GET | /assignments/:id | membre visé ou enseignant | → `Assignment` (vue élève expurgée) |
| PATCH | /assignments/:id | enseignant de la classe | mêmes champs → `Assignment` |
| POST | /assignments/:id/publish | enseignant de la classe | `{dueAt?}` → `Assignment` ; notifie les élèves visés |
| POST | /assignments/:id/close | enseignant de la classe | → `Assignment` (plus de nouvelles copies ; les copies en cours sont envoyées) |
| POST | /assignments/:id/duplicate | enseignant | `{classroomId?}` → `Assignment` (brouillon) |
| DELETE | /assignments/:id | enseignant de la classe | → 204 (copies supprimées) |

### Copies
| POST | /assignments/:id/start | élève visé | → `Submission` (reprend la copie en cours, sinon nouvelle tentative ; `ASSIGNMENT_CLOSED`, `ATTEMPTS_EXHAUSTED`, `PAST_DUE`) |
| PUT | /submissions/:id | élève propriétaire, statut `in_progress` | `{answers?, project?, circuit?}` (fusion) → `Submission` (`SUBMISSION_LOCKED`, `TIME_UP`) |
| POST | /submissions/:id/submit | élève propriétaire | `{answers?, project?, circuit?}` → `Submission` corrigée automatiquement ; notifie les enseignants |
| GET | /assignments/:id/submissions | enseignant de la classe | → une ligne par élève visé : dernière tentative `Submission` (avec `project: null` : le montage se lit par GET /submissions/:id) ou `{studentId, studentName, status:'not_started'}` |
| GET | /submissions/:id | enseignant de la classe ou élève propriétaire | → `Submission` (règles de visibilité ci-dessus) |
| GET | /assignments/:id/my-submissions | élève | → `Submission[]` (toutes ses tentatives ; `project` de la dernière seulement, `null` pour les précédentes : GET /submissions/:id les donne) |
| POST | /submissions/:id/grade | enseignant de la classe | `{itemScores?: {[itemId]: {points, comment?}}, feedback?: Doc, return?: bool}` → `Submission` (`graded`, ou `returned` si `return`) ; notifie l'élève quand rendue |

### Groupes de travail
| GET | /classrooms/:id/groups | membre | enseignant : tous ; élève : les siens |
| GET | /groups/:id | membre du groupe ou enseignant de la classe | → `Group` |
| POST | /classrooms/:id/groups | élève (si `allowStudentGroups`) ou enseignant | `{name, color?, memberIds: []}` (élèves de la classe ; le créateur élève est `owner`) → `Group` ; crée la conversation du groupe ; notifie (`group_added`) |
| PATCH | /groups/:id | propriétaire ou enseignant | `{name?, color?}` → `Group` |
| POST | /groups/:id/members | propriétaire ou enseignant | `{userIds}` → `Group` (`GROUP_FULL`, `NOT_IN_CLASS`) |
| DELETE | /groups/:id/members/:userId | propriétaire, enseignant, ou soi-même (quitter) | → 204 (le dernier membre qui part supprime le groupe ; le propriétaire qui part transmet la propriété au plus ancien) |
| DELETE | /groups/:id | propriétaire ou enseignant | → 204 |

### Projets partagés (versions et verrou)
| GET | /groups/:id/projects | membre du groupe ou enseignant de la classe | → `SharedProject[]` |
| POST | /groups/:id/projects | membre du groupe | `{title, description?, data?, message?}` → `SharedProject` (version 1 si `data`) |
| GET | /projects/:id | idem | → `SharedProject` |
| PATCH | /projects/:id | membre | `{title?, description?}` → `SharedProject` |
| DELETE | /projects/:id | membre `owner` du groupe ou enseignant | → 204 |
| GET | /projects/:id/versions | idem | → `VersionMeta[]` (récent d'abord) |
| GET | /projects/:id/versions/:versionId | idem (`current` accepté) | → `VersionMeta & { data }` |
| POST | /projects/:id/lock | membre | `{force?: false}` → `Lock` (120 s). Pris par un autre et non expiré : `423 LOCKED` avec `lock` dans la réponse, sauf `force` (le précédent reçoit `project:lock-lost` et une notification `project_lock_taken`) |
| POST | /projects/:id/lock/renew | détenteur | → `Lock` (`LOCK_REQUIRED` si perdu) |
| DELETE | /projects/:id/lock | détenteur ou enseignant | → 204 |
| POST | /projects/:id/versions | détenteur du verrou | `{data, message?, baseVersionId|null}` → `VersionMeta` (`LOCK_REQUIRED` ; `409 VERSION_CONFLICT` si `baseVersionId` ≠ version courante) |
| POST | /projects/:id/versions/:versionId/restore | détenteur du verrou | → `VersionMeta` (nouvelle version identique à l'ancienne) |

### Messagerie
| GET | /conversations | connecté | → `Conversation[]` (classes, groupes, messages directs ; activité récente d'abord) |
| POST | /conversations/direct | connecté | `{userId}` → `Conversation` (créée au besoin). Permis : enseignant↔élève d'une classe commune ; enseignant↔enseignant de l'école ; élève↔élève d'une classe commune si `allowStudentDirectMessages` |
| GET | /conversations/:id/messages | membre | `?before=<messageId>&limit=50` (max 100) → `Message[]` (ordre chronologique) |
| POST | /conversations/:id/messages | membre | `{body (1-4000 caractères, texte), attachmentIds?: []}` → `Message` (`POSTING_DISABLED` pour un élève si `studentsCanPost=false` ; 20 messages par 10 s et par utilisateur, au-delà `429 RATE_LIMITED` + `retryAfter`) |
| PATCH | /messages/:id | auteur, 15 min | `{body}` → `Message` (`EDIT_WINDOW_PASSED`) |
| DELETE | /messages/:id | auteur ; enseignant de la classe (classe, groupe) | → 204 (effacement logique : `body=null, deleted=true`) |
| POST | /conversations/:id/read | membre | `{messageId}` → 204 |
| PATCH | /conversations/:id/settings | enseignant de la classe (conversation de classe) | `{studentsCanPost}` → `Conversation` |

Membres d'une conversation : classe = enseignants et élèves inscrits ; groupe = membres du groupe et
enseignants de la classe ; direct = les deux personnes.

### Fichiers
| POST | /files | connecté | multipart `file` (10 Mo ; images png/jpeg/gif/webp, pdf, texte, json, .jollof) → `FileRef` (`FILE_TOO_LARGE`, `FILE_TYPE`) |
| GET | /files/:id/:key | public (clé) | → contenu, `Content-Type`, `Cache-Control: private, max-age=31536000, immutable`, `Content-Disposition` (inline pour les images png/jpeg/gif/webp, attachment sinon), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox` |

### Notifications
| GET | /notifications | connecté | `?unread=true&limit=50` → `Notification[]` (récent d'abord) |
| POST | /notifications/read | connecté | `{ids?: [], all?: true}` → 204 |

### Exploitation
| GET | /health | public | → `{ok: true, db: true}` |
| POST | /platform/schools/:id/plan | en-tête `X-Platform-Key` = `PLATFORM_KEY` | `{plan, trialEndsAt?}` → `School` |

## Temps réel (Socket.IO)

Espace `/rt`, chemin `/socket.io`. Connexion : `io(url + '/rt', { auth: { token: accessToken } })`
(jeton refusé : déconnexion avec `connect_error` `AUTH_TOKEN_INVALID`). Le serveur place la
socket dans les salles `user:<id>`, `conv:<id>` (toutes ses conversations), `group:<id>`,
`class:<id>`, et la fait rejoindre les nouvelles salles quand ses appartenances changent.

Serveur → client :
- `message:new` `{message}` · `message:updated` `{message}` · `message:deleted` `{id, conversationId}`
- `typing` `{conversationId, userId, displayName}`
- `conversation:new` `{conversation}` · `conversation:removed` `{id}`
- `notification` `{notification}`
- `assignment:published` `{assignment}` (aux élèves visés) · `submission:updated` `{assignmentId, submission: SubmissionSummary & {studentId, studentName}}` (aux enseignants de la classe)
- `project:saved` `{projectId, groupId, version: VersionMeta}` · `project:lock` `{projectId, lock|null}` · `project:lock-lost` `{projectId, by: {id, displayName}}`
- `presence` `{userId, online}` (aux classes communes)

Client → serveur : `typing` `{conversationId}` (10 par 10 s et par utilisateur ; au-delà, ignorés sans
erreur). Un paquet de plus de 8 Ko ferme la connexion (`maxHttpBufferSize`).

## Protection des comptes

Les échecs de connexion sont comptés par identifiant saisi (courriel ou nom d'utilisateur, toutes
écoles confondues), **que le compte existe ou non** : mêmes réponses, même durée, rien ne trahit
l'existence d'un compte.

| Échecs consécutifs | Effet |
|---|---|
| 1 à 4 | `401 AUTH_INVALID_CREDENTIALS` |
| 5 à 9 | `401` pour l'essai, puis attente imposée avant le suivant : 15 s, 30 s, 1 min, 2 min, 4 min |
| 10 | blocage de 15 min (chaque nouvel échec le relance) |

Pendant une attente, toute tentative (même avec le bon mot de passe, qui n'est pas vérifié) répond
`429 RATE_LIMITED` avec `retryAfter`. Une connexion réussie remet le compteur à zéro ; les échecs
sont oubliés 24 h après le dernier ; réinitialiser le mot de passe (ou le changer) débloque le
compte. La limite par IP (10 essais par minute) s'applique en plus.

## Sessions et jetons

- Jeton d'accès : JWT **HS256 uniquement** (tout autre algorithme, `none` compris, est refusé),
  émetteur `jollof`, 15 min ; charge utile `{ sub, sch, typ: 'access', ver, fam }`. `ver` est la
  version des jetons du compte : changer ou réinitialiser le mot de passe, ou désactiver le compte,
  l'augmente et invalide aussitôt tous les jetons d'accès déjà émis (HTTP et Socket.IO). `fam`
  désigne la session (famille de jetons de rafraîchissement). Un jeton dont `sch` n'est pas l'école
  du compte est refusé.
- Le client renouvelle son jeton sur `401` (une fois) : c'est ce qui garde ouverte la session qui
  vient de changer son mot de passe.

## Journal d'audit

`GET /school/audit` (administrateur) : entrées de son école seulement, gardées 180 jours.

| action | cible | details |
|---|---|---|
| `school.created` | school | `{name}` |
| `user.created` | user (enseignant) ou classroom (lot d'élèves) | `{role, name, username}` ou `{role: 'student', count, classroomName, usernames}` |
| `user.password_reset`, `user.password_changed` | user | `{name}` |
| `user.disabled`, `user.enabled` | user | `{name}` |
| `classroom.archived`, `classroom.unarchived` | classroom | `{name}` |
| `assignment.published` (première publication) | assignment | `{title, kind, classroomId, classroomName}` |
| `assignment.deleted` | assignment | `{title, kind, status, classroomId, classroomName, submissions}` |
| `project.lock_taken` (reprise forcée) | project | `{title, groupId, groupName, fromUserId, fromName}` |
| `auth.login` | user | résumé du jour (UTC) : `{name, ok, failed, lastAt}`, une ligne par compte et par jour |
| `auth.locked` | user | `{name, failures}` : blocage de 15 min atteint |

`actor` est l'auteur de l'action (`null` pour `auth.*`). Aucun mot de passe ni secret n'y figure ;
les échecs sur un identifiant inconnu n'y figurent pas.

## Configuration

`DATABASE_URL`, `JWT_SECRET` (≥ 32 caractères), `CORS_ORIGINS` (liste séparée par des virgules ;
par défaut `http://localhost:1420,tauri://localhost,http://tauri.localhost,https://tauri.localhost`),
`PLATFORM_KEY`, `PORT` (3100), `TRIAL_DAYS` (30), `DB_POOL_SIZE` (10), `BCRYPT_COST` (12),
`BCRYPT_WORKERS`, `LOGIN_RATE_LIMIT` (10), `TRUST_PROXY` (false). En production, l'API refuse de
démarrer avec le `JWT_SECRET` d'exemple, un mot de passe de base par défaut ou trop court, ou une
`PLATFORM_KEY` de moins de 24 caractères (détails dans le README).

## Précisions et écarts du serveur

Ajouts au contrat d'origine (champs en plus : un client qui les ignore continue de fonctionner) :

- `GET /groups/:id` ; `classroomName` et `classroomColor` dans **toute** réponse `Assignment` (listes,
  détail, création, modification, publication, `/me/assignments`) ; `classroomName` dans `Group`.
- `User.disabled` (booléen). Code `INTERNAL` pour une erreur 500. `USERNAME_TAKEN` porte aussi
  `username` (le nom refusé). `/auth/refresh` renvoie aussi `user` et `school`.
- Temps réel : un compte désactivé est refusé avec `connect_error` `AUTH_DISABLED` (jeton invalide :
  `AUTH_TOKEN_INVALID`) ; ses sockets ouvertes sont fermées au moment de la désactivation.
- `/auth/register-school` est limité comme `/auth/login` (10/min/IP).
- `Assignment.hasStarterProject` ; dans les listes (`GET /classrooms/:id/assignments`, `GET /me/assignments`)
  et l'événement `assignment:published`, `starterProject` vaut `null` (GET /assignments/:id le donne).
- `GET /assignments/:id/my-submissions` : `project` seulement pour la dernière tentative.
- `RATE_LIMITED` porte `retryAfter` (+ en-tête `Retry-After`, exposé en CORS) ; nouvelles limites : par
  compte à la connexion, envoi de messages, indicateurs de frappe.
- `GET /school/audit` et l'objet `AuditEntry`.
- Réponses JSON d'au moins 1 Ko compressées (gzip) si le client l'accepte (`Accept-Encoding`).

Précisions de comportement :

- Statuts : `VALIDATION` 400, `NOT_IN_CLASS` 400, `AUTH_*` 401 (`AUTH_DISABLED` 403), `FORBIDDEN`,
  `PLAN_REQUIRED`, `GROUPS_DISABLED`, `POSTING_DISABLED`, `EDIT_WINDOW_PASSED` 403, `NOT_FOUND` 404,
  `*_TAKEN`, `ASSIGNMENT_CLOSED`, `ATTEMPTS_EXHAUSTED`, `PAST_DUE`, `TIME_UP`, `SUBMISSION_LOCKED`,
  `LOCK_REQUIRED`, `VERSION_CONFLICT`, `GROUP_FULL` 409, `FILE_TOO_LARGE`, `PAYLOAD_TOO_LARGE` 413,
  `FILE_TYPE` 415, `LOCKED` 423, `RATE_LIMITED` 429. Réussite : 201 pour register-school, classes,
  comptes (`/students`, `/school/teachers`), devoirs (création, duplication), groupes, projets,
  versions (création, restauration), messages et fichiers ; 204 quand rien n'est renvoyé ; 200 sinon
  (dont `/conversations/direct`, `start`, `submit`, `grade`, `lock`).
  `POST /me/password` avec un mauvais mot de passe actuel : 403 `AUTH_INVALID_CREDENTIALS` (pas 401,
  pour ne pas déclencher le rafraîchissement du client).
- Document riche de plus de 200 Ko : `PAYLOAD_TOO_LARGE`. Image : `src` = `/api/v1/files/<id>/<clé>`
  (chemin relatif ou URL absolue se terminant ainsi).
- Copie minutée : 10 s de marge réseau après `deadlineAt`. Un envoi (`submit`) après l'échéance part
  avec le contenu déjà enregistré et répond aussi `409 TIME_UP`. Les copies minutées abandonnées sont
  envoyées d'office (balayage toutes les 30 s, et à la consultation).
- `showResults` par défaut : `immediately` pour un exercice, `after_return` pour une évaluation.
- Vue élève : `audience` réduite à `{ all: false, userIds: [<soi>] }` quand le devoir est ciblé.
- `POST /submissions/:id/grade` : `return: true` exige que tous les items `open` soient notés
  (`VALIDATION`) ; sans `return`, le statut devient `graded` quand tout est noté (sinon reste
  `submitted`) ; une copie déjà rendue le reste. `submission_graded` est notifié quand la copie passe
  à `graded` par l'enseignant et que `showResults = 'immediately'`.
- Circuit, `detail.extra` : broches câblées dans la copie qui n'appartiennent à aucune liaison attendue
  (sans effet sur la note).
- Carnet de notes : la cellule montre la dernière tentative envoyée (sinon celle en cours) ; une
  cellule est absente si le devoir ne vise pas l'élève. `GET /me/assignments` ignore les classes
  archivées et inclut les devoirs clos.
- `POST /classrooms/:id/members` renvoie la liste complète des membres. Un élève retiré d'une classe
  quitte aussi ses groupes de cette classe ; la classe garde au moins un enseignant (`FORBIDDEN`).
- Groupe formé par un enseignant : pas de propriétaire (seuls les enseignants le gèrent) ; il faut au
  moins un membre.
- Verrou : `renew` et l'enregistrement d'une version restent permis tant que personne d'autre n'a
  repris le verrou, même juste après son expiration ; chaque version prolonge le verrou de 120 s.
  Libérer le verrou d'un autre (enseignant) lui envoie `project:lock-lost`. Version restaurée :
  `message` null.
- Messagerie : écrire un message vaut lecture de la conversation jusqu'à ce message. Dans un message
  direct, les règles d'autorisation sont revérifiées à chaque envoi (`FORBIDDEN` si elles ne tiennent
  plus). `sender.role` et `other.role` valent `teacher` ou `student` (un administrateur est `teacher`).
- Fichiers : le type vient du contenu (signatures png/jpeg/gif/webp/pdf) ; texte = `.txt .md .csv .log
  .ino .c .h .cpp .hpp .py` en UTF-8 ; `.json` et `.jollof` doivent être du JSON valide (`.jollof` :
  `application/vnd.jollof+json`). Une pièce jointe doit avoir été envoyée par l'auteur du message.
  HTML, SVG, JavaScript ou XML ne sont jamais acceptés (`FILE_TYPE`) ; seuls png/jpeg/gif/webp sont
  servis `inline` ; un type hors de la liste trouvé en base est servi en `application/octet-stream`,
  à télécharger.
