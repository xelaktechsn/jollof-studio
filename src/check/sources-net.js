// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fiches des sources du réseau informatique (src/net : NET de limits.js et lim/*.js, NET_SRC de issues.js et checks/*.js).
// Elles rejoignent SOURCES (sources.js) quand ce module est chargé, c'est-à-dire avec le plan réseau (issues.js) : le
// démarrage de l'application ne les charge pas. src/check/sources.test.mjs les vérifie comme les autres.
import { SOURCES } from './sources.js';

export const NET_SOURCES = {
  /* ---------- Réseau informatique (src/net : NET de limits.js, NET_SRC de issues.js), relu en novembre 2026 ---------- */
  // Les normes de câblage (ANSI/TIA-568, ISO/IEC 11801) et IEEE 802.3 sont payantes : leurs chiffres sont lus dans les
  // guides des fabricants qui les citent (Belden, Fluke Networks, Cisco) et dans les documents publics du groupe 802.3.
  beldenCopperDesignGuide: {
    title: 'Copper Structured Cabling Design Guide, Issue 10',
    publisher: 'Belden',
    url: 'https://www.belden.com/-/media/project/belden/catalog-assets/assets/2025/10/31/11/57/174662.pdf?rev=1fd9a57224d64e03940d7c96afec4e4b',
    section: 'Chiffres de la norme TIA-568-C lus dans le guide du fabricant (norme payante, non lue directement) : Figure 10, p. 13 : lien permanent de 90 m, canal de 100 m, 10 m de cordons au plus ; Table 1, p. 11 : Cat 5e 1000 Mb/s sur 100 m, Cat 6 en 10 Gb/s sur 37 à 55 m, Cat 6A en 10 Gb/s sur 100 m ; Table 2, p. 22 : brochages T568A et T568B ; bandes passantes : Cat 6A 500 MHz (p. 64), Cat 6 250 MHz (p. 65), Cat 5e 100 MHz (p. 67)'
  },
  flukeT568AvsB: {
    title: 'Differences between wiring codes T568A vs T568B',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/knowledge-base/application-or-standards-articles-copper/differences-between-wiring-codes-t568a-vs',
    section: 'Les deux codes ne diffèrent que par l’échange des paires orange et verte ; « Both are allowed under the ANSI/TIA-568.2-D wiring standards. » Un câble droit a le même code aux deux bouts.'
  },
  foaUtpColorCodes: {
    title: 'Premises Cabling: UTP Termination and Color Codes',
    publisher: 'The Fiber Optic Association',
    url: 'https://www.thefoa.org/tech/ref/premises/term.html',
    section: 'Numérotation des paires : 1 bleue, 2 orange, 3 verte, 4 marron ; un câble serti T568A d’un côté et T568B de l’autre croise les paires 2 et 3'
  },
  flukeFrequencySteps: {
    title: 'Frequency steps on the DTX CableAnalyzer',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/knowledge-base/dtx-cableanalyzer/frequency-steps-dtx-cableanalyzer',
    section: 'Fréquence de mesure la plus haute de chaque catégorie (classe ISO) : Cat 5e 100 MHz (classe D), Cat 6 250 MHz (classe E), Cat 6A 500 MHz (classe EA)'
  },
  flukeBeyond100m: {
    title: 'Extending and Testing Cable Runs Beyond 100 Meters',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/blog/cabling-chronicles/extending-and-testing-cable-runs-beyond-100-meters',
    section: 'Le canal de 100 m des normes : « 4-connector channel that includes a 90m permanent link and 5m of patch cable at both ends »'
  },
  fluke10gbaseT: {
    title: '10GBASE-T Field Testing Requirements',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/knowledge-base/applicationstandards-articles-copper/10gbase-t-field-testing-requirements',
    section: 'TSB-155 (lu par Fluke) : 10GBASE-T sur Cat 6 assuré jusqu’à 37 m, de 37 à 55 m selon la diaphonie exogène (à mesurer), au-delà de 55 m il faut l’atténuer ; Cat 6A pour 100 m'
  },
  flukeWireMapBlog: {
    title: 'Wire Map Testing: It’s Not All About Color',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/blog/cabling-chronicles/wire-map-testing-it-s-not-all-about-color',
    section: 'Définitions des défauts de la carte de câblage : conducteur ouvert, court-circuit, paire inversée, paires croisées, paire séparée ; une paire séparée passe le test de continuité broche à broche mais échoue à la mesure de diaphonie (NEXT)'
  },
  flukeMicroScannerFaults: {
    title: 'Diagnosing wiremap faults with the MicroScanner2',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/knowledge-base/microscanner2/diagnosing-wiremap-faults-microscanner2',
    section: 'Paires croisées : mélange des codes 568A et 568B, les paires 1-2 et 3-6 sont croisées'
  },
  ieee8023_2022: {
    title: 'IEEE Std 802.3-2022, IEEE Standard for Ethernet',
    publisher: 'IEEE',
    url: 'https://standards.ieee.org/ieee/802.3/10422/',
    section: 'Norme payante, texte non lu directement : référence de la couche physique Ethernet (10BASE-T, 100BASE-TX, 1000BASE-T, 10GBASE-T) ; les chiffres utilisés viennent des documents publics du groupe 802.3 et des guides cités ici'
  },
  ieee80211_2024: {
    title: 'IEEE Std 802.11-2024, Wireless LAN Medium Access Control (MAC) and Physical Layer (PHY) Specifications',
    publisher: 'IEEE',
    url: 'https://standards.ieee.org/ieee/802.11/10548/',
    section: 'Norme payante, texte non lu directement : référence du Wi-Fi (MAC et couche physique), qui remplace 802.11-2020 ; l’association à un point d’accès et la sécurité RSNA y sont définies'
  },
  ieeeMaint1115: {
    title: 'IEEE 802.3 Maintenance Request 1115',
    publisher: 'IEEE 802.3 Working Group',
    url: 'https://www.ieee802.org/3/maint/requests/maint_1115.pdf',
    section: 'Clause 40.4.4 : Auto MDI/MDI-X facultatif en 1000BASE-T ; Table 40-12 : fonction de croisement des quatre paires ; 14.5.2 : croisement en 10BASE-T'
  },
  ieeeMaint1183: {
    title: 'IEEE 802.3 Maintenance Request 1183',
    publisher: 'IEEE 802.3 Working Group',
    url: 'https://www.ieee802.org/3/maint/requests/maint_1183.pdf',
    section: 'Clause 55.4.4 : l’Auto-MDIX est obligatoire en 10GBASE-T'
  },
  unhIolFeTestPlans: {
    title: 'Fast Ethernet Test Plans',
    publisher: 'University of New Hampshire InterOperability Laboratory',
    url: 'https://www.iol.unh.edu/testing/ethernet/fe/test-plans',
    section: 'Plans d’essai par clause d’IEEE 802.3 : clause 14 (10BASE-T), clause 25 (100BASE-TX)'
  },
  cisco10100Cables: {
    title: 'Ethernet 10BaseT, 100BaseTX and Fast Ethernet Cabling',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/routers/10000-series-routers/46792-ethbase.html',
    section: '100 m au plus en 10BaseT et 100BaseTX ; émission sur les broches 1 et 2, réception sur 3 et 6, broches 4, 5, 7 et 8 inutilisées ; Cat 3, 4 ou 5 en 10BaseT, Cat 5 en 100BaseTX'
  },
  ciscoCat2960Cabling: {
    title: 'Catalyst 2960 Switch Hardware Installation Guide, Cable and Connectors',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960/hardware/installation/guide/2960_hg/higcable.pdf',
    section: '1000BASE-T : quatre paires en Cat 5 ; Auto-MDIX activé par défaut sur les ports du switch'
  },
  ciscoStp: {
    title: 'Spanning Tree Protocol',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/tech/lan-switching/spanning-tree-protocol/index.html',
    section: 'Le protocole Spanning Tree (IEEE 802.1D) bloque les chemins redondants entre switchs pour éviter les boucles de niveau 2'
  },
  ciscoL2Loops: {
    title: 'Troubleshoot Layer 2 Loops (Catalyst 9200)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/switches/catalyst-9200-series-switches/221191-troubleshoot-layer-2-loops.html',
    section: 'Une boucle de niveau 2 sans Spanning Tree fait tourner les trames de diffusion sans fin (tempête de diffusion) : liens saturés, tables MAC instables'
  },
  eaOverview8023bt: {
    title: 'Overview of 802.3bt — Power over Ethernet standard (white paper v2.1)',
    publisher: 'Ethernet Alliance',
    url: 'https://ethernetalliance.org/wp-content/uploads/2019/12/WP_EA_Overview8023bt_V2p1_FINAL.pdf',
    section: 'Puissance réservée par le PSE pour les classes 1 à 8 : 4, 7, 15,4, 30, 45, 60, 75 et 90 W ; puissance garantie au PD : 3,84, 6,49, 13 (12,95), 25,5, 40, 51, 62 et 71,3 W ; la classe 0 vaut la classe 3 ; type 1 jusqu’à la classe 3, type 2 la classe 4, type 3 jusqu’à la classe 6, type 4 les classes 7 et 8 ; un PSE de la clause 145 réserve 14,0 W en classe 3'
  },
  tiTps23755Class: {
    title: 'TPS23755 High Efficiency PoE PD Interface with No-Opto Flyback DC-DC Controller',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/tps23755.pdf',
    section: 'Table 7-1 (relu par un outil de résumé, citation non mot à mot) : classes 0 à 3, puissance au PD 12,95, 3,84, 6,49 et 12,95 W'
  },
  axisM2035le: {
    title: 'AXIS M2035-LE Bullet Camera Datasheet',
    publisher: 'Axis Communications',
    url: 'https://www.axis.com/dam/public/cc/31/2a/datasheet-axis-m2035-le-bullet-camera-en-US-555402.pdf',
    section: 'Alimentation : PoE IEEE 802.3af type 1 classe 3, 5 W typique, 12,95 W au plus'
  },
  cisco7800DataSheet: {
    title: 'Cisco IP Phone 7800 Series Data Sheet',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/products/collateral/collaboration-endpoints/unified-ip-phone-7800-series/data-sheet-c78-729488.html',
    section: 'Alimentation : PoE IEEE 802.3af classe 1, 3,84 W au plus'
  },
  tplinkEap225: {
    title: 'EAP225 V4.20 Datasheet',
    publisher: 'TP-Link',
    url: 'https://static.tp-link.com/upload/product-overview/2026/202603/20260305/Datasheet_EAP225%204.20.pdf',
    section: 'Alimentation : PoE 802.3af ou passif 24 V ; consommation maximale 12,6 W (version US), 9,7 W (version EU)'
  },
  tplinkSg1008p: {
    title: 'TL-SG1008P V6 Datasheet',
    publisher: 'TP-Link',
    url: 'https://static.tp-link.com/upload/product-overview/2021/202108/20210827/TL-SG1008P%206.0%20Datasheet.pdf',
    section: '4 ports PoE+ 802.3af/at sur 8, 30 W par port, budget PoE total de 64 W'
  },
  rfc2131: {
    title: 'RFC 2131 Dynamic Host Configuration Protocol',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc2131',
    section: '§ 4.1 : messages du client vers le port du serveur (67), du serveur vers le port du client (68) ; § 3.1 : DHCPDISCOVER, DHCPOFFER, DHCPREQUEST, DHCPACK ; un seul serveur doit répondre pour un même réseau, sinon le client prend la première offre'
  },
  rfc3927: {
    title: 'RFC 3927 Dynamic Configuration of IPv4 Link-Local Addresses',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc3927',
    section: '§ 1 : préfixe 169.254/16 réservé aux adresses locales au lien, que l’hôte se donne lui-même quand aucun serveur DHCP ne répond ; ces adresses ne passent pas les routeurs'
  },
  rfc1918: {
    title: 'RFC 1918 Address Allocation for Private Internets',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc1918',
    section: '§ 3 : plages privées 10.0.0.0/8, 172.16.0.0/12 et 192.168.0.0/16 ; une adresse doit être unique dans le réseau où elle sert'
  },
  rfc950: {
    title: 'RFC 950 Internet Standard Subnetting Procedure',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc950',
    section: 'Masque de sous-réseau : un hôte joint directement les adresses de son sous-réseau, les autres par une passerelle de ce sous-réseau ; adresses de réseau et de diffusion réservées'
  },
  rfc4632: {
    title: 'RFC 4632 Classless Inter-domain Routing (CIDR)',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc4632',
    section: '§ 3.1 : notation préfixe/longueur (192.168.1.0/24), masque contigu'
  },
  mqtt311: {
    title: 'MQTT Version 3.1.1 (OASIS Standard)',
    publisher: 'OASIS',
    url: 'https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html',
    section: '§ 4.2 : port TCP 1883 enregistré auprès de l’IANA pour MQTT sans TLS ; § 2 et 3 : paquets CONNECT, CONNACK, PUBLISH, SUBSCRIBE, SUBACK, PINGREQ, DISCONNECT ; § 4.7 : jokers + et # des filtres de sujets ; § 4.3.3 : QoS 2 (« exactly once ») : le récepteur répond PUBREC, renvoie PUBREC sans redistribuer tant que le PUBREL manque [MQTT-4.3.3-2], l’émetteur prend un identifiant libre, envoie PUBREL au PUBREC et attend PUBCOMP [MQTT-4.3.3-1] ; figure 4.3 : distribution après le PUBLISH (méthode B) ou après le PUBREL (méthode A), au choix ; § 2.3.1 : identifiant de paquet inutilisé [MQTT-2.3.1-2, -4] ; § 3.8.4 : QoS remise = minimum de la QoS publiée et de la QoS accordée ; § 3.3.5 : abonnements qui se recouvrent, la plus grande QoS [MQTT-3.3.5-1] ; § 3.3.1.2 : les deux bits de QoS à 1 = malformé [MQTT-3.3.1-4] ; § 3.8.3 : QoS demandée autre que 0, 1, 2 = malformé [MQTT-3-8.3-4] ; § 3.6.1 : PUBREL, drapeaux 0010 [MQTT-3.6.1-1] ; § 3.3.1.3 : message retenu gardé avec sa QoS, RETAIN = 1 pour un nouvel abonnement, 0 sinon, vide = effacé [MQTT-3.3.1-5 à -11] ; § 4.4 : renvoi seulement à la reconnexion avec CleanSession = 0 [MQTT-4.4.0-1]'
  },
  modbusTcpGuide: {
    title: 'MODBUS Messaging on TCP/IP Implementation Guide V1.0b',
    publisher: 'Modbus Organization',
    url: 'https://www.modbus.org/file/secure/messagingimplementationguide.pdf',
    section: 'Port TCP 502 réservé à Modbus ; en-tête MBAP de 7 octets (identifiant de transaction, protocole 0, longueur, unité) devant la trame de la fonction'
  },
  /* ---------- Réseau, conception professionnelle : simulation, VLAN, routage, fibre (src/net/lim/sim.js, src/net/checks/sim.js) ---------- */
  // @sim
  ciscoC9300Stp1717: {
    title: 'Configuring Spanning Tree Protocol (Layer 2 Configuration Guide, Cisco IOS XE 17.17.x, Catalyst 9300)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-17/configuration_guide/lyr2/b_1717_lyr2_9300_cg/configuring_spanning_tree_protocol.html',
    section: '« Spanning-Tree Modes and Protocols » : « In Rapid PVST+ mode, each VLAN runs its own spanning-tree instance » (convergence rapide 802.1w) ; « Bridge ID, Device Priority, and Extended System ID » : priorité sur 4 bits et identifiant système étendu de 12 bits égal au numéro du VLAN ; tableau 3 : mode par défaut Rapid PVST+, priorité 32768 ; « Configuring the Device Priority of a VLAN » : spanning-tree vlan … priority, 0 à 61440 par pas de 4096'
  },
  ciscoVoiceVlan: {
    title: 'Configuring Voice VLANs (VLAN Configuration Guide, Cisco IOS XE Cupertino 17.9.x, Catalyst 9300)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-9/configuration_guide/vlan/b_179_vlan_9300_cg/configuring_voice_vlans.html',
    section: '« The voice VLAN feature enables access ports to carry IP voice traffic from an IP phone » ; prérequis : seulement sur les ports d’accès, pas sur les trunks ; commande « switchport voice vlan {vlan-id | dot1p | none | untagged} » ; le switch indique au téléphone par CDP d’envoyer la voix en trames 802.1Q du VLAN voix (priorité 5) ; le trafic sans étiquette du PC branché derrière le téléphone passe tel quel'
  },
  ciscoOspfNeighbor: {
    title: 'Troubleshoot OSPF Neighbor Problems',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/ip/open-shortest-path-first-ospf/13699-29.html',
    section: 'Section « No State Revealed » : les paramètres des hello doivent concorder sur les interfaces voisines : numéro d’aire, type d’aire (stub, NSSA), sous-réseau et masque, minuteries hello et dead ; « Verify that neighbor routers have different Router IDs »'
  },
  ciscoOspfDupRid: {
    title: 'Troubleshooting Duplicate Router IDs with OSPF',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/ip/open-shortest-path-first-ospf/23862-duplicate-router-id-ospf.html',
    section: '« When two routers use the same router ID in an OSPF domain, routing possibly does not work correctly » (messages %OSPF-4-DUP_RTRID, calculs SPF répétés, routes instables)'
  },
  ciscoOspfCmdI: {
    title: 'Cisco IOS IP Routing: OSPF Command Reference, OSPF Commands: ip ospf fast-reroute per-prefix through R',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_ospf/command/iro-cr-book/ospf-i1.html',
    section: '« ip ospf hello-interval » : 10 secondes par défaut sur Ethernet, « must be the same for all routers … on a specific network » ; « By default, the dead interval is 4 times the hello interval » (40 s) ; « network area » : OSPF fonctionne sur une interface dont l’adresse primaire est couverte par la déclaration, une interface n’appartient qu’à une aire, la première déclaration qui correspond l’emporte ; « router-id » : chaque identifiant doit être unique ; « ip ospf priority » : 1 par défaut, de 0 à 255, la plus haute priorité devient DR (l’identifiant départage), priorité 0 : ni DR ni BDR'
  },
  ciscoOspfCmdA: {
    title: 'Cisco IOS IP Routing: OSPF Command Reference, OSPF Commands: A through ip ospf demand-circuit',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_ospf/command/iro-cr-book/ospf-a1.html',
    section: '« auto-cost reference-bandwidth » : 100 Mb/s par défaut, coût = bande de référence / débit de l’interface ; « ip ospf cost » : coût de 1 à 65535 (10^8 / débit)'
  },
  ciscoOspfCfg: {
    title: 'IP Routing: OSPF Configuration Guide, Configuring OSPF (Cisco IOS XE 16)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_ospf/configuration/xe-16/iro-xe-16-book/iro-cfg.html',
    section: 'Bande de référence 10^8 par défaut (« Reference bandwidth unit is 100 mbps ») ; « Forcing the Router ID Choice with a Loopback Interface » : « OSPF uses the largest IP address configured on the interfaces as its router ID », une boucle locale l’emporte s’il y en a une'
  },
  ciscoPassiveIf: {
    title: 'Default Passive Interfaces (IP Routing: Protocol-Independent Configuration Guide, Cisco IOS XE 16)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_pi/configuration/xe-16/iri-xe-16-book/iri-default-passive-interface.pdf',
    section: '« In OSPF, the interface address that you specify as passive appears as a stub network in the OSPF domain. OSPF routing information is neither sent nor received through the specified device interface » ; pas de hello sur une interface passive, aucun voisin ne la voit'
  },
  ciscoAdminDistance: {
    title: 'Understand Administrative Distance',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/ip/border-gateway-protocol-bgp/15986-admin-distance.html',
    section: 'Tableau « Default AD Values » : connectée 0, statique 1, OSPF 110, RIP 120… ; « the route with the lowest administrative distance is preferred and installed in the routing table »'
  },
  ciscoDhcpAd: {
    title: 'Configure Administrative Distance for DHCP Routes',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/routers/sd-wan/221891-configure-administrative-distance-for-dh.html',
    section: '« The default AD for a DHCP-learned default route is 254, versus 1 for a static route » (note technique des routeurs SD-WAN)'
  },
  rfc2328: {
    title: 'RFC 2328 OSPF Version 2',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc2328',
    section: '§ 3.2 : entre deux aires, le chemin passe par la dorsale (aire 0), en étoile ; § 3.3 : routeur de bordure (ABR) attaché à plusieurs aires, un calcul par aire ; § 3.1 : la dorsale (aire 0) relie les aires et contient tous les ABR, « The backbone must be contiguous » (sinon liens virtuels, § 15) ; § 9.4 : élection du routeur désigné et du secours, plus haute priorité puis plus haut identifiant, priorité 0 inéligible ; § 10.1 : états 2-Way et Full ; § 10.4 : sur un réseau de diffusion, adjacence seulement avec le DR et le BDR (sinon on reste en 2-Way) ; § 10.5 : le masque de réseau, HelloInterval et RouterDeadInterval d’un hello reçu doivent correspondre à ceux de l’interface, sinon le paquet est jeté ; § 11 : chemins de même coût gardés dans une même entrée de la table ; § 16.1 : arbre des plus courts chemins par l’algorithme de Dijkstra, puis les réseaux terminaux ; § 16.2 : routes inter-aires par les résumés des ABR, un routeur attaché à plusieurs aires n’examine que ceux de la dorsale ; annexe C.3 : HelloInterval 10 s sur un réseau local, RouterDeadInterval multiple (4) du HelloInterval, coût d’interface toujours supérieur à 0, Router Priority 0 : jamais DR'
  },
  ciscoReflexiveAcl: {
    title: 'Configuring IP Session Filtering (Reflexive Access Lists)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/en/US/docs/ios-xml/ios/sec_data_acl/configuration/15-1mt/Configuring_IP_Session_Filtering_-_Reflexive_Access_Lists.html',
    section: '« With Basic Access Lists » : « The established keyword filters TCP packets based on whether the ACK or RST bits are set » (TCP seulement) ; une liste d’accès ordinaire filtre chaque paquet, retours compris ; les listes réflexives font un vrai filtrage de session'
  },
  ciscoC9300Vlans: {
    title: 'Configuring VLANs (VLAN Configuration Guide, Cisco IOS XE Cupertino 17.9.x, Catalyst 9300)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-9/configuration_guide/vlan/b_179_vlan_9300_cg/configuring_vlans.html',
    section: 'Norme IEEE 802.1Q payante, lue dans ce guide : « VLANs are identified by a number from 1 to 4094 » ; tableau 1 (Port Membership Modes) : un port d’accès statique appartient à un seul VLAN, un port trunk est membre de tous les VLAN par défaut'
  },
  cisco6500VlanRanges: {
    title: 'VLANs (Catalyst 6500 Release 15.4SY Supervisor Engine 6T Software Configuration Guide)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst6500/ios/15-4SY/config_guide/sup6T/15_3_sy_swcg_6T/vlans.html',
    section: 'Tableau 26-1 « VLAN Ranges » : VLAN 0 et 4095 réservés (« For system use only ») ; 1 VLAN par défaut ; 2–1001 plage normale ; 1006–4094 plage étendue'
  },
  ciscoC9300Trunks: {
    title: 'Configuring VLAN Trunks (VLAN Configuration Guide, Cisco IOS XE Cupertino 17.9.x, Catalyst 9300)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-9/configuration_guide/vlan/b_179_vlan_9300_cg/configuring_vlan_trunks.html',
    section: '« If a packet has a VLAN ID that is the same as the outgoing port native VLAN ID, the packet is sent untagged » ; « The native VLAN is VLAN 1 by default » ; liste des VLAN autorisés (switchport trunk allowed vlan), tous par défaut ; prérequis : le VLAN natif doit être le même aux deux bouts d’un trunk 802.1Q, sinon risque de boucles'
  },
  cisco9kPvid: {
    title: 'ASR 9000 Series Common Problems with Spanning Tree Protocols',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/routers/asr-9000-series-aggregation-services-routers/116514-problem-stp-00.html',
    section: 'Section « Problem - Port VLAN ID (PVID) inconsistency » : un switch PVST+ bloque le port qui reçoit une BPDU d’un VLAN natif différent, mécanisme fait pour détecter l’erreur de configuration et éviter une boucle'
  },
  ciscoC9300Stp: {
    title: 'Configuring Spanning Tree Protocol (Layer 2 Configuration Guide, Cisco IOS XE Cupertino 17.9.x, Catalyst 9300)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-9/configuration_guide/lyr2/b_179_lyr2_9300_cg/configuring_spanning_tree_protocol.html',
    section: 'Normes IEEE 802.1D/802.1w payantes, lues dans ce guide : identifiant de pont = priorité + MAC, la racine a la priorité la plus basse puis la MAC la plus basse ; priorité 0 à 61440 par pas de 4096, 32768 par défaut ; tableau 3 « Default Spanning-Tree Configuration » : coûts 2000000 (10M), 200000 (100M), 20000 (1G), 2000 (10G), 500 (40G), 200 (100G) ; rôles racine, désigné, alternatif, de secours ; « Restrictions » : « Do not configure an access device as the spanning tree primary root »'
  },
  ciscoNexusRpvst: {
    title: 'Configuring Rapid PVST+ Using Cisco NX-OS (Nexus 9000 Series NX-OS Layer 2 Switching Configuration Guide, 6.x)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/switches/datacenter/nexus9000/sw/6-x/layer2/configuration/guide/b_Cisco_Nexus_9000_Series_NX-OS_Layer_2_Switching_Configuration_Guide/b_Cisco_Nexus_9000_Series_NX-OS_Layer_2_Switching_Configuration_Guide_chapter_0110.html',
    section: 'Section « Port Cost », tableau 4 « Default Port Cost » (méthode courte / longue) : 10 Mb/s 100 / 2 000 000 ; 100 Mb/s 19 / 200 000 ; 1 Gb/s 4 / 20 000 ; 10 Gb/s 2 / 2 000 ; 40 Gb/s 1 / 500 ; 100 Gb/s 1 / 200 ; un port de bord RSTP passe tout de suite en transmission ; priorité de pont par multiples de 4096'
  },
  ciscoRstp: {
    title: 'Understand Rapid Spanning Tree Protocol (802.1w)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/lan-switching/spanning-tree-protocol/24062-146.html',
    section: 'Section « New Port States and Port Roles » : port racine (meilleure BPDU reçue), port désigné (envoie la meilleure BPDU du segment), port alternatif et port de secours bloqués ; « Rapid Transition to Forwarding State » : le port de bord correspond au PortFast'
  },
  ciscoStpDesign: {
    title: 'Troubleshoot STP Problems and Related Design Considerations',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/lan-switching/spanning-tree-protocol/10556-16.html',
    section: 'Section « Design STP for Trouble Avoidance > Know Where the Root Is » : « Do not leave the STP to decide which bridge is root » ; choisir un pont puissant au centre du réseau (root primary / secondary)'
  },
  ciscoC9300EtherChannel: {
    title: 'Configuring EtherChannels (Layer 2 Configuration Guide, Cisco IOS XE Cupertino 17.9.x, Catalyst 9300)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-9/configuration_guide/lyr2/b_179_lyr2_9300_cg/configuring_etherchannels.html',
    section: 'Norme IEEE 802.1AX payante, lue dans ce guide : tableau 2 « EtherChannel LACP Modes » : actif + actif ou passif forment un agrégat, passif + passif non ; mode « on » : agrégat seulement si les deux bouts sont en « on » ; « Configure all ports in an EtherChannel to operate at the same speeds and duplex modes » ; LACP : jusqu’à 16 ports, 8 actifs et 8 en attente'
  },
  ciscoDhcpRelay: {
    title: 'Configuring the Cisco IOS DHCP Relay Agent (IP Addressing: DHCP Configuration Guide, Cisco IOS Release 15S)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr_dhcp/configuration/15-s/dhcp-15-s-book/dhcp-relay-agent.html',
    section: 'Section « Specifying the Packet Forwarding Address » : le relais envoie la diffusion du client en envoi individuel au serveur donné par « ip helper-address » et met l’adresse de son interface dans le champ giaddr, qui permet au serveur de choisir le sous-réseau'
  },
  rfc3046: {
    title: 'RFC 3046 DHCP Relay Agent Information Option',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc3046.html',
    section: 'Résumé et § 2.0 : option 82 (conteneur) insérée par le relais quand il transmet la demande d’un client au serveur ; § 2.1 : ajoutée en dernière option, réglable et désactivée par défaut ; § 2.2 : le serveur la renvoie telle quelle ; § 3.1 : sous-option 1, identifiant du circuit (interface) où la demande est arrivée ; § 3.2 : sous-option 2, identifiant distant'
  },
  rfc1812: {
    title: 'RFC 1812 Requirements for IP Version 4 Routers',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc1812.html',
    section: '§ 5.3.1 : un routeur réduit le TTL d’au moins un ; à zéro le paquet est jeté et un message ICMP « Time Exceeded » code 0 part vers la source ; § 5.2.4.3 « Longest Match » et § 2.2.5.2 : la route au préfixe le plus long l’emporte'
  },
  rfc792: {
    title: 'RFC 792 Internet Control Message Protocol',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc792.html',
    section: '« Time Exceeded Message » : type 11, code 0 « time to live exceeded in transit » ; la passerelle qui trouve un TTL à zéro jette le datagramme et peut prévenir la source (principe du traceroute)'
  },
  rfc3022: {
    title: 'RFC 3022 Traditional IP Network Address Translator (Traditional NAT)',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc3022.html',
    section: 'Résumé et § 2.2 « Overview of NAPT » : beaucoup d’adresses et de ports TCP/UDP traduits vers une seule adresse et ses ports ; les sessions s’ouvrent de l’intérieur vers l’extérieur'
  },
  ciscoC9300Acl: {
    title: 'Configuring IPv4 ACLs (Security Configuration Guide, Cisco IOS XE Cupertino 17.9.x, Catalyst 9300)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-9/configuration_guide/sec/b_179_sec_9300_cg/configuring_ipv4_acls.html',
    section: 'Section « ACL Overview » : « The first match decides whether the switch accepts or rejects the packets » ; si rien ne correspond, le paquet est rejeté ; « Numbered Standard IPv4 ACLs » : refus implicite à la fin de la liste'
  },
  ciscoAclConfig: {
    title: 'Configure IP Access Lists',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/security/ios-firewall/23602-confaccesslists.html',
    section: 'Section « Process ACLs » : les entrées sont lues dans l’ordre, la première qui correspond décide ; « Every ACL has an implicit deny at the end for any traffic that is not explicitly permitted »'
  },
  ciscoRouterOnStick: {
    title: 'Configure Inter VLAN Routing with the Use of an External Router',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/lan-switching/inter-vlan-routing/14976-50.html',
    section: 'Routeur sur un bâton : port du switch en trunk 802.1Q, une sous-interface par VLAN (encapsulation dot1Q n, adresse IP), la passerelle de chaque poste est la sous-interface de son VLAN ; « the native VLAN must be configured the same on each side of the trunk link »'
  },
  ciscoC9300Svi: {
    title: 'Configuring Interface Characteristics (Interface and Hardware Components Configuration Guide, Cisco IOS XE Cupertino 17.9.x, Catalyst 9300)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-9/configuration_guide/int_hw/b_179_int_and_hw_9300_cg/configuring_interface_characteristics.html',
    section: '« A switch virtual interface (SVI) represents a VLAN of switch ports as one interface to the routing function in the system » ; une SVI sert à router entre VLAN ou à joindre le switch en IP'
  },
  ciscoInterVlanL3: {
    title: 'Configure Inter-VLAN Routing with Catalyst Switches',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/lan-switching/inter-vlan-routing/41260-189.html',
    section: '« make sure that ip routing is enabled globally » ; « Each server and host device must have its default gateway configured to the corresponding VLAN interface IP address »'
  },
  ciscoC1000: {
    title: 'Cisco Catalyst 1000 Series Switches Data Sheet',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-1000-series-switches/nb-06-cat1k-ser-switch-ds-cte-en.html',
    section: 'Tableau 1 « Switch configurations » : C1000-24FP-4X-L 24 ports 10/100/1000 PoE+ et 4 SFP+, budget PoE 370 W, 17,48 × 13,59 × 1,73 in (444 × 345 × 44 mm), 4,6 kg ; C1000-48FP-4X-L 48 ports PoE+ et 4 SFP+, 740 W, 17,48 × 13,78 × 1,73 in (350 mm), 5,82 kg ; « IEEE 802.3af PoE and IEEE 802.3at PoE+ (up to 30W per port) » ; tableau 2 : consommation à 100 % de trafic 36,0 W (24 ports) et 62,26 W (48 ports) sans appareil PoE, 4094 numéros de VLAN, RSTP/MSTP, LACP 802.3ad. Pas de nombre de U dans la fiche : 1,73 in = 1U (déduit)'
  },
  ciscoC1300: {
    title: 'Cisco Catalyst 1300 and 1300X Series Switches Data Sheet',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-1300-series-switches/nb-06-cat1300-ser-data-sheet-cte-en.html',
    section: 'Tableau 1, C1300-24XS : « 20 x 10G SFP+ + 4 x 10G copper/SFP+ combo + 1 x GE OOB management », 444,3 × 286 × 43,94 mm, 4,15 kg, 49,02 à 49,46 W ; niveau 3 : routage IPv4, jusqu’à 7168 routes et 256 interfaces IP (modèles 10G), interface de niveau 3 sur port, agrégat ou VLAN, serveur DHCP, relais DHCP ; LACP 802.3ad : 8 groupes, 8 ports actifs par groupe'
  },
  ciscoIsr1000: {
    title: 'Cisco 1000 Series Integrated Services Routers Data Sheet',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/products/collateral/routers/1000-series-integrated-services-routers-isr/datasheet-c78-739512.html',
    section: 'C1111-4P : 4 ports de switch GE en LAN, WAN « 1 copper/SFP Ethernet port + 1 copper Ethernet port » ; tableau 21 : 4,45 × 32,26 × 22,94 cm (profondeur 229,4 mm), 1,98 kg, consommation maximale 18 W ; kit de baie ACS-1100-RM-19 ; tableau 41 : NAT dans la licence IP Base, pare-feu par zones dans la licence SEC'
  },
  dellR250: {
    title: 'PowerEdge R250 Rack Server, technical specifications',
    publisher: 'Dell Technologies',
    url: 'https://www.dell.com/en-in/shop/ipovw/poweredge-r250',
    section: 'Caractéristiques techniques : serveur 1U, hauteur 42,8 mm, largeur 482 mm, profondeur 585 mm sans façade (598,64 mm avec), 12,48 kg au plus ; réseau « 2 x 1 GbE LOM » ; alimentation 450 W (Bronze ou Platinum) ou 700 W'
  },
  tplinkMc220l: {
    title: 'MC220L Gigabit SFP Media Converter, specifications (hardware version V5.20)',
    publisher: 'TP-Link (Omada)',
    url: 'https://www.omadanetworks.com/en/business-networking/omada-accessory-media-converter/mc220l/',
    section: 'Page du MC220L V5.20 : « One 1000M SFP port and one 10/100/1000M RJ45 port (Auto MDI/MDIX) », 94,5 × 73,0 × 27,0 mm, consommation maximale 1,7 W, bloc secteur externe, poste de bureau ou châssis MC1400'
  },
  beldenLf15ld24b: {
    title: 'LF15LD24B, 1U 12 Duplex LC (24 Fiber) Loaded Patch Panel, technical data',
    publisher: 'Belden',
    url: 'https://catalog.belden.com/techdata/EN/LF15LD24B_techdata.pdf',
    section: 'Fiche technique (rév. 0.6) : « 12 LC Duplex Adapters (24 Ports) », hauteur 43,2 mm (1U), largeur 482,6 mm, profondeur 370 mm, 4,5 kg avec la cassette d’épissure et les 24 amorces'
  },
  beldenRv6ppf24: {
    title: 'RV6PPF1U24BK-P, REVConnect CAT6+ Flat Patch Panel, 24-port, 1U, technical data',
    publisher: 'Belden',
    url: 'https://catalog.belden.com/techdata/EN/RV6PPF1U24BK-P_techdata.pdf',
    section: 'Fiche technique : 24 ports Cat 6 (« TIA Category 6, ISO Class E »), 1U, hauteur 1,730 in (43,9 mm), profondeur 4 in (101,6 mm), 1,840 lb (0,835 kg)'
  },
  beldenRv6ppf48: {
    title: 'RV6PPF2U48BK-P, REVConnect CAT6+ Flat Patch Panel, 48-port, 2U, technical data',
    publisher: 'Belden',
    url: 'https://catalog.belden.com/techdata/EN/RV6PPF2U48BK-P_techdata.pdf',
    section: 'Fiche technique : 48 ports Cat 6, 2U, hauteur 3,470 in (88,1 mm), profondeur 3,75 in (95,3 mm), 3,083 lb (1,398 kg)'
  },
  leviton41080: {
    title: 'QuickPort Wallplate, Single-Gang, 2-Port (41080-2WP)',
    publisher: 'Leviton',
    url: 'https://www.leviton.com/en/products/41080-2wp',
    section: 'Plastron simple à 2 emplacements, « Compatible with all individual QUICKPORT connectors », plastique à haute résistance aux chocs (dimensions non données sur la page)'
  },
  /* ---------- Réseau, conception professionnelle : fibre optique (src/net/lim/fibre.js, src/net/checks/fibre.js) ---------- */
  // @fibre
  foaLossBudget: {
    title: 'Calculating the Optical Fiber Loss Budget',
    publisher: 'The Fiber Optic Association',
    url: 'https://www.thefoa.org/tech/lossbudg.htm',
    section: 'Norme payante (TIA-568), chiffres lus dans ce guide : « All connectors are allowed 0.75 max per EIA/TIA 568 standard » (perte d’une connexion = paire de connecteurs accouplés), « All splices are allowed 0.3 max » ; multimode 3,5 dB/km à 850 nm et 1,5 à 1300 nm (max.) ; la liaison ne marche que si la perte du câblage tient dans le bilan de puissance (émission - sensibilité) ; « the Link Loss Margin should be greater than approximately 3 dB » ; avec trop peu de perte, « the receiver may overload, so you add an attenuator at the receiver »'
  },
  foaLinkspec: {
    title: 'Specifications For Fiber Optic Networks',
    publisher: 'The Fiber Optic Association',
    url: 'https://www.thefoa.org/tech/Linkspec.htm',
    section: 'Norme payante (IEEE 802.3), distances et pertes maximales du canal lues dans ce tableau : 1000BASE-SX 850 nm OM1 275 m 2,6 dB, OM2 550 m 3,6 dB, OM3 800 m 4,5 dB, OM4 880 m 4,8 dB ; 1000BASE-LX 1300 nm multimode 550 m 2,3 dB ; 10GBASE-S OM3 300 m 2,6 dB ; 10GBASE-L 1310 nm monomode 10 000 m 6,2 dB ; 10GBASE-E 1550 nm 40 000 m 11,0 dB'
  },
  foaSmfTypes: {
    title: 'Optical Fiber Types',
    publisher: 'The Fiber Optic Association',
    url: 'https://www.thefoa.org/tech/smf.htm',
    section: 'Norme payante (TIA), lue dans ce guide : OS1 ou OS2 en extérieur 0,5 dB/km au plus, « For indoor applications, OS1 or OS2 fiber is specified for a maximum attenuation of 1.0 dB/km » ; recommandation UIT-T G.652.C/D : 0,4 dB/km de 1310 à 1625 nm et 0,3 dB/km à 1550 nm'
  },
  flukeOmOsFiber: {
    title: 'OM1, OM2, OM3, OM4, OM5 and OS1, OS2 Fiber (KA-05286)',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/content/om1-om2-om3-om4-and-os1-os2-fiber',
    section: 'Normes payantes (TIA-568.3-D, ISO/IEC 11801, IEEE 802.3), lues dans ce guide. Tableau 1 : bande passante modale (OM3 2000, OM4 et OM5 4700 MHz·km en laser à 850 nm ; 500 MHz·km à 1300 nm pour tous). Tableau 2 : longueur maximale, 1000BASE-SX OM1 275 m, OM2 550 m ; 10GBASE-SR OM1 33 m, OM2 82 m, OM3 300 m, OM4 et OM5 400 m. Tableau 3 : perte maximale du canal, 10GBASE-S OM1 2,4 dB, OM2 2,3 dB, OM3 2,6 dB, OM4 et OM5 2,9 dB. Tableau 4 : affaiblissement OM1 et OM2 3,5 dB/km à 850 nm et 1,5 à 1300 nm, OM3, OM4, OM5 3,0 et 1,5 ; OS1 et OS2 intérieur 1,0 dB/km, extérieur 0,5'
  },
  corningTugOfWar: {
    title: 'Tug-of-war between insertion loss and distance in optical-fiber networks (J. Cline, B. Rhoney, Corning, 2014)',
    publisher: 'Lightwave',
    url: 'https://www.lightwaveonline.com/network-design/high-speed-networks/article/16649733/tug-of-war-between-insertion-loss-and-distance-in-optical-fiber-networks',
    section: 'Norme payante (IEEE 802.3), lue dans cet article : 10GBASE-SR sur OM3, 300 m avec un budget de canal de 2,6 dB ; « the IEEE document assumes a system link containing two connector patch panels », 0,75 dB par paire accouplée (TIA-568-C.3), soit 1,5 dB de connexions ; un canal plus court tolère plus de pertes de connexion (la portée est la longueur où la marge s’annule)'
  },
  cisco1gSfp: {
    title: 'Cisco SFP Modules for Gigabit Ethernet Applications Data Sheet',
    publisher: 'Cisco',
    url: 'https://cisco.com/c/en/us/products/collateral/interfaces-modules/gigabit-ethernet-gbic-sfp-modules/datasheet-c78-366584.html',
    section: 'Tableau 2 : 1000BASE-SX 850 nm (OM1 275 m, OM2 550 m, OM3 et OM4 1000 m) ; 1000BASE-LX/LH 1310 nm, multimode 550 m (note : cordon de conditionnement de mode exigé quelle que soit la longueur), monomode 10 km ; 1000BASE-EX 40 km ; 1000BASE-ZX environ 70 km. Tableau 3 (dBm) : émission SX et LX -9,5 à -3, réception SX -17 à 0, LX -20 à -3 ; EX émission -1 à +3, réception -22 à +1 ; ZX émission 0 à +5, réception -23 à -3. 1000BASE-T : Cat 5 jusqu’à 100 m. Les modules SFP-1G « operate in 10G … ports » et fournissent du 1G'
  },
  cisco10gSfpPlus: {
    title: 'Cisco 10GBASE SFP+ Modules Data Sheet',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/data_sheet_c78-455693.html',
    section: 'Tableau 3 : SFP-10G-SR 850 nm OM1 33 m, OM2 82 m, OM3 300 m, OM4 et OM5 400 m ; SFP-10G-LR 1310 nm 10 km ; ER 1550 nm 40 km ; ZR 80 km (G.652). Tableau 4 (dBm, émission min/max, réception min/max) : SR -7,3/-1,2, -9,9/-1,0 ; LR -8,2/+0,5, -14,4/+0,5 ; ER -4,7/+4,0, -15,8/-1 ; ZR 0/+4,0, -24/-7. Note 4 : ER « Requires 5 dB 1550nm fixed loss attenuator for < 20km ». Tableau 1 : SFP-10G-T-X (RJ45) jusqu’à 30 m en Cat 6A à 10 Gb/s. Le module « plugs into an Ethernet SFP+ port »'
  },
  cisco25gSfp28: {
    title: 'Cisco 25GBASE SFP28 Modules Data Sheet',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/datasheet-c78-736950.html',
    section: 'Tableau 3 : SFP-25G-SR-S 850 nm, OM3 70 m, OM4 et OM5 100 m ; SFP-10/25G-LR-S 1310 nm, 10 km sur G.652. Tableau 4 (dBm) : SR émission -8,4 à +2,4, réception -10,3 à +2,4 ; LR à 25G émission -7,0 à +2,0, réception -13,3 à +2,0. RS-FEC exigé sur le port hôte à 25G'
  },
  ciscoMcpBulletin: {
    title: 'Use of Mode Conditioning Patch Cables in Gigabit Ethernet and 10 Gigabit Ethernet Laser-Based Transmissions (PB530836)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/product_bulletin_c25-530836.html',
    section: 'Cordon de conditionnement de mode (MCP) exigé pour 1000BASE-LX/LH sur multimode FDDI, OM1 et OM2, inséré entre le module et le câblage multimode ; sans lui, taux d’erreurs élevé et coupures du lien ; versions 62,5 µm et 50 µm'
  },
  /* ---------- Réseau, conception professionnelle : site, cheminements, longueurs (src/net/lim/plan.js, src/net/checks/plan.js) ---------- */
  // @plan
  ufc358001: {
    title: 'UFC 3-580-01 Telecommunications Interior Infrastructure Planning and Design (21 Nov 2024)',
    publisher: 'U.S. Department of Defense (WBDG)',
    url: 'https://www.wbdg.org/FFC/DOD/UFC/ufc_3_580_01_2024.pdf',
    section: 'Cahier des charges public qui applique TIA-569 (norme payante, chiffres lus ici) : § 2-3.2.3.1, p. 20-21 : « initial calculated fill ratio of 25 percent », « d. Maximum fill ratio of any cable tray is 50% », « e. Maximum fill depth of any cable tray is 6 inches (150 millimeters) » ; § 2-3.2.3.2, p. 21 : « Use an optimal conduit fill ratio of 40 percent for conduit sizing » ; § 2-3.2.3.3, p. 22 : « Supports must not exceed 20 cables or 50 percent of the fill capacity » ; § 2-3.1.2.2.c, p. 12 : « Serving area must be no larger than 10,000 square feet (929 square meters) » ; § 2-3.1.2.5 : local en plus au-delà de « 295 feet (90 meters) » de câble jusqu’à la prise'
  },
  ufgs271000: {
    title: 'UFGS 27 10 00 Building Telecommunications Cabling System (May 2025)',
    publisher: 'USACE / NAVFAC / AFCEC (WBDG)',
    url: 'https://www.wbdg.org/FFC/DOD/UFGS/UFGS%2027%2010%2000.pdf',
    section: 'Prescriptions publiques qui citent ANSI/TIA-569 et TIA-568 (normes payantes) : § 3.3.1, p. 46 : « No conduit runs must exceed 30 m 100 ft without a pull boxed placed », « Conduit bends must not exceed more than the equivalent of two 90 degree bends or 180 degrees total without the addition of a pull box in accordance with ANSI/TIA-569 » ; § 3.3.4, p. 47 : supports ouverts « on 1.2 m to 1.5 m 4 ft to 5 ft centers », « a maximum of 20 6.4 mm 0.25 in diameter cables » ; § 3.4, p. 48 : « For UTP cable, bend radii must not be less than four times the cable diameter », fibre « not be less than 20 times the diameter during pulling and […] not less than 10 times the diameter after installation » ; § 3.4.2.a-b, p. 48 : mou de « 3 m 10 ft » au local technique et « 300 mm 12 in of cable slack above ceiling » à la prise (exigence du DoD, valeurs par défaut modifiables dans Jollof)'
  },
  servicewireConduitFill: {
    title: 'How Do I Calculate Conduit Fill?',
    publisher: 'Service Wire Co.',
    url: 'https://www.servicewire.com/ServiceWire/Resources/Customer-QA/Conduit-Fill.htm',
    section: 'Page du fabricant de câbles qui cite le NEC (Chapter 9, payant) : « NEC limits conduit fill to 40% for three or more conductors, 31% for two conductors, and 53% for one conductor or cable »'
  },
  umichDG272000: {
    title: 'Design Guideline 272000 Communications Horizontal Cabling (Aug 2024)',
    publisher: 'University of Michigan, AEC',
    url: 'https://umaec.umich.edu/desguide/tech/27/DG272000.pdf',
    section: 'Guide public de conception qui applique TIA-569 : p. 4 : « Size conduits for a maximum of 40 percent fill » ; p. 5 : « The maximum allowable cable tray fill shall not exceed 50 percent of the tray cross-sectional area », « J-hooks shall be spaced a maximum of 5 feet apart »'
  },
  montanaPathways: {
    title: 'Wiring Guidelines: Horizontal Cabling Support Structures',
    publisher: 'Montana State University, UIT',
    url: 'https://montana.edu/uit/wiringguidelines/horiz-cabling-support-struct.html',
    section: '§ 4.1 : chemin de câbles dimensionné pour un « maximum calculated fill ratio of 40% to a maximum of 6 inches inside depth » ; § 4.7 : rayon de courbure d’un conduit « at least 6 times the internal diameter » jusqu’à 2 pouces, « at least 10 times » au-delà ; « No section of conduit shall contain more than two 90-degree bends »'
  },
  uhPathways: {
    title: 'Master Specification 27 0528 Pathways for Communications Systems',
    publisher: 'University of Houston, Facilities Planning & Construction',
    url: 'https://uh.edu/facilities-planning-construction/vendor-resources/owners-design-criteria/master-specs/pdf/27-05-28-pathways.pdf',
    section: '§ 3.1.F, p. 5 : « Conduit runs shall not exceed 100 feet or have more than two 90-degree bends » ; § 3.1.G, p. 5 : rayon de courbure « Internal diameter of less than 2 inches – 6 times the internal diameter », « Internal diameter of 2 inches or more – 10 times the internal diameter »'
  },
  foaBendRadius: {
    title: 'Bend Radius of Fiber Optic Cables',
    publisher: 'The Fiber Optic Association',
    url: 'https://thefoa.org/tech/ref/install/bend_radius.html',
    section: 'Rayon de courbure d’un câble optique : « 20 times the diameter of the cable » sous traction, « 10 times the cable diameter » au repos (certains câbles sont donnés pour 15 fois)'
  },
  dtechEn50174: {
    title: 'BS EN 50174-2 segregation of data and power cables',
    publisher: 'DTECH Cables',
    url: 'https://dtechcables.com/bs-en-50174-2/',
    section: 'Tableau de ségrégation de BS EN 50174-2:2018 (norme payante, chiffres lus ici) : classes d / c / b / a, sans cheminement 10 / 50 / 100 / 300 mm, métallique ouvert 8 / 38 / 75 / 225 mm, perforé 5 / 25 / 50 / 150 mm, plein 0 mm ; facteur P selon le nombre de circuits « 1-3 0.2 | 4-6 0.4 | 7-9 0.6 | 10-12 0.8 | 13-15 1.0 | 16-30 2 | 31-45 3 | 46-60 4 | 61-75 5 | Over 75 6 », séparation = S × P ; « Circuits are counted as 20 A, 230 V single-phase circuits » ; « Most U/UTP cable is class b, and screened Cat5e, Cat6 and Cat6A cables are typically class c »'
  },
  commscopePowerSep: {
    title: 'Power Separation Guidelines for SYSTIMAX Installations (TP-106296, Jul 2020)',
    publisher: 'CommScope',
    url: 'https://www.commscope.com/globalassets/digizuite/3164-power-separation-guidelines-tp-106296-en.pdf',
    section: '§ 4.0, tableau 4, p. 8 (EN 50174-2:2009) : « the minimum separation requirement "A" is calculated by multiplying the minimum separation "S" by the power cabling factor "P" » ; lignes « 1 to 3 20 10 » et « > 75 600 300 » (circuits 230 V 20 A, classes b et c), cohérentes avec S = 100 mm (b) et 50 mm (c) sans cheminement'
  },
  umichDG54: {
    title: 'Design Guideline 5.4 Telecommunications Rooms (Nov 2016)',
    publisher: 'University of Michigan, AEC',
    url: 'https://umaec.umich.edu/desguide/5.0-SBA/SBA5.4.pdf',
    section: 'p. 1 : « Provide a minimum of one TR per floor. Provide additional TRs to ensure: • One TR for every 10,000 square feet of floor area being served » ; la distance de câble jusqu’à la prise la plus lointaine ne dépasse pas « 295\' » (90 m, d’après TIA-569, norme payante)'
  },
  belden1583A: {
    title: '1583A Category 5e U/UTP CMR cable, technical data',
    publisher: 'Belden',
    url: 'https://catalog.belden.com/techdata/EN/1583A_techdata.pdf',
    section: 'p. 1 : « Overall Cable Diameter (Nominal): 0.190 in (4.83 mm) » ; rayon de courbure « Stationary Min. 1.0 in (25 mm) / Installation Min. 2.0 in (51 mm) »'
  },
  belden2412: {
    title: '2412 Category 6+ U/UTP cable, technical data',
    publisher: 'Belden',
    url: 'https://catalog.belden.com/techdata/EN/2412_techdata.pdf',
    section: 'p. 1 : « Overall Cable Diameter (Nominal): 0.224 in (5.69 mm) » ; rayon de courbure 1.0 in (25 mm) au repos, 2.25 in (57.2 mm) à la pose'
  },
  belden10GXS12: {
    title: '10GXS12 Category 6A U/UTP cable, technical data',
    publisher: 'Belden',
    url: 'https://catalog.belden.com/techdata/EN/10GXS12_techdata.pdf',
    section: 'p. 1 : « Overall Cable Diameter (Nominal): 0.275 in (6.99 mm) » ; rayon de courbure 1.25 in (31.8 mm) au repos, 2.75 in (69.9 mm) à la pose'
  },
  corningMic12: {
    title: 'MIC® Tight-Buffered Cable, Plenum, 12 F, OM4 (012T88-33190-29)',
    publisher: 'Corning',
    url: 'https://ecatalog.corning.com/optical-communications/US/en/Products/Fiber-Optic-Cables/Tight-Buffered/MIC%C2%AE-Tight-Buffered-Cable%2C-Plenum/p/012T88-33190-29',
    section: 'Fiche produit : « Nominal Outer Diameter 6 mm (0.24 in) » ; rayon de courbure « Installation 92 mm », « Operation 60 mm »'
  },
  /* ---------- Réseau, conception professionnelle : Wi-Fi (src/net/lim/wifi.js, src/net/checks/wifi.js) ---------- */
  // @wifi
  nyu675: {
    title: 'Comprehensive FR3 and FR1(C) Upper Mid-Band Propagation and Material Penetration Loss Measurements and Channel Models in Indoor Environment for 5G and 6G (Shakya, Rappaport et al., TechRxiv 2024, CC-BY 4.0)',
    publisher: 'NYU WIRELESS',
    url: 'https://wireless.engineering.nyu.edu/wp-content/uploads/2024/06/Comprehensive-FR3-and-FR1C-upper-mid-band-propagation-and-material-penetration-loss-measurements-and-channel-models-in-Indoor-environment-for-5G-and-6G.pdf',
    section: 'Prépublication non relue par les pairs. § V, éq. (3) : modèle CI, PL = FSPL(f, 1 m) + 10 n log10 d ; tableau V, bureaux à 6,75 GHz (11 à 97 m) : exposant omnidirectionnel n = 1,40 en vue directe et 2,42 sans visibilité (σ 7,87 dB). Sert ici à recouper le N = 23,9 de l’UIT-R P.1238-13 à 6 GHz.'
  },
  ecc2001: {
    title: 'ECC Decision (20)01 on the harmonised use of the frequency band 5945-6425 MHz for WAS/RLAN (amended 8 November 2024)',
    publisher: 'CEPT ECC',
    url: 'https://docdb.cept.org/download/4576',
    section: 'Document Word. Annexe 1, tableau 1 (Low Power Indoor, LPI) : bande 5945-6425 MHz, usage en intérieur seulement, PIRE moyenne maximale 23 dBm, densité de PIRE maximale 10 dBm/MHz ; tableau 2 (VLP) : 14 dBm et 1 dBm/MHz, intérieur et extérieur.'
  },
  fcc15407: {
    title: '47 CFR § 15.407 General technical requirements (U-NII devices)',
    publisher: 'U.S. Code of Federal Regulations (Legal Information Institute)',
    url: 'https://www.law.cornell.edu/cfr/text/47/15.407',
    section: '§ 15.407(a)(5) : point d’accès d’intérieur dans la bande 5,925-7,125 GHz, densité de puissance au plus 5 dBm de PIRE par MHz, PIRE maximale 30 dBm ; (d)(3) : usage limité à l’intérieur ; (a)(10) : antenne intégrée.'
  },
  zebra6ghzChannels: {
    title: '6 GHz Best Practices for Cisco WLAN — List of Channels',
    publisher: 'Zebra Technologies',
    url: 'https://docs.zebra.com/us/en/mobile-computers/software/bm-6ghz-for-cisco-wlan-best-practices-guide-ditamap/c-6ghz-channel-and-regulatory-information/r-6ghz-list-of-channels.html',
    section: '« The 6 GHz band covers 1200 MHz from 5.925 GHz to 7.125 GHz » : 59 canaux de 20 MHz, 29 de 40, 14 de 80, 7 de 160, numérotés de 1 à 233 ; 15 canaux de balayage préférés (PSC) : 5 (5975 MHz), 21 (6055), 37 (6135), 53, 69, 85, 101, 117, 133, 149, 165, 181, 197, 213, 229 (7095 MHz), soit centre = 5950 + 5 × canal. IEEE 802.11ax payante : numérotation lue dans ce guide.'
  },
  ui6Enterprise: {
    title: 'U6 Enterprise — Tech Specs',
    publisher: 'Ubiquiti',
    url: 'https://techspecs.ui.com/unifi/wifi/u6-enterprise?s=eu',
    section: 'Wi-Fi 6E ; alimentation PoE+ (802.3at), consommation maximale 22 W ; port 1/2,5 GbE ; puissance d’émission maximale 2,4 GHz 22 dBm, 5 GHz 26 dBm, 6 GHz 26 dBm ; gain d’antenne 2,4 GHz 3,2 dBi, 5 GHz 5,3 dBi, 6 GHz 6 dBi ; largeurs « HT 20/40, VHT 20/40/80/160, HE 20/40/80/160 (MHz) » ; pose au plafond ou au mur.'
  },
  itu1238_13: {
    title: 'Recommendation ITU-R P.1238-13 (09/2025) Propagation data and prediction methods for the planning of indoor radiocommunication systems',
    publisher: 'UIT-R',
    url: 'https://www.itu.int/dms_pubrec/itu-r/rec/p/R-REC-P.1238-13-202509-I!!PDF-E.pdf',
    section: '§ 3.1, éq. (1) et tableau 2 (modèle général, Lb = 10α log10 d + β + 10γ log10 f) : bureaux sans visibilité directe α = 2,39 (β 30,13, γ 2,40, σ 5,01 dB) de 0,3 à 255 GHz et de 4 à 30 m, d’où N = 10α = 23,9 à 6 GHz. § 3.2, éq. (2) : Ltotal = L(do) + N log10(d/do) + Lf(n), L(do) = 20 log10 f − 28 (f en MHz, do = 1 m, d > 1 m) ; « les coefficients de perte en fonction de la distance comprennent une part implicite pour la traversée des murs » ; les modèles propres au site peuvent compter chaque mur à la place. Tableau 5 (facteur de plancher Lf, n = 1) : 2,4 GHz bureaux 14 dB, logement 10 dB (appartement) ; 5,2 GHz bureaux 16 dB, logement 13 dB (appartement) ; 5,8 GHz bureaux 22 dB (1 étage), 28 dB (2 étages) ; aucune valeur à 6 GHz. « For the various frequency bands where the power loss coefficient is not stated for residential buildings, the value given for office buildings could be used. » Conclusions générales : trajets en vue directe et grandes salles ouvertes N ≈ 20, trajets à travers des murs jusqu’à N ≈ 40.'
  },
  itu1238_10: {
    title: 'Recommendation ITU-R P.1238-10 (08/2019) Propagation data and prediction methods for the planning of indoor radiocommunication systems',
    publisher: 'UIT-R',
    url: 'https://www.itu.int/dms_pubrec/itu-r/rec/p/R-REC-P.1238-10-201908-S!!PDF-E.pdf',
    section: 'Version antérieure (remplacée), seule à donner N aux fréquences du Wi-Fi : § 3.1, éq. (1), tableau 2 (coefficients de perte N) : 2,4 GHz logement 28, bureaux 30 ; 5,2 GHz logement 30 (appartement) et 28 (maison), bureaux 31 ; 5,8 GHz bureaux 24.'
  },
  itu2040_4: {
    title: 'Recommendation ITU-R P.2040-4 (09/2025) Effects of building materials and structures on radiowave propagation above about 100 MHz',
    publisher: 'UIT-R',
    url: 'https://www.itu.int/dms_pubrec/itu-r/rec/p/R-REC-P.2040-4-202509-I!!PDF-E.pdf',
    section: '§ 3, tableau 3 (ε′ = a f^b, σ = c f^d, f en GHz) : béton a 5,24 c 0,0462 d 0,7822 ; brique 3,91 / 0,0238 / 0,16 ; plaque de plâtre 2,73 / 0,0085 / 0,9395 ; bois 1,99 / 0,0047 / 1,0718 ; verre 6,31 / 0,0036 / 1,3394 ; dalle de plafond 1,48 / 0,0011 / 1,075 ; aggloméré 2,58 / 0,0217 / 0,78 ; contreplaqué 2,71 / 0,33 / 0 ; marbre 7,074 / 0,0055 / 0,9262 ; métal 1 / 10⁷ / 0. Éq. (59) ε″ = 17,98 σ/f ; éq. (37a) coefficient de réflexion air → matériau ; § 2.2.2.2 éq. (43b) et (44) : transmission d’une dalle d’une seule couche.'
  },
  ciscoVowlanEmob30: {
    title: 'Enterprise Mobility 3.0 Design Guide — VoWLAN Design Recommendations',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/en/US/docs/solutions/Enterprise/Mobility/emob30dg/Voice.html',
    section: 'Cell Edge Design : « a design with a minimum power of -67 dBm on the cell boundary » ; « Achieving a packet error of one percent also requires an SNR value of 25 dB or more ». Channels in the 5 GHz Band : « 2.4 GHz has only three non-overlapping channels » (Ch1, Ch6, Ch11 sur la figure des interférences). Norme IEEE 802.11 payante : valeurs de conception lues dans ce guide.'
  },
  ciscoVowlanSurvey: {
    title: 'Voice over WLAN Troubleshooting — Site Survey and RF Design Validation',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/en/US/docs/wireless/technology/vowlan/troubleshooting/8_Site_Survey_RF_Design_Valid.html',
    section: 'RF Design Validation : « The optimal VoWLAN Cell Edge recommendation is -67 dBm » (point 1) ; « The Noise floor should not exceed -92 dBm, which facilitates a Signal to Noise Ratio of 25 dB » (point 4) ; la validation du site mesure la couverture de chaque point d’accès posé.'
  },
  extremeCca: {
    title: 'What is a Clear Channel Assessment (CCA)?',
    publisher: 'Extreme Networks',
    url: 'https://www.extremenetworks.com/resources/blogs/what-is-a-clear-channel-assessment-cca',
    section: '« The signal detect (SD) threshold is statistically around 4 dB signal-to-noise ratio (SNR) », soit un signal environ 4 dB au-dessus du bruit ; seuils donnés pour un canal de 20 MHz. Une radio qui entend une autre sur son canal attend qu’elle ait fini (contention).'
  },
  tplinkChannelFaq: {
    title: 'Brief introduction of Wireless Channel, Channel Width and DFS',
    publisher: 'TP-Link',
    url: 'https://www.tp-link.com/us/support/faq/4309/',
    section: '2,4 GHz : « For channels 1 through 13, the channel interval is 5 MHz, but the width of each channel is 22 MHz » ; États-Unis canaux 1 à 11, la plupart des autres pays 1 à 13 ; « channels 1, 6, and 11, which are three channels that do not interfere with each other ». Tableau 5 GHz : canaux 36–48 U-NII-1 (Europe : Indoors), 52–64 U-NII-2A (DFS), 100–144 U-NII-2C (DFS ; 144 interdit en Europe), 149–165 U-NII-3 (interdits en Europe) ; index HT40 38, 46, 54, 62, 102, 110, 118, 126, 134, 142, 151, 159, VHT80 42, 58, 106, 122, 138, 155, VHT160 50 et 114 ; « wider channels … are more susceptible to interference ».'
  },
  merakiChannelPlanning: {
    title: 'Channel Planning Best Practices',
    publisher: 'Cisco Meraki',
    url: 'https://documentation.meraki.com/Wireless/Design_and_Configure/Architecture_and_Best_Practices/Channel_Planning_Best_Practices',
    section: '2,4 GHz : « three non-overlapping channels 1, 6 and 11 » ; 5 GHz : UNII-1 36, 40, 44, 48 ; UNII-2 52…64 et 100…140 (DFS obligatoire) ; UNII-3 149, 153, 157, 161 ; « APs with overlapping coverage cells should not be on the same channel, if possible » (interférence co-canal).'
  },
  merakiChannelBonding: {
    title: 'Channel Bonding',
    publisher: 'Cisco Meraki',
    url: 'https://documentation.meraki.com/Wireless/Operate_and_Maintain/User_Guides/Radio_Settings/Channel_Bonding',
    section: '40 MHz à 5 GHz : deux canaux de 20 MHz contigus (36+/40−, 44+/48−, … ; tableau des canaux par sous-bande) ; « channel bonding … will also result in fewer 5GHz channels » ; en forte densité, des canaux de 20 MHz font mieux ; à 2,4 GHz, « Channel bonding limits the 2.4GHz band to a 40MHz-wide single non-overlapping channel ».'
  },
  tplinkEap225Radio: {
    title: 'EAP225 V4.20 Datasheet (radio)',
    publisher: 'TP-Link',
    url: 'https://static.tp-link.com/upload/product-overview/2026/202603/20260305/Datasheet_EAP225%204.20.pdf',
    section: 'Antennes internes omnidirectionnelles : 2,4 GHz 4 dBi, 5 GHz 5 dBi ; largeurs 2,4 GHz 20/40 MHz, 5 GHz 20/40/80 MHz ; puissance maximale CE (PIRE) 2,4 GHz 20 dBm, 5 GHz 23 dBm (U-NII-1 et 2A), 27 dBm (U-NII-2C) ; FCC (conduite) 2,4 GHz 24 dBm, 5 GHz 22 dBm ; réglable par pas de 1 dB ; alimentation 802.3af ; pose au plafond ou au mur.'
  },
  tplinkEap670: {
    title: 'EAP670 Datasheet (AX5400 Ceiling Mount Wi-Fi 6 Access Point)',
    publisher: 'TP-Link',
    url: 'https://static.tp-link.com/upload/product-overview/2025/202512/20251230/DATASHEET_EAP670.pdf',
    section: 'Wi-Fi 6 (802.11ax), port Ethernet 2,5 Gb/s ; alimentation 802.3at PoE (V2 : 20,8 W UE, 22,3 W US au plus) ; antennes 2,4 GHz 4 dBi, 5 GHz 5 dBi ; puissance CE (PIRE) < 20 dBm à 2,4 GHz, < 23 dBm à 5 GHz bandes 1 et 2, < 30 dBm bande 3 ; FCC < 25 dBm (2,4 GHz), < 28 dBm (5 GHz) ; sensibilités données jusqu’à 40 MHz (2,4 GHz) et 160 MHz (5 GHz) ; pose au plafond ou au mur.'
  },
  /* ---------- Réseau, conception professionnelle : baies (src/net/lim/rack.js, src/net/checks/rack.js) ---------- */
  // @rack
  // Baies (lu en novembre 2026). EIA-310 et la norme de câblage des baies sont payantes : la géométrie est lue chez un
  // fabricant qui la cite ; chaque équipement a sa fiche (dimensions, poids, consommation).
  sanwaEia: {
    title: 'サーバーラック EIA規格について (Server racks: about the EIA standard)',
    publisher: 'Sanwa Supply',
    url: 'https://www.sanwa.co.jp/product/desk_rack/server/server_select_eia.html',
    section: 'Norme EIA (EIA-310, payante, non lue directement ; chiffres lus chez le fabricant) : « 高さは1.75インチ(44.45mm)の倍数 » (hauteur en multiples de 1,75 pouce = 44,45 mm, soit 1U) ; « 機器の幅は19インチ(482.6mm) » (largeur des équipements 19 pouces = 482,6 mm) ; la page précise que la profondeur des équipements n’est pas normalisée.'
  },
  nistSp811B9: {
    title: 'NIST Guide to the SI, Appendix B.9: Factors for units listed by kind of quantity or field of science',
    publisher: 'NIST (Special Publication 811)',
    url: 'https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b9',
    section: 'Section « Heat flow rate » : « British thermal unitIT per hour (BtuIT/h) » → watt (W) : 2.930 711 E-01, soit 1 W = 3,412 BTU/h.'
  },
  uiRack42u1000: {
    title: '42U Rack (UACC-Rack-42U-1000-P) — Tech Specs',
    publisher: 'Ubiquiti',
    url: 'https://techspecs.ui.com/unifi/accessories/uacc-rack-42u-1000-p',
    section: 'U Height « 42U » ; dimensions sans roulettes « 600 x 1,000 x 1,966 mm » ; profondeur de montage « Default 652.3 mm », « Max. 877.3 mm » (pas de réglage 15 mm) ; capacité « Static 800 kg (1764 lb) », « Rolling 320 kg » ; poids de la baie 84,2 kg ; normes « CE; EIA/ECA-310-E; RoHS ».'
  },
  uiRack12uWall450: {
    title: '12U Wall-Mount Rack (UACC-Rack-12U-Wall-450-G) — Tech Specs',
    publisher: 'Ubiquiti',
    url: 'https://techspecs.ui.com/unifi/accessories/uacc-rack-12u-wall-450-g',
    section: '« 12U » ; baie « 550 x 450 x 635 mm » ; profondeur de montage « Default 283 mm » « Max. 305 mm » ; « Maximum weight capacity 50 kg » ; poids 19 kg ; normes « CE; EIA/ECA-310-E; RoHS ».'
  },
  uiUnasPro: {
    title: 'UNAS Pro — Tech Specs',
    publisher: 'Ubiquiti',
    url: 'https://techspecs.ui.com/unifi/integrations/unas-pro',
    section: '« Rack mount (2U) » ; « 442.4 x 325 x 87.4 mm » ; « With mounting brackets: 9.5 kg » ; « Max. power consumption 160W » (dont 135 W pour les disques) ; 7 baies, 1 SFP+ 10G et 1 RJ45 1G.'
  },
  tplinkSg1008pDims: {
    title: 'TL-SG1008P V6 Datasheet (dimensions et consommation)',
    publisher: 'TP-Link',
    url: 'https://static.tp-link.com/upload/product-overview/2021/202108/20210827/TL-SG1008P%206.0%20Datasheet.pdf',
    section: 'p. 2 : « Max Power Consumption 11.52 W (220V/50Hz. no PD connected) 73.74 W (220V/50Hz. with 64W PD connected) » ; « Max Heat Dissipation 39.30 BTU/h (no PD connected) » ; « Dimensions 6.7x3.9x1.1in. (171x98x27mm) » ; switch de bureau ou mural.'
  },
  uiPatchBlank24: {
    title: '24-Port Blank Keystone Patch Panel (UACC-Rack-Panel-Patch-Blank-24) — Tech Specs',
    publisher: 'Ubiquiti',
    url: 'https://techspecs.ui.com/unifi/accessories/uacc-rack-panel-patch-blank-24',
    section: 'Insert « 442.4 x 63.5 x 43.7 mm », « 260 g » ; barre de gestion « 433.8 x 71.5 x 17 mm », « 390 g » ; panneau 1U 24 ports keystone.'
  },
  trippSrcablering1u: {
    title: 'SmartRack 1U Horizontal Cable Manager (SRCABLERING1U) — Specifications',
    publisher: 'Eaton Tripp Lite',
    url: 'https://assets.tripplite.com/product-pdfs/en/srcablering1u.pdf',
    section: 'p. 1-2 : passe-câbles horizontal 1U 19 pouces à anneaux ; « Unit Dimensions (hwd / in.) 1.700 x 19.000 x 3.800 » ; « Unit Weight (kg) 0.34 ».'
  },
  trippSrshelf2p1u: {
    title: 'SmartRack 1U Cantilever Fixed Shelf (SRSHELF2P1U) — Specifications',
    publisher: 'Eaton Tripp Lite',
    url: 'https://assets.tripplite.com/product-pdfs/en/srshelf2p1u.pdf',
    section: 'p. 1-2 : « Supports up to 40 lbs (18.1 kgs) » ; « Unit Dimensions (hwd / in.) 1.730 x 19.000 x 12.050 » ; « Unit Weight (kg) 1.59 ».'
  },
  uiRackPanelOcd: {
    title: 'Rack Mount OCD Panels (UACC-Rack-Panel-Blank-1U) — Tech Specs',
    publisher: 'Ubiquiti',
    url: 'https://techspecs.ui.com/unifi/accessories/uacc-rack-panel-ocd',
    section: 'UACC-Rack-Panel-Blank-1U : « 442.4 x 63.5 x 43.7 mm », « 250g », acier laminé à froid (SPCC).'
  },
  pulsarRawp1r: {
    title: 'RAWP-1R 4-fan panel with the RACK 1U thermostat — data sheet v1.1',
    publisher: 'Pulsar',
    url: 'https://lib.pulsar.pl/karta/en/RAWP-1R.pdf',
    section: '« Power supply: ~ 230 V; 50 Hz », « Current consumption: 0,32 A », « Power consumption: 76 W », « External dimensions: W=482, H=44, D=314 [mm] », « Net/gross weight: 4,90 / 5,09 [kg] ».'
  },
  trippPdumv20hv: {
    title: 'PDUMV20HV 3.7kW Single-Phase Local Metered PDU — Specifications',
    publisher: 'Eaton Tripp Lite',
    url: 'https://assets.tripplite.com/product-pdfs/en/pdumv20hv.pdf',
    section: 'PDU verticale 0U, « Maximum Input Amps 16 » (« Agency de-rated to 16A continuous ») ; « 3.68kW (230V) … / 16A total capacity » ; « 38 total outlets (6 C19, 32 C13) » ; « Unit Weight (kg) 2.36 ».'
  },
  trippPdu1230: {
    title: 'PDU1230 5.8kW 200-240V Single-Phase Basic PDU — Specifications',
    publisher: 'Eaton Tripp Lite',
    url: 'https://assets.tripplite.com/product-pdfs/en/pdu1230.pdf',
    section: 'PDU 1U : « 20 total outlets » (16 C13, 4 C19) ; « Maximum Input Amps 24 » (déclassée à 24 A en continu) ; « 5.5kW (230V) » ; « Unit Dimensions (hwd / cm) 4.5 x 44.5 x 13.2 » ; « Unit Weight (kg) 3.40 ».'
  },
  eaton5pxG2Brochure: {
    title: 'Eaton 5PX G2 UPS 1–3 kVA — product brochure BR153153EN (May 2022)',
    publisher: 'Eaton',
    url: 'https://www.farnell.com/datasheets/3744653.pdf',
    section: 'p. 2 : facteur de puissance unitaire (W = VA) ; p. 4, « 5PX G2 model selection guide », modèles 208/230 V : 5PX1500HRTG2 1500/1500, 2U, 17.2 x 17.6 in, 49.4 lb, autonomie interne 5/14 min (pleine / demi-charge), avec 1 EBM 25/57 ; 5PX3000HRTG2 3000/3000, 2U, 17.2 x 23.7 in, 69.9 lb, 3/9 min, avec 1 EBM 17/41 ; modules 5PXEBM48RTG2 (2U, 17.6 in, 61.3 lb) et 5PXEBM72RTG2 (2U, 23.7 in, 89.1 lb).'
  },
  trippCoolingWp: {
    title: 'Increase Rack Cooling Efficiency and Solve Heat-Related Problems (white paper)',
    publisher: 'Tripp Lite',
    url: 'https://assets.tripplite.com/white-paper/increase-rack-cooling-efficiency-and-solve-heat-related-problems-white-paper-230v-en.pdf',
    section: 'p. 13 : « Use blanking panels to fill unused rack spaces. This is not a cosmetic procedure – it forces cold air through your equipment and prevents hot air from recirculating through open spaces » ; « Inside enclosures, use horizontal and vertical cable managers to organize patch cables and power cords ». Bonnes pratiques d’un fabricant (pas une norme).'
  },
  /* ---------- Réseau, conception professionnelle : certification (src/net/lim/cert.js, src/net/checks/cert.js) ---------- */
  // @cert
  anixterTia568c2: {
    title: 'Standards Reference Guide, section 14 « ANSI/TIA-568-C.2 Standard » (Technical Information)',
    publisher: 'Anixter',
    url: 'https://corpapps.anixter.com/doclib1/61vkiffo/$file/sec_14.pdf?openelement=',
    section: 'Guide d’un distributeur qui recopie les tableaux de limites d’ANSI/TIA-568-C.2 (norme payante, non lue directement ; l’édition 568.2-D en vigueur n’a pas pu être comparée), lu par extraction du texte du PDF, pages 14.10 à 14.15 : figures 11 et 12 (canal : prise, point de consolidation, 90 m, deux panneaux et 10 m de cordons ; lien permanent : prise, point de consolidation, un panneau) ; tableaux 7 à 13 du canal (réflexion, affaiblissement, NEXT, PSNEXT, ACRF, PSACRF, délai) et 17 à 23 du lien permanent, colonnes Cat 3, Cat 5e, Cat 6, Cat 6A, aux fréquences 1, 4, 8, 10, 16, 20, 25, 31,25, 62,5, 100, 200, 250, 300, 400 et 500 MHz (ex. lien permanent Cat 6A à 500 MHz : affaiblissement 43,8, NEXT 26,7, PSNEXT 23,8, ACRF 10,2, PSACRF 7,2, réflexion 8,0 dB ; lien permanent Cat 5e à 100 MHz : 21,0 / 32,3 / 29,3 / 18,6 / 15,6 / 12,0 dB) ; délai du lien permanent 498 ns à 10 MHz, décalage < 44 ns ; tableau 27 : affaiblissement du câble horizontal par 100 m. Entre deux fréquences du tableau, nos limites sont interpolées.'
  },
  ieee8023anD22: {
    title: 'IEEE P802.3an Draft 2.2, clause 55.7 — 10GBASE-T link segment characteristics',
    publisher: 'IEEE 802.3an Task Force',
    url: 'https://www.ieee802.org/3/minutes/jul05/0705_clause55-link.pdf',
    section: 'Projet de norme public (la norme IEEE 802.3 et les normes de câblage TIA-568 / ISO/IEC 11801 sont payantes), lu par extraction du texte du PDF : 55.7.2 les paramètres sont ceux de la classe E d’ISO/IEC 11801 prolongés à 500 MHz ; 55.7.2.1 affaiblissement ≤ 1,05·(1,82√f + 0,0169f + 0,25/√f) + 4·0,02√f dB ; 55.7.2.3 réflexion 19 dB (1–10 MHz), 24 − 5 log f (10–40), 32 − 10 log f (40–400), 6 dB (400–500) ; 55.7.2.4.1 NEXT ≥ −20 log(10^(−(74,3 − 15 log f)/20) + 2·10^(−(94 − 20 log f)/20)) de 1 à 330 MHz puis 31 − 50 log(f/330) jusqu’à 500 MHz, un calcul au-dessus de 65 dB revient à 65 dB ; 55.7.2.4.2 somme de puissance : mêmes formes avec 72,3 et 90 puis 28 − 42 log(f/330), plafond 62 dB ; 55.7.2.4.4 ELFEXT −20 log(10^(−(67,8 − 20 log f)/20) + 4·10^(−(83,1 − 20 log f)/20)), le terme du câble s’améliore de −10 log(L/100) pour une longueur L ; MDELFEXT 64,8 et 80,1 ; 55.7.2.5 délai ≤ 570 ns ; 55.7.2.6 décalage ≤ 50 ns.'
  },
  adriaenssensChannelIL: {
    title: 'A closer look at Channel Insertion Loss (IEEE 802.3an 10GBASE-T Task Force, March 2004)',
    publisher: 'IEEE 802.3an Task Force (L. Adriaenssens, SYSTIMAX Solutions)',
    url: 'https://www.ieee802.org/3/an/public/mar04/adriaenssens_1_0304.pdf',
    section: 'Diapositive « Breaking down the ISO channel loss equation », lue par extraction du texte du PDF : Cat-5 = 1,05·(1,9108√f + 0,0222f + 0,20/√f) + 4·0,04√f ; Cat-6 = 1,05·(1,82√f + 0,0169f + 0,25/√f) + 4·0,02√f (100 m de câble, 4 connecteurs) ; « Cordage may have up to 50% more loss per meter than cable » : 10 m de cordons valent 15 m de câble, d’où le facteur 1,05 ; termes : cuivre (effet de peau, √f), matériau (f), blindage (1/√f).'
  },
  diminico10gbtTables: {
    title: '10GBASE-T Physical Layer Specifications (IEEE 802.3 10GBASE-T Study Group, January 2003)',
    publisher: 'IEEE 802.3 Working Group (C. DiMinico, CDT Corporation)',
    url: 'https://www.ieee802.org/3/10GBT/public/jan03/diminico_1_0103.pdf',
    section: 'Tableaux « Category 5e Channel Transmission Performance » (1 à 100 MHz, classe D) et « Category 6 Channel Transmission Performance » (1 à 250 MHz, classe E) recopiés de TIA/EIA-568-B (payante), lus par extraction du texte du PDF : Cat 5e à 100 MHz affaiblissement 24,0, NEXT 30,1, PSNEXT 27,1, ELFEXT 17,4, PSELFEXT 14,4, réflexion 10 dB ; Cat 6 à 250 MHz 35,9 / 33,1 / 30,2 / 15,3 / 12,3 / 8 dB ; délai 555 ns à 10 MHz, décalage 50 ns. Sert à recouper les limites du canal Cat 5e et Cat 6 du tableau TIA-568-C.2 (anixterTia568c2) : identiques.'
  },
  tsb155D13: {
    title: 'PN-3-0134 (to be published as TSB-155) Draft 1.3 — Additional guidelines for 4-pair 100 Ω Category 6 cabling for 10GBASE-T applications',
    publisher: 'TIA TR-42 (document de travail publié par IEEE 802.3an)',
    url: 'https://www.ieee802.org/3/an/public/feb05/tsb155_d1.3-Feb1.pdf',
    section: 'Projet public de la TIA (TSB-155 définitive payante), lu par extraction du texte du PDF : 5.1 le lien permanent comprend jusqu’à 90 m de câble horizontal, une connexion à chaque bout et un point de consolidation facultatif ; Table 1 réflexion du canal Cat 6 : 19 dB (1–10 MHz), 24 − 5 log f (10–40), 32 − 10 log f (40–400), 6 dB (400–500) ; Table 2 réflexion du lien permanent : 21 + 4 log(f/3) (1–3), 21 (3–10), 26 − 5 log f (10–40), 34 − 10 log f (40–250), 10 − 20 log(f/250) (250–400), 6 dB (400–500) ; 6.7.1 délai maximal 555 ns (canal) et 498 ns (lien permanent) à 10 MHz ; 6.7.2 décalage maximal 50 ns (canal) et 44 ns (lien permanent).'
  },
  commscopeCat6aWp: {
    title: 'Category 6A: The cabling of choice for new installations (white paper)',
    publisher: 'CommScope',
    url: 'https://www.commscope.com/globalassets/digizuite/2164-category-6a-the-cabling-of-choice-for-new-installations-wp-112053-en.pdf',
    section: 'Table 1 « Insertion loss for Category 5e, Category 6, and Category 6A channels (from ANSI/TIA-568-C.2) » (norme payante) : Cat 5e 24,0 dB à 100 MHz ; Cat 6 21,3 dB à 100 MHz et 35,9 dB à 250 MHz ; Cat 6A 20,9 dB à 100 MHz, 33,9 dB à 250 MHz, 49,3 dB à 500 MHz. Recoupe l’affaiblissement du canal du tableau TIA-568-C.2 (anixterTia568c2) : identique.'
  },
  levitonCat6aSds: {
    title: 'EXTREME SST Cat 6A UTP Millennium System — solution data sheet',
    publisher: 'Leviton',
    url: 'https://devpreview.leviton.com/content/dam/leviton/network-solutions/product_documents/system_data_sheets/sds-copper/Leviton-SDS-EXTREME-SST-Cat-6A-Millennium-System.pdf',
    section: 'p. 2, « Guaranteed System Performance Parameters » : marges garanties par rapport à ANSI/TIA-568.2-D, pire cas de 17 à 100 m de canal : affaiblissement 3 %, NEXT 2 dB, PSNEXT 3 dB, ACR-F 8 dB, PSACR-F 8 dB, réflexion 3 dB. Reprises comme marge nominale du modèle de mesure simulée (un système de bonne qualité), pas comme limite.'
  },
  flukeNormalizedIL: {
    title: 'Normalized Insertion Loss - DTX CableAnalyzer',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/knowledge-base/dtx-cableanalyzer/normalized-insertion-loss-dtx-cableanalyzer',
    section: '« The Insertion Loss limit is fixed » dans ANSI/TIA-568-C.2, ISO/IEC 11801, EN 50173 et IEEE 802.3 : la limite ne dépend pas de la longueur du lien ; exemple : lien permanent Cat 6, limite 31,1 dB à 250 MHz (même valeur que le tableau 18 recopié par Anixter), 4,4 dB mesurés sur 12,2 m.'
  },
  flukeMarginalBand: {
    title: 'Marginal Pass/Fail Band - DTX CableAnalyzer',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/content/marginal-passfail-band-dtx-cableanalyzer',
    section: '« If the worst case margin falls within the field tester’s accuracy, it is marked with an asterisk » ; exigence d’ANSI/TIA-1152 et d’IEC 61935-1 ; la largeur de la bande varie avec la fréquence (aucune valeur chiffrée sur la page : la précision du testeur simulé est un réglage).'
  },
  flukeMarginalPasses: {
    title: 'Marginal Passes - DSP 4x00 CableAnalyzer',
    publisher: 'Fluke Networks',
    url: 'https://flukenetworks.com/knowledge-base/dsp-4x00-cableanalyzer/marginal-passes-dsp-4x00-cableanalyzer',
    section: 'Cite ANSI/TIA-1152 §4.2.4 et IEC 61935-1 §5.4.1 (normes payantes) : résultat marqué d’un astérisque quand il est plus proche de la limite que la précision du testeur ; « Any fail or fail* shall result in an overall fail » ; « In order to achieve an overall pass condition, all individual results shall be pass or pass* ».'
  },
  flukePropDelayCase8: {
    title: 'Case Study 8 - Prop. Delay fails on DTX CableAnalyzer due to cable length',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/knowledge-base/dtx-cableanalyzer/case-study-8-prop-delay-fails-dtx-cableanalyzer-due-cable-length',
    section: 'Le critère de longueur est la longueur maximale du lien permanent (90 m) ou du canal (100 m) plus l’incertitude de 10 % sur la NVP admise par ANSI/TIA-1152 : la longueur passe jusqu’à environ 99 m (lien permanent) et 110 m (canal) ; la longueur rapportée est celle de la paire au délai électrique le plus court.'
  },
  flukePropDelay: {
    title: 'Network Cable Propagation Delay - DTX CableAnalyzer',
    publisher: 'Fluke Networks',
    url: 'https://ko.flukenetworks.com/knowledge-base/dtx-cableanalyzer/propagation-delay',
    section: '« Typical propagation delay for category 5e UTP is a bit less than 5 nS per meter (worst case allowed is 5.7 nS/m) » ; délai horizontal maximal 570 ns ; décalage entre paires ≤ 50 ns sur un lien de 100 m au plus ; NVP des câbles entre 0,6 c et 0,9 c.'
  },
  flukeTop10Mistakes: {
    title: 'Top 10 Cable Testing Mistakes to Avoid',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/blog/cabling-chronicles/top-10-cable-testing-mistakes',
    section: 'N° 1 : s’accorder sur la limite de test avant de tester ; n° 2 : « marginal test results for a parameter shall be marked with an asterisk » ; n° 4 : tester le lien permanent plutôt que le canal, « the true foundation of the network » ; n° 6 : les rapports gardent les courbes (« reports without plot data will look empty »). Blog d’un fabricant de testeurs (pas une norme).'
  },
  /* ---------- Réseau, conception professionnelle : dimensionnement, étiquetage (src/net/lim/design.js, src/net/checks/design.js) ---------- */
  // @design
  moFmdcCad: {
    title: 'Computer Aided Design Guidelines and Drawing Submittals (revised 09/2012)',
    publisher: 'State of Missouri, Office of Administration, Facilities Management, Design and Construction',
    url: 'https://oa.mo.gov/sites/default/files/CAD_Guidelines.pdf',
    section: 'Convention de calques publique qui suit les AIA CAD Layer Guidelines (United States National CAD Standard, payante) : § 5.4 E, « FMDC follows AIA CAD Layering Guidelines » ; p. 7, modificateurs communs « *-TEXT Text », « *-IDEN Identification tags », « *-SHBD-TTLB Project Title block » ; p. 8, « A-AREA Area Calculation », « A-WALL Walls » ; p. 21-22, calques des télécommunications (discipline T) : « T-EQPM Equipment », « T-JACK Jacks », « T-CABL Cable system », « T-CABL-FIBR Cable system: fiber optic cable », « T-CABL-TRAY Cable system: cable tray and wireway », « T-DATA Data / LAN system ».'
  },
  iso13567Wiki: {
    title: 'ISO 13567 (article)',
    publisher: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/ISO_13567',
    section: 'Résumé public de la norme ISO 13567 (payante) : champs obligatoires de longueur fixe « Agent responsible » (2 caractères), « Element » (6 caractères, classification CI/SfB ou Uniclass), « Presentation » (2 caractères : E- élément, T- texte, H- hachures, D- cotes), champ facultatif « Status » (1 caractère) ; exemple « A-G25---D-R ».'
  },
  nsTpwCabling: {
    title: 'Structured Cabling Guideline (DC350 Design Requirements Manual), revised 2004',
    publisher: 'Nova Scotia Transportation and Public Works',
    url: 'https://bac-lac.wayback.archive-it.org/web/20061124000350/http:/www.gov.ns.ca/tran/govservices/CableA_Revised04.pdf',
    section: 'Guide public qui applique ANSI/TIA/EIA-568-B et 569-A (normes payantes, chiffres lus ici) : § 3.1.2, p. 5 : « minimum of two (2) balanced twisted-pair, 4-pair cables to be installed to each telecommunications outlet location within work area of 10m² (100ft²) minimum » ; § 3.3.2, p. 11 : chaque poste occupé a au moins une boîte de prise ; § 3.4.2, p. 13 : panneaux de terminaison du local technique de 48 ports au plus, 2 U au plus par panneau ; § 3.1.2, p. 6 : 90 m de lien horizontal, 10 m de cordons. Document archivé (Bibliothèque et Archives Canada).'
  },
  umichDg272000: {
    title: 'Design Guideline 27 20 00, Voice and Data Communications (August 2024)',
    publisher: 'University of Michigan, Architecture, Engineering and Construction',
    url: 'https://umaec.umich.edu/desguide/tech/27/DG272000.pdf',
    section: 'Guide de conception d’une université, qui renvoie à ANSI/TIA/EIA-568-B et 569-A (normes payantes) : p. 4, « If Work Area Outlet locations are not yet known, assume a minimum of one outlet for every 100 square feet of useable floor space » (100 ft² ≈ 9,3 m², arrondi à 10 m²) ; p. 5, prise standard desservie par trois câbles 4 paires et « a minimum of 50 percent spare cable capacity for future use » dans les chemins de câbles ; p. 6, « Provide 20 percent spare cable capacity for future use » (goulottes, conduits sous plancher) ; p. 3, prises à moins de 293 pieds de câble du local technique. La réserve de ports par défaut (20 %) reprend cette marge : valeur de conception modifiable.'
  },
  levitonUtp6r: {
    title: 'UTP6R Cat 6 U/UTP Cables, product specifications (SS1306-EU, revised January 2025)',
    publisher: 'Leviton',
    url: 'https://leviton.com/content/dam/leviton/network-solutions/product_documents/product_specification/emea/Leviton-EMEA-Spec-29x-UTP6R-Cat-6-UUTP-CMR-Cable.pdf',
    section: 'p. 2, Mechanical specifications : « Length per reel 1000 ft (305 m) », 4 paires, Cat 6 U/UTP, diamètre extérieur 0,236 in (6,0 mm) ; p. 1 : conforme à ANSI/TIA-568.2-D Cat 6 et ISO/IEC 11801 classe E.'
  },
  ciscoCampusBp: {
    title: 'Cisco Enterprise Campus Infrastructure Best Practices Guide (2014)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/dam/global/shared/assets/pdf/en-04/cisco_enterprise_campus_infrastructure_design_guide_1.pdf',
    section: 'p. 17, « Campus Network Oversubscription Best Practices » : « The distribution layer should maintain a 20:1 oversubscription ratio in distribution-access networking blocks » ; cœur de campus : « to maintain 4:1 oversubscription ratios ».'
  },
  tia606aCim: {
    title: 'Boiling down the 606-A labeling standard (Cabling Installation & Maintenance, 1 June 2003)',
    publisher: 'Cabling Installation & Maintenance (Endeavor Business Media)',
    url: 'https://www.cablinginstall.com/connectivity/article/16465694/boiling-down-the-606a-labeling-standard',
    section: 'Article de D. Morrison (Panduit) et T. Fries (HellermannTyton) sur ANSI/TIA/EIA-606-A (norme payante) : identifiant du local technique au format FS, « F is the numeric character(s) identifying the floor », « S is the alpha character(s) uniquely identifying the TS on floor F » ; « The horizontal link identifier shall have the FS-AN format », « A is either one or two characters uniquely identifying a single patch panel », « N is two to four numeric characters designating the port on the patch panel » ; « each end of a horizontal cable shall be labeled with the horizontal link identifier » ; classes 1 à 4 (un local, plusieurs locaux d’un bâtiment, campus, plusieurs sites).'
  },
  panduitIdan02: {
    title: 'Data Center Infrastructure Identification Application Guide (IDAN-02, July 2014)',
    publisher: 'Panduit',
    url: 'https://www.panduit.com/content/dam/panduit/en/website/solutions/documents/data-center-id-infrastructure0.pdf',
    section: 'Guide qui reprend TIA-606-B (norme payante) : identifiant du local « floor and room or area designation on that floor » ; baie par sa position (AY15) ; panneau par l’unité de sa vis de fixation haute (AR15-20) ; port « AB04-24:01 », numérotation de gauche à droite et de haut en bas, « a 48-port patch panel should be labeled 01 through 48 » ; câble « AB04-24:01/AB07-36:13 » (extrémité proche/extrémité lointaine), cordon « AB04-24:01\\AB04-36:13 » (barre oblique inverse).'
  }
};
Object.assign(SOURCES, NET_SOURCES);
