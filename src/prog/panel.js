// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Onglet « Code » : programme de chaque carte, règles de comportement, éditeur,
// téléversement, débogueur (points d'arrêt, pas à pas, variables), moniteur et traceur série.
// Le programme d'une carte vient de ses règles (code généré, régénéré à chaque changement)
// ou du code écrit à la main.
import { driveBoard } from '../sim/drive.js';
import { compile } from './lang.js';
import { createRuntime } from './runtime.js';
import { EMULATED, QEMU_KINDS, setQemuReady } from '../emu/boards.js';
import { esp32Refusal, UNBRIDGED, INTERP_ONLY, interpOnlyReason } from '../emu/esp32-limits.js';
import { generate, skeleton, newRule, ruleText, condText, SIGNALS, ACTIONS, OPS, TEXT_OPS, signalOf, defArg, isSensor, isActuator, actsFor, actItem, migrate, findById, actsOf, involves, numberRules, defaultActs,
  SERIAL, SERIAL_ACTS, SHOWS, termsOf, termDefaults, srcSignal, varSignal, fmtTime, VAR_TYPE_LABELS, varText, seqText, uid, ident } from './rules.js';
import { NET, NET_SIG, NET_ACTS, PAGE_ROWS, TOPIC_PUB, TOPIC_SUB, netLink, netItem, netText, fixNet, autoMac, cleanTopic } from './rules-net.js';
import './rules.css';
import { QUANT, ENV, MODELS, NET_DEFAULT, envOf } from '../sim/models.js';
import { createEditor, highlight } from './editor.js';
import { createPlotter } from './plotter.js';
import { Q, LIGHT } from '../quality.js';
import { saveFile, qemuStatus, qemuInstall, qemuTransport, isTauri } from '../native.js';
import { createRealMonitor, baudOf, ENDINGS, whoLabel } from '../hil/monitor.js';
import { listPorts, BAUDS, webSerial } from '../hil/serial.js';
import './debug.css';
import './visual/mode.css';
import { generateVisual, visualContext } from './visual/generator.js';
import { emptyWorkspace } from './visual/types.js';
import { rulesToBlocks, appendRule, hasBlocks } from './visual/fromRules.js';
import { confirm as askConfirm, ask, dialog } from '../school/ui.js';
import { boardOf, kindOf } from '../sim/boards.js';
import { pkgI2c, pkgTypes } from '../sim/pkgparts.js';
import { i2cAddress } from '../sim/pkgbus.js';
import { analyze, inspect, firstMsg } from '../sim/circuit.js';
import { partOf, isMotor } from '../sim/parts.js';
import { I2C_CHIPS, chipAddr, netLevel } from '../sim/chips.js';
import { STORE_I2C, storeAddr } from '../sim/storage.js';
import { SENSOR_I2C, sensorAddr } from '../sim/i2csensors.js';
import { syncCard } from '../emu/devices/sdcard.js';
import { icon } from '../ui/icons.js';
import * as audio from '../sim/audio.js';
import { CANCEL, tl, COLON } from '../i18n/index.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Famille de carte pour le compilateur : uno, nano, mega, esp32, nodemcu ou pico. */
export const boardKind = kindOf;
const LOG_MAX = 40000;

/**
 * Moteurs des cartes lancées. Un moteur remplacé ou retiré est arrêté (dispose) : celui de l'ESP32 fait tourner
 * un émulateur à part (QEMU), qui doit s'arrêter avec lui.
 */
class Runs extends Map {
  set(k, v) { const o = super.get(k); if (o && o !== v && o.dispose) o.dispose(); return super.set(k, v); }
  delete(k) { const o = super.get(k); if (o && o.dispose) o.dispose(); return super.delete(k); }
  clear() { for (const v of super.values()) if (v.dispose) v.dispose(); super.clear(); }
}

/**
 * app : { comps(), wires(), sim() → { A, ins, drive, pinComps }, simOn(), setSim(on), setTab(name),
 *         status(text, kind), markDirty(), refreshSel(), lan?() → réseau simulé du plan réseau (src/net/lan.js) ou null }
 */
export function createProgram(app) {
  // mem : EEPROM et Preferences de chaque carte (survivent au redémarrage et sont enregistrées avec le projet) ;
  // net : réseaux Wi-Fi simulés et journal (journal.jollof).
  let P = { rules: [], boards: {}, states: {}, mem: {}, net: null };
  const rts = new Runs(), logs = new Map(), diag = new Map(), uploaded = new Map();
  // Émulateur de l'ESP32 (QEMU) : état de l'installation (null tant que pas demandé), téléchargement en cours.
  let qemu = null, qemuJob = null;
  // Mode fidèle : compilation en cours (jeton par carte : une compilation dépassée est ignorée) et erreurs d'arduino-cli.
  const fwJobs = new Map(), fwDiag = new Map();
  // MicroPython (Pico) : erreur Python de chaque carte (Traceback), fichier à exécuter sans l'enregistrer au lancement.
  const pyDiag = new Map(), pyRunNext = new Map();
  let cur = null, editor = null, lastUi = 0, logDirty = true, checkT = 0, confirmGen = 0, warnSig = '';
  // Blocs de code : espace de travail Blockly de la carte affichée (chargé à la demande) et correspondances ligne → bloc.
  let vis = null, wideAuto = false, prev = null, rulesView = 'code', showCode = false, full = null;
  try { showCode = localStorage.getItem('jollof-vis-code') === '1'; } catch (e) { /* stockage indisponible */ } const visMeta = new Map(), tidyNext = new Set();
  try { rulesView = localStorage.getItem('jollof-rules-view') === 'blocks' ? 'blocks' : 'code'; } catch (e) { /* stockage indisponible */ }
  // Débogueur (voir plus bas) : carte à mettre en pause dès son lancement, lignes où le code affiché
  // peut s'arrêter, carte affichée, variables déjà montrées. Traceur série : vue du port série.
  let pendingPause = null, hookLines = null, shownId = null, watchKey = null, watchAt = 0, watchPrev = new Map(), stepping = false;
  let plot = null, serialView = 'mon';
  /* ---------- Carte réelle : moniteur série sur un port USB ---------- */
  const REAL = '__real';
  let src = 'sim', realPorts = [], portSig = null, portPoll = 0, baudPicked = false;
  try { src = localStorage.getItem('jollof-serial-src') === 'real' ? 'real' : 'sim'; } catch (e) { /* stockage indisponible */ }
  const real = createRealMonitor({
    onText: t => { logKey(REAL, t); if (plot) plot.feed(REAL, t, real.clock() || 0); },
    onChange: st => { if (st.state === 'on' && st.port !== $('#realPort').value) refreshPorts(); paintReal(); }, // reconnectée : liste et port à jour
    status: (m, k) => app.status(m, k)
  });

  const comps = () => app.comps();
  const byId = id => comps().find(c => c.id === id);
  const boards = () => comps().filter(c => boardOf(c));
  const board = () => { const bs = boards(); let b = bs.find(x => x.id === cur); if (!b) { b = bs[0] || null; cur = b && b.id; } return b; };
  /**
   * Moteur d'exécution d'une carte, choisi seul (il n'y a plus de « mode » à choisir) :
   * - 'micropython' : Pico programmé en Python (choix du langage) ;
   * - 'firmware' : le vrai programme, compilé par arduino-cli, sur le processeur émulé, dès que la carte en a un et que
   *   l'application installée trouve arduino-cli ;
   * - 'interp' : le simulateur intégré, seulement là où le vrai n'existe pas (carte sans émulateur, version web,
   *   arduino-cli absent, ESP32 avec Wi-Fi ou modules pas encore reliés à QEMU) et pour le débogueur pas à pas.
   */
  const relaunchT = new Map(); // relance différée d'un programme compilé après une retouche du montage
  let cliMissing = false; // arduino-cli introuvable pendant cette session : dit une fois, puis simulateur intégré
  const engineOf = b => {
    const e = b && P.boards[b.id];
    if (e && e.engine === 'micropython' && boardKind(b) === 'pico') return 'micropython';
    return realOk(b) && !wantsDebug(b) ? 'firmware' : 'interp';
  };
  /** Le vrai programme peut tourner sur cette carte (processeur émulé, compilateur ; ESP32 : ni Wi-Fi ni Bluetooth). */
  function realOk(b) {
    const kind = b && boardKind(b);
    if (!kind || !EMULATED.has(kind) || !isTauri() || cliMissing) return false;
    if (interpMods(b).length) return false; // ENC28J60 : pile TCP/IP du programme non reliée au réseau simulé
    if (!QEMU_KINDS.has(kind)) return true;
    const e = P.boards[b.id];
    if (esp32Refusal(typeof (e && e.code) === 'string' ? e.code : '')) return false; // Wi-Fi, Bluetooth : pas de radio émulée
    return !espModules(b).length; // modules que l'émulateur ne ferait pas répondre (aucun aujourd'hui)
  }
  /** Modules reliés à cet ESP32 que son émulateur ne fait pas répondre. */
  function espModules(b) {
    if (!UNBRIDGED.length) return [];
    try { const sn = snapshot(); return comps().filter(c => UNBRIDGED.includes(c.type) && sn.inspect(c).board === b); } catch (e) { return []; }
  }
  /** Modules reliés à cette carte qui la gardent sur l'interpréteur, quelle que soit la carte (ENC28J60). */
  function interpMods(b) {
    try { const sn = snapshot(); return comps().filter(c => INTERP_ONLY.includes(c.type) && sn.inspect(c).board === b); } catch (e) { return []; }
  }
  /** Pourquoi cette carte tourne sur le simulateur intégré (texte pour le journal), ou null. */
  function whyInterp(b) {
    const kind = boardKind(b);
    if (pyOf(b)) return null;
    if (realOk(b)) return wantsDebug(b) ? tl('débogueur pas à pas') : null;
    if (!EMULATED.has(kind) && !QEMU_KINDS.has(kind)) return tl('pas encore de processeur émulé pour cette carte');
    if (!isTauri()) return tl('la version web ne peut pas compiler : installez l’application');
    if (cliMissing) return tl('arduino-cli introuvable');
    const only = interpOnlyReason(interpMods(b));
    if (only) return only;
    const esp = QEMU_KINDS.has(kind);
    if (esp && !EMULATED.has(kind)) return tl('émulateur de l’ESP32 non installé');
    const e = P.boards[b.id];
    if (esp && esp32Refusal(typeof (e && e.code) === 'string' ? e.code : '')) return tl('Wi-Fi et Bluetooth : l’émulateur n’a pas de radio');
    if (esp && espModules(b).length) return tl('modules {0} non reliés à l’émulateur de l’ESP32', [...new Set(espModules(b).map(c => c.name))].join(', '));
    return null;
  }
  const pyOf = b => !!b && engineOf(b) === 'micropython';
  /** Moteur provisoire d'une carte dont le vrai programme se compile. */
  const compilingStub = (logic, firmware = null) => ({
    state: 'compiling', pins: new Map(), warnings: new Map(), line: null, error: null, logic, firmware,
    run() {}, clock: () => 0, probe: () => null, setTrace() {}, setSerialTap() {}, takeSerial: () => '', send() {}, stop() {},
    debug: { enabled: false, paused: false, at: { line: 0, fn: null }, pause() {}, resume() {}, step() {}, setBreakpoints() {}, locals: () => [], globals: () => [] }
  });
  function snapshot() {
    const A = analyze(app.comps(), app.wires()), cache = new Map();
    return { A, inspect: c => { if (!cache.has(c)) cache.set(c, inspect(c, A, partOf(c))); return cache.get(c); } };
  }
  /** Carte qui exécute la règle : celle de ses effecteurs, sinon celle de sa mesure. strict : sans repli sur la carte unique. */
  function ruleBoard(r, sn, strict) {
    if (r.board) { const b = boards().find(x => x.id === r.board); if (b) return b; }
    const cands = [...actsOf(r).map(a => byId(a.comp)), ...termsOf(r).map(t => t.src && t.src.comp && byId(t.src.comp))];
    for (const c of cands) {
      if (!c) continue;
      if (isMotor(c)) { const b = driveBoard(c, sn.A, sn.inspect); if (b) return b; continue; } // par son pilote, transistor ou relais
      const b = sn.inspect(c).board; if (b) return b;
    }
    const bs = boards(); return !strict && bs.length === 1 ? bs[0] : null;
  }
  const entry = b => P.boards[b.id] || null;
  const ensure = b => P.boards[b.id] || (P.boards[b.id] = { code: '', auto: true });
  const hasProgram = (b, sn) => !!entry(b) || P.rules.some(r => ruleBoard(r, sn) === b);
  const rulesOf = (b, sn) => P.rules.filter(r => { const rb = ruleBoard(r, sn); return rb === b || !rb; });
  /* ---------- MicroPython (Pico) : fichiers de la carte ---------- */
  const pyMain = () => `from machine import Pin\nimport time\n\nled = Pin(25, Pin.OUT)  # ${tl('LED de la carte (GP25)')}\n\nwhile True:\n    led.toggle()\n    time.sleep(0.5)\n`;
  /** Fichiers Python de la carte ({ 'main.py': texte, 'lib/lcd.py': … }, gardés avec le projet) ; e.file : celui affiché. */
  function pyFiles(b) {
    const e = ensure(b);
    if (!e.files || typeof e.files !== 'object' || !Object.keys(e.files).length) e.files = { 'main.py': pyMain() };
    if (!e.file || !(e.file in e.files)) e.file = 'main.py' in e.files ? 'main.py' : Object.keys(e.files).sort()[0];
    return e.files;
  }
  const pyFile = b => { pyFiles(b); return ensure(b).file; };
  const pySig = b => JSON.stringify(pyFiles(b));
  /** Nom de fichier accepté sur la carte : dossiers et fichiers simples (lib/capteur.py), sans « .. » ni « / » au début. */
  const pyName = n => /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/.test(n) && !n.split('/').some(x => x === '.' || x === '..');
  function codeOf(b, sn = snapshot()) {
    const e = ensure(b);
    if (e.mode === 'visual') {
      // Programme en blocs : le code est regénéré à chaque fois, les broches suivent le câblage.
      const r = generateVisual(b, e.blocks || emptyWorkspace(), { comps: comps(), A: sn.A, inspect: sn.inspect });
      if (r.code !== e.code && e.bps) delete e.bps;
      e.code = r.code; visMeta.set(b.id, r);
      return e.code;
    }
    if (e.auto) {
      const code = generate(b, { comps: comps(), A: sn.A, inspect: sn.inspect, rules: P.rules, states: P.states });
      if (code !== e.code && e.bps) delete e.bps; // code régénéré : ses lignes ont changé, points d'arrêt effacés
      e.code = code;
    }
    return e.code;
  }
  const ctxOf = b => ({ board: boardKind(b), boardLabel: boardOf(b).label });

  /* ---------- Pont vers le montage simulé ---------- */
  // Modules I2C et leur adresse. L'écran LCD répond à 0x27 et l'OLED à 0x3C, sauf adresse réglée sur le composant (c.inp.addr).
  const I2C = ['bmp280', 'bme280', 'bh1750', 'oled', 'lcd1602', 'lcd2004', 'mpu6050', ...I2C_CHIPS, ...STORE_I2C, ...SENSOR_I2C];
  const i2cAddr = (c, def) => { const a = c.inp ? Math.trunc(+c.inp.addr) : 0; return a > 0 && a < 128 ? a : def; };
  /** Le projet a changé pendant la simulation (mémoire, journal) : enregistrement au plus toutes les 2 s. */
  let dirtyT = 0;
  const softDirty = () => { if (dirtyT) return; dirtyT = setTimeout(() => { dirtyT = 0; app.markDirty(); }, 2000); };
  const netData = () => P.net || (P.net = NET_DEFAULT());
  const busProbes = new Map(); // carte → sonde de l'analyseur de bus (src/sim/buslog.js)
  const probeOf = b => {
    if (!app.busLog) return null;
    if (!busProbes.has(b.id)) busProbes.set(b.id, app.busLog.probe(b.id, () => { const rt = rts.get(b.id); return rt && rt.clock ? rt.clock() : 0; }));
    return busProbes.get(b.id);
  };
  function makeHw(b) {
    const prof = boardOf(b), sim = () => app.sim();
    // Module I2C en paquet : son adresse, ou l'autre si sa broche d'adresse reçoit l'alimentation.
    const pkgAddr = c => { const I = pkgI2c(c.type); return I ? [i2cAddress(I, !!I.addressPin && sim().A.net({ comp: c, key: I.addressPin }).src.length > 0)] : null; };
    const addr = c => pkgAddr(c) || (c.type === 'bmp280' || c.type === 'bme280' ? [sim().A.net({ comp: c, key: 'SDO' }).gnd.length ? 0x76 : 0x77] : c.type === 'bh1750' ? [sim().A.net({ comp: c, key: 'ADDR' }).src.length ? 0x5c : 0x23] : c.type === 'oled' ? [i2cAddr(c, 0x3c)] : c.type === 'lcd1602' || c.type === 'lcd2004' ? [i2cAddr(c, 0x27)] : STORE_I2C.includes(c.type) ? storeAddr(c, sim().A) : SENSOR_I2C.includes(c.type) ? sensorAddr(c, sim().A) : c.type === 'mpu6050' ? [0x68] : I2C_CHIPS.includes(c.type) ? chipAddr(c, sim().A) : []);
    const at = key => (sim().pinComps && sim().pinComps.get(b.id + '|' + key)) || [];
    /** Module câblé et alimenté (sinon le premier défaut de câblage). */
    const status = c => { const ins = sim().ins && sim().ins.get(c), ok = !!ins && ins.level !== 'err'; return { ok, msg: ok || !ins ? '' : firstMsg(ins) }; };
    return {
      kind: boardKind(b), label: `${b.name} (${prof.label})`, prof,
      /** Sonde de l'analyseur de bus : I2C, SPI et série de cette carte (src/sim/buslog.js). */
      probe: probeOf(b),
      /** Niveau imposé à une entrée : sortie d'un capteur, alimentation, masse, tirage externe, autre sortie. */
      read(key) {
        const s = sim(); if (!s.A) return null;
        const d = s.drive && s.drive.get(b.id + '|' + key);
        if (d) return d.v == null ? { d: d.d, v: d.d ? prof.logic : 0 } : d;
        const ref = { comp: b, key }, n = s.A.net(ref);
        if (n.src.length) return { d: 1, v: Math.max(...n.src.map(x => x.v)) };
        if (n.gnd.length) return { d: 0, v: 0 };
        for (const g of n.gpio) {
          if (g.comp === b && g.key === key) continue;
          const rt = rts.get(g.comp.id), p = rt && rt.pins.get(g.key);
          if (p && p.mode === 1) return { d: p.d, v: p.dac != null ? p.dac : p.d ? boardOf(g.comp).logic : 0 };
        }
        // À travers des composants (pont diviseur, condensateur, transistor) : la tension calculée par le solveur.
        const v = app.dcPin ? app.dcPin(b.id, key) : null;
        if (v != null) return { d: v > prof.logic / 2 ? 1 : 0, v };
        const w = s.A.wnet(ref);
        if (w.src.length) return { d: 1, v: Math.max(...w.src.map(x => x.v)) };
        if (w.gnd.length) return { d: 0, v: 0 };
        return null;
      },
      echo(key) { const h = at(key).find(x => x.comp.type === 'hcsr04' && x.pin === 'ECHO'), r = h && h.comp.simR; return r && r.level !== 'err' && r.data ? r.data.us : null; },
      onPin(key, types) { const h = at(key).find(x => types.includes(x.comp.type)); return h ? h.comp : null; },
      bus(types) {
        const s = sim();
        return comps().filter(c => types.includes(c.type)).filter(c => { const ins = s.ins && s.ins.get(c); return ins && ins.board === b && ins.level !== 'err'; }).map(c => ({ comp: c, addr: addr(c) }));
      },
      /** Modules de ces types reliés à cette carte et bien câblés (modèles du mode fidèle : SPI, signaux temporisés). */
      comps(types) {
        const s = sim();
        return comps().filter(c => types.includes(c.type)).filter(c => { const ins = s.ins && s.ins.get(c); return ins && ins.board === b && ins.level !== 'err'; });
      },
      data(c) { const r = c.simR; return r && r.level !== 'err' && r.data ? r.data : null; },
      /** Composants reliés à une broche de la carte, avec leur broche : [{ comp, pin }]. */
      at, status,
      /** Modules de ces types dans tout le montage (radio nRF24 des autres cartes). */
      peers(types) { return comps().filter(c => types.includes(c.type)).map(c => ({ comp: c, ok: status(c).ok })); },
      /** Modules du bus I2C de la carte (scanner I2C, Wire.endTransmission()). */
      i2c() { return this.bus([...I2C, ...pkgTypes('i2c')]); },
      /** La carte elle-même (son état partagé : Wi-Fi, serveur web, Bluetooth). */
      self: () => b,
      /** Mémoire de la carte qui survit au redémarrage : { ee : EEPROM en hexadécimal, prefs : Preferences }. */
      mem() { const m = P.mem || (P.mem = {}); return m[b.id] || (m[b.id] = { ee: '', prefs: {} }); },
      memChanged: softDirty,
      /** Mémoire d'un module gardée avec le projet (EEPROM AT24C256, carte SD…) : un objet propre au composant. */
      compMem(c) { const m = P.mem || (P.mem = {}); return m[c.id] || (m[c.id] = {}); },
      /** Broches d'autres composants sur le même nœud que la broche key du module c : [{ comp, key }] (chaîne de MAX7219…). */
      linked(c, key) { const s = sim(); if (!s.A || !c.pins || !c.pins[key]) return []; return s.A.members({ comp: c, key }).filter(m => m.comp !== c).map(m => ({ comp: m.comp, key: m.key })); },
      /** Réseaux Wi-Fi et journal du projet. */
      net: netData, netChanged: softDirty,
      /** Réseau simulé du plan réseau (src/net/lan.js), null si le projet n'en a pas : Ethernet, sockets, MQTT, Modbus. */
      lan: () => (app.lan ? app.lan() : null),
      /** Niveau d'une broche d'un module : 1 (alimentation ou sortie HIGH d'une carte), 0 (masse ou sortie LOW), null (en l'air). */
      level(c, key) {
        const s = sim(); if (!s.A || !c.pins || !c.pins[key]) return null;
        const n = s.A.net({ comp: c, key });
        if (n.src.length) return 1;
        if (n.gnd.length) return 0;
        for (const g of n.gpio) { const rt = rts.get(g.comp.id), p = rt && rt.pins.get(g.key); if (p && p.mode === 1) return p.d ? 1 : 0; }
        return null;
      },
      /**
       * Niveau du nœud d'une broche de module (entrées des puces logiques, sim/chips.js) : alimentation, masse, sortie
       * d'une puce ou d'une carte, tirage par une résistance ; null : en l'air.
       */
      node(c, key) {
        const s = sim(); if (!s.A) return null;
        return netLevel(s.A, { comp: c, key }, g => { const rt = rts.get(g.comp.id), p = rt && rt.pins.get(g.key); return p && p.mode === 1 ? (p.d ? 1 : 0) : null; });
      },
      /** Broche de la carte reliée au TRIG du HC-SR04 dont ECHO est sur key : null si TRIG n'est pas sur cette carte. */
      trig(key) {
        const h = at(key).find(x => x.comp.type === 'hcsr04' && x.pin === 'ECHO'); if (!h) return undefined;
        const ins = sim().ins && sim().ins.get(h.comp), g = ins && ins.io.TRIG;
        return g && g.comp === b ? g.key : null;
      }
    };
  }

  /* ---------- Exécution ---------- */
  function log(b, text) { logKey(b.id, text); }
  /** Journal d'une carte simulée (son id) ou de la carte réelle (REAL). */
  function logKey(id, text) {
    let s = (logs.get(id) || '') + text;
    if (s.length > LOG_MAX) s = s.slice(-LOG_MAX * 0.75);
    logs.set(id, s);
    if (id === (src === 'real' ? REAL : cur)) { logDirty = true; if (src === 'real') schedulePaint(); }
  }
  function clearScreens(b) {
    const ins = app.sim().ins;
    comps().forEach(c => { if (c.progScreen && (!ins || !ins.get(c) || ins.get(c).board === b)) c.progScreen = null; });
  }
  /** Compile et lance le programme d'une carte ; false s'il ne compile pas. */
  function launch(b, sn = snapshot()) {
    if (engineOf(b) === 'micropython') return launchPython(b);
    if (engineOf(b) === 'firmware') {
      const fw = codeOf(b, sn), why = QEMU_KINDS.has(boardKind(b)) ? esp32Refusal(fw) : null;
      if (!why) return launchFirmware(b, fw);
    }
    const code = codeOf(b, sn), res = compile(code, { ...ctxOf(b), debug: wantsDebug(b) });
    diag.set(b.id, { errors: res.errors, warnings: res.warnings });
    rts.delete(b.id); clearScreens(b);
    if (!res.ok) {
      if (pendingPause === b.id) pendingPause = null;
      const e = res.errors[0];
      app.status(tl('{0} : le programme ne compile pas, ligne {1} : {2}', b.name, e.line, e.msg), 'err');
      log(b, tl('\n✕ Erreur de compilation, ligne {0} : {1}\n', e.line, e.msg));
      if (EMULATED.has(boardKind(b)) && !isTauri()) log(b, tl('La version web ne connaît qu’une partie du C++ d’Arduino. L’application installée compile le vrai programme (pointeurs, classes, toutes les bibliothèques) et le fait tourner sur un processeur émulé.\n'));
      return false;
    }
    rts.set(b.id, attach(b, createRuntime(res.js, makeHw(b), res.debug || { globals: res.globals })));
    uploaded.set(b.id, code);
    const why = whyInterp(b);
    if (why && isTauri() && interpMods(b).length) app.status(tl('{0} tourne sur le simulateur intégré : {1}.', b.name, why), 'ok');
    log(b, why ? tl('{0}— {1} démarre (simulateur intégré : {2}) —\n', (logs.get(b.id) || '').length ? '\n' : '', b.name, why) : tl('{0}— {1} démarre —\n', (logs.get(b.id) || '').length ? '\n' : '', b.name));
    return true;
  }
  /**
   * Mode fidèle : le vrai programme est compilé par arduino-cli (quelques secondes, fichiers téléchargés à la
   * première utilisation), puis tourne sur le processeur émulé. En attendant, la carte affiche « Compilation… ».
   */
  function launchFirmware(b, code) {
    const token = {};
    fwJobs.set(b.id, token);
    rts.delete(b.id); clearScreens(b);
    rts.set(b.id, compilingStub(boardOf(b).logic));
    fwDiag.set(b.id, { errors: [], warnings: [] }); diag.set(b.id, fwDiag.get(b.id));
    log(b, tl('{0}— {1} : compilation du programme… —\n', (logs.get(b.id) || '').length ? '\n' : '', b.name));
    // Compilateur et processeur émulé chargés à la demande : ils ne pèsent rien tant qu'aucune carte ne tourne.
    // Pico : RP2040 (rp2040js) ; Uno, Nano : ATmega328P, Mega : ATmega2560 (avr8js) ; ESP32 : QEMU, programme à part (esp32.js).
    const pico = boardKind(b) === 'pico', esp = QEMU_KINDS.has(boardKind(b));
    Promise.all([import('../emu/compile.js'), pico ? import('../emu/rp2040.js') : esp ? import('../emu/esp32.js') : import('../emu/avr.js')]).then(([C, E]) => C.compileFirmware(code, boardKind(b), m => log(b, m + '\n')).then(res => [res, E])).then(([res, E]) => {
      if (fwJobs.get(b.id) !== token) return; // relancé ou arrêté entre-temps
      fwJobs.delete(b.id);
      if (!res.ok) {
        rts.delete(b.id);
        // arduino-cli absent : dit une fois, puis la carte tourne sur le simulateur intégré (la simulation continue).
        if (res.errors[0] && res.errors[0].cli) {
          cliMissing = true; fwDiag.delete(b.id);
          log(b, `\n! ${res.errors[0].msg}\n`); app.status(res.errors[0].msg, 'warn');
          if (app.simOn()) launch(b);
          render(); return;
        }
        fwDiag.set(b.id, { errors: res.errors, warnings: [] }); diag.set(b.id, fwDiag.get(b.id));
        const e = res.errors[0];
        app.status(tl('{0} : le programme ne compile pas, ligne {1} : {2}', b.name, e.line, e.msg), 'err');
        log(b, tl('\n✕ Erreur de compilation, ligne {0} : {1}\n', e.line, e.msg));
        if (b.id === cur) renderDiag();
        render();
        return;
      }
      let rt;
      try {
        rt = pico ? E.createRp2040Runtime(res.image, makeHw(b)) : esp ? E.createEsp32Runtime(res.image, makeHw(b), { transport: qemuTransport(b.id) }) : E.createAvrRuntime(res.hex, makeHw(b), { mcu: boardKind(b) === 'mega' ? 'atmega2560' : 'atmega328p' });
      } catch (e) { rts.delete(b.id); log(b, `\n✕ ${e.message}\n`); return; }
      rts.set(b.id, attach(b, rt));
      uploaded.set(b.id, code);
      log(b, esp ? tl('— {0} démarre : programme compilé, dans l’émulateur de l’ESP32 (QEMU) —\n', b.name) : tl('— {0} démarre : programme compilé, sur processeur émulé —\n', b.name));
      // Serial du Pico : l'USB, que le PC n'ouvre qu'après le démarrage ; ce qui est écrit avant est perdu.
      if (pico && /\bSerial\s*\.\s*print/.test(code) && !/!\s*Serial\b/.test(code)) log(b, tl('Pico : Serial passe par l’USB, que le PC n’ouvre qu’une vingtaine de millisecondes après le démarrage ; ce qui est écrit avant est perdu, comme sur la vraie carte. Ajoutez while (!Serial) delay(10); après Serial.begin().\n'));
      if (b.id === cur) renderDiag();
      render();
    });
    return true;
  }
  /**
   * MicroPython : le micrologiciel officiel tourne sur le RP2040 émulé (chargé à la demande, sans arduino-cli). Les
   * fichiers de la carte y sont écrits, puis main.py s'exécute ; une carte déjà lancée les reçoit et redémarre seule
   * (redémarrage logiciel, comme Thonny). file : { name, code } pour exécuter un fichier sans l'enregistrer.
   */
  function launchPython(b, file = null) {
    if (!file && pyRunNext.has(b.id)) { file = pyRunNext.get(b.id); pyRunNext.delete(b.id); }
    const files = { ...pyFiles(b) }, run = file ? { code: file.code, name: file.name } : 'main';
    pyDiag.set(b.id, []); if (b.id === cur) check();
    const rt0 = rts.get(b.id);
    if (rt0 && rt0.mpy && rt0.state === 'run') {
      if (file) rt0.mpy.runFile(file.name, file.code, files); else rt0.mpy.runMain(files);
      uploaded.set(b.id, pySig(b));
      log(b, file ? tl('\n— {0} : exécution de {1} (sans l’enregistrer) —\n', b.name, file.name) : tl('\n— {0} : fichiers envoyés, redémarrage (main.py) —\n', b.name));
      return true;
    }
    const token = {};
    fwJobs.set(b.id, token);
    rts.delete(b.id); clearScreens(b);
    rts.set(b.id, compilingStub(boardOf(b).logic, 'micropython'));
    log(b, tl('{0}— {1} : démarrage de MicroPython… —\n', (logs.get(b.id) || '').length ? '\n' : '', b.name));
    import('../emu/micropython.js').then(M => M.loadFirmware().then(img => [M, img])).then(([M, img]) => {
      if (fwJobs.get(b.id) !== token) return; // relancé ou arrêté entre-temps
      fwJobs.delete(b.id);
      let rt;
      try { rt = M.createMicroPythonRuntime(img, makeHw(b), { files, run, onError: e => pyError(b, e) }); } catch (e) { rts.delete(b.id); log(b, `\n✕ ${e.message}\n`); render(); return; }
      rts.set(b.id, attach(b, rt));
      uploaded.set(b.id, pySig(b));
      log(b, tl('— {0} démarre : MicroPython {1} sur processeur émulé —\n', b.name, M.FIRMWARE.version));
      render();
    }).catch(err => {
      if (fwJobs.get(b.id) !== token) return;
      fwJobs.delete(b.id); rts.delete(b.id);
      log(b, `\n✕ ${err.message || err}\n`);
      app.status(tl('{0} : MicroPython n’a pas pu démarrer : {1}', b.name, err.message || err), 'err');
      render();
    });
    return true;
  }
  /** Erreur Python (Traceback) : diagnostic à la ligne du fichier en cause, message dans la barre d'état. */
  function pyError(b, e) {
    pyDiag.set(b.id, [{ line: e.line, col: 1, msg: e.msg, file: e.file }]);
    app.status(tl('{0} : erreur Python, {1} ligne {2} : {3}', b.name, e.file, e.line, e.msg), 'err');
    if (b.id === cur) check();
  }
  /** Exécute le fichier affiché sans l'enregistrer sur la carte (les autres y sont envoyés, pour ses import). */
  function runPyFile() {
    const b = board(); if (!pyOf(b)) return;
    const name = pyFile(b), file = { name, code: pyFiles(b)[name] };
    if (!app.simOn()) { pyRunNext.set(b.id, file); app.setSim(true); return; }
    launchPython(b, file); render();
  }
  function startAll() {
    rts.clear();
    const sn = snapshot();
    let n = 0, bad = 0;
    for (const b of boards()) if (hasProgram(b, sn)) { n++; if (!launch(b, sn)) bad++; }
    render();
    return { n, bad };
  }
  function stopAll() {
    // Cartes microSD du mode fidèle : les dernières écritures du programme rejoignent les fichiers du projet.
    for (const c of comps()) if (c.type === 'sdcard' && syncCard(c, (P.mem || (P.mem = {}))[c.id] || (P.mem[c.id] = {}))) app.markDirty();
    fwJobs.clear(); pyRunNext.clear(); rts.clear(); comps().forEach(c => { c.progScreen = null; }); uploaded.clear(); pendingPause = null; liveUi(true); }
  function frame(dt) {
    for (const [id, rt] of rts) {
      const b = byId(id);
      if (!b) { rts.delete(id); continue; }
      const was = rt.state;
      rt.run(dt);
      const s = rt.takeSerial(); if (s) log(b, s);
      if (was === 'run' && rt.state === 'paused') onPaused(b, rt);
      if (was === 'run' && rt.state === 'error') {
        app.status(tl('{0} s’est arrêté, ligne {1} : {2}', b.name, rt.error.line, rt.error.msg), 'err');
        log(b, tl('\n✕ Arrêt, ligne {0} : {1}\n', rt.error.line, rt.error.msg));
        if (b.id === cur) { renderDiag(); if (editor) editor.goLine(rt.error.line); }
      }
    }
    const now = performance.now();
    if (now - lastUi > 120) { lastUi = now; liveUi(); }
  }
  /** Téléverse le programme de la carte affichée (et démarre la simulation au besoin). */
  function upload() {
    const b = board(); if (!b) return;
    ensure(b);
    if (!app.simOn()) { app.setSim(true); const r = rts.get(b.id); if (r) app.status(tl('Programme téléversé sur {0} : il s’exécute.', b.name), 'ok'); return; }
    if (launch(b)) app.status(tl('Programme téléversé sur {0} : il redémarre.', b.name), 'ok');
    render();
  }

  /* ---------- Interface ---------- */
  /** Moniteur série : le journal de la source choisie (carte simulée affichée, ou carte réelle). */
  function paintLog(b = board()) {
    if (!logDirty) return;
    logDirty = false;
    const out = $('#serialOut'), atEnd = out.scrollTop + out.clientHeight >= out.scrollHeight - 8;
    out.textContent = src === 'real' ? logs.get(REAL) || '' : (b && logs.get(b.id)) || '';
    if (atEnd) out.scrollTop = out.scrollHeight;
  }
  let paintQueued = false;
  /** Moniteur série affiché (il vit dans le panneau du bas, src/ui/shell.js : visible quand son onglet l'est). */
  const serialShown = () => { const sec = document.querySelector('.serialSec'); return !!sec && sec.offsetParent !== null; };
  const schedulePaint = () => { if (paintQueued) return; paintQueued = true; requestAnimationFrame(() => { paintQueued = false; if (serialShown()) paintLog(); if (plot && serialView === 'plot') plot.kick(); }); };
  function liveUi(force) {
    const b = board(), rt = b && rts.get(b.id);
    if ($('#progLive').hidden !== !rts.size) $('#progLive').hidden = !rts.size; // pastille d'onglet : pas d'écriture inutile
    if ($('#pane-prog').hidden && !serialShown() && !force) return;
    const st = $('#progState');
    let kind = 'off', text = app.simOn() ? tl('Pas de programme en cours') : tl('Simulation arrêtée');
    if (rt) {
      if (rt.state === 'compiling') { kind = 'pause'; text = rt.firmware === 'micropython' ? tl('Démarrage de MicroPython…') : tl('Compilation du vrai programme…'); }
      else if (rt.state === 'run' && rt.firmware === 'micropython') { kind = 'on'; text = rt.mpy && rt.mpy.busy ? tl('Envoi des fichiers à la carte…') : tl('En cours · MicroPython'); }
      else if (rt.state === 'run') { kind = 'on'; text = rt.line == null ? tl('En cours · programme compilé') : tl('En cours · ligne {0}', rt.line); }
      else if (rt.state === 'paused') { const at = rt.debug.at; kind = 'pause'; text = at.fn ? tl('En pause · ligne {0} · {1}()', at.line, at.fn) : tl('En pause · ligne {0}', at.line); }
      else if (rt.state === 'error') { kind = 'err'; text = tl('Arrêté par une erreur, ligne {0}', rt.error.line); }
      else { kind = 'off'; text = tl('Terminé'); }
    } else if (b && diag.get(b.id) && diag.get(b.id).errors.length && app.simOn()) { kind = 'err'; text = tl('Ne compile pas'); }
    if (b && boards().length < 2 && kind !== 'off') text = `${b.name} · ${text}`;
    st.dataset.kind = kind; st.querySelector('span:last-child').textContent = text; st.title = b ? `${b.name} (${boardOf(b).label})${COLON}${text}` : text;
    if (editor) editor.setRunLine(rt && rt.state === 'run' ? rt.line || 0 : rt && rt.state === 'error' ? rt.error.line : 0);
    const py = pyOf(b), changed = b && rt && uploaded.get(b.id) !== undefined && editor && (py ? pySig(b) : editor.value) !== uploaded.get(b.id);
    $('#progRun').classList.toggle('pulse', !!changed);
    $('#progRun').dataset.tip = py ? (changed ? tl('Les fichiers ont changé : envoyez-les à la carte · Ctrl+Entrée') : tl('Envoyer les fichiers à la carte et exécuter main.py · Ctrl+Entrée'))
      : changed ? tl('Le code a changé : téléversez-le · Ctrl+Entrée') : tl('Compiler et exécuter sur la carte · Ctrl+Entrée');
    if (py && $('#pyStop')) $('#pyStop').disabled = !rt || rt.state !== 'run';
    paintLog(b);
    if (rt) { const sig = rt.state + rt.warnings.size + [...rt.warnings.values()].reduce((a, w) => a + w.n, 0); if (sig !== warnSig) { warnSig = sig; renderDiag(); } }
    dbgUi(b, rt);
    visualHighlight(b, rt);
    if (plot && serialView === 'plot') plot.kick();
  }
  function renderDiag() {
    const b = board(), d = (b && diag.get(b.id)) || { errors: [], warnings: [] }, rt = b && rts.get(b.id);
    const items = [
      ...d.errors.map(e => ({ lv: 'err', line: e.line, col: e.col, len: e.len, msg: e.title || e.msg, code: e.code, help: e.help, tag: tl('Compilation'), file: e.file })),
      ...(rt && rt.state === 'error' ? [{ lv: 'err', line: rt.error.line, msg: rt.error.msg, tag: tl('Exécution') }] : []),
      ...d.warnings.map(w => ({ lv: 'warn', line: w.line, col: w.col, msg: w.msg, code: w.code, tag: tl('Bibliothèque') })),
      ...(rt ? [...rt.warnings.values()].map(w => ({ lv: 'warn', line: w.line, msg: w.msg + (w.n > 1 ? ` (×${w.n})` : ''), tag: tl('Exécution') })) : [])
    ];
    // Comme rustc : code stable, message, puis l'aide sur sa propre ligne.
    $('#diag').innerHTML = items.map(i => `<li class="${i.lv}" data-line="${i.line}" data-col="${i.col || 1}"${i.file ? ` data-file="${esc(i.file)}"` : ''} title="${tl('Aller à la ligne {0}', i.line)}"><i>${i.lv === 'err' ? '✕' : '!'}</i><b>${i.line ? (i.file ? `${esc(i.file)} · ` : '') + tl('Ligne ') + i.line : i.tag}</b><span>${i.code ? `<code class="jcode">${i.code}</code>` : ''}${esc(i.msg)}${i.help ? `<small>${tl('aide :')} ${esc(i.help)}</small>` : ''}</span></li>`).join('');
    // Carte sous MicroPython : seules les erreurs du fichier affiché sont marquées dans l'éditeur.
    const here = i => !i.file || (pyOf(b) && i.file === pyFile(b));
    if (editor) editor.setMarks({ errors: items.filter(i => i.lv === 'err' && here(i)), warnings: items.filter(i => i.lv === 'warn' && here(i)) });
  }
  function check() {
    const b = board(); if (!b || !editor) return;
    // MicroPython : la carte juge le programme ; ses erreurs (Traceback) arrivent quand il s'exécute.
    if (pyOf(b)) { hookLines = null; diag.set(b.id, { errors: pyDiag.get(b.id) || [], warnings: [] }); renderDiag(); editor.setBreakpoints([], null); return; }
    // Programme compilé : c'est arduino-cli qui le juge (erreurs affichées après la compilation).
    if (engineOf(b) === 'firmware') { hookLines = null; diag.set(b.id, fwDiag.get(b.id) || { errors: [], warnings: [] }); renderDiag(); applyBps(b); return; }
    // Compilé en mode débogage : on connaît aussi les lignes où un point d'arrêt peut arrêter le programme.
    const res = compile(editor.value, { ...ctxOf(b), debug: true });
    hookLines = res.ok ? res.debug.lines : null;
    diag.set(b.id, { errors: res.errors, warnings: res.warnings });
    renderDiag();
    applyBps(b);
  }
  function renderCodeMode() {
    const b = board(), e = b && entry(b), py = pyOf(b);
    const pm = b && !py ? progMode(b) : null;
    $('#pane-prog .codeSec h2').lastChild.textContent = py ? tl('Code MicroPython') : pm === 'rules' ? tl('Programme des règles') : pm === 'blocks' ? tl('Programme en blocs') : tl('Code Arduino');
    if (py) { $('#codeMode').textContent = tl('MicroPython · {0}', pyFile(b)); $('#codeMode').dataset.kind = 'python'; $('#codeGen').hidden = true; return; }
    const auto = !e || e.auto;
    const visual = !!e && e.mode === 'visual';
    $('#codeMode').textContent = visual ? tl('créé avec les blocs') : auto ? (rulesOf(b, snapshot()).length ? tl('généré par les règles') : tl('généré à partir du montage')) : tl('écrit à la main');
    $('#codeMode').dataset.kind = visual ? 'visual' : auto ? 'auto' : 'hand';
    $('#codeGen').hidden = true; // remplacé par le choix « Règles · Blocs · Code »
    $('#codeGen').querySelector('span').textContent = confirmGen > performance.now() ? tl('Confirmer : remplacer mon code') : tl('Régénérer');
  }
  function render() {
    const bs = boards(), b = board();
    $('#progEmpty').hidden = !!b; $('#progMain').hidden = !b;
    if (!b) { liveUi(true); return; }
    const sel = $('#progBoard');
    sel.hidden = bs.length < 2;
    sel.innerHTML = bs.map(x => `<option value="${esc(x.id)}"${x === b ? ' selected' : ''}>${esc(x.name)} · ${esc(boardOf(x).label)}</option>`).join('');
    // Langage du programme : le Pico se programme en C++ d'Arduino ou en MicroPython ; les autres cartes en C++ seulement.
    const eng = $('#progEngine'), kind = boardKind(b);
    if (eng) { eng.hidden = kind !== 'pico'; eng.value = pyOf(b) ? 'micropython' : 'cpp'; }
    qemuNote(b);
    renderRules();
    if (!editor) editor = createEditor($('#editor'), { onChange: onEdit, onRun: upload, onGutter: toggleBp });
    syncShown(b);
    editor.setLanguage(pyOf(b) ? 'python' : 'cpp');
    if (pyOf(b)) editor.value = pyFiles(b)[pyFile(b)]; // l'éditeur montre le fichier choisi ; ce qu'on tape y est déjà
    else {
      const sn = snapshot(), e = entry(b);
      const code = e || rulesOf(b, sn).length ? codeOf(b, sn) : generate(b, { comps: comps(), A: sn.A, inspect: sn.inspect, rules: [], states: P.states });
      if (document.activeElement !== editor.el || (e && (e.auto || e.mode === 'visual'))) editor.value = code;
    }
    renderCodeMode(); check(); logDirty = true;
    syncVisual(b); syncPython(b); liveUi(true);
  }

  /* ---------- MicroPython : fichiers, exécution, REPL ---------- */
  let serialPh = null;
  function pythonUi() {
    if ($('#pyBar')) return;
    $('#editor').insertAdjacentHTML('beforebegin', `<div class="pyBar" id="pyBar" hidden>
      <div class="pyFiles" id="pyFiles" role="tablist" aria-label="${tl('Fichiers de la carte')}"></div>
      <button type="button" class="tb" id="pyNew" data-tip="${tl('Nouveau fichier (module, lib/…)')}" aria-label="${tl('Nouveau fichier')}">${icon('filePlus')}</button>
      <button type="button" class="tb" id="pyRen" data-tip="${tl('Renommer le fichier')}" aria-label="${tl('Renommer le fichier')}">${icon('edit')}</button>
      <button type="button" class="tb" id="pyDel" data-tip="${tl('Supprimer le fichier')}" aria-label="${tl('Supprimer le fichier')}">${icon('trash')}</button>
      <span class="grow"></span>
      <button type="button" class="btn small" id="pyRunFile" data-tip="${tl('Exécuter ce fichier sans l’enregistrer sur la carte')}">${icon('play')}<span>${tl('Exécuter ce fichier')}</span></button>
      <button type="button" class="btn small" id="pyStop" data-tip="${tl('Interrompre le programme (Ctrl+C) : le REPL reprend la main')}">${icon('stop')}<span>${tl('Ctrl+C')}</span></button>
    </div>`);
    $('#pyFiles').onclick = e => { const t = e.target.closest('[data-file]'), b = board(); if (!t || !pyOf(b)) return; ensure(b).file = t.dataset.file; render(); };
    $('#pyNew').onclick = () => pyFileOp('new');
    $('#pyRen').onclick = () => pyFileOp('rename');
    $('#pyDel').onclick = () => pyFileOp('delete');
    $('#pyRunFile').onclick = runPyFile;
    $('#pyStop').onclick = () => { const b = board(), rt = b && rts.get(b.id); if (rt && rt.mpy) rt.mpy.interrupt(); };
  }
  /** Barre des fichiers, moniteur série en REPL : visibles pour une carte sous MicroPython. */
  function syncPython(b) {
    pythonUi();
    const py = pyOf(b), inp = $('#serialInput');
    if (serialPh == null) serialPh = inp.placeholder;
    $('#pyBar').hidden = !py; $('#dbgBar').hidden = py;
    inp.placeholder = py ? tl('Commande Python pour le REPL…') : serialPh;
    if (!py) return;
    const files = pyFiles(b), shown = pyFile(b);
    $('#pyFiles').innerHTML = Object.keys(files).sort((x, y) => (x === 'main.py' ? -1 : y === 'main.py' ? 1 : x.localeCompare(y)))
      .map(f => `<button type="button" role="tab" class="pyTab" data-file="${esc(f)}" aria-selected="${f === shown}">${esc(f)}</button>`).join('');
    $('#pyDel').disabled = Object.keys(files).length < 2;
  }
  /** Nouveau fichier, renommage, suppression (main.py est celui que la carte exécute au démarrage). */
  async function pyFileOp(kind) {
    const b = board(); if (!pyOf(b)) return;
    const e = ensure(b), files = pyFiles(b), shown = pyFile(b);
    if (kind === 'delete') {
      if (Object.keys(files).length < 2 || !(await askConfirm(tl('Supprimer le fichier'), tl('Supprimer {0} ? Il disparaît aussi de la carte au prochain envoi.', esc(shown)), tl('Supprimer'), true))) return;
      delete files[shown]; e.file = null;
    } else {
      const name = await ask(kind === 'new' ? tl('Nouveau fichier') : tl('Renommer le fichier'), tl('Nom du fichier (par exemple capteur.py ou lib/lcd.py)'), kind === 'new' ? 'module.py' : shown);
      if (!name) return; // annulé, ou champ vide
      const n = String(name).trim();
      if (!pyName(n)) { app.status(tl('Nom de fichier refusé : lettres, chiffres, « _ », « - », « . » et dossiers séparés par « / ».'), 'warn'); return; }
      if (n === shown) return;
      if (n in files) { app.status(tl('{0} existe déjà.', n), 'warn'); return; }
      if (kind === 'new') files[n] = '';
      else { files[n] = files[shown]; delete files[shown]; }
      e.file = n;
    }
    app.markDirty(); render();
  }

  /* ---------- Blocs de code (Blockly, chargé à la demande) ---------- */
  const isVisual = b => { const e = b && entry(b); return !!e && e.mode === 'visual' && !pyOf(b); }; // pas de blocs en Python
  function visCtx(b) { const sn = snapshot(); return visualContext(b, { comps: comps(), A: sn.A, inspect: sn.inspect }); }
  function visualUi() {
    if ($('#visualHost')) return;
    // Mode Règles : le programme qu'elles écrivent se lit en code ou en blocs (aperçu, regénéré à chaque règle).
    $('#codeMode').insertAdjacentHTML('beforebegin', `<div class="seg mini rulesView" id="rulesView" role="group" aria-label="${tl('Voir le programme des règles')}"><button type="button" class="segBtn" data-rv="code" aria-pressed="true">${icon('code')}<span>${tl('Code')}</span></button><button type="button" class="segBtn" data-rv="blocks" aria-pressed="false">${icon('puzzle')}<span>${tl('Blocs')}</span></button></div>`);
    $('#editor').insertAdjacentHTML('beforebegin', `<div class="visualHost previewHost" id="rulesBlocks" hidden></div>`);
    document.querySelectorAll('#rulesView [data-rv]').forEach(btn => { btn.onclick = () => { rulesView = btn.dataset.rv; try { localStorage.setItem('jollof-rules-view', rulesView); } catch (e) { /* stockage indisponible */ } const b = board(); if (b) syncVisual(b); }; });
    // Mode Blocs : barre d'outils au-dessus des blocs, code Arduino généré replié en dessous (à déplier pour le lire).
    $('#editor').insertAdjacentHTML('beforebegin', `<div class="visBar" id="visBanner" hidden>
      <button type="button" class="btn small" id="visFull" data-tip="${tl('Les blocs sur tout l’écran, le code à côté · Échap pour revenir')}">${icon('expand')}<span>${tl('Plein écran')}</span></button>
      <span class="grow"></span>
      <button type="button" class="btn small subtle" id="visFromRules" data-tip="${tl('Remplacer les blocs par ceux des règles et du montage')}">${icon('workflow')}<span>${tl('Repartir des règles')}</span></button>
      <button type="button" class="btn small subtle" id="visToCode" data-tip="${tl('Continuer en écrivant le code Arduino')}">${icon('code')}<span>${tl('Convertir en code')}</span></button></div>
      <div class="visualHost" id="visualHost" hidden></div>
      <button type="button" class="visCodeToggle" id="visCodeToggle" aria-expanded="false" hidden><span class="foldChev" aria-hidden="true"></span>${icon('code')}<span>${tl('Code Arduino généré par les blocs')}</span><small>${tl('lecture seule')}</small></button>`);
    $('#visFull').onclick = () => fullScreen(!full);
    $('#visCodeToggle').onclick = () => { showCode = !showCode; try { localStorage.setItem('jollof-vis-code', showCode ? '1' : '0'); } catch (e) { /* stockage indisponible */ } const b = board(); if (b) syncVisual(b); };
    $('#visToCode').onclick = () => setMode('code');
    $('#visFromRules').onclick = () => blocksFromRules(true);
    document.querySelectorAll('#progModes [data-mode]').forEach(btn => { btn.onclick = () => setMode(btn.dataset.mode); });
  }
  /** Façon de programmer la carte : règles (le code s'écrit tout seul), blocs, code écrit à la main, ou MicroPython. */
  const progMode = b => (pyOf(b) ? 'python' : isVisual(b) ? 'blocks' : !entry(b) || entry(b).auto ? 'rules' : 'code');
  const MODE_HINT = {
    rules: () => tl('Sans écrire de code : quand une mesure change, un composant réagit. Le programme Arduino s’écrit tout seul, en dessous.'),
    blocks: () => tl('Assemblez des blocs comme dans Scratch : le programme Arduino s’écrit en dessous.'),
    code: () => tl('Vous écrivez le programme Arduino (C++) : les règles ne le réécrivent plus.')
  };
  /** Interface selon le mode de la carte affichée : blocs (code en lecture seule, règles masquées) ou code. */
  function syncVisual(b) {
    visualUi();
    const on = isVisual(b), py = pyOf(b), mode = progMode(b);
    $('#progMain').dataset.mode = mode;
    $('#progModes').hidden = py;
    document.querySelectorAll('#progModes [data-mode]').forEach(btn => btn.setAttribute('aria-pressed', btn.dataset.mode === mode));
    $('#modeHint').textContent = MODE_HINT[mode] ? MODE_HINT[mode]() : '';
    $('#visualHost').hidden = !on; $('#visBanner').hidden = !on; $('#visCodeToggle').hidden = !on;
    const sec = $('#pane-prog .codeSec');
    sec.classList.toggle('blocksMode', on); sec.classList.toggle('showCode', on && showCode);
    $('#visCodeToggle').setAttribute('aria-expanded', on && showCode);
    if (!on && full) fullScreen(false);
    // Règles et états par défaut : ils n'écrivent le programme qu'en mode « Règles » (gardés dans les autres modes).
    document.querySelectorAll('#pane-prog .rulesSec, #pane-prog .statesSec').forEach(el => { el.hidden = mode !== 'rules'; });
    // Mode Règles, vue « Blocs » : l'éditeur de code laisse la place à l'aperçu en blocs.
    const preview = mode === 'rules' && rulesView === 'blocks';
    $('#rulesView').hidden = mode !== 'rules';
    document.querySelectorAll('#rulesView [data-rv]').forEach(btn => btn.setAttribute('aria-pressed', btn.dataset.rv === (mode === 'rules' ? rulesView : 'code')));
    $('#pane-prog .codeSec').classList.toggle('previewBlocks', preview);
    $('#rulesBlocks').hidden = !preview;
    if (preview) openPreview(b); else closePreview();
    const kept = mode === 'code' ? rulesOf(b, snapshot()).length : 0, note = $('#rulesKept');
    note.hidden = !kept;
    if (kept) note.querySelector('span').textContent = tl('{0} règle(s) conservée(s) : choisissez « Règles » pour qu’elles écrivent de nouveau le programme.', kept);
    if (editor) editor.readOnly(on || !!(rts.get(b.id) && rts.get(b.id).state === 'paused'));
    if (on) openWorkspace(b); else closeWorkspace();
  }
  async function openWorkspace(b) {
    if (vis && vis.boardId === b.id) { if (vis.h) vis.h.resize(); return; }
    closeWorkspace();
    const host = $('#visualHost'), token = {}; vis = { boardId: b.id, h: null, token, hi: null };
    host.innerHTML = `<p class="visLoading">${tl('Chargement des blocs…')}</p>`;
    try {
      const { openVisual } = await import('./visual/workspace.js');
      if (!vis || vis.token !== token) return; // carte changée pendant le chargement
      host.innerHTML = '';
      const e = ensure(b);
      const tidy = tidyNext.delete(b.id);
      const h = await openVisual(host, {
        json: e.blocks || emptyWorkspace(), ctx: visCtx(b), tidy,
        onChange: json => {
          e.blocks = json;
          const code = codeOf(b);
          if (board() === b && editor) { editor.value = code; check(); const m = visMeta.get(b.id); if (vis && vis.h) vis.h.warn(m ? m.warnings : []); }
          if (full) paintFullCode(code);
          app.markDirty(); renderCodeMode(); liveUi(true);
        }
      });
      if (!vis || vis.token !== token) { h.dispose(); return; }
      vis.h = h; const m = visMeta.get(b.id); h.warn(m ? m.warnings : []);
      // Les blocs demandent de la place : l'inspecteur s'élargit (bouton « Agrandir », réversible).
      if (!$('.app').classList.contains('wide') && !wideAuto) { wideAuto = true; $('#progWide').click(); setTimeout(() => vis && vis.h && vis.h.resize(), 260); }
    } catch (err) { console.error(err); host.innerHTML = `<p class="visLoading err">${tl('Les blocs n’ont pas pu se charger : {0}', esc(err.message || err))}</p>`; }
  }
  function closeWorkspace() { if (full) fullScreen(false); if (vis && vis.h) vis.h.dispose(); vis = null; const host = $('#visualHost'); if (host) host.innerHTML = ''; }
  /**
   * Plein écran : les blocs occupent le plan de travail et l'inspecteur, le code Arduino s'écrit à côté, en direct.
   * La barre d'application reste visible (Simuler, Enregistrer…). Échap revient.
   */
  function paintFullCode(code) { if (full) full.code.innerHTML = highlight(code).map(l => `<span class="cl">${l || ' '}</span>`).join('\n'); }
  function fullScreen(on) {
    const host = $('#visualHost');
    if (on && !full && host && !host.hidden) {
      const b = board(), wrap = document.createElement('div');
      wrap.className = 'visFull'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-label', tl('Programme en blocs'));
      wrap.innerHTML = `<header class="visFullHead">${icon('puzzle')}<b>${tl('Programme en blocs')}</b><small>${esc(b ? b.name : '')}</small><span class="grow"></span>
        <button type="button" class="btn small" data-f="code" aria-pressed="true">${icon('code')}<span>${tl('Code Arduino')}</span></button>
        <button type="button" class="btn small primary" data-f="exit">${icon('shrink')}<span>${tl('Quitter le plein écran')}</span><kbd>Esc</kbd></button></header>
        <div class="visFullBody"><div class="visFullBlocks"></div><pre class="visFullCode" aria-label="${tl('Code Arduino généré par les blocs')}"></pre></div>`;
      document.body.appendChild(wrap);
      const mark = document.createComment('blocs'); host.before(mark);
      wrap.querySelector('.visFullBlocks').appendChild(host);
      full = { wrap, mark, host, code: wrap.querySelector('.visFullCode') };
      full.key = e => { if (e.key === 'Escape' && !document.querySelector('.blocklyDropDownDiv[style*="display: block"], .blocklyWidgetDiv[style*="display: block"]')) { e.preventDefault(); fullScreen(false); } };
      addEventListener('keydown', full.key);
      wrap.querySelector('[data-f="exit"]').onclick = () => fullScreen(false);
      wrap.querySelector('[data-f="code"]').onclick = e => { const btn = e.currentTarget, show = btn.getAttribute('aria-pressed') !== 'true'; btn.setAttribute('aria-pressed', show); wrap.classList.toggle('noCode', !show); requestAnimationFrame(() => vis && vis.h && vis.h.resize()); };
      paintFullCode(editor ? editor.value : '');
      $('#visFull').setAttribute('aria-pressed', 'true');
      requestAnimationFrame(() => vis && vis.h && vis.h.resize());
    } else if (!on && full) {
      const f = full; full = null;
      removeEventListener('keydown', f.key);
      f.mark.replaceWith(f.host); f.wrap.remove();
      const btn = $('#visFull'); if (btn) btn.setAttribute('aria-pressed', 'false');
      requestAnimationFrame(() => vis && vis.h && vis.h.resize());
    }
  }
  const cxOf = (b, sn = snapshot()) => ({ comps: comps(), A: sn.A, inspect: sn.inspect, rules: P.rules, states: P.states });
  /** Aperçu en blocs du programme des règles (lecture seule) ; refait seulement si les blocs ont changé. */
  async function openPreview(b) {
    const json = rulesToBlocks(b, cxOf(b)).workspace, sig = JSON.stringify(json, (k, v) => (k === 'id' ? undefined : v));
    if (prev && prev.boardId === b.id) { if (prev.h && prev.sig !== sig) { prev.sig = sig; prev.h.replace(json); } return; }
    closePreview();
    const host = $('#rulesBlocks'), token = {}; prev = { boardId: b.id, h: null, token, sig };
    host.innerHTML = `<p class="visLoading">${tl('Chargement des blocs…')}</p>`;
    try {
      const { openVisual } = await import('./visual/workspace.js');
      if (!prev || prev.token !== token) return;
      host.innerHTML = '';
      const h = await openVisual(host, { json, ctx: visCtx(b), readOnly: true, tidy: true });
      if (!prev || prev.token !== token) { h.dispose(); return; }
      prev.h = h;
    } catch (err) { console.error(err); host.innerHTML = `<p class="visLoading err">${tl('Les blocs n’ont pas pu se charger : {0}', esc(err.message || err))}</p>`; }
  }
  function closePreview() { if (prev && prev.h) prev.h.dispose(); prev = null; const host = $('#rulesBlocks'); if (host) host.innerHTML = ''; }
  /** Choix entre deux départs (ou rien) : rend la valeur du bouton, null si l'élève annule. */
  const choose = (title, text, other, main) => dialog({ title, body: `<p class="dlgText">${text}</p>`, width: 460,
    actions: [{ label: CANCEL, value: null }, { label: other[0], value: other[1] }, { label: main[0], value: main[1], kind: 'primary' }] });
  /** Blocs reconstruits à partir des règles, des états par défaut et du montage (le même programme). */
  async function blocksFromRules(ask) {
    const b = board(); if (!b) return;
    const e = ensure(b);
    if (ask && hasBlocks(e.blocks) && !(await askConfirm(tl('Repartir des règles'), tl('Les blocs de {0} seront remplacés par ceux de ses règles et de son montage.', esc(b.name)), tl('Remplacer mes blocs')))) return;
    const r = rulesToBlocks(b, cxOf(b));
    e.blocks = r.workspace; tidyNext.add(b.id); closeWorkspace();
    app.markDirty(); render();
    const what = r.stats.rules ? tl('{0} règle(s) converties en blocs', r.stats.rules) : tl('Programme du montage converti en blocs');
    app.status(`${what}${r.skipped.length ? ' ' + tl('(sans équivalent : {0})', r.skipped.join(', ')) : ''}. ${tl('Le programme fait la même chose.')}`, r.skipped.length ? 'warn' : 'ok');
  }
  async function toBlocks() {
    const b = board(); if (!b || isVisual(b)) return;
    const e = ensure(b), keep = hasBlocks(e.blocks), hand = !e.auto && e.code.trim();
    if (keep) {
      if (hand && !(await askConfirm(tl('Programmer avec des blocs'), tl('Le code de {0} sera remplacé par vos blocs. Il reste récupérable en revenant au code plus tard (« Convertir en code »).', esc(b.name)), tl('Passer aux blocs')))) return;
      e.codeBefore = e.code; e.mode = 'visual'; e.auto = false; delete e.bps;
      app.markDirty(); render(); app.status(tl('Vos blocs sont repris. « Repartir des règles » les recrée à partir de vos règles actuelles.'), 'ok'); return;
    }
    // Premier passage aux blocs : partir des règles (converties) ou de blocs vides.
    const n = rulesOf(b, snapshot()).length;
    const how = await choose(tl('Programmer avec des blocs'),
      (n ? tl('Partir de vos {0} règle(s), converties en blocs (le programme reste le même), ou de blocs vides ?', n) : tl('Partir du programme du montage, converti en blocs, ou de blocs vides ?')) + (hand ? ' ' + tl('Le code écrit à la main ne se convertit pas en blocs.') : ''),
      [tl('Blocs vides'), 'empty'], [n ? tl('Partir des règles') : tl('Partir du montage'), 'rules']);
    if (!how) return;
    e.codeBefore = e.code; e.mode = 'visual'; e.auto = false; delete e.bps;
    if (how === 'rules') { await blocksFromRules(false); return; }
    e.blocks = emptyWorkspace(); closeWorkspace(); app.markDirty(); render();
    app.status(tl('Blocs vides : glissez des blocs depuis les catégories de gauche dans « au démarrage » ou « en boucle ». Le code Arduino s’écrit en dessous.'), 'ok');
  }
  async function toCode() {
    const b = board(); if (!b || !isVisual(b)) return;
    const how = await choose(tl('Écrire le code soi-même'), tl('Convertir vos blocs en code Arduino, ou partir d’un programme vide où vos composants sont déjà déclarés ? Vos blocs restent enregistrés : vous pourrez y revenir.'),
      [tl('Programme vide'), 'blank'], [tl('Convertir mes blocs'), 'convert']);
    if (!how) return;
    const e = ensure(b); e.code = how === 'blank' ? skeleton(b, cxOf(b)) : codeOf(b); delete e.mode; e.auto = false; delete e.bps;
    closeWorkspace(); app.markDirty(); render();
    app.status(how === 'blank' ? tl('Programme vide : vos composants sont déclarés, à vous d’écrire loop().') : tl('Vos blocs sont devenus du code Arduino, modifiable.'), 'ok');
  }
  /** Change la façon de programmer la carte affichée ; ce qui serait perdu est d'abord confirmé. */
  async function setMode(m) {
    const b = board(); if (!b || pyOf(b)) return;
    const cur = progMode(b), e = ensure(b);
    if (m === cur) return;
    if (m === 'blocks') return toBlocks();
    if (m === 'code') {
      if (cur === 'blocks') return toCode();
      const n = rulesOf(b, snapshot()).length;
      const how = await choose(tl('Écrire le code soi-même'), n
        ? tl('Partir du code écrit par vos {0} règle(s), ou d’un programme vide où vos composants sont déjà déclarés ? Les règles restent enregistrées.', n)
        : tl('Partir du programme du montage, ou d’un programme vide où vos composants sont déjà déclarés ?'),
        [tl('Programme vide'), 'blank'], [n ? tl('Partir du code des règles') : tl('Partir du montage'), 'rules']);
      if (!how) return;
      e.code = how === 'blank' ? skeleton(b, cxOf(b)) : codeOf(b); e.auto = false; delete e.bps; app.markDirty(); render();
      app.status(how === 'blank' ? tl('Programme vide : vos composants sont déclarés, à vous d’écrire loop().') : tl('Le code est à vous : modifiez-le librement. Les règles sont conservées (« Règles » les remet aux commandes).'), 'ok');
      editor && editor.el && editor.el.focus();
      return;
    }
    // Retour aux règles : le programme est de nouveau écrit par les règles.
    const generated = generate(b, cxOf(b));
    if (cur === 'blocks' && !(await askConfirm(tl('Revenir aux règles'), tl('Le programme de {0} sera de nouveau écrit par ses règles. Vos blocs restent enregistrés : vous pourrez y revenir.', esc(b.name)), tl('Revenir aux règles')))) return;
    if (cur === 'code' && e.code.trim() && e.code !== generated && !(await askConfirm(tl('Revenir aux règles'), tl('Le code écrit à la main sera remplacé par celui des règles.'), tl('Remplacer mon code')))) return;
    if (cur === 'blocks') closeWorkspace();
    delete e.mode; e.auto = true; if (editor) editor.value = codeOf(b); app.markDirty(); render(); check();
    app.status(tl('Le programme est de nouveau écrit par les règles.'), 'ok');
  }
  /** Bloc en cours d'exécution, d'après la ligne du programme. */
  function visualHighlight(b, rt) {
    if (!vis || !vis.h || vis.boardId !== (b && b.id)) return;
    const m = visMeta.get(b.id), running = rt && (rt.state === 'run' || rt.state === 'paused');
    const id = running ? (m && m.map.get(rt.line)) || vis.hi : null;
    if (id !== vis.hi) { vis.hi = id || null; vis.h.highlight(vis.hi); }
  }
  function onEdit(text) {
    const b = board(); if (!b) return;
    const e = ensure(b);
    if (pyOf(b)) { const f = pyFile(b); if (e.files[f] !== text) { e.files[f] = text; app.markDirty(); } return; }
    if (e.mode === 'visual') return; // code en lecture seule : il vient des blocs
    if (e.auto && text !== e.code) { e.auto = false; app.status(tl('Code modifié à la main : les règles ne le réécrivent plus (« Règles » les remet aux commandes).')); syncVisual(b); }
    shiftBps(b, e.code, text);
    e.code = text;
    app.markDirty(); renderCodeMode();
    clearTimeout(checkT); checkT = setTimeout(check, 350);
  }

  /* ---------- Règles : un arbre de conditions et d'actions ---------- */
  // Une règle reste une ligne : « Quand [mesure] [compare] [valeur] ». Les options (« dès que », « depuis », marge,
  // comparer à une autre mesure) sont derrière le petit bouton « ⋯ » ; « + et / ou » ajoute une condition. Les variables
  // et les séquences sont des cartes à part, au même niveau que les règles.
  const decl = id => P.rules.find(r => (r.kind === 'var' || r.kind === 'seq') && r.id === id) || null;
  /** Composants, variables et séquences : ce que les phrases des règles nomment. */
  const byAny = id => byId(id) || decl(id);
  const varsAll = () => P.rules.filter(r => r.kind === 'var'), seqsAll = () => P.rules.filter(r => r.kind === 'seq');
  const openAdv = new Set(); // conditions dont les options sont dépliées (règle:condition)
  const modeOf = (r, hasSrc) => (r.src && r.op === 'follow' ? 'follow' : r.src || hasSrc ? 'cond' : 'always');
  /** Chaque action redevient cohérente avec sa place (« suit la mesure » n'existe que sous « fait varier »). */
  function fixTree(r, hasSrc = false) {
    const inner = hasSrc || !!r.src;
    for (const b of ['then', 'else']) for (const it of r[b] || []) {
      if (it.kind === 'rule') { fixTree(it, inner); continue; }
      if (it.kind !== 'act' || it.comp === SERIAL || it.comp === NET) continue;
      const d = byId(it.comp); if (!d || !ACTIONS[d.type]) continue;
      const ok = actsFor(d.type, b === 'then' ? modeOf(r, hasSrc) : 'cond').map(([k]) => k);
      if (!ok.includes(it.act)) { it.act = ok[0] || null; it.arg = defArg(d.type, it.act); }
      if (ACTIONS[d.type][it.act] && ACTIONS[d.type][it.act].follow && !Array.isArray(it.arg) && !ACTIONS[d.type][it.act].arg) it.arg = defArg(d.type, it.act);
    }
  }
  function argHtml(A, val, f) {
    if (!A || !A.arg || (A.follow && A.arg.kind !== 'color')) return '';
    const a = A.arg;
    if (a.kind === 'color') return `<input type="color" data-${f.startsWith('s:') ? 'sf' : 'f'}="${f.replace('s:', '')}" value="${esc(val || a.def)}" aria-label="${tl('Couleur')}">`;
    const attr = f.startsWith('s:') ? `data-sf="${f.slice(2)}"` : `data-f="${f}"`;
    if (a.kind === 'text') return `<input type="text" ${attr} value="${esc(val ?? a.def)}" maxlength="${a.max || 21}" aria-label="${tl('Texte affiché')}">`;
    return `<span class="num"><input type="number" ${attr} value="${esc(val ?? a.def)}" min="${a.min}" max="${a.max}" step="${a.step || 1}" aria-label="${tl('Réglage')}">${a.unit ? `<small>${esc(a.unit)}</small>` : ''}</span>`;
  }
  /* --- Sources : mesures, ligne reçue, variables, étapes, temps --- */
  const srcKey = s => (!s ? '' : s.every ? 't:every' : s.start ? 't:start' : s.var ? `v:${s.var}` : s.seq ? `q:${s.seq}:${s.step || ''}` : s.comp === SERIAL ? `s:${s.sig || 'line'}`
    : s.comp === NET ? `n:${s.sig}:${s.topic || ''}` : `c:${s.comp}:${s.sig}`);
  function srcDecode(v, old) {
    if (!v) return null;
    if (v.startsWith('n:')) { // réseau : n:msg:sujet (le sujet peut contenir « : »)
      const [, sig, ...rest] = v.split(':'), topic = rest.join(':') || (old && old.comp === NET && old.topic) || TOPIC_SUB;
      return NET_SIG[sig] && NET_SIG[sig].topic ? { comp: NET, sig, topic } : { comp: NET, sig };
    }
    const [k, a, b] = v.split(':');
    if (k === 't') return a === 'every' ? { every: (old && old.every) || 1000 } : { start: true };
    if (k === 'v') return { var: a };
    if (k === 'q') return { seq: a, step: b || null };
    if (k === 's') return { comp: SERIAL, sig: a };
    return { comp: a, sig: b };
  }
  /** Liste des sources : { always: « Toujours », timed: minuteries et démarrage, values: seulement ce qui a une valeur }. */
  function srcSelect(cur, f, { always = false, timed = true, values = false, none = null, kinds = null } = {}) {
    const key = srcKey(cur), opt = (v, l) => `<option value="${esc(v)}"${v === key ? ' selected' : ''}>${esc(l)}</option>`;
    const okKind = sig => !kinds || kinds.includes(sig.kind);
    let html = always ? opt('', tl('Toujours (à chaque tour de loop)')) : none ? opt('', none) : '';
    if (timed && !values) html += `<optgroup label="${tl('Temps')}">${opt('t:every', tl('Toutes les…'))}${opt('t:start', tl('Au démarrage'))}</optgroup>`;
    html += comps().filter(isSensor).map(c => {
      const sigs = Object.entries(SIGNALS[c.type]).filter(([k, g]) => (!values || k !== 'fault') && okKind(signalOf(c.type, k, null) || g));
      return sigs.length ? `<optgroup label="${esc(c.name)}">${sigs.map(([k, g]) => opt(`c:${c.id}:${k}`, `${c.name} · ${g.kind === 'bool' ? (g.short || g.label).toLowerCase() : g.label}`)).join('')}</optgroup>` : '';
    }).join('');
    if (!kinds || kinds.includes('text')) html += `<optgroup label="${tl('Moniteur série')}">${opt('s:line', values ? tl('la ligne reçue') : tl('reçoit une ligne'))}</optgroup>`;
    html += netOptions(cur, key, opt, okKind, values);
    const vs = varsAll().filter(d => okKind(varSignal(d)));
    if (vs.length) html += `<optgroup label="${tl('Variables')}">${vs.map(d => opt(`v:${d.id}`, d.name)).join('')}</optgroup>`;
    if (!values) for (const q of seqsAll()) if (q.steps.length) html += `<optgroup label="${esc(tl('Séquence {0}', q.name))}">${q.steps.map(s => opt(`q:${q.id}:${s.id}`, tl('étape {0} active', s.name))).join('')}</optgroup>`;
    return `<select data-f="${f}" aria-label="${tl('Mesure')}">${html}</select>`;
  }
  const sigOfSrc = (src, prof) => srcSignal(src, byAny, prof);
  /* --- Réseau (rules-net.js) : module Ethernet relié ou carte Wi-Fi ; réglages ; sujets MQTT --- */
  let netNow; // lien réseau de la carte affichée, calculé à chaque rendu des règles (l'analyse du montage coûte)
  const netOf = (b, sn) => (b === undefined && netNow !== undefined ? netNow : netLink(b || board(), comps(), (sn || snapshot()).inspect));
  /** Sujets déjà suivis par les règles (messages, nombres reçus), pour choisir une valeur reçue. */
  const netTopics = () => { const out = new Set(); P.rules.forEach(r => walkTerms(r, t => { if (t.src && t.src.comp === NET && t.src.topic) out.add(t.src.topic); })); return [...out]; };
  function walkTerms(r, fn) {
    if (r.kind === 'rule') { termsOf(r).forEach(fn); for (const b of ['then', 'else']) (r[b] || []).forEach(it => { if (it.kind === 'rule') walkTerms(it, fn); }); }
    if (r.kind === 'seq') for (const st of r.steps || []) { (st.go || []).forEach(g => { if (g.when) fn(g.when); }); st.do.forEach(it => { if (it.kind === 'rule') walkTerms(it, fn); }); }
  }
  /** Options « Réseau » d'une liste de sources ; values : valeurs reçues (avec leur sujet) au lieu des événements. */
  function netOptions(cur, key, opt, okKind, values) {
    const here = key.startsWith('n:'); if (!here && !netOf()) return '';
    const curTopic = cur && cur.comp === NET && cur.topic, list = [];
    const add = (sig, label, topic) => { if (okKind(NET_SIG[sig])) list.push(opt(`n:${sig}:${topic || ''}`, label)); };
    if (values) {
      for (const t of [...new Set([...netTopics(), ...(curTopic ? [curTopic] : [])])]) { add('msg', tl('message du sujet {0}', t), t); add('num', tl('nombre reçu sur {0}', t), t); }
      add('page', tl('page web demandée'));
    } else {
      add('msg', tl('message reçu sur un sujet…'), cur && cur.sig === 'msg' ? curTopic : '');
      add('num', tl('nombre reçu sur un sujet…'), cur && cur.sig === 'num' ? curTopic : '');
      add('page', tl('demande de la page web'));
    }
    add('online', tl('connexion au réseau')); add('mqtt', tl('connexion au serveur MQTT'));
    return list.length ? `<optgroup label="${tl('Réseau')}">${list.join('')}</optgroup>` : '';
  }
  /** Réglages du réseau de la carte : créés (valeurs par défaut) la première fois qu'une règle se sert du réseau. */
  function ensureNet(b = board()) {
    if (netItem(P.rules, b)) return;
    const n = fixNet({ kind: 'net', id: uid('n') });
    if (b && boards().length > 1) n.board = b.id;
    P.rules.unshift(n);
  }
  const topicInput = (val, pub) => `<span class="rl-topic">${tl('sur le sujet')}<input type="text" data-f="topic" value="${esc(val || (pub ? TOPIC_PUB : TOPIC_SUB))}" maxlength="48" spellcheck="false" aria-label="${tl('Sujet MQTT')}"></span>`;
  function netCard(n, cx) {
    const b = board(), L = netOf(b, cx.sn), used = P.rules.some(r => r !== n && JSON.stringify(r).includes(`"${NET}"`));
    const eth = !L || L.via === 'eth', wifi = !L || L.via === 'wifi';
    return `<li class="rule rl-net" data-rid="${esc(n.id)}"><div class="rh"><span class="rn rl-badge">⇄</span><p>${esc(netText(n, L && L.via))}</p><button type="button" class="tb danger" data-del="rule" aria-label="${tl('Supprimer les réglages du réseau')}" data-tip="${tl('Les valeurs par défaut s’appliquent')}">${icon('trash')}</button></div>
      ${eth ? `<div class="rrow"><em>${tl('Câble')}</em><select data-f="dhcp" aria-label="${tl('Adresse')}"><option value="1"${n.dhcp ? ' selected' : ''}>${tl('adresse donnée par la box (DHCP)')}</option><option value="0"${n.dhcp ? '' : ' selected'}>${tl('adresse fixe')}</option></select>${n.dhcp ? '' : `<input type="text" data-f="ip" value="${esc(n.ip)}" maxlength="15" spellcheck="false" aria-label="${tl('Adresse IP')}">`}<label class="rl-chk">MAC <input type="text" data-f="mac" value="${esc(n.mac)}" placeholder="${esc(autoMac(b))}" maxlength="17" spellcheck="false" aria-label="${tl('Adresse MAC')}"></label></div>` : ''}
      ${wifi ? `<div class="rrow"><em>Wi-Fi</em><input type="text" data-f="ssid" value="${esc(n.ssid)}" maxlength="32" spellcheck="false" aria-label="${tl('Nom du réseau Wi-Fi')}"><input type="text" data-f="pass" value="${esc(n.pass)}" maxlength="63" spellcheck="false" aria-label="${tl('Mot de passe du Wi-Fi')}"></div>` : ''}
      <div class="rrow"><em>MQTT</em><input type="text" data-f="broker" value="${esc(n.broker)}" maxlength="63" spellcheck="false" aria-label="${tl('Serveur MQTT (adresse ou nom)')}"><span class="num">${tl('port')}<input type="number" data-f="port" min="1" max="65535" value="${n.port}" aria-label="${tl('Port')}"></span></div>
      ${!L && b ? `<p class="rwarn">${tl('⚠ {0} n’a ni module Ethernet relié (W5500, ENC28J60) ni Wi-Fi : les règles du réseau sont ignorées.', esc(b.name))}</p>` : !used ? `<p class="rl-hint">${tl('Les règles choisissent « Réseau » comme effecteur (publier, page web) ou comme mesure (message reçu, demande de page).')}</p>` : ''}</li>`;
  }
  /** Une condition : source, comparaison, valeur ; options dépliables (⋯). first : première condition d'une règle de premier niveau. */
  function termHtml(t, prof, { first = false, top = false, key = '' } = {}) {
    const src = t.src, sig = src && !src.every && !src.start && !src.seq ? sigOfSrc(src, prof) : null;
    let html = srcSelect(src, 'src', { always: first });
    if (src && src.comp === NET && NET_SIG[src.sig] && NET_SIG[src.sig].topic) html += topicInput(src.topic, false);
    if (src && src.every) html += `<span class="num"><input type="number" step="any" min="0.01" data-f="every" value="${(src.every || 1000) / 1000}" aria-label="${tl('Période')}"><small>s</small></span>`;
    else if (sig && sig.kind === 'bool') html += `<select data-f="v" aria-label="${tl('État')}"><option value="1"${t.v ? ' selected' : ''}>${esc(src.var ? tl('est vraie') : sig.label)}</option><option value="0"${t.v ? '' : ' selected'}>${esc(src.var ? tl('est fausse') : sig.neg)}</option></select>`;
    else if (sig && sig.kind === 'text') {
      const ops = Object.entries(TEXT_OPS).filter(([k]) => k !== 'any' || sig.event);
      html += `<select data-f="op" aria-label="${tl('Comparaison')}">${ops.map(([k, l]) => `<option value="${k}"${t.op === k ? ' selected' : ''}>${esc(sig.event && k === '==' ? tl('reçoit') : l)}</option>`).join('')}</select>`;
      if (t.op !== 'any') html += t.vs ? srcSelect(t.vs, 'vs', { values: true, kinds: ['text'] }) : `<input type="text" data-f="v" value="${esc(t.v ?? '')}" maxlength="32" aria-label="${tl('Texte')}">`;
    } else if (sig) {
      const ops = Object.entries(OPS).filter(([k]) => (k !== 'follow' || (first && top && !(t.more && t.more.length))) && (!sig.event || k === '=='));
      if (sig.event) ops.unshift(['any', tl('reçoit n’importe quoi')]);
      html += `<select data-f="op" aria-label="${tl('Comparaison')}">${ops.map(([k, l]) => `<option value="${k}"${t.op === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      if (t.op === 'follow') html += `<span class="range">de <input type="number" step="any" data-f="from0" value="${t.from[0]}" aria-label="${tl('Mesure minimale')}"> ${tl('à')} <input type="number" step="any" data-f="from1" value="${t.from[1]}" aria-label="${tl('Mesure maximale')}">${sig.unit ? `<small>${esc(sig.unit)}</small>` : ''}</span>`;
      else if (t.op !== 'any') html += t.vs ? srcSelect(t.vs, 'vs', { values: true, kinds: ['num', 'time'] })
        : sig.kind === 'time' ? `<input type="time" data-f="v" value="${fmtTime(t.v)}" aria-label="${tl('Heure')}">`
          : `<span class="num"><input type="number" step="any" data-f="v" value="${esc(t.v)}" aria-label="${tl('Seuil')}">${sig.unit ? `<small>${esc(sig.unit)}</small>` : ''}</span>`;
    }
    // Options : une fois (front), depuis (durée), marge (hystérésis), comparer à une autre mesure.
    const can = src && !src.every && !src.start && t.op !== 'follow', open = openAdv.has(key) || !!(t.edge || t.hold || t.hyst || t.vs);
    if (can) {
      html += `<button type="button" class="tb mini rl-more" data-adv="${esc(key)}" aria-expanded="${open}" aria-label="${tl('Options de la condition')}" data-tip="${tl('Options : dès que, depuis, marge, comparer à une autre mesure')}">⋯</button>`;
      if (open) {
        const num = sig && sig.kind === 'num';
        html += `<span class="rl-adv">${!(sig && sig.event) ? `<label><input type="checkbox" data-f="edge"${t.edge ? ' checked' : ''}>${tl('dès que (une seule fois)')}</label>` : ''}`
          + `<label>${tl('depuis')} <input type="number" step="any" min="0" data-f="hold" value="${t.hold ? t.hold / 1000 : ''}" placeholder="0" aria-label="${tl('Durée')}"><small>s</small></label>`
          + (num && /[<>]/.test(t.op || '') && !t.vs ? `<label>${tl('marge')} <input type="number" step="any" min="0" data-f="hyst" value="${t.hyst || ''}" placeholder="0" aria-label="${tl('Hystérésis')}">${sig.unit ? `<small>${esc(sig.unit)}</small>` : ''}</label>` : '')
          + (sig && (sig.kind === 'num' || sig.kind === 'text') && !sig.event && t.op !== 'any' ? `<label><input type="checkbox" data-f="cmpsrc"${t.vs ? ' checked' : ''}>${tl('comparer à une autre valeur')}</label>` : '')
          + '</span>';
      }
    }
    return html;
  }
  const LINKS = { and: tl('et'), or: tl('ou'), andnot: tl('sauf si'), ornot: tl('ou si pas') };
  function condHtml(r, prof, top) {
    let html = `<div class="rrow" data-t=""><em>${tl('Quand')}</em>${termHtml(r, prof, { first: true, top, key: `${r.id}:` })}</div>`;
    (r.src ? r.more || [] : []).forEach((t, i) => {
      const link = (t.link === 'or' ? 'or' : 'and') + (t.not ? 'not' : '');
      html += `<div class="rrow rl-term" data-t="${i}"><select data-f="link" class="rl-link" aria-label="${tl('Lien')}">${Object.entries(LINKS).map(([k, l]) => `<option value="${k}"${k === link ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${termHtml(t, prof, { key: `${r.id}:${i}` })}<button type="button" class="tb mini" data-del="term" aria-label="${tl('Retirer cette condition')}">${icon('x')}</button></div>`;
    });
    if (r.src && r.op !== 'follow') html += `<div class="rl-addterm"><button type="button" class="add" data-add="term">${icon('plus')}${tl('et / ou…')}</button></div>`;
    return html;
  }
  /* --- Éléments : action, variable, attente, étape --- */
  const SCREEN_ROWS = { lcd1602: 2, lcd2004: 4, oled: 8, st7735: 8, ili9341: 15 };
  function actRow(it, mode) {
    const ser = it.comp === SERIAL, net = it.comp === NET, d = ser || net ? null : byId(it.comp);
    let html = `<select data-f="comp" aria-label="${tl('Effecteur')}"><option value="">${tl('— choisir —')}</option>${comps().filter(isActuator).map(c => `<option value="${esc(c.id)}"${d === c ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="${SERIAL}"${ser ? ' selected' : ''}>${tl('Moniteur série')}</option>${net || netOf() ? `<option value="${NET}"${net ? ' selected' : ''}>${tl('Réseau')}</option>` : ''}</select>`;
    if (net) {
      // Réseau : publier (valeur choisie ou texte) sur un sujet MQTT, une ligne de la page web.
      const A = NET_ACTS[it.act] || NET_ACTS.publish;
      html += `<select data-f="act" aria-label="${tl('Action')}">${Object.entries(NET_ACTS).map(([k, a]) => `<option value="${k}"${it.act === k ? ' selected' : ''}>${esc(a.label)}</option>`).join('')}</select>`;
      html += srcSelect(it.what, 'what', { values: true, none: tl('le texte :') });
      if (!it.what) html += `<input type="text" data-f="arg" value="${esc(it.arg ?? A.arg.def)}" maxlength="64" aria-label="${tl('Texte')}">`;
      if (it.act === 'page') html += `<select data-f="line" aria-label="${tl('Ligne')}"><option value="">${tl('ligne auto')}</option>${Array.from({ length: PAGE_ROWS }, (_, i) => `<option value="${i + 1}"${+it.line === i + 1 ? ' selected' : ''}>${tl('ligne {0}', i + 1)}</option>`).join('')}</select>`;
      else html += topicInput(it.topic, true);
      return `<div class="act" data-aid="${esc(it.id)}">${html}<button type="button" class="tb mini" data-del="act" aria-label="${tl('Retirer cette action')}">${icon('x')}</button></div>`;
    }
    const acts = ser ? Object.entries(SERIAL_ACTS) : d ? actsFor(d.type, mode === 'cond' ? 'any' : mode) : null;
    if (acts) {
      const A = ser ? SERIAL_ACTS[it.act] : ACTIONS[d.type][it.act];
      html += `<select data-f="act" aria-label="${tl('Action')}">${acts.map(([k, a]) => `<option value="${k}"${it.act === k ? ' selected' : ''}>${esc(a.label)}</option>`).join('')}</select>${argHtml(A, it.arg, 'arg')}`;
      if (A && A.follow && Array.isArray(it.arg)) html += `<span class="range">de <input type="number" step="any" data-f="out0" value="${it.arg[0]}" aria-label="${tl('Sortie minimale')}"> ${tl('à')} <input type="number" step="any" data-f="out1" value="${it.arg[1]}" aria-label="${tl('Sortie maximale')}"></span>`;
      if (A && (SHOWS.has(it.act) || A.what) && mode !== 'follow') html += srcSelect(it.what, 'what', { values: true, none: ser || A.what ? tl('— valeur —') : tl('la mesure de la règle') });
      const rows = d && SCREEN_ROWS[d.type];
      if (rows && it.act !== 'clear') html += `<select data-f="line" aria-label="${tl('Ligne')}"><option value="">${tl('ligne auto')}</option>${Array.from({ length: rows }, (_, i) => `<option value="${i + 1}"${+it.line === i + 1 ? ' selected' : ''}>${tl('ligne {0}', i + 1)}</option>`).join('')}</select>`;
    }
    return `<div class="act" data-aid="${esc(it.id)}">${html}<button type="button" class="tb mini" data-del="act" aria-label="${tl('Retirer cette action')}">${icon('x')}</button></div>`;
  }
  function setRow(it) {
    const d = decl(it.var);
    let html = `<em class="rl-k">${tl('variable')}</em><select data-f="var" aria-label="${tl('Variable')}"><option value="">${tl('— choisir —')}</option>${varsAll().map(v => `<option value="${esc(v.id)}"${d === v ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select>`;
    if (d) {
      const ops = d.type === 'bool' ? [['=', tl('prend la valeur')], ['toggle', tl('s’inverse')]] : d.type === 'text' ? [['=', tl('prend la valeur')]] : [['=', tl('prend la valeur')], ['+', tl('augmente de')], ['-', tl('diminue de')]];
      html += `<select data-f="op" aria-label="${tl('Opération')}">${ops.map(([k, l]) => `<option value="${k}"${it.op === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      if (it.op !== 'toggle') {
        if (it.op === '=') html += srcSelect(it.src, 'setsrc', { values: true, none: tl('valeur fixe :') });
        if (!it.src) html += d.type === 'bool' ? `<select data-f="v"><option value="1"${it.v ? ' selected' : ''}>${tl('vrai')}</option><option value="0"${it.v ? '' : ' selected'}>${tl('faux')}</option></select>`
          : d.type === 'text' ? `<input type="text" data-f="v" maxlength="${d.len || 16}" value="${esc(it.v ?? '')}" aria-label="${tl('Texte')}">` : `<input type="number" step="any" data-f="v" value="${esc(it.v ?? 0)}" aria-label="${tl('Valeur')}">`;
      }
    }
    return `<div class="act rl-set" data-aid="${esc(it.id)}">${html}<button type="button" class="tb mini" data-del="act" aria-label="${tl('Retirer')}">${icon('x')}</button></div>`;
  }
  const waitRow = it => `<div class="act rl-wait" data-aid="${esc(it.id)}"><em class="rl-k">${tl('puis attendre')}</em><span class="num"><input type="number" step="any" min="0.001" data-f="ms" value="${it.ms / 1000}" aria-label="${tl('Durée')}"><small>s</small></span><button type="button" class="tb mini" data-del="act" aria-label="${tl('Retirer')}">${icon('x')}</button></div>`;
  function gotoRow(it) {
    const key = it.seq ? `${it.seq}:${it.step || ''}` : '';
    const opts = seqsAll().map(q => `<optgroup label="${esc(tl('Séquence {0}', q.name))}">${q.steps.map(s => `<option value="${esc(q.id)}:${esc(s.id)}"${key === `${q.id}:${s.id}` ? ' selected' : ''}>${esc(tl('passe à l’étape {0}', s.name))}</option>`).join('')}<option value="${esc(q.id)}:"${key === `${q.id}:` ? ' selected' : ''}>${tl('arrête la séquence')}</option></optgroup>`).join('');
    return `<div class="act rl-goto" data-aid="${esc(it.id)}"><em class="rl-k">${tl('séquence')}</em><select data-f="goto" aria-label="${tl('Étape')}"><option value="">${tl('— choisir —')}</option>${opts}</select><button type="button" class="tb mini" data-del="act" aria-label="${tl('Retirer')}">${icon('x')}</button></div>`;
  }
  function itemHtml(it, mode, cx, inner) {
    if (it.kind === 'rule') return ruleCard(it, cx, inner, false);
    if (it.kind === 'set') return setRow(it);
    if (it.kind === 'wait') return waitRow(it);
    if (it.kind === 'goto') return gotoRow(it);
    return actRow(it, mode);
  }
  const addsHtml = (b, follow) => `<div class="adds"><button type="button" class="add" data-add="act">${icon('plus')}action</button>${follow ? '' : `<button type="button" class="add" data-add="rule">${icon('plus')}condition${b === 'else' ? tl(' (sinon si)') : ''}</button>
    <select class="rl-addsel" data-addsel aria-label="${tl('Ajouter')}"><option value="">${tl('+ autre…')}</option><option value="wait">${tl('puis attendre…')}</option><option value="set">${tl('changer une variable')}</option><option value="goto">${tl('passer à une étape')}</option><option value="serial">${tl('écrire sur le moniteur série')}</option>${netOf() ? `<option value="publish">${tl('publier sur le réseau (MQTT)')}</option><option value="page">${tl('afficher sur la page web')}</option>` : ''}</select>`}</div>`;
  function ruleCard(r, cx, hasSrc, top) {
    const mode = modeOf(r, hasSrc), inner = hasSrc || !!r.src;
    const branch = (b, label) => {
      const m = b === 'then' ? mode : 'cond', items = r[b].filter(it => mode !== 'follow' || it.kind === 'act');
      return `<div class="branch" data-branch="${b}"><em>${label}</em><div class="items">${items.map(it => itemHtml(it, m, cx, inner)).join('')}</div>${addsHtml(b, mode === 'follow')}</div>`;
    };
    const warn = [];
    const usesNet = JSON.stringify(r).includes(`"${NET}"`);
    if (usesNet && board() && !netOf(board(), cx.sn)) warn.push(tl('{0} n’a ni module Ethernet relié ni Wi-Fi', board().name));
    for (const t of termsOf(r)) {
      if (!t.src || !t.src.comp || t.src.comp === SERIAL || t.src.comp === NET) continue;
      const s = byId(t.src.comp);
      if (!s) warn.push(tl('la mesure choisie a été retirée du montage'));
      else if (!cx.sn.inspect(s).board) warn.push(tl('{0} n’est relié à aucune carte', s.name));
    }
    r.then.concat(r.else).forEach(it => { if (it.kind !== 'act' || it.comp === SERIAL || it.comp === NET) return; const d = byId(it.comp); if (it.comp && !d) warn.push(tl('un effecteur a été retiré du montage')); else if (d && !ruleBoard({ src: null, then: [it], else: [] }, cx.sn, true)) warn.push(tl('{0} n’est relié à aucune carte', d.name)); });
    const tag = top ? 'li' : 'div';
    return `<${tag} class="rule${top ? '' : ' nested'}" data-rid="${esc(r.id)}">
      <div class="rh"><span class="rn">${cx.nums.get(r.id) || ''}</span><p title="${esc(ruleText(r, byAny, cx.prof))}">${esc(condText(r, byAny, cx.prof))}</p><button type="button" class="tb danger" data-del="rule" aria-label="${tl('Supprimer cette {0}', top ? tl('règle') : 'condition')}">${icon('trash')}</button></div>
      ${condHtml(r, cx.prof, top)}
      ${branch('then', !r.src ? tl('Faire') : mode === 'follow' ? tl('Agit sur') : tl('Alors'))}
      ${r.src && mode !== 'follow' ? branch('else', tl('Sinon')) : ''}
      ${warn.length ? `<p class="rwarn">${tl('⚠ {0} : la règle ne s’applique pas tant que ce n’est pas réglé.', esc([...new Set(warn)].join(' · ')))}</p>` : ''}
    </${tag}>`;
  }
  function varCard(d) {
    const types = Object.entries(VAR_TYPE_LABELS).map(([k, l]) => `<option value="${k}"${d.type === k ? ' selected' : ''}>${esc(l)}</option>`).join('');
    const init = d.type === 'bool' ? `<select data-f="init"><option value="1"${d.init ? ' selected' : ''}>${tl('vrai')}</option><option value="0"${d.init ? '' : ' selected'}>${tl('faux')}</option></select>`
      : `<input type="${d.type === 'text' ? 'text' : 'number'}" step="any" data-f="init" value="${esc(d.init ?? '')}" aria-label="${tl('Valeur de départ')}"${d.type === 'text' ? ` maxlength="${d.len}"` : ''}>`;
    return `<li class="rule rl-var" data-rid="${esc(d.id)}"><div class="rh"><span class="rn rl-badge">x</span><p>${esc(varText(d))}</p><button type="button" class="tb danger" data-del="rule" aria-label="${tl('Supprimer cette variable')}">${icon('trash')}</button></div>
      <div class="rrow"><em>${tl('Nom')}</em><input type="text" data-f="name" value="${esc(d.name)}" maxlength="24" aria-label="${tl('Nom de la variable')}"><select data-f="type" aria-label="${tl('Type')}">${types}</select></div>
      <div class="rrow"><em>${tl('Départ')}</em>${init}${d.type === 'text' ? `<span class="num">${tl('au plus')} <input type="number" min="1" max="64" data-f="len" value="${d.len}"><small>${tl('caractères')}</small></span>` : ''}<label class="rl-chk"><input type="checkbox" data-f="persist"${d.persist ? ' checked' : ''}>${tl('gardée hors tension (EEPROM)')}</label></div></li>`;
  }
  function seqCard(q, cx) {
    const stepOpt = cur => `<option value=""${cur ? '' : ' selected'}>${tl('fin (arrêt)')}</option>${q.steps.map(s => `<option value="${esc(s.id)}"${cur === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}`;
    const steps = q.steps.map((s, i) => `<div class="rl-step" data-sid="${esc(s.id)}"><div class="rrow"><em>${i ? tl('Étape') : tl('1re étape')}</em><input type="text" data-f="sname" value="${esc(s.name)}" maxlength="24" aria-label="${tl('Nom de l’étape')}"><button type="button" class="tb mini" data-del="step" aria-label="${tl('Supprimer cette étape')}">${icon('x')}</button></div>
      <div class="branch" data-branch="do"><em>${tl('En entrant')}</em><div class="items">${s.do.map(it => itemHtml(it, 'cond', cx, true)).join('')}</div>${addsHtml('do', false)}</div>
      ${(s.go || []).map(gg => `<div class="rrow rl-go" data-gid="${esc(gg.id)}"><em>${tl('Puis')}</em><span class="num">${tl('après')} <input type="number" step="any" min="0" data-f="after" value="${gg.after ? gg.after / 1000 : ''}" placeholder="0"><small>s</small></span><span class="rl-when" data-t="when">${srcSelect(gg.when && gg.when.src, 'src', { none: tl('sans condition') })}${gg.when && gg.when.src ? termHtml(gg.when, cx.prof, { key: `${gg.id}:w` }).replace(/^<select[^]*?<\/select>/, '') : ''}</span><span>→</span><select data-f="to" aria-label="${tl('Étape suivante')}">${stepOpt(gg.to)}</select><button type="button" class="tb mini" data-del="go" aria-label="${tl('Retirer cette transition')}">${icon('x')}</button></div>`).join('')}
      <div class="adds"><button type="button" class="add" data-add="go">${icon('plus')}${tl('transition')}</button></div></div>`).join('');
    return `<li class="rule rl-seq" data-rid="${esc(q.id)}"><div class="rh"><span class="rn rl-badge">⇢</span><p title="${esc(seqText(q, byAny, cx.prof))}">${esc(tl('Séquence {0} : {1} étape(s), une seule active à la fois', q.name, q.steps.length))}</p><button type="button" class="tb danger" data-del="rule" aria-label="${tl('Supprimer cette séquence')}">${icon('trash')}</button></div>
      <div class="rrow"><em>${tl('Nom')}</em><input type="text" data-f="name" value="${esc(q.name)}" maxlength="24" aria-label="${tl('Nom de la séquence')}"><select data-f="start" aria-label="${tl('Départ')}"><option value="boot"${q.start !== 'stopped' ? ' selected' : ''}>${tl('démarre avec la carte')}</option><option value="stopped"${q.start === 'stopped' ? ' selected' : ''}>${tl('attend qu’une règle la lance')}</option></select></div>
      ${steps}<div class="adds"><button type="button" class="add" data-add="step">${icon('plus')}${tl('étape')}</button></div></li>`;
  }
  function renderRules() {
    const b = board(); if (!b) return;
    const sn = snapshot(), list = rulesOf(b, sn), cx = { sn, prof: boardOf(b), nums: numberRules(list) };
    netNow = netLink(b, comps(), sn.inspect);
    $('#ruleCount').textContent = list.filter(r => r.kind === 'rule').length || '';
    $('#rules').innerHTML = list.map(r => (r.kind === 'var' ? varCard(r) : r.kind === 'seq' ? seqCard(r, cx) : r.kind === 'net' ? netCard(r, cx) : ruleCard(r, cx, false, true))).join('');
    $('#rulesHint').hidden = !!list.length;
    $('#ruleAdd').disabled = !comps().some(isActuator) && !netNow; // une carte en réseau peut publier sans effecteur
    renderStates(sn);
  }
  /** Règles ou états changés : code régénéré, et relancé tout de suite si la simulation tourne. */
  function rulesChanged() {
    P.rules.forEach(r => { if (r.kind === 'rule') fixTree(r); });
    const sn = snapshot();
    for (const b of boards()) {
      if (!P.rules.some(r => ruleBoard(r, sn) === b) && !Object.keys(P.states).some(id => { const c = byId(id); return c && sn.inspect(c).board === b; })) continue;
      const e = ensure(b);
      if (e.auto && app.simOn()) launch(b, sn);
    }
    app.markDirty(); renderRules();
    const b = board();
    if (b && prev && prev.boardId === b.id) openPreview(b); // l'aperçu en blocs suit les règles
    if (b && editor) { const e = entry(b); if (!e || e.auto) { editor.value = codeOf(b, sn); check(); } }
    renderCodeMode(); app.refreshSel();
  }
  const flash = sel => requestAnimationFrame(() => { const el = $(sel); if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); const f = el.querySelector('select, input'); if (f) f.focus({ preventScroll: true }); });
  /** Condition éditée : la règle elle-même, une de ses conditions ajoutées, ou la condition d'une transition. */
  function termOf(el, owner) {
    const tEl = el.closest('[data-t]'), k = tEl ? tEl.dataset.t : '';
    if (k === 'when') return owner.when || (owner.when = { src: null, op: '>', v: 0 });
    if (k !== '' && owner.more) return owner.more[+k] || owner;
    return owner;
  }
  function onTermField(t, f, el, prof, isGo) {
    const v = el.value;
    if (f === 'src') {
      const src = srcDecode(v, t.src);
      if (isGo && !src) { t.src = null; return; }
      t.src = src; delete t.vs; delete t.hyst;
      if (src && !src.every && !src.start && !src.seq) { const sg = sigOfSrc(src, prof); Object.assign(t, termDefaults(sg)); if (sg && sg.kind === 'num' && sg.range) t.from = [...sg.range]; }
      else { t.op = '=='; t.v = 1; }
      if (!src) { delete t.more; delete t.edge; delete t.hold; }
    }
    if (f === 'every' && t.src) t.src.every = Math.max(1, Math.round((+v || 1) * 1000));
    if (f === 'topic' && t.src && t.src.comp === NET) t.src.topic = cleanTopic(v, false);
    if (f === 'src' && t.src && t.src.comp === NET) ensureNet();
    if (f === 'op') { t.op = v; if (v === 'follow') { delete t.more; delete t.edge; delete t.hold; } }
    if (f === 'v') { const sg = t.src && sigOfSrc(t.src, prof); t.v = sg && sg.kind === 'text' ? v : sg && sg.kind === 'time' ? ((+v.split(':')[0] || 0) * 60 + (+v.split(':')[1] || 0)) : +v || 0; }
    if (f === 'from0' || f === 'from1') t.from[f === 'from0' ? 0 : 1] = +v || 0;
    if (f === 'edge') { if (el.checked) t.edge = true; else delete t.edge; }
    if (f === 'hold') { const ms = Math.round((+v || 0) * 1000); if (ms > 0) t.hold = ms; else delete t.hold; }
    if (f === 'hyst') { const h = Math.abs(+v || 0); if (h) t.hyst = h; else delete t.hyst; }
    if (f === 'cmpsrc') { if (el.checked) { const sg = sigOfSrc(t.src, prof); t.vs = sg && sg.kind === 'text' ? { comp: SERIAL, sig: 'line' } : (() => { const c = comps().find(x => isSensor(x) && x.id !== (t.src && t.src.comp)); return c ? { comp: c.id, sig: Object.keys(SIGNALS[c.type])[0] } : null; })(); if (!t.vs) delete t.vs; else delete t.hyst; } else delete t.vs; }
    if (f === 'vs') t.vs = srcDecode(v);
    if (f === 'link') { t.link = v.startsWith('or') ? 'or' : 'and'; if (v.endsWith('not')) t.not = true; else delete t.not; }
  }
  function onRuleField(el) {
    const prof = board() && boardOf(board()), f = el.dataset.f, v = el.value;
    const holder = el.closest('[data-aid],[data-gid],[data-sid],[data-rid]'); if (!holder) return;
    const id = holder.dataset.aid || holder.dataset.gid || holder.dataset.sid || holder.dataset.rid, hit = findById(P.rules, id); if (!hit) return;
    const it = hit.it;
    if (holder.dataset.aid) {
      if (it.kind === 'set') {
        if (f === 'var') { it.var = v || null; it.op = '='; it.v = 0; delete it.src; }
        if (f === 'op') it.op = v;
        if (f === 'setsrc') { if (v) it.src = srcDecode(v); else delete it.src; }
        if (f === 'v') { const d = decl(it.var); it.v = d && d.type === 'text' ? v : d && d.type === 'bool' ? v === '1' : +v || 0; }
      } else if (it.kind === 'wait') { if (f === 'ms') it.ms = Math.max(1, Math.round((+v || 0) * 1000)); }
      else if (it.kind === 'goto') { const [q, s] = v.split(':'); it.seq = q || null; it.step = s || null; }
      else {
        const pseudo = it.comp === SERIAL || it.comp === NET, d = pseudo ? null : byId(it.comp), type = pseudo ? it.comp : d && d.type;
        if (f === 'comp') {
          it.comp = v || null; it.act = v === SERIAL ? 'print' : v === NET ? 'publish' : null; it.arg = v === SERIAL || v === NET ? defArg(v, it.act) : null; delete it.what; delete it.line; delete it.topic;
          if (v === NET) { it.topic = TOPIC_PUB; ensureNet(); }
        }
        if (f === 'act' && type === NET) { it.act = v; if (v === 'publish') { it.topic = it.topic || TOPIC_PUB; delete it.line; } else delete it.topic; }
        else if (f === 'act' && type) { it.act = v; it.arg = defArg(type, v); }
        if (f === 'topic' && type === NET) it.topic = cleanTopic(v, true);
        if (f === 'arg') it.arg = el.type === 'number' ? +v || 0 : v;
        if ((f === 'out0' || f === 'out1') && Array.isArray(it.arg)) it.arg[f === 'out0' ? 0 : 1] = +v || 0;
        if (f === 'what') { if (v) it.what = srcDecode(v); else delete it.what; }
        if (f === 'line') { if (v) it.line = +v; else delete it.line; }
      }
    } else if (holder.dataset.gid) {
      if (f === 'after') it.after = Math.max(0, Math.round((+v || 0) * 1000));
      else if (f === 'to') it.to = v || null;
      else { const t = termOf(el, it); onTermField(t, f, el, prof, true); if (!t.src) it.when = null; }
    } else if (holder.dataset.sid) {
      if (f === 'sname') it.name = ident(v.trim()) || it.name;
    } else if (it.kind === 'var') {
      if (f === 'name') { const n = ident(v.trim()); if (n && !P.rules.some(x => x !== it && x.kind === 'var' && x.name === n)) it.name = n; }
      if (f === 'type') { it.type = v; migrate(it); }
      if (f === 'init') it.init = it.type === 'text' ? v.slice(0, it.len) : it.type === 'bool' ? v === '1' : +v || 0;
      if (f === 'len') { it.len = Math.max(1, Math.min(64, +v | 0 || 16)); migrate(it); }
      if (f === 'persist') it.persist = el.checked;
    } else if (it.kind === 'seq') {
      if (f === 'name') it.name = ident(v.trim()) || it.name;
      if (f === 'start') it.start = v;
    } else if (it.kind === 'net') {
      if (f === 'dhcp') it.dhcp = v === '1';
      else if (f === 'port') it.port = +v || 0;
      else if (['ip', 'mac', 'ssid', 'pass', 'broker'].includes(f)) it[f] = v;
      fixNet(it);
    } else onTermField(termOf(el, it), f, el, prof, false);
    rulesChanged();
    const again = holder.dataset.aid ? $(`[data-aid="${holder.dataset.aid}"] [data-f="${f}"]`) : null;
    if (again && el.tagName !== 'SELECT') again.focus();
  }
  /** + action / + condition / + autre… dans une branche ; + condition (et / ou), + étape, + transition. */
  function addItem(btn, kind = btn.dataset.add) {
    const holder = btn.closest('[data-sid],[data-rid]'), hit = holder && findById(P.rules, holder.dataset.sid || holder.dataset.rid); if (!hit) return;
    const r = hit.it, sn = snapshot(), home = board();
    if (kind === 'term') {
      const sensors = comps().filter(c => isSensor(c) && (!home || sn.inspect(c).board === home));
      const c = sensors.find(x => !termsOf(r).some(t => t.src && t.src.comp === x.id)) || sensors[0];
      const src = c ? { comp: c.id, sig: Object.keys(SIGNALS[c.type])[0] } : { every: 1000 };
      const t = { src, link: 'and', ...(c ? termDefaults(signalOf(c.type, src.sig, home ? boardOf(home) : null)) : { op: '==', v: 1 }) };
      (r.more || (r.more = [])).push(t); rulesChanged(); return;
    }
    if (kind === 'step') { r.steps.push({ kind: 'step', id: uid('e'), name: tl('Etape{0}', r.steps.length + 1).replace(/\W/g, ''), do: [], go: [] }); rulesChanged(); return; }
    if (kind === 'go') { const i = hit.list.indexOf(r), nx = hit.list[i + 1] || hit.list[0]; r.go.push({ kind: 'go', id: uid('g'), after: 1000, when: null, to: nx ? nx.id : null }); rulesChanged(); return; }
    const b = btn.closest('[data-branch]').dataset.branch, list = r[b];
    const onHome = c => !home || sn.inspect(c).board === home || isMotor(c);
    const lastAct = [...list].reverse().find(it => it.kind === 'act' && byId(it.comp)) || actsOf(r).find(it => byId(it.comp));
    const eff = (lastAct && byId(lastAct.comp)) || comps().find(c => isActuator(c) && onHome(c)) || comps().find(isActuator) || null;
    let item;
    if (kind === 'act') item = actItem(eff, null);
    else if (kind === 'wait') item = { kind: 'wait', id: uid('a'), ms: 1000 };
    else if (kind === 'serial') item = { kind: 'act', id: uid('a'), comp: SERIAL, act: 'print', arg: defArg(SERIAL, 'print') };
    else if (kind === 'publish' || kind === 'page') { item = { kind: 'act', id: uid('a'), comp: NET, act: kind, arg: defArg(NET, kind), ...(kind === 'publish' ? { topic: TOPIC_PUB } : {}) }; ensureNet(home); }
    else if (kind === 'set') {
      let d = varsAll()[0];
      if (!d) { d = migrate({ kind: 'var', id: uid('v'), name: tl('compteur'), type: 'int', init: 0 }); P.rules.unshift(d); }
      item = { kind: 'set', id: uid('a'), var: d.id, op: d.type === 'int' ? '+' : '=', v: d.type === 'int' ? 1 : d.init };
    } else if (kind === 'goto') {
      let q = seqsAll()[0];
      if (!q) { q = newSeq(); P.rules.push(q); }
      item = { kind: 'goto', id: uid('a'), seq: q.id, step: q.steps[0] ? q.steps[0].id : null };
    } else {
      const sensors = comps().filter(c => isSensor(c) && onHome(c));
      const src = sensors.find(c => !r.src || c.id !== r.src.comp) || sensors[0] || null;
      item = newRule(src, eff, home ? boardOf(home) : null);
    }
    list.push(item);
    rulesChanged();
    flash(`[data-${item.kind === 'rule' ? 'rid' : 'aid'}="${item.id}"]`);
  }
  function newSeq() {
    const n = seqsAll().length + 1, a = { kind: 'step', id: uid('e'), name: 'Etape1', do: [], go: [] }, b = { kind: 'step', id: uid('e'), name: 'Etape2', do: [], go: [] };
    a.go.push({ kind: 'go', id: uid('g'), after: 1000, when: null, to: b.id }); b.go.push({ kind: 'go', id: uid('g'), after: 1000, when: null, to: a.id });
    return migrate({ kind: 'seq', id: uid('s'), name: n > 1 ? `sequence${n}` : 'sequence', start: 'boot', steps: [a, b] });
  }
  function removeItem(btn) {
    const k = btn.dataset.del;
    if (k === 'term') {
      const rEl = btn.closest('[data-rid],[data-gid]'), hit = rEl && findById(P.rules, rEl.dataset.rid || rEl.dataset.gid), i = +btn.closest('[data-t]').dataset.t;
      if (hit && hit.it.more) { hit.it.more.splice(i, 1); if (!hit.it.more.length) delete hit.it.more; }
      rulesChanged(); return;
    }
    const el = k === 'act' ? btn.closest('[data-aid]') : k === 'step' ? btn.closest('[data-sid]') : k === 'go' ? btn.closest('[data-gid]') : btn.closest('[data-rid]');
    const hit = el && findById(P.rules, el.dataset.aid || el.dataset.sid || el.dataset.gid || el.dataset.rid); if (!hit) return;
    hit.list.splice(hit.list.indexOf(hit.it), 1);
    rulesChanged();
  }
  function addRule(src, dst, flashIt = true) {
    const sn = snapshot(), tmp = { src: src && { comp: src.id }, then: dst ? [{ kind: 'act', comp: dst.id }] : [], else: [] };
    const b = ruleBoard(tmp, sn) || board();
    const r = newRule(src, dst, b ? boardOf(b) : null);
    P.rules.push(r);
    if (b) { cur = b.id; ensure(b); }
    rulesChanged();
    const mode = b ? progMode(b) : 'rules';
    if (mode === 'blocks') {
      // Programme en blocs : la nouvelle règle y arrive en blocs, à la fin de « en boucle ».
      const e = ensure(b); e.blocks = appendRule(b, cxOf(b, sn), e.blocks, r); closeWorkspace(); app.markDirty(); render();
      app.status(tl('Règle ajoutée en blocs, à la fin de « en boucle ».'), 'ok');
    } else if (mode === 'code') app.status(tl('Règle enregistrée, mais le programme de {0} est écrit à la main : choisissez « Règles » pour qu’elle s’applique.', b.name), 'warn');
    else if (flashIt) flash(`#rules [data-rid="${r.id}"]`);
    return r;
  }
  /** + Variable, + Séquence (boutons à côté de « + Règle »). */
  function addDecl(kind) {
    const b = board();
    const d = kind === 'var' ? migrate({ kind: 'var', id: uid('v'), name: (() => { let n = 1; while (varsAll().some(v => v.name === `variable${n}`)) n++; return `variable${n}`; })(), type: 'int', init: 0 }) : newSeq();
    if (b && boards().length > 1) d.board = b.id;
    if (kind === 'var') P.rules.unshift(d); else P.rules.push(d);
    rulesChanged(); flash(`#rules [data-rid="${d.id}"]`);
  }

  /* ---------- États par défaut ---------- */
  // Effecteur : une action au démarrage (et, si demandé, chaque fois qu'aucune règle ne le commande).
  // Capteur ou entrée : la valeur de départ de la simulation (bouton appuyé, curseur, température…).
  const INIT_FIELDS = {
    button: [{ key: 'pressed', label: tl('Au départ'), kind: 'bool', labels: [tl('relâché'), tl('appuyé')] }],
    pot: [{ key: 'pos', label: tl('Curseur au départ'), kind: 'num', min: 0, max: 100, step: 1, unit: '%' }],
    joystick: [{ key: 'x', label: 'X', kind: 'num', min: -100, max: 100, step: 1 }, { key: 'y', label: 'Y', kind: 'num', min: -100, max: 100, step: 1 }, { key: 'sw', label: tl('Bouton'), kind: 'bool', labels: [tl('relâché'), tl('appuyé')] }]
  };
  function initFields(c) {
    if (INIT_FIELDS[c.type]) return INIT_FIELDS[c.type];
    const m = MODELS[c.type]; if (!m || !m.q) return [];
    return m.q.map(q => { const Q = QUANT[q]; return Q.bool ? { key: q, label: Q.label, kind: 'bool', labels: ['non', 'oui'], env: true } : { key: q, label: Q.label, kind: 'num', min: Q.min, max: Q.max, step: Q.step, unit: Q.unit, env: true }; });
  }
  const hasState = c => { const st = P.states[c.id]; return !!st && (!!st.act || (st.values && Object.keys(st.values).length > 0)); };
  function stateHtml(c, named) {
    const st = P.states[c.id] || {}, head = named ? `<b>${esc(c.name)}</b>` : '';
    if (isActuator(c)) {
      const A = st.act && ACTIONS[c.type][st.act];
      return `<div class="state" data-sc="${esc(c.id)}">${head}<div class="sv">
        <select data-sf="act" aria-label="${tl('État par défaut de {0}', esc(c.name))}"><option value="">${tl('aucun : garde son dernier état')}</option>${defaultActs(c.type).map(([k, a]) => `<option value="${k}"${st.act === k ? ' selected' : ''}>${esc(a.label)}</option>`).join('')}</select>${A ? argHtml(A, st.arg, 's:arg') : ''}
        ${A ? `<select data-sf="mode" aria-label="${tl('Quand appliquer cet état')}"><option value="always"${st.mode !== 'start' ? ' selected' : ''}>${tl('au démarrage et quand aucune règle ne le commande')}</option><option value="start"${st.mode === 'start' ? ' selected' : ''}>${tl('au démarrage seulement')}</option></select>` : ''}</div></div>`;
    }
    const fields = initFields(c); if (!fields.length) return '';
    const vals = st.values || {}, cur = f => (f.env ? envOf(c, f.key) : c.inp ? c.inp[f.key] : '');
    return `<div class="state" data-sc="${esc(c.id)}">${head}<div class="sv">${fields.map(f => `<label>${esc(f.label)}${f.kind === 'bool'
      ? `<select data-sf="v:${f.key}"><option value="">${f.env ? tl('selon l’environnement') : tl('inchangé')}</option>${f.labels.map((l, i) => `<option value="${i}"${vals[f.key] !== undefined && +vals[f.key] === i ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
      : `<span class="num"><input type="number" data-sf="v:${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${vals[f.key] ?? ''}" placeholder="${esc(cur(f) ?? '')}">${f.unit ? `<small>${esc(f.unit)}</small>` : ''}</span>`}</label>`).join('')}</div></div>`;
  }
  function renderStates(sn = snapshot()) {
    const b = board(); if (!b) return;
    const single = boards().length === 1;
    const list = comps().filter(c => (isActuator(c) || initFields(c).length) && (isMotor(c) || sn.inspect(c).board === b || (single && !sn.inspect(c).board)));
    const n = list.filter(hasState).length;
    $('#stateCount').textContent = n || '';
    const acts = list.filter(isActuator), ins = list.filter(c => !isActuator(c));
    $('#states').innerHTML = (acts.length ? `<h5>${tl('Effecteurs')}</h5>${acts.map(c => stateHtml(c, true)).join('')}` : '')
      + (ins.length ? `<h5>${tl('Capteurs et entrées · valeur au lancement de la simulation')}</h5>${ins.map(c => stateHtml(c, true)).join('')}` : '')
      || `<p class="note">${tl('Ajoutez des LED, moteurs, capteurs… pour leur donner un état par défaut.')}</p>`;
  }
  /** Valeur de départ d'un capteur ou d'une entrée : posée dans la simulation. */
  function applyInit(c) {
    const st = P.states[c.id]; if (!st || !st.values) return false;
    const fields = initFields(c);
    for (const [k, v] of Object.entries(st.values)) {
      const f = fields.find(x => x.key === k); if (!f) continue;
      const val = f.kind === 'bool' ? (f.env ? (v ? 1 : 0) : !!v) : Math.max(f.min, Math.min(f.max, +v));
      // Capteur réglé à part : sa propre valeur ; sinon celle de l'environnement commun.
      if (f.env && c.env && k in c.env) c.env[k] = val; else if (f.env) ENV[k] = val; else if (c.inp) c.inp[k] = val;
    }
    return true;
  }
  function onStateField(el) {
    const box = el.closest('[data-sc]'), c = box && byId(box.dataset.sc); if (!c) return;
    const f = el.dataset.sf, v = el.value, st = P.states[c.id] || (P.states[c.id] = {});
    if (f === 'act') { if (!v) delete P.states[c.id]; else { st.act = v; st.arg = defArg(c.type, v); st.mode = st.mode || 'always'; } }
    if (f === 'arg') st.arg = el.type === 'number' ? +v || 0 : v;
    if (f === 'mode') st.mode = v;
    if (f.startsWith('v:')) {
      const k = f.slice(2); st.values = st.values || {};
      if (v === '') delete st.values[k]; else st.values[k] = +v;
      if (!Object.keys(st.values).length && !st.act) delete P.states[c.id];
      if (applyInit(c)) app.envChanged();
      app.markDirty(); renderStates(); app.refreshSel();
      return;
    }
    rulesChanged();
  }

  /* ---------- Section « Comportement » de la sélection ---------- */
  function behaviorHtml(c) {
    if (!c) return '';
    if (boardOf(c)) return `<div class="behav"><button type="button" class="btn wide" data-prog="board">${icon('code')}<span>${tl('Programmer {0}', esc(c.name))}</span></button></div>`;
    if (!isSensor(c) && !isActuator(c)) return '';
    const prof = boardOf(board() || c) || null, mine = P.rules.filter(r => involves(r, c.id)), st = stateHtml(c, false);
    return `<div class="behav"><h4>${tl('{0}Comportement', icon('workflow'))}</h4>
      ${st ? `<div class="bstate"><small>${isActuator(c) ? tl('État par défaut') : tl('Au lancement de la simulation')}</small>${st}</div>` : ''}
      ${mine.length ? `<ul>${mine.map(r => `<li data-rule="${esc(r.id)}" title="${tl('Modifier cette règle')}">${esc(ruleText(r, byAny, prof))}</li>`).join('')}</ul>` : `<p class="note">${isActuator(c) ? tl('Dites ce que doit faire {0} : s’allumer quand on appuie sur un bouton, tourner selon un potentiomètre…', esc(c.name)) : tl('Dites ce qui doit se passer selon {0} : allumer une LED, déclencher un relais…', esc(c.name))}</p>`}
      <button type="button" class="btn wide${mine.length ? '' : ' primary'}" data-prog="rule">${icon('plus')}<span>${tl('Programmer {0}', esc(c.name))}</span></button></div>`;
  }
  function onBehavior(e, c) {
    const li = e.target.closest('[data-rule]');
    if (li) { app.setTab('prog'); render(); flash(`#rules [data-rid="${li.dataset.rule}"]`); return; }
    const b = e.target.closest('[data-prog]'); if (!b || !c) return;
    if (b.dataset.prog === 'board') { cur = c.id; ensure(c); app.setTab('prog'); render(); app.markDirty(); return; }
    const sn = snapshot(), home = sn.inspect(c).board;
    const sameBoard = x => { const bb = isMotor(x) ? ruleBoard({ src: null, then: [{ kind: 'act', comp: x.id }], else: [] }, sn, true) : sn.inspect(x).board; return !home || bb === home; };
    const src = isSensor(c) ? c : comps().find(x => isSensor(x) && sameBoard(x)) || null;
    const dst = isActuator(c) ? c : comps().find(x => isActuator(x) && sameBoard(x)) || null;
    app.setTab('prog');
    addRule(src, dst);
    const rb = board(), text = ruleText(P.rules[P.rules.length - 1], byAny, boardOf(rb || c)), m = rb ? progMode(rb) : 'rules';
    if (m === 'blocks') app.status(tl('Règle ajoutée en blocs, à la fin de « en boucle » : {0}', text), 'ok');
    else if (m === 'rules') app.status(tl('Règle ajoutée : {0} Réglez-la dans l’onglet Code.', text), 'ok'); // en mode Code, addRule a déjà prévenu
  }

  /* ---------- Débogueur : points d'arrêt, pas à pas, variables ---------- */
  // Il agit sur la carte affichée (#progBoard) ; les autres cartes continuent de tourner. Une carte
  // n'est compilée en mode débogage (lang.js, debug) que si elle a des points d'arrêt ou si une pause
  // est demandée : sinon son programme tourne sans le moindre test supplémentaire.
  const bpsOf = b => { const e = entry(b); return e && Array.isArray(e.bps) ? e.bps.filter(n => Number.isInteger(n) && n > 0) : []; };
  const wantsDebug = b => { const s = board(); return !!s && s.id === b.id && (bpsOf(b).length > 0 || pendingPause === b.id); };
  /** Nouveau programme : points d'arrêt, pause demandée au lancement, traceur série. */
  function attach(b, rt) {
    if (rt.debug.enabled) rt.debug.setBreakpoints(wantsDebug(b) ? bpsOf(b) : []);
    if (pendingPause === b.id) { pendingPause = null; stepping = true; rt.debug.pause(); }
    if (plot) { plot.clear(b.id); rt.setSerialTap((text, vt) => plot.feed(b.id, text, vt)); }
    return rt;
  }
  /** Points d'arrêt affichés dans la marge et donnés au programme de la carte affichée. */
  function applyBps(b) {
    const list = bpsOf(b), shown = b === board(), rt = rts.get(b.id);
    if (editor && shown) editor.setBreakpoints(list, hookLines);
    if (rt && rt.debug.enabled) rt.debug.setBreakpoints(shown ? list : []);
  }
  function setBps(b, list) {
    const e = ensure(b), had = bpsOf(b).length;
    if (e.auto) codeOf(b); // le code généré affiché devient celui de la carte
    const clean = [...new Set(list)].filter(n => Number.isInteger(n) && n > 0).sort((x, y) => x - y);
    if (clean.length) e.bps = clean; else delete e.bps;
    app.markDirty(); applyBps(b);
    // Premier point d'arrêt sur un programme lancé sans débogage : il redémarre en mode débogage.
    const rt = rts.get(b.id);
    if (rt && !rt.debug.enabled && clean.length && !had && (rt.state === 'run' || rt.state === 'paused')) {
      if (launch(b)) app.status(tl('{0} redémarre en mode débogage : il s’arrêtera au point d’arrêt.', b.name), 'ok');
      render();
    }
  }
  /** Clic dans la marge ou F9 : pose ou retire un point d'arrêt (sur la prochaine ligne où le programme peut s'arrêter). */
  function toggleBp(n) {
    const b = board(); if (!b || !n || pyOf(b)) return; // pas de débogueur pas à pas pour le Python
    const list = bpsOf(b);
    if (list.includes(n)) { setBps(b, list.filter(x => x !== n)); return; }
    let to = n;
    if (hookLines && !hookLines.has(n)) { let best = 0; for (const l of hookLines) if (l > n && (!best || l < best)) best = l; to = best || n; }
    setBps(b, list.includes(to) ? list.filter(x => x !== to) : [...list, to]);
  }
  /** Lignes ajoutées ou retirées plus haut dans le code : les points d'arrêt suivent leur ligne. */
  function shiftBps(b, before, after) {
    const list = bpsOf(b), e = entry(b); if (!list.length || before === after || !e) return;
    const A = before.split('\n'), B = after.split('\n');
    let p = 0; while (p < A.length && p < B.length && A[p] === B[p]) p++;
    let s = 0; while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
    const endA = A.length - s, endB = B.length - s, d = B.length - A.length;
    // Avant la zone modifiée : inchangé ; après : décalé ; dedans : gardé tant que la ligne existe encore.
    const out = list.map(n => (n <= p ? n : n > endA ? n + d : n <= endB ? n : endB > p ? endB : 0)).filter(n => n >= 1 && n <= B.length);
    const clean = [...new Set(out)].sort((x, y) => x - y);
    if (clean.length) e.bps = clean; else delete e.bps;
    applyBps(b);
  }
  /** Carte affichée changée : l'ancienne reprend sa course, sans points d'arrêt. */
  function syncShown(b) {
    if (shownId === b.id) return;
    const old = shownId && rts.get(shownId);
    if (old && old.debug.enabled) { old.debug.setBreakpoints([]); if (old.debug.paused) old.debug.resume(); }
    shownId = b.id; watchKey = null; watchPrev = new Map();
    if (plot) plot.select(b.id);
  }
  /** Continuer / pause (F8), pas à pas principal (F10), entrer (F11), sortir (Maj+F11). */
  function dbgAction(kind) {
    const b = board(); if (!b || pyOf(b)) return;
    const rt = rts.get(b.id);
    if (rt && rt.state === 'paused') {
      stepping = kind !== 'run';
      if (kind === 'run') rt.debug.resume(); else rt.debug.step(kind);
      liveUi(true); return;
    }
    if (rt && rt.state === 'run') {
      if (kind !== 'run') return; // pas à pas : seulement à l'arrêt
      stepping = true;
      if (rt.debug.enabled) { rt.debug.pause(); if (rt.debug.paused) onPaused(b, rt); return; }
      // Lancé sans débogage : il redémarre en mode débogage et s'arrête à sa première instruction.
      pendingPause = b.id;
      if (launch(b)) app.status(tl('{0} redémarre en mode débogage : pause à la première instruction.', b.name), 'ok');
      render(); return;
    }
    // Rien ne tourne : démarrage en pause, à la première instruction de setup().
    pendingPause = b.id; ensure(b);
    if (!app.simOn()) app.setSim(true);
    else { launch(b); render(); }
    if (rts.get(b.id)) app.status(tl('{0} démarre en pause : F10 avance d’une instruction, F8 continue.', b.name), 'ok');
  }
  /** Le programme de la carte vient de s'arrêter (point d'arrêt ou fin d'un pas). */
  function onPaused(b, rt) {
    if (b !== board()) return;
    const at = rt.debug.at, hit = !stepping && at && bpsOf(b).includes(at.line);
    stepping = false;
    if (hit) {
      app.status(tl('{0} : point d’arrêt, ligne {1}. F10 avance d’une instruction, F8 continue.', b.name, at.line), 'ok');
      if ($('#pane-prog').hidden) app.setTab('prog');
    }
    liveUi(true);
    if (editor && at) editor.reveal(at.line);
  }
  /** Barre du débogueur, ligne d'arrêt dans l'éditeur, variables. */
  function dbgUi(b, rt) {
    const st = !b || !rt || pyOf(b) ? 'off' : rt.state === 'paused' ? 'paused' : rt.state === 'run' ? 'run' : 'off', bar = $('#dbgBar');
    if (bar.dataset.state !== st) {
      bar.dataset.state = st;
      const [ic, label, key] = st === 'paused' ? ['play', tl('Continuer'), 'F8'] : st === 'run' ? ['pause', tl('Pause'), 'F8'] : ['bug', tl('Déboguer : démarrer en pause'), 'F8'];
      const btn = $('#dbgRun'); btn.innerHTML = icon(ic); btn.dataset.tip = `${label} · ${key}`; btn.setAttribute('aria-label', label);
      ['#dbgOver', '#dbgInto', '#dbgOut'].forEach(sel => { $(sel).disabled = st === 'run'; });
    }
    const at = st === 'paused' ? rt.debug.at : null;
    if (editor) { editor.setPauseLine(at ? at.line : 0); editor.readOnly(!!at || isVisual(b)); }
    watchUi(rt, st);
  }
  /** Variables : locales et globales à l'arrêt, globales deux fois par seconde pendant l'exécution. */
  function watchUi(rt, st) {
    const sec = $('#watchSec');
    sec.hidden = st === 'off';
    if (sec.hidden || !$('#watchBox').open) return;
    const paused = st === 'paused', at = paused ? rt.debug.at : null, now = performance.now();
    if (paused ? watchKey === at : now - watchAt < 500) return;
    watchKey = at; watchAt = now;
    const next = new Map(), rows = (list, pre) => `<table>${list.map(v => {
      // À l'arrêt, ce qui a changé depuis l'arrêt précédent est surligné (pendant l'exécution, tout bouge).
      const k = pre + v.name, chg = paused && watchPrev.has(k) && watchPrev.get(k) !== v.text;
      next.set(k, v.text);
      return `<tr${chg ? ' class="chg"' : ''}><td class="wName" title="${esc(v.name)}">${esc(v.name)}</td><td class="wType" title="${esc(v.type)}">${esc(v.type)}</td><td class="wVal">${esc(v.text)}</td></tr>`;
    }).join('')}</table>`;
    let html = '';
    if (paused) {
      const loc = rt.debug.locals();
      html += `<h5>${at.fn ? tl('Locales · {0}()', esc(at.fn)) : tl('Locales')}</h5>`;
      html += loc.length ? rows(loc, `l:${at.fn}:`)
        : `<p class="note">${!rt.debug.enabled ? tl('Programme lancé sans débogage : posez un point d’arrêt pour voir ses variables locales.') : tl('Aucune variable locale ici (ou pause pendant une attente : F10 pour avancer).')}</p>`;
    } else if (!bpsOf(board()).length) html += `<p class="note">${tl('Cliquez dans la marge du code (numéros de ligne) pour poser un point d’arrêt, ou F8 pour mettre en pause.')}</p>`;
    const glo = rt.debug.globals();
    html += `<h5>${tl('Globales')}</h5>` + (glo.length ? rows(glo, 'g:') : `<p class="note">${tl('Aucune variable globale.')}</p>`);
    $('#watch').innerHTML = html;
    $('#watchAt').textContent = at ? (at.fn ? tl('ligne {0} · {1}()', at.line, at.fn) : tl('ligne {0}', at.line)) : tl('en cours');
    if (paused) watchPrev = next;
  }

  /* ---------- Traceur série ---------- */
  // Les nombres écrits sur Serial (« temp:21.5 hum:40 ») deviennent des courbes (plotter.js).
  function setSerialView(v, init) {
    serialView = v === 'plot' ? 'plot' : 'mon';
    $('#serialMon').setAttribute('aria-pressed', serialView === 'mon'); $('#serialPlot').setAttribute('aria-pressed', serialView === 'plot');
    $('#serialOut').hidden = serialView !== 'mon'; $('#plotBox').hidden = serialView !== 'plot'; $('#serialClear').hidden = serialView !== 'mon';
    try { localStorage.setItem('jollof-serial-view', serialView); } catch (e) { /* stockage indisponible */ }
    if (init) return;
    if (serialView === 'mon') { logDirty = true; liveUi(true); } else if (plot) { const b = board(); plot.select(src === 'real' ? REAL : b && b.id); plot.kick(); }
  }
  const canSerial = () => isTauri() || webSerial() || !!globalThis.__serialMock;
  const choosePorts = () => isTauri() || !!globalThis.__serialMock; // navigateur : le port se choisit à la connexion
  const portLabel = name => { const p = realPorts.find(x => x.name === name); return p ? p.label : name ? name.replace(/^\/dev\//, '') : tl('port choisi'); };
  const shownCode = () => { const b = board(), e = b && entry(b); return e ? e.code : ''; };
  /** Source du moniteur série : la carte simulée affichée, ou la vraie carte branchée en USB. */
  function setSrc(v) {
    src = v === 'real' ? 'real' : 'sim';
    try { localStorage.setItem('jollof-serial-src', src); } catch (e) { /* stockage indisponible */ }
    document.querySelectorAll('#serialSrc [data-src]').forEach(b => b.setAttribute('aria-pressed', b.dataset.src === src));
    $('#realBox').hidden = src !== 'real'; $('#serialEnd').hidden = src !== 'real';
    $('#serialInput').placeholder = src === 'real' ? tl('Envoyer à la carte réelle…') : tl('Envoyer à la carte (Serial.read)…');
    if (plot) { const b = board(); plot.select(src === 'real' ? REAL : b && b.id); }
    logDirty = true; paintLog();
    clearInterval(portPoll); portPoll = 0;
    if (src === 'real') { refreshPorts(); portPoll = setInterval(() => { if (serialShown() && !real.connected()) refreshPorts(); }, 1500); }
    paintReal();
  }
  /** Ports de la carte : les cartes USB d'abord ; une carte qui vient d'être branchée est choisie d'elle-même. */
  async function refreshPorts() {
    const sel = $('#realPort');
    sel.hidden = !choosePorts();
    if (!choosePorts()) { paintReal(); return; }
    const list = await listPorts().catch(() => []), sig = list.map(p => p.name).join('|');
    const before = new Set(realPorts.filter(p => p.usb).map(p => p.name)), first = portSig === null;
    realPorts = list;
    if (sig !== portSig) {
      portSig = sig;
      const usb = list.filter(p => p.usb), other = list.filter(p => !p.usb), opt = p => `<option value="${esc(p.name)}">${esc(p.label)}</option>`;
      sel.innerHTML = (usb.length ? usb.map(opt).join('') : `<option value="">${tl('Aucune carte USB détectée')}</option>`)
        + (other.length ? `<optgroup label="${tl('Autres ports (Bluetooth…)')}">${other.map(opt).join('')}</optgroup>` : '');
      let remembered = ''; try { remembered = localStorage.getItem('jollof-real-port') || ''; } catch (e) { /* stockage indisponible */ }
      const fresh = first ? null : usb.find(p => !before.has(p.name));
      const pick = [real.state().port, fresh && fresh.name, remembered, usb[0] && usb[0].name].find(n => n && list.some(p => p.name === n)) || '';
      const held = real.state().port;
      sel.value = (real.connected() || real.state().state === 'lost') && list.some(p => p.name === held) ? held : pick; // le port connecté reste affiché
      if (fresh && !real.connected()) { app.status(tl('Carte détectée : {0}. Cliquez sur « Connecter ».', fresh.label), 'ok'); $('#realGo').classList.add('pulse'); }
    }
    paintReal();
  }
  const noBoardHelp = () => `<b>${tl('Aucune carte détectée.')}</b><ul>
    <li>${tl('Branchez-la avec un câble USB de données : certains câbles ne font que charger.')}</li>
    <li>${tl('Une LED de la carte doit s’allumer.')}</li>
    <li>${tl('Carte compatible (puce CH340 ou CP210x) : installez son pilote si aucun port n’apparaît.')}</li>
    <li>${tl('Fermez l’IDE Arduino ou tout autre moniteur série qui utiliserait la carte.')}</li></ul>`;
  /** Bouton, état et conseils de la carte réelle. */
  function paintReal() {
    if (!$('#realBox')) return;
    const s = real.state(), on = s.state === 'on', busy = s.state === 'connecting', lost = s.state === 'lost', go = $('#realGo');
    go.textContent = on || lost ? tl('Déconnecter') : busy ? tl('Connexion…') : tl('Connecter');
    go.classList.toggle('primary', !on && !lost); go.disabled = busy || !canSerial();
    if (on) go.classList.remove('pulse');
    $('#realReset').disabled = !on;
    const progBaud = baudOf(shownCode()), bs = $('#realBaud');
    if (!on && !busy && !baudPicked && progBaud && +bs.value !== progBaud) bs.value = String(progBaud); // débit du programme, tant que l'élève n'en a pas choisi un autre
    let txt = '', help = '';
    if (!canSerial()) { txt = tl('Ce navigateur ne peut pas ouvrir de port série.'); help = tl('Utilisez Chrome ou Edge, ou l’application Jollof Studio installée.'); }
    else if (on) {
      txt = tl('Connectée · {0} · {1} bauds', portLabel(s.port), s.baud);
      if (s.noisy) help = `<b>${tl('Texte illisible ?')}</b> ${tl('Le débit ne correspond pas à celui du programme.')}${progBaud && progBaud !== s.baud ? ` <button type="button" class="btn small" data-baud="${progBaud}">${tl('Passer à {0} bauds (Serial.begin du programme)', progBaud)}</button>` : ` ${tl('Essayez 9600 ou 115200 bauds.')}`}`;
      else if (!s.rx) help = tl('Rien reçu pour l’instant : le programme de la carte écrit-il sur Serial ? « Redémarrer » le relance depuis le début.');
    } else if (busy) txt = tl('Connexion à {0}…', portLabel(s.port));
    else if (lost) txt = tl('Carte débranchée : reconnexion automatique dès qu’elle revient.');
    else if (s.state === 'error') { txt = tl('Pas de connexion.'); help = esc(s.error); }
    else if (s.by) txt = tl('Port pris par {0}.', whoLabel(s.by));
    else if (choosePorts() && !realPorts.some(p => p.usb)) { txt = tl('En attente d’une carte…'); help = noBoardHelp(); }
    else txt = tl('Prête : vérifiez le port et le débit, puis « Connecter ».');
    const st = $('#realState'); st.dataset.kind = s.state; st.querySelector('.txt').textContent = txt;
    const h = $('#realHelp'); h.hidden = !help; h.innerHTML = help;
  }
  function bindReal() {
    $('#realBaud').innerHTML = BAUDS.map(b => `<option value="${b}">${tl('{0} bauds', b)}</option>`).join('');
    let baud = 9600; try { baud = +localStorage.getItem('jollof-real-baud') || baudOf(shownCode()) || 9600; } catch (e) { /* stockage indisponible */ }
    $('#realBaud').value = String(BAUDS.includes(baud) ? baud : 9600);
    $('#serialEnd').innerHTML = ENDINGS.map(([v, l]) => `<option value="${esc(v)}">${l()}</option>`).join('');
    try { const e = localStorage.getItem('jollof-serial-end'); if (e != null && ENDINGS.some(([v]) => v === e)) $('#serialEnd').value = e; } catch (e) { /* stockage indisponible */ }
    $('#serialEnd').onchange = e => { try { localStorage.setItem('jollof-serial-end', e.target.value); } catch (err) { /* stockage indisponible */ } };
    document.querySelectorAll('#serialSrc [data-src]').forEach(b => { b.onclick = () => setSrc(b.dataset.src); });
    $('#realGo').onclick = async () => {
      const s = real.state();
      if (s.state === 'on' || s.state === 'lost') { await real.disconnect(); logKey(REAL, `\n${tl('— Déconnectée —')}\n`); return; }
      const port = choosePorts() ? $('#realPort').value : '', baud = +$('#realBaud').value;
      if (choosePorts() && !port) { app.status(tl('Branchez la carte, puis choisissez son port.'), 'warn'); return; }
      try { localStorage.setItem('jollof-real-port', port); localStorage.setItem('jollof-real-baud', String(baud)); } catch (e) { /* stockage indisponible */ }
      if (await real.connect(port, baud)) logKey(REAL, `${logs.get(REAL) ? '\n' : ''}${tl('— Connectée à {0}, {1} bauds —', portLabel(real.state().port), baud)}\n`);
    };
    $('#realReset').onclick = () => real.reset();
    $('#realPort').onchange = e => { try { localStorage.setItem('jollof-real-port', e.target.value); } catch (err) { /* stockage indisponible */ } real.setPort(e.target.value); };
    $('#realBaud').onchange = e => { baudPicked = true; try { localStorage.setItem('jollof-real-baud', e.target.value); } catch (err) { /* stockage indisponible */ } real.setBaud(+e.target.value); };
    $('#realHelp').onclick = e => { const b = e.target.closest('[data-baud]'); if (b) { $('#realBaud').value = b.dataset.baud; baudPicked = true; real.setBaud(+b.dataset.baud); } };
    setSrc(src);
  }
  function bindPlotter() {
    plot = createPlotter({
      canvas: $('#plotCv'), legend: $('#plotLegend'), win: $('#plotWin'), hold: $('#plotHold'), clear: $('#plotClear'), csv: $('#plotCsv'),
      fps: Q.simFps, light: LIGHT,
      shown: () => serialView === 'plot' && serialShown(),
      clock: id => { if (id === REAL) return real.clock(); const rt = rts.get(id); return rt ? rt.clock() : null; },
      name: id => { if (id === REAL) return tl('Carte réelle'); const b = byId(id); return b ? b.name : id; },
      save: (blob, name) => saveFile(blob, name, tl('Mesures (tableur)'), 'csv').catch(e => app.status(tl('Enregistrement impossible : ') + (e.message || e), 'err'))
    });
    for (const [id, rt] of rts) rt.setSerialTap((text, vt) => plot.feed(id, text, vt));
    $('#serialMon').onclick = () => setSerialView('mon');
    $('#serialPlot').onclick = () => setSerialView('plot');
    let v = 'mon'; try { v = localStorage.getItem('jollof-serial-view') || 'mon'; } catch (e) { /* stockage indisponible */ }
    setSerialView(v, true);
  }

  /* ---------- Émulateur de l'ESP32 (QEMU) : installation à la première utilisation ---------- */
  function qemuUi() {
    if ($('#qemuNote')) return;
    $('#progMain .progBar').insertAdjacentHTML('afterend', `<p class="note rule qemuNote" id="qemuNote" hidden>${icon('info')}<span></span>
      <button type="button" class="btn small" id="qemuInstall" hidden>${icon('upload')}<span>${tl('Installer')}</span></button></p>`);
    $('#qemuInstall').onclick = installQemu;
  }
  /** Note sous la barre (ESP32) : pourquoi il tourne sur le simulateur intégré, et l'émulateur à installer s'il manque. */
  function qemuNote(b) {
    qemuUi();
    const el = $('#qemuNote'), btn = $('#qemuInstall'), kind = b ? boardKind(b) : '';
    const want = !!b && QEMU_KINDS.has(kind) && !pyOf(b) && !realOk(b) && isTauri();
    el.hidden = !want; btn.hidden = true;
    if (!want) return;
    let text;
    if (qemuJob) text = qemuJob.text;
    else if (!qemu) text = tl('Recherche de l’émulateur de l’ESP32…');
    else if (!EMULATED.has(kind) && !qemu.available) text = tl('L’émulateur de l’ESP32 (QEMU) n’est pas encore publié pour cet ordinateur : l’ESP32 tourne sur le simulateur intégré.');
    else if (!EMULATED.has(kind)) { text = tl('Pour faire tourner le programme compilé, l’ESP32 a besoin de son émulateur (QEMU, environ 15 Mo, téléchargé une seule fois). En attendant, il tourne sur le simulateur intégré.'); btn.hidden = false; }
    else text = tl('ESP32 sur le simulateur intégré : {0}.', whyInterp(b) || '');
    el.querySelector('span').textContent = text;
  }
  async function checkQemu() {
    qemu = await qemuStatus();
    setQemuReady(!!qemu.installed, qemu.chips || null);
    if (!$('#pane-prog').hidden) render();
  }
  async function installQemu() {
    if (qemuJob) return;
    qemuJob = { text: tl('Téléchargement de l’émulateur de l’ESP32…') };
    render();
    try {
      qemu = await qemuInstall((got, total) => { if (!qemuJob) return; qemuJob.text = total ? tl('Téléchargement de l’émulateur de l’ESP32… {0} %', Math.round(got / total * 100)) : tl('Téléchargement de l’émulateur de l’ESP32… {0} Mo', (got / 1e6).toFixed(1)); qemuNote(board()); });
      setQemuReady(!!qemu.installed, qemu.chips || null);
      app.status(tl('Émulateur de l’ESP32 installé : les programmes compilés y tournent.'), 'ok');
      qemuJob = null;
      const b = board();
      if (b && app.simOn() && engineOf(b) === 'firmware') launch(b);
    } catch (e) {
      qemuJob = null;
      app.status(tl('Installation de l’émulateur de l’ESP32 impossible : {0}', (e && e.message) || e), 'err');
    }
    render();
  }

  /* ---------- Liaisons ---------- */
  function bind() {
    checkQemu();
    $('#progBoard').onchange = e => { cur = e.target.value; render(); };
    $('#progRun').onclick = upload;
    if ($('#progEngine')) $('#progEngine').onchange = e => {
      const b = board(); if (!b) return;
      const en = ensure(b);
      if (e.target.value === 'micropython') en.engine = 'micropython'; else delete en.engine;
      if (en.engine === 'micropython') pyFiles(b);
      else if (typeof en.code !== 'string') { en.code = ''; en.auto = true; } // carte créée en Python (import Wokwi) : code Arduino généré
      app.markDirty();
      render();
      if (app.simOn()) { launch(b); render(); }
    };
    $('#ruleAdd').onclick = () => { const sn = snapshot(), b = board(); const dst = comps().find(x => isActuator(x) && (!b || sn.inspect(x).board === b)) || comps().find(isActuator); addRule(null, dst || null); };
    $('#ruleAdd').insertAdjacentHTML('afterend', `<button type="button" class="btn small rl-decl" id="varAdd" data-tip="${tl('Un nombre, un texte ou un oui / non que les règles retiennent : compteur, consigne, code…')}">${icon('plus')}<span>${tl('Variable')}</span></button><button type="button" class="btn small rl-decl" id="seqAdd" data-tip="${tl('Des étapes l’une après l’autre, avec des attentes : feu tricolore, cycle de machine…')}">${icon('plus')}<span>${tl('Séquence')}</span></button>`);
    $('#varAdd').onclick = () => addDecl('var');
    $('#seqAdd').onclick = () => addDecl('seq');
    $('#rules').addEventListener('change', e => {
      if (e.target.dataset.addsel !== undefined) { const k = e.target.value; e.target.value = ''; if (k) addItem(e.target, k); return; }
      if (e.target.dataset.f) onRuleField(e.target);
    });
    $('#rules').addEventListener('click', e => {
      const adv = e.target.closest('[data-adv]'); if (adv) { const k = adv.dataset.adv; if (openAdv.has(k)) openAdv.delete(k); else openAdv.add(k); renderRules(); return; }
      const add = e.target.closest('[data-add]'); if (add) { addItem(add); return; }
      const del = e.target.closest('[data-del]'); if (del) removeItem(del);
    });
    $('#states').addEventListener('change', e => { if (e.target.dataset.sf) onStateField(e.target); });
    $('#codeGen').onclick = () => {
      const b = board(); if (!b) return;
      if (confirmGen < performance.now()) { confirmGen = performance.now() + 4000; renderCodeMode(); setTimeout(renderCodeMode, 4100); return; }
      confirmGen = 0; ensure(b).auto = true; editor.value = codeOf(b); renderCodeMode(); check(); app.markDirty();
      app.status(tl('Code régénéré à partir des règles et du montage.'), 'ok');
    };
    $('#diag').onclick = e => {
      const li = e.target.closest('li[data-line]'); if (!li || !+li.dataset.line || !editor) return;
      const b = board(); // erreur Python dans un autre fichier : il s'ouvre d'abord
      if (li.dataset.file && pyOf(b) && li.dataset.file in pyFiles(b) && li.dataset.file !== pyFile(b)) { ensure(b).file = li.dataset.file; render(); }
      editor.goLine(+li.dataset.line, +li.dataset.col || 1);
    };
    $('#serialClear').onclick = () => { const b = board(); if (src === 'real') { logs.set(REAL, ''); if (plot) plot.clear(REAL); } else if (b) logs.set(b.id, ''); logDirty = true; liveUi(true); };
    $('#serialForm').onsubmit = e => {
      e.preventDefault();
      const b = board(), rt = b && rts.get(b.id), inp = $('#serialInput');
      if (src === 'real') { // vers la vraie carte, avec la fin de ligne choisie
        if (!real.connected()) { app.status(tl('Connectez d’abord la carte réelle (bouton « Connecter »).'), 'warn'); return; }
        real.send(inp.value, $('#serialEnd').value).then(ok => { if (ok) inp.value = ''; }); return;
      }
      if (!rt || (rt.state !== 'run' && rt.state !== 'paused')) { app.status(tl('Le programme ne tourne pas : téléversez-le d’abord.'), 'warn'); return; }
      rt.send(inp.value + (rt.firmware === 'micropython' ? '\r' : '\n')); inp.value = ''; // REPL de MicroPython : Entrée = \r
    };
    const muteUi = () => { const m = audio.isMuted(); $('#progMute').setAttribute('aria-pressed', m); $('#progMute').innerHTML = icon(m ? 'volumeOff' : 'volume'); $('#progMute').dataset.tip = m ? tl('Rétablir le son (buzzer, haut-parleur, relais)') : tl('Couper le son'); };
    $('#progMute').onclick = () => { audio.setMuted(!audio.isMuted()); muteUi(); };
    muteUi();
    const wide = on => { $('.app').classList.toggle('wide', on); $('#progWide').setAttribute('aria-pressed', on); $('#progWide').innerHTML = icon(on ? 'shrink' : 'expand'); $('#progWide').dataset.tip = on ? tl('Réduire l’inspecteur') : tl('Agrandir l’inspecteur'); try { localStorage.setItem('jollof-wide', on ? '1' : '0'); } catch (e) { /* stockage indisponible */ } };
    $('#progWide').onclick = () => wide(!$('.app').classList.contains('wide'));
    let w = false; try { w = localStorage.getItem('jollof-wide') === '1'; } catch (e) { /* stockage indisponible */ }
    wide(w);
    // Débogueur : boutons et touches F8 à F11, actives seulement quand l'onglet Code est affiché.
    $('#dbgRun').onclick = () => dbgAction('run');
    $('#dbgOver').onclick = () => dbgAction('over');
    $('#dbgInto').onclick = () => dbgAction('into');
    $('#dbgOut').onclick = () => dbgAction('out');
    $('#watchBox').addEventListener('toggle', () => { watchKey = null; watchAt = 0; liveUi(true); });
    addEventListener('keydown', e => {
      if (!/^F(8|9|10|11)$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
      if ($('#pane-prog').hidden || $('#progMain').hidden) return;
      e.preventDefault();
      if (e.key === 'F9') { if (editor) toggleBp(editor.caretLine()); return; }
      dbgAction(e.key === 'F8' ? 'run' : e.key === 'F10' ? 'over' : e.shiftKey ? 'out' : 'into');
    });
    bindPlotter(); bindReal();
  }

  return {
    rts, bind, render, frame, startAll, stopAll, upload, behaviorHtml, onBehavior,
    /**
     * Carte réelle (téléversement de l'édition Pro, modules) : release(port) libère le port et rend la fonction
     * qui le reprend ; open({ port, baud }) montre le moniteur série de la carte réelle et s'y connecte.
     */
    realBoard: {
      state: () => real.state(),
      release: port => real.release(port),
      async open({ port = '', baud } = {}) {
        if (app.showSerial) app.showSerial(); else app.setTab('prog');
        setSrc('real');
        const sec = document.querySelector('.serialSec');
        if (sec && sec.classList.contains('folded')) { const h = sec.querySelector('.foldHead'); if (h) h.click(); }
        await refreshPorts();
        const b = baud || baudOf(shownCode()) || +$('#realBaud').value || 9600;
        if (port) $('#realPort').value = port;
        $('#realBaud').value = String(b);
        if (await real.connect(port || $('#realPort').value, b)) logKey(REAL, `${logs.get(REAL) ? '\n' : ''}${tl('— Connectée à {0}, {1} bauds —', portLabel(real.state().port), b)}\n`);
        sec && sec.scrollIntoView({ block: 'nearest' });
      }
    },
    /**
     * Assistants IA (src/ai/tools.js) : programme d'une carte (façon de programmer, code, règles), code écrit à la
     * main, retour aux règles, ajout et retrait de règles, moniteur série de la simulation.
     */
    ai: {
      state(b) { const sn = snapshot(); return { mode: progMode(b), code: pyOf(b) ? pyFiles(b)['main.py'] || '' : codeOf(b, sn), rules: rulesOf(b, sn) }; },
      setCode(b, code) {
        const e = ensure(b);
        if (e.mode === 'visual' && cur === b.id) closeWorkspace();
        e.codeBefore = e.code; e.code = code; e.auto = false; delete e.mode; delete e.bps;
        if (cur === b.id && editor) editor.value = code;
        app.markDirty(); render(); check();
      },
      useRules(b) {
        const e = ensure(b);
        if (e.mode === 'visual' && cur === b.id) closeWorkspace();
        delete e.mode; e.auto = true;
        if (cur === b.id && editor) editor.value = codeOf(b);
        app.markDirty(); render(); check();
      },
      rules: () => P.rules,
      addRule(r) { if (r) P.rules.push(r); rulesChanged(); },
      removeRules(test) { const n = P.rules.length; P.rules = P.rules.filter(r => !test(r)); rulesChanged(); return n - P.rules.length; },
      ruleText: (r, b) => ruleText(r, byAny, b ? boardOf(b) : null),
      serial: b => logs.get(b.id) || '',
      send(b, text) { const rt = rts.get(b.id); if (!rt) return false; rt.send(text + (rt.firmware === 'micropython' ? '\r' : '\n')); return true; },
      show(b) { if (b) { cur = b.id; render(); } }
    },
    /** Programme de la carte affichée dans l'onglet Code (pour un module : téléversement réel…). */
    current() {
      const b = board(); if (!b) return null; const e = entry(b);
      if (pyOf(b)) return { board: b, kind: boardKind(b), label: boardOf(b).label, lang: 'python', code: pyFiles(b)['main.py'] || '', files: { ...pyFiles(b) } };
      return { board: b, kind: boardKind(b), label: boardOf(b).label, lang: 'cpp', code: editor && document.activeElement === editor.el ? editor.value : e ? codeOf(b) : editor ? editor.value : codeOf(b) };
    },
    /** Programme d'une carte tel qu'il tournerait, pour le vérificateur ('' sans programme). */
    programOf(b) {
      if (pyOf(b)) return Object.values(pyFiles(b)).join('\n'); // Python : le vérificateur le traite comme dynamique
      const sn = snapshot(); if (!hasProgram(b, sn)) return '';
      const e = entry(b);
      return b.id === cur && editor && e && !e.auto && e.mode !== 'visual' ? editor.value : codeOf(b, sn);
    },
    /** Programme produit par les règles (pas écrit par l'élève) : le vérificateur ne lui reproche pas un composant inutilisé. */
    isAuto(b) { const e = entry(b); return !pyOf(b) && (!e || (!!e.auto && e.mode !== 'visual')); },
    /**
     * Carte en mode fidèle (vrai C++ jugé par arduino-cli) ou sous MicroPython : l'interpréteur ne lit pas son
     * programme, le vérificateur suppose que toute broche reliée peut être une sortie.
     */
    isFirmware(b) { const en = engineOf(b); return en === 'firmware' || en === 'micropython'; },
    /** Montre le programme d'une carte à une ligne (diagnostic cliqué). */
    showLine(b, line, col) { cur = b.id; ensure(b); app.setTab('prog'); render(); if (editor) editor.goLine(line, col); },
    /** Simulation lancée : capteurs et entrées repartent de leur valeur par défaut. */
    applyInits() { if (comps().map(applyInit).some(Boolean)) app.envChanged(); },
    onStateField(el) { if (el.dataset.sf) onStateField(el); },
    get data() { return JSON.parse(JSON.stringify(P)); },
    /** Mémoire d'un module gardée avec le projet (fichiers d'une carte SD…), vivante : celle que lisent les programmes. */
    compMem(c) { const m = P.mem || (P.mem = {}); return m[c.id] || (m[c.id] = {}); },
    /** Réseaux Wi-Fi simulés et journal (carte « Réseau Wi-Fi » du panneau Périphériques). */
    net: netData,
    netChanged() { app.markDirty(); },
    load(d) {
      P = {
        rules: Array.isArray(d && d.rules) ? d.rules.map(migrate).filter(Boolean) : [],
        boards: d && d.boards && typeof d.boards === 'object' ? d.boards : {},
        states: d && d.states && typeof d.states === 'object' ? d.states : {},
        mem: d && d.mem && typeof d.mem === 'object' ? d.mem : {},
        net: d && d.net && typeof d.net === 'object' && Array.isArray(d.net.networks) ? d.net : null
      };
      rts.clear(); logs.clear(); diag.clear(); pyDiag.clear(); pyRunNext.clear(); uploaded.clear(); cur = null; shownId = null; pendingPause = null; if (plot) plot.reset();
      closeWorkspace(); visMeta.clear();
      if (editor && !$('#pane-prog').hidden) render();
    },
    /**
     * Le montage a changé : un programme généré suit le câblage. Pendant la simulation, il est
     * relancé si son code change (un composant vient d'être câblé, par exemple).
     */
    circuitChanged() {
      if (app.simOn() && rts.size) {
        const sn = snapshot();
        for (const b of boards()) {
          const e = entry(b);
          if (!e || !(e.auto || e.mode === 'visual') || !rts.has(b.id)) continue;
          if (codeOf(b, sn) === uploaded.get(b.id)) continue;
          // Programme compilé : on attend la fin des retouches (chaque compilation prend quelques secondes).
          if (engineOf(b) === 'firmware') { clearTimeout(relaunchT.get(b.id)); relaunchT.set(b.id, setTimeout(() => { relaunchT.delete(b.id); if (app.simOn() && rts.has(b.id)) launch(b); }, 900)); }
          else launch(b, sn);
        }
      }
      if (vis && vis.h) { const b = comps().find(c => c.id === vis.boardId); if (b) vis.h.refreshToolbox(visCtx(b)); }
      if (!$('#pane-prog').hidden) render();
    }
  };
}
