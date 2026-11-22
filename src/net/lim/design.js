// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Chiffres du réseau (partie design), fusionnés dans NET de src/net/limits.js : { CLE: { v, src } }, chaque src est une clé
// de src/check/sources.js (src/check/sources.test.mjs le vérifie).
// TIA-568 et TIA-569 sont payantes : la densité des postes de travail est lue dans deux guides publics qui les appliquent
// (guide de câblage du gouvernement de la Nouvelle-Écosse, guide de conception de l'université du Michigan) ; le touret de 305 m dans une fiche
// de câble Leviton ; la surréservation dans le guide de conception de campus de Cisco.
export const DESIGN_LIM = {
  /** Un poste de travail pour 10 m² de surface utile (TIA-569) ; deux prises au moins par poste (TIA-568). */
  WA_AREA_M2: { v: 10, src: ['nsTpwCabling', 'umichDg272000'] },
  WA_OUTLETS: { v: 2, src: 'nsTpwCabling' },
  /** Panneaux de brassage de 48 ports au plus (2 U au plus) dans un local technique (guide de la Nouvelle-Écosse). */
  PANEL_MAX_PORTS: { v: 48, src: 'nsTpwCabling' },
  /** Câble cuivre livré en tourets de 1000 ft (305 m). */
  CABLE_BOX_M: { v: 305, src: 'levitonUtp6r' },
  /** Surréservation visée : 20:1 entre accès et distribution, 4:1 entre distribution et cœur (Cisco). */
  OVERSUB_ACCESS: { v: 20, src: 'ciscoCampusBp' },
  OVERSUB_CORE: { v: 4, src: 'ciscoCampusBp' },
  /** Marge pour l'avenir : 20 % de capacité de câble en réserve (guide de l'université du Michigan) ; la réserve de ports
   *  par défaut la reprend (valeur de conception modifiable). */
  DESIGN_SPARE_GROWTH: { v: 20, src: 'umichDg272000' },
  /** Calques AIA / NCS (convention publique qui les reprend) : discipline T, groupes JACK, EQPM, CABL, CABL-FIBR, CABL-TRAY, DATA ; A-AREA, A-WALL. */
  DXF_NCS_LAYERS: { v: { jack: 'T-JACK', equipment: 'T-EQPM', cable: 'T-CABL', fibre: 'T-CABL-FIBR', tray: 'T-CABL-TRAY', data: 'T-DATA', area: 'A-AREA', wall: 'A-WALL' }, src: 'moFmdcCad' },
  /** ISO 13567 : longueur des champs obligatoires d'un nom de calque (agent responsable, élément, présentation). */
  ISO13567_FIELDS: { v: { agent: 2, element: 6, presentation: 2 }, src: 'iso13567Wiki' },
  /** Classeur .xlsx (ECMA-376 partie 1, § 18.17.4.1) : jour 0 du système 1900 et écart en jours avec le système 1904
   *  (1er janvier 1904 = 0, soit 1462 jours plus tard). */
  XLSX_DATE_SYSTEM: { v: { base1900: '1899-12-30', offset1904: 1462 }, src: 'ecma376Part1' },
  /** Formats de nombre intégrés de date et d'heure (§ 18.8.30) ; formats propres numérotés à partir de 164. */
  XLSX_NUMFMT: { v: { dateIds: [[14, 22], [45, 47]], customFrom: 164 }, src: 'ecma376Part1' }
};
