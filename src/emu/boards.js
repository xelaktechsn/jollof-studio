// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Cartes du mode « fidèle » (vrai programme sur processeur émulé) et leur identifiant arduino-cli.
// Uno et Nano : ATmega328P, Mega 2560 : ATmega2560 (src/emu/avr.js, src/emu/avr-chips.js) ; Pico : RP2040 avec le cœur arduino-pico (src/emu/rp2040.js) ;
// ESP32, ESP32-S3, ESP32-C3 : QEMU d'Espressif, programme à part (src/emu/esp32.js), compilés en flash DIO (QIO ne
// démarre pas dans QEMU), le moniteur série sur l'UART0 (pas l'USB natif).
// Fichier léger : l'interface le lit sans charger le compilateur ni l'émulateur.
export const FQBN = {
  uno: 'arduino:avr:uno', nano: 'arduino:avr:nano', mega: 'arduino:avr:mega', pico: 'rp2040:rp2040:rpipico',
  esp32: 'esp32:esp32:esp32:FlashMode=dio', esp32s3: 'esp32:esp32:esp32s3:FlashMode=dio', esp32c3: 'esp32:esp32:esp32c3:FlashMode=dio'
};
/** Cartes dont le mode fidèle demande l'émulateur QEMU (téléchargé à la première utilisation). */
export const QEMU_KINDS = new Set(['esp32', 'esp32s3', 'esp32c3']);
/** Cartes dont le mode fidèle est utilisable maintenant : l'ESP32 s'y ajoute quand QEMU est installé. */
export const EMULATED = new Set(Object.keys(FQBN).filter(k => !QEMU_KINDS.has(k)));
/**
 * QEMU installé (ou retiré) : le mode fidèle des cartes qui en dépendent devient utilisable (ou non). kinds : les
 * cartes que l'émulateur installé sait faire tourner (l'ESP32-C3 demande qemu-system-riscv32), toutes par défaut.
 */
export function setQemuReady(on, kinds = null) {
  for (const k of QEMU_KINDS) { if (on && (!kinds || kinds.includes(k))) EMULATED.add(k); else EMULATED.delete(k); }
}
