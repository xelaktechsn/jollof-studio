// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Remplacement d'un composant par un autre : à quelle broche du nouveau va chaque fil de l'ancien.
// Module pur. La proposition suit le nom des broches : même nom, même nom une fois simplifié
// (casse, ponctuation, suffixe « (2) »), puis même famille (masse, alimentation, signal, bus) ;
// deux pattes contre deux pattes : dans l'ordre. Une broche sans équivalent reste à choisir.

const FAMILIES = [
  ['gnd', 'g', 'vss', '0v', 'ground', 'masse', '-', 'gnd1', 'gnd2', 'com'],
  ['vcc', 'vdd', 'vin', 'v+', '+', '5v', '3v3', '33v', '3v', 'vbus', 'pwr', 'vs'],
  ['sig', 's', 'out', 'do', 'd0', 'data', 'dat', 'dq', 'signal', 'in', 'din', 'ctrl'],
  ['ao', 'a0', 'aout', 'analog'],
  ['sda', 'sdi'], ['scl', 'sclk'], ['sck', 'clk'], ['mosi', 'di', 'copi'], ['miso', 'so', 'cipo'], ['ss', 'cs', 'ce', 'nss'],
  ['tx', 'txd', 'tx0'], ['rx', 'rxd', 'rx0'],
  ['a', 'anode', 'an'], ['k', 'c', 'cathode', 'cat']
];
/** Nom simplifié : minuscules, sans suffixe de doublon ni ponctuation (les signes + et − comptent). */
export const simple = k => String(k).replace(/ \(\d+\)$/, '').toLowerCase().replace(/[^a-z0-9+\-]/g, '');
const family = k => FAMILIES.findIndex(f => f.includes(simple(k)));

/**
 * Propose la broche du nouveau composant pour chaque broche câblée de l'ancien.
 * oldKeys : broches de l'ancien qui portent un fil ; newKeys : toutes les broches du nouveau.
 * Rend { ancienne: nouvelle | null } ; une broche du nouveau n'est proposée qu'une fois.
 */
export function mapPins(oldKeys, newKeys) {
  const out = {}, free = new Set(newKeys);
  const take = (o, pick) => { if (out[o] != null) return; const n = pick(); if (n != null && free.has(n)) { out[o] = n; free.delete(n); } };
  for (const o of oldKeys) out[o] = null;
  for (const o of oldKeys) take(o, () => (free.has(o) ? o : null));
  for (const o of oldKeys) take(o, () => [...free].find(n => simple(n) === simple(o)));
  for (const o of oldKeys) take(o, () => { const f = family(o); return f < 0 ? null : [...free].find(n => family(n) === f); });
  // Deux pattes contre deux pattes (résistance, LED, bouton) : dans l'ordre.
  if (newKeys.length === 2 && oldKeys.length <= 2) for (const o of oldKeys) take(o, () => [...free][0]);
  return out;
}

/** Ce qui empêche d'appliquer une correspondance : la même broche choisie deux fois. Rend les broches en cause. */
export function clashes(map) {
  const seen = new Map(), bad = new Set();
  for (const [o, n] of Object.entries(map)) { if (n == null || n === '') continue; if (seen.has(n)) { bad.add(o); bad.add(seen.get(n)); } else seen.set(n, o); }
  return [...bad];
}
