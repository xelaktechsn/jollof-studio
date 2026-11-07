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
import { loadLanguage } from './i18n/index.js';

loadLanguage().catch(e => console.error(e)).then(() => import('./main.js'));
