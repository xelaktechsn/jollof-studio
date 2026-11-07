// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Bibliothèque CAO livrée (public/cad) : modèles réels sous licence libre, chargés une fois
// au démarrage puis clonés à la demande (géométries et matières partagées entre les clones).
import * as THREE from 'three';

const CACHE = new Map();
let MANIFEST = {};
/** Rendu réaliste : les constructeurs posent les pièces CAO quand elles existent. */
export const REAL = { on: true };
try { REAL.on = localStorage.getItem('jollof-real') !== '0'; } catch (e) { /* stockage indisponible */ }
export function setRealistic(on) {
  REAL.on = on;
  try { localStorage.setItem('jollof-real', on ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
}

export async function loadCadLibrary(base = 'cad/') {
  try { MANIFEST = await (await fetch(base + 'models.json')).json(); } catch (e) { MANIFEST = {}; return 0; }
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js'); // chargé seulement pour le rendu réaliste
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(MANIFEST).map(([id, m]) => new Promise(done => loader.load(base + m.file, g => {
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    CACHE.set(id, g.scene); done();
  }, undefined, () => done()))));
  return CACHE.size;
}
export const cadManifest = () => MANIFEST;
export const cadAvailable = id => REAL.on && CACHE.has(id);

const boxes = new Map();
/**
 * Clone du modèle `id`, orienté (rotX, puis rotY, puis rotZ) et recalé : centré en x/z, posé sur y = 0.
 * Renvoie null si le rendu réaliste est coupé ou si le modèle manque.
 */
export function cadModel(id, rotX = 0, rotY = 0, rotZ = 0) {
  if (!cadAvailable(id)) return null;
  const inner = CACHE.get(id).clone(true);
  inner.rotation.set(rotX, rotY, rotZ, 'ZYX'); // X d'abord, puis Y, puis Z (repère de la scène)
  const key = `${id}|${rotX}|${rotY}|${rotZ}`;
  if (!boxes.has(key)) { inner.updateMatrixWorld(true); boxes.set(key, new THREE.Box3().setFromObject(inner)); }
  const b = boxes.get(key), wrap = new THREE.Group();
  inner.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  wrap.add(inner);
  wrap.userData.size = b.getSize(new THREE.Vector3());
  return wrap;
}
/** Matière principale (la plus colorée) d'un modèle, clonée pour pouvoir l'éclairer seule (LED). */
export function ownMaterial(group) {
  let best = null, score = -1;
  group.traverse(o => {
    if (!o.isMesh) return;
    const c = o.material.color, s = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) + (o.material.metalness < 0.5 ? 0.2 : 0);
    if (s > score) { score = s; best = o; }
  });
  if (!best) return null;
  const m = best.material.clone();
  group.traverse(o => { if (o.isMesh && o.material === best.material) o.material = m; });
  return m;
}
