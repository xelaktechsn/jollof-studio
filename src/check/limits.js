// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Valeurs nominales et maximales des composants, lisibles par le vérificateur (et non plus seulement
// écrites dans les fiches). warn : au-delà, le composant s'use ou chauffe ; max : au-delà, il est détruit.
// Sources : fiches techniques usuelles (docs.js reprend ces chiffres pour les élèves).
import { BOARDS, boardOf } from '../sim/boards.js';
import { NPNS } from '../sim/parts.js';
import { tl, DEC } from '../i18n/index.js';

/** Courant dans une LED (mA) : par couleur pour une LED RVB, par segment pour un afficheur. */
export const LED = { warn: 20, max: 30 };
/** Puissance (W) d'une résistance 1/4 W, du potentiomètre, du haut-parleur. */
export const POWER = { res: { warn: 0.2, max: 0.25 }, pot: { warn: 0.08, max: 0.1 }, speaker: { warn: 0.4, max: 0.5 } };
/** Transistor BC547 : courant de collecteur (mA), tension collecteur-émetteur (V). Les autres modèles : NPNS (parts.js). */
export const NPN = NPNS.npn;
/** Diode 1N4007 : courant direct (mA). */
export const DIODE = { warn: 800, max: 1000 };
/** Tension maximale d'un condensateur (V). */
export const CAP_V = { 'cap-100n': 50, 'cap-100u': 16 };
/** Contacts du relais (mA), voie du pilote L298N (mA), régulateur LM7805 (mA). */
export const RELAY_CONTACT = 10000, L298N_CH = { warn: 1500, max: 2000 }, LM7805 = { warn: 1000, max: 1500 };
/**
 * LM7805 en boîtier TO-220 sans radiateur : RθJA ≈ 65 °C/W. À 40 °C ambiants (une salle de classe en saison chaude),
 * 1 W le porte à ≈ 105 °C ; au-delà de ≈ 1,3 W il atteint 125 °C et sa protection thermique coupe la sortie.
 */
export const LM7805_W = { warn: 1, max: 1.3 };
/** Buzzer actif : tension (V) au-delà de laquelle il s'abîme. */
export const BUZZER_V = { warn: 5.5, max: 7 };
/** Sources : courant débité (mA). Au-delà de « short », c'est un court-circuit. */
export const SOURCE = {
  bat9v: { warn: 300, max: 1000 }, bat18650: { warn: 3000, max: 5000 }, mb102: { warn: 500, max: 700 }
};
export const SHORT_MA = 2000;

/**
 * Broches d'une carte : courant par GPIO (mA), total des GPIO, broches 5V et 3V3 (mA), tension admise sur une GPIO.
 * Uno/Nano : 20 mA conseillés, 40 mA maximum, 200 mA au total ; 3V3 : 50 mA. ESP32 : 20/40 mA ; 3V3 : ≈ 300 mA.
 * ESP8266 : 12/20 mA. Pico : 12/16 mA, 50 mA au total. 5V (USB) : 500 mA.
 */
const BOARD = {
  uno: { pin: { warn: 20, max: 40 }, total: 200, five: 500, three: 50 },
  nano: { pin: { warn: 20, max: 40 }, total: 200, five: 500, three: 50 },
  esp32: { pin: { warn: 20, max: 40 }, total: 1200, five: 500, three: 300 },
  nodemcu: { pin: { warn: 12, max: 20 }, total: 300, five: 500, three: 300 },
  pico: { pin: { warn: 12, max: 16 }, total: 50, five: 500, three: 300 }
};
const FAMILY = { atmega328p: 'uno', esp8266: 'nodemcu', rp2040: 'pico' };
/** Limites d'une carte (profil importé : celles de sa famille). */
export function boardLimits(c) {
  const p = boardOf(c); if (!p) return null;
  const kind = BOARDS[c.type] ? c.type : FAMILY[p.family] || 'esp32';
  const b = BOARD[kind] || BOARD.esp32;
  // Une GPIO ne supporte pas plus que sa tension logique plus la marge de ses diodes de protection : VCC + 0,5 V pour
  // l'ATmega328P, VDD + 0,3 V (3,6 V) pour l'ESP32, l'ESP8266 et le RP2040.
  const m = p.logic > 4 ? 0.5 : 0.3;
  return { ...b, kind, vmax: p.logic + m, vmin: -m, logic: p.logic };
}

/**
 * Lignes « Limites vérifiées » d'une fiche (documentation) : [libellé, valeur]. Ce que le vérificateur contrôle
 * pour ce composant dans tous les états du montage.
 */
export function limitRows(type, prof, spec, MOTORS) {
  const ma = v => (v >= 1000 ? `${String(v / 1000).replace('.', DEC)} A` : `${v} mA`), w = v => (v >= 1 ? `${v} W` : `${Math.round(v * 1000)} mW`);
  const both = (l, f) => tl('{0} conseillés, {1} au plus', f(l.warn), f(l.max));
  const rows = [];
  if (/^led-(red|green|blue|yellow|white)$/.test(type)) rows.push([tl('Courant'), both(LED, ma)]);
  if (type === 'led-rgb' || type === '7seg') rows.push([tl('Courant par couleur ou segment'), both(LED, ma)]);
  if (/^res-/.test(type)) rows.push([tl('Puissance'), tl('{0} au plus (1/4 W)', w(POWER.res.max))]);
  if (type === 'pot') rows.push([tl('Puissance'), tl('{0} au plus', w(POWER.pot.max))]);
  if (type === 'speaker') rows.push([tl('Puissance'), tl('{0} au plus', w(POWER.speaker.max))]);
  if (NPNS[type]) rows.push([tl('Courant de collecteur'), both(NPNS[type].ic, ma)], [tl('Tension collecteur-émetteur'), `${NPNS[type].vce} V`]);
  if (type === 'diode') rows.push([tl('Courant direct'), tl('{0} au plus', ma(DIODE.max))]);
  if (CAP_V[type]) rows.push([tl('Tension de service'), `${CAP_V[type]} V`]);
  if (type === 'relay') rows.push([tl('Contacts'), tl('{0} au plus', ma(RELAY_CONTACT))]);
  if (type === 'l298n') rows.push([tl('Courant par voie'), tl('{0} au plus', ma(L298N_CH.max))]);
  if (type === 'lm7805') rows.push([tl('Courant de sortie'), tl('{0} au plus', ma(LM7805.max))]);
  if (type === 'buzzer') rows.push([tl('Tension'), tl('{0} conseillés, {1} au plus', `${String(BUZZER_V.warn).replace('.', DEC)} V`, `${BUZZER_V.max} V`)]);
  if (SOURCE[type]) rows.push([tl('Courant débité'), both(SOURCE[type], ma)]);
  const m = MOTORS && MOTORS[type];
  if (m) rows.push([tl('Tension'), tl('{0} prévus, {1} au plus', `${m.vNom} V`, `${m.vMax} V`)]);
  if (prof) {
    const b = boardLimits({ type, pins: {} }) || {};
    if (b.pin) rows.push([tl('Courant par broche'), both(b.pin, ma)], [tl('Toutes les broches ensemble'), tl('{0} au plus', ma(b.total))], [tl('Broche 5V (USB)'), tl('{0} au plus', ma(b.five))], [tl('Broche 3V3'), tl('{0} au plus', ma(b.three))], [tl('Tension sur une broche'), tl('0 à {0}', `${String(Math.round((prof.logic + (prof.logic > 4 ? 0.5 : 0.3)) * 10) / 10).replace('.', DEC)} V`)]);
  }
  if (NPNS[type]) rows.push([tl('Puissance dissipée'), tl('{0} au plus', w(NPNS[type].p / 1000))]);
  if (type === 'lm7805') rows.push([tl('Puissance dissipée sans radiateur'), tl('{0} conseillés, {1} au plus', w(LM7805_W.warn), w(LM7805_W.max))]);
  if (spec && spec.ma) rows.push([tl('Consommation'), ma(spec.ma)]);
  if (spec && spec.pins) for (const p of spec.pins) if (p.kind === 'ext' && Array.isArray(p.v)) rows.push([tl('Alimentation {0}', p.pin), tl('{0} à {1}', `${String(p.v[0]).replace('.', DEC)} V`, `${String(p.v[1]).replace('.', DEC)} V`)]);
  if (spec && spec.pins) for (const p of spec.pins) if (p.kind === 'pwr' && Array.isArray(p.v)) rows.push([tl('Alimentation {0}', p.pin), tl('{0} à {1}', `${String(p.v[0]).replace('.', DEC)} V`, `${String(p.v[1]).replace('.', DEC)} V`)]);
  return rows;
}
