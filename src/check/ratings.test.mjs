// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Couverture des valeurs nominales : node --test src/check/ratings.test.mjs
// Chaque composant de la bibliothèque (PARTS) et chaque carte (BOARDS) a toutes les valeurs maximales et conseillées de
// sa famille, chacune citée (sources.js) ; une valeur que le fabricant ne publie pas est null avec sa raison (gap).
import test from 'node:test';
import assert from 'node:assert/strict';
import { RATINGS, CLASS_FIELDS } from './ratings.js';
import { SOURCES } from './sources.js';
import * as LIM from './limits.js';
import { PARTS } from '../sim/parts.js';
import { BOARDS, boardOf } from '../sim/boards.js';

const IN_NEEDS = new Set(['out', 'pwm', 'io', 'sda', 'scl', 'sck', 'mosi', 'ss', 'rx']); // la carte pilote cette entrée
const OUT_NEEDS = new Set(['in', 'adc', 'io', 'sda', 'miso', 'tx', 'irq']); // le composant pilote la carte
const BUS_NEEDS = new Set(['sda', 'scl', 'sck', 'mosi', 'miso', 'ss', 'rx', 'tx']);

/** Champs exigés pour ce composant : ceux de sa famille, plus ceux que ses broches rendent nécessaires. */
export function required(type) {
  const r = RATINGS[type], f = [...CLASS_FIELDS[r.cls]];
  if (r.cls === 'module' || r.cls === 'chip') {
    const needs = (PARTS[type].pins || []).filter(p => p.kind === 'io').map(p => p.need);
    if (needs.some(n => IN_NEEDS.has(n))) f.push('vio', 'vih');
    if (needs.some(n => OUT_NEEDS.has(n))) f.push('iout');
    if (needs.some(n => BUS_NEEDS.has(n))) f.push('fmax');
  }
  return f;
}
const srcList = s => (s == null ? [] : [].concat(s));

test('chaque composant de la bibliothèque a ses valeurs nominales, ou la raison de leur absence', () => {
  const missing = [];
  for (const type of Object.keys(PARTS)) {
    const r = RATINGS[type];
    if (!r) { missing.push(`${type} : aucune entrée`); continue; }
    assert.ok(CLASS_FIELDS[r.cls], `${type} : famille inconnue ${r.cls}`);
    for (const f of required(type)) {
      const v = r[f], why = r.gap && r.gap[f];
      if (v == null && !(typeof why === 'string' && why.trim())) missing.push(`${type}.${f}`);
      if (v != null && why) missing.push(`${type}.${f} : valeur et raison d'absence à la fois`);
    }
  }
  assert.deepEqual(missing, []);
  assert.deepEqual(Object.keys(RATINGS).filter(k => !PARTS[k]), [], 'entrées sans composant');
});

test('chaque valeur nominale cite une fiche (ou se dit seuil de conception)', () => {
  for (const [type, r] of Object.entries(RATINGS)) {
    const src = srcList(r.src);
    for (const k of src) assert.ok(SOURCES[k], `${type} : source inconnue ${k}`);
    const fields = required(type), known = fields.filter(f => r[f] != null);
    if (src.length) continue;
    // Sans fiche : instrument virtuel, seuil de conception expliqué, ou aucune valeur donnée.
    assert.ok((r.cls === 'virtual' && r.why) || (typeof r.design === 'string' && r.design) || !known.length, `${type} : valeurs sans source`);
  }
});

test('valeurs cohérentes : plages croissantes, nombres positifs, mêmes chiffres que les fiches de câblage', () => {
  for (const [type, r] of Object.entries(RATINGS)) {
    for (const f of required(type)) {
      const v = r[f]; if (v == null) continue;
      if (Array.isArray(v)) assert.ok(v.length === 2 && v[0] > 0 && v[0] < v[1], `${type}.${f}`);
      else if (typeof v === 'number') assert.ok(v > 0, `${type}.${f}`);
      else assert.ok(v.abs > 0 || v.over >= 0 || v.k > 0 || v.v > 0, `${type}.${f}`);
    }
    if (r.vabs != null && Array.isArray(r.vcc)) assert.ok(r.vabs >= r.vcc[1], `${type} : maximum absolu sous la plage conseillée`);
    const spec = PARTS[type], pw = (spec.pins || []).filter(p => p.kind === 'pwr' && Array.isArray(p.v));
    // L'alimentation que vérifie le câblage (J0105, J0106) est celle des valeurs nominales.
    if ((r.cls === 'module' || r.cls === 'chip') && pw.length === 1 && r.vcc) assert.deepEqual(pw[0].v, r.vcc, `${type} : plage d'alimentation`);
    if ((r.cls === 'module' || r.cls === 'chip') && spec.ma != null && r.ma != null) assert.equal(spec.ma, r.ma, `${type} : consommation`);
  }
});

test('chaque carte a ses limites électriques, citées', () => {
  for (const type of Object.keys(BOARDS)) {
    const b = LIM.boardLimits({ type, pins: {} }), prof = boardOf({ type });
    for (const f of ['pin', 'total', 'five', 'three', 'vmax', 'vmin', 'vih', 'vil']) assert.ok(b[f] != null, `${type}.${f}`);
    assert.ok(prof.vin && prof.vin.min < prof.vin.max, `${type}.vin`);
    // 3,3 V : aucune GPIO n'accepte 5 V (VDD + 0,3 V au plus) ; 5 V : VCC + 0,5 V.
    assert.ok(prof.logic < 4 ? b.vmax < 4 : b.vmax <= 5.5, `${type}.vmax`);
    if (b.groups) assert.ok(LIM.PORT_GROUPS[b.groups], `${type}.groups`);
  }
  // Chaque broche numérique d'un ATmega appartient à un port connu, donc à ses groupes de courant.
  for (const type of ['uno', 'nano', 'mega']) {
    const G = LIM.PORT_GROUPS[LIM.boardLimits({ type, pins: {} }).groups];
    for (const [k, g] of Object.entries(BOARDS[type].gpio)) if (g.caps.has('out')) {
      const port = G.port(k); assert.ok(port, `${type} ${k} : port`);
      for (const dir of ['source', 'sink']) assert.ok(G.groups.some(x => x.dir === dir && x.has(port)), `${type} ${k} (${port}) : groupe ${dir}`);
    }
  }
});

test('valeurs absentes : liste close (une nouvelle absence doit être justifiée ici)', () => {
  const gaps = Object.entries(RATINGS).flatMap(([t, r]) => required(t).filter(f => r[f] == null).map(f => `${t}.${f}`));
  // Modules génériques sans fiche (water, traffic, pressostat, cylsensor, rcwl0516), cartes de modules sans fabricant
  // identifiable, et chiffres que les fiches ne donnent pas (maxima absolus du DHT22, du HC-SR04, du HX711…).
  assert.ok(gaps.length <= 84, `${gaps.length} valeurs absentes :\n${gaps.join('\n')}`);
});
