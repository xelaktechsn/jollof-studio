// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Ce que le programme fait de chaque broche, lu dans son texte sans l'exécuter (analyse statique) :
// pinMode, écritures (digitalWrite, analogWrite, tone, servo, ledc), lectures (digitalRead, analogRead,
// pulseIn, interruptions) et broches confiées aux bibliothèques (DHT, OneWire, NeoPixel, Stepper…).
// Les numéros sont résolus : littéraux, #define (déjà développés), constantes de carte (A0, LED_BUILTIN),
// énumérations et variables globales jamais modifiées (const int LED = 7, int led = 7).
// Une broche calculée (boucle, variable modifiée) rend l'analyse « dynamique » : le vérificateur suppose
// alors que toute broche reliée peut être une sortie, à l'état haut comme à l'état bas.
import { parse } from '../prog/lang.js';
import { BOARD_CONSTS, CONSTS } from '../prog/api.js';
import { pinMap } from '../prog/runtime.js';

const AVR = new Set(['uno', 'nano']);
// Broches confiées à une bibliothèque, par classe : [indice de l'argument du constructeur, usage].
const CTOR_PINS = {
  DHT: [[0, 'lib']], OneWire: [[0, 'lib']], Adafruit_NeoPixel: [[1, 'out']],
  Stepper: [[1, 'out'], [2, 'out'], [3, 'out'], [4, 'out']], SoftwareSerial: [[0, 'in'], [1, 'out']],
  MFRC522: [[0, 'out'], [1, 'out']], RF24: [[0, 'out'], [1, 'out']],
  // Keypad(makeKeymap(touches), lignes, colonnes, 4, 4) : tableaux de broches ; lignes en INPUT_PULLUP, colonnes balayées.
  Keypad: [[1, 'rows'], [2, 'cols']]
};
// Sorties confiées à une bibliothèque : elle règle pinMode elle-même (pas d'avertissement « sans pinMode »).
const LIB_WRITE = 'lib';

/** Parcourt tous les nœuds (objets et tableaux) de l'arbre. */
function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const x of node) walk(x, fn); return; }
  if (node.e || node.s || node.kind) fn(node);
  for (const k in node) { const v = node[k]; if (v && typeof v === 'object' && k !== 'ty' && k !== 'quals') walk(v, fn); }
}

/**
 * src : texte du programme ; kind : uno | nano | esp32 | nodemcu | pico ; prof : profil de la carte (boards.js).
 * Rend { ok, error?, pins: Map clé de broche → { modes: Set, writes: Set, reads: Set, lib: bool, at: [{ line, col, what }] },
 *        dynamic, uses: [{ what, line, col, key|null }] }.
 */
export function pinFacts(src, kind, prof) {
  const out = { ok: false, pins: new Map(), dynamic: false, uses: [] };
  if (!src || !src.trim()) { out.ok = true; return out; }
  const p = parse(src, { board: kind });
  if (!p.ok) { out.error = p.error; return out; }
  out.ok = true;
  const consts = { ...CONSTS, ...(BOARD_CONSTS[kind] || {}) }, keys = prof ? pinMap(prof, kind) : new Map();
  // Valeurs connues : énumérations, globales initialisées par une constante et jamais modifiées.
  const known = new Map(), assigned = new Set(), objs = new Map();
  for (const it of p.items) {
    if (it.kind === 'enum') { let v = -1; for (const m of it.members) { v = m.value ? num(m.value) ?? v + 1 : v + 1; known.set(m.name, v); } }
  }
  walk(p.items, n => {
    if ((n.e === 'assign' || n.e === 'pre' || n.e === 'post') && n.a && n.a.e === 'id') assigned.add(n.a.name);
    if (n.kind === 'vars' || n.s === 'vars') for (const d of n.decls) if (d.ty && d.ty.k === 'obj') objs.set(d.name, { cls: d.ty.c, d });
  });
  for (const it of p.items) if (it.kind === 'vars') for (const d of it.decls) if (d.init && !d.dims.length && !assigned.has(d.name)) { const v = num(d.init); if (v != null) known.set(d.name, v); }
  // Tableaux globaux à une dimension initialisés par une liste (broches d'un clavier…).
  const arrays = new Map();
  for (const it of p.items) if (it.kind === 'vars') for (const d of it.decls) if (d.init && d.init.e === 'list' && d.dims.length === 1) arrays.set(d.name, d.init.items);

  function num(e) {
    if (!e) return null;
    if (e.e === 'num') return +e.v;
    if (e.e === 'bool') return e.v ? 1 : 0;
    if (e.e === 'id') return known.has(e.name) ? known.get(e.name) : consts[e.name] != null ? consts[e.name] : null;
    if (e.e === 'un' && e.op === '-') { const v = num(e.a); return v == null ? null : -v; }
    if (e.e === 'cast') return num(e.a);
    if (e.e === 'call' && e.f.e === 'id' && e.f.name === 'digitalPinToInterrupt') return num(e.args[0]);
    return null;
  }
  /** Clé de broche (D7, A0…) d'une expression, ou undefined (calculée) / null (numéro inconnu de la carte). */
  function keyOf(e, what) {
    const n = num(e);
    if (n == null) return undefined;
    const k = AVR.has(kind) && what === 'adc' && n >= 0 && n <= 7 ? keys.get(n + 14) : keys.get(n);
    return k || null;
  }
  const add = (e, at, field, v, what) => {
    const k = keyOf(e, what === 'ar' ? 'adc' : null);
    out.uses.push({ what, line: at.line, col: at.col, key: k ?? null, dyn: k === undefined, value: num(e) });
    if (k === undefined) { out.dynamic = true; return; }
    if (k === null) return; // numéro hors carte : signalé par le vérificateur (uses)
    if (!out.pins.has(k)) out.pins.set(k, { modes: new Set(), writes: new Set(), reads: new Set(), lib: false, at: [] });
    const f = out.pins.get(k);
    if (field === 'lib') f.lib = true; else f[field].add(v);
    f.at.push({ line: at.line, col: at.col, what });
  };
  const MODE = { 0: 'in', 1: 'out', 2: 'pullup', 3: 'pulldown' };
  walk(p.items, n => {
    if (n.e === 'call' && n.f.e === 'id') {
      const a = n.args || [];
      switch (n.f.name) {
        case 'pinMode': { const m = num(a[1]); add(a[0], n, 'modes', m == null ? 'any' : MODE[m] || 'in', 'pinMode'); break; }
        case 'digitalWrite': add(a[0], n, 'writes', 'd', 'digitalWrite'); break;
        case 'analogWrite': add(a[0], n, 'writes', 'pwm', 'analogWrite'); break;
        case 'tone': case 'noTone': add(a[0], n, 'writes', 'tone', n.f.name); break;
        case 'digitalRead': case 'pulseIn': case 'pulseInLong': add(a[0], n, 'reads', 'd', n.f.name); break;
        case 'analogRead': add(a[0], n, 'reads', 'a', 'ar'); break;
        case 'attachInterrupt': add(a[0], n, 'reads', 'd', 'attachInterrupt'); break;
        case 'ledcAttachPin': case 'ledcAttach': add(a[0], n, 'writes', 'pwm', n.f.name); break;
      }
    }
    // Serial2.begin(9600, SERIAL_8N1, 16, 17) (ESP32) : RX lue, TX tenue par le port série.
    if (n.e === 'call' && n.f.e === 'mem' && n.f.name === 'begin' && n.f.o.e === 'id' && /^Serial[12]$/.test(n.f.o.name) && (n.args || []).length >= 4) {
      add(n.args[2], n, 'reads', 'd', n.f.o.name + '.begin'); add(n.args[3], n, 'writes', LIB_WRITE, n.f.o.name + '.begin');
    }
    // IrReceiver.begin(2) : la bibliothèque IRremote lit cette broche.
    if (n.e === 'call' && n.f.e === 'mem' && n.f.name === 'begin' && n.f.o.e === 'id' && n.f.o.name === 'IrReceiver') add((n.args || [])[0], n, 'reads', 'd', 'IrReceiver.begin');
    // servo.attach(9)
    if (n.e === 'call' && n.f.e === 'mem' && n.f.name === 'attach' && n.f.o.e === 'id') {
      const o = objs.get(n.f.o.name);
      if (o && o.cls === 'Servo') add((n.args || [])[0], n, 'writes', 'servo', 'servo.attach');
    }
  });
  // Broches données au constructeur d'une bibliothèque.
  for (const [, o] of objs) {
    // Keypad k(…) ou Keypad k = Keypad(…).
    const args = o.d.ctor || (o.d.init && o.d.init.e === 'new' && o.d.init.cls === o.cls ? o.d.init.args : null);
    const spec = CTOR_PINS[o.cls]; if (!spec || !args) continue;
    for (const [i, use] of spec) {
      const a = args[i]; if (!a) continue;
      if (use === 'rows' || use === 'cols') {
        const list = a.e === 'id' && arrays.get(a.name);
        if (!list) { add(a, o.d.at, 'writes', LIB_WRITE, o.cls); continue; } // tableau inconnu : broches calculées
        for (const el of list) {
          if (use === 'rows') { add(el, o.d.at, 'modes', 'pullup', o.cls); add(el, o.d.at, 'lib', null, o.cls); } else add(el, o.d.at, 'writes', LIB_WRITE, o.cls);
        }
        continue;
      }
      add(a, o.d.at, use === 'lib' ? 'lib' : use === 'in' ? 'reads' : 'writes', use === 'in' ? 'd' : LIB_WRITE, o.cls);
    }
  }
  // Bus matériels utilisés par une bibliothèque (I2C, SPI) : leurs broches sont gérées par elle.
  return out;
}

/** Usage d'une broche résumé pour la vérification : 'out' | 'pullup' | 'pulldown' | 'in' | 'lib' | null (jamais utilisée). */
export function pinRole(f) {
  if (!f) return null;
  if (f.writes.size || f.modes.has('out')) return 'out';
  if (f.modes.has('pullup')) return 'pullup';
  if (f.modes.has('pulldown')) return 'pulldown';
  if (f.lib) return 'lib';
  if (f.reads.size || f.modes.size) return 'in';
  return null;
}
