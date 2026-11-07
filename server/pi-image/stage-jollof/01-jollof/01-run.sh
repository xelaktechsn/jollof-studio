#!/bin/bash -e
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mamadou Sarr
# Exécuté sur la machine de construction (ROOTFS_DIR = système de l'image) : copie du serveur
# (files/jollof, préparé par build.sh : install.sh, docker-compose.box.yml, archives des images
# Docker…) dans /opt/jollof et service de premier démarrage.
if [ ! -f files/jollof/install.sh ] || [ ! -f files/jollof/docker-compose.box.yml ]; then
	echo "files/jollof incomplet : lancer pi-image/build.sh (pas pi-gen directement)" >&2
	exit 1
fi
install -d -m 0755 "${ROOTFS_DIR}/opt/jollof"
cp -a files/jollof/. "${ROOTFS_DIR}/opt/jollof/"
chown -R 0:0 "${ROOTFS_DIR}/opt/jollof"
chmod 0755 "${ROOTFS_DIR}/opt/jollof/install.sh"
install -m 0755 files/jollof-firstboot.sh "${ROOTFS_DIR}/usr/local/sbin/jollof-firstboot"
install -m 0644 files/jollof-firstboot.service "${ROOTFS_DIR}/etc/systemd/system/jollof-firstboot.service"
