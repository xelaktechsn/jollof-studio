// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Chiffres du réseau (partie fibre), fusionnés dans NET de src/net/limits.js : { CLE: { v, src } }, chaque src est une clé
// de src/check/sources.js (src/check/sources.test.mjs le vérifie).
// TIA-568.3-D, ISO/IEC 11801 et IEEE 802.3 sont payantes : leurs chiffres sont lus dans les guides publics qui les citent
// (FOA, Fluke Networks, Corning) ; les modules optiques dans les fiches techniques des modules Cisco (émission, réception,
// portées par type de fibre).
//
// Modules (FIBRE_MOD_*) : { speed (Mb/s), media 'mmf'|'smf'|'copper', nm (longueur d'onde), form 'sfp'|'sfp+'|'sfp28' (format),
//   reach { type de fibre | 'copper': m }, chan? { type: dB } (perte maximale du canal, IEEE 802.3 lue via FOA / Fluke),
//   tx? [min, max] et rx? [sensibilité, surcharge] (dBm, fiche du module), mcp? (cordon de conditionnement de mode exigé
//   sur multimode) }. Le bilan de puissance d'un module est tx[0] - rx[0].
export const FIBRE_LIM = {
  /** Affaiblissement maximal du câble (dB/km) par type et longueur d'onde (850/1300 nm multimode, 1310/1550 nm monomode). */
  FIBRE_ATT_MM: {
    v: { om1: { 850: 3.5, 1300: 1.5 }, om2: { 850: 3.5, 1300: 1.5 }, om3: { 850: 3.0, 1300: 1.5 }, om4: { 850: 3.0, 1300: 1.5 }, om5: { 850: 3.0, 1300: 1.5 } },
    src: ['flukeOmOsFiber']
  },
  /** OS1 : câble intérieur (TIA, intérieur 1,0 dB/km) ; OS2 : câble G.652.D (0,4 dB/km à 1310 nm, 0,3 à 1550 nm). */
  FIBRE_ATT_SM: { v: { os1: { 1310: 1.0, 1550: 1.0 }, os2: { 1310: 0.4, 1550: 0.3 } }, src: ['foaSmfTypes', 'flukeOmOsFiber'] },
  /** Perte d'une connexion (paire de connecteurs accouplés) : 0,75 dB au plus (TIA-568). */
  FIBRE_CONN_DB: { v: 0.75, src: ['foaLossBudget', 'corningTugOfWar'] },
  /** Perte d'une épissure : 0,3 dB au plus (TIA-568). */
  FIBRE_SPLICE_DB: { v: 0.3, src: ['foaLossBudget'] },
  /** Marge conseillée entre le bilan de puissance et la perte de la liaison : environ 3 dB (vieillissement). */
  FIBRE_MARGIN_DB: { v: 3, src: ['foaLossBudget'] },
  FIBRE_MOD_1000SX: {
    v: { speed: 1000, media: 'mmf', nm: 850, form: 'sfp', reach: { om1: 275, om2: 550, om3: 800, om4: 880, om5: 880 }, chan: { om1: 2.6, om2: 3.6, om3: 4.5, om4: 4.8, om5: 4.8 }, tx: [-9.5, -3], rx: [-17, 0] },
    src: ['foaLinkspec', 'flukeOmOsFiber', 'cisco1gSfp']
  },
  FIBRE_MOD_1000LX: {
    v: { speed: 1000, media: 'smf', nm: 1310, form: 'sfp', reach: { os1: 10000, os2: 10000, om1: 550, om2: 550, om3: 550, om4: 550, om5: 550 }, chan: { om1: 2.3, om2: 2.3, om3: 2.3, om4: 2.3, om5: 2.3 }, tx: [-9.5, -3], rx: [-20, -3], mcp: true },
    src: ['cisco1gSfp', 'foaLinkspec', 'ciscoMcpBulletin', 'flukeOmOsFiber']
  },
  FIBRE_MOD_1000EX: { v: { speed: 1000, media: 'smf', nm: 1310, form: 'sfp', reach: { os1: 40000, os2: 40000 }, tx: [-1, 3], rx: [-22, 1] }, src: ['cisco1gSfp'] },
  FIBRE_MOD_1000ZX: { v: { speed: 1000, media: 'smf', nm: 1550, form: 'sfp', reach: { os1: 70000, os2: 70000 }, tx: [0, 5], rx: [-23, -3] }, src: ['cisco1gSfp'] },
  FIBRE_MOD_1000T: { v: { speed: 1000, media: 'copper', nm: 0, form: 'sfp', reach: { copper: 100 } }, src: ['cisco1gSfp'] },
  FIBRE_MOD_10GSR: {
    v: { speed: 10000, media: 'mmf', nm: 850, form: 'sfp+', reach: { om1: 33, om2: 82, om3: 300, om4: 400, om5: 400 }, chan: { om1: 2.4, om2: 2.3, om3: 2.6, om4: 2.9, om5: 2.9 }, tx: [-7.3, -1.2], rx: [-9.9, -1.0] },
    src: ['flukeOmOsFiber', 'cisco10gSfpPlus', 'corningTugOfWar']
  },
  FIBRE_MOD_10GLR: { v: { speed: 10000, media: 'smf', nm: 1310, form: 'sfp+', reach: { os1: 10000, os2: 10000 }, chan: { os1: 6.2, os2: 6.2 }, tx: [-8.2, 0.5], rx: [-14.4, 0.5] }, src: ['foaLinkspec', 'cisco10gSfpPlus'] },
  FIBRE_MOD_10GER: { v: { speed: 10000, media: 'smf', nm: 1550, form: 'sfp+', reach: { os1: 40000, os2: 40000 }, chan: { os1: 11.0, os2: 11.0 }, tx: [-4.7, 4.0], rx: [-15.8, -1] }, src: ['foaLinkspec', 'cisco10gSfpPlus'] },
  FIBRE_MOD_10GZR: { v: { speed: 10000, media: 'smf', nm: 1550, form: 'sfp+', reach: { os1: 80000, os2: 80000 }, tx: [0, 4.0], rx: [-24, -7] }, src: ['cisco10gSfpPlus'] },
  FIBRE_MOD_10GT: { v: { speed: 10000, media: 'copper', nm: 0, form: 'sfp+', reach: { copper: 30 } }, src: ['cisco10gSfpPlus'] },
  FIBRE_MOD_25GSR: { v: { speed: 25000, media: 'mmf', nm: 850, form: 'sfp28', reach: { om3: 70, om4: 100, om5: 100 }, tx: [-8.4, 2.4], rx: [-10.3, 2.4] }, src: ['cisco25gSfp28'] },
  FIBRE_MOD_25GLR: { v: { speed: 25000, media: 'smf', nm: 1310, form: 'sfp28', reach: { os1: 10000, os2: 10000 }, tx: [-7.0, 2.0], rx: [-13.3, 2.0] }, src: ['cisco25gSfp28'] },
  /** Format accepté par chaque cage : un module 1G (SFP) marche dans une cage 10G (SFP+), un module 10G pas dans une cage 1G. */
  FIBRE_CAGE: { v: { sfp: ['sfp'], 'sfp+': ['sfp', 'sfp+'] }, src: ['cisco1gSfp', 'cisco10gSfpPlus'] }
};
