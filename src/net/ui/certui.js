// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Testeur de certification (fenêtre) et onglet « Tests » de la vue Conception : autotest d'un lien permanent ou d'un canal
// contre une limite (Cat 5e, Cat 6, Cat 6A ; lien permanent ou canal), verdict PASS / PASS* / FAIL* / FAIL, marge la plus
// faible, courbes (affaiblissement, NEXT, PS NEXT, ACR-F, PS ACR-F, réflexion) et tableau des paires ; « Tester tout » sur
// les liens du plan, avec progression, résultats rangés dans data.tests (un seul ctx.commit()) ; export CSV et rapport
// imprimable. Les valeurs sont SIMULÉES par le modèle de src/net/certify.js (dit à l'écran) : ce n'est pas une mesure.
// Notre propre dessin : boîtier d'appareil générique, rien d'emprunté à un testeur du commerce.
// Points d'entrée : openCert(ctx, { cables?, port?, link?, limit?, batch? }), renderCertTab(ctx, el), registerCertCommands(ctx).
import { tl } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { overlay } from './crimp.js';
import {
  certLinks, certify, defaultLimit, linkLabel, LIMIT_IDS, limitInfo, DB_PARAMS, paramName, verdictText, chartSvg, seriesOf,
  paramsTable, testState, storeResults, resultRow, testsCsv, reportHtml, BAND_DEFAULT, fmtNum, limitsNote, modelNote
} from '../certify.js';
import { faultText } from '../issues.js';
import { isExam } from '../exam.js';
import { measuredByLink, measuredStats } from '../measured.js';
import './measured.css';
import './cert.css';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d = 1) => (v !== '' && v != null && Number.isFinite(+v) ? fmtNum(v, d) : '—');
const VCLS = { pass: 'ok', 'pass*': 'mg', 'fail*': 'mgbad', fail: 'bad' };
const chip = v => (v ? `<span class="ntCeV ${VCLS[v] || ''}">${verdictText(v)}</span>` : `<span class="ntCeV none">${tl('non testé')}</span>`);
/** Sens de l'astérisque (ANSI/TIA-1152) : légende de l'onglet Tests. */
const STAR_TIP = () => tl('PASS* / FAIL* : marge plus petite que la précision du testeur. PASS* reste conforme, FAIL* compte comme un échec.');
const kindText = k => (k === 'pl' ? tl('lien permanent') : tl('canal'));
const dateText = at => (at ? String(at).slice(0, 16).replace('T', ' ') : '');

/* ---------- Noms des liens : schéma d'étiquetage de la conception (docs.js) s'il existe ---------- */
const DOCS = import.meta.glob('../docs.js');
let docs = null;
function loadDocs() { const f = DOCS['../docs.js']; if (!f || docs) return Promise.resolve(docs); return f().then(m => (docs = m)).catch(() => null); }
let lab = { d: null, t: 0, L: null };
function labelOf(ctx, link) {
  const d = ctx.data();
  if (docs && docs.labeler) {
    try {
      // Un étiqueteur par plan, gardé un instant : une liste de 600 liens ne le reconstruit pas 600 fois.
      if (lab.d !== d || Date.now() - lab.t > 400) lab = { d, t: Date.now(), L: docs.labeler(d) };
      if (link.kind === 'pl') { const t = lab.L.cable(link.cables[0]); if (t && typeof t === 'string') return t; }
      if (link.kind === 'ch') { const [a, b] = link.ends.map(([n, p]) => lab.L.of(n, p)); if (typeof a === 'string' && typeof b === 'string' && a && b) return tl('{0} ↔ {1}', a, b); }
    } catch (e) { /* schéma indisponible : noms des équipements */ }
  }
  return linkLabel(d, link);
}

/* ---------- Commandes de la palette ---------- */
let cmdCtx = null;
/** Commandes « Certifier tous les liens » et « Ouvrir le testeur de certification » (une fois par plan de travail). */
export function registerCertCommands(ctx) {
  if (cmdCtx === ctx || !ctx || !ctx.app || !ctx.app.commands) return;
  cmdCtx = ctx;
  ctx.app.commands.register([
    { id: 'net.cert.all', cat: tl('Réseau'), icon: 'certifier', label: tl('Certifier tous les liens'), when: () => ctx.isOn(), run: () => openCert(ctx, { batch: true }) },
    { id: 'net.cert.open', cat: tl('Réseau'), icon: 'certifier', label: tl('Ouvrir le testeur de certification'), when: () => ctx.isOn(), run: () => openCert(ctx, {}) }
  ]);
}

/* ---------- Lot de tests ---------- */
/** Limite d'un lien dans un lot : catégorie choisie (ou automatique : dernier test, sinon catégorie du lien) et sa configuration. */
function limitFor(link, choice, stored) {
  if (choice && choice !== 'auto') { const cat = choice.split('-')[0]; return cat + '-' + link.kind; }
  return stored && stored.limit && stored.limit.endsWith('-' + link.kind) ? stored.limit : defaultLimit(link);
}
/**
 * Teste les liens par tranches (l'interface reste fluide), range les résultats dans data.tests, un seul ctx.commit().
 * Rend { stop() }. cb : { progress(i, n), done(rows | null) }.
 */
function runBatch(ctx, links, { band, choice }, cb) {
  let i = 0, stopped = false;
  const rows = [], at = new Date().toISOString(), stored = new Map(((ctx.data().tests || {}).results || []).map(r => [r.link, r]));
  const step = () => {
    if (stopped) { cb.done(null); return; }
    const t0 = performance.now();
    while (i < links.length && performance.now() - t0 < 14) {
      const l = links[i++], r = certify(l, limitFor(l, choice, stored.get(l.id)), { band });
      rows.push(resultRow(r, l, labelOf(ctx, l), at));
    }
    cb.progress(i, links.length);
    if (i < links.length) { setTimeout(step, 0); return; }
    const t = storeResults(ctx.data(), rows, at); t.band = band;
    ctx.commit();
    cb.done(rows);
  };
  setTimeout(step, 0);
  return { stop() { stopped = true; } };
}
const scopeLinks = (links, scope) => (scope === 'all' ? links : links.filter(l => l.kind === scope));

/* ---------- Export ---------- */
function tableRows(ctx, scope = 'all') {
  const st = testState(ctx.data()), M = isExam(ctx.data()) ? new Map() : measuredByLink(ctx.data());
  return st.rows.filter(r => scope === 'all' || r.link.kind === scope).map(r => {
    const l = r.link, s = r.stored, meas = M.get(l.id) || null;
    return s ? { ...s, label: labelOf(ctx, l), stale: r.stale, meas } : { meas, link: l.id, kind: l.kind, label: labelOf(ctx, l), limit: defaultLimit(l), verdict: '', margin: '', param: '', pair: '', f: '', len: +l.len.toFixed(1), at: '', stale: false };
  });
}
async function save(text, name, type, label, ext) {
  const native = await import('../../native.js');
  return native.saveFile(new Blob([text], { type }), name, label, ext);
}
const baseName = ctx => String((ctx.app && ctx.app.projectTitle && ctx.app.projectTitle()) || tl('reseau')).replace(/[\\/:*?"<>|]+/g, '-');
async function exportCsv(ctx, scope) {
  const p = await save('﻿' + testsCsv(tableRows(ctx, scope), { exam: isExam(ctx.data()) }), `${baseName(ctx)}-${tl('certification')}.csv`, 'text/csv', tl('Tableau CSV'), 'csv');
  if (p) ctx.status(tl('Résultats exportés : {0}', p), 'ok');
}
async function exportReport(ctx, scope) {
  const data = ctx.data(), st = testState(data), band = (data.tests && data.tests.band) ?? BAND_DEFAULT;
  const rows = tableRows(ctx, scope).filter(r => r.verdict); // testé (verdict enregistré), même en mode examen où il n'est pas montré
  const labels = new Map(st.rows.map(r => [r.link.id, labelOf(ctx, r.link)]));
  const measured = isExam(data) ? [] : ((data.measured && data.measured.results) || []).map(r => ({ ...r, label: labels.get(r.link) || '' }));
  if (!rows.length && !measured.length) { ctx.status(tl('Aucun résultat à mettre dans le rapport : lancez d’abord « Tester tout ».'), 'warn'); return; }
  const details = rows.map(r => { const l = st.rows.find(x => x.link.id === r.link).link; return { label: r.label, res: certify(l, r.limit, { band, curves: true }) }; });
  const html = reportHtml({ title: tl('Rapport de certification'), project: baseName(ctx), at: (data.tests && data.tests.at) || new Date().toISOString(), rows, details, exam: isExam(data), measured, measuredInfo: data.measured });
  const p = await save(html, `${baseName(ctx)}-${tl('rapport-certification')}.html`, 'text/html', tl('Rapport HTML'), 'html');
  if (p) ctx.status(tl('Rapport enregistré : {0} (ouvrez-le dans un navigateur pour l’imprimer)', p), 'ok');
}

/** Cellule « Mesuré » de l'onglet Tests : verdict du testeur, marge, longueur. */
function measCell(m) {
  if (!m) return '<td></td>';
  return `<td data-tip="${esc([m.limit, m.tester, dateText(m.at)].filter(Boolean).join(' · '))}">${chip(m.verdict)}<span class="ntMsTag real">${tl('mesuré')}</span>${m.margin == null ? '' : ' ' + num(m.margin) + ' dB'}${m.len == null ? '' : ' · ' + num(m.len) + ' m'}</td>`;
}
/** Encart d'un résultat MESURÉ par un vrai testeur (importé), à côté des valeurs simulées : jamais confondus. */
function measBox(m) {
  if (!m) return '';
  const bits = [m.limit, m.margin == null ? '' : tl('marge {0} dB', num(m.margin)) + (m.param && m.param !== 'length' && m.param !== 'wiremap' ? ' (' + paramName(m.param) + ')' : ''), m.len == null ? '' : tl('{0} m', num(m.len))].filter(Boolean);
  return `<div class="ntMsBox"><b>${tl('Mesuré (testeur réel)')}</b>${chip(m.verdict)} ${esc(bits.join(' · '))}<small>${esc([m.tester, m.serial, m.operator, dateText(m.at), tl('identifiant {0}', m.cableId)].filter(Boolean).join(' · '))}</small></div>`;
}
/* ---------- Fenêtre du testeur ---------- */
let open = null;
const PARAM_TABS = ['il', 'next', 'psnext', 'acrf', 'psacrf', 'rl'];
const pairsText = pins => pins.join(', ');

/**
 * Ouvre le testeur de certification. opts : { link (id d'un lien de certLinks), cables ([ids] : le lien qui les contient),
 * port ([équipement, port] : le canal de ce port), limit (id de limite), batch (true : lance « Tester tout ») }. Rend { close() }.
 */
export function openCert(ctx, opts = {}) {
  registerCertCommands(ctx);
  if (open) open.close();
  const data = () => ctx.data();
  let links = certLinks(data());
  const pick = () => {
    if (opts.link) return links.find(l => l.id === opts.link);
    if (opts.cables && opts.cables.length) { const ids = new Set(opts.cables); return links.find(l => l.kind === 'pl' && ids.has(l.cables[0].id)) || links.find(l => opts.cables.every(c => l.cables.some(x => x.id === c))); }
    if (opts.port) { const [n, p] = opts.port; return links.find(l => l.kind === 'ch' && l.ends.some(e => e[0] === n && e[1] === p)) || links.find(l => l.cables.some(c => (c.a[0] === n && c.a[1] === p) || (c.b[0] === n && c.b[1] === p))); }
    return links.find(l => l.kind === 'pl') || links[0];
  };
  const tests = data().tests;
  const S = { link: pick(), limit: opts.limit && limitInfo(opts.limit) ? opts.limit : 'auto', band: tests ? tests.band : BAND_DEFAULT, res: null, tab: 'next', only: null, busy: false, batch: null, scope: 'pl', summary: null };
  if (S.link && !links.some(l => l.kind === 'pl')) S.scope = 'ch';
  // Fenêtre modale centrée sur toute la fenêtre de l'application (pas seulement la colonne centrale) : les panneaux
  // latéraux sont recouverts par le voile, le graphique garde sa hauteur même sur un petit écran.
  const hostEl = document.createElement('div'); hostEl.className = 'ntCeHost'; document.body.appendChild(hostEl);
  const O = overlay(hostEl, { label: tl('Testeur de certification'), cls: 'ntCeOv' });
  const { dlg } = O;
  dlg.classList.add('ntCeDlg');
  dlg.innerHTML = `<div class="nt-hd">${icon('certifier')}<div class="nt-ttl"><b>${tl('Testeur de certification')}</b><span>${tl('Valeurs simulées par un modèle à partir du plan : ce n’est pas une mesure')}</span></div><button type="button" class="nt-x" data-a="close" aria-label="${tl('Fermer')}" data-tip="${tl('Fermer · Échap')}">${icon('x')}</button></div>
    <div class="nt-body ntCeBody">
      <aside class="ntCeSide">
        <label class="ntCeFld"><span>${tl('Lien à tester')}</span><select class="sel" data-k="link"></select></label>
        <label class="ntCeFld"><span>${tl('Limite de test')}</span><select class="sel" data-k="limit"><option value="auto">${tl('Automatique (catégorie du lien)')}</option>${LIMIT_IDS.map(id => `<option value="${id}">${esc(limitInfo(id).name)}</option>`).join('')}</select></label>
        <label class="ntCeFld"><span>${tl('Précision du testeur (dB)')}</span><input class="inp" type="number" min="0" max="3" step="0.1" data-k="band"><small>${tl('Réglage : un résultat plus proche de la limite est marqué d’un astérisque (PASS*, FAIL*).')}</small></label>
        <button type="button" class="btn primary ntCeGo" data-a="test">${icon('play')}<span>${tl('Autotest')}</span><kbd class="nt-kbd">↵</kbd></button>
        <div class="ntCeSep"></div>
        <label class="ntCeFld"><span>${tl('Lot à tester')}</span><select class="sel" data-k="scope"><option value="pl">${tl('Liens permanents')}</option><option value="ch">${tl('Canaux')}</option><option value="all">${tl('Tous les liens')}</option></select></label>
        <button type="button" class="btn" data-a="all">${icon('certifier')}<span>${tl('Tester tout')}</span></button>
        <div class="ntCeProg" hidden><div class="ntCeBar"><i></i></div><span></span><button type="button" class="btn small subtle" data-a="stop">${tl('Arrêter')}</button></div>
        <details class="ntCeMethod"><summary>${tl('Méthode')}</summary><p class="ntCeNote">${esc(modelNote())}</p><p class="ntCeNote">${esc(limitsNote())}</p></details>
      </aside>
      <section class="ntCeMain" aria-live="polite"></section>
    </div>
    <div class="nt-ft"><span class="ntCeMsg"></span><span class="nt-sp"></span><button type="button" class="btn" data-a="csv">${icon('download')}<span>${tl('Exporter CSV')}</span></button><button type="button" class="btn" data-a="report">${icon('clipboard')}<span>${tl('Rapport imprimable')}</span></button><button type="button" class="btn primary" data-a="save" disabled>${icon('check')}<span>${tl('Enregistrer le résultat')}</span></button></div>`;
  const $ = s => dlg.querySelector(s), main = $('.ntCeMain');
  const fillLinks = () => {
    const st = testState(data()), by = new Map(st.rows.map(r => [r.link.id, r]));
    const ex = isExam(data()); // mode examen : « testé » au lieu du verdict
    const opt = l => { const r = by.get(l.id), s = r && r.stored; return `<option value="${esc(l.id)}"${S.link && S.link.id === l.id ? ' selected' : ''}>${esc(labelOf(ctx, l))}${s ? ' — ' + (ex ? tl('testé') : verdictText(s.verdict)) + (r.stale ? ' ' + tl('(périmé)') : '') : ''}</option>`; };
    const pl = links.filter(l => l.kind === 'pl'), ch = links.filter(l => l.kind === 'ch');
    $('[data-k="link"]').innerHTML = links.length ? `${pl.length ? `<optgroup label="${tl('Liens permanents')}">${pl.map(opt).join('')}</optgroup>` : ''}${ch.length ? `<optgroup label="${tl('Canaux')}">${ch.map(opt).join('')}</optgroup>` : ''}` : `<option value="">${tl('Aucun lien en cuivre dans le plan')}</option>`;
  };
  fillLinks();
  loadDocs().then(() => { if (O.isOpen()) { fillLinks(); paint(); } });
  $('[data-k="limit"]').value = S.limit; $('[data-k="band"]').value = String(S.band); $('[data-k="scope"]').value = S.scope;
  const limitNow = () => (S.limit === 'auto' ? limitFor(S.link, 'auto', ((data().tests || {}).results || []).find(r => r.link === S.link.id)) : S.limit);
  const msg = (t, k = '') => { const m = $('.ntCeMsg'); m.textContent = t; m.className = 'ntCeMsg ' + k; };

  function paint() {
    $('[data-a="save"]').disabled = !S.res || S.busy;
    if (S.busy) { main.innerHTML = `<div class="ntCeScreen run"><div class="ntCeRun"><div class="ntCeBar"><i class="go"></i></div><b>${tl('Autotest en cours…')}</b><span>${esc(labelOf(ctx, S.link))}</span></div></div>`; return; }
    if (S.summary) { main.innerHTML = summaryHtml(S.summary); return; }
    if (!S.link) { main.innerHTML = `<div class="ntCeEmpty">${icon('certifier')}<b>${tl('Aucun lien à certifier')}</b><span>${tl('Un lien permanent relie le dos d’un panneau de brassage au dos d’une prise murale ; un canal va d’un appareil actif à un autre.')}</span></div>`; return; }
    if (!S.res) { main.innerHTML = `<div class="ntCeEmpty">${icon('certifier')}<b>${esc(labelOf(ctx, S.link))}</b><span>${tl('{0} · {1} m · {2}', kindText(S.link.kind), num(S.link.len), esc(limitInfo(limitNow()).name))}</span><span>${tl('Lancez l’autotest (Entrée).')}</span></div>`; return; }
    const r = S.res, li = limitInfo(r.limit), P = r.params;
    if (isExam(data())) { main.innerHTML = examScreen(r, li); return; }
    const weak = r.param === 'wiremap' ? r.wiremap.faults.map(f => `${faultText(f.type)} (${pairsText(f.pins)})`).join(', ') : r.param === 'length' ? tl('longueur {0} m pour {1} m', num(P.length.v), P.length.lim) : tl('{0} {1} à {2} MHz', paramName(r.param), r.pair || '', num(r.f, r.f < 10 ? 2 : 0));
    const tabs = PARAM_TABS.map(p => `<button type="button" role="tab" class="ntCeTb${S.tab === p ? ' on' : ''}" aria-selected="${S.tab === p}" data-tab="${p}"><i class="ntCeDot ${VCLS[P[p].st]}"></i>${esc(paramName(p))}<small>${num(P[p].margin)}</small></button>`).join('');
    const ser = seriesOf(r, S.tab);
    const legend = ser.map((s, i) => `<button type="button" class="ntCeLg${S.only === i ? ' on' : ''}" data-only="${i}"><i class="ntCeSw ntCeS${i}"></i>${esc(s.name)}</button>`).join('') + `<span class="ntCeLg lim"><i class="ntCeSw lim"></i>${tl('limite')}</span>`;
    const wm = r.wiremap.map && r.wiremap.map.length ? `<div class="ntCeWm" aria-label="${tl('Carte de câblage')}">${[1, 2, 3, 4, 5, 6, 7, 8].map(p => `<span class="${r.wiremap.map[p] === p ? 'ok' : 'bad'}"><b>${p}</b><i>${r.wiremap.map[p] ?? '×'}</i></span>`).join('')}</div>` : '';
    main.innerHTML = `<div class="ntCeScreen ${VCLS[r.verdict]}">
        <div class="ntCeVerdict"><b>${verdictText(r.verdict)}</b><span>${r.ok ? tl('conforme à la limite choisie') : tl('non conforme')}</span></div>
        <div class="ntCeFacts"><div><small>${tl('Lien')}</small><b>${esc(labelOf(ctx, S.link))}</b></div><div><small>${tl('Limite')}</small><b>${esc(li.name)}</b></div>
          <div><small>${tl('Marge la plus faible')}</small><b>${num(r.margin, 1)} dB</b><span>${esc(weak)}</span></div><div><small>${tl('Longueur')}</small><b>${num(P.length.v)} m</b><span>${tl('limite {0} m', P.length.lim)}</span></div></div>
        ${wm}<span class="ntCeSim">${tl('valeurs simulées')}</span></div>${measBox(measuredByLink(data()).get(S.link.id))}
      <div class="ntCeTabs" role="tablist" aria-label="${tl('Paramètres')}">${tabs}</div>
      <div class="ntCeChartBox">${chartSvg(r, S.tab, { only: S.only, w: 720, h: 260 })}<div class="ntCeLegend">${legend}</div></div>
      <div class="ntCeTblBox">${paramsTable(r)}</div>`;
  }
  /** Mode examen : mesures, limites, courbes et carte de câblage brute ; ni PASS/FAIL, ni marge, ni défaut nommé. */
  function examScreen(r, li) {
    const P = r.params, tabs = PARAM_TABS.map(p => `<button type="button" role="tab" class="ntCeTb${S.tab === p ? ' on' : ''}" aria-selected="${S.tab === p}" data-tab="${p}">${esc(paramName(p))}</button>`).join('');
    const ser = seriesOf(r, S.tab);
    const legend = ser.map((s, i) => `<button type="button" class="ntCeLg${S.only === i ? ' on' : ''}" data-only="${i}"><i class="ntCeSw ntCeS${i}"></i>${esc(s.name)}</button>`).join('') + `<span class="ntCeLg lim"><i class="ntCeSw lim"></i>${tl('limite')}</span>`;
    const wm = r.wiremap.map && r.wiremap.map.length ? `<div class="ntCeWm" aria-label="${tl('Carte de câblage')}">${[1, 2, 3, 4, 5, 6, 7, 8].map(p => `<span class="raw"><b>${p}</b><i>${r.wiremap.map[p] ?? '×'}</i></span>`).join('')}</div>` : '';
    return `<div class="ntCeScreen none">
        <div class="ntCeVerdict ntCeExam"><b>${icon('lock')}${tl('Mode examen')}</b><span>${tl('mesures sans verdict : comparez-les aux limites')}</span></div>
        <div class="ntCeFacts"><div><small>${tl('Lien')}</small><b>${esc(labelOf(ctx, S.link))}</b></div><div><small>${tl('Limite')}</small><b>${esc(li.name)}</b></div>
          <div><small>${tl('Longueur')}</small><b>${num(P.length.v)} m</b><span>${tl('limite {0} m', P.length.lim)}</span></div></div>
        ${wm}<span class="ntCeSim">${tl('valeurs simulées')}</span></div>${measBox(measuredByLink(data()).get(S.link.id))}
      <div class="ntCeTabs" role="tablist" aria-label="${tl('Paramètres')}">${tabs}</div>
      <div class="ntCeChartBox">${chartSvg(r, S.tab, { only: S.only, w: 720, h: 260 })}<div class="ntCeLegend">${legend}</div></div>
      <div class="ntCeTblBox">${paramsTable(r, { exam: true })}</div>`;
  }
  function summaryHtml(sm) {
    if (isExam(data())) return `<div class="ntCeScreen none"><div class="ntCeVerdict ntCeExam"><b>${icon('lock')}${tl('Mode examen')}</b><span>${tl('{0:# lien testé|# liens testés}', sm.rows.length)}</span></div><span class="ntCeSim">${tl('valeurs simulées')}</span></div>
      <p class="ntCeNote">${tl('Résultats enregistrés sans verdict affiché : ouvrez chaque lien pour lire ses mesures.')}</p>`;
    const c = v => sm.rows.filter(r => r.verdict === v).length, bad = sm.rows.filter(r => r.verdict === 'fail' || r.verdict === 'fail*');
    return `<div class="ntCeScreen ${bad.length ? 'bad' : 'ok'}"><div class="ntCeVerdict"><b>${bad.length ? 'FAIL' : 'PASS'}</b><span>${tl('{0:# lien testé|# liens testés}', sm.rows.length)}</span></div>
      <div class="ntCeFacts"><div><small>PASS</small><b>${c('pass')}</b></div><div><small>PASS*</small><b>${c('pass*')}</b></div><div><small>FAIL*</small><b>${c('fail*')}</b></div><div><small>FAIL</small><b>${c('fail')}</b></div></div><span class="ntCeSim">${tl('valeurs simulées')}</span></div>
      ${bad.length ? `<h4 class="ntCeH">${tl('Liens en échec')}</h4><ul class="ntCeBad">${bad.slice(0, 60).map(r => `<li><button type="button" data-goto="${esc(r.link)}">${chip(r.verdict)}<b>${esc(r.label)}</b><span>${esc(paramName(r.param))}${r.param === 'wiremap' ? '' : `${r.pair ? ' ' + esc(r.pair) : ''} · ${num(r.margin)} ${r.param === 'length' ? 'm' : 'dB'}`}</span></button></li>`).join('')}</ul>` : `<p class="ntCeOk">${icon('check')}${tl('Tous les liens réussissent la certification simulée.')}</p>`}
      <p class="ntCeNote">${tl('Résultats enregistrés dans le projet (onglet Tests de la vue Conception) le {0}.', esc(dateText(sm.at)))}</p>`;
  }
  function autotest() {
    if (!S.link || S.busy || S.batch) return;
    S.busy = true; S.summary = null; paint();
    setTimeout(() => {
      S.busy = false;
      if (!O.isOpen()) return;
      S.res = certify(S.link, limitNow(), { band: S.band, curves: true });
      // Onglet du paramètre le plus faible ; en mode examen, pas d'indice : on reste sur NEXT.
      if (isExam(data())) S.tab = PARAM_TABS.includes(S.tab) ? S.tab : 'next';
      else if (!S.res.params[S.tab] || S.tab === 'next') S.tab = S.res.param && PARAM_TABS.includes(S.res.param) ? S.res.param : 'next';
      S.only = null; paint();
      if (isExam(data())) { msg(tl('Autotest terminé. Enregistrez le résultat pour le rapport.'), ''); if (ctx.app && ctx.app.log) ctx.app.log(tl('Certification · {0} ({1}) : autotest terminé', labelOf(ctx, S.link), limitInfo(S.res.limit).name), 'info'); return; }
      msg(tl('Autotest terminé : {0}. Enregistrez le résultat pour le rapport.', verdictText(S.res.verdict)), S.res.ok ? 'ok' : 'err');
      if (ctx.app && ctx.app.log) ctx.app.log(tl('Certification · {0} ({1}) : {2}, marge {3} dB', labelOf(ctx, S.link), limitInfo(S.res.limit).name, verdictText(S.res.verdict), num(S.res.margin)), S.res.ok ? 'ok' : 'err');
    }, 650);
  }
  function batch() {
    if (S.batch || S.busy) return;
    links = certLinks(data());
    const list = scopeLinks(links, S.scope);
    if (!list.length) { msg(tl('Aucun lien de ce genre dans le plan.'), 'warn'); return; }
    const prog = $('.ntCeProg'); prog.hidden = false; S.res = null; S.summary = null; paint();
    S.batch = runBatch(ctx, list, { band: S.band, choice: S.limit }, {
      progress(i, n) { prog.querySelector('i').style.width = (100 * i / n).toFixed(1) + '%'; prog.querySelector('span').textContent = tl('{0} / {1} liens', i, n); },
      done(rows) {
        S.batch = null; prog.hidden = true;
        if (!O.isOpen()) return;
        if (!rows) { msg(tl('Lot arrêté : rien n’a été enregistré.'), 'warn'); return; }
        links = certLinks(data()); fillLinks();
        S.summary = { rows, at: rows[0] ? rows[0].at : '' }; paint();
        msg(tl('{0:# lien testé|# liens testés}, résultats enregistrés (Ctrl+Z pour annuler).', rows.length), 'ok');
      }
    });
  }
  dlg.addEventListener('click', e => {
    const a = e.target.closest('[data-a]'), tb = e.target.closest('[data-tab]'), only = e.target.closest('[data-only]'), go = e.target.closest('[data-goto]');
    if (tb) { S.tab = tb.dataset.tab; S.only = null; paint(); return; }
    if (only) { const i = +only.dataset.only; S.only = S.only === i ? null : i; paint(); return; }
    if (go) { S.link = links.find(l => l.id === go.dataset.goto) || S.link; S.summary = null; fillLinks(); autotest(); return; }
    if (!a) return;
    const k = a.dataset.a;
    if (k === 'close') close();
    else if (k === 'test') autotest();
    else if (k === 'all') batch();
    else if (k === 'stop' && S.batch) S.batch.stop();
    else if (k === 'csv') exportCsv(ctx, 'all');
    else if (k === 'report') exportReport(ctx, 'all');
    else if (k === 'save' && S.res) {
      storeResults(data(), [resultRow(S.res, S.link, labelOf(ctx, S.link), new Date().toISOString())]);
      data().tests.band = S.band; ctx.commit(); links = certLinks(data()); S.link = links.find(l => l.id === S.res.link) || S.link; fillLinks();
      msg(tl('Résultat enregistré dans le rapport du projet.'), 'ok');
    }
  });
  dlg.addEventListener('change', e => {
    const k = e.target.dataset.k;
    if (k === 'link') { S.link = links.find(l => l.id === e.target.value) || S.link; S.res = null; S.summary = null; paint(); }
    else if (k === 'limit') { S.limit = e.target.value; if (S.res) S.res = null; paint(); }
    else if (k === 'band') { S.band = Math.max(0, Math.min(3, +e.target.value || 0)); e.target.value = String(S.band); if (S.res) S.res = certify(S.link, S.res.limit, { band: S.band, curves: true }); paint(); }
    else if (k === 'scope') S.scope = e.target.value;
  });
  dlg.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Enter' && !/^(SELECT|INPUT|BUTTON|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); autotest(); }
  });
  function close() { if (S.batch) S.batch.stop(); O.close(); hostEl.remove(); if (open === api) open = null; }
  const api = { close, autotest, batch, state: () => S };
  open = api;
  paint();
  dlg.focus();
  if (opts.batch) batch();
  return api;
}

/* ---------- Onglet « Tests » de la vue Conception ---------- */
/** Onglet « Tests » de la vue Conception (design.js) : certification de tous les liens, rapport. Rend { render(), destroy() }. */
export function renderCertTab(ctx, el) {
  registerCertCommands(ctx);
  const S = { scope: 'all', job: null, filter: 'all' };
  el.classList.add('ntCeTab');
  const draw = () => {
    const data = ctx.data(), st = testState(data), ex = isExam(data); // mode examen : testé ou non, sans verdict
    if (ex && S.filter === 'bad') S.filter = 'all';
    const rows = st.rows.filter(r => S.scope === 'all' || r.link.kind === S.scope);
    const n = v => rows.filter(r => r.stored && r.stored.verdict === v).length;
    const untested = rows.filter(r => !r.stored).length, stale = rows.filter(r => r.stale).length;
    const shown = rows.filter(r => S.filter === 'all' || (S.filter === 'bad' ? r.stored && /fail/.test(r.stored.verdict) : S.filter === 'todo' ? !r.stored || r.stale : true));
    const counts = ex ? `<span class="ntCeStat"><b>${rows.length - untested}</b>${tl('testés')}</span><span class="ntCeStat warn">${icon('lock')}${tl('Mode examen')}</span>` : `<span class="ntCeStat ok"><b>${n('pass')}</b>PASS</span><span class="ntCeStat mg" data-tip="${esc(STAR_TIP())}"><b>${n('pass*')}</b>PASS*</span>
        <span class="ntCeStat mgbad" data-tip="${esc(STAR_TIP())}"><b>${n('fail*')}</b>FAIL*</span><span class="ntCeStat bad"><b>${n('fail')}</b>FAIL</span>`;
    const M = ex ? new Map() : measuredByLink(data), ms = measuredStats(data), hasM = !ex && ms.total > 0;
    const head = `<div class="ntCeTabHead"><div class="ntCeStats">
        <span class="ntCeStat"><b>${rows.length}</b>${tl('liens')}</span>${counts}<span class="ntCeStat"><b>${untested}</b>${tl('non testés')}</span>${stale ? `<span class="ntCeStat warn"><b>${stale}</b>${tl('périmés')}</span>` : ''}</div>
      <div class="ntCeTools"><select class="sel" data-k="scope" aria-label="${tl('Liens affichés')}"><option value="all">${tl('Tous les liens')}</option><option value="pl">${tl('Liens permanents')}</option><option value="ch">${tl('Canaux')}</option></select>
        <select class="sel" data-k="filter" aria-label="${tl('Filtre')}"><option value="all">${tl('Tous les résultats')}</option>${ex ? '' : `<option value="bad">${tl('Échecs seulement')}</option>`}<option value="todo">${tl('À tester (jamais ou périmé)')}</option></select>
        <button type="button" class="btn primary" data-a="all">${icon('certifier')}<span>${tl('Tester tout')}</span></button><button type="button" class="btn" data-a="open">${icon('cableTester')}<span>${tl('Testeur')}</span></button>
        <button type="button" class="btn" data-a="measure" data-tip="${esc(tl('Importer les résultats d’un vrai certificateur (export CSV, texte ou XML du logiciel du testeur)'))}">${icon('upload')}<span>${tl('Importer des mesures…')}</span></button>
        <button type="button" class="btn" data-a="csv">${icon('download')}<span>CSV</span></button><button type="button" class="btn" data-a="report">${icon('clipboard')}<span>${tl('Rapport imprimable')}</span></button></div></div>
      <div class="ntCeProg" hidden><div class="ntCeBar"><i></i></div><span></span><button type="button" class="btn small subtle" data-a="stop">${tl('Arrêter')}</button></div>
      ${ex ? '' : `<p class="ntCeKey">${esc(STAR_TIP())}</p>`}
      <p class="ntCeNote">${tl('Certification simulée : les résultats viennent du modèle (catégorie, longueur, sertissage, connexions du plan), pas d’un appareil de mesure.')} ${esc(limitsNote())}${data.tests && data.tests.at ? ' ' + tl('Dernier lot : {0}.', esc(dateText(data.tests.at))) : ''}</p>
      ${hasM ? `<p class="ntCeNote"><span class="ntMsTag real">${tl('mesuré')}</span> ${esc(tl('{0:# résultat mesuré|# résultats mesurés} par un vrai testeur ({1}), dont {2} rattachés à un lien : PASS {3}, PASS* {4}, FAIL* {5}, FAIL {6}.', ms.total, data.measured.file || tl('fichier importé'), ms.linked, ms.pass, ms['pass*'], ms['fail*'], ms.fail))} <button type="button" class="btn small subtle" data-a="measure-clear">${tl('Retirer les mesures')}</button></p>` : ''}`;
    const body = !rows.length
      ? `<div class="ntCeEmpty">${icon('certifier')}<b>${tl('Aucun lien en cuivre à certifier')}</b><span>${tl('Posez un panneau de brassage et des prises murales, reliez le dos de chaque prise au dos du panneau : chaque câble est un lien permanent.')}</span></div>`
      : `<div class="ntCeListBox"><table class="ntCeList"><thead><tr><th>${tl('Lien')}</th><th>${tl('Type')}</th><th>${tl('Limite')}</th><th>${ex ? tl('Résultat') : tl('Résultat simulé')}</th>${ex ? '' : `<th class="n">${tl('Marge')}</th><th>${tl('Paramètre le plus faible')}</th>`}<th class="n">${tl('Longueur')}</th><th>${tl('Date')}</th>${hasM ? `<th>${tl('Mesuré (testeur)')}</th>` : ''}</tr></thead><tbody>${shown.slice(0, 2500).map(r => {
        const s = r.stored, l = r.link;
        if (ex) return `<tr data-link="${esc(l.id)}" tabindex="0"><td class="w">${esc(labelOf(ctx, l))}</td><td>${kindText(l.kind)}</td><td>${esc(limitInfo(s ? s.limit : defaultLimit(l)).name)}</td><td>${s ? `<span class="ntCeV none">${tl('testé')}</span>` : chip(null)}${r.stale ? `<span class="ntCeV warn">${tl('périmé')}</span>` : ''}</td><td class="n">${num(l.len)} m</td><td>${s ? esc(dateText(s.at)) : ''}</td></tr>`;
        return `<tr data-link="${esc(l.id)}" tabindex="0"><td class="w">${esc(labelOf(ctx, l))}</td><td>${kindText(l.kind)}</td><td>${esc(limitInfo(s ? s.limit : defaultLimit(l)).name)}</td><td>${chip(s && s.verdict)}${r.stale ? `<span class="ntCeV warn">${tl('périmé')}</span>` : ''}</td><td class="n">${s && s.param !== 'wiremap' ? num(s.margin) : s ? '—' : ''}</td><td class="w">${s ? esc(paramName(s.param)) + (s.pair ? ' ' + esc(s.pair) : '') : ''}</td><td class="n">${num(l.len)} m</td><td>${s ? esc(dateText(s.at)) : ''}</td>${hasM ? measCell(M.get(l.id)) : ''}</tr>`;
      }).join('')}</tbody></table>${shown.length > 2500 ? `<p class="ntCeNote">${tl('{0} lignes de plus : exportez le CSV pour tout voir.', shown.length - 2500)}</p>` : ''}</div>`;
    el.innerHTML = head + body;
    el.querySelector('[data-k="scope"]').value = S.scope; el.querySelector('[data-k="filter"]').value = S.filter;
  };
  const onClick = e => {
    const a = e.target.closest('[data-a]'), row = e.target.closest('tr[data-link]');
    if (row && !a) { openCert(ctx, { link: row.dataset.link }); return; }
    if (!a) return;
    const k = a.dataset.a;
    if (k === 'open') openCert(ctx, {});
    else if (k === 'measure') import('./measuredui.js').then(m => m.openMeasuredImport(ctx)).then(n => { if (n) draw(); }).catch(err => { console.error(err); ctx.status(tl('Import impossible : {0}', err.message || err), 'err'); });
    else if (k === 'measure-clear') import('./measuredui.js').then(m => { if (m.clearMeasured(ctx)) draw(); });
    else if (k === 'csv') exportCsv(ctx, S.scope);
    else if (k === 'report') exportReport(ctx, S.scope);
    else if (k === 'stop' && S.job) S.job.stop();
    else if (k === 'all' && !S.job) {
      const list = scopeLinks(certLinks(ctx.data()), S.scope); if (!list.length) return;
      const prog = el.querySelector('.ntCeProg'); prog.hidden = false;
      S.job = runBatch(ctx, list, { band: (ctx.data().tests && ctx.data().tests.band) ?? BAND_DEFAULT, choice: 'auto' }, {
        progress(i, n) { const p = el.querySelector('.ntCeProg'); if (!p) return; p.hidden = false; p.querySelector('i').style.width = (100 * i / n).toFixed(1) + '%'; p.querySelector('span').textContent = tl('{0} / {1} liens', i, n); },
        done(rows) { S.job = null; draw(); if (rows) ctx.status(tl('{0:# lien testé|# liens testés}, résultats enregistrés (Ctrl+Z pour annuler).', rows.length), 'ok'); }
      });
    }
  };
  const onKey = e => { const row = e.target.closest && e.target.closest('tr[data-link]'); if (row && e.key === 'Enter') openCert(ctx, { link: row.dataset.link }); };
  const onChange = e => { const k = e.target.dataset.k; if (k === 'scope') { S.scope = e.target.value; draw(); } else if (k === 'filter') { S.filter = e.target.value; draw(); } };
  el.addEventListener('click', onClick); el.addEventListener('keydown', onKey); el.addEventListener('change', onChange);
  let t = 0;
  const off = ctx.onChange ? ctx.onChange(() => { if (S.job) return; clearTimeout(t); t = setTimeout(() => { if (el.isConnected) draw(); }, 150); }) : null;
  loadDocs().then(() => { if (el.isConnected) draw(); });
  draw();
  return {
    render: draw,
    destroy() { if (S.job) S.job.stop(); clearTimeout(t); if (off) off(); el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey); el.removeEventListener('change', onChange); el.classList.remove('ntCeTab'); el.innerHTML = ''; }
  };
}
