// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Radio LoRa SX1278 (module Ra-02, 433 MHz) : un seul modèle de la puce, au niveau de ses registres (mode LoRa de la
// fiche Semtech SX1276/77/78/79, check/sources.js), partagé par les processeurs émulés (src/emu/devices/sx1278.js) et par
// la bibliothèque LoRa simulée de l'interpréteur (src/prog/loralib.js, portage de celle de Sandeep Mistry) : l'analyseur
// de bus voit les mêmes trames SPI dans les deux modes, et une carte émulée parle à une carte interprétée.
// Chaque échange SPI (NSS à LOW) commence par une adresse de registre, bit 7 à 1 pour écrire ; les octets suivants vont
// aux registres suivants (sauf la FIFO, 0x00, qui avance son propre pointeur RegFifoAddrPtr).
// L'air : l'état de chaque puce vit sur son composant (comp.icState, remis à zéro à l'arrêt). Un paquet émis (mode TX)
// part de la FIFO (RegFifoTxBaseAddr, RegPayloadLength octets) et arrive, après son temps d'antenne, aux autres modules
// du montage qui écoutaient déjà au début de l'émission (RX continu ou RX simple), sur la même fréquence (à un quart de
// bande près), avec le même facteur d'étalement, la même bande, le même mot de synchronisation et le même sens d'IQ.
// Simplifications : pas de délai d'expiration en RX simple (RegSymbTimeout), pas de collisions entre émetteurs, pas de
// CAD ni de saut de fréquence ; le niveau reçu dépend de la puissance d'émission et d'une distance fixe propre au couple.

export const LORA_TYPES = ['sx1278'];
/** Registres utilisés (mode LoRa). */
export const REG = {
  FIFO: 0x00, OP_MODE: 0x01, FRF_MSB: 0x06, FRF_MID: 0x07, FRF_LSB: 0x08, PA_CONFIG: 0x09, OCP: 0x0b, LNA: 0x0c,
  FIFO_ADDR_PTR: 0x0d, FIFO_TX_BASE: 0x0e, FIFO_RX_BASE: 0x0f, FIFO_RX_CURRENT: 0x10, IRQ_MASK: 0x11, IRQ_FLAGS: 0x12, RX_NB_BYTES: 0x13,
  MODEM_STAT: 0x18, PKT_SNR: 0x19, PKT_RSSI: 0x1a, RSSI: 0x1b, MODEM_CONFIG_1: 0x1d, MODEM_CONFIG_2: 0x1e, SYMB_TIMEOUT_LSB: 0x1f,
  PREAMBLE_MSB: 0x20, PREAMBLE_LSB: 0x21, PAYLOAD_LENGTH: 0x22, MAX_PAYLOAD: 0x23, FIFO_RX_BYTE_ADDR: 0x25, MODEM_CONFIG_3: 0x26,
  FREQ_ERROR_MSB: 0x28, FREQ_ERROR_MID: 0x29, FREQ_ERROR_LSB: 0x2a, RSSI_WIDEBAND: 0x2c, DETECTION_OPTIMIZE: 0x31, INVERTIQ: 0x33,
  DETECTION_THRESHOLD: 0x37, SYNC_WORD: 0x39, INVERTIQ2: 0x3b, DIO_MAPPING_1: 0x40, DIO_MAPPING_2: 0x41, VERSION: 0x42, PA_DAC: 0x4d
};
export const MODE = { SLEEP: 0, STDBY: 1, FSTX: 2, TX: 3, FSRX: 4, RX_CONTINUOUS: 5, RX_SINGLE: 6, CAD: 7 };
export const IRQ = { RX_TIMEOUT: 0x80, RX_DONE: 0x40, CRC_ERROR: 0x20, VALID_HEADER: 0x10, TX_DONE: 0x08 };
/** Bandes passantes (Hz) selon les bits 7-4 de RegModemConfig1. */
export const BANDWIDTHS = [7.8e3, 10.4e3, 15.6e3, 20.8e3, 31.25e3, 41.7e3, 62.5e3, 125e3, 250e3, 500e3];
/** Bande de fréquences du SX1278 (Hz). */
export const BAND = [137e6, 525e6];
const FXOSC = 32e6, FSTEP = FXOSC / 2 ** 19;
/** Valeurs à la mise sous tension (fiche, tableau des registres : colonne « Default » du mode LoRa). */
const DEFAULTS = {
  [REG.OP_MODE]: 0x09, [REG.FRF_MSB]: 0x6c, [REG.FRF_MID]: 0x80, [REG.FRF_LSB]: 0x00, [REG.PA_CONFIG]: 0x4f, 0x0a: 0x09, [REG.OCP]: 0x2b, [REG.LNA]: 0x20,
  [REG.FIFO_TX_BASE]: 0x80, [REG.MODEM_CONFIG_1]: 0x72, [REG.MODEM_CONFIG_2]: 0x70, [REG.SYMB_TIMEOUT_LSB]: 0x64, [REG.PREAMBLE_LSB]: 0x08,
  [REG.PAYLOAD_LENGTH]: 0x01, [REG.MAX_PAYLOAD]: 0xff, 0x24: 0x00, [REG.DETECTION_OPTIMIZE]: 0xc3, [REG.INVERTIQ]: 0x27, [REG.DETECTION_THRESHOLD]: 0x0a,
  [REG.SYNC_WORD]: 0x12, [REG.INVERTIQ2]: 0x1d, [REG.VERSION]: 0x12, [REG.PA_DAC]: 0x84
};

/**
 * Temps d'antenne d'un paquet LoRa (s), formule de la fiche (§ 4.1.1.7, « Time on air ») : préambule (n + 4,25 symboles),
 * puis 8 + max(⌈(8·PL − 4·SF + 28 + 16·CRC − 20·IH) ÷ (4·(SF − 2·DE))⌉ · (CR + 4), 0) symboles de 2^SF ÷ BW secondes.
 * o : { sf, bw (Hz), cr (1 à 4 : 4/5 à 4/8), pre (symboles de préambule), len (octets), crc, ih (en-tête implicite), ldro }.
 */
export function airtime({ sf = 7, bw = 125e3, cr = 1, pre = 8, len = 0, crc = true, ih = false, ldro = false } = {}) {
  const ts = 2 ** sf / bw, n = Math.ceil((8 * len - 4 * sf + 28 + 16 * (crc ? 1 : 0) - 20 * (ih ? 1 : 0)) / (4 * (sf - 2 * (ldro ? 1 : 0))));
  return (pre + 4.25) * ts + (8 + Math.max(n * (cr + 4), 0)) * ts;
}

/** État neuf de la puce (mise sous tension ou broche RST relâchée). */
function fresh(prev) {
  const reg = new Uint8Array(0x80);
  for (const [a, v] of Object.entries(DEFAULTS)) reg[+a] = v;
  const s = { t: 'sx1278', reg, fifo: new Uint8Array(256), hold: false, tx: null, rxSince: 0, rxPtr: 0, sent: 0, got: 0, lost: 0, last: null, log: [], ver: (prev && prev.ver) || 0 };
  // Rappel du modèle émulé (DIO0 au cycle près quand un paquet arrive) : gardé à travers une remise à zéro.
  if (prev && prev.wake) Object.defineProperty(s, 'wake', { value: prev.wake, enumerable: false, configurable: true, writable: true });
  return s;
}
/** État de la puce du composant (créé au premier accès). */
export function loraState(comp) {
  let s = comp.icState;
  if (!s || s.t !== 'sx1278') s = comp.icState = fresh(null);
  return s;
}
/** Réglages radio lus dans les registres : ce qui décide si deux modules s'entendent. */
export function loraSettings(s) {
  const r = s.reg, m1 = r[REG.MODEM_CONFIG_1], m2 = r[REG.MODEM_CONFIG_2], m3 = r[REG.MODEM_CONFIG_3], pa = r[REG.PA_CONFIG];
  const frf = (r[REG.FRF_MSB] << 16) | (r[REG.FRF_MID] << 8) | r[REG.FRF_LSB];
  const boost = !!(pa & 0x80), high = (r[REG.PA_DAC] & 7) === 7;
  return {
    lora: !!(r[REG.OP_MODE] & 0x80), mode: r[REG.OP_MODE] & 7, freq: frf * FSTEP,
    bw: BANDWIDTHS[(m1 >> 4) & 15] ?? 500e3, cr: (m1 >> 1) & 7, ih: !!(m1 & 1), sf: Math.min(12, Math.max(6, m2 >> 4)), crc: !!(m2 & 4), ldro: !!(m3 & 8),
    pre: (r[REG.PREAMBLE_MSB] << 8) | r[REG.PREAMBLE_LSB], len: r[REG.PAYLOAD_LENGTH], sync: r[REG.SYNC_WORD],
    // RegInvertIQ : bit 6 inverse l'IQ en réception, bit 0 l'IQ en émission (inversé quand il vaut 0, comme l'écrit la bibliothèque).
    iqRx: !!(r[REG.INVERTIQ] & 0x40), iqTx: !(r[REG.INVERTIQ] & 0x01),
    // Puissance (dBm) : PA_BOOST 2 + OutputPower (+3 dB avec RegPaDac à 0x87) ; RFO : Pmax − (15 − OutputPower).
    power: boost ? 2 + (pa & 15) + (high ? 3 : 0) : 10.8 + 0.6 * ((pa >> 4) & 7) - (15 - (pa & 15))
  };
}
/** Bande passante en texte, fréquence en MHz. */
export const fmtBw = bw => (bw >= 1e3 ? `${+(bw / 1e3).toFixed(2)} kHz` : `${bw} Hz`);
export const fmtMHz = f => `${(f / 1e6).toFixed(3)} MHz`;

/** Distance radio fixe propre au couple émetteur-récepteur : un niveau reçu stable d'un paquet à l'autre. */
function pairLoss(a, b) {
  let h = 2166136261 >>> 0;
  for (const ch of String(a) + '|' + String(b)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return 60 + (h % 31); // 60 à 90 dB d'affaiblissement : quelques mètres à quelques dizaines de mètres, à travers des murs
}
/** Le récepteur rx entend-il un paquet émis avec les réglages tx ? */
export function hears(tx, rx) {
  if (!rx.lora || (rx.mode !== MODE.RX_CONTINUOUS && rx.mode !== MODE.RX_SINGLE)) return false;
  if (tx.freq < BAND[0] || tx.freq > BAND[1]) return false; // hors de la bande du SX1278 : le synthétiseur ne s'accroche pas
  if (Math.abs(tx.freq - rx.freq) > rx.bw / 4 || tx.sf !== rx.sf || tx.bw !== rx.bw || tx.sync !== rx.sync || tx.iqTx !== rx.iqRx) return false;
  if ((tx.sf === 6 && !tx.ih) || (rx.sf === 6 && !rx.ih)) return false; // SF6 : en-tête implicite obligatoire
  // En-tête implicite : longueur, taux de codage et CRC ne voyagent pas, le récepteur doit avoir les mêmes.
  if (tx.ih !== rx.ih) return false;
  if (rx.ih && (tx.len !== rx.len || tx.cr !== rx.cr || tx.crc !== rx.crc)) return false;
  return true;
}
/** Paquet arrivé dans la puce s (réception : FIFO, registres, drapeaux) ; rend true s'il a été pris. */
function land(s, pkt, me) {
  const set = loraSettings(s);
  if (!hears(pkt.set, set)) { s.lost++; return false; }
  const r = s.reg, n = pkt.bytes.length, at = s.rxPtr & 255;
  for (let i = 0; i < n; i++) s.fifo[(at + i) & 255] = pkt.bytes[i];
  s.rxPtr = (at + n) & 255;
  const rssi = Math.round(Math.max(-137, Math.min(-20, pkt.set.power - pairLoss(pkt.from, me)))), snr = rssi > -100 ? 9.5 + ((pkt.from.length + n) % 4) * 0.25 : (rssi + 112) / 2;
  const lf = set.freq < 525e6 ? 164 : 157;
  r[REG.FIFO_RX_CURRENT] = at; r[REG.FIFO_RX_BYTE_ADDR] = s.rxPtr; r[REG.RX_NB_BYTES] = n;
  r[REG.PKT_RSSI] = Math.max(0, Math.min(255, rssi + lf)); r[REG.PKT_SNR] = Math.round(snr * 4) & 255;
  // Écart de fréquence vu par le récepteur (RegFreqError, 20 bits signés), comme le lit packetFrequencyError().
  const fe = Math.round((pkt.set.freq - set.freq) * 2 ** 24 / FXOSC * 500e3 / set.bw) & 0xfffff;
  r[REG.FREQ_ERROR_MSB] = (fe >> 16) & 15; r[REG.FREQ_ERROR_MID] = (fe >> 8) & 255; r[REG.FREQ_ERROR_LSB] = fe & 255;
  r[REG.IRQ_FLAGS] |= IRQ.RX_DONE | IRQ.VALID_HEADER;
  if (set.mode === MODE.RX_SINGLE) r[REG.OP_MODE] = (r[REG.OP_MODE] & 0xf8) | MODE.STDBY; // RX simple : retour en veille
  s.got++;
  s.last = { dir: 'rx', bytes: pkt.bytes.slice(), rssi, snr, freq: set.freq };
  s.log.push(s.last); if (s.log.length > 20) s.log.shift();
  s.ver++;
  return true;
}

/**
 * Puce SX1278 d'un composant, branchée sur un moteur. env : { now() → secondes, peers() → [{ comp, ok }] (modules du
 * montage), after?(secondes, fn) (moteur à horloge précise : fin d'émission au cycle près), dio?(niveau) (broche DIO0) }.
 * Rend l'esclave SPI (select, transfer, deselect), tick() (fait avancer l'émission en cours) et quelques accès directs.
 */
export function loraChip(comp, env = {}) {
  const now = () => (env.now ? env.now() : 0), st = () => loraState(comp);
  let addr = -1, write = false, lastDio = null;
  const dio0 = () => {
    const s = st(), map = s.reg[REG.DIO_MAPPING_1] >> 6, f = s.reg[REG.IRQ_FLAGS];
    return !s.hold && ((map === 0 && !!(f & IRQ.RX_DONE)) || (map === 1 && !!(f & IRQ.TX_DONE)));
  };
  const pin = () => { const d = dio0(); if (d !== lastDio) { lastDio = d; if (env.dio) env.dio(d); } };
  /** Émission terminée : le paquet arrive chez les modules qui écoutaient depuis le début. */
  function finish(s) {
    const tx = s.tx; s.tx = null;
    if ((s.reg[REG.OP_MODE] & 7) === MODE.TX) s.reg[REG.OP_MODE] = (s.reg[REG.OP_MODE] & 0xf8) | MODE.STDBY;
    s.reg[REG.IRQ_FLAGS] |= IRQ.TX_DONE;
    s.sent++; s.last = { dir: 'tx', bytes: tx.pkt.bytes.slice(), freq: tx.pkt.set.freq }; s.log.push(s.last); if (s.log.length > 20) s.log.shift(); s.ver++;
    for (const p of env.peers ? env.peers() : []) {
      if (p.comp === comp || !p.ok || !tx.ears.includes(p.comp)) continue;
      const o = p.comp.icState;
      if (!o || o.t !== 'sx1278' || o.hold) continue;
      if (land(o, tx.pkt, p.comp.id) && o.wake) o.wake();
    }
    pin();
  }
  function tick() {
    const s = st();
    if (s.tx && now() >= s.tx.end - 1e-9) finish(s);
    else pin();
  }
  function startTx(s) {
    const set = loraSettings(s), n = s.reg[REG.PAYLOAD_LENGTH], base = s.reg[REG.FIFO_TX_BASE], bytes = [];
    for (let i = 0; i < n; i++) bytes.push(s.fifo[(base + i) & 255]);
    const t = airtime({ ...set, len: n }), ears = [];
    // Les récepteurs doivent écouter dès le préambule pour attraper le paquet.
    for (const p of env.peers ? env.peers() : []) {
      const o = p.comp.icState;
      if (p.comp !== comp && p.ok && o && o.t === 'sx1278' && !o.hold && hears(set, loraSettings(o))) ears.push(p.comp);
    }
    s.tx = { end: now() + t, pkt: { from: comp.id, bytes, set }, ears };
    if (env.after) env.after(t, tick);
  }
  function writeReg(s, a, v) {
    const r = s.reg;
    if (a === REG.FIFO) { s.fifo[r[REG.FIFO_ADDR_PTR]] = v; r[REG.FIFO_ADDR_PTR] = (r[REG.FIFO_ADDR_PTR] + 1) & 255; return; }
    if (a === REG.OP_MODE) {
      const was = r[a], mode = v & 7, sleeping = (was & 7) === MODE.SLEEP;
      // LongRangeMode ne change qu'en sommeil (la bibliothèque passe par sleep()).
      const lr = sleeping || mode === MODE.SLEEP ? v & 0x80 : was & 0x80;
      r[a] = lr | (v & 0x7f);
      if (!(r[a] & 0x80)) return;
      if (mode !== MODE.TX && s.tx) s.tx = null; // émission interrompue
      if (mode === MODE.TX && !s.tx) startTx(s);
      if ((mode === MODE.RX_CONTINUOUS || mode === MODE.RX_SINGLE) && (was & 7) !== mode) { s.rxSince = now(); s.rxPtr = r[REG.FIFO_RX_BASE]; }
      s.ver++;
      return;
    }
    if (a === REG.IRQ_FLAGS) { r[a] &= ~v; return; } // 1 efface le drapeau
    if (a === REG.VERSION || a === REG.RX_NB_BYTES || a === REG.FIFO_RX_CURRENT || a === REG.PKT_RSSI || a === REG.PKT_SNR || a === REG.RSSI || a === REG.MODEM_STAT || (a >= REG.FREQ_ERROR_MSB && a <= REG.RSSI_WIDEBAND)) return; // lecture seule
    r[a] = v;
    if (a === REG.FIFO_RX_BASE) s.rxPtr = v;
  }
  function readReg(s, a) {
    const r = s.reg;
    if (a === REG.FIFO) { const v = s.fifo[r[REG.FIFO_ADDR_PTR]]; r[REG.FIFO_ADDR_PTR] = (r[REG.FIFO_ADDR_PTR] + 1) & 255; return v; }
    if (a === REG.RSSI) { const f = loraSettings(s).freq; return Math.max(0, -112 + Math.round(Math.random() * 4) + (f < 525e6 ? 164 : 157)); } // bruit de fond
    if (a === REG.RSSI_WIDEBAND) return (Math.random() * 256) | 0; // bruit large bande : source de hasard (LoRa.random())
    if (a === REG.MODEM_STAT) return 0x10; // modem libre (réception en cours non simulée)
    return r[a & 0x7f];
  }
  return {
    select() { addr = -1; tick(); },
    transfer(b) {
      const s = st();
      if (s.hold) return 0; // tenue en reset : MISO ne répond pas
      if (addr < 0) { addr = b & 0x7f; write = !!(b & 0x80); return 0; }
      let v;
      if (write) { writeReg(s, addr, b & 255); v = 0; } else v = readReg(s, addr);
      if (addr !== REG.FIFO) addr = (addr + 1) & 0x7f;
      if (write) pin();
      return v;
    },
    deselect() { addr = -1; },
    tick,
    /** Broche RST : LOW tient la puce en reset (registres à leur valeur de départ) ; relâchée, la puce redémarre. */
    hold(on) { const s = st(); if (on && s.hold) return; if (on) { comp.icState = fresh(s); comp.icState.hold = true; } else if (s.hold) s.hold = false; lastDio = null; pin(); },
    /** Remise à zéro complète (impulsion sur RST). */
    reset() { comp.icState = fresh(st()); lastDio = null; pin(); },
    dio0,
    /** Temps restant de l'émission en cours (s), 0 sinon. */
    txLeft() { const s = st(); return s.tx ? Math.max(0, s.tx.end - now()) : 0; },
    state: st
  };
}
