// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Réglages normalisés de l'export vidéo : node --test src/video/encode.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from './encode.js';

test('H.264 : le niveau suit la taille et la cadence (tableau A-1)', () => {
  assert.equal(E.avcLevel(1280, 720, 30), 31);
  assert.equal(E.avcLevel(1920, 1080, 30), 40);
  assert.equal(E.avcLevel(1920, 1080, 25), 40);
  assert.equal(E.avcLevel(1920, 1080, 60), 42);
  assert.equal(E.avcLevel(2560, 1440, 30), 50);
  assert.equal(E.avcLevel(2560, 1440, 60), 51);
  assert.equal(E.avcLevel(3840, 2160, 30), 51);
  assert.equal(E.avcLevel(3840, 2160, 60), 52);
  // Débit d'un original : 1080p30 à 20 Mbit/s dépasse le niveau 4.0 (25 Mbit/s en High) ? Non ; à 30 Mbit/s, oui.
  assert.equal(E.avcLevel(1920, 1080, 30, 20e6), 40);
  assert.equal(E.avcLevel(1920, 1080, 30, 30e6), 41);
  assert.deepEqual(E.codecStrings('avc', 1920, 1080, 30, 8e6).slice(0, 2), ['avc1.640028', 'avc1.640034']);
});

test('HEVC et AV1 : niveaux et chaînes de codec', () => {
  assert.equal(E.hevcLevel(1920, 1080, 30), 120);
  assert.equal(E.hevcLevel(1920, 1080, 60), 123);
  assert.equal(E.hevcLevel(3840, 2160, 30), 150);
  assert.equal(E.hevcLevel(3840, 2160, 60), 153);
  assert.equal(E.codecStrings('hevc', 3840, 2160, 60, 40e6)[0], 'hvc1.1.6.L153.B0');
  assert.equal(E.av1Level(1280, 720, 60), 5);
  assert.equal(E.av1Level(1920, 1080, 60), 8);
  assert.equal(E.av1Level(3840, 2160, 60), 13);
  assert.equal(E.codecStrings('av1', 1920, 1080, 30, 4e6)[0], 'av01.0.08M.08');
  assert.deepEqual(E.codecOrder('av1'), ['av1', 'avc']);
  assert.deepEqual(E.codecOrder('avc'), ['avc']);
  assert.deepEqual(E.codecOrder('bad'), ['avc']);
});

test('Débits : recommandations YouTube, plus bas en HEVC/AV1, plafonnés au niveau', () => {
  assert.equal(E.bitrateFor(1080, 30), 8e6);
  assert.equal(E.bitrateFor(1080, 60), 12e6);
  assert.equal(E.bitrateFor(2160, 59.94), 68e6);
  assert.equal(E.bitrateFor(1080, 30, 'hevc'), 5.2e6);
  assert.equal(E.bitrateFor(1080, 30, 'avc', 'master'), 20e6);
  assert.equal(E.bitrateFor(2160, 60, 'av1', 'master'), 60e6);
});

test('Cadences exactes, y compris 29,97 et 59,94', () => {
  const r = E.parseRate('30000/1001');
  assert.equal(r.num, 30000); assert.equal(r.den, 1001);
  assert.equal(E.frameCount(10, r), 300); // 9,99 s de vidéo pour 10 s demandées : on arrondit au-dessus
  assert.equal(E.frameTime(300, r), 10.01);
  assert.equal(E.frameCount(2, E.parseRate(25)), 50);
  assert.equal(E.parseRate('nope').fps, 30);
  assert.equal(E.rateLabel(30000 / 1001), '29,97');
  assert.equal(E.rateLabel(24000 / 1001, '.'), '23.976');
  assert.equal(E.rateLabel(25), '25');
});

test('Sous-titres : répliques regroupées, WebVTT et SRT valides', () => {
  const samples = [
    { t: 0, text: '' }, { t: 0.5, text: E.capLines('Fil 1/2 · Alimentation|5V → VIN') }, { t: 1, text: E.capLines('Fil 1/2 · Alimentation|5V → VIN') },
    { t: 1.5, text: 'A <b> & --> c' }, { t: 2, text: '' }, { t: 3, text: 'Circuit câblé' }
  ];
  const cues = E.cuesFrom(samples, 4.2);
  assert.deepEqual(cues.map(c => [c.start, c.end]), [[0.5, 1.5], [1.5, 2], [3, 4.2]]);
  assert.equal(cues[0].text, 'Fil 1/2 · Alimentation\n5V → VIN');
  const vtt = E.toWebVTT(cues, 'fr');
  assert.ok(vtt.startsWith('WEBVTT\nLanguage: fr\n\n1\n00:00:00.500 --> 00:00:01.500\nFil 1/2'));
  assert.ok(vtt.includes('A &lt;b&gt; &amp; --&gt; c'));
  assert.equal((vtt.match(/-->/g) || []).length, 3);
  const srt = E.toSRT(cues);
  assert.ok(srt.startsWith('1\n00:00:00,500 --> 00:00:01,500\n'));
  assert.ok(srt.includes('3\n00:00:03,000 --> 00:00:04,200\nCircuit câblé\n'));
  assert.deepEqual(E.cuesFrom([], 3), []);
});

test('Langue ISO 639-2 et zone de sécurité titre', () => {
  assert.equal(E.iso639('fr'), 'fra'); assert.equal(E.iso639('en-GB'), 'eng'); assert.equal(E.iso639(''), 'und');
  assert.deepEqual(E.titleSafe(1920, 1080), { x: 96, y: 54, w: 1728, h: 972 });
});
