// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Ossature à la manière d'un éditeur de code, familière à qui connaît VS Code :
// - la barre d'activité, colonne d'icônes à gauche : bibliothèque, recherche, puis les boutons de ressources et
//   d'apprentissage de la barre d'application (exemples, schéma, documentation, TP, classe, enseigner…), repris tels
//   quels (les boutons d'origine restent dans la page, cachés : leurs actions, leurs états et leurs pastilles ne
//   changent pas), les problèmes du vérificateur, et en bas l'accueil et la palette de commandes ;
// - les onglets des plans de travail au-dessus du plan : Montage 3D, Schéma, Logique, Pneumatique, qui reprennent
//   le sélecteur de plan (.wsSwitch, logic.js et pneu.js) et le bouton 3D / Schéma (#stageView, main.js) ;
// - le panneau du bas (Ctrl+J) : Problèmes, la liste du vérificateur ligne par ligne (clic : y aller ; double-clic :
//   le rapport), et Sortie, les messages d'état et le journal du téléversement, horodatés ;
// - la barre d'état : compteur de problèmes (ouvre Problèmes), message cliquable (ouvre Sortie).
// Raccourcis : Ctrl+Maj+P ou F1 palette, Ctrl+J panneau, Ctrl+Maj+M problèmes, Ctrl+Maj+U sortie.
// Grille (colonnes et rangées) : styles.css ; apparence : shell.css ; palette : commands.js.
import { tl, isEn } from '../i18n/index.js';
import { icon } from './icons.js';
import { shortcut } from './appbar.js';
import { spacesOf, hasProgram } from './kind.js';
import { isLight, toggleTheme } from './theme.js';
import { where, summary } from '../check/format.js';
import { familyOf } from '../check/codes.js';

const KEY = { tab: 'jollof-dock', h: 'jollof-dock-h' };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
};
/** Un rappel par image au plus (les observateurs de mutations parlent souvent). */
const soon = fn => { let t = 0; return () => { if (t) return; t = requestAnimationFrame(() => { t = 0; fn(); }); }; };
/** Libellé d'un bouton : son texte, sinon son aria-label ou son infobulle. */
const labelOf = b => { const s = b.querySelector('span:not(.tbBadge)'); return (s && s.textContent.trim()) || b.getAttribute('aria-label') || b.dataset.tip || ''; };
/** Bouton caché par son attribut ou par une règle qui le vise (ses parents ne comptent pas : les groupes repris sont cachés). */
const cssHidden = b => b.hidden || getComputedStyle(b).display === 'none';
const el = (tag, cls, html = '') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };

/**
 * Bouton qui en reprend un autre : même icône, libellé en infobulle (o.text : aussi en texte), mêmes états
 * (enfoncé, caché, désactivé, pastille) ; un clic clique l'original. Rend { el, src, sync() }.
 */
function mirror(src, cls, o = {}) {
  const b = document.createElement('button'); b.type = 'button'; b.className = cls;
  if (src.id) b.dataset.for = src.id;
  b.onclick = () => src.click();
  const sync = () => {
    const svg = src.querySelector('svg.ic'), lab = o.label || labelOf(src), badge = src.querySelector('.tbBadge');
    const showBadge = badge && !badge.hidden && badge.textContent.trim();
    b.innerHTML = `${svg ? svg.outerHTML : icon(o.icon || 'dots')}${o.text ? `<span>${esc(lab)}</span>` : ''}<span class="actBadge"${showBadge ? '' : ' hidden'}>${showBadge ? esc(badge.textContent.trim()) : ''}</span>`;
    b.dataset.tip = o.tip || lab; b.setAttribute('aria-label', lab);
    b.hidden = cssHidden(src); b.disabled = !!src.disabled;
    const p = src.getAttribute('aria-pressed'); if (p == null) b.removeAttribute('aria-pressed'); else b.setAttribute('aria-pressed', p);
  };
  sync();
  return { el: b, src, sync };
}

/**
 * host : { libOpen(), setLibOpen(on), openPalette(), togglePalette(), paletteOpen() }.
 * Rend { act, tabs, dock } ; le vérificateur est branché ensuite par dock.bind(chk).
 */
export function installShell(host) {
  const dock = createDock(host);
  const act = installActivityBar(host, dock);
  const tabs = installEditorTabs(host);
  installKeys(host, dock);
  releaseTabFocus();
  return { act, tabs, dock };
}

/**
 * Onglets et boutons de barre cliqués à la souris : ils rendent le focus aussitôt. Sinon WebKit, à la première touche
 * (raccourci S, Échap…), passe le bouton cliqué en :focus-visible et l'entoure du cadre bleu du clavier, resté sur un
 * onglet qui n'est plus forcément le bon. Au clavier (Tab, flèches), le cadre reste : detail vaut 0.
 */
const TAB_LIKE = '.edTab, .tab, .dkTab, .actBtn, .segBtn, [role="tab"], .wsSwitch button, #stageView button';
function releaseTabFocus() {
  document.addEventListener('click', e => {
    if (!e.detail) return;
    const b = e.target instanceof Element && e.target.closest(TAB_LIKE);
    if (b && document.activeElement === b) b.blur();
  });
}

/* ---------- Barre d'activité ---------- */
function installActivityBar(host, dock) {
  const bar = $('#actBar'); if (!bar) return null;
  const app = $('.app');
  const act = (ic, tip, onClick) => { const b = el('button', 'actBtn', `${icon(ic)}<span class="actBadge" hidden></span>`); b.type = 'button'; b.dataset.tip = tip; b.setAttribute('aria-label', tip); b.onclick = onClick; return b; };
  const sep = () => el('span', 'actSep');
  const libBtn = act('box', `${tl('Bibliothèque')} · ${shortcut('B')}`, () => host.setLibOpen(!host.libOpen()));
  const searchBtn = act('search', tl('Rechercher un composant'), () => { host.setLibOpen(true); focusSearch(); });
  const sepA = sep(), sepB = sep();
  const probBtn = act('alert', `${tl('Problèmes')} · ${shortcut('M', true)}`, () => dock.toggle('problems'));
  const grow = el('span', 'grow');
  const cmdBtn = act('keyboard', `${tl('Palette de commandes')} · ${shortcut('P', true)} · F1`, () => host.openPalette());
  bar.append(libBtn, searchBtn, sepA, sepB, probBtn, grow);
  const homeSrc = $('#homeBtn'), homeM = homeSrc ? mirror(homeSrc, 'actBtn', { icon: 'home' }) : null;
  if (homeM) bar.append(homeM.el);
  // Thème : soleil sur le thème sombre (passer au clair), lune sur le clair.
  const themeBtn = act('sun', tl('Thème clair'), toggleTheme);
  const paintTheme = () => { const light = isLight(), tip = light ? tl('Thème sombre') : tl('Thème clair'); themeBtn.innerHTML = `${icon(light ? 'moon' : 'sun')}<span class="actBadge" hidden></span>`; themeBtn.dataset.tip = tip; themeBtn.setAttribute('aria-label', tip); };
  addEventListener('jollof:theme', paintTheme); paintTheme();
  bar.append(themeBtn, cmdBtn);

  function focusSearch() {
    requestAnimationFrame(() => {
      const panel = [...document.querySelectorAll('.app > .panel.left')].find(p => getComputedStyle(p).display !== 'none');
      const inp = panel && panel.querySelector('input[type="search"], input'); if (inp) { inp.focus(); inp.select(); }
    });
  }
  // Boutons de la barre d'application repris : ressources (exemples, schéma, documentation) et espaces
  // d'apprentissage (TP, classe, enseigner…), dans leur ordre ; un module peut en ajouter après le démarrage.
  let mirrors = [];
  function rebuild() {
    mirrors.forEach(m => m.el.remove()); mirrors = [];
    for (const s of document.querySelectorAll('.appbar .abTools > button, .appbar #abSpaces > button')) { const m = mirror(s, 'actBtn'); mirrors.push(m); sepB.before(m.el); }
    sync();
  }
  function paintProblems(c) {
    const badge = probBtn.querySelector('.actBadge');
    if (!c || c.busy) { badge.hidden = true; badge.textContent = ''; return; }
    const n = c.errors || c.warnings;
    badge.hidden = !n; badge.textContent = n > 99 ? '99+' : String(n); badge.className = 'actBadge ' + (c.errors ? 'err' : c.warnings ? 'warn' : '');
  }
  function sync() {
    libBtn.setAttribute('aria-pressed', String(host.libOpen()));
    probBtn.setAttribute('aria-pressed', String(dock.tab() === 'problems'));
    mirrors.forEach(m => m.sync()); if (homeM) homeM.sync();
  }
  const syncSoon = soon(sync), rebuildSoon = soon(rebuild);
  new MutationObserver(ms => { if (ms.some(m => m.type === 'childList' && m.target.matches && m.target.matches('.abTools, #abSpaces'))) rebuildSoon(); else syncSoon(); })
    .observe($('.appbar'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-pressed', 'disabled', 'class', 'aria-label', 'data-tip'] });
  new MutationObserver(syncSoon).observe(app, { attributes: true, attributeFilter: ['class', 'data-kind'] });
  new MutationObserver(syncSoon).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  dock.onCount(paintProblems); dock.onState(syncSoon);
  rebuild();
  return { sync, rebuild };
}

/* ---------- Onglets des plans de travail ---------- */
function installEditorTabs(host = {}) {
  const strip = $('#edTabs'); if (!strip) return null;
  const app = $('.app'), stage = $('#stage');
  const ws = k => $(`.wsSwitch [data-ws="${k}"]`), sv = k => $(`#stageView [data-stage="${k}"]`);
  const kind = () => app.dataset.kind || 'elec', has = sp => spacesOf(kind()).includes(sp);
  const logicOn = () => app.classList.contains('logicMode'), pneuOn = () => app.classList.contains('pneuMode'), netOn = () => app.classList.contains('netMode');
  // Code (main.js, setCodeView) : 'off' dans l'inspecteur, 'center' à la place du plan de travail, 'split' à côté du
  // montage ou du schéma. Montage 3D et Schéma gardent le côte à côte ; Logique et Pneumatique rendent le code à l'inspecteur.
  const codeMode = () => (host.codeMode ? host.codeMode() : 'off'), setCode = m => { if (host.setCodeView && codeMode() !== m) host.setCodeView(m); };
  const codeOn = () => codeMode() === 'center', splitOn = () => codeMode() === 'split', noCode = () => setCode('off');
  const inElec = () => !logicOn() && !pneuOn() && !netOn() && !codeOn(), is2d = () => stage.classList.contains('sch2d');
  const click = b => { if (b) b.click(); };
  const toElec = () => { if (codeOn()) noCode(); if (logicOn() || pneuOn() || netOn()) click(ws('elec')); };
  const TABS = [
    { id: '3d', cls: 'elec', icon: 'cube', label: () => tl('Montage 3D'), tip: () => tl('Montage en 3D : placer, câbler, simuler · S'), show: () => has('elec'), on: () => inElec() && !is2d(), go() { toElec(); if (is2d()) click(sv('3d')); } },
    { id: '2d', cls: 'elec', icon: 'schematic', label: () => tl('Schéma'), tip: () => tl('Schéma électrique en direct : on y voit le courant circuler · S'), show: () => has('elec'), on: () => inElec() && is2d(), go() { toElec(); if (!is2d()) click(sv('2d')); } },
    { id: 'code', cls: 'code', icon: 'code', label: () => tl('Code'), tip: () => tl('Programme de la carte : règles, blocs ou code, débogueur, moniteur série'), show: () => hasProgram(kind()) && !!host.setCodeView, on: () => codeOn() || splitOn(), go() { setCode('center'); } },
    { id: 'logic', cls: 'logic', icon: 'logic', label: () => (isEn ? 'Logic' : 'Logique'), tip: () => tl('Logique : portes, bascules, compteurs, tables de vérité'), show: () => has('logic'), on: logicOn, go() { noCode(); if (!logicOn()) click(ws('logic')); } },
    { id: 'pneu', cls: 'pneu', icon: 'pneu', label: () => tl('Pneumatique'), tip: () => tl('Pneumatique : distributeurs, vérins, électrovannes commandées par la carte'), show: () => has('pneu'), on: pneuOn, go() { noCode(); if (!pneuOn()) click(ws('pneu')); } },
    { id: 'net', cls: 'net', icon: 'network', label: () => tl('Réseau'), tip: () => tl('Réseau : PC, switchs, box, câbles RJ45, adresses IP'), show: () => has('net'), on: netOn, go() { noCode(); if (!netOn()) click(ws('net')); } }
  ];
  const btns = TABS.map(t => {
    const b = el('button', `edTab ${t.cls}`, `${icon(t.icon)}<span>${esc(t.label())}</span>`);
    b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.tab = t.id; b.dataset.tip = t.tip();
    b.onclick = () => { t.go(); paint(); };
    return b;
  });
  const end = el('div', 'edEnd');
  strip.append(...btns, end);
  // Flèches entre les onglets visibles.
  strip.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const vis = btns.filter(b => !b.hidden), i = vis.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); const n = vis[(i + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length]; n.focus(); n.click();
  });
  // « Côte à côte » : le code à droite du montage ou du schéma (et le revoir en grand par l'onglet Code).
  const codeSplit = el('button', 'tb codeSplitBtn', `${icon('split')}<span>${esc(tl('Côte à côte'))}</span>`);
  codeSplit.type = 'button'; codeSplit.dataset.tip = tl('Le code à côté du montage ou du schéma'); codeSplit.setAttribute('aria-label', tl('Le code à côté du montage ou du schéma'));
  codeSplit.onclick = () => { setCode(splitOn() ? 'off' : 'split'); paint(); };
  end.append(codeSplit);
  // « Vue partagée » (montage et circuit pneumatique côte à côte, pneu.js) : repris à droite des onglets.
  let splitM = null;
  function late() { const sb = $('.appbar .pnSplitBtn'); if (sb && !splitM) { splitM = mirror(sb, 'tb', { text: true }); end.append(splitM.el); } }
  function paint() {
    // Un autre plan ouvert d'ailleurs (sélecteur, TP, type du projet changé) : le code rentre dans l'inspecteur.
    const codeTab = TABS.find(t => t.id === 'code');
    if (codeMode() !== 'off' && (logicOn() || pneuOn() || netOn() || !codeTab.show())) noCode();
    if (splitOn() && app.classList.contains('pnSplitOn')) noCode(); // la vue partagée pneumatique prend la place
    codeSplit.hidden = !codeTab.show() || logicOn() || pneuOn() || netOn(); codeSplit.setAttribute('aria-pressed', String(splitOn()));
    TABS.forEach((t, i) => { const b = btns[i], on = t.on(); b.hidden = !t.show(); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    late(); if (splitM) splitM.sync();
  }
  const paintSoon = soon(paint);
  new MutationObserver(paintSoon).observe(app, { attributes: true, attributeFilter: ['class', 'data-kind'] });
  new MutationObserver(paintSoon).observe(stage, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(paintSoon).observe($('.appbar'), { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'aria-pressed'] });
  paint();
  return {
    paint,
    /** Ouvre un plan par son onglet ('3d', '2d', 'logic', 'pneu', 'net'), s'il est montré par le type du projet. */
    go(id) { const t = TABS.find(x => x.id === id); if (t && t.show()) { t.go(); paint(); } },
    /** Onglets montrés : [{ id, label, icon, on }] (palette de commandes). */
    list: () => TABS.filter(t => t.show()).map(t => ({ id: t.id, label: t.label(), icon: t.icon, on: t.on() }))
  };
}

/* ---------- Panneau du bas : Problèmes, Sortie ---------- */
function createDock() {
  const app = $('.app'), root = $('#dockPanel');
  const stateHooks = new Set(), countHooks = new Set();
  const OUTPUT = isEn ? 'Output' : 'Sortie';
  let tab = '', lastTab = 'problems', chk = null, last = null, lastLine = '', lastSummary = '';
  const extra = new Map(); // onglets ajoutés (moniteur série) : id → { btn, body, onShow, when }
  /** Onglet ajouté utilisable par ce projet (when() : par exemple, le moniteur série seulement avec une carte programmable). */
  const usable = id => { const x = extra.get(id); return !!x && (!x.when || x.when()); };
  if (!root) return { toggle() {}, show() {}, hide() {}, tab: () => '', log() {}, bind() {}, onCount() {}, onState() {}, addTab() {} };
  root.innerHTML = `<div class="dkGrip" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="${tl('Hauteur du panneau')}" title="${tl('Tirer pour régler la hauteur · double-clic : hauteur d’origine')}"></div>
    <div class="dkHead" role="tablist">
      <button type="button" role="tab" class="dkTab" data-dk="problems" aria-selected="false">${tl('Problèmes')}<span class="count" data-dkc></span></button>
      <button type="button" role="tab" class="dkTab" data-dk="output" aria-selected="false">${OUTPUT}</button>
      <span class="grow"></span>
      <button type="button" class="tb" data-dka="report" data-tip="${tl('Rapport complet du vérificateur · F7')}">${icon('list')}<span>${tl('Rapport')}</span></button>
      <button type="button" class="tb" data-dka="clear" data-tip="${tl('Effacer la sortie')}" aria-label="${tl('Effacer la sortie')}" hidden>${icon('trash')}</button>
      <button type="button" class="tb" data-dka="close" data-tip="${tl('Fermer le panneau')} · ${shortcut('J')}" aria-label="${tl('Fermer le panneau')}">${icon('x')}</button>
    </div>
    <div class="dkBody dkProblems" role="tabpanel" aria-label="${tl('Problèmes')}"></div>
    <div class="dkBody dkOutput" role="tabpanel" aria-label="${OUTPUT}" hidden><div class="dkLog" data-empty="${tl('Rien pour l’instant : les messages d’état et le journal du téléversement s’afficheront ici.')}"></div></div>`;
  const q = s => root.querySelector(s), probBox = q('.dkProblems'), out = q('.dkOutput'), logEl = q('.dkLog');

  /* Hauteur : poignée au bord haut, retenue d'une session à l'autre. */
  const setH = (h, save = true) => { h = Math.round(Math.max(120, Math.min(Math.round(innerHeight * 0.6), h))); app.style.setProperty('--dkH', h + 'px'); if (save) store.set(KEY.h, h); };
  const savedH = store.get(KEY.h, null); if (Number.isFinite(savedH)) setH(savedH, false);
  const grip = q('.dkGrip');
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = root.getBoundingClientRect().height;
    app.classList.add('dkResizing');
    const mv = ev => setH(h0 + (y0 - ev.clientY), false);
    const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); app.classList.remove('dkResizing'); setH(root.getBoundingClientRect().height); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => { app.style.removeProperty('--dkH'); store.set(KEY.h, null); });
  grip.addEventListener('keydown', e => {
    const h = root.getBoundingClientRect().height, st = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowUp') { e.preventDefault(); setH(h + st); } else if (e.key === 'ArrowDown') { e.preventDefault(); setH(h - st); }
  });

  /* Onglets et actions. */
  function paint() {
    root.hidden = !tab;
    if (tab) {
      root.querySelectorAll('.dkTab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.dk === tab)));
      probBox.hidden = tab !== 'problems'; out.hidden = tab !== 'output';
      extra.forEach((x, id) => { x.body.hidden = tab !== id; x.btn.hidden = !usable(id); });
      q('[data-dka="report"]').hidden = tab !== 'problems'; q('[data-dka="clear"]').hidden = tab !== 'output';
      if (tab === 'problems') renderProblems(); else if (tab === 'output') out.scrollTop = out.scrollHeight;
      else if (extra.has(tab) && extra.get(tab).onShow) { try { extra.get(tab).onShow(); } catch (e) { console.error(e); } }
    }
    stateHooks.forEach(f => f(tab));
  }
  const known = t => t === 'problems' || t === 'output' || usable(t);
  function show(t = lastTab) { if (!known(t)) t = 'problems'; tab = lastTab = t; store.set(KEY.tab, t); paint(); }
  function hide() { tab = ''; store.set(KEY.tab, ''); paint(); }
  function toggle(t) { if (tab && (!t || t === tab)) hide(); else show(t); }
  root.addEventListener('click', e => {
    const t = e.target.closest('.dkTab'); if (t) { show(t.dataset.dk); return; }
    const a = e.target.closest('[data-dka]'); if (!a) return;
    if (a.dataset.dka === 'close') hide();
    else if (a.dataset.dka === 'report') { if (chk) chk.open(); }
    else if (a.dataset.dka === 'clear') { logEl.replaceChildren(); lastLine = ''; }
  });

  /* Problèmes : les diagnostics du vérificateur, par famille, comme dans le rapport. */
  function renderProblems() {
    if (!last) { probBox.innerHTML = `<p class="dkEmpty busy">${icon('rotate')}${tl('Vérification…')}</p>`; return; }
    if (!last.diags.length) { probBox.innerHTML = `<p class="dkEmpty">${icon('check')}${tl('Aucun problème : le montage et le programme passent la vérification.')}</p>`; return; }
    let html = '', fam = null;
    last.diags.forEach((d, i) => {
      const f = familyOf(d.code); if (f !== fam) { fam = f; html += `<div class="dkFam">${esc(f)}</div>`; }
      const lv = d.accepted != null ? 'acc' : d.level === 'error' ? 'err' : 'warn';
      html += `<button type="button" class="dkRow ${lv}" data-i="${i}" title="${esc(d.note || '')}">${icon(lv === 'err' ? 'x' : lv === 'warn' ? 'alert' : 'check')}<code>${esc(d.code)}</code><b>${esc(d.title)}</b><small>${esc(where(d))}</small></button>`;
    });
    probBox.innerHTML = html;
  }
  probBox.addEventListener('click', e => { const r = e.target.closest('.dkRow'); if (r && last && chk) chk.see(last.diags[+r.dataset.i]); });
  probBox.addEventListener('dblclick', e => { if (e.target.closest('.dkRow') && chk) chk.open(); });
  function counts() {
    const c = last ? { errors: last.errors, warnings: last.warnings, busy: false } : { errors: 0, warnings: 0, busy: true };
    const n = q('[data-dkc]'); n.textContent = c.busy ? '' : String(c.errors + c.warnings || ''); n.className = 'count ' + (c.errors ? 'err' : c.warnings ? 'warn' : '');
    countHooks.forEach(f => f(c));
  }
  function setProblems(r) {
    last = r || null; counts();
    if (tab === 'problems') renderProblems();
    if (r) { const s = summary(r); if (s !== lastSummary) { lastSummary = s; log(s, r.errors ? 'err' : r.warnings ? 'warn' : 'ok'); } }
  }

  /* Sortie : une ligne horodatée par message ; un message répété ne fait que compter. */
  function log(text, kind = 'info') {
    text = String(text ?? '').trim(); if (!text) return;
    kind = ['ok', 'warn', 'err', 'cmd'].includes(kind) ? kind : 'info';
    const key = kind + '|' + text;
    if (key === lastLine && logEl.lastElementChild) {
      const l = logEl.lastElementChild, n = l.querySelector('b.n');
      if (n) n.textContent = '×' + (+n.textContent.slice(1) + 1); else l.insertAdjacentHTML('beforeend', '<b class="n">×2</b>');
      return;
    }
    lastLine = key;
    const atEnd = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
    const t = new Date(), p = n => String(n).padStart(2, '0');
    logEl.insertAdjacentHTML('beforeend', `<div class="dkLine ${kind}"><time>${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}</time><span>${esc(text)}</span></div>`);
    while (logEl.children.length > 500) logEl.firstElementChild.remove();
    if (atEnd || out.hidden) out.scrollTop = out.scrollHeight;
  }

  /* Barre d'état : compteur de problèmes à gauche, message d'état cliquable. */
  const sb = $('.statusbar'), st = $('#status');
  if (sb) {
    const prob = el('button', 'sbProblems', `${icon('x')}<span class="e">0</span>${icon('alert')}<span class="w">0</span>`);
    prob.type = 'button'; prob.title = `${tl('Problèmes')} · ${shortcut('M', true)}`; prob.setAttribute('aria-label', tl('Problèmes'));
    prob.onclick = () => toggle('problems');
    sb.prepend(prob);
    countHooks.add(c => { prob.querySelector('.e').textContent = c.busy ? '…' : c.errors; prob.querySelector('.w').textContent = c.busy ? '…' : c.warnings; prob.className = 'sbProblems ' + (c.errors ? 'err' : c.warnings ? 'warn' : ''); prob.title = c.busy ? tl('Vérification…') : `${tl('Problèmes : {0} erreur(s), {1} avertissement(s)', c.errors, c.warnings)} · ${shortcut('M', true)}`; });
    stateHooks.add(t => prob.setAttribute('aria-pressed', String(t === 'problems')));
  }
  if (st) { st.title = `${OUTPUT} · ${shortcut('U', true)}`; st.onclick = () => toggle('output'); }

  // Type du projet changé : un onglet ajouté qu'il ne peut pas utiliser disparaît (s'il était ouvert, Problèmes le remplace).
  new MutationObserver(() => {
    extra.forEach((x, id) => { x.btn.hidden = !usable(id); });
    if (tab && extra.has(tab) && !usable(tab)) { tab = lastTab = 'problems'; paint(); }
    if (lastTab !== 'problems' && lastTab !== 'output' && !usable(lastTab)) lastTab = 'problems';
  }).observe(app, { attributes: true, attributeFilter: ['data-kind'] });
  counts();
  const saved = store.get(KEY.tab, '');
  if (saved === 'problems' || saved === 'output') show(saved); else paint(); // un onglet ajouté plus tard se rouvre à son ajout (addTab)
  return {
    show, hide, toggle, log,
    tab: () => tab, isOpen: () => !!tab,
    /**
     * Onglet de plus (moniteur série…) : el est déplacé dans le panneau (ses actions ne changent pas). o : { id, label,
     * el, onShow() appelé à chaque affichage }. Il passe avant Problèmes et Sortie, comme le terminal d'un éditeur de code.
     */
    addTab({ id, label, el, onShow, when }) {
      if (!id || extra.has(id) || !el) return;
      const btn = document.createElement('button'); btn.type = 'button'; btn.setAttribute('role', 'tab'); btn.className = 'dkTab'; btn.dataset.dk = id; btn.setAttribute('aria-selected', 'false'); btn.textContent = label;
      q('.dkHead .dkTab').before(btn);
      const body = document.createElement('div'); body.className = `dkBody dkExtra dk-${id}`; body.setAttribute('role', 'tabpanel'); body.setAttribute('aria-label', label); body.hidden = true;
      body.appendChild(el); root.appendChild(body);
      extra.set(id, { btn, body, onShow, when });
      btn.hidden = !usable(id);
      if (store.get(KEY.tab, '') === id && usable(id)) show(id); else if (tab) paint();
    },
    /** Vérificateur (src/check/ui.js) : ses résultats remplissent Problèmes. */
    bind(c) { chk = c; c.onResult(setProblems); setProblems(c.result); },
    onCount(fn) { countHooks.add(fn); return () => countHooks.delete(fn); },
    onState(fn) { stateHooks.add(fn); return () => stateHooks.delete(fn); }
  };
}

/* ---------- Clavier : avant les plans de travail (écoute en capture, posée au démarrage de l'interface) ---------- */
function installKeys(host, dock) {
  addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    const take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === 'F1' || (mod && e.shiftKey && !e.altKey && k === 'p')) { take(); host.togglePalette(); return; }
    if (host.paletteOpen()) return; // la palette gère ses touches
    if (!mod || e.altKey) return;
    if (!e.shiftKey && k === 'j') { take(); dock.toggle(); }
    else if (e.shiftKey && k === 'm') { take(); dock.toggle('problems'); }
    else if (e.shiftKey && k === 'u') { take(); dock.toggle('output'); }
  }, true);
}
