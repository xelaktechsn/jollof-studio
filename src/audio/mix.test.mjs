// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Bande-son : node --test src/audio/mix.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from './mix.js';
import { synth, SFX } from './sfx.js';
import { MUSIC } from './library.js';
import fs from 'node:fs';

test('Modèle : entrée hostile nettoyée, bornes, identifiants, clips absents écartés', () => {
  const a = M.normalizeAudio({
    music: { id: 'nope', clip: 'a1', gain: 99, fadeIn: -5 },
    sfx: { wire: 'click', done: '<script>', gain: 'x' },
    voice: [{ id: 'v1', clip: 'a1', t: 2, gain: 3, name: 'Intro' }, { id: 'v2', clip: 'a9', t: 1 }, { id: 'bad id', clip: 'a1', t: -4 }],
    duck: 99, target: 'zz',
    clips: { a1: { mime: 'audio/mp4', b64: 'AAAA', name: 'Voix' }, 'x/../y': { b64: 'AAAA' }, a3: { mime: 'text/html', b64: 'AAAA' } }
  });
  assert.deepEqual(Object.keys(a.clips), ['a1', 'a3']);
  assert.equal(a.clips.a3.mime, 'audio/mpeg');
  assert.deepEqual(a.music, { id: null, clip: 'a1', gain: 6, start: 0, fadeIn: 0, fadeOut: 2, loop: true });
  assert.deepEqual(a.sfx, { wire: 'click', done: null, gain: -8 });
  assert.deepEqual(a.voice.map(v => [v.id, v.t]), [['v1', 2], ['v2', 0]]);
  assert.equal(a.duck, 30); assert.equal(a.target, 'web');
  assert.equal(M.normalizeAudio(null), null);
  assert.ok(M.isSilent(M.emptyAudio()));
});

test('Effets : un à chaque extrait de fils, un à la fin', () => {
  const a = { ...M.emptyAudio(), sfx: { wire: 'click', done: 'chime', gain: -8 } };
  const tl = { wires: [{ t: 0.6, d: 1 }, { t: 2.1, d: 1 }] };
  assert.deepEqual(M.sfxEvents(a, tl, () => 3.4), [{ id: 'click', t: 0.6 }, { id: 'click', t: 2.1 }, { id: 'chime', t: 3.4 }]);
});

test('Mixage : voix au bon instant, musique bouclée, baissée sous la voix, fondus', () => {
  const fs = 8000, len = fs * 4;
  const music = new Float32Array(fs).fill(0.5); // 1 s de musique : doit boucler
  const voice = new Float32Array(fs).fill(0); for (let i = 0; i < fs; i++) voice[i] = Math.sin(2 * Math.PI * 440 * i / fs) * 0.3;
  const a = { ...M.emptyAudio(), music: { id: 'x', clip: null, gain: 0, start: 0, fadeIn: 0, fadeOut: 0, loop: true }, voice: [{ id: 'v1', clip: 'a1', t: 2, gain: 0 }], duck: 12 };
  const [L] = M.mix(a, { music: [music], clips: new Map([['a1', [voice]]]), sfx: () => null }, [], len, fs);
  assert.ok(Math.abs(L[Math.round(fs * 0.5)] - 0.5) < 1e-6, 'musique seule');
  assert.ok(Math.abs(L[Math.round(fs * 1.5)] - 0.5) < 1e-6, 'musique bouclée');
  const ducked = 0.5 * Math.pow(10, -12 / 20);
  // Pendant la voix : musique baissée de 12 dB + voix (on retire la voix pour vérifier).
  const at = Math.round(fs * 2.5), hp = M.highpass(voice, fs);
  assert.ok(Math.abs(L[at] - hp[at - 2 * fs] - ducked) < 1e-4, `baisse sous la voix : ${L[at] - hp[at - 2 * fs]}`);
  assert.ok(Math.abs(L[Math.round(fs * 3.8)] - 0.5) < 1e-4, 'remontée après la voix');
  const env = M.musicEnvelope(fs, fs, { fadeIn: 0.5, fadeOut: 0.5 }, [], 0);
  assert.equal(env[0], 0); assert.ok(env[Math.round(fs / 2)] > 0.99); assert.ok(env[fs - 1] < 0.01);
});

test('Passe-haut 80 Hz : coupe le grondement, laisse passer la voix', () => {
  const fs = 48000, sin = f => Float32Array.from({ length: fs }, (_, i) => Math.sin(2 * Math.PI * f * i / fs));
  const rms = x => Math.sqrt(x.slice(fs / 2).reduce((s, v) => s + v * v, 0) / (fs / 2));
  assert.ok(rms(M.highpass(sin(20), fs)) < 0.05);
  assert.ok(rms(M.highpass(sin(1000), fs)) > 0.7);
});

test('Effets synthétisés : tous présents, bornés, déterministes', () => {
  for (const s of SFX) {
    const x = synth(s.id, 48000);
    assert.ok(x.length > 100, s.id);
    assert.ok(Math.max(...x.map(Math.abs)) <= 0.5 + 1e-6, s.id);
    assert.ok(x.every(Number.isFinite), s.id);
  }
  assert.equal(synth('nope', 48000), null);
});

test('WAV 24 bits : en-tête et échantillons', () => {
  const w = M.wav24([Float32Array.of(0, 1, -1), Float32Array.of(0.5, 0, 0)], 48000);
  const v = new DataView(w.buffer);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), 'RIFF');
  assert.equal(v.getUint16(34, true), 24); assert.equal(v.getUint32(40, true), 18);
  assert.deepEqual([...w.slice(44 + 6, 44 + 9)], [0xff, 0xff, 0x7f]); // 1.0 → 8388607
});

test('Bibliothèque : chaque morceau a son fichier', () => {
  for (const m of MUSIC) assert.ok(fs.existsSync(new URL(`../../public/audio/music/${m.id}.mp3`, import.meta.url)), m.id);
});
