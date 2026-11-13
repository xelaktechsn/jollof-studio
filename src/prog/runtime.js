// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Exécution d'un programme compilé (lang.js) sur une carte du montage.
// Le programme tourne en temps virtuel : delay() l'endort jusqu'à l'heure voulue, une
// boucle sans delay() rend la main toutes les quelques millisecondes. Les broches de la
// carte gardent leur état (mode, niveau, PWM, tone, servo…) ; l'application en déduit ce
// que font LED, moteurs et écrans. Les lectures passent par `hw`, qui connaît le câblage.
import { BOARD_CONSTS, AVR_INFO, isEsp32 } from './api.js';
import { createI2c, createSpi } from '../sim/pkgbus.js';
import { pkgI2c, pkgSpi } from '../sim/pkgparts.js';
import { periph, serialDevice, btSerial, macOf, hashBytes, fakeHttp, parseUrl, parseQuery, NET_DEFAULT, FAKE_HOSTS, BADGES, hex2 } from '../sim/models.js';
import { tl } from '../i18n/index.js';

export class RunError extends Error {}
const err = msg => { throw new RunError(msg); };
const SLICE = 6; // ms de calcul par image au plus
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Numéro de broche du code → nom de la broche sur la carte (D7, A0, GP15…). */
export function pinMap(prof, kind) {
  const consts = BOARD_CONSTS[kind] || {}, map = new Map();
  for (const [key, g] of Object.entries(prof.gpio)) {
    const n = typeof g.n === 'number' ? g.n : consts[g.n];
    if (n != null && !map.has(n)) map.set(n, key);
  }
  return map;
}

/** Texte d'un nombre comme l'écrit Serial.print. */
function fmt(x, f, tag) {
  if (x === undefined) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'boolean') x = x ? 1 : 0;
  if (typeof x !== 'number') return String(x);
  if (tag === 'c' && f === undefined) return String.fromCharCode(x & 255);
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  if (tag === 'f' || (tag === '?' && !Number.isInteger(x))) return x.toFixed(f === undefined ? 2 : clamp(f | 0, 0, 20));
  if (f === undefined || f === 10) return String(Math.trunc(x));
  if (f === 16 || f === 8 || f === 2) return (x < 0 ? x >>> 0 : Math.trunc(x)).toString(f).toUpperCase();
  return String(Math.trunc(x));
}
/** printf réduit : %d %i %u %ld %lu %f %.2f %s %c %x %X %o %%. */
function sprintf(f, args) {
  let k = 0;
  return String(f).replace(/%([-+0 #]*)(\d*)(?:\.(\d+))?(l{0,2}|h{0,2})([diufFsScxXoe%])/g, (m, flags, w, p, len, c) => {
    if (c === '%') return '%';
    const a = args[k++];
    let s;
    switch (c) {
      case 'd': case 'i': s = String(Math.trunc(+a || 0)); break;
      case 'u': s = String(Math.trunc(+a || 0) >>> 0); break;
      case 'f': case 'F': s = (+a).toFixed(p == null ? 6 : +p); break;
      case 'e': s = (+a).toExponential(p == null ? 6 : +p); break;
      case 'x': s = (Math.trunc(+a || 0) >>> 0).toString(16); break;
      case 'X': s = (Math.trunc(+a || 0) >>> 0).toString(16).toUpperCase(); break;
      case 'o': s = (Math.trunc(+a || 0) >>> 0).toString(8); break;
      case 'c': s = typeof a === 'number' ? String.fromCharCode(a) : String(a)[0] || ''; break;
      default: s = String(a ?? '');
    }
    if (flags.includes('+') && /[dif]/.test(c) && +a >= 0) s = '+' + s;
    const W = +w || 0;
    if (s.length < W) s = flags.includes('-') ? s.padEnd(W) : s.padStart(W, flags.includes('0') && !/[sc]/.test(c) ? '0' : ' ');
    return s;
  });
}

/** Petite suite pseudo-aléatoire : randomSeed(n) rend les tirages reproductibles. */
function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class Wait { constructor(ms, v) { this.ms = ms; this.v = v; } }
/** Attente jusqu'à ce que fn() rende une valeur non nulle (keypad.waitForKey()). */
class Poll { constructor(fn) { this.fn = fn; } }

/* ---------- Copie octet par octet ---------- */
// Une valeur passée par adresse (&donnee) arrive comme { get, set, d } : d décrit son type C++ (entier : bits et
// signe, float, texte de taille déclarée, tableau). Ses octets sont ceux de la mémoire d'une vraie carte, petit-boutiste :
// un int fait 2 octets sur l'Uno, 4 sur l'ESP32. Envoyer l'un par radio et lire l'autre donne, comme en vrai, une valeur fausse.
const DV = new DataView(new ArrayBuffer(8));
function sizeOfD(d, v) {
  switch (d.k) {
    case 'i': return d.b / 8;
    case 'f': return 4;
    case 'b': return 1;
    case 's': case 'S': return d.n || String(v ?? '').length + 1;
    case 'a': return Array.isArray(v) ? v.reduce((t, x) => t + sizeOfD(d.of, x), 0) : 0;
    default: return 0;
  }
}
function encode(d, v, out) {
  switch (d.k) {
    case 'i': {
      if (d.b === 64) { let x = BigInt.asUintN(64, BigInt(Math.trunc(+v || 0))); for (let i = 0; i < 8; i++) { out.push(Number(x & 255n)); x >>= 8n; } return; }
      const x = Math.trunc(+v || 0); for (let i = 0; i < d.b / 8; i++) out.push((x >>> (8 * i)) & 255);
      return;
    }
    case 'f': DV.setFloat32(0, +v || 0, true); for (let i = 0; i < 4; i++) out.push(DV.getUint8(i)); return;
    case 'b': out.push(v ? 1 : 0); return;
    case 's': case 'S': { const t = String(v ?? ''), n = sizeOfD(d, t); for (let i = 0; i < n; i++) out.push(i < t.length ? t.charCodeAt(i) & 255 : 0); return; }
    case 'a': if (Array.isArray(v)) for (const x of v) encode(d.of, x, out);
  }
}
function decode(d, b, p, cur) {
  switch (d.k) {
    case 'i': {
      const n = d.b / 8, at = p.i; p.i += n;
      if (d.b === 64) { let x = 0n; for (let i = 7; i >= 0; i--) x = (x << 8n) | BigInt(b[at + i] || 0); return Number(d.u ? x : BigInt.asIntN(64, x)); }
      let x = 0; for (let i = n - 1; i >= 0; i--) x = x * 256 + (b[at + i] || 0);
      return !d.u && x >= 2 ** (d.b - 1) ? x - 2 ** d.b : x;
    }
    case 'f': for (let i = 0; i < 4; i++) DV.setUint8(i, b[p.i + i] || 0); p.i += 4; return DV.getFloat32(0, true);
    case 'b': return !!b[p.i++];
    case 's': case 'S': { const n = sizeOfD(d, cur); let t = ''; for (let i = 0; i < n; i++) { const c = b[p.i + i] || 0; if (!c) break; t += String.fromCharCode(c); } p.i += n; return t; }
    case 'a': if (Array.isArray(cur)) for (let i = 0; i < cur.length; i++) { const v = decode(d.of, b, p, cur[i]); if (d.of.k !== 'a') cur[i] = v; } return cur;
  }
  return cur;
}
const isRef = r => !!(r && r.ref);
/** Octets d'une valeur passée par adresse ; len : nombre d'octets lus (au-delà de la variable : des zéros). */
function refBytes(r, len) {
  const out = [];
  if (isRef(r)) encode(r.d, r.get(), out); else if (typeof r === 'string') encode({ k: 's', n: 0 }, r, out); else if (typeof r === 'number') encode({ k: 'i', b: 32 }, r, out);
  if (len == null) return out;
  const n = Math.max(0, len | 0);
  return n <= out.length ? out.slice(0, n) : out.concat(new Array(n - out.length).fill(0));
}
/** Copie des octets dans une valeur passée par adresse, comme memcpy : seuls les len premiers octets changent. */
function refStore(r, bytes, len) {
  if (!isRef(r)) return false;
  const cur = r.get(), buf = []; encode(r.d, cur, buf);
  const n = Math.min(len == null ? bytes.length : len, buf.length, bytes.length);
  for (let i = 0; i < n; i++) buf[i] = bytes[i];
  const v = decode(r.d, buf, { i: 0 }, cur);
  if (r.d.k === 'a') return true;
  if (!r.set) return false;
  r.set(v); return true;
}
const refSize = r => (isRef(r) ? sizeOfD(r.d, r.get()) : 0);
/** Écrit un nombre dans une variable passée par adresse (getTextBounds(…, &x1, &y1, &l, &h)). */
const refSet = (r, v) => { if (isRef(r) && r.set) r.set(v); };

/** CRC 8 bits du bus 1-Wire (adresse des sondes DS18B20). */
function crc8(a, n = 7) {
  let crc = 0;
  for (let i = 0; i < n; i++) { let b = a[i] & 255; for (let j = 0; j < 8; j++) { const mix = (crc ^ b) & 1; crc >>= 1; if (mix) crc ^= 0x8c; b >>= 1; } }
  return crc;
}
/** Adresse 1-Wire d'une sonde : famille 0x28 (DS18B20), numéro de série tiré de son identifiant, CRC. */
function dsAddr(c) {
  let h = 2166136261 >>> 0;
  for (const ch of String(c.id || c.name || 'ds')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const a = [0x28];
  for (let i = 0; i < 6; i++) { a.push(h & 255); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; }
  a.push(crc8(a, 7));
  return a;
}
/** Adresse d'un tube radio nRF24 (5 octets, poids faible d'abord) : texte "00001", nombre 0xF0F0F0F0E1LL ou tableau. */
function pipeKey(a) {
  const b = [];
  if (typeof a === 'string') for (let i = 0; i < 5; i++) b.push(i < a.length ? a.charCodeAt(i) & 255 : 0);
  else if (Array.isArray(a)) for (let i = 0; i < 5; i++) b.push((a[i] | 0) & 255);
  else { let x = BigInt.asUintN(64, BigInt(Math.trunc(+a || 0))); for (let i = 0; i < 5; i++) { b.push(Number(x & 255n)); x >>= 8n; } }
  return b.map(hex2).join('');
}
const PICC_NAMES = { 0: 'Unknown type', 1: 'PICC compliant with ISO/IEC 14443-4', 2: 'PICC compliant with ISO/IEC 18092 (NFC)', 3: 'MIFARE Mini, 320 bytes', 4: 'MIFARE 1KB', 5: 'MIFARE 4KB', 6: 'MIFARE Ultralight or Ultralight C', 7: 'MIFARE Plus', 8: 'MIFARE DESFire', 9: 'MIFARE TNP3XXX', 255: 'SAK indicates UID is not complete.' };
const STATUS_NAMES = { 0: 'Success.', 1: 'Error in communication.', 2: 'Collission detected.', 3: 'Timeout in communication.', 4: 'A buffer is not big enough.', 5: 'Internal error in the code. Should not happen.', 6: 'Invalid argument.', 7: 'The CRC_A does not match.', 255: 'A MIFARE PICC responded with NAK.' };
/** Mémoire des badges RFID (MIFARE Classic 1K : 64 blocs de 16 octets), partagée par tous les lecteurs. */
const BADGE_MEM = new Map();
function badgeMem(i) {
  if (!BADGE_MEM.has(i)) {
    const u = BADGES[i].uid, m = Array.from({ length: 64 }, () => new Array(16).fill(0));
    m[0] = [...u, u.reduce((a, b) => a ^ b, 0), 0x08, 0x04, 0x00, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69];
    for (let s = 3; s < 64; s += 4) m[s] = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x07, 0x80, 0x69, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
    BADGE_MEM.set(i, m);
  }
  return BADGE_MEM.get(i);
}

/**
 * Texte d'une valeur pour la fenêtre des variables du débogueur, selon son type C++ :
 * char 65 'A', float 1.5, bool true, String entre guillemets (coupée à 60 caractères),
 * tableau (16 premières cases et longueur), objet <Servo>.
 */
export function showValue(x, type = 'auto') {
  if (x === undefined) return '—';
  if (x === null) return 'null';
  if (Array.isArray(x)) {
    const el = /\[\]$/.test(type) ? type.slice(0, -2) : 'auto';
    const items = x.slice(0, 16).map(v => showValue(v, el)), s = `(${x.length}) {${items.join(', ')}${x.length > 16 ? ', …' : ''}}`;
    return s.length > 300 ? s.slice(0, 299) + '…}' : s;
  }
  if (typeof x === 'string') { const cut = x.length > 60, j = JSON.stringify(cut ? x.slice(0, 60) : x); return cut ? j.slice(0, -1) + '…"' : j; }
  if (typeof x === 'boolean' || type === 'bool') return x ? 'true' : 'false';
  if (typeof x === 'number') {
    if (Number.isNaN(x)) return 'nan';
    if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
    if (type === 'char') {
      const c = x & 255, e = { 0: '\\0', 9: '\\t', 10: '\\n', 13: '\\r', 39: "\\'", 92: '\\\\' }[c];
      return e ? `${x} '${e}'` : c >= 32 && c < 127 ? `${x} '${String.fromCharCode(c)}'` : String(x);
    }
    if (type === 'float' || !Number.isInteger(x)) return Number.isInteger(x) && Math.abs(x) < 1e15 ? x.toFixed(1) : String(+x.toPrecision(7));
    return String(x);
  }
  if (typeof x === 'object') return `<${type !== 'auto' && !/\[\]$/.test(type) ? type : (x.constructor && x.constructor.name) || 'objet'}>`;
  return String(x);
}

/**
 * Crée l'exécution d'un programme compilé.
 * hw : { kind, label, prof, read(key), echo(key), onPin(key, types), bus(types), data(comp) }, et si le montage les
 * fournit : at(key) (composants et broches reliés : [{ comp, pin }]), status(comp) ({ ok, msg } : câblé et alimenté),
 * peers(types) (modules de tout le montage : [{ comp, ok }]), i2c() (modules du bus I2C : [{ comp, addr }]),
 * trig(key) (broche de la carte reliée au TRIG du HC-SR04 dont ECHO est sur key).
 * meta : description du programme pour le débogueur, { hooks, globals } (résultat de compile :
 * res.debug, ou { globals: res.globals } sans le mode débogage).
 */
export function createRuntime(js, hw, meta = {}) {
  const prof = hw.prof, keys = pinMap(prof, hw.kind), consts = BOARD_CONSTS[hw.kind] || {}, avr = AVR_INFO[hw.kind];
  const pins = new Map(), warnings = new Map(), irqs = [], ledc = new Map();
  let out = '', serialIn = '', T = 0, vt = 0, wake = null, state = 'run', error = null, irqOn = true, started = false;
  // analogRead() rend prof.adcRead bits par défaut : 10 sur le Pico (cœur arduino-pico), dont l'ADC fait 12 bits
  // (analogReadResolution(12)) ; sinon la résolution de l'ADC.
  let adcBits = prof.adcRead || (hw.kind === 'pico' ? 10 : prof.adcBits), pwmBits = 8, rnd = Math.random;
  // Oscilloscope : chaque changement d'une sortie est signalé avec son heure virtuelle exacte,
  // pour ne perdre aucun front même quand le programme bascule plus vite que l'affichage.
  let trace = null, tap = null;
  // freq : tone() ; ledc : fréquence de la PWM de l'ESP32 (pour l'oscilloscope, pas un son).
  const traced = (k, p) => { if (trace) trace(k, { d: p.d, pwm: p.pwm, freq: p.freq || (p.pwm != null ? p.ledc : 0) || 0 }, vt); };
  // d : profondeur d'appel, n : nombre d'appels, irq : interruption en cours, D : arrêt du débogueur (ou null).
  const $ = { l: 0, b: 2000, O: {}, C: {}, d: 0, n: 0, irq: 0, D: null };

  const warn = (msg, line = $.l) => { const w = warnings.get(msg); if (w) w.n++; else warnings.set(msg, { line, n: 1, msg }); };
  const pinState = k => { let p = pins.get(k); if (!p) pins.set(k, (p = { mode: 0, d: 0, pwm: null, freq: 0, ledc: 0, toneEnd: 0, servo: null, px: null, stepper: null, weak: false, dac: null })); return p; };
  const stat = c => (hw.status ? hw.status(c) : { ok: true, msg: '' });
  const at = k => (k && hw.at ? hw.at(k) : []);
  const keyOf = (n, what) => {
    const num = Math.trunc(+n);
    // Sur un AVR, analogRead(0) lit A0 : les petits numéros désignent les entrées analogiques.
    let k = avr && what === 'adc' && num >= 0 && num < avr.an ? keys.get(num + avr.a0) : keys.get(num);
    if (!k && num === consts.LED_BUILTIN) return 'LED_BUILTIN';
    if (!k) { warn(tl('La broche {0} n’existe pas sur {1}', n, hw.label)); return null; }
    return k;
  };
  const caps = k => (prof.gpio[k] ? prof.gpio[k].caps : new Set(['in', 'out', 'pu', 'pwm']));
  /** Niveau d'une entrée : câblage, puis capteur, puis tirage interne ; sinon elle flotte. */
  const input = k => {
    const p = pinState(k);
    if (p.mode === 1) return { d: p.d, v: p.d ? prof.logic : 0 };
    const r = hw.read(k);
    if (r) return r;
    if (p.mode === 2 && caps(k).has('pu')) return { d: 1, v: prof.logic };
    if (p.mode === 3) return { d: 0, v: 0 };
    return null;
  };
  const digitalIn = k => {
    const r = input(k);
    if (r && r.hz > 0) return Math.floor(vt * r.hz / 500) % 2; // signal carré d'un module à impulsions
    if (r) return r.d != null ? r.d : +(r.v > prof.logic / 2);
    if (k !== 'LED_BUILTIN') warn(tl('{0} n’est reliée à rien et n’a pas de tirage : son niveau flotte (lecture au hasard). Utilisez pinMode(…, INPUT_PULLUP) ou une résistance de tirage', k));
    return rnd() < 0.5 ? 0 : 1;
  };

  /* ---------- Fonctions du cœur Arduino ---------- */
  Object.assign($, {
    pinMode(n, m) {
      const k = keyOf(n); if (!k) return;
      const c = caps(k), p = pinState(k);
      if (m === 1 && !c.has('out')) warn(tl('{0} est une entrée seulement : elle ne peut pas être une sortie', k));
      if (m === 2 && !c.has('pu')) warn(tl('{0} n’a pas de résistance de tirage interne : INPUT_PULLUP n’y a aucun effet', k));
      if (c.has('flash')) warn(tl('{0} est reliée à la mémoire flash : l’utiliser plante la carte', k));
      p.mode = m; p.weak = false;
    },
    digitalWrite(n, v) {
      const k = keyOf(n); if (!k) return;
      const p = pinState(k), hi = v ? 1 : 0, wasPwm = p.pwm != null;
      p.pwm = null;
      if (p.mode !== 1) {
        // Sur un AVR, écrire HIGH sur une entrée active seulement la résistance de tirage : une LED luit à peine.
        // Écrire HIGH avant pinMode(OUTPUT) est un usage normal (niveau de départ) : on ne prévient
        // que si la broche reste une entrée (voir run()).
        p.weak = !!hi; p.d = hi; if (hi) { p.weakAt = vt; p.weakLine = $.l; p.weakN = n; } return;
      }
      if (!caps(k).has('out')) return;
      // Impulsions (TRIG d'un HC-SR04) : début du niveau haut, puis fin et durée de l'impulsion.
      if (hi && !p.d) p.riseAt = vt; else if (!hi && p.d && p.riseAt != null) p.pulse = { end: vt, w: vt - p.riseAt, used: false };
      p.dac = null;
      if (p.d !== hi || wasPwm) { p.d = hi; p.weak = false; traced(k, p); } else p.weak = false;
      spiChip(k, hi);
    },
    digitalRead(n) { const k = keyOf(n); return k ? digitalIn(k) : 0; },
    analogRead(n) {
      const k = keyOf(n, 'adc'); if (!k) return 0;
      if (!caps(k).has('adc')) { warn(tl('{0} n’est pas une entrée analogique : analogRead() n’y lit rien d’utile', k)); return 0; }
      const max = 2 ** adcBits - 1, r = input(k);
      if (!r) { warn(tl('{0} n’est reliée à rien : analogRead() lit du bruit', k)); return Math.round(max * (0.3 + rnd() * 0.4)); }
      const v = r.v != null ? r.v : r.d ? prof.logic : 0;
      return clamp(Math.round(v / prof.vref * max), 0, max);
    },
    analogWrite(n, v) {
      const k = keyOf(n); if (!k) return;
      const p = pinState(k), max = 2 ** pwmBits - 1;
      p.mode = 1; p.weak = false;
      if (!caps(k).has('pwm')) { warn(tl('{0} n’a pas de PWM : analogWrite() y donne seulement LOW (sous la moitié) ou HIGH', k)); p.pwm = null; p.d = v >= max / 2 ? 1 : 0; return; }
      p.dac = null; p.pwm = clamp(+v || 0, 0, max) / max; p.d = p.pwm > 0 ? 1 : 0; traced(k, p);
    },
    analogReadResolution(b) { adcBits = clamp(b | 0, 1, 16); },
    analogWriteResolution(b) { pwmBits = clamp(b | 0, 1, 16); },
    analogSetAttenuation() {}, analogReference() {},
    millis: () => Math.floor(vt) >>> 0,
    micros: () => Math.floor(vt * 1000) >>> 0,
    ms(x) { x = +x; if (!(x >= 0)) { if (x < 0) warn(tl('delay() reçoit une durée négative : sur la carte, elle deviendrait énorme')); return 0; } return x; },
    tone(n, f, d) {
      const k = keyOf(n); if (!k) return;
      const p = pinState(k); p.mode = 1; p.freq = Math.max(0, +f || 0); p.toneEnd = d ? vt + +d : 0; traced(k, p);
    },
    noTone(n) { const k = keyOf(n); if (k) { const p = pinState(k); p.freq = 0; traced(k, p); } },
    pulseIn(n, level, timeout = 1000000) {
      const k = keyOf(n); if (!k) return 0;
      timeout = Math.max(0, +timeout || 0);
      // Module à impulsions (débitmètre…) : signal carré, chaque niveau dure une demi-période.
      const sq = input(k);
      if (sq && sq.hz > 0) { const half = 500000 / sq.hz; return half > timeout ? new Wait(timeout / 1000, 0) : new Wait(half * 2 / 1000, Math.round(half)); }
      const us = level ? hw.echo(k) : null, none = () => new Wait(timeout / 1000, 0);
      // HC-SR04 : il n'envoie d'écho qu'après une impulsion HIGH d'au moins 10 µs sur TRIG ; l'écho commence
      // environ 0,25 ms après la fin de l'impulsion (salve de 8 ultrasons) : pulseIn() doit être appelé avant.
      const tk = us && hw.trig ? hw.trig(k) : undefined;
      if (us && tk !== undefined) {
        const p = tk && pins.get(tk), pu = p && p.pulse;
        if (!tk) { warn(tl('pulseIn({0}) : le TRIG du HC-SR04 n’est relié à aucune broche de {1}, le module n’envoie jamais d’écho', n, hw.label)); return none(); }
        if (!pu || pu.used) { warn(tl('pulseIn({0}) : aucune impulsion sur TRIG ({1}) avant la mesure. Le HC-SR04 n’envoie un écho qu’après digitalWrite(TRIG, HIGH), delayMicroseconds(10), digitalWrite(TRIG, LOW)', n, tk)); return none(); }
        pu.used = true;
        if (pu.w < 0.0095) { warn(tl('pulseIn({0}) : l’impulsion sur TRIG dure {1} µs, il en faut au moins 10 : le HC-SR04 ne réagit pas', n, Math.round(pu.w * 1000))); return none(); }
        if (vt - pu.end > 0.25 + 1e-6) { warn(tl('pulseIn({0}) appelé trop tard après l’impulsion sur TRIG : l’écho a déjà commencé, la mesure échoue', n)); return none(); }
      }
      if (us) return us > timeout ? none() : new Wait(us / 1000, Math.round(us));
      if (level) warn(tl('pulseIn({0}) n’a reçu aucune impulsion : la fonction attend {1} ms puis renvoie 0', n, Math.round(timeout / 1000)));
      return none();
    },
    map(x, a, b, c, d) {
      if (b === a) { warn(tl('map() : les deux bornes de départ sont égales (division par zéro)')); return c; }
      return Math.trunc((x - a) * (d - c) / (b - a)) + c;
    },
    constrain: (x, a, b) => (x < a ? a : x > b ? b : x),
    min: (a, b) => (b < a ? b : a), max: (a, b) => (b > a ? b : a), abs: x => (x < 0 ? -x : x), sq: x => x * x,
    sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, exp: Math.exp,
    log: Math.log, log10: Math.log10, fabs: Math.abs, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc, pow: Math.pow, atan2: Math.atan2,
    fmod: (a, b) => a % b, hypot: Math.hypot,
    round: x => Math.sign(x) * Math.round(Math.abs(x)), isnan: x => Number.isNaN(x), isinf: x => Math.abs(x) === Infinity,
    random(a, b) { if (b === undefined) { b = a; a = 0; } return b <= a ? a : Math.floor(rnd() * (b - a)) + a; },
    randomSeed(s) { rnd = prng(+s || 0); },
    bit: n => 2 ** n, bitRead: (x, n) => Math.floor(x / 2 ** n) & 1, highByte: x => (x >> 8) & 255, lowByte: x => x & 255,
    bitWrite: (x, n, b) => (b ? x | (1 << n) : x & ~(1 << n)), bitSet: (x, n) => x | (1 << n), bitClear: (x, n) => x & ~(1 << n),
    digitalPinToInterrupt(p) { return avr ? avr.irq.indexOf(Math.trunc(+p)) : p; },
    attachInterrupt(num, fn, mode) {
      if (num < 0) { warn(tl('Cette broche n’a pas d’interruption sur {0}{1}', hw.label, avr ? tl(' : seulement {0}', avr.irq.map(n => 'D' + n).join(', ')) : '')); return; }
      const n = avr ? (avr.irq[num] ?? -1) : num;
      const k = n >= 0 && keyOf(n); if (!k) return;
      const i = irqs.findIndex(q => q.k === k); if (i >= 0) irqs.splice(i, 1);
      irqs.push({ k, fn, mode, last: digitalIn(k), t: vt, acc: 0 });
    },
    detachInterrupt(num) { const n = avr ? (avr.irq[num] ?? -1) : num, k = keys.get(n); const i = irqs.findIndex(q => q.k === k); if (i >= 0) irqs.splice(i, 1); },
    interrupts() { irqOn = true; }, noInterrupts() { irqOn = false; },
    isDigit: c => c >= 48 && c <= 57, isAlpha: c => /[A-Za-z]/.test(String.fromCharCode(c)), isAlphaNumeric: c => /[A-Za-z0-9]/.test(String.fromCharCode(c)),
    isSpace: c => /\s/.test(String.fromCharCode(c)), isUpperCase: c => c >= 65 && c <= 90, isLowerCase: c => c >= 97 && c <= 122,
    isPunct: c => /[!-\/:-@\[-`{-~]/.test(String.fromCharCode(c)),
    // PWM de l'ESP32 (ledc) : ancienne API par canal et nouvelle API par broche.
    ledcSetup(ch, freq, res) { ledc.set('c' + ch, { res: res | 0 || 8, freq, pins: (ledc.get('c' + ch) || { pins: [] }).pins }); return freq; },
    ledcAttachPin(n, ch) { const c = ledc.get('c' + ch) || { res: 8, pins: [] }; c.pins.push(n); ledc.set('c' + ch, c); $.pinMode(n, 1); },
    ledcAttach(n, freq, res = 8) { ledc.set('p' + n, { res, freq, pins: [n] }); $.pinMode(n, 1); return true; },
    ledcDetachPin(n) { for (const c of ledc.values()) c.pins = c.pins.filter(x => x !== n); },
    ledcWrite(id, duty) {
      const c = ledc.get('p' + id) || ledc.get('c' + id);
      if (!c) { warn(tl('ledcWrite({0}) : canal ou broche non attachés (ledcAttach / ledcAttachPin)', id)); return; }
      for (const n of c.pins) { const k = keyOf(n); if (!k) continue; const p = pinState(k); p.pwm = clamp(duty / (2 ** c.res - 1), 0, 1); p.d = p.pwm > 0 ? 1 : 0; p.ledc = c.freq || p.ledc; traced(k, p); }
    },
    ledcWriteTone(id, f) { const c = ledc.get('p' + id) || ledc.get('c' + id); if (c) c.pins.forEach(n => $.tone(n, f)); },
    // ESP32 : DAC 8 bits sur GPIO 25 et 26 (0 → 0 V, 255 → 3,3 V).
    dacWrite(n, v) {
      if (hw.kind !== 'esp32') { warn(tl('dacWrite() n’existe que sur l’ESP32 (broches 25 et 26)')); return; }
      if (n !== 25 && n !== 26) { warn(tl('dacWrite({0}) : seules les broches 25 et 26 ont un convertisseur numérique-analogique', n)); return; }
      const k = keyOf(n); if (!k) return;
      const p = pinState(k), x = clamp(Math.round(+v || 0), 0, 255);
      p.mode = 1; p.weak = false; p.dac = x / 255 * prof.logic; p.pwm = x / 255; p.d = x > 0 ? 1 : 0; traced(k, p);
    },
    // ESP32 : entrée tactile, environ 60 au repos, beaucoup moins quand un doigt (ou la masse) touche la broche.
    // ESP32-S3 : T1 à T14 (GPIO 1 à 14), la valeur augmente au contact (de l'ordre de 20 000 au repos). ESP32-C3 : aucune.
    touchRead(n) {
      if (hw.kind === 'esp32c3') { warn(tl('touchRead() : l’ESP32-C3 n’a pas d’entrée tactile')); return 0; }
      const s3 = hw.kind === 'esp32s3', T = s3 ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] : [4, 0, 2, 15, 13, 12, 14, 27, 33, 32];
      if (!isEsp32(hw.kind) || !T.includes(n)) { warn(s3 ? tl('touchRead({0}) : cette broche n’est pas une entrée tactile (ESP32-S3 : GPIO 1 à 14)', n) : tl('touchRead({0}) : cette broche n’est pas une entrée tactile (ESP32 : T0 à T9)', n)); return 0; }
      const k = keyOf(n), r = k && hw.read(k), touched = r && r.d === 0 && r.v === 0;
      if (s3) return touched ? 60000 + Math.round(rnd() * 2000) : 20000 + Math.round(rnd() * 600);
      return touched ? 8 + Math.round(rnd() * 4) : 58 + Math.round(rnd() * 4);
    },
    analogReadMilliVolts(n) {
      const k = keyOf(n, 'adc'); if (!k) return 0;
      if (!caps(k).has('adc')) { warn(tl('{0} n’est pas une entrée analogique : analogRead() n’y lit rien d’utile', k)); return 0; }
      const r = input(k);
      if (!r) { warn(tl('{0} n’est reliée à rien : analogRead() lit du bruit', k)); return Math.round(prof.vref * 1000 * (0.3 + rnd() * 0.4)); }
      return clamp(Math.round((r.v != null ? r.v : r.d ? prof.logic : 0) * 1000), 0, Math.round(prof.vref * 1000));
    },
    makeKeymap: x => x,
    printActiveIRProtocols(port) { (port && port.println ? port : $.O.Serial).println('NEC'); },
    /** Valeur passée par adresse à une bibliothèque : lue (get) ou remplie (set), d : type C++. */
    ref: (get, set, d) => ({ ref: true, get, set, d }),
    /* ---------- Aides du code généré ---------- */
    div(a, b) { if (b === 0) err(tl('Division entière par zéro')); return Math.trunc(a / b); },
    mod(a, b) { if (b === 0) err(tl('Modulo (%) par zéro')); return a % b; },
    i64: x => Math.trunc(+x) || 0,
    post: a => a,
    ck(a, i) { if (!(i >= 0 && i < a.length)) err(tl('Indice {0} hors du tableau (cases 0 à {1})', Number.isFinite(i) ? Math.trunc(i) : i, a.length - 1)); return i | 0; },
    arr(dims, fill) { const mk = d => Array.from({ length: Math.max(0, dims[d] | 0) }, () => (d + 1 < dims.length ? mk(d + 1) : fill)); return mk(0); },
    pad(list, n, mk) { if (list.length > n) err(tl('Trop de valeurs pour un tableau de {0} cases', n)); while (list.length < n) list.push(mk()); return list; },
    sizeof(a, s) { const count = x => (Array.isArray(x) ? x.reduce((t, y) => t + count(y), 0) : 1); return count(a) * s; },
    fstr: x => fmt(x, undefined, 'f'), astr: x => fmt(x, undefined, '?'),
    String(x, f, tag) { if (f !== undefined && tag !== 'f' && typeof x === 'number') return (x < 0 ? x >>> 0 : Math.trunc(x)).toString(f); return fmt(x, f, tag); },
    charAt: (s, i) => s.charCodeAt(i) || 0, substring: (s, a, b) => s.substring(a, b),
    indexOf: (s, x, f) => s.indexOf(x, f), lastIndexOf: (s, x, f) => (f === undefined ? s.lastIndexOf(x) : s.lastIndexOf(x, f)),
    toInt: s => parseInt(s, 10) || 0, toFloat: s => parseFloat(s) || 0, compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    trim: s => s.trim(), replace: (s, a, b) => s.split(a).join(b), remove: (s, i, n) => s.slice(0, i) + (n === undefined ? '' : s.slice(i + n)),
    setCharAt: (s, i, c) => (i >= 0 && i < s.length ? s.slice(0, i) + String.fromCharCode(c) + s.slice(i + 1) : s),
    event: () => ({ acceleration: { x: 0, y: 0, z: 0 }, gyro: { x: 0, y: 0, z: 0 }, temperature: 0 }),
    *wait(r) {
      if (r instanceof Wait) { if (r.ms > 0) yield r.ms; return r.v; }
      // Méthode qui exécute une fonction du programme (gestionnaire d'un serveur web) : elle s'exécute ici, delay() compris.
      if (r && typeof r === 'object' && typeof r.next === 'function' && typeof r[Symbol.iterator] === 'function') return yield* r;
      if (r instanceof Poll) for (;;) { const v = r.fn(); if (v) return v; yield 10; }
      return r;
    }
  });

  /* ---------- Ports série ---------- */
  // Serial : le moniteur série (USB). Sur l'Uno, le Nano, l'ESP32 et le NodeMCU, il partage les broches RX0/TX0, où un
  // module peut aussi être câblé. Serial1, Serial2 (ESP32, Pico) et SoftwareSerial n'ont que leurs broches. Un module
  // série (HC-05, SIM800) y est relié par ses fils : TXD vers la broche RX de la carte, RXD vers sa broche TX.
  // ESP32-S3 : Serial passe par la puce USB-série (UART0, GPIO 44/43). ESP32-C3 SuperMini : Serial est l'USB natif
  // (CDC), il ne touche aucune broche. Ports Serial1/Serial2 par défaut du cœur arduino-esp32 (HardwareSerial.h).
  const SERIAL0 = { uno: [0, 1], nano: [0, 1], mega: [0, 1], esp32: [3, 1], esp32s3: [44, 43], nodemcu: [3, 1] };
  const UARTS = { esp32: { Serial1: [9, 10], Serial2: [16, 17] }, esp32s3: { Serial1: [15, 16], Serial2: [19, 20] }, esp32c3: { Serial1: [18, 19] }, pico: { Serial1: [1, 0], Serial2: [9, 8] }, nodemcu: { Serial1: [null, 2] }, mega: { Serial1: [19, 18], Serial2: [17, 16], Serial3: [15, 14] } };
  const LINKED = ['hc05', 'sim800'];
  class HardwareSerial {
    constructor(name) { this.name = name; this.label = name || 'Serial'; this.main = name === 'Serial'; this.baud = 0; this.rx = ''; this.link = null; }
    /** begin(bauds) ; sur l'ESP32 : begin(bauds, SERIAL_8N1, broche RX, broche TX). */
    begin(b, cfg, rx, tx) {
      this.baud = +b || 0;
      let p = this.main ? SERIAL0[hw.kind] : (UARTS[hw.kind] || {})[this.name];
      if (!this.main && isEsp32(hw.kind) && rx >= 0 && tx >= 0) p = [rx, tx];
      if (!this.main && !p) warn(tl('{0} n’existe pas sur {1} : utilisez SoftwareSerial', this.name, hw.label));
      this.connect(p && p.map(n => (n == null ? null : keys.get(n) || null)));
    }
    end() { this.baud = 0; }
    /** Module série relié aux broches [RX, TX] de la carte (clés de broches). */
    connect(p) {
      this.link = null;
      if (!p) return;
      const onRx = at(p[0]).filter(x => LINKED.includes(x.comp.type)), onTx = at(p[1]).filter(x => LINKED.includes(x.comp.type));
      const c = (onRx[0] || onTx[0] || {}).comp; if (!c) return;
      const hear = onRx.some(x => x.comp === c && x.pin === 'TXD'), talk = onTx.some(x => x.comp === c && x.pin === 'RXD');
      if (!hear && !talk) { warn(tl('{0} : TXD et RXD de {1} sont inversés. Les liaisons série se croisent : TXD du module va sur la broche RX de la carte, RXD sur sa broche TX', this.label, c.name)); return; }
      if (!hear) warn(tl('{0} : TXD de {1} n’est pas relié à la broche RX de la carte, la carte ne recevra rien du module', this.label, c.name));
      if (!talk) warn(tl('{0} : RXD de {1} n’est pas relié à la broche TX de la carte, le module ne recevra rien', this.label, c.name));
      const dev = serialDevice(c);
      // HC-05 : EN (KEY) au niveau haut quand la liaison s'ouvre (mise sous tension avec la carte) → mode commandes AT, 38400 bauds.
      if (dev.power) dev.power(hw.level ? hw.level(c, 'EN') === 1 : false);
      if (dev.baud && this.baud && this.baud !== dev.baud) warn(tl('{0} : {1} communique à {2} bauds, mais la liaison est réglée à {3} bauds. Les caractères arrivent déformés', this.label, c.name, dev.baud, this.baud));
      this.link = { c, hear, talk, dev };
    }
    /** Le module relié, s'il est bien câblé et alimenté. */
    alive() {
      const L = this.link; if (!L) return null;
      const s = stat(L.c);
      if (!s.ok) { warn(tl('{0} ne répond pas : {1}', L.c.name, s.msg || tl('câblage incomplet'))); return null; }
      return L;
    }
    get buf() { return this.main ? serialIn : this.rx; }
    set buf(v) { if (this.main) serialIn = v; else this.rx = v; }
    /** Ce que le module a envoyé arrive dans le tampon de réception. */
    pull() {
      const L = this.link && this.link.hear ? this.alive() : null; if (!L) return this.buf;
      const s = L.dev.drain(this.baud, vt); if (s) { let b = this.buf + s; if (b.length > 4096) b = b.slice(-4096); this.buf = b; }
      return this.buf;
    }
    emit(s, ln) {
      if (!this.baud) {
        if (this.main) warn(tl('Serial.begin() n’a pas été appelé : rien ne s’affiche sur le moniteur série'));
        else warn(tl('{0}.begin() n’a pas été appelé : rien n’est envoyé', this.label));
        return;
      }
      if (this.main) {
        out += s;
        if (out.length > 200000) out = out.slice(-100000);
        if (tap) tap(s, vt); // traceur série : texte et heure virtuelle exacte
      }
      const L = this.link && this.link.talk ? this.alive() : null;
      if (L) L.dev.write(ln ? s.slice(0, -1) + '\r\n' : s, this.baud, vt); // println envoie \r\n
      else if (!this.main && !this.link) warn(tl('{0} : aucun module série (HC-05, SIM800…) n’est relié à ses broches', this.label));
    }
    print(x, f, tag) { const s = fmt(x, f, tag); this.emit(s); return s.length; }
    println(x, f, tag) { const s = fmt(x, f, tag) + '\n'; this.emit(s, true); return s.length + 1; }
    printf(f, ...a) { const s = sprintf(f, a); this.emit(s); return s.length; }
    write(x, n) {
      const s = typeof x === 'number' ? String.fromCharCode(x & 255) : Array.isArray(x) ? x.slice(0, n ?? x.length).map(c => String.fromCharCode(c & 255)).join('') : String(x);
      this.emit(s); return s.length;
    }
    available() { return this.pull().length; }
    availableForWrite() { return 63; }
    read() { const b = this.pull(); if (!b) return -1; this.buf = b.slice(1); return b.charCodeAt(0); }
    peek() { const b = this.pull(); return b ? b.charCodeAt(0) : -1; }
    readString() { const b = this.pull(); this.buf = ''; return b; }
    readStringUntil(c) { const b = this.pull(), ch = typeof c === 'number' ? String.fromCharCode(c) : String(c), i = b.indexOf(ch); this.buf = i < 0 ? '' : b.slice(i + 1); return i < 0 ? b : b.slice(0, i); }
    parseInt() { const b = this.pull(), m = /-?\d+/.exec(b); if (!m) return 0; this.buf = b.slice(m.index + m[0].length); return parseInt(m[0], 10); }
    parseFloat() { const b = this.pull(), m = /-?\d+(\.\d+)?/.exec(b); if (!m) return 0; this.buf = b.slice(m.index + m[0].length); return parseFloat(m[0]); }
    flush() {} setTimeout() {}
  }
  class SoftwareSerial extends HardwareSerial {
    constructor(rx, tx) { super(''); this.pins = [rx, tx]; this.label = `SoftwareSerial(${rx}, ${tx})`; }
    begin(b) { this.baud = +b || 0; this.connect(this.pins.map(n => (n == null ? null : keyOf(n)))); }
    listen() { return true; } isListening() { return true; }
  }
  $.O.Serial = new HardwareSerial('Serial');
  $.O.Serial1 = new HardwareSerial('Serial1'); $.O.Serial2 = new HardwareSerial('Serial2'); $.O.Serial3 = new HardwareSerial('Serial3');
  // Bus I2C : endTransmission() rend 0 si un module répond à l'adresse, 2 (NACK) sinon : un scanner I2C ne liste que les modules câblés.
  // Un module en paquet (.jpart) répond par ses registres et ses commandes déclarés (sim/pkgbus.js) ; les modules
  // de la bibliothèque passent par leurs bibliothèques simulées (LiquidCrystal_I2C…) et rendent 0 en lecture directe.
  const i2cAt = a => (hw.i2c ? hw.i2c() : []).some(d => d.addr.includes(a));
  const busDevs = new Map();
  const i2cDev = a => {
    const hit = (hw.i2c ? hw.i2c() : []).find(d => d.addr.includes(a)), spec = hit && pkgI2c(hit.comp.type);
    if (!spec) return null;
    if (!busDevs.has(hit.comp.id)) busDevs.set(hit.comp.id, createI2c(spec, () => hw.data(hit.comp)));
    return busDevs.get(hit.comp.id);
  };
  $.O.Wire = {
    addr: -1, tx: [], rx: [],
    begin() {}, setClock() {}, setPins() { return true; },
    beginTransmission(a) { this.addr = (a | 0) & 127; this.tx = []; },
    write(x, n) {
      const add = b => this.tx.push((b | 0) & 255);
      if (typeof x === 'string') { for (const ch of x) add(ch.charCodeAt(0)); return x.length; }
      if (Array.isArray(x)) { const k = n == null ? x.length : Math.max(0, n | 0); x.slice(0, k).forEach(add); return k; }
      add(x); return 1;
    },
    endTransmission(stop = true) {
      const a = this.addr; this.addr = -1;
      if (a < 0 || !i2cAt(a)) return 2;
      const d = i2cDev(a);
      if (d) { d.start(true); this.tx.forEach(b => d.write(b)); if (stop !== false && stop !== 0) d.stop(); }
      return 0;
    },
    requestFrom(a, n) {
      a = (a | 0) & 127; n = Math.max(0, Math.min(255, n | 0)); this.rx = [];
      if (!i2cAt(a)) return 0;
      const d = i2cDev(a);
      if (d) { d.start(false); for (let i = 0; i < n; i++) this.rx.push(d.read()); d.stop(); } else this.rx = new Array(n).fill(0);
      return n;
    },
    available() { return this.rx.length; },
    read() { return this.rx.length ? this.rx.shift() : -1; },
    peek() { return this.rx.length ? this.rx[0] : -1; }
  };
  // SPI : un module en paquet écoute tant que sa broche CS est à LOW (digitalWrite), et répond octet par octet.
  let spiSel = null;
  function spiChip(k, level) {
    const hit = at(k).find(x => { const sp = pkgSpi(x.comp.type); return sp && sp.cs === x.pin; });
    if (!hit) return;
    if (!busDevs.has(hit.comp.id)) busDevs.set(hit.comp.id, createSpi(pkgSpi(hit.comp.type), () => hw.data(hit.comp)));
    const d = busDevs.get(hit.comp.id);
    if (!level) { d.select(); spiSel = d; } else { d.deselect(); if (spiSel === d) spiSel = null; }
  }
  $.O.SPI = {
    begin() {}, end() {}, beginTransaction() {}, endTransaction() {},
    transfer: b => (spiSel ? spiSel.transfer((b | 0) & 255) : 0),
    transfer16(w) { const hi = this.transfer((w >> 8) & 255), lo = this.transfer(w & 255); return (hi << 8) | lo; }
  };

  /* ---------- Bibliothèques ---------- */
  const busDevice = (types, addr, what) => {
    const list = hw.bus(types);
    if (!list.length) { warn(tl('{0} : aucun module trouvé sur le bus I2C de {1} (vérifiez VCC, GND, SDA et SCL)', what, hw.label)); return null; }
    const hit = list.find(d => d.addr.includes(addr));
    if (!hit) { warn(tl('{0} : aucun module ne répond à l’adresse 0x{1} (le module câblé répond à 0x{2})', what, (addr >>> 0).toString(16).toUpperCase(), list[0].addr[0].toString(16).toUpperCase())); return null; }
    return hit.comp;
  };
  class DHT {
    constructor(pin, type) { this.pin = pin; this.type = type; }
    begin() { this.k = keyOf(this.pin); }
    sensor() {
      const k = this.k || keyOf(this.pin), c = k && hw.onPin(k, ['dht11', 'dht22']);
      if (!c) { warn(tl('DHT : aucun capteur DHT n’est relié à la broche {0}', this.pin)); return null; }
      if ((this.type === 22 || this.type === 21) !== (c.type === 'dht22')) warn(tl('Le code déclare un DHT{0} mais le capteur câblé est un {1} : les mesures seraient fausses', this.type, c.type.toUpperCase()));
      return hw.data(c);
    }
    readTemperature(f) { const d = this.sensor(); return d ? (f ? d.temp * 9 / 5 + 32 : d.temp) : NaN; }
    readHumidity() { const d = this.sensor(); return d ? d.hum : NaN; }
    read() { return !!this.sensor(); }
    convertCtoF(c) { return c * 9 / 5 + 32; } convertFtoC(f) { return (f - 32) * 5 / 9; }
    computeHeatIndex(t, h, f = true) { const T = f ? t : t * 9 / 5 + 32, hi = 0.5 * (T + 61 + (T - 68) * 1.2 + h * 0.094); return f ? hi : (hi - 32) * 5 / 9; }
  }
  /** Bus 1-Wire : présence et recherche des sondes DS18B20 reliées à la broche. */
  class OneWire {
    constructor(pin) { this.pin = pin; this.found = false; }
    comp() { const k = keys.get(Math.trunc(+this.pin)); return k ? hw.onPin(k, ['ds18b20']) : null; }
    reset() { return this.comp() ? 1 : 0; }
    search(a) {
      const c = this.comp(); if (!c || this.found || !Array.isArray(a)) return false;
      dsAddr(c).forEach((b, i) => { a[i] = b; }); this.found = true; return true;
    }
    reset_search() { this.found = false; }
    crc8(a, n = 7) { return Array.isArray(a) ? crc8(a, n) : 0; }
    select() {} skip() {} write() {} read() { return 0xff; }
  }
  // Durée de conversion d'une DS18B20 selon la résolution (9 à 12 bits).
  const CONV = { 9: 94, 10: 188, 11: 375, 12: 750 };
  class DallasTemperature {
    constructor(bus) { this.bus = bus; this.wait = true; this.res = 12; this.readyAt = 0; this.done = false; this.last = 85; }
    static toFahrenheit(c) { return c * 9 / 5 + 32; }
    static toCelsius(f) { return (f - 32) * 5 / 9; }
    toFahrenheit(c) { return c * 9 / 5 + 32; } toCelsius(f) { return (f - 32) * 5 / 9; }
    begin() {}
    setWaitForConversion(w) { this.wait = !!w; } getWaitForConversion() { return this.wait; }
    /** setResolution(bits) pour toutes les sondes, ou setResolution(adresse, bits). */
    setResolution(a, b) { this.res = clamp((b === undefined ? a : b) | 0, 9, 12); }
    getResolution() { return this.res; }
    millisToWaitForConversion(bits) { return CONV[clamp((bits === undefined ? this.res : bits) | 0, 9, 12)]; }
    comp() { const k = this.bus && keyOf(this.bus.pin); return k && hw.onPin(k, ['ds18b20']); }
    getDeviceCount() { return this.comp() ? 1 : 0; }
    getDS18Count() { return this.getDeviceCount(); }
    isParasitePowerMode() { return false; }
    requestTemperatures() { this.done = true; this.readyAt = vt + CONV[this.res]; return new Wait(this.wait ? CONV[this.res] : 0); }
    requestTemperaturesByIndex() { return this.requestTemperatures(); }
    requestTemperaturesByAddress() { return this.requestTemperatures(); }
    isConversionComplete() { return vt + 1e-9 >= this.readyAt; }
    /** Dernière conversion, arrondie à la résolution ; lue avant la fin de la conversion : la valeur d'avant (85 °C à la mise sous tension). */
    temp() {
      const c = this.comp(), d = c && hw.data(c);
      if (!d || d.temp === -127) return -127;
      if (!this.done) { warn(tl('Température lue sans requestTemperatures() : la sonde renvoie 85 °C, sa valeur à la mise sous tension')); return 85; }
      if (vt + 1e-9 < this.readyAt) return this.last;
      const q = 2 ** (this.res - 8);
      return (this.last = Math.round(d.temp * q) / q);
    }
    getTempCByIndex(i) { return i === 0 ? this.temp() : -127; }
    getTempFByIndex(i) { const t = this.getTempCByIndex(i); return t === -127 ? -196.6 : t * 9 / 5 + 32; }
    /** Adresse de la sonde du bus (DeviceAddress, 8 octets). */
    addr() { const c = this.comp(); return c ? dsAddr(c) : null; }
    same(a) { const m = this.addr(); return !!m && Array.isArray(a) && m.every((b, i) => (a[i] & 255) === b); }
    getAddress(a, i) { const m = this.addr(); if (!m || i !== 0 || !Array.isArray(a)) return false; m.forEach((b, k) => { a[k] = b; }); return true; }
    getTempC(a) { return this.same(a) ? this.temp() : -127; }
    getTempF(a) { const t = this.getTempC(a); return t === -127 ? -196.6 : t * 9 / 5 + 32; }
    validAddress(a) { return Array.isArray(a) && a.length >= 8 && crc8(a, 7) === (a[7] & 255); }
    isConnected(a) { return this.same(a); }
  }
  class Adafruit_BMP280 {
    constructor() { this.mode = 3; this.snap = null; }
    begin(addr = 0x77) { this.c = busDevice(['bmp280'], addr, 'BMP280'); this.mode = 3; return !!this.c; }
    // MODE_NORMAL : mesures en continu ; MODE_FORCED : une mesure par takeForcedMeasurement() ; MODE_SLEEP : figé.
    d() { if (!this.c) return null; if (this.mode === 3) return hw.data(this.c); return this.snap || (this.snap = hw.data(this.c)); }
    readTemperature() { const d = this.d(); return d ? d.temp : NaN; }
    readPressure() { const d = this.d(); return d ? d.press * 100 : NaN; }
    readAltitude(sea = 1013.25) { const d = this.d(); return d ? 44330 * (1 - Math.pow(d.press / sea, 1 / 5.255)) : NaN; }
    setSampling(mode = 3) { this.mode = mode; this.snap = null; }
    takeForcedMeasurement() { if (!this.c || this.mode !== 1) return false; this.snap = hw.data(this.c); return true; }
    getStatus() { return 0; }
    sensorID() { return 0x58; }
  }
  // BME280 : la même interface que le BMP280, l'humidité en plus ; sensorID() rend 0x60 (0x58 pour un BMP280).
  class Adafruit_BME280 {
    constructor() { this.mode = 3; this.snap = null; this.dt = 0; }
    begin(addr = 0x77) { this.c = busDevice(['bme280'], addr, 'BME280'); this.mode = 3; return !!this.c; }
    d() { if (!this.c) return null; if (this.mode === 3) return hw.data(this.c); return this.snap || (this.snap = hw.data(this.c)); }
    readTemperature() { const d = this.d(); return d ? d.temp + this.dt : NaN; }
    readPressure() { const d = this.d(); return d ? d.press * 100 : NaN; }
    readHumidity() { const d = this.d(); return d ? d.hum : NaN; }
    readAltitude(sea = 1013.25) { const d = this.d(); return d ? 44330 * (1 - Math.pow(d.press / sea, 1 / 5.255)) : NaN; }
    seaLevelForAltitude(alt, p) { return p / Math.pow(1 - alt / 44330, 5.255); }
    setSampling(mode = 3) { this.mode = mode; this.snap = null; }
    takeForcedMeasurement() { if (!this.c || this.mode !== 1) return false; this.snap = hw.data(this.c); return true; }
    setTemperatureCompensation(t) { this.dt = +t || 0; }
    getTemperatureCompensation() { return this.dt; }
    sensorID() { return this.c ? 0x60 : 0; }
  }
  // BH1750 (bibliothèque de Christopher Laws) : begin() reprend l'adresse 0x23 par défaut, même si le constructeur en
  // donnait une autre (comme la vraie bibliothèque) ; readLightLevel() rend −1 avant begin(), −2 si le module ne répond pas.
  class BH1750 {
    constructor(addr = 0x23) { this.addr = addr; this.mode = 0; this.mt = 69; this.t0 = 0; }
    begin(mode = 0x10, addr = 0x23) { if (addr) this.addr = addr; this.c = busDevice(['bh1750'], this.addr, 'BH1750'); return !!this.c && this.configure(mode); }
    configure(mode) {
      if (![0x10, 0x11, 0x13, 0x20, 0x21, 0x23].includes(mode)) { warn(tl('BH1750 : mode de mesure inconnu ({0})', mode)); return false; }
      this.mode = mode; this.t0 = vt; return !!this.c;
    }
    setMTreg(mt) { if (mt < 31 || mt > 254) { warn(tl('BH1750 : setMTreg({0}) hors de la plage 31 à 254', mt)); return false; } this.mt = mt; this.t0 = vt; return true; }
    low() { return this.mode === 0x13 || this.mode === 0x23; }
    measurementReady() { return !!this.c && !!this.mode && vt - this.t0 >= (this.low() ? 24 : 180) * this.mt / 69; }
    readLightLevel() {
      if (!this.mode) return -1;
      const d = this.c && hw.data(this.c); if (!d) return -2;
      const step = this.low() ? 4 : this.mode === 0x11 || this.mode === 0x21 ? 0.5 : 1;
      return Math.round(d.lux * 69 / this.mt / step) * step * this.mt / 69;
    }
  }
  // HX711 (bibliothèque de Bogdan Necula) : une mesure toutes les 100 ms ; read(), read_average(), get_value(),
  // get_units() et tare() attendent les mesures qui ne sont pas encore prêtes.
  class HX711 {
    constructor() { this.off = 0; this.scale = 1; this.gain = 128; this.next = 0; this.down = false; this.told = false; }
    begin(dout, sck, gain = 128) { this.dout = dout; this.sck = sck; this.set_gain(gain); this.next = vt + 100; this.cell(); }
    cell() {
      const k = keyOf(this.dout), c = k && hw.onPin(k, ['hx711']);
      if (!c) { warn(tl('HX711 : aucun module HX711 n’a sa broche DT reliée à la broche {0}', this.dout)); return null; }
      const ks = keyOf(this.sck);
      if (ks && !at(ks).some(x => x.comp === c && x.pin === 'SCK')) warn(tl('HX711 : la broche SCK du module n’est pas reliée à la broche {0}', this.sck));
      return c;
    }
    data() { const c = this.cell(); return c && !this.down ? hw.data(c) : null; }
    is_ready() { return !!this.data() && vt >= this.next; }
    sample(d) { return this.gain === 32 ? Math.round((rnd() - 0.5) * 40) : (this.gain === 64 ? d.raw / 2 : d.raw) + (rnd() - 0.5) * 60; }
    /** times mesures : leur moyenne, et l'attente jusqu'à la dernière (null si le module ne répond pas). */
    take(times) {
      const d = this.data();
      if (!d) { if (!this.told) { this.told = true; warn(tl('HX711 ne répond pas (DT reste au niveau haut) : sur une vraie carte, la lecture attendrait sans fin. Vérifiez VCC, GND, DT et SCK')); } return null; }
      const n = Math.max(1, Math.trunc(+times) || 1), first = Math.max(this.next, vt), last = first + (n - 1) * 100;
      this.next = last + 100;
      let sum = 0; for (let i = 0; i < n; i++) sum += this.sample(d);
      return { ms: last - vt, v: sum / n };
    }
    read() { const r = this.take(1); return r ? new Wait(r.ms, Math.round(r.v)) : new Wait(1000, 0); }
    read_average(times = 10) { const r = this.take(times); return r ? new Wait(r.ms, Math.round(r.v)) : new Wait(1000, 0); }
    get_value(times = 1) { const r = this.take(times); return r ? new Wait(r.ms, r.v - this.off) : new Wait(1000, 0); }
    get_units(times = 1) { const r = this.take(times); return r ? new Wait(r.ms, (r.v - this.off) / this.scale) : new Wait(1000, 0); }
    tare(times = 10) { const r = this.take(times); if (r) this.off = Math.round(r.v); return new Wait(r ? r.ms : 1000); }
    wait_ready() { return this.data() ? new Wait(Math.max(0, this.next - vt)) : new Wait(1000); }
    wait_ready_retry(retries = 3, delay = 0) { const limit = (Math.max(1, retries) + 1) * Math.max(1, +delay || 1); return this.wait_ready_timeout(limit); }
    wait_ready_timeout(timeout = 1000) { const w = Math.max(0, this.next - vt); return this.data() && w <= timeout ? new Wait(w, true) : new Wait(timeout, false); }
    set_gain(g = 128) { this.gain = g === 64 ? 64 : g === 32 ? 32 : 128; }
    set_scale(s = 1) { this.scale = +s || 1; }
    get_scale() { return this.scale; }
    set_offset(o = 0) { this.off = Math.trunc(+o || 0); }
    get_offset() { return this.off; }
    power_down() { this.down = true; }
    power_up() { this.down = false; this.next = vt + 100; }
  }
  class Adafruit_MPU6050 {
    constructor() { this.ar = 0; this.gr = 0; this.bw = 0; }
    begin(addr = 0x68) { this.c = busDevice(['mpu6050'], addr, 'MPU6050'); return !!this.c; }
    getEvent(a, g, t) {
      const d = this.c && hw.data(this.c); if (!d) return false;
      // Mesures bornées par la plage choisie : ±2 à ±16 g, ±250 à ±2000 °/s (gyroscope en rad/s).
      const G = 2 ** (this.ar + 1), W = 250 * 2 ** this.gr * Math.PI / 180;
      const acc = v => clamp(v || 0, -G, G) * 9.80665, gyr = v => clamp(v || 0, -W, W);
      if (a && a.acceleration) Object.assign(a.acceleration, { x: acc(d.ax), y: acc(d.ay), z: acc(d.az) });
      if (g && g.gyro) Object.assign(g.gyro, { x: gyr(d.gx), y: gyr(d.gy), z: gyr(d.gz) });
      if (t) t.temperature = d.temp;
      return true;
    }
    setAccelerometerRange(r) { this.ar = clamp(r | 0, 0, 3); } getAccelerometerRange() { return this.ar; }
    setGyroRange(r) { this.gr = clamp(r | 0, 0, 3); } getGyroRange() { return this.gr; }
    setFilterBandwidth(b) { this.bw = clamp(b | 0, 0, 6); } getFilterBandwidth() { return this.bw; }
  }
  class LiquidCrystal_I2C {
    constructor(addr, cols = 16, rows = 2) { this.addr = addr; this.cols = cols; this.rows = rows; this.buf = Array.from({ length: rows }, () => ' '.repeat(cols)); this.cx = 0; this.cy = 0; this.light = false; this.on = true; }
    init() { this.c = busDevice(['lcd1602'], this.addr, tl('Écran LCD')); this.clear(); this.push(); }
    begin() { this.init(); }
    push() { if (this.c) this.c.progScreen = { lines: this.light && this.on ? this.buf.slice(0, 2) : [], ver: (this.c.progScreen ? this.c.progScreen.ver : 0) + 1 }; }
    backlight() { this.light = true; this.push(); } noBacklight() { this.light = false; this.push(); } setBacklight(v) { this.light = !!v; this.push(); }
    display() { this.on = true; this.push(); } noDisplay() { this.on = false; this.push(); }
    clear() { this.buf = this.buf.map(() => ' '.repeat(this.cols)); this.cx = 0; this.cy = 0; this.push(); }
    home() { this.cx = 0; this.cy = 0; }
    setCursor(c, r) { this.cx = clamp(c | 0, 0, this.cols); this.cy = clamp(r | 0, 0, this.rows - 1); }
    put(s) {
      if (!this.c) warn(tl('Écran LCD : lcd.init() n’a pas été appelé, ou l’écran ne répond pas'));
      for (const ch of s) {
        if (ch === '\n' || ch === '\r') continue;
        if (this.cx < this.cols) { const row = this.buf[this.cy]; this.buf[this.cy] = row.slice(0, this.cx) + ch + row.slice(this.cx + 1); }
        this.cx++;
      }
      this.push();
      return s.length;
    }
    print(x, f, tag) { return this.put(fmt(x, f, tag)); }
    println(x, f, tag) { warn(tl('lcd.println() affiche des caractères parasites sur un vrai LCD : préférez setCursor() puis print()')); return this.put(fmt(x, f, tag)); }
    write(x) { return this.put(typeof x === 'number' ? String.fromCharCode(x) : String(x)); }
    blink() {} noBlink() {} cursor() {} noCursor() {} createChar() {} scrollDisplayLeft() {} scrollDisplayRight() {}
  }
  const OPS_MAX = 4000;
  class Adafruit_SSD1306 {
    constructor(w = 128, h = 64) { this.w = w; this.h = h; this.ops = []; this.x = 0; this.y = 0; this.size = 1; this.color = 1; this.wrap = true; this.inv = false; }
    // Sans adresse, la bibliothèque prend 0x3D pour un écran de 64 lignes (0x3C pour 32) : la plupart des modules 128×64 sont en 0x3C.
    begin(vcc, addr = 0) { if (!addr) addr = this.h === 32 ? 0x3c : 0x3d; this.c = busDevice(['oled'], addr, tl('Écran OLED')); return !!this.c; }
    clearDisplay() { this.ops = []; this.x = 0; this.y = 0; }
    display() {
      if (!this.c) { warn(tl('Écran OLED : display.begin() n’a pas réussi, rien ne s’affiche')); return; }
      if (this.ops.length > OPS_MAX) this.ops.splice(0, this.ops.length - OPS_MAX);
      this.c.progScreen = { ops: this.ops.slice(), inv: this.inv, ver: (this.c.progScreen ? this.c.progScreen.ver : 0) + 1 };
    }
    setTextSize(s) { this.size = clamp(s | 0, 1, 8); } setTextColor(c) { this.color = c; } setCursor(x, y) { this.x = x; this.y = y; } setTextWrap(w) { this.wrap = !!w; }
    getCursorX() { return this.x; } getCursorY() { return this.y; }
    put(s) {
      const cw = 6 * this.size, ch = 8 * this.size;
      let run = '', rx = this.x;
      const flush = () => { if (run) this.ops.push({ t: 'text', x: rx, y: this.y, s: this.size, c: this.color, str: run }); run = ''; };
      for (const c of s) {
        if (c === '\n') { flush(); this.x = 0; this.y += ch; rx = 0; continue; }
        if (c === '\r') continue;
        if (this.wrap && this.x + cw > this.w) { flush(); this.x = 0; this.y += ch; rx = 0; }
        if (!run) rx = this.x;
        run += c; this.x += cw;
      }
      flush();
      if (this.ops.length > OPS_MAX) this.ops.splice(0, this.ops.length - OPS_MAX);
      return s.length;
    }
    print(x, f, tag) { return this.put(fmt(x, f, tag)); }
    println(x, f, tag) { return this.put(fmt(x, f, tag) + '\n'); }
    write(x) { return this.put(typeof x === 'number' ? String.fromCharCode(x) : String(x)); }
    drawPixel(x, y, c) { this.ops.push({ t: 'rect', x, y, w: 1, h: 1, fill: true, c }); }
    drawLine(x0, y0, x1, y1, c) { this.ops.push({ t: 'line', x0, y0, x1, y1, c }); }
    drawFastHLine(x, y, w, c) { this.ops.push({ t: 'rect', x, y, w, h: 1, fill: true, c }); }
    drawFastVLine(x, y, h, c) { this.ops.push({ t: 'rect', x, y, w: 1, h, fill: true, c }); }
    drawRect(x, y, w, h, c) { this.ops.push({ t: 'rect', x, y, w, h, fill: false, c }); }
    fillRect(x, y, w, h, c) { this.ops.push({ t: 'rect', x, y, w, h, fill: true, c }); }
    drawRoundRect(x, y, w, h, r, c) { this.ops.push({ t: 'rect', x, y, w, h, r, fill: false, c }); }
    fillRoundRect(x, y, w, h, r, c) { this.ops.push({ t: 'rect', x, y, w, h, r, fill: true, c }); }
    drawCircle(x, y, r, c) { this.ops.push({ t: 'circle', x, y, r, fill: false, c }); }
    fillCircle(x, y, r, c) { this.ops.push({ t: 'circle', x, y, r, fill: true, c }); }
    drawTriangle(x0, y0, x1, y1, x2, y2, c) { this.ops.push({ t: 'tri', p: [x0, y0, x1, y1, x2, y2], fill: false, c }); }
    fillTriangle(x0, y0, x1, y1, x2, y2, c) { this.ops.push({ t: 'tri', p: [x0, y0, x1, y1, x2, y2], fill: true, c }); }
    fillScreen(c) { this.ops.push({ t: 'rect', x: 0, y: 0, w: this.w, h: this.h, fill: true, c }); }
    /** Image d'un tableau d'octets, ligne par ligne, bit de poids fort à gauche (XBM : poids faible à gauche). */
    drawBitmap(x, y, bmp, w, h, c, bg) { this.bitmap(x, y, bmp, w, h, c, bg, false); }
    drawXBitmap(x, y, bmp, w, h, c) { this.bitmap(x, y, bmp, w, h, c, undefined, true); }
    bitmap(x, y, bmp, w, h, c = 1, bg, xbm) {
      if (!Array.isArray(bmp)) { warn(tl('drawBitmap() attend un tableau d’octets, par exemple const unsigned char image[] PROGMEM = {…}')); return; }
      const bw = Math.ceil(w / 8);
      if (bg !== undefined) this.ops.push({ t: 'rect', x, y, w, h, fill: true, c: bg });
      for (let j = 0; j < h; j++) {
        let run = -1;
        for (let i = 0; i <= w; i++) {
          const byte = i < w ? bmp[j * bw + (i >> 3)] | 0 : 0, on = i < w && (xbm ? (byte >> (i & 7)) & 1 : (byte << (i & 7)) & 0x80);
          if (on && run < 0) run = i;
          if (!on && run >= 0) { this.ops.push({ t: 'rect', x: x + run, y: y + j, w: i - run, h: 1, fill: true, c }); run = -1; }
        }
      }
      if (this.ops.length > OPS_MAX) this.ops.splice(0, this.ops.length - OPS_MAX);
    }
    drawChar(x, y, ch, c = 1, bg, size = 1) {
      const s = clamp(size | 0, 1, 8);
      if (bg !== undefined && bg !== c) this.ops.push({ t: 'rect', x, y, w: 6 * s, h: 8 * s, fill: true, c: bg });
      this.ops.push({ t: 'text', x, y, s, c, str: typeof ch === 'number' ? String.fromCharCode(ch & 255) : String(ch)[0] || ' ' });
    }
    /** Rectangle qu'occuperait le texte écrit en (x, y), sans l'écrire : x1, y1, largeur, hauteur. */
    getTextBounds(str, x, y, x1, y1, w, h) {
      const cw = 6 * this.size, chh = 8 * this.size;
      let cx = x, cy = y, minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const c of fmt(str)) {
        if (c === '\n') { cx = 0; cy += chh; continue; }
        if (c === '\r') continue;
        if (this.wrap && cx + cw > this.w) { cx = 0; cy += chh; }
        minx = Math.min(minx, cx); miny = Math.min(miny, cy); maxx = Math.max(maxx, cx + cw - 1); maxy = Math.max(maxy, cy + chh - 1);
        cx += cw;
      }
      const empty = maxx < minx;
      refSet(x1, empty ? x : minx); refSet(y1, empty ? y : miny); refSet(w, empty ? 0 : maxx - minx + 1); refSet(h, empty ? 0 : maxy - miny + 1);
    }
    invertDisplay(i) { this.inv = !!i; }
    width() { return this.w; } height() { return this.h; } setRotation() {} cp437() {} dim() {}
  }
  // Servo : l'angle commandé devient une impulsion entre min et max µs (544 et 2400 par défaut, attach(broche, min, max)
  // avec ESP32Servo) ; le servo simulé, un SG90, va de 0° à 544 µs à 180° à 2400 µs.
  const SERVO_US = [544, 2400];
  class Servo {
    constructor() { this.k = null; this.a = 90; this.min = 544; this.max = 2400; this.us = 1472; this.hz = 50; }
    phys() { return clamp(Math.round((this.us - SERVO_US[0]) * 180 / (SERVO_US[1] - SERVO_US[0])), 0, 180); }
    attach(pin, min, max) {
      if (min != null && max != null && max > min) { this.min = min; this.max = max; this.us = this.min + this.a * (this.max - this.min) / 180; }
      this.k = keyOf(pin); if (this.k) { const p = pinState(this.k); p.mode = 1; p.servo = this.phys(); }
      return this.k ? 1 : 0;
    }
    detach() { if (this.k) pinState(this.k).servo = null; this.k = null; }
    attached() { return !!this.k; }
    setPeriodHertz(hz) { this.hz = +hz || 50; }
    write(v) {
      if (v >= 544) return this.writeMicroseconds(v);
      this.a = clamp(Math.round(+v || 0), 0, 180);
      this.us = this.min + this.a * (this.max - this.min) / 180;
      if (!this.k) { warn(tl('servo.write() avant servo.attach(broche) : le servo ne reçoit rien')); return; }
      pinState(this.k).servo = this.phys();
    }
    writeMicroseconds(us) {
      this.us = clamp(+us || 0, 0, 3000);
      this.a = clamp(Math.round((this.us - this.min) * 180 / (this.max - this.min)), 0, 180);
      if (!this.k) { warn(tl('servo.write() avant servo.attach(broche) : le servo ne reçoit rien')); return; }
      pinState(this.k).servo = this.phys();
    }
    read() { return this.a; } readMicroseconds() { return Math.round(this.us); }
  }
  /** ESP32Servo : ESP32PWM::allocateTimer(n) réserve une minuterie de la PWM (rien à faire ici). */
  class ESP32PWM { static allocateTimer() {} }
  class Adafruit_NeoPixel {
    constructor(n = 0, pin = 6, type = 0x52) { this.n = n; this.pin = pin; this.type = type; this.px = new Array(n).fill(0); this.bright = 255; }
    begin() { this.k = keyOf(this.pin); if (this.k) pinState(this.k).mode = 1; }
    show() {
      if (!this.k) { warn(tl('leds.show() avant leds.begin()')); return; }
      // Ordre des couleurs annoncé au constructeur (NEO_GRB, NEO_RGB…) : la barrette WS2812B lit ses octets dans l'ordre
      // vert, rouge, bleu. Avec NEO_RGB, le rouge arrive à la place du vert : les deux couleurs sont échangées.
      const t = this.type, ro = (t >> 4) & 3, go = (t >> 2) & 3, bo = t & 3, b = this.bright / 255;
      if (t & 0x100) { warn(tl('NEO_KHZ400 : les LED WS2812B attendent un signal à 800 kHz (NEO_KHZ800), elles ne comprennent pas celui-ci')); return; }
      if (((t >> 6) & 3) !== ro) warn(tl('NEO_GRBW et NEO_RGBW sont prévus pour des LED à quatre couleurs : sur cette barrette RGB, les couleurs seraient décalées'));
      pinState(this.k).px = this.px.map(c => { const o = [0, 0, 0, 0]; o[ro] = (c >> 16) & 255; o[go] = (c >> 8) & 255; o[bo] = c & 255; return [o[1] * b, o[0] * b, o[2] * b]; });
    }
    clear() { this.px.fill(0); }
    setPixelColor(i, r, g, b) { if (i < 0 || i >= this.n) return; this.px[i] = g === undefined ? r >>> 0 : this.Color(r, g, b); }
    getPixelColor(i) { return this.px[i] || 0; }
    Color(r, g, b) { return ((clamp(r | 0, 0, 255) << 16) | (clamp(g | 0, 0, 255) << 8) | clamp(b | 0, 0, 255)) >>> 0; }
    ColorHSV(h = 0, s = 255, v = 255) {
      const H = ((h & 65535) / 65536) * 6, S = s / 255, V = v / 255, i = Math.floor(H), f = H - i;
      const p = V * (1 - S), q = V * (1 - S * f), t = V * (1 - S * (1 - f));
      const [r, g, b] = [[V, t, p], [q, V, p], [p, V, t], [p, q, V], [t, p, V], [V, p, q]][i % 6];
      return this.Color(r * 255, g * 255, b * 255);
    }
    gamma32(c) { return c; }
    fill(c = 0, first = 0, count = 0) { const end = count ? Math.min(this.n, first + count) : this.n; for (let i = first; i < end; i++) this.px[i] = c >>> 0; }
    setBrightness(b) { this.bright = clamp(b | 0, 0, 255); } getBrightness() { return this.bright; }
    numPixels() { return this.n; } setPin(p) { this.pin = p; this.begin(); } updateLength(n) { this.n = n; this.px = new Array(n).fill(0); }
  }
  class Stepper {
    constructor(steps, a, b, c, d) { this.steps = steps || 2048; this.pins = [a, b, c, d].filter(x => x !== undefined); this.rpm = 1; this.pos = 0; }
    setSpeed(r) { this.rpm = Math.max(0.01, +r || 0); }
    step(n) {
      const k = keyOf(this.pins[0]); if (!k) return 0;
      this.pins.forEach(p => { const kk = keyOf(p); if (kk) pinState(kk).mode = 1; });
      const ms = Math.abs(n) / this.steps / this.rpm * 60000, from = this.pos;
      this.pos += n / this.steps;
      pinState(k).stepper = { from, to: this.pos, t0: vt, t1: vt + ms };
      return new Wait(ms);
    }
    version() { return 5; }
  }

  /* ---------- Infrarouge (IRremote) ---------- */
  // Le récepteur (VS1838B) relié par sa patte OUT reçoit les trames de la télécommande du panneau « Périphériques ».
  // Comme la vraie bibliothèque : après une trame décodée, le récepteur s'arrête jusqu'à resume() ; ce qui arrive entre-temps est perdu.
  const NEC_RAW = (a, c) => ((((~c & 255) << 24) | ((c & 255) << 16) | ((~a & 255) << 8) | (a & 255)) >>> 0);
  const rev8 = b => { let r = 0; for (let i = 0; i < 8; i++) r = (r << 1) | ((b >> i) & 1); return r; };
  class IRrecv {
    constructor(pin) { this.pin = pin; this.c = null; this.on = false; this.stopped = false; this.seen = 0; this.decodedIRData = { command: 0, address: 0, protocol: 0, flags: 0, decodedRawData: 0, numberOfBits: 0 }; }
    begin(pin = this.pin) {
      this.pin = pin; this.on = true; this.stopped = false;
      const k = keyOf(pin); this.c = k ? hw.onPin(k, ['ir']) : null;
      if (!this.c) warn(tl('IrReceiver.begin({0}) : aucun récepteur infrarouge n’est relié à cette broche par sa patte OUT', pin));
      else this.seen = periph(this.c).seq;
    }
    enableIRIn() { this.begin(this.pin); }
    start() { this.on = true; } stop() { this.on = false; }
    isIdle() { return !this.stopped; }
    decode(res) {
      if (!this.on) { warn(tl('IrReceiver.decode() avant IrReceiver.begin(broche) : le récepteur n’écoute pas')); return false; }
      if (!this.stopped) {
        if (!this.c) return false;
        const st = periph(this.c), f = st.frames.find(x => x.seq > this.seen);
        if (!f) return false;
        this.seen = st.seq;
        const s = stat(this.c);
        if (!s.ok) { warn(tl('Le récepteur infrarouge {0} ne reçoit rien : {1}', this.c.name, s.msg || tl('câblage incomplet'))); return false; }
        Object.assign(this.decodedIRData, { command: f.cmd, address: f.addr, protocol: 8, flags: f.repeat ? 1 : 0, decodedRawData: f.repeat ? 0 : NEC_RAW(f.addr, f.cmd), numberOfBits: f.repeat ? 0 : 32 });
        this.stopped = true;
      }
      // Ancienne API : results.value suit l'ordre des bits de l'époque (0xFFA25D pour CH−), 0xFFFFFFFF pour une répétition.
      if (res && typeof res === 'object') {
        const d = this.decodedIRData;
        res.value = d.flags & 1 ? 0xffffffff : ((rev8(d.address) << 24) | (rev8(~d.address & 255) << 16) | (rev8(d.command) << 8) | rev8(~d.command & 255)) >>> 0;
        res.decode_type = 8; res.bits = 32;
      }
      return true;
    }
    resume() { this.stopped = false; if (this.c) this.seen = periph(this.c).seq; }
    text(min) {
      const d = this.decodedIRData, h = x => '0x' + (x >>> 0).toString(16).toUpperCase();
      if (!d.protocol) return min ? 'P=UNKNOWN' : 'Protocol=UNKNOWN';
      if (min) return `P=NEC A=${h(d.address)} C=${h(d.command)}${d.flags & 1 ? ' R' : ` Raw=${h(d.decodedRawData)}`}`;
      return `Protocol=NEC Address=${h(d.address)} Command=${h(d.command)}${d.flags & 1 ? ' Repeat gap=40350us' : ` Raw-Data=${h(d.decodedRawData)} 32 bits LSB first`}`;
    }
    printIRResultShort(port) { (port && port.println ? port : $.O.Serial).println(this.text(false)); }
    printIRResultMinimal(port) { (port && port.println ? port : $.O.Serial).println(this.text(true)); }
    printIRSendUsage(port) { const d = this.decodedIRData, h = x => '0x' + (x >>> 0).toString(16).toUpperCase(); if (d.protocol) (port && port.println ? port : $.O.Serial).println(`Send with: IrSender.sendNEC(${h(d.address)}, ${h(d.command)}, <numberOfRepeats>);`); }
    printIRResultRawFormatted(port) { (port && port.println ? port : $.O.Serial).println(this.decodedIRData.protocol ? 'rawData[67]: (NEC)' : 'rawData[0]:'); }
  }
  class decode_results { constructor() { this.value = 0; this.decode_type = 0; this.bits = 0; } }

  /* ---------- Lecteur RFID (MFRC522) ---------- */
  // Les badges du panneau « Périphériques » se posent sur un lecteur : PICC_IsNewCardPresent() ne rend true qu'une
  // fois par présentation, comme la vraie bibliothèque (il faut retirer le badge et le reposer).
  class Uid { constructor() { this.size = 0; this.uidByte = new Array(10).fill(0); this.sak = 0; } }
  class MIFARE_Key { constructor() { this.keyByte = new Array(6).fill(0); } }
  class MFRC522 {
    constructor(ss, rst) { this.ss = ss; this.rst = rst; this.uid = new Uid(); this.init = false; this.c = null; this.seen = -1; this.pend = null; this.active = null; this.auth = false; }
    find() {
      for (const n of [this.ss, this.rst]) { const k = n != null && keys.get(Math.trunc(+n)), c = k && hw.onPin(k, ['rc522']); if (c) return c; }
      return null;
    }
    PCD_Init(ss, rst) {
      if (ss !== undefined) { this.ss = ss; this.rst = rst; }
      this.init = true; this.c = this.find(); this.seen = -1;
      if (!this.c) warn(tl('MFRC522 : aucun lecteur RFID n’est relié aux broches SS {0} et RST {1}', this.ss, this.rst));
    }
    PCD_Reset() {} PCD_AntennaOn() {} PCD_AntennaOff() {} PCD_SetAntennaGain() {} PCD_GetAntennaGain() { return 0x40; } PCD_SoftPowerDown() {} PCD_SoftPowerUp() {} PCD_StopCrypto1() { this.auth = false; }
    ok() {
      if (!this.init) { warn(tl('MFRC522 : rfid.PCD_Init() n’a pas été appelé (après SPI.begin())')); return false; }
      if (!this.c) return false;
      const s = stat(this.c);
      if (!s.ok) { warn(tl('Le lecteur RFID {0} ne répond pas : {1}', this.c.name, s.msg || tl('câblage incomplet'))); return false; }
      return true;
    }
    PCD_PerformSelfTest() { return this.ok(); }
    PCD_DumpVersionToSerial() {
      const v = this.init && this.c && stat(this.c).ok;
      $.O.Serial.println(v ? 'Firmware Version: 0x92 = v2.0' : 'Firmware Version: 0x0 = (unknown)');
      if (!v) $.O.Serial.println('WARNING: Communication failure, is the MFRC522 properly connected?');
    }
    PICC_IsNewCardPresent() {
      if (!this.ok()) return false;
      const st = periph(this.c);
      if (st.card == null || st.seq === this.seen) return false;
      this.seen = st.seq; this.pend = st.card; return true;
    }
    PICC_ReadCardSerial() {
      if (this.pend == null || !this.ok() || periph(this.c).card !== this.pend) { this.pend = null; return false; }
      const b = BADGES[this.pend];
      this.uid.size = b.uid.length; b.uid.forEach((x, i) => { this.uid.uidByte[i] = x; }); this.uid.sak = 0x08;
      this.active = this.pend; this.pend = null; return true;
    }
    PICC_HaltA() { this.active = null; this.auth = false; return 0; }
    PICC_GetType(sak) { return (sak & 0x7f) === 0x08 ? 4 : (sak & 0x7f) === 0x18 ? 5 : (sak & 0x7f) === 0x09 ? 3 : (sak & 0x7f) === 0x00 ? 6 : 0; }
    PICC_GetTypeName(t) { return PICC_NAMES[t] || PICC_NAMES[0]; }
    PICC_DumpDetailsToSerial(u = this.uid) {
      const S = $.O.Serial;
      S.println('Card UID: ' + u.uidByte.slice(0, u.size).map(hex2).join(' '));
      S.println('Card SAK: ' + hex2(u.sak));
      S.println('PICC type: ' + this.PICC_GetTypeName(this.PICC_GetType(u.sak)));
    }
    PICC_DumpToSerial(u = this.uid) { this.PICC_DumpDetailsToSerial(u); this.PICC_HaltA(); }
    // Mémoire du badge (MIFARE Classic 1K) : authentification par clé, lecture et écriture de blocs de 16 octets.
    PCD_Authenticate(cmd, block) { if (this.active == null || !this.ok()) return 3; if (block < 0 || block > 63) return 6; this.auth = true; return 0; }
    MIFARE_Read(block, buf, size) {
      if (this.active == null || !this.auth) return 3;
      if (block < 0 || block > 63) return 6;
      if (isRef(size) && size.get() < 18) return 4;
      const data = badgeMem(this.active)[block].slice();
      refStore(buf, [...data, 0, 0], 18); refSet(size, 18);
      return 0;
    }
    MIFARE_Write(block, buf, size = 16) {
      if (this.active == null || !this.auth) return 3;
      if (block <= 0 || block > 63 || block % 4 === 3 || (size | 0) < 16 || !Array.isArray(buf)) return 6;
      badgeMem(this.active)[block] = buf.slice(0, 16).map(x => x & 255);
      return 0;
    }
    GetStatusCodeName(code) { return STATUS_NAMES[code & 255] || 'Unknown error'; }
  }

  /* ---------- Clavier matriciel (Keypad) ---------- */
  // La bibliothèque met chaque colonne à LOW tour à tour et lit les lignes (INPUT_PULLUP). La touche lue dépend du
  // câblage : une touche du clavier relie sa ligne Rn à sa colonne Cn ; le programme la voit à la case [i][j] du tableau
  // si rowPins[i] et colPins[j] mènent à ces deux fils. Lignes et colonnes inversées : le tableau est lu transposé.
  class Keypad {
    constructor(map, rows, cols, nr, nc) {
      this.map = Array.isArray(map) ? map : []; this.nr = nr | 0; this.nc = nc | 0; this.hold = 500; this.c = null; this.rl = []; this.cl = []; this.seen = 0;
      const line = n => { const k = keyOf(n), hit = at(k).find(x => x.comp.type === 'keypad'); if (hit && !this.c) this.c = hit.comp; return { k, hit }; };
      const R = (rows || []).slice(0, this.nr).map(line), C = (cols || []).slice(0, this.nc).map(line);
      this.rl = R.map(x => (x.hit && x.hit.comp === this.c ? x.hit.pin : null)); this.cl = C.map(x => (x.hit && x.hit.comp === this.c ? x.hit.pin : null));
      R.forEach(x => { if (x.k) pinState(x.k).mode = 2; });
      if (!this.c) warn(tl('Keypad : aucun clavier matriciel n’est relié aux broches des lignes et des colonnes'));
      else this.seen = periph(this.c).seq;
    }
    /** Caractère du tableau pour la touche (ligne r, colonne c) du clavier, 0 si son câblage ne la relie pas au programme. */
    charAt(pos) {
      if (!pos || !this.c) return 0;
      const a = 'R' + (pos.r + 1), b = 'C' + (pos.c + 1);
      for (let i = 0; i < this.rl.length; i++) for (let j = 0; j < this.cl.length; j++) {
        if ((this.rl[i] === a && this.cl[j] === b) || (this.rl[i] === b && this.cl[j] === a)) { const row = this.map[i]; const v = Array.isArray(row) ? row[j] : typeof row === 'string' ? row.charCodeAt(j) : 0; return v | 0; }
      }
      return 0;
    }
    getKey() {
      if (!this.c) return 0;
      const st = periph(this.c);
      if (st.seq === this.seen) return 0;
      this.seen = st.seq; this.downAt = vt;
      return this.charAt(st.last);
    }
    waitForKey() { return new Poll(() => this.getKey()); }
    getState() { const st = this.c && periph(this.c); if (!st || !st.down || !this.charAt(st.down)) return 0; return vt - (this.downAt ?? vt) >= this.hold ? 2 : 1; }
    isPressed(ch) { const st = this.c && periph(this.c); return !!(st && st.down) && this.charAt(st.down) === (ch | 0); }
    keyStateChanged() { return !!this.c && periph(this.c).seq !== this.seen; }
    setDebounceTime() {} setHoldTime(ms) { this.hold = +ms || 0; }
    numKeys() { return this.nr * this.nc; }
  }

  /* ---------- Radio nRF24L01 (RF24) ---------- */
  // Les modules du même montage s'entendent : write() dépose les octets dans la file de réception (3 places) de chaque
  // module à l'écoute sur le même canal et le même débit, dont un tube de lecture a l'adresse du tube d'écriture.
  // write() rend true quand un récepteur a accusé réception. Un module n'émet que câblé et alimenté en 3,3 V.
  class RF24 {
    constructor(ce, csn) { this.ce = ce; this.csn = csn; this.c = null; this.up = false; this.failureDetected = false; }
    st() { return periph(this.c); }
    begin() {
      this.up = false;
      for (const n of [this.ce, this.csn]) { const k = keyOf(n), c = k && hw.onPin(k, ['nrf24']); if (c) { this.c = c; break; } }
      if (!this.c) { warn(tl('RF24 : aucun module nRF24L01 n’est relié aux broches CE {0} et CSN {1}', this.ce, this.csn)); return false; }
      const s = stat(this.c);
      if (!s.ok) { warn(tl('Le module radio {0} ne répond pas : {1}', this.c.name, s.msg || tl('câblage incomplet'))); return false; }
      Object.assign(this.st(), { on: true, listening: false, channel: 76, rate: 0, pipes: [], tx: null, rx: [], payload: 32, dyn: false, ack: true, board: hw.label }, { ver: this.st().ver + 1 });
      this.up = true; return true;
    }
    ready(what) {
      if (!this.up) { warn(tl('radio.{0}() : la radio ne fonctionne pas (radio.begin() absent ou en échec)', what)); return false; }
      const s = stat(this.c);
      if (!s.ok) { warn(tl('Le module radio {0} ne répond pas : {1}', this.c.name, s.msg || tl('câblage incomplet'))); return false; }
      return true;
    }
    isChipConnected() { return this.up && stat(this.c).ok; }
    openWritingPipe(a) { if (this.c) this.st().tx = pipeKey(a); }
    openReadingPipe(n, a) { if (this.c) this.st().pipes[clamp(n | 0, 0, 5)] = pipeKey(a); }
    closeReadingPipe(n) { if (this.c) this.st().pipes[clamp(n | 0, 0, 5)] = null; }
    setPALevel(l) { if (this.c) this.st().pa = l; } getPALevel() { return this.c ? this.st().pa ?? 3 : 4; }
    setChannel(ch) { if (this.c) this.st().channel = clamp(ch | 0, 0, 125); } getChannel() { return this.c ? this.st().channel : 0; }
    setDataRate(r) { if (this.c) this.st().rate = clamp(r | 0, 0, 2); return !!this.c; } getDataRate() { return this.c ? this.st().rate : 0; }
    setRetries() {} setCRCLength() {} setAddressWidth() {} enableAckPayload() {} flush_tx() {}
    setAutoAck(a, b) { if (this.c && b === undefined) this.st().ack = !!a; }
    setPayloadSize(n) { if (this.c) this.st().payload = clamp(n | 0, 1, 32); } getPayloadSize() { return this.c ? this.st().payload : 32; }
    enableDynamicPayloads() { if (this.c) this.st().dyn = true; } disableDynamicPayloads() { if (this.c) this.st().dyn = false; }
    getDynamicPayloadSize() { const m = this.c && this.st().rx[0]; return m ? m.len : 0; }
    startListening() { if (this.c) { this.st().listening = true; this.st().ver++; } }
    stopListening() { if (this.c) { this.st().listening = false; this.st().ver++; } }
    powerUp() { if (this.c) this.st().on = true; } powerDown() { if (this.c) this.st().on = false; }
    flush_rx() { if (this.c) this.st().rx = []; }
    testCarrier() { return false; } testRPD() { return false; }
    write(buf, len) {
      if (!this.ready('write')) return new Wait(0, false);
      const st = this.st();
      if (st.listening) { warn(tl('radio.write() pendant l’écoute : appelez radio.stopListening() avant d’émettre')); return new Wait(0, false); }
      if (!st.tx) { warn(tl('radio.write() sans adresse : appelez radio.openWritingPipe(adresse) dans setup()')); return new Wait(0, false); }
      const n = len == null ? refSize(buf) : len | 0;
      // Une String est un objet (adresse et longueur du texte) : la radio enverrait ces octets-là, pas le texte.
      if (isRef(buf) && buf.d.k === 'S') { warn(tl('radio.write(&texte, …) : une String n’est pas un tableau d’octets, la radio enverrait son adresse en mémoire. Utilisez un tableau de char : char texte[32]')); buf = null; }
      if (n > 32) warn(tl('radio.write() : {0} octets, mais un message nRF24 en contient au plus 32 (le reste est perdu)', n));
      if (isRef(buf) && n > refSize(buf)) warn(tl('radio.write() : {0} octets demandés, mais la variable n’en contient que {1}', n, refSize(buf)));
      const data = refBytes(buf, Math.min(n, 32)), payload = st.dyn ? data : data.concat(new Array(Math.max(0, st.payload - data.length)).fill(0)).slice(0, st.payload);
      let acked = false;
      for (const p of hw.peers ? hw.peers(['nrf24']) : []) {
        const o = p.comp.periph;
        if (p.comp === this.c || !p.ok || !o || !o.on || !o.listening || o.channel !== st.channel || o.rate !== st.rate) continue;
        const pipe = o.pipes.findIndex(a => a === st.tx);
        if (pipe < 0 || o.rx.length >= 3) continue; // file pleine : pas d'accusé de réception
        o.rx.push({ pipe, bytes: payload, len: data.length }); o.got = (o.got || 0) + 1; o.ver++;
        acked = true;
      }
      st.sent = (st.sent || 0) + 1; st.ver++;
      // Sans accusé de réception, la puce réessaie 15 fois avant d'abandonner (quelques millisecondes).
      return new Wait(acked || !st.ack ? 0.5 : 5, acked || !st.ack);
    }
    available(pipe) {
      if (!this.c || !this.up) return false;
      const m = this.st().rx[0];
      if (m) refSet(pipe, m.pipe);
      return !!m;
    }
    read(buf, len) {
      if (!this.ready('read')) return;
      const st = this.st(), m = st.rx.shift();
      if (!m) { warn(tl('radio.read() sans message : vérifiez d’abord radio.available()')); return; }
      st.ver++;
      const n = len == null ? refSize(buf) : len | 0;
      if (isRef(buf) && buf.d.k === 'S') { warn(tl('radio.read(&texte, …) : une String n’est pas un tableau d’octets. Recevez dans un tableau de char : char texte[32]')); return; }
      if (isRef(buf) && n > refSize(buf)) warn(tl('radio.read() : {0} octets demandés, mais la variable n’en contient que {1}', n, refSize(buf)));
      if (!refStore(buf, m.bytes, Math.min(n, st.dyn ? m.len : 32))) warn(tl('radio.read() : la variable qui reçoit le message ne peut pas être modifiée'));
    }
    printDetails() {
      const st = this.c && this.st(), S = $.O.Serial;
      if (!st || !this.up) { S.println('SPI Speedz\t= 10 Mhz\nSTATUS\t\t= 0x00'); return; }
      S.println(`STATUS\t\t= 0x0e RX_DR=0 TX_DS=0 MAX_RT=0 RX_P_NO=7 TX_FULL=0\nRX_ADDR_P0-1\t= 0x${st.pipes[0] || 'e7e7e7e7e7'} 0x${st.pipes[1] || 'c2c2c2c2c2'}\nTX_ADDR\t\t= 0x${st.tx || 'e7e7e7e7e7'}\nRF_CH\t\t= 0x${hex2(st.channel)}\nData Rate\t= ${['1 MBPS', '2 MBPS', '250 KBPS'][st.rate]}\nPA Power\t= ${['PA_MIN', 'PA_LOW', 'PA_HIGH', 'PA_MAX'][st.pa ?? 3]}`);
    }
    printPrettyDetails() { this.printDetails(); }
  }
  /* ---------- MPU6050 (bibliothèque I2Cdev) ---------- */
  // Valeurs brutes sur 16 bits : 16384 par g et 131 par °/s dans les plus petites plages, divisées par 2 à chaque plage au-dessus.
  class MPU6050 {
    constructor(addr = 0x68) { this.addr = addr; this.ar = 0; this.gr = 0; this.c = null; }
    initialize() { this.c = busDevice(['mpu6050'], this.addr, 'MPU6050'); }
    testConnection() { return !!(this.c || (this.c = busDevice(['mpu6050'], this.addr, 'MPU6050'))); }
    raw() {
      const d = this.c && hw.data(this.c), z = { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 };
      if (!d) { if (!this.c) warn(tl('MPU6050 : mpu.initialize() n’a pas été appelé, ou le module ne répond pas')); return z; }
      const A = 16384 / 2 ** this.ar, G = 131 / 2 ** this.gr * 180 / Math.PI, i16 = v => clamp(Math.round(v || 0), -32768, 32767);
      return { ax: i16(d.ax * A), ay: i16(d.ay * A), az: i16(d.az * A), gx: i16(d.gx * G), gy: i16(d.gy * G), gz: i16(d.gz * G) };
    }
    getAcceleration(x, y, z) { const r = this.raw(); refSet(x, r.ax); refSet(y, r.ay); refSet(z, r.az); }
    getRotation(x, y, z) { const r = this.raw(); refSet(x, r.gx); refSet(y, r.gy); refSet(z, r.gz); }
    getMotion6(ax, ay, az, gx, gy, gz) { this.getAcceleration(ax, ay, az); this.getRotation(gx, gy, gz); }
    getAccelerationX() { return this.raw().ax; } getAccelerationY() { return this.raw().ay; } getAccelerationZ() { return this.raw().az; }
    getRotationX() { return this.raw().gx; } getRotationY() { return this.raw().gy; } getRotationZ() { return this.raw().gz; }
    getTemperature() { const d = this.c && hw.data(this.c); return d ? Math.round((d.temp - 36.53) * 340) : 0; }
    setFullScaleAccelRange(r) { this.ar = clamp(r | 0, 0, 3); } getFullScaleAccelRange() { return this.ar; }
    setFullScaleGyroRange(r) { this.gr = clamp(r | 0, 0, 3); } getFullScaleGyroRange() { return this.gr; }
    setSleepEnabled() {}
  }

  /* ---------- Mémoires qui survivent au redémarrage : EEPROM, Preferences ---------- */
  // Rangées avec le projet (prog.mem de la carte) : elles survivent à un nouveau téléversement, à l'arrêt de la simulation
  // et à l'enregistrement. Une EEPROM neuve contient 0xFF partout. Sur l'Uno et le Nano, chaque write() est aussitôt en
  // mémoire ; sur l'ESP32, l'ESP8266 et le Pico, l'EEPROM est émulée en flash : begin(taille), puis commit() pour garder.
  const memSt = () => (hw.mem ? hw.mem() : (hw._mem || (hw._mem = { ee: '', prefs: {} })));
  const FLASH = !avr;
  let memDirty = false;
  class EEPROMClass {
    constructor() { this.store = null; this.ram = null; this.size = FLASH ? 0 : avr.ee; this.w0 = 0; this.wn = 0; }
    flash() {
      if (!this.store) {
        const hex = memSt().ee || '', cap = FLASH ? 4096 : 1024;
        this.store = new Array(cap).fill(255);
        for (let i = 0; i < Math.min(cap, hex.length >> 1); i++) this.store[i] = parseInt(hex.substr(2 * i, 2), 16) & 255;
      }
      return this.store;
    }
    buf() { return FLASH ? this.ram : this.flash(); }
    begin(n) {
      if (!FLASH) return true;
      if ((n | 0) > 4096) warn(tl('EEPROM.begin({0}) : l’EEPROM émulée de {1} fait au plus 4096 octets', n, hw.label));
      this.size = clamp(n | 0, 0, 4096); this.ram = this.flash().slice(0, this.size);
      return this.size > 0;
    }
    ok(a, what, n = 1) {
      if (FLASH && !this.ram) { warn(tl('EEPROM.{0}() avant EEPROM.begin(taille) : sur {1}, l’EEPROM est émulée dans la mémoire flash', what, hw.label)); return false; }
      if (!(a >= 0 && a + n <= this.length())) { warn(tl('EEPROM.{0}({1}) : adresse hors de la mémoire (0 à {2})', what, a, this.length() - 1)); return false; }
      return true;
    }
    /** Chaque case supporte environ 100 000 écritures : prévenir un programme qui écrit sans arrêt. */
    wear() {
      if (vt - this.w0 > 1000) { if (this.wn > 50) warn(tl('EEPROM écrite {0} fois en une seconde : chaque case ne supporte qu’environ 100 000 écritures. Écrivez seulement quand la valeur change (EEPROM.update())', this.wn)); this.w0 = vt; this.wn = 0; }
      this.wn++;
    }
    set(a, v) { const b = this.buf(); if (!FLASH) { this.wear(); memDirty = true; } b[a] = v & 255; }
    read(a) { return this.ok(a, 'read') ? this.buf()[a | 0] : FLASH ? 0 : 255; }
    write(a, v) { if (this.ok(a, 'write')) this.set(a | 0, v); }
    update(a, v) { if (this.ok(a, 'update') && this.buf()[a | 0] !== (v & 255)) this.set(a | 0, v); }
    get(a, r) {
      const n = refSize(r);
      if (!this.ok(a, 'get', n)) return isRef(r) ? r.get() : 0;
      if (isRef(r) && r.d.k === 'S') { warn(tl('EEPROM.get() dans une String : utilisez un tableau de char (char texte[20])')); return r.get(); }
      refStore(r, this.buf().slice(a, a + n), n);
      return isRef(r) ? r.get() : 0;
    }
    put(a, r) {
      if (isRef(r) && r.d.k === 'S') { warn(tl('EEPROM.put() d’une String enregistre l’objet, pas le texte : utilisez un tableau de char (char texte[20])')); return r.get(); }
      const bytes = refBytes(r);
      if (!this.ok(a, 'put', bytes.length)) return isRef(r) ? r.get() : r;
      bytes.forEach((x, i) => { if (this.buf()[a + i] !== x) this.set(a + i, x); }); // comme update() : seules les cases changées
      return isRef(r) ? r.get() : r;
    }
    length() { return FLASH ? this.size : 1024; }
    commit() {
      if (!FLASH) return true;
      if (!this.ram) { warn(tl('EEPROM.commit() avant EEPROM.begin(taille)')); return false; }
      const f = this.flash(); this.ram.forEach((x, i) => { f[i] = x; });
      this.wear(); memDirty = true; return true;
    }
    end() { if (FLASH && this.ram) { this.commit(); this.ram = null; this.size = 0; } }
    /** Contenu gardé avec le projet : hexadécimal, sans les 0xFF de la fin. */
    save() { if (this.store) memSt().ee = this.store.map(hex2).join('').replace(/(FF)+$/, '').toLowerCase(); }
  }
  /** Preferences (ESP32) : clés typées rangées par espace de noms (15 caractères au plus), écrites aussitôt. */
  class Preferences {
    constructor() { this.ns = null; this.ro = false; }
    space() { return this.ns ? memSt().prefs[this.ns] : null; }
    begin(ns, ro = false) {
      const s = String(ns ?? '');
      if (!s || s.length > 15) { warn(tl('prefs.begin("{0}") : le nom de l’espace fait de 1 à 15 caractères', s)); return false; }
      const p = memSt().prefs;
      if (!p[s]) { if (ro) return false; p[s] = {}; memDirty = true; }
      this.ns = s; this.ro = !!ro;
      return true;
    }
    end() { this.ns = null; }
    put(key, t, v, size) {
      const sp = this.space(), k = String(key ?? '');
      if (!sp) { warn(tl('Preferences : prefs.begin("espace") n’a pas été appelé')); return 0; }
      if (this.ro) { warn(tl('Preferences ouvert en lecture seule (begin(…, true)) : « {0} » n’est pas enregistré', k)); return 0; }
      if (!k || k.length > 15) { warn(tl('Preferences : la clé « {0} » doit faire de 1 à 15 caractères', k)); return 0; }
      sp[k] = [t, v]; memDirty = true;
      return size;
    }
    /** Valeur d'une clé, ou la valeur par défaut si elle n'existe pas ou n'a pas été écrite avec ce type. */
    get(key, t, def) {
      const sp = this.space(); if (!sp) { warn(tl('Preferences : prefs.begin("espace") n’a pas été appelé')); return def; }
      const e = sp[String(key)];
      return e && e[0] === t ? e[1] : def;
    }
    putInt(k, v) { return this.put(k, 'i', v | 0, 4); } putUInt(k, v) { return this.put(k, 'u', v >>> 0, 4); }
    putLong(k, v) { return this.put(k, 'l', v | 0, 4); } putULong(k, v) { return this.put(k, 'ul', v >>> 0, 4); }
    putShort(k, v) { return this.put(k, 's', (v << 16) >> 16, 2); } putUShort(k, v) { return this.put(k, 'us', v & 65535, 2); }
    putChar(k, v) { return this.put(k, 'c', (v << 24) >> 24, 1); } putUChar(k, v) { return this.put(k, 'uc', v & 255, 1); }
    putFloat(k, v) { return this.put(k, 'f', Math.fround(+v || 0), 4); } putDouble(k, v) { return this.put(k, 'd', +v || 0, 8); }
    putBool(k, v) { return this.put(k, 'b', !!v, 1); } putString(k, v) { const s = fmt(v); return this.put(k, 'S', s, s.length); }
    putBytes(k, r, n) { const b = refBytes(r, n); return this.put(k, 'B', b, b.length); }
    getInt(k, d = 0) { return this.get(k, 'i', d); } getUInt(k, d = 0) { return this.get(k, 'u', d); }
    getLong(k, d = 0) { return this.get(k, 'l', d); } getULong(k, d = 0) { return this.get(k, 'ul', d); }
    getShort(k, d = 0) { return this.get(k, 's', d); } getUShort(k, d = 0) { return this.get(k, 'us', d); }
    getChar(k, d = 0) { return this.get(k, 'c', d); } getUChar(k, d = 0) { return this.get(k, 'uc', d); }
    getFloat(k, d = 0) { return this.get(k, 'f', d); } getDouble(k, d = 0) { return this.get(k, 'd', d); }
    getBool(k, d = false) { return this.get(k, 'b', d); } getString(k, d = '') { return this.get(k, 'S', fmt(d)); }
    getBytesLength(k) { const b = this.get(k, 'B', null); return b ? b.length : 0; }
    getBytes(k, r, n) { const b = this.get(k, 'B', null); if (!b) return 0; const m = Math.min(b.length, n ?? b.length); refStore(r, b, m); return m; }
    isKey(k) { const sp = this.space(); return !!sp && Object.prototype.hasOwnProperty.call(sp, String(k)); }
    remove(k) { const sp = this.space(); if (!sp || this.ro || !this.isKey(k)) return false; delete sp[String(k)]; memDirty = true; return true; }
    clear() { const sp = this.space(); if (!sp || this.ro) return false; for (const k of Object.keys(sp)) delete sp[k]; memDirty = true; return true; }
    freeEntries() { const sp = this.space(); return Math.max(0, 500 - (sp ? Object.keys(sp).length : 0)); }
  }
  const flushMem = () => { memDirty = false; $.O.EEPROM.save(); if (hw.memChanged) hw.memChanged(); };

  /* ---------- Bluetooth de l'ESP32 (BluetoothSerial) ---------- */
  const me = hw.self ? hw.self() : (hw._self || (hw._self = { id: hw.label, type: hw.kind, name: hw.label }));
  class BluetoothSerial extends HardwareSerial {
    constructor() { super(''); this.label = 'SerialBT'; this.bt = null; }
    /** Le téléphone du panneau « Périphériques » se connecte à ce nom et la conversation s'ouvre. */
    begin(name = 'ESP32') {
      this.bt = btSerial(me); this.bt.st.name = fmt(name).slice(0, 32) || 'ESP32'; this.bt.st.on = true; this.bt.st.ver++;
      this.baud = 1; return true;
    }
    end() { if (this.bt) { this.bt.st.on = false; this.bt.st.ver++; } this.bt = null; this.baud = 0; }
    connected() { return !!this.bt; } hasClient() { return !!this.bt; } setPin() { return true; } disconnect() { return true; }
    emit(s) { if (!this.bt) { warn(tl('SerialBT.begin("Nom") n’a pas été appelé : rien n’est envoyé en Bluetooth')); return; } this.bt.fromBoard(s); }
    pull() { if (this.bt) { const s = this.bt.take(); if (s) this.rx = (this.rx + s).slice(-4096); } return this.rx; }
  }

  /* ---------- Wi-Fi (bac à sable) ---------- */
  // Les réseaux sont ceux de la carte « Réseau Wi-Fi » (projet) et les points d'accès ouverts par les cartes (softAP).
  // La connexion aboutit (ou échoue) 2 s après WiFi.begin(), en temps simulé. Aucun accès au vrai réseau.
  const net = () => (hw.net ? hw.net() : (hw._net || (hw._net = NET_DEFAULT())));
  const myMac = macOf(me);
  const peerBoards = () => (hw.peers ? hw.peers(['esp32', 'esp32-38', 'esp32s3', 'esp32c3', 'nodemcu', 'd1mini']).map(p => p.comp) : []);
  class IPAddress {
    constructor(a, b, c, d) { this.s = a instanceof IPAddress ? a.s : typeof a === 'string' ? a : b === undefined ? (a == null ? '0.0.0.0' : [a & 255, (a >>> 8) & 255, (a >>> 16) & 255, (a >>> 24) & 255].join('.')) : [a, b, c, d].map(x => (x | 0) & 255).join('.'); }
    toString() { return this.s; }
    fromString(t) { if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(t))) return false; this.s = String(t); return true; }
  }
  /** Réseaux visibles : ceux du projet et les points d'accès des autres cartes. */
  const networks = () => [...net().networks, ...peerBoards().filter(b => b !== me && b.periph && b.periph.wifi && b.periph.wifi.ap).map(b => ({ ssid: b.periph.wifi.ap.ssid, pass: b.periph.wifi.ap.pass, rssi: -40, ap: b }))];
  class WiFiClass {
    constructor() { this.scan = []; this.host = `esp32-${myMac.slice(-5).replace(':', '')}`; this.last = null; }
    s() { const st = periph(me); return st.wifi || (st.wifi = { mode: 0, status: 0, ssid: '', ip: '', gw: '', mac: myMac, t0: 0, want: null, ap: null, fixed: null, rssi: 0 }); }
    /** Adresse donnée par le routeur : 192.168.1.x (192.168.4.x sur le point d'accès d'une carte), jamais celle d'une autre carte. */
    lease(n) {
      if (this.s().fixed) return this.s().fixed;
      const base = n.ap ? '192.168.4.' : '192.168.1.', used = new Set(peerBoards().filter(b => b !== me && b.periph && b.periph.wifi).map(b => b.periph.wifi.ip));
      let x = (n.ap ? 2 : 100) + (hashBytes(me.id, 1)[0] % 100);
      while (used.has(base + x)) x++;
      return base + x;
    }
    update() {
      const w = this.s();
      if (w.want && vt - w.t0 >= 2000) {
        const want = w.want, n = networks().find(x => x.ssid === want.ssid);
        w.want = null; w.tried = want.ssid;
        if (!n) { w.status = 1; warn(tl('WiFi.begin("{0}") : aucun réseau de ce nom. Réseaux visibles : {1}', want.ssid, networks().map(x => x.ssid).join(', '))); }
        else if (n.pass && n.pass !== want.pass) { w.status = 4; warn(tl('WiFi.begin("{0}", …) : mot de passe refusé par le réseau', want.ssid)); }
        else { w.status = 3; w.ssid = n.ssid; w.rssi = n.rssi; w.ip = this.lease(n); w.gw = n.ap ? '192.168.4.1' : '192.168.1.1'; }
        periph(me).ver++;
      }
      // Réseau renommé ou supprimé (carte « Réseau Wi-Fi ») : la connexion est perdue.
      if (w.status === 3 && !networks().some(x => x.ssid === w.ssid)) { w.status = 5; w.ip = ''; periph(me).ver++; }
      return w;
    }
    mode(m) { const w = this.s(); w.mode = m | 0; if (!(w.mode & 2)) w.ap = null; periph(me).ver++; return true; }
    getMode() { return this.s().mode; }
    begin(ssid, pass) {
      const w = this.s();
      if (ssid === undefined) { if (!this.last) return w.status; [ssid, pass] = this.last; }
      if (!(w.mode & 1)) w.mode |= 1;
      this.last = [fmt(ssid), pass == null ? '' : fmt(pass)];
      Object.assign(w, { want: { ssid: this.last[0], pass: this.last[1] }, t0: vt, status: 6, ip: '', ssid: '' });
      periph(me).ver++;
      return w.status;
    }
    status() { return this.update().status; }
    isConnected() { return this.status() === 3; }
    disconnect() { const w = this.s(); Object.assign(w, { want: null, status: 6, ip: '', ssid: '' }); periph(me).ver++; return true; }
    reconnect() { if (!this.last) return false; this.begin(...this.last); return true; }
    localIP() { const w = this.update(); return new IPAddress(w.status === 3 ? w.ip : '0.0.0.0'); }
    gatewayIP() { const w = this.update(); return new IPAddress(w.status === 3 ? w.gw : '0.0.0.0'); }
    subnetMask() { return new IPAddress(this.update().status === 3 ? '255.255.255.0' : '0.0.0.0'); }
    dnsIP() { return this.gatewayIP(); }
    macAddress(a) { if (Array.isArray(a)) myMac.split(':').forEach((h, i) => { a[i] = parseInt(h, 16); }); return myMac; }
    softAPmacAddress() { return myMac.replace(/^(..)/, m => hex2(parseInt(m, 16) + 1)); }
    RSSI(i) { if (i !== undefined) return this.scan[i] ? this.scan[i].rssi : 0; const w = this.update(); return w.status === 3 ? w.rssi - Math.round(rnd() * 3) : 0; }
    SSID(i) { if (i !== undefined) return this.scan[i] ? this.scan[i].ssid : ''; return this.update().status === 3 ? this.s().ssid : ''; }
    BSSIDstr(i) { const n = i !== undefined ? this.scan[i] : this.s(); return n ? `A4:2B:B0:${hashBytes(n.ssid, 3).map(hex2).join(':')}` : ''; }
    channel(i) { const n = i !== undefined ? this.scan[i] : this.s(); return n && n.ssid ? 1 + (hashBytes(n.ssid, 1)[0] % 3) * 5 : 0; }
    encryptionType(i) { const n = this.scan[i]; if (!n) return 0; return hw.kind === 'nodemcu' ? (n.pass ? 4 : 7) : n.pass ? 3 : 0; }
    /** Recherche des réseaux (bloque environ 1,5 s, comme sur la carte), du plus fort au plus faible. */
    scanNetworks() {
      if (!this.s().mode) this.s().mode = 1;
      this.scan = networks().map(n => ({ ssid: n.ssid, pass: n.pass, rssi: n.rssi - Math.round(rnd() * 4) })).sort((a, b) => b.rssi - a.rssi);
      return new Wait(1500, this.scan.length);
    }
    scanDelete() { this.scan = []; }
    softAP(ssid, pass = '') {
      const p = pass == null ? '' : fmt(pass);
      if (p && p.length < 8) { warn(tl('WiFi.softAP() : le mot de passe doit faire au moins 8 caractères (ou aucun pour un réseau ouvert)')); return false; }
      const w = this.s(); w.mode |= 2; w.ap = { ssid: fmt(ssid), pass: p, ip: '192.168.4.1' }; periph(me).ver++;
      return true;
    }
    softAPIP() { return new IPAddress(this.s().ap ? '192.168.4.1' : '0.0.0.0'); }
    softAPdisconnect() { const w = this.s(); w.ap = null; w.mode &= 1; periph(me).ver++; return true; }
    softAPgetStationNum() { return peerBoards().filter(b => b !== me && b.periph && b.periph.wifi && b.periph.wifi.status === 3 && b.periph.wifi.ip.startsWith('192.168.4.') && this.s().ap && b.periph.wifi.ssid === this.s().ap.ssid).length; }
    config(ip) { this.s().fixed = ip ? String(ip) : null; return true; }
    setHostname(h) { this.host = fmt(h); return true; } getHostname() { return this.host; } hostname(h) { if (h !== undefined) this.host = fmt(h); return this.host; }
    setAutoReconnect() { return true; } persistent() {} setSleep() { return true; }
  }
  /** Adresses où la carte est joignable : sur le réseau (Wi-Fi connecté), son point d'accès, son nom mDNS. */
  const addrsOf = b => {
    const w = b.periph && b.periph.wifi, out = [];
    if (w && w.status === 3 && w.ip) out.push(w.ip);
    if (w && w.ap) out.push('192.168.4.1');
    if (b.periph && b.periph.mdns) out.push(b.periph.mdns + '.local');
    return out;
  };
  const online = () => { const w = periph(me).wifi; return !!w && ((w.status === 3 && !!w.ip) || !!w.ap); };
  class MDNSResponder {
    begin(name) { if (!online()) warn(tl('MDNS.begin() : la carte n’est pas encore connectée au Wi-Fi')); periph(me).mdns = fmt(name).toLowerCase(); return true; }
    end() { periph(me).mdns = null; } addService() {} update() {}
  }

  /* ---------- Serveur web ---------- */
  // Le « Navigateur » du panneau Périphériques (ou le client HTTP d'une autre carte) dépose une requête dans la file du
  // serveur. Elle n'est traitée qu'au prochain server.handleClient() : un programme qui ne l'appelle pas ne répond jamais.
  let reqId = 0;
  /** Requête vers le serveur d'une carte : méthode (HTTP_GET 1, HTTP_POST 3), chemin, champs, corps. */
  const newReq = (method, path, args, body, from) => ({ id: ++reqId, method, path, args, body: body || '', from, state: 'pending', resp: null, at: Date.now() });
  class WebServer {
    constructor(port = 80) { this.port = port | 0; this.routes = []; this.nf = null; this.cur = null; this.st = null; }
    on(path, a, b) { const [method, fn] = b === undefined ? [0, a] : [a | 0, b]; this.routes.push({ path: fmt(path), method, fn }); }
    onNotFound(fn) { this.nf = fn; }
    begin(port) {
      if (port) this.port = port | 0;
      const st = periph(me);
      st.web = { port: this.port, queue: [], on: true }; st.ver++; this.st = st.web;
      if (!online()) warn(tl('server.begin() : la carte n’est connectée à aucun réseau Wi-Fi (ni point d’accès) : personne ne peut joindre le serveur'));
    }
    close() { if (this.st) this.st.on = false; } stop() { this.close(); }
    handleClient() {
      const q = this.st && this.st.on ? this.st.queue : null;
      if (!q || !q.length) return undefined;
      const req = q.shift();
      if (req.state !== 'pending') return undefined;
      req.state = 'running';
      return this.serve(req);
    }
    *serve(req) {
      this.cur = { req, headers: [] };
      const r = this.routes.find(x => x.path === req.path && (!x.method || x.method === req.method)), fn = r ? r.fn : this.nf;
      try {
        if (fn) yield* fn();
        else this.send(404, 'text/plain', `Not found: ${req.path}`);
      } finally {
        this.cur = null;
        if (!req.resp) { warn(tl('Le gestionnaire de {0} n’a rien répondu : appelez server.send(…)', req.path)); req.resp = { code: 0, type: '', body: '', headers: [] }; }
        req.state = 'done';
      }
    }
    send(code, type = 'text/html', body = '') {
      const c = this.cur;
      if (!c) { warn(tl('server.send() en dehors d’un gestionnaire de requête (server.on)')); return; }
      c.req.resp = { code: code | 0, type: fmt(type), body: fmt(body).slice(0, 200000), headers: c.headers.slice() };
    }
    send_P(code, type, body) { this.send(code, type, body); }
    sendHeader(name, value) { if (this.cur) this.cur.headers.push([fmt(name), fmt(value)]); }
    setContentLength() {}
    sendContent(s) { const c = this.cur; if (!c) return; if (!c.req.resp) c.req.resp = { code: 200, type: 'text/html', body: '', headers: c.headers.slice() }; c.req.resp.body = (c.req.resp.body + fmt(s)).slice(0, 200000); }
    req() { if (!this.cur) warn(tl('server.arg() en dehors d’un gestionnaire de requête (server.on)')); return this.cur ? this.cur.req : { args: [], path: '', method: 0, body: '' }; }
    arg(k) { const q = this.req(); if (typeof k === 'number') return q.args[k] ? q.args[k][1] : ''; if (k === 'plain') return q.body; const a = q.args.find(x => x[0] === fmt(k)); return a ? a[1] : ''; }
    argName(i) { const a = this.req().args[i]; return a ? a[0] : ''; }
    args() { return this.req().args.length; }
    hasArg(k) { const q = this.req(); return fmt(k) === 'plain' ? !!q.body : q.args.some(x => x[0] === fmt(k)); }
    uri() { return this.req().path; } method() { return this.req().method; }
    header() { return ''; } hasHeader() { return false; }
  }
  /** Serveur web d'une carte du montage joignable à cette adresse et ce port. */
  const serverAt = (host, port) => peerBoards().find(b => b.periph && b.periph.web && b.periph.web.on && b.periph.web.port === port && addrsOf(b).includes(host));

  /* ---------- Client HTTP ---------- */
  const HTTP_ERR = { '-1': 'connection refused', '-2': 'send header failed', '-3': 'send payload failed', '-4': 'not connected', '-5': 'connection lost', '-6': 'no stream', '-7': 'no HTTP server', '-8': 'too less ram', '-9': 'Transfer-Encoding not supported', '-10': 'Stream write error', '-11': 'read Timeout' };
  class HTTPClient {
    constructor() { this.u = null; this.resp = null; this.timeout = 5000; this.hdr = []; }
    /** begin(adresse) ou begin(client, adresse). */
    begin(a, b) {
      const url = typeof a === 'string' ? a : b;
      this.u = parseUrl(url); this.resp = null; this.hdr = [];
      if (!this.u) { warn(tl('http.begin("{0}") : adresse invalide, elle doit commencer par http://', fmt(url))); return false; }
      return true;
    }
    addHeader(n, v) { this.hdr.push([fmt(n), fmt(v)]); }
    setTimeout(ms) { this.timeout = Math.max(0, +ms || 0); } setConnectTimeout() {}
    GET() { return this.send('GET', ''); } POST(body) { return this.send('POST', fmt(body)); } PUT(body) { return this.send('PUT', fmt(body)); }
    send(method, body) {
      this.resp = null;
      if (!this.u) { warn(tl('http.{0}() sans http.begin(adresse)', method)); return new Wait(0, -1); }
      const w = periph(me).wifi;
      if (!w || w.status !== 3) { warn(tl('http.{0}() : la carte n’est pas connectée au Wi-Fi (WiFi.status() doit valoir WL_CONNECTED)', method)); return new Wait(0, -1); }
      const u = this.u;
      if (u.scheme === 'https' && FAKE_HOSTS.includes(u.host)) { warn(tl('{0} répond en http://, pas en https://', u.host)); return new Wait(100, -1); }
      const fake = u.scheme === 'http' ? fakeHttp(method, u, body, net()) : null;
      if (fake) {
        if (u.host === 'journal.jollof' && hw.netChanged) hw.netChanged();
        return new Wait(120, (this.resp = fake).code);
      }
      // Serveur web d'une carte du montage (ou de celle-ci : elle ne peut pas se répondre pendant qu'elle attend).
      const b = u.scheme === 'http' && serverAt(u.host, u.port);
      if (b) {
        const fields = parseQuery(u.query).concat(method === 'POST' && !/json/i.test((this.hdr.find(h => /content-type/i.test(h[0])) || [])[1] || '') ? parseQuery(body) : []);
        const req = newReq(method === 'POST' ? 3 : method === 'PUT' ? 4 : 1, u.path, fields, body, hw.label), end = vt + this.timeout;
        b.periph.web.queue.push(req);
        return new Poll(() => {
          if (req.state === 'done') { this.resp = req.resp; return req.resp.code || -5; }
          if (vt >= end) { req.state = 'expired'; return -11; }
          return 0;
        });
      }
      warn(tl('{0} : le bac à sable n’a pas accès à Internet. Seuls répondent meteo.jollof, journal.jollof, heure.jollof et les serveurs web des cartes du montage', u.host));
      return new Wait(200, -1);
    }
    getString() { return this.resp ? this.resp.body : ''; }
    getSize() { return this.resp ? this.resp.body.length : -1; }
    errorToString(c) { return HTTP_ERR[String(c)] || ''; }
    connected() { return false; }
    end() { this.u = null; }
  }
  /** WiFiClient : seulement pour http.begin(client, adresse) ; les connexions directes ne sont pas simulées. */
  class WiFiClient {
    connect() { warn(tl('client.connect() : les connexions directes (sockets) ne sont pas simulées, utilisez HTTPClient')); return 0; }
    stop() {} connected() { return 0; } available() { return 0; } read() { return -1; }
    print(x, f, tag) { return fmt(x, f, tag).length; } println(x, f, tag) { return fmt(x, f, tag).length + 2; } write() { return 1; }
  }

  /* ---------- ESP-NOW ---------- */
  // Messages directs entre cartes (250 octets au plus), sans point d'accès : la carte dont WiFi.macAddress() est l'adresse
  // visée les reçoit (FF:FF:FF:FF:FF:FF : toutes). Les rappels s'exécutent comme des interruptions, entre deux instructions.
  const cbq = [];
  const later = (fn, args) => { if (typeof fn === 'function') cbq.push({ fn, args }); };
  const now = () => { const st = periph(me); return st.now || (st.now = { init: false, peers: [], rx: [], sendCb: null, recvCb: null }); };
  const macStr = a => (Array.isArray(a) ? a.slice(0, 6).map(hex2).join(':') : '');
  const macBytes = s => s.split(':').map(h => parseInt(h, 16));
  /** Messages reçus par ESP-NOW : le rappel enregistré par esp_now_register_recv_cb() s'exécute pour chacun. */
  const pollCb = () => {
    const st = periph(me).now;
    if (!st || !st.rx.length) return;
    for (const m of st.rx.splice(0)) {
      if (!st.recvCb) continue;
      // Premier argument : l'adresse de l'émetteur (rappel « mac, données, longueur »), qui sert aussi d'esp_now_recv_info_t (info->src_addr).
      const mac = m.mac.slice(); mac.src_addr = m.mac.slice(); mac.des_addr = macBytes(myMac);
      later(st.recvCb, [mac, m.data.slice(), m.data.length]);
    }
  };
  Object.assign($, {
    esp_now_init() {
      const w = periph(me).wifi;
      if (!w || !w.mode) { warn(tl('esp_now_init() avant WiFi.mode(WIFI_STA) : le Wi-Fi doit être démarré')); return 0x3001; }
      now().init = true; return 0;
    },
    esp_now_deinit() { const st = now(); st.init = false; st.peers = []; return 0; },
    /** ESP32 : esp_now_add_peer(&infos) ; ESP8266 : esp_now_add_peer(adresse, rôle, canal, clé, taille). */
    esp_now_add_peer(p) {
      const st = now(); if (!st.init) { warn(tl('esp_now_add_peer() avant esp_now_init()')); return 0x3065; }
      const a = Array.isArray(p) ? p : p && Array.isArray(p.peer_addr) ? p.peer_addr : null, s = macStr(a);
      if (!a || s.length !== 17) return 0x3066;
      if (st.peers.includes(s)) return 0x306a;
      st.peers.push(s); return 0;
    },
    esp_now_del_peer(a) { const st = now(), s = macStr(a), i = st.peers.indexOf(s); if (i < 0) return 0x3069; st.peers.splice(i, 1); return 0; },
    esp_now_is_peer_exist(a) { return now().peers.includes(macStr(a)); },
    esp_now_register_send_cb(fn) { now().sendCb = fn; return 0; },
    esp_now_register_recv_cb(fn) { now().recvCb = fn; return 0; },
    esp_now_unregister_send_cb() { now().sendCb = null; return 0; },
    esp_now_unregister_recv_cb() { now().recvCb = null; return 0; },
    esp_now_set_self_role() { return 0; },
    esp_now_recv_cb_t: f => f, esp_now_send_cb_t: f => f,
    esp_now_send(a, data, len) {
      const st = now(); if (!st.init) { warn(tl('esp_now_send() avant esp_now_init()')); return 0x3065; }
      const n = len == null ? refSize(data) : len | 0;
      if (n > 250 || n < 1) { warn(tl('esp_now_send() : {0} octets, un message ESP-NOW en contient de 1 à 250', n)); return 0x3066; }
      const bytes = refBytes(data, n), dests = Array.isArray(a) ? [macStr(a)] : st.peers.slice();
      if (Array.isArray(a) && !st.peers.includes(dests[0])) { warn(tl('esp_now_send() vers {0} : ajoutez d’abord ce pair avec esp_now_add_peer()', dests[0])); return 0x3069; }
      for (const to of dests) {
        let got = false;
        for (const b of peerBoards()) {
          if (b === me || !b.periph || !b.periph.now || !b.periph.now.init) continue;
          if (to === 'FF:FF:FF:FF:FF:FF' || macOf(b) === to) { b.periph.now.rx.push({ mac: macBytes(myMac), data: bytes }); got = true; if (b.periph.now.rx.length > 20) b.periph.now.rx.shift(); }
        }
        // Rappel d'envoi : réussi si un destinataire a accusé réception (toujours pour la diffusion).
        const mac = macBytes(to); mac.des_addr = mac.slice();
        later(st.sendCb, [mac, got || to === 'FF:FF:FF:FF:FF:FF' ? 0 : 1]);
      }
      return 0;
    },
    /** memcpy(&destination, source, n) : copie octet par octet (ESP-NOW : données reçues → variable). */
    memcpy(dst, src, n) { if (!refStore(dst, refBytes(src, n), n)) warn(tl('memcpy() : la destination ne peut pas être modifiée')); },
    memset(dst, v, n) { refStore(dst, new Array(Math.max(0, n | 0)).fill(v & 255), n); }
  });
  $.C = {
    HardwareSerial, SoftwareSerial, DHT, OneWire, DallasTemperature, Adafruit_BMP280, Adafruit_BME280, BH1750, HX711, Adafruit_MPU6050, LiquidCrystal_I2C, Adafruit_SSD1306, Servo, ESP32PWM,
    Adafruit_NeoPixel, Stepper, IRrecv, decode_results, MFRC522, Uid, MIFARE_Key, Keypad, RF24, MPU6050, EEPROMClass, Preferences, BluetoothSerial,
    WiFiClass, IPAddress, MDNSResponder, WebServer, ESP8266WebServer: WebServer, HTTPClient, WiFiClient,
    esp_now_peer_info_t: class { constructor() { this.peer_addr = new Array(6).fill(0); this.channel = 0; this.encrypt = false; this.ifidx = 0; } },
    esp_now_recv_info_t: class { constructor() { this.src_addr = new Array(6).fill(0); this.des_addr = new Array(6).fill(0); } },
    wifi_tx_info_t: class { constructor() { this.des_addr = new Array(6).fill(0); this.src_addr = new Array(6).fill(0); } }
  };
  $.O.IrReceiver = new IRrecv();
  $.O.EEPROM = new EEPROMClass(); $.O.WiFi = new WiFiClass(); $.O.MDNS = new MDNSResponder();

  /* ---------- Ordonnanceur ---------- */
  let mod, gen, pass = 0;
  try {
    mod = new Function('$', js)($);
    gen = (function* main() { yield* mod.init(); yield* mod.setup(); for (;;) { pass++; yield* mod.loop(); if (--$.b < 0) yield -1; } })();
  } catch (e) { state = 'error'; error = { line: 0, msg: tl('Programme impossible à charger : ') + e.message }; }

  const fault = e => {
    state = 'error';
    let msg = e instanceof RunError ? e.message : e instanceof RangeError && /call stack/i.test(e.message) ? tl('Trop d’appels de fonctions imbriqués (une fonction s’appelle-t-elle sans fin ?)') : tl('Erreur pendant l’exécution : ') + e.message;
    if (!(e instanceof RunError)) console.warn(e);
    error = { line: $.l, msg };
  };
  /**
   * Fonction du programme lancée hors du déroulement normal (interruption, rappel ESP-NOW), exécutée jusqu'au bout.
   * Le débogueur l'ignore : pas d'arrêt dedans ($.irq), appels non comptés. false si elle a planté.
   */
  const runCb = (fn, args = []) => {
    const line = $.l, saved = $.b, d = $.d, calls = $.n, g = fn(...args);
    let r, n = 0;
    $.irq++;
    try { do { $.b = 2000; r = g.next(); } while (!r.done && ++n < 200); } catch (e) { $.irq--; fault(e); return false; } finally { $.d = d; $.n = calls; }
    $.irq--;
    if (!r.done) warn(tl('Fonction d’interruption trop longue : elle ne doit contenir ni delay() ni longue boucle'));
    $.l = line; $.b = saved;
    return true;
  };
  /** Interruptions : un front sur la broche lance la fonction attachée, jusqu'au bout. Puis les rappels en attente. */
  const runIrq = () => {
    if (!irqOn) return;
    pollCb();
    while (cbq.length) { const c = cbq.shift(); if (!runCb(c.fn, c.args)) return; }
    for (const q of irqs) {
      // Module à impulsions : les fronts sont comptés exactement depuis le dernier passage (fréquence × temps),
      // quelle que soit la fréquence à laquelle le programme laisse la main.
      const r = input(q.k);
      if (r && r.hz > 0) {
        const a0 = q.acc || 0, a1 = a0 + (vt - (q.t ?? vt)) * r.hz / 500;
        q.t = vt; q.acc = a1;
        for (let n = Math.floor(a0) + 1, fired = 0; n <= Math.floor(a1) && fired < 4000; n++) {
          const up = n % 2 === 1;
          if (q.mode === 1 || ((q.mode === 2 || q.mode === 0) && !up) || (q.mode === 3 && up)) { fired++; if (!runCb(q.fn)) return; }
        }
        continue;
      }
      q.t = vt;
      const v = digitalIn(q.k), last = q.last; q.last = v;
      if (v === last) continue;
      // CHANGE (1) : tout front ; FALLING (2) ou LOW (0) : passage à 0 ; RISING (3) : passage à 1.
      if (q.mode === 1 || ((q.mode === 2 || q.mode === 0) && !v) || (q.mode === 3 && v)) { if (!runCb(q.fn)) return; }
    }
  };
  /* ---------- Débogueur ---------- */
  // Compilé en mode débogage, le programme consulte $.D(ligne) avant chaque instruction. $.D ne
  // vaut quelque chose qu'avec des points d'arrêt ou un pas à pas en cours : sinon le test coûte une
  // lecture de propriété. Un arrêt fige l'heure virtuelle de cette carte seulement.
  const hooks = (meta && meta.hooks) || null, gvars = (meta && meta.globals) || [];
  const dbg = { bps: new Set(), mode: null, d0: 0, pass0: 0, skip: null, at: null, cur: null, pos: null };
  function D(line) {
    if ($.irq) return false;
    const k = dbg.skip;
    // Après une reprise, le reste de la ligne passe (sauf si une fonction a été appelée entre-temps).
    if (k) { if (line === k.line && $.d === k.d && $.n === k.n) return false; dbg.skip = null; }
    const m = dbg.mode;
    if (m === 'pause' || m === 'into' || (m === 'over' && $.d <= dbg.d0)) return true;
    // Sortir de setup() ou de loop() : arrêt au début du tour de loop() suivant.
    if (m === 'out' && ($.d < dbg.d0 || (dbg.d0 <= 1 && pass !== dbg.pass0))) return true;
    return dbg.bps.has(line);
  }
  const syncD = () => { $.D = hooks && (dbg.mode || dbg.bps.size) ? D : null; };
  const fnAt = line => { const h = hooks && hooks.find(x => x.line === line); return h ? h.fn : ''; };
  /** Arrêt : à un point d'arrêt (y, rendu par le programme) ou tout de suite, là où en est la carte. */
  function halt(y) {
    const h = y && hooks ? hooks[y.h] : null;
    if (y || wake === null) wake = vt; // l'heure reprendra exactement là
    state = 'paused'; dbg.mode = null; dbg.skip = null; dbg.cur = h ? y : null; syncD();
    dbg.at = { line: h ? h.line : $.l, fn: h ? h.fn : fnAt($.l) };
    dbg.pos = { line: dbg.at.line, d: $.d, n: $.n, pass };
  }
  function go(mode) {
    const p = dbg.pos;
    dbg.mode = mode; dbg.d0 = p.d; dbg.pass0 = p.pass; dbg.skip = { line: p.line, d: p.d, n: p.n };
    dbg.cur = null; dbg.at = null; state = 'run'; syncD();
  }
  const debug = {
    get paused() { return state === 'paused'; },
    /** Ligne et fonction de l'arrêt : { line, fn }. */
    get at() { return state === 'paused' ? dbg.at : null; },
    /** Le programme a été compilé en mode débogage (arrêts possibles à chaque instruction). */
    get enabled() { return !!hooks; },
    pause() {
      if (state !== 'run') return;
      dbg.skip = null;
      // Sans arrêts possibles, ou endormie dans un delay() : arrêt immédiat, sur la ligne en cours.
      if (!hooks || (wake !== null && wake > T)) { halt(null); return; }
      dbg.mode = 'pause'; syncD();
    },
    resume() { if (state === 'paused') go(null); },
    /** into : instruction suivante ; over : sans entrer dans les fonctions ; out : jusqu'au retour de la fonction. */
    step(kind) { if (state === 'paused') go(kind === 'over' || kind === 'out' ? kind : 'into'); },
    setBreakpoints(lines) { dbg.bps = new Set([...(lines || [])].map(Number)); syncD(); },
    /** Variables locales visibles à l'arrêt : [{ name, type, text }]. */
    locals() {
      const y = dbg.cur, h = y && hooks && hooks[y.h];
      if (!h || state !== 'paused') return [];
      let vals = [];
      try { vals = y.v(); } catch (e) { vals = []; }
      return h.names.map((name, i) => ({ name, type: h.types[i], text: showValue(vals[i], h.types[i]) }));
    },
    /** Variables globales (à tout moment) : [{ name, type, text }]. */
    globals() {
      let vals = [];
      try { vals = mod && mod.G ? mod.G() : []; } catch (e) { vals = []; }
      return gvars.map((g, i) => ({ name: g.name, type: g.t, text: showValue(vals[i], g.t) }));
    }
  };

  /** Fait avancer le programme de dt millisecondes. */
  function run(dt) {
    if (state !== 'run') return;
    slice(dt);
    if (memDirty) flushMem();
    // Programme compilé sans débogage : un pas à pas s'arrête à la fin de la tranche.
    if (dbg.mode && !hooks && state === 'run') halt(null);
  }
  function slice(dt) {
    if (started) T += Math.min(Math.max(dt, 0), 250);
    started = true;
    for (const p of pins.values()) {
      if (p.toneEnd && p.toneEnd <= T) { p.freq = 0; p.toneEnd = 0; }
      if (p.weak && p.mode !== 1 && T - p.weakAt > 50) warn(tl('digitalWrite({0}, HIGH) sans pinMode({1}, OUTPUT) : la broche reste une entrée, une LED n’y luit qu’à peine', p.weakN, p.weakN), p.weakLine);
    }
    if (wake !== null && wake > T) { vt = T; runIrq(); return; }
    vt = wake !== null ? wake : T; wake = null;
    const deadline = performance.now() + SLICE;
    for (;;) {
      $.b = 2000;
      runIrq(); if (state !== 'run') return;
      let r;
      try { r = gen.next(); } catch (e) { fault(e); return; }
      if (r.done) { state = 'done'; return; }
      const v = r.value;
      if (v === -1) { if (performance.now() > deadline) return; continue; }
      if (typeof v === 'object') { halt(v); return; } // arrêt du débogueur
      const w = vt + v;
      if (w <= T && performance.now() <= deadline) { vt = w; continue; }
      wake = w; return;
    }
  }
  return {
    pins, warnings, run, clock: () => vt,
    /** Instruments : état d'une broche (sortie, ou entrée lue sur le montage) et suivi des sorties. */
    probe(k) {
      const p = pins.get(k);
      if (p && p.mode === 1) return { out: true, d: p.d, v: p.dac != null ? p.dac : p.d ? prof.logic : 0, pwm: p.dac != null ? null : p.pwm, freq: p.toneEnd && vt > p.toneEnd ? 0 : p.freq || (p.pwm != null ? p.ledc : 0) || 0 };
      const r = input(k);
      return r ? { out: false, d: r.d != null ? r.d : +(r.v > prof.logic / 2), v: r.v != null ? r.v : r.d ? prof.logic : 0, pwm: null, freq: 0 } : null;
    },
    setTrace(fn) { trace = fn || null; },
    /** Traceur série : fn(texte, heure virtuelle) à chaque écriture sur Serial. */
    setSerialTap(fn) { tap = fn || null; },
    debug,
    logic: prof.logic,
    get state() { return state; }, get error() { return error; }, get line() { return $.l; },
    takeSerial() { const s = out; out = ''; return s; },
    send(s) { serialIn += s; },
    stop() { state = 'stopped'; }
  };
}
