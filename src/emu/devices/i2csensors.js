// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Capteurs I2C VL53L0X, MAX30102, TCS34725, CCS811 et BME680 vus par un vrai programme (mode fidèle) : le modèle
// commun de src/sim/i2csensors.js, branché sur le bus I2C de la carte émulée. Les mesures avancent avec le temps du
// processeur émulé ; les grandeurs mesurées sont celles de l'environnement simulé (c.simR.data). XSHUT (VL53L0X) et
// WAKE (CCS811) : niveau de la broche de la carte qui les commande, sinon celui du montage.
import { SENSOR_I2C, sensorI2c, sensorAddr } from '../../sim/i2csensors.js';

export default {
  types: SENSOR_I2C,
  bus: 'i2c',
  create(comp, io) {
    const level = k => {
      const key = io.pin(k);
      if (key) return io.level(key);
      if (io.hw.node) { const v = io.hw.node(comp, k); if (v != null) return v; }
      return io.hw.level ? io.hw.level(comp, k) : null;
    };
    const dev = sensorI2c(comp, { clock: () => io.now() / io.MHZ, data: () => io.data(), level });
    // Adresse changée par le programme (VL53L0X : setAddress) : la puce répond aussitôt à la nouvelle.
    dev.answers = a => sensorAddr(comp)[0] === a;
    return dev;
  }
};
