// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Équipements de baie sans rôle réseau (passe-câbles, tablettes, obturateurs, PDU, onduleurs…), fusionnés dans DEVICES
// de devices.js (rôle 'mech' : aucun port, pas de nœud dans le schéma logique, posés dans la vue Baies). Leur
// encombrement, leur poids et leur puissance viennent des fiches des fabricants : RACK_MOUNT de src/net/lim/rack.js.
import { tl, isEn } from '../i18n/index.js';

/** Équipement de baie ; prefix [fr, en] : début des noms donnés aux nouveaux (OBT1 en français, BLK1 en anglais). */
const mech = (icon, prefix, name, doc) => ({ role: 'mech', icon, w: 120, h: 30, name, get prefix() { return isEn ? prefix[1] : prefix[0]; }, doc, ports: () => [], props: () => ({}), clean: (s, d) => d });

export const RACK_DEVICES = {
  cablemgr: mech('cableMgr', ['PASS', 'CM'], () => tl('Passe-câbles 1U'), () => tl('Guide-câbles horizontal 1U à anneaux : range les cordons entre un panneau de brassage et le switch (Tripp Lite SRCABLERING1U, 0,34 kg).')),
  shelf: mech('rackShelf', ['TAB', 'SHF'], () => tl('Tablette 1U'), () => tl('Tablette fixe 1U en porte-à-faux, 305 mm de profondeur, 18,1 kg au plus (Tripp Lite SRSHELF2P1U) : pour poser un appareil de bureau (box, petit switch, convertisseur).')),
  blank: mech('blankPanel', ['OBT', 'BLK'], () => tl('Obturateur 1U'), () => tl('Panneau plein 1U : bouche un U libre en façade pour que l’air chaud de l’arrière ne revienne pas vers l’avant (UniFi UACC-Rack-Panel-Blank-1U, 250 g).')),
  fan: mech('rackFan', ['VENT', 'FAN'], () => tl('Ventilation 1U'), () => tl('Panneau de 4 ventilateurs 1U avec thermostat, 230 V, 76 W (Pulsar RAWP-1R).')),
  pdu: mech('pdu', ['PDU', 'PDU'], () => tl('PDU verticale 16 A'), () => tl('Barre de distribution verticale (0U) monophasée 230 V 16 A, 3,68 kW, 38 prises (32 C13, 6 C19) (Tripp Lite PDUMV20HV). Ne prend aucun U : elle se fixe sur le côté de la baie.')),
  pdu1u: mech('pdu', ['PDU', 'PDU'], () => tl('PDU 1U'), () => tl('Barre de distribution horizontale 1U, 200-240 V, 20 prises (16 C13, 4 C19), 5,5 kW à 230 V (Tripp Lite PDU1230).')),
  ups: mech('ups', ['OND', 'UPS'], () => tl('Onduleur 1500 VA (2U)'), () => tl('Onduleur en baie 2U, 1500 VA / 1500 W, 230 V : 5 min d’autonomie à pleine charge, 14 min à demi-charge (Eaton 5PX1500HRTG2).')),
  ups3k: mech('ups', ['OND', 'UPS'], () => tl('Onduleur 3000 VA (2U)'), () => tl('Onduleur en baie 2U, 3000 VA / 3000 W, 230 V : 3 min d’autonomie à pleine charge, 9 min à demi-charge (Eaton 5PX3000HRTG2).')),
  ebm: mech('battery', ['BAT', 'BAT'], () => tl('Batteries pour onduleur 1500 VA'), () => tl('Module de batteries 2U pour l’onduleur 1500 VA : 25 min à pleine charge, 57 min à demi-charge (Eaton 5PXEBM48RTG2).')),
  ebm3k: mech('battery', ['BAT', 'BAT'], () => tl('Batteries pour onduleur 3000 VA'), () => tl('Module de batteries 2U pour l’onduleur 3000 VA : 17 min à pleine charge, 41 min à demi-charge (Eaton 5PXEBM72RTG2).'))
};
/** Groupes de la bibliothèque : [[() => titre, [types]]]. */
export const RACK_GROUPS = [
  [() => tl('Accessoires de baie'), ['cablemgr', 'shelf', 'blank', 'fan']],
  [() => tl('Énergie de la baie'), ['pdu', 'pdu1u', 'ups', 'ups3k', 'ebm', 'ebm3k']]
];
