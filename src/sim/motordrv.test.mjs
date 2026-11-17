// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pilotes de moteurs (sim/motordrv.js) : ponts en H L293D et TB6612FNG dans le calcul du circuit (sens, vitesse, frein,
// veille), pilotes pas à pas A4988 et DRV8825 (comptage des pas, microrésolution, sens, décrochage, raccordement des
// bobines), AccelStepper du simulateur intégré, OE du 74HC595 en PWM, vérificateur.
// node --test src/sim/motordrv.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARDS, boardOf } from './boards.js';
import { PARTS } from './parts.js';
import { INPUTS } from './models.js';
import { analyze, inspect } from './circuit.js';
import { solveDC } from './dc.js';
import { chipState, netLevel } from './chips.js';
import { stepEdge, stepState, stepperLink, driverInputs, bridgeOut, HBRIDGES, PULL_IN } from './motordrv.js';
import { driveOf } from './drive.js';
import { driveActuators } from './actuators.js';
import { compile } from '../prog/lang.js';
import { generate, actItem } from '../prog/rules.js';
import { createRuntime } from '../prog/runtime.js';
import { loadProject } from '../check/load.js';
import { checkProject } from '../check/check.js';

/* ---------- Montage fait à la main ---------- */
const keys = t => (BOARDS[t] ? [...Object.keys(BOARDS[t].gpio), ...Object.keys(BOARDS[t].power), 'GND'] : /^res-/.test(t) ? ['1', '2'] : PARTS[t] && PARTS[t].pins ? PARTS[t].pins.map(p => p.pin) : ['+', '-']);
function bench() {
  const comps = [], wires = [];
  const b = {
    comps, wires,
    add(type, inp = {}) { b.memo = null; const c = { id: type + '_' + comps.length, type, name: type.toUpperCase() + comps.length, pins: Object.fromEntries(keys(type).map(k => [k, {}])), inp: { ...(INPUTS[type] || {}), ...inp } }; comps.push(c); return c; },
    wire(a, ka, c, kc) { b.memo = null; wires.push({ a: { comp: a, key: ka }, b: { comp: c, key: kc }, progress: 1 }); },
    memo: null,
    A: () => b.memo || (b.memo = analyze(comps, wires)), // gardée tant que le montage ne change pas
    solve(pins) { return solveDC(comps, b.A(), { prof: boardOf, pinState: (c, k) => (boardOf(c) ? (pins[k] || null) : null), sensorVolts: () => null }); },
    hw(kind, u) {
      let rt = null;
      const gpio = g => { const p = rt && g.comp === u && rt.pins.get(g.key); return p && p.mode === 1 ? (p.d ? 1 : 0) : null; };
      const at = k => { const A = b.A(), out = []; for (const m of A.members({ comp: u, key: k })) if (m.comp !== u) out.push({ comp: m.comp, pin: m.key }); return out; };
      return {
        kind, label: kind, prof: BOARDS[kind], read: () => null, echo: () => null, onPin: () => null, at,
        bus: () => [], i2c: () => [], status: () => ({ ok: true, msg: '' }), data: () => null,
        node: (c, k) => netLevel(b.A(), { comp: c, key: k }, gpio),
        set rt(r) { rt = r; }
      };
    }
  };
  return b;
}
const OUT = (d = 1) => ({ mode: 1, d, pwm: null, freq: 0 });
const PWM = v => ({ mode: 1, d: v > 0 ? 1 : 0, pwm: v, freq: 0 });
function run(src, hw, ms) {
  const c = compile(src, { board: hw.kind });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  hw.rt = rt;
  for (let t = 0; t < ms; t += 16) rt.run(16);
  assert.notEqual(rt.state, 'error', rt.error && rt.error.msg);
  return rt;
}

/* ---------- Ponts en H ---------- */
function l293d() {
  const b = bench(), u = b.add('uno'), d = b.add('l293d'), m = b.add('dcmotor'), p = b.add('bat9v');
  b.wire(d, 'VCC1', u, '5V'); b.wire(d, 'GND', u, 'GND'); b.wire(d, 'VCC2', p, '+'); b.wire(p, '-', u, 'GND');
  b.wire(d, 'EN12', u, 'D5'); b.wire(d, 'IN1', u, 'D7'); b.wire(d, 'IN2', u, 'D8');
  b.wire(d, 'OUT1', m, 'M+'); b.wire(d, 'OUT2', m, 'M-');
  return { b, u, d, m };
}
test('L293D : sens selon IN1/IN2, vitesse selon EN, chute des étages bipolaires', () => {
  const { b, m } = l293d();
  const fwd = b.solve({ D5: PWM(1), D7: OUT(1), D8: OUT(0) }).across(m);
  // 9 V moins 1,5 Ω de pile, moins ≈ 0,9 + 0,7 V et 2 × 0,85 Ω d'étages : ≈ 6,7 V sur 30 Ω.
  assert.ok(fwd.v > 6 && fwd.v < 7.3, `avant : ${fwd.v} V`);
  const back = b.solve({ D5: PWM(1), D7: OUT(0), D8: OUT(1) }).across(m);
  assert.ok(back.v < -6 && back.v > -7.3, `arrière : ${back.v} V`);
  const half = b.solve({ D5: PWM(0.5), D7: OUT(1), D8: OUT(0) }).across(m);
  assert.ok(half.v > 2.8 && half.v < 3.8, `EN à 50 % : ${half.v} V (moyenne)`);
  const off = b.solve({ D5: OUT(0), D7: OUT(1), D8: OUT(0) }).across(m);
  assert.ok(Math.abs(off.v) < 0.05, `EN bas : roue libre (${off.v} V)`);
  // Sans EN câblée (pas de cavalier sur un L293D) : la voie reste coupée.
  const { b: b2, d: d2, m: m2 } = l293d();
  b2.wires.splice(b2.wires.findIndex(w => w.a.comp === d2 && w.a.key === 'EN12'), 1);
  assert.ok(Math.abs(b2.solve({ D7: OUT(1), D8: OUT(0) }).across(m2).v) < 0.05);
});
test('L293D : le moteur est vu comme piloté (câblage, code des règles)', () => {
  const { b, d, m } = l293d(), A = b.A();
  assert.equal(inspect(m, A, PARTS.dcmotor).level, 'ok');
  const dr = driveOf(m, A);
  assert.equal(dr.kind, 'l298n'); assert.equal(dr.drv, d); assert.deepEqual(dr.keys, ['IN1', 'IN2', 'EN12']); assert.equal(dr.plusFirst, true);
});

function tb6612(stbyPin) {
  const b = bench(), u = b.add('uno'), d = b.add('tb6612'), m = b.add('dcmotor'), p = b.add('bat9v');
  b.wire(d, 'VCC', u, '5V'); b.wire(d, 'GND', u, 'GND'); b.wire(d, 'VM', p, '+'); b.wire(p, '-', u, 'GND');
  b.wire(d, 'STBY', u, stbyPin || '5V');
  b.wire(d, 'PWMA', u, 'D5'); b.wire(d, 'AIN1', u, 'D7'); b.wire(d, 'AIN2', u, 'D8');
  b.wire(d, 'AO1', m, 'M+'); b.wire(d, 'AO2', m, 'M-');
  return { b, u, d, m };
}
test('TB6612FNG : MOSFET presque sans chute, frein court, veille', () => {
  const { b, m, d } = tb6612();
  const fwd = b.solve({ D5: PWM(1), D7: OUT(1), D8: OUT(0) }).across(m);
  assert.ok(fwd.v > 8.2 && fwd.v < 8.9, `avant : ${fwd.v} V`); // 9 × 30 ÷ (30 + 0,5 + 1,5)
  const back = b.solve({ D5: PWM(1), D7: OUT(0), D8: OUT(1) }).across(m);
  assert.ok(back.v < -8.2, `arrière : ${back.v} V`);
  // Frein court : les deux sorties à la masse (le moteur est court-circuité, pas lâché).
  const brake = b.solve({ D5: PWM(1), D7: OUT(1), D8: OUT(1) });
  assert.ok(Math.abs(brake.across(m).v) < 0.01);
  assert.ok(brake.volts({ comp: d, key: 'AO1' }) < 0.01 && brake.volts({ comp: d, key: 'AO2' }) < 0.01, 'deux sorties à la masse');
  // PWM : haut pendant l'impulsion, frein le reste de la période ; en moyenne, la moitié.
  const half = b.solve({ D5: PWM(0.5), D7: OUT(1), D8: OUT(0) }).across(m);
  assert.ok(half.v > 3.9 && half.v < 4.6, `PWM à 50 % : ${half.v} V`);
  // Modèle logique : IN1 = IN2 = LOW, sorties en l'air ; PWM bas, frein.
  assert.deepEqual(bridgeOut(HBRIDGES.tb6612, 0, 0, 1, 1), [null, null]);
  assert.deepEqual(bridgeOut(HBRIDGES.tb6612, 1, 0, 0, 1)[0], { hi: 0, lo: 1, split: false });
  // Veille : STBY sur une broche à LOW, tout est coupé ; à HIGH, ça repart.
  const s = tb6612('D9');
  assert.equal(inspect(s.d, s.b.A(), PARTS.tb6612).pins.STBY.level, 'ok', 'STBY sur une broche de la carte accepté');
  assert.ok(Math.abs(s.b.solve({ D5: PWM(1), D7: OUT(1), D8: OUT(0), D9: OUT(0) }).across(s.m).v) < 0.05);
  assert.ok(s.b.solve({ D5: PWM(1), D7: OUT(1), D8: OUT(0), D9: OUT(1) }).across(s.m).v > 8);
});

/* ---------- Pilotes pas à pas : modèle ---------- */
const drv = (type = 'a4988') => ({ id: 'D', type, name: 'D1', pins: {} });
const pulses = (c, n, us, lv, t0 = 0) => { let t = t0; for (let i = 0; i < n; i++) { stepEdge(c, 1, t, lv); stepEdge(c, 0, t + 0.002, lv); t += us / 1000; } return t; };
test('A4988 : un pas par front montant, sens de DIR, microrésolution MS1 à MS3', () => {
  const c = drv(), base = { RESET: 1, DIR: 1 };
  pulses(c, 200, 2000, k => base[k] ?? null); // 500 pas/s : le rotor suit
  let s = stepState(c);
  assert.deepEqual([s.steps, s.pos, s.rotor, s.lost, s.div], [200, 200, 200, 0, 1]);
  c.stepState = null;
  const ms = { ...base, DIR: 0, MS1: 1, MS2: 1, MS3: 1 };
  pulses(c, 3200, 200, k => ms[k] ?? null); // 5000 micro-pas/s = 312 pas entiers/s
  s = stepState(c);
  assert.equal(s.div, 16); assert.equal(s.steps, -3200); assert.equal(s.pos, -200); assert.equal(s.rotor, -200); assert.equal(s.lost, 0);
  // MS2 seule : quart de pas.
  assert.equal(driverInputs(c, k => ({ ...base, MS2: 1 })[k] ?? null).div, 4);
});
test('A4988 et DRV8825 : ENABLE, SLEEP et RESET bloquent les pas ; tirages des cartes Pololu', () => {
  const a = drv();
  // A4988 : SLEEP tirée au niveau haut, RESET en l'air (rien ne passe tant qu'elle n'est pas reliée).
  assert.equal(driverInputs(a, () => null).why, 'reset');
  pulses(a, 10, 2000, k => ({ RESET: 1, ENABLE: 1 })[k] ?? null);
  assert.equal(stepState(a).steps, 0); assert.equal(stepState(a).ignored, 'enable');
  const d = drv('drv8825');
  assert.equal(driverInputs(d, k => ({ RESET: 1 })[k] ?? null).why, 'sleep', 'SLEEP du DRV8825 tirée vers la masse');
  const on = { RESET: 1, SLEEP: 1, DIR: 1, M0: 1, M2: 1 };
  assert.equal(driverInputs(d, k => on[k] ?? null).div, 32);
  pulses(d, 64, 500, k => on[k] ?? null);
  assert.equal(stepState(d).pos, 2);
});
test('Décrochage : sans rampe au-delà de ≈ 1000 pas/s le rotor ne suit plus ; avec une rampe, il suit', () => {
  const lv = k => ({ RESET: 1, DIR: 1 })[k] ?? null;
  const slow = drv(); pulses(slow, 400, 1e6 / 900, lv); // 900 pas/s d'un coup : sous PULL_IN
  assert.equal(stepState(slow).lost, 0);
  assert.ok(PULL_IN === 1000);
  const fast = drv(); pulses(fast, 400, 400, lv); // 2500 pas/s d'un coup
  let s = stepState(fast);
  assert.ok(s.stalled && s.lost > 350 && s.rotor < 50, `décroché : ${JSON.stringify({ lost: s.lost, rotor: s.rotor })}`);
  // Après un arrêt, il repart lentement et se raccroche sur une position électrique (à 4 pas près).
  pulses(fast, 20, 5000, lv, 1000);
  s = stepState(fast);
  assert.ok(!s.stalled); assert.equal(Math.abs(s.pos - s.rotor) % 4, 0);
  // Rampe de 0 à 2500 pas/s à 8000 pas/s² : aucun pas perdu.
  const ramp = drv(); let t = 0, v = 50;
  for (let i = 0; i < 600; i++) { stepEdge(ramp, 1, t, lv); stepEdge(ramp, 0, t + 0.002, lv); const dt = 1 / v; t += dt * 1000; v = Math.min(2500, v + 8000 * dt); }
  s = stepState(ramp);
  assert.equal(s.lost, 0, `rampe : ${s.lost} pas perdus`); assert.equal(s.rotor, 600);
  // Au-delà de F_MAX (3000 pas/s), même avec une rampe, il décroche.
  const over = drv(); t = 0; v = 50;
  for (let i = 0; i < 2000; i++) { stepEdge(over, 1, t, lv); stepEdge(over, 0, t + 0.002, lv); const dt = 1 / v; t += dt * 1000; v = Math.min(4000, v + 8000 * dt); }
  assert.ok(stepState(over).lost > 0);
});

/* ---------- Raccordement des bobines ---------- */
function stepRig(coils = [['A+', '1A'], ['A-', '1B'], ['B+', '2A'], ['B-', '2B']]) {
  const b = bench(), u = b.add('uno'), d = b.add('a4988'), m = b.add('nema17'), p = b.add('psu24');
  b.wire(d, 'VDD', u, '5V'); b.wire(d, 'GND', u, 'GND'); b.wire(d, 'VMOT', p, '+'); b.wire(p, '-', u, 'GND');
  b.wire(d, 'STEP', u, 'D3'); b.wire(d, 'DIR', u, 'D4'); b.wire(d, 'RESET', d, 'SLEEP');
  for (const [mk, dk] of coils) b.wire(m, mk, d, dk);
  return { b, u, d, m };
}
test('NEMA 17 : sens selon le raccordement, bobines mélangées repérées', () => {
  let r = stepRig(), L = stepperLink(r.m, r.b.A());
  assert.deepEqual([L.ok, L.sign, L.drv], [true, 1, r.d]);
  assert.equal(inspect(r.m, r.b.A(), PARTS.nema17).level, 'ok', 'bobines sur un pilote : câblage accepté');
  assert.equal(inspect(r.d, r.b.A(), PARTS.a4988).level, 'ok', 'RESET reliée à SLEEP : acceptée');
  r = stepRig([['A+', '1B'], ['A-', '1A'], ['B+', '2A'], ['B-', '2B']]); L = stepperLink(r.m, r.b.A());
  assert.deepEqual([L.ok, L.sign], [true, -1], 'une bobine inversée : sens inverse');
  r = stepRig([['A+', '2A'], ['A-', '2B'], ['B+', '1A'], ['B-', '1B']]); L = stepperLink(r.m, r.b.A());
  assert.deepEqual([L.ok, L.sign], [true, -1], 'bobines échangées : sens inverse');
  r = stepRig([['A+', '1A'], ['B+', '1B'], ['A-', '2A'], ['B-', '2B']]); L = stepperLink(r.m, r.b.A());
  assert.deepEqual([L.ok, L.why], [false, 'pair']);
  const diag = checkProject(loadProject({ comps: r.b.comps.map(c => ({ id: c.id, type: c.type, name: c.name })), wires: r.b.wires.map(w => ({ a: [w.a.comp.id, w.a.key], b: [w.b.comp.id, w.b.key] })) }));
  assert.ok(diag.diags.some(x => x.code === 'J0503'), diag.diags.map(x => x.code).join(' '));
});

/* ---------- Simulateur intégré ---------- */
const ACCEL = `#include <AccelStepper.h>
AccelStepper moteur(AccelStepper::DRIVER, 3, 4);
void setup() { Serial.begin(9600); moteur.setMaxSpeed(1000); moteur.setAcceleration(4000); moteur.moveTo(200); }
void loop() { moteur.run(); }`;
test('AccelStepper (interface DRIVER) : 200 pas avec rampe, comptés par l’A4988, le NEMA 17 tourne d’un tour', () => {
  const r = stepRig(), hw = r.b.hw('uno', r.u), rt = run(ACCEL, hw, 800);
  const s = stepState(r.d);
  assert.deepEqual([s.steps, s.rotor, s.lost], [200, 200, 0], JSON.stringify(s));
  // Effecteurs : le moteur suit le rotor du pilote, son étiquette donne pas, angle et vitesse.
  const A = r.b.A(), ins = new Map(r.b.comps.map(c => [c, inspect(c, A, PARTS[c.type])]));
  driveActuators(r.b.comps, { ins, rts: new Map([[r.u.id, rt]]), A, dc: null }, 0.016);
  assert.equal(r.m.stepPos, 1); assert.match(r.m.actR.value, /^200 pas · 0° · 0 tr\/min$/);
  assert.equal(r.d.stepOn, true);
  // Un tour de plus, puis retour : runToNewPosition attend la fin du mouvement.
  const back = run(`#include <AccelStepper.h>
AccelStepper m(AccelStepper::DRIVER, 3, 4);
void setup() { Serial.begin(9600); m.setMaxSpeed(500); m.setAcceleration(2000); m.runToNewPosition(-100); Serial.println(m.currentPosition()); Serial.println(millis() > 300); }
void loop() {}`, r.b.hw('uno', r.u), 1200);
  assert.equal(back.takeSerial(), '-100\n1\n');
  assert.equal(stepState(r.d).steps, 100);
});
test('Simulateur intégré : digitalWrite et delayMicroseconds en seizièmes de pas, décrochage visible sur le moteur', () => {
  const r = stepRig();
  for (const k of ['MS1', 'MS2', 'MS3']) r.b.wire(r.d, k, r.u, '5V');
  const hw = r.b.hw('uno', r.u);
  run(`void setup() { pinMode(3, OUTPUT); pinMode(4, OUTPUT); digitalWrite(4, HIGH);
  for (int i = 0; i < 1600; i++) { digitalWrite(3, HIGH); delayMicroseconds(5); digitalWrite(3, LOW); delayMicroseconds(245); } }
void loop() {}`, hw, 600);
  let s = stepState(r.d);
  assert.deepEqual([s.div, s.pos, s.rotor, s.lost], [16, 100, 100, 0]);
  // Pas entiers à 2000 pas/s d'un coup : le pilote compte, le moteur décroche.
  const f = stepRig(), rt = run(`void setup() { pinMode(3, OUTPUT); pinMode(4, OUTPUT);
  for (int i = 0; i < 300; i++) { digitalWrite(3, HIGH); delayMicroseconds(10); digitalWrite(3, LOW); delayMicroseconds(490); } }
void loop() { digitalWrite(3, HIGH); delayMicroseconds(10); digitalWrite(3, LOW); delayMicroseconds(490); }`, f.b.hw('uno', f.u), 300);
  s = stepState(f.d);
  assert.ok(s.stalled && s.lost > 200, JSON.stringify(s));
  const A = f.b.A(), ins = new Map(f.b.comps.map(c => [c, inspect(c, A, PARTS[c.type])]));
  driveActuators(f.b.comps, { ins, rts: new Map([[f.u.id, rt]]), A, dc: null }, 0.016);
  assert.match(f.m.actR.value, /^décroche/); assert.equal(f.m.actR.level, 'warn');
});

/* ---------- 74HC595 : OE en PWM ---------- */
test('74HC595 : OE sur une broche PWM règle l’éclat des LED (et reste acceptée à la masse)', () => {
  const b = bench(), u = b.add('uno'), ic = b.add('hc595'), r = b.add('res-220'), l = b.add('led-red');
  b.wire(ic, 'VCC', u, '5V'); b.wire(ic, 'GND', u, 'GND'); b.wire(ic, 'MR', u, '5V'); b.wire(ic, 'OE', u, 'D9');
  b.wire(ic, 'Q3', r, '1'); b.wire(r, '2', l, 'A'); b.wire(l, 'K', u, 'GND');
  const ins = inspect(ic, b.A(), PARTS.hc595);
  assert.equal(ins.pins.OE.level, 'ok', JSON.stringify(ins.pins.OE)); assert.equal(ins.io.OE.key, 'D9');
  chipState(ic).latch = 0b1000;
  const full = b.solve({ D9: OUT(0) }).leds.get(l).mA;
  const quarter = b.solve({ D9: PWM(0.75) }).leds.get(l).mA; // OE haut 75 % du temps : sorties actives 25 %
  const dark = b.solve({ D9: OUT(1) }).leds.get(l).mA;
  assert.ok(full > 8, `OE bas : ${full} mA`);
  assert.ok(Math.abs(quarter - full / 4) < 0.3, `OE à 75 % : ${quarter} mA pour ${full / 4}`);
  assert.ok(dark < 0.01);
  // Le vérificateur ne compte plus OE sur une broche de la carte comme une faute de câblage.
  const proj = loadProject({ comps: b.comps.map(c => ({ id: c.id, type: c.type, name: c.name })), wires: b.wires.map(w => ({ a: [w.a.comp.id, w.a.key], b: [w.b.comp.id, w.b.key] })) });
  const d = checkProject(proj).diags.filter(x => x.loc && x.loc.comp && x.loc.comp.type === 'hc595' && x.loc.key === 'OE');
  assert.deepEqual(d.map(x => x.code), []);
});

/* ---------- Vérificateur ---------- */
test('Vérificateur : courant d’une voie du L293D, courant réglé sur l’A4988 contre la puce et le moteur', () => {
  // Moteur de 30 Ω sous 24 V par un L293D : ≈ 0,7 A, au-delà des 600 mA par voie.
  const w = (list) => list.map(([a, ka, c, kc]) => ({ a: [a, ka], b: [c, kc] }));
  const r = checkProject(loadProject({ comps: [['uno', 'U'], ['l293d', 'D'], ['dcmotor', 'M'], ['psu24', 'P']].map(([type, id]) => ({ id, type, name: id })),
    wires: w([['D', 'VCC1', 'U', '5V'], ['D', 'GND', 'U', 'GND'], ['D', 'VCC2', 'P', '+'], ['P', '-', 'U', 'GND'], ['D', 'EN12', 'U', 'D5'], ['D', 'IN1', 'U', 'D7'], ['D', 'IN2', 'U', 'D8'], ['D', 'OUT1', 'M', 'M+'], ['D', 'OUT2', 'M', 'M-']]) },
    { U: 'void setup() { pinMode(7, OUTPUT); pinMode(8, OUTPUT); digitalWrite(7, HIGH); digitalWrite(8, LOW); analogWrite(5, 255); }\nvoid loop() {}' }));
  const j = r.diags.find(x => x.code === 'J0309');
  assert.ok(j && j.level === 'error' && j.m.value > 600, r.diags.map(x => `${x.code} ${x.title}`).join('\n'));
  const rig = [['U', 'uno'], ['D', 'a4988'], ['M', 'nema17'], ['P', 'psu24']];
  const links = w([['D', 'VDD', 'U', '5V'], ['D', 'GND', 'U', 'GND'], ['D', 'VMOT', 'P', '+'], ['P', '-', 'U', 'GND'], ['D', 'STEP', 'U', 'D3'], ['D', 'DIR', 'U', 'D4'], ['D', 'RESET', 'D', 'SLEEP'],
    ['M', 'A+', 'D', '1A'], ['M', 'A-', 'D', '1B'], ['M', 'B+', 'D', '2A'], ['M', 'B-', 'D', '2B']]);
  const at = ilim => checkProject(loadProject({ comps: rig.map(([id, type]) => ({ id, type, name: id, inp: type === 'a4988' && ilim ? { ilim } : undefined })), wires: links })).diags;
  const ok = at(0);
  assert.ok(!ok.some(x => /^J0(1|2|3|5)/.test(x.code) && x.level === 'error'), ok.map(x => `${x.code} ${x.title}`).join('\n'));
  const warm = at(1500);
  assert.equal(warm.find(x => x.code === 'J0328').level, 'warning');
  const hot = at(2200);
  assert.equal(hot.find(x => x.code === 'J0328').level, 'error');
  assert.equal(hot.find(x => x.code === 'J0329').level, 'error', 'au-delà de 120 % du courant du moteur');
});

/* ---------- Code généré (règles, blocs) ---------- */
test('Règles : « M va à la position 400 pas » devient AccelStepper, qui fait tourner le NEMA 17 de deux tours', () => {
  const r = stepRig(), A = r.b.A();
  const rules = [{ kind: 'rule', id: 'r1', src: null, then: [actItem(r.m, 'pos', 400)], else: [] }];
  const code = generate(r.u, { comps: r.b.comps, A, inspect: c => inspect(c, A, PARTS[c.type]), rules, states: {} });
  assert.match(code, /AccelStepper \w+\(AccelStepper::DRIVER, \w+, \w+\);/);
  assert.match(code, /\.moveTo\(400\);/);
  assert.doesNotMatch(code, /delay\(10\)/, 'loop() tourne sans cesse');
  run(code, r.b.hw('uno', r.u), 1500);
  const s = stepState(r.d);
  assert.deepEqual([s.steps, s.rotor, s.lost], [400, 400, 0]);
});
test('Règles : un moteur à courant continu sur un TB6612FNG sort le pilote de veille', () => {
  const s = tb6612('D9'), A = s.b.A();
  const rules = [{ kind: 'rule', id: 'r1', src: null, then: [actItem(s.m, 'fwd', 100)], else: [] }];
  const code = generate(s.u, { comps: s.b.comps, A, inspect: c => inspect(c, A, PARTS[c.type]), rules, states: {} });
  assert.match(code, /digitalWrite\(\w+_STBY, HIGH\);/);
  const rt = run(code, s.b.hw('uno', s.u), 100);
  const pins = Object.fromEntries([...rt.pins].map(([k, p]) => [k, p]));
  assert.ok(s.b.solve(pins).across(s.m).v > 8);
});
