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

const eth = (id, o = {}) => ({ id, label: o.label || id, speed: o.speed || 1000, mdix: o.mdix || 'auto', poe: o.poe || null, ...o });
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
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
    props: () => ({ ssid: 'Atelier', pass: 'jollof2024', power: 'poe', poeClass: 3 })
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
  }
};
export const DEVICE_IDS = Object.keys(DEVICES);
/** Nœuds venus du montage électronique (projet Objets connectés). */
export const EXTERNAL = {
  w5500: { role: 'host', icon: 'ethModule', w: 72, h: 60, name: () => 'W5500', ports: () => [eth('eth', { label: 'RJ45', speed: 100, mdix: 'mdi' })] },
  enc28j60: { role: 'host', icon: 'ethModule', w: 72, h: 60, name: () => 'ENC28J60', ports: () => [eth('eth', { label: 'RJ45', speed: 10, mdix: 'mdi' })] },
  wifi: { role: 'host', icon: 'cpu', w: 72, h: 60, name: () => (isEn ? 'Wi-Fi board' : 'Carte Wi-Fi'), ports: () => [] }
};
export const LIB_GROUPS = [
  [() => tl('Postes'), ['pc', 'laptop', 'printer', 'nas']],
  [() => tl('Interconnexion'), ['switch', 'poeswitch', 'router', 'ap']],
  [() => tl('Câblage'), ['outlet', 'patch']],
  [() => tl('Appareils PoE'), ['camera', 'phone']],
  [() => tl('Services'), ['broker', 'plc']]
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
