// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modules d'un paquet (.jpart) qui parlent sur un bus ou par impulsions, décrits sans une ligne de code :
//   I2C : registres (pointeur puis lecture, auto-incrément, écritures gardées) et commandes (octets écrits →
//         réponse, avec CRC Sensirion au besoin) ;
//   SPI : trame lue en entier à chaque sélection (MAX6675…), ou registres (octet d'adresse, bit de lecture) ;
//   impulsions : fréquence proportionnelle à une grandeur (débitmètre, anémomètre).
// Chaque valeur se code à partir des mesures du montage (c.simR.data) : brut = arrondi(grandeur × scale + offset),
// sur bits bits (signé ou non), décalé de shift, octets dans l'ordre endian. Le même code sert à l'interpréteur
// (prog/runtime.js, Wire et SPI) et au mode fidèle (emu/devices/pkg.js), qui répondent donc pareil.

/** CRC-8 des capteurs Sensirion (SHT3x, SHT4x, SCD4x…) : polynôme 0x31, valeur initiale 0xFF. */
export function sensirionCrc(bytes) {
  let crc = 0xff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0x31) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** Valeur codée (registre, élément de réponse ou de trame) → octets. data : mesures { grandeur: valeur }. */
export function encodeValue(it, data) {
  const bits = it.bits || 16, n = bits / 8, q = data ? data[it.quantity] : undefined;
  const x = typeof q === 'boolean' ? +q : Number.isFinite(+q) ? +q : 0;
  const span = 2 ** (bits - (it.shift || 0));
  const lo = it.signed ? -span / 2 : 0, hi = it.signed ? span / 2 - 1 : span - 1;
  let raw = Math.max(lo, Math.min(hi, Math.round(x * (it.scale ?? 1) + (it.offset || 0))));
  raw *= 2 ** (it.shift || 0);
  if (raw < 0) raw += 2 ** bits; // complément à deux
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(Math.floor(raw / 2 ** (8 * i)) & 255);
  return it.endian === 'little' ? out.reverse() : out;
}
/** Valeur décodée par le programme (le chemin inverse) : sert aux tests et au code généré. */
export function decodeValue(it, bytes) {
  const bits = it.bits || 16, b = it.endian === 'little' ? [...bytes].reverse() : bytes;
  let raw = b.reduce((v, x) => v * 256 + x, 0);
  if (it.signed && raw >= 2 ** (bits - 1)) raw -= 2 ** bits;
  raw = Math.floor(raw / 2 ** (it.shift || 0));
  return (raw - (it.offset || 0)) / (it.scale ?? 1);
}
/** Suite d'éléments (réponse d'une commande, trame SPI) → octets : constantes, valeurs, CRC des octets précédents. */
export function encodeItems(items, data) {
  const out = [];
  let since = 0;
  for (const it of items || []) {
    if (it.bytes) out.push(...it.bytes);
    else if (it.crc) { out.push(sensirionCrc(out.slice(since))); since = out.length; continue; }
    else out.push(...encodeValue(it, data)); // les octets depuis le dernier CRC entrent dans le suivant
  }
  return out;
}

/**
 * Mémoire de registres, adressée par octet : constantes déclarées, puis écritures du programme ; valeurs mesurées
 * par-dessus. size : octets par registre (2 pour l'INA219, l'ADS1115, le TMP102 : le registre n occupe les octets
 * 2n et 2n + 1, et la lecture continue dans le registre suivant).
 */
function registers(list, data, size = 1) {
  const mem = new Map();
  for (const r of list || []) if (r.bytes) r.bytes.forEach((b, i) => mem.set(r.at * size + i, b));
  const values = (list || []).filter(r => r.quantity);
  return {
    mem,
    /** Image figée au début d'une lecture : une valeur sur plusieurs octets ne mélange pas deux mesures. */
    snapshot() { const m = new Map(); const d = data(); for (const r of values) encodeValue(r, d).forEach((b, i) => m.set(r.at * size + i, b)); return m; },
    byteAt(snap, a) { return snap.has(a) ? snap.get(a) : mem.has(a) ? mem.get(a) : 0; }
  };
}

/**
 * Module I2C d'un paquet. spec : { regBytes: 1 | 2 (octets de l'adresse de registre), regSize: 1 | 2 | 4 (octets par
 * registre), registers: [...], commands: [{ write, reply }] } ; data() : mesures.
 * Interface des modèles du mode fidèle : start(écriture), write(octet) → acquitté, read() → octet, stop().
 */
export function createI2c(spec, data) {
  const size = spec.regSize || 1, R = registers(spec.registers, data, size), rb = spec.regBytes || 1, mask = rb === 2 ? 0xffff : 0xff;
  let ptr = 0, wbuf = [], writing = false, reply = null, rpos = 0, snap = new Map();
  function commit() {
    const w = wbuf; wbuf = [];
    if (!w.length) return;
    const cmd = (spec.commands || []).find(c => c.write.length <= w.length && c.write.every((b, i) => w[i] === b));
    if (cmd) { reply = encodeItems(cmd.reply, data()); rpos = 0; return; }
    reply = null;
    if (w.length < rb) return;
    const p = (rb === 2 ? ((w[0] << 8) | w[1]) & mask : w[0]) * size;
    w.slice(rb).forEach((b, i) => R.mem.set(p + i, b)); // écritures gardées (configuration)
    ptr = p;
  }
  return {
    start(write) {
      if (writing) commit(); // départ répété : l'écriture du pointeur compte
      writing = !!write;
      if (!write) { snap = R.snapshot(); rpos = 0; }
    },
    write(b) { if (!writing) { writing = true; wbuf = []; } wbuf.push(b & 255); return true; },
    read() {
      if (reply) { const v = rpos < reply.length ? reply[rpos] : 0xff; rpos++; return v; }
      const v = R.byteAt(snap, ptr); ptr++; return v;
    },
    stop() { if (writing) commit(); writing = false; }
  };
}

/**
 * Module SPI d'un paquet. spec : { mode: 'frame', frame: [...] } ou { mode: 'register', registers, readBit,
 * readWhenSet, addrMask }. Interface : select(), transfer(octet) → octet, deselect().
 */
export function createSpi(spec, data) {
  const R = registers(spec.registers, data);
  let frame = [], i = 0, state = 'idle', read = true, ptr = 0, snap = new Map();
  return {
    select() { state = 'start'; i = 0; if (spec.mode === 'frame') frame = encodeItems(spec.frame, data()); },
    transfer(b) {
      if (spec.mode === 'frame') return i < frame.length ? frame[i++] : 0;
      if (state === 'start') {
        const bit = spec.readBit ?? 0x80;
        read = bit ? ((b & bit) !== 0) === (spec.readWhenSet !== false) : true;
        ptr = b & (spec.addrMask ?? 0x7f); snap = R.snapshot(); state = 'data';
        return 0;
      }
      if (read) { const v = R.byteAt(snap, ptr); ptr = (ptr + 1) & 0xff; return v; }
      R.mem.set(ptr, b & 255); ptr = (ptr + 1) & 0xff; return 0;
    },
    deselect() { state = 'idle'; }
  };
}

/** Fréquence d'une sortie à impulsions (Hz) pour la grandeur q : courbe par points, sinon hz par unité. */
export function pulseHz(it, q) {
  const x = Number.isFinite(+q) ? +q : 0;
  if (it.curve) {
    const c = it.curve;
    if (x <= c[0][0]) return Math.max(0, c[0][1]);
    for (let k = 1; k < c.length; k++) if (x <= c[k][0]) { const [x0, y0] = c[k - 1], [x1, y1] = c[k]; return Math.max(0, y0 + (y1 - y0) * (x - x0) / (x1 - x0)); }
    return Math.max(0, c[c.length - 1][1]);
  }
  return Math.max(0, x * (it.hzPer || 0));
}

/** Adresse I2C d'un module : l'adresse de base, ou l'autre si sa broche d'adresse est reliée à l'alimentation. */
export function i2cAddress(spec, high) { return high && spec.alt != null ? spec.alt : spec.address; }
