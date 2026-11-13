// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : le relevé des mouvements des vérins pendant la simulation. Chaque course terminée est notée
// « A+ » (tige sortie) ou « A− » (tige rentrée), avec le repère du vérin, l'instant où la tige a quitté sa fin de
// course et celui où elle a atteint l'autre. On en tire le cycle observé (« A+ B+ A− B− »), comparé au cycle attendu
// d'un TP, et le diagramme des phases (diagramme espace-phase) : une ligne par vérin, rentré (0) ou sorti (1), une
// colonne par phase du cycle.
import { END } from './sim.js';

const isCyl = e => e.type === 'cyl1' || e.type === 'cyl2';
const nameOf = e => (e.p && e.p.label) || e.id;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Relevé vide : mouvements terminés, dernière fin de course de chaque vérin, instant de départ du mouvement en cours. */
export const createRecorder = () => ({ moves: [], last: {}, leave: {}, init: {} });

/** Note les mouvements terminés depuis le dernier appel (st : état de simulation, t : temps de simulation en s). */
export function record(R, circuit, st, t) {
  for (const e of circuit.elements) {
    if (!isCyl(e)) continue;
    const x = st.x[e.id] || 0, pos = x >= 1 - END ? 1 : x <= END ? 0 : null;
    if (!(e.id in R.last)) { R.last[e.id] = pos ?? 0; R.init[e.id] = R.last[e.id]; continue; }
    if (pos === null) { if (R.leave[e.id] == null) R.leave[e.id] = t; continue; }
    if (pos !== R.last[e.id]) {
      R.moves.push({ id: e.id, name: nameOf(e), dir: pos ? '+' : '-', t0: R.leave[e.id] ?? t, t1: t });
      R.last[e.id] = pos;
      if (R.moves.length > 300) R.moves.splice(0, 100);
    }
    R.leave[e.id] = null;
  }
}

/** Mouvement normalisé pour comparer : « a + », « A− », « A– » → « A+ », « A- ». */
export const normMove = s => String(s).replace(/\s+/g, '').replace(/[−–—]/g, '-').toUpperCase();
/** Texte d'un mouvement pour l'affichage (signe moins typographique). */
export const moveText = m => `${m.name}${m.dir === '+' ? '+' : '−'}`;
/** Cycle attendu : tableau ou texte « A+ B+ A- B- ». */
export const expectOf = e => (Array.isArray(e) ? e : String(e || '').split(/[\s,;]+/)).map(normMove).filter(Boolean);
/** Le cycle attendu apparaît-il, d'un seul tenant, dans les mouvements relevés ? */
export function hasSequence(moves, expect) {
  const want = expectOf(expect), seen = moves.map(m => normMove(m.name + m.dir));
  if (!want.length) return false;
  for (let i = 0; i + want.length <= seen.length; i++) if (want.every((w, k) => seen[i + k] === w)) return true;
  return false;
}

/**
 * Diagramme des phases des derniers mouvements (au plus max phases) : SVG autonome, une ligne par vérin du circuit.
 * Des mouvements qui commencent ensemble (à 50 ms près) forment une seule phase.
 */
export function phaseSvg(R, circuit, max = 8) {
  const cyls = circuit.elements.filter(isCyl);
  if (!cyls.length) return '';
  const all = [...R.moves].sort((a, b) => a.t0 - b.t0), phases = [];
  for (const m of all) { const p = phases[phases.length - 1]; if (p && Math.abs(m.t0 - p[0].t0) < 0.05 && !p.some(x => x.id === m.id)) p.push(m); else phases.push([m]); }
  const shown = phases.slice(-max), skipped = phases.length - shown.length;
  // Position de chaque vérin au début de la fenêtre : la position de départ, puis les phases qui précèdent.
  const lv = {}; for (const c of cyls) lv[c.id] = R.init[c.id] ?? 0;
  for (const p of phases.slice(0, skipped)) for (const m of p) lv[m.id] = m.dir === '+' ? 1 : 0;
  const L = 34, S = 34, H = 30, top = 16, W = L + Math.max(shown.length, 4) * S + 8, Ht = top + cyls.length * H + 4;
  let out = `<svg class="sqSvg" viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}" role="img">`;
  for (let k = 0; k <= Math.max(shown.length, 4); k++) {
    const x = L + k * S;
    out += `<line class="sqGrid" x1="${x}" y1="${top - 2}" x2="${x}" y2="${Ht - 4}"/>`;
    if (k < Math.max(shown.length, 4)) out += `<text class="sqNum" x="${x + S / 2}" y="${top - 5}" text-anchor="middle">${skipped + k + 1}</text>`;
  }
  cyls.forEach((c, r) => {
    const y1 = top + r * H + 6, y0 = top + r * H + H - 6, y = v => (v ? y1 : y0);
    let v = lv[c.id], d = `M${L} ${y(v)}`;
    shown.forEach((p, k) => { const m = p.find(x => x.id === c.id); const nv = m ? (m.dir === '+' ? 1 : 0) : v; d += ` L${L + (k + 1) * S} ${y(nv)}`; v = nv; });
    if (shown.length < 4) d += ` L${L + Math.max(shown.length, 4) * S} ${y(v)}`;
    out += `<text class="sqName" x="4" y="${(y0 + y1) / 2 + 4}">${esc(nameOf(c))}</text><text class="sqLv" x="${L - 4}" y="${y1 + 3}" text-anchor="end">1</text><text class="sqLv" x="${L - 4}" y="${y0 + 3}" text-anchor="end">0</text>`;
    out += `<path class="sqLine" d="${d}"/>`;
  });
  return out + '</svg>';
}
