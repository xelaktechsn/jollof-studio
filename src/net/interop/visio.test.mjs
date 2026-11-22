// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests des échanges de schémas : node --test src/net/interop/visio.test.mjs
// Vues à plat (diagram.js), Visio .vsdx (vsdx.js : écriture puis relecture par notre lecteur, intégrité du paquet OPC,
// types de contenu, relations, Connect vers des formes existantes, formules de collage, données de forme, échelles),
// draw.io (drawio.js : structure, liens source/target, données, calques), échappement, déterminisme, temps sur un grand
// projet. Données synthétiques seulement. Contrôles indépendants facultatifs (outils d'essai, jamais livrés) : si
// JOLLOF_VISIO_PY désigne un Python qui a les paquets vsdx et lxml, et JOLLOF_VISIO_XSD le dossier des schémas
// (vsdx.xsd extrait de l'annexe A de [MS-VSDX], mxfile.xsd de jgraph/drawio-mcp) : sinon ces tests sont sautés.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';
import { cleanNet } from '../clean.js';
import { newDevice } from '../devices.js';
import { fixture } from '../dimension.fixture.mjs';
import { NET } from '../limits.js';
import { buildViews, availableViews, DEVICE_KEYS, fitFont, fitText } from './diagram.js';
import { writeVsdx, readVsdx, checkVsdx } from './vsdx.js';
import { writeDrawio, readDrawio, checkDrawio, DATA_ATTR } from './drawio.js';
import { parseTree } from './xmltree.js';
import { planVsdx, applyVsdx, guessType, findDuplicates } from './vsdximport.js';

const DATE = new Date('2026-03-01T10:00:00Z');
/** Petit projet : baie au local technique, switch + panneau, 3 prises reliées à des PC, un point d'accès, un serveur. */
function project(o = {}) {
  const d = fixture(), used = new Set(), dev = (type, x, y, extra = {}) => { const n = newDevice(type, used, { x, y }); used.add(n.name); n.id = extra.id || type + used.size; Object.assign(n, extra); d.devices.push(n); return n; };
  const sw = dev('switch24', 400, 200, { id: 'sw1', rack: { id: 'rk1', u: 40, face: 'front' } });
  const pp = dev('patch24', 400, 100, { id: 'pp1', rack: { id: 'rk1', u: 42, face: 'front' } });
  const srv = dev('server', 700, 200, { id: 'srv1', rack: { id: 'rk1', u: 30, face: 'rear' } });
  srv.p.eth0 = srv.p.eth0 || undefined;
  const ap = dev('ap', 200, 420, { id: 'ap1', loc: { floor: 'f0', x: 20, y: 5, h: 2.6 } });
  d.cables.push({ id: 'c-ap', a: ['ap1', 'eth0'], b: ['sw1', 'p24'], cat: 'cat6a', len: 35 });
  d.cables.push({ id: 'c-srv', a: ['srv1', 'eth0'], b: ['sw1', 'p23'], cat: 'cat6', len: 2 });
  for (let i = 1; i <= 3; i++) {
    const out = dev('outlet', 100 + i * 120, 500, { id: 'o' + i, loc: { floor: 'f0', x: 2 + i * 4, y: 0.4, h: 0.3 } });
    const pc = dev('pc', 100 + i * 120, 640, { id: 'pc' + i, loc: { floor: 'f0', x: 2 + i * 4, y: 1.5, h: 0.8 } });
    d.cables.push({ id: 'h' + i, a: [out.id, 'back'], b: ['pp1', 'b' + i], cat: 'cat6a', len: 20 + i });
    d.cables.push({ id: 'k' + i, a: ['pp1', 'f' + i], b: ['sw1', 'p' + i], cat: 'cat6a', len: 1 });
    d.cables.push({ id: 'u' + i, a: [pc.id, 'eth0'], b: [out.id, 'front'], cat: 'cat6', len: 3 });
  }
  sw.p.ports = { p1: { mode: 'access', vlan: 10 }, p2: { mode: 'access', vlan: 20 }, p24: { mode: 'trunk', native: 1, allowed: 'all' } };
  d.paths.push({ id: 'tray1', floor: 'f0', kind: 'tray', pts: [[1, 6], [33, 6]], z: 2.7, w: 300, h: 60 });
  d.design = { project: { site: o.site || 'Siège « test » & co' } };
  return cleanNet(d);
}

test('vues : une page par vue, calques, données de forme', () => {
  const data = project(), V = buildViews(data);
  assert.deepEqual(V.pages.map(p => p.kind), ['logic', 'rack', 'floor', 'floor']);
  const logic = V.pages[0];
  assert.equal(logic.edges.length, data.cables.length, 'un lien par câble');
  assert.ok(logic.edges.every(e => logic.shapes.some(s => s.id === e.from) && logic.shapes.some(s => s.id === e.to)));
  const pc1 = logic.shapes.find(s => s.ref && s.ref.id === 'pc1');
  assert.equal(pc1.props.VLAN, '10', 'VLAN du port de switch au bout de la prise et du panneau');
  assert.equal(logic.shapes.find(s => s.ref && s.ref.id === 'pc2').props.VLAN, '20');
  const sw = logic.shapes.find(s => s.ref && s.ref.id === 'sw1');
  assert.equal(sw.props.U, '40'); assert.ok(sw.props.Rack);
  const c = logic.edges.find(e => e.ref.id === 'c-ap'); assert.equal(c.props.Category, 'Cat 6A'); assert.equal(c.props.Length, 35);
  const rack = V.pages[1];
  assert.equal(rack.unit, 'mm'); assert.equal(rack.scale, 10);
  const srv = rack.shapes.find(s => s.ref && s.ref.id === 'srv1'); assert.ok(srv.x > 600, 'serveur monté à l’arrière : élévation de droite');
  const f0 = V.pages[2];
  assert.equal(f0.unit, 'm'); assert.ok([50, 100, 200].includes(f0.scale));
  for (const k of ['rooms', 'walls', 'pathways', 'racks', 'outlets', 'aps', 'labels']) assert.ok(f0.layers.some(L => L.key === k), k);
  assert.equal(f0.shapes.filter(s => s.kind === 'room').length, 7);
  assert.ok(f0.shapes.some(s => s.kind === 'path' && s.pts.length === 2));
  assert.ok(f0.shapes.find(s => s.ref && s.ref.id === 'o1').props.Label, 'identifiant de prise');
  // Choix des vues.
  const only = buildViews(data, { views: { logic: false, racks: false, floors: ['f1'] } });
  assert.deepEqual(only.pages.map(p => p.key), ['floor:f1']);
  const av = availableViews(data); assert.equal(av.racks.length, 1); assert.equal(av.floors.length, 2); assert.ok(av.logic);
});

test('vsdx : paquet OPC complet, relations, types de contenu, relu sans défaut', () => {
  const data = project(), V = buildViews(data), bytes = writeVsdx(V, { date: DATE, creator: 'Essai' });
  const files = unzipSync(bytes), names = Object.keys(files);
  assert.equal(names[0], '[Content_Types].xml');
  for (const p of ['_rels/.rels', 'visio/document.xml', 'visio/_rels/document.xml.rels', 'visio/pages/pages.xml', 'visio/pages/_rels/pages.xml.rels', 'visio/masters/masters.xml', 'docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml']) assert.ok(files[p], p);
  for (const p of names) if (/\.(xml|rels)$/.test(p)) assert.doesNotThrow(() => parseTree(strFromU8(files[p])), p);
  const P = NET.VISIO_PARTS.v, ct = strFromU8(files['[Content_Types].xml']);
  assert.ok(ct.includes(`PartName="/visio/document.xml" ContentType="${P.document.ct}"`));
  assert.ok(ct.includes(`PartName="/visio/pages/page1.xml" ContentType="${P.page.ct}"`));
  assert.ok(ct.includes(`ContentType="${P.master.ct}"`));
  assert.ok(strFromU8(files['_rels/.rels']).includes(P.document.rel));
  assert.ok(strFromU8(files['docProps/custom.xml']).includes('name="RecalcDocument"'));
  assert.ok(strFromU8(files['visio/pages/page1.xml']).includes(`xmlns="${NET.VISIO_NS.v.main}"`));
  const r = readVsdx(bytes);
  assert.deepEqual(checkVsdx(r), []);
  assert.equal(r.pages.length, V.pages.length);
  assert.equal(r.props.custom.RecalcDocument, 'true');
  assert.equal(r.masters.length, V.masters.length);
});

test('vsdx : connecteurs collés (Connect, formules, extrémités sur les points de connexion)', () => {
  const data = project(), V = buildViews(data), r = readVsdx(writeVsdx(V, { date: DATE }));
  const pg = r.pages[0], C = NET.VISIO_CONNECT.v, byId = new Map(pg.shapes.map(s => [s.id, s]));
  assert.equal(pg.connects.length, 2 * data.cables.length, 'deux Connect par câble');
  const cables = pg.shapes.filter(s => s.oneD);
  assert.equal(cables.length, data.cables.length);
  for (const c of pg.connects) {
    const from = byId.get(c.from), to = byId.get(c.to);
    assert.ok(from && from.oneD && to && !to.oneD);
    assert.ok(c.fromCell === 'BeginX' ? c.fromPart === C.begin : c.fromCell === 'EndX' && c.fromPart === C.end);
    const row = c.toPart - C.point; assert.ok(row >= 0 && row <= 3); assert.equal(c.toCell, `Connections.X${row + 1}`);
    const f = c.fromCell === 'BeginX' ? from.glue[0] : from.glue[1];
    assert.equal(f, `PAR(PNT(Sheet.${c.to}!Connections.X${row + 1},Sheet.${c.to}!Connections.Y${row + 1}))`);
    // L'extrémité est bien sur le point de connexion de la forme (repère de page, pouces).
    const [fx, fy] = [[0, 0.5], [1, 0.5], [0.5, 1], [0.5, 0]][row], pt = c.fromCell === 'BeginX' ? from.begin : from.end;
    assert.ok(Math.abs(pt[0] - (to.x - to.w / 2 + to.w * fx)) < 1e-4 && Math.abs(pt[1] - (to.y - to.h / 2 + to.h * fy)) < 1e-4);
  }
  const ap = cables.find(s => s.props.Category && s.props.Category.value === 'Cat 6A' && +s.props.Length.value === 35);
  assert.ok(ap, 'données du câble (catégorie, longueur)');
  assert.deepEqual(ap.layers, [pg.layers.findIndex(L => L.key === 'cables')]);
});

test('vsdx : données de forme, gabarits, calques, échelle et unités', () => {
  const data = project(), V = buildViews(data), r = readVsdx(writeVsdx(V, { date: DATE }));
  const logic = r.pages[0], pc = logic.shapes.find(s => s.text === data.devices.find(d => d.id === 'pc1').name);
  assert.ok(pc.master != null);
  for (const k of DEVICE_KEYS) assert.ok(k in pc.props, `ligne ${k} (héritée du gabarit)`);
  assert.equal(pc.props.VLAN.value, '10'); assert.equal(pc.props.Label.label, V.props.Label);
  assert.ok(logic.layers.map(L => L.key).includes('devices'));
  assert.ok(logic.layers.every(L => +L.color === NET.VISIO_LAYERS.v.noColor));
  const f0 = r.pages.find(p => p.name.includes('RDC')), vf0 = V.pages.find(p => p.key === 'floor:f0');
  assert.ok(Math.abs(f0.scale - vf0.scale) < 1e-3, `échelle 1:${vf0.scale}`);
  assert.equal(f0.units, 'M');
  assert.ok(Math.abs(f0.width - (vf0.box.x1 - vf0.box.x0) / 0.0254) < 1e-3, 'largeur de page en pouces de dessin');
  const wall = f0.shapes.find(s => s.name.startsWith('wall.')); assert.ok(wall.layers.length === 1);
  const room = f0.shapes.find(s => s.props.Label && s.props.Label.value === 'Bureau 1');
  assert.ok(Math.abs(room.w * 0.0254 - 5) < 1e-6 && Math.abs(room.h * 0.0254 - 5) < 1e-6, 'pièce de 5 m × 5 m');
  assert.equal(room.geom[0].pts.length, 5, 'contour fermé');
  const rk = r.pages.find(p => p.units === 'MM' && Math.abs(p.scale - 10) < 1e-3); assert.ok(rk, 'élévation à 1:10 en mm');
});

test('draw.io : structure, liens reliés, données, calques', () => {
  const data = project(), V = buildViews(data), txt = writeDrawio(V, { date: DATE }), r = readDrawio(txt);
  assert.deepEqual(checkDrawio(r), []);
  assert.equal(r.diagrams.length, V.pages.length);
  assert.equal(new Set(r.diagrams.map(d => d.id)).size, r.diagrams.length);
  const d0 = r.diagrams[0];
  assert.equal(d0.cells[0].id, '0'); assert.equal(d0.cells[1].id, '1'); assert.equal(d0.cells[1].parent, '0');
  assert.deepEqual(d0.layers.map(L => L.name), V.pages[0].layers.map(L => L.name));
  const edges = d0.cells.filter(c => c.edge);
  assert.equal(edges.length, data.cables.length);
  assert.ok(edges.every(e => d0.cells.find(c => c.id === e.source).vertex && d0.cells.find(c => c.id === e.target).vertex));
  const pc = d0.cells.find(c => c.vertex && c.data[DATA_ATTR.VLAN] === '10'); assert.ok(pc, 'données VLAN');
  assert.ok(pc.data.placeholders === '1' && pc.data.tooltip);
  const ap = edges.find(e => e.data[DATA_ATTR.Category] === 'Cat 6A' && e.data[DATA_ATTR.Length] === '35'); assert.ok(ap);
  assert.ok(/exitX=/.test(ap.style) && /entryX=/.test(ap.style));
  // Plan : pièces rectangulaires remplies, cheminement en lien libre à points.
  const f0 = r.diagrams.find(d => d.name.includes('RDC'));
  assert.ok(f0.cells.some(c => c.vertex && c.data[DATA_ATTR.Label] === 'Bureau 1'));
  const tray = f0.cells.find(c => c.edge && c.geo.sourcePoint && c.geo.targetPoint); assert.ok(tray);
  const k = NET.DRAWIO_PX_PER_IN.v / 0.0254 / V.pages.find(p => p.key === 'floor:f0').scale;
  assert.ok(Math.abs(tray.geo.targetPoint[0] - tray.geo.sourcePoint[0] - 32 * k) < 0.02, 'longueur à l’échelle');
});

test('échappement : noms piégés, caractères interdits, emoji', () => {
  const data = project({ site: 'A<b>&"c\'\u0001 😀' });
  data.devices[0].name = '<SW> & "cœur" \u0007';
  data.site.buildings[0].floors[0].name = 'RDC ]]> <!-- x -->';
  const V = buildViews(data), r = readVsdx(writeVsdx(V, { date: DATE }));
  assert.deepEqual(checkVsdx(r), []);
  assert.ok(r.pages[0].shapes.some(s => s.text === '<SW> & "cœur"'));
  assert.ok(r.pages.some(p => p.name.startsWith('RDC ]]> <!-- x -->')));
  const d = readDrawio(writeDrawio(V, { date: DATE }));
  assert.deepEqual(checkDrawio(d), []);
  assert.ok(d.diagrams[0].cells.some(c => c.value === '&lt;SW&gt; &amp; "cœur" '), 'texte HTML échappé dans label');
});

test('déterministe, projet vide, fichiers refusés', () => {
  const data = project();
  assert.deepEqual(writeVsdx(buildViews(data), { date: DATE }), writeVsdx(buildViews(data), { date: DATE }));
  assert.equal(writeDrawio(buildViews(data), { date: DATE }), writeDrawio(buildViews(data), { date: DATE }));
  const empty = buildViews(cleanNet({}));
  assert.equal(empty.pages.length, 0);
  assert.deepEqual(checkVsdx(readVsdx(writeVsdx(empty, { date: DATE }))), []);
  assert.throws(() => readVsdx(new Uint8Array([1, 2, 3])), /zip/);
  assert.throws(() => readDrawio('<mxfile><diagram id="a">eJxLTEo=</diagram></mxfile>'), /compressé/);
  assert.throws(() => parseTree('<a><b></a>'), /XML/);
  assert.throws(() => parseTree('<!DOCTYPE x [<!ENTITY e "boom">]><a>&e;</a>'), /DOCTYPE/);
});

test('grand projet : vues et fichiers en temps raisonnable', () => {
  const d = fixture(), used = new Set();
  for (let i = 0; i < 1500; i++) { const n = newDevice(i % 10 ? 'pc' : 'switch24', used, { x: (i % 60) * 120, y: Math.floor(i / 60) * 120 }); used.add(n.name); n.id = 'd' + i; if (i % 3 === 0) n.loc = { floor: i % 2 ? 'f0' : 'f1', x: (i % 30) + 1, y: (i % 9) + 0.5, h: 0.3 }; d.devices.push(n); }
  for (let i = 1; i < 1500; i++) if (i % 10) d.cables.push({ id: 'c' + i, a: ['d' + i, 'eth0'], b: ['d' + (i - (i % 10)), 'p' + (i % 10)], cat: 'cat6', len: 10 });
  const data = cleanNet(d);
  let t = performance.now(); const V = buildViews(data); const tb = performance.now() - t;
  t = performance.now(); const bytes = writeVsdx(V, { date: DATE }); const tv = performance.now() - t;
  t = performance.now(); const txt = writeDrawio(V, { date: DATE }); const td = performance.now() - t;
  assert.ok(V.pages[0].edges.length > 1300);
  assert.ok(tb < 1500 && tv < 6000 && td < 3000, `vues ${tb | 0} ms, vsdx ${tv | 0} ms, drawio ${td | 0} ms`);
  assert.deepEqual(checkVsdx(readVsdx(bytes)), []);
  assert.deepEqual(checkDrawio(readDrawio(txt)), []);
});

test('import vsdx : aller-retour du schéma logique (types, noms, IP, câbles, longueurs)', () => {
  const src = project(); src.devices.find(d => d.id === 'pc1').p.ip = { mode: 'static', ip: '10.0.10.21', prefix: 24, gw: '', dns: '' };
  const r = readVsdx(writeVsdx(buildViews(src, { views: { logic: true, racks: false, floors: false } }), { date: DATE }));
  const plan = planVsdx(r), pg = plan.pages[0];
  assert.equal(pg.links.length, src.cables.length);
  for (const g of pg.groups) assert.equal(g.guess, g.key, 'nos gabarits portent le type');
  const mapping = Object.fromEntries(pg.groups.map(g => [g.key, g.guess]));
  const data = cleanNet({}), used = new Set();
  const deps = { newDevice: (t, at) => { const d = newDevice(t, used, at); used.add(d.name); d.id = 'n' + data.devices.length; data.devices.push(d); return d; }, addCable: (a, b, o) => { const c = { id: 'k' + data.cables.length, a, b, cat: o.cat || 'cat6', len: o.len || 5 }; data.cables.push(c); return c; } };
  const out = applyVsdx(data, pg, mapping, deps);
  assert.equal(out.devices, src.devices.length); assert.equal(out.cables, src.cables.length); assert.deepEqual(out.skipped, { shapes: 0, links: 0, ports: 0 });
  const count = list => list.map(d => d.type).sort().join(',');
  assert.equal(count(data.devices), count(src.devices));
  const pc1 = data.devices.find(d => d.name === src.devices.find(x => x.id === 'pc1').name); assert.equal(pc1.p.ip.ip, '10.0.10.21'); assert.equal(pc1.p.ip.mode, 'static');
  assert.ok(data.cables.some(c => c.len === 35 && c.cat === 'cat6a'), 'longueur et catégorie reprises');
  const clean = cleanNet(data); assert.equal(clean.cables.length, src.cables.length, 'ports valides : rien retiré au nettoyage');
  const names = new Map(data.devices.map(d => [d.id, d.name])), srcNames = new Map(src.devices.map(d => [d.id, d.name]));
  const sig = (c, N) => [N.get(c.a[0]) + ':' + c.a[1], N.get(c.b[0]) + ':' + c.b[1]].sort().join('—');
  assert.deepEqual(data.cables.map(c => sig(c, names)).sort(), src.cables.map(c => sig(c, srcNames)).sort(), 'mêmes ports aux deux bouts');
  // Rien de choisi : rien d'importé.
  assert.equal(applyVsdx(cleanNet({}), pg, {}, deps).devices, 0);
});
test('import vsdx dans un projet qui a déjà ces équipements : doublons repérés, mettre à jour / garder / ajouter', () => {
  const src = project();
  const r = readVsdx(writeVsdx(buildViews(src, { views: { logic: true, racks: false, floors: false } }), { date: DATE }));
  const pg = planVsdx(r).pages[0], mapping = Object.fromEntries(pg.groups.map(g => [g.key, g.guess]));
  const deps = data => { const used = new Set(data.devices.map(d => d.name)); return { newDevice: (t, at) => { const d = newDevice(t, used, at); used.add(d.name); d.id = 'n' + data.devices.length; data.devices.push(d); return d; }, addCable: (a, b, o) => { data.cables.push({ id: 'k' + data.cables.length, a, b, cat: o.cat || 'cat6', len: o.len || 5 }); } }; };
  assert.equal(findDuplicates(src, pg, mapping).size, src.devices.length, 'chaque forme retrouve son équipement');
  // Mettre à jour : rien d'ajouté, l'IP du fichier reprise, aucun câble refait.
  const up = cleanNet(project()); up.devices.find(d => d.id === 'pc1').p.ip = { mode: 'dhcp', ip: '', prefix: 24, gw: '', dns: '' };
  const src2 = project(); src2.devices.find(d => d.id === 'pc1').p.ip = { mode: 'static', ip: '10.9.9.9', prefix: 24, gw: '', dns: '' };
  const pg2 = planVsdx(readVsdx(writeVsdx(buildViews(src2, { views: { logic: true, racks: false, floors: false } }), { date: DATE }))).pages[0];
  const a = applyVsdx(up, pg2, mapping, deps(up), { dup: 'update' });
  assert.equal(a.devices, 0); assert.equal(a.cables, 0); assert.equal(a.matched, src.devices.length); assert.equal(a.updated, 1); assert.equal(a.existing, src.cables.length);
  assert.equal(up.devices.length, src.devices.length); assert.equal(up.devices.find(d => d.id === 'pc1').p.ip.ip, '10.9.9.9');
  // Garder tels quels : rien ne change.
  const keep = cleanNet(project()); keep.devices.find(d => d.id === 'pc1').p.ip = { mode: 'dhcp', ip: '', prefix: 24, gw: '', dns: '' };
  const b = applyVsdx(keep, pg2, mapping, deps(keep), { dup: 'skip' });
  assert.equal(b.devices + b.cables + b.updated, 0); assert.equal(keep.devices.find(d => d.id === 'pc1').p.ip.mode, 'dhcp');
  // Ajouter en double : tout est recréé.
  const dbl = project(), c = applyVsdx(dbl, pg, mapping, deps(dbl), { dup: 'add' });
  assert.equal(c.devices, src.devices.length); assert.equal(dbl.devices.length, 2 * src.devices.length);
  // Câble manquant entre deux équipements existants : ajouté.
  const miss = project(); miss.cables = miss.cables.filter(x => x.id !== 'c-ap');
  const m = applyVsdx(miss, pg, mapping, deps(miss), { dup: 'update' });
  assert.equal(m.cables, 1); assert.equal(m.devices, 0); assert.ok(miss.cables.some(x => [x.a[0], x.b[0]].sort().join() === 'ap1,sw1'));
});
test('texte ajusté à la forme, PDU 0 U dans l’élévation', () => {
  assert.equal(fitFont('SW', 1.5), 8); assert.ok(fitFont('PR-Salle informatique-12', 0.6) < 8); assert.equal(fitFont('x'.repeat(200), 0.5), 5);
  assert.deepEqual(fitText('SW-1', 1.5, 0.2), { font: 8, text: 'SW-1' }); { const t = fitText('x'.repeat(200), 1.77, 0.17); assert.equal(t.font, 5); assert.ok(t.text.endsWith('…') && t.text.length <= 42, 'nom trop long coupé sur une ligne'); }
  const data = project(), used = new Set(data.devices.map(d => d.name)); const pdu = newDevice('pdu', used, {}); pdu.id = 'pdu1'; pdu.rack = { id: 'rk1', u: 1, face: 'rear' }; data.devices.push(pdu);
  data.devices.find(d => d.id === 'pc1').name = 'PC-Salle-informatique-12';
  const V = buildViews(cleanNet(data)), rk = V.pages.find(p => p.kind === 'rack'), s = rk.shapes.find(x => x.ref && x.ref.id === 'pdu1');
  assert.ok(s && s.vtext && s.h > 1500, 'bande verticale sur la hauteur de la baie');
  assert.ok(rk.name.includes('Baie 1'), 'page nommée par le nom de la baie');
  const pc = V.pages[0].shapes.find(x => x.ref && x.ref.id === 'pc1'); assert.ok(pc.style.font < 8);
  const r = readVsdx(writeVsdx(V, { date: DATE })); assert.deepEqual(checkVsdx(r), []);
  const sh = r.pages[0].shapes.find(x => x.text === 'PC-Salle-informatique-12'); assert.ok(Math.abs(sh.font.size * 72 - pc.style.font) < 1e-3, 'taille du texte écrite sur l’instance');
  assert.ok(r.pages[1].shapes.some(x => x.txt && x.text === pdu.name), 'texte tourné de la PDU');
  assert.deepEqual(checkDrawio(readDrawio(writeDrawio(V, { date: DATE }))), []);
});
test('import vsdx : devinette du type d’après le gabarit ou le texte', () => {
  assert.equal(guessType('Router'), 'routerpro'); assert.equal(guessType('Switch 48'), 'switch24'); assert.equal(guessType('Core switch'), 'l3switch');
  assert.equal(guessType('Rectangle', ['AP-Hall', 'Point d’accès 2']), 'ap'); assert.equal(guessType('Serveur'), 'server'); assert.equal(guessType('Prise RJ45'), 'outlet');
  assert.equal(guessType('Ellipse', ['blabla']), ''); assert.equal(guessType('pc'), 'pc');
});

/* ---------- Contrôles indépendants (outils d'essai) ---------- */
const PY = process.env.JOLLOF_VISIO_PY, XSD = process.env.JOLLOF_VISIO_XSD;
const pyOk = !!(PY && fs.existsSync(PY) && spawnSync(PY, ['-I', '-c', 'import vsdx, lxml'], { encoding: 'utf8' }).status === 0);
test('outil indépendant : paquet vsdx (Python) ouvre le fichier, compte pages, formes, Connect et données', { skip: !pyOk && 'JOLLOF_VISIO_PY (Python avec vsdx et lxml) absent' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvsdx-')), f = path.join(dir, 't.vsdx');
  try {
    const data = project(); fs.writeFileSync(f, writeVsdx(buildViews(data), { date: DATE }));
    const py = `import sys, json\nfrom vsdx import VisioFile\nwith VisioFile(sys.argv[1]) as v:\n  out=[]\n  for p in v.pages:\n    ids={s.ID for s in p.all_shapes}\n    out.append({'name':p.name,'shapes':len(p.child_shapes),'connects':len(p.connects),'bad':sum(1 for c in p.connects if c.from_id not in ids or c.to_id not in ids),'data':sum(1 for s in p.child_shapes if s.data_properties)})\n  print(json.dumps(out))`;
    const r = spawnSync(PY, ['-I', '-c', py, f], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const pages = JSON.parse(r.stdout);
    assert.equal(pages.length, 4); assert.equal(pages[0].connects, 2 * data.cables.length); assert.ok(pages.every(p => p.bad === 0)); assert.ok(pages[0].data >= data.devices.length);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('outil indépendant : dessin écrit par Visio (exemple du paquet Python vsdx) relu et importé', { skip: !pyOk && 'JOLLOF_VISIO_PY absent' }, () => {
  const r0 = spawnSync(PY, ['-I', '-c', 'import vsdx, os; print(os.path.join(os.path.dirname(vsdx.__file__), "media", "media.vsdx"))'], { encoding: 'utf8' });
  const f = r0.stdout.trim(); if (!fs.existsSync(f)) return;
  const r = readVsdx(fs.readFileSync(f));
  assert.deepEqual(checkVsdx(r, { ours: false }), []);
  const pg = planVsdx(r).pages[0]; assert.ok(pg.shapes.length >= 2 && pg.links.length >= 1, 'connecteurs dynamiques (_WALKGLUE, ToCell PinX) reconnus par leurs Connect');
  const data = cleanNet({}), used = new Set();
  const out = applyVsdx(data, pg, Object.fromEntries(pg.groups.map(g => [g.key, 'pc'])), { newDevice: (t, at) => { const d = newDevice(t, used, at); used.add(d.name); d.id = 'n' + data.devices.length; data.devices.push(d); return d; }, addCable: (a, b) => data.cables.push({ id: 'k' + data.cables.length, a, b }) });
  assert.equal(out.devices, pg.shapes.length);
});
const xsdOk = pyOk && XSD && fs.existsSync(path.join(XSD, 'vsdx.xsd')) && fs.existsSync(path.join(XSD, 'mxfile.xsd'));
test('outil indépendant : parties Visio valides pour le schéma de [MS-VSDX], .drawio valide pour mxfile.xsd', { skip: !xsdOk && 'JOLLOF_VISIO_XSD (schémas) absent' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvsdx-'));
  try {
    const V = buildViews(project()), fv = path.join(dir, 't.vsdx'), fd = path.join(dir, 't.drawio');
    fs.writeFileSync(fv, writeVsdx(V, { date: DATE })); fs.writeFileSync(fd, writeDrawio(V, { date: DATE }));
    const py = `import sys, zipfile\nfrom lxml import etree\nS=etree.XMLSchema(etree.parse(sys.argv[1]))\nz=zipfile.ZipFile(sys.argv[2]); bad=[]\nfor n in z.namelist():\n  if n.startswith('visio/') and n.endswith('.xml'):\n    d=etree.fromstring(z.read(n).replace(b'http://schemas.microsoft.com/office/visio/2012/main', b'http://schemas.microsoft.com/office/visio/2011/1/core'))\n    if not S.validate(d): bad.append(n+': '+str(S.error_log.last_error))\nD=etree.XMLSchema(etree.parse(sys.argv[3]))\nif not D.validate(etree.parse(sys.argv[4])): bad.append('drawio: '+str(D.error_log.last_error))\nprint('\\n'.join(bad) or 'ok')`;
    const r = spawnSync(PY, ['-I', '-c', py, path.join(XSD, 'vsdx.xsd'), fv, path.join(XSD, 'mxfile.xsd'), fd], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), 'ok');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
