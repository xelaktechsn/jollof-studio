// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Encodeur rotatif KY-040 vu par un vrai programme : CLK et DT, tirées au niveau haut par le module, passent par les
// quatre états de la quadrature à chaque cran (sim/encoder.js), au cycle près ; SW est mise à la masse tant que le
// bouton de l'axe est enfoncé (comp.inp.sw), sinon relâchée (INPUT_PULLUP du programme). Une interruption sur CLK
// (Uno : D2 ou D3), une lecture en boucle ou la bibliothèque Encoder voient les mêmes fronts que sur la vraie carte.
import { createEncTrack } from '../../sim/encoder.js';

export default {
  types: ['ky040'],
  bus: 'pins',
  create(comp, io) {
    const clk = io.pin('CLK'), dt = io.pin('DT'), sw = io.pin('SW');
    if (!clk && !dt && !sw) return {};
    const tr = createEncTrack(comp), perMs = io.MHZ / 1000;
    let dead = false, swDown = null;
    if (clk) io.drive(clk, true);
    if (dt) io.drive(dt, true);
    return {
      frame() {
        for (const x of tr.pull(io.now() / perMs)) {
          io.after(Math.max(1, x.t * perMs - io.now()), () => {
            if (dead) return;
            if (clk) io.drive(clk, !!x.clk);
            if (dt) io.drive(dt, !!x.dt);
          });
        }
        const down = !!(comp.inp && comp.inp.sw);
        if (sw && down !== swDown) { swDown = down; io.drive(sw, down ? false : null); }
      },
      dispose() { dead = true; for (const k of [clk, dt, sw]) if (k) io.drive(k, null); }
    };
  }
};
