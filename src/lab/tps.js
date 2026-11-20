// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Contenu des TP (src/lab/tp, src/lab/logic, src/lab/pneu, src/lab/net) : un module à part, chargé à la première ouverture de la
// bibliothèque de TP plutôt qu'au démarrage de l'application.
const byId = (a, b) => a.id.localeCompare(b.id);
export const ELEC = Object.values(import.meta.glob('./tp/*.json', { eager: true, import: 'default' })).map(t => ({ ...t, domain: 'elec' })).sort(byId);
export const PNEU = Object.values(import.meta.glob('./pneu/*.json', { eager: true, import: 'default' })).map(t => ({ ...t, domain: 'pneu' })).sort(byId);
export const LOGIC = Object.values(import.meta.glob('./logic/*.json', { eager: true, import: 'default' })).map(t => ({ ...t, domain: 'logic' })).sort(byId);
export const NET = Object.values(import.meta.glob('./net/*.json', { eager: true, import: 'default' })).map(t => ({ ...t, domain: 'net' })).sort(byId);
