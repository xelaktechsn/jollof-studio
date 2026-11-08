// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Composants analogiques : minuterie NE555, double ampli-op LM358, MOSFET logique IRLZ44N, bobine de 10 mH,
// générateur de fonctions et oscilloscope 2 voies. Fiches de câblage (même forme que parts.js, qui les reprend
// dans PARTS) et paramètres des modèles du solveur (dc.js), tirés des fiches techniques citées (check/sources.js).
// network : montage d'application que le câblage automatique pose avec le composant (autowire.js) ; own : broche
// du composant, « x.k » : broche k du composant d'appoint x.
import { tl } from '../i18n/index.js';

const gnd = (pin, why) => ({ pin, kind: 'gnd', why });
const pwr = (pin, v, why, ds, role) => ({ pin, kind: 'pwr', v, why, ds, ...(role && { role }) });
const io = (pin, need, role, why, o = {}) => ({ pin, kind: 'io', need, role, why, ...o });
const nc = (pin, role, why) => ({ pin, kind: 'nc', role, why });

/* ---------- Paramètres des modèles (dc.js) ---------- */
/**
 * NE555 (TI SLFS022K, § 5.5) : pont interne de trois 5 kΩ (CONT à 2/3 de VCC, seuil bas à la moitié de CONT) ;
 * sortie haute VCC − 1,4 V derrière 3 Ω (VOH typ. 3,3 V à −100 mA sous 5 V, 13,3 V sous 15 V), basse 0,05 V derrière
 * 7 Ω (VOL typ. 0,1 V à 5 mA, 0,4 V à 50 mA) ; décharge 0,05 V derrière 12,5 Ω (0,15 V typ. à 8 mA) ; RESET actif
 * sous 0,7 V (typ.).
 */
export const TIMERS = { ne555: { rTop: 5e3, rBot: 10e3, ohDrop: 1.4, rOh: 3, vol: 0.05, rOl: 7, vDis: 0.05, rDis: 12.5, vReset: 0.7 } };
/**
 * LM358 (TI SLOS068AB, § 5.7, VS = 5 V) : gain en boucle ouverte 100 V/mV (typ.), sortie à 1,5 V au plus du + et
 * 5 mV (typ.) de la masse, entrées valables de la masse à V+ − 1,5 V, produit gain-bande 0,7 MHz, vitesse de
 * balayage 0,3 V/µs, courant de court-circuit ±40 mA (typ.). rOut : étage de sortie du modèle.
 */
export const OPAMPS = { lm358: { gain: 1e5, head: 1.5, vol: 0.005, rOut: 10, cmr: 1.5, gbw: 0.7e6, slew: 0.3e6, chans: [['1IN+', '1IN-', '1OUT'], ['2IN+', '2IN-', '2OUT']] } };
/**
 * IRLZ44N (Infineon PD-94831) : VGS(th) 1 à 2 V (on prend le milieu, 1,5 V) ; RDS(on) max 35 mΩ à VGS = 4 V, 25 mΩ
 * à 5 V, 22 mΩ à 10 V. Entre le seuil et 4 V, RDS(on) suit k / (VGS − VGS(th)), k = 0,0875 Ω·V, qui passe par les
 * deux points de la fiche à 4 et 5 V (extrapolation sous 4 V) ; jamais moins de 22 mΩ. Diode interne source → drain.
 */
export const MOSFETS = { irlz44n: { vth: 1.5, k: 0.0875, rdsMin: 0.022, vfBody: 0.7, rBody: 0.5 } };
/** Rds(on) du MOSFET m pour une tension grille-source vgs (Ω), Infinity sous le seuil. */
export const rdsOn = (m, vgs) => (vgs > m.vth ? Math.max(m.rdsMin, m.k / (vgs - m.vth)) : Infinity);
/** Bobine 10 mH Bourns 5800-103-RC : DCR 24 Ω au plus. */
export const INDUCTORS = { 'ind-10m': { L: 0.01, r: 24 } };
/** Générateur de fonctions : sortie 50 Ω, comme un générateur de paillasse. */
export const GENERATORS = { siggen: { r: 50, fMax: 1e6, vMax: 10 } };
/** Réglages par défaut du générateur (c.inp) : forme, fréquence (Hz), amplitude crête (V), décalage (V). */
export const GEN_DEFAULT = { wave: 'sine', freq: 1000, amp: 1, off: 1.5 };
export const WAVES = ['sine', 'square', 'triangle', 'dc'];

/** Forme d'onde normalisée (période 1, crête 1) à la phase x, et sa primitive (périodique, nulle à chaque période). */
const frac = x => x - Math.floor(x);
function wave(kind, x) {
  const p = frac(x);
  if (kind === 'square') return p < 0.5 ? 1 : -1;
  if (kind === 'triangle') return p < 0.5 ? -1 + 4 * p : 3 - 4 * p;
  return Math.sin(2 * Math.PI * p);
}
function prim(kind, x) {
  const p = frac(x);
  if (kind === 'square') return p < 0.5 ? p : 1 - p;
  if (kind === 'triangle') return p < 0.5 ? -p + 2 * p * p : 3 * p - 2 * p * p - 1;
  return -Math.cos(2 * Math.PI * p) / (2 * Math.PI);
}
/**
 * Valeur du générateur moyennée sur [t, t + h] (h = 0 : valeur instantanée). La moyenne évite le repliement quand
 * le pas du calcul en direct est plus long que la période : la simulation et le multimètre lisent alors la moyenne.
 */
export function genValue(inp, t, h = 0) {
  const g = { ...GEN_DEFAULT, ...(inp || {}) }, f = Math.max(0, +g.freq || 0), A = +g.amp || 0, off = +g.off || 0;
  if (g.wave === 'dc' || !(f > 0) || !A) return off;
  const x0 = f * t, dx = f * h;
  if (!(dx > 1e-9)) return off + A * wave(g.wave, x0);
  if (dx >= 1) return off; // au moins une période par pas : la moyenne
  return off + A * (prim(g.wave, x0 + dx) - prim(g.wave, x0)) / dx;
}
/** Plage de la sortie du générateur [min, max] (V) avec ses réglages. */
export function genRange(inp) {
  const g = { ...GEN_DEFAULT, ...(inp || {}) }, A = g.wave === 'dc' ? 0 : Math.abs(+g.amp || 0), off = +g.off || 0;
  return [off - A, off + A];
}

/* ---------- Fiches de câblage ---------- */
const DIP = tl('Boîtier DIP-8 : l’encoche (ou le point) marque la broche 1 ; les broches se comptent ensuite dans le sens inverse des aiguilles d’une montre, vues de dessus.');
export const ANALOG_PARTS = {
  ne555: {
    what: tl('Minuterie NE555 (boîtier DIP-8) : un oscillateur (astable) ou une impulsion de durée réglée (monostable), fixés par des résistances et un condensateur.'),
    pins: [
      pwr('VCC', [4.5, 16], tl('Broche 8 : alimentation de la minuterie, 4,5 à 16 V.'), 'tiNe555'),
      gnd('GND', tl('Broche 1 : masse, commune avec la carte.')),
      nc('TRIG', tl('Déclenchement'), tl('Broche 2 : sous 1/3 de VCC, la sortie passe à l’état haut. En astable, reliée au condensateur de temporisation ; en monostable, à un bouton (ou une impulsion) tiré vers VCC.')),
      nc('THR', tl('Seuil'), tl('Broche 6 : au-dessus de 2/3 de VCC, la sortie repasse à l’état bas et la décharge se ferme. Reliée au condensateur de temporisation.')),
      nc('DIS', tl('Décharge'), tl('Broche 7 : un transistor qui relie cette broche à la masse tant que la sortie est basse : il vide le condensateur.')),
      io('OUT', 'in', tl('Sortie'), tl('Broche 3 : haute (≈ VCC − 1,4 V) ou basse (≈ 0,1 V). Elle fournit jusqu’à 200 mA : une LED et sa résistance s’y branchent directement. Vers une carte, elle se lit avec digitalRead (pont diviseur sur une carte 3,3 V).'), { lv5: true, opt: true, autowire: true, drives: true }),
      pwr('RESET', [4.5, 16], tl('Broche 4 : remise à zéro, active sous 0,7 V. Reliée à VCC, elle laisse la minuterie fonctionner ; à la masse, elle force la sortie à l’état bas.'), 'tiNe555', tl('Remise à zéro')),
      nc('CV', tl('Tension de contrôle'), tl('Broche 5 : sortie du pont interne, à 2/3 de VCC. Un condensateur de 10 nF vers la masse la protège des parasites ; facultative.'))
    ],
    ma: 3, ds: 'tiNe555',
    // Astable 1 kΩ / 10 kΩ / 100 µF : f = 1,44 / ((RA + 2 RB) C) ≈ 0,69 Hz, haut 52 % du temps.
    network: {
      parts: { ra: 'res-1k', rb: 'res-10k', c: 'cap-100u' },
      own: ['TRIG', 'THR', 'DIS'],
      nets: [
        { refs: ['DIS', 'ra.2', 'rb.1'], role: tl('Décharge, RA et RB (astable)') },
        { refs: ['THR', 'TRIG', 'rb.2', 'c.+'], role: tl('Seuil, déclenchement et condensateur (astable)') }
      ],
      power: [{ ref: 'ra.1', v: [4.5, 16], role: tl('RA vers l’alimentation') }],
      ground: [{ ref: 'c.-', role: tl('Condensateur à la masse') }]
    },
    notes: [DIP,
      tl('Astable : haut pendant 0,693 × (RA + RB) × C, bas pendant 0,693 × RB × C, soit f ≈ 1,44 / ((RA + 2 RB) × C). Monostable : impulsion de 1,1 × R × C.'),
      tl('Câblage automatique : astable RA = 1 kΩ, RB = 10 kΩ, C = 100 µF (≈ 0,7 Hz), RESET à VCC, sortie vers une entrée de la carte.')],
    code: p => tl('pinMode({0}, INPUT);\nbool haut = digitalRead({1}) == HIGH; // sortie du NE555', p.OUT, p.OUT)
  },
  lm358: {
    what: tl('Double amplificateur opérationnel LM358 (boîtier DIP-8) : deux amplis alimentés entre 3 et 30 V, dont les entrées et la sortie descendent jusqu’à la masse.'),
    pins: [
      pwr('VCC', [3, 30], tl('Broche 8 : alimentation, 3 à 30 V. Sous 5 V, la sortie monte au plus à VCC − 1,5 V.'), 'tiLm358'),
      gnd('GND', tl('Broche 4 : masse (alimentation simple, pas de tension négative).')),
      io('1OUT', 'adc', tl('Sortie A'), tl('Broche 1 : sortie de l’ampli A, de la masse à VCC − 1,5 V. Vers une entrée analogique de la carte pour mesurer le signal amplifié.'), { opt: true, drives: true }),
      nc('1IN-', tl('Entrée − (A)'), tl('Broche 2 : entrée inverseuse de l’ampli A. La contre-réaction (une résistance depuis la sortie) y arrive : c’est elle qui fixe le gain.')),
      nc('1IN+', tl('Entrée + (A)'), tl('Broche 3 : entrée non inverseuse de l’ampli A, de la masse à VCC − 1,5 V. Le signal à amplifier, ou la tension de référence d’un montage inverseur.')),
      nc('2IN+', tl('Entrée + (B)'), tl('Broche 5 : entrée non inverseuse de l’ampli B.')),
      nc('2IN-', tl('Entrée − (B)'), tl('Broche 6 : entrée inverseuse de l’ampli B.')),
      { ...nc('2OUT', tl('Sortie B'), tl('Broche 7 : sortie de l’ampli B.')), drives: true }
    ],
    ma: 0.7, ds: 'tiLm358',
    // Non inverseur de gain 2 sur l'ampli A : 10 kΩ de la sortie vers IN−, 10 kΩ de IN− vers la masse.
    network: {
      parts: { r1: 'res-10k', r2: 'res-10k' },
      own: ['1OUT', '1IN-'],
      nets: [
        { refs: ['1IN-', 'r1.1', 'r2.1'], role: tl('Entrée − et pont de contre-réaction') },
        { refs: ['1OUT', 'r2.2'], role: tl('Sortie A et contre-réaction'), board: 'adc' }
      ],
      ground: [{ ref: 'r1.2', role: tl('Pont de contre-réaction à la masse') }]
    },
    notes: [DIP,
      tl('Inverseur : G = −R2 / R1, entrée + sur une tension de référence (VCC / 2 en alimentation simple). Non inverseur : G = 1 + R2 / R1.'),
      tl('Câblage automatique : ampli A en non inverseur de gain 2 (deux résistances de 10 kΩ), sortie vers une entrée analogique ; l’entrée 1IN+ reste à relier au signal à amplifier.')],
    code: p => tl('int brut = analogRead({0}); // sortie de l’ampli A', p['1OUT'])
  },
  irlz44n: {
    what: tl('MOSFET canal N IRLZ44N (boîtier TO-220) à commande logique : une broche de 3,3 ou 5 V le rend passant pour des ampères (moteur, bande de LED, électroaimant), avec moins de 0,035 Ω entre drain et source.'),
    pins: [
      io('G', 'out', tl('Grille'), tl('Grille : la broche de la carte la charge à travers 220 Ω ; au-dessus de 1 à 2 V (VGS(th)) le MOSFET conduit. La résistance de 10 kΩ vers la masse le garde bloqué tant que la carte démarre.'), { opt: true, autowire: true, wireVia: 'res-220', pulldown: 'res-10k' }),
      nc('D', tl('Drain'), tl('Drain : vers le − de la charge (moteur, bande de LED), dont le + va à son alimentation. C’est aussi la languette métallique.')),
      gnd('S', tl('Source à la masse, commune avec la carte et l’alimentation de la charge.'))
    ],
    notes: [tl('Brochage G-D-S, face imprimée vers soi. Une charge à bobine (moteur, relais) demande une diode de roue libre à ses bornes, cathode côté +.'),
      tl('Câblage automatique : grille par 220 Ω vers une sortie de la carte, 10 kΩ de rappel vers la masse, source à la masse ; la charge se branche sur le drain.')],
    code: p => tl('pinMode({0}, OUTPUT);\nanalogWrite({1}, 128); // charge à mi-puissance', p.G, p.G)
  },
  'ind-10m': {
    what: tl('Bobine (inductance) de 10 mH : elle s’oppose aux variations du courant. Résistance de son fil : 24 Ω au plus ; 76 mA en continu.'),
    pins: ['1', '2'].map(k => nc(k, tl('Patte'), tl('Non polarisée : les deux pattes sont interchangeables.'))),
    notes: [tl('Avec une résistance R en série, le courant s’établit en τ = L / R (R comprend les 24 Ω du fil). À la coupure, la bobine produit une pointe de tension : diode de roue libre.')]
  },
  siggen: {
    what: tl('Générateur de fonctions : signal sinusoïdal, carré, triangulaire ou continu, dont la fréquence, l’amplitude et le décalage se règlent dans l’onglet Simulation. Sortie 50 Ω.'),
    pins: [
      io('OUT', 'adc', tl('Sortie'), tl('Sortie du signal (50 Ω), vers le montage à étudier, ou vers une entrée analogique de la carte : il doit rester entre 0 V et sa tension logique.'), { opt: true, autowire: true, drives: true }),
      gnd('GND', tl('Masse du générateur : à relier à la masse du montage (et de la carte).'))
    ],
    notes: [tl('Amplitude = valeur crête : 1 V d’amplitude et 1,5 V de décalage donnent un signal entre 0,5 et 2,5 V.')]
  },
  scope: {
    what: tl('Oscilloscope 2 voies : reliez CH1 et CH2 aux points à observer (GND à la masse du montage), puis ouvrez le banc de mesure.'),
    pins: [
      nc('CH1', tl('Voie 1'), tl('Entrée de la voie 1 : le point dont on veut voir la tension.')),
      nc('CH2', tl('Voie 2'), tl('Entrée de la voie 2.')),
      nc('GND', tl('Masse'), tl('Pince de masse : à la masse du montage. Les deux voies se mesurent par rapport à elle.'))
    ],
    notes: [tl('Entrées idéales : l’oscilloscope ne prélève aucun courant au montage.')]
  }
};
