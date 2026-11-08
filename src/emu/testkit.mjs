// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outils des tests du mode fidèle (Node seulement) : compiler un vrai programme avec arduino-cli (avec cache),
// brancher de faux modules sur la carte émulée, faire avancer le temps.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createAvrRuntime } from './avr.js';
import { createRp2040Runtime } from './rp2040.js';
import { BOARDS } from '../sim/boards.js';

export const hasCli = spawnSync('arduino-cli', ['version']).status === 0;
const CACHE = path.join(os.tmpdir(), 'jollof-fw-cache');

/**
 * Compile un programme pour l'Uno (ou fqbn) ; rend le texte du .hex, ou lève une erreur avec les messages de gcc.
 * Pico (fqbn rp2040:…) : rend les octets du .bin (Uint8Array). ESP32 (esp32:…) : la flash entière (.merged.bin),
 * compilée avec la cale de l'émulateur, comme dans l'application.
 */
export function compileSketch(src, fqbn = 'arduino:avr:uno') {
  const esp = fqbn.startsWith('esp32:'), shim = esp ? fs.readFileSync(new URL('./esp32-shim/jollof_qemu_shim.cpp', import.meta.url), 'utf8') : '';
  const h = crypto.createHash('sha1').update(fqbn + '\n' + src + shim).digest('hex').slice(0, 16), name = 's' + h;
  const bin = fqbn.startsWith('rp2040:') || esp, read = f => (bin ? new Uint8Array(fs.readFileSync(f)) : fs.readFileSync(f, 'utf8'));
  const dir = path.join(CACHE, name), out = path.join(CACHE, name + '-build'), hex = path.join(out, name + (esp ? '.ino.merged.bin' : bin ? '.ino.bin' : '.ino.hex'));
  if (fs.existsSync(hex)) return read(hex);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name + '.ino'), src);
  if (esp) fs.writeFileSync(path.join(dir, 'jollof_qemu_shim.cpp'), shim);
  const c = spawnSync('arduino-cli', ['compile', '--fqbn', fqbn, '--output-dir', out, dir], { encoding: 'utf8' });
  if (c.status !== 0) throw new Error((c.stdout + c.stderr).split('\n').filter(l => /error/i.test(l)).slice(0, 5).join('\n') || 'compilation impossible');
  return read(hex);
}
/** Le cœur arduino-pico (rp2040:rp2040) est-il installé ? (demandé à arduino-cli une seule fois) */
let picoCore = null;
export const hasPicoCore = () => (picoCore ??= hasCli && /^rp2040:rp2040\s/m.test(spawnSync('arduino-cli', ['core', 'list'], { encoding: 'utf8' }).stdout || ''));
/** Le cœur arduino-esp32 (esp32:esp32) est-il installé ? */
let espCore = null;
export const hasEsp32Core = () => (espCore ??= hasCli && /^esp32:esp32\s/m.test(spawnSync('arduino-cli', ['core', 'list'], { encoding: 'utf8' }).stdout || ''));

/**
 * Pont factice vers le montage. modules : [{ type, id?, addr?: [0x27], pins?: { DATA: 'D2' }, data?: {…} | () => {…} }]
 * (pins : broche du module → broche de la carte ; data : mesures du capteur, comme c.simR.data). inputs : { A0: { v: 2.5 } }.
 * Rend { hw, comps } ; comps : les faux composants (on y lit progScreen, periph…).
 */
export function fakeBoard({ kind = 'uno', modules = [], inputs = {} } = {}) {
  const comps = modules.map((m, i) => ({ id: m.id || `${m.type}_${i}`, type: m.type, name: (m.type + (i + 1)).toUpperCase(), inp: m.inp || {}, _m: m }));
  const dataOf = c => (typeof c._m.data === 'function' ? c._m.data() : c._m.data || null);
  const hw = {
    prof: BOARDS[kind], kind,
    read: k => inputs[k] || null,
    bus: types => comps.filter(c => types.includes(c.type) && c._m.addr).map(c => ({ comp: c, addr: c._m.addr })),
    comps: types => comps.filter(c => types.includes(c.type)),
    at: key => comps.flatMap(c => Object.entries(c._m.pins || {}).filter(([, b]) => b === key).map(([pin]) => ({ comp: c, pin }))),
    data: c => dataOf(c),
    status: () => ({ ok: true, msg: '' }),
    mem: (() => { const m = { ee: '', prefs: {} }; return () => m; })()
  };
  return { hw, comps };
}

/** Lance le programme (hex de l'Uno, ou .bin du Pico si hw.kind vaut 'pico') sur le pont factice ; rend le moteur. */
export const boot = (hex, hw) => (hw.kind === 'pico' ? createRp2040Runtime(hex, hw) : createAvrRuntime(hex, hw));
/** Fait avancer ms millisecondes de temps virtuel par images de 16 ms. */
export function runFor(rt, ms) { const end = rt.clock() + ms; let g = 0; while (rt.clock() < end && g++ < 50000) rt.run(16); }
