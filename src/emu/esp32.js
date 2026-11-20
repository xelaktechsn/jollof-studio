// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mode « fidèle » de l'ESP32, de l'ESP32-S3 et de l'ESP32-C3 : le vrai programme (compilé par arduino-cli, avec la cale
// src/emu/esp32-shim/jollof_qemu_shim.cpp) tourne dans QEMU, l'émulateur d'Espressif, lancé comme un programme à part
// (src-tauri/src/qemu.rs ; les tests passent par src/emu/esp32-node.mjs). Le moteur expose la même interface que ceux
// de l'Uno (avr.js) et du Pico (rp2040.js) : broches, temps de la carte, port série, sondes.
//   Sorties : QEMU trace les écritures du programme dans les registres GPIO et LEDC ; on en déduit le niveau de chaque
//     broche, et, pour le LEDC (analogWrite, ledcWrite, tone(), servo), le rapport cyclique et la fréquence réglés.
//   Entrées : le modèle GPIO de QEMU ne garde rien ; la cale du programme lit les niveaux et l'ADC que le moteur lui
//     envoie par l'UART1, et appelle les fonctions attachées (attachInterrupt) aux fronts.
//   Modules du montage (I2C, SPI, 1-Wire, signaux temporisés, ports série, NeoPixel) : la cale fait passer leurs
//     échanges par l'UART1 vers les modèles de src/emu/devices (src/emu/esp32-bridge.js).
//   Temps : QEMU tourne en temps réel, à son rythme ; le temps de la carte (millis()) arrive par le battement de la
//     cale, toutes les 10 ms. run(dt) n'avance rien : il relève les entrées et analyse les sorties.
// Limites : ni Wi-Fi ni Bluetooth (src/emu/esp32-limits.js).
import { pinMap } from '../prog/runtime.js';
import { tl } from '../i18n/index.js';
import { UNBRIDGED, unbridgedWarning } from './esp32-limits.js';
import { createBridge, maskBytes } from './esp32-bridge.js';

const APB_HZ = 80e6, REF_HZ = 1e6;
const WINDOW = 60;        // ms : fenêtre d'analyse des fronts (signaux faits à coups de digitalWrite)
const RING = 256;         // fronts gardés par broche
const ADC_REF = 3.3, ADC_MAX = 4095;
const LOOP_RESETS = 3, LOOP_MS = 15000; // trois redémarrages en 15 s : la carte boucle, on l'arrête
const STALL_MS = 3000;    // plus de battement de la cale depuis 3 s : programme bloqué
// Lignes écrites par la mémoire morte et le chargeur d'amorçage à chaque démarrage (115200 bauds) : ESP32, puis
// ESP32-S3 et ESP32-C3 (« ESP-ROM:esp32s3-20210327 », « Build:Mar 27 2021 », « SPIWP:0xee »…).
const BANNER = /^(ets [A-Z][a-z]{2} +\d|rst:0x|configsip:|clk_drv:|mode:(DIO|QIO|DOUT|QOUT)|load:0x|entry 0x|ho \d+ tail|ESP-ROM:|Build:[A-Z][a-z]{2} |SPIWP:|Saved PC:)/;
const BANNER_HEADS = ['ets ', 'rst:', 'conf', 'clk_', 'mode', 'load', 'entr', 'ho ', 'ESP-', 'Buil', 'SPIW', 'Save'];
const RESET = /^rst:0x[0-9a-f]+ \(([A-Z0-9_]+)\)/;
const PANIC = /Guru Meditation Error: Core +\d+ panic'ed \(([^)]+)\)|abort\(\) was called|assert failed: (.+)/;
const REASONS = {
  SW_CPU_RESET: () => tl('redémarrage logiciel (ESP.restart() ou plantage)'), RTC_SW_CPU_RST: () => tl('redémarrage logiciel (ESP.restart() ou plantage)'),
  TG0WDT_SYS_RST: () => tl('chien de garde'), TG1WDT_SYS_RST: () => tl('chien de garde'), RTCWDT_RTC_RST: () => tl('chien de garde'),
  TG0WDT_SYS_RESET: () => tl('chien de garde'), TG1WDT_SYS_RESET: () => tl('chien de garde'),
  RTCWDT_SYS_RESET: () => tl('chien de garde'), RTCWDT_RTC_RESET: () => tl('chien de garde'),
  DEEPSLEEP_RESET: () => tl('réveil du sommeil profond')
};

/**
 * Puces émulées par QEMU (manuels de référence technique d'Espressif) : machine de QEMU, programme (xtensa ou
 * riscv32), adresses des registres GPIO et LEDC, premier registre GPIO_FUNCn_OUT_SEL_CFG, nombre de GPIO, masque des
 * GPIO 32 et plus, numéro du premier signal du LEDC dans la matrice des GPIO, organisation du LEDC (« esp32 » : 8 voies
 * rapides puis 8 lentes ; « ls » : voies lentes seulement), offset du chargeur d'amorçage dans la flash.
 */
export const CHIPS = {
  esp32: { machine: 'esp32', arch: 'xtensa', gpio: 0x3ff44000, ledc: 0x3ff59000, outSel: 0x530, pins: 40, hiMask: 0xff, ledcSig: 71, channels: 16, layout: 'esp32', boot: 0x1000 },
  esp32s3: { machine: 'esp32s3', arch: 'xtensa', gpio: 0x60004000, ledc: 0x60019000, outSel: 0x554, pins: 49, hiMask: 0x3fffff, ledcSig: 73, channels: 8, layout: 'ls', boot: 0 },
  esp32c3: { machine: 'esp32c3', arch: 'riscv32', gpio: 0x60004000, ledc: 0x60019000, outSel: 0x554, pins: 22, hiMask: 0, ledcSig: 45, channels: 6, layout: 'ls', boot: 0 }
};

/**
 * Registres GPIO et LEDC de la puce (ESP32 par défaut), reconstitués à partir des écritures du programme.
 * pin(n) : { out (sortie active), level, pwm: { duty, freq, channel } | null }.
 */
export function createDecoder(chip = 'esp32') {
  const C = CHIPS[chip] || CHIPS.esp32, GPIO = C.gpio, LEDC = C.ledc, HI = C.hiMask;
  const out = [0, 0], en = [0, 0];
  const sel = new Array(C.pins).fill(256);
  const ch = Array.from({ length: C.channels }, () => ({ timer: 0, duty: 0, on: false }));
  const timers = Array.from({ length: C.layout === 'esp32' ? 8 : 4 }, () => ({ res: 0, div: 0, apb: true }));
  const bit = n => [n >> 5, 1 << (n & 31)];
  function reset() {
    out.fill(0); en.fill(0); sel.fill(256);
    for (const c of ch) Object.assign(c, { timer: 0, duty: 0, on: false });
    for (const t of timers) Object.assign(t, { res: 0, div: 0, apb: true });
  }
  function pwmOf(n) {
    const s = sel[n];
    if (s < C.ledcSig || s >= C.ledcSig + C.channels) return null;
    const c = s - C.ledcSig, K = ch[c], T = timers[(C.layout === 'esp32' ? (c < 8 ? 0 : 4) : 0) + K.timer];
    if (!T || !T.res || !T.div) return null;
    const full = 2 ** T.res;
    return { duty: Math.min(1, K.duty / 16 / full), freq: (T.apb ? APB_HZ : REF_HZ) / (T.div / 256) / full, channel: c };
  }
  /** Registre d'une voie ou d'une minuterie du LEDC ; rend vrai s'il peut changer une broche. */
  function ledc(l, value) {
    const chEnd = C.layout === 'esp32' ? 0x140 : 0x14 * C.channels, tBase = C.layout === 'esp32' ? 0x140 : 0xa0;
    if (l < chEnd) {
      let c, reg;
      if (C.layout === 'esp32') { const hs = l < 0xa0, b = hs ? l : l - 0xa0; c = (hs ? 0 : 8) + Math.floor(b / 0x14); reg = b % 0x14; }
      else { c = Math.floor(l / 0x14); reg = l % 0x14; }
      if (reg === 0x00) { ch[c].timer = value & 3; ch[c].on = !!(value & 4); return true; }
      if (reg === 0x08) { ch[c].duty = value & 0x1ffffff; return true; }
      return false;
    }
    if (l >= tBase && l < tBase + timers.length * 8 && ((l - tBase) & 7) === 0) {
      const T = timers[(l - tBase) >> 3];
      if (C.layout === 'esp32') { T.res = value & 0x1f; T.div = (value >>> 5) & 0x3ffff; T.apb = !!(value & (1 << 25)); }
      else { T.res = value & 0xf; T.div = (value >>> 4) & 0x3ffff; T.apb = true; } // horloge APB (80 MHz), celle du cœur Arduino
      return true;
    }
    return false;
  }
  return {
    chip: C,
    /** Redémarrage de la carte : registres à leur valeur de démarrage. */
    reset,
    /** Écriture d'un registre ; rend vrai si elle peut changer une broche. */
    write(addr, value) {
      const o = addr - GPIO;
      if (o >= 0 && o < 0x1000) {
        const v = value >>> 0;
        switch (o) {
          case 0x04: out[0] = v; return true;
          case 0x08: out[0] = (out[0] | v) >>> 0; return true;
          case 0x0c: out[0] = (out[0] & ~v) >>> 0; return true;
          case 0x10: out[1] = v & HI; return true;
          case 0x14: out[1] = (out[1] | v) & HI; return true;
          case 0x18: out[1] = out[1] & ~v & HI; return true;
          case 0x20: en[0] = v; return true;
          case 0x24: en[0] = (en[0] | v) >>> 0; return true;
          case 0x28: en[0] = (en[0] & ~v) >>> 0; return true;
          case 0x2c: en[1] = v & HI; return true;
          case 0x30: en[1] = (en[1] | v) & HI; return true;
          case 0x34: en[1] = en[1] & ~v & HI; return true;
          default:
            if (o >= C.outSel && o < C.outSel + C.pins * 4) { sel[(o - C.outSel) >> 2] = v & 0x1ff; return true; }
            return false;
        }
      }
      const l = addr - LEDC;
      return l >= 0 && l < 0x200 ? ledc(l, value) : false;
    },
    pin(n) {
      const [w, m] = bit(n);
      return { out: !!(en[w] & m), level: out[w] & m ? 1 : 0, pwm: pwmOf(n) };
    }
  };
}

/** Signal du LEDC vu par le montage : niveau fixe, servo (impulsions de 0,4 à 2,7 ms à 40-70 Hz), tone() ou PWM. */
export function classify(pwm) {
  const { duty, freq } = pwm;
  if (duty <= 0) return { d: 0, pwm: null, freq: 0, servo: null, ledc: 0 };
  if (duty >= 1) return { d: 1, pwm: null, freq: 0, servo: null, ledc: 0 };
  const pulseMs = duty / freq * 1000;
  if (freq >= 40 && freq <= 70 && pulseMs >= 0.4 && pulseMs <= 2.7) return { d: 1, pwm: null, freq: 0, ledc: 0, servo: Math.max(0, Math.min(180, ((pulseMs - 0.544) / (2.4 - 0.544)) * 180)) };
  if (Math.abs(duty - 0.5) < 0.06 && freq >= 20) return { d: 1, pwm: null, freq, servo: null, ledc: 0 };
  return { d: 1, pwm: duty, freq: 0, servo: null, ledc: freq };
}

/**
 * Moteur d'exécution d'un programme compilé pour l'ESP32. image : la flash entière (.merged.bin) ; hw : pont vers le
 * montage (makeHw, src/prog/panel.js). opts.transport : { start({ image, onUart(t, octets), onSide(t, octets),
 * onTrace([[adresse, valeur, t]…]), onExit(code, journal) }), uart(octets), side(octets), stop() } ; t en ms depuis
 * le lancement de l'émulateur.
 */
export function createEsp32Runtime(image, hw, opts = {}) {
  const prof = hw.prof, logic = prof.logic, keys = pinMap(prof, hw.kind || 'esp32'), transport = opts.transport;
  if (!transport) throw new Error(tl('Émulateur ESP32 indisponible.'));
  const chip = CHIPS[hw.kind] ? hw.kind : 'esp32', dec = createDecoder(chip);
  const pins = new Map(), lines = [], byNum = new Map(), warnings = new Map();
  let state = 'run', error = null, trace = null, tap = null, out = '', tapBuf = '';

  for (const [n, key] of keys) {
    if (typeof n !== 'number' || n < 0 || n >= CHIPS[chip].pins) continue;
    const rec = { mode: 0, d: 0, pwm: null, freq: 0, ledc: 0, toneEnd: 0, servo: null, px: null, stepper: null, weak: false, dac: null };
    const L = { key, n, rec, adc: !!(prof.gpio[key] && prof.gpio[key].caps && prof.gpio[key].caps.has('adc')), inMode: 0, level: 0, ring: new Float64Array(RING), lev: new Uint8Array(RING), head: 0, count: 0, sliceEdges: 0, adcSent: -1 };
    pins.set(key, rec); lines.push(L); byNum.set(n, L);
  }

  /* ---------- Temps : émulateur (t, ms depuis son lancement) et carte (millis()) ---------- */
  // Après un redémarrage de la carte, millis() repart de 0 : epoch garde un temps qui ne recule jamais (traceur,
  // oscilloscope), comme celui des autres moteurs.
  let kT = null, kG = null, wrap = 0, lastRaw = 0, lastBeat = 0, lastBeatAt = 0, epoch = 0;
  const tNow = () => performance.now() + (kT ?? 0);
  const seen = t => { const k = t - performance.now(); if (kT == null || k > kT) kT = k; };
  /** Heure de la carte (ms) d'un instant de l'émulateur. */
  const guest = t => (kG == null ? epoch : Math.max(epoch, t + kG));
  function beat(t, us) {
    if (us < lastRaw && lastRaw - us > 0x80000000) wrap += 0x100000000; // le compteur de 32 bits a fait le tour
    lastRaw = us;
    const g = epoch + (wrap + us) / 1000;
    if (kG == null || g - t > kG) kG = g - t;
    lastBeat = g; lastBeatAt = performance.now();
  }
  const vt = () => (kG == null ? epoch : Math.min(guest(tNow()), lastBeat + 200));
  /** Redémarrage de la carte : son horloge repart de 0, le temps du moteur continue. */
  const rebase = () => { epoch = vt(); kG = null; wrap = 0; lastRaw = 0; };

  /* ---------- Sorties : registres GPIO et LEDC ---------- */
  function edge(L, lv, g) {
    if (lv === L.level) return;
    L.level = lv;
    L.ring[L.head] = g; L.lev[L.head] = lv; L.head = (L.head + 1) % RING; L.count = Math.min(RING, L.count + 1);
    L.sliceEdges++;
    if (trace && L.sliceEdges <= 64) trace(L.key, { d: lv, pwm: null, freq: 0 }, g);
  }
  function onTrace(recs) {
    for (const [addr, value, t] of recs) {
      seen(t);
      if (!dec.write(addr, value)) continue;
      const g = guest(t);
      for (const L of lines) { const p = dec.pin(L.n); if (p.out && !p.pwm) edge(L, p.level, g); }
    }
  }
  /** Fin d'image : la forme du signal de chaque sortie (comme avr.js), le LEDC donnant directement PWM, tone() et servo. */
  function analyse() {
    const now = vt(), from = now - WINDOW;
    for (const L of lines) {
      const r = L.rec, p = dec.pin(L.n), many = L.sliceEdges > 64;
      L.sliceEdges = 0;
      if (!p.out) { r.mode = L.inMode === 2 ? 2 : L.inMode === 3 ? 3 : 0; r.pwm = null; r.freq = 0; r.servo = null; r.ledc = 0; r.d = 0; continue; }
      r.mode = 1;
      if (p.pwm) { Object.assign(r, classify(p.pwm)); continue; }
      const ev = [];
      for (let i = 0; i < L.count; i++) { const j = (L.head - L.count + i + RING) % RING; if (L.ring[j] >= from) ev.push([L.ring[j], L.lev[j]]); }
      r.d = L.level;
      const rises = [], widths = [];
      for (let i = 0; i < ev.length; i++) if (ev[i][1] === 1) { rises.push(ev[i][0]); if (i + 1 < ev.length) widths.push(ev[i + 1][0] - ev[i][0]); }
      const period = rises.length >= 2 ? (rises[rises.length - 1] - rises[0]) / (rises.length - 1) : 0;
      if (!period || !widths.length || now - ev[ev.length - 1][0] > Math.max(3 * period, 30)) { r.pwm = null; r.freq = 0; r.servo = null; r.ledc = 0; continue; }
      const width = widths.reduce((a, b) => a + b, 0) / widths.length;
      Object.assign(r, classify({ duty: Math.min(1, width / period), freq: 1000 / period }), { d: L.level });
      if (trace && many) trace(L.key, { d: r.d, pwm: r.pwm, freq: r.freq || r.ledc || 0 }, now);
    }
  }

  /* ---------- Entrées : niveaux et ADC envoyés à la cale (UART1) ---------- */
  let sentMask = null, shimReady = false;
  function readInputs() {
    const set = new Set();
    for (const L of lines) {
      if (dec.pin(L.n).out) continue;
      const r = hw.read ? hw.read(L.key) : null;
      const lv = r ? (r.d != null ? !!r.d : r.v > logic / 2) : L.inMode === 2;
      if (lv) set.add(L.n);
      if (L.adc && shimReady) {
        const v = r ? (r.v != null ? r.v : r.d ? logic : 0) : 0, raw = Math.max(0, Math.min(ADC_MAX, Math.round(v / ADC_REF * ADC_MAX)));
        if (raw !== L.adcSent) { L.adcSent = raw; transport.side([0x41, L.n, raw & 0xff, raw >> 8]); }
      }
    }
    const bytes = maskBytes(set), mask = bytes.join(',');
    if (shimReady && mask !== sentMask) { sentMask = mask; transport.side([0x49, ...bytes]); } // 'I' + 7 octets
  }
  /* ---------- Modules du montage (src/emu/esp32-bridge.js) ---------- */
  const bridge = createBridge({ hw, keys, rec: k => pins.get(k) || null, send: b => transport.side(b) });

  /* ---------- Cale (UART1) : trames de 10 octets [type, broche, valeur, heure], trames variables 'V' ---------- */
  let sideBuf = new Uint8Array(4096), sideLen = 0, sideAt = 0;
  const u32at = (f, i) => (f[i] | (f[i + 1] << 8) | (f[i + 2] << 16) | (f[i + 3] << 24)) >>> 0;
  function onSide(t, bytes) {
    seen(t);
    if (sideLen + bytes.length > sideBuf.length) {
      const grown = new Uint8Array(Math.max(sideBuf.length * 2, sideLen - sideAt + bytes.length + 4096));
      grown.set(sideBuf.subarray(sideAt, sideLen)); sideLen -= sideAt; sideAt = 0; sideBuf = grown;
    }
    sideBuf.set(bytes, sideLen); sideLen += bytes.length;
    while (sideLen - sideAt > 0) {
      const f = sideBuf.subarray(sideAt, sideLen), type = String.fromCharCode(f[0]);
      if (type === 'V') { // [V, op, longueur u16, heure des modules u32, données]
        if (f.length < 8) break;
        const n = f[2] | (f[3] << 8);
        if (f.length < 8 + n) break;
        sideAt += 8 + n;
        if (state === 'run') bridge.frame(String.fromCharCode(f[1]), u32at(f, 4), f.slice(8, 8 + n));
        continue;
      }
      if (!'JMT'.includes(type)) { sideAt++; continue; } // resynchronisation
      if (f.length < 10) break;
      sideAt += 10;
      const value = u32at(f, 2), us = u32at(f, 6);
      beat(t, us);
      if (type === 'J') { // la cale attend ces niveaux avant setup() ; les broches reliées aux modules d'abord
        shimReady = true; sentMask = null;
        for (const L of lines) { L.adcSent = -1; L.inMode = 0; }
        bridge.ready(); readInputs();
      } else if (type === 'M') { const L = byNum.get(f[1]); if (L) L.inMode = value & 2 ? 4 : value & 4 ? 2 : value & 8 ? 3 : 1; }
      else bridge.beat(us, value);
    }
    if (sideAt === sideLen) sideAt = sideLen = 0;
  }

  /* ---------- Port série (UART0) : moniteur série ; démarrages, redémarrages et plantages ---------- */
  let lineBuf = '', partial = 0, heldAt = 0, booting = true, firstBoot = true, panic = null;
  const resets = [];
  const emit = s => { out += s; tapBuf += s; };
  function stopWith(msg) {
    if (state !== 'run') return;
    state = 'error'; error = { line: 0, msg };
    transport.stop();
  }
  function onLine(l) {
    const text = l.replace(/\r?\n$/, '').replace(/\r$/, '');
    const rst = RESET.exec(text);
    if (rst) {
      booting = true;
      if (firstBoot && /^POWERON/.test(rst[1])) firstBoot = false;
      else {
        const why = panic || (REASONS[rst[1]] ? REASONS[rst[1]]() : rst[1]);
        emit(tl('\n— l’ESP32 redémarre : {0} —\n', why));
        const now = performance.now();
        resets.push(now); while (resets.length && now - resets[0] > LOOP_MS) resets.shift();
        if (resets.length >= LOOP_RESETS) stopWith(tl('L’ESP32 redémarre sans cesse ({0}) : programme arrêté. Vérifiez le moniteur série.', why));
      }
      panic = null; shimReady = false;
      if (!firstBoot || lastBeatAt) { rebase(); bridge.reset(); }
      dec.reset();
      for (const L of lines) { L.level = 0; L.count = 0; }
      return null;
    }
    if (booting && (BANNER.test(text) || !text.trim())) return null;
    booting = false;
    const p = PANIC.exec(text);
    if (p) {
      panic = p[1] ? tl('plantage ({0})', p[1]) : p[2] ? tl('assertion non vérifiée : {0}', p[2].trim()) : tl('abort()');
      const w = warnings.get('panic') || { line: 0, msg: '', n: 0 };
      w.msg = tl('Le programme a planté : {0}.', panic); w.n++;
      warnings.set('panic', w);
    }
    return l;
  }
  function onUart(t, bytes) {
    seen(t);
    for (const b of bytes) {
      const ch = String.fromCharCode(b);
      lineBuf += ch;
      if (ch !== '\n') continue;
      const l = onLine(lineBuf);
      if (l != null) emit(l.slice(partial));
      lineBuf = ''; partial = 0;
    }
  }
  /** Ligne commencée sans fin de ligne : montrée tout de suite, sauf si elle peut encore être un message de démarrage. */
  function flushPartial() {
    if (lineBuf.length <= partial) return;
    const head = lineBuf.slice(0, 4), maybe = BANNER_HEADS.some(k => k.startsWith(head) || head.startsWith(k));
    if (maybe && performance.now() - heldAt < 250) return;
    if (partial === 0 && booting) { if (maybe) return; booting = false; }
    emit(lineBuf.slice(partial)); partial = lineBuf.length;
  }

  /* ---------- Lancement ---------- */
  transport.start({
    image, chip,
    onUart, onSide, onTrace,
    onExit(code, log) {
      if (state !== 'run') return;
      const last = String(log || '').trim().split('\n').filter(Boolean).pop();
      stopWith(tl('L’émulateur ESP32 s’est arrêté (code {0}){1}', code ?? '?', last ? ` : ${last}` : '.'));
    }
  }).catch(e => stopWith(String((e && e.message) || e)));

  let lastUnbridged = -Infinity;
  function run() {
    if (state !== 'run') return;
    if (lineBuf.length > partial) { if (!heldAt) heldAt = performance.now(); flushPartial(); } else heldAt = 0;
    readInputs();
    if (shimReady) bridge.run();
    analyse();
    const now = performance.now();
    // Modules branchés que le mode fidèle ne fait pas répondre (revu de temps en temps : le montage change).
    if (now - lastUnbridged > 2000) {
      lastUnbridged = now;
      const msg = unbridgedWarning(hw.comps && UNBRIDGED.length ? hw.comps(UNBRIDGED) : []);
      if (msg) warnings.set('unbridged', { line: 0, msg, n: 1 }); else warnings.delete('unbridged');
    }
    if (lastBeatAt && now - lastBeatAt > STALL_MS) warnings.set('stall', { line: 0, msg: tl('L’ESP32 ne donne plus signe de vie depuis {0} s (programme bloqué, interruptions coupées ?).', Math.round((now - lastBeatAt) / 1000)), n: 1 });
    else warnings.delete('stall');
    if (tap && tapBuf) tap(tapBuf, vt());
    tapBuf = '';
  }

  const debug = { enabled: false, paused: false, at: { line: 0, fn: null }, pause() {}, resume() {}, step() {}, setBreakpoints() {}, locals: () => [], globals: () => [] };
  const stop = () => { if (state === 'run') state = 'stopped'; transport.stop(); if (bridge.devices && bridge.devices.dispose) bridge.devices.dispose(); };
  return {
    pins, warnings, run, clock: vt,
    probe(k) {
      const p = pins.get(k);
      if (p && p.mode === 1) return { out: true, d: p.d, v: p.d ? logic : 0, pwm: p.pwm, freq: p.freq || p.ledc || 0 };
      const r = hw.read ? hw.read(k) : null;
      return r ? { out: false, d: r.d != null ? r.d : +(r.v > logic / 2), v: r.v != null ? r.v : r.d ? logic : 0, pwm: null, freq: 0 } : null;
    },
    setTrace(fn) { trace = fn || null; },
    setSerialTap(fn) { tap = fn || null; },
    debug, logic, firmware: 'esp32', chip,
    get state() { return state; }, get error() { return error; }, get line() { return null; },
    takeSerial() { const s = out; out = ''; return s; },
    send(s) { if (state === 'run') transport.uart(Array.from(String(s), ch => ch.charCodeAt(0) & 0xff)); },
    stop, dispose: stop,
    /** Pour les tests : décodeur des registres, cale prête, heure du dernier battement. */
    hw: { dec, transport, bridge, shimReady: () => shimReady, lastBeat: () => lastBeat }
  };
}
