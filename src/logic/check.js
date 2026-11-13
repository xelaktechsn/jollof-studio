// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique : contrôles automatiques des TP. Indépendant de l'interface (mêmes contrôles dans
// l'application et dans node src/lab/validate.mjs).
// Contrôles (étape « check » d'un TP de logique) :
//   { type: 'logic-table', inputs: ['A','B'], outputs: { S: 'A^B' | '0110' } }   table de vérité du circuit
//   { type: 'logic-seq', steps: [{ set: {A: 1}, pulse: 'CLK', times?, rise?, fall?, expect: {Q: 1} }] }   suite d'actions
//   { type: 'logic-parts', allow?: ['nand'], require?: { nand: 1 }, maxGates?: 4 }   éléments utilisés
//   { type: 'expr', vars: ['A','B'], answer: 'A^B', form?: 'sop'|'pos'|'product'|'noxor', maxTerms?, output?: 'S' }
//                                                         équation écrite par l'élève (toute forme équivalente, ou la forme imposée)
//   { type: 'table-fill', inputs: ['A','B'], outputs: { S: '0110' } }   table remplie par l'élève
// Les entrées et sorties sont désignées par leur repère (A, B, S, CLK…) sur le plan de travail.
import { DEFS } from './elements.js';
import { truthTable, runSequence, LogicSim } from './sim.js';
import { flatten } from './blocks.js';
import { parse, column, expected, varsOf } from './boolean.js';

const TXT = ['0', '1', 'x', 'z'];
/** Table du circuit comparée à la table attendue. Rend { ok, why, rows: [{ in, want: {S: '1'}, got: {S: '0'}, ok }], ... }. */
export function checkLogicTable(check, circuit) {
  const outNames = Object.keys(check.outputs || {});
  const T = truthTable(circuit, { ins: check.inputs, outs: outNames, others: 0 }); // entrées non citées : à 0
  if (T.missingIn.length) return { ok: false, why: 'missingIn', names: T.missingIn };
  if (T.missingOut.length) return { ok: false, why: 'missingOut', names: T.missingOut };
  if (T.tooMany) return { ok: false, why: 'tooMany' };
  const want = Object.fromEntries(outNames.map(n => [n, expected(check.outputs[n], check.inputs)]));
  const rows = T.rows.map((r, k) => {
    const w = {}, g = {}; let ok = true;
    outNames.forEach((n, j) => { w[n] = want[n][k]; g[n] = TXT[r.out[j]]; if (w[n] !== 'x' && w[n] !== g[n]) ok = false; });
    return { in: r.in, want: w, got: g, ok };
  });
  const bad = rows.filter(r => !r.ok);
  const unknown = bad.length && bad.every(r => Object.values(r.got).some(v => v === 'x' || v === 'z'));
  return { ok: !bad.length, why: bad.length ? (unknown ? 'unknown' : 'mismatch') : null, rows, bad: bad.length, inputs: check.inputs, outputs: outNames, seq: T.seq };
}
/** Suite d'actions : chaque pas doit donner les sorties attendues. */
export function checkLogicSeq(check, circuit) {
  const res = runSequence(circuit, check.steps || []);
  const first = res.findIndex(r => !r.ok);
  if (first < 0) return { ok: true, steps: res };
  const r = res[first];
  return { ok: false, why: r.missing.length ? 'missing' : 'mismatch', step: first, names: r.missing, bad: r.bad, got: r.got, want: check.steps[first].expect || {}, steps: res };
}
/**
 * Portes et circuits utilisés (les entrées, sorties, nœuds, étiquettes et textes ne comptent pas).
 * Les blocs faits par l'élève comptent pour ce qu'ils contiennent ; leur nombre est rangé sous « block ».
 */
export function usedParts(circuit) {
  const n = {};
  for (const e of flatten(circuit).elements) {
    const d = DEFS[e.type]; if (!d || e.port) continue;
    if (e.type === 'block') { n.block = (n.block || 0) + 1; continue; }
    if (['in', 'out', 'wire', 'deco', 'const'].includes(d.kind)) continue;
    n[e.type] = (n[e.type] || 0) + 1;
  }
  return n;
}
export function checkLogicParts(check, circuit) {
  const used = usedParts(circuit), types = Object.keys(used);
  const forbidden = check.allow ? types.filter(t => t !== 'block' && !check.allow.includes(t)) : []; // un bloc est jugé sur son contenu
  if (forbidden.length) return { ok: false, why: 'forbidden', types: forbidden };
  const missing = Object.entries(check.require || {}).filter(([t, k]) => (used[t] || 0) < k).map(([t]) => t);
  if (missing.length) return { ok: false, why: 'missing', types: missing };
  const total = Object.entries(used).reduce((a, [t, k]) => a + (t === 'block' ? 0 : k), 0);
  if (check.maxGates != null && total > check.maxGates) return { ok: false, why: 'tooMany', total, max: check.maxGates };
  return { ok: true, used, total };
}
/**
 * Forme d'une équation : 'sop' somme de produits, 'pos' produit de sommes, 'product' un seul produit
 * de littéraux, 'noxor' sans OU exclusif. (Une forme équivalente mais autrement écrite est refusée.)
 */
export function exprForm(form, e) {
  if (typeof e === 'string') e = parse(e);
  const isLit = x => x.op === 'var' || x.op === 'const' || (x.op === 'not' && (x.a.op === 'var' || x.a.op === 'const'));
  const flat = (x, op) => (x.op === op ? [...flat(x.a, op), ...flat(x.b, op)] : [x]);
  const has = (x, op) => x.op === op || (!!x.a && has(x.a, op)) || (!!x.b && has(x.b, op));
  const prod = x => flat(x, 'and').every(isLit), sum = x => flat(x, 'or').every(isLit);
  if (form === 'sop') return !has(e, 'xor') && flat(e, 'or').every(prod);
  if (form === 'pos') return !has(e, 'xor') && flat(e, 'and').every(sum);
  if (form === 'product') return prod(e);
  if (form === 'noxor') return !has(e, 'xor');
  return true;
}
/** Équation écrite : même table que la réponse sur les variables du TP (et la forme demandée, s'il y en a une). */
export function checkExpr(check, answer) {
  const src = String(answer ?? '').trim();
  if (!src) return { ok: false, why: 'empty' };
  let e;
  try { e = parse(src); } catch (err) { return { ok: false, why: 'syntax', msg: err.message, ch: err.ch, at: err.at }; }
  const extra = [...varsOf(e)].filter(v => !check.vars.includes(v));
  if (extra.length) return { ok: false, why: 'vars', names: extra };
  if (column(e, check.vars) !== column(check.answer, check.vars)) return { ok: false, why: 'wrong' };
  if (check.form && !exprForm(check.form, e)) return { ok: false, why: 'form', form: check.form };
  const terms = (x => { const f = y => (y.op === 'or' ? [...f(y.a), ...f(y.b)] : [y]); return f(x).length; })(e);
  if (check.maxTerms && terms > check.maxTerms) return { ok: false, why: 'long', terms, max: check.maxTerms };
  return { ok: true };
}
/** Table remplie : answer = { S: '0110' } (chaîne de 0, 1, ou ? pour une case vide). */
export function checkTableFill(check, answer) {
  const a = answer || {}, bad = [];
  for (const [n, spec] of Object.entries(check.outputs)) {
    const want = expected(spec, check.inputs), got = String(a[n] || '');
    for (let k = 0; k < want.length; k++) if (want[k] !== 'x' && got[k] !== want[k]) bad.push([n, k]);
  }
  const empty = bad.some(([n, k]) => !/[01]/.test(String(a[n] || '')[k] || ''));
  return { ok: !bad.length, why: bad.length ? (empty ? 'empty' : 'mismatch') : null, bad };
}
/** Le circuit est-il vide de tout câblage (un TP ne doit pas être réussi d'avance) ? */
export const wired = circuit => (circuit.wires || []).length > 0;
export { LogicSim };
