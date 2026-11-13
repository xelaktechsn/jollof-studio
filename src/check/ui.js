// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérification dans l'application : une pastille à côté de « Simuler » (✓ vérifié · ✕ N erreurs · ! N avertissements),
// relancée après chaque changement du montage ou du programme, et un rapport à la manière de rustc : code, titre,
// emplacement (cliquable), état qui déclenche la faute, extrait de code souligné, note, aide, correction en un clic,
// explication du code, et « Accepter » pour un avertissement voulu (avec sa raison, enregistrée dans le projet).
import { checkProjectAsync } from './check.js';
import { where, summary, fmtN } from './format.js';
import { explain } from './explain.js';
import { familyOf } from './codes.js';
import { tl, LANG, CANCEL } from '../i18n/index.js';
import { SOURCE_URL } from '../library/credits.js';
import { INSTALLED } from '../library/jpart.js';
/** Page publique : ce que la preuve couvre, les modèles, la comparaison avec ngspice, les sources des limites. */
const PROVEN_URL = `${SOURCE_URL}/blob/main/docs/PROVEN.md`;

/**
 * app : { $, esc, icon, anchor (élément avant lequel poser la pastille), comps(), wires(), programs() → Map,
 *         allow() → [{ code, comp, reason }], setAllow(list), dist(a, b), focus(diag), fix(fault, act), actLabel(act),
 *         goCode(board, line, col) }.
 */
export function installCheck(app) {
  const { esc, icon } = app;
  const chip = document.createElement('button');
  chip.type = 'button'; chip.className = 'tb label checkChip'; chip.id = 'checkChip';
  chip.dataset.tip = tl('Vérifier le montage et le programme dans tous leurs états · F7');
  app.anchor.before(chip);
  const modal = document.createElement('div');
  modal.className = 'modal'; modal.id = 'checkModal'; modal.hidden = true;
  modal.innerHTML = `<div class="sheet checkSheet" role="dialog" aria-modal="true" aria-labelledby="checkTitle">
    <div class="sheetHead"><h2 id="checkTitle">${icon('check')}${tl('Vérification du montage et du programme')}</h2>
      <span class="row"><button type="button" class="btn small" data-c="rerun">${icon('rotate')}<span>${tl('Revérifier')}</span></button><button type="button" class="btn small" data-c="close">${tl('Fermer')}</button></span></div>
    <p class="jsum" data-c="sum"></p>
    <div class="jlist" data-c="list"></div>
    <p class="jmodel" data-c="model"></p>
  </div>`;
  document.body.appendChild(modal);
  const q = k => modal.querySelector(`[data-c="${k}"]`);
  let last = null, timer = 0, gen = 0, ctrl = null, accepting = null;
  const opened = new Set();

  /* ---------- Travailleur en arrière-plan : la preuve ne prend jamais de temps à l'interface ---------- */
  let worker = null, workerOk = typeof Worker !== 'undefined', reqId = 0;
  const waiting = new Map();
  function getWorker() {
    if (!workerOk) return null;
    if (worker) return worker;
    try {
      // Options littérales (Vite analyse cet appel pour construire le travailleur) : la langue part dans le premier message.
      worker = new Worker(new URL('./check.worker.js', import.meta.url), { type: 'module' });
      worker.postMessage({ lang: LANG });
      worker.onmessage = e => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); w(e.data); } };
      worker.onerror = e => { console.warn('vérificateur en arrière-plan indisponible', e.message || e); workerOk = false; worker = null; for (const w of waiting.values()) w({ error: 'worker' }); waiting.clear(); };
    } catch (e) { workerOk = false; worker = null; }
    return worker;
  }
  /** Montage en données simples ; null si un composant importé (profil ou fiche propres) demande le fil principal. */
  function serial(proj) {
    if (proj.comps.some(c => c.custom || c.spec || c.prof)) return null;
    const wires = proj.wires.filter(w => (w.progress ?? 1) >= 1 && w.a && w.b && w.a.comp && w.b.comp);
    return {
      wires,
      data: {
        comps: proj.comps.map(c => ({ id: c.id, type: c.type, name: c.name, pins: Object.keys(c.pins), inp: { ...(c.inp || {}) }, relayOn: c.relayOn, x: c.group.position.x, z: c.group.position.z })),
        wires: wires.map(w => ({ a: [w.a.comp.id, w.a.key], b: [w.b.comp.id, w.b.key] })),
        programs: [...proj.programs], auto: [...(proj.auto || [])], firmware: [...(proj.firmware || [])], allow: proj.allow,
        // Composants en paquet (.jpart) : leurs manifestes vérifiés, que le travailleur installe à son tour.
        packages: [...new Set(proj.comps.map(c => c.type))].filter(t => INSTALLED.has(t)).map(t => INSTALLED.get(t))
      }
    };
  }
  /** Résultat du travailleur : identifiants et rangs remplacés par les vrais composants et fils. */
  function unpack(r, comps, wires) {
    const C = id => comps.find(c => c.id === id) || null;
    const R = x => (x && C(x.$c) ? { comp: C(x.$c), key: x.key } : null);
    const W = i => (i != null && wires[i]) || null;
    for (const d of r.diags) {
      d.loc = { ...d.loc, comp: C(d.loc.comp), board: C(d.loc.board), pins: d.loc.pins.map(R).filter(Boolean) };
      if (d.fault) {
        const f = d.fault;
        d.fault = { ...f, comp: C(f.comp), pins: f.pins.map(R).filter(Boolean), culprits: f.culprits.map(R).filter(Boolean), wires: f.wires.map(W).filter(Boolean), cutWire: W(f.cutWire), other: R(f.other),
          suggest: f.suggest && R(f.suggest.from) && R(f.suggest.to) ? { from: R(f.suggest.from), to: R(f.suggest.to) } : null };
      }
    }
    return r;
  }
  function inWorker(proj) {
    const w = getWorker(), s = w && serial(proj);
    if (!s) return null;
    const id = ++reqId;
    return new Promise(res => {
      waiting.set(id, m => res(m.error ? undefined : unpack(m.result, proj.comps, s.wires)));
      w.postMessage({ id, proj: s.data });
    });
  }

  function paintChip() {
    chip.classList.remove('ok', 'err', 'warn', 'busy');
    if (!last) { chip.classList.add('busy'); chip.innerHTML = `${icon('rotate')}<span>${tl('Vérification…')}</span>`; return; }
    const r = last;
    if (r.errors) { chip.classList.add('err'); chip.innerHTML = `${icon('x')}<span>${tl('{0} erreur{1}', r.errors, r.errors > 1 ? 's' : '')}</span>`; }
    else if (r.warnings) { chip.classList.add('warn'); chip.innerHTML = `${icon('alert')}<span>${tl('Vérifié · {0} avert.', r.warnings)}</span>`; }
    else { chip.classList.add('ok'); chip.innerHTML = `${icon('check')}<span>${tl('Vérifié')}</span>`; }
    chip.dataset.tip = summary(r) + ' · F7';
  }

  /** Lance la vérification (la précédente, si elle tourne encore, est abandonnée). Rend le résultat. */
  async function run() {
    clearTimeout(timer);
    if (ctrl) ctrl.aborted = true;
    const my = ++gen, sig = ctrl = { aborted: false };
    chip.classList.add('busy');
    const proj = { comps: app.comps(), wires: app.wires(), programs: app.programs(), auto: app.auto ? app.auto() : new Set(), firmware: app.firmware ? app.firmware() : new Set(), allow: app.allow() };
    let r = null;
    try {
      r = await inWorker(proj);
      if (r === undefined || r === null) r = await checkProjectAsync(proj, { dist: app.dist }, sig); // repli : sur le fil principal, par tranches
    } catch (e) { console.error(e); }
    if (!r || my !== gen) return last;
    // Diagnostics des autres plans de travail (plan pneumatique, GRAFCET, liaisons avec le montage) : même rapport,
    // même verdict. Une exception acceptée s'y retrouve par sa clé.
    if (app.extra) {
      try {
        const more = app.extra() || [], allow = app.allow();
        for (const d of more) {
          d.loc = { pins: [], ...(d.loc || {}) };
          const ex = explain(d.code); if (ex) { if (!d.note) d.note = ex.why; if (!d.help) d.help = ex.fix; }
          const a = d.level === 'warning' && allow.find(x => x.code === d.code && (x.key ? x.key === d.key : !!(d.loc.comp && x.comp === d.loc.comp.id)));
          d.accepted = a ? a.reason || '' : null;
        }
        if (more.length) {
          const diags = [...r.diags, ...more].sort((x, y) => (x.level === y.level ? (x.accepted == null) - (y.accepted == null) || x.code.localeCompare(y.code) : x.level === 'error' ? -1 : 1));
          r = { ...r, diags, errors: diags.filter(d => d.level === 'error').length, warnings: diags.filter(d => d.level === 'warning' && d.accepted == null).length };
        }
      } catch (e) { console.error(e); }
    }
    last = r; paintChip();
    if (!modal.hidden) render();
    return r;
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 400); };

  function srcBlock(d) {
    const l = d.loc || {};
    if (!l.line || !l.board) return '';
    const text = (app.programs().get(l.board.id) || '').split('\n')[l.line - 1];
    if (text == null) return '';
    const n = String(l.line), pad = ' '.repeat(n.length);
    return `<pre class="jsrc">${esc(`${pad} |\n${n} | ${text}\n${pad} | ${' '.repeat(Math.max(0, (l.col || 1) - 1))}${'^'.repeat(Math.max(1, l.len || 1))}`)}</pre>`;
  }
  function card(d, i) {
    const lv = d.accepted != null ? 'acc' : d.level === 'error' ? 'err' : 'warn';
    const lvText = d.level === 'error' ? tl('erreur') : tl('avertissement');
    const acts = d.fault ? d.fault.actions.filter(a => a !== 'see') : [];
    const ex = opened.has(d.key) && explain(d.code);
    const row = (k, v, cls = '') => (v ? `<div class="jrow ${cls}"><b>= ${k}</b> ${esc(v)}</div>` : '');
    return `<article class="jd ${lv}" data-i="${i}">
      <header><span class="jlv">${lvText}</span><code class="jcode">[${d.code}]</code><b>${esc(d.title)}</b></header>
      <div class="jloc">--&gt; <button type="button" class="link" data-a="see">${esc(where(d))}</button></div>
      ${srcBlock(d)}
      ${row(tl('état :'), d.state ? d.state + (d.states > 1 ? tl(' (et {0} autre(s) état(s) sur {1})', fmtN(d.states - 1), fmtN(d.total)) : '') : '')}
      ${row(tl('note :'), d.note)}${row(tl('aide :'), d.help, 'help')}
      ${d.accepted != null ? row(tl('accepté :'), d.accepted || tl('sans raison donnée'), 'accd') : ''}
      ${accepting === d.key ? `<form class="jaccept" data-a="acceptForm"><input class="inp" name="why" maxlength="160" required placeholder="${tl('Pourquoi cet avertissement est-il voulu ?')}" aria-label="${tl('Raison')}"><button class="btn small primary">${tl('Accepter')}</button><button type="button" class="btn small" data-a="cancelAccept">${CANCEL}</button></form>` : ''}
      <div class="jact">
        ${acts.map(a => `<button type="button" class="btn small primary" data-a="fix" data-act="${a}">${esc(app.actLabel(a))}</button>`).join('')}
        <button type="button" class="btn small" data-a="explain" aria-expanded="${!!ex}">${tl('Expliquer {0}', d.code)}</button>
        ${d.level === 'warning' ? (d.accepted != null ? `<button type="button" class="btn small" data-a="unaccept">${tl('Retirer l’exception')}</button>` : `<button type="button" class="btn small" data-a="accept">${tl('Accepter…')}</button>`) : ''}
      </div>
      ${ex ? `<div class="jexp"><p class="fam">${esc(ex.family)}</p><p><b>${tl('Ce qui est vérifié')}</b> ${esc(ex.what)}</p><p><b>${tl('Pourquoi')}</b> ${esc(ex.why)}</p><p><b>${tl('Comment corriger')}</b> ${esc(ex.fix)}</p><p class="note"><a href="${PROVEN_URL}" target="_blank" rel="noopener">${tl('Ce que le vérificateur prouve, et ce qu’il suppose')}</a></p></div>` : ''}
    </article>`;
  }
  function render() {
    const r = last;
    if (!r) { q('sum').textContent = tl('Vérification…'); q('list').innerHTML = ''; return; }
    q('sum').className = 'jsum ' + (r.errors ? 'err' : r.warnings ? 'warn' : 'ok');
    q('sum').textContent = summary(r) + (r.dynamic ? tl(' · broches calculées dans le programme : vérification prudente') : '') + tl(' · {0} ms', r.ms);
    let html = '', fam = null;
    r.diags.forEach((d, i) => { const f = familyOf(d.code); if (f !== fam) { fam = f; html += `<h3 class="jfam">${esc(f)}</h3>`; } html += card(d, i); });
    q('list').innerHTML = html || `<p class="jnone">${icon('check')}${tl('Aucune faute : chaque composant reste dans ses limites dans tous les états atteignables.')}</p>`;
    const ex = explain('J0301');
    q('model').textContent = ex ? ex.model : '';
    const f = q('list').querySelector('.jaccept input'); if (f) f.focus();
  }
  q('list').addEventListener('click', e => {
    const b = e.target.closest('[data-a]'), art = e.target.closest('.jd'); if (!b || !art || !last) return;
    const d = last.diags[+art.dataset.i]; if (!d) return;
    const a = b.dataset.a;
    if (a === 'see') { if (d.loc && d.loc.line) { close(); app.goCode(d.loc.board, d.loc.line, d.loc.col); } else { close(); app.focus(d); } }
    if (a === 'fix') { app.fix(d.fault, b.dataset.act); schedule(); }
    if (a === 'explain') { opened.has(d.key) ? opened.delete(d.key) : opened.add(d.key); render(); }
    if (a === 'accept') { accepting = d.key; render(); }
    if (a === 'cancelAccept') { accepting = null; render(); }
    if (a === 'unaccept') { app.setAllow(app.allow().filter(x => !(x.code === d.code && (x.key ? x.key === d.key : !x.comp || (d.loc.comp && x.comp === d.loc.comp.id))))); run(); }
  });
  q('list').addEventListener('submit', e => {
    e.preventDefault();
    const art = e.target.closest('.jd'), d = last && last.diags[+art.dataset.i], why = e.target.elements.why.value.trim();
    if (!d || !why) return;
    accepting = null;
    app.setAllow([...app.allow(), { code: d.code, comp: d.loc.comp ? d.loc.comp.id : null, ...(d.space ? { key: d.key } : {}), reason: why }]);
    run();
  });
  const open = () => { modal.hidden = false; render(); run(); };
  const close = () => { modal.hidden = true; accepting = null; };
  chip.onclick = open;
  q('close').onclick = close; q('rerun').onclick = () => run();
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  addEventListener('keydown', e => {
    if (e.key === 'F7') { e.preventDefault(); open(); }
    else if (e.key === 'Escape' && !modal.hidden && !accepting) close();
  });
  paintChip();
  return {
    schedule, run, open, close,
    get result() { return last; },
    /** Vérifie maintenant ; avec des erreurs, ouvre le rapport. Rend le résultat (pour bloquer une action réelle). */
    async verify(show = true) { const r = await run(); if (r && r.errors && show) open(); return r; }
  };
}
