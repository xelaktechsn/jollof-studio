// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Cartes du mode « fidèle » (vrai programme sur processeur émulé) et leur identifiant arduino-cli.
// Fichier léger : l'interface le lit sans charger le compilateur ni l'émulateur.
export const FQBN = { uno: 'arduino:avr:uno', nano: 'arduino:avr:nano' };
export const EMULATED = new Set(Object.keys(FQBN));
