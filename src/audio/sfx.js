// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Effets sonores synthétisés (module pur) : aucun fichier, aucune licence à suivre, toujours identiques (bruit tiré
// d'un générateur à graine). Chaque effet rend un Float32Array mono à la fréquence demandée, crête ≤ 0,5.

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; }; }
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
function lowpass(x, fs, fc) { const k = 1 - Math.exp(-2 * Math.PI * fc / fs); let y = 0; for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] = y; } return x; }
function finish(x, peak = 0.5) {
  let m = 0; for (const v of x) m = Math.max(m, Math.abs(v));
  const g = m > 0 ? peak / m : 0;
  const fade = Math.min(x.length, 64);
  for (let i = 0; i < x.length; i++) x[i] *= g * (i >= x.length - fade ? (x.length - i) / fade : 1);
  return x;
}
const buf = (fs, sec) => new Float32Array(Math.max(1, Math.round(fs * sec)));

const SYNTH = {
  /** Clic net (fil posé). */
  click(fs) { const x = buf(fs, 0.05), r = rng(7); for (let i = 0; i < x.length; i++) { const t = i / fs; x[i] = (0.6 * Math.sin(2 * Math.PI * 2200 * t) + 0.4 * r()) * env(t, 0.001, 0.008); } return finish(lowpass(x, fs, 6000)); },
  /** « Pop » doux, hauteur qui descend. */
  pop(fs) { const x = buf(fs, 0.12); let ph = 0; for (let i = 0; i < x.length; i++) { const t = i / fs, f = 200 + 600 * Math.exp(-t / 0.02); ph += 2 * Math.PI * f / fs; x[i] = Math.sin(ph) * env(t, 0.002, 0.03); } return finish(x); },
  /** Souffle qui passe (transition). */
  whoosh(fs) {
    const x = buf(fs, 0.6), r = rng(11); let lp = 0, bp = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / fs, u = t / 0.6, fc = 300 + 2700 * Math.sin(Math.PI * u), k = 1 - Math.exp(-2 * Math.PI * fc / fs);
      lp += k * (r() - lp); bp += k * (lp - bp); x[i] = (lp - bp) * Math.sin(Math.PI * u) ** 2;
    }
    return finish(x);
  },
  /** Carillon (circuit câblé). */
  chime(fs) {
    const x = buf(fs, 1.6), parts = [[880, 1, 0.9], [1760, 0.5, 0.6], [2640, 0.3, 0.35], [3520, 0.15, 0.25], [1318.5, 0.4, 0.8]];
    for (let i = 0; i < x.length; i++) { const t = i / fs; let s = 0; for (const [f, a, d] of parts) s += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / d); x[i] = s * Math.min(1, t / 0.003); }
    return finish(x);
  },
  /** Réussite : arpège do-mi-sol-do. */
  success(fs) {
    const notes = [523.25, 659.25, 783.99, 1046.5], x = buf(fs, 1.1);
    notes.forEach((f, k) => { const t0 = k * 0.09; for (let i = Math.round(t0 * fs); i < x.length; i++) { const t = i / fs - t0; x[i] += (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * env(t, 0.006, 0.25); } });
    return finish(x);
  },
  /** Petit « tic » (pas à pas). */
  tick(fs) { const x = buf(fs, 0.03); for (let i = 0; i < x.length; i++) { const t = i / fs; x[i] = Math.sin(2 * Math.PI * 4000 * t) * env(t, 0.0005, 0.004); } return finish(x, 0.35); },
  /** Mise sous tension : montée avec léger trémolo. */
  powerup(fs) { const x = buf(fs, 0.7); let ph = 0; for (let i = 0; i < x.length; i++) { const t = i / fs, f = 180 * Math.pow(5, t / 0.7); ph += 2 * Math.PI * f / fs; x[i] = Math.sin(ph) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 18 * t)) * Math.min(1, t / 0.02) * Math.min(1, (0.7 - t) / 0.08); } return finish(x); },
  /** Étincelle électrique (court-circuit, erreur). */
  zap(fs) { const x = buf(fs, 0.25), r = rng(23); let ph = 0; for (let i = 0; i < x.length; i++) { const t = i / fs, f = 120 + 900 * Math.exp(-t / 0.05); ph += f / fs; x[i] = (2 * (ph % 1) - 1) * 0.6 * env(t, 0.001, 0.06) + 0.4 * r() * env(t, 0.0005, 0.02); } return finish(lowpass(x, fs, 5000)); }
};

/** Effets proposés : identifiant → nom affiché (traduit par l'interface). */
export const SFX = [
  { id: 'click', name: 'Clic' }, { id: 'pop', name: 'Pop' }, { id: 'tick', name: 'Tic' }, { id: 'whoosh', name: 'Souffle' },
  { id: 'chime', name: 'Carillon' }, { id: 'success', name: 'Réussite' }, { id: 'powerup', name: 'Mise sous tension' }, { id: 'zap', name: 'Étincelle' }
];
const cache = new Map();
/** Échantillons d'un effet (mono, crête 0,5), mis en cache par fréquence. null si l'effet n'existe pas. */
export function synth(id, fs) {
  if (!SYNTH[id]) return null;
  const k = `${id}@${fs}`;
  if (!cache.has(k)) cache.set(k, SYNTH[id](fs));
  return cache.get(k);
}
