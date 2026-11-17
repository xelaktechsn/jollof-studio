// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Réglages de l'export vidéo selon les normes en usage : module pur (ni DOM ni WebCodecs), testé sous Node.
//
// - Codecs : H.264/AVC (UIT-T H.264, profil High), H.265/HEVC (UIT-T H.265, profil Main) et AV1 (AOMedia, libre de
//   droits). Le niveau annoncé est le plus petit qui couvre la taille d'image et le débit de macroblocs (H.264
//   tableau A-1, H.265 tableau A.8, AV1 annexe A) : un lecteur sait d'avance s'il peut lire le fichier.
// - Couleur : UIT-R BT.709 (primaires, transfert, matrice), plage limitée 16–235, comme la télévision HD et le web.
// - Cadences : 23,976 / 24 / 25 / 29,97 / 30 / 50 / 59,94 / 60 images/s (SMPTE, UER), en fractions exactes.
// - Débits : ceux que YouTube recommande pour un envoi SDR (« web »), ou 2,5 fois plus pour un original à remonter.
// - Image clé chaque seconde (GOP fermé) : saut rapide dans la vidéo, montage propre.
// - Zones de sécurité UER R 95 / SMPTE ST 2046-1 : textes dans les 90 % centraux de l'image.
// - Sous-titres : WebVTT (W3C) dans le MP4 (ISO/IEC 14496-30), et en fichiers .vtt / .srt à part.

/** Cadences proposées : valeur du menu → fraction exacte. */
export const RATES = {
  '24000/1001': [24000, 1001], 24: [24, 1], 25: [25, 1], '30000/1001': [30000, 1001], 30: [30, 1],
  50: [50, 1], '60000/1001': [60000, 1001], 60: [60, 1]
};
export function parseRate(v) { const r = RATES[String(v)] || RATES[30]; return { num: r[0], den: r[1], fps: r[0] / r[1] }; }
/** Libellé d'une cadence : 29,97, 25… */
export const rateLabel = (fps, dec = ',') => (Number.isInteger(fps) ? String(fps) : fps.toFixed(3).replace(/0+$/, '').replace('.', dec));

/** Tailles d'image normalisées (SMPTE ST 296, ST 274, UIT-R BT.2100 UHD-1). */
export const SIZES = { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] };

/** Couleur de toutes les vidéos produites : BT.709, plage limitée. */
export const BT709 = Object.freeze({ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false });

/** Débit recommandé par YouTube pour un envoi SDR en H.264, en bits/s : [≤ 30 i/s, > 30 i/s]. */
const WEB_RATE = { 720: [5e6, 7.5e6], 1080: [8e6, 12e6], 1440: [16e6, 24e6], 2160: [45e6, 68e6] };
/** À qualité égale, HEVC et AV1 ont besoin de moins de débit que H.264. */
const CODEC_GAIN = { avc: 1, hevc: 0.65, av1: 0.55 };
/** Débit le plus haut du plus haut niveau visé (H.264 5.2 High, H.265 5.2 et AV1 5.2 palier Main). */
const CODEC_MAX = { avc: 300e6, hevc: 60e6, av1: 60e6 };
export function bitrateFor(H, fps, codec = 'avc', quality = 'web') {
  const row = WEB_RATE[H] || WEB_RATE[1080];
  return Math.round(Math.min(CODEC_MAX[codec] || 60e6, row[fps > 31 ? 1 : 0] * (CODEC_GAIN[codec] || 1) * (quality === 'master' ? 2.5 : 1)));
}

// H.264 tableau A-1 : [niveau_idc, MaxMBPS, MaxFS, MaxBR (kbit/s, profil Baseline/Main ; High = × 1,25)]
const AVC_LEVELS = [[31, 108000, 3600, 14000], [32, 216000, 5120, 20000], [40, 245760, 8192, 20000], [41, 245760, 8192, 50000],
  [42, 522240, 8704, 50000], [50, 589824, 22080, 135000], [51, 983040, 36864, 240000], [52, 2073600, 36864, 240000]];
// H.265 tableau A.8 (palier Main) : [niveau × 30, MaxLumaPs, MaxLumaSr, MaxBR (kbit/s)]
const HEVC_LEVELS = [[93, 983040, 33177600, 10000], [120, 2228224, 66846720, 12000], [123, 2228224, 133693440, 20000],
  [150, 8912896, 267386880, 25000], [153, 8912896, 534773760, 40000], [156, 8912896, 1069547520, 60000]];
// AV1 annexe A (palier Main) : [seq_level_idx, MaxPicSize, MaxDisplayRate, MaxBitrate (Mbit/s)]
const AV1_LEVELS = [[5, 1065024, 77856768, 10], [8, 2228224, 133693440, 12], [9, 2228224, 267386880, 20],
  [12, 8912896, 267386880, 30], [13, 8912896, 534773760, 40], [14, 8912896, 1069547520, 60]];
const hex2 = n => n.toString(16).padStart(2, '0');

/** Plus petit niveau H.264 qui couvre l'image, la cadence et le débit (profil High). */
export function avcLevel(W, H, fps, bitrate = 0) {
  const fs = Math.ceil(W / 16) * Math.ceil(H / 16), mbps = fs * fps;
  const L = AVC_LEVELS.find(([, maxMbps, maxFs, maxBr]) => fs <= maxFs && mbps <= maxMbps && bitrate <= maxBr * 1250);
  return L ? L[0] : 52;
}
export function hevcLevel(W, H, fps, bitrate = 0) {
  const ps = W * H, sr = ps * fps;
  const L = HEVC_LEVELS.find(([, maxPs, maxSr, maxBr]) => ps <= maxPs && sr <= maxSr && bitrate <= maxBr * 1000);
  return L ? L[0] : 156;
}
export function av1Level(W, H, fps, bitrate = 0) {
  const ps = W * H, sr = ps * fps;
  const L = AV1_LEVELS.find(([, maxPs, maxSr, maxBr]) => ps <= maxPs && sr <= maxSr && bitrate <= maxBr * 1e6);
  return L ? L[0] : 14;
}

/**
 * Chaînes de codec à essayer, de la plus exacte à la plus tolérante (certains encodeurs n'acceptent qu'un niveau
 * plus haut ou un autre profil). codec : 'avc' | 'hevc' | 'av1'.
 */
export function codecStrings(codec, W, H, fps, bitrate) {
  if (codec === 'hevc') { const l = hevcLevel(W, H, fps, bitrate); return [...new Set([`hvc1.1.6.L${l}.B0`, 'hvc1.1.6.L153.B0', 'hvc1.1.6.L156.B0'])]; }
  if (codec === 'av1') { const l = av1Level(W, H, fps, bitrate); return [...new Set([`av01.0.${String(l).padStart(2, '0')}M.08`, 'av01.0.13M.08', 'av01.0.14M.08'])]; }
  const l = avcLevel(W, H, fps, bitrate);
  return [...new Set([`avc1.6400${hex2(l)}`, 'avc1.640034', `avc1.4d00${hex2(l)}`, 'avc1.4d0034', 'avc1.42003e'])];
}
/** Nom lisible d'un codec. */
export const CODEC_NAME = { avc: 'H.264', hevc: 'HEVC (H.265)', av1: 'AV1' };
/** Ordre d'essai : le codec choisi, puis H.264 (lu partout). */
export const codecOrder = want => [...new Set([want, 'avc'].filter(c => CODEC_NAME[c]))];

/* ---------- Sous-titres ---------- */

/**
 * Regroupe les légendes vues image par image ([{ t, text }], triées) en répliques { start, end, text } ; une réplique
 * dure jusqu'au changement suivant, ou jusqu'à `end`. Les légendes vides ne donnent pas de réplique.
 */
export function cuesFrom(samples, end) {
  const out = [];
  let cur = null;
  for (const s of samples) {
    const text = String(s.text || '').trim();
    if (cur && cur.text === text) continue;
    if (cur) { cur.end = s.t; if (cur.end > cur.start) out.push(cur); }
    cur = text ? { start: s.t, end, text } : null;
  }
  if (cur && end > cur.start) { cur.end = end; out.push(cur); }
  return out;
}
/** « a|b » (titre | détail, comme à l'écran) → deux lignes. */
export const capLines = c => String(c || '').split('|').map(s => s.trim()).filter(Boolean).join('\n');

const pad = (n, w = 2) => String(n).padStart(w, '0');
function stamp(t, sep) {
  const ms = Math.max(0, Math.round(t * 1000)), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}
/** WebVTT (W3C) : en-tête, langue, répliques ; « --> » et le balisage sont neutralisés. */
export function toWebVTT(cues, lang) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/-->/g, '--&gt;');
  const head = `WEBVTT${lang ? `\nLanguage: ${lang}` : ''}\n`;
  return head + cues.map((c, i) => `\n${i + 1}\n${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${esc(c.text).replace(/\n{2,}/g, '\n')}\n`).join('');
}
/** SubRip (.srt) : lu par presque tous les lecteurs et logiciels de montage. */
export function toSRT(cues) {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text.replace(/\n{2,}/g, '\n')}\n`).join('\n');
}

/** Code de langue ISO 639-2/T (trois lettres) pour les pistes, d'après la langue de l'interface. */
const ISO639_2 = { fr: 'fra', en: 'eng', wo: 'wol', ar: 'ara', es: 'spa', pt: 'por', de: 'deu', it: 'ita', zh: 'zho', sw: 'swa', ha: 'hau', yo: 'yor', ff: 'ful' };
export const iso639 = lang => ISO639_2[String(lang || '').slice(0, 2).toLowerCase()] || 'und';

/** Zone de sécurité titre (UER R 95) : marge de 5 % de chaque côté. */
export const titleSafe = (W, H) => ({ x: W * 0.05, y: H * 0.05, w: W * 0.9, h: H * 0.9 });

/** Nombre d'images d'une vidéo de `seconds` secondes. */
export const frameCount = (seconds, rate) => Math.max(1, Math.ceil(seconds * rate.num / rate.den - 1e-9));
/** Instant de l'image i, en secondes, exact pour les cadences fractionnaires. */
export const frameTime = (i, rate) => (i * rate.den) / rate.num;
