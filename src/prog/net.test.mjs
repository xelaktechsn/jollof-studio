// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Réseau informatique de l'interpréteur (prog/netlib.js) sur le réseau simulé commun (src/net/lan.js) : Ethernet par un
// module W5500 (DHCP, exemples WebServer et WebClient d'Arduino), PubSubClient vers le broker, ModbusTCPClient vers
// l'automate, Wi-Fi d'un ESP32 rejoint à un point d'accès du plan (WebServer, WiFiServer, HTTPClient, Ping).
// node --test src/prog/net.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './lang.js';
import { createRuntime } from './runtime.js';
import { BOARDS } from '../sim/boards.js';
import { NET_DEFAULT, macOf } from '../sim/models.js';
import { createLan } from '../net/lan.js';
import { newDevice } from '../net/devices.js';
import { makeCable } from '../net/cable.js';

const tick = () => new Promise(r => setImmediate(r));
let uid = 0;

/**
 * Plan réseau de l'atelier : box (DHCP), switch, PC, broker MQTT, automate Modbus, point d'accès « Atelier » (sur
 * secteur), et les nœuds du montage : un module W5500 câblé au switch, une carte ESP32 en Wi-Fi.
 * o.cable : false → le W5500 n'est pas câblé.
 */
function bench(o = {}) {
  const eth = { id: 'eth' + ++uid, type: 'w5500', name: 'ETH' + uid };
  const esp = { id: 'esp' + uid, type: 'esp32', name: 'ESP' + uid };
  const used = new Set(), data = { devices: [], cables: [] };
  for (const [id, type, p] of [['box', 'router'], ['sw', 'switch'], ['pc', 'pc'], ['mq', 'broker'], ['api', 'plc'], ['ap', 'ap', { power: 'adapter' }]]) {
    const d = newDevice(type, used); used.add(d.name); d.id = id; d.name = id.toUpperCase(); if (p) Object.assign(d.p, p); data.devices.push(d);
  }
  const links = [[['box', 'lan1'], ['sw', 'p1']], [['pc', 'eth0'], ['sw', 'p2']], [['mq', 'eth0'], ['sw', 'p3']], [['api', 'eth0'], ['sw', 'p4']], [['ap', 'eth0'], ['sw', 'p5']]];
  if (o.cable !== false) links.push([['e:' + eth.id, 'eth'], ['sw', 'p6']]);
  links.forEach(([a, b], i) => data.cables.push({ id: 'c' + i, a, b, cat: 'cat6', len: 3, wire: makeCable('straight') }));
  const wifiCfg = () => { const w = esp.periph && esp.periph.wifi; return w && w.lan && w.status === 3 && w.ip ? { ip: w.ip, prefix: w.prefix ?? 24, gw: w.gw, dhcp: !w.fixed } : null; };
  const lan = createLan({
    data: () => data,
    ext: () => [
      { id: 'e:' + eth.id, type: 'w5500', name: eth.name, x: 0, y: 0, mac: () => eth.periph && eth.periph.eth ? eth.periph.eth.mac : '', ipcfg: () => (eth.periph && eth.periph.eth) || null },
      { id: 'e:' + esp.id, type: 'wifi', name: esp.name, x: 0, y: 0, mac: () => macOf(esp), ipcfg: wifiCfg }
    ],
    sig: () => JSON.stringify([eth.periph && eth.periph.eth, wifiCfg()])
  });
  return { lan, data, eth, esp };
}
/** Carte factice : o.comps (modules reliés), o.lan (réseau), o.self (la carte), o.read(clé). */
function board(kind, o = {}) {
  return {
    kind, label: kind, prof: BOARDS[kind],
    read: k => (o.read ? o.read(k) : null), echo: () => null,
    onPin: () => null, at: () => [], bus: () => [], i2c: () => [],
    status: () => ({ ok: true, msg: '' }),
    comps: types => (o.comps || []).filter(c => types.includes(c.type)),
    peers: types => (o.peers || []).filter(c => types.includes(c.type)).map(c => ({ comp: c, ok: true })),
    data: () => null,
    self: () => o.self || (o.self = { type: kind, id: 'carte-' + ++uid, name: kind }),
    mem: () => o.mem || (o.mem = { ee: '', prefs: {} }), memChanged: () => {},
    net: () => o.net || (o.net = NET_DEFAULT()), netChanged: () => {},
    lan: () => o.lan || null,
    level: () => null
  };
}
function start(src, hw) {
  const c = compile(src, { board: hw.kind });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  rt.out = '';
  rt.step = (n = 1, dt = 16) => { for (let i = 0; i < n; i++) { rt.run(dt); rt.out += rt.takeSerial(); } assert.notEqual(rt.state, 'error', rt.error && rt.error.msg); return rt; };
  /** Fait tourner la carte jusqu'à ce que la promesse soit tenue (les serveurs du réseau répondent entre deux tranches). */
  rt.until = async (p, max = 400) => { let done = false, v; p.then(x => { done = true; v = x; }); for (let i = 0; i < max && !done; i++) { rt.step(1, 16); await tick(); } assert.ok(done, 'pas de réponse'); return v; };
  return rt;
}
const warned = (rt, re) => [...rt.warnings.values()].some(w => re.test(w.msg));

/* ---------- Ethernet : DHCP ---------- */
const DHCP = `#include <SPI.h>
#include <Ethernet.h>
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x01 };
void setup() {
  Serial.begin(9600);
  Ethernet.init(10);
  Serial.println(Ethernet.hardwareStatus() == EthernetW5500 ? "W5500" : "autre");
  if (Ethernet.begin(mac) == 0) {
    Serial.println("Echec DHCP");
    if (Ethernet.linkStatus() == LinkOFF) Serial.println("Cable debranche");
    return;
  }
  Serial.print("IP ");
  Serial.println(Ethernet.localIP());
  Serial.println(Ethernet.gatewayIP());
  Serial.println(Ethernet.subnetMask());
}
void loop() { Ethernet.maintain(); delay(100); }`;

test('Ethernet.begin(mac) : bail DHCP de la box, le module apparaît sur le plan et répond au ping', () => {
  const B = bench(), rt = start(DHCP, board('uno', { comps: [B.eth], lan: B.lan }));
  rt.step(10);
  assert.doesNotMatch(rt.out, /IP /, 'DHCP : environ 1 s');
  rt.step(80);
  assert.match(rt.out, /^W5500\n/);
  const ip = /IP (\S+)/.exec(rt.out)[1];
  assert.match(ip, /^192\.168\.1\.1\d\d$/);
  assert.match(rt.out, /192\.168\.1\.1\n255\.255\.255\.0\n/);
  assert.deepEqual(B.eth.periph.eth, { mac: 'DE:AD:BE:EF:FE:01', ip, prefix: 24, gw: '192.168.1.1', dns: '192.168.1.1', dhcp: true });
  const f = B.lan.ipOf('e:' + B.eth.id); assert.equal(f.ip, ip); assert.equal(f.src, 'dhcp');
  assert.ok(B.lan.ping('pc', ip).ok);
  assert.ok(B.lan.events().some(e => e.t === 'dhcp' && e.to === 'e:' + B.eth.id));
  // Le même module garde son adresse (même MAC) ; arrêt du programme : plus d'adresse.
  rt.stop();
  assert.equal(B.eth.periph.eth.ip, '');
  assert.equal(B.lan.ipOf('e:' + B.eth.id).ip, '');
});

test('Ethernet : sans câble, sans plan réseau, sans module', () => {
  const B = bench({ cable: false }), rt = start(DHCP, board('uno', { comps: [B.eth], lan: B.lan }));
  rt.step(300, 250);
  assert.match(rt.out, /Echec DHCP\nCable debranche\n/);
  assert.ok(warned(rt, /aucun câble RJ45 n’est branché sur ETH/));
  const none = start(DHCP, board('uno', { comps: [B.eth] })); none.step(300, 250);
  assert.match(none.out, /Echec DHCP\nCable debranche\n/);
  assert.ok(warned(none, /pas de plan réseau/));
  const nohw = start(DHCP, board('uno', { lan: B.lan })); nohw.step(5);
  assert.match(nohw.out, /^autre\nEchec DHCP\n/);
  assert.ok(warned(nohw, /aucun module Ethernet/));
});

/* ---------- Ethernet : exemples WebServer et WebClient d'Arduino (inchangés, sauf l'adresse du serveur) ---------- */
const WEBSERVER = `#include <SPI.h>
#include <Ethernet.h>

// Enter a MAC address and IP address for your controller below.
// The IP address will be dependent on your local network:
byte mac[] = {
  0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED
};
IPAddress ip(192, 168, 1, 177);

// Initialize the Ethernet server library
// with the IP address and port you want to use
// (port 80 is default for HTTP):
EthernetServer server(80);

void setup() {
  // You can use Ethernet.init(pin) to configure the CS pin
  //Ethernet.init(10);  // Most Arduino shields

  // Open serial communications and wait for port to open:
  Serial.begin(9600);
  while (!Serial) {
    ; // wait for serial port to connect. Needed for native USB port only
  }
  Serial.println("Ethernet WebServer Example");

  // start the Ethernet connection and the server:
  Ethernet.begin(mac, ip);

  // Check for Ethernet hardware present
  if (Ethernet.hardwareStatus() == EthernetNoHardware) {
    Serial.println("Ethernet shield was not found.  Sorry, can't run without hardware. :(");
    while (true) {
      delay(1); // do nothing, no point running without Ethernet hardware
    }
  }
  if (Ethernet.linkStatus() == LinkOFF) {
    Serial.println("Ethernet cable is not connected.");
  }

  // start the server
  server.begin();
  Serial.print("server is at ");
  Serial.println(Ethernet.localIP());
}


void loop() {
  // listen for incoming clients
  EthernetClient client = server.available();
  if (client) {
    Serial.println("new client");
    // an HTTP request ends with a blank line
    boolean currentLineIsBlank = true;
    while (client.connected()) {
      if (client.available()) {
        char c = client.read();
        Serial.write(c);
        // if you've gotten to the end of the line (received a newline
        // character) and the line is blank, the HTTP request has ended,
        // so you can send a reply
        if (c == '\\n' && currentLineIsBlank) {
          // send a standard HTTP response header
          client.println("HTTP/1.1 200 OK");
          client.println("Content-Type: text/html");
          client.println("Connection: close");  // the connection will be closed after completion of the response
          client.println("Refresh: 5");  // refresh the page automatically every 5 sec
          client.println();
          client.println("<!DOCTYPE HTML>");
          client.println("<html>");
          // output the value of each analog input pin
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
        if (c == '\\n') {
          // you're starting a new line
          currentLineIsBlank = true;
        } else if (c != '\\r') {
          // you've gotten a character on the current line
          currentLineIsBlank = false;
        }
      }
    }
    // give the web browser time to receive the data
    delay(1);
    // close the connection:
    client.stop();
    Serial.println("client disconnected");
  }
}`;

test('Exemple Ethernet › WebServer : le navigateur du PC lit la valeur du capteur', async () => {
  const B = bench(), rt = start(WEBSERVER, board('uno', { comps: [B.eth], lan: B.lan, read: k => (k === 'A0' ? { v: 2.5 } : { v: 0 }) }));
  rt.step(5);
  assert.match(rt.out, /server is at 192\.168\.1\.177\n/);
  assert.doesNotMatch(rt.out, /cable is not connected/);
  const page = await rt.until(B.lan.http('pc', 'http://192.168.1.177/'));
  assert.equal(page.code, 200, page.why);
  assert.match(page.body, /analog input 0 is 512<br \/>/);
  assert.match(page.body, /analog input 1 is 0<br \/>/);
  rt.step(2);
  assert.match(rt.out, /new client\nGET \/ HTTP\/1\.1\r\nHost: 192\.168\.1\.177\r\n/);
  assert.match(rt.out, /client disconnected\n/);
  // Une deuxième visite, par le nom du module.
  const again = await rt.until(B.lan.http('pc', 'http://' + B.eth.name + '/'));
  assert.equal(again.code, 200);
  assert.equal(B.lan.ipOf('e:' + B.eth.id).src, 'program');
});

const WEBCLIENT = `#include <SPI.h>
#include <Ethernet.h>

// Enter a MAC address for your controller below.
// Newer Ethernet shields have a MAC address printed on a sticker on the shield
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };

// if you don't want to use DNS (and reduce your sketch size)
// use the numeric IP instead of the name for the server:
//IPAddress server(74,125,232,128);  // numeric IP for Google (no DNS)
char server[] = "box";    // name address for Google (using DNS)

// Set the static IP address to use if the DHCP fails to assign
IPAddress ip(192, 168, 0, 177);
IPAddress myDns(192, 168, 0, 1);

// Initialize the Ethernet client library
// with the IP address and port of the server
// that you want to connect to (port 80 is default for HTTP):
EthernetClient client;

// Variables to measure the speed
unsigned long beginMicros, endMicros;
unsigned long byteCount = 0;
bool printWebData = true;  // set to false for better speed measurement

void setup() {
  // You can use Ethernet.init(pin) to configure the CS pin
  //Ethernet.init(10);  // Most Arduino shields

  // Open serial communications and wait for port to open:
  Serial.begin(9600);
  while (!Serial) {
    ; // wait for serial port to connect. Needed for native USB port only
  }

  // start the Ethernet connection:
  Serial.println("Initialize Ethernet with DHCP:");
  if (Ethernet.begin(mac) == 0) {
    Serial.println("Failed to configure Ethernet using DHCP");
    // Check for Ethernet hardware present
    if (Ethernet.hardwareStatus() == EthernetNoHardware) {
      Serial.println("Ethernet shield was not found.  Sorry, can't run without hardware. :(");
      while (true) {
        delay(1); // do nothing, no point running without Ethernet hardware
      }
    }
    if (Ethernet.linkStatus() == LinkOFF) {
      Serial.println("Ethernet cable is not connected.");
    }
    // try to configure using IP address instead of DHCP:
    Ethernet.begin(mac, ip, myDns);
  } else {
    Serial.print("  DHCP assigned IP ");
    Serial.println(Ethernet.localIP());
  }
  // give the Ethernet shield a second to initialize:
  delay(1000);
  Serial.print("connecting to ");
  Serial.print(server);
  Serial.println("...");

  // if you get a connection, report back via serial:
  if (client.connect(server, 80)) {
    Serial.print("connected to ");
    Serial.println(client.remoteIP());
    // Make a HTTP request:
    client.println("GET / HTTP/1.1");
    client.println("Host: box");
    client.println("Connection: close");
    client.println();
  } else {
    // if you didn't get a connection to the server:
    Serial.println("connection failed");
  }
  beginMicros = micros();
}

void loop() {
  // if there are incoming bytes available
  // from the server, read them and print them:
  int len = client.available();
  if (len > 0) {
    byte buffer[80];
    if (len > 80) len = 80;
    client.read(buffer, len);
    if (printWebData) {
      Serial.write(buffer, len); // show in the serial monitor (slows some boards)
    }
    byteCount = byteCount + len;
  }

  // if the server's disconnected, stop the client:
  if (!client.connected()) {
    endMicros = micros();
    Serial.println();
    Serial.println("disconnecting.");
    client.stop();
    Serial.print("Received ");
    Serial.print(byteCount);
    Serial.print(" bytes in ");
    float seconds = (float)(endMicros - beginMicros) / 1000000.0;
    Serial.print(seconds, 4);
    Serial.print(", rate = ");
    Serial.print((float)byteCount / seconds * 8 / 1000);
    Serial.println(" kbps");
    Serial.println();

    // do nothing forevermore:
    while (true) {
      delay(1);
    }
  }
}`;

test('Exemple Ethernet › WebClient : page d’état de la box lue par son nom', async () => {
  const B = bench(), rt = start(WEBCLIENT, board('uno', { comps: [B.eth], lan: B.lan }));
  for (let i = 0; i < 200 && !/disconnecting/.test(rt.out); i++) { rt.step(1, 50); await tick(); }
  assert.match(rt.out, /DHCP assigned IP 192\.168\.1\.1\d\d\n/);
  assert.match(rt.out, /connecting to box\.\.\.\nconnected to 192\.168\.1\.1\n/);
  assert.match(rt.out, /HTTP\/1\.1 200 OK\r\n/);
  assert.match(rt.out, /Baux DHCP/);
  assert.match(rt.out, /disconnecting\.\nReceived \d+ bytes in /);
  const n = +/Received (\d+) bytes/.exec(rt.out)[1]; assert.ok(n > 300, String(n));
});

/* ---------- MQTT : PubSubClient sur Ethernet ---------- */
const MQTT_SKETCH = `#include <SPI.h>
#include <Ethernet.h>
#include <PubSubClient.h>
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x02 };
IPAddress server(192, 168, 1, 10);
EthernetClient ethClient;
PubSubClient client(ethClient);
int led = 0;
unsigned long t0 = 0;
void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Message [");
  Serial.print(topic);
  Serial.print("] ");
  for (unsigned int i = 0; i < length; i++) Serial.print((char)payload[i]);
  Serial.println();
  if (strcmp(topic, "atelier/led") == 0) led = (char)payload[0] == '1';
}
void reconnect() {
  while (!client.connected()) {
    if (client.connect("arduinoClient")) {
      Serial.println("connecte");
      client.publish("outTopic", "hello world");
      client.subscribe("atelier/#");
    } else {
      Serial.print("echec, rc=");
      Serial.println(client.state());
      delay(5000);
    }
  }
}
void setup() {
  Serial.begin(9600);
  client.setServer(server, 1883);
  client.setCallback(callback);
  Ethernet.begin(mac);
  delay(1500);
}
void loop() {
  if (!client.connected()) reconnect();
  client.loop();
  if (millis() - t0 > 1000) {
    t0 = millis();
    String msg = String(analogRead(A0));
    client.publish("capteurs/lumiere", msg.c_str(), true);
    Serial.print("led=");
    Serial.println(led);
  }
}`;

test('PubSubClient : publication vue par le broker, message du broker reçu par le rappel', () => {
  const B = bench(), rt = start(MQTT_SKETCH, board('uno', { comps: [B.eth], lan: B.lan, read: k => (k === 'A0' ? { v: 1.25 } : null) }));
  rt.step(200);
  assert.match(rt.out, /connecte\n/);
  const br = B.lan.broker('mq'), topics = new Map(br.topics().map(t => [t.topic, t]));
  assert.equal(topics.get('outTopic').text, 'hello world');
  assert.equal(topics.get('capteurs/lumiere').text, '256');
  assert.ok(topics.get('capteurs/lumiere').retained);
  assert.deepEqual(br.clients().map(c => c.id), ['arduinoClient']);
  assert.deepEqual(br.clients()[0].subs, ['atelier/#']);
  br.publish('atelier/led', '1');
  rt.step(5);
  assert.match(rt.out, /Message \[atelier\/led\] 1\n/);
  rt.step(80);
  assert.match(rt.out, /led=1\n/);
  // Broker arrêté (câble retiré) : la connexion est refusée, state() le dit.
  B.data.cables = B.data.cables.filter(c => c.a[0] !== 'mq'); B.lan.refresh();
  const r2 = start(MQTT_SKETCH, board('uno', { comps: [{ id: 'eth-b', type: 'w5500', name: 'ETHB' }], lan: B.lan }));
  r2.step(100);
  assert.doesNotMatch(r2.out, /connecte\n/);
});

test('PubSubClient sans plan réseau : échec clair, rc=-2', () => {
  const rt = start(MQTT_SKETCH, board('uno', { comps: [{ id: 'eth-x', type: 'w5500', name: 'ETHX' }] }));
  rt.step(300, 250);
  assert.match(rt.out, /echec, rc=-2\n/);
  assert.ok(warned(rt, /PubSubClient\.connect\(\) vers 192\.168\.1\.10:1883 : le projet n’a pas de plan réseau/));
});

/* ---------- Modbus TCP ---------- */
const MODBUS = `#include <SPI.h>
#include <Ethernet.h>
#include <ArduinoRS485.h>
#include <ArduinoModbus.h>
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x03 };
IPAddress ip(192, 168, 1, 60);
IPAddress automate(192, 168, 1, 50);
EthernetClient ethClient;
ModbusTCPClient modbusTCPClient(ethClient);
void setup() {
  Serial.begin(9600);
  Ethernet.begin(mac, ip);
  if (!modbusTCPClient.begin(automate, 502)) { Serial.println("automate injoignable"); return; }
  if (!modbusTCPClient.holdingRegisterWrite(3, 1234)) Serial.println(modbusTCPClient.lastError());
  if (!modbusTCPClient.coilWrite(0x00, 1)) Serial.println(modbusTCPClient.lastError());
  Serial.println(modbusTCPClient.holdingRegisterRead(3));
  Serial.println(modbusTCPClient.coilRead(0));
  Serial.println(modbusTCPClient.inputRegisterRead(1));
  long bad = modbusTCPClient.holdingRegisterRead(500);
  Serial.println(bad);
  Serial.println(modbusTCPClient.lastError());
}
void loop() {}`;

test('ModbusTCPClient : écrire puis lire les registres de l’automate', () => {
  const B = bench(), rt = start(MODBUS, board('uno', { comps: [B.eth], lan: B.lan }));
  B.lan.bank('api').write('hr', 0, 0);
  B.data.devices.find(d => d.id === 'api').p.regs.ir[1] = 77;
  rt.step(20);
  assert.equal(rt.out, '1234\n1\n77\n-1\nIllegal data address\n');
  assert.equal(B.lan.bank('api').read('hr', 3), 1234);
  assert.equal(B.lan.bank('api').read('coils', 0), 1);
});

/* ---------- ESP32 en Wi-Fi sur le plan ---------- */
const ESP_WEB = `#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Ping.h>
WebServer server(80);
float temperature = 23.5;
void racine() { server.send(200, "text/html", "<h1>Atelier</h1><p>Temperature : " + String(temperature) + "</p>"); }
void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.begin("Atelier", "jollof2024");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println();
  Serial.println(WiFi.localIP());
  server.on("/", racine);
  server.on("/led", HTTP_POST, []() { server.send(200, "text/plain", "LED " + server.arg("etat")); });
  server.begin();
  Serial.println(Ping.ping("box", 3) ? "ping ok" : "ping perdu");
  Serial.println(Ping.averageTime() > 0);
  Serial.println(Ping.ping("192.168.1.250", 1) ? "ping ok" : "ping perdu");
}
void loop() { server.handleClient(); }`;

test('ESP32 : WiFi.begin vers le point d’accès du plan, WebServer joignable depuis le PC, Ping', async () => {
  const B = bench(), o = { self: B.esp, lan: B.lan }, rt = start(ESP_WEB, board('esp32', o));
  rt.step(450);
  const ip = /\n(192\.168\.1\.\d+)\n/.exec(rt.out)[1];
  assert.match(ip, /^192\.168\.1\.1\d\d$/);
  assert.equal(B.esp.periph.wifi.lan, true);
  assert.equal(B.lan.wifiOf('e:' + B.esp.id).ap, 'ap');
  assert.equal(B.lan.ipOf('e:' + B.esp.id).ip, ip);
  assert.match(rt.out, /ping ok\n1\nping perdu\n/);
  const page = await rt.until(B.lan.http('pc', `http://${ip}/`));
  assert.equal(page.code, 200);
  assert.match(page.body, /Temperature : 23\.50/);
  const post = await rt.until(B.lan.http('pc', `http://${ip}/led`, { method: 'POST', body: 'etat=on' }));
  assert.equal(post.body, 'LED on');
  const nf = await rt.until(B.lan.http('pc', `http://${ip}/rien`));
  assert.equal(nf.code, 404);
  // Le navigateur du panneau « Périphériques » (file directe) marche toujours.
  const r = { id: 1, method: 1, path: '/', args: [], body: '', state: 'pending', resp: null, at: Date.now() };
  B.esp.periph.web.queue.push(r); rt.step(2);
  assert.equal(r.resp.code, 200);
  // Arrêt : la carte quitte le réseau.
  rt.dispose();
  assert.equal(B.lan.wifiOf('e:' + B.esp.id).ap, null);
  assert.equal((await B.lan.http('pc', `http://${ip}/`)).code, 0);
});

test('ESP32 : mauvais mot de passe, réseau du bac à sable signalé', () => {
  const B = bench();
  const bad = start(ESP_WEB.replace('"jollof2024"', '"faux"').replace('while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }', 'delay(3000); Serial.println(WiFi.status());'), board('esp32', { self: B.esp, lan: B.lan }));
  bad.step(250);
  assert.match(bad.out, /^4\n/);
  assert.ok(warned(bad, /mot de passe refusé/));
  const sb = start(ESP_WEB.replace('"Atelier"', '"Ecole-WiFi"').replace(/Serial\.println\(Ping[^\n]*\n/g, ''), board('esp32', { lan: B.lan }));
  sb.step(300);
  assert.match(sb.out, /\n192\.168\.1\.\d+\n/);
  assert.ok(warned(sb, /bac à sable, hors du plan réseau/));
});

/* ---------- Exemple WiFi › SimpleWiFiServer (ESP32) ---------- */
const SIMPLE = `#include <WiFi.h>

const char *ssid = "Atelier";
const char *password = "jollof2024";

WiFiServer server(80);

void setup() {
  Serial.begin(115200);
  pinMode(5, OUTPUT);  // set the LED pin mode

  delay(10);

  // We start by connecting to a WiFi network

  Serial.println();
  Serial.println();
  Serial.print("Connecting to ");
  Serial.println(ssid);

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("");
  Serial.println("WiFi connected.");
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());

  server.begin();
}

void loop() {
  WiFiClient client = server.available();  // listen for incoming clients

  if (client) {                     // if you get a client,
    Serial.println("New Client.");  // print a message out the serial port
    String currentLine = "";        // make a String to hold incoming data from the client
    while (client.connected()) {    // loop while the client's connected
      if (client.available()) {     // if there's bytes to read from the client,
        char c = client.read();     // read a byte, then
        Serial.write(c);            // print it out the serial monitor
        if (c == '\\n') {            // if the byte is a newline character

          // if the current line is blank, you got two newline characters in a row.
          // that's the end of the client HTTP request, so send a response:
          if (currentLine.length() == 0) {
            // HTTP headers always start with a response code (e.g. HTTP/1.1 200 OK)
            // and a content-type so the client knows what's coming, then a blank line:
            client.println("HTTP/1.1 200 OK");
            client.println("Content-type:text/html");
            client.println();

            // the content of the HTTP response follows the header:
            client.print("Click <a href=\\"/H\\">here</a> to turn the LED on pin 5 on.<br>");
            client.print("Click <a href=\\"/L\\">here</a> to turn the LED on pin 5 off.<br>");

            // The HTTP response ends with another blank line:
            client.println();
            // break out of the while loop:
            break;
          } else {  // if you got a newline, then clear currentLine:
            currentLine = "";
          }
        } else if (c != '\\r') {  // if you got anything else but a carriage return character,
          currentLine += c;      // add it to the end of the currentLine
        }

        // Check to see if the client request was "GET /H" or "GET /L":
        if (currentLine.endsWith("GET /H")) {
          digitalWrite(5, HIGH);  // GET /H turns the LED on
        }
        if (currentLine.endsWith("GET /L")) {
          digitalWrite(5, LOW);  // GET /L turns the LED off
        }
      }
    }
    // close the connection:
    client.stop();
    Serial.println("Client Disconnected.");
  }
}`;

test('Exemple WiFi › SimpleWiFiServer : le PC allume et éteint la LED', async () => {
  const B = bench(), rt = start(SIMPLE, board('esp32', { self: B.esp, lan: B.lan }));
  rt.step(300);
  const ip = /IP address: \n(\S+)\n/.exec(rt.out)[1];
  const on = await rt.until(B.lan.http('pc', `http://${ip}/H`));
  assert.equal(on.code, 200);
  assert.match(on.body, /turn the LED on pin 5 on/);
  rt.step(2);
  assert.equal(rt.pins.get(rt.pins.has('D5') ? 'D5' : [...rt.pins.keys()].find(k => /5$/.test(k))).d, 1);
  await rt.until(B.lan.http('pc', `http://${ip}/L`));
  rt.step(2);
  assert.equal([...rt.pins.entries()].find(([k]) => /5$/.test(k))[1].d, 0);
  assert.match(rt.out, /Client Disconnected\.\n/);
});

/* ---------- HTTPClient et WiFiClient vers les machines du plan ---------- */
const ESP_CLIENT = `#include <WiFi.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
WiFiClient espClient;
PubSubClient mqtt(espClient);
void recu(char* topic, byte* payload, unsigned int length) {
  String s = "";
  for (unsigned int i = 0; i < length; i++) s += (char)payload[i];
  Serial.println(String(topic) + "=" + s);
}
void setup() {
  Serial.begin(115200);
  WiFi.begin("Atelier", "jollof2024");
  while (WiFi.status() != WL_CONNECTED) delay(100);
  HTTPClient http;
  http.begin("http://box/");
  int code = http.GET();
  Serial.println(code);
  Serial.println(http.getString().indexOf("Baux DHCP") >= 0);
  http.end();
  http.begin("http://192.168.1.10/");
  Serial.println(http.GET());
  mqtt.setServer("mq", 1883);
  mqtt.setCallback(recu);
  Serial.println(mqtt.connect("esp32-atelier") ? "mqtt ok" : "mqtt ko");
  mqtt.subscribe("commandes/+");
  mqtt.publish("capteurs/esp32", "42");
}
void loop() { mqtt.loop(); delay(10); }`;

test('ESP32 : HTTPClient vers la page de la box, PubSubClient par WiFiClient', async () => {
  const B = bench(), rt = start(ESP_CLIENT, board('esp32', { self: B.esp, lan: B.lan }));
  for (let i = 0; i < 400 && !/mqtt/.test(rt.out); i++) { rt.step(1, 16); await tick(); }
  assert.match(rt.out, /^200\n1\n-1\nmqtt ok\n/);
  assert.equal(B.lan.broker('mq').topics().find(t => t.topic === 'capteurs/esp32').text, '42');
  B.lan.broker('mq').publish('commandes/pompe', 'marche');
  rt.step(3);
  assert.match(rt.out, /commandes\/pompe=marche\n/);
});

test('Compilation : bibliothèques réseau connues, Ping réservé aux cartes Wi-Fi, PubSubClient simulé', () => {
  for (const [src, kind] of [[WEBSERVER, 'uno'], [WEBCLIENT, 'mega'], [MQTT_SKETCH, 'nano'], [MODBUS, 'uno'], [MQTT_SKETCH, 'esp32'], [MQTT_SKETCH.replace('Ethernet.h', 'UIPEthernet.h'), 'uno']]) {
    const c = compile(src, { board: kind });
    assert.ok(c.ok, kind + ' ' + JSON.stringify(c.errors));
    assert.ok(!c.warnings.some(w => w.code === 'J1109'), JSON.stringify(c.warnings));
  }
  const c = compile(ESP_WEB, { board: 'uno' });
  assert.ok(!c.ok); assert.equal(c.errors[0].code, 'J1111');
  const bad = compile(WEBSERVER.replace('client.stop();', 'client.close2();'), { board: 'uno' });
  assert.ok(!bad.ok); assert.match(bad.errors[0].msg, /close2/);
});

/* ---------- UDP ---------- */
const UDP_TX = `#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x05 };
IPAddress ip(192, 168, 1, 70);
EthernetUDP Udp;
char buf[32];
void setup() {
  Serial.begin(9600);
  Ethernet.begin(mac, ip);
  Udp.begin(8888);
}
void loop() {
  int n = Udp.parsePacket();
  if (n) {
    int k = Udp.read(buf, 31); buf[k] = 0;
    Serial.print(Udp.remoteIP()); Serial.print(" "); Serial.println(buf);
    Udp.beginPacket(Udp.remoteIP(), Udp.remotePort());
    Udp.print("ack ");
    Udp.print(buf);
    Udp.endPacket();
  }
  delay(10);
}`;

test('EthernetUDP : un datagramme reçu, une réponse renvoyée', () => {
  const B = bench(), rt = start(UDP_TX, board('uno', { comps: [B.eth], lan: B.lan }));
  rt.step(3);
  const got = []; B.lan.udpBind('pc', 5000, dg => got.push(new TextDecoder().decode(dg.bytes)));
  assert.ok(B.lan.udpSend('pc', 5000, '192.168.1.70', 8888, new TextEncoder().encode('bonjour')));
  rt.step(3);
  assert.match(rt.out, /^192\.168\.1\.1\d\d bonjour\n$/);
  assert.deepEqual(got, ['ack bonjour']);
});
