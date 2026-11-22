// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Règles de format de l'échange IFC (src/net/interop/ifc.js, ifcwrite.js, step.js), fusionnées dans NET de
// src/net/limits.js : { CLE: { v, src } }, chaque src est une clé de src/check/sources.js (bloc « @interop » de
// sources-net.js). Documentation IFC4 ADD2 TC1 lue dans le dépôt public buildingSMART/Standards-builds (source du site
// standards.buildingsmart.org) ; codage des chaînes et des GlobalId dans le dépôt du site technical.buildingsmart.org.
export const IFC_LIM = {
  /** Schéma écrit : IFC4 (ADD2 TC1) ; lus : IFC4 et IFC2X3 (entités de réseau absentes d'IFC2X3_TC1.exp). */
  IFC_SCHEMAS: { v: { write: 'IFC4', read: ['IFC4', 'IFC2X3'] }, src: ['bsIfc4Express', 'bsIfc2x3Express', 'bsIfcReleaseNotes'] },
  /** Vue de définition déclarée : Reference View 1.2 quand le fichier n'emploie que ses concepts (ifcwrite.js IFC_VIEWS). */
  IFC_MVD: { v: { rv: 'ReferenceView_V1.2', design: 'NotAssigned' }, src: ['bsIfc4ReferenceView'] },
  /** IfcGloballyUniqueId : 128 bits écrits en 22 caractères de base 64, alphabet propre à l'IFC. */
  IFC_GUID: { v: { chars: 22, alphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$' }, src: ['bsIfc4GlobalId', 'bsIfcGuid'] },
  /** Chaînes STEP : caractères 32 à 126 tels quels, le reste codé (\X2\…\X0\, \X\hh, \S\c). */
  IFC_STEP_PRINTABLE: { v: [32, 126], src: ['bsIfcStringEncoding'] },
  /** Équipements → IfcCommunicationsApplianceTypeEnum (valeurs de l'énumération IFC4, le reste en USERDEFINED). */
  IFC_APPLIANCE_ENUM: { v: ['ANTENNA', 'COMPUTER', 'FAX', 'GATEWAY', 'MODEM', 'NETWORKAPPLIANCE', 'NETWORKBRIDGE', 'NETWORKHUB', 'PRINTER', 'REPEATER', 'ROUTER', 'SCANNER', 'USERDEFINED', 'NOTDEFINED'], src: ['bsIfc4ApplianceEnum'] },
  /** Cheminements → IfcCableCarrierSegmentTypeEnum, dimensions nominales des jeux Pset_CableCarrierSegmentType*. */
  IFC_CARRIER_ENUM: { v: ['CABLELADDERSEGMENT', 'CABLETRAYSEGMENT', 'CABLETRUNKINGSEGMENT', 'CONDUITSEGMENT', 'USERDEFINED', 'NOTDEFINED'], src: ['bsIfc4CarrierEnum', 'bsIfc4PsetCarrier'] },
  /** Prises : IfcOutletTypeEnum DATAOUTLET (ajouté en IFC4). */
  IFC_OUTLET: { v: 'DATAOUTLET', src: ['bsIfc4OutletEnum'] },
  /** Câbles : CABLESEGMENT, ports « Input » (SINK) et « Output » (SOURCE) ; système : IfcDistributionSystemEnum DATA. */
  IFC_CABLE: { v: { type: 'CABLESEGMENT', ports: ['Input', 'Output'], system: 'DATA' }, src: ['bsIfc4CableSegment', 'bsIfc4DistributionSystem'] }
};
