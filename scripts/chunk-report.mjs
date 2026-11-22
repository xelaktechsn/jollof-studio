// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Ce que pèse chaque morceau de la construction, et ce que contient le morceau principal (celui de src/main.js),
// par dossier : `node scripts/chunk-report.mjs [--mode pro] [--top 40]`. Rien n'est écrit dans dist/.
import { build } from 'vite';

const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
const top = +(arg('top') || 30);
const out = await build({ mode: arg('mode') || 'production', logLevel: 'silent', build: { write: false } });
const chunks = (Array.isArray(out) ? out : [out]).flatMap(o => o.output).filter(c => c.type === 'chunk');
const main = chunks.find(c => Object.keys(c.modules).some(id => id.replace(/\\/g, '/').endsWith('/src/main.js')));
const kb = n => (n / 1024).toFixed(0).padStart(6) + ' ko';
console.log('Morceaux (les plus gros) :');
for (const c of [...chunks].sort((a, b) => b.code.length - a.code.length).slice(0, 15)) console.log(kb(c.code.length), c.fileName, c === main ? '  <- principal' : '');
const by = new Map();
for (const [id, m] of Object.entries(main.modules)) {
  const p = id.replace(/\\/g, '/').replace(/^\0/, '');
  const k = p.includes('/node_modules/') ? 'npm:' + p.split('/node_modules/').pop().split('/').slice(0, p.includes('/node_modules/@') ? 2 : 1).join('/') : p.replace(/^.*\/src\//, 'src/').split('/').slice(0, top > 30 ? 3 : 2).join('/');
  by.set(k, (by.get(k) || 0) + m.renderedLength);
}
console.log(`\nMorceau principal : ${main.code.length} octets (${main.fileName}). Contenu :`);
for (const [k, n] of [...by].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(kb(n), k);
console.log('\nImports statiques du morceau principal :', main.imports.join(', ') || 'aucun');
