// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Chiffres du réseau (partie plan), fusionnés dans NET de src/net/limits.js : { CLE: { v, src } }, chaque src est une clé
// de src/check/sources.js (src/check/sources.test.mjs le vérifie). TIA-569, TIA-568, EN 50174-2 et le NEC sont payants :
// leurs chiffres sont lus dans des cahiers des charges publics (UFC/UFGS du département de la Défense américain,
// universités) et des guides de fabricants qui les citent.
export const PLAN_LIM = {
  /** Remplissage maximal d'un conduit selon le nombre de câbles : 1 câble 53 %, 2 câbles 31 %, 3 et plus 40 % (NEC). */
  CONDUIT_FILL: { v: { 1: 0.53, 2: 0.31, 3: 0.4 }, src: ['servicewireConduitFill', 'umichDG272000', 'ufc358001'] },
  /** Remplissage maximal d'un chemin de câbles (tablette, dalle, goulotte) : 50 % de la section. */
  TRAY_FILL: { v: 0.5, src: ['ufc358001', 'umichDG272000'] },
  /** Hauteur de câbles au plus dans un chemin de câbles (mm). */
  TRAY_DEPTH_MM: { v: 150, src: ['ufc358001', 'montanaPathways'] },
  /** Crochets (J-hooks) : 20 câbles au plus par support, supports tous les 1,2 à 1,5 m. */
  JHOOK_CABLES: { v: 20, src: ['ufgs271000', 'ufc358001'] },
  /** Conduit : 30 m au plus et l'équivalent de deux coudes à 90° (180°) entre deux boîtes de tirage. */
  CONDUIT_RUN_M: { v: 30, src: ['ufgs271000', 'uhPathways'] },
  CONDUIT_BEND_DEG: { v: 180, src: ['ufgs271000', 'uhPathways'] },
  /** Rayon de courbure d'un conduit : 6 × son diamètre intérieur sous 2 pouces (50,8 mm), 10 × au-delà. */
  CONDUIT_RADIUS: { v: { small: 6, large: 10, limMm: 50.8 }, src: ['uhPathways', 'montanaPathways'] },
  /** Rayon de courbure d'un câble posé : 4 × son diamètre (paires torsadées), 10 × (fibre, au repos). */
  CABLE_RADIUS: { v: { copper: 4, fibre: 10 }, src: ['ufgs271000', 'foaBendRadius'] },
  /**
   * Diamètres extérieurs des câbles (mm), d'après des fiches de fabricants : Cat 5e Belden 1583A, Cat 6 Belden 2412,
   * Cat 6A Belden 10GXS12 (U/UTP), fibre Corning MIC 12 fibres à structure serrée. Servent au calcul du remplissage.
   */
  CABLE_OD_MM: { v: { cat5e: 4.83, cat6: 5.69, cat6a: 6.99, fibre: 6 }, src: ['belden1583A', 'belden2412', 'belden10GXS12', 'corningMic12'] },
  /**
   * Séparation données / énergie (EN 50174-2:2018, cité par DTECH) : distance S (mm) par classe de ségrégation du câble
   * de données et par cheminement (sans, métallique ouvert, perforé, plein), multipliée par le facteur P du nombre de
   * circuits 230 V 20 A. Le câble U/UTP courant est de classe b, l'écranté de classe c.
   */
  SEGREGATION_MM: { v: { a: [300, 225, 150, 0], b: [100, 75, 50, 0], c: [50, 38, 25, 0], d: [10, 8, 5, 0] }, src: ['dtechEn50174', 'commscopePowerSep'] },
  POWER_FACTOR: { v: [[3, 0.2], [6, 0.4], [9, 0.6], [12, 0.8], [15, 1], [30, 2], [45, 3], [60, 4], [75, 5], [Infinity, 6]], src: ['dtechEn50174', 'commscopePowerSep'] },
  /** Mou de service : 3 m au local technique, 0,3 m au poste de travail (réglages par défaut, modifiables). */
  SLACK_TR_M: { v: 3, src: ['ufgs271000'] },
  SLACK_WA_M: { v: 0.3, src: ['ufgs271000'] },
  /** Un local technique par étage au moins ; un de plus par 929 m² (10 000 pi²) de surface desservie. */
  TR_AREA_M2: { v: 929, src: ['umichDG54', 'ufc358001'] },
  /** Distance de câble du local technique à la prise la plus lointaine : 90 m (295 pieds). */
  TR_REACH_M: { v: 90, src: ['umichDG54', 'ufc358001'] }
};
