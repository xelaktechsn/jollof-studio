// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Groupes de travail (créés par les élèves d'une même classe, ou par l'enseignant) et leurs
// projets partagés : chaque enregistrement est une version ; une seule personne a la main à la
// fois (verrou de 2 minutes, renouvelé tant qu'elle travaille), les autres ouvrent en lecture.
import { tl, CANCEL } from '../i18n/index.js';
import * as api from './api.js';
import * as rt from './rt.js';
import { icon, esc, avatar, avatars, relTime, dateTime, empty, toast, confirm, dialog, ask, COLORS } from './ui.js';

export function installGroups(hub, sessions) {
  const { app } = hub;
  hub.nav('groups', tl('Groupes'), 'users', ['student', 'teacher'], 35);

  const groupCard = g => `<button type="button" class="groupCard" data-go="group" data-params='${esc(JSON.stringify({ id: g.id }))}' style="--c:${esc(g.color)}"><span class="gcTop"><span class="gcIc">${icon('users')}</span><b>${esc(g.name)}</b></span><small>${esc(g.classroomName || '')}</small><span class="gcFoot">${avatars(g.members)}<span>${icon('cube')}${g.projectCount}</span></span></button>`;

  hub.page('groups', async ctx => {
    const me = api.user();
    ctx.head(tl('Groupes'), [], me.role === 'student' ? `<button type="button" class="btn primary" data-newg>${icon('plus')}<span>${tl('Nouveau groupe')}</span></button>` : '');
    const classes = await api.get('/classrooms');
    const all = (await Promise.all(classes.map(c => api.get(`/classrooms/${c.id}/groups`).then(gs => gs.map(g => ({ ...g, classroomName: c.name })))))).flat();
    ctx.el.innerHTML = all.length ? `<div class="groupGrid">${all.map(groupCard).join('')}</div>` : empty('users', tl('Aucun groupe'), me.role === 'student' ? tl('Créez un groupe avec des camarades de classe pour travailler ensemble sur un projet.') : tl('Les groupes créés par vos élèves apparaîtront ici.'), me.role === 'student' ? `<button type="button" class="btn primary" data-newg2>${icon('plus')}<span>${tl('Nouveau groupe')}</span></button>` : '');
    const nb = ctx.el.closest('.hub').querySelectorAll('[data-newg], [data-newg2]');
    nb.forEach(b => (b.onclick = () => createGroup(classes)));
  });

  /** Onglet « Groupes » d'une classe. */
  hub.renderClassGroups = async (el, c) => {
    const me = api.user(), gs = await api.get(`/classrooms/${c.id}/groups`);
    const canCreate = me.role !== 'student' || c.settings.allowStudentGroups;
    el.innerHTML = `${canCreate ? `<div class="rowEnd"><button type="button" class="btn primary" data-newg>${icon('plus')}<span>${tl('Nouveau groupe')}</span></button></div>` : `<p class="muted">${tl('Les groupes sont désactivés dans cette classe.')}</p>`}${gs.length ? `<div class="groupGrid">${gs.map(g => groupCard({ ...g, classroomName: c.name })).join('')}</div>` : empty('users', tl('Aucun groupe dans cette classe'), '')}`;
    const b = el.querySelector('[data-newg]'); if (b) b.onclick = () => createGroup([c]);
  };

  async function createGroup(classes) {
    const me = api.user();
    if (!classes.length) { toast(tl('Vous n’êtes inscrit dans aucune classe.'), 'warn'); return; }
    let cls = classes[0], detail = await api.get(`/classrooms/${cls.id}`), color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const others = () => detail.members.filter(m => m.role === 'student' && m.userId !== me.id);
    const body = () => `${classes.length > 1 ? `<label class="sField"><span>${tl('Classe concernée')}</span><select class="sInput" data-f="cls">${classes.map(c => `<option value="${c.id}"${c.id === cls.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
      <label class="sField"><span>${tl('Nom du groupe')}</span><input class="sInput" data-f="name" maxlength="60" placeholder="${tl('ex. Les Ingénieurs')}"></label>
      <div class="sField"><span>${tl('Couleur')}</span><div class="swatchRow">${COLORS.map(c => `<button type="button" class="swatch${c === color ? ' on' : ''}" data-c="${c}" style="--c:${c}"></button>`).join('')}</div></div>
      <div class="sField"><span>${tl('Membres ({0} au plus, vous compris)', detail.settings.maxGroupSize)}</span><div class="pickList checks">${others().map(m => `<label class="pick">${me.role === 'student' || true ? `<input type="checkbox" value="${m.userId}">` : ''}${avatar(m, 28)}<span><b>${esc(m.displayName)}</b></span></label>`).join('') || `<p class="muted">${tl('Aucun autre élève dans cette classe.')}</p>`}</div></div><p class="formErr" hidden></p>`;
    const g = await dialog({
      title: tl('Nouveau groupe'), width: 460, body: body(),
      actions: [{ label: CANCEL, value: null }, { label: tl('Créer le groupe'), value: 'ok', kind: 'primary' }],
      onOpen: el => {
        el.addEventListener('click', e => { const s = e.target.closest('[data-c]'); if (s) { color = s.dataset.c; el.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === s)); } });
        el.addEventListener('change', async e => { if (e.target.dataset.f === 'cls') { cls = classes.find(c => c.id === e.target.value); detail = await api.get(`/classrooms/${cls.id}`); el.innerHTML = body(); } });
      },
      onAction: async (v, el) => {
        if (v !== 'ok') return;
        const name = el.querySelector('[data-f="name"]').value.trim(), ids = [...el.querySelectorAll('.checks input:checked')].map(i => i.value), err = el.querySelector('.formErr');
        if (!name) { err.textContent = tl('Donnez un nom au groupe.'); err.hidden = false; return false; }
        try { return await api.post(`/classrooms/${cls.id}/groups`, { name, color, memberIds: ids }); }
        catch (e) { err.textContent = api.errorText(e); err.hidden = false; return false; }
      }
    });
    if (g && g.id) { toast(tl('Groupe « {0} » créé.', g.name)); hub.go('group', { id: g.id }); }
  }

  /* ---------- Un groupe ---------- */
  hub.page('group', async ctx => {
    const me = api.user();
    const [g, projects] = await Promise.all([api.get(`/groups/${ctx.params.id}`).catch(() => null), api.get(`/groups/${ctx.params.id}/projects`)]);
    const group = g || (await findGroup(ctx.params.id));
    const c = await api.get(`/classrooms/${group.classroomId}`);
    const mine = group.members.find(m => m.userId === me.id), isOwner = mine && mine.role === 'owner', teacher = me.role !== 'student';
    ctx.head(esc(group.name), [{ label: tl('Groupes'), page: 'groups' }], `<button type="button" class="btn" data-chat>${icon('message')}<span>${tl('Discussion du groupe')}</span></button>`);
    ctx.el.innerHTML = `<div class="groupBanner" style="--c:${esc(group.color)}"><span class="gcIc big">${icon('users')}</span><div><b>${esc(group.name)}</b><small>${esc(c.name)} · ${tl('{0} membre(s)', group.members.length)}</small></div>${isOwner || teacher ? `<button type="button" class="iconBtn" data-rename title="${tl('Renommer')}">${icon('edit')}</button>` : ''}</div>
      <div class="cols2 wideLeft"><section class="block"><header><h2>${icon('cube')}${tl('Projets du groupe')}</h2>${mine ? `<button type="button" class="btn primary small" data-newp>${icon('plus')}<span>${tl('Nouveau projet')}</span></button>` : ''}</header>
        ${projects.length ? `<div class="projList">${projects.map(p => projRow(p)).join('')}</div>` : empty('cube', tl('Aucun projet partagé'), tl('Créez un projet à partir de votre montage : tout le groupe pourra l’ouvrir et l’améliorer, version après version.'))}</section>
      <section class="block"><header><h2>${icon('users')}${tl('Membres')}</h2>${isOwner || teacher ? `<button type="button" class="btn small" data-add>${icon('plus')}<span>${tl('Ajouter')}</span></button>` : ''}</header>
        <div class="people">${group.members.map(m => `<div class="person">${avatar(m, 34)}<span><b>${esc(m.displayName)}</b><small>${m.role === 'owner' ? tl('créateur du groupe') : tl('membre')}</small></span>${(isOwner || teacher) && m.userId !== me.id ? `<button type="button" class="iconBtn" data-rm="${m.userId}" title="${tl('Retirer du groupe')}">${icon('x')}</button>` : ''}</div>`).join('')}</div>
        <div class="rowEnd">${mine ? `<button type="button" class="btn small danger" data-leave>${icon('logout')}<span>${tl('Quitter le groupe')}</span></button>` : ''}${isOwner || teacher ? `<button type="button" class="btn small danger" data-delg>${icon('trash')}<span>${tl('Supprimer le groupe')}</span></button>` : ''}</div></section></div>`;
    const q = s => ctx.el.querySelector(s);
    ctx.el.closest('.hub').querySelector('[data-chat]').onclick = () => hub.go('messages', { id: group.conversationId });
    if (q('[data-rename]')) q('[data-rename]').onclick = async () => { const n = await ask(tl('Renommer le groupe'), tl('Nom'), group.name); if (n) { await api.patch(`/groups/${group.id}`, { name: n }).catch(e => toast(api.errorText(e), 'err')); hub.go('group', ctx.params); } };
    if (q('[data-newp]')) q('[data-newp]').onclick = () => newProject(group);
    if (q('[data-add]')) q('[data-add]').onclick = async () => {
      const cand = c.members.filter(m => m.role === 'student' && !group.members.some(x => x.userId === m.userId));
      if (!cand.length) { toast(tl('Tous les élèves de la classe sont déjà dans le groupe.'), 'warn'); return; }
      const ids = await dialog({ title: tl('Ajouter des membres'), width: 420, body: `<div class="pickList checks">${cand.map(m => `<label class="pick"><input type="checkbox" value="${m.userId}">${avatar(m, 28)}<span><b>${esc(m.displayName)}</b></span></label>`).join('')}</div>`, actions: [{ label: CANCEL, value: null }, { label: tl('Ajouter'), value: 'ok', kind: 'primary' }], onAction: (v, el) => (v === 'ok' ? [...el.querySelectorAll('input:checked')].map(i => i.value) : undefined) });
      if (ids && ids.length) { try { await api.post(`/groups/${group.id}/members`, { userIds: ids }); hub.go('group', ctx.params); } catch (e) { toast(api.errorText(e), 'err'); } }
    };
    ctx.el.querySelectorAll('[data-rm]').forEach(b => (b.onclick = async () => { if (await confirm(tl('Retirer du groupe'), tl('Cette personne n’aura plus accès aux projets du groupe.'), tl('Retirer'), true)) { await api.del(`/groups/${group.id}/members/${b.dataset.rm}`).catch(e => toast(api.errorText(e), 'err')); hub.go('group', ctx.params); } }));
    if (q('[data-leave]')) q('[data-leave]').onclick = async () => { if (await confirm(tl('Quitter le groupe'), tl('Vous n’aurez plus accès à ses projets ni à sa discussion.'), tl('Quitter'), true)) { await api.del(`/groups/${group.id}/members/${me.id}`).catch(e => toast(api.errorText(e), 'err')); hub.go('groups'); } };
    if (q('[data-delg]')) q('[data-delg]').onclick = async () => { if (await confirm(tl('Supprimer le groupe'), tl('Le groupe, ses projets et leurs versions seront supprimés pour tout le monde.'), tl('Supprimer'), true)) { await api.del(`/groups/${group.id}`).catch(e => toast(api.errorText(e), 'err')); hub.go('groups'); } };
    ctx.el.querySelectorAll('[data-open]').forEach(b => (b.onclick = () => openProject(projects.find(p => p.id === b.dataset.open), group)));
    ctx.el.querySelectorAll('[data-hist]').forEach(b => (b.onclick = () => history(projects.find(p => p.id === b.dataset.hist), group)));
    const off = [rt.on('project:saved', e => { if (e.groupId === group.id && hub.route.page === 'group') hub.go('group', ctx.params); }), rt.on('project:lock', e => { if (projects.some(p => p.id === e.projectId) && hub.route.page === 'group') hub.go('group', ctx.params); })];
    return () => off.forEach(f => f());
  });
  async function findGroup(id) {
    for (const c of await api.get('/classrooms')) { const g = (await api.get(`/classrooms/${c.id}/groups`)).find(x => x.id === id); if (g) return g; }
    throw new api.ApiError(404, 'NOT_FOUND');
  }
  const projRow = p => {
    const v = p.currentVersion, lk = p.lock && new Date(p.lock.expiresAt) > Date.now() ? p.lock : null;
    return `<div class="projRow"><span class="prIc">${icon('cube')}</span><span class="prTxt"><b>${esc(p.title)}</b><small>${v ? tl('Version {0} · {1}, {2}', v.number, esc(v.authorName), relTime(v.createdAt)) : tl('Pas encore de version')}</small>${lk ? `<span class="lockTag">${icon('lock')}${tl('{0} a la main', esc(lk.displayName))}</span>` : ''}</span><button type="button" class="iconBtn" data-hist="${p.id}" title="${tl('Historique des versions')}">${icon('history')}</button><button type="button" class="btn small primary" data-open="${p.id}">${icon('folder')}<span>${tl('Ouvrir')}</span></button></div>`;
  };

  async function newProject(group) {
    const r = await dialog({
      title: tl('Nouveau projet partagé'), width: 440,
      body: `<label class="sField"><span>${tl('Titre')}</span><input class="sInput" data-f="t" maxlength="80" value="${esc(app.projectTitle())}"></label><label class="sField"><span>${tl('Description (facultatif)')}</span><textarea class="sInput" data-f="d" rows="2" maxlength="500"></textarea></label>
        <div class="sField"><span>${tl('Contenu de départ')}</span><label class="radioRow"><input type="radio" name="src" value="mine" checked><span><b>${tl('Mon montage actuel')}</b><small>${tl('{0} composants, {1} fils', app.comps().length, app.wires().length)}</small></span></label><label class="radioRow"><input type="radio" name="src" value="empty"><span><b>${tl('Projet vide')}</b></span></label></div>`,
      actions: [{ label: CANCEL, value: null }, { label: tl('Créer'), value: 'ok', kind: 'primary' }],
      onAction: async (v, el) => {
        if (v !== 'ok') return;
        const title = el.querySelector('[data-f="t"]').value.trim(); if (!title) return false;
        const mine = el.querySelector('input[name=src]:checked').value === 'mine';
        try { return await api.post(`/groups/${group.id}/projects`, { title, description: el.querySelector('[data-f="d"]').value.trim() || undefined, ...(mine ? { data: app.projectData(), message: tl('Version de départ') } : {}) }); }
        catch (e) { toast(api.errorText(e), 'err'); return false; }
      }
    });
    if (r && r.id) { toast(tl('Projet « {0} » créé.', r.title)); hub.go('group', { id: group.id }); }
  }

  async function history(p, group) {
    const vs = await api.get(`/projects/${p.id}/versions`).catch(e => { toast(api.errorText(e), 'err'); return null; });
    if (!vs) return;
    const v = await dialog({
      title: tl('Historique · {0}', esc(p.title)), width: 520,
      body: vs.length ? `<ol class="versions">${vs.map(x => `<li><span class="vNum">v${x.number}</span><span><b>${esc(x.message || tl('Sans message'))}</b><small>${esc(x.authorName)} · ${dateTime(x.createdAt)}</small></span><button type="button" class="btn small" data-v="${x.id}">${icon('eye')}<span>${tl('Ouvrir')}</span></button></li>`).join('')}</ol>` : empty('history', tl('Aucune version'), ''),
      actions: [{ label: tl('Fermer'), value: null }],
      onOpen: (el, close) => (el.onclick = e => { const b = e.target.closest('[data-v]'); if (b) close(b.dataset.v); })
    });
    if (v) openProject(p, group, { versionId: v });
  }

  /* ---------- Séance « projet de groupe » ---------- */
  async function openProject(p, group, { versionId = null } = {}) {
    const me = api.user();
    let lock = null, readOnly = !!versionId, version = null, dirty = false, renewTimer = null, newer = null, offs = [], offChange = null;
    if (!readOnly) {
      try { lock = await api.post(`/projects/${p.id}/lock`, {}); }
      catch (e) {
        if (e.code !== 'LOCKED') { toast(api.errorText(e), 'err'); return; }
        const holder = (e.body && e.body.lock) || p.lock || {};
        const choice = await dialog({ title: tl('Projet utilisé'), body: `<p class="dlgText">${tl('{0} a la main sur « {1} » en ce moment.', `<b>${esc(holder.displayName || '?')}</b>`, esc(p.title))}</p><p class="muted">${tl('Vous pouvez l’ouvrir en lecture, ou prendre la main : {0} ne pourra plus enregistrer.', esc(holder.displayName || ''))}</p>`, actions: [{ label: CANCEL, value: null }, { label: tl('Ouvrir en lecture'), value: 'read' }, { label: tl('Prendre la main'), value: 'force', kind: 'primary' }] });
        if (!choice) return;
        if (choice === 'force') { try { lock = await api.post(`/projects/${p.id}/lock`, { force: true }); } catch (err) { toast(api.errorText(err), 'err'); return; } }
        else readOnly = true;
      }
    }
    try { version = await api.get(`/projects/${p.id}/versions/${versionId || 'current'}`); } catch (e) { version = null; }
    if (!version && versionId) { toast(tl('Version introuvable.'), 'err'); return; }
    const panel = document.createElement('div'); panel.className = 'sessPanel';
    const chip = () => ({
      icon: readOnly ? 'eye' : 'users', tone: readOnly ? 'view' : 'group',
      title: `${p.title}${version ? ' · v' + version.number : ''}`,
      meta: readOnly ? (newer ? tl('v{0} disponible', newer.number) : tl('lecture seule')) : dirty ? tl('modifié') : tl('à jour'),
      actions: readOnly
        ? [...(newer ? [{ id: 'reload', label: tl('Recharger'), icon: 'rotate' }] : []), ...(versionId ? [] : [{ id: 'take', label: tl('Prendre la main'), icon: 'lock' }]), { id: 'end', icon: 'x', tip: tl('Fermer le projet') }]
        : [{ id: 'save', label: tl('Enregistrer'), icon: 'save', kind: 'primary' }, { id: 'end', icon: 'x', tip: tl('Fermer le projet') }]
    });
    function paintPanel() {
      panel.innerHTML = `<header class="spHead"><span class="kind group">${icon('users')}${esc(group.name)}</span><h2>${esc(p.title)}</h2><div class="spFacts">${readOnly ? `<span class="lockTag">${icon('eye')}${versionId ? tl('Version {0} (ancienne)', version.number) : tl('Lecture seule')}</span>` : `<span class="lockTag mine">${icon('lock')}${tl('Vous avez la main')}</span>`}</div></header>
        <div class="spBody">${p.description ? `<p>${esc(p.description)}</p>` : ''}<h4 class="subHead">${tl('Versions récentes')}</h4><ol class="versions compact"></ol>
        <p class="muted small">${readOnly ? tl('Vos modifications ne seront pas enregistrées dans le projet du groupe. Prenez la main pour enregistrer.') : tl('Enregistrez une version quand une étape est terminée : le groupe la retrouve dans l’historique, avec votre message.')}</p></div>
        <footer class="spFoot">${readOnly ? '' : `<button type="button" class="btn primary wide big" data-save>${icon('save')}<span>${tl('Enregistrer une version')}</span></button>`}</footer>`;
      const sv = panel.querySelector('[data-save]'); if (sv) sv.onclick = save;
      api.get(`/projects/${p.id}/versions`).then(vs => { const ol = panel.querySelector('.versions'); if (ol) ol.innerHTML = vs.slice(0, 8).map(x => `<li><span class="vNum">v${x.number}</span><span><b>${esc(x.message || tl('Sans message'))}</b><small>${esc(x.authorName)} · ${relTime(x.createdAt)}</small></span>${!readOnly ? `<button type="button" class="iconBtn" data-restore="${x.id}" title="${tl('Restaurer cette version')}">${icon('rotate')}</button>` : ''}</li>`).join(''); });
    }
    panel.addEventListener('click', async e => {
      const r = e.target.closest('[data-restore]'); if (!r) return;
      if (!(await confirm(tl('Restaurer une version'), tl('Une nouvelle version, identique à celle-ci, sera créée et ouverte. Les modifications non enregistrées seront perdues.'), tl('Restaurer')))) return;
      try { const v = await api.post(`/projects/${p.id}/versions/${r.dataset.restore}/restore`); const full = await api.get(`/projects/${p.id}/versions/${v.id}`); version = full; await app.openProject(full.data, p.title); dirty = false; paintPanel(); sessions.paintChip(); toast(tl('Version {0} restaurée.', full.number)); }
      catch (err) { toast(api.errorText(err), 'err'); }
    });
    async function save() {
      const msg = await ask(tl('Enregistrer une version'), tl('Qu’avez-vous changé ? (facultatif)'), '', { placeholder: tl('ex. ajout du capteur de température'), ok: tl('Enregistrer') });
      if (msg === null) return;
      try {
        const v = await api.post(`/projects/${p.id}/versions`, { data: app.projectData(), message: msg || undefined, baseVersionId: version ? version.id : null });
        version = { ...v }; dirty = false; sessions.paintChip(); paintPanel(); toast(tl('Version {0} enregistrée.', v.number));
        return true;
      } catch (e) {
        if (e.code === 'LOCK_REQUIRED') { toLost(); toast(api.errorText(e), 'err'); return false; }
        if (e.code === 'VERSION_CONFLICT') {
          const ok = await confirm(tl('Version plus récente'), tl('Quelqu’un a enregistré une version pendant que vous travailliez. Enregistrer la vôtre par-dessus ? (L’autre reste dans l’historique.)'), tl('Enregistrer par-dessus'));
          if (ok) { version = e.body && e.body.current ? e.body.current : version; return save(); }
          return false;
        }
        toast(api.errorText(e), 'err'); return false;
      }
    }
    function toLost(by) {
      readOnly = true; lock = null; clearInterval(renewTimer); sessions.paintChip(); paintPanel();
      if (by) toast(tl('{0} a pris la main sur le projet : vous êtes passé en lecture seule.', by.displayName), 'warn', 7000);
    }
    async function take() {
      if (dirty && !(await confirm(tl('Prendre la main'), tl('Le projet sera rechargé depuis sa dernière version : vos modifications en lecture seule seront perdues.'), tl('Continuer')))) return;
      try { lock = await api.post(`/projects/${p.id}/lock`, { force: true }); readOnly = false; newer = null; version = await api.get(`/projects/${p.id}/versions/current`).catch(() => null); if (version) await app.openProject(version.data, p.title); dirty = false; startRenew(); sessions.paintChip(); paintPanel(); }
      catch (e) { toast(api.errorText(e), 'err'); }
    }
    function startRenew() { clearInterval(renewTimer); renewTimer = setInterval(async () => { try { lock = await api.post(`/projects/${p.id}/lock/renew`); } catch (e) { if (e.code === 'LOCK_REQUIRED' || e.status === 423) toLost(); } }, 45000); }

    const ok = await sessions.begin({
      kind: 'project', panel, chip, name: p.title,
      data: version ? version.data : { app: 'jollof-studio', version: 1, name: p.title, comps: [], wires: [] },
      action: async id => {
        if (id === 'save') save();
        if (id === 'end') sessions.end();
        if (id === 'take') take();
        if (id === 'reload') { version = await api.get(`/projects/${p.id}/versions/current`); newer = null; await app.openProject(version.data, p.title); dirty = false; sessions.paintChip(); paintPanel(); }
      },
      beforeEnd: async () => {
        if (readOnly || !dirty) return true;
        const v = await dialog({ title: tl('Modifications non enregistrées'), body: `<p class="dlgText">${tl('Enregistrer une version avant de fermer le projet ?')}</p>`, actions: [{ label: CANCEL, value: null }, { label: tl('Fermer sans enregistrer'), value: 'drop', kind: 'danger' }, { label: tl('Enregistrer'), value: 'save', kind: 'primary' }] });
        if (!v) return false;
        if (v === 'save') return (await save()) === true;
        return true;
      },
      onEnd: async () => { clearInterval(renewTimer); offs.forEach(f => f()); if (offChange) offChange(); if (lock) await api.del(`/projects/${p.id}/lock`).catch(() => {}); }
    });
    if (!ok) { if (lock) api.del(`/projects/${p.id}/lock`).catch(() => {}); return; }
    paintPanel();
    offChange = app.onChange(() => { if (!dirty) { dirty = true; sessions.paintChip(); } });
    if (!readOnly) startRenew();
    offs = [
      rt.on('project:lock-lost', e => { if (e.projectId === p.id && !readOnly) toLost(e.by); }),
      rt.on('project:saved', e => { if (e.projectId === p.id && readOnly && !versionId && e.version.authorId !== me.id) { newer = e.version; sessions.paintChip(); toast(tl('{0} a enregistré la version {1}.', e.version.authorName, e.version.number)); } })
    ];
  }
}
