// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Module Ethernet ENC28J60 en mode fidèle : la puce n'est qu'une carte réseau (trames brutes), et le vrai programme
// porte sa propre pile TCP/IP (UIPEthernet, EtherCard). L'émulateur ne relie pas ces trames au réseau simulé du
// projet : le modèle le dit (avertissement du moteur) et ne répond pas sur le bus SPI. Le mode simulé
// (l'interpréteur) fait, lui, parler le module au plan réseau.
import { tl } from '../../i18n/index.js';

export default {
  types: ['enc28j60'],
  bus: 'pins',
  create(comp, io) {
    const key = 'enc28j60:' + comp.id;
    if (io.warn) io.warn(key, tl('{0} (ENC28J60) : en mode fidèle, le programme porte sa propre pile TCP/IP sur des trames brutes, que l’émulateur ne relie pas au réseau simulé. Le module ne répondra pas ; le mode simulé le relie au plan réseau.', comp.name || 'ENC28J60'));
    return { dispose() { if (io.unwarn) io.unwarn(key); } };
  }
};
