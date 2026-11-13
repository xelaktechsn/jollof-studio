// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Repères du plan de travail : cube d'orientation avec ses axes X, Y, Z en haut à droite (comme en CAO)
// et repère de chaque composant (R1, LED1, ESP32…) affiché au-dessus de lui.
import * as THREE from 'three';
import { createViewCube } from './viewcube.js';


/** Texte sur une petite étiquette (sprite). screen : taille constante à l'écran. */
export function textSprite(text, o = {}) {
  const fs = o.size || 34, pad = 12, cv = document.createElement('canvas'), x = cv.getContext('2d');
  x.font = `600 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
  const w = Math.ceil(x.measureText(text).width) + pad * 2, h = fs + pad * 1.4;
  cv.width = w; cv.height = h;
  x.font = `600 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
  if (o.bg) { x.fillStyle = o.bg; x.beginPath(); x.roundRect ? x.roundRect(2, 2, w - 4, h - 4, h / 3) : x.rect(2, 2, w - 4, h - 4); x.fill(); if (o.border) { x.strokeStyle = o.border; x.lineWidth = 3; x.stroke(); } }
  x.fillStyle = o.color || '#e4e7e8'; x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: !o.onTop, transparent: true, sizeAttenuation: !o.screen }));
  sp.userData.aspect = w / h; sp.renderOrder = o.onTop ? 15 : 5;
  sp.center.set(0.5, 0); // posé par sa base : jamais à moitié enfoncé dans le tapis
  return sp;
}
export const dispose = sp => { sp.material.map.dispose(); sp.material.dispose(); };

/**
 * opts : { scene, camera, controls, stage (élément), comps(), boxOf(comp), onDir(direction), onHome() }
 */
export function createGuides(o) {
  const { scene, camera, controls } = o;
  const tags = new THREE.Group();
  tags.name = 'reperes-composants';
  scene.add(tags);
  let showTags = true;
  try { showTags = localStorage.getItem('jollof-tags') !== '0'; } catch (e) { /* stockage indisponible */ }

  /* --- Repères des composants --- */
  const tagOf = new Map();
  function updateTags() {
    const comps = o.comps(), alive = new Set(comps);
    for (const [c, s] of tagOf) if (!alive.has(c)) { tags.remove(s); dispose(s); tagOf.delete(c); }
    const dist = camera.position.distanceTo(controls.target);
    for (const c of comps) {
      let s = tagOf.get(c);
      if (!s || s.userData.name !== c.name) {
        if (s) { tags.remove(s); dispose(s); }
        s = textSprite(c.name, { color: '#f2f4f5', size: 34, bg: 'rgba(13,16,19,.82)', border: '#3b82f6', onTop: false });
        s.userData.name = c.name; tagOf.set(c, s); tags.add(s);
      }
      const b = o.boxOf(c), k = c.boxKey;
      if (s.userData.k !== k) { s.userData.k = k; s.position.set((b.min.x + b.max.x) / 2, b.max.y + 3.6, (b.min.z + b.max.z) / 2); }
      // Les étiquettes de mesure de la simulation portent déjà le nom : pas de doublon.
      s.visible = !c.label && dist < 2600;
      // Taille suivant le zoom, bornée : lisible de près sans masquer le composant, discrète de loin.
      const h = Math.min(9, Math.max(2.2, dist * 0.016)); s.scale.set(h * s.userData.aspect, h, 1);
    }
  }

  /* --- Cube d'orientation en haut à droite, toujours visible --- */
  const cube = createViewCube({ stage: o.stage, camera, controls, onDir: o.onDir, onHome: o.onHome });

  const apply = () => { tags.visible = showTags; };
  apply();
  return {
    get tags() { return showTags; },
    setTags(on) { showTags = on; try { localStorage.setItem('jollof-tags', on ? '1' : '0'); } catch (e) { /* stockage indisponible */ } apply(); },
    /** À chaque image : cube d'orientation et repères suivent la vue. */
    update() { cube.update(); if (showTags) updateTags(); }
  };
}
