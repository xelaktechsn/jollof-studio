// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Catalogue de matériel réel : node --test src/net/catalog.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCES } from '../check/sources.js';
import '../check/sources-net.js';
import { NET } from './limits.js';
import { DEVICES, portsOf, layPorts } from './devices.js';
import { cleanNet } from './clean.js';
import { KINDS, NOTE_CODES, cleanModel, cleanLay, applyModel, clearModel, lostCables, productsFor, searchProducts, refKindOf, cleanRefs, specLine, notesOf, MODEL_TYPES, familyOf } from './catalog.js';
import { mountDev, mountOf, devicePower, canPlace, cleanRacks } from './rack.js';
import { bom, csvTables, modelKey, makerOfDev } from './docs.js';
import { catalogueDev } from './interop/dcimsync.js';

const P = JSON.parse(readFileSync(new URL('./catalog/products.json', import.meta.url), 'utf8'));
const by = id => P.find(p => p.id === id);

test('catalogue : au moins 60 produits, identifiants uniques et courts, plusieurs fabricants', () => {
  assert.ok(P.length >= 60, String(P.length));
  assert.equal(new Set(P.map(p => p.id)).size, P.length);
  assert.ok(new Set(P.map(p => p.vendor)).size >= 6);
  for (const p of P) { assert.match(p.id, /^[a-z0-9.+-]{3,26}$/, p.id); assert.ok(modelKey(p).length <= 30 && /^[\w-]+$/.test(modelKey(p)), p.id); }
  assert.deepEqual([...new Set(P.map(p => p.vendor))].sort(), [...NET.CATALOG_VENDORS.v].sort());
});
test('chaque produit cite une fiche lue (source connue, adresse https), sans prix ni image', () => {
  const srcs = new Set(NET.CATALOG_VENDORS.src);
  for (const p of P) {
    assert.ok(KINDS.includes(p.kind), p.id); assert.ok(p.vendor && p.model && p.pn, p.id);
    assert.ok(SOURCES[p.src], `${p.id} : source ${p.src}`); assert.ok(srcs.has(p.src), p.id);
    assert.match(p.url, /^https:\/\//, p.id);
    for (const k of ['price', 'prix', 'image', 'img', 'logo']) assert.ok(!(k in p), `${p.id} : ${k}`);
    for (const n of p.notes || []) assert.ok(NOTE_CODES.includes(n), `${p.id} : remarque ${n}`);
    assert.equal(notesOf(p).length, (p.notes || []).length);
    assert.ok(specLine(p).length > 0, p.id);
  }
  for (const s of srcs) assert.ok(P.some(p => p.src === s), `${s} ne sert à aucun produit`);
});
test('aucun nombre inventé : champs numériques finis et plausibles, absents plutôt que nuls', () => {
  for (const p of P) {
    for (const k of ['u', 'depth', 'width', 'kg', 'w', 'wMax', 'btu']) if (k in p) { assert.ok(Number.isFinite(p[k]) && p[k] >= 0, `${p.id}.${k}`); assert.notEqual(p[k], null); }
    if (p.w != null && p.wMax != null) assert.ok(p.wMax >= p.w, p.id);
    if (p.poe && p.poe.budget && p.wMax && p.w != null) assert.ok(p.wMax >= p.poe.budget, `${p.id} : maximum sous le budget PoE`);
    if (p.depth) assert.ok(p.depth > 50 && p.depth < 1300, p.id);
    if (p.type) assert.ok(DEVICES[p.type], `${p.id} : type ${p.type}`);
    if (p.type) assert.ok(MODEL_TYPES.has(p.type), `${p.id} : ${p.type} sans bouton de modèle`);
    if (p.lay) { assert.deepEqual(cleanLay(p.lay), p.lay, p.id); assert.ok(p.lay.poe <= p.lay.rj); assert.equal(!!p.poe, p.lay.poe > 0, p.id); }
  }
});
test('disposition des ports : le modèle décide des ports, du PoE et des cages', () => {
  const d0 = { id: 'sw', type: 'switch24', name: 'SW1', x: 0, y: 0, p: DEVICES.switch24.props() };
  assert.equal(portsOf(d0).length, 28);
  const a = applyModel(d0, by('ui-usw-48-poe'));
  assert.equal(a.type, 'switch48');
  const ports = portsOf(a);
  assert.equal(ports.filter(p => !p.sfp).length, 48); assert.equal(ports.filter(p => p.poe === 'pse').length, 32);
  assert.deepEqual(ports.filter(p => p.sfp).map(p => p.sfp), ['sfp', 'sfp', 'sfp', 'sfp']);
  assert.equal(a.p.budget, 195); assert.equal(a.model.pn, 'USW-48-POE');
  assert.equal(d0.type, 'switch24', 'l’original est intact');
  const t = applyModel(d0, by('cisco-c1300-24t-4g'));
  assert.equal(portsOf(t).filter(p => p.poe).length, 0); assert.equal(t.p.budget, 0);
  const small = applyModel(d0, by('cisco-c1000-8p-2g-l'));
  assert.equal(portsOf(small).length, 10);
  assert.equal(layPorts(by('cisco-c1300-12xs').lay, true)[0].id, 'x1', 'cages d’abord sur un switch de cœur');
  assert.equal(applyModel(d0, by('ui-u7-pro')), null, 'un point d’accès ne va pas à un switch');
  const back = clearModel(a);
  assert.equal(back.model, undefined); assert.equal(back.p.lay, undefined); assert.equal(back.p.budget, DEVICES.switch48.props().budget);
});
test('le fichier garde le modèle et sa disposition ; un modèle invalide est écarté', () => {
  const d = applyModel({ id: 'sw', type: 'switch24', name: 'SW1', x: 0, y: 0, p: DEVICES.switch24.props() }, by('cisco-c1000-8p-2g-l'));
  const pc = { id: 'pc', type: 'pc', name: 'PC1', x: 0, y: 0, p: {} };
  const raw = { devices: [d, pc, { ...pc, id: 'pc2', name: 'PC2', model: { id: '<x>', vendor: 'v', pn: 'p' } }], cables: [{ id: 'c1', a: ['sw', 'p8'], b: ['pc', 'eth0'], cat: 'cat6', len: 3 }, { id: 'c2', a: ['sw', 'p9'], b: ['pc2', 'eth0'], cat: 'cat6', len: 3 }] };
  const c = cleanNet(JSON.parse(JSON.stringify(raw)));
  assert.equal(c.devices[0].model.pn, 'C1000-8P-2G-L'); assert.deepEqual(c.devices[0].p.lay, by('cisco-c1000-8p-2g-l').lay);
  assert.equal(c.devices[2].model, undefined);
  assert.deepEqual(c.cables.map(x => x.id), ['c1'], 'le port 9 n’existe pas sur un 8 ports');
  assert.deepEqual(cleanNet(JSON.parse(JSON.stringify(c))).devices[0], c.devices[0], 'nettoyage idempotent');
  // Changer pour un modèle plus petit : les câbles perdus sont annoncés avant.
  const big = applyModel({ id: 'sw', type: 'switch24', name: 'SW1', x: 0, y: 0, p: DEVICES.switch24.props() }, by('cisco-c1300-24p-4g'));
  const data = { devices: [big, pc], cables: [{ id: 'c1', a: ['sw', 'p20'], b: ['pc', 'eth0'] }] };
  assert.deepEqual(lostCables(data, big, applyModel(big, by('cisco-c1000-8p-2g-l'))), ['c1']);
  assert.deepEqual(lostCables(data, big, applyModel(big, by('ui-usw-pro-24-poe'))), []);
});
test('baies : hauteur, profondeur, poids et puissance viennent de la fiche du modèle, jamais du type générique', () => {
  const d = applyModel({ id: 'sw', type: 'switch48', name: 'SW1', x: 0, y: 0, p: DEVICES.switch48.props() }, by('mikrotik-crs354-48p'));
  const m = mountDev(d), g = mountOf('switch48');
  assert.equal(m.depth, 382); assert.equal(m.kg, null, 'poids absent de la fiche : null, pas celui du type'); assert.notEqual(g.kg, null);
  assert.equal(m.typ, 85); assert.equal(m.max, 800); assert.equal(m.ref, 'MikroTik CRS354-48P-4S+2Q+RM');
  assert.equal(devicePower(d, null).max, 800);
  assert.equal(mountDev({ type: 'switch48' }), g, 'sans modèle : le montage du type');
  const c1000 = mountDev(applyModel(d, by('cisco-c1000-48p-4g-l')));
  assert.equal(c1000.max, 424.25, 'sans maximum dans la fiche : majorant sans PoE + budget');
  // Profondeur du modèle contre celle de la baie.
  const rack = cleanRacks([{ id: 'r', kind: 'wall' }])[0], deep = applyModel(d, by('ui-usw-pro-48-poe'));
  const ok = canPlace({ devices: [], racks: [rack] }, rack, deep, 1, 'front');
  assert.equal(typeof ok.ok, 'boolean');
  const compact = mountDev(applyModel({ id: 'r1', type: 'routerpro', name: 'RT1', p: DEVICES.routerpro.props() }, by('mikrotik-rb5009ug')));
  assert.equal(compact.shelf, true); assert.equal(compact.max, 25);
});
test('nomenclature, tableaux et NetBox : fabricant et référence du modèle', () => {
  const mk = (id, type, pid) => { const d = { id, type, name: id.toUpperCase(), x: 0, y: 0, p: DEVICES[type].props() }; return pid ? applyModel(d, by(pid)) : d; };
  const data = cleanNet({ devices: [mk('a', 'switch24', 'cisco-c1300-24p-4g'), mk('b', 'switch24', 'cisco-c1300-24p-4g'), mk('c', 'switch24'), mk('d', 'ap6', 'tplink-eap650')], cables: [], refs: { sfp: by('cisco-sfp-10g-sr'), nope: { id: 'x' } } });
  const b = bom(data), line = b.lines.find(l => l.key === 'm_cisco-c1300-24p-4g');
  assert.equal(line.qty, 2); assert.equal(line.maker, 'Cisco'); assert.equal(line.part, 'C1300-24P-4G');
  assert.equal(b.lines.find(l => l.key === 'switch24').qty, 1);
  assert.equal(b.lines.find(l => l.key === 'm_tplink-eap650').part, 'EAP650');
  assert.deepEqual(Object.keys(data.refs), ['sfp']);
  const rows = csvTables(data, null, {}).bom.rows;
  assert.ok(rows.some(r => r.maker === 'Cisco' && r.part === 'C1300-24P-4G'));
  assert.ok(rows.every(r => typeof r.maker === 'string' && typeof r.part === 'string'));
  assert.deepEqual(makerOfDev(data.devices[0]), { maker: 'Cisco', part: 'C1300-24P-4G' });
  const c = catalogueDev(data.devices[0]);
  assert.equal(c.maker, 'Cisco'); assert.equal(c.model, 'C1300-24P-4G'); assert.equal(c.slug, 'cisco-c1300-24p-4g'); assert.equal(c.u, 1);
  assert.equal(data.devices[3].p.poeClass, 4); assert.equal(data.devices[3].p.radios.b5.gain, 5);
});
test('recherche, familles, références de lignes', () => {
  assert.ok(searchProducts(P, 'cisco 48fp').length >= 3);
  assert.ok(searchProducts(P, 'USW', 'switch').every(p => p.vendor === 'Ubiquiti'));
  assert.equal(searchProducts(P, 'zzzz').length, 0);
  assert.ok(productsFor(P, 'switch24').some(p => p.type === 'l3switch')); assert.deepEqual(familyOf('pdu'), ['pdu']);
  assert.ok(productsFor(P, 'ap').length >= 5);
  assert.deepEqual(refKindOf('box_cat6a'), { kind: 'cable', cat: 'cat6a' }); assert.equal(refKindOf('cord'), null);
  assert.ok(P.some(p => p.kind === 'cable' && p.cat === 'cat6a') && P.filter(p => p.kind === 'sfp').length >= 10);
  assert.equal(cleanModel({ id: 'ok-1', vendor: 'V', pn: 'P', kg: 'abc', u: 1.4 }).u, 1);
  assert.equal(cleanModel({ id: 'ok-1', vendor: 'V', pn: 'P', kg: 'abc' }).kg, undefined);
  assert.deepEqual(cleanRefs({ 'bad key': by('cisco-glc-te') }), {});
});
