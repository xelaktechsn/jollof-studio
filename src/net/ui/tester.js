// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Testeur de câble réseau, comme ceux des ateliers : un boîtier maître et un bouchon distant, chacun avec ses voyants 1
// à 8 et G. Le maître envoie sur les broches 1 à 8 tour à tour, le distant allume celles qui reçoivent (carte de câblage
// de src/net/cable.js : analyzeChain(segments).leds), en boucle. Sous les boîtiers : le résultat, avec le nom des défauts.
// Deux modes : « Continuité » (testeur simple : une paire séparée passe, il ne voit que broche à broche) et
// « Qualification » (carte de câblage dessinée, paires torsadées vérifiées : la paire séparée apparaît, avec la raison :
// la continuité est bonne mais la diaphonie fait perdre des trames).
// segments : les câbles posés bout à bout à travers des prises passives (prise murale, panneau de brassage) ; un câble
// seul = [câble].
import { tl } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { WIRES, PIN_PAIRS, analyzeChain } from '../cable.js';
import { overlay, listJoin } from './crimp.js';
import './crimp.css';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pairTx = pins => `${pins[0]}-${pins[1]}`;
const pinsTx = a => (a.length === 1 ? tl('broche {0}', a[0]) : tl('broches {0}', listJoin(a)));
const STEP_MS = 650;

/** Extrémités de la chaîne vues du maître : début et fin, dans le sens du parcours. */
function chainEnds(segments) {
  const f = segments[0], l = segments[segments.length - 1];
  return [f && (f.flip ? f.b : f.a), l && (l.flip ? l.a : l.b)];
}

/**
 * Résultat lisible d'une analyse : { pass, items: [{ label, why }], note }.
 * mode 'continuity' : un testeur simple, qui ignore les paires séparées ; 'qualification' : tout.
 */
export function testerReport(segments, mode = 'continuity', names = {}) {
  const r = analyzeChain(segments);
  const items = [];
  if (!segments.length) return { r, pass: false, items: [{ label: tl('Aucun câble'), why: tl('Branchez un câble entre les deux boîtiers.') }], note: '' };
  if (r.kind === 'none') {
    // Quelles fiches ne sont pas serties ? Début et fin de chaîne nommés, les autres « à une prise ».
    const where = [];
    segments.forEach((s, i) => {
      const A = s.flip ? s.b : s.a, B = s.flip ? s.a : s.b;
      if (!(A && A.crimped)) where.push(i === 0 ? (names.a || tl('côté maître')) : tl('prise {0}', i));
      if (!(B && B.crimped)) where.push(i === segments.length - 1 ? (names.b || tl('côté distant')) : tl('prise {0}', i + 1));
    });
    items.push({ label: tl('Fiche non sertie') + (where.length ? ' : ' + where.join(', ') : ''), why: tl('Sans sertissage, les lames ne percent pas l\'isolant : aucun contact, aucun voyant ne s\'allume en face.') });
    return { r, pass: false, items, note: '' };
  }
  const faults = r.faults.filter(f => mode === 'qualification' || f.type !== 'split');
  const [e0, e1] = r.ends;
  if (!faults.length) {
    if (r.kind === 'straight') {
      const label = e0 && e0 === e1 ? (e0 === 'B' ? tl('Câble droit conforme (T568B des deux côtés)') : tl('Câble droit conforme (T568A des deux côtés)')) : tl('Câble droit : continuité correcte');
      items.push({ label, why: tl('Chaque broche arrive sur la même broche en face (1 sur 1… 8 sur 8) : le câble qui relie un ordinateur à un switch.') });
    } else if (r.kind === 'crossover') {
      items.push({ label: tl('Câble croisé') + (e0 && e1 && e0 !== e1 ? ' ' + tl('(T568A d\'un côté, T568B de l\'autre)') : ''), why: tl('Les paires 1-2 et 3-6 sont croisées (1 sur 3, 2 sur 6) : ancien câble pour relier deux ordinateurs ou deux switchs. Les ports Auto-MDIX acceptent aussi un câble droit.') });
    } else if (r.kind === 'crossover-full') {
      items.push({ label: tl('Câble croisé (les quatre paires)'), why: tl('Les quatre paires sont croisées, comme le demande le gigabit (1000BASE-T) pour un câble croisé.') });
    }
  } else {
    const crossed = [], split = [];
    for (const f of faults) {
      if (f.type === 'open') items.push({ label: tl('Ouvert : {0}', pinsTx(f.pins)), why: tl('Le conducteur n\'arrive pas en face : absent de la fiche, mal enfoncé jusqu\'aux contacts ou coupé dans le câble.') });
      else if (f.type === 'short') items.push({ label: tl('Court-circuit : {0}', pinsTx(f.pins)), why: tl('Ces broches sont reliées entre elles : plusieurs voyants s\'allument ensemble en face (conducteurs écrasés ou dénudés au sertissage).') });
      else if (f.type === 'reversed' && f.pins.length > 2) items.push({ label: tl('Câble retourné (1 sur 8, 2 sur 7…)'), why: tl('L\'ordre est inversé d\'un bout à l\'autre : une fiche a été sertie à l\'envers (broche 1 à droite).') });
      else if (f.type === 'reversed') items.push({ label: tl('Paire inversée : {0}', pairTx(f.pins)), why: tl('Les deux conducteurs de cette paire sont échangés à un bout : les voyants {0} s\'allument dans l\'ordre {1}.', listJoin(f.pins), listJoin(f.pins.slice().reverse())) });
      else if (f.type === 'crossed') { for (let i = 0; i < f.pins.length; i += 2) { const t = pairTx(f.pins.slice(i, i + 2)); if (!crossed.includes(t)) crossed.push(t); } }
      else if (f.type === 'split') { for (let i = 0; i < f.pins.length; i += 2) split.push(pairTx(f.pins.slice(i, i + 2))); }
      else if (f.type === 'miswire') items.push({ label: tl('Câblage mélangé : paire {0}', pairTx(f.pins)), why: tl('Les conducteurs de cette paire arrivent sur deux paires différentes en face : vérifiez l\'ordre des couleurs aux deux fiches.') });
    }
    if (crossed.length) items.push({ label: tl('Paires croisées : {0}', listJoin(crossed)), why: tl('Ces paires changent de place d\'un bout à l\'autre : souvent une fiche en T568A et l\'autre en T568B sans le vouloir, ou un croisé mal fait.') });
    if (split.length) items.push({ label: split.length === 1 ? tl('Paire séparée {0}', split[0]) : tl('Paires séparées {0}', listJoin(split)), why: tl('La continuité est bonne broche à broche, mais ces broches ne portent pas les deux conducteurs d\'une même paire torsadée. La torsade ne protège plus le signal : la diaphonie (NEXT) fait perdre des trames, surtout à 100 Mbit/s et au-delà. Refaites les fiches dans l\'ordre T568B.') });
  }
  const pass = !faults.length;
  let note = '';
  if (mode === 'continuity') note = tl('Ce testeur ne vérifie que la continuité broche à broche : il ne voit pas une paire séparée. Passez en mode Qualification pour contrôler les paires torsadées.');
  return { r, pass, items, note };
}

/* ---------- Boîtiers (SVG) ---------- */
const DW = 900, DH = 206;
const UNIT = { w: 252, h: 150, y: 14 };
const MX = 14, RX = DW - 14 - UNIT.w; // maître à gauche, distant à droite
const PORT_Y = UNIT.y + 84;
const ledX = (ux, i) => ux + 32 + i * 23.5;
const LED_Y = UNIT.y + 80;

function unitSvg(ux, label, lit, portRight) {
  let s = `<rect x="${ux}" y="${UNIT.y}" width="${UNIT.w}" height="${UNIT.h}" rx="18" fill="#1f2630" stroke="#475263" stroke-width="2"/>`;
  s += `<path d="M${ux} ${UNIT.y + 18} a18 18 0 0 1 18 -18 h${UNIT.w - 36} a18 18 0 0 1 18 18 v22 h-${UNIT.w} z" fill="#facc15"/>`;
  s += `<text x="${ux + UNIT.w / 2}" y="${UNIT.y + 27}" fill="#1f2630" font-size="15" font-weight="800" text-anchor="middle" letter-spacing="1.5">${esc(label.toUpperCase())}</text>`;
  s += `<rect x="${ux + 16}" y="${UNIT.y + 54}" width="${UNIT.w - 32}" height="62" rx="9" fill="#141a21" stroke="#323c49"/>`;
  for (let i = 0; i < 9; i++) {
    const x = ledX(ux, i), on = lit.has(i + 1);
    if (on) s += `<circle cx="${x}" cy="${LED_Y}" r="13" fill="#4ade80" opacity=".28"/>`;
    s += `<circle cx="${x}" cy="${LED_Y}" r="7.5" fill="${on ? '#86efac' : '#22352b'}" stroke="${on ? '#bbf7d0' : '#3a4a40'}" stroke-width="1.5"/>`;
    s += `<text x="${x}" y="${LED_Y + 25}" fill="#cbd5e1" font-size="12" font-weight="600" text-anchor="middle" font-family="var(--mono)">${i < 8 ? i + 1 : 'G'}</text>`;
  }
  s += `<text x="${ux + UNIT.w / 2}" y="${UNIT.y + 137}" fill="#8b98a8" font-size="10.5" letter-spacing="2" text-anchor="middle">LAN · RJ45</text>`;
  const px = portRight ? ux + UNIT.w - 2 : ux - 24;
  s += `<rect x="${px}" y="${PORT_Y - 22}" width="26" height="44" rx="4" fill="#0b0f14" stroke="#64748b" stroke-width="1.5"/>`;
  return s;
}

function deviceSvg(segments, names, step, leds) {
  const masterLit = new Set([step + 1]); // étape 8 = G
  const remoteLit = new Set(step < 8 ? leds[step + 1] || [] : []);
  const x0 = MX + UNIT.w + 24, x1 = RX - 24, n = Math.max(1, segments.length);
  let s = `<svg class="nt-dev" viewBox="0 0 ${DW} ${DH}" role="img" aria-label="${esc(tl('Testeur : le maître envoie sur la broche {0}', step < 8 ? step + 1 : 'G'))}">`;
  // Câble (et prises intermédiaires d'un lien à travers une prise murale ou un panneau de brassage).
  const d = `M${x0} ${PORT_Y} C${x0 + 70} ${PORT_Y + 60} ${x1 - 70} ${PORT_Y + 60} ${x1} ${PORT_Y}`;
  s += `<path d="${d}" fill="none" stroke="#5b6470" stroke-width="13" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#8b95a1" stroke-width="10" stroke-linecap="round"/>`;
  for (let j = 1; j < n; j++) {
    const t = j / n, mt = 1 - t;
    const cx = mt ** 3 * x0 + 3 * mt * mt * t * (x0 + 70) + 3 * mt * t * t * (x1 - 70) + t ** 3 * x1;
    const cy = mt ** 3 * PORT_Y + 3 * mt * mt * t * (PORT_Y + 60) + 3 * mt * t * t * (PORT_Y + 60) + t ** 3 * PORT_Y;
    s += `<rect class="nt-outlet" x="${cx - 20}" y="${cy - 22}" width="40" height="44" rx="6"/><rect x="${cx - 9}" y="${cy - 10}" width="18" height="20" rx="2" fill="#0b0f14"/>`;
    s += `<text class="nt-plbl" x="${cx}" y="${cy + 40}">${esc(tl('prise {0}', j))}</text>`;
  }
  // Fiches dans les prises des boîtiers.
  s += `<rect x="${x0 - 22}" y="${PORT_Y - 12}" width="26" height="24" rx="3" fill="#cbd5e1" fill-opacity=".85" stroke="#64748b"/><rect x="${x1 - 4}" y="${PORT_Y - 12}" width="26" height="24" rx="3" fill="#cbd5e1" fill-opacity=".85" stroke="#64748b"/>`;
  s += unitSvg(MX, tl('Maître'), masterLit, true) + unitSvg(RX, tl('Distant'), remoteLit, false);
  s += `<text class="nt-name" x="${MX + UNIT.w / 2}" y="${DH - 10}">${esc(names.a || tl('Côté A'))}</text><text class="nt-name" x="${RX + UNIT.w / 2}" y="${DH - 10}">${esc(names.b || tl('Côté B'))}</text>`;
  return s + '</svg>';
}

/* ---------- Carte de câblage (mode Qualification) ---------- */
function wireMapSvg(segments, r, names) {
  const [E0] = chainEnds(segments), W = 340, H = 250, LX = 104, RXm = 236, y = p => 38 + (p - 1) * 25;
  const order = E0 && Array.isArray(E0.order) ? E0.order : [];
  const splitPairs = new Set(r.pairs.map((x, k) => (x.split ? k : -1)).filter(k => k >= 0));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tl('Carte de câblage'))}">`;
  s += `<text class="nt-mhead" x="${LX}" y="14">${esc(names.a || tl('Côté A'))}</text><text class="nt-mhead" x="${RXm}" y="14">${esc(names.b || tl('Côté B'))}</text>`;
  // Paires torsadées du début : 1-2, 3-6, 4-5, 7-8 (accolades à gauche ; rouge = paire séparée).
  PIN_PAIRS.forEach(([p, q], k) => {
    const off = [16, 44, 30, 16][k], x = LX - 22, sp = splitPairs.has(k);
    s += `<path class="nt-mpair${sp ? ' nt-msplit' : ''}" d="M${x} ${y(p)} C${x - off} ${y(p)} ${x - off} ${y(q)} ${x} ${y(q)}"/>`;
  });
  if (splitPairs.size) s += `<path class="nt-mpair nt-msplit" d="M${LX - 40} ${H - 8} h22"/><text class="nt-mleg" x="${LX - 12}" y="${H - 4}">${esc(tl('paire séparée (torsade rompue)'))}</text>`;
  for (let p = 1; p <= 8; p++) {
    const w = order[p - 1], Wd = WIRES[w], to = r.leds[p] || [];
    const col = Wd ? Wd.color : '#94a3b8';
    if (!to.length) {
      s += `<path class="nt-mline" d="M${LX} ${y(p)} H${LX + 40}" stroke="${col}" stroke-width="4"/>`;
      s += `<path class="nt-mopen" d="M${LX + 46} ${y(p) - 6} l10 12 M${LX + 56} ${y(p) - 6} l-10 12"/>`;
    }
    for (const q of to) {
      const d = `M${LX} ${y(p)} C${LX + 60} ${y(p)} ${RXm - 60} ${y(q)} ${RXm} ${y(q)}`;
      s += `<path class="nt-mline" d="${d}" stroke="#0f172a" stroke-opacity=".4" stroke-width="6"/>`;
      s += `<path class="nt-mline" d="${d}" stroke="${Wd && Wd.stripe ? '#f8fafc' : col}" stroke-width="4.5"/>`;
      if (Wd && Wd.stripe) s += `<path class="nt-mline" d="${d}" stroke="${col}" stroke-width="4.5" stroke-dasharray="4 5" stroke-linecap="butt"/>`;
    }
  }
  const bad = new Set(r.faults.filter(f => f.type === 'short' || f.type === 'open').flatMap(f => f.pins));
  for (let p = 1; p <= 8; p++) {
    s += `<circle class="nt-mdot${bad.has(p) ? ' nt-mbad' : ''}" cx="${LX}" cy="${y(p)}" r="9"/><text class="nt-mpin" x="${LX}" y="${y(p)}">${p}</text>`;
    s += `<circle class="nt-mdot" cx="${RXm}" cy="${y(p)}" r="9"/><text class="nt-mpin" x="${RXm}" y="${y(p)}">${p}</text>`;
  }
  return s + '</svg>';
}

/**
 * Ouvre le testeur. segments : [câble] ou les câbles d'un lien bout à bout ; names : { a, b } (appareils ou prises aux
 * deux bouts) ; mode : 'continuity' (par défaut) ou 'qualification'. Rend { close(), update(segments) }.
 */
export function openTester({ host, segments = [], names = {}, mode = 'continuity', onClose } = {}) {
  const st = { segs: segments, mode: mode === 'qualification' ? 'qualification' : 'continuity', step: 0, play: true, rep: null };
  const O = overlay(host, { label: tl('Testeur de câble réseau') });
  const { dlg } = O;
  const sub = `${names.a || tl('Côté A')} ↔ ${names.b || tl('Côté B')}` + (segments.length > 1 ? ' · ' + tl('{0} câbles bout à bout', segments.length) : '');
  dlg.innerHTML = `<div class="nt-hd">${icon('activity')}<div class="nt-ttl"><b>${esc(tl('Testeur de câble réseau'))}</b><span>${esc(sub)}</span></div>
    <div class="nt-seg" role="group" aria-label="${esc(tl('Mode du testeur'))}">
      <button data-mode="continuity" title="${esc(tl('Testeur simple : broche à broche'))}">${esc(tl('Continuité'))}</button>
      <button data-mode="qualification" title="${esc(tl('Testeur qualifiant : carte de câblage et paires torsadées'))}">${esc(tl('Qualification'))}</button>
    </div>
    <button class="nt-x" data-act="close" aria-label="${esc(tl('Fermer'))}" title="${esc(tl('Fermer'))}">${icon('x')}</button></div>
  <div class="nt-tbody">
    <div class="nt-devwrap"></div>
    <div class="nt-steprow">
      <button class="btn small" data-act="play"></button>
      <button class="btn small" data-act="next">${icon('chevRight')}<span>${esc(tl('Broche suivante'))}</span></button>
      <div class="nt-step" aria-live="off"></div>
    </div>
    <div class="nt-low"><div class="nt-res" role="status"></div><div class="nt-map"></div></div>
  </div>`;
  const $ = s => dlg.querySelector(s);

  function stepText() {
    if (st.step === 8) return `<b>G</b> : ${esc(tl('blindage. Câble non blindé (U/UTP) : le voyant G du distant reste éteint, c\'est normal.'))}`;
    const p = st.step + 1, to = (st.rep.r.leds[p] || []);
    return esc(tl('Le maître envoie sur la broche {0}', p)) + ' → ' + (to.length ? esc(tl('le distant allume {0}', listJoin(to))) : `<b>${esc(tl('le distant n\'allume rien (ouvert)'))}</b>`);
  }
  function renderDevices() {
    $('.nt-devwrap').innerHTML = deviceSvg(st.segs, names, st.step, st.rep.r.leds);
    $('.nt-step').innerHTML = stepText();
  }
  function renderAll() {
    st.rep = testerReport(st.segs, st.mode, names);
    const rep = st.rep;
    dlg.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode)));
    const res = $('.nt-res');
    res.className = 'nt-res ' + (rep.pass ? 'nt-ok' : 'nt-bad');
    res.innerHTML = `<div class="nt-vh">${icon(rep.pass ? 'check' : 'alert')}<span>${esc(rep.pass ? tl('Test réussi') : tl('Test échoué'))}</span></div>`
      + `<ul>${rep.items.map(x => `<li><b>${esc(x.label)}</b><span>${esc(x.why)}</span></li>`).join('')}</ul>`
      + (rep.note ? `<p class="nt-note">${esc(rep.note)}</p>` : '');
    const q = st.mode === 'qualification';
    $('.nt-low').classList.toggle('nt-nomap', !q);
    $('.nt-map').hidden = !q;
    if (q) $('.nt-map').innerHTML = `<h4>${esc(tl('Carte de câblage'))}</h4>` + wireMapSvg(st.segs, rep.r, names);
    const pb = $('[data-act="play"]');
    pb.innerHTML = icon(st.play ? 'pause' : 'play') + `<span>${esc(st.play ? tl('Mettre en pause') : tl('Reprendre'))}</span>`;
    renderDevices();
  }
  let timer = null;
  const tick = () => { st.step = (st.step + 1) % 9; renderDevices(); };
  const setPlay = on => { st.play = on; clearInterval(timer); timer = on ? setInterval(() => { if (!O.isOpen()) return clearInterval(timer); tick(); }, STEP_MS) : null; renderAll(); };
  const finish = () => { if (!O.isOpen()) return; clearInterval(timer); O.close(); if (onClose) onClose(); };

  dlg.addEventListener('click', e => {
    const m = e.target.closest('[data-mode]');
    if (m) { st.mode = m.dataset.mode; renderAll(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'close') finish();
    else if (b.dataset.act === 'play') setPlay(!st.play);
    else if (b.dataset.act === 'next') { if (st.play) setPlay(false); tick(); }
  });
  O.ov.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
  });

  setPlay(true);
  dlg.focus({ preventScroll: true });
  return {
    close: finish,
    /** Nouveau câblage (le câble a été refait pendant que le testeur est ouvert). */
    update(segs) { st.segs = segs || []; renderAll(); }
  };
}
// Pour l'inspecteur : texte court du résultat (« Câble droit conforme… », « Ouvert : broche 7 »…).
export const testerSummary = (segments, mode = 'qualification') => testerReport(segments, mode).items.map(x => x.label).join(' ; ');
