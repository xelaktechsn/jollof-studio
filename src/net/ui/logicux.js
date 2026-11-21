// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Gestes du schéma logique, en fonctions pures (testées sans navigateur) : aligner et répartir des équipements, copier et
// coller (avec ou sans les câbles entre les équipements copiés), guides d'alignement pendant un déplacement, rectangle de
// sélection. Les rectangles sont { x, y, w, h } en coordonnées du schéma.

/** Aligne les rectangles (how : 'left'|'center'|'right'|'top'|'middle'|'bottom') : rend [{ id, x, y }] (nouvelles places). */
export function align(rects, how) {
  if (rects.length < 2) return [];
  const x0 = Math.min(...rects.map(r => r.x)), x1 = Math.max(...rects.map(r => r.x + r.w));
  const y0 = Math.min(...rects.map(r => r.y)), y1 = Math.max(...rects.map(r => r.y + r.h));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return rects.map(r => {
    const o = { id: r.id, x: r.x, y: r.y };
    if (how === 'left') o.x = x0; else if (how === 'right') o.x = x1 - r.w; else if (how === 'center') o.x = cx - r.w / 2;
    else if (how === 'top') o.y = y0; else if (how === 'bottom') o.y = y1 - r.h; else if (how === 'middle') o.y = cy - r.h / 2;
    return o;
  });
}
/** Répartit les rectangles à intervalles égaux le long d'un axe ('x' | 'y'), les deux extrêmes restant en place. */
export function distribute(rects, axis) {
  if (rects.length < 3) return [];
  const k = axis === 'y' ? 'y' : 'x', d = axis === 'y' ? 'h' : 'w';
  const s = rects.slice().sort((a, b) => a[k] - b[k]);
  const span = s[s.length - 1][k] + s[s.length - 1][d] - s[0][k], used = s.reduce((a, r) => a + r[d], 0), gap = (span - used) / (s.length - 1);
  let at = s[0][k];
  return s.map(r => { const o = { id: r.id, x: r.x, y: r.y }; o[k] = at; at += r[d] + gap; return o; });
}

/**
 * Copie des équipements ids d'un plan : { devices, cables } (copies profondes ; les câbles gardés sont ceux dont les deux
 * bouts sont dans la copie).
 */
export function copyOf(data, ids) {
  const set = new Set(ids), devices = data.devices.filter(d => set.has(d.id)).map(d => JSON.parse(JSON.stringify(d)));
  const cables = data.cables.filter(c => set.has(c.a[0]) && set.has(c.b[0])).map(c => JSON.parse(JSON.stringify(c)));
  return { devices, cables };
}
/**
 * Colle une copie dans le plan (décalée de dx, dy ; cables : avec les câbles entre les équipements copiés) : nouveaux
 * identifiants et noms libres (newId(type), newName(type, nom)). Rend les identifiants des équipements collés.
 */
export function paste(data, clip, o) {
  const map = new Map(), out = [];
  for (const d of clip.devices) {
    const id = o.newId(d.type), nd = { ...JSON.parse(JSON.stringify(d)), id, name: o.newName(d.type, d.name), x: d.x + (o.dx || 0), y: d.y + (o.dy || 0) };
    delete nd.loc; delete nd.rack; delete nd.tag; // une copie n'occupe ni la place sur le plan d'étage, ni le U de la baie, ni l'étiquette
    map.set(d.id, id); data.devices.push(nd); out.push(id);
  }
  if (o.cables) {
    const used = new Set(data.cables.map(c => c.id));
    for (const c of clip.cables) {
      let id = c.id; let i = 1; while (used.has(id)) id = c.id.replace(/_\d+$/, '') + '_' + ++i; used.add(id);
      const nc = { ...JSON.parse(JSON.stringify(c)), id, a: [map.get(c.a[0]), c.a[1]], b: [map.get(c.b[0]), c.b[1]] };
      delete nc.route; delete nc.tag;
      data.cables.push(nc);
    }
  }
  return out;
}
/** Nom libre : « PC3 » → le premier « PCn » libre ; un nom sans numéro reçoit « -2 », « -3 »… */
export function freeName(used, name) {
  const m = /^(.*?)(\d+)$/.exec(name);
  if (m) { let n = +m[2]; while (used.has(m[1] + n)) n++; return m[1] + n; }
  let k = 2; while (used.has(`${name}-${k}`)) k++; return `${name}-${k}`;
}

/**
 * Guides d'alignement d'un rectangle qu'on déplace (r) avec les autres (others) : bords et centres à moins de tol.
 * Rend { dx, dy (correction pour s'aligner), lines: [{ x1, y1, x2, y2 }] }.
 */
export function guides(r, others, tol) {
  let bx = null, by = null;
  const xs = [r.x, r.x + r.w / 2, r.x + r.w], ys = [r.y, r.y + r.h / 2, r.y + r.h];
  for (const o of others) {
    const ox = [o.x, o.x + o.w / 2, o.x + o.w], oy = [o.y, o.y + o.h / 2, o.y + o.h];
    for (const a of xs) for (const b of ox) { const d = b - a; if (Math.abs(d) <= tol && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, at: b, o }; }
    for (const a of ys) for (const b of oy) { const d = b - a; if (Math.abs(d) <= tol && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, at: b, o }; }
  }
  const lines = [];
  if (bx) lines.push({ x1: bx.at, y1: Math.min(r.y, bx.o.y) - 12, x2: bx.at, y2: Math.max(r.y + r.h, bx.o.y + bx.o.h) + 12 });
  if (by) lines.push({ x1: Math.min(r.x, by.o.x) - 12, y1: by.at, x2: Math.max(r.x + r.w, by.o.x + by.o.w) + 12, y2: by.at });
  return { dx: bx ? bx.d : 0, dy: by ? by.d : 0, lines };
}
/** Rectangles qui touchent la zone (x0, y0)–(x1, y1) (dans n'importe quel sens) : leurs identifiants. */
export function inMarquee(rects, x0, y0, x1, y1) {
  const a = Math.min(x0, x1), b = Math.min(y0, y1), c = Math.max(x0, x1), d = Math.max(y0, y1);
  return rects.filter(r => r.x < c && r.x + r.w > a && r.y < d && r.y + r.h > b).map(r => r.id);
}
