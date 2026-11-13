// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Règles → blocs : node --test src/prog/visual/fromRules.test.mjs
// Pour chaque jeu de règles, le programme des règles et celui des blocs convertis sont compilés puis
// exécutés avec les mêmes entrées (bouton, potentiomètre) : les sorties (LED, servo, haut-parleur)
// doivent être les mêmes à chaque instant observé.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const i18n = await import('../../i18n/index.js');
await i18n.loadLanguage();
const { BOARDS, pickPower } = await import('../../sim/boards.js');
const { PARTS, partOf } = await import('../../sim/parts.js');
const { analyze, inspect } = await import('../../sim/circuit.js');
const { compile } = await import('../lang.js');
const { createRuntime } = await import('../runtime.js');
const { generate, actItem } = await import('../rules.js');
const { generateVisual } = await import('./generator.js');
const { rulesToBlocks } = await import('./fromRules.js');
const { B } = await import('./types.js');

/* ---------- Montage : une carte, des composants reliés aux broches choisies ---------- */
function keysOf(c) {
  const prof = BOARDS[c.type];
  if (prof) return [...Object.keys(prof.gpio), ...Object.keys(prof.power), 'GND', 'GND (2)', 'GND (3)', 'VIN', 'EN', 'RST', 'AREF', 'IOREF', 'VSYS', 'VBUS', '3V3_EN', 'RUN'];
  const sp = PARTS[c.type]; return sp && sp.pins ? sp.pins.map(p => p.pin) : [];
}
function bench(type, parts) {
  const prof = BOARDS[type], list = [{ id: 'b', type, name: type.toUpperCase() }], wl = [];
  for (const [name, [t, io]] of Object.entries(parts)) {
    list.push({ id: name, type: t, name });
    for (const p of PARTS[t].pins) {
      if (io[p.pin]) wl.push([name, p.pin, 'b', io[p.pin]]);
      else if (p.kind === 'pwr') { const pw = pickPower(p.v, prof); if (pw) wl.push([name, p.pin, 'b', pw.name]); }
      else if (p.kind === 'gnd') wl.push([name, p.pin, 'b', 'GND']);
    }
  }
  const comps = list.map(c => ({ ...c, pins: Object.fromEntries(keysOf(c).map(k => [k, {}])), inp: {} }));
  const byId = Object.fromEntries(comps.map(c => [c.id, c]));
  const wires = wl.map(([a, ka, b, kb]) => ({ a: { comp: byId[a], key: ka }, b: { comp: byId[b], key: kb }, progress: 1 }));
  const A = analyze(comps, wires), cache = new Map();
  const insp = c => { if (!cache.has(c)) cache.set(c, inspect(c, A, partOf(c))); return cache.get(c); };
  return { comps, byId, board: byId.b, cx: { comps, A, inspect: insp } };
}
const PINS = {
  uno: { led: 'D7', led2: 'D6', btn: 'D2', pot: 'A0', servo: 'D9', spk: 'D8' },
  esp32: { led: 'D13', led2: 'D25', btn: 'D4', pot: 'D34', servo: 'D27', spk: 'D26' }
};
const kit = type => { const p = PINS[type]; return bench(type, { LED1: ['led-red', { A: p.led }], LED2: ['led-green', { A: p.led2 }], BTN1: ['button', { 1: p.btn }], POT1: ['pot', { W: p.pot }], SERVO1: ['servo', { SIG: p.servo }], HP1: ['speaker', { '+': p.spk }] }); };

/* ---------- Règles ---------- */
let k = 0;
const rule = (src, op, v, then, els = [], from) => ({ kind: 'rule', id: `r${++k}`, src, op, v, from: from || [0, 100], then, else: els });
const a = (m, comp, act, arg) => actItem(m.byId[comp], act, arg);
const btn = { comp: 'BTN1', sig: 'pressed' }, pot = { comp: 'POT1', sig: 'pos' };

/* ---------- Exécution comparée ---------- */
function run(m, type, code, inputs) {
  const c = compile(code, { board: type });
  assert.ok(c.ok, `ne compile pas : ${JSON.stringify(c.errors)}\n${code}`);
  const P = PINS[type], prof = BOARDS[type];
  const read = key => {
    if (key === P.btn) return inputs.btn ? { d: 0, v: 0 } : null; // bouton vers GND, tirage interne
    if (key === P.pot) return { d: inputs.pot > 0.5 ? 1 : 0, v: inputs.pot * prof.logic };
    return null;
  };
  return createRuntime(c.js, { kind: type, label: type, prof, read, echo: () => null, onPin: () => null, bus: () => [], data: () => null });
}
const outs = (rt, type) => Object.fromEntries(['led', 'led2', 'servo', 'spk'].map(n => { const p = rt.pins.get(PINS[type][n]) || {}; return [n, { d: p.d || 0, pwm: p.pwm != null ? Math.round(p.pwm * 255) : null, servo: p.servo ?? null, freq: p.freq || 0 }]; }));
/** Mêmes entrées, mêmes instants : mêmes sorties. Les instants évitent les bascules des clignotements (multiples de 300 ms). */
function same(m, type, rules, states, scenarios) {
  const cx = { ...m.cx, rules, states };
  const ruleCode = generate(m.board, cx);
  const conv = rulesToBlocks(m.board, cx);
  const vis = generateVisual(m.board, conv.workspace, m.cx);
  assert.deepEqual(vis.warnings, [], `avertissements des blocs : ${JSON.stringify(vis.warnings)}\n${vis.code}`);
  for (const inputs of scenarios) {
    const r1 = run(m, type, ruleCode, inputs), r2 = run(m, type, vis.code, inputs);
    for (const t of [150, 450, 750]) {
      for (const r of [r1, r2]) while (r.clock() < t) r.run(Math.min(20, t - r.clock()));
      assert.deepEqual(outs(r2, type), outs(r1, type), `${type} ${JSON.stringify(inputs)} à ${t} ms\n--- règles ---\n${ruleCode}\n--- blocs ---\n${vis.code}`);
    }
  }
  return { conv, vis, ruleCode };
}
const BTN = [{ btn: false, pot: 0.2 }, { btn: true, pot: 0.2 }, { btn: false, pot: 0.8 }, { btn: true, pot: 0.8 }];
const POT = [0.05, 0.3, 0.5, 0.7, 0.95].map(pot => ({ btn: false, pot }));

for (const type of ['uno', 'esp32']) {
  const max = type === 'esp32' ? 4095 : 1023;

  test(`bouton → LED, si / sinon (${type})`, () => {
    const m = kit(type);
    const { conv } = same(m, type, [rule(btn, '==', 1, [a(m, 'LED1', 'on')], [a(m, 'LED1', 'off')])], {}, BTN);
    const loop = conv.workspace.blocks.blocks[1].inputs.DO.block;
    assert.equal(loop.type, 'controls_if'); assert.deepEqual(loop.extraState, { hasElse: true });
    assert.match(loop.icons.comment.text, /^Rule 1|^Règle 1/, 'la phrase de la règle en commentaire');
    assert.equal(loop.inputs.IF0.block.type, B.SIG_BOOL);
  });

  test(`seuils enchaînés : si / sinon si / sinon, clignotement (${type})`, () => {
    const m = kit(type);
    const rules = [rule(pot, '>', Math.round(max * 0.8), [a(m, 'LED1', 'on'), a(m, 'LED2', 'off')],
      [rule(pot, '>', Math.round(max * 0.4), [a(m, 'LED2', 'blink', 300), a(m, 'LED1', 'off')], [a(m, 'LED1', 'off'), a(m, 'LED2', 'off')])])];
    const { conv } = same(m, type, rules, {}, POT);
    assert.deepEqual(conv.workspace.blocks.blocks[1].inputs.DO.block.extraState, { elseIfCount: 1, hasElse: true });
  });

  test(`fait varier : potentiomètre → servo, haut-parleur, LED (${type})`, () => {
    const m = kit(type);
    const rules = [rule(pot, 'follow', 0, [a(m, 'SERVO1', 'follow', [0, 180]), a(m, 'HP1', 'follow', [200, 2000]), a(m, 'LED2', 'follow', [0, 255])], [], [0, max])];
    const { vis } = same(m, type, rules, {}, POT);
    // Le potentiomètre, utilisé trois fois, n'est lu qu'une fois par tour.
    assert.ok(/int pot1_position = analogRead\(POT1\);/.test(vis.code) && /map\(constrain\(pot1_position, 0, \d+\), 0, \d+, 0, 180\)/.test(vis.code), vis.code);
    assert.equal(vis.code.split('analogRead(POT1)').length - 1, 2, 'une lecture par tour, une pour le moniteur série');
  });

  test(`règle imbriquée et règle sans mesure (${type})`, () => {
    const m = kit(type);
    const rules = [
      rule(btn, '==', 1, [rule(pot, '>=', Math.round(max / 2), [a(m, 'LED1', 'on')], [a(m, 'LED1', 'off')])], [a(m, 'LED1', 'off')]),
      rule(null, '>', 0, [a(m, 'LED2', 'blink', 300)])
    ];
    same(m, type, rules, {}, BTN);
  });

  test(`état par défaut quand aucune règle ne commande (${type})`, () => {
    const m = kit(type);
    const rules = [rule(btn, '==', 1, [a(m, 'LED2', 'off'), a(m, 'SERVO1', 'angle', 30)])];
    const states = { LED2: { act: 'on', mode: 'always' }, SERVO1: { act: 'angle', arg: 150, mode: 'start' } };
    const { conv } = same(m, type, rules, states, BTN);
    assert.equal(conv.workspace.variables.length, 1, 'une variable « LED2 commandé »');
    assert.equal(conv.stats.states, 2);
  });

  test(`sans règle : mesures sur le moniteur série (${type})`, () => {
    const m = kit(type), cx = { ...m.cx, rules: [], states: {} };
    const conv = rulesToBlocks(m.board, cx), vis = generateVisual(m.board, conv.workspace, m.cx);
    assert.deepEqual(vis.warnings, []);
    const rt = run(m, type, vis.code, { btn: true, pot: 0.5 });
    for (let t = 0; t < 1100; t += 50) rt.run(50);
    assert.match(rt.takeSerial(), /BTN1 .*: 1.*\|.*POT1 .*: \d+/, 'les mesures, une ligne par seconde');
  });
}
