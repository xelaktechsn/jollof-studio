// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérificateur de montage et de programme, sur le modèle de rustc : il ne laisse rien partir vers le monde réel
// (carte branchée, guide de montage, devoir rendu) tant qu'une erreur reste, et il le prouve dans TOUS les états
// atteignables du montage (boutons, relais, potentiomètres, capteurs, broches commandées par le programme).
// Trois passes : structure du câblage (circuit.js, faults.js), programme ↔ montage (program.js), puis calcul du
// circuit dans chaque état (dc.js) contre les valeurs nominales (limits.js). Chaque diagnostic garde un code stable
// (codes.js), sa place, l'état qui le déclenche (contre-exemple), une note et une aide.
// Pur : se teste sous Node (node --test src/check/check.test.mjs).
import { analyze, inspect, pid } from '../sim/circuit.js';
import { collectFaults } from '../sim/faults.js';
import { solveDC } from '../sim/dc.js';
import { boardOf, kindOf, base, SOURCES, DERIVED } from '../sim/boards.js';
import { partOf, MOTORS, NPNS, COILS } from '../sim/parts.js';
import { driveOf } from '../sim/drive.js';
import { compile } from '../prog/lang.js';
import { BOARD_CONSTS, isEsp32 } from '../prog/api.js';
import { pinMap } from '../prog/runtime.js';
import { tl } from '../i18n/index.js';
import { CODES, BY_KEY } from './codes.js';
import { EXPLAIN } from './explain.js';
import { pinFacts, pinRole } from './program.js';
import { pyPinFacts } from './pyfacts.js';
import { stateVars, assignments, stateText, sensorOutputs, MAX_STATES } from './states.js';
import * as LIM from './limits.js';
import { OPAMPS } from '../sim/analog-parts.js';
import { isResistor, pkgLed, pkgLimit, pkgI2c } from '../sim/pkgparts.js';
import { i2cAddress } from '../sim/pkgbus.js';

/** Famille de carte pour le compilateur (même règle que prog/panel.js). */
export const boardKind = kindOf;
const BUS = new Set(['sda', 'scl', 'sck', 'mosi', 'miso', 'ss', 'rx', 'tx']);
// Broches qu'un module pilote lui-même (sortie d'un capteur, écho d'un sonar…) : un nœud qui en contient une n'est jamais en l'air.
const DRIVEN = new Set(['in', 'adc', 'irq', 'io', 'tx', 'miso', 'sda']);
// Un contrôle fait dans tous les états qui redit une erreur de câblage déjà signalée : on garde la première, plus claire.
const COVERED = { J0103: ['J0101', 'J0102', 'J0110'], J0306: ['J0106'], J0302: ['J0201', 'J0202', 'J0501'], J0301: ['J0401'] };
const isLed = c => /^led-(red|green|blue|yellow|white)$/.test(c.type);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * proj : { comps, wires, programs: Map id de carte → texte du programme, auto: Set des cartes dont le programme vient
 *         des règles (optionnel), firmware: Set des cartes en mode fidèle (optionnel), allow: [{ code, comp, reason }] }.
 * opts : { dist(a, b) (suggestions de câblage), max (états au plus) }.
 * Rend { diags: [...], errors, warnings, accepted, states, total, proven, dynamic, ms }.
 */
export function checkProject(proj, opts = {}) {
  const it = run(proj, opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
/** Même vérification, découpée en tranches (l'interface ne se fige jamais) ; signal.aborted l'interrompt. */
export async function checkProjectAsync(proj, opts = {}, signal = {}) {
  const it = run(proj, opts);
  let r = it.next(), t = now();
  while (!r.done) {
    if (signal.aborted) return null;
    if (now() - t > (opts.slice || 12)) { await new Promise(res => setTimeout(res, 0)); t = now(); if (signal.aborted) return null; }
    r = it.next();
  }
  return r.value;
}

function* run(proj, opts) {
  const t0 = now(), comps = proj.comps.filter(c => c && c.pins), wires = proj.wires || [];
  const A = analyze(comps, wires, { open: true }), out = new Map();
  // Reliée à un autre composant (les liaisons internes d'une carte, A4 = SDA, ne comptent pas).
  const wired = r => A.members(r).some(m => m.comp !== r.comp);
  const name = r => `${r.comp.name} ${r.key}`;
  const boards = comps.filter(c => boardOf(c));
  const boardFor = c => { for (const k in c.pins) { const g = A.wnet({ comp: c, key: k }).gpio[0]; if (g) return g.comp; } return boards[0] || null; };
  /** Ajoute (ou complète) un diagnostic ; même code au même endroit : un seul, le pire niveau, le premier contre-exemple. */
  const put = (code, level, loc, m, extra = {}, w = 1) => {
    if (COVERED[code] && loc.comp) {
      for (const d of out.values()) if (d.structural && d.level === 'error' && COVERED[code].includes(d.code) && (d.loc.comp === loc.comp || (d.loc.pins || []).some(p => p.comp === loc.comp))) return null;
    }
    const key = `${code}|${loc.comp ? loc.comp.id : ''}|${loc.key || ''}|${loc.board ? loc.board.id : ''}|${loc.line || ''}`;
    const old = out.get(key);
    if (old) {
      old.states += w;
      if (level === 'error' && old.level !== 'error') { if (m) m.soft = false; Object.assign(old, { level, m, ...extra }); old.title = titleOf(code, m, extra.title); old.state = null; }
      if (m && m.value != null && old.m && Math.abs(m.value) > Math.abs(old.m.value)) old.m.value = m.value;
      return old;
    }
    if (m && m.limit != null && level === 'warning') m.soft = true; // limite conseillée, pas maximale
    const d = { key, code, level, loc, m: m || {}, states: w, ...extra };
    d.title = titleOf(code, m, extra.title);
    out.set(key, d);
    return d;
  };

  /* ---------- 1. Structure du câblage : les règles de circuit.js et faults.js, avec leur numéro ---------- */
  const faults = collectFaults(comps, wires, A, { dist: opts.dist || (() => 0), boardFor });
  for (const f of faults) {
    const code = BY_KEY[f.code]; if (!code) continue;
    const level = f.level === 'err' && !f.missing ? 'error' : 'warning';
    put(code, level, { comp: f.comp || (f.pins[0] && f.pins[0].comp), key: f.pins[0] && f.pins[0].key, pins: [...f.pins, ...(f.culprits || [])] }, null,
      { title: f.title, where: f.where, note: f.why, help: f.fix, fault: f, structural: true });
  }

  // Broches lues au démarrage (boards.js strap) tirées au mauvais niveau : une résistance vers l'alimentation ou la masse,
  // ou un module dont la sortie est tirée au niveau haut au repos (I2C, DHT, récepteur IR…).
  const idleHigh = m => { const sp = partOf(m.comp), q = sp && sp.pins && sp.pins.find(x => x.pin === m.key); return !!(q && q.kind === 'io' && (q.idle === 1 || q.need === 'sda' || q.need === 'scl')); };
  for (const b of boards) {
    const prof = boardOf(b);
    for (const [k, want] of Object.entries(prof.strap || {})) {
      if (!b.pins[k] || !wired({ comp: b, key: k })) continue;
      const r = { comp: b, key: k }, w = A.wnet(r), high = w.src.length > 0 || A.wmembers(r).some(m => m.comp !== b && idleHigh(m)), low = w.gnd.length > 0;
      if ((want === 0 && high) || (want === 1 && low && !high)) put('J0903', 'warning', { comp: b, key: k, pins: [r] }, { name: name(r), high: want === 0 });
    }
  }
  // Modules I2C d'une même carte à la même adresse.
  const ADDR = { oled: () => 0x3c, lcd1602: () => 0x27, mpu6050: c => (c.pins.AD0 && A.net({ comp: c, key: 'AD0' }).src.length ? 0x69 : 0x68),
    bmp280: c => (A.net({ comp: c, key: 'SDO' }).gnd.length ? 0x76 : A.net({ comp: c, key: 'SDO' }).src.length ? 0x77 : null),
    bme280: c => (A.net({ comp: c, key: 'SDO' }).gnd.length ? 0x76 : A.net({ comp: c, key: 'SDO' }).src.length ? 0x77 : null),
    bh1750: c => (A.net({ comp: c, key: 'ADDR' }).src.length ? 0x5c : 0x23) };
  const onBus = new Map();
  for (const c of comps) {
    // Module I2C en paquet : son adresse déclarée (l'autre si sa broche d'adresse reçoit l'alimentation).
    const I = pkgI2c(c.type);
    const f = ADDR[c.type] || (I && (cc => i2cAddress(I, !!I.addressPin && A.net({ comp: cc, key: I.addressPin }).src.length > 0))), spec = f && partOf(c); if (!spec) continue;
    const sda = (spec.pins || []).find(p => p.need === 'sda'), ins = inspect(c, A, spec), addr = f(c);
    if (!ins.board || !sda || !ins.io[sda.pin] || addr == null) continue;
    const key = `${ins.board.id}|${addr}`, first = onBus.get(key);
    if (first) put('J0610', 'error', { comp: c, key: 'SDA', pins: [{ comp: c, key: 'SDA' }, { comp: first, key: 'SDA' }] }, { a: first.name, b: c.name, addr: addr.toString(16).toUpperCase() });
    else onBus.set(key, c);
  }

  /* ---------- 2. Programmes : compilation (codes J1xxx), broches utilisées ---------- */
  const facts = new Map();
  for (const b of boards) {
    const code = proj.programs && proj.programs.get(b.id);
    if (!code || !code.trim()) continue;
    const kind = boardKind(b), prof = boardOf(b), firmware = !!(proj.firmware && proj.firmware.has(b.id));
    // Mode fidèle : le vrai C++ est jugé par arduino-cli, pas par l'interpréteur ; ses erreurs ne comptent pas ici.
    if (!firmware) {
      const res = compile(code, { board: kind });
      for (const e of res.errors) put(e.code || 'J1199', 'error', { board: b, line: e.line, col: e.col, len: e.len || 1 }, null, { title: e.msg, help: e.help || null, code: e.code || 'J1199' });
      for (const w of res.warnings || []) put(w.code || 'J1109', 'warning', { board: b, line: w.line, col: w.col, len: w.len || 1 }, null, { title: w.msg });
    }
    let f = pinFacts(code, kind, prof);
    // Programme que l'analyse ne sait pas lire (C++ complet du mode fidèle) : preuve prudente, toute broche reliée
    // peut être une sortie à LOW ou à HIGH.
    // MicroPython : ses broches lues dans le texte Python quand elles sont écrites en clair (pyfacts.js).
    if (!f.ok && firmware) f = pyPinFacts(code, prof) || { ok: true, pins: new Map(), dynamic: true, uses: [] };
    if (!f.ok) continue;
    facts.set(b, f);
    // Broche inexistante sur la carte, PWM ou ADC absents, digitalWrite sans pinMode.
    for (const u of f.uses) if (u.key === null && !u.dyn) put('J0609', 'error', { board: b, line: u.line, col: u.col, len: 1 }, { name: String(u.value), b: b.name });
    const led = pinMap(prof, kind).get((BOARD_CONSTS[kind] || {}).LED_BUILTIN); // LED de la carte : la commander seule est normal
    for (const [k, pf] of f.pins) {
      const g = prof.gpio[k], loc = { comp: b, key: k, board: b, line: pf.at[0].line, col: pf.at[0].col };
      if (!g) continue;
      if (pf.writes.has('pwm') && !g.caps.has('pwm') && !isEsp32(kind)) put('J0603', 'error', loc, { name: name({ comp: b, key: k }) });
      if (pf.reads.has('a') && !g.caps.has('adc')) put('J0604', 'error', loc, { name: name({ comp: b, key: k }) });
      if (pf.writes.has('d') && !pf.modes.has('out') && !pf.writes.has('pwm') && !pf.writes.has('servo') && !pf.writes.has('tone')) put('J0607', 'warning', loc, { name: name({ comp: b, key: k }) });
      if (pinRole(pf) === 'out' && !wired({ comp: b, key: k }) && k !== led) put('J0605', 'warning', loc, { name: name({ comp: b, key: k }) });
    }
  }
  // Deux sorties sur le même nœud (comme deux emprunts mutables), ou une sortie contre celle d'un capteur.
  const outsByNet = new Map();
  for (const [b, f] of facts) for (const [k, pf] of f.pins) {
    if (pinRole(pf) !== 'out') continue;
    const r = { comp: b, key: k }, m = A.members(r);
    if (!outsByNet.has(m)) outsByNet.set(m, []);
    outsByNet.get(m).push(r);
    const sensor = m.find(x => x.comp !== b && sensorOutputs(x.comp) && sensorOutputs(x.comp)[x.key]);
    if (sensor) put('J0608', 'error', { comp: b, key: k, pins: [r, sensor] }, { name: name(r), b: name(sensor) });
  }
  for (const list of outsByNet.values()) if (list.length > 1) put('J0601', 'error', { comp: list[0].comp, key: list[0].key, pins: list }, { a: name(list[0]), b: name(list[1]) });
  // Composant relié à la carte mais jamais commandé ni lu (programme lisible seulement).
  for (const c of comps) {
    if (boardOf(c) || /^breadboard/.test(c.type) || isResistor(c.type)) continue;
    const spec = partOf(c); if (!spec || !spec.pins) continue;
    const ins = inspect(c, A, spec);
    for (const [k, g] of Object.entries(ins.io)) {
      const sp = spec.pins.find(p => p.pin === k), f = facts.get(g.comp);
      // Programme produit par les règles : un composant sans règle n'est pas une faute de l'élève.
      if (!f || f.dynamic || (sp && BUS.has(sp.need)) || f.pins.has(g.key) || (proj.auto && proj.auto.has(g.comp.id))) continue;
      put('J0606', 'warning', { comp: c, key: k, pins: [{ comp: c, key: k }] }, { name: c.name });
    }
  }
  // Moteur commandé par un transistor sans diode de roue libre (la bobine renvoie une pointe de tension).
  for (const c of comps) {
    const ind = MOTORS[c.type] || COILS[c.type]; // moteur ou bobine d'électrovanne : une inductance
    if (!ind || c.type === 'fan') continue;
    const d = driveOf(c, A); if (!d || d.kind !== 'npn') continue;
    const [p, m] = [ind.plus, ind.minus], np = A.members({ comp: c, key: p }), nm = A.members({ comp: c, key: m });
    const diode = comps.some(x => x.type === 'diode' && ((np.some(y => y.comp === x && y.key === 'K') && nm.some(y => y.comp === x && y.key === 'A'))));
    if (!diode) put('J0901', 'warning', { comp: c, key: m, pins: [{ comp: c, key: m }] }, { name: c.name });
  }
  yield;

  /* ---------- 3. Tous les états atteignables : calcul du circuit et valeurs nominales ---------- */
  const supplyOf = c => { const k = ['VCC', '+5V', '3', 'VDD'].find(x => c.pins[x]); const s = k ? A.net({ comp: c, key: k }).src : []; return s.length ? Math.max(...s.map(x => x.v)) : 5; };
  const { vars, fixed } = stateVars(comps, facts, wired, supplyOf);
  const touched = ['pressed', 'sw', 'pos'];
  const saveComps = comps.map(c => ({ c, inp: { ...(c.inp || {}) }, relayOn: c.relayOn, servoBusy: c.servoBusy, stepBusy: c.stepBusy }));
  const restore = () => { for (const s of saveComps) { if (s.c.inp) for (const k of touched) if (k in s.inp) s.c.inp[k] = s.inp[k]; else if (s.c.inp) delete s.c.inp[k]; s.c.relayOn = s.relayOn; s.c.servoBusy = s.servoBusy; s.c.stepBusy = s.stepBusy; } };
  const { probes, budgets } = probeList(comps, A, facts);
  // Sous-montages indépendants (regionsOf) : chacun est essayé dans toutes ses combinaisons, les autres au repos. Le
  // nombre de calculs est la somme des combinaisons de chaque sous-montage, et non leur produit ; la preuve couvre
  // pourtant le produit, puisqu'un sous-montage ne voit pas l'état des autres. opts.monolithic : tout d'un bloc.
  const G = opts.monolithic ? null : regionsOf(comps, A);
  const regOfComp = c => (G ? G.comp(c) : 'all'), regOfPin = (c, k) => (G ? G.pin(c, k) : 'all');
  const varReg = vars.map(v => (v.pin ? regOfPin(v.comp, v.key) : regOfComp(v.comp)));
  const groups = new Map();
  varReg.forEach((r, i) => { if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  const spaceOf = new Map([...groups].map(([r, idx]) => [r, idx.reduce((t, i) => t * vars[i].values.length, 1)]));
  const space = vars.reduce((t, v) => t * v.values.length, 1);
  // Poids d'un constat : nombre d'états du montage complet où il se produit (son sous-montage dans cet état, les autres quelconques).
  const weightOf = r => (r != null && spaceOf.has(r) ? space / spaceOf.get(r) : space);
  for (const p of probes) p.region = p.pin ? regOfPin(p.comp, p.pin) : regOfComp(p.comp);
  for (const b of budgets) for (const x of b.parts) x.region = x.pin ? regOfPin(b.comp, x.pin) : regOfComp(x.comp);
  const ctx = cx => ({ prof: boardOf, pinState: (c, k) => { const m = cx.pins.get(c); return (m && m.get(k)) || null; }, sensorVolts: (c, k) => (cx.sensors.has(`${c.id}|${k}`) ? cx.sensors.get(`${c.id}|${k}`) : null) });
  const solve = a => {
    const cx = { pins: new Map(), sensors: new Map() };
    let dc;
    try {
      fixed.forEach(f => f(cx));
      vars.forEach((v, i) => v.apply(v.values[a[i]], cx));
      dc = solveDC(comps, A, ctx(cx));
    } finally { restore(); }
    return dc && dc.ok ? dc : null;
  };
  // Budgets partagés (toutes les GPIO, broches 5V et 3V3) : la pire contribution de chaque sous-montage, et l'état qui la donne.
  const worst = budgets.map(() => new Map());
  const measure = (dc, a, only) => budgets.forEach((b, bi) => {
    const sum = new Map();
    for (const x of b.parts) if (only == null || x.region === only) sum.set(x.region, (sum.get(x.region) || 0) + x.read(dc));
    for (const [r, v] of sum) { const cur = worst[bi].get(r); if (!cur || Math.max(0, v) > cur.v) worst[bi].set(r, { v: Math.max(0, v), a }); }
  });
  const run1 = (a, only) => {
    const dc = solve(a); if (!dc) return;
    let st = null;
    const text = () => (st == null ? (st = stateText(vars, a)) : st);
    for (const p of probes) {
      if (only != null && p.region !== only) continue;
      const w = weightOf(p.region);
      p.fn(dc, (code, level, loc, m) => { const d = put(code, level, loc, m, {}, w); if (d && !d.state) d.state = text(); });
    }
    measure(dc, a, only);
  };
  let done = 0, complete = true;
  const rest = vars.map(() => 0);
  run1(rest, null); done++;
  for (const [r, idx] of groups) {
    const sub = idx.map(i => vars[i]), { list, complete: ok } = assignments(sub, opts.max || MAX_STATES);
    if (!ok) complete = false;
    for (const s of list) {
      if (s.every(x => x === 0)) continue; // le repos est déjà calculé
      const a = rest.slice(); idx.forEach((i, j) => { a[i] = s[j]; });
      run1(a, r); done++;
      if (done % 64 === 0) yield;
    }
  }
  // Pire combinaison des budgets : chaque sous-montage dans son pire état (atteignable, puisqu'ils sont indépendants).
  budgets.forEach((b, bi) => {
    let total = 0; const a = rest.slice();
    for (const [r, x] of worst[bi]) { total += x.v; (groups.get(r) || []).forEach(i => { a[i] = x.a[i]; }); }
    b.judge(total, (code, level, loc, m) => { const d = put(code, level, loc, m); if (d && !d.state) d.state = stateText(vars, a); });
  });
  const list = { length: complete ? space : done };

  /* ---------- 4. Exceptions acceptées (avertissements seulement), tri ---------- */
  const allow = proj.allow || [];
  const diags = [...out.values()];
  for (const d of diags) {
    d.total = space;
    const ex = EXPLAIN[d.code];
    if (ex) { if (!d.note) d.note = ex.why; if (!d.help) d.help = ex.fix; }
    const a = d.level === 'warning' && allow.find(x => x.code === d.code && (!x.comp || (d.loc.comp && d.loc.comp.id === x.comp)));
    d.accepted = a ? a.reason || '' : null;
  }
  diags.sort((x, y) => (x.level === y.level ? (x.accepted == null) - (y.accepted == null) || x.code.localeCompare(y.code) : x.level === 'error' ? -1 : 1));
  const errors = diags.filter(d => d.level === 'error').length, warnings = diags.filter(d => d.level === 'warning' && d.accepted == null).length;
  const dynamic = [...facts.values()].some(f => f.dynamic);
  return { diags, errors, warnings, accepted: diags.filter(d => d.accepted != null).length, states: list.length, space, solved: done, regions: groups.size, proven: complete, dynamic, ms: Math.round(now() - t0) };
}

function titleOf(code, m, given) {
  if (given) return given;
  const c = CODES[code];
  return c && c.title ? c.title(m || {}) : code;
}

/**
 * Contrôles à faire dans chaque état : une fonction (dc, report) par composant ou broche concernés.
 * report(code, level, loc, m) ; m : { name, value, limit, … } pour le titre.
 */
function probeList(comps, A, facts) {
  const P = [], B = [], nm = (c, k) => (k ? `${c.name} ${k}` : c.name);
  const lim = (v, l, onMax, onWarn) => { const a = Math.abs(v); if (a > l.max) onMax(); else if (l.warn != null && a > l.warn) onWarn(); };
  for (const c of comps) {
    const t = c.type, spec = partOf(c);
    // Chaque contrôle porte son composant (et sa broche pour une carte) : son sous-montage dit dans quels états le faire.
    const P0 = P.length;
    if (isLed(c)) P.push((dc, R) => { const l = dc.leds.get(c); if (!l) return; lim(l.mA, LIM.LED, () => R('J0301', 'error', { comp: c, key: 'A' }, { name: c.name, value: l.mA, limit: LIM.LED.max }), () => R('J0301', 'warning', { comp: c, key: 'A' }, { name: c.name, value: l.mA, limit: LIM.LED.warn })); });
    if (t === 'led-rgb' || t === '7seg') P.push((dc, R) => { const l = dc.leds.get(c); if (!l || !l.ch) return; for (const [k, x] of Object.entries(l.ch)) lim(x.mA, LIM.LED, () => R('J0301', 'error', { comp: c, key: k }, { name: nm(c, k), value: x.mA, limit: LIM.LED.max }), () => R('J0301', 'warning', { comp: c, key: k }, { name: nm(c, k), value: x.mA, limit: LIM.LED.warn })); });
    // Résistance (bibliothèque ou paquet .jpart, qui peut citer sa propre limite de puissance).
    if (isResistor(t)) { const PR = pkgLimit(t, 'power') || LIM.POWER.res; P.push((dc, R) => { const a = dc.across(c); if (!a || a.v == null) return; const w = Math.abs(a.v * a.mA) / 1000; lim(w, PR, () => R('J0304', 'error', { comp: c }, { name: c.name, value: w, limit: PR.max }), () => R('J0304', 'warning', { comp: c }, { name: c.name, value: w, limit: PR.warn })); }); }
    // LED en paquet : courant limité comme une LED de la bibliothèque (ou par la limite citée dans le paquet).
    const pl = pkgLed(t), PL = pl && (pkgLimit(t, 'current') || LIM.LED);
    if (pl) P.push((dc, R) => { const l = dc.leds.get(c); if (!l) return; lim(l.mA, PL, () => R('J0301', 'error', { comp: c, key: pl.anode }, { name: c.name, value: l.mA, limit: PL.max }), () => R('J0301', 'warning', { comp: c, key: pl.anode }, { name: c.name, value: l.mA, limit: PL.warn })); });
    if (t === 'pot') P.push((dc, R) => {
      const inj = dc.injections(), v = k => dc.volts({ comp: c, key: k });
      const parts = [['1', 'W'], ['3', 'W']].map(([e, w]) => { const i = inj.get(pid(c, e)) || 0, a = v(e), b = v(w); return a == null || b == null ? 0 : Math.abs((a - b) * i) / 1000; });
      const w = Math.max(...parts); lim(w, LIM.POWER.pot, () => R('J0314', 'error', { comp: c }, { name: c.name, value: w, limit: LIM.POWER.pot.max }), () => {});
    });
    if (t === 'speaker') P.push((dc, R) => { const a = dc.across(c); if (!a || a.v == null) return; const w = Math.abs(a.v * a.mA) / 1000; lim(w, LIM.POWER.speaker, () => R('J0313', 'error', { comp: c }, { name: c.name, value: w, limit: LIM.POWER.speaker.max }), () => {}); });
    if (t === 'buzzer') P.push((dc, R) => { const a = dc.across(c); if (!a || a.v == null) return; lim(a.v, LIM.BUZZER_V, () => R('J0315', 'error', { comp: c }, { name: c.name, value: a.v, limit: LIM.BUZZER_V.max }), () => R('J0315', 'warning', { comp: c }, { name: c.name, value: a.v, limit: LIM.BUZZER_V.warn })); });
    if (NPNS[t]) {
      // Courant de collecteur, puis puissance Vce × Ic : un transistor mal saturé chauffe au lieu de commuter.
      const L = NPNS[t].ic, PW = { warn: NPNS[t].p * 0.8 / 1000, max: NPNS[t].p / 1000 };
      P.push((dc, R) => {
        const a = dc.across(c); if (!a || !a.extra) return;
        lim(a.extra.ic, L, () => R('J0305', 'error', { comp: c, key: 'C' }, { name: c.name, value: a.extra.ic, limit: L.max }), () => R('J0305', 'warning', { comp: c, key: 'C' }, { name: c.name, value: a.extra.ic, limit: L.warn }));
        const w = Math.abs((a.extra.vce || 0) * a.extra.ic) / 1000;
        lim(w, PW, () => R('J0316', 'error', { comp: c, key: 'C' }, { name: c.name, value: w, limit: PW.max }), () => R('J0316', 'warning', { comp: c, key: 'C' }, { name: c.name, value: w, limit: PW.warn }));
      });
    }
    if (t === 'diode') P.push((dc, R) => { const a = dc.across(c); if (!a) return; lim(a.mA, LIM.DIODE, () => R('J0308', 'error', { comp: c }, { name: c.name, value: a.mA, limit: LIM.DIODE.max }), () => {}); });
    if (LIM.CAP_V[t]) P.push((dc, R) => {
      const v = dc.capV(c); if (v == null) return;
      if (Math.abs(v) > LIM.CAP_V[t]) R('J0307', 'error', { comp: c }, { name: c.name, value: Math.abs(v), limit: LIM.CAP_V[t] });
      if (t === 'cap-100u' && v < -1) R('J0402', 'error', { comp: c, key: '+' }, { name: c.name, value: v }, null);
    });
    if (COILS[t]) P.push((dc, R) => {
      const m = COILS[t], a = dc.across(c); if (!a || a.v == null) return;
      if (Math.abs(a.v) > m.vMax) R('J0311', 'warning', { comp: c }, { name: c.name, value: Math.abs(a.v), limit: m.vNom });
    });
    if (MOTORS[t]) P.push((dc, R) => {
      const m = MOTORS[t], a = dc.across(c); if (!a || a.v == null) return;
      if (m.polar && a.v < -m.vStart) R('J0403', 'warning', { comp: c, key: m.plus }, { name: c.name, value: a.v });
      else if (Math.abs(a.v) > m.vMax) R('J0311', !m.rev && Math.abs(a.v) > 1.6 * m.vNom ? 'error' : 'warning', { comp: c }, { name: c.name, value: Math.abs(a.v), limit: m.vNom });
    });
    if (t === 'servo') P.push((dc, R) => { const a = dc.across(c); if (a && a.v != null && a.v > 0.5 && a.v < 4.2) R('J0312', 'warning', { comp: c, key: 'VCC' }, { name: c.name, value: a.v }); });
    if (t === 'relay' && c.pins.COM) P.push((dc, R) => { const i = Math.abs(dc.injections().get(pid(c, 'COM')) || 0); if (i > LIM.RELAY_CONTACT) R('J0310', 'error', { comp: c, key: 'COM' }, { name: c.name, value: i, limit: LIM.RELAY_CONTACT }); });
    if (t === 'l298n') P.push((dc, R) => { const inj = dc.injections(); for (const k of ['OUT1', 'OUT2', 'OUT3', 'OUT4']) { const i = Math.abs(inj.get(pid(c, k)) || 0); lim(i, LIM.L298N_CH, () => R('J0309', 'error', { comp: c, key: k }, { name: c.name, value: i, limit: LIM.L298N_CH.max }), () => {}); } });
    // Composants analogiques : MOSFET (courant, tensions, échauffement sans radiateur), sortie du NE555, entrées du
    // LM358 (sous la masse, hors de la plage de mode commun), courant d'une bobine.
    if (t === 'irlz44n') {
      const L = LIM.IRLZ44N, W = LIM.IRLZ44N_W;
      P.push((dc, R) => {
        const a = dc.across(c); if (!a || a.kind !== 'mosfet' || !a.extra) return;
        const x = a.extra, id = Math.abs(x.id || 0);
        lim(id, L.id, () => R('J0318', 'error', { comp: c, key: 'D' }, { name: c.name, value: id, limit: L.id.max }), () => R('J0318', 'warning', { comp: c, key: 'D' }, { name: c.name, value: id, limit: L.id.warn }));
        if (x.vgs != null && Math.abs(x.vgs) > L.vgs) R('J0319', 'error', { comp: c, key: 'G' }, { name: c.name, value: Math.abs(x.vgs), limit: L.vgs });
        if (x.vds != null && x.vds > L.vds) R('J0320', 'error', { comp: c, key: 'D' }, { name: c.name, value: x.vds, limit: L.vds });
        const w = Math.abs((x.vds || 0) * (x.id || 0)) / 1000;
        lim(w, W, () => R('J0325', 'error', { comp: c, key: 'D' }, { name: c.name, value: w, limit: W.max }), () => R('J0325', 'warning', { comp: c, key: 'D' }, { name: c.name, value: w, limit: W.warn }));
      });
    }
    if (t === 'ne555') P.push((dc, R) => { const a = dc.across(c); if (!a || a.kind !== 'timer') return; lim(a.mA, LIM.NE555_OUT, () => R('J0321', 'error', { comp: c, key: 'OUT' }, { name: c.name, value: Math.abs(a.mA), limit: LIM.NE555_OUT.max }), () => R('J0321', 'warning', { comp: c, key: 'OUT' }, { name: c.name, value: Math.abs(a.mA), limit: LIM.NE555_OUT.warn })); });
    if (OPAMPS[t]) P.push((dc, R) => {
      const a = dc.across(c); if (!a || a.kind !== 'opamp') return;
      const g = dc.volts({ comp: c, key: 'GND' }), v = dc.volts({ comp: c, key: 'VCC' }), top = g != null && v != null ? v - g - LIM.LM358_IN.cmr : null;
      for (const ch of a.extra.chans) {
        const keys = OPAMPS[t].chans.find(x => x[2] === ch.out); if (!keys) continue;
        for (const [k, x] of [[keys[0], ch.vp], [keys[1], ch.vn]]) {
          if (x == null || !(A.members({ comp: c, key: k }).length > 1)) continue;
          if (x < LIM.LM358_IN.min - 1e-3) R('J0324', 'error', { comp: c, key: k }, { name: nm(c, k), value: x, limit: LIM.LM358_IN.min });
          else if (top != null && v - g > 0.5 && x > top + 1e-3) R('J0323', 'warning', { comp: c, key: k }, { name: nm(c, k), value: x, limit: top });
        }
      }
    });
    if (LIM.INDUCTOR[t]) P.push((dc, R) => { const a = dc.across(c); if (!a) return; const L = LIM.INDUCTOR[t]; lim(a.mA, L, () => R('J0322', 'error', { comp: c }, { name: c.name, value: Math.abs(a.mA), limit: L.max }), () => R('J0322', 'warning', { comp: c }, { name: c.name, value: Math.abs(a.mA), limit: L.warn })); });
    if (t === 'lm7805') P.push((dc, R) => {
      const a = dc.across(c); if (!a) return;
      lim(a.mA, LIM.LM7805, () => R('J0109', 'error', { comp: c, key: 'OUT' }, { name: c.name, value: a.mA, limit: LIM.LM7805.max }), () => {});
      const vin = dc.volts({ comp: c, key: 'IN' }), vout = dc.volts({ comp: c, key: 'OUT' });
      if (vin == null || vout == null) return;
      const w = Math.max(0, vin - vout) * Math.max(0, a.mA) / 1000;
      lim(w, LIM.LM7805_W, () => R('J0317', 'error', { comp: c, key: 'IN' }, { name: c.name, value: w, limit: LIM.LM7805_W.max }), () => R('J0317', 'warning', { comp: c, key: 'IN' }, { name: c.name, value: w, limit: LIM.LM7805_W.warn }));
    });
    // Sources : pile, batterie, module d'alimentation. Très au-delà de leur courant : court-circuit.
    const S = SOURCES[t];
    if (S && LIM.SOURCE[t]) P.push((dc, R) => {
      const inj = dc.injections(); let i = 0;
      for (const k in S) if (S[k]) i += Math.max(0, inj.get(pid(c, k)) || 0);
      const l = LIM.SOURCE[t];
      // Court-circuit : bien au-delà de ce que la source sait débiter (un accu 18650 fournit 5 A en pointe).
      if (i > Math.max(LIM.SHORT_MA, 2 * l.max)) R('J0103', 'error', { comp: c }, { name: c.name, value: i });
      else if (i > l.max) R('J0109', 'error', { comp: c }, { name: c.name, value: i, limit: l.max });
      else if (i > l.warn) R('J0902', 'warning', { comp: c }, { name: c.name, value: i, limit: l.warn });
    });
    // Modules : tension d'alimentation calculée, au-delà de ce qu'ils supportent.
    if (spec && spec.pins && !boardOf(c)) {
      const g = spec.pins.find(p => p.kind === 'gnd');
      for (const p of spec.pins) {
        if (p.kind !== 'pwr' || !Array.isArray(p.v) || !c.pins[p.pin] || !g || !c.pins[g.pin]) continue;
        P.push((dc, R) => { const a = dc.volts({ comp: c, key: p.pin }), b = dc.volts({ comp: c, key: g.pin }); if (a == null || b == null) return; if (a - b > p.v[1] + 0.15) R('J0306', 'error', { comp: c, key: p.pin }, { name: nm(c, p.pin), value: a - b, limit: p.v[1] }); });
      }
    }
    // Cartes : courant de chaque GPIO et total, broches 5V et 3V3, tension reçue, lecture d'une entrée en l'air.
    const L = LIM.boardLimits(c);
    if (L) {
      const prof = boardOf(c), f = facts.get(c);
      // Entrées lues par le programme, sans tirage ni module qui les pilote : à vérifier dans chaque état.
      const moduleDriven = k => A.members({ comp: c, key: k }).some(m => { if (boardOf(m.comp)) return false; const sp = partOf(m.comp), q = sp && sp.pins && sp.pins.find(x => x.pin === m.key); return !!(q && q.kind === 'io' && DRIVEN.has(q.need)); });
      // VIN / VSYS : vérifiée quand quelque chose y est relié ; « alimentée » quand une source extérieure l'atteint.
      const vinKeys = prof.vin ? Object.keys(c.pins).filter(k => base(k) === prof.vin.pin && A.members({ comp: c, key: k }).some(m => m.comp !== c)) : [];
      const vinFed = k => A.wnet({ comp: c, key: k }).src.some(s => s.comp !== c) || A.members({ comp: c, key: k }).some(m => m.comp.type === 'diode' && m.key === 'K');
      const reads = f ? [...f.pins].filter(([k, pf]) => !pf.lib && pf.reads.size && !['out', 'pullup', 'pulldown'].includes(pinRole(pf)) && !moduleDriven(k)).map(([k]) => k) : [];
      const pinProbe = (k, fn) => P.push({ comp: c, pin: k, fn });
      for (const k in prof.gpio) {
        if (!c.pins[k]) continue;
        pinProbe(k, (dc, R) => {
          const i = Math.abs(dc.injections().get(pid(c, k)) || 0);
          if (i > 0.01) lim(i, L.pin, () => R('J0302', 'error', { comp: c, key: k }, { name: nm(c, k), value: i, limit: L.pin.max }), () => R('J0302', 'warning', { comp: c, key: k }, { name: nm(c, k), value: i, limit: L.pin.warn }));
          const v = dc.volts({ comp: c, key: k });
          if (v != null && (v > L.vmax || v < L.vmin)) R('J0303', 'error', { comp: c, key: k }, { name: nm(c, k), value: v, limit: v > 0 ? L.vmax : L.vmin });
        });
      }
      for (const k of reads) pinProbe(k, (dc, R) => { if (dc.volts({ comp: c, key: k }) == null) R('J0602', 'error', { comp: c, key: k }, { name: nm(c, k) }); });
      // Entrée VIN / VSYS alimentée de l'extérieur : dans la plage de son régulateur.
      for (const k of vinKeys) pinProbe(k, (dc, R) => {
        const v = dc.volts({ comp: c, key: k }); if (v == null) return;
        if (v > prof.vin.max + 0.2) R('J0111', 'error', { comp: c, key: k }, { name: nm(c, k), value: v, lo: prof.vin.min, hi: prof.vin.max });
        else if (vinFed(k) && v < prof.vin.min - 0.2) R('J0112', 'warning', { comp: c, key: k }, { name: nm(c, k), value: v, lo: prof.vin.min });
      });
      // Budgets : toutes les GPIO ensemble ; broches 5V et 3V3 (ce que tirent les composants reliés à chaque nœud d'alimentation).
      const gpioParts = Object.keys(prof.gpio).filter(k => c.pins[k]).map(k => ({ pin: k, read: dc => Math.abs(dc.injections().get(pid(c, k)) || 0) }));
      B.push({ comp: c, parts: gpioParts, judge: (total, R) => { if (total > L.total) R('J0109', 'error', { comp: c, key: 'GPIO' }, { name: tl('{0} (toutes ses broches)', c.name), value: total, limit: L.total }); } });
      for (const [high, lv, label] of [[true, L.five, '5V'], [false, L.three, '3V3']]) {
        const nodes = new Set(), parts = [];
        for (const k in c.pins) {
          const v = prof.power[base(k)]; if (v == null || (v > 4) !== high) continue;
          const mem = A.members({ comp: c, key: k }); if (nodes.has(mem)) continue; nodes.add(mem);
          for (const m of mem) if (!boardOf(m.comp)) parts.push({ comp: m.comp, read: dc => -(dc.injections().get(pid(m.comp, m.key)) || 0) });
        }
        if (!parts.length) continue;
        B.push({ comp: c, parts, judge: (total, R) => {
          if (total > LIM.SHORT_MA) R('J0103', 'error', { comp: c, key: label }, { name: nm(c, label), value: total });
          else if (total > lv) R('J0109', 'error', { comp: c, key: label }, { name: nm(c, label), value: total, limit: lv });
        } });
      }
    }
    for (let i = P0; i < P.length; i++) if (typeof P[i] === 'function') P[i] = { comp: c, fn: P[i] };
  }
  return { probes: P, budgets: B };
}

/**
 * Sous-montages indépendants : on coupe le montage aux nœuds dont la tension ne dépend de rien (masses, 5V et 3V3
 * d'une carte, VIN alimenté par la seule USB). Un composant relie toutes ses autres broches (prudent : un module
 * entier, un relais avec ses contacts, un pilote avec ses moteurs). Une broche de carte est dans le sous-montage de son
 * nœud ; une broche ou un composant posé sur un nœud fixe forme son propre sous-montage.
 * Rend { comp(c), pin(carte, clé) } → identifiant de sous-montage.
 */
function regionsOf(comps, A) {
  const ids = new Map(), parent = [];
  const netId = r => { const m = A.members(r); let i = ids.get(m); if (i === undefined) { i = parent.length; ids.set(m, i); parent.push(i); } return i; };
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const stiffOf = new Map();
  const stiff = r => {
    const i = netId(r); if (stiffOf.has(i)) return stiffOf.get(i);
    const net = A.net(r), mem = A.members(r);
    const s = net.gnd.length > 0 || net.src.some(x => boardOf(x.comp) && !x.diode)
      || (net.src.length > 0 && net.src.every(x => boardOf(x.comp)) && !mem.some(m => m.comp.type === 'diode' || SOURCES[m.comp.type] || DERIVED[m.comp.type]));
    stiffOf.set(i, s); return s;
  };
  for (const c of comps) {
    if (boardOf(c) || /^breadboard/.test(c.type)) continue;
    let first = -1;
    for (const k in c.pins) {
      const r = { comp: c, key: k }; if (stiff(r)) continue;
      const i = find(netId(r)); if (first < 0) first = i; else if (i !== first) parent[i] = first;
    }
  }
  return {
    comp(c) { for (const k in c.pins) { const r = { comp: c, key: k }; if (!stiff(r)) return 'n' + find(netId(r)); } return 'c:' + c.id; },
    pin(c, k) { const r = { comp: c, key: k }; return stiff(r) ? `p:${c.id}|${k}` : 'n' + find(netId(r)); }
  };
}
export { DERIVED };
