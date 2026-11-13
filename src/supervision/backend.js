// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Supervision : appels au cœur Rust (caisse jollof-supervision, bâtie sur maisa-core). Dans l'application, la
// commande Tauri « supervision ». En développement dans un navigateur, un pont HTTP local facultatif
// (cargo run --example bridge, adresse dans localStorage « jollof-supervision-bridge ») sert le même code Rust.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../native.js';

const bridge = () => { if (!import.meta.env.DEV) return null; try { return localStorage.getItem('jollof-supervision-bridge'); } catch (e) { return null; } };
/** La supervision est-elle disponible ici ? */
export const available = () => isTauri() || !!bridge();
/** Exécute une commande ; rejette avec le texte de l'erreur. */
export async function call(cmd, args = {}) {
  if (isTauri()) return invoke('supervision', { cmd, args });
  const url = bridge(); if (!url) throw new Error('supervision unavailable');
  const r = await (await fetch(`${url}/${cmd}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json();
  if (r.error) throw new Error(r.error);
  return r.ok;
}
