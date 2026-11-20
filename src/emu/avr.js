// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mode « fidèle » de l'Uno, de la Nano et du Mega 2560 : le vrai programme machine (compilé par arduino-cli) tourne,
// instruction par instruction, sur un ATmega328P ou un ATmega2560 émulé (avr8js, licence MIT ; réglages des deux
// puces dans src/emu/avr-chips.js). Le moteur expose la même interface que l'interpréteur (src/prog/runtime.js) :
// broches, temps virtuel, port série, sondes, pour que le calcul du circuit, les effecteurs, l'oscilloscope et le
// moniteur série n'y voient aucune différence.
import {
  CPU, avrInstruction, AVRTimer, AVRIOPort, AVRUSART, AVRADC, PinState, AVREEPROM, EEPROMMemoryBackend,
  AVRTWI, AVRSPI, AVRClock, AVRWatchdog
} from 'avr8js';
import { parseHex } from './hex.js';
import { pinMap } from '../prog/runtime.js';
import { attachDevices } from './devices/index.js';
import { AVR_CHIPS, chipOfKind } from './avr-chips.js';

export const MHZ = 16e6;
const PER_MS = MHZ / 1000;
// ms de calcul par image au plus (comme l'interpréteur) ; sous Node (tests, pas d'interface) : sans limite, chaque tranche
// exécute tout son temps virtuel, quel que soit la charge de la machine (résultats reproductibles).
const SLICE = globalThis.process && globalThis.process.versions && globalThis.process.versions.node ? Infinity : 8;
const LAG = 250;          // au-delà, le temps virtuel cède : un vieux PC ralentit la carte au lieu de rattraper
const WINDOW = 60;        // ms : fenêtre d'analyse des fronts (PWM, tone(), servo)
const RING = 256;         // fronts gardés par broche

/**
 * Minuterie de 16 bits à trois comparaisons (ATmega2560) : avr8js gère OCRnC, mais ses registres TIFRn et TIMSKn
 * ignorent OCFnC / OCIEnC, et la PWM rapide ne remet pas la sortie OCnC à son niveau de départ au débordement.
 */
function completeCompareC(cpu, t, cfg) {
  if (!cfg.OCRC) return;
  const tifr = cpu.writeHooks[cfg.TIFR], timsk = cpu.writeHooks[cfg.TIMSK];
  cpu.writeHooks[cfg.TIFR] = (v, ...r) => { const x = tifr(v, ...r); cpu.clearInterruptByFlag(t.OCFC, v); return x; };
  cpu.writeHooks[cfg.TIMSK] = (v, ...r) => { const x = timsk(v, ...r); cpu.updateInterruptEnable(t.OCFC, v); return x; };
  const count = t.count;
  t.count = (reschedule, external) => {
    const before = t.tcnt;
    count(reschedule, external);
    if (t.compC && t.timerMode === 3 /* PWM rapide */ && t.tcnt < before) t.updateCompPin(t.compC, 'C', true);
  };
}

/**
 * Moteur d'exécution d'un programme compilé. hexText : contenu du .hex ; hw : pont vers le montage (makeHw,
 * src/prog/panel.js), dont on lit hw.prof, hw.kind et hw.read(clé) pour les entrées. opts.mcu : 'atmega328p' ou
 * 'atmega2560' (sinon déduit de hw.kind : le Mega a l'ATmega2560).
 */
export function createAvrRuntime(hexText, hw, opts = {}) {
  const prof = hw.prof, logic = prof.logic, keys = pinMap(prof, hw.kind), chip = AVR_CHIPS[opts.mcu] || chipOfKind(hw.kind);
  const cpu = new CPU(new Uint16Array(parseHex(hexText, chip.flash).buffer), chip.sram);
  chip.timers.forEach(c => completeCompareC(cpu, new AVRTimer(cpu, c), c));
  const adc = new AVRADC(cpu, chip.adc);
  // I2C et SPI : sans module branché, une adresse I2C n'est pas acquittée (Wire.endTransmission rend 2) ; les modules
  // de src/emu/devices s'y raccordent. Horloge et chien de garde : pour les programmes qui s'en servent.
  const twi = new AVRTWI(cpu, chip.twi, MHZ), spi = new AVRSPI(cpu, chip.spi, MHZ), clock = new AVRClock(cpu, MHZ, chip.clock);
  new AVRWatchdog(cpu, chip.watchdog, clock);
  // EEPROM : la même mémoire que l'interpréteur (prog.mem de la carte, en hexadécimal), gardée avec le projet.
  const EE = chip.eeprom, mem = hw.mem ? hw.mem() : { ee: '' }, eeBack = new EEPROMMemoryBackend(EE);
  eeBack.memory.fill(0xff);
  for (let i = 0; i < Math.min(EE, (mem.ee || '').length >> 1); i++) eeBack.memory[i] = parseInt(mem.ee.substr(2 * i, 2), 16) & 255;
  let eeDirty = false;
  const eeWrite = eeBack.writeMemory.bind(eeBack), eeErase = eeBack.eraseMemory.bind(eeBack);
  eeBack.writeMemory = (a, v) => { eeWrite(a, v); eeDirty = true; };
  eeBack.eraseMemory = a => { eeErase(a); eeDirty = true; };
  new AVREEPROM(cpu, eeBack, chip.eepromCfg);
  const flushEeprom = () => {
    eeDirty = false;
    let end = EE; while (end > 0 && eeBack.memory[end - 1] === 0xff) end--;
    mem.ee = Array.from(eeBack.memory.subarray(0, end), b => b.toString(16).padStart(2, '0')).join('');
    if (hw.memChanged) hw.memChanged();
  };
  const ports = {}, pins = new Map(), lines = [], warnings = new Map();
  let out = '', tapBuf = '', T = 0, started = false, state = 'run', error = null, trace = null, tap = null;
  const vt = () => cpu.cycles / PER_MS;

  // Une fiche par broche, de la même forme que celle de l'interpréteur.
  for (const [P, [cfg, nums]] of Object.entries(chip.ports)) {
    const port = ports[P] = new AVRIOPort(cpu, cfg), mine = [];
    nums.forEach((n, bit) => {
      const key = n == null ? null : keys.get(n); if (!key) return;
      const rec = { mode: 0, d: 0, pwm: null, freq: 0, ledc: 0, toneEnd: 0, servo: null, px: null, stepper: null, weak: false, dac: null };
      pins.set(key, rec);
      const L = { key, n, P, bit, port, rec, level: 0, ext: null, dev: null, line: 1, subs: [], ring: new Float64Array(RING), lev: new Uint8Array(RING), head: 0, count: 0, sliceEdges: 0 };
      lines.push(L); mine.push(L);
    });
    let inside = false;
    port.addListener(() => {
      if (inside) return;
      const now = cpu.cycles;
      for (const L of mine) {
        const st = port.pinState(L.bit), out1 = st === PinState.High || st === PinState.Low, mode = out1 ? 1 : st === PinState.InputPullUp ? 2 : 0;
        // Entrée qui vient de changer de mode : niveau aussitôt (module, montage, sinon tirage interne), comme sur la carte.
        L.rec.mode = mode;
        if (!out1) { inside = true; L.port.setPin(L.bit, inLevel(L)); inside = false; }
        lineChanged(L, out1 ? (st === PinState.High ? 1 : 0) : +inLevel(L), now);
        const lv = st === PinState.High ? 1 : 0;
        if (!out1 || lv === L.level) { if (!out1) L.level = 0; continue; }
        L.level = lv;
        L.ring[L.head] = now; L.lev[L.head] = lv; L.head = (L.head + 1) % RING; L.count = Math.min(RING, L.count + 1);
        L.sliceEdges++;
        if (trace && L.sliceEdges <= 64) trace(L.key, { d: lv, pwm: null, freq: 0 }, now / PER_MS);
      }
    });
  }
  /** Niveau d'une broche en entrée : un module qui la tire (DHT, 1-Wire…), sinon le montage, sinon le tirage interne. */
  function inLevel(L) { return L.dev != null ? L.dev : L.ext != null ? L.ext : L.rec.mode === 2; }
  /** La ligne change de niveau : les modules abonnés (protocoles temporisés) le voient au cycle près. */
  function lineChanged(L, lv, cyc) {
    if (lv === L.line) return;
    L.line = lv;
    for (const fn of L.subs.slice()) fn(lv, cyc);
  }
  const byKey = new Map(lines.map(L => [L.key, L]));
  const pinApi = {
    keys: () => byKey.keys(),
    level: key => { const L = byKey.get(key); return L ? L.line : null; },
    onEdge(key, fn) { const L = byKey.get(key); if (!L) return () => {}; L.subs.push(fn); return () => { const i = L.subs.indexOf(fn); if (i >= 0) L.subs.splice(i, 1); }; },
    /** Un module tire la ligne (true/false) ou la relâche (null). */
    drive(key, level) {
      const L = byKey.get(key); if (!L) return;
      L.dev = level == null ? null : !!level;
      if (L.rec.mode !== 1) { L.port.setPin(L.bit, inLevel(L)); lineChanged(L, +inLevel(L), cpu.cycles); }
    },
    /** Fiche de la broche (celle de pins) : un module y publie ce qu'il affiche (px des LED WS2812…). */
    rec: key => { const L = byKey.get(key); return L ? L.rec : null; }
  };
  // Ports série matériels : Serial (D0/D1) que lit le moniteur série, et sur le Mega Serial1 à Serial3 (D19/D18,
  // D17/D16, D15/D14) ; un module branché sur leurs broches RX/TX (HC-05, SIM800) les lit aussi.
  const uarts = chip.usarts.map(([name, cfg, rxPin, txPin]) => {
    const usart = new AVRUSART(cpu, cfg, MHZ), q = [], subs = [];
    usart.onByteTransmit = b => {
      if (name === 'Serial') { const ch = String.fromCharCode(b); out += ch; tapBuf += ch; }
      for (const fn of subs) fn(b, cpu.cycles);
      if (hw.probe) hw.probe.uart(name, 'tx', b);
    };
    /** Liaison série matérielle vue par les modules : octets envoyés par la carte, octets reçus par la carte. */
    const api = {
      onTx(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
      inject(bytes) { for (const b of bytes) { q.push(b & 0xff); if (hw.probe) hw.probe.uart(name, 'rx', b); } },
      baud: () => usart.baudRate
    };
    return { name, usart, q, api, rx: keys.get(rxPin) || null, tx: keys.get(txPin) || null };
  });
  const usart = uarts[0].usart, serialIn = uarts[0].q, uart = uarts[0].api;

  /** Entrées : niveau imposé par le montage (capteur, bouton, autre carte), sinon tirage interne ; tensions de l'ADC. */
  function readInputs() {
    for (const L of lines) {
      if (L.rec.mode === 1) continue;
      const r = hw.read ? hw.read(L.key) : null;
      L.ext = r ? (r.d != null ? !!r.d : r.v > logic / 2) : null;
      L.port.setPin(L.bit, inLevel(L));
      lineChanged(L, +inLevel(L), cpu.cycles);
    }
    for (let ch = 0; ch < chip.adcChannels; ch++) {
      const r = hw.read ? hw.read('A' + ch) : null;
      adc.channelValues[ch] = r ? (r.v != null ? r.v : r.d ? logic : 0) : 0;
    }
  }
  /** Fin de tranche : la forme du signal de chaque sortie (niveau fixe, PWM, tone(), impulsions de servo). */
  function analyse() {
    const now = cpu.cycles, from = now - WINDOW * PER_MS;
    for (const L of lines) {
      const r = L.rec, many = L.sliceEdges > 64;
      L.sliceEdges = 0;
      if (r.mode !== 1) { r.pwm = null; r.freq = 0; r.servo = null; r.d = 0; continue; }
      // Fronts récents, du plus ancien au plus récent.
      const ev = [];
      for (let i = 0; i < L.count; i++) { const j = (L.head - L.count + i + RING) % RING; if (L.ring[j] >= from) ev.push([L.ring[j], L.lev[j]]); }
      r.d = L.level;
      // Période : d'un front montant au suivant ; largeur : d'un front montant au descendant qui suit.
      const rises = [], widths = [];
      for (let i = 0; i < ev.length; i++) if (ev[i][1] === 1) { rises.push(ev[i][0]); if (i + 1 < ev.length) widths.push(ev[i + 1][0] - ev[i][0]); }
      const period = rises.length >= 2 ? (rises[rises.length - 1] - rises[0]) / (rises.length - 1) : 0;
      // Signal arrêté (plus de front depuis trois périodes) ou trop lent pour la fenêtre : niveau fixe.
      if (!period || !widths.length || now - ev[ev.length - 1][0] > Math.max(3 * period, 30 * PER_MS)) { r.pwm = null; r.freq = 0; r.servo = null; r.ledc = 0; continue; }
      const width = widths.reduce((a, b) => a + b, 0) / widths.length, duty = Math.min(1, width / period), f = MHZ / period, pulseMs = width / PER_MS;
      if (f >= 40 && f <= 70 && pulseMs >= 0.4 && pulseMs <= 2.7) {
        // Impulsions de servo : l'angle se lit dans leur largeur (0,544 à 2,4 ms, convention de la bibliothèque Servo).
        r.servo = Math.max(0, Math.min(180, ((pulseMs - 0.544) / (2.4 - 0.544)) * 180)); r.pwm = null; r.freq = 0; r.ledc = 0;
      } else if (Math.abs(duty - 0.5) < 0.06 && f >= 20) {
        r.freq = f; r.pwm = null; r.servo = null; r.ledc = 0; // signal carré : tone()
      } else { r.pwm = duty; r.freq = 0; r.servo = null; r.ledc = f; }
      if (trace && many) trace(L.key, { d: r.d, pwm: r.pwm, freq: r.freq || r.ledc || 0 }, now / PER_MS);
    }
  }

  /** Octets reçus par les ports série : un à la fois, quand le récepteur est activé (Serial.begin) et libre. */
  function feedSerial() {
    for (const U of uarts) while (U.q.length && !U.usart.rxBusy) { if (U.usart.writeByte(U.q[0]) === false) break; U.q.shift(); }
  }
  const rxWaiting = () => { for (const U of uarts) if (U.q.length) return true; return false; };
  function run(dt) {
    if (state !== 'run') return;
    if (started) T += Math.min(Math.max(dt, 0), 250);
    started = true;
    if (T - vt() > LAG) T = vt() + LAG; // la carte ne rattrape pas indéfiniment un retard pris sur une machine lente
    readInputs();
    feedSerial();
    const target = T * PER_MS, deadline = performance.now() + SLICE;
    try {
      while (cpu.cycles < target) {
        for (let i = 0; i < 4096 && cpu.cycles < target; i++) { avrInstruction(cpu); cpu.tick(); }
        if (rxWaiting()) feedSerial();
        if (performance.now() > deadline) break;
      }
    } catch (e) { state = 'error'; error = { line: 0, msg: String((e && e.message) || e) }; }
    analyse();
    devices.frame();
    if (eeDirty) flushEeprom();
    if (tap && tapBuf) { tap(tapBuf, vt()); }
    tapBuf = '';
  }

  const devices = attachDevices({ cpu, MHZ, twi, spi, hw, pinApi, uart, uarts: uarts.map(U => ({ name: U.name, rx: U.rx, tx: U.tx, api: U.api })), warnings });
  devices.frame();
  const debug = { enabled: false, paused: false, at: { line: 0, fn: null }, pause() {}, resume() {}, step() {}, setBreakpoints() {}, locals: () => [], globals: () => [] };
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
    debug, logic, firmware: 'avr', mcu: chip.name,
    get state() { return state; }, get error() { return error; }, get line() { return null; },
    takeSerial() { const s = out; out = ''; return s; },
    send(s) { for (const ch of String(s)) serialIn.push(ch.charCodeAt(0) & 0xff); },
    stop() { state = 'stopped'; devices.dispose(); },
    /** Pour les tests et les modèles de modules : le processeur émulé et ses périphériques. */
    hw: { cpu, ports, usart, uarts: Object.fromEntries(uarts.map(U => [U.name, U.api])), adc, twi, spi, eeprom: eeBack, pinApi, devices }
  };
}
