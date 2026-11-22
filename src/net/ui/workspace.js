// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Plan réseau : éditeur des équipements et des câbles (SVG), bibliothèque, inspecteur, outils (câble, testeur, ping),
// atelier de sertissage, navigateur du PC, broker MQTT, automate Modbus, table MAC. Chargé seulement quand le projet en
// a besoin (install.js). La simulation est celle de src/net/lan.js, partagée avec les programmes des cartes (projet
// Objets connectés : les modules Ethernet et les cartes Wi-Fi du montage y sont des nœuds).
import './net.css';
import { tl, isEn, CANCEL } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { createNavDock } from '../../ui/navdock.js';
import { spacesOf } from '../../ui/kind.js';
import { keyLabel as keyLabelNet } from '../menus.js';
const MAC_KEYS = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
import { menu as popMenu, confirm as confirmDlg, dialog as dialogDlg, toast } from '../../school/ui.js';
import { cleanText } from '../../sanitize.js';
import { createLan } from '../lan.js';
import { DEVICES, LIB_GROUPS, specOf, portsOf, newDevice } from '../devices.js';
import { MODEL_TYPES, modelLabel } from '../catalog.js';
import { indexOf as relIndex, walk as relWalk } from '../relate.js';
import { makeCable, CATS, CAT_IDS, analyzeCable } from '../cable.js';
import { cleanNet } from '../clean.js';
import { applyRoutes } from '../route.js';
import { netIssues, NET_SRC } from '../issues.js';
import { prefixOf, isIp, maskStr } from '../ip.js';
import { extNodes, whyText } from '../labcheck.js';
import { openCrimp, cableSvg, crimpVerdict } from './crimp.js';
import { openTester, testerSummary } from './tester.js';
import { isExam, examLocked, makeLock, checkLock, attempts, CODE_MIN } from '../exam.js';
import { explain } from '../../check/explain.js';
import { SOURCES } from '../../check/sources.js';
import '../../check/sources-net.js';
import { cleanHtml } from '../../sim/models.js';
import { kindOf, boardOf } from '../../sim/boards.js';
import { macOf } from '../../sim/models.js';
import { simPane, simPaneEvent, vlanDbPane, traceLines, autoArrange, vlanColor, roleText } from './simpane.js';
import { align as alignRects, distribute as distRects, copyOf, paste as pasteClip, freeName, guides as guideOf, inMarquee } from './logicux.js';
import { ctxMenu } from './kit/index.js';
import { portCfg, MANAGED } from '../vlan.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PORT_W = 12, PORT_H = 9, GRID = 10;
const snap = v => Math.round(v / GRID) * GRID;
const speedTxt = s => (s >= 10000 ? '10 Gb/s' : s >= 1000 ? '1 Gb/s' : s >= 100 ? '100 Mb/s' : s ? '10 Mb/s' : '');
const ledCls = l => (!l ? 'off' : !l.up ? 'down' : l.errors ? 'err' : l.speed >= 1000 ? 'g' : l.speed >= 100 ? 'f' : 'e');
const PREF = 'jollof-net-cable';
/**
 * Vues du projet réseau : un seul modèle (data), plusieurs vues. Logique : le schéma des équipements et des câbles
 * (ce fichier) ; Plans : site, étages, pièces, cheminements, prises, Wi-Fi (plan.js) ; Baies : élévations des baies
 * (racks.js) ; Conception : dimensionnement, étiquettes, tableaux, nomenclature, tests (design.js). Chargées à la demande.
 */
const VIEWS = [
  { id: 'logic', icon: 'network', name: () => tl('Vue logique'), tip: () => tl('Schéma logique : équipements, câbles, adresses') },
  { id: 'plan', icon: 'floorPlan', name: () => tl('Plans'), tip: () => tl('Plans d’étage : pièces, prises, cheminements, Wi-Fi') },
  { id: 'racks', icon: 'rack', name: () => tl('Baies'), tip: () => tl('Baies : élévations, brassage, puissance') },
  { id: 'design', icon: 'clipboard', name: () => tl('Conception'), tip: () => tl('Dimensionnement, étiquettes, tableaux, nomenclature, tests') }
];
const VIEW_MODS = { plan: () => import('./plan.js').then(m => m.createPlanView), racks: () => import('./racks.js').then(m => m.createRackView), design: () => import('./design.js').then(m => m.createDesignView) };

/** Positions des ports sur le dessin d'un équipement (repère local, origine en haut à gauche). */
const LAYOUTS = new Map(); // disposition des ports par type (quand les ports ne dépendent pas des réglages)
function portLayout(d, spec) {
  const fixed = spec.ports.length === 0 && !d.ext;
  if (fixed && LAYOUTS.has(d.type)) return LAYOUTS.get(d.type);
  const out = portLayout0(d, spec); if (fixed) LAYOUTS.set(d.type, out);
  return out;
}
function portLayout0(d, spec) {
  const ports = portsOf(d), w = spec.w, h = spec.h, out = new Map();
  const row = (list, y) => { const n = list.length, gap = Math.min(18, (w - 16) / Math.max(1, n)); const x0 = w / 2 - (gap * (n - 1)) / 2; list.forEach((p, i) => out.set(p.id, { x: x0 + i * gap, y })); };
  if (spec.role === 'passive') { row(ports.filter(p => !p.punch), h); row(ports.filter(p => p.punch), 0); }
  else if (spec.rows === 2) { row(ports.filter((p, i) => i % 2 === 0), 0); row(ports.filter((p, i) => i % 2 === 1), h); } // switch 48 ports : impairs en haut, pairs en bas
  else row(ports, h);
  return out;
}

export function createNetWorkspace(app, ui, raw) {
  const $ = s => document.querySelector(s), appEl = $('.app');
  let data = cleanNet(raw), on = false, fitted = false;
  let cur = 'logic'; const views = { logic: null }, viewLoads = {}; // vue montrée ; vues chargées
  let sel = null; // { kind: 'dev' | 'cable', id }
  let tool = 'select', pingFrom = null, pingOut = null, browser = null, crimpUi = null, testerUi = null;
  // Traceroute (outil R) : départ choisi, dernier résultat (sauts dessinés sur le schéma) ; couleurs des VLAN ; câblage passif caché.
  let traceFrom = null, traceOut = null, vlanView = false, hidePassive = false, legendMini = false;
  let legendAuto = false, legendPinned = false, legendFull = null, drawnBoxes = []; // légende repliée d'elle-même (legendCheck)
  try { const o = JSON.parse(localStorage.getItem('jollof-net-sim') || 'null'); if (o) { vlanView = !!o.vlan; hidePassive = !!o.passive; legendMini = !!o.legend; } } catch (e) { /* stockage indisponible */ }
  const saveSimPref = () => { try { localStorage.setItem('jollof-net-sim', JSON.stringify({ vlan: vlanView, passive: hidePassive, legend: legendMini })); } catch (e) { /* rien */ } };
  let cableDef = { kind: 'straight', cat: 'cat6', len: 3 };
  try { const v = JSON.parse(localStorage.getItem(PREF) || 'null'); if (v && CATS[v.cat]) cableDef = { ...cableDef, ...v }; } catch (e) { /* stockage indisponible */ }
  const view = { x: -40, y: -40, k: 1 };

  /* ---------- Réseau simulé ---------- */
  const comps = () => (spacesOf(app.kind()).includes('elec') ? app.comps() : []);
  const ext = () => {
    const list = extNodes(comps(), data.ext, c => (boardOf(c) ? kindOf(c) : c.type));
    // Place par défaut d'un nœud du montage : une colonne à gauche du plan.
    list.forEach((n, i) => { const k = n.id.slice(2); if (!data.ext[k] && !data.ext[n.id]) { n.x = -200; n.y = i * 90; } else { const p = data.ext[k] || data.ext[n.id]; n.x = p.x; n.y = p.y; } if (n.type === 'wifi') { const c = comps().find(x => 'e:' + x.id === n.id); if (c) n.mac = () => macOf(c); } });
    return list;
  };
  const lan = createLan({
    data: () => data, ext,
    sig: () => JSON.stringify(comps().map(c => (c.periph ? [c.periph.eth && c.periph.eth.ip, c.periph.wifi && c.periph.wifi.ip, c.periph.wifi && c.periph.wifi.lan] : 0))),
    plc: () => null,
    changed: () => { app.markDirty(); renderPane(); }
  });
  lan.on(e => {
    if (e.t === 'ping') return; // le journal du ping est écrit par son outil
    if (e.t === 'mqtt' && e.kind === 'publish') app.log(tl('MQTT · {0} : {1} = {2}', nameOf(e.node), e.topic, String(e.text).slice(0, 80)), 'info');
    else if (e.t === 'dhcp') app.log(tl('DHCP · {0} donne {1} à {2}', nameOf(e.node), e.ip, nameOf(e.to)), 'info');
    if (on) { if (e.t === 'mqtt' || e.t === 'modbus') renderPaneSoon(); }
  });
  const nameOf = id => { const n = lan.state().byId.get(id); return n ? n.name || specOf(n).name() : id; };

  /* ---------- Historique (Ctrl+Z) ---------- */
  const H = { undo: [], redo: [] };
  // Les images des plans importés restent hors de l'historique (lourdes, et une image ne s'annule pas).
  // Les données binaires des fonds DXF/DWG (blobs) aussi : seuls leurs réglages (underlays) sont dans l'historique.
  const snapData = () => JSON.stringify(data, (k, v) => (k === 'images' || k === 'blobs' ? undefined : v)); // (snap : la grille du dessin)
  let snapshot = snapData();
  function commit() {
    const s = snapData(); if (s === snapshot) return;
    H.undo.push(snapshot); if (H.undo.length > 120) H.undo.shift(); H.redo = []; snapshot = s;
    changed();
  }
  function travel(from, to) {
    if (!from.length) return;
    const images = data.images, blobs = data.blobs;
    to.push(snapData()); data = cleanNet({ ...JSON.parse(from.pop()), images, blobs }); data.view = 'net'; snapshot = snapData();
    // Équipement ou câble disparu : plus de sélection (les autres vues vérifient leurs propres objets).
    if (sel && (sel.kind === 'dev' || sel.kind === 'cable') && !(sel.kind === 'dev' ? findDev(sel.id) || sel.id.startsWith('e:') : data.cables.some(c => c.id === sel.id))) sel = null;
    msel = sel ? [sel] : []; MS = null;
    changed(); app.status(tl('Annulé ou rétabli.'));
  }
  const history = { undo: () => travel(H.undo, H.redo), redo: () => travel(H.redo, H.undo), canUndo: () => H.undo.length > 0, canRedo: () => H.redo.length > 0 };
  function changed() {
    applyRoutes(data); // longueurs réelles des câbles au tracé automatique (plans, cheminements)
    lan.refresh(); render(); renderPane(); counts(); viewsChanged(); app.markDirty(); if (app.recheck) app.recheck(); if (on) app.historyUI();
    if (data.devices.length && app.ensureSpace) app.ensureSpace('net');
  }
  // Équipement par identifiant : index refait quand la liste change (un grand plan en demande des milliers par dessin).
  const DX = { arr: null, len: -1, map: new Map() };
  const findDev = id => {
    if (DX.arr !== data.devices || DX.len !== data.devices.length) { DX.arr = data.devices; DX.len = data.devices.length; DX.map = new Map(data.devices.map(d => [d.id, d])); }
    const d = DX.map.get(id); if (d && d.id === id) return d;
    return data.devices.find(x => x.id === id) || null;
  };
  const nodeById = id => lan.state().byId.get(id) || null;

  /* ---------- Plan de travail ---------- */
  const host = document.createElement('div'); host.className = 'ntHost'; host.hidden = true;
  $('#stage').appendChild(host);
  host.innerHTML = `
    <h2 class="sr">${tl('Réseau')}</h2><div class="ntViewBar"><div class="ntVTabs" role="tablist" aria-label="${tl('Vues du projet réseau')}">${VIEWS.map(v => `<button type="button" role="tab" class="ntVTab" data-view="${v.id}" aria-selected="${v.id === 'logic'}" data-tip="${esc(v.tip())} · ${keyLabelNet('Alt+' + (VIEWS.indexOf(v) + 1), MAC_KEYS)}">${icon(v.icon)}<span>${esc(v.name())}</span></button>`).join('')}</div></div>
    <button type="button" class="ntExam" data-exam hidden>${icon('lock')}<span>${tl('Mode examen')}</span></button>
    <div class="ntVw ntLogic">
    <div class="ntView"><svg class="ntSvg" xmlns="http://www.w3.org/2000/svg"><g class="ntWorld"><g class="ntCables"></g><g class="ntWifi"></g><g class="ntDevs"></g><g class="ntOver"></g></g></svg></div>
    <div class="ntBar top">
      <div class="seg glass ntTools" role="group" aria-label="${tl('Outils du plan réseau')}">
        <button type="button" class="segBtn" data-tool="select" data-tip="${tl('Choisir et déplacer · V. Glisser d’un port à un autre : tirer un câble.')}">${icon('pointer')}<span>${tl('Choisir')}</span></button>
        <button type="button" class="segBtn" data-tool="cable" data-tip="${tl('Câble · C : cliquer un port puis un autre')}">${icon('cable')}<span>${tl('Câble')}</span></button>
        <button type="button" class="segBtn" data-tool="tester" data-tip="${tl('Testeur de câble · T : cliquer un câble ou un port')}">${icon('cableTester')}<span>${tl('Testeur')}</span></button>
        <button type="button" class="segBtn" data-tool="ping" data-tip="${tl('Ping · P : cliquer l’appareil de départ puis celui d’arrivée')}">${icon('ping')}<span>Ping</span></button>
        <button type="button" class="segBtn" data-tool="trace" data-tip="${tl('Traceroute · R : cliquer l’appareil de départ puis la destination ; les routeurs traversés sont numérotés')}">${icon('traceroute')}<span>Traceroute</span></button>
      </div>
      <div class="seg glass ntSimBar" role="group" aria-label="${tl('Affichage du schéma')}">
        <button type="button" class="segBtn" data-simv="vlan" data-tip="${tl('Couleur des câbles par VLAN (trunks en violet), ports bloqués par le Spanning Tree')}">${icon('vlanTag')}<span>VLAN</span></button>
        <button type="button" class="segBtn" data-simv="passive" data-tip="${tl('Cacher le câblage passif (prises, panneaux) : un trait direct de port actif à port actif')}">${icon('patchPanel')}<span>${tl('Passifs')}</span></button>
        <button type="button" class="segBtn" data-simv="arrange" data-tip="${tl('Disposition automatique : cœur, distribution, accès, postes')}">${icon('treeLayout')}<span>${tl('Ranger')}</span></button>
      </div>
      <div class="glass ntDef" aria-label="${tl('Câble neuf')}">
        <label><span>${tl('Câble neuf')}</span><select class="sel" data-def="kind">
          <option value="straight">${tl('droit (T568B, serti)')}</option><option value="crossover">${tl('croisé (T568A-T568B)')}</option><option value="blank">${tl('à sertir soi-même')}</option></select></label>
        <select class="sel" data-def="cat" aria-label="${tl('Catégorie')}">${CAT_IDS.map(k => `<option value="${k}">${CATS[k].name}</option>`).join('')}</select>
        <label class="ntLen"><input class="inp" data-def="len" type="number" min="0.5" max="300" step="0.5" aria-label="${tl('Longueur (m)')}"><span>m</span></label>
      </div>
      <span class="grow"></span>
    </div>
    <div class="ntBar bottom"><div class="ntLegend glass" data-tip="${tl('Légende · clic : la replier ou la déplier')}"><span><i class="g"></i>1 Gb/s</span><span><i class="f"></i>100 Mb/s</span><span><i class="e"></i>10 Mb/s</span><span data-tip="${tl('Lien établi mais des trames se perdent (câble trop long, paire séparée)')}"><i class="err"></i>${tl('erreurs de trames')}</span><span data-tip="${tl('Câble branché sans lien : appareil éteint, prise sans appareil au bout, câble défectueux')}"><i class="down"></i>${tl('pas de lien')}</span><span><i class="poe"></i>PoE</span></div><span class="grow"></span><span class="ntHint glass"></span></div>
    <div class="ntEmpty"><div class="ntEmptyCard">${icon('network')}<b>${tl('Plan réseau')}</b>
      <p>${tl('Glissez une box, un switch et des PC depuis la bibliothèque, puis tirez des câbles de port en port. Cliquez un câble pour le sertir ou le tester, un PC pour régler son adresse IP et faire un ping.')}</p>
      <div class="ntEmptyGo">
        <button type="button" class="ntEmptyAct" data-starter>${icon('wand')}<b>${tl('Petit réseau de départ')}</b><small>${tl('Une box, un switch, deux PC, câblés')}</small></button>
        <button type="button" class="ntEmptyAct" data-starter="pro">${icon('vlanTag')}<b>${tl('Réseau d’entreprise')}</b><small>${tl('Cœur de niveau 3, switch d’accès, trois VLAN, serveur DHCP')}</small></button>
        <button type="button" class="ntEmptyAct" data-labs>${icon('checklist')}<b>${tl('TP de réseau')}</b><small>${tl('Pas à pas, vérifiés tout seuls')}</small></button>
      </div>
      <p class="ntEmptyKeys">${tl('Clic droit : menu · Glisser sur le fond : encadrer · ? : raccourcis')}</p></div></div>
    </div>`;
  const logicEl = host.querySelector('.ntLogic');
  const svg = host.querySelector('.ntSvg'), world = host.querySelector('.ntWorld'), gCab = host.querySelector('.ntCables'), gWifi = host.querySelector('.ntWifi'), gDev = host.querySelector('.ntDevs'), gOver = host.querySelector('.ntOver');
  const hint = host.querySelector('.ntHint');
  const defEl = k => host.querySelector(`[data-def="${k}"]`);
  defEl('kind').value = cableDef.kind; defEl('cat').value = cableDef.cat; defEl('len').value = cableDef.len;
  host.querySelector('.ntDef').addEventListener('change', () => {
    cableDef = { kind: defEl('kind').value, cat: defEl('cat').value, len: Math.max(0.5, Math.min(300, +defEl('len').value || 3)) };
    try { localStorage.setItem(PREF, JSON.stringify(cableDef)); } catch (e) { /* rien */ }
  });
  host.addEventListener('click', e => {
    const vt = e.target.closest('.ntViewBar [data-view]'); if (vt) { openView(vt.dataset.view); return; }
    if (e.target.closest('[data-exam]')) { setExam(false); return; }
    if (!logicEl.contains(e.target)) return; // les autres vues gèrent leurs clics
    const t = e.target.closest('[data-tool]'); if (t) { setTool(t.dataset.tool); return; }
    if (e.target.closest('[data-labs]')) { if (app.openLabs) app.openLabs('net'); return; }
    const stb = e.target.closest('[data-starter]'); if (stb) { if (stb.dataset.starter === 'pro') starterPro(); else starter(); }
    const sv = e.target.closest('[data-simv]'); if (sv) simView(sv.dataset.simv);
    const lg = e.target.closest('.ntLegend');
    if (lg) { if (!legendMini && legendAuto && !legendPinned) legendPinned = true; else { legendMini = !legendMini; legendPinned = false; saveSimPref(); } paintLegend(); }
  });
  function setTool(t) {
    tool = t; pingFrom = null; traceFrom = null;
    host.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    host.classList.toggle('toolCable', t === 'cable'); host.classList.toggle('toolTester', t === 'tester'); host.classList.toggle('toolPing', t === 'ping'); host.classList.toggle('toolTrace', t === 'trace');
    paintHint(); render();
  }
  function paintHint() {
    hint.textContent = tool === 'cable' ? (rubber ? tl('Cliquez le port d’arrivée (Échap : annuler).') : tl('Cliquez un port libre : le câble part de là.'))
      : tool === 'tester' ? tl('Cliquez un câble (ou un port) pour le passer au testeur.')
        : tool === 'ping' ? (pingFrom ? tl('Ping depuis {0} : cliquez l’appareil à joindre.', nameOf(pingFrom)) : tl('Cliquez l’appareil qui envoie le ping.'))
          : tool === 'trace' ? (traceFrom ? tl('Traceroute depuis {0} : cliquez la destination.', nameOf(traceFrom)) : tl('Cliquez l’appareil d’où part le traceroute.'))
          : tl('Glisser un appareil : le déplacer · d’un port à un autre : un câble · sur le fond : encadrer · clic droit : menu');
  }
  /** Petit réseau pour commencer : une box, un switch, deux PC, câblés. */
  /** Réseau d'entreprise pour commencer : cœur de niveau 3 (SVI, relais DHCP), switch d'accès, trois VLAN, serveur. */
  function starterPro() {
    const used = new Set(data.devices.map(d => d.name));
    const add = (type, x, y, p = {}) => { const d = newDevice(type, used, { x, y }); d.id = freeId(type); used.add(d.name); Object.assign(d.p, p); data.devices.push(d); return d; };
    const V = [[10, tl('Bureaux')], [20, tl('Atelier')], [30, tl('Invités')]];
    const core = add('l3switch', 0, 0, { stp: { on: true, prio: 4096 }, ports: { p1: { mode: 'trunk', allowed: '10,20,30' }, p2: { vlan: 99 } }, svis: [...V.map(([v]) => ({ vlan: v, ip: `10.0.${v}.1`, prefix: 24, helper: '10.0.99.10' })), { vlan: 99, ip: '10.0.99.1', prefix: 24 }] });
    const srv = add('server', 460, 140, { ip: { mode: 'static', ip: '10.0.99.10', prefix: 24, gw: '10.0.99.1', dns: '' }, dhcp: V.map(([v]) => ({ net: `10.0.${v}.0/24`, from: `10.0.${v}.100`, to: `10.0.${v}.199`, gw: `10.0.${v}.1`, dns: '', on: true })) });
    const sw = add('switch24', 0, 180, { ports: { p1: { vlan: 10 }, p2: { vlan: 20 }, p3: { vlan: 30 }, p24: { mode: 'trunk', allowed: '10,20,30' } } });
    const pcs = [add('pc', -10, 360), add('pc', 120, 360), add('laptop', 250, 360)];
    addCable([sw.id, 'p24'], [core.id, 'p1'], { len: 15 }); addCable([srv.id, 'eth0'], [core.id, 'p2'], { len: 2 });
    pcs.forEach((pc, i) => addCable([pc.id, 'eth0'], [sw.id, 'p' + (i + 1)], { len: 5 }));
    data.vlans = [...V.map(([id, name]) => ({ id, name, net: `10.0.${id}.0/24`, gw: `10.0.${id}.1` })), { id: 99, name: tl('Serveurs'), net: '10.0.99.0/24', gw: '10.0.99.1' }];
    for (const d of [core, sw, srv]) { const sp = DEVICES[d.type]; if (sp.clean) d.p = sp.clean(d.p, sp.props()); }
    vlanView = true; saveSimPref();
    commit(); fit();
  }
  function starter() {
    const used = new Set(data.devices.map(d => d.name));
    const add = (type, x, y) => { const d = newDevice(type, used, { x, y }); d.id = freeId(type); used.add(d.name); data.devices.push(d); return d; };
    const box = add('router', 0, 0), sw = add('switch', -15, 140), a = add('pc', -60, 280), b = add('pc', 80, 280);
    addCable([box.id, 'lan1'], [sw.id, 'p1']); addCable([a.id, 'eth0'], [sw.id, 'p3']); addCable([b.id, 'eth0'], [sw.id, 'p5']);
    commit(); fit();
  }
  const freeId = type => { const p = (DEVICES[type].prefix || 'n').toLowerCase(); let i = 1; while (data.devices.some(d => d.id === p + i)) i++; return p + i; };
  function addCable(a, b, o = {}) {
    let id = 'c1', i = 1; while (data.cables.some(c => c.id === id)) id = 'c' + ++i;
    const c = { id, a, b, cat: o.cat || cableDef.cat, len: o.len || cableDef.len, wire: makeCable(o.kind || cableDef.kind) };
    data.cables.push(c); return c;
  }

  /* ---------- Dessin ---------- */
  const nodes = () => { const st = lan.state(); return st.all; };
  /**
   * Nom dans le corps d'un appareil : réduit pour tenir dans la largeur w (jusqu'à 7 px), puis abrégé « … » ; le nom
   * entier reste au survol. Sans cela, un nom long déborde sous l'appareil voisin et paraît coupé (« PR- »).
   */
  function nameIn(nm, x, y, w, cls) {
    const est = nm.length * 6.2, fsz = est <= w ? 0 : Math.max(7, 10.5 * w / est);
    let t = nm;
    if (fsz && nm.length * fsz * 0.59 > w) { const keep = Math.max(3, Math.floor(w / (fsz * 0.59)) - 1); t = nm.slice(0, keep) + '…'; }
    return `${t !== nm ? `<title>${esc(nm)}</title>` : ''}<text class="ntName${cls ? ' ' + cls : ''}" x="${x}" y="${y}"${fsz ? ` style="font-size:${fsz.toFixed(1)}px"` : ''}>${esc(t)}</text>`;
  }
  // Groupe déplié (focus) : positions provisoires de ses appareils, le modèle n'est pas modifié.
  let focus = null;
  const posOf = n => (focus && focus.pos.has(n.id) ? focus.pos.get(n.id) : n.ext ? n : findDev(n.id) || n);
  function portPos(n, pid) { const s = specOf(n), p = portLayout(n, s).get(pid), q = posOf(n); return p ? { x: q.x + p.x, y: q.y + p.y } : { x: q.x + s.w / 2, y: q.y + s.h / 2 }; }
  function applyView() {
    world.setAttribute('transform', `translate(${-view.x * view.k} ${-view.y * view.k}) scale(${view.k})`);
    const v = host.querySelector('.ntView'), g = 20 * view.k;
    v.style.setProperty('--gk', g + 'px'); v.style.setProperty('--gx', (-view.x * view.k) % g + 'px'); v.style.setProperty('--gy', (-view.y * view.k) % g + 'px');
    if (nav) nav.update();
    // Grand plan : on ne dessine que ce qui est autour de la vue ; sortie de cette zone, ou changement de niveau de détail :
    // nouveau dessin à l'image suivante.
    if (drawn && (drawn.lod !== lodOf() || !inside(viewRect(0), drawn.rect))) renderSoon();
    legendCheck();
  }
  /** Rectangle du monde visible, agrandi de margin écrans de chaque côté. */
  function viewRect(margin) {
    const r = rectOf(), w = (r.width || 1200) / view.k, h = (r.height || 800) / view.k;
    return { x0: view.x - w * margin, y0: view.y - h * margin, x1: view.x + w * (1 + margin), y1: view.y + h * (1 + margin) };
  }
  const inside = (a, b) => a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1;
  /** Niveau de détail : 0 vue d'ensemble (ports simplifiés, pas d'étiquettes de câble), 1 normal. */
  // Zoom sémantique : 2 détail complet ; 1 (< 60 %) ports en pavés, sans longueurs de câble, noms à taille lisible ;
  // 0 (< 30 %) vue d'ensemble : prises et panneaux cachés, postes regroupés sous leur switch (un bloc « 24 appareils »
  // relié par un seul trait épais), noms à 11 px à l'écran sans chevauchement.
  // Niveaux de détail : 0 vue d'ensemble (blocs), 1 noms seuls, 2 détail, 3 détail et longueurs des câbles (zoom ≥ 120 %).
  const lodOf = () => (view.k < 0.42 ? 0 : view.k < 0.7 ? 1 : view.k < 1.2 ? 2 : 3);
  let drawn = null, rafR = 0;
  const renderSoon = () => { if (!rafR) rafR = requestAnimationFrame(() => { rafR = 0; render(); }); };
  /** Plus de 150 équipements : dessin limité à la vue (et une marge d'un écran). */
  const CULL = 150;
  function render() {
    if (!on || cur !== 'logic') return;
    const st = lan.state();
    host.querySelector('.ntEmpty').hidden = st.all.length > 0;
    counts();
    // Index du dessin (un grand plan : des milliers de ports et de câbles) : câble de chaque port, adresse de chaque nœud.
    cabIdx = new Map(); for (const cb of data.cables) { cabIdx.set(cb.a[0] + '|' + cb.a[1], cb); cabIdx.set(cb.b[0] + '|' + cb.b[1], cb); }
    const ipIdx = new Map(); for (const x of st.ifaces) if (!ipIdx.has(x.node) && (x.role === 'host' || x.role === 'lan' || (x.role === 'l3' && x.ip))) ipIdx.set(x.node, x);
    const isPassive = id => { const n = nodeById(id); return !!n && specOf(n).role === 'passive'; };
    // Équipements (grand plan : seulement autour de la vue).
    const cull = st.all.length > CULL, area = viewRect(1), zl = lodOf(), lod = zl >= 2 ? 1 : 0;
    drawn = { rect: cull ? area : { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 }, lod: zl };
    const hideP = hidePassive || zl === 0 || !!focus; // vue d'ensemble, groupe déplié : câblage passif caché d'office
    // Vue d'ensemble : appareils terminaux (postes, points d'accès, caméras…) regroupés sous le switch où mène leur câble.
    const grouped = new Map(), groups = new Map();
    // Groupe déplié : seuls le switch et ses appareils sont dessinés (les autres passent pour « regroupés »).
    // (les passifs, cachés d'office, restent hors de « grouped » : leurs câbles donnent les traits directs switch → appareil)
    if (focus) { for (const n of st.all) if (!focus.ids.has(n.id) && specOf(n).role !== 'passive') grouped.set(n.id, '_f'); }
    else if (zl === 0) {
      for (const n of st.all) {
        const s0 = specOf(n); if (s0.role !== 'host' && s0.role !== 'ap') continue;
        if (sel && sel.id === n.id) continue;
        let far = null; for (const pid of portsOf(n).map(p => p.id)) { const ch = st.chans.get(n.id + '|' + pid); if (ch && ch.far) { far = ch.far.n; break; } }
        const fn = far && nodeById(far); if (!fn || specOf(fn).role !== 'switch') continue;
        if (!groups.has(far)) groups.set(far, []); groups.get(far).push(n);
      }
      for (const [k, list] of groups) { if (list.length < 3) { groups.delete(k); continue; } for (const n of list) grouped.set(n.id, k); }
    }
    // Noms à une taille lisible à l'écran (petits zooms) ; une étiquette qui en chevaucherait une autre est omise.
    const fs = zl < 2 ? Math.max(10.5, 11 / view.k) : 0, taken = new Set();
    // Grille écran : cases prises par les noms (taken) et par les corps d'appareils (bodies, case → id).
    const GW = 24, GH = 12, bodies = new Map();
    const labelOk = (x, y, w, id) => {
      if (!fs) return true;
      const sx = (x - view.x) * view.k, sy = (y - view.y) * view.k, wpx = w * view.k;
      const cells = []; for (let cx = Math.floor((sx - wpx / 2) / GW); cx <= Math.floor((sx + wpx / 2) / GW); cx++) cells.push(cx + ':' + Math.floor(sy / GH));
      if (cells.some(c2 => taken.has(c2) || (bodies.has(c2) && bodies.get(c2) !== id))) return false; cells.forEach(c2 => taken.add(c2)); return true;
    };
    const markBody = (x, y, w, hh, id) => {
      const sx0 = Math.floor(((x - view.x) * view.k) / GW), sx1 = Math.floor(((x + w - view.x) * view.k) / GW);
      const sy0 = Math.floor(((y - view.y) * view.k + 3) / GH), sy1 = Math.floor(((y + hh - view.y) * view.k - 3) / GH);
      for (let cx = sx0; cx <= sx1; cx++) for (let cy = sy0; cy <= sy1; cy++) { const k2 = cx + ':' + cy; bodies.set(k2, bodies.has(k2) && bodies.get(k2) !== id ? '*' : id); }
    };
    const vis = (x, y, w, hh) => !cull || (x + w >= area.x0 && x <= area.x1 && y + hh >= area.y0 && y <= area.y1);
    // Priorité des noms au petit zoom : routeurs et cœur, puis switchs, puis le reste.
    const showName = new Map(); // id → 't' (dessus) | 'b' (dessous) | 'r' (droite) | 'l' (gauche)
    if (fs) {
      const rank = n => { const r = specOf(n).role; return r === 'router' || r === 'l3' || n.type === 'l3switch' ? 0 : r === 'switch' ? 1 : r === 'passive' ? 3 : 2; };
      const cand = [];
      for (const n of st.all) {
        const s1 = specOf(n); if (s1.role === 'mech' || (hideP && s1.role === 'passive') || grouped.has(n.id)) continue;
        const q = posOf(n); if (!vis(q.x, q.y, s1.w, s1.h)) continue;
        markBody(q.x, q.y, s1.w, s1.h, n.id); cand.push(n);
      }
      for (const n of cand.sort((a, b) => rank(a) - rank(b))) {
        const s1 = specOf(n), q = posOf(n), nm = n.name || s1.name();
        const tw = nm.length * fs * 0.62, pad = 6 / view.k, my = q.y + s1.h / 2;
        if (labelOk(q.x + s1.w / 2, q.y - fs * 0.8, Math.max(s1.w, tw), n.id)) showName.set(n.id, 't');
        else if (labelOk(q.x + s1.w / 2, q.y + s1.h + fs * 0.8, tw, n.id)) showName.set(n.id, 'b');
        else if (labelOk(q.x + s1.w + pad + tw / 2, my, tw, n.id)) showName.set(n.id, 'r');
        else if (labelOk(q.x - pad - tw / 2, my, tw, n.id)) showName.set(n.id, 'l');
      }
    }
    let h = ''; drawnBoxes = [];
    for (const n of st.all) {
      const s = specOf(n), q = posOf(n), pw = st.power.get(n.id), off = pw && !pw.on;
      if (s.role === 'mech') continue; // équipement de baie sans rôle réseau : vue Baies seulement
      if (hideP && s.role === 'passive') continue; // câblage passif caché : traits directs plus bas
      if (grouped.has(n.id)) continue; // vue d'ensemble : dans le bloc de son switch
      if (!vis(q.x, q.y - 20, s.w, s.h + 40) && !(sel && sel.id === n.id)) continue;
      const f = ipIdx.get(n.id);
      drawnBoxes.push([q.x, q.y, s.w, s.h]);
      const isSel = (sel && sel.kind === 'dev' && sel.id === n.id) || mselHas('dev', n.id), isPing = pingFrom === n.id || traceFrom === n.id;
      h += `<g class="ntDev${isSel ? ' sel' : ''}${off ? ' off' : ''}${n.ext ? ' ext' : ''}${isPing ? ' pingFrom' : ''}${traceFrom === n.id ? ' traceFrom' : ''} r-${s.role}" data-id="${esc(n.id)}" transform="translate(${q.x} ${q.y})">`;
      h += `<rect class="ntBody" width="${s.w}" height="${s.h}" rx="8"/>`;
      // Icône, nom, puis l'adresse IP dans le corps de l'appareil (les ports sont sur ses bords).
      const ip = f && f.ip ? f.ip : '', small = s.h < 56 || s.role === 'switch' || s.role === 'passive';
      if (fs) {
        // Petit zoom : icône au centre, nom au-dessus, à taille lisible, s'il ne chevauche pas un autre nom (les plus
        // importants d'abord : voir la passe de priorité plus haut).
        const isz = Math.min(s.h - 8, 30);
        h += icon(s.icon).replace('<svg class="ic"', `<svg class="ic ntIc" x="${s.w / 2 - isz / 2}" y="${s.h / 2 - isz / 2}" width="${isz}" height="${isz}"`);
        const side = showName.get(n.id);
        if (!side) h += `<title>${esc(n.name || s.name())}</title>`; // nom omis (chevauchement) : au survol
        if (side) {
          const pad = 6 / view.k, tx = side === 't' || side === 'b' ? s.w / 2 : side === 'r' ? s.w + pad : -pad, ty = side === 't' ? -fs * 0.35 : side === 'b' ? s.h + fs * 1.05 : s.h / 2 + fs * 0.35;
          h += `<text class="ntName ntNameZ" x="${tx}" y="${ty}" style="font-size:${fs.toFixed(1)}px;stroke-width:${(fs * 0.28).toFixed(1)}px${side === 't' || side === 'b' ? '' : side === 'r' ? ';text-anchor:start' : ';text-anchor:end'}">${esc(n.name || s.name())}</text>`;
        }
      } else if (small && s.w < 90 && !ip) {
        // Corps étroit (prise) : petite icône en haut, nom sur toute la largeur dessous.
        h += icon(s.icon).replace('<svg class="ic"', `<svg class="ic ntIc" x="${s.w / 2 - 8}" y="5" width="16" height="16"`);
        h += nameIn(n.name || s.name(), s.w / 2, s.h - 9, s.w - 6, '');
      } else if (small) {
        h += icon(s.icon).replace('<svg class="ic"', `<svg class="ic ntIc" x="${10}" y="${s.h / 2 - 10}" width="20" height="20"`);
        h += nameIn(n.name || s.name(), 36, s.h / 2 + (ip ? 0 : 4), s.w - 36 - 6, 'left');
        if (ip) h += `<text class="ntIp left${f.src === 'apipa' ? ' bad' : ''}" x="${36}" y="${s.h / 2 + 12}">${esc(ip)}</text>`;
      } else {
        h += icon(s.icon).replace('<svg class="ic"', `<svg class="ic ntIc" x="${s.w / 2 - 11}" y="5" width="22" height="22"`);
        h += nameIn(n.name || s.name(), s.w / 2, ip ? s.h - 21 : s.h - 14, s.w - 8, '');
        if (ip) h += `<text class="ntIp${f.src === 'apipa' ? ' bad' : ''}" x="${s.w / 2}" y="${s.h - 9}">${esc(ip)}</text>`;
      }
      if (off) h += `<text class="ntTag bad" x="${s.w / 2}" y="${-7}">${tl('éteint')}</text>`;
      else if (s.role === 'ap' || (n.type === 'router' && n.p.wifi && n.p.wifi.on)) h += `<text class="ntSsid" x="${s.w / 2}" y="${-7}">« ${esc(st.ssidOf(n))} »</text>`;
      const plist = new Map(portsOf(n).map(x => [x.id, x]));
      for (const [pid, p] of portLayout(n, s)) {
        const l = lan.port(n.id, pid), port = plist.get(pid), cab = cableAt(n.id, pid);
        if (!lod) { h += `<rect class="ntPort ntPortS ${port.passive ? 'pass' : ledCls(l)}" data-port="${esc(pid)}" x="${p.x - PORT_W / 2}" y="${p.y - PORT_H / 2}" width="${PORT_W}" height="${PORT_H}"/>`; continue; } // vue d'ensemble : un simple pavé
        // Port bloqué (Spanning Tree, agrégat en attente) : une barre en travers.
        // Rapid PVST+ : bloqué pour certains VLAN seulement → marque partielle, VLAN listés dans la bulle.
        if (l && l.up && s.managed) {
          const bv = st.l2.blocked(n.id, pid), all = st.l2.portVlans(n, pid).length, lm = st.l2.member.get(n.id + '|' + pid), sb = lm && (lm.state === 'standby' || lm.state === 'suspended');
          if (bv.length || sb) blk.push([q.x + p.x, q.y + p.y, `${port.label} · ${sb ? tl('port bloqué') : roleText(lan.l2port(n.id, pid, bv[0]).role)}${bv.length && !sb ? ' · VLAN ' + bv.join(', ') : ''}`, !sb && bv.length < all]);
        }
        const poeOn = port.poe === 'pse' && st.poe.get(n.id) && st.poe.get(n.id).ports.some(x => x.port === pid && !x.denied);
        h += `<g class="ntPort${cab ? ' used' : ''}${port.punch ? ' punch' : ''}" data-port="${esc(pid)}" transform="translate(${p.x - PORT_W / 2} ${p.y - PORT_H / 2})"><title>${esc(port.label)}${l ? ' · ' + (l.up ? speedTxt(l.speed) : tl('pas de lien')) : ''}</title>`
          + `<rect width="${PORT_W}" height="${PORT_H}" rx="2"/>${port.passive ? '' : `<circle class="led ${ledCls(l)}" cx="${PORT_W / 2}" cy="${PORT_H / 2}" r="2.3"/>`}${poeOn ? `<rect class="poeMark" x="-1" y="-1" width="${PORT_W + 2}" height="${PORT_H + 2}" rx="3"/>` : ''}</g>`;
        if (pid === 'wan') h += `<text class="ntPl" x="${p.x}" y="${p.y + 16}">WAN</text>`;
      }
      h += '</g>';
    }
    legendCheck();
    gDev.innerHTML = h + blk.map(([x, y, t, part]) => `<line class="ntBlk${part ? ' part' : ''}" x1="${x - 7}" y1="${y + 6}" x2="${x + 7}" y2="${y - 6}"><title>${esc(t)}</title></line>`).join('');
    blk.length = 0;
    // VLAN d'un câble (couleurs) : le canal qui le contient, et le port du switch administrable au bout.
    const chanOf = new Map();
    if (vlanView || hideP) for (const [k, ch] of st.chans) if (ch.far) for (const cb of ch.cables) if (!chanOf.has(cb.id)) chanOf.set(cb.id, [k.split('|'), [ch.far.n, ch.far.p]]);
    const vlanCls = cb => {
      const e = chanOf.get(cb.id); if (!vlanView || !e) return '';
      let cls = '', blocked = false;
      for (const [n, p] of e) {
        const d = nodeById(n); if (!d) continue;
        if (specOf(d).managed) { const c2 = portCfg(d, p), l = lan.port(n, p); if (l && l.up && st.l2.blocked(n, p).length >= st.l2.portVlans(d, p).length) blocked = true; if (!cls || c2.mode === 'trunk') cls = c2.mode === 'trunk' ? ' vl trunk' : ` vl" style="--vc:${vlanColor(data, c2.vlan)}`; }
        else if (d.type === 'routerpro' && ((d.p || {}).ifs || []).some(f => f.port === p && f.vlan) && !cls) cls = ' vl trunk';
      }
      // « bloqué » avant la couleur : la couleur se termine par un attribut style.
      return blocked ? ' blocked' + cls : cls;
    };
    // Câbles.
    let c = '';
    const chanDone = new Set();
    for (const cb of data.cables) {
      const A = nodeById(cb.a[0]), B = nodeById(cb.b[0]); if (!A || !B) continue;
      if (grouped.has(A.id) || grouped.has(B.id)) continue; // vue d'ensemble : un seul trait par bloc, plus bas
      if (hideP && (isPassive(A.id) || isPassive(B.id))) {
        // Câblage passif caché : un trait direct d'un port actif à l'autre, une fois par canal.
        const e = chanOf.get(cb.id); if (!e) continue;
        const kk = [e[0].join('|'), e[1].join('|')].sort().join('#'); if (chanDone.has(kk)) continue; chanDone.add(kk);
        const X = nodeById(e[0][0]), Y = nodeById(e[1][0]); if (!X || !Y || grouped.has(X.id) || grouped.has(Y.id)) continue;
        const pa = portPos(X, e[0][1]), pb = portPos(Y, e[1][1]), my0 = (pa.y + pb.y) / 2, d = `M${pa.x} ${pa.y} C${pa.x} ${my0} ${pb.x} ${my0} ${pb.x} ${pb.y}`;
        c += `<g class="ntChan${vlanCls(cb)}" data-cable="${esc(cb.id)}"><path class="hit" d="${d}"/><path class="line" d="${d}"/></g>`;
        continue;
      }
      const pa = portPos(A, cb.a[1]), pb = portPos(B, cb.b[1]);
      if (cull && !vis(Math.min(pa.x, pb.x) - 60, Math.min(pa.y, pb.y) - 60, Math.abs(pb.x - pa.x) + 120, Math.abs(pb.y - pa.y) + 120)) continue;
      const r = cableAn(cb.wire);
      const bad = r.kind === 'none' ? 'raw' : r.faults.length && !isExam(data) ? 'bad' : ''; // examen : défaut non montré
      // Courbe en S d'un port à l'autre ; deux ports à la même hauteur : un arc vers le bas.
      const my0 = (pa.y + pb.y) / 2, flat = Math.abs(pb.y - pa.y) < 30, bend = flat ? Math.max(40, Math.abs(pb.x - pa.x) / 3) : 0;
      const d = flat ? `M${pa.x} ${pa.y} C${pa.x} ${pa.y + bend} ${pb.x} ${pb.y + bend} ${pb.x} ${pb.y}` : `M${pa.x} ${pa.y} C${pa.x} ${my0} ${pb.x} ${my0} ${pb.x} ${pb.y}`;
      const sa = flat ? 1 : 0, sb = flat ? 1 : 0, dy = bend;
      const isSel = (sel && sel.kind === 'cable' && sel.id === cb.id) || mselHas('cable', cb.id);
      c += `<g class="ntCab ${cb.cat} ${bad}${isSel ? ' sel' : ''}${vlanCls(cb)}" data-cable="${esc(cb.id)}"><path class="hit" d="${d}"/><path class="line" d="${d}"/>`;
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2 + (sa + sb) * dy * 0.375;
      if (zl >= 3) c += `<text class="ntCabL" x="${mx}" y="${my}">${esc(String(cb.len).replace('.', isEn ? '.' : ','))} m${bad === 'raw' ? ' · ' + tl('à sertir') : bad ? ' · ' + tl('défaut') : ''}</text>`;
      c += '</g>';
    }
    // Vue d'ensemble : un bloc par groupe d'appareils terminaux, relié à son switch par un trait dont l'épaisseur dit le nombre.
    let gb = '', tb = ''; // traits d'abord, cartes par-dessus
    // Cartes de taille fixe à l'écran, sous le centre de leurs appareils ; une carte qui en chevauche une autre descend.
    const cw = 150 / view.k, chh = 46 / view.k, gap = 12 / view.k, cards = [];
    for (const [swId, list] of groups) {
      const S = nodeById(swId); if (!S) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of list) { const q = posOf(n), t = specOf(n); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + t.w); y1 = Math.max(y1, q.y + t.h); }
      cards.push({ swId, S, list, bb: [x0, y0, x1, y1], x: (x0 + x1) / 2 - cw / 2, y: y0 });
    }
    cards.sort((p, q) => p.y - q.y || p.x - q.x);
    for (let i = 0; i < cards.length; i++) {
      const cd = cards[i];
      for (let guard = 0; guard < cards.length; guard++) {
        const hit = cards.slice(0, i).find(o => cd.x < o.x + cw + gap && o.x < cd.x + cw + gap && cd.y < o.y + chh + gap && o.y < cd.y + chh + gap);
        if (!hit) break; cd.y = hit.y + chh + gap;
      }
    }
    for (const { swId, S, list, bb, x, y } of cards) {
      if (!vis(x, y, cw, chh) && !vis(posOf(S).x, posOf(S).y, specOf(S).w, specOf(S).h)) continue;
      const sq = posOf(S), ss = specOf(S), ax = sq.x + ss.w / 2, ay = sq.y + ss.h, bx = x + cw / 2, by = y, my = (ay + by) / 2;
      const w = Math.min(9, 2 + Math.log2(list.length) * 1.4), kinds = new Map();
      for (const n of list) { const nm = specOf(n).name(); kinds.set(nm, (kinds.get(nm) || 0) + 1); }
      const tip = [...kinds].map(([k, v]) => `${v} × ${k}`).join(' · ');
      tb += `<path class="ntTrunk" d="M${ax} ${ay} C${ax} ${my} ${bx} ${my} ${bx} ${by}" style="stroke-width:${w}px"><title>${esc(tl('{0} → {1:# appareil|# appareils}', nameOf(swId), list.length))}</title></path>`;
      gb += `<g class="ntGroup" data-group="${esc(swId)}" data-bbox="${bb.join(',')}"><title>${esc(tip)} · ${esc(tl('clic : déplier'))}</title><rect x="${x}" y="${y}" width="${cw}" height="${chh}" rx="${10 / view.k}"/>`
        + `<text x="${bx}" y="${y + chh * 0.36}" style="font-size:${(12 / view.k).toFixed(1)}px">${esc(tl('{0:# appareil|# appareils}', list.length))}</text><text class="sub" x="${bx}" y="${y + chh * 0.7}" style="font-size:${(10 / view.k).toFixed(1)}px">${esc(nameOf(swId))}</text></g>`;
    }
    gCab.innerHTML = c + tb + gb;
    // Wi-Fi : un trait pointillé du point d'accès à chaque client.
    let w = '';
    for (const [nid, apId] of st.wifiAssoc) {
      const A = nodeById(apId), B = nodeById(nid); if (!A || !B) continue;
      const a = posOf(A), b = posOf(B), sa = specOf(A), sb = specOf(B);
      w += `<line class="ntAir" x1="${a.x + sa.w / 2}" y1="${a.y + sa.h / 2}" x2="${b.x + sb.w / 2}" y2="${b.y + sb.h / 2}"/>`;
    }
    gWifi.innerHTML = w;
    paintRubber(); paintTrace(); paintLegend();
  }
  let cabIdx = null; const blk = [];
  // Carte de câblage d'un câble (dessin), gardée en mémoire par le contenu de ses fiches.
  const CAN = new Map(), cableAn = w => { const k = JSON.stringify(w); let r = CAN.get(k); if (!r) { r = analyzeCable(w); if (CAN.size > 4000) CAN.clear(); CAN.set(k, r); } return r; };
  const cableAt = (n, p) => (cabIdx ? cabIdx.get(n + '|' + p) || null : data.cables.find(c => (c.a[0] === n && c.a[1] === p) || (c.b[0] === n && c.b[1] === p)) || null);
  /** Dernier traceroute : chemin pointillé et sauts numérotés (routeurs traversés, puis la destination). */
  function paintTrace() {
    let g = world.querySelector('.ntTraceG'); if (!g) { world.insertAdjacentHTML('beforeend', '<g class="ntTraceG"></g>'); g = world.querySelector('.ntTraceG'); }
    if (!traceOut) { g.innerHTML = ''; return; }
    const ctr = id => { const n = nodeById(id); if (!n) return null; const q = posOf(n), s = specOf(n); return [q.x + s.w / 2, q.y + s.h / 2]; };
    const pts = [ctr(traceOut.from)], marks = [];
    for (const hp of traceOut.r.hops || []) { const c2 = hp.node ? ctr(hp.node) : null; if (c2) { pts.push(c2); marks.push([c2, hp.n, hp.ok]); } }
    const ok = pts.filter(Boolean);
    g.innerHTML = (ok.length > 1 ? `<polyline class="ntTracePath" points="${ok.map(p => p.join(',')).join(' ')}"/>` : '')
      + marks.map(([[x, y], n, okh]) => `<g class="ntHop${okh ? '' : ' bad'}" transform="translate(${x + 14} ${y - 14})"><circle r="9"/><text>${n}</text></g>`).join('');
  }
  const legendBase = host.querySelector('.ntLegend').innerHTML;
  /** Légende : vitesses des liens, ou couleurs des VLAN quand le schéma est coloré par VLAN. */
  /**
   * Légende dépliée posée sur des appareils (zoom, déplacement) : elle se replie d'elle-même (legendAuto) ; un clic la
   * rouvre pour la session (legendPinned). Repliée par l'utilisateur (legendMini) : elle le reste.
   */
  function legendCheck() {
    const el = host.querySelector('.ntLegend'); if (!el || legendMini || !on || cur !== 'logic') return;
    if (!el.classList.contains('mini') && el.offsetWidth) legendFull = { w: el.offsetWidth, h: el.offsetHeight };
    if (!legendFull) return;
    const r = rectOf(), lr = el.getBoundingClientRect(); if (!r.width) return;
    const x0 = view.x + (lr.left - r.left) / view.k, y1 = view.y + (lr.bottom - r.top) / view.k, x1 = x0 + legendFull.w / view.k, y0 = y1 - legendFull.h / view.k;
    const over = drawnBoxes.some(([x, y, w, hh]) => x < x1 && x + w > x0 && y < y1 && y + hh > y0);
    if (over !== legendAuto) { legendAuto = over; if (!over) legendPinned = false; paintLegend(); }
  }
  function paintLegend() {
    const el = host.querySelector('.ntLegend'), V = data.vlans || [], mini = legendMini || (legendAuto && !legendPinned);
    el.classList.toggle('mini', mini);
    if (mini) { el.innerHTML = `${icon('list')}<span>${tl('Légende')}</span>`; host.querySelectorAll('[data-simv]').forEach(b => { if (b.dataset.simv !== 'arrange') b.setAttribute('aria-pressed', String(b.dataset.simv === 'vlan' ? vlanView : hidePassive)); }); return; }
    el.innerHTML = vlanView ? V.slice(0, 10).map(v => `<span class="ntVlKey" style="--vc:${vlanColor(data, v.id)}"><i></i>${v.id} ${esc(v.name)}</span>`).join('') + `<span class="ntVlKey"><i class="trunk"></i>trunk</span><span class="ntVlKey"><i class="blk"></i>${tl('bloqué (Spanning Tree)')}</span>` : legendBase;
    host.querySelectorAll('[data-simv]').forEach(b => { if (b.dataset.simv !== 'arrange') b.setAttribute('aria-pressed', String(b.dataset.simv === 'vlan' ? vlanView : hidePassive)); });
  }
  /** Boutons d'affichage : couleurs des VLAN, câblage passif caché, disposition automatique. */
  function simView(k) {
    if (k === 'vlan') { vlanView = !vlanView; saveSimPref(); render(); return; }
    if (k === 'passive') { hidePassive = !hidePassive; saveSimPref(); render(); return; }
    if (k === 'arrange') { const n = autoArrange(data, lan); commit(); fit(); app.status(tl('{0:# équipement rangé|# équipements rangés} en couches : cœur, distribution, accès, postes.', n), 'ok'); }
  }

  /* ---------- Vue : zoom, déplacement, tout voir ---------- */
  const rectOf = () => svg.getBoundingClientRect();
  const toWorld = (cx, cy) => { const r = rectOf(); return { x: view.x + (cx - r.left) / view.k, y: view.y + (cy - r.top) / view.k }; };
  function zoomAt(f, x, y) {
    const r = rectOf(), px = x ?? r.width / 2, py = y ?? r.height / 2, wx = view.x + px / view.k, wy = view.y + py / view.k;
    touched = true; view.k = Math.max(0.2, Math.min(4, view.k * f)); view.x = wx - px / view.k; view.y = wy - py / view.k; applyView();
  }
  function bounds(list) {
    if (!list.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of list) { const s = specOf(n), q = posOf(n); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y - 20); x1 = Math.max(x1, q.x + s.w); y1 = Math.max(y1, q.y + s.h + 26); }
    return { x0, y0, x1, y1 };
  }
  function fitTo(b) {
    const r = rectOf(); if (!b || !r.width) return;
    // Marges : barre d'outils en haut, légende en bas, barre de navigation à droite (rien du dessin dessous).
    const top = focus ? 104 : 64, bottom = (host.querySelector('.ntLegend') || {}).offsetHeight ? host.querySelector('.ntLegend').offsetHeight + 28 : 48;
    const W = r.width - 56 - 40, Hh = r.height - top - bottom;
    view.k = Math.max(0.05, Math.min(1.6, Math.min(W / (b.x1 - b.x0 || 1), Hh / (b.y1 - b.y0 || 1))));
    view.x = b.x0 - (W / view.k - (b.x1 - b.x0)) / 2 - 20 / view.k; view.y = b.y0 - (Hh / view.k - (b.y1 - b.y0)) / 2 - top / view.k;
    applyView();
  }
  // Vue cachée (autre onglet) : le cadrage attend que la vue logique soit montrée. Tant que l'utilisateur n'a ni zoomé
  // ni déplacé la vue (touched), elle est recadrée à chaque retour sur la vue logique (modèle posé, rangement…).
  let pendFit = false, touched = false;
  const fit = () => { if (!rectOf().width || cur !== 'logic') { pendFit = true; return; } pendFit = false; fitTo(bounds(focus ? nodes().filter(n => focus.ids.has(n.id)) : nodes())); };
  /**
   * Bloc de la vue d'ensemble déplié : le switch et ses appareils seuls, rangés en grille sous lui (positions provisoires,
   * le modèle ne change pas), cadrés à un zoom où leurs noms se lisent. Échap ou « Tout afficher » : retour au schéma.
   */
  function openGroup(swId) {
    const st = lan.state(), S = nodeById(swId); if (!S) return;
    const members = st.all.filter(n => {
      const r = specOf(n).role; if (r !== 'host' && r !== 'ap') return false;
      for (const p of portsOf(n)) { const ch = st.chans.get(n.id + '|' + p.id); if (ch && ch.far) return ch.far.n === swId; }
      return false;
    });
    if (!members.length) return;
    // Dans l'ordre des ports du switch : moins de croisements.
    const pidx = new Map(portsOf(S).map((p, i) => [p.id, i])), farP = n => { for (const p of portsOf(n)) { const ch = st.chans.get(n.id + '|' + p.id); if (ch && ch.far) return pidx.get(ch.far.p) ?? 0; } return 0; };
    members.sort((a, b) => farP(a) - farP(b));
    const sq = posOf(S), ss = specOf(S), per = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(members.length * 1.6)))), GX = 40, GY = 70;
    const cw = Math.max(...members.map(n => specOf(n).w)), ch = Math.max(...members.map(n => specOf(n).h));
    const rowW = Math.min(per, members.length) * (cw + GX) - GX, x0 = sq.x + ss.w / 2 - rowW / 2, y0 = sq.y + ss.h + 150, pos = new Map();
    members.forEach((n, i) => pos.set(n.id, { x: Math.round(x0 + (i % per) * (cw + GX) + (cw - specOf(n).w) / 2), y: Math.round(y0 + Math.floor(i / per) * (ch + GY)) }));
    focus = { sw: swId, ids: new Set([swId, ...members.map(n => n.id)]), pos };
    select(null); paintFocus(); render();
    fitTo(bounds([S, ...members]));
    if (view.k < 0.75) { const b = bounds(members); fitTo(b); }
    render();
  }
  function closeGroup() {
    if (!focus) return; focus = null; paintFocus(); fit(); render();
  }
  function paintFocus() {
    let bar = logicEl.querySelector('.ntFocusBar');
    if (!focus) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.className = 'ntFocusBar glass'; bar.setAttribute('role', 'status'); logicEl.appendChild(bar); bar.addEventListener('click', e => { if (e.target.closest('[data-unfocus]')) closeGroup(); }); }
    bar.innerHTML = `${icon(specOf(nodeById(focus.sw)).icon)}<span><b>${esc(nameOf(focus.sw))}</b> · ${esc(tl('{0:# appareil|# appareils}', focus.ids.size - 1))}</span><button type="button" class="sBtn" data-unfocus>${icon('fitAll')}<span>${tl('Tout afficher')}</span><kbd>Esc</kbd></button>`;
  }
  const selNode = () => (sel && sel.kind === 'dev' ? nodeById(sel.id) : null);
  const nav = createNavDock(logicEl, {
    active: () => on && cur === 'logic', target: () => svg, tools: () => ['select', 'pan', 'zoom'],
    zoomBy: (f, x, y) => zoomAt(f, x, y), panBy: (dx, dy) => { touched = true; view.x -= dx / view.k; view.y -= dy / view.k; applyView(); },
    zoomPct: () => Math.round(view.k * 100), setZoomPct: p => { zoomAt(p / 100 / view.k); },
    fit, fitSel: () => { const n = selNode(); if (!n) return false; fitTo(bounds([n])); return true; }, hasSel: () => !!selNode(),
    zoomRect(r, sr) { const a = toWorld(r.left, r.top), b = toWorld(r.right, r.bottom); void sr; fitTo({ x0: a.x, y0: a.y, x1: b.x, y1: b.y }); return true; },
    mini: { data: () => { const b = bounds(nodes()); if (!b) return null; const r = rectOf(); return { bounds: [b.x0, b.y0, b.x1, b.y1], boxes: nodes().map(n => { const q = posOf(n), s = specOf(n); return [q.x, q.y, s.w, s.h, sel && sel.id === n.id]; }), view: [view.x, view.y, view.x + r.width / view.k, view.y + r.height / view.k] }; }, centerOn: (x, y) => { touched = true; const r = rectOf(); view.x = x - r.width / 2 / view.k; view.y = y - r.height / 2 / view.k; applyView(); } },
    status: m => app.status(m), title: tl('Plan réseau'),
    shortcuts: () => [['V', tl('Choisir et déplacer')], ['C', tl('Outil câble')], ['T', tl('Testeur de câble')], ['P', 'Ping'], ['R', 'Traceroute'], ['Shift+' + tl('clic'), tl('Ajouter à la sélection')], [tl('Glisser sur le fond'), tl('Rectangle de sélection')], ['Mod+A', tl('Tout choisir')], ['Mod+C', tl('Copier')], ['Mod+V', tl('Coller (avec les câbles)')], ['Mod+Shift+V', tl('Coller sans les câbles')], ['Mod+D', tl('Dupliquer')], ['Mod+X', tl('Couper')], [tl('Flèches'), tl('Déplacer de 10 (Maj : 50, Alt : 1)')], ['Alt', tl('Glisser sans grille ni guides')], [tl('Clic droit'), tl('Menu de l’objet')], ['Del', tl('Retirer la sélection')], ['Esc', tl('Annuler le geste en cours')]]
  });
  svg.addEventListener('wheel', e => { if (!on) return; e.preventDefault(); const r = rectOf(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); }, { passive: false });

  /* ---------- Gestes ---------- */
  let drag = null, rubber = null;
  function paintRubber() {
    // Calque du geste : câble qu'on tire, guides d'alignement pendant un déplacement.
    let h = '';
    if (drag && drag.lines) h += drag.lines.map(l => `<line class="ntGuide" x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}"/>`).join('');
    const n = rubber ? nodeById(rubber.n) : null;
    if (n) { const a = portPos(n, rubber.p); h += `<line class="ntRubber" x1="${a.x}" y1="${a.y}" x2="${rubber.x}" y2="${rubber.y}"/>`; }
    gOver.innerHTML = h;
  }
  // Élément sous le pointeur (pendant une capture, e.target est le SVG : on regarde ce qui est vraiment dessous).
  const hitOf = e => {
    const t = (e.type === 'pointerup' || e.type === 'pointermove' ? document.elementFromPoint(e.clientX, e.clientY) : e.target) || e.target;
    const pt = t.closest ? t.closest('.ntPort') : null, dv = t.closest ? t.closest('.ntDev') : null, cb = t.closest ? t.closest('.ntCab, .ntChan') : null;
    return { port: pt && dv ? { n: dv.dataset.id, p: pt.dataset.port } : null, dev: dv ? dv.dataset.id : null, cable: cb ? cb.dataset.cable : null };
  };
  svg.addEventListener('pointerdown', e => {
    if (!on || nav.tool() !== 'select') return;
    // Bouton du milieu : déplacer la vue (comme Espace + glisser).
    if (e.button === 1) { e.preventDefault(); drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; svg.setPointerCapture(e.pointerId); svg.classList.add('panning'); return; }
    if (e.button !== 0) return;
    // Vue d'ensemble : un clic sur un bloc d'appareils zoome dessus.
    const grp = e.target.closest && e.target.closest('.ntGroup');
    if (grp) { openGroup(grp.dataset.group); return; }
    const h = hitOf(e), w = toWorld(e.clientX, e.clientY), add = e.shiftKey || e.metaKey || e.ctrlKey;
    if (tool === 'tester') { if (h.cable) testCable(h.cable); else if (h.port) testPort(h.port.n, h.port.p); return; }
    if (tool === 'ping') { if (h.dev) pingClick(h.dev); return; }
    if (tool === 'trace') { if (h.dev) traceClick(h.dev); return; }
    if (h.port && !add) {
      const c = cableAt(h.port.n, h.port.p);
      if (rubber) { finishRubber(h.port); return; }
      if (c && tool === 'select') { select({ kind: 'cable', id: c.id }); return; }
      if (c) { app.status(tl('Ce port a déjà un câble : retirez-le d’abord.'), 'warn'); return; }
      rubber = { n: h.port.n, p: h.port.p, x: w.x, y: w.y, drag: tool === 'select' }; paintRubber(); paintHint(); svg.setPointerCapture(e.pointerId); return;
    }
    if (rubber) { rubber = null; paintRubber(); paintHint(); return; }
    if (h.cable) { if (add) toggleSel({ kind: 'cable', id: h.cable }); else select({ kind: 'cable', id: h.cable }); return; }
    if (h.dev) {
      // Maj (ou Ctrl) + clic : ajouter ou retirer de la sélection ; glisser un équipement choisi : toute la sélection suit.
      if (add) { toggleSel({ kind: 'dev', id: h.dev }); return; }
      const group = selDevIds(), keep = group.length > 1 && group.includes(h.dev);
      if (!keep) select({ kind: 'dev', id: h.dev });
      if (focus) return; // groupe déplié : positions provisoires, on choisit sans déplacer
      const ids = keep ? group : [h.dev], start = new Map(ids.map(id => { const q = posOf(nodeById(id) || { x: 0, y: 0 }); return [id, { x: q.x, y: q.y }]; }));
      drag = { id: h.dev, ids, start, wx: w.x, wy: w.y, moved: false }; svg.setPointerCapture(e.pointerId); return;
    }
    // Fond : rectangle de sélection (Maj : ajoute à la sélection) ; un simple clic désélectionne.
    marq = { x0: w.x, y0: w.y, x1: w.x, y1: w.y, base: add ? multiSel() : [], moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (!on) return;
    const w = toWorld(e.clientX, e.clientY);
    if (rubber) { rubber.x = w.x; rubber.y = w.y; paintRubber(); return; }
    if (marq) {
      marq.x1 = w.x; marq.y1 = w.y; if (Math.hypot(marq.x1 - marq.x0, marq.y1 - marq.y0) * view.k > 4) marq.moved = true;
      if (marq.moved) gOver.innerHTML = `<rect class="ntMarq" x="${Math.min(marq.x0, marq.x1)}" y="${Math.min(marq.y0, marq.y1)}" width="${Math.abs(marq.x1 - marq.x0)}" height="${Math.abs(marq.y1 - marq.y0)}"/>`;
      return;
    }
    if (!drag) return;
    if (drag.pan) { touched = true; view.x = drag.vx - (e.clientX - drag.sx) / view.k; view.y = drag.vy - (e.clientY - drag.sy) / view.k; applyView(); return; }
    if (!drag.moved && Math.hypot(w.x - drag.wx, w.y - drag.wy) * view.k < 3) return; // petit tremblement d'un clic
    // Grille de 10 (Alt : libre) ; un seul équipement : guides d'alignement avec ses voisins visibles.
    const s0 = drag.start.get(drag.id), n0 = nodeById(drag.id); if (!s0 || !n0) return;
    let x = s0.x + (w.x - drag.wx), y = s0.y + (w.y - drag.wy);
    if (!e.altKey) { x = snap(x); y = snap(y); }
    let lines = [];
    if (drag.ids.length === 1 && !e.altKey) {
      const sp = specOf(n0), area = viewRect(0), others = [];
      for (const m of lan.state().all) {
        if (m.id === drag.id || specOf(m).role === 'mech' || (hidePassive && specOf(m).role === 'passive')) continue;
        const q = posOf(m), t = specOf(m);
        if (q.x + t.w < area.x0 || q.x > area.x1 || q.y + t.h < area.y0 || q.y > area.y1) continue;
        others.push({ x: q.x, y: q.y, w: t.w, h: t.h }); if (others.length > 400) break;
      }
      const g = guideOf({ x: s0.x + (w.x - drag.wx), y: s0.y + (w.y - drag.wy), w: sp.w, h: sp.h }, others, 6 / view.k);
      if (g.lines.length) { if (g.dx) x = s0.x + (w.x - drag.wx) + g.dx; if (g.dy) y = s0.y + (w.y - drag.wy) + g.dy; lines = g.lines; }
    }
    const dx = x - s0.x, dy = y - s0.y;
    for (const id of drag.ids) {
      const n = nodeById(id), s1 = drag.start.get(id); if (!n || !s1) continue;
      if (n.ext) { const k = n.id.slice(2); data.ext[k] = { x: s1.x + dx, y: s1.y + dy }; } else { const d = findDev(id); if (d) { d.x = s1.x + dx; d.y = s1.y + dy; } }
    }
    drag.moved = true; drag.lines = lines; renderSoon(); // la position ne change rien au réseau simulé : seulement le dessin, une fois par image
  });
  svg.addEventListener('pointerup', e => {
    if (rubber && rubber.drag) { const h = hitOf(e); if (h.port && (h.port.n !== rubber.n || h.port.p !== rubber.p)) finishRubber(h.port); else if (!h.port) { rubber.drag = false; if (Math.hypot(rubber.x - portPos(nodeById(rubber.n), rubber.p).x, rubber.y - portPos(nodeById(rubber.n), rubber.p).y) > 12) { rubber = null; paintRubber(); } paintHint(); } return; }
    if (marq) {
      const m = marq; marq = null; gOver.innerHTML = '';
      if (!m.moved) { if (!m.base.length) select(null); return; }
      const rects = lan.state().all.filter(n => specOf(n).role !== 'mech' && !(hidePassive && specOf(n).role === 'passive')).map(n => { const q = posOf(n), t = specOf(n); return { id: n.id, x: q.x, y: q.y, w: t.w, h: t.h }; });
      const ids = inMarquee(rects, m.x0, m.y0, m.x1, m.y1), list = [...m.base];
      for (const id of ids) if (!list.some(x => x.kind === 'dev' && x.id === id)) list.push({ kind: 'dev', id });
      if (list.length > 1) selectMany(list); else select(list[0] || null);
      if (list.length) app.status(tl('{0:# élément choisi|# éléments choisis}', list.length));
      return;
    }
    if (drag && drag.moved) { drag.lines = null; commit(); }
    if (drag && drag.pan) svg.classList.remove('panning');
    drag = null;
  });
  // Clic droit : menu de l'objet sous le pointeur (équipement, câble, port, fond).
  svg.addEventListener('contextmenu', e => { if (!on || cur !== 'logic') return; e.preventDefault(); openCtxMenu(e); });
  let marq = null, clip = null, pasteN = 0;
  /** Équipements choisis (sélection simple ou multiple). */
  const selDevIds = () => multiSel().filter(x => x.kind === 'dev' && findDev(x.id)).map(x => x.id);
  /** Ajoute ou retire un objet de la sélection (Maj + clic). */
  function toggleSel(it) {
    const list = multiSel(), i = list.findIndex(x => x.kind === it.kind && x.id === it.id);
    if (i >= 0) list.splice(i, 1); else list.push(it);
    if (list.length > 1) selectMany(list); else select(list[0] || null);
  }
  /** Rectangles des équipements ids (schéma). */
  const rectsOf = ids => ids.map(id => { const d = findDev(id), t = d && specOf(d); return d ? { id, x: d.x, y: d.y, w: t.w, h: t.h } : null; }).filter(Boolean);
  /** Aligne ou répartit les équipements choisis (how : left/center/right/top/middle/bottom, dx, dy). */
  function arrangeSel(how) {
    const rs = rectsOf(selDevIds()), out = how === 'dx' ? distRects(rs, 'x') : how === 'dy' ? distRects(rs, 'y') : alignRects(rs, how);
    if (!out.length) { app.status(how[0] === 'd' ? tl('Choisissez au moins trois équipements à répartir.') : tl('Choisissez au moins deux équipements à aligner.'), 'warn'); return; }
    for (const o of out) { const d = findDev(o.id); d.x = Math.round(o.x); d.y = Math.round(o.y); }
    commit();
  }
  /** Copier, coller (avec les câbles entre les équipements copiés, ou sans), dupliquer, couper. */
  function copySel() { const ids = selDevIds(); if (!ids.length) return false; clip = copyOf(data, ids); pasteN = 0; app.status(tl('{0:# équipement copié|# équipements copiés}, {1:# câble|# câbles} entre eux.', clip.devices.length, clip.cables.length), 'ok'); return true; }
  function pasteSel(cables = true, at = null) {
    if (!clip || !clip.devices.length) { app.status(tl('Rien à coller : copiez d’abord des équipements (Ctrl+C).'), 'warn'); return; }
    pasteN++;
    const x0 = Math.min(...clip.devices.map(d => d.x)), y0 = Math.min(...clip.devices.map(d => d.y));
    const dx = at ? snap(at.x - x0) : 40 * pasteN, dy = at ? snap(at.y - y0) : 40 * pasteN;
    const names = new Set(data.devices.map(d => d.name)), taken = new Set(data.devices.map(d => d.id));
    const newId = t => { const pre = (DEVICES[t].prefix || 'n').toLowerCase(); let i = 1; while (taken.has(pre + i)) i++; taken.add(pre + i); return pre + i; };
    const ids = pasteClip(data, clip, { dx, dy, cables, newId, newName: (t, nm) => { const v = freeName(names, nm); names.add(v); return v; } });
    commit();
    selectMany(ids.map(id => ({ kind: 'dev', id })));
    app.status(cables ? tl('{0:# équipement collé|# équipements collés}, avec leurs câbles.', ids.length) : tl('{0:# équipement collé|# équipements collés}, sans câble.', ids.length), 'ok');
  }
  function duplicateSel() { const keep = clip; if (!copySel()) return; pasteSel(true); clip = keep || clip; }
  /** Menu contextuel : équipement, câble, port ou fond du schéma. */
  async function openCtxMenu(e) {
    const h = hitOf(e), w = toWorld(e.clientX, e.clientY), items = [];
    const n = h.dev ? nodeById(h.dev) : null, d = h.dev ? findDev(h.dev) : null;
    if (h.port && n) {
      const port = portsOf(n).find(p => p.id === h.port.p), c = cableAt(h.port.n, h.port.p);
      items.push({ header: `${nameOf(n.id)} · ${port ? port.label : h.port.p}` });
      if (!c) items.push({ label: tl('Tirer un câble d’ici'), icon: 'cable', run: () => { rubber = { n: h.port.n, p: h.port.p, x: w.x, y: w.y, drag: false }; paintRubber(); paintHint(); } });
      else items.push({ label: tl('Choisir le câble'), icon: 'cable', run: () => select({ kind: 'cable', id: c.id }) }, { label: tl('Tester ce port'), icon: 'cableTester', keys: 'T', run: () => testPort(h.port.n, h.port.p) });
      if (d && specOf(d).managed && port && !port.passive) {
        const pc = portCfg(d, port.id), V = [1, ...(data.vlans || []).map(v => v.id).filter(v => v !== 1)];
        items.push('-', { label: tl('Accès VLAN'), icon: 'vlanTag', items: V.map(v => ({ label: `VLAN ${v}${((data.vlans || []).find(x => x.id === v) || {}).name ? ' · ' + data.vlans.find(x => x.id === v).name : ''}`, checked: pc.mode === 'access' && pc.vlan === v, run: () => setPort(d, port.id, { mode: 'access', vlan: v }) })) },
          { label: 'Trunk', checked: pc.mode === 'trunk', run: () => setPort(d, port.id, { mode: pc.mode === 'trunk' ? 'access' : 'trunk' }) },
          { label: tl('Port coupé par l’administrateur'), checked: pc.shut, run: () => setPort(d, port.id, { shut: !pc.shut }) });
      }
      if (c && iaApi) { const rel = iaApi.relatedMenu({ kind: 'cable', id: c.id }); if (rel.length) items.push({ label: tl('Lié à'), icon: 'link', items: rel }); }
      if (c) items.push('-', { label: tl('Retirer le câble'), icon: 'trash', danger: true, run: () => { data.cables = data.cables.filter(x => x !== c); if (sel && sel.id === c.id) sel = null; commit(); } });
    } else if (n) {
      const many = selDevIds().length > 1 && selDevIds().includes(n.id);
      if (!many && !(sel && sel.id === n.id)) select({ kind: 'dev', id: n.id });
      items.push({ header: many ? tl('{0} équipements', selDevIds().length) : nameOf(n.id) });
      if (!many && iaApi) {
        // Menu commun (ia) : Aller à, Voir dans…, Lié à, Renommer…, Copier, Dupliquer, Retirer, verbes de la vue, Propriétés.
        const verbs = canSend(n) ? [{ label: tl('Ping depuis cet appareil'), icon: 'ping', keys: 'P', run: () => { setTool('ping'); pingFrom = n.id; render(); paintHint(); } }, { label: tl('Traceroute depuis cet appareil'), icon: 'traceroute', keys: 'R', run: () => { setTool('trace'); traceFrom = n.id; render(); paintHint(); } }] : [];
        items.push(...iaApi.objectMenu({ kind: 'dev', id: n.id }, { clipboard: d ? [{ label: tl('Copier'), icon: 'copy', keys: 'Ctrl+C', run: copySel }] : [], duplicate: duplicateSel, remove: d ? removeSel : null, extra: verbs }));
        await ctxMenu(e, items); return;
      }
      if (!many) {
        items.push({ label: tl('Propriétés'), icon: 'sliders', run: () => { app.setTab('nprop'); renderPane(); } });
        if (canSend(n)) items.push({ label: tl('Ping depuis cet appareil'), icon: 'ping', keys: 'P', run: () => { setTool('ping'); pingFrom = n.id; render(); paintHint(); } }, { label: tl('Traceroute depuis cet appareil'), icon: 'traceroute', keys: 'R', run: () => { setTool('trace'); traceFrom = n.id; render(); paintHint(); } });
        items.push('-');
      }
      if (d) items.push({ label: tl('Copier'), icon: 'copy', keys: 'Ctrl+C', run: copySel }, { label: tl('Dupliquer'), icon: 'plus', keys: 'Ctrl+D', run: duplicateSel });
      if (many) items.push('-', ...arrangeItems());
      if (d) items.push('-', { label: many ? tl('Retirer ces équipements') : tl('Retirer cet équipement'), icon: 'trash', keys: tl('Suppr'), danger: true, run: removeSel });
    } else if (h.cable) {
      const c = data.cables.find(x => x.id === h.cable); if (!c) return;
      select({ kind: 'cable', id: c.id });
      items.push({ header: tl('Câble {0} ↔ {1}', nameOf(c.a[0]), nameOf(c.b[0])) },
        { label: tl('Passer au testeur'), icon: 'cableTester', keys: 'T', run: () => testCable(c.id) });
      if (c.media === 'fibre') items.push({ label: tl('Bilan optique'), icon: 'fibre', run: () => import('./fibreui.js').then(m => m.openBudget(ctx, c.id)) });
      else items.push({ label: tl('Sertir la fiche A'), icon: 'rj45', run: () => crimp(c.id, 'a') }, { label: tl('Sertir la fiche B'), icon: 'rj45', run: () => crimp(c.id, 'b') },
        { label: tl('Remplacer'), icon: 'swap', items: [['straight', tl('Câble droit neuf')], ['crossover', tl('Câble croisé neuf')], ['blank', tl('À sertir')]].map(([k, l]) => ({ label: l, run: () => { c.wire = makeCable(k); commit(); } })) },
        { label: tl('Catégorie'), items: CAT_IDS.map(k => ({ label: CATS[k].name, checked: c.cat === k, run: () => { c.cat = k; commit(); } })) });
      // Menu commun (ia) ; les gestes du câble (tester, sertir, remplacer…) deviennent les verbes de la vue.
      if (iaApi) { const verbs = items.splice(1, items.length - 1); items.push(...iaApi.objectMenu({ kind: 'cable', id: c.id }, { remove: removeSel, extra: verbs })); }
      else items.push('-', { label: tl('Retirer ce câble'), icon: 'trash', keys: tl('Suppr'), danger: true, run: removeSel });
    } else {
      items.push({ label: tl('Coller'), icon: 'clipboard', keys: 'Ctrl+V', disabled: !clip, run: () => pasteSel(true, w) },
        { label: tl('Coller sans les câbles'), icon: 'clipboard', keys: 'Ctrl+Maj+V', disabled: !clip, run: () => pasteSel(false, w) },
        { label: tl('Tout choisir'), icon: 'pointer', keys: 'Ctrl+A', run: selectAll }, '-',
        { label: tl('Ajouter ici'), icon: 'plus', items: ['pc', 'laptop', 'switch24', 'l3switch', 'routerpro', 'router', 'ap', 'server', 'outlet', 'patch24'].filter(t => DEVICES[t]).map(t => ({ label: DEVICES[t].name(), icon: DEVICES[t].icon, run: () => place(t, w.x - DEVICES[t].w / 2, w.y - DEVICES[t].h / 2) })) },
        '-', { label: tl('Disposition automatique'), icon: 'treeLayout', run: () => simView('arrange') }, { label: tl('Tout voir'), icon: 'fitAll', keys: 'F', run: fit },
        { label: tl('Couleurs des VLAN'), icon: 'vlanTag', checked: vlanView, run: () => simView('vlan') }, { label: tl('Cacher prises et panneaux'), icon: 'patchPanel', checked: hidePassive, run: () => simView('passive') });
    }
    await ctxMenu(e, items);
  }
  function arrangeItems() {
    return [{ label: tl('Aligner'), icon: 'alignLeft', items: [['left', tl('À gauche'), 'alignLeft'], ['center', tl('Au centre'), 'alignCenter'], ['right', tl('À droite'), 'alignRight'], '-', ['top', tl('En haut')], ['middle', tl('Au milieu')], ['bottom', tl('En bas')]].map(x => (x === '-' ? '-' : { label: x[1], icon: x[2], run: () => arrangeSel(x[0]) })) },
      { label: tl('Répartir'), items: [{ label: tl('Horizontalement'), run: () => arrangeSel('dx') }, { label: tl('Verticalement'), run: () => arrangeSel('dy') }] }];
  }
  function setPort(d, pid, patch) { d.p.ports = d.p.ports || {}; d.p.ports[pid] = { ...portCfg(d, pid), ...patch }; const s2 = DEVICES[d.type]; if (s2.clean) d.p = s2.clean(d.p, s2.props()); commit(); }
  function selectAll() { const list = lan.state().all.filter(n => specOf(n).role !== 'mech' && !(hidePassive && specOf(n).role === 'passive')).map(n => ({ kind: 'dev', id: n.id })); if (list.length > 1) selectMany(list); else select(list[0] || null); }
  /** Déplace les équipements choisis (flèches du clavier). */
  function nudge(dx, dy) { const ids = selDevIds(); if (!ids.length) return false; for (const id of ids) { const d = findDev(id); d.x += dx; d.y += dy; } commit(); return true; }
  function finishRubber(to) {
    const from = rubber; rubber = null; paintRubber(); paintHint();
    if (to.n === from.n && to.p === from.p) return;
    if (cableAt(to.n, to.p)) { app.status(tl('Ce port a déjà un câble.'), 'warn'); return; }
    const c = addCable([from.n, from.p], [to.n, to.p]);
    sel = { kind: 'cable', id: c.id }; commit();
    app.status(cableDef.kind === 'blank' ? tl('Câble posé, fiches à sertir : boutons « Sertir » dans l’inspecteur.') : tl('Câble posé : {0} m, {1}.', c.len, CATS[c.cat].name), 'ok');
  }
  function select(s) { sel = s; msel = s ? [s] : []; MS = null; render(); renderPane(); if (on && s) app.setTab('nprop'); nav.update(); selChanged('one'); }
  /* Sélection multiple partagée (navigateur du projet, recherche) : la vue montrée la reprend si elle sait (selectMany). */
  let msel = [], MS = null, iaApi = null; const selHooks = new Set(); // iaApi : ia.js une fois chargé
  const mselHas = (k, id) => msel.length > 1 && (MS || (MS = new Set(msel.map(x => x.kind + ':' + x.id)))).has(k + ':' + id);
  function selChanged(how) { for (const f of selHooks) { try { f(sel, how); } catch (e) { console.error(e); } } }
  function selectMany(list) {
    list = (list || []).filter(x => x && x.kind && x.id != null);
    msel = list; MS = null; sel = list[list.length - 1] || null;
    const vw = views[cur]; if (on && cur !== 'logic' && vw && vw.selectMany) { try { vw.selectMany(list); } catch (e) { console.error(e); } }
    render(); renderPane(); if (on && sel) app.setTab('nprop'); nav.update(); selChanged('many');
  }
  /** Objets choisis : la sélection multiple partagée (selectMany), sinon celle de la vue montrée (multi()), sinon la simple. */
  function multiSel() { if (msel.length > 1) return msel.slice(); const vw = views[cur]; if (on && cur !== 'logic' && vw && vw.multi) { const m = vw.multi(); if (m && m.length > 1) return m.slice(); } return sel ? [sel] : []; }

  /* ---------- Vues (contrat) ----------
   * Une vue est créée par createXView(ctx) et rend { el, show(), hide(), render(why), key(e) → bool, keyup?(e), fit(),
   * reveal(id) → bool, pane(sel) → html | null (inspecteur), paneEvent(e, sel) → bool, drop?(type, ev | null) }.
   * ctx : tout ce qu'une vue partage avec le plan réseau (même modèle, même historique, même sélection, même simulation). */
  const viewHooks = new Set();
  const ctx = {
    app, tl, icon, esc, isEn,
    /** Élément où la vue ajoute sa racine (sous la barre des vues). */
    host,
    /** Modèle du projet réseau (le même pour toutes les vues) : le modifier, puis ctx.commit(). */
    data: () => data,
    /** Enregistre la modification dans l'historique (Ctrl+Z), recalcule longueurs et réseau, redessine tout. */
    commit: () => commit(),
    lan: () => lan,
    issues: () => { try { return shownIssues(); } catch (e) { console.error(e); return []; } },
    /** Sélection partagée : { kind: 'dev' | 'cable' | 'room' | 'wall' | 'door' | 'path' | 'rack' | 'floor' | 'building' | …, id } ou null. */
    selection: () => sel,
    select: s => select(s),
    /** Sélection multiple partagée : selectMany([{ kind, id }…]) (la dernière devient la sélection simple), multi() → liste. */
    selectMany: list => selectMany(list), multi: () => multiSel(),
    /** Fonction appelée à chaque changement de sélection : fn(sel, how 'one'|'many'). Rend de quoi l'enlever. */
    onSelect: fn => { selHooks.add(fn); return () => selHooks.delete(fn); },
    /** « Lié à » (ia.js, relate.js) : related(sel) → [{ key, group, label, sub, icon, letter, target, hl }] ; relatedMenu(sel) → éléments
     * de menu (kit/menu.js, sous-menu « Lié à ») ; go(target) : aller (vue + objet, choix multiple, ligne du panneau du bas) ;
     * back() / forward() : historique de navigation (vues, étages, sélection ; Alt+← / Alt+→). */
    related: s => (iaApi ? iaApi.related(s || sel) : []),
    relatedMenu: s => (iaApi ? iaApi.relatedMenu(s || sel) : []),
    /** Menu contextuel commun d'un objet (mêmes entrées dans toutes les vues) : objectMenu(sel, { clipboard: [éléments],
     * extra: [verbes de la vue], rename(), remove(), duplicate() }) → éléments pour ctxMenu (kit) ; ctxMenu(ev, items) l'ouvre. */
    objectMenu: (s, o) => (iaApi ? iaApi.objectMenu(s || sel, o) : (o && o.extra) || []),
    ctxMenu: (ev, items) => (iaApi ? iaApi.ctxMenu(ev, items) : null),
    go: t => (iaApi ? iaApi.go(t) : t && t.id != null ? reveal(t.id) : undefined),
    back: () => (iaApi ? iaApi.back() : false), forward: () => (iaApi ? iaApi.forward() : false),
    canBack: () => !!iaApi && iaApi.canBack(), canForward: () => !!iaApi && iaApi.canForward(),
    /** Redessine l'inspecteur (après un changement qui ne passe pas par commit). */
    renderPane: () => renderPane(),
    /** Fonction appelée après chaque changement du modèle (commit, annuler, ouverture) : fn(why). Rend de quoi l'enlever. */
    onChange: fn => { viewHooks.add(fn); return () => viewHooks.delete(fn); },
    createNavDock, status: (m, k) => app.status(m, k), toast,
    openView: id => openView(id), view: () => cur, isOn: () => on,
    nameOf: id => nameOf(id), findDev: id => findDev(id),
    /** Pose un équipement (schéma logique : place libre) ; rend l'équipement (à compléter, puis ctx.commit()). */
    newDevice: (type, at = {}) => { const d = newDevice(type, new Set(data.devices.map(z => z.name)), { x: at.x ?? 0, y: at.y ?? 0 }); d.id = freeId(type); data.devices.push(d); return d; },
    addCable: (a, b, o) => addCable(a, b, o),
    reveal: id => reveal(id),
    openTester: (segs, names) => openTesterOn(segs, names),
    srcNote: code => srcNote(code)
  };
  function viewsChanged(why = 'change') {
    for (const f of viewHooks) { try { f(why); } catch (e) { console.error(e); } }
    const vw = views[cur]; if (on && cur !== 'logic' && vw) { try { vw.render(why); } catch (e) { console.error(e); } if (vw.libSections || vw.libFilter) renderLib(); }
  }
  function paintViewBar() { host.querySelectorAll('.ntViewBar [data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === cur))); }
  /** Charge (une fois) et montre une vue ; rend une promesse de l'objet de la vue (null pour Logique). */
  function openView(id) {
    if (!VIEWS.some(v => v.id === id)) return Promise.resolve(null);
    if (!on) setMode(true);
    const show = vw => {
      if (cur !== id) {
        const old = views[cur]; if (cur !== 'logic' && old) old.hide();
        cur = id; logicEl.hidden = id !== 'logic';
        if (id === 'logic') { render(); nav.update(); if (pendFit || !touched) requestAnimationFrame(() => { fit(); render(); }); } else if (vw) { vw.show(); vw.render('show'); }
        paintViewBar(); renderPane(); renderLib(); // la bibliothèque suit la vue (filtre, sections propres)
        app.status(VIEWS.find(v => v.id === id).name());
      }
      return vw;
    };
    if (id === 'logic') return Promise.resolve(show(null));
    if (views[id]) return Promise.resolve(show(views[id]));
    if (!viewLoads[id]) viewLoads[id] = VIEW_MODS[id]().then(make => { views[id] = make(ctx); views[id].hide(); return views[id]; }).catch(e => { console.error(e); delete viewLoads[id]; app.status(tl('Cette vue n’a pas pu se charger.'), 'err'); throw e; });
    return viewLoads[id].then(show);
  }
  /** Vue qui montre un objet du modèle (panneau Problèmes) : plans pour les pièces, murs, cheminements ; baies pour les baies. */
  function whereIs(id) {
    if (!id) return 'logic';
    for (const b of (data.site && data.site.buildings) || []) {
      if (b.id === id) return 'plan';
      for (const f of b.floors || []) {
        if (f.id === id) return 'plan';
        for (const k of ['rooms', 'walls', 'doors']) if ((f[k] || []).some(x => x.id === id)) return 'plan';
      }
    }
    if ((data.paths || []).some(p => p.id === id)) return 'plan';
    if ((data.racks || []).some(r => r.id === id)) return 'racks';
    const d = findDev(id);
    if (d && specOf(d).role === 'mech') return 'racks';
    if (d && cur !== 'logic' && views[cur] && views[cur].reveal) return cur;
    return 'logic';
  }
  // Palette de commandes : outils de la simulation (traceroute, disposition, base des VLAN, affichage).
  if (app.commands) {
    const isNet = () => spacesOf(app.kind()).includes('net');
    app.commands.register({ id: 'net.sim.trace', cat: tl('Réseau'), icon: 'traceroute', label: tl('Réseau : traceroute'), keys: 'R', when: isNet, run: () => openView('logic').then(() => setTool('trace')) });
    app.commands.register({ id: 'net.sim.arrange', cat: tl('Réseau'), icon: 'treeLayout', label: tl('Réseau : disposition automatique du schéma'), when: isNet, run: () => openView('logic').then(() => simView('arrange')) });
    app.commands.register({ id: 'net.sim.vlans', cat: tl('Réseau'), icon: 'vlanTag', label: tl('Réseau : base des VLAN'), when: isNet, run: () => openView('logic').then(() => { select(null); app.setTab('nprop'); renderPane(); const v = pane.querySelector('#ntVlanDb'); if (v) import('./kit/index.js').then(k => k.scrollWithin(v, 'start', false)); }) });
    app.commands.register({ id: 'net.sim.vlanview', cat: tl('Réseau'), icon: 'vlanTag', label: tl('Réseau : couleurs des VLAN sur le schéma'), when: isNet, run: () => openView('logic').then(() => simView('vlan')) });
    const many = () => isNet() && on && cur === 'logic' && selDevIds().length > 1;
    for (const [k, label, ic] of [['left', tl('Réseau : aligner à gauche'), 'alignLeft'], ['center', tl('Réseau : aligner au centre'), 'alignCenter'], ['right', tl('Réseau : aligner à droite'), 'alignRight'], ['top', tl('Réseau : aligner en haut'), 'chevUp'], ['middle', tl('Réseau : aligner au milieu'), 'minus'], ['bottom', tl('Réseau : aligner en bas'), 'chevDown'], ['dx', tl('Réseau : répartir horizontalement'), 'alignCenter'], ['dy', tl('Réseau : répartir verticalement'), 'alignCenter']])
      app.commands.register({ id: 'net.sim.align.' + k, cat: tl('Réseau'), icon: ic, label, when: many, run: () => arrangeSel(k) });
    app.commands.register({ id: 'net.sim.dup', cat: tl('Réseau'), icon: 'plus', label: tl('Réseau : dupliquer la sélection'), keys: 'Ctrl+D', when: () => isNet() && on && cur === 'logic' && selDevIds().length > 0, run: duplicateSel });
    app.commands.register({ id: 'net.sim.passive', cat: tl('Réseau'), icon: 'patchPanel', label: tl('Réseau : cacher ou montrer les prises et panneaux'), when: isNet, run: () => openView('logic').then(() => simView('passive')) });
  }
  /** Testeur de certification (certui.js, chargé à la demande). */
  function openCertLazy(o) { return import('./certui.js').then(m => m.openCert(ctx, o)).catch(err => { console.error(err); app.status(tl('Cette vue n’a pas pu se charger.'), 'err'); }); }
  if (app.commands) app.commands.register({ id: 'net.cert.all', cat: tl('Réseau'), icon: 'certifier', label: tl('Réseau : certifier tous les liens'), when: () => spacesOf(app.kind()).includes('net'), run: () => openCertLazy({ batch: true }) });
  if (app.commands) app.commands.register({ id: 'net.exam', cat: tl('Réseau'), icon: 'lock', label: tl('Réseau : mode examen (enseignant)'), when: () => spacesOf(app.kind()).includes('net'), run: () => openView('logic').then(() => setExam(!isExam(data))) });
  // Palette de commandes : changer de vue.
  if (app.commands) for (const [i, v] of VIEWS.entries()) app.commands.register({ id: 'net.view.' + v.id, cat: tl('Réseau'), icon: v.icon, label: tl('Réseau : vue {0}', v.name()), keys: keyLabelNet('Alt+' + (i + 1), MAC_KEYS), when: () => spacesOf(app.kind()).includes('net'), run: () => openView(v.id) });

  /* ---------- Bibliothèque ---------- */
  const lib = document.createElement('aside');
  lib.className = 'panel left ntLib'; lib.setAttribute('aria-label', tl('Bibliothèque réseau'));
  lib.innerHTML = `<nav class="ntRail" aria-label="${tl('Équipements courants')}"><button type="button" class="tb" data-open data-tip="${tl('Déplier la bibliothèque · Ctrl+B')}">${icon('chevsRight')}</button></nav>
    <div class="phead"><h2>${icon('network')}${tl('Réseau')}</h2><span class="count">${Object.keys(DEVICES).length}</span><button type="button" class="tb" data-close data-tip="${tl('Replier · Ctrl+B')}" aria-label="${tl('Replier la bibliothèque')}">${icon('chevsLeft')}</button></div>
    <div class="search">${icon('search')}<input type="search" placeholder="${tl('Rechercher : switch, box, caméra…')}" autocomplete="off" aria-label="${tl('Rechercher un équipement')}"></div>
    <div class="libScroll ntLibList"></div>
    <div class="pfoot"><div class="row"><button type="button" class="btn subtle small" data-labs>${icon('checklist')}<span>${tl('TP de réseau')}</span></button><button type="button" class="btn subtle small" data-catalog data-tip="${tl('Poser un équipement d’après un modèle réel (fiches des fabricants)')}">${icon('search')}<span>${tl('Catalogue…')}</span></button></div></div>`;
  $('#libPanel').after(lib);
  const list = lib.querySelector('.ntLibList'), search = lib.querySelector('input');
  /* Bibliothèque selon la vue : une vue peut filtrer les types (libFilter(type) → bool, ex. Baies : ce qui se monte en
   * baie) et ajouter ses sections en tête (libSections(q) → html : boutons .ntItem[data-dev] d'équipements existants, à
   * glisser vers la vue : dropDev(id, ev | null)) ; pendant un glisser, dragOver({ type, dev } | null, ev) montre la place. */
  function renderLib() {
    const q = norm(search.value.trim()), vw = on && cur !== 'logic' ? views[cur] : null, keep = vw && vw.libFilter ? vw.libFilter : null;
    let html = vw && vw.libSections ? vw.libSections(q) || '' : '';
    for (const [g, types] of LIB_GROUPS) {
      const items = types.filter(t => (!keep || keep(t)) && (!q || norm(`${DEVICES[t].name()} ${t} ${DEVICES[t].doc()}`).includes(q)));
      if (!items.length) continue;
      html += `<h3>${esc(g())}<span>${items.length}</span></h3><div class="ntGrid">${items.map(t => `<button type="button" class="ntItem" data-t="${t}" title="${esc(DEVICES[t].doc())}">${icon(DEVICES[t].icon)}<span>${esc(DEVICES[t].name())}</span></button>`).join('')}</div>`;
    }
    list.innerHTML = html || `<p class="empty">${tl('Aucun équipement ne correspond à cette recherche.')}</p>`;
  }
  renderLib(); search.oninput = renderLib;
  let ghost = null;
  lib.addEventListener('pointerdown', e => {
    const b = e.target.closest('.ntItem'); if (!b || e.button !== 0) return;
    e.preventDefault();
    const t = b.dataset.t, dev = b.dataset.dev || null, sx = e.clientX, sy = e.clientY; let moved = false;
    const over = ev => { const vw = views[cur]; if (cur !== 'logic' && vw && vw.dragOver) { try { vw.dragOver(ev ? { type: t, dev } : null, ev); } catch (err) { console.error(err); } } };
    const mv = ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      moved = true;
      if (!ghost) { ghost = document.createElement('div'); ghost.className = 'ntGhost'; ghost.innerHTML = icon(DEVICES[t].icon); document.body.appendChild(ghost); }
      ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
      over(ev);
    };
    const up = ev => {
      removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true);
      if (ghost) { ghost.remove(); ghost = null; }
      over(null);
      const vw = views[cur];
      if (dev) { if (cur !== 'logic' && vw && vw.dropDev) vw.dropDev(dev, moved ? ev : null); return; }
      if (cur !== 'logic' && vw && vw.drop) { vw.drop(t, moved ? ev : null); return; }
      const r = rectOf();
      if (!moved) { place(t, view.x + r.width / 2 / view.k - DEVICES[t].w / 2, view.y + r.height / 2 / view.k - DEVICES[t].h / 2); return; }
      if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) { const w = toWorld(ev.clientX, ev.clientY); place(t, w.x - DEVICES[t].w / 2, w.y - DEVICES[t].h / 2); }
    };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  });
  lib.addEventListener('contextmenu', e => {
    const b = e.target.closest('.ntItem[data-dev]'), vw = views[cur]; if (!b || cur === 'logic' || !vw || !vw.libMenu) return;
    e.preventDefault(); vw.libMenu(e, b.dataset.dev);
  });
  lib.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) app.setLibOpen(false);
    if (e.target.closest('[data-open]')) app.setLibOpen(true);
    if (e.target.closest('[data-labs]') && app.openLabs) app.openLabs('net');
    if (e.target.closest('[data-catalog]')) { if (!on) setMode(true); import('./catalogui.js').then(m => m.openCatalog(ctx)).catch(err => { console.error(err); app.status(tl('Cette vue n’a pas pu se charger.'), 'err'); }); }
  });
  function place(type, x, y) {
    if (!on) setMode(true);
    // Place libre la plus proche (pas sur un autre appareil).
    const sp = DEVICES[type], boxes = nodes().map(m => { const q = posOf(m), t = specOf(m); return [q.x - 24, q.y - 30, q.x + t.w + 24, q.y + t.h + 30]; });
    const free = (px, py) => !boxes.some(([a, b, c2, d2]) => px < c2 && px + sp.w > a && py < d2 && py + sp.h > b);
    let fx = snap(x), fy = snap(y);
    outer: for (let r = 0; r < 30; r++) for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]]) { const tx = snap(x + dx * r * 40), ty = snap(y + dy * r * 40); if (free(tx, ty)) { fx = tx; fy = ty; break outer; } }
    const d = newDevice(type, new Set(data.devices.map(z => z.name)), { x: fx, y: fy }); d.id = freeId(type);
    data.devices.push(d); sel = { kind: 'dev', id: d.id }; commit();
    app.status(tl('{0} posé. Tirez un câble depuis un de ses ports.', DEVICES[type].name()), 'ok');
    return d;
  }

  /* ---------- Outils : testeur, ping, sertissage, navigateur ---------- */
  function segmentsOf(n, p) { const ch = lan.channel(n, p); return ch && ch.segs.length ? ch.segs : null; }
  function testCable(id) {
    const c = data.cables.find(x => x.id === id); if (!c) return;
    openTesterOn([{ ...c.wire }], { a: nameOf(c.a[0]), b: nameOf(c.b[0]) });
  }
  function testPort(n, p) {
    const segs = segmentsOf(n, p); if (!segs) { app.status(tl('Aucun câble sur ce port.'), 'warn'); return; }
    const ch = lan.channel(n, p);
    openTesterOn(segs, { a: nameOf(n), b: ch.far ? nameOf(ch.far.n) : '?' });
  }
  function openTesterOn(segments, names) {
    if (testerUi) testerUi.close();
    ui.tester = true;
    const exam = isExam(data); // mode examen : voyants et carte de câblage, sans verdict
    testerUi = openTester({ host, segments, names, mode: 'qualification', exam, onClose: () => { testerUi = null; ui.tester = false; } });
    app.log(exam ? tl('Testeur · {0} ↔ {1}', names.a, names.b) : tl('Testeur · {0} ↔ {1} : {2}', names.a, names.b, testerSummary(segments)), 'info');
  }
  function crimp(id, side) {
    const c = data.cables.find(x => x.id === id); if (!c) return;
    if (crimpUi) crimpUi.close();
    ui.crimp = true;
    crimpUi = openCrimp({
      host, end: c.wire[side], side, showStandard: !isExam(data), title: tl('Fiche {0} du câble {1} ↔ {2}', side.toUpperCase(), nameOf(c.a[0]), nameOf(c.b[0])),
      onDone: end => { crimpUi = null; ui.crimp = false; c.wire[side] = { order: end.order.slice(), crimped: !!end.crimped, shorts: (end.shorts || []).slice() }; commit(); },
      onCancel: () => { crimpUi = null; ui.crimp = false; }
    });
  }
  function pingClick(id) {
    const n = nodeById(id); if (!n) return;
    if (!pingFrom) {
      if (!canSend(n)) { app.status(tl('Un ping part d’un appareil qui a une adresse IP (PC, imprimante, carte…).'), 'warn'); return; }
      pingFrom = id; render(); paintHint(); return;
    }
    const from = pingFrom; pingFrom = null; paintHint();
    const f = lan.ipOf(id); doPing(from, f && f.ip ? f.ip : nameOf(id));
  }
  /** Appareil qui a une adresse IP et peut envoyer un ping ou un traceroute (poste, box, routeur, switch de niveau 3). */
  const canSend = n => specOf(n).role === 'host' || n.type === 'router' || specOf(n).role === 'l3' || n.type === 'l3switch';
  function traceClick(id) {
    const n = nodeById(id); if (!n) return;
    if (!traceFrom) {
      if (!canSend(n)) { app.status(tl('Un traceroute part d’un appareil qui a une adresse IP.'), 'warn'); return; }
      traceFrom = id; render(); paintHint(); return;
    }
    const from = traceFrom; traceFrom = null; paintHint();
    const f = lan.ipOf(id); doTrace(from, f && f.ip ? f.ip : nameOf(id));
  }
  /** Traceroute : sauts dessinés sur le schéma, lignes dans le journal (dock Sortie), résultat dans l'inspecteur. */
  function doTrace(from, target) {
    const r = lan.trace(from, target); ui.ping = true;
    const lines = traceLines(r, target, nameOf);
    for (const l of lines) app.log(l, r.ok ? 'info' : 'err');
    if (r.ok) toast(tl('Traceroute {0} → {1} : {2:# saut|# sauts}', nameOf(from), r.ip, r.hops.length), 'ok');
    else toast(tl('Traceroute {0} → {1} : échec, {2}', nameOf(from), r.ip || target, whyText(r.why)), 'err', 6000);
    traceOut = { from, target, r, lines }; render(); renderPane();
    return r;
  }
  function doPing(from, target) {
    const r = lan.ping(from, target); ui.ping = true;
    const who = nameOf(from);
    if (r.ok) { app.log(tl('ping {0} depuis {1} : réponse en {2} ms', r.ip, who, r.ms ?? 0), 'ok'); toast(tl('Ping {0} → {1} : réponse en {2} ms', who, r.ip, r.ms ?? 0), 'ok'); animate(from, r); }
    else { app.log(tl('ping {0} depuis {1} : échec ({2})', r.ip || target, who, whyText(r.why)), 'err'); toast(tl('Ping {0} → {1} : échec, {2}', who, r.ip || target, whyText(r.why)), 'err', 6000); }
    pingOut = { from, target, r }; render(); renderPane();
    return r;
  }
  /** Un point suit le chemin du ping (appareils traversés). */
  function animate(from, r) {
    const pts = [], push = id => { const n = nodeById(id); if (!n) return; const q = posOf(n), s = specOf(n); pts.push([q.x + s.w / 2, q.y + s.h / 2]); };
    push(from);
    for (const h of r.hops || []) for (const step of h.path || []) push(step.to.slice(2));
    if (pts.length < 2) return;
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('r', '6'); dot.setAttribute('class', 'ntPkt'); gOver.appendChild(dot);
    const seg = 380, t0 = performance.now(), path = pts.concat(pts.slice(0, -1).reverse());
    const step = now => {
      const t = (now - t0) / seg, i = Math.floor(t);
      if (i >= path.length - 1 || !dot.isConnected) { dot.remove(); return; }
      const [ax, ay] = path[i], [bx, by] = path[i + 1], f = t - i;
      dot.setAttribute('cx', ax + (bx - ax) * f); dot.setAttribute('cy', ay + (by - ay) * f);
      dot.classList.toggle('back', i >= pts.length - 1);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  /** Navigateur du PC : une page à la fois, dans un cadre sans scripts (le HTML passe par cleanHtml). */
  function openBrowser(from, url) {
    if (!browser) {
      const el = document.createElement('div'); el.className = 'ntBrowser glass'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', tl('Navigateur'));
      el.innerHTML = `<div class="ntBrHead">${icon('globe')}<b></b><span class="grow"></span><button type="button" class="tb" data-br="close" aria-label="${tl('Fermer')}">${icon('x')}</button></div>
        <form class="ntBrUrl"><input class="inp" name="url" spellcheck="false" autocomplete="off" aria-label="${tl('Adresse')}"><button class="btn small primary">${tl('Aller')}</button></form>
        <iframe class="ntBrView" sandbox="" title="${tl('Page reçue')}"></iframe><p class="ntBrStatus"></p>`;
      host.appendChild(el);
      browser = { el, from, path: '' };
      el.querySelector('[data-br="close"]').onclick = () => { el.remove(); browser = null; ui.browser = false; };
      el.querySelector('form').onsubmit = ev => { ev.preventDefault(); go(el.querySelector('input').value); };
      el.querySelector('iframe').addEventListener('load', () => {
        let href = ''; try { href = el.querySelector('iframe').contentWindow.location.href; } catch (err) { return; }
        if (!/^about:blank/.test(href)) return;
        let u; try { u = new URL(href); } catch (err) { return; }
        if (u.hash.startsWith('#jollof:')) { let t = u.hash.slice(8); try { t = decodeURIComponent(t); } catch (err) { /* tel quel */ } go(t); return; }
        const q = [...new URLSearchParams(u.search)], pickQ = k => { const x = q.find(([nm]) => nm === k); return x ? x[1] : null; };
        const act = pickQ('__jollof_action'); if (act == null) return;
        const fields = q.filter(([k]) => !k.startsWith('__jollof_')).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        if (pickQ('__jollof_method') === 'POST') go(act || browser.path, { method: 'POST', body: fields }); else go((act || browser.path.split('?')[0]) + (fields ? '?' + fields : ''));
      });
    }
    ui.browser = true;
    browser.from = from; browser.el.querySelector('.ntBrHead b').textContent = tl('Navigateur de {0}', nameOf(from));
    const go = async (target, o = {}, hops = 0) => {
      const b = browser; if (!b) return;
      let u; try { u = new URL(String(target || '/').trim(), b.base || 'http://192.168.1.1/'); } catch (err) { b.el.querySelector('.ntBrStatus').textContent = tl('Adresse invalide'); return; }
      if (u.protocol !== 'http:') { b.el.querySelector('.ntBrStatus').textContent = tl('Seules les adresses http:// du réseau simulé répondent.'); return; }
      b.base = u.origin + '/'; b.path = u.pathname + u.search;
      b.el.querySelector('input').value = u.href;
      b.el.querySelector('.ntBrStatus').textContent = tl('Chargement…');
      const r = await lan.http(b.from, u.href, o);
      if (r.code >= 300 && r.code < 400 && hops < 3) { const loc = /\r\nlocation:\s*([^\r\n]+)/i.exec('\r\n' + (r.raw || '').split('\r\n\r\n')[0]); if (loc) { go(loc[1], {}, hops + 1); return; } }
      const fr = b.el.querySelector('iframe');
      if (!r.code) { fr.srcdoc = ''; b.el.querySelector('.ntBrStatus').textContent = tl('Échec : {0}', whyText(r.why)); app.log(tl('navigateur de {0} : {1} injoignable ({2})', nameOf(b.from), u.host, whyText(r.why)), 'err'); return; }
      fr.srcdoc = /html/i.test(r.type) ? routed(cleanHtml(r.body)) : `<pre style="white-space:pre-wrap;font:12px ui-monospace,monospace;margin:8px">${esc(r.body)}</pre>`;
      b.el.querySelector('.ntBrStatus').textContent = tl('{0} · {1} · {2} octets', r.code, r.type, new TextEncoder().encode(r.body).length);
      app.log(tl('navigateur de {0} : {1} → {2}', nameOf(b.from), u.href, r.code), 'ok');
    };
    browser.go = go;
    if (url) go(url);
  }
  function routed(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const a of doc.querySelectorAll('a[href]')) { const h = a.getAttribute('href'); a.removeAttribute('target'); if (!h.startsWith('#')) a.setAttribute('href', 'about:blank#jollof:' + encodeURIComponent(h)); }
    for (const f of doc.querySelectorAll('form')) {
      const add = (n, v) => { const i = doc.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); };
      add('__jollof_action', f.getAttribute('action') || ''); add('__jollof_method', /^post$/i.test(f.getAttribute('method') || '') ? 'POST' : 'GET');
      f.setAttribute('action', 'about:blank'); f.setAttribute('method', 'get'); f.removeAttribute('target');
    }
    return '<!doctype html>' + doc.documentElement.outerHTML;
  }

  /* ---------- Inspecteur ---------- */
  const tabs = $('.panel.right .tabs');
  tabs.insertAdjacentHTML('beforeend', `<button type="button" role="tab" class="tab ntTab" id="tab-nprop" aria-controls="pane-nprop" aria-selected="false">${icon('network')}${tl('Réseau')}</button>`);
  const pane = document.createElement('div'); pane.className = 'pane ntPane'; pane.id = 'pane-nprop'; pane.setAttribute('role', 'tabpanel'); pane.hidden = true;
  $('#modPane').before(pane);
  $('#tab-nprop').onclick = () => { app.setTab('nprop'); renderPane(); };
  // L'inspecteur d'une vue (pièce, mur, cheminement, baie…) traite ses propres champs avant ceux des équipements.
  for (const t of ['change', 'click', 'input', 'submit']) pane.addEventListener(t, e => { const vw = views[cur]; if (cur !== 'logic' && vw && vw.paneEvent && vw.paneEvent(e, sel) === true) { e.stopImmediatePropagation(); if (t === 'submit') e.preventDefault(); } }, true);
  let paneT = 0;
  const renderPaneSoon = () => { clearTimeout(paneT); paneT = setTimeout(renderPane, 120); };
  const field = (label, html, tip = '') => `<label class="ntF"${tip ? ` data-tip="${esc(tip)}"` : ''}><span>${label}</span>${html}</label>`;
  const inp = (k, v, o = '') => `<input class="inp" data-k="${k}" value="${esc(v ?? '')}" ${o}>`;
  const chk = (k, v, label) => `<label class="ntChk"><input type="checkbox" data-k="${k}"${v ? ' checked' : ''}><span>${label}</span></label>`;
  /** Port « dev · port » lisible. */
  const endTxt = e => { const d = findDev(e[0]), p = d ? portsOf(d).find(x => x.id === e[1]) : null; return `${nameOf(e[0])} · ${p ? p.label : e[1]}`; };
  /**
   * Ligne d'un port passif (prise, panneau) : le cordon branché ici, l'autre face (lien permanent) et, au bout de chaque
   * côté, l'appareil actif ; l'état est celui du lien entre ces deux appareils (comme « Lié à », relate.js).
   */
  function passiveRow(ix, n, p) {
    const c = cableAt(n.id, p.id), back = cableAt(n.id, p.passive);
    const end = hops => { const h = hops[hops.length - 1]; return h && !h.pass ? h.to : null; };
    const ea = c ? end(relWalk(ix, n.id, p.id)) : null, eb = back ? end(relWalk(ix, n.id, p.passive)) : null;
    const near = c ? (c.a[0] === n.id && c.a[1] === p.id ? c.b : c.a) : null;
    const l = ea ? lan.port(ea[0], ea[1]) : eb ? lan.port(eb[0], eb[1]) : null;
    const peer = near ? endTxt(near) : back ? `<span class="mut">${tl('aucun cordon')}</span>` : '';
    const same = (x, y) => x && y && x[0] === y[0] && x[1] === y[1];
    const ends = eb || (ea && !same(ea, near)) ? `<small class="mut">${esc(ea ? endTxt(ea) : '—')} ↔ ${esc(eb ? endTxt(eb) : '—')}</small>` : '';
    const st = !c && !back ? `<span class="mut">${tl('libre')}</span>` : !(ea && eb) ? `<span class="mut">${tl('pas d’appareil au bout')}</span>`
      : !l ? '' : l.up ? `<b class="ok">${speedTxt(l.speed)}</b>${l.errors ? ` · <b class="bad">${tl('erreurs')}</b>` : ''}` : `<b class="bad">${tl('pas de lien')}</b> <small>${esc(whyText(l.why))}</small>`;
    return `<tr><td><i class="led ${ledCls(ea && eb ? l : null)}"></i>${esc(p.label)}</td><td>${near ? esc(peer) : peer}${ends ? '<br>' + ends : ''}</td><td>${st}</td></tr>`;
  }
  function portRows(n) {
    let ix = null;
    return portsOf(n).filter(p => !p.punch || cableAt(n.id, p.id)).map(p => {
      if (p.passive) return passiveRow(ix || (ix = relIndex(data)), n, p);
      const l = lan.port(n.id, p.id), c = cableAt(n.id, p.id);
      const peer = l && l.peer ? nameOf(l.peer.n) : c ? (lan.channel(n.id, p.id) && lan.channel(n.id, p.id).far ? nameOf(lan.channel(n.id, p.id).far.n) : '—') : '';
      const st = !c ? `<span class="mut">${tl('libre')}</span>` : !l ? '' : l.up ? `<b class="ok">${speedTxt(l.speed)}</b>${l.mdix ? ' · Auto-MDIX' : ''}${l.errors ? ` · <b class="bad">${tl('erreurs')}</b>` : ''}${l.notes.includes('downshift') ? ' · ' + tl('rétrogradé') : ''}` : `<b class="bad">${tl('pas de lien')}</b> <small>${esc(whyText(l.why))}</small>`;
      return `<tr><td><i class="led ${ledCls(l)}"></i>${esc(p.label)}</td><td>${esc(peer)}</td><td>${st}</td></tr>`;
    }).join('');
  }
  /**
   * Fautes du plan ; en examen, sans celles qui donnent la réponse : J1201, J1202 (câblage des fiches, à trouver au
   * testeur), J1286, J1287 (verdict de la certification, à conclure des mesures).
   */
  const EXAM_HIDDEN = new Set(['J1201', 'J1202', 'J1286', 'J1287']);
  // Fautes du plan, gardées tant que ni le réseau simulé (version) ni le modèle enregistré (instantané) n'ont changé :
  // l'inspecteur, le panneau Problèmes et les vues les demandent plusieurs fois par modification.
  let issMemo = null;
  function shownIssues() {
    if (issMemo && issMemo.ver === lan.version && issMemo.snap === snapshot && issMemo.exam === isExam(data)) return issMemo.iss;
    const all = netIssues(lan, data), iss = isExam(data) ? all.filter(i => !EXAM_HIDDEN.has(i.code)) : all;
    issMemo = { ver: lan.version, snap: snapshot, exam: isExam(data), iss };
    return iss;
  }
  /** Mode examen : pastille dans la barre des vues (l'enlever : hors séance, après confirmation). */
  function paintExam() { const b = host.querySelector('[data-exam]'), on = isExam(data); b.hidden = !on; b.dataset.tip = examLocked(app.sessions) ? tl('Mode examen : verrouillé pendant la séance') : tl('Mode examen : sertissage, testeur et inspecteur ne donnent pas la réponse. Cliquer pour le retirer.'); }
  /**
   * Met (on) ou retire le mode examen. Mettre : code enseignant facultatif (deux fois, 6 caractères au moins), gardé
   * haché (exam.js). Retirer : impossible pendant une séance ; avec un code, il le faut (3 erreurs : attente croissante).
   */
  const tries = attempts();
  const codeField = (name, label) => `<label class="sField"><span>${label}</span><input class="sInput" type="password" name="${name}" autocomplete="off" spellcheck="false"></label>`;
  async function setExam(on) {
    if (isExam(data) === on) return;
    if (examLocked(app.sessions)) { app.status(tl('Mode examen : verrouillé pendant la séance'), 'warn'); return; }
    if (on) {
      const r = await dialogDlg({
        title: tl('Mettre le mode examen'),
        body: `<p class="dlgText">${tl('Le sertissage, le testeur, la certification et l’inspecteur ne donneront plus la réponse.')}</p>${codeField('c1', tl('Code enseignant (facultatif, {0} caractères au moins)', CODE_MIN))}${codeField('c2', tl('Le même code, une deuxième fois'))}<p class="dlgText mut">${tl('Sans code, n’importe qui peut retirer le mode examen. Avec un code, il le faut, sauf à modifier le fichier du projet à la main : gardez votre propre copie pour corriger.')}</p><p class="dlgText ntExamErr" role="alert"></p>`,
        actions: [{ label: CANCEL, value: null }, { label: tl('Mettre le mode examen'), value: 'ok', kind: 'primary' }],
        onAction: async (v, root) => {
          if (v !== 'ok') return undefined;
          const c1 = root.querySelector('[name="c1"]').value, c2 = root.querySelector('[name="c2"]').value, err = root.querySelector('.ntExamErr');
          if (c1 !== c2) { err.textContent = tl('Les deux codes diffèrent.'); return false; }
          if (c1 && c1.length < CODE_MIN) { err.textContent = tl('Code trop court : {0} caractères au moins.', CODE_MIN); return false; }
          return { lock: c1 ? await makeLock(c1) : null };
        }
      });
      if (!r || typeof r !== 'object') return;
      data.exam = true; if (r.lock) data.examLock = r.lock; else delete data.examLock;
      commit(); app.status(r.lock ? tl('Mode examen : les verdicts sont cachés (code enseignant pour le retirer)') : tl('Mode examen : les verdicts sont cachés'), 'ok');
      return;
    }
    if (data.examLock) {
      const r = await dialogDlg({
        title: tl('Retirer le mode examen ?'),
        body: `${codeField('c', tl('Code enseignant'))}<p class="dlgText ntExamErr" role="alert"></p>`,
        actions: [{ label: CANCEL, value: null }, { label: tl('Retirer'), value: 'ok', kind: 'primary' }],
        onAction: async (v, root) => {
          if (v !== 'ok') return undefined;
          const err = root.querySelector('.ntExamErr'), w = tries.wait();
          if (w) { err.textContent = tl('Trop d’essais : réessayez dans {0} s.', Math.ceil(w / 1000)); return false; }
          if (await checkLock(data.examLock, root.querySelector('[name="c"]').value)) { tries.ok(); return 'ok'; }
          tries.fail(); err.textContent = tl('Code incorrect.'); return false;
        }
      });
      if (r !== 'ok') return;
    } else if (!(await confirmDlg(tl('Retirer le mode examen ?'), tl('Le sertissage, le testeur et l’inspecteur montreront de nouveau les verdicts.'), tl('Retirer')))) return;
    delete data.exam; delete data.examLock;
    commit(); app.status(tl('Mode examen retiré'), 'ok');
  }
  function renderPane() {
    paintExam();
    if (!on && pane.hidden) return;
    const vw = views[cur];
    if (cur !== 'logic' && vw && vw.pane) { const vh = vw.pane(sel); if (vh != null) { pane.innerHTML = vh; return; } }
    if (cur === 'logic' && msel.length > 1) { multiPane(); return; }
    const st = lan.state(); let h = '';
    const n = selNode(), c = sel && sel.kind === 'cable' ? data.cables.find(x => x.id === sel.id) : null;
    if (n) {
      const s = specOf(n), P = n.p || {}, f = st.ifaces.find(x => x.node === n.id && (x.role === 'host' || x.role === 'lan')), pw = st.power.get(n.id);
      h += `<div class="ntHead">${icon(s.icon)}<div><b>${esc(n.name || s.name())}</b><small>${esc(s.name())}</small></div>${n.ext ? '' : `<button type="button" class="tb" data-a="del" data-tip="${tl('Retirer cet équipement')}" aria-label="${tl('Retirer')}">${icon('trash')}</button>`}</div>`;
      h += `<p class="ntDoc ntDocClamp" data-a="doc" title="${tl('Clic : tout lire')}">${esc(n.ext ? (n.type === 'wifi' ? tl('Carte du montage : elle rejoint un point d’accès par son programme (WiFi.begin).') : tl('Module Ethernet du montage : son adresse vient du programme de la carte (Ethernet.begin).')) : s.doc())}</p>`;
      if (!n.ext) h += `<section class="ntSec">${field(tl('Nom'), inp('name', n.name, 'maxlength="24"'))}</section>`;
      // Modèle réel du catalogue (catalog.js) : référence, ports, PoE, puissance et encombrement de la fiche du fabricant.
      if (!n.ext && MODEL_TYPES.has(n.type)) h += `<section class="ntSec"><h4>${tl('Modèle réel')}</h4><p class="ntDoc">${n.model ? esc(modelLabel(n.model)) : tl('Modèle générique (aucune référence de fabricant).')}</p><button type="button" class="btn small" data-nt="model">${icon('search')}<span>${n.model ? tl('Changer de modèle…') : tl('Choisir un modèle réel…')}</span></button></section>`;
      if (pw && !pw.on) h += `<p class="ntWarn">${icon('alert')}${tl('Éteint : {0}', whyText(pw.why))}</p>`;
      else if (pw && pw.w) h += `<p class="ntOk">${icon('zap')}${tl('Alimenté par PoE : classe {0}, {1} W réservés sur le switch.', pw.cls, pw.w)}</p>`;
      const rows = MANAGED.has(n.type) ? '' : portRows(n); // switch administrable : tableau des ports plus bas (simpane.js)
      if (rows) h += `<section class="ntSec"><h4>${tl('Ports')}</h4><table class="ntTable"><tr><th>${tl('Port')}</th><th>${tl('Relié à')}</th><th>${tl('État')}</th></tr>${rows}</table></section>`;
      if (s.role === 'host') {
        h += `<section class="ntSec"><h4>${tl('Adresse IP')}</h4>`;
        if (f && f.ip) h += `<p class="ntIpNow"><b>${esc(f.ip)}</b>/${f.prefix} <small>(${esc(maskStr(f.prefix))})</small>${f.gw ? ` · ${tl('passerelle')} ${esc(f.gw)}` : ''} · <small>${esc({ dhcp: tl('donnée par DHCP'), static: tl('fixe'), apipa: tl('aucun serveur DHCP'), program: tl('fixée par le programme') }[f.src] || '')}</small></p>`;
        else h += `<p class="mut">${tl('Pas encore d’adresse.')}</p>`;
        if (!n.ext && P.ip) {
          h += `<div class="seg ntMode" role="group"><button type="button" class="segBtn" data-ipmode="dhcp" aria-pressed="${P.ip.mode !== 'static'}">DHCP</button><button type="button" class="segBtn" data-ipmode="static" aria-pressed="${P.ip.mode === 'static'}">${tl('Adresse fixe')}</button></div>`;
          if (P.ip.mode === 'static') h += field(tl('Adresse'), inp('ip.ip', P.ip.ip, 'placeholder="192.168.1.20" spellcheck="false"')) + field(tl('Masque'), inp('ip.prefix', '/' + P.ip.prefix, 'placeholder="/24 ou 255.255.255.0" spellcheck="false"')) + field(tl('Passerelle'), inp('ip.gw', P.ip.gw, 'placeholder="192.168.1.1" spellcheck="false"'));
        }
        h += '</section>';
        if ('legacy' in P) h += `<section class="ntSec">${chk('legacy', P.legacy, tl('Appareil ancien : 100 Mb/s, sans Auto-MDIX'))}</section>`;
        if (n.type === 'laptop') h += `<section class="ntSec"><h4>Wi-Fi</h4>${field(tl('Réseau (SSID)'), inp('wifi.ssid', P.wifi.ssid, 'maxlength="32"'))}${field(tl('Mot de passe'), inp('wifi.pass', P.wifi.pass, 'maxlength="63"'))}${st.wifiAssoc.get(n.id) ? `<p class="ntOk">${tl('Connecté à {0}', nameOf(st.wifiAssoc.get(n.id)))}</p>` : st.wifiWhy.get(n.id) ? `<p class="ntWarn">${esc(whyText('wifi:' + st.wifiWhy.get(n.id)))}</p>` : ''}</section>`;
        if ('poeClass' in P) h += `<section class="ntSec"><h4>PoE</h4>${field(tl('Classe PoE'), `<select class="sel" data-k="poeClass">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => `<option value="${k}"${k === P.poeClass ? ' selected' : ''}>${k}</option>`).join('')}</select>`)}${chk('adapter', P.power === 'adapter', tl('Alimenté par son propre bloc secteur'))}</section>`;
        // Ping et navigateur.
        h += `<section class="ntSec"><h4>Ping</h4><form class="ntPing" data-form="ping"><input class="inp" name="t" placeholder="${tl('adresse ou nom')}" title="${tl('adresse ou nom (ex. 192.168.1.1, PC2)')}" spellcheck="false" value="${esc(pingOut && pingOut.from === n.id ? pingOut.target : '')}"><button class="btn small primary" data-nt="ping">${icon('ping')}<span>Ping</span></button><button type="button" class="btn small" data-nt="trace">${icon('traceroute')}<span>Traceroute</span></button></form>`;
        if (pingOut && pingOut.from === n.id) { const r = pingOut.r; h += `<pre class="ntPingOut ${r.ok ? 'ok' : 'bad'}">${esc(pingText(r, pingOut.target))}</pre>`; }
        h += traceBlock(n) + '</section>';
        if (n.type === 'pc' || n.type === 'laptop') h += `<section class="ntSec"><button type="button" class="btn small" data-nt="browser">${icon('globe')}<span>${tl('Ouvrir le navigateur')}</span></button></section>`;
      }
      if (n.type === 'router') {
        h += `<section class="ntSec"><h4>${tl('Réseau local (LAN)')}</h4>${field(tl('Adresse de la box'), inp('lan.ip', P.lan.ip, 'spellcheck="false"'))}${field(tl('Masque'), inp('lan.prefix', '/' + P.lan.prefix, 'spellcheck="false"'))}</section>`;
        h += `<section class="ntSec"><h4>DHCP</h4>${chk('dhcp.on', P.dhcp.on, tl('Serveur DHCP actif'))}${field(tl('Première adresse (.x)'), inp('dhcp.from', P.dhcp.from, 'type="number" min="1" max="254"'))}${field(tl('Dernière adresse (.x)'), inp('dhcp.to', P.dhcp.to, 'type="number" min="1" max="254"'))}`;
        const leases = st.ifaces.filter(x => x.server === n.id);
        h += leases.length ? `<table class="ntTable"><tr><th>${tl('Appareil')}</th><th>IP</th></tr>${leases.map(x => `<tr><td>${esc(nameOf(x.node))}</td><td>${esc(x.ip)}</td></tr>`).join('')}</table>` : `<p class="mut">${tl('Aucun bail pour l’instant.')}</p>`;
        h += `</section><section class="ntSec"><h4>WAN</h4><div class="seg ntMode" role="group">${['none', 'dhcp', 'static'].map(m => `<button type="button" class="segBtn" data-wanmode="${m}" aria-pressed="${P.wan.mode === m}">${{ none: tl('Aucun'), dhcp: 'DHCP', static: tl('Fixe') }[m]}</button>`).join('')}</div>`;
        if (P.wan.mode === 'static') h += field(tl('Adresse'), inp('wan.ip', P.wan.ip, 'spellcheck="false"')) + field(tl('Masque'), inp('wan.prefix', '/' + P.wan.prefix, 'spellcheck="false"')) + field(tl('Passerelle'), inp('wan.gw', P.wan.gw, 'spellcheck="false"'));
        const wf = st.ifaces.find(x => x.node === n.id && x.role === 'wan'); if (wf) h += `<p class="ntIpNow">WAN : <b>${esc(wf.ip)}</b>/${wf.prefix}</p>`;
        h += `</section><section class="ntSec"><h4>Wi-Fi</h4>${chk('wifi.on', P.wifi.on, tl('Wi-Fi de la box actif'))}${P.wifi.on ? field(tl('Nom (SSID)'), inp('wifi.ssid', P.wifi.ssid, 'maxlength="32"')) + field(tl('Mot de passe'), inp('wifi.pass', P.wifi.pass, 'maxlength="63"')) : ''}</section>`;
      }
      if (s.role === 'ap') h += `<section class="ntSec"><h4>Wi-Fi</h4>${field(tl('Nom (SSID)'), inp('ssid', P.ssid, 'maxlength="32"'))}${field(tl('Mot de passe'), inp('pass', P.pass, 'maxlength="63"'))}${chk('adapter', P.power === 'adapter', tl('Alimenté par son propre bloc secteur'))}<p class="mut">${tl('{0:# appareil connecté|# appareils connectés}', [...st.wifiAssoc.values()].filter(x => x === n.id).length)}</p></section>`;
      if (s.role !== 'host' && canSend(n) && n.type !== 'router') {
        // Routeur, switch de niveau 3 : ping et traceroute depuis l'équipement (il choisit sa sortie dans sa table).
        h += `<section class="ntSec"><h4>${tl('Ping et traceroute')}</h4><form class="ntPing" data-form="ping"><input class="inp" name="t" placeholder="${tl('adresse ou nom')}" title="${tl('adresse ou nom (ex. 192.168.1.1, PC2)')}" spellcheck="false" value="${esc(traceOut && traceOut.from === n.id ? traceOut.target : pingOut && pingOut.from === n.id ? pingOut.target : '')}"><button class="btn small primary" data-nt="ping">${icon('ping')}<span>Ping</span></button><button type="button" class="btn small" data-nt="trace">${icon('traceroute')}<span>Traceroute</span></button></form>`;
        if (pingOut && pingOut.from === n.id) { const r = pingOut.r; h += `<pre class="ntPingOut ${r.ok ? 'ok' : 'bad'}">${esc(pingText(r, pingOut.target))}</pre>`; }
        h += traceBlock(n) + '</section>';
      }
      h += simPane(ctx, n); // VLAN, Spanning Tree, agrégats, interfaces, routes, DHCP, ACL, NAT, DNS
      if ('budget' in P && s.role === 'switch' && n.type !== 'poeswitch') { const pi = st.poe.get(n.id) || { used: 0, budget: P.budget }; h += `<section class="ntSec"><h4>${tl('Budget PoE')}</h4><div class="ntGauge"><i style="width:${Math.min(100, (pi.used / (pi.budget || 1)) * 100)}%"></i></div><p>${tl('{0} W réservés sur {1} W', Math.round(pi.used * 100) / 100, pi.budget)}</p>${field(tl('Budget total (W)'), inp('budget', P.budget, 'type="number" min="0" max="5000"'))}</section>`; }
      if (n.type === 'poeswitch') { const pi = st.poe.get(n.id) || { used: 0, budget: P.budget }; h += `<section class="ntSec"><h4>${tl('Budget PoE')}</h4><div class="ntGauge"><i style="width:${Math.min(100, (pi.used / (pi.budget || 1)) * 100)}%"></i></div><p>${tl('{0} W réservés sur {1} W', Math.round(pi.used * 100) / 100, pi.budget)}</p>${field(tl('Budget total (W)'), inp('budget', P.budget, 'type="number" min="0" max="2000"'))}${field(tl('Norme des ports'), `<select class="sel" data-k="pseType">${[['af', '802.3af (15,4 W)'], ['at', '802.3at (30 W)'], ['bt3', '802.3bt type 3 (60 W)'], ['bt4', '802.3bt type 4 (90 W)']].map(([k, l]) => `<option value="${k}"${P.pseType === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}</section>`; }
      if (s.role === 'switch') {
        const mt = lan.macTable(n.id);
        h += `<section class="ntSec"><h4>${tl('Table des adresses MAC')}</h4>${mt.length ? `<table class="ntTable mono"><tr><th>MAC</th><th>${tl('Port')}</th><th>${tl('Appareil')}</th></tr>${mt.map(m => `<tr><td>${esc(m.mac)}</td><td>${esc(m.port)}</td><td>${esc(m.node ? nameOf(m.node) : '?')}</td></tr>`).join('')}</table><button type="button" class="btn small subtle" data-a="clearmac">${tl('Vider la table')}</button>` : `<p class="mut">${tl('Vide : le switch apprend une adresse quand une trame arrive sur un port (faites un ping).')}</p>`}</section>`;
      }
      if (n.type === 'broker') {
        const b = lan.broker(n.id);
        const tp = b ? b.topics() : [], cl = b ? b.clients() : [];
        h += `<section class="ntSec"><h4>${tl('Sujets MQTT')}</h4>${tp.length ? `<table class="ntTable"><tr><th>${tl('Sujet')}</th><th>${tl('Dernier message')}</th><th>${tl('De')}</th></tr>${tp.map(t => `<tr><td class="mono">${esc(t.topic)}</td><td><b>${esc(String(t.text).slice(0, 60))}</b></td><td><small>${esc(t.from)}</small></td></tr>`).join('')}</table>` : `<p class="mut">${tl('Aucun message pour l’instant.')}</p>`}
          <form class="ntPub" data-form="pub"><input class="inp" name="topic" placeholder="${tl('sujet, ex. atelier/led')}" spellcheck="false"><input class="inp" name="msg" placeholder="${tl('message, ex. ON')}"><button class="btn small primary">${icon('send')}<span>${tl('Publier')}</span></button></form>
          <p class="mut">${tl('Clients connectés : {0}', cl.length ? cl.map(x => `${x.id}${x.subs.length ? ' (' + x.subs.join(', ') + ')' : ''}`).join(' · ') : tl('aucun'))}</p></section>`;
      }
      if (n.type === 'plc') {
        const bk = lan.bank(n.id);
        const row = (t, label, bit) => `<tr><th>${label}</th>${Array.from({ length: 8 }, (_, i) => { const v = bk ? bk.read(t, i) : 0; return `<td>${bit ? `<button type="button" class="ntBit${v ? ' on' : ''}" data-reg="${t}:${i}" aria-pressed="${!!v}">${i}</button>` : `<input class="inp ntReg" data-reg="${t}:${i}" type="number" min="0" max="65535" value="${v}">`}</td>`; }).join('')}</tr>`;
        h += `<section class="ntSec"><h4>${tl('Registres Modbus (port 502)')}</h4><table class="ntTable ntRegs">${row('coils', tl('Bobines'), true)}${row('di', tl('Entrées'), true)}${row('hr', tl('Registres'), false)}${row('ir', tl('Reg. entrée'), false)}</table><p class="mut">${tl('Les bobines et les registres de maintien s’écrivent ici ou par un client Modbus TCP.')}</p></section>`;
      }
    } else if (c) {
      const r = analyzeCable(c.wire), A = nodeById(c.a[0]), B = nodeById(c.b[0]);
      const exam = isExam(data); // mode examen : ni conformité des fiches, ni résultat du test, ni défaut caché
      const v = e => (!e.crimped ? tl('non sertie') : exam ? tl('sertie') : crimpVerdict(e.order, false).head);
      h += `<div class="ntHead">${icon('cable')}<div><b>${tl('Câble {0} ↔ {1}', esc(A ? nameOf(A.id) : '?'), esc(B ? nameOf(B.id) : '?'))}</b><small>${esc(CATS[c.cat].name)} · ${c.len} m</small></div><button type="button" class="tb" data-a="delcable" data-tip="${tl('Retirer ce câble')}" aria-label="${tl('Retirer')}">${icon('trash')}</button></div>`;
      h += `<div class="ntCableArt">${cableSvg(c.wire, exam)}</div>`;
      h += exam ? `<p class="mut">${icon('lock')} ${tl('Mode examen : passez le câble au testeur et concluez vous-même.')}</p>` : `<p class="${r.faults.length || r.kind === 'none' ? 'ntWarn' : 'ntOk'}">${esc(testerSummary([c.wire]))}</p>`;
      h += `<section class="ntSec"><div class="ntEnds"><div><b>${tl('Fiche A')}</b> <small>${esc(A ? nameOf(A.id) : '')}</small><span>${esc(v(c.wire.a))}</span><button type="button" class="btn small" data-nt="crimpA">${icon('rj45')}<span>${tl('Sertir')}</span></button></div>
        <div><b>${tl('Fiche B')}</b> <small>${esc(B ? nameOf(B.id) : '')}</small><span>${esc(v(c.wire.b))}</span><button type="button" class="btn small" data-nt="crimpB">${icon('rj45')}<span>${tl('Sertir')}</span></button></div></div>
        <button type="button" class="btn small primary" data-nt="test">${icon('cableTester')}<span>${tl('Passer au testeur')}</span></button></section>`;
      if (c.media === 'fibre') h += `<section class="ntSec"><button type="button" class="btn small" data-nt="fibre">${icon('fibre')}<span>${tl('Bilan optique')}</span></button></section>`;
      else h += `<section class="ntSec"><button type="button" class="btn small" data-nt="cert" data-tip="${tl('Certification simulée : carte de câblage, longueur, affaiblissement, diaphonie, pertes en retour')}">${icon('certifier')}<span>${tl('Certifier ce lien')}</span></button></section>`;
      h += `<section class="ntSec">${field(tl('Catégorie'), `<select class="sel" data-ck="cat">${CAT_IDS.map(k => `<option value="${k}"${k === c.cat ? ' selected' : ''}>${CATS[k].name} (${CATS[k].mhz} MHz)</option>`).join('')}</select>`)}${field(tl('Longueur (m)'), `<input class="inp" data-ck="len" type="number" min="0.1" max="500" step="0.5" value="${c.len}">`)}</section>`;
      if (exam) h += `<section class="ntSec"><h4>${tl('Remplacer')}</h4><div class="row"><button type="button" class="btn small subtle" data-a="renew" data-v="blank">${tl('À sertir')}</button></div></section>`;
      else h += `<section class="ntSec"><h4>${tl('Remplacer')}</h4><div class="row"><button type="button" class="btn small subtle" data-a="renew" data-v="straight">${tl('Câble droit neuf')}</button><button type="button" class="btn small subtle" data-a="renew" data-v="crossover">${tl('Câble croisé neuf')}</button><button type="button" class="btn small subtle" data-a="renew" data-v="blank">${tl('À sertir')}</button></div>
        <details class="ntFault"><summary>${tl('Défaut à cacher (enseignant)')}</summary><p class="mut">${tl('Coupe un conducteur à l’intérieur du câble : le testeur le montrera ouvert.')}</p><div class="row">${['wo', 'o', 'wg', 'bl', 'wbl', 'g', 'wbr', 'br'].map(w => `<label class="ntChk"><input type="checkbox" data-cut="${w}"${c.wire.cut.includes(w) ? ' checked' : ''}><span>${esc(tl({ wo: 'blanc-orange', o: 'orange', wg: 'blanc-vert', bl: 'bleu', wbl: 'blanc-bleu', g: 'vert', wbr: 'blanc-marron', br: 'marron' }[w]))}</span></label>`).join('')}</div></details></section>`;
    } else {
      const iss = shownIssues();
      h += `<div class="ntHead">${icon('network')}<div><b>${tl('Plan réseau')}</b><small>${tl('{0:# équipement|# équipements}, {1:# câble|# câbles}', data.devices.length, data.cables.length)}</small></div></div>`;
      h += `<p class="ntDoc">${tl('Cliquez un équipement ou un câble pour voir ses réglages. Les problèmes du plan sont dans le panneau Problèmes ({0}).', keyLabelNet('Mod+Shift+M', MAC_KEYS))}</p>`;
      h += iss.length ? `<section class="ntSec"><h4>${tl('À corriger')}</h4><ul class="ntIss">${iss.slice(0, 12).map((i, k) => `<li class="${i.kind}" data-iss="${k}"><code>${i.code}</code> ${esc(i.text)}</li>`).join('')}</ul></section>` : `<p class="ntOk">${icon('check')}${tl('Aucun problème dans le plan réseau.')}</p>`;
      h += (data.vlans || []).length || data.devices.some(x => MANAGED.has(x.type)) ? vlanDbPane(ctx) : `<details class="ntSec ntSmFold"><summary>${icon('vlanTag')}${tl('Base des VLAN du projet')}</summary>${vlanDbPane(ctx)}</details>`;
      const ev = lan.events().slice(-8).reverse();
      if (ev.length) h += `<section class="ntSec"><h4>${tl('Derniers échanges')}</h4><ul class="ntEv">${ev.map(e => `<li>${esc(eventText(e))}</li>`).join('')}</ul></section>`;
    }
    pane.innerHTML = h;
  }
  /**
   * Inspecteur d'une sélection multiple (sous la modification groupée de ia.js, qui montre le nombre d'objets et leurs
   * réglages communs) : aligner, répartir, copier, dupliquer, retirer.
   */
  function multiPane() {
    const list = msel.slice(), devs = list.filter(x => x.kind === 'dev' && findDev(x.id));
    const B = (a, ic, tip) => `<button type="button" class="tb" data-arr="${a}" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${icon(ic)}</button>`;
    let h = '';
    if (devs.length > 1) h += `<section class="ntSec ntSm"><h4>${tl('Disposition')}</h4><div class="row ntSmArr">${B('left', 'alignLeft', tl('Aligner à gauche'))}${B('center', 'alignCenter', tl('Aligner au centre'))}${B('right', 'alignRight', tl('Aligner à droite'))}<span class="ntSmSep"></span>${B('top', 'chevUp', tl('Aligner en haut'))}${B('middle', 'minus', tl('Aligner au milieu'))}${B('bottom', 'chevDown', tl('Aligner en bas'))}</div><div class="row"><button type="button" class="btn small subtle" data-arr="dx">${tl('Répartir ↔')}</button><button type="button" class="btn small subtle" data-arr="dy">${tl('Répartir ↕')}</button></div></section>`;
    h += `<section class="ntSec ntSm"><h4>${tl('Sélection')}</h4><div class="row">${devs.length ? `<button type="button" class="btn small" data-arr="copy" data-tip="Ctrl+C">${icon('copy')}<span>${tl('Copier')}</span></button><button type="button" class="btn small" data-arr="dup" data-tip="Ctrl+D">${icon('plus')}<span>${tl('Dupliquer')}</span></button>` : ''}<button type="button" class="btn small danger" data-a="del" data-tip="${tl('Suppr')}">${icon('trash')}<span>${tl('Retirer la sélection')}</span></button></div>
      <p class="mut ntSmNote">${tl('Maj + clic : ajouter ou retirer un objet · glisser un objet choisi : tout suit · flèches : déplacer.')}</p></section>`;
    pane.innerHTML = h;
  }
  /** Résultat du dernier traceroute parti de n (inspecteur). */
  const traceBlock = n => (traceOut && traceOut.from === n.id ? `<pre class="ntTrace${traceOut.r.ok ? '' : ' bad'}">${esc(traceOut.lines.join('\n'))}</pre>` : '');
  const pingText = (r, target) => r.ok
    ? [1, 2, 3, 4].map(i => tl('Réponse de {0} : temps={1} ms', r.ip, Math.max(1, (r.ms || 1) + (i % 2)))).join('\n') + '\n' + tl('4 envoyés, 4 reçus, 0 % de perte')
    : tl('Ping {0} : échec.', r.ip || target) + '\n' + whyText(r.why);
  const eventText = e => (e.t === 'trace' ? tl('Traceroute {0} → {1} : {2}', nameOf(e.from), e.ip, e.ok ? 'OK' : whyText(e.why)) : e.t === 'ping' ? tl('Ping {0} → {1} : {2}', nameOf(e.from), e.ip, e.ok ? 'OK' : whyText(e.why)) : e.t === 'dhcp' ? tl('DHCP : {0} reçoit {1}', nameOf(e.to), e.ip) : e.t === 'mqtt' ? `MQTT ${e.kind} ${e.client || ''} ${e.topic || ''} ${e.text || ''}` : e.t === 'tcp' ? tl('TCP {0} → {1}:{2} {3}', nameOf(e.from), nameOf(e.to), e.port, e.ok ? 'OK' : tl('refusé')) : e.t === 'modbus' ? tl('Modbus : fonction {0}, adresse {1}', e.fn, e.addr) : e.t === 'dns' ? `DNS ${e.name || ''}` : e.t);
  /* Réglages : chaque champ écrit dans les propriétés de l'équipement choisi. */
  const setPath = (o, path, v) => { const ks = path.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] || (x[k] = {}); x[ks[ks.length - 1]] = v; };
  pane.addEventListener('change', e => {
    const t = e.target, n = sel && sel.kind === 'dev' ? findDev(sel.id) : null;
    if (simPaneEvent(ctx, e, n)) return;
    if (t.dataset.ck && sel && sel.kind === 'cable') {
      const c = data.cables.find(x => x.id === sel.id);
      if (t.dataset.ck === 'cat' && CATS[t.value]) c.cat = t.value;
      if (t.dataset.ck === 'len') c.len = Math.max(0.1, Math.min(500, +t.value || c.len));
      commit(); return;
    }
    if (t.dataset.cut && sel && sel.kind === 'cable') {
      const c = data.cables.find(x => x.id === sel.id); const s = new Set(c.wire.cut); if (t.checked) s.add(t.dataset.cut); else s.delete(t.dataset.cut); c.wire.cut = [...s]; commit(); return;
    }
    if (t.dataset.reg) {
      const [tab, a] = t.dataset.reg.split(':'), bk = lan.bank(sel.id); if (bk) { const d = findDev(sel.id); const r = d.p.regs; if (r[tab]) r[tab][+a] = Math.max(0, Math.min(65535, +t.value | 0)); commit(); }
      return;
    }
    if (!n || !t.dataset.k) return;
    const k = t.dataset.k;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (k === 'adapter') { n.p.power = v ? 'adapter' : 'poe'; commit(); return; }
    if (k === 'name') { n.name = cleanText(String(v), 24) || n.name; commit(); return; }
    if (/(^|\.)prefix$/.test(k)) { const p = prefixOf(v); if (p == null) { app.status(tl('Masque invalide : écrivez /24 ou 255.255.255.0.'), 'warn'); renderPane(); return; } v = p; }
    else if (/(^|\.)(ip|gw)$/.test(k) && v && !isIp(v)) { app.status(tl('Adresse invalide : quatre nombres de 0 à 255 séparés par des points.'), 'warn'); renderPane(); return; }
    else if (/^dhcp\.(from|to)$/.test(k) || k === 'budget' || k === 'poeClass') v = Math.max(0, +v || 0);
    else if (typeof v === 'string') v = cleanText(v, 63);
    setPath(n.p, k, v); commit();
  });
  pane.addEventListener('click', async e => {
    const ar = e.target.closest('[data-arr]');
    if (ar) { const a = ar.dataset.arr; if (a === 'copy') copySel(); else if (a === 'dup') duplicateSel(); else arrangeSel(a); return; }
    if (simPaneEvent(ctx, e, sel && sel.kind === 'dev' ? findDev(sel.id) : null)) return;
    const b = e.target.closest('[data-nt],[data-a],[data-ipmode],[data-wanmode],[data-reg],[data-iss]'); if (!b) return;
    const n = sel && sel.kind === 'dev' ? findDev(sel.id) : null;
    if (b.dataset.ipmode && n) { n.p.ip.mode = b.dataset.ipmode; if (n.p.ip.mode === 'static' && !n.p.ip.ip) { const f = lan.ipOf(n.id); if (f && f.ip && f.src === 'dhcp') Object.assign(n.p.ip, { ip: f.ip, prefix: f.prefix, gw: f.gw }); } commit(); return; }
    if (b.dataset.wanmode && n) { n.p.wan.mode = b.dataset.wanmode; commit(); return; }
    if (b.dataset.reg && b.classList.contains('ntBit')) { const [tab, a] = b.dataset.reg.split(':'), d = findDev(sel.id); d.p.regs[tab][+a] = d.p.regs[tab][+a] ? 0 : 1; commit(); return; }
    if (b.dataset.iss != null) { const i = shownIssues()[+b.dataset.iss]; if (i && i.id) reveal(i.id); return; }
    const a = b.dataset.nt || b.dataset.a;
    if (a === 'model' && n) { import('./catalogui.js').then(m => m.openModelPicker(ctx, n.id)).catch(err => { console.error(err); app.status(tl('Cette vue n’a pas pu se charger.'), 'err'); }); return; }
    if (a === 'trace') { const t = (b.closest('form') || pane).querySelector('input[name="t"]'); const v = t && t.value.trim(); if (v) doTrace(sel.id, v); return; }
    if (a === 'cert') { openCertLazy({ cables: [sel.id] }); return; }
    if (a === 'fibre') { import('./fibreui.js').then(m => m.openBudget(ctx, sel.id)).catch(err => { console.error(err); app.status(tl('Cette vue n’a pas pu se charger.'), 'err'); }); return; }
    if (a === 'crimpA') crimp(sel.id, 'a'); else if (a === 'crimpB') crimp(sel.id, 'b'); else if (a === 'test') testCable(sel.id);
    else if (a === 'browser') { const gw = lan.ipOf(sel.id); openBrowser(sel.id, gw && gw.gw ? `http://${gw.gw}/` : ''); }
    else if (a === 'doc') b.classList.toggle('open');
    else if (a === 'del') removeSel();
    else if (a === 'delcable') removeSel();
    else if (a === 'clearmac') { lan.clearMac(sel.id); renderPane(); }
    else if (a === 'renew') { const c = data.cables.find(x => x.id === sel.id); c.wire = makeCable(b.dataset.v); commit(); }
  });
  pane.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.form === 'ping') { const t = f.elements.t.value.trim(); if (t) doPing(sel.id, t); }
    if (f.dataset.form === 'pub') { const b = lan.broker(sel.id), t = f.elements.topic.value.trim(); if (b && t) { b.publish(t, f.elements.msg.value); renderPane(); } }
  });
  async function removeSel() {
    const many = multiSel();
    if (many.length > 1) {
      const dv = new Set(many.filter(x => x.kind === 'dev').map(x => x.id)), cb = new Set(many.filter(x => x.kind === 'cable').map(x => x.id));
      data.devices = data.devices.filter(x => !dv.has(x.id)); data.cables = data.cables.filter(c => !cb.has(c.id) && !dv.has(c.a[0]) && !dv.has(c.b[0]));
      sel = null; msel = []; MS = null; commit(); app.status(tl('{0:# élément retiré|# éléments retirés}.', many.length), 'ok'); return;
    }
    if (!sel) return;
    if (sel.kind === 'cable') { data.cables = data.cables.filter(c => c.id !== sel.id); sel = null; commit(); return; }
    const d = findDev(sel.id); if (!d) return;
    data.devices = data.devices.filter(x => x !== d); data.cables = data.cables.filter(c => c.a[0] !== d.id && c.b[0] !== d.id);
    sel = null; commit();
  }

  /* ---------- Mode ---------- */
  let countsBefore = '', hintBefore = '';
  function counts() { if (!on) return; $('#counts').textContent = tl('{0:# équipement|# équipements} · {1:# câble|# câbles}', lan.state().all.length, data.cables.length); }
  const paintSwitch = () => document.querySelectorAll('.wsSwitch [data-ws]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ws === (on ? 'net' : app.pneu && app.pneu.isOn() ? 'pneu' : app.logic && app.logic.isOn() ? 'logic' : 'elec'))));
  function setMode(v) {
    v = !!v; if (v === on) { paintSwitch(); return; }
    on = v; data.view = on ? 'net' : 'elec';
    appEl.classList.toggle('netMode', on); document.body.classList.toggle('netOpen', on);
    host.hidden = !on; paintSwitch();
    if (on) {
      if (app.simOn() && app.kind() === 'net') app.setSim(false);
      app.history(history);
      countsBefore = $('#counts').textContent; hintBefore = $('#hint').textContent; counts();
      $('#hint').textContent = tl('Port → port : tirer un câble · clic : réglages · Molette : zoom · Espace + glisser : se déplacer · ? : raccourcis');
      app.setTab('nprop'); lan.refresh(); render(); renderPane();
      if (!fitted) { fitted = true; requestAnimationFrame(() => { fit(); render(); }); }
      setTool(tool);
      if (cur !== 'logic' && views[cur]) { views[cur].show(); views[cur].render('show'); }
    } else {
      app.history(null);
      if (countsBefore) $('#counts').textContent = countsBefore;
      $('#hint').textContent = hintBefore;
      if ($('#tab-nprop').getAttribute('aria-selected') === 'true') app.setTab('wiring');
      for (const x of [crimpUi, testerUi]) if (x) x.close();
      app.invalidate(400);
    }
    if (on && app.ensureSpace) app.ensureSpace('net');
  }

  /* ---------- Clavier ---------- */
  const busyUi = () => document.querySelector('.sDialogWrap, .sMenu, .nt-ov') || [...document.querySelectorAll('.modal')].some(m => !m.hidden);
  addEventListener('keydown', e => {
    if (!on || busyUi()) return;
    const a = document.activeElement;
    if (a && (/INPUT|SELECT|TEXTAREA/.test(a.tagName) || a.isContentEditable)) return;
    // Historique (Alt+← / Alt+→), « Lié à » (Alt+Entrée, g puis une lettre) : avant les touches des vues.
    if (iaApi && iaApi.key && iaApi.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.altKey && !mod && /^Digit[1-9]$/.test(e.code)) { const v = VIEWS[+e.code.slice(5) - 1]; if (v) { openView(v.id); e.preventDefault(); e.stopImmediatePropagation(); return; } }
    if (cur !== 'logic') { const vw = views[cur]; if (vw && vw.key && vw.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; } if (!mod) e.stopImmediatePropagation(); return; }
    // Copier, coller, dupliquer, couper, tout choisir : le schéma logique (le reste des Ctrl : l'application).
    if (mod && !e.altKey) {
      let hit = true;
      if (k === 'c') hit = copySel();
      else if (k === 'x') { hit = copySel(); if (hit) removeSel(); }
      else if (k === 'v') pasteSel(!e.shiftKey);
      else if (k === 'd') duplicateSel();
      else if (k === 'a') selectAll();
      else hit = false;
      if (hit) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    if (mod) return; // enregistrer, ouvrir, annuler, bibliothèque : l'application
    if (nav.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    let done = true;
    if (k === 'escape') { if (rubber) { rubber = null; paintRubber(); } else if (pingFrom || traceFrom) { pingFrom = null; traceFrom = null; render(); } else if (traceOut && tool === 'select') { traceOut = null; render(); } else if (focus && !sel) closeGroup(); else if (tool !== 'select') setTool('select'); else select(null); paintHint(); }
    else if (k === 'delete' || k === 'backspace') removeSel();
    else if (k.startsWith('arrow') && selDevIds().length && !focus) { const st2 = e.altKey ? 1 : e.shiftKey ? 50 : 10; nudge(k === 'arrowleft' ? -st2 : k === 'arrowright' ? st2 : 0, k === 'arrowup' ? -st2 : k === 'arrowdown' ? st2 : 0); }
    else if (k === 'v') setTool('select'); else if (k === 'c') setTool('cable'); else if (k === 't') setTool('tester'); else if (k === 'p') setTool('ping'); else if (k === 'r') setTool('trace');
    else done = false;
    if (done) e.preventDefault();
    e.stopImmediatePropagation(); // pas de raccourcis de la scène 3D ici
  }, true);
  addEventListener('keyup', e => { if (!on) return; if (cur === 'logic') nav.key(e); else { const vw = views[cur]; if (vw && vw.keyup) vw.keyup(e); } }, true);

  /* ---------- Montage changé (projet Objets connectés) ---------- */
  if (app.onChange) app.onChange(() => { lan.refresh(); if (on) { render(); renderPaneSoon(); } });
  // Programmes en marche : adresses et messages qui changent, panneaux à jour quelques fois par seconde.
  setInterval(() => {
    if (!on || document.hidden) return;
    // Un autre panneau de l'inspecteur ouvert d'ailleurs (simulation lancée) : en mode Réseau, seul le sien se montre.
    const cur = document.querySelector('.panel.right .tabs .tab[aria-selected="true"]');
    if (!cur || (!cur.classList.contains('ntTab') && !cur.classList.contains('sessTab'))) { app.setTab('nprop'); renderPane(); }
    const v = lan.version; lan.state(); if (lan.version !== v) render(); if (selNode() && (selNode().type === 'broker' || selNode().ext)) renderPane(); }, 700);

  /**
   * Fenêtres du plan réseau fermées (autre projet, projet fermé) : sertissage, testeur, navigateur, et les fenêtres des
   * vues posées sur le plan de travail (certification, bilan optique, nouvelle version du fond : overlay() de crimp.js) ;
   * ping et traceroute en attente oubliés.
   */
  function closeWindows() {
    for (const x of [crimpUi, testerUi]) if (x) x.close();
    crimpUi = null; testerUi = null;
    if (browser) { browser.el.remove(); browser = null; }
    host.querySelectorAll('.nt-ov').forEach(o => o.remove());
    pingFrom = null; traceFrom = null; traceOut = null; pingOut = null;
    Object.assign(ui, { tester: false, crimp: false, browser: false, ping: false });
  }
  /** Montre l'équipement ou le câble en cause (panneau Problèmes, rapport). */
  function reveal(id) {
    if (!on) setMode(true);
    if (!id) return;
    const where = whereIs(id);
    if (where !== 'logic') { openView(where).then(vw => { if (vw && vw.reveal) vw.reveal(id); }); return; }
    if (cur !== 'logic') openView('logic');
    if (data.cables.some(c => c.id === id)) select({ kind: 'cable', id });
    else if (nodeById(id)) { select({ kind: 'dev', id }); fitTo(bounds([nodeById(id)])); }
  }
  // Navigateur du projet, calques, fil d'Ariane, recherche (Ctrl+F), modification groupée, onglets du panneau du bas :
  // ia.js, module à part chargé ensuite (rien de plus dans ce fichier).
  import('./ia.js').then(m => { iaApi = m.installIa(ctx, { lib, host, pane }); }).catch(e => console.error(e));
  const srcNote = code => (NET_SRC[code] || []).map(k => SOURCES[k] && SOURCES[k].publisher ? `${SOURCES[k].title} (${SOURCES[k].publisher})` : k).slice(0, 2).join(' ; ');

  return {
    isOn: () => on, setMode, lan: () => lan, data: () => data, reveal, closeWindows: () => { closeWindows(); sel = null; render(); renderPane(); },
    load(d) {
      data = cleanNet(d); sel = null; msel = []; MS = null; pingOut = null; fitted = false; touched = false; focus = null; paintFocus(); H.undo = []; H.redo = []; snapshot = snapData();
      lan.reset(); lan.refresh();
      closeWindows();
      if (!d) { if (on && app.comps().length) setMode(false); render(); renderPane(); return; }
      setMode(data.view === 'net' || (!spacesOf(app.kind()).includes('elec') && spacesOf(app.kind()).includes('net')));
      if (on) { fitted = true; requestAnimationFrame(() => { fit(); render(); }); }
      render(); renderPane(); counts(); viewsChanged('load');
    },
    save() {
      if (!data.devices.length && !data.cables.length && !on) return undefined;
      return JSON.parse(JSON.stringify(data));
    },
    /** Vérificateur du projet : les fautes du plan, codes J12xx (panneau Problèmes, rapport). */
    diags() {
      if (!data.devices.length && !data.cables.length) return [];
      let iss = [];
      try { iss = shownIssues(); } catch (e) { console.error(e); return []; }
      return iss.map(i => { const ex = explain(i.code); return { code: i.code, level: i.kind === 'err' ? 'error' : 'warning', title: i.text, key: 'nt:' + i.code + ':' + (i.id || '') + ':' + i.text, where: tl('plan réseau'), space: 'net', el: i.id || null, loc: {}, note: ex ? `${ex.why} ${tl('Source : {0}.', srcNote(i.code))}` : '' }; });
    },
    /** Outils (IA, TP) : ping, test d'un câble, pose. */
    ping: (from, target) => doPing(from, target), place: (type, x, y) => place(type, x, y), refresh: () => changed(), commit, select,
    /** Vues du projet réseau (Logique, Plans, Baies, Conception) : ouvre une vue (promesse de son objet). */
    openView: id => openView(id), view: () => cur, ctx: () => ctx,
    drawPdf: null
  };
}
