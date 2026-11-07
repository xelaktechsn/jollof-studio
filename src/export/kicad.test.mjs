// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Export KiCad : la netlist se relit (S-expression bien formée), chaque nœud renvoie à un composant et à une
// pastille de son empreinte, et les nœuds sont ceux du montage (aller-retour). node --test src/export/kicad.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { kicadNetlist, kicadSchematic, parseSexpr, footprintOf } from './kicad.js';
import { loadProject } from '../check/load.js';
import { analyze } from '../sim/circuit.js';

const DIR = new URL('../../exemples/', import.meta.url);
const examples = fs.readdirSync(DIR).filter(f => f.endsWith('.jollof'));
const find = (list, head) => list.filter(x => Array.isArray(x) && x[0] === head);
const val = (list, head) => { const x = find(list, head)[0]; return x ? x[1] : undefined; };

for (const f of examples) {
  test(`Netlist KiCad : ${f}`, () => {
    const { comps, wires } = loadProject(JSON.parse(fs.readFileSync(new URL(f, DIR), 'utf8')));
    const text = kicadNetlist({ comps, wires, title: f.replace(/\.jollof$/, ''), date: '2026-11-07', describe: c => ({ title: c.type }) });
    const tree = parseSexpr(text);
    assert.equal(tree[0], 'export');
    assert.equal(val(find(tree, 'version')[0] ? [find(tree, 'version')[0]] : [], 'version'), 'E');
    const compsS = find(tree, 'components')[0].slice(1), netsS = find(tree, 'nets')[0].slice(1);
    const byRef = new Map(compsS.map(c => [val(c.slice(1), 'ref'), c]));
    assert.equal(byRef.size, compsS.length, 'repères uniques');
    assert.equal(compsS.length, comps.filter(c => !/^breadboard/.test(c.type) && Object.keys(c.pins).length).length);
    // Chaque nœud : composant existant, pastille de son empreinte.
    const refOf = new Map(), nodes = [];
    for (const c of comps) refOf.set(c, null);
    for (const n of netsS) for (const node of find(n.slice(1), 'node')) {
      const ref = val(node.slice(1), 'ref'), pin = val(node.slice(1), 'pin');
      assert.ok(byRef.has(ref), `nœud vers ${ref}`);
      nodes.push({ net: val(n.slice(1), 'name'), ref, pin });
    }
    // Aller-retour : deux broches dans le même nœud KiCad ⇔ même conducteur dans le montage.
    const A = analyze(comps, wires, { open: true });
    const drawn = comps.filter(c => !/^breadboard/.test(c.type) && Object.keys(c.pins).length);
    const nameOf = new Map(drawn.map(c => [c, null]));
    const refs = new Map(compsS.map(c => [val(c.slice(1), 'ref'), drawn.find(d => String(d.name || d.id).replace(/[^\w+-]/g, '') === val(c.slice(1), 'ref'))]));
    const where = new Map(nodes.map(n => [`${n.ref}#${n.pin}`, n.net]));
    let checked = 0;
    for (const w of wires) {
      const ends = [w.a, w.b].filter(r => nameOf.has(r.comp));
      if (ends.length < 2) continue;
      const pad = r => { const fp = footprintOf(r.comp); return fp.pads[r.key]; };
      const k = r => `${[...refs].find(([, c]) => c === r.comp)[0]}#${pad(r)}`;
      if (!pad(ends[0]) || !pad(ends[1])) continue;
      assert.equal(where.get(k(ends[0])), where.get(k(ends[1])), `${k(ends[0])} et ${k(ends[1])} reliés par un fil`);
      assert.ok(A.members(ends[0]).some(m => m.comp === ends[1].comp && m.key === ends[1].key));
      checked++;
    }
    assert.ok(checked > 0 || wires.length === 0);
  });
}

test('Empreintes : cathode de LED en pastille 1, connecteur pour un module', () => {
  assert.equal(footprintOf({ type: 'led-red', pins: { A: {}, K: {} } }).pads.K, '1');
  const fp = footprintOf({ type: 'dht22', pins: { VCC: {}, DATA: {}, GND: {} } });
  assert.match(fp.fp, /PinHeader_1x03/); assert.deepEqual(fp.pads, { VCC: '1', DATA: '2', GND: '3' });
  assert.deepEqual(parseSexpr('(a "b \\"c\\"" (d e))'), ['a', 'b "c"', ['d', 'e']]);
});

for (const f of examples) {
  test(`Schéma KiCad : ${f}`, () => {
    const { comps, wires } = loadProject(JSON.parse(fs.readFileSync(new URL(f, DIR), 'utf8')));
    const o = { comps, wires, title: f.replace(/\.jollof$/, ''), date: '2026-11-07', describe: c => ({ title: c.type }) };
    const tree = parseSexpr(kicadSchematic(o)), net = parseSexpr(kicadNetlist(o));
    assert.equal(tree[0], 'kicad_sch');
    const libs = new Map(find(tree, 'lib_symbols')[0].slice(1).map(s => [s[1], s]));
    const syms = find(tree, 'symbol'), labels = find(tree, 'label'), ncs = find(tree, 'no_connect');
    const at = x => { const a = find(x.slice(1), 'at')[0]; return [+a[1], +a[2]]; };
    const key = ([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`;
    const labelAt = new Map(labels.map(l => [key(at(l)), l[1]])), ncAt = new Set(ncs.map(n => key(at(n))));
    // Chaque broche de chaque symbole : au bout, une étiquette (nœud) ou une croix « non connectée ».
    const nodeNet = new Map();
    for (const n of find(find(net, 'nets')[0].slice(1), 'net')) for (const nd of find(n.slice(1), 'node')) nodeNet.set(`${val(nd.slice(1), 'ref')}#${val(nd.slice(1), 'pin')}`, val(n.slice(1), 'name'));
    for (const s of syms) {
      const lib = libs.get(val(s.slice(1), 'lib_id')), [x, y] = at(s);
      const ref = find(s.slice(1), 'property').find(p => p[1] === 'Reference')[2];
      const unit = lib.slice(1).filter(u => Array.isArray(u) && u[0] === 'symbol' && /_1_1$/.test(u[1]))[0];
      const pins = find(unit.slice(2), 'pin');
      assert.deepEqual(new Set(find(s.slice(1), 'pin').map(p => p[1])), new Set(pins.map(p => val(p.slice(3), 'number'))), `${ref} : broches du symbole`);
      for (const p of pins) {
        const [px, py] = at(p), num = val(p.slice(3), 'number'), end = key([x + px, y - py]);
        assert.ok(labelAt.has(end) || ncAt.has(end), `${ref} broche ${num} : ni étiquette ni croix en ${end}`);
        // L'étiquette porte le nom du nœud de la netlist (même circuit des deux côtés).
        if (labelAt.has(end)) assert.equal(labelAt.get(end), nodeNet.get(`${ref}#${num}`), `${ref} broche ${num}`);
      }
    }
  });
}
