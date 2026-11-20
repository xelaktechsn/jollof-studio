// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Module Ethernet W5500 en mode fidèle (src/emu/devices/w5500.js) sur le réseau simulé (src/net/lan.js) : trames SPI
// et sockets à la main, puis de vrais programmes (bibliothèques Ethernet d'Arduino et PubSubClient) sur l'Uno (avr8js)
// et le Pico (rp2040js) : serveur web de l'exemple WebServer joint par le navigateur du PC, bail DHCP de la box en
// vrais paquets UDP, publication et abonnement MQTT auprès du broker du plan réseau, nom résolu par le DNS de la box.
// Sans arduino-cli (ou sans les bibliothèques Ethernet et PubSubClient), les tests en mode fidèle sont ignorés.
// node --test src/emu/devices/w5500.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { hasCli, hasPicoCore, hasEsp32Core, compileSketch, fakeBoard, boot, runFor } from '../testkit.mjs';
import { createEsp32Runtime } from '../esp32.js';
import { qemuPath, nodeTransport } from '../esp32-node.mjs';
import { FQBN } from '../boards.js';
import { createLan } from '../../net/lan.js';
import { newDevice } from '../../net/devices.js';
import { makeCable } from '../../net/cable.js';
import w5500 from './w5500.js';
import enc28j60 from './enc28j60.js';
import { MODELS } from './index.js';
import { CMD, SR, SNIR } from './w5500.js';

const libs = hasCli ? spawnSync('arduino-cli', ['lib', 'list'], { encoding: 'utf8' }).stdout || '' : '';
const skip = !hasCli ? 'arduino-cli absent' : !/^Ethernet\s/m.test(libs) || !/^PubSubClient\s/m.test(libs) ? 'bibliothèques Ethernet et PubSubClient absentes (arduino-cli lib install Ethernet PubSubClient)' : false;
const skipPico = skip || (!hasPicoCore() && 'cœur rp2040 absent');
const QEMU = qemuPath(), skipEsp = skip || ((!QEMU || !hasEsp32Core()) && 'QEMU (JOLLOF_QEMU) ou cœur esp32 absent');

/** Plan : box, switch, PC, serveur MQTT ; le module 'e:' + id est relié au port 4 du switch (link : false, pas de câble). */
function plan(id, { link = true } = {}) {
  const used = new Set(), data = { devices: [], cables: [] };
  for (const [did, type] of [['box', 'router'], ['sw', 'switch'], ['pc', 'pc'], ['mq', 'broker']]) {
    const d = newDevice(type, used); used.add(d.name); d.id = did; d.name = did.toUpperCase(); data.devices.push(d);
  }
  const ends = [[['box', 'lan1'], ['sw', 'p1']], [['pc', 'eth0'], ['sw', 'p2']], [['mq', 'eth0'], ['sw', 'p3']]];
  if (link) ends.push([['e:' + id, 'eth'], ['sw', 'p4']]);
  ends.forEach(([a, b], i) => data.cables.push({ id: 'c' + i, a, b, cat: 'cat6', len: 3, wire: makeCable('straight') }));
  return data;
}
/** Réseau du projet avec le module comp comme nœud externe (ce que construit le plan réseau dans l'application). */
function lanFor(comp, data) {
  const eth = () => (comp.periph && comp.periph.eth) || null;
  const ext = { id: 'e:' + comp.id, type: 'w5500', name: comp.name, x: 0, y: 0, mac: () => (eth() ? eth().mac : '00:00:00:00:00:00'), ipcfg: () => eth() };
  return createLan({ data: () => data, ext: () => [ext], sig: () => JSON.stringify(eth()) });
}

/* ---------- Le modèle seul : trames SPI écrites à la main ---------- */
/** Carte factice : SPI d'octets vers le modèle, temps manuel. */
function bench(id, data) {
  const comp = { id, type: 'w5500', name: id.toUpperCase() };
  const lan = lanFor(comp, data), events = [];
  let now = 0;
  const io = { hw: { lan: () => lan }, comp, pin: () => null, level: () => 1, onEdge: () => () => {}, drive() {}, after: (cy, fn) => events.push({ at: now + cy, fn }), rec: () => null, now: () => now, us: n => n, MHZ: 1e6 };
  const dev = w5500.create(comp, io);
  const frame = (addr, bsb, write, bytes) => {
    dev.select(); dev.transfer(addr >> 8); dev.transfer(addr & 255); dev.transfer((bsb << 3) | (write ? 4 : 0));
    const out = bytes.map(b => dev.transfer(b)); dev.deselect(); return out;
  };
  const rd = (addr, bsb, n) => frame(addr, bsb, false, new Array(n).fill(0));
  const wr = (addr, bsb, bytes) => frame(addr, bsb, true, bytes);
  const r16 = (s, a) => { const [h, l] = rd(a, s * 4 + 1, 2); return (h << 8) | l; };
  const cmd = (s, c) => wr(0x01, s * 4 + 1, [c]);
  const tick = ms => { now += ms * 1000; for (const e of events.splice(0)) if (e.at <= now) e.fn(); else events.push(e); };
  return { comp, lan, dev, rd, wr, r16, cmd, tick };
}

test('W5500 : registres de la fiche (VERSIONR, remise à zéro, PHYCFGR, mémoires circulaires)', () => {
  const b = bench('w-reg', plan('w-reg'));
  assert.deepEqual(b.rd(0x39, 0, 1), [0x04], 'VERSIONR');
  b.wr(0x00, 0, [0x08]); assert.deepEqual(b.rd(0x00, 0, 1), [0x08]);
  b.wr(0x00, 0, [0x80]); assert.deepEqual(b.rd(0x00, 0, 1), [0x00], 'MR bit 7 : remise à zéro, se relit à 0');
  assert.deepEqual(b.rd(0x19, 0, 3), [0x07, 0xd0, 0x08], 'RTR = 2000 (200 ms), RCR = 8');
  // Lien à 100 Mb/s, duplex intégral : LNK, SPD, DPX ; sans câble : pas de lien.
  assert.equal(b.rd(0x2e, 0, 1)[0] & 7, 7);
  const nc = bench('w-nc', plan('w-nc', { link: false }));
  assert.equal(nc.rd(0x2e, 0, 1)[0] & 1, 0);
  // Tailles par défaut : 2 Ko, TX_FSR = 0x0800 ; adresse de la mémoire prise modulo sa taille.
  assert.deepEqual(b.rd(0x1e, 1, 2), [2, 2]);
  assert.equal(b.r16(0, 0x20), 0x0800);
  b.wr(0x8000 + 0x7ff, 2, [0x11, 0x22]);
  assert.deepEqual(b.rd(0x07ff, 2, 1), [0x11]); assert.deepEqual(b.rd(0x0000, 2, 1), [0x22], 'débordement : retour au début');
  // Longueur fixe (OM = 01) : deux octets de suite sans relever CS = deux trames d'un octet.
  b.dev.select(); for (const x of [0, 0x16, 0x05 | 0x04, 0xaa, 0, 0x18, 0x05 | 0x04, 0x55]) b.dev.transfer(x); b.dev.deselect();
  assert.deepEqual(b.rd(0x16, 0, 3), [0xaa, 0x00, 0x55], 'IMR puis SIMR écrits en mode FDM');
  // Adresse du module : SHAR, SIPR, SUBR, GAR → comp.periph.eth, vu par le plan réseau.
  b.wr(0x01, 0, [192, 168, 1, 1, 255, 255, 255, 0, 0xde, 0xad, 0xbe, 0xef, 0xfe, 0xed, 192, 168, 1, 177]);
  assert.deepEqual(b.comp.periph.eth, { mac: 'DE:AD:BE:EF:FE:ED', ip: '192.168.1.177', prefix: 24, gw: '192.168.1.1', dhcp: false });
  assert.equal(b.lan.ipOf('e:w-reg').ip, '192.168.1.177');
  assert.ok(b.lan.ping('pc', '192.168.1.177').ok);
});

test('W5500 : sockets TCP (connexion au broker, écoute, fermeture par le correspondant) et UDP (DHCP de la box)', async () => {
  const b = bench('w-sock', plan('w-sock'));
  b.wr(0x01, 0, [192, 168, 1, 1, 255, 255, 255, 0, 2, 0, 0, 0, 0, 7, 192, 168, 1, 60]);
  // Client TCP vers le broker (192.168.1.10:1883) : ESTABLISHED, CON ; un paquet CONNECT reçoit son CONNACK.
  b.wr(0x00, 1, [0x01]); b.wr(0x04, 1, [0xc0, 0x00]); b.cmd(0, CMD.OPEN);
  assert.equal(b.rd(0x03, 1, 1)[0], SR.INIT);
  b.wr(0x0c, 1, [192, 168, 1, 10, 0x07, 0x5b]); b.cmd(0, CMD.CONNECT);
  assert.equal(b.rd(0x03, 1, 1)[0], SR.ESTABLISHED); assert.ok(b.rd(0x02, 1, 1)[0] & SNIR.CON);
  const pkt = [0x10, 14, 0, 4, 77, 81, 84, 84, 4, 2, 0, 60, 0, 2, 0x68, 0x69];
  b.wr(0x8000, 2, pkt); b.wr(0x24, 1, [0, pkt.length]); b.cmd(0, CMD.SEND);
  assert.ok(b.rd(0x02, 1, 1)[0] & SNIR.SEND_OK);
  assert.equal(b.r16(0, 0x26), 4, 'CONNACK : 4 octets reçus');
  assert.deepEqual(b.rd(0xc000, 3, 4), [0x20, 2, 0, 0]);
  b.wr(0x28, 1, [0, 4]); b.cmd(0, CMD.RECV); assert.equal(b.r16(0, 0x26), 0);
  // Port de destination fermé : refus immédiat.
  b.cmd(1 - 1, CMD.CLOSE);
  b.wr(0x00, 5, [0x01]); b.wr(0x04, 5, [0xc0, 0x01]); b.cmd(1, CMD.OPEN); b.wr(0x0c, 5, [192, 168, 1, 10, 0, 23]); b.cmd(1, CMD.CONNECT);
  assert.equal(b.rd(0x03, 5, 1)[0], SR.CLOSED); assert.ok(b.rd(0x02, 5, 1)[0] & SNIR.TIMEOUT);
  // Adresse sans hôte : SYNSENT pendant les essais (RTR × (RCR + 1) = 1,8 s), puis CLOSED.
  b.cmd(1, CMD.OPEN); b.wr(0x0c, 5, [192, 168, 1, 99, 0, 80]); b.cmd(1, CMD.CONNECT);
  assert.equal(b.rd(0x03, 5, 1)[0], 0x15); b.tick(2000); assert.equal(b.rd(0x03, 5, 1)[0], SR.CLOSED);
  // Serveur : écoute sur le port 80, le navigateur du PC s'y connecte ; le module répond puis ferme.
  b.wr(0x00, 9, [0x01]); b.wr(0x04, 9, [0, 80]); b.cmd(2, CMD.OPEN); b.cmd(2, CMD.LISTEN);
  assert.equal(b.rd(0x03, 9, 1)[0], SR.LISTEN);
  const page = b.lan.http('pc', 'http://192.168.1.60/');
  assert.equal(b.rd(0x03, 9, 1)[0], SR.ESTABLISHED); assert.deepEqual(b.rd(0x0c, 9, 4), b.lan.ipOf('pc').ip.split('.').map(Number));
  const n = b.r16(2, 0x26); assert.ok(n > 20);
  const req = String.fromCharCode(...b.rd(0xc000, 11, n)); assert.match(req, /^GET \/ HTTP\/1\.1\r\n/);
  const resp = [...'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nbonjour'].map(ch => ch.charCodeAt(0));
  b.wr(0x8000, 10, resp); b.wr(0x24, 9, [0, resp.length]); b.cmd(2, CMD.SEND); b.cmd(2, CMD.DISCON);
  const r = await page; assert.equal(r.code, 200); assert.equal(r.body, 'bonjour');
  assert.equal(b.rd(0x03, 9, 1)[0], SR.CLOSED);
  // Le correspondant ferme : CLOSE_WAIT, DISCON, les données reçues restent lisibles.
  b.cmd(0, CMD.CLOSE); b.wr(0x00, 1, [0x01]); b.wr(0x04, 1, [0, 81]); b.cmd(0, CMD.OPEN); b.cmd(0, CMD.LISTEN);
  const c = b.lan.connect('pc', '192.168.1.60', 81); assert.ok(c.ok, c.why);
  c.sock.write('fin'); c.sock.close();
  assert.equal(b.rd(0x03, 1, 1)[0], SR.CLOSE_WAIT); assert.ok(b.rd(0x02, 1, 1)[0] & SNIR.DISCON); assert.equal(b.r16(0, 0x26), 3);
  // UDP : DHCPDISCOVER en diffusion sans adresse ; l'offre de la box arrive avec l'en-tête de 8 octets de la puce.
  const u = bench('w-udp', plan('w-udp'));
  u.wr(0x09, 0, [2, 0, 0, 0, 0, 8]);
  u.wr(0x00, 1, [0x02]); u.wr(0x04, 1, [0, 68]); u.cmd(0, CMD.OPEN); assert.equal(u.rd(0x03, 1, 1)[0], SR.UDP);
  const { dhcpClientPacket, parseDhcp } = await import('../../net/dhcp.js');
  const disc = Array.from(dhcpClientPacket({ type: 1, xid: 0x1234, mac: '02:00:00:00:00:08' }));
  u.wr(0x0c, 1, [255, 255, 255, 255, 0, 67]); u.wr(0x8000, 2, disc.slice(0, 100)); u.wr(0x24, 1, [0, 100]);
  // Deuxième morceau : la bibliothèque ajoute son décalage à Sn_TX_WR relu (inchangé jusqu'à SEND).
  assert.equal(u.r16(0, 0x24), 0, 'Sn_TX_WR relu : la valeur d’avant SEND');
  u.wr(0x8000 + 100, 2, disc.slice(100)); u.wr(0x24, 1, [disc.length >> 8, disc.length & 255]); u.cmd(0, CMD.SEND);
  assert.ok(u.rd(0x02, 1, 1)[0] & SNIR.SEND_OK);
  const size = u.r16(0, 0x26), raw = u.rd(0xc000, 3, size);
  assert.deepEqual(raw.slice(0, 6), [192, 168, 1, 1, 0, 67], 'en-tête : adresse et port de la box');
  const len = (raw[6] << 8) | raw[7], offer = parseDhcp(Uint8Array.from(raw.slice(8, 8 + len)));
  assert.equal(offer.type, 2); assert.match(offer.yiaddr, /^192\.168\.1\.1\d\d$/);
});

test('ENC28J60 en mode fidèle : avertissement du moteur tant qu’il est branché', () => {
  assert.ok(MODELS.some(m => m.types.includes('w5500')) && MODELS.some(m => m.types.includes('enc28j60')));
  const warnings = new Map(), comp = { id: 'enc1', type: 'enc28j60', name: 'ETH1' };
  const dev = enc28j60.create(comp, { warn: (k, msg) => warnings.set(k, msg), unwarn: k => warnings.delete(k) });
  assert.match(warnings.get('enc28j60:enc1'), /ETH1 \(ENC28J60\).*pile TCP\/IP/);
  dev.dispose(); assert.equal(warnings.size, 0);
});

/* ---------- Vrais programmes ---------- */
// Exemple WebServer de la bibliothèque Ethernet (David A. Mellis, Tom Igoe, Arturo Guadalupi), sans ses commentaires.
const WEBSERVER = `#include <SPI.h>
#include <Ethernet.h>
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };
IPAddress ip(192, 168, 1, 177);
EthernetServer server(80);
void setup() {
  Serial.begin(9600);
  while (!Serial) { ; }
  Serial.println("Ethernet WebServer Example");
  Ethernet.begin(mac, ip);
  if (Ethernet.hardwareStatus() == EthernetNoHardware) {
    Serial.println("Ethernet shield was not found.  Sorry, can't run without hardware. :(");
    while (true) { delay(1); }
  }
  if (Ethernet.linkStatus() == LinkOFF) { Serial.println("Ethernet cable is not connected."); }
  server.begin();
  Serial.print("server is at ");
  Serial.println(Ethernet.localIP());
}
void loop() {
  EthernetClient client = server.available();
  if (client) {
    Serial.println("new client");
    bool currentLineIsBlank = true;
    while (client.connected()) {
      if (client.available()) {
        char c = client.read();
        Serial.write(c);
        if (c == '\\n' && currentLineIsBlank) {
          client.println("HTTP/1.1 200 OK");
          client.println("Content-Type: text/html");
          client.println("Connection: close");
          client.println("Refresh: 5");
          client.println();
          client.println("<!DOCTYPE HTML>");
          client.println("<html>");
          for (int analogChannel = 0; analogChannel < 6; analogChannel++) {
            int sensorReading = analogRead(analogChannel);
            client.print("analog input ");
            client.print(analogChannel);
            client.print(" is ");
            client.print(sensorReading);
            client.println("<br />");
          }
          client.println("</html>");
          break;
        }
        if (c == '\\n') { currentLineIsBlank = true; } else if (c != '\\r') { currentLineIsBlank = false; }
      }
    }
    delay(1);
    client.stop();
    Serial.println("client disconnected");
  }
}`;

// Ethernet.begin(mac) : DHCP de la box (DISCOVER, OFFER, REQUEST, ACK en paquets UDP), puis le DNS de la box.
const DHCP_SKETCH = `#include <SPI.h>
#include <Ethernet.h>
byte mac[] = { 0x02, 0x4A, 0x01, 0x02, 0x03, 0x04 };
void setup() {
  Serial.begin(115200);
#ifdef ARDUINO_ARCH_RP2040
  Ethernet.init(17); // CS sur GP17 (SPI0)
#endif
  if (Ethernet.begin(mac, 8000, 2000) == 0) { Serial.println("echec DHCP"); return; }
  Serial.print("ip="); Serial.println(Ethernet.localIP());
  Serial.print("masque="); Serial.println(Ethernet.subnetMask());
  Serial.print("passerelle="); Serial.println(Ethernet.gatewayIP());
  Serial.print("dns="); Serial.println(Ethernet.dnsServerIP());
  EthernetClient c;
  Serial.print("nom="); Serial.println(c.connect("mq", 1883));
  c.stop();
}
void loop() {}`;

// PubSubClient : publie une mesure, s'abonne à une consigne et l'affiche.
const MQTT_SKETCH = `#include <SPI.h>
#include <Ethernet.h>
#include <PubSubClient.h>
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x01 };
IPAddress ip(192, 168, 1, 178);
IPAddress broker(192, 168, 1, 10);
EthernetClient eth;
PubSubClient mqtt(eth);
void recu(char* topic, byte* payload, unsigned int length) {
  Serial.print("recu "); Serial.print(topic); Serial.print(" ");
  for (unsigned int i = 0; i < length; i++) Serial.write(payload[i]);
  Serial.println();
}
void setup() {
  Serial.begin(115200);
#ifdef ARDUINO_ARCH_RP2040
  Ethernet.init(17); // CS sur GP17 (SPI0)
#endif
  Ethernet.begin(mac, ip);
  mqtt.setServer(broker, 1883);
  mqtt.setCallback(recu);
  if (mqtt.connect("carte1")) {
    Serial.println("connecte");
    mqtt.publish("atelier/temperature", "23.5");
    mqtt.subscribe("atelier/consigne");
  } else { Serial.print("echec "); Serial.println(mqtt.state()); }
}
void loop() { mqtt.loop(); }`;

const UNO = { kind: 'uno', fqbn: 'arduino:avr:uno', pins: { CS: 'D10', SCK: 'D13', MOSI: 'D11', MISO: 'D12' } };
const PICO = { kind: 'pico', fqbn: 'rp2040:rp2040:rpipico', pins: { CS: 'GP17', SCK: 'GP18', MOSI: 'GP19', MISO: 'GP16' } };
/** Carte en mode fidèle avec un W5500 relié au plan réseau ; out accumule le port série. */
function fw(src, board, id, pins = board.pins) {
  const data = plan(id);
  const { hw, comps } = fakeBoard({ kind: board.kind, modules: [{ type: 'w5500', id, pins }], inputs: { A0: { v: 2.5 }, A1: { v: 1 }, GP26: { v: 1.65 } } });
  const lan = lanFor(comps[0], data);
  hw.lan = () => lan;
  const rt = boot(compileSketch(src, board.fqbn), hw);
  return { rt, hw, comp: comps[0], lan, out: '', take() { this.out += rt.takeSerial(); return this.out; } };
}
/** Avance jusqu'à ce que le port série vérifie ok (expression régulière ou fonction), ou ms écoulées. */
function until(b, ok, ms) {
  const f = typeof ok === 'function' ? ok : s => ok.test(s), end = b.rt.clock() + ms;
  while (b.rt.clock() < end && !f(b.take())) runFor(b.rt, 50);
  return f(b.out);
}
const count = (s, re) => (s.match(re) || []).length;

for (const [name, board] of [['Uno', UNO], ['Pico', PICO]]) {
  const sk = board === PICO ? skipPico : skip;
  test(`W5500 sur ${name} : l’exemple WebServer répond au navigateur du PC`, { skip: sk }, async () => {
    // L'exemple ne choisit pas la broche CS : la bibliothèque prend D10 sur l'Uno, et GP10 sur le Pico (le cœur
    // arduino-pico ne définit pas PIN_SPI_SS) : le module y est câblé, l'exemple reste tel quel.
    const b = fw(WEBSERVER, board, 'ws-' + board.kind, board === PICO ? { ...board.pins, CS: 'GP10' } : board.pins);
    assert.ok(until(b, /server is at 192\.168\.1\.177/, 3000), b.out);
    assert.doesNotMatch(b.out, /not found|not connected/);
    assert.equal(b.lan.ipOf('e:ws-' + board.kind).src, 'program');
    for (let i = 0; i < 2; i++) {
      const page = b.lan.http('pc', 'http://192.168.1.177/');
      until(b, s => count(s, /client disconnected/g) > i, 1500);
      const r = await page;
      assert.equal(r.code, 200, JSON.stringify(r));
      assert.match(r.body, /<!DOCTYPE HTML>\r\n<html>\r\nanalog input 0 is \d+<br \/>\r\n[\s\S]*analog input 5 is \d+<br \/>\r\n<\/html>/);
      if (board === UNO) assert.match(r.body, /analog input 0 is 51\d<br/, 'A0 à 2,5 V');
      assert.equal(count(b.out, /client disconnected/g), i + 1);
    }
    assert.match(b.out, /new client\r\nGET \/ HTTP\/1\.1\r\nHost: 192\.168\.1\.177/);
  });

  test(`W5500 sur ${name} : Ethernet.begin(mac) obtient un bail DHCP de la box, le DNS de la box résout un nom`, { skip: sk }, () => {
    const id = 'dh-' + board.kind, b = fw(DHCP_SKETCH, board, id);
    const seen = []; b.lan.on(e => { if (e.t === 'dhcp') seen.push(e.kind); });
    assert.ok(until(b, /nom=\d\r\n/, 15000), b.out); // ligne entière : la fin de ligne peut arriver dans la tranche suivante
    const ip = /ip=(\S+)/.exec(b.out)[1];
    assert.match(ip, /^192\.168\.1\.1\d\d$/);
    assert.match(b.out, /masque=255\.255\.255\.0\r\npasserelle=192\.168\.1\.1\r\ndns=192\.168\.1\.1\r\n/);
    assert.deepEqual(seen.slice(0, 2), ['OFFER', 'ACK'], 'vrais paquets DHCP');
    assert.deepEqual(b.comp.periph.eth, { mac: '02:4A:01:02:03:04', ip, prefix: 24, gw: '192.168.1.1', dhcp: true });
    const f = b.lan.ipOf('e:' + id); assert.equal(f.src, 'dhcp'); assert.equal(f.ip, ip);
    assert.ok(b.lan.ping('pc', ip).ok);
    assert.match(b.out, /nom=1\r\n/, 'client.connect("mq", 1883) : nom résolu par la box');
  });

  test(`W5500 sur ${name} : PubSubClient publie au broker et reçoit ce qu’il publie`, { skip: sk }, () => {
    const b = fw(MQTT_SKETCH, board, 'mq-' + board.kind);
    assert.ok(until(b, /connecte\r\n/, 3000), b.out);
    runFor(b.rt, 200);
    const br = b.lan.broker('mq');
    const t = br.topics(), temp = Array.isArray(t) ? t.find(x => (x.topic || x[0]) === 'atelier/temperature') : t && t['atelier/temperature'];
    assert.ok(temp, JSON.stringify(t));
    assert.match(JSON.stringify(temp), /23\.5/);
    br.publish('atelier/consigne', '19');
    assert.ok(until(b, /recu atelier\/consigne 19\r\n/, 1000), b.out);
    assert.ok(JSON.stringify(br.clients()).includes('carte1'));
  });
}

// ESP32 dans QEMU, en temps réel : les octets SPI passent par la cale (src/emu/esp32-bridge.js). L'exemple ne choisit
// pas CS et la bibliothèque prendrait GPIO 10 (broche de la mémoire flash) : on décommente l'une de ses lignes
// Ethernet.init(), avec GPIO 5 (VSPI).
test('W5500 sur ESP32 (QEMU) : l’exemple WebServer répond au navigateur du PC', { skip: skipEsp, timeout: 600000 }, async () => {
  const id = 'ws-esp32', data = plan(id), sleep = ms => new Promise(r => setTimeout(r, ms));
  const { hw, comps } = fakeBoard({ kind: 'esp32', modules: [{ type: 'w5500', id, pins: { CS: 'D5', SCK: 'D18', MOSI: 'D23', MISO: 'D19' } }] });
  const lan = lanFor(comps[0], data);
  hw.lan = () => lan;
  const src = WEBSERVER.replace('  Ethernet.begin(mac, ip);', '  Ethernet.init(5);\n  Ethernet.begin(mac, ip);');
  const rt = createEsp32Runtime(compileSketch(src, FQBN.esp32), hw, { transport: nodeTransport({ qemu: QEMU }) });
  let out = '';
  const pump = async (ok, ms) => { const end = Date.now() + ms; while (Date.now() < end && rt.state === 'run') { rt.run(16); out += rt.takeSerial(); if (ok()) return true; await sleep(16); } return ok(); };
  try {
    assert.ok(await pump(() => /server is at 192\.168\.1\.177/.test(out), 90000), out);
    let r = null;
    lan.http('pc', 'http://192.168.1.177/', { timeout: 60000 }).then(x => { r = x; });
    await pump(() => r, 60000);
    assert.ok(r, out);
    assert.equal(r.code, 200, JSON.stringify(r));
    assert.match(r.body, /analog input 0 is \d+<br \/>\r\n[\s\S]*analog input 5 is \d+<br \/>\r\n<\/html>/);
    await pump(() => /client disconnected/.test(out), 10000);
    assert.match(out, /new client\r\nGET \/ HTTP\/1\.1/);
  } finally { rt.stop(); }
});
