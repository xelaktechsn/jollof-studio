// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Liaisons d'un montage, telles que les compare la correction : chaque groupe réunit les broches
// « REPÈRE.BROCHE » reliées entre elles (trous de breadboard exclus, seuls les composants comptent).

/** Liaisons du montage affiché. */
export function netsOf(app) {
  const A = app.analyze(), seen = new Set(), nets = [];
  for (const w of app.wires()) for (const end of [w.a, w.b]) {
    if (app.isBreadboard(end.comp)) continue;
    const mem = A.members(end);
    if (seen.has(mem)) continue;
    seen.add(mem);
    const pins = [...new Set(mem.filter(m => !app.isBreadboard(m.comp) && A.deg(m) > 0).map(m => `${m.comp.name}.${m.key}`))].sort();
    if (pins.length > 1) nets.push(pins);
  }
  return nets;
}
/** Liaisons et nombre d'erreurs de câblage : ce qu'une copie envoie au serveur. */
export function circuitOf(app) {
  return { nets: netsOf(app), faults: app.faults().filter(f => f.level === 'err').length };
}
