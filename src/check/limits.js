// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Valeurs nominales et maximales des composants, lisibles par le vérificateur (et non plus seulement
// écrites dans les fiches). warn : au-delà, le composant s'use ou chauffe ; max : au-delà, il est détruit.
// Sources : fiches techniques de sources.js, citées par la clé src de chaque limite, ou par LIMIT_SRC pour les nombres
// simples (docs.js reprend ces chiffres pour les élèves).
import { boardOf, kindOf } from '../sim/boards.js';
import { NPNS, ZENERS } from '../sim/parts.js';
import { tl, DEC } from '../i18n/index.js';

/** Courant dans une LED (mA) : par couleur pour une LED RVB, par segment pour un afficheur. */
export const LED = { warn: 20, max: 30, src: ['kingbrightWp7113id', 'kingbrightWp7113qbcd'] };
/**
 * Maximum par couleur (Kingbright WP7113 : la verte ne supporte que 25 mA en continu) ; LED RVB WP154A4 : rouge et bleu
 * 30 mA, vert 25 mA. 20 mA conseillés pour toutes (courant d'essai des fiches).
 */
export const LED_BY = {
  'led-green': { warn: 20, max: 25, src: 'kingbrightWp7113gd' }, 'led-yellow': { warn: 20, max: 30, src: 'kingbrightWp7113yd' },
  'led-white': { warn: 20, max: 30, src: 'kingbrightWp7113qwcd' }, '7seg': { warn: 20, max: 30, src: 'kingbrightSc56' },
  'led-rgb.G': { warn: 20, max: 25, src: 'kingbrightWp154' }, 'led-rgb.R': { warn: 20, max: 30, src: 'kingbrightWp154' }, 'led-rgb.B': { warn: 20, max: 30, src: 'kingbrightWp154' }
};
/** Limite de courant d'une LED (type, et couleur d'une LED RVB). */
export const ledLimit = (type, ch) => LED_BY[ch ? `${type}.${ch}` : type] || LED;
/** Puissance (W) d'une résistance 1/4 W, du potentiomètre, du haut-parleur. */
export const POWER = {
  res: { warn: 0.2, max: 0.25, src: 'yageoCfr' }, pot: { warn: 0.06, max: 0.08, src: 'bournsPdb12' }, speaker: { warn: 0.4, max: 0.5, src: 'sameSkyCms40558n' }
};
/** Transistor BC547 : courant de collecteur (mA), tension collecteur-émetteur (V). Les autres modèles : NPNS (parts.js). */
export const NPN = NPNS.npn;
/** Diode 1N4007 : courant direct (mA). */
export const DIODE = { warn: 800, max: 1000, src: 'vishay1n4007' };
/** Diodes Zener BZX55 : puissance dissipée (W), Ptot 500 mW (ZENERS, parts.js) ; 80 % conseillés. */
export const ZENER_W = Object.fromEntries(Object.entries(ZENERS).map(([k, z]) => [k, { warn: z.p * 0.8 / 1000, max: z.p / 1000, src: z.src }]));
/** Tension maximale d'un condensateur (V). */
export const CAP_V = { 'cap-100n': 50, 'cap-100u': 16 };
/** Contacts du relais (mA), voie du pilote L298N (mA), régulateur LM7805 (mA). */
export const RELAY_CONTACT = 7000, L298N_CH = { warn: 1500, max: 2000, src: 'stL298' }, LM7805 = { warn: 1000, max: 1500, src: ['onsemiMc7800', 'stL78'] };
/**
 * Voie d'un pont en H (mA, courant continu dans une sortie). L293D : 600 mA par voie en continu (1,2 A en pointe
 * seulement) ; TB6612FNG : 1,2 A moyens par voie (3,2 A en pointe d'une impulsion de 10 ms) ; warn : 1 A, le courant
 * continu annoncé par Pololu pour la carte sans refroidissement.
 */
export const L293D_CH = { warn: 500, max: 600, src: 'tiL293d' }, TB6612_CH = { warn: 1000, max: 1200, src: ['toshibaTb6612', 'pololuTb6612'] };
/**
 * Pilotes pas à pas : courant par phase réglé par le potentiomètre (mA). warn : au-delà, la carte chauffe sans radiateur
 * ni ventilation (A4988 ≈ 1 A, DRV8825 ≈ 1,5 A d'après Pololu) ; max : maximum de la puce (2 A ; 2,2 A pour la carte DRV8825).
 */
export const STEP_DRV = {
  a4988: { warn: 1000, max: 2000, src: ['allegroA4988', 'pololuA4988'] },
  drv8825: { warn: 1500, max: 2200, src: ['tiDrv8825', 'pololuDrv8825'] }
};
/** Moteur pas à pas : courant nominal par phase (mA) ; au-delà de 120 % il chauffe trop (seuil de conception). */
export const STEPPER_I = { nema17: { warn: 1700, max: 2040, src: 'nema17hs4401' } };
/**
 * LM7805 en boîtier TO-220 sans radiateur : RθJA ≈ 65 °C/W. À 40 °C ambiants (une salle de classe en saison chaude),
 * 1 W le porte à ≈ 105 °C ; au-delà de ≈ 1,3 W il atteint 125 °C et sa protection thermique coupe la sortie.
 */
export const LM7805_W = { warn: 1, max: 1.3, src: 'onsemiMc7800' };
/** Module AMS1117-3.3 : courant de sortie (mA), 0,8 A (courant d'essai de la chute et de la régulation de charge), 1 A au plus. */
export const AMS1117 = { warn: 800, max: 1000, src: 'ams1117' };
/**
 * AMS1117 en SOT-223 : θJA = 90 °C/W. À 40 °C ambiants, 0,72 W porte la jonction à 105 °C ; 0,94 W à 125 °C, sa
 * température maximale (limitation thermique interne au-delà).
 */
export const AMS1117_W = { warn: 0.72, max: 0.94, src: 'ams1117' };
/**
 * Module LM2596 : courant de sortie (mA). 3 A garantis par la fiche ; au-delà de 2 A, le petit module sans radiateur
 * chauffe (seuil de conception repris des vendeurs de modules : la fiche suppose un TO-220 sur radiateur).
 */
export const LM2596 = { warn: 2000, max: 3000, src: 'onsemiLm2596' };
/** Module MT3608 : courant d'entrée (mA), qui traverse l'inductance et l'interrupteur : 2 A annoncés, l'interrupteur coupe à 4 A. */
export const MT3608 = { warn: 2000, max: 4000, src: 'aerosemiMt3608' };
/** Chargeur TP4056 : tension d'entrée maximale (V) et courant de charge réglé par RPROG = 1,2 kΩ (mA). */
export const TP4056 = { vin: 8, ichg: 1000, src: 'topPowerTp4056' };
/** Panneau solaire 6 V 1 W (Adafruit 3809) : tension à vide (V), courant au point de puissance maximale (mA). */
export const SOLAR6V = { voc: 7.7, imp: 180, src: 'adafruitSolar3809' };
/** Buzzer actif : tension (V) au-delà de laquelle il s'abîme. */
export const BUZZER_V = { warn: 5.5, max: 7, src: 'sameSkyCmi1295' };
/** Sources : courant débité (mA). Au-delà de « short », c'est un court-circuit. */
export const SOURCE = {
  bat9v: { warn: 300, max: 1000, src: 'energizer522' }, bat18650: { warn: 3000, max: 5000, src: 'samsungIcr18650' },
  mb102: { warn: 500, max: 700, src: ['mb102', 'ams1117'] }
};
export const SHORT_MA = 2000;
/** NE555 : courant de sortie (mA), ±200 mA recommandés, ±225 mA au maximum absolu. */
export const NE555_OUT = { warn: 200, max: 225, src: 'tiNe555' };
/** LM358 : tension sur une entrée (V, maximum absolu) et marge de la plage de mode commun sous V+ (à 25 °C). */
export const LM358_IN = { min: -0.3, max: 32, cmr: 1.5, src: 'tiLm358' };
/** IRLZ44N : courant de drain (mA, 33 A à TC = 100 °C, 47 A à 25 °C), tensions drain-source et grille-source maximales (V). */
export const IRLZ44N = { id: { warn: 33000, max: 47000 }, vds: 55, vgs: 16, src: 'infineonIrlz44n' };
/**
 * IRLZ44N en TO-220 sans radiateur : RθJA = 62 °C/W. À 40 °C ambiants, 1,37 W porte la jonction à 125 °C ; 2,18 W à
 * 175 °C, sa température maximale.
 */
export const IRLZ44N_W = { warn: 1.37, max: 2.18, src: 'infineonIrlz44n' };
/**
 * IRF9540N (canal P) : courant de drain (mA, 16 A à TC = 100 °C, 23 A à 25 °C), tensions drain-source et grille-source
 * maximales (V, en valeur absolue). Sans radiateur, même boîtier TO-220 et même RθJA (62 °C/W) que l'IRLZ44N.
 */
export const IRF9540N = { id: { warn: 16000, max: 23000 }, vds: 100, vgs: 20, src: 'infineonIrf9540n' };
export const IRF9540N_W = { warn: 1.37, max: 2.18, src: 'infineonIrf9540n' };
/**
 * Puces logiques (sim/chips.js) : courant d'une sortie (mA, fourni ou absorbé) et courant total par VCC et par GND (mA),
 * maxima absolus des fiches. 74HC595 : ±35 mA par sortie, ±70 mA par VCC ou GND ; 74HC165 : ±25 et ±50 mA ;
 * MCP23017 : 25 mA par broche, 125 mA entrant par VDD, 150 mA sortant par VSS ; PCF8574 : 25 mA par broche (NXP),
 * 100 mA par VDD ou VSS, 80 mA absorbés conseillés ; PCA9685 : 25 mA par sortie, 400 mA par VSS. warn : 20 mA par
 * sortie, comme une GPIO (seuil de conception : au-delà, la sortie s'écarte nettement de son niveau logique).
 */
export const CHIP_I = {
  hc595: { out: { warn: 20, max: 35 }, vcc: { max: 70 }, gnd: { max: 70 }, src: 'tiHc595' },
  hc165: { out: { warn: 20, max: 25 }, vcc: { max: 50 }, gnd: { max: 50 }, src: 'tiHc165' },
  mcp23017: { out: { warn: 20, max: 25 }, vcc: { max: 125 }, gnd: { max: 150 }, src: 'microchipMcp23017' },
  pcf8574: { out: { warn: 20, max: 25 }, vcc: { max: 100 }, gnd: { warn: 80, max: 100 }, src: ['tiPcf8574', 'nxpPcf8574'] },
  pca9685: { out: { warn: 20, max: 25 }, vcc: { max: 400 }, gnd: { max: 400 }, src: 'nxpPca9685' }
};
/**
 * MAX7219 (modules à matrice ou à chiffres) : courant par segment fixé par la résistance RSET du module (≈ 10 kΩ :
 * 40 mA crête), 320 mA quand les 8 segments d'un chiffre sont allumés, 330 mA pour la puce entière (fiche : I+ avec
 * tous les segments allumés, ISEG = 40 mA). Les modules d'une chaîne s'additionnent.
 */
export const MAX7219_I = { seg: 40, dig: 320, total: 330, src: 'maximMax7219' };
/**
 * Capteur de courant ACS712 : plage de précision ±5, ±20 ou ±30 A selon la version (au-delà, la sortie sature : avertissement) ;
 * 100 A au plus, une impulsion de 100 ms (« Overcurrent Transient Tolerance ») : au-delà, erreur. Courants en mA.
 */
export const ACS712_I = { range: { 5: 5000, 20: 20000, 30: 30000 }, max: 100000, src: 'allegroAcs712' };
/** Bobine 10 mH : courant (mA) qui l'échauffe de 35 °C (courant assigné), et courant de saturation (−10 % d'inductance). */
export const INDUCTOR = { 'ind-10m': { warn: 76, max: 110, src: 'bourns5800' } };

/**
 * Broches d'une carte : courant par GPIO (mA), total des GPIO, broches 5V et 3V3 (mA), tension admise sur une GPIO.
 * Uno/Nano : 20 mA conseillés, 40 mA maximum, 200 mA au total ; 3V3 : 50 mA. ESP32 : 20/40 mA ; 3V3 : ≈ 300 mA.
 * ESP32-S3 : 20/40 mA, 1500 mA au total ; ESP32-C3 : 20/40 mA, 1000 mA au total.
 * ESP8266 : 12/20 mA. Pico : 12/16 mA, 50 mA au total. 5V (USB) : 500 mA.
 */
// vih, vil : seuils des entrées ({ k } fois la tension logique, ou { v } volts) ; rpu : tirage interne le plus faible (Ω) ;
// radio : courant de l'émission Wi-Fi (mA), pris sur le 3,3 V de la carte ; adc : tension au-delà de laquelle analogRead()
// sature (atténuation par défaut) ; groups : sommes de courant par groupe de ports (ATmega).
const AVR5 = { vih: { k: 0.6 }, vil: { k: 0.3 }, rpu: 50000, inj: 1 };
const ESP = { vih: { k: 0.75 }, vil: { k: 0.25 }, rpu: 45000 };
const BOARD = {
  uno: { pin: { warn: 20, max: 40 }, total: 200, five: 500, three: 50, ...AVR5, groups: 'm328' },
  nano: { pin: { warn: 20, max: 40 }, total: 200, five: 500, three: 50, ...AVR5, groups: 'm328' },
  mega: { pin: { warn: 20, max: 40 }, total: 200, five: 500, three: 50, ...AVR5, groups: 'm2560' },
  esp32: { pin: { warn: 20, max: 40 }, total: 1200, five: 500, three: 300, ...ESP, radio: 240, adc: 3.1 },
  esp32s3: { pin: { warn: 20, max: 40 }, total: 1500, five: 500, three: 300, ...ESP, radio: 340, adc: 3.1 },
  esp32c3: { pin: { warn: 20, max: 40 }, total: 1000, five: 500, three: 300, ...ESP, radio: 335, adc: 2.5 },
  nodemcu: { pin: { warn: 8, max: 12 }, total: 300, five: 500, three: 300, vih: { k: 0.75 }, vil: { k: 0.25 }, rpu: null, radio: 170 },
  pico: { pin: { warn: 8, max: 12 }, total: 50, five: 500, three: 300, vih: { v: 2.0 }, vil: { v: 0.8 }, rpu: 80000 }
};
/**
 * Ports de l'ATmega derrière chaque broche Arduino, et sommes de courant par groupe de ports (notes 3 et 4 des
 * caractéristiques DC). ATmega328P : IOH (fourni) 150 mA par groupe, IOL (absorbé) 100 mA ; ATmega2560 : 200 ou 100 mA,
 * mêmes groupes pour IOH et IOL.
 */
const M328 = k => { const m = /^(?:D|RX|TX)(\d+)$/.exec(k); if (m) { const n = +m[1]; return n < 8 ? `D${n}` : n < 14 ? `B${n - 8}` : null; } const a = /^A([0-5])$/.exec(k); return a ? `C${a[1]}` : k === 'SDA' ? 'C4' : k === 'SCL' ? 'C5' : null; };
const MEGA_PORT = ['E0', 'E1', 'E4', 'E5', 'G5', 'E3', 'H3', 'H4', 'H5', 'H6', 'B4', 'B5', 'B6', 'B7', 'J1', 'J0', 'H1', 'H0', 'D3', 'D2', 'D1', 'D0',
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'C7', 'C6', 'C5', 'C4', 'C3', 'C2', 'C1', 'C0', 'D7', 'G2', 'G1', 'G0',
  'L7', 'L6', 'L5', 'L4', 'L3', 'L2', 'L1', 'L0', 'B3', 'B2', 'B1', 'B0'];
const M2560 = k => { const m = /^D(\d+)$/.exec(k); if (m) return MEGA_PORT[+m[1]] || null; const a = /^A(\d+)$/.exec(k); if (a) return +a[1] < 8 ? `F${a[1]}` : `K${+a[1] - 8}`; return k === 'SDA' ? 'D1' : k === 'SCL' ? 'D0' : null; };
const inPorts = (spec) => p => spec.some(s => (s.length === 1 ? p[0] === s : p === s));
export const PORT_GROUPS = {
  m328: { port: M328, src: 'atmega328p', groups: [
    { dir: 'source', name: 'PC0–PC5, PD0–PD4', has: inPorts(['C', 'D0', 'D1', 'D2', 'D3', 'D4']), max: 150 },
    { dir: 'source', name: 'PB0–PB5, PD5–PD7', has: inPorts(['B', 'D5', 'D6', 'D7']), max: 150 },
    { dir: 'sink', name: 'PC0–PC5', has: inPorts(['C']), max: 100 },
    { dir: 'sink', name: 'PB0–PB5, PD5–PD7', has: inPorts(['B', 'D5', 'D6', 'D7']), max: 100 },
    { dir: 'sink', name: 'PD0–PD4', has: inPorts(['D0', 'D1', 'D2', 'D3', 'D4']), max: 100 }] },
  m2560: { port: M2560, src: 'atmega2560', groups: ['source', 'sink'].flatMap(dir => [
    { dir, name: 'PJ, PA, PG2', has: inPorts(['J', 'A', 'G2']), max: 200 },
    { dir, name: 'PC, PG0–PG1, PD, PL', has: inPorts(['C', 'G0', 'G1', 'D', 'L']), max: 200 },
    { dir, name: 'PG3–PG4, PB, PH', has: inPorts(['G3', 'G4', 'B', 'H']), max: 200 },
    { dir, name: 'PE, PG5', has: inPorts(['E', 'G5']), max: 100 },
    { dir, name: 'PF, PK', has: inPorts(['F', 'K']), max: 100 }]) }
};
/** Broches de l'ESP32 : ADC2 (inutilisable pendant le Wi-Fi), mémoire flash (GPIO 6 à 11). */
export const ESP32_PINS = { adc2: [0, 2, 4, 12, 13, 14, 15, 25, 26, 27], flash: [6, 7, 8, 9, 10, 11], src: ['esp32', 'espIdfAdc'] };
/** Broches de démarrage qui choisissent la tension de la flash : au niveau haut, flash à 1,8 V et la carte ne démarre pas. */
export const FLASH_STRAP = { esp32: ['D12'], 'esp32-38': ['IO12'], esp32s3: ['IO45'], src: ['esp32', 'esp32s3'] };
/**
 * Bus I2C (UM10204) : niveau bas 0,4 V à 3 mA absorbés (Standard et Fast mode), temps de montée 1000 ns (100 kHz) ou
 * 300 ns (400 kHz), 10 pF par broche, 400 pF au plus. Rp(min) = (VDD − 0,4 V) ÷ 3 mA ; Rp(max) = tr ÷ (0,8473 × Cb).
 */
export const I2C = { vol: 0.4, iol: 3, tr: { 100000: 1000, 400000: 300, 1000000: 120 }, ci: 10, cbMax: 400, src: 'nxpUm10204' };
/** Capacité des fils et de la breadboard d'un bus I2C (pF) : seuil de conception (≈ 1 pF par cm de fil, quelques connexions). */
export const I2C_WIRING_PF = 40;
/**
 * Déclassement (EEE-INST-002 de la NASA, Table 4 de chaque section) : part de la valeur maximale à ne pas dépasser pour
 * qu'un composant dure. Résistances : 60 % de la puissance ; céramiques : 60 % de la tension ; diodes : 50 % du courant,
 * Zener 50 % de la puissance ; transistors bipolaires : 60 % de la puissance, 75 % du courant ; MOSFET : 60 % de la
 * puissance, 75 % de VDS, 60 % de VGS ; circuits intégrés : 80 % du courant de sortie ; interrupteurs : 75 % du courant.
 */
export const DERATE = { res: 0.6, ceramic: 0.6, diode: 0.5, zener: 0.5, bjtP: 0.6, bjtI: 0.75, fetP: 0.6, fetVds: 0.75, fetVgs: 0.6, ic: 0.8, contact: 0.75, src: 'nasaEee002' };
/** Condensateurs électrolytiques : 80 % de la tension de service (seuil de conception : EEE-INST-002 ne les traite pas). */
export const DERATE_ECAP = 0.8;
/**
 * Commutation : la sortie d'un MOSFET n'est garantie (RDS(on)) qu'à partir de la tension de grille de la fiche ; un
 * transistor bipolaire n'est saturé (VCE(sat)) qu'avec IB ≥ IC ÷ β forcé (20 pour BC547 et BC557, 10 pour PN2222A et
 * PN2907A : conditions d'essai de VCE(sat)).
 */
export const SWITCHING = { irlz44n: { vgsOn: 4 }, irf9540n: { vgsOn: 10 }, npn: { betaSat: 20 }, pnp: { betaSat: 20 }, pn2222: { betaSat: 10 }, pn2907: { betaSat: 10 },
  src: ['infineonIrlz44n', 'infineonIrf9540n', 'onsemiBc547', 'onsemiBc557', 'onsemiPn2222a', 'onsemiPn2907a'] };
/** Condensateurs d'un LM7805 (application de la fiche ST) : 0,33 µF à l'entrée, 0,1 µF à la sortie. */
export const LM7805_CAPS = { cin: 0.33e-6, cout: 0.1e-6, src: ['stL78', 'onsemiMc7800'] };
/**
 * Sources des limites écrites en nombres simples (clé de SOURCES, ou liste de clés) ; celles des objets sont dans leur
 * clé src. BOARD : pour chaque carte, pin, total, five, three, et vmax (la marge des diodes de protection, qui donne
 * aussi vmin). null : seuil de conception, sans fiche technique.
 */
export const LIMIT_SRC = {
  CAP_V: { 'cap-100n': 'vishayKSeries', 'cap-100u': 'vishay036Rsp' },
  RELAY_CONTACT: 'songleSrd',
  // Seuil de conception : bien au-delà de ce que débitent la pile 9 V, le MB102 et l'USB, aucune fiche ne le donne.
  SHORT_MA: null,
  BOARD: {
    uno: { pin: ['atmega328p', 'arduinoUno'], total: 'atmega328p', five: 'arduinoUno', three: ['arduinoUno', 'lp2985'], vmax: 'atmega328p' },
    nano: { pin: ['atmega328p', 'arduinoNano'], total: 'atmega328p', five: 'usb2', three: 'ft232r', vmax: 'atmega328p' },
    mega: { pin: ['atmega2560', 'arduinoMega'], total: 'atmega2560', five: 'arduinoMega', three: ['arduinoMega', 'lp2985'], vmax: 'atmega2560' },
    // 3V3 des cartes ESP : régulateur AMS1117 de 1 A, dont la puce garde sa part (0,5 A demandés pour l'ESP32).
    esp32: { pin: 'esp32', total: 'esp32', five: 'usb2', three: ['ams1117', 'esp32'], vmax: 'esp32' },
    // ESP32 à 38 broches, ESP32-S3-DevKitC-1, ESP32-C3 SuperMini : le régulateur 3,3 V n'est pas chiffré par leur
    // documentation (et change selon le fabricant) : seuil de conception, celui des autres cartes ESP (300 mA).
    'esp32-38': { pin: 'esp32', total: 'esp32', five: 'usb2', three: null, vmax: 'esp32' },
    esp32s3: { pin: 'esp32s3', total: 'esp32s3', five: 'usb2', three: null, vmax: 'esp32s3' },
    esp32c3: { pin: 'esp32c3', total: 'esp32c3', five: 'usb2', three: null, vmax: 'esp32c3' },
    nodemcu: { pin: 'esp8266', total: 'esp8266', five: 'usb2', three: ['ams1117', 'esp8266'], vmax: 'esp8266' },
    // Wemos D1 mini : même ESP8266 ; son régulateur 3,3 V change selon le fabricant et Wemos n'en publie pas la fiche.
    // Seuil de conception : celui du NodeMCU (300 mA pour les modules).
    d1mini: { pin: 'esp8266', total: 'esp8266', five: 'usb2', three: null, vmax: 'esp8266' },
    pico: { pin: 'rp2040', total: 'rp2040', five: 'usb2', three: 'pico', vmax: 'rp2040' }
  },
  I2C_WIRING_PF: null,
  DERATE_ECAP: null
};
// Seuils des entrées et tirages internes (vih, vil, rpu), courant radio, saturation de l'ADC : fiche de la puce.
for (const [k, chip] of Object.entries({ uno: 'atmega328p', nano: 'atmega328p', mega: 'atmega2560', esp32: 'esp32', 'esp32-38': 'esp32', esp32s3: 'esp32s3', esp32c3: 'esp32c3', nodemcu: 'esp8266', d1mini: 'esp8266', pico: 'rp2040' })) {
  const s = LIMIT_SRC.BOARD[k];
  Object.assign(s, { vih: chip, vil: chip, rpu: chip });
  if (/^atmega/.test(chip)) s.inj = 'avr182';
  if (/^esp/.test(chip)) s.radio = chip;
  if (/^esp32/.test(chip)) s.adc = 'arduinoEsp32Adc';
}
// ESP32 à 38 broches (DevKitC V4) : régulateur AMS1117-3.3 d'après le schéma d'Espressif. 0,94 W au plus dans le SOT-223
// sous 5 − 3,3 V : 550 mA, dont 240 mA pour l'émission Wi-Fi de la puce ; 300 mA laissés aux modules.
LIMIT_SRC.BOARD['esp32-38'].three = ['esp32DevKitC', 'ams1117', 'esp32'];
LIMIT_SRC.BOARD.esp32.three = ['ams1117', 'esp32'];
/** Limites d'une carte (profil importé : celles de sa famille). */
export function boardLimits(c) {
  const p = boardOf(c); if (!p) return null;
  const kind = kindOf(c);
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
  if (/^led-(red|green|blue|yellow|white)$/.test(type)) rows.push([tl('Courant'), both(ledLimit(type), ma)]);
  if (type === 'led-rgb' || type === '7seg') rows.push([tl('Courant par couleur ou segment'), both(ledLimit(type, type === 'led-rgb' ? 'G' : null), ma)]);
  if (/^res-/.test(type)) rows.push([tl('Puissance'), tl('{0} au plus (1/4 W)', w(POWER.res.max))]);
  if (type === 'pot') rows.push([tl('Puissance'), tl('{0} au plus', w(POWER.pot.max))]);
  if (type === 'speaker') rows.push([tl('Puissance'), tl('{0} au plus', w(POWER.speaker.max))]);
  if (NPNS[type]) rows.push([tl('Courant de collecteur'), both(NPNS[type].ic, ma)], [tl('Tension collecteur-émetteur'), `${NPNS[type].vce} V`]);
  if (type === 'diode') rows.push([tl('Courant direct'), tl('{0} au plus', ma(DIODE.max))]);
  if (ZENER_W[type]) rows.push([tl('Puissance dissipée'), both(ZENER_W[type], w)]);
  if (CAP_V[type]) rows.push([tl('Tension de service'), `${CAP_V[type]} V`]);
  if (type === 'relay') rows.push([tl('Contacts'), tl('{0} au plus', ma(RELAY_CONTACT))]);
  if (type === 'l298n') rows.push([tl('Courant par voie'), tl('{0} au plus', ma(L298N_CH.max))]);
  if (type === 'l293d') rows.push([tl('Courant par voie'), tl('{0} au plus', ma(L293D_CH.max))]);
  if (type === 'tb6612') rows.push([tl('Courant par voie'), both(TB6612_CH, ma)]);
  if (STEP_DRV[type]) rows.push([tl('Courant réglé par phase'), tl('{0} sans radiateur, {1} au plus', ma(STEP_DRV[type].warn), ma(STEP_DRV[type].max))]);
  if (STEPPER_I[type]) rows.push([tl('Courant par phase'), tl('{0} nominal', ma(STEPPER_I[type].warn))]);
  if (type === 'lm7805') rows.push([tl('Courant de sortie'), tl('{0} au plus', ma(LM7805.max))]);
  if (type === 'ams1117') rows.push([tl('Courant de sortie'), both(AMS1117, ma)], [tl('Puissance dissipée'), both(AMS1117_W, w)]);
  if (type === 'lm2596') rows.push([tl('Courant de sortie'), tl('{0} sans radiateur, {1} au plus', ma(LM2596.warn), ma(LM2596.max))]);
  if (type === 'mt3608') rows.push([tl('Courant d’entrée'), both(MT3608, ma)]);
  if (type === 'tp4056') rows.push([tl('Entrée IN+'), tl('{0} au plus', `${TP4056.vin} V`)], [tl('Courant de charge'), tl('{0} au plus', ma(TP4056.ichg))]);
  if (type === 'solar6v') rows.push([tl('Tension à vide'), `${String(SOLAR6V.voc).replace('.', DEC)} V`], [tl('Courant au soleil'), ma(SOLAR6V.imp)]);
  if (type === 'buzzer') rows.push([tl('Tension'), tl('{0} conseillés, {1} au plus', `${String(BUZZER_V.warn).replace('.', DEC)} V`, `${BUZZER_V.max} V`)]);
  if (SOURCE[type]) rows.push([tl('Courant débité'), both(SOURCE[type], ma)]);
  if (type === 'ne555') rows.push([tl('Courant de sortie'), both(NE555_OUT, ma)]);
  if (type === 'lm358') rows.push([tl('Tension sur une entrée'), tl('{0} à {1}', `${String(LM358_IN.min).replace('.', DEC)} V`, `${LM358_IN.max} V`)], [tl('Plage de mode commun'), tl('de la masse à VCC − {0}', `${String(LM358_IN.cmr).replace('.', DEC)} V`)]);
  if (type === 'irlz44n') rows.push([tl('Courant de drain'), tl('{0} au plus', ma(IRLZ44N.id.max))], [tl('Tension drain-source'), `${IRLZ44N.vds} V`], [tl('Tension grille-source'), `±${IRLZ44N.vgs} V`], [tl('Puissance dissipée sans radiateur'), both(IRLZ44N_W, w)]);
  if (type === 'irf9540n') rows.push([tl('Courant de drain'), tl('{0} au plus', ma(IRF9540N.id.max))], [tl('Tension drain-source'), `−${IRF9540N.vds} V`], [tl('Tension grille-source'), `±${IRF9540N.vgs} V`], [tl('Puissance dissipée sans radiateur'), both(IRF9540N_W, w)]);
  if (INDUCTOR[type]) rows.push([tl('Courant'), both(INDUCTOR[type], ma)]);
  if (type === 'acs712') rows.push([tl('Plage de mesure'), tl('±5 A, ±20 A ou ±30 A selon la version')], [tl('Courant dans le primaire'), tl('{0} au plus, une impulsion de 100 ms', ma(ACS712_I.max))]);
  if (type === 'max7219m' || type === 'max7219s') rows.push([tl('Courant par segment'), tl('{0} (résistance RSET du module)', ma(MAX7219_I.seg))], [tl('Courant du module'), tl('{0} au plus, toutes LED allumées', ma(MAX7219_I.total))]);
  if (CHIP_I[type]) rows.push([tl('Courant par sortie'), both(CHIP_I[type].out, ma)], [tl('Courant total par VCC'), tl('{0} au plus', ma(CHIP_I[type].vcc.max))], [tl('Courant total par GND'), tl('{0} au plus', ma(CHIP_I[type].gnd.max))]);
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
