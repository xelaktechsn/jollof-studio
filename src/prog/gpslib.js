// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// TinyGPSPlus (Mikal Hart, TinyGPS++ 1.0.3) pour l'interpréteur (runtime.js) : le même analyseur de trames NMEA que la
// bibliothèque, caractère par caractère (encode), avec ses règles : seules GPRMC/GNRMC et GPGGA/GNGGA sont lues, une
// trame n'est prise qu'avec une somme de contrôle juste, la position n'est validée que par une trame avec position
// (RMC « A » ou GGA de qualité > 0), les champs vides gardent leur valeur précédente. Les nombres décimaux sont gardés
// en centièmes (parseDecimal), les degrés en milliardièmes (parseDegrees), comme la vraie bibliothèque.

const MPS_PER_KNOT = 0.51444444, KMPH_PER_KNOT = 1.852, MPH_PER_KNOT = 1.15077945, MILES_PER_METER = 0.00062137112, KM_PER_METER = 0.001, FEET_PER_METER = 3.2808399;
const MAX_FIELD = 15;
const ULONG_MAX = 4294967295;

/** atol : entier en tête du texte (0 sinon). */
const atol = s => { const m = /^\s*[-+]?\d+/.exec(s); return m ? parseInt(m[0], 10) : 0; };
/** Centièmes : « 12.34 » → 1234 (TinyGPSPlus::parseDecimal). */
export function parseDecimal(term) {
  let t = term; const neg = t[0] === '-'; if (neg) t = t.slice(1);
  let ret = 100 * atol(t);
  const m = /^\d*\.(\d)(\d)?/.exec(t);
  if (m) { ret += 10 * +m[1]; if (m[2] != null) ret += +m[2]; }
  return neg ? -ret : ret;
}
/** ddmm.mmmm → { deg, billionths } (TinyGPSPlus::parseDegrees). */
export function parseDegrees(term) {
  const left = atol(term), minutes = left % 100;
  let mult = 10000000, tenM = minutes * mult;
  const m = /^\d*\.(\d+)/.exec(term);
  if (m) for (const ch of m[1]) { mult = Math.floor(mult / 10); tenM += +ch * mult; }
  return { deg: Math.floor(left / 100), billionths: Math.floor((5 * tenM + 1) / 3), negative: false };
}

/** ctx : { now() → millis() de la carte }. Rend les classes de la bibliothèque. */
export function createGpsLib(ctx) {
  const now = () => Math.floor(ctx.now()) >>> 0;
  class Field {
    constructor() { this.valid = false; this.updated = false; this.lastCommitTime = 0; }
    isValid() { return this.valid; }
    isUpdated() { return this.updated; }
    age() { return this.valid ? (now() - this.lastCommitTime) >>> 0 : ULONG_MAX; }
    stamp() { this.lastCommitTime = now(); this.valid = this.updated = true; }
  }
  class TinyGPSLocation extends Field {
    constructor() { super(); this.raw = { lat: parseDegrees('0'), lng: parseDegrees('0') }; this.nw = { lat: parseDegrees('0'), lng: parseDegrees('0') }; }
    commit() { this.raw = { lat: { ...this.nw.lat }, lng: { ...this.nw.lng } }; this.stamp(); }
    lat() { this.updated = false; const r = this.raw.lat, v = r.deg + r.billionths / 1e9; return r.negative ? -v : v; }
    lng() { this.updated = false; const r = this.raw.lng, v = r.deg + r.billionths / 1e9; return r.negative ? -v : v; }
  }
  class TinyGPSDate extends Field {
    constructor() { super(); this.date = 0; this.newDate = 0; }
    commit() { this.date = this.newDate; this.stamp(); }
    value() { this.updated = false; return this.date; }
    year() { this.updated = false; return (this.date % 100) + 2000; }
    month() { this.updated = false; return Math.floor(this.date / 100) % 100; }
    day() { this.updated = false; return Math.floor(this.date / 10000); }
  }
  class TinyGPSTime extends Field {
    constructor() { super(); this.time = 0; this.newTime = 0; }
    commit() { this.time = this.newTime; this.stamp(); }
    value() { this.updated = false; return this.time; }
    hour() { this.updated = false; return Math.floor(this.time / 1000000); }
    minute() { this.updated = false; return Math.floor(this.time / 10000) % 100; }
    second() { this.updated = false; return Math.floor(this.time / 100) % 100; }
    centisecond() { this.updated = false; return this.time % 100; }
  }
  class TinyGPSDecimal extends Field {
    constructor() { super(); this.val = 0; this.newval = 0; }
    commit() { this.val = this.newval; this.stamp(); }
    set(term) { this.newval = parseDecimal(term); }
    value() { this.updated = false; return this.val; }
  }
  class TinyGPSInteger extends TinyGPSDecimal {
    set(term) { this.newval = atol(term) >>> 0; }
  }
  class TinyGPSSpeed extends TinyGPSDecimal {
    knots() { return this.value() / 100; } mph() { return MPH_PER_KNOT * this.value() / 100; }
    mps() { return MPS_PER_KNOT * this.value() / 100; } kmph() { return KMPH_PER_KNOT * this.value() / 100; }
  }
  class TinyGPSCourse extends TinyGPSDecimal { deg() { return this.value() / 100; } }
  class TinyGPSAltitude extends TinyGPSDecimal {
    meters() { return this.value() / 100; } miles() { return MILES_PER_METER * this.value() / 100; }
    kilometers() { return KM_PER_METER * this.value() / 100; } feet() { return FEET_PER_METER * this.value() / 100; }
  }
  class TinyGPSHDOP extends TinyGPSDecimal { hdop() { return this.value() / 100; } }

  const RMC = 1, GGA = 0, OTHER = 2;
  class TinyGPSPlus {
    constructor() {
      this.location = new TinyGPSLocation(); this.date = new TinyGPSDate(); this.time = new TinyGPSTime(); this.speed = new TinyGPSSpeed();
      this.course = new TinyGPSCourse(); this.altitude = new TinyGPSAltitude(); this.satellites = new TinyGPSInteger(); this.hdop = new TinyGPSHDOP();
      this.parity = 0; this.isChecksumTerm = false; this.term = ''; this.type = OTHER; this.termNo = 0; this.hasFix = false;
      this.chars = 0; this.withFix = 0; this.failed = 0; this.passed = 0;
    }
    static libraryVersion() { return '1.0.3'; }
    static parseDecimal(t) { return parseDecimal(String(t)); }
    /** Un caractère reçu du GPS ; vrai quand il termine une trame valable (somme de contrôle juste). */
    encode(ch) {
      const c = typeof ch === 'number' ? String.fromCharCode(ch & 255) : String(ch)[0] || '\0';
      this.chars = (this.chars + 1) >>> 0;
      switch (c) {
        case ',': this.parity ^= 44; // puis comme une fin de champ
        // falls through
        case '\r': case '\n': case '*': {
          const ok = this.endOfTerm();
          this.termNo++; this.term = ''; this.isChecksumTerm = c === '*';
          return ok;
        }
        case '$':
          this.termNo = 0; this.term = ''; this.parity = 0; this.type = OTHER; this.isChecksumTerm = false; this.hasFix = false;
          return false;
        default:
          if (this.term.length < MAX_FIELD - 1) this.term += c;
          if (!this.isChecksumTerm) this.parity ^= c.charCodeAt(0) & 255;
          return false;
      }
    }
    endOfTerm() {
      const t = this.term;
      if (this.isChecksumTerm) {
        const hex = x => { const v = parseInt(x, 16); return Number.isNaN(v) ? 0 : v; };
        const sum = (16 * hex(t[0] || '0') + hex(t[1] || '0')) & 255;
        if (sum !== this.parity) { this.failed++; return false; }
        this.passed++;
        if (this.hasFix) this.withFix++;
        if (this.type === RMC) { this.date.commit(); this.time.commit(); if (this.hasFix) { this.location.commit(); this.speed.commit(); this.course.commit(); } }
        else if (this.type === GGA) { this.time.commit(); if (this.hasFix) { this.location.commit(); this.altitude.commit(); } this.satellites.commit(); this.hdop.commit(); }
        return true;
      }
      if (this.termNo === 0) { this.type = t === 'GPRMC' || t === 'GNRMC' ? RMC : t === 'GPGGA' || t === 'GNGGA' ? GGA : OTHER; return false; }
      if (this.type === OTHER || !t) return false;
      const n = this.termNo, L = this.location;
      if (n === 1) this.time.newTime = parseDecimal(t) >>> 0;
      else if (this.type === RMC) {
        if (n === 2) this.hasFix = t[0] === 'A';
        else if (n === 3) L.nw.lat = parseDegrees(t);
        else if (n === 4) L.nw.lat.negative = t[0] === 'S';
        else if (n === 5) L.nw.lng = parseDegrees(t);
        else if (n === 6) L.nw.lng.negative = t[0] === 'W';
        else if (n === 7) this.speed.set(t);
        else if (n === 8) this.course.set(t);
        else if (n === 9) this.date.newDate = atol(t) >>> 0;
      } else {
        if (n === 2) L.nw.lat = parseDegrees(t);
        else if (n === 3) L.nw.lat.negative = t[0] === 'S';
        else if (n === 4) L.nw.lng = parseDegrees(t);
        else if (n === 5) L.nw.lng.negative = t[0] === 'W';
        else if (n === 6) this.hasFix = t[0] > '0';
        else if (n === 7) this.satellites.set(t);
        else if (n === 8) this.hdop.set(t);
        else if (n === 9) this.altitude.set(t);
      }
      return false;
    }
    charsProcessed() { return this.chars; }
    sentencesWithFix() { return this.withFix; }
    failedChecksum() { return this.failed; }
    passedChecksum() { return this.passed; }
    /** Distance en mètres sur une sphère de 6 372 795 m (formule de la bibliothèque). */
    static distanceBetween(lat1, long1, lat2, long2) {
      const r = Math.PI / 180;
      let delta = (long1 - long2) * r;
      const sdlong = Math.sin(delta), cdlong = Math.cos(delta);
      lat1 *= r; lat2 *= r;
      const slat1 = Math.sin(lat1), clat1 = Math.cos(lat1), slat2 = Math.sin(lat2), clat2 = Math.cos(lat2);
      delta = (clat1 * slat2) - (slat1 * clat2 * cdlong);
      delta = Math.sqrt(delta * delta + (clat2 * sdlong) ** 2);
      const denom = (slat1 * slat2) + (clat1 * clat2 * cdlong);
      return Math.atan2(delta, denom) * 6372795;
    }
    /** Cap en degrés (nord = 0, ouest = 270) du point 1 vers le point 2. */
    static courseTo(lat1, long1, lat2, long2) {
      const r = Math.PI / 180, dlon = (long2 - long1) * r;
      lat1 *= r; lat2 *= r;
      const a1 = Math.sin(dlon) * Math.cos(lat2);
      let a2 = Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlon);
      a2 = Math.cos(lat1) * Math.sin(lat2) - a2;
      a2 = Math.atan2(a1, a2);
      if (a2 < 0) a2 += 2 * Math.PI;
      return a2 / r;
    }
    static cardinal(course) {
      const D = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
      return D[Math.trunc((course + 11.25) / 22.5) % 16];
    }
  }
  return { TinyGPSPlus, TinyGPSLocation, TinyGPSDate, TinyGPSTime, TinyGPSSpeed, TinyGPSCourse, TinyGPSAltitude, TinyGPSInteger, TinyGPSHDOP, TinyGPSDecimal };
}
