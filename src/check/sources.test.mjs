// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests des sources (src/check/sources.js) : node --test src/check/sources.test.mjs
// Chaque limite du vérificateur, chaque plage d'alimentation v et chaque consommation ma d'un module cite une fiche
// technique de SOURCES ; chaque fiche est complète et sert au moins une fois.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES } from './sources.js';
import * as LIM from './limits.js';
import { PARTS, NPNS } from '../sim/parts.js';
import { BOARDS } from '../sim/boards.js';

const { LIMIT_SRC } = LIM;
/** Seuils de conception sans fiche technique (LIMIT_SRC à null), chacun justifié dans limits.js. */
const DESIGN = new Set(['SHORT_MA']);
/** Fabricants dont le site ne sert pas HTTPS : adresse HTTP d'origine. */
const HTTP_ONLY = new Set(['ams1117']);
const BOARD_FIELDS = ['pin', 'total', 'five', 'three', 'vmax'];

const used = new Set();
/** Une source : clé de SOURCES, ou liste non vide de clés. Renvoie le message d'erreur, ou '' si elle est valable. */
function bad(src) {
  const keys = Array.isArray(src) ? src : [src];
  if (!keys.length) return 'liste vide';
  for (const k of keys) {
    if (typeof k !== 'string' || !SOURCES[k]) return `source inconnue : ${JSON.stringify(k)}`;
    used.add(k);
  }
  return '';
}

/** Limites exportées par limits.js : [chemin, source]. Un objet qui porte src est couvert en entier. */
function limits() {
  const out = [];
  const walk = (path, v, map) => {
    if (typeof v === 'function') return;
    if (typeof v === 'number') { out.push([path, map]); return; }
    if (v && typeof v === 'object') {
      if ('src' in v) { out.push([path, v.src]); return; }
      for (const [k, x] of Object.entries(v)) walk(`${path}.${k}`, x, map && map[k]);
    }
  };
  for (const [name, v] of Object.entries(LIM)) if (name !== 'LIMIT_SRC') walk(name, v, LIMIT_SRC[name]);
  return out;
}

test('chaque limite de limits.js cite une source', () => {
  const all = limits();
  assert.ok(all.length >= 15, 'limites trouvées');
  for (const [path, src] of all) {
    if (src === null && DESIGN.has(path)) continue;
    assert.equal(bad(src), '', path);
  }
});

test('chaque limite de carte cite une source', () => {
  assert.deepEqual(Object.keys(LIMIT_SRC.BOARD).sort(), Object.keys(BOARDS).sort());
  for (const type of Object.keys(BOARDS)) {
    const b = LIM.boardLimits({ type, pins: {} });
    for (const f of BOARD_FIELDS) {
      assert.ok(b[f] != null, `${type}.${f} existe`);
      assert.equal(bad(LIMIT_SRC.BOARD[type][f]), '', `${type}.${f}`);
    }
  }
});

test('chaque transistor NPNS cite une source', () => {
  for (const [k, n] of Object.entries(NPNS)) assert.equal(bad(n.src), '', `NPNS.${k}`);
});

test('chaque alimentation v et chaque consommation ma de parts.js cite une source', () => {
  let n = 0;
  for (const [type, spec] of Object.entries(PARTS)) {
    for (const p of spec.pins || []) if (Array.isArray(p.v)) { n++; assert.equal(bad(p.ds), '', `${type}.${p.pin} (v)`); }
    if (spec.ma != null) { n++; assert.equal(bad(spec.ds), '', `${type} (ma)`); }
  }
  assert.ok(n >= 40, 'plages et consommations trouvées');
});

test('chaque fiche est complète et sert au moins une fois', () => {
  // Les tests précédents remplissent used ; on le recalcule ici pour ne pas dépendre de leur ordre.
  for (const [, src] of limits()) if (src != null) bad(src);
  for (const type of Object.keys(BOARDS)) for (const f of BOARD_FIELDS) bad(LIMIT_SRC.BOARD[type][f]);
  for (const n of Object.values(NPNS)) bad(n.src);
  for (const spec of Object.values(PARTS)) {
    for (const p of spec.pins || []) if (Array.isArray(p.v)) bad(p.ds);
    if (spec.ma != null) bad(spec.ds);
  }
  for (const [k, s] of Object.entries(SOURCES)) {
    for (const f of ['title', 'publisher', 'url', 'section']) assert.ok(typeof s[f] === 'string' && s[f].trim(), `${k}.${f}`);
    assert.match(s.url, HTTP_ONLY.has(k) ? /^https?:\/\/\S+$/ : /^https:\/\/\S+$/, `${k}.url`);
    if (s.mirror != null) assert.match(s.mirror, /^https:\/\/\S+$/, `${k}.mirror`);
    assert.ok(used.has(k), `${k} n'est citée nulle part`);
  }
});
