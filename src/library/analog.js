// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modèles 3D des composants analogiques (minuterie NE555 et ampli-op LM358 en DIP-8, MOSFET IRLZ44N en TO-220,
// bobine axiale de 10 mH, générateur de fonctions, oscilloscope 2 voies), dessinés à partir des primitives de kit.js,
// et leurs entrées de bibliothèque (catalog.js les ajoute aux siennes). Unité : le millimètre, broches vers +z.
import * as THREE from 'three';
import { M, PITCH, mat, block, cyl, decal, text, leg, socket, add, boxGeo } from './kit.js';
import { GEN_DEFAULT } from '../sim/analog-parts.js';
import { tl } from '../i18n/index.js';

/* ---------- Circuit intégré DIP-8 ---------- */
/**
 * Puce DIP-8 posée sur un support : broches 1 à 4 devant (de gauche à droite), 5 à 8 derrière (de droite à gauche),
 * encoche et point côté broche 1, référence sérigraphiée sur le dessus, numéro de chaque broche sur le support.
 */
function dip8(names, mark, sub) {
  return c => {
    const W = 12.4, D = 15, row = 5.6;
    block(c, W, 2.2, D, 0, 0, 0, 0x232323); // support
    decal(c, W, D, 0, 2.22, 0, (x, k) => {
      x.fillStyle = '#232323'; x.fillRect(0, 0, W * k, D * k);
      names.forEach((n, i) => {
        const front = i < 4, px = W / 2 + (front ? (i - 1.5) * PITCH : (1.5 - (i - 4)) * PITCH), pz = D / 2 + (front ? row + 0.9 : -row - 0.9);
        text(x, k, String(i + 1), px, pz, 1.0, { color: '#9aa0a6', weight: 600 });
      });
    }, 14);
    // Boîtier : corps noir, encoche en demi-lune à gauche, point près de la broche 1.
    block(c, 9.6, 3.2, 6.4, 0, 2.2, 0, 0x141414, { r: 0.5 });
    const notch = add(c, new THREE.CylinderGeometry(0.8, 0.8, 0.12, 20, 1, false, 0, Math.PI), mat(0x050505), -4.8, 5.43, 0);
    notch.rotation.y = -Math.PI / 2;
    cyl(c, 0.45, 0.1, -3.6, 5.4, 2.2, 0x050505);
    decal(c, 9.6, 6.4, 0, 5.42, 0, (x, k) => {
      x.fillStyle = '#141414'; x.fillRect(0, 0, 9.6 * k, 6.4 * k);
      text(x, k, mark, 4.8, 2.7, 1.55, { color: '#d8d8d8' }); text(x, k, sub, 4.8, 4.6, 0.95, { color: '#9a9a9a', weight: 500 });
    }, 18);
    // Pattes : sorties latérales argentées, puis point de raccordement doré à l'avant et à l'arrière du support.
    names.forEach((n, i) => {
      const front = i < 4, x = front ? (i - 1.5) * PITCH : (1.5 - (i - 4)) * PITCH, s = front ? 1 : -1;
      block(c, 0.6, 0.3, 1.4, x, 3.2, s * 3.8, M.leg);
      block(c, 0.6, 1.4, 0.3, x, 2.2, s * 4.4, M.leg);
      leg(c, n, x, s * row, 2.2, 4);
    });
  };
}

/* ---------- MOSFET en boîtier TO-220 ---------- */
function to220(names, mark) {
  return c => {
    socket(c, 10, 7, names);
    block(c, 10, 9, 4.5, 0, 6, -1.5, 0x151515);
    // Languette métallique percée (reliée au drain), au-dessus du boîtier.
    block(c, 10, 6.5, 1.3, 0, 15, -3.1, M.silver);
    const hole = cyl(c, 1.8, 1.4, 0, 18.6, -3.1, 0x202020, { axis: 'z', seg: 20 }); void hole;
    [-PITCH, 0, PITCH].forEach(x => block(c, 0.8, 3, 0.5, x, 3, -1.5, M.leg));
    // Marquage sur la face avant (vers +z).
    const face = decal(c, 9.4, 8, 0, 10.5, 0.77, (x, k) => {
      x.fillStyle = '#151515'; x.fillRect(0, 0, 9.4 * k, 8 * k);
      text(x, k, mark, 4.7, 2.6, 1.35, { color: '#d0d0d0' }); text(x, k, names.join(' '), 4.7, 6.4, 1.1, { color: '#8f8f8f', weight: 500 });
    }, 16);
    face.rotation.x = 0;
  };
}

/* ---------- Bobine axiale ---------- */
const BAND = { 0: 0x111111, 1: 0x6b3a1e, 3: 0xe07a1f, s: 0xc0c4c8 };
function inductor(bands) {
  return c => {
    socket(c, 18, 7, ['1', '2'], { pitch: 12.7 });
    cyl(c, 2.1, 8.4, 0, 8.5, -1.2, 0x2f7d5a, { axis: 'x', seg: 28 });
    [-4.35, 4.35].forEach(x => cyl(c, 1.8, 0.4, x, 8.5, -1.2, 0x276b4c, { axis: 'x' }));
    bands.forEach((bd, i) => cyl(c, 2.16, 0.6, [-2.4, -1.2, 0, 2.4][i], 8.5, -1.2, BAND[bd], { axis: 'x' }));
    [-1, 1].forEach(s => { cyl(c, 0.3, 2.1, s * 5.25, 8.5, -1.2, M.leg, { axis: 'x', seg: 8 }); block(c, 0.6, 5.5, 0.6, s * 6.35, 3, -1.2, M.leg); });
  };
}

/* ---------- Instruments de paillasse ---------- */
const WAVE_TXT = { sine: 'SIN', square: 'CARRÉ', triangle: 'TRI', dc: 'CONT.' };
/** Fréquence lisible : 1,00 kHz, 50,0 Hz… (sans dépendre de l'interface). */
export function freqText(f) {
  const a = Math.abs(+f || 0), r = (v, u) => `${(Math.round(v * 100) / 100).toString().replace('.', ',')} ${u}`;
  return a >= 1e6 ? r(a / 1e6, 'MHz') : a >= 1e3 ? r(a / 1e3, 'kHz') : r(a, 'Hz');
}
/** Écran du générateur : forme, fréquence, amplitude et décalage (inp : réglages du composant). */
export function paintGen(x, k, inp) {
  const g = { ...GEN_DEFAULT, ...(inp || {}) }, W = 34, H = 13;
  x.fillStyle = '#0c1f14'; x.fillRect(0, 0, W * k, H * k);
  x.strokeStyle = '#59e38f'; x.lineWidth = 0.35 * k; x.beginPath();
  for (let i = 0; i <= 40; i++) {
    const p = i / 40, px = (1.5 + p * 9) * k, w = g.wave === 'square' ? (p % 1 < 0.5 ? 1 : -1) : g.wave === 'triangle' ? (p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4) : g.wave === 'dc' ? 0.6 : Math.sin(2 * Math.PI * p);
    const py = (6.5 - 3.6 * w) * k; if (i) x.lineTo(px, py); else x.moveTo(px, py);
  }
  x.stroke();
  const txt = (t, px, py, s, col = '#9ff5c0') => text(x, k, t, px, py, s, { color: col, align: 'left', weight: 600 });
  txt(`${WAVE_TXT[g.wave] || 'SIN'}  ${g.wave === 'dc' ? '' : freqText(g.freq)}`, 12.5, 3.4, 2.1);
  txt(`A ${String(+g.amp || 0).replace('.', ',')} V   OFF ${String(+g.off || 0).replace('.', ',')} V`, 12.5, 7.6, 1.8, '#73d99c');
  txt('50 Ω', 12.5, 11, 1.4, '#4fa877');
}
function siggen(c) {
  const W = 64, H = 34, D = 44;
  block(c, W, H, D, 0, 0, -8, 0x2a2e33, { r: 0.5 });
  block(c, W - 2, H - 2, 0.8, 0, 1, 14.2, 0x1d2024); // face avant
  // Écran (redessiné par l'onglet Simulation quand les réglages changent : group.userData.genScreen).
  const k = 14, scr = decal(c, 34, 13, -9, 23, 14.65, (x, kk) => paintGen(x, kk, null), k);
  scr.rotation.x = 0; scr.material.emissive = new THREE.Color(0xffffff); scr.material.emissiveMap = scr.material.map; scr.material.emissiveIntensity = 0.6;
  c.g.userData.genScreen = { mesh: scr, k, paint: paintGen };
  // Boutons et molette, étiquette.
  [[16, 26], [24, 26], [16, 19], [24, 19]].forEach(([x, y]) => { const b = add(c, boxGeo(5, 3.2, 1.6), mat(0x3d434a), x, y, 15.2); void b; });
  const knob = cyl(c, 4.2, 2.6, 21, 9, 15.6, 0x3a3f45, { axis: 'z', seg: 32 }); void knob;
  const lab = decal(c, 30, 5, -9, 12, 14.65, (x, kk) => { x.fillStyle = '#1d2024'; x.fillRect(0, 0, 30 * kk, 5 * kk); text(x, kk, tl('GÉNÉRATEUR DE FONCTIONS'), 15, 2.6, 1.7, { color: '#c9d1d6' }); }, 12);
  lab.rotation.x = 0;
  // Bornes de sortie : OUT (rouge) et GND (noire), devant.
  block(c, 30, 2, 9, -9, 0, 18.5, 0x1d2024);
  [['OUT', -14, 0xc0302a], ['GND', -4, 0x111111]].forEach(([n, x, col]) => { cyl(c, 2.2, 3, x, 2, 18.5, col, { seg: 20 }); leg(c, n, x, 18.5, 5, 3); });
}
/** Écran fixe de l'oscilloscope : deux traces sur le quadrillage. */
function paintScope(x, k) {
  const W = 40, H = 24;
  x.fillStyle = '#071012'; x.fillRect(0, 0, W * k, H * k);
  x.strokeStyle = '#173238'; x.lineWidth = 0.15 * k; x.beginPath();
  for (let i = 1; i < 10; i++) { x.moveTo(i * W / 10 * k, 0); x.lineTo(i * W / 10 * k, H * k); }
  for (let j = 1; j < 8; j++) { x.moveTo(0, j * H / 8 * k); x.lineTo(W * k, j * H / 8 * k); }
  x.stroke();
  [['#f2c94c', p => Math.sin(2 * Math.PI * 2 * p), 7], ['#3fbfbf', p => (p * 2 % 1 < 0.5 ? 1 : -1), 16]].forEach(([col, f, y0]) => {
    x.strokeStyle = col; x.lineWidth = 0.4 * k; x.beginPath();
    for (let i = 0; i <= 80; i++) { const p = i / 80, py = (y0 - 3.5 * f(p)) * k; if (i) x.lineTo(p * W * k, py); else x.moveTo(0, py); }
    x.stroke();
  });
}
function scope(c) {
  const W = 70, H = 40, D = 46;
  block(c, W, H, D, 0, 0, -9, 0xd9dcdf, { r: 0.6 });
  block(c, W - 2, H - 2, 0.8, 0, 1, 14.2, 0x2b3036);
  const scr = decal(c, 40, 24, -12, 22, 14.65, paintScope, 10);
  scr.rotation.x = 0; scr.material.emissive = new THREE.Color(0xffffff); scr.material.emissiveMap = scr.material.map; scr.material.emissiveIntensity = 0.55;
  for (let i = 0; i < 6; i++) cyl(c, 2, 1.8, 16 + (i % 2) * 9, 30 - Math.floor(i / 2) * 8, 15.2, 0x4a5058, { axis: 'z', seg: 20 });
  const lab = decal(c, 40, 4, -12, 7, 14.65, (x, kk) => { x.fillStyle = '#2b3036'; x.fillRect(0, 0, 40 * kk, 4 * kk); text(x, kk, tl('OSCILLOSCOPE 2 VOIES'), 20, 2.1, 1.7, { color: '#d6dbe0' }); }, 12);
  lab.rotation.x = 0;
  // Entrées : CH1 (jaune), CH2 (cyan), masse (noire), comme les couleurs des voies à l'écran.
  block(c, 40, 2, 9, -12, 0, 19, 0x2b3036);
  [['CH1', -24, 0xf2c94c], ['CH2', -12, 0x3fbfbf], ['GND', 0, 0x111111]].forEach(([n, x, col]) => { cyl(c, 2.2, 3, x, 2, 19, col, { seg: 20 }); leg(c, n, x, 19, 5, 3); });
}

/* ---------- Bibliothèque ---------- */
/** Catégories ajoutées à celles de catalog.js, dans cet ordre. */
export const ANALOG_CATEGORIES = [tl('Circuits intégrés'), tl('Instruments')];
export const ANALOG_LIBRARY = [
  { id: 'ne555', name: tl('Minuterie NE555'), cat: tl('Circuits intégrés'), pre: 'U', build: dip8(['GND', 'TRIG', 'OUT', 'RESET', 'CV', 'THR', 'DIS', 'VCC'], 'NE555', 'TIMER') },
  { id: 'lm358', name: tl('Ampli-op double LM358'), cat: tl('Circuits intégrés'), pre: 'U', build: dip8(['1OUT', '1IN-', '1IN+', 'GND', '2IN+', '2IN-', '2OUT', 'VCC'], 'LM358', 'DUAL OP-AMP') },
  { id: 'irlz44n', name: tl('MOSFET logique IRLZ44N'), cat: tl('Passifs'), pre: 'Q', build: to220(['G', 'D', 'S'], 'IRLZ44N') },
  { id: 'ind-10m', name: tl('Bobine 10 mH'), cat: tl('Passifs'), pre: 'L', build: inductor([1, 0, 3, 's']) },
  { id: 'siggen', name: tl('Générateur de fonctions'), cat: tl('Instruments'), pre: 'GEN', build: siggen },
  { id: 'scope', name: tl('Oscilloscope 2 voies'), cat: tl('Instruments'), pre: 'OSC', build: scope }
];
