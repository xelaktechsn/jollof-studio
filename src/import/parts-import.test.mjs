// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de l'import de pièces Fritzing (.fzpz) et de symboles KiCad (.kicad_sym) : node --test src/import/parts-import.test.mjs
// Les pièces et symboles d'essai (src/import/fixtures) sont écrits à la main pour Jollof Studio : aucune pièce de
// Fritzing ni symbole de KiCad n'y est copié.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { readFzpz, importFritzing, parseTransform, toMm, svgGeometry } from './fritzing.js';
import { parseSexpr, importKicadSymbols, symbolDraft, suggestPin } from './kicadsym.js';
import { parseXml, sanitizeSvg } from './xml.js';
import { validateManifest, validateSymbol, packJpart, unpackJpart } from '../library/jpart.js';

const FX = new URL('./fixtures/', import.meta.url);
const read = p => fs.readFileSync(new URL(p, FX), 'utf8');
/** Archive .fzpz comme celles qu'exporte Fritzing : part.<nom>.fzp et svg.breadboard.<nom>.svg. */
const fzpz = (fzp, svg, extra = {}) => zipSync({ [`part.${fzp}`]: strToU8(read(`fritzing/${fzp}`)), ...(svg ? { [`svg.breadboard.${svg}`]: strToU8(read(`fritzing/${svg}`)) } : {}), ...extra });
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.01, `${what} : ${a} au lieu de ${b}`);

test('XML : entités de base seulement, DTD ignorée, documents mal formés refusés', () => {
  const x = parseXml('<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "BOOM">]><a t="&lt;&amp;&#65;&#x42;&x;"><b>t&gt;</b><![CDATA[<c>]]></a>');
  assert.equal(x.attrs.t, '<&AB&x;', 'aucune entité déclarée n’est développée');
  assert.equal(x.children[0].text, 't>'); assert.equal(x.text, '<c>');
  assert.throws(() => parseXml('<a><b></a>'), /inattendue/);
  assert.throws(() => parseXml('<a>'), /non fermée/);
  assert.throws(() => parseXml('<a/><b/>'), /un seul élément racine/);
  assert.throws(() => parseXml('<a x=1/>'), /mal formée/);
  assert.throws(() => parseXml('<a>' + '<b>'.repeat(200) + '</b>'.repeat(200) + '</a>'), /trop profonde/);
  const proto = parseXml('<a __proto__="x" constructor="y"/>');
  assert.equal(proto.attrs.__proto__, 'x'); assert.equal(({}).x, undefined);
});

test('SVG : seul le dessin est gardé', () => {
  const s = sanitizeSvg(read('fritzing/relay_bb.svg'));
  assert.doesNotMatch(s, /script|alert/);
  assert.match(s, /fill="url\(#gr\)"/, 'les dégradés locaux restent');
  assert.match(s, /id="connector2pin"/);
  const evil = sanitizeSvg('<svg><use xlink:href="http://evil/x.svg#a"/><use href="#ok"/><image href="x.png"/><rect style="fill:url(https://evil/x)" onclick="x"/><g><foreignObject><div/></foreignObject></g></svg>');
  assert.doesNotMatch(evil, /evil|image|onclick|foreignObject|div/);
  assert.match(evil, /<use href="#ok"\/>/);
  assert.throws(() => sanitizeSvg('<html/>'), /racine doit être <svg>/);
});

test('Géométrie SVG : unités, transformations, tracés', () => {
  near(toMm('0.6in'), 15.24, 'pouces'); near(toMm('40mm'), 40, 'mm'); near(toMm('90'), 25.4, 'px à 90 ppp'); near(toMm('72pt'), 25.4, 'points');
  assert.deepEqual(parseTransform('translate(10, 5) scale(2)'), [2, 0, 0, 2, 10, 5]);
  const r = parseTransform('rotate(90 300 100)'); near(r[0] * 300 + r[2] * 100 + r[4], 300, 'rotation autour d’un point (x)'); near(r[1] * 300 + r[3] * 100 + r[5], 100, 'rotation (y)');
  const g = svgGeometry(read('fritzing/relay_bb.svg'), ['connector0pin', 'connector1pin', 'connector2pin', 'connector3pin', 'absent']);
  assert.deepEqual([g.w, g.l], [40, 20]);
  near(g.at.connector0pin[0], 5, 'cercle dans une matrice'); near(g.at.connector0pin[1], 17, 'cercle (y)');
  near(g.at.connector1pin[0], 7.54, 'groupe imbriqué');
  near(g.at.connector2pin[0], 10.08, 'tracé relatif (h, v, z)');
  near(g.at.connector3pin[0], 30, 'rotation'); near(g.at.connector3pin[1], 10, 'rotation (y)');
  assert.equal(g.at.absent, undefined);
});

test('Fritzing : pièce lue, broches placées d’après le dessin, brouillon valide et empaquetable', () => {
  const r = importFritzing(readFzpz(fzpz('photocell.fzp', 'photocell_bb.svg', { 'notes.txt': strToU8('ignoré') })));
  const m = r.manifest;
  assert.equal(m.name, 'Photocell Light Sensor'); assert.equal(m.prefix, 'LDR'); assert.equal(m.category, 'Capteurs');
  assert.match(m.id, /^pk-photocell-light-sensor-[a-z0-9]+$/);
  assert.equal(m.description, 'Light sensor module with an analog output and a comparator output.', 'balises HTML retirées');
  assert.deepEqual(m.docs.specs, [['family', 'Light Sensor'], ['supply', '3.3-5V']]);
  assert.deepEqual(m.look, { kind: 'svg', size: [15.24, 1.6, 30.48] });
  assert.deepEqual(m.pins.map(p => [p.name, p.kind, p.need || '']), [['VCC', 'pwr', ''], ['GND', 'gnd', ''], ['DO', 'io', 'in'], ['AO', 'io', 'adc']]);
  // Bornes (terminal) au bas du dessin, au pas de 2,54 mm, plaquette centrée.
  [-3.048, -0.508, 2.032, 4.572].forEach((x, i) => { near(m.pins[i].x, x, `${m.pins[i].name} x`); near(m.pins[i].z, 13.716, `${m.pins[i].name} z`); });
  assert.equal(m.pins[0].why, 'Supply voltage');
  assert.deepEqual(r.report.placed, ['VCC', 'GND', 'DO', 'AO']); assert.deepEqual(r.report.estimated, []);
  assert.ok(validateManifest(m).ok, JSON.stringify(validateManifest(m).errors));
  const back = unpackJpart(packJpart({ manifest: m, svg: r.svg }));
  assert.match(back.svg, /connector3terminal/);
});

test('Fritzing : unités en mm, noms en double, connecteur absent du dessin, script retiré', () => {
  const r = importFritzing(readFzpz(fzpz('relay.fzp', 'relay_bb.svg')));
  const m = r.manifest, by = n => m.pins.find(p => p.name === n);
  assert.deepEqual(m.pins.map(p => p.name), ['IN', 'GND', 'GND2', 'VCC_+5V', 'NO']);
  assert.deepEqual(m.pins.map(p => p.kind), ['io', 'gnd', 'gnd', 'pwr', 'contact']);
  assert.equal(by('IN').need, 'out', 'entrée du module : commandée par la carte');
  near(by('IN').x, -15, 'IN x'); near(by('IN').z, 7, 'IN z'); near(by('GND2').x, -9.92, 'GND2 x'); near(by('VCC_+5V').x, 10, 'VCC x'); near(by('VCC_+5V').z, 0, 'VCC z');
  assert.deepEqual(r.report.estimated, ['NO']); near(by('NO').z, 8.5, 'broche estimée sur le bord avant');
  assert.equal(m.category, 'Sorties'); assert.equal(m.prefix, 'K');
  assert.doesNotMatch(r.svg, /script/);
  assert.ok(validateManifest(m).ok);
  // Sans dessin : plaquette simple, broches en rangée.
  const bare = importFritzing(readFzpz(fzpz('relay.fzp', null)));
  assert.equal(bare.manifest.look.kind, 'module'); assert.equal(bare.report.estimated.length, 5); assert.equal(bare.svg, null);
  assert.throws(() => importFritzing({ 'a.svg': '<svg/>' }), /\.fzp introuvable/);
  assert.throws(() => readFzpz(strToU8('pas un zip')), /illisible/);
});

test('KiCad : expressions S (chaînes échappées), refus des fichiers invalides', () => {
  assert.deepEqual(parseSexpr('(a "b \\"c\\"" (d 1.5) e)'), ['a', 'b "c"', ['d', '1.5'], 'e']);
  assert.throws(() => parseSexpr('(a (b)'), /non fermée/);
  assert.throws(() => parseSexpr('(a))'), /en trop/);
  assert.throws(() => parseSexpr('(a "x)'), /inattendu/);
  assert.throws(() => importKicadSymbols('(kicad_sch (version 1))'), /pas une bibliothèque de symboles/);
  assert.deepEqual(suggestPin('power_in', 'GND'), { kind: 'gnd' });
  assert.deepEqual(suggestPin('input', 'MOSI'), { kind: 'io', need: 'mosi' });
  assert.deepEqual(suggestPin('tri_state', 'D0'), { kind: 'io', need: 'io' });
});

test('KiCad : symboles, broches et types électriques, dessin converti (y inversé, arcs, unités)', () => {
  const syms = importKicadSymbols(read('kicad/jollof_test.kicad_sym'));
  assert.deepEqual(syms.map(s => s.name), ['JS_REG_5V', 'JS_LIGHT_SENSOR', 'JS_LIGHT_SENSOR_B', 'JS_DUAL_COMP']);
  const [reg, light, lightB, comp] = syms;
  assert.equal(reg.description, 'Hand-written 5 V linear regulator for the Jollof Studio tests'); assert.equal(reg.reference, 'U');
  assert.deepEqual(reg.pins.map(p => [p.key, p.number, p.type, p.suggest.kind]), [['VI', '1', 'power_in', 'pwr'], ['GND', '2', 'power_in', 'gnd'], ['VO', '3', 'power_out', 'passive']]);
  assert.deepEqual(reg.symbol.pins, { VI: { x: -7.62, y: 0, dir: 'l' }, GND: { x: 0, y: 5.08, dir: 'd' }, VO: { x: 7.62, y: 0, dir: 'r' } });
  assert.deepEqual(reg.symbol.rects, [{ x: -5.08, y: -2.54, w: 10.16, h: 5.08, lw: 0.254, fill: false }]);
  assert.ok(reg.symbol.texts.some(t => t.t === '5V'));
  assert.deepEqual(light.pins.map(p => [p.key, p.suggest.kind, p.suggest.need || '']), [['VCC', 'pwr', ''], ['GND', 'gnd', ''], ['OUT', 'io', 'in'], ['EN', 'io', 'out'], ['SDA', 'io', 'sda'], ['SCL', 'io', 'scl'], ['INT', 'io', 'pullup'], ['8', 'passive', ''], ['NC', 'nc', '']]);
  assert.equal(light.description, 'Hand-written "light" sensor with I2C');
  assert.equal(light.symbol.circles[0].fill, true); assert.deepEqual([light.symbol.circles[0].x, light.symbol.circles[0].y], [0, -3.81]);
  const [a3, old] = light.symbol.arcs;
  assert.deepEqual([a3.x, a3.y, a3.r], [0, 0, 1.27]); near(Math.sin((a3.a0 + a3.a1) / 2), -1, 'l’arc passe par le haut (y vers le bas)');
  assert.deepEqual([old.x, old.y, old.r], [0, 2, 2]);
  assert.deepEqual(lightB.pins.map(p => p.key), light.pins.map(p => p.key), 'symbole dérivé : dessin et broches du parent');
  assert.equal(lightB.description, light.description);
  assert.equal(comp.multi, true);
  assert.deepEqual(comp.pins.map(p => p.key).sort(), ['+', '-', '1', 'V+', 'V-'].sort(), 'unité 1 et broches communes seulement');
  assert.equal(comp.symbol.circles.length, 0, 'style De Morgan ignoré');
  assert.ok(!comp.symbol.texts.some(t => t.t === '+'), 'noms de broches cachés');
});

test('KiCad : brouillon de paquet valide, symbole utilisé par le schéma', () => {
  for (const s of importKicadSymbols(read('kicad/jollof_test.kicad_sym'))) {
    const d = symbolDraft(s);
    const v = validateManifest(d.manifest);
    assert.ok(v.ok, `${s.name} : ${(v.errors || []).join(' ; ')}`);
    assert.ok(validateSymbol(d.symbol, d.manifest.pins.map(p => p.name)).ok, s.name);
    const back = unpackJpart(packJpart(d));
    assert.deepEqual(Object.keys(back.symbol.pins).sort(), d.manifest.pins.map(p => p.name).sort());
  }
  const d = symbolDraft(importKicadSymbols(read('kicad/jollof_test.kicad_sym'))[1]);
  assert.equal(d.manifest.prefix, 'S'); assert.equal(d.manifest.category, 'Capteurs');
  assert.deepEqual(d.manifest.docs.specs[0], ['Symbole KiCad', 'JS_LIGHT_SENSOR']);
  assert.equal(d.manifest.pins.find(p => p.name === 'INT').need, 'pullup');
});
