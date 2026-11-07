// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Cube d'orientation (« ViewCube »), en haut à droite du plan de travail, comme dans les logiciels
// de CAO : il tourne avec la caméra et montre où sont le dessus, l'avant, la droite… Un clic sur
// une face, une arête ou un coin oriente la vue ; un glisser fait tourner la caméra. Les axes X, Y, Z
// partent d'un coin du cube, une boussole (N, E, S, O) l'entoure, la maison revient à la vue 3D.
import * as THREE from 'three';
import { tl } from '../i18n/index.js';

const H = 30;                 // demi-côté du cube (px)
const AXL = 64;               // longueur des axes (px)
const COL = { x: '#e5484d', y: '#3fb27f', z: '#3b82f6' };
// Faces dans le repère CSS (x à droite, y vers le bas, z vers l'écran) : normale, axes u (droite) et v (bas) de la face.
const FACES = {
  front: { t: `translateZ(${H}px)`, n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], label: tl('AVANT') },
  back: { t: `rotateY(180deg) translateZ(${H}px)`, n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], label: tl('ARRIÈRE') },
  right: { t: `rotateY(90deg) translateZ(${H}px)`, n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], label: tl('DROITE') },
  left: { t: `rotateY(-90deg) translateZ(${H}px)`, n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], label: tl('GAUCHE') },
  top: { t: `rotateX(90deg) translateZ(${H}px)`, n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], label: tl('DESSUS') },
  bottom: { t: `rotateX(-90deg) translateZ(${H}px)`, n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], label: tl('DESSOUS') }
};
const NAMES = { '0,1,0': tl('Dessus'), '0,-1,0': tl('Dessous'), '0,0,1': tl('Avant'), '0,0,-1': tl('Arrière'), '1,0,0': tl('Droite'), '-1,0,0': tl('Gauche') };

/**
 * o : { stage, camera, controls, onDir(direction monde, normalisée), onHome() }
 */
export function createViewCube(o) {
  const { camera, controls } = o;
  const root = document.createElement('div');
  root.className = 'viewcube';
  root.setAttribute('role', 'group'); root.setAttribute('aria-label', tl('Cube d’orientation : cliquez une face, une arête ou un coin'));
  // Chaque face est découpée en 3 × 3 zones : centre = la face, bords = une arête, coins = un coin.
  const cell = (f, i, j) => {
    const F = FACES[f], d = [0, 1, 2].map(k => F.n[k] + i * F.u[k] + j * F.v[k]);
    const world = [d[0], -d[1], d[2]]; // y CSS vers le bas → y monde vers le haut
    const kind = i === 0 && j === 0 ? 'face' : i && j ? 'corner' : 'edge';
    const name = NAMES[world.join(',')] || (kind === 'corner' ? tl('Vue en coin') : tl('Vue sur l’arête'));
    return `<i class="vcCell ${kind}" data-dir="${world.join(',')}" title="${name}"></i>`;
  };
  root.innerHTML = `
    <button type="button" class="vcHome" title="${tl('Vue 3D, tout le montage')}" aria-label="${tl('Vue 3D, tout le montage')}"><svg viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5 M6.5 10v9h11v-9 M10 19v-5h4v5"/></svg></button>
    <div class="vcStage">
      <div class="vcCube">
        <div class="vcRing"><b class="n">N</b><b class="e">E</b><b class="s">S</b><b class="w">O</b></div>
        ${Object.entries(FACES).map(([f, F]) => `<div class="vcFace ${f}" style="transform:${F.t}"><span>${F.label}</span><div class="vcGrid">${[-1, 0, 1].map(j => [-1, 0, 1].map(i => cell(f, i, j)).join('')).join('')}</div></div>`).join('')}
        <div class="vcAxis x"></div><div class="vcAxis x r"></div>
        <div class="vcAxis y"></div><div class="vcAxis y r"></div>
        <div class="vcAxis z"></div><div class="vcAxis z r"></div>
      </div>
    </div>
    <b class="vcLab x">X</b><b class="vcLab y">Y</b><b class="vcLab z">Z</b>`;
  o.stage.appendChild(root);
  const cube = root.querySelector('.vcCube'), labs = { x: root.querySelector('.vcLab.x'), y: root.querySelector('.vcLab.y'), z: root.querySelector('.vcLab.z') };

  // Axes : du coin arrière-gauche-bas du cube, le long de ses arêtes (deux rubans croisés : visibles sous tous les angles).
  const AX = { x: [1, 0, 0], y: [0, -1, 0], z: [0, 0, 1] };
  const O = [-H, H, -H];
  root.querySelectorAll('.vcAxis').forEach(el => {
    const a = el.classList[1], rot = a === 'x' ? '' : a === 'y' ? 'rotateZ(-90deg)' : 'rotateY(-90deg)';
    el.style.width = `${AXL}px`; el.style.background = COL[a];
    el.style.transform = `translate3d(${O[0]}px, ${O[1]}px, ${O[2]}px) ${rot}${el.classList.contains('r') ? ' rotateX(90deg)' : ''}`;
  });

  // Orientation : la rotation de la caméra, passée dans le repère CSS (y inversé).
  const R = new THREE.Matrix4();
  let key = '';
  function update() {
    R.copy(camera.matrixWorldInverse);
    const e = R.elements, S = [1, -1, 1];
    const m = (i, j) => S[i] * S[j] * e[j * 4 + i];
    const k = [0, 1, 2].map(j => [0, 1, 2].map(i => m(i, j).toFixed(4)).join(',')).join(';');
    if (k === key) return;
    key = k;
    const css = `matrix3d(${m(0, 0)},${m(1, 0)},${m(2, 0)},0,${m(0, 1)},${m(1, 1)},${m(2, 1)},0,${m(0, 2)},${m(1, 2)},${m(2, 2)},0,0,0,0,1)`;
    cube.style.transform = css;
    // Lettres X, Y, Z au bout des axes, toujours droites (posées à plat sur l'écran).
    for (const a of ['x', 'y', 'z']) {
      const p = [0, 1, 2].map(i => O[i] + AX[a][i] * (AXL + 9));
      const sx = m(0, 0) * p[0] + m(0, 1) * p[1] + m(0, 2) * p[2], sy = m(1, 0) * p[0] + m(1, 1) * p[1] + m(1, 2) * p[2], sz = m(2, 0) * p[0] + m(2, 1) * p[1] + m(2, 2) * p[2];
      labs[a].style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      labs[a].style.opacity = sz < -H ? 0.4 : 1;
    }
  }

  // Clic : orienter la vue ; glisser : tourner autour de la cible.
  const sph = new THREE.Spherical(), off = new THREE.Vector3();
  let drag = null;
  root.querySelector('.vcStage').addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, moved: false, cell: e.target.closest('.vcCell') };
    e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault();
  });
  root.querySelector('.vcStage').addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true; drag.x = e.clientX; drag.y = e.clientY;
    off.copy(camera.position).sub(controls.target); sph.setFromVector3(off);
    sph.theta -= dx * 0.012; sph.phi = Math.max(0.01, Math.min(controls.maxPolarAngle, sph.phi - dy * 0.012));
    off.setFromSpherical(sph); camera.position.copy(controls.target).add(off); camera.lookAt(controls.target);
    root.classList.add('turning');
  });
  root.querySelector('.vcStage').addEventListener('pointerup', () => {
    const d = drag; drag = null; root.classList.remove('turning');
    if (!d || d.moved || !d.cell) return;
    const v = new THREE.Vector3(...d.cell.dataset.dir.split(',').map(Number)).normalize();
    o.onDir(v);
  });
  root.querySelector('.vcHome').addEventListener('click', () => o.onHome());
  return { update, el: root };
}
