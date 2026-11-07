// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Rangement des fils hors du fil principal, pour les très grands montages : l'interface reste fluide.
import { routeWires } from './wiring.js';

self.onmessage = e => {
  const { seq, items, boxes } = e.data;
  const routes = routeWires(items.map(it => ({ ...it, own: new Set(it.own) })), boxes);
  self.postMessage({ seq, routes: [...routes] });
};
