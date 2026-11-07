// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pages de l'élève (édition gratuite comprise) : accueil, classes, devoirs, notes, et la
// séance « devoir » dans le plan de travail (consignes, questions, montage, envoi de la copie).
import { tl } from '../i18n/index.js';
import * as api from './api.js';
import { icon, esc, avatar, chip, kindChip, due, relTime, dateTime, ring, score, num, empty, toast, confirm, clock, debounce } from './ui.js';
import { richHtml, richEditor, plainText, bindLinks, isEmptyDoc } from './rich.js';
import { circuitOf } from './circuit.js';

const greet = () => { const h = new Date().getHours(); return h < 5 || h >= 18 ? tl('Bonsoir') : tl('Bonjour'); };
const done = s => s && ['submitted', 'graded', 'returned'].includes(s.status);
/** Résultats visibles pour l'élève (le serveur les envoie seulement s'ils le sont). */
const hasResults = s => s && s.score != null && ['graded', 'returned'].includes(s.status);

export function assignmentCard(a, { showClass = true } = {}) {
  const s = a.mySubmission, d = due(a.dueAt), st = s ? s.status : 'not_started';
  const cta = a.status === 'closed' && !s ? '' : !s ? tl('Commencer') : s.status === 'in_progress' ? tl('Continuer') : tl('Voir');
  return `<button type="button" class="aCard" data-go="assignment" data-params='${esc(JSON.stringify({ id: a.id }))}' style="--c:${esc(a.classroomColor || 'var(--accent)')}">
    <span class="aStripe"></span>
    <span class="aMain"><span class="aTop">${kindChip(a.kind)}${showClass && a.classroomName ? `<span class="muted">${esc(a.classroomName)}</span>` : ''}</span>
      <b class="aTitle">${esc(a.title)}</b>
      <span class="aMeta">${done(s) ? `<span>${tl('Envoyé {0}', relTime(s.submittedAt))}</span>` : `<span class="due ${d.cls}">${icon('clock')}${d.text}</span>`}<span>${tl('{0} pts', num(a.totalPoints))}</span></span></span>
    <span class="aSide">${hasResults(s) ? ring(s.score, s.maxScore, 46) : chip(st)}${cta ? `<span class="aCta">${cta}${icon('chevRight')}</span>` : ''}</span></button>`;
}

export function installStudent(hub, sessions) {
  const { app } = hub;

  /* ---------- Accueil ---------- */
  hub.nav('home', tl('Accueil'), 'school', ['student'], 10);
  hub.page('home', async ctx => {
    const u = api.user();
    ctx.head(`${greet()}, ${esc(u.displayName.split(' ')[0])}`, [], '');
    const [list, classes] = await Promise.all([api.get('/me/assignments'), api.get('/classrooms')]);
    const todo = list.filter(a => a.status === 'published' && !done(a.mySubmission)).sort((a, b) => (a.dueAt ? new Date(a.dueAt) : 9e15) - (b.dueAt ? new Date(b.dueAt) : 9e15));
    const late = todo.filter(a => a.dueAt && new Date(a.dueAt) < Date.now());
    const graded = list.filter(a => hasResults(a.mySubmission)).sort((a, b) => new Date(b.mySubmission.submittedAt) - new Date(a.mySubmission.submittedAt));
    const avg = graded.length ? graded.reduce((t, a) => t + a.mySubmission.score / (a.mySubmission.maxScore || 1), 0) / graded.length : null;
    ctx.el.innerHTML = `<div class="dash">
      <div class="tiles">
        <div class="tile"><span class="tIc">${icon('inbox')}</span><b>${todo.length}</b><small>${tl('à faire')}</small></div>
        <div class="tile${late.length ? ' warn' : ''}"><span class="tIc">${icon('clock')}</span><b>${late.length}</b><small>${tl('en retard')}</small></div>
        <div class="tile"><span class="tIc">${icon('award')}</span><b>${avg == null ? '—' : Math.round(avg * 100) + ' %'}</b><small>${tl('moyenne des copies corrigées')}</small></div>
        <div class="tile"><span class="tIc">${icon('users')}</span><b>${classes.length}</b><small>${classes.length > 1 ? tl('classes') : tl('classe')}</small></div>
      </div>
      <section class="block"><header><h2>${icon('inbox')}${tl('À faire')}</h2></header>
        ${todo.length ? `<div class="aList">${todo.map(a => assignmentCard(a)).join('')}</div>` : empty('check', tl('Rien à faire pour l’instant'), tl('Les devoirs envoyés par vos enseignants apparaîtront ici.'))}</section>
      <div class="cols2">
        <section class="block"><header><h2>${icon('award')}${tl('Résultats récents')}</h2><button type="button" class="linkBtn" data-go="grades">${tl('Toutes mes notes')}</button></header>
          ${graded.length ? `<div class="aList">${graded.slice(0, 4).map(a => assignmentCard(a)).join('')}</div>` : empty('award', tl('Pas encore de note'), '')}</section>
        <section class="block"><header><h2>${icon('users')}${tl('Mes classes')}</h2></header>
          ${classes.length ? `<div class="classGrid small">${classes.map(classCard).join('')}</div>` : empty('school', tl('Aucune classe'), tl('Votre enseignant vous inscrira dans sa classe.'))}</section>
      </div></div>`;
  }, { roles: ['student'] });

  /* ---------- Classes ---------- */
  hub.nav('classes', tl('Mes classes'), 'users', ['student'], 20);
  hub.page('classes', async ctx => {
    ctx.head(tl('Mes classes'));
    const classes = await api.get('/classrooms');
    ctx.el.innerHTML = classes.length ? `<div class="classGrid">${classes.map(classCard).join('')}</div>` : empty('school', tl('Aucune classe'), tl('Votre enseignant vous inscrira dans sa classe.'));
  }, { roles: ['student'] });

  hub.page('class', async ctx => {
    const tab = ctx.params.tab || 'work';
    const c = await api.get(`/classrooms/${ctx.params.id}`);
    ctx.head(esc(c.name), [{ label: tl('Mes classes'), page: 'classes' }]);
    const tabs = [['work', tl('Devoirs'), 'inbox'], ['groups', tl('Groupes'), 'users'], ['people', tl('Membres'), 'user']];
    ctx.el.innerHTML = `${classBanner(c)}<div class="segTabs">${tabs.map(([k, l, i]) => `<button type="button" class="${k === tab ? 'on' : ''}" data-go="class" data-params='${esc(JSON.stringify({ id: c.id, tab: k }))}'>${icon(i)}${l}</button>`).join('')}<button type="button" data-chat="${c.id}">${icon('message')}${tl('Discussion')}</button></div><div class="tabBody"></div>`;
    const tb = ctx.el.querySelector('.tabBody');
    ctx.el.querySelector('[data-chat]').onclick = () => openClassChat(hub, c.id);
    if (tab === 'work') {
      const list = (await api.get(`/classrooms/${c.id}/assignments`)).map(a => ({ ...a, classroomColor: c.color }));
      const open = list.filter(a => a.status === 'published' && !done(a.mySubmission)), rest = list.filter(a => !open.includes(a));
      tb.innerHTML = list.length ? `${open.length ? `<h3 class="subHead">${tl('À faire')}</h3><div class="aList">${open.map(a => assignmentCard(a, { showClass: false })).join('')}</div>` : ''}${rest.length ? `<h3 class="subHead">${tl('Terminés et clos')}</h3><div class="aList">${rest.map(a => assignmentCard(a, { showClass: false })).join('')}</div>` : ''}` : empty('inbox', tl('Aucun devoir pour l’instant'), '');
    }
    if (tab === 'groups') hub.renderClassGroups(tb, c);
    if (tab === 'people') tb.innerHTML = peopleList(c, hub);
  }, { roles: ['student'] });

  /* ---------- Notes ---------- */
  hub.nav('grades', tl('Mes notes'), 'award', ['student'], 40);
  hub.page('grades', async ctx => {
    ctx.head(tl('Mes notes'));
    const list = (await api.get('/me/assignments')).filter(a => a.mySubmission && done(a.mySubmission));
    const by = new Map(); list.forEach(a => { const k = a.classroomName || ''; if (!by.has(k)) by.set(k, []); by.get(k).push(a); });
    ctx.el.innerHTML = list.length ? [...by].map(([cls, l]) => {
      const g = l.filter(a => hasResults(a.mySubmission)), avg = g.length ? g.reduce((t, a) => t + a.mySubmission.score / (a.mySubmission.maxScore || 1), 0) / g.length : null;
      return `<section class="block"><header><h2>${icon('users')}${esc(cls)}</h2>${avg != null ? `<span class="avgTag">${tl('Moyenne {0} %', Math.round(avg * 100))}</span>` : ''}</header>
        <table class="sTable"><thead><tr><th>${tl('Devoir')}</th><th>${tl('Envoyé')}</th><th>${tl('État')}</th><th class="num">${tl('Note')}</th></tr></thead><tbody>
        ${l.map(a => `<tr data-go="assignment" data-params='${esc(JSON.stringify({ id: a.id }))}' class="rowLink"><td>${kindChip(a.kind)} <b>${esc(a.title)}</b></td><td>${a.mySubmission.submittedAt ? dateTime(a.mySubmission.submittedAt) : '—'}${a.mySubmission.late ? ` <span class="pill late">${tl('en retard')}</span>` : ''}</td><td>${chip(a.mySubmission.status)}</td><td class="num">${hasResults(a.mySubmission) ? score(a.mySubmission.score, a.mySubmission.maxScore) : '—'}</td></tr>`).join('')}
        </tbody></table></section>`;
    }).join('') : empty('award', tl('Pas encore de note'), tl('Vos copies corrigées apparaîtront ici.'));
  }, { roles: ['student'] });

  /* ---------- Un devoir ---------- */
  hub.page('assignment', async ctx => {
    const a = await api.get(`/assignments/${ctx.params.id}`);
    const subs = await api.get(`/assignments/${a.id}/my-submissions`).catch(() => []);
    const last = subs[subs.length - 1] || null, inProgress = subs.find(s => s.status === 'in_progress');
    const used = subs.length, max = a.settings.maxAttempts, left = max ? max - used : Infinity;
    const d = due(a.dueAt), canStart = a.status === 'published' && (inProgress || left > 0) && (!a.dueAt || new Date(a.dueAt) > Date.now() || a.settings.allowLate);
    ctx.head(esc(a.title), [{ label: tl('Mes classes'), page: 'classes' }, { label: a.classroomName || tl('Classe'), page: 'class', params: { id: a.classroomId } }]);
    ctx.el.innerHTML = `<div class="aPage"><div class="aDoc">
      <div class="aHero">${kindChip(a.kind)}<h2>${esc(a.title)}</h2><div class="aFacts">
        <span class="due ${d.cls}">${icon('clock')}${d.text}</span><span>${icon('star')}${tl('{0} points', num(a.totalPoints))}</span>
        <span>${icon('rotate')}${max ? tl('{0} tentative(s) sur {1}', used, max) : tl('Tentatives illimitées')}</span>
        ${a.settings.timeLimitMinutes ? `<span>${icon('clock')}${tl('{0} min une fois commencé', a.settings.timeLimitMinutes)}</span>` : ''}</div></div>
      ${a.instructions ? `<div class="richView card">${richHtml(a.instructions)}</div>` : ''}
      ${last && done(last) ? resultsHtml(a, last) : `<div class="card itemsPreview"><h3>${tl('Ce que contient ce devoir')}</h3><ul>${a.items.filter(i => i.type !== 'text').map((it, k) => `<li>${itemIcon(it.type)}<span>${tl('Question {0}', k + 1)} · ${itemTypeLabel(it.type)}</span><b>${tl('{0} pts', num(it.points))}</b></li>`).join('')}</ul></div>`}
    </div><aside class="aAside"><div class="card sticky">
      ${last ? `<div class="mine">${hasResults(last) ? ring(last.score, last.maxScore, 84) : chip(last.status)}<small>${last.submittedAt ? tl('Envoyé {0}', relTime(last.submittedAt)) : tl('Commencé {0}', relTime(last.startedAt))}</small></div>` : `<div class="mine">${chip('not_started')}</div>`}
      ${canStart ? `<button type="button" class="btn primary wide big" data-start>${icon('play')}<span>${inProgress ? tl('Continuer') : used ? tl('Nouvelle tentative') : tl('Commencer')}</span></button><p class="muted small">${a.starterProject || a.items.some(i => i.type === 'circuit') ? tl('Le montage du devoir s’ouvre dans le plan de travail ; votre projet est mis de côté et revient à la fin.') : ''}</p>` : `<p class="muted">${a.status === 'closed' ? tl('Ce devoir est clos.') : left <= 0 ? tl('Plus aucune tentative possible.') : tl('La date limite est passée.')}</p>`}
      ${last && last.project && done(last) ? `<button type="button" class="btn wide" data-view>${icon('eye')}<span>${tl('Revoir mon montage')}</span></button>` : ''}
      ${subs.length > 1 ? `<div class="attempts"><h4>${tl('Mes tentatives')}</h4>${subs.map(s => `<div><span>#${s.attempt}</span>${chip(s.status)}<b>${hasResults(s) ? score(s.score, s.maxScore) : ''}</b></div>`).join('')}</div>` : ''}
    </div></aside></div>`;
    bindLinks(ctx.el);
    const st = ctx.el.querySelector('[data-start]'); if (st) st.onclick = () => runAssignment(hub, sessions, a);
    const v = ctx.el.querySelector('[data-view]'); if (v) v.onclick = () => sessions.begin({ kind: 'view', data: last.project, name: a.title, panel: null, chip: () => ({ icon: 'eye', title: tl('Mon montage : {0}', a.title), meta: tl('lecture'), tone: 'view', actions: [{ id: 'end', label: tl('Fermer'), icon: 'x' }] }), action: () => sessions.end() });
  }, { roles: ['student'] });

  const classCard = c => `<button type="button" class="classCard" data-go="class" data-params='${esc(JSON.stringify({ id: c.id }))}' style="--c:${esc(c.color)}"><span class="ccBand">${icon('school')}</span><b>${esc(c.name)}</b><small>${esc([c.subject, c.level].filter(Boolean).join(' · ') || (c.teachers || []).map(t => t.displayName).join(', '))}</small><span class="ccFoot">${icon('users')}${tl('{0} élèves', c.studentCount)}</span></button>`;
  hub.classCard = classCard;
}

export const classBanner = c => `<div class="classBanner" style="--c:${esc(c.color)}"><div><b>${esc(c.name)}</b><small>${esc([c.subject, c.level].filter(Boolean).join(' · '))}</small></div><div class="cbTeachers">${icon('user')}${esc((c.teachers || []).map(t => t.displayName).join(', '))}</div><div class="cbCount">${icon('users')}${tl('{0} élèves', c.studentCount)}</div></div>`;
export const itemTypeLabel = t => ({ text: tl('Texte'), choice: tl('Choix multiple'), open: tl('Réponse rédigée'), circuit: tl('Montage') }[t]);
export const itemIcon = t => icon({ text: 'file', choice: 'checklist', open: 'edit', circuit: 'cable' }[t]);

export function peopleList(c, hub) {
  const me = api.user(), T = c.members.filter(m => m.role === 'teacher'), S = c.members.filter(m => m.role === 'student');
  const row = m => `<div class="person">${avatar(m, 36)}<span><b>${esc(m.displayName)}</b><small>${m.online ? tl('en ligne') : m.lastSeenAt ? tl('vu {0}', relTime(m.lastSeenAt)) : ''}</small></span>${m.userId !== me.id && (m.role === 'teacher' || me.role !== 'student' || c.settings.allowStudentDirectMessages) ? `<button type="button" class="btn small" data-dm="${m.userId}">${icon('message')}${tl('Message')}</button>` : ''}</div>`;
  setTimeout(() => document.querySelectorAll('[data-dm]').forEach(b => (b.onclick = () => hub.openDirect(b.dataset.dm))));
  return `<h3 class="subHead">${tl('Enseignants')}</h3><div class="people">${T.map(row).join('')}</div><h3 class="subHead">${tl('Élèves ({0})', S.length)}</h3><div class="people">${S.map(row).join('')}</div>`;
}
async function openClassChat(hub, classroomId) {
  try { const cs = await api.get('/conversations'); const c = cs.find(x => x.kind === 'class' && x.classroomId === classroomId); hub.go('messages', c ? { id: c.id } : {}); }
  catch (e) { toast(api.errorText(e), 'err'); }
}

/* ---------- Résultats d'une copie ---------- */
export function resultsHtml(a, s, { teacher = false } = {}) {
  const visible = teacher || hasResults(s);
  const items = a.items.filter(i => i.type !== 'text');
  return `<div class="card results">${visible ? `<div class="resHead">${ring(s.score, s.maxScore, 96)}<div><b>${s.score == null ? tl('En attente de correction') : score(s.score, s.maxScore)}</b><small>${s.status === 'returned' ? tl('Copie rendue {0}', relTime(s.returnedAt || s.gradedAt)) : s.status === 'graded' ? tl('Corrigée') : tl('Envoyée {0}', relTime(s.submittedAt))}${s.late ? ' · ' + tl('en retard') : ''}</small></div></div>` : `<div class="resHead pending">${icon('send')}<div><b>${tl('Copie envoyée')}</b><small>${tl('Les résultats seront visibles quand votre enseignant les publiera.')}</small></div></div>`}
    ${s.feedback && !isEmptyDoc(s.feedback) ? `<div class="feedback"><h4>${icon('message')}${tl('Commentaire de l’enseignant')}</h4><div class="richView">${richHtml(s.feedback)}</div></div>` : ''}
    ${visible ? `<ol class="resItems">${items.map(it => itemResult(it, s, a)).join('')}</ol>` : ''}</div>`;
}
function itemResult(it, s, a) {
  const sc = (s.itemScores || {})[it.id], ans = (s.answers || {})[it.id];
  const pts = sc && sc.points != null ? `<b class="pts ${sc.points >= sc.max ? 'ok' : sc.points > 0 ? 'part' : 'ko'}">${score(sc.points, sc.max)}</b>` : `<b class="pts wait">${tl('à corriger')}</b>`;
  let body = '';
  if (it.type === 'choice') {
    const sel = new Set((ans && ans.selected) || []), cor = it.correct ? new Set(it.correct) : null;
    body = `<ul class="choiceRes">${it.options.map(o => `<li class="${sel.has(o.id) ? 'sel' : ''} ${cor ? (cor.has(o.id) ? 'right' : sel.has(o.id) ? 'wrong' : '') : ''}">${icon(sel.has(o.id) ? 'check' : 'minus')}${esc(o.text)}</li>`).join('')}</ul>`;
  }
  if (it.type === 'open') body = ans && ans.doc ? `<div class="richView answer">${richHtml(ans.doc)}</div>` : `<p class="muted">${tl('Pas de réponse.')}</p>`;
  if (it.type === 'circuit') {
    const dt = sc && sc.detail;
    body = dt ? `<p class="circRes">${icon('cable')}${tl('{0} liaison(s) juste(s) sur {1}', dt.ok, dt.total)}${s.circuit && s.circuit.faults ? ` · ${tl('{0} erreur(s) de câblage', s.circuit.faults)}` : ''}</p>${dt.missing && dt.missing.length ? `<ul class="netList">${dt.missing.map(n => `<li>${icon('x')}${esc(n.join(' ↔ '))}</li>`).join('')}</ul>` : ''}` : `<p class="circRes">${icon('cable')}${tl('{0} liaison(s) dans le montage', s.circuit ? s.circuit.nets.length : 0)}</p>`;
  }
  return `<li class="resItem"><header><span>${itemIcon(it.type)}${esc(plainText(it.prompt).slice(0, 140) || itemTypeLabel(it.type))}</span>${pts}</header>${body}${sc && sc.comment ? `<p class="comment">${icon('message')}${esc(sc.comment)}</p>` : ''}</li>`;
}

/* ---------- Séance « devoir » ---------- */
export async function runAssignment(hub, sessions, a) {
  const { app } = hub;
  let s;
  try { s = await api.post(`/assignments/${a.id}/start`); } catch (e) { toast(api.errorText(e), 'err'); return; }
  const needsCircuit = !!(a.starterProject || a.items.some(i => i.type === 'circuit'));
  const answers = JSON.parse(JSON.stringify(s.answers || {}));
  const editors = new Map();
  let state = 'idle', timer = null, offChange = null, finished = false, lastCirc = null;

  const panel = document.createElement('div'); panel.className = 'sessPanel';
  const deadline = s.deadlineAt ? new Date(s.deadlineAt) : null;
  const chipFn = () => {
    if (finished) return { icon: 'check', title: a.title, meta: tl('copie envoyée'), tone: 'done', actions: [{ id: 'end', label: tl('Terminer'), icon: 'x' }] };
    const left = deadline ? deadline - Date.now() : null;
    return { icon: a.kind === 'evaluation' ? 'award' : 'edit', title: a.title, meta: left != null ? `${icon('clock')}${clock(left)}` : saveText(), tone: left != null && left < 120000 ? 'hurry' : 'work', actions: [{ id: 'submit', label: tl('Envoyer'), icon: 'send', kind: 'primary' }, { id: 'end', icon: 'x', tip: tl('Quitter (la copie reste enregistrée)') }] };
  };
  const saveText = () => ({ idle: '', saving: tl('enregistrement…'), saved: tl('enregistré'), error: tl('hors ligne') }[state]);
  function setState(v) { state = v; const el = panel.querySelector('.saveState'); if (el) { el.textContent = saveText(); el.className = 'saveState ' + v; } sessions.paintChip(); }

  async function save(extra = {}) {
    if (finished) return;
    setState('saving');
    try { await api.put(`/submissions/${s.id}`, { answers, ...extra }); setState('saved'); }
    catch (e) {
      if (e.code === 'TIME_UP' || e.code === 'SUBMISSION_LOCKED') { await showResult(); toast(api.errorText(e), 'warn'); return; }
      setState('error');
    }
  }
  const saveAnswers = debounce(() => save(), 1500);
  const saveCircuit = debounce(() => { lastCirc = circuitOf(app); save({ project: app.projectData(), circuit: lastCirc }); renderCircuitStatus(); }, 4000);

  function render() {
    const items = a.items;
    let q = 0;
    panel.innerHTML = `<header class="spHead">${kindChip(a.kind)}<h2>${esc(a.title)}</h2><div class="spFacts"><span>${esc(a.classroomName || '')}</span>${a.dueAt ? `<span class="due ${due(a.dueAt).cls}">${icon('clock')}${due(a.dueAt).text}</span>` : ''}<span class="saveState"></span></div></header>
      <div class="spBody">${a.instructions ? `<details class="spInstr" open><summary>${icon('book')}${tl('Consignes')}</summary><div class="richView">${richHtml(a.instructions)}</div></details>` : ''}
      ${items.map(it => {
        if (it.type === 'text') return `<div class="qCard text"><div class="richView">${richHtml(it.content)}</div></div>`;
        q++;
        const head = `<header><span class="qNum">${q}</span><span class="qType">${itemIcon(it.type)}${itemTypeLabel(it.type)}</span><span class="qPts">${tl('{0} pts', num(it.points))}</span></header><div class="richView qPrompt">${richHtml(it.prompt)}</div>`;
        if (it.type === 'choice') { const sel = new Set((answers[it.id] || {}).selected || []); return `<div class="qCard" data-q="${it.id}">${head}<div class="choices ${it.multiple ? 'multi' : ''}">${it.options.map(o => `<label class="choice${sel.has(o.id) ? ' on' : ''}"><input type="${it.multiple ? 'checkbox' : 'radio'}" name="q_${it.id}" value="${o.id}"${sel.has(o.id) ? ' checked' : ''}><span class="cBox"></span><span>${esc(o.text)}</span></label>`).join('')}</div>${it.multiple ? `<small class="muted">${tl('Plusieurs réponses possibles.')}</small>` : ''}</div>`; }
        if (it.type === 'open') return `<div class="qCard" data-q="${it.id}">${head}<div class="openEd"></div></div>`;
        return `<div class="qCard circ" data-q="${it.id}">${head}<div class="circStatus"></div><p class="muted small">${tl('Réalisez le montage dans le plan de travail : il est enregistré avec votre copie.')}</p></div>`;
      }).join('')}</div>
      <footer class="spFoot"><button type="button" class="btn primary wide big" data-submit>${icon('send')}<span>${tl('Envoyer ma copie')}</span></button></footer>`;
    bindLinks(panel);
    panel.querySelectorAll('.qCard[data-q]').forEach(card => {
      const it = items.find(i => i.id === card.dataset.q);
      if (it.type === 'choice') card.addEventListener('change', () => {
        answers[it.id] = { selected: [...card.querySelectorAll('input:checked')].map(i => i.value) };
        card.querySelectorAll('.choice').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
        saveAnswers();
      });
      if (it.type === 'open') richEditor(card.querySelector('.openEd'), { content: (answers[it.id] || {}).doc || null, placeholder: tl('Votre réponse…'), compact: true, minHeight: 110, onChange: doc => { answers[it.id] = { doc }; saveAnswers(); } }).then(ed => editors.set(it.id, ed));
    });
    panel.querySelector('[data-submit]').onclick = submit;
    renderCircuitStatus(); setState(state);
  }
  function renderCircuitStatus() {
    const c = lastCirc || circuitOf(app);
    panel.querySelectorAll('.circStatus').forEach(el => (el.innerHTML = `<span class="cs">${icon('cable')}<b>${c.nets.length}</b>${tl('liaison(s)')}</span><span class="cs ${c.faults ? 'bad' : 'good'}">${icon(c.faults ? 'alert' : 'check')}<b>${c.faults}</b>${tl('erreur(s) de câblage')}</span>`));
  }
  async function submit() {
    // Comme un programme qui ne compile pas : une copie dont le montage a des erreurs ne part pas (sauf à l'échéance, envoi automatique).
    if (needsCircuit && app.verify) {
      const r = await app.verify(false);
      if (r && r.errors) { toast(tl('Envoi refusé : votre montage a {0} erreur(s). Le rapport de vérification s’ouvre (F7) : corrigez-les puis renvoyez.', r.errors), 'err'); app.openCheck(); return; }
    }
    const missing = a.items.filter(it => (it.type === 'choice' && !((answers[it.id] || {}).selected || []).length) || (it.type === 'open' && isEmptyDoc((answers[it.id] || {}).doc)));
    if (!(await confirm(tl('Envoyer ma copie'), missing.length ? tl('{0} question(s) sans réponse. Envoyer quand même ? Vous ne pourrez plus modifier cette copie.', missing.length) : tl('Vous ne pourrez plus modifier cette copie.'), tl('Envoyer')))) return;
    saveAnswers.cancel(); saveCircuit.cancel();
    const body = { answers };
    if (needsCircuit) { body.project = app.projectData(); body.circuit = circuitOf(app); }
    try { s = await api.post(`/submissions/${s.id}/submit`, body); }
    catch (e) { if (e.code !== 'TIME_UP' && e.code !== 'SUBMISSION_LOCKED') { toast(api.errorText(e), 'err'); return; } }
    await showResult();
    toast(tl('Copie envoyée.'));
  }
  async function showResult() {
    finished = true; clearInterval(timer); if (offChange) offChange();
    try { s = await api.get(`/submissions/${s.id}`); a = await api.get(`/assignments/${a.id}`); } catch (e) { /* on montre ce qu'on a */ }
    panel.innerHTML = `<header class="spHead">${kindChip(a.kind)}<h2>${esc(a.title)}</h2></header><div class="spBody">${resultsHtml(a, s)}</div><footer class="spFoot"><button type="button" class="btn wide" data-end>${icon('x')}<span>${needsCircuit ? tl('Terminer et revenir à mon projet') : tl('Terminer')}</span></button></footer>`;
    panel.querySelector('[data-end]').onclick = () => sessions.end();
    sessions.paintChip(); sessions.openPanel();
  }

  const ok = await sessions.begin({
    kind: 'assignment', panel, chip: chipFn,
    data: needsCircuit ? (s.project || a.starterProject || { app: 'jollof-studio', version: 1, comps: [], wires: [] }) : null,
    name: a.title,
    action: id => { if (id === 'submit') submit(); if (id === 'end') sessions.end(); },
    beforeEnd: async () => {
      if (finished) return true;
      saveAnswers.cancel(); saveCircuit.cancel();
      await save(needsCircuit ? { project: app.projectData(), circuit: circuitOf(app) } : {});
      return true;
    },
    onEnd: () => { clearInterval(timer); if (offChange) offChange(); editors.forEach(e => e.destroy()); hub.refreshBadges(); }
  });
  if (!ok) return;
  render();
  if (needsCircuit) offChange = app.onChange(() => { state = 'idle'; saveCircuit(); });
  if (deadline) timer = setInterval(() => { sessions.paintChip(); if (deadline - Date.now() <= 0 && !finished) { clearInterval(timer); save(needsCircuit ? { project: app.projectData(), circuit: circuitOf(app) } : {}).then(showResult); } }, 1000);
}
