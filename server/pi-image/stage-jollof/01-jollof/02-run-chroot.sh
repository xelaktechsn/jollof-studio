#!/bin/bash -e
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mamadou Sarr
# Exécuté dans le système de l'image : installation au premier démarrage, nom .local (avahi).
systemctl enable jollof-firstboot.service
systemctl enable avahi-daemon.service
