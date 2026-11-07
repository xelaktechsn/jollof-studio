// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Courant dans chaque fil, pour l'animation : le solveur (dc.js) donne le courant que chaque
// broche envoie dans son nœud (dc.injections()) ; reste à le répartir sur les fils du nœud.
// Dans un nœud, fils et liaisons internes (bandes de breadboard, broches doublées, bouton appuyé)
// forment un graphe. On en prend un arbre couvrant (parcours en largeur) depuis la broche qui
// injecte le plus : chaque arête porte la somme des injections de la branche qu'elle relie
// (loi des nœuds). Les arêtes hors de l'arbre (boucle de fils, deux fils en parallèle) restent
// à 0 : approximation assumée, le sens et l'intensité restent justes là où passe le courant.
// Pur (sans Three.js) : testé sous Node, appelé 5 à 10 fois par seconde.

/**
 * Courant de chaque fil entièrement tracé.
 * A : analyse (circuit.js analyze), dc : résultat de solveDC, wires : [{ a, b, progress }].
 * Retourne Map fil → { mA (+ de a vers b, sens conventionnel), v (potentiel de a, null si inconnu) }.
 */
export function wireFlows(A, dc, wires) {
  const out = new Map(), ok = !!(dc && dc.ok);
  for (const w of wires) if ((w.progress ?? 1) >= 1) out.set(w, { mA: 0, v: ok ? dc.volts(w.a) : null });
  const inj = ok && out.size && typeof dc.injections === 'function' && A && typeof A.adj === 'function' ? dc.injections() : null;
  if (!inj || !inj.size) return out;
  const pid = A.pid || ((c, k) => c.id + '|' + k), adj = A.adj(), seen = new Set();
  const at = p => inj.get(p) || 0;
  for (const w of out.keys()) {
    const start = pid(w.a.comp, w.a.key);
    if (seen.has(start) || !adj.has(start)) continue;
    // Le nœud entier, et sa broche qui injecte le plus (elle absorbe les fuites du calcul).
    const net = [start];
    let root = start, best = Math.abs(at(start));
    seen.add(start);
    for (let i = 0; i < net.length; i++) {
      for (const ed of adj.get(net[i])) {
        const nx = ed[0];
        if (seen.has(nx)) continue;
        seen.add(nx); net.push(nx);
        const x = Math.abs(at(nx));
        if (x > best) { best = x; root = nx; }
      }
    }
    if (best === 0) continue; // rien ne circule dans ce nœud
    // Arbre couvrant depuis la racine : ordre de visite, parent et arête (fil ou null) vers le parent.
    const order = [root], par = new Map([[root, null]]), via = new Map();
    for (let i = 0; i < order.length; i++) {
      const cur = order[i];
      for (const ed of adj.get(cur)) if (!par.has(ed[0])) { par.set(ed[0], cur); via.set(ed[0], ed[1]); order.push(ed[0]); }
    }
    // Des feuilles vers la racine : courant de l'arête = injection de la broche + courant de ses branches.
    const sub = new Map();
    for (let i = order.length - 1; i > 0; i--) {
      const p = order[i], f = at(p) + (sub.get(p) || 0), q = par.get(p), e = via.get(p);
      sub.set(q, (sub.get(q) || 0) + f);
      const o = e && out.get(e);
      // f va de p vers son parent ; sous 0,1 µA, c'est la fuite gmin du calcul, pas un courant.
      if (o && (f > 1e-4 || f < -1e-4)) o.mA = pid(e.a.comp, e.a.key) === p ? f : -f;
    }
  }
  return out;
}
