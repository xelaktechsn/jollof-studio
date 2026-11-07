// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Timeline de la vidéo : quand chaque fil se trace, où va la caméra, quelle légende s'affiche.
// Module pur (ni DOM ni THREE) : main.js applique son résultat à la scène, le rendu vidéo
// l'échantillonne image par image, et les tests le vérifient sous Node.
//
// Forme enregistrée dans le projet (settings.timeline) :
//   { v: 1,
//     auto: 'seq' | 'all' | null,   // non nul : refaite à partir des fils et de la « Durée par fil »
//     camAuto: true,                // vrai : les plans de caméra sont répartis sur toute la durée
//     pad, hold,                    // pause après le dernier fil, puis fin (« Circuit câblé »)
//     wires: [{ id:'c1', ws:['w3'], t, d, grp? }],      // un extrait trace un ou plusieurs fils
//                                                       // (grp : « tracés ensemble », même s'il n'y en a qu'un)
//     cam:   [{ id:'k1', shot:'s2', t, ease:'smooth'|'cut' }],
//     caps:  [{ id:'t1', t, d, text }] }                // légendes écrites à la main
// Les extraits de fils restent triés par instant de départ ; un fil n'appartient qu'à un extrait.

export const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = t => Math.max(0, Math.min(1, t));
/** Amorce avant le premier fil et pause finale, en secondes (mêmes valeurs qu'avant la timeline). */
export const LEAD = 0.6, HOLD = 1.6;
export const MIN_D = 0.05, MAX_T = 3600, MAX_D = 600;

/** Identifiant suivant d'une liste (« c » + plus grand numéro + 1). */
export function nextId(prefix, list) {
  let n = 0;
  for (const x of list) {
    const id = x && x.id;
    if (typeof id === 'string' && id[0] === prefix) { const k = +id.slice(1); if (k > n) n = k; }
  }
  return prefix + (n + 1);
}

export const sortClips = tl => { tl.wires.sort((a, b) => a.t - b.t); tl.cam.sort((a, b) => a.t - b.t); tl.caps.sort((a, b) => a.t - b.t); return tl; };

/**
 * Timeline automatique : `seq` trace les fils un par un, `all` tous ensemble.
 * Reprend exactement les durées d'avant (amorce 0,6 s, écart 1,25 × D, pause 1,6 s).
 * Les légendes et la caméra de `prev` sont gardées.
 */
export function buildAuto(mode, wireIds, D, prev) {
  const tl = {
    v: 1, auto: mode === 'all' ? 'all' : 'seq', camAuto: prev ? prev.camAuto !== false : true,
    pad: 0, hold: HOLD, wires: [],
    cam: prev ? prev.cam.map(k => ({ ...k })) : [], caps: prev ? prev.caps.map(c => ({ ...c })) : []
  };
  if (tl.auto === 'all') { if (wireIds.length) tl.wires.push({ id: 'c1', ws: [...wireIds], t: LEAD, d: D * 1.8, grp: true }); }
  else {
    const gap = D * 1.25; tl.pad = D * 0.25;
    wireIds.forEach((w, i) => tl.wires.push({ id: 'c' + (i + 1), ws: [w], t: LEAD + i * gap, d: D }));
  }
  return tl;
}

/** Instant où le dernier fil est tracé : la légende passe à « Circuit câblé ». */
export function doneAt(tl) { let e = 0; for (const c of tl.wires) e = Math.max(e, c.t + c.d); return e + tl.pad; }
/** Fin sans compter la caméra (sert à répartir les plans). */
function baseEnd(tl) { let e = doneAt(tl) + tl.hold; for (const c of tl.caps) e = Math.max(e, c.t + c.d); return e; }
/** Durée totale de la vidéo, en secondes. */
export function end(tl) { let e = baseEnd(tl); for (const k of tl.cam) e = Math.max(e, k.t); return e; }

/** Caméra automatique : plans répartis du début à la fin, comme avant la timeline. */
export function fitCam(tl, shotIds) {
  if (!tl.camAuto) return tl;
  const n = shotIds.length, E = baseEnd(tl);
  tl.cam = shotIds.map((s, k) => ({ id: 'k' + (k + 1), shot: s, t: n > 1 ? (k * E) / (n - 1) : 0, ease: 'smooth' }));
  return tl;
}

/**
 * Met la timeline d'accord avec le montage. Automatique : refaite. Manuelle : les fils retirés
 * quittent leurs extraits, les nouveaux fils sont ajoutés à la suite. Rend le nombre de fils ajoutés.
 */
export function sync(tl, wireIds, shotIds, D) {
  let added = 0;
  if (tl.auto) Object.assign(tl, buildAuto(tl.auto, wireIds, D, tl));
  else {
    const have = new Set(wireIds), seen = new Set();
    tl.wires = tl.wires.map(c => ({ ...c, ws: c.ws.filter(w => have.has(w) && !seen.has(w) && seen.add(w)) })).filter(c => c.ws.length);
    const fresh = wireIds.filter(w => !seen.has(w));
    if (fresh.length) { appendWires(tl, fresh, D); added = fresh.length; }
  }
  const shots = new Set(shotIds);
  tl.cam = tl.cam.filter(k => shots.has(k.shot));
  if (!tl.camAuto) {
    // Plan ajouté depuis l'onglet Vidéo : il prend place à la fin de la timeline.
    const used = new Set(tl.cam.map(k => k.shot)), last = tl.cam.length ? tl.cam[tl.cam.length - 1].t : 0;
    shotIds.filter(s => !used.has(s)).forEach((s, i) => tl.cam.push({ id: nextId('k', tl.cam), shot: s, t: Math.max(last, doneAt(tl)) + i * 1.5, ease: 'smooth' }));
  }
  fitCam(tl, shotIds);
  sortClips(tl);
  return added;
}

/** Ajoute des fils à la suite des extraits existants, un par un. */
export function appendWires(tl, ids, D) {
  // Même écart qu'en automatique : le fil suivant part 0,25 × D après la fin du précédent.
  let t = tl.wires.length ? tl.wires.reduce((e, c) => Math.max(e, c.t + c.d), 0) + D * 0.25 : LEAD;
  for (const w of ids) { tl.wires.push({ id: nextId('c', tl.wires), ws: [w], t, d: D }); t += D * 1.25; }
  sortClips(tl);
}

/**
 * État de la vidéo à l'instant T (secondes depuis le début).
 * `shots` : Map identifiant → { p, t }. Rend l'avancement de chaque fil (un fil absent de la
 * timeline reste tracé), l'extrait en cours, la légende écrite à la main et la caméra.
 */
export function evalAt(tl, T, shots) {
  const prog = new Map();
  let cur = -1;
  tl.wires.forEach((c, i) => {
    const p = ease(clamp((T - c.t) / c.d));
    for (const w of c.ws) prog.set(w, p);
    if (T >= c.t) cur = i;
  });
  const started = cur >= 0;
  if (!started && tl.wires.length) cur = 0;
  const cap = tl.caps.find(c => T >= c.t && T < c.t + c.d) || null;
  return { prog, cur, started, done: T >= doneAt(tl), cap, cam: camAt(tl, T, shots) };
}

/** Position de la caméra à l'instant T : glisse d'un plan au suivant, ou coupe nette. */
export function camAt(tl, T, shots) {
  const ks = tl.cam.filter(k => shots.has(k.shot));
  if (!ks.length) return null;
  if (ks.length === 1 || T <= ks[0].t) return shots.get(ks[0].shot);
  for (let i = 0; i < ks.length - 1; i++) {
    const A = ks[i], B = ks[i + 1];
    if (T >= B.t) continue;
    const a = shots.get(A.shot);
    if (B.ease === 'cut') return a;
    const b = shots.get(B.shot), k = ease(clamp((T - A.t) / (B.t - A.t)));
    const mix = (u, v) => u.map((x, j) => x + (v[j] - x) * k);
    return { p: mix(a.p, b.p), t: mix(a.t, b.t) };
  }
  return shots.get(ks[ks.length - 1].shot);
}

/**
 * Copie vérifiée d'une timeline reçue (fichier, projet de groupe, copie d'élève) : nombres
 * bornés, identifiants de simples mots, tableaux limités, textes passés par `clean`.
 * Rend null si l'entrée n'est pas une timeline.
 */
export function normalize(raw, clean = (s, max) => String(s ?? '').slice(0, max)) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.wires)) return null;
  const ref = (s, p) => (typeof s === 'string' && new RegExp(`^${p}\\d{1,6}$`).test(s) ? s : null);
  const at = v => (Number.isFinite(+v) ? Math.min(MAX_T, Math.max(0, +v)) : null);
  const dur = v => (Number.isFinite(+v) ? Math.min(MAX_D, Math.max(MIN_D, +v)) : null);
  const list = a => (Array.isArray(a) ? a.filter(x => x && typeof x === 'object') : []);
  const ids = new Set();
  const own = (x, p, out) => {
    let id = ref(x.id, p);
    if (!id || ids.has(id)) { id = nextId(p, out); while (ids.has(id)) id = p + (+id.slice(1) + 1); }
    ids.add(id); return id;
  };
  const tl = {
    v: 1, auto: raw.auto === 'seq' || raw.auto === 'all' ? raw.auto : null, camAuto: raw.camAuto !== false,
    pad: Math.min(60, at(raw.pad) ?? 0), hold: Math.min(60, at(raw.hold) ?? HOLD), wires: [], cam: [], caps: []
  };
  const seen = new Set();
  for (const c of list(raw.wires).slice(0, 2000)) {
    const t = at(c.t), d = dur(c.d);
    if (t == null || d == null) continue; // extrait refusé : ses fils restent libres pour un autre
    const ws = Array.isArray(c.ws) ? c.ws.map(w => ref(w, 'w')).filter(w => w && !seen.has(w) && seen.add(w)).slice(0, 2000) : [];
    if (ws.length) tl.wires.push({ id: own(c, 'c', tl.wires), ws, t, d, ...(c.grp === true ? { grp: true } : {}) });
  }
  for (const k of list(raw.cam).slice(0, 200)) {
    const t = at(k.t), shot = ref(k.shot, 's');
    if (t != null && shot) tl.cam.push({ id: own(k, 'k', tl.cam), shot, t, ease: k.ease === 'cut' ? 'cut' : 'smooth' });
  }
  for (const c of list(raw.caps).slice(0, 200)) {
    const t = at(c.t), d = dur(c.d), text = clean(c.text, 120);
    if (t != null && d != null && text) tl.caps.push({ id: own(c, 't', tl.caps), t, d, text });
  }
  return sortClips(tl);
}

/** Un extrait trace-t-il ses fils ensemble (légende « Câblage de n fils », pas de broches allumées) ? */
export const together = c => !!c && (c.grp === true || c.ws.length > 1);

/** Copie profonde (instantanés de l'historique, état temporaire de l'aperçu). */
export const clone = tl => ({ ...tl, wires: tl.wires.map(c => ({ ...c, ws: [...c.ws] })), cam: tl.cam.map(k => ({ ...k })), caps: tl.caps.map(c => ({ ...c })) });
