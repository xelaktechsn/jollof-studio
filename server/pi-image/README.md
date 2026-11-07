<!--
SPDX-License-Identifier: AGPL-3.0-or-later
Copyright (C) 2026 Mamadou Sarr
-->

# Image Raspberry Pi du boîtier école

Une carte SD (ou un SSD USB) prête à l'emploi pour un Raspberry Pi 4 ou 5 : on la grave, on branche le
Pi au réseau de l'école, et quelques minutes plus tard les postes de la salle se connectent à
`http://jollof-ecole.local:3100`. Aucun Internet n'est nécessaire au premier démarrage.

L'image est construite avec [pi-gen](https://github.com/RPi-Distro/pi-gen), l'outil qui produit
Raspberry Pi OS. Le reste du boîtier (sauvegardes, restauration, sécurité) est décrit dans le
[README du serveur](../README.md#boîtier-école-pas-à-pas).

## Contenu de l'image

- **Raspberry Pi OS Lite 64 bits** (Debian 13 « trixie »), pi-gen à l'étiquette
  `2026-10-06-raspios-trixie-arm64` ; nom `jollof-ecole`, français, clavier AZERTY, fuseau
  `Africa/Dakar`, Wi-Fi réglé pour le Sénégal (`config`, à adapter) ;
- **Docker Engine** et son plugin compose (dépôt officiel de Docker), **avahi** (nom `.local`) ;
- **`/opt/jollof`** : `install.sh`, `docker-compose.box.yml`, `docker/backup.sh`, les README et, dans
  `images/`, les archives arm64 de l'API (`jollof-api`) et de PostgreSQL 16 ;
- **`jollof-firstboot.service`** : au premier démarrage, lance `/opt/jollof/install.sh --yes`, qui
  charge les images, tire au hasard les secrets de ce boîtier (`.env`), installe le service
  `jollof`, démarre le serveur et attend qu'il soit prêt. Il se désactive ensuite.

Matériel : Raspberry Pi 4 ou 5, 1 Go de mémoire au minimum (2 Go conseillés), carte SD de 16 Go ou
plus (classe A1/A2) ou, mieux, un SSD USB (plus sûr pour la base de données).

## Construire l'image

Sur un ordinateur **Linux** (Debian, Ubuntu ; x86-64 ou arm64) avec Docker et son plugin buildx, git,
~25 Go libres et Internet. Sous macOS ou Windows : dans une machine virtuelle Linux (pi-gen a besoin
des périphériques loop du noyau).

```sh
# Une fois, sur un PC x86-64 : émulation arm64 pour construire l'image de l'API
docker run --privileged --rm tonistiigi/binfmt --install arm64

cd jollof-studio/server/pi-image
./build.sh                       # 1 à 2 heures
ls deploy/                       # <date>-jollof-ecole-arm64.img.xz
```

`build.sh` construit les images Docker arm64 (API depuis `server/`, PostgreSQL 16 exporté sans
toucher aux images de la machine) dans `work/images/`, télécharge pi-gen dans `work/pi-gen`, y copie
l'étape `stage-jollof` et les fichiers du serveur, puis lance `build-docker.sh` de pi-gen
(Raspberry Pi OS Lite, puis l'étape Jollof). Options :

| Option | Effet |
|---|---|
| `--images-only` | seulement les archives des images Docker (mise à jour d'un boîtier) |
| `--skip-images` | réutilise les archives de `work/images` |
| `--with-toolchain` | ajoute l'image nginx du miroir des fichiers de cartes (profil `toolchain`) |
| `--config FICHIER` | autre configuration pi-gen que `config` (nom, langue, pays…) |
| `--continue` | reprend une construction pi-gen interrompue (conteneur `pigen_work` gardé) |

Variables : `WORK` (dossier de travail), `PIGEN_REF` (autre étiquette de la branche arm64 de pi-gen).
Après un échec, `--continue` reprend ; pour repartir de zéro : `docker rm -v pigen_work`.

Fichiers de l'étape pi-gen :

```text
config                              configuration pi-gen (nom, langue, comptes, SSH)
stage-jollof/
  prerun.sh                         part du système de stage2 (Raspberry Pi OS Lite)
  00-docker/00-packages             curl, jq, avahi…
  00-docker/01-run-chroot.sh        Docker depuis son dépôt officiel
  01-jollof/01-run.sh               copie de /opt/jollof et du service de premier démarrage
  01-jollof/02-run-chroot.sh        activation des services
  01-jollof/files/                  jollof-firstboot (.sh, .service) ; jollof/ est rempli par build.sh
  EXPORT_IMAGE                      exporte l'image de cette étape
```

## Graver la carte

Avec [Raspberry Pi Imager](https://www.raspberrypi.com/software/) :

1. **Appareil** : Raspberry Pi 4 ou 5. **Système** : « Utiliser une image personnalisée » → le
   fichier `.img.xz`. **Stockage** : la carte SD ou le SSD USB.
2. **Personnaliser** (conseillé) : nom d'hôte `jollof-ecole` (un nom différent par boîtier s'il y en a
   plusieurs : `jollof-ecole-2`…), **utilisateur et mot de passe** de l'administrateur du système,
   fuseau et clavier, Wi-Fi seulement si le câble Ethernet est impossible, SSH si l'on veut
   administrer le boîtier à distance (mot de passe solide, ou clé).
3. Écrire, puis insérer la carte (ou brancher le SSD) dans le Pi.

## Premier démarrage

1. Brancher le Pi au réseau de l'école (câble Ethernet de préférence) puis l'alimenter.
2. Attendre **5 à 10 minutes** : agrandissement de la partition, réglages de Raspberry Pi Imager,
   puis installation de Jollof Studio (chargement des images, création de la base). Avec un écran,
   l'invite de connexion affiche ensuite `Jollof Studio, espace classe : http://<adresse>:3100`.
3. Depuis un poste : `http://jollof-ecole.local:3100/api/v1/health` doit répondre
   `{"ok":true,"db":true}`.
4. Dans Jollof Studio, écran de connexion à l'espace classe → « Serveur » → `http://jollof-ecole.local:3100`
   (ou `http://<adresse IP>:3100` si le nom `.local` n'est pas reconnu par le poste). Puis « Créer
   l'espace de mon école ».
5. Réserver l'adresse IP du Pi dans le routeur (bail DHCP statique) : elle ne changera plus.

Suivre ou diagnostiquer l'installation (écran et clavier, ou SSH) :
`journalctl -u jollof-firstboot -f`. En cas d'échec, le service réessaie toutes les 2 minutes (5 fois),
puis au démarrage suivant ; `sudo /opt/jollof/install.sh` relancé à la main affiche l'erreur.

## Comptes et mots de passe

- **Système** : l'image ne contient **aucun mot de passe par défaut** (compte verrouillé, `root`
  bloqué, SSH fermé, clés SSH recréées à chaque boîtier). Le compte se choisit dans Raspberry Pi Imager
  (« Personnaliser ») ou, sans personnalisation, par l'assistant du premier démarrage (écran et
  clavier). Le serveur Jollof démarre même si personne ne se connecte au système.
- **Secrets du serveur** (`/opt/jollof/.env` : mot de passe PostgreSQL, clé des jetons) : tirés au
  hasard au premier démarrage, sur ce boîtier ; deux cartes gravées depuis la même image n'ont jamais
  les mêmes. Le fichier n'est lisible que par root et le groupe `docker`.
- **Jollof Studio** : aucun compte n'existe au départ. L'administrateur de l'école est créé depuis
  l'application (« Créer l'espace de mon école ») avec le mot de passe qu'il choisit, à noter en lieu
  sûr (le serveur n'envoie pas de courriel de réinitialisation). Les comptes qu'il crée ensuite
  (enseignants, élèves) reçoivent un mot de passe provisoire que l'application fait changer à la
  première connexion (`mustChangePassword`).
- **Démonstration** : `sudo /opt/jollof/install.sh --seed` charge l'école de démonstration avec un
  mot de passe administrateur tiré au hasard (affiché, et gardé dans
  `/opt/jollof/demo-identifiants.txt`). Réservé à un boîtier de démonstration.

## Sauvegardes et restauration

La base est sauvegardée chaque jour dans `/opt/jollof/backups/` (les 14 dernières), et avant chaque
mise à jour. **Les copier régulièrement hors du boîtier** : une carte SD qui lâche emporte aussi les
sauvegardes qui y sont.

```sh
# Depuis un PC du réseau (SSH ouvert)
scp utilisateur@jollof-ecole.local:'/opt/jollof/backups/jollof-*.dump' .
# Ou sur une clé USB branchée au Pi (Raspberry Pi OS Lite ne la monte pas tout seul)
lsblk                                   # repérer la clé, par exemple sda1
sudo mount /dev/sda1 /mnt && sudo cp /opt/jollof/backups/jollof-*.dump /mnt/ && sudo umount /mnt
```

Restauration (remplace tout le contenu de la base) :

```sh
cd /opt/jollof
sudo docker compose stop api
sudo docker compose exec -T db pg_restore -U jollof -d jollof --clean --if-exists --no-owner --single-transaction < backups/jollof-20261105-0200.dump
sudo docker compose start api
```

Boîtier neuf ou carte remplacée : graver l'image, attendre le premier démarrage, copier la sauvegarde
dans `/opt/jollof/backups/`, puis restaurer comme ci-dessus.

## Mises à jour

- **Serveur Jollof** : sur l'ordinateur de construction, `./build.sh --images-only` produit
  `work/images/jollof-api-<version>-arm64.tar.gz`. Le copier dans `/opt/jollof/images/` du boîtier
  (clé USB ou `scp`), retirer l'ancienne archive, puis `sudo /opt/jollof/install.sh --yes --no-build` :
  sauvegarde, chargement de la nouvelle image, redémarrage (les migrations passent au démarrage de
  l'API). Si `install.sh` ou `docker-compose.box.yml` ont changé, lancer plutôt le `install.sh` du
  nouveau dossier `server/` : `sudo ./install.sh --yes --no-build --dir /opt/jollof --images <dossier
  des archives>`. Autre voie : graver la nouvelle image et restaurer la dernière sauvegarde.
- **Système** (avec Internet) : `sudo apt update && sudo apt full-upgrade`, puis redémarrer. Docker en
  fait partie ; le serveur repart seul.

## Heure du boîtier

Le Raspberry Pi 4 n'a pas d'horloge sauvegardée : sans Internet, il repart à l'heure de son dernier
arrêt, ce qui fausse les échéances des devoirs et les dates des sauvegardes. Le relier à Internet de
temps en temps (l'heure se règle seule), utiliser le serveur d'heure (NTP) du routeur s'il en a un, ou
munir un Raspberry Pi 5 de sa pile d'horloge. À la main : `sudo date -s "2026-11-07 08:00"`.

## Miroir des fichiers de cartes (facultatif)

Le boîtier peut aussi servir aux postes les fichiers de cartes Arduino (AVR, RP2040) et les
bibliothèques : `./build.sh --with-toolchain` ajoute l'image du serveur web, le miroir lui-même se
prépare avec `toolchain/mirror.sh` (README du serveur, « Miroir des fichiers de cartes »).

## Licences

pi-gen (licence BSD-3-Clause, Raspberry Pi Ltd) est téléchargé au moment de la construction et n'est
pas copié dans ce dépôt ; Raspberry Pi OS, Docker et PostgreSQL gardent leurs licences. Les fichiers de
ce dossier sont sous AGPL-3.0-or-later, comme le reste de Jollof Studio.
