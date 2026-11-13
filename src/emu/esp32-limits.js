// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Limites du mode fidèle de l'ESP32 (bêta, QEMU d'Espressif). Fichier léger : l'interface le lit sans charger
// l'émulateur.
//   Wi-Fi et Bluetooth : pas de radio émulée (le premier WiFi.mode() fait planter la carte) ; ces programmes restent
//     sur l'interpréteur, qui simule le Wi-Fi.
//   Modules I2C, SPI, 1-Wire et à signaux temporisés : pas encore reliés à l'émulateur ; ils ne répondent pas.
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
  return inc ? tl('Wi-Fi et Bluetooth ne sont pas émulés en mode fidèle de l’ESP32 (bêta) : ce programme ({0}) tourne en mode Débutant, avec le Wi-Fi simulé.', inc) : null;
}

/** Types de modules que les modèles de src/emu/devices font répondre, pas encore reliés à QEMU. */
export const UNBRIDGED = ['lcd1602', 'oled', 'bmp280', 'bme280', 'bh1750', 'hx711', 'mpu6050', 'dht11', 'dht22', 'ds18b20', 'hcsr04', 'ws2812', 'keypad', 'ir', 'rc522', 'nrf24', 'hc05', 'sim800'];

/** Message pour les modules branchés qui ne répondront pas (noms des composants), sinon null. */
export function unbridgedWarning(comps) {
  if (!comps.length) return null;
  const names = [...new Set(comps.map(c => c.name || c.type))].join(', ');
  return tl('Mode fidèle de l’ESP32 (bêta) : {0} ne répondront pas. Les modules I2C, SPI, 1-Wire et à signaux temporisés ne sont pas encore reliés à l’émulateur ; passez en mode Débutant pour les utiliser.', names);
}
