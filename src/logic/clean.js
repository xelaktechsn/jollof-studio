// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique : circuit lu dans un fichier (projet reçu, TP, sauvegarde) ramené à ce que l'éditeur sait
// afficher : types connus, identifiants et textes nettoyés, propriétés bornées, coordonnées limitées,
// blocs (sous-circuits) nettoyés de la même façon, leur interface recalculée.
import { cleanText } from '../sanitize.js';
import { DEFS } from './elements.js';
import { syncBlocks, blockSize, MAX_FLAT } from './blocks.js';

const okId = s => typeof s === 'string' && /^[\w.:-]{1,40}$/.test(s);

/** Circuit lu dans un fichier : types connus, identifiants et textes nettoyés, coordonnées bornées. */
export function cleanCircuit(c, inner = false) {
  const out = { elements: [], wires: [] };
  if (!c || typeof c !== 'object') return out;
  const ids = new Set(), num = (v, d = 0) => (Number.isFinite(+v) ? Math.max(-5000, Math.min(5000, Math.round(+v))) : d);
  for (const e of Array.isArray(c.elements) ? c.elements.slice(0, 2000) : []) {
    if (!e || typeof e.type !== 'string' || !Object.hasOwn(DEFS, e.type) || !okId(e.id) || ids.has(e.id)) continue;
    // Seules les propriétés que l'élément déclare, bornées comme dans l'inspecteur (un fichier ne peut pas
    // demander un bloc d'un milliard de broches ni une horloge à fréquence négative).
    const d = DEFS[e.type], src = e.p && typeof e.p === 'object' ? e.p : {}, p = {};
    for (const pr of d.props || []) {
      const v = src[pr.k]; if (v == null) continue;
      if (pr.type === 'text') p[pr.k] = pr.k === 'label' ? cleanText(v, 12).replace(/#/g, '') : cleanText(v, pr.k === 'text' ? 80 : 12);
      else if (pr.type === 'int') { if (Number.isFinite(+v)) p[pr.k] = Math.max(pr.min, Math.min(pr.max, Math.round(+v))); }
      else if (pr.type === 'mem') p[pr.k] = String(v).replace(/[^0-9a-fA-F\s,]/g, '').slice(0, 1600);
      else if (pr.type === 'hidden') { if (pr.k === 'ref' && okId(v)) p.ref = v; } // l'interface d'un bloc est recalculée
      else { const o = pr.opts.find(([val]) => String(val) === String(v)); if (o) p[pr.k] = o[0]; }
    }
    if (e.type === 'block' && !p.ref) continue;
    if ((e.type === 'clock') && (src.value === 1 || src.value === 0)) p.value = src.value;
    if ((e.type === 'dip' || e.type === 'numin') && Number.isInteger(src.value)) p.value = Math.max(0, Math.min((1 << (p.bits || 4)) - 1, src.value));
    if (e.type === 'keypad' && Number.isInteger(src.value)) p.value = Math.max(0, Math.min(15, src.value));
    if (src.watch) p.watch = 1;
    ids.add(e.id);
    out.elements.push({ id: e.id, type: e.type, x: num(e.x), y: num(e.y), r: [0, 90, 180, 270].includes(e.r) ? e.r : 0, p });
  }
  const wids = new Set();
  for (const w of Array.isArray(c.wires) ? c.wires.slice(0, 5000) : []) {
    if (!w || !Array.isArray(w.a) || !Array.isArray(w.b) || !ids.has(w.a[0]) || !ids.has(w.b[0]) || typeof w.a[1] !== 'string' || typeof w.b[1] !== 'string') continue;
    let id = okId(w.id) && !wids.has(w.id) ? w.id : null;
    for (let k = wids.size + 1; !id; k++) if (!wids.has('w' + k + 'x')) id = 'w' + k + 'x';
    wids.add(id);
    const nw = { id, a: [w.a[0], w.a[1].slice(0, 16)], b: [w.b[0], w.b[1].slice(0, 16)] };
    if (Array.isArray(w.via)) { const via = w.via.slice(0, 40).filter(v => Array.isArray(v)).map(v => [num(v[0]), num(v[1])]); if (via.length) nw.via = via; }
    out.wires.push(nw);
  }
  if (inner) return out;
  // Blocs : définitions nettoyées (un niveau de liste : un bloc en contient d'autres par leur identifiant).
  const bids = new Set();
  const blocks = (Array.isArray(c.blocks) ? c.blocks.slice(0, 60) : []).filter(b => b && okId(b.id) && !bids.has(b.id) && bids.add(b.id))
    .map(b => ({ id: b.id, name: cleanText(b.name, 24) || 'Bloc', circuit: cleanCircuit(b.circuit, true) }));
  // Un bloc trop gros une fois aplati (blocs posés des milliers de fois les uns dans les autres) est refusé.
  const memo = new Map();
  for (const b of blocks) if (blockSize(blocks, b.id, memo) > MAX_FLAT) bids.delete(b.id);
  // Un bloc posé dont la définition manque disparaît, avec ses fils.
  const prune = k => {
    const gone = new Set(k.elements.filter(e => e.type === 'block' && !bids.has(e.p.ref)).map(e => e.id));
    if (!gone.size) return;
    k.elements = k.elements.filter(e => !gone.has(e.id)); k.wires = k.wires.filter(w => !gone.has(w.a[0]) && !gone.has(w.b[0]));
  };
  const kept = blocks.filter(b => bids.has(b.id));
  prune(out); kept.forEach(b => prune(b.circuit));
  if (kept.length) { out.blocks = kept; syncBlocks(out); }
  return out;
}
