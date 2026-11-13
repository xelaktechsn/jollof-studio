// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : nettoyage d'un circuit reçu (projet ouvert, exemple, copie d'élève).
import { DEFS } from './elements.js';
import { cleanGrafcet } from './grafcet.js';

// Machines de la vue 3D et réglages gardés avec le circuit (voir SCENES dans machine.js, chargé à la demande).
const SCENE_KINDS = ['cylinders', 'door', 'press', 'station', 'pantograph', 'sorter'];
const SCENE_KEYS = ['skin', 'cyl', 'clamp', 'drill', 'open', 'obstacle', 'emergency', 'left', 'right', 'start', 'up', 'detect', 'send', 'coil'];
/** Circuit reçu (projet, exemple) : éléments connus, nombres entiers, réglages nettoyés ; tuyaux vers des orifices. */
export function clean(c) {
  if (!c || !Array.isArray(c.elements)) return { elements: [], tubes: [] };
  const id = v => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : null);
  const name = v => (typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12) : '');
  // Repère d'un élément et came d'un galet : la casse est gardée (a0, a1 pour les galets, A et B pour les vérins).
  const tag = v => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) : '');
  const els = c.elements.slice(0, 400).filter(e => e && DEFS[e.type] && id(e.id)).map(e => {
    const p = {}, src = e.p && typeof e.p === 'object' ? e.p : {};
    for (const [k, def] of Object.entries(DEFS[e.type].props || {})) {
      const v = src[k];
      if (v == null) continue;
      if (typeof def === 'number') { if (Number.isFinite(+v)) p[k] = +v; } else if (k === 'label' || k === 'cam') p[k] = tag(v);
      else if (k === 'end') p[k] = String(v) === '0' ? '0' : '1';
      else if (['coil', 'coilL', 'coilR', 's0', 's1', 'sensor'].includes(k)) p[k] = name(v);
      else if (typeof v === 'string') p[k] = v.slice(0, 20);
    }
    return { id: e.id, type: e.type, x: Math.round(+e.x || 0), y: Math.round(+e.y || 0), p };
  });
  const ids = new Set(els.map(e => e.id));
  const tubes = (Array.isArray(c.tubes) ? c.tubes : []).slice(0, 1000).filter(t => t && id(t.id) && Array.isArray(t.a) && Array.isArray(t.b) && ids.has(t.a[0]) && ids.has(t.b[0])).map(t => ({ id: t.id, a: [t.a[0], String(t.a[1]).slice(0, 4)], b: [t.b[0], String(t.b[1]).slice(0, 4)] }));
  const grafcet = cleanGrafcet(c.grafcet);
  // Vue 3D : la scène (vérins, porte de TER ou de bus, presse, poste de perçage, pantographe, convoyeur) et ses
  // liaisons (habillage, vérins des rôles, commandes : ouverture, obstacle, deux mains, départ, cellule…, électroaimant).
  const sc = c.scene && typeof c.scene === 'object' ? c.scene : null;
  const scene = sc ? { kind: SCENE_KINDS.includes(sc.kind) ? sc.kind : 'cylinders', ...Object.fromEntries(SCENE_KEYS.map(k => [k, tag(sc[k])]).filter(([, v]) => v)) } : null;
  return { ...(c.model === 'physical' ? { model: 'physical' } : {}), elements: els, tubes, ...(grafcet ? { grafcet } : {}), ...(scene ? { scene } : {}) };
}
