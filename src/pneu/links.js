// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : les repères qui relient le plan au montage électronique (bobines Y1…, capteurs B1…, pressostats S1…).
// Sans interface : lus par le plan de travail (liaisons, vue partagée, « Ajouter au montage »), les assistants IA et les tests.
import { props } from './elements.js';

/** Composants du montage reliés au plan par leur repère : bobines d'électrovanne, capteurs de vérin, pressostats. */
export const BENCH_LINK = { coil: 'coil24', sensor: 'cylsensor', pswitch: 'pressostat' };
/**
 * Repères du plan qui le relient au montage, dans l'ordre du plan : { name, kind: 'coil'|'sensor', type (composant du
 * montage), el (élément du plan) }. Un repère n'apparaît qu'une fois.
 */
export function tagsOf(c) {
  const out = new Map();
  const add = (n, kind, type, el) => { const k = String(n || '').trim(); if (k && !out.has(k.toUpperCase())) out.set(k.toUpperCase(), { name: k, kind, type, el }); };
  for (const x of c.elements) {
    const P = props(x);
    if (x.type === 'v32' && P.act === 'sol') add(P.coil, 'coil', BENCH_LINK.coil, x.id);
    if ((x.type === 'v52' || x.type === 'v53') && P.left === 'sol') add(P.coilL, 'coil', BENCH_LINK.coil, x.id);
    if ((x.type === 'v52' || x.type === 'v53') && P.right === 'sol') add(P.coilR, 'coil', BENCH_LINK.coil, x.id);
    if (x.type === 'cyl1' || x.type === 'cyl2') { add(P.s0, 'sensor', BENCH_LINK.sensor, x.id); add(P.s1, 'sensor', BENCH_LINK.sensor, x.id); }
    if (x.type === 'pswitch') add(P.sensor, 'sensor', BENCH_LINK.pswitch, x.id);
  }
  return [...out.values()];
}
