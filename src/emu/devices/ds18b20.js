// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Sonde DS18B20 vue par un vrai programme : bus 1-Wire, un fil à drain ouvert tiré au niveau haut et partagé par
// plusieurs sondes (la ligne est basse dès qu'une seule la tire). La carte cadence tout, octets poids faible d'abord :
//  - remise à zéro : LOW au moins 480 µs ; relâchée, chaque sonde signale sa présence (30 µs après, LOW 120 µs) ;
//  - créneau d'écriture : la carte tire la ligne et la relâche avant 15 µs (1) ou après 60 µs (0) ; la sonde lit
//    la ligne 30 µs après le front descendant ;
//  - créneau de lecture : la carte tire la ligne un instant ; pour un 0, la sonde la garde basse jusqu'à 30 µs.
// Après la remise à zéro, une commande ROM choisit les sondes (0x33 lire l'adresse, 0x55 désigner une adresse,
// 0xCC toutes, 0xF0 recherche : chaque bit de l'adresse, son complément, puis la direction choisie par la carte,
// 0xEC recherche des sondes en alarme), puis une commande de fonction : 0x44 conversion (les créneaux de lecture
// rendent 0 tant qu'elle dure), 0xBE lire le bloc-notes (9 octets, CRC Dallas), 0x4E écrire TH, TL et la
// configuration (résolution 9 à 12 bits), 0x48 les copier en EEPROM, 0xB8 les relire, 0xB4 alimentation (1 : externe).

/** Durée d'une conversion (ms), 9 à 12 bits : la fiche donne des maxima (93,75 à 750 ms), une vraie sonde finit vers 80 %. */
const CONV = [75, 150, 300, 600];
const RESET = 400; // µs : impulsion reconnue comme remise à zéro (480 µs demandés, marge pour les retards de la carte)
const SLOT = 30;   // µs : instant où la sonde lit la ligne, et fin de son 0 dans un créneau de lecture

/** CRC 8 bits Dallas/Maxim (x⁸ + x⁵ + x⁴ + 1, poids faible d'abord). */
export function crc8(a, n = a.length) {
  let crc = 0;
  for (let i = 0; i < n; i++) for (let b = a[i] & 255, j = 0; j < 8; j++, b >>= 1) crc = ((crc ^ b) & 1) ? (crc >> 1) ^ 0x8c : crc >> 1;
  return crc;
}
/** Adresse 64 bits : famille 0x28, numéro de série tiré de l'identifiant (le même que l'interpréteur), CRC. */
export function romOf(comp) {
  let h = 2166136261 >>> 0;
  for (const ch of String(comp.id || comp.name || 'ds')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const a = [0x28];
  for (let i = 0; i < 6; i++) { a.push(h & 255); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; }
  a.push(crc8(a, 7));
  return a;
}

// Un fil, plusieurs sondes : io.drive ne garde qu'un niveau par broche, le bus combine donc les sondes qui tirent
// la ligne, et distribue aux sondes les fronts venus de la carte (pas les leurs).
const buses = new WeakMap(); // processeur → Map(clé de la broche → bus)
function busFor(io, key) {
  let pins = buses.get(io.cpu);
  if (!pins) buses.set(io.cpu, (pins = new Map()));
  let b = pins.get(key);
  if (b) return b;
  b = { slaves: new Set(), low: new Set(), self: false, fall: null };
  b.pull = (s, on) => {
    const was = b.low.size > 0;
    if (on) b.low.add(s); else b.low.delete(s);
    if (was !== b.low.size > 0) { b.self = true; io.drive(key, b.low.size ? false : b.idle); b.self = false; }
  };
  // Sonde câblée (le module n'est relié que si la résistance de tirage est là, sinon il est en défaut) : la ligne
  // relâchée est haute par cette résistance. On le pose ici plutôt que de dépendre du calcul du circuit, fait à un
  // instant où la carte peut justement tenir la ligne à LOW.
  b.idle = io.data() ? true : null;
  b.self = true; io.drive(key, b.idle); b.self = false;
  const off = io.onEdge(key, (lv, cyc) => {
    if (b.self) return;
    if (!lv) { b.fall = cyc; for (const s of b.slaves) s.slot(); return; }
    if (b.fall == null) return;
    const w = cyc - b.fall; b.fall = null;
    for (const s of b.slaves) s.rise(w);
  });
  b.leave = s => { b.slaves.delete(s); b.pull(s, false); if (!b.slaves.size) { off(); pins.delete(key); } };
  pins.set(key, b);
  return b;
}

export default {
  types: ['ds18b20'],
  bus: 'pins',
  create(comp, io) {
    const key = io.pin('DQ');
    if (!key) return {};
    const bus = busFor(io, key), rom = romOf(comp), me = {};
    let ee = [0x4b, 0x46, 0x7f];                            // EEPROM : TH, TL, configuration (réglages d'usine)
    const sp = [0x50, 0x05, ...ee, 0xff, 0x0c, 0x10];       // bloc-notes : 85 °C à la mise sous tension
    let step = null, rcv = null, alarm = false, dead = false;
    const pull = on => { if (!dead) bus.pull(me, on); };
    const hold = () => { pull(true); io.after(io.us(SLOT), () => pull(false)); };
    // step : ce que fait la sonde au prochain front descendant ; rcv : où va le bit écrit par la carte dans ce créneau.
    const idle = () => { step = null; };
    function recv(n, done) {
      const out = []; let v = 0, i = 0;
      step = () => { rcv = b => { v |= b << (i++ & 7); if (!(i & 7)) { out.push(v); v = 0; if (out.length === n) { step = null; done(out); } } }; };
    }
    function send(bytes, done) {
      const bits = bytes.flatMap(b => [0, 1, 2, 3, 4, 5, 6, 7].map(i => (b >> i) & 1));
      let i = 0;
      step = () => { if (!bits[i++]) hold(); if (i === bits.length) { step = null; done(); } };
    }
    function search() {
      let i = 0, ph = 0;
      step = () => {
        const b = (rom[i >> 3] >> (i & 7)) & 1;
        if (ph < 2) { if (!(b ^ ph)) hold(); ph++; return; } // le bit, puis son complément
        ph = 0;
        rcv = d => { if (d !== b || ++i === 64) idle(); }; // direction de la carte : les autres sondes se retirent
      };
    }
    /** Fin de conversion : température arrondie à la résolution, bits non significatifs à 0, alarme TH/TL. */
    function latch(res) {
      const d = io.data();
      if (!d || d.temp == null) return;
      const q = 2 ** (res + 1), raw = (Math.round(Math.max(-55, Math.min(125, d.temp)) * q) * 2 ** (3 - res)) & 0xffff;
      sp[0] = raw & 255; sp[1] = raw >> 8;
      const t = (raw << 16 >> 16) >> 4;
      alarm = t >= (sp[2] << 24 >> 24) || t <= (sp[3] << 24 >> 24);
    }
    function func() {
      recv(1, ([c]) => {
        if (c === 0x44) {
          const res = (sp[4] >> 5) & 3, dur = io.us(CONV[res] * 1000), until = io.now() + dur;
          step = () => { if (io.now() < until) hold(); };
          io.after(dur, () => { if (!dead) latch(res); });
        } else if (c === 0xbe) send([...sp, crc8(sp)], idle);
        else if (c === 0x4e) recv(3, ([th, tl, cfg]) => { sp[2] = th; sp[3] = tl; sp[4] = (cfg & 0x60) | 0x1f; });
        else if (c === 0x48) ee = sp.slice(2, 5);
        else if (c === 0xb8) sp.splice(2, 3, ...ee);
        // 0xB4 : alimentée par VDD, la sonde laisse la ligne haute (lu 1). Commande inconnue : elle attend la remise à zéro.
      });
    }
    function romCmd(c) {
      if (c === 0x33) send(rom, func);
      else if (c === 0x55) recv(8, a => (a.every((x, i) => x === rom[i]) ? func() : idle()));
      else if (c === 0xcc) func();
      else if (c === 0xf0 || (c === 0xec && alarm)) search();
    }
    me.slot = () => { rcv = null; if (step) step(); };
    me.rise = w => {
      if (w >= io.us(RESET)) {
        rcv = null; step = null;
        const d = io.data();
        if (!d || d.temp == null || d.temp === -127) return; // sonde muette (non alimentée, pas de résistance de tirage)
        io.after(io.us(30), () => pull(true));
        io.after(io.us(150), () => pull(false));
        recv(1, ([c]) => romCmd(c));
      } else if (rcv) { const f = rcv; rcv = null; f(w < io.us(SLOT) ? 1 : 0); }
    };
    bus.slaves.add(me);
    return { dispose() { dead = true; bus.leave(me); } };
  }
};
