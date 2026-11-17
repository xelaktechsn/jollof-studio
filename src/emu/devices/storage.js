// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Horloges DS3231, DS1307 et mémoire AT24C256 vues par un vrai programme (mode fidèle) : le modèle commun de
// src/sim/storage.js, branché sur le bus I2C de la carte émulée. L'horloge avance avec le temps du processeur émulé ;
// la température du DS3231 est celle de l'environnement simulé (c.simR.data.temp).
import { STORE_I2C, storeI2c } from '../../sim/storage.js';

export default {
  types: STORE_I2C,
  bus: 'i2c',
  create(comp, io) {
    return storeI2c(comp, {
      clock: () => io.now() / io.MHZ,
      temp: () => { const d = io.data(); return d ? d.temp : null; },
      mem: () => (io.hw && io.hw.compMem ? io.hw.compMem(comp) : null),
      changed: () => { if (io.hw && io.hw.memChanged) io.hw.memChanged(); }
    });
  }
};
