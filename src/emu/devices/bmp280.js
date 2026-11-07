// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Capteur de pression BMP280 (Bosch) vu par un vrai programme : des registres lus et écrits sur le bus I2C.
// La puce ne donne pas des °C ni des Pa, mais deux mesures brutes de 20 bits (0xF7 à 0xFC) et, en usine, des
// coefficients d'étalonnage propres à chaque exemplaire (0x88 à 0x9F) : c'est le programme qui calcule la
// température puis la pression avec les formules de la fiche technique. Le modèle fait le chemin inverse :
// il cherche la mesure brute que ces formules ramènent à la valeur du montage (c.simR.data). Modes : veille au
// démarrage (rien ne bouge), forcé (une mesure, puis veille), normal (mesure, pause t_sb, mesure…).

// Coefficients d'étalonnage de l'exemple de la fiche technique (dig_T1 à dig_P9 ; T1 et P1 sans signe).
const CAL = [27504, 26435, -1000, 36477, -10685, 3024, 2855, 140, -7, 15500, -14600, 6000];
const [T1, T2, T3] = CAL, [P1, P2, P3, P4, P5, P6, P7, P8, P9] = CAL.slice(3).map(BigInt);
const T_SB = [0.5, 62.5, 125, 250, 500, 1000, 2000, 4000]; // pause entre deux mesures en mode normal (ms)

/** Formule de la fiche technique : t_fine à partir de la mesure brute (température en 0,01 °C = (t_fine·5 + 128) >> 8). */
const tFine = a => { const x = (a >> 4) - T1; return ((((a >> 3) - (T1 << 1)) * T2) >> 11) + ((((x * x) >> 12) * T3) >> 14); };
/** Formule 64 bits de la fiche technique : pression en Pa × 256. */
function press256(a, tf) {
  let v1 = BigInt(tf) - 128000n, v2 = v1 * v1 * P6;
  v2 += (v1 * P5) << 17n; v2 += P4 << 35n;
  v1 = ((v1 * v1 * P3) >> 8n) + ((v1 * P2) << 12n);
  v1 = (((1n << 47n) + v1) * P1) >> 33n;
  if (v1 === 0n) return 0;
  let p = 1048576n - BigInt(a);
  p = (((p << 31n) - v2) * 3125n) / v1;
  v1 = (P9 * (p >> 13n) * (p >> 13n)) >> 25n; v2 = (P8 * p) >> 19n;
  return Number(((p + v1 + v2) >> 8n) + (P7 << 4n));
}
/** Plus petite mesure brute (20 bits) pour laquelle ok(mesure) est vrai : les formules sont monotones. */
function search(ok) { let lo = 0, hi = 0xfffff; while (lo < hi) { const m = (lo + hi) >> 1; if (ok(m)) hi = m; else lo = m + 1; } return lo; }

/** Mesures brutes qui redonnent temp (°C) et press (hPa). */
export function rawOf(temp, press) {
  // Viser le milieu du pas de 0,01 °C : la mesure arrondie à 16 bits (suréchantillonnage ×1) y reste.
  const adcT = search(a => tFine(a) >= temp * 5120), tf = tFine(adcT);
  return { adcT, adcP: search(a => press256(a, tf) <= press * 25600) };
}

export default {
  types: ['bmp280'],
  bus: 'i2c',
  create(comp, io) {
    const regs = new Uint8Array(256);
    let ptr = 0, reg = true, mode = 0, t0 = 0, n0 = -1, last = { temp: 25, press: 1013.25 };
    CAL.forEach((v, i) => { regs[0x88 + 2 * i] = v & 0xff; regs[0x89 + 2 * i] = (v >> 8) & 0xff; });
    const reset = () => { regs.fill(0, 0xf3); regs[0xf7] = regs[0xfa] = 0x80; mode = 0; };
    reset();
    // Durée d'une mesure (typique, fiche technique) : 1 ms + 2 ms par échantillon de température et de pression.
    const os = b => (b ? Math.min(16, 1 << (b - 1)) : 0);
    const tMeas = () => { const t = os(regs[0xf4] >> 5), p = os((regs[0xf4] >> 2) & 7); return io.us(1000 + 2000 * t + (p ? 2000 * p + 500 : 0)); };
    const period = () => tMeas() + io.us(T_SB[regs[0xf5] >> 5] * 1000);
    /** Fin d'une mesure : registres de données mis à jour (20 bits, moins si le suréchantillonnage est faible). */
    function latch() {
      const d = io.data(); if (d) last = d;
      const { adcT, adcP } = rawOf(last.temp, last.press);
      const put = (at, osrs, v) => {
        if (!osrs) { regs[at] = 0x80; regs[at + 1] = regs[at + 2] = 0; return; } // mesure sautée : 0x80000
        const step = 1 << (5 - Math.min(5, osrs)); v = Math.min(0xfffff, Math.round(v / step) * step);
        regs[at] = v >> 12; regs[at + 1] = (v >> 4) & 0xff; regs[at + 2] = (v & 0xf) << 4;
      };
      put(0xfa, regs[0xf4] >> 5, adcT); put(0xf7, (regs[0xf4] >> 2) & 7, adcP);
    }
    /** Où en est la puce à cet instant (mesure finie, retour en veille après le mode forcé). */
    function sync() {
      const dt = io.now() - t0;
      if (mode === 1 && dt >= tMeas()) { latch(); mode = 0; regs[0xf4] &= 0xfc; }
      if (mode === 3 && dt >= tMeas()) { const n = Math.floor((dt - tMeas()) / period()); if (n !== n0) { n0 = n; latch(); } }
    }
    const measuring = () => { const dt = io.now() - t0; return mode === 1 ? dt < tMeas() : mode === 3 && dt % period() < tMeas(); };
    function set(r, v) {
      if (r === 0xe0 && v === 0xb6) reset();
      else if (r === 0xf5) regs[r] = v;
      else if (r === 0xf4) {
        sync(); regs[r] = v;
        const m = v & 3; // 00 veille, 01 et 10 forcé, 11 normal
        if (!m) mode = 0; else if (m < 3) { mode = 1; t0 = io.now(); } else if (mode !== 3) { mode = 3; t0 = io.now(); n0 = -1; }
      }
    }
    return {
      // Écriture : registre puis valeur, par paires. Lecture : à partir du registre choisi, qui avance tout seul ;
      // les données sont figées au début de la lecture (une lecture en rafale ne mélange pas deux mesures).
      start(write) { reg = true; if (!write) sync(); },
      write(b) { if (reg) ptr = b; else set(ptr, b); reg = !reg; return true; },
      read() { const r = ptr; ptr = (ptr + 1) & 0xff; return r === 0xd0 ? 0x58 : r === 0xf3 ? (measuring() ? 8 : 0) : r === 0xe0 ? 0 : regs[r]; }
    };
  }
};
