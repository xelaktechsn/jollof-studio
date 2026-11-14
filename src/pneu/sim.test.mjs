// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Simulation pneumatique tout ou rien : node --test src/pneu/sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const i18n = await import('../i18n/index.js');
await i18n.loadLanguage();
const { step, createState } = await import('./sim.js');

const E = (id, type, x, y, p = {}) => ({ id, type, x, y, p });
const T = (a, pa, b, pb) => ({ id: `${a}${pa}-${b}${pb}`, a: [a, pa], b: [b, pb] });
/** Fait tourner la simulation pendant `s` secondes (pas de 20 ms). */
function run(c, st, io, s) { let r; for (let t = 0; t < s; t += 0.02) r = step(c, st, io, 0.02); return r; }

/** Vérin double effet, distributeur 5/2 monostable à électroaimant Y1, réducteur de débit à l'échappement de B. */
const circuit = (open = 100) => ({
  elements: [E('src', 'supply', 0, 20), E('v', 'v52', 0, 10, { left: 'sol', right: 'spring', coilL: 'Y1' }), E('fc', 'flowctl', 20, 4, { open }), E('c', 'cyl2', 0, 0, { time: 1, s0: 'B1', s1: 'B2' })],
  tubes: [T('src', '1', 'v', '1'), T('v', '4', 'c', '1'), T('v', '2', 'fc', '1'), T('fc', '2', 'c', '2')]
});

test('5/2 monostable : au repos le vérin reste rentré (B1), bobine excitée il sort en une seconde (B2), puis rentre', () => {
  const c = circuit(), st = createState();
  let coil = false;
  const io = { coil: n => n === 'Y1' && coil, pushed: () => false };
  let r = run(c, st, io, 0.5);
  assert.equal(st.x.c, 0); assert.equal(r.sensors.get('B1'), true); assert.equal(r.sensors.get('B2'), false);
  assert.equal(st.press['c:2'], 'P', 'chambre avant sous pression au repos');
  coil = true;
  r = run(c, st, io, 0.5);
  assert.ok(st.x.c > 0.4 && st.x.c < 0.6, `mi-course après 0,5 s : ${st.x.c}`);
  r = run(c, st, io, 0.6);
  assert.equal(st.x.c, 1); assert.equal(r.sensors.get('B2'), true); assert.equal(r.sensors.get('B1'), false);
  coil = false;
  r = run(c, st, io, 1.1);
  assert.equal(st.x.c, 0); assert.equal(r.sensors.get('B1'), true);
  assert.deepEqual(r.leaks, []);
});

test('Réducteur de débit à l’échappement : la sortie est ralentie, la rentrée reste libre', () => {
  const c = circuit(25), st = createState();
  let coil = true;
  const io = { coil: () => coil, pushed: () => false };
  run(c, st, io, 2);
  assert.ok(st.x.c > 0.45 && st.x.c < 0.55, `sortie à un quart de la vitesse : ${st.x.c} après 2 s`);
  run(c, st, io, 2.2); assert.equal(st.x.c, 1);
  coil = false;
  run(c, st, io, 1.05); assert.equal(st.x.c, 0, 'rentrée à pleine vitesse (clapet antiretour)');
});

test('Bistable : une impulsion suffit, le distributeur garde sa position ; OU, ET, fuite d’un orifice libre', () => {
  const c = {
    elements: [E('s', 'supply', 0, 20), E('v', 'v52', 0, 10, { left: 'sol', right: 'sol', coilL: 'Y1', coilR: 'Y2' }), E('k', 'cyl2', 0, 0, { time: 0.5 })],
    tubes: [T('s', '1', 'v', '1'), T('v', '4', 'k', '1'), T('v', '2', 'k', '2')]
  };
  const st = createState(); let y1 = true, y2 = false;
  const io = { coil: n => (n === 'Y1' ? y1 : n === 'Y2' ? y2 : false), pushed: () => false };
  run(c, st, io, 0.1); y1 = false; run(c, st, io, 0.6);
  assert.equal(st.pos.v, 1); assert.equal(st.x.k, 1, 'sorti et maintenu sans bobine');
  y2 = true; run(c, st, io, 0.6); assert.equal(st.pos.v, 0); assert.equal(st.x.k, 0);
  // Simple effet commandé par deux boutons à travers un sélecteur (OU), puis un clapet de double pression (ET).
  for (const [gate, both, one] of [['shuttle', 1, 1], ['twopress', 1, 0]]) {
    const g = {
      elements: [E('s', 'supply', 0, 30), E('a', 'v32', 0, 20, { act: 'push' }), E('b', 'v32', 20, 20, { act: 'push' }), E('o', gate, 10, 10), E('k', 'cyl1', 0, 0, { time: 0.5 })],
      tubes: [T('s', '1', 'a', '1'), T('s', '1', 'b', '1'), T('a', '2', 'o', '1'), T('b', '2', 'o', '3'), T('o', '2', 'k', '1')]
    };
    const sg = createState(); let pa = false, pb = false;
    const iog = { coil: () => false, pushed: id => (id === 'a' ? pa : id === 'b' ? pb : false) };
    pa = true; run(g, sg, iog, 0.6); assert.equal(sg.x.k, one, `${gate} : un seul bouton`);
    pb = true; run(g, sg, iog, 0.6); assert.equal(sg.x.k, both, `${gate} : deux boutons`);
    pa = pb = false; run(g, sg, iog, 0.6); assert.equal(sg.x.k, 0, `${gate} : relâchés, le ressort rentre la tige`);
  }
  // Orifice 4 laissé libre : sous pression, il fuit.
  const f = { elements: [E('s', 'supply', 0, 20), E('v', 'v52', 0, 10, { left: 'push', right: 'spring' })], tubes: [T('s', '1', 'v', '1')] };
  const sf = createState(), r = run(f, sf, { coil: () => false, pushed: () => true }, 0.1);
  assert.deepEqual(r.leaks, [{ el: 'v', port: '4' }]);
});

test('Vérification : source, alimentation, repères du montage ; nettoyage d’un circuit reçu', async () => {
  const { checkPneu } = await import('./check.js');
  const { clean } = await import('./clean.js');
  const c = circuit();
  assert.deepEqual(checkPneu(c, { coils: ['Y1'], sensors: ['B1', 'B2'] }), [], 'circuit complet');
  const txt = r => r.map(i => i.text).join(' | ');
  let r = checkPneu(c, { coils: [], sensors: ['B1'] });
  assert.match(txt(r), /aucune électrovanne Y1/); assert.match(txt(r), /aucun capteur de vérin B2/);
  r = checkPneu({ elements: [E('v', 'v52', 0, 0, { left: 'sol', right: 'spring', coilL: '' })], tubes: [] }, { coils: [], sensors: [] });
  assert.match(txt(r), /Aucune source/); assert.match(txt(r), /orifice 1/); assert.match(txt(r), /repère d’une électrovanne/);
  r = checkPneu({ elements: [E('s', 'supply', 0, 9), E('k', 'cyl2', 0, 0, { s0: 'B1', s1: 'B1' })], tubes: [] }, { coils: [], sensors: ['B1'] });
  assert.match(txt(r), /même capteur B1/);
  {
    const d = clean({ elements: [{ id: 'a', type: 'v52', x: 1.4, y: '2', p: { coilL: 'y1<script>', evil: 1 } }, { id: 'b', type: 'nope', x: 0, y: 0 }], tubes: [{ id: 't', a: ['a', '1'], b: ['zz', '1'] }] });
    assert.deepEqual(d, { elements: [{ id: 'a', type: 'v52', x: 1, y: 2, p: { coilL: 'Y1SCRIPT' } }], tubes: [] });
  }
});

test('Exemples de la pneumatique : sans problème et conformes à leur description', async () => {
  const { PNEU_EXAMPLES } = await import('./examples.js');
  const { checkPneu } = await import('./check.js');
  const { stepPhysical } = await import('./physics.js');
  const go = (c, pushed, s, st = createState()) => { const io = { coil: () => false, pushed: id => pushed.includes(id) }; for (let t = 0; t < s; t += 0.02) (c.model === 'physical' ? stepPhysical : step)(c, st, io, 0.02); return st; };
  for (const ex of PNEU_EXAMPLES) assert.deepEqual(checkPneu(ex.circuit(), { coils: [], sensors: [] }), [], ex.id);
  const by = id => PNEU_EXAMPLES.find(x => x.id === id).circuit();
  assert.equal(go(by('direct'), ['v1'], 1.2).x.c1, 1);
  assert.equal(go(by('indirect'), ['s1'], 1.2).x.c1, 1);
  assert.equal(go(by('twohands'), ['a'], 1.2).x.c1, 0, 'une seule main : rien');
  assert.equal(go(by('twohands'), ['a', 'b'], 1.2).x.c1, 1, 'deux mains : la tige sort');
  assert.equal(go(by('or'), ['b'], 1.2).x.c1, 1);
  const sp = go(by('speed'), ['v1'], 2); assert.ok(sp.x.c1 > 0.4 && sp.x.c1 < 0.6, `sortie freinée : ${sp.x.c1}`);
  const m = go(by('midstop'), ['v1'], 1.5); const x1 = m.x.c1; go(by('midstop'), [], 1, m);
  assert.ok(x1 > 0.3 && x1 < 0.7 && Math.abs(m.x.c1 - x1) < 1e-9, `arrêt en cours de course : ${x1}`);
  assert.ok(go(by('force'), ['v1'], 2).x.c1 > 0.98, '300 N : la tige sort');
  const heavy = by('force'); heavy.elements.find(e => e.id === 'c1').p.load = 500;
  assert.ok(go(heavy, ['v1'], 2).x.c1 < 0.01, '500 N : bloquée');
});

test('Temporisateur 3/2 NF : le vérin sort seulement après le retard de pilotage, et le retard repart de zéro', () => {
  // Bouton (3/2 NF) → pilotage 12 du temporisateur (2 s) → vérin simple effet.
  const c = {
    elements: [E('src', 'supply', 0, 20), E('b', 'v32', 0, 10, { act: 'push', normal: 'nc' }), E('t', 'v32', 20, 10, { act: 'tempo', normal: 'nc', delay: 2 }), E('c', 'cyl1', 20, 0, { time: 0.2, s1: 'A1' })],
    tubes: [T('src', '1', 'b', '1'), T('src', '1', 't', '1'), T('b', '2', 't', '12'), T('t', '2', 'c', '1')]
  };
  const st = createState();
  let push = false;
  const io = { coil: () => false, pushed: id => push && id === 'b' };
  run(c, st, io, 0.3);
  assert.equal(st.x.c, 0);
  push = true;
  run(c, st, io, 1.5);
  assert.equal(st.pos.t || 0, 0, 'pas encore basculé à 1,5 s'); assert.equal(st.x.c, 0);
  assert.ok(st.tm.t > 1.3 && st.tm.t < 1.6, `temps écoulé : ${st.tm.t}`);
  push = false; run(c, st, io, 0.1);
  assert.equal(st.tm.t, 0, 'pilotage relâché : le retard repart de zéro');
  push = true;
  const r = run(c, st, io, 2.5);
  assert.equal(st.pos.t, 1); assert.equal(st.x.c, 1); assert.equal(r.sensors.get('A1'), true);
});
