// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Chiffres du réseau (partie sim), fusionnés dans NET de src/net/limits.js : { CLE: { v, src } }, chaque src est une clé
// de src/check/sources.js (src/check/sources.test.mjs le vérifie). IEEE 802.1Q, 802.1D et 802.1AX sont payantes : leurs
// chiffres sont lus dans les guides de configuration publics de Cisco qui les appliquent.
export const SIM_LIM = {
  /** Numéros de VLAN utilisables : 1 à 4094 (0 et 4095 réservés). */
  VLAN_RANGE: { v: [1, 4094], src: ['ciscoC9300Vlans', 'cisco6500VlanRanges'] },
  /** VLAN natif d'un trunk par défaut (trames sans étiquette), VLAN d'accès par défaut. */
  NATIVE_DEFAULT: { v: 1, src: ['ciscoC9300Trunks'] },
  /** Priorité de pont : 32768 par défaut, de 0 à 61440 par pas de 4096 ; la plus basse (puis la MAC la plus basse) est la racine. */
  STP_PRIO: { v: 32768, step: 4096, max: 61440, src: ['ciscoC9300Stp', 'ciscoNexusRpvst'] },
  /** Coût de port par défaut selon la vitesse (Mb/s), méthode « longue » (802.1D-2004 / 802.1w) ; courte : 100/19/4/2. */
  STP_COST: { v: { 10: 2000000, 100: 200000, 1000: 20000, 10000: 2000, 40000: 500, 100000: 200 }, short: { 10: 100, 100: 19, 1000: 4, 10000: 2 }, src: ['ciscoNexusRpvst', 'ciscoC9300Stp'] },
  /** Agrégat LACP : 8 ports actifs au plus (8 de plus en attente). */
  LACP_ACTIVE: { v: 8, src: ['ciscoC9300EtherChannel', 'ciscoC1300'] },
  /**
   * Équipements administrables du plan, d'après leurs fiches : ports, budget PoE (W), puissance par port (W), encombrement
   * (U, profondeur mm, poids kg) et consommation sans PoE (W). U : hauteur 1,73 in (44 mm) des fiches = 1U.
   */
  PRO_DEVICES: {
    v: {
      switch24: { model: 'Cisco Catalyst C1000-24FP-4X-L', rj45: 24, sfpPlus: 4, poeBudget: 370, portW: 30, u: 1, depth: 345, kg: 4.6, w: 36 },
      switch48: { model: 'Cisco Catalyst C1000-48FP-4X-L', rj45: 48, sfpPlus: 4, poeBudget: 740, portW: 30, u: 1, depth: 350, kg: 5.82, w: 62.26 },
      l3switch: { model: 'Cisco Catalyst C1300-24XS', sfpPlus: 24, copper10g: 4, u: 1, depth: 286, kg: 4.15, w: 49.46 },
      routerpro: { model: 'Cisco ISR C1111-4P', ge: 6, sfp: 1, u: 1, depth: 229.4, kg: 1.98, w: 18 },
      server: { model: 'Dell PowerEdge R250', nic: 2, u: 1, depth: 585, kg: 12.48, psu: 450 },
      mediaconv: { model: 'TP-Link MC220L V5.20', rj45: 1, sfp: 1, w: 1.7, mm: [94.5, 73, 27] },
      fibrepanel: { model: 'Belden LF15LD24B', lcDuplex: 12, u: 1, depth: 370, kg: 4.5 },
      patch24: { model: 'Belden RV6PPF1U24BK-P', ports: 24, u: 1, depth: 101.6, kg: 0.835 },
      patch48: { model: 'Belden RV6PPF2U48BK-P', ports: 48, u: 2, depth: 95.3, kg: 1.398 },
      outlet2: { model: 'Leviton 41080-2WP', ports: 2 }
    },
    src: ['ciscoC1000', 'ciscoC1300', 'ciscoIsr1000', 'dellR250', 'tplinkMc220l', 'beldenLf15ld24b', 'beldenRv6ppf24', 'beldenRv6ppf48', 'leviton41080']
  },
  /** Spanning Tree par défaut des Catalyst : Rapid PVST+ (une instance par VLAN). */
  STP_MODE: { v: 'rpvst', src: ['ciscoC9300Stp1717'] },
  /** VLAN voix : seulement sur un port d'accès ; le téléphone étiquette sa voix (priorité 802.1p 5). */
  VOICE_VLAN: { v: { accessOnly: true, cos: 5 }, src: ['ciscoVoiceVlan'] },
  /** OSPF : minuteries hello et dead par défaut sur Ethernet (s), bande de référence (Mb/s), coût de 1 à 65535. */
  OSPF_TIMERS: { v: { hello: 10, dead: 40 }, src: ['ciscoOspfCmdI', 'rfc2328'] },
  OSPF_REF_MBPS: { v: 100, src: ['ciscoOspfCmdA', 'ciscoOspfCfg'] },
  OSPF_COST: { v: [1, 65535], src: ['ciscoOspfCmdA', 'rfc2328'] },
  /** OSPF : priorité d'interface pour l'élection du routeur désigné, 1 par défaut, 0 à 255 (0 : jamais DR ni BDR). */
  OSPF_PRIO: { v: 1, max: 255, src: ['ciscoOspfCmdI', 'rfc2328'] },
  /** Distances administratives par défaut : connectée 0, statique 1, OSPF 110, route par défaut apprise par DHCP 254. */
  ADMIN_DIST: { v: { connected: 0, static: 1, ospf: 110, dhcp: 254 }, src: ['ciscoAdminDistance', 'ciscoDhcpAd'] },
  /** Liste d'accès « established » : segments TCP avec ACK ou RST (retours) ; filtrage paquet par paquet. */
  ACL_ESTABLISHED: { v: ['ack', 'rst'], src: ['ciscoReflexiveAcl', 'ciscoAclConfig'] },
  /** Réponse d'un routeur dont le TTL tombe à zéro (traceroute) : ICMP « Time Exceeded » type 11, code 0. */
  TTL_EXCEEDED: { v: { type: 11, code: 0 }, src: ['rfc792', 'rfc1812'] },
  /** Routes IPv4 (dynamiques et statiques) d'un C1300 10G : 7168 ; interfaces IP : 256. */
  ROUTES_MAX: { v: { l3switch: 7168 }, ifs: 256, src: ['ciscoC1300'] }
};
