#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mamadou Sarr
#
# Construit l'image Raspberry Pi du boîtier école : Raspberry Pi OS Lite 64 bits (pi-gen, branche
# arm64, étiquette figée ci-dessous) + Docker + serveur Jollof Studio, avec les images Docker arm64
# déjà incluses (aucun Internet au premier démarrage). Sur Linux (x86-64 ou arm64) avec Docker :
# 1 à 2 heures, ~25 Go libres. Résultat : deploy/<date>-jollof-ecole-arm64.img.xz. Voir README.md.
#
#   ./build.sh                    images Docker arm64, puis image Raspberry Pi
#   ./build.sh --images-only      seulement les archives des images Docker (work/images), pour
#                                 mettre à jour un boîtier par clé USB
#   ./build.sh --continue         reprend une construction pi-gen interrompue
#
# pi-gen (BSD-3-Clause, https://github.com/RPi-Distro/pi-gen) est téléchargé dans work/pi-gen à la
# construction ; il n'est pas copié dans ce dépôt.
set -eu
set -o pipefail

HERE=$(cd -P "$(dirname "$0")" && pwd)
SERVER=$(cd -P "$HERE/.." && pwd)
WORK=${WORK:-$HERE/work}
PIGEN_REPO=${PIGEN_REPO:-https://github.com/RPi-Distro/pi-gen.git}
PIGEN_REF=${PIGEN_REF:-2026-10-06-raspios-trixie-arm64}
CONFIG=$HERE/config
BUILDER=jollof-pi
IMAGES_ONLY=0
SKIP_IMAGES=0
WITH_TOOLCHAIN=0
RESUME=0

info() { printf '==> %s\n' "$*"; }
die() { printf 'Erreur : %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Image Raspberry Pi (OS Lite 64 bits) du boîtier école Jollof Studio, construite avec pi-gen.

Usage : $0 [options]

  --images-only      construit seulement les archives des images Docker arm64 (work/images)
  --skip-images      réutilise les archives déjà dans work/images
  --with-toolchain   inclut aussi l'image du miroir des fichiers de cartes (profil toolchain)
  --config FICHIER   configuration pi-gen (défaut : $CONFIG)
  --continue         reprend une construction pi-gen interrompue (conteneur pigen_work gardé)
  -h, --help         cette aide

Variables : WORK (dossier de travail, défaut $HERE/work), PIGEN_REF (défaut $PIGEN_REF).
EOF
}

while [ $# -gt 0 ]; do
  case $1 in
    --images-only) IMAGES_ONLY=1 ;;
    --skip-images) SKIP_IMAGES=1 ;;
    --with-toolchain) WITH_TOOLCHAIN=1 ;;
    --config) [ $# -ge 2 ] || die "--config attend un fichier"; CONFIG=$2; shift ;;
    --continue) RESUME=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "option inconnue : $1 (voir --help)" ;;
  esac
  shift
done

[ "$(uname -s)" = Linux ] || die "Linux nécessaire (pi-gen utilise des périphériques loop et binfmt) : sous macOS ou Windows, passer par une machine virtuelle Debian ou Ubuntu."
for c in docker git gzip; do command -v "$c" >/dev/null 2>&1 || die "$c est nécessaire."; done
[ -f "$CONFIG" ] || die "configuration introuvable : $CONFIG"
CONFIG=$(cd -P "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")
VERSION=$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "$SERVER/package.json" | head -n 1)
[ -n "$VERSION" ] || die "version introuvable dans $SERVER/package.json"
# Mêmes images que docker-compose.box.yml (source unique).
PG_IMAGE=$(sed -n 's/^    image: \(postgres:[^ ]*\)$/\1/p' "$SERVER/docker-compose.box.yml" | head -n 1)
TOOLCHAIN_IMAGE=$(sed -n 's/.*TOOLCHAIN_IMAGE:-\([^}]*\)}.*/\1/p' "$SERVER/docker-compose.box.yml" | head -n 1)
[ -n "$PG_IMAGE" ] && [ -n "$TOOLCHAIN_IMAGE" ] || die "images introuvables dans docker-compose.box.yml"
IMAGES=$WORK/images

# Archive « docker save » d'une image arm64, sans toucher aux images locales de la machine
# (une image postgres:16 amd64 qui sert ici n'est pas remplacée) : le constructeur buildx exporte
# directement dans un fichier.
export_image() { # export_image IMAGE NOM [CONTEXTE]
  local tmp=$IMAGES/.$2.tar
  if [ $# -ge 3 ]; then
    # Image de l'API, construite depuis CONTEXTE ; aussi étiquetée jollof-api:latest, le nom par
    # défaut de docker-compose.box.yml.
    docker buildx build --builder "$BUILDER" --platform linux/arm64 -t "$1" -t jollof-api:latest \
      --output "type=docker,dest=$tmp" "$3"
  else
    printf 'FROM %s\n' "$1" | docker buildx build --builder "$BUILDER" --platform linux/arm64 -t "$1" \
      --output "type=docker,dest=$tmp" -
  fi
  gzip -f -6 "$tmp"
  mv "$tmp.gz" "$IMAGES/$2.tar.gz"
  info "  $IMAGES/$2.tar.gz ($(du -h "$IMAGES/$2.tar.gz" | cut -f 1))"
}

build_images() {
  docker buildx version >/dev/null 2>&1 || die "docker buildx est nécessaire (paquet docker-buildx-plugin)."
  mkdir -p "$IMAGES"
  if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
    docker buildx create --name "$BUILDER" --driver docker-container >/dev/null
  fi
  # L'étape finale du Dockerfile exécute une commande dans l'image arm64 : émulation nécessaire
  # sur un PC x86-64.
  docker buildx inspect --bootstrap "$BUILDER" | grep -q 'linux/arm64' \
    || die "émulation arm64 absente : docker run --privileged --rm tonistiigi/binfmt --install arm64"
  info "Images Docker arm64 (API $VERSION, $PG_IMAGE)…"
  rm -f "$IMAGES"/jollof-api-*.tar.gz
  export_image "jollof-api:$VERSION" "jollof-api-$VERSION-arm64" "$SERVER"
  export_image "$PG_IMAGE" "$(printf '%s' "$PG_IMAGE" | tr ':/' '--')-arm64"
  if [ "$WITH_TOOLCHAIN" = 1 ]; then
    export_image "$TOOLCHAIN_IMAGE" "$(basename "$TOOLCHAIN_IMAGE" | tr ':' '-')-arm64"
  else
    rm -f "$IMAGES"/nginx-unprivileged-*.tar.gz
  fi
}

prepare_pigen() {
  local pg=$WORK/pi-gen files cur f
  if [ -d "$pg/.git" ]; then
    cur=$(git -C "$pg" describe --tags --exact-match 2>/dev/null || true)
    if [ "$cur" != "$PIGEN_REF" ]; then
      info "pi-gen : passage à $PIGEN_REF…"
      git -C "$pg" fetch --depth 1 origin tag "$PIGEN_REF"
      git -C "$pg" checkout -q -f "$PIGEN_REF"
    fi
  else
    info "pi-gen : téléchargement de $PIGEN_REF…"
    git clone -q --depth 1 --branch "$PIGEN_REF" "$PIGEN_REPO" "$pg"
  fi
  # Étape Jollof et fichiers du serveur, recopiés à chaque construction.
  rm -rf "$pg/stage-jollof"
  cp -a "$HERE/stage-jollof" "$pg/stage-jollof"
  files=$pg/stage-jollof/01-jollof/files/jollof
  mkdir -p "$files/docker" "$files/toolchain" "$files/images" "$files/pi-image"
  for f in install.sh docker-compose.box.yml .env.example README.md API.md docker/backup.sh \
    toolchain/mirror.sh toolchain/nginx.conf pi-image/README.md; do
    cp "$SERVER/$f" "$files/$f"
  done
  cp "$IMAGES"/*.tar.gz "$files/images/"
  chmod 0755 "$files/install.sh" "$files/toolchain/mirror.sh" "$pg/stage-jollof/prerun.sh" \
    "$pg"/stage-jollof/*/[0-9][0-9]-run.sh "$pg/stage-jollof/01-jollof/files/jollof-firstboot.sh"
  # Seule l'image de l'étape Jollof est exportée (pas Raspberry Pi OS Lite seul).
  touch "$pg/stage2/SKIP_IMAGES"
  cp "$CONFIG" "$pg/config"
}

if [ "$SKIP_IMAGES" = 0 ]; then build_images; fi
ls "$IMAGES"/jollof-api-*.tar.gz >/dev/null 2>&1 || die "aucune archive de l'API dans $IMAGES (relancer sans --skip-images)."
if [ "$IMAGES_ONLY" = 1 ]; then
  info "Archives prêtes dans $IMAGES : les copier dans /opt/jollof/images/ du boîtier, puis sudo /opt/jollof/install.sh"
  exit 0
fi

prepare_pigen
info "Construction de l'image Raspberry Pi avec pi-gen (1 à 2 heures)…"
(cd "$WORK/pi-gen" && CONTINUE=$RESUME PRESERVE_CONTAINER=$RESUME ./build-docker.sh)
mkdir -p "$HERE/deploy"
cp -a "$WORK/pi-gen/deploy/." "$HERE/deploy/"
info "Image prête dans $HERE/deploy :"
ls -lh "$HERE/deploy"
