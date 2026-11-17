// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modules série (Bluetooth HC-05, GSM SIM800L) vus par un vrai programme : une liaison série 8N1 croisée, TX de la
// carte vers RXD du module, TXD du module vers RX de la carte. Au repos la ligne est HIGH ; chaque octet est un bit de
// départ à LOW, 8 bits de données (poids faible d'abord), un bit d'arrêt à HIGH, chacun durant 1/bauds seconde.
// Sur D0/D1 (ou Serial1 à 3 du Mega), l'UART matériel de la carte s'en charge : on prend ses octets et on lui donne ceux du module. Sur
// d'autres broches (SoftwareSerial), le modèle lit la ligne front par front, au cycle près, et échantillonne chaque
// bit en son milieu à la vitesse du module ; il écrit sa réponse sur l'autre ligne avec la même précision. Une carte
// réglée sur une autre vitesse que le module reçoit et envoie donc du charabia, comme en vrai.
// Vitesse du module : HC-05 à 9600 bauds (réglage d'usine, AT+UART), 38400 en mode AT si EN est à HIGH à la mise
// sous tension de la liaison (ici, au premier octet que la carte envoie, comme l'interpréteur le lit à begin()) ;
// SIM800L en vitesse automatique : il se cale sur le « A » du premier « AT » reçu et s'y tient. Les réponses
// (commandes AT, téléphone simulé, SMS, appels) viennent de serialDevice (sim/models.js), comme pour l'interpréteur.
// Même liaison pour les modules de sim/serialmods.js : GPS NEO-6M (TX vers la carte seulement, 9600 bauds), radio HC-12
// (RXD/TXD, 9600 bauds en mode AT quand SET est à LOW), RS-485 MAX485 (DI ← TX de la carte, RO → RX de la carte, DE
// et /RE lus sur leurs broches). Le MAX485 n'a pas de vitesse à lui : il recopie les bits. Par SoftwareSerial, sa
// vitesse se mesure sur la salve (la plus courte durée entre deux fronts : un bit), et RO rejoue chaque octet reçu
// à la vitesse de la carte qui l'a émis. L'analyseur de bus voit aussi les octets des liaisons SoftwareSerial.
import { serialDevice } from '../../sim/models.js';
import { SERIAL_PINS, SERIAL_TYPES } from '../../sim/serialmods.js';
import { pinMap } from '../../prog/runtime.js';

const BAUDS = [1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 74880, 115200, 230400, 250000, 460800, 500000, 921600, 1000000, 1382400];
/** Vitesse normalisée la plus proche (à 4 % près : la tolérance d'un UART), sinon la vitesse mesurée. */
export const snapBaud = b => BAUDS.find(s => Math.abs(b - s) / s < 0.04) || Math.round(b);

export default {
  types: SERIAL_TYPES,
  bus: 'pins',
  create(comp, io) {
    const P = SERIAL_PINS[comp.type], rxd = io.pin(P.in), txd = io.pin(P.out), en = io.pin('EN'), keys = pinMap(io.hw.prof, io.hw.kind);
    const free = comp.type === 'max485'; // pas de vitesse propre : celle de l'émetteur
    const probe = io.hw.probe || null, label = `SoftwareSerial (${comp.name})`;
    // Sur les broches TX et RX d'un port série matériel (D1/D0, Serial1 à 3 du Mega sur D18/D19…) : l'UART de la carte.
    const ports = io.uarts || [{ rx: keys.get(0), tx: keys.get(1), api: io.uart }];
    const port = ports.find(p => (rxd && rxd === p.tx) || (txd && txd === p.rx)) || {}, U = port.api;
    const hwTx = !!rxd && rxd === port.tx, hwRx = !!txd && txd === port.rx;
    const auto = comp.type === 'sim800';
    const dev = () => serialDevice(comp);
    // HC-12, MAX485 : autres modules du montage, niveau de SET / DE / RE (broche de la carte, sinon le montage), nœuds A et B.
    if (dev().bind) dev().bind({
      peers: types => (io.hw.peers ? io.hw.peers(types) : []),
      level: k => { const key = io.pin(k); if (key) return io.level(key) ? 1 : 0; return io.hw.level ? io.hw.level(comp, k) : null; },
      linked: k => (io.hw.linked ? io.hw.linked(comp, k) : [])
    });
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
    if (hwTx && U) offs.push(U.onTx(b => { power(); dev().write(String.fromCharCode(b), auto ? 0 : snapBaud(U.baud()), ms()); }));
    const toModule = (b, baud, de) => { if (probe) probe.uart(label, 'tx', b); dev().write(String.fromCharCode(b), baud, ms(), de); };
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
        if (stop) toModule(b, auto ? 0 : baud()); // sans bit d'arrêt : erreur de trame, octet perdu
      };
      const hunt = () => {
        const P = (edges[4][0] - start) / 9, at = edges.map(([c]) => (c - start) / P), near = (a, b) => Math.abs(a - b) < 0.3;
        const ok = P > io.MHZ / 2e6 && [1, 2, null, 8, 9].every((v, i) => v == null || near(at[i], v)) && (near(at[2], 7) || near(at[2], 6));
        if (ok) { lock = snapBaud(io.MHZ / P); dev().write(near(at[2], 7) ? 'A' : 'a', 0, ms()); quiet = io.now() + io.us(2000) + 20 * P; }
        start = -1; edges = []; idle = true;
      };
      // MAX485 : fronts de la salve gardés jusqu'à un silence de 2 ms, puis décodés à la vitesse mesurée.
      let burst = [], gen = 0, de = null; // de : DE pendant la salve (relâché juste après par le programme)
      const decodeBurst = () => {
        const ev = burst; burst = []; idle = io.level(rxd) === 1;
        let min = Infinity;
        for (let i = 1; i < ev.length; i++) { const d = ev[i][0] - ev[i - 1][0]; if (d > io.MHZ / 2e6 && d < min) min = d; }
        if (!(min < Infinity)) return;
        const baud = snapBaud(io.MHZ / min), Pb = io.MHZ / baud;
        const lvAt = t => { let lv = 1; for (const [c, l] of ev) if (c <= t) lv = l; else break; return lv; };
        let i = 0;
        while (i < ev.length) {
          if (ev[i][1] !== 0) { i++; continue; }
          const s0 = ev[i][0]; let b = 0;
          for (let k = 0; k < 8; k++) if (lvAt(s0 + (1.5 + k) * Pb)) b |= 1 << k;
          if (lvAt(s0 + 9.5 * Pb)) toModule(b, baud, de);
          const end = s0 + 9.5 * Pb; while (i < ev.length && ev[i][0] <= end) i++;
        }
        quiet = io.now() + io.us(500);
      };
      if (free) {
        offs.push(io.onEdge(rxd, (lv, cyc) => {
          if (!burst.length && (lv || !out())) return; // une salve commence par un bit de départ d'une sortie
          if (!burst.length) { power(); de = dev().driving; }
          burst.push([cyc, lv]);
          const g = ++gen;
          io.after(io.us(2000), () => { if (!dead && g === gen && burst.length) decodeBurst(); });
        }));
      }
      if (!free) offs.push(io.onEdge(rxd, (lv, cyc) => {
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
      const e = q.shift(), b = e.b, P = io.MHZ / (e.baud || baud()), t0 = io.now(), bits = [0, 1, 2, 3, 4, 5, 6, 7].map(i => (b >> i) & 1);
      if (probe) probe.uart(label, 'rx', b);
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
        if (hwRx && U) {
          const s = dev().drain(auto ? 0 : snapBaud(U.baud()), ms());
          if (s) U.inject(Array.from(s, ch => ch.charCodeAt(0) & 255));
          return;
        }
        if (free) { for (const x of dev().take()) for (const ch of x.s) q.push({ b: ch.charCodeAt(0) & 255, baud: x.baud }); }
        else { const s = dev().drain(auto ? 0 : baud(), ms()); for (const ch of s || '') q.push({ b: ch.charCodeAt(0) & 255, baud: 0 }); }
        if (q.length > 4096) q.splice(0, q.length - 4096);
        pump();
      },
      dispose() { dead = true; offs.forEach(f => f()); if (txd) io.drive(txd, null); }
    };
  }
};
