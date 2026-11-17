// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Encodeur rotatif KY-040 (20 crans par tour, une période complète des signaux en quadrature par cran). Au repos, sur
// un cran, CLK et DT sont au niveau haut (résistances de tirage de 10 kΩ du module). Dans le sens horaire, CLK tombe
// avant DT : (CLK, DT) passe par 11 → 01 → 00 → 10 → 11 ; dans l'autre sens, DT mène : 11 → 10 → 00 → 01 → 11.
// Le bouton de l'axe (SW) relie sa broche à la masse tant qu'on appuie.
// Les crans demandés (models.js : encTurn, periph(c).ev numérotés par seq) sont déroulés par chaque moteur à sa propre
// heure : createEncTrack rend les fronts à venir, espacés comme une main qui tourne le bouton (STEP_MS entre deux
// fronts, GAP_MS entre deux crans), que l'interpréteur (prog/runtime.js) et les processeurs émulés
// (emu/devices/ky040.js) appliquent à leurs broches.
import { periph } from './models.js';

/** Durée entre deux fronts d'un même cran, et pause entre deux crans (ms). */
export const STEP_MS = 2.5, GAP_MS = 12;
/** Niveaux (CLK, DT) après chacun des quatre fronts d'un cran, depuis le repos 11. */
export const CW = [[0, 1], [0, 0], [1, 0], [1, 1]];
export const CCW = [[1, 0], [0, 0], [0, 1], [1, 1]];

/**
 * Suivi des crans d'un encodeur pour un moteur : pull(maintenant, ms) rend les nouveaux fronts [{ t, clk, dt }], à des
 * heures croissantes, jamais avant maintenant. Les crans tournés avant la création du suivi sont ignorés.
 */
export function createEncTrack(comp) {
  let seen = periph(comp).seq, last = -Infinity;
  return {
    pull(now) {
      const st = periph(comp), out = [];
      if (st.seq < seen) seen = st.seq; // état remis à zéro (simulation relancée)
      for (const e of st.ev) {
        if (e.seq <= seen) continue;
        seen = e.seq;
        const t0 = Math.max(now, last + GAP_MS);
        (e.dir < 0 ? CCW : CW).forEach(([clk, dt], i) => out.push({ t: t0 + i * STEP_MS, clk, dt }));
        last = t0 + 3 * STEP_MS;
      }
      return out;
    }
  };
}

/**
 * Machine à états de la bibliothèque Encoder (Paul Stoffregen, Encoder.h, update()) : s = ancien état (bit 0 : broche 1,
 * bit 1 : broche 2) | nouvelle broche 1 << 2 | nouvelle broche 2 << 3. Rend { state, delta }.
 */
export function stoffregen(state, p1, p2) {
  const s = (state & 3) | (p1 ? 4 : 0) | (p2 ? 8 : 0);
  let delta = 0;
  if (s === 1 || s === 7 || s === 8 || s === 14) delta = 1;
  else if (s === 2 || s === 4 || s === 11 || s === 13) delta = -1;
  else if (s === 3 || s === 12) delta = 2;
  else if (s === 6 || s === 9) delta = -2;
  return { state: s >> 2, delta };
}
