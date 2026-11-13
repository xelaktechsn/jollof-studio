// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Travaux pratiques : contrôle automatique de chaque étape. Indépendant de l'interface : le même
// code vérifie un TP dans l'application et dans les tests (Node), avec un environnement fourni.
//
// Format d'un TP (src/lab/tp/*.json) :
// { id, level: 'college'|'lycee'|'pro', minutes, title: {fr,en}, summary: {fr,en},
//   objectives: [{fr,en}], start: <projet .jollof sans fils>, solution: { wires: [...], code: {…} },
//   steps: [{ title: {fr,en}, text: {fr,en}, hint?: {fr,en}, check?: Check }] }
// Check :
//   { type: 'wire', nets: [["UNO.D7","R1.1"], …] }               liaisons présentes (broches d'un même nœud)
//   { type: 'code', board?: 'UNO', must: ["regex", …], compile: true } programme de la carte
//   { type: 'watch', when?: { BTN1: 'pressed' }, expect: { LED1: 'on' }, hold?: 400 } comportement observé en simulation
//   { type: 'measure', unit: 'V'|'mA'|'s', probe?: ["LED1.A","UNO.GND"], part?: 'LED1', tolerance?: 0.12, state?: {"UNO.D7": 1}, expect?: 1.0 }
//     (expect : valeur fixée, par exemple une durée lue sur le traceur série, au lieu d'un calcul du circuit)
//   { type: 'quiz', options: [{fr,en}], answer: n | [n…] }
//   { type: 'pneu-tube', tubes: [["src:1","v1:1"], …] }   tuyaux du plan pneumatique (orifices « élément:orifice » reliés)
//   watch : « expect » peut aussi viser un vérin du plan pneumatique par son identifiant : { c1: 'out' | 'in' }
//   { type: 'pneu-seq', when?: { dcy: 'pressed' }, expect: ["A+", "B+", "A-", "B-"] }  cycle des vérins observé
//     (repères des vérins ; « when » : boutons à maintenir, distributeurs du plan ou pupitre du GRAFCET)
// Contrôles d'un TP qui part de rien (tutoriel) : rien n'y dépend des identifiants que l'application donne.
//   { type: 'parts', require: [{ board: true }, { type: 'coil24', name: 'Y1' }, …] }   composants du montage
//   { type: 'wired' }                                    tout est câblé, sans erreur de câblage
//   { type: 'pneu-parts', require: [{ type: 'v52', p: { left: 'sol', coilL: 'Y1' } }, …] }   éléments du plan
//   pneu-tube : un orifice « ~v52:4 » désigne l'orifice 4 de n'importe quel distributeur 5/2 du plan
//   { type: 'grafcet', outputs: ['Y1'], reads: ['B2'], minSteps?: 2 }   GRAFCET lisible, qui commande et lit ces repères
//   { type: 'ui', need: ['sim', 'split'] }               état de l'interface (simulation lancée, vue partagée…)
// Les noms (UNO, R1, LED1…) sont les repères des composants du montage de départ.

import { hasSequence, normMove, expectOf } from '../pneu/seq.js';
import { BOARDS } from '../sim/boards.js';
import { partOf } from '../sim/parts.js';
import { inspect } from '../sim/circuit.js';
import { needsWiring } from '../sim/autowire.js';
import { props as pneuProps } from '../pneu/elements.js';
import { compiled } from '../pneu/run.js';

const low = v => String(v ?? '').trim().toLowerCase();

/** Composant et broche désignés par « REPÈRE.BROCHE ». */
export function refOf(comps, s) {
  const i = s.indexOf('.'), name = s.slice(0, i), key = s.slice(i + 1);
  const comp = comps.find(c => c.name === name);
  return comp && comp.pins[key] ? { comp, key } : null;
}
const same = (a, b) => a.comp === b.comp && a.key === b.key;

/**
 * Liaisons demandées : chaque groupe de broches doit former un même nœud. Une broche peut avoir
 * des variantes : « R1.1|R1.2 » (l'une ou l'autre : une résistance se pose dans les deux sens),
 * « UNO.GND* » (toute broche dont le nom commence ainsi : une carte a plusieurs GND).
 */
export function candidates(comps, s) {
  return s.split('|').flatMap(alt => {
    if (!alt.endsWith('*')) { const r = refOf(comps, alt); return r ? [r] : []; }
    const i = alt.indexOf('.'), name = alt.slice(0, i), pre = alt.slice(i + 1, -1), comp = comps.find(c => c.name === name);
    return comp ? Object.keys(comp.pins).filter(k => k.startsWith(pre)).map(key => ({ comp, key })) : [];
  });
}
export function checkWire(check, env) {
  const A = env.analyze(), comps = env.comps(), missing = [], found = [];
  for (const group of check.nets) {
    const alts = group.map(p => candidates(comps, p));
    if (alts.some(a => !a.length)) { missing.push({ group, why: 'absent' }); continue; }
    // Un nœud qui contient une variante de chaque broche du groupe.
    const net = alts[0].map(r0 => A.members(r0)).find(mem => alts.every(a => a.some(r => mem.some(m => same(m, r)))));
    if (!net) { missing.push({ group, why: 'open' }); continue; }
    found.push({ group, net });
  }
  // Composant à variantes (« R1.1|R1.2 ») présent dans plusieurs groupes : ses deux côtés doivent être
  // dans des nœuds différents, sinon il est court-circuité (les deux fils sur la même patte…).
  const multi = new Map();
  for (const f of found) for (const p of f.group) if (p.includes('|')) { const name = p.split('.')[0]; if (!multi.has(name)) multi.set(name, []); multi.get(name).push(f); }
  for (const [name, fs] of multi) if (fs.length > 1 && fs.every(f => f.net === fs[0].net || f.net.some(m => fs[0].net.includes(m)))) missing.push({ group: fs.map(f => f.group.join(' ↔ ')), why: 'short', comp: name });
  return { ok: !missing.length, missing };
}
/** Programme : il compile et contient ce qui est demandé. */
export function checkCode(check, env) {
  const p = env.program(check.board);
  if (!p || !p.code.trim()) return { ok: false, why: 'empty' };
  const missing = (check.must || []).filter(rx => !new RegExp(rx, 'm').test(p.code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  if (check.compile !== false) {
    const r = env.compile(p.code, p.kind);
    if (!r.ok) return { ok: false, why: 'compile', errors: r.errors, missing };
  }
  return { ok: !missing.length, why: missing.length ? 'missing' : null, missing };
}
/** État observable d'un composant : bouton appuyé, LED allumée, buzzer qui sonne… */
export function observe(comp) {
  if (!comp) return null;
  if (comp.type === 'button' || comp.type === 'cylsensor' || comp.type === 'pressostat') return comp.inp && comp.inp.pressed ? 'pressed' : 'released';
  if (comp.led) return comp.led.mat.emissiveIntensity > 0.25 ? 'on' : 'off';
  if (comp.actR && comp.actR.live != null) return comp.actR.live ? 'on' : 'off';
  return null;
}
/** Vérin du plan pneumatique : 'out' (tige sortie), 'in' (rentrée), 'moving' entre les deux, ou null. */
export function observePneu(env, id) {
  const st = env.pneuState ? env.pneuState() : null, c = env.pneu ? env.pneu() : null;
  // Élément par son identifiant, ou vérin par son repère (1A) : un TP qui part de rien ne connaît pas les identifiants.
  const base = id.replace(/:R$/, ''), e = c && (c.elements.find(x => x.id === base) || c.elements.find(x => /^cyl/.test(x.type) && low(pneuProps(x).label) === low(base)));
  if (e && e.id !== base) id = e.id;
  // Bouton du pupitre du GRAFCET (dcy…) : appuyé ou relâché.
  if (!e && c && env.pneuInput && env.pneuInput(base)) return env.pneuPushed && env.pneuPushed(id) ? 'pressed' : 'released';
  if (!st || !e) return null;
  // Bouton poussoir d'un distributeur (« v1 », ou « v1:R » côté 12) : appuyé ou relâché.
  if (/^v/.test(e.type)) return env.pneuPushed && env.pneuPushed(id) ? 'pressed' : 'released';
  const x = st.x[id] || 0;
  return x >= 0.98 ? 'out' : x <= 0.02 ? 'in' : 'moving';
}
/** Comportement : quand la condition « when » est vraie, « expect » doit l'être aussi. */
export function checkWatch(check, env) {
  const comps = env.comps(), byName = n => comps.find(c => c.name === n);
  const look = n => { const c = byName(n); return c ? observe(c) : observePneu(env, n); };
  const when = Object.entries(check.when || {}), expect = Object.entries(check.expect || {});
  const cond = when.every(([n, v]) => look(n) === v);
  if (!cond) return { ok: false, waiting: true };
  const bad = expect.filter(([n, v]) => look(n) !== v);
  return { ok: !bad.length, waiting: false, bad: bad.map(([n]) => n) };
}
/** Valeur attendue d'une mesure (calcul du circuit) : tension entre deux points, ou courant. */
export function expectedMeasure(check, env) {
  // Valeur fixée par le TP (durée lue sur le traceur, constante de temps…) : pas de calcul du circuit.
  if (check.expect != null) return +check.expect;
  const r = env.dc(check.state || null);
  if (!r || !r.ok) return null;
  if (check.part) { const c = env.comps().find(x => x.name === check.part); return c ? r.current(c) : null; }
  const [a, b] = (check.probe || []).map(p => refOf(env.comps(), p));
  if (!a) return null;
  const va = r.volts(a), vb = b ? r.volts(b) : 0;
  return va == null || vb == null ? null : va - vb;
}
export function checkMeasure(check, answer, env) {
  const exp = expectedMeasure(check, env), v = parseFloat(String(answer ?? '').replace(',', '.'));
  if (exp == null) return { ok: false, why: 'nosim' };
  if (!Number.isFinite(v)) return { ok: false, why: 'nan', expected: exp };
  const tol = Math.max(Math.abs(exp) * (check.tolerance ?? 0.12), check.unit === 'mA' ? 0.5 : check.unit === 's' ? 0.02 : 0.05);
  return { ok: Math.abs(v - exp) <= tol, expected: exp, got: v };
}
export function checkQuiz(check, answer) {
  const want = [].concat(check.answer).sort().join(','), got = [].concat(answer ?? []).map(Number).sort().join(',');
  return { ok: want === got };
}
/**
 * Orifices désignés : « v1:4 » (cet élément), ou « ~v52:4 » (l'orifice 4 de chaque élément de type v52 du plan).
 */
export function portsOfRef(c, k) {
  if (!k.startsWith('~')) return [k];
  const i = k.lastIndexOf(':'), type = k.slice(1, i), port = k.slice(i + 1);
  return c.elements.filter(e => e.type === type).map(e => `${e.id}:${port}`);
}
/** Tuyaux du plan pneumatique : chaque groupe d'orifices doit être relié par des tuyaux (même réseau d'air). */
export function checkPneuTube(check, env) {
  const c = env.pneu ? env.pneu() : null;
  if (!c) return { ok: false, missing: check.tubes.map(g => ({ group: g, why: 'absent' })) };
  const parent = new Map(), find = k => { if (!parent.has(k)) parent.set(k, k); while (parent.get(k) !== k) k = parent.get(k); return k; };
  for (const t of c.tubes || []) parent.set(find(`${t.a[0]}:${t.a[1]}`), find(`${t.b[0]}:${t.b[1]}`));
  // Un groupe est raccordé si un même réseau d'air contient un orifice désigné par chacun de ses membres.
  const joined = g => { const alts = g.map(k => portsOfRef(c, k).map(find)); return alts.every(a => a.length) && alts[0].some(r => alts.every(a => a.includes(r))); };
  const missing = check.tubes.filter(g => !joined(g)).map(g => ({ group: g, why: 'open' }));
  return { ok: !missing.length, missing };
}
/**
 * Composants du montage : chaque besoin ({ board: true } pour une carte, { type, name } sinon) trouve un composant
 * différent ; le repère se compare sans la casse. Les besoins nommés passent d'abord (un B1 n'est pas pris pour « un capteur »).
 */
export function checkParts(check, env) {
  const comps = env.comps(), used = new Set(), missing = [];
  const need = [...(check.require || [])].sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0));
  for (const n of need) {
    const hit = comps.find(c => !used.has(c) && (n.board ? !!BOARDS[c.type] && (!n.type || c.type === n.type) : c.type === n.type) && (!n.name || low(c.name) === low(n.name)));
    if (hit) used.add(hit); else missing.push(n);
  }
  return { ok: !missing.length, missing };
}
/**
 * Montage terminé : aucun composant n'a de broche obligatoire libre, aucun n'a d'erreur de câblage (même lecture que
 * le vérificateur du câblage, sim/circuit.js). Rend les repères des composants à câbler et de ceux en erreur.
 */
export function benchState(comps, A) {
  const unwired = [], errors = [];
  for (const c of comps) {
    if (needsWiring(c, A)) { unwired.push(c.name); continue; }
    const spec = partOf(c); if (spec && spec.pins && inspect(c, A, spec).level === 'err') errors.push(c.name);
  }
  return { unwired, errors };
}
export function checkWired(check, env) {
  const comps = env.comps();
  if (!comps.length) return { ok: false, why: 'empty', unwired: [], errors: [] };
  const r = benchState(comps, env.analyze());
  return { ok: !r.unwired.length && !r.errors.length, ...r };
}
/**
 * Éléments du plan pneumatique : chaque besoin { type, p } trouve un élément différent dont les réglages valent ceux
 * demandés (sans la casse). wrong : éléments du bon type mais mal réglés, avec les réglages qui diffèrent.
 */
export function checkPneuParts(check, env) {
  const c = env.pneu ? env.pneu() : null, els = c ? c.elements : [], used = new Set(), missing = [], wrong = [];
  const need = [...(check.require || [])].sort((a, b) => Object.keys(b.p || {}).length - Object.keys(a.p || {}).length);
  const fits = (e, n) => Object.entries(n.p || {}).every(([k, v]) => low(pneuProps(e)[k]) === low(v));
  for (const n of need) {
    const of = els.filter(e => !used.has(e) && e.type === n.type), hit = of.find(e => fits(e, n));
    if (hit) { used.add(hit); continue; }
    missing.push(n);
    if (of.length) wrong.push({ need: n, el: of[0].id, diff: Object.keys(n.p || {}).filter(k => low(pneuProps(of[0])[k]) !== low(n.p[k])) });
  }
  return { ok: !missing.length, missing, wrong };
}
/** GRAFCET du plan : au moins minSteps étapes, sans erreur, qui commande « outputs » et lit « reads » (repères). */
export function checkGrafcet(check, env) {
  const c = env.pneu ? env.pneu() : null, C = compiled(c && c.grafcet);
  if (!C || C.stepList.length < (check.minSteps || 2)) return { ok: false, why: 'empty' };
  if (C.errors.length) return { ok: false, why: 'errors', errors: C.errors.map(e => e.text) };
  const outs = new Set([...C.outputs].map(low));
  const outputs = (check.outputs || []).filter(o => !outs.has(low(o))), reads = (check.reads || []).filter(v => !C.vars.has(low(v)));
  if (outputs.length) return { ok: false, why: 'outputs', names: outputs };
  if (reads.length) return { ok: false, why: 'reads', names: reads };
  return { ok: true };
}
/** État de l'interface : env.ui(nom) pour chaque nom demandé (sim, split, pneu, elec, grafcet, 3d). */
export function checkUiState(check, env) {
  const missing = (check.need || []).filter(n => !(env.ui && env.ui(n)));
  return { ok: !missing.length, missing };
}
/** Contrôles qui se vérifient seuls dans un tutoriel (sans rien observer ni répondre) : relus régulièrement. */
export const AUTO_CHECKS = new Set(['parts', 'wired', 'pneu-parts', 'pneu-tube', 'grafcet', 'ui', 'code', 'wire']);
/** Cycle des vérins : moves (mouvements relevés depuis le début de l'observation) contient-il le cycle attendu ? */
export function checkPneuSeq(check, moves) {
  return { ok: hasSequence(moves, check.expect), seen: moves.map(m => normMove(m.name + m.dir)), want: expectOf(check.expect) };
}
/** Toutes les liaisons du TP (étapes « wire ») : la solution de câblage, pour un devoir. */
export const allNets = tp => tp.steps.filter(s => s.check && s.check.type === 'wire').flatMap(s => s.check.nets);
