// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Procédés des machines (process.js) : magasin et transfert, embouteillage, barrière ; leurs capteurs, leurs compteurs,
// leurs alarmes, et leur marche avec le circuit (un GRAFCET ou un automate qui les lit). node --test src/pneu/process.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const i18n = await import('../i18n/index.js');
await i18n.loadLanguage();
const P = await import('./process.js');
const { createRunner, runStep, inputKey } = await import('./run.js');
const { clean } = await import('./clean.js');

/** Procédé mené pas à pas avec des positions imposées : run(dt, positions) ; la lecture des capteurs. */
function drive(kind) {
  const s = P.createProcess(kind);
  const pos = {};
  return { s, pos, run(t, p = {}) { Object.assign(pos, p); for (let k = 0; k < Math.round(t / 0.02); k++) P.stepProcess(s, 0.02, r => pos[r] || 0); return P.PROCESSES[kind].read(s); } };
}

test('Magasin : le poussoir amène une pièce, la ventouse la prend bras rentré et la dépose bras sorti', () => {
  const d = drive('feeder');
  assert.deepEqual(d.run(0.1), { mag: true, pp: false }, 'au départ : magasin plein, rien en position');
  assert.deepEqual(d.run(0.1, { push: 1 }), { mag: true, pp: true }, 'poussoir sorti : une pièce en position de prise');
  assert.equal(d.s.n, P.FEED.mag - 1);
  d.run(0.1, { push: 0 });
  assert.equal(d.run(0.1, { down: 1 }).pp, false, 'ventouse descendue bras rentré : la pièce est emportée');
  assert.equal(d.s.held, true);
  d.run(0.1, { down: 0 }); d.run(0.1, { arm: 1 });
  d.run(0.1, { down: 1 }); assert.equal(d.s.held, false); assert.equal(d.s.done, 1, 'déposée bras sorti');
  d.run(0.1, { down: 0, arm: 0 });
  // Descendre sans pièce ne prend rien ; une pièce déjà en position et un second coup de poussoir : bourrage.
  d.run(0.1, { down: 1 }); assert.equal(d.s.held, false); d.run(0.1, { down: 0 });
  d.run(0.1, { push: 1 }); d.run(0.1, { push: 0 }); d.run(0.1, { push: 1 });
  assert.equal(d.s.jam, 1); assert.ok(P.processHud({ kind: 'feeder' }, d.s).some(h => h.alarm), 'alarme de bourrage affichée');
  d.run(0.1, { push: 0 }); assert.ok(!P.processHud({ kind: 'feeder' }, d.s).some(h => h.alarm), 'alarme levée quand le poussoir revient');
  // Magasin vidé : le capteur mag tombe ; « remplir » le regarnit.
  const e = drive('feeder');
  for (let i = 0; i < P.FEED.mag; i++) { e.run(0.1, { push: 1 }); e.run(0.1, { push: 0 }); e.run(0.1, { down: 1 }); e.run(0.1, { down: 0 }); e.run(0.1, { arm: 1 }); e.run(0.1, { down: 1 }); e.run(0.1, { down: 0 }); e.run(0.1, { arm: 0 }); }
  assert.equal(e.s.done, P.FEED.mag, 'toutes transférées');
  assert.deepEqual(e.run(0.02), { mag: false, pp: false });
  P.actProcess(e.s, 'refill'); assert.equal(e.run(0.02).mag, true);
  assert.equal(e.s.acts.length, 0, 'action consommée');
  P.actProcess(e.s, 'nope'); assert.equal(e.s.acts.length, 0, 'action inconnue ignorée');
});

test('Embouteillage : la butée arrête la bouteille sous le bec, le bec la remplit, le niveau monte, le jus coule à vide', () => {
  const K = P.FILL, d = drive('filler');
  let r = d.run(K.first + 0.1, { stop: 1 });
  assert.equal(d.s.bottles.length, 1, 'première bouteille arrivée');
  const arrive = (K.xs - K.x0) / K.speed;
  r = d.run(arrive + 0.5, { stop: 1 });
  assert.deepEqual(r, { pb: true, niv: false }, 'bouteille arrêtée sous le bec, vide');
  assert.ok(Math.abs(d.s.bottles[0].x - K.xs) < 1e-9, 'exactement à la butée');
  r = d.run(K.fillTime / 2, { fill: 1 }); assert.equal(r.niv, false); assert.ok(d.s.bottles[0].lvl > 0.4 && d.s.bottles[0].lvl < 0.6);
  r = d.run(K.fillTime / 2 + 0.1, { fill: 1 }); assert.deepEqual(r, { pb: true, niv: true }, 'pleine');
  assert.equal(d.s.spilling, true, 'bec encore ouvert sur une bouteille pleine : ça déborde');
  d.run(0.1, { fill: 0 }); assert.equal(d.s.spilling, false);
  r = d.run(1, { stop: 0 }); assert.equal(r.pb, false, 'butée rentrée : la bouteille repart');
  d.run((K.x1 - K.xs) / K.speed + 0.5, { stop: 0 });
  assert.equal(d.s.full, 1); assert.equal(d.s.bad, 0);
  // Une bouteille qui passe sans s'arrêter est comptée mal remplie ; le bec ouvert sans bouteille renverse du jus.
  const e = drive('filler');
  P.actProcess(e.s, 'bottle'); e.run((K.x1 - K.x0) / K.speed + 0.5, { stop: 0, fill: 1 });
  assert.equal(e.s.bad, 1); assert.ok(e.s.spill > 1, 'du jus renversé'); assert.ok(P.processHud({ kind: 'filler' }, e.s).some(h => h.alarm));
  // Les bouteilles ne se chevauchent pas derrière la butée.
  const f = drive('filler');
  f.run(K.first + 0.1, { stop: 1 }); P.actProcess(f.s, 'bottle'); f.run(0.02, { stop: 1 });
  assert.equal(f.s.bottles.length, 1, 'pas de place pour une deuxième tout de suite');
  f.run(0.7, { stop: 1 }); P.actProcess(f.s, 'bottle'); f.run(0.02, { stop: 1 }); assert.equal(f.s.bottles.length, 2, 'une fois la première avancée d’un entraxe');
  f.run(20, { stop: 1 });
  const xs = f.s.bottles.map(b => b.x).sort((a, b) => b - a);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i - 1] - xs[i] >= K.gap - 1e-9, 'entraxe respecté');
  assert.ok(Math.abs(xs[0] - K.xs) < 1e-9, 'la première attend à la butée');
});

test('Barrière : la voiture attend à la boucle, passe lisse levée, choc si la lisse descend sur elle', () => {
  const K = P.BAR, d = drive('barrier');
  P.actProcess(d.s, 'car');
  let r = d.run(6, { lift: 0 });
  assert.deepEqual(r, { veh: true, pass: false }, 'arrêtée à la ligne, détectée par la boucle');
  assert.ok(Math.abs(d.s.cars[0].x - (K.xwait - K.len / 2)) < 1e-9);
  r = d.run((K.len / 2 + K.zone + 0.3) / K.speed, { lift: 1 });
  assert.equal(r.pass, true, 'sous la lisse');
  assert.equal(d.s.hit, 0);
  r = d.run(0.1, { lift: 0 });
  assert.equal(d.s.hit, 1, 'la lisse est descendue sur la voiture'); assert.ok(P.processHud({ kind: 'barrier' }, d.s).some(h => h.alarm));
  d.run(5, { lift: 0 });
  assert.equal(d.s.passed, 1); assert.deepEqual(P.PROCESSES.barrier.read(d.s), { veh: false, pass: false });
  // Deux voitures : la seconde attend derrière la première, la boucle les voit l'une après l'autre.
  const e = drive('barrier');
  P.actProcess(e.s, 'car'); e.run(1.2); P.actProcess(e.s, 'car'); e.run(6);
  assert.equal(e.s.cars.length, 2); assert.ok(e.s.cars[0].x - e.s.cars[1].x >= K.len + K.follow - 1e-9, 'distance de suivi');
  P.actProcess(e.s, 'car'); e.run(0.02); assert.equal(e.s.cars.length, 2, 'pas de voiture sur une voiture à l’entrée');
});

test('Procédé dans le pas de simulation : un GRAFCET lit les capteurs de la machine, la vue 3D n’est pas nécessaire', () => {
  // Embouteillage : la butée sort au départ ; bouteille présente → le bec descend ; niveau → le bec remonte ; bec en haut → la butée rentre
  // 1 s (la bouteille part) ; puis la butée ressort.
  const circuit = clean({
    elements: [
      { id: 'A', type: 'cyl2', x: 0, y: 0, p: { label: 'A', s0: 'a0', s1: 'a1', time: 0.5 } }, { id: 'B', type: 'cyl2', x: 30, y: 0, p: { label: 'B', s0: 'b0', s1: 'b1', time: 0.5 } },
      { id: 'v1', type: 'v52', x: -8, y: 12, p: { left: 'sol', right: 'spring', coilL: 'Y1', label: '1V1' } }, { id: 'v2', type: 'v52', x: 22, y: 12, p: { left: 'sol', right: 'spring', coilL: 'Y2', label: '2V1' } },
      { id: 'src', type: 'supply', x: 1, y: 22, p: {} }
    ],
    tubes: [{ id: 't1', a: ['src', '1'], b: ['v1', '1'] }, { id: 't2', a: ['v1', '4'], b: ['A', '1'] }, { id: 't3', a: ['v1', '2'], b: ['A', '2'] }, { id: 't4', a: ['src', '1'], b: ['v2', '1'] }, { id: 't5', a: ['v2', '4'], b: ['B', '1'] }, { id: 't6', a: ['v2', '2'], b: ['B', '2'] }],
    scene: { kind: 'filler', stop: 'A', fill: 'B', pb: 'pb', niv: 'niv' },
    grafcet: { inputs: [{ name: 'm', kind: 'switch' }], steps: [
      { n: 0, init: true, act: '', r: 'm', to: 1 }, { n: 1, act: 'Y1', r: 'a1 . pb', to: 2 }, { n: 2, act: 'Y1, Y2', r: 'niv', to: 3 },
      { n: 3, act: 'Y1', r: 'b0', to: 4 }, { n: 4, act: '', r: 'NON pb . 1s/X4', to: 0 }
    ] }
  });
  assert.deepEqual(circuit.scene, { kind: 'filler', stop: 'A', fill: 'B', pb: 'pb', niv: 'niv' }, 'scène gardée au nettoyage');
  const R = createRunner(), dt = 0.02, io = { coil: () => false, pushed: k => k === inputKey('m') };
  const sens = n => !!(R.res && R.res.sensors.get(n));
  let filled = -1, left = -1, spilled = false;
  for (let t = 0; t < 30; t += dt) {
    runStep(R, circuit, io, dt);
    if (filled < 0 && sens('niv')) filled = t;
    if (filled >= 0 && left < 0 && !sens('pb')) left = t;
    if (R.proc.spilling) spilled = true;
  }
  assert.ok(R.proc && R.proc.kind === 'filler', 'procédé créé par le pas de simulation');
  assert.ok(filled > 0, 'une bouteille a été remplie'); assert.ok(left > filled, 'puis libérée');
  assert.equal(spilled, false, 'le bec n’a jamais coulé à vide');
  assert.ok(R.proc.full >= 1, `au moins une bouteille pleine (${R.proc.full})`); assert.equal(R.proc.bad, 0);
  assert.ok(R.rec.moves.some(m => m.name === 'B' && m.dir === '+'), 'le bec est descendu');
  // Sans scène : pas de procédé ; scène changée : procédé neuf.
  runStep(R, { ...circuit, scene: null }, io, dt); assert.equal(R.proc, null);
  runStep(R, { ...circuit, scene: { kind: 'barrier' } }, io, dt); assert.equal(R.proc.kind, 'barrier');
});

test('Noms et positions des rôles : capteurs renommés par la scène, vérins par repère ou par rang', () => {
  const circuit = { elements: [{ id: 'c1', type: 'cyl2', p: { label: 'A' } }, { id: 'c2', type: 'cyl2', p: { label: 'B' } }, { id: 'c3', type: 'cyl1', p: {} }], scene: { kind: 'feeder', arm: 'c3', pp: 'B2' } };
  assert.deepEqual(P.processSensorNames(circuit.scene), ['mag', 'B2']);
  assert.deepEqual(P.processActRoles(circuit.scene), ['refill']);
  const pos = P.cylPositions(circuit, { c1: 0.5, c2: 1, c3: 0.25 });
  assert.equal(pos('push'), 0.5, 'premier vérin par rang'); assert.equal(pos('arm'), 0.25, 'par identifiant'); assert.equal(pos('down'), 0.25, 'troisième par rang (c3)');
  assert.equal(P.cylPositions({ elements: [], scene: { kind: 'barrier' } }, {})('lift'), 0, 'sans vérin : 0');
  assert.deepEqual([...P.processSensors(circuit.scene, P.createProcess('feeder'))], [['mag', true], ['B2', false]]);
  assert.equal(P.processSensors({ kind: 'door' }, null).size, 0);
  assert.equal(P.processOf({ kind: 'door' }), null); assert.equal(P.processOf(null), null);
});

test('Exemples de machines : chaque programme mène son procédé au bout, sans faute du vérificateur', async () => {
  const { PNEU_EXAMPLES } = await import('./examples.js');
  const { checkPneu } = await import('./check.js');
  const by = id => clean(PNEU_EXAMPLES.find(x => x.id === id).circuit());
  for (const id of ['feeder', 'filler', 'barrier']) assert.deepEqual(checkPneu(by(id), { coils: [], sensors: [] }), [], id);
  /** Fait tourner `s` secondes ; pushed(t) → ensemble des touches appuyées ; acts : { t: rôle } actions du procédé. */
  const go = (c, s, pushed, acts = {}) => {
    const R = createRunner(), dt = 0.02; let t = 0, keys = new Set();
    const io = { coil: () => false, pushed: k => keys.has(k), input: () => false };
    for (; t < s; t += dt) { keys = pushed(t); for (const [at, role] of Object.entries(acts)) if (Math.abs(t - +at) < dt / 2) actProcess(R.proc, role); runStep(R, c, io, dt); }
    return R;
  };
  const { actProcess } = P;
  // Magasin : dcy toutes les 12 s → trois pièces transférées, aucun bourrage, le GRAFCET observe et l'automate commande.
  const f = go(by('feeder'), 36, t => new Set(t % 12 >= 0.5 && t % 12 < 0.8 ? [inputKey('dcy')] : []));
  assert.equal(f.proc.done, 3, `pièces transférées : ${f.proc.done}`); assert.equal(f.proc.jam, 0);
  assert.ok(f.rec.moves.filter(m => m.name === 'C' && m.dir === '+').length >= 6, 'deux descentes par pièce');
  assert.ok(f.pOut.size >= 0 && by('feeder').grafcet.drive === false, 'l’automate commande');
  // Embouteillage : m en marche 30 s → au moins deux bouteilles pleines, aucune mal remplie, pas de jus renversé.
  const b = go(by('filler'), 30, () => new Set([inputKey('m')]));
  assert.ok(b.proc.full >= 2, `pleines : ${b.proc.full}`); assert.equal(b.proc.bad, 0); assert.equal(b.proc.spill, 0);
  assert.equal(b.rec.moves.slice(0, 5).map(m => m.name + m.dir).join(' '), 'A+ B+ B- A- A+', 'butée sortie, bec descendu puis remonté, butée rentrée puis ressortie');
  // Barrière : une voiture à 1 s, badge à 1,2 s → elle passe, la lisse se referme (A+ puis A−), aucun choc.
  const r = go(by('barrier'), 16, t => new Set(t >= 1.2 && t < 1.5 ? [inputKey('badge')] : []), { 1: 'car' });
  assert.equal(r.proc.passed, 1); assert.equal(r.proc.hit, 0);
  const seq = r.rec.moves.map(m => m.name + m.dir); assert.deepEqual(seq, ['A+', 'A-'], seq.join(' '));
  // Sans le contact pass dans la temporisation (programme naïf : refermer 2 s après l'ouverture), deux voitures qui se
  // suivent de près : la lisse descend sur la seconde.
  const unsafe = by('barrier'); unsafe.plc.rungs.find(x => x.id === 'r3').items = unsafe.plc.rungs.find(x => x.id === 'r3').items.filter(k => k.v !== 'pass');
  const u = go(unsafe, 16, t => new Set(t >= 1.2 && t < 1.5 ? [inputKey('badge')] : []), { 1: 'car', 2.2: 'car' });
  assert.ok(u.proc.hit >= 1, 'choc attendu sans sécurité');
  const safe = go(by('barrier'), 16, t => new Set(t >= 1.2 && t < 1.5 ? [inputKey('badge')] : []), { 1: 'car', 2.2: 'car' });
  assert.equal(safe.proc.hit, 0, 'la sécurité rouvre la lisse'); assert.equal(safe.proc.passed, 2);
});
