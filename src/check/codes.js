// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Codes stables des diagnostics du vérificateur, comme ceux de rustc (E0308…) : un numéro ne change jamais
// de sens. Familles : J01 alimentation et courts-circuits, J02 signaux (le « type » de chaque broche),
// J03 valeurs nominales prouvées dans tous les états, J04 polarité, J05 moteurs, J06 programme ↔ montage,
// J09 conseils (avertissements qu'on peut accepter), J1 code du programme.
// key : code de l'ancienne détection (circuit.js, faults.js) que ce numéro reprend.
import { tl, DEC } from '../i18n/index.js';

const dec = v => String(Math.round(v * 10) / 10).replace('.', DEC);
export const fmtMA = v => (Math.abs(v) >= 1000 ? `${dec(v / 1000)} A` : `${Math.round(v)} mA`);
export const fmtV = v => `${dec(v)} V`;
export const fmtW = v => (v >= 1 ? `${dec(v)} W` : `${Math.round(v * 1000)} mW`);
/** Limite citée dans un titre : « 40 mA au plus » (erreur) ou « 20 mA conseillés » (avertissement). */
const lim = (m, f) => (m.soft ? tl('{0} conseillés', f(m.limit)) : tl('{0} au plus', f(m.limit)));

/** level : 'error' (bloque) ou 'warning' ; family : J01… ; key : ancien code ; title(m) pour les nouveaux contrôles. */
export const CODES = {
  J0101: { key: 'short-g', level: 'error' },
  J0102: { key: 'short-v', level: 'error' },
  J0103: { level: 'error', title: m => tl('Court-circuit : {0} débite {1}', m.name, fmtMA(m.value)) },
  J0104: { key: 'nopower', level: 'error' },
  J0105: { key: 'undervolt', level: 'error' },
  J0106: { key: 'overvolt', level: 'error' },
  J0107: { key: 'nognd', level: 'error' },
  J0108: { key: 'commongnd', level: 'error' },
  J0109: { level: 'error', title: m => tl('{0} surchargée : {1} ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0110: { key: 'swshort', level: 'error' },
  J0111: { level: 'error', title: m => tl('{0} reçoit {1} ({2} à {3} admis)', m.name, fmtV(m.value), fmtV(m.lo), fmtV(m.hi)) },
  J0112: { level: 'warning', title: m => tl('{0} ne reçoit que {1} : il faut au moins {2}', m.name, fmtV(m.value), fmtV(m.lo)) },
  J0201: { key: 'topwr', level: 'error' },
  J0202: { key: 'togn', level: 'error' },
  J0203: { key: 'nogpio', level: 'error' },
  J0204: { key: 'cap', level: 'error' },
  J0205: { key: 'flash', level: 'error' },
  J0206: { key: 'bus', level: 'error' },
  J0207: { key: 'lv5', level: 'warning' },
  J0208: { key: 'lv3', level: 'warning' },
  J0209: { key: 'pullup', level: 'warning' },
  J0210: { key: 'pulldown', level: 'warning' },
  J0211: { key: 'uart0', level: 'warning' },
  J0212: { key: 'nores', level: 'warning' },
  J0301: { level: 'error', title: m => tl('{0} traversée par {1} ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0302: { key: 'gpioover', level: 'error', title: m => tl('{0} débite {1} ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0303: { level: 'error', title: m => tl('{0} reçoit {1} : au-delà de sa tension ({2})', m.name, fmtV(m.value), lim(m, fmtV)) },
  J0304: { level: 'error', title: m => tl('{0} dissipe {1} ({2})', m.name, fmtW(m.value), lim(m, fmtW)) },
  J0305: { level: 'error', title: m => tl('{0} : {1} dans le collecteur ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0306: { level: 'error', title: m => tl('{0} alimenté sous {1} ({2})', m.name, fmtV(m.value), lim(m, fmtV)) },
  J0307: { level: 'error', title: m => tl('{0} sous {1} : au-delà de sa tension de service ({2})', m.name, fmtV(m.value), fmtV(m.limit)) },
  J0308: { level: 'error', title: m => tl('{0} traversée par {1} ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0309: { level: 'error', title: m => tl('{0} : {1} sur une voie ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0310: { level: 'error', title: m => tl('{0} : {1} dans ses contacts ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0311: { key: 'motorover', level: 'warning', title: m => tl('{0} sous {1} pour {2} prévus', m.name, fmtV(m.value), fmtV(m.limit)) },
  J0312: { key: 'servolow', level: 'warning', title: m => tl('{0} sous-alimenté : {1}', m.name, fmtV(m.value)) },
  J0313: { level: 'error', title: m => tl('{0} reçoit {1} ({2})', m.name, fmtW(m.value), lim(m, fmtW)) },
  J0314: { level: 'error', title: m => tl('{0} dissipe {1} ({2})', m.name, fmtW(m.value), lim(m, fmtW)) },
  J0315: { level: 'error', title: m => tl('{0} sous {1} ({2})', m.name, fmtV(m.value), lim(m, fmtV)) },
  J0316: { level: 'error', title: m => tl('{0} dissipe {1} ({2})', m.name, fmtW(m.value), lim(m, fmtW)) },
  J0317: { level: 'error', title: m => tl('{0} dissipe {1} sans radiateur ({2})', m.name, fmtW(m.value), lim(m, fmtW)) },
  J0318: { level: 'error', title: m => tl('{0} : {1} dans le drain ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0319: { level: 'error', title: m => tl('{0} : {1} entre grille et source ({2})', m.name, fmtV(m.value), lim(m, fmtV)) },
  J0320: { level: 'error', title: m => tl('{0} : {1} entre drain et source ({2})', m.name, fmtV(m.value), lim(m, fmtV)) },
  J0321: { level: 'error', title: m => tl('{0} : {1} sur sa sortie ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0322: { level: 'error', title: m => tl('{0} traversée par {1} ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0323: { level: 'warning', title: m => tl('{0} à {1} : hors de la plage d’entrée de l’ampli (au plus {2})', m.name, fmtV(m.value), fmtV(m.limit)) },
  J0324: { level: 'error', title: m => tl('{0} à {1} : sous la masse ({2})', m.name, fmtV(m.value), lim(m, fmtV)) },
  J0325: { level: 'error', title: m => tl('{0} dissipe {1} sans radiateur ({2})', m.name, fmtW(m.value), lim(m, fmtW)) },
  J0401: { key: 'reversed', level: 'error' },
  J0402: { key: 'capreversed', level: 'error', title: m => tl('{0} monté à l’envers : {1} entre + et −', m.name, fmtV(m.value)) },
  J0403: { key: 'fanrev', level: 'warning', title: m => tl('{0} branché à l’envers : {1} sur le fil rouge', m.name, fmtV(m.value)) },
  J0501: { key: 'drvdirect', level: 'error' },
  J0502: { key: 'drvmissing', level: 'error' },
  J0601: { level: 'error', title: m => tl('Deux sorties sur le même nœud : {0} et {1}', m.a, m.b) },
  J0602: { level: 'error', title: m => tl('{0} lue sans niveau défini', m.name) },
  J0603: { level: 'error', title: m => tl('analogWrite sur {0}, qui n’a pas de PWM', m.name) },
  J0604: { level: 'error', title: m => tl('analogRead sur {0}, qui n’est pas une entrée analogique', m.name) },
  J0605: { level: 'warning', title: m => tl('{0} commandée mais reliée à rien', m.name) },
  J0606: { level: 'warning', title: m => tl('{0} câblé mais jamais utilisé par le programme', m.name) },
  J0607: { level: 'warning', title: m => tl('digitalWrite sur {0} sans pinMode(OUTPUT)', m.name) },
  J0608: { level: 'error', title: m => tl('{0} en sortie contre la sortie de {1}', m.name, m.b) },
  J0609: { level: 'error', title: m => tl('Broche {0} inconnue sur {1}', m.name, m.b) },
  J0610: { level: 'error', title: m => tl('{0} et {1} répondent à la même adresse I2C (0x{2})', m.a, m.b, m.addr) },
  // Plan pneumatique et électropneumatique : le titre vient du vérificateur du plan (src/pneu/check.js).
  J0701: { level: 'error' }, J0702: { level: 'warning' }, J0703: { level: 'error' }, J0704: { level: 'warning' },
  J0901: { level: 'warning', title: m => tl('{0} sans diode de roue libre', m.name) },
  J0902: { level: 'warning', title: m => tl('{0} : {1} demandés, la pile se videra vite', m.name, fmtMA(m.value)) },
  J0903: { level: 'warning', title: m => tl('{0} : broche de démarrage tirée au niveau {1}', m.name, m.high ? tl('haut') : tl('bas')) },
  J1001: { level: 'error' }, J1002: { level: 'error' }, J1101: { level: 'error' }, J1102: { level: 'error' },
  J1103: { level: 'error' }, J1104: { level: 'error' }, J1105: { level: 'error' }, J1106: { level: 'error' },
  J1107: { level: 'error' }, J1108: { level: 'error' }, J1109: { level: 'warning' }, J1110: { level: 'error' }, J1111: { level: 'error' }, J1199: { level: 'error' }
};
/** Ancien code (circuit.js, faults.js) → numéro stable. */
export const BY_KEY = Object.fromEntries(Object.entries(CODES).filter(([, c]) => c.key).map(([j, c]) => [c.key, j]));
/** Famille d'un code, pour regrouper. */
export const FAMILY = {
  J01: tl('Alimentation et courts-circuits'), J02: tl('Signaux et broches'), J03: tl('Valeurs nominales'), J04: tl('Polarité'),
  J05: tl('Moteurs'), J06: tl('Programme et montage'), J07: tl('Pneumatique et électropneumatique'), J09: tl('Conseils'), J1: tl('Code du programme')
};
export const familyOf = code => FAMILY[code.slice(0, 3)] || FAMILY[code.slice(0, 2)] || '';
