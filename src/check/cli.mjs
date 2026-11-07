#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérifie un projet comme « cargo check » : node src/check/cli.mjs mon-projet.jollof [--en]
// Affiche les diagnostics à la manière de rustc et sort avec le code 1 s'il reste une erreur.
import fs from 'node:fs';

const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage : node src/check/cli.mjs projet.jollof [--en]'); process.exit(2); }
if (args.includes('--en')) { process.env.JOLLOF_LANG = 'en'; const i18n = await import('../i18n/index.js'); if (i18n.loadLanguage) await i18n.loadLanguage(); }
const { loadProject } = await import('./load.js');
const { checkProject } = await import('./check.js');
const { formatReport } = await import('./format.js');
const proj = loadProject(JSON.parse(fs.readFileSync(file, 'utf8')));
const r = checkProject(proj);
console.log(formatReport(r, proj.programs));
process.exit(r.errors ? 1 : 0);
