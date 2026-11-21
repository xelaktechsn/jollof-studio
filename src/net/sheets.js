// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Planches imprimables de la conception (module pur, sans interface) : une planche par étage (plan à l'échelle avec le fond
// de plan importé en gris, pièces, cheminements, tracés des câbles, baies, prises avec leur identifiant, points d'accès)
// et des planches d'élévations de baies, chacune avec son cartouche (projet, client, site, titre et numéro de planche,
// échelle, date, révision, auteur), sa légende, sa flèche du nord et son échelle graphique. SVG vectoriel en millimètres
// du papier (A3 ou A1 paysage), lisible imprimé : à imprimer (zone d'impression) ou à enregistrer.
import { tl } from '../i18n/index.js';
import { floorsOf, polyCentroid, cleanDesign, mountOf } from './dimension.js';
import { labeler } from './docs.js';
import { specOf } from './devices.js';
import * as ROUTE from './route.js';

/** Formats de papier (mm, paysage). */
export const PAPERS = { A3: [420, 297], A2: [594, 420], A1: [841, 594] };
/** Échelles normalisées (1:n). */
export const SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r2 = v => Math.round(v * 100) / 100;
const MARGIN = 10, TB_W = 175, TB_H = 46; // marge du cadre ; cartouche en bas à droite (mm)
const C = { ink: '#0f172a', mute: '#475569', line: '#334155', room: '#f8fafc', roomLine: '#94a3b8', under: '#a8b0bb', path: '#d97706', cable: '#3b82f6', outlet: '#1d4ed8', ap: '#15803d', rack: '#1e3a8a', accent: '#1e3a8a' };

/** Plus petite échelle normalisée qui fait tenir w × h mètres dans aw × ah millimètres. */
export function fitScale(wM, hM, aw, ah) {
  for (const s of SCALES) if ((wM * 1000) / s <= aw && (hM * 1000) / s <= ah) return s;
  return SCALES[SCALES.length - 1];
}
/** Longueur « ronde » d'une échelle graphique (m) : environ le cinquième de la largeur dessinée. */
export const niceLength = m => { const t = m / 5, p = 10 ** Math.floor(Math.log10(t)); for (const k of [1, 2, 5, 10]) if (k * p >= t) return k * p; return 10 * p; };

/** Fond de plan d'un étage, en mètres de l'étage : segments (Float32Array) déjà passés par la transformation, ou null. */
export function underlaySegs(data, floorId, un, max = 200000) {
  const u = data.underlays && data.underlays[floorId]; if (!u || !un || !un.segs) return null;
  const t = u.transform || {}, a = (t.rot || 0) * Math.PI / 180, s = t.scale || 1, c = Math.cos(a) * s, n = Math.sin(a) * s;
  const H = un.bbox ? un.bbox[3] : 0, on = new Set((u.layers || []).filter(l => l.on !== false).map(l => l.id));
  const N = Math.min(un.segLayer.length, max), out = new Float32Array(N * 4); let k = 0;
  for (let i = 0; i < N; i++) {
    if (on.size && !on.has(un.segLayer[i])) continue;
    for (let j = 0; j < 2; j++) { const x = un.segs[i * 4 + j * 2], y = H - un.segs[i * 4 + j * 2 + 1]; out[k++] = c * x - n * y + (t.dx || 0); out[k++] = n * x + c * y + (t.dy || 0); }
  }
  return out.subarray(0, k);
}
/** Étendue (m) de ce qui est dessiné sur l'étage : pièces, murs, équipements, baies, cheminements (sinon le fond). */
export function floorBox(data, f, segs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const r of f.rooms || []) for (const p of r.poly || []) add(p[0], p[1]);
  for (const w of f.walls || []) { add(...w.a); add(...w.b); }
  for (const d of data.devices || []) if (d.loc && d.loc.floor === f.id) add(d.loc.x, d.loc.y);
  for (const r of data.racks || []) if (r.floor === f.id) add(r.x, r.y);
  for (const p of data.paths || []) if (p.floor === f.id) for (const q of p.pts) add(q[0], q[1]);
  if (!Number.isFinite(x0) && segs && segs.length) for (let i = 0; i < segs.length; i += 2) add(segs[i], segs[i + 1]);
  if (!Number.isFinite(x0)) return [0, 0, 10, 10];
  return [x0 - 1, y0 - 1, x1 + 1, y1 + 1];
}

/** Cartouche, cadre, légende ; rend le SVG d'une planche autour de body (déjà placé en mm). */
function frame(data, paper, body, o) {
  const [W, H] = PAPERS[paper], D = data.design && data.design.usage ? data.design : cleanDesign(data.design), P = D.project;
  const x = W - MARGIN - TB_W, y = H - MARGIN - TB_H, row = (yy, k, v, xx = x, ww = TB_W) => `<text x="${xx + 2}" y="${yy + 3.2}" font-size="2.2" fill="${C.mute}">${esc(k)}</text><text x="${xx + 2}" y="${yy + 8}" font-size="3.4" font-weight="600" fill="${C.ink}">${esc(v || '—')}</text>`;
  const site = P.site || (data.site && data.site.name) || tl('Projet réseau');
  const tb = `<g class="ntShTb">
    <rect x="${x}" y="${y}" width="${TB_W}" height="${TB_H}" fill="#fff" stroke="${C.ink}" stroke-width="0.5"/>
    <line x1="${x}" y1="${y + 12}" x2="${x + TB_W}" y2="${y + 12}" stroke="${C.ink}" stroke-width="0.3"/>
    <line x1="${x}" y1="${y + 24}" x2="${x + TB_W}" y2="${y + 24}" stroke="${C.ink}" stroke-width="0.3"/>
    <line x1="${x}" y1="${y + 35}" x2="${x + TB_W}" y2="${y + 35}" stroke="${C.ink}" stroke-width="0.3"/>
    <line x1="${x + 90}" y1="${y}" x2="${x + 90}" y2="${y + 12}" stroke="${C.ink}" stroke-width="0.3"/>
    ${[45, 90, 130].map(dx => `<line x1="${x + dx}" y1="${y + 24}" x2="${x + dx}" y2="${y + 46}" stroke="${C.ink}" stroke-width="0.3"/>`).join('')}
    ${row(y, tl('Projet'), site, x, 90)}${row(y, tl('Client'), P.client, x + 90, 85)}
    <text x="${x + 2}" y="${y + 15.2}" font-size="2.2" fill="${C.mute}">${esc(tl('Planche'))}</text><text x="${x + 2}" y="${y + 21.5}" font-size="4.6" font-weight="700" fill="${C.accent}">${esc(o.title)}</text>
    ${row(y + 24, tl('Échelle'), o.scale ? '1:' + o.scale : '—', x, 45)}${row(y + 24, tl('Date'), P.date || o.date, x + 45, 45)}${row(y + 24, tl('Révision'), P.rev, x + 90, 40)}${row(y + 24, tl('Planche n°'), `${o.no} / ${o.count}`, x + 130, 45)}
    ${row(y + 35, tl('Auteur'), P.author, x, 45)}${row(y + 35, tl('Format du papier'), paper, x + 45, 45)}
    <text x="${x + 92}" y="${y + 39}" font-size="2.2" fill="${C.mute}">${esc(tl('Produit par'))}</text><text x="${x + 92}" y="${y + 44}" font-size="3.2" font-weight="700" fill="${C.ink}">Jollof Studio</text>
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" font-family="Helvetica, Arial, sans-serif" class="ntSheet">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <rect x="${MARGIN}" y="${MARGIN}" width="${W - 2 * MARGIN}" height="${H - 2 * MARGIN}" fill="none" stroke="${C.ink}" stroke-width="0.7"/>
  ${body}${o.legend || ''}${tb}</svg>`;
}
/** Légende (au-dessus du cartouche). items : [[symbole svg (centré en 0,0), texte]]. */
function legend(W, H, items) {
  const x = W - MARGIN - TB_W, h = 6 + items.length * 6, y = H - MARGIN - TB_H - h - 3;
  return `<g class="ntShLeg"><rect x="${x}" y="${y}" width="${TB_W}" height="${h}" fill="#fff" stroke="${C.ink}" stroke-width="0.3"/><text x="${x + 2}" y="${y + 4.2}" font-size="2.6" font-weight="700" fill="${C.ink}">${esc(tl('Légende du plan'))}</text>
  ${items.map(([sym, t], i) => `<g transform="translate(${x + 7} ${y + 9 + i * 6})">${sym}</g><text x="${x + 14}" y="${y + 10 + i * 6}" font-size="2.6" fill="${C.ink}">${esc(t)}</text>`).join('')}</g>`;
}
/** Flèche du nord (angle du site, degrés depuis le haut du plan, sens horaire) et échelle graphique. */
function northAndBar(x, y, north, scale, lenM) {
  const mm = (lenM * 1000) / scale, half = mm / 2;
  return `<g class="ntShNorth" transform="translate(${x} ${y}) rotate(${north || 0})"><circle r="6" fill="#fff" stroke="${C.ink}" stroke-width="0.3"/><path d="M0,-5 L2.2,3 L0,1.6 L-2.2,3 Z" fill="${C.ink}"/><text y="-6.8" font-size="3" text-anchor="middle" font-weight="700" fill="${C.ink}">N</text></g>
  <g class="ntShBar" transform="translate(${x + 14} ${y + 2})"><rect width="${half}" height="1.6" fill="${C.ink}"/><rect x="${half}" width="${half}" height="1.6" fill="#fff" stroke="${C.ink}" stroke-width="0.25"/>
  <text y="-1.2" font-size="2.4" fill="${C.ink}">0</text><text x="${half}" y="-1.2" font-size="2.4" text-anchor="middle" fill="${C.ink}">${r2(lenM / 2)}</text><text x="${mm}" y="-1.2" font-size="2.4" text-anchor="middle" fill="${C.ink}">${r2(lenM)} m</text></g>`;
}

/**
 * Planche d'un étage. o : { paper: 'auto'|'A3'|'A2'|'A1', underlay: paquet décodé (unpackUnderlay) ou null, no, count,
 * date }. Rend { svg, paper, scale, title } ou null si l'étage n'existe pas.
 */
export function floorSheet(data, floorId, o = {}) {
  const F = floorsOf(data).find(x => x.f.id === floorId); if (!F) return null;
  const f = F.f, Lb = labeler(data), segs = underlaySegs(data, floorId, o.underlay);
  const box = floorBox(data, f, segs), wM = box[2] - box[0], hM = box[3] - box[1];
  const area = p => [PAPERS[p][0] - 2 * MARGIN - 8, PAPERS[p][1] - 2 * MARGIN - TB_H - 14];
  let paper = PAPERS[o.paper] ? o.paper : 'A3', scale = fitScale(wM, hM, ...area(paper));
  if (o.paper === 'auto' || !o.paper) for (const p of ['A3', 'A2', 'A1']) { paper = p; scale = fitScale(wM, hM, ...area(p)); if (scale <= 200) break; }
  const [W, H] = PAPERS[paper], k = 1000 / scale, [aw, ah] = area(paper);
  const ox = MARGIN + 4 + (aw - wM * k) / 2 - box[0] * k, oy = MARGIN + 4 + (ah - hM * k) / 2 - box[1] * k;
  const X = x => r2(ox + x * k), Y = y => r2(oy + y * k), mm = v => r2(v), txt = (x, y, s, t, a = '') => `<text x="${X(x)}" y="${Y(y)}" font-size="${mm(s)}" ${a}>${esc(t)}</text>`;
  const out = [];
  // Fond de plan importé, en gris fin.
  if (segs && segs.length) {
    let d = ''; for (let i = 0; i < segs.length; i += 4) d += `M${X(segs[i])} ${Y(segs[i + 1])}L${X(segs[i + 2])} ${Y(segs[i + 3])}`;
    out.push(`<path class="ntShUnder" d="${d}" fill="none" stroke="${C.under}" stroke-width="0.13" stroke-linecap="round"/>`);
  }
  for (const r of f.rooms || []) if ((r.poly || []).length) out.push(`<polygon points="${r.poly.map(p => X(p[0]) + ',' + Y(p[1])).join(' ')}" fill="${segs ? 'none' : C.room}" stroke="${C.roomLine}" stroke-width="0.2"/>`);
  if (!segs) for (const w of f.walls || []) out.push(`<line x1="${X(w.a[0])}" y1="${Y(w.a[1])}" x2="${X(w.b[0])}" y2="${Y(w.b[1])}" stroke="${C.line}" stroke-width="${mm(Math.max(0.35, ((+w.t || 100) / 1000) * k))}" stroke-linecap="square"/>`);
  for (const p of data.paths || []) {
    if (p.floor !== f.id) continue;
    if (p.kind === 'riser') { out.push(`<rect x="${X(p.pts[0][0]) - 1.6}" y="${Y(p.pts[0][1]) - 1.6}" width="3.2" height="3.2" fill="none" stroke="${C.path}" stroke-width="0.4"/><line x1="${X(p.pts[0][0]) - 1.6}" y1="${Y(p.pts[0][1]) - 1.6}" x2="${X(p.pts[0][0]) + 1.6}" y2="${Y(p.pts[0][1]) + 1.6}" stroke="${C.path}" stroke-width="0.4"/>`); continue; }
    if (p.kind === 'outdoor') continue;
    out.push(`<polyline points="${p.pts.map(q => X(q[0]) + ',' + Y(q[1])).join(' ')}" fill="none" stroke="${C.path}" stroke-width="0.9" stroke-opacity="0.5" stroke-dasharray="2.4 1.2"/>`);
  }
  // Tracés des câbles (tracé automatique) : fins, sous les symboles.
  if (typeof ROUTE.routeCable === 'function' && o.cables !== false) {
    let g = null; try { g = (data.paths || []).length ? ROUTE.graphOf(data) : null; } catch (e) { g = null; }
    let d = '';
    for (const c of data.cables || []) {
      if (!c.route || c.route.mode !== 'auto') continue;
      let r = null; try { r = ROUTE.routeCable(data, c, true, g || undefined); } catch (e) { r = null; }
      for (const leg of (r && r.legs) || []) if (leg.floor === f.id && leg.pts.length > 1) d += 'M' + leg.pts.map(q => X(q[0]) + ' ' + Y(q[1])).join('L');
    }
    if (d) out.push(`<path d="${d}" fill="none" stroke="${C.cable}" stroke-width="0.15" stroke-opacity="0.55"/>`);
  }
  for (const r of f.rooms || []) if ((r.poly || []).length) { const c = polyCentroid(r.poly); out.push(txt(c[0], c[1], 2.6, r.name || r.id, `text-anchor="middle" fill="${C.mute}"`)); }
  for (const r of data.racks || []) {
    if (r.floor !== f.id) continue;
    const wM2 = ((+r.w || 600) / 1000) * k, dM2 = ((+r.d || 800) / 1000) * k;
    out.push(`<g transform="translate(${X(r.x)} ${Y(r.y)}) rotate(${+r.rot || 0})"><rect x="${-wM2 / 2}" y="${-dM2 / 2}" width="${r2(wM2)}" height="${r2(dM2)}" fill="${C.rack}"/></g>`, `<text x="${X(r.x)}" y="${r2(Y(r.y) - dM2 / 2 - 1.2)}" font-size="2.6" font-weight="700" text-anchor="middle" fill="${C.rack}">${esc(Lb.rack(r.id))}</text>`);
  }
  const S = Math.max(1.6, Math.min(3, 0.3 * k)); // côté du symbole de prise (mm)
  for (const d of data.devices || []) {
    if (!d.loc || d.loc.floor !== f.id) continue;
    const x = X(d.loc.x), y = Y(d.loc.y);
    if (d.type === 'outlet' || d.type === 'outlet2') out.push(`<rect x="${r2(x - S / 2)}" y="${r2(y - S / 2)}" width="${S}" height="${S}" fill="${C.outlet}"/><text x="${r2(x + S / 2 + 0.6)}" y="${r2(y + 0.7)}" font-size="1.9" fill="${C.ink}">${esc(Lb.of(d.id) || d.name)}</text>`);
    else if (/^ap/.test(d.type)) out.push(`<circle cx="${x}" cy="${y}" r="${S * 0.75}" fill="#fff" stroke="${C.ap}" stroke-width="0.5"/><circle cx="${x}" cy="${y}" r="${S * 0.3}" fill="${C.ap}"/><text x="${r2(x + S + 0.4)}" y="${r2(y + 0.7)}" font-size="2" fill="${C.ap}">${esc(d.name)}</text>`);
  }
  const north = data.site && Number.isFinite(+data.site.north) ? +data.site.north : 0;
  const lenM = niceLength(Math.min(wM, (aw * scale) / 1000));
  const legendItems = [[`<rect x="-1.4" y="-1.4" width="2.8" height="2.8" fill="${C.outlet}"/>`, tl('Prise RJ45 et identifiant du lien')], [`<circle r="2" fill="#fff" stroke="${C.ap}" stroke-width="0.5"/><circle r="0.8" fill="${C.ap}"/>`, tl('Point d’accès Wi-Fi')], [`<rect x="-1.6" y="-1.2" width="3.2" height="2.4" fill="${C.rack}"/>`, tl('Baie')], [`<line x1="-3" x2="3" stroke="${C.path}" stroke-width="0.9" stroke-opacity="0.6" stroke-dasharray="2.4 1.2"/>`, tl('Cheminement de câbles')], [`<line x1="-3" x2="3" stroke="${C.cable}" stroke-width="0.4"/>`, tl('Tracé des câbles')]];
  if (segs) legendItems.push([`<line x1="-3" x2="3" stroke="${C.under}" stroke-width="0.4"/>`, tl('Fond de plan importé')]);
  const title = `${F.b.name || F.b.id} · ${f.name || f.id}`;
  const body = `<g class="ntShPlan">${out.join('')}</g>${northAndBar(MARGIN + 12, H - MARGIN - 10, north, scale, lenM)}`;
  return { svg: frame(data, paper, body, { title, scale, no: o.no || 1, count: o.count || 1, date: o.date, legend: legend(W, H, legendItems) }), paper, scale, title };
}

/**
 * Planche d'élévations (face avant) de quelques baies côte à côte, à l'échelle 1:10 sur A3 (1:20 si elles ne tiennent
 * pas). Rend { svg, paper, scale, title }.
 */
export function rackSheet(data, rackIds, o = {}) {
  const Lb = labeler(data), racks = rackIds.map(id => (data.racks || []).find(r => r.id === id)).filter(Boolean);
  const paper = 'A3', [W, H] = PAPERS[paper], aw = W - 2 * MARGIN - TB_W - 14, ah = H - 2 * MARGIN - 26;
  const U_MM = 44.45, maxU = Math.max(...racks.map(r => +r.u || 42), 1);
  let scale = 10; while (((maxU * U_MM) / scale > ah || (racks.length * (482.6 + 400)) / scale > aw) && scale < 50) scale = scale === 10 ? 20 : scale === 20 ? 25 : 50;
  const uh = U_MM / scale, rw = 482.6 / scale, gap = Math.max(30, (aw - racks.length * rw) / Math.max(1, racks.length));
  const parts = [];
  racks.forEach((r, i) => {
    const U = +r.u || 42, x = MARGIN + 14 + i * (rw + gap), y = MARGIN + 18 + (ah - U * uh);
    parts.push(`<text x="${r2(x + rw / 2)}" y="${r2(y - 5)}" font-size="3.6" font-weight="700" text-anchor="middle" fill="${C.ink}">${esc(Lb.rack(r.id))} · ${U} U</text><text x="${r2(x + rw / 2)}" y="${r2(y - 1.5)}" font-size="2.2" text-anchor="middle" fill="${C.mute}">${esc(r.name || '')}</text>`);
    parts.push(`<rect x="${r2(x)}" y="${r2(y)}" width="${r2(rw)}" height="${r2(U * uh)}" fill="#f8fafc" stroke="${C.ink}" stroke-width="0.5"/>`);
    for (let u = 1; u <= U; u++) parts.push(`<text x="${r2(x - 1)}" y="${r2(y + (U - u + 1) * uh - uh * 0.25)}" font-size="${r2(Math.min(2, uh * 0.7))}" text-anchor="end" fill="${C.mute}">${u}</text>`);
    for (const d of data.devices || []) {
      if (!d.rack || d.rack.id !== r.id || d.rack.face === 'rear') continue;
      const mu = mountOf(d.type).u; if (!mu) continue;
      const top = y + (U - (d.rack.u + mu - 1)) * uh, role = (specOf(d) || {}).role, blank = d.type === 'blank';
      const fill = blank ? '#eef2f6' : /^patch|fibrepanel/.test(d.type) ? '#dbeafe' : role === 'switch' || role === 'router' || role === 'l3' ? '#1e293b' : role === 'mech' ? '#cbd5e1' : '#e2e8f0';
      const ink = fill === '#1e293b' ? '#f8fafc' : C.ink, name = blank ? '' : /^patch|fibrepanel/.test(d.type) ? Lb.of(d.id) : d.name;
      parts.push(`<rect x="${r2(x + 0.4)}" y="${r2(top + 0.2)}" width="${r2(rw - 0.8)}" height="${r2(mu * uh - 0.4)}" fill="${fill}" stroke="#64748b" stroke-width="0.15"/>${name ? `<text x="${r2(x + 2)}" y="${r2(top + (mu * uh) / 2 + 0.8)}" font-size="${r2(Math.min(2.4, uh * 0.62))}" fill="${ink}">${esc(name)}</text>` : ''}`);
    }
  });
  const legendItems = [[`<rect x="-2" y="-1.2" width="4" height="2.4" fill="#1e293b"/>`, tl('Switch, routeur')], [`<rect x="-2" y="-1.2" width="4" height="2.4" fill="#dbeafe" stroke="#64748b" stroke-width="0.15"/>`, tl('Panneau de brassage')], [`<rect x="-2" y="-1.2" width="4" height="2.4" fill="#cbd5e1" stroke="#64748b" stroke-width="0.15"/>`, tl('Passe-câbles, PDU, onduleur')], [`<rect x="-2" y="-1.2" width="4" height="2.4" fill="#eef2f6" stroke="#64748b" stroke-width="0.15"/>`, tl('Obturateur')]];
  const title = tl('Élévations : {0}', racks.map(r => Lb.rack(r.id)).join(', '));
  return { svg: frame(data, paper, parts.join(''), { title, scale, no: o.no || 1, count: o.count || 1, date: o.date, legend: legend(W, H, legendItems) }), paper, scale, title };
}

/**
 * Jeu de planches : un par étage (ceux donnés, sinon tous), puis les baies deux par deux (1:10 sur A3). underlays : { [étage]: paquet
 * décodé } (facultatif). Rend [{ svg, paper, scale, title }].
 */
export function sheetSet(data, o = {}) {
  const fl = floorsOf(data).filter(x => !o.floors || o.floors.includes(x.f.id)), racks = (data.racks || []).map(r => r.id);
  const groups = []; if (o.racks !== false) for (let i = 0; i < racks.length; i += 2) groups.push(racks.slice(i, i + 2));
  const count = fl.length + groups.length, date = o.date || new Date().toISOString().slice(0, 10);
  const out = fl.map(({ f }, i) => floorSheet(data, f.id, { paper: o.paper || 'auto', underlay: o.underlays && o.underlays[f.id], no: i + 1, count, date }));
  groups.forEach((g, j) => out.push(rackSheet(data, g, { no: fl.length + j + 1, count, date })));
  return out.filter(Boolean);
}
/** Page HTML d'impression des planches (une page par planche, au format de la plus grande). */
export function sheetsHtml(sheets, o = {}) {
  const big = sheets.reduce((a, s) => (PAPERS[s.paper][0] > PAPERS[a][0] ? s.paper : a), 'A3'), [W, H] = PAPERS[big];
  const css = `@page{size:${W}mm ${H}mm;margin:0}html,body{margin:0;background:#fff}.ntShPage{width:${W}mm;height:${H}mm;break-after:page;page-break-after:always;overflow:hidden}.ntShPage:last-child{break-after:auto;page-break-after:auto}.ntShPage svg{display:block;width:${W}mm!important;height:${H}mm!important;break-after:auto!important;page-break-after:auto!important}`;
  const body = `<style>${css}</style>${sheets.map(s => `<div class="ntShPage">${s.svg}</div>`).join('')}`;
  return o.body ? { body, page: `@page { size: ${W}mm ${H}mm; margin: 0; }` } : `<!doctype html><html lang="${o.en ? 'en' : 'fr'}"><head><meta charset="utf-8"><title>${esc(o.title || tl('Planches'))}</title></head><body>${body}</body></html>`;
}
