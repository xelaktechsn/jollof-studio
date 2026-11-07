// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mode « fidèle » du Raspberry Pi Pico : le vrai programme machine (compilé par arduino-cli avec le cœur
// arduino-pico) tourne, instruction par instruction, sur un RP2040 émulé (rp2040js, licence MIT), avec la vraie
// mémoire morte de la puce (src/emu/rp2040-bootrom.js). Le moteur expose la même interface que celui de l'Uno (avr.js) :
// broches, temps virtuel, port série, sondes, modules I2C/SPI, pour que le calcul du circuit, les effecteurs,
// l'oscilloscope et le moniteur série n'y voient aucune différence.
//   Serial  : l'USB (CDC) de la carte, relié au moniteur série par un hôte USB simulé (USBCDC de rp2040js).
//   Serial1 : l'UART0 (GP0/GP1), vu par les modules série branchés (uart ci-dessous).
//   PWM, tone(), Servo : la PWM matérielle et les machines PIO font de vrais fronts sur les broches ; on les mesure.
import { RP2040, GPIOPinState, USBCDC, I2CMode } from 'rp2040js';
import { bootromB1 } from './rp2040-bootrom.js';
import { pinMap } from '../prog/runtime.js';
import { attachDevices } from './devices/index.js';
import { tl } from '../i18n/index.js';

// Les modèles de modules comptent en « cycles » de 8 ns (125 MHz, l'horloge de base du RP2040), quelle que soit
// la fréquence choisie par le programme : io.us() et les horodatages des fronts restent justes.
export const MHZ = 125e6;
const NS = 1e9 / MHZ;     // ns par cycle
const PER_MS = MHZ / 1000;
const SLICE = 8;          // ms de calcul par image au plus (comme l'interpréteur)
const LAG = 250;          // au-delà, le temps virtuel cède : un vieux PC ralentit la carte au lieu de rattraper
const WINDOW = 60;        // ms : fenêtre d'analyse des fronts (PWM, tone(), servo)
const RING = 256;         // fronts gardés par broche
const LED = 25;           // LED de la carte (LED_BUILTIN)
const FLASH = 0x10000000, FUNC_NULL = 0x1f;
const EE_AT = 0x1ff000, EE_SIZE = 4096; // secteur de l'EEPROM d'arduino-pico (_EEPROM_start) : fin de la flash de 2 Mo
const BK_ERASE = 0xf0, BK_PROGRAM = 0xf1; // points d'arrêt posés sur les fonctions d'écriture de la flash de la bootrom
const ADC_REF = 3.3, ADC_MAX = 4095;

/** Image du programme : .bin (copie brute de la flash) ou .uf2 (blocs de 512 octets adressés). Rend [{ at, data }]. */
export function parseImage(image) {
  const b = image instanceof Uint8Array ? image : new Uint8Array(image);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const isUf2 = b.length >= 512 && b.length % 512 === 0 && dv.getUint32(0, true) === 0x0a324655 && dv.getUint32(4, true) === 0x9e5d5157;
  if (!isUf2) return [{ at: 0, data: b }];
  const parts = [];
  for (let o = 0; o + 512 <= b.length; o += 512) {
    if (dv.getUint32(o, true) !== 0x0a324655 || dv.getUint32(o + 4, true) !== 0x9e5d5157 || dv.getUint32(o + 508, true) !== 0x0ab16f30) throw new Error(tl('Fichier UF2 abîmé (bloc {0}).', o / 512));
    const flags = dv.getUint32(o + 8, true), addr = dv.getUint32(o + 12, true), size = dv.getUint32(o + 16, true);
    if (flags & 1) continue; // bloc « pas pour la flash principale »
    if (addr < FLASH || size > 476) throw new Error(tl('Fichier UF2 abîmé (bloc {0}).', o / 512));
    parts.push({ at: addr - FLASH, data: b.subarray(o + 32, o + 32 + size) });
  }
  return parts;
}

/**
 * Moteur d'exécution d'un programme compilé pour le Pico. image : octets du .bin (ou du .uf2) ; hw : pont vers
 * le montage (makeHw, src/prog/panel.js), dont on lit hw.prof, hw.kind et hw.read(clé) pour les entrées.
 */
export function createRp2040Runtime(image, hw, opts = {}) {
  const prof = hw.prof, logic = prof.logic, keys = pinMap(prof, hw.kind);
  const mcu = new RP2040(), clock = mcu.clock, core = mcu.core;
  let state = 'run', error = null;
  // Journal de rp2040js : silencieux, sauf les vraies fautes (accès mal aligné…), qui arrêtent la carte.
  mcu.logger = { debug() {}, info() {}, warn() {}, error(c, m) { throw new Error(`${c} : ${m}`); } };
  mcu.loadBootrom(opts.bootrom || bootromB1());
  for (const p of parseImage(image)) {
    if (p.at + p.data.length > mcu.flash.length) throw new Error(tl('Programme trop gros pour la flash du Pico.'));
    mcu.flash.set(p.data, p.at);
  }
  // EEPROM (émulée par arduino-pico dans le dernier secteur de la flash) : la même mémoire que l'interpréteur
  // (prog.mem de la carte, en hexadécimal), gardée avec le projet.
  const mem = hw.mem ? hw.mem() : { ee: '' };
  for (let i = 0; i < Math.min(EE_SIZE, (mem.ee || '').length >> 1); i++) mcu.flash[EE_AT + i] = parseInt(mem.ee.substr(2 * i, 2), 16) & 255;
  let eeDirty = false;
  const flushEeprom = () => {
    eeDirty = false;
    let end = EE_SIZE; while (end > 0 && mcu.flash[EE_AT + end - 1] === 0xff) end--;
    mem.ee = Array.from(mcu.flash.subarray(EE_AT, EE_AT + end), b => b.toString(16).padStart(2, '0')).join('');
    if (hw.memChanged) hw.memChanged();
  };
  // Écriture de la flash (EEPROM.commit(), LittleFS) : flash_range_erase et flash_range_program de la bootrom
  // parlent à la puce de flash par le SSI, que rp2040js n'émule pas. Leur première instruction devient un point
  // d'arrêt : l'effacement (octets à 0xFF) et la programmation (bits mis à 0) se font ici, puis retour à l'appelant.
  const rom16 = new Uint16Array(mcu.bootrom.buffer);
  const romFn = code => { for (let p = rom16[0x14 >> 1]; p && rom16[p >> 1]; p += 4) if (rom16[p >> 1] === code) return rom16[(p + 2) >> 1] & ~1; return -1; };
  const fnErase = romFn(0x4552 /* 'R','E' */), fnProgram = romFn(0x5052 /* 'R','P' */);
  if (fnErase > 0) rom16[fnErase >> 1] = 0xbe00 | BK_ERASE;
  if (fnProgram > 0) rom16[fnProgram >> 1] = 0xbe00 | BK_PROGRAM;
  const touchesEe = (a, n) => a < EE_AT + EE_SIZE && a + n > EE_AT;
  mcu.onBreak = code => {
    const r = core.registers, a = r[0] >>> 0;
    if (code === BK_ERASE || code === BK_PROGRAM) {
      if (code === BK_ERASE) { const n = Math.min(r[1] >>> 0, mcu.flash.length - a); if (n > 0) mcu.flash.fill(0xff, a, a + n); if (touchesEe(a, n)) eeDirty = true; }
      else { const src = r[1] >>> 0, n = Math.min(r[2] >>> 0, mcu.flash.length - a); for (let i = 0; i < n; i++) mcu.flash[a + i] &= mcu.readUint8(src + i); if (touchesEe(a, n)) eeDirty = true; }
      core.PC = core.LR & ~1;
      return;
    }
    // Autre BKPT : le programme s'est arrêté sur une erreur fatale (panic() du SDK, assertion).
    if (state === 'run') { state = 'error'; error = { line: 0, msg: tl('Le programme s’est arrêté sur une erreur fatale (panic, point d’arrêt {0}).', code) }; }
  };
  // Démarrage : directement sur l'étage boot2 en tête de la flash (la vérification de la flash par la bootrom n'est
  // pas émulée). boot2 règle la lecture de la flash puis saute au programme ; la bootrom reste là pour ses
  // fonctions (calcul flottant, copies mémoire, écriture de la flash) que le SDK appelle.
  core.PC = FLASH;
  // rp2040js n'émule que le cœur 0 : la file entre les deux cœurs (SIO 0x50 à 0x58) répond comme si le cœur 1
  // dormait (rien à lire, toujours de la place), au lieu d'avertissements dans la console à chaque accès.
  const sioRead = mcu.sio.readUint32.bind(mcu.sio), sioWrite = mcu.sio.writeUint32.bind(mcu.sio);
  mcu.sio.readUint32 = off => (off === 0x50 ? 0b0010 : off === 0x54 || off === 0x58 ? 0 : sioRead(off));
  mcu.sio.writeUint32 = (off, v) => { if (off < 0x50 || off > 0x58) sioWrite(off, v); };
  // Plots des broches à leur valeur de démarrage (fiche technique : entrée active, tirage bas) : digitalRead()
  // sans pinMode() lit la broche, comme sur la carte.
  for (const g of mcu.gpio) g.padValue = 0x56;
  const cyc = () => clock.nanos / NS, vt = () => clock.nanos / 1e6;
  const pins = new Map(), lines = [], warnings = new Map(), byNum = new Map();
  let out = '', tapBuf = '', serialIn = [], uartIn = [], T = 0, started = false, trace = null, tap = null;

  /** Mode de la broche vu par le circuit : 1 sortie, 2 entrée avec tirage haut, 3 avec tirage bas, 0 sinon. */
  function modeOf(g, st) {
    if (st === GPIOPinState.High || st === GPIOPinState.Low) return 1;
    if (g.functionSelect === FUNC_NULL) return 0;
    return st === GPIOPinState.InputPullUp ? 2 : st === GPIOPinState.InputPullDown ? 3 : 0;
  }
  /** Niveau d'une broche en entrée : un module qui la tire (DHT, 1-Wire…), sinon le montage, sinon le tirage interne. */
  function inLevel(L) { return L.dev != null ? L.dev : L.ext != null ? L.ext : L.rec.mode === 2; }
  /** Niveau lu par le processeur (registre GPIO_IN) : changé seulement s'il change, sinon de faux fronts d'interruption. */
  function setIn(L, v) { if (L.inVal !== v) { L.inVal = v; L.gpio.setInputValue(v); } }
  /** La ligne change de niveau : les modules abonnés (protocoles temporisés) le voient au cycle près. */
  function lineChanged(L, lv, c) {
    if (lv === L.line) return;
    L.line = lv;
    for (const fn of L.subs.slice()) fn(lv, c);
  }

  // Une fiche par broche, de la même forme que celle de l'interpréteur. GP25 (LED de la carte) : « LED_BUILTIN ».
  for (let n = 0; n < mcu.gpio.length; n++) {
    const key = keys.get(n) || (n === LED ? 'LED_BUILTIN' : null); if (!key) continue;
    const rec = { mode: 0, d: 0, pwm: null, freq: 0, ledc: 0, toneEnd: 0, servo: null, px: null, stepper: null, weak: false, dac: null };
    const L = { key, n, gpio: mcu.gpio[n], rec, level: 0, inVal: false, ext: null, dev: null, line: 1, subs: [], ring: new Float64Array(RING), lev: new Uint8Array(RING), head: 0, count: 0, sliceEdges: 0 };
    pins.set(key, rec); lines.push(L); byNum.set(n, L);
    // Sortie (SIO, PWM, PIO) ou entrée qui change : appelé au moment exact du changement, alarmes de la PWM comprises
    // (une machine PIO donne sa propre heure, voir pioStep).
    L.gpio.addListener(st => {
      const now = pioEdgeT != null ? pioEdgeT / NS : cyc(), out1 = st === GPIOPinState.High || st === GPIOPinState.Low, lv = st === GPIOPinState.High ? 1 : 0;
      L.rec.mode = modeOf(L.gpio, st);
      // Une sortie se relit elle-même (digitalRead d'une sortie) ; une entrée prend aussitôt le niveau du montage.
      setIn(L, out1 ? !!lv : inLevel(L));
      lineChanged(L, out1 ? lv : +inLevel(L), now);
      if (!out1 || lv === L.level) { if (!out1) L.level = 0; return; }
      L.level = lv;
      L.ring[L.head] = now; L.lev[L.head] = lv; L.head = (L.head + 1) % RING; L.count = Math.min(RING, L.count + 1);
      L.sliceEdges++;
      if (trace && L.sliceEdges <= 64) trace(L.key, { d: lv, pwm: null, freq: 0 }, now / PER_MS);
    });
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
      if (L.rec.mode !== 1) { setIn(L, inLevel(L)); lineChanged(L, +inLevel(L), cyc()); }
    },
    /** Fiche de la broche (celle de pins) : un module y publie ce qu'il affiche (px des LED WS2812…). */
    rec: key => { const L = byKey.get(key); return L ? L.rec : null; }
  };

  // Serial : l'USB de la carte. Un hôte simulé l'énumère puis ouvre le port (DTR), comme un PC avec le moniteur ouvert.
  const usb = mcu.usbCtrl, cdc = new USBCDC(usb);
  let usbOpen = false, pendingRead = null;
  cdc.onDeviceConnected = () => { usbOpen = true; };
  cdc.onSerialData = buf => { let s = ''; for (const b of buf) s += String.fromCharCode(b); out += s; tapBuf += s; };
  // Le programme arme sa réception USB : sans octet à envoyer, l'hôte attend (sinon un paquet vide toutes les 10 µs).
  const cdcRead = usb.onEndpointRead;
  usb.onEndpointRead = (ep, size) => { if (cdc.txFIFO.empty && ep === cdc.outEndpoint) pendingRead = [ep, size]; else cdcRead(ep, size); };
  function feedSerial() {
    if (usbOpen && serialIn.length) {
      while (serialIn.length && !cdc.txFIFO.full) cdc.sendSerialByte(serialIn.shift());
      if (pendingRead && !cdc.txFIFO.empty) { const [ep, size] = pendingRead; pendingRead = null; cdcRead(ep, size); }
    }
    const u = mcu.uart[0];
    while (uartIn.length && u.rxEnabled && !(u.flags & 0x40)) u.feedByte(uartIn.shift()); // 0x40 : file de réception pleine
  }
  // Serial1 (UART0, GP0/GP1) : liaison série vue par les modules (HC-05, GPS…), comme D0/D1 sur l'Uno.
  const txSubs = [];
  mcu.uart[0].onByte = b => { for (const fn of txSubs) fn(b, cyc()); };
  const uart = {
    onTx(fn) { txSubs.push(fn); return () => { const i = txSubs.indexOf(fn); if (i >= 0) txSubs.splice(i, 1); }; },
    inject(bytes) { for (const b of bytes) uartIn.push(b & 0xff); },
    baud: () => mcu.uart[0].baudRate
  };

  // Bus I2C et SPI pour les modèles de modules (src/emu/devices) : les deux contrôleurs de chaque bus servent le
  // même montage. Les octets s'échangent sans délai : le SDK attend les drapeaux, qui sont aussitôt levés.
  let i2cHandler = null;
  const i2c = {
    setHandler(h) {
      i2cHandler = h;
      for (const bus of mcu.i2c) {
        bus.onStart = () => { h.start(); bus.completeStart(); };
        bus.onConnect = (addr, mode) => bus.completeConnect(!!h.connect(addr, mode === I2CMode.Write));
        bus.onWriteByte = v => bus.completeWrite(!!h.write(v));
        bus.onReadByte = ack => bus.completeRead(h.read(ack) & 0xff);
        bus.onStop = () => { h.stop(); bus.completeStop(); };
      }
      softI2c(h);
    }
  };
  const spiBus = { onTransfer(fn) { for (const s of mcu.spi) s.onTransmit = v => s.completeTransmit(fn(v) & 0xff); } };
  const after = (cycles, fn) => clock.createAlarm(fn).schedule(Math.max(1, Math.round(cycles)) * NS);

  /**
   * I2C « logiciel » : Wire.endTransmission() sans octet (scanner I2C) ne passe pas par le contrôleur, le cœur
   * arduino-pico fait les signaux lui-même sur SDA/SCL (drain ouvert). Chaque paire de broches I2C du RP2040
   * (SDA paire, SCL = SDA + 1) est donc écoutée : départ, adresse, octets, et le module répond en tirant SDA.
   */
  function softI2c(h) {
    for (let n = 0; n + 1 < 30; n += 2) {
      const sda = byNum.get(n), scl = byNum.get(n + 1); if (!sda || !scl) continue;
      // st : 0 libre, 1 adresse, 2 écriture (carte → module), 3 lecture (module → carte), 4 attente de l'arrêt.
      // Le bus des modules n'est sollicité qu'une fois une adresse entière reçue (open) : un front isolé ne le
      // dérange pas pendant un échange du contrôleur matériel.
      let st = 0, ninth = false, bits = 0, byte = 0, ack = false, open = false, held = false;
      // SDA n'est relâchée que si c'est nous qui la tenions : un autre module (DHT…) peut la piloter.
      const pull = v => { if (v == null && !held) return; held = v != null; pinApi.drive(sda.key, v); };
      const sendBit = () => pull((byte >> (7 - bits)) & 1 ? null : false);
      const close = () => { pull(null); if (open) h.stop(); open = false; };
      sda.subs.push(lv => {
        if (scl.line !== 1 || scl.rec.mode === 1) return; // SDA ne compte que SCL haute et relâchée
        if (!lv) { if (open) pull(null); st = 1; ninth = false; bits = 0; byte = 0; } // départ (ou départ répété)
        else if (st) { close(); st = 0; } // arrêt
      });
      scl.subs.push(lv => {
        if (!st || st === 4) return;
        if (lv) { // front montant : le bit est lu
          if (!ninth) { if (st !== 3) byte = ((byte << 1) | sda.line) & 0xff; bits++; }
          else if (st === 3) ack = !sda.line; // la carte acquitte (ou non) l'octet lu
          return;
        }
        if (!ninth) { // front descendant d'un bit de données
          if (st === 3) { if (bits < 8) sendBit(); else { pull(null); ninth = true; } return; }
          if (bits < 8) return;
          if (st === 1) { h.start(); open = true; ack = !!h.connect(byte >> 1, !(byte & 1)); } else ack = !!h.write(byte);
          if (ack) pull(false);
          ninth = true;
          return;
        }
        // Fin du neuvième coup d'horloge : octet suivant.
        pull(null); ninth = false; bits = 0;
        if (st === 3) { if (ack) { byte = h.read(true) & 0xff; sendBit(); } else st = 4; return; }
        if (!ack) { st = 4; return; }
        if (st === 1 && byte & 1) { st = 3; byte = h.read(true) & 0xff; sendBit(); } else { st = 2; byte = 0; }
      });
    }
  }

  /*
   * Machines PIO (tone(), Servo, NeoPixel… du cœur arduino-pico). rp2040js les fait tourner à part (setTimeout),
   * hors du temps simulé, sans compter les attentes [delay] ni le diviseur d'horloge. Ici chaque machine a sa propre
   * heure, avancée instruction par instruction au rythme de son horloge, en même temps que le processeur. Une
   * machine en attente (FIFO vide, broche, IRQ) dort jusqu'à ce que rp2040js lève l'attente. Les boucles de comptage
   * (« jmp y-- » ou « jmp x-- » vers l'arrière, corps fait de sauts et de nop) sont parcourues d'un coup jusqu'au
   * prochain tour où une condition change : un tone() à 1 kHz compte 200 000 tours par période à 200 MHz.
   */
  const sms = [];
  let pioNext = Infinity, pioIdle = false, pioEdgeT = null;
  for (const pio of mcu.pio) {
    pio.run = () => { pioNext = 0; }; // machine mise en marche : prise en compte à l'instruction suivante
    for (const m of pio.machines) sms.push({ pio, m, t: 0, on: false, idle: false, head: null });
  }
  const pioOn = () => !mcu.pio[0].stopped || !mcu.pio[1].stopped;
  /** Le corps de boucle [a, b] ne fait que des sauts internes (conditions sur x et y) et des nop (mov x, x / mov y, y). */
  function loopBody(ins, a, b, dec) {
    for (let p = a; p <= b; p++) {
      const op = ins[p], kind = (op >>> 13) & 7;
      if (kind === 0) { const c = (op >> 5) & 7, to = op & 31; if (!(c === 0 || c === 1 || c === 3 || c === 5 || c === dec) || to < a || to > b) return false; }
      else if (kind === 5) { const dst = (op >> 5) & 7, src = op & 7; if ((op >> 3) & 3 || !((dst === 1 && src === 1) || (dst === 2 && src === 2))) return false; }
      else return false;
    }
    return true;
  }
  /** Après un « jmp x--/y-- » pris vers l'arrière : si le tour précédent est identique, sauter les tours identiques. */
  function loopSkip(M, pc, ns) {
    const m = M.m, ins = M.pio.instructions, op = ins[pc], c = (op >> 5) & 7, to = op & 31;
    if (M.head && (pc < M.head.to || pc > M.head.pc)) M.head = null; // sortie de la boucle
    if ((op >>> 13) !== 0 || (c !== 2 && c !== 4) || to > pc) return;
    if (m.pc !== to || m.waiting || m.execValid) { M.head = null; return; }
    const ctr = c === 4 ? 'y' : 'x', other = c === 4 ? 'x' : 'y';
    const v = m[ctr] >>> 0, o = m[other] >>> 0, pv = M.pio.pinValues, pd = M.pio.pinDirections, h = M.head;
    const same = h && h.to === to && h.pc === pc;
    if (same && h.o === o && h.v === ((v + 1) >>> 0) && h.pv === pv && h.pd === pd && (h.ok ??= loopBody(ins, to, pc, c))) {
      // Les tours qui commencent avec le compteur entre la prochaine valeur particulière (0 ou l'autre registre)
      // exclue et sa valeur actuelle prennent tous le même chemin : on les saute d'un bloc.
      const per = m.cycles - h.cyc, s = o <= v ? o : 0, k = v - s;
      if (k > 2 && per > 0) { m[ctr] = s; m.cycles += k * per; M.t += k * per * ns; }
    }
    M.head = { to, pc, o, v: m[ctr] >>> 0, pv, pd, cyc: m.cycles, ok: same ? h.ok : undefined };
  }
  /** Fait avancer les machines PIO jusqu'à l'instant now (ns). */
  function pioStep(now) {
    const sysNs = 1e9 / mcu.clkSys;
    let next = Infinity, idle = false;
    for (const M of sms) {
      const m = M.m;
      if (!m.enabled) { M.on = false; continue; }
      if (!M.on || (M.idle && !m.waiting)) { M.on = true; M.idle = false; M.t = now; M.head = null; }
      if (M.idle) { idle = true; continue; }
      const ns = ((m.clockDivInt || 65536) + m.clockDivFrac / 256) * sysNs;
      let g = 0;
      for (; M.t <= now && g < 100000; g++) {
        const pc = m.pc, c0 = m.cycles, w = m.waiting;
        pioEdgeT = M.t;
        try { m.step(); M.pio.checkChangedPins(); } finally { pioEdgeT = null; }
        const dc = m.cycles - c0;
        if (w && m.waiting && !dc) { M.idle = true; break; }
        M.t += Math.max(1, dc) * ns;
        if (w) continue;
        // Saut sur place sans compteur (« halt: jmp !x halt ») : rien ne change tant que le processeur n'agit pas.
        const op = M.pio.instructions[pc], c = (op >> 5) & 7;
        if ((op >>> 13) === 0 && (op & 31) === pc && m.pc === pc && (c === 0 || c === 1 || c === 3 || c === 5)) { M.t = Math.max(M.t, now + ns); break; }
        loopSkip(M, pc, ns);
      }
      if (g >= 100000 && M.t <= now) M.t = now + ns; // programme PIO trop rapide pour être suivi : il cède du temps
      if (M.idle) idle = true; else next = Math.min(next, M.t);
    }
    pioNext = next; pioIdle = idle;
  }

  /** Entrées : niveau imposé par le montage (capteur, bouton, autre carte), sinon tirage interne ; tensions de l'ADC. */
  function readInputs() {
    for (const L of lines) {
      L.rec.mode = modeOf(L.gpio, L.gpio.value);
      if (L.rec.mode === 1) continue;
      const r = hw.read ? hw.read(L.key) : null;
      L.ext = r ? (r.d != null ? !!r.d : r.v > logic / 2) : null;
      setIn(L, inLevel(L));
      lineChanged(L, +inLevel(L), cyc());
    }
    // ADC : GP26 à GP28 (canaux 0 à 2), VSYS/3 (canal 3), capteur de température à 27 °C (canal 4).
    const code = v => Math.max(0, Math.min(ADC_MAX, Math.round(v / ADC_REF * ADC_MAX)));
    for (let ch = 0; ch < 3; ch++) {
      const r = hw.read ? hw.read('GP' + (26 + ch)) : null;
      mcu.adc.channelValues[ch] = code(r ? (r.v != null ? r.v : r.d ? logic : 0) : 0);
    }
    mcu.adc.channelValues[3] = code(4.7 / 3);
    mcu.adc.channelValues[4] = code(0.706);
  }
  /** Fin de tranche : la forme du signal de chaque sortie (niveau fixe, PWM, tone(), impulsions de servo). */
  function analyse() {
    const now = cyc(), from = now - WINDOW * PER_MS;
    for (const L of lines) {
      const r = L.rec, many = L.sliceEdges > 64;
      L.sliceEdges = 0;
      if (r.mode !== 1) { r.pwm = null; r.freq = 0; r.servo = null; r.d = 0; continue; }
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

  function run(dt) {
    if (state !== 'run') return;
    if (started) T += Math.min(Math.max(dt, 0), 250);
    started = true;
    if (T - vt() > LAG) T = vt() + LAG; // la carte ne rattrape pas indéfiniment un retard pris sur une machine lente
    readInputs();
    feedSerial();
    const target = T * 1e6, deadline = performance.now() + SLICE;
    try {
      while (clock.nanos < target && state === 'run') {
        const ns = 1e9 / mcu.clkSys; // la fréquence du processeur suit les PLL réglées par le programme
        let pio = pioOn();
        if (pio) pioStep(clock.nanos);
        for (let i = 0; i < 4096 && clock.nanos < target; i++) {
          if (core.waiting) {
            // WFI/WFE (delay(), attente d'une interruption) : on saute directement à la prochaine échéance.
            let next = clock.nextAlarm ? Math.max(0, clock.nanosToNextAlarm) : Infinity;
            if (pio) next = Math.min(next, Math.max(0, pioNext - clock.nanos));
            clock.tick(Math.min(next, target - clock.nanos));
          } else clock.tick(core.executeInstruction() * ns);
          if (pioNext === 0) pio = pioOn(); // une machine vient d'être mise en marche
          if (pio && (pioIdle || clock.nanos >= pioNext)) pioStep(clock.nanos);
        }
        feedSerial();
        if (performance.now() > deadline) break;
      }
    } catch (e) { state = 'error'; error = { line: 0, msg: String((e && e.message) || e) }; }
    analyse();
    devices.frame();
    if (eeDirty) flushEeprom();
    if (tap && tapBuf) { tap(tapBuf, vt()); }
    tapBuf = '';
  }

  const devices = attachDevices({ cpu: mcu, MHZ, hw, pinApi, uart, now: cyc, after, i2c, spiBus });
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
    debug, logic, firmware: 'rp2040',
    get state() { return state; }, get error() { return error; }, get line() { return null; },
    takeSerial() { const s = out; out = ''; return s; },
    send(s) { for (const ch of String(s)) serialIn.push(ch.charCodeAt(0) & 0xff); },
    stop() { state = 'stopped'; },
    /** Pour les tests et les modèles de modules : le processeur émulé et ses périphériques. */
    hw: { mcu, cpu: core, clock, cdc, usbOpen: () => usbOpen, pinApi, uart, devices, i2c: () => i2cHandler }
  };
}
