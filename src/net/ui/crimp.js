// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Atelier de sertissage d'une fiche RJ45 : gros plan de la fiche vue de dessus (languette en dessous, broche 1 à
// gauche), huit canaux numérotés et les huit conducteurs sortis de la gaine. L'élève les range comme il veut : glisser-
// déposer (souris ou doigt), ou clic sur un conducteur puis clic sur une broche, ou clavier (Tab, Entrée, chiffres 1 à 8).
// Les erreurs sont permises (ordre quelconque, conducteurs absents) : c'est le testeur qui les révèle. « Sertir » fige la
// fiche (end.crimped = true) et donne le verdict, seulement quand la carte des normes est montrée (showStandard et
// carte dépliée) : en mode examen (showStandard: false) ou carte repliée, rien ne dit si l'ordre est bon ; « Couper la
// fiche » permet de recommencer.
// Le modèle (ordre des conducteurs, normes) est celui de src/net/cable.js ; ce module n'est que l'interface.
import { tl, isEn, CANCEL } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { WIRES, T568A, T568B, STD, stdOf } from '../cable.js';
import './crimp.css';

/** Nom français de chaque conducteur (traduit à l'affichage). */
export const WIRE_NAMES = { wbl: 'blanc-bleu', bl: 'bleu', wo: 'blanc-orange', o: 'orange', wg: 'blanc-vert', g: 'vert', wbr: 'blanc-marron', br: 'marron' };
export const wireName = w => (w && WIRE_NAMES[w] ? tl(WIRE_NAMES[w]) : tl('vide'));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WHITE = '#f8fafc', EDGE = '#0f172a';

/** « 7 et 8 », « 1, 2 et 3 ». */
export function listJoin(a) {
  const s = a.map(String);
  return s.length < 2 ? (s[0] || '') : s.slice(0, -1).join(', ') + ' ' + tl('et') + ' ' + s[s.length - 1];
}
const pinsTx = a => (a.length === 1 ? tl('broche {0}', a[0]) : tl('broches {0}', listJoin(a)));

/** Petit échantillon d'un conducteur (pastille pleine, ou blanche rayée de sa couleur). */
export function swatch(w, wd = 28, ht = 12) {
  const W = WIRES[w];
  if (!W) return `<svg class="nt-sw" width="${wd}" height="${ht}" viewBox="0 0 ${wd} ${ht}" aria-hidden="true"><rect x=".5" y=".5" width="${wd - 1}" height="${ht - 1}" rx="${ht / 2 - .5}" fill="none" stroke="currentColor" stroke-opacity=".4" stroke-dasharray="2 2"/></svg>`;
  let s = `<svg class="nt-sw" width="${wd}" height="${ht}" viewBox="0 0 ${wd} ${ht}" aria-hidden="true"><rect x=".5" y=".5" width="${wd - 1}" height="${ht - 1}" rx="${ht / 2 - .5}" fill="${W.stripe ? WHITE : W.color}" stroke="${EDGE}" stroke-opacity=".45"/>`;
  if (W.stripe) for (let x = 4; x < wd - 4; x += 6) s += `<path d="M${x} 1.2 L${x + 3} 1.2 L${x + 1.5} ${ht - 1.2} L${x - 1.5} ${ht - 1.2}z" fill="${W.color}"/>`;
  return s + '</svg>';
}

/* ---------- Miniatures (inspecteur) ---------- */
// Fiche vue de dessus en 56 × 50 : contacts en haut, huit canaux, conducteurs qui sortent par le bas vers la gaine.
function thumbBody(end, ox = 0, oy = 0) {
  const order = end && Array.isArray(end.order) ? end.order : [], crimped = !!(end && end.crimped);
  let s = `<rect class="nt-th-plug${crimped ? '' : ' nt-th-open'}" x="${ox + 2}" y="${oy + 2}" width="52" height="36" rx="4"/>`;
  s += `<rect class="nt-jacket" x="${ox + 17}" y="${oy + 42}" width="22" height="8" rx="1.5" stroke-width=".8"/>`;
  for (let i = 0; i < 8; i++) {
    const x = ox + 6.5 + i * 5.6, w = order[i], W = WIRES[w];
    s += `<rect class="nt-th-blade${crimped ? '' : ' nt-th-up'}" x="${x}" y="${oy + (crimped ? 6 : 4)}" width="4" height="5" rx=".6"/>`;
    if (!W) { s += `<rect class="nt-th-empty" x="${x + .3}" y="${oy + 13}" width="3.4" height="22" rx="1.2"/>`; continue; }
    const bx = ox + 18.5 + i * 2.7; // conducteur : du canal vers la gaine
    const d = `M${x + 2} ${oy + 12} L${x + 2} ${oy + 34} C${x + 2} ${oy + 39} ${bx} ${oy + 38} ${bx} ${oy + 43}`;
    s += `<path d="${d}" fill="none" stroke="${EDGE}" stroke-opacity=".55" stroke-width="4.6" stroke-linecap="round"/>`;
    s += `<path d="${d}" fill="none" stroke="${W.stripe ? WHITE : W.color}" stroke-width="3.4" stroke-linecap="round"/>`;
    if (W.stripe) s += `<path d="${d}" fill="none" stroke="${W.color}" stroke-width="3.4" stroke-dasharray="2 2.4"/>`;
  }
  return s;
}
const endStd = end => {
  const k = stdOf(end);
  if (!end || !end.crimped) return tl('non sertie');
  return k ? 'T568' + k : tl('non normalisée');
};
/** Miniature d'une extrémité (fiche et couleurs de ses conducteurs), en SVG. */
export function crimpThumb(end) {
  return `<svg class="nt-thumb" width="56" height="50" viewBox="0 0 56 50" role="img" aria-label="${esc(tl('Fiche RJ45') + ' : ' + endStd(end))}">${thumbBody(end)}</svg>`;
}
/** Les deux extrémités d'un câble côte à côte, reliées par la gaine ; conducteurs coupés : croix rouge sur la gaine. */
export function cableSvg(cable, exam = false) {
  // Mode examen : ni norme des fiches ni conducteur coupé (défaut caché par l'enseignant), seulement « sertie ».
  const a = cable && cable.a, b = cable && cable.b, cut = exam ? [] : (cable && Array.isArray(cable.cut) ? cable.cut : []).filter(w => WIRES[w]);
  const endLabel = exam ? e => (e && e.crimped ? tl('sertie') : tl('non sertie')) : endStd;
  const label = `A : ${endLabel(a)} · B : ${endLabel(b)}` + (cut.length ? ' · ' + tl('coupés : {0}', cut.map(wireName).join(', ')) : '');
  let s = `<svg class="nt-cablesvg" width="156" height="80" viewBox="0 0 156 80" role="img" aria-label="${esc(label)}">`;
  s += `<path d="M36 63 C36 80 120 80 120 63" fill="none" stroke="#5b6470" stroke-width="9" stroke-linecap="round"/><path d="M36 63 C36 80 120 80 120 63" fill="none" stroke="#8b95a1" stroke-width="7" stroke-linecap="round"/>`;
  if (cut.length) s += '<path class="nt-th-cut" d="M73 71 l10 6 M83 71 l-10 6"/>';
  s += `<text class="nt-th-tx" x="36" y="9">A · ${esc(endLabel(a))}</text><text class="nt-th-tx" x="120" y="9">B · ${esc(endLabel(b))}</text>`;
  s += `<g>${thumbBody(a, 8, 13)}</g><g>${thumbBody(b, 92, 13)}</g></svg>`;
  return s;
}

/* ---------- Gros plan ---------- */
const VW = 640, VH = 572, CX = 320, PITCH = 36;
const PX = 156, PY = 44, PW = 328, PB = 300; // corps de la fiche : x, haut, largeur, bas
const CH_T = PY + 10, CH_B = 248; // canaux (les conducteurs vont jusqu'au bout, sous les lames)
const JY = 478; // sortie de la gaine
const REST_Y = 396; // bout des conducteurs libres
const TRAY = ['wbl', 'bl', 'wo', 'o', 'wg', 'g', 'wbr', 'br']; // ordre de sortie de la gaine : paires 1 à 4, sans indice
const slotX = i => CX + (i - 3.5) * PITCH;
const exitX = k => CX - 26.25 + k * 7.5;
const restX = k => 62 + k * 73.7;

/** Conducteur libre, rangé ou tiré : tracé de la gaine jusqu'à son bout. */
function wirePath(k, to) {
  const ex = exitX(k);
  if (to.slot != null) {
    const sx = slotX(to.slot);
    return `M${ex} ${JY} C${ex} ${JY - 80} ${sx} ${PB + 90} ${sx} ${PB - 4} L${sx} ${CH_T + 8}`;
  }
  const { x, y } = to;
  if (to.free) return `M${ex} ${JY} C${ex} ${JY - 70} ${x} ${y + 80} ${x} ${y}`;
  return `M${ex} ${JY} C${ex} ${JY - 46} ${x} ${y + 56} ${x} ${y + 20} L${x} ${y}`;
}
function wireSvg(w, d, cls, label, tab) {
  const W = WIRES[w];
  let s = `<g class="nt-w${cls}" data-w="${w}" tabindex="${tab}" role="button" aria-label="${esc(label)}"><title>${esc(wireName(w))}</title>`;
  s += `<path class="nt-halo" d="${d}"/><path d="${d}" stroke="${EDGE}" stroke-opacity=".55" stroke-width="20"/>`;
  s += `<path d="${d}" stroke="${W.stripe ? WHITE : W.color}" stroke-width="17"/>`;
  if (W.stripe) s += `<path class="nt-stripe" d="${d}" stroke="${W.color}" stroke-width="17" stroke-dasharray="6 9"/>`;
  s += `<path d="${d}" stroke="#ffffff" stroke-opacity=".28" stroke-width="3.5" transform="translate(-4 0)"/>`;
  return s + `<path class="nt-hit" d="${d}"/></g>`;
}

/** Verdict d'une extrémité sertie : { cls, head, items }. */
export function crimpVerdict(order, detail = true) {
  const k0 = stdOf({ order });
  if (k0) return { cls: 'nt-ok', ok: true, head: k0 === 'B' ? tl('Conforme à T568B') : tl('Conforme à T568A'), items: [] };
  const missing = []; order.forEach((w, i) => { if (!w) missing.push(i + 1); });
  if (missing.length === 8) return { cls: 'nt-bad', ok: false, head: tl('Fiche vide : les huit broches sont ouvertes'), items: [] };
  const diff = k => STD[k].reduce((n, w, i) => n + (order[i] && order[i] !== w ? 1 : 0), 0);
  const k = diff('B') <= diff('A') ? 'B' : 'A', wrong = [];
  order.forEach((w, i) => { if (w && w !== STD[k][i]) wrong.push(i + 1); });
  const parts = [];
  if (wrong.length) parts.push(wrong.length === 1 ? tl('une broche différente de T568{0}', k) : tl('{0} broches différentes de T568{1}', wrong.length, k));
  if (missing.length) parts.push(missing.length === 1 ? tl('broche {0} ouverte', missing[0]) : tl('broches {0} ouvertes', listJoin(missing)));
  const items = [];
  if (detail) for (const p of wrong) items.push(tl('Broche {0} : {1} (T568{2} attend {3})', p, wireName(order[p - 1]), k, wireName(STD[k][p - 1])));
  if (missing.length) items.push(tl('Ouvert : {0} (aucun conducteur)', pinsTx(missing)));
  return { cls: 'nt-bad', ok: false, head: tl('Ordre non normalisé : {0}', parts.join(isEn ? '; ' : ' ; ')), items };
}

function refCard() {
  let rows = '';
  for (let i = 0; i < 8; i++) rows += `<tr><td>${i + 1}</td><td><span>${swatch(T568A[i], 20, 11)}${esc(wireName(T568A[i]))}</span></td><td><span>${swatch(T568B[i], 20, 11)}${esc(wireName(T568B[i]))}</span></td></tr>`;
  return `<table><thead><tr><th>${esc(tl('Broche'))}</th><th>T568A</th><th>T568B</th></tr></thead><tbody>${rows}</tbody></table>`
    + `<p>${esc(tl('Paires : 1-2, 3-6, 4-5, 7-8. Câble droit : la même norme aux deux bouts (T568B le plus souvent).'))}</p>`;
}

/** Fenêtre commune (sertissage, testeur) posée sur `host`. Rend { ov, dlg, close }. */
export function overlay(host, { label, cls = '' }) {
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const back = document.activeElement;
  const ov = document.createElement('div');
  ov.className = 'nt-ov' + (cls ? ' ' + cls : '');
  ov.innerHTML = `<div class="nt-dlg" role="dialog" aria-modal="true" tabindex="-1" aria-label="${esc(label)}"></div>`;
  host.appendChild(ov);
  const dlg = ov.firstChild;
  let open = true;
  const close = () => {
    if (!open) return; open = false; ov.remove();
    if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
  };
  return { ov, dlg, close, isOpen: () => open };
}

/**
 * Ouvre l'atelier de sertissage.
 * end : { order: [8 conducteurs ou null], crimped, shorts } (non modifié : onDone reçoit une copie).
 * Rend { close() }.
 */
export function openCrimp({ host, end, title, side, showStandard = true, onDone, onCancel } = {}) {
  const src = end || {};
  const order = new Array(8).fill(null), seen = new Set();
  (Array.isArray(src.order) ? src.order : []).slice(0, 8).forEach((w, i) => { if (WIRES[w] && !seen.has(w)) { seen.add(w); order[i] = w; } });
  const st = { order, crimped: !!src.crimped, shorts: (Array.isArray(src.shorts) ? src.shorts : []).map(s => s.slice()), sel: null, drag: null, tgt: -1, ref: showStandard, pressing: false };
  const heading = title || tl('Sertir une fiche RJ45');
  const sub = side ? tl('Extrémité {0}', side) : '';
  const O = overlay(host, { label: heading + (sub ? ' — ' + sub : '') });
  const { dlg } = O;
  dlg.innerHTML = `<div class="nt-hd">${icon('cable')}<div class="nt-ttl"><b>${esc(heading)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>
    <button class="nt-x" data-act="cancel" aria-label="${esc(tl('Fermer'))}" title="${esc(tl('Fermer'))}">${icon('x')}</button></div>
  <div class="nt-body">
    <div class="nt-stage">
      <div class="nt-cap">${icon('info')}<span>${esc(tl('Vue de dessus : languette en dessous, broche 1 à gauche'))}</span></div>
      <svg class="nt-svg" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid meet">
        <g class="nt-static"></g><g class="nt-chans"></g><g class="nt-wires"></g><g class="nt-top"></g><g class="nt-slots"></g>
      </svg>
    </div>
    <div class="nt-side">
      <ol class="nt-steps">
        <li>${esc(tl('Choisissez un conducteur : cliquez dessus ou faites-le glisser.'))}</li>
        <li>${esc(tl('Déposez-le dans une broche : cliquez sur la broche, relâchez dessus, ou tapez son numéro (1 à 8).'))}</li>
        <li>${esc(tl('Quand les huit sont en place, sertissez la fiche.'))}</li>
      </ol>
      <div class="nt-status" aria-live="polite"></div>
      <div class="nt-verdict" role="status"></div>
      ${showStandard ? `<button class="btn small nt-refbtn" data-act="ref" aria-expanded="true">${icon('book')}<span></span></button><div class="nt-ref"></div>` : ''}
    </div>
  </div>
  <div class="nt-ft">
    <button class="btn" data-act="clear">${icon('trash')}<span>${esc(tl('Vider la fiche'))}</span></button>
    <button class="btn primary" data-act="crimp">${icon('shrink')}<span>${esc(tl('Sertir'))}</span></button>
    <button class="btn danger" data-act="cut">${icon('scissors')}<span>${esc(tl('Couper la fiche'))}</span></button>
    <span class="nt-sp"></span>
    <button class="btn" data-act="cancel">${esc(CANCEL)}</button>
    <button class="btn" data-act="done">${icon('check')}<span>${esc(tl('Terminé'))}</span></button>
  </div>`;
  const $ = s => dlg.querySelector(s);
  const svg = $('.nt-svg'), gChan = $('.nt-chans'), gWires = $('.nt-wires'), gTop = $('.nt-top'), gSlots = $('.nt-slots');
  if (showStandard) $('.nt-ref').innerHTML = refCard();

  // Décor fixe : languette (en pointillé, sous la fiche), corps transparent, gaine, légendes.
  $('.nt-static').innerHTML = `
    <path class="nt-clip" d="M${CX - 64} ${PY + 14} h128 v150 l-30 34 h-68 l-30 -34 z"/>
    <rect class="nt-pbody" x="${PX}" y="${PY}" width="${PW}" height="${PB - PY}" rx="14"/>
    <path class="nt-pshine" d="M${PX + 10} ${PB - 18} V${PY + 18} q0 -8 8 -8 H${PX + PW - 30}"/>
    <rect class="nt-jacket" x="${CX - 36}" y="${JY - 4}" width="72" height="${VH - JY + 10}" rx="6"/>
    <ellipse class="nt-jacket-cut" cx="${CX}" cy="${JY - 2}" rx="36" ry="7"/>
    <path class="nt-lead" d="M${PX - 8} ${PY + 26} H${PX + 26}"/><text class="nt-lbl" x="${PX - 12}" y="${PY + 30}" text-anchor="end">${esc(tl('contacts'))}</text>
    <path class="nt-lead" d="M${CX + 66} ${PY + 140} H${PX + PW + 8}"/><text class="nt-lbl" x="${PX + PW + 12}" y="${PY + 136}">${esc(tl('languette'))}</text><text class="nt-lbl" x="${PX + PW + 12}" y="${PY + 152}">${esc(tl('(en dessous)'))}</text>
    <text class="nt-lbl" x="${CX + 48}" y="${VH - 30}">${esc(tl('gaine du câble'))}</text>`;
  // Lames dorées, coin de serrage, numéros, mâchoire de la pince (animation), pastille « serti ».
  let top = `<rect class="nt-jaw" x="${PX - 14}" y="${PY - 24}" width="${PW + 28}" height="40" rx="8"/>`;
  for (let i = 0; i < 8; i++) top += `<rect class="nt-blade" x="${slotX(i) - 9}" y="${PY + 6}" width="18" height="44" rx="2"/>`;
  top += `<rect class="nt-wedge" x="${PX + 30}" y="${CH_B + 12}" width="${PW - 60}" height="22" rx="4"/>`;
  for (let i = 0; i < 8; i++) top += `<text class="nt-num${i === 0 ? ' nt-one' : ''}" x="${slotX(i)}" y="${PY - 18}">${i + 1}</text>`;
  top += `<g class="nt-seal"><rect x="${PX + PW + 14}" y="${PY + 196}" width="92" height="26" rx="13"/><text class="nt-sealtx" x="${PX + PW + 60}" y="${PY + 209}">${esc(tl('Sertie'))}</text></g>`;
  gTop.innerHTML = top;

  const slotOf = w => st.order.indexOf(w);
  const placed = () => st.order.filter(Boolean).length;
  const locked = () => st.crimped || st.pressing;
  const pt = e => { const m = svg.getScreenCTM(); if (!m) return { x: 0, y: 0 }; const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()); return { x: p.x, y: p.y }; };
  const slotAt = ({ x, y }) => {
    if (y < PY - 40 || y > PB + 40 || x < PX - 10 || x > PX + PW + 10) return -1;
    const i = Math.round((x - CX) / PITCH + 3.5);
    return i >= 0 && i < 8 && Math.abs(x - slotX(i)) <= PITCH / 2 + 2 ? i : -1;
  };
  const insidePlug = ({ x, y }) => x >= PX - 10 && x <= PX + PW + 10 && y >= PY - 40 && y <= PB + 40;
  let live = '';
  const say = s => { live = s; };

  function renderSvg() {
    svg.classList.toggle('nt-armed', !!st.sel && !locked());
    svg.classList.toggle('nt-locked', locked());
    svg.classList.toggle('nt-crimped', st.crimped);
    let ch = '';
    for (let i = 0; i < 8; i++) ch += `<rect class="nt-chan${st.order[i] ? ' nt-full' : ''}${st.tgt === i ? ' nt-tgt' : ''}" x="${slotX(i) - 14}" y="${CH_T}" width="28" height="${CH_B - CH_T}" rx="5"/>`;
    gChan.innerHTML = ch;
    // Conducteurs : d'abord ceux de la fiche, puis ceux qui restent dehors (leur bout reste toujours cliquable), enfin
    // celui qu'on tire (au-dessus de tout).
    const tab = locked() ? -1 : 0;
    const items = TRAY.map((w, k) => {
      const at = slotOf(w), sel = st.sel === w, drag = st.drag && st.drag.w === w;
      const to = drag ? { x: st.drag.x, y: st.drag.y, free: true } : at >= 0 ? { slot: at } : { x: restX(k), y: REST_Y - (sel ? 16 : 0) };
      const label = at >= 0 ? tl('{0}, dans la broche {1}', wireName(w), at + 1) : tl('{0}, hors de la fiche', wireName(w));
      return { z: drag ? 2 : at >= 0 ? 0 : 1, s: wireSvg(w, wirePath(k, to), (sel ? ' nt-sel' : '') + (drag ? ' nt-drag' : ''), label, tab) };
    });
    gWires.innerHTML = [0, 1, 2].map(z => items.filter(x => x.z === z).map(x => x.s).join('')).join('');
    // Cibles des broches, au-dessus des conducteurs : cliquer une broche occupée la choisit ou y dépose la sélection.
    let sl = '';
    for (let i = 0; i < 8; i++) {
      const w = st.order[i];
      sl += `<rect class="nt-slot" data-slot="${i}" tabindex="${tab}" role="button" aria-label="${esc(tl('Broche {0} : {1}', i + 1, wireName(w)))}" x="${slotX(i) - PITCH / 2 + 1}" y="${PY - 36}" width="${PITCH - 2}" height="${PB - PY + 36}" rx="6"/>`;
    }
    gSlots.innerHTML = sl;
  }
  function renderSide() {
    const n = placed();
    let s = `<div class="nt-count"><span>${esc(tl('{0} / 8 conducteurs en place', n))}</span><span class="nt-meter"><i style="width:${n * 12.5}%"></i></span></div>`;
    if (st.crimped) s += `<div class="nt-hint">${esc(tl('Fiche sertie : coupez-la pour recommencer.'))}</div>`;
    else if (st.sel) {
      const at = slotOf(st.sel);
      s += `<div class="nt-selrow">${swatch(st.sel)}<span>${esc(tl('Choisi :'))} <b>${esc(wireName(st.sel))}</b></span>${at >= 0 ? `<button class="btn small" data-act="remove">${icon('x')}<span>${esc(tl('Retirer'))}</span></button>` : ''}</div>`;
      s += `<div class="nt-hint">${esc(at >= 0 ? tl('Cliquez une autre broche pour le déplacer, ou Retirer.') : tl('Cliquez une broche ou tapez son numéro (1 à 8).'))}</div>`;
    } else s += `<div class="nt-hint">${esc(n === 8 ? tl('Tout est en place : vérifiez l\'ordre, puis sertissez.') : tl('Aucun conducteur choisi.'))}</div>`;
    if (live) s += `<div class="nt-hint" aria-live="polite">${esc(live)}</div>`;
    $('.nt-status').innerHTML = s;
    const v = $('.nt-verdict');
    if (st.crimped && !(showStandard && st.ref)) {
      // Carte des normes cachée (mode examen : showStandard faux, ou l'élève l'a repliée) : pas de verdict non plus,
      // il dirait la norme à sa place.
      v.className = 'nt-verdict nt-novd';
      v.innerHTML = `<div class="nt-vh">${icon('info')}<span>${esc(showStandard ? tl('Fiche sertie : affichez les normes pour voir le verdict.') : tl('Fiche sertie : pas de verdict en mode examen.'))}</span></div>`;
    } else if (st.crimped) {
      const r = crimpVerdict(st.order);
      v.className = 'nt-verdict ' + r.cls;
      v.innerHTML = `<div class="nt-vh">${icon(r.ok ? 'check' : 'alert')}<span>${esc(r.head)}</span></div>${r.items.length ? `<ul>${r.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
    } else { v.className = 'nt-verdict'; v.innerHTML = ''; }
    if (showStandard) {
      const b = $('[data-act="ref"]');
      b.setAttribute('aria-expanded', String(st.ref));
      b.querySelector('span').textContent = st.ref ? tl('Masquer les normes') : tl('Normes T568A / T568B');
      $('.nt-ref').hidden = !st.ref;
    }
    $('[data-act="crimp"]').hidden = st.crimped;
    $('[data-act="crimp"]').disabled = st.pressing;
    $('[data-act="cut"]').hidden = !st.crimped;
    $('[data-act="clear"]').disabled = locked() || !placed();
    $('[data-act="done"]').classList.toggle('primary', st.crimped);
  }
  function render() {
    const a = document.activeElement, key = a && dlg.contains(a) ? (a.dataset.w ? `[data-w="${a.dataset.w}"]` : a.dataset.slot != null ? `[data-slot="${a.dataset.slot}"]` : a.dataset.act ? `[data-act="${a.dataset.act}"]` : null) : null;
    renderSvg(); renderSide();
    if (key) { const n = dlg.querySelector(key); if (n && n !== a && !n.hidden && n.getAttribute('tabindex') !== '-1') n.focus({ preventScroll: true }); }
  }

  function place(w, i) {
    if (locked() || !WIRES[w] || i < 0 || i > 7) return;
    const from = slotOf(w), occ = st.order[i];
    if (occ === w) { st.sel = null; render(); return; }
    if (from >= 0) st.order[from] = occ; // échange : l'occupant prend la place libérée
    st.order[i] = w; st.sel = null;
    say(occ && from < 0 ? tl('{0} dans la broche {1} ; {2} ressort de la fiche.', wireName(w), i + 1, wireName(occ)) : tl('{0} dans la broche {1}.', wireName(w), i + 1));
    render();
  }
  function remove(w) {
    const at = slotOf(w);
    if (locked() || at < 0) return;
    st.order[at] = null; st.sel = null; say(tl('{0} retiré de la broche {1}.', wireName(w), at + 1)); render();
  }
  function clickWire(w) {
    if (locked()) return;
    const at = slotOf(w);
    if (st.sel && st.sel !== w && at >= 0) return place(st.sel, at);
    st.sel = st.sel === w ? null : w; say(''); render();
  }
  function clickSlot(i) {
    if (locked()) return;
    if (st.sel) return place(st.sel, i);
    if (st.order[i]) { st.sel = st.order[i]; say(''); render(); }
  }
  function crimp() {
    if (locked()) return;
    st.pressing = true; st.sel = null; say('');
    svg.classList.add('nt-pressing'); render();
    const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 200 : 800;
    setTimeout(() => { st.crimped = true; render(); }, ms * .5);
    setTimeout(() => { st.pressing = false; svg.classList.remove('nt-pressing'); render(); const d = $('[data-act="done"]'); if (O.isOpen() && d) d.focus({ preventScroll: true }); }, ms);
  }
  function cut() {
    if (!st.crimped || st.pressing) return;
    st.crimped = false; st.order = new Array(8).fill(null); st.shorts = []; st.sel = null;
    say(tl('Fiche coupée : les conducteurs sont libres, recommencez.')); render();
  }
  const result = () => ({ order: st.order.slice(), crimped: st.crimped, shorts: st.shorts.map(s => s.slice()) });
  function finish(ok) {
    if (!O.isOpen()) return;
    O.close();
    if (ok) { if (onDone) onDone(result()); } else if (onCancel) onCancel();
  }

  dlg.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === 'cancel') finish(false);
    else if (a === 'done') finish(true);
    else if (a === 'clear') { if (!locked()) { st.order.fill(null); st.sel = null; say(tl('Fiche vidée.')); render(); } }
    else if (a === 'crimp') crimp();
    else if (a === 'cut') cut();
    else if (a === 'ref') { st.ref = !st.ref; render(); }
    else if (a === 'remove' && st.sel) remove(st.sel);
  });

  // Souris et doigt : un geste court est un clic, un geste plus long tire le conducteur.
  let down = null;
  svg.addEventListener('pointerdown', e => {
    if (e.button > 0 || locked()) return;
    const wEl = e.target.closest('[data-w]'), sEl = e.target.closest('[data-slot]');
    const slot = sEl ? +sEl.dataset.slot : -1, w = wEl ? wEl.dataset.w : slot >= 0 ? st.order[slot] : null;
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, w, slot, wire: !!wEl, moved: false };
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* capture refusée */ }
    e.preventDefault();
  });
  svg.addEventListener('pointermove', e => {
    if (!down || e.pointerId !== down.id) return;
    if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return;
    if (!down.w) return;
    down.moved = true;
    const p = pt(e), t = slotAt(p);
    st.drag = { w: down.w, x: p.x, y: p.y }; st.tgt = t;
    renderSvg();
  });
  const up = e => {
    if (!down || e.pointerId !== down.id) return;
    const d = down; down = null;
    try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* déjà relâchée */ }
    if (d.moved && st.drag) {
      const p = pt(e), t = e.type === 'pointercancel' ? -1 : slotAt(p);
      st.drag = null; st.tgt = -1;
      if (t >= 0) place(d.w, t);
      else if (e.type !== 'pointercancel' && slotOf(d.w) >= 0 && !insidePlug(p)) remove(d.w);
      else render();
      return;
    }
    if (e.type === 'pointercancel') return;
    if (d.wire) clickWire(d.w);
    else if (d.slot >= 0) clickSlot(d.slot);
    else if (st.sel) { st.sel = null; render(); }
  };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);

  // Clavier : rien ne remonte vers l'application (Suppr y effacerait un appareil, les chiffres changeraient d'outil).
  O.ov.addEventListener('keydown', e => {
    e.stopPropagation();
    const k = e.key, t = e.target;
    if (k === 'Escape') { e.preventDefault(); if (st.sel) { st.sel = null; render(); } else finish(false); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-8]$/.test(k)) {
      e.preventDefault();
      if (st.sel && !locked()) place(st.sel, +k - 1);
      else { const n = gSlots.querySelector(`[data-slot="${+k - 1}"]`); if (n && !locked()) n.focus(); }
      return;
    }
    if ((k === 'Delete' || k === 'Backspace') && st.sel && slotOf(st.sel) >= 0) { e.preventDefault(); remove(st.sel); return; }
    if ((k === 'Enter' || k === ' ') && t && t.closest && !t.closest('button')) {
      const wEl = t.closest('[data-w]'), sEl = t.closest('[data-slot]');
      if (wEl) { e.preventDefault(); clickWire(wEl.dataset.w); } else if (sEl) { e.preventDefault(); clickSlot(+sEl.dataset.slot); }
    }
  });
  O.ov.addEventListener('pointerdown', e => { if (e.target === O.ov) e.preventDefault(); });

  render();
  const first = gWires.querySelector('[data-w][tabindex="0"]') || $('[data-act="done"]');
  (first || dlg).focus({ preventScroll: true });
  return { close: () => finish(false) };
}
