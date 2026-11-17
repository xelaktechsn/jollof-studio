// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Bande-son d'une vidéo (module pur, testé sous Node) : modèle enregistré dans le projet, événements tirés de la
// timeline, mixage. Le navigateur décode les fichiers (src/audio/engine.js) ; tout le calcul est ici.
//
// Forme enregistrée (settings.audio) :
//   { v: 1,
//     music: { id: 'inspiration' | null, clip: 'a2' | null, gain: −12 dB, start: 0 s dans le morceau, fadeIn, fadeOut, loop } | null,
//     sfx:   { wire: 'click' | null, done: 'chime' | null, gain: −8 dB },        // effet à chaque fil, à la fin
//     voice: [{ id: 'v1', clip: 'a1', t: 0,5 s, gain: 0 dB, name }],              // voix off, posées sur la timeline
//     duck: 12 (dB : la musique baisse sous la voix ; 0 = jamais),
//     target: 'web' | 'ebu' | 'atsc',                                           // sonie visée (src/audio/loudness.js)
//     clips: { a1: { mime, b64, name } } }                                      // enregistrements et fichiers importés
import { musicById } from './library.js';
import { SFX } from './sfx.js';
import { TARGETS } from './loudness.js';

export const FS = 48000;
export const MAX_CLIP_B64 = 28 * 1024 * 1024; // ≈ 20 Mo de son par clip (la voix en AAC/Opus : bien moins)
export const MAX_CLIPS = 64;
const SFX_IDS = new Set(SFX.map(s => s.id));
const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
const clipId = s => (typeof s === 'string' && /^a\d{1,6}$/.test(s) ? s : null);

export const emptyAudio = () => ({ v: 1, music: null, sfx: { wire: null, done: null, gain: -8 }, voice: [], duck: 12, target: 'web', clips: {} });

/** Copie vérifiée d'une bande-son reçue (projet, copie d'élève) : bornes, identifiants, tailles. null si absente. */
export function normalizeAudio(raw, clean = (s, max) => String(s ?? '').slice(0, max)) {
  if (!raw || typeof raw !== 'object') return null;
  const a = emptyAudio(), clips = {};
  let n = 0;
  for (const [id, c] of Object.entries(raw.clips || {})) {
    if (n >= MAX_CLIPS || !clipId(id) || !c || typeof c.b64 !== 'string' || c.b64.length > MAX_CLIP_B64 || !/^[A-Za-z0-9+/=]*$/.test(c.b64.slice(0, 4096))) continue;
    const mime = typeof c.mime === 'string' && /^audio\/[\w.+-]{1,40}(;[\w=.,\s"-]{0,80})?$/.test(c.mime) ? c.mime : 'audio/mpeg';
    clips[id] = { mime, b64: c.b64, name: clean(c.name, 80) }; n++;
  }
  a.clips = clips;
  const m = raw.music;
  if (m && typeof m === 'object' && (musicById(m.id) || clips[clipId(m.clip)])) {
    a.music = { id: musicById(m.id) ? m.id : null, clip: musicById(m.id) ? null : clipId(m.clip), gain: num(m.gain, -40, 6, -12), start: num(m.start, 0, 3600, 0), fadeIn: num(m.fadeIn, 0, 10, 1), fadeOut: num(m.fadeOut, 0, 10, 2), loop: m.loop !== false };
  }
  const s = raw.sfx || {};
  a.sfx = { wire: SFX_IDS.has(s.wire) ? s.wire : null, done: SFX_IDS.has(s.done) ? s.done : null, gain: num(s.gain, -40, 6, -8) };
  const seen = new Set();
  a.voice = (Array.isArray(raw.voice) ? raw.voice : []).slice(0, MAX_CLIPS).filter(v => v && clips[clipId(v.clip)]).map(v => {
    const id = typeof v.id === 'string' && /^v\d{1,6}$/.test(v.id) && !seen.has(v.id) ? v.id : null;
    if (id) seen.add(id);
    return { id, clip: v.clip, t: num(v.t, 0, 3600, 0), gain: num(v.gain, -40, 12, 0), name: clean(v.name, 80) };
  });
  for (const v of a.voice) if (!v.id) { let k = 1; while (seen.has(`v${k}`)) k++; v.id = `v${k}`; seen.add(v.id); }
  a.duck = num(raw.duck, 0, 30, 12);
  a.target = TARGETS[raw.target] ? raw.target : 'web';
  return a;
}
/** Vrai si la bande-son ne produit aucun son. */
export const isSilent = a => !a || (!a.music && !a.sfx.wire && !a.sfx.done && !a.voice.length);

/** Instants des effets : début de chaque extrait de fils, et « circuit câblé ». tl : timeline (video/timeline.js). */
export function sfxEvents(a, tl, doneAt) {
  const out = [];
  if (!a || !tl) return out;
  if (a.sfx.wire) for (const c of tl.wires) out.push({ id: a.sfx.wire, t: c.t });
  if (a.sfx.done && tl.wires.length) out.push({ id: a.sfx.done, t: doneAt(tl) });
  return out;
}

const db = g => Math.pow(10, g / 20);
/** Passe-haut 80 Hz (Butterworth, 2e ordre) : enlève le grondement et les chocs du micro, comme en studio. */
export function highpass(x, fs, fc = 80) {
  const K = Math.tan(Math.PI * fc / fs), q = Math.SQRT1_2, d = 1 + K / q + K * K;
  const b0 = 1 / d, b1 = -2 / d, b2 = 1 / d, a1 = 2 * (K * K - 1) / d, a2 = (1 - K / q + K * K) / d;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < x.length; n++) { const v = b0 * x[n] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[n]; y2 = y1; y1 = v; y[n] = v; }
  return y;
}

/**
 * Gain de la musique (linéaire) à chaque échantillon : fondus d'entrée et de sortie, et baisse de `duck` dB pendant
 * les voix (anticipée de 0,25 s, relâchée en 0,6 s, en courbe douce).
 */
export function musicEnvelope(len, fs, m, voices, duckDb) {
  const g = new Float32Array(len).fill(1), T = len / fs;
  const fi = m.fadeIn * fs, fo = m.fadeOut * fs;
  for (let n = 0; n < len; n++) {
    let k = 1;
    if (fi > 0 && n < fi) k *= Math.sin((n / fi) * Math.PI / 2) ** 2;
    if (fo > 0 && n > len - fo) k *= Math.sin(((len - n) / fo) * Math.PI / 2) ** 2;
    g[n] = k;
  }
  if (duckDb > 0 && voices.length) {
    const low = db(-duckDb), pre = 0.25, rel = 0.6, smooth = u => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
    for (let n = 0; n < len; n++) {
      const t = n / fs; let depth = 0;
      for (const v of voices) {
        if (t < v.t - pre || t > v.t + v.dur + rel) continue;
        const u = t < v.t ? smooth((t - (v.t - pre)) / pre) : t > v.t + v.dur ? 1 - smooth((t - v.t - v.dur) / rel) : 1;
        if (u > depth) depth = u;
      }
      if (depth > 0) g[n] *= 1 - depth * (1 - low);
    }
    void T;
  }
  return g;
}

/**
 * Mixe la bande-son sur `len` échantillons stéréo à `fs`.
 * src : { music: [L, R] | null, clips: Map(id → [L, R] ou [mono]), sfx(id) → mono } ; events : sfxEvents(…).
 * Rend [L, R] (Float32Array), avant normalisation.
 */
export function mix(a, src, events, len, fs = FS) {
  const L = new Float32Array(len), R = new Float32Array(len);
  const add = (ch, at, gain) => {
    const l = ch[0], r = ch[1] || ch[0], start = Math.round(at * fs);
    for (let i = Math.max(0, -start); i < l.length && start + i < len; i++) { L[start + i] += l[i] * gain; R[start + i] += r[i] * gain; }
  };
  const voices = [];
  for (const v of a.voice) {
    const ch = src.clips.get(v.clip); if (!ch) continue;
    const hp = ch.map(c => highpass(c, fs));
    voices.push({ t: v.t, dur: hp[0].length / fs });
    add(hp, v.t, db(v.gain));
  }
  if (a.music && src.music) {
    const [ml, mr = ml] = src.music, env = musicEnvelope(len, fs, a.music, voices, a.duck), k = db(a.music.gain);
    const off = Math.round(a.music.start * fs), n0 = ml.length;
    for (let n = 0; n < len; n++) {
      let i = off + n;
      if (i >= n0) { if (!a.music.loop || n0 === 0) break; i %= n0; }
      const g = env[n] * k; L[n] += ml[i] * g; R[n] += mr[i] * g;
    }
  }
  const sg = db(a.sfx.gain);
  for (const e of events) { const x = src.sfx(e.id); if (x) add([x], e.t, sg); }
  return [L, R];
}

/** WAV PCM 24 bits (pour le master ProRes/DNxHR : audio non compressé, comme en diffusion). */
export function wav24(channels, fs) {
  const n = channels[0].length, ch = channels.length, data = n * ch * 3, buf = new ArrayBuffer(44 + data), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, fs, true); v.setUint32(28, fs * ch * 3, true); v.setUint16(32, ch * 3, true); v.setUint16(34, 24, true);
  str(36, 'data'); v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, channels[c][i])), q = Math.round(s < 0 ? s * 8388608 : s * 8388607);
    v.setUint8(o, q & 255); v.setUint8(o + 1, (q >> 8) & 255); v.setUint8(o + 2, (q >> 16) & 255); o += 3;
  }
  return new Uint8Array(buf);
}
