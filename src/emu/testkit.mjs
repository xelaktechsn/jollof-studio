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
import { chipOut } from '../sim/chips.js';
import { tftHex } from '../sim/tft.js';
import { sdStore } from '../sim/sdcard.js';
import { syncCard } from './devices/sdcard.js';
import { ESP32_LINK_PROPERTY } from './esp32-wraps.js';

export const hasCli = spawnSync('arduino-cli', ['version']).status === 0;
const CACHE = path.join(os.tmpdir(), 'jollof-fw-cache');

/**
 * Compile un programme pour l'Uno (ou fqbn : arduino:avr:mega pour le Mega 2560…) ; rend le texte du .hex, ou lève une
 * erreur avec les messages de gcc.
 * Pico (fqbn rp2040:…) : rend les octets du .bin (Uint8Array). ESP32 (esp32:…) : la flash entière (.merged.bin),
 * compilée avec la cale de l'émulateur, comme dans l'application.
 */
export function compileSketch(src, fqbn = 'arduino:avr:uno') {
  const esp = fqbn.startsWith('esp32:'), shim = esp ? fs.readFileSync(new URL('./esp32-shim/jollof_qemu_shim.cpp', import.meta.url), 'utf8') : '';
  const h = crypto.createHash('sha1').update(fqbn + '\n' + src + shim + (esp ? ESP32_LINK_PROPERTY : '')).digest('hex').slice(0, 16), name = 's' + h;
  const bin = fqbn.startsWith('rp2040:') || esp, read = f => (bin ? new Uint8Array(fs.readFileSync(f)) : fs.readFileSync(f, 'utf8'));
  const dir = path.join(CACHE, name), out = path.join(CACHE, name + '-build'), hex = path.join(out, name + (esp ? '.ino.merged.bin' : bin ? '.ino.bin' : '.ino.hex'));
  if (fs.existsSync(hex)) return read(hex);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name + '.ino'), src);
  if (esp) fs.writeFileSync(path.join(dir, 'jollof_qemu_shim.cpp'), shim);
  const c = spawnSync('arduino-cli', ['compile', '--fqbn', fqbn, ...(esp ? ['--build-property', ESP32_LINK_PROPERTY] : []), '--output-dir', out, dir], { encoding: 'utf8' });
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
 * Pont factice vers le montage. modules : [{ type, id?, addr?: [0x27], pins?: { DATA: 'D2' }, data?: {…} | () => {…},
 * levels?: { D0: 0 }, links?: { DOUT: [['id', 'DIN']] }, mem?: {…} }] (levels : niveau du montage sur des broches du module que la carte ne commande pas)
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
    node: (c, k) => (c._m.levels && c._m.levels[k] != null ? c._m.levels[k] : null),
    status: () => ({ ok: true, msg: '' }),
    mem: (() => { const m = { ee: '', prefs: {} }; return () => m; })(),
    /** Mémoire gardée avec le projet d'un module (m.mem : contenu de départ). */
    compMem: c => c._mem || (c._mem = c._m.mem || {}),
    memChanged: () => {},
    /** Broches reliées à celle du module : m.links = { DOUT: [["max7219m_1", "DIN"]] } (id du module, broche). */
    linked: (c, k) => ((c._m.links && c._m.links[k]) || []).map(([id, key]) => ({ comp: comps.find(x => x.id === id), key })).filter(x => x.comp)
  };
  return { hw, comps };
}

/**
 * Lance le programme (hex de l'Uno ou du Mega, .bin du Pico si hw.kind vaut 'pico') sur le pont factice ; rend le moteur.
 * Le processeur AVR se déduit de hw.kind : ATmega2560 pour 'mega', ATmega328P sinon.
 */
export const boot = (hex, hw) => (hw.kind === 'pico' ? createRp2040Runtime(hex, hw) : createAvrRuntime(hex, hw));
/** Fait avancer ms millisecondes de temps virtuel par images de 16 ms. */
export function runFor(rt, ms) { const end = rt.clock() + ms; let g = 0; while (rt.clock() < end && g++ < 50000) rt.run(16); }
/**
 * En-têtes « // chip-out: {"type":"hc595","Q0":1,"PWM0":{"servo":[85,95]}} » d'un programme du corpus : sorties d'une
 * puce logique (sim/chips.js), niveau attendu ou plage d'une grandeur (duty, servo, freq). Rend la liste des échecs.
 */
export function chipOutFailures(f, src, comps) {
  const failures = [];
  for (const m of src.matchAll(/^\/\/\s*chip-out:\s*(.*)$/gm)) {
    const want = JSON.parse(m[1]), c = comps.find(x => x.type === want.type);
    for (const [k, v] of Object.entries(want)) {
      if (k === 'type') continue;
      const o = c ? chipOut(c, k) : null, show = JSON.stringify(o);
      if (typeof v === 'number') { if (!o || o.d !== v) failures.push(`${f} : ${want.type} ${k} attendu ${v}, obtenu ${show}`); continue; }
      for (const [q, [lo, hi]] of Object.entries(v)) if (!o || !(o[q] >= lo && o[q] <= hi)) failures.push(`${f} : ${want.type} ${k}.${q} attendu entre ${lo} et ${hi}, obtenu ${show}`);
    }
  }
  return failures;
}
/**
 * En-têtes « // step: {"type":"a4988","steps":200,"rotor":[199,201],"lost":0} » : état d'un pilote pas à pas
 * (sim/motordrv.js, comp.stepState) après le programme, valeur exacte ou plage. Rend la liste des échecs.
 */
export function stepFailures(f, src, comps) {
  const failures = [];
  for (const m of src.matchAll(/^\/\/\s*step:\s*(.*)$/gm)) {
    const want = JSON.parse(m[1]), c = comps.find(x => x.type === want.type), s = c && c.stepState, show = JSON.stringify(s && { steps: s.steps, pos: s.pos, rotor: s.rotor, lost: s.lost, div: s.div });
    for (const [k, v] of Object.entries(want)) {
      if (k === 'type') continue;
      const x = s ? s[k] : undefined;
      if (Array.isArray(v) ? !(x >= v[0] && x <= v[1]) : x !== v) failures.push(`${f} : ${want.type} ${k} attendu ${JSON.stringify(v)}, obtenu ${show}`);
    }
  }
  return failures;
}
/**
 * En-têtes « // pin: {"D5":{"pwm":[0.78,0.79]},"D7":{"d":1}} » : état d'une broche de la carte après le programme
 * (mode, niveau, rapport cyclique de la PWM). Rend la liste des échecs.
 */
export function pinFailures(f, src, rt) {
  const failures = [];
  for (const m of src.matchAll(/^\/\/\s*pin:\s*(.*)$/gm)) {
    for (const [key, want] of Object.entries(JSON.parse(m[1]))) {
      const p = rt.pins.get(key), show = JSON.stringify(p && { mode: p.mode, d: p.d, pwm: p.pwm });
      for (const [k, v] of Object.entries(want)) {
        const x = p ? p[k] : undefined;
        if (Array.isArray(v) ? !(x >= v[0] && x <= v[1]) : x !== v) failures.push(`${f} : broche ${key} ${k} attendu ${JSON.stringify(v)}, obtenu ${show}`);
      }
    }
  }
  return failures;
}
/**
 * En-têtes « // sd: {"/LOG.TXT":"ligne 1\r\n","/VIEUX.TXT":null} » : fichiers de la carte SD gardés avec le projet après
 * le programme (texte exact, ou null : absent). Rend la liste des échecs.
 */
export function sdFailures(f, src, comps) {
  const failures = [];
  for (const m of src.matchAll(/^\/\/\s*sd:\s*(.*)$/gm)) {
    const c = comps.find(x => x.type === 'sdcard');
    if (!c) { failures.push(`${f} : pas de carte SD`); continue; }
    const mem = c._mem || (c._mem = c._m.mem || {});
    syncCard(c, mem);
    const st = sdStore(mem);
    for (const [p, want] of Object.entries(JSON.parse(m[1]))) {
      const x = st.files.get(p), got = x ? new TextDecoder().decode(x.data.subarray(0, x.len)) : null;
      if (got !== want) failures.push(`${f} : fichier ${p} attendu ${JSON.stringify(want)}, trouvé ${JSON.stringify(got)}`);
    }
  }
  return failures;
}

/**
 * En-têtes « // tft: {"type":"st7735","on":true,"px":[[0,0,"#ff0000"],[127,159,"#0000ff"]]} » : image publiée par un écran
 * TFT (sim/tft.js) après le programme. x, y : pixel de l'image publiée, l'écran tenu en portrait (0, 0 en haut à gauche,
 * comme la rotation 0 d'Adafruit) ; couleur « #rrggbb » telle qu'affichée (RGB565 étendu à 8 bits). Rend les échecs.
 */
export function tftFailures(f, src, comps) {
  const failures = [];
  for (const m of src.matchAll(/^\/\/\s*tft:\s*(.*)$/gm)) {
    const want = JSON.parse(m[1]), c = comps.find(x => x.type === want.type), s = c && c.progScreen;
    if (!s || !s.rgb) { failures.push(`${f} : écran ${want.type} : aucune image publiée`); continue; }
    if (want.on != null && s.on !== want.on) failures.push(`${f} : écran ${want.type} allumé attendu ${want.on}, obtenu ${s.on}`);
    for (const [x, y, col] of want.px || []) { const got = tftHex(s, x, y); if (got !== col.toLowerCase()) failures.push(`${f} : écran ${want.type} pixel (${x}, ${y}) attendu ${col}, obtenu ${got}`); }
  }
  return failures;
}
/**
 * En-têtes « // screen: {"type":"tm1637","text":"12:34","on":true} » (ou "id" pour un module précis) : ce que publie
 * un afficheur (comp.progScreen) après le programme : texte, allumé, lignes d'un LCD, lignes d'une matrice (mat).
 * Rend la liste des échecs.
 */
export function screenFailures(f, src, comps) {
  const failures = [];
  for (const m of src.matchAll(/^\/\/\s*screen:\s*(.*)$/gm)) {
    const want = JSON.parse(m[1]), c = comps.find(x => (want.id ? x.id === want.id : x.type === want.type)), ps = c && c.progScreen;
    for (const [k, v] of Object.entries(want)) {
      if (k === 'type' || k === 'id') continue;
      let got = ps ? ps[k] : undefined;
      if (k === 'lines' && Array.isArray(got)) got = got.map(l => l.trimEnd());
      if (got && typeof got === 'object') got = Array.from(got);
      if (JSON.stringify(got) !== JSON.stringify(v)) failures.push(`${f} : ${want.id || want.type} ${k} attendu ${JSON.stringify(v)}, obtenu ${JSON.stringify(got)}`);
    }
  }
  return failures;
}
