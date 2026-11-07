// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modules à signaux temporisés du mode fidèle (WS2812B, clavier matriciel, récepteur infrarouge NEC).
// 1. Sans arduino-cli : chaque modèle branché sur une fausse carte (fronts et horloge simulés à la main).
// 2. Avec arduino-cli : les croquis NeoPixel du corpus (src/emu/corpus/neopixel_*.ino) et quelques variantes tournent
//    sur l'ATmega328P émulé et dans l'interpréteur : les couleurs publiées (rec.px) doivent être les mêmes, à
//    l'arrondi près de setBrightness() (la bibliothèque calcule en entiers, l'interpréteur en réels).
// node --test src/emu/devices/pinio.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ws2812 from './ws2812.js';
import keypad from './keypad.js';
import irnec from './irnec.js';
import { keypadDown, keypadUp, irPress } from '../../sim/models.js';
import { hasCli, compileSketch, fakeBoard, boot, runFor } from '../testkit.mjs';
import { compile } from '../../prog/lang.js';
import { createRuntime } from '../../prog/runtime.js';
import { BOARDS } from '../../sim/boards.js';

/**
 * Fausse carte pour un modèle : wires (broche du module → clé), lignes avec mode (0 entrée, 1 sortie, 2 tirage),
 * niveau de sortie et niveau imposé par le module, horloge en cycles (16 MHz) et évènements d'horloge.
 */
function bench(wires) {
  const L = new Map(), subs = new Map(), queue = [];
  let now = 0;
  const line = k => { if (!L.has(k)) L.set(k, { mode: 0, out: 0, dev: null, rec: { mode: 0, px: null }, lv: 0 }); return L.get(k); };
  const level = x => (x.mode === 1 ? x.out : x.dev != null ? +x.dev : x.mode === 2 ? 1 : 0);
  const sync = k => { const x = line(k), lv = level(x); x.rec.mode = x.mode; if (lv !== x.lv) { x.lv = lv; for (const fn of (subs.get(k) || []).slice()) fn(lv, now); } };
  const io = {
    MHZ: 16e6,
    pin: p => wires[p] || null,
    level: k => line(k).lv,
    onEdge(k, fn) { if (!subs.has(k)) subs.set(k, []); subs.get(k).push(fn); return () => subs.get(k).splice(subs.get(k).indexOf(fn), 1); },
    drive(k, v) { line(k).dev = v == null ? null : !!v; sync(k); },
    after(c, fn) { queue.push({ at: now + Math.max(1, Math.round(c)), fn }); queue.sort((a, b) => a.at - b.at); },
    rec: k => line(k).rec,
    now: () => now,
    us: n => n * 16
  };
  return {
    io,
    /** Le programme : mode et niveau de sortie d'une broche, au cycle courant. */
    set(k, mode, out = 0) { const x = line(k); x.mode = mode; x.out = out; sync(k); },
    level: k => line(k).lv,
    /** Avance l'horloge de c cycles (évènements compris). */
    tick(c) { const end = now + c; while (queue.length && queue[0].at <= end) { const e = queue.shift(); now = e.at; e.fn(); } now = end; },
    get now() { return now; }, set now(v) { now = v; }
  };
}

/** Octets envoyés sur DIN comme la bibliothèque à 16 MHz : 20 cycles par bit, impulsion haute de 5 (0) ou 13 (1). */
function sendBytes(b, key, bytes) {
  for (const v of bytes) for (let i = 7; i >= 0; i--) {
    const hi = (v >> i) & 1 ? 13 : 5;
    b.set(key, 1, 1); b.now += hi; b.set(key, 1, 0); b.now += 20 - hi;
  }
}

test('WS2812B : bits lus à la largeur des impulsions, GRB → RGB, reset, trames multiples, bits en trop', () => {
  const b = bench({ DIN: 'D6' }), dev = ws2812.create({ type: 'ws2812' }, b.io);
  b.set('D6', 1, 0);
  sendBytes(b, 'D6', [0x00, 0xff, 0x00, 0x80, 0x01, 0x7f]); // LED 0 rouge, LED 1 (G=0x80, R=1, B=0x7f)
  b.now += 16 * 20; dev.frame();
  assert.equal(b.io.rec('D6').px, null, 'pas de reset de 50 µs : rien n’est encore affiché');
  b.now += 16 * 40; dev.frame();
  assert.deepEqual(b.io.rec('D6').px, [[255, 0, 0], [1, 128, 127]]);
  // Trois trames dans la même tranche : la dernière reste ; LED 1 incomplète (16 bits) : elle garde sa couleur.
  sendBytes(b, 'D6', [1, 2, 3]); b.now += 16 * 80;
  sendBytes(b, 'D6', [0x10, 0x20, 0x30]); b.now += 16 * 80;
  sendBytes(b, 'D6', [0, 0, 9, 7, 7]); b.now += 16 * 80; dev.frame();
  assert.deepEqual(b.io.rec('D6').px, [[0, 0, 9], [1, 128, 127]]);
  // Dix LED envoyées à une barrette de huit : les bits en trop la traversent.
  sendBytes(b, 'D6', Array.from({ length: 30 }, (_, i) => i)); b.now += 16 * 80; dev.frame();
  const px = b.io.rec('D6').px;
  assert.equal(px.length, 8);
  assert.deepEqual(px[7], [22, 21, 23]);
  dev.dispose();
});

test('Clavier 4×4 : la touche recopie le niveau du côté en sortie, dans les deux sens de balayage', () => {
  const wires = { R1: 'D9', R2: 'D8', R3: 'D7', R4: 'D6', C1: 'D5', C2: 'D4', C3: 'D3', C4: 'D2' };
  const b = bench(wires), comp = { type: 'keypad' }, dev = keypad.create(comp, b.io);
  ['D9', 'D8', 'D7', 'D6'].forEach(k => b.set(k, 2)); // lignes en INPUT_PULLUP, colonnes en entrée (Keypad)
  keypadDown(comp, 1, 2); dev.frame(); // touche « 6 » : R2 (D8) et C3 (D3)
  assert.equal(b.level('D3'), 1, 'colonne en entrée : tirée à HIGH par la ligne');
  b.set('D3', 1, 0);
  assert.equal(b.level('D8'), 0, 'colonne à LOW : la ligne lit LOW au même cycle');
  assert.equal(b.level('D9'), 1);
  b.set('D3', 1, 1); assert.equal(b.level('D8'), 1);
  b.set('D3', 0); assert.equal(b.level('D8'), 1);
  b.set('D4', 1, 0); assert.equal(b.level('D8'), 1, 'autre colonne : la ligne reste haute');
  b.set('D4', 0);
  // Sens inverse : lignes en sortie, colonnes en INPUT_PULLUP.
  ['D9', 'D8', 'D7', 'D6'].forEach(k => b.set(k, 1, 1)); ['D5', 'D4', 'D3', 'D2'].forEach(k => b.set(k, 2));
  b.set('D8', 1, 0); assert.equal(b.level('D3'), 0);
  keypadUp(comp); dev.frame();
  assert.equal(b.level('D3'), 1, 'touche relâchée : la colonne reprend son tirage');
  dev.dispose();
});

test('Récepteur NEC : durées de la trame, répétition 110 ms après le début, appuis en file sans chevauchement', () => {
  const b = bench({ OUT: 'D2' }), comp = { type: 'ir' }, dev = irnec.create(comp, b.io), log = [];
  b.io.onEdge('D2', (lv, cyc) => log.push([lv, cyc / 16]));
  assert.equal(b.level('D2'), 1, 'repos : HIGH');
  irPress(comp, 0x45); irPress(comp, 0x45, true); irPress(comp, 0x16); dev.frame();
  b.tick(16 * 1e6);
  const marks = log.filter(e => e[0] === 0).map(e => e[1]);
  const durs = log.slice(1).map((e, i) => e[1] - log[i][1]);
  assert.equal(log.length, 2 * (34 + 2 + 34), 'trois trames : 34 salves, 2 salves, 34 salves');
  assert.deepEqual(durs.slice(0, 2), [9000, 4500]);
  const bits = []; for (let i = 0; i < 32; i++) { assert.equal(durs[2 + 2 * i], 562.5); bits.push(durs[3 + 2 * i] > 1000 ? 1 : 0); }
  const word = bits.reduce((w, x, i) => w + x * 2 ** i, 0);
  assert.equal(word, 0xba45ff00);
  assert.equal(marks[34] - marks[0], 110000, 'répétition 110 ms après le début de la trame');
  assert.deepEqual(durs.slice(68, 70), [9000, 2250]);
  assert.ok(marks[36] - (marks[35] + 562.5) >= 80000, 'nouvel appui à plus de 70 ms de la trame précédente');
  assert.equal(log[log.length - 1][0], 1, 'retour au repos');
  dev.dispose();
});

/** Carte de l'interpréteur réduite au strict nécessaire pour la bibliothèque NeoPixel. */
const interp = src => {
  const c = compile(src, { board: 'uno' });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const rt = createRuntime(c.js, { kind: 'uno', label: 'uno', prof: BOARDS.uno, read: () => null, at: () => [], onPin: () => null }, { globals: c.globals });
  for (let i = 0; i < 19; i++) rt.run(16); // ≈ 300 ms, comme emulate()
  return rt;
};
const emulate = src => {
  const { hw } = fakeBoard({ modules: [{ type: 'ws2812', pins: { DIN: 'D6' } }] });
  const rt = boot(compileSketch(src), hw);
  runFor(rt, 300);
  assert.equal(rt.state, 'run', rt.error && rt.error.msg);
  return rt;
};
/** Mêmes couleurs, à moins d'une unité près (arrondi de setBrightness). */
function samePx(got, want, what) {
  assert.ok(Array.isArray(got), `${what} : aucune couleur publiée`);
  assert.equal(got.length, want.length, `${what} : ${JSON.stringify(got)} au lieu de ${JSON.stringify(want)}`);
  got.forEach((q, i) => q.forEach((v, j) => assert.ok(Math.abs(v - want[i][j]) <= 1, `${what} : LED ${i} ${JSON.stringify(q)} au lieu de ${JSON.stringify(want[i])}`)));
}

const DIR = new URL('../corpus/', import.meta.url);
const VARIANTS = [
  ['NEO_RGB, 3 LED', `#include <Adafruit_NeoPixel.h>
Adafruit_NeoPixel leds(3, 6, NEO_RGB + NEO_KHZ800);
void setup() { leds.begin(); leds.setPixelColor(0, leds.Color(255, 0, 0)); leds.setPixelColor(2, 1, 2, 3); leds.show(); }
void loop() {}`],
  ['animation dans loop()', `#include <Adafruit_NeoPixel.h>
Adafruit_NeoPixel leds(8, 6, NEO_GRB + NEO_KHZ800);
int i = 0;
void setup() { leds.begin(); leds.setBrightness(128); }
void loop() { if (i < 8) { leds.setPixelColor(i, leds.Color(200, 100 + i, 3 * i)); leds.show(); i++; delay(10); } }`]
];

test('NeoPixel : couleurs reçues par la barrette émulée = couleurs de l’interpréteur', { skip: !hasCli && 'arduino-cli absent' }, () => {
  const files = fs.readdirSync(DIR).filter(f => /^neopixel_.*\.ino$/.test(f)).sort();
  assert.ok(files.length >= 2);
  const cases = [...files.map(f => [f, fs.readFileSync(new URL(f, DIR), 'utf8')]), ...VARIANTS];
  for (const [what, src] of cases) samePx(emulate(src).pins.get('D6').px, interp(src).pins.get('D6').px, what);
});
