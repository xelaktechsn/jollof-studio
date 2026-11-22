// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Règles de l'API de NetBox suivies par la synchronisation (src/net/interop/netbox.js, src-tauri/src/netbox.rs),
// fusionnées dans NET de src/net/limits.js : { CLE: { v, src } } ; chaque src est une clé du bloc « @interop » de
// src/check/sources-net.js (documentation publique de NetBox Labs et code source publié de NetBox, lus en novembre 2026).
export const NETBOX_LIM = {
  /** Versions : 4.0 au moins (rôle « role » des équipements, object_types des champs personnalisés) ; écrit et lu pour 4.4 à 4.7. */
  NB_VERSIONS: { v: { min: [4, 0], read: [[4, 4], [4, 7]] }, src: ['netboxReleaseNotes', 'netboxCustomFields'] },
  /** Authentification : « Bearer nbt_<clé>.<jeton> » (jetons v2, 4.5+), « Token <jeton> » (v1, dépréciés en 4.6). */
  NB_AUTH: { v: { v2Prefix: 'nbt_', v2Scheme: 'Bearer', v1Scheme: 'Token', v2Since: [4, 5] }, src: ['netboxRestApi'] },
  /** Pagination : 50 objets par défaut (PAGINATE_COUNT), 1000 au plus (MAX_PAGE_SIZE) ; on demande 500 par page. */
  NB_PAGE: { v: { default: 50, max: 1000, asked: 500 }, src: ['netboxRestApi'] },
  /** Ports avant : liste rear_ports de { position, rear_port, rear_port_position } depuis 4.5 (avant : champs plats). */
  NB_PORT_MAPPINGS: { v: { since: [4, 5] }, src: ['netboxPortMappings', 'netboxPortMappingsOld'] },
  /** Portée d'un préfixe : scope_type + scope_id depuis 4.2 (avant : site). */
  NB_PREFIX_SCOPE: { v: { since: [4, 2] }, src: ['netboxPrefixScope', 'netboxIpSerializer'] },
  /** Choix de NetBox utilisés (valeurs exactes) : câbles, unités, interfaces, ports passifs, baies. */
  NB_CHOICES: {
    v: {
      cable: ['cat5e', 'cat6', 'cat6a', 'mmf', 'mmf-om1', 'mmf-om2', 'mmf-om3', 'mmf-om4', 'mmf-om5', 'smf', 'smf-os1', 'smf-os2'],
      lengthUnit: ['km', 'm', 'cm', 'mi', 'ft', 'in'], linkStatus: ['connected', 'planned', 'decommissioning'],
      iface: ['100base-tx', '1000base-t', '2.5gbase-t', '10gbase-t', '1000base-x-sfp', '10gbase-x-sfpp', 'virtual', 'other'], ifMode: ['access', 'tagged', 'tagged-all'],
      port: ['8p8c', 'lc'], rackForm: ['4-post-cabinet', 'wall-cabinet'], rackUnit: ['mm', 'in']
    },
    src: ['netboxDcimChoices']
  },
  /** Extrémités d'un câble : listes de { object_type « app_label.model », object_id }. */
  NB_TERMINATIONS: { v: { types: ['dcim.interface', 'dcim.frontport', 'dcim.rearport'] }, src: ['netboxCableSerializer', 'netboxObjectTypeId', 'netboxCableModel'] },
  /** Test de connexion : clés lues dans /api/status/. */
  NB_STATUS: { v: ['netbox-version', 'netbox-full-version', 'django-version', 'python-version', 'plugins', 'rq-workers-running', 'hostname'], src: ['netboxStatusView'] }
};
