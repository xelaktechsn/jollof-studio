// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
// Modules de l'édition Pro : dépôt privé à part (jollof-studio-pro), à côté de celui-ci par défaut.
const PRO_DIR = path.resolve(process.env.JOLLOF_PRO_DIR || path.join(ROOT, '..', 'jollof-studio-pro'));
const PRO_ENTRY = path.join(PRO_DIR, 'src', 'index.js');
const EMPTY = '\0jollof-pro-absent';

/**
 * `import('virtual:jollof-pro')` (src/main.js) : en mode « pro », l'entrée du dépôt privé ; sinon un module vide.
 * Le code Pro importe le code public par `@jollof/…` (alias vers src/).
 */
function jollofPro(mode) {
  return {
    name: 'jollof-pro',
    resolveId(id) {
      if (id !== 'virtual:jollof-pro') return null;
      if (mode !== 'pro') return EMPTY;
      if (!fs.existsSync(PRO_ENTRY)) this.error(`Édition Pro : ${PRO_ENTRY} introuvable. Clonez le dépôt privé jollof-studio-pro à côté de celui-ci, ou indiquez son chemin dans JOLLOF_PRO_DIR.`);
      return PRO_ENTRY;
    },
    load(id) { return id === EMPTY ? 'export const installPro = null;' : null; }
  };
}

/**
 * Démarrage : le gros module de l'application (src/main.js) n'est importé par boot.js qu'après la langue. Un
 * <link rel="modulepreload"> dans la page le fait télécharger et compiler dès la lecture du HTML, en même temps que
 * les feuilles de style, les polices et le dictionnaire.
 */
function preloadMain() {
  return {
    name: 'jollof-preload-main',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        // Le module de main.js (avec ce qu'il partage avec d'autres morceaux, d'où pas de « facade » unique).
        const main = ctx.bundle && Object.values(ctx.bundle).find(c => c.type === 'chunk' && (c.moduleIds || Object.keys(c.modules || {})).some(id => id.replace(/\\/g, '/').endsWith('/src/main.js')));
        if (!main) return html;
        return { html, tags: [{ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: '/' + main.fileName }, injectTo: 'head' }] };
      }
    }
  };
}

// Réglages recommandés par Tauri : port fixe, pas d'effacement de la console.
export default defineConfig(({ mode }) => ({
  clearScreen: false,
  plugins: [jollofPro(mode), preloadMain()],
  resolve: { alias: [{ find: /^@jollof\//, replacement: SRC + '/' }] },
  server: {
    port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] },
    fs: { allow: mode === 'pro' ? [ROOT, PRO_DIR] : [ROOT] }
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  // Travailleurs en modules ES : le vérificateur charge le dictionnaire et ses modules à la demande.
  worker: { format: 'es' },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 1200
  }
}));
