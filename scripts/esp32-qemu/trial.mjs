// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Essai 4.4 : compile de petits croquis ESP32 avec arduino-cli, les fait tourner dans QEMU (programme à part) et
// mesure démarrage, vitesse, processeur, sorties GPIO/PWM, entrées par la cale, I2C et Wi-Fi.
// Usage : node scripts/esp32-qemu/trial.mjs <blink|i2c|input|hang|wifi|all> [--seconds N] [--no-trace] [--icount shift=2]
// Variables : JOLLOF_QEMU (chemin de qemu-system-xtensa, obligatoire), JOLLOF_QEMU_LIBS (dossier des
// bibliothèques dynamiques de QEMU sur macOS), JOLLOF_ESP32_WORK (dossier de travail, sinon dossier temporaire).
// Rien n'est branché sur l'interface de l'application : c'est un banc d'essai.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { startEsp32, findTmp105 } from './qemu-esp32.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FQBN = 'esp32:esp32:esp32:FlashMode=dio'; // QIO (défaut du cœur) : la flash de QEMU refuse le bit QE, l'appli s'arrête
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SECONDS = +opt('--seconds', 8), TRACE = !argv.includes('--no-trace'), ICOUNT = opt('--icount', null);
const QEMU = process.env.JOLLOF_QEMU;
const WORK = process.env.JOLLOF_ESP32_WORK || path.join(os.tmpdir(), 'jollof-esp32-qemu');
const ENV = process.env.JOLLOF_QEMU_LIBS ? { DYLD_FALLBACK_LIBRARY_PATH: `${process.env.JOLLOF_QEMU_LIBS}:/usr/lib`, LD_LIBRARY_PATH: process.env.JOLLOF_QEMU_LIBS } : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stats = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), mean = a.reduce((x, y) => x + y, 0) / a.length;
  return { n: a.length, min: +s[0].toFixed(2), median: +s[s.length >> 1].toFixed(2), max: +s[s.length - 1].toFixed(2), mean: +mean.toFixed(2) };
};

// Croquis d'essai (le nom du dossier doit être celui du .ino).
const SKETCHES = {
  blink: `// Clignotement, port série, et boucle de calcul chronométrée (vitesse de l'émulation)
volatile uint32_t x = 1;
void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  Serial.printf("SETUP millis=%lu\\n", millis());
  uint32_t t = micros();
  for (uint32_t i = 0; i < 2000000; i++) x = x * 1103515245u + 12345u;
  Serial.printf("BENCH us=%lu x=%lu\\n", micros() - t, x);
}
unsigned long n = 0;
void loop() {
  digitalWrite(2, HIGH);
  delay(250);
  digitalWrite(2, LOW);
  delay(250);
  Serial.printf("BLINK %lu millis=%lu\\n", ++n, millis());
  while (Serial.available()) Serial.printf("ECHO %c\\n", Serial.read());
}
`,
  i2c: `// I2C : scanner, puis lecture du TMP105 (0x48)
#include <Wire.h>
void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) Serial.printf("FOUND 0x%02x\\n", a);
  }
  Serial.println("SETUP");
}
void loop() {
  Wire.beginTransmission(0x48);
  Wire.write(0x00);
  Wire.endTransmission(false);
  if (Wire.requestFrom(0x48, 2) == 2) {
    int16_t raw = (Wire.read() << 8) | Wire.read();
    Serial.printf("TEMP %.4f millis=%lu\\n", (raw >> 4) * 0.0625, millis());
  } else Serial.println("TEMP fail");
  delay(100);
}
`,
  // Reproduction d'un blocage observé : le même croquis I2C, plus Serial.available() dans loop(), finit en
  // remise à zéro par le chien de garde (TG1WDT puis TG0WDT), les deux cœurs arrêtés sur waiti.
  hang: null,
  input: `// Entrée → sortie : D4 (GPIO 4) recopiée sur la LED D2 (GPIO 2), interruptions comptées,
// analogWrite sur D25 (PWM par le LEDC), ADC lu sur D34. Les entrées passent par la cale jollof_qemu_shim.cpp.
volatile uint32_t edges = 0;
void IRAM_ATTR onEdge() { edges++; }
void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  pinMode(4, INPUT_PULLUP);
  attachInterrupt(4, onEdge, CHANGE);
  analogWrite(25, 64);
  Serial.println("SETUP");
}
int last = -1;
void loop() {
  int v = digitalRead(4);
  if (v != last) {
    last = v;
    digitalWrite(2, v);
    Serial.printf("IN %d edges=%lu adc=%u\\n", v, edges, analogRead(34));
  }
  delay(1);
}
`,
  wifi: `// Wi-Fi : la pile Wi-Fi d'Arduino sous QEMU (aucune radio émulée)
#include <WiFi.h>
void setup() {
  Serial.begin(115200);
  Serial.println("SETUP");
  WiFi.mode(WIFI_STA);
  WiFi.begin("Jollof-Lab", "");
  Serial.println("BEGIN");
}
void loop() {
  Serial.printf("STATUS %d\\n", WiFi.status());
  delay(1000);
}
`
};
SKETCHES.hang = SKETCHES.i2c.replace('  delay(100);\n}', '  while (Serial.available()) Serial.printf("ECHO %c\\n", Serial.read());\n  delay(100);\n}');

/** Compile un croquis (une seule fois tant que la source ne change pas) ; rend l'image fusionnée de 4 Mo. */
function build(name) {
  const dir = path.join(WORK, 'sketches', name), out = path.join(WORK, 'build', name);
  fs.mkdirSync(dir, { recursive: true });
  const ino = path.join(dir, `${name}.ino`), src = SKETCHES[name];
  // La cale accompagne tout croquis du mode fidèle ; « hang » et « blink » s'en passent (reproduction du blocage,
  // et sorties vues par la trace seule).
  const shim = ['input', 'i2c', 'wifi'].includes(name) ? fs.readFileSync(path.join(HERE, 'jollof_qemu_shim.cpp'), 'utf8') : null;
  const merged = path.join(out, `${name}.ino.merged.bin`);
  const same = fs.existsSync(merged) && fs.existsSync(ino) && fs.readFileSync(ino, 'utf8') === src
    && (!shim || (fs.existsSync(path.join(dir, 'jollof_qemu_shim.cpp')) && fs.readFileSync(path.join(dir, 'jollof_qemu_shim.cpp'), 'utf8') === shim));
  if (same) return { merged, compileS: 0, cached: true };
  fs.writeFileSync(ino, src);
  if (shim) fs.writeFileSync(path.join(dir, 'jollof_qemu_shim.cpp'), shim);
  const t = performance.now();
  execFileSync('arduino-cli', ['compile', '--fqbn', FQBN, '--output-dir', out, dir], { stdio: 'pipe' });
  return { merged, compileS: +((performance.now() - t) / 1000).toFixed(1), cached: false, appBytes: fs.statSync(path.join(out, `${name}.ino.bin`)).size };
}

async function boot(name, extra = {}) {
  const b = build(name);
  const esp = await startEsp32({ qemu: QEMU, flash: b.merged, workDir: path.join(WORK, 'run', name), trace: TRACE, icount: ICOUNT, env: ENV, ...extra });
  return { b, esp };
}
const waitLine = (esp, re, ms = 15000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error(`délai dépassé : ${re}`)); }, ms);
  const off = esp.on('line', l => { const m = re.exec(l.text); if (m) { clearTimeout(timer); off(); resolve({ ...l, m }); } });
});

async function blink() {
  const { b, esp } = await boot('blink');
  const edges = [], blinks = [];
  esp.on('pin', e => { if (e.pin === 2) edges.push(e); });
  esp.on('line', l => { const m = /^BLINK (\d+) millis=(\d+)/.exec(l.text); if (m) blinks.push({ t: l.t, ms: +m[2] }); });
  const setup = await waitLine(esp, /^SETUP millis=(\d+)/);
  const bench = await waitLine(esp, /^BENCH us=(\d+)/);
  const cpu0 = esp.cpu(), w0 = performance.now();
  await sleep(SECONDS * 1000);
  // Port série dans l'autre sens : un octet envoyé à la carte revient en écho (au plus une période de loop()).
  const tx = performance.now() - esp.t0;
  esp.send('x');
  const echo = await waitLine(esp, /^ECHO x/, 3000).then(l => +(l.t - tx).toFixed(1), () => null);
  const cpuSteady = (esp.cpu() - cpu0) / ((performance.now() - w0) / 1000);
  const lines = esp.traceLines;
  esp.stop();
  // Le premier événement est pinMode (sortie à LOW) : les demi-périodes se comptent à partir du premier HIGH.
  const toggles = edges.slice(1), halves = toggles.slice(1).map((e, i) => e.t - toggles[i].t);
  const f = blinks[0], l = blinks[blinks.length - 1];
  return {
    compileS: b.compileS, appBytes: b.appBytes, firstUartByteMs: +esp.firstByte.toFixed(0), setupWallMs: +setup.t.toFixed(0), setupGuestMillis: +setup.m[1],
    benchUs: +bench.m[1], realTimeFactor: f && l && l !== f ? +((l.ms - f.ms) / (l.t - f.t)).toFixed(3) : null,
    cpuCoresSteady: +cpuSteady.toFixed(3), traceLinesPerS: TRACE ? Math.round(lines / ((performance.now() - esp.t0) / 1000)) : 0,
    gpio2Edges: edges.length, gpio2HalfPeriodMs: stats(halves), serialEchoMs: echo
  };
}

async function i2c() {
  const { b, esp } = await boot('i2c');
  const found = [];
  esp.on('line', l => { const m = /^FOUND (0x\w+)/.exec(l.text); if (m) found.push(m[1]); });
  await waitLine(esp, /^SETUP/);
  const before = await waitLine(esp, /^TEMP ([\d.-]+)/);
  const tmp = await findTmp105(esp.qmp);
  // Aller-retour QMP (ce que coûterait chaque réglage d'un capteur depuis l'application).
  const rtt = [];
  for (let i = 0; i < 20; i++) { const t = performance.now(); await esp.qmp.execute('query-status'); rtt.push(performance.now() - t); }
  const tSet = performance.now() - esp.t0;
  await esp.qmp.execute('qom-set', { path: tmp, property: 'temperature', value: 31500 });
  const after = await waitLine(esp, /^TEMP 31\.5/);
  // Pause et reprise de la carte (bouton pause de l'application).
  await esp.qmp.execute('stop');
  const paused = (await esp.qmp.execute('query-status')).status;
  await esp.qmp.execute('cont');
  esp.stop();
  return { compileS: b.compileS, appBytes: b.appBytes, found, tmp105Path: tmp, tempBefore: +before.m[1], tempAfterQomSet: 31.5,
    qomSetToFirmwareMs: +(after.t - tSet).toFixed(1), qmpRoundTripMs: stats(rtt), pauseStatus: paused };
}

async function input() {
  const { b, esp } = await boot('input', { side: true });
  const sideW = [], traceP = [], pwm = [], modes = [];
  esp.on('side', f => { if (f.type === 'W' && f.pin === 2) sideW.push(f); if (f.type === 'M') modes.push(`${f.pin}:${f.value}`); });
  esp.on('pin', e => { if (e.pin === 2) traceP.push(e); });
  esp.on('pwm', e => pwm.push(e));
  const lines = [];
  esp.on('line', l => { if (/^IN /.test(l.text)) lines.push(l.text); });
  await waitLine(esp, /^SETUP/);
  await sleep(300);
  const latSide = [], latTrace = [];
  let level = 1n; // INPUT_PULLUP : niveau haut au repos
  for (let k = 0; k < 20; k++) {
    level ^= 1n;
    esp.side.setAdc(34, 1000 + k);
    const nS = sideW.length, nT = traceP.length, t = performance.now() - esp.t0;
    esp.side.setInputs(level << 4n);
    for (let i = 0; i < 100 && (sideW.length === nS || (TRACE && traceP.length === nT)); i++) await sleep(2);
    if (sideW.length > nS) latSide.push(sideW[sideW.length - 1].t - t);
    if (traceP.length > nT) latTrace.push(traceP[traceP.length - 1].t - t);
    await sleep(150);
  }
  await sleep(100);
  esp.stop();
  const lastPwm = pwm.filter(p => p.pin === 25).pop() || null;
  return { compileS: b.compileS, appBytes: b.appBytes, pinModes: modes, inputToOutputViaShimMs: stats(latSide), inputToOutputViaTraceMs: stats(latTrace),
    firmwareLines: lines.slice(0, 3).concat(lines.length > 3 ? ['…', lines[lines.length - 1]] : []), pwmPin25: lastPwm && { duty: +lastPwm.duty.toFixed(4), freqHz: +lastPwm.freq.toFixed(1), ledcChannel: lastPwm.channel } };
}

async function hang() {
  const { b, esp } = await boot('hang', { trace: false });
  let temps = 0, resets = 0;
  esp.on('line', l => { if (/^TEMP /.test(l.text)) temps++; if (/WDT_SYS_RESET/.test(l.text)) resets++; });
  await sleep(SECONDS * 1000);
  esp.stop();
  return { compileS: b.compileS, temps, watchdogResets: resets };
}

async function wifi() {
  const { b, esp } = await boot('wifi', { trace: false });
  const seen = [];
  esp.on('line', l => { if (/SETUP|BEGIN|STATUS|Guru Meditation|EXCVADDR|Rebooting/.test(l.text)) seen.push(l.text.trim()); });
  await sleep(SECONDS * 1000);
  esp.stop();
  return { compileS: b.compileS, appBytes: b.appBytes, firmwareSays: [...new Set(seen)].slice(0, 8) };
}

if (!QEMU || !fs.existsSync(QEMU)) {
  console.error('JOLLOF_QEMU doit indiquer qemu-system-xtensa (fork d’Espressif). Voir docs/ESP32-QEMU-TRIAL.md.');
  process.exit(2);
}
const which = argv[0] || 'all';
const runs = { blink, i2c, input, hang, wifi };
const result = { qemu: execFileSync(QEMU, ['--version'], { env: { ...process.env, ...ENV }, encoding: 'utf8' }).split('\n')[0], trace: TRACE, icount: ICOUNT };
for (const name of which === 'all' ? Object.keys(runs) : [which]) {
  try { result[name] = await runs[name](); } catch (e) { result[name] = { error: String(e.message || e) }; }
}
console.log(JSON.stringify(result, null, 2));
process.exit(0);
