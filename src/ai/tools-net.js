// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outils de l'IA pour la conception réseau professionnelle : plans, cheminements, baies, VLAN, routage, fibre, Wi-Fi,
// dimensionnement, nomenclature, certification. Une partie par fichier (tools-net-*.js).
import { tools as sim } from './tools-net-sim.js';
import { tools as plan } from './tools-net-plan.js';
import { tools as wifi } from './tools-net-wifi.js';
import { tools as rack } from './tools-net-rack.js';
import { tools as design } from './tools-net-design.js';
import { tools as cert } from './tools-net-cert.js';
import { tools as fibre } from './tools-net-fibre.js';
export const netProTools = h => [sim, fibre, plan, wifi, rack, design, cert].flatMap(f => f(h));
