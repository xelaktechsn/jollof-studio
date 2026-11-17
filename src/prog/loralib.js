// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Bibliothèque LoRa (Sandeep Mistry, arduino-LoRa 0.8) simulée pour l'interpréteur (runtime.js) : l'objet global LoRa.
// Portage fidèle de LoRa.cpp : chaque fonction lit et écrit les mêmes registres, dans le même ordre, sur la puce
// commune de src/sim/lora.js ; l'analyseur de bus voit donc les mêmes échanges SPI qu'avec un vrai programme, et une
// carte interprétée parle à une carte émulée. Broches par défaut : NSS 10, RST 9, DIO0 2 (LoRa.setPins pour d'autres).
// onReceive / onTxDone : la vraie bibliothèque attache une interruption sur DIO0 (front montant) ; ici, la broche DIO0
// de la puce est surveillée à chaque passage de l'ordonnanceur (comme les interruptions de l'interpréteur), et le
// rappel s'exécute comme une interruption, entre deux instructions.
import { loraChip, REG, IRQ, BAND } from '../sim/lora.js';

const LR = 0x80, SLEEP = 0x00, STDBY = 0x01, TX = 0x03, RX_CONTINUOUS = 0x05, RX_SINGLE = 0x06;
const PA_BOOST = 0x80, MAX_PKT = 255;
export const LORA_CONSTS = { PA_OUTPUT_RFO_PIN: 0, PA_OUTPUT_PA_BOOST_PIN: 1 };

/**
 * ctx : { hw, keyOf(n), warn(msg), tl, at(clé) → [{ comp, pin }], now() → ms de temps virtuel, later(fn, args),
 * Wait (attente de l'interpréteur), fmt(valeur, format, étiquette), stat(comp) → { ok, msg }, pin: { mode(n, m), write(n, v) } }.
 * Rend { LoRaClass, poll() } ; poll() est appelé par l'ordonnanceur avant les interruptions.
 */
export function createLoraLib(ctx) {
  const { hw, keyOf, warn, tl, at, Wait, fmt, stat } = ctx;
  const chips = new Map(); // id du composant → puce, pour cette carte
  const chipOf = c => {
    if (!chips.has(c.id)) chips.set(c.id, loraChip(c, { now: () => ctx.now() / 1000, peers: () => (hw.peers ? hw.peers(['sx1278']) : []) }));
    return chips.get(c.id);
  };
  const objs = [];

  class LoRaClass {
    constructor() { this._ss = 10; this._reset = 9; this._dio0 = 2; this._frequency = 0; this._packetIndex = 0; this._implicitHeaderMode = 0; this._onReceive = null; this._onTxDone = null; this.c = null; this.chip = null; this._dioWas = false; this._clearTx = false; objs.push(this); }
    /* ---------- Accès aux registres (singleTransfer) ---------- */
    xfer(a, v) {
      const ch = this.chip, probe = hw.probe || null; if (!ch) return 0;
      if (probe) probe.spiSelect(this.c.name);
      ch.select();
      const r0 = ch.transfer(a), r = ch.transfer(v);
      ch.deselect();
      if (probe) { probe.spiByte(a, r0); probe.spiByte(v, r); probe.spiDeselect(); }
      return r;
    }
    readRegister(a) { return this.xfer(a & 0x7f, 0); }
    writeRegister(a, v) { this.xfer(a | 0x80, v & 255); }
    /** Module en marche ? (begin() réussi et câblage toujours bon) */
    ok(what) {
      if (!this.chip) { warn(tl('LoRa.{0}() : la radio ne fonctionne pas (LoRa.begin() absent ou en échec)', what)); return false; }
      const s = stat(this.c);
      if (!s.ok) { warn(tl('Le module LoRa {0} ne répond pas : {1}', this.c.name, s.msg || tl('câblage incomplet'))); return false; }
      // Fin d'une émission synchrone : la bibliothèque efface TxDone après l'avoir vu.
      if (this._clearTx && this.chip.txLeft() === 0) { this._clearTx = false; this.chip.tick(); this.writeRegister(REG.IRQ_FLAGS, IRQ.TX_DONE); }
      return true;
    }
    setPins(ss = 10, reset = 9, dio0 = 2) { this._ss = ss; this._reset = reset; this._dio0 = dio0; }
    setSPI() {} setSPIFrequency() {}
    begin(frequency) {
      this.chip = null; this.c = null;
      const k = keyOf(this._ss), hit = k && at(k).find(x => x.comp.type === 'sx1278' && x.pin === 'NSS');
      if (!hit) { warn(tl('LoRa.begin() : aucun module SX1278 n’a sa broche NSS sur la broche {0} (LoRa.setPins(nss, rst, dio0) pour d’autres broches)', this._ss)); return new Wait(this._reset !== -1 ? 20 : 0, 0); }
      const s = stat(hit.comp);
      if (!s.ok) { warn(tl('Le module LoRa {0} ne répond pas : {1}', hit.comp.name, s.msg || tl('câblage incomplet'))); return new Wait(20, 0); }
      this.c = hit.comp; this.chip = chipOf(hit.comp);
      ctx.pin.mode(this._ss, 1); ctx.pin.write(this._ss, 1);
      if (this._reset !== -1) {
        ctx.pin.mode(this._reset, 1); ctx.pin.write(this._reset, 0); ctx.pin.write(this._reset, 1);
        const rk = keyOf(this._reset);
        if (rk && at(rk).some(x => x.comp === hit.comp && x.pin === 'RST')) this.chip.reset();
      }
      if (this.readRegister(REG.VERSION) !== 0x12) { this.chip = null; return new Wait(20, 0); }
      if (frequency < BAND[0] || frequency > BAND[1]) warn(tl('LoRa.begin({0}) : le SX1278 n’émet que de 137 à 525 MHz (433E6 pour le module Ra-02) ; à cette fréquence, rien ne passe', Math.round(frequency)));
      this.sleep();
      this.setFrequency(frequency);
      this.writeRegister(REG.FIFO_TX_BASE, 0);
      this.writeRegister(REG.FIFO_RX_BASE, 0);
      this.writeRegister(REG.LNA, this.readRegister(REG.LNA) | 0x03);
      this.writeRegister(REG.MODEM_CONFIG_3, 0x04);
      this.setTxPower(17);
      this.idle();
      return new Wait(this._reset !== -1 ? 20 : 0, 1);
    }
    end() { if (this.chip) this.sleep(); }
    isTransmitting() {
      if ((this.readRegister(REG.OP_MODE) & TX) === TX) return true;
      if (this.readRegister(REG.IRQ_FLAGS) & IRQ.TX_DONE) this.writeRegister(REG.IRQ_FLAGS, IRQ.TX_DONE);
      return false;
    }
    beginPacket(implicitHeader = 0) {
      if (!this.ok('beginPacket')) return 0;
      if (this.isTransmitting()) return 0;
      this.idle();
      if (implicitHeader) this.implicitHeaderMode(); else this.explicitHeaderMode();
      this.writeRegister(REG.FIFO_ADDR_PTR, 0);
      this.writeRegister(REG.PAYLOAD_LENGTH, 0);
      return 1;
    }
    endPacket(async = false) {
      if (!this.ok('endPacket')) return new Wait(0, 0);
      if (async && this._onTxDone) this.writeRegister(REG.DIO_MAPPING_1, 0x40);
      this.writeRegister(REG.OP_MODE, LR | TX);
      if (async) return new Wait(0, 1);
      // Attente de TxDone : le temps d'antenne du paquet ; le drapeau est effacé au prochain appel.
      const ms = this.chip.txLeft() * 1000;
      this._clearTx = true;
      return new Wait(ms, 1);
    }
    bytes(list) {
      if (!this.ok('write')) return 0;
      const cur = this.readRegister(REG.PAYLOAD_LENGTH);
      let n = list.length;
      if (cur + n > MAX_PKT) { warn(tl('LoRa : un paquet contient au plus 255 octets, la suite est perdue')); n = MAX_PKT - cur; }
      for (let i = 0; i < n; i++) this.writeRegister(REG.FIFO, list[i]);
      this.writeRegister(REG.PAYLOAD_LENGTH, cur + n);
      return n;
    }
    write(x, n) {
      const list = typeof x === 'number' ? [x & 255] : Array.isArray(x) ? x.slice(0, n ?? x.length).map(b => b & 255) : [...String(x)].map(ch => ch.charCodeAt(0) & 255).slice(0, n ?? undefined);
      return this.bytes(list);
    }
    print(x, f, tag) { return this.bytes([...fmt(x, f, tag)].map(ch => ch.charCodeAt(0) & 255)); }
    println(x, f, tag) { return this.bytes([...((x === undefined ? '' : fmt(x, f, tag)) + '\r\n')].map(ch => ch.charCodeAt(0) & 255)); }
    parsePacket(size = 0) {
      if (!this.ok('parsePacket')) return 0;
      let len = 0;
      const irq = this.readRegister(REG.IRQ_FLAGS);
      if (size > 0) { this.implicitHeaderMode(); this.writeRegister(REG.PAYLOAD_LENGTH, size & 0xff); } else this.explicitHeaderMode();
      this.writeRegister(REG.IRQ_FLAGS, irq);
      if ((irq & IRQ.RX_DONE) && !(irq & IRQ.CRC_ERROR)) {
        this._packetIndex = 0;
        len = this._implicitHeaderMode ? this.readRegister(REG.PAYLOAD_LENGTH) : this.readRegister(REG.RX_NB_BYTES);
        this.writeRegister(REG.FIFO_ADDR_PTR, this.readRegister(REG.FIFO_RX_CURRENT));
        this.idle();
      } else if (this.readRegister(REG.OP_MODE) !== (LR | RX_SINGLE)) {
        this.writeRegister(REG.FIFO_ADDR_PTR, 0);
        this.writeRegister(REG.OP_MODE, LR | RX_SINGLE);
      }
      return len;
    }
    rssiOffset() { return this._frequency < 525e6 ? 164 : 157; }
    packetRssi() { return this.chip ? this.readRegister(REG.PKT_RSSI) - this.rssiOffset() : 0; }
    packetSnr() { if (!this.chip) return 0; const v = this.readRegister(REG.PKT_SNR); return (v > 127 ? v - 256 : v) * 0.25; }
    packetFrequencyError() {
      if (!this.chip) return 0;
      let fe = this.readRegister(0x28) & 7; fe = (fe << 8) + this.readRegister(0x29); fe = (fe << 8) + this.readRegister(0x2a);
      if (this.readRegister(0x28) & 8) fe -= 524288;
      return Math.trunc(fe * 2 ** 24 / 32e6 * (this.getSignalBandwidth() / 500000));
    }
    rssi() { return this.chip ? this.readRegister(REG.RSSI) - this.rssiOffset() : 0; }
    available() { return this.chip ? this.readRegister(REG.RX_NB_BYTES) - this._packetIndex : 0; }
    read() { if (!this.available()) return -1; this._packetIndex++; return this.readRegister(REG.FIFO); }
    peek() {
      if (!this.available()) return -1;
      const a = this.readRegister(REG.FIFO_ADDR_PTR), b = this.readRegister(REG.FIFO);
      this.writeRegister(REG.FIFO_ADDR_PTR, a);
      return b;
    }
    readString() { let s = ''; for (let b = this.read(); b >= 0; b = this.read()) s += String.fromCharCode(b); return s; }
    readStringUntil(c) { const ch = typeof c === 'number' ? c : String(c).charCodeAt(0); let s = ''; for (let b = this.read(); b >= 0 && b !== ch; b = this.read()) s += String.fromCharCode(b); return s; }
    parseInt() { const m = /-?\d+/.exec(this.readString()); return m ? parseInt(m[0], 10) : 0; }
    parseFloat() { const m = /-?\d+(\.\d+)?/.exec(this.readString()); return m ? parseFloat(m[0]) : 0; }
    flush() {} setTimeout() {}
    onReceive(cb) { this._onReceive = cb || null; this.dioCheck(cb); }
    onTxDone(cb) { this._onTxDone = cb || null; this.dioCheck(cb); }
    /** Les rappels passent par une interruption sur DIO0 : la broche doit être câblée à la broche donnée. */
    dioCheck(cb) {
      if (!cb || !this.c) return;
      const k = keyOf(this._dio0);
      if (!k || !at(k).some(x => x.comp === this.c && x.pin === 'DIO0')) warn(tl('LoRa.onReceive() : DIO0 de {0} n’est pas reliée à la broche {1} : l’interruption ne se déclenche jamais', this.c.name, this._dio0));
      ctx.pin.mode(this._dio0, 0);
    }
    receive(size = 0) {
      if (!this.ok('receive')) return;
      this.writeRegister(REG.DIO_MAPPING_1, 0x00);
      if (size > 0) { this.implicitHeaderMode(); this.writeRegister(REG.PAYLOAD_LENGTH, size & 0xff); } else this.explicitHeaderMode();
      this.writeRegister(REG.OP_MODE, LR | RX_CONTINUOUS);
    }
    idle() { this.writeRegister(REG.OP_MODE, LR | STDBY); }
    sleep() { this.writeRegister(REG.OP_MODE, LR | SLEEP); }
    setTxPower(level, outputPin = 1) {
      if (!this.chip) return;
      if (outputPin === 0) { level = Math.max(0, Math.min(14, level)); this.writeRegister(REG.PA_CONFIG, 0x70 | level); return; }
      if (level > 17) { if (level > 20) level = 20; level -= 3; this.writeRegister(REG.PA_DAC, 0x87); this.setOCP(140); }
      else { if (level < 2) level = 2; this.writeRegister(REG.PA_DAC, 0x84); this.setOCP(100); }
      this.writeRegister(REG.PA_CONFIG, PA_BOOST | (level - 2));
    }
    setFrequency(frequency) {
      this._frequency = frequency;
      const frf = Math.floor(frequency * 2 ** 19 / 32e6);
      this.writeRegister(REG.FRF_MSB, (frf >> 16) & 255); this.writeRegister(REG.FRF_MID, (frf >> 8) & 255); this.writeRegister(REG.FRF_LSB, frf & 255);
    }
    getSpreadingFactor() { return this.readRegister(REG.MODEM_CONFIG_2) >> 4; }
    setSpreadingFactor(sf) {
      sf = Math.max(6, Math.min(12, sf | 0));
      if (sf === 6) { this.writeRegister(REG.DETECTION_OPTIMIZE, 0xc5); this.writeRegister(REG.DETECTION_THRESHOLD, 0x0c); }
      else { this.writeRegister(REG.DETECTION_OPTIMIZE, 0xc3); this.writeRegister(REG.DETECTION_THRESHOLD, 0x0a); }
      this.writeRegister(REG.MODEM_CONFIG_2, (this.readRegister(REG.MODEM_CONFIG_2) & 0x0f) | ((sf << 4) & 0xf0));
      this.setLdoFlag();
    }
    getSignalBandwidth() { const bw = this.readRegister(REG.MODEM_CONFIG_1) >> 4; return [7.8e3, 10.4e3, 15.6e3, 20.8e3, 31.25e3, 41.7e3, 62.5e3, 125e3, 250e3, 500e3][bw] ?? -1; }
    setSignalBandwidth(sbw) {
      const lim = [7.8e3, 10.4e3, 15.6e3, 20.8e3, 31.25e3, 41.7e3, 62.5e3, 125e3, 250e3];
      let bw = lim.findIndex(x => sbw <= x); if (bw < 0) bw = 9;
      this.writeRegister(REG.MODEM_CONFIG_1, (this.readRegister(REG.MODEM_CONFIG_1) & 0x0f) | (bw << 4));
      this.setLdoFlag();
    }
    setLdoFlag() {
      const sym = Math.trunc(1000 / Math.trunc(this.getSignalBandwidth() / (1 << this.getSpreadingFactor())));
      let c3 = this.readRegister(REG.MODEM_CONFIG_3);
      c3 = sym > 16 ? c3 | 8 : c3 & ~8;
      this.writeRegister(REG.MODEM_CONFIG_3, c3);
    }
    setCodingRate4(d) { d = Math.max(5, Math.min(8, d | 0)); this.writeRegister(REG.MODEM_CONFIG_1, (this.readRegister(REG.MODEM_CONFIG_1) & 0xf1) | ((d - 4) << 1)); }
    setPreambleLength(n) { this.writeRegister(REG.PREAMBLE_MSB, (n >> 8) & 255); this.writeRegister(REG.PREAMBLE_LSB, n & 255); }
    setSyncWord(sw) { this.writeRegister(REG.SYNC_WORD, sw); }
    enableCrc() { this.writeRegister(REG.MODEM_CONFIG_2, this.readRegister(REG.MODEM_CONFIG_2) | 0x04); }
    disableCrc() { this.writeRegister(REG.MODEM_CONFIG_2, this.readRegister(REG.MODEM_CONFIG_2) & 0xfb); }
    enableInvertIQ() { this.writeRegister(REG.INVERTIQ, 0x66); this.writeRegister(REG.INVERTIQ2, 0x19); }
    disableInvertIQ() { this.writeRegister(REG.INVERTIQ, 0x27); this.writeRegister(REG.INVERTIQ2, 0x1d); }
    setOCP(mA) { let t = 27; if (mA <= 120) t = Math.trunc((mA - 45) / 5); else if (mA <= 240) t = Math.trunc((mA + 30) / 10); this.writeRegister(REG.OCP, 0x20 | (0x1f & t)); }
    setGain(g) {
      g = Math.min(6, Math.max(0, g | 0)); this.idle();
      if (!g) this.writeRegister(REG.MODEM_CONFIG_3, 0x04);
      else { this.writeRegister(REG.MODEM_CONFIG_3, 0x00); this.writeRegister(REG.LNA, 0x03); this.writeRegister(REG.LNA, this.readRegister(REG.LNA) | (g << 5)); }
    }
    random() { return this.chip ? this.readRegister(REG.RSSI_WIDEBAND) : 0; }
    dumpRegisters(out) { for (let i = 0; i < 128; i++) { out.print('0x'); out.print(i, 16); out.print(': 0x'); out.println(this.chip ? this.readRegister(i) : 0, 16); } }
    explicitHeaderMode() { this._implicitHeaderMode = 0; this.writeRegister(REG.MODEM_CONFIG_1, this.readRegister(REG.MODEM_CONFIG_1) & 0xfe); }
    implicitHeaderMode() { this._implicitHeaderMode = 1; this.writeRegister(REG.MODEM_CONFIG_1, this.readRegister(REG.MODEM_CONFIG_1) | 0x01); }
    /** Front montant de DIO0 : ce que fait LoRaClass::handleDio0Rise, puis le rappel du programme comme une interruption. */
    poll() {
      if (!this.chip || (!this._onReceive && !this._onTxDone)) { this._dioWas = false; return; }
      this.chip.tick();
      const d = this.chip.dio0(), rise = d && !this._dioWas;
      this._dioWas = d;
      if (!rise) return;
      const k = keyOf(this._dio0);
      if (!k || !at(k).some(x => x.comp === this.c && x.pin === 'DIO0')) return;
      const irq = this.readRegister(REG.IRQ_FLAGS);
      this.writeRegister(REG.IRQ_FLAGS, irq);
      this._dioWas = false;
      if (irq & IRQ.CRC_ERROR) return;
      if (irq & IRQ.RX_DONE) {
        this._packetIndex = 0;
        const len = this._implicitHeaderMode ? this.readRegister(REG.PAYLOAD_LENGTH) : this.readRegister(REG.RX_NB_BYTES);
        this.writeRegister(REG.FIFO_ADDR_PTR, this.readRegister(REG.FIFO_RX_CURRENT));
        if (this._onReceive) ctx.later(this._onReceive, [len]);
      } else if (irq & IRQ.TX_DONE) { if (this._onTxDone) ctx.later(this._onTxDone, []); }
    }
  }
  return {
    LoRaClass,
    /** Avant chaque passage des interruptions : émissions terminées, paquets arrivés, rappels. */
    poll() { for (const o of objs) if (o.chip) { o.chip.tick(); o.poll(); } }
  };
}
