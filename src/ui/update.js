// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mises à jour de l'édition gratuite installée. Quelques secondes après l'ouverture (jamais pendant le
// démarrage), l'application lit le manifeste latest.json de la dernière version GitHub (greffon updater de
// Tauri, adresse et clé publique dans src-tauri/tauri.conf.json). S'il y a plus récent, une carte discrète le
// propose : « Mettre à jour » télécharge l'installateur, vérifie sa signature, enregistre le projet en cours
// (sauvegarde automatique), installe puis redémarre. « Plus tard » : la carte revient au prochain lancement.
// Le menu du projet a aussi « Rechercher les mises à jour… ». L'édition Pro, distribuée à part, n'est pas concernée.
// Publication : .github/workflows/release.yml signe les installateurs et publie latest.json (scripts/update-manifest.mjs).
import { tl } from '../i18n/index.js';
import { isTauri, openExternal } from '../native.js';
import { icon } from './icons.js';

const RELEASES = 'https://github.com/xelaktechsn/jollof-studio/releases';
const FIRST_CHECK_MS = 8000;
let opts = { beforeRestart: () => Promise.resolve() };
let card = null, busy = false, pending = null;

/** Branche les mises à jour (appelé une fois, après la première image). */
export function initUpdates(o = {}) {
  if (!isTauri() || import.meta.env.VITE_EDITION === 'pro') return;
  opts = { ...opts, ...o };
  const btn = document.getElementById('updBtn'), sep = document.getElementById('updSep');
  if (btn) { btn.hidden = false; btn.addEventListener('click', () => checkNow(true)); }
  if (sep) sep.hidden = false;
  const later = cb => (window.requestIdleCallback ? requestIdleCallback(cb, { timeout: 5000 }) : cb());
  setTimeout(() => later(() => checkNow(false)), FIRST_CHECK_MS);
}

/** Cherche une version plus récente. manual : le résultat est toujours montré (même « à jour » ou une erreur). */
export async function checkNow(manual) {
  if (busy) return;
  if (pending && manual) { showAvailable(pending); return; }
  busy = true;
  if (manual) showCard({ title: tl('Recherche des mises à jour…'), spin: true });
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check({ timeout: 20000 });
    if (update) { pending = update; showAvailable(update); }
    else if (manual) showCard({ title: tl('Jollof Studio est à jour.'), ok: true, actions: [[tl('Fermer'), hideCard]] });
  } catch (e) {
    console.warn('mise à jour :', e);
    if (manual) showCard({ title: tl('Impossible de vérifier les mises à jour.'), text: tl('Vérifiez la connexion à Internet, ou téléchargez la dernière version sur le site.'),
      actions: [[tl('Fermer'), hideCard], [tl('Ouvrir la page des versions'), () => openExternal(RELEASES + '/latest')]] });
  } finally { busy = false; }
}

function showAvailable(update) {
  showCard({
    title: tl('Nouvelle version : {0}', update.version),
    text: tl('Vous avez la version {0}. Le projet en cours est enregistré avant le redémarrage.', update.currentVersion),
    actions: [
      [tl('Nouveautés'), () => openExternal(`${RELEASES}/tag/v${update.version}`), 'link'],
      [tl('Plus tard'), hideCard],
      [tl('Mettre à jour'), () => install(update), 'primary']
    ]
  });
}

async function install(update) {
  if (busy) return;
  busy = true;
  let total = 0, got = 0;
  const progress = () => showCard({ title: tl('Téléchargement de la version {0}…', update.version), pct: total ? Math.min(100, Math.round(got / total * 100)) : null });
  progress();
  try {
    await update.download(ev => {
      if (ev.event === 'Started') total = ev.data.contentLength || 0;
      else if (ev.event === 'Progress') { got += ev.data.chunkLength; progress(); }
    });
    showCard({ title: tl('Installation…'), text: tl('Jollof Studio va redémarrer.'), spin: true });
    try { await opts.beforeRestart(); } catch (e) { console.error(e); }
    await update.install(); // Windows : l'installateur prend la main et ferme l'application
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    console.error('mise à jour :', e);
    busy = false;
    showCard({ title: tl('La mise à jour a échoué.'), text: String(e?.message || e || ''),
      actions: [[tl('Fermer'), hideCard], [tl('Télécharger depuis le site'), () => openExternal(`${RELEASES}/latest`), 'primary']] });
  }
}

function hideCard() { card?.remove(); card = null; }

function showCard({ title, text = '', actions = [], pct, spin = false, ok = false }) {
  if (!card) {
    card = document.createElement('div');
    card.className = 'updCard';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    document.body.appendChild(card);
  }
  card.replaceChildren();
  const head = document.createElement('div'); head.className = 'updHead';
  head.innerHTML = icon(ok ? 'check' : 'sparkle', 'updIcon' + (spin ? ' updSpin' : ''));
  const h = document.createElement('b'); h.textContent = title; head.appendChild(h);
  card.appendChild(head);
  if (text) { const p = document.createElement('p'); p.textContent = text; card.appendChild(p); }
  if (pct !== undefined) {
    const bar = document.createElement('div'); bar.className = 'updBar' + (pct == null ? ' updBarAny' : '');
    const fill = document.createElement('i'); if (pct != null) fill.style.width = pct + '%';
    bar.appendChild(fill); card.appendChild(bar);
  }
  if (actions.length) {
    const row = document.createElement('div'); row.className = 'updActions';
    for (const [label, fn, kind] of actions) {
      const b = document.createElement('button'); b.type = 'button';
      b.className = kind === 'primary' ? 'btn primary' : kind === 'link' ? 'btn updLink' : 'btn';
      b.textContent = label; b.addEventListener('click', fn);
      row.appendChild(b);
    }
    card.appendChild(row);
  }
}
