// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vue « Baies » du plan réseau (chargée à la demande par workspace.js) : vue d'ensemble des baies (remplissage, puissance,
// chaleur, poids) et élévation d'une baie, faces avant et arrière (vue de derrière) à l'échelle (1 unité = 1 mm,
// 1U = 44,45 mm), comme une feuille de baie imprimée. On glisse les équipements depuis la bibliothèque ou la liste
// « Hors baie » dans les U libres (aimantés), on les déplace à la souris ou aux flèches, seuls ou à plusieurs (Maj ou
// Ctrl + clic, rectangle de sélection) ; collisions signalées pendant le geste ; menus contextuels, copier / coller /
// dupliquer (racks-actions.js). Panneau « Brassage » : cordons entre panneaux et switchs. Calculs : src/net/rack.js.
import './racks.css';
import { DEVICES, specOf } from '../devices.js';
import {
  MOUNT, U_MM, PANEL_MM, RACK_DESIGN, PANELS, newRack, removeRack, cleanRacks, rackIndex, rackSummary, racksSummary, facesOf, spanOf, canPlace,
  canPlaceGroup, findFree, unracked, patchingSchedule, freePorts
} from '../rack.js';
import { CODES as RACK_CODES } from '../checks/rack.js';
import { faceSvg, faceH, portSlots, backPortSlots, BACK_PORTS, pduStripSvg, EAR } from './racks-face.js';
import { rackPane, mechPane, placeFields, summaryPane } from './racks-pane.js';
import { createRackActions } from './racks-actions.js';
import { menuAt } from './kit/index.js';
import { revealLogical, revealOnPlan, onPlan } from './racks-nav.js';
import { cleanText } from '../../sanitize.js';

const FRAME = 60, GAP = 170, TOP = 84, FOOT = 64;
const r2 = v => Math.round(v * 10) / 10;
const MOD = e => e.ctrlKey || e.metaKey;

/** ctx : voir workspace.js (contrat des vues). Rend { el, show, hide, render, key, fit, reveal, pane, paneEvent, drop, multi, selectMany }. */
export function createRackView(ctx) {
  const { tl, icon, esc, isEn } = ctx;
  const tip = (label, keys) => esc(keys ? `${label} · ${keys}` : label);
  const el = document.createElement('div'); el.className = 'ntVw ntRk'; el.hidden = true;
  el.innerHTML = `
    <div class="ntRkBar" role="toolbar" aria-label="${tl('Baies')}">
      <div class="seg glass" role="group" aria-label="${tl('Affichage des baies')}">
        <button type="button" class="segBtn" data-rkmode="over" data-tip="${tip(tl('Vue d’ensemble'), 'O')}" aria-label="${tl('Vue d’ensemble')}">${icon('grid')}<span>${tl('Vue d’ensemble')}</span></button>
        <button type="button" class="segBtn" data-rkmode="elev" data-tip="${tip(tl('Élévation'), 'E')}" aria-label="${tl('Élévation')}">${icon('rack')}<span>${tl('Élévation')}</span></button>
      </div>
      <label class="glass ntRkPick"><span class="vh">${tl('Baie')}</span><select class="sel" data-rkpick aria-label="${tl('Baie affichée')}"></select></label>
      <div class="seg glass ntRkFaces" role="group" aria-label="${tl('Faces montrées')}">
        <button type="button" class="segBtn" data-rkfaces="front" data-tip="${tip(tl('Face avant'), '1')}">${tl('Face avant')}</button>
        <button type="button" class="segBtn" data-rkfaces="rear" data-tip="${tip(tl('Face arrière, vue de derrière'), '2')}">${tl('Face arrière')}</button>
        <button type="button" class="segBtn" data-rkfaces="both" data-tip="${tip(tl('Les deux faces côte à côte'), '3')}">${tl('Les deux')}</button>
      </div>
      <button type="button" class="btn small glass" data-rkaddmenu aria-haspopup="menu" data-tip="${tip(tl('Ajouter une baie au sol ou un coffret mural'))}">${icon('plus')}<span>${tl('Baie')}</span></button>
      <button type="button" class="btn small glass" data-rkpatch aria-pressed="false" data-tip="${tip(tl('Cordons entre panneaux et switchs : tableau et tracé'), 'B')}">${icon('cable')}<span>${tl('Brassage')}</span></button>
    </div>
    <div class="ntRkOver"></div>
    <div class="ntRkElev">
      <div class="ntRkCanvas"><svg class="ntRkSvg" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" role="img" aria-label="${tl('Élévation de la baie')}"><defs><filter id="ntRkLblBg" x="-0.06" y="-0.1" width="1.12" height="1.2"><feFlood class="ntRkLblFlood"/><feComposite in="SourceGraphic" operator="over"/></filter></defs><g class="ntRkWorld"></g><g class="ntRkGhostL"></g></svg><div class="ntRkHint" hidden></div></div>
      <div class="ntRkSum"></div>
      <div class="ntRkSel" hidden></div>
      <section class="ntRkPatch" hidden></section>
    </div>`;
  ctx.host.appendChild(el);
  const $ = s => el.querySelector(s);
  const over = $('.ntRkOver'), elev = $('.ntRkElev'), svg = $('.ntRkSvg'), world = $('.ntRkWorld'), ghostL = $('.ntRkGhostL'), canvas = $('.ntRkCanvas');
  const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } };
  let lastSel = '', mode = 'over', cur = null, patchOn = pref('jollof-net-rack-patch', '0') === '1', view = { x: 0, y: 0, k: 0.5 }, fitted = false, drag = null, band = null;
  let facesPref = pref('jollof-net-rack-faces', 'auto'), cardOpen = false; // carte de place dépliée (au-dessus de la barre du bas)
  /** Sélection multiple de la vue : clés 'dev:id' / 'rack:id' (la sélection simple partagée est la dernière). */
  let ms = [];

  const data = () => ctx.data(), lan = () => ctx.lan();
  const racks = () => data().racks || (data().racks = []);
  const rackById = id => racks().find(r => r.id === id) || null;
  const curRack = () => rackById(cur) || racks()[0] || null;
  const sel = () => ctx.selection();
  const findDev = id => data().devices.find(d => d.id === id) || null;
  const keyOf = x => x.kind + ':' + x.id;
  const isSel = (kind, id) => ms.includes(kind + ':' + id) || (() => { const s = sel(); return !!s && s.kind === kind && s.id === id; })();
  /** Sélection courante sous forme de liste (multiple, sinon la simple). */
  function selected() {
    const s = sel(), list = ms.map(k => { const i = k.indexOf(':'); return { kind: k.slice(0, i), id: k.slice(i + 1) }; });
    if (s && !ms.includes(keyOf(s))) return [s];
    return list.length ? list : s ? [s] : [];
  }
  /** Choisit une liste (un seul objet : la sélection simple ; plusieurs : la sélection multiple partagée). */
  function selectList(list) {
    list = list.filter(Boolean);
    ms = list.map(keyOf);
    if (list.length > 1 && ctx.selectMany) ctx.selectMany(list); else ctx.select(list[0] || null);
    render();
  }
  const rackIssues = r => {
    const ids = new Set([r.id, ...data().devices.filter(d => d.rack && d.rack.id === r.id).map(d => d.id)]);
    return ctx.issues().filter(i => ids.has(i.id) || (RACK_CODES[i.code] && i.id === r.id));
  };

  /* ---------- Géométrie de l'élévation (mm) ---------- */
  /** Faces montrées : choix de l'utilisateur, sinon les deux si la place le permet. */
  const facesShown = () => (facesPref !== 'auto' ? facesPref : canvas.getBoundingClientRect().width >= 720 ? 'both' : 'front');
  const faceList = () => { const f = facesShown(); return f === 'both' ? ['front', 'rear'] : [f]; };
  const faceX = (r, face) => (face === 'rear' && facesShown() === 'both' ? r.w + GAP : 0);
  const panelX = (r, face) => faceX(r, face) + (r.w - PANEL_MM) / 2;
  const yTop = (r, uTop) => TOP + FRAME + (r.u - uTop) * U_MM;
  const totalH = r => TOP + FRAME * 2 + r.u * U_MM;
  /** U sous un point du monde (y) et face (x). */
  function hit(r, wx, wy) {
    const both = facesShown() === 'both', face = both ? (wx > r.w + GAP / 2 ? 'rear' : 'front') : facesShown();
    return { face, u: r.u - Math.floor((wy - TOP - FRAME) / U_MM) };
  }
  const toWorld = (cx, cy) => { const b = svg.getBoundingClientRect(); return { x: view.x + (cx - b.left) / view.k, y: view.y + (cy - b.top) / view.k }; };
  /** Niveau de détail selon le zoom : en vue éloignée, les ports s'effacent et les noms grossissent pour rester lisibles. */
  function applyView() {
    const t = `translate(${-view.x * view.k} ${-view.y * view.k}) scale(${view.k})`;
    world.setAttribute('transform', t); ghostL.setAttribute('transform', t);
    svg.classList.toggle('lodLo', view.k < 0.26); svg.classList.toggle('lodMid', view.k >= 0.26 && view.k < 0.9);
    svg.style.setProperty('--rkf', Math.min(32, Math.max(7.5, 11 / view.k)) + 'px'); // noms : à peu près 10,5 px à l'écran
    svg.style.setProperty('--rku', Math.min(30, Math.max(11, 9.5 / view.k)) + 'px');
    svg.style.setProperty('--rkt', Math.max(24, 14 / view.k) + 'px'); svg.style.setProperty('--rkc', Math.max(15, 11 / view.k) + 'px');
    if (nav) nav.update();
  }

  /* ---------- Dessin de l'élévation ---------- */
  function cordsOf(r, devs) {
    const ids = new Set(devs.map(d => d.id)), out = [];
    for (const c of data().cables) if (ids.has(c.a[0]) && ids.has(c.b[0]) && c.a[0] !== c.b[0]) out.push(c);
    return out;
  }
  function portPos(r, d, pid) {
    const m = MOUNT[d.type]; if (!m || !m.u || !d.rack) return null;
    const own = d.rack.face === 'rear' ? 'rear' : 'front', faces = facesOf(d, r), h = faceH(m.u);
    if (m.shelf || specOf(d).role === 'mech') return null; // boîtier de bureau, équipement sans port
    // Serveur, NAS : cartes réseau à l'arrière, sur la face opposée à leur montage (dessin vu de derrière).
    const back = BACK_PORTS.has(d.type), face = back ? (own === 'front' ? 'rear' : 'front') : own;
    if (!faces.includes(face) || !faceList().includes(face)) return null;
    const slot = (back ? backPortSlots(d, h) : portSlots(d, h)).get(pid); if (!slot) return null;
    const x = panelX(r, face) + slot.x + slot.w / 2, y = yTop(r, d.rack.u + m.u - 1) + slot.y + slot.h / 2;
    return { x, y, face, h: slot.h };
  }
  function drawRack(r) {
    const idx = rackIndex(data()), devs = idx.get(r.id) || [], s = rackSummary(data(), r, lan(), idx), L = lan();
    const used = new Map(); for (const c of data().cables) { for (const e of [c.a, c.b]) { if (!used.has(e[0])) used.set(e[0], new Set()); used.get(e[0]).add(e[1]); } }
    const bad = new Set([...s.collisions.flatMap(c => [c.a, c.b]), ...s.outside, ...s.deep]);
    let g = '';
    for (const face of faceList()) {
      const x0 = faceX(r, face), px = panelX(r, face), H = totalH(r), rackSel = isSel('rack', r.id);
      g += `<g class="ntRkFace" data-rack="${esc(r.id)}" data-face="${face}">`;
      // Cartouche : nom de la baie et face (en haut), dimensions (en bas), comme une feuille de baie.
      g += `<text class="ntRkTitle" x="${x0}" y="${TOP - 34}"><tspan class="ntRkTitleN">${esc(r.name)}</tspan><tspan dx="10" class="ntRkTitleF">${face === 'front' ? tl('face avant') : tl('face arrière, vue de derrière')}</tspan></text>`;
      g += `<rect class="ntRkCab${rackSel ? ' isSel' : ''}" x="${x0}" y="${TOP}" width="${r.w}" height="${r2(H - TOP)}" rx="6"/>`;
      g += `<rect class="ntRkInner" x="${px - 4}" y="${TOP + FRAME - 4}" width="${PANEL_MM + 8}" height="${r2(r.u * U_MM + 8)}"/>`;
      for (let k = 1; k <= r.u; k++) {
        const y = yTop(r, k), cls = k % 5 === 0 || k === 1 || k === r.u ? 'ntRkU m5' : 'ntRkU';
        g += `<rect class="ntRkSlot" x="${px}" y="${r2(y)}" width="${PANEL_MM}" height="${U_MM}" data-u="${k}"/>`;
        g += `<text class="${cls}" x="${r2(px - 7)}" y="${r2(y + U_MM / 2)}">${k}</text><text class="${cls} r" x="${r2(px + PANEL_MM + 7)}" y="${r2(y + U_MM / 2)}">${k}</text>`;
      }
      g += `<rect class="ntRkRail" x="${px}" y="${TOP + FRAME}" width="${EAR}" height="${r2(r.u * U_MM)}"/><rect class="ntRkRail" x="${r2(px + PANEL_MM - EAR)}" y="${TOP + FRAME}" width="${EAR}" height="${r2(r.u * U_MM)}"/>`;
      g += `<text class="ntRkFoot" x="${x0}" y="${r2(H + 34)}">${esc(`${r.u} U · ${r.w} × ${r.d} mm · ${tl('{0} mm utiles', r.depth)} · ${r.kind === 'wall' ? tl('Coffret mural') : tl('Baie au sol')}`)}</text>`;
      g += '</g>';
      // Équipements.
      for (const d of devs) {
        const m = MOUNT[d.type]; if (!m || !m.u) continue;
        const faces = facesOf(d, r); if (!faces.includes(face)) continue;
        const own = (d.rack.face === 'rear' ? 'rear' : 'front') === face, h = faceH(m.u), y = yTop(r, d.rack.u + m.u - 1);
        if (spanOf(d)[0] < 1 && spanOf(d)[1] < 1) continue;
        const moving = drag && drag.moved && drag.ids.includes(d.id);
        const cls = `ntRkDev${isSel('dev', d.id) ? ' isSel' : ''}${bad.has(d.id) ? ' bad' : ''}${moving ? ' moving' : ''}`;
        g += `<g class="${cls}" data-dev="${esc(d.id)}" transform="translate(${r2(px)} ${r2(y + 0.4)})"><title>${esc(`${d.name} · ${DEVICES[d.type].name()} · U${d.rack.u}${m.u > 1 ? '–' + (d.rack.u + m.u - 1) : ''}`)}</title>${faceSvg(d, h, { lan: L, used: used.get(d.id), back: !own })}<rect class="ntRkHit" x="0" y="0" width="${PANEL_MM}" height="${r2(h)}"/></g>`;
      }
      // PDU verticales (0U), fixées à l'arrière : la première à gauche vu de devant, la deuxième à droite. Vue de
      // derrière (élévation arrière, retournée gauche-droite), la première est donc à droite.
      if (face === 'rear') {
        devs.filter(d => MOUNT[d.type] && MOUNT[d.type].pdu && !MOUNT[d.type].u).forEach((d, i) => {
          const leftFromFront = i % 2 === 0, len = Math.min(r.u * U_MM - 20, 1620), x = leftFromFront ? r2(px + PANEL_MM + 6) : r2(px - 58), y = TOP + FRAME + (r.u * U_MM - len) / 2;
          g += `<g class="ntRkDev ntRkZero${isSel('dev', d.id) ? ' isSel' : ''}" data-dev="${esc(d.id)}" transform="translate(${x} ${r2(y)})"><title>${esc(d.name)}</title>${pduStripSvg(d, len, MOUNT[d.type].pdu.outlets)}</g>`;
        });
      }
    }
    // Cordons de brassage, couleur par VLAN.
    if (patchOn) {
      const byId = new Map(devs.map(d => [d.id, d]));
      for (const c of cordsOf(r, devs)) {
        const a = portPos(r, byId.get(c.a[0]), c.a[1]), b = portPos(r, byId.get(c.b[0]), c.b[1]);
        if (!a || !b || a.face !== b.face) continue;
        const [p, q] = a.y <= b.y ? [a, b] : [b, a], sag = Math.max(18, Math.min(60, (q.y - p.y) / 2 + 14));
        const sw = [byId.get(c.a[0]), byId.get(c.b[0])].find(d => !PANELS.has(d.type)), port = sw === byId.get(c.a[0]) ? c.a[1] : c.b[1];
        const v = sw && sw.p && sw.p.ports && sw.p.ports[port] ? sw.p.ports[port].vlan ?? sw.p.ports[port].pvid : null;
        const vc = v != null && v !== '' ? ' v' + (Math.abs(+v || 0) % 8) : ' ' + c.cat;
        g += `<path class="ntRkCord${vc}${isSel('cable', c.id) ? ' isSel' : ''}" data-cable="${esc(c.id)}" d="M${r2(p.x)} ${r2(p.y + p.h / 2)} C${r2(p.x)} ${r2(p.y + sag)} ${r2(q.x)} ${r2(q.y - sag)} ${r2(q.x)} ${r2(q.y - q.h / 2)}"><title>${esc(`${ctx.nameOf(c.a[0])} · ${c.a[1]} ↔ ${ctx.nameOf(c.b[0])} · ${c.b[1]}${v != null ? ' · VLAN ' + v : ''}`)}</title></path>`;
      }
    }
    world.innerHTML = g;
    // Baie vide : une aide au centre.
    const hint = $('.ntRkHint'); hint.hidden = devs.length > 0;
    if (!devs.length) hint.innerHTML = `${icon('rack')}<b>${tl('{0} est vide', esc(r.name))}</b><span>${tl('Glissez des équipements de la bibliothèque ou de la liste « Hors baie » dans les U libres. Clic droit sur un U : poser, coller, obturer.')}</span>`;
    return s;
  }

  /* ---------- Vue d'ensemble ---------- */
  function drawOverview() {
    const sums = racksSummary(data(), lan()), iss = ctx.issues();
    const n = s => { const ids = new Set([s.id, ...s.devices.map(d => d.id)]); return iss.filter(i => ids.has(i.id)); };
    if (!sums.length) {
      over.innerHTML = `<div class="ntRkEmpty">${icon('rack')}<b>${tl('Aucune baie pour l’instant')}</b><p>${tl('Ajoutez une baie au sol ou un coffret mural, puis glissez-y les switchs, les panneaux de brassage, la PDU et l’onduleur.')}</p><div class="row"><button type="button" class="btn small primary" data-rkadd="floor">${icon('plus')}<span>${tl('Baie au sol')}</span></button><button type="button" class="btn small" data-rkadd="wall">${icon('plus')}<span>${tl('Coffret mural')}</span></button></div></div>`;
      return;
    }
    const f = v => (Math.round(v * 10) / 10).toLocaleString(isEn ? 'en-GB' : 'fr-FR');
    over.innerHTML = `<div class="ntRkCards">${sums.map(s => {
      const r = rackById(s.id), list = n(s), errs = list.filter(i => i.kind === 'err').length, pct = (s.usedU / s.u) * 100;
      const kgPct = (s.kg / r.load) * 100, heatPct = (s.heatW / r.heat) * 100, ups = s.ups[0];
      return `<button type="button" class="ntRkCard${isSel('rack', s.id) ? ' isSel' : ''}" data-rkopen="${esc(s.id)}" data-tip="${tip(tl('Ouvrir l’élévation · clic droit : actions'))}">
        <header>${icon('rack')}<b>${esc(s.name)}</b><small>${r.kind === 'wall' ? tl('Coffret mural') : tl('Baie au sol')} · ${s.u} U</small>${list.length ? `<span class="ntRkBadge ${errs ? 'err' : 'warn'}" title="${esc(tl('{0:# problème|# problèmes}', list.length))}">${list.length}</span>` : `<span class="ntRkBadge ok">${icon('check')}</span>`}</header>
        <div class="ntRkMini">${miniRack(r, s)}</div>
        <dl>
          <dt>${tl('Remplissage')}</dt><dd><div class="ntRkGauge"><i style="width:${pct}%"></i></div><span>${tl('{0} / {1} U', s.usedU, s.u)}</span></dd>
          <dt>${tl('Puissance consommée')}</dt><dd><span>${f(s.w)} W · ${f(s.va)} VA</span></dd>
          <dt>${tl('Chaleur')}</dt><dd><div class="ntRkGauge ${heatPct > 100 ? 'bad' : heatPct > 80 ? 'warn' : ''}"><i style="width:${Math.min(100, heatPct)}%"></i></div><span>${f(s.btu)} BTU/h</span></dd>
          <dt>${tl('Poids')}</dt><dd><div class="ntRkGauge ${kgPct > 100 ? 'bad' : kgPct > 80 ? 'warn' : ''}"><i style="width:${Math.min(100, kgPct)}%"></i></div><span>${f(s.kg)} / ${f(r.load)} kg</span></dd>
          <dt>${tl('Onduleur')}</dt><dd><span>${ups ? (ups.runtime === Infinity ? '—' : tl('{0} % · {1} min', Math.round(ups.pct), f(ups.runtime))) : tl('aucun')}</span></dd>
        </dl></button>`;
    }).join('')}<button type="button" class="ntRkCard ntRkAddCard" data-rkaddmenu aria-haspopup="menu">${icon('plus')}<span>${tl('Ajouter une baie')}</span></button></div>`;
  }
  /** Petite élévation de la carte : un trait par équipement. */
  function miniRack(r, s) {
    const H = 120, k = H / r.u;
    let g = `<svg viewBox="0 0 40 ${H}" preserveAspectRatio="none" aria-hidden="true"><rect class="ntRkMiniCab" x="0" y="0" width="40" height="${H}"/>`;
    for (const d of s.devices) if (d.h) g += `<rect class="ntRkMiniDev t-${MOUNT[d.type] && (MOUNT[d.type].ups || MOUNT[d.type].ebmOf) ? 'ups' : PANELS.has(d.type) ? 'patch' : specOf({ type: d.type }) && specOf({ type: d.type }).role === 'mech' ? 'mech' : 'net'}" x="3" y="${r2(H - (d.u + d.h - 1) * k)}" width="34" height="${r2(Math.max(1, d.h * k - 0.6))}"/>`;
    return g + '</svg>';
  }

  /* ---------- Liste « Hors baie », résumé, carte de sélection, brassage ---------- */
  /** Section « Hors baie » de la bibliothèque (workspace.js : libSections) : équipements du projet à ranger, à glisser dans un U. */
  function libSections(q) {
    const norm = v => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const list = unracked(data()).filter(d => !q || norm(`${d.name} ${DEVICES[d.type].name()} ${d.type}`).includes(q));
    if (!list.length) return '';
    return `<h3 class="ntRkLibH">${esc(tl('Hors baie'))}<span>${list.length}</span></h3><div class="ntGrid ntRkLibGrid">${list.map(d => `<button type="button" class="ntItem ntRkLoose${isSel('dev', d.id) ? ' isSel' : ''}" data-dev="${esc(d.id)}" data-t="${esc(d.type)}" title="${esc(tl('{0} : glisser dans un U, ou clic pour ranger dans la baie', DEVICES[d.type].name()))}">${icon(DEVICES[d.type].icon)}<span>${esc(d.name)}</span><small>${MOUNT[d.type].u ? MOUNT[d.type].u + 'U' : '0U'}</small></button>`).join('')}</div>`;
  }
  function drawSum(r, s) {
    const f = v => (Math.round(v * 10) / 10).toLocaleString(isEn ? 'en-GB' : 'fr-FR'), ups = s.ups[0];
    $('.ntRkSum').innerHTML = `<span data-tip="${tip(tl('Unités occupées'))}">${icon('rack')}${tl('{0} / {1} U', s.usedU, r.u)}</span><span data-tip="${tip(tl('Puissance consommée'))}">${icon('zap')}${f(s.w)} W</span><span data-tip="${tip(tl('Chaleur'))}">${icon('thermo')}${f(s.btu)} BTU/h</span><span data-tip="${tip(tl('Poids'))}">${icon('box')}${f(s.kg)} / ${f(r.load)} kg</span>${ups ? `<span class="${ups.pct > 100 || ups.runtime < r.runtime ? 'bad' : ''}" data-tip="${tip(tl('Onduleur'))}">${icon('battery')}${Math.round(ups.pct)} % · ${ups.runtime === Infinity ? '—' : tl('{0} min', f(ups.runtime))}</span>` : ''}${ms.length > 1 ? `<span class="ntRkMs">${tl('{0} choisis', ms.length)}</span>` : ''}${selChip()}`;
  }
  /** Équipement réseau choisi : une puce dans la barre du bas (sa place), qui déplie la carte de place au-dessus d'elle. */
  function selChip() {
    const s = sel(), d = s && s.kind === 'dev' && ms.length <= 1 ? findDev(s.id) : null;
    if (!d || !MOUNT[d.type] || specOf(d).role === 'mech') return '';
    const m = MOUNT[d.type], where = d.rack ? `U${d.rack.u}${m.u > 1 ? '–' + (d.rack.u + m.u - 1) : ''} · ${d.rack.face === 'rear' ? tl('à l’arrière') : tl('à l’avant')}` : tl('hors baie');
    return `<button type="button" class="ntRkChip" data-rksel="toggle" aria-expanded="${!!cardOpen}" data-tip="${tip(tl('Place dans la baie'))}">${icon(DEVICES[d.type].icon)}<b>${esc(d.name)}</b><span>${esc(where)}</span>${icon(cardOpen ? 'chevDown' : 'chevUp')}</button>`;
  }
  function drawSelCard() {
    const card = $('.ntRkSel'), s = sel(), d = s && s.kind === 'dev' && ms.length <= 1 ? findDev(s.id) : null;
    if (!d || !MOUNT[d.type] || specOf(d).role === 'mech') { card.hidden = true; return; }
    const m = MOUNT[d.type], open = !!cardOpen;
    const where = d.rack ? `U${d.rack.u}${m.u > 1 ? '–' + (d.rack.u + m.u - 1) : ''} · ${d.rack.face === 'rear' ? tl('à l’arrière') : tl('à l’avant')}` : tl('hors baie');
    card.hidden = !open; card.classList.toggle('open', open); if (!open) { card.innerHTML = ''; return; }
    card.innerHTML = `<header>${icon(DEVICES[d.type].icon)}<b>${esc(d.name)}</b><small>${esc(where)} · ${esc(m.ref)}</small><button type="button" class="tb" data-rksel="toggle" aria-expanded="true" aria-label="${tl('Replier')}" data-tip="${tip(tl('Replier'))}">${icon('chevDown')}</button><button type="button" class="tb" data-rksel="close" aria-label="${tl('Fermer')}" data-tip="${tip(tl('Fermer'), 'Esc')}">${icon('x')}</button></header>${open ? `${placeFields(ctx, d, data())}${d.rack ? `<button type="button" class="btn small subtle" data-rksel="unrack" data-tip="${tip(tl('Retirer de la baie'), tl('Suppr'))}">${icon('x')}<span>${tl('Retirer de la baie')}</span></button>` : ''}<p class="mut">${tl('Réglages réseau : onglet Réseau de l’inspecteur.')}</p>` : ''}`;
  }
  function drawPatch(r) {
    const box = $('.ntRkPatch'); box.hidden = !patchOn; if (!patchOn || !r) return;
    const rows = patchingSchedule(data(), lan(), { rack: r.id });
    const devs = data().devices.filter(d => d.rack && d.rack.id === r.id);
    const panels = devs.filter(d => PANELS.has(d.type)), actives = devs.filter(d => { const ro = (specOf(d) || {}).role; return ro && ro !== 'passive' && ro !== 'mech'; });
    const pOpts = panels.flatMap(p => freePorts(data(), p, 'front').filter(id => /^f\d+$/.test(id)).map(id => `<option value="${esc(p.id + '|' + id)}">${esc(p.name)} · ${esc(id.slice(1))}</option>`)).join('');
    const sOpts = actives.flatMap(a => freePorts(data(), a).map(id => `<option value="${esc(a.id + '|' + id)}">${esc(a.name)} · ${esc(id)}</option>`)).join('');
    const f = v => (v == null ? '—' : String(v).replace('.', isEn ? '.' : ','));
    const dock = !!(ctx.app.dock && ctx.app.dock.show);
    box.classList.toggle('slim', dock);
    if (dock) {
      // Barre fine : nouveau cordon panneau → switch ; le tableau complet est dans le panneau du bas (onglet Brassage).
      box.innerHTML = `<form class="ntRkPatchForm" data-rkform="patch"><b class="ntRkPatchT">${icon('cable')}<span>${tl('Brasser')}</span></b><select class="sel" name="a" aria-label="${tl('Port du panneau')}">${pOpts || `<option value="">${tl('aucun port libre')}</option>`}</select><span aria-hidden="true">→</span><select class="sel" name="b" aria-label="${tl('Port du switch')}">${sOpts || `<option value="">${tl('aucun port libre')}</option>`}</select><label class="ntRkLen"><input class="inp" name="len" type="number" min="0.1" max="10" step="0.1" value="${RACK_DESIGN.cord}" aria-label="${tl('Longueur du cordon (m)')}"><span>m</span></label><button class="btn small primary"${pOpts && sOpts ? '' : ' disabled'} data-tip="${tip(tl('Poser le cordon'))}">${icon('plus')}</button><button type="button" class="btn small subtle" data-rkdock data-tip="${tip(tl('Tableau de brassage (panneau du bas)'))}">${icon('list')}<span>${tl('{0:# port raccordé|# ports raccordés}', rows.length)}</span></button></form>`;
      return;
    }
    box.innerHTML = `<header><b>${icon('cable')}${tl('Brassage de {0}', esc(r.name))}</b><span class="mut">${tl('{0:# port raccordé|# ports raccordés}', rows.length)}</span><span class="mut ntRkTipTxt">${tl('Clic droit sur un port : brasser vers…')}</span></header>
      <form class="ntRkPatchForm" data-rkform="patch"><select class="sel" name="a" aria-label="${tl('Port du panneau')}">${pOpts || `<option value="">${tl('aucun port libre')}</option>`}</select><span aria-hidden="true">→</span><select class="sel" name="b" aria-label="${tl('Port du switch')}">${sOpts || `<option value="">${tl('aucun port libre')}</option>`}</select><label class="ntRkLen"><input class="inp" name="len" type="number" min="0.1" max="10" step="0.1" value="${RACK_DESIGN.cord}" aria-label="${tl('Longueur du cordon (m)')}"><span>m</span></label><button class="btn small primary"${pOpts && sOpts ? '' : ' disabled'}>${icon('plus')}<span>${tl('Brasser')}</span></button></form>
      <div class="ntRkPatchScroll"><table class="ntTable"><thead><tr><th>${tl('Repère')}</th><th>${tl('Prise')}</th><th class="c-perm">${tl('Lien permanent')}</th><th>${tl('Panneau')}</th><th>${tl('Switch')}</th><th>VLAN</th><th class="c-cord">${tl('Cordon')}</th><th>${tl('Lien')}</th><th></th></tr></thead><tbody>
      ${rows.map(x => `<tr${x.cableId ? ` data-rkcable="${esc(x.cableId)}"` : ''} class="${isSel('cable', x.cableId) ? 'isSel' : ''}"><td>${esc(x.label)}</td><td>${esc(x.outlet || '—')}</td><td class="c-perm">${x.permLen != null ? f(x.permLen) + ' m' : '—'}</td><td>${esc(x.panel)} · ${esc(x.port)}</td><td>${x.switch ? esc(x.switch) + ' · ' + esc(x.switchPort) : '—'}</td><td>${x.vlan ?? '—'}</td><td class="c-cord">${x.cordLen != null ? f(x.cordLen) + ' m' : '—'}</td><td>${x.up == null ? '—' : x.up ? `<i class="led g" title="${esc(tl('Lien établi'))}"></i>` : `<i class="led down" title="${esc(tl('Pas de lien'))}"></i>`}</td><td>${x.cableId ? `<button type="button" class="tb" data-rkuncord="${esc(x.cableId)}" aria-label="${tl('Retirer le cordon')}" data-tip="${tip(tl('Retirer le cordon'))}">${icon('x')}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="9" class="mut">${tl('Aucun panneau raccordé dans cette baie.')}</td></tr>`}</tbody></table></div>`;
  }
  function paintBar() {
    el.querySelectorAll('[data-rkmode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rkmode === mode)));
    const fs = facesShown();
    el.querySelectorAll('[data-rkfaces]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rkfaces === fs)));
    $('.ntRkFaces').hidden = mode !== 'elev' || !racks().length;
    const pick = $('[data-rkpick]'), r = curRack();
    pick.innerHTML = racks().map(x => `<option value="${esc(x.id)}"${r && x.id === r.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
    pick.disabled = !racks().length; $('.ntRkPick').hidden = !racks().length;
    $('[data-rkpatch]').setAttribute('aria-pressed', String(patchOn && racks().length > 0));
    const none = !racks().length; $('[data-rkpatch]').disabled = none; el.querySelector('[data-rkmode="elev"]').disabled = none;
    el.classList.toggle('patchOn', patchOn && mode === 'elev' && racks().length > 0);
  }
  let lastFaces = '';
  function render() {
    if (el.hidden) return;
    if (cur && !rackById(cur)) cur = null;
    if (!cur && racks().length) cur = racks()[0].id;
    if (!racks().length) mode = 'over';
    ms = ms.filter(k => { const i = k.indexOf(':'), kind = k.slice(0, i), id = k.slice(i + 1); return kind === 'dev' ? !!findDev(id) : kind === 'rack' ? !!rackById(id) : true; });
    paintBar();
    over.hidden = mode !== 'over'; elev.hidden = mode !== 'elev';
    if (mode === 'over') { drawOverview(); nav.update(); return; }
    if (facesShown() !== lastFaces) { lastFaces = facesShown(); fitted = false; }
    const r = curRack(), s = drawRack(r);
    drawSum(r, s); drawSelCard(); drawPatch(r);
    if (!fitted) { fitted = true; requestAnimationFrame(() => fit()); }
    applyView();
  }

  /* ---------- Navigation ---------- */
  function bounds() { const r = curRack(); return r ? { x0: -70, y0: 0, x1: (facesShown() === 'both' ? r.w * 2 + GAP : r.w) + 70, y1: totalH(r) + FOOT } : null; }
  function fitTo(b) {
    const R = canvas.getBoundingClientRect(); if (!b || !R.width) return;
    const W = R.width - 56 - 24, H = R.height - 24;
    view.k = Math.max(0.05, Math.min(6, Math.min(W / (b.x1 - b.x0), H / (b.y1 - b.y0))));
    view.x = b.x0 - (W / view.k - (b.x1 - b.x0)) / 2 - 12 / view.k; view.y = b.y0 - (H / view.k - (b.y1 - b.y0)) / 2 - 12 / view.k;
    applyView();
  }
  /**
   * Tout voir (F) : d'abord la baie à la largeur de la vue (noms lisibles ; si elle est plus haute que la vue, on la montre
   * par le haut, là où sont les panneaux, et on fait défiler : Page préc./suiv., main) ; F encore : la baie entière.
   */
  let fitWhole = false;
  function fit(toggle = false) {
    const b = bounds(), R = canvas.getBoundingClientRect(); if (!b || !R.width) return;
    const W = R.width - 56 - 24, H = R.height - 24, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    const kW = Math.min(W / bw, 1.6), kAll = Math.min(W / bw, H / bh);
    fitWhole = toggle ? !fitWhole : false;
    if (fitWhole || kW <= kAll * 1.02) { fitWhole = kW > kAll * 1.02 ? fitWhole : false; fitTo(b); return; }
    view.k = kW; view.x = b.x0 - (W / view.k - bw) / 2 - 12 / view.k; view.y = b.y0 - 12 / view.k;
    applyView();
  }
  /** Défilement vertical de l'élévation (fraction de la hauteur visible). */
  function scrollBy(f) { const R = canvas.getBoundingClientRect(); view.y += (R.height * f) / view.k; applyView(); }
  function zoomAt(f, x, y) {
    const R = canvas.getBoundingClientRect(), px = x ?? R.width / 2, py = y ?? R.height / 2, wx = view.x + px / view.k, wy = view.y + py / view.k;
    view.k = Math.max(0.05, Math.min(6, view.k * f)); view.x = wx - px / view.k; view.y = wy - py / view.k; applyView();
  }
  function selBox() {
    const r = curRack(); if (!r) return null;
    const list = selected(); if (!list.length) return null;
    if (list.some(x => x.kind === 'rack' && x.id === r.id)) return bounds();
    let b = null;
    for (const x of list) {
      const d = x.kind === 'dev' ? findDev(x.id) : null, m = d && MOUNT[d.type];
      if (!d || !m || !d.rack || d.rack.id !== r.id || !m.u) continue;
      const face = faceList().includes(d.rack.face) ? d.rack.face : faceList()[0], y = yTop(r, d.rack.u + m.u - 1), px = panelX(r, face);
      b = b ? { x0: Math.min(b.x0, px - 40), y0: Math.min(b.y0, y - 60), x1: Math.max(b.x1, px + PANEL_MM + 40), y1: Math.max(b.y1, y + m.u * U_MM + 60) } : { x0: px - 40, y0: y - 60, x1: px + PANEL_MM + 40, y1: y + m.u * U_MM + 60 };
    }
    return b;
  }
  const nav = ctx.createNavDock(elev, {
    active: () => ctx.isOn() && ctx.view() === 'racks' && mode === 'elev' && !el.hidden, target: () => svg, tools: () => ['select', 'pan', 'zoom'],
    zoomBy: (f, x, y) => zoomAt(f, x, y), panBy: (dx, dy) => { view.x -= dx / view.k; view.y -= dy / view.k; applyView(); },
    zoomPct: () => Math.round(view.k * 100 / 0.5), setZoomPct: p => zoomAt((p / 100) * 0.5 / view.k),
    fit: () => fit(true), fitSel: () => { const b = selBox(); if (!b) return false; fitTo(b); return true; }, hasSel: () => !!selBox(),
    zoomRect(r) { fitTo({ x0: view.x + r.x / view.k, y0: view.y + r.y / view.k, x1: view.x + (r.x + r.w) / view.k, y1: view.y + (r.y + r.h) / view.k }); return true; },
    mini: {
      data: () => {
        const r = curRack(), b = bounds(); if (!r || !b) return null; const R = canvas.getBoundingClientRect();
        const boxes = faceList().map(f => [faceX(r, f), TOP, r.w, totalH(r) - TOP, false]);
        for (const d of data().devices) { const m = MOUNT[d.type]; if (!d.rack || d.rack.id !== r.id || !m || !m.u) continue; for (const f of facesOf(d, r)) if (faceList().includes(f)) boxes.push([panelX(r, f), yTop(r, d.rack.u + m.u - 1), PANEL_MM, m.u * U_MM, isSel('dev', d.id)]); }
        return { bounds: [b.x0, b.y0, b.x1, b.y1], boxes, view: [view.x, view.y, view.x + R.width / view.k, view.y + R.height / view.k] };
      },
      centerOn: (x, y) => { const R = canvas.getBoundingClientRect(); view.x = x - R.width / 2 / view.k; view.y = y - R.height / 2 / view.k; applyView(); }
    },
    status: m => ctx.status(m), title: tl('Baies'),
    shortcuts: () => [
      ['Drag', tl('Glisser un équipement : le déplacer d’U en U (vers « Hors baie » : le retirer)')],
      ['Shift+Click|Mod+Click', tl('Ajouter ou ôter de la sélection')], ['Drag', tl('Dans le vide : rectangle de sélection')], ['Mod+A', tl('Tout sélectionner dans la baie')],
      ['↑|↓', tl('Monter, descendre d’un U (Maj : 5 U)')], ['←|→', tl('Monter à l’avant, à l’arrière')],
      ['Mod+C', tl('Copier')], ['Mod+V', tl('Coller')], ['Mod+D', tl('Dupliquer')],
      ['Del', tl('Retirer de la baie')], ['Shift+Del', tl('Supprimer du projet')], ['Shift+F10', tl('Menu de la sélection (aussi : clic droit)')],
      ['O|E', tl('Vue d’ensemble, élévation')], ['L', tl('Afficher dans la vue logique')], ['P', tl('Afficher sur le plan')], ['1|2|3', tl('Face avant, arrière, les deux')], ['F', tl('Ajuster à la largeur, puis la baie entière')], ['B', tl('Brassage')], ['PageUp|PageDown', tl('Faire défiler l’élévation')], ['Home|End', tl('Haut, bas de la baie')], ['Esc', tl('Annuler le geste, désélectionner')]
    ]
  });
  svg.addEventListener('wheel', e => { e.preventDefault(); const R = canvas.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - R.left, e.clientY - R.top); }, { passive: false });

  /* ---------- Actions (copier, coller, menus…) ---------- */
  const A = createRackActions(ctx, {
    data, curRack, rackById, findDev, selected, selectList, render,
    setCur: id => { cur = id; fitted = false; mode = 'elev'; }, fit,
    openElev: id => { cur = id; mode = 'elev'; fitted = false; selectList([{ kind: 'rack', id }]); },
    deleteRack: id => deleteRack(id)
  });

  /* ---------- Gestes : déplacer, poser, sélectionner ---------- */
  /** Place proposée pour d sous le pointeur (U du bas, face) et son verdict. */
  function proposal(r, d, ev, grab = 0) {
    const w = toWorld(ev.clientX, ev.clientY), m = MOUNT[d.type], h = hit(r, w.x, w.y - grab);
    const u = Math.max(1, Math.min(r.u - m.u + 1, h.u - m.u + 1));
    const right = facesShown() === 'both' ? r.w * 2 + GAP : r.w;
    const inside = w.x > -80 && w.x < right + 80 && w.y > 0 && w.y < totalH(r) + 40;
    return { u, face: h.face, inside, ok: inside && canPlace(data(), r, d, u, h.face) };
  }
  /** Fantôme du geste : chaque équipement à sa place proposée, vert si libre, rouge sinon (et l'occupant entouré). */
  function paintGhost(r, items, ok, label) {
    if (!items || !items.length) { ghostL.innerHTML = ''; return; }
    let g = '';
    for (const it of items) {
      const m = MOUNT[it.dev.type]; if (!m || !m.u) continue;
      for (const f of facesOf({ ...it.dev, rack: { id: r.id, u: it.u, face: it.face } }, r)) {
        if (!faceList().includes(f)) continue;
        g += `<rect class="ntRkGhost ${ok.ok ? 'ok' : 'bad'}" x="${r2(panelX(r, f))}" y="${r2(yTop(r, it.u + m.u - 1))}" width="${PANEL_MM}" height="${r2(m.u * U_MM)}" rx="2"/>`;
      }
    }
    if (!ok.ok && ok.with) {
      const o = findDev(ok.with), m = o && MOUNT[o.type];
      if (o && m && m.u && o.rack) for (const f of facesOf(o, r)) if (faceList().includes(f)) g += `<rect class="ntRkClash" x="${r2(panelX(r, f))}" y="${r2(yTop(r, o.rack.u + m.u - 1))}" width="${PANEL_MM}" height="${r2(m.u * U_MM)}" rx="2"/>`;
    }
    const a = items[0], ma = MOUNT[a.dev.type], af = faceList().includes(a.face) ? a.face : faceList()[0];
    g += `<g class="ntRkGhostT ${ok.ok ? 'ok' : 'bad'}" transform="translate(${r2(panelX(r, af) + PANEL_MM + 16)} ${r2(yTop(r, a.u + (ma.u || 1) - 1))})"><rect x="0" y="0" width="${Math.max(120, label.length * 9.5 + 20)}" height="30" rx="6"/><text x="10" y="20">${esc(label)}</text></g>`;
    ghostL.innerHTML = g;
  }
  const verdict = ok => (ok.ok ? '' : ok.why === 'clash' ? ' · ' + tl('occupé par {0}', ctx.nameOf(ok.with)) : ' · ' + tl('hors de la baie'));
  function placeAt(d, r, u, face) {
    d.rack = { ...(d.rack && d.rack.id === r.id ? d.rack : {}), id: r.id, u, face };
  }
  /** Le pointeur est-il sur la bibliothèque (lâcher un équipement de la baie dessus : le retirer de la baie) ? */
  const overSide = ev => { const L = document.querySelector('.panel.left.ntLib'); if (!L || !L.offsetParent) return false; const b = L.getBoundingClientRect(); return ev.clientX >= b.left && ev.clientX <= b.right && ev.clientY >= b.top && ev.clientY <= b.bottom; };
  svg.addEventListener('pointerdown', e => {
    if (e.button !== 0 || mode !== 'elev') return;
    const r = curRack(); if (!r) return;
    const cord = e.target.closest('[data-cable]');
    if (cord) { selectList([{ kind: 'cable', id: cord.dataset.cable }]); return; }
    const g = e.target.closest('[data-dev]');
    if (!g) {
      // Dans le vide : rectangle de sélection (sans geste : la baie ou rien).
      band = { sx: e.clientX, sy: e.clientY, moved: false, add: e.shiftKey || MOD(e), face: e.target.closest('[data-rack]') };
      follow(); return;
    }
    const d = findDev(g.dataset.dev); if (!d) return;
    const k = 'dev:' + d.id;
    if (e.shiftKey || MOD(e)) {
      const list = selected().filter(x => x.kind === 'dev'), has = list.some(x => x.id === d.id);
      selectList(has ? list.filter(x => x.id !== d.id) : [...list, { kind: 'dev', id: d.id }]); return;
    }
    if (!ms.includes(k) || ms.length < 2) selectList([{ kind: 'dev', id: d.id }]);
    const m = MOUNT[d.type]; if (!m || !m.u || !d.rack) return;
    const ids = selected().filter(x => x.kind === 'dev').map(x => x.id).filter(id => { const o = findDev(id); return o && o.rack && o.rack.id === r.id && MOUNT[o.type] && MOUNT[o.type].u; });
    const w = toWorld(e.clientX, e.clientY), grab = w.y - yTop(r, d.rack.u + m.u - 1) - (m.u * U_MM) / 2 + U_MM / 2;
    drag = { id: d.id, ids: ids.includes(d.id) ? ids : [d.id], sx: e.clientX, sy: e.clientY, moved: false, grab };
    follow();
  });
  const onMove = e => {
    if (band) {
      if (!band.moved && Math.hypot(e.clientX - band.sx, e.clientY - band.sy) < 5) return;
      band.moved = true;
      const a = toWorld(band.sx, band.sy), b = toWorld(e.clientX, e.clientY);
      band.box = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
      ghostL.innerHTML = `<rect class="ntRkBand" x="${r2(band.box.x0)}" y="${r2(band.box.y0)}" width="${r2(band.box.x1 - band.box.x0)}" height="${r2(band.box.y1 - band.box.y0)}"/>`;
      return;
    }
    if (!drag) return;
    const r = curRack(), d = findDev(drag.id); if (!r || !d) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
    if (!drag.moved) { drag.moved = true; svg.classList.add('dragging'); render(); }
    if (overSide(e)) { drag.p = { side: true }; ghostL.innerHTML = ''; ctx.status(tl('Lâcher ici : retirer de la baie.')); return; }
    const p = proposal(r, d, e, drag.grab), du = p.u - d.rack.u, single = drag.ids.length === 1;
    const items = drag.ids.map(id => { const o = findDev(id); return { dev: o, u: o.rack.u + du, face: single ? p.face : o.rack.face }; });
    const ok = p.inside ? canPlaceGroup(data(), r, items) : { ok: false, why: 'outside' };
    drag.p = { items, ok, inside: p.inside };
    const m = MOUNT[d.type];
    paintGhost(r, p.inside ? items : [], ok, `U${p.u}${m.u > 1 ? '–' + (p.u + m.u - 1) : ''}${single ? ' · ' + (p.face === 'rear' ? tl('à l’arrière') : tl('à l’avant')) : ' · ' + tl('{0} équipements', items.length)}${verdict(ok)}`);
  };
  const endDrag = e => {
    if (band) {
      const b = band; band = null; ghostL.innerHTML = '';
      const r = curRack(); if (!r) return;
      if (!b.moved) { if (!b.add) selectList(b.face ? [{ kind: 'rack', id: r.id }] : []); return; }
      const hitIds = [];
      for (const d of data().devices) {
        const m = MOUNT[d.type]; if (!d.rack || d.rack.id !== r.id || !m || !m.u) continue;
        for (const f of facesOf(d, r)) {
          if (!faceList().includes(f)) continue;
          const x0 = panelX(r, f), y0 = yTop(r, d.rack.u + m.u - 1), x1 = x0 + PANEL_MM, y1 = y0 + m.u * U_MM;
          if (x0 < b.box.x1 && x1 > b.box.x0 && y0 < b.box.y1 && y1 > b.box.y0) { hitIds.push(d.id); break; }
        }
      }
      const base = b.add ? selected().filter(x => x.kind === 'dev').map(x => x.id) : [];
      selectList([...new Set([...base, ...hitIds])].map(id => ({ kind: 'dev', id })));
      if (hitIds.length) ctx.status(tl('{0:# équipement sélectionné|# équipements sélectionnés}.', hitIds.length));
      return;
    }
    if (!drag) return;
    const r = curRack(), p = drag.p, moved = drag.moved, ids = drag.ids; drag = null; ghostL.innerHTML = ''; svg.classList.remove('dragging');
    if (!moved || !r || !p) { render(); return; }
    if (e.type === 'pointerup' && p.side) { A.unrack(ids.map(id => ({ kind: 'dev', id }))); return; }
    if (e.type === 'pointerup' && p.ok && p.ok.ok) {
      const changed = p.items.some(it => it.dev.rack.u !== it.u || it.dev.rack.face !== it.face);
      if (changed) {
        for (const it of p.items) { it.dev.rack.u = it.u; it.dev.rack.face = it.face; }
        ctx.commit();
        const a = p.items[0]; ctx.status(p.items.length === 1 ? tl('{0} en U{1} ({2}).', a.dev.name, a.u, a.face === 'rear' ? tl('à l’arrière') : tl('à l’avant')) : tl('{0} équipements déplacés.', p.items.length), 'ok');
      }
    } else if (p.inside) ctx.status(p.ok && p.ok.why === 'clash' ? tl('Place prise par {0}.', ctx.nameOf(p.ok.with)) : tl('Hors de la baie.'), 'warn');
    render();
  };
  /** Geste en cours (déplacer, encadrer) : suivi sur toute la fenêtre, même hors de l'élévation (vers la liste « Hors baie »). */
  function follow() {
    const up = e => { removeEventListener('pointermove', onMove, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true); endDrag(e); };
    addEventListener('pointermove', onMove, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
  }
  // Clic droit : menu de l'objet sous le pointeur (port, cordon, équipement, U libre, baie).
  svg.addEventListener('contextmenu', e => {
    if (mode !== 'elev') return;
    e.preventDefault();
    const r = curRack(); if (!r) return;
    const cord = e.target.closest('[data-cable]');
    if (cord) { selectList([{ kind: 'cable', id: cord.dataset.cable }]); return; }
    const g = e.target.closest('[data-dev]'), port = e.target.closest('[data-port]') || (g ? document.elementsFromPoint(e.clientX, e.clientY).find(x => x.dataset && x.dataset.port && g.contains(x)) : null);
    if (g) {
      const d = findDev(g.dataset.dev); if (!d) return;
      if (port && d.rack) { A.portMenu(e, d, port.dataset.port); return; }
      if (!ms.includes('dev:' + d.id)) selectList([{ kind: 'dev', id: d.id }]);
      A.devMenu(e, selected()); return;
    }
    const w = toWorld(e.clientX, e.clientY), h = hit(r, w.x, w.y);
    if (h.u >= 1 && h.u <= r.u && e.target.closest('[data-rack]')) {
      const px = panelX(r, h.face);
      if (w.x >= px && w.x <= px + PANEL_MM) { A.slotMenu(e, r, h.u, h.face); return; }
    }
    selectList([{ kind: 'rack', id: r.id }]); A.rackMenu(e, r);
  });

  // Glisser depuis la bibliothèque (type neuf ou équipement « Hors baie ») : la place proposée suit le pointeur.
  function dragOver(info, ev) {
    const r = curRack(); ghostL.innerHTML = '';
    if (!info || !ev || !r || mode !== 'elev' || !MOUNT[info.type] || !MOUNT[info.type].u) return;
    const d = info.dev ? findDev(info.dev) : { id: '\u0000new', type: info.type }; if (!d) return;
    const p = proposal(r, d, ev); if (!p.inside) return;
    const m = MOUNT[d.type]; paintGhost(r, [{ dev: d, u: p.u, face: p.face }], p.ok, `U${p.u}${m.u > 1 ? '–' + (p.u + m.u - 1) : ''}${verdict(p.ok)}`);
  }
  /** Équipement « Hors baie » lâché (ev) ou cliqué (null) : à sa place sous le pointeur, sinon le premier U libre. */
  function dropDev(id, ev) {
    const d = findDev(id), r = curRack(); if (!d || !MOUNT[d.type]) return;
    if (!r) { ctx.status(tl('Aucune baie'), 'warn'); return; }
    if (mode !== 'elev') { mode = 'elev'; fitted = false; }
    if (!ev || !MOUNT[d.type].u) { selectList([{ kind: 'dev', id }]); if (ev) { const R = canvas.getBoundingClientRect(); if (ev.clientX < R.left || ev.clientX > R.right) return; } quickPlace(d, r); return; }
    const p = proposal(r, d, ev);
    if (p.inside && p.ok.ok) { placeAt(d, r, p.u, p.face); selectList([{ kind: 'dev', id }]); ctx.commit(); }
    else if (p.inside) ctx.status(p.ok.why === 'clash' ? tl('Place prise par {0}.', ctx.nameOf(p.ok.with)) : tl('Hors de la baie.'), 'warn');
  }
  over.addEventListener('contextmenu', e => { const c = e.target.closest('[data-rkopen]'); if (!c) return; e.preventDefault(); const r = rackById(c.dataset.rkopen); if (r) { selectList([{ kind: 'rack', id: r.id }]); A.rackMenu(e, r, { card: true }); } });
  function quickPlace(d, r, near) {
    const m = MOUNT[d.type], face = m.u ? 'front' : 'rear', u = findFree(data(), r, d, face, near ?? 1);
    if (!u) { ctx.status(tl('Plus de place de {0} U libre dans {1}.', m.u, r.name), 'warn'); return false; }
    placeAt(d, r, u, face); ctx.commit(); ctx.status(tl('{0} en U{1} de {2}.', d.name, u, r.name), 'ok'); return true;
  }

  /* ---------- Barre, cartes, brassage ---------- */
  function addRack(kind, commit = true) {
    const r = newRack(data(), kind); racks().push(r); cur = r.id; mode = 'elev'; fitted = false;
    if (!commit) return r;
    ms = []; ctx.select({ kind: 'rack', id: r.id }); ctx.commit(); ctx.status(tl('{0} ajoutée : glissez-y les équipements.', r.name), 'ok');
    return r;
  }
  function openElev(id) { cur = id; mode = 'elev'; fitted = false; selectList([{ kind: 'rack', id }]); }
  function addMenu(anchor) {
    menuAt(anchor, [
      { label: tl('Baie au sol 42U, 600 × 1000 mm (modifiable)'), icon: 'rack', run: () => addRack('floor') },
      { label: tl('Coffret mural 12U, 450 mm de profondeur (modifiable)'), icon: 'rack', run: () => addRack('wall') }
    ]);
  }
  const setMode = m => { if (m === mode || (m === 'elev' && !racks().length)) return; mode = m; if (mode === 'elev') fitted = false; render(); ctx.renderPane(); };
  const setFaces = f => { facesPref = f; setPref('jollof-net-rack-faces', f); fitted = false; render(); };
  const togglePatch = () => {
    if (!racks().length) return;
    patchOn = !patchOn; setPref('jollof-net-rack-patch', patchOn ? '1' : '0'); if (patchOn && mode === 'over') mode = 'elev';
    // Le tableau de brassage est dans le panneau du bas (onglet Brassage) : la baie garde toute la place.
    if (patchOn && ctx.app.dock && ctx.app.dock.show) { try { ctx.app.dock.show('netPatch'); } catch (e) { console.error(e); } }
    fitted = false; render();
  };
  el.addEventListener('click', e => {
    const t = e.target;
    const m = t.closest('[data-rkmode]'); if (m) { setMode(m.dataset.rkmode); return; }
    const fb = t.closest('[data-rkfaces]'); if (fb) { setFaces(fb.dataset.rkfaces); return; }
    const am = t.closest('[data-rkaddmenu]'); if (am) { addMenu(am); return; }
    const a = t.closest('[data-rkadd]'); if (a) { addRack(a.dataset.rkadd); return; }
    if (t.closest('[data-rkpatch]')) { togglePatch(); return; }
    if (t.closest('[data-rkdock]')) { try { ctx.app.dock.show('netPatch'); } catch (e) { console.error(e); } return; }
    const o = t.closest('[data-rkopen]'); if (o) { openElev(o.dataset.rkopen); return; }
    const un = t.closest('[data-rkuncord]'); if (un) { const id = un.dataset.rkuncord; data().cables = data().cables.filter(c => c.id !== id); ctx.commit(); return; }
    const row = t.closest('[data-rkcable]'); if (row) { selectList([{ kind: 'cable', id: row.dataset.rkcable }]); return; }
    if (t.closest('[data-rksel="unrack"]')) { const d = findDev(sel().id); if (d) { delete d.rack; ctx.commit(); } return; }
    if (t.closest('[data-rksel="close"]')) { selectList([]); return; }
    if (t.closest('[data-rksel="toggle"]')) { cardOpen = !cardOpen; render(); }
  });
  el.addEventListener('keydown', e => { const c = e.target.closest && e.target.closest('[data-rkopen]'); if (c && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); openElev(c.dataset.rkopen); } });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-rkpick]')) { cur = t.value; fitted = false; ms = []; render(); return; }
    if (t.closest('.ntRkSel') && t.dataset.rkd) { const s = sel(); const d = s && findDev(s.id); if (d) setDevField(d, t.dataset.rkd, t.value); }
  });
  el.addEventListener('submit', e => {
    const f = e.target.closest('[data-rkform="patch"]'); if (!f) return;
    e.preventDefault();
    const a = f.elements.a.value.split('|'), b = f.elements.b.value.split('|'); if (a.length < 2 || b.length < 2) return;
    const len = Math.max(0.1, Math.min(10, +f.elements.len.value || RACK_DESIGN.cord));
    ctx.addCable(a, b, { kind: 'straight', len }); ctx.commit();
    ctx.status(tl('Cordon de {0} m : {1} → {2}.', len, ctx.nameOf(a[0]) + ' · ' + a[1].slice(1), ctx.nameOf(b[0]) + ' · ' + b[1]), 'ok');
  });

  /* ---------- Champs (inspecteur et carte) ---------- */
  function setDevField(d, k, v) {
    if (k === 'name') { d.name = cleanText(String(v), 24) || d.name; ctx.commit(); return; }
    if (k === 'rack') {
      if (!v) { delete d.rack; ctx.commit(); return; }
      const r = rackById(v); if (!r) return;
      const m = MOUNT[d.type], face = d.rack ? d.rack.face : (m.u ? 'front' : 'rear'), u = findFree(data(), r, d, face);
      if (!u) { ctx.status(tl('Plus de place de {0} U libre dans {1}.', m.u, r.name), 'warn'); ctx.renderPane(); return; }
      d.rack = { id: r.id, u, face }; cur = r.id; ctx.commit(); return;
    }
    if (!d.rack) return;
    const r = rackById(d.rack.id); if (!r) return;
    if (k === 'u' || k === 'face') {
      const u = k === 'u' ? Math.round(+v || 1) : d.rack.u, face = k === 'face' ? (v === 'rear' ? 'rear' : 'front') : d.rack.face, ok = canPlace(data(), r, d, u, face);
      if (!ok.ok) { ctx.status(ok.why === 'clash' ? tl('Place prise par {0}.', ctx.nameOf(ok.with)) : tl('Hors de la baie.'), 'warn'); render(); ctx.renderPane(); return; }
      d.rack.u = u; d.rack.face = face; ctx.commit(); return;
    }
    if (k === 'w') { if (v === '' || v == null) delete d.rack.w; else d.rack.w = Math.max(0, Math.min(20000, +v || 0)); ctx.commit(); return; }
    if (k === 'pdu') { if (v) d.rack.pdu = v; else delete d.rack.pdu; ctx.commit(); }
  }
  function setRackField(r, k, v) {
    const raw = { ...r };
    if (k === 'kind') { raw.kind = v; }
    else if (['u', 'w', 'd', 'depth', 'load', 'heat', 'runtime', 'pf', 'volts'].includes(k)) raw[k] = +v;
    else raw[k] = v;
    if (k === 'd' && raw.depth > raw.d) raw.depth = raw.d;
    const c = cleanRacks([raw])[0]; c.id = r.id;
    if (['u', 'w', 'kind'].includes(k)) fitted = false; // nouvelle taille : l'élévation se recadre
    Object.assign(r, c); ctx.commit();
  }
  /** Menu de la sélection au clavier (Maj+F10, touche Menu) : sous l'objet choisi. */
  function keyMenu() {
    const list = selected(), r = curRack(); if (!r) return false;
    const R = canvas.getBoundingClientRect(), b = selBox(), at = b ? { x: R.left + (b.x1 - view.x) * view.k - 40, y: R.top + (b.y0 - view.y) * view.k + 40 } : { x: R.left + 80, y: R.top + 80 };
    if (list.some(x => x.kind === 'dev')) A.devMenu(at, list); else A.rackMenu(at, r);
    return true;
  }

  /* ---------- Contrat des vues ---------- */
  const api = {
    el,
    show() { el.hidden = false; nav.reset(); },
    hide() { el.hidden = true; drag = null; band = null; ghostL.innerHTML = ''; nav.update(); },
    render() { try { render(); } catch (e) { console.error(e); } },
    key(e) {
      if (e.type === 'keydown' && nav.key(e)) return true;
      const k = e.key, lk = k.toLowerCase(), s = sel(), mod = MOD(e);
      if (k === 'Escape') { if (drag || band) { drag = null; band = null; ghostL.innerHTML = ''; svg.classList.remove('dragging'); render(); return true; } if (s || ms.length) { selectList([]); return true; } return false; }
      if (mod && !e.altKey) {
        if (lk === 'c') return A.copy();
        if (lk === 'v') return A.paste();
        if (lk === 'd') return A.duplicate();
        if (lk === 'a' && mode === 'elev') { const r = curRack(); if (r) selectList(data().devices.filter(d => d.rack && d.rack.id === r.id).map(d => ({ kind: 'dev', id: d.id }))); return true; }
        return false;
      }
      if (e.altKey) return false;
      if (lk === 'o') { setMode('over'); return true; }
      if (lk === 'e') { setMode('elev'); return true; }
      if (lk === 'b') { togglePatch(); return true; }
      if (lk === 'l' || lk === 'p') {
        // L : nœud du schéma logique ; P : place sur le plan d'étage (équipement ou baie choisis).
        const one = selected().length === 1 ? selected()[0] : null; if (!one || !['dev', 'rack'].includes(one.kind)) return false;
        if (lk === 'l') { if (one.kind === 'dev' && specOf(findDev(one.id) || {}) && specOf(findDev(one.id)).role !== 'mech') revealLogical(ctx, one.id); return true; }
        if (onPlan(data(), one.id)) revealOnPlan(ctx, one.id); else ctx.status(tl('Pas encore de place sur un plan d’étage : placez-le dans la vue Plans.'), 'warn');
        return true;
      }
      if (mode === 'elev' && ['1', '2', '3'].includes(k)) { setFaces({ 1: 'front', 2: 'rear', 3: 'both' }[k]); return true; }
      if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) return keyMenu();
      if (mode === 'elev' && (k === 'PageDown' || k === 'PageUp')) { scrollBy(k === 'PageDown' ? 0.8 : -0.8); return true; }
      if (mode === 'elev' && (k === 'Home' || k === 'End')) { const r = curRack(); if (r) { const R = canvas.getBoundingClientRect(); view.y = k === 'Home' ? -12 / view.k : totalH(r) + FOOT - (R.height - 60) / view.k; applyView(); } return true; }
      if (mode !== 'elev') return false;
      const list = selected(), devs = list.filter(x => x.kind === 'dev');
      if (devs.length && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
        const step = e.shiftKey ? 5 : 1;
        if (k === 'ArrowUp') A.move(devs, step); else if (k === 'ArrowDown') A.move(devs, -step); else A.move(devs, 0, k === 'ArrowLeft' ? 'front' : 'rear');
        return true;
      }
      if (k === 'Delete' || k === 'Backspace') {
        if (devs.length) { if (e.shiftKey) A.remove(devs); else A.unrack(devs); return true; }
        if (s && s.kind === 'rack') { deleteRack(s.id); return true; }
        if (s && s.kind === 'cable' && data().cables.some(c => c.id === s.id)) { data().cables = data().cables.filter(c => c.id !== s.id); ctx.select(null); ctx.commit(); return true; }
      }
      return false;
    },
    keyup(e) { nav.key(e); },
    fit() { fit(); },
    /** Bibliothèque en vue Baies : seulement ce qui se monte en baie, et la section « Hors baie » (équipements à ranger). */
    libFilter: t => !!MOUNT[t], libSections, dragOver, dropDev,
    libMenu(ev, id) { const d = findDev(id); if (d) A.looseMenu(ev, d); },
    /** Sélection multiple de la vue (navigateur du projet, recherche) : [{ kind, id }…]. */
    multi() { return selected(); },
    selectMany(list) {
      ms = (list || []).filter(x => x && (x.kind === 'dev' || x.kind === 'rack' || x.kind === 'cable')).map(keyOf);
      const d = (list || []).map(x => x.kind === 'dev' ? findDev(x.id) : null).find(x => x && x.rack && rackById(x.rack.id));
      const r = (list || []).map(x => x.kind === 'rack' ? rackById(x.id) : null).find(Boolean);
      const target = d ? d.rack.id : r ? r.id : null;
      if (target && target !== cur) { cur = target; fitted = false; }
      if (target && mode !== 'elev') { mode = 'elev'; fitted = false; }
      render();
    },
    reveal(id) {
      const r = rackById(id);
      if (r) { cur = r.id; mode = 'elev'; fitted = true; ms = []; ctx.select({ kind: 'rack', id }); render(); fit(); return true; }
      const d = findDev(id); if (!d || !MOUNT[d.type] && specOf(d).role !== 'mech') return false;
      ms = [];
      if (d.rack && rackById(d.rack.id)) { cur = d.rack.id; mode = 'elev'; ctx.select({ kind: 'dev', id }); render(); const b = selBox(); if (b) fitTo(b); else fit(); return true; }
      mode = racks().length ? 'elev' : 'over'; ctx.select({ kind: 'dev', id }); render(); return true;
    },
    pane(s) {
      // La sélection change (clic dans une autre vue, le panneau Problèmes, l'IA) : l'élévation suit.
      const key = s ? s.kind + ':' + s.id : '';
      if (key !== lastSel) { lastSel = key; if (s && !ms.includes(key)) ms = []; if (!el.hidden) requestAnimationFrame(() => render()); }
      const idx = rackIndex(data());
      if (s && s.kind === 'rack') { const r = rackById(s.id); if (!r) return null; return rackPane(ctx, r, rackSummary(data(), r, lan(), idx), rackIssues(r)); }
      if (s && s.kind === 'dev') {
        const d = findDev(s.id); if (!d || specOf(d).role !== 'mech') return null;
        const r = d.rack && rackById(d.rack.id);
        return mechPane(ctx, d, r ? rackSummary(data(), r, lan(), idx) : null);
      }
      if (s) return null;
      const iss = ctx.issues().filter(i => RACK_CODES[i.code]);
      return summaryPane(ctx, racksSummary(data(), lan()), iss);
    },
    paneEvent(e, s) {
      const t = e.target;
      if (e.type === 'click') {
        const iss = t.closest('[data-rkiss]'); if (iss) { if (iss.dataset.rkiss) ctx.reveal(iss.dataset.rkiss); return true; }
        const go = t.closest('[data-rkgo]'); if (go) { api.reveal(go.dataset.rkgo); return true; }
        const a = t.closest('[data-rka]');
        if (a && a.dataset.rka === 'delrack' && s && s.kind === 'rack') { deleteRack(s.id); return true; }
        if (a && a.dataset.rka === 'deldev' && s && s.kind === 'dev') { A.remove([s]); return true; }
        return !!t.closest('[data-rkf], [data-rkd]');
      }
      if (e.type === 'change') {
        if (t.dataset.rkf && s && s.kind === 'rack') { const r = rackById(s.id); if (r) setRackField(r, t.dataset.rkf, t.value); return true; }
        if (t.dataset.rkd && s && s.kind === 'dev') { const d = findDev(s.id); if (d) setDevField(d, t.dataset.rkd, t.value); return true; }
      }
      if (e.type === 'input' && (t.dataset.rkf || t.dataset.rkd)) return true;
      return false;
    },
    drop(type, ev) {
      const m = MOUNT[type];
      if (!m) { ctx.status(tl('{0} ne se monte pas dans une baie : posez-le dans la vue logique ou sur un plan.', DEVICES[type].name()), 'warn'); return; }
      let r = curRack(); if (!r) r = addRack('floor', false); // première baie créée avec l'équipement (un seul geste à annuler)
      const n = data().devices.length, d = ctx.newDevice(type, { x: 40 + (n % 12) * 60, y: 600 + Math.floor(n / 12) * 80 });
      if (mode !== 'elev') { mode = 'elev'; fitted = false; }
      let placed = false;
      if (ev && m.u) {
        const p = proposal(r, d, ev);
        if (p.inside && p.ok.ok) { placeAt(d, r, p.u, p.face); placed = true; }
        else if (p.inside) { const u = findFree(data(), r, d, p.face, p.u); if (u) { placeAt(d, r, u, p.face); placed = true; } }
      }
      if (!placed) { const face = m.u ? 'front' : 'rear', u = findFree(data(), r, d, face); if (u) { placeAt(d, r, u, face); placed = true; } }
      ms = []; ctx.select({ kind: 'dev', id: d.id }); ctx.commit();
      ctx.status(placed ? tl('{0} posé dans {1}, U{2}.', d.name, r.name, d.rack.u) : tl('{0} ajouté hors baie : {1} est pleine.', d.name, r.name), placed ? 'ok' : 'warn');
    }
  };
  function deleteRack(id) {
    const r = removeRack(data(), id).rack; if (!r) return;
    if (cur === id) cur = null;
    ms = []; ctx.select(null); ctx.commit(); ctx.status(tl('{0} supprimée : ses équipements restent dans le projet, hors baie.', r.name));
  }
  // Palette de commandes.
  if (ctx.app && ctx.app.commands) {
    const when = () => ctx.isOn();
    ctx.app.commands.register({ id: 'net.rack.addFloor', cat: tl('Réseau'), icon: 'rack', label: tl('Baies : ajouter une baie au sol'), when, run: () => ctx.openView('racks').then(() => addRack('floor')) });
    ctx.app.commands.register({ id: 'net.rack.addWall', cat: tl('Réseau'), icon: 'rack', label: tl('Baies : ajouter un coffret mural'), when, run: () => ctx.openView('racks').then(() => addRack('wall')) });
    ctx.app.commands.register({ id: 'net.rack.patch', cat: tl('Réseau'), icon: 'cable', label: tl('Baies : afficher le brassage'), keys: 'B', when, run: () => ctx.openView('racks').then(() => { patchOn = true; setPref('jollof-net-rack-patch', '1'); if (racks().length) mode = 'elev'; render(); }) });
    ctx.app.commands.register({ id: 'net.rack.blanks', cat: tl('Réseau'), icon: 'blankPanel', label: tl('Baies : obturer tous les U libres'), when: () => ctx.isOn() && !!curRack(), run: () => ctx.openView('racks').then(() => { const r = curRack(); if (r) A.fillBlanks(r); }) });
    ctx.app.commands.register({ id: 'net.rack.managers', cat: tl('Réseau'), icon: 'cableMgr', label: tl('Baies : ajouter les passe-câbles manquants'), when: () => ctx.isOn() && !!curRack(), run: () => ctx.openView('racks').then(() => { const r = curRack(); if (r) A.addManagers(r); }) });
  }
  if (racks().length) mode = 'elev';
  return api;
}
