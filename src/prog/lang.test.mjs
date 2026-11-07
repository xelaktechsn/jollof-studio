// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Codes et positions des erreurs du compilateur (comme rustc) : node --test src/prog/lang.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './lang.js';

const err = src => { const r = compile(src, { board: 'uno' }); assert.equal(r.ok, false, 'devrait échouer'); return r.errors[0]; };
const wrap = body => `void setup() {}\nvoid loop() {\n${body}\n}\n`;

test('Nom non déclaré : J1101, soulignement de la longueur du nom, aide séparée', () => {
  const e = err(wrap('  digitalWrite(ledPin, HIGH);'));
  assert.equal(e.code, 'J1101'); assert.equal(e.line, 3); assert.equal(e.col, 16); assert.equal(e.len, 6);
  assert.match(e.title, /ledPin/); assert.equal(e.help, null);
  const m = err(wrap('  pinmode(13, OUTPUT);'));
  assert.equal(m.code, 'J1101'); assert.match(m.help, /pinMode/); assert.ok(!m.title.includes('pinMode'), 'le titre ne répète pas l’aide');
});

test('Point-virgule manquant (J1002) à la fin de la ligne ; type inconnu (J1102) ; arguments (J1103)', () => {
  const a = err(wrap('  int x = 1\n  x++;'));
  assert.equal(a.code, 'J1002'); assert.equal(a.line, 3);
  assert.equal(err('Servox s;\n' + wrap('')).code, 'J1102');
  assert.equal(err(wrap('  digitalWrite(13);')).code, 'J1103');
});

test('setup() absente (J1105), constante modifiée (J1107), return dans une fonction void (J1108), déjà déclaré (J1106)', () => {
  assert.equal(err('void loop() {}').code, 'J1105');
  assert.equal(err('const int L = 3;\n' + wrap('  L = 4;')).code, 'J1107');
  assert.equal(err('void f() { return 3; }\n' + wrap('')).code, 'J1108');
  assert.equal(err(wrap('  int a = 1; int a = 2;')).code, 'J1106');
});

test('Bibliothèque non simulée : avertissement J1109', () => {
  const r = compile('#include <SD.h>\n' + wrap(''), { board: 'esp32' });
  assert.ok(r.warnings.some(w => w.code === 'J1109'));
});
