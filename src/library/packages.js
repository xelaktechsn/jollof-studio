// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Registre des composants en paquet (.jpart) : installe un paquet vérifié dans la bibliothèque de l'application
// (LIBRARY et BY_ID avec son modèle 3D, fiche de câblage, modèle de capteur, documentation, sources, symbole du
// schéma), le retire, et le garde (octets d'origine) pour l'enregistrer avec les projets qui l'utilisent. Le
// modèle 3D vient du model.glb du paquet, de son dessin look.svg posé sur une plaquette, ou d'une forme simple
// (module, bloc, LED, résistance) dessinée ici d'après le manifeste : jamais de code venu du paquet.
import * as THREE from 'three';
import { LIBRARY, BY_ID, MINE } from './catalog.js';
import { M, V3, mat, block, cyl, dome, text, board, add, boxGeo, canvasTex } from './kit.js';
import { stdMat } from '../quality.js';
import { PKG_SYMBOLS } from '../schematic/sheet.js';
import { unpackJpart, validateManifest, registerSim, unregisterSim, toB64, fromB64, LED_COLORS } from './jpart.js';
import { pkgOhms } from '../sim/pkgparts.js';
import { tl, DEC } from '../i18n/index.js';

/** type → { manifest, glb, symbol, svg, bytes, template, saved, standard } */
const STORE = new Map();
export const installed = () => [...STORE.values()].map(p => p.manifest);
export const packageOf = type => STORE.get(type) || null;
export const isInstalled = type => STORE.has(type);
/** Composant standard : livré avec l'application (src/library/standard), rangé dans sa catégorie. */
export const isStandard = type => { const p = STORE.get(type); return !!(p && p.standard); };

/* ---------- Modèle 3D ---------- */
const GLOW = { '#d8322f': 0xff2a1a, '#2fbf5a': 0x30ff70, '#2f6fe0': 0x3080ff, '#f2c94c': 0xffd030, '#f2f2ee': 0xffffff, '#f28c28': 0xff9a30 };
const BAND = { 0: 0x111111, 1: 0x6b3a1e, 2: 0xc0302a, 3: 0xe07a1f, 4: 0xe8c33a, 5: 0x2e9e4f, 6: 0x2f62d8, 7: 0x7a3fb0, 8: 0x888888, 9: 0xf2f2f2, g: 0xc9a24a };
const PIN_DOT = new THREE.SphereGeometry(0.9, 14, 10);

/** Emprise des broches (mm) : [xmin, xmax, zmin, zmax, ymax]. */
function extent(pins) {
  if (!pins.length) return [0, 0, 0, 0, 0]; // brouillon sans broche : forme à sa taille par défaut
  const xs = pins.map(p => p.x), zs = pins.map(p => p.z), ys = pins.map(p => p.y);
  return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), Math.max(...ys)];
}
/** Patte dorée verticale de y0 jusqu'à la broche, ou pastille quand la broche est au niveau de la surface. */
function legTo(c, p, y0) {
  const h = p.y - y0;
  const m = h > 0.6 ? block(c, 0.64, h, 0.64, p.x, y0, p.z, M.gold) : add(c, boxGeo(1.6, 0.2, 1.6), M.gold, p.x, p.y - 0.1, p.z);
  c.pin(p.name, m, new V3(p.x, p.y, p.z));
}
/** Point doré posé sur un modèle importé. */
function dotAt(c, p) { const m = add(c, PIN_DOT, M.gold, p.x, p.y, p.z); c.pin(p.name, m, new V3(p.x, p.y, p.z)); }

/** Plaquette de circuit imprimé à la taille du module : en-têtes mâles sous chaque broche, nom sérigraphié. */
function lookModule(c, m) {
  const L = m.look, [x0, x1, z0, z1] = extent(m.pins);
  const w = L.size ? L.size[0] : Math.max(10, x1 - x0 + 6), l = L.size ? L.size[2] : Math.max(10, z1 - z0 + 6);
  const cx = L.size ? 0 : (x0 + x1) / 2, cz = L.size ? 0 : (z0 + z1) / 2;
  const b = board(c, w, l, L.color || '#1b4f8c', { x: cx, z: cz, holes: w >= 18 && l >= 18 }); // trous de fixation : seulement s'il y a la place
  for (const p of m.pins) {
    if (p.y > b.top + 1.2) { block(c, 2.54, 2.5, 2.54, p.x, b.top, p.z, M.plastic); legTo(c, p, b.top); }
    else legTo(c, p, b.top);
    b.pads.push([p.x, p.z]);
    b.labels.push({ t: p.name, x: p.x, z: p.z, dir: 'z', s: p.z > cz ? -1 : 1 });
  }
  b.finish((x, k) => text(x, k, L.label || m.prefix, w / 2, l / 2, Math.min(3, w / Math.max(4, (L.label || m.prefix).length) * 1.2)));
}
function lookBlock(c, m) {
  const L = m.look, [x0, x1, z0, z1, ym] = extent(m.pins);
  const w = L.size ? L.size[0] : Math.max(6, x1 - x0 + 4), h = L.size ? L.size[1] : Math.max(3, ym), l = L.size ? L.size[2] : Math.max(6, z1 - z0 + 4);
  block(c, w, h, l, L.size ? 0 : (x0 + x1) / 2, 0, L.size ? 0 : (z0 + z1) / 2, L.color || '#2a2d30', { r: 0.6 });
  m.pins.forEach(p => dotAt(c, p));
}
function lookLed(c, m, led) {
  const color = (led && led.color) || m.look.color || '#d8322f';
  block(c, 8, 3, 8, 0, 0, 0, M.plastic);
  m.pins.forEach(p => legTo(c, p, 3));
  const mm = stdMat({ color: new THREE.Color(color), roughness: 0.18, transparent: true, opacity: 0.9 });
  cyl(c, 2.9, 1, 0, 8, -1.8, mm); cyl(c, 2.5, 4.6, 0, 9, -1.8, mm); dome(c, 2.5, 0, 13.6, -1.8, mm);
  [-1.27, 1.27].forEach(x => block(c, 0.5, 5, 0.5, x, 3, -1.8, M.leg));
  // Lueur prêtée par la scène aux LED allumées, comme pour celles de la bibliothèque.
  const glow = GLOW[String(color).toLowerCase()] ?? new THREE.Color(color).getHex();
  c.led = { mat: mm, light: { intensity: 0, color: new THREE.Color(glow), position: new THREE.Vector3(0, 12, -1.8) }, glow };
}
function lookResistor(c, m) {
  block(c, 16, 3, 7, 0, 0, 0, M.plastic);
  m.pins.forEach(p => legTo(c, p, 3));
  cyl(c, 1.35, 6.5, 0, 8, -1.2, 0xd9c39a, { axis: 'x' });
  (m.look.bands || []).forEach((bd, i) => cyl(c, 1.4, 0.55, [-2.1, -1, 0.1, 2.1, 3.1][i], 8, -1.2, BAND[bd], { axis: 'x' }));
  [-1, 1].forEach(s => cyl(c, 0.25, 2, s * 4.2, 8, -1.2, M.leg, { axis: 'x', seg: 8 }));
}
/** Dessin SVG (vu de dessus) sur une plaquette : la texture se peint dès que l'image est lue. */
function lookSvg(c, m, svg) {
  const L = m.look, [x0, x1, z0, z1] = extent(m.pins);
  const w = L.size ? L.size[0] : Math.max(8, x1 - x0 + 4), l = L.size ? L.size[2] : Math.max(8, z1 - z0 + 4), T = 1.6;
  block(c, w, T, l, 0, 0, 0, L.color || '#2a6b3c', { r: 0.6 });
  const k = Math.max(4, Math.min(16, 1024 / Math.max(w, l)));
  const tex = canvasTex(w, l, k, (x, kk, cv) => { x.fillStyle = L.color || '#2a6b3c'; x.fillRect(0, 0, cv.width, cv.height); });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, l), stdMat({ map: tex, roughness: 0.55 }));
  plane.rotation.x = -Math.PI / 2; plane.position.set(0, T + 0.02, 0); c.g.add(plane);
  paintSvg(tex, svg);
  for (const p of m.pins) legTo(c, p, T);
}
const svgImages = new Map();
function paintSvg(tex, svg) {
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL || !tex.image || !tex.image.getContext) return; // tests sous Node
  let img = svgImages.get(svg);
  const draw = () => { const cv = tex.image, x = cv.getContext('2d'); x.drawImage(img, 0, 0, cv.width, cv.height); tex.needsUpdate = true; };
  if (img && img.complete && img.naturalWidth) { draw(); return; }
  if (!img) {
    img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    svgImages.set(svg, img);
  }
  img.addEventListener('load', draw, { once: true });
}
/** Modèle .glb du paquet, lu une fois : centré sur (x, z), posé sur y = 0, en millimètres (comme un modèle importé). */
export async function parseGlb(u8) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(buf, '', gltf => {
    const s = gltf.scene, bx = new THREE.Box3().setFromObject(s), ctr = bx.getCenter(new V3());
    s.position.x -= ctr.x; s.position.z -= ctr.z; s.position.y -= bx.min.y;
    const wrap = new THREE.Group(); wrap.add(s); resolve(wrap);
  }, reject));
}

/** Constructeur 3D (même contrat que ceux de catalog.js) d'un paquet installé. */
function builder(p) {
  const m = p.manifest, B = m.behaviour || {}, led = B.led ? { ...B.led, color: LED_COLORS[B.led.color] || B.led.color } : null;
  return c => {
    const kind = m.look.kind;
    if (kind === 'glb' && p.template) { c.g.add(p.template.clone(true)); m.pins.forEach(q => dotAt(c, q)); return; }
    if (kind === 'svg' && p.svg) { lookSvg(c, m, p.svg); return; }
    if (kind === 'led') { lookLed(c, m, led); return; }
    if (kind === 'resistor') { lookResistor(c, m); return; }
    if (kind === 'block') { lookBlock(c, m); return; }
    lookModule(c, m);
  };
}

/**
 * Modèle 3D d'un brouillon (éditeur de composant) : la même forme qu'une fois empaqueté, broches dessinées mais non
 * déclarées (l'éditeur pose ses propres points). m : { prefix, look, behaviour, pins } ; svg : dessin look.svg.
 */
export function lookModel(m, svg = null) {
  const g = new THREE.Group(), look = m.look || { kind: 'module' };
  const mm = { prefix: m.prefix || 'U', behaviour: m.behaviour || {}, pins: m.pins || [], look: { ...look, size: look.size || (m.pins && m.pins.length ? null : [24, 1.6, 16]) } };
  if (!mm.look.size) delete mm.look.size;
  builder({ manifest: mm, svg, template: null })({ g, pin: () => {} });
  return g;
}

/* ---------- Symbole du schéma ---------- */
const LED_NAME = { red: tl('LED rouge'), green: tl('LED verte'), blue: tl('LED bleue'), yellow: tl('LED jaune'), white: tl('LED blanche') };
export const ohmsText = r => (r >= 1e6 ? `${String(+(r / 1e6).toFixed(2)).replace('.', DEC)} MΩ` : r >= 1e3 ? `${String(+(r / 1e3).toFixed(2)).replace('.', DEC)} kΩ` : `${String(+r.toFixed(2)).replace('.', DEC)} Ω`);
/**
 * Symbole dessiné par le paquet (symbol.json) : traits, rectangles, cercles, arcs, textes et ancres des broches.
 * null si une broche du composant n'a pas d'ancre (le schéma prend alors un bloc).
 */
export function symbolMaker(s) {
  return c => {
    const keys = Object.keys(c.pins);
    if (keys.some(k => !s.pins[k])) return null;
    const pts = [];
    s.lines.forEach(l => pts.push(...l.pts));
    s.rects.forEach(r => pts.push([r.x, r.y], [r.x + r.w, r.y + r.h]));
    s.circles.forEach(q => pts.push([q.x - q.r, q.y - q.r], [q.x + q.r, q.y + q.r]));
    s.arcs.forEach(q => pts.push([q.x - q.r, q.y - q.r], [q.x + q.r, q.y + q.r]));
    s.texts.forEach(t => pts.push([t.x, t.y]));
    const pins = Object.fromEntries(keys.map(k => [k, { ...s.pins[k] }]));
    Object.values(pins).forEach(p => pts.push([p.x, p.y]));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const body = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    return {
      pins, body, box: [body[0] - 1, body[1] - 4.2, body[2] + 1, body[3] + 1.5],
      draw(d) {
        s.lines.forEach(l => d.line(l.pts, { w: l.w, close: l.close, fill: l.fill ? '#000' : null }));
        s.rects.forEach(r => d.rect(r.x, r.y, r.w, r.h, { w: r.lw, fill: r.fill ? '#000' : null }));
        s.circles.forEach(q => d.circle(q.x, q.y, q.r, { w: q.w, fill: q.fill ? '#000' : null }));
        s.arcs.forEach(q => d.arc(q.x, q.y, q.r, q.a0, q.a1, { w: q.w }));
        s.texts.forEach(t => d.text(t.x, t.y, t.t, { s: t.s, a: t.a }));
        d.text((body[0] + body[2]) / 2, body[1] - 1.2, c.name, { s: 2.1, b: true, a: 'm' });
      }
    };
  };
}
/** Symbole d'un paquet : le sien, sinon celui de la LED ou de la résistance qu'il déclare, sinon un bloc (null). */
function symbolFor(p) {
  const m = p.manifest, B = m.behaviour, two = m.pins.length === 2;
  if (p.symbol) return { make: symbolMaker(p.symbol) };
  if (B.led && two && B.led.anode === 'A' && B.led.cathode === 'K') return { kind: 'led', value: LED_NAME[B.led.color] || 'LED' };
  if (two && pkgOhms(m.id) > 0) return { kind: 'resistor', value: ohmsText(B.load.ohms) };
  return null;
}

/* ---------- Installation ---------- */
/**
 * Installe un paquet lu (unpackJpart) et ses octets. opts.template : modèle .glb déjà lu ; opts.saved : présent dans
 * la bibliothèque personnelle ; opts.standard : composant livré avec l'application. Les composants standard gardent
 * la catégorie de leur manifeste ; tous les autres (créés dans l'atelier ou par un assistant IA, importés, apportés
 * par un projet) sont rangés dans « Mes composants ». Remplace une version déjà installée du même identifiant, sauf
 * un composant standard par une copie qui n'est pas plus récente. Rend le manifeste installé.
 */
export function installUnpacked(pk, bytes, opts = {}) {
  const m = pk.manifest, t = m.id, std = !!opts.standard, cur = STORE.get(t);
  if (cur && cur.standard && !std && m.version <= cur.manifest.version) return cur.manifest;
  registerSim(m);
  const p = { manifest: m, glb: pk.glb, symbol: pk.symbol, svg: pk.svg, bytes, template: opts.template || null, saved: !std && !!opts.saved, standard: std };
  const entry = { id: t, name: tl(m.name), cat: std ? tl(m.category) : MINE, group: tl(m.category), pre: m.prefix, build: builder(p), custom: !std, pkg: true, ...(std ? { std: true } : {}), ...(m.behaviour.led ? { led: true } : {}) };
  const i = LIBRARY.findIndex(e => e.id === t);
  if (opts.hidden) { if (i >= 0) LIBRARY.splice(i, 1); }
  else if (i >= 0) LIBRARY[i] = entry; else LIBRARY.push(entry);
  BY_ID[t] = entry;
  const sym = symbolFor(p);
  if (sym) PKG_SYMBOLS[t] = sym; else delete PKG_SYMBOLS[t];
  STORE.set(t, p);
  return m;
}
/**
 * Composants standard (manifestes de src/library/standard) : vérifiés comme tout paquet, installés sans archive.
 * Rend { ids, errors } ; un manifeste invalide est ignoré (et signalé).
 */
export function installStandard(manifests) {
  const out = { ids: [], errors: [] };
  for (const raw of manifests || []) {
    const v = validateManifest(raw);
    if (!v.ok) { out.errors.push(`${raw && raw.id} : ${v.errors[0]}`); continue; }
    installUnpacked({ manifest: v.manifest, glb: null, symbol: null, svg: null }, null, { standard: true });
    out.ids.push(v.manifest.id);
  }
  return out;
}
/** Lit, vérifie et installe une archive .jpart (octets). Le modèle .glb est lu avant l'installation. */
export async function installBytes(bytes, opts = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pk = unpackJpart(u8);
  const template = pk.glb ? await (opts.parseGlb || parseGlb)(pk.glb) : null;
  return installUnpacked(pk, u8, { ...opts, template });
}
/** Retire un paquet. keep : il reste utilisable (composants posés) mais quitte la liste de la bibliothèque. */
export function uninstall(type, keep = false) {
  const p = STORE.get(type); if (!p || p.standard) return;
  const i = LIBRARY.findIndex(e => e.id === type); if (i >= 0) LIBRARY.splice(i, 1);
  p.saved = false;
  if (keep) return;
  delete BY_ID[type]; delete PKG_SYMBOLS[type];
  unregisterSim(type); STORE.delete(type);
}
export function markSaved(type, saved = true) { const p = STORE.get(type); if (p) p.saved = saved; }

/* ---------- Projets ---------- */
/**
 * Paquets utilisés par ces composants, à enregistrer dans le projet (.jollof) : [{ id, version, jpart }]. Les
 * composants standard n'y sont pas : comme ceux de la bibliothèque, l'application les a déjà.
 */
export function embedFor(comps) {
  const types = [...new Set(comps.map(c => c.type))].filter(t => STORE.has(t) && !STORE.get(t).standard);
  return types.length ? types.map(t => { const p = STORE.get(t); return { id: t, version: p.manifest.version, jpart: toB64(p.bytes) }; }) : undefined;
}
/**
 * Paquets enregistrés dans un projet ouvert : installés pour la session s'ils manquent, ou s'ils sont plus récents
 * (version) que celui de la bibliothèque. Rend { added: [ids], errors: [textes] } ; un paquet invalide est ignoré.
 */
export async function installEmbedded(list, opts = {}) {
  const out = { added: [], errors: [] };
  if (!Array.isArray(list)) return out;
  for (const e of list.slice(0, 64)) {
    try {
      if (!e || typeof e.jpart !== 'string' || e.jpart.length > 24 * 1024 * 1024) throw new Error(tl('paquet absent ou trop lourd'));
      const cur = typeof e.id === 'string' && STORE.get(e.id);
      if (cur && Number.isFinite(e.version) && e.version <= cur.manifest.version) continue;
      const bytes = fromB64(e.jpart), pk = unpackJpart(bytes);
      if (cur && pk.manifest.version <= cur.manifest.version) continue;
      const template = pk.glb ? await (opts.parseGlb || parseGlb)(pk.glb) : null;
      installUnpacked(pk, bytes, { template, saved: false });
      out.added.push(pk.manifest.id);
    } catch (err) { out.errors.push(String((err && err.message) || err).split('\n')[0]); }
  }
  return out;
}
