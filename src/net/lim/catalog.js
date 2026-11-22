// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Chiffres du réseau (partie catalogue), fusionnés dans NET de src/net/limits.js : { CLE: { v, src } }.
// Le catalogue de matériel réel (src/net/catalog/products.json, chargé à la demande) cite pour chaque produit la fiche du
// fabricant qui a été lue (champ src, clé de src/check/sources.js). CATALOG_SOURCES en tient la liste : catalog.test.mjs
// vérifie que chaque produit cite une de ces fiches et que chacune sert.
export const CATALOG_LIM = {
  /** Fabricants du catalogue. */
  CATALOG_VENDORS: { v: ['Belden', 'Cisco', 'Dell', 'Eaton', 'MikroTik', 'TP-Link', 'Tripp Lite', 'Ubiquiti'], src: ['belden10GXS12', 'belden1583A', 'belden2412', 'beldenLf15ld24b', 'beldenRv6ppf24', 'beldenRv6ppf48', 'cisco10gSfpPlus', 'cisco1gSfp', 'ciscoC1000', 'ciscoC1300', 'ciscoIsr1000', 'dellR250', 'eaton5pxG2Brochure', 'mikrotikCcr2004', 'mikrotikCrs328', 'mikrotikCrs354', 'mikrotikRb5009', 'tplinkEap650', 'tplinkEap670', 'tplinkEap772', 'tplinkEr7206', 'tplinkMc220l', 'tplinkSg1008pDims', 'tplinkSg3428mp', 'tplinkSg3452p', 'trippPdu1230', 'trippPdumv20hv', 'ui6Enterprise', 'uiRack12uWall450', 'uiRack42u1000', 'uiU6Pro', 'uiU7Pro', 'uiUdmPro', 'uiUnasPro', 'uiUsw24Poe', 'uiUsw48Poe', 'uiUswPro24Poe', 'uiUswPro48Poe', 'uiUswProAggregation'] },
  /** Résultats de testeurs réels : champs d'un rapport de test reconnus à l'import (interop/linkware.js). */
  TESTER_FIELDS: { v: ['cableId', 'verdict', 'limit', 'len', 'at', 'tester', 'serial', 'operator', 'sw', 'nvp', 'delay', 'skew', 'res', 'il', 'next', 'psnext', 'acrf', 'psacrf', 'acrn', 'psacrn', 'rl'], src: ['flukeLinkwareExport', 'flukeLinkwareReportHeader', 'flukeLinkwareReportDetails'] }
};
