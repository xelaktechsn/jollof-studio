// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Bibliothèques simulées des afficheurs à pilote et des horloges / mémoires I2C, pour l'interpréteur (runtime.js) :
//   LedControl (Eberhard Fahle) et MD_MAX72XX (MajicDesigns) pour le MAX7219 ; TM1637Display (Avishay Orpaz) ;
//   RTClib (Adafruit : RTC_DS3231, RTC_DS1307, DateTime, TimeSpan) ; I2C_eeprom (Rob Tillaart) pour l'AT24C256.
// Chacune envoie à la puce les mêmes mots que la vraie bibliothèque, sur le modèle commun (src/sim/displays.js,
// src/sim/storage.js) : registres du MAX7219 par la chaîne de modules, trames du TM1637, registres I2C par Wire
// (l'analyseur de bus voit les trames). Le programme écrit aussi directement sur les broches (shiftOut, SPI.transfer)
// d'un MAX7219 : edge() et spi() suivent ces fronts et ces octets.
import { isMax, maxState, maxHead, maxChain, maxClock, maxBytes, maxLoad, tmFrame, tmState, publishDisplay } from '../sim/displays.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** LedControl : chiffres et lettres en segments du MAX7219 sans décodage (D7 = DP, D6 = A … D0 = G), table de la bibliothèque. */
const LC_CHARS = [
  0x7e, 0x30, 0x6d, 0x79, 0x33, 0x5b, 0x5f, 0x70, 0x7f, 0x7b, 0x77, 0x1f, 0x0d, 0x3d, 0x4f, 0x47, ...new Array(28).fill(0),
  0x80, 0x01, 0x80, 0x00, 0x7e, 0x30, 0x6d, 0x79, 0x33, 0x5b, 0x5f, 0x70, 0x7f, 0x7b, 0, 0, 0, 0, 0, 0,
  0x00, 0x77, 0x1f, 0x0d, 0x3d, 0x4f, 0x47, 0x00, 0x37, 0, 0, 0, 0x0e, 0, 0, 0, 0x67, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x08,
  0x00, 0x77, 0x1f, 0x0d, 0x3d, 0x4f, 0x47, 0x00, 0x37, 0, 0, 0, 0x0e, 0, 0x15, 0x1d, 0x67, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
];
/** TM1637Display : chiffres hexadécimaux en segments (bit 0 = A … bit 6 = G). */
const TM_DIGITS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const S1970_2000 = 946684800;
const bcd = v => (((v / 10) | 0) << 4) | (v % 10);
const unbcd = b => ((b >> 4) & 15) * 10 + (b & 15);
const p2 = n => String(n).padStart(2, '0');

/**
 * ctx : { hw, keyOf(n), warn(msg), tl, wire() → objet Wire, at(clé) → [{ comp, pin }], now() → ms de temps virtuel,
 * digitalWrite(n, v), pinMode(n, m) }. Rend les classes et les crochets edge(clé, niveau), spiSelect, spi(octet).
 */
export function createDevLibs(ctx) {
  const { hw, keyOf, warn, tl, at } = ctx;
  // Valeurs passées par adresse (&donnee, tableau) : octets lus et écrits comme en mémoire (runtime.js).
  const isRef = x => !!(x && x.ref), bytesOf = (x, n) => (isRef(x) && ctx.refBytes ? ctx.refBytes(x, n) : Array.isArray(x) ? x.slice(0, n ?? undefined) : typeof x === 'string' ? [...x].map(c => c.charCodeAt(0)).slice(0, n ?? undefined) : [x]);
  const store = (x, bytes) => { if (isRef(x) && ctx.refStore) ctx.refStore(x, bytes, bytes.length); else if (Array.isArray(x)) bytes.forEach((b, i) => { x[i] = b; }); };
  const linked = (c, k) => (hw.linked ? hw.linked(c, k) : []);
  /* ---------- MAX7219 : chaînes ---------- */
  const chains = new Map(); // id du module de tête → { chain, t }
  /** Chaîne de modules qui commence au module de tête de comp (gardée 0,5 s : le montage peut changer). */
  function chainOf(comp) {
    const head = maxHead(comp, linked), t = typeof performance !== 'undefined' ? performance.now() : Date.now(), e = chains.get(head.id);
    if (e && t - e.t < 500) return e.chain;
    const chain = maxChain(head, linked);
    chains.set(head.id, { chain, t });
    return chain;
  }
  const publishChain = chain => { for (const c of chain) publishDisplay(c); };
  /** Module MAX7219 de tête relié à la broche n de la carte par sa broche pin (DIN, CS…), ou null. */
  const maxOn = (n, pin) => { const k = keyOf(n); const x = k ? at(k).find(m => isMax(m.comp.type) && m.pin === pin) : null; return x ? x.comp : null; };
  let spiChain = null;
  /** Front écrit par la carte sur une broche reliée à un MAX7219 (shiftOut, digitalWrite) : DIN mémorisé, CLK décale, CS verrouille. */
  function edge(k, lv) {
    for (const x of at(k)) {
      if (!isMax(x.comp.type)) continue;
      const s = maxState(x.comp), was = s.lv[x.pin];
      s.lv[x.pin] = lv;
      if (x.pin === 'DIN' || was === lv) continue;
      const chain = chainOf(x.comp);
      if (chain[0] !== x.comp) continue; // seul le module de tête suit les broches
      if (x.pin === 'CLK' && lv) maxClock(chain, s.lv.DIN || 0);
      if (x.pin === 'CS') { if (lv) { maxLoad(chain); publishChain(chain); if (spiChain === chain) spiChain = null; } else spiChain = chain; }
    }
  }
  /** Octet du SPI matériel (SPI.transfer) : vers la chaîne dont CS est à l'état bas. Rend true s'il a été pris. */
  const spi = b => { if (!spiChain) return false; maxBytes(spiChain, [b & 255]); return true; };

  /** LedControl(DIN, CLK, CS, nombre de modules) : décalages par logiciel sur trois broches, comme la bibliothèque. */
  class LedControl {
    constructor(din, clk, cs, n = 1) {
      this.n = clamp(n | 0, 1, 8); this.st = new Uint8Array(64); this.pins = [din, clk, cs];
      this.head = maxOn(din, 'DIN');
      if (!this.head) warn(tl('LedControl : aucun module MAX7219 n’a sa broche DIN sur la broche {0}', din));
      for (let i = 0; i < this.n; i++) { this.tx(i, 15, 0); this.setScanLimit(i, 7); this.tx(i, 9, 0); this.clearDisplay(i); this.shutdown(i, true); }
    }
    /** Mot (opcode, donnée) pour le module addr, des « pas d'opération » pour les autres ; le module 0 est le plus proche de la carte. */
    tx(addr, op, data) {
      if (!this.head) return;
      const chain = chainOf(this.head), bytes = [];
      for (let i = this.n - 1; i >= 0; i--) bytes.push(i === addr ? op : 0, i === addr ? data & 255 : 0);
      maxBytes(chain, bytes); maxLoad(chain); publishChain(chain);
      if (chain.length < this.n && !this.short) { this.short = true; warn(tl('LedControl : le programme déclare {0} modules, mais la chaîne câblée n’en compte que {1}', this.n, chain.length)); }
    }
    getDeviceCount() { return this.n; }
    ok(a) { return a >= 0 && a < this.n; }
    shutdown(a, b) { if (this.ok(a)) this.tx(a, 12, b ? 0 : 1); }
    setScanLimit(a, l) { if (this.ok(a) && l >= 0 && l < 8) this.tx(a, 11, l); }
    setIntensity(a, i) { if (this.ok(a) && i >= 0 && i < 16) this.tx(a, 10, i); }
    clearDisplay(a) { if (!this.ok(a)) return; for (let i = 0; i < 8; i++) { this.st[a * 8 + i] = 0; this.tx(a, i + 1, 0); } }
    setLed(a, row, col, on) {
      if (!this.ok(a) || row < 0 || row > 7 || col < 0 || col > 7) return;
      const v = 0x80 >> col, o = a * 8 + row;
      this.st[o] = on ? this.st[o] | v : this.st[o] & ~v;
      this.tx(a, row + 1, this.st[o]);
    }
    setRow(a, row, v) { if (!this.ok(a) || row < 0 || row > 7) return; this.st[a * 8 + row] = v & 255; this.tx(a, row + 1, v); }
    setColumn(a, col, v) { if (!this.ok(a) || col < 0 || col > 7) return; for (let r = 0; r < 8; r++) this.setLed(a, r, col, (v >> (7 - r)) & 1); }
    setDigit(a, d, v, dp) {
      if (!this.ok(a) || d < 0 || d > 7 || v < 0 || v > 15) return;
      const x = LC_CHARS[v] | (dp ? 0x80 : 0);
      this.st[a * 8 + d] = x; this.tx(a, d + 1, x);
    }
    setChar(a, d, ch, dp) {
      if (!this.ok(a) || d < 0 || d > 7) return;
      let i = typeof ch === 'string' ? ch.charCodeAt(0) : ch | 0; i &= 255; if (i > 127) i = 32;
      const x = LC_CHARS[i] | (dp ? 0x80 : 0);
      this.st[a * 8 + d] = x; this.tx(a, d + 1, x);
    }
  }

  /**
   * MD_MAX72XX (fonctions de base) : points, lignes, colonnes, réglages. Type de module : GENERIC_HW, FC16_HW, PAROLA_HW,
   * ICSTATION_HW (ou DRxCRxRRx_HW) ; il décide comment lignes et colonnes tombent sur les registres, comme la vraie
   * bibliothèque (les modules simulés sont câblés comme un FC-16). La colonne 0 est à droite du module 0.
   */
  const HW = [[0, 1, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1], [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1], [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]];
  class MD_MAX72XX {
    constructor(type, a, b, c, d) {
      // (type, CS, n) en SPI matériel, ou (type, DIN, CLK, CS, n).
      const soft = d !== undefined || (c !== undefined && b !== undefined && typeof c === 'number' && a !== undefined && arguments.length >= 4);
      this.n = clamp((soft ? d : b) ?? 1, 1, 32) | 0;
      [this.digRows, this.revCols, this.revRows] = (HW[type | 0] || HW[1]).map(Boolean);
      this.head = soft ? maxOn(a, 'DIN') : maxOn(a, 'CS');
      this.buf = Array.from({ length: this.n }, () => new Uint8Array(8)); this.upd = true;
      if (!this.head) warn(tl('MD_MAX72XX : aucun module MAX7219 relié à la broche {0}', soft ? a : a));
      if (type | 0) { /* FC16_HW et les autres : rien à signaler */ } else if (!this.warned) { this.warned = true; warn(tl('MD_MAX72XX : GENERIC_HW suppose un autre câblage de la matrice que le module simulé (FC-16) : l’image sera tournée. Essayez MD_MAX72XX::FC16_HW')); }
    }
    send(dev, op, data) {
      if (!this.head) return;
      const chain = chainOf(this.head), bytes = [];
      for (let i = this.n - 1; i >= 0; i--) bytes.push(i === dev || dev < 0 ? op : 0, i === dev || dev < 0 ? data & 255 : 0);
      maxBytes(chain, bytes); maxLoad(chain); publishChain(chain);
    }
    begin() { this.send(-1, 15, 0); this.send(-1, 9, 0); this.send(-1, 11, 7); this.send(-1, 10, 7); this.clear(); this.send(-1, 12, 1); return true; }
    flush(dev) { if (!this.upd) return; for (let r = 0; r < 8; r++) this.send(dev, r + 1, this.buf[dev][r]); }
    update(on) { if (on === undefined) { const u = this.upd; this.upd = true; for (let i = 0; i < this.n; i++) this.flush(i); this.upd = u; } else { this.upd = !!on; if (this.upd) for (let i = 0; i < this.n; i++) this.flush(i); } }
    clear(a, b) { const from = a ?? 0, to = b ?? (a ?? this.n - 1); for (let i = from; i <= to && i < this.n; i++) { this.buf[i].fill(0); this.flush(i); } }
    hwRow(r) { return this.revRows ? 7 - r : r; }
    hwCol(c) { return this.revCols ? 7 - c : c; }
    setPoint(r, c, on) {
      const dev = (c / 8) | 0; c %= 8;
      if (dev >= this.n || r < 0 || r > 7 || c < 0) return false;
      const [dig, bit] = this.digRows ? [this.hwRow(r), this.hwCol(c)] : [this.hwRow(c), this.hwCol(r)];
      if (on) this.buf[dev][dig] |= 1 << bit; else this.buf[dev][dig] &= ~(1 << bit);
      if (this.upd) this.send(dev, dig + 1, this.buf[dev][dig]);
      return true;
    }
    getPoint(r, c) {
      const dev = (c / 8) | 0; c %= 8; if (dev >= this.n || r < 0 || r > 7) return false;
      const [dig, bit] = this.digRows ? [this.hwRow(r), this.hwCol(c)] : [this.hwRow(c), this.hwCol(r)];
      return !!((this.buf[dev][dig] >> bit) & 1);
    }
    /** setRow(ligne, valeur) sur tous les modules, ou setRow(module, ligne, valeur) ; bit 0 = colonne de droite. */
    setRow(a, b, c) {
      const [devs, r, v] = c === undefined ? [[...this.buf.keys()], a, b] : [[a], b, c];
      const u = this.upd; this.upd = false;
      for (const d of devs) for (let k = 0; k < 8; k++) this.setPoint(r, d * 8 + k, (v >> k) & 1);
      this.upd = u; for (const d of devs) this.flush(d);
      return true;
    }
    /** setColumn(colonne, valeur) (colonne sur tout l'affichage) ou setColumn(module, colonne, valeur) ; bit 0 = ligne du haut. */
    setColumn(a, b, c) {
      const [col, v] = c === undefined ? [a, b] : [a * 8 + b, c];
      const u = this.upd; this.upd = false;
      for (let r = 0; r < 8; r++) this.setPoint(r, col, (v >> r) & 1);
      this.upd = u; this.flush((col / 8) | 0);
      return true;
    }
    /** control(réglage, valeur) sur tous les modules, ou control(module, réglage, valeur). */
    control(a, b, c) {
      const [dev, req, v] = c === undefined ? [-1, a, b] : [a, b, c];
      if (req === 10) { this.update(!!v); return true; }
      const op = { 0: 12, 1: 11, 2: 10, 3: 15, 4: 9 }[req]; if (op == null) return true;
      this.send(dev, op, req === 0 ? (v ? 0 : 1) : req === 4 ? (v ? 0xff : 0) : v);
      return true;
    }
    getColumnCount() { return this.n * 8; }
    getDeviceCount() { return this.n; }
  }

  /* ---------- TM1637 ---------- */
  /** TM1637Display(CLK, DIO) : trames de la bibliothèque (commande de données, adresse et chiffres, commande d'affichage). */
  class TM1637Display {
    constructor(clk, dio) {
      this.pins = [clk, dio]; this.bright = 0; // non initialisée par la bibliothèque : l'afficheur reste éteint sans setBrightness()
      const k = keyOf(clk), x = k ? at(k).find(m => m.comp.type === 'tm1637' && m.pin === 'CLK') : null;
      this.c = x ? x.comp : null;
      if (!this.c) warn(tl('TM1637 : aucun afficheur TM1637 n’a sa broche CLK sur la broche {0}', clk));
      else if (!at(keyOf(dio)).some(m => m.comp === this.c && m.pin === 'DIO')) warn(tl('TM1637 : la broche {0} n’est pas reliée à DIO de {1}', dio, this.c.name));
    }
    frame(bytes) { if (this.c) { tmState(this.c); tmFrame(this.c, bytes); publishDisplay(this.c); } }
    setBrightness(b, on = true) { this.bright = ((b | 0) & 7) | (on ? 8 : 0); }
    setSegments(segs, len = 4, pos = 0) {
      const list = Array.isArray(segs) ? segs : [segs];
      this.frame([0x40]);
      this.frame([0xc0 + (pos & 3), ...Array.from({ length: len }, (_, i) => (list[i] | 0) & 255)]);
      if (!(this.bright & 8) && !this.dark) { this.dark = true; warn(tl('TM1637 : afficheur éteint ; appelez setBrightness(7) avant d’afficher (la bibliothèque part d’une luminosité nulle, éteinte)')); }
      this.frame([0x80 + (this.bright & 15)]);
    }
    clear() { this.setSegments([0, 0, 0, 0]); }
    encodeDigit(d) { return TM_DIGITS[d & 15]; }
    showNumberDec(num, lz = false, len = 4, pos = 0) { this.showNumberDecEx(num, 0, lz, len, pos); }
    showNumberDecEx(num, dots = 0, lz = false, len = 4, pos = 0) { num |= 0; this.base(num < 0 ? -10 : 10, num < 0 ? -num : num, dots, lz, len, pos); }
    showNumberHexEx(num, dots = 0, lz = false, len = 4, pos = 0) { this.base(16, num, dots, lz, len, pos); }
    /** showNumberBaseEx de la bibliothèque, à l'identique (nombre sur 16 bits sans signe, signe moins à gauche du nombre). */
    base(base, num, dots, lz, len, pos) {
      let neg = false; if (base < 0) { base = -base; neg = true; }
      num &= 0xffff; len = clamp(len | 0, 1, 4);
      const dg = [0, 0, 0, 0];
      if (num === 0 && !lz) { dg[len - 1] = TM_DIGITS[0]; }
      else {
        for (let i = len - 1; i >= 0; --i) {
          const d = num % base;
          dg[i] = d === 0 && num === 0 && !lz ? 0 : TM_DIGITS[d];
          if (d === 0 && num === 0 && neg) { dg[i] = 0x40; neg = false; }
          num = Math.floor(num / base);
        }
        if (dots) { let x = dots & 255; for (let i = 0; i < 4; i++) { dg[i] |= x & 0x80; x = (x << 1) & 255; } }
      }
      this.setSegments(dg, len, pos);
    }
  }

  /* ---------- RTClib ---------- */
  /** DateTime de RTClib : secondes depuis le 1er janvier 1970 (heure de l'horloge, sans fuseau). */
  class DateTime {
    constructor(a, b, c, d, e, f) {
      let t = S1970_2000;
      if (a instanceof DateTime) t = a.t;
      else if (typeof a === 'string' && typeof b === 'string') {
        // DateTime(F(__DATE__), F(__TIME__)) : « Nov 17 2026 », « 12:34:56 ».
        const m = MONTHS.indexOf(a.slice(0, 3)), y = +a.slice(7, 11), dd = +a.slice(4, 6);
        const [hh, mi, ss] = b.split(':').map(Number);
        t = Date.UTC(y || 2000, Math.max(0, m), dd || 1, hh || 0, mi || 0, ss || 0) / 1000;
      } else if (typeof a === 'string') {
        const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)/.exec(a); // ISO 8601
        if (m) t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000; else t = NaN;
      } else if (b !== undefined) {
        const y = (a | 0) >= 2000 ? a | 0 : (a | 0) + 2000;
        t = Date.UTC(y, (b | 0) - 1, (c ?? 1) | 0, (d ?? 0) | 0, (e ?? 0) | 0, (f ?? 0) | 0) / 1000;
      } else if (a !== undefined) t = (+a >>> 0);
      this.t = t;
    }
    get D() { return new Date(this.t * 1000); }
    year() { return this.D.getUTCFullYear(); } month() { return this.D.getUTCMonth() + 1; } day() { return this.D.getUTCDate(); }
    hour() { return this.D.getUTCHours(); } minute() { return this.D.getUTCMinutes(); } second() { return this.D.getUTCSeconds(); }
    twelveHour() { const h = this.hour() % 12; return h || 12; } isPM() { return this.hour() >= 12 ? 1 : 0; }
    dayOfTheWeek() { return this.D.getUTCDay(); }
    unixtime() { return this.t >>> 0; } secondstime() { return (this.t - S1970_2000) >>> 0; }
    isValid() { const y = this.year(); return Number.isFinite(this.t) && y >= 2000 && y <= 2099; }
    /** timestamp(TIMESTAMP_FULL | TIMESTAMP_TIME | TIMESTAMP_DATE) : « 2026-11-17T08:30:00 ». */
    timestamp(o = 0) {
      const d = `${this.year()}-${p2(this.month())}-${p2(this.day())}`, h = `${p2(this.hour())}:${p2(this.minute())}:${p2(this.second())}`;
      return o === 1 ? h : o === 2 ? d : `${d}T${h}`;
    }
    /** toString(« DD/MM/YYYY hh:mm:ss ») : le modèle rempli (hh, mm, ss, DD, MM, MMM, YY, YYYY, DDD, AP, ap). */
    toString(fmt = 'YYYY-MM-DDThh:mm:ss') {
      return String(fmt).replace(/YYYY|YY|MMM|MM|DDD|DD|hh|mm|ss|AP|ap/g, k => ({
        YYYY: String(this.year()), YY: p2(this.year() % 100), MMM: MONTHS[this.month() - 1], MM: p2(this.month()), DDD: DAYS[this.dayOfTheWeek()], DD: p2(this.day()),
        hh: p2(fmt.includes('AP') || fmt.includes('ap') ? this.twelveHour() : this.hour()), mm: p2(this.minute()), ss: p2(this.second()),
        AP: this.isPM() ? 'PM' : 'AM', ap: this.isPM() ? 'pm' : 'am'
      })[k]);
    }
  }
  /** TimeSpan(jours, heures, minutes, secondes) ou TimeSpan(secondes). */
  class TimeSpan {
    constructor(d = 0, h, m, s) { this.s = h === undefined ? d | 0 : (d | 0) * 86400 + (h | 0) * 3600 + (m | 0) * 60 + (s | 0); }
    days() { return Math.trunc(this.s / 86400); } hours() { return Math.trunc(this.s / 3600) % 24; } minutes() { return Math.trunc(this.s / 60) % 60; }
    seconds() { return this.s % 60; } totalseconds() { return this.s; }
  }
  const W = () => ctx.wire();
  const ack = a => { const w = W(); w.beginTransmission(a); return w.endTransmission() === 0; };
  const wr = (a, bytes) => { const w = W(); w.beginTransmission(a); for (const b of bytes) w.write(b & 255); return w.endTransmission() === 0; };
  const rd = (a, reg, n) => { const w = W(); w.beginTransmission(a); w.write(reg); if (w.endTransmission(false) !== 0) return null; w.requestFrom(a, n); return Array.from({ length: n }, () => w.read() & 255); };
  class RtcBase {
    begin() { this.ok = ack(0x68); if (!this.ok) warn(tl('{0} : aucune horloge ne répond à l’adresse 0x68 (vérifiez VCC, GND, SDA et SCL)', this.name)); return this.ok; }
    reg(r) { const v = rd(0x68, r, 1); return v ? v[0] : 0; }
    now() {
      const b = rd(0x68, 0, 7); if (!b) return new DateTime(S1970_2000);
      const h = b[2] & 0x40 ? unbcd(b[2] & 0x1f) % 12 + (b[2] & 0x20 ? 12 : 0) : unbcd(b[2] & 0x3f);
      return new DateTime(unbcd(b[6]) + 2000, unbcd(b[5] & 0x1f), unbcd(b[4]), h, unbcd(b[1]), unbcd(b[0] & 0x7f));
    }
  }
  class RTC_DS3231 extends RtcBase {
    constructor() { super(); this.name = 'DS3231'; }
    adjust(dt) {
      const d = dt instanceof DateTime ? dt : new DateTime(dt);
      wr(0x68, [0, bcd(d.second()), bcd(d.minute()), bcd(d.hour()), d.dayOfTheWeek() || 7, bcd(d.day()), bcd(d.month()) | (d.year() >= 2100 ? 0x80 : 0), bcd(d.year() % 100)]);
      wr(0x68, [0x0f, this.reg(0x0f) & ~0x80]); // OSF effacé
    }
    lostPower() { return this.reg(0x0f) >> 7; }
    getTemperature() { const b = rd(0x68, 0x11, 2); return b ? ((b[0] << 24) >> 24) + (b[1] >> 6) * 0.25 : NaN; }
    readSqwPinMode() { const m = this.reg(0x0e) & 0x1c; return m & 0x04 ? 0x1c : m; }
    writeSqwPinMode(m) { wr(0x68, [0x0e, (this.reg(0x0e) & ~0x1c) | (m & 0x1c)]); }
    isEnabled32K() { return (this.reg(0x0f) >> 3) & 1; }
    enable32K() { wr(0x68, [0x0f, this.reg(0x0f) | 0x08]); } disable32K() { wr(0x68, [0x0f, this.reg(0x0f) & ~0x08]); }
    setAlarm1(dt, mode) {
      const ctl = this.reg(0x0e); if (!(ctl & 0x04)) return false;
      const dy = (mode & 0x10) << 2, day = dy ? dt.dayOfTheWeek() || 7 : dt.day();
      wr(0x68, [7, bcd(dt.second()) | ((mode & 1) << 7), bcd(dt.minute()) | ((mode & 2) << 6), bcd(dt.hour()) | ((mode & 4) << 5), bcd(day) | ((mode & 8) << 4) | dy]);
      wr(0x68, [0x0e, ctl | 0x01]);
      return true;
    }
    setAlarm2(dt, mode) {
      const ctl = this.reg(0x0e); if (!(ctl & 0x04)) return false;
      const dy = (mode & 0x8) << 3, day = dy ? dt.dayOfTheWeek() || 7 : dt.day();
      wr(0x68, [0x0b, bcd(dt.minute()) | ((mode & 1) << 7), bcd(dt.hour()) | ((mode & 2) << 6), bcd(day) | ((mode & 4) << 5) | dy]);
      wr(0x68, [0x0e, ctl | 0x02]);
      return true;
    }
    alarmFired(n) { return (this.reg(0x0f) >> ((n | 0) - 1)) & 1; }
    clearAlarm(n) { wr(0x68, [0x0f, this.reg(0x0f) & ~(1 << ((n | 0) - 1))]); }
    disableAlarm(n) { wr(0x68, [0x0e, this.reg(0x0e) & ~(1 << ((n | 0) - 1))]); }
  }
  class RTC_DS1307 extends RtcBase {
    constructor() { super(); this.name = 'DS1307'; }
    adjust(dt) { const d = dt instanceof DateTime ? dt : new DateTime(dt); wr(0x68, [0, bcd(d.second()), bcd(d.minute()), bcd(d.hour()), 0, bcd(d.day()), bcd(d.month()), bcd(d.year() - 2000)]); }
    isrunning() { return !(this.reg(0) >> 7) ? 1 : 0; }
    readSqwPinMode() { return this.reg(7) & 0x93; }
    writeSqwPinMode(m) { wr(0x68, [7, m & 0x93]); }
    /** readnvram(adresse) → octet, ou readnvram(tableau, n, adresse) ; adresses 0 à 55. */
    readnvram(a, n, at0) {
      if (n !== undefined) { store(a, rd(0x68, 8 + ((at0 | 0) % 56), Math.min(n | 0, 56)) || []); return; }
      const v = rd(0x68, 8 + ((a | 0) % 56), 1); return v ? v[0] : 0;
    }
    writenvram(a, b, at0) {
      if (at0 !== undefined) { wr(0x68, [8 + (at0 | 0) % 56, ...bytesOf(a, Math.min(b | 0, 56))]); return; } // writenvram(adresse ou tableau…) : (tableau, n, adresse)
      wr(0x68, [8 + ((a | 0) % 56), b]);
    }
  }

  /* ---------- I2C_eeprom (Rob Tillaart) ---------- */
  /** Mémoire I2C 24LCxx / AT24Cxx : adresse sur deux octets, écritures découpées par page, attente de la fin d'écriture. */
  class I2C_eeprom {
    constructor(addr = 0x50, size = 32768) { this.a = (addr | 0) & 127; this.size = size | 0 || 32768; this.page = this.size >= 32768 ? 64 : this.size >= 4096 ? 32 : 16; }
    *begin() { return yield* this.ready(); }
    *isConnected() { return yield* this.ready(); }
    /** Attend que la puce acquitte (cycle d'écriture de 5 ms au plus) : interrogation toutes les 100 µs, comme la bibliothèque. */
    *ready() {
      for (let i = 0; i < 100; i++) { if (ack(this.a)) return true; yield 0.1; }
      return false;
    }
    getDeviceSize() { return this.size; } getPageSize() { return this.page; }
    *writeBlock(addr, data, len) {
      const bytes = bytesOf(data, len).map(b => b & 255);
      let a = addr | 0, i = 0;
      while (i < bytes.length) {
        const n = Math.min(bytes.length - i, this.page - (a % this.page)); // jamais à cheval sur deux pages
        yield* this.ready();
        if (!wr(this.a, [(a >> 8) & 255, a & 255, ...bytes.slice(i, i + n)])) return 1;
        a += n; i += n;
      }
      return 0;
    }
    *writeByte(addr, v) { return yield* this.writeBlock(addr, [v], 1); }
    *updateByte(addr, v) { return (yield* this.readByte(addr)) === (v & 255) ? 0 : yield* this.writeByte(addr, v); }
    *setBlock(addr, v, len) { return yield* this.writeBlock(addr, new Array(len | 0).fill(v & 255), len); }
    *readBlock(addr, buf, len) {
      yield* this.ready();
      const w = W(); w.beginTransmission(this.a); w.write((addr >> 8) & 255); w.write(addr & 255);
      if (w.endTransmission() !== 0) return 0;
      const n = Math.max(0, len | 0), got = [];
      for (let i = 0; i < n; i += 32) { w.requestFrom(this.a, Math.min(32, n - i)); while (w.available()) got.push(w.read() & 255); }
      store(buf, got);
      return got.length;
    }
    *readByte(addr) { const b = [0]; yield* this.readBlock(addr, b, 1); return b[0]; }
    *writeByteVerify(addr, v) { yield* this.writeByte(addr, v); return (yield* this.readByte(addr)) === (v & 255); }
  }

  return { LedControl, MD_MAX72XX, TM1637Display, DateTime, TimeSpan, RTC_DS3231, RTC_DS1307, I2C_eeprom, edge, spi };
}
