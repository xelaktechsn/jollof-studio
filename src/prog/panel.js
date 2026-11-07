// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Onglet « Code » : programme de chaque carte, règles de comportement, éditeur,
// téléversement, débogueur (points d'arrêt, pas à pas, variables), moniteur et traceur série.
// Le programme d'une carte vient de ses règles (code généré, régénéré à chaque changement)
// ou du code écrit à la main.
import { driveBoard } from '../sim/drive.js';
import { compile } from './lang.js';
import { createRuntime } from './runtime.js';
import { EMULATED } from '../emu/boards.js';
import { generate, newRule, ruleText, condText, SIGNALS, ACTIONS, OPS, signalOf, defArg, isSensor, isActuator, actsFor, actItem, migrate, findById, actsOf, involves, numberRules, defaultActs } from './rules.js';
import { QUANT, ENV, MODELS, NET_DEFAULT } from '../sim/models.js';
import { createEditor } from './editor.js';
import { createPlotter } from './plotter.js';
import { Q, LIGHT } from '../quality.js';
import { saveFile } from '../native.js';
import './debug.css';
import './visual/mode.css';
import { generateVisual, visualContext } from './visual/generator.js';
import { emptyWorkspace } from './visual/types.js';
import { confirm as askConfirm } from '../school/ui.js';
import { BOARDS, boardOf } from '../sim/boards.js';
import { analyze, inspect, firstMsg } from '../sim/circuit.js';
import { partOf, isMotor } from '../sim/parts.js';
import { icon } from '../ui/icons.js';
import * as audio from '../sim/audio.js';
import { tl, COLON } from '../i18n/index.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FAMILY_KIND = { atmega328p: 'uno', esp8266: 'nodemcu', rp2040: 'pico' };
/** Famille de carte pour le compilateur : uno, nano, esp32, nodemcu ou pico. */
export const boardKind = c => (BOARDS[c.type] ? c.type : FAMILY_KIND[boardOf(c).family] || 'esp32');
const LOG_MAX = 40000;

/**
 * app : { comps(), wires(), sim() → { A, ins, drive, pinComps }, simOn(), setSim(on), setTab(name),
 *         status(text, kind), markDirty(), refreshSel() }
 */
export function createProgram(app) {
  // mem : EEPROM et Preferences de chaque carte (survivent au redémarrage et sont enregistrées avec le projet) ;
  // net : réseaux Wi-Fi simulés et journal (journal.jollof).
  let P = { rules: [], boards: {}, states: {}, mem: {}, net: null };
  const rts = new Map(), logs = new Map(), diag = new Map(), uploaded = new Map();
  // Mode fidèle : compilation en cours (jeton par carte : une compilation dépassée est ignorée) et erreurs d'arduino-cli.
  const fwJobs = new Map(), fwDiag = new Map();
  let cur = null, editor = null, lastUi = 0, logDirty = true, checkT = 0, confirmGen = 0, warnSig = '';
  // Blocs de code : espace de travail Blockly de la carte affichée (chargé à la demande) et correspondances ligne → bloc.
  let vis = null, wideAuto = false; const visMeta = new Map();
  // Débogueur (voir plus bas) : carte à mettre en pause dès son lancement, lignes où le code affiché
  // peut s'arrêter, carte affichée, variables déjà montrées. Traceur série : vue du port série.
  let pendingPause = null, hookLines = null, shownId = null, watchKey = null, watchAt = 0, watchPrev = new Map(), stepping = false;
  let plot = null, serialView = 'mon';

  const comps = () => app.comps();
  const byId = id => comps().find(c => c.id === id);
  const boards = () => comps().filter(c => boardOf(c));
  const board = () => { const bs = boards(); let b = bs.find(x => x.id === cur); if (!b) { b = bs[0] || null; cur = b && b.id; } return b; };
  /** Moteur d'exécution d'une carte : 'interp' (interpréteur, instantané, pas à pas) ou 'firmware' (vrai programme émulé). */
  const engineOf = b => { const e = b && P.boards[b.id]; return e && e.engine === 'firmware' && EMULATED.has(boardKind(b)) ? 'firmware' : 'interp'; };
  /** Moteur provisoire d'une carte dont le vrai programme se compile. */
  const compilingStub = logic => ({
    state: 'compiling', pins: new Map(), warnings: new Map(), line: null, error: null, logic,
    run() {}, clock: () => 0, probe: () => null, setTrace() {}, setSerialTap() {}, takeSerial: () => '', send() {}, stop() {},
    debug: { enabled: false, paused: false, at: { line: 0, fn: null }, pause() {}, resume() {}, step() {}, setBreakpoints() {}, locals: () => [], globals: () => [] }
  });
  function snapshot() {
    const A = analyze(app.comps(), app.wires()), cache = new Map();
    return { A, inspect: c => { if (!cache.has(c)) cache.set(c, inspect(c, A, partOf(c))); return cache.get(c); } };
  }
  /** Carte qui exécute la règle : celle de ses effecteurs, sinon celle de sa mesure. strict : sans repli sur la carte unique. */
  function ruleBoard(r, sn, strict) {
    const cands = [...actsOf(r).map(a => byId(a.comp)), r.src && byId(r.src.comp)];
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
  const I2C = ['bmp280', 'oled', 'lcd1602', 'mpu6050'];
  const i2cAddr = (c, def) => { const a = c.inp ? Math.trunc(+c.inp.addr) : 0; return a > 0 && a < 128 ? a : def; };
  /** Le projet a changé pendant la simulation (mémoire, journal) : enregistrement au plus toutes les 2 s. */
  let dirtyT = 0;
  const softDirty = () => { if (dirtyT) return; dirtyT = setTimeout(() => { dirtyT = 0; app.markDirty(); }, 2000); };
  const netData = () => P.net || (P.net = NET_DEFAULT());
  function makeHw(b) {
    const prof = boardOf(b), sim = () => app.sim();
    const addr = c => (c.type === 'bmp280' ? [sim().A.net({ comp: c, key: 'SDO' }).gnd.length ? 0x76 : 0x77] : c.type === 'oled' ? [i2cAddr(c, 0x3c)] : c.type === 'lcd1602' ? [i2cAddr(c, 0x27)] : c.type === 'mpu6050' ? [0x68] : []);
    const at = key => (sim().pinComps && sim().pinComps.get(b.id + '|' + key)) || [];
    /** Module câblé et alimenté (sinon le premier défaut de câblage). */
    const status = c => { const ins = sim().ins && sim().ins.get(c), ok = !!ins && ins.level !== 'err'; return { ok, msg: ok || !ins ? '' : firstMsg(ins) }; };
    return {
      kind: boardKind(b), label: `${b.name} (${prof.label})`, prof,
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
      i2c() { return this.bus(I2C); },
      /** La carte elle-même (son état partagé : Wi-Fi, serveur web, Bluetooth). */
      self: () => b,
      /** Mémoire de la carte qui survit au redémarrage : { ee : EEPROM en hexadécimal, prefs : Preferences }. */
      mem() { const m = P.mem || (P.mem = {}); return m[b.id] || (m[b.id] = { ee: '', prefs: {} }); },
      memChanged: softDirty,
      /** Réseaux Wi-Fi et journal du projet. */
      net: netData, netChanged: softDirty,
      /** Niveau d'une broche d'un module : 1 (alimentation ou sortie HIGH d'une carte), 0 (masse ou sortie LOW), null (en l'air). */
      level(c, key) {
        const s = sim(); if (!s.A || !c.pins || !c.pins[key]) return null;
        const n = s.A.net({ comp: c, key });
        if (n.src.length) return 1;
        if (n.gnd.length) return 0;
        for (const g of n.gpio) { const rt = rts.get(g.comp.id), p = rt && rt.pins.get(g.key); if (p && p.mode === 1) return p.d ? 1 : 0; }
        return null;
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
  function log(b, text) {
    let s = (logs.get(b.id) || '') + text;
    if (s.length > LOG_MAX) s = s.slice(-LOG_MAX * 0.75);
    logs.set(b.id, s); if (b.id === cur) logDirty = true;
  }
  function clearScreens(b) {
    const ins = app.sim().ins;
    comps().forEach(c => { if (c.progScreen && (!ins || !ins.get(c) || ins.get(c).board === b)) c.progScreen = null; });
  }
  /** Compile et lance le programme d'une carte ; false s'il ne compile pas. */
  function launch(b, sn = snapshot()) {
    if (engineOf(b) === 'firmware') return launchFirmware(b, codeOf(b, sn));
    const code = codeOf(b, sn), res = compile(code, { ...ctxOf(b), debug: wantsDebug(b) });
    diag.set(b.id, { errors: res.errors, warnings: res.warnings });
    rts.delete(b.id); clearScreens(b);
    if (!res.ok) {
      if (pendingPause === b.id) pendingPause = null;
      const e = res.errors[0];
      app.status(tl('{0} : le programme ne compile pas, ligne {1} : {2}', b.name, e.line, e.msg), 'err');
      log(b, tl('\n✕ Erreur de compilation, ligne {0} : {1}\n', e.line, e.msg));
      if (EMULATED.has(boardKind(b))) log(b, tl('Astuce : le mode d’exécution « Fidèle » compile le vrai C++ d’Arduino (pointeurs, classes, toutes les bibliothèques) et le fait tourner sur un processeur émulé.\n'));
      return false;
    }
    rts.set(b.id, attach(b, createRuntime(res.js, makeHw(b), res.debug || { globals: res.globals })));
    uploaded.set(b.id, code);
    log(b, tl('{0}— {1} démarre —\n', (logs.get(b.id) || '').length ? '\n' : '', b.name));
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
    log(b, tl('{0}— {1} : compilation du vrai programme (mode fidèle)… —\n', (logs.get(b.id) || '').length ? '\n' : '', b.name));
    // Compilateur et processeur émulé chargés à la demande : ils ne pèsent rien tant que le mode fidèle ne sert pas.
    Promise.all([import('../emu/compile.js'), import('../emu/avr.js')]).then(([C, E]) => C.compileFirmware(code, boardKind(b), m => log(b, m + '\n')).then(res => [res, E])).then(([res, E]) => {
      if (fwJobs.get(b.id) !== token) return; // relancé ou arrêté entre-temps
      fwJobs.delete(b.id);
      if (!res.ok) {
        rts.delete(b.id);
        fwDiag.set(b.id, { errors: res.errors, warnings: [] }); diag.set(b.id, fwDiag.get(b.id));
        const e = res.errors[0];
        app.status(tl('{0} : le programme ne compile pas, ligne {1} : {2}', b.name, e.line, e.msg), 'err');
        log(b, tl('\n✕ Erreur de compilation, ligne {0} : {1}\n', e.line, e.msg));
        if (b.id === cur) renderDiag();
        render();
        return;
      }
      let rt;
      try { rt = E.createAvrRuntime(res.hex, makeHw(b)); } catch (e) { rts.delete(b.id); log(b, `\n✕ ${e.message}\n`); return; }
      rts.set(b.id, attach(b, rt));
      uploaded.set(b.id, code);
      log(b, tl('— {0} démarre : vrai programme sur processeur émulé —\n', b.name));
      if (b.id === cur) renderDiag();
      render();
    });
    return true;
  }
  function startAll() {
    rts.clear();
    const sn = snapshot();
    let n = 0, bad = 0;
    for (const b of boards()) if (hasProgram(b, sn)) { n++; if (!launch(b, sn)) bad++; }
    render();
    return { n, bad };
  }
  function stopAll() { fwJobs.clear(); rts.clear(); comps().forEach(c => { c.progScreen = null; }); uploaded.clear(); pendingPause = null; liveUi(true); }
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
  function liveUi(force) {
    const b = board(), rt = b && rts.get(b.id);
    $('#progLive').hidden = !rts.size;
    if ($('#pane-prog').hidden && !force) return;
    const st = $('#progState');
    let kind = 'off', text = app.simOn() ? tl('Pas de programme en cours') : tl('Simulation arrêtée');
    if (rt) {
      if (rt.state === 'compiling') { kind = 'pause'; text = tl('Compilation du vrai programme…'); }
      else if (rt.state === 'run') { kind = 'on'; text = rt.line == null ? tl('En cours · vrai programme (mode fidèle)') : tl('En cours · ligne {0}', rt.line); }
      else if (rt.state === 'paused') { const at = rt.debug.at; kind = 'pause'; text = at.fn ? tl('En pause · ligne {0} · {1}()', at.line, at.fn) : tl('En pause · ligne {0}', at.line); }
      else if (rt.state === 'error') { kind = 'err'; text = tl('Arrêté par une erreur, ligne {0}', rt.error.line); }
      else { kind = 'off'; text = tl('Terminé'); }
    } else if (b && diag.get(b.id) && diag.get(b.id).errors.length && app.simOn()) { kind = 'err'; text = tl('Ne compile pas'); }
    if (b && boards().length < 2 && kind !== 'off') text = `${b.name} · ${text}`;
    st.dataset.kind = kind; st.querySelector('span:last-child').textContent = text; st.title = b ? `${b.name} (${boardOf(b).label})${COLON}${text}` : text;
    if (editor) editor.setRunLine(rt && rt.state === 'run' ? rt.line || 0 : rt && rt.state === 'error' ? rt.error.line : 0);
    const changed = b && rt && uploaded.get(b.id) !== undefined && editor && editor.value !== uploaded.get(b.id);
    $('#progRun').classList.toggle('pulse', !!changed);
    $('#progRun').dataset.tip = changed ? tl('Le code a changé : téléversez-le · Ctrl+Entrée') : tl('Compiler et exécuter sur la carte · Ctrl+Entrée');
    if (logDirty) {
      logDirty = false;
      const out = $('#serialOut'), atEnd = out.scrollTop + out.clientHeight >= out.scrollHeight - 8;
      out.textContent = (b && logs.get(b.id)) || '';
      if (atEnd) out.scrollTop = out.scrollHeight;
    }
    if (rt) { const sig = rt.state + rt.warnings.size + [...rt.warnings.values()].reduce((a, w) => a + w.n, 0); if (sig !== warnSig) { warnSig = sig; renderDiag(); } }
    dbgUi(b, rt);
    visualHighlight(b, rt);
    if (plot && serialView === 'plot') plot.kick();
  }
  function renderDiag() {
    const b = board(), d = (b && diag.get(b.id)) || { errors: [], warnings: [] }, rt = b && rts.get(b.id);
    const items = [
      ...d.errors.map(e => ({ lv: 'err', line: e.line, col: e.col, len: e.len, msg: e.title || e.msg, code: e.code, help: e.help, tag: tl('Compilation') })),
      ...(rt && rt.state === 'error' ? [{ lv: 'err', line: rt.error.line, msg: rt.error.msg, tag: tl('Exécution') }] : []),
      ...d.warnings.map(w => ({ lv: 'warn', line: w.line, col: w.col, msg: w.msg, code: w.code, tag: tl('Bibliothèque') })),
      ...(rt ? [...rt.warnings.values()].map(w => ({ lv: 'warn', line: w.line, msg: w.msg + (w.n > 1 ? ` (×${w.n})` : ''), tag: tl('Exécution') })) : [])
    ];
    // Comme rustc : code stable, message, puis l'aide sur sa propre ligne.
    $('#diag').innerHTML = items.map(i => `<li class="${i.lv}" data-line="${i.line}" data-col="${i.col || 1}" title="${tl('Aller à la ligne {0}', i.line)}"><i>${i.lv === 'err' ? '✕' : '!'}</i><b>${i.line ? tl('Ligne ') + i.line : i.tag}</b><span>${i.code ? `<code class="jcode">${i.code}</code>` : ''}${esc(i.msg)}${i.help ? `<small>${tl('aide :')} ${esc(i.help)}</small>` : ''}</span></li>`).join('');
    if (editor) editor.setMarks({ errors: items.filter(i => i.lv === 'err'), warnings: items.filter(i => i.lv === 'warn') });
  }
  function check() {
    const b = board(); if (!b || !editor) return;
    // Mode fidèle : c'est arduino-cli qui juge le programme (erreurs affichées après la compilation).
    if (engineOf(b) === 'firmware') { hookLines = null; diag.set(b.id, fwDiag.get(b.id) || { errors: [], warnings: [] }); renderDiag(); applyBps(b); return; }
    // Compilé en mode débogage : on connaît aussi les lignes où un point d'arrêt peut arrêter le programme.
    const res = compile(editor.value, { ...ctxOf(b), debug: true });
    hookLines = res.ok ? res.debug.lines : null;
    diag.set(b.id, { errors: res.errors, warnings: res.warnings });
    renderDiag();
    applyBps(b);
  }
  function renderCodeMode() {
    const b = board(), e = b && entry(b);
    const auto = !e || e.auto;
    const visual = !!e && e.mode === 'visual';
    $('#codeMode').textContent = visual ? tl('créé avec les blocs') : auto ? (rulesOf(b, snapshot()).length ? tl('généré par les règles') : tl('généré à partir du montage')) : tl('écrit à la main');
    $('#codeMode').dataset.kind = visual ? 'visual' : auto ? 'auto' : 'hand';
    $('#codeGen').hidden = auto || visual;
    $('#codeGen').querySelector('span').textContent = confirmGen > performance.now() ? tl('Confirmer : remplacer mon code') : tl('Régénérer');
  }
  function render() {
    const bs = boards(), b = board();
    $('#progEmpty').hidden = !!b; $('#progMain').hidden = !b;
    if (!b) { liveUi(true); return; }
    const sel = $('#progBoard');
    sel.hidden = bs.length < 2;
    sel.innerHTML = bs.map(x => `<option value="${esc(x.id)}"${x === b ? ' selected' : ''}>${esc(x.name)} · ${esc(boardOf(x).label)}</option>`).join('');
    const eng = $('#progEngine');
    if (eng) { eng.hidden = !EMULATED.has(boardKind(b)); eng.value = engineOf(b); }
    renderRules();
    if (!editor) editor = createEditor($('#editor'), { onChange: onEdit, onRun: upload, onGutter: toggleBp });
    syncShown(b);
    const sn = snapshot(), e = entry(b);
    const code = e || rulesOf(b, sn).length ? codeOf(b, sn) : generate(b, { comps: comps(), A: sn.A, inspect: sn.inspect, rules: [], states: P.states });
    if (document.activeElement !== editor.el || (e && (e.auto || e.mode === 'visual'))) editor.value = code;
    renderCodeMode(); check(); logDirty = true; liveUi(true);
    syncVisual(b);
  }

  /* ---------- Blocs de code (Blockly, chargé à la demande) ---------- */
  const isVisual = b => { const e = b && entry(b); return !!e && e.mode === 'visual'; };
  function visCtx(b) { const sn = snapshot(); return visualContext(b, { comps: comps(), A: sn.A, inspect: sn.inspect }); }
  function visualUi() {
    if ($('#codeView')) return;
    $('#codeMode').insertAdjacentHTML('beforebegin', `<div class="seg mini codeView" id="codeView" role="group" aria-label="${tl('Façon de programmer')}"><button type="button" class="segBtn" id="viewCode" aria-pressed="true">${icon('code')}<span>${tl('Code')}</span></button><button type="button" class="segBtn" id="viewBlocks" aria-pressed="false" data-tip="${tl('Programmer en assemblant des blocs, sans écrire de code')}">${icon('puzzle')}<span>${tl('Blocs de code')}</span></button></div>`);
    $('#editor').insertAdjacentHTML('beforebegin', `<div class="visualHost" id="visualHost" hidden></div><div class="visBanner" id="visBanner" hidden>${icon('lock')}<span>${tl('Code généré par les blocs — lecture seule')}</span><button type="button" class="btn small" id="visToCode">${icon('code')}<span>${tl('Convertir en code')}</span></button></div>`);
    $('#viewBlocks').onclick = () => toBlocks();
    $('#viewCode').onclick = () => toCode();
    $('#visToCode').onclick = () => toCode();
  }
  /** Interface selon le mode de la carte affichée : blocs (code en lecture seule, règles masquées) ou code. */
  function syncVisual(b) {
    visualUi();
    const on = isVisual(b);
    $('#viewCode').setAttribute('aria-pressed', !on); $('#viewBlocks').setAttribute('aria-pressed', on);
    $('#visualHost').hidden = !on; $('#visBanner').hidden = !on;
    document.querySelectorAll('#pane-prog .rulesSec, #pane-prog .statesSec').forEach(el => { el.hidden = on; });
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
      const h = await openVisual(host, {
        json: e.blocks || emptyWorkspace(), ctx: visCtx(b),
        onChange: json => {
          e.blocks = json;
          const code = codeOf(b);
          if (board() === b && editor) { editor.value = code; check(); const m = visMeta.get(b.id); if (vis && vis.h) vis.h.warn(m ? m.warnings : []); }
          app.markDirty(); renderCodeMode(); liveUi(true);
        }
      });
      if (!vis || vis.token !== token) { h.dispose(); return; }
      vis.h = h; const m = visMeta.get(b.id); h.warn(m ? m.warnings : []);
      // Les blocs demandent de la place : l'inspecteur s'élargit (bouton « Agrandir », réversible).
      if (!$('.app').classList.contains('wide') && !wideAuto) { wideAuto = true; $('#progWide').click(); setTimeout(() => vis && vis.h && vis.h.resize(), 260); }
    } catch (err) { console.error(err); host.innerHTML = `<p class="visLoading err">${tl('Les blocs n’ont pas pu se charger : {0}', esc(err.message || err))}</p>`; }
  }
  function closeWorkspace() { if (vis && vis.h) vis.h.dispose(); vis = null; const host = $('#visualHost'); if (host) host.innerHTML = ''; }
  async function toBlocks() {
    const b = board(); if (!b || isVisual(b)) return;
    const e = ensure(b);
    if (!e.auto && e.code.trim() && !(await askConfirm(tl('Programmer avec des blocs'), tl('Le code de {0} sera remplacé par celui des blocs. Il reste récupérable avec Ctrl+Z dans l’éditeur avant de changer, ou en revenant au code plus tard (« Convertir en code »).', esc(b.name)), tl('Passer aux blocs')))) return;
    e.codeBefore = e.code; e.mode = 'visual'; e.auto = false; e.blocks = e.blocks || emptyWorkspace(); delete e.bps;
    app.markDirty(); render();
    app.status(tl('Blocs de code : glissez des blocs depuis les catégories de gauche dans « au démarrage » ou « en boucle ». Le code Arduino s’écrit en dessous.'), 'ok');
  }
  async function toCode() {
    const b = board(); if (!b || !isVisual(b)) return;
    if (!(await askConfirm(tl('Convertir en code'), tl('Le programme devient du code Arduino que vous pouvez modifier. Vos blocs restent enregistrés : vous pourrez y revenir, mais les modifications faites dans le code ne passeront pas dans les blocs.'), tl('Convertir')))) return;
    const e = ensure(b); e.code = codeOf(b); delete e.mode; e.auto = false;
    closeWorkspace(); app.markDirty(); render();
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
    if (e.mode === 'visual') return; // code en lecture seule : il vient des blocs
    if (e.auto && text !== e.code) { e.auto = false; app.status(tl('Code modifié à la main : les règles ne le réécrivent plus. « Régénérer » revient au code des règles.')); }
    shiftBps(b, e.code, text);
    e.code = text;
    app.markDirty(); renderCodeMode();
    clearTimeout(checkT); checkT = setTimeout(check, 350);
  }

  /* ---------- Règles : un arbre de conditions et d'actions ---------- */
  const modeOf = (r, hasSrc) => (r.src && r.op === 'follow' ? 'follow' : r.src || hasSrc ? 'cond' : 'always');
  /** Chaque action redevient cohérente avec sa place (« suit la mesure » n'existe que sous « fait varier »). */
  function fixTree(r, hasSrc = false) {
    const inner = hasSrc || !!r.src;
    for (const b of ['then', 'else']) for (const it of r[b]) {
      if (it.kind === 'rule') { fixTree(it, inner); continue; }
      const d = byId(it.comp); if (!d) continue;
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
    if (a.kind === 'text') return `<input type="text" ${attr} value="${esc(val ?? a.def)}" maxlength="21" aria-label="${tl('Texte affiché')}">`;
    return `<span class="num"><input type="number" ${attr} value="${esc(val ?? a.def)}" min="${a.min}" max="${a.max}" step="${a.step || 1}" aria-label="${tl('Réglage')}">${a.unit ? `<small>${esc(a.unit)}</small>` : ''}</span>`;
  }
  function condHtml(r, prof) {
    const s = r.src && byId(r.src.comp), sig = s && signalOf(s.type, r.src.sig, prof);
    const src = `<select data-f="src" aria-label="${tl('Déclencheur')}"><option value="">${tl('Toujours (à chaque tour de loop)')}</option>${comps().filter(isSensor).map(c => `<optgroup label="${esc(c.name)}">${Object.entries(SIGNALS[c.type]).map(([k, g]) => `<option value="${esc(c.id)}|${k}"${s === c && r.src.sig === k ? ' selected' : ''}>${esc(c.name)} · ${esc(g.kind === 'bool' ? (g.short || g.label).toLowerCase() : g.label)}</option>`).join('')}</optgroup>`).join('')}</select>`;
    let cond = '';
    if (sig && sig.kind === 'bool') cond = `<select data-f="v" aria-label="${tl('État')}"><option value="1"${r.v ? ' selected' : ''}>${esc(sig.label)}</option><option value="0"${r.v ? '' : ' selected'}>${esc(sig.neg)}</option></select>`;
    else if (sig) {
      cond = `<select data-f="op" aria-label="${tl('Comparaison')}">${Object.entries(OPS).map(([k, l]) => `<option value="${k}"${r.op === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      cond += r.op === 'follow'
        ? `<span class="range">de <input type="number" step="any" data-f="from0" value="${r.from[0]}" aria-label="${tl('Mesure minimale')}"> ${tl('à')} <input type="number" step="any" data-f="from1" value="${r.from[1]}" aria-label="${tl('Mesure maximale')}">${sig.unit ? `<small>${esc(sig.unit)}</small>` : ''}</span>`
        : `<span class="num"><input type="number" step="any" data-f="v" value="${r.v}" aria-label="${tl('Seuil')}">${sig.unit ? `<small>${esc(sig.unit)}</small>` : ''}</span>`;
    }
    return src + cond;
  }
  function actRow(it, mode) {
    const d = byId(it.comp);
    let html = `<select data-f="comp" aria-label="${tl('Effecteur')}"><option value="">${tl('— choisir —')}</option>${comps().filter(isActuator).map(c => `<option value="${esc(c.id)}"${d === c ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
    if (d) {
      const A = ACTIONS[d.type][it.act];
      html += `<select data-f="act" aria-label="${tl('Action')}">${actsFor(d.type, mode).map(([k, a]) => `<option value="${k}"${it.act === k ? ' selected' : ''}>${esc(a.label)}</option>`).join('')}</select>${argHtml(A, it.arg, 'arg')}`;
      if (A && A.follow && Array.isArray(it.arg)) html += `<span class="range">de <input type="number" step="any" data-f="out0" value="${it.arg[0]}" aria-label="${tl('Sortie minimale')}"> ${tl('à')} <input type="number" step="any" data-f="out1" value="${it.arg[1]}" aria-label="${tl('Sortie maximale')}"></span>`;
    }
    return `<div class="act" data-aid="${esc(it.id)}">${html}<button type="button" class="tb mini" data-del="act" aria-label="${tl('Retirer cette action')}">${icon('x')}</button></div>`;
  }
  function ruleCard(r, cx, hasSrc, top) {
    const mode = modeOf(r, hasSrc), inner = hasSrc || !!r.src;
    const branch = (b, label) => {
      const m = b === 'then' ? mode : 'cond', items = r[b].filter(it => mode !== 'follow' || it.kind === 'act');
      return `<div class="branch" data-branch="${b}"><em>${label}</em><div class="items">${items.map(it => (it.kind === 'act' ? actRow(it, m) : ruleCard(it, cx, inner, false))).join('')}</div>
        <div class="adds"><button type="button" class="add" data-add="act">${icon('plus')}action</button>${mode !== 'follow' ? `<button type="button" class="add" data-add="rule">${icon('plus')}condition${b === 'else' ? tl(' (sinon si)') : ''}</button>` : ''}</div></div>`;
    };
    const s = r.src && byId(r.src.comp), warn = [];
    if (r.src && !s) warn.push(tl('la mesure choisie a été retirée du montage'));
    else if (s && !cx.sn.inspect(s).board) warn.push(tl('{0} n’est relié à aucune carte', s.name));
    r.then.concat(r.else).forEach(it => { if (it.kind !== 'act') return; const d = byId(it.comp); if (it.comp && !d) warn.push(tl('un effecteur a été retiré du montage')); else if (d && !ruleBoard({ src: null, then: [it], else: [] }, cx.sn, true)) warn.push(tl('{0} n’est relié à aucune carte', d.name)); });
    const tag = top ? 'li' : 'div';
    return `<${tag} class="rule${top ? '' : ' nested'}" data-rid="${esc(r.id)}">
      <div class="rh"><span class="rn">${cx.nums.get(r.id)}</span><p title="${esc(ruleText(r, byId, cx.prof))}">${esc(condText(r, byId, cx.prof))}</p><button type="button" class="tb danger" data-del="rule" aria-label="${tl('Supprimer cette {0}', top ? tl('règle') : 'condition')}">${icon('trash')}</button></div>
      <div class="rrow"><em>${tl('Quand')}</em>${condHtml(r, cx.prof)}</div>
      ${branch('then', !r.src ? tl('Faire') : mode === 'follow' ? tl('Agit sur') : tl('Alors'))}
      ${r.src && mode !== 'follow' ? branch('else', tl('Sinon')) : ''}
      ${warn.length ? `<p class="rwarn">${tl('⚠ {0} : la règle ne s’applique pas tant que ce n’est pas réglé.', esc([...new Set(warn)].join(' · ')))}</p>` : ''}
    </${tag}>`;
  }
  function renderRules() {
    const b = board(); if (!b) return;
    const sn = snapshot(), list = rulesOf(b, sn), cx = { sn, prof: boardOf(b), nums: numberRules(list) };
    $('#ruleCount').textContent = list.length || '';
    $('#rules').innerHTML = list.map(r => ruleCard(r, cx, false, true)).join('');
    $('#rulesHint').hidden = !!list.length;
    $('#ruleAdd').disabled = !comps().some(isActuator);
    renderStates(sn);
  }
  /** Règles ou états changés : code régénéré, et relancé tout de suite si la simulation tourne. */
  function rulesChanged() {
    P.rules.forEach(r => fixTree(r));
    const sn = snapshot();
    for (const b of boards()) {
      if (!P.rules.some(r => ruleBoard(r, sn) === b) && !Object.keys(P.states).some(id => { const c = byId(id); return c && sn.inspect(c).board === b; })) continue;
      const e = ensure(b);
      if (e.auto && app.simOn()) launch(b, sn);
    }
    app.markDirty(); renderRules();
    const b = board();
    if (b && editor) { const e = entry(b); if (!e || e.auto) { editor.value = codeOf(b, sn); check(); } }
    renderCodeMode(); app.refreshSel();
  }
  const flash = sel => requestAnimationFrame(() => { const el = $(sel); if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); const f = el.querySelector('select'); if (f) f.focus({ preventScroll: true }); });
  function onRuleField(el) {
    const prof = board() && boardOf(board()), f = el.dataset.f, v = el.value;
    const aEl = el.closest('[data-aid]');
    if (aEl) {
      const hit = findById(P.rules, aEl.dataset.aid); if (!hit) return;
      const it = hit.it, d = byId(it.comp);
      if (f === 'comp') { it.comp = v || null; it.act = null; it.arg = null; }
      if (f === 'act' && d) { it.act = v; it.arg = defArg(d.type, v); }
      if (f === 'arg') it.arg = el.type === 'number' ? +v || 0 : v;
      if ((f === 'out0' || f === 'out1') && Array.isArray(it.arg)) it.arg[f === 'out0' ? 0 : 1] = +v || 0;
    } else {
      const rEl = el.closest('[data-rid]'), hit = rEl && findById(P.rules, rEl.dataset.rid); if (!hit) return;
      const r = hit.it;
      if (f === 'src') {
        if (!v) r.src = null;
        else {
          const [id, key] = v.split('|'), c = byId(id), sg = c && signalOf(c.type, key, prof);
          if (sg) { r.src = { comp: id, sig: key }; if (sg.kind === 'bool') { r.op = '=='; r.v = 1; } else { if (r.op === '==') r.op = '>'; r.v = sg.def; r.from = [...(sg.range || [0, 100])]; } }
        }
      }
      if (f === 'op') r.op = v;
      if (f === 'v') r.v = +v || 0;
      if (f === 'from0' || f === 'from1') r.from[f === 'from0' ? 0 : 1] = +v || 0;
    }
    rulesChanged();
    const again = el.closest('[data-aid]') ? $(`[data-aid="${el.closest('[data-aid]').dataset.aid}"] [data-f="${f}"]`) : null;
    if (again && el.tagName !== 'SELECT') again.focus();
  }
  /** + action / + condition dans une branche. */
  function addItem(btn) {
    const rEl = btn.closest('[data-rid]'), hit = rEl && findById(P.rules, rEl.dataset.rid); if (!hit) return;
    const r = hit.it, b = btn.closest('[data-branch]').dataset.branch, sn = snapshot(), home = board();
    const onHome = c => !home || sn.inspect(c).board === home || isMotor(c);
    const lastAct = [...r[b]].reverse().find(it => it.kind === 'act' && byId(it.comp)) || actsOf(r).find(it => byId(it.comp));
    const eff = (lastAct && byId(lastAct.comp)) || comps().find(c => isActuator(c) && onHome(c)) || comps().find(isActuator) || null;
    let item;
    if (btn.dataset.add === 'act') item = actItem(eff, null);
    else {
      const sensors = comps().filter(c => isSensor(c) && onHome(c));
      const src = sensors.find(c => !r.src || c.id !== r.src.comp) || sensors[0] || null;
      item = newRule(src, eff, home ? boardOf(home) : null);
    }
    r[b].push(item);
    rulesChanged();
    flash(`[data-${item.kind === 'act' ? 'aid' : 'rid'}="${item.id}"]`);
  }
  function removeItem(btn) {
    const el = btn.dataset.del === 'act' ? btn.closest('[data-aid]') : btn.closest('[data-rid]');
    const hit = el && findById(P.rules, el.dataset.aid || el.dataset.rid); if (!hit) return;
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
    if (flashIt) flash(`#rules [data-rid="${r.id}"]`);
    return r;
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
    const vals = st.values || {}, cur = f => (f.env ? ENV[f.key] : c.inp ? c.inp[f.key] : '');
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
      if (f.env) ENV[k] = val; else if (c.inp) c.inp[k] = val;
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
      ${mine.length ? `<ul>${mine.map(r => `<li data-rule="${esc(r.id)}" title="${tl('Modifier cette règle')}">${esc(ruleText(r, byId, prof))}</li>`).join('')}</ul>` : `<p class="note">${isActuator(c) ? tl('Dites ce que doit faire {0} : s’allumer quand on appuie sur un bouton, tourner selon un potentiomètre…', esc(c.name)) : tl('Dites ce qui doit se passer selon {0} : allumer une LED, déclencher un relais…', esc(c.name))}</p>`}
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
    app.status(tl('Règle ajoutée : {0} Réglez-la dans l’onglet Code.', ruleText(P.rules[P.rules.length - 1], byId, boardOf(board() || c))), 'ok');
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
    const b = board(); if (!b || !n) return;
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
    const b = board(); if (!b) return;
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
    const st = !b || !rt ? 'off' : rt.state === 'paused' ? 'paused' : rt.state === 'run' ? 'run' : 'off', bar = $('#dbgBar');
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
    if (serialView === 'mon') { logDirty = true; liveUi(true); } else if (plot) { const b = board(); if (b) plot.select(b.id); plot.kick(); }
  }
  function bindPlotter() {
    plot = createPlotter({
      canvas: $('#plotCv'), legend: $('#plotLegend'), win: $('#plotWin'), hold: $('#plotHold'), clear: $('#plotClear'), csv: $('#plotCsv'),
      fps: Q.simFps, light: LIGHT,
      shown: () => serialView === 'plot' && !$('#pane-prog').hidden && !$('#progMain').hidden,
      clock: id => { const rt = rts.get(id); return rt ? rt.clock() : null; },
      name: id => { const b = byId(id); return b ? b.name : id; },
      save: (blob, name) => saveFile(blob, name, tl('Mesures (tableur)'), 'csv').catch(e => app.status(tl('Enregistrement impossible : ') + (e.message || e), 'err'))
    });
    for (const [id, rt] of rts) rt.setSerialTap((text, vt) => plot.feed(id, text, vt));
    $('#serialMon').onclick = () => setSerialView('mon');
    $('#serialPlot').onclick = () => setSerialView('plot');
    let v = 'mon'; try { v = localStorage.getItem('jollof-serial-view') || 'mon'; } catch (e) { /* stockage indisponible */ }
    setSerialView(v, true);
  }

  /* ---------- Liaisons ---------- */
  function bind() {
    $('#progBoard').onchange = e => { cur = e.target.value; render(); };
    $('#progRun').onclick = upload;
    if ($('#progEngine')) $('#progEngine').onchange = e => {
      const b = board(); if (!b) return;
      const en = ensure(b);
      if (e.target.value === 'firmware') en.engine = 'firmware'; else delete en.engine;
      app.markDirty();
      check();
      if (app.simOn()) { launch(b); render(); }
    };
    $('#ruleAdd').onclick = () => { const sn = snapshot(), b = board(); const dst = comps().find(x => isActuator(x) && (!b || sn.inspect(x).board === b)) || comps().find(isActuator); addRule(null, dst || null); };
    $('#rules').addEventListener('change', e => { if (e.target.dataset.f) onRuleField(e.target); });
    $('#rules').addEventListener('click', e => {
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
    $('#diag').onclick = e => { const li = e.target.closest('li[data-line]'); if (li && +li.dataset.line && editor) editor.goLine(+li.dataset.line, +li.dataset.col || 1); };
    $('#serialClear').onclick = () => { const b = board(); if (b) logs.set(b.id, ''); logDirty = true; liveUi(true); };
    $('#serialForm').onsubmit = e => {
      e.preventDefault();
      const b = board(), rt = b && rts.get(b.id), inp = $('#serialInput');
      if (!rt || (rt.state !== 'run' && rt.state !== 'paused')) { app.status(tl('Le programme ne tourne pas : téléversez-le d’abord.'), 'warn'); return; }
      rt.send(inp.value + '\n'); inp.value = '';
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
    bindPlotter();
  }

  return {
    rts, bind, render, frame, startAll, stopAll, upload, behaviorHtml, onBehavior,
    /** Programme de la carte affichée dans l'onglet Code (pour un module : téléversement réel…). */
    current() { const b = board(); if (!b) return null; const e = entry(b); return { board: b, kind: boardKind(b), label: boardOf(b).label, code: editor && document.activeElement === editor.el ? editor.value : e ? codeOf(b) : editor ? editor.value : codeOf(b) }; },
    /** Programme d'une carte tel qu'il tournerait, pour le vérificateur ('' sans programme). */
    programOf(b) {
      const sn = snapshot(); if (!hasProgram(b, sn)) return '';
      const e = entry(b);
      return b.id === cur && editor && e && !e.auto && e.mode !== 'visual' ? editor.value : codeOf(b, sn);
    },
    /** Programme produit par les règles (pas écrit par l'élève) : le vérificateur ne lui reproche pas un composant inutilisé. */
    isAuto(b) { const e = entry(b); return !e || (!!e.auto && e.mode !== 'visual'); },
    /** Carte en mode fidèle : son programme est du vrai C++ jugé par arduino-cli, pas par l'interpréteur. */
    isFirmware(b) { return engineOf(b) === 'firmware'; },
    /** Montre le programme d'une carte à une ligne (diagnostic cliqué). */
    showLine(b, line, col) { cur = b.id; ensure(b); app.setTab('prog'); render(); if (editor) editor.goLine(line, col); },
    /** Simulation lancée : capteurs et entrées repartent de leur valeur par défaut. */
    applyInits() { if (comps().map(applyInit).some(Boolean)) app.envChanged(); },
    onStateField(el) { if (el.dataset.sf) onStateField(el); },
    get data() { return JSON.parse(JSON.stringify(P)); },
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
      rts.clear(); logs.clear(); diag.clear(); uploaded.clear(); cur = null; shownId = null; pendingPause = null; if (plot) plot.reset();
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
          if (codeOf(b, sn) !== uploaded.get(b.id)) launch(b, sn);
        }
      }
      if (vis && vis.h) { const b = comps().find(c => c.id === vis.boardId); if (b) vis.h.refreshToolbox(visCtx(b)); }
      if (!$('#pane-prog').hidden) render();
    }
  };
}
