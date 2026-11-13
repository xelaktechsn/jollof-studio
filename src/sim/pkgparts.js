// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Composants en paquet (.jpart, voir library/jpart.js) : ce que l'analyse du montage, le calcul du circuit et le
// vérificateur doivent savoir d'eux. Aucun code venu du paquet : un comportement déclaratif (charge résistive,
// LED, sorties de capteur), rangé ici à l'installation. Module sans dépendance, chargé aussi par le travailleur
// du vérificateur.

/** type (« pk-… ») → { pins, led, load, limits, sensorOut }. */
export const PKG = Object.create(null);

/** Les composants en paquet ont un type « pk-… » : il ne peut pas se confondre avec ceux de la bibliothèque. */
export const isPkgType = t => typeof t === 'string' && t.startsWith('pk-');
export const pkgOf = t => (isPkgType(t) && PKG[t]) || null;
/** Toutes les broches d'un paquet, pattes passives comprises (absentes de sa fiche de câblage). */
export const pkgPins = t => { const p = pkgOf(t); return p ? p.pins : null; };
/** LED déclarée : { anode, cathode, vf, color }, ou null. */
export const pkgLed = t => { const p = pkgOf(t); return (p && p.led) || null; };
/** Charge résistive déclarée : { pin, to, ohms }, ou null. */
export const pkgLoad = t => { const p = pkgOf(t); return (p && p.load) || null; };
/**
 * Résistance d'un paquet (Ω) : une charge entre ses pattes 1 et 2, qui se comporte alors en tout comme une
 * résistance res-… de la bibliothèque (pont diviseur, résistance série, puissance). 0 sinon.
 */
export function pkgOhms(t) {
  const l = pkgLoad(t);
  return l && ((l.pin === '1' && l.to === '2') || (l.pin === '2' && l.to === '1')) ? l.ohms : 0;
}
/** Limite propre au paquet (current : courant d'une LED, mA ; power : puissance d'une résistance, W), ou null. */
export const pkgLimit = (t, k) => { const p = pkgOf(t); return (p && p.limits && p.limits[k]) || null; };
/** Sorties d'un capteur en paquet, pour le vérificateur : broche → [min, max, volts absolus ?]. */
export const pkgSensorOut = t => { const p = pkgOf(t); return (p && p.sensorOut) || null; };
/** Résistance : celles de la bibliothèque (res-220…) et les résistances en paquet. */
export const isResistor = t => /^res-/.test(t) || pkgOhms(t) > 0;
/** Module I2C déclaré : { address, alt, addressPin, regBytes, registers, commands }, ou null. */
export const pkgI2c = t => { const p = pkgOf(t); return (p && p.i2c) || null; };
/** Module SPI déclaré : { mode, cs, frame | registers… }, ou null. */
export const pkgSpi = t => { const p = pkgOf(t); return (p && p.spi) || null; };
/** Sorties à impulsions déclarées : [{ pin, quantity, hzPer | curve }], ou null. */
export const pkgPulse = t => { const p = pkgOf(t); return (p && p.pulse && p.pulse.length && p.pulse) || null; };
/** Types en paquet qui ont ce comportement (bus « i2c », « spi » ou « pulse ») : les modèles du mode fidèle s'y branchent. */
export const pkgTypes = kind => Object.keys(PKG).filter(t => (kind === 'i2c' ? pkgI2c(t) : kind === 'spi' ? pkgSpi(t) : pkgPulse(t)));
