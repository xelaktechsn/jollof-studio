// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Corpus du mode fidèle : de vrais programmes Arduino (C++ complet : classes, modèles, pointeurs, registres,
// interruptions, EEPROM, I2C, bibliothèques de modules…), compilés par arduino-cli puis exécutés sur l'ATmega328P
// émulé, avec de faux modules branchés. Chaque fichier de src/emu/corpus/ dit ce qu'il attend :
//   // expect: texte attendu sur le port série       // not-expect: texte qui ne doit pas y être
//   // run-ms: durée simulée (300 par défaut)          // send: texte envoyé au port série (\n permis)
//   // lcd: ligne 1|ligne 2       (un écran LCD I2C à l'adresse 0x27 est branché, et doit afficher ces lignes)
//   // module: {"type":"dht22","pins":{"DATA":"D2"},"data":{"t":24.5,"h":61}}   (module branché, voir testkit.fakeBoard)
//   // input: {"D2":{"d":1}}      (niveau imposé par le montage : résistance de tirage, bouton…)
//   // event: 400 keypadDown keypad [1,2]   (à 400 ms, fonction de sim/models.js appliquée au module de ce type)
//   // chip-out: {"type":"hc595","Q0":1,"PWM0":{"servo":[85,95]}}   (sorties d'une puce logique, sim/chips.js : niveau,
//      ou plage du rapport cyclique « duty » ou de l'angle de servo « servo »)
//   // pin: {"D44":{"pwm":[0.24,0.26]},"D13":{"d":1}}   (état d'une broche de la carte en fin d'exécution : niveau d, plage
//      du rapport cyclique pwm, de la fréquence freq de tone() ou de l'angle servo)
//   // loopback: Serial1   (fil entre TX et RX de ce port série : chaque octet envoyé revient)
// Corpus du Mega 2560 (ATmega2560, arduino:avr:mega) : src/emu/corpus-mega/, mêmes en-têtes.
// Sans arduino-cli sur la machine, la suite est ignorée. node --test src/emu/corpus.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as models from '../sim/models.js';
import { hasCli, compileSketch, fakeBoard, boot, runFor, chipOutFailures, stepFailures, pinFailures, sdFailures, tftFailures, screenFailures } from './testkit.mjs';

const DIR = new URL('./corpus/', import.meta.url), MEGA_DIR = new URL('./corpus-mega/', import.meta.url);
const inos = dir => fs.readdirSync(dir).filter(f => f.endsWith('.ino')).sort();
const files = inos(DIR);
const meta = (src, key) => [...src.matchAll(new RegExp(`^//\\s*${key}:\\s*(.*)$`, 'gm'))].map(m => m[1].trim());

/** Exécute un programme du corpus (sur l'Uno, ou kind : 'mega' et son fqbn) ; rend la liste de ses échecs. */
export function runCorpus(f, src, { kind = 'uno', fqbn = 'arduino:avr:uno' } = {}) {
  const failures = [];
  let hex;
  try { hex = compileSketch(src, fqbn); } catch (e) { return [`${f} : ne compile pas\n${e.message}`]; }
  const modules = meta(src, 'module').map(j => JSON.parse(j));
  if (meta(src, 'lcd').length && !modules.some(m => m.type === 'lcd1602')) modules.push({ type: 'lcd1602', addr: [0x27] });
  const inputs = Object.assign({ A0: { v: 2.5 } }, ...meta(src, 'input').map(j => JSON.parse(j)));
  const { hw, comps } = fakeBoard({ kind, modules, inputs });
  const rt = boot(hex, hw);
  for (const name of meta(src, 'loopback')) { const U = rt.hw.uarts[name]; if (!U) failures.push(`${f} : pas de port ${name}`); else U.onTx(b => U.inject([b])); }
  for (const s of meta(src, 'send')) rt.send(s.replace(/\\n/g, '\n'));
  const events = meta(src, 'event').map(e => { const [, ms, fn, type, args] = /^(\d+)\s+(\w+)\s+(\S+)\s*(.*)$/.exec(e); return { ms: +ms, fn, type, args: args ? JSON.parse(args) : [] }; }).sort((a, b) => a.ms - b.ms);
  const ms = +(meta(src, 'run-ms')[0] || 300);
  for (const ev of events) {
    runFor(rt, ev.ms - rt.clock());
    const c = comps.find(x => x.type === ev.type);
    if (!c || typeof models[ev.fn] !== 'function') { failures.push(`${f} : évènement ${ev.fn} ${ev.type} impossible`); continue; }
    models[ev.fn](c, ...ev.args);
  }
  runFor(rt, ms - rt.clock());
  const serial = rt.takeSerial();
  for (const e of meta(src, 'expect')) if (!serial.includes(e)) failures.push(`${f} : attendu « ${e} », reçu ${JSON.stringify(serial.slice(0, 300))}`);
  for (const e of meta(src, 'not-expect')) if (serial.includes(e)) failures.push(`${f} : « ${e} » ne devait pas apparaître, reçu ${JSON.stringify(serial.slice(0, 300))}`);
  for (const e of meta(src, 'lcd')) {
    const c = comps.find(m => m.type === 'lcd1602'), got = c.progScreen ? c.progScreen.lines.map(l => l.trimEnd()).join('|') : '(rien)';
    if (got !== e) failures.push(`${f} : écran attendu « ${e} », affiché « ${got} »`);
  }
  failures.push(...chipOutFailures(f, src, comps));
  failures.push(...stepFailures(f, src, comps), ...pinFailures(f, src, rt), ...sdFailures(f, src, comps), ...tftFailures(f, src, comps), ...screenFailures(f, src, comps));
  for (const [key, want] of meta(src, 'pin').flatMap(j => Object.entries(JSON.parse(j)))) {
    const p = rt.pins.get(key), show = JSON.stringify(p && { mode: p.mode, d: p.d, pwm: p.pwm, freq: p.freq, servo: p.servo });
    for (const [q, v] of Object.entries(want)) {
      const ok = p && (Array.isArray(v) ? p[q] >= v[0] && p[q] <= v[1] : p[q] === v);
      if (!ok) failures.push(`${f} : broche ${key}.${q} attendue ${JSON.stringify(v)}, obtenue ${show}`);
    }
  }
  if (rt.state !== 'run') failures.push(`${f} : état ${rt.state} ${rt.error ? rt.error.msg : ''}`);
  return failures;
}

test('Corpus de programmes Arduino réels, compilés et émulés', { skip: !hasCli && 'arduino-cli absent' }, () => {
  const failures = files.flatMap(f => runCorpus(f, fs.readFileSync(new URL(f, DIR), 'utf8')));
  assert.deepEqual(failures, [], failures.join('\n\n'));
  assert.ok(files.length >= 13);
});

test('Corpus du Mega 2560 (ATmega2560) : minuteries 3 à 5, Serial1 à 3, A8 à A15, INT4/5, EEPROM de 4 Ko', { skip: !hasCli && 'arduino-cli absent' }, () => {
  const megaFiles = inos(MEGA_DIR);
  const failures = megaFiles.flatMap(f => runCorpus(f, fs.readFileSync(new URL(f, MEGA_DIR), 'utf8'), { kind: 'mega', fqbn: 'arduino:avr:mega' }));
  assert.deepEqual(failures, [], failures.join('\n\n'));
  assert.ok(megaFiles.length >= 10);
});
