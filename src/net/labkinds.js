// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Types de contrôles réseau des TP : ces constantes sont lues au démarrage (panneau des TP) ; les contrôles eux-mêmes
// (src/net/labcheck.js, avec la simulation du réseau) se chargent à la demande, quand un TP réseau en a besoin.

/** Contrôles réseau relus seuls (tutoriels) : structure du plan, liens, adresses, ping… */
export const NET_AUTO = new Set(['net-devices', 'net-cable', 'net-link', 'net-ping', 'net-dhcp', 'net-poe', 'net-ok', 'net-ip', 'net-wifi']);
/** Contrôles en direct : le programme de la carte doit tourner (page web, MQTT, Modbus). */
export const NET_LIVE = new Set(['net-http', 'net-mqtt', 'net-modbus']);
export const isNetCheck = t => NET_AUTO.has(t) || NET_LIVE.has(t);
