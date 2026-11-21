// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Adresses IPv4 et adresses MAC : lecture, écriture, sous-réseaux (masque ou préfixe /24, RFC 950 et RFC 4632).

/** « 192.168.1.10 » → entier non signé, ou null. */
const IPS = new Map(); // mémoire des adresses lues (le vérificateur et le routage relisent les mêmes)
export function ipNum(s) {
  if (typeof s === 'string') { const c = IPS.get(s); if (c !== undefined) return c; const v = ipNum0(s); if (IPS.size > 50000) IPS.clear(); IPS.set(s, v); return v; }
  return ipNum0(s);
}
function ipNum0(s) {
  const m = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  const b = m.slice(1).map(Number); if (b.some(x => x > 255)) return null;
  return ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
}
export const ipStr = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
export const isIp = s => ipNum(s) != null;
/** Préfixe → masque (24 → 0xffffff00). */
export const maskOf = prefix => (prefix <= 0 ? 0 : (0xffffffff << (32 - Math.min(32, prefix))) >>> 0);
/** Masque écrit (« 255.255.255.0 ») ou préfixe (« /24 », « 24 ») → préfixe, ou null s'il n'est pas contigu. */
export function prefixOf(s) {
  if (typeof s === 'number') return Number.isInteger(s) && s >= 0 && s <= 32 ? s : null;
  const t = String(s ?? '').trim().replace(/^\//, '');
  if (/^\d{1,2}$/.test(t)) { const n = +t; return n <= 32 ? n : null; }
  const n = ipNum(t); if (n == null) return null;
  for (let p = 0; p <= 32; p++) if (maskOf(p) === n) return p;
  return null;
}
export const maskStr = p => ipStr(maskOf(p));
export const netOf = (ip, prefix) => (ipNum(ip) & maskOf(prefix)) >>> 0;
/** Les deux adresses sont-elles dans le même sous-réseau (préfixe du premier) ? */
export const sameNet = (a, b, prefix) => ipNum(a) != null && ipNum(b) != null && netOf(a, prefix) === netOf(b, prefix);
/** Adresse d'hôte valable dans son sous-réseau : ni l'adresse du réseau, ni la diffusion (sauf /31 et /32). */
export function hostOk(ip, prefix) {
  const n = ipNum(ip); if (n == null || prefix == null) return false;
  if (prefix >= 31) return true;
  const net = (n & maskOf(prefix)) >>> 0, bc = (net | (~maskOf(prefix) >>> 0)) >>> 0;
  return n !== net && n !== bc;
}
export const isBroadcast = ip => ip === '255.255.255.255';
/** Adresse locale au lien (169.254.0.0/16, RFC 3927) : donnée par le système quand aucun serveur DHCP ne répond. */
export const isLinkLocal = ip => /^169\.254\./.test(String(ip || ''));
/** Adresse MAC d'un équipement, stable : dérivée de son identifiant (préfixe administré localement 02:…). */
const MACS = new Map(); // mémoire (un grand plan en demande des milliers par recalcul)
export function macFor(id) {
  const k = String(id), m = MACS.get(k); if (m) return m;
  if (MACS.size > 20000) MACS.clear();
  MACS.set(k, macOf(k)); return MACS.get(k);
}
function macOf(id) {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const b = [0x02, 0x4a, (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255];
  return b.map(x => x.toString(16).padStart(2, '0')).join(':').toUpperCase();
}
export const macBytes = s => String(s).split(':').map(h => parseInt(h, 16) & 255);
export const macStr = b => Array.from(b).slice(0, 6).map(x => (x & 255).toString(16).padStart(2, '0')).join(':').toUpperCase();
export const ipBytes = s => { const n = ipNum(s) ?? 0; return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; };
export const ipFromBytes = b => Array.from(b).slice(0, 4).map(x => x & 255).join('.');
