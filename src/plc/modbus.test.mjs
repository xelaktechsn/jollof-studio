// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Plan des adresses Modbus de l'automate : node --test src/plc/modbus.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const i18n = await import('../i18n/index.js');
await i18n.loadLanguage();
const { compilePlc, lintPlc, createPlcRun, scanPlc } = await import('./ladder.js');
const { modbusMap, modbusImage, MB } = await import('./modbus.js');

const prog = {
  name: 'API1', drive: true, cycle: 10, inputs: [{ name: 'dcy', kind: 'push' }, { name: 'arret', kind: 'push' }],
  rungs: [
    { id: 'r1', comment: '', items: [{ t: 'par', id: 'p', branches: [[{ t: 'no', id: 'a', v: 'dcy' }], [{ t: 'no', id: 'b', v: 'KM' }]] }, { t: 'nc', id: 'c', v: 'arret' }, { t: 'coil', id: 'd', v: 'KM' }] },
    { id: 'r2', comment: '', items: [{ t: 'no', id: 'e', v: 'KM' }, { t: 'ton', id: 'f', v: 'T1', pt: 2 }, { t: 'coil', id: 'g', v: 'Y1' }] },
    { id: 'r3', comment: '', items: [{ t: 'p', id: 'h', v: 'a1' }, { t: 'ctu', id: 'i', v: 'C1', pv: 3, r: 'arret' }] }
  ]
};
const known = { inputs: ['dcy', 'arret', 'a1'], outputs: ['Y1'], steps: null };

test('Plan : %I en entrées TOR, %Q et %M en bobines, pupitre inscriptible à 100, temporisations et compteurs en registres', () => {
  const L = lintPlc(compilePlc(prog), known);
  const m = modbusMap(L.vars, prog.inputs);
  const at = (list, name) => list.find(e => e.name === name);
  assert.equal(at(m.di, 'dcy').addr, 0);
  assert.equal(at(m.di, 'arret').addr, 1);
  assert.equal(at(m.di, 'a1').addr, 2);
  assert.equal(at(m.coils, 'Y1').addr, 0);
  assert.equal(at(m.coils, 'KM').addr, MB.mem);
  assert.deepEqual(m.coils.filter(e => e.rw).map(e => [e.addr, e.name]), [[100, 'dcy'], [101, 'arret']]);
  assert.equal(at(m.ir, 'T1').addr, 0);
  assert.equal(at(m.ir, 'C1').addr, MB.counters);
  assert.deepEqual(m.ir.slice(-2).map(e => e.addr), [MB.scan, MB.halted]);
  assert.deepEqual(m.skipped, []);
});

test('Image : valeurs de la simulation, temps en dixièmes de seconde, bornées à 16 bits ; tout à 0 à l’arrêt', () => {
  const C = compilePlc(prog), L = lintPlc(C, known), m = modbusMap(L.vars, prog.inputs), run = createPlcRun();
  const env = { dcy: true, arret: false, a1: false };
  for (let k = 0; k < 150; k++) scanPlc(C, run, l => !!env[l], 0.01); // 1,5 s : KM tenu, T1 à 1,5 s
  env.a1 = true; scanPlc(C, run, l => !!env[l], 0.01);
  const pressed = n => n === 'dcy';
  const live = { run, read: l => (C.written.has(l) ? !!run.bits.get(l) : !!env[l]) };
  const img = modbusImage(m, { live, pressed });
  assert.equal(img.di[0], true); // dcy
  assert.equal(img.coils[MB.mem], true); // KM tenu
  assert.equal(img.coils[0], false); // Y1 : T1 pas encore écoulée
  assert.equal(img.coils[100], true); assert.equal(img.writable[100], true); assert.equal(img.writable[0], false);
  assert.equal(img.ir[0], 15); // T1 : 1,5 s → 15
  assert.equal(img.ir[MB.counters], 1); // C1 : un front de a1
  assert.equal(img.ir[MB.scan], 151);
  assert.equal(img.ir.length, MB.halted + 1);
  const off = modbusImage(m, { live: null, pressed: () => false });
  assert.ok(off.di.every(v => !v) && off.coils.every(v => !v) && off.ir.every(v => v === 0));
  assert.equal(off.writable[101], true);
});

test('Trop de sorties : celles qui dépasseraient la zone du pupitre restent sans adresse, et le plan le dit', () => {
  const vars = Array.from({ length: 110 }, (_, i) => ({ name: `Q${i}`, cls: 'out', addr: `%Q${Math.floor(i / 8)}.${i % 8}` }));
  const m = modbusMap(vars, [{ name: 'dcy' }]);
  assert.equal(m.coils.filter(e => e.cls === 'out').length, 100);
  assert.equal(m.skipped.length, 10);
  assert.equal(m.coils.find(e => e.rw).addr, 100);
});
