// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Bibliothèque audio livrée avec l'application.
//   Musiques : morceaux de FreePD.com, tous sous CC0 1.0 (domaine public : aucune attribution exigée, usage
//   commercial permis ; la licence est vérifiée sur la page d'archive du site, fermé depuis). Fichiers dans
//   public/audio/music, réencodés en MP3 128 kbit/s.
//   Effets : synthétisés par l'application (src/audio/sfx.js), donc libres eux aussi.

export const MUSIC = [
  { id: 'inspiration', title: 'Inspiration', artist: 'FreePD', mood: 'Entraînant', dur: 138 },
  { id: 'inventing-flight', title: 'Inventing Flight', artist: 'Bryan Teoh', mood: 'Entraînant', dur: 142 },
  { id: 'stereotype-news', title: 'Stereotype News', artist: 'Rafael Krux', mood: 'Entraînant', dur: 66 },
  { id: 'energizing', title: 'Energizing', artist: 'Kevin MacLeod', mood: 'Énergique', dur: 133 },
  { id: 'celebration', title: 'Celebration', artist: 'Alexander Nakarada', mood: 'Festif', dur: 143 },
  { id: 'be-chillin', title: 'Be Chillin', artist: 'Alexander Nakarada', mood: 'Détendu', dur: 203 },
  { id: 'meditating-beat', title: 'Meditating Beat', artist: 'Kevin MacLeod', mood: 'Électronique calme', dur: 157 },
  { id: 'drop-point', title: 'Drop Point', artist: 'Bryan Teoh', mood: 'Calme', dur: 184 },
  { id: 'painting-room', title: 'Painting Room', artist: 'Kevin MacLeod', mood: 'Calme (harpe)', dur: 106 },
  { id: 'river-meditation', title: 'River Meditation', artist: 'Jason Shaw', mood: 'Ambiance', dur: 167 },
  { id: 'big-eyes', title: 'Big Eyes', artist: 'FreePD', mood: 'Épique', dur: 149 }
];
export const MUSIC_LICENSE = 'CC0 1.0 — FreePD.com';
export const musicById = id => MUSIC.find(m => m.id === id) || null;
/** Chemin du fichier (servi avec l'application, dans le navigateur comme dans Tauri). */
export const musicUrl = (id, base = '/') => `${base}audio/music/${id}.mp3`;
