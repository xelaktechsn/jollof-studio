// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mesures de performance des calculs de Jollof Studio, sous Node (sans navigateur ni carte graphique) :
// rangement des fils, plans de caméra, synoptique, guide illustré, vérificateur sur les projets d'exemple.
//   node scripts/bench.mjs            affiche le tableau
//   node scripts/bench.mjs --json     le rend en JSON (pour comparer deux versions)
// Chaque mesure est la médiane de plusieurs passes après une passe d'échauffement. Les montages d'essai sont
// produits par un générateur à graine fixe : mêmes entrées à chaque lancement. Les résultats publiés, avec la
// machine et la date, sont dans docs/PERFORMANCE.md.
import fs from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { routeWires } from '../src/sim/wiring.js';
import { planAll } from '../src/video/planner.js';
import { synopticSvg } from '../src/schematic/synoptic.js';
import { guideHtml } from '../src/export/guide.js';
import { loadProject } from '../src/check/load.js';
import { checkProject } from '../src/check/check.js';

/** Générateur pseudo-aléatoire à graine (mulberry32) : les mêmes montages à chaque lancement. */
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function median(xs) { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function time(fn, runs = 7) { fn(); const t = []; for (let i = 0; i < runs; i++) { const a = performance.now(); fn(); t.push(performance.now() - a); } return median(t); }

/** Montage d'essai : composants en grille (pas de 60 mm), n fils entre broches de composants voisins ou éloignés. */
function circuit(n, seed = 1) {
  const R = rng(seed), side = Math.max(2, Math.ceil(Math.sqrt(n / 4))), comps = [];
  for (let i = 0; i < side * side; i++) { const x = (i % side) * 60, z = Math.floor(i / side) * 60, h = 6 + Math.floor(R() * 14); comps.push({ id: 'c' + i, x, z, h }); }
  const pin = c => ({ x: c.x - 15 + Math.floor(R() * 13) * 2.54, y: c.h, z: c.z + (R() < 0.5 ? -8 : 8) });
  const wires = [];
  for (let i = 0; i < n; i++) {
    const a = comps[Math.floor(R() * comps.length)]; let b = comps[Math.floor(R() * comps.length)]; if (b === a) b = comps[(comps.indexOf(a) + 1) % comps.length];
    wires.push({ id: 'w' + (i + 1), A: pin(a), B: pin(b), own: [a.id, b.id] });
  }
  return { comps, wires };
}
const routeInput = c => ({ items: c.wires.map((w, i) => ({ id: i, A: w.A, B: w.B, own: new Set(w.own) })), boxes: c.comps.map(k => ({ comp: k.id, x0: k.x - 20, z0: k.z - 10, x1: k.x + 20, z1: k.z + 10, top: k.h })) });
const planInput = c => ({ wires: c.wires.map(w => { const a = [w.A.x, w.A.y, w.A.z], b = [w.B.x, w.B.y, w.B.z]; return { id: w.id, a, b, pts: [a, [a[0], a[1] + 12, a[2]], [b[0], a[1] + 12, b[2]], b] }; }), boxes: c.comps.map(k => ({ min: [k.x - 20, 0, k.z - 10], max: [k.x + 20, k.h, k.z + 10] })) });

const rows = [];
const add = (group, name, ms, note = '') => rows.push({ group, name, ms: +ms.toFixed(ms < 10 ? 2 : 1), note });

for (const n of [20, 100, 300, 1000]) { const c = circuit(n), i = routeInput(c); add('Rangement des fils', `${n} fils`, time(() => routeWires(i.items.map(x => ({ ...x, own: new Set(x.own) })), i.boxes), n > 300 ? 3 : 7), `${c.comps.length} composants`); }
for (const n of [20, 100, 300, 1000]) { const c = circuit(n), i = planInput(c); let shots = 0; const ms = time(() => { shots = planAll(i.wires, i.boxes).shots.length; }, n > 300 ? 3 : 7); add('Plans de caméra', `${n} fils`, ms, `${shots} plans`); }
for (const n of [10, 50, 200]) {
  const blocks = [{ id: 'u', name: 'UNO', model: 'Carte', role: 'board' }, ...Array.from({ length: n }, (_, i) => ({ id: 'b' + i, name: 'M' + i, model: 'Module', role: i % 2 ? 'in' : 'out' }))];
  const nets = blocks.slice(1).map((b, i) => ({ name: 'D' + i, kind: 'sig', pins: [['u', 'D' + i], [b.id, 'S']] }));
  add('Synoptique', `${n} blocs`, time(() => synopticSvg({ title: 't', blocks, nets })));
}
{
  const px = 'data:image/jpeg;base64,' + 'A'.repeat(140000); // une image de la taille de celles du guide (≈ 100 Ko)
  for (const n of [10, 100]) {
    const steps = Array.from({ length: n }, (_, i) => ({ img: px, a: { comp: 'UNO', pin: 'D' + i }, b: { comp: 'M' + i, pin: 'S' }, color: '#e5484d', colorName: 'Rouge' }));
    add('Guide illustré (mise en page)', `${n} étapes`, time(() => guideHtml({ title: 't', cover: px, steps, comps: [], checked: true, issues: [] }), 5));
  }
}
// Vérificateur : chaque projet d'exemple qui a un montage, programme compris quand il est enregistré avec le projet.
const EX = new URL('../exemples/', import.meta.url);
for (const f of fs.readdirSync(EX).filter(f => f.endsWith('.jollof')).sort()) {
  let data; try { data = JSON.parse(fs.readFileSync(new URL(f, EX), 'utf8')); } catch { continue; }
  if (!(data.comps || []).length) continue;
  try {
    const proj = loadProject(data); let r = null;
    const ms = time(() => { r = checkProject(proj); }, 3);
    add('Vérificateur', f.replace(/\.jollof$/, ''), ms, `${data.comps.length} composants, ${(data.wires || []).length} fils${r && r.states ? `, ${Number(r.states).toLocaleString('fr-FR')} états` : ''}`);
  } catch (e) { add('Vérificateur', f.replace(/\.jollof$/, ''), NaN, 'non mesuré : ' + String(e.message || e).slice(0, 60)); }
}

const env = { node: process.version, cpu: os.cpus()[0].model.trim(), cores: os.cpus().length, os: `${os.type()} ${os.release()} ${os.arch()}`, date: new Date().toISOString().slice(0, 10) };
if (process.argv.includes('--json')) console.log(JSON.stringify({ env, rows }, null, 1));
else {
  console.log(`# ${env.date} · ${env.cpu} (${env.cores} cœurs) · ${env.os} · Node ${env.node}\n`);
  let g = '';
  for (const r of rows) { if (r.group !== g) { g = r.group; console.log(`\n${g}`); } console.log(`  ${r.name.padEnd(34)} ${(Number.isFinite(r.ms) ? r.ms + ' ms' : '—').padStart(11)}   ${r.note}`); }
}
