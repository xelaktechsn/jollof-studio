// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// MicroPython sur le Pico émulé : pilote du raw REPL (seul, face à une fausse carte), puis le vrai micrologiciel
// (public/firmware) avec les modèles de modules : REPL, Pin, ADC, écran LCD I2C piloté en Python, DHT22, DS18B20,
// NeoPixel, servo, Traceback, fichiers gardés d'un démarrage à l'autre. Sans le fichier .uf2, seuls les premiers tests
// tournent. node --test src/emu/micropython.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FIRMWARE, pyBytes, syncCommands, createTracebackReader, createRawRepl, createMicroPythonRuntime, loadFirmware } from './micropython.js';
import { fakeBoard, runFor } from './testkit.mjs';

const FW = new URL('../../public/' + FIRMWARE.file, import.meta.url);
const skip = !fs.existsSync(FW) && `micrologiciel absent (${FIRMWARE.file})`;
const image = () => new Uint8Array(fs.readFileSync(FW));
const RAW = 'raw REPL; CTRL-B to exit\r\n>';

test('Raw REPL : fichiers en littéraux bytes ASCII, découpés, dossiers créés, anciens fichiers retirés', () => {
  assert.equal(pyBytes(new Uint8Array([0x61, 0x27, 0x5c, 10, 13, 9, 3, 4, 0xc3, 0xa9])), "b'a\\'\\\\\\n\\r\\t\\x03\\x04\\xc3\\xa9'");
  const big = 'x'.repeat(5000);
  const cmds = syncCommands({ 'main.py': 'print("é")\n', 'lib/big.py': big }, ['old.py']);
  assert.match(cmds[0].code, /^import os\nfor p in \["old\.py"\]:\n try: os\.remove\(p\)/);
  assert.match(cmds[0].code, /for d in \["lib"\]:\n try: os\.mkdir\(d\)/);
  assert.equal(cmds[1].code, "f=open(\"main.py\",'wb')\nf.write(b'print(\"\\xc3\\xa9\")\\n')\nf.close()");
  const parts = cmds.filter(c => c.what === 'lib/big.py');
  assert.equal(parts.length, 3, 'un fichier de 5000 octets : trois morceaux de 2048 au plus');
  assert.match(parts[0].code, /'wb'/); assert.match(parts[1].code, /'ab'/);
  for (const c of cmds) assert.ok(!/[\x00-\x08\x0b-\x1f\x7f-￿]/.test(c.code), 'rien qui ressemble à Ctrl-C ou Ctrl-D');
  assert.deepEqual(syncCommands({ 'vide.py': '' }).map(c => c.code), ["f=open(\"vide.py\",'wb')\nf.write(b'')\nf.close()"]);
});

test('Traceback : cadre et ligne, KeyboardInterrupt ignoré', () => {
  const got = [], feed = createTracebackReader(e => got.push(e));
  feed('fin\r\nTraceback (most recent call last):\r\n  File "main.py", line 9, in <module>\r\n  File "/lib/util.py", line 5, in boom\r\n');
  feed('ZeroDivisionError: divide by zero\r\n>>> ');
  feed('Traceback (most recent call last):\r\n  File "<stdin>", line 4, in <module>\r\nKeyboardInterrupt: \r\n>>> ');
  feed('Traceback (most recent call last):\r\n  File "<stdin>", line 2, in <module>\r\nNameError: x\r\n'); // après l'invite
  assert.deepEqual(got, [{ frames: [{ file: 'main.py', line: 9 }, { file: 'lib/util.py', line: 5 }], msg: 'ZeroDivisionError: divide by zero' }, { frames: [{ file: '<stdin>', line: 2 }], msg: 'NameError: x' }]);
});

/** Fausse carte : répond comme MicroPython au raw REPL (sans émulateur). */
function fakeDevice({ mute = 0, err = '' } = {}) {
  const dev = { sent: [], replies: [], mode: 'friendly', code: '' };
  dev.write = s => {
    dev.sent.push(s);
    for (const ch of s) {
      if (dev.mode === 'raw' && ch !== '\x04' && ch !== '\x02' && ch !== '\x01') { dev.code += ch; continue; }
      if (ch === '\x01') { if (mute > 0) { mute--; continue; } dev.mode = 'raw'; dev.code = ''; dev.replies.push('\r\n' + RAW); }
      else if (ch === '\x02') { dev.mode = 'friendly'; dev.replies.push('\r\nMicroPython v1.29.0\r\n>>> '); }
      else if (ch === '\x04' && dev.mode === 'raw') {
        const out = dev.code.startsWith('print(') ? dev.code.slice(6, -1) + '\r\n' : '';
        dev.replies.push('OK' + out + '\x04' + (dev.code.startsWith('f=open') ? err : '') + '\x04>'); dev.code = '';
      } else if (ch === '\x04') dev.replies.push('\r\nMPY: soft reboot\r\nbonjour\r\n');
    }
  };
  dev.flush = repl => { while (dev.replies.length) { const r = dev.replies.shift(); for (let i = 0; i < r.length; i += 5) repl.feed(r.slice(i, i + 5)); } }; // par petits bouts
  return dev;
}

test('Raw REPL : envoi des fichiers puis redémarrage, sortie rendue au moniteur', () => {
  const dev = fakeDevice({ mute: 1 }), out = [], fails = [];
  let done = 0;
  const repl = createRawRepl({ write: dev.write, out: s => out.push(s), fail: m => fails.push(m), done: () => done++ });
  repl.feed('vieux programme\r\n'); // hors tâche : tout va au moniteur
  repl.start({ files: { 'main.py': 'print(1)\n' } });
  assert.ok(repl.busy);
  assert.equal(dev.sent[0], '\r\x03\x03\x01');
  repl.tick(0); dev.flush(repl); // la carte ne répond pas au premier Ctrl-A (programme occupé)
  repl.tick(600); assert.equal(dev.sent[1], '\x03\x03\x01', 'relance');
  for (let i = 0; i < 10 && repl.busy; i++) dev.flush(repl);
  assert.equal(repl.busy, false);
  assert.equal(done, 1);
  assert.deepEqual(fails, []);
  assert.ok(dev.sent.some(s => s.startsWith("f=open(\"main.py\",'wb')")));
  assert.deepEqual(dev.sent.slice(-2), ['\x02', '\x04'], 'REPL normal puis redémarrage logiciel');
  assert.equal(out.join(''), 'vieux programme\r\nMPY: soft reboot\r\nbonjour\r\n', 'bannière et échanges cachés');
});

test('Raw REPL : erreur d’écriture, carte muette, exécution sans enregistrer', () => {
  let dev = fakeDevice({ err: 'Traceback (most recent call last):\r\nOSError: 28\r\n' }), fails = [];
  let repl = createRawRepl({ write: dev.write, out: () => {}, fail: m => fails.push(m) });
  repl.start({ files: { 'main.py': 'x' } });
  for (let i = 0; i < 10 && repl.busy; i++) dev.flush(repl);
  assert.equal(fails.length, 1); assert.match(fails[0], /main\.py.*OSError: 28/);
  assert.equal(dev.sent[dev.sent.length - 1], '\x02', 'retour au REPL normal');

  dev = fakeDevice({ mute: 99 }); fails = [];
  repl = createRawRepl({ write: dev.write, out: () => {}, fail: m => fails.push(m) });
  repl.start({ files: {} });
  for (let t = 0; t <= 12000 && repl.busy; t += 100) { repl.tick(t); dev.flush(repl); }
  assert.equal(fails.length, 1); assert.match(fails[0], /ne répond pas/);

  dev = fakeDevice(); const out = [];
  repl = createRawRepl({ write: dev.write, out: s => out.push(s) });
  repl.start({ files: {}, run: { code: 'print(salut)' } });
  for (let i = 0; i < 10 && repl.busy; i++) dev.flush(repl);
  assert.equal(out.join(''), 'salut\r\n\r\nMicroPython v1.29.0\r\n>>> ', 'sortie du programme sans les marqueurs, puis le REPL');
});

test('Micrologiciel : chargé une fois à la demande', async () => {
  let calls = 0;
  const fetcher = async url => { calls++; assert.equal(url, FIRMWARE.file); return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }; };
  const [a, b] = await Promise.all([loadFirmware(fetcher), loadFirmware(fetcher)]);
  assert.deepEqual([...a], [1, 2]); assert.equal(a, b); assert.equal(calls, 1);
});

/* ---------- Vrai MicroPython sur le RP2040 émulé ---------- */

test('MicroPython : main.py, Pin, ADC, REPL, Traceback à la bonne ligne', { skip }, () => {
  const { hw } = fakeBoard({ kind: 'pico', inputs: { GP26: { v: 1.1 } } });
  const errors = [], rises = [];
  const main = [
    'from machine import Pin, ADC', // 1
    'import time', // 2
    'led = Pin(15, Pin.OUT)', // 3
    "print('adc', ADC(26).read_u16())", // 4
    'for i in range(6):', // 5
    '    led.toggle()', // 6
    '    time.sleep_ms(50)', // 7
    "print('fin', led.value())", // 8
    'x = undefined_name + 1' // 9
  ].join('\n') + '\n';
  const rt = createMicroPythonRuntime(image(), hw, { files: { 'main.py': main }, onError: e => errors.push(e) });
  rt.setTrace((k, p, t) => { if (k === 'GP15' && p.d === 1) rises.push(t); });
  let serial = '';
  rt.setSerialTap(s => { serial += s; });
  runFor(rt, 1200);
  assert.equal(rt.state, 'run');
  assert.match(serial, /MPY: soft reboot\r\nadc 21845\r\n/, 'ADC : 1,1 V sur 3,3 V → 21845 sur 16 bits');
  assert.match(serial, /fin 0\r\n/);
  assert.equal(rises.length, 3, 'GP15 basculée six fois');
  assert.ok(Math.abs(rises[1] - rises[0] - 100) < 2, `période ${rises[1] - rises[0]} ms`);
  assert.equal(rt.pins.get('GP15').mode, 1);
  assert.deepEqual(errors, [{ file: 'main.py', line: 9, msg: "NameError: name 'undefined_name' isn't defined" }]);
  assert.match(serial, />>> $/, 'le REPL reprend la main');
  rt.takeSerial();
  rt.send('print(6 * 7)\r');
  runFor(rt, 100);
  assert.match(rt.takeSerial(), /42\r\n>>> $/);
});

/** Pilote d'écran LCD 1602 à module I2C (PCF8574), écrit pour le test : 4 bits, RS = P0, E = P2, rétroéclairage P3. */
const LCD_PY = `import time
class LCD:
    def __init__(self, i2c, addr=0x27):
        self.i2c, self.addr, self.bl = i2c, addr, 0x08
        time.sleep_ms(50)
        for n in (0x03, 0x03, 0x03, 0x02):
            self.nib(n << 4, 0)
            time.sleep_ms(5)
        for c in (0x28, 0x0C, 0x01, 0x06):
            self.send(c, 0)
        time.sleep_ms(2)
    def nib(self, v, rs):
        b = v | rs | self.bl
        self.i2c.writeto(self.addr, bytes([b | 0x04, b]))
    def send(self, v, rs):
        self.nib(v & 0xF0, rs)
        self.nib((v << 4) & 0xF0, rs)
    def move(self, col, row):
        self.send(0x80 | (col + (0x40 if row else 0)), 0)
    def print(self, s):
        for ch in s:
            self.send(ord(ch), 1)
`;

test('MicroPython : écran LCD I2C (pilote en Python), DHT22, DS18B20, NeoPixel, servo', { skip }, () => {
  const { hw, comps } = fakeBoard({
    kind: 'pico',
    modules: [
      { type: 'lcd1602', addr: [0x27], pins: { SDA: 'GP10', SCL: 'GP11' } }, // un second câblage, pour SoftI2C
      { type: 'dht22', pins: { DATA: 'GP2' }, data: { temp: 24.5, hum: 61 } },
      { type: 'ds18b20', pins: { DQ: 'GP3' }, data: { temp: 23.0625 } },
      { type: 'ws2812', pins: { DIN: 'GP6' } }
    ],
    inputs: { GP2: { d: 1 }, GP3: { d: 1 } } // résistances de tirage des lignes de données
  });
  const main = `from machine import I2C, SoftI2C, Pin, PWM
import time, dht, onewire, ds18x20, neopixel
from lcd import LCD
i2c = I2C(0, sda=Pin(4), scl=Pin(5))
print('scan', i2c.scan())
print('soft', SoftI2C(sda=Pin(10), scl=Pin(11)).scan())
i2c = I2C(0, sda=Pin(4), scl=Pin(5))
lcd = LCD(i2c)
lcd.print('Bonjour')
lcd.move(0, 1)
lcd.print('MicroPython')
d = dht.DHT22(Pin(2))
d.measure()
print('dht', d.temperature(), d.humidity())
ds = ds18x20.DS18X20(onewire.OneWire(Pin(3)))
roms = ds.scan()
ds.convert_temp()
time.sleep_ms(750)
print('ds', len(roms), ds.read_temp(roms[0]))
np = neopixel.NeoPixel(Pin(6), 2)
np[0] = (255, 0, 0)
np[1] = (0, 0, 9)
np.write()
servo = PWM(Pin(15))
servo.freq(50)
servo.duty_ns(1472000)
print('ok')
`;
  const rt = createMicroPythonRuntime(image(), hw, { files: { 'main.py': main, 'lib/lcd.py': LCD_PY } });
  runFor(rt, 2000);
  const serial = rt.takeSerial();
  assert.match(serial, /scan \[39\]\r\nsoft \[39\]\r\n/, 'I2C matériel, et logiciel (SoftI2C) grâce aux résistances de tirage du module');
  assert.match(serial, /dht 24\.5 61\.0\r\n/);
  assert.match(serial, /ds 1 23\.0625\r\n/);
  assert.match(serial, /ok\r\n/);
  const lcd = comps.find(c => c.type === 'lcd1602');
  assert.deepEqual(lcd.progScreen.lines.map(l => l.trimEnd()), ['Bonjour', 'MicroPython']);
  assert.deepEqual(rt.hw.pinApi.rec('GP6').px, [[255, 0, 0], [0, 0, 9]]);
  assert.ok(Math.abs(rt.pins.get('GP15').servo - 90) < 2, `servo ${rt.pins.get('GP15').servo}°`);
  assert.equal(rt.state, 'run');
});

test('MicroPython : exécuter sans enregistrer, Ctrl-C, fichiers gardés au redémarrage suivant', { skip }, () => {
  const { hw } = fakeBoard({ kind: 'pico' });
  const errors = [];
  const files = { 'main.py': "print('main')\n", 'old.py': 'X = 1\n' };
  let rt = createMicroPythonRuntime(image(), hw, { files, onError: e => errors.push(e) });
  runFor(rt, 1000);
  assert.match(rt.takeSerial(), /main\r\n/);
  rt.mpy.runFile('essai.py', "import time\nprint('essai')\nwhile True:\n    time.sleep_ms(10)\n", files);
  runFor(rt, 600);
  assert.match(rt.takeSerial(), /essai\r\n/);
  rt.mpy.interrupt();
  runFor(rt, 200);
  assert.match(rt.takeSerial(), /KeyboardInterrupt[\s\S]*>>> $/);
  assert.deepEqual(errors, [], 'une interruption n’est pas une erreur');
  rt.send("f = open('data.txt', 'w'); f.write('mesures'); f.close()\r");
  runFor(rt, 100);
  // Nouveau démarrage de la même carte : old.py a quitté le projet, data.txt (écrit par le programme) reste.
  rt = createMicroPythonRuntime(image(), hw, { files: { 'main.py': "import os\nprint(sorted(os.listdir()), open('data.txt').read())\n" }, onError: e => errors.push(e) });
  runFor(rt, 1000);
  assert.match(rt.takeSerial(), /\['data\.txt', 'main\.py'\] mesures\r\n/);
  // Erreur dans un fichier exécuté sans être enregistré (« <stdin> » pour MicroPython) : rapportée à ce fichier.
  rt.mpy.runFile('erreur.py', 'a = 1\nb = a / 0\n', { 'main.py': '' });
  runFor(rt, 300);
  assert.deepEqual(errors, [{ file: 'erreur.py', line: 2, msg: 'ZeroDivisionError: divide by zero' }]);
});
