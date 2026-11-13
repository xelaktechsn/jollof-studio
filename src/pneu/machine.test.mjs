// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Machine 3D : cinématique des machines (porte, pantographe, convoyeur, pièces travaillées), registre des scènes et
// réglages gardés avec le circuit. node --test src/pneu/machine.test.mjs
// (le rendu WebGL se vérifie dans l'application ; ici, la position des pièces et ce qu'on garde du projet).
import test from 'node:test';
import assert from 'node:assert/strict';

const i18n = await import('../i18n/index.js');
await i18n.loadLanguage();
const { clean } = await import('./clean.js');
const { doorCircuit } = await import('./examples.js');

test('Porte : un vérin, deux vantaux en sens inverse par la courroie, poulies qui tournent avec elle', async () => {
  // machine.js importe Three.js : seule la fonction de pose est chargée ici, sans WebGL.
  const { doorPose, DOOR } = await import('./machine.js');
  assert.deepEqual(doorPose(0), { left: -0, right: 0, rod: 0, pulley: 0 });
  const open = doorPose(1);
  assert.equal(open.right, DOOR.travel); assert.equal(open.left, -DOOR.travel, 'vantaux en sens inverse');
  assert.equal(open.rod, DOOR.travel, 'la tige pousse le vantail gauche de toute la course');
  assert.ok(Math.abs(open.pulley * DOOR.pulleyR - DOOR.travel) < 1e-9, 'la courroie ne glisse pas sur les poulies');
  assert.deepEqual(doorPose(2), open, 'bornée à la course');
  assert.ok(DOOR.travel < DOOR.leafW, 'un vantail ouvert ne sort pas de la caisse');
});

test('Scène 3D gardée avec le circuit, liaisons nettoyées', () => {
  const c = clean(doorCircuit(true));
  assert.deepEqual(c.scene, { kind: 'door', cyl: 'A', open: 'dcy', obstacle: 'obs', coil: '1Y1' });
  assert.deepEqual(clean({ elements: [], scene: { kind: 'tank', cyl: 'A<script>', open: 3 } }).scene, { kind: 'cylinders', cyl: 'Ascript' });
  assert.equal(clean({ elements: [] }).scene, undefined);
  // Nouvelles machines : habillage, vérins des rôles et commandes gardés, 12 caractères au plus, rien d'autre.
  assert.deepEqual(clean({ elements: [], scene: { kind: 'door', skin: 'bus', cyl: 'A', open: 'dcy', obstacle: 'obs', emergency: 'au', extra: 'x' } }).scene, { kind: 'door', skin: 'bus', cyl: 'A', open: 'dcy', obstacle: 'obs', emergency: 'au' });
  assert.deepEqual(clean({ elements: [], scene: { kind: 'station', clamp: 'A', drill: 'B', start: 'dcy' } }).scene, { kind: 'station', clamp: 'A', drill: 'B', start: 'dcy' });
  assert.deepEqual(clean({ elements: [], scene: { kind: 'press', cyl: '1A', left: 'a', right: 'b' } }).scene, { kind: 'press', cyl: '1A', left: 'a', right: 'b' });
  assert.deepEqual(clean({ elements: [], scene: { kind: 'pantograph', cyl: 'A', up: 'lever_du_pantographe' } }).scene, { kind: 'pantograph', cyl: 'A', up: 'lever_du_pan' });
  assert.deepEqual(clean({ elements: [], scene: { kind: 'sorter', cyl: 'A', detect: 'det', send: 'colis' } }).scene, { kind: 'sorter', cyl: 'A', detect: 'det', send: 'colis' });
  assert.equal(clean({ elements: [], scene: { kind: 'bus' } }).scene.kind, 'cylinders', 'la porte de bus est une porte avec skin');
});

test('Registre des scènes : chaque machine, ses vérins et ses commandes ; la porte garde ses liaisons par défaut', async () => {
  const { SCENES, sceneId } = await import('./machine.js');
  assert.deepEqual(Object.keys(SCENES), ['cylinders', 'door', 'bus', 'press', 'station', 'pantograph', 'sorter']);
  for (const [id, s] of Object.entries(SCENES)) {
    assert.ok(s.name().length > 3, id);
    for (const c of s.cyls) assert.ok(c.key && c.label().length > 3, id);
    for (const c of s.controls) { assert.ok(['hold', 'toggle', 'click', 'auto'].includes(c.mode), `${id}.${c.role}`); if (c.mode !== 'auto') assert.ok(c.label('x').length > 2, `${id}.${c.role}`); }
    // Les réglages écrits par le menu survivent au nettoyage et redonnent la même scène.
    const cfg = clean({ elements: [], scene: s.cfg || { kind: id } }).scene;
    assert.equal(sceneId(cfg), id);
  }
  const ctl = (id, role) => SCENES[id].controls.find(c => c.role === role);
  assert.deepEqual([ctl('door', 'open').mode, ctl('door', 'open').defaults, ctl('door', 'open').bench], ['hold', ['dcy'], 0]);
  assert.deepEqual([ctl('door', 'obstacle').mode, ctl('door', 'obstacle').defaults, ctl('door', 'obstacle').bench], ['toggle', ['obs'], undefined]);
  assert.equal(ctl('bus', 'emergency').mode, 'toggle'); assert.equal(ctl('door', 'emergency'), undefined);
  assert.deepEqual(SCENES.station.cyls.map(c => c.key), ['clamp', 'drill']);
  assert.deepEqual(SCENES.press.controls.map(c => [c.role, c.mode]), [['left', 'toggle'], ['right', 'toggle']]);
  assert.equal(ctl('sorter', 'detect').mode, 'auto'); assert.equal(ctl('sorter', 'send').mode, 'click');
  assert.equal(sceneId({ kind: 'door' }), 'door'); assert.equal(sceneId({ kind: 'door', skin: 'bus' }), 'bus');
  assert.equal(sceneId({ kind: 'tank' }), 'cylinders'); assert.equal(sceneId(null), 'cylinders');
});

test('Pantographe : replié tige rentrée, bandes au fil tige sortie, hauteur croissante, tringlerie cohérente', async () => {
  const { pantoPose, PANTO: K } = await import('./machine.js');
  const p0 = { ...pantoPose(0) }, p1 = { ...pantoPose(1) };
  assert.ok(Math.abs(p0.a - K.fold) < 1e-9, 'replié : bras inférieur presque à plat');
  assert.ok(p0.h < 0.35 && p0.b < 0.2, 'replié : archet bas, bras supérieur couché');
  assert.ok(Math.abs(p1.h - K.wire) < 1e-9, 'tige sortie : le dessus des bandes est à la hauteur du fil de contact');
  assert.ok(Math.abs(p1.rod - K.stroke) < 1e-12 && p0.rod === 0);
  let prev = p0;
  for (let i = 1; i <= 100; i++) {
    const p = { ...pantoPose(i / 100) };
    assert.ok(p.h > prev.h && p.a > prev.a && p.b > prev.b, `la hauteur croît avec la course (${i} %)`);
    assert.ok(p.h <= K.wire + 1e-9, 'jamais au-dessus du fil');
    // Bras rigides, tête à l'aplomb du même point, biellette et manivelle de longueur constante.
    assert.ok(Math.abs(Math.hypot(p.ex, p.ey) - K.l1) < 1e-9 && Math.abs(Math.hypot(p.hx - p.ex, p.hy - p.ey) - K.l2) < 1e-9);
    assert.ok(Math.abs(p.hx - K.dx) < 1e-12);
    assert.ok(Math.abs(Math.hypot(p.px, p.py) - K.crank) < 1e-9 && Math.abs(Math.hypot(p.px - p.tx, p.py - K.cylY) - K.link) < 1e-9);
    assert.ok(Math.abs(Math.atan2(p.py, p.px) - p.a - K.lead) < 1e-9, 'manivelle calée sur le bras inférieur');
    prev = p;
  }
  assert.deepEqual({ ...pantoPose(2) }, p1, 'bornée à la course'); assert.deepEqual({ ...pantoPose(-1) }, p0);
  const out = {}; assert.equal(pantoPose(0.5, out), out, 'pose rendue dans l’objet donné (pas d’allocation par image)');
  assert.ok(K.stroke > 0.08 && K.stroke < 0.3, 'course de vérin plausible');
});

test('Convoyeur : 0,6 s dans le faisceau ; le colis ne quitte le tapis de côté que si le poussoir l’atteint', async () => {
  const { SORT: K, sortStep, pusherZ } = await import('./machine.js');
  assert.ok(Math.abs(K.len / K.speed - 0.6) < 1e-9, 'un colis coupe le faisceau 0,6 s');
  assert.equal(pusherZ(0), -K.half); assert.ok(Math.abs(pusherZ(1) - (K.stroke - K.half)) < 1e-12); assert.equal(pusherZ(3), pusherZ(1));
  assert.ok(pusherZ(1) + K.depth / 2 > K.half, 'en bout de course, le colis poussé a passé le bord du tapis');
  /** Un colis parcourt le tapis ; reach : course atteinte par le vérin (0…1), T : durée de sa course, lancé par la cellule. */
  const run = (reach, T = 1) => {
    const b = { x: K.x0 + 0.17, z: 0 }, dt = 0.02; let x = 0, dir = 0, r = 0, t = 0, beam = 0;
    while (!r && t < 20) {
      const cut = Math.abs(b.x - K.beam) < K.len / 2; if (cut) beam += dt;
      if (cut && dir === 0 && x === 0) dir = 1;
      if (dir > 0) { x = Math.min(reach, x + dt / T); if (x >= reach) dir = -1; } else if (dir < 0) { x = Math.max(0, x - dt / T); if (x === 0 && !cut) dir = 0; }
      r = sortStep(b, dt, pusherZ(x)); t += dt;
    }
    return { r, b, beam, t };
  };
  const none = run(0);
  assert.equal(none.r, 2, 'pas poussé : il tombe en bout de tapis'); assert.equal(none.b.z, 0);
  assert.ok(Math.abs(none.beam - 0.6) < 0.05, `temps dans le faisceau ${none.beam}`);
  for (const T of [0.5, 1, 1.5, 2]) assert.equal(run(1, T).r, 1, `poussé à fond (course en ${T} s) : il tombe de côté`);
  assert.equal(run(0.2).r, 2, 'le poussoir ne l’atteint pas : il reste sur le tapis');
  const half = run(0.5); assert.equal(half.r, 2, 'poussé à moitié : déplacé, mais encore sur le tapis'); assert.ok(half.b.z > 0.02 && half.b.z < K.half);
  // Poussoir resté sorti en travers : le colis suivant attend contre lui, puis repart quand il rentre.
  const w = { x: K.x0 + 0.17, z: 0 }; for (let i = 0; i < 600; i++) sortStep(w, 0.02, pusherZ(1));
  assert.ok(Math.abs(w.x + K.len / 2 - K.plate[0]) < 1e-9 && w.z === 0, 'arrêté contre le poussoir');
  let r = 0; for (let i = 0; i < 600 && !r; i++) r = sortStep(w, 0.02, pusherZ(0));
  assert.equal(r, 2);
  // Deux colis ne se chevauchent pas : le second s'arrête derrière le premier.
  const q = { x: 0, z: 0 }; sortStep(q, 1, pusherZ(0), 0.1); assert.equal(q.x, 0.1);
});

test('Pièce travaillée : faite en bout de course, remplacée à l’avance suivante, comptée', async () => {
  const { workStep } = await import('./machine.js');
  const w = { done: false, back: false, n: 0 }, seq = (tool, feed) => workStep(w, tool, feed, true);
  seq(0.5, 0.5); assert.equal(w.done, false);
  seq(1, 1); assert.equal(w.done, true, 'marquée en bout de course');
  seq(0.5, 0.5); assert.equal(w.done, true, 'elle reste marquée pendant la remontée');
  seq(0, 0); seq(0.08, 0.08); assert.equal(w.done, true, 'et tant que le poinçon ne redescend pas');
  seq(0.2, 0.2); assert.deepEqual([w.done, w.n], [false, 1], 'pièce neuve à la descente suivante');
  // Poste : percée (outil) pendant le serrage (avance) ; pièce neuve au serrage suivant.
  seq(0, 1); seq(1, 1); seq(0, 1); assert.equal(w.done, true); seq(0, 0); seq(0, 0.5); assert.deepEqual([w.done, w.n], [false, 2]);
  workStep(w, 1, 1, false); assert.deepEqual(w, { done: false, back: false, n: 0 }, 'simulation arrêtée : tout revient au départ');
});
