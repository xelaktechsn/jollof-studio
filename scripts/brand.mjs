// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Identité visuelle de Jollof Studio, dessinée ici une fois pour toutes :
// - le logo : « Jollof Studio » écrit en pistes de circuit imprimé (traits à angles coupés à 45°,
//   pastilles de soudure), la piste du dernier « o » allumant une LED ;
// - l'icône, tirée du logo : le J, sa queue terminée par la LED allumée, sur une tuile bleu nuit.
// Écrit docs/brand/*.svg, public/favicon.svg et src/ui/brand.js (logo et icône de la barre d'application).
// À relancer après une retouche : node scripts/brand.mjs
// Puis, pour les icônes de l'application (macOS, Windows, Linux) : voir docs/brand/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const COLORS = {
  blue: '#3b82f6',   // bleu de l'entreprise (couleur d'accent de l'interface)
  blueDeep: '#2563eb',
  navy: '#0f1d4a',
  led: '#22d3ee',    // cyan de la LED allumée
};
const T = 11;                // largeur de piste
const R = 9.5, HOLE = 3.6;   // pastille (via) et son trou
const X = 52, A = 80;        // hauteur des minuscules, des capitales et hampes
const GAP = 19, SPACE = 44;  // approche entre lettres, entre mots
const f1 = n => +n.toFixed(2);

/** Coupe chaque angle d'une ligne brisée à 45° (pts : [x, y, coupe?]). */
function chamfer(pts, c, closed = false) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], cc = p[2] ?? c;
    const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
    if ((!closed && (i === 0 || i === n - 1)) || !cc) { out.push([p[0], p[1]]); continue; }
    const din = [p[0] - prev[0], p[1] - prev[1]], dout = [next[0] - p[0], next[1] - p[1]];
    const li = Math.hypot(...din), lo = Math.hypot(...dout), k = Math.min(cc, li / 2, lo / 2);
    out.push([p[0] - din[0] / li * k, p[1] - din[1] / li * k], [p[0] + dout[0] / lo * k, p[1] + dout[1] / lo * k]);
  }
  return out;
}
const line = (pts, closed) => 'M' + pts.map(p => `${f1(p[0])} ${f1(p[1])}`).join('L') + (closed ? 'Z' : '');
const circle = (x, y, r) => `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0Z`;
const ring = (x, y, r = R, h = HOLE) => circle(x, y, r) + circle(x, y, h);
/** Avance le début d'une piste du rayon de sa pastille (le trou de la pastille reste vide). */
const trimStart = (pts, r) => { const [a, b] = pts, l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [[a[0] + (b[0] - a[0]) / l * r, a[1] + (b[1] - a[1]) / l * r, a[2]], ...pts.slice(1)]; };

// Lettres : lignes brisées sur la ligne de base (y vers le bas), angles coupés ; vias = pastilles.
const J_PTS = [[12, -A], [40, -A, 10], [40, 0], [0, 0], [0, -24]];
const G = {
  J: { w: 40, paths: [{ pts: trimStart(J_PTS, R), c: 16 }], vias: [[12, -A]] },
  o: { w: 46, paths: [{ pts: [[0, -X], [46, -X], [46, 0], [0, 0]], c: 17, closed: true }] },
  l: { w: 14, paths: [{ pts: [[0, -A], [0, 0], [14, 0]], c: 10 }] },
  f: { w: 30, paths: [{ pts: [[32, -A], [12, -A], [12, 0]], c: 13 }, { pts: [[0, -X], [30, -X]] }] },
  S: { w: 44, paths: [{ pts: [[44, -A], [0, -A], [0, -A / 2], [44, -A / 2], [44, 0], [0, 0]], c: 17 }] },
  t: { w: 26, paths: [{ pts: [[10, -72], [10, 0], [26, 0]], c: 10 }, { pts: [[0, -X], [26, -X]] }] },
  u: { w: 42, paths: [{ pts: [[0, -X], [0, 0], [42, 0]], c: 17 }, { pts: [[42, -X], [42, 0]] }] },
  d: { w: 44, paths: [{ pts: [[44, -X], [0, -X], [0, 0], [44, 0]], c: 17 }, { pts: [[44, -A], [44, 0]] }] },
  i: { w: 0, paths: [{ pts: [[0, -X], [0, 0]] }], vias: [[0, -X - 22]] },
};
function word(text, x0) {
  let x = x0; const paths = [], vias = [];
  for (const ch of text) {
    const g = G[ch];
    for (const p of g.paths) paths.push(line(chamfer(p.pts.map(q => [q[0] + x, q[1], q[2]]), p.c || 0, p.closed), p.closed));
    for (const [vx, vy] of g.vias || []) vias.push(ring(vx + x, vy));
    x += g.w + GAP;
  }
  return { d: paths.join(''), vias: vias.join(''), end: x - GAP };
}

// Couleur : valeur fixe (fichiers) ou variable CSS (dans l'application, suit le thème).
const stroke = c => (c.startsWith('var(') ? `style="stroke:${c}"` : `stroke="${c}"`);
const fill = c => (c.startsWith('var(') ? `style="fill:${c}"` : `fill="${c}"`);
const ledDefs = id => `<radialGradient id="${id}h"><stop offset="0" stop-color="${COLORS.led}" stop-opacity=".75"/><stop offset=".36" stop-color="${COLORS.led}" stop-opacity=".3"/><stop offset="1" stop-color="${COLORS.led}" stop-opacity="0"/></radialGradient>`
  + `<radialGradient id="${id}b" cx=".42" cy=".4" r=".7"><stop offset="0" stop-color="#ecfeff"/><stop offset=".45" stop-color="#67e8f9"/><stop offset="1" stop-color="#06b6d4"/></radialGradient>`;
const led = (cx, cy, s, id) => `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(46 * s)}" fill="url(#${id}h)"/>`
  + `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(16 * s)}" fill="url(#${id}b)" stroke="#a5f3fc" stroke-opacity=".55" stroke-width="${f1(1.6 * s)}"/>`
  + `<circle cx="${f1(cx - 5 * s)}" cy="${f1(cy - 5.5 * s)}" r="${f1(4.4 * s)}" fill="#fff" fill-opacity=".9"/>`;

/** Logo : « Jollof » (c1) « Studio » (c2), la piste du dernier o allume la LED. */
function wordmark({ c1, c2, id = 'jsL', attrs = '' }) {
  const a = word('Jollof', 0), b = word('Studio', a.end + SPACE);
  const oy = -X / 2, lx = b.end + 50, W = lx + 46, top = -A - 18, H = A + 18 + 22;
  const g = (c, w) => `<path d="${w.d}" fill="none" ${stroke(c)} stroke-width="${T}" stroke-linecap="round" stroke-linejoin="round"/>` + (w.vias ? `<path d="${w.vias}" ${fill(c)} fill-rule="evenodd"/>` : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 ${top} ${W + 8} ${H}"${attrs}><defs>${ledDefs(id)}</defs>`
    + g(c1, a) + g(c2, b)
    + `<path d="M${b.end} ${oy}H${lx - 16}" fill="none" ${stroke(c2)} stroke-width="${T}" stroke-linecap="round"/>`
    + led(lx, oy, 1, id) + '</svg>';
}

/**
 * Icône : tuile bleu nuit (824 px dans 1024, gabarit macOS), le J du logo en blanc, la LED au bout de sa queue.
 * viewBox : cadrage (tuile seule « 100 100 824 824 », marge réduite pour Windows et Linux…).
 */
function icon({ id = 'jsI', texture = true, viewBox = '0 0 1024 1024', attrs = '' } = {}) {
  const s = 6.4, sl = 3.1; // échelle du J, de la LED
  const cx = (-16 * sl / s + 40 + T / 2) / 2, cy = (-A - R + T / 2) / 2; // centre de la masse J + LED
  const ox = 512 - cx * s, oy = 512 - cy * s;
  const pts = trimStart(J_PTS, R).map(p => [ox + p[0] * s, oy + p[1] * s, p[2] != null ? p[2] * s : undefined]);
  const traces = [
    [[924, 300], [812, 300], [770, 342], [770, 470]], [[924, 560], [846, 560]], [[924, 700], [868, 700], [826, 742], [826, 924]],
    [[100, 230], [196, 230], [238, 188], [238, 100]], [[100, 760], [176, 760]], [[560, 924], [560, 880]],
  ];
  const ends = [[770, 470], [846, 560], [196, 230], [176, 760], [560, 880]];
  const tile = 'x="100" y="100" width="824" height="824" rx="186"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${attrs}><defs>`
    + `<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2050c8"/><stop offset=".5" stop-color="#16287a"/><stop offset="1" stop-color="#0a1033"/></linearGradient>`
    + `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    + (texture ? `<clipPath id="${id}c"><rect ${tile}/></clipPath>` : '') + ledDefs(id) + '</defs>'
    + `<rect ${tile} fill="url(#${id}g)"/>`
    + (texture ? `<g clip-path="url(#${id}c)" opacity=".16"><path d="${traces.map(t => line(t)).join('')}" fill="none" stroke="#93c5fd" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/><path d="${ends.map(([x, y]) => ring(x, y, 24, 9)).join('')}" fill="#93c5fd" fill-rule="evenodd"/></g>` : '')
    + `<rect ${tile} fill="url(#${id}s)"/><rect x="101" y="101" width="822" height="822" rx="185" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="2"/>`
    + `<path d="${line(chamfer(pts, 16 * s))}" fill="none" stroke="#f8fafc" stroke-width="${T * s}" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="${ring(ox + 12 * s, oy - A * s, R * s, HOLE * s)}" fill="#f8fafc" fill-rule="evenodd"/>`
    + led(ox, oy - 24 * s - 10 * sl, sl, id) + '</svg>';
}

const write = (rel, text) => { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text + '\n'); console.log('  ' + rel); };
write('docs/brand/logo-dark.svg', wordmark({ c1: '#e8edf3', c2: COLORS.blue }));
write('docs/brand/logo-light.svg', wordmark({ c1: COLORS.navy, c2: COLORS.blueDeep }));
write('docs/brand/icon.svg', icon());
write('docs/brand/icon-windows.svg', icon({ viewBox: '64 64 896 896' }));
write('public/favicon.svg', icon({ viewBox: '100 100 824 824' }));
const q = s => JSON.stringify(s).replace(/</g, '\\u003c');
write('src/ui/brand.js', `// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fichier produit par scripts/brand.mjs : ne pas modifier à la main.
/** Logo : « Jollof Studio » en pistes de circuit, la dernière allume une LED (couleurs du thème). */
export const WORDMARK = ${q(wordmark({ c1: 'var(--fg)', c2: 'var(--accent)', id: 'jsWm', attrs: ' class="wordmark" role="img" aria-label="Jollof Studio"' }))};
/** Icône : le J du logo et sa LED, sur la tuile bleu nuit. */
export const LOGO = ${q(icon({ id: 'jsIc', texture: false, viewBox: '100 100 824 824', attrs: ' class="logo" role="img" aria-label="Jollof Studio"' }))};`);
