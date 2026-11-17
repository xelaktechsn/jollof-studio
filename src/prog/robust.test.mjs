// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// C++ « robuste » dans l'interpréteur : constexpr, entiers de taille fixe (débordements comme sur la carte), enum
// typés, tableaux de char (tampons de taille fixe), fonctions des chaînes du C, printf d'avr-libc, PROGMEM, valeurs
// rendues par print(), math.h, variables static, avr/sleep.h, EEPROM, réception série sans blocage.
// node --test src/prog/robust.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './lang.js';
import { createRuntime } from './runtime.js';
import { BOARDS } from '../sim/boards.js';

/** Carte sans montage (ou o.bus : modules I2C), programme lancé pendant ms millisecondes par pas de 1 ms. */
function run(src, { board = 'uno', ms = 20, mem, bus = [], send } = {}) {
  const c = compile(src, { board, boardLabel: board });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const store = mem || { ee: '', prefs: {} };
  const hw = {
    kind: board, label: board, prof: BOARDS[board], read: () => null, echo: () => null, at: () => [], onPin: () => null, data: () => null,
    bus: types => bus.filter(d => types.includes(d.comp.type)), i2c: () => bus, status: () => ({ ok: true, msg: '' }), mem: () => store, memChanged: () => {}
  };
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  let out = '';
  for (let t = 0; t < ms; t++) {
    if (send && send[t] != null) rt.send(send[t]);
    rt.run(t ? 1 : 0); out += rt.takeSerial();
    assert.notEqual(rt.state, 'error', rt.error && rt.error.msg);
  }
  return { rt, out, lines: out.split('\n').slice(0, -1), warns: [...rt.warnings.values()].map(w => w.msg), mem: store };
}
const setup = (body, head = '', board = 'uno') => run(`${head}\nvoid setup() {\n  Serial.begin(115200);\n${body}\n}\nvoid loop() {}`, { board });
const fails = (src, board = 'uno') => { const r = compile(src, { board }); assert.equal(r.ok, false, 'devrait échouer'); return r.errors[0]; };
const both = (body, head = '') => [setup(body, head, 'uno').lines, setup(body, head, 'esp32').lines];

test('constexpr : scalaires et tableaux globaux, static constexpr / static const dans une fonction, tableau constant en lecture seule', () => {
  const { lines } = setup(`  Serial.println(LED1); Serial.println(PERIODE * 3); Serial.println(SEGMENTS[6]); Serial.println(sizeof(SEGMENTS));
  Serial.println(f(2)); char t[TAILLE + 1]; Serial.println(sizeof(t));`, `constexpr uint8_t LED1 = 13;
constexpr uint32_t PERIODE = 1000UL;
constexpr uint8_t SEGMENTS[7] = {2, 3, 4, 5, 6, 7, 8};
constexpr size_t TAILLE = 16;
int f(int i) { static constexpr uint8_t T[3] = {10, 20, 30}; static const int16_t U[2] = {1, 2}; return T[i] + U[1]; }`);
  assert.deepEqual(lines, ['13', '3000', '8', '7', '32', '17']);
  const e = fails('constexpr uint8_t S[2] = {1, 2};\nvoid setup() { S[0] = 4; }\nvoid loop() {}');
  assert.equal(e.code, 'J1107'); assert.match(e.msg, /tableau constant/);
  assert.equal(fails('void setup() { static const int T[2] = {1, 2}; T[1]++; }\nvoid loop() {}').code, 'J1107');
  assert.equal(fails('constexpr uint8_t L = 3;\nvoid setup() { L = 4; }\nvoid loop() {}').code, 'J1107');
});

test('Entiers de taille fixe : millis() - debut modulo 2^32, promotions, int de 16 bits sur AVR, limites de stdint.h, transtypages', () => {
  const body = `  uint32_t debut = 0xFFFFFF00UL; uint32_t maintenant = 0x10;
  Serial.println(maintenant - debut); Serial.println((maintenant - debut) >= 500UL);
  uint8_t a = 200, b = 100; Serial.println(a + b); uint8_t c = a + b; Serial.println(c);
  int k = 30000; k = k + k; Serial.println(k); int16_t i16 = INT16_MAX; i16++; Serial.println(i16);
  uint16_t u16 = UINT16_MAX; u16 += 2; Serial.println(u16); int8_t i8 = INT8_MIN; i8--; Serial.println(i8);
  uint32_t big = UINT32_MAX; big++; Serial.println(big); int32_t i32 = INT32_MAX; i32 += 1; Serial.println(i32);
  uint32_t m = 4000000000UL; Serial.println(m * 2); Serial.println(1000 * 1000);
  long L = 70000; Serial.println((int32_t)L); Serial.println((uint8_t)L); Serial.println((int16_t)L); Serial.println((long)a * 1000);
  size_t s = 5; Serial.println(s - 6); unsigned int ui = 0; ui--; Serial.println(ui);
  int16_t neg = -1; uint16_t un = 1; Serial.println(neg < un); Serial.println(sizeof(int)); Serial.println(sizeof(size_t));
  Serial.println(0xFFFF + 1); Serial.println(1 << 15); Serial.println(-7 / 2); Serial.println(-7 % 3); Serial.println(~0u);
  Serial.println(INT32_MIN); Serial.println(UINT8_MAX); Serial.println(INT_MAX);`;
  const [uno, esp] = both(body);
  assert.deepEqual(uno, ['272', '0', '300', '44', '-5536', '-32768', '1', '127', '0', '-2147483648', '3705032704', '16960',
    '70000', '112', '4464', '200000', '65535', '65535', '0', '2', '2', '0', '-32768', '-3', '-1', '65535', '-2147483648', '255', '32767']);
  assert.deepEqual(esp, ['272', '0', '300', '44', '60000', '-32768', '1', '127', '0', '-2147483648', '3705032704', '1000000',
    '70000', '112', '4464', '200000', '4294967295', '4294967295', '1', '4', '4', '65536', '32768', '-3', '-1', '4294967295', '-2147483648', '255', '2147483647']);
  // Le temps qui repasse par 0 : un intervalle mesuré par soustraction reste juste.
  const w = setup(`  uint32_t t0 = 4294967000UL; uint32_t t1 = t0 + 800UL; Serial.println(t1); Serial.println(t1 - t0 >= 500UL ? "ok" : "non");`);
  assert.deepEqual(w.lines, ['504', 'ok']);
});

test('Littéraux : suffixes U, L, UL, hexadécimal non signé ; static_cast ; macros de la carte (__AVR__, ESP32)', () => {
  const body = `  unsigned long x = 4000000000UL; Serial.println(x); Serial.println(40000U); Serial.println(70000L); Serial.println(0x8000);
  Serial.println(static_cast<uint8_t>(300)); Serial.println(static_cast<int16_t>(40000L)); bool v = 3 > 2; Serial.println(v);
#if defined(__AVR__)
  Serial.println(F("AVR"));
#elif defined(ESP32)
  Serial.println("ESP32");
#endif
#ifdef ARDUINO_ARCH_AVR
  Serial.println(ARDUINO);
#endif`;
  const [uno, esp] = both(body);
  assert.deepEqual(uno, ['4000000000', '40000', '70000', '32768', '44', '-25536', '1', 'AVR', '10819']);
  assert.deepEqual(esp, ['4000000000', '40000', '70000', '32768', '44', '-25536', '1', 'ESP32']);
  assert.equal(setup('  Serial.println(ARDUINO_ARCH_RP2040);', '', 'pico').lines[0], '1');
});

test('enum typé : variable, énumérateurs, switch, paramètre, comparaison, sizeof', () => {
  const head = `enum EtapeFeu : uint8_t { FEU_ROUGE, FEU_VERT, FEU_ORANGE };
enum Mode { MODE_A = 5, MODE_B };
EtapeFeu feu = FEU_ROUGE;
Mode mode = MODE_B;
const char *nomFeu(EtapeFeu e) { switch (e) { case FEU_ROUGE: return "rouge"; case FEU_VERT: return "vert"; default: return "orange"; } }
void entrer(EtapeFeu e) { feu = e; }`;
  const [uno, esp] = both(`  entrer(FEU_VERT); Serial.println(nomFeu(feu)); Serial.println(feu == FEU_VERT); feu = FEU_ORANGE; Serial.println(feu);
  Serial.println(nomFeu(feu)); Serial.println(sizeof(feu)); Serial.println(mode); Serial.println(sizeof(mode));`, head);
  assert.deepEqual(uno, ['vert', '1', '2', 'orange', '1', '6', '2']);
  assert.deepEqual(esp, ['vert', '1', '2', 'orange', '1', '6', '4']);
  assert.match(fails('enum E : float { A };\nvoid setup() {}\nvoid loop() {}').msg, /entier/);
});

test('Tableaux de char : cases, \\0 qui coupe, octets suivants gardés, sizeof, char * à remplir, const char *, tableaux 2D', () => {
  const head = `char ligne[17] = "";
char tampon[8];
const char *nom = "BTN1";
const char *const NOMS[3] = {"a", "bb", "ccc"};
char memo[2][6];
bool egal(const char *a, const char *b) { return strcmp(a, b) == 0; }
void remplir(char *dst, size_t n, int v) { snprintf(dst, n, "v=%d", v); Serial.println(sizeof(dst)); }
const char *etat(bool on) { return on ? "ON" : "OFF"; }`;
  const { lines } = setup(`  for (uint8_t i = 0; i < 5; i++) ligne[i] = 'a' + i;
  ligne[5] = '\\0'; Serial.println(ligne); ligne[2] = '\\0'; Serial.println(ligne); Serial.println((char)ligne[3]);
  ligne[2] = 'X'; Serial.println(ligne); Serial.println(sizeof(ligne)); Serial.println(strlen(ligne)); Serial.println(sizeof(tampon));
  Serial.println(egal(nom, "BTN1")); Serial.println(etat(false)); Serial.println(NOMS[2]);
  remplir(tampon, sizeof(tampon), 42); Serial.println(tampon);
  strcpy(memo[0], "abc"); strcpy(memo[1], "de"); memo[1][0] = 'X'; Serial.println(memo[0]); Serial.println(memo[1]); Serial.println(sizeof(memo));
  char c3[4] = {'o', 'k'}; Serial.println(c3); char auto1[] = "hello"; Serial.println(sizeof(auto1));
  for (char c : c3) if (c) Serial.print(c); Serial.println();
  String s = ligne; s += "!"; Serial.println(s);
  char *p = strstr(ligne, "X"); if (p != nullptr) Serial.println(p); if (strchr(ligne, 'z') == NULL) Serial.println("absent");`, head);
  assert.deepEqual(lines, ['abcde', 'ab', 'd', 'abXde', '17', '5', '8', '1', 'OFF', 'ccc', '2', 'v=42', 'abc', 'Xe', '12', 'ok', '6', 'ok', 'abXde!', 'Xde', 'absent']);
  assert.match(fails('char t[4] = "trop";\nvoid setup() {}\nvoid loop() {}').msg, /trop long/);
  assert.match(fails('char t[8];\nvoid setup() { t = "abc"; }\nvoid loop() {}').msg, /strcpy/);
  assert.match(fails('void setup() { strcpy("abc", "d"); }\nvoid loop() {}').msg, /tableau de char/);
  assert.equal(fails('const char T[] = "abc";\nvoid setup() { strcpy(T, "d"); }\nvoid loop() {}').code, 'J1107');
});

test('Débordement d’un tableau de char : erreur claire à l’exécution (strcpy, sprintf, case hors du tableau)', () => {
  const go = body => {
    const c = compile(`char t[4];\nvoid setup() { ${body} }\nvoid loop() {}`, { board: 'uno' });
    const rt = createRuntime(c.js, { kind: 'uno', label: 'uno', prof: BOARDS.uno, read: () => null, at: () => [], onPin: () => null });
    rt.run(0); return rt;
  };
  assert.match(go('strcpy(t, "abcd");').error.msg, /5 octets.*4 octets.*strlcpy/);
  assert.match(go('sprintf(t, "%d", 12345);').error.msg, /snprintf/);
  assert.match(go('t[4] = 1;').error.msg, /Indice 4/);
  assert.equal(go('strlcpy(t, "abcdef", sizeof(t)); snprintf(t, sizeof(t), "%d", 12345);').state, 'run');
});

test('Chaînes du C : comparaisons, copies bornées, concaténation, recherche, conversions de nombres', () => {
  const [uno, esp] = both(`  char a[20] = "Hello"; char b[20];
  strcpy(b, a); strcat(b, " W"); Serial.println(b); Serial.println(strlen(b));
  Serial.println(strcmp(a, "Hello")); Serial.println(strcmp("abc", "abd")); Serial.println(strncmp(a, "Help", 3)); Serial.println(strcasecmp(a, "HELLO"));
  strncpy(b, "abcdefgh", 3); b[3] = 0; Serial.println(b);
  Serial.println(strlcpy(b, "123456789", 5)); Serial.println(b); strncat(b, "XYZ", 2); Serial.println(b);
  Serial.println(strlcat(b, "QQQQQQ", 8)); Serial.println(b);
  Serial.println(memcmp(a, "Hex", 2)); memset(b, 'z', 3); b[3] = 0; Serial.println(b); memcpy(b, a, 6); Serial.println(b);
  Serial.println(atoi("  42x")); Serial.println(atoi("70000")); Serial.println(atol("-70000")); Serial.println(atof("3.5e1"));
  Serial.println(strtol("ff", NULL, 16)); Serial.println(strtol("0x1F", NULL, 0)); Serial.println(strtol("99999999999", NULL, 10)); Serial.println(strtoul("-1", NULL, 10));
  itoa(-42, b, 10); Serial.println(b); itoa(-42, b, 16); Serial.println(b); ltoa(70000, b, 16); Serial.println(b); utoa(255, b, 2); Serial.println(b);
  Serial.println(toupper('a')); Serial.println(isdigit('7') != 0);`);
  const common = ['Hello W', '7', '0', '-1', '0', '0', 'abc', '9', '1234', '1234XY', '12', '1234XYQ', '0', 'zzz', 'Hello'];
  assert.deepEqual(uno, [...common, '42', '4464', '-70000', '35.00', '255', '31', '2147483647', '4294967295', '-42', 'ffd6', '11170', '11111111', '65', '1']);
  assert.deepEqual(esp, [...common, '42', '70000', '-70000', '35.00', '255', '31', '2147483647', '4294967295', '-42', '-2a', '11170', '11111111', '65', '1']);
});

test('snprintf / sprintf d’avr-libc : largeur, précision, drapeaux, troncature, %f « ? » sur AVR, %d d’un long', () => {
  const body = `  char b[24];
  int n = snprintf(b, sizeof(b), "%02d:%-4s|%5.1s|%3u|%x|%X|%o|%c|%%", 7, "ab", "xyz", 5, 255, 255, 8, 'Q'); Serial.println(b); Serial.println(n);
  n = snprintf(b, 8, "%s", "trop long pour huit"); Serial.println(b); Serial.println(n);
  snprintf(b, sizeof(b), "%+05d|%#x|%.3d|%ld|%lu", 42, 255, 7, -70000L, 4000000000UL); Serial.println(b);
  snprintf(b, sizeof(b), "T=%5.1f|", 21.25); Serial.println(b);
  snprintf(b, sizeof(b), "%d|%d", 70000L, 5); Serial.println(b);
  char t[10]; dtostrf(3.14159, 8, 2, t); Serial.print('['); Serial.print(t); Serial.println(']');
  dtostrf(-3.14159, -8, 1, t); Serial.print('['); Serial.print(t); Serial.println(']');`;
  const uno = setup(body), esp = setup(body, '', 'esp32');
  assert.deepEqual(uno.lines, ['07:ab  |    x|  5|ff|FF', '30', 'trop lo', '19', '+0042|0xff|007|-70000|4', 'T=    ?|', '4464|1', '[    3.14]', '[-3.1    ]']);
  assert.ok(uno.warns.some(w => /dtostrf/.test(w)), 'avertissement %f sur AVR');
  assert.ok(uno.warns.some(w => /%ld/.test(w)), 'avertissement %d d’un long sur AVR');
  assert.deepEqual(esp.lines, ['07:ab  |    x|  5|ff|FF', '30', 'trop lo', '19', '+0042|0xff|007|-70000|4', 'T= 21.2|', '70000|5', '[    3.14]', '[    -3.1]']);
});

test('PROGMEM : PSTR, F(), strcmp_P, strcpy_P, strlen_P, snprintf_P, pgm_read_byte / word / float, table de textes', () => {
  const head = `const uint8_t CHIFFRES[10] PROGMEM = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};
const uint16_t SEUILS[3] PROGMEM = {100, 2000, 40000};
const float GAINS[2] PROGMEM = {1.5, 2.25};
const char MSG[] PROGMEM = "progmem";
const char N0[] PROGMEM = "zero";
const char N1[] PROGMEM = "un";
const char *const NOMS[] PROGMEM = {N0, N1};`;
  const { lines } = setup(`  char b[20];
  Serial.println(pgm_read_byte(&CHIFFRES[2])); Serial.println(pgm_read_byte(CHIFFRES + 3)); Serial.println(pgm_read_word(&SEUILS[2])); Serial.println(pgm_read_float(&GAINS[1]));
  Serial.println(F("flash")); if (strcmp_P("abc", PSTR("abc")) == 0) Serial.println("egal");
  strcpy_P(b, MSG); Serial.println(b); Serial.println(strlen_P(MSG)); Serial.println((char)pgm_read_byte(&MSG[1]));
  snprintf_P(b, sizeof(b), PSTR("%d-%s"), 3, "z"); Serial.println(b);
  strcpy_P(b, (PGM_P)pgm_read_word(&NOMS[1])); Serial.println(b);
  strncpy_P(b, PSTR("abcdef"), 3); b[3] = 0; Serial.println(b);`, head);
  assert.deepEqual(lines, ['91', '79', '40000', '2.25', 'flash', 'egal', 'progmem', '7', 'r', '3-z', 'un', 'abc']);
});

test('print() rend le nombre de caractères : Serial, LCD I2C, SSD1306, avec F(), décimales, HEX, char', () => {
  const lcd = { type: 'lcd1602', id: 'lcd', name: 'LCD' };
  const r = run(`#include <LiquidCrystal_I2C.h>
#include <Adafruit_SSD1306.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
Adafruit_SSD1306 display(128, 64, &Wire, -1);
void setup() {
  Serial.begin(115200); lcd.init(); lcd.backlight();
  uint8_t n = lcd.print(F("Temp: ")); n += lcd.print(21.456, 1); n += lcd.write(223);
  while (n++ < 16) lcd.write(' ');
  Serial.println(n);
  Serial.println(Serial.print(F("abc"))); Serial.println(Serial.println(3.14159)); Serial.println(Serial.print(255, HEX));
  Serial.println(Serial.print(-12)); Serial.println(Serial.write('c')); Serial.println(Serial.print(1.0 / 3, 4)); Serial.println(Serial.print('x'));
  Serial.println(display.print(F("OLED"))); Serial.println(display.println(42));
}
void loop() {}`, { bus: [{ comp: lcd, addr: [0x27] }] });
  assert.deepEqual(r.lines, ['17', 'abc3', '3.14', '6', 'FF2', '-123', 'c1', '0.33336', 'x1', '4', '4']);
  assert.equal(lcd.progScreen.lines[0], 'Temp: 21.5ß      '.slice(0, 16).replace('ß', String.fromCharCode(223)));
});

test('math.h et macros Arduino : NAN, INFINITY, isnan, isinf, lround, roundf, fabsf, fmin, fmax, constrain, map, abs, min, max', () => {
  const [uno] = both(`  float n = NAN; Serial.println(isnan(n)); Serial.println(isinf(-INFINITY)); Serial.println(n); Serial.println(INFINITY);
  Serial.println(lround(2.5)); Serial.println(lroundf(-2.5)); Serial.println(roundf(2.4)); Serial.println(fabsf(-1.5)); Serial.println(fmin(1, NAN)); Serial.println(fmax(1.5, 2));
  Serial.println(constrain(300, 0, 255)); Serial.println(map(512, 0, 1023, 0, 255)); Serial.println(map(-1, 0, 10, 0, 100)); Serial.println(map(2.9, 0, 10, 0, 100));
  Serial.println(map(100000, 0, 100000, 0, 100000)); Serial.println(abs(-5)); Serial.println(min(3, 4)); Serial.println(max(3, 4)); Serial.println(floor(-1.5)); Serial.println(M_PI, 4);`);
  assert.deepEqual(uno, ['1', '1', 'nan', 'inf', '3', '-3', '2.00', '1.50', '1.00', '2.00', '255', '127', '-10', '20', '14100', '5', '3', '4', '-2.00', '3.1416']);
});

test('Variables static dans une fonction et dans loop() ; temps virtuel d’une boucle sans delay()', () => {
  const r = run(`int compte() { static int n = 0; n++; return n; }
uint32_t passes = 0;
void setup() { Serial.begin(115200); }
void loop() {
  static uint32_t t = 0; static bool avant = false;
  passes++;
  if (millis() - t >= 10) { t += 10; avant = !avant; Serial.print(millis()); Serial.print(' '); Serial.print(avant); Serial.print(' '); Serial.println(compte()); }
}`, { ms: 35 });
  assert.deepEqual(r.lines, ['10 1 1', '20 0 2', '30 1 3'], 'millis() avance d’une milliseconde à la fois dans une boucle active');
});

test('avr/sleep.h : sleep_mode() en IDLE réveille chaque milliseconde ; AVR seulement ; #include obligatoire', () => {
  const r = run(`#include <avr/sleep.h>
uint32_t passes = 0, t0 = 0;
void setup() { Serial.begin(115200); set_sleep_mode(SLEEP_MODE_IDLE); }
void loop() { passes++; if (millis() - t0 >= 100) { t0 += 100; Serial.println(passes); passes = 0; } sleep_mode(); }`, { ms: 305 });
  assert.equal(r.lines.length, 3);
  for (const l of r.lines.slice(1)) assert.ok(+l >= 99 && +l <= 101, `≈ 100 tours de loop() par 100 ms : ${l}`);
  assert.equal(fails('#include <avr/sleep.h>\nvoid setup() {}\nvoid loop() { sleep_mode(); }', 'esp32').code, 'J1111');
  assert.match(fails('void setup() { set_sleep_mode(SLEEP_MODE_IDLE); }\nvoid loop() {}').msg, /#include <avr\/sleep\.h>/);
  // Veille profonde : seule une interruption réveille la carte.
  const d = run(`#include <avr/sleep.h>
void setup() { Serial.begin(115200); set_sleep_mode(SLEEP_MODE_PWR_DOWN); sleep_enable(); }
void loop() { Serial.println(millis()); sleep_cpu(); }`, { ms: 50 });
  assert.equal(d.lines.length, 1);
  assert.ok(d.warns.some(w => /veille profonde/.test(w)));
});

test('EEPROM : get / put de bool, entiers, float, tableau de char ; mémoire neuve à 0xFF ; ESP32 : begin() et commit()', () => {
  const body = `  float f; EEPROM.get(0, f); Serial.println(isnan(f)); int32_t i; EEPROM.get(4, i); Serial.println(i);
  uint16_t c = 0; EEPROM.get(10, c); Serial.println(c); c = 1234; EEPROM.put(10, c); uint16_t d = 0; EEPROM.get(10, d); Serial.println(d);
  char nom[8] = "abc"; EEPROM.put(20, nom); char z[8]; EEPROM.get(20, z); Serial.println(z);
  bool b = true; EEPROM.put(30, b); bool b2 = false; EEPROM.get(30, b2); Serial.println(b2);
  float g = 2.5; EEPROM.put(31, g); float h; EEPROM.get(31, h); Serial.println(h);
  int8_t m = -3; EEPROM.put(40, m); int8_t m2; EEPROM.get(40, m2); Serial.println(m2);
  EEPROM.update(50, 7); Serial.println(EEPROM.read(50)); Serial.println(EEPROM.length());`;
  const uno = setup(body, '#include <EEPROM.h>');
  assert.deepEqual(uno.lines, ['1', '-1', '65535', '1234', 'abc', '1', '2.50', '-3', '7', '1024']);
  assert.equal(setup('  Serial.println(EEPROM.length());', '#include <EEPROM.h>', 'mega').lines[0], '4096');
  const esp = setup('  EEPROM.begin(64);\n' + body + '\n  Serial.println(EEPROM.commit());', '#include <EEPROM.h>', 'esp32');
  assert.deepEqual(esp.lines, ['1', '-1', '65535', '1234', 'abc', '1', '2.50', '-3', '7', '64', '1']);
  const nob = setup('  Serial.println(EEPROM.read(0));', '#include <EEPROM.h>', 'esp32');
  assert.ok(nob.warns.some(w => /EEPROM\.begin/.test(w)));
});

test('Réception série sans blocage : while (Serial.available() > 0) { const char c = (char)Serial.read(); … }, read() vaut -1 à vide', () => {
  const r = run(`char ligne[9]; uint8_t n = 0;
void setup() { Serial.begin(115200); Serial.println(Serial.read()); }
void loop() {
  while (Serial.available() > 0) {
    const char c = (char)Serial.read();
    if (c == '\\n') { ligne[n] = '\\0'; Serial.print(F("> ")); Serial.println(ligne); n = 0; }
    else if (n < sizeof(ligne) - 1) ligne[n++] = c;
  }
}`, { ms: 30, send: { 5: 'AB', 8: 'C\n', 12: 'trop long pour neuf\n' } });
  assert.deepEqual(r.lines, ['-1', '> ABC', '> trop lon']);
});
