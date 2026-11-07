// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Effets visuels des erreurs de câblage, dans la scène 3D (donc aussi dans les vidéos) :
// ondes pulsées et étiquette sur chaque broche en cause, fil fantôme vert vers la bonne
// broche, étincelles sur un court-circuit, fumée sur un composant en surtension.
import * as THREE from 'three';

const V3 = THREE.Vector3;
const COLOR = { err: 0xff3b30, warn: 0xffb020, ok: 0x3fb27f };
const rnd = a => (Math.random() * 2 - 1) * a;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return new THREE.CanvasTexture(c);
}
let RING, DOT, SMOKE;
function textures() {
  if (RING) return;
  RING = canvasTex(128, 128, (x, s) => { x.strokeStyle = '#fff'; x.lineWidth = 9; x.beginPath(); x.arc(s / 2, s / 2, s / 2 - 7, 0, 7); x.stroke(); });
  const soft = (inner, outer) => (x, s) => {
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, `rgba(255,255,255,${inner})`); g.addColorStop(0.35, `rgba(255,255,255,${outer})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
  };
  DOT = canvasTex(64, 64, soft(1, 0.8));
  SMOKE = canvasTex(64, 64, soft(0.8, 0.45));
}
/** Point lumineux doux (texture partagée) : étincelles, courant animé. */
export function dotTexture() { textures(); return DOT; }
const spriteMat = (map, color, add) => new THREE.SpriteMaterial({ map, color, transparent: true, depthTest: false, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });

/** Étiquette en forme de pastille portant le nom d'une broche (fond `bg`). */
export function tagSprite(text, bg) {
  const tex = canvasTex(256, 80, (x, w, h) => {
    let size = 40;
    do { x.font = `600 ${size}px "JetBrains Mono", monospace`; } while (x.measureText(text).width > w - 44 && (size -= 2) > 18);
    const tw = Math.min(w - 4, x.measureText(text).width + 40);
    x.fillStyle = bg;
    x.beginPath(); x.roundRect ? x.roundRect((w - tw) / 2, 8, tw, h - 16, (h - 16) / 2) : x.rect((w - tw) / 2, 8, tw, h - 16); x.fill();
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, h / 2 + 2);
  });
  const sp = new THREE.Sprite(spriteMat(tex, 0xffffff)); sp.scale.set(9, 2.8, 1); sp.renderOrder = 27;
  return sp;
}

export function createFx(scene) {
  textures();
  const root = new THREE.Group(); scene.add(root);
  const marks = new Map(), ghosts = new Map();
  let sparkAt = [], smokeAt = [], lastSpark = 0, lastSmoke = 0, prev = 0;

  // Étincelles : un nuage de points recyclés.
  const N = 180, pos = new Float32Array(N * 3).fill(-1e4), vel = new Float32Array(N * 3), life = new Float32Array(N);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ map: DOT, color: 0xffc04a, size: 2.4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false; sparks.renderOrder = 26; root.add(sparks);
  let si = 0;
  // Fumée : des sprites gris qui montent, grossissent et s'effacent.
  const puffs = Array.from({ length: 30 }, () => { const s = new THREE.Sprite(spriteMat(SMOKE, 0x9ba0a5)); s.visible = false; s.renderOrder = 26; root.add(s); return s; });
  let pi = 0;

  const drop = (...objs) => objs.forEach(o => { if (!o) return; root.remove(o); if (o.material.map && o.material.map !== RING && o.material.map !== DOT) o.material.map.dispose(); o.material.dispose(); if (o.geometry && !o.isSprite) o.geometry.dispose(); });
  function mark(key, level, p, tag) {
    let m = marks.get(key);
    if (!m) {
      m = { rings: [0, 1].map(() => new THREE.Sprite(spriteMat(RING, COLOR[level]))), core: new THREE.Sprite(spriteMat(DOT, COLOR[level], true)), tag: tag ? tagSprite(tag, level === 'err' ? '#e5484d' : '#d99a1a') : null, pos: new V3(), burst: 0 };
      [...m.rings, m.core].forEach(s => { s.renderOrder = 25; root.add(s); });
      if (m.tag) root.add(m.tag);
      marks.set(key, m);
    }
    m.pos.copy(p); m.seen = true;
  }
  function ghost(key, a, b) {
    const sig = [a.x, a.y, a.z, b.x, b.y, b.z].map(v => v.toFixed(1)).join();
    let g = ghosts.get(key);
    if (g && g.sig === sig) { g.seen = true; return; }
    if (g) drop(g.line, ...g.dots);
    const lift = 6 + a.distanceTo(b) * 0.25, mid = a.clone().add(b).multiplyScalar(0.5); mid.y = Math.max(a.y, b.y) + lift;
    const curve = new THREE.CatmullRomCurve3([a.clone(), a.clone().add(new V3(0, lift * 0.45, 0)), mid, b.clone().add(new V3(0, lift * 0.45, 0)), b.clone()], false, 'centripetal');
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(80)), new THREE.LineDashedMaterial({ color: COLOR.ok, dashSize: 2.2, gapSize: 1.6, transparent: true, depthTest: false }));
    line.computeLineDistances(); line.renderOrder = 24; root.add(line);
    const dots = [0, 1, 2].map(() => { const s = new THREE.Sprite(spriteMat(DOT, COLOR.ok, true)); s.scale.set(2.6, 2.6, 1); s.renderOrder = 25; root.add(s); return s; });
    ghosts.set(key, { sig, curve, line, dots, seen: true });
  }

  const api = {
    /**
     * list : [{ key, level, points: [{ pos, tag }], ghost: { a, b } | null, fx: 'short' | 'smoke' | null, smoke: pos }]
     * Les effets déjà présents sont conservés (leurs animations continuent sans à-coup).
     */
    set(list) {
      marks.forEach(m => (m.seen = false)); ghosts.forEach(g => (g.seen = false));
      sparkAt = []; smokeAt = [];
      for (const f of list) {
        f.points.forEach((p, i) => mark(`${f.key}#${i}`, f.level, p.pos, p.tag));
        if (f.ghost) ghost(f.key, f.ghost.a, f.ghost.b);
        if (f.fx === 'short') sparkAt.push(...f.points.map(p => p.pos));
        if (f.fx === 'smoke' && f.smoke) smokeAt.push(f.smoke);
      }
      for (const [k, m] of marks) if (!m.seen) { drop(...m.rings, m.core, m.tag); marks.delete(k); }
      for (const [k, g] of ghosts) if (!g.seen) { drop(g.line, ...g.dots); ghosts.delete(k); }
    },
    update(now) {
      const dt = Math.min(0.05, (now - (prev || now)) / 1000), t = now / 1000; prev = now;
      for (const m of marks.values()) {
        const boost = m.burst > now ? 1.9 : 1;
        m.rings.forEach((r, i) => { const ph = (t * 0.9 + i * 0.5) % 1, s = (3 + 9 * ph) * boost; r.scale.set(s, s, 1); r.material.opacity = (1 - ph) * 0.95; r.position.copy(m.pos); });
        const c = 2.4 + Math.sin(t * 8) * 0.6; m.core.scale.set(c, c, 1); m.core.position.copy(m.pos);
        if (m.tag) m.tag.position.set(m.pos.x, m.pos.y + 6 + Math.sin(t * 3) * 0.5, m.pos.z);
      }
      for (const g of ghosts.values()) {
        g.line.material.opacity = 0.55 + 0.35 * Math.sin(t * 4);
        g.dots.forEach((d, i) => d.position.copy(g.curve.getPointAt((t * 0.45 + i / 3) % 1)));
      }
      if (sparkAt.length && now - lastSpark > 60) {
        lastSpark = now;
        const o = sparkAt[Math.floor(Math.random() * sparkAt.length)];
        for (let j = 0; j < 7; j++) {
          const i = (si = (si + 1) % N), a = Math.random() * Math.PI * 2, sp = 20 + Math.random() * 45;
          pos.set([o.x + rnd(0.6), o.y + 0.5, o.z + rnd(0.6)], i * 3);
          vel.set([Math.cos(a) * sp, 25 + Math.random() * 60, Math.sin(a) * sp], i * 3);
          life[i] = 0.3 + Math.random() * 0.45;
        }
      }
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) { pos[i * 3 + 1] = -1e4; continue; }
        vel[i * 3 + 1] -= 260 * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      geo.attributes.position.needsUpdate = true;
      if (smokeAt.length && now - lastSmoke > 140) {
        lastSmoke = now;
        for (const o of smokeAt) {
          const s = puffs[(pi = (pi + 1) % puffs.length)];
          s.visible = true; s.position.set(o.x + rnd(2), o.y, o.z + rnd(2));
          s.userData = { life: 0, max: 1.6 + Math.random() * 0.6, vx: rnd(4), vz: rnd(4) };
        }
      }
      for (const s of puffs) {
        if (!s.visible) continue;
        const u = s.userData; u.life += dt;
        const k = u.life / u.max;
        if (k >= 1) { s.visible = false; continue; }
        s.position.x += u.vx * dt; s.position.z += u.vz * dt; s.position.y += 16 * dt;
        const sc = 4 + 16 * k; s.scale.set(sc, sc, 1); s.material.opacity = 0.55 * (1 - k) * Math.min(1, k * 6);
      }
    },
    /** Fait grossir un instant les ondes d'une erreur (quand on clique « Voir »). */
    highlight(key, now) { for (const [k, m] of marks) if (k.startsWith(key + '#')) m.burst = now + 1400; },
    clear() {
      api.set([]);
      life.fill(0); pos.fill(-1e4); geo.attributes.position.needsUpdate = true;
      puffs.forEach(s => (s.visible = false));
    }
  };
  return api;
}
