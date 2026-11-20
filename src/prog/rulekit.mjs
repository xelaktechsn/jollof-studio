// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outils des tests des règles (Node seulement) : un montage câblé automatiquement (comme « Câbler automatiquement »),
// des règles écrites en peu de mots, le programme généré, sa compilation par arduino-cli (avertissements -Wall -Wextra
// du croquis, flash et RAM) et son exécution par l'interpréteur.
//   const M = bench('uno', ['button', 'led-red', 'servo']);       // composants nommés BTN1, LED1, SERVO1…
//   const code = M.code([rule(M.src('BTN1'), [act(M.c('LED1'), 'on')], [act(M.c('LED1'), 'off')])]);
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Les modèles 3D dessinent leurs étiquettes sur des canvas : un document factice suffit sous Node.
const noop = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => noop, set: () => true });
globalThis.document = globalThis.document || { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
const THREE = await import('three');
const { BY_ID } = await import('../library/catalog.js');
const { pinKeys } = await import('../check/load.js');
const { analyze, inspect } = await import('../sim/circuit.js');
const { planWiring } = await import('../sim/autowire.js');
const { partOf } = await import('../sim/parts.js');
const { INPUTS } = await import('../sim/models.js');
const R = await import('./rules.js');
const V3 = THREE.Vector3;

/** Montage : la carte `boardType` et les composants `types`, câblés automatiquement. Rend { comps, wires, board, c(nom), cx(rules, states), code(rules, states) }. */
export function bench(boardType, types = []) {
  const S = { comps: [], wires: [], n: 0, errors: [] };
  const same = (x, y) => !!x && !!y && x.comp === y.comp && x.key === y.key;
  const nextName = type => { const p = BY_ID[type].pre; let n = 1; while (S.comps.some(c => c.name === p + n)) n++; return p + n; };
  const create = type => {
    const group = new THREE.Group(), att = {};
    BY_ID[type].build({ g: group, pin: (name, mesh, at) => { let k = name, n = 2; while (att[k]) k = `${name} (${n++})`; att[k] = at ? at.clone() : new V3(); } });
    const keys = Object.keys(att).length ? Object.keys(att) : pinKeys(type);
    const c = { id: `${type}_${S.n++}`, type, name: nextName(type), group, pins: {}, inp: { ...(INPUTS[type] || {}) } };
    for (const k of keys) c.pins[k] = { attach: att[k] || new V3() };
    group.updateMatrixWorld(true); S.comps.push(c); return c;
  };
  const placeFree = (comp, ox = 0, oz = 0, r0 = 20, dr = 4) => {
    const others = S.comps.filter(c => c !== comp).map(c => new THREE.Box3().setFromObject(c.group).expandByScalar(4));
    const size = new THREE.Box3().setFromObject(comp.group).getSize(new V3());
    for (let i = 0; i < 400; i++) {
      const a = i * 0.7, r = i === 0 ? 0 : r0 + i * dr, x = Math.round(ox + Math.cos(a) * r), z = Math.round(oz + Math.sin(a) * r);
      const b = new THREE.Box3(new V3(x - size.x / 2, 0, z - size.z / 2), new V3(x + size.x / 2, size.y, z + size.z / 2));
      if (!others.some(o => o.intersectsBox(b))) { comp.group.position.set(x, 0, z); comp.group.updateMatrixWorld(true); return; }
    }
  };
  const pinWorld = r => { r.comp.group.updateMatrixWorld(true); return r.comp.group.localToWorld(r.comp.pins[r.key].attach.clone()); };
  const busy = r => S.wires.some(w => same(w.a, r) || same(w.b, r));
  const ctx = board => ({ board, A: analyze(S.comps, S.wires), wires: S.wires, comps: S.comps, dist: (a, b) => pinWorld(a).distanceTo(pinWorld(b)) });
  const addBreadboard = board => { const c = create('breadboard'), q = board.group.position, d = new THREE.Box3().setFromObject(board.group).getSize(new V3()).z; placeFree(c, q.x, q.z + d / 2 + 48, 8, 1.5); };
  const apply = (plan, comp, board) => {
    plan.remove.forEach(w => { const i = S.wires.indexOf(w); if (i >= 0) S.wires.splice(i, 1); });
    const made = {}, p = comp.group.position, q = board.group.position;
    plan.create.forEach(h => { const c = create(h.type); placeFree(c, p.x + (q.x - p.x) * 0.35, p.z + (q.z - p.z) * 0.35, 8, 1.5); made[h.id] = c; });
    const Rf = r => (r.h ? { comp: made[r.h], key: r.key } : r);
    plan.wires.forEach(s => { const a = Rf(s.a), b = Rf(s.b); if (!a.comp || !b.comp || !a.comp.pins[a.key] || !b.comp.pins[b.key] || busy(a) || busy(b)) return; S.wires.push({ a, b, progress: 1 }); });
    return made;
  };
  const wire = (comp, board, depth = 0) => {
    if (depth > 4) return;
    let plan = planWiring(comp, ctx(board));
    if (plan.needBreadboard) { addBreadboard(board); plan = planWiring(comp, ctx(board)); }
    if (plan.error || plan.needBreadboard) { S.errors.push(plan.error || `${comp.name} : câblage impossible`); return; }
    const made = apply(plan, comp, board);
    plan.then.forEach(t => wire(t.h ? made[t.h] : t.comp, board, depth + 1));
  };
  const board = create(boardType);
  for (const t of types) { const c = create(t); placeFree(c, 0, 0); wire(c, board); }
  const c = name => S.comps.find(x => x.name === name) || null;
  const cx = (rules = [], states = {}) => {
    const A = analyze(S.comps, S.wires), cache = new Map();
    return { comps: S.comps, A, inspect: k => cache.get(k) || (cache.set(k, inspect(k, A, partOf(k))), cache.get(k)), rules: rules.map(r => R.migrate(JSON.parse(JSON.stringify(r)))), states };
  };
  return { ...S, board, c, cx, code: (rules, states) => R.generate(board, cx(rules, states)), src: (name, sig) => { const k = c(name); return { comp: k.id, sig: sig || Object.keys(R.SIGNALS[k.type])[0] }; } };
}

/* ---------- Règles en peu de mots ---------- */
let n = 0;
const id = p => `${p}${(++n).toString(36)}`;
/** Règle : rule(src, then, else, { op, v, edge, hold, hyst, more… }). src : { comp, sig } | { var } | { every } | null. */
export const rule = (src, then = [], els = [], o = {}) => ({ kind: 'rule', id: id('r'), src, op: o.op || (src && src.every ? '>' : '=='), v: o.v ?? 1, from: o.from || [0, 100], then, else: els, ...o });
export const act = (c, a, arg, o = {}) => ({ kind: 'act', id: id('a'), comp: c ? (typeof c === 'string' ? c : c.id) : null, act: a, arg: arg ?? (c && typeof c === 'object' ? R.defArg(c.type, a) : null), ...o });
export const wait = ms => ({ kind: 'wait', id: id('w'), ms });
export const set = (v, op, val, o = {}) => ({ kind: 'set', id: id('s'), var: v.id, op, v: val, ...o });
export const goTo = (q, step) => ({ kind: 'goto', id: id('g'), seq: q.id, step: step ? step.id : null });
export const variable = (name, type = 'int', init = 0, o = {}) => ({ kind: 'var', id: id('v'), name, type, init, ...o });
export const seq = (name, steps, o = {}) => ({ kind: 'seq', id: id('q'), name, steps, ...o });
export const step = (name, doList = [], go = []) => ({ kind: 'step', id: id('e'), name, do: doList, go });
export const go = (to, { after = 0, when = null } = {}) => ({ kind: 'go', id: id('t'), after, when, to: to ? to.id : null });

/**
 * Règles d'un atelier connecté (réseau, rules-net.js) sur un montage qui a POT1 et LED1 : la position publiée toutes
 * les 2 s, un compteur publié quand il change, page web (position, état de la LED), messages « ON » / « OFF » du sujet
 * atelier/led, nombre reçu sur atelier/seuil écrit sur le moniteur série, demande « /on », « bonjour » à la connexion.
 */
export function netRules(M) {
  const L = M.c('LED1'), POT = M.c('POT1'), n = variable('compte', 'int', 0);
  return [n,
    rule({ every: 2000 }, [act('@net', 'publish', null, { topic: 'atelier/pot', what: { comp: POT.id, sig: 'pos' } })]),
    rule(null, [act('@net', 'publish', null, { topic: 'atelier/compte', what: { var: n.id } }), act('@net', 'page', null, { what: { comp: POT.id, sig: 'pos' } })]),
    rule({ comp: '@net', sig: 'msg', topic: 'atelier/led' }, [act(L, 'on'), act('@net', 'page', 'LED allumée'), set(n, '+', 1)], [], { op: '==', v: 'ON' }),
    rule({ comp: '@net', sig: 'msg', topic: 'atelier/led' }, [act(L, 'off'), act('@net', 'page', 'LED éteinte')], [], { op: '==', v: 'OFF' }),
    rule({ comp: '@net', sig: 'num', topic: 'atelier/seuil' }, [act('@serial', 'show', null, { what: { comp: '@net', sig: 'num', topic: 'atelier/seuil' } })], [], { op: 'any' }),
    rule({ comp: '@net', sig: 'page' }, [act(L, 'on')], [], { op: '==', v: 'on' }),
    rule({ comp: '@net', sig: 'mqtt' }, [act('@net', 'publish', 'bonjour', { topic: 'atelier/etat' })], [], { op: '==', v: 1 })
  ];
}

/* ---------- Compilation par arduino-cli ---------- */
export const hasCli = spawnSync('arduino-cli', ['version']).status === 0;
export const FQBN = { uno: 'arduino:avr:uno', nano: 'arduino:avr:nano', mega: 'arduino:avr:mega', pico: 'rp2040:rp2040:rpipico', esp32: 'esp32:esp32:esp32' };
const CACHE = path.join(os.tmpdir(), 'jollof-rules-cc');
// Dossiers de compilation (plusieurs dizaines de Mo pour l'ESP32) : effacés à la fin du processus, seuls les résultats restent.
const temp = new Set();
process.once('exit', () => { for (const d of temp) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* déjà parti */ } } });
/**
 * Compile src pour fqbn avec -Wall -Wextra (--warnings all). Rend { ok, warnings: [lignes du croquis], errors, flash, ram }.
 * Résultats gardés en cache (dossier temporaire) d'après le texte du programme ; un seul dossier de compilation par carte.
 */
export function compile(src, fqbn) {
  const h = crypto.createHash('sha1').update(fqbn + '\n' + src).digest('hex').slice(0, 16), memo = path.join(CACHE, 'results', h + '.json');
  if (fs.existsSync(memo)) return JSON.parse(fs.readFileSync(memo, 'utf8'));
  const dir = path.join(CACHE, 'sk_' + process.pid, 'jx');
  temp.add(path.join(CACHE, 'sk_' + process.pid)); temp.add(path.join(CACHE, 'build_' + fqbn.replace(/:/g, '_') + '_' + process.pid));
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'jx.ino'), src);
  const r = spawnSync('arduino-cli', ['compile', '-b', fqbn, '--warnings', 'all', '--build-path', path.join(CACHE, 'build_' + fqbn.replace(/:/g, '_') + '_' + process.pid), dir], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''), lines = out.split('\n');
  const res = {
    ok: r.status === 0,
    warnings: lines.filter(l => /jx\.ino:\d+:\d+: warning/.test(l)).map(l => l.replace(/^.*jx\.ino/, 'jx.ino')),
    errors: lines.filter(l => /jx\.ino:\d+:\d+: (fatal )?error|error:/.test(l)).slice(0, 10).map(l => l.replace(/^.*jx\.ino/, 'jx.ino')),
    flash: +((/(?:utilise|uses) (\d+) (?:octets|bytes)/.exec(out) || [])[1] || 0), ram: +((/(?:globales utilisent|variables use) (\d+) (?:octets|bytes)/.exec(out) || [])[1] || 0)
  };
  if (res.ok) { fs.mkdirSync(path.dirname(memo), { recursive: true }); const tmp = `${memo}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(res)); fs.renameSync(tmp, memo); } // renommage atomique : un autre processus ne lit jamais un résultat à moitié écrit // un échec n'est pas gardé (disque plein…)
  else res.errors.push(...lines.filter(l => /too big|trop gros|No space|ENOSPC|exceed/i.test(l)).slice(0, 3));
  return res;
}
