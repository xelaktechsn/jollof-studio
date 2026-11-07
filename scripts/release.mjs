#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Construit l'application à distribuer, pour une édition et une langue.
//
//   node scripts/release.mjs --edition free|pro --lang auto|fr|en [--api https://serveur] [--target <triple>] [--dry-run] [-- <options de tauri build>]
//   (--api : adresse du serveur de l'espace classe proposée par défaut ; sinon http://localhost:3100)
//   (--dry-run affiche la configuration sans construire)
//
// --edition  free : édition gratuite, sans module Pro ; pro : avec le mode Enseignement et les modules Pro.
// --lang     auto (par défaut) : bilingue. Sous Windows, l'installateur demande la langue
//            (français ou anglais) et l'application la retient ; ailleurs, la langue du système.
//            fr ou en : application dans une seule langue (installateur dans cette langue).
//
// Les installateurs produits sont copiés dans release/<édition>-<langue>/.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), sep = argv.indexOf('--');
const own = sep < 0 ? argv : argv.slice(0, sep), extra = sep < 0 ? [] : argv.slice(sep + 1);
const opt = (name, def) => { const i = own.indexOf('--' + name); return i >= 0 && own[i + 1] ? own[i + 1] : def; };
const edition = opt('edition', 'free'), lang = opt('lang', 'auto'), target = opt('target', null), apiUrl = opt('api', process.env.VITE_API_URL || null);
if (!['free', 'pro'].includes(edition) || !['auto', 'fr', 'en'].includes(lang)) {
  console.error('Usage : node scripts/release.mjs --edition free|pro --lang auto|fr|en [--api https://serveur] [--target <triple>] [--dry-run] [-- <options de tauri build>]');
  process.exit(1);
}

const pro = edition === 'pro';
const TEXT = {
  fr: { short: pro ? 'Conception de circuits 3D et cours guidés' : 'Conception et simulation de circuits 3D',
    long: pro ? 'Jollof Studio Pro : montage de circuits ESP32 et Arduino en 3D, programmation, simulation, mode Enseignement (notes, présentation pas à pas, évaluation), guide de montage et téléversement sur une vraie carte.'
      : 'Jollof Studio permet de monter des circuits ESP32 et Arduino en 3D, de les programmer, de les simuler et d’imprimer leur schéma.' },
  en: { short: pro ? '3D circuit design and guided lessons' : '3D circuit design and simulation',
    long: pro ? 'Jollof Studio Pro: build ESP32 and Arduino circuits in 3D, program and simulate them, teach with notes, step-by-step presentations and graded exercises, print assembly guides and upload to a real board.'
      : 'Jollof Studio lets you build ESP32 and Arduino circuits in 3D, program them, simulate them and print their schematic.' }
};
const t = TEXT[lang === 'en' ? 'en' : 'fr'];
const name = pro ? 'Jollof Studio Pro' : 'Jollof Studio';
const conf = {
  productName: name,
  identifier: pro ? 'sn.jollof.studio.pro' : 'sn.jollof.studio',
  build: { beforeBuildCommand: pro ? 'npm run build:pro' : 'npm run build' },
  app: { windows: [{ label: 'main', title: name, width: 1440, height: 900, minWidth: 1024, minHeight: 640, center: true, theme: 'Dark' }] },
  bundle: {
    shortDescription: t.short, longDescription: t.long,
    windows: { nsis: lang === 'auto'
      ? { languages: ['French', 'English'], displayLanguageSelector: true, installerHooks: './windows/hooks.nsh' }
      : { languages: [lang === 'fr' ? 'French' : 'English'], displayLanguageSelector: false, installerHooks: './windows/hooks.nsh' } }
  }
};
// Sous Windows, une version bilingue ne produit que l'installateur NSIS : c'est lui qui demande la langue.
if (lang === 'auto' && process.platform === 'win32') conf.bundle.targets = ['nsis'];

if (own.includes('--dry-run')) { console.log(JSON.stringify(conf, null, 2)); console.log('VITE_EDITION=' + edition, lang === 'auto' ? '' : 'VITE_LANG=' + lang, apiUrl ? 'VITE_API_URL=' + apiUrl : ''); process.exit(0); }
const confPath = join(root, 'src-tauri', `tauri.release.conf.json`);
writeFileSync(confPath, JSON.stringify(conf, null, 2));
const env = { ...process.env, VITE_EDITION: edition };
if (lang === 'auto') delete env.VITE_LANG; else env.VITE_LANG = lang;
// Adresse du serveur de l'espace classe proposée par défaut (modifiable dans l'application).
if (apiUrl) env.VITE_API_URL = apiUrl;
console.log(`→ ${name} · langue ${lang === 'auto' ? 'au choix (installateur / système)' : lang}`);
// Dossier des installateurs vidé avant la construction : on ne recopie que ceux de cette édition et de cette langue.
const bundleDir = join(root, 'src-tauri', 'target', ...(target ? [target] : []), 'release', 'bundle');
rmSync(bundleDir, { recursive: true, force: true });
const args = ['tauri', 'build', '--config', confPath, ...(target ? ['--target', target] : []), ...extra];
const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
rmSync(confPath, { force: true });
if (r.status !== 0) process.exit(r.status || 1);

// Copie des installateurs produits, suffixés par la langue.
const outDir = join(root, 'release', `${edition}-${lang}`);
mkdirSync(outDir, { recursive: true });
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() && !f.endsWith('.app') ? walk(p) : [p]; });
const files = existsSync(bundleDir) ? walk(bundleDir).filter(p => /\.(exe|msi|dmg|deb|rpm|AppImage)$/.test(p)) : [];
for (const p of files) {
  const base = basename(p).replace(/(\.[A-Za-z]+)$/, `_${lang}$1`);
  copyFileSync(p, join(outDir, base));
  console.log('  ✓', join('release', `${edition}-${lang}`, base));
}
if (!files.length) console.log('  (aucun installateur trouvé dans', bundleDir + ')');
