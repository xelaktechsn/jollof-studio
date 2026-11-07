// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Courants de la vue « Schéma » en direct (sans dépendance : testable avec Node).
// Le solveur donne, pour chaque broche, le courant qu'elle envoie dans son nœud (injections).
// Dans la vue, les fils d'un nœud forment un arbre (liaisons entre broches et jonctions) :
// le courant d'une liaison est la somme des injections de tout ce qui est de son côté.

/**
 * links : [{ net, u, v }] (u, v : « id|broche » ou jonction) ; inj : Map « id|broche » → mA.
 * Rend Map liaison → mA, compté de u vers v (sens conventionnel du courant).
 */
export function linkFlows(links, inj) {
  const out = new Map(), byNet = new Map();
  for (const l of links) { if (!byNet.has(l.net)) byNet.set(l.net, []); byNet.get(l.net).push(l); }
  for (const ls of byNet.values()) {
    const adj = new Map();
    const add = (n, l) => { if (!adj.has(n)) adj.set(n, []); adj.get(n).push(l); };
    ls.forEach(l => { add(l.u, l); add(l.v, l); });
    const seen = new Set();
    // Somme des injections du sous-arbre de « node » (vu depuis la liaison « from ») : ce qui en sort par « from ».
    const visit = (node, from) => {
      seen.add(node);
      let s = inj.get(node) || 0;
      for (const l of adj.get(node) || []) {
        if (l === from) continue;
        const other = l.u === node ? l.v : l.u;
        if (seen.has(other)) { out.set(l, 0); continue; } // boucle : ne devrait pas arriver dans un arbre
        const sub = visit(other, l);
        out.set(l, l.u === other ? sub : -sub);
        s += sub;
      }
      return s;
    };
    for (const l of ls) if (!seen.has(l.u)) visit(l.u, null);
  }
  return out;
}

/** Bornes de contacts fermés en ce moment : bouton appuyé (1, 2), relais collé (COM, NO) ou au repos (COM, NC). */
const closedPin = p => {
  const c = p.comp;
  if (c.type === 'button') return !!(c.inp && c.inp.pressed);
  if (c.type === 'relay' && c.pins && c.pins.COM) return p.key === 'COM' || p.key === (c.relayOn ? 'NO' : 'NC');
  return false;
};
/**
 * Contact fermé (bouton appuyé, relais) : pour le solveur ses deux bornes ne font plus qu'un nœud, sans courant propre.
 * Le schéma, lui, dessine les deux nœuds séparés : le courant d'une borne est ce qui manque à son nœud pour s'équilibrer.
 * nets : nœuds du schéma ({ pins: [{ comp, key }] }) ; rend une copie complétée des injections.
 */
export function closedSwitches(nets, src) {
  const inj = new Map(src);
  for (const n of nets) {
    const held = n.pins.filter(closedPin);
    if (held.length !== 1) continue;
    const id = `${held[0].comp.id}|${held[0].key}`;
    let sum = 0;
    for (const p of n.pins) { const k = `${p.comp.id}|${p.key}`; if (k !== id) sum += src.get(k) || 0; }
    inj.set(id, -sum);
  }
  return inj;
}

/** Couleur d'une tension (mêmes repères que les points en 3D) : gris-bleu à 0 V, vert à 3,3 V, jaune à 5 V, rouge à 9 V, violet en négatif. */
const STOPS = [[-1, [155, 123, 224]], [0, [91, 107, 122]], [3.3, [63, 178, 127]], [5, [242, 201, 76]], [9, [229, 72, 77]]];
export function voltRgb(v) {
  if (v == null || v !== v) return [91, 107, 122];
  if (v <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) if (v <= STOPS[i][0]) {
    const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], t = (v - a) / (b - a);
    return ca.map((x, j) => Math.round(x + (cb[j] - x) * t));
  }
  return STOPS[STOPS.length - 1][1];
}
/** Vitesse des points (mm/s) : logarithmique, pour qu'on voie à la fois 1 mA et 50 mA. */
export const dotSpeed = mA => 6 * Math.log10(1 + Math.abs(mA) / 0.05);

/** Polyligne prête à parcourir : longueurs cumulées. */
export function track(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}
/** Point à la distance d le long d'une polyligne préparée par track(). */
export function pointAt(t, d) {
  const { pts, cum } = t;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1, f = Math.min(1, Math.max(0, (d - cum[i - 1]) / seg));
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
}
