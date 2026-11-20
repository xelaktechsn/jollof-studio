// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Messages DNS (RFC 1035), octet par octet : la question qu'envoie un programme (Dns.cpp de la bibliothèque Ethernet,
// par le W5500) au serveur que le DHCP lui a donné, et la réponse de la box (relais DNS du réseau local), qui connaît
// les noms des appareils du plan réseau. Port 53 en UDP.

/** Lit une question : { id, name, qtype, end (fin de la question) } ou null. */
export function parseDnsQuery(b) {
  if (!b || b.length < 17 || (b[2] & 0x80) || ((b[4] << 8) | b[5]) < 1) return null; // réponse, ou pas de question
  const labels = [];
  let i = 12;
  while (i < b.length && b[i]) {
    const n = b[i]; if (n > 63 || i + 1 + n > b.length) return null;
    labels.push(String.fromCharCode(...b.slice(i + 1, i + 1 + n))); i += 1 + n;
  }
  if (i + 5 > b.length) return null;
  return { id: (b[0] << 8) | b[1], name: labels.join('.'), qtype: (b[i + 1] << 8) | b[i + 2], end: i + 5 };
}
/** Réponse à la question q (octets du message b) : l'adresse ip (enregistrement A), ou « nom inconnu » (NXDOMAIN). */
export function dnsResponse(b, q, ip) {
  const head = [b[0], b[1], 0x81 | (b[2] & 0x01), ip ? 0x80 : 0x83, 0, 1, 0, ip ? 1 : 0, 0, 0, 0, 0];
  const out = [...head, ...b.slice(12, q.end)];
  if (ip) out.push(0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0x0e, 0x10, 0, 4, ...ip.split('.').map(x => +x & 255)); // durée : 1 h
  return Uint8Array.from(out);
}
