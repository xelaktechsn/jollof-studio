// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Étiquettes flottantes au-dessus des capteurs pendant la simulation. Ce sont des
// sprites de la scène 3D : elles apparaissent donc aussi dans les vidéos exportées.
import * as THREE from 'three';

const W = 560, H = 150, MM = 20; // pixels du canevas, pixels par millimètre de scène
const COL = { ok: '#3fb27f', warn: '#f2c94c', err: '#e5484d', off: '#8a949b' };

export function makeLabel() {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.renderOrder = 20; sp.scale.set(W / MM, H / MM, 1); sp.userData.key = '';
  return sp;
}
export function disposeLabel(sp) { sp.material.map.dispose(); sp.material.dispose(); }

function fit(x, t, max, size, weight, family) {
  let s = size;
  do { x.font = `${weight} ${s}px ${family}`; } while (x.measureText(t).width > max && (s -= 2) > 22);
  if (x.measureText(t).width <= max) return t;
  while (t.length > 1 && x.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}
/** Redessine l'étiquette seulement si son contenu a changé. */
export function paintLabel(sp, top, main, level) {
  const key = `${top}|${main}|${level}`;
  if (sp.userData.key === key) return;
  sp.userData.key = key;
  const tex = sp.material.map, x = tex.image.getContext('2d');
  x.clearRect(0, 0, W, H);
  x.fillStyle = 'rgba(13,16,19,.92)'; x.strokeStyle = COL[level] || COL.off; x.lineWidth = 4;
  x.beginPath(); x.roundRect ? x.roundRect(4, 4, W - 8, H - 8, 26) : x.rect(4, 4, W - 8, H - 8); x.fill(); x.stroke();
  x.textBaseline = 'middle'; x.textAlign = 'left';
  x.fillStyle = COL[level] || COL.off; x.beginPath(); x.arc(40, 46, 10, 0, 7); x.fill();
  x.fillStyle = '#9aa4ab'; x.fillText(fit(x, top, W - 90, 30, 600, '"Instrument Sans", sans-serif'), 62, 47);
  x.fillStyle = '#e4e7e8'; x.fillText(fit(x, main, W - 64, 46, 500, '"JetBrains Mono", monospace'), 30, 103);
  tex.needsUpdate = true;
}
