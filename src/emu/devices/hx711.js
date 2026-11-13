// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Balance HX711 (Avia Semiconductor) vue par un vrai programme : DOUT passe à LOW quand une conversion est prête
// (10 par seconde) ; à chaque front montant de PD_SCK, la puce sort le bit suivant de la mesure (24 bits en
// complément à deux, poids fort d'abord). Le nombre total d'impulsions choisit la conversion suivante : 25 (voie A,
// gain 128), 26 (voie B, gain 32), 27 (voie A, gain 64). PD_SCK tenue au niveau haut plus de 60 µs met la puce en
// veille ; au réveil, la première mesure arrive après le temps d'établissement (400 ms à 10 mesures par seconde).
// La mesure vient du montage (c.simR.data.raw, au gain 128) ; rien n'est relié sur la voie B.

export default {
  types: ['hx711'],
  bus: 'pins',
  create(comp, io) {
    const dt = io.pin('DT'), sck = io.pin('SCK');
    if (!dt || !sck) return {};
    const T = io.us(100000), SETTLE = io.us(400000);
    let word = 0, n = 0, ready = false, pulses = 25, high = null, token = 0, dead = false;
    const out = lv => { if (!dead) io.drive(dt, lv); };
    /** Mesure de la conversion qui s'achève, au gain choisi par la lecture précédente. */
    function sample() {
      const d = io.data(), raw = d ? d.raw : 0;
      const v = pulses === 26 ? (Math.random() - 0.5) * 40 : pulses === 27 ? raw / 2 : raw;
      return Math.max(-0x800000, Math.min(0x7fffff, Math.round(v + (Math.random() - 0.5) * 60))) & 0xffffff;
    }
    /** Conversions en continu, une toutes les 100 ms ; sautées pendant une lecture et pendant la veille. */
    function run(first) {
      const t = ++token;
      const step = delay => io.after(delay, () => {
        if (t !== token || dead) return;
        const asleep = high != null && io.now() - high > io.us(60), reading = n > 0 && n <= 24;
        if (!asleep && !reading) {
          if (n > 24) pulses = Math.min(27, n); // impulsions de la lecture précédente : gain de cette conversion
          word = sample(); n = 0; ready = true; out(false);
        }
        step(T);
      });
      step(first);
    }
    out(true);
    run(SETTLE);
    const off = io.onEdge(sck, (lv, cyc) => {
      if (lv) {
        high = cyc;
        if (!ready && n === 0) return; // pas de mesure prête : DOUT reste haut
        n++;
        if (n <= 24) out(((word >> (24 - n)) & 1) === 1);
        else { out(true); ready = false; }
        return;
      }
      const long = high != null && cyc - high > io.us(60);
      high = null;
      if (long) { n = 0; ready = false; out(true); run(SETTLE); } // réveil après une mise en veille
    });
    return { dispose() { off(); dead = true; io.drive(dt, null); } };
  }
};
