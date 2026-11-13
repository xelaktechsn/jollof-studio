// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Capteur BME280 (Bosch) vu par un vrai programme : les registres du BMP280 (température, pression, mêmes formules
// et mêmes coefficients, voir bmp280.js), plus l'humidité : une mesure brute de 16 bits (0xFD, 0xFE), ses
// coefficients d'étalonnage (0xA1, 0xE1 à 0xE7) et son registre de réglage ctrl_hum (0xF2), pris en compte à
// l'écriture suivante de ctrl_meas (0xF4), comme sur la puce. Identifiant 0x60 (0x58 pour un BMP280).
import { rawOf } from './bmp280.js';

// Coefficients de température et de pression : ceux de bmp280.js (exemple de la fiche technique du BMP280).
const CAL = [27504, 26435, -1000, 36477, -10685, 3024, 2855, 140, -7, 15500, -14600, 6000];
const [T1, T2, T3] = CAL;
// Coefficients d'humidité d'un exemplaire réel : dig_H1 à dig_H6.
const H1 = 75, H2 = 362, H3 = 0, H4 = 313, H5 = 50, H6 = 30;
const T_SB = [0.5, 62.5, 125, 250, 500, 1000, 10, 20]; // pause entre deux mesures en mode normal (ms), propre au BME280

// Divisions entières tronquées, comme la bibliothèque Adafruit (int32_t) : pas de >> sur des nombres JavaScript.
const dv = (v, d) => Math.trunc(v / d);
const tFine = a => dv((dv(a, 8) - T1 * 2) * T2, 2048) + dv(dv((dv(a, 16) - T1) ** 2, 4096) * T3, 16384);
/** Formule entière de la fiche technique du BME280 (écrite comme Adafruit_BME280::readHumidity) : %HR × 1024. */
function hum1024(adcH, tf) {
  const v1 = tf - 76800;
  const v5 = dv(adcH * 16384 - H4 * 1048576 - H5 * v1 + 16384, 32768);
  const v4 = dv(dv(v1 * H6, 1024) * (dv(v1 * H3, 2048) + 32768), 1024) + 2097152;
  const v3 = v5 * dv(v4 * H2 + 8192, 16384);
  const h = v3 - dv(dv(dv(v3, 32768) ** 2, 128) * H1, 16);
  return dv(Math.max(0, Math.min(419430400, h)), 4096);
}
/** Plus petite mesure brute (16 bits) qui redonne au moins l'humidité voulue : la formule est croissante. */
export function rawHum(hum, temp) {
  const tf = tFine(rawOf(temp, 1013.25).adcT), want = Math.max(0, Math.min(100, hum)) * 1024;
  let lo = 0, hi = 0xffff;
  while (lo < hi) { const m = (lo + hi) >> 1; if (hum1024(m, tf) >= want) hi = m; else lo = m + 1; }
  return lo;
}

export default {
  types: ['bme280'],
  bus: 'i2c',
  create(comp, io) {
    const regs = new Uint8Array(256);
    let ptr = 0, reg = true, mode = 0, t0 = 0, n0 = -1, osH = 0, last = { temp: 25, press: 1013.25, hum: 50 };
    CAL.forEach((v, i) => { regs[0x88 + 2 * i] = v & 0xff; regs[0x89 + 2 * i] = (v >> 8) & 0xff; });
    regs[0xa1] = H1; regs[0xe1] = H2 & 0xff; regs[0xe2] = (H2 >> 8) & 0xff; regs[0xe3] = H3;
    regs[0xe4] = (H4 >> 4) & 0xff; regs[0xe5] = ((H5 & 0x0f) << 4) | (H4 & 0x0f); regs[0xe6] = (H5 >> 4) & 0xff; regs[0xe7] = H6 & 0xff;
    const reset = () => { regs.fill(0, 0xf2, 0xf6); regs.fill(0, 0xf7); regs[0xf7] = regs[0xfa] = 0x80; regs[0xfd] = 0x80; mode = 0; osH = 0; };
    reset();
    // Durée d'une mesure (typique, fiche technique) : 1 ms + 2 ms par échantillon de chaque grandeur mesurée.
    const os = b => (b ? Math.min(16, 1 << (b - 1)) : 0);
    const tMeas = () => {
      const t = os(regs[0xf4] >> 5), p = os((regs[0xf4] >> 2) & 7), h = os(osH);
      return io.us(1000 + 2000 * t + (p ? 2000 * p + 500 : 0) + (h ? 2000 * h + 500 : 0));
    };
    const period = () => tMeas() + io.us(T_SB[regs[0xf5] >> 5] * 1000);
    function latch() {
      const d = io.data(); if (d) last = d;
      const { adcT, adcP } = rawOf(last.temp, last.press);
      const put = (at, osrs, v) => {
        if (!osrs) { regs[at] = 0x80; regs[at + 1] = regs[at + 2] = 0; return; }
        const step = 1 << (5 - Math.min(5, osrs)); v = Math.min(0xfffff, Math.round(v / step) * step);
        regs[at] = v >> 12; regs[at + 1] = (v >> 4) & 0xff; regs[at + 2] = (v & 0xf) << 4;
      };
      put(0xfa, regs[0xf4] >> 5, adcT); put(0xf7, (regs[0xf4] >> 2) & 7, adcP);
      if (osH) { const h = rawHum(last.hum ?? 50, last.temp); regs[0xfd] = h >> 8; regs[0xfe] = h & 0xff; } else { regs[0xfd] = 0x80; regs[0xfe] = 0; }
    }
    function sync() {
      const dt = io.now() - t0;
      if (mode === 1 && dt >= tMeas()) { latch(); mode = 0; regs[0xf4] &= 0xfc; }
      if (mode === 3 && dt >= tMeas()) { const n = Math.floor((dt - tMeas()) / period()); if (n !== n0) { n0 = n; latch(); } }
    }
    const measuring = () => { const dt = io.now() - t0; return mode === 1 ? dt < tMeas() : mode === 3 && dt % period() < tMeas(); };
    function set(r, v) {
      if (r === 0xe0 && v === 0xb6) reset();
      else if (r === 0xf2) regs[r] = v & 7;
      else if (r === 0xf5) regs[r] = v;
      else if (r === 0xf4) {
        sync(); regs[r] = v; osH = regs[0xf2] & 7; // ctrl_hum ne compte qu'après l'écriture de ctrl_meas
        const m = v & 3;
        if (!m) mode = 0; else if (m < 3) { mode = 1; t0 = io.now(); } else if (mode !== 3) { mode = 3; t0 = io.now(); n0 = -1; }
      }
    }
    return {
      start(write) { reg = true; if (!write) sync(); },
      write(b) { if (reg) ptr = b; else set(ptr, b); reg = !reg; return true; },
      read() { const r = ptr; ptr = (ptr + 1) & 0xff; return r === 0xd0 ? 0x60 : r === 0xf3 ? (measuring() ? 8 : 0) : r === 0xe0 ? 0 : regs[r]; }
    };
  }
};
