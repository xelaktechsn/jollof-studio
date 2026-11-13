// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : exemples prêts à simuler, du plus simple au modèle physique. Chacun remplace le circuit du plan de
// travail pneumatique (le montage électronique ne change pas). Les mêmes circuits servent de départ aux TP de
// pneumatique (src/lab/pneu). L'exemple électropneumatique avec carte est un projet entier (exemples/08-…).
import { tl } from '../i18n/index.js';

const E = (id, type, x, y, p = {}) => ({ id, type, x, y, p });
const T = (id, a, pa, b, pb) => ({ id, a: [a, pa], b: [b, pb] });
/** Tuyaux numérotés à partir d'une liste [a, pa, b, pb]. */
const TS = (list, from = 1) => list.map(([a, pa, b, pb], i) => T(`t${from + i}`, a, pa, b, pb));
/** Galet de fin de course : vérin cam, fin de course end ('1' tige sortie, '0' tige rentrée), repère a1… */
const ROLLER = (id, x, y, cam, end) => E(id, 'v32', x, y, { act: 'roller', normal: 'nc', cam, end, label: `${cam.toLowerCase()}${end}` });
/** Partie opérative commune aux cycles à deux vérins : A et B double effet, chacun par son distributeur 5/2. */
const TWO_CYL = (left, right, extra = {}) => [
  E('A', 'cyl2', 0, 0, { label: 'A', ...(extra.A || {}) }), E('B', 'cyl2', 36, 0, { label: 'B', ...(extra.B || {}) }),
  E('v1', 'v52', -8, 12, { ...left, label: '1V1' }), E('v2', 'v52', 28, 12, { ...right, label: '2V1' })
];
const POWER = [['v1', '4', 'A', '1'], ['v1', '2', 'A', '2'], ['v2', '4', 'B', '1'], ['v2', '2', 'B', '2']];
const PILOTS = { left: 'pilot', right: 'pilot' };

/** Cycle A+ B+ A− B− tout pneumatique : distributeurs bistables pilotés, galets a0 a1 b0 b1, départ cycle ET b0. */
export const cycleCircuit = (withSignals = true) => ({
  elements: [...TWO_CYL(PILOTS, PILOTS), E('and', 'twopress', -16, 18),
    E('dcy', 'v32', -36, 26, { act: 'push', normal: 'nc', label: 'dcy' }), ROLLER('b0', -20, 26, 'B', '0'), ROLLER('b1', -4, 26, 'B', '1'),
    ROLLER('a1', 12, 26, 'A', '1'), ROLLER('a0', 28, 26, 'A', '0'), E('src', 'supply', 10, 36)],
  tubes: TS([...POWER, ['src', '1', 'v1', '1'], ['src', '1', 'v2', '1'], ['src', '1', 'dcy', '1'], ['src', '1', 'b0', '1'], ['src', '1', 'b1', '1'], ['src', '1', 'a1', '1'], ['src', '1', 'a0', '1'],
    ...(withSignals ? [['dcy', '2', 'and', '1'], ['b0', '2', 'and', '3'], ['and', '2', 'v1', '14'], ['a1', '2', 'v2', '14'], ['b1', '2', 'v1', '12'], ['a0', '2', 'v2', '12']] : [])])
});
/** Tuyaux de commande du cycle A+ B+ A− B− (ceux que l'élève tire dans le TP). */
export const CYCLE_SIGNALS = TS([['dcy', '2', 'and', '1'], ['b0', '2', 'and', '3'], ['and', '2', 'v1', '14'], ['a1', '2', 'v2', '14'], ['b1', '2', 'v1', '12'], ['a0', '2', 'v2', '12']], 14);

/** GRAFCET du cycle A+ B+ B− A− avec distributeurs bistables à deux électroaimants (1Y1 A+, 1Y2 A−, 2Y1 B+, 2Y2 B−). */
export const ABBA_GRAFCET = () => ({
  drive: true, inputs: [{ name: 'dcy', kind: 'push' }],
  steps: [
    { n: 0, init: true, act: '', r: 'dcy . a0 . b0', to: null, alt: [] },
    { n: 1, init: false, act: '1Y1', r: 'a1', to: null, alt: [] },
    { n: 2, init: false, act: '2Y1', r: 'b1', to: null, alt: [] },
    { n: 3, init: false, act: '2Y2', r: 'b0', to: null, alt: [] },
    { n: 4, init: false, act: '1Y2', r: 'a0', to: null, alt: [] }
  ]
});
/** Partie opérative du cycle commandé par GRAFCET : électroaimants des deux côtés, capteurs de fin de course a0… b1. */
export const grafcetCircuit = (withGrafcet = true) => ({
  elements: [...TWO_CYL({ left: 'sol', right: 'sol', coilL: '1Y1', coilR: '1Y2' }, { left: 'sol', right: 'sol', coilL: '2Y1', coilR: '2Y2' }, { A: { s0: 'A0', s1: 'A1' }, B: { s0: 'B0', s1: 'B1' } }), E('src', 'supply', 16, 22)],
  tubes: TS([...POWER, ['src', '1', 'v1', '1'], ['src', '1', 'v2', '1']]),
  grafcet: withGrafcet ? ABBA_GRAFCET() : { drive: true, inputs: [{ name: 'dcy', kind: 'push' }], steps: [{ n: 0, init: true, act: '', r: '', to: null, alt: [] }] }
});
/** GRAFCET de la porte : ouverture sur dcy, 5 s ouverte, fermeture ; un obstacle pendant la fermeture la rouvre. */
export const DOOR_GRAFCET = () => ({
  drive: true, inputs: [{ name: 'dcy', kind: 'push' }, { name: 'obs', kind: 'switch' }],
  steps: [
    { n: 0, init: true, act: '', r: 'dcy . a0', to: null, alt: [] },
    { n: 1, init: false, act: '1Y1', r: 'a1', to: null, alt: [] },
    { n: 2, init: false, act: '1Y1', r: '5s/X2', to: null, alt: [] },
    { n: 3, init: false, act: '', r: 'a0', to: null, alt: [{ r: 'obs', to: 1 }] }
  ]
});
/** Porte de TER : vérin A (a0 fermée, a1 ouverte), distributeur 5/2 monostable 1Y1, fermeture freinée par 1V2. */
export const doorCircuit = (withGrafcet = true) => ({
  elements: [E('A', 'cyl2', 0, 0, { label: 'A', s0: 'A0', s1: 'A1', time: 1.5 }), E('fc', 'flowctl', -8, 2, { open: 50, label: '1V2' }),
    E('v1', 'v52', -8, 12, { left: 'sol', right: 'spring', coilL: '1Y1', label: '1V1' }), E('src', 'supply', 1, 22)],
  tubes: TS([['src', '1', 'v1', '1'], ['v1', '4', 'fc', '1'], ['fc', '2', 'A', '1'], ['v1', '2', 'A', '2']]),
  scene: { kind: 'door', cyl: 'A', open: 'dcy', obstacle: 'obs', coil: '1Y1' }, // vue 3D : la porte de TER
  grafcet: withGrafcet ? DOOR_GRAFCET() : { drive: true, inputs: [{ name: 'dcy', kind: 'push' }, { name: 'obs', kind: 'switch' }], steps: [{ n: 0, init: true, act: '', r: '', to: null, alt: [] }] }
});
/** Le cycle A+ B+ B− A− avec une macro-étape M2 : son expansion (20, 21, 22) fait le perçage B+ B−. */
export const MACRO_GRAFCET = () => ({
  drive: true, inputs: [{ name: 'dcy', kind: 'push' }],
  steps: [
    { n: 0, init: true, act: '', r: 'dcy . a0 . b0', to: null, alt: [] },
    { n: 1, init: false, act: '1Y1', r: 'a1', to: null, alt: [] },
    { n: 2, macro: true, init: false, r: '=1', to: null, alt: [], exp: [
      { n: 20, init: false, act: '2Y1', r: 'b1', to: null, alt: [] },
      { n: 21, init: false, act: '2Y2', r: 'b0', to: null, alt: [] },
      { n: 22, init: false, act: '', r: '', to: null, alt: [] }] },
    { n: 3, init: false, act: '1Y2', r: 'a0', to: null, alt: [] }
  ]
});
/**
 * Serrage, perçage et marquage : A serre (distributeur monostable, action mémorisée 1Y1:=1 … 1Y1:=0), puis B perce
 * et C marque en même temps (divergence en ET), chacun à son rythme ; la convergence attend les deux avant de desserrer.
 */
export const PAR_GRAFCET = () => ({
  drive: true, inputs: [{ name: 'dcy', kind: 'push' }],
  steps: [
    { n: 0, init: true, act: '', r: 'dcy . a0 . b0 . c0', to: null, alt: [] },
    { n: 1, init: false, act: '1Y1:=1', r: 'a1', to: null, alt: [] },
    { par: [
      [{ n: 2, init: false, act: '2Y1', r: 'b1', to: null, alt: [] }, { n: 3, init: false, act: '2Y2', r: 'b0', to: null, alt: [] }, { n: 4, init: false, act: '', r: '', to: null, alt: [] }],
      [{ n: 5, init: false, act: '3Y1', r: 'c1', to: null, alt: [] }, { n: 6, init: false, act: '3Y2', r: 'c0', to: null, alt: [] }, { n: 7, init: false, act: '', r: '', to: null, alt: [] }]
    ], r: '=1', to: null },
    { n: 8, init: false, act: '1Y1:=0', r: 'a0', to: null, alt: [] }
  ]
});
/**
 * Production et sécurité : GPN fait trois cycles A+ B+ B− A− par appui sur dcy (compteur N) ; le GRAFCET de sécurité
 * GS, sur arrêt d'urgence au, force GPN dans sa situation {0} et fait rentrer les deux tiges ; il faut relâcher au et
 * réarmer (rea) pour repartir.
 */
export const SAFETY_GRAFCET = () => ({
  name: 'GPN', drive: true, inputs: [{ name: 'dcy', kind: 'push' }, { name: 'au', kind: 'switch' }, { name: 'rea', kind: 'push' }],
  steps: [
    { n: 0, init: true, act: 'N:=0', r: 'dcy . a0 . b0', to: null, alt: [] },
    { n: 1, init: false, act: '1Y1', r: 'a1', to: null, alt: [] },
    { n: 2, init: false, act: '2Y1', r: 'b1', to: null, alt: [] },
    { n: 3, init: false, act: '2Y2', r: 'b0', to: null, alt: [] },
    { n: 4, init: false, act: '1Y2, N:=N+1', r: 'a0 . N >= 3', to: null, alt: [{ r: 'a0 . N < 3', to: 1 }] }
  ],
  parts: [{ name: 'GS', steps: [
    { n: 100, init: true, act: '', r: 'au', to: null, alt: [] },
    { n: 101, init: false, act: 'F/GPN:{0}, 1Y2, 2Y2', r: '/au . rea', to: null, alt: [] }
  ] }]
});
/**
 * Marche automatique : l'étape encapsulante X1 fait tourner le cycle de son encapsulation (10* à 14) tant qu'elle est
 * active ; « arret » est attendu en fin de cycle (X10), puis X1 se désactive et son encapsulation avec elle.
 */
export const ENCL_GRAFCET = () => ({
  name: 'G1', drive: true, inputs: [{ name: 'marche', kind: 'push' }, { name: 'arret', kind: 'switch' }],
  steps: [
    { n: 0, init: true, act: '', r: 'marche . /arret', to: null, alt: [] },
    { n: 1, init: false, act: '', r: 'arret . X10', to: null, alt: [], enc: [
      { n: 10, init: true, act: '', r: 'a0 . b0 . /arret', to: null, alt: [] },
      { n: 11, init: false, act: '1Y1', r: 'a1', to: null, alt: [] },
      { n: 12, init: false, act: '2Y1', r: 'b1', to: null, alt: [] },
      { n: 13, init: false, act: '2Y2', r: 'b0', to: null, alt: [] },
      { n: 14, init: false, act: '1Y2', r: 'a0', to: null, alt: [] }] }
  ],
  parts: []
});
/** Trois vérins : A monostable (1Y1), B et C bistables (2Y1/2Y2, 3Y1/3Y2), capteurs a0… c1 ; C plus lent. */
export const threeCircuit = (withGrafcet = true) => ({
  elements: [
    E('A', 'cyl2', 0, 0, { label: 'A', s0: 'A0', s1: 'A1' }), E('B', 'cyl2', 36, 0, { label: 'B', s0: 'B0', s1: 'B1' }), E('C', 'cyl2', 72, 0, { label: 'C', s0: 'C0', s1: 'C1', time: 1.5 }),
    E('v1', 'v52', -8, 12, { left: 'sol', right: 'spring', coilL: '1Y1', label: '1V1' }), E('v2', 'v52', 28, 12, { left: 'sol', right: 'sol', coilL: '2Y1', coilR: '2Y2', label: '2V1' }),
    E('v3', 'v52', 64, 12, { left: 'sol', right: 'sol', coilL: '3Y1', coilR: '3Y2', label: '3V1' }), E('src', 'supply', 34, 22)],
  tubes: TS([...POWER, ['v3', '4', 'C', '1'], ['v3', '2', 'C', '2'], ['src', '1', 'v1', '1'], ['src', '1', 'v2', '1'], ['src', '1', 'v3', '1']]),
  grafcet: withGrafcet ? PAR_GRAFCET() : { drive: true, inputs: [{ name: 'dcy', kind: 'push' }], steps: [{ n: 0, init: true, act: '', r: '', to: null, alt: [] }] }
});
/**
 * Cascade à deux groupes pour A+ B+ B− A− : le distributeur de cascade (3V1) alimente une ligne à la fois ; une ligne
 * vide ne peut plus commander, plus de signaux qui se contredisent (b1 et a1 pendant B−).
 */
export const cascadeCircuit = () => ({
  elements: [...TWO_CYL(PILOTS, PILOTS),
    ROLLER('b0', -14, 24, 'B', '0'), ROLLER('a1', 2, 24, 'A', '1'), ROLLER('b1', 18, 24, 'B', '1'), ROLLER('a0', 34, 24, 'A', '0'),
    E('dcy', 'v32', 50, 24, { act: 'push', normal: 'nc', label: 'dcy' }), E('cv', 'v52', 6, 34, { left: 'pilot', right: 'pilot', label: '3V1' }), E('src', 'supply', 24, 44)],
  tubes: TS([...POWER, ['src', '1', 'v1', '1'], ['src', '1', 'v2', '1'], ['src', '1', 'cv', '1'],
    ['cv', '4', 'v1', '14'], ['cv', '4', 'a1', '1'], ['cv', '4', 'b1', '1'], // ligne du groupe I : A+, B+
    ['cv', '2', 'v2', '12'], ['cv', '2', 'b0', '1'], ['cv', '2', 'a0', '1'], // ligne du groupe II : B−, A−
    ['a1', '2', 'v2', '14'], ['b1', '2', 'cv', '12'], ['b0', '2', 'v1', '12'], ['a0', '2', 'dcy', '1'], ['dcy', '2', 'cv', '14']])
});

/** Circuits d'exemple : { id, name(), text(), circuit() }. */
export const PNEU_EXAMPLES = [
  {
    id: 'direct', name: () => tl('Commande directe d’un vérin simple effet'),
    text: () => tl('Lancez la simulation, puis maintenez le clic sur le bouton du distributeur 3/2 : la tige sort ; relâchez : le ressort la rentre.'),
    circuit: () => ({
      elements: [E('c1', 'cyl1', 0, 0, { label: '1A' }), E('v1', 'v32', -7, 10, { act: 'push', normal: 'nc', label: '1V1' }), E('src', 'supply', -2, 20)],
      tubes: [T('t1', 'src', '1', 'v1', '1'), T('t2', 'v1', '2', 'c1', '1')]
    })
  },
  {
    id: 'indirect', name: () => tl('Commande indirecte d’un vérin double effet'),
    text: () => tl('Le petit distributeur à bouton envoie un signal d’air qui pilote le gros distributeur 5/2 : c’est lui qui alimente le vérin. Maintenez le bouton : la tige sort ; relâchez : elle rentre.'),
    circuit: () => ({
      elements: [E('c1', 'cyl2', 0, 0, { label: '1A' }), E('v1', 'v52', -8, 10, { left: 'pilot', right: 'spring', label: '1V1' }), E('s1', 'v32', -24, 16, { act: 'push', normal: 'nc', label: '1S1' }), E('src', 'supply', -2, 24)],
      tubes: [T('t1', 'src', '1', 'v1', '1'), T('t2', 'src', '1', 's1', '1'), T('t3', 's1', '2', 'v1', '14'), T('t4', 'v1', '4', 'c1', '1'), T('t5', 'v1', '2', 'c1', '2')]
    })
  },
  {
    id: 'twohands', name: () => tl('Sécurité deux mains : la fonction ET'),
    text: () => tl('Le vérin ne sort que si les deux boutons sont appuyés en même temps, comme sur une presse : les deux mains de l’opérateur sont loin de l’outil. Dans l’onglet Pneumatique, « Appuyer » maintient un bouton.'),
    circuit: () => ({
      elements: [E('c1', 'cyl2', 0, 0, { label: '1A' }), E('v1', 'v52', -8, 10, { left: 'pilot', right: 'spring', label: '1V1' }), E('and', 'twopress', -22, 9, { label: '1V2' }), E('a', 'v32', -36, 17, { act: 'push', normal: 'nc', label: '1S1' }), E('b', 'v32', -20, 17, { act: 'push', normal: 'nc', label: '1S2' }), E('src', 'supply', -2, 25)],
      tubes: [T('t1', 'src', '1', 'v1', '1'), T('t2', 'src', '1', 'a', '1'), T('t3', 'src', '1', 'b', '1'), T('t4', 'a', '2', 'and', '1'), T('t5', 'b', '2', 'and', '3'), T('t6', 'and', '2', 'v1', '14'), T('t7', 'v1', '4', 'c1', '1'), T('t8', 'v1', '2', 'c1', '2')]
    })
  },
  {
    id: 'or', name: () => tl('Deux postes de commande : la fonction OU'),
    text: () => tl('Un bouton à chaque poste : l’un ou l’autre fait sortir la tige. Le sélecteur de circuit empêche l’air d’un bouton de s’échapper par l’autre.'),
    circuit: () => ({
      elements: [E('c1', 'cyl1', 0, 0, { label: '1A' }), E('or', 'shuttle', -2, 7, { label: '1V1' }), E('a', 'v32', -20, 13, { act: 'push', normal: 'nc', label: '1S1' }), E('b', 'v32', 8, 13, { act: 'push', normal: 'nc', label: '1S2' }), E('src', 'supply', -2, 21)],
      tubes: [T('t1', 'src', '1', 'a', '1'), T('t2', 'src', '1', 'b', '1'), T('t3', 'a', '2', 'or', '1'), T('t4', 'b', '2', 'or', '3'), T('t5', 'or', '2', 'c1', '1')]
    })
  },
  {
    id: 'speed', name: () => tl('Régler la vitesse de sortie'),
    text: () => tl('Le réducteur de débit freine l’air qui s’échappe de la chambre avant : la tige sort lentement et rentre vite. Changez son ouverture (onglet Pneumatique) et comparez.'),
    circuit: () => ({
      elements: [E('c1', 'cyl2', 0, 0, { label: '1A', time: 1 }), E('g', 'gauge', -7, 2), E('v1', 'v52', -8, 12, { left: 'push', right: 'spring', label: '1V1' }), E('fc', 'flowctl', 10, 5, { open: 25, label: '1V2' }), E('src', 'supply', 1, 20)],
      tubes: [T('t1', 'src', '1', 'v1', '1'), T('t2', 'v1', '4', 'c1', '1'), T('t3', 'v1', '2', 'fc', '1'), T('t4', 'fc', '2', 'c1', '2'), T('t5', 'g', '1', 'c1', '1')]
    })
  },
  {
    id: 'midstop', name: () => tl('Arrêter un vérin en cours de course (5/3)'),
    text: () => tl('Un distributeur 5/3 à centre fermé : bouton de gauche, la tige sort ; bouton de droite, elle rentre ; aucun bouton, les ressorts recentrent le tiroir et la tige s’arrête où elle est.'),
    circuit: () => ({
      elements: [E('c1', 'cyl2', 0, 0, { label: '1A', time: 3 }), E('v1', 'v53', -8, 12, { left: 'push', right: 'push', center: 'closed', label: '1V1' }), E('src', 'supply', 1, 22)],
      tubes: [T('t1', 'src', '1', 'v1', '1'), T('t2', 'v1', '4', 'c1', '1'), T('t3', 'v1', '2', 'c1', '2')]
    })
  },
  {
    id: 'cycle', name: () => tl('Cycle A+ B+ A− B− tout pneumatique (galets)'),
    text: () => tl('Appuyez sur dcy (onglet Pneumatique : « Appuyer » le maintient) : A sort, son galet a1 fait sortir B, b1 fait rentrer A, a0 fait rentrer B. Le relevé des mouvements et le diagramme des phases sont dans l’onglet Pneumatique.'),
    circuit: () => cycleCircuit(true)
  },
  {
    id: 'cascade', name: () => tl('Cycle A+ B+ B− A− en cascade (deux groupes)'),
    text: () => tl('Avec de simples galets, A+ B+ B− A− se bloque : a1 pilote encore B+ quand b1 commande B−. Le distributeur de cascade 3V1 n’alimente qu’une ligne à la fois (groupe I : A+ B+, groupe II : B− A−), les signaux ne se contredisent plus.'),
    circuit: () => cascadeCircuit()
  },
  {
    id: 'grafcet', name: () => tl('Cycle A+ B+ B− A− commandé par un GRAFCET'),
    text: () => tl('Le GRAFCET (bouton « GRAFCET » du plan) commande les électroaimants 1Y1, 1Y2, 2Y1, 2Y2 comme un automate ; ses réceptivités lisent les capteurs a0, a1, b0, b1 des vérins. Lancez la simulation et appuyez sur dcy.'),
    circuit: () => grafcetCircuit(true)
  },
  {
    id: 'macro', name: () => tl('GRAFCET avec macro-étape (M2 : perçage)'),
    text: () => tl('Le même cycle A+ B+ B− A−, mais le perçage B+ B− est une macro-étape M2 : la transition qui y mène active son étape d’entrée (20), celle qui en sort attend son étape de sortie (22). L’expansion est dessinée sous le GRAFCET.'),
    circuit: () => ({ ...grafcetCircuit(true), grafcet: MACRO_GRAFCET() })
  },
  {
    id: 'parallel', name: () => tl('Branches parallèles et action mémorisée (trois vérins)'),
    text: () => tl('A serre (1Y1:=1, action mémorisée : le distributeur monostable reste excité), puis B perce et C marque en même temps (divergence en ET) ; la convergence attend que les deux aient fini, puis 1Y1:=0 desserre.'),
    circuit: () => threeCircuit(true)
  },
  {
    id: 'safety', name: () => tl('Arrêt d’urgence (forçage) et compteur de cycles'),
    text: () => tl('dcy lance trois cycles (compteur N:=N+1, réceptivités N<3 et N>=3). Le GRAFCET de sécurité GS surveille au : arrêt d’urgence, il force GPN en {0} (F/GPN:{0}) et fait rentrer les tiges ; relâchez au puis appuyez sur rea pour réarmer.'),
    circuit: () => ({ ...grafcetCircuit(true), grafcet: SAFETY_GRAFCET() })
  },
  {
    id: 'enclosing', name: () => tl('Marche automatique (étape encapsulante)'),
    text: () => tl('marche active l’étape encapsulante X1 : son encapsulation enchaîne les cycles A+ B+ B− A−. Fermez arret : le cycle en cours se termine, X1 se désactive et toute son encapsulation avec elle.'),
    circuit: () => ({ ...grafcetCircuit(true), grafcet: ENCL_GRAFCET() })
  },
  {
    id: 'door', name: () => tl('Porte de TER : GRAFCET avec temporisation'),
    text: () => tl('dcy ouvre la porte, elle reste ouverte 5 s (réceptivité 5s/X2) puis se ferme ; si l’obstacle obs est détecté pendant la fermeture, elle se rouvre (divergence en OU vers X1).'),
    circuit: () => doorCircuit(true)
  },
  {
    id: 'force', name: () => tl('Force et pression (modèle physique)'),
    text: () => tl('Modèle physique : un vérin de 32 mm pousse une charge de 300 N. Sous 6 bar, sa force est de 482 N : il sort. Montez la charge à 500 N (onglet Pneumatique) : il reste bloqué, la pression de sa chambre au maximum.'),
    circuit: () => ({
      model: 'physical',
      elements: [E('c1', 'cyl2', 0, 0, { label: '1A', bore: 32, rod: 12, stroke: 100, mass: 2, load: 300 }), E('g', 'gauge', -7, 2), E('v1', 'v52', -8, 12, { left: 'push', right: 'spring', label: '1V1' }), E('fc', 'flowctl', 10, 5, { open: 40, label: '1V2' }), E('src', 'supply', 1, 20, { bar: 6 })],
      tubes: [T('t1', 'src', '1', 'v1', '1'), T('t2', 'v1', '4', 'c1', '1'), T('t3', 'v1', '2', 'fc', '1'), T('t4', 'fc', '2', 'c1', '2'), T('t5', 'g', '1', 'c1', '1')]
    })
  }
];
