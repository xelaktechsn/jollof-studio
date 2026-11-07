// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Lecture d'un fichier Intel HEX (sortie d'avr-gcc) en mémoire programme.

/**
 * Octets de la mémoire flash décrits par un texte Intel HEX. size : taille de la flash (32 Ko pour l'ATmega328P).
 * Gère les enregistrements de données (00), de fin (01) et d'adresse étendue (02, 04). Lève une erreur si une
 * ligne est mal formée ou si sa somme de contrôle est fausse.
 */
export function parseHex(text, size = 0x8000) {
  const flash = new Uint8Array(size);
  let base = 0, n = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    n++;
    if (line[0] !== ':' || line.length < 11) throw new Error(`HEX : ligne ${n} mal formée`);
    const bytes = [];
    for (let i = 1; i < line.length; i += 2) bytes.push(parseInt(line.substr(i, 2), 16));
    if (bytes.some(Number.isNaN)) throw new Error(`HEX : ligne ${n} mal formée`);
    if ((bytes.reduce((a, b) => a + b, 0) & 0xff) !== 0) throw new Error(`HEX : somme de contrôle fausse ligne ${n}`);
    const len = bytes[0], addr = (bytes[1] << 8) | bytes[2], type = bytes[3], data = bytes.slice(4, 4 + len);
    if (type === 0) {
      for (let i = 0; i < len; i++) { const a = base + addr + i; if (a < size) flash[a] = data[i]; }
    } else if (type === 1) break;
    else if (type === 2) base = ((data[0] << 8) | data[1]) << 4;
    else if (type === 4) base = ((data[0] << 8) | data[1]) << 16;
  }
  return flash;
}
