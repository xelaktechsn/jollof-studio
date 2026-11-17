// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Parité interpréteur ↔ vraie carte : des programmes écrits comme ceux du générateur de règles (types de taille fixe,
// constexpr, enum typé, tableaux de char, F() / PSTR, millis() sans blocage, écriture sur changement) tournent dans
// l'interpréteur et, compilés par arduino-cli, sur l'ATmega328P émulé (avr8js) ; broches et moniteur série doivent
// concorder. Le moteur de comparaison est dans paritykit.mjs :
//
//   import { parity } from './parity.test.mjs';   // ou './paritykit.mjs' (sans enregistrer ces tests)
//   const r = parity(src, { inputs: [{ at: 100, pin: 'D2', d: 0 }], serialIn: [{ at: 50, text: 'ON\n' }],
//                           probes: [80, 200], pins: ['D13'] });
//   assert.deepEqual(r.diff, []);                 // r.interp, r.avr : relevés de chaque côté
//
// Ignorés sans arduino-cli. node --test src/prog/parity.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parity, hasCli } from './paritykit.mjs';

export { parity };
const skip = !hasCli && 'arduino-cli absent';
const ok = (r, what) => assert.deepEqual(r.diff, [], `${what} :\n${r.diff.join('\n')}`);

test('Parité (a) : bouton anti-rebond par millis(), front descendant qui bascule la LED', { skip }, () => {
  const src = `constexpr uint8_t BOUTON = 2;
constexpr uint8_t LED = 13;
constexpr uint32_t ANTIREBOND_MS = 30UL;
bool etatStable = HIGH;
bool dernierBrut = HIGH;
uint32_t changeA = 0;
bool led = false;
void setup() {
  pinMode(BOUTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
  digitalWrite(LED, LOW);
}
void loop() {
  const uint32_t maintenant = millis();
  const bool brut = digitalRead(BOUTON);
  if (brut != dernierBrut) { dernierBrut = brut; changeA = maintenant; }
  if ((maintenant - changeA) >= ANTIREBOND_MS && brut != etatStable) {
    etatStable = brut;
    if (etatStable == LOW) { led = !led; digitalWrite(LED, led ? HIGH : LOW); }
  }
}`;
  const press = (at, bounce) => (bounce ? [0, 3, 6].map((d, i) => ({ at: at + d, pin: 'D2', d: i % 2 })) : [{ at, pin: 'D2', d: 0 }]);
  const r = parity(src, {
    inputs: [...press(100, true), { at: 300, pin: 'D2', release: true }, ...press(500, false), { at: 700, pin: 'D2', release: true },
      { at: 900, pin: 'D2', d: 0 }, { at: 910, pin: 'D2', release: true }], // impulsion de 10 ms : filtrée
    probes: [90, 200, 400, 600, 800, 1000], pins: ['D13', 'D2']
  });
  ok(r, 'anti-rebond');
  assert.deepEqual(r.interp.samples.map(s => s.pins.D13.d), [0, 1, 1, 0, 0, 0]);
});

test('Parité (b) : machine à états enum typé, LED 500 ms / 300 ms, angle du servo par étape', { skip }, () => {
  const src = `#include <Servo.h>
enum Etape : uint8_t { ETAPE_ALLUME, ETAPE_ETEINT };
constexpr uint8_t LED = 13;
constexpr uint8_t BROCHE_SERVO = 9;
constexpr uint32_t DUREE_ALLUME = 500UL;
constexpr uint32_t DUREE_ETEINT = 300UL;
Servo servo;
Etape etape = ETAPE_ALLUME;
uint32_t debut = 0;
void entrer(Etape e) {
  etape = e;
  debut = millis();
  switch (e) {
    case ETAPE_ALLUME: digitalWrite(LED, HIGH); servo.write(90); break;
    case ETAPE_ETEINT: digitalWrite(LED, LOW); servo.write(20); break;
  }
}
void setup() {
  pinMode(LED, OUTPUT);
  servo.attach(BROCHE_SERVO);
  entrer(ETAPE_ALLUME);
}
void loop() {
  const uint32_t maintenant = millis();
  switch (etape) {
    case ETAPE_ALLUME: if (maintenant - debut >= DUREE_ALLUME) entrer(ETAPE_ETEINT); break;
    case ETAPE_ETEINT: if (maintenant - debut >= DUREE_ETEINT) entrer(ETAPE_ALLUME); break;
  }
}`;
  const r = parity(src, { probes: [250, 700, 1050, 1500, 1750], pins: ['D13', 'D9'] });
  ok(r, 'machine à états');
  assert.deepEqual(r.interp.samples.map(s => [s.pins.D13.d, Math.round(s.pins.D9.servo)]), [[1, 90], [0, 20], [1, 90], [0, 20], [1, 90]]);
});

test('Parité (c) : ligne reçue dans un tableau de char, commande strcmp_P(PSTR), réponse Serial.println(F())', { skip }, () => {
  const src = `constexpr uint8_t LED = 13;
constexpr size_t TAILLE = 16;
char ligne[TAILLE + 1] = "";
uint8_t n = 0;
void traiter(const char *cmd) {
  if (strcmp_P(cmd, PSTR("ON")) == 0) { digitalWrite(LED, HIGH); Serial.println(F("LED allumee")); }
  else if (strcmp_P(cmd, PSTR("OFF")) == 0) { digitalWrite(LED, LOW); Serial.println(F("LED eteinte")); }
  else { Serial.print(F("Inconnu: ")); Serial.print(cmd); Serial.print(F(" (")); Serial.print(strlen(cmd)); Serial.println(F(")")); }
}
void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
}
void loop() {
  while (Serial.available() > 0) {
    const char c = (char)Serial.read();
    if (c == '\\r') continue;
    if (c == '\\n') { ligne[n] = '\\0'; traiter(ligne); n = 0; }
    else if (n < TAILLE) { ligne[n++] = c; }
  }
}`;
  const r = parity(src, {
    serialIn: [{ at: 100, text: 'ON\n' }, { at: 300, text: 'BLA\n' }, { at: 500, text: 'OFF\r\n' }, { at: 700, text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\n' }],
    probes: [200, 400, 600, 800], pins: ['D13']
  });
  ok(r, 'commandes série');
  assert.equal(r.interp.serial, 'LED allumee\nInconnu: BLA (3)\nLED eteinte\nInconnu: ABCDEFGHIJKLMNOP (16)\n');
});

test('Parité (d) : snprintf_P, dtostrf, troncature de snprintf, %f sur AVR', { skip }, () => {
  const src = `void setup() {
  Serial.begin(115200);
  char buf[40];
  char num[10];
  for (int16_t i = -2; i <= 2; i++) {
    const float t = 21.5f + i * 0.37f;
    dtostrf(t, 6, 2, num);
    snprintf_P(buf, sizeof(buf), PSTR("T%d=%s C|%03u|%lu|%-3s|"), i, num, (unsigned)(i + 5), 100000UL * (uint32_t)(i + 3), "ab");
    Serial.println(buf);
  }
  const int n = snprintf(buf, 8, "%s", "trop long pour huit");
  Serial.println(n);
  Serial.println(buf);
  snprintf(buf, sizeof(buf), "%5.1f|%x|%X|%+d|%ld", 1.5, 255, 0xBEEF, 7, -70000L);
  Serial.println(buf);
  uint8_t c = Serial.print(F("Temp: "));
  c += Serial.print(21.456, 1);
  while (c++ < 16) Serial.write('.');
  Serial.println();
}
void loop() {}`;
  const r = parity(src, { probes: [100], until: 200 });
  ok(r, 'formatage');
  assert.match(r.interp.serial, /^T-2= 20\.76 C\|003\|100000\|ab \|\n/);
  assert.match(r.interp.serial, /\n19\ntrop lo\n    \?\|ff\|BEEF\|\+7\|-70000\nTemp: 21\.5\.\.\.\.\.\.\n$/);
});

test('Parité (e) : compteur de démarrages en EEPROM (get / put), EEPROM neuve à 0xFF', { skip }, () => {
  const src = `#include <EEPROM.h>
constexpr int ADR_COMPTEUR = 0;
constexpr int ADR_MAGIC = 4;
constexpr uint32_t MAGIC = 0xC0FFEEUL;
void setup() {
  Serial.begin(115200);
  uint32_t magic = 0;
  EEPROM.get(ADR_MAGIC, magic);
  uint16_t compteur = 0;
  if (magic != MAGIC) { magic = MAGIC; EEPROM.put(ADR_MAGIC, magic); }
  else EEPROM.get(ADR_COMPTEUR, compteur);
  compteur++;
  EEPROM.put(ADR_COMPTEUR, compteur);
  float f;
  EEPROM.get(8, f);
  Serial.print(F("f="));
  Serial.println(isnan(f) ? -1.0f : f);
  EEPROM.put(8, 1.25f * compteur);
  char nom[6];
  EEPROM.get(12, nom);
  nom[5] = '\\0';
  Serial.println(nom[0] == (char)0xFF ? "vide" : nom);
  strcpy(nom, "abc");
  EEPROM.put(12, nom);
  Serial.print(F("Demarrage n"));
  Serial.println(compteur);
}
void loop() {}`;
  const r1 = parity(src, { probes: [100], until: 150, mem: { ee: '' } });
  ok(r1, 'premier démarrage');
  assert.equal(r1.interp.serial, 'f=-1.00\nvide\nDemarrage n1\n');
  const r2 = parity(src, { probes: [100], until: 150, mem: { ee: r1.avr.mem } });
  ok(r2, 'second démarrage');
  assert.equal(r2.interp.serial, 'f=1.25\nabc\nDemarrage n2\n');
});

test('Parité (f) : loop() qui s’endort (set_sleep_mode(SLEEP_MODE_IDLE) ; sleep_mode()), clignotement de 250 ms', { skip }, () => {
  const src = `#include <avr/sleep.h>
constexpr uint8_t LED = 13;
constexpr uint32_t PERIODE = 250UL;
uint32_t dernier = 0;
bool etat = false;
void setup() {
  pinMode(LED, OUTPUT);
  set_sleep_mode(SLEEP_MODE_IDLE);
}
void loop() {
  const uint32_t maintenant = millis();
  if (maintenant - dernier >= PERIODE) {
    dernier += PERIODE;
    etat = !etat;
    digitalWrite(LED, etat ? HIGH : LOW);
  }
  sleep_mode();
}`;
  const probes = Array.from({ length: 8 }, (_, i) => 125 + 250 * i);
  const r = parity(src, { probes, pins: ['D13'] });
  ok(r, 'veille');
  assert.deepEqual(r.interp.samples.map(s => s.pins.D13.d), [0, 1, 0, 1, 0, 1, 0, 1]);
});

test('Parité (g) : analogRead → map → analogWrite, écriture sur changement seulement', { skip }, () => {
  const src = `constexpr uint8_t POT = A0;
constexpr uint8_t MOTEUR = 9;
int16_t dernier = -1;
void setup() { Serial.begin(115200); pinMode(MOTEUR, OUTPUT); }
void loop() {
  const int16_t brut = analogRead(POT);
  const uint8_t pwm = (uint8_t)map(brut, 0, 1023, 0, 255);
  if (pwm != dernier) { dernier = pwm; analogWrite(MOTEUR, pwm); Serial.println(pwm); }
}`;
  const r = parity(src, { inputs: [{ at: 0, pin: 'A0', v: 1.25 }, { at: 200, pin: 'A0', v: 3.75 }, { at: 400, pin: 'A0', v: 5 }], probes: [150, 350, 550], pins: ['D9'] });
  ok(r, 'potentiomètre');
  assert.equal(r.interp.serial, '63\n191\n255\n');
});
