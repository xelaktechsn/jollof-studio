// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modbus TCP (Modbus Messaging on TCP/IP Implementation Guide V1.0b) : serveur de l'« Automate Modbus TCP » du plan
// réseau (port 502) et trames d'un client. En-tête MBAP de 7 octets, fonctions 1 à 6, 15 et 16.
// Les registres sont ceux de l'automate (bank) : sa table propre, ou l'image du programme Ladder du projet faite par
// src/plc/modbus.js (même plan d'adresses que le serveur Modbus réel de l'application de bureau).
import { bytesOf } from './bytes.js';

export const FN = { READ_COILS: 1, READ_DI: 2, READ_HR: 3, READ_IR: 4, WRITE_COIL: 5, WRITE_REG: 6, WRITE_COILS: 15, WRITE_REGS: 16 };
const TABLE = { 1: 'coils', 2: 'di', 3: 'hr', 4: 'ir' };
const u16 = n => [(n >>> 8) & 255, n & 255];
const rd16 = (b, i) => (b[i] << 8) | b[i + 1];

/** Réponse à une PDU (fonction + données) : bank { read(table, adresse) → valeur | null, write(table, adresse, v) → bool }. */
export function modbusPdu(bank, pdu) {
  const fn = pdu[0], ex = code => [fn | 0x80, code];
  if (!bank) return ex(4);
  if (fn >= 1 && fn <= 4) {
    const a = rd16(pdu, 1), n = rd16(pdu, 3), t = TABLE[fn];
    if (n < 1 || n > (fn <= 2 ? 2000 : 125)) return ex(3);
    const vals = []; for (let i = 0; i < n; i++) { const v = bank.read(t, a + i); if (v == null) return ex(2); vals.push(v); }
    if (fn <= 2) { const bytes = new Array(Math.ceil(n / 8)).fill(0); vals.forEach((v, i) => { if (v) bytes[i >> 3] |= 1 << (i & 7); }); return [fn, bytes.length, ...bytes]; }
    return [fn, n * 2, ...vals.flatMap(v => u16(v & 0xffff))];
  }
  if (fn === 5) { const a = rd16(pdu, 1), v = rd16(pdu, 3); if (v !== 0xff00 && v !== 0) return ex(3); return bank.write('coils', a, v === 0xff00 ? 1 : 0) ? Array.from(pdu.slice(0, 5)) : ex(2); }
  if (fn === 6) { const a = rd16(pdu, 1), v = rd16(pdu, 3); return bank.write('hr', a, v) ? Array.from(pdu.slice(0, 5)) : ex(2); }
  if (fn === 15 || fn === 16) {
    const a = rd16(pdu, 1), n = rd16(pdu, 3);
    for (let i = 0; i < n; i++) {
      const v = fn === 15 ? (pdu[6 + (i >> 3)] >> (i & 7)) & 1 : rd16(pdu, 6 + i * 2);
      if (!bank.write(fn === 15 ? 'coils' : 'hr', a + i, v)) return ex(2);
    }
    return [fn, ...u16(a), ...u16(n)];
  }
  return ex(1);
}
/** Serveur : rend { accept(sock) } pour lan.listen(…, 502, …). log(e) : { fn, addr, ok }. */
export function createModbusServer({ bank, log = () => {} }) {
  return {
    accept(sock) {
      let buf = '';
      sock.onData(d => {
        buf += d;
        while (buf.length >= 7) {
          const h = bytesOf(buf.slice(0, 7)), len = rd16(h, 4);
          if (buf.length < 6 + len) break;
          const frame = bytesOf(buf.slice(0, 6 + len)); buf = buf.slice(6 + len);
          if (rd16(frame, 2) !== 0) continue; // pas Modbus
          const pdu = frame.slice(7), out = modbusPdu(bank(), pdu);
          log({ fn: pdu[0], addr: rd16(pdu, 1), ok: !(out[0] & 0x80) });
          sock.write(Uint8Array.from([frame[0], frame[1], 0, 0, ...u16(out.length + 1), frame[6], ...out]));
        }
      });
    }
  };
}
/** Trame client : transaction, unité, PDU. */
export const modbusRequest = (tid, unit, pdu) => Uint8Array.from([...u16(tid), 0, 0, ...u16(pdu.length + 1), unit & 255, ...pdu]);
export const readPdu = (fn, addr, n) => [fn, ...u16(addr), ...u16(n)];
export const writeCoilPdu = (addr, on) => [5, ...u16(addr), on ? 0xff : 0, 0];
export const writeRegPdu = (addr, v) => [6, ...u16(addr), ...u16(v & 0xffff)];
/** Lit la réponse (Uint8Array après MBAP) : { ok, values } ou { ok: false, code }. */
export function parseResponse(pdu, n) {
  const fn = pdu[0];
  if (fn & 0x80) return { ok: false, code: pdu[1] };
  if (fn <= 2) { const out = []; for (let i = 0; i < n; i++) out.push((pdu[2 + (i >> 3)] >> (i & 7)) & 1); return { ok: true, values: out }; }
  if (fn <= 4) { const out = []; for (let i = 0; i < pdu[1] / 2; i++) out.push(rd16(pdu, 2 + i * 2)); return { ok: true, values: out }; }
  return { ok: true, values: [] };
}
