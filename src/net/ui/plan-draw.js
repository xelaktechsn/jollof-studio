// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vue Plans : dessin d'un étage en SVG. Deux couches : le « monde » en mètres (plan importé, pièces, murs, portes,
// cheminements, empreintes des baies, tracé d'un câble), transformé par la vue, redessiné seulement quand le modèle ou la
// sélection changent ; la couche « écran » (étiquettes, équipements, poignées, tracé en cours), en pixels, redessinée à
// chaque déplacement de la vue, limitée à ce qui est visible.
import { tl } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { DEVICES } from '../devices.js';
import { USAGES, dist, roomArea, roomPoint, roomPath } from '../site.js';
import { PATH_KINDS, isConduitKind } from '../route.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f3 = v => Math.round(v * 1000) / 1000;
/** Nombre à la française (virgule) ou à l'anglaise. */
export const fmtNum = (v, d = 1, en = false) => { const s = (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace(/\.?0+$/, ''); return en ? s : s.replace('.', ','); };
/** Polygone d'un mur épais (rectangle autour de son axe). */
export function wallQuad(w) {
  const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * w.t / 2, ny = dx / L * w.t / 2;
  return [[w.a[0] + nx, w.a[1] + ny], [w.b[0] + nx, w.b[1] + ny], [w.b[0] - nx, w.b[1] - ny], [w.a[0] - nx, w.a[1] - ny]];
}
const pts = p => p.map(q => `${f3(q[0])},${f3(q[1])}`).join(' ');
/** Coins d'une baie (empreinte w × d mm autour de son centre, tournée de rot degrés). */
export function rackQuad(r) {
  const w = (r.w || 600) / 1000, d = (r.d || 1000) / 1000, a = (r.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => [r.x + x * c - y * s, r.y + x * s + y * c]);
}

/**
 * Couche monde (mètres). st : { sel: Set('kind:id'), img: url | null, legs: [{ floor, pts, fallback }] (câble choisi),
 * bad: Set(id) (objets en faute), byPath: Map(id → câbles), k (pixels par mètre) }.
 */
export function worldSvg(data, f, st) {
  let h = '';
  const on = (k, id) => st.sel.has(k + ':' + id);
  if (f.image && st.img) {
    const im = f.image;
    h += `<image class="ntPlImg" href="${st.img}" x="${f3(im.x)}" y="${f3(im.y)}" width="${f3(im.iw * im.scale)}" height="${f3(im.ih * im.scale)}" opacity="${im.opacity}" preserveAspectRatio="none"${im.rot ? ` transform="rotate(${im.rot} ${f3(im.x)} ${f3(im.y)})"` : ''}/>`;
  }
  for (const r of f.rooms) h += r.holes ? `<path class="ntPlRoom u-${r.usage}${on('room', r.id) ? ' sel' : ''}${st.bad.has(r.id) ? ' bad' : ''}" data-k="room" data-id="${esc(r.id)}" fill-rule="evenodd" d="${roomPath(r)}"/>` : `<polygon class="ntPlRoom u-${r.usage}${on('room', r.id) ? ' sel' : ''}${st.bad.has(r.id) ? ' bad' : ''}" data-k="room" data-id="${esc(r.id)}" points="${pts(r.poly)}"/>`;
  // Murs, puis les portes par-dessus (ouverture dans le mur, battant).
  for (const w of f.walls) h += `<polygon class="ntPlWall m-${w.mat}${on('wall', w.id) ? ' sel' : ''}" data-k="wall" data-id="${esc(w.id)}" points="${pts(wallQuad(w))}"/>`;
  const wl = new Map(f.walls.map(w => [w.id, w]));
  for (const d of f.doors) {
    const w = wl.get(d.wall); if (!w) continue;
    const L = dist(w.a, w.b) || 1, ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L, nx = -uy, ny = ux;
    const p0 = [w.a[0] + ux * (d.at - d.w / 2), w.a[1] + uy * (d.at - d.w / 2)], p1 = [w.a[0] + ux * (d.at + d.w / 2), w.a[1] + uy * (d.at + d.w / 2)];
    const gap = wallQuad({ a: p0, b: p1, t: w.t + 0.02 }), tip = [p0[0] + nx * d.w, p0[1] + ny * d.w];
    h += `<g class="ntPlDoor${on('door', d.id) ? ' sel' : ''}" data-k="door" data-id="${esc(d.id)}"><polygon class="gap" points="${pts(gap)}"/><path class="leaf" d="M${f3(p0[0])} ${f3(p0[1])} L${f3(tip[0])} ${f3(tip[1])} A${f3(d.w)} ${f3(d.w)} 0 0 1 ${f3(p1[0])} ${f3(p1[1])}"/></g>`;
  }
  // Cheminements : largeur réelle (au moins 8 cm pour rester visible), axe au trait fin.
  for (const p of data.paths || []) {
    if (p.floor !== f.id && !(p.kind === 'outdoor' && p.to === f.id)) continue;
    const cls = `ntPlPath p-${p.kind}${p.power ? ' power' : ''}${on('path', p.id) ? ' sel' : ''}${st.bad.has(p.id) ? ' bad' : ''}`;
    if (p.kind === 'riser') { const [x, y] = p.pts[0], r = Math.max(0.25, (p.w || 300) / 2000); h += `<g class="${cls}" data-k="path" data-id="${esc(p.id)}"><rect class="body" x="${f3(x - r)}" y="${f3(y - r)}" width="${f3(2 * r)}" height="${f3(2 * r)}"/><path class="axis" d="M${f3(x - r)} ${f3(y - r)}L${f3(x + r)} ${f3(y + r)}M${f3(x + r)} ${f3(y - r)}L${f3(x - r)} ${f3(y + r)}"/></g>`; continue; }
    const P = p.kind === 'outdoor' ? [p.floor === f.id ? p.pts[0] : p.pts[1]] : p.pts;
    if (P.length < 2) { const [x, y] = P[0]; h += `<g class="${cls}" data-k="path" data-id="${esc(p.id)}"><circle class="body" cx="${f3(x)}" cy="${f3(y)}" r="0.35"/><circle class="axis" cx="${f3(x)}" cy="${f3(y)}" r="0.12"/></g>`; continue; }
    const W = Math.max(0.08, ((p.w || p.dia || 60) / 1000));
    const d = 'M' + P.map(q => `${f3(q[0])} ${f3(q[1])}`).join('L');
    h += `<g class="${cls}" data-k="path" data-id="${esc(p.id)}"><path class="hit" d="${d}"/><path class="body" d="${d}" stroke-width="${f3(W)}"/><path class="axis" d="${d}"/></g>`;
  }
  // Baies (empreinte au sol), face avant marquée.
  for (const r of data.racks || []) {
    if (r.floor !== f.id || !Number.isFinite(+r.x)) continue;
    const q = rackQuad(r);
    h += `<g class="ntPlRack${on('rack', r.id) ? ' sel' : ''}${r.kind === 'wall' ? ' wall' : ''}" data-k="rack" data-id="${esc(r.id)}"><polygon points="${pts(q)}"/><line class="front" x1="${f3(q[2][0])}" y1="${f3(q[2][1])}" x2="${f3(q[3][0])}" y2="${f3(q[3][1])}"/></g>`;
  }
  // Tracé du câble choisi.
  for (const l of st.legs || []) if (l.floor === f.id && l.pts.length > 1) h += `<polyline class="ntPlRoute${l.fallback ? ' fb' : ''}" points="${pts(l.pts)}"/>`;
  return h;
}

/** Icône d'un équipement en SVG imbriqué (taille en pixels). */
/** Icône d'un genre d'équipement (repli : celle de la famille, puis une générique). */
export const devIconName = type => { const n = DEVICES[type] && DEVICES[type].icon; return n && icon(n) ? n : /^outlet/.test(type) ? 'outlet' : /^patch/.test(type) ? 'patchPanel' : 'network'; };
const devIcon = (type, s) => (DEVICES[type] ? icon(devIconName(type)).replace('<svg class="ic"', `<svg class="ic ntPlIc" x="${(-s / 2).toFixed(1)}" y="${(-s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" style="width:${s.toFixed(1)}px;height:${s.toFixed(1)}px"`) : '');

/**
 * Couche écran (pixels). st : { toS(x, y) → [sx, sy], W, H, k, sel, en, name(dev) → étiquette, draft, measure, handles:
 * [[sx, sy, clé]], bad: Set(id), mode }.
 */
export function overSvg(data, f, st) {
  let h = '';
  // Étiquettes sans chevauchement : une étiquette qui en recouvrirait une autre déjà posée n'est pas écrite (on la voit
  // en zoomant ou en choisissant l'objet). Boîtes en pixels écran : [x0, y0, x1, y1].
  const placed = [], fits = (cx, cy, w, hh) => { const b = [cx - w / 2 - 2, cy - hh / 2 - 1, cx + w / 2 + 2, cy + hh / 2 + 1]; if (placed.some(q => b[0] < q[2] && q[0] < b[2] && b[1] < q[3] && q[1] < b[3])) return false; placed.push(b); return true; };
  const tw = t => String(t).length * 6.3;
  const vis = (sx, sy, m = 60) => sx > -m && sy > -m && sx < st.W + m && sy < st.H + m;
  // Pièces : nom et surface au centre, si la pièce est assez grande à l'écran.
  for (const r of f.rooms) {
    const c = roomPoint(r), [sx, sy] = st.toS(c[0], c[1]); if (!vis(sx, sy, 120)) continue;
    const A = roomArea(r); if (Math.sqrt(A) * st.k < 46) continue;
    const nm = r.name || (USAGES[r.usage] ? USAGES[r.usage].name() : '');
    if (!fits(sx, sy + 4, Math.max(tw(nm), 50), 28)) continue;
    h += `<g class="ntPlRL${USAGES[r.usage] && USAGES[r.usage].tech ? ' tech' : ''}" transform="translate(${sx | 0} ${sy | 0})"><text y="-2">${esc(nm)}</text><text class="a" y="11">${fmtNum(A, 1, st.en)} m²</text></g>`;
  }
  // Baies : nom.
  for (const r of data.racks || []) { if (r.floor !== f.id) continue; const [sx, sy] = st.toS(r.x, r.y); if (vis(sx, sy) && st.k > 14) h += `<text class="ntPlRkL" x="${sx | 0}" y="${(sy - ((r.d || 1000) / 2000) * st.k - 4) | 0}">${esc(r.name)}</text>`; }
  // Cheminements : genre et taille près du milieu, en grand zoom.
  if (st.k > 22) for (const p of data.paths || []) {
    if (p.floor !== f.id || p.kind === 'outdoor' || p.pts.length < 2) { if (p.kind === 'riser' && p.floor === f.id) { const [sx, sy] = st.toS(p.pts[0][0], p.pts[0][1]); if (vis(sx, sy)) h += `<text class="ntPlPL" x="${(sx + 14) | 0}" y="${(sy + 4) | 0}">${esc(p.name || PATH_KINDS.riser.name())}</text>`; } continue; }
    const i = Math.floor((p.pts.length - 1) / 2), a = p.pts[i], b = p.pts[i + 1], [sx, sy] = st.toS((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); if (!vis(sx, sy)) continue;
    const size = isConduitKind(p.kind) ? `Ø${p.dia}` : p.w ? `${p.w}×${p.h}` : '';
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, up = ang > 90 || ang < -90 ? ang + 180 : ang;
    h += `<text class="ntPlPL${p.power ? ' power' : ''}" transform="translate(${sx | 0} ${sy | 0}) rotate(${up.toFixed(1)})" y="-7">${esc(p.name || PATH_KINDS[p.kind].name())}${size ? ' · ' + size : ''}</text>`;
  }
  // Fourreaux extérieurs : où ils mènent.
  for (const p of data.paths || []) {
    if (p.kind !== 'outdoor' || (p.floor !== f.id && p.to !== f.id)) continue;
    const q = p.floor === f.id ? p.pts[0] : p.pts[1], [sx, sy] = st.toS(q[0], q[1]); if (!vis(sx, sy)) continue;
    h += `<text class="ntPlPL" x="${(sx + 12) | 0}" y="${(sy + 4) | 0}">${esc(p.name || PATH_KINDS.outdoor.name())} · ${fmtNum(p.len, 0, st.en)} m</text>`;
  }
  // Équipements.
  // Étiquettes allégées : les prises (nombreuses) seulement de près, toutes les étiquettes seulement si l'écran n'est pas
  // trop chargé ; une étiquette cachée apparaît au survol de son équipement (et toujours pour la sélection).
  const r = Math.max(7, Math.min(13, st.k * 0.35)), showL = st.k > 9;
  const on = (data.devices || []).filter(d => d.loc && d.loc.floor === f.id && vis(...st.toS(d.loc.x, d.loc.y), 40));
  const dense = on.length > 140, outletsL = st.k >= 16 && on.length <= 90;
  for (const d of on) {
    const [sx, sy] = st.toS(d.loc.x, d.loc.y), s = st.sel.has('dev:' + d.id), nm = st.name(d);
    const want = s || (showL && !dense && (outletsL || !/^outlet/.test(d.type)) && fits(sx, sy + r + 7, tw(nm), 12));
    h += `<g class="ntPlDev t-${d.type}${s ? ' sel' : ''}${st.bad.has(d.id) ? ' bad' : ''}" data-k="dev" data-id="${esc(d.id)}" transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})"><circle r="${r}"/>${devIcon(d.type, r * 1.25)}<text${want ? '' : ' class="hov"'} y="${(r + 11).toFixed(0)}">${esc(nm)}</text></g>`;
  }
  // Poignées de l'objet choisi.
  for (const [sx, sy, key] of st.handles || []) if (vis(sx, sy)) h += `<rect class="ntPlH" data-h="${esc(key)}" x="${(sx - 5).toFixed(1)}" y="${(sy - 5).toFixed(1)}" width="10" height="10" rx="2"/>`;
  // Tracé en cours (mur, pièce, cheminement, mesure, étalonnage) : segments, longueur du dernier.
  const dr = st.draft;
  if (dr && dr.pts.length) {
    const P = [...dr.pts, ...(dr.cur ? [dr.cur] : [])].map(q => st.toS(q[0], q[1]));
    h += `<polyline class="ntPlDraft ${dr.kind}" points="${P.map(q => q.map(v => v.toFixed(1)).join(',')).join(' ')}"/>`;
    for (const q of P.slice(0, dr.pts.length)) h += `<circle class="ntPlDraftPt" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3.5"/>`;
    if (dr.cur) {
      const a = dr.pts[dr.pts.length - 1], L = dist(a, dr.cur), tot = dr.pts.reduce((s, q, i) => s + (i ? dist(dr.pts[i - 1], q) : 0), 0) + L;
      const [sx, sy] = P[P.length - 1];
      const txt = dr.kind === 'measure' && dr.pts.length > 1 ? `${fmtNum(L, 2, st.en)} m · Σ ${fmtNum(tot, 2, st.en)} m` : `${fmtNum(L, 2, st.en)} m`;
      h += `<g class="ntPlTip" transform="translate(${(sx + 12).toFixed(0)} ${(sy - 12).toFixed(0)})"><rect x="-4" y="-12" width="${txt.length * 6.6 + 8}" height="17" rx="4"/><text>${esc(txt)}</text></g>`;
    }
  }
  if (dr && dr.snap) { const [sx, sy] = st.toS(dr.snap[0], dr.snap[1]); h += `<circle class="ntPlSnap" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="7"/>`; }
  // Rectangle de pièce en cours.
  if (st.rect) { const [a, b] = [st.toS(st.rect[0][0], st.rect[0][1]), st.toS(st.rect[1][0], st.rect[1][1])]; h += `<rect class="ntPlDraft room" x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}"/>`; }
  // Lien en cours : du premier équipement au pointeur.
  if (st.link) { const [a, b] = [st.toS(st.link[0][0], st.link[0][1]), st.toS(st.link[1][0], st.link[1][1])]; h += `<line class="ntPlDraft link" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`; }
  return h;
}
