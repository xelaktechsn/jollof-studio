// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Simulation avec une carte réelle (onglet Simulation, « Carte réelle ») : la vraie carte, branchée en USB avec
// le programme StandardFirmata (Fichier → Exemples → Firmata dans l'IDE Arduino), recopie les sorties de la carte
// simulée (LED, PWM, servo) et renvoie ce que lisent ses entrées. Pour chaque entrée, la valeur simulée et la
// valeur réelle côte à côte : un écart montre ce que le modèle ne voit pas (câblage réel, capteur, parasites).
import { tl } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { createFirmata, MODE } from './firmata.js';
import { listPorts, openPort, webSerial } from './serial.js';
import { isTauri } from '../native.js';

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** app : { comps(), simOn(), rts() → Map id → moteur, boardOf(c) → profil ou null, status(texte, genre) }. */
export function installHil(app) {
  let sec = null, link = null, fm = null, board = null, timer = null, sig = '';

  function mount() {
    if (sec) return true;
    const after = document.getElementById('outSec'); if (!after) return false;
    after.insertAdjacentHTML('afterend', `<section id="hilSec" hidden><h2>${icon('cpu')}${tl('Carte réelle (Firmata)')}</h2>
      <p class="note">${tl('Téléversez StandardFirmata sur la vraie carte (IDE Arduino : Exemples → Firmata), branchez-la, puis connectez : elle recopie les sorties de la carte simulée et montre ses vraies entrées.')}</p>
      <div class="row hilRow"><select class="sel" id="hilBoard" aria-label="${tl('Carte simulée à recopier')}"></select>
      <select class="sel" id="hilPort" aria-label="${tl('Port série de la carte réelle')}"></select>
      <button type="button" class="btn" id="hilGo">${tl('Connecter')}</button></div>
      <p class="note" id="hilState" aria-live="polite"></p><ul class="probes" id="hilPins"></ul></section>`);
    sec = document.getElementById('hilSec');
    document.getElementById('hilGo').onclick = () => (link ? disconnect() : connect());
    document.getElementById('hilPort').onfocus = refreshPorts;
    return true;
  }
  const setState = t => { const el = document.getElementById('hilState'); if (el) el.textContent = t; };
  async function refreshPorts() {
    const sel = document.getElementById('hilPort'); if (!sel || link) return;
    if (!isTauri()) { sel.innerHTML = `<option value="">${esc(tl('Choisir à la connexion'))}</option>`; return; }
    const list = await listPorts().catch(() => []), cur = sel.value;
    sel.innerHTML = list.length ? list.map(p => `<option value="${esc(p.name)}">${esc(p.label)}</option>`).join('') : `<option value="">${esc(tl('Aucune carte branchée'))}</option>`;
    if (list.some(p => p.name === cur)) sel.value = cur;
  }
  const boards = () => app.comps().filter(c => app.boardOf(c));

  /** Broche Firmata d'une broche de la carte : numéro de GPIO, ou entrée analogique (canal) ; null si inutilisable. */
  function pinOf(prof, key) {
    const g = prof.gpio[key]; if (!g || g.caps.has('uart0')) return null; // RX/TX : la liaison avec l'ordinateur
    if (typeof g.n === 'number') return { pin: g.n };
    const m = /^A(\d+)$/.exec(String(g.n));
    if (m) { const p = fm.analogPin(+m[1]); return p >= 0 ? { pin: p, ch: +m[1] } : null; }
    return null;
  }
  async function connect() {
    board = boards().find(b => b.id === document.getElementById('hilBoard').value) || boards()[0];
    if (!board) return;
    const name = document.getElementById('hilPort').value;
    if (isTauri() && !name) { setState(tl('Branchez la carte en USB, puis choisissez son port.')); return; }
    setState(tl('Connexion… (la carte redémarre, environ 2 s)'));
    try {
      link = await openPort(name, 57600);
      link.onClose(() => { if (link) { app.status(tl('Carte réelle déconnectée.'), 'warn'); disconnect(true); } });
      fm = createFirmata(link);
      await link.reset();
      const info = await fm.ready();
      setState(tl('Connectée : {0} (Firmata {1}, {2} broches). Lancez la simulation : les sorties sont recopiées.', info.name, info.version, info.pins));
      document.getElementById('hilGo').textContent = tl('Déconnecter');
      timer = setInterval(step, 80);
    } catch (e) {
      const why = e && e.message === 'no-firmata' ? tl('aucune réponse Firmata : StandardFirmata est-il téléversé, à 57 600 bauds ?') : String((e && e.message) || e);
      setState(tl('Connexion impossible : {0}', why));
      if (link) link.close(); link = null; fm = null;
    }
  }
  function disconnect(lost = false) {
    clearInterval(timer); timer = null;
    if (fm && !lost) try { fm.release(); } catch (e) { /* port déjà fermé */ }
    if (link) { const l = link; link = null; setTimeout(() => l.close(), lost ? 0 : 100); }
    fm = null; sig = '';
    document.getElementById('hilGo').textContent = tl('Connecter');
    document.getElementById('hilPins').innerHTML = '';
    setState('');
  }

  /** Recopie des sorties, lecture des entrées, affichage des écarts. */
  function step() {
    if (!fm || !board) return;
    const rt = app.simOn() ? app.rts().get(board.id) : null, prof = app.boardOf(board), rows = [];
    if (!rt) { render([], tl('Lancez la simulation : la carte réelle suivra le programme de {0}.', board.name)); return; }
    for (const [key, p] of rt.pins) {
      const at = pinOf(prof, key); if (!at) continue;
      if (p.mode === 1) {
        // Sortie : même signal sur la vraie broche (servo, PWM si la broche sait la faire, sinon niveau).
        if (p.servo != null && fm.can(at.pin, MODE.SERVO)) { fm.servoWrite(at.pin, p.servo); rows.push({ key, kind: 'out', sim: `${Math.round(p.servo)}°` }); }
        else if (p.pwm != null && fm.can(at.pin, MODE.PWM)) { fm.analogWrite(at.pin, p.pwm * 255); rows.push({ key, kind: 'out', sim: `PWM ${Math.round(p.pwm * 100)} %` }); }
        else { fm.digitalWrite(at.pin, p.d); rows.push({ key, kind: 'out', sim: p.d ? 'HIGH' : 'LOW' }); }
        continue;
      }
      // Entrée lue par le programme : la valeur du modèle et celle de la vraie broche.
      const pr = rt.probe(key); if (!pr) continue;
      if (at.ch != null && prof.gpio[key].caps.has('adc')) {
        fm.watchAnalog(at.ch);
        const raw = fm.analog(at.ch), real = raw == null ? null : (raw / 1023) * prof.logic;
        rows.push({ key, kind: 'in', sim: `${pr.v.toFixed(2)} V`, real: real == null ? '…' : `${real.toFixed(2)} V`, gap: real != null && Math.abs(real - pr.v) > 0.25 });
      } else {
        fm.watchDigital(at.pin, p.mode === 2);
        const real = fm.digital(at.pin);
        rows.push({ key, kind: 'in', sim: pr.d ? 'HIGH' : 'LOW', real: real ? 'HIGH' : 'LOW', gap: !!real !== !!pr.d });
      }
    }
    render(rows);
  }
  function render(rows, msg) {
    const html = msg ? `<li class="empty">${esc(msg)}</li>` : rows.map(r => `<li class="${r.gap ? 'warn' : 'ok'}"><div class="ph"><span class="lv"></span><b>${esc(r.key)}</b><span class="sig">${r.kind === 'out' ? tl('sortie recopiée') : tl('entrée')}</span></div>`
      + `<div class="pv">${r.kind === 'out' ? esc(r.sim) : esc(tl('simulé {0} · réel {1}', r.sim, r.real))}${r.gap ? ' — ' + esc(tl('écart')) : ''}</div></li>`).join('');
    if (html === sig) return; sig = html;
    document.getElementById('hilPins').innerHTML = html;
  }

  /** Appelé à chaque rendu de l'onglet : section visible s'il y a une carte et un moyen d'atteindre le port série. */
  function refresh() {
    if (!mount()) return;
    const list = boards(), can = isTauri() || webSerial();
    sec.hidden = !list.length || !can;
    const sel = document.getElementById('hilBoard'), ids = list.map(b => b.id).join();
    if (sel.dataset.ids !== ids) { sel.dataset.ids = ids; const cur = sel.value; sel.innerHTML = list.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join(''); if (list.some(b => b.id === cur)) sel.value = cur; }
    sel.disabled = !!link;
    if (!document.getElementById('hilPort').options.length) refreshPorts();
    if (link && board && !list.includes(board)) disconnect();
  }
  setInterval(refresh, 1000);
  return { refresh, disconnect };
}
