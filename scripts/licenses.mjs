// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Inventaire des licences de tout ce que l'application livre : paquets npm de production, crates Rust de
// l'application de bureau, modèles 3D, polices. Écrit THIRD_PARTY.md (dépôt) et src/library/third-party.json
// (écran « Crédits et licences »), et signale ce qui poserait problème avec l'AGPL ou la licence commerciale.
// Usage : node scripts/licenses.mjs [--check]   (--check : code de sortie 1 s'il y a un problème)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// Licences sans obligation gênante pour une diffusion AGPL ou commerciale (permissives, ou faiblement copyleft
// quand le composant reste un module séparé et remplaçable).
const OK = new Set(['MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0', 'Apache-2.0 WITH LLVM-exception', 'Zlib',
  'Unlicense', 'CC0-1.0', 'BSL-1.0', 'Unicode-DFS-2016', 'Unicode-3.0', 'OFL-1.1', 'CC-BY-4.0', 'Python-2.0', 'BlueOak-1.0.0', 'WTFPL']);
// Acceptées sous condition (notées dans le rapport) : module séparé (LGPL), fichiers sous la même licence (MPL, CC-BY-SA).
const COND = { 'LGPL-2.1': 'module WebAssembly séparé et remplaçable', 'LGPL-2.1-only': 'module séparé et remplaçable', 'LGPL-2.1-or-later': 'module séparé et remplaçable',
  'MPL-2.0': 'copyleft par fichier : les fichiers MPL restent sous MPL', 'CC-BY-SA-4.0': 'modèles 3D : les fichiers convertis restent sous CC-BY-SA, crédit obligatoire' };
/** Une expression SPDX (« MIT OR Apache-2.0 ») est acceptable si l'une des branches d'un OR l'est, toutes celles d'un AND. */
function verdict(expr) {
  const e = String(expr || '').replace(/[()]/g, '').trim();
  if (!e) return { ok: false, why: 'licence inconnue' };
  const any = e.split(/\s+OR\s+|\//i).map(s => s.trim());
  for (const alt of any) {
    const all = alt.split(/\s+AND\s+/i).map(s => s.trim());
    if (all.every(x => OK.has(x))) return { ok: true };
    if (all.every(x => OK.has(x) || COND[x])) return { ok: true, cond: all.filter(x => COND[x]).map(x => COND[x]).join(' ; ') };
  }
  return { ok: false, why: /GPL/i.test(e) ? 'copyleft fort : incompatible avec la licence commerciale si lié à l’application' : 'licence à examiner' };
}

/* ---------- npm : dépendances de production (package-lock v3) ---------- */
function npmPackages() {
  const lock = read('package-lock.json'), out = [];
  for (const [p, info] of Object.entries(lock.packages || {})) {
    if (!p || info.dev || info.devOptional || !p.startsWith('node_modules/')) continue;
    const name = p.slice(p.lastIndexOf('node_modules/') + 13);
    let license = info.license, repo = '';
    try { const pk = JSON.parse(fs.readFileSync(path.join(ROOT, p, 'package.json'), 'utf8')); license = license || pk.license || (Array.isArray(pk.licenses) ? pk.licenses.map(l => l.type || l).join(' OR ') : null); repo = typeof pk.repository === 'string' ? pk.repository : pk.repository && pk.repository.url || pk.homepage || ''; } catch { /* paquet absent du disque */ }
    out.push({ kind: 'npm', name, version: info.version, license: typeof license === 'object' ? license.type : license, url: String(repo).replace(/^git\+/, '').replace(/\.git$/, '') });
  }
  return dedupe(out);
}

/* ---------- Rust : crates liées à l'application (dépendances normales, pas de construction ni de test) ---------- */
function cratePackages() {
  let meta = null;
  // cargo peut ne pas être dans le PATH (installation rustup) ; les crates d'autres plateformes peuvent manquer hors ligne.
  const home = process.env.HOME || process.env.USERPROFILE || '';
  for (const bin of ['cargo', path.join(home, '.cargo', 'bin', 'cargo')]) for (const offline of [['--offline'], []]) {
    if (meta) break;
    try { meta = JSON.parse(execFileSync(bin, ['metadata', '--format-version', '1', ...offline, '--manifest-path', path.join(ROOT, 'src-tauri/Cargo.toml')], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { /* essai suivant */ }
  }
  if (!meta) return null; // cargo absent : la section est omise, le rapport le dit
  const byId = new Map(meta.packages.map(p => [p.id, p])), nodes = new Map(meta.resolve.nodes.map(n => [n.id, n]));
  const seen = new Set(), stack = [meta.resolve.root];
  while (stack.length) {
    const id = stack.pop(); if (seen.has(id)) continue; seen.add(id);
    for (const d of (nodes.get(id) || { deps: [] }).deps) if (d.dep_kinds.some(k => k.kind == null)) stack.push(d.pkg);
  }
  seen.delete(meta.resolve.root);
  return dedupe([...seen].map(id => byId.get(id)).filter(Boolean).map(p => ({ kind: 'crate', name: p.name, version: p.version, license: p.license || (p.license_file ? 'voir ' + p.license_file : ''), url: p.repository || '' })));
}

/* ---------- Modèles 3D, polices, micrologiciels intégrés ---------- */
function assets() {
  const cad = read('public/cad/models.json');
  return [
    ...Object.values(cad).map(m => ({ kind: 'model', name: m.title, version: '', license: m.license, url: m.url || m.source, author: m.author })),
    { kind: 'font', name: 'Instrument Sans', version: '', license: 'OFL-1.1', url: 'https://github.com/Instrument/instrument-sans' },
    { kind: 'font', name: 'JetBrains Mono', version: '', license: 'OFL-1.1', url: 'https://github.com/JetBrains/JetBrainsMono' },
    // Mémoire morte du RP2040 (src/emu/rp2040-bootrom.js, mode fidèle du Pico), reprise de demo/bootrom.ts de rp2040js (MIT).
    { kind: 'firmware', name: 'RP2040 bootrom', version: 'B1', license: 'BSD-3-Clause', url: 'https://github.com/raspberrypi/pico-bootrom', author: 'Raspberry Pi (Trading) Ltd.' }
  ];
}

const dedupe = list => { const m = new Map(); for (const x of list) m.set(`${x.kind}|${x.name}|${x.version}`, x); return [...m.values()].sort((a, b) => a.name.localeCompare(b.name)); };

const npm = npmPackages(), crates = cratePackages(), extra = assets();
const all = [...npm, ...(crates || []), ...extra].map(x => ({ ...x, ...verdict(x.license) }));
const problems = all.filter(x => !x.ok);
const groups = {};
for (const x of all) (groups[x.license || '?'] = groups[x.license || '?'] || []).push(x);

/* ---------- THIRD_PARTY.md ---------- */
const line = x => `| ${x.kind} | ${x.url ? `[${x.name}](${x.url})` : x.name} | ${x.version || ''} | ${x.license || '?'} |`;
let md = `# Third-party components\n\nGenerated by \`node scripts/licenses.mjs\` — do not edit by hand.\n\n` +
  `Jollof Studio itself: AGPL-3.0-or-later with additional terms (see NOTICE.md), © 2026 Mamadou Sarr.\n\n` +
  `| Kind | Count |\n| --- | --- |\n| npm packages (production) | ${npm.length} |\n| Rust crates (desktop app) | ${crates ? crates.length : 'not listed: cargo unavailable'} |\n| 3D models | ${extra.filter(x => x.kind === 'model').length} |\n| Fonts | 2 |\n| Embedded firmware | ${extra.filter(x => x.kind === 'firmware').length} |\n\n`;
md += problems.length ? `## To review (${problems.length})\n\n| Kind | Name | Version | License | Why |\n| --- | --- | --- | --- | --- |\n${problems.map(x => `${line(x)} ${x.why} |`).join('\n')}\n\n` : '## To review\n\nNothing: every component is compatible with the AGPL and with the commercial licence.\n\n';
const conds = all.filter(x => x.cond);
if (conds.length) md += `## Conditions\n\n${[...new Set(conds.map(x => `- ${x.license}: ${x.cond} (${conds.filter(y => y.license === x.license).length} components)`))].join('\n')}\n\n`;
md += `## By license\n\n${Object.keys(groups).sort().map(l => `### ${l} (${groups[l].length})\n\n| Kind | Name | Version | License |\n| --- | --- | --- | --- |\n${groups[l].map(line).join('\n')}\n`).join('\n')}`;
fs.writeFileSync(path.join(ROOT, 'THIRD_PARTY.md'), md);

/* ---------- Résumé pour l'écran « Crédits et licences » ---------- */
const summary = {
  generated: new Date().toISOString().slice(0, 10),
  counts: { npm: npm.length, crates: crates ? crates.length : null, models: extra.filter(x => x.kind === 'model').length, fonts: 2, firmware: extra.filter(x => x.kind === 'firmware').length },
  licenses: Object.fromEntries(Object.keys(groups).sort().map(l => [l, groups[l].length])),
  // Composants dont l'utilisateur voit l'effet, cités nommément.
  notable: all.filter(x => ['three', 'blockly', 'occt-import-js', 'mp4-muxer', 'socket.io-client', '@tiptap/core', '@tauri-apps/api', 'tauri', 'avr8js', 'rp2040js', '@wokwi/elements', 'fflate'].includes(x.name) || x.kind === 'font' || x.kind === 'firmware')
    .map(x => ({ name: x.name, license: x.license, url: x.url }))
};
fs.writeFileSync(path.join(ROOT, 'src/library/third-party.json'), JSON.stringify(summary, null, 1) + '\n');

console.log(`${all.length} composants (${npm.length} npm, ${crates ? crates.length : '?'} crates, ${extra.length} modèles, polices et micrologiciels) ; ${problems.length} à examiner.`);
for (const p of problems) console.log(`  ! ${p.kind} ${p.name} ${p.version} — ${p.license || '?'} : ${p.why}`);
if (process.argv.includes('--check') && problems.length) process.exit(1);
