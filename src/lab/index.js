// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Travaux pratiques guidés : le « laboratoire sans laboratoire ». Une bibliothèque de TP
// (montage de départ, étapes, contrôles automatiques), utilisable hors ligne et sans compte.
// Un TP s'ouvre dans le plan de travail (le projet personnel est mis de côté) ; chaque étape se
// vérifie : câblage, programme, comportement observé en simulation, mesures, questions.
// À la fin : compte-rendu en PDF. Édition Pro : un TP s'envoie à une classe comme devoir.
import { tl, LANG, DEC } from '../i18n/index.js';
import { icon, esc, toast, dialog, ask } from '../school/ui.js';
import { hydrateIcons } from '../ui/icons.js';
import { compile } from '../prog/lang.js';
import { checkWire, checkCode, checkWatch, checkMeasure, checkQuiz, allNets } from './engine.js';

const TPS = Object.values(import.meta.glob('./tp/*.json', { eager: true, import: 'default' })).sort((a, b) => a.id.localeCompare(b.id));
const L = o => (o == null ? '' : typeof o === 'string' ? o : o[LANG] || o.fr || '');
const LEVELS = { college: () => tl('Collège'), lycee: () => tl('Lycée'), pro: () => tl('Formation professionnelle') };
const KEY = id => 'jollof-lab-' + id;
const load = id => { try { return JSON.parse(localStorage.getItem(KEY(id)) || 'null'); } catch (e) { return null; } };
const store = (id, st) => { try { localStorage.setItem(KEY(id), JSON.stringify(st)); } catch (e) { /* stockage plein */ } };
/** Texte d'étape : **gras**, `code`, listes « - », retours à la ligne. */
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>').split('\n').map(l => (/^- /.test(l) ? `<li>${l.slice(2)}</li>` : l ? `<p>${l}</p>` : '')).join('').replace(/(<li>.*?<\/li>)+/g, m => `<ul>${m}</ul>`);
const num = v => (Math.round(v * 100) / 100).toString().replace('.', DEC);
const unitOf = c => (c.unit === 'mA' ? 'mA' : c.unit === 's' ? 's' : 'V');

export function installLab(app) {
  const sessions = app.school && app.school.sessions;
  const env = {
    comps: () => app.comps(), analyze: () => app.analyze(),
    program: () => { const p = app.program(); return p ? { code: p.code, kind: p.kind } : null; },
    compile: (code, kind) => compile(code, { board: kind }),
    dc: state => (app.dc ? app.dc(state) : null)
  };
  const btn = app.toolbar(`<button type="button" class="tb label" id="labBtn" data-tip="${tl('Travaux pratiques guidés, vérifiés pas à pas')}">${icon('checklist')}<span>${tl('TP')}</span></button>`);
  btn.onclick = openLibrary;

  /* ---------- Bibliothèque ---------- */
  async function openLibrary() {
    const by = new Map();
    TPS.forEach(tp => { if (!by.has(tp.level)) by.set(tp.level, []); by.get(tp.level).push(tp); });
    const card = tp => {
      const st = load(tp.id), done = st ? st.done.filter(Boolean).length : 0, n = tp.steps.length;
      return `<button type="button" class="tpCard" data-tp="${esc(tp.id)}"><span class="tpTop"><span class="tpLevel">${LEVELS[tp.level] ? LEVELS[tp.level]() : ''}</span><span class="muted">${icon('clock')}${tl('{0} min', tp.minutes)}</span></span>
        <b>${esc(L(tp.title))}</b><small>${esc(L(tp.summary))}</small>
        <span class="tpObj">${(tp.objectives || []).slice(0, 3).map(o => `<span>${icon('check')}${esc(L(o))}</span>`).join('')}</span>
        <span class="tpFoot">${st && st.finishedAt ? `<span class="pill graded">${icon('award')}${tl('Terminé')}</span>` : st ? `<span class="pill doing">${tl('Étape {0}/{1}', Math.min(n, (st.step || 0) + 1), n)}</span>` : `<span class="pill todo">${tl('Nouveau')}</span>`}<span class="tpBar"><i style="width:${Math.round(100 * done / n)}%"></i></span></span></button>`;
    };
    const id = await dialog({
      title: tl('{0}Travaux pratiques', icon('checklist')), width: 980, cls: 'tpLib',
      body: `<p class="dlgText">${tl('Un laboratoire d’électronique sans matériel : chaque TP part d’un montage, guide pas à pas et vérifie votre travail (câblage, programme, comportement, mesures au multimètre). Votre projet est mis de côté pendant le TP.')}</p>
        ${[...by].map(([lv, list]) => `<h3 class="subHead">${LEVELS[lv] ? LEVELS[lv]() : esc(lv)}</h3><div class="tpGrid">${list.map(card).join('')}</div>`).join('') || `<p class="muted">${tl('Aucun TP.')}</p>`}`,
      actions: [{ label: tl('Fermer'), value: null }],
      onOpen: (el, close) => (el.onclick = e => { const b = e.target.closest('[data-tp]'); if (b) close(b.dataset.tp); })
    });
    if (id) run(TPS.find(t => t.id === id));
  }

  /* ---------- Séance de TP ---------- */
  async function run(tp) {
    if (!sessions) return;
    let st = load(tp.id) || { step: 0, done: tp.steps.map(() => false), answers: {}, results: {}, startedAt: Date.now(), finishedAt: null };
    if (st.done.length !== tp.steps.length) st = { step: 0, done: tp.steps.map(() => false), answers: {}, results: {}, startedAt: Date.now(), finishedAt: null };
    const resume = st.done.some(Boolean) && !st.finishedAt;
    let watcher = null, project = st.project || tp.start;
    const panel = document.createElement('div'); panel.className = 'sessPanel labPanel';
    const save = () => { st.project = app.projectData(); store(tp.id, st); };
    const total = tp.steps.length, doneN = () => st.done.filter(Boolean).length;

    function render() {
      stopWatch();
      const i = st.step, s = tp.steps[i], c = s.check, r = st.results[i];
      panel.innerHTML = `<header class="spHead"><span class="kind lab">${icon('checklist')}${tl('Travaux pratiques')} · ${LEVELS[tp.level] ? LEVELS[tp.level]() : ''}</span><h2>${esc(L(tp.title))}</h2>
        <div class="labProg"><span class="tpBar"><i style="width:${Math.round(100 * doneN() / total)}%"></i></span><b>${doneN()}/${total}</b></div>
        <div class="labSteps">${tp.steps.map((x, k) => `<button type="button" class="ls${k === i ? ' on' : ''}${st.done[k] ? ' ok' : ''}" data-go="${k}" title="${esc(L(x.title))}">${st.done[k] ? icon('check') : k + 1}</button>`).join('')}</div></header>
        <div class="spBody"><div class="labStep"><span class="lsNum">${tl('Étape {0}', i + 1)}</span><h3>${esc(L(s.title))}</h3><div class="labText">${md(L(s.text))}</div>
          ${checkUi(s, c, i)}
          ${r ? `<div class="labRes ${r.ok ? 'ok' : 'ko'}">${icon(r.ok ? 'check' : 'alert')}<span>${r.msg}</span></div>` : ''}
          ${s.hint && (r && !r.ok) ? `<details class="labHint" open><summary>${icon('info')}${tl('Indice')}</summary><p>${esc(L(s.hint))}</p></details>` : s.hint ? `<details class="labHint"><summary>${icon('info')}${tl('Indice')}</summary><p>${esc(L(s.hint))}</p></details>` : ''}
        </div>${st.finishedAt ? `<div class="labDone">${icon('award')}<div><b>${tl('TP terminé !')}</b><small>${tl('Toutes les étapes sont validées. Exportez votre compte-rendu.')}</small></div></div>` : ''}</div>
        <footer class="spFoot labFoot"><button type="button" class="btn" data-prev ${i ? '' : 'disabled'}>${icon('chevLeft')}</button>
          ${c && c.type !== 'info' && !st.done[i] ? `<button type="button" class="btn primary grow" data-check>${icon('check')}<span>${c.type === 'watch' ? tl('Observer') : tl('Vérifier')}</span></button>` : `<button type="button" class="btn primary grow" data-next ${i < total - 1 ? '' : 'disabled'}>${i < total - 1 ? tl('Étape suivante') : tl('Dernière étape')}${icon('chevRight')}</button>`}
          <button type="button" class="btn" data-report title="${tl('Compte-rendu en PDF')}">${icon('pdf')}</button>
          ${app.labPublish ? `<button type="button" class="btn" data-publish title="${tl('Envoyer ce TP à une classe')}">${icon('send')}</button>` : ''}</footer>`;
      hydrateIcons(panel);
      const q = x => panel.querySelector(x);
      if (q('[data-check]')) q('[data-check]').onclick = () => verify(i);
      if (q('[data-next]')) q('[data-next]').onclick = () => { if (!s.check || s.check.type === 'info') pass(i, ''); go(i + 1); };
      q('[data-prev]').onclick = () => go(i - 1);
      q('[data-report]').onclick = report;
      if (q('[data-publish]')) q('[data-publish]').onclick = () => app.labPublish(tp, { nets: allNets(tp), text: tp.steps.map((x, k) => `${k + 1}. ${L(x.title)}\n${L(x.text)}`).join('\n\n') });
      panel.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => go(+b.dataset.go)));
    }
    function checkUi(s, c, i) {
      if (!c) return '';
      const a = st.answers[i];
      if (c.type === 'measure') return `<div class="labMeasure"><label>${tl('Valeur mesurée')}<span class="mIn"><input class="sInput" data-ans inputmode="decimal" value="${esc(a ?? '')}" placeholder="0${DEC}00"><b>${unitOf(c)}</b></span></label><small class="muted">${c.unit === 's' ? tl('Lisez-la sur le traceur série (onglet Code, « Traceur »), simulation lancée.') : tl('Mesurez avec le multimètre (bouton « Instruments »), simulation lancée.')}</small></div>`;
      if (c.type === 'quiz') return `<div class="choices${Array.isArray(c.answer) ? ' multi' : ''}">${c.options.map((o, k) => `<label class="choice${[].concat(a ?? []).includes(k) ? ' on' : ''}"><input type="${Array.isArray(c.answer) ? 'checkbox' : 'radio'}" name="q${i}" value="${k}"${[].concat(a ?? []).includes(k) ? ' checked' : ''}><span class="cBox"></span><span>${esc(L(o))}</span></label>`).join('')}</div>`;
      if (c.type === 'watch') return `<p class="muted small">${icon('zap')} ${tl('Cliquez sur « Observer », lancez la simulation et faites l’action demandée : la vérification se fait en direct.')}</p><div class="watchState" hidden></div>`;
      return '';
    }
    panel.addEventListener('change', e => {
      const i = st.step;
      if (e.target.name === 'q' + i) { const v = [...panel.querySelectorAll(`[name="q${i}"]:checked`)].map(x => +x.value); st.answers[i] = Array.isArray(tp.steps[i].check.answer) ? v : v[0]; panel.querySelectorAll('.choice').forEach(l => l.classList.toggle('on', l.querySelector('input').checked)); save(); }
      if (e.target.matches('[data-ans]')) { st.answers[i] = e.target.value; save(); }
    });
    function go(i) { if (i < 0 || i >= total) return; st.step = i; save(); render(); }
    function pass(i, msg) {
      st.done[i] = true; st.results[i] = { ok: true, msg };
      if (st.done.every(Boolean) && !st.finishedAt) { st.finishedAt = Date.now(); toast(tl('TP terminé : bravo !')); }
      save(); sessions.paintChip(); render();
    }
    function fail(i, msg) { st.results[i] = { ok: false, msg }; save(); render(); }
    function verify(i) {
      const c = tp.steps[i].check;
      if (c.type === 'wire') {
        const r = checkWire(c, env);
        const short = r.missing.find(m => m.why === 'short');
        if (short) return fail(i, tl('{0} est court-circuité : ses deux pattes arrivent au même point. Chaque patte doit aller d’un côté différent.', short.comp));
        const pin = p => p.split('|').map(x => x.replace(/\*$/, '…')).join(tl(' ou '));
        return r.ok ? pass(i, tl('Câblage correct.')) : fail(i, tl('Pas encore : {0}', r.missing.map(m => m.group.map(pin).join(' ↔ ')).join(' ; ')));
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
      if (c.type === 'watch') {
        if (!app.simOn()) { app.setSim(true); setTimeout(() => app.sessionTab.show(), 30); } // le TP reste au premier plan pendant l'observation
        const box = panel.querySelector('.watchState'); box.hidden = false;
        const expectTxt = Object.entries(c.when || {}).map(([n, v]) => `${n} ${v === 'pressed' ? tl('appuyé') : v === 'on' ? tl('allumé') : v}`).join(', ');
        box.innerHTML = `<span class="dotsAnim"><i></i><i></i><i></i></span>${expectTxt ? tl('En observation : faites en sorte que {0}…', esc(expectTxt)) : tl('En observation…')}`;
        let since = 0; const t0 = performance.now();
        watcher = setInterval(() => {
          const r = checkWatch(c, env), now = performance.now();
          if (r.ok) { if (!since) since = now; if (now - since >= (c.hold || 400)) { stopWatch(); pass(i, tl('Comportement observé : c’est bien ça !')); } return; }
          since = 0;
          if (!r.waiting && r.bad && r.bad.length) box.innerHTML = `${icon('alert')}${tl('{0} ne réagit pas comme prévu : vérifiez le câblage et le programme.', esc(r.bad.join(', ')))}`;
          if (now - t0 > 45000) { stopWatch(); fail(i, tl('Rien observé en 45 s : relancez l’observation et faites l’action demandée.')); }
        }, 100);
      }
    }
    function stopWatch() { if (watcher) { clearInterval(watcher); watcher = null; } }

    /* ---------- Compte-rendu ---------- */
    async function report() {
      let name = ''; try { name = localStorage.getItem('jollof-student-name') || ''; } catch (e) { /* rien */ }
      const u = app.school && app.school.user && app.school.user();
      name = await ask(tl('Compte-rendu de TP'), tl('Votre nom (il figure sur le compte-rendu)'), name || (u ? u.displayName : ''), { ok: tl('Créer le PDF') });
      if (name === null) return;
      try { localStorage.setItem('jollof-student-name', name); } catch (e) { /* rien */ }
      const { Draw, toPdf, textWidth, frame } = app.pdf, W = 297, H = 210, pages = [];
      const fit = (t, w, sz) => { t = String(t ?? ''); while (t.length > 2 && textWidth(t, sz) > w) t = t.slice(0, -2) + '…'; return t; };
      const wrap = (t, w, sz) => { const out = []; let line = ''; for (const wd of String(t).replace(/\*\*|`/g, '').split(/\s+/)) { if (line && textWidth(line + ' ' + wd, sz) > w) { out.push(line); line = wd; } else line = line ? line + ' ' + wd : wd; } if (line) out.push(line); return out; };
      const page = no => { const d = new Draw(); const ar = frame(d, W, H, { title: L(tp.title), doc: tl('Compte-rendu de TP'), date: new Date().toLocaleDateString(LANG === 'en' ? 'en-GB' : 'fr-FR'), scale: name || '—', boards: LEVELS[tp.level] ? LEVELS[tp.level]() : '' }, no, 0); pages.push({ w: W, h: H, ops: d.ops }); return { d, ar }; };
      let { d, ar } = page(1), y = ar.y0 + 7, no = 1;
      d.text(ar.x0, y, fit(L(tp.title), 200, 4.2), { s: 4.2, b: true }); y += 6;
      d.text(ar.x0, y, fit(`${tl('Élève')} : ${name}   ·   ${tl('Étapes validées : {0}/{1}', doneN(), total)}   ·   ${tl('Durée : {0} min', Math.max(1, Math.round(((st.finishedAt || Date.now()) - st.startedAt) / 60000)))}`, 260, 2.4), { s: 2.4, color: '#444444' }); y += 7;
      d.text(ar.x0, y, tl('Objectifs'), { s: 3, b: true }); y += 4.5;
      for (const o of tp.objectives || []) { d.text(ar.x0 + 3, y, '• ' + fit(L(o), 250, 2.3), { s: 2.3 }); y += 3.8; }
      y += 3;
      tp.steps.forEach((s, k) => {
        const res = st.results[k], lines = wrap(L(s.text), 200, 2.1).slice(0, 4), need = 7 + lines.length * 3.2 + (st.answers[k] != null ? 3.4 : 0);
        if (y + need > ar.y1 - 30) { ({ d, ar } = page(++no)); y = ar.y0 + 7; }
        d.rect(ar.x0, y - 3.6, 4.2, 4.2, { w: 0.2, fill: st.done[k] ? '#3fb27f' : null });
        d.text(ar.x0 + 6, y, fit(`${k + 1}. ${L(s.title)}`, 190, 2.7), { s: 2.7, b: true });
        d.text(ar.x0 + 210, y, st.done[k] ? tl('validée') : tl('non validée'), { s: 2.3, color: st.done[k] ? '#1f7a4f' : '#a33' }); y += 4;
        lines.forEach(l => { d.text(ar.x0 + 6, y, l, { s: 2.1, color: '#444444' }); y += 3.2; });
        const c = s.check;
        if (c && st.answers[k] != null) {
          const ans = c.type === 'quiz' ? [].concat(st.answers[k]).map(x => L(c.options[x])).join(', ') : `${st.answers[k]} ${unitOf(c)}`;
          d.text(ar.x0 + 6, y, fit(`${tl('Réponse')} : ${ans}${res && res.msg ? ' — ' + res.msg : ''}`, 250, 2.2), { s: 2.2, color: '#1b4f8c' }); y += 3.4;
        }
        y += 2.5;
      });
      const sch = app.schematic({ format: 'A4', lists: false });
      sch.pages.forEach(p => pages.push({ w: p.w, h: p.h, ops: p.ops }));
      const totalP = pages.length;
      pages.forEach((p, k) => p.ops.forEach(op => { if (op.t === 'text' && /^\d+ \/ \d+$/.test(op.str)) op.str = `${k + 1} / ${totalP}`; }));
      const bytes = toPdf(pages, { title: `${L(tp.title)} — ${tl('compte-rendu')}` });
      const file = `${tp.id}-${name.replace(/[\\/:*?"<>|]+/g, '-') || 'eleve'}.pdf`;
      const path = await app.saveFile(new Blob([bytes], { type: 'application/pdf' }), file, tl('Document PDF'), 'pdf');
      if (path) toast(app.isDesktop() ? tl('Compte-rendu enregistré : {0}', path) : tl('Compte-rendu téléchargé.'));
    }

    const ok = await sessions.begin({
      kind: 'lab', panel, name: L(tp.title), data: project,
      chip: () => ({ icon: 'checklist', title: L(tp.title), meta: tl('étape {0}/{1}', st.step + 1, total), tone: st.finishedAt ? 'done' : 'work', actions: [{ id: 'end', icon: 'x', tip: tl('Quitter le TP (votre progression est gardée)') }] }),
      action: id => { if (id === 'end') sessions.end(); },
      beforeEnd: async () => { stopWatch(); save(); return true; },
      onEnd: () => stopWatch()
    });
    if (!ok) return;
    render();
    if (resume) toast(tl('Reprise du TP à l’étape {0}.', st.step + 1));
  }
  return { list: TPS, run };
}
