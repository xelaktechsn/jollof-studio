// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Messages DHCP (RFC 2131 et options RFC 2132), octet par octet : ce que la bibliothèque Ethernet d'Arduino envoie
// par le W5500 (Dhcp.cpp) et ce que la box lui répond. Client sur le port 68, serveur sur le port 67.
import { macStr, macBytes, ipBytes, ipFromBytes, maskOf, ipStr } from './ip.js';

export const DHCP = { DISCOVER: 1, OFFER: 2, REQUEST: 3, DECLINE: 4, ACK: 5, NAK: 6, RELEASE: 7, INFORM: 8 };
const MAGIC = [99, 130, 83, 99];

/** Lit un message : { op, xid, mac, ciaddr, yiaddr, type, opts: Map(code → octets) } ou null. */
export function parseDhcp(b) {
  if (!b || b.length < 240) return null;
  if (MAGIC.some((m, i) => b[236 + i] !== m)) return null;
  const opts = new Map();
  for (let i = 240; i < b.length;) {
    const c = b[i]; if (c === 255) break; if (c === 0) { i++; continue; }
    const n = b[i + 1]; if (i + 2 + n > b.length) break;
    opts.set(c, Array.from(b.slice(i + 2, i + 2 + n))); i += 2 + n;
  }
  const t = opts.get(53);
  return { op: b[0], xid: ((b[4] << 24) >>> 0) + (b[5] << 16) + (b[6] << 8) + b[7], mac: macStr(b.slice(28, 34)), ciaddr: ipFromBytes(b.slice(12, 16)), yiaddr: ipFromBytes(b.slice(16, 20)), type: t ? t[0] : 0, opts };
}
function base(op, xid, mac) {
  const b = new Uint8Array(240);
  b[0] = op; b[1] = 1; b[2] = 6;
  b[4] = xid >>> 24; b[5] = (xid >>> 16) & 255; b[6] = (xid >>> 8) & 255; b[7] = xid & 255;
  b[10] = 0x80; // drapeau « diffusion »
  macBytes(mac).forEach((x, i) => { b[28 + i] = x; });
  MAGIC.forEach((m, i) => { b[236 + i] = m; });
  return b;
}
const cat = (a, extra) => { const o = new Uint8Array(a.length + extra.length); o.set(a); o.set(extra, a.length); return o; };
/** Réponse du serveur : OFFER ou ACK avec masque, routeur, DNS, durée du bail, identifiant du serveur. */
export function dhcpServerPacket({ type, xid, mac, yiaddr, server, prefix, gw, dns, lease = 86400 }) {
  const b = base(2, xid, mac);
  ipBytes(yiaddr).forEach((x, i) => { b[16 + i] = x; });
  ipBytes(server).forEach((x, i) => { b[20 + i] = x; });
  const L = [lease >>> 24, (lease >>> 16) & 255, (lease >>> 8) & 255, lease & 255];
  return cat(b, [53, 1, type, 54, 4, ...ipBytes(server), 51, 4, ...L, 58, 4, ...L.map((x, i) => (i === 3 ? x : x)), 1, 4, ...ipBytes(ipStr(maskOf(prefix))), 3, 4, ...ipBytes(gw), 6, 4, ...ipBytes(dns), 255]);
}
/** Demande d'un client (tests, PC simulé) : DISCOVER ou REQUEST (adresse demandée). */
export function dhcpClientPacket({ type, xid, mac, want, server }) {
  const b = base(1, xid, mac), o = [53, 1, type, 61, 7, 1, ...macBytes(mac)];
  if (want) o.push(50, 4, ...ipBytes(want));
  if (server) o.push(54, 4, ...ipBytes(server));
  o.push(55, 3, 1, 3, 6, 255);
  return cat(b, o);
}
