// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Noms de calques des exports DXF, sous forme de données : trois schémas au choix (AIA/NCS, ISO 13567, Jollof), chaque
// calque avec sa couleur, son type de ligne et son épaisseur. Utilisé par dxfexport.js (design) avec cad/dxfwrite.js.
//
// Sources lues (publiques) :
// - AIA CAD Layer Guidelines / US National CAD Standard (NCS), format décrit par « The AIA CAD Layer Format »
//   (https://blog.draftsperson.net/the-aia-cad-layer-format) : champs séparés par des tirets, désignation de discipline
//   sur 2 caractères (le 2e est un tiret ou un modificateur), groupe majeur de 4 caractères (obligatoire), groupe
//   mineur de 4 caractères (facultatif), 2e groupe mineur (format long), statut d'un caractère toujours en dernier ;
//   disciplines A architecture, E électricité, G général, T télécommunications… Exemples cités tels quels :
//   A-WALL, A-DOOR-SWNG, *-ANNO-TEXT (textes), *-ANNO-TTLB (cadre et cartouche), S-BEAM-DIMS, E-POWR-PANL,
//   T-COMM-JACK. La liste officielle (NCS v5/v6) est payante ; les noms retenus viennent d'une convention publique qui
//   la suit : State of Missouri, OA-FMDC, « Computer Aided Design Guidelines and Drawing Submittals » (rév. 09/2012,
//   https://oa.mo.gov/sites/default/files/CAD_Guidelines.pdf, « FMDC follows AIA CAD Layering Guidelines ») — p. 7
//   (modificateurs communs) « *-TEXT Text », « *-DIMS Dimensions », « *-NPLT Construction lines, non-plotting
//   information », « *-SHBD-TTLB Project Title block », « *-****-EQPM Miscellaneous equipment » ; p. 8-10 « A-AREA
//   Area Calculation », « A-WALL Walls », « A-DOOR Doors », « E-POWR Power » ; p. 21 (Communication) « T-EQPM
//   Equipment », « T-JACK Jacks », « T-CABL Cable system », « T-CABL-FIBR Cable system: fiber optic cable »,
//   « T-CABL-TRAY Cable system: cable tray and wireway », « T-DATA Data / LAN system ». Un nom marqué `built: true`
//   est composé de ces éléments (pas lu tel quel) ; tout reste modifiable (overrides) pour suivre la charte du client.
// - ISO 13567-2 (structure des noms de calques), d'après l'article public « ISO 13567 »
//   (https://en.wikipedia.org/wiki/ISO_13567, norme elle-même payante) : champs de longueur fixe — agent responsable
//   (2), élément (6, codes d'une classification : CI/SfB, Uniclass…), présentation (2 : E graphisme de l'élément,
//   T texte, D cotes, H hachures, B bordure (espace papier), V textes/cartouche (papier), I tableaux), puis
//   facultatifs dont le statut (1 : N neuf, E existant conservé, R à déposer, T temporaire) ; « _ » pour un champ non
//   renseigné, « - » pour « sans subdivision ». Les codes d'élément ci-dessous sont des mnémoniques de 6 lettres
//   (modèle simplifié) à remplacer par les codes de la classification du projet.
// Couleurs, types de ligne et épaisseurs (centièmes de mm, code 370) : valeurs par défaut de l'application, modifiables.

/** Rôles des calques exportés (clés stables pour dxfexport.js). */
export const LAYER_KEYS = ['rooms', 'walls', 'doors', 'pathways', 'cables', 'fibre', 'racks', 'devices', 'outlets', 'aps', 'power',
  'labels', 'dims', 'titles', 'sheet', 'viewport'];

// Apparence par rôle (indépendante du schéma)
const LOOK = {
  rooms: { color: '#94a3b8', ltype: 'Continuous', lw: 18, desc: 'Pièces (contours et noms)' },
  walls: { color: '#64748b', ltype: 'Continuous', lw: 35, desc: 'Murs' },
  doors: { color: '#94a3b8', ltype: 'Continuous', lw: 18, desc: 'Portes' },
  pathways: { color: '#f59e0b', ltype: 'DASHED', lw: 25, desc: 'Cheminements (chemins de câbles, goulottes, conduits)' },
  cables: { color: '#3b82f6', ltype: 'Continuous', lw: 25, desc: 'Câbles cuivre (tracés)' },
  fibre: { color: '#a855f7', ltype: 'Continuous', lw: 25, desc: 'Câbles fibre (tracés)' },
  racks: { color: '#1e3a8a', ltype: 'Continuous', lw: 35, desc: 'Baies et armoires' },
  devices: { color: '#0ea5e9', ltype: 'Continuous', lw: 25, desc: 'Équipements actifs' },
  outlets: { color: '#2563eb', ltype: 'Continuous', lw: 25, desc: 'Prises (RJ45)' },
  aps: { color: '#16a34a', ltype: 'Continuous', lw: 25, desc: 'Points d’accès Wi-Fi' },
  power: { color: '#dc2626', ltype: 'Continuous', lw: 25, desc: 'Alimentation électrique' },
  labels: { color: '#0f172a', ltype: 'Continuous', lw: 18, desc: 'Étiquettes et repères' },
  dims: { color: '#475569', ltype: 'Continuous', lw: 13, desc: 'Cotes' },
  titles: { color: '#0f172a', ltype: 'Continuous', lw: 25, desc: 'Titres de plan' },
  sheet: { color: '#0f172a', ltype: 'Continuous', lw: 50, desc: 'Cadre et cartouche (espace papier)' },
  viewport: { color: '#9ca3af', ltype: 'Continuous', lw: 13, desc: 'Fenêtres de présentation (non imprimées)', plot: false }
};

/** Schémas de noms : { id: { name, sep, status: (nom, s) → nom, layers: { clé: nom | { name, built } } } }. */
export const LAYER_SCHEMES = {
  ncs: {
    name: 'AIA / NCS (US National CAD Standard)',
    status: (n, s) => (s ? `${n}-${s}` : n),
    layers: {
      rooms: { name: 'A-AREA' }, walls: { name: 'A-WALL' }, doors: { name: 'A-DOOR' },
      pathways: { name: 'T-CABL-TRAY' }, cables: { name: 'T-CABL' }, fibre: { name: 'T-CABL-FIBR' },
      racks: { name: 'T-EQPM' }, devices: { name: 'T-DATA' }, outlets: { name: 'T-JACK' },
      aps: { name: 'T-DATA-EQPM', built: true }, power: { name: 'E-POWR' }, labels: { name: 'T-TEXT' },
      dims: { name: 'T-DIMS' }, titles: { name: 'T-ANNO', built: true }, sheet: { name: 'G-SHBD-TTLB' },
      viewport: { name: 'T-NPLT' }
    }
  },
  iso13567: {
    name: 'ISO 13567 (agent, élément, présentation, statut)',
    status: (n, s) => (s ? n + s : n),
    layers: {
      rooms: 'A-ROOMS_E-', walls: 'A-WALLS_E-', doors: 'A-DOORS_E-', pathways: 'T-PATHS_E-', cables: 'T-CABLE_E-', fibre: 'T-FIBRE_E-',
      racks: 'T-RACKS_E-', devices: 'T-DEVIC_E-', outlets: 'T-OUTLT_E-', aps: 'T-WIFIA_E-', power: 'E-POWER_E-', labels: 'T-ANNOT_T-',
      dims: 'T-ANNOT_D-', titles: 'T-ANNOT_V-', sheet: 'Z-SHEET_B-', viewport: 'Z-VPORT_E-'
    }
  },
  jollof: {
    name: 'Jollof (JOLLOF-…)',
    status: (n, s) => (s ? `${n}-${s}` : n),
    layers: {
      rooms: 'JOLLOF-ROOMS', walls: 'JOLLOF-WALLS', doors: 'JOLLOF-DOORS', pathways: 'JOLLOF-PATHWAYS', cables: 'JOLLOF-CABLES', fibre: 'JOLLOF-FIBRE',
      racks: 'JOLLOF-RACKS', devices: 'JOLLOF-DEVICES', outlets: 'JOLLOF-OUTLETS', aps: 'JOLLOF-APS', power: 'JOLLOF-POWER', labels: 'JOLLOF-LABELS',
      dims: 'JOLLOF-DIMS', titles: 'JOLLOF-TITLES', sheet: 'JOLLOF-SHEET', viewport: 'JOLLOF-VIEWPORTS'
    }
  }
};

/** Nom du calque d'un rôle. o : { scheme ('ncs' par défaut), status ('N' neuf, 'E' existant… facultatif), overrides { clé: nom } }. */
export function layerName(key, o = {}) {
  const S = LAYER_SCHEMES[o.scheme] || LAYER_SCHEMES.ncs;
  if (o.overrides && o.overrides[key]) return String(o.overrides[key]);
  const v = S.layers[key]; if (!v) return '0';
  const n = typeof v === 'string' ? v : v.name;
  return o.status ? S.status(n, String(o.status).slice(0, 1).toUpperCase()) : n;
}

/** Tous les calques d'un schéma : [{ key, name, color, ltype, lw, plot, desc, built }] (à passer à w.layer). */
export function layerDefs(o = {}) {
  const S = LAYER_SCHEMES[o.scheme] || LAYER_SCHEMES.ncs;
  return LAYER_KEYS.map(key => {
    const v = S.layers[key], L = { ...LOOK[key], ...(o.looks && o.looks[key]) };
    return { key, name: layerName(key, o), color: L.color, ltype: L.ltype, lw: L.lw, plot: L.plot !== false, desc: L.desc, built: !!(v && v.built) };
  });
}
