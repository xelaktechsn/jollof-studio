// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Barrette WS2812B vue par un vrai programme : un seul fil (DIN) à 800 kbit/s, sans horloge. Chaque bit commence
// par un front montant et la LED mesure la largeur de l'impulsion haute : courte (≈ 0,4 µs) pour 0, longue
// (≈ 0,8 µs) pour 1 ; le seuil est à 0,6 µs. 24 bits par LED, vert, rouge puis bleu, poids fort d'abord : la
// première LED garde les 24 premiers bits et passe la suite aux suivantes (au-delà de la barrette, ils se perdent).
// Ligne basse plus de 50 µs (reset) : chaque LED qui a reçu ses 24 bits les affiche ; les autres gardent leur couleur.
// La bibliothèque applique setBrightness() avant l'envoi : les octets reçus sont publiés tels quels sur la fiche de
// la broche, rec.px = [[r, g, b], …], comme le fait l'interpréteur.

const BIT1 = 0.6, RESET = 50; // µs

export default {
  types: ['ws2812'],
  bus: 'pins',
  create(comp, io) {
    const key = io.pin('DIN');
    if (!key) return {};
    const n = (comp.pixels && comp.pixels.length) || 8, max = n * 24, thr = io.us(BIT1), gap = io.us(RESET);
    const buf = new Uint8Array(n * 3), shown = Array.from({ length: n }, () => [0, 0, 0]);
    let bits = 0, acc = 0, rise = -1, fall = -Infinity, lit = 0, dirty = false;
    /** Reset : les LED complètes affichent leurs octets (reçus G, R, B). */
    function latch() {
      const got = Math.min(n, (bits / 24) | 0);
      for (let i = 0; i < got; i++) shown[i] = [buf[3 * i + 1], buf[3 * i], buf[3 * i + 2]];
      if (got) { lit = Math.max(lit, got); dirty = true; }
      bits = 0; acc = 0;
    }
    // Un front par appel, en temps constant : la bibliothèque envoie un bit toutes les 1,25 µs.
    const off = io.onEdge(key, (lv, cyc) => {
      if (lv) { if (cyc - fall > gap) latch(); rise = cyc; return; }
      if (rise < 0) return;
      fall = cyc;
      if (bits < max) {
        acc = (acc << 1) | (cyc - rise > thr ? 1 : 0);
        if ((++bits & 7) === 0) { buf[(bits >> 3) - 1] = acc; acc = 0; }
      }
      rise = -1;
    });
    return {
      frame() {
        // Plusieurs trames dans la tranche : chaque reset a déjà verrouillé la précédente ; reste la dernière.
        if (bits && !io.level(key) && io.now() - fall > gap) latch();
        if (!dirty) return;
        dirty = false;
        const rec = io.rec(key);
        if (rec) rec.px = shown.slice(0, lit).map(c => c.slice());
      },
      dispose() { off(); }
    };
  }
};
