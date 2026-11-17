// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pilotes de moteurs pas à pas (A4988, DRV8825) vus par un vrai programme (mode fidèle) : chaque front de la broche
// de la carte reliée à STEP (digitalWrite, AccelStepper, registres du port…) passe par le même modèle que
// l'interpréteur (src/sim/motordrv.js), à l'heure du cycle où il a lieu. DIR, ENABLE, SLEEP, RESET et la
// microrésolution se lisent au moment du front : sur la carte si elles y sont reliées, sinon dans le montage.
import { stepEdge, STEP_TYPES } from '../../sim/motordrv.js';

export default {
  types: STEP_TYPES,
  bus: 'pins',
  create(comp, io) {
    const step = io.pin('STEP');
    if (!step) return {};
    const node = k => (io.hw && io.hw.node ? io.hw.node(comp, k) : io.hw && io.hw.level ? io.hw.level(comp, k) : null);
    const read = p => { const k = io.pin(p); return k ? io.level(k) : node(p); };
    const off = io.onEdge(step, (lv, cyc) => stepEdge(comp, lv, (cyc ?? io.now()) / io.MHZ * 1000, read));
    return { dispose: off };
  }
};
