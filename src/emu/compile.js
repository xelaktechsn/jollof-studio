// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Compilation du vrai programme pour le mode « fidèle » : arduino-cli (lancé par l'application de bureau) produit
// le programme machine, que l'émulateur fait tourner. Les fichiers de la carte et les bibliothèques se téléchargent
// à la première utilisation, puis restent en cache.
import { tl } from '../i18n/index.js';
import * as native from '../native.js';

import { FQBN, EMULATED } from './boards.js';
import { esp32Refusal } from './esp32-limits.js';
export { FQBN, EMULATED };
const CORE_URLS = {
  'rp2040:rp2040': 'https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json',
  'esp32:esp32': 'https://espressif.github.io/arduino-esp32/package_esp32_index.json',
  'esp8266:esp8266': 'https://arduino.esp8266.com/stable/package_esp8266com_index.json'
};
/** Bibliothèques Arduino à installer selon les #include du programme. */
export const LIBS = {
  'DHT.h': ['DHT sensor library', 'Adafruit Unified Sensor'], 'OneWire.h': ['OneWire'], 'DallasTemperature.h': ['DallasTemperature'],
  'Adafruit_BMP280.h': ['Adafruit BMP280 Library'], 'Adafruit_BME280.h': ['Adafruit BME280 Library'], 'BH1750.h': ['BH1750'], 'HX711.h': ['HX711 Arduino Library'], 'Adafruit_MPU6050.h': ['Adafruit MPU6050'], 'LiquidCrystal_I2C.h': ['LiquidCrystal I2C'],
  'Adafruit_SSD1306.h': ['Adafruit SSD1306', 'Adafruit GFX Library'], 'Adafruit_GFX.h': ['Adafruit GFX Library'], 'Servo.h': ['Servo'],
  'Adafruit_NeoPixel.h': ['Adafruit NeoPixel'], 'Stepper.h': ['Stepper'], 'Keypad.h': ['Keypad'], 'IRremote.h': ['IRremote'],
  'IRremote.hpp': ['IRremote'], 'MFRC522.h': ['MFRC522'], 'RF24.h': ['RF24'], 'ESP32Servo.h': ['ESP32Servo']
};

/** Accès à arduino-cli : par défaut l'application de bureau ; les tests passent le leur. */
export const nativeCli = {
  available: () => native.isTauri(),
  run: args => native.arduinoCli(args),
  write: (code, opts) => native.writeSketch(code, opts),
  paths: () => native.buildPaths(),
  read: ext => native.readBuild(ext)
};

const coreOf = fqbn => fqbn.split(':').slice(0, 2).join(':');
const urlArgs = core => (CORE_URLS[core] ? ['--additional-urls', CORE_URLS[core]] : []);
const ok = r => r && r.code === 0;

/** Fichiers de la carte et bibliothèques du programme : installés au premier besoin. */
export async function ensureToolchain(kind, code, log = () => {}, cli = nativeCli) {
  const fqbn = FQBN[kind], core = coreOf(fqbn);
  const list = await cli.run(['core', 'list', '--format', 'json']);
  let installed = [];
  try { const j = JSON.parse(list.stdout || '{}'); installed = (j.platforms || j || []).map(p => p.id || p.ID).filter(Boolean); } catch { /* sortie inattendue : on tente l'installation */ }
  if (!installed.includes(core)) {
    log(tl('Première utilisation de {0} : téléchargement des fichiers de la carte (une seule fois)…', kind));
    if (!ok(await cli.run(['core', 'update-index', ...urlArgs(core)]))) return { ok: false, msg: tl('Index des cartes injoignable : vérifiez la connexion Internet (une seule fois).') };
    const r = await cli.run(['core', 'install', core, ...urlArgs(core)]);
    if (!ok(r)) return { ok: false, msg: tl('Installation de {0} impossible : {1}', core, (r.stderr || r.stdout || '').trim().split('\n').pop()) };
  }
  const incs = [...new Set([...String(code).matchAll(/#include\s*[<"]([^>"]+)[>"]/g)].map(m => m[1]))];
  const libs = [...new Set(incs.flatMap(i => LIBS[i] || []))];
  if (libs.length) {
    const r = await cli.run(['lib', 'install', ...libs]);
    if (!ok(r)) return { ok: false, msg: tl('Bibliothèques impossibles à installer ({0}) : vérifiez la connexion Internet.', libs.join(', ')) };
  }
  return { ok: true };
}

/**
 * Erreurs de compilation (gcc) rapportées à la ligne du programme : « …/jollof_sketch.ino:12:5: error: … ».
 * Rend [{ line, col, msg, code: 'J1200' }].
 */
export function parseErrors(text) {
  const out = [], seen = new Set();
  for (const m of String(text).matchAll(/\.ino:(\d+):(\d+):\s*(?:fatal\s+)?(?:error|erreur)\s*:\s*(.+)/gi)) {
    const key = `${m[1]}:${m[2]}:${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let msg = m[3].trim();
    const inc = /^([\w.]+\.h(?:pp)?): No such file or directory/.exec(msg);
    if (inc) msg = tl('bibliothèque {0} introuvable : elle n’est pas connue de Jollof Studio ou son installation a échoué', inc[1]);
    out.push({ line: +m[1], col: +m[2], msg, code: 'J1200' });
  }
  return out;
}

/**
 * Compile le programme d'une carte. Rend { ok, hex, errors, log } ; hex : texte Intel HEX (Uno, Nano).
 * Pico : { ok, image, format, errors, log } ; image : octets du .bin (copie de la flash), sinon du .uf2.
 * ESP32 : { ok, image, format: 'merged', errors, log } ; image : la flash entière (chargeur, partitions, programme),
 * compilée avec la cale de l'émulateur (src/emu/esp32-shim).
 * log(texte) reçoit l'avancement (installation, compilation). Une compilation à la fois : le croquis et le dossier
 * de compilation servent à toutes les cartes.
 */
let queue = Promise.resolve();
export function compileFirmware(code, kind, log = () => {}, cli = nativeCli) {
  const job = queue.then(() => compileOne(code, kind, log, cli));
  queue = job.catch(() => {});
  return job;
}
async function compileOne(code, kind, log, cli) {
  if (!EMULATED.has(kind)) return { ok: false, errors: [{ line: 1, col: 1, msg: tl('Le mode fidèle n’existe pas encore pour cette carte.'), code: 'J1200' }] };
  const esp32 = kind === 'esp32';
  const refusal = esp32 ? esp32Refusal(code) : null;
  if (refusal) return { ok: false, errors: [{ line: 1, col: 1, msg: refusal, code: 'J1200' }] };
  if (!cli.available()) return { ok: false, errors: [{ line: 1, col: 1, msg: tl('Le mode fidèle compile le vrai programme avec arduino-cli : il demande l’application installée.'), code: 'J1200' }] };
  let tc;
  try { tc = await ensureToolchain(kind, code, log, cli); } catch (e) { tc = { ok: false, msg: String((e && e.message) || e) }; }
  if (!tc.ok) {
    const msg = /introuvable|not found/i.test(tc.msg || '') ? tl('arduino-cli est introuvable. Installez-le (https://arduino.github.io/arduino-cli/latest/installation/) puis relancez Jollof Studio.') : tc.msg;
    return { ok: false, errors: [{ line: 1, col: 1, msg, code: 'J1200' }] };
  }
  log(tl('Compilation du programme (arduino-cli)…'));
  let out;
  try {
    const sketch = await cli.write(code, { shim: esp32 }), [, build] = await cli.paths();
    out = await cli.run(['compile', '--fqbn', FQBN[kind], '--output-dir', build, sketch]);
  } catch (e) {
    return { ok: false, errors: [{ line: 1, col: 1, msg: String((e && e.message) || e), code: 'J1200' }] };
  }
  const text = `${out.stdout || ''}\n${out.stderr || ''}`;
  if (!ok(out)) {
    const errors = parseErrors(text);
    return { ok: false, errors: errors.length ? errors : [{ line: 1, col: 1, msg: text.trim().split('\n').slice(-3).join(' ') || tl('La compilation a échoué.'), code: 'J1200' }], log: text };
  }
  if (esp32) return { ok: true, image: new Uint8Array(await cli.read('merged.bin')), format: 'merged', errors: [], log: text };
  if (coreOf(FQBN[kind]) === 'rp2040:rp2040') {
    let format = 'bin', bytes;
    try { bytes = await cli.read('bin'); } catch { format = 'uf2'; bytes = await cli.read('uf2'); }
    return { ok: true, image: new Uint8Array(bytes), format, errors: [], log: text };
  }
  const bytes = await cli.read('hex');
  return { ok: true, hex: new TextDecoder().decode(bytes), errors: [], log: text };
}
