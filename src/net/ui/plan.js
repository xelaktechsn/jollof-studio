// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vue « Plans » du plan réseau (chargée à la demande par workspace.js) : site, bâtiments, étages à l'échelle (mètres),
// murs, portes, pièces, plan importé et étalonné, cheminements, baies, équipements posés, liens permanents au tracé
// automatique, mesure, calque Wi-Fi. Un seul modèle (ctx.data()), un seul historique (ctx.commit() par geste).
// Outils : V choisir (cadre, Maj+clic, Ctrl+A, flèches, Suppr), W mur, R pièce (clics ou glisser : rectangle), D porte,
// K cheminement, L lien permanent, E mesurer ; étalonnage depuis l'inspecteur de l'étage. Entrée ou double-clic
// termine un tracé, Échap l'annule. Navigation : le dock commun (molette, Espace, H, Z, F, M, ?).
import './plan.css';
import { tl, isEn } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { menu as popMenu } from '../../school/ui.js';
import { dragRect } from '../../ui/navdock.js';
import { DEVICES } from '../devices.js';
import { MATERIALS, USAGES, floorOf, allFloors, siteIds, uid, dist, project, bbox, roomAt, findSiteObj, isTechRoom } from '../site.js';
import { PATH_KINDS, cleanPaths, routeCable } from '../route.js';
import { worldSvg, overSvg, fmtNum, wallQuad, rackQuad, devIconName } from './plan-draw.js';
import { paneHtml, paneEvent } from './plan-pane.js';
import { addDemoFloor, freePort, addDetectedRooms, removeRackFrom } from './plan-demo.js';
import { copySel, pasteClip, alignSel, moveToFloor, jumpsFor } from './plan-edit.js';
import * as RK from '../rack.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r3 = v => Math.round(v * 1000) / 1000;
/** 100 % de zoom : échelle 1:100 à l'écran (96 points par pouce : 1 m = 37,8 px). */
const K100 = 96 / 2.54;
const TOOLS = [
  ['select', 'pointer', 'V', () => tl('Choisir'), () => tl('Choisir et déplacer · V. Glisser dans le vide : encadrer ; Maj+clic : ajouter à la sélection.')],
  ['wall', 'wall', 'W', () => tl('Mur'), () => tl('Mur · W : cliquer chaque angle ; Entrée ou double-clic pour finir. Maj : sans angle droit, Alt : sans aimantation.')],
  ['room', 'room', 'R', () => tl('Salle'), () => tl('Pièce · R : glisser pour un rectangle, ou cliquer chaque sommet puis Entrée.')],
  ['door', 'door', 'D', () => tl('Porte'), () => tl('Porte · D : cliquer sur un mur.')],
  ['path', 'cableTray', 'K', () => tl('Cheminement'), () => tl('Cheminement · K : chemin de câbles, conduit, faux plafond, colonne montante… cliquer chaque point, Entrée pour finir.')],
  ['link', 'link', 'L', () => tl('Lien'), () => tl('Lien permanent · L : cliquer une prise (ou un point d’accès) puis le panneau de brassage. Sa longueur suit les cheminements.')],
  ['measure', 'ruler', 'E', () => tl('Mesurer'), () => tl('Mesurer · E : cliquer les points, la distance s’affiche ; Échap pour effacer.')]
];
const KEY_TOOL = Object.fromEntries(TOOLS.map(t => [t[2].toLowerCase(), t[0]]));
/** Hauteur de pose proposée (m) selon le genre d'équipement : réglage modifiable dans la carte de l'équipement. */
const defaultH = (type, f) => (/^(ap|camera)/.test(type) ? f.ceil || 2.7 : /^outlet/.test(type) ? 0.3 : /^(pc|laptop|phone|printer)/.test(type) ? 0.75 : 1.5);

/** Presse-papiers des plans (partagé par les étages et les bâtiments du projet ouvert). */
const CLIP = { c: null };
/** ctx : voir workspace.js (contrat des vues). Rend { el, show, hide, render, key, keyup, fit, reveal, pane, paneEvent, drop }. */
export function createPlanView(ctx) {
  const el = document.createElement('div'); el.className = 'ntVw ntPl'; el.hidden = true;
  el.innerHTML = `
    <div class="ntPlStage"><canvas class="ntPlCv"></canvas><svg class="ntPlSvg" xmlns="http://www.w3.org/2000/svg"><g class="ntPlWorld"></g><g class="ntPlOver"></g></svg></div>
    <div class="ntBar top ntPlTop">
      <div class="glass ntPlFloors" role="tablist" aria-label="${tl('Étages')}"></div>
      <div class="seg glass ntTools ntPlTools" role="group" aria-label="${tl('Outils des plans')}">${TOOLS.map(([id, ic, k, name, tip]) => `<button type="button" class="segBtn" data-pltool="${id}" data-tip="${esc(tip())}" aria-label="${esc(name())} · ${k}">${icon(ic)}<span>${esc(name())}</span></button>`).join('')}</div>
      <div class="glass ntPlSub" hidden></div>
      <span class="grow"></span>
      <div class="seg glass ntPlLayers" role="group" aria-label="${tl('Calques')}">
        <button type="button" class="segBtn" data-layer="image" data-tip="${tl('Plan importé sous le dessin')}">${icon('image')}</button>
        <button type="button" class="segBtn" data-layer="routes" data-tip="${tl('Tracé des câbles de l’équipement choisi')}">${icon('route')}</button>
        <button type="button" class="segBtn" data-layer="wifi" data-tip="${tl('Calque Wi-Fi : couverture des points d’accès')}">${icon('wifi')}<span>Wi-Fi</span></button>
        <button type="button" class="segBtn" data-layer="cad" data-tip="${tl('Fond de plan DXF : calques, opacité, position')}">${icon('layers')}</button>
      </div>
    </div>
    <div class="ntBar bottom ntPlBottom"><div class="glass ntPlScale"><i></i><span></span></div><div class="glass ntPlInfo" hidden></div><span class="grow"></span><span class="ntHint glass ntPlHint"></span></div>
    <div class="glass ntPlWifi" hidden></div>
    <form class="glass ntPlCalib" hidden><b>${icon('calibrate')}${tl('Étalonner le plan importé')}</b><label>${tl('Distance réelle entre les deux points (m)')}<input class="inp" name="d" type="number" min="0.01" step="0.01" required></label><div class="row"><button type="button" class="btn small subtle" data-calib="no">${tl('Fermer')}</button><button class="btn small primary">${tl('Appliquer')}</button></div></form>
    <div class="ntPlStart" hidden><b>${tl('Cet étage est vide')}</b><p>${tl('Commencez par le bâtiment : importez le plan de l’architecte, ou dessinez les murs et les pièces. Les prises et les points d’accès se glissent ensuite depuis la bibliothèque.')}</p><div class="row"><button type="button" class="btn primary" data-pla="cad">${icon('upload')}<span>${tl('Importer un plan DXF ou DWG…')}</span></button><button type="button" class="btn" data-pltool="wall">${icon('wall')}<span>${tl('Dessiner les murs')}</span><kbd>W</kbd></button><button type="button" class="btn" data-pla="image">${icon('image')}<span>${tl('Image du plan')}</span></button><button type="button" class="btn subtle" data-pla="demo">${icon('floorPlan')}<span>${tl('Étage d’exemple')}</span></button></div></div>
    <div class="ntPlEmpty" hidden><div class="ntEmptyCard">${icon('floorPlan')}<b>${tl('Plans d’étage')}</b><p>${tl('Dessinez le bâtiment à l’échelle : murs, pièces, local technique, chemins de câbles. Les prises et les points d’accès posés ici donnent aux câbles leur longueur réelle.')}</p><div class="row"><button type="button" class="btn primary" data-pla="newBuilding">${icon('plus')}<span>${tl('Nouveau bâtiment')}</span></button><button type="button" class="btn" data-pla="demo">${icon('floorPlan')}<span>${tl('Étage d’exemple')}</span></button><button type="button" class="btn" data-pla="cad">${icon('upload')}<span>${tl('Importer un plan DXF ou DWG…')}</span></button></div></div></div>
    <input class="ntPlFile" type="file" accept="image/png,image/jpeg,image/webp" hidden>`;
  ctx.host.appendChild(el);
  const $ = s => el.querySelector(s);
  const stage = $('.ntPlStage'), svg = $('.ntPlSvg'), gW = $('.ntPlWorld'), gO = $('.ntPlOver'), cv = $('.ntPlCv'), info = $('.ntPlInfo'), wcard = $('.ntPlWifi'), calib = $('.ntPlCalib');
  const V = { x: -2, y: -2, k: 24 };
  const S = { floor: null, tool: 'select', pathKind: 'tray', wallMat: 'block', usage: 'office', draft: null, rect: null, link: null, multi: [], layers: { image: true, routes: true, wifi: false }, seen: new Set(), views: new Map() };
  let wifi = null, labeler = null, raf = 0, rafW = 0;
  // Fond DXF/DWG (plan-underlay.js, à la demande) : chargé quand l'étage montré en a un, ou à l'ouverture de sa carte.
  let cad = null, cadP = null;
  const cadHas = f => !!(f && ctx.data().underlays && ctx.data().underlays[f.id]);
  function cadLoad() {
    if (!cadP) cadP = import('./plan-underlay.js').then(m => { cad = m.createUnderlayLayer(ctx, { el, stage, svg, view: () => V, floor, repaint: () => paint(), hidden: () => el.hidden, cardChanged: on => { S.layers.cad = on; paintTools(); }, act: a => (a === 'wall' || a === 'path' ? setTool(a) : null), fitAvoid: top => { const b = boundsOf(floor()); if (b) { const h = Math.max(1, b[3] - b[1]), pad = 0.05 * Math.max(b[2] - b[0], h, 4); fitTo([b[0] - pad, b[1] - h * top - pad, b[2] + pad, b[3] + pad]); } } }); if (cadHas(floor())) requestAnimationFrame(fit); paintOver(); return cad; }).catch(e => { console.error(e); cadP = null; return null; });
    return cadP;
  }
  const cadImport = () => import('./cadimport.js').then(m => m.openCadImport(ctx, null, { floor: S.floor })).catch(e => { console.error(e); ctx.status(tl('L’import DXF n’a pas pu se charger.'), 'err'); });
  import('../docs.js').then(m => { if (typeof m.labeler === 'function') { labeler = m.labeler; paintOver(); } }).catch(() => {});

  /* ---------- Modèle courant ---------- */
  const data = () => ctx.data();
  const floor = () => { const d = data(); let F = floorOf(d.site, S.floor); if (!F) { const all = allFloors(d.site); F = all[0] || null; S.floor = F ? F.f.id : null; } return F ? F.f : null; };
  const building = () => { const F = floorOf(data().site, S.floor); return F ? F.b : null; };
  const multi = () => S.multi;
  const key = (k, id) => k + ':' + id;
  const selKeys = () => { const s = new Set(S.multi.map(m => key(m.kind, m.id))); const c = ctx.selection(); if (c) s.add(key(c.kind, c.id)); return s; };
  const devName = d => { if (d.tag) return d.tag; if (labeler) { try { const l = labeler(data()).of(d.id); if (l) return l; } catch (e) { /* étiquettes indisponibles */ } } return d.name; };

  /* ---------- Vue : repères, zoom, tout voir ---------- */
  const toS = (x, y) => [(x - V.x) * V.k, (y - V.y) * V.k];
  const rect = () => svg.getBoundingClientRect();
  const toW = (cx, cy) => { const r = rect(); return [V.x + (cx - r.left) / V.k, V.y + (cy - r.top) / V.k]; };
  function applyView() {
    gW.setAttribute('transform', `translate(${(-V.x * V.k).toFixed(2)} ${(-V.y * V.k).toFixed(2)}) scale(${V.k})`);
    // Grille en mètres : pas de 0,5 à 50 m selon le zoom, au moins 14 px entre deux points.
    const step = [0.5, 1, 2, 5, 10, 20, 50].find(s => s * V.k >= 14) || 100, g = step * V.k;
    stage.style.setProperty('--gk', g + 'px'); stage.style.setProperty('--gx', ((-V.x * V.k) % g) + 'px'); stage.style.setProperty('--gy', ((-V.y * V.k) % g) + 'px');
    // Barre d'échelle : longueur ronde proche de 100 px.
    const L = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find(m => m * V.k >= 70) || 1000;
    $('.ntPlScale i').style.width = (L * V.k).toFixed(1) + 'px';
    $('.ntPlScale span').textContent = `${fmtNum(L, 1, isEn)} m · 1:${Math.max(1, Math.round(K100 * 100 / V.k))}`;
    S.views.set(S.floor, { ...V });
    paintOver(); if (nav) nav.update();
  }
  function zoomAt(f, px, py) {
    const r = rect(), x = px ?? r.width / 2, y = py ?? r.height / 2, wx = V.x + x / V.k, wy = V.y + y / V.k;
    V.k = Math.max(0.5, Math.min(800, V.k * f)); V.x = wx - x / V.k; V.y = wy - y / V.k; applyView();
  }
  /** Emprise d'un étage : murs, pièces, cheminements, équipements, baies, plan importé. */
  function boundsOf(f) {
    if (!f) return null;
    const P = [], d = data();
    for (const w of f.walls) P.push(w.a, w.b);
    for (const r of f.rooms) P.push(...r.poly);
    for (const p of d.paths || []) if (p.floor === f.id) P.push(...(p.kind === 'outdoor' ? [p.pts[0]] : p.pts));
    for (const x of d.devices) if (x.loc && x.loc.floor === f.id) P.push([x.loc.x, x.loc.y]);
    for (const r of d.racks || []) if (r.floor === f.id) P.push([r.x, r.y]);
    if (f.image && S.layers.image) { const im = f.image; P.push([im.x, im.y], [im.x + im.iw * im.scale, im.y + im.ih * im.scale]); }
    const ub = cad && cad.bounds(f); if (ub) P.push([ub[0], ub[1]], [ub[2], ub[3]]);
    return P.length ? bbox(P) : null;
  }
  function fitTo(b) {
    const r = rect(); if (!r.width || !b) return;
    const W = Math.max(80, r.width - 56 - 48), H = Math.max(80, r.height - 130), bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
    V.k = Math.max(0.5, Math.min(400, Math.min(W / bw, H / bh)));
    V.x = b[0] - (W / V.k - bw) / 2 - 24 / V.k; V.y = b[1] - (H / V.k - bh) / 2 - 64 / V.k;
    applyView();
  }
  const fit = () => fitTo(boundsOf(floor()) || [0, 0, 40, 20]);
  const selBounds = () => {
    const f = floor(), P = []; if (!f) return null; const d = data();
    for (const m of S.multi.length ? S.multi : ctx.selection() ? [ctx.selection()] : []) {
      if (m.kind === 'dev') { const x = d.devices.find(z => z.id === m.id); if (x && x.loc && x.loc.floor === f.id) P.push([x.loc.x - 1, x.loc.y - 1], [x.loc.x + 1, x.loc.y + 1]); }
      else if (m.kind === 'rack') { const r = (d.racks || []).find(z => z.id === m.id); if (r) P.push(...rackQuad(r)); }
      else if (m.kind === 'path') { const p = (d.paths || []).find(z => z.id === m.id); if (p) P.push(...(p.kind === 'outdoor' ? [p.pts[0]] : p.pts)); }
      else { const o = findSiteObj(d.site, m.id); if (o && o.kind === 'room') P.push(...o.o.poly); else if (o && o.kind === 'wall') P.push(o.o.a, o.o.b); }
    }
    return P.length ? bbox(P) : null;
  };
  const nav = ctx.createNavDock(el, {
    active: () => !el.hidden && ctx.isOn(), target: () => svg, tools: () => ['select', 'pan', 'zoom'],
    zoomBy: (f, x, y) => zoomAt(f, x, y), panBy: (dx, dy) => { V.x -= dx / V.k; V.y -= dy / V.k; applyView(); },
    zoomPct: () => Math.round(V.k / K100 * 100), setZoomPct: p => zoomAt(p / 100 * K100 / V.k),
    fit, fitSel: () => { const b = selBounds(); if (!b) return false; fitTo([b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2]); return true; }, hasSel: () => !!selBounds(),
    zoomRect(r) { const a = [V.x + r.x / V.k, V.y + r.y / V.k], b = [V.x + (r.x + r.w) / V.k, V.y + (r.y + r.h) / V.k]; fitTo([a[0], a[1], b[0], b[1]]); return true; },
    mini: {
      data: () => {
        const f = floor(), b = boundsOf(f); if (!b) return null; const r = rect();
        return { bounds: b, boxes: f.rooms.map(x => { const q = bbox(x.poly); return [q[0], q[1], q[2] - q[0], q[3] - q[1], selKeys().has(key('room', x.id))]; }), view: [V.x, V.y, V.x + r.width / V.k, V.y + r.height / V.k] };
      },
      centerOn: (x, y) => { const r = rect(); V.x = x - r.width / 2 / V.k; V.y = y - r.height / 2 / V.k; applyView(); }
    },
    status: m => ctx.status(m), title: tl('Plans'),
    shortcuts: () => [...TOOLS.map(t => [t[2], t[3]()]), ['Enter', tl('Finir le tracé')], ['Esc', tl('Annuler le tracé, puis la sélection')], ['Mod+A', tl('Tout choisir sur l’étage')], ['Del', tl('Retirer la sélection')], [tl('Flèches'), tl('Déplacer de 10 cm (Maj : 1 m)')], ['Alt+Drag', tl('Déplacer le plan importé (déverrouillé)')]]
  });
  svg.addEventListener('wheel', e => { if (el.hidden) return; e.preventDefault(); const r = rect(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); }, { passive: false });

  /* ---------- Dessin ---------- */
  const issueIds = () => { const s = new Set(); try { for (const i of ctx.issues()) if (i.id && /^J12[5-6]/.test(i.code)) s.add(i.id); } catch (e) { /* vérifications indisponibles */ } return s; };
  let bad = new Set(), legs = [];
  function computeLegs() {
    legs = []; const d = data(), s = ctx.selection(); if (!S.layers.routes || !s) return;
    const cs = s.kind === 'cable' ? d.cables.filter(c => c.id === s.id) : s.kind === 'dev' ? d.cables.filter(c => c.a[0] === s.id || c.b[0] === s.id).slice(0, 6) : [];
    for (const c of cs) { try { const r = routeCable(d, c, true); if (r && r.legs) legs.push(...r.legs); } catch (e) { console.error(e); } }
  }
  function paintWorld() {
    const f = floor(), d = data();
    el.querySelector('.ntPlEmpty').hidden = !!f;
    el.querySelector('.ntPlStart').hidden = !f || S.tool !== 'select' || !!(f.walls.length || f.rooms.length || f.image || cadHas(f) || d.devices.some(x => x.loc && x.loc.floor === f.id) || (d.paths || []).some(p => p.floor === f.id));
    if (!f) { gW.innerHTML = ''; return; }
    const im = f.image && S.layers.image ? d.images[f.image.id] : null;
    gW.innerHTML = worldSvg(d, f, { sel: selKeys(), img: im, legs, bad, k: V.k });
  }
  function paintOverNow() {
    raf = 0; const f = floor(); if (!f) { gO.innerHTML = ''; return; }
    const r = rect();
    const so = { toS, W: r.width, H: r.height, k: V.k, sel: selKeys(), en: isEn, name: devName, draft: S.draft, rect: S.rect, link: S.link, handles: handles(f), bad, guides: S.guides };
    gO.innerHTML = overSvg(data(), f, so); S.placed = so.placed || [];
    paintCanvas();
  }
  function paintOver() { if (!raf) raf = requestAnimationFrame(paintOverNow); }
  /** Tout redessiner (modèle ou sélection changés). */
  function paint() { computeLegs(); paintWorld(); paintFloors(); paintTools(); paintInfo(); paintWifi(); applyView(); }
  function paintSoon() { if (!rafW) rafW = requestAnimationFrame(() => { rafW = 0; paintWorld(); paintOverNow(); }); }
  function paintCanvas() {
    if (cad) cad.paint(); else if (cadHas(floor())) cadLoad();
    const w = stage.clientWidth, h = stage.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); g.clearRect(0, 0, w, h);
    const f = floor();
    if (S.layers.wifi && wifi && f) { try { wifi.paint(cv, { floor: f, view: { x: V.x, y: V.y, k: V.k }, data: data(), avoid: S.placed || [], sel: (ctx.selection() || {}).id }); } catch (e) { console.error(e); } }
  }
  /** Poignées de l'objet choisi seul (sommets), en pixels. */
  function handles(f) {
    const s = ctx.selection(); if (!s || S.multi.length > 1 || S.tool !== 'select') return [];
    const out = [], d = data(), add = (q, i) => { const [x, y] = toS(q[0], q[1]); out.push([x, y, `${s.kind}:${s.id}:${i}`]); };
    if (s.kind === 'wall') { const w = f.walls.find(x => x.id === s.id); if (w) { add(w.a, 0); add(w.b, 1); } }
    else if (s.kind === 'room') { const r = f.rooms.find(x => x.id === s.id); if (r) r.poly.forEach(add); }
    else if (s.kind === 'path') { const p = (d.paths || []).find(x => x.id === s.id); if (p && p.floor === f.id) (p.kind === 'outdoor' ? [p.pts[0]] : p.pts).forEach(add); }
    return out;
  }
  function paintFloors() {
    const d = data(), b = building(), f = floor(), bs = d.site.buildings;
    let h = '';
    // Vue étroite (1280 × 720, panneaux ouverts) : un seul menu bâtiment · étage, les outils restent sur une ligne.
    const narrow = stage.clientWidth && stage.clientWidth < 860;
    if (b && narrow) {
      h += `<select class="sel ntPlFSel" data-plfsel aria-label="${tl('Étage')}" data-tip="${tl('Bâtiment et étage')}">${bs.map(x => `<optgroup label="${esc(x.name)}">${x.floors.map(y => `<option value="${esc(y.id)}"${f && y.id === f.id ? ' selected' : ''}>${esc(bs.length > 1 ? x.name + ' · ' + y.name : y.name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
      h += `<button type="button" class="tb" data-plmenu data-tip="${tl('Étages et bâtiments')}" aria-label="${tl('Étages et bâtiments')}">${icon('plus')}</button>`;
      $('.ntPlFloors').innerHTML = h; $('.ntPlFloors').hidden = false; S.narrow = true; return;
    }
    S.narrow = false;
    if (bs.length > 1) h += `<select class="sel ntPlBld" data-plb aria-label="${tl('Bâtiment')}">${bs.map(x => `<option value="${esc(x.id)}"${b && x.id === b.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
    else if (b) h += `<button type="button" class="ntPlBName" data-plbsel data-tip="${tl('Réglages du bâtiment')}">${icon('building')}<span>${esc(b.name)}</span></button>`;
    if (b) h += b.floors.map(x => `<button type="button" role="tab" class="ntPlFTab" data-plf="${esc(x.id)}" aria-selected="${f && x.id === f.id}" data-tip="${esc(tl('Niveau {0} · altitude {1} m', x.level, fmtNum(x.elev, 2, isEn)))}">${esc(x.name)}</button>`).join('');
    h += `<button type="button" class="tb" data-plmenu data-tip="${tl('Étages et bâtiments')}" aria-label="${tl('Étages et bâtiments')}">${icon('plus')}</button>`;
    $('.ntPlFloors').innerHTML = h; $('.ntPlFloors').hidden = !b;
  }
  function paintTools() {
    const none = !floor();
    el.querySelectorAll('.ntPlTools [data-pltool]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.pltool === S.tool));
      // Pas encore de bâtiment : les outils de dessin attendent (la carte vide propose d'en créer un).
      const off = none && b.dataset.pltool !== 'select'; b.disabled = off;
      if (!b.dataset.tip0) b.dataset.tip0 = b.dataset.tip || '';
      b.dataset.tip = off ? tl('Créez d’abord un bâtiment') : b.dataset.tip0;
    });
    el.querySelectorAll('[data-layer]').forEach(b => b.setAttribute('aria-pressed', String(!!S.layers[b.dataset.layer])));
    const sub = $('.ntPlSub');
    if (S.tool === 'path') sub.innerHTML = `<label><span>${tl('Genre')}</span><select class="sel" data-plsub="pathKind">${Object.entries(PATH_KINDS).map(([k, x]) => `<option value="${k}"${k === S.pathKind ? ' selected' : ''}>${esc(x.name())}</option>`).join('')}</select></label>`;
    else if (S.tool === 'wall') sub.innerHTML = `<label><span>${tl('Matériau')}</span><select class="sel" data-plsub="wallMat">${Object.entries(MATERIALS).map(([k, m]) => `<option value="${k}"${k === S.wallMat ? ' selected' : ''}>${esc(m.name())}</option>`).join('')}</select></label>`;
    else if (S.tool === 'room') sub.innerHTML = `<label><span>${tl('Usage')}</span><select class="sel" data-plsub="usage">${Object.entries(USAGES).map(([k, u]) => `<option value="${k}"${k === S.usage ? ' selected' : ''}>${esc(u.name())}</option>`).join('')}</select></label><button type="button" class="btn small subtle" data-pldetect data-tip="${esc(tl('Crée une pièce dans chaque espace fermé par les murs qui n’en a pas encore'))}">${icon('wand')}<span>${tl('Détecter les pièces')}</span></button>`;
    else sub.innerHTML = '';
    sub.hidden = !sub.innerHTML;
    const t = TOOLS.find(x => x[0] === S.tool);
    // Bulle d'aide de l'outil : quelques secondes après le changement d'outil, puis elle s'efface (l'infobulle reste).
    // Aide de l'outil : dans la barre d'état quand l'outil change (rien ne couvre le dessin ; l'infobulle du bouton la redit).
    const hintTxt = S.tool === 'calib' ? tl('Étalonnage : cliquez deux points du plan importé dont vous connaissez la distance.') : t ? t[4]() : '';
    if (S.hintTool !== S.tool) { if (S.hintTool !== undefined && hintTxt && !el.hidden) ctx.status(hintTxt); S.hintTool = S.tool; }
    $('.ntPlHint').hidden = true;
  }
  /** Carte d'information en bas : équipement choisi (hauteur de pose, pièce) ou tracé d'un câble. */
  function paintInfo() {
    const s = ctx.selection(), d = data(); let h = '';
    if (s && s.kind === 'dev' && S.multi.length <= 1) {
      const x = d.devices.find(z => z.id === s.id);
      if (x && x.loc) {
        const F = floorOf(d.site, x.loc.floor), r = F && roomAt(F.f, x.loc.x, x.loc.y);
        h = `<b>${icon(devIconName(x.type))}${esc(devName(x))}</b><span>${esc(r ? r.name || USAGES[r.usage].name() : tl('hors pièce'))} · x ${fmtNum(x.loc.x, 2, isEn)} · y ${fmtNum(x.loc.y, 2, isEn)}</span><label>${tl('Hauteur de pose (m)')}<input class="inp" data-pli="h" type="number" min="0" max="30" step="0.05" value="${x.loc.h}"></label><button type="button" class="btn small subtle" data-pli="unplace">${tl('Retirer du plan')}</button>`;
        const cs = d.cables.filter(c => (c.a[0] === x.id || c.b[0] === x.id) && c.route && c.route.mode === 'auto');
        if (cs.length) h += `<span class="mut">${cs.map(c => tl('lien {0} m', fmtNum(c.len, 1, isEn))).join(' · ')}</span>`;
      }
    } else if (s && s.kind === 'cable') {
      const c = d.cables.find(z => z.id === s.id);
      if (c) {
        const k = c.route && c.route.calc, auto = c.route && c.route.mode === 'auto';
        h = `<b>${icon('cable')}${esc(tl('Câble {0} ↔ {1}', ctx.nameOf(c.a[0]), ctx.nameOf(c.b[0])))} · ${fmtNum(c.len, 1, isEn)} m</b>`;
        if (auto && k && k.fallback !== 'noloc') h += `<span>${tl('cheminements {0} m + descentes {1} m + mou {2} m', fmtNum(k.path, 1, isEn), fmtNum(k.drops, 1, isEn), fmtNum(k.slack, 1, isEn))}${k.fallback ? ` · <em class="bad">${k.fallback === 'noriser' ? tl('sans colonne montante') : tl('sans cheminement : estimation en équerre')}</em>` : ''}</span>`;
        h += `<label class="ntChk"><input type="checkbox" data-pli="auto"${auto ? ' checked' : ''}><span>${tl('Longueur suivant les cheminements')}</span></label>`;
      }
    }
    info.innerHTML = h; info.hidden = !h;
  }
  /** Point d'accès choisi (ses réglages radio s'affichent à côté de lui, dans la carte flottante). */
  const selAp = () => { const s = ctx.selection(), x = s && s.kind === 'dev' && data().devices.find(z => z.id === s.id); return x && /^ap/.test(x.type) ? x : null; };
  /** Contenu du calque Wi-Fi : barre, légende, couverture, réglages du projet (et réglages radio d'un point d'accès). */
  function wifiHtml(ap) {
    let h = '';
    try { h = (wifi.toolbar ? wifi.toolbar() : '') + (wifi.legend ? wifi.legend() : '') + (wifi.settingsHtml ? `<details class="ntWfMore"><summary>${tl('Réglages Wi-Fi du projet')}</summary>${wifi.settingsHtml()}</details>` : ''); if (ap && wifi.apPane) h += wifi.apPane(ap); } catch (e) { console.error(e); }
    return h || `<p class="mut">${tl('Calque Wi-Fi en préparation.')}</p>`;
  }
  // La carte du calque va dans l'inspecteur (elle ne cache pas l'étage) ; elle ne flotte sur le plan que pour un point
  // d'accès choisi, dont l'inspecteur reste celui de l'équipement.
  function paintWifi() {
    const ap = S.layers.wifi && wifi ? selAp() : null;
    wcard.hidden = !ap;
    if (!ap) return;
    // Réglages radio seuls, repliables, rangés en haut à droite (ou à gauche si le point d'accès est dessous).
    let h = ''; try { h = wifi.apPane ? wifi.apPane(ap) : ''; } catch (e) { console.error(e); }
    const [sx0] = ap.loc ? toS(ap.loc.x, ap.loc.y) : [0], W0 = stage.clientWidth;
    // Repliée d'office quand la vue est étroite (elle couvrirait l'étage) ; le choix de l'utilisateur est retenu.
    const open = wcard.dataset.open ? wcard.dataset.open === '1' : W0 >= 980;
    wcard.innerHTML = `<details class="ntPlWfAp"${open ? ' open' : ''}><summary>${icon('wifi')}${esc(tl('Radio de {0}', devName(ap)))}</summary>${h}</details>`;
    const [sx, sy] = ap.loc ? toS(ap.loc.x, ap.loc.y) : [0, 0], W = stage.clientWidth;
    // Du côté opposé au point d'accès choisi : sa pièce reste visible.
    wcard.classList.toggle('left', sx > W / 2); void sy; void sx0;
  }
  const wifiPane = () => (S.layers.wifi && wifi && !selAp() ? `<section class="ntSec ntPlWifiPane"><h4>${tl('Calque Wi-Fi')}</h4>${wifiHtml(null)}</section>` : '');

  /* ---------- Aimantation ---------- */
  const snapStep = () => (V.k > 120 ? 0.01 : V.k > 40 ? 0.05 : V.k > 12 ? 0.1 : 0.5);
  function vertices(f) {
    const P = []; for (const w of f.walls) P.push(w.a, w.b); for (const r of f.rooms) P.push(...r.poly);
    for (const p of data().paths || []) if (p.floor === f.id && p.kind !== 'outdoor') P.push(...p.pts);
    return P;
  }
  /** Point aimanté : sommet proche (10 px), sinon angle droit depuis le point précédent, sinon la grille. */
  function snapPt(w, from, e) {
    const f = floor(); if (S.draft) S.draft.snap = null;
    if (!f || (e && e.altKey)) return [r3(w[0]), r3(w[1])];
    let best = null, bd = 10 / V.k;
    for (const q of vertices(f)) { const d = Math.hypot(q[0] - w[0], q[1] - w[1]); if (d < bd) { bd = d; best = q; } }
    if (best) { if (S.draft) S.draft.snap = best; return [best[0], best[1]]; }
    const cs = cad && cad.snap(w, 10 / V.k); if (cs) { if (S.draft) S.draft.snap = cs; return cs; } // bouts et croisements du fond DXF
    const s = snapStep(), g = v => Math.round(v / s) * s;
    let lockX = false, lockY = false;
    if (from && !(e && e.shiftKey)) { const dx = w[0] - from[0], dy = w[1] - from[1], a = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) % 90; if (a < 8 || a > 82) { if (Math.abs(dx) > Math.abs(dy)) lockY = true; else lockX = true; } }
    // Repères d'alignement : même x ou même y qu'un sommet ou un équipement de l'étage (8 px), ligne tracée jusqu'à lui.
    const al = alignTo(w, lockX ? null : 'x', lockY ? null : 'y');
    return [r3(lockX ? from[0] : al.x != null ? al.x : g(w[0])), r3(lockY ? from[1] : al.y != null ? al.y : g(w[1]))];
  }

  /** Alignement sur les sommets et les équipements de l'étage : { x?, y? } et les repères à tracer (S.guides). */
  function alignTo(w, ax = 'x', ay = 'y', skip = null) {
    const f = floor(), out = {}; S.guides = []; if (!f) return out;
    const P = vertices(f); for (const d of data().devices) if (d.loc && d.loc.floor === f.id && d !== skip) P.push([d.loc.x, d.loc.y]);
    const tol = 8 / V.k; let bx = null, by = null;
    for (const q of P) {
      if (ax && Math.abs(q[0] - w[0]) < tol && (!bx || Math.abs(q[0] - w[0]) < Math.abs(bx[0] - w[0]))) bx = q;
      if (ay && Math.abs(q[1] - w[1]) < tol && (!by || Math.abs(q[1] - w[1]) < Math.abs(by[1] - w[1]))) by = q;
    }
    if (bx) out.x = bx[0]; if (by) out.y = by[1];
    const X = out.x ?? w[0], Y = out.y ?? w[1];
    if (bx) S.guides.push([bx[0], bx[1], X, Y]); if (by) S.guides.push([by[0], by[1], X, Y]);
    return out;
  }

  /* ---------- Outils ---------- */
  function setTool(t) {
    S.tool = t; S.draft = null; S.rect = null; S.link = null;
    if (t !== 'select') { S.multi = []; }
    svg.dataset.tool = t; paintTools(); paintOver(); if (nav) nav.update();
    if (t !== 'select') el.querySelector('.ntPlStart').hidden = true;
  }
  const used = () => siteIds(data().site);
  const newPathId = () => { const ids = new Set((data().paths || []).map(p => p.id)); let i = 1; while (ids.has('pa' + i)) i++; return 'pa' + i; };
  function finishDraft() {
    const dr = S.draft, f = floor(); if (!dr || !f) { S.draft = null; return; }
    const P = dr.pts; S.draft = null;
    if (dr.kind === 'wall' && P.length > 1) {
      const u = used(), ids = [];
      for (let i = 1; i < P.length; i++) if (dist(P[i - 1], P[i]) > 0.01) { const w = { id: uid('', 'w', u), a: P[i - 1], b: P[i], t: MATERIALS[S.wallMat].t, mat: S.wallMat }; f.walls.push(w); ids.push(w.id); }
      if (ids.length) { S.multi = ids.map(id => ({ kind: 'wall', id })); ctx.select({ kind: 'wall', id: ids[ids.length - 1] }); ctx.commit(); ctx.status(tl('{0:# mur dessiné|# murs dessinés}.', ids.length), 'ok'); }
    } else if (dr.kind === 'room' && P.length > 2) {
      addRoom(P);
    } else if (dr.kind === 'path' && P.length > 1) {
      const p = cleanPaths([{ id: newPathId(), floor: f.id, kind: S.pathKind, pts: P }])[0];
      if (p) { data().paths.push(p); S.multi = [{ kind: 'path', id: p.id }]; ctx.select({ kind: 'path', id: p.id }); ctx.commit(); ctx.status(tl('Cheminement posé : {0} m.', fmtNum(P.reduce((s, q, i) => s + (i ? dist(P[i - 1], q) : 0), 0), 1, isEn)), 'ok'); }
    } else if (dr.kind === 'measure') { S.draft = { ...dr, cur: null, done: true }; }
    paint();
  }
  function addRoom(P) {
    const f = floor(), r = { id: uid('', 'rm', used()), name: '', usage: S.usage, poly: P };
    f.rooms.push(r); S.multi = [{ kind: 'room', id: r.id }]; ctx.select({ kind: 'room', id: r.id }); ctx.commit();
    ctx.status(tl('Pièce dessinée : nommez-la dans l’inspecteur.'), 'ok');
  }
  function addDoorAt(w) {
    const f = floor(); let best = null;
    for (const x of f.walls) { const p = project(w, x.a, x.b); if (!best || p.d < best.p.d) best = { x, p }; }
    if (!best || best.p.d > Math.max(0.6, 14 / V.k)) { ctx.status(tl('Cliquez sur un mur pour y poser une porte.'), 'warn'); return; }
    const L = dist(best.x.a, best.x.b), dw = Math.min(0.9, L), at = Math.max(dw / 2, Math.min(L - dw / 2, best.p.t * L));
    const d = { id: uid('', 'dr', used()), wall: best.x.id, at: r3(at), w: dw };
    f.doors.push(d); ctx.select({ kind: 'door', id: d.id }); S.multi = [{ kind: 'door', id: d.id }]; ctx.commit();
  }
  /** Lien permanent entre deux équipements posés : ports libres côté mur, tracé automatique. */
  function linkTo(id) {
    const d = data();
    if (!S.link) { const x = d.devices.find(z => z.id === id); if (!x || !x.loc) return; S.link = [[x.loc.x, x.loc.y], [x.loc.x, x.loc.y], id]; paintOver(); ctx.status(tl('Cliquez maintenant le panneau de brassage (ou le switch).')); return; }
    const a = d.devices.find(z => z.id === S.link[2]), b = d.devices.find(z => z.id === id); S.link = null;
    if (!a || !b || a === b) { paintOver(); return; }
    const pa = freePort(d, a), pb = freePort(d, b);
    if (!pa || !pb) { ctx.status(tl('Plus de port libre sur {0}.', !pa ? a.name : b.name), 'warn'); paintOver(); return; }
    const c = ctx.addCable([a.id, pa], [b.id, pb], { kind: 'straight' }); c.route = { mode: 'auto' };
    ctx.commit(); ctx.select({ kind: 'cable', id: c.id }); paint();
    const cc = data().cables.find(z => z.id === c.id);
    ctx.status(tl('Lien posé : {0} m le long des cheminements.', fmtNum(cc ? cc.len : c.len, 1, isEn)), 'ok');
  }

  /* ---------- Sélection et gestes ---------- */
  function choose(it, add) {
    if (add) {
      const i = S.multi.findIndex(m => m.kind === it.kind && m.id === it.id);
      if (i >= 0) S.multi.splice(i, 1); else S.multi.push(it);
      ctx.select(S.multi[S.multi.length - 1] || null);
    } else if (!S.multi.some(m => m.kind === it.kind && m.id === it.id)) { S.multi = [it]; ctx.select(it); }
    else ctx.select(it);
    paint();
  }
  const hitOf = e => {
    const t = (e.type === 'pointermove' || e.type === 'pointerup' ? document.elementFromPoint(e.clientX, e.clientY) : e.target) || e.target;
    const h = t.closest && t.closest('[data-h]'); if (h) return { handle: h.dataset.h };
    const o = t.closest && t.closest('[data-k]'); return o ? { kind: o.dataset.k, id: o.dataset.id } : {};
  };
  /** Positions de départ des objets choisis (pour les déplacer ensemble). */
  function grab() {
    const d = data(), f = floor(), out = [];
    for (const m of S.multi) {
      if (m.kind === 'dev') { const x = d.devices.find(z => z.id === m.id); if (x && x.loc) out.push({ o: x.loc, keys: ['x', 'y'], v: [x.loc.x, x.loc.y] }); }
      else if (m.kind === 'rack') { const r = (d.racks || []).find(z => z.id === m.id); if (r) out.push({ o: r, keys: ['x', 'y'], v: [r.x, r.y] }); }
      else if (m.kind === 'path') { const p = (d.paths || []).find(z => z.id === m.id); if (p && p.floor === f.id) out.push({ pts: p.kind === 'outdoor' ? [p.pts[0]] : p.pts, v: (p.kind === 'outdoor' ? [p.pts[0]] : p.pts).map(q => [...q]) }); }
      else if (m.kind === 'room') { const r = f.rooms.find(z => z.id === m.id); if (r) for (const P of [r.poly, ...(r.holes || [])]) out.push({ pts: P, v: P.map(q => [...q]) }); }
      else if (m.kind === 'wall') { const w = f.walls.find(z => z.id === m.id); if (w) out.push({ pts: [w.a, w.b], v: [[...w.a], [...w.b]] }); }
    }
    return out;
  }
  const moveGrab = (g, dx, dy) => { for (const x of g) { if (x.o) { x.o.x = r3(x.v[0] + dx); x.o.y = r3(x.v[1] + dy); } else x.pts.forEach((q, i) => { q[0] = r3(x.v[i][0] + dx); q[1] = r3(x.v[i][1] + dy); }); } };
  let drag = null, lastClick = { t: 0, x: 0, y: 0 };
  svg.addEventListener('pointerdown', e => {
    if (el.hidden || e.button !== 0 || nav.tool() !== 'select') return;
    const f = floor(); if (!f) return;
    const w = toW(e.clientX, e.clientY), h = hitOf(e);
    const dbl = performance.now() - lastClick.t < 320 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 6;
    lastClick = { t: performance.now(), x: e.clientX, y: e.clientY };
    if (S.tool === 'select') {
      if (dbl && editVertex(h, w)) return;
      if (e.altKey && f.image && !f.image.lock && !h.kind) { drag = { image: f.image, w, v: [f.image.x, f.image.y] }; svg.setPointerCapture(e.pointerId); return; }
      if (h.handle) { const [kind, id, i] = h.handle.split(':'); drag = { vertex: { kind, id, i: +i }, w, moved: false }; svg.setPointerCapture(e.pointerId); return; }
      // Objets superposés sous le pointeur (point d'accès sur une prise…) : Alt+clic passe au suivant.
      const stack = h.kind === 'dev' ? [...new Set(document.elementsFromPoint(e.clientX, e.clientY).map(x => x.closest && x.closest('[data-k="dev"]')).filter(Boolean).map(x => x.dataset.id))] : [];
      if (e.altKey && stack.length > 1) {
        const cur = ctx.selection(), i = cur && cur.kind === 'dev' ? stack.indexOf(cur.id) : -1, id = stack[(i + 1) % stack.length];
        S.multi = [{ kind: 'dev', id }]; ctx.select({ kind: 'dev', id }); paint();
        ctx.status(tl('{0} objets superposés ici : Alt+clic pour passer au suivant.', stack.length)); return;
      }
      if (stack.length > 1) ctx.status(tl('{0} objets superposés ici : Alt+clic pour passer au suivant.', stack.length));
      if (h.kind) {
        choose({ kind: h.kind, id: h.id }, e.shiftKey);
        if (e.shiftKey) return;
        if (h.kind === 'door') { drag = { door: f.doors.find(d => d.id === h.id), w, moved: false }; }
        else drag = { g: grab(), w, moved: false };
        svg.setPointerCapture(e.pointerId); return;
      }
      // Dans le vide : cadre de sélection (ou simple clic : rien de choisi, l'inspecteur montre l'étage).
      dragRect(e, (r, ev, moved) => {
        if (!moved) { if (!e.shiftKey) { S.multi = []; ctx.select(null); paint(); } return; }
        const a = toW(r.x, r.y), b = toW(r.x + r.w, r.y + r.h), inR = q => q[0] >= a[0] && q[0] <= b[0] && q[1] >= a[1] && q[1] <= b[1], d = data();
        const got = e.shiftKey ? [...S.multi] : [];
        const push = (kind, id) => { if (!got.some(m => m.kind === kind && m.id === id)) got.push({ kind, id }); };
        for (const x of d.devices) if (x.loc && x.loc.floor === f.id && inR([x.loc.x, x.loc.y])) push('dev', x.id);
        for (const x of f.rooms) if (x.poly.every(inR)) push('room', x.id);
        for (const x of f.walls) if (inR(x.a) && inR(x.b)) push('wall', x.id);
        for (const x of d.paths || []) if (x.floor === f.id && x.pts.every(inR)) push('path', x.id);
        for (const x of d.racks || []) if (x.floor === f.id && inR([x.x, x.y])) push('rack', x.id);
        S.multi = got; ctx.select(got[0] || null); paint();
        if (got.length) ctx.status(tl('{0:# objet choisi|# objets choisis}.', got.length));
      }, 'ntPlMarq');
      return;
    }
    if (S.tool === 'door') { addDoorAt(w); return; }
    if (S.tool === 'link') { if (h.kind === 'dev') linkTo(h.id); else if (S.link) { S.link = null; paintOver(); } return; }
    if (S.tool === 'room' && (!S.draft || !S.draft.pts.length)) { drag = { rect: snapPt(w, null, e), moved: false, e0: [e.clientX, e.clientY] }; svg.setPointerCapture(e.pointerId); return; }
    if (S.tool === 'path' && S.pathKind === 'riser') { addPoint(w, e); return; }
    if (['wall', 'room', 'path', 'measure', 'calib'].includes(S.tool)) { if (dbl && S.draft && S.draft.pts.length > 1) { finishDraft(); return; } addPoint(w, e); }
  });
  function addPoint(w, e) {
    const f = floor(), kind = S.tool;
    if (!S.draft || S.draft.kind !== kind) S.draft = { kind, pts: [], cur: null };
    const q = snapPt(w, S.draft.pts[S.draft.pts.length - 1], e);
    if (kind === 'measure' && S.draft.done) { S.draft = { kind, pts: [], cur: null }; }
    if (kind === 'path' && S.pathKind === 'riser') {
      // Colonne montante : un point, jusqu'à l'étage du dessus s'il y en a un.
      const b = building(), up = b.floors.find(x => x.level > f.level), p = cleanPaths([{ id: newPathId(), floor: f.id, kind: 'riser', pts: [q], top: up ? up.id : f.id }])[0];
      data().paths.push(p); S.draft = null; ctx.select({ kind: 'path', id: p.id }); S.multi = [{ kind: 'path', id: p.id }]; ctx.commit();
      ctx.status(up ? tl('Colonne montante posée jusqu’à {0}.', up.name) : tl('Colonne montante posée : choisissez l’étage du haut dans l’inspecteur.'), 'ok'); return;
    }
    // Fermer une pièce en recliquant son premier sommet.
    const P = S.draft.pts;
    if (kind === 'room' && P.length > 2 && dist(q, P[0]) < 12 / V.k) { finishDraft(); return; }
    S.draft.pts.push(q);
    if (kind === 'path' && S.pathKind === 'outdoor' && S.draft.pts.length === 2) { finishDraft(); return; }
    if (kind === 'calib' && S.draft.pts.length === 2) { askCalib(); return; }
    paintOver();
  }
  svg.addEventListener('pointermove', e => {
    if (el.hidden) return;
    const w = toW(e.clientX, e.clientY);
    if (drag) {
      const dx = w[0] - drag.w[0], dy = w[1] - drag.w[1];
      if (drag.image) { drag.image.x = r3(drag.v[0] + dx); drag.image.y = r3(drag.v[1] + dy); drag.moved = true; paintSoon(); return; }
      if (drag.rect) { if (!drag.moved && Math.hypot(e.clientX - drag.e0[0], e.clientY - drag.e0[1]) < 6) return; drag.moved = true; S.rect = [drag.rect, snapPt(w, null, e)]; paintOver(); return; }
      if (drag.vertex) { moveVertex(drag.vertex, snapPt(w, null, e)); drag.moved = true; paintSoon(); return; }
      if (drag.door) { const f = floor(), x = f.walls.find(z => z.id === drag.door.wall); if (x) { const L = dist(x.a, x.b), p = project(w, x.a, x.b); drag.door.at = r3(Math.max(drag.door.w / 2, Math.min(L - drag.door.w / 2, p.t * L))); drag.moved = true; paintSoon(); } return; }
      if (drag.g && drag.g.length) {
        if (!drag.moved && Math.hypot(dx, dy) * V.k < 3) return;
        const s = e.altKey ? 0.001 : snapStep(); let mx = Math.round(dx / s) * s, my = Math.round(dy / s) * s;
        // Un seul équipement ou une baie : aligné sur les sommets et les autres équipements (repères affichés).
        if (!e.altKey && drag.g.length === 1 && drag.g[0].o) { const v = drag.g[0].v, skip = data().devices.find(z => z.loc === drag.g[0].o), al = alignTo([v[0] + dx, v[1] + dy], 'x', 'y', skip); if (al.x != null) mx = al.x - v[0]; if (al.y != null) my = al.y - v[1]; }
        moveGrab(drag.g, mx, my); drag.moved = true; paintSoon();
      }
      return;
    }
    if (S.draft && S.draft.pts.length) {
      if (S.draft.done) return; // mesure terminée : elle reste affichée jusqu'au prochain clic
      S.draft.cur = snapPt(w, S.draft.pts[S.draft.pts.length - 1], e); paintOver();
    } else if (S.link) { S.link[1] = w; paintOver(); }
  });
  svg.addEventListener('pointerup', e => {
    if (S.guides && S.guides.length && !S.draft) { S.guides = []; paintOver(); }
    if (!drag) return;
    const d = drag; drag = null;
    if (d.rect) {
      if (d.moved && S.rect) { const [a, b] = S.rect; S.rect = null; if (Math.abs(b[0] - a[0]) > 0.2 && Math.abs(b[1] - a[1]) > 0.2) { const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]); addRoom([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]); paint(); return; } paintOver(); return; }
      addPoint(toW(e.clientX, e.clientY), e); return;
    }
    if (d.moved) ctx.commit();
  });
  svg.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (S.draft && S.draft.pts.length) { finishDraft(); return; }
    if (!floor()) return;
    const h = hitOf(e), w = toW(e.clientX, e.clientY);
    if (h.kind && !S.multi.some(m => m.kind === h.kind && m.id === h.id)) choose({ kind: h.kind, id: h.id }, false);
    openMenu(e, h.kind ? 'obj' : 'canvas', w);
  });
  /* ---------- Presse-papiers, alignement, menus contextuels ---------- */
  const selList = () => (S.multi.length ? S.multi : ctx.selection() ? [ctx.selection()] : []);
  function copy(cut) {
    const f = floor(), c = f && copySel(data(), f, selList());
    if (!c) { ctx.status(tl('Rien à copier : choisissez des équipements, pièces, murs ou cheminements.'), 'warn'); return false; }
    CLIP.c = c; ctx.status(cut ? tl('{0:# objet coupé|# objets coupés}.', countClip(c)) : tl('{0:# objet copié|# objets copiés} : Ctrl+V pour coller (sur cet étage ou un autre).', countClip(c)));
    if (cut) removeSel();
    return true;
  }
  const countClip = c => Object.values(c.items).reduce((s, a) => s + a.length, 0) - c.items.doors.length;
  /** Colle : à la place d'origine sur un autre étage, décalé de 50 cm sur le même ; at : point visé (menu contextuel). */
  function paste(at) {
    const f = floor(), c = CLIP.c; if (!f || !c) return;
    let dx = c.from === f.id ? 0.5 : 0, dy = dx;
    if (at) { dx = r3(at[0] - c.box[0]); dy = r3(at[1] - c.box[1]); }
    const sel = pasteClip(data(), f, c, dx, dy, (type, p) => ctx.newDevice(type, p));
    if (!sel.length) return;
    S.multi = sel; ctx.select(sel[0]); ctx.commit(); paint();
    ctx.status(tl('{0:# objet collé|# objets collés} : nouveaux identifiants, aucun câble recopié.', sel.length), 'ok');
  }
  function duplicate() { const keep = CLIP.c; if (copy(false)) paste(null); CLIP.c = keep || CLIP.c; }
  function align(how) { const n = alignSel(data(), floor(), selList(), how); if (n) { ctx.commit(); paint(); } }
  function toFloor(id) {
    const f = floor(), g = floorOf(data().site, id); if (!f || !g) return;
    const n = moveToFloor(data(), f, g.f, selList()); if (!n) return;
    ctx.commit(); setFloor(g.f.id); ctx.status(tl('{0:# objet déplacé|# objets déplacés} vers {1}.', n, g.f.name), 'ok');
  }
  async function openMenu(e, kind, w) {
    const kit = await import('./kit/menu.js').catch(() => null);
    const show = items => (kit && kit.ctxMenu ? kit.ctxMenu(e, items) : popMenu({ getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }) }, items.filter(x => x === '-' || (!x.header && !x.items && !x.disabled))));
    const b = building(), list = selList(), many = list.length > 1, s = ctx.selection();
    if (kind === 'canvas') {
      await show([
        { label: tl('Coller ici'), icon: 'copy', keys: 'Ctrl+V', disabled: !CLIP.c, run: () => paste(w) },
        { label: tl('Tout choisir sur l’étage'), icon: 'pointer', keys: 'Ctrl+A', run: selectAll }, '-',
        { label: tl('Mur'), icon: 'wall', keys: 'W', run: () => setTool('wall') }, { label: tl('Salle'), icon: 'room', keys: 'R', run: () => setTool('room') },
        { label: tl('Cheminement'), icon: 'cableTray', keys: 'K', run: () => setTool('path') }, { label: tl('Détecter les pièces'), icon: 'wand', disabled: !(floor().walls.length > 2), run: detectHere }, '-',
        { label: tl('Importer un plan DXF ou DWG…'), icon: 'upload', run: () => cadImport() }, { label: tl('Tout voir'), icon: 'fitAll', keys: 'F', run: fit }
      ]);
      return;
    }
    const others = b ? b.floors.filter(x => x.id !== S.floor) : [];
    const moveTo = others.length ? [{ label: tl('Déplacer vers l’étage'), icon: 'layers', items: others.map(x => ({ label: x.name, run: () => toFloor(x.id) })) }] : [];
    // Un seul objet : le menu commun des vues (mêmes entrées et même ordre partout), avec les verbes du plan.
    if (!many && s && ctx.objectMenu && ctx.ctxMenu) {
      const items = ctx.objectMenu(s, {
        clipboard: [{ label: tl('Couper'), icon: 'scissors', keys: 'Ctrl+X', run: () => copy(true) }, { label: tl('Copier'), icon: 'copy', keys: 'Ctrl+C', run: () => copy(false) }, { label: tl('Coller'), icon: 'copy', keys: 'Ctrl+V', disabled: !CLIP.c, run: () => paste(null) }, ...(s.kind !== 'dev' ? [{ label: tl('Dupliquer'), icon: 'copy', keys: 'Ctrl+D', run: duplicate }] : [])],
        duplicate, remove: s.kind === 'rack' || s.kind === 'dev' || findSiteObj(data().site, s.id) || (data().paths || []).some(p => p.id === s.id) ? removeSel : null,
        extra: [...moveTo, ...(s.kind === 'dev' || s.kind === 'cable' ? [{ label: tl('Câblage et brassage'), icon: 'cable', items: jumpsFor(ctx, s, id => view.reveal(id)) }] : [])]
      });
      if (items && items.length) { await ctx.ctxMenu(e, [{ header: objName(s) }, ...items]); return; }
    }
    const jumps = !many && s ? jumpsFor(ctx, s, id => view.reveal(id)) : [];
    await show([
      { header: many ? tl('{0} objets choisis', list.length) : objName(s) },
      { label: tl('Couper'), icon: 'scissors', keys: 'Ctrl+X', run: () => copy(true) }, { label: tl('Copier'), icon: 'copy', keys: 'Ctrl+C', run: () => copy(false) },
      { label: tl('Coller'), icon: 'copy', keys: 'Ctrl+V', disabled: !CLIP.c, run: () => paste(null) }, { label: tl('Dupliquer'), icon: 'copy', keys: 'Ctrl+D', run: duplicate },
      { label: tl('Retirer'), icon: 'trash', keys: 'Del', danger: true, run: removeSel }, '-',
      ...(many ? [{ label: tl('Aligner'), items: [['left', tl('À gauche')], ['hcenter', tl('Centres (verticalement)')], ['right', tl('À droite')], ['top', tl('En haut')], ['vcenter', tl('Centres (horizontalement)')], ['bottom', tl('En bas')]].map(([k, l]) => ({ label: l, run: () => align(k) })) },
        { label: tl('Répartir'), disabled: list.length < 3, items: [{ label: tl('Horizontalement'), run: () => align('hdist') }, { label: tl('Verticalement'), run: () => align('vdist') }] }] : []),
      ...moveTo,
      ...(jumps.length ? ['-', { label: tl('Aller à'), icon: 'chevRight', items: jumps }] : []), '-',
      { label: tl('Propriétés'), icon: 'sliders', run: () => { if (ctx.app.setTab) ctx.app.setTab('nprop'); ctx.renderPane(); const p = document.querySelector('#pane-nprop input, #pane-nprop select'); if (p) p.focus(); } }
    ]);
  }
  function objName(s) {
    if (!s) return '';
    const d = data();
    if (s.kind === 'dev') { const x = d.devices.find(z => z.id === s.id); return x ? devName(x) : s.id; }
    if (s.kind === 'path') { const p = (d.paths || []).find(z => z.id === s.id); return p ? p.name || PATH_KINDS[p.kind].name() : s.id; }
    if (s.kind === 'rack') { const r = (d.racks || []).find(z => z.id === s.id); return r ? r.name : s.id; }
    const o = findSiteObj(d.site, s.id); if (!o) return s.id;
    return o.kind === 'room' ? o.o.name || USAGES[o.o.usage].name() : o.kind === 'wall' ? tl('Mur') : o.kind === 'door' ? tl('Porte') : o.o.name || s.id;
  }

  /** Double-clic en sélection : retirer un sommet (poignée) ou en ajouter un sur un tronçon. */
  function editVertex(h, w) {
    const d = data(), f = floor();
    if (h.handle) {
      const [kind, id, i] = h.handle.split(':'), list = kind === 'room' ? f.rooms.find(z => z.id === id)?.poly : kind === 'path' ? (d.paths || []).find(z => z.id === id)?.pts : null;
      if (list && list.length > (kind === 'room' ? 3 : 2)) { list.splice(+i, 1); ctx.commit(); return true; }
      return false;
    }
    const list = h.kind === 'room' ? f.rooms.find(z => z.id === h.id)?.poly : h.kind === 'path' ? (d.paths || []).find(z => z.id === h.id && z.kind !== 'riser' && z.kind !== 'outdoor')?.pts : null;
    if (!list) return false;
    let bi = -1, bd = Infinity; const n = list.length, closed = h.kind === 'room';
    for (let i = 0; i < (closed ? n : n - 1); i++) { const p = project(w, list[i], list[(i + 1) % n]); if (p.d < bd) { bd = p.d; bi = i; } }
    if (bi < 0) return false;
    const p = project(w, list[bi], list[(bi + 1) % n]); list.splice(bi + 1, 0, [r3(p.x), r3(p.y)]); ctx.commit(); return true;
  }
  function moveVertex(vx, q) {
    const d = data(), f = floor();
    if (vx.kind === 'wall') { const w = f.walls.find(z => z.id === vx.id); if (w) w[vx.i ? 'b' : 'a'] = q; }
    else if (vx.kind === 'room') { const r = f.rooms.find(z => z.id === vx.id); if (r && r.poly[vx.i]) r.poly[vx.i] = q; }
    else if (vx.kind === 'path') { const p = (d.paths || []).find(z => z.id === vx.id); if (p && p.pts[vx.i]) p.pts[vx.i] = q; }
  }
  /** Retire les objets choisis (les baies restent : elles appartiennent à la vue Baies). */
  function removeSel() {
    const d = data(), f = floor(); const list = S.multi.length ? S.multi : ctx.selection() ? [ctx.selection()] : [];
    if (!list.length || !f) return;
    let n = 0, racks = 0;
    for (const m of list) {
      if (m.kind === 'dev') { const before = d.devices.length; d.devices = d.devices.filter(x => x.id !== m.id); if (d.devices.length < before) { d.cables = d.cables.filter(c => c.a[0] !== m.id && c.b[0] !== m.id); n++; } }
      else if (m.kind === 'cable') { d.cables = d.cables.filter(c => c.id !== m.id); n++; }
      else if (m.kind === 'path') { d.paths = d.paths.filter(p => p.id !== m.id); n++; }
      else if (m.kind === 'rack') { const k = removeRackFrom(d, m.id, RK); if (k >= 0) { n++; racks += k; } }
      else if (m.kind === 'room') { f.rooms = f.rooms.filter(r => r.id !== m.id); n++; }
      else if (m.kind === 'wall') { f.walls = f.walls.filter(w => w.id !== m.id); f.doors = f.doors.filter(x => x.wall !== m.id); n++; }
      else if (m.kind === 'door') { f.doors = f.doors.filter(x => x.id !== m.id); n++; }
      else if (m.kind === 'floor' || m.kind === 'building') { action('del', m); return; }
    }
    S.multi = []; ctx.select(null);
    if (n) { ctx.commit(); ctx.status(tl('{0:# objet retiré|# objets retirés} (Ctrl+Z pour annuler).', n), 'ok'); }
    if (racks) ctx.status(tl('{0:# équipement sorti|# équipements sortis} de la baie : ils restent dans le projet (vue Baies pour les ranger).', racks));
    paint();
  }
  function nudge(dx, dy) { const g = grab(); if (!g.length) return; moveGrab(g, dx, dy); ctx.commit(); }
  function selectAll() {
    const f = floor(), d = data(); if (!f) return;
    S.multi = [...d.devices.filter(x => x.loc && x.loc.floor === f.id).map(x => ({ kind: 'dev', id: x.id })), ...f.rooms.map(x => ({ kind: 'room', id: x.id })), ...f.walls.map(x => ({ kind: 'wall', id: x.id })), ...(d.paths || []).filter(x => x.floor === f.id).map(x => ({ kind: 'path', id: x.id }))];
    ctx.select(S.multi[0] || null); paint(); ctx.status(tl('{0:# objet choisi|# objets choisis}.', S.multi.length));
  }

  /* ---------- Étages, bâtiments, plan importé ---------- */
  /** Pièces fermées par les murs de l'étage, créées d'un coup (un seul Ctrl+Z). */
  function detectHere() {
    const f = floor(); if (!f) return;
    const made = addDetectedRooms(data(), f, S.usage);
    if (!made.length) { ctx.status(tl('Aucun espace fermé par les murs sans pièce : fermez les murs (bouts à moins de 15 cm) ou dessinez la pièce.'), 'warn'); return; }
    S.multi = made.map(r => ({ kind: 'room', id: r.id })); ctx.select(S.multi[0]); ctx.commit(); paint();
    ctx.status(tl('{0:# pièce détectée|# pièces détectées} : nommez-les et choisissez leur usage dans l’inspecteur.', made.length), 'ok');
  }
  function setFloor(id, fitNow) {
    if (!floorOf(data().site, id)) return;
    S.floor = id; S.multi = []; S.draft = null;
    const v = S.views.get(id); if (v) Object.assign(V, v);
    ctx.select({ kind: 'floor', id }); paint();
    if (fitNow || (!v && !S.seen.has(id))) { S.seen.add(id); requestAnimationFrame(fit); }
  }
  function newBuilding() {
    const d = data(), u = used(), n = d.site.buildings.length;
    const b = { id: uid('', 'B', u), name: tl('Bâtiment {0}', n + 1), x: n ? Math.max(...d.site.buildings.map(x => x.x)) + 80 : 0, y: 0, floors: [] };
    const f = { id: uid('', 'F', u), name: tl('Rez-de-chaussée'), level: 0, elev: 0, height: 3.5, ceil: 2.7, plenum: 0.6, raised: 0, walls: [], doors: [], rooms: [] };
    b.floors.push(f); d.site.buildings.push(b); S.floor = f.id; ctx.commit(); setFloor(f.id, true);
    ctx.status(tl('Bâtiment créé : dessinez ses murs (W) et ses pièces (R).'), 'ok');
  }
  function addFloor(b, below = false) {
    const fs = b.floors, top = fs.reduce((m, f) => (!m || f.level > m.level ? f : m), null), low = fs.reduce((m, f) => (!m || f.level < m.level ? f : m), null);
    const ref = below ? low : top, level = ref ? ref.level + (below ? -1 : 1) : 0, h = ref ? ref.height : 3.5;
    const f = { id: uid('', 'F', used()), name: level === 0 ? tl('Rez-de-chaussée') : tl('Niveau {0}', level), level, elev: ref ? r3(below ? ref.elev - h : ref.elev + ref.height) : 0, height: h, ceil: ref ? ref.ceil : 2.7, plenum: ref ? ref.plenum : 0.6, raised: ref ? ref.raised : 0, walls: [], doors: [], rooms: [] };
    fs.push(f); fs.sort((a, c) => a.level - c.level); ctx.commit(); setFloor(f.id, true); return f;
  }
  function copyFloor() {
    const f = floor(), b = building(); if (!f) return;
    const g = addFloor(b), u = used(), wmap = new Map(), d = data();
    for (const w of f.walls) { const id = uid('', 'w', u); wmap.set(w.id, id); g.walls.push({ ...w, id, a: [...w.a], b: [...w.b] }); }
    for (const x of f.doors) if (wmap.has(x.wall)) g.doors.push({ ...x, id: uid('', 'dr', u), wall: wmap.get(x.wall) });
    for (const r of f.rooms) g.rooms.push({ ...r, id: uid('', 'rm', u), poly: r.poly.map(q => [...q]), ...(r.holes ? { holes: r.holes.map(hh => hh.map(q => [...q])) } : {}) });
    for (const p of (d.paths || []).filter(x => x.floor === f.id && x.kind !== 'riser' && x.kind !== 'outdoor')) d.paths.push({ ...p, id: newPathId(), floor: g.id, pts: p.pts.map(q => [...q]) });
    if (f.image) g.image = { ...f.image };
    ctx.commit(); paint(); ctx.status(tl('Étage dupliqué : murs, portes, pièces et cheminements copiés sur {0}.', g.name), 'ok');
  }
  function deleteFloor(id) {
    const d = data(), F = floorOf(d.site, id); if (!F) return;
    F.b.floors = F.b.floors.filter(x => x.id !== id);
    if (!F.b.floors.length) d.site.buildings = d.site.buildings.filter(x => x !== F.b);
    for (const x of d.devices) if (x.loc && x.loc.floor === id) delete x.loc;
    d.paths = (d.paths || []).filter(p => p.floor !== id);
    S.floor = null; S.multi = []; ctx.select(null); ctx.commit(); paint(); fit();
    ctx.status(tl('Étage retiré (Ctrl+Z pour annuler).'), 'ok');
  }
  const file = $('.ntPlFile');
  file.addEventListener('change', () => {
    const fl = file.files && file.files[0]; file.value = ''; if (!fl) return;
    if (!/^image\/(png|jpeg|webp)$/.test(fl.type)) { ctx.status(tl('Choisissez une image PNG, JPG ou WebP.'), 'warn'); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        let url = String(rd.result), iw = img.naturalWidth, ih = img.naturalHeight;
        // Image trop lourde : réduite à 4 000 px de côté (JPEG), le plan reste lisible.
        if (url.length > 8e6 || Math.max(iw, ih) > 6000) { const s = 4000 / Math.max(iw, ih), c = document.createElement('canvas'); c.width = Math.round(iw * Math.min(1, s)); c.height = Math.round(ih * Math.min(1, s)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); url = c.toDataURL('image/jpeg', 0.85); iw = c.width; ih = c.height; }
        const f = floor(), d = data(); if (!f) return;
        const b = boundsOf(f), wide = b ? Math.max(10, b[2] - b[0]) : 40;
        const id = 'img' + Date.now().toString(36);
        if (f.image && d.images[f.image.id]) delete d.images[f.image.id];
        d.images[id] = url; f.image = { id, x: b ? b[0] : 0, y: b ? b[1] : 0, scale: wide / iw, iw, ih, rot: 0, opacity: 0.5, lock: false };
        S.layers.image = true; ctx.commit(); fit();
        ctx.status(tl('Plan importé : étalonnez-le (inspecteur de l’étage) en cliquant deux points de distance connue.'), 'ok');
      };
      img.src = String(rd.result);
    };
    rd.readAsDataURL(fl);
  });
  function askCalib() {
    const P = S.draft.pts, L = dist(P[0], P[1]);
    calib.hidden = false; calib.elements.d.value = (Math.round(L * 100) / 100).toString(); calib.elements.d.focus(); calib.elements.d.select();
    paintOver();
  }
  calib.addEventListener('submit', e => {
    e.preventDefault(); const f = floor(), dr = S.draft, real = +String(calib.elements.d.value).replace(',', '.');
    calib.hidden = true;
    if (!f || !f.image || !dr || dr.pts.length < 2 || !(real > 0)) { setTool('select'); return; }
    const [p] = dr.pts, L = dist(dr.pts[0], dr.pts[1]); if (L < 1e-6) { setTool('select'); return; }
    const k = real / L, im = f.image;
    im.scale = im.scale * k; im.x = r3(p[0] - (p[0] - im.x) * k); im.y = r3(p[1] - (p[1] - im.y) * k);
    setTool('select'); ctx.commit(); fit();
    ctx.status(tl('Plan étalonné : {0} cm par pixel.', fmtNum(im.scale * 100, 3, isEn)), 'ok');
  });
  calib.addEventListener('click', e => { if (e.target.closest('[data-calib="no"]')) { calib.hidden = true; setTool('select'); } });
  /** Boutons de l'inspecteur, de la carte vide et du menu des étages. */
  async function action(a, s) {
    const d = data(), f = floor(), so = s && findSiteObj(d.site, s.id);
    if (a === 'newBuilding') newBuilding();
    else if (a === 'demo') {
      let newRack = null; try { const m = await import('../rack.js'); newRack = m.newRack; } catch (e) { /* baies indisponibles */ }
      const r = addDemoFloor(d, { newRack }); ctx.commit(); setFloor(r.floor.id, true);
      ctx.status(tl('Étage d’exemple ajouté : {0} liens permanents au tracé automatique.', d.cables.filter(c => c.route).length), 'ok');
    }
    else if (a === 'addFloor') { const b = so && so.kind === 'building' ? so.b : building(); if (b) addFloor(b); }
    else if (a === 'addFloorBelow') { const b = building(); if (b) addFloor(b, true); }
    else if (a === 'copyFloor') copyFloor();
    else if (a === 'detect') detectHere();
    else if (a === 'image') { if (!f) newBuilding(); file.click(); }
    else if (a === 'rmImage') { if (f && f.image) { delete d.images[f.image.id]; delete f.image; ctx.commit(); } }
    else if (a === 'cad') cadImport();
    else if (a === 'cadcard') { const c = await cadLoad(); if (c && c.toggleCard) c.toggleCard(true); }
    else if (a === 'calib') { if (f && f.image) { setTool('calib'); ctx.status(tl('Cliquez deux points du plan importé dont vous connaissez la distance.')); } }
    else if (a === 'del') {
      if (s && (s.kind === 'floor' || (so && so.kind === 'floor'))) deleteFloor(s.id);
      else if (s && so && so.kind === 'building') { for (const x of [...so.b.floors]) { for (const z of d.devices) if (z.loc && z.loc.floor === x.id) delete z.loc; d.paths = d.paths.filter(p => p.floor !== x.id); } d.site.buildings = d.site.buildings.filter(x => x !== so.b); S.floor = null; ctx.select(null); ctx.commit(); paint(); fit(); }
      else if (!s && f) deleteFloor(f.id);
      else removeSel();
    }
    else if (a === 'door' && so && so.kind === 'wall') { const L = dist(so.o.a, so.o.b), dw = Math.min(0.9, L); f.doors.push({ id: uid('', 'dr', used()), wall: so.o.id, at: r3(L / 2), w: dw }); ctx.commit(); }
    else if ((a === 'rack' || a === 'wrack') && so && so.kind === 'room') {
      try {
        const m = await import('../rack.js'), [x, y] = (await import('../site.js')).roomPoint(so.o);
        const r = m.newRack(d, a === 'wrack' ? 'wall' : 'floor', { floor: so.f.id, room: so.o.id, x: r3(x), y: r3(y), rot: 0 });
        d.racks = d.racks || []; d.racks.push(r); ctx.commit(); ctx.select({ kind: 'rack', id: r.id }); S.multi = [{ kind: 'rack', id: r.id }]; paint();
        ctx.status(tl('Baie {0} posée : équipez-la dans la vue Baies.', r.name), 'ok');
      } catch (e) { console.error(e); ctx.status(tl('Les baies ne sont pas disponibles.'), 'warn'); }
    }
    else if (a === 'rot' && s && s.kind === 'rack') { const r = (d.racks || []).find(x => x.id === s.id); if (r) { r.rot = ((r.rot || 0) + 90) % 360; ctx.commit(); } }
    else if (a === 'openRack' && s) ctx.openView('racks').then(v => v && v.reveal && v.reveal(s.id));
  }
  async function floorMenu(anchor) {
    const b = building(), items = [
      { label: tl('Nouvel étage au-dessus'), icon: 'plus', value: 'addFloor' }, { label: tl('Nouvel étage en dessous'), icon: 'plus', value: 'addFloorBelow' },
      { label: tl('Dupliquer l’étage'), icon: 'copy', value: 'copyFloor' }, '-',
      { label: tl('Nouveau bâtiment'), icon: 'building', value: 'newBuilding' }, { label: tl('Étage d’exemple (bureaux)'), icon: 'floorPlan', value: 'demo' },
      { label: tl('Importer un plan (image)'), icon: 'image', value: 'image' }, { label: tl('Importer un plan DXF ou DWG…'), icon: 'upload', value: 'cad' }
    ].filter(it => it === '-' || b || ['newBuilding', 'demo', 'image', 'cad'].includes(it.value));
    const v = await popMenu(anchor, items); if (v) action(v, null);
  }

  /* ---------- Barres et cartes ---------- */
  $('.ntPlTop').addEventListener('click', e => {
    if (e.target.closest('[data-pldetect]')) { detectHere(); return; }
    const t = e.target.closest('[data-pltool],[data-layer],[data-plf],[data-plmenu],[data-plbsel]'); if (!t) return;
    if (t.dataset.pltool) setTool(t.dataset.pltool);
    else if (t.dataset.plf) setFloor(t.dataset.plf);
    else if (t.dataset.plmenu != null) floorMenu(t);
    else if (t.dataset.plbsel != null) { const b = building(); if (b) { ctx.select({ kind: 'building', id: b.id }); paint(); } }
    else if (t.dataset.layer) toggleLayer(t.dataset.layer);
  });
  $('.ntPlTop').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.plfsel != null) { setFloor(t.value, !S.seen.has(t.value)); return; }
    if (t.dataset.plb != null) { const b = data().site.buildings.find(x => x.id === t.value); if (b && b.floors[0]) setFloor(b.floors[0].id, !S.seen.has(b.floors[0].id)); }
    if (t.dataset.plsub) { S[t.dataset.plsub] = t.value; paintTools(); }
  });
  el.querySelector('.ntPlEmpty').addEventListener('click', e => { const b = e.target.closest('[data-pla]'); if (b) action(b.dataset.pla, null); });
  el.querySelector('.ntPlStart').addEventListener('click', e => { const b = e.target.closest('[data-pla]'), t = e.target.closest('[data-pltool]'); if (b) action(b.dataset.pla, null); else if (t) { setTool(t.dataset.pltool); paintWorld(); } });
  async function toggleLayer(l) {
    if (l === 'cad') { const c = await cadLoad(); if (c) c.toggleCard(); return; }
    S.layers[l] = !S.layers[l];
    if (l === 'wifi' && S.layers.wifi && !wifi) {
      try { const m = await import('./wifilayer.js'); wifi = m.createWifiLayer(ctx); if (wifi && wifi.onReady) wifi.onReady(() => { paintCanvas(); paintWifi(); ctx.renderPane(); }); }
      catch (e) { console.error(e); S.layers.wifi = false; ctx.status(tl('Le calque Wi-Fi n’a pas pu se charger.'), 'err'); }
    }
    paint();
    if (l === 'wifi') ctx.renderPane();
  }
  wcard.addEventListener('toggle', e => { if (e.target.matches && e.target.matches('details.ntPlWfAp')) wcard.dataset.open = e.target.open ? '1' : '0'; }, true);
  const wifiEvent = e => { if (!wifi || !wifi.handle) return; const s = ctx.selection(), x = s && s.kind === 'dev' ? data().devices.find(z => z.id === s.id) : null; try { if (wifi.handle(e, x)) { paintCanvas(); if (e.type === 'change') { paintWifi(); ctx.renderPane(); } return true; } } catch (err) { console.error(err); } };
  wcard.addEventListener('click', wifiEvent); wcard.addEventListener('change', wifiEvent);
  info.addEventListener('change', e => {
    const t = e.target, s = ctx.selection(), d = data(); if (!s) return;
    if (t.dataset.pli === 'h' && s.kind === 'dev') { const x = d.devices.find(z => z.id === s.id); const v = +String(t.value).replace(',', '.'); if (x && x.loc && Number.isFinite(v)) { x.loc.h = Math.max(0, Math.min(30, v)); ctx.commit(); } }
    if (t.dataset.pli === 'auto' && s.kind === 'cable') { const c = d.cables.find(z => z.id === s.id); if (c) { c.route = { mode: t.checked ? 'auto' : 'manual' }; ctx.commit(); } }
  });
  info.addEventListener('click', e => {
    const t = e.target.closest('[data-pli="unplace"]'), s = ctx.selection(); if (!t || !s) return;
    const x = data().devices.find(z => z.id === s.id); if (x) { delete x.loc; S.multi = []; ctx.select(null); ctx.commit(); }
  });

  /* ---------- Palette de commandes ---------- */
  if (ctx.app && ctx.app.commands) {
    const when = () => ctx.isOn() && ctx.view() === 'plan';
    try {
      ctx.app.commands.register({ id: 'net.plan.building', cat: tl('Réseau'), icon: 'building', label: tl('Plans : nouveau bâtiment'), when, run: () => newBuilding() });
      ctx.app.commands.register({ id: 'net.plan.floor', cat: tl('Réseau'), icon: 'plus', label: tl('Plans : nouvel étage au-dessus'), when: () => when() && !!building(), run: () => addFloor(building()) });
      ctx.app.commands.register({ id: 'net.plan.image', cat: tl('Réseau'), icon: 'image', label: tl('Plans : importer un plan (image)'), when, run: () => action('image') });
      ctx.app.commands.register({ id: 'net.plan.cad', cat: tl('Réseau'), icon: 'upload', label: tl('Plans : importer un plan DXF ou DWG'), when: () => ctx.isOn(), run: () => ctx.openView('plan').then(() => cadImport()) });
      ctx.app.commands.register({ id: 'net.plan.cadLayers', cat: tl('Réseau'), icon: 'layers', label: tl('Plans : calques du fond DXF'), when: () => when() && cadHas(floor()), run: () => toggleLayer('cad') });
      ctx.app.commands.register({ id: 'net.plan.wifi', cat: tl('Réseau'), icon: 'wifi', label: tl('Plans : afficher ou masquer le calque Wi-Fi'), when, run: () => toggleLayer('wifi') });
      ctx.app.commands.register({ id: 'net.plan.detect', cat: tl('Réseau'), icon: 'wand', label: tl('Plans : détecter les pièces fermées par les murs'), when: () => when() && !!floor(), run: () => detectHere() });
      ctx.app.commands.register({ id: 'net.plan.demo', cat: tl('Réseau'), icon: 'floorPlan', label: tl('Plans : ajouter un étage d’exemple'), when, run: () => action('demo') });
    } catch (e) { console.error(e); }
  }
  new ResizeObserver(() => { if (!el.hidden) { paintOver(); if (!!(stage.clientWidth && stage.clientWidth < 860) !== !!S.narrow) paintFloors(); } }).observe(stage);

  /* ---------- Contrat des vues ---------- */
  const view = {
    el,
    show() { el.hidden = false; svg.dataset.tool = S.tool; nav.update(); if (!S.floor || !floorOf(data().site, S.floor)) { const f = floor(); if (f) { S.seen.add(f.id); requestAnimationFrame(fit); } } },
    hide() { el.hidden = true; calib.hidden = true; nav.update(); },
    render(why) {
      if (el.hidden) return;
      if (why === 'load') { S.multi = []; S.draft = null; S.seen.clear(); S.views.clear(); S.floor = null; if (cad) cad.reset(); }
      // La sélection partagée a pu changer ailleurs (annuler, autre vue) : la sélection multiple suit.
      const s = ctx.selection(); if (S.multi.length && (!s || !S.multi.some(m => m.kind === s.kind && m.id === s.id))) S.multi = s ? [s] : [];
      bad = issueIds(); const f = floor(); paint();
      if (f && !S.seen.has(f.id)) { S.seen.add(f.id); requestAnimationFrame(fit); }
    },
    key(e) {
      if (e.type !== 'keydown') return false;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod) {
        if (k === 'a') { selectAll(); return true; }
        if (k === 'c' && !e.shiftKey) return copy(false), true;
        if (k === 'x') return copy(true), true;
        if (k === 'v') { paste(null); return true; }
        if (k === 'd') { duplicate(); return true; }
        return false;
      }
      if (!calib.hidden) return false;
      if (k === 'v' && !e.altKey) { setTool('select'); nav.setTool('select'); return true; }
      if (cad && cad.key(e)) return true;
      if (nav.key(e)) return true;
      if (e.altKey) return false;
      if (KEY_TOOL[k] && !e.shiftKey) { setTool(KEY_TOOL[k]); return true; }
      if (k === 'enter') { if (S.draft) { finishDraft(); return true; } return false; }
      if (k === 'escape') {
        if (S.draft && S.draft.pts.length > 1 && ['wall', 'path'].includes(S.draft.kind)) finishDraft();
        else if (S.draft || S.rect || S.link) { S.draft = null; S.rect = null; S.link = null; paintOver(); }
        else if (S.tool !== 'select') setTool('select');
        else { S.multi = []; ctx.select(null); paint(); }
        return true;
      }
      if (k === 'delete' || k === 'backspace') { if (S.draft && S.draft.pts.length) { S.draft.pts.pop(); paintOver(); } else removeSel(); return true; }
      const step = e.shiftKey ? 1 : 0.1, arrows = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
      if (arrows[k] && S.tool === 'select') { nudge(...arrows[k]); return true; }
      return false;
    },
    keyup(e) { nav.key(e); },
    fit,
    /** Sélection multiple (navigateur du projet) : les objets de l'étage montré, ou de l'étage du dernier objet. */
    multi: () => S.multi,
    selectMany(list) {
      const d = data(), at = m => { if (m.kind === 'dev') { const x = d.devices.find(z => z.id === m.id); return x && x.loc ? x.loc.floor : null; } if (m.kind === 'rack') { const r = (d.racks || []).find(z => z.id === m.id); return r ? r.floor : null; } if (m.kind === 'path') { const p = (d.paths || []).find(z => z.id === m.id); return p ? p.floor : null; } const o = findSiteObj(d.site, m.id); return o && o.f && ['room', 'wall', 'door'].includes(o.kind) ? o.f.id : null; };
      const fl = list.map(at), last = [...fl].reverse().find(Boolean) || null;
      if (last && last !== S.floor && !fl.includes(S.floor)) { S.floor = last; S.seen.add(last); }
      S.multi = list.filter((m, i) => fl[i] === S.floor); paint();
    },
    /** Étage montré (id) : calques, fil d'Ariane. */
    floor: () => (floor() ? floor().id : null),
    reveal(id) {
      const d = data(); let fid = null, sel = null, b = null;
      const dv = d.devices.find(x => x.id === id);
      if (dv && dv.loc) { fid = dv.loc.floor; sel = { kind: 'dev', id }; b = [dv.loc.x - 3, dv.loc.y - 3, dv.loc.x + 3, dv.loc.y + 3]; }
      const p = !sel && (d.paths || []).find(x => x.id === id); if (p) { fid = p.floor; sel = { kind: 'path', id }; b = bbox(p.kind === 'outdoor' ? [p.pts[0]] : p.pts); }
      const r = !sel && (d.racks || []).find(x => x.id === id); if (r) { fid = r.floor; sel = { kind: 'rack', id }; b = bbox(rackQuad(r)); }
      const c = !sel && d.cables.find(x => x.id === id);
      if (c) { const rr = routeCable(d, c, true); if (rr && rr.legs && rr.legs.length) { fid = rr.legs[0].floor; b = bbox(rr.legs.filter(l => l.floor === fid).flatMap(l => l.pts)); sel = { kind: 'cable', id }; } }
      const o = !sel && findSiteObj(d.site, id);
      if (o) {
        fid = o.f ? o.f.id : o.b.floors[0] && o.b.floors[0].id; sel = { kind: o.kind, id };
        b = o.kind === 'room' ? bbox(o.o.poly) : o.kind === 'wall' ? bbox(wallQuad(o.o)) : o.kind === 'door' ? (() => { const w = o.f.walls.find(x => x.id === o.o.wall); return w ? bbox([w.a, w.b]) : null; })() : null;
      }
      if (!sel || !fid || !floorOf(d.site, fid)) return false;
      if (S.floor !== fid) { S.floor = fid; S.seen.add(fid); }
      S.multi = sel.kind === 'floor' || sel.kind === 'building' ? [] : [sel]; ctx.select(sel); paint();
      if (b) fitTo([b[0] - 4, b[1] - 4, b[2] + 4, b[3] + 4]); else fit();
      return true;
    },
    pane: s => { const h = paneHtml(ctx, viewApi, s); return h == null ? null : wifiPane() + h; },
    paneEvent: (e, s) => { if (e.target && e.target.closest && e.target.closest('.ntPlWifiPane')) { if (e.type === 'click' || e.type === 'change') wifiEvent(e); return true; } return paneEvent(ctx, viewApi, e, s); },
    drop(type, ev) {
      if (!DEVICES[type]) return;
      if (!floor()) newBuilding();
      const f = floor(), r = rect();
      let w = ev ? toW(ev.clientX, ev.clientY) : [V.x + r.width / 2 / V.k, V.y + r.height / 2 / V.k];
      if (ev && (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom)) return;
      w = snapPt(w, null, ev);
      const d = ctx.newDevice(type, { x: Math.round(w[0] * 20), y: Math.round(w[1] * 20) });
      d.loc = { floor: f.id, x: w[0], y: w[1], h: defaultH(type, f) };
      S.multi = [{ kind: 'dev', id: d.id }]; ctx.select({ kind: 'dev', id: d.id }); ctx.commit(); paint();
      const room = roomAt(f, w[0], w[1]);
      ctx.status(room ? tl('{0} posé dans {1}. Outil Lien (L) : le relier au panneau de brassage.', DEVICES[type].name(), room.name || USAGES[room.usage].name()) : tl('{0} posé (hors pièce).', DEVICES[type].name()), 'ok');
      if (isTechRoom(room) && /^(patch|switch)/.test(type)) ctx.status(tl('Astuce : posez une baie dans le local technique (inspecteur de la pièce), puis rangez l’équipement dans la vue Baies.'));
    }
  };
  const viewApi = { floor, building, multi, setFloor, action, paint, removeSel };
  /** Menus de l'application (shellnet.js) : outil, calques, actions des étages, tout choisir, étage montré. */
  view.cmd = { tool: t => setTool(t), layer: l => toggleLayer(l), layers: () => ({ ...S.layers }), action: a => action(a, null), selectAll: () => selectAll(), floor: () => floor(),
    /** Bandeau « Et maintenant ? » après un import (IFC) : la vue se recadre sous lui (plan-underlay.js). */
    coach: c => cadLoad().then(l => { if (l && l.coach) l.coach(c); else fit(); }) };
  return view;
}
