// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Cache des programmes compilés (testkit.mjs, compileSketch) : trois processus compilent le même programme en même temps
// (comme les fichiers de node --test) ; chacun obtient le même .hex complet, sans dossier temporaire laissé derrière.
// Ignoré sans arduino-cli. node --test src/emu/testkit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { hasCli } from './testkit.mjs';

test('compileSketch : compilations simultanées du même programme, résultat identique et complet', { skip: !hasCli && 'arduino-cli absent', timeout: 300000 }, async () => {
  const nonce = `${process.pid}-${Date.now()}`, src = `// essai de concurrence ${nonce}\nvoid setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, !digitalRead(13)); delay(100); }\n`;
  const url = new URL('./testkit.mjs', import.meta.url).href;
  const code = `const m = await import(${JSON.stringify(url)}); const h = m.compileSketch(${JSON.stringify(src)}); process.stdout.write(String(h.length) + ':' + (h.trim().endsWith(':00000001FF') ? 'eof' : 'cut'));`;
  const run = () => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { err += d; });
    c.on('close', st => (st === 0 ? resolve(out) : reject(new Error(err || 'échec'))));
  });
  const res = await Promise.all([run(), run(), run()]);
  assert.equal(new Set(res).size, 1, res.join(' / '));
  assert.match(res[0], /^\d+:eof$/, 'fichier Intel HEX complet');
  const cache = path.join(os.tmpdir(), 'jollof-fw-cache');
  const name = 's' + crypto.createHash('sha1').update('arduino:avr:uno\n' + src).digest('hex').slice(0, 16); // nom donné par compileSketch
  assert.ok(fs.existsSync(path.join(cache, name + '-build', name + '.ino.hex')));
  assert.deepEqual(fs.readdirSync(cache).filter(f => f.startsWith('.' + name)), [], 'aucun dossier temporaire restant');
  fs.rmSync(path.join(cache, name + '-build'), { recursive: true, force: true }); // programme d'essai : pas gardé
});
