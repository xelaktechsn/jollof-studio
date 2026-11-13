// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Moniteur série d'une carte réelle branchée en USB : connexion à un port et à un débit, texte reçu (UTF-8, même
// coupé au milieu d'un caractère), envoi avec la fin de ligne choisie, redémarrage (DTR), reconnexion automatique
// quand la carte est rebranchée, débit qui ne correspond pas repéré (texte illisible), erreurs du système
// expliquées. Le port est prêté au téléversement (release) puis repris. Sans interface : panel.js l'affiche.
import { tl } from '../i18n/index.js';
import { listPorts, openPort, claim, unclaim, BAUDS, webSerial } from './serial.js';
import { isTauri } from '../native.js';

/** Fins de ligne envoyées après le texte (comme le moniteur série de l'IDE Arduino). */
export const ENDINGS = [['\n', () => tl('Nouvelle ligne')], ['\r\n', () => tl('CR + LF')], ['\r', () => tl('Retour chariot (CR)')], ['', () => tl('Aucune')]];
/** Qui peut tenir le port, pour l'expliquer quand il change de mains. */
const WHO = { monitor: () => tl('le moniteur série'), firmata: () => tl('la carte réelle (Firmata)'), upload: () => tl('le téléversement') };
export const whoLabel = who => (WHO[who] ? WHO[who]() : who);

/** Débit écrit dans le programme : Serial.begin(115200) → 115200 (null s'il n'y en a pas ou s'il est inhabituel). */
export function baudOf(code) {
  const m = /Serial\.begin\s*\(\s*(\d+)/.exec(String(code || '').replace(/\/\/[^\n]*/g, ''));
  return m && BAUDS.includes(+m[1]) ? +m[1] : null;
}
/** Part des caractères illisibles d'un texte reçu : au-delà d'un quart, le débit ne correspond sans doute pas. */
export function noise(text) {
  const chars = [...String(text || '')]; if (!chars.length) return 0;
  let bad = 0;
  for (const ch of chars) { const c = ch.codePointAt(0); if (ch === '�' || (c < 32 && c !== 9 && c !== 10 && c !== 13) || (c >= 0x7f && c < 0xa0)) bad++; }
  return bad / chars.length;
}
/** Erreur du système → ce qui se passe et quoi faire. */
export function explainError(e, platform = typeof navigator !== 'undefined' ? navigator.platform || '' : '') {
  const m = String((e && (e.message || e.name)) || e || '');
  if (/NotFoundError|No port selected|aucun port sélectionné/i.test(m)) return null; // fenêtre de choix fermée : rien à dire
  if (/busy|in use|resource busy|already open|Access is denied|accès refusé/i.test(m)) return tl('Le port est déjà ouvert par un autre logiciel (IDE Arduino, autre moniteur série…). Fermez-le, puis reconnectez.');
  if (/permission denied/i.test(m)) return /linux/i.test(platform) ? tl('Accès au port refusé : ajoutez votre compte au groupe « dialout » (sudo usermod -a -G dialout $USER), puis fermez la session et rouvrez-la.') : tl('Accès au port refusé par le système. Débranchez la carte, rebranchez-la, puis reconnectez.');
  if (/no such file|not found|inconnu|unknown|does not exist|introuvable/i.test(m)) return tl('La carte n’est plus sur ce port : vérifiez qu’elle est branchée, puis choisissez à nouveau son port.');
  if (/débit non pris en charge/i.test(m)) return tl('Ce débit n’est pas pris en charge.');
  return tl('Connexion impossible : {0}', m);
}

/**
 * o : { onText(texte), onChange(état), status(texte, genre) }.
 * État : { port, baud, state: off | connecting | on | lost | error, error, noisy, rx, by }.
 */
export function createRealMonitor(o) {
  const st = { port: '', baud: 9600, state: 'off', error: '', noisy: false, rx: 0, by: null };
  let link = null, dec = null, sample = '', poll = 0, want = false, t0 = 0;
  const emit = () => { if (o.onChange) o.onChange({ ...st }); };
  const stopPoll = () => { clearInterval(poll); poll = 0; };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  async function connect(port = st.port, baud = st.baud) {
    stopPoll();
    if (link) await close();
    st.port = port; st.baud = baud; st.state = 'connecting'; st.error = ''; st.noisy = false; st.by = null; emit();
    try {
      if (isTauri() && !port && !globalThis.__serialMock) throw new Error(tl('choisissez le port de la carte'));
      await claim(port, 'monitor', who => { if (link) { st.by = who; o.status && o.status(tl('Moniteur série déconnecté : port pris par {0}.', whoLabel(who)), 'warn'); } return close(who); });
      const l = await openPort(port, baud, { reuse: true });
      link = l; dec = new TextDecoder('utf-8'); sample = ''; st.rx = 0; t0 = now(); want = true;
      l.onData(bytes => {
        if (link !== l) return;
        const text = dec.decode(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes), { stream: true });
        const first = !st.rx; st.rx += bytes.length;
        if (first) emit(); // les premiers octets : « rien reçu » n'est plus vrai
        if (sample.length < 600) { // les premiers caractères disent si le débit est le bon
          sample += text;
          const was = st.noisy; st.noisy = sample.length >= 24 && noise(sample) > 0.25;
          if (was !== st.noisy) emit();
        }
        if (text) o.onText(text);
      });
      l.onClose(() => { if (link === l) lost(); });
      st.state = 'on'; emit();
      return true;
    } catch (e) {
      unclaim(port, 'monitor');
      const why = explainError(e);
      st.state = why ? 'error' : 'off'; st.error = why || ''; emit();
      return false;
    }
  }
  /** Carte débranchée (ou port fermé par le système) : on attend qu'elle revienne, puis on se reconnecte. */
  function lost() {
    link = null; unclaim(st.port, 'monitor');
    st.state = 'lost'; emit();
    o.onText(`\n${tl('— Carte débranchée : reconnexion dès qu’elle revient —')}\n`);
    stopPoll();
    poll = setInterval(async () => {
      if (!want) { stopPoll(); return; }
      const back = isTauri() || globalThis.__serialMock ? (await listPorts().catch(() => [])).some(p => p.name === st.port) : webSerial();
      if (!back) return;
      stopPoll();
      setTimeout(async () => { if (want && st.state === 'lost' && await connect(st.port, st.baud)) o.onText(`${tl('— Carte rebranchée —')}\n`); }, 700); // le temps que le système prépare le port
    }, 1000);
  }
  async function close(by = null) {
    const l = link; link = null;
    unclaim(st.port, 'monitor');
    if (l) { try { await l.close(); } catch (e) { /* déjà fermé */ } }
    if (dec) { const rest = dec.decode(); if (rest) o.onText(rest); dec = null; }
    st.state = 'off'; st.by = by; emit();
  }
  return {
    state: () => ({ ...st }),
    connected: () => !!link,
    /** Millisecondes depuis la connexion : l'horloge du traceur pour cette carte. */
    clock: () => (link ? now() - t0 : null),
    connect,
    async disconnect() { want = false; stopPoll(); await close(); },
    async send(text, ending = '\n') { if (!link) return false; await link.write(new TextEncoder().encode(text + ending)); return true; },
    async reset() { if (link) { await link.reset(); o.onText(`\n${tl('— Carte redémarrée —')}\n`); } },
    /** Débit changé : appliqué tout de suite si la carte est connectée. */
    async setBaud(b) { st.baud = b; if (link) await connect(st.port, b); else emit(); },
    async setPort(p) { st.port = p; if (link) await connect(p, st.baud); else emit(); },
    /**
     * Téléversement sur ce port : le moniteur le libère. Rend la fonction qui le reprend (après le redémarrage
     * de la carte), ou une fonction vide s'il n'était pas connecté.
     */
    async release(port) {
      if (!link || (port && st.port && port !== st.port)) return () => {};
      const p = st.port, b = st.baud;
      want = false; stopPoll(); await close('upload');
      return (delay = 1200) => setTimeout(() => connect(p, b), delay);
    }
  };
}
