// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Types de contrôles réseau des TP : ces constantes sont lues au démarrage (panneau des TP) ; les contrôles eux-mêmes
// (src/net/labcheck.js, avec la simulation du réseau) se chargent à la demande, quand un TP réseau en a besoin.

/** Contrôles réseau relus seuls (tutoriels) : structure du plan, liens, adresses, ping… */
export const NET_AUTO = new Set(['net-devices', 'net-cable', 'net-link', 'net-ping', 'net-dhcp', 'net-poe', 'net-ok', 'net-ip', 'net-wifi']);
/** Contrôles en direct : le programme de la carte doit tourner (page web, MQTT, Modbus). */
export const NET_LIVE = new Set(['net-http', 'net-mqtt', 'net-modbus']);
/**
 * Contrôles de la conception professionnelle (VLAN, routage, plans, baies, fibre, Wi-Fi, certification, dimensionnement…) :
 * relus seuls eux aussi ; leur code est dans src/net/checks/*.js (LAB) et labcheck.js.
 */
export const NET_PRO = new Set(['net-vlan', 'net-trace', 'net-stp', 'net-lag', 'net-route', 'net-fibre', 'net-subnet', 'net-plan', 'net-path', 'net-wifi-cover', 'net-wifi-chan', 'net-rack', 'net-power', 'net-patching', 'net-dim', 'net-labels', 'net-bom', 'net-cert']);
for (const t of NET_PRO) NET_AUTO.add(t);
export const isNetCheck = t => NET_AUTO.has(t) || NET_LIVE.has(t);
