// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Capteur de lumière BH1750 (ROHM) vu par un vrai programme : des commandes d'un octet sur le bus I2C, puis une
// lecture de deux octets. La puce rend un compte, pas des lux : lux = compte / 1,2 × (69 / MTreg), divisé par deux
// dans les modes « 2 » (demi-lux). Le modèle fait le chemin inverse à partir de la valeur du montage (c.simR.data).
// Mesure : 120 ms en haute résolution, 16 ms en basse résolution (× MTreg / 69) ; les modes « une fois » mesurent
// une seule fois puis éteignent la puce.

const MODES = new Set([0x10, 0x11, 0x13, 0x20, 0x21, 0x23]);

export default {
  types: ['bh1750'],
  bus: 'i2c',
  create(comp, io) {
    let on = false, mode = 0, mt = 69, t0 = 0, count = 0, out = [], pendingHigh = null;
    const low = () => (mode & 0x0f) === 3;
    const half = () => (mode & 0x0f) === 1;
    const tMeas = () => io.us((low() ? 16000 : 120000) * mt / 69);
    /** Compte que donnerait la puce pour l'éclairement du montage. */
    function measure() {
      const d = io.data(), lux = d ? d.lux : 0;
      let c = lux * 1.2 * mt / 69 * (half() ? 2 : 1);
      if (low()) c = Math.floor(c / 4) * 4; // basse résolution : 4 lx
      count = Math.max(0, Math.min(0xffff, Math.round(c)));
    }
    /** Où en est la mesure : finie, la valeur se fige (et la puce s'éteint en mode « une fois »). */
    function sync() {
      if (!mode || !on) return;
      if (io.now() - t0 >= tMeas()) {
        measure();
        if (mode >= 0x20) { on = false; mode = 0; } else t0 = io.now();
      }
    }
    function command(v) {
      if (v === 0x00) { on = false; return; }
      if (v === 0x01) { on = true; return; }
      if (v === 0x07) { if (on) count = 0; return; }
      if ((v & 0xf8) === 0x40) { pendingHigh = v & 0x07; return; } // MTreg, 3 bits de poids fort
      if ((v & 0xe0) === 0x60) { mt = Math.max(31, Math.min(254, ((pendingHigh ?? mt >> 5) << 5) | (v & 0x1f))); pendingHigh = null; return; }
      if (MODES.has(v)) { on = true; mode = v; t0 = io.now(); }
    }
    return {
      start(write) { if (!write) { sync(); out = [count >> 8, count & 0xff]; } },
      write(v) { command(v); return true; },
      read() { return out.length ? out.shift() : 0xff; }
    };
  }
};
