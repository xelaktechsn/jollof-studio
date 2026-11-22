// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Organisation du projet réseau (chargé par workspace.js après le plan de travail, jamais au démarrage) :
// - panneau de gauche en trois onglets : Bibliothèque (celle du plan réseau), Projet (arbre des objets : site, bâtiments,
//   étages, pièces, baies, équipements, cheminements, câbles ; recherche, sélection multiple partagée avec les vues,
//   double-clic : y aller, menu contextuel, glisser un équipement dans une baie ou une pièce), Calques (vue Plans) ;
// - fil d'Ariane dans la barre des vues (site › bâtiment › étage › pièce › baie › objet ; chevron : objets voisins) ;
// - Rechercher (Ctrl+F) et Aller à (Ctrl+G) : nom, étiquette, type, adresse IP ; Alt+Entrée choisit tous les résultats ;
// - modification groupée au-dessus de l'inspecteur quand plusieurs objets sont choisis (bulkEdit) ;
// - onglets Brassage, Câbles et Résultats des tests dans le panneau du bas (ia-docks.js, à la demande).
import './ia.css';
import { tl } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { spacesOf } from '../../ui/kind.js';
import { confirm as confirmDlg } from '../../school/ui.js';
import { createTree, searchBox, ctxMenu, propGrid, notify, keyLabel, scrollWithin } from './kit/index.js';
import { highlightParts } from './kit/model.js';
import { labeler, cableKind } from '../docs.js';
import { installNav } from './ia-nav.js';
import { rackable } from '../rack.js';
import { isExam } from '../exam.js';
import { projectTree, findItems, findRank, parseKey, keyOf, isGroupKey, resolveSel, bulkFields, applyBulk, kindTitle, descendants, renameItem, canRename, canRemove, removeItems, duplicateDevs, canDrop, moveDevs, crumbsFor } from '../browse.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } } };
const PREF = { viewTabs: 'jollof-net-libtab-view', tab: 'jollof-net-libtab', layers: 'jollof-net-layers', reveal: 'jollof-net-autoreveal' };

/** Calques de la vue Plans tenus par une classe sur la racine de la vue (le dessin n'est pas refait). */
const LAYERS = [
  { id: 'rooms', icon: 'room', name: () => tl('Pièces du plan') },
  { id: 'roomLabels', icon: 'tag', name: () => tl('Noms et surfaces des pièces') },
  { id: 'walls', icon: 'wall', name: () => tl('Murs') },
  { id: 'doors', icon: 'door', name: () => tl('Portes') },
  { id: 'paths', icon: 'cableTray', name: () => tl('Cheminements') },
  { id: 'pathLabels', icon: 'tag', name: () => tl('Noms des cheminements') },
  { id: 'racks', icon: 'rack', name: () => tl('Baies') },
  { id: 'outlets', icon: 'outlet', name: () => tl('Prises') },
  { id: 'aps', icon: 'wifi', name: () => tl('Points d’accès') },
  { id: 'devices', icon: 'desktopPc', name: () => tl('Autres équipements') },
  { id: 'devLabels', icon: 'tag', name: () => tl('Étiquettes des équipements') }
];
/** Calques que la vue Plans gère elle-même (ses boutons [data-layer]). */
const PLAN_LAYERS = [
  { id: 'image', icon: 'image', name: () => tl('Plan importé (image)') },
  { id: 'routes', icon: 'route', name: () => tl('Tracé des câbles de la sélection') },
  { id: 'wifi', icon: 'wifi', name: () => tl('Couverture Wi-Fi') }
];

export function installIa(ctx, { lib, host, pane }) {
  const app = ctx.app, data = () => ctx.data();
  let nav = null; // ia-nav.js (« Lié à », historique), posé plus bas
  const isNet = () => spacesOf(app.kind ? app.kind() : 'elec').includes('net');

  /* ---------- Modèle de l'arbre (refait après chaque changement, à la demande) ---------- */
  let ver = 0, built = -1, roots = [], items = null;
  const opts = () => {
    const d = data(), L = labeler(d), devs = new Map(d.devices.map(x => [x.id, x]));
    const issues = new Map(); try { for (const i of ctx.issues()) if (i.id && issues.get(i.id) !== 'err') issues.set(i.id, i.kind === 'err' ? 'err' : 'warn'); } catch (e) { /* vérificateur indisponible */ }
    return { label: x => { try { return x.tag || L.of(x.id) || ''; } catch (e) { return ''; } }, cableKind: c => cableKind(d, c, devs), cableLabel: c => { try { return L.cable(c); } catch (e) { return c.id; } }, issues, en: ctx.isEn };
  };
  function model() {
    if (built !== ver) { try { roots = projectTree(data(), opts()); } catch (e) { console.error(e); roots = []; } built = ver; items = null; }
    return roots;
  }
  const findList = () => { model(); if (!items) items = findItems(roots, data().vlans || []); return items; };
  const selKeys = () => ctx.multi().map(m => keyOf(m.kind, m.id));

  /* ---------- Panneau de gauche : onglets ---------- */
  lib.classList.add('ntIaOn');
  const head = lib.querySelector('.phead');
  const TABS = [['lib', () => tl('Bibliothèque'), 'box'], ['project', () => tl('Projet'), 'list'], ['layers', () => tl('Calques'), 'layers']];
  const tabs = document.createElement('div'); tabs.className = 'ntLibTabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', tl('Panneau de gauche'));
  // Panneau étroit : icônes seules (le nom en infobulle).
  tabs.innerHTML = TABS.map(([id, name, ic]) => `<button type="button" role="tab" class="ntLibTab" data-libtab="${id}" id="ntLibTab-${id}" aria-controls="${id === 'lib' ? 'lib' : 'ntLibPane-' + id}" aria-label="${esc(name())}" data-tip="${esc(name())}">${icon(ic)}<span>${esc(name())}</span></button>`).join('');
  new ResizeObserver(() => lib.classList.toggle('ntLibNarrow', lib.clientWidth > 0 && lib.clientWidth < 268)).observe(lib);
  head.prepend(tabs);
  { const h = document.createElement('h2'); h.className = 'sr'; h.textContent = tl('Panneau de gauche'); head.prepend(h); } // titre de niveau 2 avant les h3 des catégories
  const proj = document.createElement('section'); proj.className = 'ntBr'; proj.id = 'ntLibPane-project'; proj.setAttribute('role', 'tabpanel'); proj.setAttribute('aria-labelledby', 'ntLibTab-project');
  proj.innerHTML = `<div class="ntBrBar"></div><div class="ntBrTree"></div><div class="ntBrFoot" aria-live="polite"></div>`;
  const lay = document.createElement('section'); lay.className = 'ntLy'; lay.id = 'ntLibPane-layers'; lay.setAttribute('role', 'tabpanel'); lay.setAttribute('aria-labelledby', 'ntLibTab-layers');
  const foot = lib.querySelector('.pfoot'); lib.insertBefore(proj, foot); lib.insertBefore(lay, foot);
  let tab = store.get(PREF.tab, 'lib'); if (!TABS.some(t => t[0] === tab)) tab = 'lib';
  function setTab(t, focus = false) {
    tab = t; lib.dataset.tab = t; store.set(PREF.tab, t);
    tabs.querySelectorAll('[data-libtab]').forEach(b => { const on = b.dataset.libtab === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    if (t === 'project') { syncTree(true); if (focus) tree.focus(); }
    if (t === 'layers') paintLayers();
    if (focus && t === 'lib') { const i = lib.querySelector('.search input'); if (i) i.focus(); }
  }
  tabs.addEventListener('click', e => { const b = e.target.closest('[data-libtab]'); if (b) { setTab(b.dataset.libtab); viewTabs[ctx.view()] = b.dataset.libtab; store.set(PREF.viewTabs, viewTabs); } });
  // Contenu du panneau selon la vue : bibliothèque là où l'on pose (schéma, plans ; en Baies, seulement ce qui se monte en
  // baie), arbre du projet en Conception ; le choix fait dans une vue y est retenu.
  const VIEW_TAB = { logic: 'lib', plan: 'lib', racks: 'lib', design: 'project' };
  const viewTabs = store.get(PREF.viewTabs, {}) || {};
  function libForView() {
    const v = ctx.view(); lib.dataset.view = v;
    const want = viewTabs[v] || VIEW_TAB[v] || 'lib'; if (want !== tab) setTab(want);
    filterLib();
  }
  function filterLib() {
    const list = lib.querySelector('.ntLibList'); if (!list) return;
    const racks = lib.dataset.view === 'racks';
    list.querySelectorAll('.ntItem').forEach(b => { b.hidden = racks && !rackable(b.dataset.t); });
    list.querySelectorAll('h3').forEach(h => {
      const g = h.nextElementSibling; if (!g || !g.classList.contains('ntGrid')) return;
      const n = [...g.children].filter(x => !x.hidden).length; h.hidden = !n; g.hidden = !n;
      const c = h.querySelector('span'); if (c) { if (!c.dataset.n) c.dataset.n = c.textContent; c.textContent = racks ? String(n) : c.dataset.n; } // compte des éléments montrés
    });
    let note = list.querySelector('.ntLibNote');
    if (racks && !note) { note = document.createElement('p'); note.className = 'ntLibNote'; note.textContent = tl('Vue Baies : seulement ce qui se monte en baie.'); list.prepend(note); }
    else if (!racks && note) note.remove();
  }
  new MutationObserver(() => { if (lib.dataset.view === 'racks') filterLib(); }).observe(lib.querySelector('.ntLibList'), { childList: true });
  tabs.addEventListener('keydown', e => {
    const i = TABS.findIndex(t => t[0] === tab), n = TABS.length;
    const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return; e.preventDefault(); setTab(TABS[j][0]); tabs.querySelector(`[data-libtab="${TABS[j][0]}"]`).focus();
  });
  const visible = () => ctx.isOn() && tab === 'project' && !document.querySelector('.app.libClosed');

  /* ---------- Projet : arbre ---------- */
  let autoReveal = store.get(PREF.reveal, true), fromTree = false;
  const bar = proj.querySelector('.ntBrBar'), footEl = proj.querySelector('.ntBrFoot');
  const search = searchBox(bar, { placeholder: tl('Filtrer : nom, étiquette, IP…'), label: tl('Filtrer les objets du projet'), onInput: q => { const n = tree.setFilter(q); search.count(q ? String(n) : ''); paintFoot(); }, onKey: e => { if (e.key === 'ArrowDown') { tree.focus(); const r = tree.rows()[0]; if (r) tree.select([r.node.key], { silent: false }); return true; } return false; } });
  bar.insertAdjacentHTML('beforeend', `<button type="button" class="tb ntBrMore" data-tip="${tl('Plus d’actions')}" aria-label="${tl('Plus d’actions')}" aria-haspopup="menu">${icon('dots')}</button>`);
  const tree = createTree(proj.querySelector('.ntBrTree'), {
    label: tl('Objets du projet'),
    empty: q => (q ? tl('Aucun objet ne correspond à « {0} ».', esc(q)) : tl('Projet vide : posez des équipements depuis la bibliothèque, ou dessinez un bâtiment dans la vue Plans.')),
    onSelect: keys => {
      const list = keys.filter(k => !isGroupKey(k)).map(parseKey).filter(Boolean);
      fromTree = true;
      try { if (list.length > 1) ctx.selectMany(list); else ctx.select(list[0] || null); } finally { fromTree = false; }
      if (list.length === 1) followInView(list[0]);
      paintFoot();
    },
    onActivate: node => { if (node.kind === 'grp') return false; goTo(node); return true; },
    onContext: (node, keys, ev) => openMenu(node, keys, ev),
    canRename: n => canRename(n.kind),
    onRename: (n, text) => { if (renameItem(data(), { kind: n.kind, id: n.id }, text)) { ctx.commit(); ctx.status(tl('Renommé : {0}', text), 'ok'); } },
    onDelete: keys => removeKeys(keys),
    onKey: (e, node) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'd' && node) { duplicateKeys(tree.selected()); return true; }
      if (e.key === 'Escape' && search.value()) { search.clear(); return true; }
      return false;
    },
    drag: {
      can: nodes => nodes.every(n => n.kind === 'dev'),
      over: (nodes, t) => canDrop(nodes, t),
      drop: (nodes, t) => {
        const r = moveDevs(data(), nodes.map(n => n.id), t);
        if (r.moved) { ctx.commit(); ctx.status(tl('{0:# équipement rangé|# équipements rangés} dans {1}.', r.moved, t.label), 'ok'); }
        if (r.refused) ctx.status(t.kind === 'rack' ? tl('{0:# équipement refusé : pas montable|# équipements refusés : pas montables} en baie, ou plus de place.', r.refused) : tl('{0:# équipement non déplacé|# équipements non déplacés}.', r.refused), 'warn');
      }
    }
  });
  function paintFoot() {
    const n = ctx.multi().length, all = data().devices.length + data().cables.length;
    footEl.textContent = n > 1 ? tl('{0} objets choisis', n) : tl('{0:# équipement|# équipements} · {1:# câble|# câbles}', data().devices.length, data().cables.length);
    footEl.hidden = !all && n < 2;
  }
  let treeVer = -1;
  function syncTree(force) {
    if (!force && !visible()) return;
    if (treeVer !== ver || force) { tree.setRoots(model()); treeVer = ver; }
    if (!fromTree) tree.select(selKeys(), { reveal: autoReveal, silent: true });
    paintFoot();
  }
  bar.querySelector('.ntBrMore').addEventListener('click', e => ctxMenu(e.currentTarget, [
    { label: tl('Tout déplier'), icon: 'expand', run: () => tree.expandAll() },
    { label: tl('Tout replier'), icon: 'shrink', run: () => tree.collapseAll() },
    '-',
    { label: tl('Suivre la sélection des vues'), checked: autoReveal, run: () => { autoReveal = !autoReveal; store.set(PREF.reveal, autoReveal); if (autoReveal) syncTree(true); } },
    { label: tl('Rechercher dans le projet…'), icon: 'search', keys: 'Ctrl+F', run: () => openFind() }
  ]));

  /** Objet choisi dans l'arbre, sur un autre étage (vue Plans) ou dans une baie (vue Baies) : la vue y va. */
  async function followInView(it) {
    const v = ctx.view(); if (v !== 'plan' && v !== 'racks') return;
    const vw = await ctx.openView(v); if (!vw || !vw.reveal) return;
    if (v === 'plan') {
      let path = []; try { path = crumbsFor(data(), it); } catch (e) { return; }
      const f = path.find(x => x.kind === 'floor'); if (f && vw.floor && vw.floor() !== f.id) vw.reveal(it.id);
    } else if (it.kind === 'rack' || (it.kind === 'dev' && (data().devices.find(x => x.id === it.id) || {}).rack)) vw.reveal(it.id);
  }
  /* ---------- Aller à, menu, actions ---------- */

  /** Montre l'objet : dans la vue montrée si elle sait le montrer, sinon dans la vue qui lui convient. */
  async function goTo(n) {
    if (!n || n.id == null) return;
    if (nav) return nav.go({ kind: n.kind, id: n.id });
    ctx.reveal(n.id);
  }
  const showIn = (v, id) => ctx.openView(v).then(vw => { if (v === 'logic') ctx.reveal(id); else if (vw && vw.reveal && !vw.reveal(id)) ctx.status(tl('Cet objet n’apparaît pas dans cette vue.'), 'warn'); });
  function removeKeys(keys) {
    const list = keys.filter(k => !isGroupKey(k)).map(parseKey).filter(x => x && canRemove(x.kind));
    if (!list.length) { ctx.status(tl('Rien à retirer ici : étages et bâtiments se retirent dans la vue Plans.'), 'warn'); return; }
    const go = () => { const n = removeItems(data(), list); if (!n) return; ctx.select(null); ctx.commit(); notify(tl('{0:# objet retiré|# objets retirés}', n), 'ok', { action: { label: tl('Annuler'), run: () => { const u = document.getElementById('undoBtn'); if (u && !u.disabled) u.click(); } } }); };
    if (list.length > 20) confirmDlg(tl('Retirer {0} objets ?', list.length), tl('Les câbles des équipements retirés partent avec eux. Ctrl+Z pour annuler.'), tl('Retirer'), true).then(ok => { if (ok) go(); });
    else go();
  }
  function duplicateKeys(keys) {
    const ids = keys.map(parseKey).filter(x => x && x.kind === 'dev').map(x => x.id); if (!ids.length) return;
    const made = duplicateDevs(data(), ids, (type, at) => ctx.newDevice(type, at));
    if (!made.length) return;
    ctx.commit(); ctx.selectMany(made.map(d => ({ kind: 'dev', id: d.id })));
    ctx.status(tl('{0:# équipement dupliqué|# équipements dupliqués} (sans leurs câbles).', made.length), 'ok');
  }
  function openMenu(node, keys, ev) {
    const multi = keys.filter(k => !isGroupKey(k)).length > 1;
    const items = [];
    if (node && node.kind !== 'grp' && !multi) {
      // Menu commun d'un objet (le même que dans les vues), renommage sur place dans l'arbre.
      if (nav) items.push(...nav.objectMenu({ kind: node.kind, id: node.id }, { rename: () => tree.rename(node.key), duplicate: () => duplicateKeys([node.key]), remove: canRemove(node.kind) ? () => removeKeys([node.key]) : null }));
    } else if (multi) {
      const devs = keys.filter(k => k.startsWith('dev:'));
      items.push({ header: tl('{0} objets choisis', keys.filter(k => !isGroupKey(k)).length) });
      items.push({ label: tl('Modifier ensemble…'), icon: 'sliders', run: () => focusBulk() });
      if (devs.length) items.push({ label: tl('Dupliquer'), icon: 'copy', keys: 'Ctrl+D', run: () => duplicateKeys(devs) });
      items.push({ label: tl('Retirer'), icon: 'trash', keys: ctx.isEn ? 'Delete' : 'Suppr', danger: true, run: () => removeKeys(keys) });
    }
    if (node && node.children && node.children.length) {
      if (items.length) items.push('-');
      const inside = descendants(node).filter(x => x.kind !== node.kind || x.id !== node.id);
      const devs = inside.filter(x => x.kind === 'dev');
      items.push({ label: tl('Choisir tout ce qu’il contient ({0})', inside.length), icon: 'checklist', disabled: !inside.length, run: () => ctx.selectMany(inside) });
      if (devs.length && devs.length !== inside.length) items.push({ label: tl('Choisir ses équipements ({0})', devs.length), icon: 'desktopPc', run: () => ctx.selectMany(devs) });
      items.push({ label: tl('Tout déplier ici'), icon: 'expand', run: () => { const walk = n => { if (n.children && n.children.length) { tree.expand(n.key, true); n.children.forEach(walk); } }; walk(node); } });
    }
    if (!items.length) items.push({ label: tl('Tout déplier'), icon: 'expand', run: () => tree.expandAll() }, { label: tl('Tout replier'), icon: 'shrink', run: () => tree.collapseAll() });
    ctxMenu(ev, items, { restore: tree.el });
  }

  /* ---------- Calques (vue Plans) ---------- */
  let hidden = new Set(store.get(PREF.layers, [])), locked = new Set();
  const planEl = () => host.querySelector('.ntVw.ntPl');
  function applyLayers() {
    const el = planEl(); if (!el) return;
    for (const L of LAYERS) { el.classList.toggle('ntLyOff-' + L.id, hidden.has(L.id)); el.classList.toggle('ntLyLock-' + L.id, locked.has(L.id)); }
  }
  const planBtn = id => { const el = planEl(); return el ? el.querySelector(`[data-layer="${id}"]`) : null; };
  async function planView() { if (ctx.view() !== 'plan') return null; planVw = await ctx.openView('plan'); if (nav) nav.setPlan(planVw); return planVw; }
  async function paintLayers() {
    const vw = await planView(), on = !!vw;
    const fid = vw && vw.floor ? vw.floor() : null, und = fid && data().underlays ? data().underlays[fid] : null;
    const row = (id, ic, name, vis, opt = {}) => `<div class="ntLyRow${vis ? '' : ' off'}" role="listitem"><button type="button" class="ntLyEye" data-ly="${esc(id)}" aria-pressed="${vis}" aria-label="${esc(vis ? tl('Masquer {0}', name) : tl('Afficher {0}', name))}" data-tip="${esc(vis ? tl('Masquer') : tl('Afficher'))}">${icon(vis ? 'eye' : 'eyeOff')}</button>${opt.lock != null ? `<button type="button" class="ntLyLock" data-lylock="${esc(id)}" aria-pressed="${opt.lock}" aria-label="${esc(opt.lock ? tl('Déverrouiller {0}', name) : tl('Verrouiller {0}', name))}" data-tip="${esc(opt.lock ? tl('Verrouillé : ne se choisit pas sur le plan') : tl('Verrouiller : ne plus le choisir sur le plan'))}">${icon('lock')}</button>` : '<span class="ntLyLock"></span>'}${opt.color ? `<i class="ntLySw" style="background:${esc(opt.color)}"></i>` : icon(ic, 'ntLyIc')}<span class="ntLyName">${esc(name)}</span>${opt.n != null ? `<span class="ntLyN">${opt.n}</span>` : ''}</div>`;
    let h = `<div class="ntLyHead"><b>${tl('Calques du plan')}</b>${on ? '' : `<p>${tl('Les calques s’appliquent à la vue Plans.')}</p><button type="button" class="btn small" data-lyopen>${icon('floorPlan')}<span>${tl('Ouvrir la vue Plans')}</span></button>`}</div>`;
    h += `<div class="ntLyCols" aria-hidden="true"><span data-tip="${esc(tl('Afficher ou masquer'))}">${icon('eye')}</span><span data-tip="${esc(tl('Verrouiller : visible, mais ne se choisit plus sur le plan'))}">${icon('lock')}</span><b>${tl('Calque')}</b></div>`;
    h += `<div class="ntLyList" role="list" aria-label="${tl('Dessin')}"><h3>${tl('Dessin')}</h3>${LAYERS.map(L => row(L.id, L.icon, L.name(), !hidden.has(L.id), { lock: locked.has(L.id) })).join('')}</div>`;
    h += `<div class="ntLyList" role="list" aria-label="${tl('Superpositions')}"><h3>${tl('Superpositions')}</h3>${PLAN_LAYERS.map(L => { const b = planBtn(L.id); return b ? row('plan:' + L.id, L.icon, L.name(), b.getAttribute('aria-pressed') === 'true') : ''; }).join('') || `<p class="ntLyNote">${tl('Ouvrez la vue Plans pour les régler.')}</p>`}</div>`;
    if (und && Array.isArray(und.layers) && und.layers.length) {
      h += `<div class="ntLyList" role="list" aria-label="${tl('Fond DXF')}"><h3>${tl('Fond DXF')} <small>${esc(und.name || '')}</small><span class="grow"></span><button type="button" class="tb ntLyAll" data-lycad="all" data-tip="${tl('Tout afficher')}" aria-label="${tl('Tout afficher')}">${icon('eye')}</button><button type="button" class="tb ntLyAll" data-lycad="none" data-tip="${tl('Tout masquer')}" aria-label="${tl('Tout masquer')}">${icon('eyeOff')}</button></h3>${und.layers.map((L, i) => row('cad:' + i, 'layers', L.name || String(L.id), L.on !== false, { color: L.color })).join('')}</div>`;
    }
    h += `<div class="ntLyFoot"><button type="button" class="btn small subtle" data-lyreset>${icon('eye')}<span>${tl('Tout afficher')}</span></button></div>`;
    lay.innerHTML = h;
  }
  lay.addEventListener('click', async e => {
    if (e.target.closest('[data-lyopen]')) { await ctx.openView('plan'); paintLayers(); return; }
    if (e.target.closest('[data-lyreset]')) { hidden.clear(); locked.clear(); store.set(PREF.layers, []); applyLayers(); paintLayers(); return; }
    const all = e.target.closest('[data-lycad]');
    if (all) { const vw = await planView(), fid = vw && vw.floor && vw.floor(), u = fid && data().underlays && data().underlays[fid]; if (u) { u.layers.forEach(L => { L.on = all.dataset.lycad === 'all'; }); ctx.commit(); paintLayers(); } return; }
    const lk = e.target.closest('[data-lylock]');
    if (lk) { const id = lk.dataset.lylock; if (locked.has(id)) locked.delete(id); else locked.add(id); applyLayers(); paintLayers(); return; }
    const b = e.target.closest('[data-ly]'); if (!b) return;
    const id = b.dataset.ly;
    if (id.startsWith('plan:')) { const pb = planBtn(id.slice(5)); if (pb) pb.click(); setTimeout(paintLayers, 60); return; }
    if (id.startsWith('cad:')) { const vw = await planView(), fid = vw && vw.floor && vw.floor(), u = fid && data().underlays && data().underlays[fid], L = u && u.layers[+id.slice(4)]; if (L) { L.on = L.on === false; ctx.commit(); paintLayers(); } return; }
    if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
    store.set(PREF.layers, [...hidden]); applyLayers(); paintLayers();
  });

  /* ---------- Fil d'Ariane ---------- */
  const viewBar = host.querySelector('.ntViewBar');
  const crumbs = document.createElement('nav'); crumbs.className = 'ntCrumbs'; crumbs.setAttribute('aria-label', tl('Fil d’Ariane'));
  viewBar.appendChild(crumbs);
  let crumbPath = [], planVw = null;
  function paintCrumbs() {
    if (!ctx.isOn()) return;
    let s = ctx.selection();
    if (!s && ctx.view() === 'plan' && planVw) { const f = planVw.floor && planVw.floor(); if (f) s = { kind: 'floor', id: f }; }
    // Calcul direct (sans l'arbre entier) : appelé à chaque sélection, même onglet Projet fermé.
    try { const d = data(), L = labeler(d); crumbPath = crumbsFor(d, s, { label: x => L.of(x.id), cableLabel: c => L.cable(c) }); } catch (e) { console.error(e); crumbPath = []; }
    if (!crumbPath.length) { crumbs.innerHTML = ''; crumbs.hidden = true; return; }
    crumbs.hidden = false;
    const n = ctx.multi().length, L = crumbPath.length, last = L - 1;
    // Tout le chemin s'il tient ; sinon la racine en icône, « … » (niveaux du milieu, en menu) et les deux derniers
    // niveaux ; sinon un seul niveau avant l'objet ; sinon l'objet seul après « … ». L'objet reste toujours lisible en
    // entier : en dernier recours, les onglets des vues passent en icônes. mode : 0 tout, 1 replié, 2 serré, 3 objet seul.
    const cut = mode => (mode === 3 ? 0 : mode === 2 ? 1 : 2); // niveaux gardés avant l'objet (hors racine)
    const render = mode => {
      crumbs.classList.toggle('m3', mode === 3);
      const keep = i => mode === 0 || i === 0 || i === last || i >= L - 1 - cut(mode);
      let h = '', gap = false;
      crumbPath.forEach((c, i) => {
        if (!keep(i)) { if (!gap) { gap = true; h += `<button type="button" class="ntCrSep" data-crs="1" aria-hidden="true" tabindex="-1">${icon('chevRight')}</button><button type="button" class="ntCr ntCrMore" data-crmore="${mode}" aria-haspopup="menu" aria-label="${tl('Niveaux intermédiaires')}" title="${esc(crumbPath.slice(1, L - 1 - cut(mode)).map(x => x.label).join(' › '))}">…</button>`; } return; }
        if (i) h += `<button type="button" class="ntCrSep" data-crs="${i}" aria-label="${esc(tl('Voisins de {0}', c.label))}" aria-haspopup="menu">${icon('chevRight')}</button>`;
        const iconOnly = i === 0 && mode > 0;
        h += `<button type="button" class="ntCr${i === last ? ' last' : ''}${i === 0 ? ' root' : ''}" data-cr="${i}" title="${esc(c.label)}"${iconOnly ? ` aria-label="${esc(c.label)}"` : ''}${i === last ? ' aria-current="location"' : ''}>${i === 0 || i === last ? icon(c.icon || 'dots') : ''}${iconOnly ? '' : `<span>${esc(c.label)}</span>`}</button>`;
      });
      crumbs.innerHTML = h + (n > 1 ? `<span class="ntCrMulti">${tl('+{0} autres', n - 1)}</span>` : '');
    };
    const over = () => crumbs.scrollWidth > crumbs.clientWidth + 1 || [...crumbs.querySelectorAll('.ntCr span')].some(x => x.scrollWidth > x.clientWidth + 1);
    const fit = () => { render(0); for (const m of [1, 2, 3]) { if (!over()) return true; if (L - 2 - cut(m) <= 0) continue; render(m); } return !over(); };
    viewBar.classList.remove('ntVbTight');
    if (!fit()) { viewBar.querySelectorAll('.ntVTab').forEach(b => { if (!b.hasAttribute('aria-label')) b.setAttribute('aria-label', b.textContent.trim()); }); viewBar.classList.add('ntVbTight'); fit(); }
  }
  // La barre change de largeur (fenêtre, panneaux) : le fil se recalcule.
  new ResizeObserver(() => { if (crumbPath.length) paintCrumbs(); }).observe(crumbs.parentElement);
  crumbs.addEventListener('click', e => {
    const c = e.target.closest('[data-cr]');
    if (c) { const p = crumbPath[+c.dataset.cr]; if (!p) return; if (p.kind === 'grp') { setTab('project'); tree.reveal(p.key); tree.select([p.key], { silent: true }); return; } ctx.select({ kind: p.kind, id: p.id }); goTo(p); return; }
    const more = e.target.closest('[data-crmore]');
    if (more) { const m = +more.dataset.crmore; ctxMenu(more, crumbPath.slice(1, crumbPath.length - 1 - (m === 3 ? 0 : m === 2 ? 1 : 2)).map(p => ({ label: p.label, icon: p.icon, run: () => { if (p.kind === 'grp') { setTab('project'); tree.reveal(p.key); return; } ctx.select({ kind: p.kind, id: p.id }); goTo(p); } }))); return; }
    const sp = e.target.closest('[data-crs]');
    if (sp) {
      const i = +sp.dataset.crs, parent = crumbPath[i - 1]; if (!parent) return;
      const idx = new Map(); const walk = l => { for (const n of l) { idx.set(n.key, n); if (n.children) walk(n.children); } }; walk(model());
      const pn = idx.get(parent.key); if (!pn || !pn.children) return;
      const list = pn.children.slice(0, 60).map(ch => ({ label: ch.label, icon: ch.icon, checked: ch.key === (crumbPath[i] || {}).key ? true : undefined, run: () => { if (ch.kind === 'grp') { setTab('project'); tree.reveal(ch.key); return; } ctx.select({ kind: ch.kind, id: ch.id }); goTo(ch); } }));
      if (pn.children.length > 60) list.push({ label: tl('… {0} de plus (onglet Projet)', pn.children.length - 60), icon: 'list', run: () => { setTab('project', true); tree.reveal(pn.key); } });
      ctxMenu(sp, list);
    }
  });

  /* ---------- Rechercher (Ctrl+F) et Aller à (Ctrl+G) ---------- */
  let find = null;
  function openFind(mode = 'find') {
    if (!ctx.isOn()) return;
    if (!find) find = buildFind();
    find.open(mode);
  }
  function buildFind() {
    const el = document.createElement('div'); el.className = 'ntFind'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', tl('Rechercher dans le projet'));
    el.innerHTML = `<div class="ntFindBox"></div><div class="ntFindList" role="listbox" id="ntFindList"></div><div class="ntFindFoot"></div>`;
    host.appendChild(el);
    let res = [], act = 0;
    const listEl = el.querySelector('.ntFindList'), footEl2 = el.querySelector('.ntFindFoot');
    const sb = searchBox(el.querySelector('.ntFindBox'), { placeholder: tl('Rechercher : nom, étiquette, type, adresse IP…'), delay: 60, onInput: q => run(q), onKey: e => key(e), onEscape: () => close() });
    sb.input.setAttribute('role', 'combobox'); sb.input.setAttribute('aria-controls', 'ntFindList'); sb.input.setAttribute('aria-expanded', 'true');
    function run(q) {
      res = findRank(findList(), q, 200); act = 0; paint(q);
    }
    function paint(q = sb.value()) {
      listEl.innerHTML = res.length ? res.map((r, i) => `<div class="ntFindRow${i === act ? ' act' : ''}" role="option" id="ntFind-${i}" data-i="${i}" aria-selected="${i === act}">${icon(r.icon || 'dots')}<span class="ntFindLb">${highlightParts(r.label, q).map(([t, m]) => (m ? `<mark>${esc(t)}</mark>` : esc(t))).join('')}</span><span class="ntFindSub">${esc(r.sub)}</span><span class="ntFindWh">${esc(r.where || kindTitle(r.kind))}</span></div>`).join('') : `<p class="ntFindNone">${q.trim() ? tl('Aucun objet ne correspond.') : tl('Tapez un nom, une étiquette (1A-A01), un type (switch, prise) ou une adresse IP.')}</p>`;
      if (res.length) sb.input.setAttribute('aria-activedescendant', 'ntFind-' + act); else sb.input.removeAttribute('aria-activedescendant');
      footEl2.innerHTML = res.length ? `<span>${tl('{0:# résultat|# résultats}', res.length)}</span><span class="grow"></span><kbd>↑↓</kbd> ${tl('parcourir')} <kbd>↵</kbd> ${tl('aller')} <kbd>${esc(keyLabel('Alt+'))}↵</kbd> ${tl('tout choisir')}` : '';
      const a = listEl.querySelector('.act'); if (a) scrollWithin(a, 'nearest', false);
    }
    function go(i) { const r = res[i]; if (!r) return; close(); if (nav) nav.go({ kind: r.kind, id: r.id }); else { ctx.select({ kind: r.kind, id: r.id }); goTo(r); } }
    function selectAll() { if (!res.length) return; const list = res.map(r => ({ kind: r.kind, id: r.id })); close(); ctx.selectMany(list); ctx.status(tl('{0:# objet choisi|# objets choisis} : modifiez-les ensemble dans l’inspecteur.', list.length), 'ok'); }
    function key(e) {
      if (e.key === 'ArrowDown') { act = Math.min(res.length - 1, act + 1); paint(); return true; }
      if (e.key === 'ArrowUp') { act = Math.max(0, act - 1); paint(); return true; }
      if (e.key === 'PageDown') { act = Math.min(res.length - 1, act + 8); paint(); return true; }
      if (e.key === 'PageUp') { act = Math.max(0, act - 8); paint(); return true; }
      if (e.key === 'Enter') { if (e.altKey) selectAll(); else go(act); return true; }
      return false;
    }
    listEl.addEventListener('pointermove', e => { const r = e.target.closest('[data-i]'); if (r && +r.dataset.i !== act) { act = +r.dataset.i; listEl.querySelectorAll('.ntFindRow').forEach(x => { const on = +x.dataset.i === act; x.classList.toggle('act', on); x.setAttribute('aria-selected', String(on)); }); } });
    listEl.addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) go(+r.dataset.i); });
    const out = e => { if (!el.hidden && !el.contains(e.target)) close(); };
    function close() { el.hidden = true; removeEventListener('pointerdown', out, true); }
    return {
      open(mode) {
        el.hidden = false; el.dataset.mode = mode;
        sb.input.placeholder = mode === 'goto' ? tl('Aller à : étiquette ou nom (1A-A01, SW-01, Bureau 12…)') : tl('Rechercher : nom, étiquette, type, adresse IP…');
        items = null; run(sb.value()); sb.focus(true);
        setTimeout(() => addEventListener('pointerdown', out, true));
      },
      close
    };
  }

  /* ---------- Modification groupée (au-dessus de l'inspecteur) ---------- */
  const bulk = document.createElement('section'); bulk.className = 'ntBulk'; bulk.hidden = true; bulk.setAttribute('aria-label', tl('Modifier ensemble'));
  pane.before(bulk);
  let grid = null, bulkSig = '';
  function bulkEditInto(el, list) {
    const d = data(), its = resolveSel(d, list), fields = bulkFields(d, its);
    const counts = {}; for (const it of its) counts[it.kind] = (counts[it.kind] || 0) + 1;
    el.innerHTML = `<header class="ntBulkHead">${icon('sliders')}<div><b>${tl('Modifier ensemble')}</b><small>${Object.entries(counts).map(([k, n]) => `${n} ${esc(kindTitle(k).toLowerCase())}`).join(' · ')}</small></div><button type="button" class="tb" data-bulkx data-tip="${tl('Ne plus choisir ces objets · Échap')}" aria-label="${tl('Ne plus choisir ces objets')}">${icon('x')}</button></header><div class="ntBulkGrid"></div>${fields.length ? '' : `<p class="ntBulkNone">${tl('Aucun réglage commun à ces objets.')}</p>`}`;
    const g = propGrid(el.querySelector('.ntBulkGrid'), fields, its, (key, value, { field }) => {
      const n = applyBulk(d, its, field, value);
      if (!n) return;
      ctx.commit(); ctx.status(tl('{0} : {1:# objet modifié|# objets modifiés}.', field.label, n), 'ok');
    }, { en: ctx.isEn });
    return { grid: g, its, fields };
  }
  function paintBulk(force) {
    const list = ctx.multi(), show = ctx.isOn() && list.length > 1 && !pane.hidden;
    bulk.hidden = !show;
    if (!show) { bulkSig = ''; return; }
    const sig = list.map(x => x.kind + ':' + x.id).join('|') + '#' + ver;
    if (!force && sig === bulkSig) return;
    if (bulk.contains(document.activeElement) && sig.split('#')[0] === bulkSig.split('#')[0]) { // saisie en cours : valeurs seulement
      const d = data(); grid && grid.update(resolveSel(d, list)); bulkSig = sig; return;
    }
    bulkSig = sig;
    grid = bulkEditInto(bulk, list).grid;
  }
  function focusBulk() { paintBulk(true); const i = bulk.querySelector('input, select'); if (i) i.focus(); }
  bulk.addEventListener('click', e => { if (e.target.closest('[data-bulkx]')) ctx.select(null); });
  bulk.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.target.matches('input[type="text"]')) { ctx.select(null); e.stopPropagation(); } });
  new MutationObserver(() => paintBulk()).observe(pane, { attributes: true, attributeFilter: ['hidden'] });

  /* ---------- Suivre le modèle, la sélection, la vue ---------- */
  let raf = 0;
  let treeT = 0;
  const soon = () => {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintCrumbs(); paintBulk(); if (tab === 'layers') paintLayers(); if (built === ver) syncTree(false); });
    // L'arbre (plus long à refaire) attend que les changements rapprochés soient passés.
    if (built !== ver) { clearTimeout(treeT); treeT = setTimeout(() => syncTree(false), 120); }
  };
  ctx.onChange(() => { ver++; soon(); });
  ctx.onSelect(() => { soon(); });
  // Vue changée (barre des vues) : fil d'Ariane, calques, sélection multiple de la nouvelle vue.
  let shownView = ctx.view();
  new MutationObserver(() => {
    applyLayers(); if (ctx.view() === 'plan' && !planVw) planView().then(soon);
    // Sélection multiple faite ailleurs : la vue qui s'ouvre la reprend (après son affichage).
    if (ctx.view() !== shownView) { shownView = ctx.view(); libForView(); const m = ctx.multi(); if (m.length > 1) requestAnimationFrame(() => ctx.selectMany(m)); if (nav) requestAnimationFrame(() => { nav.record(); nav.paintStrip(); }); }
    soon();
  }).observe(viewBar, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
  // La vue Plans se crée à la demande : ses calques s'appliquent dès qu'elle existe.
  new MutationObserver(() => { if (planEl() && !planEl().dataset.ntLy) { planEl().dataset.ntLy = '1'; applyLayers(); } }).observe(host, { childList: true });
  // Panneau de gauche replié puis rouvert : l'arbre se remet à jour.
  new MutationObserver(soon).observe(document.querySelector('.app'), { attributes: true, attributeFilter: ['class'] });

  /* ---------- Commandes et raccourcis ---------- */
  const when = () => isNet() && ctx.isOn();
  if (app.commands) {
    app.commands.register({ id: 'net.find', cat: tl('Réseau'), icon: 'search', label: tl('Réseau : rechercher dans le projet'), keys: 'Ctrl+F', when, run: () => openFind('find') });
    app.commands.register({ id: 'net.goto', cat: tl('Réseau'), icon: 'chevRight', label: tl('Réseau : aller à un objet (étiquette, nom)'), keys: 'Ctrl+G', when, run: () => openFind('goto') });
    app.commands.register({ id: 'net.browser', cat: tl('Réseau'), icon: 'list', label: tl('Réseau : objets du projet (arbre)'), when, run: () => { app.setLibOpen(true); setTab('project', true); } });
    app.commands.register({ id: 'net.layers', cat: tl('Réseau'), icon: 'layers', label: tl('Réseau : calques du plan'), when, run: () => { app.setLibOpen(true); setTab('layers'); if (ctx.view() !== 'plan') ctx.openView('plan').then(paintLayers); } });
    app.commands.register({ id: 'net.library', cat: tl('Réseau'), icon: 'box', label: tl('Réseau : bibliothèque des équipements'), when, run: () => { app.setLibOpen(true); setTab('lib', true); } });
  }
  addEventListener('keydown', e => {
    if (!ctx.isOn()) return;
    const mod = e.ctrlKey || e.metaKey; if (!mod || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase(); if (k !== 'f' && k !== 'g') return;
    if (document.querySelector('.sDialogWrap, .nt-ov, .ntTour') || [...document.querySelectorAll('.modal')].some(m => !m.hidden)) return;
    e.preventDefault(); e.stopImmediatePropagation(); openFind(k === 'g' ? 'goto' : 'find');
  }, true);

  // Onglets du panneau du bas : Brassage, Câbles, Résultats des tests (contenu chargé au premier affichage).
  const docks = import('./ia-docks.js').then(m => m.installDocks(ctx, { goTo: n => goTo(n), showIn })).catch(e => { console.error(e); return null; });
  // « Lié à », aller, historique (ia-nav.js).
  nav = installNav(ctx, { host, pane, viewBar, docks });

  setTab(tab); libForView();
  applyLayers();
  soon();
  return { openFind, setTab, bulkEdit: (el, list) => bulkEditInto(el, list || ctx.multi()), related: nav.related, relatedMenu: nav.relatedMenu, objectMenu: nav.objectMenu, ctxMenu: (ev, items) => ctxMenu(ev, items), go: nav.go, back: nav.back, forward: nav.forward, canBack: nav.canBack, canForward: nav.canForward, key: nav.key };
}

/**
 * Modification groupée pour une vue : bulkEdit(ctx, sel, el) monte la grille des réglages communs de sel ([{ kind, id }],
 * défaut : ctx.multi()) dans el ; rend { grid, its, fields }. Les vues qui veulent la leur (plutôt que la carte au-dessus de
 * l'inspecteur) l'appellent.
 */
export function bulkEdit(ctx, sel, el) {
  const d = ctx.data(), its = resolveSel(d, sel || ctx.multi()), fields = bulkFields(d, its);
  const grid = propGrid(el, fields, its, (key, value, { field }) => { const n = applyBulk(d, its, field, value); if (n) { ctx.commit(); ctx.status(tl('{0} : {1:# objet modifié|# objets modifiés}.', field.label, n), 'ok'); } }, { en: ctx.isEn });
  return { grid, its, fields };
}
