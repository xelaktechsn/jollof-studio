// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pilotes de moteurs : ponts en H (L298N, L293D, TB6612FNG) pour les moteurs à courant continu, et pilotes de moteurs
// pas à pas (A4988, DRV8825) pour un moteur bipolaire NEMA 17.
//
// Ponts en H : le calcul du circuit (dc.js) en fait des étages de sortie ; HBRIDGES donne leurs broches et leur étage.
// Pilotes pas à pas : modèle au niveau des broches, partagé par tous les moteurs d'exécution comme les puces logiques
// (chips.js). Chaque front montant de STEP (digitalWrite de l'interpréteur, AccelStepper, ou broche d'un vrai programme
// émulé) passe par stepEdge ; les autres entrées (DIR, ENABLE, SLEEP, RESET, microrésolution) se lisent au moment du
// front. L'état vit sur le composant : comp.stepState. Les effecteurs (actuators.js) en font tourner le moteur.
//
// Décrochage (moteur qui « saute des pas ») : le rotor ne suit les impulsions que si leur cadence lissée reste
// atteignable. Seuils choisis pour un NEMA 17 (17HS4401) sous 12 V avec une petite charge, en pas entiers par seconde :
//   – démarrage sans rampe jusqu'à PULL_IN = 1000 pas/s (300 tr/min) ;
//   – au-delà, seulement en accélérant d'au plus A_MAX = 20 000 pas/s² (rampe d'AccelStepper, par exemple) ;
//   – jamais au-delà de F_MAX = 3000 pas/s (900 tr/min) : le couple ne suffit plus.
// Décroché, le rotor reste sur place (il vibre) et les pas sont perdus ; il se raccroche quand la cadence redescend
// sous PULL_IN, sur la position électrique la plus proche (à 4 pas entiers près : une période des bobines).
import { WEAK_PULL } from './chips.js';

/**
 * Ponts en H. chans : voies [sorties, entrées de sens, validation (PWM)] ; vs : broche de l'alimentation des moteurs ;
 * étage haut : tension vs − hiDrop derrière hiR (Ω) ; étage bas : loV derrière loR. brake : la voie freine (deux sorties
 * à la masse) quand IN1 = IN2 = HIGH ou PWM = LOW (TB6612FNG) ; sinon EN bas coupe la voie (sorties en l'air). stby :
 * broche de veille (LOW : tout coupé). jumper : EN non câblé = cavalier en place (L298N). min : tension de démarrage (V).
 * L298N (ST, DocID 1773 rév. 5) : VCEsat haut ≈ 1,35 V et bas ≈ 0,2 V typ. à 1 A. L293D (TI SLRS008D) : VOH = VCC2 − 1,4 V
 * et VOL = 1,2 V typiques à 0,6 A, d'où 0,9 V + 0,85 Ω et 0,7 V + 0,85 Ω. TB6612FNG (Toshiba) : MOSFET, 0,5 Ω typiques
 * haut + bas, soit 0,25 Ω par étage, sans seuil.
 */
export const HBRIDGES = {
  l298n: { vs: '+12V', chans: [{ outs: ['OUT1', 'OUT2'], ins: ['IN1', 'IN2'], en: 'ENA' }, { outs: ['OUT3', 'OUT4'], ins: ['IN3', 'IN4'], en: 'ENB' }], hiDrop: 1.4, hiR: 1, loV: 0.2, loR: 1, jumper: true, min: 2 },
  l293d: { vs: 'VCC2', chans: [{ outs: ['OUT1', 'OUT2'], ins: ['IN1', 'IN2'], en: 'EN12' }, { outs: ['OUT3', 'OUT4'], ins: ['IN3', 'IN4'], en: 'EN34' }], hiDrop: 0.9, hiR: 0.85, loV: 0.7, loR: 0.85, min: 4.5 },
  tb6612: { vs: 'VM', chans: [{ outs: ['AO1', 'AO2'], ins: ['AIN1', 'AIN2'], en: 'PWMA' }, { outs: ['BO1', 'BO2'], ins: ['BIN1', 'BIN2'], en: 'PWMB' }], stby: 'STBY', brake: true, hiDrop: 0, hiR: 0.25, loV: 0, loR: 0.25, min: 2.5 }
};
export const isHBridge = t => !!HBRIDGES[t];
/** Sorties de puissance d'un pont en H (ou []). */
export const hbridgeOuts = t => (HBRIDGES[t] ? HBRIDGES[t].chans.flatMap(ch => ch.outs) : []);
/** Voie d'un pont en H qui contient la sortie key : { ch, i } ou null. */
export function hbridgeChan(t, key) {
  const m = HBRIDGES[t]; if (!m) return null;
  for (const ch of m.chans) { const i = ch.outs.indexOf(key); if (i >= 0) return { ch, i }; }
  return null;
}
/**
 * Sorties d'une voie de pont en H d'après ses entrées (niveaux 0 ou 1, en = rapport cyclique de 0 à 1, stby = 0 ou 1) :
 * pour chaque sortie, { hi, lo } = part du temps où l'étage haut (bas) conduit, et ihi : l'étage haut est découpé en
 * début de période (PWM), l'étage bas conduit pendant le reste (frein du TB6612). null : sortie en l'air.
 */
export function bridgeOut(m, in1, in2, en, stby = 1) {
  if (m.brake) {
    // TB6612FNG : STBY bas ou IN1 = IN2 = LOW, sorties coupées ; IN1 = IN2 = HIGH, frein court (les deux à la masse) ;
    // sinon le côté HIGH monte pendant l'impulsion PWM et freine (retombe à la masse) le reste de la période.
    if (!stby || (!in1 && !in2)) return [null, null];
    if (in1 && in2) return [{ hi: 0, lo: 1 }, { hi: 0, lo: 1 }];
    const drive = { hi: en, lo: 1 - en, split: en > 0 && en < 1 }, low = { hi: 0, lo: 1 };
    return in1 ? [drive, low] : [low, drive];
  }
  // L298N, L293D : chaque sortie suit son entrée tant que EN est haut ; EN bas, la voie flotte (roue libre).
  if (!(en > 0)) return [null, null];
  const out = x => (x ? { hi: en, lo: 0, gate: en < 1 } : { hi: 0, lo: en, gate: en < 1 });
  return [out(in1), out(in2)];
}

/* ---------- Pilotes de moteurs pas à pas ---------- */
/**
 * ms : broches de microrésolution (bit 0 d'abord) ; div : diviseur du pas selon leurs niveaux ; coils : sorties de chaque
 * bobine ; en, reset, sleep : broches de commande (ENABLE actif à l'état bas) ; vmot : plage du moteur (V) ; i : courant
 * par phase (mA) réglé par défaut, sans refroidissement, au plus ; vref(mA) → V ; pulse : impulsion STEP minimale (µs).
 * A4988 (Allegro A4988-DS ; carte Pololu 1182) : 8 à 35 V, ≈ 1 A par phase sans radiateur, 2 A au plus, Vref = 8 × I ×
 * Rs avec Rs = 0,068 Ω, impulsions de 1 µs. DRV8825 (TI SLVSA73F ; carte Pololu 2133) : 8,2 à 45 V, ≈ 1,5 A sans radiateur,
 * 2,2 A au plus, Vref = I ÷ 2 (Rs = 0,1 Ω), jusqu'à 1/32 de pas, impulsions de 1,9 µs.
 */
export const STEP_DRIVERS = {
  a4988: {
    ms: ['MS1', 'MS2', 'MS3'], div: { '000': 1, '100': 2, '010': 4, '110': 8, '111': 16 }, coils: [['1A', '1B'], ['2A', '2B']],
    en: 'ENABLE', reset: 'RESET', sleep: 'SLEEP', vmot: [8, 35], i: { def: 1000, cool: 1000, max: 2000 }, vref: ma => 8 * ma / 1000 * 0.068, pulse: 1, src: ['allegroA4988', 'pololuA4988']
  },
  drv8825: {
    ms: ['M0', 'M1', 'M2'], div: { '000': 1, '100': 2, '010': 4, '110': 8, '001': 16, '101': 32, '011': 32, '111': 32 }, coils: [['A1', 'A2'], ['B1', 'B2']],
    en: 'ENABLE', reset: 'RESET', sleep: 'SLEEP', vmot: [8.2, 45], i: { def: 1000, cool: 1500, max: 2200 }, vref: ma => ma / 1000 / 2, pulse: 1.9, src: ['tiDrv8825', 'pololuDrv8825']
  }
};
export const STEP_TYPES = Object.keys(STEP_DRIVERS);
export const isStepDriver = t => !!STEP_DRIVERS[t];
/** Broches d'entrée d'un pilote pas à pas qu'un programme peut commander. */
export const stepInputs = t => { const m = STEP_DRIVERS[t]; return m ? ['STEP', 'DIR', m.en, m.reset, m.sleep, ...m.ms] : []; };
/** Sorties vers les bobines (ou []). */
export const stepOuts = t => (STEP_DRIVERS[t] ? STEP_DRIVERS[t].coils.flat() : []);

/**
 * Moteurs pas à pas bipolaires. NEMA 17 17HS4401 : 200 pas par tour (1,8°), 1,7 A par phase, 1,5 Ω et 2,8 mH par
 * bobine, 0,4 N·m de couple de maintien. Seuils de décrochage : voir l'en-tête.
 */
export const STEPPERS = { nema17: { pins: [['A+', 'A-'], ['B+', 'B-']], steps: 200, ma: 1700, r: 1.5, src: 'nema17hs4401' } };
export const isStepper = t => !!STEPPERS[t];
export const PULL_IN = 1000, A_MAX = 20000, F_MAX = 3000;
const TAU = 0.004; // s : lissage de la cadence (inertie du rotor)

/** Courant par phase réglé sur le pilote (mA) : c.inp.ilim (potentiomètre de la carte), sinon le réglage par défaut. */
export function ilimOf(c) {
  const m = c && STEP_DRIVERS[c.type]; if (!m) return 0;
  const v = c.inp && +c.inp.ilim;
  return v > 0 ? Math.min(m.i.max * 1.5, v) : m.i.def;
}
/** Plage du réglage de courant offert dans le panneau (mA). */
export const ILIM_RANGE = { lo: 100, hi: 2500 };

/** État du pilote (créé à la première lecture). */
export function stepState(comp) {
  if (!comp || !STEP_DRIVERS[comp.type]) return null;
  if (!comp.stepState || comp.stepState.t !== comp.type) comp.stepState = { t: comp.type, pos: 0, rotor: 0, steps: 0, lost: 0, stalled: false, v: 0, f: 0, last: -1e9, div: 1, dir: 1, stepLv: 0, ignored: null, ver: 0 };
  return comp.stepState;
}

/**
 * Entrées d'un pilote : read(broche) → 0, 1 ou null (en l'air : tirage de la carte ou de la puce, WEAK_PULL).
 * Rend { on, why, div, dir } : on, le pilote accepte les pas ; why : 'sleep' | 'reset' | 'enable' | null.
 */
export function driverInputs(comp, read = () => null) {
  const m = STEP_DRIVERS[comp.type], pulls = WEAK_PULL[comp.type] || {};
  const lv = k => { const x = read(k); return x == null ? (pulls[k] ?? null) : x; };
  const bits = m.ms.map(k => (lv(k) ? '1' : '0')).join('');
  const div = m.div[bits] || 1, dir = lv('DIR') ? 1 : -1;
  const why = lv(m.sleep) !== 1 ? 'sleep' : lv(m.reset) !== 1 ? 'reset' : lv(m.en) === 1 ? 'enable' : null;
  return { on: !why, why, div, dir, bits };
}

/**
 * Niveau écrit sur la broche STEP d'un pilote, à l'instant t (ms). Un front montant, pilote actif, avance le pas de 1/div
 * dans le sens de DIR ; le rotor suit, ou décroche (voir l'en-tête).
 */
export function stepEdge(comp, level, t, read = () => null) {
  const s = stepState(comp); if (!s) return;
  const was = s.stepLv; s.stepLv = level ? 1 : 0;
  if (!level || was === 1) return;
  const x = driverInputs(comp, read);
  if (!x.on) { s.ignored = x.why; s.ver++; return; }
  s.ignored = null;
  const mu = 1 / x.div, d = x.dir, dt = Math.max(1e-7, (t - s.last) / 1000);
  s.last = t; s.div = x.div; s.dir = d; s.steps += d; s.pos += d * mu;
  // Cadence lissée (pas entiers par seconde, signée) ; après un arrêt, on repart de zéro.
  const vi = dt > 0.05 ? 0 : d * mu / dt, w = 1 - Math.exp(-dt / TAU);
  s.v = dt > 0.05 ? 0 : s.v + (vi - s.v) * w;
  const a = Math.abs(s.v);
  if (s.stalled) {
    if (a <= PULL_IN) { s.stalled = false; s.rotor = s.pos - 4 * Math.round((s.pos - s.rotor) / 4); s.f = s.v; } // il se raccroche
    else s.lost += mu;
  } else {
    // Ce que le rotor sait suivre : toute cadence jusqu'à PULL_IN, au-delà une accélération bornée.
    const lim = A_MAX * dt;
    s.f = a <= PULL_IN ? s.v : Math.max(s.f - lim, Math.min(s.f + lim, s.v));
    if (a > F_MAX || Math.abs(s.v - s.f) > Math.max(0.1 * a, 50)) { s.stalled = true; s.lost += mu; s.f = 0; }
    else s.rotor += d * mu;
  }
  s.ver++;
}
/** Remet les pilotes à leur état de départ (arrêt de la simulation). */
export function resetStepDrivers(comps) { for (const c of comps || []) if (c && c.stepState) c.stepState = null; }

/**
 * Raccordement d'un moteur pas à pas à un pilote, d'après l'analyse du montage A : { drv, sign, ok, why } ou null.
 * sign : sens de rotation (+1, ou −1 si une bobine est inversée ou si les deux sont échangées) ; ok : chaque bobine du
 * moteur est sur une même bobine du pilote ; why : 'pair' (bornes de deux bobines mélangées), 'open' (bobine libre).
 */
export function stepperLink(motor, A) {
  const mm = STEPPERS[motor.type]; if (!mm || !A) return null;
  const ends = mm.pins.map(pair => pair.map(k => (motor.pins[k] ? A.members({ comp: motor, key: k }).find(x => isStepDriver(x.comp.type) && stepOuts(x.comp.type).includes(x.key)) : null)));
  const all = ends.flat().filter(Boolean);
  if (!all.length) return null;
  const drv = all[0].comp, m = STEP_DRIVERS[drv.type];
  if (all.length < 4 || all.some(x => x.comp !== drv)) return { drv, sign: 1, ok: false, why: 'open' };
  const coilOf = x => m.coils.findIndex(p => p.includes(x.key)), polOf = x => (m.coils[coilOf(x)][0] === x.key ? 1 : -1);
  const [a, b] = ends;
  if (coilOf(a[0]) !== coilOf(a[1]) || coilOf(b[0]) !== coilOf(b[1]) || coilOf(a[0]) === coilOf(b[0])) return { drv, sign: 1, ok: false, why: 'pair' };
  // Bobine A du moteur sur la bobine 1 du pilote, B sur 2 : sens = produit des polarités ; échangées : sens opposé.
  const sign = polOf(a[0]) * polOf(b[0]) * (coilOf(a[0]) === 0 ? 1 : -1);
  return { drv, sign, ok: true, why: null };
}
