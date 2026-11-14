// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique : le plan de travail des circuits numériques (portes, bascules, compteurs), à côté du
// montage électronique. Un sélecteur dans la barre d'application passe de l'un à l'autre ; en mode
// Logique, la bibliothèque, le plan de travail et les onglets de l'inspecteur (Circuit, Table,
// Chronogramme) sont ceux de la logique. Le circuit logique est enregistré avec le projet (module
// « logic ») et a son propre historique (Ctrl+Z). Les TP de logique (src/lab/logic) s'en servent.
// Blocs (sous-circuits, voir blocks.js) : « Mes blocs » dans la bibliothèque ; un bloc ouvert remplace
// le circuit sur le plan de travail (fil d'Ariane en haut, Échap ou « Retour au circuit » pour revenir).
import './logic.css';
import { tl, isEn } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { createNavDock } from '../ui/navdock.js';
import { menu as popMenu, ask as askDialog, toast, confirm as confirmDlg } from '../school/ui.js';
import { cleanText } from '../sanitize.js';
import { DEFS, CATS } from './elements.js';
import { createLogicEditor } from './editor.js';
import { createLogicPanels } from './panel.js';
import { thumbSvg, drawCircuitPdf } from './render.js';
import { LogicSim } from './sim.js';
import { LOGIC_EXAMPLES } from './examples.js';
import { cleanCircuit } from './clean.js';
import { blockIo, syncBlocks, usesBlock, removeBlock } from './blocks.js';
export { cleanCircuit };

const STYLE_KEY = 'jollof-logic-style';
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Rail de la bibliothèque repliée : les éléments les plus courants. */
const QUICK = ['switch', 'led', 'clock', 'not', 'and', 'or', 'nand', 'nor', 'xor', 'dff'];

export function installLogic(app) {
  const $ = s => document.querySelector(s), appEl = $('.app');
  let on = false, circuit = { elements: [], wires: [] }, style = 'ansi', fitted = false;
  let stack = []; // blocs ouverts, du plus extérieur au plus intérieur (vide : circuit principal)
  const openId = () => stack[stack.length - 1] || null;
  const defOf = id => (circuit.blocks || []).find(b => b.id === id) || null;
  try { style = localStorage.getItem(STYLE_KEY) === 'iec' ? 'iec' : 'ansi'; } catch (e) { /* stockage indisponible */ }
  const changeHooks = new Set();

  /* ---------- Sélecteur Électronique / Logique ---------- */
  $('.brand').insertAdjacentHTML('afterend', `<div class="seg wsSwitch" role="group" aria-label="${tl('Plan de travail')}">
    <button type="button" class="segBtn" data-ws="elec" aria-pressed="true" data-tip="${tl('Montage électronique : cartes, capteurs, câblage en 3D')}">${icon('cpu')}<span>${tl('Électronique')}</span></button>
    <button type="button" class="segBtn" data-ws="logic" aria-pressed="false" data-tip="${tl('Logique : portes, bascules, compteurs, tables de vérité')}">${icon('logic')}<span>${isEn ? 'Logic' : 'Logique'}</span></button></div>`);
  document.querySelectorAll('.wsSwitch [data-ws]').forEach(b => (b.onclick = () => setMode(b.dataset.ws === 'logic')));

  /* ---------- Plan de travail ---------- */
  const stage = $('#stage');
  const host = document.createElement('div'); host.className = 'lgHost'; host.hidden = true;
  stage.appendChild(host);
  /* ---------- Son des buzzers ---------- */
  let audio = null, osc = null, tone = 0;
  function sound(tones) {
    const t = on && tones.length ? Math.max(...tones) : 0;
    if (t === tone) return; tone = t;
    try {
      if (!t) { if (osc) { osc.stop(); osc.disconnect(); osc = null; } return; }
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      if (!osc) { osc = audio.createOscillator(); const g = audio.createGain(); g.gain.value = 0.04; osc.type = 'square'; osc.connect(g).connect(audio.destination); osc.start(); }
      osc.frequency.value = t;
    } catch (e) { osc = null; } // pas de son sur cette machine : le buzzer reste visible
  }
  const ed = createLogicEditor(host, {
    changed(kind) {
      // Bloc modifié : les blocs posés ailleurs suivent tout de suite (broches, nom).
      if (kind === 'struct' && stack.length && syncBlocks(circuit)) renderLib();
      app.markDirty(); changeHooks.forEach(f => f(kind)); if (kind === 'struct') counts();
    },
    status: (msg, kind) => app.status(msg, kind),
    menu: (anchor, items) => popMenu(anchor, items),
    ask: (title, label, value) => askDialog(title, label, value),
    style: () => style,
    openBlock: id => enterBlock(id),
    blockDefs: () => circuit.blocks || [],
    canPlace: ref => !openId() || !usesBlock(circuit.blocks, ref, openId()),
    adoptBlocks(defs) {
      // Blocs collés (depuis ce projet ou un autre) : un bloc identique déjà là est réutilisé ; sinon la définition
      // est ajoutée, sous un nouvel identifiant si le sien est pris par un autre bloc. Rend ancien id → id dans ce projet.
      const list = circuit.blocks || (circuit.blocks = []), same = (a, b) => a.name === b.name && JSON.stringify(a.circuit) === JSON.stringify(b.circuit);
      const map = new Map(), added = [];
      for (const d of defs) {
        const twin = list.find(x => x.id === d.id && same(x, d)) || list.find(x => same(x, d));
        if (twin) { map.set(d.id, twin.id); continue; }
        const nd = JSON.parse(JSON.stringify(d)); nd.id = list.some(x => x.id === d.id) ? freeBlockId() : d.id;
        list.push(nd); added.push(nd); map.set(d.id, nd.id); ed.forget('b:' + nd.id);
      }
      for (const nd of added) for (const e of nd.circuit.elements) if (e.type === 'block' && e.p && map.has(e.p.ref)) e.p.ref = map.get(e.p.ref);
      if (!list.length) delete circuit.blocks;
      if (added.length) { syncBlocks(circuit); renderLib(); }
      return map;
    },
    // Après annuler / coller : les blocs posés reprennent l'interface de leur définition (au circuit principal,
    // les fils vers des broches disparues partent).
    sync() { syncBlocks(circuit, { drop: !stack.length }); renderLib(); }, // la liste « Mes blocs » suit (annuler peut rendre un bloc)
    sound
  });
  host.insertAdjacentHTML('beforeend', `
    <div class="lgBar top">
      <nav class="lgCrumb glass" aria-label="${tl('Bloc ouvert')}" hidden></nav>
      <div class="seg glass" role="group" aria-label="${tl('Style des symboles')}">
        <button type="button" class="segBtn" data-style="ansi" data-tip="${tl('Symboles à formes distinctives (ANSI, usage international)')}">ANSI</button>
        <button type="button" class="segBtn" data-style="iec" data-tip="${tl('Symboles rectangulaires « & », « ≥1 », « =1 » (norme CEI, usage en France)')}">${tl('CEI')}</button></div>
      <span class="grow"></span>
    </div>
    <div class="lgBar bottom">
      <div class="lgRun glass">
        <button type="button" class="btn primary small lgPlay" data-run data-tip="${tl('Lancer ou arrêter les horloges · Ctrl+K')}">${icon('play')}<span>${tl('Lancer')}</span></button>
        <button type="button" class="btn small" data-step data-tip="${tl('Avancer jusqu’au prochain front d’horloge · T')}">${icon('stepOver')}<span>${isEn ? 'Step' : 'Pas'}</span></button>
        <select class="sel lgSpeed" aria-label="${tl('Vitesse du temps')}" data-tip="${tl('Vitesse du temps simulé')}">${[[0.25, '×¼'], [0.5, '×½'], [1, '×1'], [2, '×2'], [4, '×4']].map(([v, l]) => `<option value="${v}"${v === 1 ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <span class="lgT"></span>
        <button type="button" class="btn small" data-reset data-tip="${tl('Remettre les bascules et le temps à zéro')}">${icon('rotate')}<span>${tl('Réinitialiser')}</span></button>
      </div>
      <span class="grow"></span>
      <div class="lgLegend glass" aria-label="${tl('Niveaux logiques')}"><span><i class="lv1"></i>1</span><span><i class="lv0"></i>0</span><span><i class="lvX"></i>X <small>${tl('inconnu')}</small></span><span><i class="lvZ"></i>Z <small>${tl('libre')}</small></span></div>
    </div>
    <div class="lgEmpty"><div class="lgEmptyCard">${icon('logic')}<b>${tl('Plan de travail logique')}</b>
      <p>${tl('Glissez des portes depuis la bibliothèque, puis tirez des fils de broche en broche. Cliquez sur un interrupteur pour le basculer : les fils à 1 s’allument.')}</p>
      <div class="row"><button type="button" class="btn primary" data-labs>${icon('checklist')}<span>${tl('TP de logique')}</span></button><button type="button" class="btn" data-examples>${icon('layers')}<span>${tl('Exemples')}</span></button></div></div></div>`);
  const paintStyle = () => host.querySelectorAll('[data-style]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.style === style)));
  paintStyle();
  host.addEventListener('click', e => {
    const s = e.target.closest('[data-style]');
    if (s) { style = s.dataset.style; try { localStorage.setItem(STYLE_KEY, style); } catch (err) { /* rien */ } paintStyle(); ed.redraw(); renderLib(); panels.restyle(); return; }
    if (e.target.closest('[data-run]')) { ed.setRunning(!ed.running()); return; }
    if (e.target.closest('[data-step]')) { ed.step(); return; }
    if (e.target.closest('[data-reset]')) { ed.reset(); app.status(tl('Bascules, compteurs et temps remis à zéro.')); return; }
    if (e.target.closest('[data-labs]')) { if (app.openLabs) app.openLabs('logic'); return; }
    const cr = e.target.closest('[data-crumb]'); if (cr) { goTo(cr.dataset.crumb === 'root' ? 0 : +cr.dataset.crumb + 1); return; }
    const ex = e.target.closest('[data-examples]'); if (ex) examplesMenu(ex);
  });
  host.querySelector('.lgSpeed').onchange = e => ed.setSpeed(+e.target.value);
  function paintRun() {
    const b = host.querySelector('[data-run]'), r = ed.running();
    b.innerHTML = `${icon(r ? 'pause' : 'play')}<span>${r ? tl('Pause') : tl('Lancer')}</span>`; b.classList.toggle('on', r);
    host.querySelector('.lgT').textContent = `t = ${ed.timeText()} s`;
    host.querySelector('.lgRun').classList.toggle('noclock', !ed.clocks());
  }
  ed.on(k => {
    if (k === 'run' || k === 'tick' || k === 'struct' || k === 'levels') paintRun();
    if (k === 'view' || k === 'select' || k === 'struct') nav.update();
    if (k === 'history' && on) app.historyUI();
  });
  // Navigation commune (src/ui/navdock.js) : outils, zoom, tout voir, sélection, mini-carte, raccourcis.
  const nav = createNavDock(host, {
    active: () => on,
    target: () => ed.svg,
    tools: () => ['select', 'pan', 'zoom'],
    zoomBy: (f, x, y) => ed.zoomAt(f, x, y), panBy: (dx, dy) => ed.panBy(dx, dy),
    zoomPct: () => ed.zoomLevel() * 100, setZoomPct: p => ed.setZoomPct(p),
    fit: () => ed.fit(), fitSel: () => ed.fitSel(), hasSel: () => ed.hasSel(),
    mini: { data: () => ed.mini(), centerOn: (x, y) => ed.centerOn(x, y) },
    status: m => app.status(m),
    title: tl('Plan logique'),
    shortcuts: () => [
      ['Drag', tl('Encadrer plusieurs éléments (dans le vide)')],
      ['Shift+Click', tl('Ajouter ou retirer un élément de la sélection')],
      ['Mod+A', tl('Tout sélectionner')],
      ['Mod+C|Mod+X|Mod+V', tl('Copier, couper, coller')],
      ['Mod+D', tl('Dupliquer')],
      ['R|Shift+R', tl('Tourner')],
      ['←↑→↓', tl('Déplacer la sélection (Maj : plus loin)')],
      ['Del', tl('Retirer la sélection')],
      ['T', tl('Avancer d’un front d’horloge')],
      ['Mod+K', tl('Lancer ou arrêter les horloges')],
      ['Esc', tl('Tout désélectionner')]
    ]
  });

  /* ---------- Bibliothèque logique ---------- */
  const lib = document.createElement('aside');
  lib.className = 'panel left lgLib'; lib.setAttribute('aria-label', tl('Bibliothèque logique'));
  lib.innerHTML = `<nav class="lgRail" aria-label="${tl('Éléments courants')}"><button type="button" class="tb" data-open data-tip="${tl('Déplier la bibliothèque · Ctrl+B')}">${icon('chevsRight')}</button><span class="rsep"></span>${QUICK.map(t => `<button type="button" class="lgRailItem" data-t="${t}" title="${esc(DEFS[t].full())}"></button>`).join('')}</nav>
    <div class="phead"><h2>${icon('logic')}${isEn ? 'Logic' : 'Logique'}</h2><span class="count">${Object.values(DEFS).filter(d => d.cat !== 'blocks').length}</span><button type="button" class="tb" data-close data-tip="${tl('Replier · Ctrl+B')}" aria-label="${tl('Replier la bibliothèque')}">${icon('chevsLeft')}</button></div>
    <div class="search">${icon('search')}<input type="search" placeholder="${tl('Rechercher : ET, bascule D, compteur…')}" autocomplete="off" aria-label="${tl('Rechercher un élément logique')}"></div>
    <div class="libScroll lgLibList"></div>
    <div class="pfoot"><div class="row"><button type="button" class="btn subtle small" data-examples>${icon('layers')}<span>${tl('Exemples')}</span></button><button type="button" class="btn subtle small" data-labs>${icon('checklist')}<span>${tl('TP de logique')}</span></button></div></div>`;
  $('#libPanel').after(lib);
  const list = lib.querySelector('.lgLibList'), search = lib.querySelector('input');
  function renderLib() {
    const q = norm(search.value.trim());
    let html = '';
    // Mes blocs : ceux du projet (sauf, dans un bloc ouvert, ceux qui le contiennent : pas de boucle).
    const mine = (circuit.blocks || []).filter(b => (!q || norm(b.name).includes(q)) && (!openId() || !usesBlock(circuit.blocks, b.id, openId())));
    if (!q || mine.length) {
      html += `<h3>${icon('cube')}${tl('Mes blocs')}<span>${mine.length}</span><button type="button" class="tb lgNewBlock" data-newblock data-tip="${tl('Nouveau bloc : un circuit à réutiliser comme un seul élément')}" aria-label="${tl('Nouveau bloc')}">${icon('plus')}</button></h3>`;
      html += mine.length ? `<div class="lgGrid">${mine.map(b => `<button type="button" class="lgItem" data-t="block" data-ref="${esc(b.id)}" title="${esc(b.name)}\n\n${esc(tl('Double-clic sur un bloc posé : l’ouvrir. Clic droit ici : ouvrir, renommer, supprimer.'))}">${thumbSvg('block', style, { ref: b.id, io: blockIo(b) })}<span>${esc(b.name)}</span></button>`).join('')}</div>`
        : `<p class="lgNoBlock">${tl('Construisez un montage, sélectionnez-le, puis « Faire un bloc avec la sélection » : il se posera ensuite comme une porte.')}</p>`;
    }
    for (const [cat, name, ic] of CATS) {
      const items = Object.values(DEFS).filter(d => d.cat === cat && (!q || norm(`${d.name()} ${d.full()} ${d.id} ${name()}`).includes(q)));
      if (!items.length) continue;
      html += `<h3>${icon(ic)}${name()}<span>${items.length}</span></h3><div class="lgGrid">${items.map(d => `<button type="button" class="lgItem" data-t="${d.id}" title="${esc(d.full())}${d.doc ? '\n\n' + esc(d.doc()) : ''}">${thumbSvg(d.id, style)}<span>${esc(d.name())}</span></button>`).join('')}</div>`;
    }
    list.innerHTML = html || `<p class="empty">${tl('Aucun élément ne correspond à cette recherche.')}</p>`;
    lib.querySelectorAll('.lgRailItem').forEach(b => (b.innerHTML = thumbSvg(b.dataset.t, style)));
  }
  renderLib();
  search.oninput = renderLib;
  // Glisser un élément sur le plan de travail, ou cliquer puis cliquer sur le plan de travail.
  let dragged = null;
  const placeProps = b => { if (b.dataset.t !== 'block') return {}; const d = defOf(b.dataset.ref); return d ? { ref: d.id, io: blockIo(d) } : null; };
  lib.addEventListener('pointerdown', e => { const b = e.target.closest('[data-t]'); if (!b || e.button !== 0) return; e.preventDefault(); const p = placeProps(b); if (p) dragged = ed.dragPlace(b.dataset.t, e, p); });
  lib.addEventListener('contextmenu', async e => {
    const b = e.target.closest('[data-ref]'); if (!b) return;
    e.preventDefault();
    const id = b.dataset.ref, v = await popMenu(b, [{ label: tl('Ouvrir le bloc'), icon: 'edit', value: 'open' }, { label: tl('Renommer…'), icon: 'tag', value: 'rename' }, '-', { label: tl('Supprimer le bloc'), icon: 'trash', value: 'del', danger: true }]);
    if (v === 'open') enterBlock(id); else if (v === 'rename') renameBlock(id); else if (v === 'del') deleteBlock(id);
  });
  lib.addEventListener('click', e => {
    if (e.target.closest('[data-newblock]')) { makeBlock([]); return; }
    const b = e.target.closest('[data-t]');
    if (b) { if (dragged && dragged()) return; const p = placeProps(b); if (p) ed.startPlace(b.dataset.t, p); return; }
    if (e.target.closest('[data-close]')) app.setLibOpen(false);
    if (e.target.closest('[data-open]')) app.setLibOpen(true);
    if (e.target.closest('[data-labs]') && app.openLabs) app.openLabs('logic');
    const ex = e.target.closest('[data-examples]'); if (ex) examplesMenu(ex);
  });
  async function examplesMenu(anchor) {
    const v = await popMenu(anchor, LOGIC_EXAMPLES.map(x => ({ label: x.name(), icon: 'layers', value: x.id })));
    const ex = LOGIC_EXAMPLES.find(x => x.id === v); if (!ex) return;
    if (circuit.elements.length && !(await confirmDlg(ex.name(), tl('Remplacer le circuit logique actuel par cet exemple ? Ctrl+Z permet de revenir en arrière.'), tl('Remplacer')))) return;
    const c = ex.circuit();
    if (stack.length) goTo(0);
    circuit.elements.splice(0, circuit.elements.length, ...c.elements); circuit.wires.splice(0, circuit.wires.length, ...c.wires);
    if (c.blocks) { circuit.blocks = c.blocks; syncBlocks(circuit); } else delete circuit.blocks;
    ed.forget(); // les blocs de l'ancien circuit ne prêtent pas leur historique aux nouveaux de même identifiant
    ed.reset(); ed.commit(); ed.fit(); counts(); renderLib();
    toast(ex.text(), 'ok', 6000);
  }

  /* ---------- Onglets de l'inspecteur ---------- */
  const panels = createLogicPanels(ed, {
    style: () => style, status: (m, k) => app.status(m, k), title: () => app.projectTitle(),
    blockCtx: () => { const d = defOf(openId()); return d ? { name: d.name, io: blockIo(d) } : null; },
    openBlock: id => enterBlock(id), makeBlock: els => makeBlock(els), leaveBlock: () => goTo(stack.length - 1),
    renameBlock: () => renameBlock(openId()), deleteBlock: () => deleteBlock(openId())
  });

  /* ---------- Blocs ---------- */
  const crumb = host.querySelector('.lgCrumb');
  function paintCrumb() {
    crumb.hidden = !stack.length; host.classList.toggle('inBlock', !!stack.length);
    const card = host.querySelector('.lgEmptyCard');
    card.querySelector('b').textContent = stack.length ? tl('Bloc vide') : tl('Plan de travail logique');
    card.querySelector('p').textContent = stack.length ? tl('Posez des interrupteurs nommés (les entrées du bloc), le montage, puis des LED nommées (ses sorties). Échap : retour au circuit.') : tl('Glissez des portes depuis la bibliothèque, puis tirez des fils de broche en broche. Cliquez sur un interrupteur pour le basculer : les fils à 1 s’allument.');
    card.querySelector('.row').hidden = !!stack.length;
    if (!stack.length) { crumb.innerHTML = ''; return; }
    crumb.innerHTML = `<button type="button" class="lgCrumbBtn" data-crumb="root" data-tip="${tl('Retour au circuit · Échap')}">${icon('chevLeft')}<span>${tl('Circuit')}</span></button>`
      + stack.map((id, i) => { const d = defOf(id); return `<span class="lgCrumbSep">›</span><button type="button" class="lgCrumbBtn"${i === stack.length - 1 ? ' aria-current="true"' : ` data-crumb="${i}"`}>${icon('cube')}<span>${esc(d ? d.name : '?')}</span></button>`; }).join('');
  }
  /** Ouvre un bloc sur le plan de travail (le circuit courant garde son historique et sa vue). */
  function enterBlock(id) {
    const d = defOf(id); if (!d || openId() === id) return;
    if (stack.includes(id)) { goTo(stack.indexOf(id) + 1); return; }
    // Le circuit du bloc voit les autres blocs du projet (pour les blocs qu'il contient), sans les enregistrer en double.
    Object.defineProperty(d.circuit, 'blocks', { get: () => circuit.blocks, enumerable: false, configurable: true });
    stack.push(id); ed.load(d.circuit, { ctx: 'b:' + id });
    paintCrumb(); renderLib(); panels.refresh(); counts();
    app.status(tl('Bloc « {0} » ouvert. Échap ou « Circuit » en haut à gauche : retour.', d.name));
  }
  /** Revient à la profondeur depth (0 : circuit principal). Les fils vers des broches disparues sont retirés. */
  function goTo(depth) {
    if (depth >= stack.length || depth < 0) return;
    stack = stack.slice(0, depth);
    syncBlocks(circuit, { drop: true });
    const d = defOf(openId());
    if (d) ed.load(d.circuit, { ctx: 'b:' + d.id }); else { stack = []; ed.load(circuit, { ctx: 'root' }); }
    paintCrumb(); renderLib(); panels.refresh(); counts();
  }
  const freeBlockId = () => { const used = new Set((circuit.blocks || []).map(b => b.id)); let i = 1; while (used.has('b' + i)) i++; return 'b' + i; };
  /** Nouveau bloc, vide ou avec une copie des éléments choisis (et des fils entre eux), puis ouvert. */
  async function makeBlock(els) {
    const v = await askDialog(tl('Nouveau bloc'), tl('Nom du bloc (par exemple : Additionneur, Décodeur, Feu)'), tl('Bloc {0}', (circuit.blocks || []).length + 1));
    if (v == null || v === false) return;
    const name = cleanText(String(v), 24) || tl('Bloc');
    let c = { elements: [], wires: [] };
    if (els && els.length) {
      const cur = ed.circuit(), ids = new Set(els.map(e => e.id));
      c = JSON.parse(JSON.stringify({ elements: cur.elements.filter(e => ids.has(e.id)), wires: cur.wires.filter(w => ids.has(w.a[0]) && ids.has(w.b[0])) }));
      const b = ed.bounds(c.elements);
      if (b) { const dx = 4 - Math.round(b.x0), dy = 4 - Math.round(b.y0); c.elements.forEach(e => { e.x += dx; e.y += dy; }); c.wires.forEach(w => { if (w.via) w.via = w.via.map(p => [p[0] + dx, p[1] + dy]); }); }
    }
    const id = freeBlockId();
    (circuit.blocks || (circuit.blocks = [])).push({ id, name, circuit: c });
    ed.forget('b:' + id); // identifiant d'un bloc retiré puis annulé : pas d'historique hérité
    app.markDirty(); renderLib();
    enterBlock(circuit.blocks[circuit.blocks.length - 1].id);
  }
  async function renameBlock(id) {
    const d = defOf(id); if (!d) return;
    const v = await askDialog(tl('Renommer le bloc'), tl('Nom du bloc'), d.name);
    if (v == null || v === false) return;
    d.name = cleanText(String(v), 24) || d.name;
    syncBlocks(circuit); ed.redraw(); renderLib(); paintCrumb(); panels.refresh(); app.markDirty();
  }
  async function deleteBlock(id) {
    const d = defOf(id); if (!d) return;
    const uses = [circuit, ...(circuit.blocks || []).map(b => b.circuit)].reduce((n, c) => n + c.elements.filter(e => e.type === 'block' && e.p.ref === id).length, 0);
    if (!(await confirmDlg(tl('Supprimer le bloc « {0} » ?', d.name), uses ? tl('Il est posé {0} fois : ces exemplaires et leurs fils disparaîtront aussi.', uses) : tl('Il n’est posé nulle part.'), tl('Supprimer')))) return;
    if (stack.includes(id)) goTo(stack.indexOf(id));
    removeBlock(circuit, id); ed.forget('b:' + id);
    if (!circuit.blocks.length) delete circuit.blocks;
    ed.structural(); ed.commit(); renderLib(); panels.refresh(); app.markDirty();
  }
  const tabs = $('.panel.right .tabs');
  tabs.insertAdjacentHTML('beforeend', `<button type="button" role="tab" class="tab lgTab" id="tab-lcirc" aria-controls="pane-lcirc" aria-selected="false">${icon('logic')}${tl('Circuit')}</button>
    <button type="button" role="tab" class="tab lgTab" id="tab-ltable" aria-controls="pane-ltable" aria-selected="false">${icon('list')}${tl('Table')}</button>
    <button type="button" role="tab" class="tab lgTab" id="tab-lwave" aria-controls="pane-lwave" aria-selected="false">${icon('activity')}${tl('Chronogramme')}</button>`);
  for (const [id, el] of [['lcirc', panels.circ], ['ltable', panels.table], ['lwave', panels.wave]]) {
    const pane = document.createElement('div'); pane.className = 'pane lgPaneWrap'; pane.id = 'pane-' + id; pane.setAttribute('role', 'tabpanel'); pane.hidden = true; pane.appendChild(el);
    $('#modPane').before(pane);
    $('#tab-' + id).onclick = () => { app.setTab(id); panels.shown(id); };
  }
  const currentTab = () => { const t = document.querySelector('.panel.right .tabs .tab[aria-selected="true"]'); return t ? t.id.slice(4) : ''; };

  /* ---------- Mode ---------- */
  let countsBefore = '', hintBefore = '';
  function counts() {
    if (!on) return;
    const c = ed.circuit(), n = c.elements.filter(e => e.type !== 'junction' && e.type !== 'text').length, w = c.wires.length;
    $('#counts').textContent = tl('{0} élément{1} · {2} fil{3}', n, n > 1 ? 's' : '', w, w > 1 ? 's' : '');
  }
  function setMode(v) {
    v = !!v; if (v === on) return;
    on = v;
    appEl.classList.toggle('logicMode', on); document.body.classList.toggle('logicOpen', on);
    host.hidden = !on;
    document.querySelectorAll('.wsSwitch [data-ws]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ws === (on ? 'logic' : 'elec')))); // la pneumatique repeint le sien en s'ouvrant
    if (on) {
      if (app.simOn()) app.setSim(false);
      app.history(ed.history);
      countsBefore = $('#counts').textContent; counts();
      hintBefore = $('#hint').textContent; $('#hint').textContent = tl('Broche → broche : tirer un fil · clic sur un interrupteur : le basculer · R : tourner · Molette : zoom · Espace + glisser : se déplacer · ? : raccourcis');
      const t = currentTab(); if (t !== 'sess' && !t.startsWith('l')) { app.setTab('lcirc'); panels.shown('lcirc'); }
      ed.redraw(); if (!fitted) { fitted = true; requestAnimationFrame(() => ed.fit()); }
      panels.refresh();
    } else {
      ed.setRunning(false); ed.releaseKeys(); sound([]);
      app.history(null);
      if (countsBefore) $('#counts').textContent = countsBefore;
      $('#hint').textContent = hintBefore;
      if (currentTab().startsWith('l')) app.setTab('wiring');
      app.invalidate(400);
    }
    if (on && app.ensureSpace) app.ensureSpace('logic'); // le type du projet suit le plan de travail ouvert
    changeHooks.forEach(f => f('mode'));
  }

  /* ---------- Clavier ---------- */
  const busyUi = () => document.querySelector('.sDialogWrap, .sMenu') || [...document.querySelectorAll('.modal')].some(m => !m.hidden) || document.body.classList.contains('hubOpen');
  addEventListener('keydown', e => {
    if (!on || busyUi()) return;
    const a = document.activeElement;
    if (a && (/INPUT|SELECT|TEXTAREA/.test(a.tagName) || a.isContentEditable || (a.closest && a.closest('.ProseMirror, .visualHost')))) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && ['s', 'o', 'n', 'b', 'z', 'y'].includes(k)) return; // enregistrer, ouvrir, bibliothèque, annuler : application
    if (nav.key(e) || ed.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (k === 'escape' && stack.length) { goTo(stack.length - 1); e.preventDefault(); e.stopImmediatePropagation(); return; } // Échap dans un bloc : on en sort
    if (!mod) e.stopImmediatePropagation(); // les raccourcis de la scène 3D ne s'appliquent pas ici
  }, true);
  addEventListener('keyup', e => { nav.key(e); ed.key(e); }, true); // toujours : Espace relâché ailleurs ne doit pas rester enfoncé
  addEventListener('blur', () => ed.releaseKeys());

  /* ---------- Données du projet ---------- */
  app.register('logic', {
    load(d) {
      if (!d || typeof d !== 'object') {
        circuit = { elements: [], wires: [] }; stack = []; ed.load(circuit, { ctx: 'root', fresh: true }); fitted = false; paintCrumb(); renderLib();
        if (on && app.comps().length) setMode(false); // projet électronique ouvert : retour au montage
        counts(); return;
      }
      circuit = cleanCircuit(d.circuit); stack = []; fitted = false; ed.load(circuit, { ctx: 'root', fresh: true }); paintCrumb(); renderLib();
      if (d.style === 'iec' || d.style === 'ansi') { style = d.style; paintStyle(); renderLib(); }
      setMode(d.view === 'logic');
      if (on) { fitted = true; requestAnimationFrame(() => ed.fit()); }
      counts(); panels.refresh();
    },
    save() {
      if (!circuit.elements.length && !on) return undefined;
      const c = JSON.parse(JSON.stringify(circuit));
      for (const k of [c, ...(c.blocks || []).map(b => b.circuit)]) k.elements.forEach(e => { if (e.p) delete e.p.pressed; });
      return { view: on ? 'logic' : 'elec', style, circuit: c };
    }
  });

  return {
    isOn: () => on, setMode, editor: ed, panels,
    circuit: () => circuit, style: () => style,
    onChange(fn) { changeHooks.add(fn); return () => changeHooks.delete(fn); },
    /** Projet (format .jollof) qui ouvre un circuit logique : pour les TP. */
    project: (c, name) => ({ app: 'jollof-studio', version: 1, name, comps: [], wires: [], settings: { modules: { logic: { view: 'logic', style, circuit: JSON.parse(JSON.stringify(c)) } } } }),
    showTab(id) { app.setTab(id); panels.shown(id); },
    /** Dessin du circuit pour un PDF (compte-rendu). */
    drawPdf: (d, area) => drawCircuitPdf(d, circuit, area, style, stack.length ? new LogicSim(circuit) : ed.sim())
  };
}
