// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Jollof Studio : éditeur de circuits 3D, câblage animé et export vidéo.
// (Feuilles de style et polices : importées par boot.js, pour un premier affichage déjà mis en forme.)
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { M, V3 } from './library/kit.js';
import { LIBRARY, BY_ID, CATEGORIES } from './library/catalog.js';
import * as native from './native.js';
import { installSchool } from './school/index.js';
import { sanitizeProject, cleanText } from './sanitize.js';
import { createBench } from './sim/bench.js';
import { solveDC, resetDynamic } from './sim/dc.js';
import { wireFlows } from './sim/flow.js';
import { createFlow } from './sim/flowfx.js';
import { installLab } from './lab/index.js';
import { Q, LIGHT, LEVEL, CHOICE, stdMat, setQuality, autoLevel } from './quality.js';
import { menu as popMenu } from './school/ui.js';
import { BOARDS, boardOf, volts } from './sim/boards.js';
import { PARTS, partOf } from './sim/parts.js';
import { analyze, inspect, firstMsg, bbGroups } from './sim/circuit.js';
import { QUANT, ENV, INPUTS, MODELS, fmtQ, advance, sample as readSensor } from './sim/models.js';
import { planWiring, planJoinGround, explain, wirable, needsWiring } from './sim/autowire.js';
import { makeLabel, paintLabel, disposeLabel } from './sim/labels.js';
import { collectFaults, elecFaults } from './sim/faults.js';
import { createFx } from './sim/fx.js';
import { renderDoc, docIndex } from './library/docs.js';
import { renderBoardGuide } from './library/boardguide.js';
import { createPreview } from './library/preview.js';
import { fillThumbnails } from './library/thumbs.js';
import { icon, hydrateIcons, CAT_ICON } from './ui/icons.js';
import { loadCadLibrary, REAL, setRealistic, cadManifest } from './cad/library.js';
import { FAMILIES, MODULE_ROLES, guessRole, parseBoardPin, buildBoardProfile, buildModuleSpec } from './sim/custom.js';
import { createProgram } from './prog/panel.js';
import { installPeripherals } from './sim/peripherals.js';
import { driveActuators, resetActuators } from './sim/actuators.js';
import * as audio from './sim/audio.js';
import { buildSchematic, frame as sheetFrame, SHEET_SCALE } from './schematic/sheet.js';
import { createSchView } from './schematic/live.js';
import { installCheck } from './check/ui.js';
import { BY_KEY as CHECK_CODE } from './check/codes.js';
import { routeWires } from './sim/wiring.js';
import { createGuides, textSprite, dispose as disposeSprite } from './ui/guides.js';
import { createBlocks, BLOCK_COLORS } from './ui/blocks.js';
import { toSvg, toPdf, Draw, textWidth } from './schematic/draw.js';
import { tl, isEn, translateDom, checkInstallLanguage, DEC, locale } from './i18n/index.js';
import { creditsHtml } from './library/credits.js';
import * as TL from './video/timeline.js';
import { createTimelineDock } from './video/dock.js';

/** Projets du dossier exemples/, intégrés à l'application. */
const EXAMPLES = Object.entries(import.meta.glob('../exemples/*.jollof', { query: '?raw', import: 'default', eager: true }))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, text]) => ({ file: path.split('/').pop(), data: localizeExample(JSON.parse(text)) }));

/** Exemple dans la langue de l'interface : le fichier peut porter sa version anglaise (champ « en »). */
function localizeExample(d) {
  const en = d.en; delete d.en;
  if (!isEn) return d;
  const out = { ...d, name: (en && en.name) || tl(d.name), description: (en && en.description) || tl(d.description || ''), wires: (d.wires || []).map(w => (w.role ? { ...w, role: tl(w.role) } : w)) };
  if (en && en.code && d.settings && d.settings.prog) {
    const prog = JSON.parse(JSON.stringify(d.settings.prog));
    for (const [id, code] of Object.entries(en.code)) if (prog.boards && prog.boards[id]) prog.boards[id].code = Array.isArray(code) ? code.join('\n') : code;
    out.settings = { ...d.settings, prog };
  }
  return out;
}

const $ = s => document.querySelector(s);
const mk = (g, m) => new THREE.Mesh(g, m);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = {
  comps: [], wires: [], pinHits: [], color: '#f2c94c', sel: null, selWire: null, pending: null, hover: null,
  anim: null, rec: null, drag: null, wireDrag: null, endDrag: null, placing: false, caption: '',
  projectPath: null, projectName: tl('Sans titre'), dirty: false, userLib: [], video: null, simOn: false, simLast: 0,
  faults: [], faultKeys: new Set(), faultWires: new Map(), glowing: new Set(), fly: null, shots: [], vr: null, netNames: {}, netView: false,
  // Timeline de la vidéo (src/video/timeline.js) : automatique tant qu'on ne la modifie pas à la main.
  timeline: TL.buildAuto('seq', [], 1.2),
  // Dernier état de la simulation, partagé avec les programmes : analyse, inspections, sorties des capteurs.
  simA: null, insMap: new Map(), drive: new Map(), pinComps: new Map(), progLast: 0, pressing: null,
  // Blocs (cadres nommés) et modules optionnels (édition Pro) : crochets d'image, sélection d'un point de la scène, données.
  blockDraw: false, blockRect: null, blockDrag: null, blockResize: null, frameHooks: [], changeHooks: [], pick: null, modules: new Map(), modulesRaw: {}
};
// Timeline sous le plan de travail (src/video/dock.js), créée dans bindUI ; pistes ajoutées par les modules.
const TRACKS = [];
let timelineDock = { update() {}, refresh() {}, markWire() {}, open: false };
const COLORS = [[tl('Rouge'), '#e5484d'], [tl('Noir'), '#3a3f45'], [tl('Jaune'), '#f2c94c'], [tl('Orange'), '#f08a3c'], [tl('Vert'), '#3fb27f'], [tl('Bleu'), '#3b82f6'], [tl('Violet'), '#9b7be0'], [tl('Blanc'), '#e9e9e6']];
const HIT = new THREE.BoxGeometry(2.6, 4.5, 2.6);
const CONN = new THREE.BoxGeometry(2.4, 6, 2.4);
const BEAD = new THREE.SphereGeometry(0.95, 16, 12);
const POINT_PIN = new THREE.SphereGeometry(0.9, 16, 12);
const MARK = new THREE.SphereGeometry(1.1, 12, 8);

/* ---------- Broches ---------- */
const same = (x, y) => !!x && !!y && x.comp === y.comp && x.key === y.key;
function regPin(comp, name, mesh, attach) {
  let key = name, n = 2;
  while (comp.pins[key]) key = `${name} (${n++})`;
  const hit = mk(HIT, M.hit);
  hit.position.copy(attach).add(new V3(0, -1.2, 0));
  hit.userData.pin = { comp, key };
  comp.group.add(hit);
  comp.pins[key] = { mesh, base: mesh.material, hit, attach };
  S.pinHits.push(hit);
}
let hlPins = [];
function paintPin(ref) {
  if (!ref) return;
  const p = ref.comp.pins[ref.key]; if (!p) return;
  const on = same(S.hover, ref) || same(S.pending, ref) || hlPins.some(h => same(h, ref));
  p.mesh.material = on ? M.goldHi : p.base;
  if (p.base === M.hole || p.base === M.hit) p.mesh.visible = on; // trou de breadboard : visible seulement survolé
}
function pinWorld(ref) { ref.comp.group.updateMatrixWorld(true); return ref.comp.group.localToWorld(ref.comp.pins[ref.key].attach.clone()); }
const baseKey = k => k.replace(/ \(\d+\)$/, '');

/* ---------- Composants ---------- */
const prettyCount = {};
function nextName(type, base) {
  const e = BY_ID[type], p = base || (e ? e.pre : 'MOD'), single = e ? e.single : !!base;
  if (single && !S.comps.some(c => c.name === p)) return p;
  let n = single ? 2 : 1;
  const nm = i => single ? `${p}-${i}` : p + i;
  while (S.comps.some(c => c.name === nm(n))) n++;
  return nm(n);
}
function createComp(type, o = {}) {
  const comp = { id: o.id || type + '_' + Math.random().toString(36).slice(2, 8), type, group: new THREE.Group(), pins: {} };
  comp.name = o.name || nextName(type, o.custom && o.custom.name.toUpperCase().slice(0, 10));
  comp.group.userData.comp = comp;
  const ctx = { g: comp.group, pin: (name, mesh, attach) => regPin(comp, name, mesh, attach) };
  if (type === 'custom') {
    comp.model = o.model; comp.custom = o.custom; comp.group.add(o.model);
    o.custom.pins.forEach(p => addPointPin(comp, p.name, new V3(p.x, p.y, p.z), false));
    applyDef(comp);
  } else if (o.skinModel) {
    // Composant de la bibliothèque habillé d'un modèle CAO importé : mêmes broches, posées par calibrage.
    comp.skin = o.skin; comp.model = o.skinModel; comp.group.add(o.skinModel);
    for (const [key, p] of Object.entries(o.skin.pins)) { const m = mk(MARK, M.hole); m.position.set(p[0], p[1], p[2]); comp.group.add(m); regPin(comp, key, m, new V3(p[0], p[1], p[2])); }
  } else {
    BY_ID[type].build(ctx);
    // Pièces animées déclarées par le constructeur (LED, écran, LED RVB, NeoPixel, relais,
    // afficheur 7 segments, palonnier de servo, rotor de moteur) : la simulation les fait bouger.
    for (const k of ['led', 'screen', 'rgb', 'pixels', 'relay', 'seg7', 'servo', 'spin', 'buzz', 'water']) if (ctx[k]) comp[k] = ctx[k];
  }
  comp.inp = { ...(INPUTS[type] || {}), ...(o.inp || {}) };
  // Rendu léger : les cibles invisibles des broches (des centaines par breadboard) sont cachées à
  // l'objet, pas seulement par leur matière : le moteur 3D ne les parcourt plus à chaque image (le
  // lancer de rayons les trouve toujours). Les pièces fixes gardent une matrice calculée une fois :
  // seul le groupe du composant bouge (déplacement, rotation) ; servo et moteur restent animés.
  const moving = new Set([comp.servo && comp.servo.piv, comp.spin && comp.spin.obj, comp.buzz && comp.buzz.obj, comp.water && comp.water.obj, ...(comp.water ? comp.water.drops : [])].filter(Boolean));
  comp.group.traverse(m => {
    if (m.isMesh && (m.material === M.hit || m.material === M.hole)) m.visible = false;
    else if (m.isMesh) { m.castShadow = Q.shadows; m.receiveShadow = Q.shadows; }
    if (m !== comp.group && !moving.has(m)) { m.updateMatrix(); m.matrixAutoUpdate = false; }
  });
  comp.group.position.set(o.x || 0, 0, o.z || 0);
  comp.group.rotation.y = o.r || 0;
  scene.add(comp.group); S.comps.push(comp); comp.group.updateMatrixWorld(true);
  return comp;
}
function addPointPin(comp, name, local, record = true) {
  const m = mk(POINT_PIN, M.gold); m.position.copy(local); comp.group.add(m);
  regPin(comp, name, m, local.clone());
  if (record) comp.custom.pins.push({ name, x: +local.x.toFixed(3), y: +local.y.toFixed(3), z: +local.z.toFixed(3) });
}
/** Retire un composant. `silent` : sans trace dans l'historique (composant glissé puis abandonné). */
function removeComp(comp, silent) {
  S.wires.filter(w => w.a.comp === comp || w.b.comp === comp).forEach(removeWire);
  Object.values(comp.pins).forEach(p => { const i = S.pinHits.indexOf(p.hit); if (i > -1) S.pinHits.splice(i, 1); });
  dropLabel(comp); scene.remove(comp.group); S.comps.splice(S.comps.indexOf(comp), 1);
  if (S.sel === comp) select(null);
  if (!silent) { renderWires(); changed(); }
}
/** Centre libre le plus proche de (ox, oz) pour une emprise `size`, en spirale ; null si tout est pris. */
function freeSpot(size, ox, oz, others, r0, dr) {
  for (let i = 0; i < 400; i++) {
    const a = i * 0.7, r = i === 0 ? 0 : r0 + i * dr;
    const x = Math.round(ox + Math.cos(a) * r), z = Math.round(oz + Math.sin(a) * r);
    const b = new THREE.Box3(new V3(x - size.x / 2, 0, z - size.z / 2), new V3(x + size.x / 2, size.y, z + size.z / 2));
    if (!others.some(o => o.intersectsBox(b))) return [x, z];
  }
  return null;
}
/** Place un composant sur une zone libre du tapis, en spirale autour de (ox, oz). */
function placeFree(comp, ox = controls.target.x, oz = controls.target.z, r0 = 20, dr = 4) {
  const others = S.comps.filter(c => c !== comp).map(c => new THREE.Box3().setFromObject(c.group).expandByScalar(4));
  const size = new THREE.Box3().setFromObject(comp.group).getSize(new V3()), p = freeSpot(size, ox, oz, others, r0, dr);
  if (p) { comp.group.position.set(p[0], 0, p[1]); comp.group.updateMatrixWorld(true); }
}

/* ---------- Fils ---------- */
const RAD = Q.wireRadial; // segments autour d'un fil (moins en mode léger)
/** Style des fils : « rangés » (tracés à angle droit, sans collision) ou « souples » (arcs). */
const WIRES = { style: 'tidy' };
try { if (localStorage.getItem('jollof-wires') === 'soft') WIRES.style = 'soft'; } catch (e) { /* stockage indisponible */ }
/**
 * Un fil a changé (créé, rebranché, composant déplacé, couleur…). Le tracé de tous les fils
 * dépend des autres : il est recalculé une fois, à la prochaine image (ou à la demande).
 */
function buildWire(w) { w.sig = null; S.wiresDirty = true; }
function flushWires() { if (S.wiresDirty) layoutWires(); }
/** Emprise d'un composant, gardée tant qu'il ne bouge pas. */
function compBox(c) {
  const p = c.group.position, k = `${p.x},${p.z},${c.group.rotation.y},${REAL.on}`;
  if (c.boxKey !== k) { c.box = new THREE.Box3().setFromObject(c.group); c.boxKey = k; }
  return c.box;
}
/** Polyligne à coins arrondis, pour un fil rangé. */
function roundedPath(pts, r = 2.6) {
  const path = new THREE.CurvePath();
  let prev = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], d1 = p.clone().sub(prev), d2 = pts[i + 1].clone().sub(p), l1 = d1.length(), l2 = d2.length();
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 0.05) { path.add(new THREE.LineCurve3(prev, p)); prev = p; continue; }
    const a = p.clone().addScaledVector(d1.normalize(), -rr), b = p.clone().addScaledVector(d2.normalize(), rr);
    if (a.distanceTo(prev) > 1e-3) path.add(new THREE.LineCurve3(prev, a));
    path.add(new THREE.QuadraticBezierCurve3(a, p.clone(), b));
    prev = b;
  }
  path.add(new THREE.LineCurve3(prev, pts[pts.length - 1]));
  return path;
}
/** Arc souple d'un fil (ancien style). */
function softCurve(w) {
  const a = pinWorld(w.a), b = pinWorld(w.b); a.y += 4.5; b.y += 4.5;
  const d = a.distanceTo(b), h = 6 + d * 0.28;
  const mid = a.clone().add(b).multiplyScalar(0.5); mid.y = Math.max(a.y, b.y) + h;
  const dir = b.clone().sub(a); dir.y = 0;
  if (dir.lengthSq() > 0) { const perp = new V3(-dir.z, 0, dir.x).normalize(); mid.addScaledVector(perp, ((S.wires.indexOf(w) % 5) - 2) * 1.6); }
  return new THREE.CatmullRomCurve3([a, a.clone().add(new V3(0, h * 0.45, 0)), mid, b.clone().add(new V3(0, h * 0.45, 0)), b], false, 'centripetal');
}
/**
 * Trace tous les fils. Seuls ceux dont le tracé a changé sont reconstruits. Pendant le
 * déplacement d'un composant d'un grand montage, seuls ses fils sont recalculés ; le
 * rangement complet suit au lâcher.
 */
function layoutWires() {
  S.wiresDirty = false;
  const live = S.wires.filter(w => w.a.comp.pins[w.a.key] && w.b.comp.pins[w.b.key]);
  if (WIRES.style !== 'tidy') { live.forEach(w => applyWire(w, null)); return; }
  const boxes = S.comps.map(c => { const b = compBox(c); return { comp: c.id, x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z, top: b.max.y }; });
  const moving = S.drag && S.drag.comp, partial = !!moving && live.length > 40;
  const items = live.map((w, i) => {
    const it = { id: i, A: pinWorld(w.a), B: pinWorld(w.b), own: [w.a.comp.id, w.b.comp.id] };
    if (partial && w.route && w.a.comp !== moving && w.b.comp !== moving) it.fixed = { p: w.route.p, h: w.route.h };
    return it;
  });
  S.wiresPartial = partial;
  // Très grand montage : le rangement complet se calcule à côté, l'interface ne se fige pas.
  if (!partial && live.length > 250 && wireWorker()) { routeAside(live, items, boxes); return; }
  const routes = routeWires(items.map(it => ({ ...it, own: new Set(it.own) })), boxes);
  live.forEach((w, i) => applyWire(w, routes.get(i)));
}
let worker = null, workerSeq = 0, workerBusy = false;
function wireWorker() {
  if (worker === false) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./sim/wiring.worker.js', import.meta.url), { type: 'module' });
      worker.onerror = () => { worker = false; S.wiresDirty = true; };
    } catch (e) { worker = false; return null; }
  }
  return worker;
}
function routeAside(live, items, boxes) {
  // En attendant le résultat, un nouveau fil s'affiche en arc pour ne pas rester invisible.
  live.forEach(w => { if (!w.mesh) applyWire(w, null); });
  if (workerBusy) { S.wiresAgain = true; return; }
  workerBusy = true;
  const seq = ++workerSeq;
  worker.onmessage = e => {
    workerBusy = false;
    if (e.data.seq !== seq) return;
    const routes = new Map(e.data.routes);
    live.forEach((w, i) => { if (S.wires.includes(w)) applyWire(w, routes.get(i)); });
    if (S.wiresAgain) { S.wiresAgain = false; S.wiresDirty = true; }
  };
  worker.postMessage({ seq, items: items.map(it => ({ ...it, A: { x: it.A.x, y: it.A.y, z: it.A.z }, B: { x: it.B.x, y: it.B.y, z: it.B.z } })), boxes });
}
/** Reconstruit un fil seulement si son tracé ou sa couleur a changé. route = null : arc souple. */
function applyWire(w, r) {
  let sig, curve;
  if (r) {
    w.route = r;
    sig = r.pts.map(q => q.map(v => v.toFixed(2)).join(',')).join(';');
    curve = () => roundedPath(r.pts.map(q => new V3(q[0], q[1], q[2])));
  } else {
    const a = pinWorld(w.a), b = pinWorld(w.b);
    sig = `soft|${a.toArray().map(v => v.toFixed(2))}|${b.toArray().map(v => v.toFixed(2))}|${S.wires.indexOf(w) % 5}`;
    curve = () => softCurve(w);
  }
  sig += '|' + w.color;
  if (w.sig === sig && w.mesh) return;
  w.sig = sig; makeWireMesh(w, curve(), r ? r.pts.length : 4);
}
function makeWireMesh(w, curve, corners) {
  disposeWire(w);
  const a = pinWorld(w.a), b = pinWorld(w.b);
  w.cA = mk(CONN, M.plastic); w.cA.position.copy(a).add(new V3(0, 1.5, 0));
  w.cB = mk(CONN, M.plastic); w.cB.position.copy(b).add(new V3(0, 1.5, 0));
  w.curve = curve;
  // Assez de tronçons pour des coins bien ronds, pas davantage : la scène reste légère.
  w.tub = Math.max(16, Math.min(360, Math.round((curve.getLength() / 1.8 + corners * 6) * Q.wireDiv)));
  w.mesh = mk(new THREE.TubeGeometry(curve, w.tub, 0.55, RAD, false), stdMat({ color: w.color, roughness: 0.42, metalness: 0.05 }));
  w.mesh.castShadow = true;
  w.bead = mk(BEAD, stdMat({ color: w.color, emissive: new THREE.Color(w.color).multiplyScalar(0.7) }));
  scene.add(w.mesh, w.cA, w.cB, w.bead);
  setProgress(w, w.progress ?? 1);
  if (w === S.selWire) selectWire(w);
}
function disposeWire(w) {
  if (!w.mesh) return;
  scene.remove(w.mesh, w.cA, w.cB, w.bead);
  w.mesh.geometry.dispose(); w.mesh.material.dispose(); w.bead.material.dispose(); w.mesh = null;
}
function setProgress(w, p) {
  w.progress = p; if (!w.mesh) return;
  w.mesh.visible = p > 0; w.mesh.geometry.setDrawRange(0, Math.round(p * w.tub) * RAD * 6);
  w.cA.visible = p > 0; w.cB.visible = p >= 1;
  w.bead.visible = p > 0 && p < 1; if (w.bead.visible) w.bead.position.copy(w.curve.getPointAt(p));
}
/** `id` : identifiant gardé d'un projet ouvert (null : donné plus tard) ; absent : nouvel identifiant. */
function addWire(a, b, color, silent, id) {
  const w = { id: id === undefined ? TL.nextId('w', S.wires) : id, a, b, color, progress: 1 }; S.wires.push(w); buildWire(w);
  if (!silent) { renderWires(); updatePower(); changed(); }
  return w;
}
function removeWire(w) { if (w === S.selWire) selectWire(null); disposeWire(w); S.wires.splice(S.wires.indexOf(w), 1); S.wiresDirty = true; }
function rebuildFor(comp) { S.wires.filter(w => w.a.comp === comp || w.b.comp === comp).forEach(buildWire); }
const wireLabel = w => `${w.a.comp.name} ${w.a.key} → ${w.b.comp.name} ${w.b.key}`;
/** Allume les LED dont l'anode reçoit du courant (alimentation ou GPIO, résistance comprise) et dont la cathode rejoint la masse. */
function updatePower() {
  const A = analyze(S.comps, S.wires);
  S.comps.filter(c => c.led).forEach(c => {
    const a = A.wnet({ comp: c, key: 'A' }), k = A.wnet({ comp: c, key: 'K' });
    const ok = (a.src.length > 0 || a.gpio.length > 0) && k.gnd.length > 0 && !a.gnd.length;
    c.led.mat.emissive.setHex(ok ? c.led.glow : 0x000000); c.led.mat.emissiveIntensity = ok ? 1.3 : 0; c.led.light.intensity = ok ? 1.6 : 0;
  });
  $('#issues').innerHTML = A.issues.map(i => `<li>${esc(i.text)}</li>`).join('');
}

/* ---------- Scène ---------- */
let renderer, scene, camera, controls, selHelper, rubber, handles, fx, ground, sun, rim, ledLamps = [], guides, blocks, blockPreview;
const TILE = 100; // un carreau du tapis : 100 mm, quadrillé tous les 10 mm
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new V3(0, 1, 0), 0);
function matTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#161d22'; x.fillRect(0, 0, 512, 512);
  x.strokeStyle = '#1f292f'; x.lineWidth = 1;
  for (let i = 1; i < 10; i++) { const p = i * 51.2 + 0.5; x.beginPath(); x.moveTo(p, 0); x.lineTo(p, 512); x.moveTo(0, p); x.lineTo(512, p); x.stroke(); }
  x.strokeStyle = '#2a3840'; x.lineWidth = 2; x.strokeRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8000 / TILE, 8000 / TILE);
  t.anisotropy = Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy()); return t;
}
function initScene() {
  const stage = $('#stage');
  // Profil graphique (quality.js) : en mode léger, ni anticrénelage ni ombres, précision moyenne.
  renderer = new THREE.WebGLRenderer({ antialias: Q.antialias, preserveDrawingBuffer: !LIGHT, /* copie d'image inutile en mode léger : la vidéo lit le canevas juste après le rendu */ precision: Q.precision, powerPreference: LIGHT ? 'default' : 'high-performance' });
  renderer.setPixelRatio(Q.pixelRatio);
  // Construction finale : pas de vérification synchrone de chaque shader (elle bloque le démarrage).
  renderer.debug.checkShaderErrors = !import.meta.env.PROD;
  renderer.shadowMap.enabled = Q.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.prepend(renderer.domElement);
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x0f1316); if (Q.fog) scene.fog = new THREE.Fog(0x0f1316, 500, 1100);
  camera = new THREE.PerspectiveCamera(36, 1, 1, 40000); camera.position.set(70, 125, 150);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(8, 0, 10); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.47;
  // Plan de travail sans limite : on se déplace où l'on veut, et l'on recule assez pour voir un grand montage.
  controls.minDistance = 25; controls.maxDistance = 6000; controls.autoRotateSpeed = 0.7; controls.screenSpacePanning = false;
  controls.enableZoom = false; // le zoom vise le point sous le curseur (voir zoomAt)
  scene.add(new THREE.HemisphereLight(0xdfe8ee, 0x1a1f24, 0.7));
  sun = new THREE.DirectionalLight(0xffffff, 1.05); sun.position.set(90, 190, 110); sun.castShadow = Q.shadows;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -220, right: 220, top: 220, bottom: -220, near: 10, far: 600 });
  sun.shadow.bias = -0.0005; scene.add(sun, sun.target);
  rim = new THREE.DirectionalLight(0xe0703a, 0.2); rim.position.set(-120, 60, -90); scene.add(rim, rim.target);
  // Tapis de 8 m de côté qui suit la vue par pas d'un carreau : il paraît infini et son quadrillage ne glisse pas.
  ground = mk(new THREE.PlaneGeometry(8000, 8000), stdMat({ map: matTexture(), roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  // Quelques lampes partagées par toutes les LED : leur nombre ne change jamais, les matières ne se recompilent pas,
  // et un montage de cent LED reste fluide.
  ledLamps = Array.from({ length: Q.lamps }, () => { const l = new THREE.PointLight(0xffffff, 0, 60, 2); scene.add(l); return l; });
  selHelper = new THREE.Box3Helper(new THREE.Box3(), 0xe0703a); selHelper.visible = false; scene.add(selHelper);
  rubber = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(), new V3()]), new THREE.LineBasicMaterial({ color: 0xe0703a }));
  rubber.visible = false; rubber.frustumCulled = false; scene.add(rubber);
  const hm = stdMat({ color: 0xe0703a, emissive: 0x7a3010, roughness: 0.35 });
  handles = ['a', 'b'].map(end => { const h = mk(new THREE.SphereGeometry(1.9, 20, 14), hm); h.userData.end = end; h.visible = false; scene.add(h); return h; });
  fx = createFx(scene);
  flow = createFlow(scene, { light: LIGHT });
  try { flow.enabled = localStorage.getItem('jollof-flow') !== '0'; } catch (e) { /* stockage indisponible */ }
  bench = createBench(stage, benchCtx);
  guides = createGuides({ scene, camera, controls, stage, comps: () => S.comps, boxOf: compBox, onDir: viewFrom, onHome: () => setView('iso') });
  blocks = createBlocks({ scene, camera, controls, comps: () => S.comps, wires: () => S.wires, boxOf: compBox });
  blockPreview = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 5 }, () => new V3())), new THREE.LineBasicMaterial({ color: 0xe0703a }));
  blockPreview.visible = false; blockPreview.frustumCulled = false; scene.add(blockPreview);
  new ResizeObserver(resize).observe(stage); resize();
}
function resize() {
  if (S.vr) return;
  const s = $('#stage'), w = s.clientWidth, h = s.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); invalidate();
}
function frameAll() {
  if (!S.comps.length) return;
  const b = new THREE.Box3(); S.comps.forEach(c => b.expandByObject(c.group));
  const center = b.getCenter(new V3()), size = b.getSize(new V3()).length();
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(center); camera.position.copy(center).addScaledVector(dir, Math.max(90, size * 1.32)); // marge : la barre du bas ne cache pas la dernière rangée
}

/* ---------- Animation ---------- */
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = t => Math.max(0, Math.min(1, t));
function setHL(refs) { const old = hlPins; hlPins = refs; old.forEach(paintPin); refs.forEach(paintPin); }
/**
 * Joue la timeline du projet, ou, avec `list`, une timeline provisoire où seuls ces fils se tracent
 * (câblage automatique : la sélection et la caméra ne bougent pas, rien n'est enregistré).
 */
function startAnim(list) {
  flushWires();
  if (!S.wires.length || (list && !list.length)) { status(tl('Ajoutez au moins un fil avant de lancer une animation.')); return false; }
  cancelPending(); if (!list) select(null); selectWire(null);
  const line = list ? TL.buildAuto('seq', list.map(w => w.id), +$('#dur').value) : S.timeline;
  S.anim = { tl: line, temp: !!list, t0: performance.now(), T: 0, paused: false, done: null };
  controls.autoRotate = $('#orbitOn').checked;
  applyAt(0);
  timelineDock.update();
  return true;
}
function runAnim(now) {
  const A = S.anim; if (A.paused) return;
  A.T = (now - A.t0) / 1000;
  applyAt(A.T);
  if (A.T >= TL.end(A.tl)) finishAnim();
}
const shotMap = () => new Map(S.shots.map(s => [s.id, s]));
const wireById = id => S.wires.find(w => w.id === id);
/** Pose la scène à l'instant T de l'animation en cours : fils, broches allumées, légende, caméra. */
function applyAt(T) {
  const A = S.anim, line = A.tl, r = TL.evalAt(line, T, shotMap());
  for (const w of S.wires) { const p = r.prog.get(w.id) ?? 1; if (w.progress !== p) setProgress(w, p); }
  const clip = r.cur >= 0 ? line.wires[r.cur] : null, grp = TL.together(clip), w = clip && !grp ? wireById(clip.ws[0]) : null;
  let cap;
  if (r.cap) cap = r.cap.text;
  else if (r.done || !clip) cap = tl('Circuit câblé');
  else if (grp) cap = tl('Câblage de {0} fils', clip.ws.length);
  else cap = w ? `${tl('Fil {0}/{1}', r.cur + 1, line.wires.length)}${w.role ? ' · ' + w.role : ''}|${wireLabel(w)}` : '';
  const want = w && r.started && !r.done ? [w.a, w.b] : [];
  if (want.length !== hlPins.length || want.some((p, i) => !same(p, hlPins[i]))) setHL(want);
  if (!A.temp && r.cam) applyCam(r.cam);
  const on = w && !r.done ? S.wires.indexOf(w) : -1;
  [...$('#wires').children].forEach((li, i) => li.classList.toggle('on', i === on));
  setCaption(cap);
  if (r.done !== A.done) { A.done = r.done; updatePower(); }
}
function finishAnim() {
  S.anim = null; controls.autoRotate = false; setHL([]); setCaption('');
  S.wires.forEach(w => setProgress(w, 1)); updatePower();
  [...$('#wires').children].forEach(li => li.classList.remove('on'));
  if (S.rec) stopRec();
  timelineDock.update();
  // Fils enfin tous tracés : les programmes générés tiennent compte du nouveau câblage.
  prog.circuitChanged(); if (S.sel) renderBehavior();
}
/** Aperçu figé à l'instant T (tête de lecture de la timeline). */
function previewAt(T) {
  if (S.rec || S.vr) return;
  if (S.anim && S.anim.temp) finishAnim();
  if (!S.anim && !startAnim()) return;
  const A = S.anim; A.paused = true; A.T = Math.max(0, Math.min(TL.end(A.tl), T));
  applyAt(A.T); invalidate(); timelineDock.update();
}
function playTimeline() {
  if (S.rec || S.vr) return;
  if (S.anim && S.anim.paused) { const A = S.anim; if (A.T >= TL.end(A.tl) - 0.01) A.T = 0; A.paused = false; A.t0 = performance.now() - A.T * 1000; timelineDock.update(); return; }
  if (S.anim) finishAnim();
  startAnim();
}
function pauseTimeline() { if (S.anim && !S.anim.temp && !S.rec) { S.anim.paused = true; timelineDock.update(); } }
function setCaption(c) {
  S.caption = $('#capOn').checked ? c : '';
  const el = $('#caption');
  if (!S.caption) { el.hidden = true; return; }
  const [a, b] = S.caption.split('|');
  el.innerHTML = b ? `<i>${esc(a)}</i>${esc(b)}` : esc(a); el.hidden = false;
}

/* ---------- Export vidéo ---------- */
function pickMime() {
  const list = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  return list.find(m => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
}
function startRec() {
  if (S.rec || S.vr) return;
  if (S.anim) finishAnim(); // aperçu ou animation en cours : la vidéo repart du début
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { status(tl('La webview de ce système ne permet pas l’enregistrement vidéo.')); return; }
  const gl = renderer.domElement, cv = document.createElement('canvas');
  cv.width = gl.width - (gl.width % 2); cv.height = gl.height - (gl.height % 2);
  const ctx = cv.getContext('2d'), mime = pickMime();
  let rec;
  try { rec = new MediaRecorder(cv.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : {}); }
  catch (e) { status(tl('L’enregistreur vidéo n’a pas pu démarrer : ') + e.message); return; }
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const type = rec.mimeType || mime || 'video/webm';
    showVideo(new Blob(chunks, { type }), cv.width, cv.height, type.includes('mp4') ? 'mp4' : 'webm', tl('temps réel'));
  };
  S.rec = { rec, cv, ctx };
  composite(); rec.start(200);
  if (!startAnim()) { S.rec = null; rec.stop(); return; }
  $('#recBadge').hidden = false; $('#recBtn').disabled = true; status(tl('Enregistrement en cours…'));
}
function showVideo(blob, w, h, ext, how) {
  const url = URL.createObjectURL(blob);
  if (S.video) URL.revokeObjectURL(S.video.url);
  S.video = { blob, url, name: `${S.projectName.replace(/\.jollof$/i, '')}.${ext}` };
  $('#vid').src = url;
  $('#vidMeta').textContent = tl('{0} × {1} px · {2} Mo · {3} · {4}', w, h, (blob.size / 1048576).toFixed(1).replace('.', DEC), ext.toUpperCase(), how);
  $('#modal').hidden = false; status(tl('Vidéo prête.'), 'ok');
}

/* ---------- Plans de caméra ---------- */
const v3a = v => v.toArray().map(x => +x.toFixed(2));
function addShot() { S.shots.push({ id: TL.nextId('s', S.shots), p: v3a(camera.position), t: v3a(controls.target) }); renderShots(); changed(); status(tl('Plan {0} ajouté : la vidéo passera par cette vue.', S.shots.length), 'ok'); }
/** Plans d'un projet : positions vérifiées, identifiants uniques (les anciens projets n'en ont pas). */
function loadShots(list) {
  const v3 = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
  const out = [], seen = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || !v3(s.p) || !v3(s.t)) continue;
    const id = typeof s.id === 'string' && /^s\d{1,6}$/.test(s.id) && !seen.has(s.id) ? s.id : null;
    if (id) seen.add(id);
    out.push({ ...s, id, p: [...s.p], t: [...s.t] });
  }
  out.forEach(s => { if (!s.id) { s.id = TL.nextId('s', out); } });
  return out;
}
function renderShots() {
  $('#shots').innerHTML = S.shots.length ? S.shots.map((s, i) => `<li><span class="n">${i + 1}</span><span class="l">${tl('Plan {0}', i + 1)}</span>
    <button type="button" data-go="${i}" title="${tl('Voir ce plan')}" aria-label="${tl('Voir le plan {0}', i + 1)}">${icon('eye')}</button><button type="button" data-set="${i}" title="${tl('Remplacer par la vue actuelle')}" aria-label="${tl('Remplacer le plan {0}', i + 1)}">${icon('frame')}</button><button type="button" data-del="${i}" title="${tl('Supprimer')}" aria-label="${tl('Supprimer le plan {0}', i + 1)}">${icon('trash')}</button></li>`).join('')
    : `<li class="emptyRow">${icon('frame')}<span>${tl('Aucun plan : la vidéo garde la vue actuelle. Placez la caméra puis ajoutez des vues : elle passera de l’une à l’autre.')}</span></li>`;
}
function applyCam(c) { camera.position.fromArray(c.p); controls.target.fromArray(c.t); camera.lookAt(controls.target); }
/** Accorde la timeline au montage (fils, plans) : refaite si elle est automatique, complétée sinon. */
function syncTimeline() {
  TL.sync(S.timeline, S.wires.map(w => w.id), S.shots.map(s => s.id), +$('#dur').value);
  const sel = $('#animMode'); if (sel) sel.value = S.timeline.auto || 'custom';
  timelineDock.refresh();
}

/* ---------- Rendu image par image ---------- */
const RES = { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] };
/** Choisit un encodeur : H.264 (MP4) si possible, sinon VP9. */
async function pickEncoder(W, H, fps, bitrate) {
  for (const [kind, codec] of [['avc', 'avc1.640034'], ['avc', 'avc1.4d0034'], ['avc', 'avc1.42003e'], ['vp9', 'vp09.00.50.08']]) {
    try { if ((await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate, framerate: fps })).supported) return { kind, codec }; } catch (e) { /* codec suivant */ }
  }
  return null;
}
/**
 * Calcule chaque image à son instant exact, puis l'encode : la vidéo est fluide même sur une
 * machine lente, à la résolution choisie. Repli sur l'enregistrement en temps réel sinon.
 */
async function renderVideo() {
  if (S.rec || S.vr) return;
  if (!S.wires.length) { status(tl('Ajoutez au moins un fil avant de rendre une vidéo.'), 'warn'); return; }
  const [W, H] = RES[$('#vRes').value] || RES[1080], fps = +$('#vFps').value || 30, bitrate = Math.round(W * H * fps * 0.12);
  const pick = window.VideoEncoder && window.VideoFrame ? await pickEncoder(W, H, fps, bitrate) : null;
  if (!pick) { status(tl('Encodage image par image indisponible sur ce système : enregistrement en temps réel.'), 'warn'); startRec(); return; }
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: pick.kind, width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
  let failure = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failure = e; } });
  enc.configure({ codec: pick.codec, width: W, height: H, bitrate, framerate: fps, ...(pick.kind === 'avc' ? { avc: { format: 'avc' } } : {}) });
  if (S.anim) finishAnim();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const target = { cv, ctx: cv.getContext('2d') };
  const saved = { pos: camera.position.clone(), tgt: controls.target.clone(), pr: renderer.getPixelRatio() };
  S.vr = { cancel: false };
  startAnim();
  const A = S.anim, frames = Math.ceil(TL.end(A.tl) * fps), t0 = A.t0, orbit = $('#orbitOn').checked && !S.shots.length;
  controls.autoRotate = false;
  renderer.setPixelRatio(1); renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
  $('#renderModal').hidden = false; $('#rFrames').textContent = `0 / ${frames}`; $('#rBar').style.width = '0%';
  $('#rInfo').textContent = tl('{0} × {1} · {2} images/s · {3} · MP4', W, H, fps, pick.kind === 'avc' ? 'H.264' : 'VP9');
  try {
    for (let i = 0; i < frames && !S.vr.cancel && !failure; i++) {
      const now = t0 + (i / fps) * 1000;
      if (S.anim) runAnim(now);
      if (orbit) { const off = saved.pos.clone().sub(saved.tgt).applyAxisAngle(new V3(0, 1, 0), (i / fps) * 0.0733); camera.position.copy(saved.tgt).add(off); camera.lookAt(saved.tgt); }
      if (S.simOn) simFrame(now);
      followView(); placeLamps(); guides.update(); blocks.update(); S.frameHooks.forEach(f => f(now));
      renderer.render(scene, camera);
      composite(target);
      const frame = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(frame, { keyFrame: i % (fps * 2) === 0 }); frame.close();
      while (enc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 2));
      if (i % 2 === 0) { $('#rFrames').textContent = `${i + 1} / ${frames}`; $('#rBar').style.width = `${(100 * (i + 1) / frames).toFixed(1)}%`; await new Promise(r => setTimeout(r, 0)); }
    }
    if (!S.vr.cancel && !failure) { await enc.flush(); muxer.finalize(); }
  } catch (e) { failure = failure || e; }
  const cancelled = S.vr.cancel;
  if (enc.state !== 'closed') enc.close();
  S.vr = null; $('#renderModal').hidden = true;
  if (S.anim) finishAnim();
  renderer.setPixelRatio(saved.pr); camera.position.copy(saved.pos); controls.target.copy(saved.tgt); resize();
  if (failure) { status(tl('Rendu interrompu : ') + (failure.message || failure), 'err'); return; }
  if (cancelled) { status(tl('Rendu annulé.'), 'warn'); return; }
  showVideo(new Blob([muxer.target.buffer], { type: 'video/mp4' }), W, H, 'mp4', tl('rendu image par image, {0} i/s', fps));
}
function stopRec() { const r = S.rec; S.rec = null; $('#recBadge').hidden = true; $('#recBtn').disabled = false; if (r.rec.state !== 'inactive') r.rec.stop(); }
function composite(target = S.rec) {
  const { cv, ctx: x } = target, gl = renderer.domElement, s = cv.height / 720;
  x.drawImage(gl, 0, 0, cv.width, cv.height);
  x.font = `600 ${15 * s}px "Instrument Sans", sans-serif`; x.textBaseline = 'middle'; x.textAlign = 'left';
  x.fillStyle = '#e0703a'; x.beginPath(); x.arc(28 * s, 30 * s, 5 * s, 0, 7); x.fill();
  x.fillStyle = 'rgba(228,231,232,.85)'; x.fillText('Jollof Studio', 42 * s, 30 * s);
  if (S.caption) {
    const [a, b] = S.caption.split('|');
    x.font = `500 ${19 * s}px "JetBrains Mono", monospace`;
    const wa = b ? x.measureText(a + '   ').width : 0, wb = x.measureText(b || a).width;
    const w = wa + wb + 40 * s, h = 44 * s, X = (cv.width - w) / 2, Y = cv.height - h - 30 * s;
    x.fillStyle = 'rgba(13,16,19,.9)'; x.strokeStyle = '#252c32'; x.lineWidth = 1.5 * s;
    x.beginPath(); x.roundRect ? x.roundRect(X, Y, w, h, h / 2) : x.rect(X, Y, w, h); x.fill(); x.stroke();
    let cx = X + 20 * s;
    if (b) { x.fillStyle = '#e0703a'; x.fillText(a, cx, Y + h / 2); cx += wa; }
    x.fillStyle = '#e4e7e8'; x.fillText(b || a, cx, Y + h / 2);
  }
}
/** Le tapis, la lumière, les ombres et le brouillard accompagnent la vue : le plan de travail n'a pas de bord. */
function followView() {
  const t = controls.target, dist = camera.position.distanceTo(t);
  ground.position.set(Math.round(t.x / TILE) * TILE, 0, Math.round(t.z / TILE) * TILE);
  const span = Math.min(3000, Math.max(220, dist * 1.25));
  sun.position.set(t.x + 90 * span / 220, 190 * span / 220, t.z + 110 * span / 220); sun.target.position.set(t.x, 0, t.z);
  rim.position.set(t.x - 120, 60, t.z - 90); rim.target.position.set(t.x, 0, t.z);
  const sc = sun.shadow.camera;
  if (Math.abs(sc.right - span) > span * 0.08) { Object.assign(sc, { left: -span, right: span, top: span, bottom: -span, near: 10, far: span * 3.5 }); sc.updateProjectionMatrix(); }
  if (scene.fog) { scene.fog.near = Math.max(500, dist * 1.6); scene.fog.far = Math.max(1100, dist * 4.5); } // pas de brouillard en mode léger
}
/** Les lampes partagées vont aux LED allumées les plus brillantes, au plus près du centre de la vue. */
const lampPos = new V3();
function placeLamps() {
  const t = controls.target, lit = [];
  for (const c of S.comps) for (const L of [c.led && c.led.light, c.rgb && c.rgb.light]) if (L && L.intensity > 0.01) lit.push({ c, L, d: c.group.position.distanceTo(t) - L.intensity * 40 });
  lit.sort((a, b) => a.d - b.d);
  ledLamps.forEach((lamp, i) => {
    const hit = lit[i];
    if (!hit) { lamp.intensity = 0; return; }
    hit.c.group.updateMatrixWorld(); lampPos.copy(hit.L.position); hit.c.group.localToWorld(lampPos);
    lamp.position.copy(lampPos); lamp.color.copy(hit.L.color); lamp.intensity = hit.L.intensity;
  });
}
/** Zoom vers le point sous le curseur : ce point reste immobile à l'écran. s > 0 : on recule. */
const zoomPt = new V3();
function zoomAt(e, s) {
  setNdc(e);
  const hit = ray.intersectObjects(S.comps.map(c => c.group), true)[0];
  if (hit) zoomPt.copy(hit.point); else if (!ray.ray.intersectPlane(groundPlane, zoomPt)) zoomPt.copy(controls.target);
  const dist = camera.position.distanceTo(controls.target);
  const next = Math.min(controls.maxDistance, Math.max(controls.minDistance, dist * Math.exp(s)));
  const f = next / dist; if (Math.abs(f - 1) < 1e-4) return;
  camera.position.sub(zoomPt).multiplyScalar(f).add(zoomPt);
  controls.target.sub(zoomPt).multiplyScalar(f).add(zoomPt);
  S.fly = null;
}
/** Déplacement de la vue à plat, dans le plan du tapis (dx, dy en pixels d'écran). */
function panView(dx, dy) {
  const dist = camera.position.distanceTo(controls.target), k = dist / Math.max(300, renderer.domElement.clientHeight) * 1.1;
  const right = new V3().setFromMatrixColumn(camera.matrix, 0); right.y = 0; right.normalize();
  const fwd = controls.target.clone().sub(camera.position); fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
  const delta = right.multiplyScalar(dx * k).addScaledVector(fwd, -dy * k);
  camera.position.add(delta); controls.target.add(delta); S.fly = null;
}
/*
 * Rendu à la demande : la scène n'est redessinée que si quelque chose bouge (caméra, glisser,
 * animation, simulation, saisie récente) ; au repos, une image par seconde au plus, et rien du
 * tout quand la fenêtre est cachée ou que l'espace classe recouvre le plan de travail. La
 * cadence est plafonnée (30 images/s en mode léger, 20 pendant la simulation).
 */
const FRAME = { last: 0, until: 0, need: true, slow: 0, count: 0, warned: false };
/* ---------- Banc de mesure (oscilloscope, multimètre) ---------- */
/**
 * Calcul du circuit en continu (multimètre, mesures des TP). Sans `state`, l'état réel de la
 * simulation (programmes, boutons, capteurs), gardé jusqu'au pas suivant ; avec `state`
 * ({ "UNO.D7": 1, "BTN1": "pressed" }), ces broches et boutons sont imposés pour la mesure.
 */
function solveCircuit(state) {
  if (!state && S.dc) return S.dc;
  if (!S.comps.length) return null;
  const A = S.simA || analyze(S.comps, S.wires), undo = [];
  if (state) for (const [k, v] of Object.entries(state)) {
    if (k.includes('.')) continue;
    const c = S.comps.find(x => x.name === k); if (!c || !c.inp) continue;
    const f = c.type === 'button' ? 'pressed' : 'sw'; undo.push([c, f, c.inp[f]]); c.inp[f] = v === 'pressed' || v === true;
  }
  const r = solveDC(S.comps, A, dcCtx(state));
  undo.forEach(([c, f, v]) => { c.inp[f] = v; });
  if (!state) S.dc = r;
  return r;
}
/** Contexte du solveur : broches réelles des programmes (ou imposées par `state`), sorties des capteurs. */
function dcCtx(state, extra) {
  return {
    prof: c => boardOf(c) || null,
    pinState: (c, key) => {
      if (state) { const v = state[`${c.name}.${key}`]; if (v != null) return typeof v === 'object' ? v : { mode: 1, d: v ? 1 : 0, pwm: null }; }
      const rt = prog.rts.get(c.id); return rt ? rt.pins.get(key) || null : null;
    },
    sensorVolts: (c, key) => { const o = c.simR && c.simR.out && c.simR.out[key]; return o == null ? null : typeof o === 'number' ? o : o.v != null ? o.v : o.d ? 5 : 0; },
    ...extra
  };
}
/**
 * Calcul du circuit pendant la simulation. Circuit statique : une fois par pas (10 fois par
 * seconde). Condensateur ou transistor : à chaque image, avec le temps écoulé, pour que les
 * charges et décharges suivent le programme (lecture analogique à jour).
 */
function solveLive(dt) {
  if (!S.simA) return null;
  const r = solveDC(S.comps, S.simA, dcCtx(null, dt ? { dt, commit: true, maxSub: LIGHT ? 10 : 25 } : null));
  S.dc = r;
  // Tensions des broches des cartes, pour analogRead (lecture en O(1)).
  const pins = new Map();
  if (r && r.ok) for (const c of S.comps) { const prof = boardOf(c); if (!prof) continue; for (const key of Object.keys(prof.gpio)) { const v = r.volts({ comp: c, key }); if (v != null) pins.set(c.id + '|' + key, v); } }
  S.dcPins = pins;
  return r;
}
/** Courant animé : courants des fils recalculés 10 fois par seconde (5 en mode léger). */
let flowTick = 0;
function updateFlow() {
  if (!flow || !flow.enabled || !S.dc || !S.dc.ok || S.view2d) { if (flow) flow.clear(); return; }
  if (LIGHT && (flowTick++ % 2)) return;
  try { flow.set(wireFlows(S.simA, S.dc, S.wires)); } catch (e) { console.error(e); flow.clear(); }
}
let bench = null, flow = null, sch = null, chk = null;
const naturalKey = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const benchCtx = {
  fps: Q.simFps,
  simOn: () => S.simOn,
  boards: () => S.comps.filter(c => boardOf(c)).map(c => ({ id: c.id, name: c.name, rt: prog.rts.get(c.id), pins: Object.keys(boardOf(c).gpio).sort(naturalKey) })),
  probes: () => {
    const A = S.simA, out = [];
    for (const c of S.comps) {
      if (/^breadboard/.test(c.type)) continue;
      for (const key of Object.keys(c.pins).sort(naturalKey)) if (!A || A.deg({ comp: c, key }) > 0 || (boardOf(c) && /^(GND|5V|3V3|VIN)/.test(key))) out.push({ id: c.id + '|' + key, label: `${c.name} · ${key}`, ref: { comp: c, key } });
    }
    return out;
  },
  parts: () => S.comps.filter(c => /^(res-|led-|diode|bat|button|pot|cap-|npn)/.test(c.type)).map(c => ({ id: c.id, label: `${c.name} · ${describe(c).title}`, comp: c })),
  dc: () => solveCircuit(null),
  onShow: on => { $('#benchBtn').setAttribute('aria-pressed', on); invalidate(); }
};
function invalidate(ms = 0) { FRAME.need = true; if (ms) FRAME.until = Math.max(FRAME.until, performance.now() + ms); }
const busyScene = now => FRAME.need || now < FRAME.until || (S.anim && !S.anim.paused) || S.fly || S.rec || S.wiresDirty || S.wiresPartial || S.drag || S.endDrag || S.wireDrag || S.blockDrag || S.blockResize || S.blockRect || S.simOn;
function tick(now) {
  requestAnimationFrame(tick);
  if (S.vr) return; // rendu image par image en cours : il pilote lui-même la scène
  if (document.hidden && !S.rec) return;
  const gap = now - FRAME.last;
  if (gap < 1000 / (S.simOn ? Q.simFps : Q.fps) - 2) return;
  const moving = controls.update();
  if (!moving && !busyScene(now) && gap < 1000) return;
  if (document.body.classList.contains('hubOpen') && !S.rec && !S.simOn) { FRAME.last = now; return; }
  watchSpeed(gap, moving || busyScene(now));
  FRAME.last = now; FRAME.need = false;
  if (S.anim) runAnim(now);
  if (S.fly) runFly(now);
  if (S.wiresDirty || (S.wiresPartial && !S.drag)) layoutWires();
  followView(); placeLamps(); guides.update(); blocks.update(); S.frameHooks.forEach(f => f(now));
  if (S.simOn) simFrame(now);
  if (bench && bench.visible) bench.draw(now);
  if (S.view2d) { if (!document.body.classList.contains('hubOpen')) sch.frame(now); if (!S.rec) return; } // vue Schéma : la scène 3D, cachée, n'est pas dessinée
  if (document.body.classList.contains('hubOpen') && !S.rec) return; // l'espace classe cache la scène
  renderer.render(scene, camera);
  if (S.rec) composite();
}
/** Choix du profil graphique ; il s'applique au redémarrage (l'état du projet est sauvegardé). */
async function chooseQuality(anchor) {
  const auto = autoLevel() === 'light' ? tl('léger') : tl('standard');
  const v = await popMenu(anchor, [
    { label: tl('Automatique (ici : {0})', auto) + (CHOICE === 'auto' ? ' ✓' : ''), icon: 'wand', value: 'auto' },
    { label: tl('Léger : vieux PC, carte graphique modeste') + (CHOICE === 'light' ? ' ✓' : ''), icon: 'zap', value: 'light' },
    { label: tl('Standard : ombres, lumières, pièces CAO') + (CHOICE === 'standard' ? ' ✓' : ''), icon: 'cube', value: 'standard' }
  ]);
  if (!v || v === CHOICE) return;
  setQuality(v);
  const next = v === 'auto' ? autoLevel() : v;
  if (next === LEVEL) { status(tl('Réglage enregistré.'), 'ok'); return; }
  const saved = autosave(); // écriture asynchrone : attendue avant de redémarrer
  if (confirm(tl('Redémarrer maintenant pour appliquer le mode {0} ? Le projet en cours est conservé.', next === 'light' ? tl('léger') : tl('standard')))) saved.finally(() => location.reload());
  else status(tl('Le mode {0} s’appliquera au prochain démarrage.', next === 'light' ? tl('léger') : tl('standard')), 'ok');
}
function suggestLight() {
  const el = document.createElement('div'); el.className = 'perfHint';
  el.innerHTML = `${icon('zap')}<span>${tl('L’affichage est lent sur cet ordinateur : le mode léger le rendra plus fluide.')}</span><button type="button" class="btn small primary" data-y>${tl('Passer en mode léger')}</button><button type="button" class="tb" data-n aria-label="${tl('Fermer')}">${icon('x')}</button>`;
  $('#stage').appendChild(el);
  el.querySelector('[data-y]').onclick = () => { setQuality('light'); autosave().finally(() => location.reload()); };
  el.querySelector('[data-n]').onclick = () => el.remove();
}
/** Ordinateur trop lent pour le profil standard : on propose (une fois) le mode léger. */
function watchSpeed(gap, active) {
  if (LIGHT || FRAME.warned || !active || gap > 1000) return;
  FRAME.count++; FRAME.slow += gap > 55 ? 1 : 0;
  if (FRAME.count < 90) return;
  if (FRAME.slow / FRAME.count > 0.6) { FRAME.warned = true; suggestLight(); }
  FRAME.count = 0; FRAME.slow = 0;
}
// Toute saisie peut changer la scène : quelques images après chaque geste, puis repos.
['pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup'].forEach(t => window.addEventListener(t, () => invalidate(700), { capture: true, passive: true }));
window.addEventListener('pointermove', e => { if (e.target && e.target.closest && e.target.closest('#stage')) invalidate(400); }, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => invalidate());

/* ---------- Interaction ---------- */
function setNdc(e) { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return r; }
const SNAP = 24;
function pinExact() { const h = ray.intersectObjects(S.pinHits, false)[0]; return h ? h.object.userData.pin : null; }
function pinAt(e, r) {
  const exact = pinExact(); if (exact) return exact;
  const mx = e.clientX - r.left, my = e.clientY - r.top; let best = null, bd = SNAP * SNAP;
  const v = new V3();
  for (const c of S.comps) {
    c.group.updateMatrixWorld(true);
    for (const key in c.pins) {
      v.copy(c.pins[key].attach); c.group.localToWorld(v); v.project(camera); if (v.z > 1) continue;
      const d = ((v.x + 1) / 2 * r.width - mx) ** 2 + ((1 - v.y) / 2 * r.height - my) ** 2;
      if (d < bd) { bd = d; best = { comp: c, key }; }
    }
  }
  return best;
}
function wireAt() { const h = ray.intersectObjects(S.wires.filter(w => w.mesh && w.mesh.visible).map(w => w.mesh), false)[0]; return h ? S.wires.find(w => w.mesh === h.object) : null; }
function handleAt() { if (!S.selWire) return null; const h = ray.intersectObjects(handles, false)[0]; return h ? h.object.userData.end : null; }
function compAt() {
  const h = ray.intersectObjects(S.comps.map(c => c.group), true)[0]; if (!h) return null;
  let o = h.object; while (o && !o.userData.comp) o = o.parent; return o ? o.userData.comp : null;
}
function groundAt() { const p = new V3(); return ray.ray.intersectPlane(groundPlane, p) ? p : null; }
/* ---------- Infobulle de simulation : tension et courant du composant ou du fil survolé ---------- */
const fmtN = (v, d) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace('.', DEC);
const fmtV = v => (v == null ? '—' : Math.abs(v) < 1 && v !== 0 ? `${fmtN(v * 1000, 0)} mV` : `${fmtN(v, 2)} V`);
const fmtI = mA => (mA == null ? '—' : Math.abs(mA) < 1 && mA !== 0 ? `${fmtN(mA * 1000, 0)} µA` : `${fmtN(mA, Math.abs(mA) < 10 ? 2 : 1)} mA`);
let simTipAt = 0, simTipTarget = null, simTipPos = null;
function simTipHtml(target) {
  const r = S.dc; if (!r || !r.ok) return '';
  if (target.net) return `${tl('Nœud')} <b>${esc(target.net.name)}</b><br>${tl('Tension')} <b>${fmtV(r.volts(target.net.pins[0]))}</b>${target.mA != null ? ` · ${tl('Courant')} <b>${fmtI(Math.abs(target.mA))}</b>` : ''}`;
  if (target.wire) {
    const w = target.wire, f = flowOf(w);
    return `${esc(wireLabel(w))}<br>${tl('Tension')} <b>${fmtV(r.volts(w.a))}</b>${f ? ` · ${tl('Courant')} <b>${fmtI(Math.abs(f.mA))}</b>` : ''}`;
  }
  const c = target.comp, a = r.across ? r.across(c) : null; if (!a) return '';
  const head = `<b>${esc(c.name)}</b>`;
  if (a.kind === 'npn' && a.extra) { const st = { off: tl('bloqué'), active: tl('actif'), sat: tl('saturé') }[a.extra.state] || ''; return `${head} · ${st}<br>Ic <b>${fmtI(a.extra.ic)}</b> · Ib <b>${fmtI(a.extra.ib)}</b> · Vce <b>${fmtV(a.extra.vce)}</b>`; }
  const p = a.v != null && a.mA != null ? Math.abs(a.v * a.mA) : null;
  const extra = a.kind === 'led' ? ` · ${a.mA > 0.01 ? tl('allumée') : tl('éteinte')}` : a.kind === 'res' && p != null ? ` · P <b>${p >= 1000 ? fmtN(p / 1000, 2) + ' W' : fmtN(p, 1) + ' mW'}</b>` : '';
  return `${head}<br>U <b>${fmtV(a.v)}</b> · I <b>${fmtI(a.mA)}</b>${extra}`;
}
function flowOf(w) { const r = S.dc; if (!r || !r.ok) return null; try { return (S.flowCache && S.flowCache.r === r ? S.flowCache.m : (S.flowCache = { r, m: wireFlows(S.simA, r, S.wires) }).m).get(w) || null; } catch (e) { return null; } }
function simTip(over, e, rect) {
  const now = performance.now(); if (now - simTipAt < 80) return; simTipAt = now;
  const wire = over ? null : wireAt();
  const target = over ? { comp: over } : wire ? { wire } : null;
  simTipTarget = target; simTipPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  paintSimTip();
}
function paintSimTip() {
  const t = $('#tip'), html = simTipTarget ? simTipHtml(simTipTarget) : '';
  if (!html) { t.hidden = true; return; }
  t.innerHTML = html; t.hidden = false; t.style.left = simTipPos.x + 'px'; t.style.top = simTipPos.y + 'px';
}
function hideSimTip() { if (simTipTarget) { simTipTarget = null; $('#tip').hidden = true; } }
// L'infobulle ouverte suit les valeurs (4 fois par seconde).
setInterval(() => { if (S.simOn && simTipTarget && !document.hidden) paintSimTip(); }, 250);

/* ---------- Vue « Schéma » : le montage en schéma électrique, où l'on voit le courant ---------- */
function installSchView() {
  sch = createSchView($('#stage'), {
    light: LIGHT, dec: DEC,
    comps: () => S.comps, wires: () => S.wires, netNames: () => S.netNames || {}, describe,
    blocks: () => blocks.list.map(b => ({ name: b.name, color: b.color, comps: blocks.members(b) })),
    dc: () => (S.dc && S.dc.ok ? S.dc : null),
    simOn: () => S.simOn, flowOn: () => !flow || flow.enabled, faults: () => S.faults || [],
    fmtV, fmtI, tipHtml: t => simTipHtml(t),
    tip(html, x, y) {
      const t = $('#tip');
      if (!html) { t.hidden = true; t.style.transform = ''; return; }
      const r = $('#stage').getBoundingClientRect();
      t.innerHTML = html; t.hidden = false; t.style.left = (x - r.left) + 'px'; t.style.top = (y - r.top) + 'px';
      // Près du bord droit (panneau de l'inspecteur) : l'infobulle passe à gauche du pointeur.
      t.style.transform = x - r.left + 20 + t.offsetWidth > r.width ? 'translate(calc(-100% - 12px), -130%)' : '';
    },
    // Bouton appuyé sur le schéma : comme dans la scène 3D, enfoncé tant qu'on reste appuyé.
    press(c, on) {
      S.pressing = on ? c : null; c.inp[c.type === 'button' ? 'pressed' : 'sw'] = on; syncPress(c);
      if (S.simOn) S.simLast = performance.now() - 100; // prise en compte immédiate
    },
    setInput(c, k, v) {
      c.inp[k] = v;
      const inp = document.querySelector(`#probes li[data-id="${c.id}"] [data-inp="${k}"]`); if (inp) inp.value = v;
      changed();
    },
    startSim: () => setSim(true),
    locate(c) { setStageView('3d'); select(c); frameComp(c); },
    connect: joinNodes, cut: cutNodes, wired: busy,
    // Édition sur le schéma : sélection (panneau de gauche) et déplacement (le composant suit sur le tapis).
    select: c => select(c), selected: () => S.sel,
    moveBy(c, dx, dy) {
      if (!S.comps.includes(c)) return;
      const p = c.group.position;
      p.set(Math.round((p.x + dx / SHEET_SCALE) * 2) / 2, 0, Math.round((p.z + dy / SHEET_SCALE) * 2) / 2);
      c.group.updateMatrixWorld(true); rebuildFor(c); select(c); changed();
    }
  });
  S.changeHooks.push(() => sch.dirty());
  // Choix de la vue, en haut à gauche du plan de travail.
  $('.stageBar.top').insertAdjacentHTML('afterbegin', `<div class="seg glass" id="stageView" role="group" aria-label="${tl('Affichage du plan de travail')}">
    <button type="button" class="segBtn" data-stage="3d" aria-pressed="true" data-tip="${tl('Montage en 3D : placer, câbler, simuler · S')}">${icon('cube')}<span>3D</span></button>
    <button type="button" class="segBtn" data-stage="2d" aria-pressed="false" data-tip="${tl('Schéma électrique en direct : on y voit le courant circuler · S')}">${icon('schematic')}<span>${tl('Schéma')}</span></button></div>`);
  document.querySelectorAll('#stageView [data-stage]').forEach(b => (b.onclick = () => setStageView(b.dataset.stage)));
  // Outils propres à la 3D, cachés sur le schéma ; « Valeurs » propre au schéma.
  ['#swatches', '#blockTool', '#lockChip', '#renderSimple', '#wireTidy', '#tagsBtn', '[data-view="iso"]'].forEach(q => { const n = $(q), t = n && (n.closest('.seg, .chipGroup') || n); if (t) t.classList.add('only3d'); });
  $('#flowBtn').insertAdjacentHTML('afterend', `<button type="button" class="tb glass label only2d" id="schValues" data-tip="${tl('Écrire sur le schéma l’intensité dans chaque composant et la tension de chaque nœud')}" aria-pressed="${sch.values}">${icon('activity')}<span>${tl('Valeurs')}</span></button>`);
  $('#schValues').onclick = () => { sch.values = !sch.values; $('#schValues').setAttribute('aria-pressed', sch.values); };
  let last = null;
  try { last = localStorage.getItem('jollof-stage-view'); } catch (e) { /* stockage indisponible */ }
  if (last === '2d') setStageView('2d');
}
/** Tampon du schéma imprimé : le résultat du vérificateur (sans symbole hors des polices du PDF). */
function checkStamp() {
  const r = chk && chk.result; if (!r) return null;
  return { ok: !r.errors, text: r.errors ? tl('NON VÉRIFIÉ : {0} erreur(s), voir le rapport de vérification', r.errors) : r.proven ? tl('VÉRIFIÉ : aucune faute dans les {0} états atteignables', Number(r.states).toLocaleString(locale())) : tl('VÉRIFIÉ sur {0} états (vérification partielle)', Number(r.states).toLocaleString(locale())) };
}
/**
 * Vérificateur (src/check) : pastille à côté de « Simuler », rapport à la manière de rustc. Il relit le montage et
 * le programme de chaque carte après chaque changement et prouve l'absence de faute dans tous les états atteignables.
 */
function installChecker() {
  chk = installCheck({
    $, esc, icon, anchor: $('#simBtn'),
    comps: () => S.comps, wires: () => S.wires,
    programs: () => new Map(boards().map(b => [b.id, prog.programOf(b)]).filter(([, code]) => code)),
    auto: () => new Set(boards().filter(b => prog.isAuto(b)).map(b => b.id)),
    firmware: () => new Set(boards().filter(b => prog.isFirmware(b)).map(b => b.id)),
    allow: () => S.checkAllow || [],
    setAllow(list) { S.checkAllow = list; S.dirty = true; $('#projectName').classList.add('dirty'); clearTimeout(changed.t); changed.t = setTimeout(autosave, 400); },
    dist: (a, b) => pinWorld(a).distanceTo(pinWorld(b)),
    focus(d) {
      if (d.fault && d.fault.pins && d.fault.pins.length) { focusFault(d.fault); return; }
      const c = d.loc && d.loc.comp; if (!c) return;
      select(c); if (!S.view2d) frameComp(c);
    },
    fix: (f, act) => fixFault(f, act),
    actLabel: a => ACT[a] || a,
    goCode: (b, line, col) => prog.showLine(b, line, col)
  });
  S.changeHooks.push(() => chk.schedule());
  chk.schedule();
}
/** Plan de travail en 3D ou en schéma électrique (la scène 3D n'est plus dessinée tant que le schéma la cache). */
function setStageView(v) {
  const on = v === '2d';
  if (!sch || on === !!S.view2d) return;
  S.view2d = on;
  $('#stage').classList.toggle('sch2d', on);
  document.querySelectorAll('#stageView [data-stage]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.stage === (on ? '2d' : '3d'))));
  hideSimTip(); $('#tip').hidden = true;
  if (on) { cancelPending(); if (flow) flow.clear(); sch.show(); } else { sch.hide(); if (S.simOn) updateFlow(); invalidate(); }
  try { localStorage.setItem('jollof-stage-view', on ? '2d' : '3d'); } catch (e) { /* stockage indisponible */ }
}
function showTip(ref, e, r) {
  const t = $('#tip');
  if (!ref) { t.hidden = true; return; }
  const from = S.pending && !same(S.pending, ref) ? `${esc(S.pending.comp.name)} ${esc(S.pending.key)} → ` : '';
  const full = busy(ref) && !same(ref, S.pending) ? `<span class="busy">${tl('occupée')}</span>` : '';
  t.innerHTML = `${from}${esc(ref.comp.name)} <b>${esc(ref.key)}</b>${full}`; t.hidden = false;
  t.style.left = (e.clientX - r.left) + 'px'; t.style.top = (e.clientY - r.top) + 'px';
}
function setHover(ref) { if (same(ref, S.hover)) return; const old = S.hover; S.hover = ref; paintPin(old); paintPin(ref); }
function startPending(p) { cancelPending(); S.pending = p; paintPin(p); }
function cancelPending() { const old = S.pending; S.pending = null; paintPin(old); rubber.visible = false; }
function autoColor(a, b) {
  if (!$('#autoCol').checked) return S.color;
  const k = [baseKey(a.key), baseKey(b.key)];
  if (k.some(x => /^(GND|AGND|-|B-\d+|T-\d+)$/.test(x))) return '#3a3f45';
  if (k.some(x => /^(3V3|3\.3V|5V|\+5V|VIN|VCC|VBUS|VSYS|\+|\+12V|\+3V3|B\+\d+|T\+\d+)$/.test(x))) return '#e5484d';
  return S.color;
}
/* Un fil par broche, comme un vrai connecteur : plusieurs fils au même point passent par une breadboard. */
const wiresOn = r => S.wires.filter(w => same(w.a, r) || same(w.b, r));
const busy = r => !!r && wiresOn(r).length > 0;
function refuseBusy(r) {
  status(tl('{0} {1} a déjà un fil : une broche n’en reçoit qu’un. Pour relier plusieurs fils au même point, passez par une breadboard.', r.comp.name, r.key), 'warn');
}
function connect(a, b) {
  if (!a || !b || same(a, b)) return false;
  const full = [a, b].find(busy);
  cancelPending();
  if (full) { refuseBusy(full); return false; }
  addWire(a, b, autoColor(a, b));
  return true;
}
/**
 * Câblage depuis le schéma : relie le nœud de a à celui de b. Une broche qui a déjà son fil passe la main à un
 * point libre de son nœud : une broche jumelle de la carte (GND (2)…), sinon le trou de breadboard libre le plus
 * proche de l'autre bout. Rend vrai si un fil a été ajouté (sinon, la raison dans la barre d'état).
 */
function joinNodes(a, b) {
  if (!a || !b || same(a, b) || !S.comps.includes(a.comp) || !S.comps.includes(b.comp)) return false;
  if (S.anim) finishAnim();
  const A = analyze(S.comps, S.wires), node = r => A.reach(r, { open: true }).members, nm = r => `${r.comp.name} ${r.key}`;
  if (node(a).some(m => same(m, b))) { status(tl('{0} et {1} sont déjà reliées.', nm(a), nm(b))); return false; }
  const spot = (r, toward) => {
    if (!busy(r)) return r;
    // Points libres du nœud : une broche sans fil n'y est que par une liaison interne (GND (2) d'une carte, trou de breadboard).
    const free = node(r).filter(m => !busy(m));
    const twin = free.find(m => m.comp === r.comp) || free.find(m => !/^breadboard/.test(m.comp.type)); if (twin) return twin;
    const far = pinWorld(toward); let best = null, bd = Infinity;
    for (const m of free) { const d = pinWorld(m).distanceTo(far); if (d < bd) { bd = d; best = m; } }
    return best || junction(r, notes);
  };
  const notes = [], ea = spot(a, b), eb = ea && spot(b, ea);
  if (!ea || !eb) { const full = !ea ? a : b; status(tl('{0} a déjà son fil et son nœud n’a plus de point libre : ajoutez une breadboard en 3D pour y relier plusieurs fils.', nm(full)), 'warn'); renderWires(); updatePower(); return false; }
  // Tous les fils du geste (raccords compris) d'un coup : une seule étape à annuler.
  const w = addWire(ea, eb, autoColor(ea, eb), true);
  renderWires(); updatePower(); changed();
  // Raccord sur breadboard : on explique d'abord ce qui a changé, puis le fil ajouté.
  status(notes.length ? [...notes, tl('Fil ajouté : {0}.', wireLabel(w))].join(' ') : same(ea, a) && same(eb, b) ? tl('Fil ajouté : {0}.', wireLabel(w)) : tl('Fil ajouté : {0}. La broche avait déjà son fil : le nouveau part d’un point libre du même nœud.', wireLabel(w)));
  return true;
}
/** Bande de 5 trous d'une breadboard dont aucun trou n'a de fil, ou null. */
const freeStrip = bb => { const g = bbGroups(bb).find(x => !x.rail && x.keys.every(k => bb.pins[k] && !busy({ comp: bb, key: k }))); return g ? g.keys : null; };
/**
 * Broche r déjà câblée, sans point libre sur son nœud : une bande libre de breadboard (posée au besoin) devient le
 * point de raccord, comme on le ferait en vrai. L'ancien fil y est rebranché ; rend le trou libre suivant.
 */
function junction(r, notes) {
  const old = wiresOn(r)[0]; if (!old) return null;
  const other = same(old.a, r) ? old.b : old.a;
  let bb = S.comps.find(c => /^breadboard/.test(c.type) && freeStrip(c));
  if (!bb) { bb = placeBreadboard(boards()[0] || r.comp); notes.push(tl('{0} ajoutée : ses rangées relient plusieurs fils au même point.', bb.name)); }
  const ks = freeStrip(bb); if (!ks) return null;
  const color = old.color; removeWire(old);
  addWire(r, { comp: bb, key: ks[0] }, color, true); addWire(other, { comp: bb, key: ks[1] }, color, true);
  notes.push(tl('{0} et {1} passent maintenant par la rangée {2} de {3}.', `${r.comp.name} ${r.key}`, `${other.comp.name} ${other.key}`, ks[0].replace(/^[A-J]/, ''), bb.name));
  return { comp: bb, key: ks[2] };
}
/** Retrait depuis le schéma : pids = une broche (ses fils) ou les deux bouts d'une liaison dessinée (le fil qui les relie). */
function cutNodes(pids) {
  const refOf = i => { const j = i.indexOf('|'), c = S.comps.find(x => x.id === i.slice(0, j)), key = i.slice(j + 1); return c && c.pins[key] ? { comp: c, key } : null; };
  const refs = pids.map(refOf).filter(Boolean);
  let ws = [];
  if (refs.length === 2) ws = analyze(S.comps, S.wires).path(refs[0], refs[1]).slice(0, 1);
  if (!ws.length && refs.length) ws = wiresOn(refs[0]);
  if (!ws.length) { status(tl('Aucun fil à retirer ici.')); return false; }
  if (S.anim) finishAnim();
  const names = ws.map(wireLabel).join(', ');
  ws.forEach(w => { if (S.wires.includes(w)) removeWire(w); });
  renderWires(); updatePower(); changed();
  status(tl('Fil retiré : {0}.', names));
  return true;
}
let down = null;
function onDown(e) {
  S.fly = null;
  // Animation en cours : la scène ne se modifie pas. Seule exception, l'aperçu figé de la timeline
  // quand un module attend un point (note posée à cet instant) : la scène reste à ce moment-là.
  if (e.button === 2 || (S.anim && !(S.anim.paused && !S.anim.temp && S.pick))) return;
  const r = setNdc(e); down = { x: e.clientX, y: e.clientY };
  // Un module attend un point de la scène (poser une note…) : composant visé, ou point du tapis.
  if (S.pick) {
    const hit = ray.intersectObjects(S.comps.map(c => c.group), true)[0], cb = S.pick; S.pick = null; renderer.domElement.classList.remove('picking');
    let comp = null; if (hit) { let o = hit.object; while (o && !o.userData.comp) o = o.parent; comp = o ? o.userData.comp : null; }
    const point = hit ? hit.point.clone() : groundAt();
    if (point) cb({ comp, point, local: comp ? comp.group.worldToLocal(point.clone()) : null });
    down = null; return;
  }
  // Tracé d'un bloc : un rectangle sur le tapis.
  if (S.blockDraw) {
    const g = groundAt(); if (!g) return;
    S.blockRect = { a: g.clone(), b: g.clone() }; drawBlockPreview();
    controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId); return;
  }
  // Poignée du bloc sélectionné : on l'agrandit ou on le réduit.
  const hh = blocks.hitHandle(ray);
  if (hh) { const b = blocks.selected; S.blockResize = { b, h: hh, start: blocks.bounds(b) }; controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId); return; }
  // Étiquette d'un bloc : on la saisit pour déplacer tout le bloc.
  const bh = blocks.hit(ray);
  if (bh) { S.blockDrag = { b: bh, last: groundAt(), moved: false }; controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId); return; }
  if (S.placing && S.sel && S.sel.type === 'custom') {
    const meshes = []; S.sel.model.traverse(o => o.isMesh && meshes.push(o));
    const h = ray.intersectObjects(meshes, false)[0];
    if (h) { placePin(h); down = null; return; }
  }
  const end = handleAt();
  if (end) {
    const w = S.selWire;
    S.endDrag = { w, end, fixed: end === 'a' ? w.b : w.a }; w[end === 'a' ? 'cA' : 'cB'].visible = false;
    controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId); return;
  }
  const exact = pinExact(), wh = exact ? null : wireAt();
  // Simulation en cours : un clic sur un bouton (hors de ses broches) l'enfonce tant qu'on reste appuyé.
  if (S.simOn && !exact && !S.pending) {
    const c = compAt();
    if (c && (c.type === 'button' || c.type === 'joystick')) {
      S.pressing = c; c.inp[c.type === 'button' ? 'pressed' : 'sw'] = true; syncPress(c);
      controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId); renderer.domElement.style.cursor = 'pointer';
      if (S.simOn) S.simLast = performance.now() - 100; // prise en compte immédiate
      return;
    }
  }
  // Simulation : le câblage est verrouillé. On peut encore sélectionner et déplacer un composant.
  if (S.simOn) {
    const c = compAt();
    if (exact && !c) { lockHint(); return; }
    if (c) { const g = groundAt(); select(c); S.drag = { comp: c, off: c.group.position.clone().sub(g || c.group.position), moved: false }; controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId); }
    else if (exact || wh) lockHint();
    return;
  }
  if (wh && !S.pending) { selectWire(wh); return; }
  const p = exact || pinAt(e, r);
  if (p) {
    // Broche déjà reliée : on sélectionne son fil, qu'on peut alors rebrancher par ses poignées.
    if (!S.pending && busy(p)) { selectWire(wiresOn(p)[0]); status(tl('{0} {1} a déjà un fil : glissez une poignée orange pour le rebrancher, ou Suppr pour le retirer.', p.comp.name, p.key)); return; }
    selectWire(null);
    const wasPending = same(S.pending, p);
    if (!S.pending) startPending(p);
    S.wireDrag = { start: p, wasPending };
    controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId); return;
  }
  const c = compAt();
  if (c) {
    const g = groundAt(); select(c);
    S.drag = { comp: c, off: c.group.position.clone().sub(g || c.group.position), moved: false };
    controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId);
  }
}
function onMove(e) {
  const r = setNdc(e);
  if (S.blockRect) { const g = groundAt(); if (g) { S.blockRect.b.copy(g); drawBlockPreview(); } return; }
  if (S.blockResize) { const g = groundAt(), br = S.blockResize; if (g) blocks.resize(br.b, br.h, g.x, g.z, br.start); renderer.domElement.style.cursor = 'grabbing'; return; }
  if (!S.drag && !S.blockDrag && !S.endDrag && !S.wireDrag && blocks.hitHandle(ray)) { renderer.domElement.style.cursor = 'nwse-resize'; return; }
  if (S.blockDrag) {
    const g = groundAt(), bd = S.blockDrag; if (!g || !bd.last) return;
    const dx = Math.round((g.x - bd.last.x) * 2) / 2, dz = Math.round((g.z - bd.last.z) * 2) / 2;
    if (!dx && !dz) return;
    bd.last.x += dx; bd.last.z += dz; bd.moved = true;
    const ms = blocks.members(bd.b);
    ms.forEach(c => { c.group.position.x += dx; c.group.position.z += dz; c.group.updateMatrixWorld(true); rebuildFor(c); });
    blocks.move(bd.b, dx, dz);
    if (S.sel) updateSel();
    renderer.domElement.style.cursor = 'grabbing'; return;
  }
  if (S.drag) {
    const g = groundAt(); if (!g) return;
    S.drag.comp.group.position.set(Math.round((g.x + S.drag.off.x) * 2) / 2, 0, Math.round((g.z + S.drag.off.z) * 2) / 2);
    S.drag.comp.group.updateMatrixWorld(true); S.drag.moved = true; rebuildFor(S.drag.comp); updateSel(); return;
  }
  const gp = groundAt();
  $('#cursorPos').textContent = gp ? tl('X {0} · Z {1} mm', fmtMm(gp.x), fmtMm(gp.z)) : '';
  if (S.anim) { showTip(null); return; }
  const p = S.simOn ? null : pinAt(e, r); setHover(p); showTip(p, e, r);
  if (S.endDrag) {
    const ed = S.endDrag, a = pinWorld(ed.fixed), b = p && !same(p, ed.fixed) ? pinWorld(p) : groundAt();
    if (b) { rubber.geometry.setFromPoints([a, b]); rubber.visible = true; handles[ed.end === 'a' ? 0 : 1].position.copy(b).add(new V3(0, p ? 4.5 : 0, 0)); }
    renderer.domElement.style.cursor = 'grabbing'; return;
  }
  const over = p ? null : compAt();
  if (S.simOn) simTip(over, e, r); else hideSimTip();
  renderer.domElement.style.cursor = p ? (S.pending && busy(p) && !same(p, S.pending) ? 'not-allowed' : 'crosshair') : (S.placing ? 'cell' : (S.pending ? 'crosshair' : (over ? (S.simOn && (over.type === 'button' || over.type === 'joystick') ? 'pointer' : 'grab') : '')));
  if (S.pending) {
    const a = pinWorld(S.pending), b = p && !same(p, S.pending) ? pinWorld(p) : groundAt();
    if (b) { rubber.geometry.setFromPoints([a, b]); rubber.visible = true; }
  }
}
/** Rectangle en cours de tracé pour un nouveau bloc. */
function drawBlockPreview() {
  const { a, b } = S.blockRect, y = 0.3, p = blockPreview.geometry.attributes.position;
  [[a.x, a.z], [b.x, a.z], [b.x, b.z], [a.x, b.z], [a.x, a.z]].forEach(([x, z], i) => p.setXYZ(i, x, y, z));
  p.needsUpdate = true; blockPreview.visible = true;
}
function setBlockDraw(on) {
  S.blockDraw = on; $('#blockTool').setAttribute('aria-pressed', on);
  renderer.domElement.classList.toggle('picking', on);
  if (on) status(tl('Tracez un rectangle sur le tapis autour des composants à regrouper (Échap pour annuler).'));
}
/** Liste des blocs (onglet Câblage) et choix du bloc du composant sélectionné. */
function renderBlocks() {
  const list = blocks.list;
  $('#blocks').innerHTML = list.length ? list.map(b => `<li data-bid="${esc(b.id)}"><button type="button" class="bsw" style="background:${b.color}" title="${tl('Changer la couleur')}" aria-label="${tl('Changer la couleur')}"></button><input value="${esc(b.name)}" maxlength="40" aria-label="${tl('Nom du bloc')}"><small>${blocks.members(b).length || 'zone'}</small><button type="button" class="tb" data-act="see" title="${tl('Voir le bloc')}" aria-label="${tl('Voir le bloc')}">${icon('eye')}</button><button type="button" class="tb danger" data-act="del" title="${tl('Supprimer le bloc (les composants restent)')}" aria-label="${tl('Supprimer le bloc')}">${icon('trash')}</button></li>`).join('')
    : `<li class="emptyRow">${tl('Aucun bloc. « Encadrer » regroupe une partie du montage sous un nom.')}</li>`;
  renderSelBlock();
}
function renderSelBlock() {
  const c = S.sel, sel = $('#selBlock'); if (!c) return;
  const cur = blocks.blockOf(c);
  sel.innerHTML = `<option value="">aucun</option>${blocks.list.map(b => `<option value="${esc(b.id)}"${b === cur ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}`;
}
const fmtMm = v => (Math.round(v * 2) / 2).toString().replace('.', DEC).replace('-', '−');
/** Le câblage ne se modifie pas pendant la simulation : on le rappelle, sans insister. */
function lockHint() {
  const now = performance.now(); if (now - (lockHint.t || 0) < 2500) return; lockHint.t = now;
  status(tl('Simulation en cours : le câblage est verrouillé. Arrêtez la simulation pour tirer, rebrancher ou retirer un fil.'), 'warn');
  const chip = $('#lockChip'); chip.classList.remove('nudge'); void chip.offsetWidth; chip.classList.add('nudge');
}
/** Bouton appuyé depuis la scène : le panneau Simulation suit. */
function syncPress(c) {
  const k = c.type === 'button' ? 'pressed' : 'sw', b = document.querySelector(`#probes li[data-id="${c.id}"] [data-press="${k}"]`);
  if (b) { b.setAttribute('aria-pressed', !!c.inp[k]); if (k === 'pressed') b.textContent = c.inp[k] ? tl('Relâcher le bouton') : tl('Appuyer sur le bouton'); }
}
function onUp(e) {
  if (S.blockRect) {
    const { a, b } = S.blockRect; S.blockRect = null; blockPreview.visible = false; controls.enabled = true; setBlockDraw(false);
    if (Math.abs(a.x - b.x) < 4 || Math.abs(a.z - b.z) < 4) { status(tl('Rectangle trop petit : tracez-le autour des composants à regrouper.'), 'warn'); return; }
    const blk = blocks.create([a.x, a.z, b.x, b.z]);
    renderBlocks(); changed();
    status(blk.comps.length ? tl('{0} : {1} composant{2} encadré{3}. Donnez-lui un nom dans l’onglet Câblage.', blk.name, blk.comps.length, blk.comps.length > 1 ? 's' : '', blk.comps.length > 1 ? 's' : '') : tl('{0} : zone vide créée. Ajoutez-y des composants depuis leur sélection.', blk.name), 'ok');
    setTab('wiring'); requestAnimationFrame(() => { const inp = document.querySelector(`#blocks [data-bid="${blk.id}"] input`); if (inp) { inp.focus(); inp.select(); } });
    return;
  }
  if (S.blockResize) {
    const { b } = S.blockResize; S.blockResize = null; controls.enabled = true;
    blocks.adopt(b); renderBlocks(); changed();
    status(tl('{0} : {1} composant{2} dans le cadre.', b.name, b.comps.length, b.comps.length > 1 ? 's' : ''), 'ok');
    return;
  }
  if (S.blockDrag) {
    const bd = S.blockDrag; S.blockDrag = null; controls.enabled = true;
    if (bd.moved) changed();
    else { blocks.select(bd.b); status(tl('{0} sélectionné : tirez une poignée blanche pour l’agrandir ou le réduire, ou l’étiquette pour le déplacer.', bd.b.name)); setTab('wiring'); const li = document.querySelector(`#blocks [data-bid="${bd.b.id}"]`); if (li) { li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash'); li.scrollIntoView({ block: 'nearest' }); } }
    return;
  }
  if (S.pressing) {
    const c = S.pressing; S.pressing = null; c.inp[c.type === 'button' ? 'pressed' : 'sw'] = false; syncPress(c);
    controls.enabled = true; down = null; if (S.simOn) S.simLast = performance.now() - 100; return;
  }
  const r = setNdc(e), moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 : true; down = null;
  if (S.drag) { if (S.drag.moved) changed(); S.drag = null; controls.enabled = true; return; }
  if (S.endDrag) {
    const { w, end, fixed } = S.endDrag; S.endDrag = null; controls.enabled = true; rubber.visible = false;
    const p = pinAt(e, r), cur = w[end];
    if (p && !same(p, fixed) && !same(p, cur)) {
      if (busy(p)) refuseBusy(p);
      else { w[end] = p; status(tl('Fil déplacé : {0}', wireLabel(w)), 'ok'); renderWires(); changed(); }
    }
    buildWire(w); updatePower(); return;
  }
  if (S.wireDrag) {
    const wd = S.wireDrag; S.wireDrag = null; controls.enabled = true;
    const p = pinAt(e, r);
    if (p && !same(p, S.pending)) connect(S.pending, p);
    else if (!moved && wd.wasPending) cancelPending();
    else if (moved && !p) cancelPending();
    return;
  }
  if (moved || S.anim) return;
  if (S.pending) { cancelPending(); return; }
  if (wireAt()) return;
  selectWire(null); blocks.select(null);
  if (!compAt()) select(null);
}
function placePin(h) {
  const comp = S.sel;
  const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new V3(0, 1, 0);
  const lp = comp.group.worldToLocal(h.point.clone().addScaledVector(n, 0.4));
  const name = ($('#pinName').value.trim() || 'P').slice(0, 16);
  const d = comp.custom, old = d.pins.findIndex(p => p.name === name);
  if (old >= 0) { d.pins.splice(old, 1); rebuildCustom(comp).then(n => { addPointPin(n, name, lp); afterPin(n, name); }); return; }
  addPointPin(comp, name, lp);
  if (d.kind === 'module') d.pins[d.pins.length - 1].role = guessRole(name);
  afterPin(comp, name);
}
function afterPin(comp, name) {
  const d = comp.custom;
  if (d.kind === 'skin') { const next = libPins(d.as).find(k => !d.pins.some(p => p.name === k)); $('#pinName').value = next || ''; if (!next) setPlacing(false); }
  else { const mm = name.match(/^(.*?)(\d+)$/); $('#pinName').value = mm ? mm[1] + (+mm[2] + 1) : name + '2'; }
  applyDef(comp); renderWizard(comp);
  status(tl('Broche {0} posée sur {1}.', name, comp.name)); refreshQuick(); renderExplain(); changed();
}

/** Assistant d'un composant importé : nature, broches à poser et leur rôle. */
function renderWizard(c) {
  const d = c.custom; if (!d) return;
  $('#cKind').value = d.kind || 'deco';
  $('#cAs').hidden = d.kind !== 'skin'; $('#cFam').hidden = d.kind !== 'board';
  if (d.as) $('#cAs').value = d.as;
  if (d.family) $('#cFam').value = d.family;
  $('#pinStep').hidden = d.kind === 'deco';
  $('#applySkin').hidden = d.kind !== 'skin';
  $('#pinName').readOnly = d.kind === 'skin';
  const target = d.kind === 'skin' && BY_ID[d.as] ? BY_ID[d.as].name : '';
  $('#pinHint').textContent = {
    skin: tl('Cliquez sur le modèle à l’endroit de chaque broche demandée de {0}. Elles gardent leur rôle : simulation, câblage automatique et détection d’erreurs fonctionnent comme pour le composant de la bibliothèque.', target),
    board: tl('Cliquez sur chaque broche du modèle et donnez-lui le nom imprimé sur la carte (GPIO4, D13, GP15, A0, 3V3, 5V, GND…) : son rôle en est déduit.'),
    module: tl('Cliquez sur chaque broche du modèle, nommez-la et vérifiez son rôle (il est deviné d’après le nom).')
  }[d.kind] || '';
  let rows = [];
  if (d.kind === 'skin' && d.as) {
    const want = libPins(d.as);
    if (!$('#pinName').value || !want.includes($('#pinName').value)) $('#pinName').value = want.find(k => !d.pins.some(p => p.name === k)) || '';
    rows = want.map(k => { const ok = d.pins.some(p => p.name === k); return `<li class="${ok ? 'ok' : ''}${$('#pinName').value === k ? ' cur' : ''}" data-k="${esc(k)}"><i>${ok ? '✓' : '○'}</i><b>${esc(k)}</b><span>${ok ? tl('calibrée') : tl('à placer')}</span></li>`; });
  } else if (d.kind === 'board') {
    const fam = FAMILIES[d.family || 'esp32'];
    rows = d.pins.map((p, i) => {
      const r = parseBoardPin(p.name, fam), g = c.prof && c.prof.gpio[baseKey(p.name)];
      const t = r.kind === 'pwr' ? volts(r.v) : r.kind === 'gnd' ? tl('Masse') : r.kind === 'gpio' ? `GPIO ${r.n}${g && g.caps.has('adc') ? ' · ADC' : ''}${g && g.caps.has('flash') ? tl(' · flash') : ''}` : 'autre';
      return `<li><input value="${esc(p.name)}" data-i="${i}" aria-label="${tl('Nom de la broche')}"><span class="tag ${r.kind}">${esc(t)}</span><button type="button" data-del="${i}" aria-label="${tl('Retirer la broche {0}', esc(p.name))}">${icon('x')}</button></li>`;
    });
  } else if (d.kind === 'module') {
    rows = d.pins.map((p, i) => `<li><input value="${esc(p.name)}" data-i="${i}" aria-label="${tl('Nom de la broche')}"><select data-role="${i}" aria-label="${tl('Rôle de {0}', esc(p.name))}">${MODULE_ROLES.map(([v, l]) => `<option value="${v}"${(p.role || guessRole(p.name)) === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select><button type="button" data-del="${i}" aria-label="${tl('Retirer la broche {0}', esc(p.name))}">${icon('x')}</button></li>`);
  }
  $('#cPins').innerHTML = rows.join('') || (d.kind === 'deco' ? '' : `<li class="note">${tl('Aucune broche posée.')}</li>`);
  $('#saveLibBtn').disabled = d.kind !== 'deco' && !d.pins.length;
}

/* ---------- Sélection ---------- */
function select(c) {
  if (c !== S.sel && S.placing) setPlacing(false);
  if (c) selectWire(null);
  S.sel = c; $('#selBox').hidden = !c; if (!c) setPlacing(false);
  if (c) { $('#selTitle').textContent = c.name; $('#pinTools').hidden = c.type !== 'custom'; if (c.custom) renderWizard(c); $('#docSel').hidden = !BY_ID[c.type]; $('.selName small').textContent = BY_ID[c.type] ? BY_ID[c.type].name : tl('Modèle importé'); }
  updateSel(); renderExplain(); renderBehavior(); renderSelBlock();
  if (S.view2d && sch) sch.redraw(); // cadre de sélection sur le schéma
}
function renderBehavior() { $('#behav').innerHTML = prog.behaviorHtml(S.sel); }
function updateSel() {
  if (!S.sel) { selHelper.visible = false; return; }
  const g = S.sel.group, f = document.activeElement;
  if (f !== $('#tX')) $('#tX').value = +g.position.x.toFixed(1);
  if (f !== $('#tZ')) $('#tZ').value = +g.position.z.toFixed(1);
  if (f !== $('#tR')) $('#tR').value = Math.round((((-g.rotation.y * 180 / Math.PI) % 360) + 360) % 360);
  selHelper.box.setFromObject(S.sel.group); selHelper.box.expandByScalar(1.5); selHelper.visible = true;
}
function selectWire(w) {
  if (w && !w.mesh) flushWires();
  if (S.selWire && S.selWire.mesh) S.selWire.mesh.material.emissive.setHex(0x000000);
  S.selWire = w || null;
  handles.forEach(h => (h.visible = !!w));
  if (w) {
    if (S.sel) { S.sel = null; $('#selBox').hidden = true; setPlacing(false); updateSel(); }
    if (w.mesh) w.mesh.material.emissive.copy(new THREE.Color(w.color)).multiplyScalar(0.35);
    handles[0].position.copy(pinWorld(w.a)).add(new V3(0, 4.5, 0));
    handles[1].position.copy(pinWorld(w.b)).add(new V3(0, 4.5, 0));
  }
  const i = w ? S.wires.indexOf(w) : -1;
  [...$('#wires').children].forEach((li, j) => li.classList.toggle('sel', j === i));
  timelineDock.markWire(w ? w.id : null);
}
function setPlacing(on) { S.placing = on; $('#placeBtn').classList.toggle('on', on); $('#placeBtn').textContent = on ? tl('Terminer le placement') : tl('Placer des broches'); }

/* ---------- Panneaux ---------- */
/** Message de la barre d'état ; kind = info | ok | warn | err. */
function status(t, kind = 'info') {
  const el = $('#status'); el.textContent = t; el.dataset.kind = kind;
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
}
/** Onglets de l'inspecteur : wiring | sim | video. */
function setTab(name) {
  if (!$(`#tab-${name}`)) name = 'wiring';
  document.querySelectorAll('.panel.right .tabs .tab').forEach(t => {
    const n = t.id.slice(4), on = n === name, pane = $(`#pane-${n}`);
    t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; if (pane) pane.hidden = !on;
  });
  if (name === 'prog') prog.render();
}
/** Onglet de séance (TP, devoir, projet de groupe) : à côté de Câblage, Code, Simulation. */
const sessionTab = {
  open(el, label, ic) {
    let t = $('#tab-sess');
    if (!t) {
      $('.panel.right .tabs').insertAdjacentHTML('afterbegin', `<button type="button" role="tab" class="tab sessTab" id="tab-sess" aria-controls="pane-sess" aria-selected="false"></button>`);
      $('#modPane').insertAdjacentHTML('beforebegin', '<div class="pane sessPane" id="pane-sess" role="tabpanel" aria-labelledby="tab-sess" hidden></div>');
      t = $('#tab-sess'); t.onclick = () => setTab('sess');
    }
    t.innerHTML = `${icon(ic || 'checklist')}<span>${esc(label)}</span>`;
    const pane = $('#pane-sess'); pane.replaceChildren(el); hydrateIcons(pane);
    setTab('sess');
  },
  close() { const t = $('#tab-sess'); if (!t) return; const was = t.getAttribute('aria-selected') === 'true'; t.remove(); $('#pane-sess').remove(); if (was) setTab('wiring'); },
  show() { if ($('#tab-sess')) setTab('sess'); },
  get visible() { const t = $('#tab-sess'); return !!t && t.getAttribute('aria-selected') === 'true'; }
};
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function pinCount(entry) {
  if (prettyCount[entry.id] == null) {
    let n = 0; entry.build({ g: new THREE.Group(), pin: () => n++ });
    prettyCount[entry.id] = n;
  }
  return prettyCount[entry.id];
}
const MINE = tl('Mes composants');
const libBtn = (attr, name, meta, extra, th = '') => `<button type="button" class="libItem" ${attr} title="${tl('{0} : cliquer pour l’ajouter, ou glisser sur le plan de travail', esc(name))}">${th}<span class="ln">${esc(name)}</span><small>${meta}</small>${extra}<span class="add">${icon('plus')}</span></button>`;
const kindLabel = i => (i.kind === 'skin' && BY_ID[i.as] ? tl('Apparence · {0}', BY_ID[i.as].pre) : i.kind === 'board' ? (FAMILIES[i.family] || {}).label?.split(' ')[0] || tl('Carte') : i.kind === 'module' ? tl('Module') : `${i.pins.length} br.`);
const mineBtns = items => items.map(i => libBtn(`data-u="${esc(i.id)}"`, i.name, esc(kindLabel(i)), `<span class="mini" data-del="${esc(i.id)}" title="${tl('Retirer de la bibliothèque')}">${icon('x')}</span>`)).join('');
const entryBtns = items => items.map(e => libBtn(`data-t="${e.id}"`, e.name, tl('{0} br.', pinCount(e)), `<span class="mini" data-doc="${e.id}" title="${tl('Documentation : {0}', esc(e.name))}">${icon('help')}</span>`, `<img class="th" data-th="${e.id}" alt="" draggable="false">`)).join('');
const catIcon = cat => icon(cat === MINE ? 'user' : CAT_ICON[cat] || 'box');
function renderLibrary() {
  const q = norm($('#libSearch').value.trim());
  const match = e => !q || norm(`${e.name} ${e.cat} ${e.pre}`).includes(q);
  let html = '';
  const mine = S.userLib.filter(i => !q || norm(i.name).includes(q));
  if (mine.length) html += `<h3>${catIcon(MINE)}${MINE}</h3>` + mineBtns(mine);
  CATEGORIES.forEach(cat => {
    const items = LIBRARY.filter(e => e.cat === cat && match(e)); if (!items.length) return;
    html += `<h3>${catIcon(cat)}${cat}<span>${items.length}</span></h3>` + (cat === CATEGORIES[0] && !q ? `<button type="button" class="libGuide" data-guide>${icon('help')}<span>${tl('Quelle carte choisir ?')}</span></button>` : '') + entryBtns(items);
  });
  $('#lib').innerHTML = html || `<p class="empty">${tl('Aucun composant ne correspond à cette recherche.')}</p>`;
  $('#libCount').textContent = LIBRARY.length + S.userLib.length;
  fillThumbnails($('#lib'), REAL.on ? 'real' : 'simple');
  renderRail();
}

/* ---------- Bibliothèque repliée : colonne d'icônes et volets par catégorie ---------- */
const LIB_CLOSED = 'jollof-studio-library-closed';
// Dès le chargement du module, avant le premier affichage : pas d'animation d'ouverture à fermeture.
try { if (localStorage.getItem(LIB_CLOSED) === '1') $('.app').classList.add('libClosed', 'still'); } catch (e) { /* stockage local indisponible */ }
const libIsOpen = () => !$('.app').classList.contains('libClosed');
function setLibOpen(open, remember = true) {
  $('.app').classList.toggle('libClosed', !open);
  const t = $('#libToggle'); t.setAttribute('aria-pressed', open); t.dataset.tip = tl('{0} la bibliothèque · Ctrl+B', open ? tl('Replier') : tl('Afficher'));
  closeFlyout();
  if (remember) try { localStorage.setItem(LIB_CLOSED, open ? '0' : '1'); } catch (e) { /* stockage local indisponible */ }
}
function renderRail() {
  const cats = [...(S.userLib.length ? [MINE] : []), ...CATEGORIES.filter(c => LIBRARY.some(e => e.cat === c))];
  $('#railCats').innerHTML = cats.map(c => `<button type="button" class="tb" data-cat="${esc(c)}" data-tip="${esc(c)}" aria-label="${esc(c)}" aria-haspopup="dialog" aria-expanded="${S.flyCat === c}">${catIcon(c)}</button>`).join('');
  if (S.flyCat) cats.includes(S.flyCat) ? renderFlyout() : closeFlyout();
}
function renderFlyout() {
  const cat = S.flyCat, items = cat === MINE ? S.userLib : LIBRARY.filter(e => e.cat === cat);
  $('#flyTitle').innerHTML = `${catIcon(cat)}${esc(cat)}<span class="count">${items.length}</span>`;
  $('#flyList').innerHTML = cat === MINE ? mineBtns(items) : entryBtns(items);
  fillThumbnails($('#flyList'), REAL.on ? 'real' : 'simple');
}
/** Ouvre le volet d'une catégorie à côté de son icône. */
function openFlyout(cat, btn) {
  S.flyCat = cat; renderFlyout();
  const fly = $('#flyout'), h = fly.parentElement.clientHeight, top = Math.max(8, Math.min(btn.offsetTop - 6, h - 380));
  fly.style.top = top + 'px'; fly.style.maxHeight = (h - top - 8) + 'px';
  fly.classList.remove('away'); fly.hidden = false;
  [...$('#railCats').children].forEach(b => b.setAttribute('aria-expanded', b.dataset.cat === cat));
}
function closeFlyout() {
  if (!S.flyCat) return;
  S.flyCat = null; $('#flyout').hidden = true; $('#flyout').classList.remove('away');
  [...$('#railCats').children].forEach(b => b.setAttribute('aria-expanded', 'false'));
}

/* ---------- Ajouter depuis la bibliothèque : clic ou glisser-déposer ---------- */
/** Crée le composant d'un bouton de la bibliothèque (asynchrone pour les modèles importés). */
async function libCreate(b) {
  if (b.dataset.t) return createComp(b.dataset.t);
  const item = S.userLib.find(i => i.id === b.dataset.u); if (!item) return null;
  return item.kind === 'skin' && BY_ID[item.as] ? addSkinned(item.as, { name: item.name, glb: item.glb, pins: Object.fromEntries(item.pins.map(p => [p.name, [p.x, p.y, p.z]])) }) : addCustom(item);
}
async function libClick(e) {
  if (S.libSuppress) return; // fin d'un glisser-déposer : le composant est déjà posé
  const doc = e.target.closest('[data-doc]');
  if (doc) { e.stopPropagation(); openDoc(doc.dataset.doc); return; }
  if (e.target.closest('[data-guide]')) { openDoc('guide'); return; }
  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); await native.libraryDelete(del.dataset.del); S.userLib = S.userLib.filter(i => i.id !== del.dataset.del); renderLibrary(); return; }
  const b = e.target.closest('.libItem'); if (!b) return;
  const c = await libCreate(b); if (!c) return;
  // Vue Schéma : posé au milieu de ce qu'on regarde (le schéma suit la place du composant sur le tapis).
  if (S.view2d && sch) { const m = sch.centerMm(); placeFree(c, m[0] / SHEET_SCALE, m[1] / SHEET_SCALE); } else placeFree(c);
  select(c); refreshQuick(); changed();
}
// Glisser-déposer fait main, aux événements pointeur : la fenêtre Tauri capte le glisser-déposer
// HTML5 pour les fichiers. Le vrai composant suit le curseur sur le tapis, sur la place libre la
// plus proche ; relâcher hors du plan de travail ou Échap annule, R le fait pivoter.
let drag = null;
function libDown(e) {
  if (e.button !== 0 || drag || S.rec || S.vr) return;
  const b = e.target.closest('.libItem');
  if (!b || e.target.closest('[data-doc], [data-del]')) return;
  drag = { b, id: e.pointerId, x: e.clientX, y: e.clientY, on: false, state: 'drag', comp: null };
  addEventListener('pointermove', libMove, true); addEventListener('pointerup', libUp, true);
  addEventListener('pointercancel', libCancel, true); addEventListener('keydown', libKey, true);
}
function libBegin(d) {
  d.on = true; S.libSuppress = true;
  d.in2d = !!(S.view2d && sch); // vue Schéma : on y pose le composant, il apparaît aussi en 3D
  try { d.b.setPointerCapture(d.id); } catch (err) { /* pointeur déjà relâché */ }
  d.b.classList.add('dragSrc'); document.body.classList.add('dragging');
  if (d.b.closest('#flyout')) $('#flyout').classList.add('away');
  d.name = d.b.querySelector('.ln').textContent;
  const th = d.b.querySelector('img.th');
  d.ghost = document.createElement('div'); d.ghost.className = 'dragGhost';
  d.ghost.innerHTML = `${th && th.src ? `<img src="${th.src}" alt="">` : icon('box')}<span>${esc(d.name)}</span>`;
  document.body.append(d.ghost);
  $('#dropText').innerHTML = `${tl('Relâcher pour poser')} <b>${esc(d.name)}</b> · <kbd>R</kbd> ${tl('pivoter ·')} <kbd>${tl('Échap')}</kbd> ${tl('annuler')}`;
  // Les autres composants ne bougent pas pendant le glisser : leurs emprises sont calculées une fois.
  d.boxes = S.comps.map(c => new THREE.Box3().setFromObject(c.group).expandByScalar(4));
  libCreate(d.b).then(c => {
    if (!c) { if (drag === d) libStop(d); return; }
    d.comp = c; c.dragging = true; measure(d);
    if (d.state === 'drag') { if (d.last) libPlace(d, d.last); return; }
    if (d.state === 'drop' && d.last) moveTo(d, d.last);
    libFinish(d);
  }).catch(err => { status(tl('Impossible d’ajouter {0} : {1}', d.name, err.message || err), 'err'); if (drag === d) libStop(d); });
}
/** Emprise du composant, relevée à sa position actuelle (et après chaque rotation). */
function measure(d) {
  const g = d.comp.group; g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  d.size = box.getSize(new V3()); d.box0 = box.translate(g.position.clone().negate());
  d.off = d.box0.getCenter(new V3());
}
/** Pose le composant sur la place libre la plus proche du point visé ; false si le curseur vise le ciel. */
function moveTo(d, ev) {
  if (d.in2d) {
    // Point visé sur le schéma → place sur le tapis (le symbole se dessine là où se trouve le composant).
    const m = sch.mmAt(ev.clientX, ev.clientY); if (!m) return false;
    const gx = m[0] / SHEET_SCALE + d.off.x, gz = m[1] / SHEET_SCALE + d.off.z;
    const p = freeSpot(d.size, gx, gz, d.boxes, 3, 1.2) || [Math.round(gx), Math.round(gz)];
    d.comp.group.position.set(p[0] - d.off.x, 0, p[1] - d.off.z); d.comp.group.updateMatrixWorld(true);
    return (d.placed = true);
  }
  setNdc(ev); const g = groundAt(); if (!g) return false;
  const p = freeSpot(d.size, g.x, g.z, d.boxes, 3, 1.2) || [Math.round(g.x), Math.round(g.z)];
  d.comp.group.position.set(p[0] - d.off.x, 0, p[1] - d.off.z); d.comp.group.updateMatrixWorld(true);
  return (d.placed = true);
}
function libPlace(d, ev) {
  const r = $('#stage').getBoundingClientRect();
  const over = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  d.over = over;
  d.ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 12}px)`;
  d.ghost.hidden = over && !!d.comp && !d.in2d; // sur le schéma, la vignette suit le curseur jusqu'au lâcher
  $('#stage').classList.toggle('dropping', over); $('#dropHint').hidden = !over;
  if (!d.comp) return;
  d.comp.group.visible = over && moveTo(d, ev);
  if (d.comp.group.visible) { selHelper.box.copy(d.box0).translate(d.comp.group.position).expandByScalar(1.5); selHelper.visible = true; }
  else updateSel();
}
function libMove(e) {
  const d = drag; if (!d || e.pointerId !== d.id) return;
  if (!d.on) { if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return; libBegin(d); }
  e.stopPropagation(); d.last = { clientX: e.clientX, clientY: e.clientY };
  libPlace(d, d.last);
}
function libUp(e) {
  const d = drag; if (!d || e.pointerId !== d.id) return;
  if (!d.on) { libStop(d); return; } // simple clic : libClick ajoute le composant
  e.stopPropagation();
  d.last = { clientX: e.clientX, clientY: e.clientY }; libPlace(d, d.last);
  d.state = d.over ? 'drop' : 'cancel';
  libStop(d);
  if (d.comp) libFinish(d); // sinon le chargement du modèle s'en charge à la fin
}
function libCancel() { const d = drag; if (!d) return; d.state = 'cancel'; libStop(d); if (d.comp) libFinish(d); }
function libKey(e) {
  const d = drag; if (!d || !d.on) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') { e.preventDefault(); e.stopPropagation(); libCancel(); return; }
  if (k === 'r' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault(); e.stopPropagation();
    if (!d.comp) return;
    d.comp.group.rotation.y += Math.PI / 2; d.comp.group.position.set(0, 0, 0); measure(d);
    if (d.last) libPlace(d, d.last);
  }
}
function libStop(d) {
  removeEventListener('pointermove', libMove, true); removeEventListener('pointerup', libUp, true);
  removeEventListener('pointercancel', libCancel, true); removeEventListener('keydown', libKey, true);
  if (drag === d) drag = null;
  try { d.b.releasePointerCapture(d.id); } catch (err) { /* déjà relâché */ }
  if (d.ghost) d.ghost.remove();
  d.b.classList.remove('dragSrc'); document.body.classList.remove('dragging');
  $('#stage').classList.remove('dropping'); $('#dropHint').hidden = true;
  if (d.state === 'drop') closeFlyout(); else $('#flyout').classList.remove('away');
  setTimeout(() => (S.libSuppress = false), 0); // après le « click » qui suit le relâchement
}
function libFinish(d) {
  const c = d.comp;
  c.dragging = false;
  if (d.state !== 'drop') { removeComp(c, true); updateSel(); return; }
  c.group.visible = true;
  if (!d.placed) placeFree(c);
  select(c); refreshQuick(); changed();
  status(tl('{0} posé sur le plan de travail. « Câbler automatiquement » le relie à la carte.', c.name), 'ok');
}
function renderWires() {
  refreshQuick(); renderExplain(); renderSim(); renderNets();
  const ol = $('#wires'); $('#wCount').textContent = S.wires.length || '';
  updateCounts();
  if (!S.wires.length) { ol.innerHTML = `<li class="emptyRow">${icon('cable')}<span>${tl('Aucun fil. Glissez d’une broche à une autre, en 3D ou sur le schéma, ou utilisez le câblage automatique.')}</span></li>`; return; }
  ol.innerHTML = S.wires.map((w, i) => `<li><span class="c" style="background:${w.color}"></span><span class="l" data-i="${i}" title="${tl('{0}Sélectionner ce fil', esc(w.role ? w.role + ' · ' : ''))}">${esc(w.a.comp.name)} ${esc(w.a.key)} <b>→</b> ${esc(w.b.comp.name)} ${esc(w.b.key)}</span>
    <span class="a"><button data-a="up" data-i="${i}" aria-label="${tl('Monter')}" title="${tl('Monter')}">${icon('chevUp')}</button><button data-a="down" data-i="${i}" aria-label="${tl('Descendre')}" title="${tl('Descendre')}">${icon('chevDown')}</button><button data-a="del" data-i="${i}" aria-label="${tl('Supprimer le fil')}" title="${tl('Supprimer')}">${icon('trash')}</button></span></li>`).join('');
  if (S.selWire) selectWire(S.selWire);
}
/** Nœuds du montage : broches reliées entre elles, avec un nom automatique ou choisi. */
function renderNets() {
  const ul = $('#nets');
  if (!S.netView) return;
  const A = analyze(S.comps, S.wires), seen = new Set(), rows = [];
  const pid = r => `${r.comp.id}|${r.key}`;
  for (const w of S.wires) {
    const mem = A.members(w.a); if (seen.has(mem)) continue; seen.add(mem);
    const real = mem.filter(m => !/^breadboard/.test(m.comp.type) && busy(m)); // broches reliées, trous de breadboard exclus
    if (!real.length) continue;
    const key = real.map(pid).sort()[0], net = A.net(w.a), gp = net.gpio[0];
    let auto = '';
    if (net.src.length) auto = volts(Math.max(...net.src.map(x => x.v)));
    else if (net.gnd.length) auto = 'GND';
    else if (gp) { const pr = gp.prof, bk = baseKey(gp.key), bus = pr.i2c.sda === bk ? ' · I2C SDA' : pr.i2c.scl === bk ? ' · I2C SCL' : pr.spi.sck === bk ? ' · SPI SCK' : ''; auto = `${gp.comp.name} ${gp.key}${bus}`; }
    else auto = `${real[0].comp.name} ${real[0].key}`;
    const shown = real.map(m => `${m.comp.name} ${m.key}`);
    rows.push(`<li data-key="${esc(key)}" data-pins="${esc(real.map(pid).join(','))}"><span class="c" style="background:${w.color}"></span><b class="nn" title="${tl('Double-cliquer pour renommer')}">${esc(S.netNames[key] || auto)}</b><span class="mem">${esc(shown.join(' · '))}</span></li>`);
  }
  ul.innerHTML = rows.join('') || `<li class="emptyRow">${icon('cable')}<span>${tl('Aucune connexion.')}</span></li>`;
}
function setNetView(on) {
  S.netView = on; $('#nets').hidden = !on; $('#wires').hidden = on;
  $('#showNets').setAttribute('aria-pressed', on); $('#showWires').setAttribute('aria-pressed', !on);
  renderNets();
}
function refreshQuick() {
  const html = S.comps.map(c => `<optgroup label="${esc(c.name)}">${Object.keys(c.pins).map(k => `<option value="${c.id}|${esc(k)}">${esc(c.name)} ${esc(k)}</option>`).join('')}</optgroup>`).join('');
  ['#qA', '#qB'].forEach(id => { const el = $(id), v = el.value; el.innerHTML = html; if ([...el.options].some(o => o.value === v)) el.value = v; });
}
function refFrom(v) {
  const i = v.indexOf('|'); const comp = S.comps.find(c => c.id === v.slice(0, i));
  return comp && comp.pins[v.slice(i + 1)] ? { comp, key: v.slice(i + 1) } : null;
}
function setProjectName(name, path) { S.projectName = name; S.projectPath = path ?? S.projectPath; $('#projectName').textContent = name; }
function updateCounts() {
  const n = S.comps.length, w = S.wires.length;
  $('#counts').textContent = tl('{0} composant{1} · {2} fil{3}', n, n > 1 ? 's' : '', w, w > 1 ? 's' : '');
}
function changed() {
  syncTimeline(); // avant l'instantané : la timeline suit les fils ajoutés ou retirés
  invalidate(300); S.dc = null; if (bench) bench.refresh();
  commit(); renderSim(); updateCounts(); prog.circuitChanged(); if (S.sel) renderBehavior();
  S.changeHooks.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  S.dirty = true; $('#projectName').classList.add('dirty');
  clearTimeout(changed.t); changed.t = setTimeout(autosave, 400);
}

/* ---------- Simulation ---------- */
const TREND = { 1: '↗', '-1': '↘' };
const simComps = () => S.comps.filter(c => MODELS[c.type]);
function dropLabel(c) { if (!c.label) return; scene.remove(c.label); disposeLabel(c.label); c.label = null; }
function showLabel(c, r) {
  if (!c.label) { c.label = makeLabel(); scene.add(c.label); }
  const b = new THREE.Box3().setFromObject(c.group);
  c.label.position.set((b.min.x + b.max.x) / 2, b.max.y + 9, (b.min.z + b.max.z) / 2);
  c.label.userData.base = c.label.position.clone();
  paintLabel(c.label, `${c.name}${r.sig ? ' · ' + r.sig : ''}`, r.value + (r.trend ? ' ' + TREND[r.trend] : ''), r.level);
}
/** Redessine un écran : null = texte de démonstration, [] = éteint. */
function paintScreen(c, lines) {
  const s = c.screen, key = !lines ? 'demo' : lines.ops ? `ops:${lines.ver}:${lines.inv}` : lines.length + ':' + lines.join('\n');
  if (s.key === key) return; s.key = key;
  const tex = s.mesh.material.map, x = tex.image.getContext('2d');
  x.clearRect(0, 0, tex.image.width, tex.image.height); s.paint(x, s.k, lines); tex.needsUpdate = true;
}
/** Programmes des cartes (onglet Code) : règles, code, exécution. */
const prog = createProgram({
  comps: () => S.comps, wires: () => S.wires,
  sim: () => ({ A: S.simA, ins: S.insMap, drive: S.drive, pinComps: S.pinComps }),
  /** Tension d'une broche de carte calculée par le solveur (pont diviseur, condensateur…), ou null. */
  dcPin: (boardId, key) => (S.dcPins ? S.dcPins.get(boardId + '|' + key) ?? null : null),
  simOn: () => S.simOn, setSim, setTab, status,
  markDirty() { S.dirty = true; $('#projectName').classList.add('dirty'); clearTimeout(changed.t); changed.t = setTimeout(autosave, 400); if (chk) chk.schedule(); },
  refreshSel() { if (S.sel) renderBehavior(); },
  /** Valeurs de départ posées : curseurs d'environnement et commandes des entrées suivent. */
  envChanged() { renderSim.sig = null; renderSim(); S.comps.forEach(c => { if (c.type === 'button' || c.type === 'joystick') syncPress(c); }); }
});
const screenLines = (c, list) => (c.type === 'lcd1602' ? [list[0], list[1] || ''] : [list[0], list.slice(1).join('  ')]);
/** Onglet Simulation : télécommande, badges RFID, clavier, téléphones Bluetooth et GSM des modules câblés. */
installPeripherals({ comps: () => S.comps, simOn: () => S.simOn, ins: () => S.insMap, net: () => prog.net(), netChanged: () => prog.netChanged() });
function setSim(on) {
  S.simOn = on; S.simLast = performance.now() - 1000;
  $('#simBtn').innerHTML = icon(on ? 'stop' : 'play') + `<span>${on ? tl('Arrêter') : tl('Simuler')}</span>`;
  $('#simBtn').classList.toggle('running', on); $('#simBtn').dataset.tip = on ? tl('Arrêter la simulation') : tl('Lancer la simulation');
  $('#simLive').hidden = !on; $('#simEmpty').hidden = on; $('#faultSec').hidden = !on;
  $('#simState').classList.toggle('on', on); $('#simState span:last-child').textContent = on ? tl('Simulation en cours') : tl('Simulation arrêtée');
  $('#lockChip').hidden = !on;
  if (on) {
    cancelPending(); selectWire(null); S.wireDrag = null; S.endDrag = null; rubber.visible = false; setHover(null); controls.enabled = true;
    audio.unlock(); S.progLast = performance.now(); S.simA = null;
    prog.applyInits();
    const r = prog.startAll();
    if ($('#pane-prog').hidden) setTab('sim');
    if (r.n && !r.bad) status(`${r.n > 1 ? tl('{0} programmes s’exécutent', r.n) : tl('Le programme s’exécute')}.${S.comps.some(c => c.type === 'button') ? tl(' Cliquez sur un bouton du montage pour l’appuyer.') : ''}`, 'ok');
  }
  if (!on) {
    prog.stopAll(); resetActuators(S.comps);
    S.comps.forEach(c => { dropLabel(c); c.simS = c.simR = null; if (c.screen) paintScreen(c, null); if (c.inp && S.pressing === c) c.inp.pressed = false; });
    S.pressing = null; S.simA = null;
    S.wires.forEach(w => { if (w.pulse) { w.pulse = null; if (w.bead && w.progress >= 1) w.bead.visible = false; } });
    fx.clear(); S.faults = []; S.faultKeys = new Set(); S.faultWires = new Map(); glowWires(0);
    S.dc = null; S.dcPins = null; resetDynamic(S.comps); if (flow) flow.clear(); if (sch) sch.clear(); hideSimTip();
    $('#alert').hidden = true; renderFaults(); updatePower(); renderOuts();
  }
  updateProbes();
}
/** Un pas de simulation (image affichée ou image de la vidéo) : capteurs, programmes, effets, courant. */
function simFrame(now) {
  if (now - S.simLast >= 100) {
    simTick(now);
    // Circuit statique : un calcul par pas. Premier calcul d'un circuit à condensateur : un pas très court tout
    // de suite, pour que le condensateur soit modélisé (déchargé) et non laissé ouvert.
    if (!(S.dc && S.dc.dyn)) { const r = solveLive(0); if (r && r.dyn) solveLive(0.001); }
    updateFlow();
  }
  runPrograms(now); runPulses(now); runFaultFx(now);
  if (flow && !S.view2d) flow.update(now);
}
/** Programmes des cartes et effecteurs, à chaque image. */
function runPrograms(now) {
  // Après un redémarrage, les programmes attendent une analyse du montage à jour.
  if (!S.simA) { S.progLast = now; return; }
  const dt = Math.min(250, Math.max(0, now - (S.progLast || now))); S.progLast = now;
  prog.frame(dt);
  if (S.dc && S.dc.dyn && dt > 0) solveLive(dt / 1000); // condensateur, transistor : le circuit avance avec le temps
  if (bench) bench.sample();
  if (S.simA) driveActuators(S.comps, { ins: S.insMap, rts: prog.rts, A: S.simA, dc: S.dc }, dt / 1000);
}
/** Relance les programmes sur un montage recréé (projet ouvert, annulation…) : nouvelle analyse d'abord. */
function restartPrograms() { resetActuators(S.comps); S.simA = null; S.simLast = performance.now() - 1000; prog.startAll(); if (bench) bench.reset(); }
/** Effecteurs qui ont une étiquette dans la scène (les LED se voient d'elles-mêmes). */
const ACT_LABEL = new Set(['servo', 'relay', 'buzzer', 'speaker', 'dcmotor', 'stepper', 'fan', 'pump', 'vibro']);
const OLED_TEXT = scr => scr.ops.filter(o => o.t === 'text').map(o => o.str.trim()).filter(Boolean).join(' / ');
/** Niveau d'une sortie de capteur vu de la carte, à travers un pont diviseur ou un adaptateur de niveau (circuit.js bridge). */
function linked(v, link, prof) {
  if (!link || !v || link.kind === 'series') return v;
  if (link.kind === 'shift') return { d: v.d, v: v.d ? prof.logic : 0 };
  if (v.v == null) return v;
  const x = v.v * link.ratio;
  return { ...v, v: x, d: x > prof.logic / 2 ? 1 : 0 };
}
/**
 * Analyse du montage pour la simulation, gardée tant que rien de ce qui la détermine ne change (composants, fils et
 * leurs extrémités, fils encore en cours de tracé, boutons appuyés, relais collés) : le calcul du circuit (dc.js)
 * garde alors sa topologie d'un pas à l'autre au lieu de la reconstruire 10 fois par seconde.
 */
function simAnalyze() {
  let sig = '';
  for (const c of S.comps) { sig += c.id + ':' + Object.keys(c.pins).length; if (c.type === 'button') sig += c.inp && c.inp.pressed ? '+' : '-'; else if (c.type === 'relay') sig += c.relayOn ? '+' : '-'; sig += ','; }
  sig += '|';
  for (const w of S.wires) sig += `${w.a.comp.id}.${w.a.key}-${w.b.comp.id}.${w.b.key}${(w.progress ?? 1) < 1 ? '~' : ''},`;
  if (simAnalyze.sig === sig && simAnalyze.A && simAnalyze.comps === S.comps && simAnalyze.wires === S.wires) return simAnalyze.A;
  simAnalyze.sig = sig; simAnalyze.comps = S.comps; simAnalyze.wires = S.wires;
  return (simAnalyze.A = analyze(S.comps, S.wires));
}
/** Un pas de simulation (10 fois par seconde) : vérifie le câblage, fait réagir chaque capteur, met à jour écrans et étiquettes. */
function simTick(now) {
  const dt = Math.min(0.5, (now - S.simLast) / 1000), t = now / 1000; S.simLast = now;
  const A = simAnalyze(), shown = new Map(), insMap = new Map(), drive = new Map(), pinComps = new Map();
  // Chaque composant inspecté une fois : quelle broche de quelle carte commande ou lit chacune de ses broches.
  for (const c of S.comps) {
    const spec = partOf(c); if (!spec || !spec.pins) continue;
    const ins = inspect(c, A, spec); insMap.set(c, ins);
    for (const [k, g] of Object.entries(ins.io)) { const id = g.comp.id + '|' + g.key; if (!pinComps.has(id)) pinComps.set(id, []); pinComps.get(id).push({ comp: c, pin: k }); }
  }
  S.simA = A; S.insMap = insMap; S.pinComps = pinComps;
  for (const c of S.comps) {
    const m = MODELS[c.type]; if (!m || m.display) continue;
    const ins = insMap.get(c) || inspect(c, A, partOf(c)), sig = Object.values(ins.io)[0];
    advance(c, m, dt);
    let r;
    if (ins.level === 'err') { c.simS.next = 0; r = { level: 'err', value: firstMsg(ins) || tl('câblage incomplet'), detail: tl('aucune mesure tant que le câblage est incorrect') }; }
    else {
      r = readSensor(c, m, { A, prof: ins.prof, v: ins.v ?? (ins.prof ? ins.prof.logic : 0), io: ins.io, flags: ins.flags }, t);
      r.level = r.level || (r.warn || ins.level === 'warn' ? 'warn' : 'ok');
      r.warn = r.warn || firstMsg(ins, 'warn');
      if (r.sampled) pulseFrom(c, ins, now);
      // Ce que le capteur présente sur ses broches de sortie : la carte le lit avec digitalRead ou analogRead.
      // Par un pont diviseur, la carte ne reçoit qu'une fraction de la tension ; par un adaptateur, le même niveau à sa propre tension.
      if (r.out) for (const [k, v] of Object.entries(r.out)) { const g = ins.io[k]; if (g) drive.set(g.comp.id + '|' + g.key, linked(v, ins.link[k], ins.prof)); }
      // Les écrans affichent d'abord les capteurs, puis les entrées (bouton, potentiomètre).
      if (r.short && r.level !== 'err') { if (!shown.has(ins.board)) shown.set(ins.board, []); shown.get(ins.board).push({ t: r.short, p: m.q.length ? 0 : 1 }); }
    }
    r.sig = sig ? sig.key : '';
    c.simR = r; showLabel(c, r);
  }
  S.drive = drive;
  for (const c of S.comps) {
    if (!c.screen) continue;
    const ins = insMap.get(c) || inspect(c, A, partOf(c)), off = ins.level === 'err';
    const rt = ins.board && prog.rts.get(ins.board.id), ps = c.progScreen;
    let lines, value;
    if (rt) {
      // Carte programmée : l'écran montre ce que le programme y écrit, et rien d'autre.
      lines = off ? [] : c.type === 'lcd1602' ? (ps ? ps.lines : ['', '']) : ps || [];
      value = off ? firstMsg(ins) || tl('câblage incomplet') : !ps ? tl('rien d’affiché par le programme') : ps.ops ? OLED_TEXT(ps) || 'dessin' : ps.lines.length ? ps.lines.map(l => l.trimEnd()).join(' / ') : tl('rétroéclairage éteint');
    } else {
      const list = (shown.get(ins.board) || []).slice().sort((a, b) => a.p - b.p).map(x => x.t);
      lines = off ? [] : list.length ? screenLines(c, list) : ['Jollof Studio', tl('Aucun capteur')];
      value = off ? firstMsg(ins) || tl('câblage incomplet') : lines.filter(Boolean).join(' / ');
    }
    paintScreen(c, lines);
    c.simR = { level: ins.level, sig: ins.board ? ins.board.name : '', warn: firstMsg(ins, 'warn'), value,
      detail: off ? tl('écran éteint') : rt ? tl('piloté par le programme de {0}', ins.board.name) : tl('affiche les mesures des capteurs reliés à la même carte') };
  }
  for (const c of S.comps) {
    if (!ACT_LABEL.has(c.type)) continue;
    if (c.actR) showLabel(c, c.actR); else dropLabel(c);
  }
  // Pendant une animation de câblage, les fils à moitié tracés ne sont pas des erreurs.
  if (S.anim) { fx.set([]); S.faultWires = new Map(); } else updateFaults(A, now);
  updateProbes(); renderOuts();
}
/** Effecteurs pilotés par un programme, dans l'onglet Simulation. */
function renderOuts() {
  const list = S.simOn ? S.comps.filter(c => c.actR) : [];
  $('#outSec').hidden = !list.length;
  const html = list.map(c => `<li class="${c.actR.level}${c.actR.live ? ' live' : ''}"><div class="ph"><span class="lv"></span><b>${esc(c.name)}</b><span class="sig">${esc(c.actR.sig || '')}</span></div><div class="pv">${esc(c.actR.value)}</div></li>`).join('');
  if (html !== renderOuts.html) { renderOuts.html = html; $('#outs').innerHTML = html; }
}

/* ---------- Erreurs de câblage ---------- */
const ACT = { see: tl('Voir'), wire: tl('Câbler'), rewire: tl('Recâbler'), swap: tl('Inverser les fils'), joingnd: tl('Relier les masses'), cut: tl('Retirer le fil'), tognd: tl('Relier à la masse'), to3v3: tl('Brancher sur 3V3') };
const ACT_ICON = { see: 'eye', wire: 'wand', rewire: 'wrench', swap: 'swap', joingnd: 'link', cut: 'scissors', tognd: 'link', to3v3: 'wrench' };
const above = r => pinWorld(r).add(new V3(0, 1, 0));
function compTop(c) { const b = new THREE.Box3().setFromObject(c.group); return new V3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2); }
/** Détecte les erreurs, met à jour les effets 3D et, pour une nouvelle erreur, déclenche l'alerte. */
function updateFaults(A, now) {
  const faults = collectFaults(S.comps, S.wires, A, { dist: (a, b) => pinWorld(a).distanceTo(pinWorld(b)), boardFor: c => boardFor(c, A) });
  // Erreurs vues par le calcul du circuit : condensateur chimique monté à l'envers.
  if (S.dc && S.dc.ok) { try { faults.push(...elecFaults(S.dc, S.comps, A)); } catch (e) { console.error(e); } }
  fx.set(faults.map(f => ({
    key: f.key, level: f.level, fx: f.fx,
    points: [...f.pins, ...f.culprits].map(r => ({ pos: above(r), tag: r.key })),
    smoke: f.fx === 'smoke' ? (f.code === 'drvdirect' && f.culprits[0] ? above(f.culprits[0]) : compTop(f.comp)) : null,
    ghost: f.suggest ? { a: above(f.suggest.from), b: above(f.suggest.to) } : null
  })));
  S.faultWires = new Map();
  faults.forEach(f => f.wires.forEach(w => { if (S.faultWires.get(w) !== 'err') S.faultWires.set(w, f.level); }));
  const fresh = faults.filter(f => !S.faultKeys.has(f.key));
  S.faultKeys = new Set(faults.map(f => f.key)); S.faults = faults;
  fresh.forEach(f => { if (f.comp && !f.missing) f.comp.shake = now; });
  const bad = fresh.find(f => f.level === 'err');
  renderFaults(fresh);
  if (bad) { alertFault(bad); setTab('sim'); $('#faultSec').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}
function renderFaults(fresh = []) {
  const ul = $('#faults'), list = S.faults, count = $('#faultCount');
  const errs = list.filter(f => f.level === 'err').length;
  count.hidden = !list.length; count.textContent = errs || list.length; count.title = errs ? tl('{0} erreur{1} de câblage', errs, errs > 1 ? 's' : '') : tl('{0} point{1} à vérifier', list.length, list.length > 1 ? 's' : '');
  count.classList.toggle('warn', !errs);
  const sig = S.simOn + '|' + list.map(f => f.key + f.fix).join('|');
  if (sig === renderFaults.sig) return;
  renderFaults.sig = sig;
  if (!S.simOn) { ul.innerHTML = ''; return; }
  if (!list.length) { ul.innerHTML = `<li class="clean">${tl('✓ Aucune erreur de câblage')}</li>`; return; }
  const isNew = new Set(fresh.map(f => f.key));
  ul.innerHTML = list.map(f => `<li class="fault ${f.level}${isNew.has(f.key) ? ' new' : ''}" data-key="${esc(f.key)}" title="${tl('Cliquer pour voir l’erreur dans la scène')}">
    <div class="ft"><span class="fi">${f.level === 'err' ? '✕' : '!'}</span>${CHECK_CODE[f.code] ? `<code class="jcode">${CHECK_CODE[f.code]}</code>` : ''}<b>${esc(f.title)}</b></div>
    <div class="fw">${esc(f.where)}</div>
    <p><em>${tl('Pourquoi ?')}</em> ${esc(f.why)}</p>
    <p><em>${tl('Correction :')}</em> ${esc(f.fix)}</p>
    <div class="fa">${f.actions.map(a => `<button type="button" class="btn small${a === 'see' ? '' : ' primary'}" data-act="${a}">${icon(ACT_ICON[a])}<span>${ACT[a]}</span></button>`).join('')}</div>
  </li>`).join('');
}
/** Toast en haut du plan de travail + éclair rouge sur les bords. */
function alertFault(f) {
  const el = $('#alert'), st = $('#stage');
  $('#alertTitle').textContent = f.title; $('#alertWhere').textContent = f.where; el.dataset.key = f.key;
  el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  st.classList.remove('flash'); void st.offsetWidth; st.classList.add('flash');
  clearTimeout(alertFault.t); alertFault.t = setTimeout(() => (el.hidden = true), 7000);
}
/** Effets image par image : ondes et étincelles, fils fautifs qui rougeoient, étiquettes qui tremblent. */
function runFaultFx(now) {
  fx.update(now); glowWires(now);
  for (const c of S.comps) {
    const L = c.label; if (!L || !L.userData.base) continue;
    L.position.copy(L.userData.base);
    const d = c.shake ? (now - c.shake) / 700 : 1;
    if (d < 1) L.position.x += Math.sin(d * 42) * 2.4 * (1 - d);
  }
}
const restoreGlow = w => (w === S.selWire ? w.mesh.material.emissive.copy(new THREE.Color(w.color)).multiplyScalar(0.35) : w.mesh.material.emissive.setHex(0));
function glowWires(now) {
  const k = 0.55 + 0.45 * Math.sin(now / 120), next = new Set();
  for (const [w, lvl] of S.faultWires) {
    if (!w.mesh || !S.wires.includes(w)) continue;
    next.add(w);
    // Orange « chauffé au rouge » : reste visible même sur un fil rouge d'alimentation.
    w.mesh.material.emissive.setHex(lvl === 'err' ? 0xff6a10 : 0xffa000).multiplyScalar(k * (lvl === 'err' ? 1.3 : 0.5));
  }
  for (const w of S.glowing) if (!next.has(w) && w.mesh) restoreGlow(w);
  S.glowing = next;
}
/** Amène la caméra sur l'erreur (sans changer l'angle de vue). */
function flyTo(target, dist) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  S.fly = { t0: performance.now(), a: controls.target.clone(), b: target.clone(), pa: camera.position.clone(), pb: target.clone().addScaledVector(dir, dist) };
}
function runFly(now) {
  const f = S.fly, k = ease(clamp((now - f.t0) / 800));
  controls.target.lerpVectors(f.a, f.b, k); camera.position.lerpVectors(f.pa, f.pb, k);
  if (k >= 1) S.fly = null;
}
/** Points de vue prédéfinis, centrés sur tout le montage. */
const VIEWS = { iso: [0.45, 0.75, 1], top: [0, 1, 0.002], front: [0, 0.32, 1], side: [1, 0.32, 0] };
function setView(name) {
  const b = new THREE.Box3(); S.comps.forEach(c => b.expandByObject(c.group));
  const center = b.isEmpty() ? controls.target.clone() : b.getCenter(new V3()), size = b.isEmpty() ? 120 : b.getSize(new V3()).length();
  const dir = new V3(...VIEWS[name]).normalize(), dist = Math.max(90, size * 1.1);
  S.fly = { t0: performance.now(), a: controls.target.clone(), b: center, pa: camera.position.clone(), pb: center.clone().addScaledVector(dir, dist) };
}
/** Vue depuis une direction (cube d'orientation), à la même distance et autour du même point. */
function viewFrom(dir) {
  const d = dir.clone();
  if (d.y > 0.999) d.z = 0.002; // vue de dessus : l'avant reste en bas de l'écran
  if (d.y < 0.06) d.y = 0.06; // pas de vue par-dessous le tapis
  d.normalize();
  const dist = camera.position.distanceTo(controls.target);
  S.fly = { t0: performance.now(), a: controls.target.clone(), b: controls.target.clone(), pa: camera.position.clone(), pb: controls.target.clone().addScaledVector(d, dist) };
}
/** Centre la caméra sur un composant. */
function frameComp(c) {
  const b = new THREE.Box3().setFromObject(c.group), size = b.getSize(new V3()).length();
  flyTo(b.getCenter(new V3()), Math.max(60, size * 1.4));
}
function focusFault(f) {
  if (S.view2d) setStageView('3d'); // la caméra montre l'erreur sur le montage en 3D
  const pts = [...f.pins, ...f.culprits, ...(f.suggest ? [f.suggest.to] : [])].map(pinWorld);
  const c = pts.reduce((a, p) => a.add(p), new V3()).multiplyScalar(1 / pts.length);
  flyTo(c, Math.max(80, Math.max(...pts.map(p => p.distanceTo(c))) * 2.8));
  const now = performance.now();
  fx.highlight(f.key, now);
  if (f.comp) f.comp.shake = now;
}
/** Réparations proposées dans la carte d'erreur. */
function fixFault(f, act) {
  if (S.rec) return;
  if (S.anim) finishAnim();
  const at = r => S.wires.filter(w => same(w.a, r) || same(w.b, r));
  if (act === 'rewire' || act === 'wire') {
    const pins = /^drv/.test(f.code) ? Object.keys(f.comp.pins).map(key => ({ comp: f.comp, key })) : f.pins;
    pins.forEach(r => at(r).forEach(removeWire));
    autoWire(f.comp);
    return;
  }
  if (act === 'cut') { const w = f.cutWire || f.wires[0]; if (w && S.wires.includes(w)) removeWire(w); }
  // Bouton : son autre patte quitte l'alimentation pour la masse (tirage interne, appuyé = LOW) ou pour le 3V3.
  if ((act === 'tognd' || act === 'to3v3') && f.other) {
    const board = boardFor(f.comp, analyze(S.comps, S.wires)), want = act === 'tognd' ? 'GND' : '3V3';
    const key = board && Object.keys(board.pins).find(k => k.replace(/ \(\d+\)$/, '') === want);
    if (!key) { status(tl('{0} n’a pas de broche {1}.', board ? board.name : tl('La carte'), want), 'warn'); return; }
    const old = at(f.other).map(w => ({ a: w.a, b: w.b, color: w.color }));
    old.length && at(f.other).forEach(removeWire);
    if (joinNodes(f.other, { comp: board, key })) {
      status(act === 'tognd' ? tl('{0} relié à la masse : appuyé, l’entrée passe à LOW (INPUT_PULLUP dans le code généré).', f.comp.name) : tl('{0} relié au 3V3 de {1} : appuyé, l’entrée reçoit 3,3 V.', f.comp.name, board.name), 'ok');
      return;
    }
    old.forEach(w => addWire(w.a, w.b, w.color, true)); // pas de point libre : le câblage d'avant revient
    renderWires(); updatePower();
    return;
  }
  if (act === 'swap') {
    const [p1, p2] = f.swap || ['A', 'K']; // LED (A/K) ou condensateur chimique (+/−)
    S.wires.forEach(w => ['a', 'b'].forEach(e => { if (w[e].comp === f.comp && (w[e].key === p1 || w[e].key === p2)) w[e] = { comp: f.comp, key: w[e].key === p1 ? p2 : p1 }; }));
    S.wires.filter(w => w.a.comp === f.comp || w.b.comp === f.comp).forEach(buildWire);
  }
  if (act === 'joingnd') {
    const board = boardFor(f.comp, analyze(S.comps, S.wires)), from = f.culprits[0], added = [], warns = [];
    if (board && from) {
      const plan = planWithBreadboard(() => planJoinGround(from, planCx(board)), board, warns);
      if (!plan.needBreadboard) applyPlan(plan, f.comp, board, added);
      if (added.length) { renderWires(); updatePower(); changed(); status([tl('Masses reliées.'), ...warns].join(' '), 'ok'); startAnim(added); return; }
    }
  }
  renderWires(); updatePower(); changed();
  status(tl('Correction appliquée.'), 'ok');
}
/** Une impulsion lumineuse parcourt le fil de données à chaque lecture du capteur. */
function pulseFrom(c, ins, now) {
  if (now - (c.simS.pulse || 0) < 900) return;
  c.simS.pulse = now;
  const keys = new Set(Object.keys(ins.io));
  S.wires.forEach(w => {
    if (w.progress < 1) return;
    if (w.a.comp === c && keys.has(w.a.key)) w.pulse = { t0: now, fromA: true };
    else if (w.b.comp === c && keys.has(w.b.key)) w.pulse = { t0: now, fromA: false };
  });
}
function runPulses(now) {
  for (const w of S.wires) {
    if (!w.pulse || !w.mesh) continue;
    const t = (now - w.pulse.t0) / 500;
    if (t >= 1 || w.progress < 1) { w.pulse = null; if (w.progress >= 1) w.bead.visible = false; continue; }
    w.bead.visible = true; w.bead.position.copy(w.curve.getPointAt(w.pulse.fromA ? ease(t) : 1 - ease(t)));
  }
}
function envField(q) {
  const Q = QUANT[q];
  if (Q.bool) return `<label class="check"><input type="checkbox" data-q="${q}"${ENV[q] ? ' checked' : ''}> ${esc(Q.label)}</label>`;
  return `<label class="field"><span class="fh">${esc(Q.label)}<output data-o="${q}">${fmtQ(q)}</output></span><input type="range" data-q="${q}" min="${Q.min}" max="${Q.max}" step="${Q.step}" value="${ENV[q]}"></label>`;
}
function probeRow(c) {
  const i = c.inp, n = esc(c.name);
  let ctl = '';
  if (c.type === 'button') ctl = `<button class="btn small" data-press="pressed" aria-pressed="${!!i.pressed}">${i.pressed ? tl('Relâcher le bouton') : tl('Appuyer sur le bouton')}</button>`;
  if (c.type === 'pot') ctl = `${tl('Curseur')} <input type="range" data-inp="pos" min="0" max="100" value="${i.pos}" aria-label="${tl('Position du curseur de {0}', n)}">`;
  if (c.type === 'joystick') ctl = `X <input type="range" data-inp="x" min="-100" max="100" value="${i.x}" aria-label="${tl('Axe X de {0}', n)}"> Y <input type="range" data-inp="y" min="-100" max="100" value="${i.y}" aria-label="${tl('Axe Y de {0}', n)}"> <button class="btn small" data-press="sw" aria-pressed="${!!i.sw}">SW</button>`;
  return `<li data-id="${esc(c.id)}"><div class="ph"><span class="lv"></span><b>${n}</b><span class="sig"></span></div><div class="pv">—</div><div class="pd"></div><div class="pm"></div>${ctl ? `<div class="ctl">${ctl}</div>` : ''}</li>`;
}
/** Reconstruit curseurs et liste des capteurs seulement quand les composants simulés changent. */
function renderSim() {
  const comps = simComps(), order = Object.keys(QUANT);
  const qs = [...new Set(comps.flatMap(c => MODELS[c.type].q))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const sig = comps.map(c => c.id).join() + '|' + qs.join();
  if (sig === renderSim.sig) return;
  renderSim.sig = sig;
  $('#env').innerHTML = qs.map(envField).join(''); $('#envSec').hidden = !qs.length;
  $('#probes').innerHTML = comps.length ? comps.map(probeRow).join('') : `<li class="empty">${tl('Ajoutez un capteur (DHT22, HC-SR04, photorésistance…), une entrée ou un écran pour le simuler.')}</li>`;
  updateProbes();
}
function updateProbes() {
  for (const li of $('#probes').children) {
    const c = S.comps.find(x => x.id === li.dataset.id); if (!c) continue;
    const r = S.simOn ? c.simR : null;
    li.className = r ? r.level : '';
    li.querySelector('.sig').textContent = r ? r.sig || '' : '';
    li.querySelector('.pv').innerHTML = r ? esc(r.value) + (r.trend ? `<i>${TREND[r.trend]}</i>` : '') : '—';
    li.querySelector('.pd').textContent = r ? r.detail || '' : tl('Démarrez la simulation pour le lire.');
    li.querySelector('.pm').textContent = r && r.warn ? '⚠ ' + r.warn : '';
  }
}

/* ---------- Câblage automatique ---------- */
const boards = () => S.comps.filter(c => boardOf(c));
/** Carte déjà reliée au composant, sinon `fallback`, sinon la plus proche. */
function boardFor(comp, A, fallback) {
  for (const k in comp.pins) { const g = A.wnet({ comp, key: k }).gpio[0]; if (g) return g.comp; }
  if (fallback) return fallback;
  const p = comp.group.position;
  return boards().sort((a, b) => a.group.position.distanceTo(p) - b.group.position.distanceTo(p))[0];
}
const planCx = board => ({ board, A: analyze(S.comps, S.wires), wires: S.wires, comps: S.comps, dist: (a, b) => pinWorld(a).distanceTo(pinWorld(b)) });
/** Breadboard posée sous la carte, quand le câblage en a besoin. */
function placeBreadboard(board) {
  const c = createComp('breadboard'), q = board.group.position;
  const d = new THREE.Box3().setFromObject(board.group).getSize(new V3()).z;
  placeFree(c, q.x, q.z + d / 2 + 48, 8, 1.5);
  return c;
}
/** Calcule un plan ; s'il lui faut une breadboard (un fil par broche), en pose une et recommence. */
function planWithBreadboard(make, board, warns) {
  let plan = make();
  if (plan.needBreadboard) {
    const bb = placeBreadboard(board);
    warns.push(tl('{0} ajoutée : une broche ne reçoit qu’un fil, alimentation et bus partagés passent par ses rangées.', bb.name));
    S.reframe = true;
    plan = make();
  }
  return plan;
}
/** Applique un plan : fils déplacés retirés, composants d'appoint posés, nouveaux fils tracés. */
function applyPlan(plan, comp, board, added) {
  plan.remove.forEach(w => { if (S.wires.includes(w)) removeWire(w); const i = added.indexOf(w); if (i >= 0) added.splice(i, 1); });
  const made = {}, p = comp.group.position, q = board.group.position;
  plan.create.forEach(h => { const c = createComp(h.type); placeFree(c, p.x + (q.x - p.x) * 0.35, p.z + (q.z - p.z) * 0.35, 8, 1.5); made[h.id] = c; });
  const R = r => (r.h ? { comp: made[r.h], key: r.key } : r);
  plan.wires.forEach(s => {
    const a = R(s.a), b = R(s.b);
    if (!a.comp.pins[a.key] || !b.comp.pins[b.key] || busy(a) || busy(b)) return;
    const w = addWire(a, b, s.color, true); w.role = s.role; added.push(w);
  });
  return made;
}
function wireComp(comp, board, added, warns) {
  const plan = planWithBreadboard(() => planWiring(comp, planCx(board)), board, warns);
  if (plan.error || plan.needBreadboard) { warns.push(plan.error || tl('{0} : câblage impossible.', comp.name)); return; }
  warns.push(...plan.warns);
  const made = applyPlan(plan, comp, board, added);
  plan.then.forEach(t => wireComp(t.h ? made[t.h] : t.comp, board, added, warns));
}
/** Câble un composant, ou tout le circuit (target null ou carte), puis anime les nouveaux fils avec leur rôle. */
function autoWire(target) {
  if (S.rec) return;
  if (S.anim) finishAnim();
  if (!boards().length) { status(tl('Ajoutez d’abord une carte (ESP32, Arduino, Pico…) : le câblage automatique y relie les composants.')); return; }
  const onBoard = target && boardOf(target) ? target : null;
  const list = target && !onBoard ? [target] : S.comps.filter(c => wirable(c) && !partOf(c).volts);
  const added = [], warns = [];
  for (const c of list) {
    const A = analyze(S.comps, S.wires);
    if (list.length > 1 && !needsWiring(c, A)) continue;
    wireComp(c, boardFor(c, A, onBoard), added, warns);
  }
  renderWires(); updatePower(); changed();
  if (!added.length) { status(warns[0] || (target && !onBoard ? tl('{0} est déjà câblé.', target.name) : tl('Tous les composants sont déjà câblés.'))); renderExplain(); return; }
  const s = added.length > 1 ? 's' : '';
  status(tl('{0} fil{1} ajouté{2}.{3}', added.length, s, s, warns.length ? ' ⚠ ' + warns.join(' ') : ''));
  if (target) select(target);
  if (S.reframe) { S.reframe = false; frameAll(); }
  startAnim(added);
}
const ICON = { ok: '✓', warn: '!', err: '✕', todo: '○', free: '–' };
function renderExplain() {
  const c = S.sel, box = $('#explain'), btn = $('#autoBtn');
  if (!c) { box.innerHTML = ''; btn.hidden = true; return; }
  const e = explain(c, analyze(S.comps, S.wires), S.comps);
  box.innerHTML = `<p class="lead">${esc(e.lead)}</p>`
    + (e.rows.length ? `<ul class="pins">${e.rows.map(r => `<li class="${r.level}"><div class="pr"><i>${ICON[r.level]}</i><b>${esc(r.pin)}</b><em>${esc(r.role)}</em><span title="${esc(r.to)}">${esc(r.to)}</span></div>`
      + `<p>${esc(r.why)}</p>${r.msgs.map(m => `<p class="m">${esc(m)}</p>`).join('')}</li>`).join('')}</ul>` : '')
    + e.notes.map(n => `<p class="note">${esc(n)}</p>`).join('')
    + (e.code ? `<div class="code"><small>${e.lib ? tl('Bibliothèque : {0}', esc(e.lib)) : tl('Dans le code')}</small><pre>${esc(e.code)}</pre></div>` : '');
  btn.hidden = !e.canWire; btn.disabled = !e.todo; btn.classList.toggle('primary', !!e.todo);
  btn.querySelector('span').textContent = e.board ? (e.todo ? tl('Câbler les composants à cette carte') : tl('Tous les composants sont câblés')) : (e.todo ? tl('Câbler automatiquement') : tl('Câblage complet'));
}

/* ---------- Exemples ---------- */
function openEx() {
  $('#exWarn').hidden = !S.dirty;
  $('#exList').innerHTML = EXAMPLES.map(({ data }, i) => {
    const board = data.comps.find(c => BOARDS[c.type]), n = data.comps.length;
    return `<button class="exCard${data.exercice ? ' bad' : ''}" data-i="${i}">
      <span class="exNum">${data.exercice ? '!' : i + 1}</span>
      <span class="exTxt"><b>${esc(data.name)}</b><small>${esc(data.description || '')}</small>
      <em>${tl('{0}{1} composants · {2} fils{3}', board ? esc(BY_ID[board.type].name) + ' · ' : '', n, data.wires.length, data.exercice ? tl(' · erreurs à trouver') : '')}</em></span>
    </button>`;
  }).join('');
  $('#exModal').hidden = false;
  const first = $('#exList button'); if (first) first.focus();
}
function closeEx() { $('#exModal').hidden = true; }
async function loadExample(i) {
  const { data } = EXAMPLES[i];
  closeEx();
  if (S.rec) return;
  if (S.anim) finishAnim();
  await restore(data);
  setProjectName(data.name, null); S.projectPath = null;
  S.dirty = false; $('#projectName').classList.remove('dirty'); autosave(); frameAll();
  S.faultKeys = new Set(); resetHistory();
  if (!S.simOn) setSim(true);
  status(data.exercice ? tl('Montage à corriger : chaque erreur est signalée dans la scène. Cliquez une erreur pour la voir et lire pourquoi.') : tl('Exemple chargé : {0}. La simulation est lancée, réglez l’environnement pour voir les capteurs réagir.', data.name));
}

/* ---------- Schéma électrique 2D ---------- */
let schLast = null;
const describe = c => ({ title: BY_ID[c.type] ? BY_ID[c.type].name : c.custom ? c.custom.name : c.type });
function renderSchematic() {
  if (S.anim) finishAnim();
  schLast = buildSchematic({ comps: S.comps, wires: S.wires, netNames: S.netNames, title: S.projectName.replace(/\.jollof$/i, ''), format: $('#schFormat').value, lists: $('#schLists').checked, describe, blocks: blocks.list.map(b => ({ name: b.name, color: b.color, comps: blocks.members(b) })), check: checkStamp() });
  $('#schPages').innerHTML = schLast.pages.map((p, i) => `<figure class="schPage">${toSvg(p)}<figcaption>${tl('Feuille {0} / {1}', i + 1, schLast.pages.length)}</figcaption></figure>`).join('');
  const st = schLast.stats;
  $('#schInfo').textContent = tl('{0} composant{1} · {2} nœud{3} · {4} liaison{5} dessinée{6} en fil, les autres par étiquette ou symbole d’alimentation. Les breadboards n’apparaissent pas : seules comptent les liaisons qu’elles établissent. Format {7} paysage.', st.comps, st.comps > 1 ? 's' : '', st.nets, st.nets > 1 ? 's' : '', st.wires, st.wires > 1 ? 's' : '', st.wires > 1 ? 's' : '', schLast.format);
}
function openSchematic() { $('#schModal').hidden = false; renderSchematic(); }
function closeSchematic() { $('#schModal').hidden = true; }
const schFileName = () => `${(S.projectName === tl('Sans titre') ? 'circuit' : S.projectName.replace(/\.jollof$/i, '')).replace(/[\\/:*?"<>|]+/g, '-')}-${tl('schema')}.pdf`;
async function saveSchematicPdf() {
  if (!schLast) renderSchematic();
  try {
    const bytes = toPdf(schLast.pages, { title: tl('{0} — schéma électrique', S.projectName) });
    const path = await native.saveFile(new Blob([bytes], { type: 'application/pdf' }), schFileName(), tl('Document PDF'), 'pdf');
    if (path) status(native.isTauri() ? tl('Schéma enregistré : {0}', path) : tl('Schéma PDF téléchargé.'), 'ok');
  } catch (e) { status(tl('Enregistrement du PDF impossible : ') + (e.message || e), 'err'); }
}
/** Impression : seules les feuilles du schéma, au bon format de page. */
function printSchematic() {
  if (!schLast) renderSchematic();
  const [w, h] = schLast.format === 'A3' ? [420, 297] : [297, 210];
  $('#printArea').innerHTML = schLast.pages.map(p => toSvg(p, 'printPage')).join('');
  let st = $('#printPageSize'); if (!st) { st = document.createElement('style'); st.id = 'printPageSize'; document.head.appendChild(st); }
  st.textContent = `@page { size: ${w}mm ${h}mm; margin: 0; } #printArea svg { width: ${w}mm; height: ${h}mm; }`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); $('#printArea').innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  try { window.print(); } catch (e) { done(); status(tl('Impression indisponible ici : enregistrez le PDF puis imprimez-le.'), 'warn'); }
  setTimeout(() => { if (document.body.classList.contains('printing') && !matchMedia('print').matches) done(); }, 60000);
}

/* ---------- Documentation ---------- */
let docCurrent = null, preview = null, docRow = null;
function renderDocList() {
  const q = norm($('#docSearch').value.trim());
  const html = docIndex(LIBRARY, CATEGORIES).map(({ cat, items }) => {
    const hit = items.filter(e => !q || norm(`${e.name} ${e.cat} ${e.pre}`).includes(q));
    return hit.length ? `<h3>${cat}</h3>` + hit.map(e => `<button data-id="${e.id}" class="${e.id === docCurrent ? 'on' : ''}">${esc(e.name)}</button>`).join('') : '';
  }).join('');
  $('#docList').innerHTML = html || `<p class="empty" style="padding:0 16px">${tl('Aucun composant ne correspond.')}</p>`;
}
function showDoc(id) {
  const entry = BY_ID[id] || LIBRARY[0];
  docCurrent = entry.id; docRow = null;
  const { head, body } = renderDoc(entry);
  $('#docHead').innerHTML = head; $('#docBodyText').innerHTML = body; $('#docPage').scrollTop = 0; $('.docFig').hidden = false; $('#docPage').classList.remove('noFig'); $('#docBoards').classList.remove('on');
  [...$('#docList').querySelectorAll('button')].forEach(b => b.classList.toggle('on', b.dataset.id === docCurrent));
  try { preview = preview || createPreview($('#docView')); preview.load(entry.id); preview.start(); }
  catch (e) { console.warn(tl('Visionneuse 3D indisponible'), e); $('.docFig').hidden = true; $('#docPage').classList.add('noFig'); }
}
/** Survol d'une ligne du brochage : la broche s'allume sur le modèle 3D. */
function docHover(tr) {
  if (tr === docRow) return;
  if (docRow) docRow.classList.remove('on');
  docRow = tr;
  if (tr) tr.classList.add('on');
  if (preview) preview.highlight(tr ? tr.dataset.pins.split(',').filter(Boolean) : null);
}
function openDoc(id) {
  $('#docModal').hidden = false; renderDocList();
  if (id === 'guide') { showBoardGuide(); $('#docSearch').focus(); return; }
  showDoc(id || docCurrent || 'esp32');
  const on = $('#docList .on'); if (on) on.scrollIntoView({ block: 'center' });
  $('#docSearch').focus();
}
/** Guide « Quelle carte choisir ? » (library/boardguide.js) : comparaison des cartes simulées. */
function showBoardGuide() {
  docCurrent = null; docRow = null;
  [...$('#docList').querySelectorAll('button')].forEach(b => b.classList.remove('on'));
  $('#docBoards').classList.add('on');
  const { head, body } = renderBoardGuide();
  $('#docHead').innerHTML = head; $('#docBodyText').innerHTML = body;
  $('#docPage').scrollTop = 0; $('.docFig').hidden = true; $('#docPage').classList.add('noFig'); if (preview) preview.stop();
}
/** Crédits : modèles 3D livrés (auteur, source, licence) et bibliothèques tierces. */
function showCredits() {
  docCurrent = null; docRow = null; $('#docBoards').classList.remove('on');
  [...$('#docList').querySelectorAll('button')].forEach(b => b.classList.remove('on'));
  const m = Object.values(cadManifest());
  $('#docHead').innerHTML = `<small>Jollof Studio</small><h1>${tl('Crédits et licences')}</h1><p class="lead">${tl('La licence de Jollof Studio, puis les modèles 3D et les bibliothèques tierces livrés avec l’application.')}</p>`;
  $('#docBodyText').innerHTML = creditsHtml(m, esc);
  $('#docPage').scrollTop = 0; $('.docFig').hidden = true; $('#docPage').classList.add('noFig'); if (preview) preview.stop();
}
function closeDoc() { $('#docModal').hidden = true; if (preview) preview.stop(); }

/* ---------- Modèles .glb ---------- */
// Chargeurs chargés à la demande : ils ne servent qu'aux modèles importés (démarrage plus rapide).
const gltfLoader = () => import('three/examples/jsm/loaders/GLTFLoader.js').then(m => new m.GLTFLoader());
const cadImport = () => import('./cad/import.js');
const bufToB64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToBuf = b64 => { const s = atob(b64), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; };
/** keepScale : modèle déjà normalisé en millimètres (imports récents) ; sinon ramené à 40 mm (anciens projets). */
async function modelFromGlb(buf, keepScale) {
  const loader = await gltfLoader();
  return new Promise((resolve, reject) => loader.parse(buf, '', gltf => {
    const m = gltf.scene, bx = new THREE.Box3().setFromObject(m), sz = bx.getSize(new V3());
    if (!keepScale) m.scale.setScalar(40 / Math.max(sz.x, sz.y, sz.z, 1e-6));
    bx.setFromObject(m);
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const c = bx.getCenter(new V3()); m.position.x -= c.x; m.position.z -= c.z; m.position.y -= bx.min.y;
    const wrap = new THREE.Group(); wrap.add(m); resolve(wrap);
  }, reject));
}
const CUSTOM_KEYS = ['v', 'name', 'glb', 'kind', 'family', 'as'];
async function addCustom(data, o = {}) {
  const model = await modelFromGlb(b64ToBuf(data.glb), data.v >= 2);
  const custom = Object.fromEntries(CUSTOM_KEYS.filter(k => data[k] != null).map(k => [k, data[k]]));
  custom.kind = custom.kind || 'deco'; custom.pins = data.pins.map(p => ({ ...p }));
  return createComp('custom', { ...o, model, custom });
}
/** Composant de la bibliothèque habillé d'un modèle CAO importé et calibré. */
async function addSkinned(type, skin, o = {}) {
  const model = await modelFromGlb(b64ToBuf(skin.glb), true);
  return createComp(type, { ...o, skin, skinModel: model });
}
/** Définition électrique d'un composant importé : profil de carte ou fiche de module. */
function applyDef(c) {
  const d = c.custom; c.prof = null; c.spec = null;
  if (d.kind === 'board') c.prof = buildBoardProfile(d.name, d.family || 'esp32', d.pins.map(p => p.name));
  if (d.kind === 'module') c.spec = buildModuleSpec(d.name, d.pins);
}
/** Reconstruit un composant importé (broches renommées, modèle redressé) en gardant ses fils encore valables. */
async function rebuildCustom(c) {
  const links = S.wires.filter(w => w.a.comp === c || w.b.comp === c).map(w => ({ w, a: w.a.comp === c ? w.a.key : null, b: w.b.comp === c ? w.b.key : null }));
  const o = { id: c.id, name: c.name, x: c.group.position.x, z: c.group.position.z, r: c.group.rotation.y }, data = { ...c.custom };
  const placing = S.placing;
  removeComp(c);
  const n = await addCustom(data, o);
  links.forEach(({ w, a, b }) => {
    const A = a ? { comp: n, key: a } : w.a, B = b ? { comp: n, key: b } : w.b;
    if (A.comp.pins[A.key] && B.comp.pins[B.key] && !busy(A) && !busy(B)) addWire(A, B, w.color, true).role = w.role;
  });
  select(n); if (placing) setPlacing(true);
  renderWires(); updatePower(); refreshQuick(); changed();
  return n;
}
/** Broches d'un composant de la bibliothèque, dans l'ordre de son constructeur. */
function libPins(type) {
  const keys = [];
  BY_ID[type].build({ g: new THREE.Group(), pin: n => { let k = n, i = 2; while (keys.includes(k)) k = `${n} (${i++})`; keys.push(k); } });
  return keys;
}
/** Remplace le composant importé « apparence » par le composant de la bibliothèque habillé de ce modèle. */
async function applySkin(c) {
  const d = c.custom, want = libPins(d.as), placed = d.pins.filter(p => want.includes(p.name));
  if (!placed.length) { status(tl('Placez au moins une broche avant d’appliquer l’apparence.'), 'warn'); return; }
  const skin = { name: d.name, glb: d.glb, pins: Object.fromEntries(placed.map(p => [p.name, [p.x, p.y, p.z]])) };
  const o = { x: c.group.position.x, z: c.group.position.z, r: c.group.rotation.y };
  removeComp(c);
  const n = await addSkinned(d.as, skin, o);
  select(n); refreshQuick(); renderWires(); changed();
  const miss = want.length - placed.length;
  status(tl('{0} utilise maintenant le modèle « {1} ». {2}', n.name, d.name, miss ? tl('{0} broche{1} non calibrée{2} : elle{3} ne pourra{4} pas être reliée{5}.', miss, miss > 1 ? 's' : '', miss > 1 ? 's' : '', miss > 1 ? 's' : '', miss > 1 ? 'ont' : '', miss > 1 ? 's' : '') : tl('Toutes les broches sont calibrées.')), miss ? 'warn' : 'ok');
}

/* ---------- Rendu simple / réaliste ---------- */
// Les pièces CAO (près de 3 Mo) ne sont chargées que pour le rendu réaliste : en mode léger,
// le rendu simple est la règle et elles ne sont chargées que si l'on passe au réaliste.
let cadLoaded = false;
function renderUI() { $('#renderSimple').setAttribute('aria-pressed', !REAL.on); $('#renderReal').setAttribute('aria-pressed', REAL.on); }
/** Change de rendu : la scène est reconstruite, broches et fils inchangés. */
async function setRender(on) {
  if (on === REAL.on || S.rec || S.restoring) return;
  if (S.anim) finishAnim();
  if (on && !cadLoaded) { status(tl('Chargement des pièces CAO…')); await loadCadLibrary(); cadLoaded = true; }
  setRealistic(on); renderUI(); renderLibrary();
  const selId = S.sel && S.sel.id;
  S.restoring = true;
  try { await restore(serialize()); } finally { S.restoring = false; }
  const sel = S.comps.find(c => c.id === selId); if (sel) select(sel);
  status(on ? tl('Rendu réaliste : pièces CAO réelles (KiCad, Adafruit) sur les composants qui en ont.') : tl('Rendu simple : modèles dessinés, plus légers.'), 'ok');
}

/* ---------- Annuler / rétablir ---------- */
// Chaque modification du montage enregistre un instantané (composants, positions, fils).
// L'environnement simulé et les réglages ne font pas partie de l'historique.
const UNDO = [], REDO = [], GLB = new Map();
function stateOf() {
  return JSON.stringify({
    comps: S.comps.map(c => {
      if (c.custom) GLB.set(c.id, c.custom.glb); // le modèle .glb est gardé à part, une seule fois
      if (c.skin) GLB.set('s:' + c.id, c.skin.glb);
      const { glb, ...custom } = c.custom || {}, { glb: g2, ...skin } = c.skin || {};
      return { id: c.id, type: c.type, name: c.name, x: c.group.position.x, z: c.group.position.z, r: c.group.rotation.y, custom: c.custom && custom, skin: c.skin && skin };
    }),
    wires: S.wires.map(w => ({ id: w.id, a: [w.a.comp.id, w.a.key], b: [w.b.comp.id, w.b.key], color: w.color, role: w.role })),
    blocks: blocks.data(),
    // Réglages annulables (sans programmes ni modules, qui restent hors de l'historique).
    hist: { dur: +$('#dur').value, shots: S.shots, netNames: S.netNames, timeline: S.timeline }
  });
}
function commit() {
  if (S.restoring) return;
  const s = stateOf();
  if (s === S.snap) return;
  if (S.snap != null) {
    UNDO.push(S.snap); REDO.length = 0;
    // Historique borné en nombre et en mémoire (un modèle importé pèse lourd) : moins en mode léger.
    const maxN = LIGHT ? 60 : 150, maxBytes = LIGHT ? 12e6 : 40e6;
    let bytes = UNDO.reduce((t, x) => t + x.length, 0);
    while (UNDO.length > 1 && (UNDO.length > maxN || bytes > maxBytes)) bytes -= UNDO.shift().length;
  }
  S.snap = s; undoUI();
}
function resetHistory() { UNDO.length = 0; REDO.length = 0; S.snap = stateOf(); undoUI(); }
function undoUI() { $('#undoBtn').disabled = !UNDO.length; $('#redoBtn').disabled = !REDO.length; }
async function travel(from, to, label) {
  if (!from.length || S.rec || S.restoring) return;
  if (S.anim) finishAnim();
  const s = from.pop(), data = JSON.parse(s), selId = S.sel && S.sel.id;
  to.push(S.snap);
  data.comps.forEach(c => { if (c.custom) c.custom.glb = GLB.get(c.id); if (c.skin) c.skin.glb = GLB.get('s:' + c.id); });
  S.restoring = true;
  try { await restore(data); } finally { S.restoring = false; }
  S.snap = s; undoUI();
  const sel = S.comps.find(c => c.id === selId); if (sel) select(sel);
  S.dirty = true; $('#projectName').classList.add('dirty');
  clearTimeout(changed.t); changed.t = setTimeout(autosave, 400);
  status(label);
}
const undo = () => travel(UNDO, REDO, tl('Annulé. {0}', UNDO.length ? tl('Ctrl+Z pour revenir encore en arrière.') : tl('Début de l’historique.')));
const redo = () => travel(REDO, UNDO, tl('Rétabli. {0}', REDO.length ? tl('Ctrl+Maj+Z pour avancer encore.') : tl('Fin de l’historique.')));

/* ---------- Projets ---------- */
function serialize() {
  return {
    app: 'jollof-studio', version: 1, name: S.projectName,
    comps: S.comps.map(c => ({ id: c.id, type: c.type, name: c.name, x: c.group.position.x, z: c.group.position.z, r: c.group.rotation.y, custom: c.custom, skin: c.skin, inp: Object.keys(c.inp).length ? c.inp : undefined })),
    wires: S.wires.map(w => ({ id: w.id, a: [w.a.comp.id, w.a.key], b: [w.b.comp.id, w.b.key], color: w.color, role: w.role })),
    blocks: blocks.data(),
    settings: {
      dur: +$('#dur').value, env: { ...ENV }, shots: S.shots, netNames: S.netNames, prog: prog.data, modules: moduleData(),
      check: { allow: S.checkAllow || [] },
      timeline: S.timeline, video: { res: $('#vRes').value, fps: +$('#vFps').value, cap: $('#capOn').checked, orbit: $('#orbitOn').checked }
    }
  };
}
/**
 * Sauvegarde automatique (appelée 400 ms après la dernière modification) : fichier natif dans
 * l'application, stockage local dans un navigateur (voir native.autosaveWrite). Elle ne bloque pas
 * l'interface ; la promesse renvoyée est tenue une fois le projet écrit (à attendre avant un redémarrage).
 */
function autosave() {
  let json;
  try { json = JSON.stringify({ ...serialize(), path: S.projectPath }); } catch (e) { console.error(e); return Promise.resolve(); }
  return native.autosaveWrite(json);
}
function clearProject() {
  if (S.anim) finishAnim();
  cancelPending(); select(null); selectWire(null);
  [...S.wires].forEach(removeWire);
  S.comps.forEach(c => { dropLabel(c); scene.remove(c.group); }); S.comps = []; S.pinHits = [];
  blocks.set([]);
}
async function restore(raw) {
  const data = sanitizeProject(raw); // projet reçu d'ailleurs : libellés nettoyés avant tout affichage
  invalidate(500);
  clearProject();
  const byId = {};
  for (const c of data.comps || []) {
    try {
      if (c.type === 'custom' && c.custom) byId[c.id] = await addCustom(c.custom, c);
      else if (c.skin && BY_ID[c.type]) byId[c.id] = await addSkinned(c.type, c.skin, c);
      else if (BY_ID[c.type]) byId[c.id] = createComp(c.type, c);
    } catch (e) { console.warn(tl('Composant ignoré'), c, e); }
  }
  // Identifiants des fils gardés (la timeline s'y réfère) ; doublons et anciens projets : nouveaux identifiants.
  const ids = new Set();
  (data.wires || []).forEach(w => {
    const a = byId[w.a[0]], b = byId[w.b[0]];
    const id = typeof w.id === 'string' && /^w\d{1,6}$/.test(w.id) && !ids.has(w.id) ? w.id : null;
    if (a && b && a.pins[w.a[1]] && b.pins[w.b[1]]) { addWire({ comp: a, key: w.a[1] }, { comp: b, key: w.b[1] }, w.color, true, id).role = w.role; if (id) ids.add(id); }
  });
  S.wires.forEach(w => { if (!w.id) w.id = TL.nextId('w', S.wires); });
  // Projet complet (settings) ou instantané de l'historique (hist) : durée, plans, nœuds, timeline.
  const set = data.settings || data.hist;
  if (set && set.dur) { $('#dur').value = set.dur; $('#dur').dispatchEvent(new Event('input')); }
  S.shots = loadShots(set && set.shots); renderShots();
  S.netNames = (set && set.netNames && typeof set.netNames === 'object') ? set.netNames : {}; renderNets();
  // Avertissements acceptés (#[allow] du vérificateur) : seulement à l'ouverture d'un projet, pas pendant l'historique.
  if (data.settings) S.checkAllow = data.settings.check && Array.isArray(data.settings.check.allow) ? data.settings.check.allow : [];
  S.timeline = (set && TL.normalize(set.timeline, cleanText)) || TL.buildAuto('seq', [], +$('#dur').value);
  syncTimeline();
  const vs = data.settings && data.settings.video;
  if (vs && typeof vs === 'object') {
    if (RES[vs.res]) $('#vRes').value = String(vs.res);
    if (vs.fps === 30 || vs.fps === 60) $('#vFps').value = String(vs.fps);
    if (typeof vs.cap === 'boolean') $('#capOn').checked = vs.cap;
    if (typeof vs.orbit === 'boolean') $('#orbitOn').checked = vs.orbit;
  }
  if (data.settings && data.settings.env) { Object.keys(ENV).forEach(q => { if (typeof data.settings.env[q] === 'number') ENV[q] = data.settings.env[q]; }); renderSim.sig = null; }
  blocks.set(data.blocks || []); renderBlocks();
  // Les programmes ne font pas partie de l'historique : annuler un geste ne les touche pas.
  if (data.settings) { prog.load(data.settings.prog); loadModules(data.settings.modules); }
  renderWires(); updatePower(); if (sch) sch.dirty(); if (chk) chk.schedule();
  // Composants recréés : les programmes en cours repartent sur le nouveau montage.
  if (S.simOn) restartPrograms();
  else prog.circuitChanged();
}
async function newProject() {
  clearProject(); prog.load(null); loadModules(null);
  // Nouveau projet : plans, noms de nœuds et timeline repartent de zéro.
  S.shots = []; S.netNames = {}; S.checkAllow = []; S.timeline = TL.buildAuto('seq', [], +$('#dur').value); renderShots(); syncTimeline(); if (S.simOn) restartPrograms(); renderWires(); renderBlocks(); setProjectName(tl('Sans titre'), null); S.projectPath = null; if (chk) chk.schedule();
  S.dirty = false; $('#projectName').classList.remove('dirty'); autosave(); resetHistory(); status(tl('Nouveau projet.'));
}
async function openProjectFile() {
  try {
    const f = await native.openProject(); if (!f) return;
    const data = JSON.parse(f.text);
    if (!data || !Array.isArray(data.comps)) throw new Error(tl('ce fichier n’est pas un projet Jollof Studio'));
    await restore(data); setProjectName(f.name, f.path); S.projectPath = f.path;
    S.dirty = false; $('#projectName').classList.remove('dirty'); autosave(); frameAll(); resetHistory(); status(tl('Projet ouvert : {0}', f.name), 'ok');
  } catch (e) { status(tl('Ouverture impossible : ') + (e.message || e)); }
}
async function saveProjectFile(saveAs) {
  try {
    const name = /\.jollof$/i.test(S.projectName) ? S.projectName : `${S.projectName === tl('Sans titre') ? 'circuit' : S.projectName}.jollof`;
    const res = await native.saveProject(JSON.stringify(serialize(), null, 1), saveAs ? null : S.projectPath, name);
    if (!res) return;
    setProjectName(res.name, res.path); S.dirty = false; $('#projectName').classList.remove('dirty'); autosave();
    status(res.path ? tl('Projet enregistré : {0}', res.path) : tl('Projet téléchargé.'));
  } catch (e) { status(tl('Enregistrement impossible : ') + (e.message || e)); }
}

/* ---------- Liaisons de l'interface ---------- */
function bindUI() {
  $('#hint').textContent = tl('Glisser broche → broche : tirer un fil · Molette : zoom vers le curseur · Clic droit glissé, deux doigts ou flèches : déplacer la vue · F : cadrer');
  $('#libSearch').oninput = renderLibrary;
  ['#lib', '#flyList'].forEach(id => {
    const el = $(id);
    el.onclick = libClick; el.onpointerdown = libDown;
    el.ondragstart = e => e.preventDefault(); // pas de glisser natif des vignettes
  });
  // Bibliothèque repliable : barre d'application, en-tête du panneau, colonne d'icônes, Ctrl+B.
  $('#libToggle').onclick = () => setLibOpen(!libIsOpen());
  $('#libClose').onclick = () => setLibOpen(false);
  $('#libOpen').onclick = () => setLibOpen(true);
  $('#railSearch').onclick = () => { setLibOpen(true); $('#libSearch').focus(); $('#libSearch').select(); };
  $('#railCats').onclick = e => { const b = e.target.closest('[data-cat]'); if (!b) return; S.flyCat === b.dataset.cat ? closeFlyout() : openFlyout(b.dataset.cat, b); };
  $('#flyClose').onclick = closeFlyout;
  document.addEventListener('pointerdown', e => { if (S.flyCat && !e.target.closest('#flyout, #railCats')) closeFlyout(); }, true);
  $('#selClose').onclick = () => select(null);
  setLibOpen(libIsOpen(), false);
  requestAnimationFrame(() => requestAnimationFrame(() => $('.app').classList.remove('still')));
  $('#swatches').innerHTML = COLORS.map(([n, c]) => `<button class="sw${c === S.color ? ' on' : ''}" data-c="${c}" style="background:${c}" aria-label="${tl('Fil {0}', n)}" title="${n}"></button>`).join('');
  $('#swatches').onclick = e => {
    const b = e.target.closest('.sw'); if (!b) return; S.color = b.dataset.c;
    [...$('#swatches').children].forEach(x => x.classList.toggle('on', x === b));
    if (S.selWire) { S.selWire.color = S.color; buildWire(S.selWire); renderWires(); changed(); }
  };
  $('#qGo').onclick = () => {
    if (S.simOn) { lockHint(); return; }
    const a = refFrom($('#qA').value), b = refFrom($('#qB').value);
    if (!a || !b || same(a, b)) { status(tl('Choisissez deux broches différentes.')); return; }
    if (connect(a, b)) status(tl('Fil ajouté : {0}', wireLabel(S.wires[S.wires.length - 1])));
  };
  $('#wires').onclick = e => {
    if (S.simOn && (e.target.closest('.l') || e.target.closest('button'))) { lockHint(); return; }
    const lab = e.target.closest('.l');
    if (lab && !S.anim) { selectWire(S.wires[+lab.dataset.i]); return; }
    const b = e.target.closest('button'); if (!b || S.anim) return;
    const i = +b.dataset.i, w = S.wires;
    if (b.dataset.a === 'del') removeWire(w[i]);
    if (b.dataset.a === 'up' && i > 0) [w[i - 1], w[i]] = [w[i], w[i - 1]];
    if (b.dataset.a === 'down' && i < w.length - 1) [w[i + 1], w[i]] = [w[i], w[i + 1]];
    w.forEach(buildWire); renderWires(); updatePower(); changed();
  };
  $('#rot').onclick = () => { if (!S.sel) return; S.sel.group.rotation.y += Math.PI / 2; S.sel.group.updateMatrixWorld(true); rebuildFor(S.sel); updateSel(); changed(); };
  $('#del').onclick = () => S.sel && removeComp(S.sel);
  $('#placeBtn').onclick = () => setPlacing(!S.placing);
  $('#saveLibBtn').onclick = async () => {
    const c = S.sel; if (!c || !c.custom) return;
    if (!c.custom.pins.length) { status(tl('Placez au moins une broche avant d’ajouter ce modèle à la bibliothèque.')); return; }
    const id = (norm(c.custom.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'modele').slice(0, 48) + '-' + Date.now().toString(36);
    const { v, kind, family, as } = c.custom;
    const item = { id, name: c.custom.name, glb: c.custom.glb, pins: c.custom.pins, v, kind, family, as };
    try { await native.librarySave(item); S.userLib.push(item); renderLibrary(); status(tl('{0} ajouté à votre bibliothèque.', item.name)); }
    catch (e) { status(tl('Ajout impossible : ') + (e.message || e)); }
  };
  $('#faults').onclick = e => {
    const li = e.target.closest('li[data-key]'), f = li && S.faults.find(x => x.key === li.dataset.key); if (!f) return;
    const b = e.target.closest('[data-act]'), act = b ? b.dataset.act : 'see';
    if (act === 'see') focusFault(f); else fixFault(f, act);
  };
  $('#alertSee').onclick = () => { const f = S.faults.find(x => x.key === $('#alert').dataset.key); if (f) focusFault(f); $('#alert').hidden = true; };
  $('#alertClose').onclick = () => ($('#alert').hidden = true);
  $('#docBtn').onclick = () => openDoc(S.sel && BY_ID[S.sel.type] ? S.sel.type : null);
  $('#docSel').onclick = () => S.sel && openDoc(S.sel.type);
  $('#docClose').onclick = closeDoc;
  $('#docCredits').onclick = showCredits;
  $('#docBoards').onclick = showBoardGuide;
  $('#docModal').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeDoc(); } });
  $('#docModal').onclick = e => { if (e.target.id === 'docModal') closeDoc(); };
  $('#docSearch').oninput = () => renderDocList();
  $('#docBodyText').addEventListener('pointerover', e => docHover(e.target.closest('tr[data-pins]')));
  $('#docBodyText').addEventListener('pointerleave', () => docHover(null));
  $('#exBtn').onclick = openEx;
  $('#schBtn').onclick = openSchematic;
  $('#schClose').onclick = closeSchematic;
  $('#schModal').onclick = e => { if (e.target.id === 'schModal') closeSchematic(); };
  $('#schFormat').onchange = renderSchematic;
  $('#schLists').onchange = renderSchematic;
  $('#schPdf').onclick = saveSchematicPdf;
  $('#schPrint').onclick = printSchematic;
  $('#exClose').onclick = closeEx;
  $('#exModal').onclick = e => { if (e.target.id === 'exModal') closeEx(); };
  $('#exList').onclick = e => { const b = e.target.closest('[data-i]'); if (b) loadExample(+b.dataset.i); };
  $('#docList').onclick = e => { const b = e.target.closest('[data-id]'); if (b) showDoc(b.dataset.id); };
  $('#docPage').onclick = e => {
    const f = e.target.closest('#docBodyText [data-id]'); if (f) { showDoc(f.dataset.id); return; } // guide : « Fiche »
    const b = e.target.closest('[data-add]'); if (!b) return;
    const c = createComp(b.dataset.add); placeFree(c); select(c); refreshQuick(); changed(); closeDoc();
    status(tl('{0} ajouté. « Câbler automatiquement » le relie à la carte.', c.name));
  };
  $('#autoBtn').onclick = () => S.sel && autoWire(S.sel);
  $('#blockTool').onclick = () => setBlockDraw(!S.blockDraw);
  $('#blockAdd').onclick = () => setBlockDraw(true);
  $('#blocks').addEventListener('change', e => {
    const li = e.target.closest('[data-bid]'), b = li && blocks.list.find(x => x.id === li.dataset.bid); if (!b || e.target.tagName !== 'INPUT') return;
    b.name = cleanText(e.target.value.trim(), 40) || b.name; renderBlocks(); changed();
  });
  $('#blocks').addEventListener('click', e => {
    const li = e.target.closest('[data-bid]'), b = li && blocks.list.find(x => x.id === li.dataset.bid); if (!b) return;
    if (e.target.closest('.bsw')) { b.color = BLOCK_COLORS[(BLOCK_COLORS.indexOf(b.color) + 1) % BLOCK_COLORS.length]; renderBlocks(); changed(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) { if (e.target.tagName !== 'INPUT') blocks.select(b); return; }
    if (act.dataset.act === 'del') { blocks.remove(b); renderBlocks(); changed(); status(tl('{0} supprimé ; ses composants restent en place.', b.name)); }
    if (act.dataset.act === 'see') { const r = blocks.bounds(b); if (r) flyTo(new V3((r[0] + r[2]) / 2, 0, (r[1] + r[3]) / 2), Math.max(80, Math.hypot(r[2] - r[0], r[3] - r[1]) * 1.2)); }
  });
  $('#selBlock').onchange = e => {
    const c = S.sel; if (!c) return;
    blocks.list.forEach(b => (b.comps = b.comps.filter(id => id !== c.id)));
    const b = blocks.list.find(x => x.id === e.target.value); if (b) b.comps.push(c.id);
    renderBlocks(); changed();
  };
  prog.bind();
  $('#behav').onclick = e => prog.onBehavior(e, S.sel);
  $('#behav').addEventListener('change', e => prog.onStateField(e.target));
  $('#autoAll').onclick = () => autoWire(null);
  $('#simBtn').onclick = () => setSim(!S.simOn);
  $('#simBtn2').onclick = () => setSim(true);
  $('#undoBtn').onclick = undo;
  $('#redoBtn').onclick = redo;
  $('#frameBtn').onclick = frameAll;
  document.querySelectorAll('[data-view]').forEach(b => (b.onclick = () => setView(b.dataset.view)));
  const xf = () => {
    const c = S.sel; if (!c) return;
    const x = parseFloat($('#tX').value), z = parseFloat($('#tZ').value), r = parseFloat($('#tR').value);
    if (Number.isFinite(x)) c.group.position.x = x; if (Number.isFinite(z)) c.group.position.z = z;
    if (Number.isFinite(r)) c.group.rotation.y = -r * Math.PI / 180;
    c.group.updateMatrixWorld(true); rebuildFor(c); updateSel(); changed();
  };
  ['#tX', '#tZ', '#tR'].forEach(id => { $(id).onchange = xf; $(id).onkeydown = e => { if (e.key === 'Enter') e.target.blur(); }; });
  $('#showWires').onclick = () => setNetView(false);
  $('#showNets').onclick = () => setNetView(true);
  $('#nets').addEventListener('pointerover', e => { const li = e.target.closest('li[data-pins]'); if (S.anim) return; setHL(li ? li.dataset.pins.split(',').map(id => { const i = id.indexOf('|'), comp = S.comps.find(c => c.id === id.slice(0, i)); return comp && { comp, key: id.slice(i + 1) }; }).filter(Boolean) : []); });
  $('#nets').addEventListener('pointerleave', () => { if (!S.anim) setHL([]); });
  $('#nets').addEventListener('dblclick', e => {
    const nn = e.target.closest('.nn'), li = nn && nn.closest('li[data-key]'); if (!li) return;
    const input = document.createElement('input'); input.value = nn.textContent; input.maxLength = 32; nn.replaceWith(input); input.focus(); input.select();
    const done = ok => { if (ok) { const v = cleanText(input.value.trim(), 40); if (v) S.netNames[li.dataset.key] = v; else delete S.netNames[li.dataset.key]; changed(); } renderNets(); };
    input.onkeydown = ev => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') { ev.stopPropagation(); done(false); } };
    input.onblur = () => done(true);
  });
  const wireUi = () => { $('#wireTidy').setAttribute('aria-pressed', WIRES.style === 'tidy'); $('#wireSoft').setAttribute('aria-pressed', WIRES.style === 'soft'); };
  const setWires = style => {
    WIRES.style = style; try { localStorage.setItem('jollof-wires', style); } catch (e) { /* stockage indisponible */ }
    S.wires.forEach(w => (w.sig = null)); S.wiresDirty = true; wireUi();
    status(style === 'tidy' ? tl('Fils rangés : à angle droit, à des hauteurs différentes quand ils se croisent.') : tl('Fils souples : en arc.'), 'ok');
  };
  $('#wireTidy').onclick = () => setWires('tidy'); $('#wireSoft').onclick = () => setWires('soft'); wireUi();
  const guideUi = () => $('#tagsBtn').setAttribute('aria-pressed', guides.tags);
  $('#tagsBtn').onclick = () => { guides.setTags(!guides.tags); guideUi(); };
  guideUi();
  $('#renderSimple').onclick = () => setRender(false);
  $('#qualityLabel').textContent = LIGHT ? tl('Léger') : tl('Standard');
  $('#qualityBtn').onclick = e => chooseQuality(e.currentTarget);
  $('#benchBtn').onclick = () => bench.toggle();
  // Courant animé : bouton à côté des instruments.
  $('#benchBtn').insertAdjacentHTML('afterend', `<button type="button" class="tb glass label" id="flowBtn" data-tip="${tl('Courant animé : des points suivent le courant réel, colorés selon la tension')}" aria-pressed="${flow.enabled}">${icon('flow')}<span>${tl('Courant')}</span></button>`);
  $('#flowBtn').onclick = () => {
    flow.enabled = !flow.enabled; $('#flowBtn').setAttribute('aria-pressed', flow.enabled);
    try { localStorage.setItem('jollof-flow', flow.enabled ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
    if (flow.enabled && S.simOn) updateFlow();
    status(flow.enabled ? tl('Courant animé : les points vont du + vers le − (sens conventionnel), plus vite quand le courant est fort.') : tl('Courant animé masqué.'), 'ok'); invalidate();
  };
  installSchView();
  installChecker();
  $('#renderReal').onclick = () => setRender(true);
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => setTab(t.id.slice(4));
    t.onkeydown = e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const tabs = [...document.querySelectorAll('.tab')], i = tabs.indexOf(t), n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      setTab(n.id.slice(4)); n.focus();
    };
  });
  const onEnv = e => {
    const q = e.target.dataset.q; if (!q) return;
    ENV[q] = e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : +e.target.value;
    const o = $(`#env [data-o="${q}"]`); if (o) o.textContent = fmtQ(q);
    if (!S.simOn) setSim(true);
    changed();
  };
  $('#env').oninput = onEnv; $('#env').onchange = onEnv;
  const probeComp = el => { const li = el.closest('li[data-id]'); return li && S.comps.find(c => c.id === li.dataset.id); };
  $('#probes').oninput = e => {
    const c = probeComp(e.target), k = e.target.dataset.inp; if (!c || !k) return;
    c.inp[k] = +e.target.value; if (!S.simOn) setSim(true); changed();
  };
  $('#probes').onclick = e => {
    const b = e.target.closest('[data-press]'), c = b && probeComp(b); if (!c) return;
    const k = b.dataset.press; c.inp[k] = !c.inp[k];
    b.setAttribute('aria-pressed', c.inp[k]);
    if (k === 'pressed') b.textContent = c.inp[k] ? tl('Relâcher le bouton') : tl('Appuyer sur le bouton');
    if (!S.simOn) setSim(true);
    changed();
  };
  $('#animPlay').onclick = () => { if (!S.rec && !S.vr) { if (S.anim) finishAnim(); startAnim(); } };
  // Séquence automatique choisie : la timeline est refaite (une timeline faite à la main revient par Ctrl+Z).
  $('#animMode').onchange = e => {
    const mode = e.target.value; if (mode !== 'seq' && mode !== 'all') return;
    const manual = !S.timeline.auto;
    if (S.anim) finishAnim();
    S.timeline = TL.buildAuto(mode, [], +$('#dur').value, S.timeline);
    changed();
    if (manual) status(tl('Timeline refaite automatiquement. Ctrl+Z revient à la vôtre.'), 'ok');
  };
  $('#dur').oninput = e => ($('#durOut').textContent = (+e.target.value).toFixed(1).replace('.', DEC) + ' s');
  $('#dur').onchange = () => changed(); // timeline automatique refaite avec la nouvelle durée
  timelineDock = createTimelineDock($('#tlDock'), {
    tl, esc, icon, menu: popMenu, DEC, tracks: TRACKS, status,
    timeline: () => S.timeline,
    wire: wireById, wireLabel,
    shots: () => S.shots,
    state: () => (S.anim && !S.anim.temp ? { T: S.anim.T, playing: !S.anim.paused } : null),
    busy: () => !!(S.rec || S.vr),
    captionsShown: () => $('#capOn').checked,
    preview: previewAt, play: playTimeline, pause: pauseTimeline,
    stop: () => { if (S.anim && !S.rec) finishAnim(); },
    commit: changed,
    selectWire: w => selectWire(w || null),
    addShotAt: T => {
      // Vue actuelle ajoutée comme plan, placée à l'instant T : la caméra devient manuelle.
      const shot = { id: TL.nextId('s', S.shots), p: v3a(camera.position), t: v3a(controls.target) };
      S.shots.push(shot); S.timeline.camAuto = false;
      S.timeline.cam.push({ id: TL.nextId('k', S.timeline.cam), shot: shot.id, t: T, ease: 'smooth' });
      renderShots(); changed();
      status(tl('Plan {0} ajouté à {1} s.', S.shots.length, T.toFixed(1).replace('.', DEC)), 'ok');
    },
    replaceShot: id => { const s = S.shots.find(x => x.id === id); if (!s) return; s.p = v3a(camera.position); s.t = v3a(controls.target); renderShots(); changed(); status(tl('Plan remplacé par la vue actuelle.'), 'ok'); },
    deleteShot: id => { S.shots = S.shots.filter(x => x.id !== id); renderShots(); },
    onToggle: on => {
      $('.app').classList.toggle('tlOpen', on); $('#tlToggle').setAttribute('aria-pressed', on);
      if (!on && S.anim && S.anim.paused) finishAnim();
    }
  });
  $('#tlToggle').onclick = () => timelineDock.toggle();
  $('#recBtn').onclick = renderVideo;
  $('#rCancel').onclick = () => { if (S.vr) S.vr.cancel = true; };
  $('#addShot').onclick = addShot;
  $('#shots').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +(b.dataset.go ?? b.dataset.set ?? b.dataset.del);
    if (b.dataset.go != null) { const c = S.shots[i]; S.fly = { t0: performance.now(), a: controls.target.clone(), b: new V3().fromArray(c.t), pa: camera.position.clone(), pb: new V3().fromArray(c.p) }; }
    if (b.dataset.set != null) { S.shots[i] = { ...S.shots[i], p: v3a(camera.position), t: v3a(controls.target) }; status(tl('Plan {0} remplacé par la vue actuelle.', i + 1), 'ok'); }
    if (b.dataset.del != null) S.shots.splice(i, 1);
    renderShots(); changed();
  };
  $('#closeModal').onclick = () => { $('#modal').hidden = true; $('#vid').pause(); };
  $('#dl').onclick = async () => {
    if (!S.video) return;
    try { const p = await native.saveVideo(S.video.blob, S.video.name); if (p) status(tl('Vidéo enregistrée : {0}', p)); }
    catch (e) { status(tl('Enregistrement de la vidéo impossible : ') + (e.message || e)); }
  };
  $('#newBtn').onclick = newProject;
  $('#openBtn').onclick = openProjectFile;
  $('#saveBtn').onclick = e => saveProjectFile(e.shiftKey);
  $('#glb').onchange = async e => {
    const f = e.target.files[0]; if (!f) return; e.target.value = '';
    try {
      const r = await (await cadImport()).importCad(f, m => status(m));
      const comp = await addCustom({ v: 2, name: r.name, glb: bufToB64(r.glb), pins: [], kind: 'deco' });
      placeFree(comp); select(comp); refreshQuick(); changed(); frameComp(comp);
      status(tl('{0} importé ({1} × {2} mm). Dites ce qu’il représente, puis placez ses broches.', comp.name, Math.round(r.size.x), Math.round(r.size.z)), 'ok');
    } catch (err) { status(tl('Import impossible : ') + (err.message || err), 'err'); }
  };
  // Assistant d'import : nature du modèle, broches, utilisation.
  $('#cAs').innerHTML = CATEGORIES.map(cat => `<optgroup label="${cat}">${LIBRARY.filter(e => e.cat === cat && !/^breadboard/.test(e.id)).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</optgroup>`).join('');
  $('#cFam').innerHTML = Object.entries(FAMILIES).map(([k, f]) => `<option value="${k}">${esc(f.label)}</option>`).join('');
  const wiz = fn => () => { const c = S.sel; if (c && c.custom) fn(c, c.custom); };
  $('#cKind').onchange = wiz((c, d) => {
    d.kind = $('#cKind').value;
    if (d.kind === 'skin') { d.as = d.as || $('#cAs').value; $('#pinName').value = ''; }
    if (d.kind === 'board') d.family = d.family || $('#cFam').value;
    applyDef(c); renderWizard(c); renderExplain(); changed();
  });
  $('#cAs').onchange = wiz((c, d) => { d.as = $('#cAs').value; $('#pinName').value = ''; renderWizard(c); changed(); });
  $('#cFam').onchange = wiz((c, d) => { d.family = $('#cFam').value; applyDef(c); renderWizard(c); renderExplain(); changed(); });
  $('#rotModel').onclick = wiz(async (c, d) => {
    status(tl('Rotation du modèle…'));
    d.glb = bufToB64(await (await cadImport()).rotateGlb(b64ToBuf(d.glb))); d.pins = [];
    await rebuildCustom(c); status(tl('Modèle redressé d’un quart de tour. Replacez les broches.'), 'ok');
  });
  $('#applySkin').onclick = wiz(c => applySkin(c));
  $('#cPins').addEventListener('change', e => {
    const c = S.sel, d = c && c.custom; if (!d) return;
    const i = +e.target.dataset.i;
    if (e.target.matches('select[data-role]')) { d.pins[+e.target.dataset.role].role = e.target.value; applyDef(c); renderExplain(); changed(); return; }
    if (e.target.matches('input[data-i]')) {
      const name = e.target.value.trim().slice(0, 16);
      if (!name || d.pins.some((p, j) => j !== i && p.name === name)) { status(tl('Nom vide ou déjà utilisé par une autre broche.'), 'warn'); renderWizard(c); return; }
      d.pins[i].name = name; if (d.kind === 'module') d.pins[i].role = guessRole(name);
      rebuildCustom(c);
    }
  });
  $('#cPins').addEventListener('click', e => {
    const c = S.sel, d = c && c.custom; if (!d) return;
    const del = e.target.closest('[data-del]');
    if (del) { d.pins.splice(+del.dataset.del, 1); rebuildCustom(c); return; }
    const li = e.target.closest('li[data-k]');
    if (li) { $('#pinName').value = li.dataset.k; setPlacing(true); renderWizard(c); }
  });
  const cv = renderer.domElement;
  // Pavé tactile : glisser à deux doigts déplace la vue, pincer zoome. Souris : la molette zoome, Maj + molette déplace.
  // Pincer (ou Ctrl + molette) et molette de souris : zoom vers le curseur.
  $('#stage').addEventListener('wheel', e => {
    if (e.target !== cv) return;
    e.preventDefault(); e.stopPropagation();
    const f = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || e.metaKey) { zoomAt(e, Math.max(-0.5, Math.min(0.5, e.deltaY * f * 0.01))); return; }
    const trackpad = Math.abs(e.deltaX) > 0.5 || (e.deltaMode === 0 && !Number.isInteger(e.deltaY));
    if (e.shiftKey && !Math.abs(e.deltaX)) { panView(e.deltaY * f, 0); return; }
    if (e.shiftKey || trackpad) { panView(e.deltaX * f, e.deltaY * f); return; }
    zoomAt(e, Math.max(-0.5, Math.min(0.5, e.deltaY * f * 0.0015)));
  }, { capture: true, passive: false });
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointerleave', () => { $('#tip').hidden = true; setHover(null); $('#cursorPos').textContent = ''; });
  addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); saveProjectFile(e.shiftKey); return; }
    if (mod && k === 'o') { e.preventDefault(); openProjectFile(); return; }
    if (mod && k === 'n') { e.preventDefault(); newProject(); return; }
    if (mod && k === 'b') { e.preventDefault(); setLibOpen(!libIsOpen()); return; }
    if (!$('#docModal').hidden) { if (k === 'escape') closeDoc(); return; }
    if (!$('#exModal').hidden) { if (k === 'escape') closeEx(); return; }
    if (!$('#schModal').hidden) { if (k === 'escape') closeSchematic(); if (mod && k === 'p') { e.preventDefault(); printSchematic(); } return; }
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.visualHost, .ProseMirror')) return; // blocs de code, texte enrichi : leurs propres raccourcis
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (k === 'escape' && S.flyCat) { closeFlyout(); return; }
    if (k === 'escape' && blocks.selected) { blocks.select(null); return; }
    if (k === 'escape' && (S.blockDraw || S.pick)) { setBlockDraw(false); S.pick = null; renderer.domElement.classList.remove('picking'); status(tl('Annulé.')); return; }
    if (k === 'escape' && S.view2d && S.sel && !sch.wiring) select(null);
    if (k === 'escape') { if (S.vr) S.vr.cancel = true; if (S.anim && !S.rec && !S.vr) finishAnim(); cancelPending(); selectWire(null); setPlacing(false); if (!$('#modal').hidden) $('#closeModal').click(); }
    // Timeline ouverte : L ajoute une légende, N une note (Pro), à la tête de lecture.
    if (!mod && !e.altKey && timelineDock.open && timelineDock.shortcut(k)) { e.preventDefault(); return; }
    if (k === 's' && !mod && !e.altKey) { setStageView(S.view2d ? '3d' : '2d'); return; }
    if (k === 'f') { if (S.view2d) sch.fit(); else frameAll(); }
    const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
    if (arrows && S.view2d) { e.preventDefault(); const st = e.shiftKey ? 240 : 80; sch.panBy(arrows[0] * st, arrows[1] * st); return; }
    if (arrows) { e.preventDefault(); const st = e.shiftKey ? 240 : 80; panView(arrows[0] * st, arrows[1] * st); return; }
    if (k === 'r' && S.sel && !S.view2d) $('#rot').click();
    // Schéma : d'abord le fil ou la broche survolés, sinon le composant sélectionné (visible sur le schéma).
    if ((k === 'delete' || k === 'backspace') && S.view2d) { if (!sch.cutHover() && S.sel) $('#del').click(); return; }
    if ((k === 'delete' || k === 'backspace') && S.selWire) { removeWire(S.selWire); renderWires(); updatePower(); changed(); return; }
    if ((k === 'delete' || k === 'backspace') && S.sel) $('#del').click();
  });
}

/* ---------- Éditions : modules optionnels ---------- */
// Un module (édition Pro) reçoit cette interface : scène, caméra, composants, choix d'un point de la
// scène, crochet d'image, panneau à la place de l'inspecteur, données enregistrées avec le projet.
const moduleApi = {
  THREE, V3, $, esc, icon,
  scene: () => scene, camera: () => camera, controls: () => controls, stage: () => $('#stage'),
  comps: () => S.comps, byId: id => S.comps.find(c => c.id === id), boxOf: c => compBox(c),
  status, select: c => select(c), flyTo: (p, d) => flyTo(p, d), textSprite, disposeSprite,
  onFrame: fn => S.frameHooks.push(fn),
  pick(cb) { S.pick = cb; renderer.domElement.classList.add('picking'); },
  markDirty() { S.dirty = true; $('#projectName').classList.add('dirty'); clearTimeout(changed.t); changed.t = setTimeout(autosave, 400); },
  register(key, m) { S.modules.set(key, m); m.load(S.modulesRaw[key] ?? null); },
  toolbar(html) { const nav = $('#schBtn').parentElement; $('#schBtn').insertAdjacentHTML('beforebegin', html); const el = $('#schBtn').previousElementSibling; hydrateIcons(nav); return el; },
  inspector: {
    open(el) { const p = $('#modPane'); p.replaceChildren(el); p.hidden = false; $('.panel.right').classList.add('modOpen'); hydrateIcons(p); },
    close() { $('#modPane').hidden = true; $('.panel.right').classList.remove('modOpen'); }
  },
  presenting(on) { $('.app').classList.toggle('presenting', on); if (on) { select(null); selectWire(null); } },
  // Montage : fils, analyse électrique, erreurs de câblage, retrait des fils (exercice).
  wires: () => S.wires, analyze: () => analyze(S.comps, S.wires), describe,
  // Vérificateur : résultat à jour (erreurs, avertissements, preuve) ; avec des erreurs, le rapport s'ouvre.
  verify: (show = true) => (chk ? chk.verify(show) : Promise.resolve(null)), openCheck: () => chk && chk.open(),
  faults() { const A = analyze(S.comps, S.wires); return collectFaults(S.comps, S.wires, A, { dist: (a, b) => pinWorld(a).distanceTo(pinWorld(b)), boardFor: c => boardFor(c, A) }); },
  clearWires() { if (S.anim) finishAnim(); [...S.wires].forEach(removeWire); renderWires(); updatePower(); changed(); },
  isBreadboard: c => /^breadboard/.test(c.type),
  // Documents : schéma, dessin PDF, enregistrement d'un fichier, nom du projet.
  schematic: opts => buildSchematic({ comps: S.comps, wires: S.wires, netNames: S.netNames, title: moduleApi.projectTitle(), describe, blocks: blocks.list.map(b => ({ name: b.name, color: b.color, comps: blocks.members(b) })), check: checkStamp(), ...opts }),
  pdf: { Draw, toPdf, textWidth, frame: sheetFrame },
  saveFile: (blob, name, label, ext) => native.saveFile(blob, name, label, ext), isDesktop: () => native.isTauri(),
  projectTitle: () => (S.projectName === tl('Sans titre') ? 'circuit' : S.projectName.replace(/\.jollof$/i, '')),
  blocks: () => blocks.list.map(b => ({ name: b.name, color: b.color, comps: blocks.members(b) })),
  // Programmes : celui de la carte affichée dans l'onglet Code ; barre de l'onglet Code.
  program: () => prog.current(),
  // Projet entier : lecture (format .jollof), ouverture à la place du montage affiché, suivi des modifications.
  projectData: () => serialize(),
  invalidate: (ms) => invalidate(ms),
  sessionTab, setTab: name => setTab(name),
  simOn: () => S.simOn, setSim: on => setSim(on),
  stageView: () => (S.view2d ? '2d' : '3d'), setStageView: v => setStageView(v), schStats: () => (sch ? sch.stats() : null), schScreen: c => (sch ? sch.screenOf(c) : null), schPin: (c, k) => (sch ? sch.pinScreen(c, k) : null),
  dc: state => solveCircuit(state),
  dcPin: (boardId, key) => (S.dcPins ? S.dcPins.get(boardId + '|' + key) ?? null : null),
  projectName: () => S.projectName,
  async openProject(data, name) {
    if (S.rec) return false;
    if (S.anim) finishAnim();
    await restore(data);
    setProjectName(name || data.name || tl('Sans titre'), null); S.projectPath = null;
    S.dirty = false; $('#projectName').classList.remove('dirty'); autosave(); frameAll();
    S.faultKeys = new Set(); resetHistory(); invalidate(500);
    return true;
  },
  onChange(fn) { S.changeHooks.push(fn); return () => { S.changeHooks = S.changeHooks.filter(f => f !== fn); }; },
  // Timeline de la vidéo : un module y ajoute sa piste ; time() rend l'instant joué (null hors animation).
  timeline: {
    addTrack(tr) { TRACKS.push(tr); timelineDock.refresh(); return () => { const i = TRACKS.indexOf(tr); if (i >= 0) TRACKS.splice(i, 1); timelineDock.refresh(); }; },
    time: () => (S.anim && !S.anim.temp ? S.anim.T : null),
    end: () => TL.end(S.timeline),
    refresh: () => timelineDock.refresh()
  },
  codeBar(html) { $('#progRun').insertAdjacentHTML('beforebegin', html); const el = $('#progRun').previousElementSibling; hydrateIcons(el.parentElement); return el; },
  native
};
/** Données des modules pour le fichier : celles des modules présents, et telles quelles celles des absents. */
function moduleData() {
  const out = { ...S.modulesRaw };
  S.modules.forEach((m, k) => { out[k] = m.save(); });
  return Object.keys(out).length ? out : undefined;
}
function loadModules(raw) { S.modulesRaw = raw && typeof raw === 'object' ? raw : {}; S.modules.forEach((m, k) => m.load(S.modulesRaw[k] ?? null)); }
/** Édition gratuite : un bouton présente le mode Enseignement de l'édition Pro, sans en contenir le code. */
function installProTeaser() {
  $('#schBtn').insertAdjacentHTML('beforebegin', `<button type="button" class="tb label" id="teachTeaser" data-tip="${tl('Mode Enseignement : édition Pro')}">${icon('graduation')}<span>${tl('Enseigner')}</span>${icon('lock', 'lockIc')}</button>`);
  document.body.insertAdjacentHTML('beforeend', `<div class="modal" id="proModal" hidden><div class="sheet proSheet" role="dialog" aria-modal="true" aria-labelledby="proTitle">
    <div class="sheetHead"><h2 id="proTitle">${tl('{0}Mode Enseignement · édition Pro', icon('graduation'))}</h2><button type="button" class="btn" id="proClose">${tl('Fermer')}</button></div>
    <p>${tl('Le mode Enseignement transforme un montage en cours guidé :')}</p>
    <ul><li>${tl('des notes numérotées posées sur les composants ou sur le tapis (information, astuce, attention) ;')}</li>
    <li>${tl('une présentation pas à pas, en plein écran : la caméra va sur chaque note, sa bulle s’affiche en grand ;')}</li>
    <li>${tl('les notes apparaissent dans les vidéos exportées.')}</li></ul>
    <p class="note">${tl('Les notes d’un projet créé avec l’édition Pro sont conservées quand vous l’ouvrez et l’enregistrez ici.')}</p></div></div>`);
  $('#teachTeaser').onclick = () => ($('#proModal').hidden = false);
  $('#proClose').onclick = () => ($('#proModal').hidden = true);
  $('#proModal').onclick = e => { if (e.target.id === 'proModal') $('#proModal').hidden = true; };
}

/* ---------- Démarrage ---------- */
async function start() {
  // Lectures lancées dès le départ, en parallèle, pendant la préparation de l'interface : bibliothèque
  // personnelle et sauvegarde automatique (disque, côté Rust), pièces CAO du rendu réaliste.
  try { if (LIGHT && localStorage.getItem('jollof-real') == null) setRealistic(false); } catch (e) { /* stockage indisponible */ }
  const loading = Promise.all([
    native.libraryList().catch(() => []),
    REAL.on ? loadCadLibrary().then(() => { cadLoaded = true; }, e => console.error(e)) : null,
    native.autosaveRead().catch(() => null)
  ]);
  translateDom();
  await checkInstallLanguage(native.installLanguage); // langue choisie à l'installation (redémarre une fois si elle change)
  hydrateIcons();
  initScene();
  bindUI();
  // Espace classe (connexion, devoirs, messages, groupes) : dans les deux éditions.
  const school = installSchool(moduleApi, { pro: import.meta.env.VITE_EDITION === 'pro' });
  moduleApi.school = school.hub;
  installLab(moduleApi); // travaux pratiques guidés (hors ligne, sans compte)
  // Édition Pro : ses modules sont chargés avant le projet, pour en lire les données.
  // Dans une construction gratuite, cette condition est fausse dès la compilation : le code Pro n'y est pas.
  // Modules Pro : dépôt privé jollof-studio-pro, résolu par vite.config.js (virtual:jollof-pro).
  if (import.meta.env.VITE_EDITION === 'pro') {
    try { (await import('virtual:jollof-pro')).installPro(moduleApi); } catch (e) { console.error(tl('Modules Pro indisponibles'), e); }
    document.querySelector('.brand').insertAdjacentHTML('beforeend', `<span class="proBadge">${tl('Pro')}</span>`);
  } else installProTeaser();
  const [userLib, , saved] = await loading;
  S.userLib = userLib;
  renderUI();
  renderLibrary();
  let data = null;
  try { data = saved ? JSON.parse(saved) : null; } catch (e) { data = null; }
  if (data && Array.isArray(data.comps) && data.comps.length) { await restore(data); setProjectName(data.name || tl('Sans titre'), data.path || null); }
  else if (EXAMPLES.length) { await restore(EXAMPLES[0].data); setProjectName(EXAMPLES[0].data.name, null); }
  frameAll(); resetHistory();
  requestAnimationFrame(tick);
  school.afterStart();
  if (import.meta.env.DEV) window.__jollof = { ...moduleApi, renderInfo: () => ({ ...renderer.info.render, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length, meshes: (() => { let n = 0, v = 0; scene.traverse(o => { if (o.isMesh || o.isSprite || o.isLine) { n++; if (o.visible) v++; } }); return { n, v }; })() }) }; // tests automatiques (absent des constructions)
}
(document.fonts ? Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]) : Promise.resolve()).then(start);
