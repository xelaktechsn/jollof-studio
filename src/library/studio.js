// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Atelier de composants : espace de travail plein écran pour créer ou modifier un composant en paquet (.jpart),
// à l'écart du montage. Vue 3D dédiée (grille au pas de 2,54 mm, aimant, vues de dessus, de face et de côté),
// outils de pose (broche, rangée collée depuis la fiche technique), broches déplacées à la souris ou au clavier,
// tableau des broches façon tableur, inspecteur contextuel (broches choisies ou composant), vérification en direct
// (erreurs qui bloquent l'enregistrement, remarques sur la qualité de la fiche, un clic mène à l'endroit à corriger),
// aperçu du symbole du schéma, annuler / rétablir et raccourcis clavier. Le brouillon a la forme décrite dans
// partdraft.js ; l'atelier en modifie une copie, rien ne change dans la bibliothèque avant « Enregistrer ».
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as J from './jpart.js';
import * as P from './packages.js';
import * as D from './partdraft.js';
import { QUANT } from '../sim/models.js';
import { Q, LIGHT } from '../quality.js';
import { confirm, menu } from '../school/ui.js';
import { tl, DEC, CANCEL } from '../i18n/index.js';
import './studio.css';

const V3 = THREE.Vector3;
const esc = D.esc;
/** Couleur de chaque nature de broche : pastilles de la vue, du tableau et de la légende. */
const KIND_COLOR = { pwr: '#e5484d', gnd: '#8b98a5', io: '#3fb27f', nc: '#5d6670', passive: '#f2c94c', drv: '#9b7be0', contact: '#e0703a' };
/** Pas de la grille (mm) ; 0 : placement libre. */
/** Variables CSS d'une nature : couleur et ses teintes transparentes (sans color-mix, absent des WebKit anciens). */
const kv = k => { const c = KIND_COLOR[k] || '#5d6670'; return `--k:${c};--ka:${c}b3;--kb:${c}38;--kc:${c}40`; };
const PITCHES = [2.54, 1.27, 1, 0.5, 0];
/** Hauteur d'une broche de plaquette : sommet d'un en-tête mâle, comme les modules de la bibliothèque. */
const HEADER_Y = 8.1;
const PREFS_KEY = 'jollof-studio-prefs';
const r3 = v => Math.round(v * 1000) / 1000;
const fmt = (v, n = 2) => String(+(+v).toFixed(n)).replace('.', DEC);
const VIEWS = { iso: 'y', top: 'y', front: 'z', side: 'x' };

/** Points de départ d'un nouveau composant : broches en rangée au pas de 2,54 mm, natures déjà choisies. */
const TEMPLATES = () => [
  { id: 'blank', icon: 'box', name: tl('Plaquette vierge'), sub: tl('Posez vos broches une à une'), cat: 'Capteurs', pins: [] },
  { id: 'dig', icon: 'zap', name: tl('Capteur tout-ou-rien'), sub: tl('Détecteur, interrupteur, capteur à seuil'), cat: 'Capteurs', pins: [['VCC'], ['GND'], ['OUT', 'io', 'in']] },
  { id: 'ana', icon: 'gauge', name: tl('Capteur analogique'), sub: tl('Tension proportionnelle à la mesure'), cat: 'Capteurs', pins: [['VCC'], ['GND'], ['AO', 'io', 'adc']] },
  { id: 'i2c', icon: 'link', name: tl('Module I2C'), sub: tl('Écran, capteur, horloge sur le bus I2C'), cat: 'Communication', pins: [['VCC'], ['GND'], ['SDA', 'io', 'sda'], ['SCL', 'io', 'scl']] },
  { id: 'spi', icon: 'cpu', name: tl('Module SPI'), sub: tl('Lecteur de carte, radio, écran rapide'), cat: 'Communication', pins: [['VCC'], ['GND'], ['SCK', 'io', 'sck'], ['MOSI', 'io', 'mosi'], ['MISO', 'io', 'miso'], ['CS', 'io', 'ss']] },
  { id: 'uart', icon: 'radio', name: tl('Module série (UART)'), sub: tl('GPS, Bluetooth, GSM'), cat: 'Communication', pins: [['VCC'], ['GND'], ['TX', 'io', 'tx'], ['RX', 'io', 'rx']] },
  { id: 'act', icon: 'toggle', name: tl('Actionneur commandé'), sub: tl('Relais, buzzer, module de puissance'), cat: 'Sorties', pins: [['VCC'], ['GND'], ['IN', 'io', 'out']] }
];
const SHORTCUTS = () => [
  ['V', tl('Outil Sélection')], ['P', tl('Outil Broche')], ['H', tl('Outil Rangée')],
  ['Maj + clic', tl('Ajouter ou retirer de la sélection')], ['Ctrl + A', tl('Tout sélectionner')], ['Ctrl + D', tl('Dupliquer')], ['Suppr', tl('Supprimer')],
  ['← → ↑ ↓', tl('Décaler au pas de la grille')], ['Maj + flèche', tl('Décaler de 10 pas')], ['Alt + flèche', tl('Décaler de 0,1 mm')],
  ['1 · 2 · 3 · 4', tl('Vue 3D, dessus, face, côté')], ['F', tl('Cadrer')], ['G', tl('Aimant de la grille')], ['L', tl('Noms des broches')],
  ['Ctrl + Z', tl('Annuler')], ['Ctrl + Maj + Z', tl('Rétablir')], ['Ctrl + S', tl('Enregistrer')], ['Échap', tl('Terminer l’outil, désélectionner, quitter')]
];

let A = null; // interface de l'application (parteditor.install) : $, icon, status, comps, projectData, refresh, place, renderLibrary…
let H = null; // fonctions de parteditor.js : bibliothèque personnelle, téléchargement, lecture des fichiers de composant
let root = null, S = null, V = null;
const prefs = { pitch: 2.54, snap: true, labels: true, view: 'iso', dock: 250 };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { /* stockage indisponible */ }
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* stockage indisponible */ } };
const ic = n => A.icon(n);
/** Message dans l'atelier (le bandeau d'état de l'application est caché dessous), et aussi dans ce bandeau. */
let toastT = 0;
function say(msg, kind = 'info') {
  if (A) A.status(msg, kind);
  const t = root && root.querySelector('[data-c="toast"]'); if (!t || !msg) return;
  t.textContent = msg; t.className = `psToast ${kind}`; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 9000 : kind === 'warn' ? 6000 : 3500);
}
const redraw = () => { if (V) V.needs = true; };
const q$ = s => root.querySelector(s);

/* ---------- Brouillon : copie, historique ---------- */
/** Copie profonde d'un brouillon ; le modèle .glb (texte base64, parfois lourd) est partagé, jamais modifié en place. */
const cloneDraft = d => { const { glb, ...rest } = d; return { ...JSON.parse(JSON.stringify(rest)), ...(glb ? { glb } : {}) }; };
const snapOf = () => ({ s: JSON.stringify({ name: S.draft.name, part: S.draft.part, pins: S.draft.pins }), glb: S.draft.glb || null, sel: [...S.sel] });
function restoreSnap(sn) {
  const o = JSON.parse(sn.s), d = S.draft;
  d.name = o.name; d.part = o.part; d.pins = o.pins;
  if (sn.glb) d.glb = sn.glb; else delete d.glb;
  S.sel = sn.sel.filter(i => i < d.pins.length);
  afterChange(true);
}
/**
 * Modification du brouillon : l'état d'avant rejoint l'historique, fn modifie, puis tout se met à jour.
 * rebuild : la forme 3D dépend de ce qui change (broches d'une plaquette, apparence, modèle).
 */
function edit(fn, rebuild = false) {
  S.hist.push(snapOf()); if (S.hist.length > 150) S.hist.shift();
  S.fut = [];
  fn();
  afterChange(rebuild);
}
function afterChange(rebuild) {
  S.dirty = true;
  validate();
  if (rebuild) rebuildModel(); else syncPins();
  schedule();
}
function undo() { if (!S.hist.length) return; S.fut.push(snapOf()); restoreSnap(S.hist.pop()); say(tl('Annulé.')); }
function redo() { if (!S.fut.length) return; S.hist.push(snapOf()); restoreSnap(S.fut.pop()); say(tl('Rétabli.')); }

/* ---------- Vérification ---------- */
/** Endroit à corriger d'après le chemin d'une erreur du manifeste (« part.pins[2].v : … »). */
function locate(path) {
  const d = S.draft;
  let m;
  if ((m = /^part\.pins\[(\d+)\]/.exec(path))) { const i = +m[1]; return { pin: i, where: tl('Broche {0}', (d.pins[i] && d.pins[i].name) || i + 1) }; }
  if (/^part\.(name|category|prefix|description|author|license|id|version)\b/.test(path)) return { tab: 'id', path, where: tl('Identité') };
  if (/^part\.look/.test(path)) return { tab: 'look', path, where: tl('Apparence') };
  if (/^part\.(ma|ds|limits)\b/.test(path)) return { tab: 'elec', path, where: tl('Électrique') };
  if (/^part\.behaviour/.test(path)) return { tab: 'beh', path, where: tl('Comportement') };
  if (/^part\.docs/.test(path)) return { tab: 'docs', path, where: tl('Documentation') };
  if (/^part\.sources/.test(path)) return { tab: 'src', path, where: tl('Sources') };
  if (/^symbol/.test(path)) return { dock: 'symbol', where: tl('Symbole') };
  return {};
}
/** Erreurs (bloquent l'enregistrement) puis remarques de qualité (la fiche reste enregistrable). */
function validate() {
  const d = S.draft, out = [];
  for (const e of D.problems(d)) {
    const m = /^([\w.[\]-]+) : ([\s\S]*)$/.exec(e);
    out.push({ sev: 'err', text: m ? m[2] : e, ...(m ? locate(m[1]) : d.pins.length ? {} : { tool: 'pin', where: tl('Broches') }) });
  }
  const pins = d.pins.map(D.pinOut), B = (d.part && d.part.behaviour) || {}, look = lookKind();
  const passive = B.led || B.load || look === 'led' || look === 'resistor';
  if (pins.length && !passive && !pins.some(q => q.kind === 'gnd')) out.push({ sev: 'warn', text: tl('Aucune broche de masse (GND) : presque tous les modules en ont une.'), tool: 'select', where: tl('Broches') });
  if (pins.length && !passive && !pins.some(q => q.kind === 'pwr')) out.push({ sev: 'warn', text: tl('Aucune broche d’alimentation : le module ne pourra pas être alimenté.'), where: tl('Broches') });
  for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
    const a = pins[i], b = pins[j];
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.9) out.push({ sev: 'warn', text: tl('{0} et {1} sont au même endroit.', a.name, b.name), pin: j, where: tl('Broche {0}', b.name) });
  }
  const generic = pins.filter(q => /^P\d+$/.test(q.name));
  if (generic.length) out.push({ sev: 'info', text: tl('{0} broche(s) au nom générique ({1}…) : donnez-leur le nom imprimé sur le module.', generic.length, generic[0].name), pin: pins.indexOf(generic[0]), where: tl('Broches') });
  if (!(d.part && d.part.description)) out.push({ sev: 'warn', text: tl('Ajoutez une description : l’élève la lit dans la bibliothèque.'), tab: 'id', path: 'part.description', where: tl('Identité') });
  if (!(d.part && d.part.docs && d.part.docs.text)) out.push({ sev: 'info', text: tl('Documentation vide : expliquez le fonctionnement et les erreurs fréquentes.'), tab: 'docs', path: 'part.docs.text', where: tl('Documentation') });
  if (!(d.part && d.part.author && d.part.license)) out.push({ sev: 'info', text: tl('Auteur et licence : utiles pour partager le composant.'), tab: 'id', path: d.part && d.part.author ? 'part.license' : 'part.author', where: tl('Identité') });
  S.issues = out;
}
const errCount = () => S.issues.filter(x => x.sev === 'err').length;

/* ---------- Ouverture et fermeture ---------- */
/**
 * Ouvre l'atelier. draft : brouillon à modifier (copié) ; comp : brouillon posé sur le montage dont il vient ;
 * type : composant en paquet déjà installé qu'il met à jour ; gallery : choix d'un point de départ.
 */
export async function open({ draft = null, comp = null, type = null, gallery = false, msg = '' } = {}) {
  if (!A) return;
  if (!root) build();
  S = { draft: cloneDraft(draft || fromTemplate(TEMPLATES()[0])), comp, type, dirty: false, sel: [], anchor: -1, hover: -1, tool: 'select', next: 'P1', tab: 'id', dock: 'pins', hist: [], fut: [], issues: [], help: false,
    row: { names: '', count: 4, prefix: 'P', start: 1, pitch: 2.54, dir: 'x', rows: 1, gap: 7.62 } };
  S.next = nextName('P0');
  root.hidden = false; document.body.classList.add('partStudioOpen');
  root.style.setProperty('--dock', prefs.dock + 'px');
  q$('[data-c="gallery"]').hidden = !gallery;
  if (gallery) renderGallery();
  try { startView(); } catch (e) { noView(e); }
  validate();
  await rebuildModel();
  frame(); render();
  if (msg) say(msg, 'ok');
  if (!gallery) setTimeout(() => q$('.psName').focus(), 50);
}
async function close(force = false) {
  if (!S) return;
  if (!force && S.dirty && !(await confirm(tl('Quitter l’atelier ?'), esc(tl('Les modifications de « {0} » qui n’ont pas été enregistrées seront perdues.', S.draft.name)), tl('Quitter sans enregistrer'), true))) return;
  root.hidden = true; document.body.classList.remove('partStudioOpen');
  if (V) { V.running = false; release(); }
  S = null;
}
export const isOpen = () => !!S;

function fromTemplate(t) {
  const n = t.pins.length;
  const pins = t.pins.map(([name, kind, need], i) => {
    const q = { name, x: r3((i - (n - 1) / 2) * 2.54), y: HEADER_Y, z: 0 };
    return Object.assign(q, kind ? { kind, ...(need ? { need } : {}) } : D.defaults(q));
  });
  return { v: 2, name: t.id === 'blank' ? tl('Nouveau composant') : t.name, kind: 'part', pins,
    part: { category: t.cat, prefix: 'U', look: { kind: 'module', color: '#1b4f8c', ...(n ? {} : { size: [24, 1.6, 16] }) } } };
}

/* ---------- Interface ---------- */
function build() {
  root = document.createElement('div');
  root.className = 'partStudio'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', tl('Atelier de composants'));
  const tool = (t, icon, label, key) => `<button type="button" class="tb" data-tool="${t}" aria-pressed="false" data-tip="${esc(label)} · ${key}" aria-label="${esc(label)}">${ic(icon)}</button>`;
  root.innerHTML = `
  <header class="psHead">
    <button type="button" class="tb label" data-s="close" data-tip="${esc(tl('Revenir au montage'))}">${ic('chevLeft')}<span>${tl('Montage')}</span></button>
    <div class="psTitle"><small>${tl('Atelier de composants')}</small><input class="psName" data-s="name" spellcheck="false" aria-label="${esc(tl('Nom du composant'))}"></div>
    <div class="psMeta" data-c="meta"></div>
    <span class="psGrow"></span>
    <button type="button" class="tb" data-s="undo" data-tip="${esc(tl('Annuler · Ctrl+Z'))}" aria-label="${esc(tl('Annuler'))}">${ic('undo')}</button>
    <button type="button" class="tb" data-s="redo" data-tip="${esc(tl('Rétablir · Ctrl+Maj+Z'))}" aria-label="${esc(tl('Rétablir'))}">${ic('redo')}</button>
    <button type="button" class="psStatus" data-s="issues" data-c="status"></button>
    <button type="button" class="btn small" data-s="open" data-tip="${esc(tl('Ouvrir un composant : .jpart, pièce Fritzing (.fzpz), symbole KiCad (.kicad_sym)'))}">${ic('folder')}<span>${tl('Ouvrir')}</span></button>
    <button type="button" class="btn small" data-s="export" data-tip="${esc(tl('Exporter le paquet .jpart à partager'))}">${ic('upload')}<span>${tl('Exporter')}</span></button>
    <div class="psSave"><button type="button" class="btn small primary" data-s="save">${ic('save')}<span data-c="saveLabel">${tl('Enregistrer')}</span></button><button type="button" class="btn small primary icon" data-s="saveMenu" aria-label="${esc(tl('Autres façons d’enregistrer'))}">${ic('chevDown')}</button></div>
  </header>
  <nav class="psRail" role="toolbar" aria-orientation="vertical" aria-label="${esc(tl('Outils'))}">
    ${tool('select', 'pointer', tl('Sélection'), 'V')}${tool('pin', 'pin', tl('Broche'), 'P')}${tool('row', 'list', tl('Rangée de broches'), 'H')}
    <span class="psSep"></span>
    <button type="button" class="tb" data-s="frame" data-tip="${esc(tl('Cadrer · F'))}" aria-label="${esc(tl('Cadrer'))}">${ic('frame')}</button>
    <span class="psGrow"></span>
    <button type="button" class="tb" data-s="help" data-tip="${esc(tl('Raccourcis clavier · ?'))}" aria-label="${esc(tl('Raccourcis clavier'))}">${ic('key')}</button>
  </nav>
  <main class="psView">
    <canvas aria-label="${esc(tl('Vue 3D du composant'))}"></canvas>
    <div class="psLabels" data-c="labels" aria-hidden="true"></div>
    <div class="psBar">
      <div class="seg glass" role="group" aria-label="${esc(tl('Point de vue'))}">
        <button type="button" class="segBtn" data-view="iso" data-tip="${esc(tl('Vue 3D · 1'))}">3D</button>
        <button type="button" class="segBtn" data-view="top" data-tip="${esc(tl('Vue de dessus · 2'))}">${tl('Dessus')}</button>
        <button type="button" class="segBtn" data-view="front" data-tip="${esc(tl('Vue de face · 3'))}">${tl('Face')}</button>
        <button type="button" class="segBtn" data-view="side" data-tip="${esc(tl('Vue de côté · 4'))}">${tl('Côté')}</button>
      </div>
      <div class="seg glass psGridCtl" role="group" aria-label="${esc(tl('Grille de la vue'))}">
        <button type="button" class="segBtn" data-s="snap" aria-pressed="true" data-tip="${esc(tl('Aimant : les broches se posent sur la grille · G'))}">${ic('grid')}<span>${tl('Aimant')}</span></button>
        <select data-s="pitch" aria-label="${esc(tl('Pas de la grille'))}">${PITCHES.map(p => `<option value="${p}">${p ? `${fmt(p)} mm` : tl('libre')}</option>`).join('')}</select>
      </div>
      <div class="seg glass" role="group">
        <button type="button" class="segBtn" data-s="labels" aria-pressed="true" data-tip="${esc(tl('Noms des broches · L'))}">${ic('tag')}</button>
      </div>
    </div>
    <div class="psHint" data-c="hint" aria-live="polite"></div>
    <div class="psCoords" data-c="coords"></div>
    <div class="psLegend">${Object.entries(D.KIND_LABEL()).map(([k, l]) => `<span><i style="${kv(k)}"></i>${esc(l)}</span>`).join('')}</div>
    <div class="psHelp" data-c="help" hidden></div>
    <div class="psGallery" data-c="gallery" hidden></div>
  </main>
  <aside class="psInsp" data-c="insp" aria-label="${esc(tl('Inspecteur'))}"></aside>
  <section class="psDock">
    <div class="psGrip" data-s="grip" role="separator" aria-orientation="horizontal" aria-label="${esc(tl('Hauteur du panneau'))}"></div>
    <div class="psDockHead"><div class="psTabs" role="tablist" data-c="docktabs"></div><span class="psGrow"></span><div class="psDockTools" data-c="docktools"></div></div>
    <div class="psDockBody" data-c="dock"></div>
  </section>
  <div class="psToast" data-c="toast" role="status" aria-live="polite" hidden></div>
  <input type="file" data-c="fileModel" accept=".step,.stp,.glb,.gltf" hidden>
  <input type="file" data-c="filePart" accept=".jpart,.fzpz,.kicad_sym" hidden>`;
  document.body.appendChild(root);
  root.addEventListener('click', e => onClick(e).catch(err => say(String((err && err.message) || err), 'err')));
  root.addEventListener('change', e => onChange(e).catch(err => say(String((err && err.message) || err), 'err')));
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onFieldKey);
  root.addEventListener('focusin', onFocusIn);
  window.addEventListener('keydown', onKey, true);
  // Erreur imprévue pendant que l'atelier est ouvert : dite dans l'atelier, pas seulement dans la console.
  const trap = e => { if (!S || root.hidden) return; const r = e.reason || e.error || e.message || e; say(tl('Erreur : {0}', String((r && r.message) || r).split('\n')[0]), 'err'); };
  window.addEventListener('error', trap); window.addEventListener('unhandledrejection', trap);
  q$('[data-c="fileModel"]').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importModel(f).catch(err => say(tl('Import impossible : ') + String(err.message || err), 'err')); };
  q$('[data-c="filePart"]').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openFile(f); };
  initGrip();
}

let pending = 0;
/** Rendu du panneau au prochain affichage (plusieurs changements → un seul rendu, le champ actif garde le focus). */
function schedule() { if (!pending) pending = requestAnimationFrame(() => { pending = 0; if (S) renderKeep(); }); }
/** Identifiant stable d'un champ, pour lui rendre le focus après un nouveau rendu. */
function fieldKey(el) {
  if (!el || !root.contains(el) || !el.matches('input,select,textarea,button')) return null;
  for (const a of ['data-f', 'data-p', 'data-r', 'data-s']) if (el.hasAttribute(a)) return `[${a}="${CSS.escape(el.getAttribute(a))}"]`;
  if (el.dataset.row != null) return `[data-row="${el.dataset.row}"][data-col="${el.dataset.col}"]`;
  return null;
}
function renderKeep() {
  const a = document.activeElement, key = fieldKey(a), caret = a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
  render();
  if (!key) return;
  const n = q$(key); if (!n || n === a) return;
  n.focus({ preventScroll: true });
  if (caret && 'setSelectionRange' in n && n.type !== 'number') try { n.setSelectionRange(caret[0], caret[1]); } catch (e) { /* champ sans curseur */ }
}
function render() {
  if (!S) return;
  renderHead(); renderRail(); renderBar(); renderInsp(); renderDock(); renderHint(); renderHelp();
}
function renderHead() {
  const d = S.draft, name = q$('.psName');
  if (document.activeElement !== name) name.value = d.name;
  const title = q$('.psTitle'); title.classList.toggle('dirty', S.dirty); title.querySelector('small').dataset.dirty = tl('modifié');
  const p = d.part || {}, ver = S.type && P.packageOf(S.type) ? P.packageOf(S.type).manifest.version : null;
  q$('[data-c="meta"]').innerHTML = [tl(p.category || J.PKG_CATEGORIES[0]), `${tl('repère')} ${esc(p.prefix || 'U')}`, tl('{0} broche(s)', d.pins.length), ver ? `v${ver}` : tl('nouveau'), d.glb ? tl('modèle 3D') : ''].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('');
  const e = errCount(), w = S.issues.filter(x => x.sev === 'warn').length, st = q$('[data-c="status"]');
  st.className = `psStatus ${e ? 'err' : w ? 'warn' : 'ok'}`;
  st.innerHTML = e ? `${ic('alert')}<span>${tl('{0} erreur(s)', e)}</span>` : `${ic('check')}<span>${w ? tl('Prêt · {0} remarque(s)', w) : tl('Prêt')}</span>`;
  st.dataset.tip = e ? tl('L’enregistrement attend leur correction : cliquez pour les voir') : tl('Le composant peut être enregistré');
  q$('[data-s="undo"]').disabled = !S.hist.length; q$('[data-s="redo"]').disabled = !S.fut.length;
  q$('[data-c="saveLabel"]').textContent = S.type ? tl('Mettre à jour') : tl('Enregistrer');
}
function renderRail() {
  root.querySelectorAll('[data-tool]').forEach(b => { const on = b.dataset.tool === S.tool; b.setAttribute('aria-pressed', on); b.classList.toggle('on', on); });
  q$('[data-s="help"]').classList.toggle('on', S.help);
}
function renderBar() {
  root.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === prefs.view));
  q$('[data-s="snap"]').setAttribute('aria-pressed', prefs.snap && !!prefs.pitch);
  q$('[data-s="pitch"]').value = String(prefs.pitch);
  q$('[data-s="labels"]').setAttribute('aria-pressed', prefs.labels);
  q$('[data-c="labels"]').hidden = !prefs.labels;
}
function renderHint() {
  const n = rowNames().length;
  q$('[data-c="hint"]').textContent = {
    select: S.sel.length ? tl('Glisser : déplacer · flèches : décaler au pas · Suppr : supprimer · Ctrl+D : dupliquer') : tl('Cliquez une broche pour la choisir · Maj+clic : plusieurs · P : poser une broche · H : une rangée'),
    pin: tl('Cliquez pour poser {0} · un nom déjà posé déplace la broche · Échap : terminer', S.next || 'P1'),
    row: n ? tl('Cliquez pour poser la rangée de {0} broche(s) · Échap : annuler', n) : tl('Écrivez les noms de la rangée dans l’inspecteur')
  }[S.tool];
}
function renderHelp() {
  const h = q$('[data-c="help"]'); h.hidden = !S.help;
  if (S.help) h.innerHTML = `<h4>${tl('Raccourcis clavier')}</h4><dl>${SHORTCUTS().map(([k, t]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(t)}</dd>`).join('')}</dl>`;
}

/* ---------- Galerie des points de départ ---------- */
function renderGallery() {
  const g = q$('[data-c="gallery"]'), K = D.KIND_LABEL();
  g.innerHTML = `<div class="psGalCard" role="dialog" aria-labelledby="psGalTitle">
    <header><div><h2 id="psGalTitle">${tl('Nouveau composant')}</h2><p>${tl('Choisissez un point de départ : broches, natures et apparence restent modifiables ensuite.')}</p></div><button type="button" class="tb" data-s="galClose" aria-label="${esc(tl('Fermer'))}">${ic('x')}</button></header>
    <div class="psTpls">${TEMPLATES().map(t => `<button type="button" class="psTpl" data-tpl="${t.id}"><span class="psTi">${ic(t.icon)}</span><b>${esc(t.name)}</b><small>${esc(t.sub)}</small><span class="psTplPins">${t.pins.length ? t.pins.map(([n, k]) => { const o = D.pinOut({ name: n, x: 0, y: 0, z: 0, ...(k ? { kind: k } : {}) }); return `<i style="${kv(o.kind)}" title="${esc(K[o.kind])}">${esc(n)}</i>`; }).join('') : `<i class="psNone">${tl('aucune broche')}</i>`}</span></button>`).join('')}</div>
    <footer><span>${tl('Ou partir d’un fichier')}</span>
      <button type="button" class="btn small" data-s="galModel">${ic('cube')}<span>${tl('Modèle 3D (STEP, GLB)')}</span></button>
      <button type="button" class="btn small" data-s="galFile">${ic('folder')}<span>${tl('Fritzing, KiCad ou .jpart')}</span></button></footer></div>`;
  const first = g.querySelector('.psTpl'); if (first) setTimeout(() => first.focus(), 40);
}
async function useTemplate(id) {
  const t = TEMPLATES().find(x => x.id === id); if (!t) return;
  S.draft = fromTemplate(t); S.sel = []; S.hist = []; S.fut = []; S.dirty = false; S.next = nextName('P0');
  q$('[data-c="gallery"]').hidden = true;
  validate(); await rebuildModel(); frame(); render();
  setTool(t.pins.length ? 'select' : 'pin');
  q$('.psName').select(); q$('.psName').focus();
}

/* ---------- Inspecteur ---------- */
const VIA = () => ({ '': '—', ...Object.fromEntries(J.RESISTORS.map(r => [r, r.replace('res-', '') + ' Ω'])) });
const field = (label, html, cls = '') => `<label class="psField ${cls}"><span>${esc(label)}</span>${html}</label>`;
const inp = (f, v, t = 'str', extra = '') => `<input data-f="${f}" data-t="${t}" value="${esc(t === 'num' && typeof v === 'number' ? fmt(v, 4) : v ?? '')}"${t === 'num' ? ' inputmode="decimal"' : ''} ${extra}>`;
const area = (f, v, t = 'str', rows = 3, extra = '') => `<textarea data-f="${f}" data-t="${t}" rows="${rows}" ${extra}>${esc(v ?? '')}</textarea>`;
const sel = (f, map, v, t = 'str') => `<select data-f="${f}" data-t="${t}">${D.opts(map, v)}</select>`;
const chk = (f, v, label) => `<label class="psChk"><input type="checkbox" data-f="${f}" data-t="bool"${v ? ' checked' : ''}><span>${esc(label)}</span></label>`;
const numStr = v => (v == null || v === '' ? '' : fmt(v, 3));
const TABS = () => [['id', 'tag', tl('Identité')], ['look', 'cube', tl('Apparence')], ['elec', 'zap', tl('Électrique')], ['beh', 'activity', tl('Comportement')], ['docs', 'book', tl('Notice')], ['src', 'link', tl('Sources')]];

function renderInsp() {
  const box = q$('[data-c="insp"]');
  if (S.tool === 'row') box.innerHTML = rowInsp();
  else if (S.tool === 'pin') box.innerHTML = pinToolInsp();
  else if (S.sel.length) box.innerHTML = pinInsp();
  else box.innerHTML = partInsp();
}
function pinToolInsp() {
  const q = { name: S.next || 'P1', x: 0, y: 0, z: 0 }, o = D.pinOut(q);
  return `<div class="psIH"><span class="psTi">${ic('plus')}</span><div><h3>${tl('Poser des broches')}</h3><p>${tl('Cliquez dans la vue à l’endroit de chaque broche.')}</p></div></div>
    <section class="psSec">${`<label class="psField"><span>${tl('Nom de la prochaine broche')}</span><input data-s="next" value="${esc(S.next)}" spellcheck="false"></label>`}
      <p class="psNote">${tl('Nature proposée : {0}. Le nom suivant s’incrémente tout seul (P1, P2…, D2, D3…). Un nom déjà posé déplace la broche existante : pratique pour recaler un modèle.', D.KIND_LABEL()[o.kind])}</p>
      <p class="psNote">${lookKind() === 'glb' ? tl('Sur un modèle 3D, la broche se pose à la surface cliquée.') : tl('Sur une plaquette, la broche se pose à la hauteur des autres ; la plaquette s’agrandit pour l’accueillir.')}</p></section>
    <div class="psActs"><button type="button" class="btn small" data-tool="select">${ic('check')}<span>${tl('Terminer')}</span></button></div>`;
}
function rowInsp() {
  const r = S.row, names = rowNames();
  const seg = (k, opts) => `<div class="seg psSeg">${opts.map(([v, l]) => `<button type="button" class="segBtn" data-rv="${k}" data-v="${v}" aria-pressed="${String(r[k]) === String(v)}">${esc(l)}</button>`).join('')}</div>`;
  return `<div class="psIH"><span class="psTi">${ic('list')}</span><div><h3>${tl('Rangée de broches')}</h3><p>${tl('En-tête au pas de 2,54 mm, connecteur, boîtier DIP.')}</p></div></div>
    <section class="psSec">
      <label class="psField"><span>${tl('Noms (collés depuis la fiche technique)')}</span><textarea data-r="names" rows="4" spellcheck="false" placeholder="${esc(tl('VCC, GND, SDA, SCL — ou un nom par ligne'))}">${esc(r.names)}</textarea></label>
      <p class="psNote">${tl('Laissez vide pour numéroter :')}</p>
      <div class="psRow3">${`<label class="psField"><span>${tl('Nombre')}</span><input data-r="count" value="${r.count}" inputmode="numeric"></label><label class="psField"><span>${tl('Préfixe')}</span><input data-r="prefix" value="${esc(r.prefix)}" spellcheck="false"></label><label class="psField"><span>${tl('Premier n°')}</span><input data-r="start" value="${r.start}" inputmode="numeric"></label>`}</div>
    </section>
    <section class="psSec"><h4>${tl('Disposition')}</h4>
      <div class="psRow2"><label class="psField"><span>${tl('Pas (mm)')}</span><select data-r="pitch">${[2.54, 2, 1.27, 1, 0.5].map(p => `<option value="${p}"${+r.pitch === p ? ' selected' : ''}>${fmt(p)}</option>`).join('')}</select></label>
      <div class="psField"><span>${tl('Direction')}</span>${seg('dir', [['x', tl('axe X')], ['z', tl('axe Z')]])}</div></div>
      <div class="psRow2"><div class="psField"><span>${tl('Rangées')}</span>${seg('rows', [[1, '1'], [2, tl('2 (DIP)')]])}</div>
      ${+r.rows === 2 ? `<label class="psField"><span>${tl('Écart des rangées (mm)')}</span><input data-r="gap" value="${fmt(r.gap)}" inputmode="decimal"></label>` : '<span></span>'}</div>
    </section>
    <section class="psSec"><h4>${tl('{0} broche(s)', names.length)}</h4><div class="psChips">${names.slice(0, 40).map(n => { const o = D.pinOut({ name: n, x: 0, y: 0, z: 0 }); return `<i style="${kv(o.kind)}">${esc(n)}</i>`; }).join('') || `<span class="psNote">${tl('Aucun nom')}</span>`}</div></section>
    <div class="psActs"><button type="button" class="btn small primary" data-s="rowCenter"${names.length ? '' : ' disabled'}>${ic('plus')}<span>${tl('Poser à côté des autres')}</span></button><button type="button" class="btn small" data-tool="select">${CANCEL}</button></div>
    <div class="psSec"><p class="psNote">${tl('Ou cliquez dans la vue : l’aperçu suit la souris. Les natures sont devinées d’après les noms (VCC, GND, SDA…).')}</p></div>`;
}
/** Valeur commune à toutes les broches choisies, ou null si elles diffèrent. */
function common(list, f) { const v = f(list[0]); return list.every(q => JSON.stringify(f(q)) === JSON.stringify(v)) ? v : null; }
function pinInsp() {
  const d = S.draft, list = S.sel.map(i => d.pins[i]).filter(Boolean), one = list.length === 1, q0 = list[0];
  if (!q0) return partInsp();
  const outs = list.map(D.pinOut), K = D.KIND_LABEL(), N = D.NEED_LABEL();
  const kind = common(outs, o => o.kind), need = common(outs, o => o.need), mixed = '<option value="" data-mixed selected>— ' + esc(tl('valeurs différentes')) + '</option>';
  const pSel = (k, map, v) => `<select data-p="${k}">${v == null ? mixed : ''}${D.opts(map, v)}</select>`;
  const pInp = (k, v, extra = '') => `<input data-p="${k}" value="${esc(v ?? '')}" ${extra}>`;
  const pChk = (k, label) => { const v = common(list, q => !!q[k]); return `<label class="psChk${v == null ? ' psMixed' : ''}"><input type="checkbox" data-p="${k}"${v ? ' checked' : ''}><span>${esc(label)}</span></label>`; };
  const o0 = outs[0], range = kind === 'pwr' && common(outs, o => Array.isArray(o.v));
  const srcMap = { '': '—', ...Object.fromEntries(Object.keys((d.part && d.part.sources) || {}).map(k => [k, `${k} · ${(d.part.sources[k].title || '').slice(0, 40)}`])) };
  const dot = `<span class="psDot" style="${kv(kind || 'nc')}"></span>`;
  return `<div class="psIH">${dot}<div><h3>${one ? tl('Broche {0}', esc(q0.name)) : tl('{0} broches choisies', list.length)}</h3><p>${one ? `${esc(K[o0.kind])}${o0.kind === 'io' ? ' · ' + esc(N[o0.need]) : ''}` : esc(list.map(q => q.name).join(', ').slice(0, 80))}</p></div>
      <span class="psGrow"></span><button type="button" class="tb" data-s="dup" data-tip="${esc(tl('Dupliquer · Ctrl+D'))}" aria-label="${esc(tl('Dupliquer'))}">${ic('copy')}</button><button type="button" class="tb danger" data-s="del" data-tip="${esc(tl('Supprimer · Suppr'))}" aria-label="${esc(tl('Supprimer'))}">${ic('trash')}</button></div>
    <section class="psSec"><h4>${tl('Électrique')}</h4>
      ${one ? `<label class="psField"><span>${tl('Nom imprimé sur le module')}</span>${pInp('name', q0.name, 'spellcheck="false" maxlength="16"')}</label>` : ''}
      <div class="psRow2"><label class="psField"><span>${tl('Nature')}</span>${pSel('kind', K, kind)}</label>
      ${kind === 'io' ? `<label class="psField"><span>${tl('Ce qu’elle attend')}</span>${pSel('need', N, need)}</label>` : '<span></span>'}</div>
      ${kind === 'pwr' ? `<div class="psRow2"><label class="psField"><span>${tl('Tension')}</span><select data-p="vmode">${range == null ? mixed : ''}${D.opts({ logic: tl('logique de la carte'), range: tl('plage (V)') }, range == null ? null : range ? 'range' : 'logic')}</select></label>
        ${range ? `<div class="psField"><span>${tl('Plage (V)')}</span><span class="psPair">${pInp('vmin', numStr(common(outs, o => o.v[0])), 'inputmode="decimal" aria-label="min"')}<b>–</b>${pInp('vmax', numStr(common(outs, o => o.v[1])), 'inputmode="decimal" aria-label="max"')}</span></div>` : '<span></span>'}</div>
        ${range ? `<label class="psField"><span>${tl('Source de la plage')}</span>${pSel('ds', srcMap, common(list, q => q.ds || ''))}</label>` : ''}` : ''}
      ${kind === 'io' || kind === 'gnd' ? `<label class="psField"><span>${tl('Résistance en série demandée')}</span>${pSel('via', VIA(), common(list, q => q.via || ''))}</label>` : ''}
      ${kind === 'io' ? `<div class="psRow2"><label class="psField"><span>${tl('Au repos')}</span>${(() => { const v = common(list, q => (q.idle === 0 || q.idle === 1 ? String(q.idle) : '')); return `<select data-p="idle">${v == null ? mixed : ''}${[['', tl('non précisé')], ['1', 'HIGH'], ['0', 'LOW']].map(([k, l]) => `<option value="${k}"${v === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`; })()}</label>
        <label class="psField"><span>${tl('Tirage à prévoir')}</span>${pSel('pull', VIA(), common(list, q => q.pull || ''))}</label></div>
        <div class="psChks">${pChk('opt', tl('facultative'))}${pChk('lv5', tl('sort du 5 V'))}${pChk('lv3', tl('logique 3,3 V'))}</div>` : ''}
    </section>
    <section class="psSec"><h4>${tl('Texte pour l’élève')}</h4>
      <label class="psField"><span>${tl('Rôle')}</span>${pInp('label', common(list, q => q.label || ''), `placeholder="${esc(tl('ex. Sortie du capteur'))}"`)}</label>
      <label class="psField"><span>${tl('Pourquoi (affiché à l’élève)')}</span><textarea data-p="why" rows="2" placeholder="${esc(tl('ex. Se branche sur une entrée numérique'))}">${esc(common(list, q => q.why || '') ?? '')}</textarea></label>
    </section>
    <section class="psSec"><h4>${tl('Position (mm)')}</h4>
      ${one ? `<div class="psXYZ">${['x', 'y', 'z'].map(k => `<label><b>${k.toUpperCase()}</b><input data-p="${k}" value="${numStr(q0[k])}" inputmode="decimal"></label>`).join('')}</div>`
    : `<div class="psBtns"><span>${tl('Aligner')}</span><button type="button" class="btn small" data-al="x">X</button><button type="button" class="btn small" data-al="y">Y</button><button type="button" class="btn small" data-al="z">Z</button></div>
         <div class="psBtns"><span>${tl('Répartir au pas')}</span><button type="button" class="btn small" data-dist="x">${tl('le long de X')}</button><button type="button" class="btn small" data-dist="z">${tl('le long de Z')}</button></div>
         <div class="psBtns"><span>${tl('Renommer')}</span><input data-s="renPrefix" value="P" aria-label="${esc(tl('Préfixe'))}" spellcheck="false"><input data-s="renStart" value="1" aria-label="${esc(tl('Premier n°'))}" inputmode="numeric"><button type="button" class="btn small" data-s="rename">${tl('en série')}</button></div>`}
      <p class="psNote">${tl('Flèches : décaler au pas de la grille ({0}). Glisser dans la vue : déplacer.', prefs.pitch ? fmt(prefs.pitch) + ' mm' : tl('0,1 mm'))}</p>
    </section>`;
}
function partInsp() {
  const tabs = TABS().map(([k, icon, l]) => { const n = S.issues.filter(x => x.tab === k && x.sev === 'err').length; return `<button type="button" role="tab" class="psTab${S.tab === k ? ' on' : ''}" data-tab="${k}" aria-selected="${S.tab === k}" data-tip="${esc(l)}">${ic(icon)}<span>${esc(l)}</span>${n ? `<em>${n}</em>` : ''}</button>`; }).join('');
  return `<div class="psTabsV" role="tablist" aria-label="${esc(tl('Fiche du composant'))}">${tabs}</div><div class="psTabBody">${partTab(S.tab)}</div>`;
}
function partTab(tab) {
  const d = S.draft, p = d.part, none = { '': '—' };
  const pinMap = { ...none, ...Object.fromEntries(d.pins.map(q => [q.name, q.name])) };
  const srcMap = { ...none, ...Object.fromEntries(Object.keys(p.sources || {}).map(k => [k, `${k} · ${(p.sources[k].title || '').slice(0, 40)}`])) };
  if (tab === 'id') {
    const cats = Object.fromEntries(J.PKG_CATEGORIES.map(k => [k, tl(k)]));
    return `<section class="psSec"><h4>${tl('Identité')}</h4>
      ${field(tl('Nom'), inp('name', d.name, 'str', 'maxlength="60"'))}
      <div class="psRow2">${field(tl('Catégorie'), sel('part.category', cats, p.category))}${field(tl('Préfixe des repères'), inp('part.prefix', p.prefix, 'str', 'placeholder="U" maxlength="8"'))}</div>
      ${field(tl('Description (affichée à l’élève)'), area('part.description', p.description, 'str', 3, `maxlength="400" placeholder="${esc(tl('À quoi sert le composant, en une ou deux phrases'))}"`))}
      <div class="psRow2">${field(tl('Auteur'), inp('part.author', p.author))}${field(tl('Licence'), inp('part.license', p.license, 'str', 'placeholder="CC-BY-4.0"'))}</div></section>
      <section class="psSec"><h4>${tl('Paquet')}</h4><dl class="psDl"><dt>${tl('Identifiant')}</dt><dd>${esc(p.id || tl('donné au premier enregistrement'))}</dd><dt>${tl('Version')}</dt><dd>${esc(S.type && P.packageOf(S.type) ? P.packageOf(S.type).manifest.version : p.version || 1)}</dd></dl></section>`;
  }
  if (tab === 'look') {
    const looks = Object.fromEntries(Object.entries(D.LOOK_LABEL()).filter(([k]) => (k === 'glb' ? !!d.glb : k === 'svg' ? !!p.svg : !d.glb)));
    return `<section class="psSec"><h4>${tl('Apparence')}</h4>
      ${field(tl('Forme'), sel('part.look.kind', looks, (p.look && p.look.kind) || (d.glb ? 'glb' : 'module'), 'look'))}
      ${d.glb ? '' : `<div class="psRow2">${field(tl('Couleur'), inp('part.look.color', (p.look && p.look.color) || '#1b4f8c', 'look', 'type="color"'))}${field(tl('Étiquette sérigraphiée'), inp('part.look.label', p.look && p.look.label, 'look', `placeholder="${esc(p.prefix || 'U')}"`))}</div>`}
      <p class="psNote">${tl('Une plaquette, un bloc ou un dessin SVG prennent la taille de leurs broches.')}</p></section>
      <section class="psSec"><h4>${tl('Modèle 3D (CAO)')}</h4>
      ${d.glb ? `<p class="psNote">${tl('Modèle importé, en millimètres. Les broches se posent sur sa surface ; un quart de tour les emporte avec lui.')}</p>
        <div class="psBtns"><button type="button" class="btn small" data-s="turnX">${ic('rotate')}<span>${tl('¼ tour X')}</span></button><button type="button" class="btn small" data-s="turnZ">${ic('rotate')}<span>${tl('¼ tour Z')}</span></button><button type="button" class="btn small" data-s="turnY">${ic('rotate')}<span>${tl('¼ tour Y')}</span></button></div>
        <div class="psBtns"><button type="button" class="btn small" data-s="model">${ic('upload')}<span>${tl('Remplacer…')}</span></button><button type="button" class="btn small danger" data-s="unmodel">${ic('trash')}<span>${tl('Retirer le modèle')}</span></button></div>`
    : `<p class="psNote">${tl('Un vrai modèle (STEP de KiCad ou du fabricant, glTF) rend le composant reconnaissable sur la table.')}</p><button type="button" class="btn small wide" data-s="model">${ic('upload')}<span>${tl('Importer un modèle 3D (STEP, GLB)…')}</span></button>`}</section>`;
  }
  if (tab === 'elec') {
    const L = p.limits || {};
    return `<section class="psSec"><h4>${tl('Consommation')}</h4>
      <div class="psRow2">${field(tl('Courant consommé (mA)'), inp('part.ma', p.ma, 'num'))}${field(tl('Source'), sel('part.ds', srcMap, p.ds))}</div></section>
      <section class="psSec"><h4>${tl('Limites')}</h4>
      <div class="psRow2">${field(tl('Courant d’une LED : conseillé (mA)'), inp('part.limits.current.warn', L.current && L.current.warn, 'num'))}${field(tl('maximum (mA)'), inp('part.limits.current.max', L.current && L.current.max, 'num'))}</div>
      <div class="psRow2">${field(tl('Puissance d’une résistance : conseillée (W)'), inp('part.limits.power.warn', L.power && L.power.warn, 'num'))}${field(tl('maximum (W)'), inp('part.limits.power.max', L.power && L.power.max, 'num'))}</div>
      ${field(tl('Source des limites'), sel('part.limits.src', srcMap, L.src))}
      <p class="psNote">${tl('Chaque chiffre cite la fiche technique d’où il vient : ajoutez-la dans l’onglet Sources.')}</p></section>`;
  }
  if (tab === 'beh') {
    const B = p.behaviour || {}, bk = B.led ? 'led' : B.load ? 'load' : '';
    const qs = Object.fromEntries(Object.entries(QUANT).filter(([, q]) => !q.bool).map(([k, q]) => [k, q.label])), qAll = Object.fromEntries(Object.entries(QUANT).map(([k, q]) => [k, q.label]));
    const aRows = (B.analogOut || []).map((o, i) => { const f = k => `part.behaviour.analogOut.${i}.${k}`; return `<div class="psCard"><div class="psRow2">${field(tl('Broche'), sel(f('pin'), pinMap, o.pin))}${field(tl('Grandeur'), sel(f('quantity'), qs, o.quantity))}</div>
      <div class="psField"><span>${tl('Quand la grandeur va de … à … (unités de la grandeur)')}</span><span class="psPair">${inp(f('from.0'), o.from && o.from[0], 'num')}<b>→</b>${inp(f('from.1'), o.from && o.from[1], 'num')}</span></div>
      <div class="psField"><span>${o.ratio ? tl('la sortie va de … à … (fraction de l’alimentation)') : tl('la sortie va de … à … (V)')}</span><span class="psPair">${inp(f('to.0'), o.to && o.to[0], 'num')}<b>→</b>${inp(f('to.1'), o.to && o.to[1], 'num')}</span></div>
      <div class="psCardFoot">${chk(f('ratio'), o.ratio, tl('fraction de l’alimentation'))}<button type="button" class="tb danger" data-act="delout" data-l="analogOut" data-i="${i}" aria-label="${esc(tl('Retirer'))}">${ic('trash')}</button></div></div>`; }).join('');
    const dRows = (B.digitalOut || []).map((o, i) => { const f = k => `part.behaviour.digitalOut.${i}.${k}`; return `<div class="psCard"><div class="psRow2">${field(tl('Broche'), sel(f('pin'), pinMap, o.pin))}${field(tl('Grandeur'), sel(f('quantity'), qAll, o.quantity))}</div>
      <div class="psRow2">${field(tl('Seuil'), inp(f('threshold'), o.threshold, 'num'))}<span></span></div>
      <div class="psCardFoot">${chk(f('activeLow'), o.activeLow, tl('active à l’état bas'))}<button type="button" class="tb danger" data-act="delout" data-l="digitalOut" data-i="${i}" aria-label="${esc(tl('Retirer'))}">${ic('trash')}</button></div></div>`; }).join('');
    return `<section class="psSec"><h4>${tl('Nature électrique')}</h4>
      <label class="psField"><span>${tl('Le composant est électriquement…')}</span><select data-act="bk">${D.opts({ '': tl('un module (selon ses broches)'), led: tl('une LED'), load: tl('une charge résistive') }, bk)}</select></label>
      ${bk === 'led' ? `<div class="psRow2">${field(tl('Anode'), sel('part.behaviour.led.anode', pinMap, B.led.anode))}${field(tl('Cathode'), sel('part.behaviour.led.cathode', pinMap, B.led.cathode))}</div><div class="psRow2">${field(tl('Couleur'), sel('part.behaviour.led.color', { red: tl('rouge'), green: tl('verte'), blue: tl('bleue'), yellow: tl('jaune'), white: tl('blanche'), orange: tl('orange') }, B.led.color))}${field(tl('Tension de seuil (V)'), inp('part.behaviour.led.vf', B.led.vf, 'num'))}</div>` : ''}
      ${bk === 'load' ? `<div class="psRow2">${field(tl('Entre'), sel('part.behaviour.load.pin', pinMap, B.load.pin))}${field(tl('et'), sel('part.behaviour.load.to', pinMap, B.load.to))}</div>${field(tl('Résistance (Ω)'), inp('part.behaviour.load.ohms', B.load.ohms, 'num'))}` : ''}</section>
      <section class="psSec"><h4>${tl('Sorties analogiques (capteur)')}</h4>${aRows || `<p class="psNote">${tl('La tension d’une broche suit une grandeur du milieu : lumière, température…')}</p>`}<button type="button" class="btn small" data-act="addout" data-l="analogOut">${ic('plus')}<span>${tl('Ajouter')}</span></button></section>
      <section class="psSec"><h4>${tl('Sorties tout-ou-rien (capteur)')}</h4>${dRows || `<p class="psNote">${tl('Une broche bascule quand une grandeur passe un seuil.')}</p>`}<button type="button" class="btn small" data-act="addout" data-l="digitalOut">${ic('plus')}<span>${tl('Ajouter')}</span></button></section>`;
  }
  if (tab === 'docs') {
    const docs = p.docs || {};
    return `<section class="psSec"><h4>${tl('Documentation')}</h4>
      ${field(tl('Fonctionnement'), area('part.docs.text', docs.text, 'str', 5))}
      ${field(tl('Caractéristiques (une par ligne : libellé : valeur)'), area('part.docs.specs', (docs.specs || []).map(r => r.join(' : ')).join('\n'), 'specs', 4, `placeholder="${esc(tl('Tension : 3,3 à 5 V'))}"`))}
      ${field(tl('Utilisations (une par ligne)'), area('part.docs.uses', (docs.uses || []).join('\n'), 'lines', 3))}
      ${field(tl('Erreurs fréquentes (une par ligne)'), area('part.docs.mistakes', (docs.mistakes || []).join('\n'), 'lines', 3))}</section>`;
  }
  const srcRows = Object.entries(p.sources || {}).map(([k, s]) => `<div class="psCard"><div class="psCardHead"><b>${esc(k)}</b><span class="psGrow"></span><button type="button" class="tb danger" data-act="delsrc" data-k="${esc(k)}" aria-label="${esc(tl('Retirer'))}">${ic('trash')}</button></div>
    ${field(tl('Titre du document'), inp(`part.sources.${k}.title`, s.title))}${field(tl('Éditeur'), inp(`part.sources.${k}.publisher`, s.publisher))}${field('URL', inp(`part.sources.${k}.url`, s.url, 'str', 'placeholder="https://…" spellcheck="false"'))}${field(tl('Section, page, citation'), inp(`part.sources.${k}.section`, s.section))}</div>`).join('');
  return `<section class="psSec"><h4>${tl('Sources')}</h4><p class="psNote">${tl('Les fiches techniques que citent les tensions, la consommation et les limites.')}</p>${srcRows}<button type="button" class="btn small" data-act="addsrc">${ic('plus')}<span>${tl('Ajouter une fiche technique')}</span></button></section>`;
}

/* ---------- Panneau du bas : broches, problèmes, symbole ---------- */
function renderDock() {
  const e = errCount(), n = S.issues.length;
  q$('[data-c="docktabs"]').innerHTML = [['pins', 'list', tl('Broches'), S.draft.pins.length], ['issues', 'alert', tl('Vérification'), n, e ? 'err' : ''], ['symbol', 'schematic', tl('Symbole'), null]]
    .map(([k, icon, l, c, cls]) => `<button type="button" role="tab" class="psDTab${S.dock === k ? ' on' : ''}" data-dock="${k}" aria-selected="${S.dock === k}">${ic(icon)}<span>${esc(l)}</span>${c != null ? `<em class="${cls || ''}">${c}</em>` : ''}</button>`).join('');
  q$('[data-c="docktools"]').innerHTML = S.dock === 'pins' ? `<button type="button" class="btn small" data-tool="pin">${ic('plus')}<span>${tl('Broche')}</span></button><button type="button" class="btn small" data-tool="row">${ic('list')}<span>${tl('Rangée')}</span></button><button type="button" class="btn small" data-s="selAll"${S.draft.pins.length ? '' : ' disabled'}>${tl('Tout choisir')}</button>` : '';
  const body = q$('[data-c="dock"]');
  body.innerHTML = S.dock === 'issues' ? issuesHtml() : S.dock === 'symbol' ? symbolHtml() : pinTable();
}
function pinTable() {
  const d = S.draft, K = D.KIND_LABEL(), N = D.NEED_LABEL();
  if (!d.pins.length) return `<div class="psEmpty">${ic('pin')}<p>${tl('Aucune broche. Choisissez l’outil Broche (P) et cliquez sur le modèle, ou collez une rangée de noms avec l’outil Rangée (H).')}</p></div>`;
  const bad = new Set(S.issues.filter(x => x.sev === 'err' && x.pin != null).map(x => x.pin));
  const rows = d.pins.map((q, i) => {
    const o = D.pinOut(q), na = '<span class="psNa">—</span>';
    return `<tr data-i="${i}" class="${S.sel.includes(i) ? 'on' : ''}${bad.has(i) ? ' bad' : ''}" aria-selected="${S.sel.includes(i)}">
      <td class="psCn"><span class="psDot" style="${kv(o.kind)}"></span>${i + 1}</td>
      <td><input data-row="${i}" data-col="name" value="${esc(q.name)}" spellcheck="false" maxlength="16" aria-label="${esc(tl('Nom de la broche'))}"></td>
      <td><select data-row="${i}" data-col="kind" aria-label="${esc(tl('Nature de {0}', q.name))}">${D.opts(K, o.kind)}</select></td>
      <td>${o.kind === 'io' ? `<select data-row="${i}" data-col="need" aria-label="${esc(tl('Ce qu’attend {0}', q.name))}">${D.opts(N, o.need)}</select>` : na}</td>
      <td class="psCv">${o.kind === 'pwr' ? (Array.isArray(o.v) ? `${fmt(o.v[0])}–${fmt(o.v[1])} V` : esc(tl('logique'))) : na}</td>
      <td>${o.kind === 'io' || o.kind === 'gnd' ? `<select data-row="${i}" data-col="via" aria-label="${esc(tl('Résistance en série'))}">${D.opts(VIA(), q.via || '')}</select>` : na}</td>
      ${['x', 'y', 'z'].map(k => `<td class="psCxyz"><input data-row="${i}" data-col="${k}" value="${numStr(q[k])}" inputmode="decimal" aria-label="${k.toUpperCase()}"></td>`).join('')}
      <td class="psCst">${bad.has(i) ? `<span class="psBadIc" data-tip="${esc(S.issues.find(x => x.pin === i && x.sev === 'err').text)}">${ic('alert')}</span>` : ''}</td></tr>`;
  }).join('');
  return `<div class="psTableWrap"><table class="psTable" role="grid"><thead><tr><th>#</th><th>${tl('Nom')}</th><th>${tl('Nature')}</th><th>${tl('Ce qu’elle attend')}</th><th>${tl('Tension')}</th><th>${tl('En série')}</th><th>X</th><th>Y</th><th>Z</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function issuesHtml() {
  if (!S.issues.length) return `<div class="psEmpty ok">${ic('check')}<p>${tl('Aucun problème : le composant est prêt et sa fiche est complète.')}</p></div>`;
  const group = (sev, title) => { const l = S.issues.map((x, i) => [x, i]).filter(([x]) => x.sev === sev); return l.length ? `<h5 class="${sev}">${esc(title)} <em>${l.length}</em></h5>${l.map(([x, i]) => `<button type="button" class="psIssue ${sev}" data-go="${i}">${ic(sev === 'err' ? 'alert' : 'info')}<span>${esc(x.text)}</span>${x.where ? `<small>${esc(x.where)}</small>` : ''}</button>`).join('')}` : ''; };
  return `<div class="psIssues">${group('err', tl('Erreurs : l’enregistrement attend leur correction'))}${group('warn', tl('À vérifier'))}${group('info', tl('Pour une fiche complète'))}</div>`;
}
/** Aperçu du symbole : celui du paquet (KiCad) s'il en a un, sinon le bloc que le schéma dessinera. */
function symbolHtml() {
  const d = S.draft, B = (d.part && d.part.behaviour) || {};
  const note = B.led && d.pins.length === 2 ? tl('Composant déclaré comme LED : le schéma pourra utiliser le symbole de la LED.') : B.load && d.pins.length === 2 ? tl('Charge résistive : le schéma pourra utiliser le symbole de la résistance.') : d.part.symbol ? tl('Symbole fourni par le paquet (importé de KiCad).') : tl('Bloc dessiné d’après la place des broches : à gauche et à droite, dans l’ordre où elles sont sur le module.');
  return `<div class="psSym"><div class="psSymCanvas">${d.pins.length ? (d.part.symbol ? symbolOwnSvg(d) : symbolBlockSvg(d)) : `<p class="psNote">${tl('Le symbole apparaît dès la première broche.')}</p>`}</div><p class="psNote">${esc(note)}</p></div>`;
}
function symbolBlockSvg(d) {
  const G = 2.54, pins = d.pins.map(q => ({ q, o: D.pinOut(q) }));
  const xs = pins.map(p => p.q.x), zs = pins.map(p => p.q.z), cx = xs.reduce((a, b) => a + b, 0) / pins.length, cz = zs.reduce((a, b) => a + b, 0) / pins.length;
  const distinct = v => new Set(v.map(x => Math.round(x))).size, wide = distinct(zs) < distinct(xs);
  let L, R;
  if (pins.length && (distinct(zs) === 1 || distinct(xs) === 1) && !(distinct(zs) > 1 && distinct(xs) > 1)) {
    const all = [...pins].sort((a, b) => (distinct(zs) === 1 ? a.q.x - b.q.x : a.q.z - b.q.z));
    L = all; R = [];
  } else if (wide) { L = pins.filter(p => p.q.z >= cz).sort((a, b) => a.q.x - b.q.x); R = pins.filter(p => p.q.z < cz).sort((a, b) => b.q.x - a.q.x); }
  else { L = pins.filter(p => p.q.x < cx).sort((a, b) => a.q.z - b.q.z); R = pins.filter(p => p.q.x >= cx).sort((a, b) => a.q.z - b.q.z); }
  const cw = 1.05, tw = s => s.length * cw;
  const W = Math.max(Math.ceil((Math.max(0, ...L.map(p => tw(p.q.name))) + Math.max(0, ...R.map(p => tw(p.q.name))) + 4) / G) * G, 5 * G);
  const rows = Math.max(L.length, R.length, 1), Hh = (rows + 1) * G, pad = 6;
  const pin = (p, x, y, dir) => { const c = KIND_COLOR[p.o.kind], x2 = x + dir * G; return `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y}" class="svLead"/><circle cx="${x2}" cy="${y}" r="0.55" fill="${c}"/><text x="${x + -dir * 0.8}" y="${y + 0.62}" text-anchor="${dir < 0 ? 'start' : 'end'}" class="svPin">${esc(p.q.name)}</text>`; };
  const body = `<rect x="0" y="0" width="${W}" height="${Hh}" rx="0.4" class="svBody"/>`;
  const ls = L.map((p, i) => pin(p, 0, G * (i + 1), -1)).join(''), rs = R.map((p, i) => pin(p, W, G * (i + 1), 1)).join('');
  const title = `<text x="${W / 2}" y="-1.6" text-anchor="middle" class="svRef">${esc((d.part.prefix || 'U') + '1')}</text><text x="${W / 2}" y="${Hh + 3}" text-anchor="middle" class="svVal">${esc(d.name)}</text>`;
  return `<svg viewBox="${-G - pad} ${-pad} ${W + 2 * G + 2 * pad} ${Hh + 2 * pad}" class="psSvg" role="img" aria-label="${esc(tl('Symbole du schéma'))}">${body}${ls}${rs}${title}</svg>`;
}
function symbolOwnSvg(d) {
  const s = d.part.symbol, pts = [], push = (x, y) => pts.push([x, y]);
  (s.lines || []).forEach(l => l.pts.forEach(p => push(p[0], p[1])));
  (s.rects || []).forEach(r => { push(r.x, r.y); push(r.x + r.w, r.y + r.h); });
  (s.circles || []).concat(s.arcs || []).forEach(c => { push(c.x - c.r, c.y - c.r); push(c.x + c.r, c.y + c.r); });
  (s.texts || []).forEach(t => push(t.x, t.y));
  Object.values(s.pins || {}).forEach(p => push(p.x, p.y));
  if (!pts.length) return '';
  const x0 = Math.min(...pts.map(p => p[0])) - 4, y0 = Math.min(...pts.map(p => p[1])) - 4, x1 = Math.max(...pts.map(p => p[0])) + 4, y1 = Math.max(...pts.map(p => p[1])) + 4;
  const w = v => (v || 0.25);
  const lines = (s.lines || []).map(l => `<polyline points="${l.pts.map(p => p.join(',')).join(' ')}${l.close ? ' ' + l.pts[0].join(',') : ''}" stroke-width="${w(l.w)}" class="${l.fill ? 'svFill' : ''}"/>`).join('');
  const rects = (s.rects || []).map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" stroke-width="${w(r.lw)}" class="${r.fill ? 'svFill' : ''}"/>`).join('');
  const circles = (s.circles || []).map(c => `<circle cx="${c.x}" cy="${c.y}" r="${c.r}" stroke-width="${w(c.w)}" class="${c.fill ? 'svFill' : ''}"/>`).join('');
  const arcs = (s.arcs || []).map(c => { const a = c.a0 * Math.PI / 180, b = c.a1 * Math.PI / 180, sx = c.x + c.r * Math.cos(a), sy = c.y + c.r * Math.sin(a), ex = c.x + c.r * Math.cos(b), ey = c.y + c.r * Math.sin(b), large = Math.abs(c.a1 - c.a0) > 180 ? 1 : 0; return `<path d="M${sx},${sy} A${c.r},${c.r} 0 ${large} 1 ${ex},${ey}" stroke-width="${w(c.w)}"/>`; }).join('');
  const texts = (s.texts || []).map(t => `<text x="${t.x}" y="${t.y}" font-size="${t.s || 1.6}" text-anchor="${t.a === 'm' ? 'middle' : t.a === 'r' ? 'end' : 'start'}" class="svTx">${esc(t.t)}</text>`).join('');
  const kinds = Object.fromEntries(d.pins.map(q => [q.name, D.pinOut(q).kind]));
  const anchors = Object.entries(s.pins || {}).map(([k, p]) => `<circle cx="${p.x}" cy="${p.y}" r="0.6" fill="${KIND_COLOR[kinds[k]] || '#e5484d'}" stroke="none"><title>${esc(k)}</title></circle>`).join('');
  return `<svg viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" class="psSvg svOwn" role="img" aria-label="${esc(tl('Symbole du schéma'))}"><g class="svInk">${lines}${rects}${circles}${arcs}</g>${texts}${anchors}</svg>`;
}

/* ---------- Événements du panneau ---------- */
function getPath(o, path) { return path.split('.').reduce((x, k) => (x == null ? x : x[k]), o); }
function setPath(o, path, v) {
  const ks = path.split('.'); let x = o;
  for (let i = 0; i < ks.length - 1; i++) { const k = ks[i]; if (x[k] == null || typeof x[k] !== 'object') x[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; x = x[k]; }
  const last = ks[ks.length - 1];
  if (v === undefined) { if (Array.isArray(x)) x[last] = undefined; else delete x[last]; } else x[last] = v;
}
function readValue(el, t = el.dataset.t) {
  const raw = el.type === 'checkbox' ? el.checked : el.value;
  if (t === 'bool') return raw || undefined;
  if (t === 'num') { const s = String(raw).trim().replace(',', '.'); return s === '' ? undefined : Number.isFinite(+s) ? +s : undefined; }
  if (t === 'lines') return String(raw).split('\n').map(s => s.trim()).filter(Boolean);
  if (t === 'specs') return String(raw).split('\n').map(s => s.split(/\s*:\s*/)).filter(r => r[0] && r.length > 1).map(r => [r[0].trim(), r.slice(1).join(' : ').trim()]);
  return String(raw).trim() || undefined;
}
async function onClick(e) {
  const t = e.target;
  const tool = t.closest('[data-tool]'); if (tool) { setTool(tool.dataset.tool); return; }
  const view = t.closest('[data-view]'); if (view) { setView(view.dataset.view); return; }
  const tab = t.closest('[data-tab]'); if (tab) { S.tab = tab.dataset.tab; renderInsp(); return; }
  const dt = t.closest('[data-dock]'); if (dt) { S.dock = dt.dataset.dock; renderDock(); return; }
  const go = t.closest('[data-go]'); if (go) { goIssue(S.issues[+go.dataset.go]); return; }
  const tpl = t.closest('[data-tpl]'); if (tpl) { await useTemplate(tpl.dataset.tpl); return; }
  const rv = t.closest('[data-rv]'); if (rv) { S.row[rv.dataset.rv] = rv.dataset.v; renderInsp(); updateGhost(); renderHint(); return; }
  const al = t.closest('[data-al]'); if (al) { align(al.dataset.al); return; }
  const ds = t.closest('[data-dist]'); if (ds) { distribute(ds.dataset.dist); return; }
  const act = t.closest('[data-act]'); if (act && act.tagName !== 'SELECT') { partAction(act); return; }
  const tr = t.closest('.psTable tbody tr'); if (tr && !t.closest('input,select')) { pickRow(+tr.dataset.i, e); return; }
  const b = t.closest('[data-s]'); if (!b || b.matches('input,select,textarea')) return;
  const s = b.dataset.s;
  if (s === 'close') await close();
  else if (s === 'undo') undo();
  else if (s === 'redo') redo();
  else if (s === 'issues') { S.dock = 'issues'; renderDock(); }
  else if (s === 'save') await save();
  else if (s === 'saveMenu') await saveMenu(b);
  else if (s === 'export') await exportPart();
  else if (s === 'open') await askOpen();
  else if (s === 'frame') frame();
  else if (s === 'help') { S.help = !S.help; renderRail(); renderHelp(); }
  else if (s === 'snap') { if (!prefs.pitch) prefs.pitch = 2.54; else prefs.snap = !prefs.snap; savePrefs(); renderBar(); updateGrid(); }
  else if (s === 'labels') { prefs.labels = !prefs.labels; savePrefs(); renderBar(); redraw(); }
  else if (s === 'galClose') { q$('[data-c="gallery"]').hidden = true; q$('.psName').focus(); }
  else if (s === 'galModel' || s === 'model') q$('[data-c="fileModel"]').click();
  else if (s === 'galFile') q$('[data-c="filePart"]').click();
  else if (s === 'unmodel') edit(() => { delete S.draft.glb; S.draft.part.look = { kind: 'module', color: '#1b4f8c' }; }, true);
  else if (s === 'turnX' || s === 'turnZ' || s === 'turnY') await turnModel(s.slice(-1).toLowerCase());
  else if (s === 'rowCenter') placeRow(freeAnchor());
  else if (s === 'dup') duplicate();
  else if (s === 'del') deleteSel();
  else if (s === 'selAll') select(S.draft.pins.map((_, i) => i));
  else if (s === 'rename') renameSeries();
}
async function onChange(e) {
  const el = e.target;
  if (el.dataset.s === 'name') { const v = J.cleanStr(el.value.trim(), 60); if (!v) { el.value = S.draft.name; return; } if (v !== S.draft.name) edit(() => { S.draft.name = v; }); return; }
  if (el.dataset.s === 'pitch') { prefs.pitch = +el.value; prefs.snap = !!prefs.pitch; savePrefs(); renderBar(); updateGrid(); renderInsp(); return; }
  if (el.dataset.s === 'next') { S.next = D.cleanPinName(el.value) || 'P1'; renderHint(); updateGhost(); return; }
  if (el.dataset.row != null) { cellChange(el); return; }
  if (el.dataset.p) { pinFieldChange(el); return; }
  if (el.dataset.act === 'bk') { behaviourKind(el.value); return; }
  if (el.dataset.f) partFieldChange(el);
}
function onInput(e) {
  const el = e.target;
  if (el.dataset.r) {
    const k = el.dataset.r;
    if (k === 'names' || k === 'prefix') S.row[k] = el.value;
    else {
      const v = parseFloat(String(el.value).replace(',', '.'));
      if (Number.isFinite(v)) S.row[k] = Math.max(k === 'count' ? 1 : 0, Math.min(k === 'count' ? 64 : 1000, v));
    }
    updateGhost(); renderHint();
    const box = root.querySelector('.psInsp .psChips'), names = rowNames();
    if (box) { box.innerHTML = names.slice(0, 40).map(n => { const o = D.pinOut({ name: n, x: 0, y: 0, z: 0 }); return `<i style="${kv(o.kind)}">${esc(n)}</i>`; }).join(''); box.previousElementSibling.textContent = tl('{0} broche(s)', names.length); }
    const c = q$('[data-s="rowCenter"]'); if (c) c.disabled = !names.length;
  }
}
function partFieldChange(el) {
  const d = S.draft, f = el.dataset.f;
  let v = readValue(el);
  if (f === 'name') { if (!v) { renderInsp(); return; } v = J.cleanStr(v, 60); }
  if (f === 'part.prefix' && v) v = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || undefined;
  const rebuild = /^part\.(look|prefix|behaviour\.led)/.test(f) || el.dataset.t === 'look';
  edit(() => {
    if (f === 'name') d.name = v; else setPath(d, f, v);
    if (/^part\.behaviour\.(analog|digital)Out\.\d+\.ratio$/.test(f)) { /* la plage de sortie change de sens : rien d'autre à faire */ }
  }, rebuild);
}
function behaviourKind(k) {
  const d = S.draft;
  edit(() => {
    const b = d.part.behaviour = d.part.behaviour || {}; delete b.led; delete b.load;
    const names = d.pins.map(q => q.name), g = d.pins.find(q => D.pinOut(q).kind === 'gnd');
    if (k === 'led') b.led = { anode: names.find(n => /^A/i.test(n)) || names[0], cathode: names.find(n => /^K|^C/i.test(n)) || names[1], color: 'red', vf: 2 };
    if (k === 'load') b.load = { pin: names[0], to: (g && g.name) || names[1], ohms: 220 };
  }, true);
}
function partAction(b) {
  const d = S.draft, B = () => (d.part.behaviour = d.part.behaviour || {});
  edit(() => {
    if (b.dataset.act === 'addsrc') { d.part.sources = d.part.sources || {}; let i = 1; while (d.part.sources['s' + i]) i++; d.part.sources['s' + i] = { title: '', publisher: '', url: 'https://', section: '' }; if (!d.part.limits || !d.part.limits.src) setPath(d, 'part.limits.src', 's' + i); }
    if (b.dataset.act === 'delsrc') delete d.part.sources[b.dataset.k];
    if (b.dataset.act === 'addout') {
      const io = d.pins.map(D.pinOut).filter(q => q.kind === 'io'), l = b.dataset.l;
      const pin = (io.find(q => (l === 'analogOut' ? q.need === 'adc' : q.need === 'in')) || io[0] || d.pins[0] || {}).name;
      (B()[l] = B()[l] || []).push(l === 'analogOut' ? { pin, quantity: 'lux', from: [0, 2000], to: [0.9, 0.1], ratio: true } : { pin, quantity: 'lux', threshold: 100, activeLow: false });
    }
    if (b.dataset.act === 'delout') B()[b.dataset.l].splice(+b.dataset.i, 1);
  });
}
/** Propriété d'une broche, appliquée à toutes les broches choisies (inspecteur) ou à une ligne du tableau. */
function applyPin(q, k, v) {
  if (k === 'kind') {
    if (!v) return;
    q.kind = v;
    if (v === 'io') q.need = q.need || D.defaults(q).need || 'io'; else delete q.need;
    if (v === 'pwr') q.v = q.v || 'logic'; else { delete q.v; delete q.ds; }
    if (v !== 'io') ['opt', 'lv5', 'lv3', 'idle', 'pull'].forEach(x => delete q[x]);
    if (v !== 'io' && v !== 'gnd') delete q.via;
    return;
  }
  if (k === 'need') { if (v) q.need = v; return; }
  if (k === 'vmode') { if (!v) return; q.v = v === 'range' ? (Array.isArray(q.v) ? q.v : [3, 5.5]) : 'logic'; if (!Array.isArray(q.v)) delete q.ds; return; }
  if (k === 'vmin' || k === 'vmax') { if (v == null) return; if (!Array.isArray(q.v)) q.v = [3, 5.5]; q.v[k === 'vmin' ? 0 : 1] = v; return; }
  if (k === 'idle') { if (v === '0' || v === '1') q.idle = +v; else delete q.idle; return; }
  if (k === 'x' || k === 'y' || k === 'z') { if (v != null) q[k] = r3(v); return; }
  if (v === undefined || v === '' || v === false) delete q[k]; else q[k] = v;
}
const NUM_KEYS = new Set(['vmin', 'vmax', 'x', 'y', 'z']);
function pinFieldChange(el) {
  const k = el.dataset.p, d = S.draft;
  if (k === 'name') { rename(S.sel[0], el.value); return; }
  if (el.tagName === 'SELECT' && el.selectedOptions[0] && el.selectedOptions[0].hasAttribute('data-mixed')) return; // « valeurs différentes » : rien à appliquer
  const v = NUM_KEYS.has(k) ? readValue(el, 'num') : el.type === 'checkbox' ? el.checked || undefined : el.value === '' ? undefined : el.value;
  if (NUM_KEYS.has(k) && v == null) { renderInsp(); return; }
  edit(() => S.sel.forEach(i => d.pins[i] && applyPin(d.pins[i], k, v)), k === 'kind' || k === 'x' || k === 'y' || k === 'z');
}
function cellChange(el) {
  const i = +el.dataset.row, k = el.dataset.col, d = S.draft;
  if (!d.pins[i]) return;
  if (k === 'name') { rename(i, el.value); return; }
  const v = NUM_KEYS.has(k) ? readValue(el, 'num') : el.value === '' ? undefined : el.value;
  if (NUM_KEYS.has(k) && v == null) { el.value = numStr(d.pins[i][k]); return; }
  edit(() => applyPin(d.pins[i], k, v), k === 'kind' || k === 'x' || k === 'y' || k === 'z');
}
/** Renomme une broche et tout ce qui la désigne : comportement (LED, charge, sorties) et ancres du symbole. */
function rename(i, raw) {
  const d = S.draft, q = d.pins[i]; if (!q) return;
  const name = D.cleanPinName(raw);
  if (!name || name === q.name) { schedule(); return; }
  if (d.pins.some((p, j) => j !== i && p.name === name)) { say(tl('Le nom {0} est déjà pris par une autre broche.', name), 'warn'); schedule(); return; }
  if (name !== String(raw).trim()) say(tl('Nom simplifié en {0} (lettres, chiffres et + - _ . / ~, 16 au plus).', name), 'warn');
  const old = q.name;
  edit(() => {
    q.name = name;
    const B = d.part.behaviour || {}, swap = (o, k) => { if (o && o[k] === old) o[k] = name; };
    if (B.led) { swap(B.led, 'anode'); swap(B.led, 'cathode'); }
    if (B.load) { swap(B.load, 'pin'); swap(B.load, 'to'); }
    (B.analogOut || []).forEach(o => swap(o, 'pin')); (B.digitalOut || []).forEach(o => swap(o, 'pin'));
    const sym = d.part.symbol; if (sym && sym.pins && sym.pins[old]) { sym.pins[name] = sym.pins[old]; delete sym.pins[old]; }
  }, true);
}
/** Entrée dans le tableau : valider et descendre d'une ligne (comme un tableur) ; flèches haut et bas aussi. */
function onFieldKey(e) {
  const el = e.target;
  if (el.dataset.row == null || e.altKey || e.ctrlKey || e.metaKey) return;
  const dir = e.key === 'Enter' || (e.key === 'ArrowDown' && el.tagName === 'INPUT') ? 1 : e.key === 'ArrowUp' && el.tagName === 'INPUT' ? -1 : 0;
  if (!dir) return;
  e.preventDefault();
  const to = +el.dataset.row + (e.shiftKey && e.key === 'Enter' ? -1 : dir), col = el.dataset.col;
  el.blur();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const n = q$(`[data-row="${to}"][data-col="${col}"]`) || q$(`[data-row="${to}"][data-col="name"]`);
    if (n) { n.focus(); if (n.select) n.select(); }
  }));
}
function onFocusIn(e) {
  const el = e.target;
  if (el.dataset.row == null) return;
  const i = +el.dataset.row;
  if (!(S.sel.length === 1 && S.sel[0] === i)) { S.sel = [i]; S.anchor = i; selChanged(false); }
}
function pickRow(i, e) {
  if (e.shiftKey && S.anchor >= 0) { const [a, b] = [Math.min(S.anchor, i), Math.max(S.anchor, i)]; select(Array.from({ length: b - a + 1 }, (_, k) => a + k)); return; }
  if (e.metaKey || e.ctrlKey) { select(S.sel.includes(i) ? S.sel.filter(x => x !== i) : [...S.sel, i], i); return; }
  select([i], i);
}
function goIssue(x) {
  if (!x) return;
  if (x.pin != null && S.draft.pins[x.pin]) { setTool('select'); select([x.pin], x.pin); S.dock = 'pins'; renderDock(); const tr = q$(`.psTable tr[data-i="${x.pin}"]`); if (tr) tr.scrollIntoView({ block: 'nearest' }); return; }
  if (x.tool) { setTool(x.tool); return; }
  if (x.dock) { S.dock = x.dock; renderDock(); return; }
  if (x.tab) {
    setTool('select'); S.sel = []; selChanged(); S.tab = x.tab; renderInsp();
    const path = x.path || '';
    const el = [...root.querySelectorAll('.psInsp [data-f]')].find(n => path && (n.dataset.f === path || path.startsWith(n.dataset.f + '.') || n.dataset.f.startsWith(path)));
    if (el) { el.focus(); el.classList.add('psFlash'); setTimeout(() => el.classList.remove('psFlash'), 1200); }
  }
}

/* ---------- Sélection et outils ---------- */
function select(list, anchor) {
  S.sel = [...new Set(list)].filter(i => i >= 0 && i < S.draft.pins.length).sort((a, b) => a - b);
  if (anchor != null) S.anchor = anchor; else if (S.sel.length === 1) S.anchor = S.sel[0];
  selChanged();
}
/** Sélection changée : la vue, les lignes du tableau et l'inspecteur suivent, sans redessiner le tableau. */
function selChanged(insp = true) {
  paintPins();
  root.querySelectorAll('.psTable tbody tr').forEach(tr => { const on = S.sel.includes(+tr.dataset.i); tr.classList.toggle('on', on); tr.setAttribute('aria-selected', on); });
  if (insp) renderInsp(); else if (S.tool === 'select') { const box = q$('[data-c="insp"]'); box.innerHTML = S.sel.length ? pinInsp() : partInsp(); }
  renderHint();
}
function setTool(t) {
  if (!['select', 'pin', 'row'].includes(t)) return;
  S.tool = t;
  if (t !== 'select') S.sel = [];
  renderRail(); renderInsp(); renderHint(); paintPins(); updateGhost();
  if (t === 'pin') setTimeout(() => { const n = q$('[data-s="next"]'); if (n) n.select(); }, 30);
  if (t === 'row') setTimeout(() => { const n = q$('[data-r="names"]'); if (n) n.focus(); }, 30);
}
/** Nom suivant : P1 → P2, D13 → D14, en sautant les noms déjà pris. */
function nextName(name) {
  const used = new Set(S ? S.draft.pins.map(q => q.name) : []), m = /^(.*?)(\d+)$/.exec(name);
  let k = m ? +m[2] + 1 : 2, n;
  do { n = D.cleanPinName(`${m ? m[1] : name}${k++}`); } while (used.has(n) && k < 999);
  return n;
}
/** Noms de la rangée : collés (un par ligne, ou séparés par des virgules) ou numérotés. */
function rowNames() {
  const r = S.row, txt = String(r.names || '').trim();
  let list;
  if (txt) {
    // Une ligne par broche, copiée d'un tableau (« 1  VCC  Alimentation ») : le premier mot qui n'est pas un numéro.
    if (/\n/.test(txt)) list = txt.split(/\n+/).map(l => l.split(/[\t,;]+|\s{2,}|\s/).map(s => s.trim()).filter(Boolean)).map(t => t.find(s => !/^\d+$/.test(s)) || t[0]).filter(Boolean);
    else list = txt.split(/[,;\t\s]+/).filter(Boolean);
  } else list = Array.from({ length: Math.max(1, Math.min(64, Math.round(+r.count) || 1)) }, (_, i) => `${r.prefix || ''}${(Math.round(+r.start) || 0) + i}`);
  return list.map(D.cleanPinName).filter(Boolean).slice(0, 64);
}
/** Positions de la rangée autour de son ancre : une rangée, ou deux comme un boîtier DIP (1 en bas à gauche, sens inverse en haut). */
function rowLayout(anchor) {
  const r = S.row, names = rowNames(), n = names.length, two = +r.rows === 2 && n > 1, pitch = +r.pitch || 2.54, along = r.dir === 'z' ? 'z' : 'x', across = along === 'x' ? 'z' : 'x';
  const per = two ? Math.ceil(n / 2) : n;
  return names.map((name, i) => {
    const second = two && i >= per, k = second ? n - 1 - i : i;
    const p = { name, x: anchor.x, y: anchor.y, z: anchor.z };
    p[along] = r3(anchor[along] + (k - (per - 1) / 2) * pitch);
    if (two) p[across] = r3(anchor[across] + (second ? -1 : 1) * (+r.gap || 7.62) / 2);
    return p;
  });
}
function placeRow(anchor) {
  const d = S.draft, pts = rowLayout(anchor); if (!pts.length) return;
  const used = new Set(d.pins.map(q => q.name)), start = d.pins.length;
  edit(() => pts.forEach(p => {
    let k = p.name, i = 2; while (used.has(k)) k = `${p.name.slice(0, 13)}${i++}`; used.add(k);
    const q = { ...p, name: k }; Object.assign(q, D.defaults(q)); d.pins.push(q);
  }), true);
  S.tool = 'select'; select(pts.map((_, i) => start + i), start); renderRail(); renderInsp();
  say(tl('{0} broche(s) posée(s) : vérifiez leur nature dans le tableau.', pts.length), 'ok');
}
function placePin(p) {
  const d = S.draft, name = D.cleanPinName(S.next) || 'P1', ex = d.pins.findIndex(q => q.name === name);
  edit(() => {
    if (ex >= 0) Object.assign(d.pins[ex], { x: p.x, y: p.y, z: p.z });
    else { const q = { name, x: p.x, y: p.y, z: p.z }; Object.assign(q, D.defaults(q)); d.pins.push(q); }
  }, true);
  S.next = nextName(name);
  const n = q$('[data-s="next"]'); if (n) n.value = S.next;
  renderHint(); updateGhost();
  say(ex >= 0 ? tl('Broche {0} déplacée.', name) : tl('Broche {0} posée.', name), 'ok');
}
function deleteSel() {
  if (!S.sel.length) return;
  const d = S.draft, gone = new Set(S.sel), names = S.sel.map(i => d.pins[i].name);
  edit(() => { d.pins = d.pins.filter((_, i) => !gone.has(i)); }, true);
  S.sel = []; selChanged();
  say(tl('{0} broche(s) supprimée(s) : {1}', names.length, names.join(', ')));
}
function duplicate() {
  if (!S.sel.length) return;
  const d = S.draft, step = prefs.pitch || 2.54, used = new Set(d.pins.map(q => q.name)), start = d.pins.length, src = S.sel.map(i => d.pins[i]);
  edit(() => src.forEach(q => { const name = nextFree(q.name, used); used.add(name); d.pins.push({ ...JSON.parse(JSON.stringify(q)), name, x: r3(q.x + step) }); }), true);
  select(src.map((_, i) => start + i), start);
}
function nextFree(name, used) { const m = /^(.*?)(\d+)$/.exec(name); let k = m ? +m[2] + 1 : 2, n; do { n = D.cleanPinName(`${m ? m[1] : name}${k++}`); } while (used.has(n) && k < 999); return n; }
function align(axis) {
  const d = S.draft, l = S.sel.map(i => d.pins[i]); if (l.length < 2) return;
  const v = l[0][axis];
  edit(() => l.forEach(q => { q[axis] = v; }), true);
}
function distribute(axis) {
  const d = S.draft, l = S.sel.map(i => d.pins[i]); if (l.length < 2) return;
  const step = prefs.pitch || 2.54, sorted = [...l].sort((a, b) => a[axis] - b[axis] || d.pins.indexOf(a) - d.pins.indexOf(b)), o = sorted[0][axis];
  const other = axis === 'x' ? 'z' : 'x', base = sorted[0][other];
  edit(() => sorted.forEach((q, i) => { q[axis] = r3(o + i * step); q[other] = base; }), true);
}
function renameSeries() {
  const d = S.draft, prefix = D.cleanPinName(q$('[data-s="renPrefix"]').value) || 'P', start = Math.round(+q$('[data-s="renStart"]').value) || 1;
  const l = S.sel.map(i => d.pins[i]), names = l.map((_, i) => D.cleanPinName(`${prefix}${start + i}`));
  const others = new Set(d.pins.filter(q => !l.includes(q)).map(q => q.name)), clash = names.find(n => others.has(n));
  if (clash) { say(tl('Le nom {0} est déjà pris par une autre broche.', clash), 'warn'); return; }
  edit(() => l.forEach((q, i) => { q.name = names[i]; }), true);
}
function nudge(dx, dy, dz) {
  const d = S.draft; if (!S.sel.length) return;
  edit(() => S.sel.forEach(i => { const q = d.pins[i]; q.x = r3(q.x + dx); q.y = r3(q.y + dy); q.z = r3(q.z + dz); }), lookKind() !== 'glb');
}

/* ---------- Clavier ---------- */
function onKey(e) {
  if (!S || root.hidden) return;
  if (document.querySelector('.sDialogWrap, .sMenu, body > .modal:not([hidden])')) return; // boîte de dialogue, menu ou choix d'un symbole par-dessus l'atelier
  e.stopImmediatePropagation(); // le montage, derrière, ne reçoit pas les touches
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey, el = e.target, typing = el && /INPUT|SELECT|TEXTAREA/.test(el.tagName);
  if (mod && k === 's') { e.preventDefault(); if (typing) el.blur(); setTimeout(() => save(), 0); return; }
  if (k === 'escape') {
    e.preventDefault();
    if (typing) { el.blur(); return; }
    if (!q$('[data-c="gallery"]').hidden) { q$('[data-c="gallery"]').hidden = true; return; }
    if (S.help) { S.help = false; renderRail(); renderHelp(); return; }
    if (S.tool !== 'select') { setTool('select'); return; }
    if (S.sel.length) { select([]); return; }
    close(); return;
  }
  if (typing) return;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'a') { e.preventDefault(); setTool('select'); select(S.draft.pins.map((_, i) => i)); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicate(); return; }
  if (mod || e.altKey && !k.startsWith('arrow')) return;
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSel(); return; }
  if (k === 'v') setTool('select');
  else if (k === 'p') setTool('pin');
  else if (k === 'h') setTool('row');
  else if (k === 'f') frame();
  else if (k === 'g') { prefs.snap = !prefs.snap; if (!prefs.pitch) prefs.pitch = 2.54; savePrefs(); renderBar(); updateGrid(); }
  else if (k === 'l') { prefs.labels = !prefs.labels; savePrefs(); renderBar(); redraw(); }
  else if (e.key === '?') { S.help = !S.help; renderRail(); renderHelp(); }
  else if (['1', '2', '3', '4'].includes(k)) setView(['iso', 'top', 'front', 'side'][+k - 1]);
  else if (k.startsWith('arrow') && S.sel.length) {
    e.preventDefault();
    const step = e.altKey ? 0.1 : (prefs.pitch || 1) * (e.shiftKey ? 10 : 1), h = k === 'arrowleft' ? -1 : k === 'arrowright' ? 1 : 0, vv = k === 'arrowup' ? 1 : k === 'arrowdown' ? -1 : 0;
    const ax = VIEWS[prefs.view];
    if (ax === 'y') nudge(h * step, 0, -vv * step); // dessus : haut de l'écran = vers l'arrière (−Z)
    else if (ax === 'z') nudge(h * step, vv * step, 0);
    else nudge(0, vv * step, -h * step);
  }
}

/* ---------- Ouvrir, importer, enregistrer ---------- */
async function askOpen() {
  if (S.dirty && !(await confirm(tl('Ouvrir un autre composant ?'), esc(tl('Les modifications de « {0} » qui n’ont pas été enregistrées seront perdues.', S.draft.name)), tl('Ouvrir quand même'), true))) return;
  q$('[data-c="filePart"]').click();
}
async function openFile(f) {
  try {
    const r = await H.readDraft(f); if (!r) return;
    S.draft = cloneDraft(r.draft); S.type = r.type || null; S.comp = null; S.sel = []; S.hist = []; S.fut = []; S.dirty = !r.type; S.next = nextName('P0');
    q$('[data-c="gallery"]').hidden = true;
    validate(); await rebuildModel(); frame(); render();
    say(r.msg || tl('{0} ouvert dans l’atelier.', S.draft.name), 'ok');
  } catch (e) { say(tl('Import impossible : ') + String(e.message || e).split('\n')[0], 'err'); }
}
async function importModel(f) {
  const C = await import('../cad/import.js');
  const r = await C.importCad(f, m => say(m));
  const d = S.draft, generic = !d.name || d.name === tl('Nouveau composant');
  edit(() => { d.glb = J.toB64(new Uint8Array(r.glb)); d.part.look = { kind: 'glb' }; if (generic) d.name = J.cleanStr(r.name, 60); }, true);
  q$('[data-c="gallery"]').hidden = true;
  await (V && V.modelReady); frame();
  say(tl('Modèle importé ({0} × {1} mm) : posez ses broches sur sa surface (outil Broche, P).', Math.round(r.size.x), Math.round(r.size.z)), 'ok');
  if (!d.pins.length) setTool('pin');
}
/** Quart de tour du modèle 3D ; les broches tournent avec lui (même recentrage que cad/import.js). */
async function turnModel(axis) {
  const d = S.draft; if (!d.glb || !V || !V.glbTemplate) return;
  const C = await import('../cad/import.js');
  const wrap = new THREE.Group(); wrap.add(V.glbTemplate.clone(true)); wrap.rotation[axis] = -Math.PI / 2; wrap.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(wrap), c = b.getCenter(new V3()), ax = new V3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  const u8 = J.fromB64(d.glb), out = await C.rotateGlb(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), axis);
  edit(() => {
    d.glb = J.toB64(new Uint8Array(out));
    d.pins.forEach(q => { const v = new V3(q.x, q.y, q.z).applyAxisAngle(ax, -Math.PI / 2); q.x = r3(v.x - c.x); q.y = r3(v.y - b.min.y); q.z = r3(v.z - c.z); });
  }, true);
  await (V && V.modelReady); frame();
}
async function exportPart() {
  const d = S.draft;
  validate();
  if (errCount()) { S.dock = 'issues'; renderDock(); say(tl('Export impossible : corrigez d’abord les erreurs ({0}).', errCount()), 'warn'); return; }
  try { d.part.id = d.part.id || D.manifestOf(d).id; const { m, bytes } = D.packDraft(d); await H.download(bytes, m); }
  catch (e) { say(tl('Export impossible : {0}', String(e.message || e).split('\n')[0]), 'warn'); }
}
async function saveMenu(anchor) {
  const v = await menu(anchor, [
    { label: tl('Enregistrer et poser sur le montage'), icon: 'plus', value: 'place' },
    { label: tl('Enregistrer comme nouveau composant'), icon: 'copy', value: 'copy' },
    '-', { label: tl('Exporter (.jpart)'), icon: 'upload', value: 'export' }
  ]);
  if (v === 'place') await save({ place: true });
  if (v === 'copy') { const d = S.draft; delete d.part.id; delete d.part.version; d.name = J.cleanStr(tl('{0} (copie)', d.name), 60); S.type = null; S.comp = null; await save(); }
  if (v === 'export') await exportPart();
}
/**
 * Enregistre : paquet vérifié, installé, rangé dans la bibliothèque personnelle. Un brouillon venu du montage y
 * devient le composant en paquet (fils gardés) ; une nouvelle version d'un composant déjà posé remplace l'ancienne.
 */
async function save({ place = false } = {}) {
  const d = S.draft;
  validate(); render();
  if (errCount()) {
    S.dock = 'issues'; renderDock();
    say(tl('Pas encore enregistrable : {0} erreur(s) à corriger (panneau Vérification).', errCount()), 'warn');
    return false;
  }
  try {
    d.part.id = d.part.id || D.manifestOf(d).id;
    const old = P.packageOf(d.part.id);
    if (old) d.part.version = Math.max(old.manifest.version + 1, d.part.version || 1);
    const { m, bytes } = D.packDraft(d);
    await P.installBytes(bytes, { saved: true });
    await H.saveToLibrary(m.id);
    const data = A.projectData(), placed = data.comps.some(x => x.type === m.id);
    const fromComp = S.comp && data.comps.find(x => x.id === S.comp.id);
    if (fromComp) { fromComp.type = m.id; delete fromComp.custom; fromComp.name = S.comp.name; }
    if (fromComp || placed) await A.refresh(data); // composants déjà posés : nouvelle version, fils gardés
    A.renderLibrary();
    S.type = m.id; S.comp = null; S.dirty = false;
    render();
    say(old ? tl('{0} mis à jour (version {1}).', m.name, m.version) : tl('{0} enregistré dans votre bibliothèque.', m.name), 'ok');
    if (place) { await close(true); await A.place(m.id); }
    return true;
  } catch (e) { say(tl('Enregistrement impossible : {0}', String(e.message || e).split('\n')[0]), 'warn'); return false; }
}

/* ---------- Panneau du bas : hauteur réglable ---------- */
function initGrip() {
  const grip = q$('[data-s="grip"]');
  grip.addEventListener('pointerdown', e => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = prefs.dock;
    const move = ev => { prefs.dock = Math.round(Math.max(120, Math.min(innerHeight * 0.65, h0 - (ev.clientY - y0)))); root.style.setProperty('--dock', prefs.dock + 'px'); redraw(); };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); savePrefs(); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => { prefs.dock = 250; root.style.setProperty('--dock', '250px'); savePrefs(); });
}

/* ---------- Vue 3D ---------- */
const MARK = {};
function marks() {
  if (MARK.dot) return MARK;
  MARK.dot = new THREE.SphereGeometry(0.5, 20, 14);
  MARK.hit = new THREE.SphereGeometry(1.6, 8, 6);
  MARK.ring = new THREE.RingGeometry(0.9, 1.12, 32);
  MARK.hitMat = new THREE.MeshBasicMaterial({ visible: false });
  MARK.ringMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, depthTest: false, transparent: true, side: THREE.DoubleSide });
  MARK.ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false });
  return MARK;
}
/** Sans WebGL (contexte refusé, pilote) : l'atelier reste utilisable, tableau et inspecteur compris. */
function noView(e) {
  V = null;
  const v = q$('.psView'); v.classList.add('noGl');
  let m = v.querySelector('.psNoGl');
  if (!m) { m = document.createElement('div'); m.className = 'psNoGl'; v.appendChild(m); }
  m.textContent = tl('La vue 3D n’a pas pu démarrer ({0}). Les broches restent modifiables dans le tableau et l’inspecteur.', String((e && e.message) || e).split('\n')[0]);
  say(m.textContent, 'warn');
}
/**
 * Moteur 3D de l'atelier. D'abord un contexte WebGL à lui, réglé comme celui du montage (un Mac à deux GPU perd un
 * contexte qui demande un autre processeur graphique) ; s'il est refusé ou perdu, l'atelier emprunte le moteur du
 * montage, caché derrière lui, et recopie chaque image dans son propre canevas 2D. Le montage retrouve sa taille à
 * la fermeture.
 */
let forceShared = false;
function ownRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, precision: Q.precision, powerPreference: LIGHT ? 'default' : 'high-performance' });
  if (r.getContext().isContextLost()) { r.dispose(); throw new Error('contexte WebGL perdu'); }
  return r;
}
/** Canevas neuf : un canevas qui a déjà reçu un contexte WebGL (même perdu) ne peut plus en prendre un autre. */
function freshCanvas() {
  const old = q$('.psView canvas'), c = document.createElement('canvas');
  c.setAttribute('aria-label', old.getAttribute('aria-label') || '');
  old.replaceWith(c);
  return c;
}
function startView() {
  if (V) { redraw(); if (!V.running) { V.running = true; loop(); } return; }
  let canvas = q$('.psView canvas'), renderer = null;
  if (!forceShared) {
    try { renderer = ownRenderer(canvas); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); }
    catch (e) { console.warn('Atelier : contexte WebGL refusé, moteur du montage emprunté.', e); forceShared = true; }
  }
  const shared = !renderer;
  if (shared) {
    renderer = A.renderer && A.renderer();
    if (!renderer) throw new Error(tl('aucun moteur 3D disponible'));
    canvas = freshCanvas();
  }
  q$('.psView').classList.remove('noGl');
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0c1014);
  scene.add(new THREE.HemisphereLight(0xdfe8ee, 0x1a1f24, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(60, 140, 90); scene.add(sun);
  const rim = new THREE.DirectionalLight(0x3b82f6, 0.25); rim.position.set(-90, 40, -70); scene.add(rim);
  const groups = ['grid', 'holder', 'pins', 'ghost'].map(() => new THREE.Group());
  groups.forEach(g => scene.add(g));
  V = { renderer, shared, ctx2d: shared ? canvas.getContext('2d') : null, saved: null, scene, canvas, persp: new THREE.PerspectiveCamera(35, 1, 0.3, 5000), ortho: new THREE.OrthographicCamera(-40, 40, 40, -40, -5000, 5000), cam: null, controls: null,
    grid: groups[0], holder: groups[1], pinsG: groups[2], ghost: groups[3], ray: new THREE.Raycaster(), ndc: new THREE.Vector2(), running: true, needs: true, half: 30,
    model: null, box: new THREE.Box3(), glbKey: null, glbTemplate: null, token: 0, modelReady: Promise.resolve(), drag: null, down: null, labelEls: [], ghostPts: [], cursor: null };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', () => { if (!V) return; V.cursor = null; V.ghost.visible = false; setHover(-1); q$('[data-c="coords"]').textContent = ''; redraw(); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  if (!shared) canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lostView(); }, { once: true });
  if (!V.ro) new ResizeObserver(() => { redraw(); }).observe(canvas.parentElement);
  setView(prefs.view, true);
  loop();
}
/** Contexte propre perdu en cours de route : on passe au moteur du montage sans fermer l'atelier. */
function lostView() {
  const old = V; if (!old) return;
  old.running = false; if (old.controls) old.controls.dispose();
  V = null; forceShared = true;
  try { startView(); rebuildModel().then(() => frame()); } catch (e) { noView(e); }
}
/** Rend le moteur emprunté au montage, à sa taille d'origine. */
function release() {
  if (!V || !V.shared || !V.saved) return;
  const r = V.renderer; r.setPixelRatio(V.saved.pr); r.setSize(V.saved.size.x, V.saved.size.y, false);
  V.saved = null; V.w = V.h = 0;
  if (A.invalidate) A.invalidate();
}
const tmpSize = new THREE.Vector2();
function loop() {
  if (!V || !V.running) return;
  requestAnimationFrame(loop);
  const w = V.canvas.clientWidth, h = V.canvas.clientHeight, pr = Math.min(devicePixelRatio, 2);
  if (!w || !h) return;
  if (V.w !== w || V.h !== h) {
    V.w = w; V.h = h;
    if (V.shared) { V.canvas.width = Math.round(w * pr); V.canvas.height = Math.round(h * pr); } else V.renderer.setSize(w, h, false);
    fitCams(); redraw();
  }
  if (V.controls) V.controls.update();
  if (!V.needs) return;
  V.needs = false;
  V.pinsG.children.forEach(g => { if (g.userData.ring) g.userData.ring.quaternion.copy(V.cam.quaternion); });
  if (V.shared) {
    const r = V.renderer;
    if (!V.saved) V.saved = { pr: r.getPixelRatio(), size: r.getSize(new THREE.Vector2()) };
    if (r.getPixelRatio() !== pr) r.setPixelRatio(pr);
    r.getSize(tmpSize); if (tmpSize.x !== w || tmpSize.y !== h) r.setSize(w, h, false);
    r.render(V.scene, V.cam);
    V.ctx2d.drawImage(r.domElement, 0, 0, V.canvas.width, V.canvas.height);
  } else V.renderer.render(V.scene, V.cam);
  placeLabels();
}
function fitCams() {
  if (!V) return;
  const a = (V.w || 1) / (V.h || 1);
  V.persp.aspect = a; V.persp.updateProjectionMatrix();
  Object.assign(V.ortho, { left: -V.half * a, right: V.half * a, top: V.half, bottom: -V.half }); V.ortho.updateProjectionMatrix();
}
/** Emprise du contenu : modèle et broches. */
function contentBox() {
  const b = new THREE.Box3();
  if (V && V.model) b.setFromObject(V.model);
  S.draft.pins.forEach(q => b.expandByPoint(new V3(q.x, q.y, q.z)));
  if (b.isEmpty()) b.set(new V3(-12, 0, -8), new V3(12, 2, 8));
  return b;
}
function setView(v, init = false) {
  if (!V) { prefs.view = VIEWS[v] ? v : 'iso'; if (S) renderBar(); return; }
  if (!VIEWS[v]) v = 'iso';
  prefs.view = v; if (!init) savePrefs();
  const ortho = v !== 'iso';
  V.cam = ortho ? V.ortho : V.persp;
  // Le haut de l'écran : vers l'arrière (−Z) vu de dessus, vers le haut (Y) ailleurs. Fixé avant les contrôles, qui le retiennent.
  V.cam.up.set(0, v === 'top' ? 0 : 1, v === 'top' ? -1 : 0);
  if (V.controls) V.controls.dispose();
  const c = new OrbitControls(V.cam, V.canvas);
  Object.assign(c, { enableDamping: true, dampingFactor: 0.12, screenSpacePanning: true, zoomToCursor: true });
  if (ortho) { c.enableRotate = false; c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }; }
  else c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  c.addEventListener('change', () => { redraw(); });
  V.controls = c;
  if (!init && S) { frame(); updateGrid(); renderBar(); }
}
/** Cadre le composant dans la vue choisie. */
function frame() {
  if (!V) return;
  if (!V || !S) return;
  const b = contentBox(), ctr = b.getCenter(new V3()), size = b.getSize(new V3()), r = Math.max(size.length() / 2, 6);
  const v = prefs.view;
  if (v === 'iso') {
    const dist = r / Math.sin(THREE.MathUtils.degToRad(V.persp.fov / 2)) * 1.05;
    V.persp.position.copy(ctr).add(new V3(0.55, 0.85, 1).normalize().multiplyScalar(dist));
    V.persp.near = Math.max(0.1, dist / 200); V.persp.far = dist * 50; V.persp.updateProjectionMatrix();
  } else {
    const a = (V.w || 1) / (V.h || 1), wv = v === 'side' ? size.z : size.x, hv = v === 'top' ? size.z : size.y;
    V.half = Math.max(hv / 2, wv / 2 / a, 4) * 1.35; V.ortho.zoom = 1; fitCams();
    if (v === 'top') V.ortho.position.set(ctr.x, ctr.y + 500, ctr.z);
    if (v === 'front') V.ortho.position.set(ctr.x, ctr.y, ctr.z + 500);
    if (v === 'side') V.ortho.position.set(ctr.x + 500, ctr.y, ctr.z);
  }
  V.controls.target.copy(ctr); V.cam.lookAt(ctr); V.controls.update();
  updateGrid(); redraw();
}
/** Grille au pas choisi (traits forts tous les 10 pas) dans le plan de la vue, axes X (rouge) et Z (bleu) à l'origine. */
function updateGrid() {
  if (!V) return;
  if (!V || !S) return;
  V.grid.children.forEach(o => { o.geometry.dispose(); o.material.dispose(); }); V.grid.clear();
  const pitch = prefs.pitch || 2.54, b = contentBox(), ax = VIEWS[prefs.view];
  const ext = Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z), Math.abs(b.max.y), 10) + 25;
  const half = Math.ceil(ext / (pitch * 10)) * pitch * 10, n = Math.round(half / pitch);
  const minor = [], major = [];
  for (let i = -n; i <= n; i++) {
    const t = r3(i * pitch), list = i % 10 === 0 ? major : minor;
    if (n > 240 && list === minor) continue; // grille trop fine pour la taille : traits forts seulement
    list.push([t, -half, t, half], [-half, t, half, t]);
  }
  const plane = (u, v) => (ax === 'y' ? new V3(u, -0.02, v) : ax === 'z' ? new V3(u, v, b.min.z - 0.5) : new V3(b.min.x - 0.5, v, u));
  const seg = (list, color, opacity) => {
    const pos = []; list.forEach(([u0, v0, u1, v1]) => { pos.push(...plane(u0, v0).toArray(), ...plane(u1, v1).toArray()); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    V.grid.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })));
  };
  seg(minor, 0x9fb3c4, prefs.snap && prefs.pitch ? 0.09 : 0.05); seg(major, 0x9fb3c4, 0.2);
  const axis = (a, b2, color) => { const g = new THREE.BufferGeometry().setFromPoints([a, b2]); V.grid.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }))); };
  if (ax !== 'x') axis(plane(-half, 0), plane(half, 0), 0xe5484d); // X
  if (ax === 'y') axis(plane(0, -half), plane(0, half), 0x5b9cf5); // Z
  if (ax !== 'y') axis(ax === 'z' ? new V3(0, 0, b.min.z - 0.5) : new V3(b.min.x - 0.5, 0, 0), ax === 'z' ? new V3(0, half, b.min.z - 0.5) : new V3(b.min.x - 0.5, half, 0), 0x3fb27f); // Y
  if (ax === 'x') axis(plane(-half, 0), plane(half, 0), 0x5b9cf5); // Z, vue de côté
  redraw();
}
const lookKind = () => (S.draft.glb ? 'glb' : (S.draft.part && S.draft.part.look && S.draft.part.look.kind) || 'module');
/** Reconstruit la forme 3D : modèle importé, ou plaquette / bloc / LED / résistance / dessin d'après les broches. */
function rebuildModel() {
  if (!V) return Promise.resolve();
  const token = ++V.token;
  V.modelReady = (async () => {
    const d = S.draft;
    let m;
    if (d.glb) {
      if (V.glbKey !== d.glb) {
        const t = await P.parseGlb(J.fromB64(d.glb));
        if (token !== V.token) return;
        if (V.glbTemplate) disposeTree(V.glbTemplate, true);
        V.glbTemplate = t; V.glbKey = d.glb;
      }
      m = V.glbTemplate.clone(true);
    } else m = D.blockModel(d);
    if (token !== V.token) return;
    if (V.model) { V.holder.remove(V.model); if (!d.glb || V.model.userData.own) disposeTree(V.model, false); }
    m.userData.own = !d.glb;
    V.holder.add(m); V.model = m;
    syncPins(); updateGrid(); redraw();
  })();
  return V.modelReady;
}
/** Libère un modèle : les pavés viennent d'un cache partagé avec le montage (on les garde), les textures sont à lui. */
function disposeTree(o, all) {
  o.traverse(n => {
    if (!n.isMesh) return;
    if (all || n.geometry.type !== 'BoxGeometry') n.geometry.dispose();
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    mats.forEach(m => { if (m.map) { m.map.dispose(); m.dispose(); } else if (all) m.dispose(); });
  });
}
/** Pastilles des broches (toujours visibles, couleur de leur nature) et étiquettes HTML. */
function syncPins() {
  if (!V) return;
  if (!V) return;
  const M = marks();
  V.pinsG.children.forEach(g => g.userData.mat.dispose()); V.pinsG.clear();
  const box = q$('[data-c="labels"]');
  box.innerHTML = S.draft.pins.map((q, i) => { const o = D.pinOut(q); return `<span class="psLab" data-i="${i}" style="${kv(o.kind)}">${esc(q.name)}</span>`; }).join('');
  V.labelEls = [...box.children];
  S.draft.pins.forEach((q, i) => {
    const o = D.pinOut(q), col = new THREE.Color(KIND_COLOR[o.kind] || '#999');
    const g = new THREE.Group(); g.position.set(q.x, q.y, q.z); g.renderOrder = 5;
    const mat = new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true });
    const dot = new THREE.Mesh(M.dot, mat); dot.renderOrder = 6;
    const ring = new THREE.Mesh(M.ring, M.ringMat); ring.visible = false; ring.renderOrder = 7;
    const hit = new THREE.Mesh(M.hit, M.hitMat); hit.userData.i = i;
    g.add(dot, ring, hit); Object.assign(g.userData, { mat, dot, ring, hit, base: col });
    V.pinsG.add(g);
  });
  paintPins();
}
function paintPins() {
  if (!V) return;
  if (!V || !S) return;
  V.pinsG.children.forEach((g, i) => {
    const on = S.sel.includes(i), hov = S.hover === i, u = g.userData;
    u.mat.color.copy(u.base).lerp(new THREE.Color(0xffffff), hov ? 0.35 : 0);
    u.dot.scale.setScalar(on ? 1.35 : hov ? 1.2 : 1);
    u.ring.visible = on;
  });
  V.labelEls.forEach((el, i) => { el.classList.toggle('on', S.sel.includes(i)); el.classList.toggle('hov', S.hover === i); });
  redraw();
}
function setHover(i) { if (V && S && S.hover !== i) { S.hover = i; paintPins(); V.canvas.style.cursor = S.tool === 'select' && i >= 0 ? 'grab' : S.tool === 'select' ? '' : 'crosshair'; } }
function placeLabels() {
  if (!V) return;
  if (!prefs.labels || !V.labelEls.length) return;
  const v = new V3(), w = V.w, h = V.h;
  V.pinsG.children.forEach((g, i) => {
    const el = V.labelEls[i]; if (!el) return;
    v.copy(g.position).project(V.cam);
    if (v.z > 1 || v.z < -1) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.transform = `translate(${((v.x + 1) / 2 * w + 9).toFixed(1)}px, ${((1 - v.y) / 2 * h - 22).toFixed(1)}px)`;
  });
}

/* ---------- Pointeur : choisir, déplacer, poser ---------- */
function setNdc(e) {
  const r = V.canvas.getBoundingClientRect();
  V.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  V.ray.setFromCamera(V.ndc, V.cam);
}
function pinUnder() { const hits = V.ray.intersectObjects(V.pinsG.children.map(g => g.userData.hit), false); return hits.length ? hits[0].object.userData.i : -1; }
const snapOn = () => prefs.snap && prefs.pitch > 0;
const snapV = v => (snapOn() ? r3(Math.round(v / prefs.pitch) * prefs.pitch) : r3(v));
/** Hauteur habituelle des broches : la plus fréquente parmi celles posées, sinon celle de la forme. */
function defaultY() {
  const ys = S.draft.pins.map(q => r3(q.y));
  if (ys.length) { const n = {}; ys.forEach(y => { n[y] = (n[y] || 0) + 1; }); return +Object.entries(n).sort((a, b) => b[1] - a[1])[0][0]; }
  const k = lookKind();
  return k === 'module' ? HEADER_Y : k === 'block' ? 3 : k === 'svg' ? 1.6 : 0;
}
/** Intersection du rayon avec le plan perpendiculaire à l'axe de la vue, passant par la valeur `at`. */
function rayPlane(axis, at) {
  const n = new V3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), p = new V3();
  return V.ray.ray.intersectPlane(new THREE.Plane(n, -at), p) ? p : null;
}
/**
 * Point où se pose une broche : sur un modèle importé, la surface visée (aimantée à la grille puis reprojetée sur
 * la surface) ; sur une forme qui suit ses broches, le plan de la vue à la hauteur habituelle.
 */
function placement() {
  const ax = VIEWS[prefs.view];
  if (lookKind() === 'glb' && V.model) {
    const hit = V.ray.intersectObject(V.model, true)[0];
    if (hit) {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new V3(0, 1, 0);
      const p = hit.point.clone().addScaledVector(n, 0.4);
      if (!snapOn()) return { x: r3(p.x), y: r3(p.y), z: r3(p.z) };
      // Aimant dans le plan de la face visée (ses deux axes), puis reprojection sur la surface le long de sa normale.
      const fa = ['x', 'y', 'z'].reduce((a, k) => (Math.abs(n[k]) > Math.abs(n[a]) ? k : a), 'y'), sg = n[fa] >= 0 ? 1 : -1;
      const s = { x: p.x, y: p.y, z: p.z };
      ['x', 'y', 'z'].filter(k => k !== fa).forEach(k => { s[k] = snapV(s[k]); });
      const o = new V3(s.x, s.y, s.z), dir = new V3();
      o[fa] = hit.point[fa] + sg * 30; dir[fa] = -sg;
      const h2 = new THREE.Raycaster(o, dir).intersectObject(V.model, true)[0];
      if (h2) s[fa] = h2.point[fa] + sg * 0.4;
      return { x: r3(s.x), y: r3(s.y), z: r3(s.z) };
    }
  }
  const at = ax === 'y' ? defaultY() : 0, p = rayPlane(ax, at);
  if (!p) return null;
  const s = { x: snapV(p.x), y: ax === 'y' ? r3(at) : snapV(p.y), z: snapV(p.z) };
  if (ax === 'z') s.z = 0; if (ax === 'x') s.x = 0;
  return s;
}
/** Ancre d'une rangée posée sans clic : au centre, décalée d'un pas en travers tant qu'elle chevauche des broches. */
function freeAnchor() {
  const c = contentBox().getCenter(new V3()), a = { x: snapV(c.x), y: r3(defaultY()), z: snapV(c.z) };
  const across = S.row.dir === 'z' ? 'x' : 'z', step = +S.row.pitch || 2.54, pins = S.draft.pins;
  const hits = () => rowLayout(a).some(p => pins.some(q => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 0.9));
  if (!pins.length) { a.x = 0; a.z = 0; return a; }
  for (let i = 0; i < 60 && hits(); i++) a[across] = r3(a[across] + (across === 'z' ? step : -step));
  return a;
}
function onDown(e) {
  if (e.button !== 0 || !S) return;
  setNdc(e);
  V.down = { x: e.clientX, y: e.clientY };
  if (S.tool !== 'select') return;
  const i = pinUnder();
  if (i < 0) return;
  if (e.shiftKey || e.metaKey || e.ctrlKey) { select(S.sel.includes(i) ? S.sel.filter(x => x !== i) : [...S.sel, i], i); V.down = null; return; }
  if (!S.sel.includes(i)) select([i], i);
  const q = S.draft.pins[i], ax = VIEWS[prefs.view], start = rayPlane(ax, q[ax]);
  if (!start) return;
  V.controls.enabled = false; V.canvas.setPointerCapture(e.pointerId);
  V.drag = { i, ax, start, orig: S.sel.map(j => ({ j, x: S.draft.pins[j].x, y: S.draft.pins[j].y, z: S.draft.pins[j].z })), moved: false };
}
function onMove(e) {
  if (!S) return;
  setNdc(e);
  const dr = V.drag;
  if (dr) {
    if (!dr.moved && Math.hypot(e.clientX - V.down.x, e.clientY - V.down.y) < 4) return;
    if (!dr.moved) { dr.moved = true; S.hist.push(snapOf()); S.fut = []; V.canvas.style.cursor = 'grabbing'; }
    const p = rayPlane(dr.ax, dr.orig.find(o => o.j === dr.i)[dr.ax]); if (!p) return;
    const o0 = dr.orig.find(o => o.j === dr.i), delta = {};
    ['x', 'y', 'z'].forEach(k => { delta[k] = k === dr.ax ? 0 : snapV(o0[k] + p[k] - dr.start[k]) - o0[k]; });
    dr.orig.forEach(o => { const q = S.draft.pins[o.j]; q.x = r3(o.x + delta.x); q.y = r3(o.y + delta.y); q.z = r3(o.z + delta.z); const g = V.pinsG.children[o.j]; if (g) g.position.set(q.x, q.y, q.z); });
    const q = S.draft.pins[dr.i];
    q$('[data-c="coords"]').textContent = `${q.name} · X ${fmt(q.x)}  Y ${fmt(q.y)}  Z ${fmt(q.z)} mm`;
    redraw(); return;
  }
  if (S.tool === 'select') {
    const i = pinUnder(); setHover(i);
    const q = i >= 0 ? S.draft.pins[i] : null, ax = VIEWS[prefs.view], p = q || rayPlane(ax, ax === 'y' ? defaultY() : 0);
    q$('[data-c="coords"]').textContent = p ? `${q ? q.name + ' · ' : ''}X ${fmt(p.x)}  Y ${fmt(p.y)}  Z ${fmt(p.z)} mm` : '';
    return;
  }
  V.cursor = placement(); updateGhost();
  const c = V.cursor; q$('[data-c="coords"]').textContent = c ? `X ${fmt(c.x)}  Y ${fmt(c.y)}  Z ${fmt(c.z)} mm` : '';
}
function onUp(e) {
  if (!S || e.button !== 0) return;
  const dr = V.drag, down = V.down; V.drag = null; V.down = null; V.controls.enabled = true;
  if (dr) {
    try { V.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* déjà relâché */ }
    V.canvas.style.cursor = 'grab';
    if (dr.moved) { afterChange(lookKind() !== 'glb'); say(tl('{0} broche(s) déplacée(s).', dr.orig.length)); }
    return;
  }
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return; // la vue a tourné ou glissé
  setNdc(e);
  if (S.tool === 'select') { if (pinUnder() < 0 && S.sel.length) select([]); return; }
  const p = placement(); if (!p) return;
  if (S.tool === 'pin') placePin(p);
  else if (S.tool === 'row' && rowNames().length) placeRow(p);
}
/** Aperçu de ce qui va être posé : une broche, ou toute la rangée, sous la souris. */
function updateGhost() {
  if (!V) return;
  if (!V) return;
  const M = marks();
  V.ghost.clear();
  const c = V.cursor;
  if (!c || S.tool === 'select') { V.ghost.visible = false; redraw(); return; }
  const pts = S.tool === 'row' ? rowLayout(c) : [{ ...c, name: S.next }];
  pts.forEach(p => { const m = new THREE.Mesh(M.dot, M.ghostMat); m.position.set(p.x, p.y, p.z); m.renderOrder = 8; V.ghost.add(m); });
  V.ghost.visible = true; redraw();
}

/* ---------- Installation ---------- */
/**
 * api : interface de l'application (voir parteditor.install) ; hooks : { saveToLibrary(type), download(bytes, m),
 * readDraft(file) → { draft, type?, msg? } }.
 */
export function install(api, hooks) { A = api; H = hooks; }
