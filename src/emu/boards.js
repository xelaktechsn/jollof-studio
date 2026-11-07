// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Cartes du mode « fidèle » (vrai programme sur processeur émulé) et leur identifiant arduino-cli.
// Uno et Nano : ATmega328P (src/emu/avr.js) ; Pico : RP2040 avec le cœur arduino-pico (src/emu/rp2040.js).
// Fichier léger : l'interface le lit sans charger le compilateur ni l'émulateur.
export const FQBN = { uno: 'arduino:avr:uno', nano: 'arduino:avr:nano', pico: 'rp2040:rp2040:rpipico' };
export const EMULATED = new Set(Object.keys(FQBN));
