// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Capteurs DHT11 et DHT22 (AM2302) vus par un vrai programme : un seul fil, à drain ouvert, tiré au niveau haut.
// La carte tient DATA à LOW (au moins 18 ms pour le DHT11, 0,8 ms pour le DHT22) puis la relâche ; 30 µs plus tard
// le capteur répond : 80 µs bas, 80 µs haut, puis 40 bits (50 µs bas, puis 26 µs haut pour un 0, 70 µs pour un 1),
// poids fort d'abord : humidité (2 octets), température (2 octets), somme de contrôle. Trop courte, l'impulsion de
// départ ne réveille pas le capteur. Il ne mesure qu'une fois par période (1 s, 2 s) : lu plus souvent, il renvoie
// l'ancienne mesure. Il ne tire jamais la ligne vers le haut : le niveau haut vient de la résistance de tirage.

const SPEC = { dht11: { start: 18000, period: 1000 }, dht22: { start: 800, period: 2000 } }; // µs, ms

/** Les 5 octets de la trame. DHT22 : dixièmes sur 16 bits, bit 15 = signe ; DHT11 : partie entière puis dixièmes. */
export function dhtFrame(type, { temp, hum }) {
  let b;
  if (type === 'dht22') {
    const h = Math.round(Math.max(0, Math.min(100, hum)) * 10), t = Math.round(Math.min(Math.abs(temp), 125) * 10) | (temp < 0 ? 0x8000 : 0);
    b = [h >> 8, h & 255, t >> 8, t & 255];
  } else {
    const h = Math.round(Math.max(0, Math.min(99.9, hum)) * 10), t = Math.round(Math.max(0, Math.min(99.9, temp)) * 10); // jamais sous 0 °C
    b = [Math.floor(h / 10), h % 10, Math.floor(t / 10), t % 10];
  }
  return [...b, (b[0] + b[1] + b[2] + b[3]) & 255];
}

export default {
  types: ['dht11', 'dht22'],
  bus: 'pins',
  create(comp, io) {
    const key = io.pin('DATA'), spec = SPEC[comp.type];
    if (!key || !spec) return {};
    let fall = null, busy = false, self = false, dead = false, meas = null, measAt = -Infinity;
    // Relâchée, la ligne remonte par la résistance de 10 kΩ soudée sur le module (null → true), même quand le
    // programme la lit en INPUT sans tirage interne.
    const line = lv => { self = true; io.drive(key, lv === null ? true : lv); self = false; };
    line(null);
    /** Réponse : niveaux successifs (false = tiré à LOW, null = relâché), chacun à son cycle absolu. */
    function reply(t0) {
      const now = io.now();
      if (!meas || now - measAt >= io.us(spec.period * 1000)) { const d = io.data(); meas = d && { temp: d.temp, hum: d.hum }; measAt = now; }
      if (!meas || meas.temp == null || meas.hum == null) return; // capteur muet (non alimenté, en défaut)
      const steps = [[false, 30], [null, 110], [false, 190]]; // [niveau, instant en µs depuis la fin du départ]
      let t = 190;
      for (const byte of dhtFrame(comp.type, meas)) for (let i = 7; i >= 0; i--) {
        steps.push([null, t += 50], [false, t += (byte >> i) & 1 ? 70 : 26]);
      }
      steps.push([null, t + 50]); // 50 µs bas pour finir, puis la ligne est rendue
      busy = true;
      let k = 0;
      const next = () => {
        if (dead) return;
        const [lv] = steps[k++];
        line(lv);
        if (k < steps.length) io.after(t0 + io.us(steps[k][1]) - io.now(), next);
        else busy = false;
      };
      io.after(t0 + io.us(steps[0][1]) - now, next);
    }
    const off = io.onEdge(key, (lv, cyc) => {
      if (self || busy) return;
      if (!lv) { fall = cyc; return; }
      if (fall == null) return;
      const w = cyc - fall; fall = null;
      if (w >= io.us(spec.start)) reply(cyc);
    });
    return { dispose() { dead = true; off(); self = true; io.drive(key, null); self = false; } };
  }
};
