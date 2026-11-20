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
      </div>
    </div>
    <div class="ntBar bottom ntPlBottom"><div class="glass ntPlScale"><i></i><span></span></div><div class="glass ntPlInfo" hidden></div><span class="grow"></span><span class="ntHint glass ntPlHint"></span></div>
    <div class="glass ntPlWifi" hidden></div>
    <form class="glass ntPlCalib" hidden><b>${icon('calibrate')}${tl('Étalonner le plan importé')}</b><label>${tl('Distance réelle entre les deux points (m)')}<input class="inp" name="d" type="number" min="0.01" step="0.01" required></label><div class="row"><button type="button" class="btn small subtle" data-calib="no">${tl('Fermer')}</button><button class="btn small primary">${tl('Appliquer')}</button></div></form>
    <div class="ntPlEmpty" hidden><div class="ntEmptyCard">${icon('floorPlan')}<b>${tl('Plans d’étage')}</b><p>${tl('Dessinez le bâtiment à l’échelle : murs, pièces, local technique, chemins de câbles. Les prises et les points d’accès posés ici donnent aux câbles leur longueur réelle.')}</p><div class="row"><button type="button" class="btn primary" data-pla="newBuilding">${icon('plus')}<span>${tl('Nouveau bâtiment')}</span></button><button type="button" class="btn" data-pla="demo">${icon('floorPlan')}<span>${tl('Étage d’exemple')}</span></button></div></div></div>
    <input class="ntPlFile" type="file" accept="image/png,image/jpeg,image/webp" hidden>`;
  ctx.host.appendChild(el);
  const $ = s => el.querySelector(s);
  const stage = $('.ntPlStage'), svg = $('.ntPlSvg'), gW = $('.ntPlWorld'), gO = $('.ntPlOver'), cv = $('.ntPlCv'), info = $('.ntPlInfo'), wcard = $('.ntPlWifi'), calib = $('.ntPlCalib');
  const V = { x: -2, y: -2, k: 24 };
  const S = { floor: null, tool: 'select', pathKind: 'tray', wallMat: 'block', usage: 'office', draft: null, rect: null, link: null, multi: [], layers: { image: true, routes: true, wifi: false }, seen: new Set(), views: new Map() };
  let wifi = null, labeler = null, raf = 0, rafW = 0;
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
    if (!f) { gW.innerHTML = ''; return; }
    const im = f.image && S.layers.image ? d.images[f.image.id] : null;
    gW.innerHTML = worldSvg(d, f, { sel: selKeys(), img: im, legs, bad, k: V.k });
  }
  function paintOverNow() {
    raf = 0; const f = floor(); if (!f) { gO.innerHTML = ''; return; }
    const r = rect();
    gO.innerHTML = overSvg(data(), f, { toS, W: r.width, H: r.height, k: V.k, sel: selKeys(), en: isEn, name: devName, draft: S.draft, rect: S.rect, link: S.link, handles: handles(f), bad });
    paintCanvas();
  }
  function paintOver() { if (!raf) raf = requestAnimationFrame(paintOverNow); }
  /** Tout redessiner (modèle ou sélection changés). */
  function paint() { computeLegs(); paintWorld(); paintFloors(); paintTools(); paintInfo(); paintWifi(); applyView(); }
  function paintSoon() { if (!rafW) rafW = requestAnimationFrame(() => { rafW = 0; paintWorld(); paintOverNow(); }); }
  function paintCanvas() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); g.clearRect(0, 0, w, h);
    const f = floor();
    if (S.layers.wifi && wifi && f) { try { wifi.paint(cv, { floor: f, view: { x: V.x, y: V.y, k: V.k }, data: data() }); } catch (e) { console.error(e); } }
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
    if (bs.length > 1) h += `<select class="sel ntPlBld" data-plb aria-label="${tl('Bâtiment')}">${bs.map(x => `<option value="${esc(x.id)}"${b && x.id === b.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
    else if (b) h += `<button type="button" class="ntPlBName" data-plbsel data-tip="${tl('Réglages du bâtiment')}">${icon('building')}<span>${esc(b.name)}</span></button>`;
    if (b) h += b.floors.map(x => `<button type="button" role="tab" class="ntPlFTab" data-plf="${esc(x.id)}" aria-selected="${f && x.id === f.id}" data-tip="${esc(tl('Niveau {0} · altitude {1} m', x.level, fmtNum(x.elev, 2, isEn)))}">${esc(x.name)}</button>`).join('');
    h += `<button type="button" class="tb" data-plmenu data-tip="${tl('Étages et bâtiments')}" aria-label="${tl('Étages et bâtiments')}">${icon('plus')}</button>`;
    $('.ntPlFloors').innerHTML = h;
  }
  function paintTools() {
    el.querySelectorAll('[data-pltool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pltool === S.tool)));
    el.querySelectorAll('[data-layer]').forEach(b => b.setAttribute('aria-pressed', String(!!S.layers[b.dataset.layer])));
    const sub = $('.ntPlSub');
    if (S.tool === 'path') sub.innerHTML = `<label><span>${tl('Genre')}</span><select class="sel" data-plsub="pathKind">${Object.entries(PATH_KINDS).map(([k, x]) => `<option value="${k}"${k === S.pathKind ? ' selected' : ''}>${esc(x.name())}</option>`).join('')}</select></label>`;
    else if (S.tool === 'wall') sub.innerHTML = `<label><span>${tl('Matériau')}</span><select class="sel" data-plsub="wallMat">${Object.entries(MATERIALS).map(([k, m]) => `<option value="${k}"${k === S.wallMat ? ' selected' : ''}>${esc(m.name())}</option>`).join('')}</select></label>`;
    else if (S.tool === 'room') sub.innerHTML = `<label><span>${tl('Usage')}</span><select class="sel" data-plsub="usage">${Object.entries(USAGES).map(([k, u]) => `<option value="${k}"${k === S.usage ? ' selected' : ''}>${esc(u.name())}</option>`).join('')}</select></label><button type="button" class="btn small subtle" data-pldetect data-tip="${esc(tl('Crée une pièce dans chaque espace fermé par les murs qui n’en a pas encore'))}">${icon('wand')}<span>${tl('Détecter les pièces')}</span></button>`;
    else sub.innerHTML = '';
    sub.hidden = !sub.innerHTML;
    const t = TOOLS.find(x => x[0] === S.tool);
    $('.ntPlHint').textContent = S.tool === 'calib' ? tl('Étalonnage : cliquez deux points du plan importé dont vous connaissez la distance.') : t ? t[4]() : '';
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
    info.innerHTML = h; info.hidden = !h; $('.ntPlHint').hidden = !!h;
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
    if (ap) wcard.innerHTML = wifiHtml(ap);
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
    const s = snapStep(), g = v => Math.round(v / s) * s;
    let lockX = false, lockY = false;
    if (from && !(e && e.shiftKey)) { const dx = w[0] - from[0], dy = w[1] - from[1], a = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) % 90; if (a < 8 || a > 82) { if (Math.abs(dx) > Math.abs(dy)) lockY = true; else lockX = true; } }
    return [r3(lockX ? from[0] : g(w[0])), r3(lockY ? from[1] : g(w[1]))];
  }

  /* ---------- Outils ---------- */
  function setTool(t) {
    S.tool = t; S.draft = null; S.rect = null; S.link = null;
    if (t !== 'select') { S.multi = []; }
    svg.dataset.tool = t; paintTools(); paintOver(); if (nav) nav.update();
  }
  const used = () => siteIds(data().site);
  const newPathId = () => { const ids = new Set((data().paths || []).map(p => p.id)); let i = 1; while (ids.has('pa' + i)) i++; return 'pa' + i; };
  function finishDraft() {
    const dr = S.draft, f = floor(); if (!dr || !f) { S.draft = null; return; }
    const P = dr.pts; S.draft = null;
    if (dr.kind === 'wall' && P.length > 1) {
      const u = used(), ids = [];
      for (let i = 1; i < P.length; i++) if (dist(P[i - 1], P[i]) > 0.01) { const w = { id: uid('', 'w', u), a: P[i - 1], b: P[i], t: MATERIALS[S.wallMat].t, mat: S.wallMat }; f.walls.push(w); ids.push(w.id); }
      if (ids.length) { S.multi = ids.map(id => ({ kind: 'wall', id })); ctx.select({ kind: 'wall', id: ids[ids.length - 1] }); ctx.commit(); ctx.status(tl('{0} mur(s) dessiné(s).', ids.length), 'ok'); }
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
        if (got.length) ctx.status(tl('{0} objet(s) choisi(s).', got.length));
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
        const s = e.altKey ? 0.001 : snapStep(); moveGrab(drag.g, Math.round(dx / s) * s, Math.round(dy / s) * s); drag.moved = true; paintSoon();
      }
      return;
    }
    if (S.draft && S.draft.pts.length) {
      if (S.draft.done) return; // mesure terminée : elle reste affichée jusqu'au prochain clic
      S.draft.cur = snapPt(w, S.draft.pts[S.draft.pts.length - 1], e); paintOver();
    } else if (S.link) { S.link[1] = w; paintOver(); }
  });
  svg.addEventListener('pointerup', e => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.rect) {
      if (d.moved && S.rect) { const [a, b] = S.rect; S.rect = null; if (Math.abs(b[0] - a[0]) > 0.2 && Math.abs(b[1] - a[1]) > 0.2) { const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]); addRoom([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]); paint(); return; } paintOver(); return; }
      addPoint(toW(e.clientX, e.clientY), e); return;
    }
    if (d.moved) ctx.commit();
  });
  svg.addEventListener('contextmenu', e => { if (S.draft && S.draft.pts.length) { e.preventDefault(); finishDraft(); } });
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
    if (n) { ctx.commit(); ctx.status(tl('{0} objet(s) retiré(s) (Ctrl+Z pour annuler).', n), 'ok'); }
    if (racks) ctx.status(tl('{0} équipement(s) sorti(s) de la baie : ils restent dans le projet (vue Baies pour les ranger).', racks));
    paint();
  }
  function nudge(dx, dy) { const g = grab(); if (!g.length) return; moveGrab(g, dx, dy); ctx.commit(); }
  function selectAll() {
    const f = floor(), d = data(); if (!f) return;
    S.multi = [...d.devices.filter(x => x.loc && x.loc.floor === f.id).map(x => ({ kind: 'dev', id: x.id })), ...f.rooms.map(x => ({ kind: 'room', id: x.id })), ...f.walls.map(x => ({ kind: 'wall', id: x.id })), ...(d.paths || []).filter(x => x.floor === f.id).map(x => ({ kind: 'path', id: x.id }))];
    ctx.select(S.multi[0] || null); paint(); ctx.status(tl('{0} objet(s) choisi(s).', S.multi.length));
  }

  /* ---------- Étages, bâtiments, plan importé ---------- */
  /** Pièces fermées par les murs de l'étage, créées d'un coup (un seul Ctrl+Z). */
  function detectHere() {
    const f = floor(); if (!f) return;
    const made = addDetectedRooms(data(), f, S.usage);
    if (!made.length) { ctx.status(tl('Aucun espace fermé par les murs sans pièce : fermez les murs (bouts à moins de 15 cm) ou dessinez la pièce.'), 'warn'); return; }
    S.multi = made.map(r => ({ kind: 'room', id: r.id })); ctx.select(S.multi[0]); ctx.commit(); paint();
    ctx.status(tl('{0} pièce(s) détectée(s) : nommez-les et choisissez leur usage dans l’inspecteur.', made.length), 'ok');
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
      { label: tl('Importer un plan (image)'), icon: 'image', value: 'image' }
    ].filter(it => it === '-' || b || ['newBuilding', 'demo', 'image'].includes(it.value));
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
    if (t.dataset.plb != null) { const b = data().site.buildings.find(x => x.id === t.value); if (b && b.floors[0]) setFloor(b.floors[0].id, !S.seen.has(b.floors[0].id)); }
    if (t.dataset.plsub) { S[t.dataset.plsub] = t.value; paintTools(); }
  });
  el.querySelector('.ntPlEmpty').addEventListener('click', e => { const b = e.target.closest('[data-pla]'); if (b) action(b.dataset.pla, null); });
  async function toggleLayer(l) {
    S.layers[l] = !S.layers[l];
    if (l === 'wifi' && S.layers.wifi && !wifi) {
      try { const m = await import('./wifilayer.js'); wifi = m.createWifiLayer(ctx); if (wifi && wifi.onReady) wifi.onReady(() => { paintCanvas(); paintWifi(); ctx.renderPane(); }); }
      catch (e) { console.error(e); S.layers.wifi = false; ctx.status(tl('Le calque Wi-Fi n’a pas pu se charger.'), 'err'); }
    }
    paint();
    if (l === 'wifi') ctx.renderPane();
  }
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
      ctx.app.commands.register({ id: 'net.plan.wifi', cat: tl('Réseau'), icon: 'wifi', label: tl('Plans : afficher ou masquer le calque Wi-Fi'), when, run: () => toggleLayer('wifi') });
      ctx.app.commands.register({ id: 'net.plan.detect', cat: tl('Réseau'), icon: 'wand', label: tl('Plans : détecter les pièces fermées par les murs'), when: () => when() && !!floor(), run: () => detectHere() });
      ctx.app.commands.register({ id: 'net.plan.demo', cat: tl('Réseau'), icon: 'floorPlan', label: tl('Plans : ajouter un étage d’exemple'), when, run: () => action('demo') });
    } catch (e) { console.error(e); }
  }
  new ResizeObserver(() => { if (!el.hidden) { paintOver(); } }).observe(stage);

  /* ---------- Contrat des vues ---------- */
  const view = {
    el,
    show() { el.hidden = false; svg.dataset.tool = S.tool; nav.update(); if (!S.floor || !floorOf(data().site, S.floor)) { const f = floor(); if (f) { S.seen.add(f.id); requestAnimationFrame(fit); } } },
    hide() { el.hidden = true; calib.hidden = true; nav.update(); },
    render(why) {
      if (el.hidden) return;
      if (why === 'load') { S.multi = []; S.draft = null; S.seen.clear(); S.views.clear(); S.floor = null; }
      // La sélection partagée a pu changer ailleurs (annuler, autre vue) : la sélection multiple suit.
      const s = ctx.selection(); if (S.multi.length && (!s || !S.multi.some(m => m.kind === s.kind && m.id === s.id))) S.multi = s ? [s] : [];
      bad = issueIds(); const f = floor(); paint();
      if (f && !S.seen.has(f.id)) { S.seen.add(f.id); requestAnimationFrame(fit); }
    },
    key(e) {
      if (e.type !== 'keydown') return false;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod) { if (k === 'a') { selectAll(); return true; } return false; }
      if (!calib.hidden) return false;
      if (k === 'v' && !e.altKey) { setTool('select'); nav.setTool('select'); return true; }
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
  return view;
}
