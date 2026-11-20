// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Équipements du plan réseau : leurs ports RJ45 (vitesse, Auto-MDIX, PoE), leur rôle (hôte, commutateur, routeur, point
// d'accès, prise passive, service) et leurs réglages par défaut. Les valeurs par défaut des appareils PoE viennent de
// fiches réelles (clés de src/check/sources.js) : caméra AXIS M2035-LE (802.3af classe 3), téléphone Cisco IP Phone
// 7841 (802.3af classe 1), point d'accès TP-Link EAP225 (802.3af, 12,6 W), switch TP-Link TL-SG1008P (4 ports
// PoE+ 802.3af/at, 30 W par port, budget 64 W).
// Les modules Ethernet des cartes (W5500, ENC28J60) et les cartes Wi-Fi du montage ne sont pas posés ici : ils viennent
// du montage électronique (nœuds « externes », voir lan.js) dans un projet Objets connectés.
import { tl, isEn } from '../i18n/index.js';
import { RACK_DEVICES, RACK_GROUPS } from './rackdev.js';
import { cleanManaged } from './vlan.js';

const eth = (id, o = {}) => ({ id, label: o.label || id, speed: o.speed || 1000, mdix: o.mdix || 'auto', poe: o.poe || null, ...o });
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
/** Cage SFP (sfp : 'sfp' 1 Gb/s, 'sfp+' 10 Gb/s) : le lien dépend du module posé (p.sfp, fibre.js). */
const cage = (id, kind, o = {}) => eth(id, { sfp: kind, speed: kind === 'sfp+' ? 10000 : 1000, ...o });
/** Port de panneau passif : avant ↔ arrière (fibre : connecteur LC duplex). */
const pass = (id, other, o = {}) => eth(id, { passive: other, ...o });
/** Nettoyeur des équipements administrables : leurs réglages (vlan.js) et ceux de leur type (PoE, adresse du serveur). */
const managed = (type, extra) => (s, d) => {
  const spec = DEVICES[type], ports = spec.ports(d).map(p => p.id), cages = spec.ports(d).filter(p => p.sfp).map(p => p.id);
  const o = cleanManaged(type, s, d, ports, cages);
  return extra ? extra(s || {}, o) : o;
};
const poeClean = (s, o) => ({ ...o, budget: Math.max(0, Math.min(5000, Number.isFinite(+s.budget) ? +s.budget : o.budget)), pseType: ['af', 'at', 'bt3', 'bt4'].includes(s.pseType) ? s.pseType : o.pseType, portW: Math.max(0, Math.min(100, Number.isFinite(+s.portW) ? +s.portW : o.portW)) });
const stpDefault = () => ({ on: true, prio: 32768 });
/** Adresse IP d'un hôte : par DHCP (défaut) ou fixe. */
export const ipDefault = (mode = 'dhcp', ip = '', prefix = 24, gw = '') => ({ mode, ip, prefix, gw, dns: '' });

/**
 * Types d'équipements. role : 'host' (une adresse IP), 'switch' (pont entre ses ports), 'router' (ports LAN pontés,
 * port WAN routé, serveur DHCP), 'ap' (point d'accès : relie le Wi-Fi à son port), 'passive' (prise, panneau : broche à
 * broche), service : 'mqtt' | 'modbus' | 'http' (ce que l'équipement sert en plus).
 * ports(p) : ports selon les réglages (un équipement ancien n'a pas d'Auto-MDIX et ne dépasse pas 100 Mb/s).
 */
export const DEVICES = {
  pc: {
    role: 'host', icon: 'desktopPc', w: 76, h: 64, name: () => tl('PC fixe'), prefix: 'PC',
    doc: () => tl('Ordinateur de bureau, carte réseau Gigabit. Navigateur et ping dans son panneau.'),
    ports: p => [eth('eth0', { label: 'LAN', ...(p.legacy ? { speed: 100, mdix: 'mdi' } : {}) })],
    props: () => ({ ip: ipDefault(), legacy: false })
  },
  laptop: {
    role: 'host', icon: 'laptop', w: 76, h: 62, name: () => tl('Ordinateur portable'), prefix: 'PORTABLE', wifi: true,
    doc: () => tl('Ordinateur portable : un port RJ45 et le Wi-Fi (il rejoint un point d’accès par son nom et son mot de passe).'),
    ports: p => [eth('eth0', { label: 'LAN', ...(p.legacy ? { speed: 100, mdix: 'mdi' } : {}) })],
    props: () => ({ ip: ipDefault(), legacy: false, wifi: { ssid: '', pass: '' } })
  },
  printer: {
    role: 'host', icon: 'printer', w: 72, h: 60, name: () => tl('Imprimante réseau'), prefix: 'IMP', service: 'http',
    doc: () => tl('Imprimante réseau 100 Mb/s : une page d’état à son adresse (navigateur du PC).'),
    ports: p => [eth('eth0', { label: 'LAN', speed: 100, ...(p.legacy ? { mdix: 'mdi' } : {}) })],
    props: () => ({ ip: ipDefault(), legacy: false })
  },
  nas: {
    role: 'host', icon: 'server', w: 72, h: 66, name: () => tl('Serveur NAS 10 Gb/s'), prefix: 'NAS', service: 'http',
    doc: () => tl('Serveur de fichiers avec une carte 10GBASE-T : il lui faut du Cat 6A pour 100 m (Cat 6 : 55 m au plus).'),
    ports: () => [eth('eth0', { label: '10G', speed: 10000 })],
    props: () => ({ ip: ipDefault('static', '192.168.1.20', 24, '192.168.1.1') })
  },
  switch: {
    role: 'switch', icon: 'switchNet', w: 150, h: 40, name: () => tl('Switch 8 ports'), prefix: 'SW',
    doc: () => tl('Commutateur non administrable : il apprend les adresses MAC de chaque port. Pas de protocole Spanning Tree : une boucle entre switchs fait une tempête de diffusion.'),
    ports: p => range(8, i => eth('p' + i, { label: String(i), ...(p.legacy ? { speed: 100, mdix: 'mdix' } : {}) })),
    props: () => ({ legacy: false })
  },
  poeswitch: {
    role: 'switch', icon: 'switchNet', w: 150, h: 40, name: () => tl('Switch PoE 8 ports'), prefix: 'SW',
    doc: () => tl('Commutateur 8 ports dont 4 PoE+ (802.3af/at, 30 W par port, budget total 64 W, d’après le TP-Link TL-SG1008P).'),
    ports: p => range(8, i => eth('p' + i, { label: String(i), ...(i <= 4 ? { poe: 'pse' } : {}) })),
    props: () => ({ budget: 64, pseType: 'at', portW: 30 })
  },
  router: {
    role: 'router', icon: 'router', w: 120, h: 58, name: () => tl('Box / routeur'), prefix: 'BOX', service: 'http',
    doc: () => tl('Box internet : 4 ports LAN (un petit switch), un port WAN, serveur DHCP pour le réseau local, Wi-Fi intégré à activer.'),
    ports: () => [...range(4, i => eth('lan' + i, { label: 'LAN' + i })), eth('wan', { label: 'WAN' })],
    props: () => ({ lan: { ip: '192.168.1.1', prefix: 24 }, dhcp: { on: true, from: 100, to: 199 }, wan: ipDefault('none'), wifi: { on: false, ssid: 'Box-Jollof', pass: 'jollof2024' } })
  },
  ap: {
    role: 'ap', icon: 'wifi', w: 70, h: 54, name: () => tl('Point d’accès Wi-Fi'), prefix: 'AP',
    doc: () => tl('Point d’accès Wi-Fi alimenté par PoE (802.3af, 12,6 W au plus, d’après le TP-Link EAP225) : il relie les appareils Wi-Fi au réseau de son port.'),
    ports: () => [eth('eth0', { label: 'PoE', poe: 'pd' })],
    // Radios (wifi.js) : 2,4 GHz et 5 GHz, canal, largeur (MHz), puissance conduite (dBm), gain d'antenne (dBi, fiche).
    props: () => ({ ssid: 'Atelier', pass: 'jollof2024', power: 'poe', poeClass: 3, radios: { b24: { on: true, ch: 1, w: 20, tx: 14, gain: 4 }, b5: { on: true, ch: 36, w: 40, tx: 17, gain: 5 } } })
  },
  // Point d'accès Wi-Fi 6 d'après la fiche du TP-Link EAP670 (clé tplinkEap670) : 802.3at (classe PoE 4, 22,3 W au plus),
  // port 2,5 Gb/s, antennes 4 dBi (2,4 GHz) et 5 dBi (5 GHz), jusqu'à 160 MHz à 5 GHz.
  ap6: {
    role: 'ap', icon: 'wifi', w: 70, h: 54, name: () => tl('Point d’accès Wi-Fi 6'), prefix: 'AP',
    doc: () => tl('Point d’accès Wi-Fi 6 (802.11ax) alimenté en PoE+ (802.3at, classe 4, 22,3 W au plus, d’après le TP-Link EAP670), port 2,5 Gb/s : pour les salles denses.'),
    ports: () => [eth('eth0', { label: 'PoE+', speed: 2500, poe: 'pd' })],
    props: () => ({ ssid: 'Atelier', pass: 'jollof2024', power: 'poe', poeClass: 4, radios: { b24: { on: true, ch: 1, w: 20, tx: 14, gain: 4 }, b5: { on: true, ch: 36, w: 40, tx: 17, gain: 5 } } })
  },
  // Point d'accès Wi-Fi 6E (2,4, 5 et 6 GHz) d'après la fiche de l'Ubiquiti U6 Enterprise (clé ui6Enterprise) : PoE+
  // 802.3at (classe 4), 22 W au plus, port 2,5 Gb/s, antennes 3,2 / 5,3 / 6 dBi, jusqu'à 160 MHz à 5 et 6 GHz.
  ap6e: {
    role: 'ap', icon: 'wifi', w: 70, h: 54, name: () => tl('Point d’accès Wi-Fi 6E'), prefix: 'AP',
    doc: () => tl('Point d’accès Wi-Fi 6E (2,4, 5 et 6 GHz) alimenté en PoE+ (802.3at, classe 4, 22 W au plus, d’après l’Ubiquiti U6 Enterprise), port 2,5 Gb/s : la bande de 6 GHz ajoute des canaux larges sans voisins anciens.'),
    ports: () => [eth('eth0', { label: 'PoE+', speed: 2500, poe: 'pd' })],
    props: () => ({ ssid: 'Atelier', pass: 'jollof2024', power: 'poe', poeClass: 4, radios: { b24: { on: true, ch: 1, w: 20, tx: 14, gain: 3.2 }, b5: { on: true, ch: 36, w: 40, tx: 17, gain: 5.3 }, b6: { on: true, ch: 5, w: 80, tx: 14, gain: 6 } } })
  },
  camera: {
    role: 'host', icon: 'ipCamera', w: 66, h: 58, name: () => tl('Caméra IP'), prefix: 'CAM', service: 'http',
    doc: () => tl('Caméra de surveillance alimentée par PoE (802.3af classe 3, 12,95 W au plus, d’après l’AXIS M2035-LE).'),
    ports: () => [eth('eth0', { label: 'PoE', speed: 100, poe: 'pd' })],
    props: () => ({ ip: ipDefault(), power: 'poe', poeClass: 3 })
  },
  phone: {
    role: 'host', icon: 'deskPhone', w: 64, h: 60, name: () => tl('Téléphone IP'), prefix: 'TEL',
    doc: () => tl('Téléphone sur IP alimenté par PoE (802.3af classe 1, 3,84 W au plus, d’après le Cisco IP Phone 7841).'),
    ports: () => [eth('eth0', { label: 'PoE', poe: 'pd' })],
    props: () => ({ ip: ipDefault(), power: 'poe', poeClass: 1 })
  },
  outlet: {
    role: 'passive', icon: 'outlet', w: 44, h: 44, name: () => tl('Prise murale RJ45'), prefix: 'PR',
    doc: () => tl('Prise RJ45 du mur (connecteur keystone) : le câble du mur arrive derrière (lien permanent), on branche un cordon devant.'),
    ports: () => [eth('front', { label: tl('devant'), passive: 'back' }), eth('back', { label: tl('mur'), passive: 'front', punch: true })],
    props: () => ({})
  },
  patch: {
    role: 'passive', icon: 'patchPanel', w: 190, h: 46, name: () => tl('Panneau de brassage'), prefix: 'PB',
    doc: () => tl('Panneau de brassage 12 ports : les câbles des prises murales arrivent derrière, des cordons courts vont devant vers le switch.'),
    ports: () => [...range(12, i => eth('f' + i, { label: String(i), passive: 'b' + i })), ...range(12, i => eth('b' + i, { label: String(i), passive: 'f' + i, punch: true }))],
    props: () => ({})
  },
  patch24: {
    role: 'passive', icon: 'patchPanel', w: 360, h: 46, name: () => tl('Panneau de brassage 24 ports (1U)'), prefix: 'PB',
    doc: () => tl('Panneau de brassage Cat 6 24 ports, 1U (d’après le Belden RV6PPF1U24BK-P) : les liens permanents arrivent derrière, les cordons partent devant.'),
    ports: () => [...range(24, i => pass('f' + i, 'b' + i, { label: String(i) })), ...range(24, i => pass('b' + i, 'f' + i, { label: String(i), punch: true }))],
    props: () => ({})
  },
  patch48: {
    role: 'passive', icon: 'patchPanel', w: 360, h: 58, rows: 2, name: () => tl('Panneau de brassage 48 ports (2U)'), prefix: 'PB',
    doc: () => tl('Panneau de brassage Cat 6 48 ports, 2U (d’après le Belden RV6PPF2U48BK-P) : les liens permanents arrivent derrière, les cordons partent devant.'),
    ports: () => [...range(48, i => pass('f' + i, 'b' + i, { label: String(i) })), ...range(48, i => pass('b' + i, 'f' + i, { label: String(i), punch: true }))],
    props: () => ({})
  },
  fibrepanel: {
    role: 'passive', icon: 'fibrePanel', w: 230, h: 46, name: () => tl('Panneau fibre 12 LC duplex (1U)'), prefix: 'PF',
    doc: () => tl('Tiroir optique 1U, 12 traversées LC duplex (d’après le Belden LF15LD24B) : les fibres du bâtiment arrivent derrière, les jarretières partent devant. Chaque traversée ajoute une connexion au bilan optique.'),
    ports: () => [...range(12, i => pass('f' + i, 'b' + i, { label: String(i), fibre: true })), ...range(12, i => pass('b' + i, 'f' + i, { label: String(i), fibre: true, punch: true }))],
    props: () => ({})
  },
  outlet2: {
    role: 'passive', icon: 'outlet2', w: 60, h: 44, name: () => tl('Prise murale double RJ45'), prefix: 'PR',
    doc: () => tl('Plastron mural à deux prises RJ45 (d’après le Leviton 41080-2WP) : deux liens permanents derrière, deux cordons devant.'),
    ports: () => [pass('front1', 'back1', { label: tl('devant') + ' 1' }), pass('front2', 'back2', { label: tl('devant') + ' 2' }), pass('back1', 'front1', { label: tl('mur') + ' 1', punch: true }), pass('back2', 'front2', { label: tl('mur') + ' 2', punch: true })],
    props: () => ({})
  },
  broker: {
    role: 'host', icon: 'broker', w: 72, h: 62, name: () => tl('Serveur MQTT'), prefix: 'MQTT', service: 'mqtt',
    doc: () => tl('Petit serveur (Raspberry Pi) avec un broker MQTT sur le port 1883 : les objets y publient leurs mesures et s’abonnent aux sujets.'),
    ports: () => [eth('eth0', { label: 'LAN' })],
    props: () => ({ ip: ipDefault('static', '192.168.1.10', 24, '192.168.1.1') })
  },
  plc: {
    role: 'host', icon: 'plc', w: 72, h: 62, name: () => tl('Automate Modbus TCP'), prefix: 'API', service: 'modbus',
    doc: () => tl('Automate programmable joignable en Modbus TCP (port 502) : bobines, entrées, registres. Si le projet a un programme Ladder, ce sont ses variables.'),
    ports: () => [eth('eth0', { label: 'LAN', speed: 100 })],
    props: () => ({ ip: ipDefault('static', '192.168.1.50', 24, '192.168.1.1'), regs: { coils: new Array(16).fill(0), di: new Array(16).fill(0), hr: new Array(16).fill(0), ir: new Array(16).fill(0) } })
  },
  // ---------- Réseau d'entreprise (partie sim) : équipements administrables, d'après des fiches réelles (lim/sim.js) ----------
  // Encombrement pour les baies (rack.js) : C1000-24FP 1U 345 mm 4,6 kg 36 W (sans PoE) ; C1000-48FP 1U 350 mm 5,82 kg
  // 62,26 W ; C1300-24XS 1U 286 mm 4,15 kg 49,46 W ; ISR C1111-4P 1U (kit de baie) 229,4 mm 1,98 kg 18 W ; PowerEdge R250
  // 1U 585 mm 12,48 kg alimentation 450 W ; panneau fibre LF15LD24B 1U 370 mm 4,5 kg ; panneaux RV6PPF 24 ports 1U 101,6 mm
  // 0,835 kg, 48 ports 2U 95,3 mm 1,398 kg ; convertisseur MC220L V5.20 de bureau 94,5 × 73 × 27 mm, 1,7 W.
  switch24: {
    role: 'switch', managed: true, icon: 'switchNet', w: 400, h: 44, name: () => tl('Switch administrable 24 ports PoE+'), prefix: 'SW',
    doc: () => tl('Switch d’accès administrable : 24 ports 1 Gb/s PoE+ (802.3at, 30 W par port, budget 370 W) et 4 cages SFP+ 10 Gb/s, d’après le Cisco Catalyst C1000-24FP-4X-L. VLAN 802.1Q, Spanning Tree rapide (RSTP), agrégats LACP.'),
    ports: () => [...range(24, i => eth('p' + i, { label: String(i), poe: 'pse' })), ...range(4, i => cage('x' + i, 'sfp+', { label: 'X' + i }))],
    props: () => ({ budget: 370, pseType: 'at', portW: 30, ports: {}, stp: stpDefault(), lags: [], sfp: {} }),
    clean: (s, d) => managed('switch24', poeClean)(s, d)
  },
  switch48: {
    role: 'switch', managed: true, icon: 'switchNet', w: 380, h: 52, rows: 2, name: () => tl('Switch administrable 48 ports PoE+'), prefix: 'SW',
    doc: () => tl('Switch d’accès administrable : 48 ports 1 Gb/s PoE+ (802.3at, 30 W par port, budget 740 W) et 4 cages SFP+ 10 Gb/s, d’après le Cisco Catalyst C1000-48FP-4X-L. VLAN 802.1Q, Spanning Tree rapide (RSTP), agrégats LACP.'),
    ports: () => [...range(48, i => eth('p' + i, { label: String(i), poe: 'pse' })), ...range(4, i => cage('x' + i, 'sfp+', { label: 'X' + i }))],
    props: () => ({ budget: 740, pseType: 'at', portW: 30, ports: {}, stp: stpDefault(), lags: [], sfp: {} }),
    clean: (s, d) => managed('switch48', poeClean)(s, d)
  },
  l3switch: {
    role: 'switch', managed: true, routes: true, icon: 'switchL3', w: 400, h: 48, name: () => tl('Switch de niveau 3 (cœur)'), prefix: 'CORE',
    doc: () => tl('Switch d’agrégation de niveau 3 : 24 cages SFP+ 10 Gb/s et 4 ports cuivre 10GBASE-T, d’après le Cisco Catalyst C1300-24XS (sur le vrai, les 4 ports cuivre partagent leur place avec 4 cages : modèle simplifié). Interfaces VLAN (SVI), routes statiques, relais DHCP, listes d’accès.'),
    ports: () => [...range(24, i => cage('x' + i, 'sfp+', { label: 'X' + i })), ...range(4, i => eth('p' + i, { label: 'T' + i, speed: 10000 }))],
    props: () => ({ ports: {}, stp: stpDefault(), lags: [], sfp: {}, routing: true, svis: [], routes: [], dhcp: [], acls: [] }),
    clean: (s, d) => managed('l3switch')(s, d)
  },
  routerpro: {
    role: 'l3', routes: true, icon: 'firewall', w: 170, h: 58, name: () => tl('Routeur d’entreprise'), prefix: 'RT', service: 'http',
    doc: () => tl('Routeur et pare-feu d’entreprise : 4 ports 1 Gb/s routés (ge0 à ge3) et une cage SFP, d’après le Cisco ISR C1111-4P (sur le vrai, 2 ports WAN et 4 ports de switch : modèle simplifié). Sous-interfaces 802.1Q, routes statiques, traduction d’adresses, listes d’accès, serveur DHCP et DNS.'),
    ports: () => [...range(4, i => eth('ge' + (i - 1), { label: 'ge' + (i - 1) })), cage('sfp0', 'sfp', { label: 'SFP' })],
    props: () => ({
      ifs: [{ port: 'ge0', vlan: 0, mode: 'dhcp', ip: '', prefix: 24, helper: '', nat: 'outside', aclIn: '', aclOut: '' }, { port: 'ge1', vlan: 0, mode: 'static', ip: '192.168.10.1', prefix: 24, helper: '', nat: 'inside', aclIn: '', aclOut: '' }],
      routes: [], dhcp: [{ net: '192.168.10.0/24', from: '192.168.10.100', to: '192.168.10.199', gw: '192.168.10.1', dns: '192.168.10.1', on: true }], acls: [], fwd: [], dns: { on: true, records: [] }, sfp: {}
    }),
    clean: (s, d) => managed('routerpro')(s, d)
  },
  server: {
    role: 'host', icon: 'server', w: 80, h: 66, name: () => tl('Serveur en baie'), prefix: 'SRV', service: 'http',
    doc: () => tl('Serveur 1U à deux cartes 1 Gb/s (eth1 prend le relais si eth0 tombe), d’après le Dell PowerEdge R250. Peut servir le DHCP (étendues, aussi derrière un relais) et le DNS.'),
    ports: () => [eth('eth0', { label: 'eth0' }), eth('eth1', { label: 'eth1' })],
    props: () => ({ ip: ipDefault('static', '192.168.1.5', 24, '192.168.1.1'), dhcp: [], dns: { on: false, records: [] } }),
    clean: (s, d) => managed('server', (raw, o) => ({ ...o, ip: cleanHostIp(raw.ip || d.ip) }))(s, d)
  },
  mediaconv: {
    role: 'switch', icon: 'mediaConv', w: 90, h: 46, name: () => tl('Convertisseur cuivre-fibre'), prefix: 'CONV',
    doc: () => tl('Convertisseur de média : un port RJ45 1 Gb/s et une cage SFP 1 Gb/s, il passe les trames telles quelles, étiquettes VLAN comprises (d’après le TP-Link MC220L). Pour prolonger un lien cuivre par une fibre.'),
    ports: () => [eth('rj', { label: 'RJ45' }), cage('sfp', 'sfp', { label: 'SFP' })],
    props: () => ({ sfp: {} }),
    clean: (s, d) => managed('mediaconv')(s, d)
  },
  // Équipements de baie sans rôle réseau (rôle 'mech' : pas de nœud dans le schéma logique), voir rackdev.js.
  ...RACK_DEVICES
};
/** Adresse d'un hôte (serveur), bornée comme celles des postes (clean.js). */
function cleanHostIp(c) {
  const o = c && typeof c === 'object' ? c : {}, ip = v => (/^\d{1,3}(\.\d{1,3}){3}$/.test(String(v ?? '').trim()) && String(v).trim().split('.').every(x => +x <= 255) ? String(v).trim() : '');
  const p = Number.isInteger(+o.prefix) && +o.prefix >= 0 && +o.prefix <= 32 ? +o.prefix : 24;
  return { mode: ['dhcp', 'static', 'none'].includes(o.mode) ? o.mode : 'dhcp', ip: ip(o.ip), prefix: p, gw: ip(o.gw), dns: ip(o.dns) };
}
// Ports qui ne dépendent pas des réglages : calculés une seule fois par type (un switch 48 ports en a 52 ; un grand plan
// les demande des milliers de fois par recalcul). La liste rendue est partagée : ne pas la modifier.
for (const s of Object.values(DEVICES)) if (s.ports.length === 0) { const f = s.ports; let memo = null; s.ports = () => memo || (memo = Object.freeze(f().map(p => Object.freeze(p)))); }
export const DEVICE_IDS = Object.keys(DEVICES);
/** Nœuds venus du montage électronique (projet Objets connectés). */
export const EXTERNAL = {
  w5500: { role: 'host', icon: 'ethModule', w: 72, h: 60, name: () => 'W5500', ports: () => [eth('eth', { label: 'RJ45', speed: 100, mdix: 'mdi' })] },
  enc28j60: { role: 'host', icon: 'ethModule', w: 72, h: 60, name: () => 'ENC28J60', ports: () => [eth('eth', { label: 'RJ45', speed: 10, mdix: 'mdi' })] },
  wifi: { role: 'host', icon: 'cpu', w: 72, h: 60, name: () => (isEn ? 'Wi-Fi board' : 'Carte Wi-Fi'), ports: () => [] }
};
export const LIB_GROUPS = [
  [() => tl('Postes'), ['pc', 'laptop', 'printer', 'nas']],
  [() => tl('Interconnexion'), ['switch', 'poeswitch', 'router', 'ap', 'ap6', 'ap6e']],
  [() => tl('Commutation et routage'), ['switch24', 'switch48', 'l3switch', 'routerpro', 'mediaconv']],
  [() => tl('Câblage'), ['outlet', 'outlet2', 'patch', 'patch24', 'patch48', 'fibrepanel']],
  [() => tl('Appareils PoE'), ['camera', 'phone']],
  [() => tl('Services'), ['server', 'broker', 'plc']],
  ...RACK_GROUPS
];
export const specOf = d => DEVICES[d.type] || EXTERNAL[d.type] || null;
export const portsOf = d => { const s = specOf(d); return s ? s.ports(d.p || {}) : []; };
export const portOf = (d, id) => portsOf(d).find(p => p.id === id) || null;
/** Équipement nouveau : propriétés par défaut, nom libre suivant (PC1, PC2…). */
export function newDevice(type, used, at = {}) {
  const s = DEVICES[type]; if (!s) return null;
  let i = 1; while (used.has(s.prefix + i)) i++;
  return { id: at.id || null, type, x: at.x ?? 0, y: at.y ?? 0, name: s.prefix + i, p: s.props() };
}
