// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Chiffres du réseau informatique, chacun avec sa source (clé de src/check/sources.js, comme limits.js pour le
// montage). Les normes ANSI/TIA-568 et ISO/IEC 11801 sont payantes : leurs chiffres sont lus dans les guides des
// fabricants qui les citent (Belden, Fluke Networks) ; IEEE 802.3 par les documents publics du groupe de travail et
// les livres blancs de l'Ethernet Alliance. src/check/sources.test.mjs exige une source pour chaque nombre.

export const NET = {
  /** Canal horizontal : 100 m au plus, dont 90 m de lien permanent et 10 m de cordons (TIA-568, cité par Belden). */
  CHANNEL_M: { v: 100, src: ['beldenCopperDesignGuide', 'flukeBeyond100m', 'cisco10100Cables'] },
  PERMANENT_M: { v: 90, src: ['beldenCopperDesignGuide', 'flukeBeyond100m'] },
  CORDS_M: { v: 10, src: 'beldenCopperDesignGuide' },
  /** 10GBASE-T sur Cat 6 : sûr jusqu'à 37 m, 37 à 55 m selon la diaphonie exogène, au-delà il faut du Cat 6A (TSB-155). */
  CAT6_10G_SURE_M: { v: 37, src: ['fluke10gbaseT', 'beldenCopperDesignGuide'] },
  CAT6_10G_MAX_M: { v: 55, src: ['fluke10gbaseT', 'beldenCopperDesignGuide'] },
  /** Bande passante des catégories (MHz). */
  CAT_MHZ: { v: { cat5e: 100, cat6: 250, cat6a: 500 }, src: ['flukeFrequencySteps', 'beldenCopperDesignGuide'] },
  /**
   * Catégorie minimale pour chaque vitesse (rang 1 = Cat 5e, 2 = Cat 6, 3 = Cat 6A) : 10BASE-T et 100BASE-TX passent
   * sur Cat 5 (donc 5e), 1000BASE-T sur Cat 5e à 100 m, 10GBASE-T demande du Cat 6A pour 100 m.
   */
  SPEED_CAT: { v: { 10: 1, 100: 1, 1000: 1, 10000: 3 }, src: ['cisco10100Cables', 'ciscoCat2960Cabling', 'beldenCopperDesignGuide', 'fluke10gbaseT'] },
  /** PoE : puissance réservée par le PSE pour chaque classe (W), classes 0 à 8 (la classe 0 vaut la classe 3). */
  POE_PSE_W: { v: [15.4, 4, 7, 15.4, 30, 45, 60, 75, 90], src: 'eaOverview8023bt' },
  /** PoE : puissance garantie au PD (W). */
  POE_PD_W: { v: [12.95, 3.84, 6.49, 12.95, 25.5, 40, 51, 62, 71.3], src: ['eaOverview8023bt', 'tiTps23755Class'] },
  /** Classe la plus haute que chaque type de PSE alimente : type 1 (802.3af) 3, type 2 (802.3at) 4, type 3 6, type 4 8. */
  POE_TYPE_MAXCLASS: { v: { af: 3, at: 4, bt3: 6, bt4: 8 }, src: 'eaOverview8023bt' },
  /** Réglages d'usine des appareils PoE du plan (devices.js), lus dans leurs fiches : classe, puissance maximale (W), budget. */
  POE_DEVICES: { v: { camera: { cls: 3, maxW: 12.95 }, phone: { cls: 1, maxW: 3.84 }, ap: { maxW: 12.6 }, poeswitch: { ports: 4, portW: 30, budget: 64 } }, src: ['axisM2035le', 'cisco7800DataSheet', 'tplinkEap225', 'tplinkSg1008p'] },
  /** Numéros des paires d'un câble (couleurs) ; mélanger T568A et T568B croise les paires 2 et 3 (carte de câblage). */
  PAIR_COLORS: { v: { 1: 'blue', 2: 'orange', 3: 'green', 4: 'brown' }, src: ['foaUtpColorCodes', 'flukeMicroScannerFaults', 'flukeT568AvsB'] },
  /** Auto-MDIX : facultatif en 10BASE-T, 100BASE-TX et 1000BASE-T, obligatoire en 10GBASE-T. */
  MDIX_REQUIRED: { v: { 10: false, 100: false, 1000: false, 10000: true }, src: ['ieeeMaint1115', 'ieeeMaint1183', 'unhIolFeTestPlans'] },
  /** Ports des services : DHCP (serveur 67, client 68), MQTT 1883, Modbus TCP 502. */
  PORTS: { v: { dhcpServer: 67, dhcpClient: 68, mqtt: 1883, modbus: 502 }, src: ['rfc2131', 'mqtt311', 'modbusTcpGuide'] }
};
export const v = k => NET[k].v;
