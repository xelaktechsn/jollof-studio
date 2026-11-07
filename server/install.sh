#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mamadou Sarr
#
# Installation en une commande du « boîtier école » de Jollof Studio : le serveur de l'espace classe
# (API NestJS + PostgreSQL 16, docker-compose.box.yml) sur un vieux PC, un mini-PC ou un Raspberry
# Pi 4/5, pour les postes du réseau local. Debian 12/13, Ubuntu 22.04/24.04, Raspberry Pi OS 64 bits.
#
#   sudo ./install.sh                  installation (avec questions) dans /opt/jollof
#   sudo ./install.sh --yes --seed     sans question, avec l'école de démonstration
#   sudo ./install.sh --uninstall      arrêt du serveur et retrait du service (données gardées)
#   ./install.sh --help                toutes les options
#
# Le relancer ne casse rien : .env et données sont gardés. C'est aussi la façon de mettre à jour
# (sauvegarde, copie des nouveaux fichiers, image reconstruite si le code a changé, redémarrage).
# Les migrations de la base passent seules au démarrage de l'API : rien à lancer à part.
#
# Choix (voir aussi README, « Boîtier école ») :
# - Docker vient du dépôt apt officiel de Docker (download.docker.com), ajouté ici en clair plutôt
#   que par le script get.docker.com : même résultat (docker-ce et plugin compose récents, mis à jour
#   par apt), sans exécuter en root un script téléchargé. Les paquets des distributions ne
#   conviennent pas partout (Debian 12 n'a pas le plugin compose v2).
# - Démarrage : une unité systemd (jollof.service) lance « docker compose up -d » au démarrage et
#   « docker compose stop » à l'arrêt, en plus de « restart: unless-stopped ». Elle donne
#   systemctl start/stop/status, relance la pile même après un « docker compose stop » manuel suivi
#   d'un redémarrage, et laisse 60 s à PostgreSQL pour s'arrêter proprement à l'extinction (Docker
#   seul n'attend que 10 s par conteneur).
# - Sauvegardes : rien dans cron. Le service « backup » de docker-compose.box.yml exécute déjà
#   docker/backup.sh chaque jour et rattrape une nuit où le boîtier était éteint (ce que cron ne fait
#   pas) ; une seconde tâche doublerait les fichiers et diviserait par deux l'historique gardé. Le
#   script fait seulement une sauvegarde immédiate avant une mise à jour.

# Lancé par « sh install.sh » : continuer sous bash.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -eu
set -o pipefail

SRC=$(cd -P "$(dirname "$0")" && pwd)
DIR=/opt/jollof
DIR_SET=0
YES=0
SEED=0
UNINSTALL=0
PURGE=0
BUILD=auto
IMAGES_DIR=
COMPOSE_NAME=docker-compose.box.yml
PG_IMAGE=postgres:16                       # image de db et backup dans docker-compose.box.yml
UNIT=/etc/systemd/system/jollof.service
ISSUE=/etc/issue.d/jollof.issue
AVAHI_SERVICE=/etc/avahi/services/jollof.service
LOCK=/run/jollof-install.lock
APT_UPDATED=0
LOADED=0

if [ -t 1 ]; then B=$'\033[1m' G=$'\033[32m' Y=$'\033[33m' R=$'\033[31m' N=$'\033[0m'; else B='' G='' Y='' R='' N=''; fi
info() { printf '%s==>%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%sAttention :%s %s\n' "$Y" "$N" "$*" >&2; }
die() { printf '%sErreur :%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Installation du serveur Jollof Studio sur un boîtier école (Debian, Ubuntu, Raspberry Pi OS 64 bits).

Usage : sudo $0 [options]

  -y, --yes          aucune question (installation automatique)
  --dir DOSSIER      dossier d'installation (défaut : /opt/jollof ; le dossier de ce script :
                     installation sur place, sans copie)
  --seed             charge l'école de démonstration (mot de passe administrateur aléatoire)
  --images DOSSIER   archives d'images Docker (docker save : .tar, .tar.gz) à charger ; sont aussi
                     lus DOSSIER/images et le dossier images/ à côté de ce script
  --build            reconstruit l'image de l'API depuis les sources
  --no-build         ne construit jamais l'image (archives ou registre seulement)
  --uninstall        arrête le serveur et retire le service ; garde la base, .env et les sauvegardes
  --purge            avec --uninstall : supprime aussi la base, .env et les sauvegardes
                     (confirmation au clavier, même avec --yes)
  -h, --help         cette aide

Relancer le script met à jour une installation existante (sauvegarde d'abord), sans toucher à .env.
EOF
}

while [ $# -gt 0 ]; do
  case $1 in
    -y | --yes) YES=1 ;;
    --dir)
      [ $# -ge 2 ] || die "--dir attend un dossier"
      DIR=$2; DIR_SET=1; shift ;;
    --dir=*) DIR=${1#*=}; DIR_SET=1 ;;
    --images)
      [ $# -ge 2 ] || die "--images attend un dossier"
      IMAGES_DIR=$2; shift ;;
    --images=*) IMAGES_DIR=${1#*=} ;;
    --seed) SEED=1 ;;
    --build) BUILD=always ;;
    --no-build) BUILD=never ;;
    --uninstall) UNINSTALL=1 ;;
    --purge) PURGE=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "option inconnue : $1 (voir --help)" ;;
  esac
  shift
done
[ "$PURGE" = 0 ] || [ "$UNINSTALL" = 1 ] || die "--purge ne s'emploie qu'avec --uninstall"
case $DIR in /*) ;; *) DIR=$(pwd)/$DIR ;; esac
case $DIR in *[[:space:]]*) die "le dossier d'installation ne doit pas contenir d'espace : $DIR" ;; esac
STATE=$DIR/.jollof-state

# --- Outils -------------------------------------------------------------------------------------

has_tty() { { : </dev/tty; } 2>/dev/null; }

# ask "question" : oui par défaut ; --yes répond oui ; sans terminal, il faut --yes.
ask() {
  local a
  [ "$YES" = 1 ] && return 0
  has_tty || die "pas de terminal pour répondre : relancer avec --yes"
  printf '%s [O/n] ' "$1" >/dev/tty
  read -r a </dev/tty || a=
  case $a in '' | o | O | oui | Oui | y | Y | yes) return 0 ;; *) return 1 ;; esac
}

require_root() { [ "$(id -u)" -eq 0 ] || die "à lancer en administrateur : sudo $0"; }

take_lock() {
  exec 9>"$LOCK"
  flock -n 9 || die "une autre installation est en cours (premier démarrage ?) : attendre qu'elle finisse"
}

compose() { docker compose --project-directory "$DIR" -f "$DIR/$COMPOSE_NAME" "$@"; }

image_exists() { docker image inspect "$1" >/dev/null 2>&1; }

online() { curl -fsS -m 10 -o /dev/null https://download.docker.com/linux/ 2>/dev/null; }

apt_update() {
  [ "$APT_UPDATED" = 1 ] && return 0
  apt-get update -q
  APT_UPDATED=1
}
apt_install() { DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$@"; }

# Champ de /etc/os-release (ID, VERSION_CODENAME…), vide s'il manque.
os_field() {
  # shellcheck disable=SC1091
  (. /etc/os-release 2>/dev/null && eval "printf '%s' \"\${$1:-}\"")
}

# Valeur d'une variable de .env (dernière occurrence, guillemets retirés).
env_get() {
  local v
  [ -f "$DIR/.env" ] || return 0
  v=$(sed -n "s/^[[:space:]]*$1=//p" "$DIR/.env" | tail -n 1)
  v=${v%$'\r'}
  case $v in \"*\") v=${v#\"}; v=${v%\"} ;; \'*\') v=${v#\'}; v=${v%\'} ;; esac
  printf '%s' "$v"
}

# Mo libres sur le système de fichiers qui contient (ou contiendra) le chemin donné.
free_mb() {
  local p=$1
  while [ ! -e "$p" ]; do p=$(dirname "$p"); done
  df -Pm "$p" | awk 'NR == 2 { print $4 }'
}

# --- Vérifications ------------------------------------------------------------------------------

check_system() {
  [ "$(uname -s)" = Linux ] || die "Linux seulement (Debian, Ubuntu, Raspberry Pi OS)."
  [ -d /run/systemd/system ] || die "systemd est nécessaire (démarrage automatique du serveur)."
  # dpkg d'abord : un Raspberry Pi OS 32 bits tourne souvent sur un noyau 64 bits (uname dit aarch64).
  ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)
  case $ARCH in
    amd64 | x86_64) ARCH=amd64 ;;
    arm64 | aarch64) ARCH=arm64 ;;
    armhf | armel | armv7l | armv6l | i386 | i686)
      die "système 32 bits ($ARCH) : installer un système 64 bits (Raspberry Pi OS Lite 64 bits sur un Pi)." ;;
    *) die "architecture $ARCH non prise en charge (amd64 ou arm64)." ;;
  esac
  MEM_MB=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)
  [ "$MEM_MB" -ge 800 ] || die "${MEM_MB} Mo de mémoire : il faut 1 Go au minimum."
  [ "$MEM_MB" -ge 1800 ] || warn "${MEM_MB} Mo de mémoire : suffisant pour une classe ; 2 Go sont conseillés."
  OS_NAME=$(os_field PRETTY_NAME)
}

check_disk() {
  local root need=2048 free
  root=/var/lib/docker
  if command -v docker >/dev/null 2>&1; then
    root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
  fi
  # Construire l'image demande en plus l'image node et les dépendances de développement.
  [ ! -f "$SRC/Dockerfile" ] || need=3072
  free=$(free_mb "$root")
  [ "$free" -ge "$need" ] || die "seulement ${free} Mo libres pour Docker ($root) : il en faut ${need}."
  [ "$free" -ge 5120 ] || warn "${free} Mo libres pour Docker : la base et les sauvegardes grossissent avec l'usage."
  free=$(free_mb "$DIR")
  [ "$free" -ge 1024 ] || warn "${free} Mo libres pour $DIR (sauvegardes)."
}

ensure_tools() {
  local missing=()
  command -v curl >/dev/null 2>&1 || missing+=(curl ca-certificates)
  command -v openssl >/dev/null 2>&1 || missing+=(openssl)
  [ ${#missing[@]} -gt 0 ] || return 0
  command -v apt-get >/dev/null 2>&1 || die "programmes manquants : ${missing[*]}"
  info "Installation de : ${missing[*]}"
  apt_update
  apt_install "${missing[@]}"
}

# --- Docker -------------------------------------------------------------------------------------

install_docker() {
  local id like codename repo suite
  command -v apt-get >/dev/null 2>&1 \
    || die "installation automatique de Docker : Debian, Ubuntu ou Raspberry Pi OS seulement (https://docs.docker.com/engine/install/)."
  online || die "pas d'accès Internet : Docker ne peut pas être installé. Brancher le boîtier à Internet le temps de l'installation, ou installer Docker à la main."
  id=$(os_field ID); like=$(os_field ID_LIKE); codename=$(os_field VERSION_CODENAME)
  case $id in
    ubuntu) repo=ubuntu; suite=$(os_field UBUNTU_CODENAME); suite=${suite:-$codename} ;;
    debian | raspbian) repo=debian; suite=$codename ;;
    *)
      case " $like " in
        *" ubuntu "*) repo=ubuntu; suite=$(os_field UBUNTU_CODENAME) ;;
        *" debian "*) repo=debian; suite=$(os_field DEBIAN_CODENAME) ;;
        *) die "distribution $id non prise en charge : installer Docker à la main (https://docs.docker.com/engine/install/)." ;;
      esac ;;
  esac
  [ -n "$suite" ] || die "version de la distribution inconnue (/etc/os-release) : installer Docker à la main."
  curl -fsSI -o /dev/null "https://download.docker.com/linux/$repo/dists/$suite/Release" \
    || die "Docker ne publie pas de paquets pour $repo $suite : https://docs.docker.com/engine/install/"
  info "Installation de Docker depuis son dépôt officiel ($repo $suite, $ARCH)…"
  apt_update
  apt_install ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$repo/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  if [ -e /etc/apt/sources.list.d/docker.list ]; then
    info "dépôt Docker déjà déclaré (/etc/apt/sources.list.d/docker.list) : gardé tel quel."
  else
    cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$repo
Suites: $suite
Components: stable
Architectures: $ARCH
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  fi
  APT_UPDATED=0
  apt_update
  apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

install_compose_plugin() {
  if ! command -v apt-get >/dev/null 2>&1 || ! online; then
    die "plugin « docker compose » absent : l'installer (paquet docker-compose-plugin du dépôt Docker)."
  fi
  info "Installation du plugin docker compose…"
  apt_update
  if dpkg -s docker-ce >/dev/null 2>&1; then
    apt_install docker-compose-plugin
  else
    # Docker des paquets de la distribution : Ubuntu nomme le plugin docker-compose-v2, Debian 13 docker-compose.
    apt_install docker-compose-v2 || apt_install docker-compose || true
  fi
  docker compose version >/dev/null 2>&1 || die "plugin « docker compose » introuvable après installation."
}

ensure_docker() {
  local v
  command -v docker >/dev/null 2>&1 || install_docker
  # Docker démarre avec le système : après une coupure de courant, le serveur repart seul.
  systemctl enable --now docker.service >/dev/null 2>&1 || systemctl start docker.service || true
  docker info >/dev/null 2>&1 || die "Docker ne répond pas (systemctl status docker)."
  docker compose version >/dev/null 2>&1 || install_compose_plugin
  v=$(docker compose version --short 2>/dev/null || echo 0)
  v=${v#v}
  [ "${v%%.*}" -ge 2 ] 2>/dev/null || die "docker compose $v trop ancien : la version 2 au moins est nécessaire."
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ] && getent group docker >/dev/null \
    && ! id -nG "$SUDO_USER" | tr ' ' '\n' | grep -qx docker; then
    usermod -aG docker "$SUDO_USER"
    info "$SUDO_USER ajouté au groupe docker (« docker compose » sans sudo après reconnexion)."
  fi
}

# --- Fichiers et secrets ------------------------------------------------------------------------

prepare_dir() {
  local f list=()
  mkdir -p "$DIR"
  DIR=$(cd -P "$DIR" && pwd)
  STATE=$DIR/.jollof-state
  if [ "$DIR" != "$SRC" ]; then
    [ -f "$SRC/$COMPOSE_NAME" ] || die "fichiers du serveur introuvables à côté de install.sh ($SRC)."
    info "Copie des fichiers du serveur dans $DIR…"
    for f in install.sh "$COMPOSE_NAME" .env.example README.md API.md docker/backup.sh \
      toolchain/mirror.sh toolchain/nginx.conf Dockerfile .dockerignore package.json \
      package-lock.json tsconfig.json tsconfig.build.json nest-cli.json; do
      if [ -e "$SRC/$f" ]; then list+=("$f"); fi
    done
    if [ -d "$SRC/src" ]; then
      rm -rf "$DIR/src"
      list+=(src)
    fi
    tar -C "$SRC" -cf - "${list[@]}" | tar -C "$DIR" --no-same-owner -xf -
    chmod 0755 "$DIR/install.sh"
    # Marque : dossier rempli par install.sh, que --uninstall --purge peut supprimer entièrement.
    : >"$DIR/.jollof-install"
  fi
  [ -f "$DIR/$COMPOSE_NAME" ] || die "$DIR/$COMPOSE_NAME introuvable."
  mkdir -p "$DIR/backups" "$STATE"
  chmod 0700 "$STATE"
}

detect_tz() {
  local tz
  tz=$(timedatectl show -p Timezone --value 2>/dev/null || true)
  [ -n "$tz" ] || tz=$(cat /etc/timezone 2>/dev/null || true)
  # UTC : système jamais réglé ; Africa/Dakar a le même décalage.
  case $tz in '' | UTC | Etc/UTC | Etc/Universal) tz=Africa/Dakar ;; esac
  printf '%s' "$tz"
}

gen_env() {
  local pg jwt tmp
  [ -f "$DIR/.env.example" ] || die "$DIR/.env.example introuvable."
  info "Création de $DIR/.env avec des secrets aléatoires (propres à ce boîtier)…"
  pg=$(openssl rand -hex 24)
  jwt=$(openssl rand -base64 48 | tr -d '\n')
  tmp=$(mktemp "$DIR/.env.XXXXXX")
  awk -v pg="$pg" -v jwt="$jwt" '
    /^# COMPOSE_FILE=/      { print "COMPOSE_FILE=docker-compose.box.yml"; next }
    /^POSTGRES_PASSWORD=/   { print "POSTGRES_PASSWORD=" pg; next }
    /^JWT_SECRET=/          { print "JWT_SECRET=" jwt; next }
    /^DATABASE_URL=/        { print "# " $0 "   (inutilisée : docker compose construit la sienne)"; next }
    /^DB_POOL_SIZE=/        { print "DB_POOL_SIZE=5"; next }
    /^BCRYPT_COST=/         { print "BCRYPT_COST=11"; next }
    { print }
  ' "$DIR/.env.example" >"$tmp"
  cat >>"$tmp" <<EOF

# --- Boîtier école (ajouté par install.sh le $(date +%F)) ---
# Ces secrets ont été tirés au hasard pour ce boîtier : les noter en lieu sûr (avec les sauvegardes).
TZ=$(detect_tz)
BACKUP_HOUR=2
BACKUP_KEEP=14
BACKUP_HOST_DIR=./backups
# Miroir local des fichiers de cartes Arduino (README, « Miroir des fichiers de cartes ») :
# COMPOSE_PROFILES=toolchain
# TOOLCHAIN_PORT=8080
EOF
  chmod 0640 "$tmp"
  chown root:docker "$tmp" 2>/dev/null || true
  mv "$tmp" "$DIR/.env"
  [ "$(env_get POSTGRES_PASSWORD)" = "$pg" ] && [ "$(env_get JWT_SECRET)" = "$jwt" ] \
    || die "génération de .env impossible : .env.example a une forme inattendue."
}

check_env() {
  local pg jwt cf bad=''
  pg=$(env_get POSTGRES_PASSWORD)
  jwt=$(env_get JWT_SECRET)
  [ ${#pg} -ge 12 ] || bad="$bad\n  - POSTGRES_PASSWORD absent ou trop court (12 caractères au moins)"
  case $pg in jollof | postgres | password) bad="$bad\n  - POSTGRES_PASSWORD est une valeur par défaut" ;; esac
  [ ${#jwt} -ge 32 ] || bad="$bad\n  - JWT_SECRET absent ou trop court (32 caractères au moins)"
  case $jwt in *change-me*) bad="$bad\n  - JWT_SECRET est celui de .env.example" ;; esac
  [ -z "$bad" ] || die "$(printf '%b' "$DIR/.env ne convient pas à un serveur réel :$bad\nLe corriger (openssl rand -hex 24, openssl rand -base64 48), ou le supprimer s'il n'y a encore aucune donnée : il sera recréé.")"
  cf=$(env_get COMPOSE_FILE)
  if [ -n "$cf" ] && [ "$cf" != "$COMPOSE_NAME" ]; then
    warn "COMPOSE_FILE=$cf dans .env : le service jollof utilise $COMPOSE_NAME ; pour les commandes « docker compose » à la main, mettre COMPOSE_FILE=$COMPOSE_NAME."
  fi
}

ensure_env() {
  local old
  if [ -f "$DIR/.env" ]; then
    info ".env existant gardé ($DIR/.env)."
  elif docker volume inspect jollof_pgdata >/dev/null 2>&1; then
    # Une base existe déjà : son mot de passe est dans le .env de l'installation qui l'a créée.
    old=$(docker ps -a --filter label=com.docker.compose.project=jollof \
      --format '{{.Label "com.docker.compose.project.working_dir"}}' | sort -u | head -n 1)
    if [ -n "$old" ] && [ "$old" != "$DIR" ] && [ -f "$old/.env" ]; then
      warn "une base Jollof existe déjà (volume jollof_pgdata, installée depuis $old)."
      ask "Reprendre $old/.env (même mot de passe de base) ?" || die "abandon."
      cp -p "$old/.env" "$DIR/.env"
    else
      die "le volume jollof_pgdata existe déjà (base d'une installation précédente) mais $DIR/.env est absent : le mot de passe de la base est inconnu. Copier l'ancien .env dans $DIR, ou, pour repartir de zéro en PERDANT cette base : docker volume rm jollof_pgdata"
    fi
  else
    gen_env
  fi
  check_env
}

# --- Images Docker ------------------------------------------------------------------------------

# Archives « docker save » (.tar, .tar.gz) : installation hors ligne et image Raspberry Pi.
load_archives() {
  local d f key need=0 dirs=()
  for d in "$IMAGES_DIR" "$DIR/images" "$SRC/images"; do
    [ -n "$d" ] && [ -d "$d" ] || continue
    d=$(cd -P "$d" && pwd)
    case " ${dirs[*]-} " in *" $d "*) continue ;; esac
    dirs+=("$d")
  done
  [ ${#dirs[@]} -gt 0 ] || return 0
  if ! image_exists "$API_IMAGE" || ! image_exists "$PG_IMAGE"; then need=1; fi
  touch "$STATE/images-loaded"
  for d in "${dirs[@]}"; do
    for f in "$d"/*.tar "$d"/*.tar.gz "$d"/*.tgz; do
      [ -f "$f" ] || continue
      key="$(basename "$f") $(stat -c '%s %Y' "$f")"
      if [ "$need" = 0 ] && grep -qxF "$key" "$STATE/images-loaded"; then continue; fi
      info "Chargement de l'image $(basename "$f")…"
      docker load -i "$f" || die "archive d'image illisible : $f"
      grep -qxF "$key" "$STATE/images-loaded" || echo "$key" >>"$STATE/images-loaded"
      LOADED=1
    done
  done
  # Archive étiquetée seulement jollof-api:<version> : la rendre visible sous jollof-api (latest).
  if [ "$API_IMAGE" = jollof-api ] && ! image_exists jollof-api:latest; then
    f=$(docker image ls jollof-api --format '{{.Tag}}' | grep -vx '<none>' | head -n 1 || true)
    if [ -n "$f" ]; then
      docker tag "jollof-api:$f" jollof-api:latest
      info "jollof-api:$f utilisée comme jollof-api."
    fi
  fi
}

can_build() {
  [ "$LOCAL_API" = 1 ] && [ -f "$DIR/Dockerfile" ] && [ -d "$DIR/src" ] && [ -f "$DIR/package-lock.json" ]
}

# Empreinte des sources de l'image : reconstruire seulement si le code a changé.
src_hash() {
  local f files=()
  for f in Dockerfile .dockerignore package.json package-lock.json tsconfig.json tsconfig.build.json nest-cli.json; do
    if [ -f "$DIR/$f" ]; then files+=("$f"); fi
  done
  (cd "$DIR" && { printf '%s\n' "${files[@]}"; find src -type f; } | LC_ALL=C sort \
    | xargs -d '\n' sha256sum | sha256sum | cut -d ' ' -f 1)
}

build_api() {
  if [ "$ARCH" = arm64 ] && [ "$MEM_MB" -lt 1800 ]; then
    if image_exists "$API_IMAGE"; then
      warn "le code de l'API a changé, mais ${MEM_MB} Mo de mémoire ne suffisent pas à reconstruire l'image ici : l'image actuelle est gardée. Fournir l'image construite ailleurs (README, « Images Docker ») dans $DIR/images/."
      return 0
    fi
    die "image de l'API absente, et ${MEM_MB} Mo de mémoire ne suffisent pas à la construire ici. La construire pour arm64 sur un autre ordinateur (README, « Images Docker ») et déposer l'archive dans $DIR/images/, ou utiliser l'image Raspberry Pi toute prête (pi-image/README.md)."
  fi
  info "Construction de l'image de l'API (quelques minutes ; 15 à 30 sur un Raspberry Pi)…"
  if compose build api; then
    src_hash >"$STATE/api-src.sha256"
  elif image_exists "$API_IMAGE"; then
    warn "construction impossible (Internet ?) : l'image précédente est gardée."
  else
    die "construction de l'image de l'API impossible (voir ci-dessus ; Internet est nécessaire la première fois)."
  fi
}

ensure_images() {
  local want=0 img
  API_IMAGE=$(env_get JOLLOF_IMAGE)
  API_IMAGE=${API_IMAGE:-jollof-api}
  # Sans « / », l'image est locale (construite ici ou chargée d'une archive) ; sinon, dans un registre.
  case $API_IMAGE in */*) LOCAL_API=0 ;; *) LOCAL_API=1 ;; esac
  load_archives
  case $BUILD in
    always) can_build || die "--build : sources absentes de $DIR (Dockerfile, src/)."; want=1 ;;
    never) ;;
    auto)
      if ! image_exists "$API_IMAGE"; then
        if can_build; then want=1; fi
      elif can_build && [ "$LOADED" = 0 ] \
        && [ "$(cat "$STATE/api-src.sha256" 2>/dev/null || true)" != "$(src_hash)" ]; then
        want=1
      fi ;;
  esac
  # Une archive fournie fait foi : ne pas la remplacer aussitôt par une construction locale.
  if [ "$want" = 0 ] && [ "$LOADED" = 1 ] && can_build; then src_hash >"$STATE/api-src.sha256"; fi
  if [ "$want" = 1 ]; then build_api; fi
  if ! image_exists "$API_IMAGE"; then
    if [ "$LOCAL_API" = 1 ] || ! online; then
      die "image de l'API $API_IMAGE introuvable : la construire (sources dans $DIR), ou déposer son archive dans $DIR/images/, ou mettre JOLLOF_IMAGE=<registre>/jollof-api:<version> dans .env."
    fi
    info "Téléchargement de l'image $API_IMAGE…"
    compose pull api
  fi
  if ! image_exists "$PG_IMAGE"; then
    online || die "image $PG_IMAGE absente et pas d'accès Internet : déposer son archive (docker save) dans $DIR/images/."
    info "Téléchargement de l'image $PG_IMAGE…"
    compose pull db
  fi
  case ",$(env_get COMPOSE_PROFILES)," in
    *,toolchain,*)
      img=$(compose --profile toolchain config --images toolchain 2>/dev/null | head -n 1 || true)
      if [ -n "$img" ] && ! image_exists "$img"; then
        if online; then
          compose --profile toolchain pull toolchain
        else
          warn "image $img du miroir (profil toolchain) absente et pas d'Internet : déposer son archive dans $DIR/images/."
        fi
      fi ;;
  esac
}

# --- Service, démarrage, réseau -----------------------------------------------------------------

install_unit() {
  local docker_bin tmp
  docker_bin=$(command -v docker)
  tmp=$(mktemp)
  cat >"$tmp" <<EOF
# Jollof Studio : serveur de l'espace classe (boîtier école). Écrit par $DIR/install.sh.
# La pile garde aussi « restart: unless-stopped » ; cette unité la (re)lance au démarrage et
# l'arrête proprement à l'extinction. sudo systemctl status|restart|stop jollof
[Unit]
Description=Jollof Studio : serveur de l'espace classe (boîtier école)
Documentation=file:$DIR/README.md
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$DIR
ExecStart=$docker_bin compose --project-directory $DIR -f $DIR/$COMPOSE_NAME up -d --remove-orphans --no-build
ExecReload=$docker_bin compose --project-directory $DIR -f $DIR/$COMPOSE_NAME up -d --remove-orphans --no-build
ExecStop=$docker_bin compose --project-directory $DIR -f $DIR/$COMPOSE_NAME stop --timeout 60
TimeoutStartSec=600
TimeoutStopSec=180

[Install]
WantedBy=multi-user.target
EOF
  if ! cmp -s "$tmp" "$UNIT"; then
    install -m 0644 "$tmp" "$UNIT"
    systemctl daemon-reload
  fi
  rm -f "$tmp"
  systemctl enable jollof.service >/dev/null 2>&1 || die "systemctl enable jollof.service a échoué."
}

backup_before_update() {
  local id
  id=$(compose ps -q --status running backup 2>/dev/null || true)
  [ -n "$id" ] || return 0
  # Pas deux sauvegardes en une heure : relancer le script ne doit pas faire tourner l'historique.
  if [ -n "$(find "$DIR/backups" -maxdepth 1 -name 'jollof-*.dump' -mmin -60 2>/dev/null)" ]; then return 0; fi
  info "Sauvegarde de la base avant la mise à jour…"
  if ! compose exec -T backup sh /usr/local/bin/jollof-backup now; then
    [ "$YES" = 0 ] || die "sauvegarde impossible avant la mise à jour (relancer sans --yes pour passer outre)."
    ask "Sauvegarde impossible. Mettre à jour quand même ?" || die "abandon : rien n'a changé."
  fi
}

show_logs() { compose logs --no-color --tail 40 "$1" >&2 || true; }

start_stack() {
  local port
  port=$(env_get API_PORT); port=${port:-3100}
  if [ -z "$(compose ps -q --status running api 2>/dev/null || true)" ] \
    && ss -Hltn "( sport = :$port )" 2>/dev/null | grep -q .; then
    die "le port $port est déjà utilisé par un autre programme (sudo ss -ltnp) : choisir API_PORT=… dans .env."
  fi
  info "Démarrage du serveur…"
  compose up -d --remove-orphans --no-build
}

wait_healthy() {
  local svc id st status health restarts deadline=$((SECONDS + 900))
  info "Attente du démarrage (une à deux minutes ; davantage la première fois sur un Raspberry Pi)…"
  for svc in db api; do
    while :; do
      id=$(compose ps -a -q "$svc" 2>/dev/null || true)
      st=absent//0
      if [ -n "$id" ]; then
        st=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}/{{.RestartCount}}' "$id" 2>/dev/null || echo absent//0)
      fi
      IFS=/ read -r status health restarts <<<"$st"
      [ "$health" != healthy ] || break
      if [ "$health" = unhealthy ] || [ "$status" = exited ] || [ "$status" = dead ] || [ "${restarts:-0}" -ge 3 ]; then
        show_logs "$svc"
        die "le service $svc ne démarre pas (état : $status $health, $restarts redémarrages ; journaux ci-dessus)."
      fi
      if [ $SECONDS -ge $deadline ]; then
        show_logs "$svc"
        die "le service $svc n'est toujours pas prêt après 15 minutes (journaux ci-dessus)."
      fi
      sleep 5
    done
  done
}

seed_demo() {
  local pw
  pw=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c 1-16)
  info "Chargement de l'école de démonstration…"
  (
    umask 077
    compose exec -T -e SEED_ADMIN_PASSWORD="$pw" api node dist/database/seed.js | tee "$DIR/demo-identifiants.txt"
  )
  info "Identifiants gardés dans $DIR/demo-identifiants.txt (root seulement). Le mot de passe de l'administratrice est tiré au hasard pour ce boîtier."
}

setup_mdns() {
  local port tmp
  port=$(env_get API_PORT); port=${port:-3100}
  if [ ! -x /usr/sbin/avahi-daemon ]; then
    if command -v apt-get >/dev/null 2>&1 && online; then
      info "Installation d'avahi (nom $(hostname -s).local sur le réseau local)…"
      apt_update
      apt_install avahi-daemon || warn "avahi-daemon n'a pas pu être installé : les postes utiliseront l'adresse IP."
    else
      warn "avahi-daemon absent (pas d'Internet) : les postes utiliseront l'adresse IP."
    fi
  fi
  [ -x /usr/sbin/avahi-daemon ] || return 0
  # Annonce DNS-SD du serveur (_jollof._tcp) : les postes pourront le trouver sans saisir d'adresse.
  mkdir -p "$(dirname "$AVAHI_SERVICE")"
  tmp=$(mktemp)
  cat >"$tmp" <<EOF
<?xml version="1.0" standalone="no"?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<!-- Jollof Studio : serveur de l'espace classe (écrit par $DIR/install.sh). -->
<service-group>
  <name replace-wildcards="yes">Jollof Studio (%h)</name>
  <service>
    <type>_jollof._tcp</type>
    <port>$port</port>
    <txt-record>path=/api/v1</txt-record>
  </service>
  <service>
    <type>_http._tcp</type>
    <port>$port</port>
    <txt-record>path=/api/v1/health</txt-record>
  </service>
</service-group>
EOF
  cmp -s "$tmp" "$AVAHI_SERVICE" || install -m 0644 "$tmp" "$AVAHI_SERVICE"
  rm -f "$tmp"
  systemctl enable --now avahi-daemon.service >/dev/null 2>&1 || warn "avahi-daemon ne démarre pas : les postes utiliseront l'adresse IP."
}

# Adresse affichée sur l'écran de connexion de la console (boîtier branché à un écran).
write_issue() {
  local port
  port=$(env_get API_PORT); port=${port:-3100}
  mkdir -p "$(dirname "$ISSUE")"
  printf 'Jollof Studio, espace classe : http://\\4:%s  (ou http://\\n.local:%s)\n\n' "$port" "$port" >"$ISSUE"
}

local_ips() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global \
      | awk '$2 !~ /^(docker|br-|veth|virbr|lxc|cni|flannel|tailscale|zt|wg)/ { split($4, a, "/"); print a[1] }'
  else
    hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | grep -v '^172\.1[7-9]\.' || true
  fi
}

print_summary() {
  local port host ips ip
  port=$(env_get API_PORT); port=${port:-3100}
  host=$(hostname -s 2>/dev/null || hostname)
  ips=$(local_ips)
  echo
  printf '%sJollof Studio est prêt.%s\n\n' "$B" "$N"
  echo "Adresse du serveur à saisir dans l'application (connexion à l'espace classe → « Serveur ») :"
  if systemctl is-active --quiet avahi-daemon.service 2>/dev/null; then echo "    http://$host.local:$port"; fi
  for ip in $ips; do echo "    http://$ip:$port"; done
  [ -n "$ips" ] || warn "aucune adresse sur le réseau local : brancher le boîtier au réseau de l'école."
  cat <<EOF

Vérification depuis un poste : http://<adresse>:$port/api/v1/health répond {"ok":true,"db":true}.
Première école : dans l'application, « Créer l'espace de mon école » (son administrateur choisit
son mot de passe ; les comptes créés ensuite reçoivent un mot de passe provisoire à changer).

Dossier : $DIR (secrets dans .env ; sauvegarde quotidienne dans backups/, à copier hors du boîtier)
Service : sudo systemctl status|restart|stop jollof
Journaux : cd $DIR && sudo docker compose ps && sudo docker compose logs --tail 50 api
Conseil : réserver l'adresse IP du boîtier dans le routeur (bail DHCP statique).
EOF
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
    echo "Pare-feu ufw actif : Docker publie le port $port sans passer par ufw. Ne jamais rediriger ce port depuis la box Internet."
  fi
}

# --- Installation et désinstallation ------------------------------------------------------------

main_install() {
  local docker_state="absent : sera installé depuis son dépôt officiel (download.docker.com)" copy="sur place"
  require_root
  take_lock
  check_system
  if command -v docker >/dev/null 2>&1; then docker_state="présent ($(docker --version 2>/dev/null | cut -d ' ' -f 3 | tr -d ,))"; fi
  if [ -d "$DIR" ]; then
    [ "$(cd -P "$DIR" && pwd)" = "$SRC" ] || copy="copie depuis $SRC"
  else
    copy="copie depuis $SRC"
  fi
  cat <<EOF
${B}Installation du serveur Jollof Studio (boîtier école)${N}
  Système      : ${OS_NAME:-Linux} ($ARCH, ${MEM_MB} Mo de mémoire)
  Dossier      : $DIR ($copy)
  Docker       : $docker_state
  Démonstration: $(if [ "$SEED" = 1 ]; then echo oui; else echo non; fi)
EOF
  ask "Continuer ?" || exit 0
  check_disk
  ensure_tools
  ensure_docker
  prepare_dir
  ensure_env
  ensure_images
  install_unit
  backup_before_update
  start_stack
  wait_healthy
  # Aligne l'état de l'unité (la pile tourne déjà : « up -d » ne change rien).
  systemctl start jollof.service
  if [ "$SEED" = 1 ]; then seed_demo; fi
  setup_mdns
  write_issue
  print_summary
}

confirm_purge() {
  local a
  has_tty || die "--purge demande une confirmation au clavier (pas de terminal) : rien n'a été supprimé."
  cat >/dev/tty <<EOF
${R}ATTENTION${N} : --purge supprime définitivement la base de l'espace classe (écoles, comptes,
classes, devoirs, copies, fichiers), le fichier .env et les sauvegardes de $DIR/backups.
Copier d'abord ces sauvegardes ailleurs si elles peuvent encore servir.
EOF
  printf 'Taper SUPPRIMER pour confirmer : ' >/dev/tty
  read -r a </dev/tty || a=
  [ "$a" = SUPPRIMER ] || die "abandon : rien n'a été supprimé."
}

main_uninstall() {
  local d down=(down --remove-orphans)
  require_root
  take_lock
  if [ "$DIR_SET" = 0 ] && [ -f "$UNIT" ]; then
    d=$(sed -n 's/^WorkingDirectory=//p' "$UNIT" | head -n 1)
    if [ -n "$d" ]; then DIR=$d; fi
  fi
  if [ -d "$DIR" ]; then DIR=$(cd -P "$DIR" && pwd); fi
  if [ "$PURGE" = 1 ]; then
    down+=(--volumes)
    confirm_purge
  else
    ask "Arrêter le serveur Jollof ($DIR) et retirer son service ? La base, .env et les sauvegardes restent." || exit 0
  fi
  if [ -f "$UNIT" ]; then
    info "Arrêt du service jollof…"
    systemctl disable --now jollof.service >/dev/null 2>&1 || true
  fi
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    info "Retrait des conteneurs…"
    # Sans .env (secrets requis par le fichier compose), retirer le projet par son nom.
    if [ ! -f "$DIR/$COMPOSE_NAME" ] || ! compose --profile toolchain "${down[@]}" 2>/dev/null; then
      docker compose -p jollof "${down[@]}" || warn "docker compose down a échoué."
    fi
    if [ "$PURGE" = 1 ] && docker volume inspect jollof_pgdata >/dev/null 2>&1; then
      docker volume rm jollof_pgdata >/dev/null || warn "volume jollof_pgdata non supprimé (encore utilisé ?)."
    fi
  fi
  rm -f "$UNIT" "$ISSUE" "$AVAHI_SERVICE"
  systemctl daemon-reload || true
  if [ "$PURGE" = 1 ]; then
    case $DIR in / | /opt | /usr | /usr/* | /etc | /var | /home | /root | /boot*) die "dossier $DIR refusé pour --purge." ;; esac
    if [ -f "$DIR/.jollof-install" ]; then
      rm -rf "$DIR"
    elif [ -d "$DIR" ]; then
      # Installation sur place (dossier server/ du dépôt) : ne retirer que ce que l'installation a créé.
      rm -rf "$DIR/.env" "$DIR/backups" "$DIR/.jollof-state" "$DIR/demo-identifiants.txt"
    fi
    info "Jollof Studio est désinstallé ; base, .env et sauvegardes supprimés."
  else
    info "Jollof Studio est arrêté et son service retiré. Gardés : la base (volume jollof_pgdata), $DIR/.env et $DIR/backups."
    echo "Réinstaller : sudo $DIR/install.sh ; tout effacer : sudo $DIR/install.sh --uninstall --purge"
  fi
  echo "Docker et les images restent installés (place : sudo docker image rm jollof-api $PG_IMAGE)."
}

if [ "$UNINSTALL" = 1 ]; then main_uninstall; else main_install; fi
