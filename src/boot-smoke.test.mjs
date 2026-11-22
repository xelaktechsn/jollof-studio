// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Test de démarrage, sans navigateur : chaque élément de la page que le code va chercher par son identifiant
// ($('#id'), getElementById('id'), querySelector('#id')) existe dans index.html ou est créé par le code (gabarit
// HTML, `.id = '…'`). Un bouton retiré de index.html alors que main.js lui pose encore un gestionnaire fait échouer
// le démarrage entier (« null is not an object ») : c'est arrivé avec #benchBtn, ce test l'attrape.
// node --test src/boot-smoke.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(SRC);
const read = f => fs.readFileSync(f, 'utf8');
const ID = '[A-Za-z][\\w-]*';

/** Identifiants posés dans un texte HTML ou dans du code qui écrit du HTML : id="x", id='x', id=x, el.id = 'x'. */
export function idsIn(text) {
  const out = new Set();
  for (const m of text.matchAll(new RegExp(`\\bid=\\\\?["']?(${ID})(?=[\\\\"'\\s>])`, 'g'))) out.add(m[1]);
  for (const m of text.matchAll(new RegExp(`\\.id\\s*=\\s*['"\`](${ID})['"\`]`, 'g'))) out.add(m[1]);
  for (const m of text.matchAll(new RegExp(`setAttribute\\(\\s*['"]id['"]\\s*,\\s*['"](${ID})['"]`, 'g'))) out.add(m[1]);
  return out;
}
/** Identifiants cherchés par le code : [{ id, line }] ; seuls les sélecteurs écrits en clair comptent (pas `#${x}`). */
export function idsUsed(code) {
  const out = [];
  const add = (id, at) => out.push({ id, line: code.slice(0, at).split('\n').length });
  // $('#id'), $('#id .enfant'), querySelector('#id …'), querySelectorAll, closest ne compte pas (il peut ne rien trouver).
  for (const m of code.matchAll(new RegExp(`(?:\\$|\\bquerySelector(?:All)?|\\bclick|\\bshown)\\(\\s*['"\`]#(${ID})(?=[\\s'"\`.:>\\[,])(?!['"\`]\\s*\\+)`, 'g'))) add(m[1], m.index); // « '#tab-' + id » : identifiant calculé, ignoré
  for (const m of code.matchAll(new RegExp(`getElementById\\(\\s*['"\`](${ID})['"\`]\\s*\\)`, 'g'))) add(m[1], m.index);
  return out;
}
/** Modules importés statiquement depuis `entry` (ce qui se charge au démarrage), fichiers .js de src seulement. */
export function staticGraph(entries) {
  const seen = new Set(), todo = [...entries];
  while (todo.length) {
    const f = todo.pop(); if (seen.has(f) || !fs.existsSync(f)) continue;
    seen.add(f);
    const code = read(f);
    for (const m of code.matchAll(/^\s*(?:import|export)\s[^'"\n]*?['"](\.{1,2}\/[^'"]+\.js)['"]/gm)) todo.push(path.resolve(path.dirname(f), m[1]));
    for (const m of code.matchAll(/^\s*import\s+['"](\.{1,2}\/[^'"]+\.js)['"]/gm)) todo.push(path.resolve(path.dirname(f), m[1]));
  }
  return [...seen];
}
const allJs = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? allJs(path.join(dir, e.name)) : /\.js$/.test(e.name) ? [path.join(dir, e.name)] : []));

/**
 * Identifiants cherchés au démarrage et introuvables : [{ id, file, line }]. html : le texte de index.html.
 * created : les identifiants que le code crée lui-même (tous les modules de src, chargés à la demande compris).
 */
export function missingIds(html, files, created) {
  const have = new Set([...idsIn(html), ...created]), out = [];
  for (const f of files) for (const u of idsUsed(read(f))) if (!have.has(u.id)) out.push({ ...u, file: path.relative(ROOT, f) });
  return out;
}

const HTML = read(path.join(ROOT, 'index.html'));
const EVERY = allJs(SRC);
const CREATED = new Set(EVERY.flatMap(f => [...idsIn(read(f))]));
// main.js est importé par boot.js une fois la langue chargée (import dynamique) : les deux sont le démarrage.
const BOOT = staticGraph([path.join(SRC, 'boot.js'), path.join(SRC, 'main.js')]);

test('démarrage : le graphe statique part de boot.js et de main.js', () => {
  const rel = BOOT.map(f => path.relative(SRC, f));
  for (const f of ['boot.js', 'main.js', 'ui/shell.js', 'ui/home.js', 'prog/panel.js']) assert.ok(rel.includes(f), f + ' absent du graphe de démarrage');
  assert.ok(BOOT.length > 60, 'graphe de démarrage trop petit : ' + BOOT.length);
});

test('démarrage : chaque identifiant cherché par le code du démarrage existe dans index.html ou est créé par le code', () => {
  const miss = missingIds(HTML, BOOT, CREATED);
  assert.deepEqual(miss.map(m => `#${m.id} (${m.file}:${m.line})`), []);
});

test('tout le code : même règle pour les modules chargés à la demande', () => {
  const miss = missingIds(HTML, EVERY, CREATED);
  assert.deepEqual(miss.map(m => `#${m.id} (${m.file}:${m.line})`), []);
});

test('l’incident #benchBtn : un bouton retiré de index.html est signalé, avec la ligne de main.js', () => {
  assert.match(HTML, /id="benchBtn"/);
  const broken = HTML.replace(/<button[^>]*id="benchBtn"[\s\S]*?<\/button>/, '');
  assert.doesNotMatch(broken, /id="benchBtn"/);
  const miss = missingIds(broken, BOOT, CREATED).filter(m => m.id === 'benchBtn');
  assert.ok(miss.length >= 1, 'la disparition de #benchBtn devrait être signalée');
  assert.ok(miss.every(m => m.file === 'src/main.js'));
});

test('lecteurs : formes d’identifiants reconnues', () => {
  assert.deepEqual([...idsIn('<a id="x1"></a><b id=\'y-2\'></b> el.id = \'z3\'; `<i id="k${n}">`')].sort(), ['x1', 'y-2', 'z3']);
  assert.deepEqual(idsUsed("$('#a').x; document.getElementById('b'); q.querySelector('#c .d'); $(`#${dyn}`); $('#pane-' + id); $('.e')").map(u => u.id), ['a', 'c', 'b']);
});
