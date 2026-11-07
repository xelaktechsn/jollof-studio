#!/bin/bash -e
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mamadou Sarr
# Exécuté dans le système de l'image (chroot arm64) : Docker Engine et son plugin compose, depuis le
# dépôt apt officiel de Docker, comme le fait install.sh sur un boîtier déjà installé. Les services
# ne démarrent pas ici (pas de systemd dans le chroot) ; ils sont activés pour le premier démarrage.
# shellcheck disable=SC1091
. /etc/os-release
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<SOURCES
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
SOURCES
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
apt-get clean
systemctl enable docker.service containerd.service
