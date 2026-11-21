// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fermeture du projet en cours (closeproject.js) avant un nouveau projet ou une ouverture : enregistrement proposé s'il a
// des modifications (annuler ou un enregistrement refusé ne ferme rien), puis animation, simulation, fenêtres des plans
// de travail, ligne dans la Sortie. Et les modules qui ont des fenêtres les ferment (close()). node --test src/ui/closeproject.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { closeSteps, closeProject } from './closeproject.js';

/** Crochets factices qui notent ce qui est fait. */
function hooks(answer, saved = true) {
  const done = [];
  return { done, ask: async () => { done.push('ask'); return answer; }, save: async () => { done.push('save'); return saved; }, finishAnim: () => done.push('anim'), stopSim: () => done.push('sim'), closeModules: () => done.push('modules'), log: () => done.push('log') };
}

test('étapes : enregistrement proposé seulement avec des modifications (pas à l’accueil du démarrage)', () => {
  assert.deepEqual(closeSteps({}), ['modules', 'log']);
  assert.deepEqual(closeSteps({ dirty: true, anim: true, simOn: true }), ['ask', 'anim', 'sim', 'modules', 'log']);
  assert.deepEqual(closeSteps({ dirty: true, homeGuard: true }), ['modules'], 'accueil : la session d’avant reste intacte, rien à demander ni à écrire');
});

test('modifications : Enregistrer, Ne pas enregistrer, Annuler, enregistrement refusé', async () => {
  let h = hooks('save');
  assert.equal(await closeProject({ dirty: true, simOn: true }, h), true);
  assert.deepEqual(h.done, ['ask', 'save', 'sim', 'modules', 'log']);
  h = hooks('discard');
  assert.equal(await closeProject({ dirty: true }, h), true);
  assert.deepEqual(h.done, ['ask', 'modules', 'log']);
  h = hooks(null);
  assert.equal(await closeProject({ dirty: true, simOn: true }, h), false);
  assert.deepEqual(h.done, ['ask'], 'annulé : simulation et fenêtres intactes, le projet reste ouvert');
  h = hooks('save', false);
  assert.equal(await closeProject({ dirty: true, simOn: true }, h), false);
  assert.deepEqual(h.done, ['ask', 'save'], 'boîte « Enregistrer » refermée : rien n’est fermé');
  h = hooks(undefined);
  assert.equal(await closeProject({ dirty: false, anim: true }, h), true);
  assert.deepEqual(h.done, ['anim', 'modules', 'log']);
});

test('main.js : chaque chemin qui remplace le projet passe par closeCurrent ; les modules à fenêtres ont close()', () => {
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const body = name => { const i = main.indexOf(name); assert.ok(i >= 0, name); return main.slice(i, main.indexOf('\n}\n', i)); };
  for (const f of ['async function newProject(', 'async function openProjectFile(', 'async function openLaunchedFile(', 'async function loadExample(', 'async function importWokwiFiles(']) {
    const b = body(f), c = b.indexOf('closeCurrent()'), r = Math.max(b.indexOf('restore('), b.indexOf('clearProject('), b.indexOf('openProjectText('));
    assert.ok(c > 0 && c < r, `${f} : closeCurrent() avant de remplacer le projet`);
  }
  assert.match(body('async function closeCurrent('), /closeModules: \(\) => S\.modules\.forEach\(m => \{ if \(m\.close\)/);
  const net = fs.readFileSync(new URL('../net/ui/install.js', import.meta.url), 'utf8'), pneu = fs.readFileSync(new URL('../pneu/index.js', import.meta.url), 'utf8');
  assert.match(net, /close\(\) \{ if \(ws\) ws\.closeWindows\(\); \}/);
  assert.match(pneu, /close\(\) \{ closeBuild\(\); close3d\(\); \}/);
  const ws = fs.readFileSync(new URL('../net/ui/workspace.js', import.meta.url), 'utf8');
  assert.match(ws.slice(ws.indexOf('function closeWindows()'), ws.indexOf('function closeWindows()') + 600), /host\.querySelectorAll\('\.nt-ov'\)\.forEach\(o => o\.remove\(\)\)/, 'fenêtres des vues aussi');
});
