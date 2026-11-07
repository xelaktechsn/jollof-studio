// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Primitives de modélisation partagées par tous les composants de la bibliothèque.
// Unité : le millimètre. Le composant est posé sur y = 0, ses broches de
// raccordement regardent vers +z (vers la caméra par défaut).
import * as THREE from 'three';
import { cadModel } from '../cad/library.js';
import { stdMat } from '../quality.js';

export const V3 = THREE.Vector3;

/**
 * Pose une pièce CAO réelle (bibliothèque livrée) centrée sur (x, z), sa base à y.
 * Renvoie le groupe posé, ou null si le rendu réaliste est coupé ou la pièce absente :
 * le constructeur dessine alors sa version simple. Les broches restent celles du constructeur.
 */
export function cad(c, id, x, y, z, o = {}) {
  const m = cadModel(id, o.rotX || 0, o.rotY || 0, o.rotZ || 0);
  if (!m) return null;
  m.position.set(x, y, z);
  if (o.scale) m.scale.setScalar(o.scale);
  c.g.add(m);
  return m;
}
export const PITCH = 2.54;

export const M = {
  gold: stdMat({ color: 0xd4a64a, metalness: 0.85, roughness: 0.32 }),
  goldHi: stdMat({ color: 0xffd58a, emissive: 0x8a5a10, metalness: 0.5, roughness: 0.3 }),
  plastic: stdMat({ color: 0x141414, roughness: 0.75 }),
  silver: stdMat({ color: 0xb9bdc1, metalness: 0.8, roughness: 0.35 }),
  leg: stdMat({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.3 }),
  hole: new THREE.MeshBasicMaterial({ visible: false }),
  hit: new THREE.MeshBasicMaterial({ visible: false })
};

const geo = {};
export const boxGeo = (w, h, d) => geo[`b${w}_${h}_${d}`] || (geo[`b${w}_${h}_${d}`] = new THREE.BoxGeometry(w, h, d));
const mats = {};
export function mat(color, o = {}) {
  const key = `${color}_${o.m ?? 0}_${o.r ?? 0.6}_${o.o ?? 1}_${o.e ?? 0}`;
  return mats[key] || (mats[key] = stdMat({
    color, metalness: o.m ?? 0, roughness: o.r ?? 0.6,
    transparent: (o.o ?? 1) < 1, opacity: o.o ?? 1, emissive: o.e ?? 0
  }));
}
const asMat = (m, o) => (m && m.isMaterial ? m : mat(m, o));

export function add(c, geometry, material, x = 0, y = 0, z = 0, rot) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  c.g.add(m);
  return m;
}
/** Pavé posé sur `y` (y = face inférieure). */
export function block(c, w, h, d, x, y, z, color, o) {
  return add(c, boxGeo(w, h, d), asMat(color, o), x, y + h / 2, z, o && o.rot);
}
/** Cylindre. Axe y : posé sur `y`. Axes x ou z : centré sur (x, y, z). */
export function cyl(c, r, h, x, y, z, color, o = {}) {
  const g = new THREE.CylinderGeometry(o.r2 ?? r, r, h, o.seg ?? 28, 1, !!o.open);
  if ((o.axis || 'y') === 'y') return add(c, g, asMat(color, o), x, y + h / 2, z);
  return add(c, g, asMat(color, o), x, y, z, o.axis === 'x' ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]);
}
export function dome(c, r, x, y, z, color, o) {
  return add(c, new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), asMat(color, o), x, y, z);
}

export function canvasTex(wmm, lmm, k, paint) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(2, Math.round(wmm * k));
  cv.height = Math.max(2, Math.round(lmm * k));
  const x = cv.getContext('2d');
  paint(x, k, cv);
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 8;
  return t;
}
/** Surface plane texturée, vue de dessus. Dans `paint`, (0,0) = coin (-w/2, -l/2). */
export function decal(c, w, l, x, y, z, paint, k = 12, o = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l),
    stdMat({ map: canvasTex(w, l, k, paint), roughness: o.r ?? 0.55, metalness: o.m ?? 0, transparent: !!o.transparent }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  c.g.add(m);
  return m;
}
export const FONT = '"JetBrains Mono", ui-monospace, monospace';
export function text(x, k, t, px, py, size, o = {}) {
  x.save();
  x.fillStyle = o.color || '#f2f2f2';
  x.font = `${o.weight || 600} ${size * k}px ${FONT}`;
  x.textAlign = o.align || 'center';
  x.textBaseline = 'middle';
  x.translate(px * k, py * k);
  if (o.rot) x.rotate(o.rot);
  x.fillText(t, 0, 0);
  x.restore();
}

/**
 * Circuit imprimé. Les rangées de broches y ajoutent leurs pastilles et leurs
 * étiquettes de sérigraphie, puis `finish()` dessine la texture.
 */
export function board(c, w, l, color, o = {}) {
  const T = o.t ?? 1.6, ox = o.x ?? 0, oz = o.z ?? 0;
  block(c, w, T, l, ox, o.y ?? 0, oz, color, { r: 0.6 });
  const b = { T, w, l, x: ox, z: oz, top: (o.y ?? 0) + T, pads: [], labels: [] };
  b.finish = paint => decal(c, w, l, ox, b.top + 0.02, oz, (x, k, cv) => {
    x.fillStyle = color; x.fillRect(0, 0, cv.width, cv.height);
    if (o.holes !== false) {
      [[2.2, 2.2], [w - 2.2, 2.2], [2.2, l - 2.2], [w - 2.2, l - 2.2]].forEach(([a, bb]) => {
        x.fillStyle = '#c9a35a'; x.beginPath(); x.arc(a * k, bb * k, 1.4 * k, 0, 7); x.fill();
        x.fillStyle = '#0a0a0a'; x.beginPath(); x.arc(a * k, bb * k, 0.85 * k, 0, 7); x.fill();
      });
    }
    b.pads.forEach(([px, pz]) => { x.fillStyle = '#c9a35a'; x.fillRect((px - ox + w / 2 - 1) * k, (pz - oz + l / 2 - 1) * k, 2 * k, 2 * k); });
    const fs = o.labelSize ?? 1.15;
    b.labels.forEach(L => {
      const px = L.x - ox + w / 2, pz = L.z - oz + l / 2;
      if (L.dir === 'x') text(x, k, L.t, px + L.s * 1.8, pz, fs, { align: L.s > 0 ? 'left' : 'right' });
      else text(x, k, L.t, px, pz + L.s * 1.8, fs, { align: L.s > 0 ? 'right' : 'left', rot: -Math.PI / 2 });
    });
    paint && paint(x, k, cv);
  }, 12);
  return b;
}

/**
 * Rangée de broches au pas de 2,54 mm.
 * axis 'x' : rangée horizontale à la profondeur z ; axis 'z' : rangée en profondeur à l'abscisse x.
 * labels : 1 ou -1 indique de quel côté écrire l'étiquette (0 = pas d'étiquette).
 */
export function header(c, names, o) {
  const n = names.length, axis = o.axis || 'x', pitch = o.pitch ?? PITCH;
  const y = o.y ?? (o.board ? o.board.top : 0), h = o.h ?? 6.5;
  const start = o.start ?? -((n - 1) / 2) * pitch;
  names.forEach((name, i) => {
    if (name == null) return;
    const d = start + i * pitch;
    const px = axis === 'x' ? (o.x ?? 0) + d : o.x;
    const pz = axis === 'x' ? o.z : (o.z ?? 0) + d;
    if (o.female) {
      block(c, 2.54, 8.5, 2.54, px, y, pz, M.plastic);
      const mk = block(c, 0.9, 0.15, 0.9, px, y + 8.5, pz, mat(0x050505));
      c.pin(name, mk, new V3(px, y + 8.5, pz));
    } else {
      block(c, 2.54, 2.5, 2.54, px, y, pz, M.plastic);
      const p = block(c, 0.64, h, 0.64, px, y, pz, M.gold);
      c.pin(name, p, new V3(px, y + h, pz));
    }
    if (o.board) {
      o.board.pads.push([px, pz]);
      if (o.labels) o.board.labels.push({ t: name, x: px, z: pz, dir: axis === 'x' ? 'z' : 'x', s: o.labels });
    }
  });
}
/** Patte métallique verticale servant de point de raccordement. */
export function leg(c, name, x, z, y0, h = 5) {
  const p = block(c, 0.64, h, 0.64, x, y0, z, M.gold);
  c.pin(name, p, new V3(x, y0 + h, z));
}
/** Socle noir pour les composants traversants, avec pattes à l'avant. */
export function socket(c, w, d, names, o = {}) {
  block(c, w, 3, d, 0, 0, 0, M.plastic);
  const pitch = o.pitch ?? PITCH, n = names.length, z = d / 2 - 1.2;
  names.forEach((nm, i) => leg(c, nm, (i - (n - 1) / 2) * pitch, z, 3, o.h ?? 5));
  return { top: 3, back: -d / 2 + 2 };
}
/** Module classique : PCB + rangée mâle à l'avant + étiquettes de sérigraphie. */
export function moduleBoard(c, w, l, color, pins, o = {}) {
  const b = board(c, w, l, color, o);
  header(c, pins, { board: b, axis: 'x', z: l / 2 - 2.2 + (o.z ?? 0), x: o.pinX ?? 0, labels: -1, pitch: o.pitch });
  return b;
}
