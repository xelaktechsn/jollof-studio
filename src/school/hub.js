// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Espace classe : une page plein écran au-dessus du plan de travail, avec sa navigation
// (accueil, classes, messages, groupes, notes), la connexion, le compte et les notifications.
// Les pages sont enregistrées par rôle ; l'édition Pro ajoute celles de l'enseignant.
import { tl } from '../i18n/index.js';
import * as api from './api.js';
import * as rt from './rt.js';
import { ready as richReady } from './rich.js';
import { icon, esc, avatar, toast, dialog, menu, relTime, COLORS, skeleton } from './ui.js';
import { hydrateIcons } from '../ui/icons.js';

export function createHub(app, { pro = false } = {}) {
  const pages = new Map(); // id → [{ roles, render, nav }]
  const navItems = [];      // { id, label, icon, roles, badge }
  let route = { page: 'home', params: {} }, cleanup = null, open = false, unread = { messages: 0, notifications: 0 }, notifs = [];
  const roleOf = () => { const u = api.user(); return !u ? null : u.role === 'student' ? 'student' : 'teacher'; };

  /* ---------- Structure ---------- */
  const root = document.createElement('div');
  root.className = 'hub'; root.hidden = true;
  root.innerHTML = `<aside class="hubNav"><div class="hubSchool"></div><nav class="hubLinks"></nav><div class="hubMe"></div></aside>
    <main class="hubMain"><header class="hubHead"><div class="hubTitle"></div><div class="hubActions"></div><button type="button" class="iconBtn hubBell" aria-label="${tl('Notifications')}">${icon('bell')}<b hidden></b></button><button type="button" class="iconBtn" data-close aria-label="${tl('Revenir au plan de travail')}" title="${tl('Revenir au plan de travail (Échap)')}">${icon('x')}</button></header><div class="hubBody"></div></main>`;
  document.body.appendChild(root);
  const $ = s => root.querySelector(s);
  const body = $('.hubBody');

  // Bouton de la barre d'application.
  const btn = app.toolbar(`<button type="button" class="tb label" id="hubBtn" data-tip="${tl('Espace classe : devoirs, messages, groupes')}">${icon('school')}<span>${tl('Classe')}</span><b class="tbBadge" hidden></b></button>`);
  btn.onclick = () => (open ? close() : show());

  /* ---------- Enregistrement des pages ---------- */
  const hub = {
    app, pro,
    page(id, render, { roles = ['student', 'teacher'] } = {}) { if (!pages.has(id)) pages.set(id, []); pages.get(id).unshift({ roles, render }); },
    // Une entrée enregistrée plus tard (édition Pro) remplace celle du même nom pour les mêmes rôles.
    nav(id, label, ic, roles = ['student', 'teacher'], order = 50) {
      navItems.forEach(n => { if (n.id === id) n.roles = n.roles.filter(r => !roles.includes(r)); });
      navItems.push({ id, label, icon: ic, roles, order }); navItems.sort((a, b) => a.order - b.order);
    },
    go, show, close, refreshBadges, get route() { return route; }, get isOpen() { return open; },
    setUnread(k, n) { unread[k] = Math.max(0, n); paintBadges(); },
    bumpUnread(k, d) { unread[k] = Math.max(0, unread[k] + d); paintBadges(); }
  };

  /* ---------- Navigation ---------- */
  async function show(page, params) {
    open = true; root.hidden = false; root.classList.remove('out'); document.body.classList.add('hubOpen');
    await richReady().catch(() => {});
    if (page) return go(page, params);
    return go(route.page, route.params);
  }
  function close() { open = false; root.classList.add('out'); document.body.classList.remove('hubOpen'); if (app.invalidate) app.invalidate(300); setTimeout(() => { if (!open) root.hidden = true; }, 160); }
  async function go(page, params = {}) {
    if (!open) { open = true; root.hidden = false; root.classList.remove('out'); document.body.classList.add('hubOpen'); await richReady().catch(() => {}); }
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    route = { page, params };
    paintNav();
    if (!api.current()) return renderLogin();
    const role = roleOf(), list = pages.get(page) || [], p = list.find(x => x.roles.includes(role)) || (pages.get('home') || []).find(x => x.roles.includes(role));
    $('.hubActions').innerHTML = ''; $('.hubTitle').innerHTML = '';
    body.innerHTML = skeleton(4); body.scrollTop = 0;
    if (!p) { body.innerHTML = ''; return; }
    const ctx = {
      app, hub, api, rt, el: body, params, role,
      head(title, crumbs = [], actions = '') {
        $('.hubTitle').innerHTML = `${crumbs.map(c => `<button type="button" class="crumb" data-go="${esc(c.page)}" data-params='${esc(JSON.stringify(c.params || {}))}'>${esc(c.label)}</button>${icon('chevRight')}`).join('')}<h1>${title}</h1>`;
        $('.hubActions').innerHTML = actions; hydrateIcons($('.hubActions'));
        return $('.hubActions');
      },
      fail(e) { body.innerHTML = `<div class="hubError">${icon('alert')}<b>${tl('Chargement impossible')}</b><p>${esc(api.errorText(e))}</p><button type="button" class="btn" data-retry>${tl('Réessayer')}</button></div>`; body.querySelector('[data-retry]').onclick = () => go(page, params); }
    };
    root.classList.add('loading');
    try { const c = await p.render(ctx); if (route.page === page && route.params === params) cleanup = typeof c === 'function' ? c : null; else if (typeof c === 'function') c(); }
    catch (e) { console.error(e); if (route.page === page) ctx.fail(e); }
    finally { if (route.params === params) root.classList.remove('loading'); }
    hydrateIcons(root);
  }
  root.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) return close();
    const g = e.target.closest('[data-go]');
    if (g && root.contains(g)) { e.preventDefault(); let p = {}; try { p = JSON.parse(g.dataset.params || '{}'); } catch (err) { p = {}; } go(g.dataset.go, p); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open && !document.querySelector('.sDialogWrap, .sMenu') && !e.target.closest('.ProseMirror, textarea, input')) { e.preventDefault(); close(); }
  });

  function paintNav() {
    const u = api.user(), s = api.current() && api.current().school, role = roleOf();
    $('.hubSchool').innerHTML = u ? `<span class="hubLogo">${icon('school')}</span><div><b>${esc(s ? s.name : '')}</b><small>${planText(s)}</small></div>` : `<span class="hubLogo">${icon('school')}</span><div><b>${tl('Espace classe')}</b><small>Jollof Studio</small></div>`;
    $('.hubLinks').innerHTML = u ? navItems.filter(n => n.roles.includes(role)).map(n => `<button type="button" class="hubLink${n.id === route.page || (route.params.section === n.id) ? ' on' : ''}" data-go="${n.id}">${icon(n.icon)}<span>${n.label}</span>${n.id === 'messages' && unread.messages ? `<b>${unread.messages > 99 ? '99+' : unread.messages}</b>` : ''}</button>`).join('') : '';
    $('.hubMe').innerHTML = u ? `<button type="button" class="hubUser" data-me>${avatar({ ...u, online: rt.connected() }, 34)}<span><b>${esc(u.displayName)}</b><small>${roleText(u.role)}</small></span>${icon('dots')}</button>` : '';
    root.classList.toggle('noNav', !u);
  }
  const roleText = r => (r === 'admin' ? tl('Administrateur · enseignant') : r === 'teacher' ? tl('Enseignant') : tl('Élève'));
  function planText(s) {
    if (!s) return '';
    if (s.plan === 'pro') return tl('Abonnement Pro');
    if (s.plan === 'trial') { const d = Math.ceil((new Date(s.trialEndsAt) - Date.now()) / 86400000); return d > 0 ? tl('Essai · {0} j restants', d) : tl('Essai terminé'); }
    return tl('Abonnement expiré');
  }
  function paintBadges() {
    const n = unread.messages + unread.notifications, b = btn.querySelector('.tbBadge');
    b.hidden = !n || !api.current(); b.textContent = n > 99 ? '99+' : n;
    const bb = $('.hubBell b'); bb.hidden = !unread.notifications; bb.textContent = unread.notifications > 99 ? '99+' : unread.notifications;
    const m = root.querySelector('.hubLink[data-go="messages"]');
    if (m) { let tag = m.querySelector('b'); if (!unread.messages) { if (tag) tag.remove(); } else { if (!tag) { tag = document.createElement('b'); m.appendChild(tag); } tag.textContent = unread.messages > 99 ? '99+' : unread.messages; } }
  }
  async function refreshBadges() {
    if (!api.current()) { unread = { messages: 0, notifications: 0 }; paintBadges(); return; }
    try {
      const [convs, ns] = await Promise.all([api.get('/conversations'), api.get('/notifications' + api.qs({ unread: true, limit: 50 }))]);
      unread.messages = convs.reduce((t, c) => t + (c.unreadCount || 0), 0); unread.notifications = ns.length; notifs = ns;
      paintBadges();
    } catch (e) { /* hors ligne : les pastilles restent telles quelles */ }
  }

  /* ---------- Compte ---------- */
  root.addEventListener('click', async e => {
    if (!e.target.closest('[data-me]')) return;
    const v = await menu(e.target.closest('[data-me]'), [
      { label: tl('Mon profil'), icon: 'user', value: 'profile' },
      { label: tl('Changer de mot de passe'), icon: 'key', value: 'password' },
      '-', { label: tl('Se déconnecter'), icon: 'logout', value: 'logout', danger: true }
    ]);
    if (v === 'profile') profile();
    if (v === 'password') changePassword(false);
    if (v === 'logout') { await api.logout(); rt.disconnect(); refreshBadges(); go('home'); toast(tl('Vous êtes déconnecté.')); }
  });
  async function profile() {
    const u = api.user();
    let color = u.avatarColor;
    const r = await dialog({
      title: tl('Mon profil'), width: 420,
      body: `<div class="profileHead">${avatar(u, 56)}<div><b>${esc(u.displayName)}</b><small>${esc(u.username || u.email || '')}</small></div></div>
        <label class="sField"><span>${tl('Nom affiché')}</span><input class="sInput" data-f="name" value="${esc(u.displayName)}" maxlength="60"></label>
        <div class="sField"><span>${tl('Couleur')}</span><div class="swatchRow">${COLORS.map(c => `<button type="button" class="swatch${c === color ? ' on' : ''}" data-c="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}</div></div>`,
      actions: [{ label: tl('Annuler'), value: null }, { label: tl('Enregistrer'), value: 'ok', kind: 'primary' }],
      onOpen: el => el.addEventListener('click', e => { const s = e.target.closest('[data-c]'); if (!s) return; color = s.dataset.c; el.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === s)); }),
      onAction: async (v, el) => {
        if (v !== 'ok') return;
        try { const nu = await api.patch('/me', { displayName: el.querySelector('[data-f="name"]').value.trim(), avatarColor: color }); api.patchSession({ user: nu }); paintNav(); return 'ok'; }
        catch (err) { toast(api.errorText(err), 'err'); return false; }
      }
    });
    if (r) toast(tl('Profil enregistré.'));
  }
  async function changePassword(forced) {
    const r = await dialog({
      title: forced ? tl('Choisissez votre mot de passe') : tl('Changer de mot de passe'), width: 420,
      body: `${forced ? `<p class="dlgText">${tl('Vous vous connectez avec un mot de passe provisoire. Choisissez-en un que vous seul connaissez.')}</p>` : ''}
        <label class="sField"><span>${tl('Mot de passe actuel')}</span><input class="sInput" type="password" data-f="cur" autocomplete="current-password"></label>
        <label class="sField"><span>${tl('Nouveau mot de passe (8 caractères au moins)')}</span><input class="sInput" type="password" data-f="new" autocomplete="new-password" minlength="8"></label>
        <label class="sField"><span>${tl('Confirmer')}</span><input class="sInput" type="password" data-f="new2" autocomplete="new-password"></label><p class="formErr" hidden></p>`,
      actions: forced ? [{ label: tl('Enregistrer'), value: 'ok', kind: 'primary' }] : [{ label: tl('Annuler'), value: null }, { label: tl('Enregistrer'), value: 'ok', kind: 'primary' }],
      onAction: async (v, el) => {
        if (v !== 'ok') return;
        const f = k => el.querySelector(`[data-f="${k}"]`).value, err = el.querySelector('.formErr');
        const fail = t => { err.textContent = t; err.hidden = false; return false; };
        if (f('new').length < 8) return fail(tl('8 caractères au moins.'));
        if (f('new') !== f('new2')) return fail(tl('Les deux mots de passe ne sont pas identiques.'));
        try { await api.post('/me/password', { currentPassword: f('cur'), newPassword: f('new') }); api.patchSession({ user: { ...api.user(), mustChangePassword: false } }); return 'ok'; }
        catch (e) { return fail(e.code === 'AUTH_INVALID_CREDENTIALS' || e.status === 401 || e.status === 403 ? tl('Mot de passe actuel incorrect.') : api.errorText(e)); }
      }
    });
    if (r) toast(tl('Mot de passe changé.'));
    else if (forced) changePassword(true);
  }

  /* ---------- Connexion ---------- */
  function renderLogin(mode = 'login') {
    $('.hubTitle').innerHTML = ''; $('.hubActions').innerHTML = '';
    body.innerHTML = `<div class="authWrap"><div class="authCard">
      <section class="authBrand"><div class="authArt">${icon('school')}</div><h2>${tl('Espace classe')}</h2><p>${tl('Vos devoirs, vos montages, vos messages et le travail de groupe, au même endroit.')}</p>
        <ul><li>${icon('inbox')}${tl('Devoirs et évaluations corrigés automatiquement')}</li><li>${icon('users')}${tl('Groupes de travail et projets partagés')}</li><li>${icon('message')}${tl('Discussion avec la classe et l’enseignant')}</li></ul></section>
      <section class="authForm">${mode === 'login' ? `
        <h3>${tl('Connexion')}</h3><p class="muted">${tl('Utilisez l’identifiant et le mot de passe donnés par votre enseignant.')}</p>
        <label class="sField"><span>${tl('Identifiant ou e-mail')}</span><input class="sInput" data-f="login" autocomplete="username" placeholder="${tl('ex. awa.ndiaye')}"></label>
        <label class="sField"><span>${tl('Mot de passe')}</span><input class="sInput" type="password" data-f="pass" autocomplete="current-password"></label>
        <p class="formErr" hidden></p>
        <button type="button" class="btn primary wide big" data-login>${tl('Se connecter')}</button>
        ${pro ? `<div class="authAlt"><span>${tl('Enseignant sans compte ?')}</span><button type="button" class="linkBtn" data-mode="register">${tl('Créer l’espace de mon école')}</button></div>` : `<div class="authAlt"><span>${tl('Enseignant ?')}</span><span class="muted">${tl('Créer une école et des classes demande Jollof Studio Pro.')}</span></div>`}` : `
        <h3>${tl('Créer l’espace de mon école')}</h3><p class="muted">${tl('Vous en serez l’administrateur. Essai gratuit, sans carte bancaire.')}</p>
        <label class="sField"><span>${tl('Nom de l’école')}</span><input class="sInput" data-f="school" maxlength="120" placeholder="${tl('ex. Lycée Blaise Diagne')}"></label>
        <label class="sField"><span>${tl('Votre nom')}</span><input class="sInput" data-f="name" maxlength="60"></label>
        <label class="sField"><span>${tl('E-mail')}</span><input class="sInput" type="email" data-f="email" autocomplete="email"></label>
        <label class="sField"><span>${tl('Mot de passe (8 caractères au moins)')}</span><input class="sInput" type="password" data-f="pass" autocomplete="new-password"></label>
        <p class="formErr" hidden></p>
        <button type="button" class="btn primary wide big" data-register>${tl('Créer l’école')}</button>
        <div class="authAlt"><button type="button" class="linkBtn" data-mode="login">${tl('J’ai déjà un compte')}</button></div>`}
        <details class="authServer"><summary>${icon('gear')}${tl('Serveur')}</summary><label class="sField"><span>${tl('Adresse du serveur de l’école')}</span><input class="sInput" data-f="server" value="${esc(api.server())}" placeholder="${esc(api.defaultServer)}"></label></details>
      </section></div></div>`;
    hydrateIcons(body);
    const f = k => body.querySelector(`[data-f="${k}"]`), err = body.querySelector('.formErr');
    const fail = t => { err.textContent = t; err.hidden = false; };
    f('server').onchange = () => api.setServer(f('server').value.trim());
    body.querySelectorAll('[data-mode]').forEach(b => (b.onclick = () => renderLogin(b.dataset.mode)));
    const submit = async b => {
      err.hidden = true; b.disabled = true; b.classList.add('busy');
      try {
        api.setServer(f('server').value.trim());
        if (mode === 'login') { if (!f('login').value.trim() || !f('pass').value) return fail(tl('Saisissez votre identifiant et votre mot de passe.')); await api.login(f('login').value, f('pass').value); }
        else {
          if (f('pass').value.length < 8) return fail(tl('Mot de passe : 8 caractères au moins.'));
          await api.registerSchool({ schoolName: f('school').value.trim(), displayName: f('name').value.trim(), email: f('email').value.trim(), password: f('pass').value });
        }
        await signedIn();
      } catch (e) { fail(api.errorText(e)); } finally { b.disabled = false; b.classList.remove('busy'); }
    };
    const main = body.querySelector('[data-login], [data-register]');
    main.onclick = () => submit(main);
    body.querySelectorAll('.authForm input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(main); }));
    setTimeout(() => (f('login') || f('school')).focus(), 50);
  }
  async function signedIn() {
    rt.connect(); refreshBadges();
    const u = api.user();
    toast(tl('Bienvenue, {0} !', u.displayName));
    await go('home');
    if (u.mustChangePassword) changePassword(true);
  }

  /* ---------- Notifications ---------- */
  const NOTIF = {
    assignment_published: d => ({ ic: 'inbox', text: tl('Nouveau devoir : {0}', d.assignmentTitle || ''), sub: d.classroomName, go: ['assignment', { id: d.assignmentId }] }),
    submission_received: d => ({ ic: 'send', text: tl('{0} a envoyé sa copie', d.studentName || d.byName || ''), sub: d.assignmentTitle, go: ['submissions', { id: d.assignmentId }] }),
    submission_graded: d => ({ ic: 'check', text: tl('Copie corrigée : {0}', d.assignmentTitle || ''), sub: d.classroomName, go: ['assignment', { id: d.assignmentId }] }),
    submission_returned: d => ({ ic: 'award', text: tl('Copie rendue : {0}', d.assignmentTitle || ''), sub: d.classroomName, go: ['assignment', { id: d.assignmentId }] }),
    group_added: d => ({ ic: 'users', text: tl('Vous faites partie du groupe {0}', d.groupName || ''), sub: d.byName ? tl('ajouté par {0}', d.byName) : d.classroomName, go: ['group', { id: d.groupId }] }),
    project_lock_taken: d => ({ ic: 'lock', text: tl('{0} a pris la main sur « {1} »', d.byName || '', d.projectTitle || ''), sub: d.groupName, go: ['group', { id: d.groupId }] })
  };
  hub.notifText = n => (NOTIF[n.type] || (() => ({ ic: 'bell', text: n.type, sub: '' })))(n.data || {});
  $('.hubBell').onclick = async e => {
    document.querySelectorAll('.notifPanel').forEach(p => p.remove());
    let list = notifs;
    try { list = await api.get('/notifications' + api.qs({ limit: 30 })); } catch (err) { /* liste locale */ }
    const panel = document.createElement('div'); panel.className = 'notifPanel';
    panel.innerHTML = `<header><b>${tl('Notifications')}</b>${list.some(n => !n.readAt) ? `<button type="button" class="linkBtn" data-all>${tl('Tout marquer comme lu')}</button>` : ''}</header>
      <div class="notifList">${list.length ? list.map((n, i) => { const t = hub.notifText(n); return `<button type="button" class="notif${n.readAt ? '' : ' unread'}" data-i="${i}"><span class="nIc">${icon(t.ic)}</span><span><b>${esc(t.text)}</b><small>${esc(t.sub || '')} · ${relTime(n.createdAt)}</small></span></button>`; }).join('') : `<p class="muted pad">${tl('Aucune notification.')}</p>`}</div>`;
    document.body.appendChild(panel);
    const r = e.currentTarget.getBoundingClientRect(); panel.style.top = r.bottom + 8 + 'px'; panel.style.right = innerWidth - r.right + 'px';
    const out = ev => { if (!panel.contains(ev.target)) { panel.remove(); document.removeEventListener('mousedown', out, true); } };
    setTimeout(() => document.addEventListener('mousedown', out, true));
    panel.onclick = async ev => {
      if (ev.target.closest('[data-all]')) { await api.post('/notifications/read', { all: true }).catch(() => {}); hub.setUnread('notifications', 0); panel.remove(); return; }
      const b = ev.target.closest('[data-i]'); if (!b) return;
      const n = list[+b.dataset.i], t = hub.notifText(n);
      if (!n.readAt) { api.post('/notifications/read', { ids: [n.id] }).catch(() => {}); hub.bumpUnread('notifications', -1); }
      panel.remove(); if (t.go) go(t.go[0], t.go[1]);
    };
  };
  rt.on('notification', ({ notification }) => {
    notifs.unshift(notification); hub.bumpUnread('notifications', 1);
    const t = hub.notifText(notification); toast(t.text, 'ok');
  });
  rt.on('message:new', ({ message }) => { if (message.sender.id !== (api.user() || {}).id && !(open && route.page === 'messages' && route.params.id === message.conversationId && document.hasFocus())) hub.bumpUnread('messages', 1); });
  rt.onStatus(() => { if (api.current() && open) { const a = root.querySelector('.hubMe .av'); if (a) a.classList.toggle('on', rt.connected()); } });
  api.onSession(s => { if (!s) { rt.disconnect(); unread = { messages: 0, notifications: 0 }; paintBadges(); if (open) go('home'); } });

  // Session existante : connexion temps réel dès le démarrage, pour les pastilles.
  if (api.current()) { rt.connect(); refreshBadges(); api.reloadMe().catch(() => {}); }
  paintBadges();
  return hub;
}
