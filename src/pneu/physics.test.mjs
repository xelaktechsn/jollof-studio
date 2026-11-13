// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modèle physique de la pneumatique, comparé aux formules : node --test src/pneu/physics.test.mjs
// - débit bloqué ISO 6358 : q = C·p1·ρ0 ;
// - force d'un vérin : F = p·A (25 mm sous 6 bar : 294,5 N), contre une charge ;
// - réducteur de débit : la sortie ralentit quand on le ferme ;
// - distributeur 5/3 centre fermé : le vérin s'arrête en cours de course ;
// - pressostat : se ferme au seuil.
import test from 'node:test';
import assert from 'node:assert/strict';

const i18n = await import('../i18n/index.js');
await i18n.loadLanguage();
const { stepPhysical, flow, cylOf, P0 } = await import('./physics.js');
const { createState } = await import('./sim.js');

const E = (id, type, x, y, p = {}) => ({ id, type, x, y, p });
const T = (a, pa, b, pb) => ({ id: `${a}${pa}-${b}${pb}`, a: [a, pa], b: [b, pb] });
const run = (c, st, io, s) => { let r; for (let t = 0; t < s; t += 0.02) r = stepPhysical(c, st, io, 0.02); return r; };
/** Vérin double effet Ø 25 mm, course 100 mm, distributeur 5/2 Y1, réducteur d'échappement côté tige. */
const circuit = (o = {}) => ({
  model: 'physical',
  elements: [E('src', 'supply', 0, 20, { bar: 6 }), E('v', 'v52', 0, 10, { left: 'sol', right: 'spring', coilL: 'Y1' }), E('fc', 'flowctl', 20, 4, { open: o.open ?? 100 }),
    E('c', 'cyl2', 0, 0, { bore: 25, rod: 10, stroke: 100, mass: 1, load: o.load ?? 0, s0: 'B1', s1: 'B2' }), E('g', 'gauge', 30, 0), E('ps', 'pswitch', 34, 0, { sensor: 'S1', bar: 4 })],
  tubes: [T('src', '1', 'v', '1'), T('v', '4', 'c', '1'), T('v', '2', 'fc', '1'), T('fc', '2', 'c', '2'), T('c', '1', 'g', '1'), T('c', '1', 'ps', '1')]
});
/**
 * Temps (s) pour sortir la tige : le circuit est d'abord au repos 0,5 s (chambre côté tige sous pression, comme en
 * fonctionnement normal), puis la bobine est excitée. Infinity si la tige n'arrive pas en `limit` s.
 */
function extendTime(c, limit = 3) {
  const st = createState(); let on = false;
  const io = { coil: () => on, pushed: () => false };
  run(c, st, io, 0.5); on = true;
  for (let t = 0; t < limit; t += 0.01) { stepPhysical(c, st, io, 0.01); if (st.x.c >= 0.98) return t; }
  return Infinity;
}

test('Débit ISO 6358 : bloqué sous le rapport critique, nul sans écart de pression', () => {
  assert.ok(Math.abs(flow(1, 7e5, 1e5) - 1e-8 * 7e5 * 1.185) < 1e-9, 'débit sonique');
  assert.equal(flow(1, 5e5, 5e5), 0);
  assert.ok(flow(1, 7e5, 6e5) < flow(1, 7e5, 3e5), 'subsonique plus faible');
});

test('Force d’un vérin Ø 25 mm sous 6 bar : 294,5 N ; il pousse 250 N, pas 330 N', () => {
  const g = cylOf(E('c', 'cyl2', 0, 0, { bore: 25 }));
  assert.ok(Math.abs(6e5 * g.A - 294.5) < 0.5, `p·A = ${6e5 * g.A}`);
  assert.ok(extendTime(circuit({ load: 250 })) < 2, 'charge de 250 N poussée');
  const c = circuit({ load: 330 }), st = createState();
  run(c, st, { coil: () => true, pushed: () => false }, 1.5);
  assert.ok(st.x.c < 0.01, `bloqué par 330 N (x = ${st.x.c})`);
  assert.ok(Math.abs(st.bar['c:1'] - 6) < 0.15, `chambre arrière à la pression du réseau : ${st.bar['c:1']} bar`);
  assert.ok(Math.abs(st.F.c + 330 - 6e5 * g.A) < 25, `force calculée ${st.F.c} N (≈ 294,5 − 330)`);
});

test('Réducteur de débit : plus il est fermé, plus la sortie est lente ; manomètre et pressostat', () => {
  const fast = extendTime(circuit({ open: 100 })), slow = extendTime(circuit({ open: 15 }), 6);
  assert.ok(fast < 0.5, `sortie libre : ${fast.toFixed(3)} s`);
  assert.ok(slow > 2.5 * fast, `réducteur à 15 % : ${slow.toFixed(3)} s contre ${fast.toFixed(3)} s`);
  const c = circuit(), st = createState();
  const r = run(c, st, { coil: () => true, pushed: () => false }, 1);
  assert.ok(st.bar['g:1'] > 5.8, `manomètre ${st.bar['g:1']} bar`);
  assert.equal(r.sensors.get('S1'), true, 'pressostat fermé au-dessus de 4 bar');
  assert.equal(r.sensors.get('B2'), true);
});

test('5/3 centre fermé : la tige s’arrête en cours de course ; simple effet : le ressort la rentre', () => {
  const c = { model: 'physical', elements: [E('src', 'supply', 0, 20), E('v', 'v53', 0, 10, { left: 'sol', right: 'sol', coilL: 'Y1', coilR: 'Y2', center: 'closed' }), E('fc', 'flowctl', 20, 4, { open: 10 }), E('c', 'cyl2', 0, 0, { stroke: 100 })],
    tubes: [T('src', '1', 'v', '1'), T('v', '4', 'c', '1'), T('v', '2', 'fc', '1'), T('fc', '2', 'c', '2')] };
  const st = createState(); let y1 = true;
  const io = { coil: n => n === 'Y1' && y1, pushed: () => false };
  y1 = false; run(c, st, io, 0.5); y1 = true; // repos : côté tige sous pression
  for (let i = 0; i < 400 && (st.x.c || 0) < 0.4; i++) stepPhysical(c, st, io, 0.01);
  assert.ok(st.x.c > 0.3 && st.x.c < 0.9, `en cours de course : ${st.x.c}`);
  y1 = false; run(c, st, io, 0.3); const x1 = st.x.c; run(c, st, io, 1);
  assert.equal(st.pos.v, 0, 'centré par les ressorts');
  assert.ok(Math.abs(st.x.c - x1) < 0.02, `arrêtée : ${x1} puis ${st.x.c}`);
  const s = { model: 'physical', elements: [E('src', 'supply', 0, 20), E('v', 'v32', 0, 10, { act: 'push' }), E('k', 'cyl1', 0, 0, { stroke: 50 })], tubes: [T('src', '1', 'v', '1'), T('v', '2', 'k', '1')] };
  const ss = createState(); let push = true;
  const ios = { coil: () => false, pushed: () => push };
  run(s, ss, ios, 1); assert.ok(ss.x.k > 0.98, 'sorti');
  push = false; run(s, ss, ios, 2); assert.ok(ss.x.k < 0.02, `rentré par le ressort : ${ss.x.k}`);
  assert.ok(P0 > 1e5);
});
