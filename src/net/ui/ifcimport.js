// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Assistant d'import d'un modèle IFC (chargé à la demande) : openIfcImport(ctx, file?). Même allure que l'assistant
// DXF/DWG (cadimport.css). Étapes : 1 Fichier (lecture dans un worker, résumé : schéma, application d'origine, unités,
// entités, avertissements), 2 Étages (aperçu de chaque étage, étages à importer, bâtiment et étage de destination :
// existant ou nouveau), 3 Contenu et unités (unité détectée à confirmer, contrôle par la largeur des portes, objets à
// importer, remplacement d'un import précédent). Tout se termine par UN seul ctx.commit().
import './cadimport.css';
import './crimp.css';
import './ifcimport.css';
import { tl, isEn } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { overlay } from './crimp.js';
import { readIfc, applyIfc, scaleModel, ifcSummary } from '../interop/ifc.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = (v, d = 0) => (Number.isFinite(+v) ? (+v).toLocaleString(isEn ? 'en' : 'fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '—');
const bytesFmt = b => (b >= 1 << 20 ? tl('{0} Mo', nf(b / (1 << 20), 1)) : tl('{0} ko', nf(b / 1024, 0)));
const secs = ms => tl('{0} s', nf(ms / 1000, 1));
const STEPS = () => [['file', tl('Fichier')], ['storeys', tl('Étages')], ['content', tl('Contenu et unités')]];
/** Unités proposées (m par unité). */
const UNITS = () => [['auto', tl('Celle du fichier')], ['m', tl('mètres')], ['cm', tl('centimètres')], ['mm', tl('millimètres')], ['ft', tl('pieds')], ['in', tl('pouces')]];
const UNIT_M = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 };
/** Nom lisible d'une unité de longueur IFC (METRE, MILLIMETRE, FOOT…). */
const unitName = n => ({ METRE: tl('mètres'), MILLIMETRE: tl('millimètres'), CENTIMETRE: tl('centimètres'), DECIMETRE: tl('décimètres'), KILOMETRE: tl('kilomètres'), FOOT: tl('pieds'), INCH: tl('pouces') })[String(n).toUpperCase()] || String(n);
/** Textes des avertissements du lecteur (ifc.js). */
const WARN = () => ({
  schema: tl('Schéma non prévu : lu comme IFC4, sans garantie.'), noUnits: tl('Aucune unité de longueur déclarée : mètres supposés.'), noStorey: tl('Aucun étage (IfcBuildingStorey) dans le fichier.'),
  spaceBbox: tl('Pièces sans contour extrudé : rectangle englobant de leur géométrie.'), spaceNoGeom: tl('Pièces sans géométrie lisible : ignorées.'), wallNoGeom: tl('Murs sans axe ni corps lisible : ignorés.'),
  doorNoWall: tl('Portes sans mur trouvé : ignorées.'), grid: tl('Placements sur grille (IfcGridPlacement) non suivis : origine supposée.'), complex: tl('Instances complexes ignorées.')
});
const WHAT = () => [['rooms', tl('Salles'), 'spaces', 'room'], ['walls', tl('Murs'), 'walls', 'wall'], ['doors', tl('Portes'), 'doors', 'door'], ['devices', tl('Équipements et prises'), 'devices', 'switchNet'], ['paths', tl('Cheminements'), 'carriers', 'cableTray']];

/** Logiciel d'origine (FILE_NAME) : montré seulement s'il ressemble à un nom de logiciel (pas « hand written », vide…). */
const appName = s => { const t = String(s || '').trim(); return t.length >= 2 && !/^(hand[ -]?written|manual|unknown|none|n\/?a|-|\$)$/i.test(t) ? t.slice(0, 80) : ''; };
let LAST = null; // dernier modèle lu (outil de l'IA ifc_import_summary)
/** Résumé du dernier fichier IFC lu par l'assistant (ou null). */
export const lastIfcSummary = () => (LAST ? { file: LAST.name, ...ifcSummary(LAST.model) } : null);

/** Lit un fichier IFC dans un worker (repli : sur ce fil). */
function readInWorker(bytes, onProgress, signal) {
  return new Promise((resolve, reject) => {
    let w = null;
    try { w = new Worker(new URL('../interop/ifc.worker.js', import.meta.url), { type: 'module' }); } catch (e) { w = null; }
    if (!w) { try { resolve(readIfc(bytes)); } catch (e) { reject(e); } return; }
    const stop = () => { try { w.terminate(); } catch (e) { /* déjà fermé */ } };
    if (signal) signal.addEventListener('abort', () => { stop(); reject(new DOMException('aborted', 'AbortError')); });
    w.onmessage = e => { const d = e.data || {}; if (d.progress != null) onProgress(d.progress); else if (d.model) { stop(); resolve(d.model); } else if (d.error) { stop(); reject(new Error(d.error)); } };
    w.onerror = e => { stop(); try { resolve(readIfc(bytes)); } catch (err) { reject(err); } e.preventDefault && e.preventDefault(); };
    w.postMessage({ bytes: bytes.buffer }, [bytes.buffer]);
  });
}

/** Ouvre l'assistant. ctx : contexte des vues du plan réseau ; file : File facultatif (glissé, menu Fichier). */
export function openIfcImport(ctx, file = null) {
  const layer = document.createElement('div'); layer.className = 'ntCiLayer'; document.body.appendChild(layer);
  const O = overlay(layer, { label: tl('Importer un modèle IFC'), cls: 'ntCiOv' }), { dlg } = O;
  const W = { step: 'file', name: '', size: 0, model: null, err: null, busy: null, abort: null, sel: null, map: {}, unit: 'auto', what: { rooms: true, walls: true, doors: true, devices: false, paths: false }, replace: true, tRead: 0 };
  dlg.classList.add('ntCi', 'ntIfc');
  dlg.innerHTML = `<div class="nt-hd">${icon('building')}<div class="nt-ttl"><b>${esc(tl('Importer un modèle IFC'))}</b><span class="ntCiSub"></span></div>
      <button class="nt-x" data-ci="close" aria-label="${esc(tl('Fermer'))}" title="${esc(tl('Fermer'))}">${icon('x')}</button></div>
    <ol class="ntCiSteps" aria-label="${esc(tl('Étapes'))}"></ol>
    <div class="ntCiBody">
      <section class="ntCiFile"></section>
      <section class="ntCiMain" hidden>
        <div class="ntCiPrev"><canvas></canvas><div class="ntCiPrevInfo glass" aria-live="polite"></div>
          <div class="ntIfcLegend glass"></div></div>
        <aside class="ntCiSide"></aside>
      </section>
    </div>
    <div class="ntCiFoot"><span class="ntCiMsg" aria-live="polite"></span><span class="grow"></span>
      <button type="button" class="btn" data-ci="cancel">${esc(tl('Annuler l’import'))}</button>
      <button type="button" class="btn" data-ci="back">${icon('chevLeft')}<span>${esc(tl('Précédent'))}</span></button>
      <button type="button" class="btn primary" data-ci="next"><span>${esc(tl('Suivant'))}</span>${icon('chevRight')}</button></div>
    <input type="file" class="ntCiInput" accept=".ifc,application/x-step,application/ifc" hidden>`;
  const $ = s => dlg.querySelector(s);
  const fileEl = $('.ntCiFile'), main = $('.ntCiMain'), side = $('.ntCiSide'), cv = $('.ntCiPrev canvas'), input = $('.ntCiInput');
  let alive = true, tick = 0;

  function close() {
    if (!alive) return; alive = false;
    if (W.abort) W.abort.abort();
    clearInterval(tick); window.removeEventListener('keydown', onKey, true); ro.disconnect(); O.close(); layer.remove();
  }
  function onKey(e) {
    if (!alive) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (W.busy && W.abort) { W.abort.abort(); return; } close(); return; }
    const inField = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === 'Enter' && !inField && !W.busy && dlg.contains(e.target)) { e.preventDefault(); next(); }
  }
  window.addEventListener('keydown', onKey, true);
  let kb = false; // dernier geste : clavier (true) ou pointeur
  dlg.addEventListener('keydown', () => { kb = true; }, true); dlg.addEventListener('pointerdown', () => { kb = false; }, true);
  const ro = new ResizeObserver(() => paintPrev()); ro.observe($('.ntCiPrev'));

  /* ---------- Étapes ---------- */
  const order = () => STEPS().map(s => s[0]);
  const storeys = () => (W.model ? W.model.buildings.flatMap(b => b.storeys.map(s => ({ b, s }))) : []);
  const chosen = () => storeys().filter(x => W.map[x.s.key] && W.map[x.s.key].on);
  const canGo = s => s === 'file' || (W.model && storeys().length && (s !== 'content' || chosen().length));
  function paintSteps() {
    const ord = order(), i = ord.indexOf(W.step), names = Object.fromEntries(STEPS());
    $('.ntCiSteps').innerHTML = ord.map((s, k) => `<li${s === W.step ? ' aria-current="step"' : ''} class="${k < i ? 'done' : ''}"><button type="button" data-cistep="${s}"${canGo(s) && !W.busy ? '' : ' disabled'}><i>${k < i ? icon('check') : k + 1}</i><span>${esc(names[s])}</span></button></li>`).join('');
    const last = i === ord.length - 1, nx = $('[data-ci="next"]');
    nx.innerHTML = last ? `${icon('upload')}<span>${esc(tl('Importer'))}</span>` : `<span>${esc(tl('Suivant'))}</span>${icon('chevRight')}`;
    nx.disabled = !!W.busy || !W.model || !storeys().length || (W.step !== 'file' && !chosen().length) || (last && !Object.values(W.what).some(Boolean));
    $('[data-ci="back"]').hidden = i <= 0; $('[data-ci="back"]').disabled = !!W.busy;
    const m = W.model;
    $('.ntCiSub').textContent = W.name ? W.name + (m ? ' · ' + m.schema + ' · ' + tl('{0:# entité|# entités}', nf(m.stats.entities)) : '') : tl('Bâtiments, étages, pièces, murs et portes d’une maquette BIM');
  }
  function go(s) {
    if (!canGo(s) || W.busy) return;
    W.step = s; msg('');
    fileEl.hidden = s !== 'file'; main.hidden = s === 'file';
    paintSteps();
    if (s === 'file') paintFile(); else { if (!W.sel || !W.map[W.sel]) W.sel = (chosen()[0] || storeys()[0]).s.key; paintSide(); requestAnimationFrame(paintPrev); }
    // Premier champ de l'étape seulement si l'on navigue au clavier (sinon l'anneau de focus apparaîtrait après un clic).
    const f = kb ? dlg.querySelector(s === 'file' ? '.ntCiFile button' : '.ntCiSide input, .ntCiSide select, .ntCiSide button') : null;
    if (f && f.focus) f.focus({ preventScroll: true }); else dlg.focus({ preventScroll: true });
  }
  function next() { const o = order(), i = o.indexOf(W.step); if (i === o.length - 1) doImport(); else go(o[i + 1]); }
  function back() { const o = order(), i = o.indexOf(W.step); if (i > 0) go(o[i - 1]); }
  const msg = (t, k = '') => { const m = $('.ntCiMsg'); m.textContent = t || ''; m.className = 'ntCiMsg' + (k ? ' ' + k : ''); };

  /* ---------- 1. Fichier ---------- */
  function paintFile() {
    const m = W.model, b = W.busy;
    if (b) {
      const pct = b.f == null ? null : Math.round(b.f * 100);
      fileEl.innerHTML = `<div class="ntCiProg" role="status"><div class="ntCiProgHd">${icon('file')}<b>${esc(W.name)}</b><span class="mut">${esc(W.size ? bytesFmt(W.size) : '')}</span></div>
        <div class="ntCiBar${pct == null ? ' ind' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100"${pct == null ? '' : ` aria-valuenow="${pct}"`} aria-label="${esc(b.label)}"><i style="width:${pct == null ? 30 : pct}%"></i></div>
        <div class="ntCiProgFt"><span>${esc(b.label)}${pct == null ? '' : ' · ' + pct + ' %'}</span><span class="mut ntCiEl">${secs(performance.now() - b.t0)}</span></div>
        <button type="button" class="btn" data-ci="abort">${icon('x')}<span>${esc(tl('Annuler la lecture'))}</span></button></div>`;
      return;
    }
    let h = `<div class="ntCiDrop" tabindex="0" role="button" aria-label="${esc(tl('Choisir un fichier IFC'))}">${icon('upload')}<b>${esc(tl('Déposez un fichier IFC ici'))}</b><span class="mut">${esc(tl('ou'))}</span><button type="button" class="btn primary" data-ci="pick">${icon('folder')}<span>${esc(tl('Choisir un fichier…'))}</span></button>
      <p class="mut">${esc(tl('IFC4 ou IFC 2x3 (.ifc, texte STEP). Le fichier est lu sur cet ordinateur, rien n’est envoyé.'))}</p></div>`;
    if (W.err) h += `<div class="ntCiErr" role="alert">${icon('alert')}<span>${esc(W.err)}</span></div>`;
    if (m) {
      const c = m.counts, nS = storeys().length, warns = WARN();
      h += `<div class="ntCiSum"><h4>${icon('check')}${esc(tl('Fichier lu en {0}', secs(W.tRead)))}</h4><dl>
        <dt>${esc(tl('Fichier'))}</dt><dd>${esc(W.name)} · ${esc(bytesFmt(W.size))}</dd>
        <dt>${esc(tl('Version IFC'))}</dt><dd>${esc(m.schema)}</dd>${appName(m.header.app) ? `<dt>${esc(tl('Créé avec'))}</dt><dd>${esc(appName(m.header.app))}</dd>` : ''}
        <dt>${esc(tl('Projet'))}</dt><dd>${esc(m.project.name || '—')}${m.site.name ? ' · ' + esc(m.site.name) : ''}</dd>
        <dt>${esc(tl('Unité de longueur'))}</dt><dd>${esc(unitName(m.units.length.name))} (${esc(tl('1 unité = {0} m', nf(m.units.length.toMetre, 4)))})</dd>
        <dt>${esc(tl('Bâtiments, étages'))}</dt><dd>${nf(m.buildings.filter(b => b.storeys.length).length)} · ${nf(nS)}</dd>
        <dt>${esc(tl('Contenu'))}</dt><dd>${esc(tl('{0:# pièce|# pièces}, {1:# mur|# murs}, {2:# porte|# portes}', nf(c.spaces), nf(c.walls), nf(c.doors)))}${c.devices + c.carriers + c.cables ? ' · ' + esc(tl('{0:# équipement ou prise|# équipements et prises}, {1:# cheminement|# cheminements}, {2:# câble|# câbles}', nf(c.devices), nf(c.carriers), nf(c.cables))) : ''}</dd>
        <dt>${esc(tl('Entités'))}</dt><dd>${nf(m.stats.entities)}</dd></dl>
        ${m.warnings.map(w => `<p class="ntCiWarn">${icon('alert')}<span>${esc(warns[w.code] || w.code)}${w.n > 1 ? ' (' + nf(w.n) + ')' : ''}</span></p>`).join('')}
        ${!nS ? `<p class="ntCiWarn">${icon('alert')}<span>${esc(tl('Rien à importer : ce fichier n’a pas d’étage.'))}</span></p>` : ''}</div>`;
    }
    fileEl.innerHTML = h;
  }
  function pick() { input.value = ''; input.click(); }
  input.addEventListener('change', () => { if (input.files && input.files[0]) readFile(input.files[0]); });
  fileEl.addEventListener('dragover', e => { e.preventDefault(); const d = fileEl.querySelector('.ntCiDrop'); if (d) d.classList.add('over'); });
  fileEl.addEventListener('dragleave', () => { const d = fileEl.querySelector('.ntCiDrop'); if (d) d.classList.remove('over'); });
  fileEl.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) readFile(f); });
  fileEl.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('ntCiDrop')) { e.preventDefault(); pick(); } });
  fileEl.addEventListener('click', e => { if (e.target.classList.contains('ntCiDrop')) pick(); });

  async function readFile(f) {
    if (W.busy) return;
    W.name = f.name || 'model.ifc'; W.size = f.size || 0; W.err = null; W.model = null;
    if (!/\.ifc$/i.test(W.name) && !/step|ifc/i.test(f.type || '')) { W.err = tl('Ce fichier n’est pas un fichier IFC (.ifc attendu ; les .ifcXML et .ifcZIP ne sont pas lus).'); paintFile(); paintSteps(); return; }
    const t0 = performance.now(); W.abort = new AbortController();
    W.busy = { t0, label: tl('Lecture du fichier'), f: null }; paintSteps(); paintFile();
    clearInterval(tick); tick = setInterval(() => { const el = fileEl.querySelector('.ntCiEl'); if (el && W.busy) el.textContent = secs(performance.now() - W.busy.t0); }, 250);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (!alive) return;
      W.busy.label = tl('Analyse du modèle'); W.busy.f = 0; paintFile();
      const m = await readInWorker(bytes, p => { if (W.busy) { W.busy.f = p; const bar = fileEl.querySelector('.ntCiBar i'); if (bar) bar.style.width = Math.round(p * 100) + '%'; } }, W.abort.signal);
      if (!alive) return;
      W.model = m; W.tRead = performance.now() - t0; LAST = { name: W.name, model: m };
      // Équipements, prises et cheminements cochés d'office quand le fichier en a (le réseau est l'objet de l'import).
      W.what = { rooms: true, walls: true, doors: true, devices: m.counts.devices > 0, paths: m.counts.carriers > 0 };
      initMap();
    } catch (e) {
      if (e && e.name === 'AbortError') W.err = tl('Lecture annulée.');
      else W.err = e && e.message === 'not-ifc' ? tl('Ce fichier STEP n’est pas un modèle IFC.') : tl('Lecture impossible : {0}', (e && e.message) || e);
    }
    W.busy = null; W.abort = null; clearInterval(tick);
    if (!alive) return;
    paintSteps(); paintFile();
    msg(W.model ? tl('Vérifiez les étages à l’étape suivante.') : '', W.model ? '' : 'err');
  }

  /* ---------- Correspondance étages IFC → étages du projet ---------- */
  const lower = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  function initMap() {
    const bs = ctx.data().site ? ctx.data().site.buildings : [];
    W.map = {};
    for (const B of W.model.buildings) {
      const same = bs.find(b => B.name && lower(b.name) === lower(B.name));
      for (const s of B.storeys) {
        const f = same && (same.floors.find(x => lower(x.name) === lower(s.name)) || null);
        W.map[s.key] = { on: true, building: same ? same.id : 'new', target: f ? f.id : 'new' };
      }
    }
    W.sel = null;
  }

  /* ---------- Panneau de côté ---------- */
  function paintSide() {
    if (!W.model) { side.innerHTML = ''; return; }
    side.innerHTML = W.step === 'storeys' ? storeysHtml() : contentHtml();
    paintInfo();
  }
  const countsLine = c => tl('{0:# pièce|# pièces} · {1:# mur|# murs} · {2:# porte|# portes}', nf(c.spaces), nf(c.walls), nf(c.doors)) + (c.devices || c.carriers ? ' · ' + tl('{0:# équipement|# équipements}', nf(c.devices)) : '');
  function storeysHtml() {
    const bs = ctx.data().site.buildings, many = W.model.buildings.filter(b => b.storeys.length).length > 1;
    let h = `<section class="ntCiSec grow"><h4>${icon('layers')}${esc(tl('Étages du fichier'))} <span class="mut">${nf(chosen().length)} / ${nf(storeys().length)}</span></h4>
      <p class="mut">${esc(tl('Cochez les étages à importer ; cliquez sur un étage pour le voir.'))}</p><div class="ntIfcList" role="listbox" aria-label="${esc(tl('Étages du fichier'))}">`;
    for (const { b, s } of storeys()) {
      const M = W.map[s.key];
      h += `<div class="ntIfcRow${W.sel === s.key ? ' on' : ''}" role="option" aria-selected="${W.sel === s.key}" data-ifsel="${s.key}" tabindex="0">
        <input type="checkbox" data-ifon="${s.key}"${M.on ? ' checked' : ''} aria-label="${esc(tl('Importer {0}', s.name))}">
        <div><b>${esc(s.name)}</b><span>${many ? esc(b.name || tl('Bâtiment')) + ' · ' : ''}${esc(tl('altitude {0} m', nf(s.elev, 2)))} · ${esc(countsLine(s.counts))}</span></div></div>`;
    }
    h += `</div></section>`;
    const cur = storeys().find(x => x.s.key === W.sel);
    if (cur) {
      const M = W.map[cur.s.key], b = bs.find(x => x.id === M.building), fs = b ? b.floors : [];
      h += `<section class="ntCiSec"><h4>${icon('building')}${esc(tl('Destination de « {0} »', cur.s.name))}</h4>
        <label class="ntCiField"><span>${esc(tl('Bâtiment'))}</span><select class="sel" data-ifb="${cur.s.key}">${bs.map(x => `<option value="${esc(x.id)}"${x.id === M.building ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="new"${M.building === 'new' ? ' selected' : ''}>${esc(tl('Nouveau bâtiment : {0}', cur.b.name || W.model.project.name || 'IFC'))}</option></select></label>
        <label class="ntCiField"><span>${esc(tl('Étage'))}</span><select class="sel" data-iff="${cur.s.key}"${M.building === 'new' ? ' disabled' : ''}><option value="new"${M.target === 'new' ? ' selected' : ''}>${esc(tl('Nouvel étage : {0}', cur.s.name))}</option>${fs.map(x => `<option value="${esc(x.id)}"${x.id === M.target ? ' selected' : ''}>${esc(x.name)} · ${esc(tl('ajouter à cet étage'))}</option>`).join('')}</select></label>
        <dl class="ntCiDl"><dt>${esc(tl('Altitude'))}</dt><dd>${esc(tl('{0} m', nf(cur.s.elev, 2)))}</dd><dt>${esc(tl('Hauteur d’étage'))}</dt><dd>${esc(tl('{0} m', nf(cur.s.height, 2)))}</dd><dt>${esc(tl('Niveau'))}</dt><dd>${nf(cur.s.level)}</dd>
        ${cur.b.shift && (cur.b.shift[0] || cur.b.shift[1]) ? `<dt>${esc(tl('Origine décalée'))}</dt><dd>${esc(tl('{0} m, {1} m', nf(cur.b.shift[0], 2), nf(cur.b.shift[1], 2)))}</dd>` : ''}</dl></section>`;
    }
    return h;
  }
  /** Facteur d'échelle de l'unité choisie par rapport à celle du fichier. */
  const scale = () => (W.unit === 'auto' ? 1 : UNIT_M[W.unit] / (W.model.units.length.toMetre || 1));
  function contentHtml() {
    const k = scale(), sel = chosen(), tot = { spaces: 0, walls: 0, doors: 0, devices: 0, carriers: 0 };
    for (const { s } of sel) for (const key of Object.keys(tot)) tot[key] += s.counts[key] || 0;
    const widths = sel.flatMap(({ s }) => s.doors.map(d => d.w * k)).sort((a, b) => a - b), med = widths.length ? widths[widths.length >> 1] : null;
    const hs = sel.map(({ s }) => s.height * k), hMed = hs.length ? hs.sort((a, b) => a - b)[hs.length >> 1] : null;
    const doorOk = med != null && med >= 0.6 && med <= 2.5, hOk = hMed != null && hMed >= 2.2 && hMed <= 8;
    const L = W.model.units.length;
    return `<section class="ntCiSec"><h4>${icon('ruler')}${esc(tl('Unités'))}</h4>
      <p>${esc(tl('Unité du fichier : {0} (1 unité = {1} m).', unitName(L.name), nf(L.toMetre, 4)))}</p>
      <label class="ntCiField"><span>${esc(tl('Lire les longueurs en'))}</span><select class="sel" data-ifu>${UNITS().map(([v, t]) => `<option value="${v}"${v === W.unit ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      ${med != null ? `<div class="ntCiCheck ${doorOk ? 'ok' : 'warn'}">${icon(doorOk ? 'check' : 'alert')}<div><b>${esc(tl('Largeur de porte médiane : {0} m', nf(med, 2)))}</b><span>${esc(doorOk ? tl('Plausible : l’échelle semble juste.') : tl('Peu plausible : vérifiez l’unité.'))}</span></div></div>` : ''}
      ${hMed != null ? `<div class="ntCiCheck ${hOk ? 'ok' : 'warn'}">${icon(hOk ? 'check' : 'alert')}<div><b>${esc(tl('Hauteur d’étage médiane : {0} m', nf(hMed, 2)))}</b><span>${esc(hOk ? tl('Plausible : l’échelle semble juste.') : tl('Peu plausible : vérifiez l’unité.'))}</span></div></div>` : ''}</section>
      <section class="ntCiSec"><h4>${icon('checklist')}${esc(tl('À importer'))} <span class="mut">${esc(tl('{0:# étage|# étages}', nf(sel.length)))}</span></h4>
      <div class="ntIfcWhat">${WHAT().map(([key, label, cnt, ic]) => `<label class="ntIfcOpt${W.what[key] ? ' on' : ''}"><input type="checkbox" data-ifw="${key}"${W.what[key] ? ' checked' : ''}${key === 'doors' && !W.what.walls ? ' disabled' : ''}>${icon(ic)}<span>${esc(label)}</span><em>${nf(tot[cnt])}</em></label>`).join('')}</div>
      <p class="mut">${esc(tl('Équipements : type d’après la classe IFC (switch, routeur, prise…) ; placés sur le plan et ajoutés au schéma logique, sans câbles.'))}</p>
      <label class="ntIfcOpt${W.replace ? ' on' : ''}"><input type="checkbox" data-ifr${W.replace ? ' checked' : ''}>${icon('swap')}<span>${esc(tl('Remplacer ce qu’un import précédent de ces étages a posé'))}</span></label></section>`;
  }

  /* ---------- Aperçu de l'étage choisi ---------- */
  function cssv(n, d) { const v = getComputedStyle(dlg).getPropertyValue(n).trim(); return v || d; }
  function paintPrev() {
    if (!alive || main.hidden || !W.model) return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width || !r.height) return;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    const cur = storeys().find(x => x.s.key === W.sel); if (!cur) return;
    const s = cur.s;
    const pts = [...s.spaces.flatMap(x => x.poly), ...s.walls.flatMap(w => [w.a, w.b]), ...s.devices.map(d => [d.x, d.y]), ...s.carriers.flatMap(c => c.pts)];
    if (!pts.length) { g.fillStyle = cssv('--muted', '#888'); g.font = '13px system-ui'; g.textAlign = 'center'; g.fillText(tl('Étage vide'), r.width / 2, r.height / 2); return; }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
    const pad = 36, sc = Math.min((r.width - pad * 2) / Math.max(1e-3, x1 - x0), (r.height - pad * 2) / Math.max(1e-3, y1 - y0));
    const ox = (r.width - (x1 - x0) * sc) / 2, oy = (r.height - (y1 - y0) * sc) / 2;
    const X = x => ox + (x - x0) * sc, Y = y => oy + (y - y0) * sc;
    const fg = cssv('--fg', '#ddd'), acc = cssv('--accent', '#3b82f6'), mut = cssv('--muted', '#888'), ok = cssv('--ok-ink', '#3a3');
    // Ce qui ne sera pas importé (case décochée) reste visible, estompé.
    const dim = k => (W.what[k] === false ? 0.2 : 1);
    // Pièces
    g.lineJoin = 'round';
    for (const sp of s.spaces) {
      g.beginPath(); for (const ring of [sp.poly, ...sp.holes]) ring.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))), g.closePath();
      g.globalAlpha = 0.14 * dim('rooms'); g.fillStyle = acc; g.fill('evenodd'); g.globalAlpha = 0.55 * dim('rooms'); g.strokeStyle = acc; g.lineWidth = 1; g.stroke(); g.globalAlpha = 1;
    }
    // Murs
    g.strokeStyle = fg; g.lineCap = 'butt'; g.globalAlpha = dim('walls');
    for (const w of s.walls) { g.lineWidth = Math.max(1.5, (w.t || 0.15) * sc); g.beginPath(); g.moveTo(X(w.a[0]), Y(w.a[1])); g.lineTo(X(w.b[0]), Y(w.b[1])); g.stroke(); }
    // Portes : ouverture dans le mur
    const wallBy = new Map(s.walls.map(w => [w.key, w]));
    g.strokeStyle = ok; g.lineWidth = 3; g.globalAlpha = dim('walls') * dim('doors');
    for (const d of s.doors) { const w = wallBy.get(d.wall); if (!w) continue; const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1, ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L; const a = d.at - d.w / 2, b = d.at + d.w / 2; g.beginPath(); g.moveTo(X(w.a[0] + ux * a), Y(w.a[1] + uy * a)); g.lineTo(X(w.a[0] + ux * b), Y(w.a[1] + uy * b)); g.stroke(); }
    // Cheminements
    g.setLineDash([6, 4]); g.strokeStyle = mut; g.lineWidth = 2; g.globalAlpha = dim('paths');
    for (const c of s.carriers) { if (c.pts.length < 2) continue; g.beginPath(); c.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.stroke(); }
    g.setLineDash([]);
    // Équipements
    g.fillStyle = acc; g.globalAlpha = dim('devices'); for (const d of s.devices) { g.beginPath(); g.arc(X(d.x), Y(d.y), 3.5, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    // Noms des pièces (quand ils tiennent), sur une pastille : ni traits ni points ne les barrent.
    const stg = cssv('--stage', '#111'), font = '11.5px system-ui, sans-serif';
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const sp of s.spaces) {
      const cx = sp.poly.reduce((a, p) => a + p[0], 0) / sp.poly.length, cy = sp.poly.reduce((a, p) => a + p[1], 0) / sp.poly.length;
      const bw = (Math.max(...sp.poly.map(p => p[0])) - Math.min(...sp.poly.map(p => p[0]))) * sc;
      if (bw <= 60) continue;
      let t = sp.label.length > 24 ? sp.label.slice(0, 23) + '…' : sp.label;
      while (t.length > 4 && g.measureText(t).width > bw - 14) t = t.slice(0, -2) + '…';
      const tw = g.measureText(t).width, x = X(cx), y = Y(cy);
      g.globalAlpha = 0.88 * Math.max(0.5, dim('rooms')); g.fillStyle = stg; g.beginPath();
      if (g.roundRect) g.roundRect(x - tw / 2 - 5, y - 9, tw + 10, 18, 5); else g.rect(x - tw / 2 - 5, y - 9, tw + 10, 18);
      g.fill(); g.globalAlpha = dim('rooms') < 1 ? 0.5 : 1; g.fillStyle = fg; g.fillText(t, x, y); g.globalAlpha = 1;
    }
    W.dim = { key: cur.s.key, w: x1 - x0, h: y1 - y0 };
    paintInfo();
  }
  function paintInfo() {
    const cur = storeys().find(x => x.s.key === W.sel), el = $('.ntCiPrevInfo'), lg = $('.ntIfcLegend');
    const w = W.dim && cur && W.dim.key === cur.s.key ? W.dim.w : null, h = w != null ? W.dim.h : null;
    if (!cur) { el.textContent = ''; lg.innerHTML = ''; return; }
    const k = W.step === 'content' ? scale() : 1;
    el.textContent = cur.s.name + (w != null ? ' · ' + tl('{0} × {1} m', nf(w * k, 1), nf(h * k, 1)) : '') + ' · ' + countsLine(cur.s.counts);
    lg.innerHTML = `<span><i class="sp"></i>${esc(tl('Salles'))}</span><span><i class="wl"></i>${esc(tl('Murs'))}</span><span><i class="dr"></i>${esc(tl('Portes'))}</span><span><i class="dv"></i>${esc(tl('Équipements'))}</span><span><i class="pa"></i>${esc(tl('Cheminements'))}</span>`;
  }

  /* ---------- Événements ---------- */
  dlg.addEventListener('click', e => {
    const row = e.target.closest('[data-ifsel]');
    if (row && !e.target.matches('input')) { W.sel = +row.dataset.ifsel || row.dataset.ifsel; paintSide(); paintPrev(); return; }
    const t = e.target.closest('[data-ci],[data-cistep]'); if (!t) return;
    if (t.dataset.cistep) { go(t.dataset.cistep); return; }
    const a = t.dataset.ci;
    if (a === 'close' || a === 'cancel') close();
    else if (a === 'next') next();
    else if (a === 'back') back();
    else if (a === 'pick') pick();
    else if (a === 'abort') { if (W.abort) W.abort.abort(); }
  });
  dlg.addEventListener('keydown', e => {
    const row = e.target.closest && e.target.closest('[data-ifsel]');
    if (!row || e.target !== row) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); W.sel = +row.dataset.ifsel; paintSide(); paintPrev(); const r2 = side.querySelector(`[data-ifsel="${W.sel}"]`); if (r2) r2.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const sib = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling; if (sib) { W.sel = +sib.dataset.ifsel; paintSide(); paintPrev(); const r2 = side.querySelector(`[data-ifsel="${W.sel}"]`); if (r2) r2.focus(); } }
  });
  dlg.addEventListener('change', e => {
    const t = e.target, d = t.dataset;
    if (d.ifon != null) { W.map[d.ifon].on = t.checked; paintSteps(); paintSide(); return; }
    if (d.ifb != null) { const M = W.map[d.ifb]; M.building = t.value; const b = ctx.data().site.buildings.find(x => x.id === t.value), s = storeys().find(x => String(x.s.key) === d.ifb); M.target = b && s ? (b.floors.find(f => lower(f.name) === lower(s.s.name)) || { id: 'new' }).id : 'new'; paintSide(); return; }
    if (d.iff != null) { W.map[d.iff].target = t.value; paintSide(); return; }
    if (d.ifu != null) { W.unit = t.value; paintSide(); paintPrev(); return; }
    if (d.ifw != null) { W.what[d.ifw] = t.checked; if (d.ifw === 'walls' && !t.checked) W.what.doors = false; paintSteps(); paintSide(); paintPrev(); return; }
    if (d.ifr != null) { W.replace = t.checked; paintSide(); }
  });

  /* ---------- Import ---------- */
  function doImport() {
    if (W.busy || !W.model || !chosen().length) return;
    try {
      const m = scaleModel(W.model, scale()), choice = { storeys: {}, what: { ...W.what }, replace: W.replace };
      for (const { s } of storeys()) choice.storeys[s.key] = W.map[s.key];
      const data = ctx.data();
      const r = applyIfc(data, m, choice, { newDevice: ctx.newDevice ? (type, at) => ctx.newDevice(type, at) : null });
      ctx.commit();
      const c = r.counts, fid = r.floors[0];
      close();
      const sum = tl('IFC importé : {0:# étage|# étages}, {1:# pièce|# pièces}, {2:# mur|# murs}, {3:# porte|# portes}', nf(r.floors.length), nf(c.rooms), nf(c.walls), nf(c.doors))
        + (c.devices || c.paths ? ', ' + tl('{0:# équipement|# équipements}, {1:# cheminement|# cheminements}', nf(c.devices), nf(c.paths)) : '')
        + (r.skipped.devices ? ' ' + tl('({0:# objet sans type connu ignoré|# objets sans type connu ignorés})', nf(r.skipped.devices)) : '') + '.';
      if (ctx.app && ctx.app.log) ctx.app.log(tl('IFC · {0} : {1}', W.name, sum), 'ok');
      // Vue Plans sur le premier étage importé, recadrée sous le bandeau « Et maintenant ? » (plan-underlay.js) ;
      // le compte rendu après l'ouverture de la vue (elle écrit son propre message en s'ouvrant).
      ctx.openView('plan').then(async v => {
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        if (v && v.reveal && fid) v.reveal(fid);
        if (v && v.cmd && v.cmd.coach) await v.cmd.coach({ floor: fid, mode: 'ifc', counts: c, title: sum });
        else if (v && v.fit) v.fit();
        ctx.status(sum, 'ok');
      }).catch(e => { console.error(e); ctx.status(sum, 'ok'); });
      if (import.meta.env && import.meta.env.DEV && window.__jollof) window.__jollof.ifcImportLast = r;
    } catch (e) { console.error(e); msg(tl('Import impossible : {0}', (e && e.message) || e), 'err'); }
  }

  /* ---------- Départ ---------- */
  paintSteps(); paintFile();
  setTimeout(() => { const z = fileEl.querySelector('[data-ci="pick"]'); if (z) z.focus({ preventScroll: true }); }, 30);
  if (file) readFile(file);
  const api = { close, state: () => W, readFile };
  if (import.meta.env && import.meta.env.DEV && window.__jollof) window.__jollof.ifcWizard = api; // (essais automatiques)
  return api;
}
