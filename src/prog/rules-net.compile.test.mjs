// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Réseau des règles (rules-net.js) compilé par arduino-cli avec -Wall -Wextra, zéro avertissement dans le croquis :
// - module ENC28J60 (bibliothèque EthernetENC) : Uno (DHCP et adresse fixe), Mega et Pico ; plus un programme écrit à
//   la main avec EthernetENC (serveur web et client MQTT) ;
// - ESP8266 en Wi-Fi (cœur esp8266:esp8266) : NodeMCU et Wemos D1 mini, et un programme écrit à la main avec ce que
//   vise l'interpréteur sur ces cartes (ESP8266WiFi, ESP8266WebServer, PubSubClient), que l'interpréteur accepte aussi ;
// - le TP iot04 (règles → MQTT et page web) : le programme que ses règles génèrent, sur l'Uno.
// Chaque groupe est ignoré proprement sans arduino-cli, sans la bibliothèque ou sans le cœur.
// node --test src/prog/rules-net.compile.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { bench, rule, act, set, variable, netRules, compile, hasCli } from './rulekit.mjs';
import { compile as interp } from './lang.js';
import { loadProject } from '../check/load.js';

const libs = hasCli ? spawnSync('arduino-cli', ['lib', 'list'], { encoding: 'utf8' }).stdout || '' : '';
const cores = hasCli ? spawnSync('arduino-cli', ['core', 'list'], { encoding: 'utf8' }).stdout || '' : '';
const has = l => new RegExp(`^${l}\\s`, 'm').test(libs);
const skipEnc = !hasCli ? 'arduino-cli absent' : !has('EthernetENC') || !has('PubSubClient') ? 'bibliothèques EthernetENC et PubSubClient absentes (arduino-cli lib install EthernetENC PubSubClient)' : false;
const skipPico = skipEnc || (!/^rp2040:rp2040\s/m.test(cores) && 'cœur rp2040 absent');
const skipEsp8266 = !hasCli ? 'arduino-cli absent' : !/^esp8266:esp8266\s/m.test(cores) ? 'cœur esp8266 absent (arduino-cli core install esp8266:esp8266 --additional-urls https://arduino.esp8266.com/stable/package_esp8266com_index.json)' : !has('PubSubClient') ? 'bibliothèque PubSubClient absente' : false;
const skipW5500 = !hasCli ? 'arduino-cli absent' : !has('Ethernet') || !has('PubSubClient') ? 'bibliothèques Ethernet et PubSubClient absentes' : false;
const FQ = { uno: 'arduino:avr:uno', mega: 'arduino:avr:mega', pico: 'rp2040:rp2040:rpipico', nodemcu: 'esp8266:esp8266:nodemcuv2', d1mini: 'esp8266:esp8266:d1_mini' };

function cc(code, fqbn, what) {
  const r = compile(code, fqbn);
  assert.ok(r.ok, `${what} (${fqbn}) ne compile pas :\n${r.errors.join('\n')}\n${code}`);
  assert.deepEqual(r.warnings, [], `${what} (${fqbn}) : avertissements`);
  return r;
}
/** Atelier connecté plus : texte publié quand il change, sujet à joker, page qui suit la connexion, mesure à virgule. */
function netProgram(kind, types, cfg) {
  const M = bench(kind, types), t = variable('etat', 'text', 'ok', { len: 12 }), D = M.comps.find(c => c.type === 'dht22');
  return M.code([...netRules(M), t, ...(cfg ? [{ kind: 'net', id: 'n1', ...cfg }] : []),
    rule(null, [act('@net', 'publish', null, { topic: 'atelier/etat_texte', what: { var: t.id } }), act('@net', 'page', null, { what: { var: t.id }, line: 4 })]),
    rule({ comp: '@net', sig: 'msg', topic: 'atelier/+/mode' }, [set(t, '=', null, { src: { comp: '@net', sig: 'msg', topic: 'atelier/+/mode' } })], [], { op: 'any' }),
    rule({ comp: '@net', sig: 'online' }, [act('@net', 'page', 'en ligne', { line: 5 })], [act('@serial', 'print', 'hors ligne')], { op: '==', v: 1 }),
    ...(D ? [rule({ every: 5000 }, [act('@net', 'publish', null, { topic: 'serre/temp', what: { comp: D.id, sig: 'temp' } })])] : [])]);
}
const workshop = (kind, types, cfg) => { const M = bench(kind, types); return M.code([...(cfg ? [{ kind: 'net', id: 'n1', ...cfg }] : []), ...netRules(M)]); };

/* ---------- ENC28J60 : EthernetENC ---------- */
test('règles + ENC28J60 : EthernetENC à la place d’Ethernet, programmes robustes acceptés par l’interpréteur', () => {
  for (const [kind, code] of [['uno', workshop('uno', ['enc28j60', 'pot', 'led-red'])], ['pico', netProgram('pico', ['enc28j60', 'pot', 'led-red'])]]) {
    assert.match(code, /#include <EthernetENC\.h>/); assert.doesNotMatch(code, /#include <Ethernet\.h>/);
    assert.match(code, /Ethernet\.init\(ETH1_CS\);/);
    const c = interp(code, { board: kind }); assert.ok(c.ok, JSON.stringify(c.errors && c.errors.slice(0, 3)));
  }
});
test('règles + ENC28J60 : zéro avertissement (Uno en DHCP et en adresse fixe, Mega, Pico)', { skip: skipEnc, timeout: 600000 }, () => {
  // Uno : l'atelier entier (MQTT, page web, DHCP) tient dans les 32 Ko (EthernetENC porte la pile TCP/IP) ; le
  // programme plus riche de netProgram dépasse la mémoire de l'Uno et se compile pour le Mega.
  const r = cc(workshop('uno', ['enc28j60', 'pot', 'led-red']), FQ.uno, 'atelier ENC28J60 DHCP');
  assert.ok(r.flash > 0 && r.flash <= 32256, `flash ${r.flash}`);
  cc(workshop('uno', ['enc28j60', 'pot', 'led-red'], { dhcp: false, ip: '192.168.1.60' }), FQ.uno, 'atelier ENC28J60 adresse fixe');
  cc(netProgram('mega', ['enc28j60', 'pot', 'led-red', 'dht22']), FQ.mega, 'réseau complet ENC28J60');
});
test('règles + ENC28J60 sur Pico : zéro avertissement', { skip: skipPico, timeout: 600000 }, () => {
  cc(netProgram('pico', ['enc28j60', 'pot', 'led-red'], { dhcp: false, ip: '192.168.1.61' }), FQ.pico, 'réseau complet ENC28J60');
});

// Programme écrit à la main : serveur web (mesure de A0) et client MQTT, par EthernetENC (même API qu'Ethernet).
const ENC_SKETCH = `#include <SPI.h>
#include <EthernetENC.h>
#include <PubSubClient.h>

byte mac[] = { 0x02, 0x4A, 0x00, 0x00, 0x00, 0x28 };
IPAddress ip(192, 168, 1, 62);
IPAddress serveurMqtt(192, 168, 1, 10);
EthernetServer serveur(80);
EthernetClient reseau;
PubSubClient mqtt(reseau);
uint32_t dernier = 0;

void recu(char *sujet, byte *contenu, unsigned int taille) {
  if (strcmp(sujet, "atelier/led") == 0) digitalWrite(7, taille > 0 && contenu[0] == '1' ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);
  pinMode(7, OUTPUT);
  Ethernet.init(10);
  Ethernet.begin(mac, ip);
  if (Ethernet.hardwareStatus() == EthernetNoHardware) Serial.println(F("ENC28J60 absent"));
  serveur.begin();
  mqtt.setServer(serveurMqtt, 1883);
  mqtt.setCallback(recu);
}

void loop() {
  if (!mqtt.connected() && millis() - dernier >= 5000UL) {
    dernier = millis();
    if (mqtt.connect("enc28j60")) mqtt.subscribe("atelier/led");
  }
  mqtt.loop();
  EthernetClient client = serveur.available();
  if (client) {
    bool vide = true;
    while (client.connected() && client.available()) {
      const char c = (char)client.read();
      if (c == '\\n' && vide) {
        client.print(F("HTTP/1.1 200 OK\\r\\nContent-Type: text/plain\\r\\nConnection: close\\r\\n\\r\\nA0 = "));
        client.println(analogRead(A0));
        break;
      }
      if (c == '\\n') vide = true;
      else if (c != '\\r') vide = false;
    }
    client.stop();
  }
}
`;
test('programme EthernetENC écrit à la main : accepté par l’interpréteur, zéro avertissement sur Uno', { skip: skipEnc, timeout: 600000 }, () => {
  const c = interp(ENC_SKETCH, { board: 'uno' }); assert.ok(c.ok, JSON.stringify(c.errors && c.errors.slice(0, 3)));
  cc(ENC_SKETCH, FQ.uno, 'serveur web + MQTT EthernetENC');
});

/* ---------- ESP8266 (NodeMCU, D1 mini) en Wi-Fi ---------- */
test('règles + ESP8266 : ESP8266WiFi, WiFiClient, WiFiServer, sans le délai de connexion de l’ESP32', () => {
  const code = netProgram('nodemcu', ['pot', 'led-red']);
  assert.match(code, /#include <ESP8266WiFi\.h>/); assert.doesNotMatch(code, /#include <WiFi\.h>/);
  assert.match(code, /WiFiClient reseauClient;/); assert.match(code, /WiFiServer serveurWeb\(80\);/);
  assert.doesNotMatch(code, /setConnectionTimeout/, 'WiFiClient de l’ESP8266 : pas de setConnectionTimeout');
  const c = interp(code, { board: 'nodemcu' }); assert.ok(c.ok, JSON.stringify(c.errors && c.errors.slice(0, 3)));
});
test('règles + ESP8266 : zéro avertissement (NodeMCU : réseau complet ; D1 mini : atelier, adresse du serveur par nom)', { skip: skipEsp8266, timeout: 900000 }, () => {
  cc(netProgram('nodemcu', ['pot', 'led-red', 'dht22'], { ssid: 'Box-Jollof', broker: 'mq' }), FQ.nodemcu, 'réseau Wi-Fi ESP8266');
  const M = bench('d1mini', ['pot', 'led-red']);
  cc(M.code([{ kind: 'net', id: 'n1', broker: 'mq' }, ...netRules(M)]), FQ.d1mini, 'atelier Wi-Fi D1 mini');
});

// Ce que l'interpréteur simule sur l'ESP8266 : Wi-Fi, serveur web ESP8266WebServer, client MQTT PubSubClient.
const ESP8266_SKETCH = `#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <PubSubClient.h>

const char ssid[] = "Atelier";
const char motDePasse[] = "jollof2024";
ESP8266WebServer serveur(80);
WiFiClient wifi;
PubSubClient mqtt(wifi);
uint32_t dernier = 0;

void pageAccueil() {
  char texte[48];
  snprintf(texte, sizeof(texte), "A0 = %d", analogRead(A0));
  serveur.send(200, "text/plain", texte);
}

void recu(char *sujet, byte *contenu, unsigned int taille) {
  (void)sujet;
  digitalWrite(LED_BUILTIN, taille > 0 && contenu[0] == '1' ? LOW : HIGH);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, motDePasse);
  serveur.on("/", pageAccueil);
  serveur.begin();
  mqtt.setServer("192.168.1.10", 1883);
  mqtt.setCallback(recu);
}

void loop() {
  serveur.handleClient();
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected() && millis() - dernier >= 5000UL) {
    dernier = millis();
    if (mqtt.connect("nodemcu")) mqtt.subscribe("atelier/led", 1);
  }
  mqtt.loop();
}
`;
test('programme ESP8266 écrit à la main (ESP8266WebServer, PubSubClient) : accepté par l’interpréteur, zéro avertissement', { skip: skipEsp8266, timeout: 900000 }, () => {
  const c = interp(ESP8266_SKETCH, { board: 'nodemcu' }); assert.ok(c.ok, JSON.stringify(c.errors && c.errors.slice(0, 3)));
  cc(ESP8266_SKETCH, FQ.nodemcu, 'serveur web + MQTT ESP8266');
});

/* ---------- TP iot04 : le programme de ses règles ---------- */
test('TP iot04 : les règles de la solution génèrent un programme robuste, zéro avertissement sur l’Uno', { skip: skipW5500, timeout: 600000 }, () => {
  const tp = JSON.parse(fs.readFileSync(new URL('../lab/net/iot04-regles-mqtt-page.json', import.meta.url), 'utf8'));
  const L = loadProject(tp.solution.project), code = L.programs.get('uno_0');
  assert.ok(L.auto.has('uno_0'));
  assert.match(code, /#include <Ethernet\.h>/); assert.match(code, /mqttAbonner\(PSTR\("atelier\/lampe"\)\)/);
  assert.ok(!/\bString\b/.test(code));
  const c = interp(code, { board: 'uno' }); assert.ok(c.ok, JSON.stringify(c.errors && c.errors.slice(0, 3)));
  cc(code, FQ.uno, 'TP iot04');
});
