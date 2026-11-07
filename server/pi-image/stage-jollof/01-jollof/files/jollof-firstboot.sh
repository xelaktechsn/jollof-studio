#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mamadou Sarr
# Premier démarrage du boîtier école (image Raspberry Pi) : installe et démarre le serveur Jollof
# Studio avec les images Docker fournies dans /opt/jollof/images (aucun Internet nécessaire).
# Les secrets (.env) sont tirés au hasard ici, sur ce boîtier : deux cartes gravées depuis la même
# image n'ont jamais les mêmes. En cas d'échec, le service réessaie (puis au démarrage suivant).
# Suivi : journalctl -u jollof-firstboot -f
set -eu
DONE=/var/lib/jollof/firstboot.done
mkdir -p /var/lib/jollof
echo "Jollof Studio : première installation du boîtier école (quelques minutes)…"
/opt/jollof/install.sh --yes --dir /opt/jollof
touch "$DONE"
systemctl disable jollof-firstboot.service >/dev/null 2>&1 || true
echo "Jollof Studio : boîtier prêt."
