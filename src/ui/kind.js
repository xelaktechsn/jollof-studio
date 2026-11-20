// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Type de projet : électronique, analogique, pneumatique, électropneumatique, logique, réseau ou objets connectés. Il dit
// quels plans de travail le projet montre (un seul, sauf les types combinés : l'électropneumatique réunit le montage et
// le circuit pneumatique, les objets connectés le montage et le plan réseau) et se choisit
// à la création d'un projet. Il est enregistré avec le projet (settings.kind) ; un projet plus ancien le reçoit
// d'après son contenu (inferKind). Sans interface (tests) : le bouton et le choix à la création sont dans kindui.js.
import { tl, isEn } from '../i18n/index.js';

/** Types de projet : plans de travail montrés (le premier s'affiche à l'ouverture). */
/** Plan de travail combiné à un autre (le montage électronique) : sa place quand il s'élargit. */
export const WIDEN = { pneu: 'epneu', net: 'iot' };
export const KINDS = {
  elec: { icon: 'cpu', spaces: ['elec'], name: () => tl('Électronique'), text: () => tl('Une carte (Arduino, ESP32, Pico), des capteurs, des écrans, des moteurs : on câble, on programme, on simule.') },
  analog: { icon: 'activity', spaces: ['elec'], name: () => tl('Analogique'), text: () => tl('Sans carte ni programme : résistances, condensateurs, transistors, NE555, ampli-op, générateur de fonctions et oscilloscope.') },
  pneu: { icon: 'pneu', spaces: ['pneu'], name: () => tl('Pneumatique'), text: () => tl('L’air comprimé seul : distributeurs, vérins, fins de course à galet, GRAFCET ou automate en Ladder. Aucun montage électronique.') },
  epneu: { icon: 'split', spaces: ['elec', 'pneu'], name: () => tl('Électropneumatique'), text: () => tl('Une carte commande une machine pneumatique : électrovannes 24 V, capteurs de vérin, les deux plans de travail côte à côte.') },
  logic: { icon: 'logic', spaces: ['logic'], name: () => (isEn ? 'Logic' : 'Logique'), text: () => tl('Portes, bascules, compteurs : tables de vérité, chronogrammes, équations.') },
  net: { icon: 'network', spaces: ['net'], name: () => tl('Réseau'), text: () => tl('PC, switchs, box, Wi-Fi : on sertit les câbles RJ45, on les teste, on adresse et on fait des ping.') },
  iot: { icon: 'iot', spaces: ['elec', 'net'], name: () => tl('Objets connectés'), text: () => tl('Une carte et son module Ethernet ou son Wi-Fi sur un vrai réseau : page web, MQTT, Modbus TCP, les deux plans de travail.') }
};
export const KIND_IDS = Object.keys(KINDS);
export const spacesOf = k => (KINDS[k] || KINDS.elec).spaces;
/**
 * Le projet a une carte programmable : onglet Code, côte à côte, moniteur série, téléversement, débogueur. Analogique
 * (sans carte), logique et pneumatique seule n'en ont pas : l'interface ne montre pas ce qu'ils ne peuvent pas utiliser.
 */
export const hasProgram = k => k === 'elec' || k === 'epneu' || k === 'iot' || !KINDS[k];
/** Type d'un projet enregistré : celui qu'il déclare, sinon d'après son contenu (projets d'avant les types). */
export function inferKind(data) {
  const set = (data && data.settings) || {};
  if (KINDS[set.kind]) return set.kind;
  const mods = set.modules || {}, n = o => (o && o.circuit && Array.isArray(o.circuit.elements) ? o.circuit.elements.length : 0);
  const comps = ((data && data.comps) || []).length, pneu = n(mods.pneu), logic = n(mods.logic);
  const net = mods.net && Array.isArray(mods.net.devices) ? mods.net.devices.length : 0;
  if (net) return comps ? 'iot' : 'net';
  if (pneu) return comps ? 'epneu' : 'pneu';
  if (logic && !comps) return 'logic';
  return 'elec';
}
