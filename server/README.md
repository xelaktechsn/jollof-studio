# Jollof Studio — serveur de l'espace classe

API NestJS 11 + PostgreSQL 16 de l'espace classe de Jollof Studio : écoles, classes, comptes,
devoirs (exercices et évaluations) avec correction automatique, copies, groupes de travail, projets
partagés (versions et verrou), messagerie, fichiers, notifications et temps réel (Socket.IO).

Le contrat suivi par l'application de bureau est dans [`API.md`](API.md) (sa dernière section liste
les précisions et écarts propres au serveur).

Deux façons de l'héberger :

- **dans le cloud** (un serveur sur Internet, derrière HTTPS) : [Déploiement cloud](#déploiement-cloud-https) ;
- **sur un « boîtier école »** (vieux PC, mini-PC ou Raspberry Pi 4/5 de 1 à 2 Go, sur le réseau
  local, sans Internet obligatoire) : [Boîtier école](#boîtier-école-pas-à-pas).

## Démarrage local (développement)

Prérequis : Node 22, Docker.

```sh
cd server
cp .env.example .env
# Dans .env : JWT_SECRET aléatoire (openssl rand -base64 48), POSTGRES_PASSWORD=jollof, et
# COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml (base exposée sur le port 5433).
docker compose up -d db           # PostgreSQL 16 sur le port 5433 de l'hôte (bases jollof et jollof_test)
npm ci
npm run start:dev                 # API sur http://localhost:3100/api/v1, temps réel sur /rt
npm run seed                      # école de démonstration (identifiants affichés)
```

Les migrations en attente passent au démarrage de l'API ; `npm run migration:run` les applique sans
démarrer le serveur.

L'API conteneurisée (`docker compose up -d`) écoute aussi sur le port 3100 : arrêter l'une
(`docker compose stop api`) avant de lancer l'autre. Avec `docker-compose.dev.yml`, l'API du
conteneur tourne en mode développement (les contrôles de secrets de production ne s'appliquent pas).

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | — (obligatoire) | `postgres://utilisateur:mot-de-passe@hôte:port/base` |
| `DATABASE_SSL` | `false` | `true` (certificat vérifié) ou `no-verify` (base gérée à certificat auto-signé) |
| `DB_POOL_SIZE` | `10` | connexions à la base (5 sur le boîtier : chacune coûte 5 à 10 Mo à PostgreSQL) |
| `JWT_SECRET` | — (obligatoire, ≥ 32 caractères) | signature des jetons d'accès (HS256, 15 min) |
| `CORS_ORIGINS` | `http://localhost:1420,tauri://localhost,http://tauri.localhost,https://tauri.localhost` | origines autorisées (HTTP et Socket.IO) |
| `PLATFORM_KEY` | vide (route désactivée) | clé de `POST /platform/schools/:id/plan` (en-tête `X-Platform-Key`), 24 caractères au moins |
| `PORT` | `3100` | port HTTP |
| `TRIAL_DAYS` | `30` | durée de l'essai d'une nouvelle école |
| `BCRYPT_COST` | `12` | coût bcrypt des mots de passe (11 sur le boîtier) |
| `BCRYPT_WORKERS` | cœurs − 1 (1 à 4) | workers bcrypt, ~10 Mo chacun, créés à la demande (2 sur le boîtier) |
| `LOGIN_RATE_LIMIT` | `10` | connexions (et inscriptions d'école) par minute et par IP |
| `TRUST_PROXY` | `false` | voir ci-dessous |
| `TEST_DATABASE_URL` | `postgres://jollof:jollof@localhost:5433/jollof_test` | base des tests e2e (variable du shell : les tests ignorent `.env`) |

Pour Docker seulement (lues par `docker compose`, dans `.env`) : `POSTGRES_PASSWORD` (obligatoire),
`COMPOSE_FILE`, `API_BIND` (adresse d'écoute sur l'hôte), `API_PORT` (3100), `API_HEAP_MB` (tas
JavaScript : 384 en cloud, 192 sur le boîtier), `JOLLOF_IMAGE` (image de l'API), et pour le boîtier
`BACKUP_HOUR` (2), `BACKUP_KEEP` (14), `BACKUP_HOST_DIR` (`./backups`), `TZ` (`Africa/Dakar`).

Le fichier `.env` n'est lu ni par les tests ni en production si les variables sont déjà définies
(l'environnement l'emporte).

**`TRUST_PROXY`.** Par défaut (`false`), l'adresse IP d'un client est celle de la connexion et
l'en-tête `X-Forwarded-For` est ignoré : un client ne peut pas se faire passer pour un autre pour
échapper à la limite de connexions par IP. Derrière un proxy inverse (Caddy, nginx), toutes les
requêtes arrivent du proxy : mettre `TRUST_PROXY=1` (un proxy ; `2` s'il y en a deux, par exemple
CDN + nginx), ou la liste des adresses des proxys (`loopback, 10.0.0.0/8`). L'adresse retenue est
alors la dernière ajoutée par un proxy de confiance, pas celle que le client aurait écrite.
`TRUST_PROXY=true` (tout croire) est accepté mais déconseillé : un avertissement s'affiche au
démarrage.

**Secrets en production.** Avec `NODE_ENV=production` (images Docker), l'API **refuse de démarrer**
si `JWT_SECRET` est celui de `.env.example` (ou contient « change-me », ou compte moins de 12
caractères différents), si le mot de passe de `DATABASE_URL` est absent, par défaut (`jollof`,
`postgres`, `password`…) ou fait moins de 12 caractères, ou si `PLATFORM_KEY` est définie avec moins
de 24 caractères. Le message liste tout ce qui ne va pas.

```sh
openssl rand -base64 48     # JWT_SECRET
openssl rand -hex 24        # POSTGRES_PASSWORD (hexadécimal : rien à échapper dans l'URL)
openssl rand -hex 24        # PLATFORM_KEY
```

## Migrations

Le schéma n'évolue que par migrations TypeORM (`synchronize` désactivé), dans
`src/database/migrations`.

```sh
npm run migration:run                                         # appliquer
npm run migration:revert                                      # annuler la dernière
npm run migration:generate -- src/database/migrations/NomDuChangement   # après modification des entités
```

Dans le conteneur (inutile en temps normal, l'API les applique au démarrage ; l'image ne contient
pas npm) : `docker compose exec api node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js`.

## Données de démonstration

`npm run seed` (ou `docker compose exec api node dist/database/seed.js`) recrée l'école
« École de démonstration Jollof » (forfait Pro) : une administratrice, la classe « 4e B —
Technologie » et ses 6 élèves, un exercice publié (questions à choix et circuit) avec une copie
déjà corrigée, le groupe « Équipe Volta » et son projet partagé, quelques messages. Les identifiants
sont affichés à la fin ; les mots de passe des élèves changent à chaque passage.

Administratrice : `admin@demo.jollof.school` / `jollof-demo-2026` (modifiables par
`SEED_ADMIN_EMAIL` et `SEED_ADMIN_PASSWORD`). Les autres écoles ne sont pas touchées. À ne pas
lancer sur un serveur réel : le mot de passe de démonstration est public.

## Tests

```sh
docker compose up -d db
npm test              # tests unitaires (correction, documents riches, noms d'utilisateur, configuration, limites)
npm run test:e2e      # tests de bout en bout sur la base jollof_test (HTTP + Socket.IO)
```

Les tests e2e démarrent l'application complète sur un port libre, contre la vraie base
`jollof_test`, qu'ils **vident entre les suites** (ils refusent toute base dont le nom ne finit pas
par `_test`). Ils couvrent l'authentification (rotation et réutilisation des jetons, compte
désactivé, limite par IP et `TRUST_PROXY`, protection de chaque compte, révocation des sessions,
algorithme et version des jetons), l'isolation des écoles, les classes et comptes, le cycle des
devoirs et la correction, les listes allégées, les groupes, les projets partagés, la messagerie et
sa limite d'envoi, les fichiers (types, CSP), la compression, le journal d'audit et sa purge, les
notifications et le temps réel (limite de frappe, taille des paquets).

La base `jollof_test` est créée par `docker/initdb` à la création du volume. Sur un volume plus
ancien : `docker compose exec db createdb -U jollof jollof_test`.

## Images Docker

`Dockerfile` (multi-étapes, `node:22-alpine`) produit une image **multi-architecture** :
`linux/amd64` (PC, serveurs) et `linux/arm64` (Raspberry Pi 4/5, mini-PC ARM). Les dépendances
sont 100 % JavaScript (bcryptjs, pg) : la compilation TypeScript tourne sur la machine qui
construit, sans émulation, et la construction échoue si un module natif s'y glissait.
L'image (~210 Mo, dont 65 Mo de dépendances) ne contient ni npm ni outils de build ; l'API tourne
sous l'utilisateur `node`, sur des fichiers qui appartiennent à root.

```sh
# Construire et publier les deux architectures dans un registre
docker buildx build --platform linux/amd64,linux/arm64 -t registre.example/jollof-api:0.2.0 --push .
# Sans registre (boîtier hors ligne) : une archive par architecture, à copier sur clé USB
docker buildx build --platform linux/arm64 -t jollof-api:0.2.0 --output type=docker,dest=jollof-api-arm64.tar .
```

Fichiers compose :

| Fichier | Usage |
|---|---|
| `docker-compose.yml` | production cloud : base sur un réseau interne (aucun port publié), API sur `127.0.0.1:3100` pour le proxy |
| `docker-compose.dev.yml` | ajouté au précédent en développement : base sur le port 5433, base `jollof_test`, API en mode développement |
| `docker-compose.box.yml` | boîtier école, à la place de `docker-compose.yml` : réglages 1 Go, API sur le réseau local, sauvegardes |

Durcissement commun : systèmes de fichiers en lecture seule (`tmpfs` pour `/tmp` et le socket
PostgreSQL), toutes les capacités Linux retirées (PostgreSQL garde les cinq dont son point d'entrée
a besoin pour passer à l'utilisateur `postgres`), `no-new-privileges`, contrôles de santé
(`pg_isready`, `GET /api/v1/health`), redémarrage automatique, journaux Docker limités en taille.
Le projet compose s'appelle `jollof` : conteneurs `jollof-db-1` et `jollof-api-1`, volume
`jollof_pgdata`.

## Déploiement cloud (HTTPS)

Sur un serveur Linux avec Docker et un nom de domaine (ici `classe.example.sn`) qui pointe dessus :

```sh
git clone … && cd jollof-studio/server
cp .env.example .env
# .env : POSTGRES_PASSWORD, JWT_SECRET, PLATFORM_KEY (openssl, ci-dessus), TRUST_PROXY=1,
#        CORS_ORIGINS (garder les origines tauri:// de l'application de bureau)
docker compose up -d --build
docker compose ps                  # db et api « healthy »
docker compose logs -f api
```

`POSTGRES_PASSWORD` se choisit **avant** la première création du volume (il est écrit dans la base
à ce moment-là ; le changer ensuite : `ALTER ROLE jollof PASSWORD '…'` puis mettre `.env` à jour).

L'API écoute sur `127.0.0.1:3100` : seul le proxy inverse de la machine la joint. Il termine HTTPS
et relaie aussi les WebSocket (`/socket.io`).

**Caddy** (certificat Let's Encrypt automatique), `/etc/caddy/Caddyfile` :

```
classe.example.sn {
	encode gzip
	reverse_proxy 127.0.0.1:3100
}
```

**nginx** (certificat par certbot) :

```nginx
server {
    listen 443 ssl http2;
    server_name classe.example.sn;
    ssl_certificate     /etc/letsencrypt/live/classe.example.sn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/classe.example.sn/privkey.pem;
    client_max_body_size 12m;                 # fichiers 10 Mo, projets 5 Mo

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;   # WebSocket (/socket.io)
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }
}
server { listen 80; server_name classe.example.sn; return 301 https://$host$request_uri; }
```

Dans l'application, l'adresse du serveur est alors `https://classe.example.sn`. Avec le proxy,
`TRUST_PROXY=1` est indispensable (sinon toute l'école partage la limite de connexions du proxy) ;
sans proxy, ne pas le mettre.

Sauvegardes en cloud : `docker compose exec db pg_dump -U jollof -Fc jollof > jollof-$(date +%F).dump`
(fichiers compris, ils sont dans la base), par exemple chaque nuit par cron, copiées hors du serveur.
On peut aussi y lancer le service `backup` du boîtier (voir plus bas).

## Boîtier école (pas à pas)

Un poste de la salle (ou un Raspberry Pi 4/5, 1 Go au minimum, 2 Go conseillés) sert l'espace classe
aux autres postes du réseau local. Internet n'est utile que pour l'installation et les mises à jour.

1. **Système.** Debian 12, Ubuntu Server 24.04 ou Raspberry Pi OS Lite 64 bits (obligatoire sur
   Pi : l'image est arm64). Sur un Pi, préférer un SSD USB à la carte SD (plus sûr pour la base).
2. **Docker** : `curl -fsSL https://get.docker.com | sh`, puis `sudo usermod -aG docker $USER`
   (se reconnecter) et `sudo systemctl enable docker` : après une coupure de courant, Docker repart
   seul au démarrage et relance les conteneurs.
3. **Adresse fixe sur le réseau local.** Réserver l'adresse du boîtier dans la box Internet / le
   routeur (bail DHCP statique), par exemple `192.168.1.50`. Vérifier : `hostname -I`.
4. **Fichiers et secrets** :
   ```sh
   git clone … && cd jollof-studio/server     # ou copier le dossier server/ depuis une clé USB
   cp .env.example .env
   ```
   Dans `.env` : `COMPOSE_FILE=docker-compose.box.yml`, `POSTGRES_PASSWORD` et `JWT_SECRET`
   (commandes `openssl` ci-dessus, à faire une fois et à noter en lieu sûr).
5. **Image de l'API.** Sur un PC ou un mini-PC x86 : `docker compose build` suffit. Sur un Raspberry
   Pi, mieux vaut ne pas compiler sur place (1 Go de RAM est juste pour TypeScript) : construire
   l'image arm64 sur un autre ordinateur (voir « Images Docker ») et, soit `JOLLOF_IMAGE=…` dans
   `.env` puis `docker compose pull api`, soit `docker load -i jollof-api-arm64.tar` depuis la clé USB
   (avec `JOLLOF_IMAGE=jollof-api:0.2.0`).
6. **Démarrer** : `docker compose up -d`, puis `docker compose ps` : `db`, `api` et `backup` doivent
   être `healthy` (une à deux minutes sur un Pi). Test : `curl http://192.168.1.50:3100/api/v1/health`
   → `{"ok":true,"db":true}`.
7. **Première école** : depuis l'application, « Créer l'espace de mon école » (ou
   `docker compose exec api node dist/database/seed.js` pour une démonstration seulement).
8. **Pare-feu** (si actif) : n'ouvrir que le port 3100 au réseau local, par exemple
   `sudo ufw allow from 192.168.1.0/24 to any port 3100 proto tcp`. PostgreSQL n'est pas publié.

**Postes de la salle.** Dans Jollof Studio, écran de connexion à l'espace classe → « Serveur » →
« Adresse du serveur de l'école » : `http://192.168.1.50:3100` (l'adresse du boîtier, port 3100,
sans `/api/v1`). L'adresse est gardée sur le poste. Si les postes n'arrivent pas à se connecter :
même réseau (Wi-Fi « invités » souvent isolé), pare-feu, adresse du boîtier changée (d'où le bail
statique).

**Sauvegardes.** Le service `backup` fait un `pg_dump` (format compressé, vérifié) une fois par jour,
dès `BACKUP_HOUR` (2 h) ; un boîtier éteint la nuit est sauvegardé à son allumage. Les 14 plus
récentes sont gardées dans `server/backups/` (`jollof-AAAAMMJJ-HHMM.dump`) ; il passe « unhealthy »
si la dernière date de plus de 50 h. Sauvegarde immédiate : `docker compose exec backup sh
/usr/local/bin/jollof-backup now`. **Copier régulièrement `backups/` hors du boîtier** (clé USB,
autre PC) : une carte SD ou un disque qui lâche emporte aussi les sauvegardes qui y sont.

**Restauration** (remplace tout le contenu de la base) :

```sh
docker compose stop api
docker compose exec -T db pg_restore -U jollof -d jollof --clean --if-exists --no-owner --single-transaction < backups/jollof-20261105-0200.dump
docker compose start api
```

Sur un boîtier neuf : installer comme ci-dessus, `docker compose up -d db`, restaurer, puis
`docker compose up -d`. Le même `JWT_SECRET` n'est pas nécessaire (les élèves se reconnectent).

**Mises à jour.**

```sh
docker compose exec backup sh /usr/local/bin/jollof-backup now    # d'abord une sauvegarde
git pull                                                           # ou nouveau dossier server/ par clé USB
docker compose up -d --build                                       # ou : docker compose pull && docker compose up -d
docker compose ps && docker compose logs --tail 50 api
```

Les migrations passent au démarrage de l'API. En cas de problème, revenir à l'image précédente
(`JOLLOF_IMAGE=…` de la version d'avant) et restaurer la sauvegarde. `docker image prune` libère la
place des anciennes images.

## Sécurité

- **Mots de passe** : bcrypt (coût 12, 11 sur le boîtier) calculé dans un petit pool de workers, pour
  ne pas bloquer le serveur pendant la création d'une classe entière. Les empreintes ne sortent
  jamais de l'API. Les mots de passe provisoires (`mot-mot-123`, ~23 bits : 100 mots × 99 × 1000)
  sont faibles par nature : ils doivent être changés, et la protection ci-dessous rend leur
  devinette en ligne impraticable.
- **Connexion** : limite par IP (10 par minute) et **par compte** (identifiant saisi, que le compte
  existe ou non) : 5 échecs libres, puis 15 s, 30 s, 1, 2, 4 min d'attente (`429 RATE_LIMITED` +
  `retryAfter`), blocage de 15 min au 10e. Pendant l'attente, le mot de passe n'est même pas
  vérifié. Les échecs sont oubliés 24 h après le dernier ; une connexion réussie ou une
  réinitialisation les efface. Compte inconnu : même compteur, même empreinte factice, mêmes réponses.
  Au plus ~100 essais par jour et par compte : il faudrait des siècles pour essayer les ~10 millions
  de mots de passe provisoires possibles.
- **Jetons** : accès JWT **HS256 seulement** (algorithme et émetteur vérifiés), 15 min, avec la
  version des jetons du compte ; rafraîchissement opaque de 30 jours, gardé haché (sha256), à usage
  unique ; rejouer un jeton déjà utilisé révoque toute la famille (vol présumé).
- **Révocation immédiate** : changer son mot de passe ferme ses autres sessions ; une
  réinitialisation par l'enseignant ou l'administrateur, ou une désactivation, les ferme toutes. Les
  jetons d'accès déjà émis cessent aussitôt de valoir (version + 1), les jetons de rafraîchissement
  sont révoqués, les sockets fermées. L'utilisateur est relu à chaque requête.
- **Isolation** : chaque service vérifie l'école (autre école → `NOT_FOUND`), l'inscription dans la
  classe, le rôle d'enseignant, l'appartenance au groupe ou à la conversation ; un jeton présenté
  avec une autre école que celle du compte est refusé. Les élèves ne reçoivent jamais `solution` ni
  `rubric`, `correct` seulement selon le contrat, ni les noms d'utilisateur des autres élèves.
- **Entrées** : validation stricte (champs inconnus refusés), corps JSON limité à 6 Mo, documents
  riches filtrés (nœuds et marques admis, liens http(s) seulement, 200 Ko), projets 5 Mo.
- **Messagerie et temps réel** : 20 messages par 10 s et par utilisateur ; indicateurs de frappe
  limités à 10 par 10 s (le surplus est ignoré) ; paquets Socket.IO de 8 Ko au plus.
- **Fichiers** : type déterminé par le contenu, 10 Mo, URL à clé aléatoire non devinable. Jamais de
  HTML, SVG, JavaScript ni XML ; seules les images png/jpeg/gif/webp s'affichent (`inline`), le reste
  se télécharge ; servis avec `nosniff` et `Content-Security-Policy: default-src 'none'; img-src
  'self'; style-src 'unsafe-inline'; sandbox`. Un type inconnu trouvé en base part en
  `application/octet-stream`.
- **Journal d'audit** (`GET /school/audit`, administrateur) : connexions (résumé quotidien par compte,
  réussites et échecs), blocages, créations de comptes, réinitialisations et changements de mot de
  passe, désactivations, archivage des classes, publication et suppression des devoirs, reprises
  forcées de verrou. Gardé 180 jours (purge horaire, avec les compteurs d'échecs et les jetons de
  rafraîchissement expirés).
- helmet, CORS sur liste blanche, `X-Forwarded-For` ignoré sauf `TRUST_PROXY`.
- **Boîtier en HTTP** : sur le réseau local, le trafic n'est pas chiffré. Acceptable sur le réseau
  de l'école protégé (Wi-Fi WPA2, pas d'accès invités) ; ne jamais publier le port 3100 du boîtier
  sur Internet (pas de redirection de port sur la box).
- **Dépendances** : `npm audit --omit=dev` ne signale rien (le `glob` imbriqué de TypeORM 0.3 est
  forcé en 14.x par `overrides`).

## Ressources mesurées

Mémoire au repos (`docker stats`, après démarrage, données de démonstration chargées et quelques
requêtes, 2 min sans activité ; machine de mesure x86-64, Docker 29) :

| Configuration | api | db | backup |
|---|---|---|---|
| Boîtier (`docker-compose.box.yml` : tas 192 Mo, pool 5, 2 workers bcrypt créés par 4 connexions, démonstration chargée par `seed.js`) | 79 à 92 Mio (plafond 320) | 22 à 24 Mio (plafond 400) | 0,3 Mio |
| Cloud / développement (`docker-compose.yml` + dev : tas 384 Mo, pool 10, 1 connexion) | 64 à 67 Mio | 27 Mio | — |
| Avant ces réglages (ancienne image, après une heure d'usage) | 87 Mio | 42 Mio | — |

CPU au repos : 0 %. Le boîtier tient donc à ~110 Mio pour les trois conteneurs, ce qui laisse de
la marge sur 1 Go ; en classe, compter ~10 Mio de plus par worker bcrypt et quelques dizaines de Mio
pendant les envois de projets (plafonnés par `--max-old-space-size`). Image de l'API : ~210 Mo
(65 Mo de dépendances) ; sauvegarde de la base de démonstration : 56 Ko. Image arm64 vérifiée
(construction croisée, démarrage, migrations, connexion) sous émulation aarch64.

Ce qui allège le serveur : pool de 5 connexions sur le boîtier, tas Node plafonné
(`--max-old-space-size`), workers bcrypt limités et créés à la demande, PostgreSQL sans JIT ni
requêtes parallèles, compression gzip des seules réponses JSON d'au moins 1 Ko (pas des fichiers),
listes sans les gros documents (montage de départ des devoirs, projets des élèves : jusqu'à 5 Mo
chacun), écritures ciblées (`UPDATE` des seules colonnes changées au lieu de relire la ligne
entière), contenu des fichiers lu seulement une fois la clé vérifiée, purge des données périmées.

## Organisation du code

```
src/
  main.ts, app.module.ts, app.setup.ts   démarrage et réglages communs (préfixe, helmet, compression, CORS, validation)
  config/        variables d'environnement validées au démarrage (secrets de production)
  database/      entités, migrations, source de données de la CLI, script de démonstration
  common/        erreurs, filtre, accès (école, classe, groupe, forfait), documents riches, mots de passe, limiteur
  auth/          inscription, connexion, protection des comptes, jetons (accès JWT, rafraîchissement opaque), garde globale
  audit/         journal d'audit de l'école (GET /school/audit)
  maintenance/   purge horaire (audit 180 j, compteurs d'échecs, jetons périmés)
  users/         /me, /school, /users, /platform, création de comptes et noms d'utilisateur
  classrooms/    classes, inscriptions, comptes élèves
  assignments/   devoirs, copies, correction automatique (grading.ts), carnet de notes
  groups/  projects/  messaging/  files/  notifications/  realtime/  health/
docker/          initdb (base de test), backup.sh (sauvegardes du boîtier)
test/            tests e2e (Jest + supertest + socket.io-client)
```

## Limites connues

- Une seule instance : la présence en ligne, la diffusion Socket.IO et les limites de messagerie et
  de frappe sont en mémoire (pas d'adaptateur Redis). Plusieurs instances demanderaient
  `@socket.io/redis-adapter` et un stockage partagé des limites.
- Fichiers et versions de projets en base, sans quota ni purge : la base grossit avec l'usage
  (surveiller la place sur un boîtier ; les sauvegardes grossissent d'autant).
- Les notifications ne sont jamais purgées.
- Un enseignant ou un administrateur a deux identifiants (courriel et nom d'utilisateur), donc deux
  compteurs d'échecs.
- Pas d'envoi de courriel (mots de passe provisoires transmis par l'enseignant).
