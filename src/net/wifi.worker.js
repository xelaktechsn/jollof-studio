// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Calcul de la carte Wi-Fi d'un étage hors du fil de l'interface (ui/wifilayer.js) : mêmes fonctions que src/net/wifi.js.
// Message reçu : { id, data (points d'accès + bâtiment de l'étage + réglages), floor, band, step? } ; rendu : { id, res }
// (grille et tableaux typés transférés, sans les signaux de chaque point d'accès).
import { coverageOf } from './wifi.js';

self.onmessage = e => {
  const { id, data, floor, band, step } = e.data || {};
  try {
    const r = coverageOf(data, floor, band, step ? { step } : {});
    if (!r) { self.postMessage({ id, res: null }); return; }
    const best = r.best.slice(), srv = r.srv.slice(), cci = r.cci.slice(), sinr = r.sinr.slice();
    const res = { floor: r.floor, band: r.band, x0: r.x0, y0: r.y0, step: r.step, nx: r.nx, ny: r.ny, best, srv, cci, sinr, aps: r.aps, set: r.set, ...(r.parts ? { parts: Object.fromEntries(Object.keys(r.parts).map(k => [k, true])) } : {}) };
    self.postMessage({ id, res }, [best.buffer, srv.buffer, cci.buffer, sinr.buffer]);
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
