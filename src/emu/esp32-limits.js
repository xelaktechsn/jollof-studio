// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Limites du mode fidèle de l'ESP32 (QEMU d'Espressif). Fichier léger : l'interface le lit sans charger l'émulateur.
//   Wi-Fi et Bluetooth : QEMU n'émule pas la radio de l'ESP32 (le premier WiFi.mode() fait planter la carte), et le
//     cœur arduino-esp32 précompilé n'a pas le pilote Ethernet que QEMU sait émuler (open_eth) ; ces programmes
//     restent sur l'interpréteur, qui simule le Wi-Fi (réseau du projet, serveur web, HTTPClient, ESP-NOW) et le
//     Bluetooth (BluetoothSerial). Voir docs/ESP32-QEMU-TRIAL.md, « Wi-Fi ».
//   Modules du montage : les modèles de src/emu/devices répondent par la cale (src/emu/esp32-bridge.js), sauf le
//     récepteur infrarouge : IRremote échantillonne sa broche par une interruption de minuterie toutes les 50 µs, et les
//     alarmes des minuteries matérielles (timerAlarm) ne déclenchent aucune interruption dans le QEMU d'Espressif
//     (essai : aucune en 3 s). Avec un récepteur infrarouge, la carte reste sur l'interpréteur, qui le simule.
//     MAX485 non plus : son modèle (src/emu/devices/uart.js) ne relie le bus RS-485 qu'à des liaisons SoftwareSerial,
//     et l'ESP32 n'a que des ports série matériels. HX711 enfin : ses lectures brutes répondent, mais une suite de mesures
//     (get_units) reste parfois bloquée en attendant « donnée prête » ; tant que ce n'est pas fiable, il reste aussi sur
//     l'interpréteur.
import { tl } from '../i18n/index.js';

/** Bibliothèques réseau : Wi-Fi, Bluetooth, et ce qui en dépend (serveur web, HTTP, MQTT, ESP-NOW, OTA…). */
const NET = /^(WiFi\w*|WebServer|ESPAsyncWebServer|AsyncTCP|AsyncUDP|HTTPClient|HTTPUpdate\w*|ESPmDNS|ArduinoOTA|DNSServer|esp_now|esp_wifi|BluetoothSerial|BLE\w*|NimBLE\w*|PubSubClient|ESP32Ping|Network\w*|ETH|Firebase\w*|ThingSpeak|UniversalTelegramBot|WebSocketsClient|WebSocketsServer)\.h$/;

/** Bibliothèque réseau incluse par le programme (« WiFi.h »), sinon null. */
export function netInclude(code) {
  for (const m of String(code).matchAll(/^[ \t]*#\s*include\s*[<"]([^>"]+)[>"]/gm)) if (NET.test(m[1])) return m[1];
  return null;
}
/** Raison de ne pas lancer ce programme en mode fidèle sur l'ESP32 (il reste sur l'interpréteur), sinon null. */
export function esp32Refusal(code) {
  const inc = netInclude(code);
  return inc ? tl('L’émulateur de l’ESP32 n’a pas de radio Wi-Fi ni Bluetooth : ce programme ({0}) tourne sur le simulateur intégré, avec le Wi-Fi simulé.', inc) : null;
}

/** Types de modules que le mode fidèle de l'ESP32 ne fait pas répondre. */
export const UNBRIDGED = ['ir', 'max485', 'hx711'];

/** Message pour les modules branchés qui ne répondront pas (noms des composants), sinon null. */
export function unbridgedWarning(comps) {
  if (!comps.length) return null;
  const names = [...new Set(comps.map(c => c.name || c.type))].join(', ');
  return tl('Émulateur de l’ESP32 : {0} ne répondront pas.', names);
}
