// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Chiffres du réseau (partie cert), fusionnés dans NET de src/net/limits.js : { CLE: { v, src } }, chaque src est une clé
// de src/check/sources.js (src/check/sources.test.mjs le vérifie).
// Limites de certification des liens cuivre (src/net/certify.js). ANSI/TIA-568-C.2 est payante : ses tableaux de limites
// (canal et lien permanent, Cat 5e, Cat 6 et Cat 6A, aux fréquences de CERT_F) sont lus dans le guide de référence des
// normes d'Anixter, qui les recopie (anixterTia568c2, tableaux 7 à 23). Entre deux fréquences du tableau, la limite est
// INTERPOLÉE (droite en log f ; log-log pour l'affaiblissement) : approximation des équations de la norme, signalée dans
// l'interface et le rapport. Valeurs recoupées par des documents indépendants (certify.test.mjs) : tableaux TIA-568-B
// recopiés par DiMinico (canal Cat 5e et Cat 6), CommScope (affaiblissement du canal Cat 6A), Fluke (31,1 dB à 250 MHz du
// lien permanent Cat 6), TSB-155 (délais), formules du canal classe E d'IEEE 802.3an.
// Édition C.2 (2009) : l'édition 568.2-D en vigueur n'a pas pu être lue (payante).
const F = [1,4,8,10,16,20,25,31.25,62.5,100,200,250,300,400,500];
export const CERT_LIM = {
  /** Fréquences des tableaux (MHz) ; chaque série s'arrête à la fréquence maximale de sa catégorie (100, 250, 500 MHz). */
  CERT_F: { v: F, src: 'anixterTia568c2' },
  /** Limites du canal (tableaux 7 à 12) : affaiblissement maximal, NEXT, PSNEXT, ACR-F, PSACR-F, réflexion minimaux (dB). */
  CERT_CH: {
    v: { il: { cat5e: [2.2,4.5,6.3,7.1,9.1,10.2,11.4,12.9,18.6,24], cat6: [2.1,4,5.7,6.3,8,9,10.1,11.4,16.5,21.3,31.5,35.9], cat6a: [2.3,4.2,5.8,6.5,8.2,9.2,10.2,11.5,16.4,20.9,30.1,33.9,37.4,43.7,49.3] },
        next: { cat5e: [60,53.5,48.6,47,43.6,42,40.3,38.7,33.6,30.1], cat6: [65,63,58.2,56.6,53.2,51.6,50,48.4,43.4,39.9,34.8,33.1], cat6a: [65,63,58.2,56.6,53.2,51.6,50,48.4,43.4,39.9,34.8,33.1,31.7,28.7,26.1] },
        psnext: { cat5e: [57,50.5,45.6,44,40.6,39,37.3,35.7,30.6,27.1], cat6: [62,60.5,55.6,54,50.6,49,47.3,45.7,40.6,37.1,31.9,30.2], cat6a: [62,60.5,55.6,54,50.6,49,47.3,45.7,40.6,37.1,31.9,30.2,28.8,25.8,23.2] },
        acrf: { cat5e: [57.4,45.4,39.3,37.4,33.3,31.4,29.4,27.5,21.5,17.4], cat6: [63.3,51.2,45.2,43.3,39.2,37.2,35.3,33.4,27.3,23.3,17.2,15.3], cat6a: [63.3,51.2,45.2,43.3,39.2,37.2,35.3,33.4,27.3,23.3,17.2,15.3,13.7,11.2,9.3] },
        psacrf: { cat5e: [54.4,42.4,36.3,34.4,30.3,28.4,26.4,24.5,18.5,14.4], cat6: [60.3,48.2,42.2,40.3,36.2,34.2,32.3,30.4,24.3,20.3,14.2,12.3], cat6a: [60.3,48.2,42.2,40.3,36.2,34.2,32.3,30.4,24.3,20.3,14.2,12.3,10.7,8.2,6.3] },
        rl: { cat5e: [17,17,17,17,17,17,16,15.1,12.1,10], cat6: [19,19,19,19,18,17.5,17,16.5,14,12,9,8], cat6a: [19,19,19,19,18,17.5,17,16.5,14,12,9,8,7.2,6,6] } },
    src: ['anixterTia568c2', 'diminico10gbtTables', 'commscopeCat6aWp', 'ieee8023anD22']
  },
  /** Limites du lien permanent (tableaux 17 à 22). */
  CERT_PL: {
    v: { il: { cat5e: [2.1,3.9,5.5,6.2,7.9,8.9,10,11.2,16.2,21], cat6: [1.9,3.5,5,5.5,7,7.9,8.9,10,14.4,18.6,27.4,31.1], cat6a: [1.9,3.5,5,5.5,7,7.8,8.8,9.8,14,18,26.1,29.5,32.7,38.4,43.8] },
        next: { cat5e: [60,54.8,50,48.5,45.2,43.7,42.1,40.5,35.7,32.3], cat6: [65,64.1,59.4,57.8,54.6,53.1,51.5,50,45.1,41.8,36.9,35.3], cat6a: [65,64.1,59.4,57.8,54.6,53.1,51.5,50,45.1,41.8,36.9,35.3,34,29.9,26.7] },
        psnext: { cat5e: [57,51.8,47,45.5,42.2,40.7,39.1,37.5,32.7,29.3], cat6: [62,61.8,57,55.5,52.2,50.7,49.1,47.5,42.7,39.3,34.3,32.7], cat6a: [62,61.8,57,55.5,52.2,50.7,49.1,47.5,42.7,39.3,34.3,32.7,31.4,27.1,23.8] },
        acrf: { cat5e: [58.6,46.6,40.6,38.6,34.5,32.6,30.7,28.7,22.7,18.6], cat6: [64.2,52.1,46.1,44.2,40.1,38.2,36.2,34.3,28.3,24.2,18.2,16.2], cat6a: [64.2,52.1,46.1,44.2,40.1,38.2,36.2,34.3,28.3,24.2,18.2,16.2,14.6,12.1,10.2] },
        psacrf: { cat5e: [55.6,43.6,37.5,35.6,31.5,29.6,27.7,25.7,19.7,15.6], cat6: [61.2,49.1,43.1,41.2,37.1,35.2,33.2,31.3,25.3,21.2,15.2,13.2], cat6a: [61.2,49.1,43.1,41.2,37.1,35.2,33.2,31.3,25.3,21.2,15.2,13.2,11.6,9.1,7.2] },
        rl: { cat5e: [19,19,19,19,19,19,19,17.1,14.1,12], cat6: [19.1,21,21,21,20,20,19.5,18.5,16,14,11,10], cat6a: [19.1,21,21,21,20,20,19.5,18.5,16,14,11,10,9.2,8,8] } },
    src: ['anixterTia568c2', 'flukeNormalizedIL', 'tsb155D13']
  },
  /** Affaiblissement maximal du câble horizontal par 100 m (tableau 27) : base du modèle de mesure (câble × longueur). */
  CERT_CABLE_IL: { v: { cat5e: [2,4.1,5.8,6.5,8.2,9.3,10.4,11.7,17,22], cat6: [2,3.8,5.3,6,7.6,8.5,9.5,10.7,15.4,19.8,29,32.8], cat6a: [2.1,3.8,5.3,5.9,7.5,8.4,9.4,10.5,15,19.1,27.6,31.1,34.3,40.1,45.3] }, src: 'anixterTia568c2' },
  /** Affaiblissement d'une connexion : d·√f (dB), Cat 5e 0,04, Cat 6 et 6A 0,02 (modèle de mesure). */
  CERT_IL_CONN: { v: { cat5e: 0.04, cat6: 0.02, cat6a: 0.02 }, src: ['adriaenssensChannelIL', 'ieee8023anD22'] },
  /** Cordons : jusqu'à 50 % de perte de plus par mètre que le câble (modèle de mesure). */
  CERT_CORD_LOSS: { v: 1.5, src: 'adriaenssensChannelIL' },
  /** ACR-F : le couplage du câble s'améliore de −10 log(L/100) sur une longueur L (modèle de mesure). */
  CERT_ACRF_LEN: { v: 10, src: 'ieee8023anD22' },
  /** Délai de propagation maximal à 10 MHz (ns) : canal 555, lien permanent 498 (tableaux 13 et 23). */
  CERT_DELAY_NS: { v: { ch: 555, pl: 498 }, src: ['anixterTia568c2', 'tsb155D13', 'diminico10gbtTables'] },
  /** Décalage de délai maximal (ns) : canal 50, lien permanent 44. */
  CERT_SKEW_NS: { v: { ch: 50, pl: 44 }, src: ['anixterTia568c2', 'tsb155D13', 'flukePropDelay'] },
  /** Incertitude de la NVP admise sur la longueur (ANSI/TIA-1152) : 10 %. */
  CERT_NVP_TOL: { v: 0.1, src: 'flukePropDelayCase8' },
  /** Délai typique d'un câble à paires torsadées : un peu moins de 5 ns/m (modèle : 5 ns/m pour la paire la plus lente). */
  CERT_NS_PER_M: { v: 5, src: 'flukePropDelay' },
  /** Marge nominale d'un système de câblage de bonne qualité au-dessus des limites (modèle de mesure simulée) : IL en fraction, le reste en dB. */
  CERT_MARGIN: { v: { il: 0.03, next: 2, psnext: 3, acrf: 8, psacrf: 8, rl: 3 }, src: 'levitonCat6aSds' },
  /** Fréquence la plus haute de chaque catégorie (MHz). */
  CERT_FMAX: { v: { cat5e: 100, cat6: 250, cat6a: 500 }, src: ['flukeFrequencySteps', 'beldenCopperDesignGuide', 'anixterTia568c2'] }
};
