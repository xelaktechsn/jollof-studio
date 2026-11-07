// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Client Firmata (protocole 2.x, celui du programme StandardFirmata livré avec l'IDE Arduino) : la carte réelle
// devient un ensemble de broches pilotées depuis l'ordinateur. Écrit d'après la documentation du protocole
// (firmata/protocol sur GitHub). Indépendant du transport : transport = { write(Uint8Array), onData(fn(octets)) }.
export const MODE = { INPUT: 0, OUTPUT: 1, ANALOG: 2, PWM: 3, SERVO: 4, PULLUP: 11 };
const SYSEX = 0xf0, END = 0xf7;
const lsb = v => v & 0x7f, msb = v => (v >> 7) & 0x7f;

/** Messages vers la carte. */
export const encode = {
  version: () => [0xf9],
  firmware: () => [SYSEX, 0x79, END],
  capabilities: () => [SYSEX, 0x6b, END],
  analogMapping: () => [SYSEX, 0x69, END],
  samplingInterval: ms => [SYSEX, 0x7a, lsb(ms), msb(ms), END],
  pinMode: (pin, mode) => [0xf4, pin & 0x7f, mode & 0x7f],
  digitalPin: (pin, v) => [0xf5, pin & 0x7f, v ? 1 : 0],
  /** PWM ou angle de servo ; au-delà de la broche 15, message étendu. */
  analogWrite: (pin, v) => (pin < 16 ? [0xe0 | pin, lsb(v), msb(v)] : [SYSEX, 0x6f, pin & 0x7f, lsb(v), msb(v), (v >> 14) & 0x7f, END]),
  reportAnalog: (ch, on) => [0xc0 | (ch & 0x0f), on ? 1 : 0],
  reportDigital: (port, on) => [0xd0 | (port & 0x0f), on ? 1 : 0]
};

/**
 * Lecture des octets reçus : rend une fonction feed(octets) qui appelle on(message) pour chaque message complet.
 * Messages : { t: 'version', major, minor } · { t: 'firmware', name, major, minor } · { t: 'analog', ch, v } ·
 * { t: 'digital', port, bits } · { t: 'caps', pins: [[{ mode, res }]] } · { t: 'mapping', ch: [canal | null par broche] } ·
 * { t: 'string', text }.
 */
export function decoder(on) {
  let buf = [], need = 0, sysex = false;
  const seven = a => { let s = ''; for (let i = 0; i + 1 < a.length; i += 2) s += String.fromCharCode(a[i] | (a[i + 1] << 7)); return s; };
  function sys(d) {
    const cmd = d[0], b = d.slice(1);
    if (cmd === 0x79) on({ t: 'firmware', major: b[0], minor: b[1], name: seven(b.slice(2)) });
    else if (cmd === 0x6c) {
      const pins = [[]];
      for (let i = 0; i < b.length; i++) { if (b[i] === 0x7f) { pins.push([]); continue; } pins[pins.length - 1].push({ mode: b[i], res: b[i + 1] }); i++; }
      if (!pins[pins.length - 1].length) pins.pop();
      on({ t: 'caps', pins });
    } else if (cmd === 0x6a) on({ t: 'mapping', ch: b.map(x => (x === 0x7f ? null : x)) });
    else if (cmd === 0x71) on({ t: 'string', text: seven(b) });
  }
  return bytes => {
    for (const x of bytes) {
      if (sysex) { if (x === END) { sysex = false; sys(buf); buf = []; } else buf.push(x); continue; }
      if (x & 0x80) {
        buf = [x]; need = 0;
        if (x === SYSEX) { sysex = true; buf = []; }
        else if (x === 0xf9 || (x & 0xf0) === 0xe0 || (x & 0xf0) === 0x90) need = 2;
        continue;
      }
      if (!buf.length || !need) continue;
      buf.push(x);
      if (buf.length - 1 < need) continue;
      const [c, a, b] = buf; buf = []; need = 0;
      if (c === 0xf9) on({ t: 'version', major: a, minor: b });
      else if ((c & 0xf0) === 0xe0) on({ t: 'analog', ch: c & 0x0f, v: a | (b << 7) });
      else if ((c & 0xf0) === 0x90) on({ t: 'digital', port: c & 0x0f, bits: a | ((b & 1) << 7) });
    }
  };
}

/**
 * Carte Firmata : ready() attend la réponse de la carte (version, nom du programme, broches) ; ensuite pinMode,
 * digitalWrite, analogWrite, servoWrite, watchDigital/watchAnalog ; état lu : digital(pin), analog(canal).
 */
export function createFirmata(transport, { timeout = 6000 } = {}) {
  const st = { version: null, firmware: null, caps: null, mapping: null, ports: new Uint8Array(16), analog: new Map(), modes: new Map(), last: new Map(), changed: 0 };
  const waiters = [];
  const send = a => transport.write(Uint8Array.from(a));
  const feed = decoder(m => {
    if (m.t === 'version') st.version = m;
    else if (m.t === 'firmware') st.firmware = m;
    else if (m.t === 'caps') st.caps = m.pins;
    else if (m.t === 'mapping') st.mapping = m.ch;
    else if (m.t === 'digital') { st.ports[m.port] = m.bits; st.changed++; }
    else if (m.t === 'analog') { st.analog.set(m.ch, m.v); st.changed++; }
    for (const w of waiters.slice()) if (w.test()) { waiters.splice(waiters.indexOf(w), 1); w.resolve(); }
  });
  transport.onData(feed);
  const until = (test, ms) => new Promise((resolve, reject) => {
    if (test()) return resolve();
    const w = { test, resolve }; waiters.push(w);
    setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error('timeout')); } }, ms);
  });
  /** Envoi seulement si la valeur change : la liaison série à 57 600 bauds reste libre. */
  const once = (key, val, bytes) => { if (st.last.get(key) === val) return; st.last.set(key, val); send(bytes); };
  return {
    state: st,
    async ready() {
      // La carte redémarre à l'ouverture du port (DTR) : StandardFirmata s'annonce après environ 2 s.
      const t0 = Date.now();
      while (!st.firmware && Date.now() - t0 < timeout) {
        send(encode.version()); send(encode.firmware());
        try { await until(() => st.firmware, 700); } catch (e) { /* on redemande */ }
      }
      if (!st.firmware) throw new Error('no-firmata');
      send(encode.capabilities()); send(encode.analogMapping());
      await until(() => st.caps && st.mapping, 3000).catch(() => {});
      send(encode.samplingInterval(50));
      return { name: st.firmware.name, version: `${st.firmware.major}.${st.firmware.minor}`, pins: st.caps ? st.caps.length : 0 };
    },
    /** La broche sait-elle faire ce mode ? (sans réponse de la carte : oui) */
    can: (pin, mode) => !st.caps || !!(st.caps[pin] && st.caps[pin].some(x => x.mode === mode)),
    /** Numéro de broche Firmata d'une entrée analogique (canal) : d'après la réponse de la carte. */
    analogPin: ch => (st.mapping ? st.mapping.indexOf(ch) : -1),
    pinMode(pin, mode) { if (st.modes.get(pin) === mode) return; st.modes.set(pin, mode); st.last.delete('v' + pin); send(encode.pinMode(pin, mode)); },
    digitalWrite(pin, v) { this.pinMode(pin, MODE.OUTPUT); once('v' + pin, v ? 1 : 0, encode.digitalPin(pin, v)); },
    analogWrite(pin, v) { this.pinMode(pin, MODE.PWM); const x = Math.max(0, Math.min(255, Math.round(v))); once('v' + pin, x, encode.analogWrite(pin, x)); },
    servoWrite(pin, deg) { this.pinMode(pin, MODE.SERVO); const x = Math.max(0, Math.min(180, Math.round(deg))); once('v' + pin, x, encode.analogWrite(pin, x)); },
    watchDigital(pin, pullup = false) { this.pinMode(pin, pullup ? MODE.PULLUP : MODE.INPUT); once('rd' + (pin >> 3), 1, encode.reportDigital(pin >> 3, true)); },
    watchAnalog(ch) { const p = this.analogPin(ch); if (p >= 0) this.pinMode(p, MODE.ANALOG); once('ra' + ch, 1, encode.reportAnalog(ch, true)); },
    digital: pin => (st.ports[pin >> 3] >> (pin & 7)) & 1,
    analog: ch => (st.analog.has(ch) ? st.analog.get(ch) : null),
    /** Arrêt : comptes rendus coupés, sorties remises à LOW (la carte reste dans un état sûr). */
    release() {
      for (const ch of st.analog.keys()) send(encode.reportAnalog(ch, false));
      for (let p = 0; p < 16; p++) if (st.last.has('rd' + p)) send(encode.reportDigital(p, false));
      for (const [pin, mode] of st.modes) if (mode === MODE.OUTPUT || mode === MODE.PWM) send(mode === MODE.PWM ? encode.analogWrite(pin, 0) : encode.digitalPin(pin, 0));
    }
  };
}
