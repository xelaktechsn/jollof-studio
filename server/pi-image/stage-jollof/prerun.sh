#!/bin/bash -e
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mamadou Sarr
# Étape pi-gen « stage-jollof » : part du système de stage2 (Raspberry Pi OS Lite).
if [ ! -d "${ROOTFS_DIR}" ]; then
	copy_previous
fi
