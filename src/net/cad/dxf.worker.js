// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Lecture d'un DXF hors du fil de l'interface (dxf.js openCad) : le fichier est lu en flux (File.stream()), la
// progression remonte par messages et le CadDoc revient avec ses tableaux typés transférés (sans copie).
// Message reçu : { file?: File|Blob, buffer?: ArrayBuffer|Uint8Array, opts } ; envoyés : { type: 'progress', f },
// { type: 'done', doc }, { type: 'error', message, name }. L'annulation se fait en terminant le worker.
import { parseDxf, transferList } from './dxf.js';

self.onmessage = async e => {
  const { file, buffer, opts } = e.data || {};
  try {
    let last = 0;
    const doc = await parseDxf(file || buffer, {
      ...(opts || {}),
      onProgress: f => { const now = Date.now(); if (f >= 1 || now - last > 80) { last = now; self.postMessage({ type: 'progress', f }); } }
    });
    self.postMessage({ type: 'done', doc }, transferList(doc));
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err), name: (err && err.name) || 'Error' });
  }
};
