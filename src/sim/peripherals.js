// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Section « Périphériques » de l'onglet Simulation : pour chaque module relié à une carte, de quoi agir comme dans
// la vraie vie. Télécommande infrarouge (récepteur VS1838B), badges RFID (lecteur RC522), clavier 4×4, téléphone
// Bluetooth (HC-05, ou BluetoothSerial de l'ESP32), téléphone GSM (SIM800), et pour les cartes Wi-Fi : le réseau Wi-Fi
// simulé, un navigateur vers leurs serveurs web et le journal des mesures envoyées à journal.jollof.
// Ce que fait l'élève passe par l'état partagé du composant (models.js : periph, serialDevice), que lit la bibliothèque
// simulée dans le programme de la carte (prog/runtime.js) : un appui n'arrive qu'à la carte câblée au module, et
// seulement si le module est bien alimenté.
import './peripherals.css';
import { tl, quote } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { firstMsg } from './circuit.js';
import { boardOf, kindOf, BOARDS } from './boards.js';
import {
  IR_KEYS, BADGES, KEYPAD_KEYS, PHONE, FAKE_HOSTS, hex2, periph, irPress, presentBadge, keypadDown, keypadUp, serialDevice, btSerial,
  macOf, cleanHtml, parseUrl, parseQuery, fakeHttp
} from './models.js';

const TYPES = ['ir', 'rc522', 'keypad', 'hc05', 'sim800'];
const RESET = [...TYPES, 'nrf24'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Caractères invisibles d'une liaison série rendus lisibles (\r, \x1a…). */
const shown = s => String(s).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, c => (c === '\r' ? '' : `\\x${hex2(c.charCodeAt(0))}`));
const phoneText = n => n.replace(/^\+221(\d{2})(\d{3})(\d{2})(\d{2})$/, '+221 $1 $2 $3 $4');
const REPEAT_MS = 110; // trame de répétition NEC tant que la touche reste enfoncée
const WAIT_MS = 8000; // le navigateur abandonne une page qui ne vient pas
const isWifiBoard = c => !!BOARDS[c.type] && ['esp32', 'esp32s3', 'esp32c3', 'nodemcu'].includes(kindOf(c));
const FIELD_COLORS = ['#e0703a', '#5b9cf5', '#3fb27f', '#f2c94c'];

/**
 * app : { comps(), simOn(), ins() → Map composant → inspection du câblage (circuit.js), net() → réseau simulé du
 * projet { networks, journal }, netChanged() }. La section se place sous « Mesures » et se met à jour d'elle-même.
 */
export function installPeripherals(app) {
  let sec = null, list = null, sig = '', wasOn = false, hold = null;
  const vers = new Map(), byId = id => app.comps().find(c => c.id === id);
  const net = () => (app.net ? app.net() : { networks: [], journal: [] });
  // Navigateur : serveur choisi, chemin affiché, requête en cours, dernière page reçue.
  const nav = { board: null, path: '/', req: null, t0: 0, status: '', page: null, pageVer: 0, shown: -1, hops: 0, auto: new Set() };

  function mount() {
    if (sec) return true;
    const after = document.getElementById('probeSec'); if (!after) return false;
    after.insertAdjacentHTML('afterend', `<section id="periphSec" data-fold="periph" hidden><h2>${icon('radio')}${tl('Périphériques')}</h2><ul class="probes periphs" id="periphs"></ul></section>`);
    sec = document.getElementById('periphSec'); list = document.getElementById('periphs');
    bind();
    return true;
  }

  /* ---------- Cartes : contenu ---------- */
  const WHAT = {
    ir: tl('Télécommande infrarouge : chaque touche envoie une trame NEC au récepteur.'),
    rc522: tl('Posez un badge sur le lecteur (cliquez à nouveau pour le retirer).'),
    keypad: tl('Appuyez sur les touches comme sur le vrai clavier.'),
    hc05: tl('Téléphone relié en Bluetooth : ce que vous écrivez arrive sur la broche RX de la carte.'),
    sim800: tl('Téléphone {0} : il reçoit les SMS du module et peut lui en envoyer.', phoneText(PHONE)),
    bt: tl('Téléphone connecté au Bluetooth de la carte (SerialBT) : ce que vous écrivez arrive dans SerialBT.read().'),
    wifi: tl('Réseaux visibles par les cartes Wi-Fi. Aucun accès à Internet : seuls meteo.jollof, journal.jollof et heure.jollof répondent.'),
    web: tl('Pages servies par les cartes (WebServer). Les liens et formulaires deviennent des requêtes au programme, traitées à son prochain server.handleClient().'),
    journal: tl('Mesures reçues par journal.jollof/update?field1=…')
  };
  const chatForm = n => `<ol class="chatLog" aria-live="polite" aria-label="${tl('Conversation avec {0}', n)}"></ol>
    <form class="chatForm"><input type="text" class="chatIn" maxlength="200" autocomplete="off" aria-label="${tl('Message à envoyer à la carte')}" placeholder="${tl('Message…')}">
    <select class="chatEol" aria-label="${tl('Fin de ligne ajoutée au message')}"><option value="n">\\n</option><option value="rn">\\r\\n</option><option value="">${tl('aucune')}</option></select>
    <button type="submit" class="btn small">${icon('send')}<span>${tl('Envoyer')}</span></button></form>`;
  function body(it) {
    const c = it.c, n = esc(c ? c.name : '');
    switch (it.kind) {
      case 'ir': return `<div class="irRemote" role="group" aria-label="${tl('Télécommande de {0}', n)}">${IR_KEYS.map(k => `<button type="button" class="irKey${k.cmd === 0x45 || k.cmd === 0x46 || k.cmd === 0x47 ? ' ch' : ''}" data-ir="${k.cmd}" aria-label="${tl('Touche {0} (commande 0x{1})', esc(k.name), hex2(k.cmd))}">${esc(k.label)}</button>`).join('')}</div><p class="pxLast" aria-live="polite"></p>`;
      case 'rc522': return `<div class="rfBadges" role="group" aria-label="${tl('Badges RFID')}">${BADGES.map((b, i) => `<button type="button" class="rfBadge" data-badge="${i}" aria-pressed="false"><i style="background:${b.color}"></i><span>${esc(b.label)}</span><code>${b.uid.map(hex2).join(' ')}</code></button>`).join('')}</div><p class="pxLast" aria-live="polite"></p>`;
      case 'keypad': return `<div class="kpGrid" role="group" aria-label="${tl('Clavier 4×4 de {0}', n)}">${KEYPAD_KEYS.map((row, r) => [...row].map((k, col) => `<button type="button" class="kpKey${/[A-D]/.test(k) ? ' let' : /[*#]/.test(k) ? ' sym' : ''}" data-r="${r}" data-c="${col}" aria-label="${tl('Touche {0}', k)}">${k}</button>`).join('')).join('')}</div>`;
      case 'hc05': return `<p class="pxNote" data-mode></p>${chatForm(n)}`;
      case 'bt': return chatForm(esc(it.b.name));
      case 'sim800': return `<div class="gsmCall" data-call hidden>${icon('bell')}<span></span><button type="button" class="btn small" data-hang>${tl('Raccrocher')}</button></div>
        <button type="button" class="btn small gsmRing" data-ring>${icon('bell')}<span>${tl('Appeler la carte')}</span></button>
        <ol class="smsList" aria-live="polite" aria-label="${tl('SMS reçus par le téléphone')}"></ol>
        <p class="pxHint warn" data-hint hidden>${tl('Le module a refusé AT+CMGS : envoyez d’abord AT+CMGF=1 (SMS en mode texte).')}</p>
        <form class="smsForm"><input type="text" class="smsIn" maxlength="160" autocomplete="off" aria-label="${tl('SMS à envoyer au module')}" placeholder="${tl('SMS pour le module…')}">
        <button type="submit" class="btn small">${icon('message')}<span>${tl('Envoyer le SMS')}</span></button></form>`;
      case 'wifi': {
        const school = net().networks[0] || { ssid: '', pass: '' };
        return `<form class="wifiForm" aria-label="${tl('Réseau Wi-Fi de l’école')}">
          <label>${tl('Nom du réseau (SSID)')}<input type="text" name="ssid" maxlength="32" autocomplete="off" value="${esc(school.ssid)}"></label>
          <label>${tl('Mot de passe')}<input type="text" name="pass" maxlength="63" autocomplete="off" value="${esc(school.pass)}"></label>
          <button type="submit" class="btn small">${icon('check')}<span>${tl('Enregistrer')}</span></button></form>
          <ul class="wifiList" data-nets></ul><ul class="wifiList" data-boards aria-live="polite"></ul>`;
      }
      case 'web': return `<form class="webBar" role="search" aria-label="${tl('Adresse de la page')}">
          <select data-server aria-label="${tl('Carte qui sert la page')}"></select>
          <input type="text" name="url" autocomplete="off" spellcheck="false" aria-label="${tl('Adresse')}">
          <button type="submit" class="btn small" aria-label="${tl('Charger la page')}">${icon('send')}</button>
          <button type="button" class="btn small" data-reload aria-label="${tl('Recharger la page')}">${icon('rotate')}</button></form>
        <p class="webStatus" aria-live="polite"></p>
        <iframe class="webView" sandbox="allow-same-origin allow-forms" referrerpolicy="no-referrer" title="${tl('Page servie par la carte')}"></iframe>`;
      case 'journal': return `<div class="jrnCharts" data-charts></div><button type="button" class="btn small" data-jclear>${icon('trash')}<span>${tl('Effacer le journal')}</span></button>`;
    }
    return '';
  }
  function head(it) {
    if (it.c) return esc(it.c.name);
    if (it.kind === 'bt') return esc(tl('Bluetooth {0}', quote(btSerial(it.b).st.name)));
    return esc({ wifi: tl('Réseau Wi-Fi'), web: tl('Navigateur'), journal: tl('Journal') }[it.kind]);
  }
  const card = it => `<li data-key="${esc(it.key)}" data-type="${it.kind}"><div class="ph"><span class="lv"></span><b>${head(it)}</b><span class="sig"></span></div><div class="pd">${WHAT[it.kind]}</div><div class="pm"></div><div class="pxBody">${body(it)}</div></li>`;

  /* ---------- Cartes : mise à jour ---------- */
  /** Conversation (HC-05, SerialBT) : messages de la carte à gauche, du téléphone à droite. */
  function renderChat(li, o, from) {
    const ol = li.querySelector('.chatLog'), end = ol.scrollTop + ol.clientHeight >= ol.scrollHeight - 6, who = esc(from || tl('Carte'));
    const msgs = o.log.map(m => `<li class="${m.who}"><small>${m.who === 'phone' ? tl('Téléphone') : who}</small>${esc(shown(m.text)) || '&nbsp;'}</li>`);
    if (o.line) msgs.push(`<li class="board part"><small>${who}</small>${esc(shown(o.line))}</li>`);
    ol.innerHTML = msgs.join('') || `<li class="none">${tl('Aucun message pour l’instant.')}</li>`;
    if (end) ol.scrollTop = ol.scrollHeight;
  }
  const level = (li, lvl, sigText, msg) => { if (li.className !== lvl) li.className = lvl; li.querySelector('.sig').textContent = sigText || ''; li.querySelector('.pm').textContent = msg || ''; };
  const once = (key, v) => { if (vers.get(key) === v) return false; vers.set(key, v); return true; };
  function updateModule(li, it) {
    const { c, ins } = it, lvl = ins.level === 'err' ? 'err' : ins.level === 'warn' ? 'warn' : 'ok', msg = firstMsg(ins, lvl === 'err' ? 'err' : 'warn');
    // Clavier : un fil manquant ne coupe que les touches de sa ligne ou de sa colonne.
    level(li, lvl, ins.board ? ins.board.name : '', msg ? `⚠ ${msg}${lvl === 'err' && c.type !== 'keypad' ? tl(' : le module ne fonctionne pas') : ''}` : '');
    const st = periph(c);
    if (!once(it.key, st.ver)) return;
    if (c.type === 'rc522') {
      li.querySelectorAll('[data-badge]').forEach(b => b.setAttribute('aria-pressed', String(st.card === +b.dataset.badge)));
      li.querySelector('.pxLast').textContent = st.card == null ? tl('Aucun badge sur le lecteur.') : tl('{0} posé sur le lecteur.', BADGES[st.card].label);
    }
    if (c.type === 'keypad') li.querySelectorAll('.kpKey').forEach(b => b.classList.toggle('on', !!st.down && st.down.r === +b.dataset.r && st.down.c === +b.dataset.c));
    if (c.type === 'hc05') {
      const dev = serialDevice(c), at = st.mode === 'at';
      li.querySelector('[data-mode]').textContent = at ? tl('Mode commandes AT (EN au niveau haut au démarrage) : 38400 bauds, téléphone déconnecté.') : tl('Nom Bluetooth : {0}', dev.name);
      li.querySelectorAll('.chatForm input, .chatForm button, .chatForm select').forEach(el => { el.disabled = at; });
      renderChat(li, st, ins.board && ins.board.name);
    }
    if (c.type === 'sim800') {
      const call = li.querySelector('[data-call]'), busy = !!(st.call || st.incoming);
      call.hidden = !busy; li.querySelector('[data-ring]').hidden = busy;
      if (busy) call.querySelector('span').textContent = st.incoming ? tl('Le téléphone appelle la carte… (sonnerie)') : st.call.dir === 'in' ? tl('Appel en cours : la carte a décroché') : tl('La carte appelle le {0}', phoneText(st.call.number));
      const ol = li.querySelector('.smsList');
      ol.innerHTML = st.sent.slice(-20).reverse().map(m => `<li><small>${tl('SMS de la carte pour {0}', esc(phoneText(m.to)))}</small>${esc(shown(m.text)) || '&nbsp;'}</li>`).join('') || `<li class="none">${tl('Aucun SMS reçu pour l’instant.')}</li>`;
      li.querySelector('[data-hint]').hidden = st.hint !== 'cmgf';
    }
  }
  /** État Wi-Fi d'une carte, en une ligne. */
  function wifiText(b) {
    const w = b.periph && b.periph.wifi, ap = w && w.ap ? tl(' · point d’accès {0} (192.168.4.1)', quote(w.ap.ssid)) : '';
    if (!w || (!w.mode && !w.want && !w.status)) return tl('Wi-Fi non utilisé par le programme');
    if (w.want) return tl('Connexion à {0}…', quote(w.want.ssid)) + ap;
    const s = { 3: tl('Connectée à {0} · {1} · {2} dBm', quote(w.ssid), w.ip, w.rssi), 4: tl('Mot de passe refusé par {0}', quote(w.tried || '')), 1: tl('Réseau {0} introuvable', quote(w.tried || '')), 5: tl('Connexion perdue') }[w.status];
    return (s || (ap ? '' : tl('Non connectée'))) + ap;
  }
  function updateWifi(li) {
    level(li, 'ok', '', '');
    const n = net(), boards = app.comps().filter(isWifiBoard);
    const key = JSON.stringify(n.networks) + boards.map(b => b.id + wifiText(b)).join('|');
    if (!once('wifi', key)) return;
    li.querySelector('[data-nets]').innerHTML = n.networks.slice(1).map(x => `<li>${icon('radio')}<span>${esc(x.ssid)}</span><small>${x.pass ? tl('protégé') : tl('ouvert')} · ${x.rssi} dBm</small></li>`).join('');
    li.querySelector('[data-boards]').innerHTML = boards.map(b => `<li class="brd">${icon('cpu')}<span><b>${esc(b.name)}</b> ${esc(wifiText(b))}</span><small>MAC ${macOf(b)}</small></li>`).join('');
  }
  /** Serveurs web en marche : carte et adresse où la joindre. */
  function servers() {
    const out = [];
    for (const b of app.comps()) {
      const st = b.periph, w = st && st.wifi;
      if (!st || !st.web || !st.web.on) continue;
      const host = w && w.status === 3 && w.ip ? w.ip : w && w.ap ? '192.168.4.1' : st.mdns ? st.mdns + '.local' : '';
      out.push({ b, host, port: st.web.port });
    }
    return out;
  }
  const hostPort = s => (s.port && s.port !== 80 ? `${s.host}:${s.port}` : s.host);
  function updateWeb(li) {
    level(li, 'ok', '', '');
    const list = servers(), cur = list.find(s => s.b.id === nav.board) || list[0];
    if (cur && nav.board !== cur.b.id) { nav.board = cur.b.id; nav.path = '/'; nav.page = null; nav.pageVer++; }
    // Premier serveur prêt (carte connectée) : sa page d'accueil s'ouvre une fois.
    if (cur && cur.host && !nav.page && !nav.req && !nav.auto.has(cur.b.id)) { nav.auto.add(cur.b.id); go('/'); }
    if (nav.req) {
      const r = nav.req;
      if (r.state === 'done') { nav.req = null; received(r); }
      else if (Date.now() - nav.t0 > WAIT_MS) { r.state = 'expired'; nav.req = null; nav.status = tl('Délai dépassé : le programme n’a pas répondu. Appelle-t-il server.handleClient() dans loop() ?'); }
      else nav.status = tl('En attente de {0}… (traitée au prochain server.handleClient())', cur ? cur.b.name : '');
    }
    const sel = li.querySelector('[data-server]'), opts = list.map(s => `<option value="${esc(s.b.id)}"${cur && s.b.id === cur.b.id ? ' selected' : ''}>${esc(s.b.name)}${s.host ? ' · ' + esc(hostPort(s)) : ''}</option>`).join('');
    if (once('web:opts', opts)) { sel.innerHTML = opts; sel.hidden = list.length < 2; }
    const url = li.querySelector('[name=url]');
    if (document.activeElement !== url) url.value = cur && cur.host ? `http://${hostPort(cur)}${nav.path}` : '';
    li.querySelector('.webStatus').textContent = !cur ? tl('Aucun serveur web en marche (server.begin()).') : !cur.host ? tl('{0} n’est connectée à aucun réseau : personne ne peut joindre son serveur.', cur.b.name) : nav.status;
    if (nav.shown !== nav.pageVer) {
      nav.shown = nav.pageVer;
      const fr = li.querySelector('.webView'), p = nav.page;
      // Frontière de sécurité : la page de l'élève passe par cleanHtml (aucun script, aucune adresse extérieure) et
      // s'affiche dans un cadre sans scripts (sandbox sans allow-scripts) ; liens et formulaires sont détournés (routed).
      fr.srcdoc = !p ? '' : /html/i.test(p.type) ? routed(cleanHtml(p.body)) : `<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:12px ui-monospace,monospace;margin:8px">${esc(p.body)}</pre>`;
    }
  }
  /** Réponse reçue : redirection suivie (Location), sinon la page s'affiche. */
  function received(r) {
    const resp = r.resp || { code: 0, type: '', body: '', headers: [] }, loc = (resp.headers || []).find(h => /^location$/i.test(h[0]));
    if (loc && resp.code >= 300 && resp.code < 400 && nav.hops < 3) { nav.hops++; go(loc[1]); return; }
    nav.hops = 0;
    if (!resp.code) { nav.status = tl('Le programme n’a rien répondu (server.send manquant).'); return; }
    nav.page = resp; nav.pageVer++;
    nav.status = tl('{0} · {1} · {2} octets', resp.code, resp.type || '?', resp.body.length);
  }
  /** Ouvre une adresse : chemin de la carte choisie, adresse d'une carte du montage, ou site fictif (meteo.jollof…). */
  function go(target, method = 1, fields = []) {
    const list = servers(), cur = list.find(s => s.b.id === nav.board);
    const base = cur && cur.host ? `http://${hostPort(cur)}` : 'http://carte';
    let u;
    try { u = new URL(String(target || '/').trim() || '/', base + nav.path); } catch (e) { nav.status = tl('Adresse invalide'); return; }
    if (u.protocol !== 'http:' || target === '#bloque') { nav.status = tl('Lien vers l’extérieur bloqué : le bac à sable n’a pas accès à Internet.'); vers.delete('web'); return; }
    if (u.hash && u.pathname + u.search === nav.path) return; // ancre dans la même page
    const host = u.port ? `${u.hostname}:${u.port}` : u.hostname, enc = list2 => list2.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    // GET : les champs du formulaire s'ajoutent à l'adresse ; POST : ils partent dans le corps (comme un vrai navigateur).
    const query = parseQuery(u.search.slice(1)).concat(method === 1 ? fields : []), body = method === 3 ? enc(fields) : '';
    const pathQ = u.pathname + (query.length ? '?' + enc(query) : '');
    if (FAKE_HOSTS.includes(u.hostname)) {
      const resp = fakeHttp(method === 3 ? 'POST' : 'GET', parseUrl(`http://${host}${pathQ}`), body, net());
      if (u.hostname === 'journal.jollof' && app.netChanged) app.netChanged();
      nav.path = pathQ; nav.page = resp; nav.pageVer++; nav.status = tl('{0} · {1} · {2} octets', resp.code, resp.type, resp.body.length);
      return;
    }
    const s = list.find(x => x.host && hostPort(x) === host) || (u.origin === new URL(base).origin ? cur : null);
    if (!s || !s.host) { nav.status = tl('{0} ne répond pas : seules les cartes du montage et meteo.jollof, journal.jollof, heure.jollof sont joignables.', u.hostname); vers.delete('web'); return; }
    let path = u.pathname; try { path = decodeURIComponent(path); } catch (e) { /* chemin laissé tel quel */ }
    const req = { id: Date.now() + Math.random(), method, path, args: method === 3 ? query.concat(fields) : query, body, state: 'pending', resp: null, at: Date.now(), from: 'navigateur' };
    nav.board = s.b.id; nav.path = pathQ;
    s.b.periph.web.queue.push(req);
    nav.req = req; nav.t0 = Date.now();
    nav.status = tl('En attente de {0}… (traitée au prochain server.handleClient())', s.b.name);
  }
  /**
   * Liens et formulaires de la page renvoyés vers about:blank (lien : l'adresse voulue dans le fragment ; formulaire :
   * envoi GET avec l'action et la méthode d'origine en champs cachés). Le cadre n'exécute aucun script, et WebKit (macOS,
   * Linux) n'exécute même pas les écouteurs posés depuis l'application sur un document sans scripts : c'est donc au
   * chargement du cadre (frameLoaded) que l'application lit l'adresse et fait la requête. Même chemin dans tous les moteurs.
   */
  function routed(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html'); // le texte est déjà nettoyé ; DOMParser n'exécute rien
    for (const a of doc.querySelectorAll('a[href]')) {
      const h = a.getAttribute('href'); a.removeAttribute('target');
      if (!h.startsWith('#')) a.setAttribute('href', 'about:blank#jollof:' + encodeURIComponent(h));
    }
    for (const f of doc.querySelectorAll('form')) {
      const add = (n, v) => { const i = doc.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); };
      add('__jollof_action', f.getAttribute('action') || ''); add('__jollof_method', /^post$/i.test(f.getAttribute('method') || '') ? 'POST' : 'GET');
      f.setAttribute('action', 'about:blank'); f.setAttribute('method', 'get'); f.removeAttribute('target'); f.removeAttribute('enctype');
    }
    return '<!doctype html>' + doc.documentElement.outerHTML;
  }
  /** Le cadre a suivi un lien ou envoyé un formulaire détourné : la requête part vers le programme, la page revient. */
  function frameLoaded(fr) {
    let href = '';
    try { href = fr.contentWindow.location.href; } catch (e) { return; }
    if (!/^about:blank/.test(href)) return;
    let u; try { u = new URL(href); } catch (e) { return; }
    nav.shown = -1; // la page courante se réaffiche au prochain rafraîchissement, en attendant la réponse
    if (u.hash.startsWith('#jollof:')) { let t = u.hash.slice(8); try { t = decodeURIComponent(t); } catch (e) { /* adresse laissée telle quelle */ } go(t); return; }
    const q = [...new URLSearchParams(u.search)], pick = k => { const x = q.find(([n]) => n === k); return x ? x[1] : null; };
    const act = pick('__jollof_action'); if (act == null) return;
    go(act || nav.path.split('?')[0], pick('__jollof_method') === 'POST' ? 3 : 1, q.filter(([k]) => !k.startsWith('__jollof_')));
  }
  function updateJournal(li) {
    level(li, 'ok', '', '');
    const j = net().journal || [];
    if (!once('journal', j.length + ':' + (j.length ? j[j.length - 1].id : 0))) return;
    const fields = [...new Set(j.flatMap(e => Object.keys(e.f)))].sort().slice(0, 4), last = j.slice(-40);
    li.querySelector('[data-charts]').innerHTML = fields.map((f, k) => {
      const pts = last.filter(e => e.f[f] != null), vals = pts.map(e => e.f[f]), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
      const poly = pts.map((e, i) => `${(pts.length < 2 ? 120 : (i / (pts.length - 1)) * 240).toFixed(1)},${(52 - ((e.f[f] - lo) / span) * 44).toFixed(1)}`).join(' ');
      return `<figure><figcaption><b style="color:${FIELD_COLORS[k]}">${f}</b> ${esc(String(vals[vals.length - 1]))} <small>(${esc(String(lo))} – ${esc(String(hi))}, ${tl('{0} mesures', vals.length)})</small></figcaption>
        <svg viewBox="0 0 240 56" role="img" aria-label="${tl('Courbe de {0}', f)}"><polyline fill="none" stroke="${FIELD_COLORS[k]}" stroke-width="1.6" points="${poly}"/></svg></figure>`;
    }).join('') || `<p class="pxHint">${tl('Aucune mesure pour l’instant.')}</p>`;
  }

  /* ---------- Liste des cartes ---------- */
  /** Simulation arrêtée : télécommandes, badges, conversations, Wi-Fi et serveurs repartent de zéro. */
  function reset() {
    for (const c of app.comps()) if (RESET.includes(c.type) || boardOf(c)) c.periph = null;
    vers.clear(); sig = ''; if (list) list.innerHTML = ''; stopHold();
    Object.assign(nav, { board: null, path: '/', req: null, status: '', page: null, shown: -1, hops: 0 }); nav.pageVer++; nav.auto.clear();
  }
  function items() {
    const insMap = app.ins(), out = [];
    for (const c of app.comps()) { const ins = TYPES.includes(c.type) && insMap && insMap.get(c); if (ins && ins.board) out.push({ key: c.id, kind: c.type, c, ins }); }
    for (const b of app.comps()) { const st = b.periph && b.periph.bt; if (st && st.on && boardOf(b)) out.push({ key: 'bt:' + b.id + ':' + st.name, kind: 'bt', b }); }
    if (app.comps().some(isWifiBoard)) out.push({ key: 'wifi', kind: 'wifi' });
    if (servers().length) out.push({ key: 'web', kind: 'web' });
    if ((net().journal || []).length) out.push({ key: 'journal', kind: 'journal' });
    return out;
  }
  function tick() {
    if (!mount()) return;
    if (!app.simOn()) { if (wasOn) reset(); wasOn = false; sec.hidden = true; return; }
    wasOn = true;
    const its = items();
    if (sec.hidden !== !its.length) sec.hidden = !its.length;
    const s = its.map(x => x.key).join('|');
    if (s !== sig) {
      // Liste changée : les cartes sont refaites (sauf si l'élève écrit dans l'une d'elles).
      const typing = list.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
      if (typing && sig) return;
      sig = s; vers.clear(); nav.shown = -1;
      list.innerHTML = its.map(card).join('');
      const fr = list.querySelector('.webView'); if (fr) fr.addEventListener('load', () => frameLoaded(fr));
    }
    for (const it of its) {
      const li = list.querySelector(`li[data-key="${CSS.escape(it.key)}"]`); if (!li) continue;
      if (it.c) updateModule(li, it);
      else if (it.kind === 'bt') { level(li, 'ok', it.b.name, ''); const o = btSerial(it.b).st; if (once(it.key, o.ver)) renderChat(li, o, it.b.name); }
      else if (it.kind === 'wifi') updateWifi(li);
      else if (it.kind === 'web') updateWeb(li);
      else if (it.kind === 'journal') updateJournal(li);
    }
  }

  /* ---------- Actions ---------- */
  const keyOf = el => { const li = el.closest('li[data-key]'); return li ? li.dataset.key : null; };
  const compOf = el => { const k = keyOf(el); return k && byId(k); };
  const boardOfCard = el => { const k = keyOf(el), m = k && /^bt:(.+?):/.exec(k); return m ? byId(m[1]) : null; };
  function stopHold() { if (hold) { clearTimeout(hold.t); clearInterval(hold.i); if (hold.up) hold.up(); if (hold.el) hold.el.classList.remove('on'); hold = null; } }
  function irSend(el, c, repeatWhileHeld) {
    const cmd = +el.dataset.ir, k = IR_KEYS.find(x => x.cmd === cmd);
    irPress(c, cmd);
    el.closest('li[data-key]').querySelector('.pxLast').textContent = tl('Envoyé : {0} · commande 0x{1}', k.name, hex2(cmd));
    if (repeatWhileHeld) { el.classList.add('on'); hold = { el, t: setTimeout(() => { if (hold) hold.i = setInterval(() => irPress(c, cmd, true), REPEAT_MS); }, REPEAT_MS) }; }
  }
  function keyDown(el, c, quick) {
    keypadDown(c, +el.dataset.r, +el.dataset.c);
    el.classList.add('on');
    if (quick) setTimeout(() => { keypadUp(c); el.classList.remove('on'); }, 150);
    else hold = { el, up: () => keypadUp(c) };
  }
  function bind() {
    // Souris, doigt ou stylet : appuyer et maintenir (répétition infrarouge, touche tenue).
    list.addEventListener('pointerdown', e => {
      if (e.button) return;
      const ir = e.target.closest('[data-ir]'), kp = e.target.closest('.kpKey'), el = ir || kp, c = el && compOf(el); if (!c) return;
      e.preventDefault(); el.focus({ preventScroll: true }); stopHold();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointeur déjà relâché */ }
      if (ir) irSend(ir, c, true); else keyDown(kp, c, false);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) list.addEventListener(ev, stopHold);
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-badge]'), c = b && compOf(b);
      if (c) { presentBadge(c, +b.dataset.badge); vers.delete(c.id); tick(); return; }
      const h = e.target.closest('[data-hang]'), g = h && compOf(h);
      if (g) { serialDevice(g).hangUp(); tick(); return; }
      const rg = e.target.closest('[data-ring]'), gr = rg && compOf(rg);
      if (gr) { serialDevice(gr).ring(); tick(); return; }
      if (e.target.closest('[data-reload]')) { go(nav.path); tick(); return; }
      if (e.target.closest('[data-jclear]')) { net().journal = []; if (app.netChanged) app.netChanged(); tick(); return; }
      // Clavier de l'ordinateur (Entrée, Espace) : un appui bref.
      if (e.detail !== 0) return;
      const ir = e.target.closest('[data-ir]'), kp = e.target.closest('.kpKey'), el = ir || kp, cc = el && compOf(el); if (!cc) return;
      if (ir) irSend(ir, cc, false); else keyDown(kp, cc, true);
    });
    // Sur le clavier 4×4 qui a le focus, taper 0-9, A-D, * ou # appuie sur la touche correspondante.
    list.addEventListener('keydown', e => {
      const grid = e.target.closest('.kpGrid'); if (!grid || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const k = [...grid.querySelectorAll('.kpKey')].find(b => b.textContent === e.key.toUpperCase()), c = k && compOf(k); if (!c) return;
      e.preventDefault(); k.focus(); keyDown(k, c, true);
    });
    list.addEventListener('change', e => { if (e.target.matches('[data-server]')) { nav.board = e.target.value; nav.path = '/'; go('/'); tick(); } });
    list.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      if (f.classList.contains('wifiForm')) {
        const n = net(), ssid = f.ssid.value.trim(); if (!ssid) return;
        n.networks[0] = { ...(n.networks[0] || { rssi: -52 }), ssid, pass: f.pass.value };
        if (app.netChanged) app.netChanged(); vers.delete('wifi'); tick(); return;
      }
      if (f.classList.contains('webBar')) { go(f.url.value || '/'); f.url.blur(); tick(); return; }
      const inp = f.querySelector('input'), text = inp.value; if (!text.trim()) return;
      const eol = f.querySelector('.chatEol'), end = eol ? { n: '\n', rn: '\r\n' }[eol.value] || '' : '';
      const bt = boardOfCard(f), c = compOf(f);
      if (bt) btSerial(bt).phone(text, end);
      else if (c && f.classList.contains('chatForm')) serialDevice(c).phone(text, end);
      else if (c) serialDevice(c).receive(text);
      inp.value = ''; tick();
    });
  }

  setInterval(tick, 200);
  return { refresh: tick };
}
