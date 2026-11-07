// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modules SPI et série du mode fidèle (MFRC522, nRF24L01+, HC-05, SIM800L) avec les vraies bibliothèques : vidage
// complet d'un badge, lecteur tenu en reset, deux cartes radio en mode fidèle, une carte fidèle et une carte
// interprétée sur la même radio, accusés de réception avec charge utile, téléphone Bluetooth, SMS reçu.
// Sans arduino-cli sur la machine, ces tests sont ignorés. node --test src/emu/devices/spi_serial.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCli, compileSketch, fakeBoard, boot, runFor } from '../testkit.mjs';
import { presentBadge, serialDevice, periph } from '../../sim/models.js';
import { crcA } from './mfrc522.js';
import { snapBaud } from './uart.js';
import { compile } from '../../prog/lang.js';
import { createRuntime } from '../../prog/runtime.js';
import { BOARDS } from '../../sim/boards.js';

const skip = !hasCli && 'arduino-cli absent';
/** Carte en mode fidèle : programme compilé, modules branchés ; out accumule le port série. */
function fw(src, modules) {
  const { hw, comps } = fakeBoard({ modules });
  const rt = boot(compileSketch(src), hw);
  return { rt, hw, comps, out: '', take() { this.out += rt.takeSerial(); return this.out; } };
}
/** Plusieurs cartes qui avancent ensemble, par pas de dt ms (la radio passe de l'une à l'autre entre deux pas). */
function together(boards, ms, dt = 2) { for (let t = 0; t < ms; t += dt) for (const b of boards) b.rt.run(dt); boards.forEach(b => b.take && b.take()); }
/** Toutes les radios du montage, vues de chaque carte (hw.peers, comme makeHw dans l'application). */
function air(...boards) {
  const all = boards.flatMap(b => b.comps || b.radios);
  for (const b of boards) b.hw.peers = types => all.filter(c => types.includes(c.type)).map(c => ({ comp: c, ok: true }));
}

test('CRC_A (ISO 14443-3) et vitesses série normalisées', () => {
  assert.equal(crcA([0x00, 0x00]), 0x1ea0);
  assert.equal(crcA([0x12, 0x34]), 0xcf26);
  assert.equal(crcA([0x50, 0x00]), 0xcd57); // HLTA : 50 00 57 CD
  assert.equal(snapBaud(9615), 9600);
  assert.equal(snapBaud(117647), 115200);
  assert.equal(snapBaud(5000), 5000);
});

/* ---------- MFRC522 ---------- */
const DUMP = `#include <SPI.h>
#include <MFRC522.h>
MFRC522 rfid(10, 9);
void setup() { Serial.begin(115200); SPI.begin(); rfid.PCD_Init(); delay(4); rfid.PCD_DumpVersionToSerial(); }
void loop() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  rfid.PICC_DumpToSerial(&(rfid.uid));
}`;

test('MFRC522 : PICC_DumpToSerial vide les 16 secteurs du badge (exemple DumpInfo)', { skip }, () => {
  const b = fw(DUMP, [{ type: 'rc522', pins: { SDA: 'D10', RST: 'D9' } }]);
  runFor(b.rt, 200);
  presentBadge(b.comps[0], 1);
  runFor(b.rt, 1500);
  const out = b.take();
  assert.match(out, /Firmware Version: 0x92 = v2\.0/);
  assert.match(out, /Card UID: 12 34 56 78\r\nCard SAK: 08\r\nPICC type: MIFARE 1KB/);
  assert.match(out, /0\s+3\s+00 00 00 00 {2}00 00 FF 07 {2}80 69 FF FF {2}FF FF FF FF {2}\[ 0 0 1 \]/); // fin du secteur 0 (clé A illisible)
  assert.match(out, /\s+0\s+12 34 56 78 {2}08 08 04 00 {2}62 63 64 65 {2}66 67 68 69/); // bloc du fabricant : UID, BCC, SAK, ATQA
  assert.equal(out.match(/Card UID/g).length, 1, 'badge endormi (HLTA) : lu une fois');
  assert.doesNotMatch(out, /Timeout|MIFARE_Read\(\) failed|PCD_Authenticate\(\) failed/);
});

test('MFRC522 : RST jamais relevé, la puce reste éteinte et ne répond pas', { skip }, () => {
  // La bibliothèque ne connaît pas la broche RST (UNUSED_PIN) : elle reste en entrée, à LOW, la puce en reset.
  const b = fw(DUMP.replace('rfid(10, 9)', 'rfid(10, MFRC522::UNUSED_PIN)'), [{ type: 'rc522', pins: { SDA: 'D10', RST: 'D9' } }]);
  runFor(b.rt, 400);
  presentBadge(b.comps[0], 0);
  runFor(b.rt, 300);
  const out = b.take();
  assert.match(out, /Firmware Version: 0xFF = \(unknown\)/);
  assert.match(out, /WARNING: Communication failure/);
  assert.doesNotMatch(out, /Card UID/);
});

/* ---------- nRF24L01+ ---------- */
const TX = `#include <SPI.h>
#include <nRF24L01.h>
#include <RF24.h>
RF24 radio(7, 8); // CE, CSN
const byte address[6] = "00001";
void setup() {
  Serial.begin(115200);
  Serial.println(radio.begin() ? "begin ok" : "begin echec");
  Serial.println(radio.isChipConnected() ? "puce ok" : "puce absente");
  radio.openWritingPipe(address);
  radio.setPALevel(RF24_PA_MIN);
  radio.stopListening();
}
int n = 0;
void loop() {
  char text[32];
  sprintf(text, "Hello World %d", n++);
  bool ok = radio.write(&text, sizeof(text));
  Serial.println(ok ? "envoye" : "echec");
  delay(40);
}`;
const RX = `#include <SPI.h>
#include <RF24.h>
RF24 radio(9, 10);
const byte addresses[][6] = {"00001", "00002"};
void setup() {
  Serial.begin(115200);
  Serial.println(radio.begin() ? "begin ok" : "begin echec");
  radio.openReadingPipe(1, addresses[0]);
  radio.startListening();
}
void loop() {
  uint8_t tube;
  if (radio.available(&tube)) {
    char text[32] = "";
    radio.read(&text, sizeof(text));
    Serial.print(tube); Serial.print(":"); Serial.println(text);
  }
}`;
/** Le même émetteur pour l'interpréteur, qui n'a pas sprintf : un texte fixe. */
const TX_PLAIN = TX.replace(/char text\[32\];\n\s*sprintf\(text, "Hello World %d", n\+\+\);/, 'const char text[] = "Hello World";');
const radioTx = () => fw(TX, [{ type: 'nrf24', pins: { CE: 'D7', CSN: 'D8' } }]);
const radioRx = (src = RX) => fw(src, [{ type: 'nrf24', pins: { CE: 'D9', CSN: 'D10' } }]);

test('nRF24L01+ : deux cartes en mode fidèle, l’une émet, l’autre reçoit (RF24, accusés de réception)', { skip }, () => {
  const a = radioTx(), b = radioRx();
  air(a, b);
  together([a, b], 300);
  assert.match(a.out, /^begin ok\r\npuce ok\r\n(envoye\r\n){4,}/);
  assert.doesNotMatch(a.out, /echec/);
  assert.match(b.out, /^begin ok\r\n1:Hello World 0\r\n1:Hello World 1\r\n1:Hello World 2\r\n/);
  assert.deepEqual(b.comps[0].periph.pipes, [null, '3030303031', null, null, null, null]);
  assert.equal(b.comps[0].periph.listening, true);
});

test('nRF24L01+ : sans récepteur (ou sur un autre canal), write() échoue après les réessais (MAX_RT)', { skip }, () => {
  const a = radioTx(), b = radioRx(RX.replace('radio.startListening();', 'radio.setChannel(90); radio.startListening();'));
  air(a, b);
  together([a, b], 250);
  assert.match(a.out, /^begin ok\r\npuce ok\r\n(echec\r\n){2,}/);
  assert.doesNotMatch(a.out, /envoye/);
  assert.equal(b.out, 'begin ok\r\n');
});

test('nRF24L01+ : la broche IRQ passe à LOW à l’arrivée d’un paquet (attachInterrupt, RX_DR seul démasqué)', { skip }, () => {
  const IRQ = RX.replace('RF24 radio(9, 10);', 'RF24 radio(9, 10);\nvolatile int irqs = 0;\nvoid isr() { irqs++; }')
    .replace('radio.startListening();', 'radio.maskIRQ(1, 1, 0); attachInterrupt(digitalPinToInterrupt(2), isr, FALLING); radio.startListening();')
    .replace('if (radio.available(&tube)) {', 'if (irqs && radio.available(&tube)) { noInterrupts(); irqs = 0; interrupts(); Serial.print("irq ");');
  const a = radioTx(), b = fw(IRQ, [{ type: 'nrf24', pins: { CE: 'D9', CSN: 'D10', IRQ: 'D2' } }]);
  air(a, b);
  together([a, b], 250);
  assert.match(b.out, /^begin ok\r\nirq 1:Hello World 0\r\nirq 1:Hello World 1\r\nirq 1:Hello World 2\r\n/);
  assert.equal(b.rt.hw.pinApi.level('D2'), 1, 'RX_DR effacé par read() : IRQ revenue à HIGH');
});

/** Carte interprétée (src/prog) sur un pont minimal : fils vers les modules, radios de tout le montage. */
function interp(src, wires, radios) {
  const c = compile(src, { board: 'uno' });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const at = k => wires[k] || [];
  const hw = {
    kind: 'uno', label: 'uno', prof: BOARDS.uno, read: () => null, echo: () => null, data: () => null, at, bus: () => [], i2c: () => [],
    onPin: (k, types) => { const h = at(k).find(x => types.includes(x.comp.type)); return h ? h.comp : null; },
    status: () => ({ ok: true, msg: '' }), mem: () => ({ ee: '', prefs: {} }), level: () => null
  };
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  return { rt, hw, radios, out: '', take() { this.out += rt.takeSerial(); return this.out; } };
}

test('nRF24L01+ : une carte en mode fidèle et une carte interprétée se parlent, dans les deux sens', { skip }, () => {
  // Carte fidèle → carte interprétée.
  const a = radioTx(), r = { type: 'nrf24', id: 'radio-interp', name: 'NRF', periph: null };
  const b = interp(RX, { D9: [{ comp: r, pin: 'CE' }], D10: [{ comp: r, pin: 'CSN' }] }, [r]);
  air(a, b);
  together([a, b], 300);
  assert.doesNotMatch(a.out, /echec/);
  assert.match(b.out, /begin ok\n1:Hello World 0\n1:Hello World 1\n/);
  // Carte interprétée → carte fidèle.
  const t = { type: 'nrf24', id: 'radio-interp-tx', name: 'NRF2', periph: null };
  const c = interp(TX_PLAIN, { D7: [{ comp: t, pin: 'CE' }], D8: [{ comp: t, pin: 'CSN' }] }, [t]), d = radioRx();
  air(c, d);
  runFor(d.rt, 50); // le récepteur écoute avant que l'émetteur ne démarre
  together([d, c], 300);
  assert.match(c.out, /envoye\n/);
  assert.doesNotMatch(c.out, /echec/);
  assert.match(d.out, /^begin ok\r\n1:Hello World\r\n1:Hello World\r\n/);
});

test('nRF24L01+ : charges utiles dynamiques et accusés de réception avec charge utile', { skip }, () => {
  const PTX = `#include <SPI.h>
#include <RF24.h>
RF24 radio(7, 8);
const byte adr[6] = "1Node";
void setup() {
  Serial.begin(115200);
  radio.begin();
  radio.enableDynamicPayloads();
  radio.enableAckPayload();
  radio.openWritingPipe(adr);
  radio.stopListening();
}
byte n = 0;
void loop() {
  char msg[8];
  sprintf(msg, "ping%d", n++);
  if (radio.write(msg, strlen(msg) + 1) && radio.available()) {
    char rep[32] = "";
    byte len = radio.getDynamicPayloadSize();
    radio.read(rep, len);
    Serial.print("ack:"); Serial.print(rep); Serial.print(" "); Serial.println(len);
  }
  delay(30);
}`;
  const PRX = `#include <SPI.h>
#include <RF24.h>
RF24 radio(9, 10);
const byte adr[6] = "1Node";
byte k = 0;
void setup() {
  Serial.begin(115200);
  radio.begin();
  radio.enableDynamicPayloads();
  radio.enableAckPayload();
  radio.openReadingPipe(1, adr);
  char rep[] = "pong0";
  radio.writeAckPayload(1, rep, sizeof(rep));
  radio.startListening();
}
void loop() {
  if (radio.available()) {
    byte len = radio.getDynamicPayloadSize();
    char msg[33] = "";
    radio.read(msg, len);
    Serial.print("recu:"); Serial.print(msg); Serial.print(" "); Serial.println(len);
    char rep[] = "pongX";
    rep[4] = '1' + k++;
    radio.writeAckPayload(1, rep, sizeof(rep));
  }
}`;
  const a = fw(PTX, [{ type: 'nrf24', pins: { CE: 'D7', CSN: 'D8' } }]), b = radioRx(PRX);
  air(a, b);
  together([b, a], 250);
  assert.match(b.out, /^recu:ping0 6\r\nrecu:ping1 6\r\n/);
  assert.match(a.out, /^ack:pong0 6\r\nack:pong1 6\r\nack:pong2 6\r\n/);
});

/* ---------- HC-05 et SIM800L ---------- */
const BT = `#include <SoftwareSerial.h>
SoftwareSerial bt(10, 11); // RX, TX
void setup() { Serial.begin(115200); bt.begin(9600); bt.println("Bonjour telephone"); }
void loop() {
  if (bt.available()) {
    String s = bt.readStringUntil('\\n');
    Serial.print("recu:"); Serial.println(s);
    bt.print("echo "); bt.println(s);
  }
}`;

test('HC-05 : conversation avec le téléphone par SoftwareSerial (mode données, 9600 bauds)', { skip }, () => {
  const b = fw(BT, [{ type: 'hc05', pins: { TXD: 'D10', RXD: 'D11' } }]), h = b.comps[0];
  runFor(b.rt, 200);
  assert.deepEqual(periph(h).log.map(m => m.text), ['Bonjour telephone']);
  serialDevice(h).phone('salut la carte');
  runFor(b.rt, 300);
  assert.match(b.take(), /recu:salut la carte\r\n/);
  assert.deepEqual(periph(h).log.filter(m => m.who === 'board').map(m => m.text), ['Bonjour telephone', 'echo salut la carte']);
});

test('HC-05 : liaison à 38400 bauds alors que le module est à 9600 : du charabia dans les deux sens', { skip }, () => {
  const b = fw(BT.replace('bt.begin(9600)', 'bt.begin(38400)'), [{ type: 'hc05', pins: { TXD: 'D10', RXD: 'D11' } }]), h = b.comps[0];
  runFor(b.rt, 200);
  serialDevice(h).phone('salut');
  runFor(b.rt, 300);
  assert.doesNotMatch(b.take(), /salut/);
  assert.ok(!periph(h).log.some(m => m.who === 'board' && /Bonjour/.test(m.text)));
});

test('HC-05 : sur le port série matériel (D0/D1), le téléphone parle au programme', { skip }, () => {
  const src = `void setup() { Serial.begin(9600); pinMode(13, OUTPUT); }
void loop() {
  if (Serial.available()) { char c = Serial.read(); if (c == '1') { digitalWrite(13, HIGH); Serial.println("LED allumee"); } }
}`;
  const b = fw(src, [{ type: 'hc05', pins: { TXD: 'D0', RXD: 'D1' } }]), h = b.comps[0];
  runFor(b.rt, 100);
  serialDevice(h).phone('1', '');
  runFor(b.rt, 200);
  assert.equal(b.rt.pins.get('D13').d, 1);
  assert.deepEqual(periph(h).log.filter(m => m.who === 'board').map(m => m.text), ['LED allumee']);
});

test('SIM800L : un SMS reçu est notifié (+CMTI) puis lu (AT+CMGR) par SoftwareSerial', { skip }, () => {
  const src = `#include <SoftwareSerial.h>
SoftwareSerial gsm(7, 8);
String ligne = "";
void setup() { Serial.begin(115200); gsm.begin(19200); delay(100); gsm.println("AT+CMGF=1"); }
void loop() {
  while (gsm.available()) {
    char c = gsm.read();
    if (c == '\\n') {
      ligne.trim();
      if (ligne.startsWith("+CMTI:")) { gsm.print("AT+CMGR="); gsm.println(ligne.substring(ligne.indexOf(',') + 1)); }
      else if (ligne.length()) { Serial.print("> "); Serial.println(ligne); }
      ligne = "";
    } else ligne += c;
  }
}`;
  const b = fw(src, [{ type: 'sim800', pins: { TXD: 'D7', RXD: 'D8' } }]), g = b.comps[0];
  runFor(b.rt, 400);
  serialDevice(g).receive('Rendez-vous a 18h');
  runFor(b.rt, 600);
  const out = b.take();
  assert.match(out, /> AT\+CMGF=1\r\n> OK\r\n/);
  assert.match(out, /> \+CMGR: "REC UNREAD","\+221770000000","","[^"]+"\r\n> Rendez-vous a 18h\r\n> OK\r\n/);
});
