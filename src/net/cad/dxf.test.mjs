// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du lecteur DXF (dxf.js) sur les petits fichiers synthétiques de fixtures/ : une entité de chaque sorte, blocs
// imbriqués, symétries, OCS, MINSERT, attributs, hachures, pages de code, feuilles, DXF binaire, budget, annulation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseDxf, openCad, KINDS, stripMtext, stripText, splinePoints, earcut2, aciRgb, hexOf, clusters } from './dxf.js';

const FIX = new URL('./fixtures/', import.meta.url);
const raw = name => fs.readFileSync(new URL(name, FIX));
const load = (name, o) => parseDxf(raw(name), o);
/** Segments en coordonnées absolues : { x0, y0, x1, y1, layer, kind, color }. */
const segsOf = d => {
  const out = [];
  for (let i = 0; i < d.segLayer.length; i++) out.push({ x0: d.segs[i * 4] + d.origin[0], y0: d.segs[i * 4 + 1] + d.origin[1], x1: d.segs[i * 4 + 2] + d.origin[0], y1: d.segs[i * 4 + 3] + d.origin[1],
    layer: d.layers[d.segLayer[i]].name, kind: KINDS[d.segKind[i]], color: d.segColor[i] ? d.palette[d.segColor[i]] : null });
  return out;
};
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
const hasSeg = (S, x0, y0, x1, y1, e = 1e-3) => S.some(s => (near(s.x0, x0, e) && near(s.y0, y0, e) && near(s.x1, x1, e) && near(s.y1, y1, e)) || (near(s.x0, x1, e) && near(s.y0, y1, e) && near(s.x1, x0, e) && near(s.y1, y0, e)));
const pts = S => S.flatMap(s => [[s.x0, s.y0], [s.x1, s.y1]]);

test('en-tête, unités, calques (couleur ACI, vraie couleur, éteint, gelé)', async () => {
  const d = await load('entities.dxf');
  assert.equal(d.units, 'mm'); assert.equal(d.toMetre, 0.001); assert.equal(d.insunits, 4); assert.equal(d.unitsGuessed, false);
  assert.equal(d.version, 'AC1009'); assert.deepEqual(d.origin, [50, 50]);
  assert.ok(near(d.tol, 2), 'tolérance 2 mm en unités du dessin');
  const L = Object.fromEntries(d.layers.map(l => [l.name, l]));
  assert.equal(L.WALLS.color, '#ff0000'); assert.equal(L.WALLS.aci, 1);
  assert.equal(L.HIDDEN.off, true); assert.equal(L.HIDDEN.aci, 3);
  assert.equal(L.ICE.frozen, true);
  assert.equal(L.TRUE.color, '#3b82f6');
  assert.equal(L.HIDDEN.kinds.circle > 0, true);
  assert.equal(L.ICE.kinds.fill, 2);
  assert.equal(d.stats.entities, 13); // entités dessinées : la ligne de l'espace papier et le POINT sont comptés à part
  assert.ok(!segsOf(d).some(s => s.x0 < -500), 'pas d’espace papier');
  assert.equal(d.segs.length, d.segLayer.length * 4); assert.equal(d.segKind.length, d.segLayer.length);
});

test('LINE, LWPOLYLINE à renflement, POLYLINE fermée, ARC, CIRCLE, ELLIPSE partielle, SPLINE', async () => {
  const S = segsOf(await load('entities.dxf'));
  assert.ok(hasSeg(S.filter(s => s.kind === 'line'), 0, 0, 100, 0));
  // renflement 1 : demi-cercle de (0,0) à (100,0) sous l'axe, centre (50,0) rayon 50
  const arc = S.filter(s => s.layer === 'TRUE' && s.y0 <= 0 && s.y1 <= 0 && !(s.y0 === 0 && s.y1 === 0));
  assert.ok(arc.length >= 6);
  for (const [x, y] of pts(arc)) assert.ok(Math.abs(Math.hypot(x - 50, y) - 50) < 1e-3);
  assert.ok(near(Math.min(...pts(arc).map(p => p[1])), -50, 0.01));
  assert.ok(hasSeg(S, 100, 100, 0, 0), 'polyligne fermée');
  // POLYLINE : renflement -1 (horaire) de (200,0) à (220,0) → arc au-dessus, fermée
  const pl = S.filter(s => s.kind === 'poly' && s.layer === 'WALLS');
  assert.ok(pts(pl).some(([x, y]) => near(x, 210, 0.01) && near(y, 10, 0.01)));
  assert.ok(hasSeg(pl, 220, 20, 200, 0));
  // ARC 0→90° autour de (300,0)
  const a = S.filter(s => s.kind === 'arc');
  for (const [x, y] of pts(a)) { assert.ok(Math.abs(Math.hypot(x - 300, y) - 10) < 1e-3); assert.ok(x >= 300 - 1e-3 && y >= -1e-3); }
  // CIRCLE : fermé, flèche ≤ tolérance
  const c = S.filter(s => s.kind === 'circle');
  assert.ok(c.length >= 8);
  for (const s of c) { const mx = (s.x0 + s.x1) / 2, my = (s.y0 + s.y1) / 2; assert.ok(10 - Math.hypot(mx - 400, my) <= 2 + 1e-6); }
  // ELLIPSE 0→π : moitié haute, demi-axes 20 et 10
  const e = pts(S.filter(s => s.kind === 'ellipse'));
  assert.ok(e.every(([x, y]) => y >= -1e-3 && Math.abs(((x - 500) / 20) ** 2 + (y / 10) ** 2 - 1) < 1e-3));
  assert.ok(e.some(([x, y]) => near(x, 500) && near(y, 10)));
  // SPLINE quadratique (Bézier) : passe par (610, 5), finit en (620, 0)
  const sp = pts(S.filter(s => s.kind === 'spline'));
  assert.ok(sp.some(([x, y]) => near(x, 610, 0.01) && near(y, 5, 0.01)));
  assert.ok(sp.some(([x, y]) => near(x, 620) && near(y, 0)));
});

test('TEXT, MTEXT (codes de mise en forme), SOLID, LEADER, 3DFACE', async () => {
  const d = await load('entities.dxf'), S = segsOf(d);
  const t = d.texts.map(x => ({ ...x, x: x.x + d.origin[0], y: x.y + d.origin[1] }));
  const a = t.find(x => x.text.startsWith('Angle'));
  assert.equal(a.text, 'Angle 90° été');
  assert.ok(near(a.rot, Math.PI / 6, 1e-9)); assert.equal(a.h, 5); assert.ok(near(a.x, 0) && near(a.y, 200));
  const c = t.find(x => x.text === 'Centre');
  assert.ok(near(c.x, 50) && near(c.y, 210)); assert.equal(c.ha, 1); assert.equal(c.va, 2);
  const m = t.find(x => x.text.startsWith('Hello'));
  assert.equal(m.text, 'Hello\nWorld 1/2 50Ø big end \\ {x}');
  assert.equal(m.ha, 1); assert.equal(m.va, 2); assert.equal(m.h, 2.5);
  assert.equal(S.filter(s => s.kind === 'solid').length, 4);
  assert.equal(d.fills.layer.length, 2);
  assert.equal(S.filter(s => s.kind === 'leader').length, 2);
  assert.equal(S.filter(s => s.kind === 'face').length, 3, 'arête invisible omise');
});

test('blocs : imbrication, rotation, échelle, symétrie, OCS -Z, MINSERT, calque 0 et BYBLOCK', async () => {
  const d = await load('blocks.dxf'), S = segsOf(d);
  // PAIR (base 5,5) inséré en (100,100), échelle 2, rotation 90 : SQ(5,5) → (100,100), coin (1,0) → (100,102)
  assert.ok(hasSeg(S, 100, 100, 100, 102));
  assert.ok(hasSeg(S, 100, 104, 100, 106), 'second carré du bloc imbriqué');
  // le carré est sur le calque 0 → calque de l'INSERT ; la ligne sur FIXED garde son calque
  assert.ok(S.filter(s => s.kind === 'poly').every(s => s.layer === 'DOORS'));
  assert.ok(S.filter(s => s.kind === 'line' && s.layer === 'FIXED').length >= 10);
  // symétrie (sx = -1) en (200,0), couleur rouge par BYBLOCK ; FIXED reste « du calque »
  assert.ok(hasSeg(S, 200, 0, 199, 0) && hasSeg(S, 199, 0, 199, 1));
  assert.ok(S.filter(s => s.kind === 'poly' && s.x0 > 198 && s.x0 < 201).every(s => s.color === '#ff0000'));
  assert.ok(S.filter(s => s.layer === 'FIXED' && s.x0 > 198 && s.x0 < 201).every(s => s.color === null));
  // extrusion (0,0,-1) : x en miroir
  assert.ok(hasSeg(S, -300, 0, -301, 0) && hasSeg(S, -301, 0, -301, 1));
  // MINSERT 3 colonnes × 2 rangées, pas 10 × 20
  for (const [x, y] of [[0, 500], [10, 500], [20, 500], [0, 520], [10, 520], [20, 520]]) assert.ok(hasSeg(S, x, y, x + 1, y + 1), `copie ${x},${y}`);
  const ins = d.inserts.find(i => i.name === 'PAIR');
  assert.equal(ins.rot, 90); assert.equal(ins.sx, 2); assert.ok(near(ins.x + d.origin[0], 100));
});

test('blocs : attributs, ATTDEF non dessiné, cote (*D), récursion et bloc absent', async () => {
  const d = await load('blocks.dxf'), S = segsOf(d);
  const tag = d.inserts.find(i => i.name === 'TAGB');
  assert.deepEqual(tag.attribs, { NUM: 'P-01', HIDDEN: 'secret' });
  assert.ok(d.texts.some(t => t.text === 'P-01' && t.tag === 'NUM'));
  assert.ok(!d.texts.some(t => t.text === 'secret'), 'attribut invisible');
  assert.ok(!d.texts.some(t => t.text === 'NUM' || t.text === 'Num?'), 'ATTDEF du bloc non dessiné');
  assert.ok(hasSeg(S.filter(s => s.kind === 'dim'), 0, 900, 50, 900));
  assert.ok(d.texts.some(t => t.text === '50' && t.block === '*D1'));
  const w = Object.fromEntries(d.warnings.map(x => [x.code, x.n]));
  assert.equal(w.recursion, 1); assert.equal(w.missingBlock, 1);
  assert.ok(hasSeg(S, 0, 700, 1, 700), 'le contenu du bloc récursif est dessiné une fois');
});

test('hachures : contour polyligne plein (triangles), arêtes droite / arc trigo / arc horaire / ellipse', async () => {
  const d = await load('hatch.dxf'), S = segsOf(d).filter(s => s.kind === 'hatch');
  assert.ok(hasSeg(S, 0, 0, 10, 0) && hasSeg(S, 0, 10, 0, 0));
  assert.equal(d.fills.layer.length, 2);
  let area = 0; const T = d.fills.tris;
  for (let i = 0; i < T.length; i += 6) area += Math.abs((T[i + 2] - T[i]) * (T[i + 5] - T[i + 1]) - (T[i + 4] - T[i]) * (T[i + 3] - T[i + 1])) / 2;
  assert.ok(near(area, 100, 1e-3));
  // arc horaire centre (110,5) : angles stockés comptés en sens inverse → arc vers l'intérieur (x ≥ 105, ≤ 110)
  const cw = pts(S).filter(([x, y]) => x > 104 && y > 0 && y < 10 && Math.abs(Math.hypot(x - 110, y - 5) - 5) < 1e-3);
  assert.ok(cw.length > 4 && cw.every(([x]) => x <= 110 + 1e-6) && cw.some(([x]) => near(x, 105)));
  // arc trigo centre (100,5) de 90° à 270° → côté gauche jusqu'à x = 95
  assert.ok(pts(S).some(([x, y]) => near(x, 95) && near(y, 5)));
  // ellipse : demi-ellipse haute, sommet (105, 22.5)
  assert.ok(pts(S).some(([x, y]) => near(x, 105) && near(y, 22.5)));
});

test('pages de code : ANSI_1252 brut, UTF-8 (AC1032), échappements \\U+', async () => {
  const a = await load('cp1252.dxf');
  assert.equal(a.texts[0].text, 'Café 20° ⌀');
  assert.ok(a.layers.some(l => l.name === 'Câble'));
  assert.equal(a.codepage, 'windows-1252');
  const b = await load('utf8.dxf');
  assert.equal(b.texts[0].text, 'Café 20° Ω');
  assert.equal(b.version, 'AC1032');
  assert.equal(stripText('%%c10 %%p0.5 %%d %%%'), 'Ø10 ±0.5 ° %');
  assert.equal(stripMtext('\\A1;{\\C1;rouge}\\Pa\\Sx^y;'), 'rouge\nax/y');
});

test('feuilles : cadres jointifs séparés, groupe sans cadre, trait égaré ignoré', async () => {
  const d = await load('sheets.dxf');
  const c = d.clusters.map(k => ({ ...k, x0: k.x0 + d.origin[0], x1: k.x1 + d.origin[0], y0: k.y0 + d.origin[1], y1: k.y1 + d.origin[1] }));
  const f1 = c.find(k => near(k.x0, 0) && near(k.x1, 100)), f2 = c.find(k => near(k.x0, 100) && near(k.x1, 200));
  assert.ok(f1 && f2, 'deux cadres'); assert.ok(f1.sheet && f2.sheet);
  assert.equal(f1.count, 26); assert.equal(f2.count, 26);
  const g = c.find(k => k.x0 >= 999);
  assert.ok(g && !g.sheet && g.count >= 20 && g.x1 < 1100, 'le trait égaré n’agrandit pas le groupe');
  assert.equal(c.filter(k => k.count >= 20).length, 3);
  assert.deepEqual(clusters(new Float32Array(0), [0, 0, 1, 1]), []);
});

/** DXF ASCII → DXF binaire (codes sur 2 octets), pour tester le lecteur binaire. */
function toBinary(text) {
  const lines = text.split(/\r?\n/), parts = [Buffer.from('AutoCAD Binary DXF\r\n\x1a\0', 'latin1')];
  const kind = c => (c < 10 || (c >= 100 && c < 110) || (c >= 300 && c < 370) || (c >= 390 && c < 400) || (c >= 410 && c < 420) || (c >= 430 && c < 440) || (c >= 470 && c < 482) || (c >= 999 && c < 1010)) ? 's'
    : (c < 60 || (c >= 110 && c < 150) || (c >= 210 && c < 240) || (c >= 460 && c < 470) || (c >= 1010 && c < 1060)) ? 'd'
    : ((c >= 90 && c < 100) || (c >= 420 && c < 430) || (c >= 440 && c < 460) || c === 1071) ? 'l' : (c >= 290 && c < 300) ? 'b' : 'h';
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = parseInt(lines[i], 10), v = lines[i + 1], code = Buffer.alloc(2); code.writeUInt16LE(c);
    parts.push(code);
    const k = kind(c);
    if (k === 's') parts.push(Buffer.from(v + '\0', 'utf8'));
    else if (k === 'd') { const b = Buffer.alloc(8); b.writeDoubleLE(+v); parts.push(b); }
    else if (k === 'l') { const b = Buffer.alloc(4); b.writeInt32LE(+v); parts.push(b); }
    else if (k === 'b') parts.push(Buffer.from([+v ? 1 : 0]));
    else { const b = Buffer.alloc(2); b.writeInt16LE(+v); parts.push(b); }
  }
  return Buffer.concat(parts);
}
/** Flux qui livre les octets par morceaux de n. */
const chunked = (buf, n) => new ReadableStream({ start(c) { for (let i = 0; i < buf.length; i += n) c.enqueue(new Uint8Array(buf.subarray(i, i + n))); c.close(); } });

test('DXF binaire : même résultat que l’ASCII, y compris découpé en petits morceaux', async () => {
  const txt = raw('blocks.dxf').toString('utf8');
  const a = await parseDxf(txt), bin = toBinary(txt);
  const b = await parseDxf(bin), c = await parseDxf(chunked(bin, 13));
  for (const d of [b, c]) {
    assert.equal(d.segLayer.length, a.segLayer.length);
    assert.deepEqual([...d.segs], [...a.segs]);
    assert.deepEqual(d.texts, a.texts); assert.deepEqual(d.inserts, a.inserts);
  }
});

test('flux ASCII : découpage arbitraire, CRLF, progression jusqu’à 1', async () => {
  const buf = raw('entities.dxf'), a = await parseDxf(buf);
  const crlf = Buffer.from(buf.toString('latin1').replace(/\n/g, '\r\n'), 'latin1');
  const seen = [];
  const b = await parseDxf(chunked(crlf, 7), { size: crlf.length, onProgress: f => seen.push(f) });
  assert.deepEqual([...b.segs], [...a.segs]); assert.deepEqual(b.texts, a.texts);
  assert.equal(seen.at(-1), 1); assert.ok(seen.every((f, i) => !i || f >= seen[i - 1]));
  const s = await parseDxf(buf.toString('latin1'));
  assert.equal(s.segLayer.length, a.segLayer.length);
});

test('budget de segments : arrêt propre et avertissement', async () => {
  let t = '0\nSECTION\n2\nENTITIES\n';
  for (let i = 0; i < 1000; i++) t += `0\nLINE\n8\nA\n10\n${i}\n20\n0\n11\n${i}\n21\n1\n`;
  t += '0\nENDSEC\n0\nEOF\n';
  const d = await parseDxf(t, { maxSegs: 100 });
  assert.equal(d.segLayer.length, 100); assert.equal(d.segs.length, 400);
  assert.equal(d.stats.truncated, true);
  assert.ok(d.warnings.some(w => w.code === 'budget'));
  assert.equal(d.stats.entities, 1000);
  assert.equal(d.units, 'unitless'); assert.equal(d.unitsGuessed, true);
});

test('annulation : avant et pendant la lecture', async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(parseDxf(raw('entities.dxf'), { signal: ac.signal }), e => e.name === 'AbortError');
  const buf = raw('sheets.dxf'), ac2 = new AbortController();
  await assert.rejects(parseDxf(chunked(buf, 64), { size: buf.length, signal: ac2.signal, onProgress: f => { if (f > 0.2) ac2.abort(); } }), e => e.name === 'AbortError');
  await assert.rejects(parseDxf(42), TypeError);
});

test('openCad sans Worker (Node) : repli sur le fil courant', async () => {
  const d = await openCad(new Uint8Array(raw('hatch.dxf')));
  assert.ok(d.segLayer.length > 10);
});

test('outils : ACI, spline par points de lissage, triangulation', () => {
  assert.equal(hexOf(aciRgb(1)), '#ff0000'); assert.equal(hexOf(aciRgb(7)), '#ffffff');
  assert.equal(hexOf(aciRgb(30)), '#ff7f00'); assert.equal(hexOf(aciRgb(250)), '#333333');
  const p = splinePoints({ fit: [0, 0, 10, 10, 20, 0] }, 0.01);
  assert.deepEqual(p.slice(0, 2), [0, 0]); assert.deepEqual(p.slice(-2), [20, 0]);
  assert.ok(p.some((v, i) => i % 2 === 0 && near(v, 10) && near(p[i + 1], 10)));
  const L = [0, 0, 4, 0, 4, 4, 2, 1, 0, 4]; // polygone concave
  const tri = earcut2(L); assert.equal(tri.length, 9);
  let a = 0; for (let i = 0; i < tri.length; i += 3) { const [p0, p1, p2] = [tri[i], tri[i + 1], tri[i + 2]].map(k => [L[k * 2], L[k * 2 + 1]]); a += Math.abs((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1])) / 2; }
  assert.ok(near(a, 10));
});

test('diagnostics : fichier abîmé — chaque défaut signalé avec sa ligne, la lecture continue', async () => {
  const d = await load('malformed.dxf');
  const D = Object.fromEntries(d.diagnostics.map(x => [x.code + (x.code === 'notDrawn' || x.code === 'degenerate' || x.code === 'undefinedLayer' ? ':' + x.sample : ''), x]));
  for (const [k, level] of [['badGroupCode', 'error'], ['unclosedBlock', 'error'], ['unterminatedSection', 'error'], ['unitsGuessed', 'warning'], ['duplicateLayer', 'warning'],
    ['duplicateBlock', 'warning'], ['badNumber', 'warning'], ['badInteger', 'warning'], ['orphan', 'warning'], ['badHandle', 'warning'], ['noEOF', 'warning'],
    ['duplicateHandle', 'warning'], ['unknownGroupCode', 'info'], ['undefinedLayer:NOUVEAU', 'info'], ['notDrawn:WIPEOUT', 'info'], ['invisible', 'info'],
    ['degenerate:CIRCLE', 'info'], ['missingSeqend', 'info']]) assert.equal(D[k]?.level, level, k);
  assert.equal(D.badGroupCode.line, 143); assert.equal(D.badGroupCode.sample, 'abc'); assert.equal(D.badGroupCode.n, 2);
  assert.equal(D.badNumber.line, 152); assert.equal(D.badNumber.sample, '10: 1.2.3');
  assert.equal(D.duplicateHandle.sample, '30'); assert.equal(D.unknownGroupCode.sample, '85');
  assert.equal(d.errors, 4);
  // la géométrie lisible est gardée : ligne 30, ligne sans calque défini, ligne au nombre illisible, polyligne, ligne à poignée illisible
  assert.equal(d.stats.segs, 5);
  assert.ok(d.layers.some(l => l.name === 'NOUVEAU'));
  assert.equal(d.diagnostics[0].level, 'error', 'triés : erreurs d’abord');
  // un fichier propre n'a ni erreur ni avertissement
  for (const f of ['entities.dxf', 'hatch.dxf', 'sheets.dxf']) assert.deepEqual((await load(f)).diagnostics.filter(x => x.level !== 'info' && x.code !== 'unitsGuessed'), [], f);
});

test('diagnostics : DXF binaire (position en octets), tronqué, vide, budget compté', async () => {
  const bin = toBinary(raw('blocks.dxf').toString('utf8'));
  const t = await parseDxf(bin.subarray(0, bin.length - 3));
  assert.ok(t.diagnostics.some(x => x.code === 'truncated' && x.level === 'error' && x.offset > 0));
  const e = await parseDxf('');
  assert.ok(e.diagnostics.some(x => x.code === 'noEOF'));
  let s = '0\nSECTION\n2\nENTITIES\n';
  for (let i = 0; i < 50; i++) s += `0\nLINE\n8\nA\n10\n${i}\n20\n0\n11\n${i}\n21\n1\n`;
  const b = await parseDxf(s + '0\nENDSEC\n0\nEOF\n', { maxSegs: 10 });
  const bd = b.diagnostics.find(x => x.code === 'budget');
  assert.equal(bd.level, 'warning'); assert.equal(bd.n, 40, 'segments écartés comptés');
});

test('entités d’origine : poignée, type et calque de chaque segment (blocs → leur INSERT)', async () => {
  const { createDxfWriter } = await import('./dxfwrite.js');
  const w = createDxfWriter({ units: 'm' });
  w.block('B', {}, b => { b.circle(0, 0, 1); b.line(0, 0, 1, 0); });
  w.line(0, 0, 5, 0, { layer: 'L1' }); w.insert('B', 10, 10, { layer: 'L2' }); w.text(0, 1, 0.2, 'T', { layer: 'L1' });
  const d = await parseDxf(w.toString());
  assert.equal(d.segEnt.length, d.segLayer.length);
  const types = [...d.segEnt].map(i => d.entTypes[d.entType[i]]);
  assert.equal(types[0], 'LINE'); assert.ok(types.slice(1).every(t => t === 'INSERT'));
  const hs = new Set([...d.segEnt].map(i => d.entHandle[i]));
  assert.equal(hs.size, 2); assert.ok([...hs].every(h => Number.isInteger(h) && h > 0));
  assert.equal(d.layers[d.entLayer[d.segEnt[1]]].name, 'L2');
  assert.equal(d.entTypes[d.entType[d.texts[0].ent]], 'TEXT');
  const L = (await load('blocks.dxf')); assert.ok(Number.isNaN(L.entHandle[0]), 'pas de poignée en R12');
});
