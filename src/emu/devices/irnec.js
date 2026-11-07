// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Récepteur infrarouge (VS1838B) vu par un vrai programme : la télécommande émet des salves à 38 kHz, que le module
// démodule. Sa sortie OUT est HIGH au repos et LOW pendant chaque salve. Trame NEC : salve de 9 ms, silence de
// 4,5 ms, puis 32 bits poids faible d'abord (adresse, adresse inversée, commande, commande inversée) ; chaque bit est
// une salve de 562,5 µs suivie d'un silence de 562,5 µs (0) ou 1687,5 µs (1) ; une dernière salve ferme la trame.
// Touche maintenue : trame de répétition (9 ms, 2,25 ms, 562,5 µs), 110 ms après le début de la précédente.
// IRremote lit OUT toutes les 50 µs et mesure ces durées ; une nouvelle trame arrivée moins de 70 ms après la fin
// de la précédente serait prise pour une répétition : les appuis sont donc espacés, en file, sans chevauchement.
// Les appuis viennent du panneau « Périphériques » : periph(c).frames, numérotées par seq.
import { periph } from '../../sim/models.js';

const U = 562.5, PERIOD = 110000, PAUSE = 80000; // µs

/** Durées de la trame (µs), en alternance LOW (salve) puis HIGH (silence), en commençant par une salve. */
function necTimes(f) {
  if (f.repeat) return [16 * U, 4 * U, U];
  const a = f.addr & 0xffff, c = f.cmd & 255;
  const word = ((a > 255 ? a : a | ((~a & 255) << 8)) | (c << 16) | ((~c & 255) << 24)) >>> 0;
  const d = [16 * U, 8 * U];
  for (let i = 0; i < 32; i++) d.push(U, (word >>> i) & 1 ? 3 * U : U);
  d.push(U);
  return d;
}

export default {
  types: ['ir'],
  bus: 'pins',
  create(comp, io) {
    const key = io.pin('OUT');
    if (!key) return {};
    const queue = [];
    let seen = periph(comp).seq, sending = false, dead = false, lastStart = -Infinity, lastEnd = -Infinity;
    io.drive(key, true);
    function send(f) {
      const d = necTimes(f), now = io.now();
      const at = Math.max(now, f.repeat ? lastStart + io.us(PERIOD) : lastEnd + io.us(PAUSE));
      let t = 0, i = 0;
      sending = true;
      // Un évènement d'horloge par changement de niveau, sur des instants absolus (pas de dérive d'arrondi).
      const step = () => {
        if (dead) return;
        if (!i) t = lastStart = io.now();
        io.drive(key, i % 2 === 1);
        if (i === d.length) { sending = false; lastEnd = io.now(); if (queue.length) send(queue.shift()); return; }
        t += io.us(d[i++]);
        io.after(t - io.now(), step);
      };
      io.after(at - now, step);
    }
    return {
      frame() {
        const st = periph(comp);
        if (st.seq <= seen) { seen = st.seq; return; } // rien de neuf (ou état du panneau remis à zéro)
        for (const f of st.frames) if (f.seq > seen) queue.push(f);
        seen = st.seq;
        if (queue.length > 8) queue.splice(0, queue.length - 8);
        if (!sending && queue.length) send(queue.shift());
      },
      dispose() { dead = true; io.drive(key, null); }
    };
  }
};
