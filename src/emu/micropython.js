// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// MicroPython sur le Pico : le micrologiciel officiel (RPI_PICO, fichier .uf2 de micropython.org, licence MIT) tourne
// sur le RP2040 émulé (rp2040.js). Ses modules machine, dht, onewire, neopixel… pilotent les mêmes modèles de modules
// que le mode fidèle, et son REPL passe par l'USB de la carte : c'est le moniteur série.
// Lancer le projet, comme Thonny ou mpremote : le « raw REPL » (Ctrl-A … Ctrl-D) écrit les fichiers (main.py, lib/…)
// dans le système de fichiers LittleFS de la carte, puis un redémarrage logiciel exécute main.py. « Exécuter ce
// fichier » envoie son texte au raw REPL sans l'enregistrer sur la carte.
import { createRp2040Runtime } from './rp2040.js';
import { tl } from '../i18n/index.js';

/** Micrologiciel livré avec l'application (public/firmware), chargé à la demande. */
export const FIRMWARE = { version: '1.29.0', file: 'firmware/RPI_PICO-20260824-v1.29.0.uf2', source: 'https://micropython.org/download/RPI_PICO/' };

let fw = null;
/** Octets du micrologiciel : téléchargés une fois, au premier lancement d'une carte MicroPython. */
export function loadFirmware(fetcher = globalThis.fetch) {
  if (!fw) {
    fw = Promise.resolve(fetcher(FIRMWARE.file))
      .then(r => { if (!r.ok) throw new Error(tl('Micrologiciel MicroPython introuvable ({0}).', FIRMWARE.file)); return r.arrayBuffer(); })
      .then(b => new Uint8Array(b))
      .catch(e => { fw = null; throw e; });
  }
  return fw;
}

const RAW = 'raw REPL; CTRL-B to exit\r\n>';
const CHUNK = 2048; // octets d'un fichier par commande : le raw REPL compile chaque commande en mémoire

/** Littéral bytes de Python, en ASCII seulement : aucun octet ne peut être pris pour Ctrl-C ou Ctrl-D. */
export function pyBytes(u8) {
  let s = "b'";
  for (const c of u8) {
    s += c === 0x5c ? '\\\\' : c === 0x27 ? "\\'" : c === 10 ? '\\n' : c === 13 ? '\\r' : c === 9 ? '\\t'
      : c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '\\x' + c.toString(16).padStart(2, '0');
  }
  return s + "'";
}
const pyStr = s => JSON.stringify(String(s)); // \uXXXX : ASCII, compris par MicroPython

/**
 * Commandes Python qui écrivent les fichiers du projet dans la carte, morceau par morceau (et retirent ceux qui ont
 * quitté le projet depuis le dernier envoi). Rend [{ code, what }] ; what : fichier concerné.
 */
export function syncCommands(files, remove = []) {
  const enc = new TextEncoder(), cmds = [], dirs = new Set();
  for (const p of Object.keys(files)) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
  const pre = [];
  if (remove.length) pre.push(`for p in [${remove.map(pyStr).join(',')}]:\n try: os.remove(p)\n except OSError: pass`);
  if (dirs.size) pre.push(`for d in [${[...dirs].sort().map(pyStr).join(',')}]:\n try: os.mkdir(d)\n except OSError: pass`);
  if (pre.length) cmds.push({ code: 'import os\n' + pre.join('\n'), what: null });
  for (const [path, text] of Object.entries(files)) {
    const b = enc.encode(String(text));
    for (let i = 0; i === 0 || i < b.length; i += CHUNK) cmds.push({ code: `f=open(${pyStr(path)},'${i ? 'ab' : 'wb'}')\nf.write(${pyBytes(b.subarray(i, i + CHUNK))})\nf.close()`, what: path });
  }
  return cmds;
}

/**
 * Lit les « Traceback » dans la sortie de MicroPython, ligne par ligne. onError({ frames: [{ file, line }], msg }) ;
 * frames du plus extérieur au plus profond. Une interruption (Ctrl-C, KeyboardInterrupt) n'est pas une erreur.
 */
export function createTracebackReader(onError) {
  let line = '', tb = null;
  function take(l) {
    if (/Traceback \(most recent call last\):$/.test(l)) { tb = []; return; } // parfois après l'invite « >>> »
    if (!tb) return;
    const m = /^\s+File "([^"]*)", line (\d+)/.exec(l);
    if (m) { tb.push({ file: m[1].replace(/^\//, ''), line: +m[2] }); return; }
    if (/^\s/.test(l)) return; // ligne de code citée
    const frames = tb; tb = null;
    if (frames.length && !/^KeyboardInterrupt/.test(l)) onError({ frames, msg: l });
  }
  return text => { for (const ch of text) { if (ch === '\n') { take(line.replace(/\r$/, '')); line = ''; } else line += ch; } };
}

/**
 * Pilote du raw REPL, indépendant de l'émulateur (testé seul).
 *   write(texte) : vers la carte ; out(texte) : vers le moniteur série ; fail(message) : tâche abandonnée ;
 *   feed(texte) : ce que la carte envoie ; tick(ms) : son heure (relances et délais).
 *   start({ files, remove, run }) ; run : 'main' (redémarrage logiciel, main.py) ou { code } (exécuté sans être
 *   enregistré, sa sortie va au moniteur au fil de l'eau).
 * Hors tâche, tout passe au moniteur : c'est le REPL normal.
 */
export function createRawRepl({ write, out, fail = () => {}, done = () => {} }) {
  let steps = [], step = null, buf = '', now = 0;
  const wait = (send, match, opt = {}) => ({ t: 'wait', send, match, ...opt });
  function begin() {
    step = steps.shift() || null; buf = '';
    if (!step) { done(); return; }
    step.at = now; step.tries = 0;
    if (step.t === 'exec') { step.phase = 'ok'; step.out = ''; step.err = ''; write(step.code + '\x04'); }
    else if (step.t === 'leave') { write('\x02'); begin(); return; }
    else if (step.send) write(step.send);
  }
  function abort(msg) { steps = []; step = null; buf = ''; write('\x02'); fail(msg); }
  function advance() {
    while (step) {
      if (step.t === 'wait') {
        const i = buf.indexOf(step.match); if (i < 0) return;
        const rest = buf.slice(step.keep ? i : i + step.match.length);
        if (step.keep) { buf = ''; step = null; steps = []; out(rest); done(); return; } // la suite est pour le moniteur
        begin(); buf = rest; continue;
      }
      // exec : « OK », sortie, Ctrl-D, erreur, Ctrl-D, invite « > ».
      if (step.phase === 'ok') { const i = buf.indexOf('OK'); if (i < 0) return; buf = buf.slice(i + 2); step.phase = 'out'; }
      if (step.phase === 'out' || step.phase === 'err') {
        const i = buf.indexOf('\x04'), part = i < 0 ? buf : buf.slice(0, i);
        if (step.stream) out(part); else step[step.phase] += part;
        if (i < 0) { buf = ''; return; }
        buf = buf.slice(i + 1); step.phase = step.phase === 'out' ? 'err' : 'prompt'; continue;
      }
      if (step.phase === 'prompt') {
        const i = buf.indexOf('>'); if (i < 0) return;
        buf = buf.slice(i + 1);
        if (!step.stream && step.err.trim()) { abort(tl('Écriture de {0} sur la carte impossible : {1}', step.what || tl('ses fichiers'), step.err.trim().split('\n').pop())); return; }
        begin();
      }
    }
  }
  return {
    get busy() { return !!step; },
    /** Programme lancé sans être enregistré : il tourne, ses entrées et Ctrl-C lui reviennent. */
    get streaming() { return !!step && step.t === 'exec' && !!step.stream && step.phase !== 'ok'; },
    start({ files = {}, remove = [], run = 'main' }) {
      steps = [wait('\r\x03\x03\x01', RAW, { retry: '\x03\x03\x01', every: 500, max: 20, why: tl('MicroPython ne répond pas sur le port USB de la carte.') })];
      for (const c of syncCommands(files, remove)) steps.push({ t: 'exec', code: c.code, what: c.what, limit: 15000 });
      if (run === 'main') steps.push(wait('\x02', '>>> ', { limit: 5000 }), wait('\x04', 'MPY: soft reboot', { keep: true, limit: 8000 }));
      else steps.push({ t: 'exec', code: run.code, stream: true }, { t: 'leave' });
      begin();
    },
    feed(text) { if (!step) { out(text); return; } buf += text; advance(); },
    tick(ms) {
      now = ms;
      if (!step || step.stream) return;
      if (step.retry && now - step.at > step.every * (step.tries + 1)) {
        if (++step.tries > step.max) { abort(step.why); return; }
        write(step.retry);
      } else if (step.limit && now - step.at > step.limit) abort(tl('MicroPython ne répond plus pendant l’envoi du programme.'));
    }
  };
}

/** Système de fichiers de chaque carte gardé pendant la session (pas dans le projet), clé : sa mémoire (prog.mem). */
const FS = new WeakMap();

/**
 * Moteur d'une carte Pico sous MicroPython, avec la même interface que les autres (src/emu/avr.js).
 * image : octets du .uf2 ; hw : pont vers le montage (makeHw) ;
 * opts : { files: { 'main.py': texte, 'lib/lcd.py': … }, run: 'main' | { code, name }, onError({ file, line, msg }) }.
 * En plus : mpy.runMain(files), mpy.runFile(nom, code, files), mpy.interrupt() (Ctrl-C).
 */
export function createMicroPythonRuntime(image, hw, opts = {}) {
  const key = hw.mem ? hw.mem() : null;
  let fs = key && FS.get(key);
  if (!fs || fs.version !== FIRMWARE.version) { fs = { version: FIRMWARE.version, sectors: new Map(), files: [] }; if (key) FS.set(key, fs); }
  const base = createRp2040Runtime(image, hw, { eeprom: false, flash: fs.sectors });
  let out = '', tapBuf = '', tap = null, failed = null, held = [], files = {}, execName = 'main.py';
  // Erreur Python : le cadre le plus profond qui est un fichier du projet (ou le code exécuté sans être enregistré).
  const traces = createTracebackReader(({ frames, msg }) => {
    const known = f => f.file === '<stdin>' || f.file in files;
    const f = [...frames].reverse().find(known) || frames[frames.length - 1];
    if (opts.onError) opts.onError({ file: f.file === '<stdin>' ? execName : f.file, line: f.line, msg });
  });
  const show = s => { out += s; tapBuf += s; traces(s); };
  const repl = createRawRepl({
    write: s => base.send(s), out: show,
    fail: m => { failed = m; },
    done: () => { for (const s of held.splice(0)) base.send(s); }
  });
  function start(run, list) {
    files = { ...(list || files) };
    const remove = fs.files.filter(p => !(p in files));
    fs.files = Object.keys(files);
    failed = null;
    execName = run === 'main' ? 'main.py' : run.name || 'main.py';
    repl.start({ files, remove, run: run === 'main' ? 'main' : { code: run.code } });
  }
  start(opts.run || 'main', opts.files || {});
  return {
    pins: base.pins, warnings: base.warnings, clock: base.clock, probe: base.probe, setTrace: base.setTrace,
    debug: base.debug, logic: base.logic, hw: base.hw, firmware: 'micropython',
    run(dt) {
      base.run(dt);
      const s = base.takeSerial(); if (s) repl.feed(s);
      if (base.hw.usbOpen()) repl.tick(base.clock()); // délais comptés une fois l'USB ouvert (démarrage de la carte)
      if (tap && tapBuf) tap(tapBuf, base.clock());
      tapBuf = '';
    },
    get state() { return failed ? 'error' : base.state; },
    get error() { return failed ? { line: 0, msg: failed } : base.error; },
    get line() { return null; },
    takeSerial() { const s = out; out = ''; return s; },
    setSerialTap(fn) { tap = fn || null; },
    /** Moniteur série → REPL (ou input() du programme) ; pendant l'envoi des fichiers, gardé pour après. */
    send(s) { if (repl.busy && !repl.streaming) held.push(String(s)); else base.send(s); },
    stop() { base.stop(); },
    mpy: {
      get busy() { return repl.busy && !repl.streaming; },
      /** Fichiers renvoyés à la carte, puis redémarrage logiciel : main.py s'exécute. */
      runMain(list) { start('main', list); },
      /** Code exécuté tel quel (fichiers du projet d'abord envoyés, pour ses import) sans être enregistré. */
      runFile(name, code, list) { start({ code, name }, list); },
      /** Ctrl-C : interrompt le programme (KeyboardInterrupt), le REPL reprend la main. */
      interrupt() { if (!repl.busy || repl.streaming) base.send('\x03'); }
    }
  };
}
