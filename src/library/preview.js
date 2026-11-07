// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Visionneuse 3D de la documentation : montre le composant tel qu'on le trouve sur
// la table, pour savoir le reconnaître, et allume les broches survolées dans le tableau.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { M } from './kit.js';
import { BY_ID } from './catalog.js';
import { tagSprite } from '../sim/fx.js';
import { Q } from '../quality.js';

const base = k => k.replace(/ \(\d+\)$/, '');

export function createPreview(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, alpha: true, precision: Q.precision });
  renderer.setPixelRatio(Q.pixelRatio); renderer.debug.checkShaderErrors = !import.meta.env.PROD;
  let last = 0;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8ee, 0x1a1f24, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 1.05); sun.position.set(60, 140, 90); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xe0703a, 0.3); rim.position.set(-90, 40, -70); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 3000);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, enablePan: false, autoRotate: true, autoRotateSpeed: 1.4, maxPolarAngle: Math.PI * 0.62 });
  let model = null, floor = null, pins = {}, lit = [], radius = 20, running = false;

  function disposeModel() {
    if (!model) return;
    scene.remove(model, floor);
    model.traverse(o => {
      if (!o.isMesh) return;
      // Les pavés viennent d'un cache partagé avec la scène principale : on ne les libère pas.
      if (o.geometry.type !== 'BoxGeometry') o.geometry.dispose();
      if (o.material.map) { o.material.map.dispose(); o.material.dispose(); }
    });
    floor.geometry.dispose(); floor.material.dispose();
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function loop(now = 0) {
    if (!running) return;
    requestAnimationFrame(loop);
    if (now - last < 1000 / Q.fps - 2 || document.hidden) return; // cadence plafonnée (30 images/s en mode léger)
    last = now;
    resize(); controls.update(); renderer.render(scene, camera);
  }
  return {
    /** Construit le composant `id`, centré et cadré. */
    load(id) {
      clear(); disposeModel();
      model = new THREE.Group(); pins = {};
      BY_ID[id].build({ g: model, pin: (n, mesh, attach) => { let k = n, i = 2; while (pins[k]) k = `${n} (${i++})`; pins[k] = { mesh, base: mesh.material, attach }; } });
      model.traverse(o => o.isMesh && o.material === M.hit && (o.visible = false));
      const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      model.position.set(-c.x, -box.min.y, -c.z);
      radius = Math.max(size.x, size.y, size.z, 8) / 2;
      floor = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.6, 64), new THREE.MeshBasicMaterial({ color: 0x161d22 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -0.05;
      scene.add(floor, model);
      const fit = Math.hypot(size.x, size.y, size.z) / 2 / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
      controls.target.set(0, size.y * 0.35, 0);
      camera.position.copy(controls.target).add(new THREE.Vector3(0.45, 0.75, 1).normalize().multiplyScalar(fit * 0.82));
      controls.minDistance = fit * 0.4; controls.maxDistance = fit * 3;
      controls.autoRotate = true;
    },
    /** Allume les broches dont le nom (sans « (2) ») figure dans `names`, et les étiquette. */
    highlight(names) {
      clear();
      if (!names || !names.length || !model) { controls.autoRotate = true; return; }
      const want = new Set(names);
      for (const [k, p] of Object.entries(pins)) {
        if (!want.has(k) && !want.has(base(k))) continue;
        p.mesh.material = M.goldHi;
        const tag = tagSprite(k, '#e0703a'), s = Math.max(7, radius * 0.36);
        tag.scale.set(s, s * 0.31, 1);
        tag.position.copy(model.localToWorld(p.attach.clone())).add(new THREE.Vector3(0, s * 0.45, 0));
        scene.add(tag); lit.push([p, tag]);
      }
      controls.autoRotate = !lit.length;
    },
    start() { if (!running) { running = true; loop(); } },
    stop() { running = false; }
  };
  function clear() {
    lit.forEach(([p, tag]) => { p.mesh.material = p.base; scene.remove(tag); tag.material.map.dispose(); tag.material.dispose(); });
    lit = [];
  }
}
