// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérifie les TP (src/lab/tp/*.json) sans l'interface : node src/lab/validate.mjs
// - champs obligatoires, textes en français ET en anglais ;
// - le montage de départ n'est pas déjà câblé (les étapes de câblage échouent) ;
// - la solution de câblage valide toutes les étapes « wire » ;
// - le programme de la solution compile et contient ce que demandent les étapes « code » ;
// - réponses des quiz valides ; composants des étapes « watch » présents ;
// - valeur attendue des mesures calculée (si le solveur sim/dc.js est présent).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARDS } from '../sim/boards.js';
import { PARTS } from '../sim/parts.js';
import { analyze, bbGroups } from '../sim/circuit.js';
import { compile } from '../prog/lang.js';
import { checkWire, checkCode, checkQuiz, expectedMeasure } from './engine.js';
import { pinKeys } from '../check/load.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tp');
let solveDC = null;
try { ({ solveDC } = await import('../sim/dc.js')); } catch (e) { /* solveur absent : mesures non calculées */ }

function keysOf(c) {
  const prof = BOARDS[c.type];
  if (prof) return [...Object.keys(prof.gpio), ...Object.keys(prof.power), 'GND', 'GND (2)', 'GND (3)', 'VIN', 'EN', 'RST', 'AREF', 'IOREF', 'VSYS', 'VBUS', '3V3_EN', 'RUN'];
  if (/^breadboard/.test(c.type)) return bbGroups(c).flatMap(g => g.keys);
  if (/^res-/.test(c.type)) return ['1', '2'];
  if (c.type === 'bat9v' || c.type === 'bat18650') return ['+', '-'];
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
const bad = (tp, msg) => { failures++; console.log(`  ✕ ${tp.id} : ${msg}`); };
const both = (o, what, tp) => { if (!o || !o.fr || !o.en) bad(tp, `${what} : texte fr et en requis`); };

for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const tp = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  console.log(`• ${f} — ${tp.title && tp.title.fr} (${tp.steps.length} étapes)`);
  for (const k of ['id', 'level', 'minutes', 'title', 'summary', 'objectives', 'start', 'solution', 'steps']) if (tp[k] == null) bad(tp, `champ ${k} manquant`);
  if (!['college', 'lycee', 'pro'].includes(tp.level)) bad(tp, 'level : college, lycee ou pro');
  both(tp.title, 'title', tp); both(tp.summary, 'summary', tp); (tp.objectives || []).forEach((o, i) => both(o, `objectif ${i + 1}`, tp));
  if ((tp.start.wires || []).length) bad(tp, 'le montage de départ ne doit pas avoir de fils');
  let start, sol;
  try { start = build(tp.start, []); sol = build(tp.start, tp.solution.wires || []); } catch (e) { bad(tp, e.message); continue; }
  const envOf = (m, code) => {
    const A = analyze(m.comps, m.wires), board = m.comps.find(c => BOARDS[c.type]);
    return {
      comps: () => m.comps, analyze: () => A,
      program: () => (code ? { code, kind: board ? board.type : 'uno' } : null),
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
  const code = tp.solution.code ? Object.values(tp.solution.code)[0] : '';
  const eStart = envOf(start, ''), eSol = envOf(sol, code);
  tp.steps.forEach((s, i) => {
    both(s.title, `étape ${i + 1} title`, tp); both(s.text, `étape ${i + 1} text`, tp); if (s.hint) both(s.hint, `étape ${i + 1} hint`, tp);
    const c = s.check; if (!c) return;
    if (c.type === 'wire') {
      const rs = checkWire(c, eSol); if (!rs.ok) bad(tp, `étape ${i + 1} : la solution ne valide pas ${JSON.stringify(rs.missing.map(m => m.group))}`);
      if (checkWire(c, eStart).ok) bad(tp, `étape ${i + 1} : déjà validée sans câblage`);
    } else if (c.type === 'code') {
      const rc = checkCode(c, eSol); if (!rc.ok) bad(tp, `étape ${i + 1} : la solution échoue (${rc.why} ${JSON.stringify(rc.missing || rc.errors)})`);
    } else if (c.type === 'quiz') {
      c.options.forEach((o, k) => both(o, `étape ${i + 1} option ${k + 1}`, tp));
      if ([].concat(c.answer).some(a => !(a >= 0 && a < c.options.length))) bad(tp, `étape ${i + 1} : réponse hors des options`);
      if (!checkQuiz(c, c.answer).ok) bad(tp, `étape ${i + 1} : quiz incohérent`);
    } else if (c.type === 'watch') {
      for (const n of [...Object.keys(c.when || {}), ...Object.keys(c.expect || {})]) if (!sol.comps.some(x => x.name === n)) bad(tp, `étape ${i + 1} : composant ${n} absent`);
    } else if (c.type === 'measure') {
      const v = expectedMeasure(c, eSol);
      if (solveDC) { if (v == null) bad(tp, `étape ${i + 1} : mesure non calculable`); else console.log(`    mesure étape ${i + 1} : ${v.toFixed(2)} ${c.unit}`); }
    } else if (c.type !== 'info') bad(tp, `étape ${i + 1} : type ${c.type} inconnu`);
  });
}
console.log(failures ? `\n${failures} problème(s).` : '\nTous les TP sont valides.');
process.exit(failures ? 1 : 0);
