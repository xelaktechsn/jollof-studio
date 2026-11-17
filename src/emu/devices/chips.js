// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Circuits logiques vus par un vrai programme (mode fidèle) : le même modèle que l'interpréteur (src/sim/chips.js).
//   74HC595, 74HC165 : au niveau des broches. Chaque front d'une broche de la carte reliée à la puce (shiftOut, registres
//   du port, SPI logiciel…) la fait avancer au cycle près ; la sortie Q7 du 74HC165 est imposée à la broche de la carte.
//   MCP23017, PCF8574, PCA9685 : esclaves I2C, registre par registre, branchés sur le TWI de la carte émulée.
// Les sorties vivent sur comp.icState : le calcul du circuit (dc.js) les voit comme celles de l'interpréteur.
import { chipI2c, chipOut, shiftEdges, CHIPS } from '../../sim/chips.js';

/** Niveau du montage sur une broche de la puce que la carte ne commande pas (alimentation, masse, autre puce). */
const nodeOf = (io, comp) => k => (io.hw && io.hw.node ? io.hw.node(comp, k) : io.hw && io.hw.level ? io.hw.level(comp, k) : null);

const shift = {
  types: ['hc595', 'hc165'],
  bus: 'pins',
  create(comp, io) {
    const node = nodeOf(io, comp), keys = {};
    // Broches de la puce reliées à la carte : on y lit le niveau au moment du front.
    for (const p of ['DS', 'SHCP', 'STCP', 'OE', 'MR', 'PL', 'CP', 'CE', 'Q7', 'Q7N']) { const k = io.pin(p); if (k) keys[p] = k; }
    const read = (c, p) => (keys[p] ? io.level(keys[p]) : node(p));
    /** Q7 / Q7N reliées à la carte : la puce les impose (lu par digitalRead, shiftIn, registres PINx). */
    const drive = () => { for (const p of ['Q7', 'Q7N']) if (keys[p]) { const o = chipOut(comp, p); io.drive(keys[p], o ? !!o.d : null); } };
    const offs = [];
    for (const p of ['DS', 'SHCP', 'STCP', 'OE', 'MR', 'PL', 'CP', 'CE']) {
      if (!keys[p]) continue;
      // Le cycle du front sert de jeton : deux puces en cascade sur la même horloge voient le front au même cycle.
      offs.push(io.onEdge(keys[p], (lv, cyc) => { shiftEdges([{ comp, pin: p }], lv, -1 - (cyc ?? 0), read); drive(); }));
    }
    drive();
    return {
      frame: drive,
      dispose() { offs.forEach(f => f()); for (const p of ['Q7', 'Q7N']) if (keys[p]) io.drive(keys[p], null); }
    };
  }
};

const i2c = {
  types: ['mcp23017', 'pcf8574', 'pca9685'],
  bus: 'i2c',
  create(comp, io) { return chipI2c(comp, { node: nodeOf(io, comp) }); }
};

export default [shift, i2c];
export { CHIPS };
