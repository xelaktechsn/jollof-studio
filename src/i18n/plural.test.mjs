// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pluriels de l'interface : forme {k:un|plusieurs} de tl() et tn(), règles du français (0 et 1 au singulier) et de
// l'anglais (1 seulement), dictionnaire anglais sans « (s) » pour ces textes. node --test src/i18n/plural.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./index.js', import.meta.url));
/** Évalue des appels dans une langue donnée (la langue est fixée au chargement du module). */
const run = (lang, code) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
  `const m = await import(${JSON.stringify(here)}); await m.loadLanguage(); const { tl, tn, isOne } = m; process.stdout.write(JSON.stringify(${code}));`], { env: { ...process.env, JOLLOF_LANG: lang } }).toString());

test('français : 0 et 1 au singulier, nombres écrits en texte relus', () => {
  const r = run('fr', `[tl('{0:# câble|# câbles} et {1:# baie|# baies}', 0, 3), tl('{0:# câble|# câbles}', 1), tl('{0:# câble|# câbles}', 2), tl('{0:# câble|# câbles}', '1 234'), tl('{0:# lien|# liens}', '1,5'), tn(1, '{0} lien', '{0} liens', 1), tn(5, '{0} lien', '{0} liens', 5), isOne('abc'), tl('{0} et {1:# x|# xs}', 'a', 2)]`);
  assert.deepEqual(r, ['0 câble et 3 baies', '1 câble', '2 câbles', '1 234 câbles', '1,5 lien', '1 lien', '5 liens', false, 'a et 2 xs']);
});

test('anglais : 1 seulement au singulier, traductions des formes plurielles', () => {
  const r = run('en', `[tl('{0:# équipement|# équipements} · {1:# câble|# câbles}', 1, 0), tl('{0:# équipement|# équipements} · {1:# câble|# câbles}', 2, 1), tl('Problèmes : {0:# erreur|# erreurs}, {1:# avertissement|# avertissements}', 0, 1)]`);
  assert.deepEqual(r, ['1 device · 0 cables', '2 devices · 1 cable', 'Problems: 0 errors, 1 warning']);
});

test('dictionnaire : chaque texte au pluriel garde ses nombres en anglais, sans « (s) »', async () => {
  const en = (await import('./en.js')).default;
  const bad = Object.entries(en).filter(([k, v]) => /\{\d+:/.test(k) && /\((s|es|ies)\)/.test(v));
  assert.deepEqual(bad, []);
  // Chaque bloc {k:…} est bien formé (une barre entre les deux formes), dans la clé comme dans la traduction.
  const open = s => (s.match(/\{\d+:/g) || []).length, whole = s => (s.match(/\{\d+:[^{}|]*\|[^{}]*\}/g) || []).length;
  for (const [k, v] of Object.entries(en)) if (/\{\d+:/.test(k)) { assert.equal(whole(k), open(k), k); assert.equal(whole(String(v)), open(String(v)), k); }
});
