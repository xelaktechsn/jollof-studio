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
import { BOARDS } from '../sim/boards.js';

export const hasCli = spawnSync('arduino-cli', ['version']).status === 0;
const CACHE = path.join(os.tmpdir(), 'jollof-fw-cache');

/** Compile un programme pour l'Uno (ou fqbn) ; rend le texte du .hex, ou lève une erreur avec les messages de gcc. */
export function compileSketch(src, fqbn = 'arduino:avr:uno') {
  const h = crypto.createHash('sha1').update(fqbn + '\n' + src).digest('hex').slice(0, 16), name = 's' + h;
  const dir = path.join(CACHE, name), out = path.join(CACHE, name + '-build'), hex = path.join(out, name + '.ino.hex');
  if (fs.existsSync(hex)) return fs.readFileSync(hex, 'utf8');
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name + '.ino'), src);
  const c = spawnSync('arduino-cli', ['compile', '--fqbn', fqbn, '--output-dir', out, dir], { encoding: 'utf8' });
  if (c.status !== 0) throw new Error((c.stdout + c.stderr).split('\n').filter(l => /error/i.test(l)).slice(0, 5).join('\n') || 'compilation impossible');
  return fs.readFileSync(hex, 'utf8');
}

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

/** Lance le programme (hex) sur le pont factice ; rend le moteur. */
export const boot = (hex, hw) => createAvrRuntime(hex, hw);
/** Fait avancer ms millisecondes de temps virtuel par images de 16 ms. */
export function runFor(rt, ms) { const end = rt.clock() + ms; let g = 0; while (rt.clock() < end && g++ < 50000) rt.run(16); }
