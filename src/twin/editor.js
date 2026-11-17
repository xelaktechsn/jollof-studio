// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Jumeau numérique : l'atelier de construction de la vue 3D. Le plan pneumatique reste à gauche (on y dessine le
// circuit pendant qu'on construit), la machine 3D occupe la droite (poignée entre les deux), l'inspecteur de la pièce
// choisie vit dans l'onglet Pneumatique du panneau de droite (toujours visible, jamais sur la scène). Dans la vue :
// une barre d'outils en haut (déplacer, tourner, redimensionner avec aimantation ; dupliquer, supprimer ; grille,
// zones, vues de caméra ; menu Fichier : modèles de départ, import glTF, AutomationML ; Terminer), la palette des
// composants à gauche (recherche, tuiles par famille ; un clic arme la pose, un fantôme suit le pointeur et se pose sur
// ce qu'on vise : bâti, convoyeur, sol), le manipulateur (TransformControls de Three.js) sur la pièce choisie, une
// ligne d'aide en bas. Chaque modification passe par le circuit (annulable : Ctrl+Z) ; la vue est reconstruite par le
// plan pneumatique et l'atelier se raccroche à la pièce choisie. Chargé à la première entrée en construction.
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { tl } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { confirm as confirmDlg, menu as popMenu, toast } from '../school/ui.js';
import { CATALOG, CATS, ENUMS, ITEMS, LIMITS, SIGNAL_RE, TEMPLATES, cleanTwin, freeId, isMover, newPart, partLabel, validateTwin } from './model.js';
import { toAutomationML, fromAutomationML } from './aml.js';
import './twin.css';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = v => String(Math.round(v * 1000) / 1000);
const PROP_NAME = () => ({ speed: tl('Vitesse (m/s)'), stroke: tl('Course (m)'), dir: tl('Direction'), width: tl('Largeur (m)'), height: tl('Hauteur (m)'), range: tl('Portée (m)'), axis: tl('Axe de rotation'), length: tl('Longueur du bras (m)'), reach: tl('Portée de prise (m)'), mode: tl('Commande'), zone: tl('Zone (m)'), detect: tl('Détecte'), nc: tl('Contact fermé au repos (NC)'), item: tl('Pièce'), every: tl('Période (s, 0 = jamais)'), max: tl('Pièces au plus'), color: tl('Couleur'), accept: tl('Accepte'), fillTime: tl('Durée de remplissage (s)'), text: tl('Texte'), scale: tl('Échelle'), asset: tl('Modèle'), face: tl('Arrête les pièces venant en') });
const ENUM_NAME = () => ({ out: tl('par une sortie'), cyl: tl('par le vérin en bout de course'), any: tl('toutes les pièces'), full: tl('les pièces pleines'), done: tl('les pièces usinées'), empty: tl('les pièces vides'), x: 'x', '-x': '−x', y: 'y (haut)', '-y': '−y (bas)', z: 'z', '-z': '−z', hold: tl('maintenu'), toggle: tl('à bascule') });
const BIND_NAME = () => ({ cyl: tl('Vérin du circuit'), out: tl('Sortie (bobine, électrovanne)'), signal: tl('Signal produit (capteur)'), input: tl('Entrée appuyée') });
const SNAPS = [0.01, 0.05, 0.1, 0.25];
const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
/** Encombrement d'un composant à poser (fantôme), en m. */
function footprintOf(type) {
  const K = CATALOG[type]; if (K.sizable) return K.size.slice();
  return { pusher: [0.3, 0.12, 0.1], stopper: [0.3, 0.1, 0.1], rotary: [1.2, 0.1, 0.1], gripper: [0.08, 0.3, 0.08], tool: [0.1, 0.3, 0.1], photocell: [0.05, 0.06, 0.5], proximity: [0.12, 0.12, 0.12], source: (ITEMS[K.props.item] || ITEMS.box).size.slice(), dispenser: [0.24, 0.5, 0.24], button: [0.09, 0.1, 0.09], lamp: [0.05, 0.2, 0.05], label: [0.5, 0.1, 0.02], model: [0.3, 0.3, 0.3] }[type] || [0.2, 0.2, 0.2];
}

/**
 * m3 : la fenêtre 3D (.pn3d). api : { view() → vue machine.js (twin(), onBuild, setBuild, resize), scene() → copie de
 * la scène, set(scène) (annulable), circuit(), known() → { cyls, sensors, inputs, outputs }, paneHost() → où poser
 * l'inspecteur (panneau de droite), showPane(), setLeft(px) (largeur du plan), leave(), version, project() }.
 * Rend { open(), close(), isOpen(), select(id), key(e), mount(host), refresh(), dispose() }.
 */
export function createTwinEditor(m3, api) {
  const host = m3.querySelector('.pn3dView');
  host.insertAdjacentHTML('beforeend', `<div class="twBar glass" hidden role="toolbar" aria-label="${tl('Construction')}">
      <div class="twGroup" role="group" aria-label="${tl('Manipulateur')}"><button type="button" class="tb" data-tw="translate" aria-pressed="true" data-tip="${tl('Déplacer (W)')}">${icon('hand')}<span>${tl('Déplacer')}</span></button><button type="button" class="tb" data-tw="rotate" aria-pressed="false" data-tip="${tl('Tourner autour de la verticale (E)')}">${icon('rotate')}<span>${tl('Tourner')}</span></button><button type="button" class="tb" data-tw="scale" aria-pressed="false" data-tip="${tl('Redimensionner (R)')}">${icon('expand')}<span>${tl('Taille')}</span></button><select class="sel" data-tw="snap" aria-label="${tl('Aimantation')}" data-tip="${tl('Aimantation : pas des déplacements et des positions')}">${SNAPS.map(s => `<option value="${s}"${s === 0.05 ? ' selected' : ''}>${s * 100} cm</option>`).join('')}</select></div>
      <div class="twGroup" role="group" aria-label="${tl('Pièce')}"><button type="button" class="tb" data-tw="dup" data-tip="${tl('Dupliquer (Ctrl+D)')}">${icon('copy')}<span>${tl('Dupliquer')}</span></button><button type="button" class="tb danger" data-tw="del" data-tip="${tl('Supprimer (Suppr)')}">${icon('trash')}<span>${tl('Supprimer')}</span></button></div>
      <div class="twGroup" role="group" aria-label="${tl('Vue')}"><button type="button" class="tb" data-tw="grid" aria-pressed="true" data-tip="${tl('Grille au sol (10 cm)')}">${icon('grid')}<span>${tl('Grille')}</span></button><button type="button" class="tb" data-tw="zones" aria-pressed="true" data-tip="${tl('Zones des capteurs, des bacs et des sources')}">${icon('target')}<span>${tl('Zones')}</span></button><button type="button" class="tb" data-tw="view" data-tip="${tl('Caméra : recentrer, vues de face, de dessus, de côté')}">${icon('orbit')}<span>${tl('Vue')}</span>${icon('chevDown')}</button><button type="button" class="tb" data-tw="plan" aria-pressed="false" data-tip="${tl('Montrer le plan pneumatique à côté de la machine : dessiner le circuit en construisant')}">${icon('pneu')}<span>${tl('Plan')}</span></button></div>
      <span class="grow"></span>
      <button type="button" class="tb" data-tw="file" data-tip="${tl('Modèles de départ, import glTF, AutomationML, exports')}">${icon('folder')}<span>${tl('Fichier')}</span>${icon('chevDown')}</button>
      <button type="button" class="tb" data-tw="props" data-tip="${tl('Montrer l’inspecteur de la machine (panneau de droite)')}">${icon('sliders')}<span>${tl('Propriétés')}</span></button>
      <button type="button" class="btn small primary" data-tw="done" data-tip="${tl('Quitter l’atelier : la machine reste, la fenêtre reprend sa taille')}">${icon('check')}<span>${tl('Terminer')}</span></button>
      <input type="file" data-tw="fileModel" accept=".glb,.gltf" hidden><input type="file" data-tw="fileAml" accept=".aml,.xml" hidden>
    </div>
    <aside class="twPal glass" hidden aria-label="${tl('Composants')}"><header>${icon('shapes')}<b>${tl('Composants')}</b><button type="button" class="tb" data-tw="narrow" data-tip="${tl('Réduire la palette')}" aria-label="${tl('Réduire la palette')}">${icon('chevsLeft')}</button></header>
      <div class="twSearch"><input type="search" data-tw="search" placeholder="${tl('Rechercher…')}" aria-label="${tl('Rechercher un composant')}" autocomplete="off"></div>
      <div class="twCats"></div></aside>
    <div class="twHint" hidden></div>
    <div class="twSplit" hidden role="separator" aria-orientation="vertical" title="${tl('Glisser : partager la place entre le plan et la machine')}"></div>`);
  const bar = host.querySelector('.twBar'), pal = host.querySelector('.twPal'), hint = host.querySelector('.twHint'), splitGrip = host.querySelector('.twSplit');
  const insp = document.createElement('div'); insp.className = 'twInsp'; insp.innerHTML = '<div class="twBody"></div><div class="twProbs"></div>';
  const body = insp.querySelector('.twBody'), probs = insp.querySelector('.twProbs');
  // La barre peut passer sur deux lignes (fenêtre étroite) : le bandeau et la palette se placent sous elle.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => host.style.setProperty('--twBarH', bar.hidden ? '0px' : bar.offsetHeight + 'px')).observe(bar);
  pal.querySelector('.twCats').innerHTML = Object.entries(CATS).map(([cat, name]) => `<section data-cat="${cat}"><b>${esc(name())}</b><div class="twGrid">${Object.entries(CATALOG).filter(([, K]) => K.cat === cat).map(([t, K]) => `<button type="button" class="twAdd" data-add="${t}" aria-pressed="false" data-tip="${esc(K.help())}" data-name="${esc(K.name().toLowerCase())}"><span class="twIc">${icon(K.icon)}</span><span class="twLbl">${esc(K.name())}</span></button>`).join('')}</div></section>`).join('');
  let open = false, selId = null, mode = 'translate', snap = 0.05, tc = null, unBuild = null, armed = false, dragging = false, placing = null, showGrid = true, showZones = true;

  const view = () => api.view(), T = () => (view() ? view().twin() : null);
  const sceneNow = () => api.scene() || cleanTwin({ parts: [] });
  const partOf = (sc, id) => sc.parts.find(p => p.id === id) || null;
  const round = (v, s = snap) => Math.round(v / s) * s;
  const commit = sc => api.set(cleanTwin(sc));

  /* ---------- Manipulateur ---------- */
  function attach() {
    const t = T(); if (!t) return;
    if (tc && tc.parent !== t.scene) { tc.dispose(); tc = null; } // la vue a été refaite (fermée puis rouverte)
    if (!tc) {
      tc = new TransformControls(t.camera, t.canvas); tc.setSize(0.8); t.scene.add(tc);
      tc.addEventListener('change', () => t.ask());
      tc.addEventListener('dragging-changed', e => { dragging = e.value; t.controls.enabled = !e.value; if (!e.value) release(); });
      tc.addEventListener('objectChange', onChange);
    }
    const G = selId && t.groups().get(selId);
    if (!G) { tc.detach(); paintBar(); return; }
    const K = CATALOG[G.p.type];
    if (mode === 'scale' && !K.sizable) mode = 'translate';
    tc.setMode(mode); tc.showX = tc.showZ = true; tc.showY = true;
    if (mode === 'rotate') { tc.showX = false; tc.showZ = false; }
    tc.setTranslationSnap(snap); tc.setRotationSnap(THREE.MathUtils.degToRad(15)); tc.setScaleSnap(0.1);
    tc.attach(G.g);
    paintBar();
  }
  function onChange() {
    const t = T(), G = selId && t && t.groups().get(selId); if (!G || !dragging) return;
    if (mode === 'translate') { const q = G.g.position; q.set(round(q.x), Math.max(0, round(q.y)), round(q.z)); }
    if (mode === 'rotate') { G.g.rotation.x = 0; G.g.rotation.z = 0; }
    paintPose(G);
  }
  /** Fin d'un glissement : la pose du groupe devient celle de la pièce (une modification annulable). */
  function release() {
    const t = T(), G = selId && t && t.groups().get(selId); if (!G) return;
    const sc = sceneNow(), p = partOf(sc, selId); if (!p) return;
    const q = G.g.position;
    if (mode === 'translate') p.pos = [round(q.x), Math.max(0, round(q.y)), round(q.z)];
    if (mode === 'rotate') p.rot = Math.round(THREE.MathUtils.radToDeg(G.g.rotation.y) / 15) * 15;
    if (mode === 'scale' && p.size) { const s = G.g.scale; p.size = p.size.map((v, i) => Math.max(0.01, round(v * [s.x, s.y, s.z][i], 0.01))); G.g.scale.set(1, 1, 1); }
    commit(sc);
  }
  /* ---------- Pose : un composant armé dans la palette, un fantôme qui suit le pointeur, un clic le pose ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit3 = new THREE.Vector3(), nrm = new THREE.Vector3();
  let ghostAt = null, pressAt = null;
  /** Point visé : dessus d'une pièce (face vers le haut) ou sol ; null hors scène. */
  function aim(ev) {
    const t = T(); if (!t) return null;
    const r = t.canvas.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, t.camera);
    const hits = ray.intersectObjects(t.root.children, true).filter(h => h.object.visible && h.object.userData.part && !h.object.userData.ghost && h.face);
    for (const h of hits) { nrm.copy(h.face.normal).transformDirection(h.object.matrixWorld); if (nrm.y > 0.7) return [round(h.point.x), Math.max(0, Math.round(h.point.y * 100) / 100), round(h.point.z)]; }
    if (ray.ray.intersectPlane(floor, hit3)) return [round(hit3.x), 0, round(hit3.z)];
    return null;
  }
  function arm(type) {
    const t = T();
    placing = placing === type ? null : type;
    for (const b of pal.querySelectorAll('[data-add]')) b.setAttribute('aria-pressed', String(b.dataset.add === placing));
    if (t) { t.canvas.style.cursor = placing ? 'crosshair' : ''; if (t.view.ghost) t.view.ghost(placing ? { s: footprintOf(placing) } : null); }
    ghostAt = null; paintHint();
  }
  function placeAt(pos, more) {
    const sc = sceneNow();
    if (sc.parts.length >= LIMITS.parts) { toast(tl('{0} composants au plus.', LIMITS.parts), 'warn'); return; }
    const part = newPart(placing, pos, { id: freeId(sc, placing) });
    sc.parts.push(part); selId = part.id; mode = 'translate';
    if (!more) arm(null);
    commit(sc); select(part.id);
  }
  function onCanvasMove(ev) {
    if (!placing) return;
    const t = T(); ghostAt = aim(ev);
    if (t && t.view.ghostAt) t.view.ghostAt(ghostAt);
  }
  function onCanvasDown(ev) { pressAt = placing && ev.button === 0 ? [ev.clientX, ev.clientY] : null; if (placing && ev.button === 2) { arm(null); ev.preventDefault(); } }
  function onCanvasUp(ev) {
    if (!placing || !pressAt || ev.button !== 0) return;
    const [x, y] = pressAt; pressAt = null;
    if (Math.hypot(ev.clientX - x, ev.clientY - y) > 4) return; // on tournait la vue
    const pos = aim(ev); if (!pos) return;
    ev.stopImmediatePropagation(); placeAt(pos, ev.shiftKey);
  }
  let canvasBound = null;
  function bindCanvas() {
    const t = T(); if (!t || canvasBound === t.canvas) return;
    if (canvasBound) unbindCanvas();
    canvasBound = t.canvas;
    canvasBound.addEventListener('pointermove', onCanvasMove); canvasBound.addEventListener('pointerdown', onCanvasDown, true); canvasBound.addEventListener('pointerup', onCanvasUp, true);
    canvasBound.addEventListener('contextmenu', onCtx);
  }
  const onCtx = e => { if (placing) e.preventDefault(); };
  function unbindCanvas() { if (!canvasBound) return; canvasBound.removeEventListener('pointermove', onCanvasMove); canvasBound.removeEventListener('pointerdown', onCanvasDown, true); canvasBound.removeEventListener('pointerup', onCanvasUp, true); canvasBound.removeEventListener('contextmenu', onCtx); canvasBound.style.cursor = ''; canvasBound = null; }
  function remove() { if (!selId) return; const sc = sceneNow(); const drop = new Set([selId]); let n; do { n = drop.size; for (const p of sc.parts) if (p.parent && drop.has(p.parent)) drop.add(p.id); } while (drop.size > n); sc.parts = sc.parts.filter(p => !drop.has(p.id)); selId = null; commit(sc); select(null); }
  function duplicate() {
    if (!selId) return; const sc = sceneNow(), p = partOf(sc, selId); if (!p) return;
    const q = JSON.parse(JSON.stringify(p)); q.id = freeId(sc, p.type); q.pos = [p.pos[0] + 0.3, p.pos[1], p.pos[2]]; if (q.bind.signal) delete q.bind.signal; if (q.name) q.name = `${q.name} 2`.slice(0, 40);
    sc.parts.push(q); selId = q.id; commit(sc); select(q.id);
  }
  /* ---------- Caméra ---------- */
  function bounds(ids) {
    const t = T(), bb = new THREE.Box3(); if (!t) return null;
    for (const G of t.groups().values()) if (!ids ? !G.p.parent : ids.includes(G.p.id)) bb.expandByObject(G.g);
    return bb.isEmpty() ? null : bb;
  }
  function camera(kind) {
    const t = T(); if (!t) return;
    const bb = bounds(kind === 'focus' && selId ? [selId] : null); if (!bb) { if (view().home) view().home(); return; }
    const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3()), d = Math.max(0.8, Math.max(sz.x, sz.z) * 0.85 + sz.y * 0.4 + 0.5);
    const dir = { iso: [0.7, 0.5, 0.85], top: [0.001, 1, 0.001], front: [0, 0.25, 1], side: [1, 0.25, 0], focus: [0.6, 0.45, 0.75] }[kind] || [0.7, 0.5, 0.85];
    t.camera.position.set(c.x + dir[0] * d, c.y + dir[1] * d, c.z + dir[2] * d); t.controls.target.copy(c); t.ask();
  }
  /* ---------- Inspecteur (dans le panneau de droite) ---------- */
  function field(label, inner, cls = '') { return `<label class="twF ${cls}"><span>${esc(label)}</span>${inner}</label>`; }
  function paintPose(G) { for (const i of [0, 1, 2]) { const el = body.querySelector(`[data-pos="${i}"]`); if (el && document.activeElement !== el) el.value = fmt(G.g.position.getComponent(i)); } const r = body.querySelector('[data-k="rot"]'); if (r && document.activeElement !== r) r.value = String(Math.round(THREE.MathUtils.radToDeg(G.g.rotation.y))); }
  function paintInsp() {
    const sc = sceneNow(), p = selId && partOf(sc, selId), known = api.known(), PN = PROP_NAME(), EN = ENUM_NAME(), BN = BIND_NAME();
    if (!p) {
      body.innerHTML = `<header class="twHead"><b>${icon('box')}${esc(sc.name || tl('Machine'))}</b><span class="twCount">${tl('{0} composant{1}', sc.parts.length, sc.parts.length > 1 ? 's' : '')}</span></header>
        ${field(tl('Nom de la machine'), `<input data-scene="name" value="${esc(sc.name || '')}" maxlength="40">`)}
        <p class="twHelp">${tl('Choisissez un composant dans la palette, puis cliquez dans la scène pour le poser (sur le bâti, un convoyeur ou le sol). Cliquez une pièce pour la régler ici : le manipulateur la déplace (W), la tourne (E) ou la redimensionne (R).')}</p>
        ${sc.parts.length ? `<b class="twSub">${tl('Composants')}</b><ul class="twList">${sc.parts.map(q => `<li><button type="button" data-sel="${esc(q.id)}">${icon(CATALOG[q.type].icon)}<span>${esc(partLabel(q))}</span>${q.parent ? `<small>↳ ${esc(q.parent)}</small>` : ''}</button></li>`).join('')}</ul>` : ''}`;
    } else {
      const K = CATALOG[p.type];
      const props = Object.entries(K.props).filter(([k]) => k !== 'asset').map(([k, def]) => {
        const v = p.props[k];
        if (p.type === 'button' && k === 'mode') return field(PN[k], `<select class="sel" data-prop="mode"><option value="hold"${v === 'hold' ? ' selected' : ''}>${EN.hold}</option><option value="toggle"${v === 'toggle' ? ' selected' : ''}>${EN.toggle}</option></select>`);
        if (ENUMS[k]) return field(PN[k] || k, `<select class="sel" data-prop="${k}">${ENUMS[k].map(o => `<option value="${o}"${o === v ? ' selected' : ''}>${esc(k === 'item' ? ITEMS[o].name() : EN[o] || o)}</option>`).join('')}</select>`);
        if (k === 'nc') return `<label class="twCheck"><input type="checkbox" data-prop="nc"${v ? ' checked' : ''}><span>${esc(PN.nc)}</span></label>`;
        if (k === 'color') return field(PN.color, `<input type="color" data-prop="color" value="${esc(v || '#888888')}">`);
        if (typeof def === 'number') return field(PN[k] || k, `<input type="number" step="${k === 'every' || k === 'max' ? 1 : k === 'range' && p.type === 'rotary' ? 5 : 0.01}" data-prop="${k}" value="${esc(v)}">`);
        return field(PN[k] || k, `<input data-prop="${k}" value="${esc(v)}" maxlength="40">`);
      }).join('');
      const binds = K.bind.filter(k => !(p.type === 'gripper' && ((k === 'cyl' && p.props.mode !== 'cyl') || (k === 'out' && p.props.mode === 'cyl')))).map(k => {
        const v = p.bind[k] || '';
        if (k === 'cyl') return field(BN.cyl, `<select class="sel" data-bind="cyl"><option value="">—</option>${known.cyls.map(c => `<option value="${esc(c)}"${c === v ? ' selected' : ''}>${esc(c)}</option>`).join('')}${v && !known.cyls.includes(v) ? `<option value="${esc(v)}" selected>${esc(v)} ?</option>` : ''}</select>${known.cyls.length ? '' : `<small class="twNote">${tl('Aucun vérin dans le plan : dessinez-en un à gauche.')}</small>`}`);
        const list = k === 'out' ? known.outputs : k === 'input' ? known.inputs : [];
        return field(BN[k], `<input data-bind="${k}" value="${esc(v)}" list="twList-${k}" maxlength="16" spellcheck="false" placeholder="${k === 'signal' ? esc(p.id) : k === 'out' ? 'KM1' : 'dcy'}"><datalist id="twList-${k}">${list.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`);
      }).join('');
      const parents = sc.parts.filter(q => q.id !== p.id && isMover(q) && !isUnder(sc, q.id, p.id));
      body.innerHTML = `<header class="twHead"><b>${icon(K.icon)}${esc(K.name())}</b><code>${esc(p.id)}</code><button type="button" class="tb" data-tw="dup" data-tip="${tl('Dupliquer (Ctrl+D)')}" aria-label="${tl('Dupliquer')}">${icon('copy')}</button><button type="button" class="tb danger" data-tw="del" data-tip="${tl('Supprimer (Suppr)')}" aria-label="${tl('Supprimer')}">${icon('trash')}</button><button type="button" class="tb" data-tw="back" data-tip="${tl('Toute la machine')}" aria-label="${tl('Toute la machine')}">${icon('x')}</button></header>
        <p class="twHelp top">${esc(K.help())}</p>
        <div class="twCols">${field(tl('Nom'), `<input data-k="name" value="${esc(p.name)}" maxlength="40" placeholder="${esc(K.name())}">`)}
        <div class="twRow3"><span class="twLbl">${tl('Rotation (°)')}</span><label><i>y</i><input type="number" step="15" data-k="rot" value="${esc(p.rot)}"></label><button type="button" class="tb" data-rot="-90">−90°</button><button type="button" class="tb" data-rot="90">+90°</button></div></div>
        <div class="twRow3"><span class="twLbl">${tl('Position (m)')}</span>${[0, 1, 2].map(i => `<label><i>${'xyz'[i]}</i><input type="number" step="${snap}" data-pos="${i}" value="${fmt(p.pos[i])}"></label>`).join('')}</div>
        ${p.size ? `<div class="twRow3"><span class="twLbl">${tl('Taille (m)')}</span>${[0, 1, 2].map(i => `<label><i>${'whd'[i]}</i><input type="number" step="0.05" min="0.01" data-size="${i}" value="${fmt(p.size[i])}"></label>`).join('')}</div>` : ''}
        ${props ? `<b class="twSub">${tl('Réglages')}</b><div class="twCols">${props}</div>` : ''}
        ${binds ? `<b class="twSub">${tl('Liaisons avec le projet')}</b>${binds}` : ''}
        ${parents.length || p.parent ? field(tl('Attaché à (parent mobile)'), `<select class="sel" data-k="parent"><option value="">—</option>${parents.map(q => `<option value="${esc(q.id)}"${q.id === p.parent ? ' selected' : ''}>${esc(partLabel(q))}</option>`).join('')}${p.parent && !parents.some(q => q.id === p.parent) ? `<option value="${esc(p.parent)}" selected>${esc(p.parent)}</option>` : ''}</select>`) : ''}`;
    }
    const list = validateTwin(sc, known);
    probs.innerHTML = `<b class="twSub">${tl('Vérification de la machine')}</b>${list.length ? list.map(x => `<button type="button" class="twProb ${x.level}"${x.part ? ` data-sel="${esc(x.part)}"` : ''}>${icon(x.level === 'info' ? 'info' : 'alert')}<span>${esc(x.text)}</span></button>`).join('') : `<p class="twOk">${icon('check')}${tl('Rien à signaler.')}</p>`}`;
    paintHint();
  }
  const isUnder = (sc, id, ancestor) => { let q = partOf(sc, id); const seen = new Set(); while (q && q.parent && !seen.has(q.id)) { seen.add(q.id); if (q.parent === ancestor) return true; q = partOf(sc, q.parent); } return false; };
  function edit(fn) { const sc = sceneNow(), p = selId && partOf(sc, selId); if (!p) return; fn(p, sc); commit(sc); }
  insp.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.scene === 'name') { const sc = sceneNow(); sc.name = el.value; commit(sc); return; }
    if (el.dataset.k === 'name') edit(p => { p.name = el.value; });
    if (el.dataset.k === 'rot') edit(p => { p.rot = +el.value || 0; });
    if (el.dataset.k === 'parent') edit(p => { if (el.value) p.parent = el.value; else delete p.parent; });
    if (el.dataset.pos != null) edit(p => { p.pos[+el.dataset.pos] = +el.value || 0; });
    if (el.dataset.size != null) edit(p => { p.size[+el.dataset.size] = Math.max(0.01, +el.value || 0.01); });
    if (el.dataset.prop) edit(p => { const k = el.dataset.prop; p.props[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value; });
    if (el.dataset.bind) {
      const k = el.dataset.bind, v = el.value.trim();
      if (v && k !== 'cyl' && !SIGNAL_RE.test(v)) { toast(tl('Nom de signal invalide : lettres, chiffres et _ (16 au plus), commence par une lettre.'), 'warn'); el.value = ''; return; }
      edit(p => { if (v) p.bind[k] = v; else delete p.bind[k]; });
    }
  });
  insp.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sel) { select(b.dataset.sel); camera('focus'); return; }
    if (b.dataset.rot) { edit(p => { p.rot = ((p.rot + +b.dataset.rot) % 360 + 360) % 360; }); return; }
    if (b.dataset.tw === 'dup') duplicate(); if (b.dataset.tw === 'del') remove(); if (b.dataset.tw === 'back') select(null);
  });
  /* ---------- Palette ---------- */
  pal.addEventListener('click', e => {
    const b = e.target.closest('[data-add]'); if (b) { arm(b.dataset.add); return; }
    if (e.target.closest('[data-tw="narrow"]')) { pal.classList.toggle('narrow'); const n = pal.classList.contains('narrow'); pal.querySelector('[data-tw="narrow"]').innerHTML = icon(n ? 'chevsRight' : 'chevsLeft'); try { localStorage.setItem('jollof-tw-pal', n ? '1' : ''); } catch (err) { /* rien */ } }
  });
  pal.querySelector('[data-tw="search"]').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    for (const b of pal.querySelectorAll('[data-add]')) b.hidden = !!q && !b.dataset.name.includes(q) && !b.dataset.add.includes(q);
    for (const s of pal.querySelectorAll('section[data-cat]')) s.hidden = !!q && ![...s.querySelectorAll('[data-add]')].some(b => !b.hidden);
  });
  try { if (localStorage.getItem('jollof-tw-pal')) { pal.classList.add('narrow'); pal.querySelector('[data-tw="narrow"]').innerHTML = icon('chevsRight'); } } catch (err) { /* rien */ }
  /* ---------- Barre : modes, aimant, vues, fichiers ---------- */
  function paintBar() {
    for (const b of bar.querySelectorAll('[data-tw]')) if (['translate', 'rotate', 'scale'].includes(b.dataset.tw)) b.setAttribute('aria-pressed', String(b.dataset.tw === mode));
    const G = selId && T() && T().groups().get(selId);
    bar.querySelector('[data-tw="scale"]').disabled = !G || !CATALOG[G.p.type].sizable; bar.querySelector('[data-tw="dup"]').disabled = !selId; bar.querySelector('[data-tw="del"]').disabled = !selId;
    bar.querySelector('[data-tw="grid"]').setAttribute('aria-pressed', String(showGrid)); bar.querySelector('[data-tw="zones"]').setAttribute('aria-pressed', String(showZones));
    bar.querySelector('[data-tw="plan"]').setAttribute('aria-pressed', String(!!(api.planShown && api.planShown())));
  }
  function paintHint() {
    if (placing) hint.innerHTML = `${icon('pointer')}${tl('Cliquez dans la scène pour poser « {0} » (sur le bâti, un convoyeur ou le sol) · Maj + clic : en poser plusieurs · Échap ou clic droit : annuler', esc(CATALOG[placing].name()))}`;
    else if (selId) { const sc = sceneNow(), p = partOf(sc, selId); hint.innerHTML = `${icon('hand')}${tl('« {0} » : glissez les flèches pour déplacer · E : tourner · R : taille · Suppr : supprimer · Ctrl+D : dupliquer · double-clic : centrer la vue', esc(p ? partLabel(p) : selId))}`; }
    else if (api.planHidden && api.planHidden()) hint.innerHTML = `${icon('info')}${tl('La machine couvre le plan : bouton « Plan » de la barre pour le montrer à côté (poignée au bord) et dessiner le circuit pendant la construction.')}`;
    else hint.innerHTML = `${icon('info')}${tl('Cliquez une pièce pour la régler (panneau de droite) · palette : un composant à poser · glisser : tourner la vue · clic droit glissé : la déplacer · molette : zoom')}`;
  }
  bar.addEventListener('click', async e => {
    const b = e.target.closest('[data-tw]'); if (!b || b.tagName !== 'BUTTON') return;
    const k = b.dataset.tw, t = T();
    if (['translate', 'rotate', 'scale'].includes(k)) { mode = k; attach(); return; }
    if (k === 'dup') duplicate(); if (k === 'del') remove(); if (k === 'done') api.leave(); if (k === 'props') api.showPane();
    if (k === 'grid') { showGrid = !showGrid; overlays(); } if (k === 'zones') { showZones = !showZones; overlays(); }
    if (k === 'plan') { api.setPlan(!api.planShown()); paintBar(); paintHint(); if (view()) requestAnimationFrame(() => view().resize()); }
    if (k === 'view') { const v = await popMenu(b, [{ label: tl('Recentrer sur la machine'), icon: 'focus', value: 'iso' }, { label: tl('Centrer sur la pièce choisie'), icon: 'target', value: 'focus' }, '-', { label: tl('Vue de dessus'), icon: 'grid', value: 'top' }, { label: tl('Vue de face'), icon: 'frame', value: 'front' }, { label: tl('Vue de côté'), icon: 'sidebar', value: 'side' }]); if (v) camera(v); }
    if (k === 'file') {
      const v = await popMenu(b, [...Object.entries(TEMPLATES).map(([id, tp]) => ({ label: tl('Modèle : {0}', tp.name()), icon: 'shapes', value: 'tpl:' + id })), '-', { label: tl('Importer un modèle 3D (glTF 2.0 : .glb, .gltf)…'), icon: 'upload', value: 'model' }, { label: tl('Ouvrir un fichier AutomationML (.aml)…'), icon: 'folder', value: 'amlin' }, '-', { label: tl('Exporter la machine en glTF 2.0 (.glb, ISO/IEC 12113)'), icon: 'cube', value: 'glb' }, { label: tl('Exporter en AutomationML (.aml, IEC 62714)'), icon: 'file', value: 'aml' }]);
      if (!v) return;
      if (v.startsWith('tpl:')) template(v.slice(4));
      if (v === 'model') bar.querySelector('[data-tw="fileModel"]').click(); if (v === 'amlin') bar.querySelector('[data-tw="fileAml"]').click();
      if (v === 'glb') exportGlb(); if (v === 'aml') exportAml();
    }
    if (t) t.ask();
  });
  bar.querySelector('[data-tw="snap"]').addEventListener('change', e => { snap = +e.target.value || 0.05; attach(); paintInsp(); });
  async function template(k) {
    const tp = TEMPLATES[k]; if (!tp) return;
    const sc = sceneNow();
    if (sc.parts.length > 1 && !(await confirmDlg(tl('Remplacer la machine'), tl('Remplacer les {0} composants de la scène par le modèle « {1} » ? (Ctrl+Z pour revenir)', sc.parts.length, esc(tp.name())), tl('Remplacer')))) return;
    selId = null; commit(tp.scene()); select(null); camera('iso');
  }
  bar.querySelector('[data-tw="fileModel"]').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    if (f.size > LIMITS.asset) { toast(tl('Modèle trop lourd ({0} Ko) : {1} Ko au plus. Simplifiez-le ou compressez ses textures.', Math.round(f.size / 1024), Math.round(LIMITS.asset / 1024)), 'warn', 7000); return; }
    const sc = sceneNow(), used = Object.values(sc.assets || {}).reduce((a, s) => a + s.length * 3 / 4, 0);
    if (used + f.size > LIMITS.assets) { toast(tl('Trop de modèles importés dans cette scène ({0} Mo au plus).', Math.round(LIMITS.assets / 1e6)), 'warn'); return; }
    const t = T(), id = 'm' + Date.now().toString(36), part = newPart('model', [round(t ? t.controls.target.x : 0), 0, round(t ? t.controls.target.z : 0)], { id: freeId(sc, 'model'), name: f.name.replace(/\.(glb|gltf)$/i, '').slice(0, 40), props: { scale: 1 } });
    part.props.asset = id; // après newPart (qui ne connaît pas encore le modèle)
    sc.assets = { ...(sc.assets || {}), [id]: b64(await f.arrayBuffer()) }; sc.parts.push(part); selId = part.id; commit(sc); select(part.id);
    toast(tl('Modèle importé : réglez son échelle (1 = mètres) et sa place.'), 'ok');
  });
  bar.querySelector('[data-tw="fileAml"]').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const sc = fromAutomationML(await f.text()), cur = sceneNow();
      if (cur.parts.length > 1 && !(await confirmDlg(tl('Ouvrir la machine'), tl('Remplacer la scène par les {0} composants de « {1} » ?', sc.parts.length, esc(f.name)), tl('Ouvrir')))) return;
      selId = null; commit(sc); select(null); camera('iso'); toast(tl('Machine ouverte depuis AutomationML ({0} composants).', sc.parts.length), 'ok');
    } catch (err) { toast(tl('Fichier AutomationML illisible : {0}', err.message), 'warn', 7000); }
  });
  const fileName = sc => (sc.name || 'machine').replace(/[^\w-]+/g, '_').slice(0, 40);
  async function exportGlb() {
    const t = T(); if (!t || !t.view.exportRoots) return;
    const sc = sceneNow(), { saveFile } = await import('../native.js');
    new GLTFExporter().parse(t.view.exportRoots(), async r => { const ok = await saveFile(new Blob([r], { type: 'model/gltf-binary' }), fileName(sc) + '.glb', 'glTF', 'glb'); if (ok) toast(tl('Machine exportée en glTF 2.0 : {0}', typeof ok === 'string' ? ok : ''), 'ok'); }, err => toast(tl('Export glTF impossible : {0}', err && err.message), 'warn'), { binary: true, onlyVisible: true });
  }
  async function exportAml() {
    const sc = sceneNow(), { saveFile } = await import('../native.js');
    const xml = toAutomationML(sc, api.circuit(), { glb: fileName(sc) + '.glb', version: api.version || '', project: api.project ? api.project() : '' });
    const ok = await saveFile(new Blob([xml], { type: 'application/xml' }), fileName(sc) + '.aml', 'AutomationML', 'aml');
    if (ok) toast(tl('Machine exportée en AutomationML (IEC 62714) : exportez aussi le glTF, référencé par le fichier.'), 'ok', 6000);
  }
  /* ---------- Poignée : largeur du plan à gauche ---------- */
  splitGrip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; e.preventDefault();
    const H = m3.parentElement.getBoundingClientRect();
    const mv = ev => api.setLeft(Math.max(H.width * 0.22, Math.min(H.width * 0.72, ev.clientX - H.left)), false);
    const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); api.setLeft(null, true); if (view()) view().resize(); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  });
  /* ---------- Clavier : appelé par le plan pneumatique avant ses propres raccourcis, quand la fenêtre 3D a été cliquée ---------- */
  addEventListener('pointerdown', e => { armed = m3.contains(e.target) || insp.contains(e.target); }, true);
  /** Rend vrai si la touche a servi (Suppr, Échap, W/E/R, Ctrl+D). */
  function key(e) {
    if (!open) return false;
    const a = document.activeElement; if (a && (/INPUT|SELECT|TEXTAREA/.test(a.tagName) || a.isContentEditable)) return false;
    if (e.key === 'Escape' && placing) { arm(null); return true; }
    if (!armed) return false;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'd' && selId) { duplicate(); return true; }
    if (mod) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (selId) { remove(); return true; } return false; }
    if (e.key === 'Escape') { if (selId) { select(null); return true; } return false; }
    if (k === 'w' || k === 'e' || k === 'r') { mode = { w: 'translate', e: 'rotate', r: 'scale' }[k]; attach(); return true; }
    if (k === 'f') { camera(selId ? 'focus' : 'iso'); return true; }
    return false;
  }
  function overlays() { const t = T(); if (t && t.view.overlays) t.view.overlays({ grid: showGrid, zones: showZones }); paintBar(); }
  function select(id) { selId = id; const t = T(); if (t && t.view.select) t.view.select(id); attach(); paintInsp(); paintBar(); }
  /** La vue a reconstruit la scène (modification) : on se raccroche à la pièce choisie. */
  function onBuilt() { const t = T(); if (!t) return; overlays(); bindCanvas(); if (placing && t.view.ghost) t.view.ghost({ s: footprintOf(placing) }); if (selId && !t.groups().has(selId)) selId = null; select(selId); }
  return {
    open() {
      if (open) return; open = true;
      bar.hidden = pal.hidden = hint.hidden = splitGrip.hidden = false; m3.classList.add('building');
      const v = view(); if (v) { unBuild = v.onBuild(onBuilt); v.setBuild(true, (id, how) => { if (how === 'focus') { select(id); camera('focus'); } else if (!placing) select(id); }); requestAnimationFrame(() => v.resize()); }
      this.mount(api.paneHost()); onBuilt(); paintInsp(); paintBar(); paintHint();
    },
    close() {
      if (!open) return; open = false; arm(null);
      bar.hidden = pal.hidden = hint.hidden = splitGrip.hidden = true; m3.classList.remove('building');
      const v = view(); if (v) { v.setBuild(false); const t = v.twin(); if (t && t.view.overlays) t.view.overlays(false); requestAnimationFrame(() => v.resize()); }
      if (unBuild) { unBuild(); unBuild = null; }
      unbindCanvas(); if (tc) tc.detach(); insp.remove();
    },
    /** Pose l'inspecteur dans son hôte (panneau de droite) ; l'élément vit d'une reconstruction du panneau à l'autre. */
    mount(h) { if (h && insp.parentElement !== h) h.appendChild(insp); },
    isOpen: () => open, select, key,
    refresh() { if (open) { paintInsp(); paintBar(); } },
    dispose() { this.close(); if (tc) { tc.dispose(); tc = null; } }
  };
}
