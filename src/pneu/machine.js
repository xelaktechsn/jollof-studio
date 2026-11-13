// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : la machine en 3D, à côté du schéma. Elle ne s'édite pas : elle montre ce que fait le circuit simulé.
// - « Vérins du circuit » : chaque vérin du plan, sa tige qui sort et rentre, ses capteurs de fin de course (voyant
//   allumé quand le piston est devant), ses raccords colorés selon la pression de chaque chambre ;
// - « Porte de TER » : une porte de voiture voyageurs à deux vantaux coulissants. Un seul vérin, dans le caisson
//   au-dessus de la baie (capot transparent), pousse le vantail gauche ; une courroie sur deux poulies entraîne le
//   vantail droit en sens inverse. Capteurs a0 (porte fermée) et a1 (ouverte), distributeur et son électroaimant,
//   tuyaux sous pression ou à l'échappement, voyant de porte (vert ouverte, orange clignotant en mouvement), bouton
//   d'ouverture sur le vantail (cliquable), quai et bande d'éveil, voyageur dans la baie quand l'obstacle est signalé ;
//   habillée en bus (BRT) à quai de plain-pied, avec une poignée d'urgence ;
// - « Presse de marquage » : presse d'établi en col de cygne, vérin vertical, pupitre de commande à deux mains ;
// - « Poste de serrage et perçage » : un vérin serre la pièce contre une butée, l'autre descend l'unité de perçage ;
// - « Pantographe » : toit d'un train électrique, pantographe à un bras levé par l'air, caténaire ;
// - « Convoyeur de tri » : tapis, cellule photoélectrique, vérin pousseur qui envoie un colis dans le bac de côté.
// SCENES décrit chaque machine pour l'en-tête de la vue (vérins à choisir, boutons liés au circuit).
// Chargé à la première ouverture de la vue 3D : rien au démarrage de l'application. Formes simples (aucun modèle à
// télécharger), couleurs inspirées du Sénégal sans reprendre la livrée d'un vrai train.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Q } from '../quality.js';
import { textSprite } from '../ui/guides.js';
import { tl } from '../i18n/index.js';

/** Porte : course de chaque vantail (m), rayon des poulies (m). */
export const DOOR = { travel: 0.62, pulleyR: 0.05, leafW: 0.65, leafH: 1.98 };
const clamp01 = x => Math.max(0, Math.min(1, +x || 0));
/** Pose de la porte pour une position du vérin x (0 tige rentrée : fermée ; 1 sortie : ouverte). */
export function doorPose(x) {
  const s = DOOR.travel * clamp01(x);
  return { left: -s, right: s, rod: s, pulley: s / DOOR.pulleyR };
}

/**
 * Pantographe à un bras (en Z), origine à l'axe du bras inférieur, longueurs en m, angles en rad : bras inférieur l1,
 * bras supérieur l2, tête à l'aplomb de dx ; replié, le bras inférieur est à fold de l'horizontale ; fil de contact à
 * wire au-dessus de l'axe, dessus des bandes de frottement à top au-dessus de la tête. Le vérin (axe horizontal à la
 * hauteur cylY, tige vers -x) pousse par une biellette (link) la manivelle (rayon crank, calée à lead du bras).
 */
export const PANTO = { l1: 1, l2: 1.06, dx: -0.05, fold: 0.07, wire: 1.3, top: 0.09, crank: 0.24, lead: Math.PI / 3, link: 0.2, cylY: 0.235 };
const pantoB = a => Math.acos((PANTO.l1 * Math.cos(a) - PANTO.dx) / PANTO.l2);
const pantoH = a => PANTO.l1 * Math.sin(a) + PANTO.l2 * Math.sin(pantoB(a)) + PANTO.top;
/** Nez de tige (x) qui tient le bras inférieur à l'angle a : la biellette va du nez de tige au maneton de la manivelle. */
const pantoTip = a => PANTO.crank * Math.cos(a + PANTO.lead) + Math.sqrt(PANTO.link ** 2 - (PANTO.cylY - PANTO.crank * Math.sin(a + PANTO.lead)) ** 2);
// Angle du bras inférieur quand les bandes touchent le fil (dichotomie : la hauteur croît avec l'angle), puis course du vérin.
{ let lo = PANTO.fold, hi = 1.2; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (pantoH(m) < PANTO.wire) lo = m; else hi = m; } PANTO.up = (lo + hi) / 2; }
PANTO.t0 = pantoTip(PANTO.fold); PANTO.stroke = PANTO.t0 - pantoTip(PANTO.up);
/**
 * Pose du pantographe pour une position du vérin x (0 replié, 1 bandes au fil). Rend (dans out, réutilisable) :
 * a et b angles des bras, (ex, ey) coude, (hx, hy) tête, h hauteur du dessus des bandes, (px, py) maneton, tx nez de
 * tige, rod sortie de tige.
 */
export function pantoPose(x, out = {}) {
  const K = PANTO, rod = K.stroke * clamp01(x), tx = K.t0 - rod, d = Math.hypot(tx, K.cylY);
  // Bielle-manivelle : le maneton est à crank de l'axe et à link du nez de tige.
  const beta = Math.atan2(K.cylY, tx) + Math.acos(Math.max(-1, Math.min(1, (K.crank ** 2 + d * d - K.link ** 2) / (2 * K.crank * d))));
  const a = beta - K.lead, b = pantoB(a);
  out.a = a; out.b = b; out.ex = K.l1 * Math.cos(a); out.ey = K.l1 * Math.sin(a); out.hx = K.dx; out.hy = out.ey + K.l2 * Math.sin(b); out.h = out.hy + K.top;
  out.px = K.crank * Math.cos(beta); out.py = K.crank * Math.sin(beta); out.tx = tx; out.rod = rod;
  return out;
}

/**
 * Convoyeur de tri (m) : tapis de x0 à x1, demi-largeur half ; cellule en beam ; poussoir de plate[0] à plate[1], de
 * course stroke ; colis len × depth ; vitesse telle qu'un colis coupe le faisceau 0,6 s.
 */
export const SORT = { x0: -1.15, x1: 1.05, half: 0.2, beam: -0.15, plate: [-0.13, 0.31], stroke: 0.36, len: 0.22, depth: 0.2, speed: 0.22 / 0.6 };
/** Face avant du poussoir (z) pour une position x du vérin : au bord arrière du tapis tige rentrée. */
export const pusherZ = x => -SORT.half + SORT.stroke * clamp01(x);
/**
 * Un pas dt d'un colis b { x, z } posé sur le tapis. pz : face avant du poussoir ; lim : x à ne pas dépasser (colis
 * de devant). Le colis avance avec le tapis ; le poussoir le pousse vers +z s'il le recouvre (il frotte : il avance
 * moins vite), et l'arrête s'il est sorti en travers de son chemin. Rend 0 sur le tapis, 1 tombé de côté (poussé
 * au-delà du bord), 2 tombé en bout de tapis.
 */
export function sortStep(b, dt, pz, lim = Infinity) {
  const K = SORT, hl = K.len / 2, o = Math.min(b.x + hl, K.plate[1]) - Math.max(b.x - hl, K.plate[0]);
  let v = K.speed;
  if (pz > b.z - K.depth / 2 + 1e-6 && o > 0.015) { b.z = pz + K.depth / 2; v *= 0.35; }
  let nx = b.x + v * dt;
  if (pz > b.z - K.depth / 2 + 1e-6 && nx + hl > K.plate[0] && b.x + hl <= K.plate[0] + 0.015) nx = Math.max(b.x, Math.min(nx, K.plate[0] - hl));
  b.x = Math.min(nx, Math.max(b.x, lim));
  return b.z > K.half ? 1 : b.x > K.x1 ? 2 : 0;
}

/**
 * Pièce travaillée par un outil (poinçon, foret) : faite quand l'outil arrive en bout de course ; une fois l'avance
 * revenue (feed, le mouvement qui amène la pièce : le poinçon lui-même, ou le serrage), l'avance suivante apporte une
 * pièce neuve et w.n compte les pièces finies. Rien ne bouge simulation arrêtée.
 */
export function workStep(w, tool, feed, running) {
  if (!running) { w.done = w.back = false; w.n = 0; return w; }
  if (tool >= 0.98) w.done = true;
  if (w.done && feed <= 0.05) w.back = true;
  if (w.back && feed > 0.12) { w.done = w.back = false; w.n++; }
  return w;
}

/**
 * Machines proposées, dans l'ordre du menu. name() ; cfg : ce qui est écrit dans circuit.scene ({ kind: clé } à
 * défaut) ; cyls [{ key, label() }] : un vérin par rôle (à défaut le premier vérin du circuit, puis le deuxième) ;
 * controls [{ role, mode, label(nom), defaults, bench, icon, warn }] : commandes liées au circuit (label sauf 'auto'). mode : 'hold' appuyé tant
 * qu'on clique, 'toggle' bascule à chaque clic, 'click' action de la vue (un colis), 'auto' tenu par la vue elle-même
 * (cellule). Un rôle désigne circuit.scene[role], sinon le premier nom de defaults connu du circuit (entrée du
 * GRAFCET, distributeur à bouton, bouton du montage), sinon le bouton n° bench du montage.
 */
const CYL = label => [{ key: 'cyl', label }];
const OPEN = { role: 'open', mode: 'hold', label: n => tl('Ouvrir ({0})', n), defaults: ['dcy'], bench: 0 };
const OBS = { role: 'obstacle', mode: 'toggle', label: () => tl('Obstacle'), defaults: ['obs'], icon: 'alert', warn: true };
export const SCENES = {
  cylinders: { name: () => tl('Vérins du circuit'), cyls: [], controls: [] },
  door: { name: () => tl('Porte de TER'), cyls: CYL(() => tl('Vérin de la porte')), controls: [OPEN, OBS] },
  bus: { name: () => tl('Porte de bus (BRT)'), cfg: { kind: 'door', skin: 'bus' }, cyls: CYL(() => tl('Vérin de la porte')), controls: [OPEN, OBS, { role: 'emergency', mode: 'toggle', label: () => tl('Urgence'), defaults: ['au'], icon: 'bell', warn: true }] },
  press: { name: () => tl('Presse de marquage'), cyls: CYL(() => tl('Vérin de la presse')), controls: [{ role: 'left', mode: 'toggle', label: () => tl('Main gauche'), defaults: ['s1'], bench: 0 }, { role: 'right', mode: 'toggle', label: () => tl('Main droite'), defaults: ['s2'], bench: 1 }] },
  station: { name: () => tl('Poste de serrage et perçage'), cyls: [{ key: 'clamp', label: () => tl('Vérin de serrage') }, { key: 'drill', label: () => tl('Vérin de perçage') }], controls: [{ role: 'start', mode: 'hold', label: n => tl('Départ ({0})', n), defaults: ['dcy'], bench: 0, icon: 'play' }] },
  pantograph: { name: () => tl('Pantographe'), cyls: CYL(() => tl('Vérin du pantographe')), controls: [{ role: 'up', mode: 'toggle', label: () => tl('Lever'), defaults: ['up'], bench: 0, icon: 'chevUp' }] },
  sorter: { name: () => tl('Convoyeur de tri'), cyls: CYL(() => tl('Vérin pousseur')), controls: [{ role: 'send', mode: 'click', label: () => tl('Envoyer un colis'), defaults: ['send'], icon: 'send' }, { role: 'detect', mode: 'auto', defaults: ['det'] }] }
};
/** Clé de SCENES pour les réglages d'un circuit (la porte de bus est une porte avec skin: 'bus'). */
export const sceneId = c => (!c || !SCENES[c.kind] || SCENES[c.kind].cfg ? 'cylinders' : c.kind === 'door' && c.skin === 'bus' ? 'bus' : c.kind);

const COL = { body: 0xdfe3e2, band: 0x1f8a4c, stripe: 0xf2c230, accent: 0xd8342b, glass: 0x1d2b36, metal: 0xc9d0d6, alu: 0xaeb7bf, dark: 0x2a3036, platform: 0x9ba2a7, tactile: 0xf2c94c, P: 0x3b82f6, E: 0x6b7680, C: 0x8a949c, on: 0x4ade80, off: 0x39424a, amber: 0xf59e0b, red: 0xef4444 };
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...o });
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (r, l, m, seg = 20) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, seg), m);
/** Étiquette (sprite) de hauteur h (m), posée par sa base. */
function label(text, h = 0.07, o = {}) {
  const sp = textSprite(text, { size: 40, bg: o.bg || '#0f1418cc', color: o.color || '#e4e7e8', border: o.border });
  sp.scale.set(h * sp.userData.aspect, h, 1);
  return sp;
}
/** Voyant : petite sphère émissive. */
function led(r = 0.012) { const m = mat(COL.off, { emissive: 0x000000 }); const s = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m); s.userData.led = m; return s; }
const setLed = (s, color, on) => { const m = s.userData.led; m.color.setHex(on ? color : COL.off); m.emissive.setHex(on ? color : 0x000000); m.emissiveIntensity = on ? 1.1 : 0; };
/** Raccord ou tuyau : couleur selon l'état de la pression (P sous pression, E échappement, autre fermé). */
const pressColor = s => (s === 'P' || s === 'CP' ? COL.P : s === 'M' ? 0x7aa6f0 : s === 'E' ? COL.E : COL.C);

/** Vérin horizontal (axe x), tige vers -x : { group, setX(x), barrel… }. Longueur du corps L, course S, rayon r. */
function cylinderModel({ L = 0.9, S = 0.62, r = 0.035, rodR = 0.012 } = {}) {
  const g = new THREE.Group(), alu = mat(COL.alu, { metalness: 0.6, roughness: 0.35 }), chrome = mat(0xe6eaee, { metalness: 0.9, roughness: 0.15 });
  const barrel = cyl(r, L, alu, 28); barrel.rotation.z = Math.PI / 2; barrel.position.x = L / 2; g.add(barrel);
  // Profilé : quatre rainures (méplats) qui donnent l'aspect d'un vérin normalisé.
  for (const a of [0, 1, 2, 3]) { const f = box(L * 0.96, 0.004, 0.012, mat(0x8e98a1, { metalness: 0.5 })); f.position.set(L / 2, Math.cos(a * Math.PI / 2) * r, Math.sin(a * Math.PI / 2) * r); f.rotation.x = a * Math.PI / 2; g.add(f); }
  const capM = mat(0x5b656e, { metalness: 0.4 });
  const capL = box(0.05, r * 2.3, r * 2.3, capM); capL.position.x = 0.025; g.add(capL);
  const capR = box(0.05, r * 2.3, r * 2.3, capM); capR.position.x = L - 0.025; g.add(capR);
  const rod = cyl(rodR, 1, chrome, 16); rod.rotation.z = Math.PI / 2; g.add(rod);
  const tip = box(0.04, 0.035, 0.035, mat(0x48525b, { metalness: 0.5 })); g.add(tip);
  const fittings = [0.06, L - 0.06].map(x => { const f = cyl(0.012, 0.03, mat(COL.C), 12); f.position.set(x, r + 0.012, 0); g.add(f); return f; });
  const rod0 = 0.1;
  function setX(x) { const s = S * clamp01(x), len = rod0 + s; rod.scale.y = len; rod.position.x = -len / 2; tip.position.x = -len; return -len; }
  setX(0);
  return { group: g, setX, fittings, L, r, tipAt: x => -(rod0 + S * clamp01(x)) };
}
/** Capteur de fin de course (ILS) posé sur le corps du vérin, avec son voyant et son repère. */
function reedSwitch(name, r, ledR = 0.008, tagH = 0.045) {
  const g = new THREE.Group(), body = box(0.05, 0.016, 0.02, mat(0x23292e)); body.position.y = r + 0.01; g.add(body);
  const l = led(ledR); l.position.set(0.018, r + 0.022, 0); g.add(l);
  const t = label(name, tagH); t.position.set(0, r + 0.035, 0); g.add(t);
  return { group: g, led: l, tag: t };
}

/** Champ de vision vertical (degrés) : 40° ; fenêtre en hauteur (plus étroite que 1,15) : la largeur cadrée est gardée. */
export const FOV = aspect => (aspect >= 1.15 ? 40 : 2 * Math.atan(Math.tan(Math.PI / 9) * 1.15 / aspect) * 180 / Math.PI);

/**
 * Vue 3D dans host. api : { press(rôle, appuyé) } (commandes de SCENES : bouton cliqué dans la scène, cellule du
 * convoyeur). Rend { build(config, circuit), update(état), act(rôle), resize(), dispose() }. état : { running, t,
 * x(id), press(id, orifice), sensor(nom), coil(nom), input(nom), role(rôle) → commande appuyée }.
 */
export function createMachineView(host, api) {
  const canvas = document.createElement('canvas'); canvas.className = 'pn3dCanvas'; host.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, precision: Q.precision });
  renderer.setPixelRatio(Q.pixelRatio); renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95; // blanc de la caisse sans éblouir
  renderer.shadowMap.enabled = !!Q.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  // Ciel de Dakar : bleu en haut, clair à l'horizon.
  const sky = document.createElement('canvas'); sky.width = 4; sky.height = 128;
  const sx = sky.getContext('2d'), gr = sx.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#7fb2e0'); gr.addColorStop(1, '#eef3f6'); sx.fillStyle = gr; sx.fillRect(0, 0, 4, 128);
  const skyTex = new THREE.CanvasTexture(sky); skyTex.encoding = THREE.sRGBEncoding; scene.background = skyTex;
  const workshop = new THREE.Color(0x1b2229);
  scene.add(new THREE.HemisphereLight(0xf4f7fb, 0x6f767c, 0.55));
  const sun = new THREE.DirectionalLight(0xfff6e8, 0.95); sun.position.set(-3, 5, 4); sun.castShadow = !!Q.shadows;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2, near: 0.5, far: 20 }); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.minDistance = 1; controls.maxDistance = 12; controls.maxPolarAngle = Math.PI * 0.49;
  let root = new THREE.Group(), S = null, pending = false, kind = null;
  scene.add(root);
  const render = () => { pending = false; controls.update(); renderer.render(scene, camera); };
  const ask = () => { if (!pending) { pending = true; requestAnimationFrame(render); } };
  controls.addEventListener('change', ask);
  // Fenêtre en hauteur (agrandie à côté des panneaux) : le champ vertical s'ouvre pour garder la largeur cadrée.
  function resize() { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = FOV(w / h); camera.updateProjectionMatrix(); ask(); }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null; if (ro) ro.observe(host);

  function clear() {
    scene.remove(root);
    root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
    root = new THREE.Group(); scene.add(root);
  }
  const shadows = o => { if (!Q.shadows) return o; o.traverse(m => { if (m.isMesh && !m.userData.ghost) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
  // Commandes tenues par la vue elle-même (cellule du convoyeur) : relâchées à l'arrêt de la simulation, quand la
  // scène est reconstruite ou fermée, et si la vue n'est plus mise à jour (plan masqué, simulation en pause).
  const held = new Set(); let seen = 0, watch = 0;
  function hold(role, v) {
    if (held.has(role) === !!v) return;
    if (v) held.add(role); else held.delete(role);
    api.press(role, !!v);
    if (held.size && !watch) watch = setInterval(() => { if (performance.now() - seen > 500) release(); }, 250);
    if (!held.size && watch) { clearInterval(watch); watch = 0; }
  }
  function release() { if (held.size) for (const r of [...held]) hold(r, false); }

  /* ---------- Outils communs aux machines ---------- */
  const V = (x, y, z) => new THREE.Vector3(x, y, z), mtx = new THREE.Matrix4();
  const put = (o, x, y, z, to = root) => { o.position.set(x, y, z); to.add(o); return o; };
  const isCyl = x => x.type === 'cyl1' || x.type === 'cyl2';
  /** Vérin d'un rôle : par identifiant ou repère, sinon le i-ème vérin du circuit. */
  const cylOf = (circuit, ref, i = 0) => { const cs = circuit.elements.filter(isCyl); return (ref && cs.find(x => x.id === ref || (x.p && x.p.label) === ref)) || cs[i] || null; };
  const tube = (pts, r = 0.007) => { const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => (p.isVector3 ? p : V(...p)))), 32, r, 8, false), mat(COL.C, { roughness: 0.4 })); root.add(t); return t; };
  const glass = () => new THREE.MeshStandardMaterial({ color: 0xcfe3f1, transparent: true, opacity: 0.16, roughness: 0.1, depthWrite: false });
  const ghost = o => { o.userData.ghost = true; return o; }; // ni ombre portée ni ombre reçue (capots transparents, faisceau)
  /** Atelier : fond sombre et sol à la hauteur y. */
  function workshopFloor(y) { scene.background = workshop; const f = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), mat(0x2a3138, { roughness: 0.95 })); f.rotation.x = -Math.PI / 2; put(f, 0, y, 0); }
  /** Établi : plateau w × d dont le dessus est à y = 0, sol 0,8 m plus bas. */
  function bench(w, d) {
    workshopFloor(-0.8);
    put(box(w, 0.04, d, mat(0x8a6f4d, { roughness: 0.8 })), 0, -0.02, 0);
    const legM = mat(0x59636c, { metalness: 0.4 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(box(0.05, 0.76, 0.05, legM), sx * (w / 2 - 0.06), -0.42, sz * (d / 2 - 0.06));
  }
  /**
   * Vérin posé dans la scène : nez du corps en at, tige vers rod, raccords du côté up, capteurs du côté sens (leurs
   * repères décalés de tag, de hauteur tagH), nom en name, distributeur en valve avec ses deux tuyaux (via : points
   * de passage).
   * Rend { x(état) } : met à jour tige, raccords, tuyaux et voyants, et rend la position 0…1 du vérin.
   */
  function mount(e, o) {
    const P = (e && e.p) || {}, m = cylinderModel(o), X = V(...o.rod).negate().normalize(), Y = V(...o.up).normalize(), at = V(...o.at);
    const turn = (g, y) => g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, y, V(0, 0, 0).crossVectors(X, y)));
    turn(m.group, Y); m.group.position.copy(at); root.add(m.group);
    const Ys = o.sens ? V(...o.sens).normalize() : Y, tg = o.tag || [0, m.r + 0.035, 0], sens = [];
    for (const [nm, lx] of [[P.s0, m.L - 0.075], [P.s1, 0.075]]) {
      if (!nm) continue;
      const s = reedSwitch(nm, m.r, o.ledR || 0.011, o.tagH); turn(s.group, Ys); s.group.position.copy(at).addScaledVector(X, lx); root.add(s.group);
      s.group.remove(s.tag); s.tag.position.copy(s.group.position).add(V(...tg)); root.add(s.tag); sens.push([s.led, nm]);
    }
    if (o.name) { const t = label(P.label || (e ? e.id : '?'), o.nameH || 0.07, { bg: '#1f2a33dd' }); t.position.set(...o.name); root.add(t); }
    let tubes = null;
    if (o.valve) {
      const v = V(...o.valve); put(box(0.16, 0.07, 0.07, mat(0x2f6f9f, { metalness: 0.3 })), v.x, v.y, v.z);
      tubes = [0.06, m.L - 0.06].map((lx, k) => { const f = at.clone().addScaledVector(X, lx).addScaledVector(Y, m.r + 0.024), a = V(v.x + (k ? 0.04 : -0.04), v.y + 0.035, v.z); return tube([a, V(a.x, a.y + 0.07, a.z), ...((o.via && o.via[k]) || []), f.clone().addScaledVector(Y, 0.08), f]); });
    }
    return {
      x(st) {
        const x = e ? st.x(e.id) : 0; m.setX(x);
        for (let k = 0; k < 2; k++) { const c = pressColor(e ? st.press(e.id, k === 0 ? '2' : '1') : null); m.fittings[k].material.color.setHex(c); if (tubes) tubes[k].material.color.setHex(c); }
        for (const [l, nm] of sens) setLed(l, COL.on, st.sensor(nm));
        return x;
      }
    };
  }
  /** Bouton poussoir (axe y) cliquable, lié à un rôle : { g, cap, set(appuyé) }. */
  function pushBtn(role, r = 0.04, color = 0x15803d) {
    const g = new THREE.Group(), m = mat(color, { emissive: 0x000000 }), cap = cyl(r, r * 0.7, m, 24), ring = cyl(r * 1.3, r * 0.3, mat(0xd9dde0, { metalness: 0.6 }), 24);
    cap.position.y = r * 0.5; ring.position.y = r * 0.15; cap.userData.press = role; g.add(ring, cap);
    return { g, cap, set(on) { m.emissive.setHex(on ? 0x22c55e : 0x000000); m.emissiveIntensity = on ? 0.9 : 0; cap.position.y = on ? r * 0.3 : r * 0.5; } };
  }

  /* ---------- Vérins du circuit ---------- */
  // Comme sur un pupitre de formation : une plaque à rainures verticale, les vérins fixés l'un au-dessus de l'autre.
  function buildCylinders(circuit) {
    const cyls = circuit.elements.filter(e => e.type === 'cyl1' || e.type === 'cyl2');
    const items = [], gap = 0.36, n = Math.max(1, cyls.length), Hp = n * gap + 0.24;
    scene.background = workshop;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), mat(0x2a3138, { roughness: 0.95 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; root.add(floor);
    const plate = box(1.5, Hp, 0.03, mat(0xb9c1c8, { metalness: 0.5, roughness: 0.45 })); plate.position.set(0.05, Hp / 2 + 0.25, -0.07); root.add(plate);
    for (let k = 1; k < Hp / 0.05; k++) { const g = box(1.5, 0.006, 0.006, mat(0x8d969e)); g.position.set(0.05, 0.25 + k * 0.05, -0.052); root.add(g); }
    const legM = mat(0x59636c, { metalness: 0.4 });
    for (const x of [-0.65, 0.75]) { const l = box(0.05, 0.25, 0.05, legM); l.position.set(x, 0.125, -0.07); root.add(l); }
    cyls.forEach((e, i) => {
      const p = e.p || {}, bore = Math.max(8, +p.bore || 25), y = 0.25 + Hp - 0.2 - i * gap;
      const m = cylinderModel({ L: 0.62, S: 0.4, r: 0.02 + bore / 1000 * 0.9, rodR: 0.008 + bore / 1000 * 0.25 });
      m.group.position.set(-0.05, y, 0); root.add(m.group);
      for (const x of [0.02, 0.5]) { const f = box(0.05, 0.03, 0.06, legM); f.position.set(-0.05 + x, y - m.r - 0.01, -0.03); root.add(f); }
      const name = label(p.label || e.id, 0.07, { bg: '#1f2a33dd' }); name.position.set(0.62, y + m.r + 0.03, 0); root.add(name);
      const sens = [];
      if (p.s0) { const s = reedSwitch(p.s0, m.r); s.group.position.set(-0.05 + 0.54, y, 0); root.add(s.group); sens.push([s, p.s0]); }
      if (p.s1) { const s = reedSwitch(p.s1, m.r); s.group.position.set(-0.05 + 0.1, y, 0); root.add(s.group); sens.push([s, p.s1]); }
      items.push({ e, m, sens });
    });
    if (!cyls.length) { const t = label('—', 0.12); t.position.set(0, 0.5, 0); root.add(t); }
    shadows(root);
    const cy = 0.25 + Hp / 2;
    camera.position.set(0.45, cy + 0.25, 0.9 + n * 0.32); controls.target.set(0.05, cy, 0);
    return {
      update(st) {
        for (const { e, m, sens } of items) {
          m.setX(st.x(e.id));
          m.fittings.forEach((f, k) => f.material.color.setHex(pressColor(st.press(e.id, k === 0 ? '2' : '1'))));
          for (const [s, nm] of sens) setLed(s.led, COL.on, st.sensor(nm));
        }
      }
    };
  }

  /* ---------- Porte de TER ---------- */
  function buildDoor(circuit, cfg) {
    scene.background = skyTex;
    const e = cylOf(circuit, cfg.cyl), bus = cfg.skin === 'bus';
    const P = (e && e.p) || {}, W = DOOR.leafW * 2, H = 2.0;
    // Caisse : paroi percée de la baie et de deux fenêtres ; bande verte, filet jaune, liseré rouge. En bus : bas de
    // caisse rouge, filet jaune, bandeau vitré sombre d'un bout à l'autre.
    const wall = new THREE.Shape(); wall.moveTo(-2.6, -0.3); wall.lineTo(2.6, -0.3); wall.lineTo(2.6, 2.95); wall.lineTo(-2.6, 2.95); wall.lineTo(-2.6, -0.3);
    const hole = (x0, y0, x1, y1) => { const h = new THREE.Path(); h.moveTo(x0, y0); h.lineTo(x0, y1); h.lineTo(x1, y1); h.lineTo(x1, y0); h.lineTo(x0, y0); wall.holes.push(h); };
    hole(-W / 2, 0, W / 2, H); if (!bus) { hole(-2.2, 1.05, -1.05, 1.9); hole(1.05, 1.05, 2.2, 1.9); }
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(wall, { depth: 0.08, bevelEnabled: false }), mat(bus ? 0xf1f2f0 : COL.body, { roughness: 0.4 })); body.position.z = -0.08; root.add(body);
    const band = box(5.2, 0.27, 0.012, mat(bus ? COL.accent : COL.band)); band.position.set(0, -0.155, 0.006); root.add(band);
    if (bus) {
      for (const sx of [-1, 1]) {
        const x = sx * (W / 2 + 2.6) / 2, w = 2.6 - W / 2;
        put(box(w, 0.62, 0.012, mat(COL.accent)), x, 0.31, 0.006); put(box(w, 0.05, 0.012, mat(COL.stripe)), x, 0.66, 0.006);
        put(box(w - 0.4, 1.12, 0.012, mat(COL.glass, { roughness: 0.08, metalness: 0.3 })), x + sx * 0.2, 1.44, 0.006); // bandeau vitré, montant près de la porte
        put(box(0.3, 1.12, 0.014, mat(0xf1f2f0, { roughness: 0.4 })), sx * 1.5, 1.44, 0.007); // montant : la poignée d'urgence s'y fixe, hors de la course du vantail
      }
    } else {
      const stripe = box(5.2, 0.05, 0.012, mat(COL.stripe)); stripe.position.set(0, 2.62, 0.006); root.add(stripe);
      const red = box(5.2, 0.018, 0.012, mat(COL.accent)); red.position.set(0, 2.57, 0.006); root.add(red);
      for (const x of [-1.625, 1.625]) { const g = box(1.15, 0.85, 0.01, mat(COL.glass, { roughness: 0.1, metalness: 0.3 })); g.position.set(x, 1.475, -0.06); root.add(g); }
    }
    const inside = box(W + 1.6, H + 0.2, 0.05, mat(0x3b4148)); inside.position.set(0, H / 2, -1.2); root.add(inside); // fond de la voiture
    const floorIn = box(W + 1.6, 0.04, 1.2, mat(0x5a6168)); floorIn.position.set(0, -0.02, -0.6); root.add(floorIn);
    // Quai : béton, bord blanc, bande d'éveil podotactile jaune.
    const quay = box(6.5, 0.25, 3, mat(COL.platform, { roughness: 0.9 })); quay.position.set(0, -0.125, 1.62); root.add(quay);
    const edge = box(6.5, 0.006, 0.06, mat(0xf4f4f4)); edge.position.set(0, 0.004, 0.18); root.add(edge);
    const tact = box(6.5, 0.006, 0.4, mat(COL.tactile, { roughness: 0.8 })); tact.position.set(0, 0.004, 0.62); root.add(tact);
    // Station de BRT : garde-corps vitrés au bord du quai, de part et d'autre de la porte ; poignée d'urgence rouge.
    let emg = null;
    if (bus) {
      const postM = mat(0x8d969e, { metalness: 0.6, roughness: 0.35 });
      for (const sx of [-1, 1]) { ghost(put(box(1.5, 0.95, 0.02, glass()), sx * 2.0, 0.55, 0.36)); for (const x of [1.22, 2.78]) put(box(0.04, 1.1, 0.04, postM), sx * x, 0.55, 0.36); put(box(1.6, 0.04, 0.05, postM), sx * 2.0, 1.1, 0.36); }
      const plate = put(box(0.2, 0.32, 0.02, mat(COL.stripe, { roughness: 0.6 })), 1.5, 1.4, 0.022), hM = mat(COL.red), h = new THREE.Group();
      put(box(0.045, 0.17, 0.035, hM), 0, -0.075, 0.02, h); put(cyl(0.03, 0.09, hM, 16), 0, -0.16, 0.02, h).rotation.z = Math.PI / 2;
      put(h, 1.5, 1.5, 0.035); plate.userData.press = 'emergency'; h.traverse(o => { o.userData.press = 'emergency'; });
      emg = { h, plate, led: put(led(0.02), 1.5, 1.52, 0.04) };
    }
    // Vantaux : cadre, vitre, joint de bord (rouge si obstacle), bouton d'ouverture sur le vantail droit.
    const leaf = side => {
      const g = new THREE.Group();
      const frame = box(DOOR.leafW, DOOR.leafH, 0.04, mat(bus ? 0x262b30 : 0xe4e8eb, { roughness: 0.35 })); frame.position.y = DOOR.leafH / 2 + 0.01; g.add(frame);
      const win = box(DOOR.leafW - (bus ? 0.16 : 0.22), bus ? 1.5 : 0.85, 0.045, mat(COL.glass, { roughness: 0.08, metalness: 0.3 })); win.position.y = bus ? 1.1 : 1.45; g.add(win);
      const kick = box(DOOR.leafW, 0.06, 0.044, mat(COL.stripe)); kick.position.y = 0.06; g.add(kick);
      const sealM = mat(0x16191c), seal = box(0.025, DOOR.leafH, 0.05, sealM); seal.position.set(side * -(DOOR.leafW / 2 - 0.0125), DOOR.leafH / 2 + 0.01, 0); g.add(seal);
      g.position.z = 0.1; root.add(g);
      return { g, sealM };
    };
    const L = leaf(-1), R = leaf(1);
    const btnM = mat(0x16a34a, { emissive: 0x000000 }), btn = cyl(0.045, 0.03, btnM, 24); btn.rotation.x = Math.PI / 2; btn.position.set(-DOOR.leafW / 2 + 0.12, 1.12, 0.035);
    btn.userData.press = 'open'; R.g.add(btn);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.008, 8, 24), mat(0xd9dde0, { metalness: 0.6 })); ring.position.copy(btn.position); R.g.add(ring);
    // Caisson de porte au-dessus de la baie : capot transparent, mécanisme visible.
    const cover = box(3.0, 0.42, 0.3, new THREE.MeshStandardMaterial({ color: 0xcfe3f1, transparent: true, opacity: 0.16, roughness: 0.1, depthWrite: false })); cover.position.set(0, 2.25, 0.16); root.add(cover);
    const plate = box(3.0, 0.42, 0.01, mat(0x77828c)); plate.position.set(0, 2.25, 0.01); root.add(plate);
    const lamp = box(0.18, 0.06, 0.04, mat(COL.off, { emissive: 0x000000 })); lamp.position.set(0, 2.5, 0.32); root.add(lamp);
    // Vérin : corps à droite, tige vers la gauche, fixée au chariot du vantail gauche.
    const m = cylinderModel({ L: 0.9, S: DOOR.travel, r: 0.034 });
    m.group.position.set(0.05, 2.33, 0.17); root.add(m.group);
    const bracket = box(0.02, 0.33, 0.02, mat(0x48525b, { metalness: 0.5 })); root.add(bracket);
    const name = label(P.label || (e ? e.id : 'A'), 0.07, { bg: '#1f2a33dd' }); name.position.set(0.5, 2.39, 0.2); root.add(name);
    // Capteurs du vérin choisi (ses repères s0 et s1) : piston au fond (porte fermée), piston à l'avant (ouverte).
    const sA0 = P.s0 ? reedSwitch(P.s0, m.r) : null, sA1 = P.s1 ? reedSwitch(P.s1, m.r) : null;
    if (sA0) { sA0.group.position.set(0.05 + 0.8, 2.33, 0.17); root.add(sA0.group); }
    if (sA1) { sA1.group.position.set(0.05 + 0.16, 2.33, 0.17); root.add(sA1.group); }
    // Courroie : deux poulies, brin haut (vantail gauche), brin bas (vantail droit), dents qui défilent.
    const pul = [-1.3, 1.3].map(x => { const p = cyl(DOOR.pulleyR, 0.04, mat(0x9aa4ad, { metalness: 0.6 }), 24); p.rotation.x = Math.PI / 2; p.position.set(x, 2.14, 0.17); root.add(p); const spoke = box(DOOR.pulleyR * 1.8, 0.008, 0.045, mat(0x4b5560)); p.add(spoke); spoke.rotation.x = -Math.PI / 2; return p; });
    const beltM = mat(0x1d2124, { roughness: 0.8 });
    const runT = box(2.6, 0.008, 0.03, beltM); runT.position.set(0, 2.14 + DOOR.pulleyR, 0.17); root.add(runT);
    const runB = box(2.6, 0.008, 0.03, beltM); runB.position.set(0, 2.14 - DOOR.pulleyR, 0.17); root.add(runB);
    const N = 26, teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.012, 0.032), mat(0x3a4045), N * 2); root.add(teeth);
    const clampL = box(0.06, 0.03, 0.04, mat(0xd97706)), clampR = box(0.06, 0.03, 0.04, mat(0xd97706)); root.add(clampL, clampR);
    // Suspentes : du brin haut au vantail gauche, du brin bas au vantail droit (haut des vantaux à 2,0 m).
    const top = 2.14 + DOOR.pulleyR, bot = 2.14 - DOOR.pulleyR;
    const hangL = box(0.02, top - 2.0, 0.02, mat(0x48525b)), hangR = box(0.02, bot - 2.0, 0.02, mat(0x48525b)); root.add(hangL, hangR);
    // Distributeur 5/2 et son électroaimant, tuyaux vers les deux chambres.
    const valve = box(0.2, 0.09, 0.07, mat(0x2f6f9f, { metalness: 0.3 })); valve.position.set(1.25, 2.33, 0.17); root.add(valve);
    const sol = box(0.07, 0.07, 0.07, mat(0x23292e)); sol.position.set(1.12, 2.33, 0.17); root.add(sol);
    const solLed = led(0.01); solLed.position.set(1.12, 2.375, 0.21); root.add(solLed);
    const coilName = cfg.coil || (circuit.elements.find(x => /^v5|^v3/.test(x.type) && x.p && (x.p.coilL || x.p.coil)) || { p: {} }).p.coilL || '';
    if (coilName) { const t = label(coilName, 0.045); t.position.set(1.12, 2.4, 0.2); root.add(t); }
    const tubeRear = tube([[1.2, 2.38, 0.17], [1.1, 2.44, 0.2], [0.95, 2.4, 0.17], [0.89, 2.37, 0.17]]); // chambre arrière (orifice 1)
    const tubeFront = tube([[1.3, 2.38, 0.17], [1.2, 2.45, 0.24], [0.4, 2.45, 0.24], [0.11, 2.37, 0.17]]); // chambre avant (orifice 2)
    // Voyageur dans la baie (obstacle), cliquable.
    const pax = new THREE.Group(), skin = mat(0x6b4226), cloth = mat(0x2a7ab0);
    const legs = box(0.26, 0.8, 0.16, mat(0x2d3640)); legs.position.y = 0.4; pax.add(legs);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 6, 14), cloth); torso.position.y = 1.1; pax.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 14), skin); head.position.y = 1.57; pax.add(head);
    const bag = box(0.2, 0.28, 0.1, mat(COL.accent)); bag.position.set(0.24, 1.0, 0.0); pax.add(bag);
    pax.position.set(0.0, 0, 0.32); pax.visible = false; pax.traverse(o => { o.userData.press = 'obstacle'; }); root.add(pax);
    shadows(root); cover.castShadow = false; cover.receiveShadow = false;
    camera.position.set(1.9, 1.55, 3.9); controls.target.set(0, 1.25, 0.1);
    const pick = [btn, ...pax.children, ...(emg ? [emg.plate, ...emg.h.children] : [])];
    return {
      pick,
      update(st) {
        const x = e ? st.x(e.id) : 0, pose = doorPose(x);
        L.g.position.x = -DOOR.leafW / 2 + pose.left; R.g.position.x = DOOR.leafW / 2 + pose.right;
        const tip = m.setX(x) + 0.05; bracket.position.set(tip, 2.18, 0.17);
        hangL.position.set(-0.55 + pose.left, (top + 2.0) / 2, 0.15); clampL.position.set(-0.55 + pose.left, top, 0.17);
        hangR.position.set(0.55 + pose.right, (bot + 2.0) / 2, 0.15); clampR.position.set(0.55 + pose.right, bot, 0.17);
        pul.forEach(p => { p.rotation.y = pose.pulley; });
        const span = 2.6, pitch = span / N;
        for (let i = 0; i < N; i++) {
          const a = ((i * pitch + pose.left) % span + span) % span - span / 2, b = ((i * pitch + pose.right) % span + span) % span - span / 2;
          mtx.makeTranslation(a, 2.14 + DOOR.pulleyR + 0.009, 0.17); teeth.setMatrixAt(i, mtx);
          mtx.makeTranslation(b, 2.14 - DOOR.pulleyR - 0.009, 0.17); teeth.setMatrixAt(N + i, mtx);
        }
        teeth.instanceMatrix.needsUpdate = true;
        if (sA0) setLed(sA0.led, COL.on, st.sensor(P.s0));
        if (sA1) setLed(sA1.led, COL.on, st.sensor(P.s1));
        setLed(solLed, COL.amber, coilName ? st.coil(coilName) : false);
        if (e) { tubeRear.material.color.setHex(pressColor(st.press(e.id, '1'))); tubeFront.material.color.setHex(pressColor(st.press(e.id, '2'))); m.fittings[1].material.color.copy(tubeRear.material.color); m.fittings[0].material.color.copy(tubeFront.material.color); }
        // Voyant de porte : vert ouverte, orange clignotant en mouvement, éteint fermée.
        const moving = x > 0.02 && x < 0.98, blink = Math.floor((st.t || 0) * 3) % 2 === 0;
        const lc = x >= 0.98 ? COL.on : moving && blink ? COL.amber : null;
        lamp.material.color.setHex(lc || COL.off); lamp.material.emissive.setHex(lc || 0); lamp.material.emissiveIntensity = lc ? 1.2 : 0;
        const obs = st.role('obstacle');
        pax.visible = obs; L.sealM.color.setHex(obs ? COL.red : 0x16191c); R.sealM.color.setHex(obs ? COL.red : 0x16191c);
        const pressed = st.role('open');
        btnM.emissive.setHex(pressed ? 0x22c55e : 0x000000); btnM.emissiveIntensity = pressed ? 0.9 : 0; btn.position.z = pressed ? 0.026 : 0.035;
        if (emg) { const on = st.role('emergency'); emg.h.rotation.x = on ? -1.0 : 0; setLed(emg.led, COL.red, on); } // poignée tirée, voyant rouge
      }
    };
  }

  /* ---------- Presse de marquage ---------- */
  // Presse d'établi en col de cygne : le vérin, vertical au-dessus du bras, descend le coulisseau et son poinçon sur
  // la pièce posée sur l'enclume. Devant, le pupitre de commande à deux mains (deux boutons coup-de-poing éloignés).
  function buildPress(circuit, cfg) {
    bench(1.5, 0.95);
    const e = cylOf(circuit, cfg.cyl), S = 0.2, top = 0.25, yc = top + S + 0.225; // dessus de la pièce, nez du vérin
    const frameM = mat(0x41607a, { metalness: 0.3 }), steel = mat(0x8d969e, { metalness: 0.6, roughness: 0.35 }), toolM = mat(0xd97706, { metalness: 0.2 });
    put(box(0.4, 0.03, 0.44, frameM), 0, 0.015, -0.03);
    put(box(0.14, yc - 0.03, 0.09, frameM), 0, yc / 2, -0.2);
    put(box(0.16, 0.07, 0.36, frameM), 0, yc - 0.035, -0.065);
    put(box(0.13, top - 0.05, 0.13, steel), 0, 0.03 + (top - 0.05) / 2, 0.04); // enclume
    // Pièce : plaquette d'aluminium ; marque frappée (cercle sombre, étoile dorée).
    const blank = marked => {
      const g = new THREE.Group(); g.add(box(0.15, 0.02, 0.1, mat(0xd5dade, { metalness: 0.5, roughness: 0.3 })));
      const m1 = put(cyl(0.032, 0.003, mat(0x2b3036), 24), 0, 0.0105, 0, g), m2 = put(cyl(0.018, 0.004, mat(COL.stripe, { metalness: 0.4 }), 5), 0, 0.011, 0, g);
      m1.visible = m2.visible = marked; g.userData.mark = [m1, m2]; return g;
    };
    const part = put(blank(false), 0, top - 0.01, 0.04), [mk1, mk2] = part.userData.mark;
    // Pièces brutes à gauche, pièces marquées à droite (cinq au plus).
    put(box(0.2, 0.008, 0.15, steel), -0.45, 0.004, 0.1); put(box(0.2, 0.008, 0.15, steel), 0.45, 0.004, 0.1);
    for (let i = 0; i < 4; i++) put(blank(false), -0.45, 0.018 + i * 0.021, 0.1).rotation.y = (i % 2) * 0.08;
    const done = []; for (let i = 0; i < 5; i++) { const d = put(blank(true), 0.45, 0.018 + i * 0.021, 0.1); d.rotation.y = (i % 2) * 0.08; d.visible = false; done.push(d); }
    // Coulisseau (orange : ce qui bouge) et poinçon.
    const ram = new THREE.Group(); put(cyl(0.02, 0.055, mat(0x4b5560, { metalness: 0.7, roughness: 0.3 }), 20), 0, 0.0275, 0, ram); put(box(0.09, 0.05, 0.09, toolM), 0, 0.08, 0, ram); put(ram, 0, top + S, 0.04);
    // Protecteur transparent autour de l'outil, liseré jaune.
    ghost(put(box(0.36, 0.34, 0.3, glass()), 0, 0.2, 0.07)); put(box(0.37, 0.016, 0.012, mat(COL.stripe)), 0, 0.04, 0.222);
    // Pupitre de commande à deux mains.
    put(box(0.86, 0.06, 0.15, mat(COL.dark)), 0, 0.03, 0.38); put(box(0.86, 0.005, 0.15, mat(COL.stripe, { roughness: 0.7 })), 0, 0.0625, 0.38);
    const bl = pushBtn('left', 0.05), br = pushBtn('right', 0.05); put(bl.g, -0.32, 0.065, 0.38); put(br.g, 0.32, 0.065, 0.38);
    const c = mount(e, { L: 0.34, S, r: 0.04, rodR: 0.014, at: [0, yc, 0.04], rod: [0, -1, 0], up: [1, 0, 0], sens: [0, 0, 1], tag: [-0.13, -0.022, 0.05], name: [0, yc + 0.37, 0.04], valve: [0.15, 0.36, -0.2], via: [[[0.13, 0.6, -0.1]], [[0.2, 0.7, -0.1]]] });
    shadows(root);
    camera.position.set(0.86, 0.9, 1.62); controls.target.set(0, 0.5, 0.06);
    const w = { done: false, back: false, n: 0 };
    return {
      pick: [bl.cap, br.cap], near: 0.6,
      update(st) {
        const x = c.x(st); ram.position.y = top + S * (1 - x);
        workStep(w, x, x, st.running); mk1.visible = mk2.visible = w.done;
        for (let i = 0; i < done.length; i++) done[i].visible = i < w.n;
        bl.set(st.role('left')); br.set(st.role('right'));
      }
    };
  }

  /* ---------- Poste de serrage et perçage ---------- */
  // Le vérin de serrage, horizontal, pousse un mors qui tient la pièce contre la butée fixe ; le vérin de perçage,
  // vertical, descend l'unité de perçage (moteur, mandrin, foret) le long de sa colonne. Cycle A+ B+ B− A−.
  function buildStation(circuit, cfg) {
    bench(1.5, 0.9);
    const eA = cylOf(circuit, cfg.clamp, 0), eB = cylOf(circuit, cfg.drill, 1), SA = 0.1, SB = 0.12, topP = 0.092, yb = topP + 0.07 + 0.39; // nez du vérin de perçage
    const frameM = mat(0x41607a, { metalness: 0.3 }), steel = mat(0x8d969e, { metalness: 0.6, roughness: 0.35 }), toolM = mat(0xd97706, { metalness: 0.2 }), dark = mat(0x4b5560, { metalness: 0.7, roughness: 0.3 });
    put(box(0.66, 0.012, 0.18, steel), -0.14, 0.006, 0); // glissière
    put(box(0.05, 0.075, 0.16, frameM), 0.085, 0.0375, 0); // butée fixe
    // Pièce : bloc d'aluminium ; trou percé (visible une fois le foret remonté).
    const block = holed => { const g = new THREE.Group(); g.add(box(0.12, 0.08, 0.1, mat(0xd5dade, { metalness: 0.5, roughness: 0.3 }))); const h = put(cyl(0.022, 0.003, mat(0x15181b), 20), 0, 0.0405, 0, g); h.visible = holed; g.userData.hole = h; return g; };
    const part = put(block(false), 0, 0.052, 0), hole = part.userData.hole;
    put(box(0.3, 0.008, 0.16, steel), 0.4, 0.004, 0.05);
    const done = []; for (let i = 0; i < 3; i++) { const d = put(block(true), 0.4 + (i % 2) * 0.012, 0.048 + i * 0.081, 0.05); d.visible = false; done.push(d); }
    // Mors mobile (orange) au bout de la tige du vérin de serrage.
    const jaw = put(box(0.03, 0.1, 0.13, toolM), -0.175, 0.062, 0);
    for (const x of [-0.34, -0.58]) put(box(0.05, 0.03, 0.09, frameM), x, 0.027, 0);
    const cA = mount(eA, { L: 0.3, S: SA, r: 0.032, at: [-0.31, 0.062, 0], rod: [1, 0, 0], up: [0, 1, 0], name: [-0.46, 0.2, 0], valve: [-0.5, 0.035, -0.3], via: [[[-0.4, 0.2, -0.16]], [[-0.56, 0.2, -0.16]]] });
    // Colonne, console du vérin, unité de perçage qui coulisse (origine : pointe du foret).
    put(box(0.09, yb, 0.09, frameM), 0, yb / 2, -0.2); put(box(0.12, 0.04, 0.3, frameM), 0, yb - 0.02, -0.07);
    const head = new THREE.Group(), spin = new THREE.Group();
    put(cyl(0.014, 0.08, dark, 12), 0, 0.04, 0, spin); put(box(0.036, 0.06, 0.004, steel), 0, 0.04, 0, spin); // foret et ses goujures
    put(cyl(0.024, 0.05, dark, 16), 0, 0.105, 0, spin); for (const a of [0, 1, 2]) put(box(0.012, 0.03, 0.008, steel), Math.cos(a * 2.094) * 0.022, 0.1, Math.sin(a * 2.094) * 0.022, spin).rotation.y = -a * 2.094; // mandrin, mors
    head.add(spin); put(cyl(0.05, 0.14, mat(0x5d7f99, { metalness: 0.4 }), 24), 0, 0.2, 0, head); put(box(0.1, 0.12, 0.17, toolM), 0, 0.2, -0.105, head);
    put(head, 0, topP + 0.07, 0);
    const cB = mount(eB, { L: 0.26, S: SB, r: 0.032, at: [0, yb, 0], rod: [0, -1, 0], up: [1, 0, 0], sens: [0, 0, 1], tag: [-0.11, -0.022, 0.04], name: [0, yb + 0.29, 0], valve: [0.125, 0.3, -0.2], via: [[[0.11, 0.5, -0.1]], [[0.17, 0.6, -0.1]]] });
    // Départ cycle : boîte à bouton devant le poste.
    put(box(0.14, 0.05, 0.1, mat(COL.dark)), 0.22, 0.025, 0.3); const start = pushBtn('start', 0.032); put(start.g, 0.22, 0.05, 0.3);
    const warn = label(tl('Pièce non serrée !'), 0.07, { bg: '#b91c1cee', color: '#fff' }); warn.position.set(0.02, 0.26, 0.12); warn.visible = false; root.add(warn);
    shadows(root);
    camera.position.set(0.3, 0.9, 1.72); controls.target.set(-0.15, 0.34, 0);
    const w = { done: false, back: false, n: 0 };
    return {
      pick: [start.cap], near: 0.6,
      update(st) {
        const a = cA.x(st), b = cB.x(st);
        jaw.position.x = -0.075 - SA * (1 - a); head.position.y = topP + 0.07 - SB * b;
        if (st.running && b > 0.02) spin.rotation.y = (st.t * 28) % (Math.PI * 2);
        workStep(w, b, a, st.running); hole.visible = w.done;
        for (let i = 0; i < done.length; i++) done[i].visible = i < w.n;
        warn.visible = st.running && b > 0.6 && a < 0.98; // le foret entre dans une pièce qui n'est pas tenue
        start.set(st.role('start'));
      }
    };
  }

  /* ---------- Pantographe ---------- */
  // Toit d'une voiture de train électrique : châssis sur isolateurs, bras inférieur, bras supérieur, archet et ses
  // bandes de carbone ; au-dessus, la caténaire (fil de contact, porteur, pendules). L'air comprimé lève le
  // pantographe (vérin, biellette, manivelle du bras inférieur) ; à l'échappement, ressort et poids le replient.
  function buildPanto(circuit, cfg) {
    scene.background = skyTex;
    const e = cylOf(circuit, cfg.cyl), K = PANTO, AX = -0.5, AY = 0.36, ZC = 0.44, yw = AY + K.wire;
    const red = mat(0xb9261c, { roughness: 0.45 }), steel = mat(0x8d969e, { metalness: 0.6, roughness: 0.35 }), frameM = mat(0x4b5560, { metalness: 0.5 }), insM = mat(0x8a4b32, { roughness: 0.35 }), copper = mat(0xb87333, { metalness: 0.7, roughness: 0.35 });
    // Voiture : toit bombé, caisse (bandeau vitré, bande verte, filet jaune), bogies, voie.
    const roof = cyl(1.4, 5.6, mat(0x9fa8ae, { roughness: 0.7 }), 40); roof.rotation.z = Math.PI / 2; roof.scale.x = 0.22; put(roof, 0, -0.308, 0);
    put(box(5.6, 2.5, 2.8, mat(COL.body, { roughness: 0.4 })), 0, -1.558, 0);
    for (const sz of [-1, 1]) { put(box(5.6, 0.75, 0.012, mat(COL.glass, { roughness: 0.1, metalness: 0.3 })), 0, -1.1, sz * 1.406); put(box(5.6, 0.3, 0.012, mat(COL.band)), 0, -2.6, sz * 1.406); put(box(5.6, 0.05, 0.012, mat(COL.stripe)), 0, -0.52, sz * 1.406); put(box(5.6, 0.018, 0.012, mat(COL.accent)), 0, -0.57, sz * 1.406); }
    for (const x of [-1.6, 1.6]) put(box(2.0, 0.7, 2.3, mat(COL.dark)), x, -3.16, 0);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat(0x8f8a80, { roughness: 0.95 })); ground.rotation.x = -Math.PI / 2; put(ground, 0, -3.75, 0);
    for (const sz of [-1, 1]) put(box(14, 0.12, 0.07, steel), 0, -3.69, sz * 0.72);
    put(box(1.3, 0.24, 1.5, mat(0xc9d0d6, { metalness: 0.3 })), 1.95, 0.06, 0); // groupe de climatisation
    // Châssis sur quatre isolateurs.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { put(cyl(0.03, 0.28, insM, 12), sx * 0.62, 0.11, sz * 0.4); for (const y of [0.04, 0.12, 0.2]) put(cyl(0.06, 0.03, insM, 16), sx * 0.62, y, sz * 0.4); }
    for (const sz of [-1, 1]) put(box(1.4, 0.05, 0.05, frameM), 0, 0.275, sz * 0.4);
    for (const x of [-0.62, AX, 0.62]) put(box(0.05, 0.05, 0.85, frameM), x, 0.275, 0);
    for (const z of [-0.3, 0.3]) put(box(0.09, 0.09, 0.05, frameM), AX, 0.33, z);
    // Bras inférieur : tube, arbre, manivelle (du côté du vérin).
    const lo = new THREE.Group(); put(lo, AX, AY, 0);
    put(cyl(0.035, K.l1, red, 16), K.l1 / 2, 0, 0, lo).rotation.z = Math.PI / 2;
    put(cyl(0.025, 0.96, steel, 14), 0, 0, 0.04, lo).rotation.x = Math.PI / 2;
    put(cyl(0.05, 0.22, red, 16), K.l1, 0, 0, lo).rotation.x = Math.PI / 2; // articulation du coude
    const crank = new THREE.Group(); crank.rotation.z = K.lead; put(crank, 0, 0, ZC, lo); put(box(K.crank + 0.04, 0.04, 0.02, red), K.crank / 2, 0, 0, crank);
    put(box(0.05, 0.04, 0.03, red), 0.38, 0.04, -0.15, lo); // patte du ressort
    // Bras supérieur : deux tubes du coude à l'archet, talon où s'accroche le tirant.
    const up = new THREE.Group(); root.add(up);
    for (const sz of [-1, 1]) { const d = V(K.l2, 0, sz * 0.2), t = cyl(0.022, d.length(), red, 12); t.quaternion.setFromUnitVectors(V(0, 1, 0), d.clone().normalize()); put(t, K.l2 / 2, 0, sz * 0.17, up); }
    put(box(0.12, 0.03, 0.02, red), -0.05, 0, 0.12, up);
    const tie = put(cyl(0.012, 1, steel, 8), 0, 0, 0.12); // tirant : du châssis au talon du bras supérieur
    // Archet : traverse, deux bandes de carbone sur leurs porte-bandes, cornes rabattues.
    const hd = new THREE.Group(); root.add(hd);
    put(cyl(0.022, 0.6, red, 12), 0, 0, 0, hd).rotation.x = Math.PI / 2;
    for (const z of [-0.2, 0.2]) put(box(0.3, 0.02, 0.03, steel), 0, 0.03, z, hd);
    for (const x of [-0.13, 0.13]) {
      put(box(0.06, 0.025, 1.16, steel), x, K.top - 0.0375, 0, hd); put(box(0.045, 0.025, 1.0, mat(0x17191b, { roughness: 0.7 })), x, K.top - 0.0125, 0, hd);
      for (const sz of [-1, 1]) put(box(0.05, 0.02, 0.26, steel), x, K.top - 0.105, sz * 0.68, hd).rotation.x = sz * 0.62;
    }
    // Vérin sur ses supports, biellette jusqu'au maneton ; ressort de rappel entre le châssis et le bras inférieur.
    const cy = AY + K.cylY, c = mount(e, { L: K.stroke + 0.16, S: K.stroke, r: 0.04, rodR: 0.014, at: [AX + K.t0 + 0.1, cy, ZC], rod: [-1, 0, 0], up: [0, 1, 0], name: [AX + K.t0 + 0.1 + (K.stroke + 0.16) / 2, cy + 0.17, ZC], nameH: 0.12, tagH: 0.07, ledR: 0.018, valve: [0.45, 0.335, 0.4], via: [[[0.2, cy + 0.12, ZC + 0.14]], [[0.36, cy + 0.1, ZC + 0.12]]] });
    for (const x of [0.03, K.stroke + 0.13]) put(box(0.05, cy - 0.04 - 0.3, 0.08, frameM), AX + K.t0 + 0.1 + x, (cy - 0.04 + 0.3) / 2, ZC);
    const link = put(box(K.link, 0.024, 0.016, steel), 0, 0, ZC + 0.03), pin = put(cyl(0.014, 0.07, steel, 10), 0, 0, ZC + 0.015); pin.rotation.x = Math.PI / 2;
    const hx = []; for (let i = 0; i <= 108; i++) hx.push(V(Math.cos(i * Math.PI / 6) * 0.03, i / 108, Math.sin(i * Math.PI / 6) * 0.03));
    const spr = put(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hx), 160, 0.006, 6, false), steel), AX + 0.62, 0.3, -0.15);
    // Caténaire : fil de contact, porteur en chaînette, pendules ; poteau et console au bord de la voie.
    const XM = 1.0, ym = x => yw + 0.55 - 0.25 * (1 - (1 - Math.min(1, Math.abs(x - XM) / 6.2)) ** 2);
    put(cyl(0.014, 7.4, copper, 10), 0, yw + 0.014, 0).rotation.z = Math.PI / 2;
    const mp = []; for (let x = -3.7; x <= 3.71; x += 0.37) mp.push(V(x, ym(x), 0));
    put(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mp), 40, 0.011, 6, false), copper), 0, 0, 0);
    for (const x of [-2.6, -1.4, 0.3, 1.5]) put(cyl(0.006, ym(x) - yw, copper, 6), x, (ym(x) + yw) / 2, 0);
    put(box(0.16, yw + 0.85 + 3.75, 0.16, frameM), XM, (yw + 0.85 - 3.75) / 2, -2.4);
    put(cyl(0.025, 2.45, steel, 10), XM, ym(XM) + 0.02, -1.2).rotation.x = Math.PI / 2; put(cyl(0.02, 2.45, steel, 10), XM, yw + 0.3, -1.2).rotation.x = Math.PI / 2;
    put(cyl(0.008, 0.3, steel, 6), XM, yw + 0.16, 0);
    for (const y of [ym(XM) + 0.02, yw + 0.3]) for (const z of [-2.1, -2.0, -1.9]) put(cyl(0.06, 0.03, insM, 14), XM, y, z).rotation.x = Math.PI / 2;
    // Mise sous tension : halo au contact, repère ; pupitre du conducteur sur le flanc (levier, voyant).
    const glow = ghost(put(new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffe08a })), AX + K.dx, yw, 0)); glow.visible = false;
    const live = label(tl('Sous tension'), 0.15, { bg: '#f59e0bee', color: '#161a1d' }); live.position.set(AX + K.dx, yw + 0.12, 0); live.visible = false; root.add(live);
    const panel = put(box(0.46, 0.2, 0.3, mat(COL.stripe, { roughness: 0.6 })), 1.0, 0.09, 0.45); panel.userData.press = 'up';
    const lever = new THREE.Group(), knob = put(box(0.05, 0.2, 0.05, mat(COL.red)), 0, 0.1, 0, lever); knob.userData.press = 'up'; put(cyl(0.04, 0.06, mat(COL.dark), 16), 0, 0.03, 0, lever).userData.press = 'up'; put(lever, 0.9, 0.19, 0.45);
    const lamp = led(0.05); put(lamp, 1.12, 0.21, 0.45);
    shadows(root);
    camera.position.set(1.95, 1.5, 3.55); controls.target.set(-0.25, 0.95, 0);
    const pose = {};
    return {
      pick: [panel, ...lever.children], near: 1.5,
      update(st) {
        const x = c.x(st), p = pantoPose(x, pose), ex = AX + p.ex, ey = AY + p.ey;
        lo.rotation.z = p.a; up.position.set(ex, ey, 0); up.rotation.z = Math.PI - p.b; hd.position.set(AX + p.hx, AY + p.hy, 0);
        // Tirant : du châssis au talon du bras supérieur (0,1 m au-delà du coude).
        const gx = AX + 0.12, gy = AY - 0.05, qx = ex + 0.1 * Math.cos(p.b), qy = ey - 0.1 * Math.sin(p.b);
        tie.position.set((gx + qx) / 2, (gy + qy) / 2, 0.12); tie.scale.y = Math.hypot(qx - gx, qy - gy); tie.rotation.z = Math.atan2(qy - gy, qx - gx) - Math.PI / 2;
        // Biellette : du nez de tige au maneton.
        const tx = AX + p.tx, px = AX + p.px, py = AY + p.py;
        link.position.set((tx + px) / 2, (cy + py) / 2, ZC + 0.03); link.rotation.z = Math.atan2(py - cy, px - tx); pin.position.set(px, py, ZC + 0.015);
        // Ressort : il s'allonge quand le bras se lève.
        const sx = AX + 0.38 * Math.cos(p.a) - 0.04 * Math.sin(p.a), sy = AY + 0.38 * Math.sin(p.a) + 0.04 * Math.cos(p.a), bx = AX + 0.62, by = 0.3;
        spr.scale.y = Math.hypot(sx - bx, sy - by); spr.rotation.z = Math.atan2(sy - by, sx - bx) - Math.PI / 2;
        const on = st.running && x >= 0.98;
        glow.visible = live.visible = on; setLed(lamp, COL.amber, on);
        lever.rotation.z = st.role('up') ? -0.6 : 0.6; // levier vers la droite : lever
      }
    };
  }

  /* ---------- Convoyeur de tri ---------- */
  // Le tapis emporte les colis de gauche à droite. Juste avant le poussoir, une cellule photoélectrique : un colis
  // qui coupe son faisceau tient le rôle « detect » appuyé. Le vérin, en travers, pousse le colis dans la goulotte et
  // le bac de côté ; un colis qui n'est pas poussé tombe dans le bac du bout. Les colis avancent avec le temps de la
  // simulation ; à l'arrêt, un colis attend au début du tapis.
  function buildSorter(circuit, cfg) {
    workshopFloor(0);
    const e = cylOf(circuit, cfg.cyl), K = SORT, BY = 0.8, HB = 0.16, len = K.x1 - K.x0, mid = (K.x0 + K.x1) / 2, pc = (K.plate[0] + K.plate[1]) / 2, yb = BY + 0.085, cx = pc + 0.1;
    const steel = mat(0x8d969e, { metalness: 0.6, roughness: 0.35 }), legM = mat(0x59636c, { metalness: 0.4 }), alu = mat(COL.alu, { metalness: 0.6, roughness: 0.35 }), toolM = mat(0xd97706, { metalness: 0.2 });
    // Tapis, longerons, pieds, tambours ; barrettes qui défilent.
    put(box(len, 0.1, K.half * 2 - 0.03, mat(0x1d2124, { roughness: 0.85 })), mid, BY - 0.05, 0);
    for (const sz of [-1, 1]) { put(box(len - 0.06, 0.1, 0.03, alu), mid, BY - 0.056, sz * (K.half + 0.005)); for (const x of [K.x0 + 0.2, K.x1 - 0.2]) put(box(0.05, BY - 0.1, 0.05, legM), x, (BY - 0.1) / 2, sz * K.half); }
    const drums = [K.x0, K.x1].map(x => { const d = put(cyl(0.05, K.half * 2 - 0.02, steel, 24), x, BY - 0.05, 0); d.rotation.x = Math.PI / 2; d.add(box(0.103, K.half * 2 - 0.014, 0.008, legM)); return d; });
    const NS = 16, pitch = len / NS, bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.004, K.half * 2 - 0.05), mat(0x3a4045), NS); root.add(bars);
    // Cellule : émetteur devant, récepteur derrière, faisceau rouge.
    for (const sz of [-1, 1]) { put(box(0.03, 0.2, 0.03, legM), K.beam, BY, sz * 0.25); put(box(0.045, 0.06, 0.06, mat(COL.stripe)), K.beam, yb, sz * 0.25); }
    const cellLed = led(0.016); put(cellLed, K.beam, yb + 0.045, -0.25);
    const beam = ghost(put(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 })), K.beam, yb, 0)); beam.rotation.x = Math.PI / 2;
    // Poussoir (orange) et son vérin, en travers du tapis, sur une tablette derrière.
    const plate = put(box(K.plate[1] - K.plate[0], 0.13, 0.02, toolM), pc, BY + 0.075, pusherZ(0) - 0.01);
    const c = mount(e, { L: K.stroke + 0.12, S: K.stroke, r: 0.04, rodR: 0.014, at: [pc, BY + 0.075, pusherZ(0) - 0.14], rod: [0, 0, 1], up: [0, 1, 0], name: [pc - 0.2, BY + 0.2, -0.6], nameH: 0.12, tagH: 0.075, ledR: 0.016, valve: [pc + 0.4, BY + 0.075, -0.55], via: [[[pc + 0.3, BY + 0.26, -0.45]], [[pc + 0.3, BY + 0.26, -0.7]]] });
    put(box(0.78, 0.02, 0.58, steel), pc + 0.2, BY + 0.019, -0.55); for (const x of [-0.14, 0.54]) put(box(0.04, BY + 0.02, 0.04, legM), pc + x, (BY + 0.02) / 2, -0.8);
    // Goulotte et bac de côté (bleu) ; bac du bout (gris).
    const chute = put(box(0.8, 0.015, 0.48, steel), cx, BY - 0.135, 0.425); chute.rotation.x = 0.52;
    for (const sx of [-1, 1]) put(box(0.015, 0.09, 0.48, steel), cx + sx * 0.4, BY - 0.1, 0.425).rotation.x = 0.52;
    const crate = (x, z, w, d, h, m) => { put(box(w, 0.02, d, m), x, 0.01, z); for (const s of [-1, 1]) { put(box(0.015, h, d, m), x + s * w / 2, h / 2, z); put(box(w, h, 0.015, m), x, h / 2, z + s * d / 2); } };
    const SIDE = [cx, 0.92], END = [K.x1 + 0.4, 0];
    crate(SIDE[0], SIDE[1], 0.74, 0.5, 0.36, mat(0x2f6f9f, { roughness: 0.6 })); crate(END[0], END[1], 0.5, 0.56, 0.36, mat(0x6b7680, { roughness: 0.6 }));
    // Bouton « envoyer un colis » sur sa colonne, près du début du tapis.
    put(box(0.05, 0.95, 0.05, legM), K.x0 + 0.12, 0.475, 0.48); put(box(0.16, 0.08, 0.12, mat(COL.dark)), K.x0 + 0.12, 0.99, 0.48);
    const send = pushBtn('send', 0.04); put(send.g, K.x0 + 0.12, 1.03, 0.48);
    // Colis : réserve de cartons (s : 0 rangé, 1 sur le tapis, 2 dans la goulotte, 3 en bout de tapis, 4 dans un bac).
    const cardM = mat(0xb98a56, { roughness: 0.8 }), tapeM = mat(0xe0c896, { roughness: 0.6 }), bg = new THREE.BoxGeometry(K.len, HB, K.depth), tg = new THREE.BoxGeometry(K.len + 0.002, HB + 0.002, 0.035);
    const bs = []; for (let i = 0; i < 14; i++) { const g = new THREE.Group(); g.add(new THREE.Mesh(bg, cardM), new THREE.Mesh(tg, tapeM)); g.visible = false; root.add(g); bs.push({ g, s: 0, x: 0, z: 0, drop: 0, u: 0, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, bin: 0 }); }
    const X0 = K.x0 + 0.17, belt = [], count = [0, 0]; let want = 0, tLast = 0, lit = 0;
    const byX = (a, b) => b.x - a.x;
    function spawn() { const b = bs.find(q => q.s === 0); if (!b) return false; b.s = 1; b.x = X0; b.z = 0; b.drop = 0.12; return true; }
    function reset(t) { for (const b of bs) b.s = 0; count[0] = count[1] = 0; want = 0; tLast = t; spawn(); bs[0].drop = 0; }
    /** Un colis quitte le tapis : vers le bac k (0 côté, 1 bout), à la place suivante (bac plein : il est vidé). */
    function leave(b, k) {
      if (count[k] && count[k] % 4 === 0) for (const q of bs) if (q.s === 4 && q.bin === k) q.s = 0;
      const n = count[k]++ % 4, o = (n % 2 ? 1 : -1);
      b.s = 2 + k; b.u = 0; b.bin = k; b.fx = b.x; b.fy = BY + HB / 2; b.fz = b.z;
      b.tx = k ? END[0] : SIDE[0] + o * 0.17; b.tz = k ? o * 0.13 : SIDE[1]; b.ty = 0.02 + HB / 2 + (n > 1 ? HB : 0);
    }
    function step(dt, pz) {
      belt.length = 0; for (const b of bs) if (b.s === 1) belt.push(b);
      belt.sort(byX);
      for (let i = 0; i < belt.length; i++) {
        const b = belt[i], a = i ? belt[i - 1] : null, r = sortStep(b, dt, pz, a && Math.abs(a.z - b.z) < K.depth ? a.x - K.len - 0.01 : Infinity);
        b.drop = Math.max(0, b.drop - dt * 0.7);
        if (r) leave(b, r === 1 ? 0 : 1);
      }
      for (const b of bs) if (b.s === 2 || b.s === 3) { b.u += dt / (b.s === 2 ? 0.4 : 0.5); if (b.u >= (b.s === 2 ? 2 : 1)) b.s = 4; }
      if (want && !belt.some(b => b.x < X0 + K.len + 0.04) && spawn()) want--;
    }
    shadows(root);
    camera.position.set(1.55, 1.95, 2.95); controls.target.set(0.3, 0.56, 0.2);
    reset(0);
    return {
      pick: [send.cap],
      act(role) { if (role === 'send') { want = Math.min(3, want + 1); lit = performance.now(); } },
      update(st) {
        const x = c.x(st), pz = pusherZ(x);
        plate.position.z = pz - 0.01;
        if (!st.running || st.t < tLast) reset(st.t || 0);
        const dt = st.running ? Math.min(0.5, st.t - tLast) : 0; tLast = st.t || 0;
        for (let n = Math.ceil(dt / 0.04), k = 0; k < n; k++) step(dt / n, pz);
        // Colis : sur le tapis, dans la goulotte (glisse puis tombe), en bout de tapis (bascule et tombe), dans un bac.
        let cut = null;
        for (const b of bs) {
          const g = b.g; g.visible = b.s > 0; if (!b.s) continue;
          g.rotation.set(0, 0, 0);
          if (b.s === 1) { g.position.set(b.x, BY + HB / 2 + b.drop, b.z); if (Math.abs(b.x - K.beam) < K.len / 2 && b.drop < 0.02 && (!cut || b.z > cut.z)) cut = b; }
          else if (b.s === 2) {
            const u = Math.min(1, b.u), v = Math.max(0, b.u - 1), my = BY - 0.2 + HB / 2;
            g.position.set(b.fx + (b.tx - b.fx) * v, v ? my + (b.ty - my) * v * v : b.fy + (my - b.fy) * u, v ? 0.66 + (b.tz - 0.66) * v : b.fz + (0.66 - b.fz) * u);
            g.rotation.x = 0.52 * Math.min(1, b.u * 3) * (1 - v);
          } else if (b.s === 3) { const u = b.u; g.position.set(b.fx + (b.tx - b.fx) * u, b.fy + (b.ty - b.fy) * u * u, b.fz + (b.tz - b.fz) * u); g.rotation.z = -Math.sin(u * Math.PI) * 0.6; }
          else g.position.set(b.tx, b.ty, b.tz);
        }
        hold('detect', st.running && !!cut);
        // Faisceau : de l'émetteur (devant) au récepteur, ou jusqu'au colis qui le coupe.
        const z1 = cut ? cut.z + K.depth / 2 : -0.225; beam.scale.y = Math.max(0.001, 0.225 - z1); beam.position.z = (0.225 + z1) / 2;
        setLed(cellLed, COL.amber, !!cut);
        const off = st.running ? (st.t * K.speed) % len : 0;
        for (let i = 0; i < NS; i++) { mtx.makeTranslation(K.x0 + (i * pitch + off) % len, BY + 0.002, 0); bars.setMatrixAt(i, mtx); }
        bars.instanceMatrix.needsUpdate = true;
        for (const d of drums) d.rotation.y = -(st.running ? st.t * K.speed : 0) / 0.05;
        send.set(st.role('send') || performance.now() - lit < 250);
      }
    };
  }

  /* ---------- Clic : boutons et commandes de la scène ---------- */
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let down = null;
  canvas.addEventListener('pointerdown', ev => {
    if (!S || !S.pick || ev.button !== 0) return;
    const r = canvas.getBoundingClientRect(); ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(S.pick, true).find(h => h.object.userData.press);
    if (!hit) return;
    down = hit.object.userData.press; controls.enabled = false; api.press(down, true); ask();
  });
  const onUp = () => { if (!down) return; api.press(down, false); down = null; controls.enabled = true; ask(); };
  addEventListener('pointerup', onUp);
  const BUILD = { door: buildDoor, bus: buildDoor, press: buildPress, station: buildStation, pantograph: buildPanto, sorter: buildSorter };

  return {
    /** Construit la scène (config : circuit.scene, { kind, skin, vérins et commandes des rôles de SCENES, coil }). */
    build(config, circuit) {
      release(); clear(); kind = sceneId(config);
      S = (BUILD[kind] || buildCylinders)(circuit, config);
      controls.minDistance = S.near || 1; resize(); ask();
    },
    update(st) { if (!S) return; seen = performance.now(); S.update(st); if (!st.running) release(); ask(); },
    /** Action d'une commande 'click' (envoyer un colis). */
    act(role) { if (S && S.act) { S.act(role); ask(); } },
    kind: () => kind,
    resize,
    dispose() { release(); removeEventListener('pointerup', onUp); if (ro) ro.disconnect(); clear(); S = null; controls.dispose(); renderer.dispose(); skyTex.dispose(); canvas.remove(); }
  };
}
