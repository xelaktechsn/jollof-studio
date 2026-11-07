// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Profil graphique. « Léger » pour les ordinateurs modestes (vieux PC de salle informatique,
// carte graphique intégrée ancienne, rendu logiciel) : pas d'ombres ni d'anticrénelage,
// matières simples (Lambert), pas de lampes de LED, 30 images/s au plus, pièces CAO
// simplifiées et chargées seulement si on les demande. « Standard » sinon. Choix automatique,
// modifiable par l'utilisateur (Réglages) ; il s'applique au prochain démarrage.
import * as THREE from 'three';

const KEY = 'jollof-quality';

/** Carte graphique vue par WebGL (nom, WebGL 2). */
function probe() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { gl: false, renderer: '', webgl2: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '');
    const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return { gl: true, renderer, webgl2 };
  } catch (e) { return { gl: false, renderer: '', webgl2: false }; }
}
// La détection crée un contexte WebGL (coûteux sur une petite carte graphique) : son résultat est
// gardé, et elle n'a lieu qu'au premier lancement.
function cachedProbe() {
  try { const c = JSON.parse(localStorage.getItem('jollof-gpu') || 'null'); if (c && typeof c.renderer === 'string') return c; } catch (e) { /* refaite */ }
  const g = probe();
  try { if (g.gl) localStorage.setItem('jollof-gpu', JSON.stringify(g)); } catch (e) { /* stockage indisponible */ }
  return g;
}
export const GPU = typeof document === 'undefined' ? { gl: true, renderer: '', webgl2: true } : cachedProbe();

// Rendu logiciel, anciennes puces Intel (GMA, HD 2000 à 5xxx), puces mobiles et embarquées modestes.
const WEAK = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|\bgma\b|intel\(r\) (hd|q|g)\d|intel\(r\) hd graphics( [2-5]\d{2,3})?(?!\d)|ironlake|sandybridge|ivybridge|haswell|mali-(4|t[0-8])|adreno \(tm\) [2-5]\d\d|powervr|vivante|videocore/i;

/** Niveau conseillé pour cet ordinateur. */
export function autoLevel() {
  if (typeof navigator === 'undefined') return 'standard';
  const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency;
  if (!GPU.gl || !GPU.webgl2 || WEAK.test(GPU.renderer)) return 'light';
  if ((mem && mem <= 2) || (cores && cores <= 2)) return 'light';
  return 'standard';
}
let stored = null;
try { stored = localStorage.getItem(KEY); } catch (e) { stored = null; }
/** Choix de l'utilisateur : auto, light, standard. */
export const CHOICE = stored === 'light' || stored === 'standard' ? stored : 'auto';
export const LEVEL = CHOICE === 'auto' ? autoLevel() : CHOICE;
export const LIGHT = LEVEL === 'light';
export function setQuality(choice) { try { choice === 'auto' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, choice); } catch (e) { /* stockage indisponible */ } }

/** Réglages du rendu pour le niveau retenu. */
export const Q = LIGHT
  ? { antialias: false, pixelRatio: 1, precision: 'mediump', shadows: false, lamps: 0, fog: false, fps: 30, simFps: 20, wireRadial: 5, wireDiv: 0.55, aniso: 1, cad: false }
  : { antialias: true, pixelRatio: Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 1.5), precision: 'highp', shadows: true, lamps: 4, fog: true, fps: 60, simFps: 60, wireRadial: 8, wireDiv: 1, aniso: 8, cad: true };

// Propriétés propres aux matières physiques : ignorées par Lambert.
const PBR = ['metalness', 'roughness', 'metalnessMap', 'roughnessMap', 'envMapIntensity', 'clearcoat', 'clearcoatRoughness', 'sheen', 'transmission', 'ior', 'thickness'];
/** Matière « standard » : physique (PBR) en standard, Lambert (bien moins coûteuse) en léger. */
export function stdMat(p = {}) {
  if (!LIGHT) return new THREE.MeshStandardMaterial(p);
  const q = { ...p }; PBR.forEach(k => delete q[k]);
  return new THREE.MeshLambertMaterial(q);
}
