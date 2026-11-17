// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Sonie selon UIT-R BS.1770-4 (base d'UER R 128, ATSC A/85 et des plateformes : YouTube, Spotify…), module pur.
//   - pondération K (deux biquads : plateau aigu puis passe-haut « RLB »), recalculée pour toute fréquence ;
//   - blocs de 400 ms avec recouvrement de 75 %, porte absolue −70 LUFS puis porte relative −10 LU ;
//   - crête vraie (dBTP) par suréchantillonnage ×4 (filtre sinc fenêtré), comme l'annexe 2 ;
//   - normalisation vers une cible, puis limiteur à anticipation pour ne jamais dépasser le plafond de crête.
// Les canaux sont des Float32Array (gauche, droite… ; le poids 1,0 vaut pour L, R et C).

/** Cibles : sonie intégrée (LUFS) et crête vraie maximale (dBTP). */
export const TARGETS = {
  web: { lufs: -14, peak: -1 }, // YouTube, Spotify, plateformes de diffusion en ligne
  ebu: { lufs: -23, peak: -1 }, // UER R 128 (télévision européenne, africaine…)
  atsc: { lufs: -24, peak: -2 } // ATSC A/85 (télévision nord-américaine)
};

function kFilters(fs) {
  // Coefficients généraux de la pondération K (mêmes valeurs que libebur128 ; à 48 kHz, ceux de la norme).
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K;
  const s1 = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs);
  const d = 1 + K / Q + K * K;
  const s2 = { b: [1, -2, 1], a: [2 * (K * K - 1) / d, (1 - K / Q + K * K) / d] };
  return [s1, s2];
}
function biquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < x.length; n++) {
    const v = b[0] * x[n] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[n]; y2 = y1; y1 = v; y[n] = v;
  }
  return y;
}

/** Sonie intégrée en LUFS (−Infinity pour un silence). */
export function integratedLoudness(channels, fs) {
  const [s1, s2] = kFilters(fs);
  const weighted = channels.map(c => biquad(biquad(c, s1), s2));
  const len = channels[0].length, block = Math.round(0.4 * fs), step = Math.round(0.1 * fs);
  if (len < block) return -Infinity;
  // Sommes cumulées des carrés : chaque bloc se calcule en temps constant.
  const cum = weighted.map(w => { const c = new Float64Array(len + 1); for (let i = 0; i < len; i++) c[i + 1] = c[i] + w[i] * w[i]; return c; });
  const z = [];
  for (let s = 0; s + block <= len; s += step) { let sum = 0; for (const c of cum) sum += (c[s + block] - c[s]) / block; z.push(sum); }
  const L = v => -0.691 + 10 * Math.log10(v);
  const abs = z.filter(v => L(v) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter(v => L(v) > rel);
  return L(gated.reduce((a, b) => a + b, 0) / gated.length);
}

// Interpolation ×4 : sinc fenêtré (Hann), 12 échantillons par phase.
const TAPS = 12, PHASES = 4;
const FIR = (() => {
  const h = [];
  for (let p = 1; p < PHASES; p++) {
    const row = [];
    for (let k = 0; k < TAPS; k++) {
      const t = k - TAPS / 2 + 1 - p / PHASES, x = Math.PI * t;
      const w = 0.5 * (1 + Math.cos(Math.PI * t / (TAPS / 2)));
      row.push((t === 0 ? 1 : Math.sin(x) / x) * w);
    }
    h.push(row);
  }
  return h;
})();
/** Crête vraie en dBTP (suréchantillonnage ×4). */
export function truePeak(channels) {
  let peak = 0;
  for (const c of channels) {
    for (let n = 0; n < c.length; n++) {
      const v = Math.abs(c[n]); if (v > peak) peak = v;
      if (n < TAPS / 2 - 1 || n + TAPS / 2 >= c.length) continue;
      for (const row of FIR) {
        let s = 0; for (let k = 0; k < TAPS; k++) s += row[k] * c[n + k - TAPS / 2 + 1];
        const a = Math.abs(s); if (a > peak) peak = a;
      }
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/**
 * Limiteur à anticipation (en place) : le gain baisse avant chaque crête qui dépasserait `ceilDb` (dBFS, sur les
 * échantillons), et remonte doucement. lookahead et release en secondes.
 */
export function limit(channels, fs, ceilDb, lookahead = 0.005, release = 0.08) {
  const len = channels[0].length, thr = Math.pow(10, ceilDb / 20), need = new Float32Array(len);
  for (let n = 0; n < len; n++) { let p = 0; for (const c of channels) { const a = Math.abs(c[n]); if (a > p) p = a; } need[n] = p > thr ? thr / p : 1; }
  // Minimum glissant sur la fenêtre d'anticipation (file monotone), puis remontée exponentielle.
  const L = Math.max(1, Math.round(lookahead * fs)), gmin = new Float32Array(len), q = [];
  for (let n = len - 1; n >= 0; n--) {
    while (q.length && need[q[q.length - 1]] >= need[n]) q.pop();
    q.push(n);
    while (q[0] > n + L) q.shift();
    gmin[n] = need[q[0]];
  }
  const up = 1 - Math.exp(-1 / (release * fs));
  let g = 1, touched = false;
  for (let n = 0; n < len; n++) {
    g = Math.min(gmin[n], g + (1 - g) * up);
    if (g < 1) { touched = true; for (const c of channels) c[n] *= g; }
  }
  return touched;
}

/**
 * Normalise vers une cible (TARGETS) : gain pour atteindre la sonie voulue, puis limiteur si la crête vraie dépasse.
 * Rend { before, after, peak, gainDb, limited } (LUFS, dBTP, dB).
 */
export function normalize(channels, fs, target = TARGETS.web) {
  const before = integratedLoudness(channels, fs);
  if (!Number.isFinite(before)) return { before, after: before, peak: -Infinity, gainDb: 0, limited: false };
  let now = before, gainDb = 0, limited = false;
  // Gain, puis limiteur ; le limiteur baisse un peu la sonie : on recommence (au plus 5 fois) jusqu'à la cible.
  for (let pass = 0; pass < 5; pass++) {
    const g = target.lufs - now;
    if (pass > 0 && Math.abs(g) < 0.1) break;
    const k = Math.pow(10, g / 20); gainDb += g;
    for (const c of channels) for (let n = 0; n < c.length; n++) c[n] *= k;
    // Plafond sous la cible : la crête vraie (entre les échantillons) dépasse la crête des échantillons.
    for (let t = 0; t < 3 && truePeak(channels) > target.peak; t++) limited = limit(channels, fs, target.peak - 0.5 - t * 0.5) || limited;
    now = integratedLoudness(channels, fs);
  }
  return { before, after: now, peak: truePeak(channels), gainDb, limited };
}
