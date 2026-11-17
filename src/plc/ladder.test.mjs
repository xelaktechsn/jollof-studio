// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Automate (Ladder) : node --test src/plc/ladder.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const i18n = await import('../i18n/index.js');
await i18n.loadLanguage();
const { cleanPlc, compilePlc, lintPlc, createPlcRun, scanPlc, MAX } = await import('./ladder.js');
const { ladderFromGrafcet } = await import('./fromgrafcet.js');
const { createRunner, runStep } = await import('../pneu/run.js');
const { PNEU_EXAMPLES } = await import('../pneu/examples.js');
const { clean } = await import('../pneu/clean.js');

let n = 0;
const E = (t, v, more = {}) => ({ t, id: `t${++n}`, v, ...more });
const PAR = (...branches) => ({ t: 'par', id: `t${++n}`, branches });
const R = (items, comment = '') => ({ id: `r${++n}`, comment, items });
const prog = (rungs, inputs = [{ name: 'dcy', kind: 'push' }]) => ({ name: 'API1', drive: true, cycle: 10, inputs, rungs });
/** Fait tourner `s` secondes par pas de 10 ms ; read lit l'objet env (noms en minuscules). */
function run(C, st, env, s, dt = 0.01) { let r; for (let t = 0; t < s - 1e-9; t += dt) r = scanPlc(C, st, l => !!env[l], dt); return r; }
const bit = (st, name) => !!st.bits.get(name.toLowerCase());

test('Nettoyage : éléments inconnus retirés, noms invalides vidés, nombres bornés, identifiants uniques', () => {
  const p = cleanPlc({ rungs: [{ id: 'a', items: [{ t: 'no', id: 'a', v: 'dcy' }, { t: 'bogus' }, { t: 'ton', v: 'T1', pt: -4 }, { t: 'coil', v: 'bad name' }, { t: 'par', branches: [[{ t: 'nc', v: 'a1' }], 'x'] }] }], inputs: [{ name: 'dcy' }, { name: 'DCY' }, { name: '12' }] });
  assert.equal(p.rungs.length, 1);
  assert.deepEqual(p.rungs[0].items.map(i => i.t), ['no', 'ton', 'coil', 'par']);
  assert.equal(p.rungs[0].items[1].pt, 0); assert.equal(p.rungs[0].items[2].v, '');
  const ids = []; const walk = l => l.forEach(i => { ids.push(i.id); if (i.t === 'par') i.branches.forEach(walk); }); ids.push(p.rungs[0].id); walk(p.rungs[0].items);
  assert.equal(new Set(ids).size, ids.length, 'identifiants uniques');
  assert.deepEqual(p.inputs, [{ name: 'dcy', kind: 'push' }]);
  assert.equal(cleanPlc(null), null); assert.equal(cleanPlc({ rungs: 'x' }), null);
  // Bornes : trop d'éléments, trop profond.
  const deep = d => (d ? { t: 'par', branches: [[deep(d - 1)]] } : { t: 'no', v: 'a' });
  const q = cleanPlc({ rungs: [{ items: [deep(MAX.depth + 3)] }] });
  let depth = 0, it = q.rungs[0].items[0]; while (it && it.t === 'par') { depth++; it = it.branches[0][0]; }
  assert.ok(depth <= MAX.depth, `profondeur ${depth}`);
});

test('Compilation : nom manquant, durée nulle, double bobine, S sans R, réseau sans sortie, entrée écrite', () => {
  const p = prog([
    R([E('no', 'dcy'), E('coil', 'Y1')]),
    R([E('no', 'a1'), E('coil', 'Y1')]),
    R([E('no', ''), E('ton', 'T1', { pt: 0 })]),
    R([E('no', 'dcy'), E('set', 'M1')]),
    R([E('no', 'dcy')]),
    R([E('no', 'a1'), E('coil', 'dcy')])
  ]);
  const C = compilePlc(p);
  const texts = [...C.errors, ...C.warnings].map(d => d.text);
  assert.ok(texts.some(t => /sans nom/.test(t)), 'nom manquant');
  assert.ok(texts.some(t => /durée/.test(t)), 'durée');
  assert.ok(texts.some(t => /Double bobine/.test(t)), 'double bobine');
  assert.ok(texts.some(t => /jamais remise à 0/.test(t)), 'S sans R');
  assert.ok(texts.some(t => /ne commande rien/.test(t)), 'réseau sans sortie');
  assert.ok(C.errors.some(d => /entrée du pupitre/.test(d.text) && d.rung === 5), 'entrée écrite');
  // En erreur, l'automate ne tourne pas : rien n'est écrit.
  const st = createPlcRun(), r = run(C, st, { dcy: true, a1: true }, 0.05);
  assert.equal(r.halted, true); assert.equal(r.outputs.size, 0);
});

test('Résolution des noms : inconnu avec suggestion, étape de GRAFCET, bobine jamais écrite, adresses', () => {
  const p = prog([R([E('no', 'dcy'), E('no', 'a0'), E('nc', 'a2'), E('no', 'X3'), E('no', 'X9'), E('no', 'Y2'), E('coil', 'Y1')]), R([E('no', 'init'), E('set', 'M1')]), R([E('cmp', null, { a: 'M1', op: '>=', b: 2 }), E('reset', 'M1')])]);
  const C = compilePlc(p);
  assert.equal(C.errors.length, 0);
  const L = lintPlc(C, { inputs: ['a0', 'a1'], outputs: ['Y1', 'Y2'], steps: new Set([0, 1, 2, 3]) });
  const err = L.diags.filter(d => d.level === 'error').map(d => d.text);
  assert.ok(err.some(t => /Nom inconnu : a2.*a0|a1/.test(t)), `suggestion : ${err}`);
  assert.ok(err.some(t => /étape 9/.test(t)), 'étape absente');
  assert.ok(err.some(t => /ni un compteur ni une temporisation/.test(t)), 'comparaison');
  assert.ok(L.diags.some(d => d.level === 'warning' && /Y2.*jamais/.test(d.text)), 'bobine jamais écrite');
  const by = Object.fromEntries(L.vars.map(v => [v.name.toLowerCase(), v]));
  assert.equal(by.dcy.cls, 'in'); assert.equal(by.dcy.addr, '%I0.0'); assert.equal(by.a0.addr, '%I0.1');
  assert.equal(by.y1.cls, 'out'); assert.equal(by.y1.addr, '%Q0.0');
  assert.equal(by.m1.cls, 'mem'); assert.equal(by.m1.addr, '%M0');
  assert.equal(by.x3.cls, 'step'); assert.equal(by.init.cls, 'sys');
});

test('Cycle : auto-maintien, contact fermé au repos, bobine inversée, dérivation', () => {
  // Y1 = (dcy + Y1) . /a1 : la tige sort sur une impulsion et reste commandée jusqu'à a1.
  const C = compilePlc(prog([R([PAR([E('no', 'dcy')], [E('no', 'Y1')]), E('nc', 'a1'), E('coil', 'Y1')]), R([E('no', 'Y1'), E('ncoil', 'L1')])]));
  assert.equal(C.errors.length, 0);
  const st = createPlcRun(), env = { dcy: false, a1: false };
  run(C, st, env, 0.05); assert.equal(bit(st, 'Y1'), false); assert.equal(bit(st, 'L1'), true);
  env.dcy = true; run(C, st, env, 0.02); env.dcy = false; run(C, st, env, 0.1);
  assert.equal(bit(st, 'Y1'), true, 'auto-maintien'); assert.equal(bit(st, 'L1'), false);
  env.a1 = true; const r = run(C, st, env, 0.02);
  assert.equal(bit(st, 'Y1'), false); assert.deepEqual([...r.outputs], ['L1']);
});

test('Fronts : P et N ne durent qu’un cycle, pas de front au premier cycle', () => {
  const C = compilePlc(prog([R([E('p', 'dcy'), E('set', 'M1')]), R([E('n', 'dcy'), E('reset', 'M1')])]));
  const st = createPlcRun(), env = { dcy: true };
  run(C, st, env, 0.03); assert.equal(bit(st, 'M1'), false, 'dcy déjà appuyé au démarrage : pas de front');
  env.dcy = false; run(C, st, env, 0.01); env.dcy = true; run(C, st, env, 0.01);
  assert.equal(bit(st, 'M1'), true); assert.equal(st.power.get(C.rungs[0].items[0].id), true);
  run(C, st, env, 0.01); assert.equal(st.power.get(C.rungs[0].items[0].id), false, 'un seul cycle');
  env.dcy = false; run(C, st, env, 0.01); assert.equal(bit(st, 'M1'), false);
});

test('Temporisations TON, TOF, TP : durées à 10 ms près', () => {
  const C = compilePlc(prog([R([E('no', 'a'), E('ton', 'T1', { pt: 0.5 })]), R([E('no', 'a'), E('tof', 'T2', { pt: 0.3 })]), R([E('no', 'a'), E('tp', 'T3', { pt: 0.2 })]), R([E('no', 'T1'), E('coil', 'Q1')]), R([E('no', 'T2'), E('coil', 'Q2')]), R([E('no', 'T3'), E('coil', 'Q3')])]));
  assert.equal(C.errors.length, 0);
  const st = createPlcRun(), env = { a: false };
  run(C, st, env, 0.1); assert.equal(bit(st, 'Q1'), false); assert.equal(bit(st, 'Q2'), false);
  env.a = true;
  run(C, st, env, 0.45); assert.equal(bit(st, 'Q1'), false, 'TON pas encore'); assert.equal(bit(st, 'Q2'), true, 'TOF suit l’entrée'); assert.equal(bit(st, 'Q3'), false, 'TP terminée (0,2 s)');
  run(C, st, env, 0.06); assert.equal(bit(st, 'Q1'), true, 'TON après 0,5 s');
  assert.ok(Math.abs(st.timers.get('t1').et - 0.5) < 1e-9);
  env.a = false;
  run(C, st, env, 0.01); assert.equal(bit(st, 'Q1'), false); assert.equal(bit(st, 'Q2'), true, 'TOF retardée');
  run(C, st, env, 0.3); assert.equal(bit(st, 'Q2'), false, 'TOF retombée après 0,3 s');
  // TP : une impulsion de 0,2 s au front montant, même si l'entrée retombe avant.
  env.a = true; run(C, st, env, 0.01); env.a = false; run(C, st, env, 0.1); assert.equal(bit(st, 'Q3'), true);
  run(C, st, env, 0.1); assert.equal(bit(st, 'Q3'), false);
});

test('Compteurs CTU et CTD : comptage sur front, remise à zéro, valeur atteinte', () => {
  const C = compilePlc(prog([R([E('no', 'b'), E('ctu', 'C1', { pv: 3, r: 'raz' })]), R([E('no', 'C1'), E('coil', 'FULL')]), R([E('cmp', null, { a: 'C1', op: '=', b: 2 }), E('coil', 'TWO')])], [{ name: 'b', kind: 'push' }, { name: 'raz', kind: 'push' }]));
  assert.equal(C.errors.length, 0);
  const st = createPlcRun(), env = { b: false, raz: false };
  const pulse = () => { env.b = true; run(C, st, env, 0.02); env.b = false; run(C, st, env, 0.02); };
  pulse(); pulse(); assert.equal(st.counters.get('c1').cv, 2); assert.equal(bit(st, 'TWO'), true); assert.equal(bit(st, 'FULL'), false);
  pulse(); assert.equal(bit(st, 'FULL'), true);
  env.raz = true; run(C, st, env, 0.01); env.raz = false; assert.equal(st.counters.get('c1').cv, 0); assert.equal(bit(st, 'FULL'), false);
});

/** GRAFCET de la porte de TER (exemple « door ») et son circuit. */
const door = () => clean(PNEU_EXAMPLES.find(x => x.id === 'door').circuit());
/** Fait tourner le circuit `s` secondes ; dcy appuyé entre 0,5 et 0,8 s. Rend les mouvements relevés. */
function cycle(circuit, s = 12, dt = 0.02) {
  const Rn = createRunner(); let t = 0;
  const io = { coil: () => false, pushed: k => k === '@dcy' && t >= 0.5 && t < 0.8, input: () => false };
  for (; t < s; t += dt) runStep(Rn, circuit, io, dt);
  return Rn;
}

test('GRAFCET → Ladder : la porte de TER donne les mêmes mouvements, aux mêmes instants', () => {
  const g = door(); const r = ladderFromGrafcet(g.grafcet);
  assert.ok(!r.error, r.error);
  const plc = cleanPlc(r.plc); assert.ok(plc && plc.rungs.length >= 6);
  const C = compilePlc(plc); assert.equal(C.errors.length, 0, JSON.stringify(C.errors));
  const known = { inputs: ['dcy', 'obs', 'a0', 'a1'], outputs: ['1Y1'], steps: null };
  assert.equal(lintPlc(C, known).diags.filter(d => d.level === 'error').length, 0);
  const ref = cycle(g), viaPlc = cycle({ ...g, grafcet: undefined, plc });
  const seq = Rn => Rn.rec.moves.map(m => m.name + m.dir);
  assert.deepEqual(seq(ref), ['A+', 'A-']); assert.deepEqual(seq(viaPlc), seq(ref));
  ref.rec.moves.forEach((m, i) => assert.ok(Math.abs(m.t1 - viaPlc.rec.moves[i].t1) < 0.15, `${m.name}${m.dir} : ${m.t1} vs ${viaPlc.rec.moves[i].t1}`));
  // Et la porte reste ouverte 5 s (temporisation traduite en TON).
  assert.ok(viaPlc.rec.moves[1].t0 - viaPlc.rec.moves[0].t1 > 4.8);
});

test('GRAFCET → Ladder : ce qui n’est pas traduit est refusé avec une raison', () => {
  const g = { drive: true, inputs: [], steps: [{ n: 0, init: true, act: '', r: '=1', to: null, alt: [] }, { n: 1, init: false, act: 'C:=C+1', r: 'C>=3', to: null, alt: [] }] };
  const r = ladderFromGrafcet(g);
  assert.ok(r.error && /compteurs/.test(r.error), r.error);
  assert.ok(/GRAFCET/.test(ladderFromGrafcet(null).error));
});

test('Automate dans la simulation : il commande les électrovannes, et lit les étapes du GRAFCET', () => {
  const g = door();
  // Ladder seul : Y1 tant que dcy est maintenu (porte ouverte), via la bobine du circuit.
  const plc = cleanPlc(prog([R([E('no', 'dcy'), E('coil', '1Y1')])]));
  const Rn = createRunner(); let hold = true;
  const io = { coil: () => false, pushed: k => hold && k === '@dcy', input: () => false };
  for (let t = 0; t < 2; t += 0.02) runStep(Rn, { ...g, grafcet: undefined, plc }, io, 0.02);
  assert.ok(Rn.pOut.has('1Y1')); assert.equal(Rn.rec.moves.map(m => m.name + m.dir).join(' '), 'A+');
  // Observation : drive false, rien ne bouge.
  const R2 = createRunner();
  for (let t = 0; t < 2; t += 0.02) runStep(R2, { ...g, grafcet: undefined, plc: { ...plc, drive: false } }, io, 0.02);
  assert.ok(R2.pOut.has('1Y1')); assert.equal(R2.rec.moves.length, 0);
  // Le GRAFCET fait la séquence, l'automate recopie X1+X2 sur une lampe : il lit les étapes.
  const lamp = cleanPlc(prog([R([PAR([E('no', 'X1')], [E('no', 'X2')]), E('coil', 'LAMP')])]));
  const R3 = createRunner(); hold = false; let t = 0;
  const io3 = { coil: () => false, pushed: k => k === '@dcy' && t >= 0.5 && t < 0.8, input: () => false };
  let lit = 0; for (; t < 8; t += 0.02) { runStep(R3, { ...g, plc: lamp }, io3, 0.02); if (R3.pOut.has('LAMP')) lit += 0.02; }
  assert.ok(lit > 5.5 && lit < 7, `lampe allumée ${lit.toFixed(2)} s`);
});
