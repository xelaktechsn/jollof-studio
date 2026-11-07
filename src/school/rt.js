// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Temps réel (Socket.IO, espace /rt) : messages, notifications, verrous de projet, copies.
// Le jeton est relu à chaque reconnexion ; un jeton refusé est renouvelé puis la connexion reprise.
import { io } from 'socket.io-client';
import { server, current, refresh } from './api.js';

let socket = null;
const handlers = new Map(); // événement → Set de fonctions
const status = new Set();

function attach(ev) { if (socket && !socket.hasListeners(ev)) socket.on(ev, data => (handlers.get(ev) || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } })); }
export function on(ev, fn) {
  if (!handlers.has(ev)) handlers.set(ev, new Set());
  handlers.get(ev).add(fn); attach(ev);
  return () => handlers.get(ev).delete(fn);
}
export function onStatus(fn) { status.add(fn); return () => status.delete(fn); }
export const connected = () => !!(socket && socket.connected);
export function emit(ev, data) { if (socket && socket.connected) socket.emit(ev, data); }

export function connect() {
  disconnect();
  if (!current()) return;
  socket = io(server() + '/rt', { path: '/socket.io', transports: ['websocket'], auth: cb => cb({ token: current() ? current().accessToken : '' }), reconnectionDelayMax: 10000 });
  socket.on('connect', () => status.forEach(fn => fn(true)));
  socket.on('disconnect', () => status.forEach(fn => fn(false)));
  socket.on('connect_error', async e => {
    status.forEach(fn => fn(false));
    if (/AUTH_TOKEN_INVALID|jwt|token/i.test(e.message || '')) {
      try { await refresh(); if (socket) socket.connect(); } catch (err) { /* session perdue : l'espace classe affiche la connexion */ }
    }
  });
  for (const ev of handlers.keys()) attach(ev);
}
export function disconnect() { if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; } status.forEach(fn => fn(false)); }
