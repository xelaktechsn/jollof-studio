// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pont des modules de l'ESP32 émulé (src/emu/esp32-bridge.js), sans QEMU : le test joue la cale du programme
// (trames 'V' de src/emu/esp32-shim/jollof_qemu_shim.cpp) et lit ce que le pont lui renvoie. Les vrais programmes,
// dans QEMU, sont dans src/emu/esp32-corpus.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, maskBytes } from './esp32-bridge.js';
import { pinMap } from '../prog/runtime.js';
import { fakeBoard } from './testkit.mjs';
import { dhtFrame } from './devices/dht.js';
import * as ds from './devices/ds18b20.js';
import { keypadDown } from '../sim/models.js';

const ch = c => c.charCodeAt(0);
const le32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

/** Pont branché sur une fausse carte ESP32 ; sent : trames renvoyées à la cale, décodées { op, d }. */
function rig(modules, inputs = {}) {
  const { hw, comps } = fakeBoard({ kind: 'esp32', modules, inputs });
  const recs = new Map();
  const sent = [];
  const keys = pinMap(hw.prof, 'esp32');
  for (const k of keys.values()) recs.set(k, { mode: 0, px: null });
  const b = createBridge({ hw, keys, rec: k => recs.get(k), send: bytes => sent.push({ op: String.fromCharCode(bytes[1]), d: bytes.slice(4) }) });
  b.ready();
  const replies = () => sent.filter(x => x.op === 'r').map(x => x.d);
  return { b, comps, sent, recs, replies, last: () => replies().at(-1) };
}
const post = (b, t, ...d) => b.frame('p', t, Uint8Array.from(d.flat()));
const ask = (b, t, ...d) => b.frame('q', t, Uint8Array.from(d.flat()));
/** Réponse à une lecture : broches concernées, niveaux, puis suite [broche, niveau, délai µs]. */
function readReply(d) {
  const mask = d.slice(0, 7), lv = d.slice(7, 14), ev = [];
  for (let i = 14; i + 6 <= d.length; i += 6) ev.push([d[i], d[i + 1], d[i + 2] | (d[i + 3] << 8) | (d[i + 4] << 16) | (d[i + 5] << 24)]);
  const has = (m, n) => !!(m[n >> 3] & (1 << (n & 7)));
  return { inc: n => has(mask, n), level: n => (has(lv, n) ? 1 : 0), ev };
}

test('broches reliées : masque et niveaux envoyés à la cale avant les entrées', () => {
  const { sent } = rig([{ type: 'dht22', pins: { DATA: 'D4' }, data: { temp: 20, hum: 50 } }, { type: 'lcd1602', addr: [0x27] }]);
  const B = sent.find(x => x.op === 'B');
  assert.deepEqual(B.d.slice(0, 7), maskBytes(new Set([4])), 'DATA du DHT reliée, pas les broches I2C');
  assert.deepEqual(B.d.slice(7, 14), maskBytes(new Set([4])), 'ligne du DHT tirée au niveau haut');
});

test('I2C : écriture, lecture avec départ répété (BMP280 : identifiant 0x58), adresse absente', () => {
  const { b, last, sent } = rig([{ type: 'bmp280', addr: [0x76], data: { temp: 24.5, press: 1007 } }]);
  ask(b, 1000, ch('X'), 0, 0x76, 1, 0, 0xD0, 1, 0);
  assert.deepEqual(last(), [0, 0x58]);
  ask(b, 1100, ch('W'), 0, 0x50, 0x00);
  assert.deepEqual(last(), [2], 'pas d’acquittement');
  ask(b, 1200, ch('R'), 0, 0x76, 2, 0);
  assert.equal(last()[0], 0);
  post(b, 1300, ch('W'), 0, 0x51, 1, 2); // écriture envoyée sans attendre à une adresse muette : la cale est prévenue
  assert.deepEqual(sent.at(-1), { op: 'N', d: [0x51] });
});

test('DHT22 : départ tenu 1,1 ms, relâché ; la lecture 56 µs plus tard reçoit la trame entière, au bon moment', () => {
  const data = { temp: -7.3, hum: 35.5 };
  const { b, last } = rig([{ type: 'dht22', pins: { DATA: 'D4' }, data }], { D4: { d: 1 } });
  post(b, 10000, ch('m'), 4, 3); // OUTPUT (sortie à LOW)
  post(b, 11100, ch('m'), 4, 5); // INPUT_PULLUP : relâchée
  ask(b, 11156, ch('r'), 4);
  const r = readReply(last());
  assert.ok(r.inc(4));
  assert.equal(r.level(4), 0, 'la réponse du capteur a commencé (bas 80 µs)');
  // Durées hautes des 40 bits : 26 µs pour 0, 70 µs pour 1.
  const ev = r.ev.filter(e => e[0] === 4), bits = [];
  for (let i = 0; i + 1 < ev.length; i++) if (ev[i][1] === 1 && i > 0) bits.push(ev[i + 1][2] - ev[i][2] > 48 ? 1 : 0);
  const bytes = [];
  for (let i = 0; i < 40; i += 8) bytes.push(bits.slice(i, i + 8).reduce((a, x) => (a << 1) | x, 0));
  assert.deepEqual(bytes, dhtFrame('dht22', data));
});

test('HC-SR04 : écho programmé après la fin de TRIG, rendu avec la lecture (pulseIn)', () => {
  const { b, last } = rig([{ type: 'hcsr04', pins: { TRIG: 'D13', ECHO: 'D14' }, data: { us: 1160 } }]);
  post(b, 5000, ch('m'), 13, 3); post(b, 5000, ch('m'), 14, 1);
  post(b, 5002, ch('w'), 13, 1); post(b, 5012, ch('w'), 13, 0);
  ask(b, 5030, ch('r'), 14);
  const r = readReply(last()), ev = r.ev.filter(e => e[0] === 14);
  assert.equal(r.level(14), 0);
  assert.deepEqual(ev.map(e => e[1]), [1, 0]);
  assert.ok(Math.abs(ev[0][2] - 232) <= 2, `début de l’écho ${ev[0][2]} µs après la lecture`);
  assert.equal(ev[1][2] - ev[0][2], 1160);
});

test('1-Wire : présence, recherche des deux DS18B20 (bits en conflit), lecture du bloc-notes', () => {
  const mods = [{ type: 'ds18b20', id: 'ds18b20_0', pins: { DQ: 'D32' }, data: { temp: 21.3 } }, { type: 'ds18b20', id: 'ds18b20_1', pins: { DQ: 'D32' }, data: { temp: -3.7 } }];
  const { b, last } = rig(mods, { D32: { d: 1 } });
  post(b, 1000, ch('m'), 32, 1);
  ask(b, 2000, ch('O'), 32, ch('r'));
  assert.deepEqual(last(), [1], 'impulsion de présence');
  const roms = [];
  let st = { rom: new Array(8).fill(0), last: 0, fam: 0 };
  for (let i = 0; i < 3; i++) {
    ask(b, 3000 + i * 10000, ch('O'), 32, ch('s'), st.rom, st.last, st.fam, 0xF0);
    const r = last();
    if (!r[0]) break;
    roms.push(r.slice(1, 9).map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase());
    st = { rom: r.slice(1, 9), last: r[9], fam: r[10] };
    if (r[11]) break;
  }
  assert.deepEqual(roms.sort(), ['284F30FB2A86C37D', '28BC3F0B785437A0']);
  // Une sonde désignée (0x55 + adresse), lecture du bloc-notes (0xBE) : 9 octets, CRC juste.
  ask(b, 60000, ch('O'), 32, ch('r'));
  post(b, 61000, ch('O'), 32, ch('w'), 0xCC, 0x44);
  ask(b, 900000, ch('O'), 32, ch('r'));
  post(b, 901000, ch('O'), 32, ch('w'), 0x55, 0x28, 0xBC, 0x3F, 0x0B, 0x78, 0x54, 0x37, 0xA0, 0xBE);
  ask(b, 902000, ch('O'), 32, ch('R'), 9);
  const sp = last();
  assert.equal(sp.length, 9);
  assert.equal(ds.crc8(sp, 8), sp[8]);
  assert.equal(((sp[1] << 8) | sp[0]) / 16, 21.3125);
});

test('clavier : colonne mise à LOW, la ligne de la touche enfoncée la suit à la lecture suivante', () => {
  const { b, comps, last } = rig([{ type: 'keypad', pins: { R1: 'D13', R2: 'D12', R3: 'D14', R4: 'D27', C1: 'D26', C2: 'D25', C3: 'D33', C4: 'D32' } }]);
  for (const n of [13, 12, 14, 27]) post(b, 1000, ch('m'), n, 5);
  keypadDown(comps[0], 1, 2); // R2, C3
  b.run();
  post(b, 2000, ch('m'), 33, 3); post(b, 2000, ch('w'), 33, 0);
  ask(b, 2010, ch('r'), 12);
  assert.equal(readReply(last()).level(12), 0, 'R2 tirée à LOW par C3');
  post(b, 2020, ch('w'), 33, 1);
  ask(b, 2030, ch('r'), 12);
  assert.equal(readReply(last()).level(12), 1);
});

test('RMT : symboles d’Adafruit_NeoPixel rejoués sur DIN de la barrette WS2812 (rec.px)', () => {
  const { b, recs } = rig([{ type: 'ws2812', pins: { DIN: 'D25' } }]);
  // 10 MHz : 0 = 4 tics hauts, 8 bas ; 1 = 8 hauts, 4 bas. Une LED : G=0, R=255, B=0.
  const sym = bit => (bit ? 8 | (1 << 15) | (4 << 16) : 4 | (1 << 15) | (8 << 16)) >>> 0;
  const bits = [...[0, 255, 0].flatMap(v => [7, 6, 5, 4, 3, 2, 1, 0].map(i => (v >> i) & 1))];
  post(b, 1000, ch('K'), 25, le32(10e6), bits.flatMap(x => le32(sym(x))));
  b.beat(2000, 0);
  b.run();
  assert.deepEqual(recs.get('D25').px, [[255, 0, 0]]);
});

test('Serial2 : broches et vitesse données par begin(), un HC-05 en mode AT répond', () => {
  const { b, sent } = rig([{ type: 'hc05', pins: { TXD: 'RX2', RXD: 'TX2', EN: 'D4' } }]);
  post(b, 1000, ch('m'), 4, 3); post(b, 1000, ch('w'), 4, 1);
  post(b, 2000, ch('u'), 2, 16, 17, le32(38400));
  post(b, 3000, ch('U'), 2, [...'AT\r\n'].map(ch));
  let got = '';
  for (let t = 4000; t < 400000 && !/OK/.test(got); t += 16000) {
    b.beat(t, 0); b.run();
    got = sent.filter(x => x.op === 'U' && x.d[0] === 2).map(x => String.fromCharCode(...x.d.slice(1))).join('');
  }
  assert.match(got, /OK\r\n/);
});
