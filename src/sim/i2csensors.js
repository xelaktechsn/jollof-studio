// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Capteurs I2C : distance par temps de vol VL53L0X (ST), oxymètre de pouls MAX30102 (Analog Devices / Maxim), couleur
// TCS34725 (ams), qualité de l'air CCS811 (ScioSense / ams), environnement et gaz BME680 (Bosch). Un seul modèle par
// puce, au niveau des registres que lisent et écrivent les vraies bibliothèques (Adafruit_VL53L0X et VL53L0X de Pololu,
// SparkFun MAX3010x, Adafruit_TCS34725, Adafruit_CCS811, Adafruit_BME680), partagé par l'interpréteur (Wire de
// src/prog/runtime.js et ses bibliothèques simulées, src/prog/sensorlibs.js) et par les processeurs émulés
// (src/emu/devices/i2csensors.js) : l'analyseur de bus voit donc les mêmes trames partout.
// sensorI2c(comp, env) rend l'esclave I2C { start(écriture, adresse) → acquitté, write(octet), read(), stop() }.
// env : { clock() → secondes de temps virtuel, data() → mesures du capteur (MODELS de sim/models.js, c.simR.data) ou
// null, level(broche) → 1, 0 ou null (XSHUT du VL53L0X, WAKE du CCS811) }.
// Valeurs des registres : voir check/sources.js (section « Capteurs I2C »).

/** Puces de ce module, sur le bus I2C. */
export const SENSOR_I2C = ['vl53l0x', 'max30102', 'tcs34725', 'ccs811', 'bme680'];
export const isI2cSensor = t => SENSOR_I2C.includes(t);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hiNet = (A, comp, k) => !!(A && comp.pins && comp.pins[k] && A.net({ comp, key: k }).src.length);
const loNet = (A, comp, k) => !!(A && comp.pins && comp.pins[k] && A.net({ comp, key: k }).gnd.length);

/**
 * Adresses I2C de la puce. VL53L0X : 0x29 (ou celle donnée par setAddress, gardée sur comp.icState jusqu'à l'arrêt) ;
 * TCS34725 : 0x29 ; MAX30102 : 0x57 ; CCS811 : 0x5A, 0x5B quand ADDR est au VCC ; BME680 : 0x77 (SDO tirée au VCC sur
 * le module), 0x76 quand SDO est à la masse.
 */
export function sensorAddr(comp, A) {
  switch (comp.type) {
    case 'vl53l0x': { const s = comp.icState; return [s && s.t === 'vl53l0x' && s.addr ? s.addr : 0x29]; }
    case 'tcs34725': return [0x29];
    case 'max30102': return [0x57];
    case 'ccs811': return [hiNet(A, comp, 'ADDR') ? 0x5b : 0x5a];
    case 'bme680': return [loNet(A, comp, 'SDO') ? 0x76 : 0x77];
    default: return [];
  }
}

/** Petit générateur pseudo-aléatoire (bruit de mesure reproductible). */
function noise(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 - 0.5; };
}

/**
 * Esclave à registres : le premier octet écrit après le départ donne le pointeur (o.ptr peut le décoder : octet de
 * commande du TCS34725), les suivants sont écrits ; une lecture rend les registres à partir du pointeur. o.next(ptr)
 * dit où va le pointeur après un octet (il reste sur place sur une FIFO), o.read(ptr, n) reçoit le rang de l'octet
 * dans l'accès (boîte aux lettres du CCS811), o.stop(ptr, octets écrits) termine un accès. o.pairs : en écriture,
 * les octets suivants vont par paires registre, valeur (BME680).
 */
function regSlave(o) {
  let ptr = 0, first = false, n = 0, wrote = 0, writing = false;
  return {
    start(w, addr) {
      if (o.start && o.start(w, addr) === false) return false;
      first = !!w; writing = !!w; n = 0; wrote = 0;
      return true;
    },
    write(b) {
      b &= 255;
      if (first) { first = false; ptr = o.ptr ? o.ptr(b, ptr) : b; if (o.pointer) o.pointer(ptr); return true; }
      // Écritures par paires (BME680) : registre, valeur, registre, valeur…
      if (o.pairs && wrote++ % 2) { ptr = b; return true; }
      if (o.pairs) { o.write(ptr, b, wrote - 1); return true; }
      o.write(ptr, b, wrote++);
      ptr = o.next ? o.next(ptr) : (ptr + 1) & 255;
      return true;
    },
    read() { const v = o.read(ptr, n++) & 255; ptr = o.next ? o.next(ptr, true) : (ptr + 1) & 255; return v; },
    stop() { if (o.stop) o.stop(ptr, writing ? wrote : -1); first = false; writing = false; },
    get ptr() { return ptr; }
  };
}

/* ====================================================================================================================
 * VL53L0X : distance par temps de vol (module GY-VL53L0XV2)
 * ================================================================================================================== */
// Registres (vl53l0x_device.h de ST, VL53L0X.h de Pololu).
const VL = { START: 0x00, SEQ: 0x01, PERIOD: 0x04, INT_GPIO: 0x0a, INT_CLEAR: 0x0b, INT_STATUS: 0x13, RANGE_STATUS: 0x14,
  ADDR: 0x8a, OSC: 0xf8, PEAK_REF: 0xb6 };
/** Débit du signal renvoyé par une cible blanche (MCPS) : ≈ 120 à 10 cm, en 1/d² ; 0,3 MCPS à 2 m (mode longue portée). */
export const vlSignal = mm => clamp(120 * (100 / Math.max(mm, 10)) ** 2, 0, 500);
/** Portée du modèle (mm) : de 30 mm à 2 m ; au-delà, l'écho est trop faible (phase fail), la puce rend 8190. */
export const VL_RANGE = { min: 30, max: 2000, none: 8190 };
/**
 * Mesure rendue par la puce : distance (mm), état interne du registre RESULT_RANGE_STATUS (bits 6 à 3) : 11 mesure
 * valable, 9 phase fail (hors de portée, la bibliothèque d'ST en fait RangeStatus 4), 10 trop près (RangeStatus 3).
 */
export function vlRange(mm) {
  if (!(mm >= 0) || mm > VL_RANGE.max) return { mm: VL_RANGE.none, dev: 9, sig: 0.05 };
  if (mm < VL_RANGE.min) return { mm: Math.max(0, Math.round(mm)), dev: 10, sig: vlSignal(mm) };
  return { mm: Math.round(mm), dev: 11, sig: vlSignal(mm) };
}
// Mémoire non volatile lue par 0x94 / 0x90 : SPAD de référence (5, à ouverture), carte des SPAD utilisables (tous),
// identifiant du module ; le reste à zéro (pas de décalage d'étalonnage).
const VL_NVM = { 0x6b: 0x00008500, 0x24: 0xffffffff, 0x25: 0xffff0000, 0x02: 0x01000000, 0x7b: 0x10000000 };

function vl53l0x(comp, env) {
  const clock = env.clock || (() => 0), data = env.data || (() => null);
  const R = new Uint8Array(256);
  let bus = 0; // octets passés sur le bus : un octet dure 90 µs à 100 kHz (l'émulateur les échange sans délai)
  let mode = 0, tEnd = Infinity, period = 0, busyFor = 0;
  const now = () => clock() + bus * 90e-6;
  function por() {
    R.fill(0);
    R[0xc0] = 0xee; R[0xc1] = 0xaa; R[0xc2] = 0x10; // identifiant du modèle, type, révision (coupe 1.1)
    R[0x91] = 0x3c; R[0x89] = 0x00; R[VL.SEQ] = 0xff; R[VL.INT_GPIO] = 0x01;
    R[0x50] = 0x06; R[0x70] = 0x04; R[0x46] = 0x0c; R[0x51] = 0x00; R[0x52] = 0x2a; R[0x71] = 0x00; R[0x72] = 0xd6;
    R[0x44] = 0x00; R[0x45] = 0x20; // limite du signal : 0,25 MCPS (9.7)
    mode = 0; tEnd = Infinity;
  }
  por();
  const dur = () => ((R[VL.SEQ] & 0x80) ? 0.033 : 0.006); // mesure complète ≈ 33 ms ; étalonnages VHV / phase ≈ 6 ms
  function result() {
    const d = data(), r = vlRange(d && d.mm != null ? d.mm : 500), w = (a, v) => { R[a] = (v >> 8) & 255; R[a + 1] = v & 255; };
    R[VL.RANGE_STATUS] = (r.dev << 3) | 1;
    w(0x16, 0x0800); // nombre effectif de SPAD (8.8) : 8
    // Signal renvoyé, MCPS en 9.7. Sur un AVR (int de 16 bits), la bibliothèque d'ST ne garde que les 7 bits de la
    // partie fractionnaire en le convertissant (Value << 9) : ils restent dans la moitié haute, comme une mesure réelle
    // assez forte, pour que ses contrôles (signal par SPAD, sigma) acceptent les mesures dans la portée.
    w(0x1a, ((Math.min(511, Math.floor(r.sig)) << 7) | (r.dev === 11 ? 0x60 + Math.round((r.sig % 1) * 31) : Math.round((r.sig % 1) * 127))) & 0xffff);
    w(0x1c, Math.round(0.03 * 128)); // lumière ambiante : 0,03 MCPS
    w(0x1e, r.mm);
    R[VL.INT_STATUS] = 0x04; // nouvelle mesure prête
  }
  /** Mesure terminée entre-temps : résultat publié ; en continu, la suivante démarre. */
  function sync() {
    const t = now();
    if (t < tEnd) return;
    result();
    if (mode === 2) tEnd = Math.max(tEnd + dur(), t);
    else if (mode === 4) tEnd = Math.max(tEnd + Math.max(dur(), period), t);
    else tEnd = Infinity;
  }
  function begin(v) {
    const t = now();
    if (v & 0x02) { mode = 2; tEnd = t + dur(); }
    else if (v & 0x04) { const osc = (R[VL.OSC] << 8) | R[VL.OSC + 1], p = ((R[4] << 24) | (R[5] << 16) | (R[6] << 8) | R[7]) >>> 0; period = (osc ? p / osc : p) / 1000; mode = 4; tEnd = t + Math.max(dur(), period); }
    else if (v & 0x01) { mode = 1; tEnd = t + dur(); }
    else { mode = 0; tEnd = Infinity; } // arrêt
    R[VL.START] = v & ~0x01; // le bit de départ retombe dès que la mesure a commencé
  }
  const off = () => env.level && env.level('XSHUT') === 0;
  const own = () => sensorAddr(comp)[0];
  const sl = regSlave({
    start(w, addr) { if (off() || (addr != null && addr !== own())) return false; bus++; return true; },
    write(r, v) {
      bus++;
      if (r === VL.START) { begin(v); return; }
      if (r === VL.INT_CLEAR) { if (v & 7) { sync(); R[VL.INT_STATUS] = 0; R[VL.RANGE_STATUS] &= ~1; } R[r] = v; return; }
      if (r === 0x94) { const d = VL_NVM[v] || 0; R[0x90] = d >>> 24; R[0x91] = (d >> 16) & 255; R[0x92] = (d >> 8) & 255; R[0x93] = d & 255; R[r] = v; return; }
      if (r === VL.ADDR) { const a = v & 0x7f; comp.icState = { t: 'vl53l0x', addr: a }; R[r] = a; return; }
      if (r === 0xbf && v === 0x00) { por(); return; } // remise à zéro logicielle (SOFT_RESET_GO2_SOFT_RESET_N)
      if (r >= 0xc0 && r <= 0xc2) return; // identifiants en lecture seule
      R[r] = v;
    },
    read(r) {
      bus++;
      sync();
      if (r === 0x83) return R[0x83] || 0x10; // « strobe » de lecture de la mémoire non volatile : toujours prêt
      if (r === VL.PEAK_REF) return 0x0c; // signal de référence : 24 MCPS (9.7), au-dessus de la cible de 20 MCPS
      if (r === VL.PEAK_REF + 1) return 0x00;
      if (r === 0xbf) return 0x01; // sortie de remise à zéro
      return R[r];
    }
  });
  return sl;
}

/* ====================================================================================================================
 * MAX30102 : oxymètre de pouls et fréquence cardiaque
 * ================================================================================================================== */
const MX = { INT1: 0x00, INT2: 0x01, EN1: 0x02, EN2: 0x03, WR: 0x04, OVF: 0x05, RD: 0x06, DATA: 0x07, FIFO_CFG: 0x08, MODE: 0x09,
  SPO2: 0x0a, LED1: 0x0c, LED2: 0x0d, LED3: 0x0e, PILOT: 0x10, SLOT12: 0x11, SLOT34: 0x12, TINT: 0x1f, TFRAC: 0x20, TCFG: 0x21, REV: 0xfe, PART: 0xff };
const MX_RATES = [50, 100, 200, 400, 800, 1000, 1600, 3200];
const MX_PW = [69, 118, 215, 411]; // µs, résolution 15 à 18 bits
const MX_RANGE = [2048, 4096, 8192, 16384]; // nA pleine échelle
/**
 * Rapport R = (AC/DC rouge) ÷ (AC/DC infrarouge) qui donne cette saturation avec la formule de Maxim (exemple de
 * référence, spo2_algorithm.cpp) : SpO2 = −45,060 R² + 30,354 R + 94,845, racine physiologique (R de 0,34 à 1).
 */
export function ratioFor(spo2) {
  const a = -45.06, b = 30.354, c = 94.845 - clamp(spo2, 0, 100), d = b * b - 4 * a * c;
  return d <= 0 ? -b / (2 * a) : (-b - Math.sqrt(d)) / (2 * a);
}
/** Onde de pouls (0 au repos, 1 au sommet systolique) : montée rapide, onde dicrote vers 45 % du cycle. */
export function ppgShape(ph) {
  ph -= Math.floor(ph);
  const g = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2);
  return g(ph, 0.16, 0.055) + 0.32 * g(ph, 0.45, 0.07);
}
/**
 * Comptes de la FIFO (18 bits) pour une LED (0 rouge, 1 infrarouge, 2 sans LED sur le MAX30102). k : facteur du
 * réglage (courant de la LED, largeur d'impulsion, pleine échelle) ; ph : phase du pouls ; d : { finger, spo2 }.
 * Doigt posé, réglages de l'exemple SparkFun (6,4 mA, 411 µs, 4096 nA) : infrarouge ≈ 110 000, rouge ≈ 88 000,
 * pulsation de ≈ 0,4 % de l'infrarouge (≈ 450 comptes crête à crête), rouge selon le rapport R. Sans doigt :
 * lumière ambiante seule, quelques centaines de comptes.
 */
export function ppgCounts(led, k, ph, d, n = 0) {
  if (led === 2) return Math.max(0, Math.round(40 + n * 20));
  if (!d || !d.finger) return Math.max(0, Math.round((led ? 900 : 700) * k + n * 30));
  const R = ratioFor(d.spo2 ?? 98), mIr = 0.004, dc = (led ? 110000 : 88000) * k, m = led ? mIr : mIr * R;
  return clamp(Math.round(dc * (1 - m * ppgShape(ph)) + n * 12 * k), 0, 0x3ffff);
}

function max30102(comp, env) {
  const clock = env.clock || (() => 0), data = env.data || (() => null), rnd = noise(0x30102);
  const R = new Uint8Array(256);
  let fifo = [], cur = null, byte = 0, ph = 0, tLast = null, carry = 0, ppgRdy = false, pwrRdy = true, tempAt = Infinity, tempRdy = false;
  function por() { R.fill(0); R[MX.PART] = 0x15; R[MX.REV] = 0x03; fifo = []; cur = null; byte = 0; tLast = null; carry = 0; pwrRdy = true; tempAt = Infinity; tempRdy = false; }
  por();
  /** Voies d'un échantillon (LED de chaque créneau) : rouge seule, rouge + infrarouge, ou créneaux du mode multi-LED. */
  function leds() {
    const m = R[MX.MODE] & 7;
    if (m === 2) return [0];
    if (m === 3) return [0, 1];
    if (m === 7) return [R[MX.SLOT12] & 7, (R[MX.SLOT12] >> 4) & 7, R[MX.SLOT34] & 7, (R[MX.SLOT34] >> 4) & 7].filter(s => s).map(s => (s === 1 || s === 5 ? 0 : s === 2 || s === 6 ? 1 : 2));
    return [];
  }
  const rate = () => MX_RATES[(R[MX.SPO2] >> 2) & 7] / Math.min(32, 1 << ((R[MX.FIFO_CFG] >> 5) & 7));
  const factor = led => {
    const amp = R[led ? MX.LED2 : MX.LED1] / 0x1f, pw = MX_PW[R[MX.SPO2] & 3] / 411, rg = 4096 / MX_RANGE[(R[MX.SPO2] >> 5) & 3];
    return amp * pw * rg;
  };
  /** Échantillons produits depuis le dernier passage, à la cadence réglée, dans la FIFO de 32 places. */
  function sync() {
    const t = clock();
    if (tempAt <= t) { tempAt = Infinity; tempRdy = true; const T = clamp((data() || {}).temp ?? 25, -40, 85), q = Math.round(T * 16); R[MX.TINT] = (Math.floor(q / 16)) & 255; R[MX.TFRAC] = q - Math.floor(q / 16) * 16; R[MX.TCFG] = 0; }
    const ch = leds(), on = !(R[MX.MODE] & 0x80) && ch.length;
    if (tLast == null || !on) { tLast = t; return; }
    const fs = rate(), dt = t - tLast; tLast = t;
    if (dt <= 0) return;
    let n = dt * fs + carry; const whole = Math.floor(n); carry = n - whole;
    const d = data() || {}, bpm = clamp(d.bpm ?? 72, 20, 250), step = bpm / 60 / fs, res = 3 - (R[MX.SPO2] & 3); // bits de poids faible à zéro
    for (let i = Math.max(0, whole - 64); i < whole; i++) {
      ph += step;
      const s = ch.map(led => { const v = led === 2 ? ppgCounts(2, 1, ph, d, rnd()) : ppgCounts(led, factor(led), ph, d, rnd()); return (v >> res) << res; });
      if (fifo.length >= 32) {
        if (!(R[MX.FIFO_CFG] & 0x10)) { R[MX.OVF] = Math.min(31, R[MX.OVF] + 1); continue; } // FIFO pleine, sans recouvrement : perdu
        fifo.shift(); R[MX.RD] = (R[MX.RD] + 1) & 31; R[MX.OVF] = Math.min(31, R[MX.OVF] + 1);
      }
      fifo.push(s); R[MX.WR] = (R[MX.WR] + 1) & 31; ppgRdy = true;
    }
    ph -= Math.floor(ph);
  }
  function fifoByte() {
    if (!cur) { if (!fifo.length) return 0; cur = fifo[0]; byte = 0; }
    const v = cur[Math.floor(byte / 3)] || 0, b = byte % 3, out = b === 0 ? (v >> 16) & 3 : b === 1 ? (v >> 8) & 255 : v & 255;
    if (++byte >= cur.length * 3) { fifo.shift(); cur = null; R[MX.RD] = (R[MX.RD] + 1) & 31; }
    return out;
  }
  return regSlave({
    next: (r, rd) => (r === MX.DATA ? r : (r + 1) & 255),
    pointer: () => { cur = null; },
    write(r, v) {
      sync();
      if (r === MX.MODE && (v & 0x40)) { por(); return; } // remise à zéro : registres à leur valeur d'origine, aussitôt faite
      if (r === MX.WR || r === MX.RD || r === MX.OVF) {
        R[r] = v & 31;
        // FIFO vidée (clearFIFO écrit 0 dans les trois) ou pointeurs déplacés : on garde ce qui est entre les deux.
        const cnt = (R[MX.WR] - R[MX.RD] + 32) & 31; if (fifo.length > cnt) fifo = fifo.slice(fifo.length - cnt); cur = null; return;
      }
      if (r === MX.TCFG) { R[r] = v & 1; if (v & 1) tempAt = clock() + 0.029; return; } // conversion de la température : 29 ms
      if (r === MX.PART || r === MX.REV || r === MX.INT1 || r === MX.INT2 || r === MX.TINT || r === MX.TFRAC) return;
      R[r] = v;
    },
    read(r) {
      sync();
      if (r === MX.DATA) return fifoByte();
      if (r === MX.INT1) {
        const full = fifo.length >= 32 - (R[MX.FIFO_CFG] & 15);
        const v = (full ? 0x80 : 0) | (ppgRdy ? 0x40 : 0) | (pwrRdy ? 0x01 : 0); ppgRdy = false; pwrRdy = false; return v;
      }
      if (r === MX.INT2) { const v = tempRdy ? 0x02 : 0; tempRdy = false; return v; }
      if (r === MX.TFRAC) { tempRdy = false; return R[r]; }
      return R[r];
    }
  });
}

/* ====================================================================================================================
 * TCS34725 : couleur (rouge, vert, bleu, clair)
 * ================================================================================================================== */
const TCS_GAIN = [1, 4, 16, 60];
/**
 * Comptes bruts (rouge, vert, bleu, clair) : lumière de cette couleur (entier 0xRRGGBB) et de cet éclairement (lx),
 * temps d'intégration (ms) et gain. Échelle choisie pour que calculateLux() de la bibliothèque Adafruit redonne
 * l'éclairement d'une lumière blanche à 614 ms et gain 1 (réglage de son exemple) ; le canal clair est la somme des
 * trois (pas d'infrarouge). Saturation : 1024 comptes par pas de 2,4 ms, 65 535 au plus.
 */
export function tcsCounts(rgb, lux, tMs, gain) {
  const c = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255].map(x => x / 255), mean = (c[0] + c[1] + c[2]) / 3;
  const sat = Math.min(65535, Math.round(1024 * tMs / 2.4));
  if (mean <= 0) return { r: 0, g: 0, b: 0, c: 0, sat };
  const k = Math.max(0, lux) * (tMs / 614.4) * gain / 0.5218, ch = c.map(x => Math.min(sat, Math.round(k * x / mean)));
  return { r: ch[0], g: ch[1], b: ch[2], c: Math.min(sat, ch[0] + ch[1] + ch[2]), sat };
}

function tcs34725(comp, env) {
  const clock = env.clock || (() => 0), data = env.data || (() => null);
  const R = new Uint8Array(32);
  let tOn = null, cycles = 0;
  const por = () => { R.fill(0); R[0x01] = 0xff; R[0x03] = 0xff; R[0x12] = 0x44; tOn = null; cycles = 0; };
  por();
  const tInt = () => (256 - R[0x01]) * 2.4; // ms
  const tWait = () => (R[0x00] & 0x08 ? (256 - R[0x03]) * 2.4 * (R[0x0d] & 0x02 ? 12 : 1) : 0);
  /** Fin de chaque cycle d'intégration (intégration, puis attente si WEN) : nouvelles données, AVALID. */
  function sync() {
    if (tOn == null) return;
    const n = Math.floor((clock() - tOn) * 1000 / (tInt() + tWait()) + 1e-9);
    if (n < 1 || n === cycles) return;
    cycles = n;
    const d = data() || {}, k = tcsCounts(d.rgb ?? 0xffffff, d.lux ?? 300, tInt(), TCS_GAIN[R[0x0f] & 3]);
    [[0x14, k.c], [0x16, k.r], [0x18, k.g], [0x1a, k.b]].forEach(([a, v]) => { R[a] = v & 255; R[a + 1] = v >> 8; });
    R[0x13] |= 0x01;
  }
  return regSlave({
    // Octet de commande : bit 7, puis le type (01 : adresses qui avancent, 11 : fonction spéciale) et l'adresse.
    ptr: (b, old) => (!(b & 0x80) ? old : (b & 0x60) === 0x60 ? ((b & 0x1f) === 0x06 ? (R[0x13] &= ~0x10, old) : old) : b & 0x1f),
    next: r => (r + 1) & 0x1f,
    write(r, v) {
      sync();
      if (r === 0x00) {
        const was = R[0] & 3; R[0] = v & 0x1b;
        if ((v & 3) === 3 && was !== 3) { tOn = clock(); cycles = 0; R[0x13] &= ~1; }
        if ((v & 3) !== 3) tOn = null;
        return;
      }
      if (r === 0x12 || r === 0x13 || r >= 0x14) return;
      R[r] = v;
    },
    read(r) { sync(); return R[r]; }
  });
}

/* ====================================================================================================================
 * CCS811 : qualité de l'air (équivalent CO₂ et composés organiques volatils) — module CJMCU-811
 * ================================================================================================================== */
const CCS_PERIOD = [0, 1, 10, 60, 0.25]; // s, selon DRIVE_MODE (4 : 250 ms, données brutes seulement)
/** eCO₂ (ppm, 400 à 8192) et COV totaux (ppb, 0 à 1187) que rend l'algorithme pour cette pollution (ppm équivalent CO₂). */
export function ccsValues(air) {
  const eco2 = Math.round(clamp(air ?? 400, 400, 8192));
  return { eco2, tvoc: Math.round(clamp((eco2 - 400) * 0.15, 0, 1187)) };
}

function ccs811(comp, env) {
  const clock = env.clock || (() => 0), data = env.data || (() => null);
  let app = false, meas = 0, t0 = 0, n0 = 0, ready = false, err = 0, alg = [0, 0, 0, 0, 0, 0, 0, 0], reset = [];
  const status = () => (app ? 0x90 : 0x10) | (ready ? 0x08 : 0) | (err ? 0x01 : 0);
  function sync() {
    const p = CCS_PERIOD[(meas >> 4) & 7];
    if (!app || !p) return;
    const n = Math.floor((clock() - t0) / p);
    if (n <= n0) return;
    n0 = n;
    const d = data() || {}, v = d.eco2 != null ? { eco2: d.eco2, tvoc: d.tvoc } : ccsValues(400);
    const cur = 16, adc = clamp(Math.round(700 - (v.eco2 - 400) * 0.06), 120, 1023), raw = (cur << 10) | adc;
    if (((meas >> 4) & 7) !== 4) alg = [v.eco2 >> 8, v.eco2 & 255, v.tvoc >> 8, v.tvoc & 255, 0, 0, raw >> 8, raw & 255];
    else { alg[6] = raw >> 8; alg[7] = raw & 255; }
    ready = true;
  }
  const awake = () => !env.level || env.level('WAKE') === 0;
  const bad = id => { err |= id; };
  return regSlave({
    start() { return awake(); },
    next: r => r, // boîte aux lettres : le pointeur ne bouge pas, les octets se suivent dans le registre
    write(r, v, i) {
      sync();
      if (r === 0xff) { reset[i] = v; return; }
      if (r === 0x01) { if (!app) { bad(0x01); return; } if (((v >> 4) & 7) > 4) { bad(0x04); return; } meas = v & 0x7c; t0 = clock(); n0 = 0; ready = false; return; }
      if (r === 0x05 || r === 0x10 || r === 0x11) return; // compensation, seuils, référence : acceptés
      if (r >= 0xf1 && r <= 0xf3) return;
      bad(0x01);
    },
    read(r, i) {
      sync();
      switch (r) {
        case 0x00: return status();
        case 0x01: return meas;
        case 0x02: { const v = i < 8 ? (i === 4 ? status() : i === 5 ? err : alg[i]) : 0; if (i === 7 || i === 3) ready = false; return v; }
        case 0x03: return alg[6 + (i & 1)];
        case 0x20: return 0x81; // HW_ID
        case 0x21: return 0x12; // HW_VERSION
        case 0x23: return [0x10, 0x00][i] ?? 0;
        case 0x24: return [0x20, 0x00][i] ?? 0;
        case 0xe0: { const e = err; err = 0; return e; }
        case 0x11: return [0x84, 0x7f][i] ?? 0;
        default: bad(0x02); return 0;
      }
    },
    stop(ptr, wrote) {
      if (ptr === 0xf4 && wrote === 0 && !app) { app = true; return; } // APP_START : le micrologiciel démarre
      if (ptr === 0xff && reset.length >= 4 && reset[0] === 0x11 && reset[1] === 0xe5 && reset[2] === 0x72 && reset[3] === 0x8a) { app = false; meas = 0; ready = false; err = 0; alg = [0, 0, 0, 0, 0, 0, 0, 0]; }
      reset = [];
    }
  });
}

/* ====================================================================================================================
 * BME680 : température, humidité, pression et résistance du capteur de gaz (module GY-BME680)
 * ================================================================================================================== */
/** Coefficients d'étalonnage d'un exemplaire (ordre de grandeur de puces réelles), écrits en 0x8A, 0xE1 et 0x00. */
export const BME_CAL = { t1: 26266, t2: 26413, t3: 3, p1: 36477, p2: -10609, p3: 88, p4: 7128, p5: -120, p6: 30, p7: 61, p8: -2464, p9: -2600, p10: 30,
  h1: 768, h2: 1010, h3: 0, h4: 45, h5: 20, h6: 120, h7: -100, gh1: -30, gh2: -12000, gh3: 18, resHeatVal: 40, resHeatRange: 1, rangeSwErr: 0 };
const C = BME_CAL;
// Les formules prennent les coefficients en dernier argument : ceux de la puce simulée par défaut, ceux qu'une
// bibliothèque a relus dans ses registres sinon.
/** Formules en virgule flottante de l'API de Bosch (bme68x.c, BME68X_USE_FPU) : t_fine, °C, Pa, %HR, Ω. */
export const bmeTfine = (a, C = BME_CAL) => ((a / 16384 - C.t1 / 1024) * C.t2) + ((a / 131072 - C.t1 / 8192) ** 2) * (C.t3 * 16);
export const bmeTemp = (a, C = BME_CAL) => bmeTfine(a, C) / 5120;
export function bmePress(a, tf, C = BME_CAL) {
  let v1 = tf / 2 - 64000, v2 = v1 * v1 * (C.p6 / 131072);
  v2 = v2 + v1 * C.p5 * 2; v2 = v2 / 4 + C.p4 * 65536;
  v1 = ((C.p3 * v1 * v1) / 16384 + C.p2 * v1) / 524288; v1 = (1 + v1 / 32768) * C.p1;
  let p = 1048576 - a;
  if (Math.trunc(v1) === 0) return 0;
  p = ((p - v2 / 4096) * 6250) / v1;
  const w1 = (C.p9 * p * p) / 2147483648, w2 = p * (C.p8 / 32768), w3 = (p / 256) ** 3 * (C.p10 / 131072);
  return p + (w1 + w2 + w3 + C.p7 * 128) / 16;
}
export function bmeHum(a, tf, C = BME_CAL) {
  const tc = tf / 5120, v1 = a - (C.h1 * 16 + (C.h3 / 2) * tc);
  const v2 = v1 * ((C.h2 / 262144) * (1 + (C.h4 / 16384) * tc + (C.h5 / 1048576) * tc * tc));
  const h = v2 + (C.h6 / 16384 + (C.h7 / 2097152) * tc) * v2 * v2;
  return clamp(h, 0, 100);
}
const K1 = [0, 0, 0, 0, 0, -1, 0, -0.8, 0, 0, -0.2, -0.5, 0, -1, 0, 0], K2 = [0, 0, 0, 0, 0.1, 0.7, 0, -0.8, -0.1, 0, 0, 0, 0, 0, 0, 0];
export function bmeGas(adc, range, C = BME_CAL) {
  const v2 = (1340 + 5 * C.rangeSwErr) * (1 + K1[range] / 100), v3 = 1 + K2[range] / 100;
  return 1 / (v3 * 0.000000125 * (1 << range) * ((adc - 512) / v2 + 1));
}
/** Plus petite mesure brute (entier de lo à hi) pour laquelle f croissante atteint la valeur voulue. */
function invert(f, want, lo, hi, up = true) {
  while (lo < hi) { const m = Math.floor((lo + hi) / 2); if (up ? f(m) >= want : f(m) <= want) hi = m; else lo = m + 1; }
  return lo;
}
/** Mesures brutes (ADC) qui redonnent ces grandeurs par les formules de Bosch : { t, p, h, gas, range }. */
export function bmeRaw(temp, press, hum, gasOhm) {
  const t = invert(bmeTemp, clamp(temp, -40, 85), 0, 0xfffff), tf = bmeTfine(t);
  const p = invert(a => bmePress(a, tf), clamp(press, 300, 1100) * 100, 0, 0xfffff, false);
  const h = invert(a => bmeHum(a, tf), clamp(hum, 0, 100), 0, 0xffff);
  const R = clamp(gasOhm, 1500, 5e7);
  let range = clamp(Math.round(Math.log2(8.6e6 / R)), 0, 15);
  const v2 = (1340 + 5 * C.rangeSwErr) * (1 + K1[range] / 100), v3 = 1 + K2[range] / 100;
  const gas = clamp(Math.round(512 + v2 * (1 / (v3 * 0.000000125 * (1 << range) * R) - 1)), 0, 1023);
  return { t, p, h, gas, range };
}
/** Résistance du capteur de gaz (Ω) : ≈ 120 kΩ dans un air propre (400 ppm), plus basse quand l'air se charge. */
export const bmeGasOhm = air => 120000 * Math.pow(400 / clamp(air ?? 400, 400, 10000), 0.7);

function bme680(comp, env) {
  const clock = env.clock || (() => 0), data = env.data || (() => null);
  const R = new Uint8Array(256);
  let tEnd = Infinity, meas = 0;
  function calib() {
    // Bloc 1 (0x8A, 23 octets) et bloc 2 (0xE1, 14 octets) : positions de bme68x_defs.h (BME68X_IDX_…).
    const a = new Uint8Array(42);
    const s16 = (i, v) => { a[i] = v & 255; a[i + 1] = (v >> 8) & 255; };
    s16(0, C.t2); a[2] = C.t3 & 255; s16(4, C.p1); s16(6, C.p2); a[8] = C.p3 & 255; s16(10, C.p4); s16(12, C.p5); a[14] = C.p7 & 255; a[15] = C.p6 & 255;
    s16(18, C.p8); s16(20, C.p9); a[22] = C.p10 & 255;
    a[23] = (C.h2 >> 4) & 255; a[24] = ((C.h2 & 15) << 4) | (C.h1 & 15); a[25] = (C.h1 >> 4) & 255; a[26] = C.h3 & 255; a[27] = C.h4 & 255; a[28] = C.h5 & 255;
    a[29] = C.h6 & 255; a[30] = C.h7 & 255; s16(31, C.t1); s16(33, C.gh2); a[35] = C.gh1 & 255; a[36] = C.gh3 & 255;
    a[37] = C.resHeatVal & 255; a[39] = (C.resHeatRange & 3) << 4; a[41] = (C.rangeSwErr & 15) << 4;
    for (let i = 0; i < 23; i++) R[0x8a + i] = a[i];
    for (let i = 0; i < 14; i++) R[0xe1 + i] = a[23 + i];
    for (let i = 0; i < 5; i++) R[0x00 + i] = a[37 + i];
  }
  function por() { R.fill(0, 0x1d, 0x80); R.fill(0, 0x50, 0x76); R[0xd0] = 0x61; R[0xf0] = 0x00; R[0x1d] = 0; tEnd = Infinity; calib(); }
  R.fill(0); por();
  const OS = [0, 1, 2, 4, 8, 16, 16, 16];
  /** Durée d'une mesure forcée (µs, bme68x_get_meas_dur) plus la chauffe du capteur de gaz (gas_wait_0). */
  function duration() {
    const cyc = OS[(R[0x74] >> 5) & 7] + OS[(R[0x74] >> 2) & 7] + OS[R[0x72] & 7];
    let us = cyc * 1963 + 477 * 4 + 477 * 5 + 1000;
    if (R[0x71] & 0x10) { const w = R[0x64]; us += (w & 0x3f) * [1, 4, 16, 64][w >> 6] * 1000; }
    return us / 1e6;
  }
  function finish() {
    const d = data() || {}, raw = bmeRaw(d.temp ?? 25, d.press ?? 1013.25, d.hum ?? 50, d.gas ?? bmeGasOhm(400));
    const put20 = (at, v, os) => { if (!os) v = 0x80000; R[at] = (v >> 12) & 255; R[at + 1] = (v >> 4) & 255; R[at + 2] = (v & 15) << 4; };
    put20(0x1f, raw.p, (R[0x74] >> 2) & 7); put20(0x22, raw.t, (R[0x74] >> 5) & 7);
    if (R[0x72] & 7) { R[0x25] = raw.h >> 8; R[0x26] = raw.h & 255; } else { R[0x25] = 0x80; R[0x26] = 0; }
    const gas = !!(R[0x71] & 0x10), stab = gas && R[0x5a] !== 0 && (R[0x64] & 0x3f) * [1, 4, 16, 64][R[0x64] >> 6] >= 20;
    R[0x2a] = gas ? raw.gas >> 2 : 0; R[0x2b] = gas ? ((raw.gas & 3) << 6) | 0x20 | (stab ? 0x10 : 0) | raw.range : 0;
    R[0x1d] = 0x80 | (R[0x71] & 15); R[0x1e] = (R[0x1e] + 1) & 255;
    R[0x74] &= ~3; // de retour en sommeil
  }
  function sync() { if (clock() >= tEnd) { tEnd = Infinity; meas = 0; finish(); } }
  return regSlave({
    pairs: true,
    write(r, v) {
      sync();
      if (r === 0xe0) { if (v === 0xb6) por(); return; }
      if (r === 0xd0 || r === 0xf0 || (r >= 0x1d && r <= 0x3b) || (r >= 0x8a && r < 0xa1) || (r >= 0xe1 && r < 0xef) || r < 0x05) return;
      if (r === 0x74) {
        R[r] = v;
        if ((v & 3) === 1) { meas = 1; tEnd = clock() + duration(); R[0x1d] = 0x20 | ((R[0x71] & 0x10) ? 0x40 : 0); }
        return;
      }
      R[r] = v;
    },
    read(r) {
      sync();
      if (r === 0x74 && meas) return R[r] | 1; // mesure forcée en cours : la puce n'est pas encore revenue en sommeil
      return R[r];
    }
  });
}

/**
 * Esclave I2C de la puce (un objet par composant et par moteur ; l'état vit dans l'objet, remis à zéro avec le moteur,
 * sauf l'adresse donnée au VL53L0X, sur comp.icState).
 */
export function sensorI2c(comp, env = {}) {
  switch (comp.type) {
    case 'vl53l0x': return vl53l0x(comp, env);
    case 'max30102': return max30102(comp, env);
    case 'tcs34725': return tcs34725(comp, env);
    case 'ccs811': return ccs811(comp, env);
    case 'bme680': return bme680(comp, env);
    default: return null;
  }
}
