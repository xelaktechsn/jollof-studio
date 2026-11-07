// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Copie les médias de Blockly (sons, curseurs, icônes) dans public/blockly/media/ : l'éditeur de
// blocs les charge depuis l'application elle-même (hors ligne, CSP 'self'), jamais depuis Internet.
// À relancer après une mise à jour de Blockly : node scripts/blockly-media.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'node_modules/blockly/media'), to = path.join(root, 'public/blockly/media');
if (!fs.existsSync(from)) { console.error('Blockly absent : lancez d’abord npm install.'); process.exit(1); }
fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });
const files = fs.readdirSync(from).filter(f => fs.statSync(path.join(from, f)).isFile());
for (const f of files) fs.copyFileSync(path.join(from, f), path.join(to, f));
console.log(`${files.length} fichiers copiés dans public/blockly/media/`);
