// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérifie les TP (src/lab/tp/*.json) sans l'interface : node src/lab/validate.mjs
// - champs obligatoires, textes en français ET en anglais ;
// - le montage de départ n'est pas déjà câblé (les étapes de câblage échouent) ;
// - la solution de câblage valide toutes les étapes « wire » ;
// - le programme de la solution compile et contient ce que demandent les étapes « code » ;
// - réponses des quiz valides ; composants des étapes « watch » présents ;
// - valeur attendue des mesures calculée (si le solveur sim/dc.js est présent).
// TP de logique (src/lab/logic/*.json, domain: 'logic') : éléments et fils valides, la solution réussit
// chaque contrôle (table, suite d'actions, éléments utilisés, équation, table à remplir), le montage de
// départ ne réussit pas d'avance les contrôles de table et de suite.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARDS, kindOf } from '../sim/boards.js';
import { PARTS } from '../sim/parts.js';
import { analyze, bbGroups } from '../sim/circuit.js';
import { compile } from '../prog/lang.js';
import { checkWire, checkCode, checkQuiz, expectedMeasure, checkPneuTube, checkParts, checkWired, checkPneuParts, checkGrafcet } from './engine.js';
import { pinKeys } from '../check/load.js';
import { DEFS as LOGIC, layoutOf, sizeOf } from '../logic/elements.js';
import { checkLogicTable, checkLogicSeq, checkLogicParts, checkExpr, checkTableFill } from '../logic/check.js';
import { parse, expected } from '../logic/boolean.js';
import { signals } from '../logic/sim.js';
import { syncBlocks } from '../logic/blocks.js';
import { createRunner, runStep, inputKey } from '../pneu/run.js';
import { hasSequence, moveText } from '../pneu/seq.js';
import { clean as cleanPneu } from '../pneu/clean.js';
import { checkPneu } from '../pneu/check.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tp');
const logicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'logic');
let solveDC = null;
try { ({ solveDC } = await import('../sim/dc.js')); } catch (e) { /* solveur absent : mesures non calculées */ }

function keysOf(c) {
  const prof = BOARDS[c.type];
  if (prof) return [...Object.keys(prof.gpio), ...Object.keys(prof.power), 'GND', 'GND (2)', 'GND (3)', 'VIN', 'EN', 'RST', 'AREF', 'IOREF', 'VSYS', 'VBUS', '3V3_EN', 'RUN'];
  if (/^breadboard/.test(c.type)) return bbGroups(c).flatMap(g => g.keys);
  if (/^res-/.test(c.type)) return ['1', '2'];
  if (c.type === 'bat9v' || c.type === 'bat18650' || c.type === 'psu24') return ['+', '-'];
  // Composants sans fiche de broches (diode, condensateurs…) : mêmes broches que dans l'application.
  const sp = PARTS[c.type]; return sp && sp.pins ? sp.pins.map(p => p.pin) : pinKeys(c.type);
}
function build(project, wires) {
  const comps = project.comps.map(c => ({ ...c, pins: Object.fromEntries(keysOf(c).map(k => [k, {}])), inp: { ...(c.inp || {}) } }));
  const byId = Object.fromEntries(comps.map(c => [c.id, c]));
  const ws = [];
  for (const w of wires) {
    const a = byId[w.a[0]], b = byId[w.b[0]];
    if (!a || !b || !(w.a[1] in a.pins) || !(w.b[1] in b.pins)) throw new Error(`fil invalide ${JSON.stringify(w)}`);
    ws.push({ a: { comp: a, key: w.a[1] }, b: { comp: b, key: w.b[1] }, progress: 1 });
  }
  return { comps, wires: ws };
}
let failures = 0;
/** États d'interface qu'une étape « ui » peut demander (lab/index.js). */
const UI_STATES = new Set(['sim', 'split', 'pneu', 'elec', 'grafcet', '3d']);
let eStartPlan = null, eSolPlan = null; // plans pneumatiques du tutoriel en cours de vérification
const bad = (tp, msg) => { failures++; console.log(`  ✕ ${tp.id} : ${msg}`); };
const both = (o, what, tp) => { if (!o || !o.fr || !o.en) bad(tp, `${what} : texte fr et en requis`); };

// TP d'électronique et TP de pneumatique (src/lab/pneu : même format, plan pneumatique dans start.settings.modules.pneu).
const pneuDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pneu');
const elecFiles = [dir, pneuDir].flatMap(d => (fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.json')).sort().map(f => [d, f]) : []));
for (const [fdir, f] of elecFiles) {
  const tp = JSON.parse(fs.readFileSync(path.join(fdir, f), 'utf8'));
  console.log(`• ${f} — ${tp.title && tp.title.fr} (${tp.steps.length} étapes)`);
  for (const k of ['id', 'level', 'minutes', 'title', 'summary', 'objectives', 'start', 'solution', 'steps']) if (tp[k] == null) bad(tp, `champ ${k} manquant`);
  if (!['college', 'lycee', 'pro'].includes(tp.level)) bad(tp, 'level : college, lycee ou pro');
  both(tp.title, 'title', tp); both(tp.summary, 'summary', tp); (tp.objectives || []).forEach((o, i) => both(o, `objectif ${i + 1}`, tp));
  if ((tp.start.wires || []).length) bad(tp, 'le montage de départ ne doit pas avoir de fils');
  if (tp.takeaways) { if (!Array.isArray(tp.takeaways) || tp.takeaways.length < 2 || tp.takeaways.length > 6) bad(tp, 'takeaways : 2 à 6 points à retenir'); else tp.takeaways.forEach((t, i) => both(t, `à retenir ${i + 1}`, tp)); }
  const kind = (tp.start.settings || {}).kind;
  if (kind != null && !['elec', 'analog', 'logic', 'pneu', 'epneu'].includes(kind)) bad(tp, `start.settings.kind inconnu : ${kind}`);
  // Tutoriel (départ vide) : la solution est un projet entier (montage, fils, plan pneumatique, programme).
  const proj = tp.solution && tp.solution.project;
  let start, sol;
  try { start = build(tp.start, []); sol = proj ? build(proj, proj.wires || []) : build(tp.start, tp.solution.wires || []); } catch (e) { bad(tp, e.message); continue; }
  const envOf = (m, code) => {
    const A = analyze(m.comps, m.wires), board = m.comps.find(c => BOARDS[c.type]);
    return {
      comps: () => m.comps, analyze: () => A,
      program: () => (code ? { code, kind: board ? kindOf(board) : 'uno' } : null),
      compile: (src, kind) => compile(src, { board: kind }),
      dc: state => {
        if (!solveDC) return null;
        const st = state || {}, comps = m.comps;
        for (const [k, v] of Object.entries(st)) if (!k.includes('.')) { const c = comps.find(x => x.name === k); if (c && v === 'pressed') c.inp.pressed = true; }
        return solveDC(comps, A, {
          prof: c => BOARDS[c.type] || null,
          pinState: (c, key) => { const v = st[`${c.name}.${key}`]; return v == null ? null : typeof v === 'object' ? v : { mode: 1, d: v ? 1 : 0, pwm: null }; },
          sensorVolts: () => null
        });
      }
    };
  };
  const projCode = proj && Object.values(((proj.settings || {}).prog || {}).boards || {}).map(b => b.code).find(Boolean);
  const code = projCode || (tp.solution.code ? Object.values(tp.solution.code)[0] : '');
  // Plans pneumatiques d'un tutoriel : celui du départ (souvent vide) et celui de la solution.
  const planOf = p => cleanPneu((((p.settings || {}).modules || {}).pneu || {}).circuit || null);
  if (proj) { eStartPlan = planOf(tp.start); eSolPlan = planOf(proj); }
  const eStart = envOf(start, ''), eSol = envOf(sol, code);
  if (proj) { eStart.pneu = () => eStartPlan; eSol.pneu = () => eSolPlan; }
  tp.steps.forEach((s, i) => {
    both(s.title, `étape ${i + 1} title`, tp); both(s.text, `étape ${i + 1} text`, tp); if (s.hint) both(s.hint, `étape ${i + 1} hint`, tp);
    if (s.keep) both(s.keep, `étape ${i + 1} keep (à retenir)`, tp);
    if (s.spot && !(Array.isArray(s.spot) && s.spot.every(x => typeof x === 'string' && x))) bad(tp, `étape ${i + 1} : spot doit être une liste de sélecteurs`);
    const c = s.check; if (!c) return;
    // Contrôles d'un tutoriel : la solution les réussit, le départ non.
    const solFirst = (fn, what) => { const ok = fn(c, eSol), ko = fn(c, eStart); if (!ok.ok) bad(tp, `étape ${i + 1} : la solution ne réussit pas ${what} (${JSON.stringify(ok)})`); if (ko.ok) bad(tp, `étape ${i + 1} : ${what} déjà réussi au départ`); };
    if (c.type === 'parts') return solFirst(checkParts, 'les composants');
    if (c.type === 'wired') return solFirst(checkWired, 'le câblage');
    if (c.type === 'pneu-parts') return proj ? solFirst(checkPneuParts, 'les éléments du plan') : bad(tp, `étape ${i + 1} : pneu-parts réservé aux tutoriels`);
    if (c.type === 'grafcet') return proj ? solFirst(checkGrafcet, 'le GRAFCET') : bad(tp, `étape ${i + 1} : grafcet réservé aux tutoriels`);
    if (c.type === 'ui') { const unknown = (c.need || []).filter(n => !UI_STATES.has(n)); if (!c.need || !c.need.length || unknown.length) bad(tp, `étape ${i + 1} : état d'interface inconnu ${JSON.stringify(unknown)}`); return; }
    if (proj && c.type === 'pneu-tube') return solFirst(checkPneuTube, 'les tuyaux');
    if (proj && c.type === 'pneu-seq') {
      const ok = tutoSeq(eSolPlan, sol.comps, c), ko = tutoSeq(eStartPlan, start.comps, c);
      if (!ok.ok) bad(tp, `étape ${i + 1} : la solution simulée donne « ${ok.seen} », pas ${JSON.stringify(c.expect)}`);
      if (ko.ok) bad(tp, `étape ${i + 1} : le cycle est déjà réalisé au départ`);
      for (const n of Object.keys(c.when || {})) if (!sol.comps.some(x => x.name === n)) bad(tp, `étape ${i + 1} : bouton ${n} absent du montage de la solution`);
      return;
    }
    if (c.type === 'wire') {
      const rs = checkWire(c, eSol); if (!rs.ok) bad(tp, `étape ${i + 1} : la solution ne valide pas ${JSON.stringify(rs.missing.map(m => m.group))}`);
      if (checkWire(c, eStart).ok) bad(tp, `étape ${i + 1} : déjà validée sans câblage`);
    } else if (c.type === 'code') {
      const rc = checkCode(c, eSol); if (!rc.ok) bad(tp, `étape ${i + 1} : la solution échoue (${rc.why} ${JSON.stringify(rc.missing || rc.errors)})`);
    } else if (c.type === 'quiz') {
      c.options.forEach((o, k) => both(o, `étape ${i + 1} option ${k + 1}`, tp));
      if ([].concat(c.answer).some(a => !(a >= 0 && a < c.options.length))) bad(tp, `étape ${i + 1} : réponse hors des options`);
      if (!checkQuiz(c, c.answer).ok) bad(tp, `étape ${i + 1} : quiz incohérent`);
    } else if (c.type === 'pneu-seq') {
      // Cycle des vérins : la solution simulée (tuyaux, GRAFCET) doit le donner ; le départ, non.
      if (!pneuStart(tp)) { bad(tp, `étape ${i + 1} : pas de plan pneumatique au départ`); return; }
      const ok = pneuSeq(tp, c, true), ko = pneuSeq(tp, c, false);
      if (!ok.ok) bad(tp, `étape ${i + 1} : la solution simulée donne « ${ok.seen} », pas ${JSON.stringify(c.expect)}`);
      if (ko.ok) bad(tp, `étape ${i + 1} : le cycle est déjà réalisé au départ`);
      for (const n of Object.keys(c.when || {})) if (!pneuNames(tp).has(n.replace(/:R$/, '').toLowerCase())) bad(tp, `étape ${i + 1} : bouton ${n} absent du plan et du pupitre`);
    } else if (c.type === 'watch') {
      const pneuIds = pneuNames(tp);
      const names = [...Object.keys(c.when || {}), ...Object.keys(c.expect || {})];
      for (const n of names) if (!sol.comps.some(x => x.name === n) && !pneuIds.has(n.replace(/:R$/, '').toLowerCase())) bad(tp, `étape ${i + 1} : composant ${n} absent`);
      // Plan pneumatique seul : la solution, simulée, doit donner le comportement attendu.
      if (names.length && names.every(n => pneuIds.has(n.replace(/:R$/, '').toLowerCase()))) { const why = pneuWatch(tp, c); if (why) bad(tp, `étape ${i + 1} : ${why}`); }
    } else if (c.type === 'pneu-tube') {
      // Plan pneumatique : celui du départ (module « pneu »), complété par les tuyaux de la solution.
      const startC = ((tp.start.settings || {}).modules || {}).pneu, startCirc = startC && startC.circuit;
      if (!startCirc) { bad(tp, `étape ${i + 1} : pas de plan pneumatique au départ`); return; }
      const solCirc = { ...startCirc, tubes: [...(startCirc.tubes || []), ...((tp.solution.pneu || {}).tubes || [])] };
      if (!checkPneuTube(c, { pneu: () => solCirc }).ok) bad(tp, `étape ${i + 1} : la solution ne raccorde pas ${JSON.stringify(checkPneuTube(c, { pneu: () => solCirc }).missing.map(m => m.group))}`);
      if (checkPneuTube(c, { pneu: () => startCirc }).ok) bad(tp, `étape ${i + 1} : déjà raccordé au départ`);
      const ids = new Set(startCirc.elements.map(e => e.id));
      for (const g of c.tubes) for (const k of g) if (!k.startsWith('~') && !ids.has(k.split(':')[0])) bad(tp, `étape ${i + 1} : élément ${k} absent du plan`);
    } else if (c.type === 'measure') {
      const v = expectedMeasure(c, eSol);
      if (solveDC) { if (v == null) bad(tp, `étape ${i + 1} : mesure non calculable`); else console.log(`    mesure étape ${i + 1} : ${v.toFixed(2)} ${c.unit}`); }
    } else if (c.type !== 'info') bad(tp, `étape ${i + 1} : type ${c.type} inconnu`);
  });
}
/* ---------- Plan pneumatique des TP ---------- */
/**
 * Étape « pneu-seq » d'un tutoriel : la carte suit le GRAFCET (programme écrit d'après lui) ; on simule donc le GRAFCET
 * aux commandes, les boutons du montage de « when » appuyés après 1 s de repos. Cycle relevé en 40 s.
 */
function tutoSeq(plan, comps, c) {
  if (!plan || !plan.elements.length) return { ok: false, seen: '' };
  const circ = plan.grafcet ? { ...plan, grafcet: { ...plan.grafcet, drive: true } } : plan, R = createRunner(), dt = 0.02;
  let held = new Set();
  const io = { coil: () => false, pushed: () => false, input: n => held.has(n) };
  for (let t = 0; t < 1; t += dt) runStep(R, circ, io, dt);
  held = new Set(Object.entries(c.when || {}).filter(([n, v]) => v === 'pressed' && comps.some(x => x.name === n)).map(([n]) => n.toLowerCase()));
  for (let t = 0; t < 40 && !hasSequence(R.rec.moves, c.expect); t += dt) runStep(R, circ, io, dt);
  return { ok: hasSequence(R.rec.moves, c.expect), seen: R.rec.moves.map(moveText).join(' ') };
}
function pneuStart(tp) { return (((tp.start.settings || {}).modules || {}).pneu || {}).circuit || null; }
/** Plan de la solution (sol) ou du départ : tuyaux de la solution ajoutés, GRAFCET de la solution à la place du départ. */
function pneuCircuit(tp, sol) {
  const s = pneuStart(tp), p = tp.solution.pneu || {};
  return cleanPneu(sol ? { ...s, tubes: [...(s.tubes || []), ...(p.tubes || [])], ...(p.grafcet ? { grafcet: p.grafcet } : {}) } : s);
}
/** Identifiants du plan et boutons du pupitre du GRAFCET (minuscules). */
function pneuNames(tp) {
  const s = pneuStart(tp); if (!s) return new Set();
  const g = (tp.solution.pneu || {}).grafcet || s.grafcet;
  return new Set([...s.elements.map(e => e.id.toLowerCase()), ...((g && g.inputs) || []).map(x => x.name.toLowerCase())]);
}
/** Simulation d'un plan : au repos 1 s, puis les boutons de « when » appuyés (distributeurs, ou pupitre « @nom »). */
function pneuSim(circ, when) {
  const R = createRunner(), dt = 0.02, inputs = new Set(((circ.grafcet && circ.grafcet.inputs) || []).map(x => x.name.toLowerCase()));
  let pushed = new Set();
  const io = { coil: () => false, pushed: k => pushed.has(k) };
  for (let t = 0; t < 1; t += dt) runStep(R, circ, io, dt);
  pushed = new Set(Object.entries(when || {}).filter(([, v]) => v === 'pressed').map(([k]) => (circ.elements.some(e => e.id === k.replace(/:R$/, '')) || !inputs.has(k.toLowerCase()) ? k : inputKey(k))));
  return { R, io, step: () => runStep(R, circ, io, dt), dt };
}
/**
 * Étape « watch » d'un TP de pneumatique pur : la solution au repos 1 s, puis les boutons de « when » appuyés ;
 * « expect » doit tenir pendant « hold » dans les 8 s. Renvoie la raison d'un échec.
 */
function pneuWatch(tp, c) {
  const circ = pneuCircuit(tp, true), S = pneuSim(circ, c.when);
  const look = n => { const e = circ.elements.find(x => x.id === n.replace(/:R$/, '')); if (!e) return S.io.pushed(inputKey(n)) ? 'pressed' : 'released'; if (/^v/.test(e.type)) return S.io.pushed(n) ? 'pressed' : 'released'; const x = S.R.st.x[n] || 0; return x >= 0.98 ? 'out' : x <= 0.02 ? 'in' : 'moving'; };
  let since = null;
  for (let t = 0; t < 8; t += S.dt) {
    S.step();
    const ok = Object.entries(c.expect || {}).every(([n, v]) => look(n) === v);
    if (!ok) since = null; else if (since == null) since = t; else if (t - since >= (c.hold || 400) / 1000) return null;
  }
  return `la solution simulée ne donne pas ${JSON.stringify(c.expect)} (${Object.keys(c.expect || {}).map(n => `${n} : ${look(n)}`).join(', ')})`;
}
/** Étape « pneu-seq » : cycle relevé en 40 s, boutons de « when » maintenus. */
function pneuSeq(tp, c, sol) {
  const circ = pneuCircuit(tp, sol), S = pneuSim(circ, c.when);
  for (let t = 0; t < 40 && !hasSequence(S.R.rec.moves, c.expect); t += S.dt) S.step();
  return { ok: hasSequence(S.R.rec.moves, c.expect), seen: S.R.rec.moves.map(moveText).join(' ') };
}
/* ---------- TP de logique ---------- */
function logicCircuit(tp, c, what, inner = false) {
  if (!c || !Array.isArray(c.elements)) { bad(tp, `${what} : circuit logique manquant`); return null; }
  // Blocs (sous-circuits) : chaque définition est vérifiée comme un circuit, chaque bloc posé doit exister.
  if (!inner && c.blocks) {
    const ids = new Set(c.blocks.map(b => b.id));
    for (const k of [c, ...c.blocks.map(b => b.circuit)]) for (const e of (k && k.elements) || []) if (e.type === 'block' && !ids.has(e.p && e.p.ref)) bad(tp, `${what} : bloc ${e.id} vers une définition absente ${e.p && e.p.ref}`);
    syncBlocks(c);
    for (const b of c.blocks) logicCircuit(tp, b.circuit, `${what} / bloc ${b.id}`, true);
  }
  const ids = new Set();
  for (const e of c.elements) {
    if (!LOGIC[e.type]) bad(tp, `${what} : élément ${e.id} de type inconnu ${e.type}`);
    if (ids.has(e.id)) bad(tp, `${what} : identifiant ${e.id} en double`); ids.add(e.id);
    if (!Number.isInteger(e.x) || !Number.isInteger(e.y)) bad(tp, `${what} : ${e.id} hors de la grille`);
  }
  // Éléments qui se chevauchent (boîtes, nœuds et textes exceptés) : le plan doit rester lisible.
  const boxes = c.elements.filter(e => LOGIC[e.type] && !['junction', 'text'].includes(e.type)).map(e => ({ e, ...sizeOf(e) }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.e.x < b.e.x + b.w && b.e.x < a.e.x + a.w && a.e.y < b.e.y + b.h && b.e.y < a.e.y + a.h) bad(tp, `${what} : ${a.e.id} et ${b.e.id} se chevauchent`);
  }
  for (const w of c.wires || []) {
    for (const [id, pin] of [w.a, w.b]) {
      const e = c.elements.find(x => x.id === id);
      if (!e) { bad(tp, `${what} : fil ${w.id} vers un élément absent ${id}`); continue; }
      if (LOGIC[e.type] && !layoutOf(e).pins.some(p => p.name === pin)) bad(tp, `${what} : fil ${w.id}, broche ${id}.${pin} inconnue`);
    }
  }
  return c;
}
function validateLogic(tp) {
  const start = logicCircuit(tp, tp.start && tp.start.logic, 'départ'), sol = logicCircuit(tp, tp.solution && tp.solution.logic, 'solution');
  if (!start || !sol) return;
  const answers = (tp.solution && tp.solution.answers) || {};
  const S = signals(start), names = [...S.ins, ...S.outs, ...S.clocks].map(s => s.name);
  console.log(`    entrées/sorties du départ : ${names.join(', ') || '—'}`);
  tp.steps.forEach((s, i) => {
    both(s.title, `étape ${i + 1} title`, tp); both(s.text, `étape ${i + 1} text`, tp); if (s.hint) both(s.hint, `étape ${i + 1} hint`, tp);
    const c = s.check; if (!c) return;
    const circ = s.solution ? logicCircuit(tp, s.solution, `solution de l’étape ${i + 1}`) : sol;
    if (!circ) return;
    if (c.type === 'logic-table') {
      try { for (const o of Object.values(c.outputs)) expected(o, c.inputs); } catch (e) { bad(tp, `étape ${i + 1} : sortie attendue illisible (${e.message})`); return; }
      const r = checkLogicTable(c, circ);
      if (!r.ok) bad(tp, `étape ${i + 1} : la solution échoue (${r.why} ${JSON.stringify(r.names || r.rows && r.rows.filter(x => !x.ok).slice(0, 3))})`);
      if (checkLogicTable(c, start).ok) bad(tp, `étape ${i + 1} : déjà réussie avec le montage de départ`);
    } else if (c.type === 'logic-seq') {
      const r = checkLogicSeq(c, circ);
      if (!r.ok) bad(tp, `étape ${i + 1} : la solution échoue au pas ${r.step + 1} (${r.why} ${JSON.stringify(r.names || r.got)})`);
      if (checkLogicSeq(c, start).ok) bad(tp, `étape ${i + 1} : déjà réussie avec le montage de départ`);
    } else if (c.type === 'logic-parts') {
      for (const t of [...(c.allow || []), ...Object.keys(c.require || {})]) if (!LOGIC[t]) bad(tp, `étape ${i + 1} : type ${t} inconnu`);
      const r = checkLogicParts(c, circ); if (!r.ok) bad(tp, `étape ${i + 1} : la solution échoue (${r.why} ${JSON.stringify(r.types || r.total)})`);
    } else if (c.type === 'expr') {
      try { parse(c.answer); } catch (e) { bad(tp, `étape ${i + 1} : réponse illisible (${e.message})`); }
      const own = answers[i] ?? c.answer;
      if (!checkExpr(c, own).ok) bad(tp, `étape ${i + 1} : la réponse modèle ne passe pas${c.form ? ` (forme ${c.form})` : ''}`);
      if (c.form && !['sop', 'pos', 'product', 'noxor'].includes(c.form)) bad(tp, `étape ${i + 1} : forme ${c.form} inconnue`);
    } else if (c.type === 'table-fill') {
      const ans = Object.fromEntries(Object.entries(c.outputs).map(([n, o]) => [n, expected(o, c.inputs).replace(/x/g, '0')]));
      if (!checkTableFill(c, ans).ok) bad(tp, `étape ${i + 1} : table incohérente`);
      if (c.inputs.length > 4) bad(tp, `étape ${i + 1} : table à remplir trop grande (4 entrées au plus)`);
    } else if (c.type === 'quiz') {
      c.options.forEach((o, k) => both(o, `étape ${i + 1} option ${k + 1}`, tp));
      if ([].concat(c.answer).some(a => !(a >= 0 && a < c.options.length))) bad(tp, `étape ${i + 1} : réponse hors des options`);
      if (!checkQuiz(c, c.answer).ok) bad(tp, `étape ${i + 1} : quiz incohérent`);
    } else if (c.type !== 'info') bad(tp, `étape ${i + 1} : type ${c.type} inconnu`);
  });
}
for (const f of (fs.existsSync(logicDir) ? fs.readdirSync(logicDir) : []).filter(f => f.endsWith('.json')).sort()) {
  const tp = JSON.parse(fs.readFileSync(path.join(logicDir, f), 'utf8'));
  console.log(`• logique/${f} — ${tp.title && tp.title.fr} (${tp.steps.length} étapes)`);
  for (const k of ['id', 'level', 'minutes', 'title', 'summary', 'objectives', 'start', 'solution', 'steps']) if (tp[k] == null) bad(tp, `champ ${k} manquant`);
  if (tp.domain !== 'logic') bad(tp, 'domain : logic attendu');
  if (!['college', 'lycee', 'pro'].includes(tp.level)) bad(tp, 'level : college, lycee ou pro');
  if (`${tp.id}.json` !== f) bad(tp, `id ${tp.id} différent du nom du fichier`);
  both(tp.title, 'title', tp); both(tp.summary, 'summary', tp); (tp.objectives || []).forEach((o, i) => both(o, `objectif ${i + 1}`, tp));
  validateLogic(tp);
}
console.log(failures ? `\n${failures} problème(s).` : '\nTous les TP sont valides.');
process.exit(failures ? 1 : 0);
