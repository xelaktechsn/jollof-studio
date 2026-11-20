// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// TP iot03 en mode fidèle : le programme de la solution (bibliothèques Ethernet + ArduinoModbus, ModbusTCPClient),
// compilé par arduino-cli, tourne sur le Pico (rp2040js) et sur le Mega (avr8js) avec le modèle du W5500, et écrit dans
// l'« Automate Modbus TCP » du plan réseau (src/net/modbus.js, port 502). Un second programme lit les registres
// (ModbusTCPClient.holdingRegisterRead, requestFrom). Sans arduino-cli, sans les bibliothèques Ethernet, ArduinoRS485
// et ArduinoModbus, ou sans le cœur rp2040, les tests sont ignorés.
// node --test src/emu/devices/w5500-modbus.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hasCli, hasPicoCore, compileSketch, fakeBoard, boot, runFor } from '../testkit.mjs';
import { createLan } from '../../net/lan.js';
import { newDevice } from '../../net/devices.js';
import { makeCable } from '../../net/cable.js';

const libs = hasCli ? spawnSync('arduino-cli', ['lib', 'list'], { encoding: 'utf8' }).stdout || '' : '';
const skip = !hasCli ? 'arduino-cli absent'
  : !['Ethernet', 'ArduinoRS485', 'ArduinoModbus'].every(l => new RegExp(`^${l}\\s`, 'm').test(libs)) ? 'bibliothèques Ethernet, ArduinoRS485 et ArduinoModbus absentes (arduino-cli lib install Ethernet ArduinoModbus)' : false;
const skipPico = skip || (!hasPicoCore() && 'cœur rp2040 absent');

const LAB = JSON.parse(fs.readFileSync(new URL('../../lab/net/iot03-modbus-tcp-automate.json', import.meta.url), 'utf8'));
const SOLUTION = LAB.solution.project.settings.prog.boards.pico_0.code;

/** Plan : box, switch, PC, automate (192.168.1.50) ; le module 'e:' + id relié au port 4 du switch. */
function plan(id) {
  const used = new Set(), data = { devices: [], cables: [] };
  for (const [did, type] of [['box', 'router'], ['sw', 'switch'], ['pc', 'pc'], ['api', 'plc']]) {
    const d = newDevice(type, used); used.add(d.name); d.id = did; d.name = did.toUpperCase(); data.devices.push(d);
  }
  const ends = [[['box', 'lan1'], ['sw', 'p1']], [['pc', 'eth0'], ['sw', 'p2']], [['api', 'eth0'], ['sw', 'p3']], [['e:' + id, 'eth'], ['sw', 'p4']]];
  ends.forEach(([a, b], i) => data.cables.push({ id: 'c' + i, a, b, cat: 'cat6', len: 3, wire: makeCable('straight') }));
  return data;
}
function fw(src, board, id, inputs) {
  const data = plan(id);
  const { hw, comps } = fakeBoard({ kind: board.kind, modules: [{ type: 'w5500', id, pins: board.pins }], inputs });
  const comp = comps[0], eth = () => (comp.periph && comp.periph.eth) || null;
  const ext = { id: 'e:' + id, type: 'w5500', name: comp.name, x: 0, y: 0, mac: () => (eth() ? eth().mac : '00:00:00:00:00:00'), ipcfg: () => eth() };
  const lan = createLan({ data: () => data, ext: () => [ext], sig: () => JSON.stringify(eth()) });
  const frames = []; lan.on(e => { if (e.t === 'modbus') frames.push(e); });
  hw.lan = () => lan;
  const rt = boot(compileSketch(src, board.fqbn), hw);
  return { rt, lan, data, frames, out: '', take() { this.out += rt.takeSerial(); return this.out; } };
}
const regs = b => b.data.devices.find(d => d.id === 'api').p.regs;
function until(b, ok, ms) {
  const end = b.rt.clock() + ms;
  while (b.rt.clock() < end && !ok()) { runFor(b.rt, 50); b.take(); }
  return ok();
}

const PICO = { kind: 'pico', fqbn: 'rp2040:rp2040:rpipico', pins: { CS: 'GP17', SCK: 'GP18', MOSI: 'GP19', MISO: 'GP16' } };
// Mega 2560 : 8 Ko de RAM. Sur l'Uno (2 Ko), ArduinoModbus + Ethernet occupent 91 % de la RAM statique et le
// malloc de modbus_new_tcp échoue (begin rend 0) : comme sur la vraie carte, que la bibliothèque ne déclare pas.
const MEGA = { kind: 'mega', fqbn: 'arduino:avr:mega', pins: { CS: 'D10', SCK: 'D52', MOSI: 'D51', MISO: 'D50' } };

test('iot03 sur Pico : la solution (ModbusTCPClient) écrit le registre 0 et la bobine 0 de l’automate', { skip: skipPico }, () => {
  // Potentiomètre : 2,5 V sur GP28 (A2), référence 3,3 V, 10 bits → 775 ; puis 0,5 V → 155, bobine retombée.
  const pot = { v: 2.5 }, b = fw(SOLUTION, PICO, 'mb-pico', { GP28: pot });
  assert.ok(until(b, () => regs(b).hr[0] > 0, 4000), b.out + JSON.stringify(b.frames));
  assert.ok(Math.abs(regs(b).hr[0] - 775) <= 2, String(regs(b).hr[0]));
  assert.ok(until(b, () => regs(b).coils[0] === 1, 1500), JSON.stringify(regs(b)));
  assert.deepEqual([...new Set(b.frames.map(f => f.fn))].sort(), [5, 6], 'fonctions 6 (registre) et 5 (bobine)');
  assert.ok(b.frames.every(f => f.ok && f.addr === 0));
  assert.doesNotMatch(b.out, /injoignable/);
  pot.v = 0.5;
  assert.ok(until(b, () => regs(b).coils[0] === 0, 2500), JSON.stringify(regs(b)));
  assert.ok(Math.abs(regs(b).hr[0] - 155) <= 2, String(regs(b).hr[0]));
});

// Lecture : l'automate tient des valeurs ; le programme lit 3 registres de maintien (requestFrom) et une entrée.
const READER = `#include <SPI.h>
#include <Ethernet.h>
#include <ArduinoRS485.h>
#include <ArduinoModbus.h>
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x04 };
IPAddress ip(192, 168, 1, 61);
IPAddress automate(192, 168, 1, 50);
EthernetClient ethClient;
ModbusTCPClient modbus(ethClient);
void setup() {
  Serial.begin(115200);
#ifdef ARDUINO_ARCH_RP2040
  Ethernet.init(17);
#endif
  Ethernet.begin(mac, ip);
  if (!modbus.begin(automate, 502)) { Serial.println("injoignable"); return; }
  if (modbus.requestFrom(HOLDING_REGISTERS, 2, 3) == 3) {
    Serial.print("hr=");
    while (modbus.available()) { Serial.print(modbus.read()); Serial.print(','); }
    Serial.println();
  } else { Serial.print("erreur "); Serial.println(modbus.lastError()); }
  Serial.print("di1="); Serial.println(modbus.discreteInputRead(1));
  Serial.print("hors=");  Serial.println(modbus.holdingRegisterRead(200));
  modbus.stop();
  Serial.println("fin");
}
void loop() {}`;

for (const [name, board] of [['Mega', MEGA], ['Pico', PICO]]) {
  test(`ModbusTCPClient sur ${name} : lecture de registres, d’une entrée, et exception hors table`, { skip: board === PICO ? skipPico : skip }, () => {
    const b = fw(READER, board, 'rd-' + board.kind, {});
    const r = regs(b); r.hr[2] = 1234; r.hr[3] = 7; r.hr[4] = 65535; r.di[1] = 1;
    assert.ok(until(b, () => /fin\r\n/.test(b.out), 6000), b.out);
    assert.match(b.out, /hr=1234,7,65535,\r\n/);
    assert.match(b.out, /di1=1\r\n/);
    assert.match(b.out, /hors=-1\r\n/, 'adresse 200 : exception 2 (adresse illégale), la bibliothèque rend -1');
    assert.deepEqual(b.frames.map(f => [f.fn, f.addr, f.ok]), [[3, 2, true], [2, 1, true], [3, 200, false]]);
  });
}

test('ArduinoModbus : bibliothèques installées d’après les #include, options de compilation du Pico seulement', async () => {
  const { LIBS, libBuildArgs } = await import('../compile.js');
  assert.deepEqual(LIBS['ArduinoModbus.h'], ['ArduinoModbus', 'ArduinoRS485']);
  assert.deepEqual(LIBS['EthernetENC.h'], ['EthernetENC']);
  assert.match(libBuildArgs(PICO.fqbn, SOLUTION).join(' '), /^--build-property compiler\.cpp\.extra_flags=-DSERIAL_PORT_HARDWARE=Serial1 -DRS485_DEFAULT_DE_PIN=-1 -DRS485_DEFAULT_RE_PIN=-1$/);
  assert.deepEqual(libBuildArgs(MEGA.fqbn, SOLUTION), [], 'le cœur AVR définit déjà tout');
  assert.deepEqual(libBuildArgs(PICO.fqbn, '#include <Ethernet.h>'), []);
});
