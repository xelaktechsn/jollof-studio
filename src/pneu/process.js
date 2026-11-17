// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : le procédé des machines industrielles, simulé avec le circuit à chaque pas, que la vue 3D soit ouverte
// ou non. Le procédé lit la position des vérins et rend des capteurs (pièce en position, magasin vide, bouteille sous
// le bec, niveau atteint, voiture devant la barrière…) que le GRAFCET, l'automate et le montage lisent comme des
// capteurs du plan. Sans interface ni hasard : le même code tourne dans l'application, dans le vérificateur des TP et
// dans les tests ; la vue 3D (machine.js) ne fait que le dessiner.
// - « Magasin et transfert » : un magasin à gravité, un poussoir qui amène la pièce du bas en position de prise, un bras
//   de transfert et une ventouse qui descend ; capteurs mag (pièce dans le magasin) et pp (pièce en position) ;
// - « Embouteillage » : un tapis apporte des bouteilles, une butée les arrête sous le bec, le bec descend et remplit ;
//   capteurs pb (bouteille sous le bec) et niv (niveau atteint) ; jus renversé si le bec coule sans bouteille ;
// - « Barrière de parking » : des voitures arrivent, attendent à la boucle de détection, passent quand la lisse est
//   levée ; capteurs veh (voiture devant) et pass (voiture sous la lisse) ; choc si la lisse descend sur une voiture.
import { tl } from '../i18n/index.js';
import { twinProcess } from '../twin/engine.js';

export const clamp01 = x => Math.max(0, Math.min(1, +x || 0));
export const isCyl = e => e.type === 'cyl1' || e.type === 'cyl2';
/** Vérin d'un rôle : par identifiant ou repère (ref), sinon le i-ème vérin du circuit. */
export function cylOf(circuit, ref, i = 0) {
  const cs = circuit.elements.filter(isCyl);
  return (ref && cs.find(x => x.id === ref || (x.p && x.p.label) === ref)) || cs[i] || null;
}

/** Magasin : pièces au départ. Positions des vérins qui comptent : fin de course (0,98), course rendue (0,9). */
export const FEED = { mag: 6, end: 0.98, back: 0.9 };
/**
 * Embouteillage (m, s) : tapis de x0 à x1, butée et bec en xs, vitesse du tapis, entraxe mini des bouteilles, durée de
 * remplissage, bouteilles toutes les « every » s (la première à « first »), tolérance du capteur de présence.
 */
export const FILL = { x0: -1.1, x1: 1.0, xs: 0.25, speed: 0.22, gap: 0.14, fillTime: 3, every: 8, first: 1.5, tol: 0.03 };
/**
 * Barrière (m, s) : voitures de xin à xout, ligne d'arrêt (avant de la voiture) à xwait, lisse en xbar, vitesse,
 * longueur d'une voiture, boucle de détection de « loop » avant la ligne d'arrêt, zone sous la lisse ± zone,
 * distance entre deux voitures.
 */
export const BAR = { xin: -3.4, xwait: -0.9, xbar: 0, xout: 3.4, speed: 1.3, len: 1.0, loop: 0.6, zone: 0.25, follow: 0.4, open: 0.9, hit: 0.3 };

/* ---------- Magasin et transfert ---------- */
const feeder = {
  kind: 'feeder',
  cyls: ['push', 'arm', 'down'],
  sensors: [{ role: 'mag', def: 'mag', label: () => tl('Pièce dans le magasin') }, { role: 'pp', def: 'pp', label: () => tl('Pièce en position de prise') }],
  acts: [{ role: 'refill', label: () => tl('Remplir le magasin'), icon: 'plus' }],
  create: () => ({ n: FEED.mag, part: false, held: false, done: 0, jam: 0, jamming: false, pushed: false, downed: false }),
  step(s, dt, pos, acts) {
    const a = pos('push'), b = pos('arm'), c = pos('down');
    for (const r of acts) if (r === 'refill') s.n = FEED.mag;
    // Poussoir en bout de course : la pièce du bas est en position de prise ; s'il y en avait déjà une, c'est un bourrage.
    if (a >= FEED.end && !s.pushed) { s.pushed = true; if (s.part) { s.jam++; s.jamming = true; } else if (s.n > 0) { s.n--; s.part = true; } }
    if (a < FEED.back) { s.pushed = false; s.jamming = false; }
    // Ventouse en bas : à la prise (bras rentré) elle emporte la pièce ; à la dépose (bras sorti) elle la lâche.
    if (c >= FEED.end && !s.downed) { s.downed = true; if (b <= 0.02 && s.part && !s.held) { s.part = false; s.held = true; } else if (b >= FEED.end && s.held) { s.held = false; s.done++; } }
    if (c < FEED.back) s.downed = false;
  },
  read: s => ({ mag: s.n > 0, pp: s.part }),
  hud: s => [{ label: tl('Magasin'), value: String(s.n), warn: !s.n }, { label: tl('Transférées'), value: String(s.done) }, ...(s.jamming ? [{ alarm: tl('Bourrage : une pièce était déjà en position de prise !') }] : [])]
};

/* ---------- Embouteillage ---------- */
const underNozzle = s => s.bottles.find(b => Math.abs(b.x - FILL.xs) < FILL.tol) || null;
const filler = {
  kind: 'filler',
  cyls: ['stop', 'fill'],
  sensors: [{ role: 'pb', def: 'pb', label: () => tl('Bouteille sous le bec') }, { role: 'niv', def: 'niv', label: () => tl('Niveau atteint') }],
  acts: [{ role: 'bottle', label: () => tl('Une bouteille'), icon: 'plus' }],
  create: () => ({ bottles: [], t: 0, next: FILL.first, full: 0, bad: 0, spill: 0, spilling: false }),
  step(s, dt, pos, acts) {
    const K = FILL, stop = pos('stop') >= 0.5, fill = pos('fill') >= 0.98;
    s.t += dt;
    const room = () => !s.bottles.some(b => b.x < K.x0 + K.gap);
    // L'amont de la ligne apporte une bouteille à intervalle régulier ; le bouton en ajoute une.
    if (s.t >= s.next) { s.next += K.every; if (room()) s.bottles.push({ x: K.x0, lvl: 0 }); }
    for (const r of acts) if (r === 'bottle' && room()) s.bottles.push({ x: K.x0, lvl: 0 });
    s.bottles.sort((p, q) => q.x - p.x);
    let lim = Infinity;
    for (const b of s.bottles) {
      let nx = b.x + K.speed * dt;
      if (stop && b.x <= K.xs + 1e-9 && nx > K.xs) nx = K.xs; // la butée arrête la bouteille sous le bec
      if (nx > lim - K.gap) nx = Math.max(b.x, lim - K.gap); // derrière la bouteille de devant
      b.x = nx; lim = b.x;
    }
    const u = underNozzle(s);
    s.spilling = false;
    if (fill) { if (u && u.lvl < 1) u.lvl = Math.min(1, u.lvl + dt / K.fillTime); else { s.spilling = true; s.spill += dt; } }
    s.bottles = s.bottles.filter(b => { if (b.x < K.x1) return true; if (b.lvl >= 0.98) s.full++; else s.bad++; return false; });
  },
  read: s => { const u = underNozzle(s); return { pb: !!u, niv: !!u && u.lvl >= 0.98 }; },
  hud: s => [{ label: tl('Pleines'), value: String(s.full) }, { label: tl('Mal remplies'), value: String(s.bad), warn: s.bad > 0 }, ...(s.spilling ? [{ alarm: tl('Jus renversé : le bec coule sans bouteille pleine à remplir !') }] : [])]
};

/* ---------- Barrière de parking ---------- */
const barrier = {
  kind: 'barrier',
  cyls: ['lift'],
  sensors: [{ role: 'veh', def: 'veh', label: () => tl('Voiture devant la barrière') }, { role: 'pass', def: 'pass', label: () => tl('Voiture sous la lisse') }],
  acts: [{ role: 'car', label: () => tl('Une voiture'), icon: 'car' }],
  create: () => ({ cars: [], passed: 0, hit: 0, hitting: false }),
  step(s, dt, pos, acts) {
    const K = BAR, lift = pos('lift'), open = lift >= K.open;
    for (const r of acts) if (r === 'car' && !s.cars.some(c => c.x < K.xin + K.len + K.follow)) s.cars.push({ x: K.xin });
    s.cars.sort((p, q) => q.x - p.x);
    let lim = Infinity;
    const stopAt = K.xwait - K.len / 2; // centre de la voiture quand son avant est à la ligne d'arrêt
    for (const c of s.cars) {
      let nx = c.x + K.speed * dt;
      if (!open && c.x <= stopAt + 1e-9 && nx > stopAt) nx = stopAt;
      if (nx > lim - K.len - K.follow) nx = Math.max(c.x, lim - K.len - K.follow);
      c.x = nx; lim = c.x;
    }
    const under = s.cars.some(c => Math.abs(c.x - K.xbar) < K.len / 2 + K.zone);
    if (under && lift < K.hit) { if (!s.hitting) { s.hitting = true; s.hit++; } } else s.hitting = false;
    s.cars = s.cars.filter(c => { if (c.x < K.xout) return true; s.passed++; return false; });
  },
  read: s => {
    const K = BAR;
    return {
      veh: s.cars.some(c => c.x + K.len / 2 > K.xwait - K.loop && c.x - K.len / 2 < K.xwait),
      pass: s.cars.some(c => Math.abs(c.x - K.xbar) < K.len / 2 + K.zone)
    };
  },
  hud: s => [{ label: tl('Passées'), value: String(s.passed) }, ...(s.hit ? [{ label: tl('Chocs'), value: String(s.hit), warn: true }] : []), ...(s.hitting ? [{ alarm: tl('Choc : la lisse descend sur une voiture !') }] : [])]
};

/**
 * Procédés par scène (circuit.scene.kind) : cyls, rôles de vérins dans l'ordre (circuit.scene[rôle] : identifiant ou
 * repère, sinon le i-ème vérin) ; sensors [{ role, def, label() }] : capteurs, nommés circuit.scene[rôle] ou def ;
 * acts [{ role, label(), icon }] : actions (un clic) ; create() ; step(état, dt, pos(rôle) → 0…1, actions) ; read(état)
 * → { rôle: état du capteur } ; hud(état) → [{ label, value, warn } | { alarm }].
 */
export const PROCESSES = { feeder, filler, barrier };
/**
 * Procédé d'une scène : une machine du registre (feeder, filler, barrier), ou le jumeau construit par l'utilisateur
 * (scène « twin », src/twin : même forme de descripteur, avec en plus key (structure de la scène), cylRef, controls,
 * outputs, inputs).
 */
export const processOf = scene => (scene && (PROCESSES[scene.kind] || twinProcess(scene))) || null;
/** État neuf d'un procédé (descripteur, ou clé du registre) ; acts : actions reçues, consommées au pas suivant. */
export function createProcess(d) { const D = typeof d === 'string' ? PROCESSES[d] : d; return { kind: D.kind, acts: [], ...D.create() }; }
/** Action d'une commande (un colis, une voiture, remplir, une pièce d'une source) : prise en compte au pas suivant. */
export function actProcess(s, role) {
  if (!s || s.acts.length >= 8) return;
  const roles = s.actRoles || (PROCESSES[s.kind] ? PROCESSES[s.kind].acts.map(a => a.role) : []);
  if (roles.includes(role)) s.acts.push(role);
}
/** Un pas de dt s (borné à 0,1 s) : pos(rôle) → position 0…1 du vérin du rôle ; out(nom) → sortie vraie ? (jumeau) ; D : descripteur (jumeau). */
export function stepProcess(s, dt, pos, out = null, D = null) {
  D = D || PROCESSES[s.kind]; if (!D) return s;
  D.step(s, Math.max(0, Math.min(0.1, +dt || 0)), k => clamp01(pos(k)), s.acts, out);
  s.acts.length = 0;
  return s;
}
export const sensorName = (scene, d) => (scene && typeof scene[d.role] === 'string' && scene[d.role]) || d.def;
/** Capteurs du procédé : Map(nom → fermé ?). */
export function processSensors(scene, s) {
  const D = processOf(scene); if (!D || !s || s.kind !== D.kind) return new Map();
  const r = D.read(s);
  return new Map(D.sensors.map(d => [sensorName(scene, d), !!r[d.role]]));
}
/** Noms des capteurs du procédé de la scène (vides sans procédé). */
export const processSensorNames = scene => { const D = processOf(scene); return D ? D.sensors.map(d => sensorName(scene, d)) : []; };
/** Rôles des actions du procédé de la scène. */
export const processActRoles = scene => { const D = processOf(scene); return D ? D.acts.map(a => a.role) : []; };
/** Sorties lues par la machine (convoyeurs, voyants, ventouses, becs du jumeau) : vides pour les machines du registre. */
export const processOutputNames = scene => { const D = processOf(scene); return D && D.outputs ? D.outputs : []; };
/** Entrées appuyées par les boutons de la machine (jumeau). */
export const processInputNames = scene => { const D = processOf(scene); return D && D.inputs ? D.inputs : []; };
/** Commandes de la machine (boutons du jumeau), dans la forme des controls de SCENES (machine.js). */
export const processControls = scene => { const D = processOf(scene); return D && D.controls ? D.controls : []; };
/** Positions des vérins des rôles du procédé d'après l'état du circuit (x : positions par identifiant). */
export function cylPositions(circuit, x) {
  const D = processOf(circuit.scene), sc = circuit.scene || {};
  return key => { if (!D) return 0; const e = D.cylRef ? cylOf(circuit, D.cylRef(sc, key), -1) : cylOf(circuit, sc[key], D.cyls.indexOf(key)); return e ? clamp01(x[e.id]) : 0; };
}
/** Lignes d'affichage du procédé (compteurs, alarme). */
export const processHud = (scene, s) => { const D = processOf(scene); return D && s && s.kind === D.kind ? D.hud(s) : []; };
