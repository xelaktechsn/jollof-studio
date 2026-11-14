// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : le plan de travail des circuits pneumatiques et électropneumatiques, à côté du montage électronique.
// Un troisième bouton du sélecteur (Électronique, Logique, Pneumatique) l'affiche ; le circuit est enregistré avec le
// projet (module « pneu ») et a son propre historique. Contrairement à la logique, la simulation reste commune : une
// carte Arduino excite la bobine d'une électrovanne (composant coil24 du montage, repère Y1…), le distributeur du plan
// qui porte ce repère bascule, le vérin sort, et ses capteurs de fin de course (cylsensor, repères B1…) se ferment
// dans le montage, où le programme les lit. Pendant la simulation d'un projet électropneumatique, la vue partagée
// montre les deux côtés à la fois (montage à gauche, circuit à droite, chaîne de commande au-dessus) ; sinon une
// vignette du circuit reste visible sur le banc.
import './pneu.css';
import { tl, isEn } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { createNavDock } from '../ui/navdock.js';
import { menu as popMenu, confirm as confirmDlg, toast } from '../school/ui.js';
import { PNEU_EXAMPLES } from './examples.js';
import VERIN from '../../exemples/08-verin-electropneumatique.jollof?raw'; // projet entier : carte, électrovanne, capteurs
import { DEFS, G, props, camText, delayOf } from './elements.js';
import { cylOf } from './physics.js';
import { createRunner, runStep, compiled, inputKey, liveReceptivities, readVar } from './run.js';
import { cleanGrafcet } from './grafcet.js';
import { createGrafcetPanel } from './grafview.js';
import { phaseSvg, moveText } from './seq.js';
import { createPneuEditor, circuitSvg, boundsOf } from './editor.js';
import { checkPneu } from './check.js';
import { clean } from './clean.js';
import { tagsOf, BENCH_LINK } from './links.js';
import { BOARDS } from '../sim/boards.js';
import { partOf } from '../sim/parts.js';
import { inspect } from '../sim/circuit.js';
import { needsWiring } from '../sim/autowire.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Tutoriel pas à pas d'un projet électropneumatique (TP src/lab/pneu/pn00…). */
const TUTORIAL = 'pn00-tutoriel-electropneumatique';
/** Bibliothèque : éléments et variantes prêtes à poser (type, réglages). */
const LIB = () => [
  [tl('Alimentation'), [['supply', {}], ['frl', {}]]],
  [tl('Distributeurs'), [
    ['v32', { act: 'push', normal: 'nc' }, tl('3/2 normalement fermé, bouton poussoir')],
    ['v32', { act: 'sol', normal: 'nc', coil: 'Y1' }, tl('3/2 normalement fermé, électroaimant')],
    ['v32', { act: 'push', normal: 'no' }, tl('3/2 normalement ouvert, bouton poussoir')],
    ['v52', { left: 'sol', right: 'spring', coilL: 'Y1' }, tl('5/2 monostable, électroaimant')],
    ['v52', { left: 'sol', right: 'sol', coilL: 'Y1', coilR: 'Y2' }, tl('5/2 bistable, deux électroaimants')],
    ['v52', { left: 'push', right: 'spring' }, tl('5/2 monostable, bouton poussoir')],
    ['v52', { left: 'pilot', right: 'spring' }, tl('5/2 monostable, pilotage pneumatique')],
    ['v53', { left: 'sol', right: 'sol', coilL: 'Y1', coilR: 'Y2', center: 'closed' }, tl('5/3 centre fermé, deux électroaimants')],
    ['v53', { left: 'sol', right: 'sol', coilL: 'Y1', coilR: 'Y2', center: 'exhaust' }, tl('5/3 centre à l’échappement')],
    ['v53', { left: 'sol', right: 'sol', coilL: 'Y1', coilR: 'Y2', center: 'pressure' }, tl('5/3 centre sous pression')]
  ]],
  [tl('Vérins'), [['cyl1', { s0: '', s1: '' }], ['cyl2', { s0: 'B1', s1: 'B2' }]]],
  [tl('Temporisation'), [['v32', { act: 'tempo', normal: 'nc', delay: 3 }, tl('Temporisateur 3/2 NF : retard à l’ouverture')], ['v32', { act: 'tempo', normal: 'no', delay: 3 }, tl('Temporisateur 3/2 NO : coupure retardée')]]],
  [tl('Fins de course'), [['v32', { act: 'roller', normal: 'nc', cam: '', end: '1' }, tl('3/2 à galet, tige sortie (a1)')], ['v32', { act: 'roller', normal: 'nc', cam: '', end: '0' }, tl('3/2 à galet, tige rentrée (a0)')]]],
  [tl('Débit et pression'), [['flowctl', { open: 50 }], ['gauge', {}], ['pswitch', { sensor: 'S1', bar: 3 }]]],
  [tl('Fonctions logiques'), [['shuttle', {}], ['twopress', {}]]]
];
const ACT = () => ({ push: tl('Bouton poussoir'), sol: tl('Électroaimant (bobine)'), pilot: tl('Pilotage pneumatique') });
/** Commande d'un 3/2 : en plus, le galet de fin de course actionné par la tige d'un vérin. */
const ACT32 = () => ({ ...ACT(), roller: tl('Galet (fin de course d’un vérin)'), tempo: tl('Temporisation (pilotage retardé)') });

export function installPneu(app) {
  const $ = s => document.querySelector(s), appEl = $('.app');
  // R : simulation en cours (état du circuit R.st, GRAFCET R.g, relevé des mouvements R.rec) ; st et simRes la suivent.
  let on = false, fitted = false, R = createRunner(), st = R.st, simRes = null, lastDraw = 0, lastPane = 0, lastGf = 0, lastChain = 0;
  let split = false; // vue partagée : montage et circuit côte à côte
  const resetRun = () => { R = createRunner(); st = R.st; simRes = null; };
  let gfReady = false; // panneau GRAFCET créé (après l'éditeur)
  const pushed = new Set();
  // Type du projet : le circuit n'est simulé que dans un projet pneumatique ou électropneumatique, et il n'échange
  // avec le montage (bobines, capteurs, boutons) que dans un projet électropneumatique.
  const kind = () => (app.kind ? app.kind() : 'epneu');
  const linked = () => kind() === 'epneu';
  const simOn = () => app.simOn() && ed.circuit().elements.length > 0 && (kind() === 'pneu' || kind() === 'epneu');
  const physical = () => ed.circuit().model === 'physical';
  const supplyBar = () => { const s = ed.circuit().elements.find(e => e.type === 'supply'); return s ? +props(s).bar || 6 : 6; };

  /* ---------- Sélecteur : troisième bouton ---------- */
  const sw = $('.wsSwitch');
  sw.insertAdjacentHTML('beforeend', `<button type="button" class="segBtn" data-ws="pneu" aria-pressed="false" data-tip="${tl('Pneumatique : distributeurs, vérins, électrovannes commandées par la carte')}">${icon('pneu')}<span>${tl('Pneumatique')}</span></button>`);
  // Électronique ou Logique choisi : on quitte d'abord la pneumatique (avant le gestionnaire de la logique).
  sw.addEventListener('click', e => { const b = e.target.closest('[data-ws]'); if (b && b.dataset.ws !== 'pneu') { setMode(false); setSplit(false); setTimeout(paintSplitBtn, 0); } }, true);
  sw.querySelector('[data-ws="pneu"]').onclick = () => { if (app.logic && app.logic.isOn()) app.logic.setMode(false); setMode(true); };

  /* ---------- Plan de travail ---------- */
  const host = document.createElement('div'); host.className = 'pnHost'; host.hidden = true;
  $('#stage').appendChild(host);
  let nav = null; // barre de navigation (créée après l'éditeur)
  const ed = createPneuEditor(host, {
    changed() { app.markDirty(); if (ed.circuit().elements.length && app.ensureSpace) app.ensureSpace('pneu'); if (app.recheck) app.recheck(); counts(); renderPane(); if (gfReady && gf.isOpen()) gf.render(); if (gfReady) { refresh3d(); paintSplitBtn(); if (split) paintChain(); } },
    status: (m, k) => app.status(m, k),
    sim: () => (simOn() ? st : null),
    press(id, v) { if (v) pushed.add(id); else pushed.delete(id); },
    selected: () => { renderPane(); if (nav) nav.update(); },
    view: () => { if (nav) nav.update(); }
  });
  host.insertAdjacentHTML('beforeend', `
    <div class="pnBar top"><button type="button" class="btn glass small pnGfBtn" data-grafcet aria-pressed="false" data-tip="${tl('GRAFCET : la partie commande du circuit, comme un automate')}">${icon('list')}<span>GRAFCET</span></button><button type="button" class="btn glass small pn3dBtn" data-m3open aria-pressed="false" data-tip="${tl('Vue 3D de la machine')}">${icon('box')}<span>3D</span></button><span class="grow"></span></div>
    <div class="pnBar bottom"><div class="pnLegend glass"><span><i class="pnP"></i>${tl('sous pression')}</span><span><i class="pnE"></i>${tl('à l’échappement')}</span><span class="pnLegM"><i class="pnM"></i>${tl('pression intermédiaire')}</span><span><i class="pnC"></i>${tl('fermé')}</span></div><span class="grow"></span><span class="pnRunHint glass">${tl('La simulation est celle du montage : lancez-la avec « Simuler ».')}</span></div>
    <div class="pnEmpty"><div class="pnEmptyCard">${icon('pneu')}<b>${tl('Plan de travail pneumatique')}</b>
      <p>${tl('Glissez une source d’air, un distributeur et un vérin depuis la bibliothèque, puis tirez des tuyaux d’orifice en orifice. Une électrovanne 24 V du montage électronique (repère Y1) commande le distributeur qui porte ce repère ; les capteurs de vérin (B1, B2) renvoient la position du piston à la carte.')}</p>
      <div class="row"><button type="button" class="btn primary" data-tuto>${icon('graduation')}<span>${tl('Tutoriel pas à pas')}</span></button><button type="button" class="btn" data-labs>${icon('checklist')}<span>${tl('TP de pneumatique')}</span></button><button type="button" class="btn" data-examples>${icon('layers')}<span>${tl('Exemples')}</span></button></div></div></div>`);
  // Navigation commune (src/ui/navdock.js) : outils, zoom, tout voir, sélection, mini-carte, raccourcis.
  nav = createNavDock(host, {
    active: () => on || split,
    target: () => ed.svg,
    tools: () => ['select', 'pan', 'zoom'],
    zoomBy: (f, x, y) => ed.zoomAt(f, x, y), panBy: (dx, dy) => ed.panBy(dx, dy),
    zoomPct: () => ed.zoomPct(), setZoomPct: p => ed.setZoomPct(p),
    fit: () => ed.fit(), fitSel: () => ed.fitSel(), hasSel: () => ed.hasSel(),
    mini: { data: () => ed.mini(), centerOn: (x, y) => ed.centerOn(x, y) },
    status: m => app.status(m),
    title: tl('Plan pneumatique'),
    shortcuts: () => [
      ['Drag', tl('Encadrer plusieurs éléments (dans le vide)')],
      ['Shift+Click', tl('Ajouter ou retirer un élément de la sélection')],
      ['Mod+A', tl('Tout sélectionner')],
      ['Mod+C|Mod+X|Mod+V', tl('Copier, couper, coller')],
      ['Mod+D', tl('Dupliquer')],
      ['←↑→↓', tl('Déplacer la sélection (Maj : plus loin)')],
      ['Del', tl('Retirer la sélection')],
      ['Alt+Drag', tl('Déplacer la vue')],
      ['Esc', tl('Tout désélectionner')]
    ]
  });
  host.addEventListener('click', e => {
    const ex = e.target.closest('[data-examples]'); if (ex) { examplesMenu(ex); return; }
    if (e.target.closest('[data-labs]') && app.openLabs) app.openLabs('pneu');
    if (e.target.closest('[data-tuto]') && app.openTutorial) app.openTutorial(TUTORIAL);
    if (e.target.closest('[data-grafcet]')) { if (gf.isOpen()) gf.close(); else gf.open(); }
    if (e.target.closest('[data-m3open]')) { if (m3.hidden) open3d(); else close3d(); }
  });

  /* ---------- GRAFCET ---------- */
  // Bouton du pupitre (dcy…) : clé « @dcy » ; un identifiant d'élément du plan reste celui d'un distributeur.
  const grafInput = n => { const g = ed.circuit().grafcet; return g && g.inputs.find(x => x.name.toLowerCase() === String(n).replace(/^@/, '').toLowerCase()); };
  const keyOf = k => (String(k).startsWith('@') ? String(k).toLowerCase() : ed.circuit().elements.some(e => e.id === String(k).replace(/:R$/, '')) ? k : grafInput(k) ? inputKey(k) : k);
  const gfLive = () => {
    const c = ed.circuit(), C = compiled(c.grafcet); if (!simOn() || !C) return null;
    const names = [...C.vars].filter(v => !C.inputNames.has(v)).sort();
    const X = R.g.X || new Set(), macros = new Set([...C.macros].filter(([, m]) => [...m.steps].some(s => X.has(s))).map(([n]) => n));
    return { X, macros, out: R.gOut, trans: C.trans, t: R.g.t, since: R.g.since, rec: liveReceptivities(R, c, io), vars: names.map(n => [n, readVar(R, c, io, n)]),
      counters: [...C.counters].map(n => [n, R.g.mem.get(n) || 0]), forced: new Set(R.g.forced ? R.g.forced.keys() : []) };
  };
  const gf = createGrafcetPanel(host, {
    get: () => ed.circuit().grafcet || null,
    set: g => ed.setCircuitProp('grafcet', cleanGrafcet(g)),
    sim: simOn, live: gfLive,
    press: (n, v) => { const k = inputKey(n); if (v) pushed.add(k); else pushed.delete(k); },
    pressed: n => pushed.has(inputKey(n)),
    code: () => writeProgram(),
    opened: () => { paintGf(); refit(); }, closed: () => { paintGf(); refit(); },
    /** Repères du circuit pour la palette du GRAFCET : capteurs (fins de course, pressostats) et bobines. */
    names() {
      const els = ed.circuit().elements, P = e => props(e), uniq = a => [...new Set(a.filter(Boolean))];
      const sensors = uniq(els.flatMap(e => (e.type === 'cyl1' || e.type === 'cyl2' ? [P(e).s0, P(e).s1] : e.type === 'pswitch' ? [P(e).sensor] : [])));
      const coils = uniq(els.flatMap(e => (e.type === 'v32' ? [P(e).act === 'sol' && P(e).coil] : e.type === 'v52' || e.type === 'v53' ? [P(e).left === 'sol' && P(e).coilL, P(e).right === 'sol' && P(e).coilR] : [])));
      return { sensors, coils };
    }
  });
  // Le plan se décale à droite du panneau GRAFCET ouvert : on le recadre.
  const refit = () => requestAnimationFrame(() => { if (on) ed.fit(); });
  gfReady = true;
  const paintGf = () => { const b = host.querySelector('[data-grafcet]'); b.setAttribute('aria-pressed', String(gf.isOpen())); b.classList.toggle('primary', gf.isOpen()); };
  /** Circuit ouvert ou remplacé : le panneau GRAFCET s'ouvre s'il y a un GRAFCET, se ferme sinon. */
  function syncGrafcet() { const g = ed.circuit().grafcet; if (g && g.steps.length) gf.open(); else if (gf.isOpen() && !g) gf.close(); paintGf(); }
  /**
   * Programme Arduino du GRAFCET pour la carte du montage : il remplace le programme de la carte, le GRAFCET observe.
   * silent : sans confirmation ni message (assistants IA). Rend { board, missingIn, missingOut, lines } ou { error }.
   */
  async function writeProgram(o = {}) {
    const g = ed.circuit().grafcet, say = (m, k, ms) => { if (!o.silent) toast(m, k, ms); };
    if (!g || !g.steps.length) { say(tl('Écrivez d’abord le GRAFCET.'), 'warn'); return { error: tl('Écrivez d’abord le GRAFCET.') }; }
    if (app.settle) app.settle(); // câblage automatique en cours d'animation : ses fils comptent déjà
    const { programForBench } = await import('./grafcode.js');
    const r = await programForBench(app.comps(), app.wires(), g);
    if (r.error) { say(r.error, 'warn', 7000); return { error: r.error }; }
    if (!o.silent && !(await confirmDlg(tl('Programme Arduino du GRAFCET'), tl('Remplacer le programme de {0} par celui de ce GRAFCET ? La carte commandera alors les électrovannes ; le GRAFCET du plan ne fera plus qu’observer.', esc(r.board.name)), tl('Écrire le programme')))) return null;
    app.setBoardCode(r.board, r.code);
    ed.setCircuitProp('grafcet', cleanGrafcet({ ...g, drive: false }));
    const miss = [...r.missingIn.map(v => tl('entrée {0}', v)), ...r.missingOut.map(v => tl('sortie {0}', v))];
    say(miss.length ? tl('Programme écrit dans l’onglet Code. Sans équivalent dans le montage (nommez un bouton, un capteur ou une électrovanne pareil) : {0}.', miss.join(', ')) : tl('Programme écrit dans l’onglet Code : lancez la simulation, la carte suit le GRAFCET.'), miss.length ? 'warn' : 'ok', 9000);
    return { board: r.board.name, missingIn: r.missingIn, missingOut: r.missingOut, lines: r.code.split('\n').length };
  }
  /** Exemples : circuits pneumatiques (remplacent le plan, annulable) et projet électropneumatique avec carte. */
  async function examplesMenu(anchor) {
    const v = await popMenu(anchor, [...PNEU_EXAMPLES.map(x => ({ label: x.name(), icon: 'pneu', value: x.id })), { label: tl('Vérin électropneumatique avec Arduino (projet complet)'), icon: 'cpu', value: 'project' }]);
    if (!v) return;
    if (v === 'project') {
      if (!(await confirmDlg(tl('Vérin électropneumatique'), tl('Ouvrir ce projet d’exemple à la place du projet en cours ? Pensez à enregistrer votre travail.'), tl('Ouvrir')))) return;
      const d = JSON.parse(VERIN), en = d.en; delete d.en;
      if (isEn && en) { d.name = en.name; d.description = en.description; }
      await app.openProject(d, d.name); setMode(true); requestAnimationFrame(() => ed.fit());
      toast(isEn && en ? en.description : d.description, 'ok', 8000); return;
    }
    const ex = PNEU_EXAMPLES.find(x => x.id === v); if (!ex) return;
    if (ed.circuit().elements.length && !(await confirmDlg(ex.name(), tl('Remplacer le circuit pneumatique actuel par cet exemple ? Ctrl+Z permet de revenir en arrière.'), tl('Remplacer')))) return;
    ed.replace(clean(ex.circuit())); resetRun(); pushed.clear(); fitted = true; syncGrafcet(); ed.fit(); counts(); renderPane(); sync3d();
    toast(ex.text(), 'ok', 8000);
  }
  // Mode pneumatique : le bouton « Exemples » de la barre d'application propose les exemples de pneumatique.
  document.addEventListener('click', e => { const b = on && e.target.closest('#exBtn'); if (!b) return; e.preventDefault(); e.stopImmediatePropagation(); examplesMenu(b); }, true);

  /* ---------- Bibliothèque ---------- */
  const lib = document.createElement('aside');
  lib.className = 'panel left pnLib'; lib.setAttribute('aria-label', tl('Bibliothèque pneumatique'));
  // Bibliothèque repliée : un rail avec les éléments (glisser ou cliquer pour poser), comme en logique.
  lib.innerHTML = `<nav class="pnRail" aria-label="${tl('Éléments pneumatiques')}"><button type="button" class="tb" data-open data-tip="${tl('Déplier la bibliothèque · Ctrl+B')}" aria-label="${tl('Déplier la bibliothèque')}">${icon('chevsRight')}</button><span class="rsep"></span><div class="pnRailList"></div></nav>
    <div class="phead"><h2>${icon('pneu')}${tl('Pneumatique')}</h2><button type="button" class="tb" data-close data-tip="${tl('Replier · Ctrl+B')}" aria-label="${tl('Replier la bibliothèque')}">${icon('chevsLeft')}</button></div>
    <div class="libScroll pnLibList"></div>
    <p class="pnLibNote">${tl('Glissez un élément sur le plan, ou cliquez pour le poser au centre.')}</p>
    <div class="pfoot"><div class="row"><button type="button" class="btn subtle small" data-examples>${icon('layers')}<span>${tl('Exemples')}</span></button><button type="button" class="btn subtle small" data-labs data-tip="${tl('TP de pneumatique')}">${icon('checklist')}<span>${tl('TP')}</span></button></div></div>`;
  $('#libPanel').after(lib);
  // tight : vignette du rail (bibliothèque repliée), cadrée au plus près du symbole.
  const thumb = (type, p, tight = false) => {
    const e = { id: 't', type, x: 0, y: 0, p }, [w, h] = DEFS[type].size(e);
    const vb = tight ? `-3 -3 ${w * G + 6} ${h * G + 6}` : `-8 -14 ${w * G + 26} ${h * G + 28}`;
    return `<svg class="pnThumb" viewBox="${vb}" aria-hidden="true">${DEFS[type].draw(e, null)}</svg>`;
  };
  function renderLib() {
    lib.querySelector('.pnRailList').innerHTML = LIB().map(([, items]) => items.map(([type, p, label]) => `<button type="button" class="pnRailItem" data-t="${type}" data-p="${esc(JSON.stringify(p))}" title="${esc(label || DEFS[type].name())}" aria-label="${esc(label || DEFS[type].name())}">${thumb(type, p, true)}</button>`).join('')).join('<span class="rsep"></span>');
    lib.querySelector('.pnLibList').innerHTML = LIB().map(([cat, items]) => `<h3>${esc(cat)}</h3><div class="pnGrid">${items.map(([type, p, label], i) => `<button type="button" class="pnItem" data-t="${type}" data-p="${esc(JSON.stringify(p))}" title="${esc(label || DEFS[type].name())}">${thumb(type, p)}<span>${esc(label || DEFS[type].name())}</span></button>`).join('')}</div>`).join('');
  }
  // Vignettes de la bibliothèque : dessinées à la première ouverture du plan de travail (rien au démarrage).
  let libReady = false;
  let dragFrom = null;
  lib.addEventListener('pointerdown', e => { const b = e.target.closest('[data-t]'); if (!b || e.button !== 0) return; dragFrom = { b, x: e.clientX, y: e.clientY, started: false }; });
  addEventListener('pointermove', e => {
    if (!dragFrom || dragFrom.started) return;
    if (Math.hypot(e.clientX - dragFrom.x, e.clientY - dragFrom.y) < 6) return;
    dragFrom.started = true; ed.startPlace(dragFrom.b.dataset.t, JSON.parse(dragFrom.b.dataset.p));
  }, true);
  addEventListener('pointerup', () => { setTimeout(() => (dragFrom = null), 0); }, true);
  lib.addEventListener('click', e => {
    if (e.target.closest('[data-close]') || e.target.closest('[data-open]')) { app.setLibOpen(!app.libOpen()); return; }
    const exb = e.target.closest('[data-examples]'); if (exb) { examplesMenu(exb); return; }
    if (e.target.closest('[data-labs]')) { if (app.openLabs) app.openLabs('pneu'); return; }
    const b = e.target.closest('[data-t]'); if (!b || (dragFrom && dragFrom.started)) return;
    ed.placeCenter(b.dataset.t, JSON.parse(b.dataset.p));
    if (!ed.circuit().elements.length) return;
    host.querySelector('.pnEmpty').hidden = true;
  });

  /* ---------- Onglet de l'inspecteur ---------- */
  $('.panel.right .tabs').insertAdjacentHTML('beforeend', `<button type="button" role="tab" class="tab pnTab" id="tab-pneu" aria-controls="pane-pneu" aria-selected="false">${icon('pneu')}${tl('Pneumatique')}</button>`);
  const pane = document.createElement('div'); pane.className = 'pane pnPane'; pane.id = 'pane-pneu'; pane.setAttribute('role', 'tabpanel'); pane.hidden = true;
  $('#modPane').before(pane);
  $('#tab-pneu').onclick = () => { app.setTab('pneu'); renderPane(); };
  const benchOf = (...types) => (linked() ? app.comps().filter(c => types.includes(c.type)).map(c => c.name) : []);
  const field = (label, html) => `<label class="field"><span class="fh">${esc(label)}</span>${html}</label>`;
  const sel = (k, val, opts) => `<select class="sel" data-k="${k}">${Object.entries(opts).map(([v, l]) => `<option value="${v}"${v === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const txtIn = (k, val, list, ph = '') => `<input class="inp" data-k="${k}" value="${esc(val || '')}" list="${list}" placeholder="${esc(ph)}" maxlength="12" spellcheck="false">`;
  function elementForm(e) {
    const P = props(e), D = DEFS[e.type];
    let f = '';
    // Repère sur le schéma : 1V1 pour le distributeur de puissance, 1S1… pour les boutons, 1V2… pour les cellules et réducteurs.
    if (D.tag) f += field(tl('Repère'), `<input class="inp" data-k="label" value="${esc(P.label || '')}" maxlength="12" placeholder="${D.cat === 'valve' ? '1V1' : '1V2'}">`);
    if (e.type === 'v32') {
      f += field(tl('Commande'), sel('act', P.act, ACT32())) + field(tl('Au repos'), sel('normal', P.normal, { nc: tl('normalement fermé (1 obturé)'), no: tl('normalement ouvert (1 → 2)') }));
      if (P.act === 'sol') f += field(tl('Bobine (repère du montage)'), txtIn('coil', P.coil, 'pnCoils', 'Y1'));
      if (P.act === 'tempo') {
        f += field(tl('Retard (secondes)'), `<input class="inp" type="number" data-k="delay" min="0.1" max="600" step="0.5" value="${delayOf(P)}">`);
        f += `<p class="note">${tl('Le temporisateur bascule quand son orifice de pilotage 12 est resté sous pression pendant tout le retard ; il revient au repos dès que le pilotage retombe. Le cadran au-dessus du symbole montre le temps écoulé pendant la simulation.')}</p>`;
      }
      if (P.act === 'roller') {
        // Galet : le vérin dont la tige l'actionne, et à quelle fin de course.
        const cyls = ed.circuit().elements.filter(x => x.type === 'cyl1' || x.type === 'cyl2').map(x => (x.p && x.p.label) || x.id);
        f += field(tl('Vérin qui l’actionne'), sel('cam', P.cam, Object.fromEntries([['', tl('(choisir)')], ...cyls.map(n => [n, n])])));
        f += field(tl('Fin de course'), sel('end', P.end, { 1: tl('tige sortie ({0})', camText({ ...P, end: '1' }) || 'a1'), 0: tl('tige rentrée ({0})', camText({ ...P, end: '0' }) || 'a0') }));
        f += `<p class="note">${tl('Le galet est actionné quand la came de la tige arrive en fin de course : il envoie alors l’air de 1 vers 2 (signal pour l’étape suivante du cycle).')}</p>`;
      }
    }
    if (e.type === 'v52') {
      f += field(tl('Commande côté 14'), sel('left', P.left, ACT())) + field(tl('Rappel côté 12'), sel('right', P.right, { spring: tl('Ressort (monostable)'), ...ACT() }));
      if (P.left === 'sol') f += field(tl('Bobine côté 14'), txtIn('coilL', P.coilL, 'pnCoils', 'Y1'));
      if (P.right === 'sol') f += field(tl('Bobine côté 12'), txtIn('coilR', P.coilR, 'pnCoils', 'Y2'));
    }
    if (e.type === 'v53') {
      f += field(tl('Commande côté 14'), sel('left', P.left, ACT())) + field(tl('Commande côté 12'), sel('right', P.right, ACT()));
      f += field(tl('Position centrale'), sel('center', P.center, { closed: tl('centre fermé (tout obturé)'), exhaust: tl('centre à l’échappement (4 et 2 à l’air libre)'), pressure: tl('centre sous pression (1 vers 4 et 2)') }));
      if (P.left === 'sol') f += field(tl('Bobine côté 14'), txtIn('coilL', P.coilL, 'pnCoils', 'Y1'));
      if (P.right === 'sol') f += field(tl('Bobine côté 12'), txtIn('coilR', P.coilR, 'pnCoils', 'Y2'));
      f += `<p class="note">${tl('Sans commande, les ressorts ramènent le tiroir au centre : un vérin peut s’arrêter en cours de course.')}</p>`;
    }
    if (e.type === 'pswitch') f += field(tl('Contact (repère du montage)'), txtIn('sensor', P.sensor, 'pnSensors', 'S1')) + field(tl('Seuil (bar)'), `<input class="inp" type="number" data-k="bar" min="0.5" max="10" step="0.5" value="${P.bar}">`);
    if (e.type === 'cyl1' || e.type === 'cyl2') {
      f += field(tl('Repère'), `<input class="inp" data-k="label" value="${esc(P.label || '')}" maxlength="12" placeholder="1A">`);
      const num = (k, label, min, max, step) => field(label, `<input class="inp" type="number" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${P[k]}">`);
      if (physical()) {
        f += num('bore', tl('Alésage (mm)'), 8, 100, 1) + num('rod', tl('Diamètre de tige (mm)'), 4, 40, 1) + num('stroke', tl('Course (mm)'), 10, 500, 5) + num('mass', tl('Masse mobile (kg)'), 0.1, 50, 0.1) + num('load', tl('Charge contre la sortie (N)'), -2000, 2000, 10);
        const g = cylOf(e);
        f += `<p class="note">${tl('Poussée théorique à {0} bar : {1} N en sortie, {2} N en rentrée.', supplyBar(), Math.round(g.A * supplyBar() * 1e5), Math.round(g.Aa * supplyBar() * 1e5))}</p>`;
      } else f += num('time', tl('Durée d’une course (s)'), 0.2, 20, 0.1);
      f += field(tl('Capteur tige rentrée'), txtIn('s0', P.s0, 'pnSensors', 'B1')) + field(tl('Capteur tige sortie'), txtIn('s1', P.s1, 'pnSensors', 'B2'));
    }
    if (e.type === 'flowctl') f += field(tl('Ouverture : {0} %', Math.round(P.open)), `<input type="range" data-k="open" min="5" max="100" step="5" value="${P.open}">`) + `<p class="note">${tl('Passage libre de 1 vers 2, réglé de 2 vers 1 : orifice 2 côté vérin, il freine l’échappement (réglage de la vitesse de sortie ou de rentrée).')}</p>`;
    if (e.type === 'supply') f += physical() ? field(tl('Pression du réseau (bar)'), `<input class="inp" type="number" data-k="bar" min="1" max="10" step="0.5" value="${P.bar}">`) : `<p class="note">${tl('Air comprimé à 6 bar, comme le réseau d’un atelier.')}</p>`;
    const ports = D.ports(e).map(p => p.id).join(', ');
    return `<section class="pnSec"><h3>${icon('pneu')}${esc(D.name())}</h3>${f}<p class="pnPorts">${tl('Orifices : {0}', ports)}</p><div class="row"><button type="button" class="btn small" data-del>${icon('trash')}<span>${tl('Supprimer')}</span></button></div></section>`;
  }
  function renderPane() {
    host.classList.toggle('phys', physical());
    if (pane.hidden && !on) return;
    const c = ed.circuit(), s = ed.selected(), e = s && s.el ? c.elements.find(x => x.id === s.el) : null;
    const coils = benchOf('coil24'), sensors = benchOf('cylsensor', 'pressostat');
    const issues = checkPneu(c, { coils, sensors, inputs: benchOf('button', 'cylsensor', 'pressostat') });
    let html = `<datalist id="pnCoils">${coils.map(n => `<option value="${esc(n)}">`).join('')}</datalist><datalist id="pnSensors">${sensors.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
    if (e) html += elementForm(e);
    else if (s && s.tube) html += `<section class="pnSec"><h3>${icon('cable')}${tl('Tuyau')}</h3><div class="row"><button type="button" class="btn small" data-del>${icon('trash')}<span>${tl('Supprimer')}</span></button></div></section>`;
    else html += `<section class="pnSec"><h3>${icon('pneu')}${tl('Circuit pneumatique')}</h3>${field(tl('Modèle de simulation'), `<select class="sel" data-model>${[['', tl('Tout ou rien (positions, temps de course)')], ['physical', tl('Physique (pressions, débits, forces)')]].map(([v, l]) => `<option value="${v}"${(c.model || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`)}<p class="note">${physical() ? tl('Pression de chaque volume, débit des distributeurs et des réducteurs (ISO 6358), force des pistons (pression × section) contre la charge, les frottements et la masse.') : tl('Chaque orifice est sous pression, à l’échappement ou fermé ; un vérin met sa durée de course, ralentie par le réducteur le plus fermé.')}</p><p class="note">${tl('Cliquez sur un élément pour le régler. Tirez un tuyau d’un orifice (petit rond) à un autre ; Suppr retire l’élément ou le tuyau choisi.')}</p></section>`;
    // Liaisons avec le montage : bobines et capteurs, trouvés ou non.
    // Repères commandés ou lus par le GRAFCET du plan : liés, même sans électrovanne ni capteur dans le montage.
    const GC = compiled(c.grafcet), gOut = GC && c.grafcet.drive !== false ? GC.outputs : new Set(), gVars = GC ? GC.vars : new Set();
    let absent = 0;
    const rows = tagsOf(c).map(({ name: n, kind }) => {
      const ok = (kind === 'coil' ? coils : sensors).includes(n), viaG = kind === 'coil' ? gOut.has(n) : gVars.has(n.toLowerCase());
      if (!ok && !viaG) absent++;
      return `<li class="${ok || viaG ? 'ok' : 'bad'}"><b>${esc(n)}</b><span>${kind === 'coil' ? tl('bobine') : tl('capteur')}</span><span class="grow"></span><i class="pnLive" data-live="${esc(n)}" data-kind="${kind}" hidden></i>${ok ? icon('check') : viaG ? `<small class="pnViaG">GRAFCET</small>` : `<small>${tl('absent du montage')}</small>`}</li>`;
    }).join('');
    const addBtn = absent ? `<button type="button" class="btn small primary" data-linkbench data-tip="${tl('Ajoute au montage une électrovanne ou un capteur pour chaque repère absent, câblés à la carte')}">${icon('plus')}<span>${tl('Ajouter au montage et câbler ({0})', absent)}</span></button>` : '';
    html += `<section class="pnSec"><h3>${icon('link')}${linked() ? tl('Liaisons avec le montage') : tl('Bobines et capteurs')}</h3>${rows ? `<ul class="pnLinks">${rows}</ul>${addBtn}` : `<p class="note">${tl('Aucune bobine ni aucun capteur dans ce circuit. Ajoutez au montage une électrovanne 24 V (Y1) et des capteurs de vérin (B1, B2), puis reportez leurs repères ici.')}</p>`}</section>`;
    html += `<section class="pnSec"><h3>${icon('check')}${tl('Vérification')}</h3>${issues.length ? `<ul class="pnIssues">${issues.map(i => `<li class="${i.level}">${esc(i.text)}</li>`).join('')}</ul>` : `<p class="note ok">${tl('Aucun problème trouvé.')}</p>`}</section>`;
    // Simulation : la section est posée une fois, ses valeurs sont mises à jour sur place (updateLive), sans
    // reconstruire le panneau à chaque image (les listes, boutons et champs restent stables sous le pointeur).
    html += `<section class="pnSec pnSimSec" hidden><h3>${icon('activity')}${tl('Simulation')}</h3><ul class="pnLinks pnCyls"></ul><ul class="pnLinks pnBtns"></ul><ul class="pnIssues pnLeaks"></ul><div class="pnSeq" hidden></div></section>`;
    // Le champ en cours de saisie garde le focus (et son curseur) après la reconstruction.
    const a = document.activeElement, keep = a && pane.contains(a) && a.matches('[data-k], [data-model]') ? { sel: a.dataset.k ? `[data-k="${a.dataset.k}"]` : '[data-model]', start: a.selectionStart, end: a.selectionEnd } : null;
    pane.innerHTML = html;
    if (keep) { const f = pane.querySelector(keep.sel); if (f) { f.focus(); try { if (keep.start != null) f.setSelectionRange(keep.start, keep.end); } catch (e) { /* champ sans sélection (nombre, liste) */ } } }
    updateLive();
  }
  /** Valeurs de simulation du panneau : état des bobines et capteurs, vérins, boutons, fuites. Écrit ce qui change. */
  function updateLive() {
    const sec = pane.querySelector('.pnSimSec'); if (!sec) return;
    const sim = simOn(), c = ed.circuit();
    if (sec.hidden === sim) sec.hidden = !sim;
    pane.querySelectorAll('[data-live]').forEach(i => {
      const n = i.dataset.live, coil = i.dataset.kind === 'coil';
      const live = sim ? (coil ? !!(app.comps().find(x => x.name === n) || {}).coilOn || R.out.has(n) : !!(simRes && simRes.sensors.get(n))) : null;
      const txt = live == null ? '' : live ? (coil ? tl('excitée') : tl('fermé')) : (coil ? tl('au repos') : tl('ouvert')), cls = 'pnLive' + (live ? ' on' : '');
      if (i.hidden !== (live == null)) i.hidden = live == null;
      if (i.textContent !== txt) i.textContent = txt;
      if (i.className !== cls) i.className = cls;
    });
    if (!sim) return;
    const put = (sel, h) => { const el = sec.querySelector(sel); if (el.dataset.h === h) return; el.dataset.h = h; el.innerHTML = h; el.hidden = !h; };
    {
      const cyl = c.elements.filter(x => x.type.startsWith('cyl')).map(x => {
        const name = esc(props(x).label || DEFS[x.type].name()), pct = Math.round((st.x[x.id] || 0) * 100);
        if (!physical()) return `<li><b>${name}</b><span class="grow"></span>${tl('{0} % sorti', pct)}</li>`;
        const g = cylOf(x), f1 = v => String(Math.round(v * 10) / 10).replace('.', ','), pa = (st.bar || {})[`${x.id}:1`] ?? 0, pb = x.type === 'cyl2' ? (st.bar || {})[`${x.id}:2`] ?? 0 : 0;
        return `<li class="pnPhys"><b>${name}</b><span>${tl('{0} mm sur {1}', Math.round((st.x[x.id] || 0) * g.S * 1000), Math.round(g.S * 1000))} · ${tl('{0} m/s', f1((st.v || {})[x.id] || 0))}</span><span>${tl('chambres : {0} bar / {1} bar', f1(pa), f1(pb))} · ${tl('force {0} N', Math.round((st.F || {})[x.id] || 0))}</span></li>`;
      }).join('');
      const leaks = (st.leaks || []).map(l => { const x = c.elements.find(y => y.id === l.el); return `<li class="error">${tl('Fuite : orifice {0} de « {1} » ouvert à l’air libre', l.port, x ? DEFS[x.type].name() : l.el)}</li>`; }).join('');
      // Boutons poussoirs des distributeurs : « Appuyer » les maintient (deux mains, deux postes) ; clic maintenu sur le plan aussi.
      const btns = c.elements.filter(x => /^v/.test(x.type)).flatMap(x => { const P = props(x), out = []; if ((x.type === 'v32' ? P.act : P.left) === 'push') out.push([x, x.id, x.type === 'v32' ? '' : tl('côté 14')]); if (x.type !== 'v32' && P.right === 'push') out.push([x, `${x.id}:R`, tl('côté 12')]); return out; })
        .map(([x, k, side]) => `<li><b>${esc(props(x).label || DEFS[x.type].name())}</b><span>${esc(side)}</span><span class="grow"></span><button type="button" class="btn small${pushed.has(k) ? ' primary' : ''}" data-push="${esc(k)}" aria-pressed="${pushed.has(k)}">${pushed.has(k) ? tl('Relâcher') : tl('Appuyer')}</button></li>`).join('');
      put('.pnCyls', cyl); put('.pnBtns', btns); put('.pnLeaks', leaks);
      // Cycle observé : les derniers mouvements (A+ B+ …) et le diagramme des phases.
      const moves = R.rec.moves, n = c.elements.filter(x => x.type.startsWith('cyl')).length;
      if (n) put('.pnSeq', `<h4>${tl('Cycle observé')}</h4>${moves.length ? `<p class="pnMoves">${moves.slice(-12).map(m => `<b>${esc(moveText(m))}</b>`).join(' ')}</p>${phaseSvg(R.rec, c)}` : `<p class="note">${tl('Aucun mouvement pour l’instant : les courses des vérins s’inscriront ici (A+ tige sortie, A− tige rentrée).')}</p>`}`);
    }
  }
  pane.addEventListener('change', e => {
    if (e.target.matches('[data-model]')) { ed.setCircuitProp('model', e.target.value || null); resetRun(); renderPane(); return; }
    const s = ed.selected(), k = e.target.dataset.k; if (!s || !s.el || !k) return;
    let v = e.target.value;
    if (k === 'time') v = Math.max(0.2, Math.min(20, +v || 1));
    if (k === 'delay') v = delayOf({ delay: v });
    if (k === 'bar') v = Math.max(0.5, Math.min(10, +v || 3));
    if (['bore', 'rod', 'stroke', 'mass', 'load'].includes(k)) v = Number.isFinite(+v) ? +v : 0;
    if (k === 'open') v = +v; // relâchement du curseur : enregistre le réglage glissé (setProp live) d'un coup
    if (['coil', 'coilL', 'coilR', 's0', 's1', 'sensor'].includes(k)) v = v.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12);
    if (k === 'label' || k === 'cam') v = v.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12); // a0, a1 : casse gardée
    ed.setProp(s.el, k, v); renderPane();
  });
  pane.addEventListener('input', e => { if (e.target.dataset.k === 'open') { const s = ed.selected(); if (s && s.el) { ed.setProp(s.el, 'open', +e.target.value, true); const fh = e.target.closest('.field').querySelector('.fh'); if (fh) fh.textContent = tl('Ouverture : {0} %', e.target.value); } } });
  pane.addEventListener('click', e => {
    if (e.target.closest('[data-del]')) ed.remove();
    if (e.target.closest('[data-linkbench]')) {
      // Sans carte (projet pneumatique) : on propose d'en poser une ; le projet devient électropneumatique.
      if (!app.comps().some(c => BOARDS[c.type])) {
        confirmDlg(tl('Ajouter au montage'), tl('Les électrovannes et les capteurs se câblent à une carte. Ajouter une carte Arduino Uno au montage ? Le projet devient électropneumatique : le montage et le circuit pneumatique côte à côte.'), tl('Ajouter la carte')).then(ok => {
          if (!ok) return;
          if (app.setKind && !linked()) app.setKind('epneu');
          app.addComp('uno');
          const r2 = linkBench({ animate: true });
          toast(r2.error || tl('Ajouté au montage : {0}. Ils sont câblés à {1}.', ['UNO', ...r2.added.map(x => x.name)].join(', '), r2.board), r2.error ? 'warn' : 'ok', 8000);
          renderPane();
        });
        return;
      }
      const r = linkBench({ animate: true });
      if (r.error) toast(r.error, 'warn', 7000);
      else if (r.unwired.length) toast(tl('Ajouté au montage : {0}. Pas de broche libre adaptée pour {1} : libérez-en une, puis « Câbler tout le circuit ».', r.added.map(x => x.name).join(', '), r.unwired.join(', ')), 'warn', 9000);
      else if (r.added.length) toast(tl('Ajouté au montage : {0}. Ils sont câblés à {1}.', r.added.map(x => x.name).join(', '), r.board), 'ok', 7000);
      renderPane(); return;
    }
    const p = e.target.closest('[data-push]'); if (p) { const k = p.dataset.push; if (pushed.has(k)) pushed.delete(k); else pushed.add(k); updateLive(); }
  });

  /* ---------- Machine 3D ---------- */
  // Vue chargée à la première ouverture (machine.js, Three.js déjà présent) : rien au démarrage. Elle montre la
  // machine animée par la simulation ; on n'y édite rien. Les scènes, leurs vérins et leurs commandes (bouton
  // d'ouverture, obstacle, deux mains, départ cycle…) viennent du registre SCENES de machine.js : chaque commande est
  // liée à une entrée du GRAFCET, au bouton d'un distributeur ou à un bouton du montage du même nom.
  const m3 = document.createElement('section'); m3.className = 'pn3d glass'; m3.hidden = true; m3.setAttribute('aria-label', tl('Machine 3D'));
  m3.innerHTML = `<header class="pn3dHead"><b class="pn3dMove" title="${tl('Machine 3D')}"><i class="pn3dDots" aria-hidden="true"></i>${icon('box')}3D</b><select class="sel" data-m3="kind" aria-label="${tl('Scène')}" hidden></select><span class="pn3dCyls"></span><span class="grow"></span>
      <span class="pn3dCtl"></span><button type="button" class="tb" data-m3="big" aria-label="${tl('Agrandir')}">${icon('expand')}</button><button type="button" class="tb" data-m3="close" aria-label="${tl('Fermer la vue 3D')}">${icon('x')}</button></header>
    <div class="pn3dView"><p class="pn3dHint"></p></div>`;
  host.appendChild(m3);
  let view = null, viewKey = '', last3d = 0, loading3d = null, M3 = null; // M3 : machine.js une fois chargé
  const sceneCfg = () => ed.circuit().scene || { kind: 'cylinders' };
  const sceneDef = () => (M3 ? M3.SCENES[M3.sceneId(sceneCfg())] : null);
  const ctlOf = role => { const d = sceneDef(); return (d && d.controls.find(c => c.role === role)) || null; };
  const cylsOf = () => ed.circuit().elements.filter(e => e.type === 'cyl1' || e.type === 'cyl2');
  const benchIn = n => app.comps().find(c => c.name.toLowerCase() === String(n).toLowerCase() && c.inp && 'pressed' in c.inp);
  /** Ce que désigne un nom : bouton du pupitre du GRAFCET, distributeur à bouton du plan, bouton du montage. */
  const namedKind = n => (!n ? null : grafInput(n) ? 'input' : ed.circuit().elements.some(e => e.id === n) ? 'valve' : benchIn(n) ? 'bench' : null);
  function pressNamed(n, v) {
    const k = namedKind(n);
    if (k === 'input' || k === 'valve') { const key = k === 'input' ? inputKey(n) : n; if (v) pushed.add(key); else pushed.delete(key); }
    if (k === 'bench') { benchIn(n).inp.pressed = !!v; app.invalidate(300); }
  }
  const isPressedNamed = n => { const k = namedKind(n); return k === 'input' ? pushed.has(inputKey(n)) : k === 'valve' ? pushed.has(n) : k === 'bench' ? !!benchIn(n).inp.pressed : false; };
  /**
   * Nom lié à une commande de la scène : son réglage (circuit.scene[rôle]), sinon le premier de ses noms par défaut
   * que le circuit connaît (porte : dcy, obs), sinon le bouton du montage de son rang (porte : le premier).
   */
  function roleName(role) {
    const c = ctlOf(role); if (!c) return null;
    const set = sceneCfg()[role]; if (set) return set;
    for (const n of c.defaults || []) if (namedKind(n)) return n;
    if (c.bench == null) return null;
    let k = 0; for (const x of app.comps()) if (x.type === 'button' && k++ === c.bench) return x.name;
    return null;
  }
  const roleOn = role => { const n = roleName(role); return !!n && isPressedNamed(n); };
  /**
   * Commande actionnée, depuis l'en-tête ou la scène 3D : maintenue, basculée à l'appui, ou action de la vue (un
   * colis). Une commande tenue par la vue elle-même (cellule du convoyeur) est relâchée sous le nom appuyé, même si
   * la scène a changé entre-temps ; elle ne repeint rien (elle arrive pendant la mise à jour de la vue).
   */
  const auto3d = new Map();
  function press3(role, down) {
    if (auto3d.has(role)) { pressNamed(auto3d.get(role), false); auto3d.delete(role); }
    const c = ctlOf(role); if (!c) return;
    const n = roleName(role);
    if (c.mode === 'auto') { if (down && namedKind(n)) { pressNamed(n, true); auto3d.set(role, n); } return; }
    if (c.mode === 'toggle') { if (down && n) pressNamed(n, !isPressedNamed(n)); }
    else { if (n) pressNamed(n, down); if (c.mode === 'click' && down && view) view.act(role); }
    paint3d(); if (view) view.update(st3());
  }
  /** Capteur par son repère (sans tenir compte de la casse), d'après la position des vérins et des pressostats. */
  function sensorOn(n) {
    const l = String(n).toLowerCase();
    for (const e of ed.circuit().elements) {
      const P = props(e), x = st.x[e.id] || 0;
      if ((e.type === 'cyl1' || e.type === 'cyl2') && String(P.s0).toLowerCase() === l && x <= 0.02) return true;
      if ((e.type === 'cyl1' || e.type === 'cyl2') && String(P.s1).toLowerCase() === l && x >= 0.98) return true;
      if (e.type === 'pswitch' && String(P.sensor).toLowerCase() === l && (st.closed || {})[e.id]) return true;
    }
    return false;
  }
  const st3 = () => ({ running: simOn(), t: R.t, x: id => st.x[id] || 0, press: (id, p) => (st.press || {})[`${id}:${p}`], sensor: sensorOn, coil: n => !!io.coil(n) || R.out.has(String(n).toUpperCase()), input: n => isPressedNamed(n), role: roleOn });
  const setHtml = (el, h) => { if (el._h !== h) { el._h = h; el.innerHTML = h; } }; // pas de bouton recréé sous le doigt
  /**
   * En-tête : scènes du registre, un vérin par rôle (si le circuit a plus de vérins que la machine n'en demande),
   * boutons des commandes liées ; message si la simulation est arrêtée. Tant que machine.js n'est pas chargé,
   * l'en-tête n'a ni liste ni bouton.
   */
  function paint3d() {
    const cfg = sceneCfg(), def = sceneDef(), names = cylsOf().map(e => props(e).label || e.id), kSel = m3.querySelector('[data-m3="kind"]'), id = M3 ? M3.sceneId(cfg) : '';
    kSel.hidden = !M3;
    setHtml(kSel, M3 ? Object.entries(M3.SCENES).map(([v, s]) => `<option value="${v}"${id === v ? ' selected' : ''}>${esc(s.name())}</option>`).join('') : '');
    setHtml(m3.querySelector('.pn3dCyls'), def && names.length > Math.max(1, def.cyls.length) ? def.cyls.map((r, i) => { const cur = names.includes(cfg[r.key]) ? cfg[r.key] : names[i] || names[0]; return `<select class="sel" data-m3="cyl" data-key="${r.key}" data-cur="${esc(cur)}" aria-label="${esc(r.label())}" title="${esc(r.label())}">${names.map(n => `<option value="${esc(n)}"${cur === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`; }).join('') : '');
    setHtml(m3.querySelector('.pn3dCtl'), def ? def.controls.map(c => {
      const n = roleName(c.role);
      if (c.mode === 'auto' || (c.mode !== 'click' && !namedKind(n))) return ''; // tenue par la vue, ou liée à rien : pas de bouton
      const on = !!namedKind(n) && isPressedNamed(n), text = esc(c.label(n || ''));
      return c.mode === 'toggle' ? `<button type="button" class="btn small${c.warn ? ' warn' : ''}" data-m3toggle="${c.role}" aria-pressed="${on}" title="${text}">${icon(c.icon || 'pointer')}<span>${text}</span></button>`
        : `<button type="button" class="btn small primary" data-m3press="${c.role}" aria-pressed="${on}" title="${text}">${icon(c.icon || 'pointer')}<span>${text}</span></button>`;
    }).join('') : '');
    kSel.value = id; for (const c of m3.querySelectorAll('.pn3dCyls select')) c.value = c.dataset.cur; // listes déjà peintes : la valeur suit le circuit (annulation)
    const hint = m3.querySelector('.pn3dHint'); hint.hidden = simOn(); hint.textContent = tl('Simulation arrêtée : lancez-la avec « Simuler » pour voir la machine bouger.');
    m3.querySelector('[data-m3="big"]').innerHTML = icon(m3.classList.contains('big') ? 'shrink' : 'expand');
  }
  /** Reconstruit la scène si le circuit a changé ce qu'elle montre (vérins, repères, réglages de la scène). */
  function refresh3d(force = false) {
    if (!view || m3.hidden) return;
    const c = ed.circuit(), key = JSON.stringify([sceneCfg(), cylsOf().map(e => [e.id, props(e).label, props(e).s0, props(e).s1, props(e).bore]), c.elements.filter(e => /^v/.test(e.type)).map(e => [props(e).coil, props(e).coilL])]);
    if (force || key !== viewKey) { viewKey = key; view.build(sceneCfg(), c); }
    view.update(st3()); paint3d();
  }
  async function open3d() {
    if (!on) setMode(true);
    m3.hidden = false; keep3d(); paint3d(); host.querySelector('[data-m3open]').setAttribute('aria-pressed', 'true');
    if (!view) {
      loading3d = loading3d || import('./machine.js');
      M3 = await loading3d;
      if (m3.hidden || view) return;
      view = M3.createMachineView(m3.querySelector('.pn3dView'), { press: press3 });
      viewKey = '';
    }
    refresh3d();
  }
  /** Circuit ouvert : la vue 3D s'ouvre s'il a une scène (porte de TER…), à l'entrée dans le plan pneumatique. */
  let pending3d = false;
  function sync3d() { if (ed.circuit().scene) { if (on) open3d(); else pending3d = true; } else { pending3d = false; if (!m3.hidden) close3d(); } }
  function close3d() { m3.hidden = true; host.querySelector('[data-m3open]').setAttribute('aria-pressed', 'false'); if (view) { view.dispose(); view = null; } }
  m3.addEventListener('change', e => {
    const k = e.target.dataset.m3; if (!k || !M3) return;
    const cfg = { ...sceneCfg() };
    if (k === 'kind') {
      // Scène choisie : ses réglages (porte de bus : kind 'door', skin 'bus'), un vérin par rôle s'il n'est pas choisi.
      const d = M3.SCENES[e.target.value]; if (!d) return;
      delete cfg.skin; Object.assign(cfg, d.cfg || { kind: e.target.value });
      d.cyls.forEach((r, i) => { const c = cylsOf()[i]; if (!cfg[r.key] && c) cfg[r.key] = props(c).label || c.id; });
    }
    if (k === 'cyl') cfg[e.target.dataset.key || 'cyl'] = e.target.value;
    ed.setCircuitProp('scene', cfg); refresh3d(true);
  });
  m3.addEventListener('click', e => {
    const b = e.target.closest('[data-m3]'), t = e.target.closest('[data-m3toggle]');
    if (t) { press3(t.dataset.m3toggle, true); return; }
    if (!b) return;
    if (b.dataset.m3 === 'close') close3d();
    if (b.dataset.m3 === 'big') { m3.classList.toggle('big'); unplace3d(); paint3d(); if (view) requestAnimationFrame(() => view.resize()); }
  });
  // Boutons maintenus de l'en-tête (ouvrir, départ cycle, envoyer un colis) : appuyés tant que le clic est maintenu.
  let held3d = null;
  /*
   * Fenêtre 3D déplaçable (glisser son en-tête) et redimensionnable (coin en bas à droite) ; sa place est gardée.
   * Dans la fenêtre, glisser fait tourner la machine, clic droit glissé la déplace, la molette zoome.
   */
  const POS3D = 'jollof-pn3d-pos';
  m3.insertAdjacentHTML('beforeend', `<span class="pn3dGrip" aria-hidden="true"></span>`);
  m3.querySelector('.pn3dHead').title = tl('Glisser l’en-tête : déplacer la fenêtre · coin en bas à droite : la redimensionner · dans la vue : tourner (glisser), déplacer (clic droit), zoomer (molette)');
  /** Place la fenêtre (px dans le plan) en la gardant visible. */
  function place3d(r, save = true) {
    const H = host.getBoundingClientRect(), w = Math.max(300, Math.min(H.width - 16, r.w)), h = Math.max(200, Math.min(H.height - 16, r.h));
    const x = Math.max(8, Math.min(H.width - w - 8, r.x)), y = Math.max(44, Math.min(H.height - h - 8, r.y));
    Object.assign(m3.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', right: 'auto', bottom: 'auto', maxWidth: 'none' });
    m3.classList.add('placed');
    if (save) setPref(POS3D, JSON.stringify({ x, y, w, h }));
    if (view) view.resize();
  }
  function unplace3d() { m3.classList.remove('placed'); ['left', 'top', 'width', 'height', 'right', 'bottom', 'maxWidth'].forEach(k => (m3.style[k] = '')); setPref(POS3D, ''); }
  const rect3d = () => { const H = host.getBoundingClientRect(), r = m3.getBoundingClientRect(); return { x: r.left - H.left, y: r.top - H.top, w: r.width, h: r.height }; };
  function drag3d(e, mode) {
    e.preventDefault(); m3.classList.remove('big');
    const r0 = rect3d(), x0 = e.clientX, y0 = e.clientY;
    m3.classList.add('dragging');
    const mv = ev => { const dx = ev.clientX - x0, dy = ev.clientY - y0; place3d(mode === 'move' ? { ...r0, x: r0.x + dx, y: r0.y + dy } : { ...r0, w: r0.w + dx, h: r0.h + dy }, false); };
    const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); m3.classList.remove('dragging'); setPref(POS3D, JSON.stringify(rect3d())); paint3d(); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  }
  m3.querySelector('.pn3dHead').addEventListener('pointerdown', e => { if (e.button !== 0 || e.target.closest('button, select, input')) return; drag3d(e, 'move'); });
  m3.querySelector('.pn3dGrip').addEventListener('pointerdown', e => { if (e.button === 0) drag3d(e, 'size'); });
  m3.querySelector('.pn3dHead').addEventListener('dblclick', e => { if (!e.target.closest('button, select, input')) { unplace3d(); if (view) requestAnimationFrame(() => view.resize()); } });
  // Place gardée (à la réouverture, et si le plan change de taille).
  const keep3d = () => { const s = pref(POS3D); if (!s || m3.hidden) return; try { place3d(JSON.parse(s), false); } catch (err) { /* place illisible */ } };
  new ResizeObserver(() => { if (m3.classList.contains('placed')) place3d(rect3d(), false); }).observe(host);
  m3.addEventListener('pointerdown', e => { const b = e.target.closest('[data-m3press]'); if (!b || e.button !== 0) return; e.preventDefault(); held3d = b.dataset.m3press; press3(held3d, true); });
  addEventListener('pointerup', () => { if (!held3d) return; const r = held3d; held3d = null; press3(r, false); }, true);

  /* ---------- Mode ---------- */
  let hintBefore = '', countsBefore = '';
  function counts() {
    if (!on) return;
    const c = ed.circuit(), n = c.elements.length, t = (c.tubes || []).length;
    $('#counts').textContent = tl('{0} élément{1} · {2} tuyau{3}', n, n > 1 ? 's' : '', t, t > 1 ? (isEn ? 's' : 'x') : ''); // tuyaux / tubes
    host.querySelector('.pnEmpty').hidden = n > 0;
  }
  function paintSwitch() { sw.querySelectorAll('[data-ws]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ws === (on ? 'pneu' : app.logic && app.logic.isOn() ? 'logic' : 'elec')))); }
  function setMode(v) {
    v = !!v;
    if (v && split) { splitWas = null; setSplit(false); } // le plan en grand remplace la vue partagée
    if (v === on) { paintSwitch(); return; }
    on = v;
    appEl.classList.toggle('pneuMode', on); document.body.classList.toggle('pneuOpen', on);
    host.hidden = !on; paintSwitch(); mini.hidden = true;
    if (on) {
      if (!libReady) { libReady = true; renderLib(); }
      app.history(ed.history);
      countsBefore = $('#counts').textContent; hintBefore = $('#hint').textContent;
      $('#hint').textContent = tl('Orifice → orifice : tirer un tuyau · glisser dans le vide : encadrer · Espace + glisser : se déplacer · Molette : zoom · ? : raccourcis');
      app.setTab('pneu'); counts(); renderPane();
      ed.render(); if (!fitted) { fitted = true; requestAnimationFrame(() => ed.fit()); }
      if (pending3d) { pending3d = false; open3d(); }
    } else {
      pushed.clear(); app.history(null);
      if (countsBefore) $('#counts').textContent = countsBefore;
      $('#hint').textContent = hintBefore;
      if ($('#tab-pneu').getAttribute('aria-selected') === 'true') app.setTab('wiring');
      app.invalidate(400); showMini();
    }
    paintSplitBtn();
    if (on && app.ensureSpace) app.ensureSpace('pneu');
  }
  /* ---------- Clavier ---------- */
  const busyUi = () => document.querySelector('.sDialogWrap, .sMenu') || [...document.querySelectorAll('.modal')].some(m => !m.hidden);
  addEventListener('keydown', e => {
    if ((!on && !(split && host.contains(document.activeElement))) || busyUi()) return;
    const a = document.activeElement;
    if (a && (/INPUT|SELECT|TEXTAREA/.test(a.tagName) || a.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !['a', 'c', 'x', 'v', 'd'].includes(e.key.toLowerCase())) return; // enregistrer, ouvrir, annuler, bibliothèque : application
    if (!mod && nav.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (ed.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (mod) return;
    if (e.key.length === 1 || ['Delete', 'Backspace'].includes(e.key)) e.stopImmediatePropagation(); // pas de raccourcis de la scène 3D ici
  }, true);
  addEventListener('keyup', e => nav.key(e), true); // Espace relâché : la main se range

  /* ---------- Simulation commune ---------- */
  // La carte excite les bobines (coil24.coilOn) ; le circuit avance ; les capteurs de vérin du montage suivent.
  // Le GRAFCET du plan lit aussi les boutons et capteurs du montage (par leur nom) ; ses boutons sont « @nom ».
  const io = {
    coil: n => { if (!linked()) return false; const c = app.comps().find(x => x.name === n && x.type === 'coil24'); return !!(c && c.coilOn); },
    pushed: id => pushed.has(id),
    input: n => { if (!linked()) return false; const c = app.comps().find(x => x.name.toLowerCase() === n && x.inp && 'pressed' in x.inp); return !!(c && c.inp.pressed); }
  };
  app.onSimFrame(dt => {
    const c = ed.circuit(); if (!c.elements.length || !(kind() === 'pneu' || kind() === 'epneu')) return;
    simRes = runStep(R, c, io, Math.min(0.1, dt)); st = R.st;
    if (linked()) for (const comp of app.comps()) {
      if ((comp.type !== 'cylsensor' && comp.type !== 'pressostat') || !simRes.sensors.has(comp.name)) continue;
      const v = simRes.sensors.get(comp.name);
      if (!!comp.inp.pressed !== v) { comp.inp.pressed = v; app.invalidate(200); }
    }
    const now = performance.now();
    if (now - lastDraw > 33) { lastDraw = now; if (on || split) ed.render(); else drawMini(); }
    const shown = on || split; // plan affiché : plein écran ou dans la vue partagée
    if (shown && !pane.hidden && now - lastPane > 150) { lastPane = now; try { updateLive(); } catch (e) { console.error(e); } } // le panneau ne bloque jamais la simulation
    if (shown && gf.isOpen() && now - lastGf > 100) { lastGf = now; try { gf.live(); } catch (e) { console.error(e); } }
    if (shown && view && !m3.hidden && now - last3d > 33) { last3d = now; try { view.update(st3()); } catch (e) { console.error(e); } }
    if (split && now - lastChain > 100) { lastChain = now; try { liveChain(); } catch (e) { console.error(e); } }
  });
  app.onSimState(running => {
    resetRun(); pushed.clear(); host.classList.toggle('running', running);
    // Projet électropneumatique : la vue partagée s'ouvre au lancement (sauf si on l'a fermée), et la disposition
    // d'avant revient à l'arrêt.
    if (running && !split && mixed() && pref(SPLIT_KEY) !== 'off' && !(app.logic && app.logic.isOn())) { const was = on ? 'pneu' : 'elec'; setSplit(true); splitWas = was; if (!splitTold) { splitTold = true; toast(tl('Vue partagée : le montage et le circuit pneumatique ensemble pendant la simulation. Fermez-la (×) pour qu’elle ne s’ouvre plus d’elle-même.'), 'ok', 7000); } }
    else if (!running && splitWas) { const was = splitWas; splitWas = null; if (was === 'pneu') setMode(true); else setSplit(false); }
    if (gf.isOpen()) gf.render(); // pupitre actif pendant la simulation
    if (view && !m3.hidden) refresh3d();
    if (running && on) app.setTab('pneu');
    if (split) paintChain(true);
    if (on || split) { ed.render(); try { renderPane(); } catch (e) { console.error(e); } } else showMini();
  });

  /* ---------- Vignette sur le banc ---------- */
  const mini = document.createElement('div'); mini.className = 'pnMini glass'; mini.hidden = true;
  mini.innerHTML = `<header>${icon('pneu')}<b>${tl('Circuit pneumatique')}</b><span class="grow"></span><button type="button" class="tb" data-split-open data-tip="${tl('Vue partagée : le montage et le circuit côte à côte')}" aria-label="${tl('Vue partagée')}">${icon('split')}</button><button type="button" class="tb" data-open-pneu data-tip="${tl('Ouvrir le plan de travail pneumatique')}">${icon('expand')}</button><button type="button" class="tb" data-hide aria-label="${tl('Masquer')}">${icon('x')}</button></header><svg class="pnMiniSvg"></svg>`;
  $('#stage').appendChild(mini);
  let miniHidden = false;
  mini.addEventListener('click', e => {
    if (e.target.closest('[data-open-pneu]')) { if (app.logic && app.logic.isOn()) app.logic.setMode(false); setMode(true); return; }
    if (e.target.closest('[data-split-open]')) { setPref(SPLIT_KEY, 'auto'); setSplit(true); return; }
    if (e.target.closest('[data-hide]')) { miniHidden = true; mini.hidden = true; }
  });
  // Sur le banc, le circuit ne se montre que si le montage le commande ou le lit (bobine, capteur de vérin, pressostat).
  function showMini() { mini.hidden = on || split || miniHidden || !simOn() || !mixed(); if (!mini.hidden) drawMini(); }
  function drawMini() {
    if (on || split || miniHidden) return;
    const c = ed.circuit(); if (!simOn() || !mixed()) { mini.hidden = true; return; }
    mini.hidden = false;
    const b = boundsOf(c) || [0, 0, 20, 10], svg = mini.querySelector('.pnMiniSvg');
    svg.setAttribute('viewBox', `${(b[0] - 2) * G} ${(b[1] - 2) * G} ${(b[2] - b[0] + 4) * G} ${(b[3] - b[1] + 4) * G}`);
    svg.innerHTML = circuitSvg(c, st, { noPorts: true });
  }
  app.onSimState(running => { if (running) miniHidden = false; showMini(); });

  /* ---------- Vue partagée : le montage et le circuit pneumatique côte à côte ---------- */
  // Un projet électropneumatique se suit des deux côtés à la fois : la carte et ses fils à gauche (scène 3D ou schéma),
  // le circuit à droite, et au-dessus la chaîne de commande (chaque repère, la broche de la carte, son état en direct).
  // Elle s'ouvre seule au lancement de la simulation d'un tel projet (sauf si on l'a fermée), ou par son bouton.
  // Rien n'est créé avant la première ouverture.
  const SPLIT_KEY = 'jollof-pn-split', SPLIT_FR = 'jollof-pn-split-fr';
  const pref = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } };
  let splitWas = null, splitTold = false, splitPane = null, chainKey = '', chainEls = null;
  sw.insertAdjacentHTML('afterend', `<button type="button" class="tb label pnSplitBtn" hidden aria-pressed="false" data-tip="${tl('Vue partagée : le montage et le circuit pneumatique côte à côte')}">${icon('split')}<span>${tl('Vue partagée')}</span></button>`);
  const splitBtn = sw.nextElementSibling;
  splitBtn.onclick = () => { const v = !split; splitWas = null; setSplit(v); setPref(SPLIT_KEY, v ? 'auto' : 'off'); };
  /** Projet électropneumatique : un circuit pneumatique, et au montage une bobine, un capteur de vérin ou un pressostat. */
  const mixed = () => linked() && ed.circuit().elements.length > 0 && app.comps().some(c => Object.values(BENCH_LINK).includes(c.type));
  function paintSplitBtn() {
    const show = linked() && ed.circuit().elements.length > 0 && !(app.logic && app.logic.isOn());
    if (splitBtn.hidden === show) splitBtn.hidden = !show;
    if (splitBtn.getAttribute('aria-pressed') !== String(split)) splitBtn.setAttribute('aria-pressed', String(split));
  }
  function buildSplit() {
    splitPane = document.createElement('section'); splitPane.className = 'pnSplit'; splitPane.setAttribute('aria-label', tl('Circuit pneumatique'));
    splitPane.innerHTML = `<div class="pnSplitGrip" role="separator" aria-orientation="vertical" tabindex="0" aria-label="${tl('Largeur du circuit pneumatique')}" title="${tl('Glisser pour partager la place')}"></div>
      <header class="pnSplitHead">${icon('pneu')}<b>${tl('Pneumatique')}</b><div class="pnChain" role="list" aria-label="${tl('Chaîne de commande')}"></div>
        <button type="button" class="tb" data-split="full" data-tip="${tl('Plan pneumatique en grand')}" aria-label="${tl('Plan pneumatique en grand')}">${icon('expand')}</button><button type="button" class="tb" data-split="close" data-tip="${tl('Fermer la vue partagée')}" aria-label="${tl('Fermer la vue partagée')}">${icon('x')}</button></header>`;
    $('#stage').after(splitPane);
    splitPane.addEventListener('click', e => {
      const b = e.target.closest('[data-split]'), l = e.target.closest('[data-link]');
      if (b && b.dataset.split === 'full') { splitWas = null; setMode(true); return; }
      if (b && b.dataset.split === 'close') {
        // Fermée pendant la simulation où elle s'était ouverte seule : elle ne s'ouvrira plus d'elle-même.
        if (splitWas) { setPref(SPLIT_KEY, 'off'); toast(tl('La vue partagée ne s’ouvrira plus d’elle-même. Le bouton « Vue partagée » la rouvre.'), 'ok', 6000); }
        splitWas = null; setSplit(false); return;
      }
      if (l) focusLink(l.dataset.link);
    });
    // Poignée : partage de la place entre le montage et le circuit (fractions de la largeur, gardées d'une fois sur l'autre).
    const grip = splitPane.querySelector('.pnSplitGrip');
    const setFr = r => { r = Math.max(0.25, Math.min(0.75, r)); appEl.style.setProperty('--pnSplitFr', `${r}fr`); appEl.style.setProperty('--pnBenchFr', `${1 - r}fr`); return r; };
    const fr0 = +pref(SPLIT_FR); if (fr0 > 0) setFr(fr0);
    let drag = null;
    grip.addEventListener('pointerdown', e => { if (e.button !== 0) return; const st0 = $('#stage').getBoundingClientRect(), sp = splitPane.getBoundingClientRect(); drag = { left: st0.left, right: sp.right, r: 0.5 }; grip.setPointerCapture(e.pointerId); appEl.classList.add('pnDragging'); e.preventDefault(); });
    grip.addEventListener('pointermove', e => { if (drag) drag.r = setFr((drag.right - e.clientX) / Math.max(1, drag.right - drag.left)); });
    const done = () => { if (!drag) return; setPref(SPLIT_FR, String(Math.round(drag.r * 100) / 100)); drag = null; appEl.classList.remove('pnDragging'); requestAnimationFrame(() => ed.fit()); };
    grip.addEventListener('pointerup', done); grip.addEventListener('pointercancel', done);
    grip.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); const cur = parseFloat(getComputedStyle(appEl).getPropertyValue('--pnSplitFr')) || 0.5;
      setPref(SPLIT_FR, String(setFr(cur + (e.key === 'ArrowLeft' ? 0.05 : -0.05)))); requestAnimationFrame(() => ed.fit());
    });
    // Annuler (Ctrl+Z) : l'historique du plan sur lequel on vient de cliquer.
    splitPane.addEventListener('pointerdown', () => { if (split) app.history(ed.history); }, true);
    $('#stage').addEventListener('pointerdown', () => { if (split) app.history(null); }, true);
  }
  function setSplit(v) {
    v = !!v && linked() && ed.circuit().elements.length > 0;
    if (v === split) { paintSplitBtn(); return; }
    if (v) {
      if (app.logic && app.logic.isOn()) app.logic.setMode(false);
      if (on) setMode(false);
      if (!splitPane) buildSplit();
      split = true; appEl.classList.add('pnSplitOn');
      splitPane.appendChild(host); host.hidden = false; mini.hidden = true;
      host.querySelector('.pnEmpty').hidden = ed.circuit().elements.length > 0; // carte « plan vide » : seulement s'il l'est
      chainKey = ''; paintChain(); ed.render(); renderPane();
      requestAnimationFrame(() => { ed.fit(); if (app.frame) app.frame(); });
    } else {
      split = false; splitWas = null; appEl.classList.remove('pnSplitOn');
      $('#stage').insertBefore(host, mini); host.hidden = !on; app.history(on ? ed.history : null);
      requestAnimationFrame(() => { if (app.frame) app.frame(); if (on) ed.fit(); });
      showMini();
    }
    paintSplitBtn();
  }
  /** Broche de la carte qui commande une bobine (par la base de son transistor) ou lit un contact. */
  function pinOf(comp, A) {
    try {
      if (comp.type === 'coil24') {
        const q = A.members({ comp, key: '-' }).find(m => m.key === 'C' && m.comp.pins.B);
        const g = q && A.wnet({ comp: q.comp, key: 'B' }).gpio[0];
        return g ? { board: g.comp.name, pin: g.key, via: q.comp.name } : null;
      }
      const g = inspect(comp, A, partOf(comp)).io['1'];
      return g ? { board: g.comp.name, pin: g.key } : null;
    } catch (e) { return null; }
  }
  /** Liaisons du plan avec le montage : repère, composant du montage (ou null), broche de la carte (ou null). */
  function benchLinks() {
    const tags = tagsOf(ed.circuit()); if (!tags.length) return [];
    const A = app.analyze();
    return tags.map(t => { const comp = app.comps().find(c => c.type === t.type && c.name.toUpperCase() === t.name.toUpperCase()) || null; return { ...t, comp, pin: comp ? pinOf(comp, A) : null }; });
  }
  /** Chaîne de commande : une pastille par repère (broche, état en direct), l'étape active du GRAFCET, le cycle. */
  function paintChain(force = false) {
    if (!split || !splitPane) return;
    const c = ed.circuit(), key = JSON.stringify([tagsOf(c), app.comps().map(x => x.name + x.type), app.wires().length, !!(c.grafcet && c.grafcet.steps.length)]);
    if (!force && key === chainKey) return;
    chainKey = key;
    const box = splitPane.querySelector('.pnChain'), L = benchLinks();
    const pinTxt = l => (l.pin ? l.pin.pin : '');
    const tip = l => (l.kind === 'coil'
      ? (l.comp ? (l.pin ? tl('Bobine {0} : broche {1} de {2}, par le transistor {3}', l.name, l.pin.pin, l.pin.board, l.pin.via) : tl('Bobine {0} : pas encore commandée par une broche de la carte', l.name)) : tl('Bobine {0} : absente du montage', l.name))
      : (l.comp ? (l.pin ? tl('Capteur {0} : lu par la broche {1} de {2}', l.name, l.pin.pin, l.pin.board) : tl('Capteur {0} : pas encore relié à la carte', l.name)) : tl('Capteur {0} : absent du montage', l.name)));
    box.innerHTML = L.map(l => `<button type="button" role="listitem" class="pnChip ${l.kind}${l.comp ? '' : ' bad'}" data-link="${esc(l.name)}" title="${esc(tip(l))}"><i class="pnLed"></i><b>${esc(l.name)}</b>${pinTxt(l) ? `<small>${esc(pinTxt(l))}</small>` : ''}</button>`).join('')
      + (c.grafcet && c.grafcet.steps.length ? `<span class="pnChip info" role="listitem" title="${tl('Étapes actives du GRAFCET')}"><b>GRAFCET</b><small data-gfx>—</small></span>` : '')
      + `<span class="pnChip info cyc" role="listitem" title="${tl('Derniers mouvements des vérins')}" hidden><small data-cyc></small></span>`;
    chainEls = { chips: [...box.querySelectorAll('[data-link]')].map(el => ({ el, l: L.find(x => x.name === el.dataset.link) })), gfx: box.querySelector('[data-gfx]'), cyc: box.querySelector('[data-cyc]') };
    liveChain();
  }
  /** États en direct de la chaîne : écrits seulement quand ils changent. */
  function liveChain() {
    if (!chainEls) return;
    const sim = simOn();
    for (const { el, l } of chainEls.chips) {
      const v = sim && l ? (l.kind === 'coil' ? !!(l.comp && l.comp.coilOn) || R.out.has(l.name.toUpperCase()) : !!(simRes && simRes.sensors.get(l.name))) : false;
      if (el.classList.contains('on') !== v) el.classList.toggle('on', v);
    }
    if (chainEls.gfx) { const X = sim && R.g.X ? [...R.g.X].sort((a, b) => a - b).map(n => 'X' + n).join(' ') : '—'; if (chainEls.gfx.textContent !== X) chainEls.gfx.textContent = X; }
    if (chainEls.cyc) {
      const t = sim ? R.rec.moves.slice(-4).map(moveText).join(' ') : '', p = chainEls.cyc.parentElement;
      if (chainEls.cyc.textContent !== t) chainEls.cyc.textContent = t;
      if (p.hidden !== !t) p.hidden = !t;
    }
  }
  /** Une pastille choisie : le composant du montage est sélectionné, l'élément du plan aussi. */
  function focusLink(name) {
    const l = benchLinks().find(x => x.name === name); if (!l) return;
    if (l.comp) app.select(l.comp); else toast(tl('{0} n’est pas dans le montage : « Ajouter au montage et câbler » (onglet Pneumatique) l’y pose.', name), 'warn', 6000);
    ed.select({ el: l.el });
  }
  /**
   * Ajoute au montage les bobines et contacts que le plan nomme sans les y trouver (électrovanne 24 V, capteur de vérin,
   * pressostat, du nom du repère), puis les câble à la carte (étage à transistor et alimentation 24 V pour une bobine).
   * o : { wire: true, animate: false }. Rend { added: [{ name, type }], board } ou { error }.
   */
  function linkBench(o = {}) {
    const board = app.comps().find(c => BOARDS[c.type]);
    const missing = tagsOf(ed.circuit()).filter(t => !app.comps().some(c => c.type === t.type && c.name.toUpperCase() === t.name.toUpperCase()));
    if (!missing.length) return { added: [], board: board ? board.name : null };
    // Un repère déjà pris par un autre composant (Y1 pour un autre type) : le nom serait ambigu.
    const clash = missing.find(t => app.comps().some(c => c.name.toUpperCase() === t.name.toUpperCase()));
    if (clash) return { error: tl('Le repère {0} est déjà celui d’un autre composant du montage : renommez l’un des deux.', clash.name) };
    if (!board) return { error: tl('Ajoutez d’abord une carte (Arduino Uno…) au montage électronique : les bobines et les capteurs s’y câblent.') };
    const added = missing.map(t => app.addComp(t.type, { name: t.name }));
    if (o.wire !== false) added.forEach(c => app.autoWire(c, { animate: !!o.animate }));
    if (split) paintChain(true);
    // Câblage impossible (plus de broche libre…) : les composants restent posés, et on dit lesquels.
    if (o.wire !== false && app.settle) app.settle();
    const A = app.analyze(), unwired = o.wire === false ? [] : added.filter(c => needsWiring(c, A)).map(c => c.name);
    return { added: added.map(c => ({ name: c.name, type: c.type })), board: board.name, unwired };
  }

  /* ---------- Données du projet ---------- */
  app.register('pneu', {
    save: () => { const c = ed.circuit(); return c.elements.length || (c.grafcet && c.grafcet.steps.length > 1) ? { circuit: JSON.parse(JSON.stringify(c)) } : null; },
    load(d) {
      ed.setCircuit(clean(d && d.circuit)); resetRun(); fitted = false; syncGrafcet(); sync3d();
      if (split && !ed.circuit().elements.length) setSplit(false);
      host.querySelector('.pnEmpty').hidden = ed.circuit().elements.length > 0;
      if (on || split) { requestAnimationFrame(() => ed.fit()); counts(); renderPane(); }
      if (split) paintChain(true);
      paintSplitBtn();
    }
  });
  return {
    isOn: () => on, setMode, circuit: () => ed.circuit(), state: () => st, editor: ed,
    /** Pour les assistants IA : problèmes du circuit, repères du montage, bouton d'un distributeur. */
    check: () => checkPneu(ed.circuit(), { coils: benchOf('coil24'), sensors: benchOf('cylsensor', 'pressostat'), inputs: benchOf('button', 'cylsensor', 'pressostat') }),
    bench: () => ({ coils: benchOf('coil24'), sensors: benchOf('cylsensor', 'pressostat') }),
    /**
     * Fautes du plan pour le vérificateur du projet (rapport « Vérifié ») : circuit (J0701 erreur, J0702 avertissement),
     * GRAFCET (J0703), composant du montage dont aucun élément du plan ne porte le repère (J0704).
     */
    diags() {
      const c = ed.circuit(); if (!c.elements.length) return [];
      const where = tl('plan pneumatique');
      const out = checkPneu(c, { coils: benchOf('coil24'), sensors: benchOf('cylsensor', 'pressostat'), inputs: benchOf('button', 'cylsensor', 'pressostat') }).map(i => {
        const g = /^GRAFCET/.test(i.text), err = i.level === 'error';
        return { code: err ? (g ? 'J0703' : 'J0701') : 'J0702', level: err ? 'error' : 'warning', title: i.text, key: 'pn:' + i.text, where: g ? 'GRAFCET' : where, space: 'pneu', loc: {} };
      });
      if (linked()) {
        const tags = new Set(tagsOf(c).map(t => t.name.toUpperCase()));
        for (const comp of app.comps()) if (Object.values(BENCH_LINK).includes(comp.type) && !tags.has(comp.name.toUpperCase())) out.push({ code: 'J0704', level: 'warning', title: tl('{0} : aucun élément du plan pneumatique ne porte ce repère', comp.name), key: 'pn:unused:' + comp.name, space: 'pneu', loc: { comp } });
      }
      return out;
    },
    /** Bouton d'un distributeur (identifiant, « id:R » côté 12) ou du pupitre du GRAFCET (son nom). */
    press(id, v) { const k = keyOf(id); if (v) pushed.add(k); else pushed.delete(k); },
    isPushed: k => pushed.has(keyOf(k)),
    resetState() { resetRun(); },
    /** Mouvements relevés depuis le début de la simulation ({ name, dir, t0, t1 }) et temps de simulation (s). */
    moves: () => R.rec.moves, simTime: () => R.t,
    /** GRAFCET : lecture, remplacement (annulable), étapes actives et sorties pendant la simulation. */
    grafcet: () => ed.circuit().grafcet || null,
    setGrafcet(g) { ed.setCircuitProp('grafcet', g ? cleanGrafcet(g) : null); syncGrafcet(); },
    grafcetState: () => (simOn() && R.g.X ? { active: [...R.g.X].sort((a, b) => a - b), outputs: [...R.gOut].sort(), unstable: !!R.g.unstable } : null),
    isGrafcetInput: n => !!grafInput(n),
    openGrafcet() { if (!on && !split) setMode(true); gf.open(); },
    refresh() { counts(); renderPane(); if (on || split) ed.render(); if (split) paintChain(); },
    /** Vue partagée (montage et circuit côte à côte), panneau GRAFCET, vue 3D : ouverts ? */
    isSplit: () => split, setSplit: v => setSplit(v), grafcetOpen: () => gf.isOpen(), is3dOpen: () => !m3.hidden,
    /** Liaisons avec le montage : chaque repère, le composant du montage et la broche de la carte qui le commande ou le lit. */
    links: () => benchLinks().map(l => ({ tag: l.name, kind: l.kind, element: l.el, bench_part: l.comp ? l.comp.name : null, board_pin: l.pin ? `${l.pin.board}.${l.pin.pin}` : null, ...(l.pin && l.pin.via ? { via: l.pin.via } : {}) })),
    linkBench: o => linkBench(o),
    /** Programme de la carte écrit d'après le GRAFCET ; silent : sans confirmation ni message (assistants IA). */
    writeProgram: o => writeProgram(o)
  };
}
