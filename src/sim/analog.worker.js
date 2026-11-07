// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// ngspice (compilé en WebAssembly, paquet eecircuit-engine) dans son propre fil : le calcul d'une fenêtre de
// transitoire ne fige jamais l'interface. Chargé au premier usage seulement (une vingtaine de Mo).
import { runSpice } from './analog.js';

self.onmessage = async e => {
  const { id, text } = e.data;
  try { self.postMessage({ id, ok: true, data: await runSpice(text) }); } catch (err) { self.postMessage({ id, ok: false, error: String((err && err.message) || err) }); }
};
