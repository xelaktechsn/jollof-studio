// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de l'écriture DXF (dxfwrite.js) par aller-retour dans notre lecteur (dxf.js), et de la structure AC1015.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDxfWriter, colorOf } from './dxfwrite.js';
import { parseDxf, KINDS } from './dxf.js';
import { lintDxf } from './dxflint.js';
import { layerDefs, layerName, LAYER_SCHEMES, LAYER_KEYS } from './layers.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const abs = d => { const o = []; for (let i = 0; i < d.segLayer.length; i++) o.push({ x0: d.segs[i * 4] + d.origin[0], y0: d.segs[i * 4 + 1] + d.origin[1], x1: d.segs[i * 4 + 2] + d.origin[0], y1: d.segs[i * 4 + 3] + d.origin[1], layer: d.layers[d.segLayer[i]].name, kind: KINDS[d.segKind[i]] }); return o; };

function sample() {
  const w = createDxfWriter({ units: 'm' });
  w.layer('RESEAU', { color: '#3b82f6' }).layer('MURS', { color: 1 }).layer('CACHE', { color: 3, off: true });
  w.line(0, 0, 10, 0, { layer: 'MURS' });
  w.polyline([[0, 0], [4, 0], [4, 3]], { layer: 'RESEAU', closed: true, bulges: [0, 1, 0] });
  w.circle(20, 20, 1.5, { layer: 'RESEAU' });
  w.arc(30, 0, 2, 0, 90, { layer: 'MURS', color: '#ff8800' });
  w.text(1, 2, 0.25, 'Prise PC-01 — 1er étage', { layer: 'RESEAU', align: 'center', valign: 'middle', rot: 90 });
  w.mtext(5, 5, 0.2, 'Ligne 1\nLigne {2} \\ fin', { layer: 'RESEAU', attach: 7, width: 3 });
  w.mtext(5, 8, 0.2, 'é'.repeat(300) + '\nx', { layer: 'RESEAU' });
  w.block('PRISE', { base: [0.5, 0] }, b => { b.circle(0.5, 0, 0.1, { layer: '0' }); b.line(0.4, 0, 0.6, 0, { layer: 'MURS' }); });
  w.insert('PRISE', 50, 50, { layer: 'RESEAU', rot: 90, sx: 2, attribs: { 'id prise': 'PC-01' } });
  return w;
}

test('structure AC1015 : sections, tables, poignées uniques, $INSUNITS', () => {
  const s = sample().toString();
  for (const k of ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']) assert.ok(s.includes(`  2\r\n${k}\r\n`), k);
  assert.ok(s.includes('$ACADVER\r\n  1\r\nAC1015') && s.includes('$INSUNITS\r\n 70\r\n6'));
  assert.ok(s.endsWith('  0\r\nEOF\r\n'));
  const lines = s.split('\r\n'), handles = [];
  for (let i = 0; i + 1 < lines.length; i += 2) if (lines[i] === '  5' || lines[i] === '105') handles.push(lines[i + 1]);
  assert.equal(new Set(handles).size, handles.length, 'poignées uniques');
  const seed = parseInt(lines[lines.indexOf('$HANDSEED') + 2], 16);
  assert.ok(handles.filter(h => parseInt(h, 16) !== seed).every(h => parseInt(h, 16) < seed), '$HANDSEED au-delà de toutes les poignées');
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(s), 'ASCII seulement');
  assert.equal(lines.length % 2, 1);
});

test('aller-retour : calques, entités, textes, blocs et attributs', async () => {
  const d = await parseDxf(sample().toString());
  assert.equal(d.units, 'm'); assert.equal(d.insunits, 6);
  const L = Object.fromEntries(d.layers.map(l => [l.name, l]));
  assert.equal(L.RESEAU.color, '#3b82f6'); assert.equal(L.MURS.color, '#ff0000'); assert.equal(L.CACHE.off, true);
  const S = abs(d);
  assert.ok(S.some(s => s.kind === 'line' && near(s.x0, 0) && near(s.x1, 10) && s.layer === 'MURS'));
  // renflement 1 de (4,0) à (4,3) : demi-cercle côté droit (x jusqu'à 5.5)
  const p = S.filter(s => s.kind === 'poly');
  assert.ok(near(Math.max(...p.map(s => Math.max(s.x0, s.x1))), 5.5, 0.0021), 'flèche ≤ tolérance (2 mm)');
  assert.ok(p.some(s => near(s.x0, 4) && near(s.y0, 3) && near(s.x1, 0) && near(s.y1, 0)), 'fermée');
  assert.ok(S.filter(s => s.kind === 'circle' && s.x0 > 18 && s.x0 < 22).every(s => near(Math.hypot(s.x0 - 20, s.y0 - 20), 1.5, 1e-5)));
  const arc = S.filter(s => s.kind === 'arc'); assert.ok(arc.length > 2);
  assert.ok(arc.every(s => d.palette[d.segColor[S.indexOf(s)]] === '#ff8800'));
  const t = d.texts.find(x => x.text.startsWith('Prise'));
  assert.equal(t.text, 'Prise PC-01 — 1er étage'); assert.equal(t.ha, 1); assert.equal(t.va, 2); assert.ok(near(t.rot, Math.PI / 2, 1e-9));
  assert.ok(near(t.x + d.origin[0], 1) && near(t.y + d.origin[1], 2));
  const m = d.texts.find(x => x.text.startsWith('Ligne'));
  assert.equal(m.text, 'Ligne 1\nLigne {2} \\ fin'); assert.equal(m.va, 1); assert.equal(m.ha, 0);
  assert.equal(d.texts.find(x => x.text.startsWith('éé')).text, 'é'.repeat(300) + '\nx', 'MTEXT en morceaux sans couper les échappements');
  // bloc : base (0.5, 0), inséré en (50, 50), rotation 90°, échelle 2 → cercle centré en (50, 50), rayon 0.2
  const c = S.filter(s => s.kind === 'circle' && s.x0 > 49);
  assert.ok(c.length >= 8 && c.every(s => near(Math.hypot(s.x0 - 50, s.y0 - 50), 0.2, 1e-5)));
  assert.ok(c.every(s => s.layer === 'RESEAU'), 'calque 0 du bloc → calque de l’INSERT');
  assert.ok(S.some(s => s.layer === 'MURS' && near(s.x0, 50) && near(s.y0, 49.8, 1e-5) && near(s.x1, 50) && near(s.y1, 50.2, 1e-5)));
  const ins = d.inserts.find(i => i.name === 'PRISE');
  assert.deepEqual(ins.attribs, { ID_PRISE: 'PC-01' }); assert.equal(ins.rot, 90); assert.equal(ins.sx, 2);
  assert.deepEqual(d.warnings, []);
});

test('couleurs : ACI le plus proche, vraie couleur gardée ; unités ; dessin vide', async () => {
  assert.deepEqual(colorOf('#ff0000'), { aci: 1, rgb: 0xff0000 });
  assert.equal(colorOf('#3b82f6').rgb, 0x3b82f6);
  assert.equal(colorOf(5).aci, 5); assert.equal(colorOf('rien').aci, 7);
  const e = await parseDxf(createDxfWriter({ units: 'mm' }).toString());
  assert.equal(e.units, 'mm'); assert.equal(e.segLayer.length, 0); assert.ok(e.layers.some(l => l.name === '0'));
  const ft = await parseDxf(createDxfWriter({ units: 'ft' }).line(0, 0, 1, 1).toString());
  assert.equal(ft.units, 'ft'); assert.equal(ft.measurement, 0);
});

test('R2000 complet : types de ligne, styles, ATTDEF/ATTRIB, présentation avec fenêtre — contrôlé par dxflint et relu', async () => {
  const w = createDxfWriter({ units: 'm' });
  w.ltype('DASHED', { desc: 'tirets', pattern: [0.5, -0.25] }).style('LABEL', { font: 'arial.ttf' });
  for (const L of layerDefs()) w.layer(L.name, { color: L.color, ltype: L.ltype, lw: L.lw, plot: L.plot });
  w.block('PRISE', { base: [0, 0] }, b => {
    b.circle(0, 0, 0.1, { layer: '0' });
    b.attdef('ID', { x: 0.15, y: 0, h: 0.1, prompt: 'Repère', layer: layerName('labels') });
    b.attdef('VLAN', { x: 0.15, y: -0.15, h: 0.08, invisible: true });
  });
  w.line(0, 0, 10, 0, { layer: layerName('pathways'), ltype: 'DASHED', lw: 50 });
  w.insert('PRISE', 5, 5, { layer: layerName('outlets'), rot: 90, sx: 2, attribs: { ID: 'PC-01', VLAN: '10', NOTE: 'hors bloc' }, style: 'LABEL' });
  w.layout('A3', { paper: [420, 297] }, p => { p.polyline([[10, 10], [410, 10], [410, 287], [10, 287]], { closed: true, layer: layerName('sheet') }); p.viewport({ center: [200, 160], size: [360, 240] }); p.text(300, 20, 5, 'Cartouche', { layer: layerName('sheet') }); });
  w.layout('A1', { paper: [841, 594] }, p => p.viewport({}));
  const s = w.toString(), L = lintDxf(s);
  assert.deepEqual(L.errors, []); assert.deepEqual(L.warnings, []);
  for (const k of ['LAYOUT', 'VIEWPORT', 'ATTDEF', 'MLINESTYLE', 'ACAD_LAYOUT', '*Paper_Space0', 'AcDbAttributeDefinition', 'AcDbPlotSettings']) assert.ok(s.includes(k), k);
  const d = await parseDxf(s);
  assert.deepEqual(d.diagnostics.filter(x => x.level !== 'info'), []);
  const ins = d.inserts[0]; assert.deepEqual(ins.attribs, { ID: 'PC-01', VLAN: '10', NOTE: 'hors bloc' });
  // ATTRIB ID à la place de l'ATTDEF transformée (0.15, 0) × 2, tournée de 90° → (5, 5.3), hauteur 0.2, sur le calque de l'ATTDEF
  const t = d.texts.find(x => x.text === 'PC-01');
  assert.ok(near(t.x + d.origin[0], 5, 1e-6) && near(t.y + d.origin[1], 5.3, 1e-6) && near(t.h, 0.2, 1e-6));
  assert.equal(d.layers[t.layer].name, 'T-TEXT');
  assert.ok(!d.texts.some(x => x.text === '10'), 'ATTDEF invisible → ATTRIB invisible');
  assert.ok(!d.texts.some(x => x.text === 'Cartouche'), 'espace papier hors du CadDoc (espace objet)');
  const lay = Object.fromEntries(d.layers.map(l => [l.name, l]));
  assert.equal(lay['T-CABL-TRAY'].ltype, 'DASHED'); assert.equal(lay['T-JACK'].color, '#2563eb');
});

test('dxflint : repère les défauts d’un DXF', () => {
  const bad = ['  0', 'SECTION', '  2', 'ENTITIES', '  0', 'LINE', '  5', '1A', '  8', 'X', ' 10', 'abc', ' 70', '1.5', '  0', 'LINE', '  5', '1A', '330', 'FF', '  8', 'X', '  6', 'NOPE', '  0', 'INSERT', '  5', '1B', '330', '0', '  8', 'X', '  2', 'B', ' 66', '1', '  0', 'LINE', '  5', '1C', '330', '0', '100', 'AcDbEntity', '  8', 'X', '  0', 'ENDSEC'].join('\n');
  const r = lintDxf(bad), all = r.errors.join(' | ');
  for (const k of ['nombre attendu', 'entier attendu', 'poignée 1A en double', 'inexistante FF', 'EOF absent', 'sans marqueur AcDbEntity', 'bloc absent « B »', 'ATTRIB non terminés', '$HANDSEED']) assert.ok(all.includes(k), k);
  assert.ok(lintDxf('  0\nEOF\n').errors.length >= 1);
});

test('schémas de calques : NCS (noms publics), ISO 13567 (champs fixes), Jollof ; statut et remplacements', () => {
  assert.equal(layerName('outlets'), 'T-JACK'); assert.equal(layerName('pathways'), 'T-CABL-TRAY'); assert.equal(layerName('sheet'), 'G-SHBD-TTLB');
  assert.equal(layerName('cables', { status: 'n' }), 'T-CABL-N');
  assert.equal(layerName('cables', { scheme: 'iso13567' }), 'T-CABLE_E-'); assert.equal(layerName('cables', { scheme: 'iso13567', status: 'E' }), 'T-CABLE_E-E');
  assert.equal(layerName('cables', { scheme: 'jollof' }), 'JOLLOF-CABLES');
  assert.equal(layerName('cables', { overrides: { cables: 'RESEAU-CABLES' } }), 'RESEAU-CABLES');
  for (const s of Object.keys(LAYER_SCHEMES)) {
    const D = layerDefs({ scheme: s });
    assert.equal(D.length, LAYER_KEYS.length); assert.equal(new Set(D.map(x => x.name)).size, D.length, s + ' : noms uniques');
    assert.ok(D.every(x => /^#[0-9a-f]{6}$/.test(x.color) && x.lw > 0 && /^[A-Z0-9_-]+$/.test(x.name)));
  }
  // NCS : discipline (1 lettre + tiret), groupes de 4 lettres ; ISO 13567 : agent 2 + élément 6 + présentation 2
  assert.ok(layerDefs().every(x => /^[A-Z]-[A-Z0-9]{4}(-[A-Z0-9]{4})?$/.test(x.name)));
  assert.ok(layerDefs({ scheme: 'iso13567' }).every(x => /^[A-Z][-_][A-Z_]{6}[A-Z][-0-9]$/.test(x.name)));
  assert.equal(layerDefs().find(x => x.key === 'viewport').plot, false);
});
