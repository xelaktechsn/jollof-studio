// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Carte microSD : image FAT16 (construction et relecture), protocole SPI des cartes SD, bibliothèque SD de
// l'interpréteur, fichiers gardés avec le projet. node --test src/sim/sdcard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImage, readImage, createSdCard, sdStore, saveStore, normPath, SD_CAP, CARD_SECTORS } from './sdcard.js';
import { syncCard, cardState } from '../emu/devices/sdcard.js';
import { compile } from '../prog/lang.js';
import { createRuntime } from '../prog/runtime.js';
import { BOARDS } from './boards.js';

const enc = s => new TextEncoder().encode(s), dec = u => new TextDecoder().decode(u);

test('noms courts 8.3 : chemins normalisés en majuscules, noms longs refusés', () => {
  assert.equal(normPath('log.txt'), '/LOG.TXT');
  assert.equal(normPath('/data/a.csv'), '/DATA/A.CSV');
  assert.equal(normPath('/'), '/');
  assert.equal(normPath('temperature.csv'), null);
  assert.equal(normPath('../x.txt'), null);
});

test('image FAT16 : construite puis relue à l’identique (dossiers, fichiers de plusieurs blocs)', () => {
  const big = new Uint8Array(5000).map((_, i) => i & 255);
  const files = new Map([['/A.TXT', enc('bonjour')], ['/DATA/B.BIN', big], ['/DATA/SUB/C.TXT', enc('')]]);
  const img = buildImage(files, new Set(['/VIDE']));
  // MBR : partition 1 de type 0x06 ; secteur de démarrage « FAT16 ».
  const mbr = img.get(0); assert.equal(mbr[450], 0x06); assert.equal(mbr[510], 0x55);
  const r = readImage(img);
  assert.deepEqual([...r.files.keys()].sort(), ['/A.TXT', '/DATA/B.BIN', '/DATA/SUB/C.TXT']);
  assert.equal(dec(r.files.get('/A.TXT')), 'bonjour');
  assert.deepEqual(r.files.get('/DATA/B.BIN'), big);
  assert.deepEqual([...r.dirs].sort(), ['/DATA', '/DATA/SUB', '/VIDE']);
});

/** Envoie une commande et rend les octets reçus ensuite (n lectures de 0xFF). */
function command(card, n, arg = 0, crc = 0xff, read = 8) {
  for (const b of [0x40 | n, arg >>> 24, (arg >> 16) & 255, (arg >> 8) & 255, arg & 255, crc]) card.transfer(b);
  return Array.from({ length: read }, () => card.transfer(0xff));
}
const r1 = out => out.find(b => !(b & 0x80));
function initCard(card) {
  assert.equal(r1(command(card, 0, 0, 0x95)), 0x01, 'CMD0 : état de repos');
  const r7 = command(card, 8, 0x1aa, 0x87);
  assert.deepEqual(r7.slice(1, 6), [0x01, 0x00, 0x00, 0x01, 0xaa], 'CMD8 : R7 renvoie le motif');
  let st;
  for (let i = 0; i < 5 && st !== 0; i++) { command(card, 55); st = r1(command(card, 41, 0x40000000)); }
  assert.equal(st, 0x00, 'ACMD41 : carte prête');
  const ocr = command(card, 58);
  assert.equal(ocr[2] & 0xc0, 0xc0, 'CMD58 : carte SDHC alimentée');
}

test('protocole SPI : initialisation, lecture et écriture d’un bloc, lecture et écriture de plusieurs blocs', () => {
  const img = buildImage(new Map([['/A.TXT', enc('salut')]])), card = createSdCard(img);
  assert.equal(r1(command(card, 17, 0)), undefined, 'muette avant CMD0');
  initCard(card);
  // CMD9 : CSD version 2 (C_SIZE = 63 : 32 Mo).
  const csd = command(card, 9, 0, 0xff, 24), t = csd.indexOf(0xfe);
  assert.equal(csd[t + 1] >> 6, 1);
  // CMD17 : le MBR.
  const rd = command(card, 17, 0, 0xff, 520), tok = rd.indexOf(0xfe);
  assert.equal(rd[tok + 1 + 510], 0x55); assert.equal(rd[tok + 1 + 450], 0x06);
  // CMD24 : un bloc écrit, jeton de réponse 0x05 puis occupée (0x00) puis libre.
  assert.equal(r1(command(card, 24, 3000)), 0x00);
  card.transfer(0xfe); for (let i = 0; i < 512; i++) card.transfer(i & 255); card.transfer(0xff); card.transfer(0xff);
  assert.equal(card.transfer(0xff) & 0x1f, 0x05);
  assert.equal(card.transfer(0xff), 0x00);
  let n = 0; while (card.transfer(0xff) !== 0xff && n < 10) n++;
  assert.equal(img.get(3000)[7], 7); assert.ok(img.dirty);
  // CMD25 : deux blocs, jetons 0xFC puis 0xFD.
  assert.equal(r1(command(card, 25, 4000)), 0x00);
  for (let k = 0; k < 2; k++) {
    card.transfer(0xfc); for (let i = 0; i < 512; i++) card.transfer(k + 1); card.transfer(0xff); card.transfer(0xff);
    assert.equal(card.transfer(0xff) & 0x1f, 0x05);
    while (card.transfer(0xff) !== 0xff);
  }
  card.transfer(0xfd); while (card.transfer(0xff) !== 0xff);
  assert.equal(img.get(4000)[0], 1); assert.equal(img.get(4001)[511], 2);
  // CMD18 : lecture continue jusqu'à CMD12.
  assert.equal(r1(command(card, 18, 4000, 0xff, 2)), 0x00);
  const got = [];
  for (let k = 0; k < 2; k++) { while (card.transfer(0xff) !== 0xfe); for (let i = 0; i < 512; i++) got.push(card.transfer(0xff)); card.transfer(0xff); card.transfer(0xff); }
  assert.equal(got[0], 1); assert.equal(got[600], 2);
  assert.equal(r1(command(card, 12).slice(1)), 0x00, 'CMD12 : fin de la lecture');
  assert.equal(r1(command(card, 17, CARD_SECTORS + 5)), 0x40, 'adresse hors de la carte');
});

test('carte du mode fidèle : écritures de l’image relues dans les fichiers du projet', () => {
  const comp = { id: 'sd1', type: 'sdcard' }, mem = { sd: { '/OLD.TXT': btoa('x') } };
  const s = cardState(comp, mem);
  assert.equal(syncCard(comp, mem), false, 'rien d’écrit');
  // Le programme efface OLD.TXT (premier octet de son entrée de répertoire à 0xE5).
  const { files } = readImage(s.img);
  assert.ok(files.has('/OLD.TXT'));
  const root = 128 + 1 + 2 * Math.ceil(4202 * 2 / 512);
  const sec = s.img.get(root); const o = [...Array(16).keys()].map(i => i * 32).find(o => String.fromCharCode(...sec.subarray(o, o + 3)) === 'OLD');
  sec[o] = 0xe5; s.img.set(root, sec);
  assert.equal(syncCard(comp, mem), true);
  assert.deepEqual(mem.sd, {});
});

/** Carte factice pour l'interpréteur : module SD sur D4. */
function board(card, extra = {}) {
  return {
    kind: 'uno', label: 'uno', prof: BOARDS.uno, read: () => null,
    at: k => (k === 'D4' && card ? [{ comp: card, pin: 'CS' }] : []), bus: () => [], i2c: () => [], status: () => ({ ok: true, msg: '' }),
    data: () => null, mem: () => ({ ee: '', prefs: {} }), compMem: c => c.mem || (c.mem = {}), memChanged: () => { extra.saves = (extra.saves || 0) + 1; }, ...extra
  };
}
function run(src, hw, n = 3) {
  const c = compile(src, { board: 'uno' });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  let out = '';
  for (let i = 0; i < n; i++) { rt.run(16); out += rt.takeSerial(); }
  assert.notEqual(rt.state, 'error', rt.error && rt.error.msg);
  return { rt, out };
}
const SKETCH = `#include <SPI.h>
#include <SD.h>
File f;
void setup() {
  Serial.begin(9600);
  if (!SD.begin(4)) { Serial.println("echec"); return; }
  File r0 = SD.open("lisez.txt");
  if (r0) { Serial.print("projet:"); Serial.println(r0.readStringUntil('\\n')); r0.close(); }
  f = SD.open("log.txt", FILE_WRITE);
  if (f) { f.println("bonjour"); f.print("n="); f.println(3); f.close(); }
  File r = SD.open("log.txt");
  Serial.print("taille="); Serial.println(r.size());
  while (r.available()) Serial.write(r.read());
  r.close();
  File bad = SD.open("absent.txt");
  if (!bad) Serial.println("absent");
  bad.close();
  SD.mkdir("data");
  Serial.print("existe="); Serial.println(SD.exists("DATA"));
  File root = SD.open("/");
  File e = root.openNextFile();
  while (e) { Serial.print("- "); Serial.print(e.name()); Serial.println(e.isDirectory() ? "/" : ""); e = root.openNextFile(); }
  SD.remove("lisez.txt");
}
void loop() {}`;

test('bibliothèque SD de l’interpréteur : écrire, relire, lister, effacer ; fichiers gardés avec le projet', () => {
  const card = { id: 'sd1', type: 'sdcard', name: 'SD1', mem: { sd: { '/LISEZ.TXT': btoa('du projet\nfin') } } }, extra = {};
  const { out } = run(SKETCH, board(card, extra));
  assert.match(out, /projet:du projet\n/);
  assert.match(out, /taille=14\n/);
  assert.match(out, /bonjour\r\nn=3\r\n/);
  assert.match(out, /absent\n/);
  assert.match(out, /existe=1\n/);
  assert.match(out, /- LISEZ\.TXT\n- DATA\/\n- LOG\.TXT\n|- DATA\/\n- LISEZ\.TXT\n- LOG\.TXT\n/);
  assert.equal(atob(card.mem.sd['/LOG.TXT']), 'bonjour\r\nn=3\r\n');
  assert.equal(card.mem.sd['/DATA/'], '');
  assert.ok(!('/LISEZ.TXT' in card.mem.sd), 'fichier effacé');
  assert.ok(extra.saves > 0, 'projet à enregistrer');
  // Le projet enregistré (JSON) relit les mêmes fichiers.
  const again = sdStore(JSON.parse(JSON.stringify({ sd: card.mem.sd })));
  assert.equal(dec(again.files.get('/LOG.TXT').data.subarray(0, again.files.get('/LOG.TXT').len)), 'bonjour\r\nn=3\r\n');
});

test('bibliothèque SD : sans module sur la broche CS, begin() échoue avec un avertissement', () => {
  const { rt, out } = run(SKETCH, board(null));
  assert.match(out, /echec/);
  assert.ok([...rt.warnings.values()].some(w => /aucun module microSD/.test(w.msg)));
});

test('carte pleine : 512 Ko de fichiers au plus', () => {
  const card = { id: 'sd2', type: 'sdcard', name: 'SD2', mem: {} };
  const { rt } = run(`#include <SD.h>
void setup() { SD.begin(4); File f = SD.open("gros.bin", FILE_WRITE); for (long i = 0; i < 600; i++) { for (int j = 0; j < 1000; j++) f.write(65); } f.close(); }
void loop() {}`, board(card), 400);
  const st = sdStore(card.mem);
  assert.equal(st.files.get('/GROS.BIN').len, SD_CAP);
  assert.ok([...rt.warnings.values()].some(w => /pleine/.test(w.msg)));
  saveStore(card.mem);
  assert.equal(atob(card.mem.sd['/GROS.BIN']).length, SD_CAP);
});
