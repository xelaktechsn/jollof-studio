// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modules en paquet (.jpart) vus par un vrai programme (mode fidèle) : bus I2C et SPI déclarés (registres,
// commandes, trames : sim/pkgbus.js, le même code que l'interpréteur) et sorties à impulsions (signal carré à la
// fréquence de la mesure, que le programme compte par attachInterrupt ou mesure par pulseIn). Les types branchés se
// lisent à chaque rattachement : un paquet installé pendant la simulation est pris en compte.
import { createI2c, createSpi, pulseHz } from '../../sim/pkgbus.js';
import { pkgI2c, pkgSpi, pkgPulse, pkgTypes } from '../../sim/pkgparts.js';

export const pkgI2cModel = {
  get types() { return pkgTypes('i2c'); },
  bus: 'i2c',
  create(comp, io) { return createI2c(pkgI2c(comp.type), () => io.data()); }
};

export const pkgSpiModel = {
  get types() { return pkgTypes('spi'); },
  bus: 'spi',
  create(comp, io) { const spec = pkgSpi(comp.type); return { cs: spec.cs, ...createSpi(spec, () => io.data()) }; }
};

export const pkgPulseModel = {
  get types() { return pkgTypes('pulse'); },
  bus: 'pins',
  create(comp, io) {
    let dead = false;
    const stops = [];
    for (const it of pkgPulse(comp.type) || []) {
      const key = io.pin(it.pin); if (!key) continue;
      let level = false;
      io.drive(key, false);
      // Une demi-période à la fois, recalculée à chaque front : la fréquence suit la mesure du montage.
      const step = () => {
        if (dead) return;
        const d = io.data(), hz = pulseHz(it, d ? d[it.quantity] : 0);
        if (!(hz > 0)) { if (level) { level = false; io.drive(key, false); } io.after(io.us(20000), step); return; }
        level = !level; io.drive(key, level);
        io.after(io.us(500000 / hz), step);
      };
      io.after(io.us(1000), step);
      stops.push(() => io.drive(key, null));
    }
    return { dispose() { dead = true; stops.forEach(f => f()); } };
  }
};
