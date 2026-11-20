// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Exemples de projets réseau (exemples/*.jollof et exemples/pro/*.jollof) : chaque plan réseau passe le vérificateur sans
// erreur ; le grand exemple du collège n'a aucun avertissement non plus, ses postes reçoivent leur adresse et se joignent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanNet } from './clean.js';
import { createLan } from './lan.js';
import { netIssues } from './issues.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../exemples');
const files = [...fs.readdirSync(root).filter(f => f.endsWith('.jollof')), ...fs.readdirSync(path.join(root, 'pro')).filter(f => f.endsWith('.jollof')).map(f => 'pro/' + f)];
const netOf = p => ((p.settings || {}).modules || {}).net;

for (const f of files) {
  const p = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')), raw = netOf(p);
  if (!raw || p.comps.length) continue; // projets Objets connectés : vérifiés avec leur montage ailleurs
  test(`exemple ${f} : plan réseau sans erreur`, () => {
    const data = cleanNet(raw), lan = createLan({ data: () => data, ext: () => [] });
    const iss = netIssues(lan, data), err = iss.filter(i => i.kind === 'err');
    assert.deepEqual(err.map(i => `${i.code} ${i.text}`), []);
    if (f.startsWith('pro/')) assert.deepEqual(iss.map(i => `${i.code} ${i.text}`), [], 'aucun avertissement');
  });
}

test('le collège : fiche à jour, postes en DHCP, ping entre VLAN et vers Internet', () => {
  const f = 'pro/17-college-reseau-deux-etages', p = JSON.parse(fs.readFileSync(path.join(root, f + '.jollof'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(root, f + '.meta.json'), 'utf8'));
  assert.equal(meta.name, p.name); assert.equal(meta.description, p.description); assert.deepEqual(meta.en, p.en);
  const data = cleanNet(netOf(p)), lan = createLan({ data: () => data, ext: () => [] });
  const id = n => data.devices.find(d => d.name === n).id;
  for (const n of ['PC-INFO-1', 'PC-ADMIN', 'TEL-ADMIN', 'IMP-CDI']) assert.equal(lan.ipOf(id(n)).src, 'dhcp', n);
  assert.ok(lan.ping(id('TEL-ADMIN'), 'PC-INFO-1').ok, 'voix → données (routage inter-VLAN)');
  assert.ok(lan.ping(id('PC-ADMIN'), 'SRV-DHCP-DNS').ok, 'données → gestion');
  assert.ok(lan.ping(id('PC-INFO-2'), '203.0.113.1').ok, 'vers l’opérateur (NAT)');
  assert.ok(data.site.buildings[0].floors.length === 2 && data.racks.length === 2 && data.cables.some(c => c.media === 'fibre'));
  assert.ok(data.tests && data.tests.results.length >= 100, 'liens certifiés');
});
