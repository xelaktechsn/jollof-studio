// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Lecture d'un fichier IFC hors du fil de l'interface (assistant d'import) : reçoit { bytes, lang }, renvoie
// { progress } pendant la lecture, puis { model } (readIfc) ou { error }.
import { readIfc } from './ifc.js';

self.onmessage = e => {
  try {
    const m = readIfc(new Uint8Array(e.data.bytes), { onProgress: f => self.postMessage({ progress: f }) });
    self.postMessage({ model: m });
  } catch (err) { self.postMessage({ error: (err && err.message) || String(err) }); }
};
