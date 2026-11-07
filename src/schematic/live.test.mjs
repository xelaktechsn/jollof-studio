// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de la vue « Schéma » en direct : node --test src/schematic/live.test.mjs
// Disposition (fils, jonctions) sur les projets d'exemple et courants des fils calculés à partir du solveur.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BOARDS, boardOf } from '../sim/boards.js';
import { PARTS } from '../sim/parts.js';
import { INPUTS } from '../sim/models.js';
import { analyze, bbGroups } from '../sim/circuit.js';
import { solveDC } from '../sim/dc.js';
import { layoutSchematic, buildSchematic, drawSymbol, liveState, liveActive } from './sheet.js';
import { linkFlows, closedSwitches, voltRgb, track, pointAt } from './flows.js';

const EX = new URL('../../exemples/', import.meta.url);
const LEGS = { diode: ['A', 'K'], 'cap-100n': ['1', '2'], 'cap-100u': ['+', '-'], npn: ['C', 'B', 'E'], lm7805: ['IN', 'GND', 'OUT'], mb102: ['+5V', 'GND', '+3V3'], bat9v: ['+', '-'], bat18650: ['+', '-'] };
const keys = type => {
  const prof = BOARDS[type];
  if (prof) return [...Object.keys(prof.gpio), ...Object.keys(prof.power), 'GND', 'GND (2)', 'GND (3)', 'GND (4)', 'VIN'];
  if (/^breadboard/.test(type)) return bbGroups({ type }).flatMap(g => g.keys);
  if (/^res-/.test(type)) return ['1', '2'];
  if (LEGS[type]) return LEGS[type];
  const sp = PARTS[type];
  return sp && sp.pins ? sp.pins.map(p => p.pin) : [];
};
/** Projet d'exemple avec une géométrie simple mais déterministe (place sur le tapis, broches en rangées). */
function load(file) {
  const d = JSON.parse(fs.readFileSync(new URL(file, EX), 'utf8'));
  const comps = d.comps.map(c => {
    const ks = keys(c.type), board = !!BOARDS[c.type];
    const pins = Object.fromEntries(ks.map((k, i) => [k, { attach: { x: board ? (i % 2 ? 12 : -12) : i * 2.54, z: board ? Math.floor(i / 2) * 2.54 : 5 } }]));
    return { id: c.id, type: c.type, name: c.name || c.id, group: { position: { x: c.x, z: c.z } }, pins, inp: { ...(INPUTS[c.type] || {}), ...(c.inp || {}) } };
  });
  const by = Object.fromEntries(comps.map(c => [c.id, c]));
  const wires = d.wires.map(w => ({ a: { comp: by[w.a[0]], key: w.a[1] }, b: { comp: by[w.b[0]], key: w.b[1] }, progress: 1 }));
  return { comps, wires, by };
}
const FILES = fs.readdirSync(EX).filter(f => f.endsWith('.jollof')).sort();
const live = ({ comps, wires }) => layoutSchematic({ comps, wires, netNames: {}, describe: c => ({ title: c.type }), live: true });

test('linkFlows : chaîne et arbre, loi des nœuds respectée', () => {
  const net = {};
  // A → J → B : 5 mA sortent de A, entrent dans B.
  const l1 = { net, u: 'A', v: 'J' }, l2 = { net, u: 'J', v: 'B' };
  let f = linkFlows([l1, l2], new Map([['A', 5], ['B', -5]]));
  assert.equal(f.get(l1), 5); assert.equal(f.get(l2), 5);
  // Arbre : A (+5) se partage entre B (−3) et C (−2) à la jonction J.
  const l3 = { net, u: 'C', v: 'J' };
  f = linkFlows([l1, l2, l3], new Map([['A', 5], ['B', -3], ['C', -2]]));
  assert.equal(f.get(l1), 5); assert.equal(f.get(l2), 3); assert.equal(f.get(l3), -2);
  // Deux nœuds indépendants.
  const other = {}, l4 = { net: other, u: 'X', v: 'Y' };
  f = linkFlows([l1, l4], new Map([['A', 1], ['X', -2], ['Y', 2]]));
  assert.equal(f.get(l4), -2);
});

test('Couleurs et parcours des points', () => {
  assert.deepEqual(voltRgb(0), [91, 107, 122]);
  assert.deepEqual(voltRgb(5), [242, 201, 76]);
  assert.deepEqual(voltRgb(null), [91, 107, 122]);
  assert.deepEqual(voltRgb(-3), [155, 123, 224]);
  const t = track([[0, 0], [10, 0], [10, 5]]);
  assert.equal(t.len, 15);
  assert.deepEqual(pointAt(t, 12), [10, 2]);
  assert.deepEqual(pointAt(t, 0), [0, 0]);
});

for (const f of FILES) {
  test(`${f} : tous les nœuds de signal en fils, sans recouvrement ni contact en T`, () => {
    const L = live(load(f));
    const sig = L.nets.filter(n => n.kind === 'sig' && n.pins.length >= 2);
    assert.equal(sig.filter(n => !L.routed.has(n)).length, 0, 'nœuds sans fil : ' + sig.filter(n => !L.routed.has(n)).map(n => n.name));
    const H = (p, q) => Math.abs(p[1] - q[1]) < 1e-6, segs = pts => pts.slice(1).map((q, i) => [pts[i], q]);
    const onS = (pt, [p, q]) => (H(p, q) ? Math.abs(pt[1] - p[1]) < 1e-6 && pt[0] >= Math.min(p[0], q[0]) - 1e-6 && pt[0] <= Math.max(p[0], q[0]) + 1e-6 : Math.abs(pt[0] - p[0]) < 1e-6 && pt[1] >= Math.min(p[1], q[1]) - 1e-6 && pt[1] <= Math.max(p[1], q[1]) + 1e-6);
    const ovl = ([a, b], [c, d]) => H(a, b) === H(c, d) && (H(a, b)
      ? Math.abs(a[1] - c[1]) < 1e-6 && Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) > 0.05
      : Math.abs(a[0] - c[0]) < 1e-6 && Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) > 0.05);
    const bend = (w, i) => i === 0 || i === w.length - 1 || !((Math.abs(w[i - 1][0] - w[i][0]) < 1e-6 && Math.abs(w[i][0] - w[i + 1][0]) < 1e-6) || (Math.abs(w[i - 1][1] - w[i][1]) < 1e-6 && Math.abs(w[i][1] - w[i + 1][1]) < 1e-6));
    for (const a of L.links) for (const b of L.links) {
      if (a.net === b.net) continue;
      for (const s1 of segs(a.pts)) for (const s2 of segs(b.pts)) assert.ok(!ovl(s1, s2), `${a.net.name} longe ${b.net.name}`);
      a.pts.forEach((p, i) => { if (bend(a.pts, i)) for (const s2 of segs(b.pts)) assert.ok(!onS(p, s2), `${a.net.name} touche ${b.net.name} en ${p}`); });
    }
    // Chaque nœud relié est un arbre qui couvre toutes ses broches.
    for (const n of L.nets.filter(x => L.routed.has(x))) {
      const ls = L.links.filter(l => l.net === n), nodes = new Set(ls.flatMap(l => [l.u, l.v]));
      for (const p of n.pins) assert.ok(nodes.has(`${p.comp.id}|${p.key}`), `${n.name} : ${p.comp.name}.${p.key} sans fil`);
      assert.equal(ls.length, nodes.size - 1, `${n.name} n'est pas un arbre`);
    }
  });
}

test('Le schéma imprimé garde ses étiquettes : pas de jonction, nœuds de plus de deux broches non tracés', () => {
  for (const f of FILES) {
    const { comps, wires } = load(f);
    const r = buildSchematic({ comps, wires, netNames: {}, title: 't', format: 'auto', lists: false, describe: c => ({ title: c.type }) });
    assert.ok(!r.pages[0].ops.some(o => o.t === 'circle' && o.fill === '#000' && Math.abs(o.r - 0.55 * r.scale) < 1e-6), f);
    const L = layoutSchematic({ comps, wires, netNames: {}, describe: c => ({ title: c.type }), live: false });
    assert.equal(L.junctions.length, 0, f);
    assert.ok([...L.routed].every(n => n.pins.length === 2), f);
  }
});

test('Exemple 02, D7 HIGH : courant de la LED dans les fils, loi des nœuds à chaque broche et jonction', () => {
  const c = load('02-led-bouton-breadboard.jollof');
  const L = live(c);
  const ctx = { prof: boardOf, pinState: (cc, k) => (boardOf(cc) ? { D7: { mode: 1, d: 1, pwm: null }, D2: { mode: 2, d: 0, pwm: null } }[k] || null : null), sensorVolts: () => null };
  const s = solveDC(c.comps, analyze(c.comps, c.wires), ctx);
  const inj = s.injections(), fl = linkFlows(L.links, inj);
  const led = s.leds.get(c.by['led-red_1']).mA;
  assert.ok(led > 10, `LED ${led} mA`);
  // Le fil qui part de D7 porte le courant de la LED.
  const d7 = L.links.find(l => l.u === 'uno_1|D7' || l.v === 'uno_1|D7');
  assert.ok(d7, 'fil de D7');
  assert.ok(Math.abs(Math.abs(fl.get(d7)) - led) < 0.01, `fil D7 : ${fl.get(d7)} mA`);
  // Loi des nœuds : ce qu'une broche envoie repart par ses fils, et rien ne se perd aux jonctions.
  const sum = new Map();
  for (const l of L.links) { const x = fl.get(l) || 0; sum.set(l.u, (sum.get(l.u) || 0) + x); sum.set(l.v, (sum.get(l.v) || 0) - x); }
  for (const [node, out] of sum) assert.ok(Math.abs(out - (inj.get(node) || 0)) < 1e-3, `${node} : ${out} ≠ ${inj.get(node) || 0}`);
});

test('Symboles qui changent avec l’état : bouton appuyé, curseur, moteur ; le schéma imprimé reste au repos', () => {
  const c = load('02-led-bouton-breadboard.jollof'), btn = c.by.button_1 || c.comps.find(x => x.type === 'button');
  const L = live(c), print = () => JSON.stringify(buildSchematic({ comps: c.comps, wires: c.wires, netNames: {}, title: 't', format: 'A4', lists: false, describe: x => ({ title: x.type }) }).pages[0].ops.filter(o => o.t !== 'text'));
  btn.inp.pressed = false;
  const up = drawSymbol(L, btn, liveState(btn)), before = print();
  btn.inp.pressed = true;
  const st = liveState(btn), down = drawSymbol(L, btn, st);
  assert.deepEqual(st, { pressed: true });
  assert.ok(liveActive(st) && !liveActive({ pressed: false }));
  assert.notDeepEqual(down, up, 'symbole appuyé différent');
  assert.ok(down.some(o => o.act) && !up.some(o => o.act), 'contact fermé en couleur');
  // Contact fermé : un trait horizontal relie les deux contacts.
  const s = L.syms.get(btn);
  assert.ok(down.some(o => o.t === 'path' && o.pts.length === 2 && Math.abs(o.pts[0][1] - s.oy) < 1e-6 && Math.abs(o.pts[1][1] - s.oy) < 1e-6 && Math.abs(o.pts[1][0] - o.pts[0][0] - 4.8) < 1e-6));
  assert.equal(print(), before, 'schéma imprimé inchangé');
  btn.inp.pressed = false;
  // Potentiomètre : curseur et chemins du courant suivent la position.
  const m = load('06-moteur-vitesse.jollof'), pot = m.comps.find(x => x.type === 'pot'), Lm = live(m), sp = Lm.syms.get(pot);
  const w = pos => sp.spokesFor({ pos }).W.slice(-1)[0][0];
  assert.ok(w(0) < w(50) && w(50) < w(100), 'curseur de 1 vers 3');
  pot.inp.pos = 20; assert.deepEqual(liveState(pot), { pos: 20 });
  // Moteur : flèche de rotation seulement en marche, dans son sens.
  const mot = m.comps.find(x => x.type === 'dcmotor');
  mot.motorV = 0; assert.equal(drawSymbol(Lm, mot, liveState(mot)).some(o => o.act), false);
  mot.motorV = 0.8; const fwd = drawSymbol(Lm, mot, liveState(mot));
  mot.motorV = -0.8; const back = drawSymbol(Lm, mot, liveState(mot));
  assert.ok(fwd.some(o => o.act) && back.some(o => o.act));
  assert.notDeepEqual(fwd, back, 'sens de rotation');
  assert.equal(liveState({ type: 'res-220', inp: {} }), null);
});

test('Bouton appuyé en série (pile, bouton, 1 kΩ, LED) : le courant passe par le bouton dans le schéma', () => {
  const mk = (type, id, keys, inp = {}) => ({ id, type, name: id, group: { position: { x: 0, z: 0 } }, pins: Object.fromEntries(keys.map((k, i) => [k, { attach: { x: i * 2.54, z: 5 } }])), inp: { ...(INPUTS[type] || {}), ...inp } });
  const bat = mk('bat9v', 'B', ['+', '-']), btn = mk('button', 'S', ['1', '2'], { pressed: true }), r = mk('res-1k', 'R', ['1', '2']), led = mk('led-red', 'L', ['A', 'K']);
  bat.group.position.x = -40; btn.group.position.x = -10; r.group.position.x = 20; led.group.position.x = 50;
  const comps = [bat, btn, r, led], W = (a, ka, b, kb) => ({ a: { comp: a, key: ka }, b: { comp: b, key: kb }, progress: 1 });
  const wires = [W(bat, '+', btn, '1'), W(btn, '2', r, '1'), W(r, '2', led, 'A'), W(led, 'K', bat, '-')];
  const s = solveDC(comps, analyze(comps, wires), { prof: boardOf, pinState: () => null, sensorVolts: () => null });
  const led_mA = s.leds.get(led).mA;
  assert.ok(led_mA > 5, `LED ${led_mA} mA`);
  assert.equal(s.injections().get('S|1'), undefined, 'le solveur ne voit pas de courant propre au bouton');
  // Le schéma garde deux nœuds de part et d'autre du bouton, même appuyé.
  const L = layoutSchematic({ comps, wires, netNames: {}, describe: c => ({ title: c.type }), live: true });
  assert.ok(btn.inp.pressed, 'état du bouton rendu');
  const n1 = L.of({ comp: btn, key: '1' }), n2 = L.of({ comp: btn, key: '2' });
  assert.ok(n1 && n2 && n1 !== n2, 'deux nœuds');
  const inj = closedSwitches(L.nets, s.injections()), fl = linkFlows(L.links, inj);
  assert.ok(Math.abs(inj.get('S|1') + led_mA) < 1e-3, `entre par la patte 1 : ${inj.get('S|1')}`);
  assert.ok(Math.abs(inj.get('S|2') - led_mA) < 1e-3, `sort par la patte 2 : ${inj.get('S|2')}`);
  for (const l of L.links.filter(x => x.net === n1 || x.net === n2)) assert.ok(Math.abs(Math.abs(fl.get(l)) - led_mA) < 1e-3, `fil ${l.u}–${l.v} : ${fl.get(l)} mA`);
});

test('Relais collé : COM et NO restent deux nœuds sur le schéma, le courant du ventilateur passe par le contact', () => {
  const mk = (type, id, keys) => ({ id, type, name: id, group: { position: { x: 0, z: 0 } }, pins: Object.fromEntries(keys.map((k, i) => [k, { attach: { x: i * 2.54, z: 5 } }])), inp: { ...(INPUTS[type] || {}) } });
  const bat = mk('bat9v', 'B', ['+', '-']), k = mk('relay', 'K', ['VCC', 'GND', 'IN', 'COM', 'NO', 'NC']), f = mk('fan', 'F', ['+', '-']);
  bat.group.position.x = -40; k.group.position.x = 0; f.group.position.x = 50;
  const comps = [bat, k, f], W = (a, ka, b, kb) => ({ a: { comp: a, key: ka }, b: { comp: b, key: kb }, progress: 1 });
  const wires = [W(bat, '+', k, 'COM'), W(k, 'NO', f, '+'), W(f, '-', bat, '-')];
  k.relayOn = true;
  const s = solveDC(comps, analyze(comps, wires), { prof: boardOf, pinState: () => null, sensorVolts: () => null });
  const fan = s.across(f).mA;
  assert.ok(fan > 100, `ventilateur ${fan} mA`);
  const L = layoutSchematic({ comps, wires, netNames: {}, describe: c => ({ title: c.type }), live: true });
  const nCom = L.of({ comp: k, key: 'COM' }), nNo = L.of({ comp: k, key: 'NO' });
  assert.ok(nCom && nNo && nCom !== nNo, 'deux nœuds');
  const inj = closedSwitches(L.nets, s.injections()), fl = linkFlows(L.links, inj);
  for (const l of L.links.filter(x => x.net === nCom || x.net === nNo)) assert.ok(Math.abs(Math.abs(fl.get(l)) - fan) < 1e-3, `fil ${l.u}–${l.v} : ${fl.get(l)} mA`);
  // Au repos, NC fermé : le ventilateur (sur NO) s'arrête.
  k.relayOn = false;
  assert.ok(Math.abs(solveDC(comps, analyze(comps, wires), { prof: boardOf, pinState: () => null, sensorVolts: () => null }).across(f).mA) < 0.01);
});
