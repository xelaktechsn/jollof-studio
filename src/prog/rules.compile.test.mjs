// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Programmes des règles : robustes, compilés sans un avertissement, identiques sur l'interpréteur et la vraie carte.
// - Chaque exemple (exemples/*.jollof), chaque TP qui a des règles, et une batterie de montages synthétiques qui
//   utilisent chaque mesure (SIGNALS) et chaque action (ACTIONS) des composants du cœur, et chaque construction du
//   langage (et / ou, dès que, depuis, marge, minuteries, au démarrage, variables gardées en EEPROM, séquences, suites
//   « puis attendre », moniteur série) : le programme généré n'a ni String, ni unsigned long, ni delay() dans loop()
//   (hors la pause de fin d'une milliseconde), et l'interpréteur (lang.js) le compile.
// - Avec arduino-cli : compilé avec -Wall -Wextra (--warnings all) pour sa carte, zéro avertissement dans le croquis ;
//   flash et RAM affichées. Le programme le plus riche est compilé pour Uno, Nano, Mega, Pico et ESP32 ; toute la
//   batterie sur toutes les cartes avec JOLLOF_FULL=1 (long : l'ESP32 prend 1 à 3 min par programme sans cache).
// - Parité : un programme généré tourne sur l'interpréteur et sur l'ATmega328P émulé (paritykit.mjs), mêmes broches,
//   même texte série aux mêmes instants.
// Sans arduino-cli, seules les vérifications sans compilateur tournent. node --test src/prog/rules.compile.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bench, rule, act, wait, set, goTo, variable, seq, step, go, compile, hasCli, FQBN } from './rulekit.mjs';
import { SIGNALS, ACTIONS, signalOf, defArg, isSensor, isActuator, generate } from './rules.js';
import { compile as interp } from './lang.js';
import { loadProject } from '../check/load.js';
import { boardOf, kindOf } from '../sim/boards.js';

const FULL = !!process.env.JOLLOF_FULL;
const fqbnOf = kind => FQBN[kind] || (/esp32/.test(kind) ? FQBN.esp32 : /pico|rp2040/.test(kind) ? FQBN.pico : null);

/** Ce que tout programme des règles doit respecter, sans compilateur. */
function robust(code, kind, what) {
  assert.ok(!/\bString\b/.test(code), `${what} : String (mémoire dynamique)`);
  assert.ok(!/\bunsigned long\b/.test(code), `${what} : unsigned long au lieu de uint32_t`);
  const loop = code.slice(code.indexOf('void loop() {'));
  const delays = (loop.match(/\bdelay\(\d+\)/g) || []).filter(d => d !== 'delay(1)');
  assert.deepEqual(delays, [], `${what} : delay() dans loop()`);
  assert.ok(!/pulseIn\([^)]*\)(?<!,\s*\d+UL\))/.test(code.replace(/pulseIn\(echo, HIGH, 25000UL\)/g, '')), `${what} : pulseIn sans délai maximal`);
  const c = interp(code, { board: kind });
  assert.ok(c.ok, `${what} : l’interpréteur refuse le programme : ${JSON.stringify(c.errors && c.errors.slice(0, 3))}\n${code}`);
}
const sizes = [];
function cc(code, fqbn, what) {
  const r = compile(code, fqbn);
  assert.ok(r.ok, `${what} (${fqbn}) ne compile pas :\n${r.errors.join('\n')}\n${code}`);
  assert.deepEqual(r.warnings, [], `${what} (${fqbn}) : avertissements`);
  sizes.push(`${what.padEnd(46)} ${fqbn.padEnd(24)} flash ${String(r.flash).padStart(7)}  RAM ${String(r.ram).padStart(6)}`);
  return r;
}
test.after(() => { if (sizes.length) console.log(`\nTailles des programmes des règles :\n${sizes.join('\n')}`); });

/* ---------- Exemples et TP ---------- */
const projects = [
  ...fs.readdirSync(new URL('../../exemples/', import.meta.url)).filter(f => f.endsWith('.jollof')).map(f => [f, JSON.parse(fs.readFileSync(new URL(`../../exemples/${f}`, import.meta.url), 'utf8'))]),
  ...['pneu', 'tp', 'logic'].flatMap(dir => { const u = new URL(`../lab/${dir}/`, import.meta.url); return fs.existsSync(u) ? fs.readdirSync(u).filter(f => f.endsWith('.json')).map(f => [`${dir}/${f}`, JSON.parse(fs.readFileSync(new URL(f, u), 'utf8'))]) : []; })
].map(([f, d]) => [f, d.project || d.start || d]).filter(([, d]) => d && d.comps && d.settings && d.settings.prog && (d.settings.prog.rules || []).length);

test('exemples et TP : programmes des règles robustes, acceptés par l’interpréteur', () => {
  assert.ok(projects.length >= 6, `${projects.length} projets avec des règles`);
  for (const [f, d] of projects) {
    const L = loadProject(d);
    for (const [id, code] of L.programs) if (L.auto.has(id)) robust(code, kindOf(L.byId[id]), `${f} ${id}`);
  }
});
test('exemples et TP : zéro avertissement avec -Wall -Wextra', { skip: !hasCli && 'arduino-cli absent' }, () => {
  for (const [f, d] of projects) {
    const L = loadProject(d);
    for (const [id, code] of L.programs) { const fq = L.auto.has(id) && fqbnOf(kindOf(L.byId[id])); if (fq) cc(code, fq, `${f.replace(/\.jollof$/, '')} ${L.byId[id].name}`); }
  }
});

/* ---------- Batterie synthétique : chaque mesure, chaque action du cœur ---------- */
const GROUPS = [
  ['uno', ['button', 'led-red', 'led-rgb', 'buzzer', 'servo', 'relay', 'pot']],
  ['uno', ['dht22', 'ds18b20', 'hcsr04', 'lcd1602', 'speaker', 'ws2812']],
  ['mega', ['bmp280', 'bh1750', 'mpu6050', 'oled', 'hx711', 'traffic']], // cinq bibliothèques I2C : trop pour les 32 Ko d'une Uno
  ['mega', ['pir', 'tilt-sw', 'hall', 'flame', 'rain', 'water', 'irobst', 'line', 'shock', 'ttp223', 'rcwl0516', 'mq135', 'mq2', 'ldr', 'soil', 'sound', 'lm35', 'joystick', '7seg', 'laser']],
  ['uno', ['bme280', 'dht11', 'lcd2004', 'stepper', 'vibro']],
  ['uno', ['dcmotor', 'fan', 'pump', 'led-green']],
  ['uno', ['nema17', 'led-blue', 'button']]
];
const CORE = new Set(GROUPS.flatMap(g => g[1]));
/** Règles qui utilisent chaque mesure (dans une condition) et chaque action (sous une minuterie) du montage. */
function battery(M) {
  const rules = [], n = variable('n', 'int', 0);
  rules.push(n);
  const sensors = M.comps.filter(c => isSensor(c) && CORE.has(c.type)), acts = M.comps.filter(c => isActuator(c) && CORE.has(c.type));
  let k = 0;
  for (const s of sensors) for (const key of Object.keys(SIGNALS[s.type])) {
    const sig = signalOf(s.type, key, boardOf(M.board));
    rules.push(rule({ comp: s.id, sig: key }, [set(n, '+', 1)], [set(n, '-', 1)], sig.kind === 'bool' ? { op: '==', v: 1 } : { op: '>', v: sig.def }));
  }
  for (const c of acts) for (const [key, A] of Object.entries(ACTIONS[c.type])) {
    if (A.follow) {
      const s = sensors.find(x => Object.values(SIGNALS[x.type]).some(g => !g.kind || g.kind === 'num'));
      if (s) { const kk = Object.keys(SIGNALS[s.type]).find(x => (SIGNALS[s.type][x].kind || 'num') === 'num'); rules.push(rule({ comp: s.id, sig: kk }, [act(c, key, defArg(c.type, key))], [], { op: 'follow', from: [0, 1000] })); }
      continue;
    }
    rules.push(rule({ every: 300 + 7 * k++ }, [act(c, key, A.arg ? A.arg.def : undefined, key === 'value' ? { what: { var: n.id } } : {})]));
  }
  return rules;
}
for (const [kind, types] of GROUPS) {
  test(`batterie ${kind} : ${types.join(', ')}`, () => {
    const M = bench(kind, types);
    assert.deepEqual(M.errors, [], 'câblage automatique');
    const code = M.code(battery(M));
    robust(code, kind, types.join('+'));
    for (const t of types) assert.ok(code.includes(M.comps.find(c => c.type === t).name), `${t} absent du programme`);
    if (hasCli) for (const b of FULL ? [kind, ...(kind === 'uno' ? ['nano', 'esp32', 'pico'] : [])] : [kind]) cc(b === kind ? code : bench(b, types).code(battery(bench(b, types))), FQBN[b], `batterie ${types.slice(0, 3).join('+')}…`);
  });
}

/* ---------- Constructions du langage ---------- */
/** Programme riche : variables (dont une gardée en EEPROM), séquence, suite temporisée, dès que, depuis, marge, et / ou, texte reçu. */
export function rich(kind) {
  const M = bench(kind, ['button', 'led-red', 'servo', 'dht22', 'lcd1602', 'buzzer', 'pot']);
  const L = M.c('LED1'), SV = M.c('SERVO1'), BZ = M.comps.find(c => c.type === 'buzzer'), LCD = M.c('LCD1'), DHT = M.comps.find(c => c.type === 'dht22'), POT = M.comps.find(c => c.type === 'pot');
  const cnt = variable('compteur', 'int', 0, { persist: true }), seuil = variable('seuil', 'dec', 25.5), alarme = variable('alarme', 'bool', false), msg = variable('message', 'text', 'pret', { len: 12 });
  const R1 = step('Rouge'), V1 = step('Vert'), O1 = step('Orange');
  R1.do = [act(L, 'on'), act(SV, 'angle', 0)]; R1.go = [go(V1, { after: 400 })];
  V1.do = [act(L, 'off'), act(SV, 'angle', 90)]; V1.go = [go(O1, { after: 300 }), go(R1, { when: { src: { var: alarme.id }, op: '==', v: 1 } })];
  O1.do = [act(L, 'blink', 100), act('@serial', 'print', 'orange')]; O1.go = [go(R1, { after: 300 })];
  const Q = seq('Feu', [R1, V1, O1]);
  const btn = M.src('BTN1');
  return { M, Q, cnt, rules: [cnt, seuil, alarme, msg, Q,
    rule(btn, [set(cnt, '+', 1), act(BZ, 'on'), wait(150), act(BZ, 'off'), act('@serial', 'show', null, { what: { var: cnt.id } })], [], { edge: true }),
    rule(btn, [set(alarme, 'toggle')], [], { hold: 1000 }),
    rule({ comp: DHT.id, sig: 'temp' }, [act(LCD, 'text', 'Chaud', { line: 2 })], [act(LCD, 'value', null, { what: { var: cnt.id }, line: 2 })], { op: '>', vs: { var: seuil.id }, more: [{ link: 'or', src: { comp: DHT.id, sig: 'fault' }, op: '==', v: 1 }] }),
    rule({ comp: POT.id, sig: 'pos' }, [set(alarme, '=', true)], [set(alarme, '=', false)], { op: '>', v: 700, hyst: 50 }),
    rule({ comp: '@serial', sig: 'line' }, [set(msg, '=', null, { src: { comp: '@serial', sig: 'line' } }), goTo(Q, O1), act(LCD, 'value', null, { what: { var: msg.id }, line: 1 })], [], { op: '==', v: 'orange' }),
    rule({ start: true }, [act('@serial', 'print', 'demarrage')]),
    rule({ every: 2000 }, [act('@serial', 'plot', null, { what: { comp: DHT.id, sig: 'temp' } })])
  ] };
}
test('constructions du langage : programme riche, robuste, accepté par l’interpréteur', () => {
  for (const kind of ['uno', 'nano', 'mega', 'esp32', 'pico']) {
    const { M, rules } = rich(kind);
    const code = M.code(rules);
    robust(code, kind, `programme riche ${kind}`);
    for (const s of ['enum Etape_Feu : uint8_t', 'feu_aller(FEU_VERT)', 'suite1', 'EEPROM.put(', 'INT32_MAX', '_front', 'depuis', 'hysteresis', 'premierTour']) assert.ok(code.includes(s), `${kind} : ${s}`);
    if (kind === 'uno') { assert.match(code, /strcmp_P\(ligneRecue, PSTR\("orange"\)\)/); assert.match(code, /sleep_mode\(\)/); assert.match(code, /Serial\.println\(F\("demarrage"\)\)/); }
    if (kind === 'esp32') { assert.match(code, /EEPROM\.begin\(/); assert.match(code, /EEPROM\.commit\(\)/); assert.match(code, /delay\(1\);/); }
  }
});
test('constructions du langage : zéro avertissement sur Uno, Nano, Mega, Pico et ESP32', { skip: !hasCli && 'arduino-cli absent' }, () => {
  for (const kind of ['uno', 'nano', 'mega', 'pico', 'esp32']) { const { M, rules } = rich(kind); cc(M.code(rules), FQBN[kind], 'programme riche (toutes les constructions)'); }
});
test('anciennes règles (format d’avant, sans kind) : même programme qu’après migration', () => {
  const M = bench('uno', ['button', 'led-red']);
  const legacy = { id: 'r1', src: { comp: M.c('BTN1').id, sig: 'pressed' }, op: '==', v: 1, dst: { comp: M.c('LED1').id, act: 'on' }, alt: { act: 'off' } };
  const code = generate(M.board, { ...M.cx([]), rules: [legacy] });
  assert.match(code, /if \(btn1_appuye\) \{\n\s+digitalWrite\(LED1, HIGH\);\n\s+\} else \{\n\s+digitalWrite\(LED1, LOW\);/);
});

/* ---------- Parité : interpréteur et vraie carte ---------- */
test('parité : programme généré (dès que, suite temporisée, séquence, ligne reçue) identique sur l’interpréteur et l’Uno émulé', { skip: !hasCli && 'arduino-cli absent' }, async () => {
  const { parity } = await import('./paritykit.mjs');
  const M = bench('uno', ['button', 'led-red', 'led-green', 'buzzer']);
  const L = M.c('LED1'), G = M.c('LED2'), BZ = M.comps.find(c => c.type === 'buzzer');
  const n = variable('n', 'int', 0), A = step('A'), B = step('B');
  A.do = [act(G, 'on')]; A.go = [go(B, { after: 300 })]; B.do = [act(G, 'off')]; B.go = [go(A, { after: 200 })];
  const Q = seq('Cycle', [A, B]);
  const code = M.code([n, Q,
    rule(M.src('BTN1'), [set(n, '+', 1), act(L, 'on'), wait(250), act(L, 'off'), act('@serial', 'show', null, { what: { var: n.id } })], [], { edge: true }),
    rule({ comp: '@serial', sig: 'line' }, [act(BZ, 'on')], [], { op: '==', v: 'bip' })]);
  const pin = name => { const m = new RegExp(`constexpr uint8_t ${name} = (\\d+);`).exec(code); return m ? `D${m[1]}` : null; };
  const btn = pin('BTN1'), led = pin('LED1'), led2 = pin('LED2');
  assert.ok(btn && led && led2, code);
  const r = parity(code, {
    inputs: [{ at: 100, pin: btn, d: 0 }, { at: 180, pin: btn, d: 1 }, { at: 700, pin: btn, d: 0 }, { at: 760, pin: btn, d: 1 }],
    serialIn: [{ at: 50, text: 'bip\n' }],
    probes: [90, 200, 330, 450, 640, 820, 1100, 1300], pins: [led, led2], until: 1400
  });
  assert.deepEqual(r.diff, [], JSON.stringify(r.diff, null, 1));
  assert.match(r.interp.serial, /n : 2/);
});
