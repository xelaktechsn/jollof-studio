// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Analyseur de bus : chaque échange I2C, SPI et série d'une carte, tel qu'un analyseur logique le décoderait.
// Les processeurs émulés (src/emu/devices/index.js) et le simulateur intégré (src/prog/runtime.js) signalent les
// événements bruts (départ, adresse, octet, acquittement, arrêt ; sélection, octet échangé ; octet émis ou reçu) à la
// sonde de leur carte ; la sonde les regroupe en transactions lisibles :
//   I2C  : { bus: 'i2c', board, t, addr, write, ack, dev, bytes: [{ v, ack }] }    (adresse sans réponse : ack false)
//   SPI  : { bus: 'spi', board, t, dev, mosi: [...], miso: [...] }                 (de la sélection à la désélection)
//   série: { bus: 'uart', board, t, port, dir: 'tx' | 'rx', bytes: [...] }          (regroupés par ligne ou par pause)
// t : temps simulé de la carte (ms). Sans interface (tests sous Node).

/** Historique partagé par toutes les cartes : les dernières transactions (max), et des abonnés prévenus à chaque ajout. */
export function createBusLog({ max = 3000 } = {}) {
  const rows = [], subs = new Set();
  let paused = false, seq = 0;
  const emit = r => {
    if (paused) return;
    r.id = ++seq; rows.push(r);
    if (rows.length > max) rows.splice(0, rows.length - max);
    subs.forEach(f => { try { f(r); } catch (e) { console.error(e); } });
  };
  /** Transaction encore ouverte modifiée (octet ajouté) : les abonnés la revoient. */
  const touch = r => { if (!paused && r.id) subs.forEach(f => { try { f(r, true); } catch (e) { console.error(e); } }); };

  /**
   * Sonde d'une carte. clock() → temps simulé (ms). Rend les fonctions que les bus appellent.
   */
  function probe(board, clock = () => 0) {
    const now = () => { const v = +clock(); return Number.isFinite(v) ? v : 0; };
    let i2c = null, spi = null;
    const uart = new Map(); // port|dir → transaction ouverte
    const closeI2c = () => { if (i2c) { i2c.end = now(); touch(i2c); } i2c = null; };
    return {
      /* I2C */
      i2cStart() { closeI2c(); },
      i2cConnect(addr, write, ack, dev = null) {
        closeI2c();
        i2c = { bus: 'i2c', board, t: now(), addr: addr & 127, write: !!write, ack: !!ack, dev, bytes: [] };
        emit(i2c);
      },
      /** Octet sur le bus : écrit par la carte (write) ou lu ; ack : acquitté (écriture : par le module ; lecture : par la carte). */
      i2cByte(v, ack = true) { if (!i2c) return; i2c.bytes.push({ v: v & 255, ack: !!ack }); touch(i2c); },
      i2cStop() { closeI2c(); },
      /* SPI */
      spiSelect(dev = null) { spi = { bus: 'spi', board, t: now(), dev, mosi: [], miso: [] }; emit(spi); },
      spiByte(mosi, miso) {
        if (!spi) { spi = { bus: 'spi', board, t: now(), dev: null, mosi: [], miso: [], open: true }; emit(spi); } // aucune sélection connue
        spi.mosi.push(mosi & 255); spi.miso.push(miso & 255); touch(spi);
      },
      spiDeselect() { if (spi) { spi.end = now(); touch(spi); } spi = null; },
      /* Série : une ligne par transaction (fin de ligne, ou 5 ms de silence, ou 64 octets). */
      uart(port, dir, byte) {
        const key = port + '|' + dir, t = now();
        let r = uart.get(key);
        if (!r || t - r.last > 5 || r.bytes.length >= 64 || r.nl) { r = { bus: 'uart', board, t, port, dir, bytes: [], last: t }; uart.set(key, r); emit(r); }
        r.bytes.push(byte & 255); r.last = t; if (byte === 10) r.nl = true;
        touch(r);
      }
    };
  }
  return {
    probe,
    list: () => rows,
    clear() { rows.length = 0; subs.forEach(f => { try { f(null); } catch (e) { console.error(e); } }); },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    get paused() { return paused; },
    set paused(v) { paused = !!v; }
  };
}

/* ---------- Écriture ---------- */
export const hex = b => (b & 255).toString(16).toUpperCase().padStart(2, '0');
/** Octets en texte lisible : caractères imprimables, sinon \n, \r, \xNN. */
export function ascii(bytes) {
  return bytes.map(b => (b === 10 ? '\\n' : b === 13 ? '\\r' : b >= 32 && b < 127 ? String.fromCharCode(b) : `\\x${hex(b)}`)).join('');
}
/** Une transaction en une ligne de texte (export CSV, tests). */
export function describe(r) {
  if (r.bus === 'i2c') {
    const head = `0x${hex(r.addr)} ${r.write ? 'W' : 'R'}${r.ack ? '' : ' NACK'}`;
    return r.bytes.length ? `${head} : ${r.bytes.map(x => hex(x.v) + (x.ack ? '' : '*')).join(' ')}` : head;
  }
  if (r.bus === 'spi') return `MOSI ${r.mosi.map(hex).join(' ')} | MISO ${r.miso.map(hex).join(' ')}`;
  return `${r.port} ${r.dir.toUpperCase()} « ${ascii(r.bytes)} »`;
}
/** Export : une ligne CSV par transaction (séparateur ;, pour les tableurs en français). */
export function toCsv(rows, boardName = id => id) {
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  return ['t_ms;carte;bus;module;detail', ...rows.map(r => [r.t.toFixed(3), q(boardName(r.board)), r.bus, q(r.dev || ''), q(describe(r))].join(';'))].join('\n');
}
