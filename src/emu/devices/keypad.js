// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Clavier matriciel 4×4 vu par un vrai programme : aucune puce, seulement 16 interrupteurs. Une touche enfoncée
// relie le fil de sa ligne (R1 à R4) à celui de sa colonne (C1 à C4). Le programme met un des deux fils en sortie
// (la bibliothèque Keypad : chaque colonne à LOW, tour à tour) et lit l'autre en INPUT_PULLUP : la touche lui
// recopie le niveau de la sortie. Les deux fils en entrée : la résistance de tirage de l'un tire aussi l'autre à
// HIGH, si bien que la colonne qui passe ensuite en sortie à LOW fait un front, et le modèle le voit.
// Le niveau est recalculé à chaque front d'un des huit fils (au cycle près, avant que le programme ne lise) et à
// chaque fin de tranche. La touche enfoncée vient du panneau « Périphériques » : periph(c).down = { r, c }.
import { periph } from '../../sim/models.js';

export default {
  types: ['keypad'],
  bus: 'pins',
  create(comp, io) {
    const wire = {};
    for (const p of ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4']) wire[p] = io.pin(p);
    let down = null, row = null, col = null, busy = false;
    const mode = k => { const r = io.rec(k); return r ? r.mode : 0; }; // 1 sortie, 2 INPUT_PULLUP, 0 entrée
    const free = () => { if (row) { io.drive(row, null); io.drive(col, null); } };
    /** Les deux fils reliés par la touche : le côté en entrée prend le niveau de l'autre. */
    function connect() {
      const mr = mode(row), mc = mode(col);
      if (mr === 1 && mc !== 1) { io.drive(col, !!io.level(row)); io.drive(row, null); }
      else if (mc === 1 && mr !== 1) { io.drive(row, !!io.level(col)); io.drive(col, null); }
      else if (mr !== 1 && (mr === 2) !== (mc === 2)) { io.drive(mr === 2 ? col : row, true); io.drive(mr === 2 ? row : col, null); }
      else free(); // deux sorties (court-circuit, non représenté) ou deux entrées au même tirage
    }
    function update() {
      if (busy) return; // nos propres changements de niveau reviennent par onEdge
      busy = true;
      try {
        const d = periph(comp).down || null;
        if (d !== down) {
          free(); down = d;
          row = d ? wire['R' + (d.r + 1)] : null; col = d ? wire['C' + (d.c + 1)] : null;
          if (!row || !col) row = col = null;
        }
        if (row) connect();
      } finally { busy = false; }
    }
    const offs = Object.values(wire).filter(Boolean).map(k => io.onEdge(k, update));
    update();
    return {
      frame: update,
      dispose() { offs.forEach(f => f()); busy = false; down = null; free(); }
    };
  }
};
