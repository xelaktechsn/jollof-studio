// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modules série (Bluetooth HC-05, GSM SIM800L) vus par un vrai programme : une liaison série 8N1 croisée, TX de la
// carte vers RXD du module, TXD du module vers RX de la carte. Au repos la ligne est HIGH ; chaque octet est un bit de
// départ à LOW, 8 bits de données (poids faible d'abord), un bit d'arrêt à HIGH, chacun durant 1/bauds seconde.
// Sur D0/D1, l'UART matériel de la carte s'en charge : on prend ses octets et on lui donne ceux du module. Sur
// d'autres broches (SoftwareSerial), le modèle lit la ligne front par front, au cycle près, et échantillonne chaque
// bit en son milieu à la vitesse du module ; il écrit sa réponse sur l'autre ligne avec la même précision. Une carte
// réglée sur une autre vitesse que le module reçoit et envoie donc du charabia, comme en vrai.
// Vitesse du module : HC-05 à 9600 bauds (réglage d'usine, AT+UART), 38400 en mode AT si EN est à HIGH à la mise
// sous tension de la liaison (ici, au premier octet que la carte envoie, comme l'interpréteur le lit à begin()) ;
// SIM800L en vitesse automatique : il se cale sur le « A » du premier « AT » reçu et s'y tient. Les réponses
// (commandes AT, téléphone simulé, SMS, appels) viennent de serialDevice (sim/models.js), comme pour l'interpréteur.
import { serialDevice } from '../../sim/models.js';
import { pinMap } from '../../prog/runtime.js';

const BAUDS = [1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 74880, 115200, 230400, 250000, 460800, 500000, 921600, 1000000, 1382400];
/** Vitesse normalisée la plus proche (à 4 % près : la tolérance d'un UART), sinon la vitesse mesurée. */
export const snapBaud = b => BAUDS.find(s => Math.abs(b - s) / s < 0.04) || Math.round(b);

export default {
  types: ['hc05', 'sim800'],
  bus: 'pins',
  create(comp, io) {
    const rxd = io.pin('RXD'), txd = io.pin('TXD'), en = io.pin('EN'), keys = pinMap(io.hw.prof, io.hw.kind);
    const hwTx = !!rxd && rxd === keys.get(1), hwRx = !!txd && txd === keys.get(0); // sur D1 (TX) et D0 (RX) : UART matériel
    const auto = comp.type === 'sim800';
    const dev = () => serialDevice(comp);
    const ms = () => io.now() / (io.MHZ / 1000);
    let powered = false, lock = 0, dead = false, quiet = 0; // quiet : le module ne parle pas avant (la carte vient d'envoyer)
    /** Mise sous tension de la liaison (premier octet de la carte) : le HC-05 lit EN pour choisir son mode. */
    function power() {
      if (powered) return;
      powered = true;
      const d = dev();
      if (d.power) d.power(en ? io.level(en) === 1 : !!(io.hw.level && io.hw.level(comp, 'EN') === 1));
    }
    const baud = () => (auto ? lock : dev().baud);
    const offs = [];

    // Carte → module, UART matériel : octets complets, la vitesse de la carte comparée à celle du module (serialDevice).
    if (hwTx && io.uart) offs.push(io.uart.onTx(b => { power(); dev().write(String.fromCharCode(b), auto ? 0 : snapBaud(io.uart.baud()), ms()); }));
    // Carte → module, SoftwareSerial : bit de départ (front descendant d'une sortie au repos), puis lecture au milieu
    // de chaque bit. Vitesse automatique (SIM800) : le « A » (ou « a ») a cinq fronts après le bit de départ, aux bits
    // 1, 2, 7 (6 pour « a »), 8 et 9 ; leurs instants donnent la durée d'un bit, sans dépendre de la précision d'un seul.
    if (rxd && !hwTx) {
      let idle = false, start = -1, edges = [];
      const out = () => { const r = io.rec(rxd); return !!r && r.mode === 1; };
      const levelAt = t => { let lv = 0; for (const [c, l] of edges) if (c <= t) lv = l; return lv; };
      const decode = P => {
        if (dead) return;
        let b = 0;
        for (let i = 0; i < 8; i++) if (levelAt(start + (1.5 + i) * P)) b |= 1 << i;
        const stop = levelAt(start + 9.5 * P);
        start = -1; edges = []; idle = io.level(rxd) === 1; quiet = io.now() + io.us(2000) + 20 * P;
        if (stop) dev().write(String.fromCharCode(b), auto ? 0 : baud(), ms()); // sans bit d'arrêt : erreur de trame, octet perdu
      };
      const hunt = () => {
        const P = (edges[4][0] - start) / 9, at = edges.map(([c]) => (c - start) / P), near = (a, b) => Math.abs(a - b) < 0.3;
        const ok = P > io.MHZ / 2e6 && [1, 2, null, 8, 9].every((v, i) => v == null || near(at[i], v)) && (near(at[2], 7) || near(at[2], 6));
        if (ok) { lock = snapBaud(io.MHZ / P); dev().write(near(at[2], 7) ? 'A' : 'a', 0, ms()); quiet = io.now() + io.us(2000) + 20 * P; }
        start = -1; edges = []; idle = true;
      };
      offs.push(io.onEdge(rxd, (lv, cyc) => {
        if (start >= 0) {
          edges.push([cyc, lv]);
          if (auto && !lock && edges.length === 5) hunt();
          return;
        }
        if (lv) { idle = true; return; }
        if (!idle || !out()) { idle = false; return; } // broche encore en entrée (démarrage) : pas un bit de départ
        start = cyc; edges = [];
        power();
        if (!auto || lock) { const P = io.MHZ / baud(); io.after(9.5 * P - (io.now() - start), () => decode(P)); }
      }));
    }

    // Module → carte, SoftwareSerial : la ligne TXD, HIGH au repos, porte chaque octet à la vitesse du module. Le module
    // traite une commande en quelques millisecondes : il répond quand la carte a fini d'envoyer (SoftwareSerial ne sait
    // pas émettre et recevoir à la fois).
    const q = [];
    let sending = false;
    function pump() {
      if (sending || dead || !q.length) return;
      sending = true;
      if (io.now() < quiet) { io.after(quiet - io.now(), () => { sending = false; pump(); }); return; }
      const b = q.shift(), P = io.MHZ / baud(), t0 = io.now(), bits = [0, 1, 2, 3, 4, 5, 6, 7].map(i => (b >> i) & 1);
      let k = 0;
      const step = () => {
        if (dead) return;
        if (k === 10) { sending = false; pump(); return; }
        io.drive(txd, k === 0 ? false : k === 9 ? true : !!bits[k - 1]);
        k++;
        io.after(t0 + k * P - io.now(), step);
      };
      step();
    }
    if (txd) io.drive(txd, true); // module alimenté : sa sortie TXD est au repos, HIGH
    return {
      /** Fin de tranche : ce que le module a à dire (réponses AT, texte du téléphone, SMS reçus, appels). */
      frame() {
        if (!txd || (auto && !lock && !hwRx)) return; // SIM800 pas encore calé sur une vitesse : il se tait
        if (!rxd) power();
        if (hwRx && io.uart) {
          const s = dev().drain(auto ? 0 : snapBaud(io.uart.baud()), ms());
          if (s) io.uart.inject(Array.from(s, ch => ch.charCodeAt(0) & 255));
          return;
        }
        const s = dev().drain(auto ? 0 : baud(), ms());
        for (const ch of s || '') q.push(ch.charCodeAt(0) & 255);
        if (q.length > 4096) q.splice(0, q.length - 4096);
        pump();
      },
      dispose() { dead = true; offs.forEach(f => f()); if (txd) io.drive(txd, null); }
    };
  }
};
