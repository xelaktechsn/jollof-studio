// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de « Lié à » (src/net/relate.js) : câblage de bout en bout, adressage, certification, vues, contenu.
// node --test src/net/relate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDesign, applyDesign } from './dimension.js';
import { labeler, cableKind } from './docs.js';
import { cleanNet } from './clean.js';
import { testState, certify, defaultLimit, resultRow, storeResults, linkLabel } from './certify.js';
import { related, walk, indexOf } from './relate.js';
import { fixture, bigFixture } from './dimension.fixture.mjs';
import { best, note } from './perf.mjs';

const built = (f = fixture) => { const d = f(); d.design = cleanDesign({}); applyDesign(d); return d; };
const opts = (d, extra = {}) => { const L = labeler(d), devs = new Map(d.devices.map(x => [x.id, x])); return { label: (id, p) => L.of(id, p), cableLabel: c => L.cable(c), cableKind: c => cableKind(d, c, devs), rackLabel: id => L.rack(id), ...extra }; };

test('prise : lien permanent (tracé sur le plan), port du panneau (baie), cordon, switch et son port, VLAN', () => {
  const d = built(), out = d.devices.find(x => x.type.startsWith('outlet') && x.loc);
  const r = related(d, { kind: 'dev', id: out.id }, opts(d));
  const pl = r.find(x => x.key.startsWith('cable:') && x.label.startsWith('Lien permanent'));
  assert.ok(pl, 'lien permanent'); assert.equal(pl.target.view, 'plan'); assert.equal(pl.letter, 'c');
  const panel = r.find(x => x.key.startsWith('dev:') && /^patch/.test(d.devices.find(z => z.id === x.target.id).type));
  assert.ok(panel, 'panneau'); assert.equal(panel.target.view, 'racks'); assert.match(panel.label, /port/);
  const sw = r.find(x => x.letter === 's'); assert.ok(sw, 'switch');
  assert.ok(r.some(x => x.key.startsWith('vlan:')), 'VLAN du port');
  assert.ok(r.some(x => x.key === 'v:plan' && x.target.view === 'plan'));
  assert.ok(r.some(x => x.key === 'patch' && x.target.dock === 'netPatch'));
  // groupes dans l'ordre : vues, câblage, adressage, certification
  const g = r.map(x => x.group); assert.deepEqual(g, [...g].sort((a, b) => ['place', 'cabling', 'addressing', 'test', 'contents'].indexOf(a) - ['place', 'cabling', 'addressing', 'test', 'contents'].indexOf(b)));
  // une lettre au plus une fois
  const L = r.map(x => x.letter).filter(Boolean); assert.equal(new Set(L).size, L.length);
});
test('marche à travers les passifs : prise → panneau → switch', () => {
  const d = built(), ix = indexOf(d), out = d.devices.find(x => x.type.startsWith('outlet') && x.loc);
  const port = d.cables.find(c => c.a[0] === out.id || c.b[0] === out.id), pid = port.a[0] === out.id ? port.a[1] : port.b[1];
  const hops = walk(ix, out.id, pid);
  assert.ok(hops.length >= 2); assert.equal(hops[0].pass, true);
  assert.equal(hops[hops.length - 1].pass, false);
});
test('équipement en baie : nœud logique, baie et U, baie sur le plan ; switch : ports câblés, plafond', () => {
  const d = built(), sw = d.devices.find(x => x.rack && /switch/.test(x.type));
  const r = related(d, { kind: 'dev', id: sw.id }, opts(d, { max: 3 }));
  assert.ok(r.find(x => x.key === 'v:logic' && x.letter === 'l'));
  const rk = r.find(x => x.key === 'v:rack'); assert.match(rk.label, /U\d+/); assert.equal(rk.target.view, 'racks');
  assert.equal(r.find(x => x.key === 'v:plan').target.kind, 'rack');
  assert.equal(r.filter(x => x.key.startsWith('port:p') || x.key.startsWith('port:x')).length, 3);
  const more = r.find(x => x.key === 'port:more'); if (more) assert.ok(more.target.select.length > 3);
});
test('adressage : IP fixe, DHCP, passerelle ; IP reçue (simulation) prioritaire', () => {
  const d = cleanNet({ devices: [{ id: 'pc', type: 'pc', name: 'PC', x: 0, y: 0, p: { ip: { mode: 'static', ip: '10.0.0.5', prefix: 24, gw: '10.0.0.1' } } }, { id: 'p2', type: 'pc', name: 'P2', x: 0, y: 0 }], cables: [] });
  const a = related(d, { kind: 'dev', id: 'pc' }, {}).find(x => x.key === 'a:ip');
  assert.equal(a.label, 'Adresse IP 10.0.0.5/24'); assert.equal(a.target.section, 'ip'); assert.match(a.sub, /passerelle 10\.0\.0\.1/);
  const b = related(d, { kind: 'dev', id: 'p2' }, { ipOf: () => ({ ip: '192.168.1.20', prefix: 24 }) }).find(x => x.key === 'a:ip');
  assert.equal(b.label, 'Adresse IP 192.168.1.20/24');
});
test('certification : résultat du lien, caché en examen ; câble : bouts, canal, tracé, test', () => {
  const d = built(), st = testState(d), row = st.rows.find(r => r.link.kind === 'pl');
  const res = certify(row.link, defaultLimit(row.link));
  storeResults(d, [resultRow(res, row.link, linkLabel(d, row.link))]);
  const rows = testState(d).rows.map(r => ({ ...r, label: linkLabel(d, r.link) }));
  const c = row.link.cables[0];
  const r = related(d, { kind: 'cable', id: c.id }, opts(d, { tests: rows }));
  const t = r.find(x => x.group === 'test' && x.key === 'test:' + row.link.id);
  assert.ok(t); assert.match(t.label, /PASS|FAIL/); assert.equal(t.target.dock, 'netTests');
  const e = related(d, { kind: 'cable', id: c.id }, opts(d, { tests: rows, exam: true })).find(x => x.key === 'test:' + row.link.id);
  assert.doesNotMatch(e.label, /PASS|FAIL|marge/);
  assert.equal(r.filter(x => x.key.startsWith('dev:')).length, 2);
  assert.ok(r.find(x => x.key === 'chan'), 'canal');
  assert.ok(r.find(x => x.key === 'v:plan' && x.target.kind === 'cable'));
});
test('baie, pièce, étage : vues et contenu', () => {
  const d = built();
  const rk = related(d, { kind: 'rack', id: 'rk1' }, opts(d));
  assert.ok(rk.find(x => x.key === 'v:racks')); assert.ok(rk.find(x => x.key === 'v:plan'));
  assert.ok(rk.find(x => x.key === 'c:devs').target.select.length > 0);
  assert.ok(rk.find(x => x.key === 'patch'));
  const room = related(d, { kind: 'room', id: 'f0-b1' }, opts(d));
  assert.ok(room.find(x => x.key === 'c:devs').target.select.every(s => s.kind === 'dev'));
  const lt = related(d, { kind: 'room', id: 'f0-lt' }, opts(d));
  assert.ok(lt.find(x => x.key === 'c:rk1' && x.letter === 'b'));
  const fl = related(d, { kind: 'floor', id: 'f0' }, opts(d));
  assert.ok(fl.find(x => x.key === 'c:devs').target.select.length > room.find(x => x.key === 'c:devs').target.select.length);
  assert.deepEqual(related(d, { kind: 'dev', id: 'absent' }, {}), []);
  assert.deepEqual(related(d, null, {}), []);
});
test('rapide sur un grand projet (index partagé)', () => {
  const d = built(() => bigFixture(3, 4)), o = opts(d), ix = indexOf(d);
  const outs = d.devices.filter(x => x.type.startsWith('outlet')).slice(0, 50);
  const ms = best(() => { for (const x of outs) related(d, { kind: 'dev', id: x.id }, { ...o, ix }); }, 3) / outs.length;
  assert.ok(ms < 5, note('Lié à (par objet)', ms, 5));
});
