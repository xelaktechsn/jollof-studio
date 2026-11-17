// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Règles des composants de la bibliothèque (rules-parts.js) : chaque capteur, entrée, afficheur, module de communication,
// puce logique, horloge ou mémoire a ses mesures et ses actions ; un programme qui les utilise toutes est robuste (ni
// String ni unsigned long, pas de delay() dans loop()), compile et tourne dans l'interpréteur, et, si arduino-cli est
// installé, compile sans aucun avertissement du croquis (-Wall -Wextra) sur Uno et ESP32 (Nano, Mega et Pico pour une
// partie des montages). node --test src/prog/rules-parts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bench, rule, act, variable, compile, hasCli, FQBN } from './rulekit.mjs';

const { LIBRARY } = await import('../library/catalog.js');
const R = await import('./rules.js');
const { PART_SIGNALS, PART_ACTIONS, PART_GEN, PART_EXEMPT } = await import('./rules-parts.js');
const L = await import('./lang.js');
const { createRuntime } = await import('./runtime.js');
const { BOARDS, kindOf } = await import('../sim/boards.js');
const { netLevel } = await import('../sim/chips.js');
const { irPress, presentBadge, keypadDown, keypadUp, encTurn, serialDevice, periph } = await import('../sim/models.js');

/** Catégories de la bibliothèque dont chaque composant doit pouvoir servir dans une règle. */
const CATS = ['Capteurs', 'Entrées', 'Affichage', 'Sorties', 'Moteurs', 'Communication', 'Circuits logiques', 'Horloges et mémoires'];
/** Composants traités par rules-parts.js. */
const PARTS = [...new Set([...Object.keys(PART_SIGNALS), ...Object.keys(PART_ACTIONS)])];

/**
 * Programme qui se sert de chaque mesure (dans une condition ; événement comparé à une valeur) et de chaque action
 * (toutes les secondes ; action « valeur » : une variable nombre, ou texte pour un envoi sur deux) des composants
 * de type `types` du montage M.
 */
function program(M, types) {
  // Entrées des puces (extenseurs, 74HC165) : quelques broches reliées à la masse, pour que leurs mesures soient lues.
  const gnd = Object.keys(M.board.pins).find(k => /^GND/.test(k)), TIE = { mcp23017: ['GPA1', 'GPB2'], pcf8574: ['P1'], hc165: ['D0', 'D7'] };
  for (const c of M.comps) for (const k of TIE[c.type] || []) if (!M.wires.some(w => (w.a.comp === c && w.a.key === k) || (w.b.comp === c && w.b.key === k))) M.wires.push({ a: { comp: c, key: k }, b: { comp: M.board, key: gnd }, progress: 1 });
  const num = variable('n', 'dec', 1.5), txt = variable('t', 'text', 'ok', { len: 12 }), rules = [num, txt];
  let flip = 0;
  for (const c of M.comps.filter(k => types.includes(k.type))) {
    for (const [k, s] of Object.entries(R.SIGNALS[c.type] || {})) {
      const src = { comp: c.id, sig: k }, sig = R.signalOf(c.type, k, null);
      if (sig.kind === 'bool') rules.push(rule(src, [act('@serial', 'print', `${c.name} ${k} oui`)], [act('@serial', 'print', `${c.name} ${k} non`)], { op: '==', v: 1 }));
      else if (sig.kind === 'text') rules.push(rule(src, [act('@serial', 'print', `${c.name} ${k}`)], [], { op: '==', v: s.len === 1 ? 'A' : 'OK' }));
      else if (sig.event) rules.push(rule(src, [act('@serial', 'show', null, { what: src })], [], { op: '==', v: sig.def }));
      else rules.push(rule(src, [act('@serial', 'show', null, { what: src })], [], { op: '>', v: sig.def ?? 0, ...(sig.kind === 'time' ? { op: '==', edge: true } : {}) }));
    }
    for (const [k, a] of Object.entries(R.ACTIONS[c.type] || {})) {
      if (a.follow) { rules.push(rule({ var: num.id }, [act(c, k)], [], { op: 'follow', from: [0, 100] })); continue; }
      const o = a.what || k === 'value' ? { what: { var: a.once && flip++ % 2 ? txt.id : num.id } } : {};
      rules.push(rule({ every: 1000 }, [act(c, k, undefined, o)]));
    }
  }
  return M.code(rules);
}
/** Le programme est robuste : ni String ni unsigned long ; dans loop(), seul le repos d'une milliseconde du cœur. */
function robust(code, what) {
  assert.ok(!/\bString\b/.test(code), `${what} : String`);
  assert.ok(!/\bunsigned long\b/.test(code), `${what} : unsigned long au lieu de uint32_t`);
  const loop = code.slice(code.indexOf('void loop() {')).split('\n').filter(l => !/^ {2}delay\(1\); \/\//.test(l)).join('\n');
  assert.ok(!/\bdelay\(/.test(loop), `${what} : delay() dans loop()`);
  assert.ok(!/\bpulseIn\([^)]*\)/.test(loop.replace(/pulseIn\([^,]+,[^,]+,[^)]+\)/g, '')), `${what} : pulseIn() sans délai maximal`);
}
/** Compile le programme dans l'interpréteur, puis le fait tourner 300 ms sur une carte sans montage. */
function interp(code, board, what) {
  const kind = kindOf(board), c = L.compile(code, { board: kind });
  assert.ok(c.ok, `${what} : ${JSON.stringify(c.errors && c.errors.slice(0, 3))}`);
  const store = { ee: '', prefs: {} };
  const hw = { kind, label: kind, prof: BOARDS[kind], read: () => null, echo: () => null, at: () => [], onPin: () => null, data: () => null, bus: () => [], i2c: () => [],
    status: () => ({ ok: true, msg: '' }), mem: () => store, memChanged: () => {}, peers: () => [], level: () => null };
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  for (let t = 0; t < 300; t += 5) { rt.run(t ? 5 : 0); rt.takeSerial(); assert.notEqual(rt.state, 'error', `${what} : ${rt.error && rt.error.msg}`); }
}

test('Couverture : chaque composant des catégories utiles a des mesures ou des actions dans les règles (sauf exemptés, justifiés)', () => {
  const lib = LIBRARY.filter(e => CATS.includes(e.cat));
  assert.ok(lib.length > 80, 'catégories de la bibliothèque introuvables');
  const missing = lib.filter(e => !R.SIGNALS[e.id] && !R.ACTIONS[e.id] && !PART_EXEMPT[e.id]).map(e => e.id);
  assert.deepEqual(missing, [], 'composants sans règle');
  for (const [t, why] of Object.entries(PART_EXEMPT)) {
    assert.ok(lib.some(e => e.id === t), `${t} : exempté mais absent de la bibliothèque`);
    assert.ok(!R.SIGNALS[t] && !R.ACTIONS[t] && why, `${t} : exempté mais a des règles`);
  }
  // Les pilotes de moteur exemptés servent à travers le moteur qu'ils alimentent.
  for (const m of ['dcmotor', 'nema17']) assert.ok(R.ACTIONS[m], m);
  // Chaque composant de rules-parts.js sait écrire son code : lecture pour ses mesures, effecteur pour ses actions.
  for (const t of PARTS) {
    if (PART_SIGNALS[t]) assert.equal(typeof (PART_GEN[t] && PART_GEN[t].read), 'function', `${t} : read`);
    if (PART_ACTIONS[t]) assert.equal(typeof (PART_GEN[t] && PART_GEN[t].actor), 'function', `${t} : actor`);
    for (const [k, s] of Object.entries(PART_SIGNALS[t] || {})) assert.ok(s.label && s.v && (!s.kind || ['num', 'bool', 'text', 'time'].includes(s.kind)), `${t}.${k}`);
    for (const [k, a] of Object.entries(PART_ACTIONS[t] || {})) assert.ok(a.label && (!a.arg || a.arg.def != null), `${t}.${k}`);
  }
  // L'écran 20×4 est un écran du cœur (4 lignes).
  assert.ok(R.ACTIONS.lcd2004 && R.ACTIONS.lcd2004.text && R.ACTIONS.lcd2004.value);
});

test('Chaque composant : un programme qui se sert de toutes ses mesures et actions est robuste et tourne dans l’interpréteur (Uno, ESP32)', () => {
  for (const t of [...PARTS, 'lcd2004']) for (const b of ['uno', 'esp32']) {
    const M = bench(b, [t]), what = `${t} sur ${b}`;
    assert.deepEqual(M.errors, [], `${what} : câblage`);
    const code = program(M, [t]);
    robust(code, what);
    interp(code, M.board, what);
  }
});

test('Code produit : erreurs du bus vérifiées, écritures seulement quand elles changent, envois faits une fois, textes en flash sur AVR', () => {
  const code = t => { const M = bench('uno', [t]); return program(M, [t]); };
  // Capteurs I2C : présence vérifiée avant de lire, échec au démarrage compté comme panne.
  for (const t of ['vl53l0x', 'max30102', 'tcs34725', 'ccs811', 'bme680', 'ds3231', 'ds1307']) {
    const c = code(t); assert.match(c, /i2cRepond\(0x[0-9A-F]{2}\)/i, t); assert.match(c, /_echecs = 255;/, t);
  }
  // Extenseurs : la broche commandée par une règle devient une sortie ; écriture en fin de tour si l'image a changé.
  const mcp = code('mcp23017');
  assert.match(mcp, /iox1_gpa1 = bitRead\(iox1_entrees, 1\) == 1;/);
  assert.match(mcp, /broche GPA2 à 1[^\n]*\n\s*\/\/ \(ignorée : une mesure de cette règle n’est pas câblée/, 'broche libre : mesure absente');
  assert.match(mcp, /constexpr uint16_t IOX1_SORTIES = 0x0001; \/\/ broches en sortie \(1\) : GPA0/);
  assert.match(mcp, /if \(iox1_sorties != iox1_envoye && mcpEcrire\(0x20, 0x14, iox1_sorties\)\) iox1_envoye = iox1_sorties;/);
  assert.match(code('hc595'), /if \(u1_sorties != u1_envoye\) \{/);
  // Envoi : une seule fois quand la règle devient vraie ; texte fixe en flash (F) sur AVR.
  const B = bench('uno', ['hc05']), f = variable('f', 'bool', true);
  const bt = B.code([f, rule({ var: f.id }, [act(B.c('BT1'), 'send', 'Bonjour')], [], { op: '==', v: 1 })]);
  assert.match(bt, /if \(!branche\d+\) \{ \/\/ une seule fois[^\n]*\n\s+bt1_port\.println\(F\("Bonjour"\)\);/);
  // Afficheurs : réécrits seulement si l'ordre change.
  assert.match(code('tm1637'), /if \(aff1_ordre != /);
  // Écran TFT : lignes du cœur (texte à sa place, seulement si elle change).
  assert.match(code('st7735'), /tft1\.fillRect\(0, 0, 160, 16, ST77XX_BLACK\);/);
  // Moniteur série : textes comparés en flash (PSTR) sur AVR.
  assert.match(code('rc522'), /strcmp_P\(rfid1_badge, PSTR\("OK"\)\) == 0/);
});

/** Carte d'un montage réel : chaque broche voit les modules qui y sont reliés (comme le panneau de programmation). */
function circuitRun(M, rules, i2c = []) {
  const kind = kindOf(M.board), code = M.code(rules), c = L.compile(code, { board: kind });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const A = M.cx().A, store = { ee: '', prefs: {} };
  const at = key => (M.board.pins[key] ? A.members({ comp: M.board, key }).filter(m => m.comp !== M.board && !/^breadboard/.test(m.comp.type)).map(m => ({ comp: m.comp, pin: m.key })) : []);
  const hw = { kind, label: kind, prof: BOARDS[kind], read: () => null, echo: () => null, at, onPin: (k, types) => { const h = at(k).find(x => types.includes(x.comp.type)); return h ? h.comp : null; },
    data: () => null, bus: types => i2c.filter(d => types.includes(d.comp.type)), i2c: () => i2c, status: () => ({ ok: true, msg: '' }), mem: () => store, memChanged: () => {}, peers: () => [], level: (k, p) => (k.pins && k.pins[p] ? netLevel(A, { comp: k, key: p }) : null) };
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  let out = '';
  return { code, run(ms) { for (let t = 0; t < ms; t += 2) { rt.run(2); out += rt.takeSerial(); assert.notEqual(rt.state, 'error', rt.error && rt.error.msg); } return out; } };
}

test('Interpréteur, montage réel : code infrarouge, badge RFID, touche du clavier, crans de l’encodeur arrivent une seule fois', () => {
  const M = bench('esp32', ['ir', 'rc522', 'keypad', 'ky040']), ir = M.c('IR1'), rf = M.c('RFID1'), kp = M.c('KP1'), enc = M.c('ENC1');
  assert.deepEqual(M.errors, []);
  const say = t => [act('@serial', 'print', t)];
  const S = circuitRun(M, [
    rule({ comp: ir.id, sig: 'code' }, say('IR 69'), [], { op: '==', v: 69 }),
    rule({ comp: rf.id, sig: 'uid' }, say('BADGE BLEU'), [], { op: '==', v: 'DE AD BE EF' }),
    rule({ comp: kp.id, sig: 'key' }, say('TOUCHE 2'), [], { op: '==', v: '2' }),
    rule({ comp: enc.id, sig: 'right' }, say('DROITE'), [], { op: '==', v: 1 }),
    rule({ comp: enc.id, sig: 'left' }, say('GAUCHE'), [], { op: '==', v: 1 })
  ]);
  S.run(100);
  irPress(ir, 0x45); presentBadge(rf, 0); keypadDown(kp, 0, 1); encTurn(enc, 1, 3);
  S.run(150); keypadUp(kp); encTurn(enc, -1, 1);
  const out = S.run(400);
  const count = t => out.split('\n').filter(l => l === t).length;
  assert.equal(count('IR 69'), 1, out);
  assert.equal(count('BADGE BLEU'), 1, out);
  assert.equal(count('TOUCHE 2'), 1, out);
  assert.equal(count('DROITE'), 3, out);
  assert.equal(count('GAUCHE'), 1, out);
});

test('Interpréteur, montage réel : message Bluetooth reçu et réponse, horloge et extenseur lus sur le bus I2C', () => {
  const M = bench('esp32', ['hc05', 'ds3231', 'mcp23017']), bt = M.c('BT1'), rtc = M.c('RTC1'), iox = M.c('IOX1');
  assert.deepEqual(M.errors, []);
  M.wires.push({ a: { comp: iox, key: 'GPA1' }, b: { comp: M.board, key: 'GND' }, progress: 1 });
  const msg = { comp: bt.id, sig: 'line' };
  const S = circuitRun(M, [
    rule(msg, [act(bt, 'send', 'Bien recu'), act('@serial', 'print', 'MESSAGE ON')], [], { op: '==', v: 'ON' }),
    rule({ comp: rtc.id, sig: 'fault' }, [act('@serial', 'print', 'RTC PANNE')], [act('@serial', 'print', 'RTC OK')], { op: '==', v: 1 }),
    rule({ comp: iox.id, sig: 'a1' }, [act('@serial', 'print', 'GPA1 HAUT')], [act('@serial', 'print', 'GPA1 BAS')], { op: '==', v: 1 })
  ], [{ comp: rtc, addr: [0x68] }, { comp: iox, addr: [0x20] }]);
  S.run(100);
  serialDevice(bt).phone('ON');
  const out = S.run(1500);
  assert.match(out, /^MESSAGE ON$/m, out);
  assert.ok(periph(bt).log.some(m => m.who === 'board' && m.text === 'Bien recu'), 'réponse envoyée au téléphone');
  assert.match(out, /^RTC OK$/m); assert.doesNotMatch(out, /RTC PANNE/);
  assert.match(out, /^GPA1 BAS$/m); assert.doesNotMatch(out, /GPA1 HAUT/);
});

/* ---------- Compilation par arduino-cli (-Wall -Wextra) ---------- */
// Montages regroupés pour limiter le nombre de compilations (chaque compilation ESP32 prend une à trois minutes) :
// adresses I2C distinctes, assez de broches et de voies d'adaptateur de niveau sur chaque carte.
const AVR_GROUPS = [
  ['vl53l0x', 'max30102', 'ccs811', 'bme680', 'ds3231', 'at24c256', 'pca9685'], ['tcs34725', 'ds1307', 'mcp23017'], ['pcf8574', 'acs712', 'ir', 'ky040'],
  ['keypad', 'tm1637'], ['rc522', 'nrf24', 'sdcard'], ['st7735'], ['sx1278'], ['ili9341'], ['hc05', 'neo6m', 'max485'], ['sim800', 'hc12'],
  ['max7219m', 'max7219s', 'lcd2004', 'hc595', 'hc165']
];
const ESP_GROUPS = [
  ['vl53l0x', 'max30102', 'ccs811', 'bme680', 'ds3231', 'at24c256', 'pca9685'], ['tcs34725', 'ds1307', 'mcp23017', 'acs712', 'ir', 'ky040', 'hc12'],
  ['pcf8574', 'keypad', 'tm1637', 'lcd2004'], ['max7219m', 'max7219s', 'hc595', 'hc165'], ['rc522', 'nrf24', 'sdcard', 'st7735'], ['sx1278', 'ili9341', 'hc05', 'neo6m'], ['max485', 'sim800']
];
const PLAN = [
  ['uno', AVR_GROUPS], ['esp32', ESP_GROUPS],
  // Nano (ancien chargeur : 30 720 octets de flash) : le montage aux sept capteurs I2C (31,9 Ko) n'y tient pas.
  ['nano', [AVR_GROUPS[1], AVR_GROUPS[4], AVR_GROUPS[8]]],
  ['mega', [['hc05', 'neo6m', 'max485'], ['sim800', 'hc12'], ['rc522', 'nrf24', 'sdcard'], ['tcs34725', 'ds1307', 'mcp23017', 'acs712', 'ir', 'ky040']]],
  ['pico', [ESP_GROUPS[0], ['tcs34725', 'ds1307', 'mcp23017', 'acs712', 'ir', 'ky040'], ['rc522', 'nrf24', 'sdcard', 'st7735'], ['sx1278', 'ili9341', 'hc05', 'neo6m'], ['pcf8574', 'keypad', 'tm1637', 'lcd2004']]]
];
test('arduino-cli : chaque montage compile sans aucun avertissement du croquis (Uno, ESP32 ; Nano, Mega, Pico en partie)', { skip: !hasCli && 'arduino-cli absent' }, () => {
  // Chaque composant est compilé au moins une fois sur Uno et sur ESP32.
  for (const [b, groups] of PLAN.slice(0, 2)) assert.deepEqual(PARTS.filter(t => !groups.flat().includes(t)), [], `${b} : composants jamais compilés`);
  const report = [];
  try {
    for (const [b, groups] of PLAN) for (const g of groups) {
      const M = bench(b, g), what = `${g.join(' + ')} sur ${b}`;
      assert.deepEqual(M.errors, [], `${what} : câblage`);
      const code = program(M, g), r = compile(code, FQBN[b]);
      assert.ok(r.ok, `${what} :\n${r.errors.join('\n')}`);
      assert.deepEqual(r.warnings, [], `${what} : avertissements`);
      report.push(`${b.padEnd(5)} ${g.join(', ')} : ${r.flash} o de flash, ${r.ram} o de RAM`);
    }
  } finally {
    // Dossiers de compilation de ce test (un par carte) : retirés, le disque est compté.
    const C = path.join(os.tmpdir(), 'jollof-rules-cc');
    for (const f of fs.existsSync(C) ? fs.readdirSync(C) : []) if (f.endsWith('_' + process.pid)) fs.rmSync(path.join(C, f), { recursive: true, force: true });
    if (report.length) console.log(report.join('\n'));
  }
});
