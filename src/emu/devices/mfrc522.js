// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Lecteur RFID MFRC522 vu par un vrai programme. Sur le bus SPI, le premier octet donne le registre (bit 7 : lecture,
// bits 6 à 1 : adresse). En lecture, chaque octet suivant ramène la valeur demandée par le précédent et porte l'adresse
// de la lecture suivante (0 termine) ; en écriture, tous les octets suivants vont au même registre : c'est ainsi que
// la bibliothèque remplit la FIFO de 64 octets. Pour parler au badge, le programme dépose la trame dans la FIFO, lance
// Transceive (bit StartSend) puis lit ComIrqReg : RxIRq quand le badge a répondu, TimerIRq si le minuteur (25 ms avec
// la bibliothèque) expire sans réponse. Le badge, une MIFARE Classic 1K (ISO 14443A), suit ses états : repos,
// REQA/WUPA → ATQA, anticollision → UID + BCC, SELECT → SAK, HLTA → endormi jusqu'à la prochaine pose sur le lecteur
// (ou une coupure du champ). MFAuthent vérifie la clé du secteur et allume MFCrypto1On ; le chiffrement Crypto1, que
// la puce fait de façon transparente pour le programme, n'est pas reproduit. Le CRC_A est calculé comme la norme.
// Le badge posé vient du panneau « Périphériques » : periph(c).card (indice dans BADGES), une pose de plus à chaque seq.
import { periph, BADGES } from '../../sim/models.js';

const FC = 13.56;   // MHz : horloge du lecteur, qui cadence le minuteur
const BYTE = 85;    // µs : un octet et sa parité à 106 kbit/s
const COMMAND = 0x01, COMIEN = 0x02, DIVIEN = 0x03, COMIRQ = 0x04, DIVIRQ = 0x05, ERROR = 0x06, STATUS1 = 0x07, STATUS2 = 0x08,
  FIFODATA = 0x09, FIFOLEVEL = 0x0a, WATERLEVEL = 0x0b, CONTROL = 0x0c, BITFRAMING = 0x0d, MODE = 0x11, TXMODE = 0x12, RXMODE = 0x13,
  TXCONTROL = 0x14, CRCH = 0x21, CRCL = 0x22, TMODE = 0x2a, TPRESCALER = 0x2b, TRELOADH = 0x2c, TRELOADL = 0x2d, VERSION = 0x37;
/** Valeurs des registres à la mise sous tension (les autres valent 0). VersionReg 0x92 : MFRC522 version 2.0. */
const RESET = { [COMMAND]: 0x20, [COMIEN]: 0x80, [COMIRQ]: 0x14, [STATUS1]: 0x21, [WATERLEVEL]: 0x08, [CONTROL]: 0x10, 0x0e: 0xa0,
  [MODE]: 0x3f, [TXCONTROL]: 0x80, 0x16: 0x10, 0x17: 0x84, 0x18: 0x84, 0x19: 0x4d, 0x1c: 0x62, 0x1f: 0xeb, [CRCH]: 0xff, [CRCL]: 0xff,
  0x24: 0x26, 0x26: 0x48, 0x27: 0x88, 0x28: 0x20, 0x29: 0x20, [VERSION]: 0x92 };
/** Registres que le programme ne peut pas écrire directement. */
const READ_ONLY = new Set([ERROR, STATUS1, CRCH, CRCL, 0x2e, 0x2f, VERSION]);
// Commandes de CommandReg (bits 3 à 0).
const IDLE = 0x0, MEM = 0x1, RANDOM = 0x2, CALCCRC = 0x3, TRANSMIT = 0x4, NOCHANGE = 0x7, RECEIVE = 0x8, TRANSCEIVE = 0xc, MFAUTHENT = 0xe, SOFTRESET = 0xf;
const PRESET = [0x0000, 0x6363, 0xa671, 0xffff]; // valeur initiale du CRC selon ModeReg (0x6363 : ISO 14443A)

/** CRC_A (ISO 14443-3) : polynôme x¹⁶ + x¹² + x⁵ + 1, bits de poids faible d'abord ; transmis poids faible d'abord. */
export function crcA(bytes, crc = 0x6363) {
  for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1; }
  return crc;
}
const withCrc = a => { const c = crcA(a); return [...a, c & 255, c >> 8]; };
const crcOk = a => a.length > 2 && crcA(a.slice(0, -2)) === (a[a.length - 2] | (a[a.length - 1] << 8));

/** Mémoire des badges (64 blocs de 16 octets), commune à tous les lecteurs, gardée le temps de la session. */
const CARDS = new Map();
export function cardMemory(i) {
  if (!CARDS.has(i)) {
    const u = BADGES[i].uid, m = new Uint8Array(1024);
    // Bloc 0 (fabricant, en lecture seule) : UID, BCC, SAK, ATQA, données du fabricant.
    m.set([...u, u.reduce((a, b) => a ^ b, 0), 0x08, 0x04, 0x00, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69]);
    // Blocs de fin de secteur, réglage d'usine : clé A FFFFFFFFFFFF, bits d'accès FF 07 80, octet 69, clé B FFFFFFFFFFFF.
    for (let s = 3; s < 64; s += 4) m.set([255, 255, 255, 255, 255, 255, 0xff, 0x07, 0x80, 0x69, 255, 255, 255, 255, 255, 255], s * 16);
    CARDS.set(i, m);
  }
  return CARDS.get(i);
}

/**
 * Le badge reçoit une trame (f : octets, last : bits valides du dernier octet, 0 = 8 ; crypto : MFCrypto1On du lecteur).
 * Rend sa réponse { data, bits } (bits valides du dernier octet) ou null s'il se tait.
 */
function piccFrame(c, f, last, crypto) {
  const uid = BADGES[c.idx].uid, full = [...uid, uid.reduce((a, b) => a ^ b, 0)], mem = cardMemory(c.idx);
  const sleep = () => { c.st = c.halted ? 'halt' : 'idle'; c.pend = null; return null; }; // erreur : retour au repos
  const ack = v => ({ data: [v], bits: 4 });
  const nak = () => { sleep(); return ack(0x4); };
  // Chiffrement allumé d'un seul côté : le badge ne comprend pas (oubli de PCD_StopCrypto1 : plus aucun badge lu).
  if (crypto !== (c.st === 'auth')) return sleep();
  if (f.length === 1 && last === 7) { // trame courte : REQA (badges au repos) ou WUPA (aussi les badges endormis)
    if ((f[0] === 0x26 && c.st === 'idle') || (f[0] === 0x52 && (c.st === 'idle' || c.st === 'halt'))) { c.st = 'ready'; return { data: [0x04, 0x00], bits: 0 }; }
    return c.st === 'idle' || c.st === 'halt' ? null : sleep();
  }
  if (c.st === 'idle' || c.st === 'halt') return null;
  if (c.st === 'ready') {
    if (f[0] !== 0x93 || f.length < 2) return sleep(); // UID de 4 octets : un seul niveau de cascade
    if (f[1] === 0x70) { // SELECT : UID complet, BCC et CRC
      if (f.length !== 9 || !crcOk(f) || full.some((b, i) => b !== f[2 + i])) return sleep();
      c.st = 'active';
      return { data: withCrc([0x08]), bits: 0 }; // SAK 0x08 : MIFARE Classic 1K, UID complet
    }
    // Anticollision : NVB = octets envoyés (4 bits hauts) et bits en plus ; le badge renvoie les bits qui manquent.
    const known = ((f[1] >> 4) - 2) * 8 + (f[1] & 7);
    if (known < 0 || known > 32 || f.length < 2 + Math.ceil(known / 8)) return sleep();
    for (let i = 0; i < known; i++) if (((f[2 + (i >> 3)] >> (i & 7)) & 1) !== ((full[i >> 3] >> (i & 7)) & 1)) return null; // pas cet UID
    return { data: full.slice(known >> 3), bits: 0 };
  }
  if (c.pend != null) { // deuxième temps de WRITE : 16 octets et leur CRC
    const blk = c.pend; c.pend = null;
    if (f.length !== 18 || !crcOk(f)) return nak();
    mem.set(f.slice(0, 16), blk * 16);
    return ack(0xa);
  }
  if (f.length !== 4 || !crcOk(f)) return sleep();
  const [cmd, blk] = f;
  if (cmd === 0x50 && blk === 0) { c.st = 'halt'; c.halted = true; return null; } // HLTA : pas de réponse
  if (cmd !== 0x30 && cmd !== 0xa0) return nak(); // INCREMENT, DECREMENT… : non reproduits
  if (c.st !== 'auth' || blk > 63 || blk >> 2 !== c.sector) return nak(); // secteur non authentifié
  if (cmd === 0x30) { // READ : 16 octets (la clé A d'un bloc de fin de secteur se lit 00)
    const d = Array.from(mem.subarray(blk * 16, blk * 16 + 16));
    if (blk % 4 === 3) d.fill(0, 0, 6);
    return { data: withCrc(d), bits: 0 };
  }
  if (blk === 0) return nak(); // bloc du fabricant : en lecture seule
  c.pend = blk; // WRITE, premier temps : ACK, puis les données
  return ack(0xa);
}
/** MFAuthent : commande (0x60 clé A, 0x61 clé B), bloc, clé (6 octets), 4 derniers octets de l'UID. */
function piccAuth(c, f) {
  if (!c || (c.st !== 'active' && c.st !== 'auth') || f.length < 12) return false;
  const [cmd, blk] = f, mem = cardMemory(c.idx), t = (blk | 3) * 16 + (cmd === 0x61 ? 10 : 0);
  const ok = (cmd === 0x60 || cmd === 0x61) && blk < 64 && BADGES[c.idx].uid.every((b, i) => b === f[8 + i]) && f.slice(2, 8).every((b, i) => b === mem[t + i]);
  if (!ok) { c.st = c.halted ? 'halt' : 'idle'; return false; }
  c.st = 'auth'; c.sector = blk >> 2;
  return true;
}

export default {
  types: ['rc522'],
  bus: 'spi',
  create(comp, io) {
    const reg = new Uint8Array(64), rst = io.pin('RST'), irqPin = io.pin('IRQ');
    let fifo = [], buf25 = new Array(25).fill(0), gen = 0, tgen = 0, timerOn = false, crc = 0, rxLast = 0, card = null, field = 0, fieldWas = false, dead = false;
    let first = true, reading = false, at = -1;
    const inReset = () => rst != null && !io.level(rst); // NRSTPD à LOW : puce éteinte, elle ne répond plus
    const fieldOn = () => !inReset() && !(reg[COMMAND] & 0x10) && (reg[TXCONTROL] & 3) !== 0;
    /** Le champ s'éteint (antenne coupée, reset, veille) : le badge perd son alimentation et repart au repos. */
    function watchField() { const on = fieldOn(); if (fieldWas && !on) field++; fieldWas = on; }
    function reset() { reg.fill(0); for (const [k, v] of Object.entries(RESET)) reg[k] = v; fifo = []; gen++; tgen++; timerOn = false; rxLast = 0; watchField(); pin(); }
    /** Badge dans le champ : le même tant qu'il reste posé et alimenté, sinon un nouveau, au repos. */
    function picc() {
      watchField();
      const st = periph(comp);
      if (st.card == null || !BADGES[st.card] || !fieldOn()) { card = null; return null; }
      if (!card || card.idx !== st.card || card.seq !== st.seq || card.field !== field) card = { idx: st.card, seq: st.seq, field, st: 'idle', halted: false, sector: -1, pend: null };
      return card;
    }
    const irqActive = () => (reg[COMIEN] & reg[COMIRQ] & 0x7f) || (reg[DIVIEN] & reg[DIVIRQ] & 0x14);
    /** Broche IRQ : IRqInv (ComIEnReg bit 7) l'inverse ; sortie CMOS si IRQPushPull (DivIEnReg bit 7), sinon drain ouvert. */
    function pin() {
      if (!irqPin) return;
      const lv = reg[COMIEN] & 0x80 ? !irqActive() : !!irqActive();
      io.drive(irqPin, reg[DIVIEN] & 0x80 ? lv : lv ? null : false);
    }
    const irq = (com, div = 0) => { reg[COMIRQ] |= com; reg[DIVIRQ] |= div; pin(); };
    const finish = () => { reg[COMMAND] &= 0xf0; irq(0x10); }; // la commande se termine d'elle-même : IdleIRq
    // Minuteur : f = 13,56 MHz / (2 × TPrescaler + 1), TReload + 1 périodes ; TAuto le lance à la fin de chaque émission.
    function timerStart() {
      const g = ++tgen, pre = ((reg[TMODE] & 0x0f) << 8) | reg[TPRESCALER], n = ((reg[TRELOADH] << 8) | reg[TRELOADL]) + 1;
      timerOn = true;
      io.after(io.us(((2 * pre + 1) * n) / FC), () => { if (dead || g !== tgen) return; timerOn = false; irq(0x01); if (reg[TMODE] & 0x10) timerStart(); });
    }
    const timerStop = () => { tgen++; timerOn = false; };
    const feedCrc = bytes => {
      crc = crcA(bytes, crc); reg[CRCL] = crc & 255; reg[CRCH] = crc >> 8;
      reg[STATUS1] = (reg[STATUS1] & ~0x60) | 0x20 | (crc ? 0 : 0x40); irq(0, 0x04); // CRCReady, CRCOk, CRCIRq
    };
    /** Émission de la FIFO (Transmit, Transceive) ; avec réception, la réponse du badge revient dans la FIFO. */
    function send(rx) {
      const g = gen, crypto = !!(reg[STATUS2] & 0x08);
      let f = fifo.splice(0), last = reg[BITFRAMING] & 7;
      reg[BITFRAMING] &= 0x7f; reg[ERROR] &= 0x40;
      if (reg[TXMODE] & 0x80) { f = withCrc(f); last = 0; } // TxCRCEn : la puce ajoute le CRC
      io.after(io.us(BYTE * f.length + 20), () => {
        if (dead || g !== gen) return;
        irq(0x40); // TxIRq : trame partie
        if (!rx) { finish(); return; }
        if (reg[TMODE] & 0x80) timerStart();
        const c = picc(), r = c && f.length ? piccFrame(c, f, last, crypto) : null;
        if (!r) return; // silence : le minuteur lèvera TimerIRq
        io.after(io.us(90 + BYTE * r.data.length), () => {
          if (dead || g !== gen) return;
          timerStop();
          let d = r.data;
          if ((reg[RXMODE] & 0x80) && !r.bits) { if (crcOk(d)) d = d.slice(0, -2); else reg[ERROR] |= 0x04; } // RxCRCEn
          // Réponse d'anticollision : le premier bit reçu se range au bit RxAlign du premier octet, et la bibliothèque ne
          // garde que ces bits-là ; RxLastBits : bits valides du dernier octet (4 pour un ACK/NAK MIFARE).
          fifo = d.slice(0, 64); rxLast = r.bits;
          irq(0x20); // RxIRq ; Transceive reste active jusqu'à la commande suivante
        });
      });
    }
    function command(v) {
      const cmd = v & 0x0f;
      reg[COMMAND] = (v & 0x30) | (cmd === NOCHANGE ? reg[COMMAND] & 0x0f : cmd);
      watchField();
      if (cmd === NOCHANGE) return;
      gen++; // la commande en cours s'arrête
      if (cmd === IDLE || cmd === RECEIVE || cmd === TRANSCEIVE) return; // Transceive attend StartSend
      if (cmd === SOFTRESET) { reset(); return; }
      if (cmd === CALCCRC) { crc = PRESET[reg[MODE] & 3]; feedCrc(fifo.splice(0)); return; } // reste active : la FIFO continue d'alimenter le calcul
      if (cmd === TRANSMIT) { send(false); return; }
      if (cmd === MFAUTHENT) {
        const g = gen, f = fifo.splice(0, 12);
        io.after(io.us(BYTE * 12 + 20), () => {
          if (dead || g !== gen) return;
          irq(0x40);
          if (reg[TMODE] & 0x80) timerStart();
          if (!piccAuth(picc(), f)) return; // mauvaise clé ou pas de badge : la commande attend, le minuteur la coupe
          io.after(io.us(600), () => { if (dead || g !== gen) return; timerStop(); reg[STATUS2] |= 0x08; finish(); });
        });
        return;
      }
      if (cmd === MEM) { if (fifo.length >= 25) buf25 = fifo.splice(0, 25); else if (!fifo.length) fifo = buf25.slice(); }
      else if (cmd === RANDOM) for (let i = 0; i < 10; i++) buf25[i] = (Math.random() * 256) | 0;
      finish(); // Mem, RandomID (et commande inconnue) : terminées aussitôt
    }
    function read(r) {
      switch (r) {
        case FIFODATA: return fifo.length ? fifo.shift() : 0;
        case FIFOLEVEL: return fifo.length;
        case CONTROL: return (reg[CONTROL] & 0xf8) | rxLast;
        case STATUS1: return (reg[STATUS1] & 0x60) | (irqActive() ? 0x10 : 0) | (timerOn ? 0x08 : 0) |
          (64 - fifo.length <= reg[WATERLEVEL] ? 0x02 : 0) | (fifo.length <= reg[WATERLEVEL] ? 0x01 : 0);
        default: return reg[r];
      }
    }
    function write(r, v) {
      switch (r) {
        case COMMAND: command(v); return;
        case COMIRQ: case DIVIRQ: reg[r] = v & 0x80 ? reg[r] | (v & 0x7f) : reg[r] & ~v; pin(); return; // Set1/Set2 : bits mis à 1 ou effacés
        case FIFODATA:
          if ((reg[COMMAND] & 0x0f) === CALCCRC) feedCrc([v]);
          else if (fifo.length < 64) fifo.push(v); else reg[ERROR] |= 0x10; // BufferOvfl
          return;
        case FIFOLEVEL: if (v & 0x80) { fifo = []; reg[ERROR] &= ~0x10; } return; // FlushBuffer
        case CONTROL: if (v & 0x80) timerStop(); if (v & 0x40) timerStart(); return; // TStopNow, TStartNow
        case BITFRAMING: reg[r] = v & 0x7f; if (v & 0x80 && (reg[COMMAND] & 0x0f) === TRANSCEIVE) send(true); return; // StartSend
        case STATUS2: reg[r] = (v & 0xc0) | (reg[r] & v & 0x08) | (reg[r] & 0x07); return; // MFCrypto1On : seulement effacé par le programme
        case COMIEN: case DIVIEN: reg[r] = v; pin(); return;
        case TXCONTROL: reg[r] = v; watchField(); return;
        default: if (!READ_ONLY.has(r)) reg[r] = v;
      }
    }
    reset();
    const offs = rst ? [io.onEdge(rst, lv => { if (lv) reset(); else { gen++; tgen++; timerOn = false; watchField(); } })] : []; // RST remonte : reset matériel
    return {
      cs: 'SDA',
      select() { first = true; at = -1; },
      transfer(v) {
        if (dead || inReset()) return 0xff; // puce éteinte : MISO en l'air
        if (first) { first = false; reading = !!(v & 0x80); at = (v >> 1) & 0x3f; return 0; }
        if (!reading) { write(at, v); return 0; }
        const out = at < 0 ? 0 : read(at);
        at = v & 0x80 ? (v >> 1) & 0x3f : -1;
        return out;
      },
      deselect() { first = true; at = -1; },
      dispose() { dead = true; offs.forEach(f => f()); if (irqPin) io.drive(irqPin, null); }
    };
  }
};
