// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mode « fidèle » de l'ESP32 (bêta) : le vrai programme (compilé par arduino-cli, avec la cale
// src/emu/esp32-shim/jollof_qemu_shim.cpp) tourne dans QEMU, l'émulateur d'Espressif, lancé comme un programme à part
// (src-tauri/src/qemu.rs ; les tests passent par src/emu/esp32-node.mjs). Le moteur expose la même interface que ceux
// de l'Uno (avr.js) et du Pico (rp2040.js) : broches, temps de la carte, port série, sondes.
//   Sorties : QEMU trace les écritures du programme dans les registres GPIO et LEDC ; on en déduit le niveau de chaque
//     broche, et, pour le LEDC (analogWrite, ledcWrite, tone(), servo), le rapport cyclique et la fréquence réglés.
//   Entrées : le modèle GPIO de QEMU ne garde rien ; la cale du programme lit les niveaux et l'ADC que le moteur lui
//     envoie par l'UART1, et appelle les fonctions attachées (attachInterrupt) aux fronts.
//   Temps : QEMU tourne en temps réel, à son rythme ; le temps de la carte (millis()) arrive par le battement de la
//     cale, toutes les 10 ms. run(dt) n'avance rien : il relève les entrées et analyse les sorties.
// Limites (bêta) : ni Wi-Fi ni Bluetooth, modules I2C/SPI/1-Wire pas encore reliés (src/emu/esp32-limits.js).
import { pinMap } from '../prog/runtime.js';
import { tl } from '../i18n/index.js';
import { UNBRIDGED, unbridgedWarning } from './esp32-limits.js';

const GPIO = 0x3ff44000, LEDC = 0x3ff59000, APB_HZ = 80e6, REF_HZ = 1e6;
const WINDOW = 60;        // ms : fenêtre d'analyse des fronts (signaux faits à coups de digitalWrite)
const RING = 256;         // fronts gardés par broche
const ADC_REF = 3.3, ADC_MAX = 4095;
const LOOP_RESETS = 3, LOOP_MS = 15000; // trois redémarrages en 15 s : la carte boucle, on l'arrête
const STALL_MS = 3000;    // plus de battement de la cale depuis 3 s : programme bloqué
// Lignes écrites par la mémoire morte et le chargeur d'amorçage à chaque démarrage (115200 bauds sur l'ESP32).
const BANNER = /^(ets [A-Z][a-z]{2} +\d|rst:0x|configsip:|clk_drv:|mode:(DIO|QIO|DOUT|QOUT)|load:0x|entry 0x|ho \d+ tail)/;
const BANNER_HEADS = ['ets ', 'rst:', 'conf', 'clk_', 'mode', 'load', 'entr', 'ho '];
const RESET = /^rst:0x[0-9a-f]+ \(([A-Z0-9_]+)\)/;
const PANIC = /Guru Meditation Error: Core +\d+ panic'ed \(([^)]+)\)|abort\(\) was called|assert failed: (.+)/;
const REASONS = {
  SW_CPU_RESET: () => tl('redémarrage logiciel (ESP.restart() ou plantage)'),
  TG0WDT_SYS_RESET: () => tl('chien de garde'), TG1WDT_SYS_RESET: () => tl('chien de garde'),
  RTCWDT_SYS_RESET: () => tl('chien de garde'), RTCWDT_RTC_RESET: () => tl('chien de garde'),
  DEEPSLEEP_RESET: () => tl('réveil du sommeil profond')
};

/**
 * Registres GPIO et LEDC de l'ESP32 (manuel de référence technique d'Espressif), reconstitués à partir des
 * écritures du programme. pin(n) : { out (sortie active), level, pwm: { duty, freq, channel } | null }.
 */
export function createDecoder() {
  const out = [0, 0], en = [0, 0];
  const sel = new Array(40).fill(256);
  const ch = Array.from({ length: 16 }, () => ({ timer: 0, duty: 0, on: false }));
  const timers = Array.from({ length: 8 }, () => ({ res: 0, div: 0, apb: true }));
  const bit = n => [n >> 5, 1 << (n & 31)];
  function reset() {
    out.fill(0); en.fill(0); sel.fill(256);
    for (const c of ch) Object.assign(c, { timer: 0, duty: 0, on: false });
    for (const t of timers) Object.assign(t, { res: 0, div: 0, apb: true });
  }
  function pwmOf(n) {
    const s = sel[n];
    if (s < 71 || s > 86) return null;
    const c = s - 71, C = ch[c], T = timers[(c < 8 ? 0 : 4) + C.timer];
    if (!T.res || !T.div) return null;
    const full = 2 ** T.res;
    return { duty: Math.min(1, C.duty / 16 / full), freq: (T.apb ? APB_HZ : REF_HZ) / (T.div / 256) / full, channel: c };
  }
  return {
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
          case 0x10: out[1] = v & 0xff; return true;
          case 0x14: out[1] = (out[1] | v) & 0xff; return true;
          case 0x18: out[1] = out[1] & ~v & 0xff; return true;
          case 0x20: en[0] = v; return true;
          case 0x24: en[0] = (en[0] | v) >>> 0; return true;
          case 0x28: en[0] = (en[0] & ~v) >>> 0; return true;
          case 0x2c: en[1] = v & 0xff; return true;
          case 0x30: en[1] = (en[1] | v) & 0xff; return true;
          case 0x34: en[1] = en[1] & ~v & 0xff; return true;
          default:
            if (o >= 0x530 && o < 0x530 + 40 * 4) { sel[(o - 0x530) >> 2] = v & 0x1ff; return true; }
            return false;
        }
      }
      const l = addr - LEDC;
      if (l < 0 || l >= 0x200) return false;
      if (l < 0x140) {
        const hs = l < 0xa0, b = hs ? l : l - 0xa0, c = (hs ? 0 : 8) + Math.floor(b / 0x14), reg = b % 0x14;
        if (reg === 0x00) { ch[c].timer = value & 3; ch[c].on = !!(value & 4); return true; }
        if (reg === 0x08) { ch[c].duty = value & 0x1ffffff; return true; }
        return false;
      }
      if (l < 0x180 && (l & 7) === 0) {
        const T = timers[(l - 0x140) >> 3];
        T.res = value & 0x1f; T.div = (value >>> 5) & 0x3ffff; T.apb = !!(value & (1 << 25));
        return true;
      }
      return false;
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
  const dec = createDecoder();
  const pins = new Map(), lines = [], byNum = new Map(), warnings = new Map();
  let state = 'run', error = null, trace = null, tap = null, out = '', tapBuf = '';

  for (const [n, key] of keys) {
    if (typeof n !== 'number' || n < 0 || n > 39) continue;
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
    let lo = 0, hi = 0;
    for (const L of lines) {
      if (dec.pin(L.n).out) continue;
      const r = hw.read ? hw.read(L.key) : null;
      const lv = r ? (r.d != null ? !!r.d : r.v > logic / 2) : L.inMode === 2;
      if (lv) { if (L.n < 32) lo |= 1 << L.n; else hi |= 1 << (L.n - 32); }
      if (L.adc && shimReady) {
        const v = r ? (r.v != null ? r.v : r.d ? logic : 0) : 0, raw = Math.max(0, Math.min(ADC_MAX, Math.round(v / ADC_REF * ADC_MAX)));
        if (raw !== L.adcSent) { L.adcSent = raw; transport.side([0x41, L.n, raw & 0xff, raw >> 8]); }
      }
    }
    const mask = `${lo >>> 0}:${hi}`;
    if (shimReady && mask !== sentMask) {
      sentMask = mask;
      transport.side([0x49, lo & 0xff, (lo >>> 8) & 0xff, (lo >>> 16) & 0xff, (lo >>> 24) & 0xff, hi & 0xff]);
    }
  }
  /* ---------- Cale (UART1) : trames de 10 octets ---------- */
  let sideBuf = [];
  function onSide(t, bytes) {
    seen(t);
    for (const b of bytes) sideBuf.push(b);
    while (sideBuf.length >= 10) {
      const f = sideBuf.splice(0, 10), type = String.fromCharCode(f[0]);
      if (!'JMT'.includes(type)) { sideBuf.splice(0, 0, ...f.slice(1)); continue; } // resynchronisation
      const value = (f[2] | (f[3] << 8) | (f[4] << 16) | (f[5] << 24)) >>> 0, us = (f[6] | (f[7] << 8) | (f[8] << 16) | (f[9] << 24)) >>> 0;
      beat(t, us);
      if (type === 'J') { shimReady = true; sentMask = null; for (const L of lines) { L.adcSent = -1; L.inMode = 0; } readInputs(); } // la cale attend ces niveaux avant setup()
      else if (type === 'M') { const L = byNum.get(f[1]); if (L) L.inMode = value & 2 ? 4 : value & 4 ? 2 : value & 8 ? 3 : 1; }
    }
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
      if (firstBoot && rst[1] === 'POWERON_RESET') firstBoot = false;
      else {
        const why = panic || (REASONS[rst[1]] ? REASONS[rst[1]]() : rst[1]);
        emit(tl('\n— l’ESP32 redémarre : {0} —\n', why));
        const now = performance.now();
        resets.push(now); while (resets.length && now - resets[0] > LOOP_MS) resets.shift();
        if (resets.length >= LOOP_RESETS) stopWith(tl('L’ESP32 redémarre sans cesse ({0}) : programme arrêté. Vérifiez le moniteur série.', why));
      }
      panic = null; shimReady = false;
      if (!firstBoot || lastBeatAt) rebase();
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
    image,
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
    analyse();
    const now = performance.now();
    // Modules branchés que le mode fidèle ne fait pas encore répondre (revu de temps en temps : le montage change).
    if (now - lastUnbridged > 2000) {
      lastUnbridged = now;
      const msg = unbridgedWarning(hw.comps ? hw.comps(UNBRIDGED) : []);
      if (msg) warnings.set('unbridged', { line: 0, msg, n: 1 }); else warnings.delete('unbridged');
    }
    if (lastBeatAt && now - lastBeatAt > STALL_MS) warnings.set('stall', { line: 0, msg: tl('L’ESP32 ne donne plus signe de vie depuis {0} s (programme bloqué, interruptions coupées ?).', Math.round((now - lastBeatAt) / 1000)), n: 1 });
    else warnings.delete('stall');
    if (tap && tapBuf) tap(tapBuf, vt());
    tapBuf = '';
  }

  const debug = { enabled: false, paused: false, at: { line: 0, fn: null }, pause() {}, resume() {}, step() {}, setBreakpoints() {}, locals: () => [], globals: () => [] };
  const stop = () => { if (state === 'run') state = 'stopped'; transport.stop(); };
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
    debug, logic, firmware: 'esp32',
    get state() { return state; }, get error() { return error; }, get line() { return null; },
    takeSerial() { const s = out; out = ''; return s; },
    send(s) { if (state === 'run') transport.uart(Array.from(String(s), ch => ch.charCodeAt(0) & 0xff)); },
    stop, dispose: stop,
    /** Pour les tests : décodeur des registres, cale prête, heure du dernier battement. */
    hw: { dec, transport, shimReady: () => shimReady, lastBeat: () => lastBeat }
  };
}
