// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Centrale inertielle MPU-6050 (InvenSense) vue par un vrai programme : des registres sur le bus I2C. Le programme
// écrit le numéro du premier registre puis lit ou écrit à la suite (le numéro avance tout seul). La puce démarre
// endormie (PWR_MGMT_1 = 0x40) : tant que le programme ne la réveille pas, les mesures restent à 0, comme sur le
// vrai module. Les mesures (0x3B à 0x48) sont des entiers de 16 bits signés, poids fort d'abord : accélération,
// température (°C = brut / 340 + 36,53), rotation ; leur échelle suit les plages choisies (ACCEL_CONFIG 0x1C :
// 16384 pas par g à ±2 g, divisé par 2 à chaque plage ; GYRO_CONFIG 0x1B : 131 pas par °/s à ±250 °/s). Les valeurs
// viennent du montage (c.simR.data : g, rad/s comme la bibliothèque Adafruit, °C) ; au-delà de la plage, la mesure sature.

const GYRO = [131, 65.5, 32.8, 16.4];      // pas par °/s selon FS_SEL (fiche technique)
const STBY = [5, 4, 3, -1, 2, 1, 0];       // bit de PWR_MGMT_2 qui met chaque axe en attente (−1 : température)

export default {
  types: ['mpu6050'],
  bus: 'i2c',
  create(comp, io) {
    const regs = new Uint8Array(128);
    let ptr = 0, first = true, last = { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, temp: 25 };
    const reset = () => { regs.fill(0); regs[0x6b] = 0x40; regs[0x75] = 0x68; };
    reset();
    /** Nouvel échantillon dans les registres de mesure (début d'une lecture : la rafale reste cohérente). */
    function sample() {
      if (regs[0x6b] & 0x40) return; // endormie : les registres gardent la dernière mesure
      const d = io.data(); if (d) last = d;
      const a = 16384 >> ((regs[0x1c] >> 3) & 3), g = GYRO[(regs[0x1b] >> 3) & 3] * 180 / Math.PI;
      [last.ax * a, last.ay * a, last.az * a, (last.temp - 36.53) * 340, last.gx * g, last.gy * g, last.gz * g].forEach((v, i) => {
        if (i === 3 ? regs[0x6b] & 8 : (regs[0x6c] >> STBY[i]) & 1) return; // capteur arrêté (TEMP_DIS, STBY_*)
        const n = Math.max(-32768, Math.min(32767, Math.round(v || 0)));
        regs[0x3b + 2 * i] = (n >> 8) & 0xff; regs[0x3c + 2 * i] = n & 0xff;
      });
      regs[0x3a] |= regs[0x38] & 1; // DATA_RDY_INT, si l'interruption est activée
    }
    function set(r, v) {
      if (r === 0x6b && v & 0x80) return reset();          // DEVICE_RESET : tous les registres reviennent à leur valeur de départ
      if (r === 0x75 || r === 0x68 || (r >= 0x3a && r <= 0x48)) return; // lecture seule ; SIGNAL_PATH_RESET se remet à 0
      if (r === 0x6a) { if (v & 1) regs.fill(0, 0x3b, 0x49); v &= 0xf8; } // SIG_COND_RESET efface les mesures
      regs[r] = v;
    }
    return {
      start(write) { first = true; if (!write) sample(); },
      write(b) { if (first) { ptr = b & 0x7f; first = false; } else { set(ptr, b); ptr = (ptr + 1) & 0x7f; } return true; },
      read() {
        const r = ptr, v = regs[r]; ptr = (ptr + 1) & 0x7f;
        if (r === 0x3a) regs[0x3a] = 0; // INT_STATUS s'efface à la lecture
        return v;
      }
    };
  }
};
