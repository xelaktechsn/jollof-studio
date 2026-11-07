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
// Sans arduino-cli sur la machine, la suite est ignorée. node --test src/emu/corpus.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as models from '../sim/models.js';
import { hasCli, compileSketch, fakeBoard, boot, runFor } from './testkit.mjs';

const DIR = new URL('./corpus/', import.meta.url);
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.ino')).sort();
const meta = (src, key) => [...src.matchAll(new RegExp(`^//\\s*${key}:\\s*(.*)$`, 'gm'))].map(m => m[1].trim());

/** Exécute un programme du corpus ; rend la liste de ses échecs. */
export function runCorpus(f, src) {
  const failures = [];
  let hex;
  try { hex = compileSketch(src); } catch (e) { return [`${f} : ne compile pas\n${e.message}`]; }
  const modules = meta(src, 'module').map(j => JSON.parse(j));
  if (meta(src, 'lcd').length && !modules.some(m => m.type === 'lcd1602')) modules.push({ type: 'lcd1602', addr: [0x27] });
  const inputs = Object.assign({ A0: { v: 2.5 } }, ...meta(src, 'input').map(j => JSON.parse(j)));
  const { hw, comps } = fakeBoard({ modules, inputs });
  const rt = boot(hex, hw);
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
  if (rt.state !== 'run') failures.push(`${f} : état ${rt.state} ${rt.error ? rt.error.msg : ''}`);
  return failures;
}

test('Corpus de programmes Arduino réels, compilés et émulés', { skip: !hasCli && 'arduino-cli absent' }, () => {
  const failures = files.flatMap(f => runCorpus(f, fs.readFileSync(new URL(f, DIR), 'utf8')));
  assert.deepEqual(failures, [], failures.join('\n\n'));
  assert.ok(files.length >= 13);
});
