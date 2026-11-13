// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// GRAFCET et cycles séquentiels : node --test src/pneu/grafcet.test.mjs
// - réceptivités (temporisations, fronts, variables d'étape) et règles d'évolution de la norme IEC 60848 ;
// - cycles des exemples, simulés de bout en bout (GRAFCET, circuit, relevé des mouvements) :
//   A+ B+ A− B− tout pneumatique (galets), A+ B+ B− A− en cascade, A+ B+ B− A− par GRAFCET, porte de TER ;
// - le blocage de A+ B+ B− A− avec de simples galets (signaux bloquants : b0 pendant A+, a1 pendant B−).
import test from 'node:test';
import assert from 'node:assert/strict';

const i18n = await import('../i18n/index.js');
await i18n.loadLanguage();
const { compileGrafcet, createGrafRun, scanGrafcet, cleanGrafcet, parseActions } = await import('./grafcet.js');
const { createRunner, runStep, inputKey } = await import('./run.js');
const { hasSequence, phaseSvg, moveText } = await import('./seq.js');
const examples = await import('./examples.js');
const { cycleCircuit, cascadeCircuit, grafcetCircuit, doorCircuit } = examples;
const { clean } = await import('./clean.js');
const { checkPneu } = await import('./check.js');

const G = (steps, inputs = []) => ({ drive: true, inputs, steps: steps.map(([n, act, r, to = null, alt = []], i) => ({ n, init: i === 0, act, r, to, alt })) });
/** Fait évoluer un GRAFCET : vals (objet des entrées), n cycles de dt s ; rend les étapes actives et les sorties. */
function scan(C, run, vals, n = 1, dt = 0.01) { let r; for (let i = 0; i < n; i++) r = scanGrafcet(C, run, k => !!vals[k], dt); return { X: [...run.X].sort(), out: [...r.outputs].sort() }; }

test('Réceptivités : écriture des équations, temporisations, fronts, étapes ; erreurs signalées', () => {
  const C = compileGrafcet(G([[0, '', 'dcy . a0 . /b1'], [1, '1Y1, 2Y1 si p', '3s/X1'], [2, 'H1', 't/X2/0,5s + X1'], [3, '', '↑dcy']]));
  assert.deepEqual(C.errors, []);
  assert.deepEqual([...C.vars].sort(), ['a0', 'b1', 'dcy', 'p']);
  assert.deepEqual([...C.edges], ['dcy']);
  assert.deepEqual([...C.outputs].sort(), ['1Y1', '2Y1', 'H1']);
  assert.equal(parseActions('1Y1 si (a + b), Y2').items[1].name, 'Y2');
  const bad = compileGrafcet(G([[0, 'Y1 ??', 'a . . b', 7], [1, '', 'x']]));
  assert.equal(bad.errors.length, 2, JSON.stringify(bad.errors));
  assert.equal(compileGrafcet({ steps: [{ n: 0, act: '', r: '' }] }).errors.length, 1, 'aucune étape initiale');
});

test('Évolution : franchissement simultané, recherche de stabilité, temporisation, front, divergence en OU', () => {
  // Stabilité : avec a et b vraies, X0 → X1 → X2 dans le même cycle ; l'action de X1 n'est jamais émise.
  let C = compileGrafcet(G([[0, '', 'a'], [1, 'Y1', 'b'], [2, 'Y2', 'c']])), run = createGrafRun();
  assert.deepEqual(scan(C, run, { a: 1, b: 1 }), { X: [2], out: ['Y2'] });
  assert.deepEqual(scan(C, run, { c: 1 }), { X: [0], out: [] }, 'X2 → X0, qui attend a');
  // Temporisation : X1 active depuis 0,3 s.
  C = compileGrafcet(G([[0, '', 'go'], [1, 'Y1', '0,3s/X1']])); run = createGrafRun();
  scan(C, run, { go: 1 }); scan(C, run, {}, 20);
  assert.deepEqual([...run.X], [1], 'encore dans X1 à 0,2 s');
  scan(C, run, {}, 15);
  assert.deepEqual([...run.X], [0], 'X1 quittée après 0,3 s');
  // Front montant : un appui maintenu ne fait franchir qu'une fois.
  C = compileGrafcet(G([[0, '', '↑p'], [1, 'Y1', '↑p']])); run = createGrafRun();
  scan(C, run, {}); scan(C, run, { p: 1 }, 5);
  assert.deepEqual([...run.X], [1], 'maintenu : reste en X1');
  scan(C, run, {}); scan(C, run, { p: 1 });
  assert.deepEqual([...run.X], [0]);
  // Divergence en OU : de X1, a mène à X2, b (transition en plus) ramène à X0.
  C = compileGrafcet(G([[0, '', 'go'], [1, '', 'a', null, [{ r: 'b', to: 0 }]], [2, 'Y2', 'c']])); run = createGrafRun();
  scan(C, run, { go: 1 }); scan(C, run, { b: 1 });
  assert.deepEqual([...run.X], [0]);
  // Étape désactivée et réactivée au même franchissement : elle reste active (règle 5).
  C = compileGrafcet(G([[0, 'Y0', 'a', 0]])); run = createGrafRun();
  assert.deepEqual(scan(C, run, { a: 1 }), { X: [0], out: ['Y0'] });
  // GRAFCET reçu : numéros en double et entrées illisibles écartés.
  const g = cleanGrafcet({ steps: [{ n: 0, init: true }, { n: 0 }, { n: 'x' }], inputs: [{ name: 'dcy' }, { name: '1a' }, { name: 'DCY' }] });
  assert.equal(g.steps.length, 1); assert.deepEqual(g.inputs, [{ name: 'dcy', kind: 'push' }]);
});

/** Simule un circuit : keys (boutons appuyés : identifiant d'un distributeur ou @entrée), s secondes. */
function simulate(c, keys, s, R = createRunner()) {
  const io = { coil: () => false, pushed: k => keys.has(k) };
  for (let t = 0; t < s; t += 0.02) runStep(R, c, io, 0.02);
  return R;
}
const seqOf = R => R.rec.moves.map(moveText).join(' ');

test('A+ B+ A− B− tout pneumatique : galets a0 a1 b0 b1 et distributeurs bistables', () => {
  const c = clean(cycleCircuit(true));
  assert.deepEqual(checkPneu(c).filter(i => i.level === 'error'), []);
  const R = simulate(c, new Set(), 1);
  assert.equal(R.rec.moves.length, 0, 'au repos sans dcy');
  simulate(c, new Set(['dcy']), 12, R);
  assert.ok(hasSequence(R.rec.moves, 'A+ B+ A- B-'), seqOf(R));
  assert.ok(R.rec.moves.length >= 8, `le cycle recommence tant que dcy est appuyé : ${seqOf(R)}`);
  assert.match(phaseSvg(R.rec, c), /<svg[\s\S]*sqLine/);
});

test('A+ B+ B− A− : bloqué avec de simples galets, réalisé par la cascade et par le GRAFCET', () => {
  // Mêmes galets branchés pour A+ B+ B− A− : b0 pilote encore A− quand dcy . b0 commande A+ (1V1 garde sa position) ;
  // le cycle ne démarre même pas (et plus loin, a1 bloquerait B− de la même façon).
  const c = clean(cycleCircuit(false));
  const sig = [['dcy', '2', 'and', '1'], ['b0', '2', 'and', '3'], ['and', '2', 'v1', '14'], ['a1', '2', 'v2', '14'], ['b1', '2', 'v2', '12'], ['b0', '2', 'v1', '12']];
  c.tubes.push(...sig.map(([a, pa, b, pb], i) => ({ id: 's' + i, a: [a, pa], b: [b, pb] })));
  const R = simulate(c, new Set(['dcy']), 8);
  assert.equal(seqOf(R), '', 'bloqué dès le départ : signal bloquant b0');
  const k = simulate(clean(cascadeCircuit()), new Set(['dcy']), 14);
  assert.ok(hasSequence(k.rec.moves, ['A+', 'B+', 'B-', 'A-']), seqOf(k));
  const g = clean(grafcetCircuit(true));
  assert.deepEqual(checkPneu(g).filter(i => i.level === 'error'), [], 'électroaimants commandés par le GRAFCET');
  const r = simulate(g, new Set(), 1);
  assert.deepEqual([...r.g.X], [0]);
  simulate(g, new Set([inputKey('dcy')]), 10, r);
  assert.ok(hasSequence(r.rec.moves, 'A+ B+ B- A-'), seqOf(r));
  // GRAFCET qui ne commande pas (programme de la carte) : il évolue, mais n'excite rien.
  g.grafcet = { ...g.grafcet, drive: false };
  assert.equal(simulate(g, new Set([inputKey('dcy')]), 4).rec.moves.length, 0);
});

test('Porte de TER : ouverte 5 s puis fermée ; un obstacle pendant la fermeture la rouvre', () => {
  const c = clean(doorCircuit(true)), keys = new Set([inputKey('dcy')]);
  const R = simulate(c, keys, 0.5); keys.clear();
  simulate(c, keys, 3, R);
  assert.equal(seqOf(R), 'A+', 'ouverte, en attente');
  simulate(c, keys, 7, R);
  assert.equal(seqOf(R), 'A+ A−', 'refermée après 5 s');
  // Obstacle : on rouvre, puis on attend qu'il disparaisse.
  keys.add(inputKey('dcy')); simulate(c, keys, 0.3, R); keys.clear();
  simulate(c, keys, 7, R); // ouverte (1,5 s), 5 s, puis la fermeture (freinée, 3 s) commence
  assert.ok([...R.g.X].includes(3), `fermeture : X${[...R.g.X]}`);
  keys.add(inputKey('obs')); simulate(c, keys, 0.4, R);
  assert.ok([...R.g.X].includes(1), 'obstacle : retour en X1');
  keys.delete(inputKey('obs')); simulate(c, keys, 15, R);
  assert.equal(seqOf(R), 'A+ A− A+ A−', seqOf(R));
});

test('Programme Arduino d’un GRAFCET : entrées et électrovanne du montage, compile', async () => {
  const fs = await import('node:fs');
  const { BOARDS } = await import('../sim/boards.js');
  const { PARTS, partOf } = await import('../sim/parts.js');
  const { analyze, inspect, bbGroups } = await import('../sim/circuit.js');
  const { compile } = await import('../prog/lang.js');
  const { grafcetProgram } = await import('./grafcode.js');
  // Montage de la porte électropneumatique (TP pn05) câblé comme sa solution : BTN1 sur D7, B2 sur D3, Y1 par Q1 (D2).
  const tp = JSON.parse(fs.readFileSync(new URL('../lab/pneu/pn05-porte-electropneumatique.json', import.meta.url), 'utf8'));
  const keysOf = c => {
    const prof = BOARDS[c.type];
    if (prof) return [...Object.keys(prof.gpio), ...Object.keys(prof.power), 'GND', 'GND (2)', 'GND (3)', 'VIN', 'AREF', 'IOREF'];
    if (/^breadboard/.test(c.type)) return bbGroups(c).flatMap(g => g.keys);
    if (/^res-/.test(c.type)) return ['1', '2'];
    if (c.type === 'psu24') return ['+', '-'];
    const sp = PARTS[c.type]; return sp && sp.pins ? sp.pins.map(p => p.pin) : [];
  };
  const comps = tp.start.comps.map(c => ({ ...c, pins: Object.fromEntries(keysOf(c).map(k => [k, {}])), inp: {} }));
  const byId = Object.fromEntries(comps.map(c => [c.id, c]));
  const wires = tp.solution.wires.map(w => ({ a: { comp: byId[w.a[0]], key: w.a[1] }, b: { comp: byId[w.b[0]], key: w.b[1] }, progress: 1 }));
  const A = analyze(comps, wires), cache = new Map();
  const cx = { comps, A, inspect: c => { if (!cache.has(c)) cache.set(c, inspect(c, A, partOf(c))); return cache.get(c); } };
  const board = comps.find(c => BOARDS[c.type]);
  const g = G([[0, '', '↑btn1 . /b2'], [1, 'Y1', 'b2'], [2, 'Y1, LED1', '2s/X2'], [3, '', '/b2'], [4, '', 'X4 . 0']]);
  g.steps[3].to = 0; // X3 → X0 (X4 : étape isolée, jamais atteinte)
  const r = grafcetProgram(board, cx, g);
  assert.ok(r.code, r.error);
  assert.deepEqual(r.missingIn, []); assert.deepEqual(r.missingOut, []);
  for (const s of ['bool X0 = true;', 'bool X1 = false;', 'debutX2 = millis();', 'millis() - debutX2 >= 2000UL', '_avant', 'digitalWrite(']) assert.ok(r.code.includes(s), `${s}\n${r.code}`);
  const res = compile(r.code, { board: 'uno' });
  assert.ok(res.ok, JSON.stringify(res.errors) + '\n' + r.code);
  // Variable sans entrée du montage, action sans effecteur : signalées, le programme compile quand même.
  const r2 = grafcetProgram(board, cx, G([[0, '', 'dcy'], [1, '9Y9', 'b2']]));
  assert.deepEqual(r2.missingIn, ['dcy']); assert.deepEqual(r2.missingOut, ['9Y9']);
  assert.ok(compile(r2.code, { board: 'uno' }).ok);
  // Branches parallèles, macro-étape, action mémorisée.
  const g3 = { drive: true, inputs: [], steps: [{ n: 0, init: true, act: '', r: 'btn1' }, { n: 1, act: 'Y1:=1', r: '1' },
    { par: [[{ n: 2, act: 'LED1', r: '1s/X2' }, { n: 3, act: '' }], [{ n: 4, macro: true, r: '', exp: [{ n: 40, act: '', r: 'b2' }, { n: 41, act: '' }] }]], r: 'X4 + /X4' },
    { n: 5, act: 'Y1:=0', r: '/b2' }] };
  const r3 = grafcetProgram(board, cx, g3);
  assert.ok(r3.code, r3.error);
  for (const s of ['bool M_Y1 = false;', 'X3 && X41 &&', 'X1 = true; M_Y1 = true;', 'X5 = true; M_Y1 = false;', '(X40 || X41)', 'X2 = true; debutX2 = millis(); X40 = true;']) assert.ok(r3.code.includes(s), `${s}\n${r3.code}`);
  assert.ok(compile(r3.code, { board: 'uno' }).ok, r3.code);
  // GRAFCET partiels et forçage, étape encapsulante, compteur.
  const g4 = cleanGrafcet({ name: 'GPN', inputs: [], steps: [{ n: 0, init: true, act: 'N:=0', r: 'btn1' },
    { n: 1, act: '', r: 'N >= 2', enc: [{ n: 10, init: true, act: 'Y1, N:=N+1', r: 'b2' }, { n: 11, act: 'LED1', r: '/b2' }] }],
  parts: [{ name: 'GS', steps: [{ n: 100, init: true, act: '', r: 'b2 . btn1' }, { n: 101, act: 'F/GPN:{0}', r: '/btn1' }] }] });
  assert.deepEqual(compileGrafcet(g4).errors, []);
  const r4 = grafcetProgram(board, cx, g4);
  assert.ok(r4.code, r4.error);
  for (const s of ['long V_N = 0;', 'V_N = (V_N + 1);', '(V_N >= 2)', 'bool force_GPN = X101;', '!force_GPN && X0', 'X1 = true; X10 = true; V_N = (V_N + 1);', 'X1 = false; X10 = false; X11 = false;', 'if (X101) {']) assert.ok(r4.code.includes(s), `${s}\n${r4.code}`);
  assert.ok(compile(r4.code, { board: 'uno' }).ok, r4.code);
});

test('Parallèle (ET), macro-étape et actions mémorisées : évolution', () => {
  // Divergence en ET de X1 vers X2 et X4 ; convergence de X3 et X5 vers X6.
  let C = compileGrafcet({ steps: [{ n: 1, init: true, act: '', r: 'go' }, { par: [[{ n: 2, act: 'P', r: 'a' }, { n: 3, act: '' }], [{ n: 4, act: 'Q', r: 'b' }, { n: 5, act: '' }]], r: 'c' }, { n: 6, act: 'R', r: 'd' }] });
  assert.deepEqual(C.errors, []);
  assert.deepEqual(C.trans.map(t => [t.from, t.to]), [[[1], [2, 4]], [[2], [3]], [[4], [5]], [[3, 5], [6]], [[6], [1]]]);
  let run = createGrafRun();
  assert.deepEqual(scan(C, run, { go: 1 }), { X: [2, 4], out: ['P', 'Q'] });
  assert.deepEqual(scan(C, run, { a: 1, c: 1 }), { X: [3, 4], out: ['Q'] }, 'la convergence attend X5');
  assert.deepEqual(scan(C, run, { b: 1, c: 1 }), { X: [6], out: ['R'] });
  // Macro-étape M7 : entrée 70, sortie 71 ; X7 vrai tant qu'une étape de l'expansion est active.
  C = compileGrafcet({ steps: [{ n: 0, init: true, act: '', r: 'go' }, { n: 7, macro: true, r: 'X7 . k', exp: [{ n: 70, act: 'E', r: 'e' }, { n: 71, act: 'S' }] }] });
  assert.deepEqual(C.errors, []);
  assert.deepEqual(C.trans.map(t => [t.from, t.to]), [[[0], [70]], [[70], [71]], [[71], [0]]]);
  run = createGrafRun();
  assert.deepEqual(scan(C, run, { go: 1 }), { X: [70], out: ['E'] });
  assert.deepEqual(scan(C, run, { k: 1 }), { X: [70], out: ['E'] }, 'la sortie attend l’étape S');
  assert.deepEqual(scan(C, run, { e: 1 }), { X: [71], out: ['S'] });
  assert.deepEqual(scan(C, run, { k: 1 }), { X: [0], out: [] });
  // Action mémorisée : H:=1 en X1 tient jusqu'à H:=0 en X3, même si X2 est franchie sans s'arrêter.
  C = compileGrafcet(G([[0, '', 'go'], [1, 'H:=1', 'a'], [2, 'K:=1', 'b'], [3, 'H:=0, K:=0', 'c']]));
  run = createGrafRun();
  assert.deepEqual(scan(C, run, { go: 1 }), { X: [1], out: ['H'] });
  assert.deepEqual(scan(C, run, { a: 1, b: 1 }), { X: [3], out: [] }, 'X2 instable : K:=1 exécuté, puis K:=0 en X3');
  assert.deepEqual(scan(C, run, { c: 1 }), { X: [0], out: [] });
  run = createGrafRun(); scan(C, run, { go: 1 }); scan(C, run, { a: 1 });
  assert.deepEqual(scan(C, run, {}), { X: [2], out: ['H', 'K'] });
  // Structures mal formées : signalées.
  assert.ok(compileGrafcet({ steps: [{ n: 0, init: true, r: 'x' }, { par: [[{ n: 1 }]], r: '' }] }).errors.some(e => /deux branches/.test(e.text)));
  assert.ok(compileGrafcet(G([[0, '', 'X9']])).errors.some(e => /X9/.test(e.text)));
  const g = cleanGrafcet({ steps: [{ n: 0, init: true }, { par: [[{ n: 1 }], [{ n: 0 }, { n: 2 }]] }, { n: 3, macro: true, exp: [] }] });
  assert.deepEqual(JSON.stringify(g.steps.map(s => s.par ? s.par.map(b => b.map(x => x.n)) : [s.n, !!s.macro])), '[[0,false],[[1],[2]],[3,false]]', 'n en double retiré, macro sans expansion : étape');
});

test('Cycles des exemples : macro-étape (A+ B+ B− A−), branches parallèles et action mémorisée (A+ B+ C+ B− C− A−)', () => {
  const m = clean(grafcetCircuit(true));
  const { MACRO_GRAFCET, threeCircuit } = examples;
  m.grafcet = cleanGrafcet(MACRO_GRAFCET());
  assert.deepEqual(checkPneu(m).filter(i => i.level === 'error'), []);
  const R = simulate(m, new Set([inputKey('dcy')]), 8);
  assert.ok(hasSequence(R.rec.moves, 'A+ B+ B- A-'), seqOf(R));
  const p = clean(threeCircuit(true));
  assert.deepEqual(checkPneu(p).filter(i => i.level === 'error'), []);
  const r = simulate(p, new Set([inputKey('dcy')]), 1.2);
  assert.ok(r.out.has('1Y1') && [...r.g.X].sort().join() === '2,5', `A serré (1Y1 mémorisée), B et C partent ensemble : X${[...r.g.X]}`);
  simulate(p, new Set(), 8, r);
  assert.equal(seqOf(r), 'A+ B+ C+ B− C− A−');
});

test('Compteurs, forçage entre GRAFCET partiels, étape encapsulante', () => {
  // Compteur : X1 → X2 → X1 tant que C < 3 (C:=C+1 à chaque activation de X1, même instable), puis X3.
  let C = compileGrafcet(G([[0, 'C:=0', 'go'], [1, 'C:=C+1', 'a'], [2, '', 'C >= 3', 3, [{ r: '[C<3]', to: 1 }]], [3, 'Y', 'b']]));
  assert.deepEqual(C.errors, []); assert.deepEqual([...C.counters], ['C']); assert.deepEqual([...C.outputs], ['Y']);
  let run = createGrafRun();
  scan(C, run, { go: 1 });
  assert.deepEqual(scan(C, run, { a: 1 }), { X: [3], out: ['Y'] });
  assert.equal(run.mem.get('C'), 3);
  // « a0 = 1 » : a0 n'est affecté nulle part, c'est une entrée.
  C = compileGrafcet(G([[0, '', 'a0 = 1'], [1, 'Y', 'a0 = 0']])); run = createGrafRun();
  assert.equal(C.counters.size, 0);
  assert.deepEqual(scan(C, run, { a0: 1 }), { X: [1], out: ['Y'] });
  // Forçage : GS force G1 dans sa situation {0} pendant l'arrêt d'urgence ; G1 n'évolue plus ; levé, G1 repart.
  const g = { name: 'G1', inputs: [], steps: [{ n: 0, init: true, act: '', r: 'go' }, { n: 1, act: 'Y1', r: 'a' }], parts: [{ name: 'GS', steps: [{ n: 100, init: true, act: '', r: 'au' }, { n: 101, act: 'F/G1:{0}, H', r: '/au' }] }] };
  C = compileGrafcet(cleanGrafcet(g)); run = createGrafRun();
  assert.deepEqual(C.errors, []);
  assert.deepEqual(scan(C, run, { go: 1 }), { X: [1, 100], out: ['Y1'] });
  assert.deepEqual(scan(C, run, { au: 1, go: 1 }), { X: [0, 101], out: ['H'] }, 'forcé en {0}, figé malgré go');
  assert.deepEqual([...run.forced.keys()], ['G1']);
  assert.deepEqual(scan(C, run, { go: 1 }), { X: [1, 100], out: ['Y1'] }, 'forçage levé : G1 évolue');
  // {*} fige, {INIT} remet la situation initiale, {} vide.
  for (const [sit, want] of [['*', [1, 101]], ['INIT', [0, 101]], ['', [101]]]) {
    const h = cleanGrafcet({ ...g, parts: [{ name: 'GS', steps: [{ n: 100, init: true, act: '', r: 'au' }, { n: 101, act: `F/G1:{${sit}}`, r: '/au' }] }] });
    const K = compileGrafcet(h), rr = createGrafRun();
    scan(K, rr, { go: 1 });
    assert.deepEqual(scan(K, rr, { au: 1 }).X, want, `F/G1:{${sit}}`);
    assert.deepEqual(scan(K, rr, { au: 1, a: 1, go: 1 }).X, want, `F/G1:{${sit}} : G1 n’évolue pas`);
  }
  assert.ok(compileGrafcet(cleanGrafcet({ ...g, parts: [{ name: 'GS', steps: [{ n: 100, init: true, act: 'F/GS:{100}', r: 'x' }] }] })).errors.some(e => /lui-même/.test(e.text)));
  assert.ok(compileGrafcet(cleanGrafcet({ ...g, parts: [{ name: 'GS', steps: [{ n: 100, init: true, act: 'F/G9:{0}', r: 'x' }] }] })).errors.some(e => /G9/.test(e.text)));
  assert.ok(compileGrafcet(cleanGrafcet({ ...g, parts: [{ name: 'GS', steps: [{ n: 100, init: true, act: 'F/G1:{100}', r: 'x' }] }] })).errors.some(e => /100/.test(e.text)));
  // Étape encapsulante : X1 active son encapsulation (10*), qui évolue tant que X1 l'est ; tout s'éteint avec X1.
  C = compileGrafcet(cleanGrafcet({ steps: [{ n: 0, init: true, act: '', r: 'on' }, { n: 1, act: 'H', r: 'off . X11', enc: [{ n: 10, init: true, act: 'P', r: 'a' }, { n: 11, act: 'Q', r: 'b' }] }] }));
  assert.deepEqual(C.errors, []);
  run = createGrafRun();
  assert.deepEqual(scan(C, run, { on: 1 }), { X: [1, 10], out: ['H', 'P'] });
  assert.deepEqual(scan(C, run, { off: 1 }), { X: [1, 10], out: ['H', 'P'] }, 'X1 attend X11');
  assert.deepEqual(scan(C, run, { a: 1 }), { X: [1, 11], out: ['H', 'Q'] });
  assert.deepEqual(scan(C, run, { off: 1 }), { X: [0], out: [] }, 'encapsulation éteinte avec X1');
  assert.deepEqual(scan(C, run, { on: 1 }), { X: [1, 10], out: ['H', 'P'] });
  assert.ok(compileGrafcet(cleanGrafcet({ steps: [{ n: 0, init: true, r: 'x', enc: [{ n: 5, act: '' }] }] })).errors.some(e => /encapsulation/.test(e.text)));
});

test('Exemples : trois cycles comptés, arrêt d’urgence forcé puis réarmé ; marche automatique encapsulée', () => {
  const { SAFETY_GRAFCET, ENCL_GRAFCET } = examples;
  const c = clean({ ...grafcetCircuit(true), grafcet: SAFETY_GRAFCET() });
  assert.deepEqual(checkPneu(c).filter(i => i.level === 'error'), []);
  const keys = new Set([inputKey('dcy')]), R = simulate(c, keys, 0.3); keys.clear();
  simulate(c, keys, 16, R);
  assert.equal(seqOf(R), Array(3).fill('A+ B+ B− A−').join(' '), 'trois cycles, puis arrêt');
  assert.equal(R.g.mem.get('N'), 0, 'N remis à 0 en X0');
  // Arrêt d'urgence en plein cycle : GPN forcé en {0}, les tiges rentrent ; au relâché, rea réarme.
  keys.add(inputKey('dcy')); simulate(c, keys, 1.6, R); keys.clear();
  keys.add(inputKey('au')); simulate(c, keys, 3, R);
  assert.deepEqual([...R.g.X].sort((a, b) => a - b), [0, 101]);
  assert.ok(R.st.x.A < 0.02 && R.st.x.B < 0.02, 'tiges rentrées');
  keys.add(inputKey('dcy')); simulate(c, keys, 1, R);
  assert.deepEqual([...R.g.X].sort((a, b) => a - b), [0, 101], 'forcé : dcy sans effet');
  keys.clear(); keys.add(inputKey('rea')); simulate(c, keys, 0.2, R); keys.clear();
  assert.deepEqual([...R.g.X].sort((a, b) => a - b), [0, 100], 'réarmé');
  // Étape encapsulante : les cycles s'enchaînent pendant X1 ; arret attendu en fin de cycle.
  const e = clean({ ...grafcetCircuit(true), grafcet: ENCL_GRAFCET() });
  assert.deepEqual(checkPneu(e).filter(i => i.level === 'error'), []);
  const k2 = new Set([inputKey('marche')]), S = simulate(e, k2, 0.3); k2.clear();
  simulate(e, k2, 9, S);
  assert.ok(S.rec.moves.length >= 8, seqOf(S));
  k2.add(inputKey('arret')); simulate(e, k2, 6, S);
  assert.deepEqual([...S.g.X], [0], 'X1 et son encapsulation désactivées');
  const n = S.rec.moves.length; simulate(e, k2, 3, S);
  assert.equal(S.rec.moves.length, n, 'plus de mouvement');
  assert.equal(n % 4, 0, `cycle terminé avant l’arrêt : ${seqOf(S)}`);
});
