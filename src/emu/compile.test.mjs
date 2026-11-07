// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Compilation du mode fidèle : erreurs gcc ramenées à la ligne du programme, et, si arduino-cli est installé,
// compilation réelle puis exécution dans l'émulateur. node --test src/emu/compile.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseErrors, compileFirmware } from './compile.js';
import { createAvrRuntime } from './avr.js';
import { BOARDS } from '../sim/boards.js';

test('Erreurs de gcc : ligne, colonne, message ; bibliothèque absente expliquée', () => {
  const t = `/tmp/x/jollof_sketch/jollof_sketch.ino: In function 'void loop()':
/tmp/x/jollof_sketch/jollof_sketch.ino:7:3: error: 'digitalWrit' was not declared in this scope
/tmp/x/jollof_sketch/jollof_sketch.ino:2:10: fatal error: Foo.h: No such file or directory`;
  const e = parseErrors(t);
  assert.equal(e.length, 2);
  assert.deepEqual([e[0].line, e[0].col, e[0].code], [7, 3, 'J1200']);
  assert.match(e[0].msg, /digitalWrit/);
  assert.match(e[1].msg, /Foo\.h/);
});

/** arduino-cli de la machine, dans un dossier temporaire : le même chemin que l'application de bureau. */
const hasCli = spawnSync('arduino-cli', ['version']).status === 0;
function nodeCli() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jollof-')), sketch = path.join(dir, 'sketch', 'jollof_sketch'), build = path.join(dir, 'build', 'jollof_sketch');
  return {
    available: () => true,
    run: async args => { const r = spawnSync('arduino-cli', args, { encoding: 'utf8' }); return { code: r.status, stdout: r.stdout, stderr: r.stderr }; },
    write: async code => { fs.mkdirSync(sketch, { recursive: true }); fs.writeFileSync(path.join(sketch, 'jollof_sketch.ino'), code); return sketch; },
    paths: async () => [sketch, build],
    read: async ext => fs.readFileSync(path.join(build, `jollof_sketch.ino.${ext}`))
  };
}

test('Compilation réelle puis émulation (si arduino-cli est installé)', { skip: !hasCli && 'arduino-cli absent' }, async () => {
  const cli = nodeCli(), logs = [];
  const bad = await compileFirmware('void setup() {}\nvoid loop() { digitalWrit(13, HIGH); }\n', 'uno', m => logs.push(m), cli);
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].line, 2);
  const good = await compileFirmware('void setup() { Serial.begin(9600); Serial.println(F("Bonjour")); pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, !digitalRead(13)); delay(100); }\n', 'uno', m => logs.push(m), cli);
  assert.equal(good.ok, true, JSON.stringify(good.errors));
  const rt = createAvrRuntime(good.hex, { prof: BOARDS.uno, kind: 'uno', read: () => null });
  for (let i = 0; i < 20; i++) rt.run(16);
  assert.match(rt.takeSerial(), /Bonjour/);
});
