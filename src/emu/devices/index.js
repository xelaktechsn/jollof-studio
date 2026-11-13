// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modules du montage vus par un vrai programme (mode fidèle) : ils répondent sur le bus I2C, le bus SPI ou par
// des signaux temporisés sur une broche (DHT, 1-Wire, HC-SR04…), comme les vraies puces. Chaque modèle écrit le
// même état que les bibliothèques simulées de l'interpréteur (c.progScreen, c.periph…) : écrans, panneau des
// périphériques et vérificateur ne voient aucune différence entre les deux modes.
//
// Un modèle est un module qui exporte { types: ['lcd1602', …], bus: 'i2c' | 'spi' | 'pins', create(comp, io) }.
//   i2c  : create rend { start?(write), write(octet) → acquitté, read(ack) → octet, stop?(), frame?() }
//   spi  : create rend { cs: 'SDA' (broche de sélection du module), select?(), transfer(octet) → octet, deselect?(), frame?() }
//   pins : create rend { frame?(), dispose?() } et se branche sur les broches par io (ci-dessous).
// io, donné à create : { cpu, MHZ, hw, comp, pin(clé du module) → clé de la carte ou null, level(clé carte),
//   onEdge(clé carte, fn(niveau, cycle)) → désabonnement, drive(clé carte, niveau | null), after(cycles, fn), data(),
//   rec(clé carte) → fiche de la broche (px…), now() → cycle courant, us(µs) → cycles,
//   uart : { onTx(fn(octet, cycle)) → désabonnement, inject(octets), baud() } (port série matériel D0/D1) }.
// drive(clé, null) relâche la ligne : elle reprend le niveau du montage (résistance de tirage câblée), sinon le
// tirage interne de la carte (INPUT_PULLUP), sinon LOW.
import lcd from './lcd.js';
import ssd1306 from './ssd1306.js';
import bmp280 from './bmp280.js';
import bme280 from './bme280.js';
import bh1750 from './bh1750.js';
import hx711 from './hx711.js';
import mpu6050 from './mpu6050.js';
import dht from './dht.js';
import ds18b20 from './ds18b20.js';
import hcsr04 from './hcsr04.js';
import ws2812 from './ws2812.js';
import keypad from './keypad.js';
import irnec from './irnec.js';
import mfrc522 from './mfrc522.js';
import nrf24 from './nrf24.js';
import uart from './uart.js';
import { pkgI2cModel, pkgSpiModel, pkgPulseModel } from './pkg.js';

// Modules en paquet : leurs types se lisent à chaque rattachement (paquets installés pendant la simulation).
export const MODELS = [lcd, ssd1306, bmp280, bme280, bh1750, mpu6050, hx711, dht, ds18b20, hcsr04, ws2812, keypad, irnec, mfrc522, nrf24, uart].filter(m => m.types.length).concat([pkgI2cModel, pkgSpiModel, pkgPulseModel]);

/**
 * Branche les modèles sur un processeur émulé. ctx : { cpu, MHZ, twi, spi, hw, pinApi, uart } (avr8js). Un autre
 * processeur (RP2040, src/emu/rp2040.js) donne en plus son horloge et ses bus : now() → cycle courant,
 * after(cycles, fn), i2c : { setHandler({ start(), connect(adresse, écriture) → acquitté, write(octet) → acquitté,
 * read(ack) → octet, stop() }) }, spiBus : { onTransfer(fn(octet) → octet) } ; twi et spi ne servent alors pas.
 * cpu n'est plus qu'un identifiant de la carte (bus 1-Wire partagé). Rend { frame() }.
 */
export function attachDevices(ctx) {
  const { cpu, twi, spi, hw, pinApi, MHZ, uart } = ctx;
  const now = ctx.now || (() => cpu.cycles);
  const after = ctx.after || ((cycles, fn) => cpu.addClockEvent(fn, Math.max(1, Math.round(cycles))));
  const live = new Map(); // id du composant → { model, comp, dev, keyMap }
  let i2c = new Map(), spiDevs = [], selected = null, lastBind = -Infinity;

  /** Broches du composant reliées à la carte : clé du module → clé de la carte (hw.at donne l'inverse). */
  function keyMapOf(comp) {
    const m = new Map();
    for (const key of pinApi.keys()) for (const x of (hw.at ? hw.at(key) : [])) if (x.comp === comp && !m.has(x.pin)) m.set(x.pin, key);
    return m;
  }
  function ioFor(comp, keyMap) {
    return {
      cpu, MHZ, hw, comp,
      pin: k => keyMap.get(k) || null,
      level: key => pinApi.level(key),
      onEdge: (key, fn) => pinApi.onEdge(key, fn),
      drive: (key, level) => pinApi.drive(key, level),
      after,
      data: () => (hw.data ? hw.data(comp) : null),
      rec: key => (pinApi.rec ? pinApi.rec(key) : null),
      now,
      us: n => n * MHZ / 1e6,
      uart
    };
  }
  /** Modules présents sur cette carte (refait de temps en temps : le montage peut changer pendant la simulation). */
  function bind() {
    const seen = new Set(), nextI2c = new Map(), nextSpi = [];
    for (const model of MODELS) {
      const comps = model.bus === 'i2c' ? (hw.bus ? hw.bus(model.types).map(x => ({ comp: x.comp, addr: x.addr })) : [])
        : (hw.comps ? hw.comps(model.types) : []).map(comp => ({ comp }));
      for (const { comp, addr } of comps) {
        seen.add(comp.id);
        let e = live.get(comp.id);
        const keyMap = keyMapOf(comp), sig = [...keyMap].join(',');
        if (!e || e.sig !== sig) {
          if (e && e.dev.dispose) e.dev.dispose();
          e = { model, comp, sig, dev: model.create(comp, ioFor(comp, keyMap)) };
          live.set(comp.id, e);
        }
        if (model.bus === 'i2c') for (const a of addr || []) nextI2c.set(a, e.dev);
        if (model.bus === 'spi' && keyMap.get(e.dev.cs)) nextSpi.push({ dev: e.dev, cs: keyMap.get(e.dev.cs) });
      }
    }
    for (const [id, e] of live) if (!seen.has(id)) { if (e.dev.dispose) e.dev.dispose(); live.delete(id); }
    i2c = nextI2c;
    // SPI : le module dont la broche de sélection passe à LOW reçoit les octets suivants.
    for (const s of spiDevs) if (s.off) s.off();
    spiDevs = nextSpi.map(s => ({ ...s, off: pinApi.onEdge(s.cs, lv => {
      if (!lv) { selected = s.dev; if (s.dev.select) s.dev.select(); }
      else if (selected === s.dev) { if (s.dev.deselect) s.dev.deselect(); selected = null; }
    }) }));
  }

  // Bus I2C : chaque adresse est servie par son module ; une adresse vide n'est pas acquittée.
  let cur = null;
  const bus = {
    start() { cur = null; },
    connect(addr, write) { cur = i2c.get(addr) || null; if (cur && cur.start) cur.start(write); return !!cur; },
    write(v) { return cur ? cur.write(v & 0xff) !== false : false; },
    read(ack) { return cur ? cur.read(ack) & 0xff : 0xff; },
    stop() { if (cur && cur.stop) cur.stop(); cur = null; }
  };
  if (ctx.i2c) ctx.i2c.setHandler(bus);
  else twi.eventHandler = { // TWI d'avr8js
    start() { bus.start(); twi.completeStart(); },
    stop() { bus.stop(); twi.completeStop(); },
    connectToSlave(addr, write) { twi.completeConnect(bus.connect(addr, write)); },
    writeByte(v) { twi.completeWrite(bus.write(v)); },
    readByte(ack) { twi.completeRead(bus.read(ack)); }
  };
  // Bus SPI : octet échangé avec le module sélectionné ; personne : la ligne MISO reste haute (0xFF).
  const transfer = v => (selected ? selected.transfer(v & 0xff) & 0xff : 0xff);
  if (ctx.spiBus) ctx.spiBus.onTransfer(transfer); else spi.onTransfer = transfer;

  return {
    /** Fin d'une tranche de simulation : modules rafraîchis (toutes les 0,5 s) et état publié (écrans…). */
    frame() {
      const now = performance.now();
      if (now - lastBind > 500) { lastBind = now; bind(); }
      for (const e of live.values()) if (e.dev.frame) e.dev.frame();
    },
    live
  };
}
