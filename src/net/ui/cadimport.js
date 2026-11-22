// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Assistant d'import d'un plan DXF ou DWG (chargé à la demande) : openCadImport(ctx, file?, { floor? }).
// Étapes : 1 Fichier (lecture dans un worker, progression, annuler ; DWG converti par dwg.js sur l'application de
// bureau), 2 Zone et échelle (aperçu, unités du fichier et contrôle par une largeur de porte mesurée, feuilles détectées
// en vignettes, cadre dessiné à la souris), 3 Calques (arbre groupé par préfixe de référence externe, recherche,
// préréglages devinés des noms, genres, comptes dans la zone), 4 Destination (bâtiment, étage, altitude ; fond seul
// ou conversion en modèle par l'étape du module de conversion). Tout se termine par UN seul ctx.commit().
// Le CadDoc et l'aperçu restent en mémoire le temps de l'assistant ; seul le paquet compact (underlay.js) est gardé.
import './cadimport.css';
import './crimp.css';
import { tl, isEn } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { overlay } from './crimp.js';
import { createSegRenderer, themeColor, parseCss, lum, mix, css } from './plan-underlay-render.js';
import { bytesToDataUrl, newBlobId, cleanUnderlay, rememberBlob, cadSession } from '../cad/store.js';
import { uid, siteIds, floorOf } from '../site.js';
import * as LG from './cadimport-logic.js';

// Modules d'autres équipes : chargés seulement s'ils existent (import.meta.glob ne casse pas s'ils manquent).
const MODS = import.meta.glob(['../cad/dxf.js', '../cad/dwg.js', '../cad/underlay.js', '../cad/convert.js', './cadconvert.js', './kit/search.js']);
const mod = p => (MODS[p] ? MODS[p]() : Promise.resolve(null));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString(isEn ? 'en' : 'fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '—');
const kfmt = n => (n >= 1e6 ? nf(n / 1e6, 2) + ' M' : n >= 1e4 ? nf(n / 1e3, 1) + ' k' : nf(n));
const bytesFmt = b => (b >= 1 << 20 ? tl('{0} Mo', nf(b / (1 << 20), 1)) : tl('{0} ko', nf(b / 1024, 0)));
const secs = ms => tl('{0} s', nf(ms / 1000, 1));
const UNIT_NAMES = () => ({ m: tl('mètres'), cm: tl('centimètres'), mm: tl('millimètres'), in: tl('pouces'), ft: tl('pieds') });
const KIND_NAMES = () => ({
  walls: tl('Murs'), partitions: tl('Cloisons'), doors: tl('Portes'), windows: tl('Fenêtres'), structure: tl('Structure'),
  elec: tl('Électricité'), cfo: tl('Courants forts'), cfa: tl('Courants faibles'), furniture: tl('Mobilier'), text: tl('Textes'),
  dims: tl('Cotes'), hatch: tl('Hachures'), other: tl('Autres')
});
const PRESET_NAMES = () => [['clean', tl('Recommandé'), tl('Tout sauf hachures, cotes et mobilier')], ['archi', tl('Architecture'), tl('Murs, cloisons, portes, fenêtres, structure')], ['archiElec', tl('Archi + électricité'), tl('Architecture, courants forts et faibles')]];
const STEPS = () => [['file', tl('Fichier')], ['zone', tl('Zone et échelle')], ['layers', tl('Calques')], ['dest', tl('Destination')]];

/** Ouvre l'assistant. ctx : contexte des vues du plan réseau. file : File facultatif (glissé, menu Fichier). */
export function openCadImport(ctx, file = null, opts = {}) {
  // Toute la fenêtre (l'aperçu a besoin de place) : un calque fixe porte le voile et la boîte.
  const layer = document.createElement('div'); layer.className = 'ntCiLayer'; document.body.appendChild(layer);
  const O = overlay(layer, { label: tl('Importer un plan DXF ou DWG'), cls: 'ntCiOv' }), { dlg } = O;
  const W = {
    step: 'file', file: null, name: '', doc: null, err: null, busy: null, abort: null, R: null, view: null,
    units: 'm', toMetre: 1, unitsFrom: 'header', region: null, sheet: -1, box: false, layers: new Set(), dims: new Set(), kinds: null,
    inRegion: null, tree: null, q: '', open: new Set(), hideEmpty: true, preset: 'clean',
    dest: { bld: '', bldName: '', floor: '', floorName: '', level: 0, elev: 0 }, mode: 'bg', conv: null, convUi: null, tParse: 0
  };
  dlg.classList.add('ntCi');
  dlg.innerHTML = `<div class="nt-hd">${icon('upload')}<div class="nt-ttl"><b>${esc(tl('Importer un plan DXF ou DWG'))}</b><span class="ntCiSub"></span></div>
      <button class="nt-x" data-ci="close" aria-label="${esc(tl('Fermer'))}" title="${esc(tl('Fermer'))}">${icon('x')}</button></div>
    <ol class="ntCiSteps" aria-label="${esc(tl('Étapes'))}"></ol>
    <div class="ntCiBody">
      <section class="ntCiFile"></section>
      <section class="ntCiMain" hidden>
        <div class="ntCiPrev"><canvas></canvas>
          <div class="ntCiPrevBar glass">
            <button type="button" class="tb" data-ci="fit" data-tip="${esc(tl('Tout voir'))}" aria-label="${esc(tl('Tout voir'))}">${icon('fitAll')}</button>
            <button type="button" class="tb" data-ci="zin" aria-label="${esc(tl('Zoom avant'))}">${icon('zoomIn')}</button>
            <button type="button" class="tb" data-ci="zout" aria-label="${esc(tl('Zoom arrière'))}">${icon('zoomOut')}</button>
            <button type="button" class="tb ntCiBoxBtn" data-ci="box" aria-pressed="false" data-tip="${esc(tl('Dessiner un cadre : glisser sur l’aperçu'))}">${icon('zoomArea')}<span>${esc(tl('Cadre'))}</span></button>
          </div>
          <div class="ntCiPrevInfo glass" aria-live="polite"></div>
          <div class="ntCiPrevWait" hidden><span class="ntCiSpin"></span>${esc(tl('Préparation de l’aperçu…'))}</div>
        </div>
        <aside class="ntCiSide"></aside>
      </section>
    </div>
    <div class="ntCiFoot"><span class="ntCiMsg" aria-live="polite"></span><span class="grow"></span>
      <button type="button" class="btn" data-ci="cancel">${esc(tl('Annuler l’import'))}</button>
      <button type="button" class="btn" data-ci="back">${icon('chevLeft')}<span>${esc(tl('Précédent'))}</span></button>
      <button type="button" class="btn primary" data-ci="next"><span>${esc(tl('Suivant'))}</span>${icon('chevRight')}</button></div>
    <input type="file" class="ntCiInput" accept=".dxf,.dwg,application/dxf,image/vnd.dxf,image/vnd.dwg" hidden>`;
  const $ = s => dlg.querySelector(s);
  const fileEl = $('.ntCiFile'), main = $('.ntCiMain'), side = $('.ntCiSide'), cv = $('.ntCiPrev canvas'), prev = $('.ntCiPrev');
  let alive = true, raf = 0, kitSearch = null;
  mod('./kit/search.js').then(m => { kitSearch = m && m.searchBox; if (W.step === 'layers') paintSide(); }).catch(() => {});

  /* ---------- Fermer ---------- */
  function close() {
    if (!alive) return; alive = false;
    if (W.abort) W.abort.abort();
    if (W.convUi && W.convUi.destroy) try { W.convUi.destroy(); } catch (e) { /* étape de conversion */ }
    cancelAnimationFrame(raf); clearInterval(tick); window.removeEventListener('keydown', onKey, true); ro.disconnect(); O.close(); layer.remove();
    W.doc = null; W.R = null;
  }
  function onKey(e) {
    if (!alive) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (W.box) { setBox(false); return; } if (W.busy && W.abort) { W.abort.abort(); return; } close(); return; }
    const inField = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === 'Enter' && !inField && !W.busy && dlg.contains(e.target)) { e.preventDefault(); next(); }
  }
  window.addEventListener('keydown', onKey, true);

  /* ---------- Étapes ---------- */
  const order = () => STEPS().map(s => s[0]).concat(W.mode === 'convert' && W.conv ? ['convert'] : []);
  const canGo = s => s === 'file' || (W.doc && (s !== 'layers' && s !== 'dest' && s !== 'convert' || W.region));
  function paintSteps() {
    const names = Object.fromEntries(STEPS()); names.convert = tl('Conversion en modèle');
    const ord = order(), i = ord.indexOf(W.step);
    $('.ntCiSteps').innerHTML = ord.map((s, k) => `<li${s === W.step ? ' aria-current="step"' : ''} class="${k < i ? 'done' : ''}"><button type="button" data-cistep="${s}"${canGo(s) && !W.busy ? '' : ' disabled'}><i>${k < i ? icon('check') : k + 1}</i><span>${esc(names[s])}</span></button></li>`).join('');
    const last = i === ord.length - 1, nx = $('[data-ci="next"]');
    nx.innerHTML = last ? `${icon('upload')}<span>${esc(tl('Importer'))}</span>` : `<span>${esc(tl('Suivant'))}</span>${icon('chevRight')}`;
    nx.disabled = !!W.busy || !W.doc || (W.step !== 'file' && !W.region) || (W.step === 'layers' && !W.layers.size);
    $('[data-ci="back"]').hidden = i <= 0; $('[data-ci="back"]').disabled = !!W.busy;
    const d = W.doc; $('.ntCiSub').textContent = W.name ? W.name + (d ? ' · ' + tl('{0} entités, {1} calques', kfmt(d.stats.entities || 0), nf(d.layers.length)) : '') : tl('Fond de plan vectoriel pour les étages');
  }
  function go(s) {
    if (!canGo(s) || W.busy) return;
    W.step = s; setBox(false);
    // Étape « conversion » : l'aperçu reste à gauche, l'étape du module de conversion prend la place du panneau de côté.
    fileEl.hidden = s !== 'file'; main.hidden = s === 'file'; main.classList.toggle('conv', s === 'convert');
    if (s === 'convert') { showConvert(); } else { const c = dlg.querySelector('.ntCiConv'); if (c) c.hidden = true; }
    if (s === 'layers') computeRegion();
    paintSteps(); if (s === 'file') paintFile(); else {
      if (s !== 'convert') paintSide(); resize();
      // Le volet d'aperçu change de largeur (étape de conversion) : la zone est recadrée dedans.
      const pw = prev.clientWidth; if (W.region && W.prevW && pw !== W.prevW) fitTo(W.region, false); W.prevW = pw;
      restyle(); paintPrev();
    }
    const f = dlg.querySelector(s === 'file' ? '.ntCiFile button, .ntCiFile' : s === 'dest' ? '.ntCiSide select' : '.ntCiSide input, .ntCiSide button'); if (f && f.focus) f.focus({ preventScroll: true });
  }
  function next() { const o = order(), i = o.indexOf(W.step); if (i === o.length - 1) doImport(); else go(o[i + 1]); }
  function back() { const o = order(), i = o.indexOf(W.step); if (i > 0) go(o[i - 1]); }
  const msg = (t, k = '') => { const m = $('.ntCiMsg'); m.textContent = t || ''; m.className = 'ntCiMsg' + (k ? ' ' + k : ''); };

  /* ---------- 1. Fichier ---------- */
  function paintFile() {
    const d = W.doc, b = W.busy;
    if (b) {
      const pct = b.f == null ? null : Math.round(b.f * 100);
      fileEl.innerHTML = `<div class="ntCiProg" role="status"><div class="ntCiProgHd">${icon(b.icon || 'file')}<b>${esc(W.name)}</b><span class="mut">${esc(b.size ? bytesFmt(b.size) : '')}</span></div>
        <div class="ntCiBar${pct == null ? ' ind' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100"${pct == null ? '' : ` aria-valuenow="${pct}"`} aria-label="${esc(b.label)}"><i style="width:${pct == null ? 30 : pct}%"></i></div>
        <div class="ntCiProgFt"><span>${esc(b.label)}${pct == null ? '' : ' · ' + pct + ' %'}</span><span class="mut ntCiEl">${secs(performance.now() - b.t0)}</span></div>
        <button type="button" class="btn" data-ci="abort">${icon('x')}<span>${esc(tl('Annuler la lecture'))}</span></button></div>`;
      return;
    }
    let h = `<div class="ntCiDrop" tabindex="0" role="button" aria-label="${esc(tl('Choisir un fichier DXF ou DWG'))}">${icon('upload')}<b>${esc(tl('Déposez un fichier DXF ou DWG ici'))}</b><span class="mut">${esc(tl('ou'))}</span><button type="button" class="btn primary" data-ci="pick">${icon('folder')}<span>${esc(tl('Choisir un fichier…'))}</span></button>
      <p class="mut">${esc(tl('Le fichier est lu sur cet ordinateur, rien n’est envoyé. Les gros plans (plusieurs centaines de Mo) sont lus par morceaux.'))}</p></div>`;
    if (W.err) h += `<div class="ntCiErr" role="alert">${icon('alert')}<span>${esc(W.err)}</span></div>`;
    if (d) {
      const u = LG.unitsOf(d), ins = d.insunits;
      h += `<div class="ntCiSum"><h4>${icon('check')}${esc(tl('Fichier lu en {0}', secs(W.tParse)))}</h4><dl>
        <dt>${esc(tl('Fichier'))}</dt><dd>${esc(W.name)} · ${esc(bytesFmt(d.stats.bytes || W.file && W.file.size || 0))}${d.version ? ' · ' + esc(d.version) : ''}</dd>
        <dt>${esc(tl('Entités'))}</dt><dd>${esc(kfmt(d.stats.entities || 0))} · ${esc(tl('{0} segments, {1} textes', kfmt(d.segLayer.length), kfmt(d.texts.length)))}</dd>
        <dt>${esc(tl('Calques'))}</dt><dd>${nf(d.layers.length)}${d.blocks ? ' · ' + esc(tl('{0} blocs', nf(d.blocks.length))) : ''}</dd>
        <dt>${esc(tl('Unités'))}</dt><dd>${esc(u.from === 'header' ? tl('{0} ($INSUNITS = {1})', UNIT_NAMES()[u.units] || u.units, ins) : tl('non précisées : {0} supposés', UNIT_NAMES()[u.units] || u.units))}</dd>
        <dt>${esc(tl('Feuilles'))}</dt><dd>${nf(sheets().length)}</dd></dl>
        ${d.stats.truncated ? `<p class="ntCiWarn">${icon('alert')}${esc(tl('Plan très lourd : une partie des éléments n’a pas été gardée.'))}</p>` : ''}${diagHtml(d)}</div>`;
    }
    fileEl.innerHTML = h;
  }
  /** Diagnostic du lecteur (doc.diagnostics : erreurs d'abord) : rien n'est écarté sans être dit. */
  function diagHtml(d) {
    const list = Array.isArray(d.diagnostics) ? d.diagnostics : []; if (!list.length) return '';
    const nE = list.filter(x => x.level === 'error').length, nW = list.filter(x => x.level === 'warning').length;
    const row = x => `<li class="${esc(x.level)}"><b>${esc(x.code)}</b> ×${nf(x.n || 1)}${x.sample ? ` <span class="mut">${esc(String(x.sample).slice(0, 60))}</span>` : ''}${x.line != null ? ` <span class="mut">${esc(tl('ligne {0}', x.line))}</span>` : ''}</li>`;
    return `<details class="ntCiDiag"${nE ? ' open' : ''}><summary>${icon(nE ? 'alert' : 'info')}${esc(tl('Diagnostic du lecteur : {0:# erreur|# erreurs}, {1:# avertissement|# avertissements}, {2:# information|# informations}', nE, nW, list.length - nE - nW))}</summary><ul>${list.slice(0, 40).map(row).join('')}</ul></details>`;
  }
  const input = $('.ntCiInput');
  input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; if (f) readFile(f); });
  fileEl.addEventListener('dragover', e => { e.preventDefault(); const z = fileEl.querySelector('.ntCiDrop'); if (z) z.classList.add('over'); });
  fileEl.addEventListener('dragleave', () => { const z = fileEl.querySelector('.ntCiDrop'); if (z) z.classList.remove('over'); });
  fileEl.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) readFile(f); });
  fileEl.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('ntCiDrop')) { e.preventDefault(); input.click(); } });
  // (un DWG choisi ou glissé part tel quel vers le convertisseur de l'application de bureau : dwg.js l'envoie par morceaux)
  const pick = () => input.click();
  function progress(label, f, extra = {}) { W.busy = { ...(W.busy || {}), label, f, ...extra }; if (W.step === 'file') paintFile(); }
  const tick = setInterval(() => { if (alive && W.busy) { const e = fileEl.querySelector('.ntCiEl'); if (e) e.textContent = secs(performance.now() - W.busy.t0); } }, 250);

  async function readFile(f) {
    if (W.busy) return;
    W.file = f; W.name = f.name || 'plan.dxf'; W.err = null; W.doc = null; W.R = null; W.region = null; W.sheet = -1;
    const ac = new AbortController(); W.abort = ac;
    W.busy = { t0: performance.now(), size: f.size, label: tl('Lecture du fichier'), f: 0, icon: 'file' };
    paintSteps(); paintFile();
    try {
      const dxf = await mod('../cad/dxf.js'); if (!dxf) throw new Error(tl('Le lecteur DXF n’est pas disponible.'));
      let doc;
      if (/\.dwg$/i.test(W.name)) {
        const dwg = await mod('../cad/dwg.js');
        if (!dwg) throw new Error(tl('Les fichiers DWG ne s’ouvrent que sur l’application de bureau : enregistrez le plan en DXF.'));
        if (!(await dwg.canConvertDwg().catch(() => false))) { W.busy = null; paintFile(); paintSteps(); const again = dwg.showDwgHelp ? await dwg.showDwgHelp({}) : false; if (again && alive) readFile(f); return; }
        progress(tl('Conversion du DWG en DXF'), null, { icon: 'swap' });
        const conv = await dwg.convertDwg(f, { signal: ac.signal, onProgress: p => progress(p.stage === 'upload' || p.stage === 'copy' ? tl('Copie du DWG') : tl('Conversion du DWG en DXF'), p.f ?? null) });
        try { progress(tl('Lecture du DXF converti'), 0, { icon: 'file' }); doc = await dxf.parseDxf(conv.dxf, { size: conv.size, signal: ac.signal, onProgress: x => progress(tl('Lecture du DXF converti'), x) }); }
        finally { if (conv.cleanup) conv.cleanup(); }
      } else doc = await dxf.openCad(f, { signal: ac.signal, onProgress: x => progress(tl('Lecture du fichier'), x) });
      if (!alive) return;
      if (!doc || !doc.segLayer || !(doc.segLayer.length + (doc.texts || []).length)) throw new Error(tl('Aucun élément dessiné dans l’espace objet de ce fichier.'));
      W.tParse = performance.now() - W.busy.t0;
      progress(tl('Préparation de l’aperçu'), null, { icon: 'image' });
      await new Promise(r => setTimeout(r, 30));
      setDoc(doc);
      W.busy = null; W.abort = null;
      go('zone');
      msg(tl('Fichier lu en {0}.', secs(W.tParse)), 'ok');
    } catch (e) {
      W.busy = null; W.abort = null; if (!alive) return;
      W.err = e && e.name === 'AbortError' ? tl('Lecture annulée.') : (e && e.message) || String(e);
      if (!(e && e.name === 'AbortError')) console.error(e);
      paintFile(); paintSteps();
    }
  }

  /* ---------- Document lu ---------- */
  const sheets = () => {
    const d = W.doc; if (!d || !d.clusters) return [];
    const max = d.clusters.reduce((m, c) => Math.max(m, c.count), 0), lim = Math.max(20, max * 0.01);
    return LG.clusterOrder(d.clusters).filter(i => d.clusters[i].count >= lim);
  };
  function setDoc(doc) {
    W.doc = doc;
    for (const l of doc.layers) l.kind = LG.guessKind(l.name);
    const u = LG.unitsOf(doc); W.units = u.units; W.toMetre = doc.toMetre && u.from === 'header' ? doc.toMetre : u.toMetre; W.unitsFrom = u.from;
    if (doc.unitsGuessed) W.unitsFrom = 'size';
    W.layers = LG.presetLayers(doc.layers, 'clean'); W.preset = 'clean';
    W.dims = new Set(doc.layers.filter(l => LG.DIM_KINDS.has(l.kind)).map(l => l.id));
    W.R = createSegRenderer({ segs: doc.segs, segLayer: doc.segLayer, segColor: doc.segColor, texts: doc.texts }, { yUp: true, font: getComputedStyle(document.body).fontFamily });
    W.styleKey = '';
    // Feuille de départ : la plus fournie (le plan d'un niveau, pas le cartouche).
    const sh = sheets(); const best = sh.slice().sort((a, b) => doc.clusters[b].count - doc.clusters[a].count)[0];
    if (best != null) selectSheet(best, false); else W.region = doc.extents.slice();
    W.view = null; W.tree = null;
    initDest();
  }
  function selectSheet(i, paint = true) {
    const c = W.doc.clusters[i]; if (!c) return;
    W.sheet = i; W.region = LG.clusterRegion(c, 0.02); W.inRegion = null;
    if (paint) { fitTo(W.region); paintSide(); paintSteps(); }
  }
  /** Comptes par calque dans la zone (segments + textes). */
  function computeRegion() {
    if (W.inRegion && W.inRegion.key === String(W.region)) return W.inRegion;
    const d = W.doc, [x0, y0, x1, y1] = W.region, n = new Uint32Array(d.layers.reduce((m, l) => Math.max(m, l.id + 1), 1)), s = d.segs, L = d.segLayer;
    // Entités du fichier (poignées, segEnt) quand le lecteur les donne, sinon segments : une entité compte une fois par
    // calque où elle dessine (un bloc peut dessiner sur plusieurs calques).
    const E = d.segEnt, seen = E ? new Set() : null;
    for (let i = 0, k = 0; i < L.length; i++, k += 4) {
      const x = s[k], y = s[k + 1], X = s[k + 2], Y = s[k + 3];
      if (!((x >= x0 && x <= x1 && y >= y0 && y <= y1) || (X >= x0 && X <= x1 && Y >= y0 && Y <= y1))) continue;
      if (seen) { const key = E[i] * 65536 + L[i]; if (seen.has(key)) continue; seen.add(key); }
      n[L[i]]++;
    }
    for (const t of d.texts) if (t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1 && t.layer < n.length) n[t.layer]++;
    W.inRegion = { key: String(W.region), n };
    W.tree = LG.groupLayers(d.layers.map(l => ({ ...l, count: n[l.id] || 0 })));
    return W.inRegion;
  }

  /* ---------- Aperçu ---------- */
  function resize() { const r = prev.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr)); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } if (!W.view && W.region) fitTo(W.region, false); }
  const ro = new ResizeObserver(() => { if (alive && !main.hidden) { resize(); paintPrev(); } }); ro.observe(prev);
  // Vue : x, y (coin haut-gauche, repère des tuiles : y du dessin inversé), k (px CSS par unité du dessin).
  function fitTo(b, paint = true) {
    const r = prev.getBoundingClientRect(); if (!r.width) return;
    const w = Math.max(1e-9, b[2] - b[0]), h = Math.max(1e-9, b[3] - b[1]), k = Math.min((r.width - 40) / w, (r.height - 70) / h);
    W.view = { k, x: b[0] - (r.width / k - w) / 2, y: -b[3] - (r.height / k - h) / 2 + 12 / k };
    if (paint) paintPrev();
  }
  const toD = (cx, cy) => { const r = cv.getBoundingClientRect(), V = W.view; return [V.x + (cx - r.left) / V.k, -(V.y + (cy - r.top) / V.k)]; };
  function restyle() {
    if (!W.R) return;
    const s = getComputedStyle(dlg), key = [W.step, [...W.layers].join(','), [...W.dims].join(','), s.getPropertyValue('--fg'), s.getPropertyValue('--stage')].join('|');
    if (W.styleKey === key) return; W.styleKey = key;
    const fg = parseCss(s.getPropertyValue('--fg')), bg = parseCss(s.getPropertyValue('--stage')), d = W.doc;
    const lc = new Map(d.layers.map(l => [l.id, themeColor(l.color, fg, bg, l.kind === 'text' ? 4.5 : 3)])), pal = (d.palette || []).map(c => (c ? themeColor(c, fg, bg) : null));
    const ghost = css(mix(fg, bg, 0.72)), zone = W.step === 'zone';
    // Étape « zone » : tout le dessin (calques gardés en couleur, les autres en gris léger) ; ensuite : les calques gardés seuls.
    W.R.setStyle({
      color: (l, c) => (W.layers.has(l) ? (c && pal[c]) || lc.get(l) : zone ? ghost : null),
      alpha: l => (W.dims.has(l) ? 0.4 : 1), width: 1
    });
  }
  function paintPrev() { if (!raf && alive) raf = requestAnimationFrame(paintPrevNow); }
  function paintPrevNow() {
    raf = 0; if (!W.R || main.hidden || !W.view) return;
    restyle();
    const g = cv.getContext('2d'), dpr = cv.width / Math.max(1, cv.clientWidth), V = W.view, K = V.k * dpr;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    const done = W.R.draw(g, [K, 0, 0, K, -V.x * K, -V.y * K], cv.width, cv.height, 14);
    // Feuilles et zone choisie (au-dessus).
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = getComputedStyle(dlg), acc = s.getPropertyValue('--accent').trim() || '#3b82f6', fg2 = s.getPropertyValue('--fg-2').trim();
    const sx = x => (x - V.x) * V.k, sy = y => (-y - V.y) * V.k;
    if (W.step === 'zone') {
      g.font = `600 11px ${getComputedStyle(document.body).fontFamily}`;
      sheets().forEach((i, n) => {
        const c = W.doc.clusters[i]; g.strokeStyle = i === W.sheet ? acc : fg2; g.globalAlpha = i === W.sheet ? 0.9 : 0.45; g.setLineDash([4, 4]); g.lineWidth = 1;
        g.strokeRect(sx(c.x0), sy(c.y1), (c.x1 - c.x0) * V.k, (c.y1 - c.y0) * V.k); g.setLineDash([]);
        g.fillStyle = i === W.sheet ? acc : fg2; g.globalAlpha = 0.95; g.fillText(String(n + 1), sx(c.x0) + 4, sy(c.y1) - 5);
      });
      g.globalAlpha = 1;
    }
    if (W.region) {
      const [x0, y0, x1, y1] = W.region, X = sx(x0), Y = sy(y1), w = (x1 - x0) * V.k, h = (y1 - y0) * V.k;
      g.fillStyle = s.getPropertyValue('--backdrop').trim() || '#0008'; g.globalAlpha = W.step === 'zone' ? 0.55 : 0.75;
      g.beginPath(); g.rect(0, 0, cv.clientWidth, cv.clientHeight); g.rect(X, Y, w, h); g.fill('evenodd'); g.globalAlpha = 1;
      g.strokeStyle = acc; g.lineWidth = 1.5; g.strokeRect(X, Y, w, h);
    }
    if (W.drag && W.drag.box) { const b = W.drag.box; g.strokeStyle = acc; g.setLineDash([5, 4]); g.lineWidth = 1.5; g.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); g.setLineDash([]); }
    $('.ntCiPrevWait').hidden = done;
    if (!done) paintPrev();
    paintPrevInfo();
  }
  function paintPrevInfo() {
    const el = $('.ntCiPrevInfo'); if (!W.region) { el.hidden = true; return; }
    const m = W.toMetre, w = (W.region[2] - W.region[0]) * m, h = (W.region[3] - W.region[1]) * m;
    el.hidden = false; el.textContent = tl('Zone : {0} × {1} m', nf(w, 1), nf(h, 1)) + (W.box ? ' · ' + tl('glissez pour dessiner le cadre') : '');
  }
  function setBox(on) { W.box = on; const b = $('.ntCiBoxBtn'); if (b) b.setAttribute('aria-pressed', String(on)); prev.classList.toggle('boxing', on); paintPrevInfo(); }
  const zoomAt = (f, cx, cy) => { const r = cv.getBoundingClientRect(), V = W.view, x = cx ?? r.left + r.width / 2, y = cy ?? r.top + r.height / 2, wx = V.x + (x - r.left) / V.k, wy = V.y + (y - r.top) / V.k; V.k *= f; V.x = wx - (x - r.left) / V.k; V.y = wy - (y - r.top) / V.k; paintPrev(); };
  cv.addEventListener('wheel', e => { if (!W.view) return; e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
  cv.addEventListener('pointerdown', e => {
    if (!W.view) return; cv.setPointerCapture(e.pointerId);
    const boxing = (W.box || e.shiftKey) && e.button === 0 && W.step === 'zone';
    W.drag = { x: e.clientX, y: e.clientY, v: { ...W.view }, moved: false, boxing };
  });
  cv.addEventListener('pointermove', e => {
    const d = W.drag; if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return; d.moved = true;
    if (d.boxing) { const r = cv.getBoundingClientRect(); d.box = [Math.min(d.x, e.clientX) - r.left, Math.min(d.y, e.clientY) - r.top, Math.max(d.x, e.clientX) - r.left, Math.max(d.y, e.clientY) - r.top]; }
    else { W.view.x = d.v.x - (e.clientX - d.x) / W.view.k; W.view.y = d.v.y - (e.clientY - d.y) / W.view.k; }
    paintPrev();
  });
  cv.addEventListener('pointerup', e => {
    const d = W.drag; W.drag = null; if (!d) return;
    if (d.boxing && d.moved && d.box) {
      const r = cv.getBoundingClientRect(), a = toD(d.box[0] + r.left, d.box[1] + r.top), b = toD(d.box[2] + r.left, d.box[3] + r.top);
      W.region = LG.boxOf(a, b); W.sheet = -1; W.inRegion = null; setBox(false); paintSide(); paintSteps(); paintPrev();
      msg(tl('Zone dessinée.'), 'ok'); return;
    }
    if (!d.moved && W.step === 'zone') { const p = toD(e.clientX, e.clientY), i = LG.clusterAt(W.doc.clusters, p[0], p[1]); if (i >= 0 && sheets().includes(i)) { selectSheet(i, false); paintSide(); paintSteps(); paintPrev(); } }
    paintPrev();
  });
  window.addEventListener('jollof:theme', () => { if (alive) { W.styleKey = ''; paintPrev(); if (W.step === 'zone') paintSide(); } });

  /* ---------- Panneau de côté ---------- */
  function paintSide() {
    if (W.step === 'zone') side.innerHTML = zoneHtml();
    else if (W.step === 'layers') { side.innerHTML = layersHtml(); mountSearch(); for (const c of side.querySelectorAll('[data-mixed]')) c.indeterminate = true; }
    else if (W.step === 'dest') side.innerHTML = destHtml();
    if (W.step === 'zone') paintThumbs();
    paintSteps();
  }
  // Étape 2 : unités et vraisemblance, feuilles.
  function zoneHtml() {
    const d = W.doc, U = UNIT_NAMES(), m = W.toMetre, r = W.region, w = r ? (r[2] - r[0]) * m : 0, h = r ? (r[3] - r[1]) * m : 0;
    const v = LG.sizeVerdict(Math.max(w, h)), door = r ? LG.doorWidth(d, r, m) : null, any = r && !door ? LG.doorWidth(d, r) : null;
    const header = W.unitsFrom === 'header' ? tl('Le fichier dit : {0} ($INSUNITS = {1}).', U[W.units] || W.units, d.insunits) : tl('Le fichier ne précise pas son unité : {0} supposés d’après sa taille.', U[W.units] || W.units);
    const ok = v === 'ok' && (!door || (door.w * m >= 0.6 && door.w * m <= 1.4));
    const sh = sheets();
    return `<section class="ntCiSec"><h4>${icon('ruler')}${esc(tl('Unités et échelle'))}</h4>
      <p class="mut">${esc(header)}</p>
      <label class="ntCiField"><span>${esc(tl('Unité du dessin'))}</span><select class="sel" data-ciu>${Object.entries(U).map(([k, n]) => `<option value="${k}"${k === W.units ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <div class="ntCiCheck ${ok ? 'ok' : 'warn'}">${icon(ok ? 'check' : 'alert')}<div>
        <b>${esc(tl('Zone : {0} × {1} m', nf(w, 1), nf(h, 1)))}</b>
        <span>${esc(v === 'small' ? tl('Très petit pour un bâtiment : l’unité est-elle la bonne ?') : v === 'large' ? tl('Très grand pour un bâtiment : l’unité est-elle la bonne ?') : tl('Taille plausible pour un bâtiment.'))}</span>
        ${door ? `<span>${esc(tl('Porte typique mesurée : {0} m ({1} portes).', nf(door.w * m, 2), door.n))}</span>` : any ? `<span>${esc(tl('Les portes mesurent {0} m en {1} : changer d’unité ?', nf(any.w * LG.UNIT_M[any.units], 2), U[any.units] || any.units))}</span>` : `<span class="mut">${esc(tl('Pas de calque de portes pour vérifier l’échelle.'))}</span>`}
      </div></div></section>
      <section class="ntCiSec"><h4>${icon('frame')}${esc(sh.length > 1 ? tl('Feuilles détectées') : tl('Feuille'))}${sh.length > 1 ? ` <span class="mut">${nf(sh.length)}</span>` : ''}</h4>
      ${sh.length > 1 ? `<p class="mut">${esc(tl('Choisissez le plan d’un niveau (cliquez une vignette ou une feuille de l’aperçu), ou dessinez un cadre.'))}</p>
      <div class="ntCiThumbs" role="listbox" aria-label="${esc(tl('Feuilles détectées'))}">${sh.map((i, n) => { const c = d.clusters[i]; return `<button type="button" role="option" class="ntCiThumb" data-cisheet="${i}" aria-selected="${i === W.sheet}"><canvas width="168" height="104"></canvas><span><b>${esc(tl('Feuille {0}', n + 1))}</b> ${esc(nf((c.x1 - c.x0) * m, 0))} × ${esc(nf((c.y1 - c.y0) * m, 0))} m · ${esc(kfmt(c.count))}</span></button>`; }).join('')}
      <button type="button" class="ntCiThumb all" data-cisheet="all" aria-selected="${W.sheet === -1 && String(W.region) === String(d.extents)}">${icon('fitAll')}<span><b>${esc(tl('Tout le dessin'))}</b></span></button></div>` : `<p class="mut">${esc(tl('Une seule feuille : tout le dessin est utilisé. Dessinez un cadre pour n’en garder qu’une partie.'))}</p>`}
      <button type="button" class="btn small" data-ci="box">${icon('zoomArea')}<span>${esc(tl('Dessiner un cadre'))}</span></button></section>`;
  }
  // Vignettes dessinées une par image (les grosses feuilles prennent quelques dizaines de ms), gardées en cache.
  const thumbs = new Map();
  function paintThumbs() {
    const d = W.doc; if (!d || !W.R) return;
    const list = [...side.querySelectorAll('.ntCiThumb canvas')];
    const step = () => {
      if (!alive || W.step !== 'zone') return;
      const c = list.shift(); if (!c) return;
      const i = +c.parentElement.dataset.cisheet, k = d.clusters[i], g = c.getContext('2d');
      if (k) {
        const key = i + '|' + W.styleKey;
        if (!thumbs.has(key)) {
          const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
          const w = k.x1 - k.x0, h = k.y1 - k.y0, s = Math.min((c.width - 6) / Math.max(1e-9, w), (c.height - 6) / Math.max(1e-9, h));
          W.R.paintArea(t.getContext('2d'), s, k.x0, -k.y1, k.x1, -k.y0, (c.width - w * s) / 2, (c.height - h * s) / 2);
          thumbs.set(key, t);
        }
        g.clearRect(0, 0, c.width, c.height); g.drawImage(thumbs.get(key), 0, 0);
      }
      requestAnimationFrame(step);
    };
    restyle(); requestAnimationFrame(step);
  }
  // Étape 3 : calques.
  function layersHtml() {
    const d = W.doc, cnt = computeRegion().n, K = KIND_NAMES(), q = W.q.trim();
    const kinds = new Map(); for (const l of d.layers) { if (W.hideEmpty && !cnt[l.id]) continue; const k = kinds.get(l.kind) || { all: 0, on: 0 }; k.all++; if (W.layers.has(l.id)) k.on++; kinds.set(l.kind, k); }
    const nOn = d.layers.filter(l => W.layers.has(l.id)).length, segOn = d.layers.reduce((s, l) => s + (W.layers.has(l.id) ? cnt[l.id] || 0 : 0), 0);
    let h = `<section class="ntCiSec"><h4>${icon('sliders')}${esc(tl('Préréglages'))}</h4><div class="ntCiChips">${PRESET_NAMES().map(([id, n, tip]) => `<button type="button" class="ntCiChip" data-cipreset="${id}" aria-pressed="${W.preset === id}" title="${esc(tip)}">${esc(n)}</button>`).join('')}</div>
      <div class="ntCiChips kinds">${LG.KIND_IDS.filter(k => kinds.has(k)).map(k => { const x = kinds.get(k); return `<button type="button" class="ntCiChip k-${k}" data-cikind="${k}" aria-pressed="${x.on === x.all ? 'true' : x.on ? 'mixed' : 'false'}" title="${esc(tl('Garder ou retirer tous les calques de ce genre'))}">${esc(K[k])} <span>${x.on}/${x.all}</span></button>`; }).join('')}</div></section>
      <section class="ntCiSec grow"><div class="ntCiLayHd"><span class="ntCiSearch"></span>
        <button type="button" class="btn small" data-ci="allOn" title="${esc(tl('Garder tous les calques affichés'))}">${icon('check')}<span>${esc(tl('Tout'))}</span></button>
        <button type="button" class="btn small" data-ci="allOff" title="${esc(tl('Retirer tous les calques affichés'))}">${icon('x')}<span>${esc(tl('Aucun'))}</span></button></div>
        <label class="ntChk ntCiEmpty"><input type="checkbox" data-ci="hideEmpty"${W.hideEmpty ? ' checked' : ''}><span>${esc(tl('Masquer les calques vides dans la zone'))}</span></label>
        <div class="ntCiTree" role="tree" aria-label="${esc(tl('Calques'))}" aria-multiselectable="true">`;
    const show = l => !(W.hideEmpty && !cnt[l.id]);
    const lid = new Map(d.layers.map(l => [l.id, l]));
    const row = (l, depth, label) => `<div class="ntCiRow lay" role="treeitem" aria-level="${depth + 1}" aria-selected="${W.layers.has(l.id)}" style="--d:${depth}"><label><input type="checkbox" data-cilay="${l.id}"${W.layers.has(l.id) ? ' checked' : ''}${l.off || l.frozen ? ' title="' + esc(tl('Éteint ou gelé dans le fichier')) + '"' : ''}><i style="background:${esc(l.color)}"></i><span class="nm${l.off || l.frozen ? ' off' : ''}" title="${esc(l.name)}">${label}</span></label><span class="kd k-${l.kind}">${esc(K[l.kind])}</span><span class="ct">${kfmt(cnt[l.id] || 0)}</span><button type="button" class="dim${W.dims.has(l.id) ? ' on' : ''}" data-cidim="${l.id}" aria-pressed="${W.dims.has(l.id)}" title="${esc(tl('Atténuer ce calque'))}">${icon('dimLayer')}</button></div>`;
    if (q) {
      const hit = LG.searchLayers(d.layers, q), list = d.layers.filter(l => hit.has(l.id) && show(l));
      h += list.map(l => row(l, 0, esc(l.name))).join('') || `<p class="mut">${esc(tl('Aucun calque ne correspond.'))}</p>`;
    } else {
      // (la clé d'un groupe est le début exact du nom de ses calques : on ne montre que la suite)
      const walk = (node, depth, key) => {
        let s = '';
        for (const g of node.groups) {
          const ids = LG.nodeLayers(g).filter(id => show(lid.get(id))); if (!ids.length) continue;
          const on = ids.filter(id => W.layers.has(id)).length, open = W.open.has(g.key);
          s += `<div class="ntCiRow grp" role="treeitem" aria-level="${depth + 1}" aria-expanded="${open}" style="--d:${depth}"><button type="button" class="car" data-cigrp="${esc(g.key)}" aria-label="${esc(open ? tl('Replier') : tl('Déplier'))}">${icon(open ? 'chevDown' : 'chevRight')}</button><label><input type="checkbox" data-cigrpchk="${esc(g.key)}"${on === ids.length ? ' checked' : ''}${on && on < ids.length ? ' data-mixed="1"' : ''}><span class="nm"><b>${esc(g.label)}</b><em>${esc(g.sep === '_' ? '_' : g.sep)}</em></span></label><span class="kd">${esc(tl('{0} calques', ids.length))}</span><span class="ct">${kfmt(ids.reduce((s2, id) => s2 + (cnt[id] || 0), 0))}</span><span class="dim"></span></div>`;
          if (open) s += walk(g, depth + 1, g.key);
        }
        for (const id of node.layers) { const l = lid.get(id); if (show(l)) s += row(l, depth, esc(key && l.name.startsWith(key) ? l.name.slice(key.length) : l.name)); }
        return s;
      };
      h += walk(W.tree, 0, '') || `<p class="mut">${esc(tl('Aucun calque dans cette zone.'))}</p>`;
    }
    h += `</div></section><p class="ntCiTot mut">${esc(tl('{0:# calque gardé|# calques gardés} · {1:# entité|# entités} dans la zone', nf(nOn), kfmt(segOn)))}</p>`;
    return h;
  }
  function mountSearch() {
    const host = side.querySelector('.ntCiSearch'); if (!host) return;
    if (kitSearch) {
      const sb = kitSearch(host, { placeholder: tl('Chercher un calque'), value: W.q, onInput: q => { W.q = q; repaintLayers(); } });
      W.focusSearch = () => sb.focus && sb.focus();
    } else {
      host.innerHTML = `<input class="inp" type="search" placeholder="${esc(tl('Chercher un calque'))}" aria-label="${esc(tl('Chercher un calque'))}" value="${esc(W.q)}">`;
      host.firstChild.addEventListener('input', e => { W.q = e.target.value; repaintLayers(); });
    }
  }
  /** Redessine l'arbre seul (la recherche garde le focus). */
  function repaintLayers() {
    const tree = side.querySelector('.ntCiTree'), st = tree ? tree.scrollTop : 0, tmp = document.createElement('div'); tmp.innerHTML = layersHtml();
    for (const sel of ['.ntCiChips:not(.kinds)', '.ntCiChips.kinds', '.ntCiTree', '.ntCiTot']) { const a = side.querySelector(sel), b = tmp.querySelector(sel); if (a && b) a.replaceWith(b); }
    const t2 = side.querySelector('.ntCiTree'); if (t2) t2.scrollTop = st;
    for (const c of side.querySelectorAll('[data-mixed]')) c.indeterminate = true;
    restyle(); paintPrev(); paintSteps();
  }
  // Étape 4 : destination.
  function initDest() {
    const d = ctx.data(), bs = d.site.buildings, cur = opts.floor && floorOf(d.site, opts.floor);
    const D = W.dest;
    if (cur && !(d.underlays || {})[cur.f.id]) { D.bld = cur.b.id; D.floor = cur.f.id; }
    else if (cur) { D.bld = cur.b.id; D.floor = 'new'; }
    else if (bs.length) { D.bld = bs[0].id; D.floor = bs[0].floors.length ? 'new' : 'new'; }
    else { D.bld = 'new'; D.floor = 'new'; }
    D.bldName = tl('Bâtiment {0}', bs.length + 1);
    syncNewFloor();
  }
  function syncNewFloor() {
    const D = W.dest, b = ctx.data().site.buildings.find(x => x.id === D.bld), fs = b ? b.floors : [];
    if (D.floor === 'new') {
      const top = fs.reduce((m, f) => (!m || f.level > m.level ? f : m), null);
      D.level = top ? top.level + 1 : 0; D.elev = top ? Math.round((top.elev + top.height) * 100) / 100 : 0;
      D.floorName = D.level === 0 ? tl('Rez-de-chaussée') : tl('Niveau {0}', D.level);
    } else { const f = fs.find(x => x.id === D.floor); if (f) { D.level = f.level; D.elev = f.elev; } }
  }
  function destHtml() {
    const d = ctx.data(), D = W.dest, bs = d.site.buildings, b = bs.find(x => x.id === D.bld), fs = b ? b.floors : [];
    const f = fs.find(x => x.id === D.floor), has = f && (d.underlays || {})[f.id];
    const cnt = computeRegion().n, segs = W.doc.layers.reduce((s, l) => s + (W.layers.has(l.id) ? cnt[l.id] || 0 : 0), 0);
    const m = W.toMetre, r = W.region, convOk = !!W.conv;
    return `<section class="ntCiSec"><h4>${icon('building')}${esc(tl('Bâtiment et étage'))}</h4>
      <label class="ntCiField"><span>${esc(tl('Bâtiment'))}</span><select class="sel" data-cid="bld">${bs.map(x => `<option value="${esc(x.id)}"${x.id === D.bld ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="new"${D.bld === 'new' ? ' selected' : ''}>${esc(tl('Nouveau bâtiment…'))}</option></select></label>
      ${D.bld === 'new' ? `<label class="ntCiField"><span>${esc(tl('Nom du bâtiment'))}</span><input class="inp" data-cid="bldName" maxlength="40" value="${esc(D.bldName)}"></label>` : ''}
      <label class="ntCiField"><span>${esc(tl('Étage'))}</span><select class="sel" data-cid="floor">${fs.map(x => `<option value="${esc(x.id)}"${x.id === D.floor ? ' selected' : ''}>${esc(x.name)}${(d.underlays || {})[x.id] ? ' · ' + esc(tl('a déjà un fond')) : ''}</option>`).join('')}<option value="new"${D.floor === 'new' ? ' selected' : ''}>${esc(tl('Nouvel étage…'))}</option></select></label>
      ${D.floor === 'new' ? `<div class="ntCiTwo"><label class="ntCiField"><span>${esc(tl('Nom de l’étage'))}</span><input class="inp" data-cid="floorName" maxlength="40" value="${esc(D.floorName)}"></label><label class="ntCiField"><span>${esc(tl('Niveau'))}</span><input class="inp" type="number" step="1" min="-10" max="200" data-cid="level" value="${D.level}"></label></div>` : ''}
      <label class="ntCiField"><span>${esc(tl('Altitude du plancher (m)'))}</span><input class="inp" type="number" step="0.01" data-cid="elev" value="${D.elev}"></label>
      ${has ? `<p class="ntCiWarn">${icon('alert')}${esc(tl('Cet étage a déjà un fond : il sera remplacé (Ctrl+Z pour revenir).'))}</p>` : ''}</section>
      <section class="ntCiSec"><h4>${icon('layers')}${esc(tl('Usage du plan'))}</h4>
      <div class="ntCiModes" role="radiogroup" aria-label="${esc(tl('Usage du plan'))}">
        <label class="ntCiMode${W.mode === 'bg' ? ' on' : ''}"><input type="radio" name="cimode" value="bg"${W.mode === 'bg' ? ' checked' : ''}><b>${esc(tl('Fond de plan seulement'))}</b><span>${esc(tl('Calque de référence sous le dessin, léger et rapide ; vous dessinez murs et pièces par-dessus avec l’aimantation sur ses traits.'))}</span></label>
        <label class="ntCiMode${W.mode === 'convert' ? ' on' : ''}${convOk ? '' : ' off'}"><input type="radio" name="cimode" value="convert"${W.mode === 'convert' ? ' checked' : ''}${convOk ? '' : ' disabled'}><b>${esc(tl('Fond + conversion en modèle'))}</b><span>${esc(convOk ? tl('Murs, portes, pièces, prises… créés depuis les calques choisis, à vérifier à l’étape suivante.') : tl('La conversion n’est pas disponible dans cette version.'))}</span></label>
      </div></section>
      <section class="ntCiSec"><h4>${icon('info')}${esc(tl('Résumé'))}</h4><dl class="ntCiDl">
        <dt>${esc(tl('Zone'))}</dt><dd>${esc(tl('{0} × {1} m', nf((r[2] - r[0]) * m, 1), nf((r[3] - r[1]) * m, 1)))}</dd>
        <dt>${esc(tl('Calques'))}</dt><dd>${nf(W.layers.size)}</dd>
        <dt>${esc(tl('Entités'))}</dt><dd>${esc(kfmt(segs))}</dd>
        <dt>${esc(tl('Taille estimée'))}</dt><dd>${esc(bytesFmt(LG.estimateBytes(segs, 0)))}</dd></dl></section>`;
  }

  /* ---------- Événements ---------- */
  dlg.addEventListener('click', e => {
    const t = e.target.closest('[data-ci],[data-cistep],[data-cisheet],[data-cipreset],[data-cikind],[data-cigrp],[data-cidim]'); if (!t) return;
    if (t.dataset.cistep) { go(t.dataset.cistep); return; }
    if (t.dataset.cisheet) { if (t.dataset.cisheet === 'all') { W.region = W.doc.extents.slice(); W.sheet = -1; W.inRegion = null; fitTo(W.region); paintSide(); } else { selectSheet(+t.dataset.cisheet); } paintPrev(); return; }
    if (t.dataset.cipreset) { W.preset = t.dataset.cipreset; W.layers = LG.presetLayers(W.doc.layers, W.preset); repaintLayers(); return; }
    if (t.dataset.cikind) { const ids = W.doc.layers.filter(l => l.kind === t.dataset.cikind && (!W.hideEmpty || computeRegion().n[l.id])).map(l => l.id), all = ids.every(id => W.layers.has(id)); for (const id of ids) all ? W.layers.delete(id) : W.layers.add(id); W.preset = ''; repaintLayers(); return; }
    if (t.dataset.cigrp) { W.open.has(t.dataset.cigrp) ? W.open.delete(t.dataset.cigrp) : W.open.add(t.dataset.cigrp); repaintLayers(); return; }
    if (t.dataset.cidim) { const id = +t.dataset.cidim; W.dims.has(id) ? W.dims.delete(id) : W.dims.add(id); repaintLayers(); return; }
    const a = t.dataset.ci;
    if (a === 'close' || a === 'cancel') close();
    else if (a === 'next') next();
    else if (a === 'back') back();
    else if (a === 'pick') pick();
    else if (a === 'abort') { if (W.abort) W.abort.abort(); }
    else if (a === 'fit') fitTo(W.step === 'zone' ? W.doc.extents : W.region);
    else if (a === 'zin') zoomAt(1.4); else if (a === 'zout') zoomAt(1 / 1.4);
    else if (a === 'box') setBox(!W.box);
    else if (a === 'allOn' || a === 'allOff') {
      const cnt = computeRegion().n, hit = W.q.trim() ? LG.searchLayers(W.doc.layers, W.q) : null;
      for (const l of W.doc.layers) if ((!hit || hit.has(l.id)) && (!W.hideEmpty || cnt[l.id])) a === 'allOn' ? W.layers.add(l.id) : W.layers.delete(l.id);
      W.preset = ''; repaintLayers();
    }
  });
  fileEl.addEventListener('click', e => { if (e.target.classList.contains('ntCiDrop')) input.click(); });
  dlg.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.ciu != null) { W.units = t.value; W.toMetre = LG.UNIT_M[t.value]; W.unitsFrom = W.unitsFrom === 'header' ? 'header' : 'user'; paintSide(); paintPrevInfo(); return; }
    if (t.dataset.cilay != null) { const id = +t.dataset.cilay; t.checked ? W.layers.add(id) : W.layers.delete(id); W.preset = ''; repaintLayers(); return; }
    if (t.dataset.cigrpchk != null) { const g = findNode(W.tree, t.dataset.cigrpchk); if (g) { const cnt = computeRegion().n; for (const id of LG.nodeLayers(g)) if (!W.hideEmpty || cnt[id]) t.checked ? W.layers.add(id) : W.layers.delete(id); } W.preset = ''; repaintLayers(); return; }
    if (t.dataset.ci === 'hideEmpty') { W.hideEmpty = t.checked; repaintLayers(); return; }
    if (t.name === 'cimode') { W.mode = t.value; paintSide(); return; }
    if (t.dataset.cid) {
      const D = W.dest, k = t.dataset.cid;
      if (k === 'bld') { D.bld = t.value; const b = ctx.data().site.buildings.find(x => x.id === D.bld); D.floor = b && b.floors.find(f => !(ctx.data().underlays || {})[f.id]) ? b.floors.find(f => !(ctx.data().underlays || {})[f.id]).id : 'new'; syncNewFloor(); }
      else if (k === 'floor') { D.floor = t.value; syncNewFloor(); }
      else if (k === 'level') { D.level = Math.max(-10, Math.min(200, Math.round(+t.value || 0))); }
      else if (k === 'elev') { const v = +String(t.value).replace(',', '.'); if (Number.isFinite(v)) D.elev = Math.max(-500, Math.min(2000, v)); }
      else D[k] = t.value;
      paintSide();
    }
  });
  const findNode = (n, key) => { for (const g of n.groups) { if (g.key === key) return g; const r = findNode(g, key); if (r) return r; } return null; };

  /* ---------- Conversion (étape fournie par le module de conversion) ---------- */
  Promise.all([mod('../cad/convert.js'), mod('./cadconvert.js')]).then(([c, ui]) => { W.conv = c && ui && ui.createConvertStep ? { c, ui } : null; if (W.step === 'dest') paintSide(); }).catch(() => {});
  function showConvert() {
    let host = dlg.querySelector('.ntCiConv');
    if (!host) { host = document.createElement('section'); host.className = 'ntCiConv'; main.appendChild(host); }
    host.hidden = false;
    if (!W.convUi && W.conv) {
      try { W.convUi = W.conv.ui.createConvertStep(host, { ctx, doc: W.doc, region: W.region, layers: W.layers, toMetre: W.toMetre, kinds: Object.fromEntries(W.doc.layers.map(l => [l.id, l.kind])), counts: Object.fromEntries(W.doc.layers.map(l => [l.id, computeRegion().n[l.id] || 0])) }); } // (counts : entités du fichier par calque dans la zone)
      catch (e) { console.error(e); host.innerHTML = `<p class="ntCiErr">${esc(tl('L’étape de conversion n’a pas pu s’ouvrir.'))}</p>`; }
    }
  }

  /* ---------- Import ---------- */
  /** En-tête du paquet gardé dans le modèle (donc dans l'historique) : sans la table des calques, déjà dans underlay.layers. */
  const packHead = m => { const o = { ...(m || {}) }; delete o.layers; return o; };
  async function doImport() {
    if (W.busy || !W.doc || !W.region || !W.layers.size) return;
    const t0 = performance.now();
    W.busy = { t0, label: tl('Compression du fond'), f: null };
    paintSteps(); msg(tl('Compression du fond…'));
    try {
      const um = await mod('../cad/underlay.js'); if (!um || !um.packUnderlay) throw new Error(tl('Le module des fonds de plan n’est pas disponible.'));
      await new Promise(r => setTimeout(r, 20));
      const pk = um.packUnderlay(W.doc, { region: W.region, layers: new Set(W.layers), toMetre: W.toMetre, ents: true }); // (ents : poignées DXF pour comparer les versions, si le paquet les porte)
      const url = await bytesToDataUrl(pk.bytes);
      if (!alive) return;
      // Le modèle : bâtiment et étage (créés au besoin), fond, données binaires ; puis la conversion éventuelle.
      const d = ctx.data(), D = W.dest, used = siteIds(d.site);
      let b = d.site.buildings.find(x => x.id === D.bld);
      if (!b) { const n = d.site.buildings.length; b = { id: uid('', 'B', used), name: String(D.bldName || '').trim().slice(0, 40) || tl('Bâtiment {0}', n + 1), x: n ? Math.max(...d.site.buildings.map(x => x.x)) + 80 : 0, y: 0, floors: [] }; d.site.buildings.push(b); }
      let f = b.floors.find(x => x.id === D.floor);
      if (!f) {
        const ref = b.floors[b.floors.length - 1];
        f = { id: uid('', 'F', used), name: String(D.floorName || '').trim().slice(0, 40) || tl('Niveau {0}', D.level), level: D.level, elev: D.elev, height: ref ? ref.height : 3.5, ceil: ref ? ref.ceil : 2.7, plenum: ref ? ref.plenum : 0.6, raised: ref ? ref.raised : 0, walls: [], doors: [], rooms: [] };
        b.floors.push(f); b.floors.sort((x, y) => x.level - y.level);
      } else f.elev = D.elev;
      d.underlays = d.underlays || {}; d.blobs = d.blobs || {};
      const old = d.underlays[f.id]; if (old) { rememberBlob(old.id, d.blobs[old.id]); delete d.blobs[old.id]; } // « annuler » le retrouve
      const id = newBlobId(), byId = new Map(W.doc.layers.map(l => [l.id, l]));
      const packed = (pk.meta && Array.isArray(pk.meta.layers) ? pk.meta.layers : [...W.layers].map(i => byId.get(i)).filter(Boolean));
      const layers = packed.map((l, i) => { const src = byId.get(l.src ?? l.id) || l; return { id: l.id ?? i, name: l.name ?? src.name, color: l.color || src.color, on: true, dim: W.dims.has(src.id) }; });
      const st = pk.meta || {}, sheet = W.sheet >= 0 ? sheets().indexOf(W.sheet) + 1 : 0;
      const u = cleanUnderlay({
        id, name: W.name.replace(/\.(dxf|dwg)$/i, '') + (sheet ? ' · ' + tl('feuille {0}', sheet) : ''), on: true,
        source: { file: W.name, units: W.units, insunits: W.doc.insunits || 0 }, origin: W.doc.origin, toMetre: W.toMetre, region: W.region,
        transform: { dx: 0, dy: 0, rot: 0, scale: 1 }, layers, mono: false, opacity: 0.85, pack: packHead(pk.meta),
        stats: { segs: st.segs ?? st.nSegs ?? 0, texts: st.texts ?? st.nTexts ?? 0, bytes: pk.bytes.length }
      });
      d.blobs[id] = url; d.underlays[f.id] = u; rememberBlob(id, url); // (« annuler » puis « rétablir » l'import)
      // Conversion en modèle (murs, portes, pièces…) : l'étape l'applique sur le même modèle, avant l'unique commit.
      let conv = null;
      if (W.mode === 'convert' && W.convUi && W.convUi.apply) { try { conv = W.convUi.apply(d, f, u); } catch (e) { console.error(e); } }
      // Pièces nommées depuis les textes : les calques de textes sont masqués (sinon double écriture), à réafficher d'un clic.
      let hid = [];
      if (conv && conv.counts && conv.counts.rooms > 0) { const k = new Map(W.doc.layers.map(l => [l.name, l.kind])); for (const l of u.layers) if (k.get(l.name) === 'text' && l.on) { l.on = false; hid.push(l.id); } }
      cadSession.coach = { floor: f.id, mode: conv ? 'convert' : 'bg', counts: conv && conv.counts, hid };
      ctx.commit();
      const ms = performance.now() - t0, fid = f.id;
      W.lastImport = { ms, bytes: pk.bytes.length, segs: u.stats.segs, floor: fid };
      close();
      ctx.openView('plan').then(v => { if (v && v.reveal) v.reveal(fid); }).catch(() => {});
      ctx.status(tl('Fond importé sur {0} : {1}, {2}.', f.name, bytesFmt(pk.bytes.length), secs(ms)) + (conv && conv.summary ? ' ' + conv.summary : '') + (hid.length ? ' ' + tl('Calques de textes masqués (les pièces portent les noms).') : ''), 'ok');
      if (import.meta.env && import.meta.env.DEV && window.__jollof) window.__jollof.cadImportLast = W.lastImport;
    } catch (e) {
      console.error(e); W.busy = null; paintSteps(); msg((e && e.message) || String(e), 'err');
    }
  }

  /* ---------- Départ ---------- */
  paintSteps(); paintFile();
  setTimeout(() => { const z = fileEl.querySelector('[data-ci="pick"]'); if (z) z.focus({ preventScroll: true }); }, 30);
  if (file) readFile(file);
  const api = { close, state: () => W };
  if (import.meta.env && import.meta.env.DEV && window.__jollof) window.__jollof.cadWizard = api; // (essais automatiques)
  return api;
}
