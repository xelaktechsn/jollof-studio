// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Chiffres du réseau (partie wifi), fusionnés dans NET de src/net/limits.js : { CLE: { v, src } }, chaque src est une clé
// de src/check/sources.js (src/check/sources.test.mjs le vérifie). Modèle de couverture : src/net/wifi.js.
// IEEE 802.11 est payante : canaux, largeurs et seuils sont lus dans des guides publics de fabricants (Cisco, Meraki,
// TP-Link, Extreme Networks) ; l'affaiblissement de propagation dans les recommandations gratuites de l'UIT-R.
export const WIFI_LIM = {
  /** Signal visé en bordure de cellule (dBm) : -67 dBm (guide de conception Cisco, voix sur Wi-Fi). */
  WIFI_TARGET_DBM: { v: -67, src: ['ciscoVowlanEmob30', 'ciscoVowlanSurvey'] },
  /** Rapport signal/bruit visé (dB) : 25 dB pour 1 % d'erreurs de paquets. */
  WIFI_SNR_DB: { v: 25, src: ['ciscoVowlanEmob30', 'ciscoVowlanSurvey'] },
  /** Plancher de bruit supposé (dBm) : la validation Cisco demande qu'il ne dépasse pas -92 dBm. */
  WIFI_NOISE_DBM: { v: -92, src: 'ciscoVowlanSurvey' },
  /** Seuil de détection d'une trame 802.11 (préambule) : environ 4 dB au-dessus du bruit, canal de 20 MHz. */
  WIFI_SD_SNR_DB: { v: 4, src: 'extremeCca' },
  /** 2,4 GHz : canaux 1 à 13 (Europe), 1 à 11 (États-Unis), espacés de 5 MHz, larges de 22 MHz ; 1, 6 et 11 ne se chevauchent pas. */
  WIFI_CH24: { v: { eu: 13, us: 11, step: 5, width: 22, clear: [1, 6, 11] }, src: ['tplinkChannelFaq', 'merakiChannelPlanning', 'ciscoVowlanEmob30'] },
  /**
   * 5 GHz : canaux de 20 MHz (fréquence centrale = 5000 + 5 × canal, MHz), sous-bande et autorisation en Europe et aux
   * États-Unis (table TP-Link : 36–48 « Indoors » en Europe, 52–140 DFS, 144–165 interdits en Europe).
   */
  WIFI_CH5: {
    v: {
      u1: [36, 40, 44, 48], u2a: [52, 56, 60, 64], u2c: [100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144], u3: [149, 153, 157, 161, 165],
      eu: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140],
      us: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
      dfs: [52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144]
    },
    src: ['tplinkChannelFaq', 'merakiChannelPlanning', 'merakiChannelBonding']
  },
  /** 5 GHz : canaux de 20 MHz réunis en 40, 80 et 160 MHz (index HT40 38…159, VHT80 42…155, VHT160 50 et 114). */
  WIFI_BLOCKS: {
    v: {
      40: [[36, 40], [44, 48], [52, 56], [60, 64], [100, 104], [108, 112], [116, 120], [124, 128], [132, 136], [140, 144], [149, 153], [157, 161]],
      80: [[36, 48], [52, 64], [100, 112], [116, 128], [132, 144], [149, 161]],
      160: [[36, 64], [100, 128]]
    },
    src: ['tplinkChannelFaq', 'merakiChannelBonding']
  },
  /**
   * Coefficient de perte en fonction de la distance N (UIT-R P.1238) : « walls » = environ 20 (trajets en vue directe,
   * grandes salles ouvertes) avec les murs comptés un par un ; « office » et « residential » = tableau 2 de P.1238-10
   * (2,4 GHz : 30 et 28 ; 5,2 GHz : 31 et 30), qui comprend déjà les murs.
   */
  // 6 GHz : modèle général du tableau 2 de P.1238-13 (bureaux sans visibilité directe, 0,3–255 GHz, 4–30 m) : α = 2,39,
  // soit N = 10 α = 23,9 ; confirmé par des mesures à 6,75 GHz en bureaux (exposant omnidirectionnel NLOS 2,42, modèle CI à
  // 1 m). Pas de valeur pour le logement : P.1238 dit d'utiliser alors celle des bureaux.
  WIFI_N: { v: { walls: { b24: 20, b5: 20, b6: 20 }, office: { b24: 30, b5: 31, b6: 23.9 }, residential: { b24: 28, b5: 30, b6: 23.9 } }, src: ['itu1238_10', 'itu1238_13', 'nyu675'] },
  /** Perte d'un plancher entre deux étages voisins (dB, Lf de P.1238 pour n = 1) : bureaux 14 et 16, logement 10 et 13. */
  // 6 GHz : ligne 5,8 GHz du tableau 5 (bureaux, 1 étage : 22 dB), aussi pour le logement (extrapolation).
  WIFI_LF: { v: { office: { b24: 14, b5: 16, b6: 22 }, residential: { b24: 10, b5: 13, b6: 22 } }, src: 'itu1238_13' },
  /** Fréquences de référence des bandes (MHz), celles des tableaux de P.1238 : 2,4 et 5,2 GHz. */
  // 6 GHz : 6185 MHz, milieu de la bande européenne 5945–6425 MHz (fréquence de calcul choisie).
  WIFI_F: { v: { b24: 2400, b5: 5200, b6: 6185 }, src: ['itu1238_10', 'itu1238_13', 'ecc2001'] },
  /**
   * 6 GHz : canaux de 20 MHz numérotés 1 à 233 de 4 en 4 (centre = 5950 + 5 × canal, MHz ; 59 canaux de 20, 29 de 40,
   * 14 de 80, 7 de 160 MHz : blocs alignés sur le canal 1) ; Europe 5945–6425 MHz (canaux 1 à 93), États-Unis
   * 5925–7125 MHz (1 à 233) ; canaux de balayage préférés (PSC) 5, 21, 37… 229.
   */
  WIFI_CH6: { v: { eu: 93, us: 233, psc: [5, 21, 37, 53, 69, 85, 101, 117, 133, 149, 165, 181, 197, 213, 229] }, src: ['zebra6ghzChannels', 'ecc2001', 'fcc15407'] },
  /**
   * 6 GHz, point d'accès d'intérieur à faible puissance (LPI) : PIRE moyenne maximale et densité maximale (dBm/MHz).
   * Europe (ECC/DEC/(20)01) 23 dBm et 10 dBm/MHz ; États-Unis (47 CFR 15.407(a)(5)) 30 dBm et 5 dBm/MHz.
   */
  WIFI_LPI: { v: { eu: { eirp: 23, psd: 10 }, us: { eirp: 30, psd: 5 } }, src: ['ecc2001', 'fcc15407'] },
  /**
   * 6 GHz, point d'accès de puissance standard (États-Unis, 47 CFR 15.407(a)(4)) : 36 dBm de PIRE et 23 dBm/MHz, dans
   * 5925–6425 et 6525–6875 MHz seulement, et sur les seuls canaux et puissances qu'accorde un système AFC (15.407(k)) :
   * l'AFC n'est pas simulée, elle est supposée accorder tout ce que la règle permet.
   */
  WIFI_SP6: { v: { eirp: 36, psd: 23, bands: [[5925, 6425], [6525, 6875]] }, src: 'fcc15407' },
  /**
   * Matériaux (UIT-R P.2040, tableau 3) : permittivité ε' = a, conductivité σ = c·f^d (S/m, f en GHz). La perte d'une
   * paroi se calcule comme celle d'une dalle à incidence normale (équations 37a, 43b, 44, 59).
   */
  WIFI_MAT: {
    v: {
      concrete: [5.24, 0.0462, 0.7822], brick: [3.91, 0.0238, 0.16], plasterboard: [2.73, 0.0085, 0.9395], wood: [1.99, 0.0047, 1.0718],
      glass: [6.31, 0.0036, 1.3394], ceiling: [1.48, 0.0011, 1.075], chipboard: [2.58, 0.0217, 0.78], plywood: [2.71, 0.33, 0],
      marble: [7.074, 0.0055, 0.9262], metal: [1, 1e7, 0]
    },
    src: 'itu2040_4'
  },
  /**
   * Radios des points d'accès, d'après leurs fiches : puissance conduite maximale (FCC, dBm), PIRE maximale en Europe
   * (CE, dBm, par sous-bande à 5 GHz), gain d'antenne (dBi), largeurs de canal ; classe PoE (802.3af → 3, 802.3at → 4).
   */
  AP_RADIO: {
    v: {
      ap: { b24: { tx: 24, eirp: 20, gain: 4, widths: [20, 40] }, b5: { tx: 22, eirp: { u1: 23, u2a: 23, u2c: 27, u3: 0 }, gain: 5, widths: [20, 40, 80] }, poeClass: 3 },
      ap6: { b24: { tx: 25, eirp: 20, gain: 4, widths: [20, 40] }, b5: { tx: 28, eirp: { u1: 23, u2a: 23, u2c: 30, u3: 0 }, gain: 5, widths: [20, 40, 80, 160] }, poeClass: 4 },
      // Wi-Fi 6E (Ubiquiti U6 Enterprise) : PIRE européenne non donnée par la fiche (null : seule la puissance maximale et,
      // à 6 GHz, la limite réglementaire LPI sont vérifiées) ; largeurs « HE 20/40/80/160 ».
      ap6e: { b24: { tx: 22, eirp: null, gain: 3.2, widths: [20, 40] }, b5: { tx: 26, eirp: null, gain: 5.3, widths: [20, 40, 80, 160] }, b6: { tx: 26, eirp: null, gain: 6, widths: [20, 40, 80, 160] }, poeClass: 4 }
    },
    src: ['tplinkEap225Radio', 'tplinkEap670', 'ui6Enterprise', 'eaOverview8023bt']
  }
};
