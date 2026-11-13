// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Générateur des blocs : node --test src/prog/visual/generator.test.mjs
// Chaque programme construit avec des blocs doit compiler (UNO et ESP32), contenir le code attendu
// et passer les vérifications de code des TP. La version anglaise est relancée dans un sous-processus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const i18n = await import('../../i18n/index.js');
await i18n.loadLanguage();
const { isEn } = i18n;
const { BOARDS, pickPower } = await import('../../sim/boards.js');
const { PARTS, partOf } = await import('../../sim/parts.js');
const { analyze, inspect, bbGroups } = await import('../../sim/circuit.js');
const { compile } = await import('../lang.js');
const { createRuntime } = await import('../runtime.js');
const { checkCode } = await import('../../lab/engine.js');
const { generateVisual, visualContext } = await import('./generator.js');
const { B } = await import('./types.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const TP = path.join(here, '../../lab/tp');

/* ---------- Montages (comme src/lab/validate.mjs) ---------- */
function keysOf(c) {
  const prof = BOARDS[c.type];
  if (prof) return [...Object.keys(prof.gpio), ...Object.keys(prof.power), 'GND', 'GND (2)', 'GND (3)', 'VIN', 'EN', 'RST', 'AREF', 'IOREF', 'VSYS', 'VBUS', '3V3_EN', 'RUN'];
  if (/^breadboard/.test(c.type)) return bbGroups(c).flatMap(g => g.keys);
  if (/^res-/.test(c.type)) return ['1', '2'];
  if (c.type === 'bat9v' || c.type === 'bat18650' || c.type === 'psu24') return ['+', '-'];
  const sp = PARTS[c.type]; return sp && sp.pins ? sp.pins.map(p => p.pin) : [];
}
function mount(compList, wireList) {
  const comps = compList.map(c => ({ ...c, pins: Object.fromEntries(keysOf(c).map(k => [k, {}])), inp: { ...(c.inp || {}) } }));
  const byId = Object.fromEntries(comps.map(c => [c.id, c]));
  const wires = wireList.map(w => ({ a: { comp: byId[w.a[0]], key: w.a[1] }, b: { comp: byId[w.b[0]], key: w.b[1] }, progress: 1 }));
  const A = analyze(comps, wires), cache = new Map();
  const insp = c => { if (!cache.has(c)) cache.set(c, inspect(c, A, partOf(c))); return cache.get(c); };
  return { comps, board: comps.find(c => BOARDS[c.type]), cx: { comps, A, inspect: insp } };
}
const tpOf = name => JSON.parse(fs.readFileSync(path.join(TP, name), 'utf8'));
const tpMount = tp => mount(tp.start.comps, tp.solution.wires);
/** Composants reliés directement aux broches choisies : { LED1: ['led-red', { A: 'D7' }] }… */
function bench(type, parts) {
  const prof = BOARDS[type], comps = [{ id: 'b', type, name: type.toUpperCase() }], wires = [];
  for (const [name, [t, io]] of Object.entries(parts)) {
    comps.push({ id: name, type: t, name });
    for (const p of PARTS[t].pins) {
      if (io[p.pin]) wires.push({ a: [name, p.pin], b: ['b', io[p.pin]] });
      else if (p.kind === 'pwr') { const pw = pickPower(p.v, prof); if (pw) wires.push({ a: [name, p.pin], b: ['b', pw.name] }); }
      else if (p.kind === 'gnd') wires.push({ a: [name, p.pin], b: ['b', 'GND'] });
    }
  }
  return mount(comps, wires);
}
const PINS = {
  uno: { led: 'D7', btn: 'D2', pot: 'A0', servo: 'D9', spk: 'D8', led2: 'D6' },
  esp32: { led: 'D13', btn: 'D4', pot: 'D34', servo: 'D27', spk: 'D26', led2: 'D25' }
};
const kit = type => { const p = PINS[type]; return bench(type, { LED1: ['led-red', { A: p.led }], BTN1: ['button', { 1: p.btn }], POT1: ['pot', { W: p.pot }], SERVO1: ['servo', { SIG: p.servo }], HP1: ['speaker', { '+': p.spk }], LED2: ['led-green', { A: p.led2 }] }); };

/* ---------- Blocs (format JSON de Blockly) ---------- */
let n = 0;
const blk = (type, fields, inputs) => {
  const b = { type, id: `${type}#${++n}` };
  if (fields) b.fields = fields;
  if (inputs) b.inputs = Object.fromEntries(Object.entries(inputs).filter(([, v]) => v).map(([k, v]) => [k, { block: v }]));
  return b;
};
const seq = (...bs) => { bs = bs.filter(Boolean); for (let i = 0; i < bs.length - 1; i++) bs[i].next = { block: bs[i + 1] }; return bs[0] || null; };
const num = v => blk('math_number', { NUM: v });
const text = v => blk('text', { TEXT: v });
const level = v => blk(B.LEVEL, { LEVEL: v });
const pinOf = (type, k) => PINS[type][k];
const dwrite = (pin, st) => blk(B.DWRITE, { PIN: pin }, { STATE: typeof st === 'string' ? level(st) : st });
const delay = ms => blk(B.DELAY, null, { MS: num(ms) });
const vget = id => blk('variables_get', { VAR: { id } });
const vset = (id, v) => blk('variables_set', { VAR: { id } }, { VALUE: v });
const act = (comp, a, arg) => blk(B.ACT, { COMP: comp, ACT: a }, arg !== undefined ? { ARG: typeof arg === 'number' ? num(arg) : arg } : null);
const sigB = (comp, s) => blk(B.SIG_BOOL, { COMP: comp, SIG: s });
const sigN = (comp, s) => blk(B.SIG_NUM, { COMP: comp, SIG: s });
const ifElse = (cond, then, els) => { const b = blk('controls_if', null, { IF0: cond, DO0: then, ELSE: els }); if (els) b.extraState = { hasElse: true }; return b; };
const cmp = (op, a, b) => blk('logic_compare', { OP: op }, { A: a, B: b });
const arith = (op, a, b) => blk('math_arithmetic', { OP: op }, { A: a, B: b });
const mapB = (v, a, b, c, d) => blk(B.MAP, null, { VALUE: v, FROM_LOW: num(a), FROM_HIGH: num(b), TO_LOW: num(c), TO_HIGH: num(d) });
const println = v => blk(B.PRINTLN, null, { VALUE: v });
function program({ setup, loop, every = [], variables = [] }) {
  const blocks = [{ ...blk(B.SETUP), x: 0, y: 0 }, { ...blk(B.LOOP), x: 0, y: 200 }];
  if (setup) blocks[0].inputs = { DO: { block: setup } };
  if (loop) blocks[1].inputs = { DO: { block: loop } };
  every.forEach(([ms, body]) => blocks.push({ ...blk(B.EVERY, { MS: ms }, { DO: body }) }));
  return { blocks: { languageVersion: 0, blocks }, variables: variables.map(([id, name]) => ({ id, name })) };
}
const kindOf = board => board.type;
function gen(m, ws) {
  const r = generateVisual(m.board, ws, m.cx);
  assert.ok(!/⁣/.test(r.code), 'repères retirés');
  const c = compile(r.code, { board: kindOf(m.board) });
  assert.ok(c.ok, `ne compile pas (${m.board.type}) : ${JSON.stringify(c.errors)}\n${r.code}`);
  return r;
}
const has = (code, ...snips) => snips.forEach(s => assert.ok(code.includes(s), `attendu : ${s}\n${code}`));
const count = (code, s) => code.split(s).length - 1;
const mustPass = (tpFile, code) => {
  const tp = tpOf(tpFile);
  tp.steps.filter(s => s.check && s.check.type === 'code').forEach((s, i) => {
    const r = checkCode(s.check, { program: () => ({ code, kind: 'uno' }), compile: (src, kind) => compile(src, { board: kind }) });
    assert.ok(r.ok, `${tpFile} étape code ${i + 1} : ${JSON.stringify(r)}\n${code}`);
  });
};

/* ---------- Tests ---------- */
test('clignotant (TP02) : pinMode automatique, pas de delay(10) caché, vérifications du TP', () => {
  const m = tpMount(tpOf('tp02-clignotant.json'));
  const ws = program({ loop: seq(dwrite('D8', 'HIGH'), delay(250), dwrite('D8', 'LOW'), delay(250)) });
  const { code, map } = gen(m, ws);
  has(code, 'const int LED1 = 8;', 'Serial.begin(9600);', 'pinMode(LED1, OUTPUT);', 'digitalWrite(LED1, HIGH);', 'delay(250);', 'digitalWrite(LED1, LOW);');
  assert.equal(count(code, 'pinMode('), 1, 'un seul pinMode');
  assert.ok(!code.includes('delay(10)'), 'pas de delay(10)');
  assert.ok(code.indexOf('pinMode(LED1, OUTPUT);') < code.indexOf('void loop'), 'pinMode dans setup()');
  mustPass('tp02-clignotant.json', code);
  // Lignes → blocs : chaque instruction est reliée à son bloc.
  const lines = code.split('\n'), loopBlocks = ws.blocks.blocks[1].inputs.DO.block;
  const ids = []; for (let b = loopBlocks; b; b = b.next && b.next.block) ids.push(b.id);
  assert.deepEqual([...map.values()], ids);
  for (const [ln, id] of map) assert.ok(lines[ln - 1].trim().startsWith(id.startsWith(B.DELAY) ? 'delay(' : 'digitalWrite('), `ligne ${ln} : ${lines[ln - 1]}`);
});

test('LED et bouton (TP01) : si / sinon avec les blocs du montage, puis avec les broches', () => {
  const m = tpMount(tpOf('tp01-led-bouton.json'));
  const a = gen(m, program({ loop: ifElse(sigB('button_1', 'pressed'), act('led-red_1', 'on'), act('led-red_1', 'off')) })).code;
  has(a, 'if (digitalRead(BTN1) == LOW) {', 'digitalWrite(LED1, HIGH);', '} else {', 'digitalWrite(LED1, LOW);', 'pinMode(BTN1, INPUT_PULLUP);', 'pinMode(LED1, OUTPUT);');
  mustPass('tp01-led-bouton.json', a);
  const b = gen(m, program({ loop: ifElse(cmp('EQ', blk(B.DREAD, { PIN: 'D2' }), level('LOW')), dwrite('D7', 'HIGH'), dwrite('D7', 'LOW')) })).code;
  has(b, 'if (digitalRead(BTN1) == LOW) {', 'digitalWrite(LED1, HIGH);', 'pinMode(BTN1, INPUT_PULLUP); //', 'pinMode(LED1, OUTPUT);');
  assert.equal(count(b, 'pinMode('), 2, 'pinMode dédoublonnés');
  mustPass('tp01-led-bouton.json', b);
});

test('potentiomètre et PWM (TP05) : variables typées, map, moniteur série', () => {
  const m = tpMount(tpOf('tp05-potentiometre-pwm.json'));
  const ws = program({
    loop: seq(vset('v1', blk(B.AREAD, { PIN: 'A0' })), vset('v2', mapB(vget('v1'), 0, 1023, 0, 255)), blk(B.AWRITE, { PIN: 'D9' }, { VALUE: vget('v2') }), println(vget('v1')), delay(100)),
    variables: [['v1', 'valeur'], ['v2', 'lumière']]
  });
  const { code } = gen(m, ws);
  has(code, 'int valeur = 0;', 'int lumiere = 0; //', 'valeur = analogRead(POT1);', 'lumiere = map(valeur, 0, 1023, 0, 255);', 'analogWrite(LED1, lumiere);', 'Serial.println(valeur);', 'pinMode(LED1, OUTPUT);');
  assert.ok(!/pinMode\(POT1/.test(code), 'pas de pinMode pour analogRead');
  mustPass('tp05-potentiometre-pwm.json', code);
});

for (const type of ['uno', 'esp32']) {
  test(`potentiomètre → servo par map (${type})`, () => {
    const m = kit(type), max = type === 'esp32' ? 4095 : 1023;
    const { code } = gen(m, program({ loop: seq(blk(B.SERVO, { PIN: pinOf(type, 'servo') }, { ANGLE: mapB(sigN('POT1', 'pos'), 0, max, 0, 180) }), delay(20)) }));
    has(code, `#include <${type === 'esp32' ? 'ESP32Servo.h' : 'Servo.h'}>`, 'Servo servo1;', 'servo1.attach(SERVO1);', `servo1.write(map(analogRead(POT1), 0, ${max}, 0, 180));`);
    // Servo sur une broche libre : un objet propre à la broche.
    const free = type === 'esp32' ? 'D14' : 'D5';
    const f = gen(m, program({ loop: blk(B.SERVO, { PIN: free }, { ANGLE: num(45) }) })).code;
    has(f, `.write(45);`, '.attach(');
  });

  test(`traceur série (${type}) : lignes nom:valeur`, () => {
    const m = kit(type);
    const { code } = gen(m, program({ loop: seq(blk(B.PLOT, { LABEL: 'pot' }, { VALUE: sigN('POT1', 'pos') }), blk(B.PLOT, { LABEL: 'mes valeurs' }, { VALUE: arith('MULTIPLY', num(2), num(3)) }), delay(50)) }));
    const lit = t => (type === 'uno' ? `F(${t})` : t); // texte fixe en mémoire flash sur les cartes AVR
    has(code, `Serial.print(${lit('"pot:"')});`, 'Serial.println(analogRead(POT1));', `Serial.print(${lit('"mes_valeurs:"')});`, 'Serial.println(2 * 3);');
    const prof = BOARDS[type], c = compile(code, { board: type });
    const rt = createRuntime(c.js, { kind: type, label: type, prof, read: () => null, echo: () => null, onPin: () => null, bus: () => [], data: () => null });
    for (let i = 0; i < 30; i++) rt.run(20);
    const out = rt.takeSerial();
    assert.match(out, /^pot:\d+\r?\nmes_valeurs:6\r?\n/m, out);
  });

  test(`toutes les N ms et variables (${type})`, () => {
    const m = kit(type);
    const ws = program({
      setup: seq(vset('c', num(0)), vset('nom', text('Awa'))),
      loop: seq(blk('math_change', { VAR: { id: 'c' } }, { DELTA: num(1) }), vset('moy', arith('DIVIDE', vget('c'), num(2))), vset('t', blk(B.MILLIS)),
        println(blk('text_join', null, { ADD0: text('compteur : '), ADD1: vget('c') })), ifElse(cmp('GT', vget('c'), num(10)), vset('c', num(0))),
        vset('d', num(3)), vset('vrai', cmp('LT', vget('c'), num(5)))),
      every: [[500, seq(vset('etat', blk('logic_negate', null, { BOOL: vget('etat') })), dwrite(pinOf(type, 'led'), vget('etat')))], [1000, act('LED2', 'blink', 300)]],
      variables: [['c', 'compteur'], ['nom', 'nom'], ['moy', 'moyenne'], ['t', 'début'], ['etat', 'état'], ['d', 'delay'], ['vrai', 'petit']]
    });
    const { code } = gen(m, ws);
    has(code, 'int compteur = 0;', 'String nom = "";', 'float moyenne = 0;', 'unsigned long debut = 0;', 'bool etat = false;', 'int delay_v = 0;', 'bool petit = false;',
      'compteur += 1;', 'moyenne = compteur / 2.0;', 'debut = millis();', `Serial.print(${type === 'uno' ? 'F("compteur : ")' : '"compteur : "'});`, 'Serial.println(compteur);',
      `unsigned long ${isEn ? 'timer' : 'minuterie'}1 = 0;`, `if (millis() - ${isEn ? 'timer' : 'minuterie'}1 >= 500) {`, `  ${isEn ? 'timer' : 'minuterie'}1 = millis();`,
      'etat = !etat;', 'digitalWrite(LED1, etat ? HIGH : LOW);', 'digitalWrite(LED2, (millis() / 300) % 2 ? HIGH : LOW);');
    assert.equal(count(code, 'pinMode(LED1, OUTPUT);'), 1);
  });

  test(`toutes les familles de blocs compilent (${type})`, () => {
    const m = kit(type), p = PINS[type];
    const ws = program({
      setup: seq(println(text('Bonjour')), blk(B.PRINT, null, { VALUE: num(3.5) }), blk(B.PRINTLN)),
      loop: seq(
        blk('controls_repeat_ext', null, { TIMES: num(3), DO: blk('controls_repeat_ext', null, { TIMES: num(2), DO: blk(B.TONE, { PIN: p.spk }, { FREQ: num(440) }) }) }),
        blk(B.NOTONE, { PIN: p.spk }),
        blk('controls_for', { VAR: { id: 'i' } }, { FROM: num(10), TO: num(0), BY: num(2), DO: blk(B.AWRITE, { PIN: p.led2 }, { VALUE: arith('MULTIPLY', vget('i'), num(25)) }) }),
        blk('controls_whileUntil', { MODE: 'UNTIL' }, { BOOL: sigB('BTN1', 'pressed'), DO: delay(10) }),
        vset('x', blk('math_single', { OP: 'ROOT' }, { NUM: num(2) })),
        vset('y', blk('math_single', { OP: 'NEG' }, { NUM: num(-3) })),
        vset('z', blk('math_modulo', null, { DIVIDEND: num(7), DIVISOR: num(3) })),
        vset('r', blk('math_random_int', null, { FROM: num(1), TO: num(6) })),
        vset('k', blk(B.CONSTRAIN, null, { VALUE: vget('r'), LOW: num(2), HIGH: num(5) })),
        vset('b', blk('logic_operation', { OP: 'OR' }, { A: blk('logic_operation', { OP: 'AND' }, { A: blk('logic_boolean', { BOOL: 'TRUE' }), B: sigB('BTN1', 'pressed') }), B: cmp('NEQ', vget('z'), num(1)) })),
        vset('s', arith('MINUS', vget('r'), arith('ADD', num(1), num(2)))),
        vset('w', arith('POWER', num(2), num(8))),
        act('LED1', 'dim', vget('k')), act('LED2', 'on'), act('SERVO1', 'angle', 90), act('SERVO1', 'angle', vget('k')), act('HP1', 'note', vget('r')), act('HP1', 'off'),
        blk(B.ACT, { COMP: 'LED1', ACT: 'blink' }, { ARG: vget('k') }),
        { ...blk(B.DELAY, null, { MS: num(5) }), icons: { comment: { text: 'une pause\ncourte' } } },
        { ...blk(B.DELAY, null, { MS: num(1) }), disabledReasons: ['MANUALLY_DISABLED'] }),
      variables: ['i', 'x', 'y', 'z', 'r', 'k', 'b', 's', 'w'].map(v => [v, v])
    });
    const { code, warnings } = gen(m, ws);
    assert.deepEqual(warnings, []);
    has(code, 'for (int j = 0; j < 3; j++) {', 'for (int m = 0; m < 2; m++) {', 'for (i = 10; i >= 0; i -= 2) {', 'while (!(digitalRead(BTN1) == LOW)) {', 'x = sqrt(2);', 'y = -(-3);',
      'z = 7 % 3;', 'r = random(1, 7);', 'k = constrain(r, 2, 5);', 'b = (true && digitalRead(BTN1) == LOW) || z != 1;', 's = r - (1 + 2);', 'w = pow(2, 8);',
      'analogWrite(LED1, k);', 'servo1.write(90);', 'servo1.write(k);', 'tone(HP1, r);', 'noTone(HP1);', '// une pause', '// courte', 'Serial.println();', 'Serial.print(3.5);');
    assert.ok(!code.includes('delay(1);'), 'bloc désactivé ignoré');
  });
}

test('composant absent ou non câblé : commentaire et avertissement', () => {
  const m = kit('uno');
  const ws = program({ loop: seq(act('led-red_9', 'on'), println(sigN('POT9', 'pos')), act('LED1', 'nope')) });
  const { code, warnings } = gen(m, ws);
  has(code, isEn ? '// (block skipped: component removed from the circuit)' : '// (bloc ignoré : composant retiré du montage)', 'Serial.println(0);');
  assert.equal(warnings.length, 3);
  const loose = bench('uno', { LED1: ['led-red', {}] });
  const r = gen(loose, program({ loop: act('LED1', 'on') }));
  assert.equal(r.warnings.length, 1);
  has(r.code, 'LED1');
});

test('un seul « au démarrage » et un seul « en boucle »', () => {
  const m = kit('uno'), ws = program({ loop: println(num(1)) });
  ws.blocks.blocks.push({ ...blk(B.LOOP), inputs: { DO: { block: println(num(2)) } } });
  const { code, warnings } = gen(m, ws);
  assert.ok(code.includes('Serial.println(1);') && !code.includes('Serial.println(2);'));
  assert.equal(warnings.length, 1);
});

test('chaque capteur se lit en une expression (UNO, ESP32)', () => {
  for (const type of ['uno', 'esp32']) {
    const prof = BOARDS[type], i2c = prof.i2c, pins = type === 'uno' ? ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D12'] : ['D4', 'D13', 'D14', 'D27', 'D26', 'D25', 'D19', 'D18'];
    const adc = type === 'uno' ? ['A0', 'A1', 'A2', 'A3'] : ['D34', 'D35', 'D32', 'D33'];
    const m = bench(type, {
      DHT1: ['dht22', { DATA: pins[0] }], DS1: ['ds18b20', { DQ: pins[1] }], US1: ['hcsr04', { TRIG: pins[2], ECHO: pins[3] }], PIR1: ['pir', { OUT: pins[4] }],
      LDR1: ['ldr', { AO: adc[0] }], SOL1: ['soil', { AOUT: adc[1] }], GAZ1: ['mq2', { AO: adc[2] }], SON1: ['sound', { AO: adc[3] }],
      BMP1: ['bmp280', { SDA: i2c.sda, SCL: i2c.scl }], MPU1: ['mpu6050', { SDA: i2c.sda, SCL: i2c.scl }], BTN1: ['button', { 1: pins[5] }], LCD1: ['lcd1602', { SDA: i2c.sda, SCL: i2c.scl }]
    });
    const ctx = visualContext(m.board, m.cx);
    const reads = ctx.comps.flatMap(c => c.sigs.map(s => println(blk(s.kind === 'bool' ? B.SIG_BOOL : B.SIG_NUM, { COMP: c.id, SIG: s.key }))));
    const { code, warnings } = gen(m, program({ loop: seq(...reads, act('LCD1', 'line0', sigN('DHT1', 'temp')), act('LCD1', 'line1', text('ok')), act('LCD1', 'clear')) }));
    assert.deepEqual(warnings, []);
    has(code, 'dht1.readTemperature()', 'ds1_temperature()', isEn ? 'measureDistance(US1_TRIG, US1_ECHO)' : 'mesurerDistance(US1_TRIG, US1_ECHO)', `${isEn ? 'tilt' : 'inclinaison'}(mpu1)`,
      'bmp1.readPressure() / 100.0', isEn ? 'writeLine(lcd1, lcd1_lines, 0, String(dht1_temperature));' : 'ecrireLigne(lcd1, lcd1_lignes, 0, String(dht1_temperature));');
    // DHT1 sert deux fois dans « en boucle » : lu une seule fois, en tête de loop().
    assert.equal(code.split('dht1.readTemperature()').length - 1, 1, 'une seule lecture');
    assert.ok(!/^\s*(float|int|bool) \w+ = .*;\s*\/\/ Mesures/m.test(code) && !code.includes(isEn ? '// Measures' : '// Mesures'), 'lectures en ligne, rien dans loop() avant');
    assert.equal(ctx.pins.find(p => p.key === pins[0]).label, `${pins[0]} (DHT1)`);
  }
});

test('contexte des blocs : broches « D7 (LED1) » et composants de la carte', () => {
  const m = tpMount(tpOf('tp01-led-bouton.json')), ctx = visualContext(m.board, m.cx);
  assert.equal(ctx.pins.find(p => p.key === 'D7').label, 'D7 (LED1)');
  assert.equal(ctx.pins.find(p => p.key === 'D2').label, 'D2 (BTN1)');
  assert.ok(!ctx.pins.some(p => p.key === 'SDA'), 'alias SDA/SCL masqués');
  assert.deepEqual(ctx.comps.map(c => c.name).sort(), ['BTN1', 'LED1']);
  assert.ok(ctx.comps.find(c => c.name === 'LED1').acts.some(a => a.key === 'dim' && a.arg.kind === 'num'));
  assert.ok(JSON.stringify(ctx).length < 20000);
});

test('noms anglais quand l’interface est en anglais', { skip: isEn }, () => {
  const env = { ...process.env, JOLLOF_LANG: 'en' };
  delete env.NODE_TEST_CONTEXT; // sinon le sous-processus rend compte au processus parent au lieu de s'exécuter seul
  const r = spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('identifiants anglais', { skip: !isEn }, () => {
  const m = bench('uno', { DS1: ['ds18b20', { DQ: 'D4' }], US1: ['hcsr04', { TRIG: 'D9', ECHO: 'D10' }], LCD1: ['lcd1602', { SDA: 'SDA', SCL: 'SCL' }] });
  const { code } = gen(m, program({ loop: seq(act('LCD1', 'line0', sigN('US1', 'dist')), vset('v', sigN('DS1', 'temp'))), every: [[1000, println(vget('v'))]], variables: [['v', 'valeur']] }));
  has(code, 'measureDistance(', 'writeLine(', 'lastRead', 'timer1', 'float valeur = 0;');
  for (const fr of ['mesurerDistance', 'ecrireLigne', 'lecture', 'minuterie', 'duree', 'ecran', 'texte', 'ligne']) assert.ok(!new RegExp(`\\b${fr}\\b`).test(code.replace(/\/\/.*$/gm, '')), `${fr} traduit`);
});

test('les blocs de la boîte à outils se chargent dans Blockly (sous Node) et se génèrent', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const Blockly = require('blockly/core'); require('blockly/blocks');
  Blockly.setLocale(require(isEn ? 'blockly/msg/en' : 'blockly/msg/fr'));
  const { defineBlocks, toolbox } = await import('./blocks.js');
  const flush = () => new Promise(r => setTimeout(r, 5)); // Blockly diffuse ses événements après coup
  for (const type of ['uno', 'esp32']) {
    const m = kit(type), ctx = visualContext(m.board, m.cx);
    defineBlocks(Blockly, ctx);
    const ws = new Blockly.Workspace(), items = toolbox(ctx).contents.flatMap(c => c.contents || []).filter(x => x.kind === 'block');
    assert.ok(items.length > 40, `${items.length} blocs`);
    for (const { kind, ...state } of items) Blockly.serialization.blocks.append(state, ws);
    // Toutes les instructions dans « en boucle », chaque valeur affichée sur le moniteur série.
    const loop = ws.getTopBlocks(false).find(b => b.type === B.LOOP);
    let at = loop.getInput('DO').connection;
    for (const b of ws.getTopBlocks(false)) {
      if (b.previousConnection && !b.outputConnection) { at.connect(b.previousConnection); at = b.nextConnection; }
      else if (b.outputConnection) { const p = ws.newBlock(B.PRINTLN); p.getInput('VALUE').connection.connect(b.outputConnection); at.connect(p.previousConnection); at = p.nextConnection; }
    }
    const json = Blockly.serialization.workspaces.save(ws);
    const { code, warnings, map } = gen(m, json);
    assert.deepEqual(warnings, []);
    has(code, 'digitalWrite(LED1, HIGH);', 'servo1.write(90);', 'tone(HP1, 440);', 'analogWrite(LED1, 128);', 'Serial.println(digitalRead(BTN1) == LOW);', 'Serial.println(analogRead(POT1));');
    assert.ok(map.size > 40);
    // Relu tel quel.
    const ws2 = new Blockly.Workspace(); Blockly.serialization.workspaces.load(json, ws2);
    assert.deepEqual(Blockly.serialization.workspaces.save(ws2), json);
    // Changer d'action change la forme du bloc (réglage et unité) ; un composant inconnu est gardé.
    const a = ws2.getAllBlocks(false).find(b => b.type === B.ACT && b.getFieldValue('COMP') === 'LED1' && b.getFieldValue('ACT') === 'on');
    a.setFieldValue('dim', 'ACT'); await flush();
    const st = Blockly.serialization.blocks.save(a, { addNextBlocks: false });
    assert.deepEqual(st.extraState, { arg: 'num', unit: '/255' });
    assert.equal(st.inputs.ARG.shadow.fields.NUM, 128);
    a.setFieldValue('SERVO1', 'COMP'); await flush();
    assert.equal(a.getFieldValue('ACT'), 'angle');
    a.setFieldValue('LED9', 'COMP');
    assert.equal(a.getFieldValue('COMP'), 'LED9');
    ws.dispose(); ws2.dispose();
  }
});
