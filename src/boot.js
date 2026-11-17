// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Point d'entrée : le dictionnaire anglais n'est chargé que pour une interface en anglais, avant
// l'application (ses tables de libellés appellent tl() dès leur chargement).
// Feuilles de style et polices sont importées ici, et non dans main.js : Vite en fait une feuille
// liée dans la page, chargée avec ce petit module, si bien que le premier affichage est déjà mis en
// forme au lieu d'attendre le gros module de l'application.
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';
import './ui/shell.css'; // ossature : barre d'activité, onglets des plans, panneau du bas, palette
import { loadLanguage } from './i18n/index.js';
import { showSplash } from './ui/splash.js';
import { initTheme } from './ui/theme.js';

// Thème clair ou sombre : posé sur <html> avant le premier affichage (les jetons de styles.css en dépendent).
try { initTheme(); } catch (e) { console.error(e); }

try { performance.mark('jollof:boot'); } catch (e) { /* navigateur ancien */ }
// Application installée : les erreurs de la fenêtre vont aussi au journal (fichier écrit par Rust, joint à un
// rapport de bogue). Appel direct au pont de Tauri : rien de plus à charger avant le premier affichage.
const T = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;
if (T) {
  const send = (level, message) => { try { T.invoke('log_js', { level, message: String(message).slice(0, 4000) }).catch(() => {}); } catch (e) { /* pont absent */ } };
  addEventListener('error', e => send('error', `${e.message || e.error} @ ${e.filename || '?'}:${e.lineno || 0}${e.error && e.error.stack ? '\n' + e.error.stack : ''}`));
  addEventListener('unhandledrejection', e => { const r = e.reason; send('error', `promesse rejetée : ${r && r.stack ? r.stack : r}`); });
}
// Écran d'ouverture : affiché tout de suite, pendant que l'application se charge en parallèle.
try { showSplash(); } catch (e) { console.error(e); }
loadLanguage().catch(e => console.error(e)).then(() => { try { performance.mark('jollof:lang'); } catch (e) { /* rien */ } return import('./main.js'); });
