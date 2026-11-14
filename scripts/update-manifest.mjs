#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Manifeste des mises à jour (latest.json) lu par l'application installée (greffon updater de Tauri,
// adresse dans src-tauri/tauri.conf.json → plugins.updater.endpoints).
//
//   node scripts/update-manifest.mjs <dossier> <étiquette v0.2.0> [dépôt propriétaire/nom]
//
// Le dossier contient les installateurs aux noms stables et leur signature (<fichier>.sig, produite par
// « tauri signer sign » avec la clé privée des mises à jour). Chaque installation cherche d'abord
// « <système>-<architecture>-<type de paquet> » puis « <système>-<architecture> » : un .deb se met à jour
// par un .deb, un .rpm par un .rpm, une AppImage par une AppImage, l'installateur NSIS par lui-même.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [dir, tag, repo = 'xelaktechsn/jollof-studio'] = process.argv.slice(2);
if (!dir || !/^v\d+\.\d+\.\d+/.test(tag || '')) {
  console.error('Usage : node scripts/update-manifest.mjs <dossier> <v1.2.3> [propriétaire/dépôt]');
  process.exit(1);
}

const FILES = {
  'Jollof-Studio-Windows-x64-setup.exe': ['windows-x86_64', 'windows-x86_64-nsis'],
  'Jollof-Studio-Linux-x86_64.AppImage': ['linux-x86_64', 'linux-x86_64-appimage'],
  'Jollof-Studio-Linux-amd64.deb': ['linux-x86_64-deb'],
  'Jollof-Studio-Linux-x86_64.rpm': ['linux-x86_64-rpm']
};

const platforms = {};
for (const [file, keys] of Object.entries(FILES)) {
  const p = join(dir, file);
  if (!existsSync(p)) { console.warn(`  (absent : ${file})`); continue; }
  if (!existsSync(p + '.sig')) { console.error(`Signature manquante : ${file}.sig`); process.exit(1); }
  const signature = readFileSync(p + '.sig', 'utf8').trim();
  const url = `https://github.com/${repo}/releases/download/${tag}/${file}`;
  for (const k of keys) platforms[k] = { signature, url };
}
if (!platforms['windows-x86_64'] && !platforms['linux-x86_64']) { console.error('Aucun installateur trouvé dans ' + dir); process.exit(1); }

const manifest = {
  version: tag.replace(/^v/, ''),
  notes: `https://github.com/${repo}/releases/tag/${tag}`,
  pub_date: new Date().toISOString(),
  platforms
};
writeFileSync(join(dir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`latest.json : ${manifest.version} · ${Object.keys(platforms).join(', ')}`);
