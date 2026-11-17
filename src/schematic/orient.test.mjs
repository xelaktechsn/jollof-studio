// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de l'orientation des symboles du schéma (quarts de tour, miroir) : node --test src/schematic/orient.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BOARDS } from '../sim/boards.js';
import { PARTS } from '../sim/parts.js';
import { INPUTS } from '../sim/models.js';
import { bbGroups } from '../sim/circuit.js';
import { layoutSchematic, buildSchematic, drawSymbol, schOrient, turnSymbol } from './sheet.js';

const G = 2.54, DIR = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };
const EX = new URL('../../exemples/', import.meta.url);
const LEGS = { npn: ['C', 'B', 'E'] };
const keys = type => {
  const prof = BOARDS[type];
  if (prof) return [...Object.keys(prof.gpio), ...Object.keys(prof.power), 'GND', 'GND (2)', 'GND (3)', 'GND (4)', 'VIN'];
  if (/^breadboard/.test(type)) return bbGroups({ type }).flatMap(g => g.keys);
  if (/^res-/.test(type)) return ['1', '2'];
  if (LEGS[type]) return LEGS[type];
  const sp = PARTS[type];
  return sp && sp.pins ? sp.pins.map(p => p.pin) : [];
};
const comp = (id, type, { x = 0, z = 0, ry = 0, inp = {} } = {}) => {
  const ks = keys(type), board = !!BOARDS[type];
  const pins = Object.fromEntries(ks.map((k, i) => [k, { attach: { x: board ? (i % 2 ? 12 : -12) : i * 2.54, z: board ? Math.floor(i / 2) * 2.54 : 5 } }]));
  return { id, type, name: id.toUpperCase(), group: { position: { x, z }, rotation: { y: ry } }, pins, inp: { ...(INPUTS[type] || {}), ...inp } };
};
function load(file, over = {}) {
  const d = JSON.parse(fs.readFileSync(new URL(file, EX), 'utf8'));
  const comps = d.comps.map(c => { const k = comp(c.id, c.type, { x: c.x, z: c.z, ry: c.r || 0, inp: { ...(c.inp || {}), ...(over[c.id] || {}) } }); k.name = c.name || c.id; return k; });
  const by = Object.fromEntries(comps.map(c => [c.id, c]));
  const wires = d.wires.map(w => ({ a: { comp: by[w.a[0]], key: w.a[1] }, b: { comp: by[w.b[0]], key: w.b[1] }, progress: 1 }));
  return { comps, wires, by };
}
const lay = (comps, wires = [], live = true) => layoutSchematic({ comps, wires, netNames: {}, describe: c => ({ title: c.type }), live });
/** Broche relative au centre du corps du symbole (le symbole pivote autour de ce centre, à la grille près). */
const pinsOf = (L, c) => { const s = L.syms.get(c); return Object.fromEntries(Object.entries(s.pins).map(([k, p]) => [k, { x: p.x, y: p.y, dir: p.dir }])); };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg} : ${a} ≠ ${b}`);
const samePin = (p, x, y, dir, msg) => { near(p.x, x, `${msg} x`); near(p.y, y, `${msg} y`); assert.equal(p.dir, dir, `${msg} dir`); };

test('Résistance : quarts de tour et miroir, broches sur la grille', () => {
  const at = rot => { const c = comp('r1', 'res-220', { inp: rot == null ? {} : { schRot: rot } }); return pinsOf(lay([c]), c); };
  let p = at(null); samePin(p['1'], -2 * G, 0, 'l', '0°'); samePin(p['2'], 2 * G, 0, 'r', '0°');
  p = at(90); samePin(p['1'], 0, -2 * G, 'u', '90°'); samePin(p['2'], 0, 2 * G, 'd', '90°');
  p = at(180); samePin(p['1'], 2 * G, 0, 'r', '180°'); samePin(p['2'], -2 * G, 0, 'l', '180°');
  p = at(270); samePin(p['1'], 0, 2 * G, 'd', '270°'); samePin(p['2'], 0, -2 * G, 'u', '270°');
  const m = comp('r1', 'res-220', { inp: { schRot: 0, schMir: true } }), pm = pinsOf(lay([m]), m);
  samePin(pm['1'], 2 * G, 0, 'r', 'miroir'); samePin(pm['2'], -2 * G, 0, 'l', 'miroir');
});

test('Transistor NPN pivoté de 90° : B en haut, C à droite, E à gauche ; corps et chemins du courant suivent', () => {
  const c = comp('q1', 'npn', { inp: { schRot: 90 } }), L = lay([c]), s = L.syms.get(c), p = pinsOf(L, c);
  samePin(p.B, 0, -2 * G, 'u', 'B'); samePin(p.C, 2 * G, G, 'r', 'C'); samePin(p.E, -2 * G, G, 'l', 'E');
  // Corps d'origine [-2,2, -3,4, 4,6, 3,4] tourné : [-3,4, -2,2, 3,4, 4,6].
  [-3.4, -2.2, 3.4, 4.6].forEach((v, i) => near(s.body[i], v, `corps ${i}`));
  // Chaque chemin du courant part du bout de sa broche.
  for (const k of ['B', 'C', 'E']) { near(s.spokes[k][0][0], p[k].x, `spoke ${k}`); near(s.spokes[k][0][1], p[k].y, `spoke ${k}`); }
  for (const k of ['B', 'C', 'E']) assert.ok(Math.abs(p[k].x / G - Math.round(p[k].x / G)) < 1e-9 && Math.abs(p[k].y / G - Math.round(p[k].y / G)) < 1e-9, `${k} sur la grille`);
  // Textes à l'endroit : repère et valeur horizontaux, sous le corps (côté sans broche), dans la boîte du symbole.
  const ops = drawSymbol(L, c), texts = ops.filter(o => o.t === 'text');
  assert.ok(texts.length >= 2 && texts.every(o => o.rot === 0), 'textes horizontaux');
  const ref = texts.find(o => o.str === 'Q1');
  assert.ok(ref && ref.y - s.oy > s.body[3], 'repère sous le corps');
  assert.ok(ref.y - s.oy <= s.box[3] + 1e-9 && s.box[3] > s.body[3], 'boîte agrandie pour les textes');
});

test('Sans réglage, un composant tourné sur le tapis l’est aussi sur le schéma ; une carte garde sa disposition', () => {
  const r = comp('r1', 'res-220', { ry: -Math.PI / 2 }); // 90° dans l'inspecteur
  assert.deepEqual(schOrient(r), { rot: 90, mir: false });
  samePin(pinsOf(lay([r]), r)['1'], 0, -2 * G, 'u', 'résistance tournée');
  assert.equal(schOrient(comp('r2', 'res-220', { ry: Math.PI / 2 })).rot, 270);
  assert.equal(schOrient(comp('r4', 'res-220', { ry: 3 * Math.PI / 2 + 0.01 })).rot, 90, 'au quart de tour près');
  assert.equal(schOrient(comp('r3', 'res-220', { ry: Math.PI / 2, inp: { schRot: 0 } })).rot, 0, 'réglage du schéma prioritaire');
  const u = comp('u1', 'uno', { ry: Math.PI / 2 }), L = lay([u]);
  assert.equal(L.syms.get(u).rot, 0, 'bloc droit');
  assert.ok(Object.values(L.syms.get(u).pins).every(p => p.dir === 'l' || p.dir === 'r'));
});

test('turnSymbol : quart de tour horaire, miroir à l’écran', () => {
  const c = comp('r1', 'res-220');
  assert.deepEqual(turnSymbol(c, { rot: 0, mir: false }), { rot: 90, mir: false });
  assert.equal(c.inp.schRot, 90);
  assert.deepEqual(turnSymbol(c, { rot: 270, mir: false }), { rot: 0, mir: false });
  // Retourner à l'écran un symbole tourné de 90° : rotation opposée + miroir propre.
  assert.deepEqual(turnSymbol(c, { rot: 90, mir: false }, true), { rot: 270, mir: true });
  assert.equal(c.inp.schMir, true);
  turnSymbol(c, { rot: 270, mir: true }, true);
  assert.equal(c.inp.schRot, 90); assert.ok(!('schMir' in c.inp));
});

test('Exemple 02, symboles pivotés : tous les nœuds tracés, fils qui quittent chaque broche dans son prolongement', () => {
  const over = { 'res-220_1': { schRot: 90 }, 'led-red_1': { schRot: 270 }, button_1: { schRot: 180, schMir: true } };
  const c = load('02-led-bouton-breadboard.jollof', over);
  for (const live of [true, false]) {
    const L = lay(c.comps, c.wires, live);
    assert.equal(L.syms.get(c.by['res-220_1']).rot, 90);
    const sig = L.nets.filter(n => n.kind === 'sig' && n.pins.length === 2);
    assert.ok(sig.length >= 3);
    assert.equal(sig.filter(n => !L.routed.has(n)).length, 0, `${live ? 'direct' : 'imprimé'} : nœuds sans fil`);
    for (const l of L.links) for (const [end, next] of [[l.pts[0], l.pts[1]], [l.pts[l.pts.length - 1], l.pts[l.pts.length - 2]]]) {
      const pin = l.net.pins.find(p => { const q = L.abs(p.comp, p.key); return Math.abs(q.x - end[0]) < 1e-6 && Math.abs(q.y - end[1]) < 1e-6; });
      if (!pin) continue; // jonction
      const q = L.abs(pin.comp, pin.key), [dx, dy] = DIR[q.dir];
      const ux = Math.sign(Math.round((next[0] - end[0]) * 1e6)), uy = Math.sign(Math.round((next[1] - end[1]) * 1e6));
      assert.deepEqual([ux, uy], [dx, dy], `${pin.comp.name}.${pin.key} : le fil part dans le prolongement de la broche`);
    }
  }
  // La breadboard n'est pas dessinée : ses rangées sont des liaisons (cathode de la LED et bouton à la masse de la carte).
  const L = lay(c.comps, c.wires, false);
  assert.ok(!L.syms.has(c.by.breadboard_1));
  const k = L.of({ comp: c.by['led-red_1'], key: 'K' });
  assert.ok(k && k.kind === 'gnd' && k === L.of({ comp: c.by.uno_1, key: 'GND (2)' }) && k === L.of({ comp: c.by.button_1, key: '2' }));
  // Schéma imprimé : tous les textes lisibles (horizontaux ou de bas en haut).
  const r = buildSchematic({ comps: c.comps, wires: c.wires, netNames: {}, title: 't', format: 'auto', lists: false, describe: x => ({ title: x.type }) });
  assert.ok(r.pages[0].ops.filter(o => o.t === 'text').every(o => o.rot === 0 || o.rot === -90));
  assert.ok(r.pages[0].ops.some(o => o.t === 'text' && o.str === 'R1'));
});
