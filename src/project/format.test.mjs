// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// node --test src/project/format.test.mjs
// Format des projets : version du schéma et migrations. Les exemples livrés (exemples/*.jollof, enregistrés au format 1,
// la plupart sans type de projet) servent de fichiers anciens ; sans leur champ « version », ce sont des fichiers v0.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT, MIGRATIONS, migrateProject, versionOf, canOpen, ProjectFormatError } from './format.js';
import { inferKind, KINDS } from '../ui/kind.js';
import { sanitizeProject } from '../sanitize.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'exemples');
const FILES = [...fs.readdirSync(DIR).filter(f => f.endsWith('.jollof')).map(f => path.join(DIR, f)), ...fs.readdirSync(path.join(DIR, 'pro')).filter(f => f.endsWith('.jollof')).map(f => path.join(DIR, 'pro', f))];
const load = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const clone = o => JSON.parse(JSON.stringify(o));

test('les migrations se suivent de 1 à FORMAT, sans trou', () => {
  assert.deepEqual(MIGRATIONS.map(m => m.to), Array.from({ length: FORMAT }, (_, i) => i + 1));
  for (const m of MIGRATIONS) { assert.equal(typeof m.run, 'function'); assert.ok(m.note); }
});

test('version lue : absente, illisible ou négative = 0', () => {
  for (const v of [undefined, null, '2', 1.5, -1, NaN, {}, true]) assert.equal(versionOf({ version: v }), 0, String(v));
  assert.equal(versionOf({ version: 0 }), 0); assert.equal(versionOf({ version: 7 }), 7); assert.equal(versionOf(null), 0);
});

test('exemples (format 1) : migrés au format courant, sans rien perdre', () => {
  assert.ok(FILES.length >= 16);
  for (const f of FILES) {
    const raw = load(f), before = clone(raw);
    assert.equal(raw.version, 1, f);
    const { data, from, to, applied } = migrateProject(raw);
    assert.deepEqual(raw, before, 'le fichier lu ne doit pas être modifié : ' + f);
    assert.equal(from, 1); assert.equal(to, FORMAT); assert.deepEqual(applied, [2]);
    assert.equal(data.version, FORMAT);
    assert.equal(data.settings.kind, inferKind(raw), 'type écrit = type déduit : ' + f);
    assert.ok(KINDS[data.settings.kind]);
    // Tout le reste est identique : composants, fils, programmes, modules, champs propres aux exemples.
    const rest = d => { const o = clone(d); delete o.version; delete o.settings.kind; return o; };
    assert.deepEqual(rest(data), rest(raw), f);
  }
});

test('fichiers v0 (exemples sans numéro de version ni identité) : chargés comme v0 et migrés en deux étapes', () => {
  for (const f of FILES) {
    const raw = load(f); delete raw.version; delete raw.app;
    const { data, from, applied } = migrateProject(raw);
    assert.equal(from, 0); assert.deepEqual(applied, [1, 2]);
    assert.equal(data.version, FORMAT); assert.equal(data.app, 'jollof-studio');
    assert.deepEqual(data.comps, raw.comps); assert.deepEqual(data.wires, raw.wires);
    assert.deepEqual(data.settings.modules, raw.settings.modules);
    assert.deepEqual(data.settings.prog, raw.settings.prog);
    // Le résultat passe le nettoyage d'ouverture sans rien perdre de plus qu'avant la migration.
    assert.equal(sanitizeProject(data).comps.length, sanitizeProject(load(f)).comps.length);
  }
});

test('v0 minimal ou abîmé : listes manquantes créées, réglages illisibles écartés, champs inconnus gardés', () => {
  const a = migrateProject({ name: 'vieux', futur: { x: 1 } }).data;
  assert.deepEqual([a.app, a.version, a.comps, a.wires, a.name, a.futur], ['jollof-studio', FORMAT, [], [], 'vieux', { x: 1 }]);
  assert.equal(migrateProject({ comps: [], wires: [], settings: 'x' }).data.settings, undefined);
  // Type d'avant les types de projet : déduit du contenu une fois pour toutes.
  const pn = migrateProject({ comps: [], wires: [], settings: { modules: { pneu: { circuit: { elements: [{ id: 'e1' }] } } } } }).data;
  assert.equal(pn.settings.kind, 'pneu');
  const lg = migrateProject({ version: 1, comps: [], wires: [], settings: { modules: { logic: { view: 'logic', circuit: { elements: [{ id: 'g1' }], wires: [] } } } } }).data;
  assert.equal(lg.settings.kind, 'logic');
  // Un type déjà écrit n'est jamais remplacé.
  assert.equal(migrateProject({ version: 1, comps: [{ id: 'c1', type: 'uno' }], wires: [], settings: { kind: 'analog' } }).data.settings.kind, 'analog');
  // Instantané sans réglages : aucun réglage inventé.
  assert.equal('settings' in migrateProject({ version: 1, comps: [], wires: [] }).data, false);
});

test('déjà au format courant : aucune migration, contenu identique', () => {
  const cur = migrateProject(load(FILES[0])).data, again = migrateProject(cur);
  assert.deepEqual(again.applied, []); assert.deepEqual(again.data, cur); assert.notEqual(again.data, cur);
});

test('fichier plus récent que l’application : refusé avec un message clair, rien n’est touché', () => {
  const raw = { ...load(FILES[0]), version: FORMAT + 1, nouveau: { champ: 'que cette version ne connaît pas' } }, before = clone(raw);
  assert.equal(canOpen(raw), false); assert.equal(canOpen(load(FILES[0])), true);
  assert.throws(() => migrateProject(raw), e => {
    assert.ok(e instanceof ProjectFormatError); assert.equal(e.code, 'too-new'); assert.equal(e.version, FORMAT + 1); assert.equal(e.supported, FORMAT);
    assert.match(e.message, /plus récente/); assert.match(e.message, new RegExp(`format ${FORMAT + 1}`)); assert.match(e.message, /Mettez l’application à jour/);
    return true;
  });
  assert.deepEqual(raw, before);
  assert.throws(() => migrateProject(raw, { msg: { tooNew: 'newer file ({0} > {1})' } }), /newer file \(3 > 2\)/);
});

test('ce qui n’est pas un projet : refusé', () => {
  for (const x of [null, undefined, 'texte', 12, []]) assert.throws(() => migrateProject(x), e => e.code === 'not-project');
});

test('migrations ordonnées : chacune une fois, dans l’ordre, à partir de la version du fichier', () => {
  const seen = [], mk = to => ({ to, note: 'n', run(d) { seen.push(to); d.trail = [...(d.trail || []), to]; return d; } });
  const migrations = [mk(1), mk(2), mk(3), mk(4)];
  assert.deepEqual(migrateProject({}, { migrations, format: 4 }).data.trail, [1, 2, 3, 4]);
  seen.length = 0;
  const r = migrateProject({ version: 2 }, { migrations, format: 4 });
  assert.deepEqual(seen, [3, 4]); assert.deepEqual(r.applied, [3, 4]); assert.equal(r.data.version, 4);
  // Une application plus ancienne (format 2) ne joue pas les migrations suivantes.
  assert.deepEqual(migrateProject({}, { migrations, format: 2 }).applied, [1, 2]);
  // Trou ou désordre dans la liste : erreur, jamais une migration sautée en silence.
  assert.throws(() => migrateProject({}, { migrations: [mk(1), mk(3)], format: 3 }), /désordonnées/);
  assert.throws(() => migrateProject({}, { migrations: [mk(1)], format: 2 }), /aucune migration/);
});
