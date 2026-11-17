// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Jumeau numérique : le rendu Three.js de la machine construite (model.js), dans la vue 3D de machine.js, qui prête
// ses outils (matières, vérin monté, bouton cliquable, voyants, atelier). Même hiérarchie que le moteur (engine.js) :
// un groupe par composant à sa pose, un sous-groupe mobile pour les mobiles (déplacé de course × position du vérin,
// tourné de l'angle × position), les enfants accrochés au mobile de leur parent ; les pièces (colis, bouteilles,
// palets…) sont dessinées d'après l'état du procédé (st.proc.items). En mode construction, grille, zones des
// capteurs et des bacs, et cadre de la pièce choisie. Les modèles glTF importés sont décodés ici (GLTFLoader).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { tl } from '../i18n/index.js';
import { CATALOG, DIR_VEC, ITEMS, isMover, partLabel, signalOf } from './model.js';
import { twinProcess, moverPose, bodyOf } from './engine.js';
import { cylOf } from '../pneu/process.js';

const rad = d => (d * Math.PI) / 180;
const hex = c => parseInt(String(c || '#888888').replace('#', ''), 16);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** Vecteur perpendiculaire horizontal à d (ou x si d est vertical). */
const perp = d => (d[1] ? [1, 0, 0] : [-d[2], 0, d[0]]);
const upOf = d => (d[1] ? [1, 0, 0] : [0, 1, 0]);

/**
 * Construit la scène. ctx : outils de machine.js ({ root, put, box, cyl, mat, label, led, setLed, mount, pushBtn,
 * shadows, workshopFloor, ghost, glass, COL, camera, controls, scene }). Rend { pick, near, groups, update(st),
 * act(rôle), overlays(on), select(id), exportRoots() }.
 */
export function buildTwin(ctx, circuit, cfg) {
  const { root, put, box, cyl, mat, label, led, setLed, mount, pushBtn, shadows, workshopFloor, ghost, COL, camera, controls, scene } = ctx;
  const D = twinProcess(cfg), groups = new Map(), pick = [], flashes = new Map();
  workshopFloor(0);
  const steel = mat(0x8e98a1, { metalness: 0.5, roughness: 0.4 }), dark = mat(0x2a3036), belt = mat(0x1f262c, { roughness: 0.9 }), rubber = mat(0x1d2124, { roughness: 0.95 }), yellow = mat(0xf2c230);
  const cylFor = p => cylOf(circuit, p.bind.cyl, -1);
  /** Vérin monté dans le groupe g : nez du corps en at (local), tige vers d. Rend { x(st) }. */
  const mountCyl = (g, p, at, d, o = {}) => mount(cylFor(p), { L: Math.max(0.25, (p.props.stroke || 0.1) + 0.12), S: p.props.stroke || 0.1, r: 0.028, rodR: 0.01, at, rod: d, up: o.up || upOf(d), sens: o.sens, tag: o.tag || [0, 0.07, 0], tagH: 0.04, ledR: 0.009, name: o.name, nameH: 0.05, holder: g });
  const B = {
    frame(G) {
      const [w, h, d] = G.p.size, legM = mat(0x59636c, { metalness: 0.4 });
      put(box(w, 0.04, d, mat(0x8a6f4d, { roughness: 0.8 })), 0, h - 0.02, 0, G.g);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(box(0.05, h - 0.04, 0.05, legM), sx * (w / 2 - 0.05), (h - 0.04) / 2, sz * (d / 2 - 0.05), G.g);
      for (const sz of [-1, 1]) put(box(w - 0.1, 0.03, 0.03, legM), 0, 0.15, sz * (d / 2 - 0.05), G.g);
    },
    block(G) { const [w, h, d] = G.p.size; put(box(w, h, d, mat(hex(G.p.props.color), { roughness: 0.7 })), 0, h / 2, 0, G.g); },
    conveyor(G) {
      const [w, h, d] = G.p.size, side = mat(0x3b82f6, { metalness: 0.3, roughness: 0.5 });
      for (const sz of [-1, 1]) put(box(w, h, 0.03, side), 0, h / 2, sz * (d / 2 - 0.015), G.g);
      put(box(w - 0.06, h - 0.03, d - 0.06, belt), 0, (h - 0.03) / 2 + 0.01, 0, G.g);
      for (const sx of [-1, 1]) { const r = put(cyl(h / 2 - 0.01, d - 0.06, rubber, 18), sx * (w / 2 - 0.03), h / 2, 0, G.g); r.rotation.x = Math.PI / 2; }
      const n = Math.max(4, Math.round(w / 0.25)), pitch = w / n, stripes = [];
      for (let i = 0; i < n; i++) stripes.push(put(box(0.012, 0.004, d - 0.1, mat(0x3a444d)), 0, h, 0, G.g));
      const motor = put(box(0.1, 0.1, 0.08, dark), -w / 2 + 0.12, h / 2, d / 2 + 0.04, G.g), lamp = put(led(0.012), -w / 2 + 0.12, h / 2 + 0.06, d / 2 + 0.04, G.g);
      motor.userData.part = G.p.id;
      let phase = 0, lastT = null;
      G.update = st => {
        const on = G.p.bind.out ? st.coil(G.p.bind.out) : st.running, dt = lastT == null ? 0 : Math.max(0, Math.min(0.1, st.t - lastT)); lastT = st.t;
        if (on && st.running) phase = (phase + G.p.props.speed * dt) % pitch;
        stripes.forEach((s, i) => { s.position.x = ((i * pitch + phase) % w) - w / 2 + pitch / 2; });
        setLed(lamp, COL.on, on && st.running);
      };
    },
    pusher(G) {
      const p = G.p, d = DIR_VEC[p.props.dir] || DIR_VEC.z, b = bodyOf(p);
      put(box(...b.s, mat(0xd8342b, { metalness: 0.2 })), ...b.c, G.move);
      const cl = mountCyl(G.g, p, [-d[0] * 0.1, -d[1] * 0.1 + (d[1] ? 0 : b.c[1]), -d[2] * 0.1], d, { name: [-d[0] * 0.4, (d[1] ? -d[1] * 0.4 : b.c[1] + 0.12), -d[2] * 0.4] });
      if (!d[1]) put(box(0.08, 0.03, 0.08, steel), -d[0] * 0.3, 0.015, -d[2] * 0.3, G.g); // patte de fixation
      G.update = st => { const x = cl.x(st), m = moverPose(p, x); G.move.position.set(...m.o); };
    },
    stopper(G) {
      const p = G.p, b = bodyOf(p);
      put(box(...b.s, mat(0xd8342b, { metalness: 0.3 })), ...b.c, G.move);
      const cl = mountCyl(G.g, p, [0, -b.s[1] - 0.1, 0], [0, 1, 0], { up: [p.props.face === 'z' ? 0 : 1, 0, p.props.face === 'z' ? 1 : 0], name: [0.2, -b.s[1] - 0.25, 0] });
      G.update = st => { const x = cl.x(st), m = moverPose(p, x); G.move.position.set(...m.o); };
    },
    carriage(G) {
      const p = G.p, d = DIR_VEC[p.props.dir] || DIR_VEC.x, q = perp(d), [w, h, dd] = p.size, along = Math.abs(d[0]) ? w : Math.abs(d[2]) ? dd : h, across = Math.abs(d[0]) ? dd : w;
      const len = p.props.stroke + along, mid = p.props.stroke / 2;
      if (!d[1]) for (const s of [-1, 1]) { const r = box(Math.abs(d[0]) ? len : 0.03, 0.03, Math.abs(d[2]) ? len : 0.03, steel); put(r, d[0] * mid + q[0] * s * (across / 2 - 0.03), -0.02, d[2] * mid + q[2] * s * (across / 2 - 0.03), G.g); }
      else put(box(0.06, len, 0.06, steel), 0.0, mid - along / 2, -across / 2 - 0.03, G.g);
      put(box(w, h, dd, mat(0xb9c1c8, { metalness: 0.5, roughness: 0.45 })), 0, h / 2, 0, G.move);
      const off = q.map(v => v * (across / 2 + 0.07));
      const cl = mountCyl(G.g, p, [-d[0] * 0.1 + off[0], -d[1] * 0.1 + (d[1] ? 0 : 0.02) + off[1], -d[2] * 0.1 + off[2]], d, { name: [off[0] - d[0] * 0.3, 0.14, off[2] - d[2] * 0.3] });
      G.update = st => { const x = cl.x(st), m = moverPose(p, x); G.move.position.set(...m.o); };
    },
    rotary(G) {
      const p = G.p, ax = p.props.axis || 'z', L = p.props.length, b = bodyOf(p);
      const axle = put(cyl(0.03, 0.2, steel, 16), 0, 0, 0, G.g); if (ax === 'x') axle.rotation.z = Math.PI / 2; else if (ax === 'z') axle.rotation.x = Math.PI / 2;
      put(box(0.12, 0.12, 0.12, dark), ...(ax === 'z' ? [0, 0, -0.14] : ax === 'x' ? [-0.14, 0, 0] : [0, -0.14, 0]), G.g);
      if (L >= 0.8) { const n = Math.max(2, Math.round(L / 0.3)); for (let i = 0; i < n; i++) put(box(L / n, b.s[1], b.s[2], i % 2 ? mat(0xd8342b) : mat(0xeef0f2)), L / n / 2 + i * L / n, 0, 0, G.move); }
      else put(box(...b.s, mat(0xb9c1c8, { metalness: 0.5 })), ...b.c, G.move);
      const pin = put(cyl(0.015, 0.1, steel, 10), 0.18, 0, 0, G.move); pin.rotation.x = ax === 'z' ? Math.PI / 2 : 0;
      const cl = mountCyl(G.g, p, [0.18, -0.6, 0], [0, 1, 0], { name: [0.45, -0.5, 0] }), link = put(box(0.025, 1, 0.025, steel), 0, 0, 0, G.g), tipV = new THREE.Vector3(), pinV = new THREE.Vector3(), M4 = new THREE.Matrix4();
      G.update = st => {
        const x = cl.x(st), m = moverPose(p, x); G.move.quaternion.setFromRotationMatrix(M4.set(m.R[0], m.R[1], m.R[2], 0, m.R[3], m.R[4], m.R[5], 0, m.R[6], m.R[7], m.R[8], 0, 0, 0, 0, 1));
        // Biellette : du nez de tige (vertical sous le maneton) au maneton qui tourne avec le bras.
        tipV.set(0.18, -0.6 + 0.1 + (p.props.stroke || 0.25) * x, 0); pin.getWorldPosition(pinV); G.g.worldToLocal(pinV);
        link.position.copy(tipV).add(pinV).multiplyScalar(0.5); link.scale.y = Math.max(0.01, tipV.distanceTo(pinV)); link.lookAt(G.g.localToWorld(pinV.clone())); link.rotateX(Math.PI / 2);
      };
    },
    gripper(G) {
      const p = G.p, rod = put(cyl(0.012, 0.3, steel, 12), 0, 0.17, 0, G.g), cup = put(cyl(0.035, 0.02, rubber, 20), 0, 0.01, 0, G.g), lamp = put(led(0.01), 0.04, 0.05, 0, G.g);
      put(box(0.06, 0.04, 0.06, dark), 0, 0.05, 0, G.g); rod.userData.part = p.id;
      G.update = st => { const held = !!(st.proc && st.proc.items && st.proc.items.some(it => it.held === p.id)); setLed(lamp, COL.on, held); cup.material.color.setHex(held ? 0x2f6f3f : 0x1d2124); };
    },
    tool(G) {
      const p = G.p, d = DIR_VEC[p.props.dir] || DIR_VEC['-y'], b = bodyOf(p);
      put(box(...b.s, mat(0x2f6f9f, { metalness: 0.3 })), ...b.c, G.move);
      const bit = put(cyl(0.008, 0.1, mat(0xe6eaee, { metalness: 0.9, roughness: 0.2 }), 10), -d[0] * 0.05, -d[1] * 0.05, -d[2] * 0.05, G.move); if (!d[1]) bit.rotation.z = Math.PI / 2;
      const cl = mountCyl(G.g, p, [-d[0] * 0.3, -d[1] * 0.3, -d[2] * 0.3], d, { name: [0.3, -d[1] * 0.5, 0] });
      G.update = st => { const x = cl.x(st), m = moverPose(p, x); G.move.position.set(...m.o); };
    },
    photocell(G) {
      const p = G.p, d = DIR_VEC[p.props.dir] || DIR_VEC.z, r = p.props.range;
      put(box(0.04, 0.06, 0.04, dark), 0, 0, 0, G.g); put(box(0.03, 0.06, 0.03, mat(0xeef0f2)), d[0] * r, d[1] * r, d[2] * r, G.g);
      const beamM = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.35 }), beam = ghost(put(box(Math.abs(d[0]) ? r : 0.006, Math.abs(d[1]) ? r : 0.006, Math.abs(d[2]) ? r : 0.006, beamM), d[0] * r / 2, d[1] * r / 2, d[2] * r / 2, G.g));
      const lamp = put(led(0.009), 0, 0.045, 0, G.g), tag = put(label(signalOf(p), 0.045), 0, 0.1, 0, G.g); tag.userData.tag = true;
      G.update = st => { const on = st.sensor(signalOf(p)); setLed(lamp, COL.amber, on); beamM.opacity = on ? 0.75 : 0.3; };
      G.beam = beam;
    },
    proximity(G) {
      const p = G.p, z = p.props.zone;
      const body = put(cyl(0.015, 0.06, dark, 12), 0, -0.03 - z / 2, 0, G.g); body.userData.part = p.id;
      const zone = ghost(put(new THREE.Mesh(new THREE.BoxGeometry(z, z, z), new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.12 })), 0, 0, 0, G.g));
      const lamp = put(led(0.009), 0, -z / 2 - 0.07, 0, G.g), tag = put(label(signalOf(p), 0.045), 0, z / 2 + 0.05, 0, G.g);
      G.update = st => { const on = st.sensor(signalOf(p)); setLed(lamp, COL.amber, on); zone.material.opacity = on ? 0.35 : 0.12; };
      G.zone = zone; G.tag = tag;
    },
    source(G) {
      const p = G.p, K = ITEMS[p.props.item] || ITEMS.box, [w, h, d] = K.size, m = mat(0x59636c, { metalness: 0.4 });
      for (const [x, z, sx, sz] of [[w / 2 + 0.02, 0, 0.02, d + 0.08], [-w / 2 - 0.02, 0, 0.02, d + 0.08], [0, d / 2 + 0.02, w + 0.08, 0.02], [0, -d / 2 - 0.02, w + 0.08, 0.02]]) put(box(sx, 0.03, sz, m), x, h + 0.25, z, G.g);
      for (const [x, z] of [[w / 2 + 0.02, d / 2 + 0.02], [-w / 2 - 0.02, -d / 2 - 0.02]]) put(box(0.02, 0.3, 0.02, m), x, h + 0.1, z, G.g);
      const arrow = put(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 12), yellow), 0, h + 0.08, 0, G.g); arrow.rotation.x = Math.PI; arrow.userData.part = p.id;
      const zone = ghost(put(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.15, wireframe: true })), 0, h / 2, 0, G.g));
      put(label(partLabel(p), 0.05), 0, h + 0.36, 0, G.g);
      G.zone = zone;
      const lit = mat(0x4ade80);
      G.update = () => { const t = flashes.get(p.id) || 0, on = performance.now() - t < 300; if ((arrow.material === lit) !== on) arrow.material = on ? lit : yellow; };
    },
    sink(G) {
      const p = G.p, [w, h, d] = p.size, m = mat(0x4a5560, { roughness: 0.8 });
      put(box(w, 0.02, d, m), 0, 0.01, 0, G.g);
      for (const [x, z, sx, sz] of [[w / 2 - 0.01, 0, 0.02, d], [-w / 2 + 0.01, 0, 0.02, d], [0, d / 2 - 0.01, w, 0.02], [0, -d / 2 + 0.01, w, 0.02]]) put(box(sx, h, sz, m), x, h / 2, z, G.g);
      const zone = ghost(put(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.1, wireframe: true })), 0, h / 2, 0, G.g));
      put(label(partLabel(p), 0.055), 0, h + 0.08, 0, G.g);
      G.zone = zone;
    },
    dispenser(G) {
      const p = G.p, tank = put(cyl(0.11, 0.24, mat(0xcfe3f1, { transparent: true, opacity: 0.5, roughness: 0.1 }), 24), 0, 0.3, 0, G.g); tank.userData.part = p.id;
      put(cyl(0.02, 0.18, steel, 12), 0, 0.09, 0, G.g); put(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 12), steel), 0, 0.0, 0, G.g).rotation.x = Math.PI;
      const streamM = new THREE.MeshBasicMaterial({ color: 0x9b3b7a, transparent: true, opacity: 0.8 }), stream = ghost(put(cyl(0.008, 0.4, streamM, 8), 0, -0.2, 0, G.g));
      G.update = st => { stream.visible = !!(G.p.bind.out && st.coil(G.p.bind.out) && st.running); };
    },
    button(G) {
      const p = G.p, ped = put(box(0.09, 0.05, 0.09, dark), 0, 0.025, 0, G.g); ped.userData.part = p.id;
      const btn = pushBtn(p.id, 0.03, hex(p.props.color)); put(btn.g, 0, 0.05, 0, G.g); pick.push(btn.cap);
      put(label(p.name || p.bind.input || p.id, 0.05), 0, 0.14, 0, G.g);
      G.update = st => btn.set(st.role(p.id));
    },
    lamp(G) {
      const p = G.p, post = put(cyl(0.01, 0.12, steel, 10), 0, 0.06, 0, G.g), l = put(led(0.025), 0, 0.14, 0, G.g); post.userData.part = p.id;
      put(label(p.name || p.bind.out || p.id, 0.05), 0, 0.22, 0, G.g);
      G.update = st => setLed(l, hex(p.props.color), !!(p.bind.out && st.coil(p.bind.out) && st.running));
    },
    label(G) { const t = put(label(G.p.props.text || '…', 0.09, { bg: '#1f2a33dd' }), 0, 0, 0, G.g); t.userData.part = G.p.id; },
    model(G) {
      const p = G.p, b64 = cfg.assets && cfg.assets[p.props.asset];
      const holder = ghost(put(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0x9aa6af, wireframe: true })), 0, 0.15, 0, G.g)); holder.userData.part = p.id;
      if (!b64) return;
      try {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        new GLTFLoader().parse(bytes.buffer, '', g => { holder.visible = false; g.scene.scale.setScalar(p.props.scale || 1); g.scene.traverse(o => { if (o.isMesh) { o.userData.part = p.id; o.castShadow = true; o.receiveShadow = true; } }); G.g.add(g.scene); if (ctx.ask) ctx.ask(); }, () => { holder.material.color.setHex(0xef4444); });
      } catch (err) { holder.material.color.setHex(0xef4444); }
    }
  };
  for (const p of D.order) {
    const parent = p.parent && groups.get(p.parent) ? groups.get(p.parent).move : root;
    const g = new THREE.Group(); g.position.set(...p.pos); g.rotation.y = rad(p.rot); g.name = p.id; parent.add(g);
    const move = isMover(p) ? new THREE.Group() : g; if (move !== g) g.add(move);
    const G = { p, g, move, update: null }; groups.set(p.id, G);
    try { B[p.type](G); } catch (err) { console.warn('twin render', p.type, err); }
    g.traverse(o => { if (o.isMesh && !o.userData.part && !o.userData.ghost) o.userData.part = p.id; });
  }
  shadows(root);
  /* ---------- Pièces ---------- */
  const itemMeshes = new Map(), glassM = new THREE.MeshStandardMaterial({ color: 0xcfe3f1, transparent: true, opacity: 0.4, roughness: 0.1 }), juice = mat(0x9b3b7a), doneM = mat(0x4ade80, { emissive: 0x14532d, emissiveIntensity: 0.4 });
  function itemMesh(it) {
    const g = new THREE.Group(), [w, h, d] = it.s, m = mat(hex(it.color), { roughness: 0.6 });
    if (it.kind === 'bottle') { const body = put(cyl(w / 2, h, glassM, 16), 0, h / 2, 0, g); body.userData.ghost = true; const lvl = put(cyl(w / 2 - 0.006, h - 0.02, juice, 16), 0, 0.01, 0, g); lvl.scale.y = 0.001; g.userData.lvl = lvl; }
    else if (it.kind === 'puck') put(cyl(w / 2, h, m, 20), 0, h / 2, 0, g);
    else if (it.kind === 'car') { put(box(w, h * 0.5, d, m), 0, h * 0.25 + 0.02, 0, g); put(box(w * 0.5, h * 0.4, d * 0.86, m), -w * 0.05, h * 0.7, 0, g); for (const x of [-w * 0.32, w * 0.32]) for (const z of [-d / 2, d / 2]) { const wh = put(cyl(h * 0.2, 0.08, rubber, 14), x, h * 0.2, z, g); wh.rotation.x = Math.PI / 2; } }
    else { const bx = put(box(w, h, d, m), 0, h / 2, 0, g); if (it.kind === 'box') { put(box(w + 0.002, 0.03, d + 0.002, mat(0x8a6f4d)), 0, h / 2, 0, g); } g.userData.mesh = bx; }
    g.userData.m = m; root.add(g); shadows(g);
    return g;
  }
  function paintItems(st) {
    const list = st.proc && st.proc.key === D.key && st.proc.items ? st.proc.items : [], live = new Set();
    for (const it of list) {
      live.add(it.id); let g = itemMeshes.get(it.id); if (!g) { g = itemMesh(it); itemMeshes.set(it.id, g); }
      g.position.set(it.p[0], it.p[1], it.p[2]);
      if (g.userData.lvl) { g.userData.lvl.scale.y = Math.max(0.001, it.fill); }
      if (g.userData.mesh) g.userData.mesh.material = it.done ? doneM : g.userData.m;
    }
    for (const [id, g] of itemMeshes) if (!live.has(id)) { root.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); itemMeshes.delete(id); }
  }
  /* ---------- Construction : grille, zones, cadre de sélection ---------- */
  const grid = new THREE.GridHelper(12, 120, 0x3b82f6, 0x2a3a4a); grid.position.y = 0.002; grid.visible = false; root.add(grid);
  const axes = new THREE.AxesHelper(0.5); axes.visible = false; root.add(axes);
  let selBox = null, selId = null, ghostMesh = null, ghostH = 0;
  /** Aides de construction : { grid, zones } (ou un booléen pour tout) ; sans rien, la sélection s'efface. */
  function overlays(o) {
    const on = typeof o === 'object' && o ? o : { grid: !!o, zones: !!o };
    grid.visible = axes.visible = !!on.grid;
    for (const G of groups.values()) if (G.zone) G.zone.visible = !!on.zones || G.p.type === 'proximity';
    if (!on.grid && !on.zones) { select(null); ghostBox(null); }
    if (ctx.ask) ctx.ask();
  }
  /** Fantôme du composant à poser (boîte translucide de ses dimensions s), ou null pour l'ôter. */
  function ghostBox(spec) {
    if (ghostMesh) { root.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh.children.forEach(c => c.geometry && c.geometry.dispose()); ghostMesh = null; }
    if (!spec) { if (ctx.ask) ctx.ask(); return; }
    ghostMesh = new THREE.Mesh(new THREE.BoxGeometry(...spec.s), new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.22, depthWrite: false }));
    ghostMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(ghostMesh.geometry), new THREE.LineBasicMaterial({ color: 0x93c5fd })));
    ghostMesh.userData.ghost = true; ghostMesh.visible = false; ghostH = spec.s[1]; root.add(ghostMesh);
  }
  function ghostBoxAt(pos) { if (!ghostMesh) return; ghostMesh.visible = !!pos; if (pos) ghostMesh.position.set(pos[0], pos[1] + ghostH / 2, pos[2]); if (ctx.ask) ctx.ask(); }
  function select(id) {
    selId = id;
    if (selBox) { root.remove(selBox); selBox.dispose(); selBox = null; }
    const G = id && groups.get(id); if (!G) return;
    selBox = new THREE.BoxHelper(G.g, 0xf2c230); root.add(selBox);
  }
  // Cadrage : la boîte des composants (sans le sol).
  const bb = new THREE.Box3(); for (const G of groups.values()) if (!G.p.parent) bb.expandByObject(G.g);
  if (bb.isEmpty()) bb.set(V(-1, 0, -1), V(1, 1, 1));
  const c = bb.getCenter(V()), sz = bb.getSize(V()), dist = Math.max(1.0, Math.max(sz.x, sz.z) * 0.85 + sz.y * 0.4 + 0.5);
  camera.position.set(c.x + dist * 0.7, c.y + dist * 0.5, c.z + dist * 0.85); controls.target.copy(c);
  return {
    pick, near: 0.4, groups, kind: 'twin',
    act(role) { if (groups.has(role)) flashes.set(role, performance.now()); },
    update(st) { for (const G of groups.values()) if (G.update) G.update(st); paintItems(st); if (selBox) selBox.update(); },
    overlays, select, selected: () => selId, ghost: ghostBox, ghostAt: ghostBoxAt,
    /** Groupes de tête (sans sol, pièces ni aides) : ce qui s'exporte en glTF. */
    exportRoots: () => [...groups.values()].filter(G => !G.p.parent).map(G => G.g)
  };
}
