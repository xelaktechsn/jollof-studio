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
//   onEdge(clé carte, fn(niveau, cycle)) → désabonnement, drive(clé carte, niveau | null), after(cycles, fn), data() }.
import lcd from './lcd.js';

export const MODELS = [lcd];

/** Branche les modèles sur un processeur émulé. ctx : { cpu, MHZ, twi, spi, hw, pinApi }. Rend { frame() }. */
export function attachDevices(ctx) {
  const { cpu, twi, spi, hw, pinApi, MHZ } = ctx;
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
      after: (cycles, fn) => cpu.addClockEvent(fn, Math.max(1, Math.round(cycles))),
      data: () => (hw.data ? hw.data(comp) : null)
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

  // Bus I2C (TWI) : chaque adresse est servie par son module ; une adresse vide n'est pas acquittée.
  let cur = null;
  twi.eventHandler = {
    start() { cur = null; twi.completeStart(); },
    stop() { if (cur && cur.stop) cur.stop(); cur = null; twi.completeStop(); },
    connectToSlave(addr, write) { cur = i2c.get(addr) || null; if (cur && cur.start) cur.start(write); twi.completeConnect(!!cur); },
    writeByte(v) { twi.completeWrite(cur ? cur.write(v & 0xff) !== false : false); },
    readByte(ack) { twi.completeRead(cur ? cur.read(ack) & 0xff : 0xff); }
  };
  // Bus SPI : octet échangé avec le module sélectionné ; personne : la ligne MISO reste haute (0xFF).
  spi.onTransfer = v => (selected ? selected.transfer(v & 0xff) & 0xff : 0xff);

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
