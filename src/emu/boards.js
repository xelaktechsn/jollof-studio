// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Cartes du mode « fidèle » (vrai programme sur processeur émulé) et leur identifiant arduino-cli.
// Uno et Nano : ATmega328P (src/emu/avr.js) ; Pico : RP2040 avec le cœur arduino-pico (src/emu/rp2040.js) ;
// ESP32 : QEMU d'Espressif, programme à part (src/emu/esp32.js), compilé en flash DIO (QIO ne démarre pas dans QEMU).
// Fichier léger : l'interface le lit sans charger le compilateur ni l'émulateur.
export const FQBN = { uno: 'arduino:avr:uno', nano: 'arduino:avr:nano', pico: 'rp2040:rp2040:rpipico', esp32: 'esp32:esp32:esp32:FlashMode=dio' };
/** Cartes dont le mode fidèle demande l'émulateur QEMU (téléchargé à la première utilisation). */
export const QEMU_KINDS = new Set(['esp32']);
/** Cartes dont le mode fidèle est utilisable maintenant : l'ESP32 s'y ajoute quand QEMU est installé. */
export const EMULATED = new Set(Object.keys(FQBN).filter(k => !QEMU_KINDS.has(k)));
/** QEMU installé (ou retiré) : le mode fidèle des cartes qui en dépendent devient utilisable (ou non). */
export function setQemuReady(on) {
  for (const k of QEMU_KINDS) { if (on) EMULATED.add(k); else EMULATED.delete(k); }
}
