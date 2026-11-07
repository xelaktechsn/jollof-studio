// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Import d'un modèle CAO fourni par l'utilisateur : STEP (.step, .stp) ou glTF (.glb, .gltf).
// Le modèle est remis en millimètres, Y vers le haut, centré et posé sur le plan de travail,
// puis réenregistré en GLB : c'est ce GLB normalisé que gardent le projet et la bibliothèque.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { tl } from '../i18n/index.js';
import { stdMat } from '../quality.js';

let occtReady = null;
/** Lecteur STEP (OpenCascade compilé en WebAssembly, ~7 Mo) : chargé seulement au premier import. */
function occt() {
  if (!occtReady) occtReady = (async () => {
    const [{ default: init }, { default: wasmUrl }] = await Promise.all([import('occt-import-js'), import('occt-import-js/dist/occt-import-js.wasm?url')]);
    return init({ locateFile: () => wasmUrl });
  })();
  return occtReady;
}

/** STEP → groupe three.js (Z vers le haut dans le fichier → Y vers le haut), couleurs par face conservées. */
async function fromStep(buffer) {
  const lib = await occt();
  const r = lib.ReadStepFile(new Uint8Array(buffer), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0015, angularDeflection: 0.4 });
  if (!r.success || !r.meshes.length) throw new Error(tl('fichier STEP illisible'));
  const group = new THREE.Group(), mats = new Map();
  const matFor = c => {
    const key = c.map(v => v.toFixed(3)).join(',');
    if (!mats.has(key)) {
      const [x, y, z] = c, grey = Math.abs(x - y) < 0.06 && Math.abs(y - z) < 0.06, metal = grey && (x + y + z) / 3 > 0.55;
      mats.set(key, stdMat({ color: new THREE.Color().setRGB(x, y, z, THREE.SRGBColorSpace), metalness: metal ? 0.75 : 0, roughness: metal ? 0.35 : 0.6, side: THREE.DoubleSide }));
    }
    return mats.get(key);
  };
  for (const m of r.meshes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
    if (m.attributes.normal) geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
    geo.setIndex(Array.from(m.index.array));
    const faces = m.brep_faces && m.brep_faces.length ? m.brep_faces : [{ first: 0, last: m.index.array.length / 3 - 1, color: null }];
    const list = [];
    faces.forEach(f => { geo.addGroup(f.first * 3, (f.last - f.first + 1) * 3, list.length); list.push(matFor(f.color || m.color || [0.62, 0.62, 0.62])); });
    if (!m.attributes.normal) geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, list));
  }
  group.rotation.x = -Math.PI / 2;
  const wrap = new THREE.Group(); wrap.add(group);
  return wrap;
}
/** glTF : l'unité du format est le mètre ; un modèle déjà en millimètres est laissé tel quel. */
function fromGltf(buffer) {
  return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', g => {
    const s = g.scene, size = new THREE.Box3().setFromObject(s).getSize(new THREE.Vector3()), max = Math.max(size.x, size.y, size.z);
    if (max > 0 && max < 2) s.scale.multiplyScalar(1000);
    const wrap = new THREE.Group(); wrap.add(s); resolve(wrap);
  }, reject));
}
/** Centre en x/z et pose sur y = 0 (après les rotations voulues). */
export function normalize(root) {
  root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(root), c = b.getCenter(new THREE.Vector3());
  const holder = new THREE.Group(); holder.add(root);
  root.position.x -= c.x; root.position.z -= c.z; root.position.y -= b.min.y;
  holder.updateMatrixWorld(true);
  return holder;
}
/** Groupe three.js → GLB (ArrayBuffer). */
export function toGlb(root) {
  return new Promise((resolve, reject) => new GLTFExporter().parse(root, resolve, reject, { binary: true }));
}

/**
 * Lit un fichier choisi par l'utilisateur. Retourne { glb (ArrayBuffer normalisé), size (mm), name }.
 * onStep(message) signale les étapes longues (chargement du lecteur STEP, conversion).
 */
export async function importCad(file, onStep = () => {}) {
  const ext = file.name.split('.').pop().toLowerCase(), buffer = await file.arrayBuffer();
  let root;
  if (ext === 'step' || ext === 'stp') { onStep(tl('Lecture du STEP (premier import : chargement du lecteur, quelques secondes)…')); root = await fromStep(buffer); }
  else if (ext === 'glb' || ext === 'gltf') root = await fromGltf(buffer);
  else throw new Error(tl('format non pris en charge : utilisez .step, .stp, .glb ou .gltf'));
  onStep(tl('Conversion…'));
  const holder = normalize(root);
  const size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
  if (Math.max(size.x, size.y, size.z) > 600) throw new Error(tl('modèle de {0} × {1} mm : trop grand pour une carte, vérifiez l’unité du fichier', Math.round(size.x), Math.round(size.z)));
  return { glb: await toGlb(holder), size, name: file.name.replace(/\.(step|stp|glb|gltf)$/i, '').slice(0, 32) || tl('Modèle') };
}
/** Fait pivoter un GLB normalisé d'un quart de tour autour de X (modèle couché) et le renormalise. */
export async function rotateGlb(buffer, axis = 'x') {
  const root = await new Promise((res, rej) => new GLTFLoader().parse(buffer, '', g => res(g.scene), rej));
  const wrap = new THREE.Group(); wrap.add(root); wrap.rotation[axis] = -Math.PI / 2;
  return toGlb(normalize(wrap));
}
