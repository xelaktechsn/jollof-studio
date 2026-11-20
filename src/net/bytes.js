// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Octets sur les connexions du réseau simulé : une chaîne dont chaque caractère est un octet (0 à 255).
/** Texte (encodé en UTF-8) ou octets → chaîne d'octets (un caractère par octet, 0 à 255). */
export function byteStr(d) {
  const b = typeof d === 'string' ? new TextEncoder().encode(d) : d;
  let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i] & 255);
  return s;
}
/** Chaîne d'octets → texte (UTF-8 décodé ; un octet invalide devient �). */
export const fromBytes = s => new TextDecoder('utf-8').decode(Uint8Array.from(s, c => c.charCodeAt(0) & 255));
/** Chaîne d'octets → tableau d'octets. */
export const bytesOf = s => Uint8Array.from(s, c => c.charCodeAt(0) & 255);
