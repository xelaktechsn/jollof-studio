// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vignettes 3D de la bibliothèque : chaque composant est rendu une fois dans un petit
// canevas hors écran, puis gardé en mémoire et dans le stockage local (par mode de rendu).
import * as THREE from 'three';
import { BY_ID } from './catalog.js';
import { Q } from '../quality.js';

const SIZE = 96, VERSION = 'v1';
let ctx = null;
function setup() {
  if (ctx) return ctx;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, alpha: true, preserveDrawingBuffer: true, precision: Q.precision });
  renderer.setSize(SIZE, SIZE, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8ee, 0x1a1f24, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(60, 140, 90); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 3000);
  return (ctx = { renderer, scene, camera, canvas });
}
const store = mode => { try { return JSON.parse(localStorage.getItem(`jollof-thumbs-${VERSION}-${mode}`) || '{}'); } catch (e) { return {}; } };
const memo = { simple: null, real: null };

/**
 * Vignette du composant `id` ; mode = 'real' ou 'simple'. Les composants de la bibliothèque ont
 * des vignettes livrées toutes faites (public/thumbs, scripts/thumbs) : aucun rendu au démarrage,
 * même au premier lancement sur un vieux PC. Les autres sont calculées puis gardées.
 */
export function thumbnail(id, mode) {
  if (BY_ID[id] && !BY_ID[id].custom) return `thumbs/${mode}/${id}.webp`;
  return renderThumbnail(id, mode);
}
/** Rendu d'une vignette (data URL), gardée en mémoire et dans le stockage local. */
export function renderThumbnail(id, mode) {
  memo[mode] = memo[mode] || store(mode);
  if (memo[mode][id]) return memo[mode][id];
  const { renderer, scene, camera, canvas } = setup();
  const g = new THREE.Group();
  BY_ID[id].build({ g, pin: () => {} });
  const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  g.position.sub(c); scene.add(g);
  const fit = Math.hypot(size.x, size.y, size.z) / 2 / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0.5, 0.8, 1).normalize().multiplyScalar(fit * 0.9); camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/webp', 0.85);
  scene.remove(g);
  g.traverse(o => { if (o.isMesh && o.geometry.type !== 'BoxGeometry') o.geometry.dispose(); if (o.isMesh && o.material.map) { o.material.map.dispose(); o.material.dispose(); } });
  memo[mode][id] = url;
  try { localStorage.setItem(`jollof-thumbs-${VERSION}-${mode}`, JSON.stringify(memo[mode])); } catch (e) { /* stockage plein : gardé en mémoire */ }
  return url;
}
/** Libère le contexte WebGL des vignettes une fois le lot rendu (les vieux PC en ont peu, et chacun coûte de la mémoire). */
function release() {
  if (!ctx) return;
  ctx.renderer.dispose(); ctx.renderer.forceContextLoss(); ctx = null;
}
/** Remplit progressivement les <img data-th> de `root`, sans bloquer l'interface. */
export function fillThumbnails(root, mode) {
  const imgs = [...root.querySelectorAll('img[data-th]')].filter(i => !i.src);
  let i = 0;
  const step = () => {
    const t = performance.now();
    while (i < imgs.length && performance.now() - t < 12) {
      const img = imgs[i++]; if (!img.isConnected) continue;
      img.onerror = () => { img.onerror = null; img.src = renderThumbnail(img.dataset.th, mode); }; // vignette livrée absente : on la calcule
      img.src = thumbnail(img.dataset.th, mode);
    }
    if (i < imgs.length) setTimeout(step, 16);
    else release();
  };
  step();
}
