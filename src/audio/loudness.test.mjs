// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Sonie BS.1770-4 : node --test src/audio/loudness.test.mjs (cas de l'UER Tech 3341)
import test from 'node:test';
import assert from 'node:assert/strict';
import { integratedLoudness, truePeak, normalize, limit, TARGETS } from './loudness.js';

const sine = (fs, sec, f, dbfs, phase = 0) => { const a = Math.pow(10, dbfs / 20), x = new Float32Array(Math.round(fs * sec)); for (let n = 0; n < x.length; n++) x[n] = a * Math.sin(2 * Math.PI * f * n / fs + phase); return x; };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} au lieu de ${b} ± ${tol}`);

test('UER Tech 3341, cas 1 et 2 : sinus 1 kHz stéréo à −23 et −33 dBFS → −23 et −33 LUFS', () => {
  for (const fs of [48000, 44100]) {
    near(integratedLoudness([sine(fs, 20, 1000, -23), sine(fs, 20, 1000, -23)], fs), -23, 0.1, `${fs} Hz`);
    near(integratedLoudness([sine(fs, 20, 1000, -33), sine(fs, 20, 1000, -33)], fs), -33, 0.1, `${fs} Hz`);
  }
});

test('Porte : les silences ne baissent pas la sonie (cas 3 et 4 simplifiés)', () => {
  const fs = 48000, on = sine(fs, 10, 1000, -23), x = new Float32Array(fs * 30); x.set(on, fs * 10);
  near(integratedLoudness([x, x], fs), -23, 0.2, 'avec 20 s de silence');
  assert.equal(integratedLoudness([new Float32Array(fs * 5), new Float32Array(fs * 5)], fs), -Infinity);
});

test('Crête vraie : un sinus proche de fs/4 déphasé a une crête entre les échantillons', () => {
  const fs = 48000, x = sine(fs, 1, 12000, -6, Math.PI / 4); // fs/4 : échantillons toujours à ±0,707 de la crête
  const sp = 20 * Math.log10(Math.max(...x.map(Math.abs)));
  assert.ok(sp < -8.5, `crête des échantillons ${sp}`);
  near(truePeak([x]), -6, 0.5, 'crête vraie');
});

test('Normalisation YouTube : −14 LUFS, crête vraie ≤ −1 dBTP même pour un signal très dynamique', () => {
  const fs = 48000, a = sine(fs, 12, 220, -30), b = sine(fs, 12, 330, -30);
  for (let i = 0; i < 40; i++) { const at = Math.floor(fs * (0.3 * i)); a[at] = 0.99; b[at] = -0.99; } // clics forts
  const r = normalize([a, b], fs, TARGETS.web);
  near(r.after, -14, 0.5, 'sonie');
  assert.ok(r.peak <= -0.95, `crête ${r.peak}`);
  assert.ok(r.limited);
  const q = normalize([sine(fs, 8, 1000, -40), sine(fs, 8, 1000, -40)], fs, TARGETS.ebu);
  near(q.after, -23, 0.1, 'UER R 128'); assert.equal(q.limited, false);
});

test('Limiteur : rien ne dépasse le plafond, le reste est intact', () => {
  const fs = 48000, x = sine(fs, 1, 100, -3);
  x[24000] = 1;
  limit([x], fs, -6);
  assert.ok(Math.max(...x.map(Math.abs)) <= Math.pow(10, -6 / 20) + 1e-6);
});
