// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Sons de la simulation : buzzer, haut-parleur (tone) et déclic des relais.
// Un oscillateur par composant qui sonne ; le volume reste bas.
let ctx = null, muted = false;
const voices = new Map();
try { muted = localStorage.getItem('jollof-mute') === '1'; } catch (e) { /* stockage indisponible */ }

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('jollof-mute', m ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
  if (m) stopAll();
}
/** À appeler depuis un geste de l'utilisateur (clic sur Simuler) : le navigateur l'exige. */
export function unlock() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { ctx = null; }
}
export function tone(id, freq, kind = 'square', vol = 0.035) {
  if (muted || !ctx || !(freq > 0)) { silence(id); return; }
  let v = voices.get(id);
  if (!v) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = kind; g.gain.value = 0; o.connect(g).connect(ctx.destination); o.start();
    v = { o, g, f: 0, on: false }; voices.set(id, v);
  }
  const t = ctx.currentTime;
  if (v.f !== freq) { v.o.frequency.setTargetAtTime(Math.min(freq, 12000), t, 0.004); v.f = freq; }
  if (!v.on) { v.g.gain.setTargetAtTime(vol, t, 0.004); v.on = true; }
}
export function silence(id) {
  const v = voices.get(id);
  if (v && v.on && ctx) { v.g.gain.setTargetAtTime(0, ctx.currentTime, 0.006); v.on = false; }
}
export function stopAll() {
  voices.forEach(v => { try { v.o.stop(); v.o.disconnect(); v.g.disconnect(); } catch (e) { /* déjà arrêté */ } });
  voices.clear();
}
/** Déclic bref d'un relais qui colle ou décolle. */
export function click() {
  if (muted || !ctx) return;
  const n = Math.floor(ctx.sampleRate * 0.012), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  const s = ctx.createBufferSource(), g = ctx.createGain();
  g.gain.value = 0.25; s.buffer = b; s.connect(g).connect(ctx.destination); s.start();
}
