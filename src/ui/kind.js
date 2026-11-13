// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Type de projet : électronique, analogique, pneumatique, électropneumatique ou logique. Il dit quels plans de travail
// le projet montre (un seul, sauf l'électropneumatique qui réunit le montage et le circuit pneumatique) et se choisit
// à la création d'un projet. Il est enregistré avec le projet (settings.kind) ; un projet plus ancien le reçoit
// d'après son contenu (inferKind). Sans interface (tests) : le bouton et le choix à la création sont dans kindui.js.
import { tl, isEn } from '../i18n/index.js';

/** Types de projet : plans de travail montrés (le premier s'affiche à l'ouverture). */
export const KINDS = {
  elec: { icon: 'cpu', spaces: ['elec'], name: () => tl('Électronique'), text: () => tl('Une carte (Arduino, ESP32, Pico), des capteurs, des écrans, des moteurs : on câble, on programme, on simule.') },
  analog: { icon: 'activity', spaces: ['elec'], name: () => tl('Analogique'), text: () => tl('Sans carte ni programme : résistances, condensateurs, transistors, NE555, ampli-op, générateur de fonctions et oscilloscope.') },
  pneu: { icon: 'pneu', spaces: ['pneu'], name: () => tl('Pneumatique'), text: () => tl('L’air comprimé seul : distributeurs, vérins, fins de course à galet, GRAFCET. Aucun montage électronique.') },
  epneu: { icon: 'split', spaces: ['elec', 'pneu'], name: () => tl('Électropneumatique'), text: () => tl('Une carte commande une machine pneumatique : électrovannes 24 V, capteurs de vérin, les deux plans de travail côte à côte.') },
  logic: { icon: 'logic', spaces: ['logic'], name: () => (isEn ? 'Logic' : 'Logique'), text: () => tl('Portes, bascules, compteurs : tables de vérité, chronogrammes, équations.') }
};
export const KIND_IDS = Object.keys(KINDS);
export const spacesOf = k => (KINDS[k] || KINDS.elec).spaces;

/** Type d'un projet enregistré : celui qu'il déclare, sinon d'après son contenu (projets d'avant les types). */
export function inferKind(data) {
  const set = (data && data.settings) || {};
  if (KINDS[set.kind]) return set.kind;
  const mods = set.modules || {}, n = o => (o && o.circuit && Array.isArray(o.circuit.elements) ? o.circuit.elements.length : 0);
  const comps = ((data && data.comps) || []).length, pneu = n(mods.pneu), logic = n(mods.logic);
  if (pneu) return comps ? 'epneu' : 'pneu';
  if (logic && !comps) return 'logic';
  return 'elec';
}
