// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Courant animé : des points avancent le long des fils, à une vitesse liée au courant réel
// (sens conventionnel, du + vers le −) et colorés selon la tension du fil. Tous les points
// forment un seul objet THREE.Points (un seul appel de dessin) ; chaque fil garde une table de
// positions tous les millimètres, recalculée seulement quand son tracé change. En mode léger :
// moins de points, plus espacés.
import * as THREE from 'three';
import { dotTexture } from './fx.js';

const STOPS = [[-1, 0x9b7be0], [0, 0x5b6b7a], [3.3, 0x3fb27f], [5, 0xf2c94c], [9, 0xe5484d]];
const tmp = new THREE.Color(), tmp2 = new THREE.Color();
/** Couleur d'une tension : gris-bleu à 0 V, vert à 3,3 V, jaune à 5 V, rouge à 9 V et plus ; violet en négatif. */
function voltColor(v, out) {
  if (v == null) return out.set(0x5b6b7a);
  if (v <= STOPS[0][0]) return out.set(STOPS[0][1]);
  for (let i = 1; i < STOPS.length; i++) if (v <= STOPS[i][0]) { const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i]; return out.set(ca).lerp(tmp2.set(cb), (v - a) / (b - a)); }
  return out.set(STOPS[STOPS.length - 1][1]);
}
/** Vitesse des points (mm/s) : logarithmique, pour qu'on voie à la fois 1 mA et 50 mA. */
const speed = mA => 8 * Math.log10(1 + Math.abs(mA) / 0.05);

export function createFlow(scene, { light = false } = {}) {
  const CAP = light ? 180 : 600, BASE_GAP = light ? 9 : 6, LIFT = 0.62;
  const pos = new Float32Array(CAP * 3), col = new Float32Array(CAP * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({ map: dotTexture(), vertexColors: true, size: light ? 3.0 : 2.4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 24; pts.visible = false;
  scene.add(pts);
  let lanes = [], last = 0, on = true;

  /** Table de positions d'un fil (un point par millimètre), gardée sur le fil tant que son tracé ne change pas. */
  function lut(w) {
    if (w.flowLut && w.flowLut.sig === w.sig) return w.flowLut;
    const len = w.curve.getLength(), n = Math.max(2, Math.ceil(len)), p = w.curve.getSpacedPoints(n - 1), a = new Float32Array(n * 3);
    p.forEach((v, i) => { a[i * 3] = v.x; a[i * 3 + 1] = v.y + LIFT; a[i * 3 + 2] = v.z; });
    return (w.flowLut = { sig: w.sig, a, n, len });
  }
  return {
    get enabled() { return on; },
    set enabled(v) { on = !!v; if (!on) this.clear(); },
    /** Courants des fils (Map fil → { mA, v }), 5 à 10 fois par seconde. */
    set(flows) {
      if (!on || !flows) { this.clear(); return; }
      const next = [];
      for (const [w, f] of flows) {
        if (!w.curve || w.progress < 1 || !w.mesh || !w.mesh.visible || Math.abs(f.mA) < 0.01) continue;
        const old = lanes.find(l => l.w === w);
        next.push({ w, mA: f.mA, v: f.v, phase: old ? old.phase : Math.random() * 10 });
      }
      // Trop de points : on espace partout plutôt que d'en oublier.
      let gap = BASE_GAP;
      const need = () => next.reduce((t, l) => t + Math.floor(lut(l.w).len / gap), 0);
      while (need() > CAP && gap < 80) gap *= 1.25;
      next.forEach(l => { const L = lut(l.w); l.gap = gap; l.count = Math.max(1, Math.floor(L.len / gap)); voltColor(l.v, tmp).lerp(tmp2.set(0xffffff), 0.35); l.r = tmp.r; l.g = tmp.g; l.b = tmp.b; }); // couleur éclaircie : visible même sur un fil de la même couleur
      lanes = next;
      pts.visible = lanes.length > 0;
      let k = 0;
      for (const l of lanes) for (let j = 0; j < l.count && k < CAP; j++, k++) { col[k * 3] = l.r; col[k * 3 + 1] = l.g; col[k * 3 + 2] = l.b; }
      geo.attributes.color.needsUpdate = true; geo.setDrawRange(0, k);
    },
    /** À chaque image de simulation : les points avancent. */
    update(now) {
      if (!on || !lanes.length) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
      let k = 0;
      for (const l of lanes) {
        const L = lut(l.w), dir = l.mA >= 0 ? 1 : -1;
        l.phase = (l.phase + dir * speed(l.mA) * dt) % L.len; if (l.phase < 0) l.phase += L.len;
        for (let j = 0; j < l.count && k < CAP; j++, k++) {
          const d = (l.phase + j * l.gap) % L.len, f = d / L.len * (L.n - 1), i = Math.min(L.n - 2, Math.floor(f)), t = f - i, a = L.a;
          pos[k * 3] = a[i * 3] + (a[i * 3 + 3] - a[i * 3]) * t; pos[k * 3 + 1] = a[i * 3 + 1] + (a[i * 3 + 4] - a[i * 3 + 1]) * t; pos[k * 3 + 2] = a[i * 3 + 2] + (a[i * 3 + 5] - a[i * 3 + 2]) * t;
        }
      }
      geo.attributes.position.needsUpdate = true;
    },
    clear() { lanes = []; last = 0; geo.setDrawRange(0, 0); pts.visible = false; },
    get count() { return geo.drawRange.count; }
  };
}
