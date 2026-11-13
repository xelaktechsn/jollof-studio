// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique : bibliothèque, simulation, tables de vérité, équations, contrôles des TP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFS, layoutOf, pinsOf, X, Z } from './elements.js';
import { LogicSim, truthTable, runSequence, isSequential, netlist } from './sim.js';
import { parse, column, simplify, minimize, karnaugh, kGroups, expected } from './boolean.js';
import { checkLogicTable, checkLogicSeq, checkLogicParts, checkExpr, checkTableFill } from './check.js';

let uid = 0;
const el = (type, p = {}, x = 0, y = 0) => ({ id: 'e' + ++uid, type, x, y, r: 0, p });
const w = (a, pa, b, pb) => ({ id: 'w' + ++uid, a: [a.id, pa], b: [b.id, pb] });
/** Circuit à 2 entrées (A, B) et une sortie S passant par une porte. */
function gate2(type, extra = {}) {
  const A = el('switch', { label: 'A' }, 0, 0), B = el('switch', { label: 'B' }, 0, 4), G = el(type, extra, 8, 0), S = el('led', { label: 'S' }, 16, 0);
  return { circuit: { elements: [A, B, G, S], wires: [w(A, 'Q', G, 'A'), w(B, 'Q', G, 'B'), w(G, 'Y', S, 'A')] }, A, B, G, S };
}

test('chaque élément a une géométrie, des broches sur la grille et un symbole dans les deux styles', () => {
  for (const [id, d] of Object.entries(DEFS)) {
    const p = {}; for (const pr of d.props || []) if (pr.def != null) p[pr.k] = pr.def;
    const L = d.layout(p);
    assert.ok(L.w >= 0 && L.h >= 0, id);
    const names = new Set();
    for (const q of L.pins) {
      assert.ok(Number.isInteger(q.x) && Number.isInteger(q.y), `${id}.${q.name} hors grille`);
      assert.ok(!names.has(q.name), `${id} : broche ${q.name} en double`); names.add(q.name);
    }
    for (const style of ['ansi', 'iec']) assert.ok(Array.isArray(d.sym(p, style, null)), id);
    // Toutes les variantes de propriétés entières ou énumérées donnent des broches sur la grille.
    for (const pr of d.props || []) {
      const vals = pr.type === 'int' ? [pr.min, pr.max] : pr.type === 'enum' ? pr.opts.map(o => o[0]) : [];
      for (const v of vals) for (const q of d.layout({ ...p, [pr.k]: v }).pins) assert.ok(Number.isInteger(q.x) && Number.isInteger(q.y), `${id} ${pr.k}=${v} ${q.name}`);
    }
  }
});

test('rotation : les broches tournent avec l’élément', () => {
  const g = el('and', {}, 10, 10), L = layoutOf(g);
  g.r = 90; const p = pinsOf(g).find(q => q.name === 'Y');
  assert.deepEqual([p.wx, p.wy, p.wside], [10 + L.h - 2, 10 + L.w, 'b']);
});

test('portes de base : tables de vérité', () => {
  const want = { and: '0001', or: '0111', nand: '1110', nor: '1000', xor: '0110', xnor: '1001' };
  for (const [type, col] of Object.entries(want)) {
    const T = truthTable(gate2(type).circuit);
    assert.deepEqual(T.ins, ['A', 'B']); assert.deepEqual(T.outs, ['S']);
    assert.equal(T.rows.map(r => r.out[0]).join(''), col, type);
    assert.equal(T.seq, false);
  }
});

test('porte à 3 entrées, niveaux X et Z', () => {
  const A = el('switch', { label: 'A', value: 1 }), B = el('switch', { label: 'B', value: 1 }), G = el('and', { n: 3 }), S = el('led', { label: 'S' });
  const c = { elements: [A, B, G, S], wires: [w(A, 'Q', G, 'A'), w(B, 'Q', G, 'B'), w(G, 'Y', S, 'A')] };
  const sim = new LogicSim(c);
  assert.equal(sim.level(G.id, 'C'), Z); // entrée en l'air
  assert.equal(sim.level(S.id, 'A'), X); // ET avec une entrée inconnue
  assert.deepEqual(sim.floating(), [{ id: G.id, pin: 'C' }]);
  sim.set(A.id, { value: 0 });
  assert.equal(sim.level(S.id, 'A'), 0); // 0 l'emporte sur l'inconnu
});

test('deux sorties sur un même fil : conflit (X)', () => {
  const A = el('const', { value: 1 }), B = el('const', { value: 0 }), S = el('led', { label: 'S' });
  const c = { elements: [A, B, S], wires: [w(A, 'Q', S, 'A'), w(B, 'Q', S, 'A')] };
  const sim = new LogicSim(c);
  assert.equal(sim.level(S.id, 'A'), X);
  assert.equal(sim.conflicts.size, 1);
});

test('tampons 3 états sur un bus : un seul pilote à la fois', () => {
  const A = el('const', { value: 1 }), B = el('const', { value: 0 }), E1 = el('switch', { value: 1 }), E2 = el('switch', { value: 0 }), T1 = el('tri'), T2 = el('tri'), S = el('led', { label: 'S' });
  const c = { elements: [A, B, E1, E2, T1, T2, S], wires: [w(A, 'Q', T1, 'A'), w(B, 'Q', T2, 'A'), w(E1, 'Q', T1, 'EN'), w(E2, 'Q', T2, 'EN'), w(T1, 'Y', S, 'A'), w(T2, 'Y', S, 'A')] };
  const sim = new LogicSim(c);
  assert.equal(sim.level(S.id, 'A'), 1);
  sim.set(E1.id, { value: 0 }); sim.set(E2.id, { value: 1 });
  assert.equal(sim.level(S.id, 'A'), 0);
  sim.set(E2.id, { value: 0 });
  assert.equal(sim.level(S.id, 'A'), Z);
});

test('verrou RS en portes NON-OU : mémoire, état stable à la mise sous tension', () => {
  const S = el('switch', { label: 'S' }), R = el('switch', { label: 'R' }), N1 = el('nor'), N2 = el('nor'), Q = el('led', { label: 'Q' }), QN = el('led', { label: 'QN' });
  const c = { elements: [S, R, N1, N2, Q, QN], wires: [w(R, 'Q', N1, 'A'), w(N2, 'Y', N1, 'B'), w(S, 'Q', N2, 'A'), w(N1, 'Y', N2, 'B'), w(N1, 'Y', Q, 'A'), w(N2, 'Y', QN, 'A')] };
  assert.equal(isSequential(c), true);
  const sim = new LogicSim(c);
  assert.equal(sim.osc, false);
  const q = () => [sim.level(Q.id, 'A'), sim.level(QN.id, 'A')];
  assert.ok(q()[0] !== q()[1]);
  sim.set(S.id, { value: 1 }); assert.deepEqual(q(), [1, 0]);
  sim.set(S.id, { value: 0 }); assert.deepEqual(q(), [1, 0]); // mémorisé
  sim.set(R.id, { value: 1 }); assert.deepEqual(q(), [0, 1]);
  sim.set(R.id, { value: 0 }); assert.deepEqual(q(), [0, 1]);
});

test('oscillateur en anneau : signalé, sans boucle infinie', () => {
  const N = el('not'), S = el('led', { label: 'S' });
  const c = { elements: [N, S], wires: [w(N, 'Y', N, 'A'), w(N, 'Y', S, 'A')] };
  const sim = new LogicSim(c);
  assert.equal(sim.osc, true);
});

test('registre à décalage en bascules D : chaque front n’avance que d’un cran', () => {
  const D = el('switch', { label: 'D' }), H = el('clock', { label: 'CLK' }), F1 = el('dff'), F2 = el('dff'), F3 = el('dff'), Q1 = el('led', { label: 'Q1' }), Q2 = el('led', { label: 'Q2' }), Q3 = el('led', { label: 'Q3' });
  const c = { elements: [D, H, F1, F2, F3, Q1, Q2, Q3], wires: [w(D, 'Q', F1, 'D'), w(F1, 'Q', F2, 'D'), w(F2, 'Q', F3, 'D'), w(H, 'Q', F1, 'CLK'), w(H, 'Q', F2, 'CLK'), w(H, 'Q', F3, 'CLK'), w(F1, 'Q', Q1, 'A'), w(F2, 'Q', Q2, 'A'), w(F3, 'Q', Q3, 'A')] };
  const r = runSequence(c, [
    { set: { D: 1 }, pulse: 'CLK', expect: { Q1: 1, Q2: 0, Q3: 0 } },
    { set: { D: 0 }, pulse: 'CLK', expect: { Q1: 0, Q2: 1, Q3: 0 } },
    { pulse: 'CLK', expect: { Q1: 0, Q2: 0, Q3: 1 } },
    { pulse: 'CLK', expect: { Q3: 0 } }
  ]);
  assert.deepEqual(r.map(x => x.ok), [true, true, true, true], JSON.stringify(r));
});

test('bascule T : diviseur de fréquence ; compteur asynchrone 2 bits', () => {
  const H = el('clock', { label: 'CLK' }), one = el('const', { value: 1 }), T1 = el('tff'), T2 = el('tff'), Q0 = el('led', { label: 'Q0' }), Q1 = el('led', { label: 'Q1' }), N = el('not');
  // Compteur asynchrone : T2 est cadencée par Q̄ de T1 (front montant de Q̄ = front descendant de Q).
  const c = { elements: [H, one, T1, T2, Q0, Q1, N], wires: [w(one, 'Q', T1, 'T'), w(one, 'Q', T2, 'T'), w(H, 'Q', T1, 'CLK'), w(T1, 'QN', T2, 'CLK'), w(T1, 'Q', Q0, 'A'), w(T2, 'Q', Q1, 'A')] };
  const seq = [0, 1, 2, 3, 0, 1].map(n => ({ pulse: 'CLK', expect: { Q0: (n + 1) & 1, Q1: ((n + 1) >> 1) & 1 } }));
  const r = runSequence(c, seq);
  assert.deepEqual(r.map(x => x.ok), seq.map(() => true), JSON.stringify(r));
});

test('bascule JK : maintien, mise à 1, mise à 0, basculement ; entrées asynchrones', () => {
  const J = el('switch', { label: 'J' }), K = el('switch', { label: 'K' }), H = el('button', { label: 'CLK' }), CLR = el('switch', { label: 'CLR' }), F = el('jkff'), Q = el('led', { label: 'Q' });
  const c = { elements: [J, K, H, CLR, F, Q], wires: [w(J, 'Q', F, 'J'), w(K, 'Q', F, 'K'), w(H, 'Q', F, 'CLK'), w(CLR, 'Q', F, 'CLR'), w(F, 'Q', Q, 'A')] };
  const r = runSequence(c, [
    { pulse: 'CLK', expect: { Q: 0 } },
    { set: { J: 1 }, pulse: 'CLK', expect: { Q: 1 } },
    { set: { J: 0 }, pulse: 'CLK', expect: { Q: 1 } },
    { set: { J: 1, K: 1 }, pulse: 'CLK', expect: { Q: 0 } },
    { pulse: 'CLK', expect: { Q: 1 } },
    { set: { CLR: 1 }, expect: { Q: 0 } },
    { set: { CLR: 0, J: 0, K: 1 }, pulse: 'CLK', expect: { Q: 0 } }
  ]);
  assert.deepEqual(r.map(x => x.ok), r.map(() => true), JSON.stringify(r));
});

test('blocs combinatoires : multiplexeur, décodeur, additionneur, 7 segments', () => {
  const S0 = el('switch', { label: 'S' }), I0 = el('switch', { label: 'I0' }), I1 = el('switch', { label: 'I1' }), M = el('mux'), Y = el('led', { label: 'Y' });
  const mux = { elements: [I0, I1, S0, M, Y], wires: [w(I0, 'Q', M, 'I0'), w(I1, 'Q', M, 'I1'), w(S0, 'Q', M, 'S0'), w(M, 'Y', Y, 'A')] };
  const T = truthTable(mux, { ins: ['S', 'I0', 'I1'], outs: ['Y'] });
  assert.equal(T.rows.map(r => r.out[0]).join(''), column('/S.I0 + S.I1', ['S', 'I0', 'I1']));

  const A = el('dip', { label: 'A', bits: 4 }), B = el('dip', { label: 'B', bits: 4 }), ADD = el('adder', { bits: 4 }), H = el('hex', { label: 'S' }), CO = el('led', { label: 'C' });
  const wires = [];
  for (let i = 0; i < 4; i++) wires.push(w(A, String(i), ADD, 'A' + i), w(B, String(i), ADD, 'B' + i), w(ADD, 'S' + i, H, 'D' + i));
  wires.push(w(ADD, 'Co', CO, 'A'));
  const add = { elements: [A, B, ADD, H, CO], wires };
  const sim = new LogicSim(add);
  sim.set(A.id, { value: 9 }); sim.set(B.id, { value: 8 });
  const s = [0, 1, 2, 3].reduce((n, i) => n | (sim.level(H.id, 'D' + i) << i), 0);
  assert.equal(s, (9 + 8) & 15); assert.equal(sim.level(CO.id, 'A'), 1);

  const D = el('decoder', { n: 2 }), a0 = el('switch', { label: 'A0', value: 1 }), a1 = el('switch', { label: 'A1', value: 1 });
  const dec = new LogicSim({ elements: [D, a0, a1], wires: [w(a0, 'Q', D, 'A0'), w(a1, 'Q', D, 'A1')] });
  assert.deepEqual([0, 1, 2, 3].map(i => dec.byId.get(D.id).out['Y' + i]), [0, 0, 0, 1]); // EN non reliée : active

  const B7 = el('bcd7', { mode: 'bcd' }), dp = el('dip', { label: 'N', bits: 4, value: 7 });
  const b7 = new LogicSim({ elements: [B7, dp], wires: [0, 1, 2, 3].map(i => w(dp, String(i), B7, 'D' + i)) });
  assert.equal('abcdefg'.split('').map(s => b7.byId.get(B7.id).out[s]).join(''), '1110000');
});

test('compteur modulo 10 avec remise à zéro', () => {
  const H = el('clock', { label: 'CLK' }), R = el('switch', { label: 'R' }), C = el('counter', { bits: 4, mod: 10 }), D = el('hex', { label: 'N' }), TC = el('led', { label: 'TC' });
  const c = { elements: [H, R, C, D, TC], wires: [w(H, 'Q', C, 'CLK'), w(R, 'Q', C, 'R'), ...[0, 1, 2, 3].map(i => w(C, 'Q' + i, D, 'D' + i)), w(C, 'TC', TC, 'A')] };
  const val = n => ({ N3: (n >> 3) & 1, N2: (n >> 2) & 1, N1: (n >> 1) & 1, N0: n & 1 });
  const r = runSequence(c, [{ pulse: 'CLK', times: 9, expect: { ...val(9), TC: 1 } }, { pulse: 'CLK', expect: { ...val(0), TC: 0 } }, { pulse: 'CLK', times: 3, expect: val(3) }, { set: { R: 1 }, expect: val(0) }]);
  assert.deepEqual(r.map(x => x.ok), [true, true, true, true], JSON.stringify(r));
});

test('étiquettes : deux étiquettes de même nom sont reliées', () => {
  const A = el('switch', { label: 'A', value: 1 }), T1 = el('tunnel', { label: 'X1' }), T2 = el('tunnel', { label: 'X1' }), S = el('led', { label: 'S' });
  const c = { elements: [A, T1, T2, S], wires: [w(A, 'Q', T1, 'T'), w(T2, 'T', S, 'A')] };
  assert.equal(new LogicSim(c).level(S.id, 'A'), 1);
  assert.equal(netlist(c).nets.filter(n => n.pins.length > 1).length, 1);
});

test('équations : lecture, tables, simplification', () => {
  assert.equal(column('A.B + /A./B', ['A', 'B']), '1001');
  assert.equal(column("(A+B)'", ['A', 'B']), '1000');
  assert.equal(column('A ⊕ B', ['A', 'B']), '0110');
  assert.equal(column('!A & B | A & !B', ['A', 'B']), '0110');
  assert.equal(column('A ET NON B', ['A', 'B']), '0010');
  assert.throws(() => parse('A B'));
  assert.throws(() => parse('A + (B'));
  assert.equal(expected('0110', ['A', 'B']), '0110');
  // Majorité de trois : A.B + A.C + B.C
  const m = simplify(column('A.B + A.C + B.C', ['A', 'B', 'C']), ['A', 'B', 'C']);
  assert.equal(m.terms.length, 3);
  assert.equal(column(m.text, ['A', 'B', 'C']), column('A.B + A.C + B.C', ['A', 'B', 'C']));
  // Simplification avec cases indifférentes
  assert.equal(simplify('01x1', ['A', 'B']).text, 'B');
  assert.equal(simplify('1111', ['A', 'B']).text, '1');
  assert.equal(simplify('0000', ['A', 'B']).text, '0');
  // Quatre variables : résultat toujours équivalent
  for (let s = 0; s < 40; s++) {
    let col = ''; for (let k = 0; k < 16; k++) col += (Math.sin(s * 31 + k * 7) > 0.1) ? '1' : '0';
    const r = simplify(col, ['A', 'B', 'C', 'D']);
    assert.equal(column(r.text, ['A', 'B', 'C', 'D']), col, col);
  }
  assert.ok(minimize(3, [0, 2, 4, 6]).length === 1); // /C
});

test('Karnaugh : ordre de Gray et regroupements par les bords', () => {
  const K = karnaugh(['A', 'B', 'C', 'D']);
  assert.deepEqual(K.cols, [0, 1, 3, 2]);
  assert.equal(K.cell(2, 3), (3 << 2) | 2);
  const t = minimize(4, [0, 2, 8, 10])[0]; // /B./D : les quatre coins
  assert.equal(kGroups(K, t).length, 4);
});

test('contrôles des TP de logique', () => {
  const { circuit } = gate2('xor');
  assert.equal(checkLogicTable({ inputs: ['A', 'B'], outputs: { S: 'A^B' } }, circuit).ok, true);
  const bad = checkLogicTable({ inputs: ['A', 'B'], outputs: { S: 'A.B' } }, circuit);
  assert.equal(bad.ok, false); assert.equal(bad.why, 'mismatch'); assert.equal(bad.bad, 3);
  assert.equal(checkLogicTable({ inputs: ['A', 'C'], outputs: { S: 'A' } }, circuit).why, 'missingIn');
  const open = gate2('and'); open.circuit.wires.pop();
  assert.equal(checkLogicTable({ inputs: ['A', 'B'], outputs: { S: 'A.B' } }, open.circuit).why, 'unknown');
  assert.equal(checkLogicParts({ allow: ['nand'] }, circuit).ok, false);
  assert.equal(checkLogicParts({ allow: ['xor'], maxGates: 1 }, circuit).ok, true);
  assert.equal(checkExpr({ vars: ['A', 'B'], answer: 'A^B' }, '/A.B + A./B').ok, true);
  assert.equal(checkExpr({ vars: ['A', 'B'], answer: 'A^B' }, 'A+B').ok, false);
  assert.equal(checkExpr({ vars: ['A', 'B'], answer: 'A^B' }, 'A+C').why, 'vars');
  assert.equal(checkExpr({ vars: ['A', 'B'], answer: 'A^B' }, 'A+').why, 'syntax');
  assert.equal(checkTableFill({ inputs: ['A', 'B'], outputs: { S: 'A.B' } }, { S: '0001' }).ok, true);
  assert.equal(checkTableFill({ inputs: ['A', 'B'], outputs: { S: 'A.B' } }, { S: '00?1' }).why, 'empty');
  const seq = checkLogicSeq({ steps: [{ set: { A: 1, B: 0 }, expect: { S: 1 } }, { set: { B: 1 }, expect: { S: 1 } }] }, circuit);
  assert.equal(seq.ok, false); assert.equal(seq.step, 1);
});

test('exemples : fils valides, sans chevauchement, fonctionnent', async () => {
  const { LOGIC_EXAMPLES } = await import('./examples.js');
  const { sizeOf } = await import('./elements.js');
  const { syncBlocks } = await import('./blocks.js');
  for (const ex of LOGIC_EXAMPLES) {
    const c = ex.circuit();
    syncBlocks(c);
    for (const k of [c, ...(c.blocks || []).map(b => b.circuit)]) {
      for (const wi of k.wires) for (const [id, pin] of [wi.a, wi.b]) { const e = k.elements.find(x => x.id === id); assert.ok(e && layoutOf(e).pins.some(p => p.name === pin), `${ex.id} ${id}.${pin}`); }
      const boxes = k.elements.filter(e => e.type !== 'text').map(e => ({ e, ...sizeOf(e) }));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; assert.ok(!(a.e.x < b.e.x + b.w && b.e.x < a.e.x + a.w && a.e.y < b.e.y + b.h && b.e.y < a.e.y + a.h), `${ex.id} : ${a.e.id}/${b.e.id}`); }
    }
    const sim = new LogicSim(c);
    assert.equal(sim.floating().length, 0, ex.id); assert.equal(sim.osc, false, ex.id); assert.equal(sim.bad.size, 0, ex.id);
  }
  // Additionneur en blocs : 6 + 7 = 13 ; message en ROM : la première lettre est un H.
  const add = LOGIC_EXAMPLES.find(x => x.id === 'adder-blocks').circuit(); syncBlocks(add);
  const sa = new LogicSim(add); assert.equal([0, 1, 2, 3, 4].reduce((a, i) => a | (sa.level('r', 'A' + i) << i), 0), 13);
  const rom = new LogicSim(LOGIC_EXAMPLES.find(x => x.id === 'rom-message').circuit());
  assert.equal('abcdefg'.split('').map(x => rom.level('aff', x)).join(''), '0110111');
  const ha = LOGIC_EXAMPLES[0].circuit(), T = truthTable(ha);
  assert.deepEqual(T.outs, ['S', 'C']);
  assert.equal(T.rows.map(r => r.out.join('')).join(' '), '00 10 10 01');
  const latch = LOGIC_EXAMPLES[1].circuit();
  const r = runSequence(latch, [{ set: { S: 1 }, expect: { Q: 1 } }, { set: { S: 0 }, expect: { Q: 1, 'Q̄': 0 } }, { set: { R: 1 }, expect: { Q: 0 } }]);
  assert.deepEqual(r.map(x => x.ok), [true, true, true]);
  const j = runSequence(LOGIC_EXAMPLES[4].circuit(), [{ pulse: 'CLK', expect: { L0: 1, L1: 0 } }, { pulse: 'CLK', times: 4, expect: { L0: 0, L3: 1 } }]);
  assert.deepEqual(j.map(x => x.ok), [true, true], JSON.stringify(j));
});

test('mise sous tension : aucun front d’horloge fantôme, quel que soit l’ordre des éléments', () => {
  // Compteur asynchrone dont l'étage 2 est ajouté avant l'étage 1 : il doit partir de 00.
  const H = el('button', { label: 'CLK' }), one = el('const', { value: 1 }), T2 = el('tff'), T1 = el('tff'), Q0 = el('led', { label: 'Q0' }), Q1 = el('led', { label: 'Q1' });
  const c = { elements: [T2, H, one, T1, Q0, Q1], wires: [w(one, 'Q', T1, 'T'), w(one, 'Q', T2, 'T'), w(H, 'Q', T1, 'CLK'), w(T1, 'QN', T2, 'CLK'), w(T1, 'Q', Q0, 'A'), w(T2, 'Q', Q1, 'A')] };
  const r = runSequence(c, [{ expect: { Q0: 0, Q1: 0 } }, { pulse: 'CLK', expect: { Q0: 1, Q1: 0 } }, { pulse: 'CLK', expect: { Q0: 0, Q1: 1 } }]);
  assert.deepEqual(r.map(x => x.ok), [true, true, true], JSON.stringify(r));
});

test('circuit lu dans un fichier : types hérités refusés, propriétés bornées, identifiants uniques', async () => {
  const { cleanCircuit } = await import('./clean.js');
  const c = cleanCircuit({
    elements: [{ id: 'a', type: 'constructor', x: 0, y: 0 }, { id: 'b', type: '__proto__', x: 0, y: 0 }, { id: 'd', type: 'dip', x: 0, y: 0, p: { bits: 1e9, value: 1e12, label: '<img src=x onerror=alert(1)>' } },
      { id: 'h', type: 'clock', x: 1e9, y: 'x', p: { freq: -5 } }, { id: 'g', type: 'and', x: 0, y: 0, p: { n: 1e6, evil: 'x' } }],
    wires: [{ id: 'w2x', a: ['d', '0'], b: ['g', 'A'] }, { id: 'bad id', a: ['d', '1'], b: ['g', 'B'] }]
  });
  assert.deepEqual(c.elements.map(e => e.type), ['dip', 'clock', 'and']);
  const d = c.elements[0];
  assert.equal(d.p.bits, 8); assert.equal(d.p.value, 255); assert.equal(d.p.label.length <= 12, true);
  assert.equal(c.elements[1].p.freq, undefined); assert.equal(c.elements[1].x, 5000); assert.equal(c.elements[1].y, 0);
  assert.equal(c.elements[2].p.n, 8); assert.equal(c.elements[2].p.evil, undefined);
  assert.equal(new Set(c.wires.map(w => w.id)).size, 2);
  assert.equal(DEFS.constructor, undefined);
});

test('contrôles déterministes : un interrupteur laissé à 1 ne change pas le verdict', () => {
  const { circuit, A } = gate2('and');
  const extra = el('switch', { label: 'Z', value: 1 }); circuit.elements.push(extra);
  A.p.value = 1; // laissé à 1 par l'élève
  assert.equal(checkLogicTable({ inputs: ['A', 'B'], outputs: { S: 'A.B' } }, circuit).ok, true);
  const r = checkLogicSeq({ steps: [{ set: { B: 1 }, expect: { S: 0 } }, { set: { A: 1 }, expect: { S: 1 } }] }, circuit);
  assert.equal(r.ok, true, JSON.stringify(r));
});

/* ---------- Bus, mémoires, arithmétique, blocs ---------- */
const bits = (sim, id, names) => names.map(n => sim.level(id, n));
const num = (sim, id, names) => names.reduce((a, n, i) => a | (sim.level(id, n) << i), 0);

test('bus : un fil de bus relie les bits un à un ; largeurs différentes refusées', () => {
  const D = el('dip', { label: 'N', bits: 4, bus: 1, value: 0b1010 }), H = el('hex', { label: 'H', bus: 1 }, 10, 0), L = el('led', { label: 'L' }, 10, 8);
  const c = { elements: [D, H, L], wires: [w(D, 'Q', H, 'D'), w(D, 'Q', L, 'A')] };
  const s = new LogicSim(c);
  assert.deepEqual(bits(s, H.id, ['D0', 'D1', 'D2', 'D3']), [0, 1, 0, 1]);
  assert.deepEqual(s.levels(H.id, 'D'), [0, 1, 0, 1]);
  assert.ok(s.bad.has(c.wires[1].id), 'bus de 4 bits vers une LED : fil refusé');
  assert.equal(s.level(L.id, 'A'), Z);
  // Signaux : un afficheur réglé en bus reste lu bit par bit (H3…H0)
  const T = truthTable(c, { outs: ['H0', 'H3'] });
  assert.deepEqual(T.missingOut, []);
});

test('séparateur de bus : dans les deux sens, et par paquets de bits', () => {
  const N = el('numin', { label: 'N', bits: 8, bus: 1, value: 0xA5 }), Sp = el('split', { bits: 8, grp: 4 }, 8, 0);
  const H0 = el('hex', { label: 'L', bus: 1 }, 14, 0), H1 = el('hex', { label: 'M', bus: 1 }, 14, 8);
  const A = el('switch', { label: 'A', value: 1 }, 0, 20), B = el('switch', { label: 'B', value: 1 }, 0, 24), Sj = el('split', { bits: 2 }, 8, 20), O = el('numout', { label: 'O', bits: 2, bus: 1 }, 14, 20);
  const c = { elements: [N, Sp, H0, H1, A, B, Sj, O], wires: [w(N, 'Q', Sp, 'B'), w(Sp, 'o0', H0, 'D'), w(Sp, 'o1', H1, 'D'), w(A, 'Q', Sj, 'b0'), w(B, 'Q', Sj, 'b1'), w(Sj, 'B', O, 'A')] };
  const s = new LogicSim(c);
  assert.equal(num(s, H0.id, ['D0', 'D1', 'D2', 'D3']), 5);
  assert.equal(num(s, H1.id, ['D0', 'D1', 'D2', 'D3']), 0xA);
  assert.deepEqual(s.levels(O.id, 'A'), [1, 1]);
  s.set(B.id, { value: 0 });
  assert.deepEqual(s.levels(O.id, 'A'), [1, 0]);
});

test('étiquettes et nœuds de bus', () => {
  const N = el('numin', { label: 'N', bits: 3, bus: 1, value: 6 }), T1 = el('tunnel', { label: 'BUS', bits: 3 }, 8, 0), T2 = el('tunnel', { label: 'BUS', bits: 3 }, 20, 0);
  const J = el('junction', { bits: 3 }, 6, 6), O1 = el('numout', { label: 'O', bits: 3, bus: 1 }, 26, 0), O2 = el('numout', { label: 'P', bits: 3, bus: 1 }, 26, 6);
  const c = { elements: [N, T1, T2, J, O1, O2], wires: [w(N, 'Q', T1, 'T'), w(T2, 'T', J, 'J'), w(J, 'J', O1, 'A'), w(J, 'J', O2, 'A')] };
  const s = new LogicSim(c);
  assert.deepEqual(s.levels(O1.id, 'A'), [0, 1, 1]);
  assert.deepEqual(s.levels(O2.id, 'A'), [0, 1, 1]);
});

test('résistance de tirage : niveau par défaut d’un bus 3 états, une vraie sortie l’emporte', () => {
  const A = el('switch', { label: 'A', value: 0 }), E = el('switch', { label: 'E', value: 0 }, 0, 4), T3 = el('tri', {}, 6, 0), R = el('pull', { value: 1 }, 12, -4), L = el('led', { label: 'S' }, 16, 0);
  const c = { elements: [A, E, T3, R, L], wires: [w(A, 'Q', T3, 'A'), w(E, 'Q', T3, 'EN'), w(T3, 'Y', L, 'A'), w(R, 'A', L, 'A')] };
  const s = new LogicSim(c);
  assert.equal(s.level(L.id, 'A'), 1, 'personne ne pilote : tiré à 1');
  s.set(E.id, { value: 1 });
  assert.equal(s.level(L.id, 'A'), 0, 'le tampon pilote 0');
  assert.equal(s.conflicts.size, 0, 'pas de conflit avec une sortie faible');
  assert.deepEqual(s.floating(), []);
});

test('ROM : mot lu à l’adresse, sorties déconnectées par OE', () => {
  const A = el('numin', { label: 'A', bits: 2, value: 2 }), M = el('rom', { abits: 2, dbits: 4, data: '3 5 c 9' }, 8, 0), O = el('numout', { label: 'D', bits: 4 }, 16, 0), E = el('switch', { label: 'E', value: 1 }, 0, 6);
  const c = { elements: [A, M, O, E], wires: [w(A, 'Q0', M, 'A0'), w(A, 'Q1', M, 'A1'), w(E, 'Q', M, 'OE'), ...[0, 1, 2, 3].map(i => w(M, 'D' + i, O, 'A' + i))] };
  const s = new LogicSim(c);
  assert.equal(num(s, O.id, ['A0', 'A1', 'A2', 'A3']), 0xC);
  s.set(A.id, { value: 3 }); assert.equal(num(s, O.id, ['A0', 'A1', 'A2', 'A3']), 9);
  s.set(E.id, { value: 0 }); assert.equal(s.level(O.id, 'A0'), Z);
});

test('RAM : écriture au front si WE, lecture à l’adresse', () => {
  const A = el('numin', { label: 'A', bits: 2, bus: 1 }), D = el('numin', { label: 'D', bits: 4, bus: 1 }, 0, 4), W = el('switch', { label: 'W' }, 0, 8), K = el('button', { label: 'K' }, 0, 10);
  const M = el('ram', { abits: 2, dbits: 4, bus: 1 }, 8, 0), O = el('numout', { label: 'Q', bits: 4, bus: 1 }, 18, 0);
  const c = { elements: [A, D, W, K, M, O], wires: [w(A, 'Q', M, 'A'), w(D, 'Q', M, 'D'), w(W, 'Q', M, 'WE'), w(K, 'Q', M, 'CLK'), w(M, 'Q', O, 'A')] };
  const s = new LogicSim(c), clk = () => { s.set(K.id, { pressed: true }); s.set(K.id, { pressed: false }); }, out = () => s.levels(O.id, 'A').reduce((a, v, i) => a | (v << i), 0);
  s.set(D.id, { value: 7 }); clk(); assert.equal(out(), 0, 'WE = 0 : rien n’est écrit');
  s.set(W.id, { value: 1 }); clk(); assert.equal(out(), 7);
  s.set(A.id, { value: 3 }); s.set(D.id, { value: 12 }); clk(); assert.equal(out(), 12);
  s.set(W.id, { value: 0 }); s.set(A.id, { value: 0 }); assert.equal(out(), 7, 'l’adresse 0 a gardé son mot');
});

test('UAL, soustracteur, multiplieur', () => {
  const ev = (type, p, I) => DEFS[type].ev(I, { ...Object.fromEntries((DEFS[type].props || []).map(q => [q.k, q.def])), ...p }, {});
  const split = (name, n, v) => Object.fromEntries(Array.from({ length: n }, (_, i) => [name + i, (v >> i) & 1]));
  const read = (o, name, n) => Array.from({ length: n }, (_, i) => o[name + i] << i).reduce((a, b) => a | b, 0);
  const alu = (op, a, b, ci = 0) => { const o = ev('alu', { bits: 4 }, { ...split('A', 4, a), ...split('B', 4, b), Ci: ci, ...split('S', 3, op) }); return [read(o, 'F', 4), o.Co, o.Z]; };
  assert.deepEqual(alu(0, 9, 8), [1, 1, 0]);
  assert.deepEqual(alu(1, 3, 5), [14, 1, 0]);
  assert.deepEqual(alu(1, 5, 5), [0, 0, 1]);
  assert.deepEqual(alu(2, 0b1100, 0b1010), [0b1000, 0, 0]);
  assert.deepEqual(alu(3, 0b1100, 0b1010), [0b1110, 0, 0]);
  assert.deepEqual(alu(4, 0b1100, 0b1010), [0b0110, 0, 0]);
  assert.deepEqual(alu(5, 0b1100, 0), [0b0011, 0, 0]);
  assert.deepEqual(alu(6, 15, 0), [0, 1, 1]);
  assert.deepEqual(alu(7, 0, 0), [15, 1, 0]);
  const sub = ev('sub', { bits: 4 }, { ...split('A', 4, 2), ...split('B', 4, 3), Bi: 0 });
  assert.equal(read(sub, 'D', 4), 15); assert.equal(sub.Bo, 1);
  const fs = ev('sub', { bits: 1 }, { A: 0, B: 0, Bi: 1 }); assert.deepEqual([fs.D, fs.Bo], [1, 1]);
  const mul = ev('mul', { bits: 3 }, { ...split('A', 3, 7), ...split('B', 3, 6) });
  assert.equal(read(mul, 'P', 6), 42);
});

test('compteur : chargement parallèle, sens par U/D ; registre à décalage : sens et chargement', () => {
  const K = el('button', { label: 'K' }), U = el('switch', { label: 'U', value: 1 }, 0, 4), LD = el('switch', { label: 'L' }, 0, 8), D = el('numin', { label: 'D', bits: 4, bus: 1, value: 9 }, 0, 12);
  const C = el('counter', { bits: 4, down: 2, load: 1, bus: 1 }, 10, 0), O = el('numout', { label: 'Q', bits: 4, bus: 1 }, 20, 0);
  const c = { elements: [K, U, LD, D, C, O], wires: [w(K, 'Q', C, 'CLK'), w(U, 'Q', C, 'UD'), w(LD, 'Q', C, 'LD'), w(D, 'Q', C, 'D'), w(C, 'Q', O, 'A')] };
  const s = new LogicSim(c), clk = () => { s.set(K.id, { pressed: true }); s.set(K.id, { pressed: false }); }, out = () => s.levels(O.id, 'A').reduce((a, v, i) => a | (v << i), 0);
  clk(); clk(); assert.equal(out(), 2);
  s.set(LD.id, { value: 1 }); clk(); assert.equal(out(), 9, 'chargé');
  s.set(LD.id, { value: 0 }); s.set(U.id, { value: 0 }); clk(); clk(); assert.equal(out(), 7, 'décompte');
  // Registre à décalage : sens choisi par DIR, chargement parallèle
  const R = el('shift', { bits: 4, dir: 'pin', load: 1 }, 10, 20), K2 = el('button', { label: 'K2' }, 0, 20), DI = el('switch', { label: 'DI', value: 1 }, 0, 24), DIR = el('switch', { label: 'DR' }, 0, 28), L2 = el('switch', { label: 'L2' }, 0, 32), P = el('numin', { label: 'P', bits: 4, value: 0b0110 }, 0, 36);
  const c2 = { elements: [R, K2, DI, DIR, L2, P], wires: [w(K2, 'Q', R, 'CLK'), w(DI, 'Q', R, 'DIN'), w(DIR, 'Q', R, 'DIR'), w(L2, 'Q', R, 'LD'), ...[0, 1, 2, 3].map(i => w(P, 'Q' + i, R, 'D' + i))] };
  const s2 = new LogicSim(c2), clk2 = () => { s2.set(K2.id, { pressed: true }); s2.set(K2.id, { pressed: false }); };
  clk2(); assert.deepEqual(bits(s2, R.id, ['Q0', 'Q1', 'Q2', 'Q3']), [1, 0, 0, 0]);
  s2.set(L2.id, { value: 1 }); clk2(); assert.deepEqual(bits(s2, R.id, ['Q0', 'Q1', 'Q2', 'Q3']), [0, 1, 1, 0]);
  s2.set(L2.id, { value: 0 }); s2.set(DIR.id, { value: 1 }); clk2(); assert.deepEqual(bits(s2, R.id, ['Q0', 'Q1', 'Q2', 'Q3']), [1, 1, 0, 0], 'vers Q0, DL (0) entre en Q3');
});

/** Bloc « additionneur complet » fait de portes : entrées A, B, Ci ; sorties S, Co. */
function faBlock(id = 'b1') {
  const A = el('switch', { label: 'A' }, 0, 0), B = el('switch', { label: 'B' }, 0, 4), Ci = el('switch', { label: 'Ci' }, 0, 8);
  const X1 = el('xor', {}, 8, 0), X2 = el('xor', {}, 16, 0), A1 = el('and', {}, 8, 8), A2 = el('and', {}, 16, 8), O = el('or', {}, 24, 8);
  const S = el('led', { label: 'S' }, 30, 0), Co = el('led', { label: 'Co' }, 30, 8);
  return { id, name: 'FA', circuit: { elements: [A, B, Ci, X1, X2, A1, A2, O, S, Co], wires: [
    w(A, 'Q', X1, 'A'), w(B, 'Q', X1, 'B'), w(X1, 'Y', X2, 'A'), w(Ci, 'Q', X2, 'B'), w(X2, 'Y', S, 'A'),
    w(A, 'Q', A1, 'A'), w(B, 'Q', A1, 'B'), w(X1, 'Y', A2, 'A'), w(Ci, 'Q', A2, 'B'), w(A1, 'Y', O, 'A'), w(A2, 'Y', O, 'B'), w(O, 'Y', Co, 'A')] } };
}

test('blocs : interface, aplatissement, deux additionneurs complets en chaîne', async () => {
  const { blockIo, syncBlocks } = await import('./blocks.js');
  const def = faBlock();
  assert.deepEqual(blockIo(def), { t: 'FA', ins: [{ n: 'A', w: 1 }, { n: 'B', w: 1 }, { n: 'Ci', w: 1 }], outs: [{ n: 'S', w: 1 }, { n: 'Co', w: 1 }] });
  const ins = ['A0', 'A1', 'B0', 'B1'].map((n, i) => el('switch', { label: n }, 0, i * 4));
  const F0 = el('block', { ref: 'b1' }, 10, 0), F1 = el('block', { ref: 'b1' }, 10, 10), outs = ['S0', 'S1', 'C'].map((n, i) => el('led', { label: n }, 22, i * 4));
  const c = { blocks: [def], elements: [...ins, F0, F1, ...outs], wires: [
    w(ins[0], 'Q', F0, 'A'), w(ins[2], 'Q', F0, 'B'), w(ins[1], 'Q', F1, 'A'), w(ins[3], 'Q', F1, 'B'), w(F0, 'Co', F1, 'Ci'),
    w(F0, 'S', outs[0], 'A'), w(F1, 'S', outs[1], 'A'), w(F1, 'Co', outs[2], 'A')] };
  syncBlocks(c);
  assert.deepEqual(layoutOf(F0).pins.map(q => q.name), ['A', 'B', 'Ci', 'S', 'Co']);
  // Ci du premier bloc non relié : entrée en l'air signalée sur le bloc
  assert.ok(new LogicSim(c).floating().some(f => f.id === F0.id && f.pin === 'Ci'));
  const Z0 = el('const', { value: 0 }, 4, 20); c.elements.push(Z0); c.wires.push(w(Z0, 'Q', F0, 'Ci'));
  const r = checkLogicTable({ inputs: ['A1', 'A0', 'B1', 'B0'], outputs: { C: '(A1.B1)+((A1^B1).(A0.B0))', S1: 'A1^B1^(A0.B0)', S0: 'A0^B0' } }, c);
  assert.ok(r.ok, JSON.stringify(r.rows && r.rows.filter(x => !x.ok)));
  // Les portes du bloc comptent dans les contrôles de pièces
  const parts = checkLogicParts({ allow: ['xor', 'and', 'or'], maxGates: 10 }, c);
  assert.ok(parts.ok, JSON.stringify(parts));
  assert.equal(parts.used.block, 2);
  assert.equal(checkLogicParts({ maxGates: 9 }, c).why, 'tooMany');
});

test('blocs : imbriqués, avec bus, étiquettes locales ; un bloc qui se contient ne boucle pas', async () => {
  const { syncBlocks, usesBlock, flatten } = await import('./blocks.js');
  const fa = faBlock('fa');
  // Bloc « ADD2 » : entrées en bus A, B (2 bits), sortie en bus S (2 bits) et C, fait de deux FA.
  const A = el('numin', { label: 'A', bits: 2, bus: 1 }), B = el('numin', { label: 'B', bits: 2, bus: 1 }, 0, 6);
  const SA = el('split', { bits: 2 }, 6, 0), SB = el('split', { bits: 2 }, 6, 6), F0 = el('block', { ref: 'fa' }, 12, 0), F1 = el('block', { ref: 'fa' }, 12, 10);
  const SS = el('split', { bits: 2 }, 24, 0), S = el('numout', { label: 'S', bits: 2, bus: 1 }, 30, 0), Cc = el('led', { label: 'C' }, 30, 8);
  const T1 = el('tunnel', { label: 'K' }, 20, 20), T2 = el('tunnel', { label: 'K' }, 20, 24); // étiquettes du bloc : ne doivent pas sortir
  const Z0 = el('const', { value: 0 }, 6, 14);
  const add2 = { id: 'add2', name: 'ADD2', circuit: { elements: [A, B, SA, SB, F0, F1, SS, S, Cc, T1, T2, Z0], wires: [
    w(A, 'Q', SA, 'B'), w(B, 'Q', SB, 'B'), w(Z0, 'Q', T1, 'T'), w(T2, 'T', F0, 'Ci'), w(SA, 'b0', F0, 'A'), w(SB, 'b0', F0, 'B'), w(SA, 'b1', F1, 'A'), w(SB, 'b1', F1, 'B'), w(F0, 'Co', F1, 'Ci'),
    w(F0, 'S', SS, 'b0'), w(F1, 'S', SS, 'b1'), w(SS, 'B', S, 'A'), w(F1, 'Co', Cc, 'A')] } };
  const X = el('numin', { label: 'X', bits: 2, bus: 1, value: 3 }), Y = el('numin', { label: 'Y', bits: 2, bus: 1, value: 2 }, 0, 6), G = el('block', { ref: 'add2' }, 10, 0);
  const R = el('numout', { label: 'R', bits: 2, bus: 1 }, 22, 0), K = el('led', { label: 'K' }, 22, 6), T3 = el('tunnel', { label: 'K' }, 22, 12);
  const c = { blocks: [fa, add2], elements: [X, Y, G, R, K, T3], wires: [w(X, 'Q', G, 'A'), w(Y, 'Q', G, 'B'), w(G, 'S', R, 'A'), w(G, 'C', K, 'A')] };
  syncBlocks(c);
  assert.deepEqual(G.p.io.ins, [{ n: 'A', w: 2 }, { n: 'B', w: 2 }]);
  assert.deepEqual(layoutOf(G).pins.find(q => q.name === 'S').bus, ['S#0', 'S#1']);
  const s = new LogicSim(c);
  assert.deepEqual(s.levels(R.id, 'A'), [1, 0]); // 3 + 2 = 5 : 01 et retenue
  assert.equal(s.level(K.id, 'A'), 1);
  assert.equal(s.level(T3.id, 'T'), Z, 'l’étiquette K du bloc reste dans le bloc');
  assert.ok(usesBlock(c.blocks, 'add2', 'fa') && !usesBlock(c.blocks, 'fa', 'add2'));
  // Un bloc qui se pose lui-même (fichier trafiqué) : aplatissement borné
  const self = { id: 's', name: 'S', circuit: { elements: [el('block', { ref: 's' })], wires: [] } };
  const flat = flatten({ blocks: [self], elements: [el('block', { ref: 's' })], wires: [] });
  assert.ok(flat.elements.length < 20);
});

test('blocs lus dans un fichier : définition manquante retirée, interface recalculée', async () => {
  const { cleanCircuit } = await import('./clean.js');
  const fa = faBlock('fa');
  const c = cleanCircuit({ blocks: [fa, { id: 'bad id!', name: 'x', circuit: {} }], elements: [{ id: 'g1', type: 'block', x: 0, y: 0, p: { ref: 'fa', io: { t: 'faux', ins: [{ n: 'Z', w: 99 }] } } }, { id: 'g2', type: 'block', x: 0, y: 10, p: { ref: 'nope' } }], wires: [] });
  assert.equal(c.blocks.length, 1);
  assert.deepEqual(c.elements.map(e => e.id), ['g1']);
  assert.equal(c.elements[0].p.io.t, 'FA');
  assert.deepEqual(c.elements[0].p.io.ins.map(q => q.n), ['A', 'B', 'Ci']);
});

test('relecture après une modification : pas de front fantôme pour une bascule ajoutée', () => {
  const k = el('const', { value: 1 }), c = el('switch', { label: 'C' }), t1 = el('tff'), t2 = el('tff');
  const C = { elements: [k, c, t1], wires: [w(k, 'Q', t1, 'T'), w(c, 'Q', t1, 'CLK')] };
  const s1 = new LogicSim(C); s1.set(c.id, { value: 1 });
  assert.equal(s1.level(t1.id, 'Q'), 1);
  C.elements.push(t2); C.wires.push(w(t1, 'Q', t2, 'CLK'), w(k, 'Q', t2, 'T'));
  const s2 = new LogicSim(C).carryOver(s1, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  assert.equal(s2.level(t1.id, 'Q'), 1, 't1 garde son état');
  assert.equal(s2.level(t2.id, 'Q'), 0, 'aucun front n’a eu lieu pour t2');
});

test('blocs : taille bornée une fois dépliés, étiquettes de largeurs différentes signalées, « # » retiré des noms', async () => {
  const { flatten, blockSize, MAX_FLAT } = await import('./blocks.js');
  const { cleanCircuit } = await import('./clean.js');
  // b0 pose 300 b1, b1 pose 300 b2 : 90 000 copies, refusées
  const many = (ref, n) => Array.from({ length: n }, (_, i) => ({ id: 'g' + i, type: 'block', x: 0, y: i * 10, p: { ref } }));
  const blocks = [{ id: 'b0', name: 'B0', circuit: { elements: many('b1', 300), wires: [] } }, { id: 'b1', name: 'B1', circuit: { elements: many('b2', 300), wires: [] } }, { id: 'b2', name: 'B2', circuit: { elements: [{ id: 'a', type: 'and', x: 0, y: 0, p: {} }], wires: [] } }];
  assert.ok(blockSize(blocks, 'b0') > MAX_FLAT);
  const t0 = Date.now(), F = flatten({ blocks, elements: [{ id: 'top', type: 'block', x: 0, y: 0, p: { ref: 'b0' } }], wires: [] });
  assert.ok(F.truncated && F.elements.length <= MAX_FLAT && Date.now() - t0 < 2000);
  const c = cleanCircuit({ blocks, elements: [{ id: 'top', type: 'block', x: 0, y: 0, p: { ref: 'b0' } }], wires: [] });
  assert.deepEqual(c.blocks.map(b => b.id), ['b1', 'b2'], 'le bloc trop gros est refusé');
  assert.equal(c.elements.length, 0);
  // Étiquettes de même nom, largeurs différentes
  const T1 = el('tunnel', { label: 'D', bits: 4 }), T2 = el('tunnel', { label: 'D', bits: 2 }, 10, 0);
  assert.deepEqual([...new LogicSim({ elements: [T1, T2], wires: [] }).badTunnels], ['D']);
  // « # » sépare les bits d'un bus : il ne peut pas venir d'un nom
  const k = cleanCircuit({ elements: [{ id: 's', type: 'switch', x: 0, y: 0, p: { label: 'A#1' } }], wires: [] });
  assert.equal(k.elements[0].p.label, 'A1');
});
