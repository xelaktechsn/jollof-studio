// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Jumeau numérique : le moteur. Il avance la machine construite (model.js) à chaque pas de la simulation, avec le
// circuit : les mobiles suivent la position 0…1 de leur vérin (course × position, angle × position), les convoyeurs
// emportent les pièces posées dessus, les poussoirs les poussent ou les arrêtent, les pièces tombent du bout d'un
// tapis et se posent sur ce qu'elles trouvent (bâti, bloc, chariot, sol), la ventouse saisit et lâche, l'outil marque,
// le bec remplit, les sources déposent des pièces, les bacs les retirent et les comptent, les capteurs rendent leurs
// signaux. Cinématique seulement (boîtes alignées sur les axes, pas de dynamique) : déterministe, borné, sans hasard,
// le même code tourne dans l'application, le vérificateur des TP et les tests ; render.js ne fait que dessiner.
// Fait pour coûter peu : tout ce qui ne bouge pas (repères, boîtes, faisceaux des capteurs, zones des bacs) est
// calculé une fois par scène dans le descripteur ; seuls les mobiles et ce qu'ils portent sont refaits à chaque
// sous-pas ; les positions des vérins sont interpolées entre deux pas et le nombre de sous-pas suit ce qui bouge
// (jamais plus de 2 cm par sous-pas) ; les paires de pièces sont triées le long de x (balayage) ; les boîtes des
// pièces vivent dans la pièce (pas d'allocation dans les boucles).
// Branché dans process.js : processOf(scène « twin ») rend le descripteur de twinProcess().
import { tl } from '../i18n/index.js';
import { CATALOG, DIR_VEC, ITEMS, LIMITS, isMover, isSensor, isTwin, partLabel, signalOf, twinSignals } from './model.js';

/* ---------- Repères : origine o et matrice de rotation R (3 × 3, lignes) ---------- */
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const WORLD = { o: [0, 0, 0], R: I3 };
const rad = d => (d * Math.PI) / 180;
const clamp01 = x => Math.max(0, Math.min(1, +x || 0));
/** Rotation d'un angle a (rad) autour d'un axe local x, y ou z. */
export function rotAxis(axis, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return axis === 'x' ? [1, 0, 0, 0, c, -s, 0, s, c] : axis === 'y' ? [c, 0, s, 0, 1, 0, -s, 0, c] : [c, -s, 0, s, c, 0, 0, 0, 1];
}
const mul = (A, B) => { const M = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return M; };
const rot = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
/** Point local → monde. */
export const ap = (F, p) => { const r = rot(F.R, p); return [F.o[0] + r[0], F.o[1] + r[1], F.o[2] + r[2]]; };
/** Point monde → local (R orthonormale : l'inverse est la transposée). */
export const unap = (F, w) => { const d = [w[0] - F.o[0], w[1] - F.o[1], w[2] - F.o[2]]; return [F.R[0] * d[0] + F.R[3] * d[1] + F.R[6] * d[2], F.R[1] * d[0] + F.R[4] * d[1] + F.R[7] * d[2], F.R[2] * d[0] + F.R[5] * d[1] + F.R[8] * d[2]]; };
/** Repère composé : F puis (o, R) dans F. */
export const compose = (F, o, R) => ({ o: ap(F, o), R: mul(F.R, R) });
/** Déplacement du mobile d'une pièce pour une position x (0…1) : { o, R } dans son repère de base. */
export function moverPose(p, x) {
  const D = CATALOG[p.type];
  if (D.mover === 'linear') { const d = p.type === 'stopper' ? DIR_VEC.y : DIR_VEC[p.props.dir] || DIR_VEC.x, s = p.props.stroke * x; return { o: [d[0] * s, d[1] * s, d[2] * s], R: I3 }; }
  if (D.mover === 'rotary') return { o: [0, 0, 0], R: rotAxis(p.props.axis || 'z', rad(p.props.range * x)) };
  return { o: [0, 0, 0], R: I3 };
}
/**
 * Boîte d'un composant dans son repère mobile : { c (centre), s (dimensions) } ; null s'il n'en a pas. Partagée avec
 * le rendu : poussoir = plaque de 5 cm d'épaisseur dont la face avant est à l'origine tige rentrée ; butée = lame
 * affleurante rentrée, qui dépasse de la course sortie ; bras = barre le long de +x depuis le pivot ; outil = tête
 * derrière la pointe ; les autres posés par leur base (centre en h/2).
 */
export function bodyOf(p) {
  const s = p.size;
  if (p.type === 'frame' || p.type === 'block' || p.type === 'conveyor' || p.type === 'carriage' || p.type === 'sink') return { c: [0, s[1] / 2, 0], s: s.slice() };
  if (p.type === 'pusher') {
    const d = DIR_VEC[p.props.dir] || DIR_VEC.z, w = p.props.width, h = p.props.height, dims = [0, 0, 0], c = [0, 0, 0];
    for (let i = 0; i < 3; i++) if (d[i]) { dims[i] = 0.05; c[i] = -0.025 * d[i]; }
    if (d[1]) { dims[0] = w; dims[2] = h; } else { dims[1] = h; c[1] = h / 2; dims[d[0] ? 2 : 0] = w; }
    return { c, s: dims };
  }
  if (p.type === 'stopper') { const h = p.props.stroke + 0.02, f = p.props.face === 'z' ? 2 : 0, dims = [0, h, 0]; dims[f] = 0.04; dims[2 - f] = p.props.width; return { c: [0, -h / 2, 0], s: dims }; }
  if (p.type === 'rotary') return { c: [p.props.length / 2, 0, 0], s: [p.props.length, 0.08, 0.08] };
  if (p.type === 'tool') { const d = DIR_VEC[p.props.dir] || DIR_VEC['-y'], dims = [0.08, 0.08, 0.08]; for (let i = 0; i < 3; i++) if (d[i]) dims[i] = 0.2; return { c: [-d[0] * 0.1, -d[1] * 0.1, -d[2] * 0.1], s: dims }; }
  return null;
}
/** Boîte englobante (monde) d'une boîte locale { c, s } dans le repère F : { min, max }. */
export function aabbOf(F, b) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 8; k++) {
    const w = ap(F, [b.c[0] + (k & 1 ? 0.5 : -0.5) * b.s[0], b.c[1] + (k & 2 ? 0.5 : -0.5) * b.s[1], b.c[2] + (k & 4 ? 0.5 : -0.5) * b.s[2]]);
    for (let i = 0; i < 3; i++) { if (w[i] < min[i]) min[i] = w[i]; if (w[i] > max[i]) max[i] = w[i]; }
  }
  return { min, max };
}
/** Boîte d'une pièce (base en p, dimensions s), écrite dans la pièce (mn, mx). */
function boxOf(it) { const p = it.p, s = it.s; it.mn[0] = p[0] - s[0] / 2; it.mn[1] = p[1]; it.mn[2] = p[2] - s[2] / 2; it.mx[0] = p[0] + s[0] / 2; it.mx[1] = p[1] + s[1]; it.mx[2] = p[2] + s[2] / 2; }
const ovl = (amn, amx, bmn, bmx, eps) => amn[0] < bmx[0] - eps && amx[0] > bmn[0] + eps && amn[1] < bmx[1] - eps && amx[1] > bmn[1] + eps && amn[2] < bmx[2] - eps && amx[2] > bmn[2] + eps;
const inRect = (box, x, z, tol) => x >= box.min[0] - tol && x <= box.max[0] + tol && z >= box.min[2] - tol && z <= box.max[2] + tol;
/** Segment a → b coupe-t-il la boîte (mn, mx) ? (méthode des tranches) */
function segmentHits(a, b, mn, mx) {
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = b[i] - a[i];
    if (Math.abs(d) < 1e-12) { if (a[i] < mn[i] || a[i] > mx[i]) return false; continue; }
    let u = (mn[i] - a[i]) / d, v = (mx[i] - a[i]) / d; if (u > v) { const t = u; u = v; v = t; }
    if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) return false;
  }
  return true;
}
const X1 = [1, 0, 0], NONE = [];

/* ---------- Descripteur (process.js) : tout ce qui est fixe est calculé ici, une fois par scène ---------- */
const cache = new WeakMap();
/** Parents avant enfants. */
function topo(parts, byId) {
  const out = [], seen = new Set();
  const visit = p => { if (seen.has(p.id)) return; seen.add(p.id); if (p.parent && byId.has(p.parent)) visit(byId.get(p.parent)); out.push(p); };
  for (const p of parts) visit(p);
  return out;
}
/** Repère de base d'une pièce dans celui (mobile) de son parent. */
const baseOf = (D, p, parentMove) => compose(parentMove || WORLD, p.pos, D.ry.get(p.id));
/** Corps d'une pièce : boîte, et ce qu'on en fait. */
function bodySpec(D, p) {
  const b = bodyOf(p), K = CATALOG[p.type]; if (!b || !(K.solid || K.surface || p.type === 'sink')) return null;
  return { p, b, solid: !!K.solid, surface: !!K.surface, sink: p.type === 'sink', moving: D.dynMove.has(p.id), conveyor: p.type === 'conveyor' };
}
/** Boîte monde d'un corps dans le repère mobile F. */
const bodyAt = (sp, F) => ({ p: sp.p, box: aabbOf(F.move, sp.b), solid: sp.solid, surface: sp.surface, sink: sp.sink, moving: sp.moving, on: true, conveyor: sp.conveyor ? { dir: rot(F.move.R, X1), speed: sp.p.props.speed } : null });
/** Faisceau ou zone d'un capteur dans son repère de base F. */
function sensorAt(p, F) {
  if (p.type === 'photocell') {
    const d = rot(F.R, DIR_VEC[p.props.dir] || DIR_VEC.z), a = F.o, b = [a[0] + d[0] * p.props.range, a[1] + d[1] * p.props.range, a[2] + d[2] * p.props.range];
    return { p, a, b, mn: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], mx: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] };
  }
  const z = p.props.zone / 2;
  return { p, mn: [F.o[0] - z, F.o[1] - z, F.o[2] - z], mx: [F.o[0] + z, F.o[1] + z, F.o[2] + z] };
}
/**
 * Descripteur d'une scène construite, dans la forme des procédés de process.js : cyls (rôles = identifiants des
 * mobiles), cylRef(scène, rôle) → repère du vérin lié, sensors, acts (sources), controls (boutons, sources), outputs,
 * inputs, create/step/read/hud. Gardé par scène (objet) ; null si la scène n'est pas un jumeau.
 */
export function twinProcess(scene) {
  if (!isTwin(scene)) return null;
  let D = cache.get(scene); if (D) return D;
  const parts = scene.parts || [], byId = new Map(parts.map(p => [p.id, p])), sig = twinSignals(scene), order = topo(parts, byId);
  // Ce qui bouge : les mobiles (leur repère mobile) et tout ce qu'ils portent (base et mobile).
  const dynBase = new Set(), dynMove = new Set();
  for (const p of order) { if (p.parent && dynMove.has(p.parent)) dynBase.add(p.id); if (isMover(p) || dynBase.has(p.id)) dynMove.add(p.id); }
  D = {
    kind: 'twin', key: JSON.stringify(parts), parts, byId, order, dynBase, dynMove,
    ry: new Map(parts.map(p => [p.id, rotAxis('y', rad(p.rot))])),
    movers: order.filter(isMover), cylGrippers: parts.filter(p => p.type === 'gripper' && p.props.mode === 'cyl'),
    maxSpeed: Math.max(0, ...parts.filter(p => p.type === 'conveyor').map(p => p.props.speed)),
    cyls: sig.cyls.map(c => c.part), cylRef: (sc, key) => (byId.get(key) || { bind: {} }).bind.cyl || '',
    sensors: parts.filter(isSensor).map(p => ({ role: p.id, def: signalOf(p), label: () => partLabel(p) })),
    acts: parts.filter(p => p.type === 'source').map(p => ({ role: p.id, label: () => tl('Une pièce : {0}', partLabel(p)), icon: 'plus' })),
    controls: [...parts.filter(p => p.type === 'button').map(p => ({ role: p.id, mode: p.props.mode, label: n => (p.name ? `${p.name} (${n})` : n), defaults: p.bind.input ? [p.bind.input] : [], icon: 'pointer' })),
      ...parts.filter(p => p.type === 'source').map(p => ({ role: p.id, mode: 'click', label: () => tl('Une pièce : {0}', partLabel(p)), icon: 'plus' }))],
    outputs: sig.outputs, inputs: sig.inputs,
    create: () => createTwin(D),
    step: (s, dt, pos, acts, out) => stepTwin(D, s, dt, pos, acts, out),
    read: s => ({ ...s.sens }),
    hud: s => hudTwin(D, s)
  };
  // Repères fixes (base de tout ce qui n'est pas porté ; mobile de ce qui ne bouge pas), corps fixes, capteurs fixes.
  D.F0 = new Map();
  for (const p of order) { if (dynBase.has(p.id)) continue; const parent = p.parent ? D.F0.get(p.parent) : null; const base = baseOf(D, p, parent ? parent.move : null); D.F0.set(p.id, { base, move: isMover(p) ? null : base }); }
  D.dynList = order.filter(p => dynMove.has(p.id));
  const specs = parts.map(p => bodySpec(D, p)).filter(Boolean);
  D.staticBodies = specs.filter(sp => !sp.moving).map(sp => bodyAt(sp, D.F0.get(sp.p.id)));
  D.dynSpecs = specs.filter(sp => sp.moving);
  D.staticSensors = parts.filter(p => isSensor(p) && !dynBase.has(p.id)).map(p => sensorAt(p, D.F0.get(p.id).base));
  D.dynSensors = parts.filter(p => isSensor(p) && dynBase.has(p.id));
  D.sources = parts.filter(p => p.type === 'source'); D.grippers = parts.filter(p => p.type === 'gripper'); D.tools = parts.filter(p => p.type === 'tool'); D.dispensers = parts.filter(p => p.type === 'dispenser');
  D.sinks = D.staticBodies.some(b => b.sink) || D.dynSpecs.some(sp => sp.sink);
  cache.set(scene, D);
  return D;
}

/** État neuf : pas de pièce, mobiles rentrés, compteurs à zéro. */
export function createTwin(D) {
  const src = {}; for (const p of D.sources) src[p.id] = { next: p.props.every > 0 ? 1 : Infinity, n: 0 };
  return { key: D.key, actRoles: D.acts.map(a => a.role), t: 0, n: 1, items: [], disp: {}, src, edge: {}, sens: {}, counts: {}, lost: 0, machined: 0, spill: 0, spilling: false, lostAt: -9, hold: {} };
}

/**
 * Un pas de dt s. pos(rôle) → position 0…1 du vérin lié ; acts : actions reçues (rôles de sources) ; out(nom) → sortie
 * vraie ? Les mobiles vont de leur position précédente à la nouvelle en ligne droite, par sous-pas tels que rien ne
 * parcoure plus de 2 cm (ni plus de 50 ms) d'un coup.
 */
export function stepTwin(D, s, dt, pos, acts, out) {
  const read = n => !!(out && n && out(n)), cur = {}; let delta = 0;
  for (const p of D.movers) {
    const x = clamp01(pos(p.id)), prev = s.disp[p.id]; cur[p.id] = x;
    if (prev != null) delta = Math.max(delta, Math.abs(x - prev) * (CATALOG[p.type].mover === 'rotary' ? Math.abs(rad(p.props.range)) * p.props.length : p.props.stroke));
  }
  for (const p of D.cylGrippers) cur[p.id] = clamp01(pos(p.id));
  const n = Math.min(20, Math.max(1, Math.ceil(dt / 0.05), Math.ceil(delta / 0.02), Math.ceil((dt * D.maxSpeed) / 0.02))), h = dt / n, prev = { ...s.disp };
  // Repères du sous-pas : les fixes posés une fois, les mobiles refaits ; gardés à côté de l'état (pas dedans : l'état s'enregistre tel quel).
  let F = frames.get(s);
  if (!F || F.D !== D) { F = new Map(); F.D = D; for (const [id, f] of D.F0) if (f.move) F.set(id, f); frames.set(s, F); }
  for (let k = 1; k <= n; k++) {
    for (const id in cur) s.disp[id] = prev[id] == null ? cur[id] : prev[id] + ((cur[id] - prev[id]) * k) / n;
    substep(D, s, h, k === 1 ? acts : NONE, read, F);
  }
  return s;
}
const frames = new WeakMap();
function substep(D, s, h, acts, out, F) {
  s.t += h;
  // 1. Repères de ce qui bouge (parents avant enfants).
  for (const p of D.dynList) {
    const parent = p.parent ? F.get(p.parent) : null, base = D.dynBase.has(p.id) ? baseOf(D, p, parent ? parent.move : null) : D.F0.get(p.id).base;
    const m = isMover(p) ? moverPose(p, s.disp[p.id] || 0) : null;
    F.set(p.id, { base, move: m ? compose(base, m.o, m.R) : base });
  }
  // 2. Corps : les fixes tels quels, les mobiles refaits ; marche des convoyeurs.
  const bodies = D.staticBodies.slice();
  for (const sp of D.dynSpecs) bodies.push(bodyAt(sp, F.get(sp.p.id)));
  for (const b of bodies) if (b.conveyor) b.on = b.p.bind.out ? out(b.p.bind.out) : true;
  const byPart = new Map(); for (const b of bodies) byPart.set(b.p.id, b);
  const items = s.items;
  if (items.length) {
    // 3. Pièces : portées (chariot, ventouse), emportées (convoyeur), en chute, posées.
    for (const it of items) {
      if (it.held) { const g = F.get(it.held); if (g) it.p = ap(g.move, it.local); it.slow = false; boxOf(it); continue; }
      const on = it.on && it.on.id !== 'floor' ? byPart.get(it.on.id) : null;
      if (on && on.moving) it.p = ap(F.get(on.p.id).move, it.local); // le support bouge : la pièce suit
      if (on && on.conveyor && on.on) { const v = on.conveyor.speed * h * (it.slow ? 0.3 : 1); it.p[0] += on.conveyor.dir[0] * v; it.p[2] += on.conveyor.dir[2] * v; }
      it.slow = false;
      if (!it.on) { // chute : se pose sur la première surface rencontrée (ou le sol)
        it.vy -= 9.81 * h; const y1 = it.p[1] + it.vy * h; let land = null;
        for (const b of bodies) if (b.surface && b.box.max[1] <= it.p[1] + 1e-6 && b.box.max[1] >= y1 && inRect(b.box, it.p[0], it.p[2], 0.01) && (!land || b.box.max[1] > land.box.max[1])) land = b;
        if (land) { it.p[1] = land.box.max[1]; it.vy = 0; it.on = { id: land.p.id }; it.local = unap(F.get(land.p.id).move, it.p); }
        else if (y1 <= 0) { it.p[1] = 0; it.vy = 0; it.on = { id: 'floor' }; it.rest = 0; }
        else it.p[1] = y1;
      } else if (it.on.id === 'floor') it.rest += h;
      else { // posée : encore portée ? (sinon elle tombe)
        let best = null;
        for (const b of bodies) if (b.surface && Math.abs(b.box.max[1] - it.p[1]) <= 0.03 && inRect(b.box, it.p[0], it.p[2], 0.02) && (!best || b.box.max[1] > best.box.max[1])) best = b;
        if (!best) { it.on = null; it.vy = 0; } else { it.p[1] = best.box.max[1]; if (best.p.id !== it.on.id) it.on = { id: best.p.id }; it.local = unap(F.get(best.p.id).move, it.p); }
      }
      boxOf(it);
    }
    // 4. Collisions : pièces entre elles (balayage le long de x), puis les pleins repoussent les pièces (le poussoir
    //    pousse, la butée arrête) ; deux passes.
    const free = items.filter(it => !it.held);
    for (let pass = 0; pass < 2; pass++) {
      free.sort((a, b) => a.mn[0] - b.mn[0] || a.id - b.id);
      for (let i = 0; i < free.length; i++) {
        const a = free[i];
        for (let j = i + 1; j < free.length && free[j].mn[0] < a.mx[0] - 1e-6; j++) {
          const b = free[j];
          if (!(a.mn[1] < b.mx[1] - 1e-6 && a.mx[1] > b.mn[1] + 1e-6 && a.mn[2] < b.mx[2] - 1e-6 && a.mx[2] > b.mn[2] + 1e-6)) continue;
          const dx = Math.min(a.mx[0] - b.mn[0], b.mx[0] - a.mn[0]), dz = Math.min(a.mx[2] - b.mn[2], b.mx[2] - a.mn[2]);
          const ax = dx <= dz ? 0 : 2, d = (ax ? dz : dx) / 2, sgn = a.p[ax] <= b.p[ax] ? -1 : 1;
          a.p[ax] += sgn * d; b.p[ax] -= sgn * d; boxOf(a); boxOf(b);
        }
      }
      for (const it of free) {
        for (const b of bodies) {
          if (!b.solid || (it.on && it.on.id === b.p.id) || !ovl(it.mn, it.mx, b.box.min, b.box.max, 1e-6)) continue;
          if (b.box.max[1] <= it.p[1] + 0.02 || it.mx[1] <= b.box.min[1] + 0.02) continue; // au-dessus ou au-dessous : pas en travers
          const dx = Math.min(it.mx[0] - b.box.min[0], b.box.max[0] - it.mn[0]), dz = Math.min(it.mx[2] - b.box.min[2], b.box.max[2] - it.mn[2]);
          const ax = dx <= dz ? 0 : 2, c = (b.box.min[ax] + b.box.max[ax]) / 2;
          it.p[ax] += (it.p[ax] < c ? -1 : 1) * (ax ? dz : dx); boxOf(it);
          if (b.moving) it.slow = true; // frottée par un mobile : elle avance moins vite sur le tapis
        }
        if (it.on && it.on.id !== 'floor' && byPart.has(it.on.id)) it.local = unap(F.get(it.on.id).move, it.p);
      }
    }
  }
  // 5. Ventouses, outils, becs.
  for (const p of D.grippers) {
    const Fm = F.get(p.id).move, on = p.props.mode === 'cyl' ? (s.disp[p.id] || 0) >= 0.98 : out(p.bind.out), cup = Fm.o;
    let held = null; for (const it of items) if (it.held === p.id) { held = it; break; }
    if (on && !held) {
      let best = null, bd = Infinity;
      for (const it of items) { if (it.held) continue; const gap = cup[1] - (it.p[1] + it.s[1]); if (gap < -0.02 || gap > p.props.reach || Math.abs(cup[0] - it.p[0]) > it.s[0] / 2 + 0.02 || Math.abs(cup[2] - it.p[2]) > it.s[2] / 2 + 0.02) continue; if (gap < bd) { bd = gap; best = it; } }
      if (best) { best.held = p.id; best.on = null; best.vy = 0; best.p = [cup[0], cup[1] - best.s[1] - 0.005, cup[2]]; best.local = unap(Fm, best.p); boxOf(best); }
    } else if (!on && held) { held.held = null; held.on = null; held.vy = 0; }
  }
  for (const p of D.tools) {
    const x = s.disp[p.id] || 0;
    if (x >= 0.98 && !s.edge[p.id]) {
      s.edge[p.id] = true;
      const d = DIR_VEC[p.props.dir] || DIR_VEC['-y'], zone = aabbOf(F.get(p.id).move, { c: [d[0] * 0.05, d[1] * 0.05, d[2] * 0.05], s: [0.16, 0.1, 0.16] });
      for (const it of items) if (!it.done && ovl(it.mn, it.mx, zone.min, zone.max, 0)) { it.done = true; s.machined++; }
    }
    if (x < 0.9) s.edge[p.id] = false;
  }
  for (const p of D.dispensers) {
    if (!out(p.bind.out)) { s.spilling = false; continue; }
    const nz = F.get(p.id).move.o; let u = null;
    for (const it of items) if (Math.abs(it.p[0] - nz[0]) <= 0.06 && Math.abs(it.p[2] - nz[2]) <= 0.06 && it.mx[1] <= nz[1] + 0.01 && it.mx[1] >= nz[1] - 0.5) { u = it; break; }
    if (u) { s.spilling = false; if (u.fill < 1) u.fill = Math.min(1, u.fill + h / p.props.fillTime); } else { s.spilling = true; s.spill += h; }
  }
  // 6. Sources (période, bouton, front montant de la sortie), bacs, sol.
  for (const p of D.sources) {
    const q = s.src[p.id] || (s.src[p.id] = { next: p.props.every > 0 ? 1 : Infinity, n: 0 }), sig = p.bind.out ? out(p.bind.out) : false;
    let want = acts.includes(p.id) || (sig && !s.edge['src:' + p.id]); s.edge['src:' + p.id] = sig;
    if (s.t >= q.next) { q.next += p.props.every; want = true; }
    if (want) spawn(D, s, p, F.get(p.id).base);
  }
  if (items.length) {
    let w = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]; let keep = true;
      if (!it.held) {
        if (it.on && it.on.id === 'floor' && it.rest >= 1.5) { s.lost++; s.lostAt = s.t; keep = false; }
        else if (D.sinks) {
          const cx = it.p[0], cy = it.p[1] + it.s[1] / 2, cz = it.p[2];
          for (const b of bodies) {
            if (!b.sink || cx < b.box.min[0] || cx > b.box.max[0] || cy < b.box.min[1] || cy > b.box.max[1] || cz < b.box.min[2] || cz > b.box.max[2]) continue;
            const k = s.counts[b.p.id] || (s.counts[b.p.id] = { ok: 0, bad: 0 }), a = b.p.props.accept;
            const good = a === 'any' || (a === 'full' && it.fill >= 0.98) || (a === 'done' && it.done) || (a === 'empty' && it.fill <= 0.02 && !it.done);
            if (good) k.ok++; else k.bad++;
            keep = false; break;
          }
        }
      }
      if (keep) items[w++] = it;
    }
    items.length = w;
  }
  // 7. Capteurs : faisceaux et zones fixes précalculés, les autres d'après leur repère.
  for (const z of D.staticSensors) s.sens[z.p.id] = sense(z, items);
  for (const p of D.dynSensors) s.sens[p.id] = sense(sensorAt(p, F.get(p.id).base), items);
}
/** Un capteur voit-il une pièce ? (NC : inversé) */
function sense(z, items) {
  const p = z.p, f = p.props.detect; let v = false;
  for (const it of items) {
    if (!ovl(it.mn, it.mx, z.mn, z.mx, 0)) continue;
    if (z.a) { if (segmentHits(z.a, z.b, it.mn, it.mx)) { v = true; break; } }
    else if (f === 'any' || (f === 'full' ? it.fill >= 0.98 : it.done)) { v = true; break; }
  }
  return p.props.nc ? !v : v;
}
/** Pièce neuve à la source si la place est libre et les quotas respectés. */
function spawn(D, s, p, Fb) {
  const q = s.src[p.id], K = ITEMS[p.props.item] || ITEMS.box;
  if (s.items.length >= LIMITS.items) return false;
  let mine = 0; for (const it of s.items) if (it.src === p.id) mine++;
  if (mine >= p.props.max) return false;
  const it = { id: s.n, kind: p.props.item, src: p.id, p: Fb.o.slice(), s: K.size.slice(), mn: [0, 0, 0], mx: [0, 0, 0], fill: 0, done: false, held: null, on: null, vy: 0, rest: 0, slow: false, color: p.props.color || K.color };
  boxOf(it);
  for (const o of s.items) if (ovl(o.mn, o.mx, it.mn, it.mx, -0.02)) return false;
  s.n++; s.items.push(it); q.n++;
  return true;
}
/** Lignes du bandeau : bacs (bonnes, mauvaises), usinées, tombées, alarmes. */
export function hudTwin(D, s) {
  const out = [];
  for (const p of D.parts) if (p.type === 'sink') { const k = s.counts[p.id] || { ok: 0, bad: 0 }; out.push({ label: partLabel(p), value: k.bad ? `${k.ok} (+${k.bad} ✗)` : String(k.ok), warn: k.bad > 0 }); }
  if (D.tools.length) out.push({ label: tl('Usinées'), value: String(s.machined) });
  if (s.lost) out.push({ label: tl('Tombées'), value: String(s.lost), warn: true });
  if (s.spilling) out.push({ alarm: tl('Le bec coule à vide : aucune pièce dessous !') });
  if (s.t - s.lostAt < 2) out.push({ alarm: tl('Pièce tombée au sol !') });
  return out;
}
/** Repères de toutes les pièces pour une position des mobiles (éditeur, tests) : Map(id → { base, move }). */
export function framesOf(D, disp = {}) {
  const F = new Map();
  for (const p of D.order) {
    const parent = p.parent ? F.get(p.parent) : null, base = baseOf(D, p, parent ? parent.move : null);
    const m = isMover(p) ? moverPose(p, disp[p.id] || 0) : null;
    F.set(p.id, { base, move: m ? compose(base, m.o, m.R) : base });
  }
  return F;
}
