// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Ossature de l'application pour un projet réseau (types Réseau et Objets connectés), chargée avec le plan réseau
// (install.js) : barre de menus Fichier, Édition, Affichage, Insertion, Réseau, Conception, Tests, Documents, Aide
// (menus.js : données ; menubar.js : barre), mêmes entrées dans la palette de commandes, raccourcis propres au module
// (Ctrl+I importer un plan, Ctrl+P rapport, Ctrl+Maj+E DXF, Ctrl+Maj+K certifier, Alt+1…4 depuis le montage) et leur
// place dans l'aide « ? », barre d'état (vue, étage, zoom, comptes). Les actions appellent ce que les vues font déjà
// (workspace.js, plan.js, racks.js, design.js, design-docs.js, certui.js, cadimport.js quand il existe). Projet sans
// plan réseau : rien ne se montre. Nouveau projet réseau : modèles et visite guidée (welcome.js, chargé à la demande).
import './shellnet.css';
import { tl, isEn } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { menu as popMenu } from '../../school/ui.js';
import { addHelpSection, onNavPaint } from '../../ui/navdock.js';
import { onKeyFirst } from '../../ui/shell.js';
import { KINDS } from '../../ui/kind.js';
import { menusFor, flatItems, shortcutRows, globalKeys, matchKey, keyLabel, hasNet, MENUS } from '../menus.js';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Modules d'autres parties, peut-être absents de cette version : détectés sans casser la construction.
const CAD = import.meta.glob('./cadimport.js');
// Échange IFC (ifcimport.js : openIfcImport ; ifcexport.js : exportIfc), détecté de même.
const IFC = import.meta.glob(['./ifcimport.js', './ifcexport.js']);
// Échanges Excel (xlsxui.js : exportXlsx, openXlsxImport, openPriceImport), détectés de même.
const XLSX = import.meta.glob('./xlsxui.js');
// Synchronisation NetBox (netbox.js : openNetbox), détectée de même.
const NETBOX = import.meta.glob('./netbox.js');
// Export DWG (dwgexport.js : exportDwg, convertisseur installé sur l'ordinateur), détecté de même.
const DWG = import.meta.glob('./dwgexport.js');
// Schémas Visio et draw.io (visioexport.js : exportVsdx, exportDrawio ; vsdximport.js : openVsdxImport), détectés de même.
const VISIO = import.meta.glob(['./visioexport.js', './vsdximport.js']);
/** Commandes d'une vue que les menus remplacent (la palette ne les montre pas deux fois). */
const SUPERSEDES = {
  'view.wifi': ['net.plan.wifi'], 'file.importImage': ['net.plan.image'], 'ins.building': ['net.plan.building'], 'ins.floor': ['net.plan.floor'],
  'ins.detect': ['net.plan.detect'], 'ins.rack': ['net.rack.addFloor'], 'ins.wrack': ['net.rack.addWall'], 'view.vlan': ['net.sim.vlanview'], 'view.passive': ['net.sim.passive'],
  'tests.trace': ['net.sim.trace'], 'tests.cert': ['net.cert.open'], 'tests.certAll': ['net.cert.all']
};
const VIEW_IDS = ['logic', 'plan', 'racks', 'design'];
const PRO = !!(import.meta.env && import.meta.env.VITE_EDITION === 'pro');
const LINKS = { site: 'https://xelaktechsn.github.io/jollof-studio/', help: 'https://xelaktechsn.github.io/jollof-studio/aide/', // aide : docs/GUIDE.md en pages (scripts/help-site.mjs)
  issues: 'https://github.com/xelaktechsn/jollof-studio/issues' };

let installed = null;
/**
 * Pose l'ossature réseau (une fois). app : l'interface des modules (main.js) ; net : l'objet de install.js ;
 * ws : le plan de travail chargé (workspace.js). Rend { refresh(), welcome(kind) }.
 */
export function installNetShell(app, net, ws) {
  if (installed) return installed;
  const ctx = () => ws.ctx();
  const kind = () => (app.kind ? app.kind() : 'elec');
  const on = () => hasNet(kind());
  const cap = { cad: !!CAD['./cadimport.js'], dxf: false, pdf: false, ifc: !!(IFC['./ifcimport.js'] && IFC['./ifcexport.js']), xlsx: !!XLSX['./xlsxui.js'], netbox: !!NETBOX['./netbox.js'], dwg: !!DWG['./dwgexport.js'], visio: !!(VISIO['./visioexport.js'] && VISIO['./vsdximport.js']) };
  const objs = {}; // vues chargées par les menus (plan.cmd, design.tab…)
  let docsMod = null;

  /* ---------- Fonctions des autres parties (détectées) ---------- */
  const DXF_NAMES = ['exportDxf', 'saveDxf', 'exportDesignDxf'], PDF_NAMES = ['exportSheetsPdf', 'exportPdf', 'exportSheets', 'printSheets'];
  const pick = (m, names) => (m ? names.map(n => m[n]).find(f => typeof f === 'function') || null : null);
  async function probe() {
    try { docsMod = await import('./design-docs.js'); } catch (e) { docsMod = null; }
    let core = null; try { core = await import('../docs.js'); } catch (e) { /* rien */ }
    cap.dxf = !!(pick(docsMod, DXF_NAMES) || pick(core, DXF_NAMES));
    cap.pdf = !!(pick(docsMod, PDF_NAMES) || pick(core, PDF_NAMES));
    return { docsMod, core };
  }
  probe();

  /* ---------- État lu par les menus ---------- */
  function simPref() { try { return JSON.parse(localStorage.getItem('jollof-net-sim') || 'null') || {}; } catch (e) { return {}; } }
  function env() {
    const d = ws.data() || {}, wsOn = ws.isOn(), view = wsOn ? ws.view() : null;
    const site = d.site || { buildings: [] }, many = (site.buildings || []).length > 1;
    const floors = [], racks = (d.racks || []).map(r => ({ id: r.id, name: r.name || r.id }));
    for (const b of site.buildings || []) for (const f of b.floors || []) floors.push({ id: f.id, name: (many ? (b.name || b.id) + ' · ' : '') + (f.name || f.id) });
    const plan = objs.plan && objs.plan.cmd;
    let sel = null; try { sel = ctx().selection(); } catch (e) { /* rien */ }
    const ub = $('#undoBtn'), rb = $('#redoBtn');
    return {
      desktop: !!(app.isDesktop && app.isDesktop()), kind: kind(), view, cap, floors, racks, sel, exam: d.exam === true, sim: simPref(), pro: PRO, insOpen: insOpen(),
      layers: plan ? plan.layers() : null,
      canUndo: ub ? !ub.disabled : true, canRedo: rb ? !rb.disabled : true,
      has: id => !!(app.commands && app.commands.get && app.commands.get(id))
    };
  }

  /* ---------- Actions ---------- */
  /** Montre une vue (le plan réseau d'abord, dans un projet Objets connectés) et rend son objet. */
  async function view(id) {
    if (!ws.isOn()) ws.setMode(true);
    const v = await ws.openView(id);
    if (v) objs[id] = v;
    return v;
  }
  const fake = (id, text = '') => ({ dataset: { id }, textContent: text });
  async function docAction(act, b) {
    const m = docsMod || (await probe()).docsMod;
    if (!m || !m.onAction) { app.status(tl('Cette vue n’a pas pu se charger.'), 'err'); return; }
    await m.onAction(ctx(), act, b || fake(''));
  }
  async function external(names) {
    const { docsMod: m, core } = await probe();
    const f = pick(m, names) || pick(core, names);
    if (f) return f(ctx());
    app.status(tl('Cette fonction n’est pas disponible dans cette version.'), 'warn');
  }
  /** Raccourci rejoué pour la vue montrée (Couper, Copier, Coller, Dupliquer, Tout sélectionner) : ses gestes à elle. */
  function combo(keys) {
    if (!ws.isOn()) ws.setMode(true);
    const k = keys.split('+').pop().toLowerCase(), o = { key: k, code: 'Key' + k.toUpperCase(), bubbles: true, cancelable: true, shiftKey: /Shift/.test(keys), [MAC ? 'metaKey' : 'ctrlKey']: true };
    (document.activeElement && document.activeElement !== document.body && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) ? document.activeElement : document.body).dispatchEvent(new KeyboardEvent('keydown', o));
  }
  /** Renommer : le champ du nom de l'objet choisi dans l'inspecteur (sinon l'arbre du projet, F2). */
  function rename() {
    if (app.setTab) app.setTab('nprop');
    requestAnimationFrame(() => {
      const pane = document.querySelector('#pane-nprop');
      const inp = pane && [...pane.querySelectorAll('input')].find(i => /name|nom/i.test([i.name, i.dataset ? Object.values(i.dataset).join(' ') : '', i.getAttribute('aria-label') || ''].join(' ')) && i.offsetParent);
      if (inp) { inp.focus(); inp.select(); flash(inp); } else app.status(tl('Choisissez un objet, puis renommez-le dans l’inspecteur.'), 'warn');
    });
  }
  /** Bouton d'un outil du schéma logique (Ping, Traceroute, Testeur, Câble) : la vue logique, puis l'outil. */
  async function logicTool(t) { await view('logic'); const b = document.querySelector(`.ntLogic [data-tool="${t}"]`); if (b) b.click(); }
  /** Place un équipement comme un clic dans la bibliothèque : au centre de la vue montrée. */
  async function place(type) {
    if (!ws.isOn()) ws.setMode(true);
    const it = document.querySelector(`.ntLib .ntItem[data-t="${type}"]`);
    if (!it) { if (ws.place) ws.place(type, 0, 0); return; }
    const r = it.getBoundingClientRect(), o = { bubbles: true, button: 0, clientX: r.left + 4, clientY: r.top + 4, pointerId: 1, isPrimary: true };
    it.dispatchEvent(new PointerEvent('pointerdown', o)); window.dispatchEvent(new PointerEvent('pointerup', o));
  }
  /** Section de l'inspecteur d'un équipement capable (routeurs, switchs) : choisi, puis la section en vue. */
  async function config(what) {
    const L3 = new Set(['routerpro', 'l3switch']), STP = new Set(['switch24', 'switch48', 'l3switch']), DHCP = new Set(['routerpro', 'l3switch', 'router']);
    const set = what === 'l3' ? L3 : what === 'stp' ? STP : DHCP, d = ws.data();
    const s = ctx().selection(), cur = s && s.kind === 'dev' ? (d.devices || []).find(x => x.id === s.id) : null;
    const dev = cur && set.has(cur.type) ? cur : (d.devices || []).find(x => set.has(x.type));
    if (!dev) {
      app.status(what === 'stp' ? tl('Aucun switch administrable dans le projet : posez-en un depuis la bibliothèque.') : tl('Aucun routeur ni switch de niveau 3 dans le projet : posez-en un depuis la bibliothèque.'), 'warn');
      libSearch(what === 'stp' ? 'switch' : isEn ? 'router' : 'routeur'); return;
    }
    await view('logic'); ctx().reveal(dev.id); if (app.setTab) app.setTab('nprop');
    const want = what === 'l3' ? [/^OSPF/, /^Rout/] : what === 'stp' ? [/Spanning Tree/] : [/DHCP/];
    requestAnimationFrame(() => {
      const hs = [...document.querySelectorAll('#pane-nprop h4')];
      const h = want.map(re => hs.find(x => re.test(x.textContent.trim()))).find(Boolean);
      const sec = h && h.closest('section');
      if (sec) { scrollPane(sec); flash(sec); }
      app.status(tl('{0} : réglages dans l’inspecteur.', ctx().nameOf(dev.id)));
    });
  }
  /** Défilement du seul panneau (kit scrollWithin) : scrollIntoView ferait aussi glisser les ancêtres en overflow: hidden. */
  const scrollPane = (el, block) => import('./kit/index.js').then(k => k.scrollWithin(el, block));
  function flash(el) { el.classList.remove('ntFlash'); void el.offsetWidth; el.classList.add('ntFlash'); setTimeout(() => el.classList.remove('ntFlash'), 1600); }
  function libSearch(q = '') {
    if (!ws.isOn()) ws.setMode(true);
    app.setLibOpen(true);
    requestAnimationFrame(() => { const i = document.querySelector('.ntLib input[type="search"]'); if (i) { if (q) { i.value = q; i.dispatchEvent(new Event('input')); } i.focus(); i.select(); } });
  }
  async function designTab(t) {
    const v = await view('design'); if (!v || !v.tab) return v;
    if (t === 'generate') {
      v.tab('dim');
      for (let k = 0; k < 40; k++) { await new Promise(r => requestAnimationFrame(r)); const g = v.body && v.body().querySelector('.ntDsGen, .ntDsEmptyBig'); if (g) { scrollPane(g, 'center'); flash(g); const b = g.querySelector('button'); if (b) b.focus(); break; } }
    } else v.tab(t);
    return v;
  }
  const welcomeMod = () => import('./welcome.js');
  async function run(it) {
    if (it.cmd) { if (!app.commands.run(it.cmd)) app.status(tl('Cette fonction n’est pas disponible ici.'), 'warn'); return; }
    const [a, arg] = String(it.act).split(/:(.*)/s);
    const click = sel => { const b = $(sel); if (b) b.click(); };
    switch (a) {
      case 'click': return click(arg);
      case 'templates': return welcomeMod().then(m => m.openTemplates(api));
      case 'template': return welcomeMod().then(m => m.applyTemplate(api, arg));
      case 'tour': return welcomeMod().then(m => m.startTour(api, { force: true }));
      case 'importCad': {
        const load = CAD['./cadimport.js']; if (!load) return;
        if (!ws.isOn()) ws.setMode(true);
        const m = await load(); if (typeof m.openCadImport === 'function') return m.openCadImport(ctx());
        return app.status(tl('Cette fonction n’est pas disponible dans cette version.'), 'warn');
      }
      case 'importImage': { const v = await view('plan'); return v && v.cmd && v.cmd.action('image'); }
      case 'importIfc': { if (!ws.isOn()) ws.setMode(true); const m = await IFC['./ifcimport.js'](); return m.openIfcImport && m.openIfcImport(ctx()); }
      case 'netbox': { const m = await NETBOX['./netbox.js'](); return m.openNetbox && m.openNetbox(ctx()); }
      case 'exportIfc': { const m = await IFC['./ifcexport.js'](); return m.exportIfc && m.exportIfc(ctx()); }
      case 'exportDwg': { const m = await DWG['./dwgexport.js'](); return m.exportDwg && m.exportDwg(ctx()); }
      case 'importVsdx': { if (!ws.isOn()) ws.setMode(true); const m = await VISIO['./vsdximport.js'](); return m.openVsdxImport && m.openVsdxImport(ctx()); }
      case 'exportVsdx': { const m = await VISIO['./visioexport.js'](); return m.exportVsdx && m.exportVsdx(ctx()); }
      case 'exportDrawio': { const m = await VISIO['./visioexport.js'](); return m.exportDrawio && m.exportDrawio(ctx()); }
      case 'exportXlsx': { const m = await XLSX['./xlsxui.js'](); return m.exportXlsx && m.exportXlsx(ctx()); }
      case 'importXlsx': { if (!ws.isOn()) ws.setMode(true); const m = await XLSX['./xlsxui.js'](); return m.openXlsxImport && m.openXlsxImport(ctx()); }
      case 'importPrices': { if (!ws.isOn()) ws.setMode(true); const m = await XLSX['./xlsxui.js'](); return m.openPriceImport && m.openPriceImport(ctx()); }
      case 'exportDxf': return external(DXF_NAMES);
      case 'exportPdf': return external(PDF_NAMES);
      case 'csv': return docAction('csv-' + arg);
      case 'doc': return docAction(arg);
      case 'svg-floor': { const f = env().floors.find(x => x.id === arg); return docAction('svg-floor', fake(arg, f ? f.name : arg)); }
      case 'svg-rack': { const r = env().racks.find(x => x.id === arg); return docAction('svg-rack', fake(arg, r ? r.name : arg)); }
      case 'plan': { const v = await view('plan'); if (!v || !v.cmd) return; return arg === 'selectAll' ? v.cmd.selectAll() : v.cmd.action(arg); }
      case 'tool': { const v = await view('plan'); return v && v.cmd && v.cmd.tool(arg); }
      case 'layer': { const v = await view('plan'); return v && v.cmd && v.cmd.layer(arg); }
      case 'ltool': return logicTool(arg);
      case 'sim': return app.commands.run(arg === 'vlan' ? 'net.sim.vlanview' : 'net.sim.passive');
      case 'rack': await view('racks'); return app.commands.run(arg === 'wall' ? 'net.rack.addWall' : 'net.rack.addFloor');
      case 'view': return view(arg);
      case 'design': return designTab(arg);
      case 'cfg': return config(arg);
      case 'cert': if (arg === 'open' && app.commands.run('net.cert.open')) return; if (arg === 'all' && app.commands.run('net.cert.all')) return; return import('./certui.js').then(m => m.openCert(ctx(), arg === 'all' ? { batch: true } : {}));
      case 'key': if (!ws.isOn()) return; document.body.dispatchEvent(new KeyboardEvent('keydown', { key: arg, code: arg, bubbles: true })); return;
      case 'deselect': return ctx().select(null);
      case 'inspector': if (app.setTab) app.setTab('nprop'); return;
      case 'fit': if (!ws.isOn()) ws.setMode(true); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true })); return;
      case 'lib': return app.setLibOpen(!app.libOpen());
      case 'libSearch': return libSearch();
      case 'place': return place(arg);
      case 'dock': return app.dock.toggle();
      case 'problems': return app.dock.show('problems');
      case 'output': return app.dock.show('output');
      case 'theme': return app.theme && app.theme.set(app.theme.get() === 'light' ? 'dark' : 'light');
      case 'keys': { if (!ws.isOn()) ws.setMode(true); requestAnimationFrame(() => { const b = [...document.querySelectorAll('.ntHost .ndDock [data-nd="help"]')].find(x => x.offsetParent); if (b) b.click(); }); return; }
      case 'palette': return app.commands.open && app.commands.open('');
      case 'labs': return app.openLabs && app.openLabs('net');
      case 'combo': return combo(arg);
      case 'rename': return rename();
      case 'url': return app.native && app.native.openExternal ? app.native.openExternal(LINKS[arg]) : window.open(LINKS[arg], '_blank', 'noopener');
      case 'about': return welcomeMod().then(m => m.about(api));
      case 'inspectorToggle': return setInspector(!insOpen());
      default: console.warn('menu: action inconnue', it.act);
    }
  }

  /* ---------- Barre de menus ---------- */
  let bar = null;
  const anchor = $('.appbar .abDoc');
  const buildBar = () => import('./menubar.js').then(m => {
    if (bar || !anchor) return;
    bar = m.createMenuBar({ after: anchor, model: () => menusFor(env()), run, keyLabel: k => keyLabel(k, MAC, isEn), label: tl('Menus du projet réseau'), more: tl('Menus'), when: on, keyFirst: onKeyFirst });
    bar.el.addEventListener('pointerdown', () => probe(), { once: false, passive: true });
  });
  buildBar();

  /* ---------- Palette de commandes : chaque entrée des menus (celles qui n'y sont pas déjà) ---------- */
  let visMemo = { t: -1, ids: new Set() };
  const visibleIds = () => {
    const t = Math.floor(performance.now() / 250);
    if (visMemo.t !== t) { let ids = new Set(); try { ids = new Set(flatItems(env()).filter(x => !x.disabled && !x.sub).map(x => x.id)); } catch (e) { console.error(e); } visMemo = { t, ids }; }
    return visMemo.ids;
  };
  function registerPalette() {
    const out = [], walk = (list, cat) => {
      for (const it of list) {
        if (it.sep || it.palette === false) continue;
        if (it.sub) { walk(typeof it.sub === 'function' ? it.sub({}) : it.sub, `${cat} ▸ ${it.label()}`); continue; } // « Fichier ▸ Exporter » : la palette trouve « export »
        if (it.cmd) continue;
        out.push({ id: 'net.menu.' + it.id, cat, icon: it.icon, label: it.label() + (it.desk && !(app.isDesktop && app.isDesktop()) ? ` (${tl('application de bureau')})` : ''), keys: keyLabel(it.keys, MAC, isEn), supersedes: SUPERSEDES[it.id], when: () => on() && visibleIds().has(it.id), run: () => run(it) });
      }
    };
    for (const m of MENUS) walk(m.items, m.label());
    app.commands.register(out);
  }
  registerPalette();

  /* ---------- Raccourcis du module ---------- */
  const GLOBAL = globalKeys();
  const busy = () => document.querySelector('.sDialogWrap, .sMenu, .nt-ov, .ntTour') || [...document.querySelectorAll('.modal')].some(m => !m.hidden) || (bar && bar.isOpen());
  onKeyFirst(e => {
    if (!on() || busy() || e.repeat) return false;
    const a = document.activeElement, typing = a && (/INPUT|SELECT|TEXTAREA/.test(a.tagName) || a.isContentEditable);
    for (const [k, id] of GLOBAL) {
      if (!matchKey(e, k)) continue;
      if (typing && !/^Mod\+P$/.test(k)) return false;
      const it = flatItems(env()).find(x => x.id === id); if (!it || it.disabled) return false;
      run(it); return true;
    }
    // Alt+1…4 depuis le montage d'un projet Objets connectés : la vue du plan réseau.
    if (!ws.isOn() && e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-4]$/.test(e.code) && !typing) { view(VIEW_IDS[+e.code.slice(5) - 1]); return true; }
    return false;
  });
  // Tab dans le plan de travail réseau : WebKit (Safari, l'application de bureau sur Mac) saute les boutons et les listes
  // si le réglage « naviguer au clavier » du système est coupé ; on garde donc nous-mêmes l'ordre du document, boutons
  // compris. Depuis un onglet de vue, Tab va au premier contrôle de la vue (pas aux autres onglets).
  const FOCUSABLE = 'button, select, input:not([type="hidden"]), textarea, a[href], summary, [tabindex]';
  const canFocus = el => el.tabIndex >= 0 && !el.disabled && el.offsetParent !== null && !el.closest('[hidden], [inert], .ndHelp') && getComputedStyle(el).visibility !== 'hidden';
  onKeyFirst(e => {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || !on() || !ws.isOn() || busy()) return false;
    const a = document.activeElement, host = document.querySelector('.ntHost');
    if (!host || !a || !host.contains(a)) return false;
    const list = [...document.querySelectorAll(FOCUSABLE)].filter(canFocus);
    let i = list.indexOf(a); if (i < 0) return false;
    if (!e.shiftKey && a.classList.contains('ntVTab')) { const tabs = list.filter(x => x.classList.contains('ntVTab')); i = list.indexOf(tabs[tabs.length - 1]); }
    const next = list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length];
    if (!next || next === a) return false;
    next.focus(); return true;
  });
  addHelpSection(() => (on() && ws.isOn() ? { title: tl('Projet réseau'), rows: shortcutRows(env()).concat([['F10', tl('Barre de menus')]]) } : null));
  // Raccourcis généraux de l'application, une fois pour toutes (aide « ? ») : même écriture que les menus.
  addHelpSection(() => (on() && ws.isOn() ? { title: tl('Général'), rows: [['Mod+S', tl('Enregistrer')], ['Mod+Z', tl('Annuler')], ['Mod+Shift+Z', tl('Rétablir')], ['Mod+C|Mod+V', tl('Copier, coller')], ['Mod+D', tl('Dupliquer')], ['F2', tl('Renommer')], ['Mod+B', tl('Bibliothèque')], ['Mod+J', tl('Panneau du bas')], ['Mod+Shift+P', tl('Palette de commandes')]] } : null));

  /* ---------- Inspecteur repliable (Affichage, Ctrl+Alt+B) ---------- */
  // Réglage retenu (« open » / « closed ») ; sans réglage, à 1366 px de large ou moins, la vue Conception (tableaux pleine
  // largeur) replie l'inspecteur d'elle-même.
  const INS_KEY = 'jollof-net-ins';
  const insPref = () => { try { return localStorage.getItem(INS_KEY); } catch (e) { return null; } };
  const insAuto = () => innerWidth <= 1366 && ws.isOn() && ws.view() === 'design';
  function insOpen() { const p = insPref(); return p ? p === 'open' : !insAuto(); }
  function applyIns() { $('.app').classList.toggle('ntInsClosed', on() && ws.isOn() && !insOpen()); }
  function setInspector(v) { try { localStorage.setItem(INS_KEY, v ? 'open' : 'closed'); } catch (e) { /* stockage indisponible */ } applyIns(); app.status(v ? tl('Inspecteur affiché.') : tl('Inspecteur replié : Ctrl+Alt+B ou Affichage pour le rouvrir.')); }
  addEventListener('resize', applyIns);

  /* ---------- Barre d'état : vue, étage, zoom, comptes ---------- */
  const sb = $('.statusbar'), counts = $('#counts');
  const sbEl = document.createElement('span'); sbEl.className = 'ntSb';
  sbEl.innerHTML = `<button type="button" class="ntSbBtn" data-sb="view" aria-haspopup="menu"></button><button type="button" class="ntSbBtn" data-sb="zoom" hidden></button><span class="ntSbCounts" data-sb="counts"></span>`;
  if (sb) (counts ? counts.before(sbEl) : sb.append(sbEl));
  const zooms = new Map(); let rafSb = 0; // zoom de chaque barre de navigation (par élément hôte de la vue)
  const VNAME = { logic: () => tl('Vue logique'), plan: () => tl('Plans'), racks: () => tl('Baies'), design: () => tl('Conception') }, VICON = { logic: 'network', plan: 'floorPlan', racks: 'rack', design: 'clipboard' };
  function paintSb() {
    rafSb = 0;
    markView(); // vue montrée sur .app (mise en page, inspecteur replié) : aussi après le chargement d'une vue
    const show = on() && ws.isOn(); sbEl.hidden = !show; if (!show) return;
    const v = ws.view(), d = ws.data() || {}, vb = sbEl.querySelector('[data-sb="view"]');
    let floor = '';
    if (v === 'plan' && objs.plan && objs.plan.cmd) { try { const f = objs.plan.cmd.floor(); if (f) floor = f.name || f.id; } catch (e) { /* rien */ } }
    vb.innerHTML = `${icon(VICON[v] || 'network')}<span>${esc(VNAME[v] ? VNAME[v]() : v)}${floor ? ' · ' + esc(floor) : ''}</span>`;
    vb.title = tl('Vue montrée : cliquer pour en changer ({0}…4)', keyLabel('Alt+1', MAC, isEn));
    const zb = sbEl.querySelector('[data-sb="zoom"]');
    // Zoom de la vue montrée : celui de sa barre de navigation visible ; aucune (Conception, vue d'ensemble des baies) : rien.
    let zoom = null; for (const [h, z] of zooms) if (h.isConnected && h.offsetParent && !h.closest('[hidden]') && h.querySelector(':scope > .ndDock:not([hidden])')) zoom = z;
    zb.hidden = zoom == null || v === 'design'; if (zoom != null) { zb.textContent = (isEn ? Math.round(zoom) + '%' : Math.round(zoom) + ' %'); zb.title = tl('Niveau de zoom : cliquer pour tout voir ou choisir un niveau'); }
    const dev = (d.devices || []).length, cab = (d.cables || []).length, rk = (d.racks || []).length;
    let rooms = 0; for (const b of (d.site && d.site.buildings) || []) for (const f of b.floors || []) rooms += (f.rooms || []).length;
    const parts = [tl('{0:# équipement|# équipements}', dev), tl('{0:# câble|# câbles}', cab)]; if (rooms) parts.push(tl('{0:# pièce|# pièces}', rooms)); if (rk) parts.push(tl('{0:# baie|# baies}', rk));
    sbEl.querySelector('[data-sb="counts"]').textContent = parts.join(' · ');
  }
  const paintSoon = () => { if (!rafSb) rafSb = requestAnimationFrame(paintSb); };
  onNavPaint(x => { if (!x.host || !x.host.closest || !x.host.closest('.ntHost')) return; if (zooms.get(x.host) !== x.zoom) { zooms.set(x.host, x.zoom); } paintSoon(); });
  // Vue changée (onglet, Alt+1…4, menus, chargement d'une vue) : la barre d'état suit, et .app porte la vue (mise en page).
  const vb = () => document.querySelector('.ntViewBar');
  const watchViews = () => { const b = vb(); if (b) new MutationObserver(() => { paintSoon(); markView(); }).observe(b, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] }); };
  function markView() { const a = $('.app'), v = ws.isOn() ? ws.view() : ''; for (const id of VIEW_IDS) a.classList.toggle('ntv-' + id, v === id); applyIns(); }
  watchViews(); markView();

  try { ctx().onChange(paintSoon); } catch (e) { /* rien */ }
  // Projet chargé (ouverture, exemple, restauration) : le message « Nouveau projet… » d'avant ne reste pas affiché.
  const NEW_MSG = new Set(Object.keys(KINDS).map(k => tl('Nouveau projet {0}.', KINDS[k].name().toLowerCase())));
  try { ctx().onChange(why => { if (why !== 'load') return; const st = $('#status'), d = ws.data() || {}; if (st && NEW_MSG.has(st.textContent.trim()) && ((d.devices || []).length || (d.site && (d.site.buildings || []).length))) setTimeout(() => app.status(tl('Projet ouvert : {0}', app.projectName ? app.projectName() : ''), 'ok'), 0); }); } catch (e) { /* rien */ } // nom du projet posé juste après le chargement
  addEventListener('click', paintSoon, true); addEventListener('keyup', paintSoon, true);
  new MutationObserver(paintSoon).observe($('.app'), { attributes: true, attributeFilter: ['class', 'data-kind'] });
  sbEl.addEventListener('click', async e => {
    const b = e.target.closest('[data-sb]'); if (!b) return;
    if (b.dataset.sb === 'view') {
      const v = await popMenu(b, VIEW_IDS.map((id, i) => ({ label: `${VNAME[id]()} · ${keyLabel('Alt+' + (i + 1), MAC, isEn)}`, icon: VICON[id], value: id, checked: ws.view() === id })));
      if (v) view(v);
    } else if (b.dataset.sb === 'zoom') { const p = [...document.querySelectorAll('.ntHost .ndDock .ndPct')].find(x => x.offsetParent); if (p) p.click(); }
  });
  paintSb();

  /* ---------- Type du projet ou langue changés : la barre suit ---------- */
  new MutationObserver(() => { if (bar) bar.refresh(); paintSoon(); }).observe($('.app'), { attributes: true, attributeFilter: ['data-kind'] });

  const api = {
    app, net, ws, ctx, view, run, env, status: (m, k) => app.status(m, k), cap,
    refresh() { if (bar) bar.refresh(); paintSoon(); },
    /** Nouveau projet de ce type (main.js, newProject) : les modèles, puis la visite la première fois. */
    welcome(k) { if (k === 'net') welcomeMod().then(m => m.welcome(api)).catch(e => console.error(e)); }
  };
  installed = api;
  return api;
}
