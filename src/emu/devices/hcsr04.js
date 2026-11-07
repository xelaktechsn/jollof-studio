// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Télémètre HC-SR04 vu par un vrai programme : une impulsion HIGH d'au moins 10 µs sur TRIG lance, à son front
// descendant, une salve de 8 ultrasons à 40 kHz ; 0,25 ms plus tard ECHO passe à HIGH et y reste le temps de
// l'aller-retour du son (data.us, 58 µs par cm), que le programme mesure avec pulseIn() ou micros(). Sans écho
// (obstacle hors de portée), ECHO retombe au bout de 38 ms. ECHO est une sortie push-pull : LOW au repos, et le
// module ignore TRIG tant qu'une mesure est en cours.

const BURST = 250;  // µs entre la fin de l'impulsion TRIG et le début de l'écho (salve de 8 périodes de 25 µs)
const NONE = 38000; // µs : ECHO reste haut aussi longtemps quand rien ne revient

export default {
  types: ['hcsr04'],
  bus: 'pins',
  create(comp, io) {
    const trig = io.pin('TRIG'), echo = io.pin('ECHO');
    if (!trig || !echo) return {};
    let rise = null, busy = false, self = false, dead = false;
    const out = lv => { if (dead) return; self = true; io.drive(echo, lv); self = false; };
    out(false);
    const off = io.onEdge(trig, (lv, cyc) => {
      if (self || busy) return; // TRIG et ECHO sur la même broche : l'écho n'est pas un nouveau déclenchement
      if (lv) { rise = cyc; return; }
      if (rise == null) return;
      const w = cyc - rise; rise = null;
      if (w < io.us(9.5)) return; // impulsion trop courte : pas de salve
      const d = io.data(), us = d && d.us > 0 ? d.us : NONE;
      busy = true;
      io.after(io.us(BURST), () => {
        out(true);
        io.after(io.us(us), () => { out(false); busy = false; });
      });
    });
    return { dispose() { off(); dead = true; self = true; io.drive(echo, null); self = false; } };
  }
};
