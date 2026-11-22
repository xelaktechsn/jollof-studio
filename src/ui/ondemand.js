// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Ce que le premier écran montre des modules chargés à la demande : leur bouton, et rien de plus. Les TP guidés
// (src/lab : bibliothèque, moteur de vérification) et les assistants IA (src/ai : outils MCP, pont) se chargent au
// premier clic, ou juste après la première image quand ils ont quelque chose à faire sans qu'on le demande (pont IA
// activé). Leurs feuilles de style sont importées par main.js : la page est déjà mise en forme.
import { tl } from '../i18n/index.js';
import { icon } from './icons.js';

const escAttr = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Promesse tenue une seule fois ; une erreur de chargement laisse réessayer. */
export function once(load) {
  let p = null;
  return () => p || (p = Promise.resolve().then(load).catch(e => { p = null; throw e; }));
}

/**
 * TP guidés. `load()` rend la promesse de l'interface de src/lab/index.js ({ open, tutorial, commands }).
 * Pose le bouton « TP », app.openLabs, app.openTutorial et les commandes « TP : … » de la palette.
 */
export function labButton(app, load) {
  const ready = once(load), fail = e => { console.error(e); app.status(tl('Chargement impossible : ') + (e.message || e)); };
  const btn = app.toolbar(`<button type="button" class="tb label" id="labBtn" data-tip="${tl('Travaux pratiques guidés, vérifiés pas à pas')}">${icon('checklist')}<span>${tl('TP')}</span></button>`);
  const space = () => (app.pneu && app.pneu.isOn() ? 'pneu' : app.logic && app.logic.isOn() ? 'logic' : app.net && app.net.isOn() ? 'net' : null);
  btn.onclick = () => ready().then(l => l.open(space())).catch(fail);
  app.openLabs = domain => ready().then(l => l.open(domain)).catch(fail);
  /** Ouvre un TP ou un tutoriel par son identifiant (bouton « Tutoriel » du plan pneumatique…). */
  app.openTutorial = id => ready().then(l => l.tutorial(id)).catch(fail);
  // Palette de commandes : « TP : Feu tricolore » ouvre le TP (le contenu des TP se charge à la première ouverture de la palette).
  if (app.commands) app.commands.provide(() => ready().then(l => l.commands()));
  return { ready };
}

/**
 * Assistants IA. `load()` rend la promesse de l'interface de src/ai/panel.js ({ open, … }), qui reprend ce bouton.
 * Rend { ready } ; le pont (application de bureau) est relancé par main.js après la première image s'il était activé.
 */
export function aiButton(load) {
  const ready = once(load);
  const bar = document.querySelector('.abTools');
  if (bar) {
    bar.insertAdjacentHTML('beforeend', `<button type="button" class="tb label" id="aiBtn" data-tip="${escAttr(tl('Laisser votre assistant IA (Claude, Cursor, VS Code…) piloter Jollof Studio'))}">${icon('sparkle')}<span>${tl('IA')}</span><b class="aiDot" hidden></b></button>`);
    document.getElementById('aiBtn').onclick = () => ready().then(a => a.open()).catch(e => console.error(e));
  }
  return { ready };
}
/** Le pont IA était activé à la dernière fermeture (src/ai/panel.js, clé « jollof-ai ») : à relancer au démarrage. */
export const aiBridgeWanted = () => { try { return localStorage.getItem('jollof-ai') === '1'; } catch (e) { return false; } };
