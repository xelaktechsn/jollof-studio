// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modules du montage pour l'ESP32 émulé par QEMU (mode fidèle) : les mêmes modèles que pour l'Uno et le Pico
// (src/emu/devices), branchés sur ce que la cale du programme (src/emu/esp32-shim/jollof_qemu_shim.cpp) envoie par
// l'UART1, au lieu des broches et bus d'un processeur émulé ici.
//   - Broches reliées à un module : chaque pinMode/digitalWrite de la carte arrive dans l'ordre, à l'heure « des
//     modules » (le temps de la carte sans les attentes de réponse) ; une lecture après un changement demande où en
//     est la ligne, et la suite déjà programmée par le module (réponse d'un DHT, écho d'un HC-SR04 : jusqu'à 60 ms),
//     que la cale rejoue ensuite à la microseconde près. Ce que les modules font d'eux-mêmes (télécommande infrarouge,
//     codeur rotatif, touche du clavier, fin de conversion…) part avec 60 ms d'avance prise sur leur heure : un
//     retard constant, qui garde les durées.
//   - Bus I2C, SPI : chaque échange de Wire et SPIClass, octet par octet, vers le modèle du module (et l'analyseur de
//     bus) ; RMT (NeoPixel) : les symboles rejoués sur la broche ; Serial1/Serial2 : octets vers les modules série ;
//     1-Wire : chaque créneau joué au temps des modules contre le modèle des sondes.
// Le temps des modules est ici un compteur de cycles à 240 MHz, qui ne recule jamais.
import { attachDevices } from './devices/index.js';
import { SERIAL_TYPES } from '../sim/serialmods.js';

const MHZ = 240e6, PER_US = MHZ / 1e6;
const LOOK_US = 60000;     // suite programmée envoyée avec une lecture : 60 ms au plus
const CAUSE_US = 50000;    // une suite compte si elle découle d'un geste de la carte de moins de 50 ms
const LEAD_US = 60000;     // avance donnée aux changements spontanés (retard constant vu par le programme)
const PINS = 49;

const u32 = (d, i) => (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24)) >>> 0;
const le32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
/** Masque de broches en 7 octets, GPIO 0 à 55 (l'ESP32-S3 va jusqu'à 48). */
export const maskBytes = set => { const b = new Array(7).fill(0); for (const n of set) if (n >= 0 && n < 56) b[n >> 3] |= 1 << (n & 7); return b; };

/**
 * opts : { hw, keys (Map numéro de GPIO → clé de la broche), rec(clé) → fiche de la broche (pins du moteur),
 * send(octets) → vers la cale (UART1) }. Rend { frame(V : op, t, données), ready(), beat(t, décalage), run(),
 * reset(), mask, devices, uarts }.
 */
export function createBridge({ hw, keys, rec: recOf, send }) {
  const probe = hw && hw.probe ? hw.probe : null;
  const token = {}; // identifiant de la carte pour les modèles (bus 1-Wire partagé)
  let clock = 0;    // cycles
  /* ---------- Heure des modules : µs sur 32 bits envoyés par la cale → cycles ---------- */
  let epoch = 0, hi = 0, last32 = null;
  function devUs(v) {
    v >>>= 0;
    if (last32 == null) last32 = v;
    let h = hi;
    if (v < last32 && last32 - v > 0x80000000) { hi += 0x100000000; h = hi; last32 = v; }
    else if (v > last32 && v - last32 > 0x80000000) h = hi - 0x100000000; // valeur d'avant le tour du compteur
    else if (v > last32) last32 = v;
    return epoch + h + v;
  }
  const cyc = us => us * PER_US;
  let lastStamp = 0; // heure (µs) la plus récente reçue de la cale : rien de plus ancien n'arrivera ensuite

  /* ---------- Évènements des modèles (io.after) ---------- */
  const queue = []; // { at, fn, cause } trié par at
  let cause = 0;    // heure (µs) du geste de la carte dont découle ce qui se passe, 0 : rien (spontané)
  function after(cycles, fn) {
    const ev = { at: clock + Math.max(1, cycles), fn, cause };
    let i = queue.length;
    while (i > 0 && queue[i - 1].at > ev.at) i--;
    queue.splice(i, 0, ev);
  }
  function runEvent() {
    const ev = queue.shift(), was = cause;
    clock = Math.max(clock, ev.at); cause = ev.cause;
    try { ev.fn(); } finally { cause = was; }
  }
  /** Avance jusqu'à t (cycles), évènements compris. */
  function advance(t) {
    while (queue.length && queue[0].at <= t) runEvent();
    if (t > clock) clock = t;
  }

  /* ---------- Lignes (une par broche de la carte) ---------- */
  const lines = new Map(), byKey = new Map();
  for (const [n, key] of keys) {
    if (typeof n !== 'number' || n < 0 || n >= PINS) continue;
    const L = { n, key, mode: 0, od: false, out: 0, dev: null, line: 0, subs: [] };
    lines.set(n, L); byKey.set(key, L);
  }
  const ext = L => { const r = hw.read ? hw.read(L.key) : null; return r ? (r.d != null ? !!r.d : r.v != null ? r.v > (hw.prof ? hw.prof.logic : 3.3) / 2 : null) : null; };
  function levelOf(L) {
    if (L.mode === 1 && !(L.od && L.out)) return L.out;
    const e = L.dev != null ? L.dev : ext(L);
    return e != null ? +e : L.mode === 2 || (L.od && L.out) ? 1 : 0;
  }
  let changes = null; // changements des entrées pendant une suite programmée : [n, niveau, cycles]
  const dirty = new Set(), pushed = [];
  const queried = new Map(); // broche → heure (cycles) de sa dernière lecture demandée par la carte
  let bridged = new Set(), sentMask = '';
  function update(L) {
    const lv = levelOf(L);
    if (lv === L.line) return;
    L.line = lv;
    if (L.mode !== 1 && bridged.has(L.n)) {
      if (changes) changes.push([L.n, lv, clock]);
      else if (cause) dirty.add(L.n);
      // Broche que la carte vient de lire (moins de 30 ms : clavier balayé) : envoyé sans avance, pour
      // qu'il n'arrive jamais après une réponse plus récente ; aussi rendu avec la prochaine lecture.
      else if (clock - (queried.get(L.n) ?? -Infinity) < cyc(30000)) { dirty.add(L.n); pushed.push([L.n, lv, clock, 0]); }
      else pushed.push([L.n, lv, clock, LEAD_US]);
    }
    for (const fn of L.subs.slice()) fn(lv, clock);
  }
  const pinApi = {
    keys: () => byKey.keys(),
    level: key => { const L = byKey.get(key); return L ? L.line : null; },
    onEdge(key, fn) { const L = byKey.get(key); if (!L) return () => {}; L.subs.push(fn); return () => { const i = L.subs.indexOf(fn); if (i >= 0) L.subs.splice(i, 1); }; },
    drive(key, level) { const L = byKey.get(key); if (!L) return; L.dev = level == null ? null : !!level; update(L); },
    rec: key => (recOf ? recOf(key) : null)
  };
  function setMode(L, mode) {
    L.od = !!(mode & 0x10);
    L.mode = mode & 0x02 ? 1 : mode & 0x04 ? 2 : mode & 0x08 ? 3 : 0;
    const r = recOf && recOf(L.key); if (r) r.mode = L.mode;
    update(L);
  }

  /* ---------- Bus pour les modèles ---------- */
  let i2c = null, spi = null;
  const uarts = [1, 2].map(n => {
    const subs = [];
    const port = { name: 'Serial' + n, rx: null, tx: null, baudRate: 0, subs };
    port.api = {
      onTx(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
      inject(bytes) {
        const b = Array.from(bytes, x => x & 255);
        if (probe) for (const x of b) probe.uart(port.name, 'rx', x);
        for (let i = 0; i < b.length; i += 1000) { const c = b.slice(i, i + 1000); send(['R'.charCodeAt(0), 0x55, (c.length + 1) & 255, (c.length + 1) >> 8, n, ...c]); }
      },
      baud: () => port.baudRate
    };
    return port;
  });
  const devices = attachDevices({
    cpu: token, MHZ, hw, pinApi, uarts, now: () => clock, after,
    i2c: { setHandler(h) { i2c = h; } },
    spiBus: { onTransfer(fn) { spi = fn; } }
  });

  /** Broches reliées à un module (sauf SDA et SCL des modules I2C : Wire passe par le bus). */
  function computeMask() {
    const set = new Set();
    for (const [key, L] of byKey) {
      for (const x of hw.at ? hw.at(key) : []) {
        const e = devices.live.get(x.comp.id);
        if (!e) continue;
        if (e.model.bus === 'i2c' && (x.pin === 'SDA' || x.pin === 'SCL')) continue;
        set.add(L.n);
      }
    }
    return set;
  }
  function sendMask(force) {
    const set = computeMask(), sig = [...set].sort((a, b) => a - b).join(',');
    if (!force && sig === sentMask) return;
    sentMask = sig; bridged = set;
    const lv = new Set([...set].filter(n => lines.get(n).line));
    send(['R'.charCodeAt(0), 0x42, 14, 0, ...maskBytes(set), ...maskBytes(lv)]);
    dirty.clear(); pushed.length = 0;
  }
  const reply = bytes => { const n = bytes.length; send(['R'.charCodeAt(0), 0x72, n & 255, n >> 8, ...bytes]); };

  /* ---------- 1-Wire : la carte joue les créneaux de la bibliothèque OneWire ---------- */
  function ow(L) {
    const low = () => { L.mode = 1; L.od = false; L.out = 0; update(L); };
    const release = () => { L.mode = 0; update(L); };
    const wait = us => advance(clock + cyc(us));
    return {
      reset() { low(); wait(480); release(); wait(70); const p = L.line === 0; wait(410); return p; },
      writeBit(b) { low(); if (b) { wait(10); release(); wait(55); } else { wait(65); release(); wait(5); } },
      readBit() { low(); wait(3); release(); wait(10); const b = L.line; wait(53); return b ? 1 : 0; },
      write(v) { for (let i = 0; i < 8; i++) this.writeBit((v >> i) & 1); },
      read() { let v = 0; for (let i = 0; i < 8; i++) v |= this.readBit() << i; return v; }
    };
  }
  /** Recherche d'une adresse (note d'application 187 de Maxim) : état de la bibliothèque en entrée et en sortie. */
  function owSearch(m, rom, last, lastFamily, cmd) {
    if (!m.reset()) return [0];
    m.write(cmd);
    let idBit = 1, lastZero = 0, byte = 0, mask = 1;
    for (; byte < 8; ) {
      const b = m.readBit(), cb = m.readBit();
      if (b && cb) break;
      let dir;
      if (b !== cb) dir = b;
      else {
        dir = idBit < last ? ((rom[byte] & mask) > 0 ? 1 : 0) : idBit === last ? 1 : 0;
        if (!dir) { lastZero = idBit; if (lastZero < 9) lastFamily = lastZero; }
      }
      if (dir) rom[byte] |= mask; else rom[byte] &= ~mask & 255;
      m.writeBit(dir);
      idBit++; mask <<= 1;
      if (mask > 128) { byte++; mask = 1; }
    }
    if (idBit < 65 || !rom[0]) return [0];
    return [1, ...rom, lastZero, lastFamily, lastZero === 0 ? 1 : 0];
  }

  /* ---------- I2C ---------- */
  function i2cWrite(addr, data) {
    if (!i2c) return 2;
    i2c.start();
    if (!i2c.connect(addr, true)) { i2c.stop(); return 2; }
    let st = 0;
    for (const b of data) if (!i2c.write(b)) { st = 3; break; }
    i2c.stop();
    return st;
  }
  /** Lecture ; après une écriture sans arrêt (requestFrom après endTransmission(false)) : départ répété. */
  function i2cRead(addr, n) {
    if (!i2c) return [2];
    i2c.start();
    if (!i2c.connect(addr, false)) { i2c.stop(); return [2]; }
    const out = [0];
    for (let i = 0; i < n; i++) out.push(i2c.read(i < n - 1) & 255);
    i2c.stop();
    return out;
  }

  /* ---------- Lecture d'une broche reliée : niveaux, puis suite programmée ---------- */
  function readReply(n, tq) {
    queried.set(n, clock);
    // Niveaux au moment de la lecture (avant la suite programmée) : lignes changées par la carte depuis la dernière
    // réponse, celle qui est lue, et celles que la suite va changer.
    const snap = new Map();
    for (const p of bridged) snap.set(p, lines.get(p).line);
    const since = tq / PER_US - CAUSE_US, endAt = tq + cyc(LOOK_US);
    changes = [];
    try {
      for (;;) {
        const k = queue.findIndex(e => e.cause && e.cause >= since && e.at <= endAt);
        if (k < 0) break;
        const at = queue[k].at;
        while (queue.length && queue[0].at <= at) runEvent();
      }
    } finally { /* changes rendus ci-dessous */ }
    const ch = changes; changes = null;
    const inc = new Set(dirty); inc.add(n);
    for (const [p] of ch) inc.add(p);
    dirty.clear();
    const lv = [...inc].filter(p => (snap.has(p) ? snap.get(p) : lines.has(p) && lines.get(p).line));
    const evs = [];
    for (const [p, l, at] of ch.slice(0, 150)) evs.push(p, l, ...le32(Math.max(0, Math.round((at - tq) / PER_US))));
    reply([...maskBytes(inc), ...maskBytes(lv), ...evs]);
  }

  /* ---------- Trames de la cale ---------- */
  function frame(op, t, d) {
    let us = devUs(t);
    // Heure déjà dépassée ici (suite programmée jouée d'avance, créneaux 1-Wire) : l'heure de la carte est décalée
    // d'autant, pour que les écarts entre ses gestes suivants (largeur d'une impulsion TRIG…) restent les siens.
    if (cyc(us) <= clock) { const shift = clock / PER_US - us + 1 / PER_US; epoch += shift; lastStamp += shift; us += shift; }
    const at = cyc(us);
    if (us > lastStamp) lastStamp = us;
    advance(at);
    const was = cause, k = String.fromCharCode(d[0]), t0 = clock;
    cause = us || 1;
    try {
      if (op === 'p') posted(k, d);
      else query(k, d, at);
    } finally { cause = was; }
    // 1-Wire et RMT : les créneaux joués ici ont pris du temps des modules que la carte n'a pas compté (elle attendait
    // la réponse, ou n'a fait qu'envoyer les symboles) ; ses heures suivantes sont décalées d'autant.
    if ((k === 'O' || k === 'K') && clock > t0) { const shift = (clock - t0) / PER_US; epoch += shift; lastStamp += shift; }
  }
  function posted(k, d) {
    switch (k) {
      case 'w': { const L = lines.get(d[1]); if (L) { L.out = d[2] ? 1 : 0; update(L); } break; }
      case 'm': { const L = lines.get(d[1]); if (L) setMode(L, d[2]); break; }
      case 'W': { const st = i2cWrite(d[2], d.subarray(3)); if (st) send(['R'.charCodeAt(0), 0x4e, 1, 0, d[2]]); break; }
      case 'S': if (spi) for (let i = 2; i < d.length; i++) spi(d[i]); break;
      case 'K': {
        const L = lines.get(d[1]), hz = u32(d, 2);
        if (!L || !hz) break;
        const tick = MHZ / hz;
        L.mode = 1; L.od = false;
        for (let i = 6; i + 4 <= d.length; i += 4) {
          const w = u32(d, i), d0 = w & 0x7fff, d1 = (w >>> 16) & 0x7fff;
          if (!d0) break;
          L.out = (w >>> 15) & 1; update(L); advance(clock + d0 * tick);
          if (!d1) break;
          L.out = w >>> 31; update(L); advance(clock + d1 * tick);
        }
        break;
      }
      case 'u': {
        const p = uarts[d[1] - 1]; if (!p) break;
        const rx = d[2] < 128 ? keys.get(d[2]) || null : null, tx = d[3] < 128 ? keys.get(d[3]) || null : null;
        p.baudRate = u32(d, 4);
        if (rx !== p.rx || tx !== p.tx) {
          p.rx = rx; p.tx = tx;
          // Modules série recréés : ils choisissent leur port à la création.
          for (const [id, e] of devices.live) if (SERIAL_TYPES.includes(e.comp.type)) { if (e.dev.dispose) e.dev.dispose(); devices.live.delete(id); }
          devices.rebind();
        }
        break;
      }
      case 'U': { const p = uarts[d[1] - 1]; if (!p) break; for (let i = 2; i < d.length; i++) { if (probe) probe.uart(p.name, 'tx', d[i]); for (const fn of p.subs.slice()) fn(d[i], clock); } break; }
      case 'O': {
        const L = lines.get(d[1]); if (!L) break;
        const m = ow(L);
        if (d[2] === 0x77) for (let i = 3; i < d.length; i++) m.write(d[i]);
        else if (d[2] === 0x62) m.writeBit(d[3] & 1);
        break;
      }
    }
  }
  function query(k, d, at) {
    switch (k) {
      case 'r': readReply(d[1], at); break;
      case 'W': { const st = i2cWrite(d[2], d.subarray(3)); reply([st]); break; }
      case 'R': reply(i2cRead(d[2], d[3] | (d[4] << 8))); break;
      case 'X': {
        const w = d[3] | (d[4] << 8), data = d.subarray(5, 5 + w), r = d[5 + w] | (d[6 + w] << 8);
        if (!i2c) { reply([2]); break; }
        i2c.start();
        if (!i2c.connect(d[2], true)) { i2c.stop(); reply([2]); break; }
        let st = 0;
        for (const b of data) if (!i2c.write(b)) { st = 3; break; }
        if (st) { i2c.stop(); reply([st]); break; }
        reply(i2cRead(d[2], r));
        break;
      }
      case 's': { const out = []; for (let i = 2; i < d.length; i++) out.push(spi ? spi(d[i]) & 255 : 0xff); reply(out); break; }
      case 'O': {
        const L = lines.get(d[1]);
        if (!L) { reply([0xff]); break; }
        const m = ow(L);
        if (d[2] === 0x72) reply([m.reset() ? 1 : 0]);
        else if (d[2] === 0x52) { const out = []; for (let i = 0; i < d[3]; i++) out.push(m.read()); reply(out); }
        else if (d[2] === 0x42) reply([m.readBit()]);
        else if (d[2] === 0x73) reply(owSearch(m, Array.from(d.subarray(3, 11)), d[11], d[12], d[13]));
        else reply([0]);
        break;
      }
      default: reply([0xff]);
    }
  }

  return {
    devices, uarts, pinApi,
    get mask() { return bridged; },
    get clock() { return clock; },
    /** Trame variable de la cale : op 'p' ou 'q', t (µs des modules, 32 bits), données. */
    frame,
    /** Cale prête (démarrage ou redémarrage) : modules rattachés, broches reliées envoyées avant les entrées. */
    ready() {
      devices.frame();
      for (const L of lines.values()) update(L);
      sendMask(true);
    },
    /** Battement : heure de la carte (µs, 32 bits) et décalage des modules. */
    beat(t, stall) { const us = devUs((t - stall) >>> 0); if (us > lastStamp) lastStamp = us; },
    /** Image : modules rafraîchis, changements spontanés envoyés avec leur avance. */
    run() {
      // Ce que les modules font d'eux-mêmes, jusqu'à la dernière heure reçue de la carte (jamais au-delà : une trame
      // de la carte encore en route serait alors dans le passé).
      if (cyc(lastStamp) > clock) advance(cyc(lastStamp));
      devices.frame();
      sendMask(false);
      for (const L of lines.values()) update(L); // le montage a pu changer (bouton sur une broche reliée)
      if (!pushed.length) return;
      const out = [];
      for (const [n, lv, at, lead] of pushed.splice(0)) out.push(n, lv, ...le32(Math.round(at / PER_US + lead - epoch) >>> 0));
      for (let i = 0; i < out.length; i += 6 * 150) { const c = out.slice(i, i + 6 * 150); send(['R'.charCodeAt(0), 0x50, c.length & 255, c.length >> 8, ...c]); }
    },
    /** Redémarrage de la carte : son heure repart de 0, celle des modules continue. */
    reset() {
      epoch = Math.ceil(clock / PER_US) + 1; hi = 0; last32 = null; lastStamp = epoch;
      for (const L of lines.values()) { L.mode = 0; L.od = false; L.out = 0; update(L); }
      sentMask = '';
    }
  };
}
