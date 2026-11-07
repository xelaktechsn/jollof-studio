// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mode fidèle du Pico : le vrai programme (compilé par arduino-cli avec le cœur arduino-pico) tourne sur le RP2040
// émulé. Sans arduino-cli ou sans le cœur rp2040:rp2040, seuls les tests sans compilation tournent ; pour le reste :
//   arduino-cli core install rp2040:rp2040 --additional-urls https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json
// Corpus du Pico : src/emu/corpus-pico/*.ino, mêmes en-têtes que src/emu/corpus/ (voir corpus.test.mjs), plus
//   // px: GP6 255,0,0 0,255,0   (couleurs reçues par la barrette WS2812 branchée sur cette broche)
// node --test src/emu/rp2040.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRp2040Runtime, parseImage } from './rp2040.js';
import { compileFirmware, EMULATED, FQBN as FQBNS } from './compile.js';
import { bootromB1 } from './rp2040-bootrom.js';
import { BOARDS } from '../sim/boards.js';
import { hasPicoCore, compileSketch, fakeBoard, boot, runFor } from './testkit.mjs';

const FQBN = 'rp2040:rp2040:rpipico';
const skip = !hasPicoCore() && 'arduino-cli ou le cœur rp2040:rp2040 absent';

/** Fichier UF2 (blocs de 256 octets) d'une image placée au début de la flash. */
function uf2(bytes) {
  const n = Math.ceil(bytes.length / 256), out = new Uint8Array(n * 512), dv = new DataView(out.buffer);
  for (let i = 0; i < n; i++) {
    const o = i * 512, part = bytes.subarray(i * 256, i * 256 + 256);
    dv.setUint32(o, 0x0a324655, true); dv.setUint32(o + 4, 0x9e5d5157, true); dv.setUint32(o + 8, 0x2000, true);
    dv.setUint32(o + 12, 0x10000000 + i * 256, true); dv.setUint32(o + 16, part.length, true);
    dv.setUint32(o + 20, i, true); dv.setUint32(o + 24, n, true); dv.setUint32(o + 28, 0xe48bff56, true);
    out.set(part, o + 32); dv.setUint32(o + 508, 0x0ab16f30, true);
  }
  return out;
}

/**
 * Programme Thumb écrit à la main, lancé à 0x10000000 : GP15 en sortie (fonction SIO) mise à HIGH, puis l'octet
 * « J » envoyé sur l'UART0, puis une boucle sans fin.
 */
function handProgram() {
  const code = [0x4805, 0x4906, 0x4a06, 0x2305, 0x6013, 0x6241, 0x6141, 0x4a05, 0x234a, 0x6013, 0xe7fe, 0xbf00];
  const lit = [0xd0000000 /* SIO */, 1 << 15, 0x4001407c /* GPIO15_CTRL */, 0x40034000 /* UART0 DR */];
  const img = new Uint8Array(code.length * 2 + lit.length * 4), dv = new DataView(img.buffer);
  code.forEach((h, i) => dv.setUint16(2 * i, h, true));
  lit.forEach((w, i) => dv.setUint32(code.length * 2 + 4 * i, w, true));
  return img;
}

test('Bootrom B1 et lecture des images .bin et .uf2', () => {
  const rom = bootromB1();
  assert.equal(rom.length, 4096);
  assert.equal(rom[0], 0x20041f00, 'pile initiale');
  assert.equal(rom[1], 0xef, 'point d’entrée');
  const bin = new Uint8Array(700).map((_, i) => i & 255);
  assert.deepEqual(parseImage(bin), [{ at: 0, data: bin }]);
  const parts = parseImage(uf2(bin));
  assert.equal(parts.length, 3);
  assert.deepEqual([parts[1].at, parts[2].data.length], [256, 188]);
  assert.deepEqual(Array.from(parts[2].data.slice(0, 3)), [512 & 255, 513 & 255, 514 & 255]);
  const bad = uf2(bin); bad[508] = 0;
  assert.throws(() => parseImage(bad), /UF2/);
});

test('RP2040 émulé : programme écrit à la main (GPIO, UART0), depuis un .bin ou un .uf2', () => {
  for (const img of [handProgram(), uf2(handProgram())]) {
    const rt = createRp2040Runtime(img, { prof: BOARDS.pico, kind: 'pico', read: () => null });
    const tx = [];
    rt.hw.uart.onTx(b => tx.push(b));
    for (let i = 0; i < 4 && !tx.length; i++) rt.run(16);
    assert.deepEqual(tx, [0x4a]);
    assert.equal(rt.pins.get('GP15').mode, 1);
    assert.equal(rt.pins.get('GP15').d, 1);
    assert.deepEqual(rt.probe('GP15'), { out: true, d: 1, v: 3.3, pwm: null, freq: 0 });
    assert.ok(rt.pins.has('LED_BUILTIN') && !rt.pins.has('GP25'), 'GP25 : la LED de la carte');
    assert.equal(rt.state, 'run');
    assert.equal(rt.firmware, 'rp2040');
  }
});

test('Compilation pour le Pico : cœur arduino-pico, image .bin (sinon .uf2)', async () => {
  assert.ok(EMULATED.has('pico'));
  assert.equal(FQBNS.pico, FQBN);
  const calls = [], files = { uf2: uf2(handProgram()) };
  const cli = {
    available: () => true,
    run: async args => { calls.push(args.join(' ')); return { code: 0, stdout: args[1] === 'list' ? '{"platforms":[]}' : '', stderr: '' }; },
    write: async () => '/s/jollof_sketch', paths: async () => ['/s/jollof_sketch', '/b/jollof_sketch'],
    read: async ext => { if (!files[ext]) throw new Error('absent'); return files[ext]; }
  };
  const res = await compileFirmware('void setup() {}\nvoid loop() {}\n', 'pico', () => {}, cli);
  assert.equal(res.ok, true);
  assert.equal(res.format, 'uf2');
  assert.deepEqual(parseImage(res.image)[0].data, handProgram());
  const url = 'https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json';
  assert.ok(calls.includes(`core install rp2040:rp2040 --additional-urls ${url}`), calls.join('\n'));
  assert.ok(calls.includes(`compile --fqbn ${FQBN} --output-dir /b/jollof_sketch /s/jollof_sketch`));
  files.bin = handProgram();
  const res2 = await compileFirmware('void setup() {}\nvoid loop() {}\n', 'pico', () => {}, cli);
  assert.deepEqual([res2.format, res2.image.length], ['bin', files.bin.length]);
});

test('Pico fidèle : clignotement, Serial (USB), ADC, PWM, tirages, Serial1 (UART0)', { skip }, () => {
  const img = compileSketch(`
void setup() {
  pinMode(15, OUTPUT); pinMode(LED_BUILTIN, OUTPUT);
  pinMode(14, INPUT_PULLUP); pinMode(13, INPUT_PULLDOWN);
  analogWrite(16, 64);
  Serial.begin(115200);
  while (!Serial) delay(10);
  Serial.print("A0="); Serial.println(analogRead(26));
  Serial.print("GP14="); Serial.println(digitalRead(14));
  Serial.print("GP13="); Serial.println(digitalRead(13));
  Serial.print("GP12="); Serial.println(digitalRead(12));
  Serial1.begin(9600);
  Serial1.print("UART");
}
void loop() {
  digitalWrite(15, HIGH); digitalWrite(LED_BUILTIN, HIGH); delay(100);
  digitalWrite(15, LOW); digitalWrite(LED_BUILTIN, LOW); delay(100);
  while (Serial.available()) Serial.print((char)toupper(Serial.read()));
  while (Serial1.available()) { Serial.print("S1:"); Serial.println((char)Serial1.read()); }
}`, FQBN);
  const { hw } = fakeBoard({ kind: 'pico', inputs: { GP26: { v: 1.65 }, GP12: { d: 1 } } });
  const rt = boot(img, hw), tx = [], rises = [];
  rt.hw.uart.onTx(b => tx.push(b));
  rt.setTrace((k, p, t) => { if (k === 'GP15' && p.d === 1) rises.push(t); });
  let serial = '';
  rt.setSerialTap(s => { serial += s; });
  runFor(rt, 150);
  assert.match(serial, /A0=51[0-3]\r\n/, 'analogRead(26) : 1,65 V sur 3,3 V, 10 bits');
  assert.match(serial, /GP14=1\r\nGP13=0\r\nGP12=1\r\n/, 'tirage haut, tirage bas, niveau du montage');
  assert.equal(String.fromCharCode(...tx), 'UART', 'Serial1 : octets vus par les modules sur GP0/GP1');
  assert.equal(rt.hw.uart.baud(), 9600);
  const pwm = rt.pins.get('GP16');
  assert.ok(Math.abs(pwm.pwm - 64 / 255) < 0.02, `analogWrite(16, 64) : ${pwm.pwm}`);
  assert.ok(Math.abs(pwm.ledc - 1000) < 20, `PWM à 1 kHz : ${pwm.ledc}`);
  rt.send('abc');
  rt.hw.uart.inject([0x5a]);
  runFor(rt, 500);
  assert.match(serial, /ABC/, 'écho USB');
  assert.match(serial, /S1:Z\r\n/, 'octet reçu par Serial1');
  assert.ok(rises.length >= 3, `fronts montants de GP15 : ${rises.length}`);
  for (let i = 1; i < rises.length; i++) assert.ok(Math.abs(rises[i] - rises[i - 1] - 200) < 2, `période ${rises[i] - rises[i - 1]} ms`);
  assert.equal(rt.pins.get('LED_BUILTIN').d, rt.pins.get('GP15').d, 'LED de la carte (GP25) avec GP15');
  assert.ok(rt.clock() >= 650);
  assert.equal(rt.state, 'run');
});

test('Pico fidèle : tone() et Servo (machines PIO au rythme du temps simulé)', { skip }, () => {
  const img = compileSketch(`
#include <Servo.h>
Servo s;
void setup() { tone(17, 1000); s.attach(18); s.write(90); }
void loop() { delay(10); }`, FQBN);
  const { hw } = fakeBoard({ kind: 'pico' });
  const rt = boot(img, hw);
  runFor(rt, 150);
  const t = rt.pins.get('GP17'), sv = rt.pins.get('GP18');
  assert.ok(Math.abs(t.freq - 1000) < 10, `tone(17, 1000) : ${t.freq} Hz`);
  // arduino-pico : write(90) → 1500 µs (plage par défaut 1000 à 2000 µs) ; le servo simulé suit la convention 544-2400 µs.
  assert.ok(sv.servo != null && Math.abs(sv.servo - 92.7) < 2, `servo sur GP18 : ${sv.servo}°`);
  assert.equal(rt.state, 'run');
});

test('Pico fidèle : EEPROM (dernier secteur de la flash) gardée avec le projet', { skip }, () => {
  const img = compileSketch(`
#include <EEPROM.h>
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  EEPROM.begin(256);
  byte v = EEPROM.read(3);
  Serial.print("lu="); Serial.println(v);
  EEPROM.write(3, v == 255 ? 7 : v + 1);
  Serial.print("commit="); Serial.println(EEPROM.commit());
}
void loop() { delay(10); }`, FQBN);
  const { hw } = fakeBoard({ kind: 'pico' });
  let rt = boot(img, hw);
  runFor(rt, 120);
  assert.match(rt.takeSerial(), /lu=255\r\ncommit=1/);
  assert.equal(hw.mem().ee, 'ffffff07', 'octet 3 écrit dans la mémoire de la carte');
  rt = boot(img, hw); // nouveau démarrage : l'EEPROM a survécu
  runFor(rt, 120);
  assert.match(rt.takeSerial(), /lu=7\r\n/);
  assert.equal(hw.mem().ee, 'ffffff08');
});

/* ---------- Corpus du Pico ---------- */
const DIR = new URL('./corpus-pico/', import.meta.url);
const meta = (src, key) => [...src.matchAll(new RegExp(`^//\\s*${key}:\\s*(.*)$`, 'gm'))].map(m => m[1].trim());

/** Exécute un programme du corpus du Pico ; rend la liste de ses échecs. */
function runPico(f, src) {
  const failures = [];
  let img;
  try { img = compileSketch(src, FQBN); } catch (e) { return [`${f} : ne compile pas\n${e.message}`]; }
  const modules = meta(src, 'module').map(j => JSON.parse(j));
  if (meta(src, 'lcd').length && !modules.some(m => m.type === 'lcd1602')) modules.push({ type: 'lcd1602', addr: [0x27] });
  const inputs = Object.assign({}, ...meta(src, 'input').map(j => JSON.parse(j)));
  const { hw, comps } = fakeBoard({ kind: 'pico', modules, inputs });
  const rt = boot(img, hw);
  for (const s of meta(src, 'send')) rt.send(s.replace(/\\n/g, '\n'));
  runFor(rt, +(meta(src, 'run-ms')[0] || 300));
  const serial = rt.takeSerial();
  for (const e of meta(src, 'expect')) if (!serial.includes(e)) failures.push(`${f} : attendu « ${e} », reçu ${JSON.stringify(serial.slice(0, 300))}`);
  for (const e of meta(src, 'not-expect')) if (serial.includes(e)) failures.push(`${f} : « ${e} » ne devait pas apparaître`);
  for (const e of meta(src, 'lcd')) {
    const c = comps.find(m => m.type === 'lcd1602'), got = c.progScreen ? c.progScreen.lines.map(l => l.trimEnd()).join('|') : '(rien)';
    if (got !== e) failures.push(`${f} : écran attendu « ${e} », affiché « ${got} »`);
  }
  for (const e of meta(src, 'px')) {
    const [key, ...cols] = e.split(/\s+/), rec = rt.hw.pinApi.rec(key), got = JSON.stringify(rec && rec.px), want = JSON.stringify(cols.map(c => c.split(',').map(Number)));
    if (got !== want) failures.push(`${f} : couleurs attendues ${want}, reçues ${got}`);
  }
  if (rt.state !== 'run') failures.push(`${f} : état ${rt.state} ${rt.error ? rt.error.msg : ''}`);
  return failures;
}

test('Corpus du Pico : bibliothèques réelles et modules émulés', { skip }, () => {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.ino')).sort();
  const failures = files.flatMap(f => runPico(f, fs.readFileSync(new URL(f, DIR), 'utf8')));
  assert.deepEqual(failures, [], failures.join('\n\n'));
  assert.ok(files.length >= 5);
});
