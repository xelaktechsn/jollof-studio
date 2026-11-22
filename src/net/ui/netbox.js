// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fenêtre « Synchroniser avec NetBox » (chargée à la demande) : openNetbox(ctx). À gauche, le serveur (adresse, jeton
// rangé par l'application de bureau dans le trousseau du système, vérification TLS, autorité PEM, test de connexion) ;
// à droite, la synchronisation : sens (envoyer vers NetBox / importer depuis NetBox), site, comparaison (lecture seule),
// tableau des différences (objet, champ, projet, NetBox, action, case à cocher), puis application avec progression et
// annulation, résumé et liste des erreurs. Avant le premier envoi vers un serveur : accord explicite de l'utilisateur.
// Le transport (HTTP, jeton) vit dans Rust (src-tauri/src/netbox.rs) : la version web montre un état « application de
// bureau seulement ». Un import se termine par UN seul ctx.commit() (annulable par Ctrl+Z).
import './crimp.css';
import './netbox.css';
import { tl, isEn, CANCEL } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { overlay } from './crimp.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const desktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const KIND = () => ({ site: tl('Site'), location: tl('Lieu'), manufacturer: tl('Fabricant'), role: tl('Rôle d’équipement'), dtype: tl('Type d’équipement'), rack: tl('Baie'), vlan: 'VLAN', prefix: tl('Préfixe IP'), device: tl('Équipement'), rearport: tl('Port arrière'), frontport: tl('Port avant'), interface: tl('Interface'), cable: tl('Câble'), ip: tl('Adresse IP') });
const OPS = () => ({ create: tl('Créer sur NetBox'), update: tl('Mettre à jour'), delete: tl('Supprimer de NetBox'), import: tl('Ajouter au projet') });
const nf = v => Number(v).toLocaleString(isEn ? 'en' : 'fr-FR');

/** Pont vers Rust (commandes nb_*) : les erreurs arrivent en { kind, status, message, fields }. */
async function makeBridge() {
  const { invoke } = await import('@tauri-apps/api/core');
  const call = async (cmd, args) => { try { return await invoke(cmd, args); } catch (e) { const err = new Error((e && e.message) || String(e)); Object.assign(err, typeof e === 'object' && e ? e : {}); if (err.kind === 'cancel') err.name = 'AbortError'; throw err; } };
  return {
    settings: () => call('nb_settings'),
    configure: a => call('nb_configure', a),
    consent: url => call('nb_consent', { url }),
    status: () => call('nb_status'),
    get: (path, query = [], max) => call('nb_get', { path, query, max: max ?? null }),
    write: (method, path, body) => call('nb_write', { method, path, body: body ?? null }),
    cancel: () => call('nb_cancel').catch(() => {})
  };
}

/** Ouvre la fenêtre. ctx : contexte des vues du module réseau (data, commit, status…). */
export function openNetbox(ctx) {
  const layer = document.createElement('div'); layer.className = 'ntNbLayer'; document.body.appendChild(layer);
  const O = overlay(layer, { label: tl('Synchroniser avec NetBox'), cls: 'ntNbOv' }), { dlg } = O;
  dlg.classList.add('ntNb');
  const S = { dir: 'push', settings: null, status: null, sites: null, siteId: '', deletes: false, P: null, result: null, busy: false, err: '', ca: undefined, table: null, errTable: null };
  let NB = null, mods = null, alive = true;
  const load = async () => mods || (mods = { nb: await import('../interop/netbox.js'), sync: await import('../interop/dcimsync.js'), kit: await import('./kit/index.js') });

  dlg.innerHTML = `<div class="nt-hd">${icon('dcimSync')}<div class="nt-ttl"><b>${esc(tl('Synchroniser avec NetBox'))}</b><span>${esc(tl('Inventaire DCIM / IPAM : sites, lieux, baies, équipements, ports, câbles, VLAN, préfixes, adresses'))}</span></div>
    <button class="nt-x" data-nb="close" aria-label="${esc(tl('Fermer'))}" title="${esc(tl('Fermer'))}">${icon('x')}</button></div>
    <div class="ntNbBody"><aside class="ntNbSide"></aside><section class="ntNbMain"></section></div>`;
  const $ = s => dlg.querySelector(s), side = $('.ntNbSide'), main = $('.ntNbMain');
  function close() {
    if (!alive) return; alive = false;
    if (S.busy && NB) NB.cancel();
    if (S.table) S.table.destroy(); if (S.errTable) S.errTable.destroy();
    window.removeEventListener('keydown', onKey, true); O.close(); layer.remove();
  }
  function onKey(e) { if (e.key === 'Escape' && !dlg.querySelector('.ntNbAsk')) { e.preventDefault(); e.stopPropagation(); close(); } }
  window.addEventListener('keydown', onKey, true);
  dlg.addEventListener('click', e => { const b = e.target.closest('[data-nb]'); if (b && b.dataset.nb === 'close') close(); });
  O.ov.addEventListener('pointerdown', e => { if (e.target === O.ov && !S.busy) close(); });

  /* ---------- Version web : rien à régler ici ---------- */
  if (!desktop()) {
    side.remove(); dlg.classList.add('web');
    main.innerHTML = `<div class="ntNbWeb">${icon('monitor')}<h3>${esc(tl('Application de bureau seulement'))}</h3>
      <p>${esc(tl('La synchronisation avec NetBox passe par l’application de bureau de Jollof Studio : elle seule peut joindre votre serveur sans les limites du navigateur, et ranger le jeton d’API dans le trousseau du système (il ne quitte jamais l’application).'))}</p>
      <p class="mut">${esc(tl('Ouvrez ce projet dans l’application de bureau, puis Documents ▸ Synchroniser avec NetBox…'))}</p>
      <button type="button" class="btn" data-nb="close">${esc(tl('Fermer'))}</button></div>`;
    requestAnimationFrame(() => dlg.focus());
    return { close };
  }

  /* ---------- Réglages du serveur ---------- */
  function paintSide() {
    const st = S.settings || {}, ok = S.status;
    const store = st.store === 'keyring' ? tl('Jeton enregistré dans le trousseau du système') : st.store === 'file' ? tl('Jeton enregistré dans un fichier privé (trousseau indisponible)') : '';
    side.innerHTML = `<h4>${icon('server')}<span>${esc(tl('Serveur NetBox'))}</span></h4>
      <label class="field"><span>${esc(tl('Adresse du serveur'))}</span><input data-f="url" type="url" spellcheck="false" autocomplete="off" placeholder="https://netbox.example.org" value="${esc(st.url || '')}"></label>
      <label class="field"><span>${esc(tl('Jeton d’API'))}</span><input data-f="token" type="password" spellcheck="false" autocomplete="off" placeholder="${esc(st.hasToken ? tl('•••••• (enregistré ; laisser vide pour le garder)') : tl('nbt_… ou jeton v1'))}"></label>
      ${store ? `<p class="ntNbNote ok">${icon('key')}<span>${esc(store)}</span></p>` : ''}
      <label class="ntNbChk"><input type="checkbox" data-f="verify" ${st.verify !== false ? 'checked' : ''}><span>${esc(tl('Vérifier le certificat TLS'))}</span></label>
      ${st.verify === false ? `<p class="ntNbNote warn">${icon('alert')}<span>${esc(tl('Vérification désactivée : n’importe quel serveur sur le chemin peut se faire passer pour NetBox et lire le jeton. À réserver à un serveur de test au certificat auto-signé ; préférez ajouter son autorité.'))}</span></p>` : ''}
      <div class="ntNbCa"><button type="button" class="btn" data-nb="ca">${icon('attach')}<span>${esc(tl('Autorité de certification (PEM)…'))}</span></button>
        <span class="mut">${esc(S.ca === '' ? tl('retirée à l’enregistrement') : S.ca ? tl('nouvelle, à enregistrer') : st.hasCa ? tl('ajoutée') : tl('aucune'))}</span>${st.hasCa || S.ca ? `<button type="button" class="tb" data-nb="caX" aria-label="${esc(tl('Retirer l’autorité'))}" title="${esc(tl('Retirer l’autorité'))}">${icon('x')}</button>` : ''}</div>
      <label class="ntNbChk"><input type="checkbox" data-f="http" ${st.allowHttp ? 'checked' : ''}><span>${esc(tl('Autoriser http (non chiffré)'))}</span></label>
      <div class="ntNbRow"><button type="button" class="btn" data-nb="save">${icon('save')}<span>${esc(tl('Enregistrer'))}</span></button>
        <button type="button" class="btn primary" data-nb="test" ${st.url ? '' : 'disabled'}>${icon('ping')}<span>${esc(tl('Tester la connexion'))}</span></button></div>
      <div class="ntNbStatus" aria-live="polite">${ok ? `<p class="ntNbNote ok">${icon('check')}<span>${esc(tl('Connecté : NetBox {0}', ok.full || ok.version))}${ok.caps && !ok.caps.tested ? `<br><small>${esc(tl('Version non essayée : écrit pour NetBox 4.4 à 4.7.'))}</small>` : ''}</span></p>
        <dl><dt>${esc(tl('Chiffrement'))}</dt><dd>${esc(ok.tls ? tl('https, certificat vérifié') : String(ok.url || '').startsWith('https') ? tl('https, certificat NON vérifié') : tl('http, non chiffré'))}</dd>
        <dt>${esc(tl('Greffons'))}</dt><dd>${nf(ok.plugins || 0)}</dd>${ok.hostname ? `<dt>${esc(tl('Hôte'))}</dt><dd>${esc(ok.hostname)}</dd>` : ''}</dl>` : S.err ? `<p class="ntNbNote bad">${icon('alert')}<span>${esc(S.err)}</span></p>` : ''}</div>
      <p class="ntNbFine">${esc(tl('Le jeton n’est jamais écrit dans le projet ni renvoyé à l’interface. Droits utiles sur NetBox : lecture et écriture des objets DCIM et IPAM ; pour l’identifiant stable, création du champ personnalisé « jollof_id » et de l’étiquette « jollof-studio » (sinon, correspondance par les noms).'))}</p>`;
  }
  const field = k => side.querySelector(`[data-f="${k}"]`);
  async function save(quiet) {
    const token = field('token').value.trim();
    try {
      S.settings = await NB.configure({ url: field('url').value.trim(), verify: field('verify').checked, allowHttp: field('http').checked, ca: S.ca === undefined ? null : S.ca, token: token ? token : null });
      S.ca = undefined; S.err = ''; S.status = null; S.sites = null;
      if (!quiet) ctx.status(tl('Réglages NetBox enregistrés.'), 'ok');
      return true;
    } catch (e) { S.err = e.message; return false; } finally { paintSide(); paintMain(); }
  }
  async function testConn() {
    if (!(await save(true))) return;
    const { nb } = await load();
    try {
      const { status, caps } = await nb.connect(NB);
      S.status = { ...status, caps }; S.err = '';
      S.sites = await nb.listSites(NB).catch(() => null);
    } catch (e) { S.status = null; S.err = e.message; }
    paintSide(); paintMain();
  }
  side.addEventListener('click', e => {
    const b = e.target.closest('[data-nb]'); if (!b) return;
    if (b.dataset.nb === 'save') save(false);
    else if (b.dataset.nb === 'test') testConn();
    else if (b.dataset.nb === 'caX') { S.ca = ''; paintSide(); }
    else if (b.dataset.nb === 'ca') {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pem,.crt,.cer,application/x-pem-file';
      inp.onchange = async () => { const f = inp.files && inp.files[0]; if (!f) return; if (f.size > 256 << 10) { S.err = tl('Fichier d’autorité trop gros.'); paintSide(); return; } S.ca = await f.text(); paintSide(); };
      inp.click();
    }
  });
  side.addEventListener('change', e => { if (e.target.matches('[data-f="verify"], [data-f="http"]')) { S.settings = { ...(S.settings || {}), verify: field('verify').checked, allowHttp: field('http').checked }; const url = field('url').value, tok = field('token').value; paintSide(); field('url').value = url; field('token').value = tok; } });

  /* ---------- Synchronisation ---------- */
  const siteName = () => { const d = ctx.data(); return (d.site && d.site.name) || ''; };
  function paintMain() {
    if (S.table) { S.table.destroy(); S.table = null; }
    if (S.errTable) { S.errTable.destroy(); S.errTable = null; }
    const ready = !!S.status, push = S.dir === 'push';
    const sites = S.sites || [];
    const own = sites.find(s => s.slug === (mods ? mods.sync.slugify(siteName() || 'Jollof') : ''));
    const opts = push
      ? `<option value="">${esc(own ? tl('Site du même nom : {0}', own.name) : tl('Nouveau site : {0}', siteName() || 'Jollof'))}</option>${sites.filter(s => s !== own).map(s => `<option value="${s.id}" ${String(S.siteId) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`
      : sites.map(s => `<option value="${s.id}" ${String(S.siteId) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('') || `<option value="">${esc(tl('Aucun site sur ce serveur'))}</option>`;
    main.innerHTML = `<div class="ntNbBar">
        <div class="seg" role="group" aria-label="${esc(tl('Sens'))}">
          <button type="button" class="segBtn" aria-pressed="${push}" data-nb="dir:push">${icon('upload')}<span>${esc(tl('Envoyer vers NetBox'))}</span></button>
          <button type="button" class="segBtn" aria-pressed="${!push}" data-nb="dir:pull">${icon('download')}<span>${esc(tl('Importer depuis NetBox'))}</span></button></div>
        <label class="ntNbSite"><span>${esc(tl('Site NetBox'))}</span><select data-f="site" ${ready && sites.length + (push ? 1 : 0) ? '' : 'disabled'}>${opts}</select></label>
        ${push ? `<label class="ntNbChk"><input type="checkbox" data-f="deletes" ${S.deletes ? 'checked' : ''}><span>${esc(tl('Proposer les suppressions'))}</span></label>` : ''}
</div>
      <div class="ntNbView"></div>
      <div class="ntNbFoot"><span class="ntNbSum" aria-live="polite"></span><span class="grow"></span>
        <button type="button" class="btn ${S.P ? '' : 'primary'}" data-nb="plan" ${ready && !S.busy ? '' : 'disabled'}>${icon('search')}<span>${esc(S.P ? tl('Comparer de nouveau') : tl('Comparer'))}</span></button>
        <button type="button" class="btn primary" data-nb="apply" disabled>${icon('check')}<span></span></button></div>`;
    const view = main.querySelector('.ntNbView');
    if (!ready) {
      view.innerHTML = `<div class="ntNbEmpty">${icon('dcimSync')}<p>${esc(tl('Réglez le serveur à gauche, puis « Tester la connexion ».'))}</p><p class="mut">${esc(tl('Envoyer : le projet devient la référence (créations et mises à jour sur NetBox ; aucune suppression sans votre accord). Importer : les objets d’un site NetBox entrent dans ce projet (annulable par Ctrl+Z).'))}</p></div>`;
      return paintFoot();
    }
    if (S.result) return paintResult(view);
    if (!S.P) { view.innerHTML = `<div class="ntNbEmpty">${icon('search')}<p>${esc(push ? tl('« Comparer » lit le site sur NetBox et montre ce qui serait créé ou modifié. Rien n’est écrit avant « Appliquer ».') : tl('« Comparer » lit le site choisi et montre ce qui entrerait dans le projet. Rien ne change avant « Appliquer ».'))}</p></div>`; return paintFoot(); }
    paintTable(view);
  }
  function show(v, P) {
    if (v == null || v === '') return '—';
    if (Array.isArray(v)) return v.length ? v.map(x => show(x, P)).join(', ') : '—';
    if (typeof v === 'object') {
      if ('$' in v) { const k = v.$, o = P.ours.objs.get(k) || P.M.theirs.get(k); return o ? o.label : k; }
      return '';
    }
    if (typeof v === 'boolean') return v ? tl('oui') : tl('non');
    return String(v);
  }
  function paintTable(view) {
    const { kit } = mods, P = S.P, K = KIND(), OP = OPS();
    const summary = r => (r.op === 'create' ? tl('nouvel objet') : r.op === 'import' ? tl('absent du projet') : r.op === 'delete' ? tl('retiré du projet') : show(r.ours, P));
    const theirs = r => (r.op === 'create' ? tl('absent de NetBox') : r.op === 'import' ? tl('sur NetBox') : r.op === 'delete' ? tl('créé par Jollof Studio') : show(r.theirs, P));
    const cols = [
      { key: 'accept', label: '✓', width: '34px', value: r => (r.accept ? 0 : 1), html: r => `<input type="checkbox" data-rid="${esc(r.rid)}" ${r.accept ? 'checked' : ''} aria-label="${esc(tl('Appliquer cette ligne'))}">`, text: () => '' },
      { key: 'kind', label: tl('Type'), width: 'minmax(110px, 0.8fr)', value: r => K[r.kind] || r.kind },
      { key: 'label', label: tl('Objet'), width: 'minmax(170px, 1.6fr)', title: r => r.label },
      { key: 'field', label: tl('Champ'), width: 'minmax(90px, 0.7fr)', value: r => r.field || '—', html: r => (r.field ? `<code>${esc(r.field)}</code>` : '—') },
      { key: 'ours', label: tl('Projet'), width: 'minmax(120px, 1.2fr)', value: summary, title: summary },
      { key: 'theirs', label: 'NetBox', width: 'minmax(120px, 1.2fr)', value: theirs, title: theirs },
      { key: 'op', label: tl('Action'), width: 'minmax(120px, 0.9fr)', value: r => OP[r.op], html: r => `<span class="ntNbOp ${r.op}">${esc(OP[r.op])}</span>` }
    ];
    const tools = `<button type="button" class="tb" data-nb="all">${icon('checklist')}<span>${esc(tl('Tout cocher'))}</span></button><button type="button" class="tb" data-nb="none">${icon('minus')}<span>${esc(tl('Tout décocher'))}</span></button>`;
    const notes = [];
    if (S.dir === 'push' && P.meta) {
      if (!P.meta.cf || (P.meta.cfTypesMissing || []).length) notes.push(tl('Le champ personnalisé « jollof_id » sera créé ou complété sur NetBox (identifiant stable des objets) ; sans ce droit, la correspondance se fera par les noms.'));
      if (P.meta.tagId == null) notes.push(tl('L’étiquette « jollof-studio » sera créée et posée sur les objets créés.'));
    }
    const skip = (P.warnings || []).find(w => w.code === 'cableSkip');
    if (skip) notes.push(tl('{0:# câble|# câbles} vers des cartes du montage électronique ne sont pas envoyés.', skip.n));
    view.innerHTML = `${notes.length ? `<div class="ntNbNotes">${notes.map(n => `<p class="ntNbNote info">${icon('info')}<span>${esc(n)}</span></p>`).join('')}</div>` : ''}<div class="ntNbTbl"></div>`;
    if (!P.rows.length) { view.querySelector('.ntNbTbl').innerHTML = `<div class="ntNbEmpty">${icon('check')}<p>${esc(S.dir === 'push' ? tl('NetBox est déjà à jour : aucune différence avec le projet.') : tl('Rien à importer : le projet contient déjà ce site.'))}</p></div>`; return paintFoot(); }
    S.table = kit.createTable(view.querySelector('.ntNbTbl'), {
      columns: cols, rows: P.rows, rowKey: r => r.rid, tools, label: tl('Différences'), placeholder: tl('Filtrer (type:câble, op:…)'),
      onActivate: (r, ev) => { if (ev && ev.target && ev.target.tagName === 'INPUT') r.accept = ev.target.checked; else r.accept = !r.accept; S.table.refresh(); paintFoot(); }
    });
    S.table.el.addEventListener('click', e => {
      const b = e.target.closest('[data-nb="all"], [data-nb="none"]'); if (!b) return;
      const on = b.dataset.nb === 'all', shown = new Set(S.table.rows().map(r => r.rid));
      for (const r of P.rows) if (shown.has(r.rid)) r.accept = on;
      S.table.refresh(); paintFoot();
    });
    paintFoot();
  }
  function paintFoot() {
    const sum = main.querySelector('.ntNbSum'), btn = main.querySelector('[data-nb="apply"]'); if (!sum || !btn) return;
    if (!S.P || S.result || !S.P.rows.length) { sum.textContent = ''; btn.hidden = true; return; }
    const c = mods.sync.counts(S.P.rows);
    const parts = S.dir === 'push' ? [[c.create, '{0:création|créations}'], [c.update, '{0:mise à jour|mises à jour}'], [c.delete, '{0:suppression|suppressions}']] : [[c.import, '{0:ajout au projet|ajouts au projet}'], [c.update, '{0:mise à jour|mises à jour}']];
    sum.innerHTML = `${parts.map(([n, t]) => `<b>${nf(n)}</b> ${esc(tl(t, n))}`).join(' · ')} <span class="mut">${esc(tl('({0} lignes)', nf(S.P.rows.length)))}</span>`;
    btn.hidden = !S.P.rows.length; btn.disabled = S.busy || !c.objects;
    btn.querySelector('span').textContent = S.dir === 'push' ? tl('Envoyer {0:# objet|# objets}', nf(c.objects)) : tl('Importer {0:# objet|# objets}', nf(c.objects));
  }
  function paintResult(view) {
    const R = S.result, { kit } = mods, K = KIND();
    const push = R.dir === 'push';
    const line = push ? tl('{0:# créé|# créés}, {1} mis à jour, {2:# supprimé|# supprimés} sur NetBox.', nf(R.created || 0), nf(R.updated || 0), nf(R.deleted || 0))
      : tl('{0:# objet ajouté|# objets ajoutés} au projet, {1:# champ|# champs} repris. Ctrl+Z annule l’import.', nf(Object.values(R.created || {}).reduce((s, n) => s + n, 0)), nf(R.updated || 0));
    const errs = push ? R.errors || [] : (R.skipped || []).map(s => ({ kind: '', label: s.label, message: { parent: tl('lieu parent absent'), noVlan: tl('préfixe sans VLAN : ignoré'), ends: tl('extrémité inconnue dans le projet'), busy: tl('port déjà câblé'), ip: tl('interface sans adresse possible'), field: tl('champ non repris') }[s.why] || s.why }));
    const notes = (R.notes || []).map(n => (typeof n === 'string' ? n : n.code)).map(c => ({ cfPerm: tl('Champ personnalisé « jollof_id » non créé (droit refusé) : les objets seront retrouvés par leur nom.'), tagPerm: tl('Étiquette « jollof-studio » non créée (droit refusé).'), roomsNoGeometry: tl('Pièces importées sans géométrie : carrés de 4 m rangés sur l’étage, à redessiner dans la vue Plans.') }[c] || c));
    view.innerHTML = `<div class="ntNbResult"><p class="ntNbNote ${errs.length ? 'warn' : 'ok'}">${icon(errs.length ? 'alert' : 'check')}<span><b>${esc(R.cancelled ? tl('Interrompu.') : tl('Terminé.'))}</b> ${esc(line)}</span></p>
      ${notes.map(n => `<p class="ntNbNote info">${icon('info')}<span>${esc(n)}</span></p>`).join('')}
      ${errs.length ? `<h4>${esc(tl('{0:# erreur ou objet laissé|# erreurs ou objets laissés} de côté', nf(errs.length)))}</h4><div class="ntNbTbl"></div>` : ''}
</div>`;
    if (errs.length) S.errTable = kit.createTable(view.querySelector('.ntNbTbl'), {
      label: tl('Erreurs'), rows: errs.map((e, i) => ({ ...e, id: i })),
      columns: [
        { key: 'kind', label: tl('Type'), width: 'minmax(100px, 0.6fr)', value: e => K[e.kind] || e.kind || '—' },
        { key: 'label', label: tl('Objet'), width: 'minmax(150px, 1fr)', title: e => e.label },
        { key: 'message', label: tl('Message'), width: 'minmax(260px, 2.6fr)', value: e => e.message + ((e.fields || []).length ? ' — ' + e.fields.map(f => (f.field ? f.field + ' : ' : '') + f.msg).join(' ; ') : ''), title: e => e.message }
      ]
    });
    paintFoot();
  }
  main.addEventListener('change', e => {
    if (e.target.matches('[data-f="site"]')) { S.siteId = e.target.value; S.P = null; S.result = null; paintMain(); }
    else if (e.target.matches('[data-f="deletes"]')) { S.deletes = e.target.checked; S.P = null; paintMain(); }
  });
  main.addEventListener('click', e => {
    const b = e.target.closest('[data-nb]'); if (!b || b.disabled) return;
    const a = b.dataset.nb;
    if (a.startsWith('dir:')) { S.dir = a.slice(4); S.P = null; S.result = null; if (S.dir === 'pull' && !S.siteId && S.sites && S.sites[0]) S.siteId = String(S.sites[0].id); paintMain(); }
    else if (a === 'plan') doPlan();
    else if (a === 'apply') doApply();
  });

  async function doPlan() {
    const { nb, kit } = await load();
    if (S.dir === 'pull' && !S.siteId) return;
    S.busy = true; S.result = null; paintMain();
    try {
      S.P = await kit.task(tl('Lecture de NetBox'), async t => {
        t.signal.addEventListener('abort', () => NB.cancel());
        return nb.plan(NB, ctx.data(), { dir: S.dir, siteId: S.siteId ? +S.siteId : null, deletes: S.deletes, caps: S.status.caps, siteName: siteName(), signal: t.signal, progress: (f, k) => t.progress(f, k ? (KIND()[k] || k) : '') });
      }, { cancel: true, done: false });
    } catch (e) { if (e.name !== 'AbortError') S.err = e.message; }
    S.busy = false; if (alive) paintMain();
  }
  /** Accord avant le premier envoi vers ce serveur (gardé par l'application de bureau, par adresse). */
  function askConsent(url) {
    return new Promise(res => {
      const box = document.createElement('div'); box.className = 'ntNbAsk'; box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true');
      box.innerHTML = `<div class="ntNbAskBox"><h3>${icon('send')}<span>${esc(tl('Envoyer les données du projet ?'))}</span></h3>
        <p>${esc(tl('Cette opération envoie des données du projet (noms des lieux et des équipements, baies, ports, câbles, VLAN, préfixes et adresses IP) au serveur que vous avez réglé :'))}</p>
        <p class="ntNbUrl"><code>${esc(url)}</code></p>
        <p class="mut">${esc(tl('Elles y seront visibles par les utilisateurs de ce serveur. Cette question n’est posée qu’une fois par serveur.'))}</p>
        <div class="ntNbRow"><span class="grow"></span><button type="button" class="btn" data-a="no">${esc(CANCEL)}</button><button type="button" class="btn primary" data-a="yes">${esc(tl('J’accepte, envoyer'))}</button></div></div>`;
      dlg.appendChild(box);
      const done = v => { box.remove(); res(v); };
      box.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) done(b.dataset.a === 'yes'); });
      box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } });
      box.querySelector('[data-a="no"]').focus();
    });
  }
  async function doApply() {
    const { nb, kit } = await load(), P = S.P; if (!P) return;
    if (S.dir === 'pull') {
      const r = nb.pull(ctx.data(), P); ctx.commit();
      S.result = { dir: 'pull', ...r }; S.P = null;
      ctx.status(tl('Import NetBox : {0:# objet ajouté|# objets ajoutés}.', nf(Object.values(r.created).reduce((s, n) => s + n, 0))), 'ok');
      return paintMain();
    }
    S.settings = await NB.settings();
    if (!S.settings.consented) { if (!(await askConsent(S.settings.url))) return; await NB.consent(S.settings.url); S.settings.consented = true; }
    S.busy = true; paintFoot();
    let r;
    try {
      r = await kit.task(tl('Envoi vers NetBox'), async t => {
        t.signal.addEventListener('abort', () => NB.cancel());
        return nb.push(NB, P, { signal: t.signal, progress: f => t.progress(f) });
      }, { cancel: true, done: false });
    } catch (e) { r = { created: 0, updated: 0, deleted: 0, errors: e.name === 'AbortError' ? [] : [{ kind: '', label: '—', message: e.message, fields: e.fields || [] }], cancelled: e.name === 'AbortError' }; }
    S.busy = false; S.result = { dir: 'push', ...r }; S.P = null;
    if (alive) paintMain();
  }

  /* ---------- Démarrage ---------- */
  side.innerHTML = `<p class="mut">${esc(tl('Chargement…'))}</p>`;
  makeBridge().then(async b => {
    NB = b;
    try { S.settings = await NB.settings(); } catch (e) { S.settings = {}; S.err = e.message; }
    await load();
    paintSide(); paintMain();
    if (S.settings.url && S.settings.hasToken) testConn();
    requestAnimationFrame(() => { const i = field('url'); if (i && !i.value) i.focus(); else dlg.focus(); });
  });
  return { close };
}
