// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Taille réelle : un campus généré (cœur de niveau 3, 4 switchs de distribution en fibre, 40 switchs d'accès reliés
// chacun à deux distributions, 480 postes derrière prises murales et panneaux, 3 VLAN, relais DHCP vers un serveur) :
// recalcul du réseau et vérificateur en quelques dizaines de millisecondes. node --test src/net/sim.perf.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLan } from './lan.js';
import { netIssues } from './issues.js';
import { bigCampus } from './sim.fixture.mjs';

test('campus de 1500 câbles : recalcul et vérificateur rapides', () => {
  const data = bigCampus();
  assert.ok(data.cables.length >= 1450 && data.devices.length >= 800, `${data.devices.length} équipements, ${data.cables.length} câbles`);
  const lan = createLan({ data: () => data });
  for (let i = 0; i < 3; i++) { lan.refresh(); netIssues(lan, data); } // échauffement (compilation à la volée)
  // Médiane de 8 mesures (une mesure isolée subit le ramasse-miettes et les autres programmes de la machine).
  const R = [], I = [];
  for (let i = 0; i < 8; i++) { const t0 = performance.now(); lan.refresh(); const t1 = performance.now(); netIssues(lan, data); I.push(performance.now() - t1); R.push(t1 - t0); }
  const med = a => a.sort((x, y) => x - y)[a.length >> 1], tr = med(R), ti = med(I);
  console.log(`    campus : ${data.devices.length} équipements, ${data.cables.length} câbles ; recalcul ${tr.toFixed(1)} ms, vérificateur ${ti.toFixed(1)} ms`);
  // Le réseau marche : pas de tempête (le Spanning Tree bloque les doubles liaisons), chaque poste a son adresse.
  assert.equal(lan.state().storm.size, 0);
  assert.equal(lan.state().ifaces.filter(f => f.role === 'host' && f.src === 'dhcp' && f.ip).length, 480);
  assert.ok(lan.ping('pc1', 'PC480').ok);
  // Machine chargée (tests en parallèle) : marge large ; seul, le recalcul et le vérificateur restent sous ~50 ms chacun.
  const lim = process.env.JOLLOF_PERF_STRICT ? 50 : 400;
  assert.ok(tr < lim, `recalcul ${tr.toFixed(1)} ms`); assert.ok(ti < lim, `vérificateur ${ti.toFixed(1)} ms`);
});
