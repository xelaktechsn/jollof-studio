// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Travaux pratiques guidés : le « laboratoire sans laboratoire ». Une bibliothèque de TP
// (montage de départ, étapes, contrôles automatiques), utilisable hors ligne et sans compte.
// Deux familles, chacune dans son onglet : Électronique (src/lab/tp : montage 3D, programme,
// mesures) et Logique (src/lab/logic : portes, bascules, compteurs, sur le plan de travail logique).
// Un TP s'ouvre dans le plan de travail (le projet personnel est mis de côté) ; chaque étape se
// vérifie : câblage, programme, comportement observé, mesures, table de vérité, chronologie,
// équation, questions. À la fin : compte-rendu en PDF. Édition Pro : un TP s'envoie à une classe.
import './lab.css';
import { tl, LANG, DEC, isEn } from '../i18n/index.js';
import { icon, esc, toast, dialog, ask } from '../school/ui.js';
import { hydrateIcons } from '../ui/icons.js';
import { compile } from '../prog/lang.js';
import { checkWire, checkCode, checkWatch, checkMeasure, checkQuiz, checkPneuTube, checkPneuSeq, checkParts, checkWired, checkPneuParts, checkGrafcet, checkUiState, AUTO_CHECKS, allNets } from './engine.js';
import { DEFS as PNEU_DEFS } from '../pneu/elements.js';
import { expectOf } from '../pneu/seq.js';
import { checkLogicTable, checkLogicSeq, checkLogicParts, checkExpr, checkTableFill } from '../logic/check.js';
import { DEFS as LOGIC_DEFS } from '../logic/elements.js';
import { parse as parseExpr, expected as expectedCol } from '../logic/boolean.js';

// TP chargés à la première ouverture de la bibliothèque (src/lab/tps.js) : rien à lire au démarrage.
let TPS = [];
async function loadTps() {
  if (TPS.length) return;
  const { ELEC, LOGIC, PNEU } = await import('./tps.js');
  const lists = { elec: ELEC, logic: LOGIC, pneu: PNEU };
  for (const d of DOMAINS) d.list = lists[d.id] || [];
  TPS = [...ELEC, ...LOGIC, ...PNEU];
}
// (« Logique » seul est déjà traduit « Logic level » pour les fiches des cartes : nom écrit selon la langue.)
const DOMAINS = [
  { id: 'elec', list: [], icon: 'cpu', name: () => tl('Électronique'), intro: () => tl('Un laboratoire d’électronique sans matériel : chaque TP part d’un montage, guide pas à pas et vérifie votre travail (câblage, programme, comportement, mesures au multimètre).') },
  { id: 'pneu', list: [], icon: 'pneu', name: () => tl('Pneumatique'), intro: () => tl('Distributeurs, vérins, électrovannes : chaque TP ouvre le plan de travail pneumatique, vérifie vos tuyaux et observe vos vérins ; certains y ajoutent la carte qui commande les électrovannes.') },
  { id: 'logic', list: [], icon: 'logic', name: () => (isEn ? 'Logic' : 'Logique'), intro: () => tl('Portes, bascules, compteurs : chaque TP ouvre le plan de travail logique avec ses entrées et ses sorties, et vérifie la table de vérité, la chronologie ou l’équation de votre circuit.') }
];
const L = o => (o == null ? '' : typeof o === 'string' ? o : o[LANG] || o.fr || '');
/**
 * Séries de TP mises en avant en tête de leur onglet (champ « series » du TP) : un thème qui relie plusieurs TP.
 * dakar : inspirés des transports de Dakar, le Train Express Régional (TER) et le Bus Rapid Transit (BRT).
 */
const SERIES = {
  tuto: { icon: 'graduation', tag: () => tl('Tutoriel'), name: () => tl('Tutoriels pas à pas'), intro: () => tl('Partir de zéro et construire un projet complet, guidé à chaque clic : l’étape en cours reste affichée sur le plan de travail, montre où cliquer et se valide toute seule.') },
  dakar: { icon: 'train', tag: () => 'TER · BRT', name: () => tl('TER et BRT de Dakar'), intro: () => tl('Des TP inspirés du Train Express Régional et du Bus Rapid Transit de Dakar : signalisation, portes, validation des titres de transport, information des voyageurs, énergie des bus électriques.') }
};
const LEVELS = { college: () => tl('Collège'), lycee: () => tl('Lycée'), pro: () => tl('Formation professionnelle') };
const KEY = id => 'jollof-lab-' + id, TAB_KEY = 'jollof-lab-tab';
const load = id => { try { return JSON.parse(localStorage.getItem(KEY(id)) || 'null'); } catch (e) { return null; } };
const store = (id, st) => { try { localStorage.setItem(KEY(id), JSON.stringify(st)); } catch (e) { /* stockage plein */ } };
/** Texte d'étape : **gras**, `code`, listes « - », retours à la ligne. */
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>').split('\n').map(l => (/^- /.test(l) ? `<li>${l.slice(2)}</li>` : l ? `<p>${l}</p>` : '')).join('').replace(/(<li>.*?<\/li>)+/g, m => `<ul>${m}</ul>`);
const num = v => (Math.round(v * 100) / 100).toString().replace('.', DEC);
const unitOf = c => (c.unit === 'mA' ? 'mA' : c.unit === 's' ? 's' : 'V');
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Icône du contrôle d'une étape (repère dans la frise des étapes). */
const CHECK_ICON = { parts: 'cpu', wired: 'cable', 'pneu-parts': 'pneu', grafcet: 'list', ui: 'eye', 'pneu-tube': 'pneu', 'pneu-seq': 'activity', wire: 'cable', code: 'code', watch: 'eye', measure: 'gauge', quiz: 'help', 'logic-table': 'list', 'logic-seq': 'activity', 'logic-parts': 'logic', expr: 'sparkle', 'table-fill': 'edit', info: 'info' };
const status = st => (st && st.finishedAt ? 'done' : st && st.done && st.done.some(Boolean) ? 'doing' : 'new');
const typeName = t => (LOGIC_DEFS[t] ? LOGIC_DEFS[t].name() : t);
/** Composant demandé par une étape « parts », en clair : « électrovanne 24 V Y1 », « une carte ». */
const PART_NAME = { button: () => tl('bouton poussoir'), coil24: () => tl('électrovanne 24 V'), cylsensor: () => tl('capteur de vérin'), pressostat: () => tl('pressostat'), uno: () => 'Arduino Uno' };
const needText = n => (n.board && !n.type ? tl('une carte (Arduino Uno…)') : `${PART_NAME[n.type] ? PART_NAME[n.type]() : n.type}${n.name ? ' ' + n.name : ''}`);
/** Élément demandé par une étape « pneu-parts » : son nom, avec son repère ou sa bobine. */
const pneuNeedText = n => { const p = n.p || {}, tag = p.label || p.coilL || p.coil || p.sensor || ''; return `${PNEU_DEFS[n.type] ? PNEU_DEFS[n.type].name() : n.type}${tag ? ' ' + tag : ''}`; };
const PROP_NAME = { label: () => tl('Repère'), s0: () => tl('Capteur tige rentrée'), s1: () => tl('Capteur tige sortie'), coil: () => tl('Bobine'), coilL: () => tl('Bobine côté 14'), coilR: () => tl('Bobine côté 12'), left: () => tl('Commande côté 14'), right: () => tl('Rappel côté 12') };
/** Orifice d'un contrôle de tuyaux : « ~v52:4 » → « Distributeur 5/2, orifice 4 ». */
const portText = k => { if (!k.startsWith('~')) return k; const i = k.lastIndexOf(':'), t = k.slice(1, i); return tl('{0}, orifice {1}', PNEU_DEFS[t] ? PNEU_DEFS[t].name() : t, k.slice(i + 1)); };
/** Ce qu'il reste à faire pour un état d'interface demandé (étape « ui »). */
const UI_TODO = { sim: () => tl('Lancez la simulation (« Simuler »).'), split: () => tl('Ouvrez la vue partagée (bouton « Vue partagée », à côté du sélecteur).'), pneu: () => tl('Passez au plan Pneumatique.'), elec: () => tl('Passez au plan Électronique.'), grafcet: () => tl('Ouvrez le panneau GRAFCET.'), '3d': () => tl('Ouvrez la vue 3D du plan pneumatique.') };
/** Équation juste mais pas sous la forme demandée (expr.form). */
const FORM_MSG = {
  sop: () => tl('Équation juste, mais écrivez-la comme une somme de produits : des termes reliés par +, chacun fait de lettres (barrées ou non) reliées par « . ».'),
  pos: () => tl('Équation juste, mais écrivez-la comme un produit de sommes, par exemple (A + B).(/A + C).'),
  product: () => tl('Équation juste, mais écrivez-la comme un seul produit de lettres, barrées ou non (par exemple /A./B).'),
  noxor: () => tl('Équation juste, mais sans le symbole ^ : écrivez-la avec « . », « + » et « / ».')
};
/** Valeurs d'un pas de suite logique, en clair : « A = 1, B = 0, impulsion sur CLK ». */
function seqText(s) {
  const parts = Object.entries(s.set || {}).map(([n, v]) => `${n} = ${v ? 1 : 0}`);
  for (const n of [].concat(s.pulse || [])) parts.push(s.times > 1 ? tl('{0} impulsions sur {1}', s.times, n) : tl('une impulsion sur {0}', n));
  for (const n of [].concat(s.rise || [])) parts.push(tl('front montant sur {0}', n));
  for (const n of [].concat(s.fall || [])) parts.push(tl('front descendant sur {0}', n));
  return parts.join(', ');
}

export function installLab(app) {
  const sessions = app.sessions || (app.school && app.school.sessions);
  const logic = () => app.logic;
  const env = {
    comps: () => app.comps(), analyze: () => app.analyze(),
    program: () => { const p = app.program(); return p ? { code: p.code, kind: p.kind } : null; },
    compile: (code, kind) => compile(code, { board: kind }),
    dc: state => (app.dc ? app.dc(state) : null),
    pneu: () => (app.pneu ? app.pneu.circuit() : null), pneuState: () => (app.pneu ? app.pneu.state() : null), pneuPushed: k => !!(app.pneu && app.pneu.isPushed(k)), pneuInput: k => !!(app.pneu && app.pneu.isGrafcetInput(k)),
    /** État de l'interface demandé par une étape « ui » : simulation, vue partagée, plan affiché, GRAFCET, vue 3D. */
    ui: n => {
      const P = app.pneu, onP = !!(P && P.isOn()), onL = !!(logic() && logic().isOn());
      return n === 'sim' ? app.simOn() : n === 'split' ? !!(P && P.isSplit()) : n === 'pneu' ? onP : n === 'elec' ? !onP && !onL : n === 'grafcet' ? !!(P && P.grafcetOpen()) : n === '3d' ? !!(P && P.is3dOpen()) : false;
    }
  };
  const btn = app.toolbar(`<button type="button" class="tb label" id="labBtn" data-tip="${tl('Travaux pratiques guidés, vérifiés pas à pas')}">${icon('checklist')}<span>${tl('TP')}</span></button>`);
  btn.onclick = () => openLibrary(app.pneu && app.pneu.isOn() ? 'pneu' : logic() && logic().isOn() ? 'logic' : null);
  app.openLabs = domain => openLibrary(domain);
  /** Ouvre un TP ou un tutoriel par son identifiant (bouton « Tutoriel » du plan pneumatique…). */
  app.openTutorial = async id => { await loadTps(); const tp = TPS.find(t => t.id === id); if (tp) run(tp); else toast(tl('Tutoriel introuvable.'), 'err'); };

  /* ---------- Bibliothèque ---------- */
  async function openLibrary(domain = null) {
    await loadTps();
    let tab = domain; if (!tab) { try { tab = localStorage.getItem(TAB_KEY); } catch (e) { tab = null; } }
    if (!DOMAINS.some(d => d.id === tab)) tab = 'elec';
    let level = 'all', q = '';
    const card = tp => {
      const st = load(tp.id), done = st ? st.done.filter(Boolean).length : 0, n = tp.steps.length, s = status(st);
      const kinds = [...new Set(tp.steps.map(x => x.check && x.check.type).filter(t => t && t !== 'info'))].slice(0, 5);
      const S = SERIES[tp.series];
      return `<button type="button" class="tpCard ${tp.domain}${S ? ' series' : ''}" data-tp="${esc(tp.id)}"><span class="tpTop"><span class="tpLevel">${LEVELS[tp.level] ? LEVELS[tp.level]() : ''}${S ? `<span class="tpTag">${icon(S.icon)}${S.tag()}</span>` : ''}</span><span class="muted">${icon('clock')}${tl('{0} min', tp.minutes)}</span></span>
        <b>${esc(L(tp.title))}</b><small>${esc(L(tp.summary))}</small>
        <span class="tpObj">${(tp.objectives || []).slice(0, 3).map(o => `<span>${icon('check')}${esc(L(o))}</span>`).join('')}</span>
        <span class="tpFoot">${s === 'done' ? `<span class="pill graded">${icon('award')}${tl('Terminé')}</span>` : s === 'doing' ? `<span class="pill doing">${tl('Étape {0}/{1}', Math.min(n, (st.step || 0) + 1), n)}</span>` : `<span class="pill todo">${tl('Nouveau')}</span>`}<span class="tpBar"><i style="width:${Math.round(100 * done / n)}%"></i></span><span class="tpKinds">${kinds.map(k => icon(CHECK_ICON[k] || 'check')).join('')}</span></span></button>`;
    };
    const body = document.createElement('div'); body.className = 'tpLibBody';
    function render() {
      const D = DOMAINS.find(d => d.id === tab);
      const match = tp => (level === 'all' || tp.level === level) && (!q || norm(`${L(tp.title)} ${L(tp.summary)} ${(tp.objectives || []).map(L).join(' ')}`).includes(q));
      // Séries mises en avant : en tête, sans filtre ni recherche ; sinon les TP rejoignent leur niveau.
      const featured = level === 'all' && !q ? Object.entries(SERIES).map(([k, S]) => [S, D.list.filter(t => t.series === k)]).filter(([, l]) => l.length) : [];
      const list = D.list.filter(match).filter(t => !featured.some(([, l]) => l.includes(t))), by = new Map();
      list.forEach(tp => { if (!by.has(tp.level)) by.set(tp.level, []); by.get(tp.level).push(tp); });
      const doneN = D.list.filter(t => status(load(t.id)) === 'done').length, resume = D.list.filter(t => status(load(t.id)) === 'doing');
      const levels = ['all', ...['college', 'lycee', 'pro'].filter(l => D.list.some(t => t.level === l))];
      body.innerHTML = `<div class="tpTabs" role="tablist">${DOMAINS.map(d => {
        const dn = d.list.filter(t => status(load(t.id)) === 'done').length;
        return `<button type="button" role="tab" class="tpTab ${d.id}" data-tab="${d.id}" aria-selected="${d.id === tab}">${icon(d.icon)}<span class="tpTabName">${d.name()}</span><span class="tpTabMeta">${tl('{0} TP', d.list.length)}${dn ? ` · ${tl('{0} terminé(s)', dn)}` : ''}</span></button>`;
      }).join('')}</div>
        <p class="dlgText">${D.intro()} ${tl('Votre projet est mis de côté pendant le TP.')}</p>
        <div class="tpTools"><div class="seg mini" role="group" aria-label="${tl('Niveau')}">${levels.map(l => `<button type="button" class="segBtn" data-level="${l}" aria-pressed="${l === level}">${l === 'all' ? tl('Tous') : LEVELS[l]()}</button>`).join('')}</div>
          <div class="search tpSearch">${icon('search')}<input type="search" value="${esc(q)}" placeholder="${tl('Rechercher un TP…')}" aria-label="${tl('Rechercher un TP')}"></div>
          <span class="tpProgress"><span class="tpBar"><i style="width:${D.list.length ? Math.round(100 * doneN / D.list.length) : 0}%"></i></span>${tl('{0}/{1} terminés', doneN, D.list.length)}</span></div>
        ${resume.length && level === 'all' && !q ? `<h3 class="subHead">${icon('history')}${tl('À reprendre')}</h3><div class="tpGrid">${resume.map(card).join('')}</div>` : ''}
        ${featured.map(([S, items]) => `<section class="tpSeries"><h3 class="subHead">${icon(S.icon)}${S.name()}<span class="count">${items.length}</span></h3><p class="tpSeriesIntro">${S.intro()}</p><div class="tpGrid">${items.map(card).join('')}</div></section>`).join('')}
        ${[...by].map(([lv, items]) => `<h3 class="subHead">${LEVELS[lv] ? LEVELS[lv]() : esc(lv)}<span class="count">${items.length}</span></h3><div class="tpGrid">${items.map(card).join('')}</div>`).join('') || `<p class="muted tpNone">${tl('Aucun TP ne correspond.')}</p>`}`;
      hydrateIcons(body);
      const input = body.querySelector('.tpSearch input');
      input.oninput = () => { q = norm(input.value.trim()); const pos = input.selectionStart; render(); const i2 = body.querySelector('.tpSearch input'); i2.focus(); i2.setSelectionRange(pos, pos); };
    }
    render();
    const id = await dialog({
      title: tl('{0}Travaux pratiques', icon('checklist')), width: 1040, cls: 'tpLib', body,
      actions: [{ label: tl('Fermer'), value: null }],
      onOpen: (el, close) => (el.onclick = e => {
        const t = e.target.closest('[data-tab]');
        if (t) { tab = t.dataset.tab; level = 'all'; try { localStorage.setItem(TAB_KEY, tab); } catch (err) { /* rien */ } render(); return; }
        const lv = e.target.closest('[data-level]'); if (lv) { level = lv.dataset.level; render(); return; }
        const b = e.target.closest('[data-tp]'); if (b) close(b.dataset.tp);
      })
    });
    if (id) run(TPS.find(t => t.id === id));
  }

  /* ---------- Séance de TP ---------- */
  async function run(tp) {
    if (!sessions) return;
    const isLogic = tp.domain === 'logic', isPneu = tp.domain === 'pneu';
    if (isLogic && !logic()) { toast(tl('Le plan de travail logique n’est pas disponible.'), 'err'); return; }
    let st = load(tp.id) || { step: 0, done: tp.steps.map(() => false), answers: {}, results: {}, startedAt: Date.now(), finishedAt: null };
    if (st.done.length !== tp.steps.length) st = { step: 0, done: tp.steps.map(() => false), answers: {}, results: {}, startedAt: Date.now(), finishedAt: null };
    const resume = st.done.some(Boolean) && !st.finishedAt;
    let watcher = null;
    const project = st.project || (isLogic ? logic().project(tp.start.logic, L(tp.title)) : tp.start);
    const panel = document.createElement('div'); panel.className = 'sessPanel labPanel' + (isLogic ? ' logicLab' : isPneu ? ' pneuLab' : '');
    const save = () => { st.project = app.projectData(); store(tp.id, st); };
    const total = tp.steps.length, doneN = () => st.done.filter(Boolean).length;
    let offLogic = null;
    /* ---------- Tutoriel : l'étape reste affichée sur le plan, montre où cliquer et se valide toute seule ---------- */
    let auto = null, coach = null, coachMin = false, spots = null, spotted = -1, codeMemo = null;
    /** Contrôle sans message (validation automatique) : vrai quand l'étape est réussie. */
    function quick(c) {
      try {
        if (c.type === 'parts') return checkParts(c, env).ok;
        if (c.type === 'wired') return checkWired(c, env).ok;
        if (c.type === 'pneu-parts') return checkPneuParts(c, env).ok;
        if (c.type === 'pneu-tube') return checkPneuTube(c, env).ok;
        if (c.type === 'grafcet') return checkGrafcet(c, env).ok;
        if (c.type === 'ui') return checkUiState(c, env).ok;
        if (c.type === 'wire') return checkWire(c, env).ok;
        if (c.type === 'code') { const p = env.program(), key = p ? p.code : ''; if (!codeMemo || codeMemo[0] !== key) codeMemo = [key, !!key.trim() && checkCode(c, env).ok]; return codeMemo[1]; } // compilé une fois par version du programme
      } catch (e) { console.error(e); }
      return false;
    }
    function stopAuto() { if (auto) { clearInterval(auto); auto = null; } }
    function startAuto() {
      stopAuto();
      const i = st.step, c = tp.steps[i].check;
      if (!tp.tutorial || !c || st.done[i]) return;
      // Contrôle de structure : relu régulièrement ; observation : démarre seule dès que la simulation tourne.
      if (AUTO_CHECKS.has(c.type)) auto = setInterval(() => { if (st.step !== i || st.done[i]) { stopAuto(); return; } if (quick(c)) { stopAuto(); verify(i); } }, c.type === 'code' ? 1200 : 600);
      else if (c.type === 'pneu-seq' || c.type === 'watch') auto = setInterval(() => { if (st.step !== i || st.done[i]) { stopAuto(); return; } if (!watcher && app.simOn()) { stopAuto(); verify(i); } }, 500);
    }
    function clearSpots() { if (spots) { clearInterval(spots.t); clearTimeout(spots.end); spots.els.forEach(e => e.remove()); spots = null; } }
    /** Entoure les éléments visibles désignés par les sélecteurs de l'étape (8 au plus) ; rend leur nombre. */
    function showSpots(list, ms = 8000) {
      clearSpots();
      const targets = [];
      for (const sel of list || []) {
        let found = []; try { found = [...document.querySelectorAll(sel)]; } catch (e) { continue; } // sélecteur invalide : ignoré
        for (const el of found) if (targets.length < 8 && !targets.includes(el) && el.getClientRects().length) targets.push(el);
      }
      if (!targets.length) return 0;
      const els = targets.map(() => { const d = document.createElement('div'); d.className = 'labSpot'; d.setAttribute('aria-hidden', 'true'); document.body.appendChild(d); return d; });
      // Visible seulement si l'élément est vraiment là, au premier plan (pas défilé hors de sa liste, pas caché).
      const seen = (t, r) => { const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === t || t.contains(h) || h.contains(t)); };
      const place = () => targets.forEach((t, k) => {
        const r = t.getBoundingClientRect(), d = els[k], vis = t.isConnected && r.width > 0 && r.height > 0 && seen(t, r);
        if (d.hidden !== !vis) d.hidden = !vis;
        if (vis) d.style.cssText = `left:${r.left - 5}px;top:${r.top - 5}px;width:${r.width + 10}px;height:${r.height + 10}px`;
      });
      place();
      try { targets[0].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ancien navigateur */ }
      spots = { els, t: setInterval(place, 200), end: setTimeout(clearSpots, ms) };
      return targets.length;
    }
    function showMe() { const s = tp.steps[st.step]; if (!showSpots(s.spot)) toast(tl('Rien à montrer ici pour l’instant : suivez le texte de l’étape.')); }
    /** Carte de l'étape en cours, posée sur le plan de travail (le panneau du TP peut rester derrière un autre onglet). */
    function renderCoach() {
      if (!tp.tutorial) return;
      if (!coach) {
        coach = document.createElement('section'); coach.className = 'labCoach glass'; coach.setAttribute('aria-label', tl('Tutoriel'));
        (document.querySelector('.app') || document.body).appendChild(coach);
        coach.addEventListener('click', e => {
          const b = e.target.closest('[data-lc]'); if (!b) return;
          const i = st.step, k = b.dataset.lc, c = tp.steps[i].check;
          if (k === 'prev') go(i - 1);
          if (k === 'next') { if (!c || c.type === 'info') { if (!st.done[i]) pass(i, ''); } if (i < total - 1) go(i + 1); }
          if (k === 'check') verify(i);
          if (k === 'show') showMe();
          if (k === 'panel') app.sessionTab.show();
          if (k === 'min') { coachMin = !coachMin; renderCoach(); }
        });
      }
      const i = st.step, s = tp.steps[i], c = s.check, r = st.results[i], done = st.done[i], last = i === total - 1;
      const answer = c && !AUTO_CHECKS.has(c.type) && !['info', 'watch', 'pneu-seq'].includes(c.type); // quiz, mesure… : dans le panneau
      const main = done || !c || c.type === 'info'
        ? `<button type="button" class="btn primary small" data-lc="next"${last && done ? ' disabled' : ''}>${last ? tl('Terminer') : tl('Étape suivante')}${icon('chevRight')}</button>`
        : answer ? `<button type="button" class="btn primary small" data-lc="panel">${icon('sidebar')}<span>${tl('Répondre')}</span></button>`
          : `<button type="button" class="btn small${c.type === 'pneu-seq' || c.type === 'watch' ? ' primary' : ''}" data-lc="check">${icon(c.type === 'pneu-seq' || c.type === 'watch' ? 'eye' : 'check')}<span>${c.type === 'pneu-seq' || c.type === 'watch' ? tl('Observer') : tl('Vérifier')}</span></button>`;
      coach.classList.toggle('min', coachMin); coach.classList.toggle('ok', !!done);
      coach.innerHTML = `<header class="lcHead">${icon('graduation')}<b>${tl('Tutoriel')}</b><span class="lcProg"><span class="tpBar"><i style="width:${Math.round(100 * doneN() / total)}%"></i></span>${tl('Étape {0}/{1}', i + 1, total)}</span><span class="grow"></span>
          <button type="button" class="tb" data-lc="panel" aria-label="${tl('Ouvrir le panneau du tutoriel')}" title="${tl('Ouvrir le panneau du tutoriel')}">${icon('sidebar')}</button><button type="button" class="tb" data-lc="min" aria-label="${coachMin ? tl('Déplier') : tl('Réduire')}" title="${coachMin ? tl('Déplier') : tl('Réduire')}">${icon(coachMin ? 'chevUp' : 'chevDown')}</button></header>
        <div class="lcBody"><h3>${done ? icon('check') : ''}<span>${esc(L(s.title))}</span></h3><div class="labText lcText">${md(L(s.text))}</div>
          ${keepHtml(s)}
          ${r ? `<div class="labRes ${r.ok ? 'ok' : 'ko'}">${icon(r.ok ? 'check' : 'alert')}<span>${r.msg || tl('Étape validée.')}</span></div>` : ''}
          ${s.hint && r && !r.ok ? `<p class="lcHint">${icon('info')}<span>${esc(L(s.hint))}</span></p>` : ''}
          ${!done && c && (c.type === 'pneu-seq' || c.type === 'watch') && watcher ? `<p class="lcWatch"><span class="dotsAnim"><i></i><i></i><i></i></span>${tl('En observation…')}</p>` : ''}</div>
        <footer class="lcFoot"><button type="button" class="btn small" data-lc="prev"${i ? '' : ' disabled'} aria-label="${tl('Étape précédente')}">${icon('chevLeft')}</button>${s.spot ? `<button type="button" class="btn small" data-lc="show">${icon('target')}<span>${tl('Montrer')}</span></button>` : ''}<span class="grow"></span>${main}</footer>`;
      hydrateIcons(coach);
    }
    /** « À retenir » d'une étape : l'idée à garder, mise en avant sous la consigne. */
    const ASKS = new Set(['quiz', 'measure', 'expr', 'table-fill']);
    function keepHtml(s) { const k = tp.steps.indexOf(s); return s.keep && !(s.check && ASKS.has(s.check.type) && !st.done[k]) ? `<aside class="labKeep">${icon('star')}<div><b>${tl('À retenir')}</b>${md(L(s.keep))}</div></aside>` : ''; }
    /** Bilan du TP terminé : ce qu'il faut en garder. */
    function takeHtml() { return (tp.takeaways || []).length ? `<aside class="labTake"><b>${icon('star')}${tl('Ce qu’il faut retenir')}</b><ul>${tp.takeaways.map(t => `<li>${md(L(t)).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul></aside>` : ''; }
    function endTutorial() { stopAuto(); clearSpots(); if (coach) { coach.remove(); coach = null; } }

    function render() {
      stopWatch();
      const i = st.step, s = tp.steps[i], c = s.check, r = st.results[i];
      panel.innerHTML = `<header class="spHead"><span class="kind lab ${tp.domain}">${icon(tp.tutorial ? 'graduation' : isLogic ? 'logic' : isPneu ? 'pneu' : 'checklist')}${tp.tutorial ? tl('Tutoriel') : isLogic ? tl('TP de logique') : isPneu ? tl('TP de pneumatique') : tl('Travaux pratiques')} · ${LEVELS[tp.level] ? LEVELS[tp.level]() : ''}</span><h2>${esc(L(tp.title))}</h2>
        <div class="labProg"><span class="tpBar"><i style="width:${Math.round(100 * doneN() / total)}%"></i></span><b>${doneN()}/${total}</b></div>
        <div class="labSteps">${tp.steps.map((x, k) => `<button type="button" class="ls${k === i ? ' on' : ''}${st.done[k] ? ' ok' : ''}" data-go="${k}" title="${esc(`${k + 1}. ${L(x.title)}`)}">${st.done[k] ? icon('check') : k + 1}</button>`).join('')}</div></header>
        <div class="spBody"><div class="labStep"><span class="lsNum">${icon(CHECK_ICON[c ? c.type : 'info'] || 'info')}${tl('Étape {0}', i + 1)}</span><h3>${esc(L(s.title))}</h3><div class="labText">${md(L(s.text))}</div>
          ${keepHtml(s)}
          ${checkUi(s, c, i)}
          ${r ? `<div class="labRes ${r.ok ? 'ok' : 'ko'}">${icon(r.ok ? 'check' : 'alert')}<span>${r.msg}</span></div>${r.detail || ''}` : ''}
          ${s.hint ? `<details class="labHint"${r && !r.ok ? ' open' : ''}><summary>${icon('info')}${tl('Indice')}</summary><p>${esc(L(s.hint))}</p></details>` : ''}
          ${s.spot ? `<button type="button" class="btn small labShow" data-show-me>${icon('target')}<span>${tl('Montrer où cliquer')}</span></button>` : ''}
        </div>${st.finishedAt ? `<div class="labDone">${icon('award')}<div><b>${tp.tutorial ? tl('Tutoriel terminé !') : tl('TP terminé !')}</b><small>${tl('Toutes les étapes sont validées. Exportez votre compte-rendu.')}</small></div></div>${takeHtml()}` : ''}</div>
        <footer class="spFoot labFoot"><button type="button" class="btn" data-prev ${i ? '' : 'disabled'} aria-label="${tl('Étape précédente')}">${icon('chevLeft')}</button>
          ${c && c.type !== 'info' && !st.done[i] ? `<button type="button" class="btn primary grow" data-check>${icon('check')}<span>${c.type === 'watch' || c.type === 'pneu-seq' ? tl('Observer') : tl('Vérifier')}</span></button>` : `<button type="button" class="btn primary grow" data-next ${i < total - 1 || !st.done[i] ? '' : 'disabled'}>${i < total - 1 ? tl('Étape suivante') : st.done[i] ? tl('Dernière étape') : tl('Terminer')}${icon(i < total - 1 ? 'chevRight' : 'check')}</button>`}
          <button type="button" class="btn" data-report title="${tl('Compte-rendu en PDF')}">${icon('pdf')}</button>
          ${app.labPublish && !isLogic ? `<button type="button" class="btn" data-publish title="${tl('Envoyer ce TP à une classe')}">${icon('send')}</button>` : ''}</footer>`;
      hydrateIcons(panel);
      const q = x => panel.querySelector(x);
      if (q('[data-check]')) q('[data-check]').onclick = () => verify(i);
      if (q('[data-show-me]')) q('[data-show-me]').onclick = showMe;
      if (q('[data-next]')) q('[data-next]').onclick = () => { if ((!s.check || s.check.type === 'info') && !st.done[i]) pass(i, ''); go(i + 1); };
      q('[data-prev]').onclick = () => go(i - 1);
      q('[data-report]').onclick = report;
      if (q('[data-publish]')) q('[data-publish]').onclick = () => app.labPublish(tp, { nets: allNets(tp), text: tp.steps.map((x, k) => `${k + 1}. ${L(x.title)}\n${L(x.text)}`).join('\n\n') });
      panel.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => go(+b.dataset.go)));
      paintExpr();
      if (tp.tutorial) {
        renderCoach(); startAuto();
        if (spotted !== i) { spotted = i; clearSpots(); if (!st.done[i] && s.spot) setTimeout(() => { if (st.step === i && coach) showSpots(s.spot); }, 350); }
      }
    }
    /** Table à remplir : entrées données, cases de sortie à cliquer (vide → 0 → 1). */
    function fillTable(c, i) {
      const a = st.answers[i] || {}, rows = 1 << c.inputs.length, outs = Object.keys(c.outputs), want = Object.fromEntries(outs.map(o => [o, expectedCol(c.outputs[o], c.inputs)])), bad = new Set(((st.results[i] && st.results[i].bad) || []).map(([n, k]) => n + k));
      let h = `<div class="lgTT labFill"><table><thead><tr>${c.inputs.map(x => `<th>${esc(x)}</th>`).join('')}<th class="sep"></th>${outs.map(x => `<th class="o">${esc(x)}</th>`).join('')}</tr></thead><tbody>`;
      for (let k = 0; k < rows; k++) {
        h += `<tr>${c.inputs.map((x, j) => `<td>${(k >> (c.inputs.length - 1 - j)) & 1}</td>`).join('')}<td class="sep"></td>`;
        h += outs.map(o => { const v = String(a[o] || '')[k]; if (want[o][k] === 'x') return `<td class="o dc" title="${tl('Case sans importance (combinaison interdite ou impossible)')}">–</td>`; return `<td class="o"><button type="button" class="fillCell${v === '1' || v === '0' ? ' v' + v : ''}${bad.has(o + k) ? ' bad' : ''}" data-fill="${esc(o)}" data-k="${k}" aria-label="${esc(o)}">${v === '1' || v === '0' ? v : '?'}</button></td>`; }).join('') + '</tr>';
      }
      return h + `</tbody></table></div><small class="muted">${tl('Cliquez sur une case pour la changer : ? → 0 → 1.')}</small>`;
    }
    function checkUi(s, c, i) {
      if (!c) return '';
      const a = st.answers[i];
      if (c.type === 'measure') return `<div class="labMeasure"><label>${tl('Valeur mesurée')}<span class="mIn"><input class="sInput" data-ans inputmode="decimal" value="${esc(a ?? '')}" placeholder="0${DEC}00"><b>${unitOf(c)}</b></span></label><small class="muted">${c.unit === 's' ? tl('Lisez-la sur le traceur série (onglet Code, « Traceur »), simulation lancée.') : tl('Mesurez avec le multimètre (bouton « Instruments »), simulation lancée.')}</small></div>`;
      if (c.type === 'quiz') return `<div class="choices${Array.isArray(c.answer) ? ' multi' : ''}">${c.options.map((o, k) => `<label class="choice${[].concat(a ?? []).includes(k) ? ' on' : ''}"><input type="${Array.isArray(c.answer) ? 'checkbox' : 'radio'}" name="q${i}" value="${k}"${[].concat(a ?? []).includes(k) ? ' checked' : ''}><span class="cBox"></span><span>${esc(L(o))}</span></label>`).join('')}</div>`;
      if (c.type === 'pneu-tube') return `<p class="muted small">${icon('pneu')} ${tp.tutorial ? tl('Tirez les tuyaux dans le plan de travail Pneumatique : l’étape se valide dès qu’ils sont justes.') : tl('Tirez les tuyaux dans le plan de travail Pneumatique (sélecteur en haut à gauche), puis cliquez sur « Vérifier ».')}</p>`;
      if (c.type === 'parts') return `<ul class="labNeed">${c.require.map(n => `<li data-need="${esc(needText(n))}">${icon(n.board ? 'cpu' : 'plus')}<span>${esc(needText(n))}</span></li>`).join('')}</ul>`;
      if (c.type === 'pneu-parts') return `<ul class="labNeed">${c.require.map(n => `<li>${icon('pneu')}<span>${esc(pneuNeedText(n))}</span></li>`).join('')}</ul>`;
      if (AUTO_CHECKS.has(c.type) && tp.tutorial) return `<p class="muted small labAuto">${icon('sparkle')} ${tl('Cette étape se valide toute seule dès que c’est juste ; « Vérifier » dit ce qui manque.')}</p>`;
      if (c.type === 'pneu-seq') return `<p class="muted small">${icon('activity')} ${tl('Cliquez sur « Observer », puis lancez le cycle : les courses des vérins sont relevées et comparées au cycle attendu.')}</p><div class="watchState" hidden></div>`;
      if (c.type === 'watch') return `<p class="muted small">${icon('zap')} ${tl('Cliquez sur « Observer », lancez la simulation et faites l’action demandée : la vérification se fait en direct.')}</p><div class="watchState" hidden></div>`;
      if (c.type === 'table-fill') return fillTable(c, i);
      if (c.type === 'expr') return `<div class="labExpr"><label class="lgField"><span>${tl('Équation')}</span><span class="exprIn"><b>${esc(c.output || 'S')} =</b><input class="sInput" data-expr value="${esc(a ?? '')}" spellcheck="false" autocomplete="off" placeholder="${tl('par exemple : A.B + /C')}"></span></label><div class="exprShow" aria-live="polite"></div><small class="muted">${tl('Notation : . pour ET, + pour OU, / devant une lettre (ou \' après) pour NON, ^ pour OU exclusif, parenthèses.')} ${tl('Variables : {0}.', c.vars.join(', '))}</small></div>`;
      if (c.type === 'logic-table') return `<p class="labCheckNote">${icon('list')}<span>${tl('« Vérifier » essaie toutes les combinaisons de {0} et compare {1} à la table attendue.', `<b>${c.inputs.map(esc).join(', ')}</b>`, `<b>${Object.keys(c.outputs).map(esc).join(', ')}</b>`)}</span></p>${isLogic ? `<button type="button" class="btn small" data-show="ltable">${icon('list')}<span>${tl('Voir ma table de vérité')}</span></button>` : ''}`;
      if (c.type === 'logic-seq') return `<details class="labSeq"><summary>${icon('activity')}${tl('Ce qui sera essayé ({0} pas)', c.steps.length)}</summary><ol>${c.steps.map(x => `<li>${esc(seqText(x)) || tl('rien')} → ${Object.entries(x.expect || {}).map(([n, v]) => `${esc(n)} = ${v}`).join(', ')}</li>`).join('')}</ol></details>${isLogic ? `<button type="button" class="btn small" data-show="lwave">${icon('activity')}<span>${tl('Voir le chronogramme')}</span></button>` : ''}`;
      if (c.type === 'logic-parts') return `<p class="labCheckNote">${icon('logic')}<span>${[c.allow ? tl('Éléments permis : {0}.', c.allow.map(typeName).join(', ')) : '', c.require ? tl('Au moins : {0}.', Object.entries(c.require).map(([t, n]) => `${n} × ${typeName(t)}`).join(', ')) : '', c.maxGates != null ? tl('Au plus {0} portes ou blocs.', c.maxGates) : ''].filter(Boolean).join(' ')}</span></p>`;
      return '';
    }
    /** Aperçu de l'équation tapée : lecture, ou erreur. */
    function paintExpr() {
      const inp = panel.querySelector('[data-expr]'), out = panel.querySelector('.exprShow'); if (!inp || !out) return;
      const src = inp.value.trim();
      if (!src) { out.innerHTML = ''; return; }
      try {
        const e = parseExpr(src), html = exprHtml(e);
        out.className = 'exprShow ok'; out.innerHTML = `${tl('Lu :')} <span class="eq">${html}</span>`;
      } catch (err) { out.className = 'exprShow ko'; out.textContent = tl('Pas encore lisible : {0}', tl(err.message) + (err.ch ? ` « ${err.ch} »` : '')); }
    }
    function exprHtml(e, parent = null) {
      const wrap = (s, need) => (need ? `(${s})` : s);
      const prec = { or: 1, xor: 2, and: 3 };
      if (e.op === 'var') return esc(e.name);
      if (e.op === 'const') return String(e.v);
      if (e.op === 'not') return `<span class="ov">${exprHtml(e.a, 'not')}</span>`;
      const sym = e.op === 'or' ? ' + ' : e.op === 'xor' ? ' ⊕ ' : '·';
      return wrap(exprHtml(e.a, e.op) + sym + exprHtml(e.b, e.op), parent && parent !== 'not' && prec[parent] > prec[e.op]);
    }
    panel.addEventListener('change', e => {
      const i = st.step;
      if (e.target.name === 'q' + i) { const v = [...panel.querySelectorAll(`[name="q${i}"]:checked`)].map(x => +x.value); st.answers[i] = Array.isArray(tp.steps[i].check.answer) ? v : v[0]; panel.querySelectorAll('.choice').forEach(l => l.classList.toggle('on', l.querySelector('input').checked)); save(); }
      if (e.target.matches('[data-ans]')) { st.answers[i] = e.target.value; save(); }
    });
    panel.addEventListener('input', e => { if (e.target.matches('[data-expr]')) { st.answers[st.step] = e.target.value; paintExpr(); clearTimeout(panel.t); panel.t = setTimeout(save, 300); } });
    panel.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-expr]')) { e.preventDefault(); verify(st.step); } });
    panel.addEventListener('click', e => {
      const cell = e.target.closest('[data-fill]');
      if (cell) {
        const i = st.step, c = tp.steps[i].check, n = 1 << c.inputs.length, o = cell.dataset.fill, k = +cell.dataset.k;
        const a = st.answers[i] || (st.answers[i] = {});
        const cur = (String(a[o] || '').padEnd(n, '?')).split(''); cur[k] = cur[k] === '0' ? '1' : '0'; a[o] = cur.join('');
        cell.textContent = cur[k]; cell.className = 'fillCell v' + cur[k];
        save(); return;
      }
      const sh = e.target.closest('[data-show]'); if (sh && logic()) logic().showTab(sh.dataset.show);
      // Étape « watch » de pneumatique : maintenir un bouton de distributeur (les deux mains d'une presse…).
      const wp = e.target.closest('[data-wpush]'), box = wp && wp.closest('.watchState');
      if (wp && app.pneu && box && box.pushBtn) { const k = wp.dataset.wpush; app.pneu.press(k, !app.pneu.isPushed(k)); wp.outerHTML = box.pushBtn(k); if (app.pneu.refresh) app.pneu.refresh(); }
    });
    function go(i) { if (i < 0 || i >= total) return; st.step = i; save(); render(); }
    function pass(i, msg, detail = '') {
      st.done[i] = true; st.results[i] = { ok: true, msg, detail };
      if (st.done.every(Boolean) && !st.finishedAt) { st.finishedAt = Date.now(); toast(tp.tutorial ? tl('Tutoriel terminé : bravo !') : tl('TP terminé : bravo !')); }
      save(); sessions.paintChip(); render();
      // Tutoriel : une étape réussie laisse lire son message, puis passe à la suivante.
      const c = tp.steps[i].check;
      if (tp.tutorial && c && c.type !== 'info' && i < total - 1) setTimeout(() => { if (st.step === i && coach) go(i + 1); }, 1600);
    }
    function fail(i, msg, extra = {}) { st.results[i] = { ok: false, msg, ...extra }; save(); render(); }
    /** Lignes fausses d'une table : entrées, attendu, obtenu. */
    function diffTable(r) {
      const rows = r.rows.filter(x => !x.ok).slice(0, 8);
      return `<div class="lgTT labDiff"><table><thead><tr>${r.inputs.map(x => `<th>${esc(x)}</th>`).join('')}<th class="sep"></th>${r.outputs.map(x => `<th class="o">${esc(x)}<small>${tl('attendu')}</small></th><th class="o">${esc(x)}<small>${tl('obtenu')}</small></th>`).join('')}</tr></thead><tbody>${rows.map(x => `<tr>${x.in.map(b => `<td>${b}</td>`).join('')}<td class="sep"></td>${r.outputs.map(o => `<td class="o">${x.want[o] === 'x' ? '–' : x.want[o]}</td><td class="o${x.want[o] !== 'x' && x.want[o] !== x.got[o] ? ' bad' : ''}">${x.got[o].toUpperCase()}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${r.bad > rows.length ? `<small class="muted">${tl('… et {0} autre(s) ligne(s).', r.bad - rows.length)}</small>` : ''}`;
    }
    function verify(i) {
      const c = tp.steps[i].check;
      if (c.type === 'wire') {
        const r = checkWire(c, env);
        const short = r.missing.find(m => m.why === 'short');
        if (short) return fail(i, tl('{0} est court-circuité : ses deux pattes arrivent au même point. Chaque patte doit aller d’un côté différent.', short.comp));
        const pin = p => p.split('|').map(x => x.replace(/\*$/, '…')).join(tl(' ou '));
        return r.ok ? pass(i, tl('Câblage correct.')) : fail(i, tl('Pas encore : {0}', r.missing.map(m => m.group.map(pin).join(' ↔ ')).join(' ; ')));
      }
      if (c.type === 'parts') {
        const r = checkParts(c, env);
        return r.ok ? pass(i, tl('Tous les composants sont là.')) : fail(i, tl('Il manque dans le montage : {0}.', r.missing.map(needText).join(', ')));
      }
      if (c.type === 'wired') {
        const r = checkWired(c, env);
        if (r.ok) return pass(i, tl('Montage câblé, sans erreur de câblage.'));
        if (r.why === 'empty') return fail(i, tl('Le montage est vide : ajoutez d’abord les composants.'));
        return fail(i, r.unwired.length ? tl('Encore à câbler : {0}. « Câbler tout le circuit » (onglet Câblage) s’en charge.', r.unwired.join(', ')) : tl('Erreur de câblage sur {0} : voyez l’onglet Câblage.', r.errors.join(', ')));
      }
      if (c.type === 'pneu-parts') {
        const r = checkPneuParts(c, env);
        if (r.ok) return pass(i, tl('Éléments du plan pneumatique corrects.'));
        if (r.wrong.length) { const w = r.wrong[0]; return fail(i, tl('{0} : réglez {1} (onglet Pneumatique de l’inspecteur, élément choisi).', pneuNeedText(w.need), w.diff.map(k => `${PROP_NAME[k] ? PROP_NAME[k]() : k} = ${w.need.p[k]}`).join(', '))); }
        return fail(i, tl('Il manque dans le plan pneumatique : {0}.', r.missing.map(pneuNeedText).join(', ')));
      }
      if (c.type === 'grafcet') {
        const r = checkGrafcet(c, env);
        if (r.ok) return pass(i, tl('GRAFCET correct : il commande et lit ce qu’il faut.'));
        if (r.why === 'empty') return fail(i, tl('Écrivez le GRAFCET : au moins {0} étapes (bouton GRAFCET du plan pneumatique).', c.minSteps || 2));
        if (r.why === 'errors') return fail(i, r.errors[0]);
        return fail(i, r.why === 'outputs' ? tl('Le GRAFCET ne commande pas encore {0} : écrivez-le dans les actions d’une étape.', r.names.join(', ')) : tl('Le GRAFCET ne lit pas encore {0} : écrivez-le dans une réceptivité.', r.names.join(', ')));
      }
      if (c.type === 'ui') {
        const r = checkUiState(c, env);
        return r.ok ? pass(i, tl('C’est bien ça.')) : fail(i, r.missing.map(n => (UI_TODO[n] ? UI_TODO[n]() : n)).join(' '));
      }
      if (c.type === 'pneu-tube') {
        const r = checkPneuTube(c, env);
        return r.ok ? pass(i, tl('Tuyaux corrects.')) : fail(i, tl('Pas encore : {0}', r.missing.map(m => m.group.map(portText).join(' ↔ ')).join(' ; ')));
      }
      if (c.type === 'code') {
        const r = checkCode(c, env);
        if (r.ok) return pass(i, tl('Programme correct : il compile et contient ce qu’il faut.'));
        if (r.why === 'empty') return fail(i, tl('Le programme est vide : écrivez-le dans l’onglet Code.'));
        if (r.why === 'compile') return fail(i, tl('Le programme ne compile pas : {0}', r.errors.slice(0, 2).map(e => tl('ligne {0} : {1}', e.line, e.msg)).join(' ; ')));
        return fail(i, tl('Il manque quelque chose dans le programme (relisez la consigne).'));
      }
      if (c.type === 'measure') {
        const r = checkMeasure(c, st.answers[i], env);
        if (r.why === 'nosim') return fail(i, tl('Lancez la simulation pour que la mesure puisse être vérifiée.'));
        if (r.why === 'nan') return fail(i, tl('Entrez un nombre.'));
        return r.ok ? pass(i, tl('Juste : environ {0} {1}.', num(r.expected), unitOf(c))) : fail(i, tl('Pas tout à fait : vérifiez où vous posez les pointes du multimètre.'));
      }
      if (c.type === 'quiz') return checkQuiz(c, st.answers[i]).ok ? pass(i, tl('Bonne réponse.')) : fail(i, tl('Ce n’est pas la bonne réponse.'));
      if (c.type === 'watch' || c.type === 'pneu-seq') {
        if (!app.simOn()) { app.setSim(true); setTimeout(() => app.sessionTab.show(), 30); } // le TP reste au premier plan pendant l'observation
        const box = panel.querySelector('.watchState'); box.hidden = false;
        // Éléments du plan pneumatique (vérins, boutons des distributeurs) : nommés par leur repère (1A, 1S1…) ;
        // boutons du pupitre du GRAFCET (dcy…) : par leur nom.
        const pc = env.pneu(), onBench = n => app.comps().some(x => x.name === n);
        const isInput = n => !onBench(n) && !!(app.pneu && app.pneu.isGrafcetInput(n));
        const pEl = n => (!onBench(n) && pc ? pc.elements.find(x => x.id === n.replace(/:R$/, '')) || (isInput(n) ? { id: n, type: 'input', p: {} } : null) : null);
        const nameOf = n => { const e = pEl(n); return e ? (e.p && e.p.label) || n : n; };
        const STATE = { pressed: tl('appuyé'), released: tl('relâché'), on: tl('allumé'), off: tl('éteint') };
        const names = [...Object.keys(c.when || {}), ...(c.type === 'watch' ? Object.keys(c.expect || {}) : [])], pneuOnly = c.type === 'pneu-seq' || (names.length && names.every(n => pEl(n)));
        const expectTxt = Object.entries(c.when || {}).map(([n, v]) => `${nameOf(n)} ${STATE[v] || v}`).join(', ');
        // Boutons à maintenir (deux mains…) : un interrupteur par bouton de distributeur ou du pupitre nommé dans « when ».
        const pushKeys = Object.entries(c.when || {}).filter(([n, v]) => { const e = pEl(n); return v === 'pressed' && e && (/^v/.test(e.type) || e.type === 'input'); }).map(([n]) => n);
        const pushBtn = k => { const on = app.pneu && app.pneu.isPushed(k); return `<button type="button" class="btn small${on ? ' primary' : ''}" data-wpush="${esc(k)}" aria-pressed="${!!on}">${icon('pneu')}<span>${esc(on ? tl('Relâcher {0}', nameOf(k)) : tl('Appuyer sur {0}', nameOf(k)))}</span></button>`; };
        const want = c.type === 'pneu-seq' ? expectOf(c.expect).map(m => m.replace('-', '−')).join(' ') : '';
        const intro = c.type === 'pneu-seq' ? tl('En observation : lancez le cycle{0}. Cycle attendu : {1}.', expectTxt ? ` (${esc(expectTxt)})` : '', esc(want)) : expectTxt ? tl('En observation : faites en sorte que {0}…', esc(expectTxt)) : tl('En observation…');
        box.innerHTML = `<div class="wsMsg"><span class="dotsAnim"><i></i><i></i><i></i></span>${intro}</div>${pushKeys.length && app.pneu ? `<div class="watchPush">${pushKeys.map(pushBtn).join('')}</div>` : ''}${c.type === 'pneu-seq' ? '<div class="seqSeen"></div>' : ''}`;
        box.pushBtn = pushBtn;
        if (tp.tutorial) setTimeout(renderCoach, 0); // « En observation… » sur la carte du tutoriel
        if (c.type === 'pneu-seq') {
          // Mouvements relevés depuis le début de l'observation (la simulation relancée repart de zéro).
          let t0s = app.pneu ? app.pneu.simTime() : 0, lastT = t0s; const t0 = performance.now();
          watcher = setInterval(() => {
            if (!app.pneu) return;
            const now = performance.now(), ts = app.pneu.simTime(); if (ts < lastT) t0s = 0; lastT = ts;
            const moves = app.pneu.moves().filter(m => m.t0 >= t0s - 1e-6), r = checkPneuSeq(c, moves);
            const seen = box.querySelector('.seqSeen'), txt = r.seen.slice(-12).map(m => m.replace('-', '−')).join(' ');
            if (seen && seen.dataset.t !== txt) { seen.dataset.t = txt; seen.innerHTML = txt ? `${tl('Observé :')} <b>${esc(txt)}</b>` : ''; }
            if (r.ok) { stopWatch(); pass(i, tl('Cycle observé : {0}. C’est bien ça !', want)); return; }
            if (now - t0 > 90000) { stopWatch(); fail(i, r.seen.length ? tl('Cycle observé : {0} ; attendu : {1}. Vérifiez les tuyaux de commande, les galets ou le GRAFCET.', r.seen.join(' ').replace(/-/g, '−'), want) : tl('Aucun mouvement en 90 s : relancez l’observation et lancez le cycle.')); }
          }, 150);
          return;
        }
        let since = 0; const t0 = performance.now();
        watcher = setInterval(() => {
          const r = checkWatch(c, env), now = performance.now();
          if (r.ok) { if (!since) since = now; if (now - since >= (c.hold || 400)) { stopWatch(); pass(i, tl('Comportement observé : c’est bien ça !')); } return; }
          since = 0;
          if (!r.waiting && r.bad && r.bad.length) box.querySelector('.wsMsg').innerHTML = `${icon('alert')}${pneuOnly ? tl('{0} ne réagit pas comme prévu : vérifiez les tuyaux et les réglages.', esc(r.bad.map(nameOf).join(', '))) : tl('{0} ne réagit pas comme prévu : vérifiez le câblage et le programme.', esc(r.bad.map(nameOf).join(', ')))}`;
          if (now - t0 > 45000) { stopWatch(); fail(i, tl('Rien observé en 45 s : relancez l’observation et faites l’action demandée.')); }
        }, 100);
        return;
      }
      /* ----- Logique ----- */
      if (c.type === 'table-fill') {
        const r = checkTableFill(c, st.answers[i]);
        if (r.ok) return pass(i, tl('Table de vérité juste.'));
        return fail(i, r.why === 'empty' ? tl('Remplissez toutes les cases (il reste des « ? »).') : tl('{0} case(s) fausse(s), en rouge. Essayez ces combinaisons sur le plan de travail.', r.bad.length), { bad: r.bad });
      }
      if (c.type === 'expr') {
        const r = checkExpr(c, st.answers[i]);
        if (r.ok) return pass(i, tl('Équation juste.'));
        if (r.why === 'long') return fail(i, tl('Équation juste, mais elle peut être plus simple : {0} termes au plus (vous en avez {1}). Regroupez les cases à 1 du tableau de Karnaugh.', r.max, r.terms));
        if (r.why === 'form') return fail(i, FORM_MSG[r.form] ? FORM_MSG[r.form]() : tl('Équation juste, mais pas sous la forme demandée.'));
        if (r.why === 'empty') return fail(i, tl('Écrivez l’équation dans le champ.'));
        if (r.why === 'syntax') return fail(i, tl('Équation illisible : {0}', tl(r.msg) + (r.ch ? ` « ${esc(r.ch)} »` : '')));
        if (r.why === 'vars') return fail(i, tl('Variable inconnue : {0}. Utilisez {1}.', r.names.join(', '), c.vars.join(', ')));
        return fail(i, tl('Cette équation ne donne pas la bonne table de vérité.'));
      }
      const circuit = logic() ? logic().circuit() : { elements: [], wires: [] };
      if (c.type === 'logic-table') {
        const r = checkLogicTable(c, circuit);
        if (r.ok) return pass(i, tl('Table de vérité correcte : le circuit fait ce qui est demandé.'));
        if (r.why === 'missingIn') return fail(i, tl('Entrée introuvable : {0}. Gardez les entrées du TP avec leur nom (repère).', r.names.join(', ')));
        if (r.why === 'missingOut') return fail(i, tl('Sortie introuvable : {0}. Gardez les sorties du TP avec leur nom (repère).', r.names.join(', ')));
        if (r.why === 'tooMany') return fail(i, tl('Trop d’entrées pour une table de vérité.'));
        if (r.why === 'unknown') return fail(i, tl('Certaines sorties restent inconnues (X ou Z) : une entrée de porte ou une sortie n’est reliée à rien.'), { detail: diffTable(r) });
        return fail(i, tl('{0} ligne(s) sur {1} ne donnent pas le bon résultat :', r.bad, r.rows.length), { detail: diffTable(r) });
      }
      if (c.type === 'logic-seq') {
        const r = checkLogicSeq(c, circuit);
        if (r.ok) return pass(i, tl('Le circuit réagit comme prévu à chaque pas.'));
        if (r.why === 'missing') return fail(i, tl('Entrée ou sortie introuvable : {0}.', r.names.join(', ')));
        if (r.bad.every(n => r.got[n] > 1)) return fail(i, tl('Sorties encore inconnues (X ou Z) : {0}. Elles ne sont pas reliées, ou une entrée de porte est en l’air.', r.bad.join(', ')));
        const stp = c.steps[r.step], got = r.bad.map(n => `${n} = ${['0', '1', 'X', 'Z'][r.got[n]]}`).join(', '), want = r.bad.map(n => `${n} = ${r.want[n]}`).join(', ');
        return fail(i, tl('Pas {0} ({1}) : {2} attendu, mais {3}.', r.step + 1, seqText(stp) || tl('au départ'), want, got));
      }
      if (c.type === 'logic-parts') {
        const r = checkLogicParts(c, circuit);
        if (r.ok) return pass(i, tl('Éléments utilisés conformes à la consigne.'));
        if (r.why === 'forbidden') return fail(i, tl('Éléments non permis ici : {0}.', r.types.map(typeName).join(', ')));
        if (r.why === 'missing') return fail(i, tl('Il manque : {0}.', r.types.map(typeName).join(', ')));
        return fail(i, tl('{0} portes ou blocs : {1} au plus.', r.total, r.max));
      }
    }
    function stopWatch() { if (watcher) { clearInterval(watcher); watcher = null; } }

    /* ---------- Compte-rendu ---------- */
    async function report() {
      let name = ''; try { name = localStorage.getItem('jollof-student-name') || ''; } catch (e) { /* rien */ }
      const u = app.school && app.school.user && app.school.user();
      name = await ask(tl('Compte-rendu de TP'), tl('Votre nom (il figure sur le compte-rendu)'), name || (u ? u.displayName : ''), { ok: tl('Créer le PDF') });
      if (!name) return; // annulé (null) ou champ vide (false)
      try { localStorage.setItem('jollof-student-name', name); } catch (e) { /* rien */ }
      const { Draw, toPdf, textWidth, frame } = app.pdf, W = 297, H = 210, pages = [];
      const fit = (t, w, sz) => { t = String(t ?? ''); while (t.length > 2 && textWidth(t, sz) > w) t = t.slice(0, -2) + '…'; return t; };
      const wrap = (t, w, sz) => { const out = []; let line = ''; for (const wd of String(t).replace(/\*\*|`/g, '').split(/\s+/)) { if (line && textWidth(line + ' ' + wd, sz) > w) { out.push(line); line = wd; } else line = line ? line + ' ' + wd : wd; } if (line) out.push(line); return out; };
      const meta = () => ({ title: L(tp.title), doc: tl('Compte-rendu de TP'), date: new Date().toLocaleDateString(LANG === 'en' ? 'en-GB' : 'fr-FR'), scale: name || '—', boards: LEVELS[tp.level] ? LEVELS[tp.level]() : '' });
      const page = no => { const d = new Draw(); const ar = frame(d, W, H, meta(), no, 0); pages.push({ w: W, h: H, ops: d.ops }); return { d, ar }; };
      let { d, ar } = page(1), y = ar.y0 + 7, no = 1;
      d.text(ar.x0, y, fit(L(tp.title), 200, 4.2), { s: 4.2, b: true }); y += 6;
      d.text(ar.x0, y, fit(`${tl('Élève')} : ${name}   ·   ${tl('Étapes validées : {0}/{1}', doneN(), total)}   ·   ${tl('Durée : {0} min', Math.max(1, Math.round(((st.finishedAt || Date.now()) - st.startedAt) / 60000)))}`, 260, 2.4), { s: 2.4, color: '#444444' }); y += 7;
      d.text(ar.x0, y, tl('Objectifs'), { s: 3, b: true }); y += 4.5;
      for (const o of tp.objectives || []) { d.text(ar.x0 + 3, y, '• ' + fit(L(o), 250, 2.3), { s: 2.3 }); y += 3.8; }
      y += 3;
      if ((tp.takeaways || []).length) {
        d.text(ar.x0, y, tl('Ce qu’il faut retenir'), { s: 3, b: true }); y += 4.5;
        for (const t of tp.takeaways) for (const [k, l] of wrap(L(t), 250, 2.3).slice(0, 3).entries()) { d.text(ar.x0 + 3, y, (k ? '  ' : '• ') + l, { s: 2.3 }); y += 3.8; }
        y += 3;
      }
      const answerText = (c, a) => {
        if (c.type === 'quiz') return [].concat(a).map(x => L(c.options[x])).join(', ');
        if (c.type === 'table-fill') return Object.entries(a || {}).map(([n, v]) => `${n} = ${v}`).join('   ');
        if (c.type === 'expr') return `${c.output || 'S'} = ${a}`;
        return `${a} ${unitOf(c)}`;
      };
      tp.steps.forEach((s, k) => {
        const res = st.results[k], lines = wrap(L(s.text), 200, 2.1).slice(0, 4), need = 7 + lines.length * 3.2 + (st.answers[k] != null ? 3.4 : 0);
        if (y + need > ar.y1 - 30) { ({ d, ar } = page(++no)); y = ar.y0 + 7; }
        d.rect(ar.x0, y - 3.6, 4.2, 4.2, { w: 0.2, fill: st.done[k] ? '#3fb27f' : null });
        d.text(ar.x0 + 6, y, fit(`${k + 1}. ${L(s.title)}`, 190, 2.7), { s: 2.7, b: true });
        d.text(ar.x0 + 210, y, st.done[k] ? tl('validée') : tl('non validée'), { s: 2.3, color: st.done[k] ? '#1f7a4f' : '#a33' }); y += 4;
        lines.forEach(l => { d.text(ar.x0 + 6, y, l, { s: 2.1, color: '#444444' }); y += 3.2; });
        const c = s.check;
        if (c && st.answers[k] != null) {
          d.text(ar.x0 + 6, y, fit(`${tl('Réponse')} : ${answerText(c, st.answers[k])}${res && res.msg ? ' — ' + res.msg.replace(/<[^>]+>/g, '') : ''}`, 250, 2.2), { s: 2.2, color: '#1b4f8c' }); y += 3.4;
        }
        y += 2.5;
      });
      if (isLogic) {
        // Le circuit logique sur une page à part, à l'échelle de la feuille.
        const p2 = page(++no); p2.d.text(p2.ar.x0, p2.ar.y0 + 6, tl('Circuit logique'), { s: 3.4, b: true });
        logic().drawPdf(p2.d, { x0: p2.ar.x0 + 4, y0: p2.ar.y0 + 12, x1: p2.ar.x1 - 4, y1: p2.ar.y1 - 26 });
        pages[pages.length - 1].ops = p2.d.ops;
      } else {
        const sch = app.schematic({ format: 'A4', lists: false });
        sch.pages.forEach(p => pages.push({ w: p.w, h: p.h, ops: p.ops }));
      }
      const totalP = pages.length;
      pages.forEach((p, k) => p.ops.forEach(op => { if (op.t === 'text' && /^\d+ \/ \d+$/.test(op.str)) op.str = `${k + 1} / ${totalP}`; }));
      const bytes = toPdf(pages, { title: `${L(tp.title)} — ${tl('compte-rendu')}` });
      const file = `${tp.id}-${name.replace(/[\\/:*?"<>|]+/g, '-') || 'eleve'}.pdf`;
      const path = await app.saveFile(new Blob([bytes], { type: 'application/pdf' }), file, tl('Document PDF'), 'pdf');
      if (path) toast(app.isDesktop() ? tl('Compte-rendu enregistré : {0}', path) : tl('Compte-rendu téléchargé.'));
    }

    const ok = await sessions.begin({
      kind: 'lab', panel, name: L(tp.title), data: project,
      chip: () => ({ icon: tp.tutorial ? 'graduation' : isLogic ? 'logic' : isPneu ? 'pneu' : 'checklist', title: L(tp.title), meta: tl('étape {0}/{1}', st.step + 1, total), tone: st.finishedAt ? 'done' : 'work', actions: [{ id: 'end', icon: 'x', tip: tl('Quitter le TP (votre progression est gardée)') }] }),
      action: id => { if (id === 'end') sessions.end(); },
      beforeEnd: async () => { stopWatch(); endTutorial(); save(); return true; },
      onEnd: () => { stopWatch(); endTutorial(); if (offLogic) { clearTimeout(offLogic.t); offLogic(); } } // plus d'enregistrement : le projet personnel revient
    });
    if (!ok) return;
    // Plan de travail du TP : pneumatique (sauf un TP qui commence par le câblage de la carte), logique, ou montage.
    if (app.pneu) app.pneu.setMode(isPneu && tp.workspace !== 'elec');
    if (isPneu && logic() && logic().isOn()) logic().setMode(false);
    if (isPneu) app.sessionTab.show();
    if (isLogic) {
      logic().setMode(true);
      // Le circuit change : la progression (projet compris) est gardée, sans attendre la fin du TP.
      offLogic = logic().onChange(kind => { if (kind === 'struct') { clearTimeout(offLogic.t); offLogic.t = setTimeout(save, 600); } });
      app.sessionTab.show();
    }
    render();
    if (resume) toast(tl('Reprise du TP à l’étape {0}.', st.step + 1));
  }
  return { get list() { return TPS; }, load: loadTps, run, open: openLibrary };
}
