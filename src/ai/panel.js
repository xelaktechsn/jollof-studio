// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Bouton « IA » et son panneau : un assistant IA (Claude, Cursor, VS Code…) pilote Jollof Studio directement, par le
// protocole MCP, sans copier-coller. Application de bureau seulement.
//   1. L'utilisateur autorise les assistants (pont local, désactivé par défaut, src-tauri/src/ai.rs).
//   2. « Relier » écrit la configuration de l'assistant choisi (Claude Desktop, Claude Code, Cursor, VS Code,
//      Windsurf, LM Studio) : il lancera `jollof-studio --mcp`, qui lit lui-même la clé ; aucune clé n'est copiée.
//   3. La première fois qu'un assistant se connecte, l'application demande l'accord, puis s'en souvient (une ligne
//      par assistant, même s'il ouvre plusieurs connexions) ; l'accès se retire ici, et « Couper tous les accès »
//      change la clé et oublie tous les accords. Les relais arrêtés sans prévenir disparaissent tout seuls.
// Un journal montre chaque action ; un voyant sur le bouton signale le pont actif, et clignote quand l'IA agit.
import { invoke, Channel } from '@tauri-apps/api/core';
import { tl } from '../i18n/index.js';
import { isTauri } from '../native.js';
import { dialog, confirm } from '../school/ui.js';
import { icon } from '../ui/icons.js';
import { createTools } from './tools.js';
import { createMcp, clientKey } from './mcp.js';
import './ai.css';

const KEY = 'jollof-ai', ALLOWED = 'jollof-ai-allowed';
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } } };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Outils qui ne changent rien : ils n'apparaissent pas dans la barre d'état. */
const QUIET = new Set(['get_project', 'list_parts', 'get_part', 'check_circuit', 'get_program', 'read_simulation', 'part_format', 'list_examples', 'screenshot']);
const nameOf = c => (c && (c.title || c.name)) || tl('assistant');

export function installAi(H) {
  const desk = isTauri();
  const log = []; // { t, who, tool, ok, text }
  let info = null, lastAct = 0, logEl = null, repaint = null;
  /** Assistants toujours autorisés : [{ name (identifiant MCP), title (nom affiché) }]. */
  const allowed = () => { try { return JSON.parse(store.get(ALLOWED) || '[]').filter(a => a && a.name); } catch (e) { return []; } };
  const setAllowed = list => store.set(ALLOWED, JSON.stringify(list.filter((a, i) => list.findIndex(b => b.name === a.name) === i).slice(0, 20)));
  const focus = () => (desk ? invoke('ai_focus').catch(() => {}) : Promise.resolve());

  /**
   * Accord de l'utilisateur, une seule fois par assistant : retenu jusqu'à ce qu'il soit retiré dans le panneau.
   * silent : connexion rejouée par le relais (application redémarrée) : jamais de demande, seulement les accords
   * déjà donnés.
   */
  async function approve(client, { silent = false } = {}) {
    if (allowed().some(a => a.name === clientKey(client))) return true;
    if (silent) return false;
    await focus();
    const v = await dialog({
      title: tl('Autoriser cet assistant ?'),
      body: `<p class="dlgText">${tl('« {0} » demande à piloter Jollof Studio : poser et câbler des composants, écrire le programme, simuler, créer des composants. Chaque action s’annule avec Ctrl+Z.', esc(nameOf(client)))}</p><p class="dlgText aiNote">${tl('Jollof Studio s’en souviendra : l’accès se retire à tout moment dans le panneau IA.')}</p>`,
      actions: [{ label: tl('Refuser'), value: false }, { label: tl('Autoriser'), value: true, kind: 'primary' }]
    });
    if (v) setAllowed([...allowed(), { name: clientKey(client), title: nameOf(client) }]);
    if (repaint) repaint();
    return !!v;
  }
  /** Ferme des sessions dans la fenêtre et dans le pont. */
  const closeSessions = sids => sids.forEach(sid => invoke('ai_end_session', { sid }).catch(() => {}));
  // Relais arrêtés sans prévenir (assistant quitté) : sans battement depuis 2 min 30, leur session est oubliée.
  if (desk) setInterval(() => { const gone = mcp.prune(150000); if (gone.length) { closeSessions(gone); if (repaint) repaint(); } }, 30000);
  /** Remplacer le projet (nouveau projet, exemple) : toujours confirmé par l'utilisateur. */
  async function confirmReplace(title) {
    await focus();
    return confirm(tl('Remplacer le projet ?'), tl('L’assistant IA veut remplacer « {0} » par un autre projet. Les modifications non enregistrées seront perdues.', esc(title)), tl('Remplacer'), true);
  }

  const short = v => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 140 ? s.slice(0, 137) + '…' : s; };
  const tools = createTools({ ...H, confirmReplace });
  const mcp = createMcp({
    tools, approve, info: { name: 'jollof-studio', title: 'Jollof Studio', version: '0.1.0' },
    onCall(name, args, out, error, client) {
      const who = nameOf(client);
      log.unshift({ t: new Date(), who, tool: name, ok: !error, text: error || short(out && out.image ? { image: out.text } : out) });
      log.length = Math.min(log.length, 60);
      lastAct = Date.now(); paintDot(); paintLog();
      if (!QUIET.has(name)) H.status(error ? tl('IA ({0}) : {1} — {2}', who, name, error.split('\n')[0]) : tl('IA ({0}) : {1}', who, name), error ? 'warn' : 'ok');
    }
  });

  /* ---------- Pont MCP ---------- */
  async function bridge(on) {
    if (!desk) return null;
    const ch = new Channel();
    ch.onmessage = async ({ rid, sid, msg }) => {
      let res;
      try { res = await mcp.handle(msg, sid); } catch (e) { res = { jsonrpc: '2.0', id: msg && msg.id != null ? msg.id : null, error: { code: -32603, message: String((e && e.message) || e) } }; }
      if (rid) await invoke('ai_reply', { rid, body: JSON.stringify(res || { jsonrpc: '2.0', id: msg.id ?? null, result: {} }) }).catch(() => {});
    };
    info = await invoke('ai_bridge', { enabled: on, onRequest: ch });
    if (!on) mcp.endAll();
    store.set(KEY, on ? '1' : '0');
    paintDot();
    return info;
  }

  /* ---------- Bouton ---------- */
  const bar = document.querySelector('.abTools');
  if (bar) {
    bar.insertAdjacentHTML('beforeend', `<button type="button" class="tb label" id="aiBtn" data-tip="${esc(tl('Laisser votre assistant IA (Claude, Cursor, VS Code…) piloter Jollof Studio'))}">${icon('sparkle')}<span>${tl('IA')}</span><b class="aiDot" hidden></b></button>`);
    document.getElementById('aiBtn').onclick = open;
  }
  function paintDot() {
    const d = document.querySelector('#aiBtn .aiDot'); if (!d) return;
    const busy = Date.now() - lastAct < 4000;
    d.hidden = !(info && info.enabled); d.classList.toggle('busy', busy);
    if (busy) setTimeout(paintDot, 4100);
  }
  if (desk && store.get(KEY) === '1') bridge(true).catch(e => console.warn(tl('Pont IA indisponible'), e));

  /* ---------- Panneau ---------- */
  function paintLog() {
    if (!logEl || !logEl.isConnected) return;
    logEl.innerHTML = log.length ? log.map(e => `<li class="${e.ok ? '' : 'err'}"><time>${e.t.toLocaleTimeString()}</time><b>${esc(e.tool)}</b><span>${esc(e.text)}</span></li>`).join('') : `<li class="none">${tl('Aucune action pour l’instant.')}</li>`;
  }
  function open() {
    const body = document.createElement('div');
    body.className = 'aiPanel';
    if (!desk) {
      body.innerHTML = `<p class="aiLead">${tl('Votre assistant IA (Claude, Cursor, VS Code…) peut piloter Jollof Studio : poser et câbler des composants, écrire le programme, simuler, créer des composants, sans copier-coller.')}</p>
        <p class="aiNote">${tl('Cette fonction est dans l’application de bureau Jollof Studio (Mac, Windows, Linux) : un navigateur ne peut pas recevoir les commandes d’un assistant.')}</p>`;
      dialog({ title: tl('Assistants IA'), body, width: 560, cls: 'aiDialog' });
      return;
    }
    body.innerHTML = `
      <p class="aiLead">${tl('Votre assistant IA pilote Jollof Studio : il pose et câble les composants, écrit le programme, lance la simulation, lit les mesures et crée de nouveaux composants. Chaque action s’annule avec Ctrl+Z.')}</p>
      <section class="aiSec">
        <label class="aiSwitch"><input type="checkbox" id="aiOn"><span>${tl('Autoriser les assistants IA sur cet ordinateur')}</span></label>
        <p class="aiState" id="aiState"></p>
      </section>
      <section class="aiSec" id="aiClientsSec">
        <h4>${tl('Vos assistants')}</h4>
        <p class="aiNote">${tl('« Relier » ajoute Jollof Studio à la configuration de l’assistant ; ensuite, il suffit de lui parler (« fais-moi une station météo sur un ESP32 »).')}</p>
        <ul class="aiClients" id="aiClients"></ul>
        <details class="aiOther"><summary>${tl('Autre assistant compatible MCP')}</summary><p class="aiNote">${tl('Déclarez un serveur MCP « stdio » qui lance cette commande :')}</p><code class="aiCmd" id="aiCmd"></code></details>
      </section>
      <section class="aiSec" id="aiAccessSec">
        <h4>${tl('Accès')}</h4>
        <ul class="aiAccess" id="aiAccess"></ul>
        <p class="aiNote">${tl('Seul ce compte de l’ordinateur peut relier un assistant : la clé d’accès reste dans un fichier que lui seul peut lire, et chaque nouvel assistant demande votre accord. Une page web ne peut pas piloter l’application.')}</p>
        <div class="aiRow"><button type="button" class="btn small" id="aiNewKey">${icon('key')}<span>${tl('Couper tous les accès')}</span></button></div>
      </section>
      <section class="aiSec"><h4>${tl('Journal de l’IA')}</h4><ol class="aiLog" id="aiLog"></ol></section>`;
    const $ = s => body.querySelector(s);
    let clients = [], hint = '';
    logEl = $('#aiLog'); paintLog();
    async function loadClients() { clients = await invoke('ai_clients').catch(() => []); paint(); }
    function paint() {
      if (!body.isConnected) return;
      const on = !!(info && info.enabled);
      $('#aiOn').checked = on;
      const live = mcp.connected();
      $('#aiState').textContent = on
        ? (live.length ? tl('Actif. Connecté maintenant : {0}.', live.map(s => nameOf(s.client)).join(', ')) : tl('Actif : en attente d’un assistant.'))
        : tl('Désactivé : aucun assistant ne peut piloter l’application.');
      $('#aiClientsSec').classList.toggle('off', !on);
      $('#aiCmd').textContent = info && info.exe ? `"${info.exe}" --mcp` : '';
      const shown = clients.filter(c => c.installed || c.connected);
      $('#aiClients').innerHTML = (shown.length ? shown : clients).map(c => {
        const st = !c.installed && !c.connected ? `<span class="aiTag muted">${tl('non installé')}</span>`
          : c.elsewhere ? `<span class="aiTag warn">${tl('relié à une autre copie')}</span>`
          : c.connected ? `<span class="aiTag ok">${icon('check')}${tl('relié')}</span>` : `<span class="aiTag">${tl('pas encore relié')}</span>`;
        const btn = !c.installed && !c.connected ? ''
          : c.connected && !c.elsewhere ? `<button type="button" class="btn small" data-off="${c.id}">${tl('Détacher')}</button>`
          : `<button type="button" class="btn small primary" data-on="${c.id}"${on ? '' : ' disabled'}>${tl('Relier')}</button>`;
        return `<li><b>${esc(c.name)}</b>${st}${btn}</li>`;
      }).join('') + (hint ? `<li class="aiHint">${esc(hint)}</li>` : '');
      // Une ligne par assistant : autorisé, et connecté maintenant ou non.
      const rows = new Map(allowed().map(a => [a.name, { key: a.name, title: a.title || a.name, live: false }]));
      for (const c of live) { const r = rows.get(c.key) || { key: c.key, title: nameOf(c.client) }; r.live = true; rows.set(c.key, r); }
      $('#aiAccess').innerHTML = [...rows.values()].map(r => `<li><span>${icon(r.live ? 'link' : 'check')}${esc(r.title)} · ${r.live ? tl('connecté maintenant') : tl('autorisé')}</span><button type="button" class="btn small" data-forget="${esc(r.key)}">${tl('Retirer l’accès')}</button></li>`).join('')
        || `<li class="none">${tl('Aucun assistant autorisé pour l’instant.')}</li>`;
    }
    repaint = paint;
    body.addEventListener('change', async e => {
      if (e.target.id !== 'aiOn') return;
      try { await bridge(e.target.checked); } catch (err) { H.status(tl('Pont IA indisponible : {0}', String(err)), 'warn'); }
      paint();
    });
    body.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.on || b.dataset.off) {
        const id = b.dataset.on || b.dataset.off, c = clients.find(x => x.id === id);
        try {
          clients = await invoke('ai_connect', { id, on: !!b.dataset.on });
          hint = b.dataset.on ? (c && c.restart ? tl('{0} est relié : redémarrez-le pour qu’il voie Jollof Studio.', c.name) : tl('{0} est relié : ouvrez une nouvelle conversation.', c ? c.name : '')) : tl('{0} est détaché.', c ? c.name : '');
        } catch (err) { hint = String(err); }
        paint();
      }
      if (b.dataset.forget) { setAllowed(allowed().filter(a => a.name !== b.dataset.forget)); closeSessions(mcp.endClient(b.dataset.forget)); paint(); }
      if (b.id === 'aiNewKey') {
        if (!(await confirm(tl('Couper tous les accès ?'), tl('Les assistants connectés sont déconnectés, la clé d’accès change et chaque assistant redemandera votre accord. Les assistants reliés restent configurés.'), tl('Couper'), true))) return;
        await invoke('ai_new_token').catch(() => {}); closeSessions(mcp.endAll()); setAllowed([]); paint();
        H.status(tl('Accès coupés : chaque assistant redemandera votre accord.'), 'ok');
      }
    });
    const timer = setInterval(() => { if (!body.isConnected) { clearInterval(timer); repaint = null; return; } paint(); }, 2000);
    loadClients();
    dialog({ title: tl('Assistants IA'), body, width: 600, cls: 'aiDialog' });
  }

  return { mcp, tools, bridge, open, approve };
}
