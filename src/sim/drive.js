// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Ce qui commande un moteur (ou ventilateur, pompe, vibreur) : pilote L298N, transistor NPN, relais, ou rien
// (alimenté en permanence). Sert au code généré (règles, blocs) et à savoir quelle carte le pilote.
// Pur : se teste sous Node (node --test src/sim/drive.test.mjs).
import { loadPins, NPNS } from './parts.js';
import { MOSFETS } from './analog-parts.js';

/**
 * c : composant moteur ; A : analyse du montage (circuit.js).
 * Rend { kind: 'l298n', drv, keys: [IN, IN, EN], plusFirst } | { kind: 'npn', npn, base, gpio, fet } |
 *      { kind: 'relay', relay, contact: 'NO' | 'NC', gpio } | { kind: 'direct' } | null (pas un moteur).
 * gpio : broche de carte qui commande ({ comp, key, prof… } d'analyze), ou null.
 */
export function driveOf(c, A) {
  const pins = loadPins(c);
  if (!pins || !A) return null;
  const [mp, mm] = pins, ref = k => ({ comp: c, key: k });
  // Pilote L298N : les deux bornes sur les sorties d'une même voie.
  const out = k => A.members(ref(k)).find(m => m.comp.type === 'l298n' && /^OUT/.test(m.key));
  const a = out(mp), b = out(mm);
  if (a && b && a.comp === b.comp) {
    const chB = /OUT[34]/.test(a.key);
    return { kind: 'l298n', drv: a.comp, keys: chB ? ['IN3', 'IN4', 'ENB'] : ['IN1', 'IN2', 'ENA'], plusFirst: a.key === (chB ? 'OUT3' : 'OUT1') };
  }
  // Transistor : une borne sur le collecteur, la base reliée (par sa résistance) à une broche de la carte.
  for (const k of [mm, mp]) {
    const q = A.members(ref(k)).find(m => NPNS[m.comp.type] && m.key === 'C');
    if (q) return { kind: 'npn', npn: q.comp, base: 'B', gpio: A.wnet({ comp: q.comp, key: 'B' }).gpio[0] || null };
    // MOSFET côté masse (drain sur la charge) : même rôle, commandé par sa grille (fet : true).
    const f = A.members(ref(k)).find(m => MOSFETS[m.comp.type] && m.key === 'D');
    if (f) return { kind: 'npn', npn: f.comp, base: 'G', fet: true, gpio: A.wnet({ comp: f.comp, key: 'G' }).gpio[0] || null };
  }
  // Relais : une borne sur NO ou NC (contacts ouverts pour la recherche), son entrée IN sur une broche de la carte.
  for (const k of [mp, mm]) {
    const m = (A.reach ? A.reach(ref(k), { open: true }).members : A.members(ref(k))).find(x => x.comp.type === 'relay' && (x.key === 'NO' || x.key === 'NC'));
    if (m) return { kind: 'relay', relay: m.comp, contact: m.key, gpio: A.net({ comp: m.comp, key: 'IN' }).gpio[0] || null };
  }
  return { kind: 'direct' };
}

/** Carte qui commande ce moteur, ou null. inspect(comp) : inspection (circuit.js) d'un composant. */
export function driveBoard(c, A, inspect) {
  const d = driveOf(c, A);
  if (!d) return null;
  if (d.kind === 'l298n') return inspect(d.drv).board;
  return d.gpio ? d.gpio.comp : null;
}
