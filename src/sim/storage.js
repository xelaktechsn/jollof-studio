// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Horloges et mémoires I2C : horloges temps réel DS3231 (module ZS-042, avec sa mémoire AT24C32) et DS1307, mémoire
// EEPROM AT24C256. Un seul modèle par puce, au niveau des registres d'après les fiches techniques (check/sources.js),
// partagé par l'interpréteur (Wire de src/prog/runtime.js) et par les processeurs émulés (src/emu/devices/storage.js) :
// storeI2c rend l'esclave I2C (start, write, read, stop) ; l'analyseur de bus voit donc les mêmes trames partout.
// L'état de la simulation vit sur comp.icState (remis à zéro à l'arrêt, comme les puces logiques) ; le contenu des
// mémoires EEPROM est gardé avec le projet (hw.compMem(comp).ee, en hexadécimal).

/** Puces de ce module, sur le bus I2C. */
export const STORE_I2C = ['ds3231', 'ds1307', 'at24c256'];
export const isStore = t => STORE_I2C.includes(t);

const bcd = v => (((v / 10) | 0) << 4) | (v % 10);
const unbcd = b => ((b >> 4) & 15) * 10 + (b & 15);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Adresses I2C de la puce. DS3231 (module ZS-042) : 0x68, et 0x57 pour sa mémoire AT24C32 (cavaliers A0 à A2 ouverts,
 * tirés au VCC sur le module). DS1307 : 0x68. AT24C256 : 0x50 à 0x57 selon A0 à A2 (au VCC : 1 ; à la masse ou libres,
 * tirées vers la masse sur le module : 0).
 */
export function storeAddr(comp, A) {
  if (comp.type === 'ds3231') return [0x68, 0x57];
  if (comp.type === 'ds1307') return [0x68];
  if (comp.type === 'at24c256') {
    const hi = k => (A && comp.pins && comp.pins[k] && A.net({ comp, key: k }).src.length ? 1 : 0);
    return [0x50 | (hi('A2') << 2) | (hi('A1') << 1) | hi('A0')];
  }
  return [];
}

/**
 * Mémoires EEPROM : taille (octets), page (octets écrits d'un coup, l'adresse fait le tour de la page), durée du cycle
 * d'écriture (s) pendant laquelle la puce n'acquitte plus son adresse. AT24C256C (Microchip DS20006270) : 32 Ko,
 * pages de 64 octets, tWR 5 ms au plus. AT24C32 du module ZS-042 (AT24C32D, DS20006060) : 4 Ko, pages de 32 octets, 5 ms.
 */
export const EEPROMS = { at24c256: { size: 32768, page: 64, twr: 0.005 }, ds3231: { size: 4096, page: 32, twr: 0.005 } };
/** Octets de la RAM sauvegardée du DS1307 (0x08 à 0x3F). */
export const DS1307_RAM = 56;

/* ---------- Contenu gardé avec le projet ---------- */
// La mémoire vit dans un tableau d'octets attaché (non énumérable) à l'objet que garde le projet ; à l'enregistrement,
// toJSON l'écrit en hexadécimal, sans les 0xFF de la fin (octets jamais écrits). Rien à recopier pendant la simulation.
const toHex = (buf, blank) => { let n = buf.length; while (n > 0 && buf[n - 1] === blank) n--; let s = ''; for (let i = 0; i < n; i++) s += (buf[i] < 16 ? '0' : '') + buf[i].toString(16); return s; };
/** Tableau d'octets de la mémoire `key` (taille n, octets vierges blank) gardée dans m (hw.compMem(comp)), créé au besoin. */
export function persisted(m, key, n, blank = 0xff) {
  const own = m && m['_' + key];
  if (own && own.length === n) return own;
  const buf = new Uint8Array(n).fill(blank), hex = m && typeof m[key] === 'string' ? m[key] : '';
  for (let i = 0; i + 1 < hex.length && (i >> 1) < n; i += 2) { const b = parseInt(hex.slice(i, i + 2), 16); if (b >= 0) buf[i >> 1] = b; }
  if (m) {
    Object.defineProperty(m, '_' + key, { value: buf, configurable: true, writable: true, enumerable: false });
    const keys = (m._persist || []).filter(k => k.key !== key).concat([{ key, blank }]);
    Object.defineProperty(m, '_persist', { value: keys, configurable: true, writable: true, enumerable: false });
    Object.defineProperty(m, 'toJSON', {
      configurable: true, writable: true, enumerable: false,
      value() { const o = { ...this }; for (const k of this._persist || []) if (this['_' + k.key]) o[k.key] = toHex(this['_' + k.key], k.blank); return o; }
    });
  }
  return buf;
}

/* ---------- Heure ---------- */
/** Heure locale de l'ordinateur, en secondes, écrite comme une heure UTC (champs de date = ceux affichés à l'écran). */
export function localNow(d = new Date()) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / 1000 + d.getMilliseconds() / 1000; }
/** Champs d'une date (secondes depuis 1970) : { y, mo (1-12), d, h, mi, s, dow (0 = dimanche) }. */
export function fields(t) {
  const D = new Date(Math.floor(t) * 1000);
  return { y: D.getUTCFullYear(), mo: D.getUTCMonth() + 1, d: D.getUTCDate(), h: D.getUTCHours(), mi: D.getUTCMinutes(), s: D.getUTCSeconds(), dow: D.getUTCDay() };
}
const DAYS_IN = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** État d'une horloge : registres et temps qui court. clock() : secondes de temps virtuel de la simulation. */
function freshRtc(t, clock) {
  const s = { t, epoch: localNow(), v0: clock(), h12: false, halted: false, dowOff: 0, ptr: 0, first: false, reg: new Uint8Array(t === 'ds3231' ? 0x13 : 0x40), lastAl: 0, ver: 0 };
  if (t === 'ds3231') { s.reg[0x0e] = 0x1c; s.reg[0x0f] = 0x08; } // INTCN, RS2, RS1 ; EN32kHz (OSF à 0 : la pile a gardé l'heure)
  s.lastAl = Math.floor(s.epoch);
  return s;
}
/** Heure courante de l'horloge (secondes, heure locale écrite en UTC). */
export function rtcTime(s, clock) { return s.halted ? s.epoch : s.epoch + Math.max(0, clock() - s.v0); }
/** Registres 0 à 6 (secondes à année, en BCD) d'après l'heure courante. */
function timeRegs(s, t) {
  const f = fields(t), r = s.reg;
  r[0] = bcd(f.s) | (s.t === 'ds1307' && s.halted ? 0x80 : 0);
  r[1] = bcd(f.mi);
  if (s.h12) { const h = f.h % 12 || 12; r[2] = 0x40 | (f.h >= 12 ? 0x20 : 0) | bcd(h); } else r[2] = bcd(f.h);
  r[3] = ((Math.floor(t / 86400) + 4 + s.dowOff) % 7 + 7) % 7 || 7; // 1 à 7 ; au départ, 7 = dimanche (convention de RTClib)
  r[4] = bcd(f.d);
  r[5] = bcd(f.mo) | (s.t === 'ds3231' && f.y >= 2100 ? 0x80 : 0);
  r[6] = bcd(f.y % 100);
}
/** Heure écrite par le programme dans les registres 0 à 6 : la nouvelle référence de l'horloge. */
function setFromRegs(s, clock) {
  const r = s.reg, h12 = !!(r[2] & 0x40);
  let h = h12 ? unbcd(r[2] & 0x1f) % 12 + (r[2] & 0x20 ? 12 : 0) : unbcd(r[2] & 0x3f);
  const y = 2000 + unbcd(r[6]) + (s.t === 'ds3231' && r[5] & 0x80 ? 100 : 0), mo = clamp(unbcd(r[5] & 0x1f), 1, 12), d = clamp(unbcd(r[4] & 0x3f), 1, DAYS_IN(y, mo));
  h = clamp(h, 0, 23);
  const t = Date.UTC(y, mo - 1, d, h, clamp(unbcd(r[1] & 0x7f), 0, 59), clamp(unbcd(r[0] & 0x7f), 0, 59)) / 1000;
  s.h12 = h12; s.epoch = t; s.v0 = clock();
  // Jour de la semaine : le registre 3 est un simple compteur ; on garde l'écart avec le jour calculé.
  const want = r[3] & 7 || 7, calc = ((Math.floor(t / 86400) + 4) % 7) || 7;
  s.dowOff = (want - calc + 7) % 7;
  s.lastAl = Math.floor(t);
  if (s.t === 'ds1307') s.halted = !!(r[0] & 0x80);
  s.ver++;
}
/**
 * Alarmes du DS3231 : chaque seconde écoulée depuis le dernier passage est comparée aux registres 7 à 0x0D, avec leurs
 * bits de masque (A1M1 à A1M4, A2M2 à A2M4) et DY/DT ; une alarme qui correspond lève A1F ou A2F (registre d'état).
 */
function alarms(s, t) {
  const r = s.reg, now = Math.floor(t);
  let from = s.lastAl + 1;
  if (now - from > 2 * 86400) from = now - 2 * 86400;
  s.lastAl = Math.max(s.lastAl, now);
  if (from > now) return;
  const dayMatch = (b, f, dow) => (b & 0x40 ? (b & 7) === dow : unbcd(b & 0x3f) === f.d);
  const hourMatch = (b, f) => (b & 0x40 ? (unbcd(b & 0x1f) % 12 + (b & 0x20 ? 12 : 0)) === f.h : unbcd(b & 0x3f) === f.h);
  for (let x = from; x <= now; x++) {
    const f = fields(x), dow = ((Math.floor(x / 86400) + 4 + s.dowOff) % 7 + 7) % 7 || 7;
    const m1 = [r[7], r[8], r[9], r[10]].map(b => b >> 7), m2 = [r[11], r[12], r[13]].map(b => b >> 7);
    // Alarme 1 : chaque seconde, ou à la seconde, aux minutes et secondes, à l'heure, au jour.
    const a1 = (m1[0] || unbcd(r[7] & 0x7f) === f.s) && (m1[1] || unbcd(r[8] & 0x7f) === f.mi) && (m1[2] || hourMatch(r[9], f)) && (m1[3] || dayMatch(r[10], f, dow));
    if (a1) r[0x0f] |= 1;
    // Alarme 2 : à la seconde 00 seulement (pas de registre des secondes).
    if (f.s === 0 && (m2[0] || unbcd(r[11] & 0x7f) === f.mi) && (m2[1] || hourMatch(r[12], f)) && (m2[2] || dayMatch(r[13], f, dow))) r[0x0f] |= 2;
  }
}

/* ---------- EEPROM ---------- */
function freshEe(type, m) {
  const E = EEPROMS[type];
  return { mem: persisted(m, 'ee', E.size), E, ptr: 0, nAddr: 0, page: null, busy: -1 };
}
/** Esclave I2C d'une mémoire AT24Cxx : adresse sur deux octets, écriture par page, cycle d'écriture où elle ne répond plus. */
function eeSlave(get, clock, changed) {
  let write = false;
  return {
    start(w) {
      const e = get();
      if (clock() < e.busy) return false; // cycle d'écriture en cours : adresse non acquittée (« acknowledge polling »)
      write = !!w; if (write) { e.nAddr = 0; e.page = null; }
      return true;
    },
    write(b) {
      const e = get(), E = e.E;
      if (e.nAddr < 2) { e.ptr = e.nAddr === 0 ? ((b << 8) & (E.size - 1) & 0xff00) | (e.ptr & 0xff) : (e.ptr & 0xff00) | b; e.ptr &= E.size - 1; e.nAddr++; return true; }
      // Octets de données : rangés dans le tampon de page ; l'adresse fait le tour de la page (pas de la mémoire).
      if (!e.page) e.page = new Map();
      e.page.set(e.ptr, b & 0xff);
      e.ptr = (e.ptr & ~(E.page - 1)) | ((e.ptr + 1) & (E.page - 1));
      return true;
    },
    read() { const e = get(), v = e.mem[e.ptr]; e.ptr = (e.ptr + 1) & (e.E.size - 1); return v; },
    stop() {
      const e = get();
      if (write && e.page && e.page.size) {
        for (const [a, v] of e.page) e.mem[a] = v;
        e.busy = clock() + e.E.twr;
        if (changed) changed();
      }
      e.page = null; write = false;
    }
  };
}

/**
 * Esclave I2C de la puce (un objet par composant et par moteur). env : { clock() → secondes de temps virtuel,
 * temp() → température ambiante (°C) ou null, mem() → objet gardé avec le projet (hw.compMem) ou null, changed() }.
 * start(écriture, adresse) rend false quand la puce n'acquitte pas (EEPROM en cycle d'écriture).
 */
export function storeI2c(comp, env = {}) {
  const clock = env.clock || (() => 0), mem = () => (env.mem ? env.mem() : null), changed = env.changed || null;
  const st = () => {
    let s = comp.icState;
    if (!s || s.t !== comp.type) {
      s = comp.type === 'at24c256' ? { t: comp.type, ee: freshEe('at24c256', mem()) } : freshRtc(comp.type, clock);
      if (comp.type === 'ds3231') s.ee = freshEe('ds3231', mem());
      if (comp.type === 'ds1307') s.ram = persisted(mem(), 'nv', DS1307_RAM, 0);
      comp.icState = s;
    }
    return s;
  };
  const ee = eeSlave(() => st().ee, clock, changed);
  if (comp.type === 'at24c256') return ee;
  let cur = null; // 'rtc' ou l'EEPROM du module
  const rtc = {
    start(w) {
      const s = st(), t = rtcTime(s, clock);
      // Au début de chaque accès, l'heure courante est recopiée dans les registres (tampon secondaire de la fiche) :
      // une lecture de plusieurs octets reste cohérente.
      timeRegs(s, t);
      if (s.t === 'ds3231') { alarms(s, t); tempRegs(s); }
      s.first = !!w; s.wrote = false;
      return true;
    },
    write(b) {
      const s = st(), n = s.reg.length;
      if (s.first) { s.ptr = b % n; s.first = false; return true; }
      const a = s.ptr;
      if (s.t === 'ds1307' && a >= 8) { s.ram[a - 8] = b; if (changed) changed(); }
      else if (a <= 6) { s.reg[a] = b; s.wrote = true; }
      else if (s.t === 'ds3231' && a === 0x0f) s.reg[a] = (s.reg[a] & b & 0x83) | (b & 0x08); // OSF, A2F, A1F : seulement remis à 0 ; BSY en lecture seule
      else if (s.t === 'ds3231' && (a === 0x11 || a === 0x12)) { /* température : lecture seule */ }
      else s.reg[a] = b;
      s.ptr = (a + 1) % n;
      return true;
    },
    read() {
      const s = st(), a = s.ptr, v = s.t === 'ds1307' && a >= 8 ? s.ram[a - 8] : s.reg[a];
      s.ptr = (a + 1) % s.reg.length;
      return v;
    },
    stop() { const s = st(); if (s.wrote) { setFromRegs(s, clock); s.wrote = false; } s.first = false; }
  };
  function tempRegs(s) {
    const T = env.temp ? env.temp() : null, q = Math.round((T == null || !isFinite(T) ? 25 : clamp(T, -40, 85)) * 4);
    s.reg[0x11] = (q >> 2) & 0xff; s.reg[0x12] = (q & 3) << 6;
  }
  return {
    start(w, addr) { cur = comp.type === 'ds3231' && addr === 0x57 ? ee : rtc; return cur.start(w); },
    write(b) { return cur ? cur.write(b) : false; },
    read() { return cur ? cur.read() : 0xff; },
    stop() { if (cur) cur.stop(); cur = null; }
  };
}
/** Heure de l'horloge pour l'affichage (étiquette, panneau) : { y, mo, d, h, mi, s } ou null si elle n'a pas démarré. */
export function rtcNow(comp, clock) { const s = comp && comp.icState; return s && s.epoch != null ? fields(rtcTime(s, clock || (() => s.v0))) : null; }
