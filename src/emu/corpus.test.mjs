// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Corpus du mode fidèle : de vrais programmes Arduino (C++ complet : classes, modèles, pointeurs, registres,
// interruptions, EEPROM, I2C…), compilés par arduino-cli puis exécutés sur l'ATmega328P émulé. Chaque fichier
// de src/emu/corpus/ dit ce qu'il doit écrire sur le port série :
//   // expect: texte attendu        // run-ms: durée simulée (300 par défaut)        // send: texte envoyé (\n permis)
//   // lcd: ligne 1|ligne 2         (un écran LCD I2C à l'adresse 0x27 est branché, et doit afficher ces lignes)
// Sans arduino-cli sur la machine, la suite est ignorée. node --test src/emu/corpus.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAvrRuntime } from './avr.js';
import { BOARDS } from '../sim/boards.js';

const DIR = new URL('./corpus/', import.meta.url);
const hasCli = spawnSync('arduino-cli', ['version']).status === 0;
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.ino')).sort();
const meta = (src, key) => [...src.matchAll(new RegExp(`^//\\s*${key}:\\s*(.*)$`, 'gm'))].map(m => m[1].trim());

test('Corpus de programmes Arduino réels, compilés et émulés', { skip: !hasCli && 'arduino-cli absent' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jollof-corpus-')), failures = [];
  for (const f of files) {
    const name = f.replace(/\.ino$/, ''), src = fs.readFileSync(new URL(f, DIR), 'utf8');
    const sk = path.join(tmp, name), out = path.join(tmp, name + '-build');
    fs.mkdirSync(sk, { recursive: true }); fs.writeFileSync(path.join(sk, name + '.ino'), src);
    const c = spawnSync('arduino-cli', ['compile', '--fqbn', 'arduino:avr:uno', '--output-dir', out, sk], { encoding: 'utf8' });
    if (c.status !== 0) { failures.push(`${f} : ne compile pas\n${(c.stdout + c.stderr).split('\n').filter(l => /error/i.test(l)).slice(0, 3).join('\n')}`); continue; }
    // Modules branchés pour ce programme (faux composants, comme ceux du montage).
    const mods = [];
    if (meta(src, 'lcd').length) mods.push({ comp: { id: 'lcd', type: 'lcd1602', name: 'LCD1' }, addr: [0x27] });
    const hw = {
      prof: BOARDS.uno, kind: 'uno', read: k => (k === 'A0' ? { v: 2.5 } : null),
      bus: types => mods.filter(m => types.includes(m.comp.type)), comps: types => mods.filter(m => types.includes(m.comp.type)).map(m => m.comp),
      at: () => [], data: () => null
    };
    const rt = createAvrRuntime(fs.readFileSync(path.join(out, name + '.ino.hex'), 'utf8'), hw);
    for (const s of meta(src, 'send')) rt.send(s.replace(/\\n/g, '\n'));
    const ms = +(meta(src, 'run-ms')[0] || 300);
    let guard = 0;
    while (rt.clock() < ms && guard++ < 20000) rt.run(16);
    const serial = rt.takeSerial();
    for (const e of meta(src, 'expect')) if (!serial.includes(e)) failures.push(`${f} : attendu « ${e} », reçu ${JSON.stringify(serial.slice(0, 200))}`);
    for (const e of meta(src, 'lcd')) {
      const c = mods.find(m => m.comp.type === 'lcd1602').comp, got = c.progScreen ? c.progScreen.lines.map(l => l.trimEnd()).join('|') : '(rien)';
      if (got !== e) failures.push(`${f} : écran attendu « ${e} », affiché « ${got} »`);
    }
    if (rt.state !== 'run') failures.push(`${f} : état ${rt.state} ${rt.error ? rt.error.msg : ''}`);
  }
  assert.deepEqual(failures, [], failures.join('\n\n'));
  assert.ok(files.length >= 12);
});
