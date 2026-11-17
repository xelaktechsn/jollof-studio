// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Corpus de l'ESP32 en mode fidèle : de vrais programmes (vraies bibliothèques de modules), compilés par arduino-cli
// avec la cale (src/emu/esp32-shim), exécutés dans QEMU, en temps réel, avec de faux modules branchés
// (src/emu/esp32-bridge.js → src/emu/devices). Mêmes en-têtes que src/emu/corpus/ (voir corpus.test.mjs), les durées
// comptées depuis setup() ; le programme s'arrête dès que tout ce qui est attendu est arrivé.
// Sans QEMU (JOLLOF_QEMU ou installé par l'application), arduino-cli ou le cœur esp32, la suite est ignorée.
// Un seul fichier : JOLLOF_ESP32_ONLY=nom.ino node --test src/emu/esp32-corpus.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as models from '../sim/models.js';
import { createEsp32Runtime } from './esp32.js';
import { qemuPath, nodeTransport } from './esp32-node.mjs';
import { FQBN } from './boards.js';
import { hasCli, hasEsp32Core, compileSketch, fakeBoard, chipOutFailures, stepFailures, pinFailures, sdFailures, tftFailures, screenFailures } from './testkit.mjs';

const DIR = new URL('./corpus-esp32/', import.meta.url);
const ONLY = process.env.JOLLOF_ESP32_ONLY;
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.ino') && (!ONLY || ONLY.split(',').includes(f))).sort();
const meta = (src, key) => [...src.matchAll(new RegExp(`^//\\s*${key}:\\s*(.*)$`, 'gm'))].map(m => m[1].trim());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const QEMU = qemuPath(), live = !!QEMU && hasCli && hasEsp32Core();

/** Exécute un programme du corpus dans QEMU ; rend la liste de ses échecs (et le port série, pour le journal). */
export async function runEsp32(f, src) {
  const failures = [];
  let image;
  try { image = compileSketch(src, FQBN.esp32); } catch (e) { return { failures: [`${f} : ne compile pas\n${e.message}`], serial: '' }; }
  const modules = meta(src, 'module').map(j => JSON.parse(j));
  const inputs = Object.assign({}, ...meta(src, 'input').map(j => JSON.parse(j)));
  const { hw, comps } = fakeBoard({ kind: 'esp32', modules, inputs });
  // Radios et liaisons du montage (HC-12, RS-485…) : les modules de cette carte s'entendent entre eux.
  hw.peers = types => comps.filter(c => types.includes(c.type)).map(c => ({ comp: c, ok: true }));
  const rt = createEsp32Runtime(image, hw, { transport: nodeTransport({ qemu: QEMU }) });
  const events = meta(src, 'event').map(e => { const [, ms, fn, type, args] = /^(\d+)\s+(\w+)\s+(\S+)\s*(.*)$/.exec(e); return { ms: +ms, fn, type, args: args ? JSON.parse(args) : [] }; }).sort((a, b) => a.ms - b.ms);
  for (const ev of events) if (!comps.find(x => x.type === ev.type) || typeof models[ev.fn] !== 'function') failures.push(`${f} : évènement ${ev.fn} ${ev.type} impossible`);
  const expects = meta(src, 'expect'), runMs = +(meta(src, 'run-ms')[0] || 3000);
  let serial = '', t0 = null, sent = false;
  const wall = Date.now();
  try {
    while (Date.now() - wall < 60000) {
      rt.run(16);
      serial += rt.takeSerial();
      if (rt.state !== 'run') break;
      if (t0 == null && rt.hw.shimReady()) t0 = rt.clock();
      if (t0 != null) {
        const ms = rt.clock() - t0;
        if (!sent && ms > 50) { sent = true; for (const s of meta(src, 'send')) rt.send(s.replace(/\\n/g, '\n')); }
        while (events.length && ms >= events[0].ms) { const ev = events.shift(); const c = comps.find(x => x.type === ev.type); if (c && models[ev.fn]) models[ev.fn](c, ...ev.args); }
        const done = !events.length && expects.every(e => serial.includes(e));
        if (ms >= runMs || (done && ms >= +(meta(src, 'min-ms')[0] || 0))) break;
      }
      await sleep(16);
    }
    for (let i = 0; i < 4; i++) { rt.run(16); await sleep(16); } // dernières trames (écrans, LED)
    serial += rt.takeSerial();
  } finally { rt.stop(); }
  for (const e of expects) if (!serial.includes(e)) failures.push(`${f} : attendu « ${e} », reçu ${JSON.stringify(serial.slice(-600))}`);
  for (const e of meta(src, 'not-expect')) if (serial.includes(e)) failures.push(`${f} : « ${e} » ne devait pas apparaître, reçu ${JSON.stringify(serial.slice(-600))}`);
  for (const e of meta(src, 'lcd')) {
    const c = comps.find(m => m.type === 'lcd1602' || m.type === 'lcd2004'), got = c && c.progScreen ? c.progScreen.lines.map(l => l.trimEnd()).join('|') : '(rien)';
    if (got !== e) failures.push(`${f} : écran attendu « ${e} », affiché « ${got} »`);
  }
  failures.push(...chipOutFailures(f, src, comps), ...stepFailures(f, src, comps), ...pinFailures(f, src, rt), ...sdFailures(f, src, comps), ...tftFailures(f, src, comps), ...screenFailures(f, src, comps));
  // px: {"D25":[[255,0,0],…]} : couleurs reçues par une barrette WS2812 (rec.px de la broche), dans l'ordre.
  for (const [key, want] of meta(src, 'px').flatMap(j => Object.entries(JSON.parse(j)))) {
    const got = (rt.pins.get(key) || {}).px || [];
    if (JSON.stringify(got.slice(0, want.length)) !== JSON.stringify(want)) failures.push(`${f} : LED de ${key} attendues ${JSON.stringify(want)}, reçues ${JSON.stringify(got)}`);
  }
  if (rt.state === 'error') failures.push(`${f} : ${rt.error ? rt.error.msg : 'erreur'}`);
  for (const [k, w] of rt.warnings) if (k === 'panic' || k === 'unbridged') failures.push(`${f} : ${w.msg}`);
  return { failures, serial };
}

for (const f of files) {
  test(`ESP32 dans QEMU : ${f}`, { skip: !live && 'QEMU (JOLLOF_QEMU), arduino-cli ou cœur esp32 absent', timeout: 600000 }, async () => {
    const { failures } = await runEsp32(f, fs.readFileSync(new URL(f, DIR), 'utf8'));
    assert.deepEqual(failures, [], failures.join('\n\n'));
  });
}
