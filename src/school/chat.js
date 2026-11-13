// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Messagerie : discussions de classe, de groupe et messages directs, en temps réel.
// Texte simple (liens cliquables), pièces jointes, modification pendant 15 minutes,
// suppression par l'auteur ou par l'enseignant (modération), indicateur « écrit… ».
import { tl, CANCEL } from '../i18n/index.js';
import * as api from './api.js';
import * as rt from './rt.js';
import { icon, esc, avatar, relTime, timeOnly, dateOnly, empty, toast, confirm, dialog, menu } from './ui.js';
import { openExternal } from '../native.js';

const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => `<a href="${u}" data-ext>${u}</a>`).replace(/\n/g, '<br>');
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const convIcon = c => (c.kind === 'direct' && c.other ? avatar(c.other, 38) : `<span class="convIc ${c.kind}">${icon(c.kind === 'class' ? 'school' : 'users')}</span>`);

export function installChat(hub) {
  hub.nav('messages', tl('Messages'), 'message', ['student', 'teacher'], 30);

  /** Message direct avec une personne (crée la conversation au besoin). */
  hub.openDirect = async userId => {
    try { const c = await api.post('/conversations/direct', { userId }); hub.go('messages', { id: c.id }); }
    catch (e) { toast(api.errorText(e), 'err'); }
  };

  hub.page('messages', async ctx => {
    const me = api.user();
    let convs = await api.get('/conversations'), cur = null, msgs = [], typing = new Map(), filter = '', more = true;
    ctx.head(tl('Messages'), [], `<button type="button" class="btn" data-new>${icon('edit')}<span>${tl('Nouveau message')}</span></button>`);
    ctx.el.innerHTML = `<div class="chat"><aside class="convList"><div class="convSearch">${icon('search')}<input placeholder="${tl('Rechercher une discussion')}"></div><div class="convItems"></div></aside><section class="thread"></section></div>`;
    const list = ctx.el.querySelector('.convItems'), thread = ctx.el.querySelector('.thread');

    function paintList() {
      const f = filter.toLowerCase();
      const items = convs.filter(c => !f || c.title.toLowerCase().includes(f)).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      list.innerHTML = items.length ? items.map(c => `<button type="button" class="conv${cur && cur.id === c.id ? ' on' : ''}${c.unreadCount ? ' unread' : ''}" data-c="${c.id}">${convIcon(c)}<span class="cvTxt"><b>${esc(c.title)}</b><small>${c.lastMessage ? esc((c.lastMessage.sender.id === me.id ? tl('Vous : ') : c.kind === 'direct' ? '' : c.lastMessage.sender.displayName.split(' ')[0] + ' : ') + (c.lastMessage.deleted ? tl('message supprimé') : c.lastMessage.body || tl('pièce jointe'))) : `<i>${tl('Aucun message')}</i>`}</small></span><span class="cvSide">${c.lastMessage ? `<small>${relTime(c.lastMessage.createdAt)}</small>` : ''}${c.unreadCount ? `<b class="badge">${c.unreadCount}</b>` : ''}</span></button>`).join('') : `<p class="muted pad">${tl('Aucune discussion.')}</p>`;
    }
    ctx.el.querySelector('.convSearch input').oninput = e => { filter = e.target.value; paintList(); };
    list.onclick = e => { const b = e.target.closest('[data-c]'); if (b) select(b.dataset.c); };

    async function select(id) {
      cur = convs.find(c => c.id === id); if (!cur) return;
      hub.route.params.id = id;
      paintList();
      thread.innerHTML = `<header class="thHead">${convIcon(cur)}<div><b>${esc(cur.title)}</b><small>${cur.kind === 'class' ? tl('Discussion de la classe') : cur.kind === 'group' ? tl('Discussion du groupe') : cur.other ? (cur.other.role === 'student' ? tl('Élève') : tl('Enseignant')) : ''}</small></div><span class="grow"></span>${cur.kind === 'class' && me.role !== 'student' ? `<label class="switch small" title="${tl('Si désactivé, seuls les enseignants peuvent écrire (annonces)')}"><input type="checkbox" data-post${cur.settings.studentsCanPost ? ' checked' : ''}><span></span>${tl('Les élèves peuvent écrire')}</label>` : ''}</header>
        <div class="msgs"><div class="msgsInner"></div></div><div class="typing" hidden></div>
        ${cur.kind === 'class' && me.role === 'student' && !cur.settings.studentsCanPost ? `<div class="composer off">${icon('lock')}${tl('Seuls les enseignants écrivent dans cette discussion.')}</div>` : `<div class="composer"><div class="atts"></div><div class="cRow"><button type="button" class="iconBtn" data-attach title="${tl('Joindre un fichier')}">${icon('attach')}</button><textarea rows="1" placeholder="${tl('Écrire un message… (Entrée pour envoyer, Maj+Entrée pour aller à la ligne)')}" maxlength="4000"></textarea><button type="button" class="btn primary icon" data-send title="${tl('Envoyer')}">${icon('send')}</button></div><input type="file" hidden></div>`}`;
      const box = thread.querySelector('.msgs');
      box.innerHTML = '<div class="msgsInner"><div class="skel"><div></div><div></div></div></div>';
      msgs = []; more = true; bindComposer();
      try { msgs = await api.get(`/conversations/${id}/messages?limit=50`); more = msgs.length === 50; } catch (e) { toast(api.errorText(e), 'err'); }
      if (cur.id !== id) return;
      paintMsgs(true); markRead();
      const post = thread.querySelector('[data-post]');
      if (post) post.onchange = async () => { try { cur.settings = (await api.patch(`/conversations/${id}/settings`, { studentsCanPost: post.checked })).settings; } catch (e) { post.checked = !post.checked; toast(api.errorText(e), 'err'); } };
      box.onscroll = async () => {
        if (box.scrollTop > 40 || !more || !msgs.length || box.dataset.loading) return;
        box.dataset.loading = '1';
        try { const older = await api.get(`/conversations/${id}/messages?limit=50&before=${msgs[0].id}`); more = older.length === 50; const h = box.scrollHeight; msgs = [...older, ...msgs]; paintMsgs(false); box.scrollTop = box.scrollHeight - h; }
        finally { delete box.dataset.loading; }
      };
    }
    function paintMsgs(toBottom) {
      const box = thread.querySelector('.msgs'); if (!box) return;
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      let html = '', prev = null;
      if (!msgs.length) html = empty('message', tl('Aucun message'), tl('Écrivez le premier !'));
      for (const m of msgs) {
        if (!prev || !sameDay(prev.createdAt, m.createdAt)) html += `<div class="day"><span>${sameDay(m.createdAt, Date.now()) ? tl('Aujourd’hui') : dateOnly(m.createdAt)}</span></div>`;
        const grouped = prev && prev.sender.id === m.sender.id && sameDay(prev.createdAt, m.createdAt) && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60000;
        const mine = m.sender.id === me.id;
        html += `<div class="msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}" data-m="${m.id}">${mine || grouped ? '<span class="avSpace"></span>' : avatar(m.sender, 30)}<div class="bubbleWrap">${!mine && !grouped ? `<span class="who">${esc(m.sender.displayName)}${m.sender.role !== 'student' ? ` <span class="roleTag">${tl('enseignant')}</span>` : ''}</span>` : ''}
          <div class="bubble${m.deleted ? ' deleted' : ''}">${m.deleted ? `<i>${tl('Message supprimé')}</i>` : `${m.body ? `<div class="txt">${linkify(m.body)}</div>` : ''}${(m.attachments || []).map(attHtml).join('')}`}<span class="when">${timeOnly(m.createdAt)}${m.editedAt ? ' · ' + tl('modifié') : ''}</span></div></div>${!m.deleted && canAct(m) ? `<button type="button" class="iconBtn msgMenu" data-menu="${m.id}">${icon('dots')}</button>` : ''}</div>`;
        prev = m;
      }
      box.querySelector('.msgsInner').innerHTML = html;
      if (toBottom || atBottom) box.scrollTop = box.scrollHeight;
    }
    const attHtml = f => (/^image\//.test(f.mime) ? `<a class="attImg" href="${esc(api.fileUrl(f.url))}" data-ext><img src="${esc(api.fileUrl(f.url))}" alt="${esc(f.name)}" loading="lazy"></a>` : `<a class="attFile" href="${esc(api.fileUrl(f.url))}" data-ext>${icon(/jollof|json/.test(f.name) ? 'cube' : 'file')}<span>${esc(f.name)}</span><small>${Math.ceil(f.size / 1024)} ${tl('Ko')}</small></a>`);
    const canAct = m => m.sender.id === me.id || (me.role !== 'student' && cur.kind !== 'direct');
    thread.addEventListener('click', async e => {
      const a = e.target.closest('a[data-ext]'); if (a) { e.preventDefault(); openExternal(a.href); return; }
      const b = e.target.closest('[data-menu]'); if (!b) return;
      const m = msgs.find(x => x.id === b.dataset.menu), mine = m.sender.id === me.id, editable = mine && Date.now() - new Date(m.createdAt) < 15 * 60000 && m.body;
      const v = await menu(b, [...(editable ? [{ label: tl('Modifier'), icon: 'edit', value: 'edit' }] : []), { label: tl('Copier le texte'), icon: 'copy', value: 'copy' }, { label: mine ? tl('Supprimer') : tl('Supprimer (modération)'), icon: 'trash', value: 'del', danger: true }]);
      if (v === 'copy') navigator.clipboard && navigator.clipboard.writeText(m.body || '');
      if (v === 'edit') {
        const body = await dialog({ title: tl('Modifier le message'), body: `<textarea class="sInput" rows="5" maxlength="4000">${esc(m.body)}</textarea>`, actions: [{ label: CANCEL, value: null }, { label: tl('Enregistrer'), value: 'ok', kind: 'primary' }], onAction: (x, el) => (x === 'ok' ? el.querySelector('textarea').value.trim() || false : undefined) });
        if (body) { try { Object.assign(m, await api.patch(`/messages/${m.id}`, { body })); paintMsgs(); } catch (err) { toast(api.errorText(err), 'err'); } }
      }
      if (v === 'del' && await confirm(tl('Supprimer le message'), tl('Le message sera remplacé par « Message supprimé » pour tout le monde.'), tl('Supprimer'), true)) {
        try { await api.del(`/messages/${m.id}`); m.deleted = true; m.body = null; m.attachments = []; paintMsgs(); } catch (err) { toast(api.errorText(err), 'err'); }
      }
    });

    let pending = [], lastTyping = 0;
    function bindComposer() {
      const ta = thread.querySelector('textarea'); if (!ta) return;
      const file = thread.querySelector('input[type=file]'), atts = thread.querySelector('.atts');
      const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; };
      const paintAtts = () => { atts.innerHTML = pending.map((f, i) => `<span class="attChip">${icon(/^image\//.test(f.mime) ? 'image' : 'file')}${esc(f.name)}<button type="button" data-rm="${i}">${icon('x')}</button></span>`).join(''); };
      atts.onclick = e => { const r = e.target.closest('[data-rm]'); if (r) { pending.splice(+r.dataset.rm, 1); paintAtts(); } };
      ta.oninput = () => { grow(); if (Date.now() - lastTyping > 3000) { lastTyping = Date.now(); rt.emit('typing', { conversationId: cur.id }); } };
      ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
      thread.querySelector('[data-send]').onclick = send;
      thread.querySelector('[data-attach]').onclick = () => file.click();
      file.onchange = async () => { const f = file.files[0]; file.value = ''; if (!f) return; try { pending.push(await api.upload(f)); paintAtts(); } catch (err) { toast(api.errorText(err), 'err'); } };
      async function send() {
        const body = ta.value.trim(); if (!body && !pending.length) return;
        const b = thread.querySelector('[data-send]'); b.disabled = true;
        try {
          const m = await api.post(`/conversations/${cur.id}/messages`, { body: body || pending.map(p => p.name).join(', '), attachmentIds: pending.map(p => p.id) });
          if (!msgs.some(x => x.id === m.id)) msgs.push(m);
          ta.value = ''; pending = []; paintAtts(); grow(); paintMsgs(true);
          cur.lastMessage = m; cur.updatedAt = m.createdAt; paintList();
        } catch (err) { toast(api.errorText(err), 'err'); } finally { b.disabled = false; ta.focus(); }
      }
      setTimeout(() => ta.focus(), 50);
    }
    async function markRead() {
      if (!cur || !msgs.length) return;
      const n = cur.unreadCount || 0; cur.unreadCount = 0; paintList();
      if (n) hub.bumpUnread('messages', -n);
      api.post(`/conversations/${cur.id}/read`, { messageId: msgs[msgs.length - 1].id }).catch(() => {});
    }
    function paintTyping() {
      const el = thread.querySelector('.typing'); if (!el) return;
      const names = [...typing.values()].filter(t => t.until > Date.now() && t.conversationId === (cur && cur.id)).map(t => t.displayName.split(' ')[0]);
      el.hidden = !names.length; el.innerHTML = names.length ? `<span class="dotsAnim"><i></i><i></i><i></i></span>${esc(names.join(', '))} ${names.length > 1 ? tl('écrivent…') : tl('écrit…')}` : '';
    }

    // Temps réel.
    const offs = [
      rt.on('message:new', ({ message: m }) => {
        const c = convs.find(x => x.id === m.conversationId);
        if (!c) { api.get('/conversations').then(cs => { convs = cs; paintList(); }); return; }
        c.lastMessage = m; c.updatedAt = m.createdAt;
        typing.delete(m.sender.id);
        if (cur && cur.id === c.id) { if (!msgs.some(x => x.id === m.id)) { msgs.push(m); paintMsgs(); } if (m.sender.id !== me.id) markRead(); paintTyping(); }
        else if (m.sender.id !== me.id) c.unreadCount = (c.unreadCount || 0) + 1;
        paintList();
      }),
      rt.on('message:updated', ({ message: m }) => { const i = msgs.findIndex(x => x.id === m.id); if (i >= 0) { msgs[i] = m; paintMsgs(); } }),
      rt.on('message:deleted', ({ id }) => { const m = msgs.find(x => x.id === id); if (m) { m.deleted = true; m.body = null; m.attachments = []; paintMsgs(); } }),
      rt.on('typing', t => { if (t.userId === me.id) return; typing.set(t.userId, { ...t, until: Date.now() + 4000 }); paintTyping(); setTimeout(paintTyping, 4100); }),
      rt.on('conversation:new', ({ conversation }) => { if (!convs.some(c => c.id === conversation.id)) { convs.push(conversation); paintList(); } }),
      rt.on('conversation:removed', ({ id }) => { convs = convs.filter(c => c.id !== id); if (cur && cur.id === id) { cur = null; thread.innerHTML = ''; } paintList(); })
    ];

    ctx.el.closest('.hub').querySelector('[data-new]').onclick = async () => {
      const people = await reachable();
      if (!people.length) { toast(tl('Personne à qui écrire pour l’instant.'), 'warn'); return; }
      const id = await dialog({
        title: tl('Nouveau message'), width: 420,
        body: `<div class="convSearch">${icon('search')}<input placeholder="${tl('Rechercher une personne')}"></div><div class="pickList">${people.map(p => `<button type="button" class="pick" data-u="${p.userId}">${avatar(p, 32)}<span><b>${esc(p.displayName)}</b><small>${esc(p.classes.join(', '))}</small></span></button>`).join('')}</div>`,
        actions: [{ label: CANCEL, value: null }],
        onOpen: (el, close) => {
          el.querySelector('input').oninput = e => { const f = e.target.value.toLowerCase(); el.querySelectorAll('.pick').forEach(b => (b.hidden = !b.textContent.toLowerCase().includes(f))); };
          el.onclick = e => { const b = e.target.closest('[data-u]'); if (b) close(b.dataset.u); };
        }
      });
      if (id) { try { const c = await api.post('/conversations/direct', { userId: id }); if (!convs.some(x => x.id === c.id)) convs.push(c); select(c.id); } catch (e) { toast(api.errorText(e), 'err'); } }
    };
    async function reachable() {
      const classes = await api.get('/classrooms'), out = new Map();
      for (const c of classes) {
        const d = await api.get(`/classrooms/${c.id}`);
        for (const m of d.members) {
          if (m.userId === me.id) continue;
          if (me.role === 'student' && m.role === 'student' && !d.settings.allowStudentDirectMessages) continue;
          if (!out.has(m.userId)) out.set(m.userId, { ...m, classes: [] });
          out.get(m.userId).classes.push(c.name);
        }
      }
      return [...out.values()].sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName) : a.role === 'teacher' ? -1 : 1));
    }

    paintList();
    const start = ctx.params.id && convs.some(c => c.id === ctx.params.id) ? ctx.params.id : (convs.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0] || {}).id;
    if (start) select(start); else thread.innerHTML = empty('message', tl('Aucune discussion'), tl('Les discussions de vos classes et de vos groupes apparaîtront ici.'));
    return () => offs.forEach(off => off());
  });
}
