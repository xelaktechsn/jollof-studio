// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Bibliothèques simulées des capteurs I2C de src/sim/i2csensors.js, pour l'interpréteur (runtime.js) :
//   Adafruit_VL53L0X et VL53L0X (Pololu) pour le capteur de distance ; MAX30105 (SparkFun MAX3010x), checkForBeat
//   (heartRate.h) et maxim_heart_rate_and_oxygen_saturation (spo2_algorithm.h) pour le MAX30102 ; Adafruit_TCS34725 ;
//   Adafruit_CCS811 ; Adafruit_BME680.
// Chacune passe par Wire, registre par registre, sur le même modèle de la puce que le mode fidèle : l'analyseur de bus
// voit les trames, et les attentes (mesure en cours, intégration, chauffe) durent ce qu'elles durent sur la carte.
import { bmeTfine, bmeTemp, bmePress, bmeHum, bmeGas } from '../sim/i2csensors.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const i16 = v => (v << 16) >> 16;
const s8 = v => (v << 24) >> 24;

/**
 * ctx : { hw, warn(msg), tl, wire() → objet Wire, now() → ms de temps virtuel, find(types, adresse, nom) → composant
 * (et l'avertissement « aucun module… ») ou null, avr : carte AVR (int de 16 bits, petits tampons) }.
 * Rend { classes, fns } : classes des bibliothèques, fonctions globales (checkForBeat…).
 */
export function createSensorLibs(ctx) {
  const { warn, tl, now } = ctx, W = () => ctx.wire();
  const put = (r, v) => { if (r && r.ref && r.set) r.set(v); };
  const ack = a => { const w = W(); w.beginTransmission(a); return w.endTransmission() === 0; };
  const wr = (a, reg, bytes = []) => { const w = W(); w.beginTransmission(a); w.write(reg & 255); for (const b of bytes) w.write(b & 255); return w.endTransmission() === 0; };
  const rd = (a, reg, n) => {
    const w = W(); w.beginTransmission(a); w.write(reg & 255);
    if (w.endTransmission(false) !== 0) return null;
    const out = [];
    for (let i = 0; i < n; i += 32) { w.requestFrom(a, Math.min(32, n - i)); while (w.available()) out.push(w.read() & 255); }
    return out;
  };
  const r8 = (a, reg) => { const v = rd(a, reg, 1); return v ? v[0] : 0; };
  const r16 = (a, reg) => { const v = rd(a, reg, 2); return v ? (v[0] << 8) | v[1] : 0; };
  /** Attend que cond() soit vrai, en l'interrogeant toutes les step ms, au plus timeout ms : rend vrai s'il l'est devenu. */
  function* until(cond, timeout, step = 1) { const t0 = now(); for (;;) { if (cond()) return true; if (now() - t0 >= timeout) return false; yield step; } }
  // Durée d'un court échange I2C à 100 kHz (adresse, registre, lecture : ≈ 4 octets de 9 bits) : l'interpréteur échange
  // sans délai, mais une boucle d'attente (while (!ccs.available());) doit voir le temps passer comme sur la carte.
  const BUS_MS = 0.36;
  /** Le module répond-il à cette adresse ? Sinon l'avertissement habituel (câblage, adresse). */
  const present = (a, types, name) => { if (ack(a)) return true; ctx.find(types, a, name); return false; };

  /* ---------- VL53L0X ---------- */
  /** RangeStatus de la bibliothèque d'ST d'après l'état interne de la puce (bits 6 à 3 de RESULT_RANGE_STATUS). */
  const palStatus = dev => ([0, 5, 7, 12, 13, 14, 15].includes(dev) ? 255 : dev >= 1 && dev <= 3 ? 5 : dev === 6 || dev === 9 ? 4 : dev === 8 || dev === 10 ? 3 : dev === 4 ? 2 : 0);
  class VL53L0X_RangingMeasurementData_t {
    constructor() { Object.assign(this, { TimeStamp: 0, MeasurementTimeUsec: 0, RangeMilliMeter: 0, RangeDMaxMilliMeter: 0, SignalRateRtnMegaCps: 0, AmbientRateRtnMegaCps: 0, EffectiveSpadRtnCount: 0, ZoneId: 0, RangeFractionalPart: 0, RangeStatus: 0 }); }
  }
  /** Parties communes : départ de mesure, attente de l'interruption « nouvelle mesure », lecture des résultats. */
  const vl = {
    *init(a) {
      if (r8(a, 0xc0) !== 0xee) return false;
      wr(a, 0x88, [0x00]); wr(a, 0x80, [0x01]); wr(a, 0xff, [0x01]); wr(a, 0x00, [0x00]);
      const stop = r8(a, 0x91);
      wr(a, 0x00, [0x01]); wr(a, 0xff, [0x00]); wr(a, 0x80, [0x00]);
      wr(a, 0x0a, [0x04]); wr(a, 0x0b, [0x01]); // interruption « nouvelle mesure prête », effacée
      // Étalonnages de référence (VHV, puis phase) : deux courtes mesures.
      for (const seq of [0x01, 0x02]) {
        wr(a, 0x01, [seq]); wr(a, 0x00, [0x01 | (seq === 1 ? 0x40 : 0)]);
        if (!(yield* until(() => (r8(a, 0x13) & 7) !== 0, 200))) return false;
        wr(a, 0x0b, [0x01]); wr(a, 0x00, [0x00]);
      }
      wr(a, 0x01, [0xe8]);
      return stop;
    },
    *wait(a, timeout) { return yield* until(() => (r8(a, 0x13) & 7) !== 0, timeout); },
    result(a) {
      const b = rd(a, 0x14, 12) || new Array(12).fill(0);
      wr(a, 0x0b, [0x01]); wr(a, 0x0b, [0x00]);
      return { dev: (b[0] & 0x78) >> 3, mm: (b[10] << 8) | b[11], sig: ((b[6] << 8) | b[7]) * 512, amb: ((b[8] << 8) | b[9]) * 512, spad: (b[2] << 8) | b[3] };
    }
  };
  /** Adafruit_VL53L0X : begin() initialise la puce ; rangingTest(&mesure) fait une mesure et remplit la structure. */
  class Adafruit_VL53L0X {
    constructor() { this.a = 0x29; this.ok = false; this.status = 0; this.budget = 33000; this.cont = false; }
    *begin(addr = 0x29) {
      this.ok = false;
      if (!present(0x29, ['vl53l0x'], 'VL53L0X')) return false;
      const s = yield* vl.init(0x29);
      if (s === false) { warn(tl('VL53L0X : la puce ne répond pas comme un VL53L0X (identifiant 0xEE attendu en 0xC0)')); return false; }
      this.a = 0x29;
      if ((addr & 0x7f) !== 0x29) { if (!this.setAddress(addr)) return false; }
      this.ok = true;
      return true;
    }
    setAddress(addr) { addr &= 0x7f; if (!wr(this.a, 0x8a, [addr])) return false; this.a = addr; return true; }
    fill(m, r) {
      if (!m) return;
      Object.assign(m, { RangeMilliMeter: r.mm, RangeStatus: palStatus(r.dev), SignalRateRtnMegaCps: r.sig >>> 0, AmbientRateRtnMegaCps: r.amb >>> 0, EffectiveSpadRtnCount: r.spad, RangeDMaxMilliMeter: 0, RangeFractionalPart: 0, ZoneId: 0, TimeStamp: 0, MeasurementTimeUsec: 0 });
    }
    *getSingleRangingMeasurement(m) {
      if (!this.ok) { warn(tl('VL53L0X : begin() n’a pas réussi, aucune mesure possible')); return -1; }
      wr(this.a, 0x00, [0x01]);
      if (!(yield* vl.wait(this.a, 200))) return -7; // VL53L0X_ERROR_TIME_OUT
      const r = vl.result(this.a); this.fill(m, r); this.status = palStatus(r.dev);
      return 0;
    }
    *rangingTest(m) { return yield* this.getSingleRangingMeasurement(m); }
    *readRange() { const m = new VL53L0X_RangingMeasurementData_t(), s = yield* this.getSingleRangingMeasurement(m); return s === 0 ? m.RangeMilliMeter : 0xffff; }
    readRangeStatus() { return this.status; }
    startRange() { if (!this.ok) return false; wr(this.a, 0x00, [0x01]); return true; }
    *isRangeComplete() { yield BUS_MS; return this.ok && (r8(this.a, 0x13) & 7) !== 0; }
    *waitRangeComplete() { return (yield* vl.wait(this.a, 1000)) ? 0 : -7; }
    readRangeResult() { const r = vl.result(this.a); this.status = palStatus(r.dev); return r.mm; }
    startRangeContinuous(period = 50) {
      if (!this.ok) return false;
      const p = Math.max(0, period | 0);
      wr(this.a, 0x04, [(p >>> 24) & 255, (p >> 16) & 255, (p >> 8) & 255, p & 255]); wr(this.a, 0x00, [0x04]);
      this.cont = true; return true;
    }
    stopRangeContinuous() { wr(this.a, 0x00, [0x01]); this.cont = false; }
    setMeasurementTimingBudgetMicroSeconds(us) { this.budget = us >>> 0; return true; }
    getMeasurementTimingBudgetMicroSeconds() { return this.budget; }
    configSensor() { return this.ok; }
    setLimitCheckEnable() { return true; } setLimitCheckValue() { return true; } getLimitCheckEnable() { return 1; }
    setInterruptThresholds() { return true; } setGpioConfig() { return true; } clearInterruptMask() { wr(this.a, 0x0b, [0x01]); wr(this.a, 0x0b, [0x00]); return true; }
  }
  /** VL53L0X de Pololu : init(), lectures continues ou uniques en millimètres, délai d'attente. */
  class VL53L0X {
    constructor() { this.a = 0x29; this.to = 0; this.timedOut = false; this.ok = false; this.budget = 33000; }
    *init() {
      if (!present(this.a, ['vl53l0x'], 'VL53L0X')) return false;
      const s = yield* vl.init(this.a);
      this.ok = s !== false; this.stop = s;
      return this.ok;
    }
    setAddress(addr) { addr &= 0x7f; wr(this.a, 0x8a, [addr]); this.a = addr; }
    getAddress() { return this.a; }
    setTimeout(ms) { this.to = ms & 0xffff; } getTimeout() { return this.to; }
    timeoutOccurred() { const t = this.timedOut; this.timedOut = false; return t; }
    setSignalRateLimit() { return true; } getSignalRateLimit() { return 0.25; }
    setMeasurementTimingBudget(us) { if (us < 20000) return false; this.budget = us >>> 0; return true; }
    getMeasurementTimingBudget() { return this.budget; }
    setVcselPulsePeriod() { return true; } getVcselPulsePeriod() { return 14; }
    startContinuous(period = 0) {
      if (period) { wr(this.a, 0x04, [(period >>> 24) & 255, (period >> 16) & 255, (period >> 8) & 255, period & 255]); wr(this.a, 0x00, [0x04]); }
      else wr(this.a, 0x00, [0x02]);
    }
    stopContinuous() { wr(this.a, 0x00, [0x01]); }
    *readRangeContinuousMillimeters() {
      if (!(yield* vl.wait(this.a, this.to || 2000))) { this.timedOut = true; if (!this.to) warn(tl('VL53L0X : aucune mesure n’arrive ; appelez startContinuous() avant readRangeContinuousMillimeters()')); return 65535; }
      const r = r16(this.a, 0x1e);
      wr(this.a, 0x0b, [0x01]);
      return r;
    }
    *readRangeSingleMillimeters() { wr(this.a, 0x00, [0x01]); return yield* this.readRangeContinuousMillimeters(); }
    *readRangeContinuous() { return yield* this.readRangeContinuousMillimeters(); }
    *readRangeSingle() { return yield* this.readRangeSingleMillimeters(); }
    last_status() { return 0; }
  }

  /* ---------- MAX30102 (bibliothèque SparkFun MAX3010x) ---------- */
  const STORAGE = ctx.avr ? 4 : 32, CHUNK = 32;
  class MAX30105 {
    constructor() { this.a = 0x57; this.leds = 0; this.ok = false; this.sense = { red: new Array(STORAGE).fill(0), IR: new Array(STORAGE).fill(0), green: new Array(STORAGE).fill(0), head: 0, tail: 0 }; this.rev = 0; }
    begin(wire, speed, addr = 0x57) {
      this.a = (addr | 0) & 127 || 0x57;
      if (!present(this.a, ['max30102'], 'MAX30102')) return false;
      if (this.readPartID() !== 0x15) { warn(tl('MAX30102 : identifiant de la puce inattendu (0x15 attendu en 0xFF)')); return false; }
      this.rev = r8(this.a, 0xfe); this.ok = true;
      return true;
    }
    readPartID() { return r8(this.a, 0xff); }
    readRevisionID() { this.rev = r8(this.a, 0xfe); } getRevisionID() { return this.rev; }
    mask(reg, keep, v) { wr(this.a, reg, [(r8(this.a, reg) & keep) | v]); }
    *softReset() { this.mask(0x09, 0xbf, 0x40); yield* until(() => !(r8(this.a, 0x09) & 0x40), 100); }
    shutDown() { this.mask(0x09, 0x7f, 0x80); } wakeUp() { this.mask(0x09, 0x7f, 0x00); }
    setLEDMode(m) { this.mask(0x09, 0xf8, m & 7); }
    setADCRange(v) { this.mask(0x0a, 0x9f, v); } setSampleRate(v) { this.mask(0x0a, 0xe3, v); } setPulseWidth(v) { this.mask(0x0a, 0xfc, v); }
    setPulseAmplitudeRed(v) { wr(this.a, 0x0c, [v]); } setPulseAmplitudeIR(v) { wr(this.a, 0x0d, [v]); } setPulseAmplitudeGreen(v) { wr(this.a, 0x0e, [v]); }
    setPulseAmplitudeProximity(v) { wr(this.a, 0x10, [v]); } setProximityThreshold(v) { wr(this.a, 0x30, [v]); }
    enableSlot(n, dev) { const [r, k, s] = [[0x11, 0xf8, 0], [0x11, 0x8f, 4], [0x12, 0xf8, 0], [0x12, 0x8f, 4]][(n - 1) & 3]; this.mask(r, k, (dev & 7) << s); }
    disableSlots() { wr(this.a, 0x11, [0]); wr(this.a, 0x12, [0]); }
    setFIFOAverage(v) { this.mask(0x08, 0x1f, v); } enableFIFORollover() { this.mask(0x08, 0xef, 0x10); } disableFIFORollover() { this.mask(0x08, 0xef, 0x00); }
    setFIFOAlmostFull(n) { this.mask(0x08, 0xf0, n & 15); }
    getWritePointer() { return r8(this.a, 0x04); } getReadPointer() { return r8(this.a, 0x06); }
    clearFIFO() { wr(this.a, 0x04, [0]); wr(this.a, 0x05, [0]); wr(this.a, 0x06, [0]); }
    getINT1() { return r8(this.a, 0x00); } getINT2() { return r8(this.a, 0x01); }
    enableDATARDY() { this.mask(0x02, 0xbf, 0x40); } disableDATARDY() { this.mask(0x02, 0xbf, 0); }
    enableAFULL() { this.mask(0x02, 0x7f, 0x80); } disableAFULL() { this.mask(0x02, 0x7f, 0); }
    enableDIETEMPRDY() { this.mask(0x03, 0xfd, 0x02); } disableDIETEMPRDY() { this.mask(0x03, 0xfd, 0); }
    /** setup() de la bibliothèque : mêmes réglages, mêmes valeurs par défaut (6,4 mA, moyenne de 4, 3 LED, 400 Hz, 411 µs, 4096 nA). */
    *setup(power = 0x1f, avg = 4, mode = 3, rate = 400, pw = 411, range = 4096) {
      yield* this.softReset();
      this.setFIFOAverage({ 1: 0, 2: 0x20, 4: 0x40, 8: 0x60, 16: 0x80, 32: 0xa0 }[avg] ?? 0x40);
      this.enableFIFORollover();
      this.setLEDMode(mode === 3 ? 7 : mode === 2 ? 3 : 2); this.leds = mode === 3 ? 3 : mode === 2 ? 2 : 1;
      this.setADCRange(range < 4096 ? 0 : range < 8192 ? 0x20 : range < 16384 ? 0x40 : range === 16384 ? 0x60 : 0);
      this.setSampleRate(rate < 100 ? 0 : rate < 200 ? 4 : rate < 400 ? 8 : rate < 800 ? 0x0c : rate < 1000 ? 0x10 : rate < 1600 ? 0x14 : rate < 3200 ? 0x18 : rate === 3200 ? 0x1c : 0);
      this.setPulseWidth(pw < 118 ? 0 : pw < 215 ? 1 : pw < 411 ? 2 : pw === 411 ? 3 : 0);
      this.setPulseAmplitudeRed(power); this.setPulseAmplitudeIR(power); this.setPulseAmplitudeGreen(power); this.setPulseAmplitudeProximity(power);
      this.enableSlot(1, 1); if (mode > 1) this.enableSlot(2, 2); if (mode > 2) this.enableSlot(3, 3);
      this.clearFIFO();
    }
    /** Échantillons arrivés dans la FIFO de la puce : copiés dans la petite réserve de la bibliothèque (4 sur un AVR). */
    *check() {
      yield 2 * BUS_MS;
      if (!this.ok) return 0;
      const rp = this.getReadPointer(), wp = this.getWritePointer();
      if (rp === wp) return 0;
      let n = wp - rp; if (n < 0) n += 32;
      const per = Math.max(1, this.leds) * 3, s = this.sense;
      let left = n * per;
      const w = W(); w.beginTransmission(this.a); w.write(0x07); w.endTransmission();
      while (left > 0) {
        let get = left; if (get > CHUNK) get = CHUNK - (CHUNK % per);
        left -= get;
        w.requestFrom(this.a, get);
        while (get > 0) {
          s.head = (s.head + 1) % STORAGE;
          const v = () => (((w.read() & 255) << 16) | ((w.read() & 255) << 8) | (w.read() & 255)) & 0x3ffff;
          s.red[s.head] = v();
          if (this.leds > 1) s.IR[s.head] = v();
          if (this.leds > 2) s.green[s.head] = v();
          get -= per;
        }
      }
      return n;
    }
    *safeCheck(max) { const t0 = now(); for (;;) { if (now() - t0 > max) return false; if (yield* this.check()) return true; yield 1; } }
    available() { let n = this.sense.head - this.sense.tail; if (n < 0) n += STORAGE; return n; }
    nextSample() { if (this.available()) { this.sense.tail = (this.sense.tail + 1) % STORAGE; } }
    *getRed() { return (yield* this.safeCheck(250)) ? this.sense.red[this.sense.head] : 0; }
    *getIR() { return (yield* this.safeCheck(250)) ? this.sense.IR[this.sense.head] : 0; }
    *getGreen() { return (yield* this.safeCheck(250)) ? this.sense.green[this.sense.head] : 0; }
    getFIFORed() { return this.sense.red[this.sense.tail]; } getFIFOIR() { return this.sense.IR[this.sense.tail]; } getFIFOGreen() { return this.sense.green[this.sense.tail]; }
    *readTemperature() {
      wr(this.a, 0x21, [0x01]);
      yield* until(() => (r8(this.a, 0x01) & 0x02) !== 0, 100);
      const ti = s8(r8(this.a, 0x1f)), tf = r8(this.a, 0x20);
      return ti + tf * 0.0625;
    }
    *readTemperatureF() { return (yield* this.readTemperature()) * 1.8 + 32; }
  }
  // heartRate.cpp (algorithme PBA de Maxim, adapté par SparkFun) : mêmes entiers de 16 et 32 bits que la bibliothèque.
  const hr = { acMax: 20, acMin: -20, cur: 0, prev: 0, sMin: 0, sMax: 0, pos: 0, neg: 0, avg: 0, cbuf: new Int16Array(32), off: 0 };
  const FIR = [172, 321, 579, 927, 1360, 1858, 2390, 2916, 3391, 3768, 4012, 4096];
  function averageDCEstimator(x) { x &= 0xffff; hr.avg = (hr.avg + (((x * 32768) - hr.avg) >> 4)) | 0; return i16(hr.avg >> 15); }
  function lowPassFIRFilter(din) {
    const c = hr.cbuf; c[hr.off] = din;
    let z = FIR[11] * c[(hr.off - 11) & 31];
    for (let i = 0; i < 11; i++) z += FIR[i] * i16(c[(hr.off - i) & 31] + c[(hr.off - 22 + i) & 31]);
    hr.off = (hr.off + 1) % 32;
    return i16((z | 0) >> 15);
  }
  function checkForBeat(sample) {
    let beat = false;
    hr.prev = hr.cur;
    const dc = averageDCEstimator(sample);
    hr.cur = lowPassFIRFilter(i16(sample - dc));
    if (hr.prev < 0 && hr.cur >= 0) {
      hr.acMax = hr.sMax; hr.acMin = hr.sMin; hr.pos = 1; hr.neg = 0; hr.sMax = 0;
      const d = i16(hr.acMax - hr.acMin);
      if (d > 20 && d < 1000) beat = true;
    }
    if (hr.prev > 0 && hr.cur <= 0) { hr.pos = 0; hr.neg = 1; hr.sMin = 0; }
    if (hr.pos && hr.cur > hr.prev) hr.sMax = hr.cur;
    if (hr.neg && hr.cur < hr.prev) hr.sMin = hr.cur;
    return beat;
  }
  /**
   * spo2_algorithm.h (exemple de référence de Maxim, 25 échantillons par seconde) : fréquence cardiaque par les creux de
   * l'infrarouge, SpO₂ par le rapport R = (AC/DC rouge) ÷ (AC/DC infrarouge) et la courbe −45,060 R² + 30,354 R + 94,845.
   * Version simplifiée, mêmes entrées et sorties ; -999 et valide à 0 quand le signal ne permet pas de conclure.
   */
  function maxim_heart_rate_and_oxygen_saturation(ir, n, red, spo2, validSpo2, heart, validHeart) {
    const N = Math.min(n | 0, ir.length, red.length), FS = 25;
    const fail = () => { put(spo2, -999); put(validSpo2, 0); put(heart, -999); put(validHeart, 0); };
    if (N < 2 * FS) { fail(); return; }
    const mean = a => a.slice(0, N).reduce((s, x) => s + x, 0) / N, dcIr = mean(ir), dcRed = mean(red);
    // Infrarouge retourné, sans sa moyenne, lissé sur 4 échantillons : les creux deviennent des pics.
    const x = [];
    for (let i = 0; i < N; i++) x.push(dcIr - ir[i]);
    const sm = x.map((_, i) => { let s = 0, k = 0; for (let j = i; j < Math.min(N, i + 4); j++) { s += x[j]; k++; } return s / k; });
    // Seuil à mi-hauteur et 0,3 s au moins entre deux battements (200 bpm au plus) : l'onde dicrote n'est pas comptée.
    const top = Math.max(...sm), thr = Math.max(30, top * 0.5), gap = Math.round(0.3 * FS);
    const peaks = [];
    for (let i = 1; i < N - 1; i++) if (sm[i] > thr && sm[i] >= sm[i - 1] && sm[i] > sm[i + 1] && (!peaks.length || i - peaks[peaks.length - 1] >= gap)) peaks.push(i);
    if (peaks.length >= 2) { put(heart, Math.round(FS * 60 / ((peaks[peaks.length - 1] - peaks[0]) / (peaks.length - 1)))); put(validHeart, 1); }
    else { put(heart, -999); put(validHeart, 0); }
    const ac = a => Math.max(...a.slice(0, N)) - Math.min(...a.slice(0, N)), acIr = ac(ir), acRed = ac(red);
    if (!dcIr || !dcRed || !acIr || peaks.length < 2) { put(spo2, -999); put(validSpo2, 0); return; }
    const R = (acRed / dcRed) / (acIr / dcIr), s = -45.06 * R * R + 30.354 * R + 94.845;
    if (R > 0.02 && R < 1.84 && s > 3 && s <= 100) { put(spo2, Math.round(s)); put(validSpo2, 1); } else { put(spo2, -999); put(validSpo2, 0); }
  }

  /* ---------- TCS34725 ---------- */
  const TCS_GAIN = [1, 4, 16, 60];
  class Adafruit_TCS34725 {
    constructor(it = 0xff, gain = 0) { this.it = it & 255; this.gain = gain & 3; this.a = 0x29; this.ready = false; }
    write8(reg, v) { wr(this.a, 0x80 | reg, [v]); }
    read8(reg) { return r8(this.a, 0x80 | reg); }
    read16(reg) { const v = rd(this.a, 0x80 | reg, 2); return v ? v[0] | (v[1] << 8) : 0; }
    *begin(addr = 0x29) {
      this.a = (addr | 0) & 127 || 0x29;
      if (!present(this.a, ['tcs34725'], 'TCS34725')) return false;
      const id = this.read8(0x12);
      if (id !== 0x44 && id !== 0x4d && id !== 0x10) { warn(tl('TCS34725 : identifiant inattendu (0x44 attendu en 0x12)')); return false; }
      this.ready = true;
      this.setIntegrationTime(this.it); this.setGain(this.gain);
      yield* this.enable();
      return true;
    }
    *enable() { this.write8(0x00, 0x01); yield 3; this.write8(0x00, 0x03); yield (256 - this.it) * 12 / 5 + 1; }
    disable() { const r = this.read8(0x00); this.write8(0x00, r & ~0x03); }
    setIntegrationTime(it) { this.it = it & 255; if (this.ready) this.write8(0x01, this.it); }
    setGain(g) { this.gain = g & 3; if (this.ready) this.write8(0x0f, this.gain); }
    *getRawData(r, g, b, c) {
      if (!this.ready) { warn(tl('TCS34725 : begin() n’a pas réussi, aucune mesure possible')); return; }
      put(c, this.read16(0x14)); put(r, this.read16(0x16)); put(g, this.read16(0x18)); put(b, this.read16(0x1a));
      yield Math.trunc((256 - this.it) * 12 / 5) + 1;
    }
    *getRawDataOneShot(r, g, b, c) { yield* this.enable(); yield* this.getRawData(r, g, b, c); this.disable(); }
    *getRGB(r, g, b) {
      const v = { r: 0, g: 0, b: 0, c: 0 }, box = k => ({ ref: true, set: x => { v[k] = x; } });
      yield* this.getRawData(box('r'), box('g'), box('b'), box('c'));
      if (!v.c) return;
      put(r, v.r / v.c * 255); put(g, v.g / v.c * 255); put(b, v.b / v.c * 255);
    }
    calculateColorTemperature(r, g, b) {
      if (!r && !g && !b) return 0;
      const X = -0.14282 * r + 1.54924 * g - 0.95641 * b, Y = -0.32466 * r + 1.57837 * g - 0.73191 * b, Z = -0.68202 * r + 0.77073 * g + 0.56332 * b;
      const xc = X / (X + Y + Z), yc = Y / (X + Y + Z), n = (xc - 0.332) / (0.1858 - yc);
      return clamp(Math.trunc(449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33), 0, 65535);
    }
    calculateColorTemperature_dn40(r, g, b, c) {
      if (!c) return 0;
      let sat = 256 - this.it > 63 ? 65535 : 1024 * (256 - this.it);
      if (256 - this.it <= 63) sat -= Math.trunc(sat / 4);
      if (c >= sat) return 0;
      const ir = r + g + b > c ? Math.trunc((r + g + b - c) / 2) : 0, r2 = (r - ir) & 0xffff, b2 = (b - ir) & 0xffff;
      if (!r2) return 0;
      return (Math.trunc(3810 * b2 / r2) + 1391) & 0xffff;
    }
    calculateLux(r, g, b) { return clamp(Math.trunc(-0.32466 * r + 1.57837 * g - 0.73191 * b), 0, 65535); }
    setInterrupt(on) { const r = this.read8(0x00); this.write8(0x00, on ? r | 0x10 : r & ~0x10); }
    clearInterrupt() { const w = W(); w.beginTransmission(this.a); w.write(0xe6); w.endTransmission(); }
    setIntLimits(lo, hi) { this.write8(0x04, lo & 255); this.write8(0x05, lo >> 8); this.write8(0x06, hi & 255); this.write8(0x07, hi >> 8); }
  }

  /* ---------- CCS811 ---------- */
  class Adafruit_CCS811 {
    constructor() { this.a = 0x5a; this.eco2 = 0; this.tvoc = 0; this.cur = 0; this.raw = 0; this.st = 0; this.mode = 0x10; }
    *begin(addr = 0x5a) {
      this.a = (addr | 0) & 127 || 0x5a;
      if (!present(this.a, ['ccs811'], 'CCS811')) { warn(tl('CCS811 : WAKE doit être à la masse (ou à LOW) pour que la puce réponde')); return false; }
      this.SWReset(); yield 100;
      if (r8(this.a, 0x20) !== 0x81) return false;
      const w = W(); w.beginTransmission(this.a); w.write(0xf4); w.endTransmission(); // APP_START
      yield 100;
      if (this.checkError()) return false;
      if (!(this.st & 0x80)) return false;
      this.disableInterrupt(); this.setDriveMode(1);
      return true;
    }
    SWReset() { wr(this.a, 0xff, [0x11, 0xe5, 0x72, 0x8a]); }
    status() { this.st = r8(this.a, 0x00); return this.st; }
    checkError() { return !!(this.status() & 0x01); }
    *available() { yield BUS_MS; return !!(this.status() & 0x08); }
    *readData() {
      if (!(yield* this.available())) return 0;
      const b = rd(this.a, 0x02, 8) || [0, 0, 0, 0, 0, 0, 0, 0];
      this.eco2 = (b[0] << 8) | b[1]; this.tvoc = (b[2] << 8) | b[3]; this.cur = b[6] >> 2; this.raw = ((b[6] & 3) << 8) | b[7];
      return this.st & 0x01 ? b[5] : 0;
    }
    geteCO2() { return this.eco2; } getTVOC() { return this.tvoc; } getCurrentSelected() { return this.cur; } getRawADCreading() { return this.raw; }
    setDriveMode(m) { this.mode = (this.mode & 0x8f) | ((m & 7) << 4); wr(this.a, 0x01, [this.mode]); }
    enableInterrupt() { this.mode |= 0x08; wr(this.a, 0x01, [this.mode]); }
    disableInterrupt() { this.mode &= ~0x08; wr(this.a, 0x01, [this.mode]); }
    setEnvironmentalData(h, t) {
      const hc = Math.trunc(h * 512 + 0.5) & 0xffff, tc = Math.trunc((t + 25) * 512 + 0.5) & 0xffff;
      wr(this.a, 0x05, [hc >> 8, hc & 255, tc >> 8, tc & 255]);
    }
    setThresholds(lo, hi, hyst = 50) { wr(this.a, 0x10, [lo >> 8, lo & 255, hi >> 8, hi & 255, hyst & 255]); }
    getBaseline() { const b = rd(this.a, 0x11, 2) || [0, 0]; return (b[0] << 8) | b[1]; }
    setBaseline(v) { wr(this.a, 0x11, [(v >> 8) & 255, v & 255]); }
    calculateTemperature() { return 25; }
  }

  /* ---------- BME680 ---------- */
  const OS_CYC = [0, 1, 2, 4, 8, 16];
  class Adafruit_BME680 {
    constructor() { this.a = 0x77; this.ok = false; this.osT = 4; this.osH = 2; this.osP = 3; this.filt = 2; this.hT = 320; this.hD = 150; this.heat = true; this.start = 0; this.per = 0; Object.assign(this, { temperature: 0, humidity: 0, pressure: 0, gas_resistance: 0 }); }
    /** Écriture par paires registre, valeur, comme bme68x_set_regs en I2C. */
    set(pairs) { const w = W(); w.beginTransmission(this.a); for (const [r, v] of pairs) { w.write(r); w.write(v & 255); } return w.endTransmission() === 0; }
    *begin(addr = 0x77, init = true) {
      this.a = (addr | 0) & 127 || 0x77;
      if (!present(this.a, ['bme680'], 'BME680')) return false;
      this.set([[0xe0, 0xb6]]); yield 10;
      if (r8(this.a, 0xd0) !== 0x61) { warn(tl('BME680 : identifiant inattendu (0x61 attendu en 0xD0)')); return false; }
      this.variant = r8(this.a, 0xf0);
      const c = [...(rd(this.a, 0x8a, 23) || []), ...(rd(this.a, 0xe1, 14) || []), ...(rd(this.a, 0x00, 5) || [])];
      const u16 = i => c[i] | (c[i + 1] << 8), s16 = i => i16(u16(i));
      this.cal = { t1: u16(31), t2: s16(0), t3: s8(c[2]), p1: u16(4), p2: s16(6), p3: s8(c[8]), p4: s16(10), p5: s16(12), p6: s8(c[15]), p7: s8(c[14]), p8: s16(18), p9: s16(20), p10: c[22],
        h1: (c[25] << 4) | (c[24] & 15), h2: (c[23] << 4) | (c[24] >> 4), h3: s8(c[26]), h4: s8(c[27]), h5: s8(c[28]), h6: c[29], h7: s8(c[30]),
        gh1: s8(c[35]), gh2: s16(33), gh3: s8(c[36]), resHeatVal: s8(c[37]), resHeatRange: (c[39] & 0x30) >> 4, rangeSwErr: s8(c[41] & 0xf0) >> 4 };
      this.ok = true;
      if (init) { this.filt = 2; this.osH = 2; this.osP = 3; this.osT = 4; this.conf(); this.setGasHeater(320, 150); } else this.setGasHeater(0, 0);
      this.mode(1);
      return true;
    }
    conf() { if (this.ok) this.set([[0x72, this.osH], [0x74, (this.osT << 5) | (this.osP << 2)], [0x75, this.filt << 2]]); return this.ok; }
    mode(m) { if (this.ok) this.set([[0x74, (this.osT << 5) | (this.osP << 2) | m]]); }
    setTemperatureOversampling(v) { if (v > 5) return false; this.osT = v; return this.conf(); }
    setHumidityOversampling(v) { if (v > 5) return false; this.osH = v; return this.conf(); }
    setPressureOversampling(v) { if (v > 5) return false; this.osP = v; return this.conf(); }
    setIIRFilterSize(v) { if (v > 7) return false; this.filt = v; return this.conf(); }
    setODR(v) { return v <= 8 && this.ok; }
    /** Chauffe du capteur de gaz : résistance de chauffe (calc_res_heat de Bosch) et durée codée (calc_gas_wait). */
    setGasHeater(temp, dur) {
      this.heat = !!(temp && dur); this.hT = temp; this.hD = dur;
      if (!this.ok) return false;
      if (!this.heat) { this.set([[0x71, 0x00]]); return true; }
      const c = this.cal, T = Math.min(400, temp);
      const v4 = (c.gh1 / 16 + 49) * (1 + ((c.gh2 / 32768) * 0.0005 + 0.00235) * T), v5 = v4 + (c.gh3 / 1024) * 25;
      const res = Math.trunc(3.4 * (v5 * (4 / (4 + c.resHeatRange)) * (1 / (1 + c.resHeatVal * 0.002)) - 25)) & 255;
      let d = dur, f = 0; if (d >= 0xfc0) d = 0xff; else { while (d > 0x3f) { d = Math.trunc(d / 4); f++; } d += f * 64; }
      this.set([[0x5a, res], [0x64, d], [0x71, 0x10]]);
      return true;
    }
    measDur() { return (OS_CYC[this.osT] + OS_CYC[this.osP] + OS_CYC[this.osH]) * 1963 + 477 * 9 + 1000; }
    beginReading() {
      if (this.start) return this.start + this.per;
      if (!this.ok) return 0;
      this.mode(1);
      this.start = Math.floor(now()) || 1; this.per = Math.trunc((this.measDur() + (this.heat ? this.hD * 1000 : 0)) / 1000);
      return this.start + this.per;
    }
    remainingReadingMillis() { return this.start ? Math.max(0, this.start + this.per - Math.floor(now())) : -1; }
    *endReading() {
      if (!this.beginReading()) return false;
      const rem = this.remainingReadingMillis();
      if (rem > 0) yield rem * 2;
      this.start = 0; this.per = 0;
      for (let i = 0; i < 5; i++) {
        const b = rd(this.a, 0x1d, 17); if (!b) return false;
        if (b[0] & 0x80) {
          const c = this.cal, at = (b[5] << 12) | (b[6] << 4) | (b[7] >> 4), ap = (b[2] << 12) | (b[3] << 4) | (b[4] >> 4), ah = (b[8] << 8) | b[9];
          const ag = (b[13] << 2) | (b[14] >> 6), rg = b[14] & 15, tf = bmeTfine(at, c);
          this.temperature = bmeTemp(at, c); this.pressure = bmePress(ap, tf, c); this.humidity = bmeHum(ah, tf, c);
          this.gas_resistance = b[14] & 0x30 ? bmeGas(ag, rg, c) : 0;
          return true;
        }
        yield 10;
      }
      return true;
    }
    *performReading() { return yield* this.endReading(); }
    *readTemperature() { return (yield* this.performReading()) ? this.temperature : NaN; }
    *readHumidity() { return (yield* this.performReading()) ? this.humidity : NaN; }
    *readPressure() { return (yield* this.performReading()) ? Math.trunc(this.pressure) : 0; }
    *readGas() { return (yield* this.performReading()) ? Math.trunc(this.gas_resistance) : 0; }
    *readAltitude(sea) { const p = yield* this.readPressure(); return 44330 * (1 - Math.pow(p / 100 / sea, 0.1903)); }
  }

  return {
    classes: { VL53L0X_RangingMeasurementData_t, Adafruit_VL53L0X, VL53L0X, MAX30105, Adafruit_TCS34725, Adafruit_CCS811, Adafruit_BME680 },
    fns: { checkForBeat, maxim_heart_rate_and_oxygen_saturation }
  };
}
