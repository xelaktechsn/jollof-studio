// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vue « Baies » du plan réseau (chargée à la demande par workspace.js) : vue d'ensemble des baies (remplissage, puissance,
// chaleur, poids) et élévation d'une baie, faces avant et arrière côte à côte, à l'échelle (1 unité = 1 mm, 1U = 44,45 mm).
// On glisse les équipements depuis la bibliothèque ou la liste « Hors baie » dans les U libres (aimantés), on les déplace
// à la souris ou aux flèches ; collisions signalées pendant le geste. Panneau « Brassage » : cordons entre panneaux et
// switchs (tracés dans l'élévation et listés), nouveau cordon panneau → switch. Calculs : src/net/rack.js.
import './racks.css';
import { DEVICES, specOf } from '../devices.js';
import {
  MOUNT, U_MM, PANEL_MM, RACK_DESIGN, PANELS, newRack, removeRack, cleanRacks, rackIndex, rackSummary, racksSummary, facesOf, spanOf, canPlace,
  findFree, unracked, patchingSchedule, freePorts
} from '../rack.js';
import { CODES as RACK_CODES } from '../checks/rack.js';
import { faceSvg, faceH, portSlots, backPortSlots, BACK_PORTS, pduStripSvg, EAR } from './racks-face.js';
import { rackPane, mechPane, placeFields, summaryPane } from './racks-pane.js';
import { cleanText } from '../../sanitize.js';

const FRAME = 60, GAP = 170, TOP = 70;
const r2 = v => Math.round(v * 10) / 10;

/** ctx : voir workspace.js (contrat des vues). Rend { el, show, hide, render, key, fit, reveal, pane, paneEvent, drop }. */
export function createRackView(ctx) {
  const { tl, icon, esc, isEn } = ctx;
  const el = document.createElement('div'); el.className = 'ntVw ntRk'; el.hidden = true;
  el.innerHTML = `
    <div class="ntRkBar">
      <div class="seg glass" role="group" aria-label="${tl('Affichage des baies')}">
        <button type="button" class="segBtn" data-rkmode="over">${icon('grid')}<span>${tl('Vue d’ensemble')}</span></button>
        <button type="button" class="segBtn" data-rkmode="elev">${icon('rack')}<span>${tl('Élévation')}</span></button>
      </div>
      <label class="glass ntRkPick"><span class="vh">${tl('Baie')}</span><select class="sel" data-rkpick aria-label="${tl('Baie affichée')}"></select></label>
      <button type="button" class="btn small glass" data-rkadd="floor" data-tip="${tl('Baie au sol 42U, 600 × 1000 mm (modifiable)')}">${icon('plus')}<span>${tl('Baie au sol')}</span></button>
      <button type="button" class="btn small glass" data-rkadd="wall" data-tip="${tl('Coffret mural 12U, 450 mm de profondeur (modifiable)')}">${icon('plus')}<span>${tl('Coffret mural')}</span></button>
      <button type="button" class="btn small glass" data-rkpatch aria-pressed="false" data-tip="${tl('Cordons entre panneaux et switchs : tableau et tracé')}">${icon('cable')}<span>${tl('Brassage')}</span></button>
    </div>
    <div class="ntRkOver"></div>
    <div class="ntRkElev">
      <aside class="ntRkSide" aria-label="${tl('Équipements hors baie')}"><h4>${tl('Hors baie')}</h4><div class="ntRkList"></div></aside>
      <div class="ntRkCanvas"><svg class="ntRkSvg" xmlns="http://www.w3.org/2000/svg"><g class="ntRkWorld"></g><g class="ntRkGhostL"></g></svg></div>
      <div class="ntRkSum"></div>
      <div class="ntRkSel" hidden></div>
      <section class="ntRkPatch" hidden></section>
    </div>`;
  ctx.host.appendChild(el);
  const $ = s => el.querySelector(s);
  const over = $('.ntRkOver'), elev = $('.ntRkElev'), svg = $('.ntRkSvg'), world = $('.ntRkWorld'), ghostL = $('.ntRkGhostL'), canvas = $('.ntRkCanvas');
  const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } };
  let lastSel = '', mode = 'over', cur = null, patchOn = pref('jollof-net-rack-patch', '0') === '1', view = { x: 0, y: 0, k: 0.5 }, fitted = false, drag = null;

  const data = () => ctx.data(), lan = () => ctx.lan();
  const racks = () => data().racks || (data().racks = []);
  const rackById = id => racks().find(r => r.id === id) || null;
  const curRack = () => rackById(cur) || racks()[0] || null;
  const sel = () => ctx.selection();
  const findDev = id => data().devices.find(d => d.id === id) || null;
  const rackIssues = r => {
    const ids = new Set([r.id, ...data().devices.filter(d => d.rack && d.rack.id === r.id).map(d => d.id)]);
    return ctx.issues().filter(i => ids.has(i.id) || (RACK_CODES[i.code] && i.id === r.id));
  };

  /* ---------- Géométrie de l'élévation (mm) ---------- */
  const faceX = (r, face) => (face === 'rear' ? r.w + GAP : 0);
  const panelX = (r, face) => faceX(r, face) + (r.w - PANEL_MM) / 2;
  const yTop = (r, uTop) => TOP + FRAME + (r.u - uTop) * U_MM;
  const totalH = r => TOP + FRAME * 2 + r.u * U_MM;
  /** U sous un point du monde (y) et face (x). */
  function hit(r, wx, wy) {
    const face = wx > r.w + GAP / 2 ? 'rear' : 'front';
    const u = r.u - Math.floor((wy - TOP - FRAME) / U_MM);
    return { face, u };
  }
  const toWorld = (cx, cy) => { const b = svg.getBoundingClientRect(); return { x: view.x + (cx - b.left) / view.k, y: view.y + (cy - b.top) / view.k }; };
  const applyView = () => { world.setAttribute('transform', `translate(${-view.x * view.k} ${-view.y * view.k}) scale(${view.k})`); ghostL.setAttribute('transform', world.getAttribute('transform')); if (nav) nav.update(); };

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
    if (!faces.includes(face)) return null;
    const slot = (back ? backPortSlots(d, h) : portSlots(d, h)).get(pid); if (!slot) return null;
    const x = panelX(r, face) + slot.x + slot.w / 2, y = yTop(r, d.rack.u + m.u - 1) + slot.y + slot.h / 2;
    return { x, y, face, h: slot.h };
  }
  function drawRack(r) {
    const idx = rackIndex(data()), devs = idx.get(r.id) || [], s = rackSummary(data(), r, lan(), idx), L = lan();
    const used = new Map(); for (const c of data().cables) { for (const e of [c.a, c.b]) { if (!used.has(e[0])) used.set(e[0], new Set()); used.get(e[0]).add(e[1]); } }
    const bad = new Set([...s.collisions.flatMap(c => [c.a, c.b]), ...s.outside, ...s.deep]);
    const S = sel(); let g = '';
    for (const face of ['front', 'rear']) {
      const x0 = faceX(r, face), px = panelX(r, face), H = totalH(r);
      g += `<g class="ntRkFace" data-rack="${esc(r.id)}" data-face="${face}">`;
      g += `<text class="ntRkTitle" x="${x0}" y="${TOP - 26}">${esc(r.name)} · ${face === 'front' ? tl('face avant') : tl('face arrière, vue de derrière')}</text>`;
      g += `<rect class="ntRkCab${S && S.kind === 'rack' && S.id === r.id ? ' sel' : ''}" x="${x0}" y="${TOP}" width="${r.w}" height="${r2(H - TOP)}" rx="6"/>`;
      g += `<rect class="ntRkInner" x="${px - 4}" y="${TOP + FRAME - 4}" width="${PANEL_MM + 8}" height="${r2(r.u * U_MM + 8)}"/>`;
      for (let k = 1; k <= r.u; k++) {
        const y = yTop(r, k);
        g += `<rect class="ntRkSlot" x="${px}" y="${r2(y)}" width="${PANEL_MM}" height="${U_MM}" data-u="${k}"/>`;
        g += `<text class="ntRkU" x="${r2(px - 7)}" y="${r2(y + U_MM / 2 + 3)}">${k}</text>`;
      }
      g += `<rect class="ntRkRail" x="${px}" y="${TOP + FRAME}" width="${EAR}" height="${r2(r.u * U_MM)}"/><rect class="ntRkRail" x="${r2(px + PANEL_MM - EAR)}" y="${TOP + FRAME}" width="${EAR}" height="${r2(r.u * U_MM)}"/>`;
      g += '</g>';
      // Équipements.
      for (const d of devs) {
        const m = MOUNT[d.type]; if (!m || !m.u) continue;
        const faces = facesOf(d, r); if (!faces.includes(face)) continue;
        const own = (d.rack.face === 'rear' ? 'rear' : 'front') === face, h = faceH(m.u), y = yTop(r, d.rack.u + m.u - 1);
        if (spanOf(d)[0] < 1 && spanOf(d)[1] < 1) continue;
        const cls = `ntRkDev${S && S.kind === 'dev' && S.id === d.id ? ' sel' : ''}${bad.has(d.id) ? ' bad' : ''}${drag && drag.id === d.id && drag.moved ? ' moving' : ''}`;
        g += `<g class="${cls}" data-dev="${esc(d.id)}" transform="translate(${r2(px)} ${r2(y + 0.4)})">${faceSvg(d, h, { lan: L, used: used.get(d.id), back: !own })}<rect class="ntRkHit" x="0" y="0" width="${PANEL_MM}" height="${r2(h)}"/></g>`;
      }
      // PDU verticales (0U), fixées à l'arrière : la première à gauche vu de devant, la deuxième à droite. Vue de
      // derrière (élévation arrière, retournée gauche-droite), la première est donc à droite.
      if (face === 'rear') {
        devs.filter(d => MOUNT[d.type] && MOUNT[d.type].pdu && !MOUNT[d.type].u).forEach((d, i) => {
          const leftFromFront = i % 2 === 0, len = Math.min(r.u * U_MM - 20, 1620), x = leftFromFront ? r2(px + PANEL_MM + 6) : r2(px - 58), y = TOP + FRAME + (r.u * U_MM - len) / 2;
          g += `<g class="ntRkDev ntRkZero${S && S.kind === 'dev' && S.id === d.id ? ' sel' : ''}" data-dev="${esc(d.id)}" transform="translate(${x} ${r2(y)})">${pduStripSvg(d, len, MOUNT[d.type].pdu.outlets)}</g>`;
        });
      }
    }
    // Cordons de brassage (face avant et arrière), couleur par VLAN.
    if (patchOn) {
      const byId = new Map(devs.map(d => [d.id, d]));
      for (const c of cordsOf(r, devs)) {
        const a = portPos(r, byId.get(c.a[0]), c.a[1]), b = portPos(r, byId.get(c.b[0]), c.b[1]);
        if (!a || !b || a.face !== b.face) continue;
        const [p, q] = a.y <= b.y ? [a, b] : [b, a], sag = Math.max(18, Math.min(60, (q.y - p.y) / 2 + 14));
        const sw = [byId.get(c.a[0]), byId.get(c.b[0])].find(d => !PANELS.has(d.type)), port = sw === byId.get(c.a[0]) ? c.a[1] : c.b[1];
        const v = sw && sw.p && sw.p.ports && sw.p.ports[port] ? sw.p.ports[port].vlan ?? sw.p.ports[port].pvid : null;
        const vc = v != null && v !== '' ? ' v' + (Math.abs(+v || 0) % 8) : ' ' + c.cat;
        const S2 = sel(), on = S2 && S2.kind === 'cable' && S2.id === c.id;
        g += `<path class="ntRkCord${vc}${on ? ' sel' : ''}" data-cable="${esc(c.id)}" d="M${r2(p.x)} ${r2(p.y + p.h / 2)} C${r2(p.x)} ${r2(p.y + sag)} ${r2(q.x)} ${r2(q.y - sag)} ${r2(q.x)} ${r2(q.y - q.h / 2)}"/>`;
      }
    }
    world.innerHTML = g;
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
      return `<button type="button" class="ntRkCard${S_is('rack', s.id) ? ' sel' : ''}" data-rkopen="${esc(s.id)}">
        <header>${icon('rack')}<b>${esc(s.name)}</b><small>${r.kind === 'wall' ? tl('Coffret mural') : tl('Baie au sol')} · ${s.u} U</small>${list.length ? `<span class="ntRkBadge ${errs ? 'err' : 'warn'}">${list.length}</span>` : `<span class="ntRkBadge ok">${icon('check')}</span>`}</header>
        <div class="ntRkMini">${miniRack(r, s)}</div>
        <dl>
          <dt>${tl('Remplissage')}</dt><dd><div class="ntRkGauge"><i style="width:${pct}%"></i></div><span>${tl('{0} / {1} U', s.usedU, s.u)}</span></dd>
          <dt>${tl('Puissance consommée')}</dt><dd><span>${f(s.w)} W · ${f(s.va)} VA</span></dd>
          <dt>${tl('Chaleur')}</dt><dd><div class="ntRkGauge ${heatPct > 100 ? 'bad' : heatPct > 80 ? 'warn' : ''}"><i style="width:${Math.min(100, heatPct)}%"></i></div><span>${f(s.btu)} BTU/h</span></dd>
          <dt>${tl('Poids')}</dt><dd><div class="ntRkGauge ${kgPct > 100 ? 'bad' : kgPct > 80 ? 'warn' : ''}"><i style="width:${Math.min(100, kgPct)}%"></i></div><span>${f(s.kg)} / ${f(r.load)} kg</span></dd>
          <dt>${tl('Onduleur')}</dt><dd><span>${ups ? (ups.runtime === Infinity ? '—' : tl('{0} % · {1} min', Math.round(ups.pct), f(ups.runtime))) : tl('aucun')}</span></dd>
        </dl></button>`;
    }).join('')}</div>`;
  }
  const S_is = (kind, id) => { const s = sel(); return !!s && s.kind === kind && s.id === id; };
  /** Petite élévation de la carte : un trait par équipement. */
  function miniRack(r, s) {
    const H = 120, k = H / r.u;
    let g = `<svg viewBox="0 0 40 ${H}" preserveAspectRatio="none" aria-hidden="true"><rect class="ntRkMiniCab" x="0" y="0" width="40" height="${H}"/>`;
    for (const d of s.devices) if (d.h) g += `<rect class="ntRkMiniDev t-${MOUNT[d.type] && (MOUNT[d.type].ups || MOUNT[d.type].ebmOf) ? 'ups' : PANELS.has(d.type) ? 'patch' : specOf({ type: d.type }) && specOf({ type: d.type }).role === 'mech' ? 'mech' : 'net'}" x="3" y="${r2(H - (d.u + d.h - 1) * k)}" width="34" height="${r2(Math.max(1, d.h * k - 0.6))}"/>`;
    return g + '</svg>';
  }

  /* ---------- Liste « Hors baie », résumé, carte de sélection, brassage ---------- */
  function drawSide() {
    const list = unracked(data());
    $('.ntRkList').innerHTML = list.length ? list.map(d => `<button type="button" class="ntRkItem${S_is('dev', d.id) ? ' sel' : ''}" data-rkitem="${esc(d.id)}" title="${esc(DEVICES[d.type].name())}">${icon(DEVICES[d.type].icon)}<span>${esc(d.name)}</span><small>${MOUNT[d.type].u ? MOUNT[d.type].u + 'U' : '0U'}</small></button>`).join('') : `<p class="mut">${tl('Tout est rangé. Glissez un équipement de la bibliothèque pour en ajouter.')}</p>`;
  }
  function drawSum(r, s) {
    const f = v => (Math.round(v * 10) / 10).toLocaleString(isEn ? 'en-GB' : 'fr-FR'), ups = s.ups[0];
    $('.ntRkSum').innerHTML = `<span>${icon('rack')}<b>${esc(r.name)}</b> ${tl('{0} / {1} U', s.usedU, r.u)}</span><span>${icon('zap')}${f(s.w)} W · ${f(s.va)} VA</span><span>${icon('thermo')}${f(s.btu)} BTU/h</span><span>${icon('box')}${f(s.kg)} / ${f(r.load)} kg</span>${ups ? `<span class="${ups.pct > 100 || ups.runtime < r.runtime ? 'bad' : ''}">${icon('battery')}${Math.round(ups.pct)} % · ${ups.runtime === Infinity ? '—' : tl('{0} min', f(ups.runtime))}</span>` : ''}`;
  }
  function drawSelCard() {
    const card = $('.ntRkSel'), s = sel(), d = s && s.kind === 'dev' ? findDev(s.id) : null;
    if (!d || !MOUNT[d.type] || specOf(d).role === 'mech') { card.hidden = true; return; }
    const m = MOUNT[d.type];
    card.hidden = false;
    card.innerHTML = `<header>${icon(DEVICES[d.type].icon)}<b>${esc(d.name)}</b><small>${esc(m.ref)} · ${m.u} U</small></header>${placeFields(ctx, d, data())}${d.rack ? `<button type="button" class="btn small subtle" data-rksel="unrack">${icon('x')}<span>${tl('Retirer de la baie')}</span></button>` : ''}<p class="mut">${tl('Réglages réseau : onglet Réseau de l’inspecteur.')}</p>`;
  }
  function drawPatch(r) {
    const box = $('.ntRkPatch'); box.hidden = !patchOn; if (!patchOn || !r) return;
    const rows = patchingSchedule(data(), lan(), { rack: r.id });
    const devs = data().devices.filter(d => d.rack && d.rack.id === r.id);
    const panels = devs.filter(d => PANELS.has(d.type)), actives = devs.filter(d => { const ro = (specOf(d) || {}).role; return ro && ro !== 'passive' && ro !== 'mech'; });
    const pOpts = panels.flatMap(p => freePorts(data(), p, 'front').filter(id => /^f\d+$/.test(id)).map(id => `<option value="${esc(p.id + '|' + id)}">${esc(p.name)} · ${esc(id.slice(1))}</option>`)).join('');
    const sOpts = actives.flatMap(a => freePorts(data(), a).map(id => `<option value="${esc(a.id + '|' + id)}">${esc(a.name)} · ${esc(id)}</option>`)).join('');
    const f = v => (v == null ? '—' : String(v).replace('.', isEn ? '.' : ','));
    box.innerHTML = `<header><b>${icon('cable')}${tl('Brassage de {0}', esc(r.name))}</b><span class="mut">${tl('{0} port(s) raccordé(s)', rows.length)}</span></header>
      <form class="ntRkPatchForm" data-rkform="patch"><select class="sel" name="a" aria-label="${tl('Port du panneau')}">${pOpts || `<option value="">${tl('aucun port libre')}</option>`}</select><span>→</span><select class="sel" name="b" aria-label="${tl('Port du switch')}">${sOpts || `<option value="">${tl('aucun port libre')}</option>`}</select><label class="ntRkLen"><input class="inp" name="len" type="number" min="0.1" max="10" step="0.1" value="${RACK_DESIGN.cord}" aria-label="${tl('Longueur du cordon (m)')}"><span>m</span></label><button class="btn small primary"${pOpts && sOpts ? '' : ' disabled'}>${icon('plus')}<span>${tl('Brasser')}</span></button></form>
      <div class="ntRkPatchScroll"><table class="ntTable"><thead><tr><th>${tl('Repère')}</th><th>${tl('Prise')}</th><th>${tl('Lien permanent')}</th><th>${tl('Panneau')}</th><th>${tl('Switch')}</th><th>VLAN</th><th>${tl('Cordon')}</th><th>${tl('Lien')}</th><th></th></tr></thead><tbody>
      ${rows.map(x => `<tr${x.cableId ? ` data-rkcable="${esc(x.cableId)}"` : ''} class="${S_is('cable', x.cableId) ? 'sel' : ''}"><td>${esc(x.label)}</td><td>${esc(x.outlet || '—')}</td><td>${x.permLen != null ? f(x.permLen) + ' m' : '—'}</td><td>${esc(x.panel)} · ${esc(x.port)}</td><td>${x.switch ? esc(x.switch) + ' · ' + esc(x.switchPort) : '—'}</td><td>${x.vlan ?? '—'}</td><td>${x.cordLen != null ? f(x.cordLen) + ' m' : '—'}</td><td>${x.up == null ? '—' : x.up ? `<i class="led g"></i>` : `<i class="led down"></i>`}</td><td>${x.cableId ? `<button type="button" class="tb" data-rkuncord="${esc(x.cableId)}" aria-label="${tl('Retirer le cordon')}" data-tip="${tl('Retirer le cordon')}">${icon('x')}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="9" class="mut">${tl('Aucun panneau raccordé dans cette baie.')}</td></tr>`}</tbody></table></div>`;
  }
  function paintBar() {
    el.querySelectorAll('[data-rkmode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rkmode === mode)));
    const pick = $('[data-rkpick]'), r = curRack();
    pick.innerHTML = racks().map(x => `<option value="${esc(x.id)}"${r && x.id === r.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
    pick.disabled = !racks().length; $('.ntRkPick').hidden = !racks().length;
    $('[data-rkpatch]').setAttribute('aria-pressed', String(patchOn));
    el.classList.toggle('patchOn', patchOn && mode === 'elev');
  }
  function render() {
    if (el.hidden) return;
    if (cur && !rackById(cur)) cur = null;
    if (!cur && racks().length) cur = racks()[0].id;
    if (!racks().length) mode = 'over';
    paintBar();
    over.hidden = mode !== 'over'; elev.hidden = mode !== 'elev';
    if (mode === 'over') { drawOverview(); nav.update(); return; }
    const r = curRack(), s = drawRack(r);
    drawSide(); drawSum(r, s); drawSelCard(); drawPatch(r);
    if (!fitted) { fitted = true; requestAnimationFrame(fit); }
    applyView();
  }

  /* ---------- Navigation ---------- */
  function bounds() { const r = curRack(); return r ? { x0: -70, y0: 0, x1: r.w * 2 + GAP + 70, y1: totalH(r) + 20 } : null; }
  function fitTo(b) {
    const R = canvas.getBoundingClientRect(); if (!b || !R.width) return;
    const W = R.width - 56 - 24, H = R.height - 24 - (patchOn ? 0 : 0);
    view.k = Math.max(0.05, Math.min(6, Math.min(W / (b.x1 - b.x0), H / (b.y1 - b.y0))));
    view.x = b.x0 - (W / view.k - (b.x1 - b.x0)) / 2 - 12 / view.k; view.y = b.y0 - (H / view.k - (b.y1 - b.y0)) / 2 - 12 / view.k;
    applyView();
  }
  function fit() { fitTo(bounds()); }
  function zoomAt(f, x, y) {
    const R = canvas.getBoundingClientRect(), px = x ?? R.width / 2, py = y ?? R.height / 2, wx = view.x + px / view.k, wy = view.y + py / view.k;
    view.k = Math.max(0.05, Math.min(6, view.k * f)); view.x = wx - px / view.k; view.y = wy - py / view.k; applyView();
  }
  function selBox() {
    const s = sel(), r = curRack(); if (!s || !r) return null;
    if (s.kind === 'rack' && s.id === r.id) return bounds();
    const d = s.kind === 'dev' ? findDev(s.id) : null, m = d && MOUNT[d.type];
    if (!d || !m || !d.rack || d.rack.id !== r.id || !m.u) return null;
    const y = yTop(r, d.rack.u + m.u - 1), x = panelX(r, d.rack.face);
    return { x0: x - 40, y0: y - 60, x1: x + PANEL_MM + 40, y1: y + m.u * U_MM + 60 };
  }
  const nav = ctx.createNavDock(elev, {
    active: () => ctx.isOn() && ctx.view() === 'racks' && mode === 'elev' && !el.hidden, target: () => svg, tools: () => ['select', 'pan', 'zoom'],
    zoomBy: (f, x, y) => zoomAt(f, x, y), panBy: (dx, dy) => { view.x -= dx / view.k; view.y -= dy / view.k; applyView(); },
    zoomPct: () => Math.round(view.k * 100 / 0.5), setZoomPct: p => zoomAt((p / 100) * 0.5 / view.k),
    fit, fitSel: () => { const b = selBox(); if (!b) return false; fitTo(b); return true; }, hasSel: () => !!selBox(),
    zoomRect(r) { fitTo({ x0: view.x + r.x / view.k, y0: view.y + r.y / view.k, x1: view.x + (r.x + r.w) / view.k, y1: view.y + (r.y + r.h) / view.k }); return true; },
    mini: {
      data: () => {
        const r = curRack(), b = bounds(); if (!r || !b) return null; const R = canvas.getBoundingClientRect();
        const boxes = [[0, TOP, r.w, totalH(r) - TOP, false], [r.w + GAP, TOP, r.w, totalH(r) - TOP, false]];
        for (const d of data().devices) { const m = MOUNT[d.type]; if (!d.rack || d.rack.id !== r.id || !m || !m.u) continue; for (const f of facesOf(d, r)) boxes.push([panelX(r, f), yTop(r, d.rack.u + m.u - 1), PANEL_MM, m.u * U_MM, S_is('dev', d.id)]); }
        return { bounds: [b.x0, b.y0, b.x1, b.y1], boxes, view: [view.x, view.y, view.x + R.width / view.k, view.y + R.height / view.k] };
      },
      centerOn: (x, y) => { const R = canvas.getBoundingClientRect(); view.x = x - R.width / 2 / view.k; view.y = y - R.height / 2 / view.k; applyView(); }
    },
    status: m => ctx.status(m), title: tl('Baies'),
    shortcuts: () => [['Drag', tl('Glisser un équipement : le déplacer d’U en U')], ['↑|↓', tl('Monter, descendre l’équipement d’un U')], ['←|→', tl('Face avant, face arrière')], ['Del', tl('Retirer de la baie')], ['Esc', tl('Annuler le geste, désélectionner')]]
  });
  svg.addEventListener('wheel', e => { e.preventDefault(); const R = canvas.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - R.left, e.clientY - R.top); }, { passive: false });

  /* ---------- Gestes : déplacer, poser ---------- */
  /** Place proposée pour d sous le pointeur (U du bas, face) et son verdict. */
  function proposal(r, d, ev, grab = 0) {
    const w = toWorld(ev.clientX, ev.clientY), m = MOUNT[d.type], h = hit(r, w.x, w.y - grab);
    const u = Math.max(1, Math.min(r.u - m.u + 1, h.u - m.u + 1));
    const inside = w.x > -80 && w.x < r.w * 2 + GAP + 80 && w.y > 0 && w.y < totalH(r) + 40;
    return { u, face: h.face, inside, ok: inside && canPlace(data(), r, d, u, h.face) };
  }
  function paintGhost(r, d, p) {
    if (!p || !p.inside || !MOUNT[d.type].u) { ghostL.innerHTML = ''; return; }
    const m = MOUNT[d.type], faces = facesOf({ ...d, rack: { id: r.id, u: p.u, face: p.face } }, r);
    ghostL.innerHTML = faces.map(f => `<rect class="ntRkGhost ${p.ok.ok ? 'ok' : 'bad'}" x="${r2(panelX(r, f))}" y="${r2(yTop(r, p.u + m.u - 1))}" width="${PANEL_MM}" height="${r2(m.u * U_MM)}" rx="2"/>`).join('')
      + `<text class="ntRkGhostT ${p.ok.ok ? 'ok' : 'bad'}" x="${r2(panelX(r, p.face) + PANEL_MM + 10)}" y="${r2(yTop(r, p.u + m.u - 1) + 16)}">U${p.u}${m.u > 1 ? '–' + (p.u + m.u - 1) : ''}${p.ok.ok ? '' : p.ok.why === 'clash' ? ' · ' + tl('occupé par {0}', ctx.nameOf(p.ok.with)) : ''}</text>`;
  }
  function placeAt(d, r, u, face) {
    d.rack = { ...(d.rack && d.rack.id === r.id ? d.rack : {}), id: r.id, u, face };
    if (d.rack.pdu && !rackById(r.id)) delete d.rack.pdu;
  }
  svg.addEventListener('pointerdown', e => {
    if (e.button !== 0 || mode !== 'elev') return;
    const r = curRack(); if (!r) return;
    const cord = e.target.closest('[data-cable]');
    if (cord) { ctx.select({ kind: 'cable', id: cord.dataset.cable }); return; }
    const g = e.target.closest('[data-dev]');
    if (!g) { const f = e.target.closest('[data-rack]'); ctx.select(f ? { kind: 'rack', id: f.dataset.rack } : null); return; }
    const d = findDev(g.dataset.dev); if (!d) return;
    ctx.select({ kind: 'dev', id: d.id });
    const m = MOUNT[d.type]; if (!m || !m.u) return;
    const w = toWorld(e.clientX, e.clientY), grab = w.y - yTop(r, d.rack.u + m.u - 1) - (m.u * U_MM) / 2 + U_MM / 2;
    drag = { id: d.id, sx: e.clientX, sy: e.clientY, moved: false, grab };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = curRack(), d = findDev(drag.id); if (!r || !d) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
    drag.moved = true; drag.p = proposal(r, d, e, drag.grab); paintGhost(r, d, drag.p);
  });
  const endDrag = e => {
    if (!drag) return;
    const r = curRack(), d = findDev(drag.id), p = drag.p, moved = drag.moved; drag = null; ghostL.innerHTML = '';
    if (!moved || !r || !d || !p) return;
    if (e.type === 'pointerup' && p.ok.ok) {
      if (d.rack.u !== p.u || d.rack.face !== p.face) { placeAt(d, r, p.u, p.face); ctx.commit(); ctx.status(tl('{0} en U{1} ({2}).', d.name, p.u, p.face === 'rear' ? tl('à l’arrière') : tl('à l’avant')), 'ok'); }
    } else if (p.inside) ctx.status(p.ok.why === 'clash' ? tl('Place prise par {0}.', ctx.nameOf(p.ok.with)) : tl('Hors de la baie.'), 'warn');
    render();
  };
  svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);

  // Liste « Hors baie » : glisser vers l'élévation, ou clic : place libre la plus basse.
  let ghostEl = null;
  $('.ntRkList').addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-rkitem]'); if (!b || e.button !== 0) return;
    e.preventDefault();
    const d = findDev(b.dataset.rkitem), sx = e.clientX, sy = e.clientY; let moved = false, p = null;
    const mv = ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      moved = true;
      if (!ghostEl) { ghostEl = document.createElement('div'); ghostEl.className = 'ntGhost'; ghostEl.innerHTML = icon(DEVICES[d.type].icon); document.body.appendChild(ghostEl); }
      ghostEl.style.left = ev.clientX + 'px'; ghostEl.style.top = ev.clientY + 'px';
      const r = curRack(); if (r && MOUNT[d.type].u) { p = proposal(r, d, ev); paintGhost(r, d, p); }
    };
    const up = ev => {
      removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true);
      if (ghostEl) { ghostEl.remove(); ghostEl = null; } ghostL.innerHTML = '';
      const r = curRack();
      if (!moved) { ctx.select({ kind: 'dev', id: d.id }); if (r) quickPlace(d, r); return; }
      if (!r) return;
      if (!MOUNT[d.type].u) { const R = canvas.getBoundingClientRect(); if (ev.clientX >= R.left && ev.clientX <= R.right) quickPlace(d, r); return; }
      if (p && p.inside && p.ok.ok) { placeAt(d, r, p.u, p.face); ctx.select({ kind: 'dev', id: d.id }); ctx.commit(); }
      else if (p && p.inside) ctx.status(tl('Place prise par {0}.', ctx.nameOf(p.ok.with)), 'warn');
    };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  });
  function quickPlace(d, r, near) {
    const m = MOUNT[d.type], face = m.u ? 'front' : 'rear', u = findFree(data(), r, d, face, near ?? 1);
    if (!u) { ctx.status(tl('Plus de place de {0} U libre dans {1}.', m.u, r.name), 'warn'); return false; }
    placeAt(d, r, u, face); ctx.commit(); ctx.status(tl('{0} en U{1} de {2}.', d.name, u, r.name), 'ok'); return true;
  }

  /* ---------- Barre, cartes, brassage ---------- */
  function addRack(kind, commit = true) {
    const r = newRack(data(), kind); racks().push(r); cur = r.id; mode = 'elev'; fitted = false;
    if (!commit) return r;
    ctx.select({ kind: 'rack', id: r.id }); ctx.commit(); ctx.status(tl('{0} ajoutée : glissez-y les équipements.', r.name), 'ok');
    return r;
  }
  el.addEventListener('click', e => {
    const t = e.target;
    const m = t.closest('[data-rkmode]'); if (m) { mode = m.dataset.rkmode; if (mode === 'elev') fitted = false; render(); ctx.renderPane(); return; }
    const a = t.closest('[data-rkadd]'); if (a) { addRack(a.dataset.rkadd); return; }
    if (t.closest('[data-rkpatch]')) { patchOn = !patchOn; setPref('jollof-net-rack-patch', patchOn ? '1' : '0'); if (patchOn && mode === 'over' && racks().length) mode = 'elev'; render(); return; }
    const o = t.closest('[data-rkopen]'); if (o) { cur = o.dataset.rkopen; mode = 'elev'; fitted = false; ctx.select({ kind: 'rack', id: cur }); render(); return; }
    const un = t.closest('[data-rkuncord]'); if (un) { const id = un.dataset.rkuncord; data().cables = data().cables.filter(c => c.id !== id); ctx.commit(); return; }
    const row = t.closest('[data-rkcable]'); if (row) { ctx.select({ kind: 'cable', id: row.dataset.rkcable }); return; }
    if (t.closest('[data-rksel="unrack"]')) { const d = findDev(sel().id); if (d) { delete d.rack; ctx.commit(); } }
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-rkpick]')) { cur = t.value; fitted = false; render(); return; }
    if (t.closest('.ntRkSel') && t.dataset.rkd) { const s = sel(); const d = s && findDev(s.id); if (d) setDevField(d, t.dataset.rkd, t.value); }
  });
  el.addEventListener('submit', e => {
    const f = e.target.closest('[data-rkform="patch"]'); if (!f) return;
    e.preventDefault();
    const a = f.elements.a.value.split('|'), b = f.elements.b.value.split('|'); if (a.length < 2 || b.length < 2) return;
    const len = Math.max(0.1, Math.min(10, +f.elements.len.value || RACK_DESIGN.cord));
    const c = ctx.addCable(a, b, { kind: 'straight', len }); ctx.commit();
    ctx.status(tl('Cordon de {0} m : {1} → {2}.', len, ctx.nameOf(a[0]) + ' · ' + a[1].slice(1), ctx.nameOf(b[0]) + ' · ' + b[1]), 'ok'); void c;
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

  /* ---------- Contrat des vues ---------- */
  const api = {
    el,
    show() { el.hidden = false; nav.reset(); },
    hide() { el.hidden = true; drag = null; ghostL.innerHTML = ''; nav.update(); },
    render() { try { render(); } catch (e) { console.error(e); } },
    key(e) {
      if (e.type === 'keydown' && nav.key(e)) return true;
      const k = e.key, s = sel();
      if (k === 'Escape') { if (drag) { drag = null; ghostL.innerHTML = ''; render(); return true; } if (s) { ctx.select(null); return true; } return false; }
      if (mode !== 'elev') return false;
      const d = s && s.kind === 'dev' ? findDev(s.id) : null, r = d && d.rack ? rackById(d.rack.id) : null;
      if (d && r && MOUNT[d.type] && MOUNT[d.type].u && (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight')) {
        const step = e.shiftKey ? 5 : 1;
        let u = d.rack.u, face = d.rack.face;
        if (k === 'ArrowUp') u += step; else if (k === 'ArrowDown') u -= step; else face = k === 'ArrowLeft' ? 'front' : 'rear';
        const ok = canPlace(data(), r, d, u, face);
        if (ok.ok) { d.rack.u = u; d.rack.face = face; ctx.commit(); } else ctx.status(ok.why === 'clash' ? tl('Place prise par {0}.', ctx.nameOf(ok.with)) : tl('Hors de la baie.'), 'warn');
        return true;
      }
      if (k === 'Delete' || k === 'Backspace') {
        if (d && d.rack) { delete d.rack; ctx.commit(); ctx.status(tl('{0} retiré de la baie (il reste dans le projet).', d.name)); return true; }
        if (s && s.kind === 'rack') { deleteRack(s.id); return true; }
        if (s && s.kind === 'cable' && data().cables.some(c => c.id === s.id)) { data().cables = data().cables.filter(c => c.id !== s.id); ctx.select(null); ctx.commit(); return true; }
      }
      return false;
    },
    keyup(e) { nav.key(e); },
    fit() { fit(); },
    reveal(id) {
      const r = rackById(id);
      if (r) { cur = r.id; mode = 'elev'; fitted = true; ctx.select({ kind: 'rack', id }); render(); fit(); return true; }
      const d = findDev(id); if (!d || !MOUNT[d.type] && specOf(d).role !== 'mech') return false;
      if (d.rack && rackById(d.rack.id)) { cur = d.rack.id; mode = 'elev'; ctx.select({ kind: 'dev', id }); render(); const b = selBox(); if (b) fitTo(b); else fit(); return true; }
      mode = racks().length ? 'elev' : 'over'; ctx.select({ kind: 'dev', id }); render(); return true;
    },
    pane(s) {
      // La sélection change (clic dans une autre vue, le panneau Problèmes, l'IA) : l'élévation suit.
      const key = s ? s.kind + ':' + s.id : '';
      if (key !== lastSel) { lastSel = key; if (!el.hidden) requestAnimationFrame(() => render()); }
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
        if (a && a.dataset.rka === 'deldev' && s && s.kind === 'dev') { data().devices = data().devices.filter(d => d.id !== s.id); data().cables = data().cables.filter(c => c.a[0] !== s.id && c.b[0] !== s.id); ctx.select(null); ctx.commit(); return true; }
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
      ctx.select({ kind: 'dev', id: d.id }); ctx.commit();
      ctx.status(placed ? tl('{0} posé dans {1}, U{2}.', d.name, r.name, d.rack.u) : tl('{0} ajouté hors baie : {1} est pleine.', d.name, r.name), placed ? 'ok' : 'warn');
    }
  };
  function deleteRack(id) {
    const r = removeRack(data(), id).rack; if (!r) return;
    if (cur === id) cur = null;
    ctx.select(null); ctx.commit(); ctx.status(tl('{0} supprimée : ses équipements restent dans le projet, hors baie.', r.name));
  }
  // Palette de commandes.
  if (ctx.app && ctx.app.commands) {
    const when = () => ctx.isOn();
    ctx.app.commands.register({ id: 'net.rack.addFloor', cat: tl('Réseau'), icon: 'rack', label: tl('Baies : ajouter une baie au sol'), when, run: () => ctx.openView('racks').then(() => addRack('floor')) });
    ctx.app.commands.register({ id: 'net.rack.addWall', cat: tl('Réseau'), icon: 'rack', label: tl('Baies : ajouter un coffret mural'), when, run: () => ctx.openView('racks').then(() => addRack('wall')) });
    ctx.app.commands.register({ id: 'net.rack.patch', cat: tl('Réseau'), icon: 'cable', label: tl('Baies : afficher le brassage'), when, run: () => ctx.openView('racks').then(() => { patchOn = true; setPref('jollof-net-rack-patch', '1'); if (racks().length) mode = 'elev'; render(); }) });
  }
  if (racks().length) mode = 'elev';
  return api;
}
