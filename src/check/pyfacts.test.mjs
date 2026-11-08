// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Broches d'un programme MicroPython lues par le vérificateur : en clair, la preuve sait qu'un potentiomètre est
// sur une entrée ADC ; calculées, elle reste prudente (toute broche peut être une sortie). node --test src/check/pyfacts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pyPinFacts } from './pyfacts.js';
import { checkProject } from './check.js';
import { loadProject } from './load.js';
import { BOARDS } from '../sim/boards.js';
import { pinRole } from './program.js';

const roles = src => { const f = pyPinFacts(src, BOARDS.pico); return { dyn: f.dynamic, r: Object.fromEntries([...f.pins].map(([k, p]) => [k, pinRole(p)])), uses: f.uses }; };

test('Rôles des broches lus dans le texte Python', () => {
  const r = roles(`from machine import Pin, ADC, PWM, I2C, UART\nimport dht, onewire, neopixel\nLED = 15  # LED rouge\nled = PWM(Pin(LED))\npot = ADC(Pin(28))\nbtn = Pin(2, Pin.IN, Pin.PULL_UP)\nbas = Pin(6, mode=Pin.IN, pull=Pin.PULL_DOWN)\ni2c = I2C(0, sda=Pin(4), scl=Pin(5))\nu = UART(0, tx=Pin(0), rx=Pin(1))\nd = dht.DHT22(Pin(3))\now = onewire.OneWire(Pin(7))\nnp = neopixel.NeoPixel(Pin(8), 4)\nrelais = Pin(9, Pin.OUT, value=0)\nt = ADC(4)\ncarte = Pin('LED', Pin.OUT)\n`);
  assert.equal(r.dyn, false);
  assert.deepEqual(r.r, { GP15: 'out', GP28: 'in', GP2: 'pullup', GP6: 'pulldown', GP4: 'lib', GP5: 'lib', GP0: 'lib', GP1: 'lib', GP3: 'lib', GP7: 'lib', GP8: 'out', GP9: 'out' });
  assert.deepEqual(r.uses, []);
});

test('Broche calculée, changement de sens, sens non précisé : prudence', () => {
  assert.equal(roles('from machine import Pin\nfor p in (2, 3):\n    Pin(p, Pin.OUT).on()\n').dyn, true);
  assert.equal(roles('from machine import Pin\nb = Pin(2, Pin.IN)\nb.init(Pin.OUT)\n').dyn, true);
  assert.deepEqual(roles('from machine import Pin\nx = Pin(14)\n').r, { GP14: 'out' });
  assert.equal(pyPinFacts('void setup() {}', BOARDS.pico), null); // pas du MicroPython
  assert.deepEqual(roles('import machine\nx = machine.Pin(40, machine.Pin.OUT)\n').uses.map(u => u.value), [40]);
});

/** Pico en MicroPython : potentiomètre (curseur sur GP28, sans résistance) et LED en PWM sur GP15. */
function picoPot(main) {
  const data = {
    comps: [{ id: 'p', type: 'pico', name: 'PICO' }, { id: 'pot', type: 'pot', name: 'POT1' }, { id: 'r', type: 'res-220', name: 'R1' }, { id: 'l', type: 'led-red', name: 'LED1' }],
    wires: [{ a: ['pot', '1'], b: ['p', 'GND'] }, { a: ['pot', '3'], b: ['p', '3V3'] }, { a: ['pot', 'W'], b: ['p', 'GP28'] },
      { a: ['p', 'GP15'], b: ['r', '1'] }, { a: ['r', '2'], b: ['l', 'A'] }, { a: ['l', 'K'], b: ['p', 'GND (2)'] }],
    settings: { prog: { rules: [], boards: { p: { engine: 'micropython', files: { 'main.py': main } } } } }
  };
  return checkProject(loadProject(data));
}

test('Pico MicroPython : potentiomètre directement sur l’entrée ADC, sans erreur ; broche calculée, erreurs prudentes', () => {
  const lu = picoPot('from machine import Pin, ADC, PWM\nimport time\npot = ADC(Pin(28))\nled = PWM(Pin(15))\nled.freq(1000)\nwhile True:\n    led.duty_u16(pot.read_u16())\n    time.sleep_ms(20)\n');
  assert.equal(lu.errors, 0, lu.diags.map(d => d.code + ' ' + d.title).join('\n'));
  assert.equal(lu.dynamic, false);
  // Même montage, broches calculées : GP28 peut être une sortie qui force contre le potentiomètre.
  const calc = picoPot('from machine import Pin\nfor n in [15, 28]:\n    Pin(n, Pin.OUT).value(1)\n');
  assert.equal(calc.dynamic, true);
  assert.ok(calc.errors > 0);
});
