// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Chiffres du réseau (partie rack), fusionnés dans NET de src/net/limits.js : { CLE: { v, src } }, chaque src est une clé
// de src/check/sources.js (src/check/sources.test.mjs le vérifie).
// Baies 19 pouces : géométrie EIA-310 (norme payante, lue chez un fabricant), conversion W → BTU/h (NIST), baies de
// référence, et encombrement / poids / puissance de chaque type d'équipement de baie (fiches des fabricants). Chaque
// entrée de RACK_MOUNT cite sa fiche (src) ; « typ » est une consommation typique ou moyenne mesurée par le fabricant,
// « max » la consommation maximale (ou, quand la fiche ne donne qu'elle, la puissance de l'alimentation : majorant).
// Un champ à null : la fiche ne le donne pas (jamais inventé).

import { SIM_LIM } from './sim.js';

/** Fiche de chaque type venu de la partie simulation (clés de src/check/sources.js, citées par PRO_DEVICES de lim/sim.js). */
const SIM_KEYS = { switch24: 'ciscoC1000', switch48: 'ciscoC1000', l3switch: 'ciscoC1300', routerpro: 'ciscoIsr1000', server: 'dellR250', mediaconv: 'tplinkMc220l', fibrepanel: 'beldenLf15ld24b', patch24: 'beldenRv6ppf24', patch48: 'beldenRv6ppf48' };
/**
 * Encombrement des équipements de la partie simulation, d'après ses fiches (PRO_DEVICES) : u, profondeur, poids ; w, la
 * consommation sans PoE, sert de typique ; maximum estimé d'un switch PoE = w + budget PoE (pertes de l'alimentation non
 * comptées : modèle simplifié) ; serveur : puissance de l'alimentation (majorant) ; convertisseur de bureau : sur une
 * tablette (27 mm de haut, poids non donné).
 */
function fromSim() {
  const P = (SIM_LIM.PRO_DEVICES && SIM_LIM.PRO_DEVICES.v) || {}, out = {};
  for (const [t, key] of Object.entries(SIM_KEYS)) {
    const s = P[t]; if (!s) continue;
    const base = { u: s.u ?? 1, depth: s.depth ?? (s.mm ? s.mm[1] : null), kg: s.kg ?? null, ref: s.model, src: [key] };
    if (t === 'server') out[t] = { ...base, typ: null, max: s.psu ?? null };
    else if (t === 'mediaconv') out[t] = { ...base, typ: null, max: s.w ?? null, shelf: true };
    else if (s.poeBudget) out[t] = { ...base, typ: s.w, max: Math.round((s.w + s.poeBudget) * 100) / 100, poe: true };
    else out[t] = { ...base, typ: s.w ?? 0, max: s.w ?? 0 };
  }
  return out;
}

/** Pouce en millimètres (exact). */
const IN = 25.4, LB = 0.45359237;
const mm = i => Math.round(i * IN * 10) / 10, kg = l => Math.round(l * LB * 100) / 100;

export const RACK_LIM = {
  /** Hauteur d'une unité de baie (U) : 1,75 pouce = 44,45 mm ; largeur des façades 19 pouces = 482,6 mm (EIA). */
  RACK_U_MM: { v: 44.45, src: ['sanwaEia'] },
  RACK_PANEL_MM: { v: 482.6, src: ['sanwaEia'] },
  /** 1 W = 3,412 BTU/h (NIST : 1 BtuIT/h = 0,293 071 1 W). */
  BTU_PER_W: { v: 1 / 0.2930711, src: ['nistSp811B9'] },
  /**
   * Baies de référence (valeurs par défaut d'une baie neuve, modifiables) : baie au sol 42U 600 × 1000 mm (rails réglables
   * de 652,3 à 877,3 mm, charge statique 800 kg) ; coffret mural 12U (profondeur 450 mm, rails 283 à 305 mm, 50 kg).
   */
  RACK_PRESETS: {
    v: {
      floor: { kind: 'floor', u: 42, w: 600, d: 1000, depth: 652.3, depthMax: 877.3, load: 800, own: 84.2, ref: 'UniFi UACC-Rack-42U-1000-P' },
      wall: { kind: 'wall', u: 12, w: 550, d: 450, depth: 283, depthMax: 305, load: 50, own: 19, ref: 'UniFi UACC-Rack-12U-Wall-450-G' }
    },
    src: ['uiRack42u1000', 'uiRack12uWall450']
  },
  /**
   * Équipements de baie, par type : u (hauteur en U ; 0 = PDU verticale), depth (profondeur, mm), kg, typ et max (W),
   * shelf (appareil de bureau : posé sur une tablette), pdu { a, v, w, outlets }, ups { va, w, pts, ebm } (pts : points
   * [charge W, autonomie min] de la fiche, batterie interne ; ebm : avec un module de batteries), load (charge d'une
   * tablette, kg). ref : modèle réel dont viennent les chiffres (équivalent quand le type est générique).
   */
  RACK_MOUNT: {
    v: {
      // Équipements administrables, panneaux 24/48 ports, panneau fibre, convertisseur : fiches de la partie simulation
      // (PRO_DEVICES de lim/sim.js), ajoutés plus bas par fromSim.
      // Serveur NAS 10 Gb/s en baie (2U, sans disques comptés à part : 135 W de disques compris dans le maximum).
      nas: { u: 2, depth: 325, kg: 9.5, typ: null, max: 160, ref: 'UniFi UNAS Pro', src: ['uiUnasPro'] },
      // Switchs de bureau 8 ports (171 × 98 × 27 mm, posés sur une tablette) : TL-SG1008P, 11,52 W sans PoE, 73,74 W avec 64 W de PoE.
      switch: { u: 1, depth: 98, kg: null, typ: null, max: 11.52, shelf: true, ref: 'TP-Link TL-SG1008P', src: ['tplinkSg1008pDims'] },
      poeswitch: { u: 1, depth: 98, kg: null, typ: 11.52, max: 73.74, shelf: true, poe: true, ref: 'TP-Link TL-SG1008P', src: ['tplinkSg1008pDims'] },
      // Panneau de brassage 12 ports : même encombrement qu'un panneau keystone 1U (insert 63,5 mm, 260 g + barre de
      // gestion 390 g, 71,5 mm).
      patch: { u: 1, depth: 71.5, kg: 0.65, typ: 0, max: 0, ref: 'UniFi UACC-Rack-Panel-Patch-Blank-24', src: ['uiPatchBlank24'] },
      // Équipements de baie (rôle « mech », rackdev.js).
      cablemgr: { u: 1, depth: mm(3.8), kg: 0.34, typ: 0, max: 0, ref: 'Tripp Lite SRCABLERING1U', src: ['trippSrcablering1u'] },
      shelf: { u: 1, depth: mm(12.05), kg: 1.59, typ: 0, max: 0, load: 18.1, ref: 'Tripp Lite SRSHELF2P1U', src: ['trippSrshelf2p1u'] },
      blank: { u: 1, depth: 63.5, kg: 0.25, typ: 0, max: 0, ref: 'UniFi UACC-Rack-Panel-Blank-1U', src: ['uiRackPanelOcd'] },
      fan: { u: 1, depth: 314, kg: 4.9, typ: 76, max: 76, ref: 'Pulsar RAWP-1R', src: ['pulsarRawp1r'] },
      pdu: { u: 0, depth: 95, kg: 2.36, typ: 0, max: 0, pdu: { a: 16, v: 230, w: 3680, outlets: 38 }, ref: 'Tripp Lite PDUMV20HV', src: ['trippPdumv20hv'] },
      pdu1u: { u: 1, depth: 132, kg: 3.4, typ: 0, max: 0, pdu: { a: 24, v: 230, w: 5500, outlets: 20 }, ref: 'Tripp Lite PDU1230', src: ['trippPdu1230'] },
      // Onduleurs 2U Eaton 5PX G2 (208/230 V, facteur de puissance unitaire : VA = W) : autonomie à pleine charge et à
      // demi-charge, batterie interne puis avec un module de batteries (EBM).
      ups: { u: 2, depth: mm(17.6), kg: kg(49.4), typ: 0, max: 0, ups: { va: 1500, w: 1500, pts: [[1500, 5], [750, 14]], ebm: [[1500, 25], [750, 57]], outlets: 8 }, ref: 'Eaton 5PX1500HRTG2', src: ['eaton5pxG2Brochure'] },
      ups3k: { u: 2, depth: mm(23.7), kg: kg(69.9), typ: 0, max: 0, ups: { va: 3000, w: 3000, pts: [[3000, 3], [1500, 9]], ebm: [[3000, 17], [1500, 41]], outlets: 10 }, ref: 'Eaton 5PX3000HRTG2', src: ['eaton5pxG2Brochure'] },
      ebm: { u: 2, depth: mm(17.6), kg: kg(61.3), typ: 0, max: 0, ebmOf: 'ups', ref: 'Eaton 5PXEBM48RTG2', src: ['eaton5pxG2Brochure'] },
      ebm3k: { u: 2, depth: mm(23.7), kg: kg(89.1), typ: 0, max: 0, ebmOf: 'ups3k', ref: 'Eaton 5PXEBM72RTG2', src: ['eaton5pxG2Brochure'] },
      ...fromSim()
    },
    src: ['uiUnasPro', 'tplinkSg1008pDims', 'uiPatchBlank24', 'trippSrcablering1u', 'trippSrshelf2p1u', 'uiRackPanelOcd', 'pulsarRawp1r', 'trippPdumv20hv', 'trippPdu1230', 'eaton5pxG2Brochure', ...Object.values(SIM_KEYS)]
  },
  /** Obturateurs dans les U libres, passe-câbles avec les panneaux : bonnes pratiques de refroidissement et de brassage. */
  RACK_PRACTICE: { v: { blanking: true, cableManagers: true }, src: ['trippCoolingWp'] }
};
