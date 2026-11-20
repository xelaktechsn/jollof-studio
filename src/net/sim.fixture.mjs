// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Campus généré pour les tests de taille réelle (sim.perf.test.mjs, mesures de la vue logique) : cœur de niveau 3, 4
// switchs de distribution en fibre, 40 switchs d'accès reliés chacun à deux distributions, 480 postes derrière prises
// murales et panneaux, 3 VLAN, relais DHCP vers un serveur.
import { newDevice } from './devices.js';
import { makeCable } from './cable.js';
import { cleanNet } from './clean.js';

/** Campus : { data, counts }. */
export function bigCampus(access = 40, perSwitch = 12) {
  const devices = [], cables = [], used = new Set();
  const dev = (id, type, p = {}) => { const d = newDevice(type, used); used.add(d.name); d.id = id; d.name = id.toUpperCase(); Object.assign(d.p, p); devices.push(d); return d; };
  const cab = (a, b, o = {}) => cables.push({ id: 'c' + cables.length, a, b, cat: 'cat6', len: o.len || 3, wire: makeCable('straight'), ...o.extra });
  const vl = [10, 20, 30];
  dev('core', 'l3switch', { stp: { on: true, prio: 4096 }, sfp: { x1: '10GBASE-SR', x2: '10GBASE-SR', x3: '10GBASE-SR', x4: '10GBASE-SR' },
    svis: [...vl.map(v => ({ vlan: v, ip: `10.0.${v}.1`, prefix: 22, helper: '10.0.99.10' })), { vlan: 99, ip: '10.0.99.1', prefix: 24 }],
    ports: { x1: { mode: 'trunk' }, x2: { mode: 'trunk' }, x3: { mode: 'trunk' }, x4: { mode: 'trunk' }, p1: { vlan: 99 } } });
  dev('srv', 'server', { ip: { mode: 'static', ip: '10.0.99.10', prefix: 24, gw: '10.0.99.1' }, dhcp: vl.map(v => ({ net: `10.0.${v}.0/22`, gw: `10.0.${v}.1` })) });
  cab(['srv', 'eth0'], ['core', 'p1']);
  const trunk = {}; for (let i = 1; i <= 48; i++) trunk['p' + i] = { mode: 'trunk' };
  for (let k = 1; k <= 4; k++) {
    dev('d' + k, 'switch48', { sfp: { x1: '10GBASE-SR' }, ports: { x1: { mode: 'trunk' }, ...trunk }, stp: { on: true, prio: 8192 } });
    cab(['d' + k, 'x1'], ['core', 'x' + k], { len: 150, extra: { media: 'fibre', fibre: 'om4', splices: 0 } });
  }
  let pc = 0;
  for (let s = 1; s <= access; s++) {
    const v = vl[s % 3], ports = { p23: { mode: 'trunk' }, p24: { mode: 'trunk' } };
    for (let i = 1; i <= perSwitch; i++) ports['p' + i] = { vlan: v };
    dev('a' + s, 'switch24', { ports });
    const d1 = 'd' + (1 + (s % 4)), d2 = 'd' + (1 + ((s + 1) % 4));
    cab(['a' + s, 'p23'], [d1, 'p' + Math.ceil(s / 2)], { len: 20 }); cab(['a' + s, 'p24'], [d2, 'p' + (24 + Math.ceil(s / 2))], { len: 20 });
    dev('pb' + s, 'patch24');
    for (let i = 1; i <= perSwitch; i++) {
      const id = 'pc' + ++pc;
      dev(id, 'pc'); dev('o' + pc, 'outlet');
      cab(['a' + s, 'p' + i], ['pb' + s, 'f' + i], { len: 1 }); cab(['pb' + s, 'b' + i], ['o' + pc, 'back'], { len: 40 }); cab(['o' + pc, 'front'], [id, 'eth0'], { len: 3 });
    }
  }
  const data = cleanNet({ devices, cables, vlans: [{ id: 10, name: 'A', net: '10.0.8.0/22', gw: '10.0.10.1' }, { id: 20, name: 'B' }, { id: 30, name: 'C' }, { id: 99, name: 'S' }] });
  return data;
}
