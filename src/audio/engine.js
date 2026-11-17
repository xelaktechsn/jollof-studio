// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Côté navigateur de la bande-son : décodage des fichiers (Web Audio, tout ramené à 48 kHz), mixage et
// normalisation (mix.js, loudness.js), écoute synchronisée avec l'animation, et enregistrement de la voix off.
import { FS, mix, sfxEvents, isSilent } from './mix.js';
import { synth } from './sfx.js';
import { normalize, TARGETS } from './loudness.js';
import { musicUrl } from './library.js';

const decoded = new Map(); // clé → Promise<[L, R?]>
async function decode(bytes) {
  const ctx = new OfflineAudioContext(2, 1, FS);
  const b = await ctx.decodeAudioData(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
  return Array.from({ length: Math.min(2, b.numberOfChannels) }, (_, i) => b.getChannelData(i).slice());
}
export const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
export async function blobToB64(blob) {
  const u = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
function load(key, get) { if (!decoded.has(key)) decoded.set(key, get().then(decode).catch(e => { decoded.delete(key); throw e; })); return decoded.get(key); }
const libraryTrack = (id, base) => load(`lib:${id}`, async () => { const r = await fetch(musicUrl(id, base)); if (!r.ok) throw new Error(`${id} : ${r.status}`); return new Uint8Array(await r.arrayBuffer()); });
const clipTrack = (id, c) => load(`clip:${id}:${c.b64.length}:${c.b64.slice(-16)}`, async () => b64ToBytes(c.b64));
/** Durée d'un clip en secondes (pour la liste des voix). */
export async function clipDuration(id, c) { return (await clipTrack(id, c))[0].length / FS; }

let cache = { key: '', result: null };
/**
 * Bande-son complète et normalisée sur `seconds` secondes. tl : timeline ; doneAt : video/timeline.js doneAt.
 * Rend null si elle est muette, sinon { channels: [L, R], fs, stats } (stats : sonie avant/après, crête vraie).
 */
export async function buildSoundtrack(a, tl, doneAt, seconds, base = '/') {
  if (isSilent(a)) return null;
  const len = Math.max(1, Math.round(seconds * FS));
  const key = JSON.stringify([a.music, a.sfx, a.voice, a.duck, a.target, Object.entries(a.clips).map(([k, c]) => [k, c.b64.length]), tl.wires.map(c => c.t), doneAt(tl), len]);
  if (cache.key === key) return cache.result;
  const clips = new Map();
  for (const v of a.voice) if (a.clips[v.clip] && !clips.has(v.clip)) clips.set(v.clip, await clipTrack(v.clip, a.clips[v.clip]));
  let music = null;
  if (a.music) music = a.music.id ? await libraryTrack(a.music.id, base) : a.clips[a.music.clip] ? await clipTrack(a.music.clip, a.clips[a.music.clip]) : null;
  const channels = mix(a, { music, clips, sfx: id => synth(id, FS) }, sfxEvents(a, tl, doneAt), len, FS);
  const stats = normalize(channels, FS, TARGETS[a.target] || TARGETS.web);
  cache = { key, result: { channels, fs: FS, stats } };
  return cache.result;
}

/** AudioBuffer (pour Mediabunny) d'un morceau [from, to[ de la bande-son, en échantillons. */
export function toAudioBuffer(track, from = 0, to = track.channels[0].length) {
  const n = Math.max(1, to - from), b = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: track.fs });
  track.channels.forEach((c, i) => b.copyToChannel(c.subarray(from, from + n), i));
  return b;
}

/* ---------- Écoute pendant l'animation ---------- */
let ctx = null, node = null;
const audioCtx = () => (ctx = ctx || new AudioContext({ sampleRate: FS, latencyHint: 'interactive' }));
/** Joue la bande-son à partir de T secondes (remplace la lecture en cours). */
export function play(track, T) {
  stop();
  if (!track) return;
  const c = audioCtx(); if (c.state === 'suspended') c.resume();
  const src = c.createBufferSource(); src.buffer = toAudioBuffer(track); src.connect(c.destination);
  src.start(0, Math.max(0, Math.min(T, src.buffer.duration)));
  node = src;
}
export function stop() { if (node) { try { node.stop(); } catch (e) { /* déjà arrêté */ } node.disconnect(); node = null; } }
/** Écoute d'un effet ou d'un fichier seul (aperçu dans le panneau). */
export async function preview(kind, id, a, base = '/') {
  stop();
  const ch = kind === 'sfx' ? [synth(id, FS)] : kind === 'music' ? await libraryTrack(id, base) : await clipTrack(id, a.clips[id]);
  const len = kind === 'music' ? Math.min(ch[0].length, FS * 12) : ch[0].length;
  play({ channels: [ch[0].subarray(0, len), (ch[1] || ch[0]).subarray(0, len)], fs: FS }, 0);
}

/* ---------- Voix off ---------- */
/**
 * Micro : rend { stop() → Promise<{ blob, mime }>, level() → 0…1, cancel() }. Réglages de prise de voix : pas
 * d'annulation d'écho ni de gain automatique (ils déforment la voix), réduction de bruit permise, mono, 48 kHz.
 */
export async function recordVoice() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) throw new Error('micro indisponible');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: FS, echoCancellation: false, autoGainControl: false, noiseSuppression: true } });
  const mime = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : {});
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const c = audioCtx(); if (c.state === 'suspended') c.resume();
  const an = c.createAnalyser(); an.fftSize = 1024; const srcNode = c.createMediaStreamSource(stream); srcNode.connect(an);
  const buf = new Float32Array(an.fftSize);
  const end = () => { stream.getTracks().forEach(t => t.stop()); srcNode.disconnect(); };
  rec.start(250);
  return {
    level() { an.getFloatTimeDomainData(buf); let p = 0; for (const v of buf) p = Math.max(p, Math.abs(v)); return p; },
    stop: () => new Promise(res => { rec.onstop = () => { end(); const type = rec.mimeType || mime || 'audio/webm'; res({ blob: new Blob(chunks, { type }), mime: type }); }; rec.stop(); }),
    cancel() { try { rec.stop(); } catch (e) { /* rien */ } end(); }
  };
}
