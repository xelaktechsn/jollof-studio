// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Bibliothèques simulées (IRremote, MFRC522, RF24, Keypad, HC-05, SIM800, DallasTemperature, ESP32Servo, SSD1306,
// I2C, ESP32, pulseIn, MPU6050, NeoPixel, EEPROM, Preferences, BluetoothSerial, WiFi, WebServer, HTTPClient, ESP-NOW) :
// chaque croquis est compilé puis exécuté sur un montage factice.
// node --test src/prog/libs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './lang.js';
import { createRuntime } from './runtime.js';
import { BOARDS } from '../sim/boards.js';
import { periph, irPress, presentBadge, keypadDown, keypadUp, serialDevice, btSerial, macOf, cleanHtml, NET_DEFAULT, ENV, MODELS } from '../sim/models.js';

/**
 * Carte sur un montage factice. o.wires : broche de la carte → [{ comp, pin }] ; o.bus : modules I2C [{ comp, addr }] ;
 * o.peers : modules de tout le montage ; o.read(k), o.echo(k), o.trig(k). Un composant { ok: false } est mal alimenté.
 */
function board(kind, o = {}) {
  const wires = o.wires || {};
  return {
    kind, label: kind, prof: BOARDS[kind],
    read: k => (o.read ? o.read(k) : null),
    echo: k => (o.echo ? o.echo(k) : null),
    trig: o.trig,
    onPin: (k, types) => { const h = (wires[k] || []).find(x => types.includes(x.comp.type)); return h ? h.comp : null; },
    at: k => wires[k] || [],
    bus: types => (o.bus || []).filter(d => types.includes(d.comp.type)),
    i2c: () => o.bus || [],
    status: c => ({ ok: c.ok !== false, msg: c.ok === false ? 'VCC reçoit 5 V, au-delà de 3,6 V : risque de destruction' : '' }),
    peers: types => (o.peers || []).filter(c => types.includes(c.type)).map(c => ({ comp: c, ok: c.ok !== false })),
    data: c => c.data || null,
    // Carte elle-même, mémoire gardée avec le projet, réseau simulé, niveau d'une broche de module.
    self: () => o.self || (o.self = { type: kind, id: 'carte-' + kind + '-' + Math.random().toString(36).slice(2, 7), name: kind }),
    mem: () => o.mem || (o.mem = { ee: '', prefs: {} }), memChanged: () => { o.memSaves = (o.memSaves || 0) + 1; },
    net: () => o.net || (o.net = NET_DEFAULT()), netChanged: () => {},
    level: (c, k) => (o.level ? o.level(c, k) : null)
  };
}
function start(src, hw, ctx = {}) {
  const c = compile(src, { board: hw.kind, ...ctx });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  rt.out = '';
  rt.step = (n = 1, dt = 16) => { for (let i = 0; i < n; i++) { rt.run(dt); rt.out += rt.takeSerial(); } assert.notEqual(rt.state, 'error', rt.error && rt.error.msg); return rt; };
  return rt;
}
const warned = (rt, re) => [...rt.warnings.values()].some(w => re.test(w.msg));
let uid = 0;
const comp = (type, x = {}) => ({ type, id: type + ++uid, name: type.toUpperCase() + uid, ...x });

/* ---------- IRremote ---------- */
const IR_SKETCH = `#include <IRremote.hpp>
#define IR_RECEIVE_PIN 2
void setup() {
  Serial.begin(9600);
  IrReceiver.begin(IR_RECEIVE_PIN, ENABLE_LED_FEEDBACK);
}
void loop() {
  if (IrReceiver.decode()) {
    if (IrReceiver.decodedIRData.flags & IRDATA_FLAGS_IS_REPEAT) Serial.print("R ");
    Serial.print("cmd=");
    Serial.println(IrReceiver.decodedIRData.command, HEX);
    IrReceiver.printIRResultShort(&Serial);
    if (IrReceiver.decodedIRData.protocol == NEC && IrReceiver.decodedIRData.address == 0) Serial.println("NEC");
    IrReceiver.resume();
  }
}`;

test('IRremote v4 : une touche de la télécommande est décodée une fois, avec printIRResultShort', () => {
  const c = compile(IR_SKETCH, { board: 'uno' });
  assert.ok(!c.warnings.some(w => w.code === 'J1109'), 'IRremote est connu du simulateur');
  const ir = comp('ir'), rt = start(IR_SKETCH, board('uno', { wires: { D2: [{ comp: ir, pin: 'OUT' }] } }));
  rt.step(3);
  irPress(ir, 0x45);
  rt.step(3);
  assert.match(rt.out, /cmd=45\n/);
  assert.match(rt.out, /Protocol=NEC Address=0x0 Command=0x45 Raw-Data=0xBA45FF00 32 bits LSB first\n/);
  assert.match(rt.out, /NEC\n/);
  assert.equal(rt.out.match(/cmd=/g).length, 1, 'une seule trame décodée');
  irPress(ir, 0x15, false); irPress(ir, 0x15, true);
  rt.step(3);
  assert.match(rt.out, /cmd=15\n/);
});

test('IRremote : récepteur mal alimenté, et ancienne API decode(&results)', () => {
  const ir = comp('ir', { ok: false }), rt = start(IR_SKETCH, board('uno', { wires: { D2: [{ comp: ir, pin: 'OUT' }] } }));
  rt.step(2); irPress(ir, 0x46); rt.step(3);
  assert.doesNotMatch(rt.out, /cmd=/);
  assert.ok(warned(rt, /récepteur infrarouge/));
  const OLD = `#include <IRremote.h>
IRrecv irrecv(11);
decode_results results;
void setup() { Serial.begin(9600); irrecv.enableIRIn(); }
void loop() {
  if (irrecv.decode(&results)) { Serial.println(results.value, HEX); irrecv.resume(); }
}`;
  const ir2 = comp('ir'), rt2 = start(OLD, board('uno', { wires: { D11: [{ comp: ir2, pin: 'OUT' }] } }));
  rt2.step(2); irPress(ir2, 0x45); rt2.step(3);
  assert.match(rt2.out, /^FFA25D\n/m);
});

/* ---------- MFRC522 ---------- */
const RFID_SKETCH = `#include <SPI.h>
#include <MFRC522.h>
#define SS_PIN 10
#define RST_PIN 9
MFRC522 rfid(SS_PIN, RST_PIN);
void setup() {
  Serial.begin(9600);
  SPI.begin();
  rfid.PCD_Init();
  rfid.PCD_DumpVersionToSerial();
}
void loop() {
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;
  MFRC522::PICC_Type piccType = rfid.PICC_GetType(rfid.uid.sak);
  Serial.println(rfid.PICC_GetTypeName(piccType));
  Serial.print("UID :");
  for (byte i = 0; i < rfid.uid.size; i++) {
    Serial.print(rfid.uid.uidByte[i] < 0x10 ? " 0" : " ");
    Serial.print(rfid.uid.uidByte[i], HEX);
  }
  Serial.println();
  if (piccType == MFRC522::PICC_TYPE_MIFARE_1K) Serial.println("1K");
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}`;

test('MFRC522 : un badge posé est lu une fois par présentation', () => {
  const r = comp('rc522'), rt = start(RFID_SKETCH, board('uno', { wires: { D10: [{ comp: r, pin: 'SDA' }], D9: [{ comp: r, pin: 'RST' }] } }));
  rt.step(3);
  assert.match(rt.out, /Firmware Version: 0x92 = v2.0/);
  presentBadge(r, 0); rt.step(10);
  assert.match(rt.out, /MIFARE 1KB\nUID : DE AD BE EF\n1K\n/);
  assert.equal(rt.out.match(/UID/g).length, 1, 'badge laissé sur le lecteur : lu une seule fois');
  presentBadge(r, 0); rt.step(3); // retiré
  presentBadge(r, 2); rt.step(3);
  assert.match(rt.out, /UID : A1 B2 C3 D4/);
  assert.equal(rt.out.match(/UID/g).length, 2);
});

test('MFRC522 : lecture et écriture d’un bloc du badge', () => {
  const SRC = `#include <SPI.h>
#include <MFRC522.h>
MFRC522 rfid(10, 9);
MFRC522::MIFARE_Key key;
void setup() { Serial.begin(9600); SPI.begin(); rfid.PCD_Init(); for (byte i = 0; i < 6; i++) key.keyByte[i] = 0xFF; }
void loop() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  byte status = rfid.PCD_Authenticate(MFRC522::PICC_CMD_MF_AUTH_KEY_A, 4, &key, &(rfid.uid));
  byte data[16] = {65, 119, 97};
  status = rfid.MIFARE_Write(4, data, 16);
  byte buffer[18];
  byte size = sizeof(buffer);
  status = rfid.MIFARE_Read(4, buffer, &size);
  Serial.println(rfid.GetStatusCodeName(status));
  Serial.println(size);
  Serial.println(buffer[1]);
  rfid.PICC_HaltA(); rfid.PCD_StopCrypto1();
}`;
  const r = comp('rc522'), rt = start(SRC, board('uno', { wires: { D10: [{ comp: r, pin: 'SDA' }] } }));
  rt.step(2); presentBadge(r, 1); rt.step(4);
  assert.match(rt.out, /Success\.\n18\n119\n/);
});

/* ---------- RF24 : deux cartes ---------- */
const TX = `#include <SPI.h>
#include <nRF24L01.h>
#include <RF24.h>
RF24 radio(7, 8); // CE, CSN
const byte address[6] = "00001";
float mesures[2] = {21.5, -3.25};
void setup() {
  Serial.begin(9600);
  radio.begin();
  radio.openWritingPipe(address);
  radio.setPALevel(RF24_PA_MIN);
  radio.stopListening();
}
void loop() {
  const char text[] = "Hello World";
  bool ok = radio.write(&text, sizeof(text));
  Serial.println(ok ? "envoye" : "echec");
  radio.write(&mesures, sizeof(mesures));
  long n = -70000;
  radio.write(&n, sizeof(n));
  delay(1000);
}`;
const RX = `#include <SPI.h>
#include <RF24.h>
RF24 radio(4, 5);
const byte addresses[][6] = {"00001", "00002"};
int recus = 0;
void setup() {
  Serial.begin(115200);
  radio.begin();
  radio.openReadingPipe(1, addresses[0]);
  radio.setPALevel(RF24_PA_MIN);
  radio.startListening();
}
void loop() {
  uint8_t tube;
  if (radio.available(&tube)) {
    if (recus % 3 == 0) {
      char text[32] = "";
      radio.read(&text, sizeof(text));
      Serial.print(tube); Serial.print(":"); Serial.println(text);
    } else if (recus % 3 == 1) {
      float m[2];
      radio.read(&m, sizeof(m));
      Serial.println(m[0] + m[1]);
    } else {
      int32_t n;
      radio.read(&n, sizeof(n));
      Serial.println(n);
    }
    recus++;
  }
}`;

test('RF24 : une carte émet, l’autre reçoit (texte, tableau de float, long)', () => {
  const a = comp('nrf24'), b = comp('nrf24'), peers = [a, b];
  const tx = start(TX, board('uno', { wires: { D7: [{ comp: a, pin: 'CE' }], D8: [{ comp: a, pin: 'CSN' }] }, peers }));
  const rx = start(RX, board('esp32', { wires: { D4: [{ comp: b, pin: 'CE' }], D5: [{ comp: b, pin: 'CSN' }] }, peers }));
  rx.step(2);
  for (let i = 0; i < 80; i++) { tx.step(1); rx.step(1); }
  assert.match(tx.out, /^envoye\n/);
  assert.match(rx.out, /^1:Hello World\n18\.25\n-70000\n1:Hello World\n/);
  assert.equal(a.periph.sent >= 3, true);
});

test('RF24 : sans récepteur write() échoue ; module alimenté en 5 V : begin() échoue', () => {
  const a = comp('nrf24');
  const tx = start(TX, board('uno', { wires: { D7: [{ comp: a, pin: 'CE' }] }, peers: [a] }));
  tx.step(3);
  assert.match(tx.out, /^echec\n/);
  const bad = comp('nrf24', { ok: false });
  const t2 = start(TX, board('uno', { wires: { D7: [{ comp: bad, pin: 'CE' }] }, peers: [bad] }));
  t2.step(3);
  assert.ok(warned(t2, /ne répond pas/));
  assert.match(t2.out, /^echec\n/);
});

test('RF24 : adresse numérique, int de 2 octets (Uno) lu dans un int de 4 octets (ESP32)', () => {
  const S = `#include <RF24.h>
RF24 radio(7, 8);
const uint64_t tube = 0xF0F0F0F0E1LL;
void setup() { radio.begin(); radio.openWritingPipe(tube); radio.stopListening(); }
void loop() { int v = -2; radio.write(&v, sizeof(v)); delay(500); }`;
  const R = `#include <RF24.h>
RF24 radio(4, 5);
void setup() { Serial.begin(9600); radio.begin(); radio.openReadingPipe(1, 0xF0F0F0F0E1LL); radio.startListening(); }
void loop() { if (radio.available()) { int v = 0; radio.read(&v, sizeof(v)); Serial.println(v); } }`;
  const a = comp('nrf24'), b = comp('nrf24'), peers = [a, b];
  const tx = start(S, board('uno', { wires: { D7: [{ comp: a, pin: 'CE' }] }, peers }));
  const rx = start(R, board('esp32', { wires: { D4: [{ comp: b, pin: 'CE' }] }, peers }));
  rx.step(2); for (let i = 0; i < 10; i++) { tx.step(1); rx.step(1); }
  assert.match(rx.out, /^65534\n/, 'les deux octets de -2 complétés de zéros, comme sur de vraies cartes');
});

/* ---------- HC-05 ---------- */
const BT = `#include <SoftwareSerial.h>
SoftwareSerial bt(10, 11); // RX, TX
void setup() { Serial.begin(9600); bt.begin(9600); bt.println("Pret"); }
void loop() {
  if (bt.available()) {
    String cmd = bt.readStringUntil('\\n');
    if (cmd == "ON") bt.println("LED allumee");
    Serial.println(cmd);
  }
}`;

test('HC-05 : le téléphone Bluetooth parle à la carte par SoftwareSerial', () => {
  const h = comp('hc05'), rt = start(BT, board('uno', { wires: { D10: [{ comp: h, pin: 'TXD' }], D11: [{ comp: h, pin: 'RXD' }] } }));
  rt.step(2);
  serialDevice(h).phone('ON');
  rt.step(3);
  assert.match(rt.out, /^ON\n/m);
  assert.deepEqual(periph(h).log.map(m => `${m.who}:${m.text}`), ['board:Pret', 'phone:ON', 'board:LED allumee']);
  // Fils inversés : aucune liaison, et un avertissement.
  const h2 = comp('hc05'), rt2 = start(BT, board('uno', { wires: { D10: [{ comp: h2, pin: 'RXD' }], D11: [{ comp: h2, pin: 'TXD' }] } }));
  rt2.step(2);
  assert.ok(warned(rt2, /inversés/));
  assert.equal(periph(h2).log.length, 0);
});

/* ---------- SIM800 ---------- */
test('SIM800 : commandes AT, SMS envoyé, SMS reçu, appel (Serial2 de l’ESP32)', () => {
  const SRC = `HardwareSerial &gsm = Serial2;
void lire() { delay(200); while (Serial2.available()) Serial.write(Serial2.read()); }
void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
  Serial2.println("AT"); lire();
  Serial2.println("AT+CSQ"); lire();
  Serial2.println("AT+CMGF=1"); lire();
  Serial2.println("AT+CMGS=\\"+221771234567\\""); lire();
  Serial2.print("Alerte : porte ouverte");
  Serial2.write(26); lire();
  Serial2.println("ATD+221771234567;"); lire();
}
void loop() {
  if (Serial2.available()) {
    String l = Serial2.readStringUntil('\\n');
    if (l.startsWith("+CMTI")) { Serial2.println("AT+CMGR=1"); }
    Serial.println(l);
  }
}`;
  // Une référence (&) vers un port série n'est pas prise en charge : version sans la variable gsm.
  const src = SRC.replace('HardwareSerial &gsm = Serial2;\n', '');
  const g = comp('sim800'), rt = start(src, board('esp32', { wires: { RX2: [{ comp: g, pin: 'TXD' }], TX2: [{ comp: g, pin: 'RXD' }] } }));
  rt.step(120);
  assert.match(rt.out, /AT\r\r\nOK\r\n/);
  assert.match(rt.out, /\+CSQ: 20,0\r\n\r\nOK/);
  assert.match(rt.out, /> /);
  assert.match(rt.out, /\+CMGS: 1\r\n\r\nOK/);
  const st = periph(g);
  assert.deepEqual(st.sent.map(m => [m.to, m.text]), [['+221771234567', 'Alerte : porte ouverte']]);
  assert.equal(st.call.number, '+221771234567');
  serialDevice(g).receive('Bonjour la classe');
  rt.step(30);
  assert.match(rt.out, /\+CMTI: "SM",1/);
  assert.match(rt.out, /\+CMGR: "REC UNREAD","\+221770000000"/);
  assert.match(rt.out, /Bonjour la classe/);
});

test('SIM800 : AT+CMGS sans AT+CMGF=1 est refusé', () => {
  const g = comp('sim800');
  const rt = start(`#include <SoftwareSerial.h>
SoftwareSerial sim(7, 8);
void setup() { Serial.begin(9600); sim.begin(9600); sim.println("AT+CMGS=\\"+22177\\""); delay(100); while (sim.available()) Serial.write(sim.read()); }
void loop() {}`, board('uno', { wires: { D7: [{ comp: g, pin: 'TXD' }], D8: [{ comp: g, pin: 'RXD' }] } }));
  rt.step(20);
  assert.match(rt.out, /ERROR/);
  assert.equal(periph(g).hint, 'cmgf');
});

/* ---------- Keypad ---------- */
const KP = `#include <Keypad.h>
const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
byte rowPins[ROWS] = {9, 8, 7, 6};
byte colPins[COLS] = {5, 4, 3, 2};
Keypad kp = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);
void setup() { Serial.begin(9600); }
void loop() {
  char key = kp.getKey();
  if (key != NO_KEY) Serial.println(key);
}`;
const kpWires = (k, swap) => {
  const w = {}, R = ['D9', 'D8', 'D7', 'D6'], C = ['D5', 'D4', 'D3', 'D2'];
  R.forEach((p, i) => { w[p] = [{ comp: k, pin: (swap ? 'C' : 'R') + (i + 1) }]; });
  C.forEach((p, i) => { w[p] = [{ comp: k, pin: (swap ? 'R' : 'C') + (i + 1) }]; });
  return w;
};

test('Keypad : la touche appuyée est lue une fois, selon le câblage', () => {
  const k = comp('keypad'), rt = start(KP, board('uno', { wires: kpWires(k) }));
  rt.step(2);
  keypadDown(k, 0, 1); rt.step(3); keypadUp(k); rt.step(2);
  keypadDown(k, 3, 3); keypadUp(k); rt.step(2); // clic rapide entre deux lectures
  assert.equal(rt.out, '2\nD\n');
  // Lignes et colonnes inversées au câblage : le tableau est lu transposé.
  const k2 = comp('keypad'), rt2 = start(KP, board('uno', { wires: kpWires(k2, true) }));
  rt2.step(2); keypadDown(k2, 0, 1); keypadUp(k2); rt2.step(2);
  assert.equal(rt2.out, '4\n');
});

test('Keypad : waitForKey() attend une touche', () => {
  const k = comp('keypad'), rt = start(KP.replace('char key = kp.getKey();\n  if (key != NO_KEY) Serial.println(key);', 'char key = kp.waitForKey();\n  Serial.print("touche ");\n  Serial.println(key);'), board('uno', { wires: kpWires(k) }));
  rt.step(10);
  assert.equal(rt.out, '');
  keypadDown(k, 2, 2); keypadUp(k); rt.step(3);
  assert.equal(rt.out, 'touche 9\n');
});

/* ---------- Classe::CONSTANTE, DallasTemperature, ESP32Servo ---------- */
test('Classe::CONSTANTE et Classe::méthode() : BMP280, ESP32PWM, DallasTemperature', () => {
  const SRC = `#include <Adafruit_BMP280.h>
#include <ESP32Servo.h>
#include <DallasTemperature.h>
Adafruit_BMP280 bmp;
void setup() {
  Serial.begin(115200);
  ESP32PWM::allocateTimer(0);
  if (!bmp.begin(0x76)) Serial.println("absent");
  bmp.setSampling(Adafruit_BMP280::MODE_NORMAL, Adafruit_BMP280::SAMPLING_X2, Adafruit_BMP280::SAMPLING_X16, Adafruit_BMP280::FILTER_X16, Adafruit_BMP280::STANDBY_MS_500);
  Serial.println(Adafruit_BMP280::MODE_NORMAL);
  Serial.println(DallasTemperature::toFahrenheit(20));
  Serial.println(bmp.readPressure() / 100);
}
void loop() {}`;
  const bmp = comp('bmp280', { data: { press: 1000, temp: 25 } });
  const rt = start(SRC, board('esp32', { bus: [{ comp: bmp, addr: [0x76] }] }));
  rt.step(2);
  assert.equal(rt.out, '3\n68.00\n1000.00\n');
  const bad = compile('void setup() { int x = Adafruit_BMP280::MODE_TURBO; }\nvoid loop() {}', { board: 'uno' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].code, 'J1101');
});

test('DallasTemperature : DeviceAddress, getAddress, getTempC(adresse), résolution et durée de conversion', () => {
  const SRC = `#include <OneWire.h>
#include <DallasTemperature.h>
OneWire oneWire(4);
DallasTemperature sensors(&oneWire);
DeviceAddress sonde;
void afficher(DeviceAddress a) { for (uint8_t i = 0; i < 8; i++) { if (a[i] < 16) Serial.print("0"); Serial.print(a[i], HEX); } Serial.println(); }
void setup() {
  Serial.begin(9600);
  sensors.begin();
  Serial.println(sensors.getDeviceCount());
  if (!sensors.getAddress(sonde, 0)) Serial.println("pas de sonde");
  afficher(sonde);
  Serial.println(sizeof(sonde));
  sensors.setResolution(9);
  unsigned long t0 = millis();
  sensors.requestTemperatures();
  Serial.println(millis() - t0);
  float t = sensors.getTempC(sonde);
  if (t == DEVICE_DISCONNECTED_C) Serial.println("deconnectee");
  Serial.println(t);
  DeviceAddress autre = {0x28, 1, 2, 3, 4, 5, 6, 7};
  Serial.println(sensors.getTempC(autre));
  Serial.println(DEVICE_DISCONNECTED_F);
}
void loop() {}`;
  const ds = comp('ds18b20', { data: { temp: 21.3 } });
  const rt = start(SRC, board('uno', { wires: { D4: [{ comp: ds, pin: 'DQ' }] } }));
  rt.step(20);
  const lines = rt.out.split('\n');
  assert.equal(lines[0], '1');
  assert.match(lines[1], /^28[0-9A-F]{14}$/);
  assert.equal(lines[2], '8');
  assert.equal(lines[3], '94');
  assert.equal(lines[4], '21.50', 'résolution 9 bits : pas de 0,5 °C');
  assert.equal(lines[5], '-127.00');
  assert.equal(lines[6], '-196.60');
});

test('ESP32Servo : setPeriodHertz, attach(broche, min, max) ; Servo.h sur ESP32 : avertissement J1109', () => {
  const SRC = `#include <ESP32Servo.h>
Servo s;
void setup() { s.setPeriodHertz(50); s.attach(18, 1000, 2000); s.write(0); }
void loop() { delay(100); s.write(180); }`;
  const rt = start(SRC, board('esp32'));
  rt.step(1);
  assert.equal(rt.pins.get('D18').servo, 44, '1000 µs sur un SG90');
  rt.step(10);
  assert.equal(rt.pins.get('D18').servo, 141, '2000 µs sur un SG90');
  const w = compile(SRC.replace('ESP32Servo.h', 'Servo.h'), { board: 'esp32' }).warnings;
  assert.ok(w.some(x => x.code === 'J1109' && /ESP32Servo/.test(x.msg) && x.line === 1));
  assert.ok(!compile(SRC.replace('ESP32Servo.h', 'Servo.h'), { board: 'uno' }).warnings.length);
});

/* ---------- SSD1306, I2C ---------- */
test('SSD1306 : begin() sans adresse vise 0x3D ; drawBitmap, drawChar, getTextBounds', () => {
  const oled = comp('oled'), hw = board('uno', { bus: [{ comp: oled, addr: [0x3c] }] });
  const a = start(`#include <Adafruit_SSD1306.h>
Adafruit_SSD1306 display(128, 64, &Wire, -1);
void setup() { Serial.begin(9600); if (!display.begin(SSD1306_SWITCHCAPVCC)) Serial.println("echec"); }
void loop() {}`, hw);
  a.step(2);
  assert.equal(a.out, 'echec\n');
  assert.ok(warned(a, /0x3D/));
  const b = start(`#include <Adafruit_SSD1306.h>
Adafruit_SSD1306 display(128, 64, &Wire, -1);
const unsigned char logo[] PROGMEM = {0xF0, 0x0F, 0x81, 0x80};
void setup() {
  Serial.begin(9600);
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.clearDisplay();
  display.drawBitmap(10, 20, logo, 16, 2, SSD1306_WHITE);
  display.drawChar(0, 0, 'A', SSD1306_WHITE, SSD1306_BLACK, 2);
  int16_t x1, y1; uint16_t w, h;
  display.setTextSize(2);
  display.getTextBounds("Salut", 4, 8, &x1, &y1, &w, &h);
  Serial.print(x1); Serial.print(" "); Serial.print(y1); Serial.print(" "); Serial.print(w); Serial.print(" "); Serial.println(h);
  display.display();
}
void loop() {}`, hw);
  b.step(2);
  assert.equal(b.out, '4 8 60 16\n');
  const ops = oled.progScreen.ops;
  assert.deepEqual(ops.filter(o => o.t === 'rect' && o.h === 1 && o.y >= 20).map(o => [o.x, o.y, o.w]), [[10, 20, 4], [22, 20, 4], [10, 21, 1], [17, 21, 2]]);
  assert.ok(ops.some(o => o.t === 'text' && o.str === 'A' && o.s === 2));
});

test('I2C : le scanner ne trouve que les modules câblés ; le LCD ne répond qu’à son adresse', () => {
  const SCAN = `#include <Wire.h>
void setup() { Serial.begin(9600); Wire.begin(); }
void loop() {
  byte n = 0;
  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    byte error = Wire.endTransmission();
    if (error == 0) { Serial.print("0x"); if (address < 16) Serial.print("0"); Serial.println(address, HEX); n++; }
  }
  Serial.println(n);
  delay(5000);
}`;
  const lcd = comp('lcd1602'), oled = comp('oled'), hw = board('uno', { bus: [{ comp: lcd, addr: [0x27] }, { comp: oled, addr: [0x3c] }] });
  const rt = start(SCAN, hw);
  rt.step(2);
  assert.equal(rt.out, '0x27\n0x3C\n2\n');
  const l = start(`#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x3F, 16, 2);
void setup() { lcd.init(); lcd.backlight(); lcd.print("Bonjour"); }
void loop() {}`, hw);
  l.step(2);
  assert.ok(warned(l, /0x3F/));
  assert.equal(lcd.progScreen, undefined);
});

/* ---------- ESP32, pulseIn, MPU6050, NeoPixel, Pico ---------- */
test('ESP32 : dacWrite, touchRead, analogReadMilliVolts', () => {
  const rt = start(`void setup() {
  Serial.begin(115200);
  dacWrite(25, 128);
  int t = touchRead(T0);
  Serial.println(t > 40 && t < 80 ? "repos" : "touche");
  Serial.println(analogReadMilliVolts(34));
  dacWrite(13, 10);
}
void loop() {}`, board('esp32', { read: k => (k === 'D34' ? { v: 1.2 } : null) }));
  rt.step(2);
  assert.equal(rt.out, 'repos\n1200\n');
  const p = rt.probe('D25');
  assert.ok(Math.abs(p.v - 128 / 255 * 3.3) < 1e-9);
  assert.ok(warned(rt, /25 et 26/));
});

test('pulseIn : HC-SR04 seulement après une impulsion de 10 µs sur TRIG, délai d’attente respecté', () => {
  const SRC = trig => `void setup() { Serial.begin(9600); pinMode(5, OUTPUT); pinMode(6, INPUT); }
void loop() {
  digitalWrite(5, LOW); delayMicroseconds(2);
  ${trig ? 'digitalWrite(5, HIGH); delayMicroseconds(10); digitalWrite(5, LOW);' : ''}
  unsigned long t0 = micros();
  long us = pulseIn(6, HIGH, 30000);
  Serial.print(us); Serial.print(" "); Serial.println(micros() - t0);
  delay(100);
}`;
  const hw = us => board('uno', { echo: k => (k === 'D6' ? us : null), trig: k => (k === 'D6' ? 'D5' : undefined) });
  const ok = start(SRC(true), hw(1160)); ok.step(2);
  assert.match(ok.out, /^1160 1160\n/);
  const none = start(SRC(false), hw(1160)); none.step(5);
  assert.match(none.out, /^0 30000\n/);
  assert.ok(warned(none, /TRIG/));
  const far = start(SRC(true), hw(40000)); far.step(5);
  assert.match(far.out, /^0 30000\n/, 'écho plus long que le délai : 0');
});

test('MPU6050 : axe Y, gyroscope et constantes de plage', () => {
  const rt = start(`#include <Adafruit_MPU6050.h>
Adafruit_MPU6050 mpu;
void setup() {
  Serial.begin(115200);
  mpu.begin();
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_44_HZ);
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  Serial.println(a.acceleration.y, 1);
  Serial.println(g.gyro.x, 2);
  Serial.println(mpu.getGyroRange());
}
void loop() {}`, board('esp32', { bus: [{ comp: comp('mpu6050', { data: { ax: 0, ay: 0.5, az: 0.87, gx: 0.35, gy: 0, gz: 0, temp: 25 } }), addr: [0x68] }] }));
  rt.step(2);
  assert.equal(rt.out, '4.9\n0.35\n1\n');
});

test('NeoPixel : NEO_RGB sur une barrette WS2812B (GRB) échange rouge et vert', () => {
  const SRC = t => `#include <Adafruit_NeoPixel.h>
Adafruit_NeoPixel leds(2, 6, ${t} + NEO_KHZ800);
void setup() { leds.begin(); leds.setPixelColor(0, leds.Color(255, 0, 0)); leds.show(); }
void loop() {}`;
  const grb = start(SRC('NEO_GRB'), board('uno')); grb.step(1);
  assert.deepEqual(grb.pins.get('D6').px[0], [255, 0, 0]);
  const rgb = start(SRC('NEO_RGB'), board('uno')); rgb.step(1);
  assert.deepEqual(rgb.pins.get('D6').px[0], [0, 255, 0]);
});

test('Pico : analogRead sur 10 bits par défaut, 12 bits après analogReadResolution(12)', () => {
  const rt = start(`void setup() { Serial.begin(9600); Serial.println(analogRead(26)); analogReadResolution(12); Serial.println(analogRead(26)); }
void loop() {}`, board('pico', { read: k => (k === 'GP26' ? { v: 3.3 } : null) }));
  rt.step(1);
  assert.equal(rt.out, '1023\n4095\n');
});

/* ---------- Exemples fournis avec les bibliothèques ---------- */
test('Exemples des bibliothèques : MFRC522 ReadNUID, IRremote SimpleReceiver, Keypad HelloKeypad (4×3)', () => {
  const NUID = `#include <SPI.h>
#include <MFRC522.h>
#define SS_PIN 10
#define RST_PIN 9
MFRC522 rfid(SS_PIN, RST_PIN);
MFRC522::MIFARE_Key key;
byte nuidPICC[4];
void setup() {
  Serial.begin(9600);
  SPI.begin();
  rfid.PCD_Init();
  for (byte i = 0; i < 6; i++) { key.keyByte[i] = 0xFF; }
  Serial.println(F("This code scan the MIFARE Classsic NUID."));
  Serial.print(F("Using the following key:"));
  printHex(key.keyByte, MFRC522::MF_KEY_SIZE);
  Serial.println();
}
void loop() {
  if ( ! rfid.PICC_IsNewCardPresent()) return;
  if ( ! rfid.PICC_ReadCardSerial()) return;
  Serial.print(F("PICC type: "));
  MFRC522::PICC_Type piccType = rfid.PICC_GetType(rfid.uid.sak);
  Serial.println(rfid.PICC_GetTypeName(piccType));
  if (piccType != MFRC522::PICC_TYPE_MIFARE_MINI && piccType != MFRC522::PICC_TYPE_MIFARE_1K && piccType != MFRC522::PICC_TYPE_MIFARE_4K) {
    Serial.println(F("Your tag is not of type MIFARE Classic."));
    return;
  }
  if (rfid.uid.uidByte[0] != nuidPICC[0] || rfid.uid.uidByte[1] != nuidPICC[1] || rfid.uid.uidByte[2] != nuidPICC[2] || rfid.uid.uidByte[3] != nuidPICC[3]) {
    Serial.println(F("A new card has been detected."));
    for (byte i = 0; i < 4; i++) { nuidPICC[i] = rfid.uid.uidByte[i]; }
    Serial.print(F("In hex: "));
    printHex(rfid.uid.uidByte, rfid.uid.size);
    Serial.println();
    Serial.print(F("In dec: "));
    printDec(rfid.uid.uidByte, rfid.uid.size);
    Serial.println();
  }
  else Serial.println(F("Card read previously."));
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}
void printHex(byte *buffer, byte bufferSize) {
  for (byte i = 0; i < bufferSize; i++) {
    Serial.print(buffer[i] < 0x10 ? " 0" : " ");
    Serial.print(buffer[i], HEX);
  }
}
void printDec(byte *buffer, byte bufferSize) {
  for (byte i = 0; i < bufferSize; i++) {
    Serial.print(' ');
    Serial.print(buffer[i], DEC);
  }
}`;
  const r = comp('rc522'), rt = start(NUID, board('uno', { wires: { D10: [{ comp: r, pin: 'SDA' }] } }));
  rt.step(2); presentBadge(r, 1); rt.step(3); presentBadge(r, 1); rt.step(2); presentBadge(r, 1); rt.step(3);
  assert.match(rt.out, /Using the following key: FF FF FF FF FF FF\n/);
  assert.match(rt.out, /PICC type: MIFARE 1KB\nA new card has been detected\.\nIn hex:  12 34 56 78\nIn dec:  18 52 86 120\n/);
  assert.match(rt.out, /Card read previously\.\n$/);

  const SIMPLE = `#include <Arduino.h>
#define DECODE_NEC
#define IR_RECEIVE_PIN 2
#include <IRremote.hpp>
void setup() {
  Serial.begin(115200);
  IrReceiver.begin(IR_RECEIVE_PIN, ENABLE_LED_FEEDBACK);
  Serial.print(F("Ready to receive IR signals of protocols: "));
  printActiveIRProtocols(&Serial);
}
void loop() {
  if (IrReceiver.decode()) {
    IrReceiver.printIRResultShort(&Serial);
    IrReceiver.printIRSendUsage(&Serial);
    if (IrReceiver.decodedIRData.protocol == UNKNOWN) {
      Serial.println(F("Received noise or an unknown (or not yet enabled) protocol"));
      IrReceiver.printIRResultRawFormatted(&Serial, true);
    }
    Serial.println();
    IrReceiver.resume();
    if (IrReceiver.decodedIRData.command == 0x10) {
    } else if (IrReceiver.decodedIRData.command == 0x11) {
    }
  }
}`;
  const ir = comp('ir'), r2 = start(SIMPLE, board('esp32', { wires: { D2: [{ comp: ir, pin: 'OUT' }] } }));
  r2.step(2); irPress(ir, 0x16); r2.step(2);
  assert.match(r2.out, /protocols: NEC\nProtocol=NEC Address=0x0 Command=0x16 Raw-Data=0xE916FF00 32 bits LSB first\nSend with: IrSender.sendNEC\(0x0, 0x16, <numberOfRepeats>\);\n\n/);

  const HELLO = `#include <Keypad.h>
const byte ROWS = 4;
const byte COLS = 3;
char keys[ROWS][COLS] = {
  {'1','2','3'},
  {'4','5','6'},
  {'7','8','9'},
  {'*','0','#'}
};
byte rowPins[ROWS] = {5, 4, 3, 2};
byte colPins[COLS] = {8, 7, 6};
Keypad keypad = Keypad( makeKeymap(keys), rowPins, colPins, ROWS, COLS );
void setup(){ Serial.begin(9600); }
void loop(){
  char key = keypad.getKey();
  if (key){ Serial.println(key); }
}`;
  const k = comp('keypad'), w = {};
  ['D5', 'D4', 'D3', 'D2'].forEach((p, i) => { w[p] = [{ comp: k, pin: 'R' + (i + 1) }]; });
  ['D8', 'D7', 'D6'].forEach((p, i) => { w[p] = [{ comp: k, pin: 'C' + (i + 1) }]; });
  const r3 = start(HELLO, board('uno', { wires: w }));
  r3.step(2); keypadDown(k, 3, 2); keypadUp(k); r3.step(2); keypadDown(k, 0, 3); keypadUp(k); r3.step(2);
  assert.equal(r3.out, '#\n', 'la colonne C4 n’est pas câblée : la touche A ne donne rien');
});

test('RF24 GettingStarted : float, adresses "1Node"/"2Node", available(&tube), getPayloadSize', () => {
  const GS = role => `#include <SPI.h>
#include "printf.h"
#include "RF24.h"
#define CE_PIN 7
#define CSN_PIN 8
RF24 radio(CE_PIN, CSN_PIN);
uint8_t address[][6] = { "1Node", "2Node" };
bool radioNumber = ${role};
bool role = ${role ? 'false' : 'true'};
float payload = 0.0;
void setup() {
  Serial.begin(115200);
  while (!Serial) {}
  if (!radio.begin()) { Serial.println(F("radio hardware is not responding!!")); while (1) {} }
  radio.setPALevel(RF24_PA_LOW);
  radio.setPayloadSize(sizeof(payload));
  radio.openWritingPipe(address[radioNumber]);
  radio.openReadingPipe(1, address[!radioNumber]);
  if (role) radio.stopListening(); else radio.startListening();
}
void loop() {
  if (role) {
    unsigned long start_timer = micros();
    bool report = radio.write(&payload, sizeof(float));
    unsigned long end_timer = micros();
    if (report) { Serial.print(F("Transmission successful! ")); Serial.println(payload); payload += 0.01; }
    else Serial.println(F("Transmission failed or timed out"));
    delay(1000);
  } else {
    uint8_t pipe;
    if (radio.available(&pipe)) {
      uint8_t bytes = radio.getPayloadSize();
      radio.read(&payload, bytes);
      Serial.print(F("Received ")); Serial.print(bytes); Serial.print(F(" bytes on pipe ")); Serial.print(pipe); Serial.print(F(": ")); Serial.println(payload);
    }
  }
}`;
  const a = comp('nrf24'), b = comp('nrf24'), peers = [a, b];
  const tx = start(GS(0), board('uno', { wires: { D7: [{ comp: a, pin: 'CE' }] }, peers }));
  const rx = start(GS(1), board('nano', { wires: { D7: [{ comp: b, pin: 'CE' }] }, peers }));
  rx.step(2);
  for (let i = 0; i < 70; i++) { tx.step(1); rx.step(1); }
  assert.match(tx.out, /^Transmission successful! 0\.00\nTransmission successful! 0\.01\n/);
  assert.match(rx.out, /^Received 4 bytes on pipe 1: 0\.00\nReceived 4 bytes on pipe 1: 0\.01\n/);
});

test('RF24 : une String envoyée par adresse est signalée (la radio enverrait l’objet, pas le texte)', () => {
  const a = comp('nrf24'), b = comp('nrf24'), peers = [a, b];
  const tx = start(`#include <RF24.h>
RF24 radio(7, 8);
void setup() { radio.begin(); radio.openWritingPipe("00001"); radio.stopListening(); }
void loop() { String msg = "Salut"; radio.write(&msg, sizeof(msg)); delay(500); }`, board('uno', { wires: { D7: [{ comp: a, pin: 'CE' }] }, peers }));
  const rx = start(`#include <RF24.h>
RF24 radio(7, 8);
void setup() { Serial.begin(9600); radio.begin(); radio.openReadingPipe(1, "00001"); radio.startListening(); }
void loop() { if (radio.available()) { char t[32] = ""; radio.read(&t, sizeof(t)); Serial.print("["); Serial.print(t); Serial.println("]"); } }`, board('uno', { wires: { D7: [{ comp: b, pin: 'CE' }] }, peers }));
  rx.step(2); for (let i = 0; i < 5; i++) { tx.step(1); rx.step(1); }
  assert.ok(warned(tx, /String n’est pas un tableau d’octets/));
  assert.match(rx.out, /^\[\]\n/);
});

/* ======================= Mémoires, Bluetooth, Wi-Fi, web, HTTP, ESP-NOW ======================= */
const errOf = (src, board) => { const r = compile(src, { board, boardLabel: board }); assert.equal(r.ok, false, 'devrait échouer'); return r.errors[0]; };

test('EEPROM (Uno) : 0xFF au départ, put/get, et la mémoire survit au redémarrage et à l’enregistrement', () => {
  const SRC = `#include <EEPROM.h>
void setup() {
  Serial.begin(9600);
  Serial.println(EEPROM.read(10));
  Serial.println(EEPROM.length());
  int n = EEPROM.read(0);
  if (n == 255) n = 0;
  n++;
  EEPROM.update(0, n);
  float t = 21.5;
  EEPROM.put(4, t);
  float lu = 0;
  EEPROM.get(4, lu);
  Serial.println(lu);
  Serial.println(n);
}
void loop() {}`;
  const o = {}, a = start(SRC, board('uno', o)); a.step(1);
  assert.equal(a.out, '255\n1024\n21.50\n1\n');
  assert.match(o.mem.ee, /^01ffffff0000ac41$/, 'octets gardés en hexadécimal, sans les 0xFF de la fin');
  assert.ok(o.memSaves >= 1);
  const b = start(SRC, board('uno', o)); b.step(1);
  assert.equal(b.out.split('\n')[3], '2', 'nouveau téléversement : la valeur précédente est relue');
  const saved = JSON.parse(JSON.stringify({ mem: o.mem })); // comme serialize() puis réouverture du projet
  const c = start(SRC, board('uno', { mem: saved.mem })); c.step(1);
  assert.equal(c.out.split('\n')[3], '3');
});

test('EEPROM (ESP32) : begin(taille) et commit() ; sans commit(), rien n’est gardé', () => {
  const SRC = commit => `#include <EEPROM.h>
void setup() { Serial.begin(115200); EEPROM.begin(64); Serial.println(EEPROM.read(3)); EEPROM.write(3, 42); ${commit ? 'EEPROM.commit();' : ''} }
void loop() {}`;
  const o = {};
  start(SRC(false), board('esp32', o)).step(1);
  const b = start(SRC(true), board('esp32', o)); b.step(1);
  assert.equal(b.out, '255\n');
  const c = start(SRC(false), board('esp32', o)); c.step(1);
  assert.equal(c.out, '42\n');
  const d = start('#include <EEPROM.h>\nvoid setup() { EEPROM.write(0, 1); }\nvoid loop() {}', board('esp32', {})); d.step(1);
  assert.ok(warned(d, /EEPROM.begin/));
});

test('Preferences (ESP32) : clés typées, valeur par défaut, isKey/remove/clear, gardées au redémarrage', () => {
  const SRC = `#include <Preferences.h>
Preferences prefs;
void setup() {
  Serial.begin(115200);
  prefs.begin("reglages", false);
  unsigned int n = prefs.getUInt("demarrages", 0);
  n++;
  prefs.putUInt("demarrages", n);
  prefs.putString("nom", "Awa");
  prefs.putFloat("seuil", 30.5);
  Serial.println(n);
  Serial.println(prefs.getString("nom", "?"));
  Serial.println(prefs.getInt("demarrages", -1));
  Serial.println(prefs.getFloat("seuil", 0));
  Serial.println(prefs.isKey("nom"));
  prefs.remove("nom");
  Serial.println(prefs.isKey("nom"));
  prefs.end();
}
void loop() {}`;
  const o = {}, a = start(SRC, board('esp32', o)); a.step(1);
  assert.equal(a.out, '1\nAwa\n-1\n30.50\n1\n0\n', 'getInt sur une clé écrite par putUInt : valeur par défaut, comme sur la carte');
  const b = start(SRC, board('esp32', o)); b.step(1);
  assert.match(b.out, /^2\n/);
  assert.equal(errOf('#include <Preferences.h>\nPreferences p;\nvoid setup() {}\nvoid loop() {}', 'uno').code, 'J1111');
});

test('BluetoothSerial : le téléphone écrit, la carte répond ; refusé hors ESP32 (J1111)', () => {
  const SRC = `#include <BluetoothSerial.h>
BluetoothSerial SerialBT;
void setup() { Serial.begin(115200); SerialBT.begin("Robot-Awa"); }
void loop() {
  if (SerialBT.available()) {
    String m = SerialBT.readStringUntil('\\n');
    SerialBT.print("Recu : ");
    SerialBT.println(m);
  }
}`;
  const o = {}, rt = start(SRC, board('esp32', o)); rt.step(1);
  const bt = btSerial(o.self);
  assert.equal(bt.st.name, 'Robot-Awa');
  bt.phone('bonjour'); rt.step(2);
  assert.deepEqual(bt.st.log.map(m => `${m.who}:${m.text}`), ['phone:bonjour', 'board:Recu : bonjour']);
  const e = errOf(SRC, 'uno');
  assert.equal(e.code, 'J1111');
  assert.match(e.help, /ESP32/);
  assert.equal(errOf(SRC, 'nodemcu').code, 'J1111');
});

test('SIM800 : appel entrant (RING, +CLIP), ATA décroche, le téléphone raccroche (NO CARRIER)', () => {
  const g = comp('sim800');
  const rt = start(`#include <SoftwareSerial.h>
SoftwareSerial gsm(7, 8);
int sonneries = 0;
void setup() { Serial.begin(9600); gsm.begin(9600); gsm.println("AT+CLIP=1"); }
void loop() {
  if (gsm.available()) {
    String l = gsm.readStringUntil('\\n');
    l.trim();
    if (l.length() > 0) Serial.println(l);
    if (l == "RING") { sonneries++; if (sonneries == 2) gsm.println("ATA"); }
  }
}`, board('uno', { wires: { D7: [{ comp: g, pin: 'TXD' }], D8: [{ comp: g, pin: 'RXD' }] } }));
  rt.step(5);
  serialDevice(g).ring();
  rt.step(60);
  assert.equal(periph(g).call, null, 'pas encore décroché après une sonnerie');
  rt.step(150);
  assert.match(rt.out, /RING\n\+CLIP: "\+221770000000",145,"",0,"",0\nRING\n/);
  assert.equal(periph(g).call.dir, 'in');
  serialDevice(g).hangUp(); rt.step(3);
  assert.match(rt.out, /NO CARRIER\n$/);
});

test('HC-05 : EN au niveau haut à la mise sous tension → mode AT à 38400 bauds (nom, vitesse) ; mauvaise vitesse : charabia', () => {
  const SRC = baud => `#include <SoftwareSerial.h>
SoftwareSerial bt(10, 11);
void lire() { delay(100); while (bt.available()) Serial.write(bt.read()); }
void setup() {
  Serial.begin(9600); bt.begin(${baud});
  bt.println("AT"); lire();
  bt.println("AT+NAME=Robot-Awa"); lire();
  bt.println("AT+NAME?"); lire();
  bt.println("AT+UART=115200,0,0"); lire();
  bt.println("AT+VERSION?"); lire();
}
void loop() {}`;
  const h = comp('hc05'), wires = { D10: [{ comp: h, pin: 'TXD' }], D11: [{ comp: h, pin: 'RXD' }] }, level = (c, k) => (k === 'EN' ? 1 : null);
  const rt = start(SRC(38400), board('uno', { wires, level })); rt.step(40);
  assert.equal(rt.out, 'OK\r\nOK\r\n+NAME:Robot-Awa\r\nOK\r\nOK\r\n+VERSION:2.0-20100601\r\nOK\r\n');
  assert.equal(h.inp.btName, 'Robot-Awa');
  assert.equal(serialDevice(h).phone('salut'), false, 'en mode AT, le téléphone est déconnecté');
  // EN laissé libre : mode données, à la vitesse réglée par AT+UART (115200).
  const ok = start(`#include <SoftwareSerial.h>
SoftwareSerial bt(10, 11);
void setup() { bt.begin(115200); bt.println("Pret"); }
void loop() {}`, board('uno', { wires })); ok.step(2);
  assert.equal(periph(h).log.at(-1).text, 'Pret');
  const bad = start(SRC(9600), board('uno', { wires, level })); bad.step(40);
  assert.ok(warned(bad, /38400 bauds/));
  assert.doesNotMatch(bad.out, /OK/);
});

test('MPU6050 : la rotation autour de Z (quantité « Rotation (axe Z) ») donne gz (getEvent et getRotation)', () => {
  const m = MODELS.mpu6050, st = {};
  const d = m.read({ tilt: 0, tiltY: 0, rotZ: 90, temp: 25 }, { st, t: 1 }).data;
  assert.ok(Math.abs(d.gz - Math.PI / 2) < 0.01);
  const mpu = comp('mpu6050', { data: { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: Math.PI / 2, temp: 25 } });
  const rt = start(`#include <Adafruit_MPU6050.h>
#include <MPU6050.h>
Adafruit_MPU6050 a;
MPU6050 b;
void setup() {
  Serial.begin(115200); a.begin(); b.initialize();
  sensors_event_t acc, g, t;
  a.getEvent(&acc, &g, &t);
  Serial.println(g.gyro.z, 2);
  int16_t gx, gy, gz;
  b.getRotation(&gx, &gy, &gz);
  Serial.println(gz);
  Serial.println(b.getAccelerationZ());
}
void loop() {}`, board('esp32', { bus: [{ comp: mpu, addr: [0x68] }] }));
  rt.step(1);
  assert.equal(rt.out, '1.57\n11790\n16384\n');
});

const WIFI = (ssid, pass) => `#include <WiFi.h>
const char* ssid = "${ssid}";
const char* password = "${pass}";
void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 5000) { delay(500); Serial.print("."); }
  Serial.println();
  Serial.println(WiFi.status());
  Serial.println(WiFi.localIP());
  Serial.println(WiFi.RSSI() < 0);
}
void loop() {}`;

test('WiFi : connexion au réseau de l’école en 2 s, mauvais mot de passe, réseau inconnu, carte sans Wi-Fi (J1111)', () => {
  const ok = start(WIFI('Ecole-WiFi', 'jollof2024'), board('esp32')); ok.step(250);
  assert.match(ok.out, /^\.\.\.\.\n3\n192\.168\.1\.\d{1,3}\n1\n$/);
  const bad = start(WIFI('Ecole-WiFi', 'motdepasse'), board('esp32')); bad.step(400);
  assert.match(bad.out, /\n4\n0\.0\.0\.0\n0\n$/);
  assert.ok(warned(bad, /mot de passe refusé/));
  const none = start(WIFI('Wifi-Maison', 'x'), board('esp32')); none.step(400);
  assert.match(none.out, /\n1\n0\.0\.0\.0\n/);
  for (const b of ['uno', 'nano', 'pico']) assert.equal(errOf(WIFI('a', 'b'), b).code, 'J1111');
  assert.match(errOf(WIFI('a', 'b'), 'nodemcu').help, /ESP8266WiFi\.h/);
  assert.equal(errOf('void setup() { WiFi.begin("a", "b"); }\nvoid loop() {}', 'uno').code, 'J1111', 'objet WiFi sans #include : même erreur');
  // Réseau renommé dans la carte « Réseau Wi-Fi » : connexion perdue.
  const o = {}, r = start(WIFI('Ecole-WiFi', 'jollof2024').replace('void loop() {}', 'void loop() { Serial.println(WiFi.status()); delay(1000); }'), board('esp32', o));
  r.step(250); o.net.networks[0].ssid = 'Ecole-2'; r.step(80);
  assert.match(r.out, /\n5\n$/);
});

const SERVER = `#include <WiFi.h>
#include <WebServer.h>
WebServer server(80);
int led = 0;
const char page[] PROGMEM = R"rawliteral(<!DOCTYPE html>
<html><body><h1>Salle 3</h1><script>alert(1)</script>
<a href="/on">Allumer</a><form action="/nom" method="post"><input name="prenom"><input type="submit"></form></body></html>
)rawliteral";
void racine() { server.send(200, "text/html", page); }
void setup() {
  Serial.begin(115200);
  WiFi.begin("Ecole-WiFi", "jollof2024");
  while (WiFi.status() != WL_CONNECTED) delay(200);
  server.on("/", racine);
  server.on("/on", []() { led = 1; server.send(200, "text/plain", "LED allumee"); });
  server.on("/nom", HTTP_POST, []() {
    if (!server.hasArg("prenom")) { server.send(400, "text/plain", "prenom manquant"); return; }
    server.send(200, "text/plain", "Bonjour " + server.arg("prenom") + " (" + String(server.args()) + ")");
  });
  server.onNotFound([]() { server.send(404, "text/plain", "introuvable : " + server.uri()); });
  server.begin();
  Serial.println(WiFi.localIP());
}
void loop() { server.handleClient(); }`;
const ask = (b, method, path, args = [], body = '') => { const r = { id: Math.random(), method, path, args, body, state: 'pending', resp: null, at: Date.now() }; b.periph.web.queue.push(r); return r; };

test('WebServer : GET et POST du navigateur arrivent aux gestionnaires (lambdas, arg, onNotFound)', () => {
  const o = {}, rt = start(SERVER, board('esp32', o)); rt.step(200);
  const ip = rt.out.trim(), b = o.self;
  assert.match(ip, /^192\.168\.1\.\d+$/);
  const home = ask(b, 1, '/'); rt.step(2);
  assert.equal(home.state, 'done');
  assert.equal(home.resp.code, 200);
  assert.match(home.resp.body, /<h1>Salle 3<\/h1>/);
  assert.doesNotMatch(cleanHtml(home.resp.body), /script|alert/);
  const on = ask(b, 1, '/on'); rt.step(2);
  assert.equal(on.resp.body, 'LED allumee');
  const post = ask(b, 3, '/nom', [['prenom', 'Awa']]); rt.step(2);
  assert.equal(post.resp.body, 'Bonjour Awa (1)');
  const getNom = ask(b, 1, '/nom', [['prenom', 'Awa']]); rt.step(2);
  assert.equal(getNom.resp.code, 404, 'route POST seulement : un GET n’y arrive pas');
  assert.equal(getNom.resp.body, 'introuvable : /nom');
});

test('WebServer : un programme qui n’appelle jamais handleClient() ne répond pas', () => {
  const o = {}, rt = start(SERVER.replace('void loop() { server.handleClient(); }', 'void loop() { delay(10); }'), board('esp32', o)); rt.step(200);
  const r = ask(o.self, 1, '/'); rt.step(100);
  assert.equal(r.state, 'pending');
  assert.equal(r.resp, null);
});

test('Nettoyage du HTML servi : ni script, ni gestionnaire on…, ni adresse extérieure, ni <meta refresh>', () => {
  const out = cleanHtml(`<h1 onclick="alert(1)">Salut</h1><script>alert(2)</script><img src="http://x.y/a.png" onerror="alert(3)">
<a href="javascript:alert(4)">j</a><a href="javascript&#58;alert(5)">k</a><a href="https://exemple.com">e</a><a href="/on">on</a>
<meta http-equiv="refresh" content="0;url=http://x"><iframe src="http://x"></iframe><svg onload="alert(6)"></svg>
<style>body{background:url(http://x/y)} @import "http://z";</style><form action="http://x.com/vol"><input name="a"></form><base href="http://x/">`);
  assert.doesNotMatch(out, /script|alert|onerror|onclick|onload|javascript|http:\/\/x|exemple\.com|<meta|<iframe|<svg|<base|url\(|@import/i);
  assert.match(out, /<h1>Salut<\/h1>/);
  assert.match(out, /<a href="\/on">on<\/a>/);
  assert.match(out, /<form action="#bloque"><input name="a"><\/form>/);
});

test('HTTPClient : meteo.jollof suit l’environnement, journal.jollof range les mesures, autre hôte : -1', () => {
  const SRC = url => `#include <WiFi.h>
#include <HTTPClient.h>
void setup() {
  Serial.begin(115200);
  WiFi.begin("Ecole-WiFi", "jollof2024");
  while (WiFi.status() != WL_CONNECTED) delay(100);
  HTTPClient http;
  http.begin("${url}");
  int code = http.GET();
  Serial.println(code);
  if (code > 0) Serial.println(http.getString());
  else Serial.println(http.errorToString(code));
  http.end();
}
void loop() {}`;
  ENV.temp = 31; ENV.hum = 60;
  const m = start(SRC('http://meteo.jollof/?ville=Dakar'), board('esp32')); m.step(200);
  const [code, json] = m.out.trim().split('\n');
  assert.equal(code, '200');
  assert.equal(JSON.parse(json).temperature, 31);
  assert.equal(JSON.parse(json).humidite, 60);
  const o = {}, j = start(SRC('http://journal.jollof/update?api_key=CLE&field1=21.5&field2=48'), board('esp32', o)); j.step(200);
  assert.equal(j.out, '200\n1\n');
  assert.deepEqual(o.net.journal.map(e => e.f), [{ field1: 21.5, field2: 48 }]);
  const x = start(SRC('http://exemple.com/'), board('esp32')); x.step(200);
  assert.equal(x.out, '-1\nconnection refused\n');
  assert.ok(warned(x, /Internet/));
  const off = start(SRC('http://meteo.jollof/').replace('while (WiFi.status() != WL_CONNECTED) delay(100);', ''), board('esp32')); off.step(10);
  assert.equal(off.out, '-1\nconnection refused\n');
  ENV.temp = 24; ENV.hum = 55;
});

test('HTTPClient vers le serveur web d’une autre carte ; -11 si elle n’appelle pas handleClient()', () => {
  const peers = [], srv = { peers }, quiet = { peers };
  const S = start(SERVER, board('esp32', srv));
  const Q = start(SERVER.replace('void loop() { server.handleClient(); }', 'void loop() { delay(10); }'), board('esp32', quiet));
  peers.push(srv.self, quiet.self);
  for (let i = 0; i < 160; i++) { S.step(1); Q.step(1); }
  const CLIENT = ip => `#include <WiFi.h>
#include <HTTPClient.h>
void setup() {
  Serial.begin(115200);
  WiFi.begin("Ecole-WiFi", "jollof2024");
  while (WiFi.status() != WL_CONNECTED) delay(100);
  HTTPClient http;
  http.setTimeout(1000);
  http.begin("http://${ip}/on");
  int code = http.GET();
  Serial.println(code);
  if (code > 0) Serial.println(http.getString());
}
void loop() {}`;
  const C = start(CLIENT(srv.self.periph.wifi.ip), board('esp32', { peers }));
  for (let i = 0; i < 200; i++) { C.step(1); S.step(1); }
  assert.equal(C.out, '200\nLED allumee\n');
  const C2 = start(CLIENT(quiet.self.periph.wifi.ip), board('esp32', { peers }));
  for (let i = 0; i < 300; i++) { C2.step(1); Q.step(1); }
  assert.equal(C2.out, '-11\n');
});

test('ESP-NOW : une carte envoie un float à l’adresse MAC de l’autre, rappels de réception et d’envoi', () => {
  const rxB = { type: 'esp32', id: 'recepteur', name: 'R' }, txB = { type: 'esp32', id: 'emetteur', name: 'E' }, peers = [rxB, txB];
  const RX = `#include <esp_now.h>
#include <WiFi.h>
float recu;
void OnDataRecv(const uint8_t * mac, const uint8_t *incomingData, int len) {
  memcpy(&recu, incomingData, sizeof(recu));
  Serial.print(len); Serial.print(" octets de "); Serial.print(mac[0], HEX); Serial.print(" : "); Serial.println(recu);
}
void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  Serial.println(WiFi.macAddress());
  if (esp_now_init() != ESP_OK) { Serial.println("echec"); return; }
  esp_now_register_recv_cb(esp_now_recv_cb_t(OnDataRecv));
}
void loop() {}`;
  const TX = mac => `#include <esp_now.h>
#include <WiFi.h>
uint8_t adresse[] = {${mac}};
esp_now_peer_info_t peerInfo;
float temperature = 23.75;
void OnDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
  Serial.println(status == ESP_NOW_SEND_SUCCESS ? "livre" : "perdu");
}
void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  esp_now_init();
  esp_now_register_send_cb(OnDataSent);
  memcpy(peerInfo.peer_addr, adresse, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;
  if (esp_now_add_peer(&peerInfo) != ESP_OK) Serial.println("pair refuse");
}
void loop() {
  esp_esp_now_send(adresse, (uint8_t *) &temperature, sizeof(temperature));
  delay(1000);
}`.replace('esp_esp_now_send', 'esp_now_send');
  const R = start(RX, board('esp32', { self: rxB, peers })); R.step(1);
  assert.equal(R.out.trim(), macOf(rxB));
  const mac = macOf(rxB).split(':').map(h => '0x' + h).join(', ');
  const T = start(TX(mac), board('esp32', { self: txB, peers }));
  for (let i = 0; i < 70; i++) { T.step(1); R.step(1); }
  assert.match(T.out, /^livre\nlivre\n/);
  assert.match(R.out, new RegExp(`\\n4 octets de ${macOf(txB).slice(0, 2).replace(/^0/, '')} : 23\\.75\\n4 octets`));
  // Adresse d'une carte absente : rappel « perdu ».
  const lost = start(TX('0x24, 0x0A, 0xC4, 1, 2, 3'), board('esp32', { self: { type: 'esp32', id: 'x', name: 'x' }, peers })); lost.step(2);
  assert.match(lost.out, /^perdu\n/);
});
