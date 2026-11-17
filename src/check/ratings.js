// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Valeurs nominales et maximales de chaque composant de la bibliothèque, par famille (cls), avec leur fiche (src, clés
// de sources.js). Le vérificateur les lit pour ce que limits.js ne chiffre pas déjà : tension tolérée par les entrées
// d'un module (vio), seuil du niveau haut (vih), seuils d'un bus, courant de blocage d'un servo… ; ratings.test.mjs
// exige que chaque composant et chaque carte ait toutes les valeurs de sa famille.
// Un champ à null est une valeur que le fabricant ne publie pas : sa raison est dans gap (jamais une valeur inventée).
// Ces raisons sont de la documentation des données (comme les citations de sources.js) : elles ne s'affichent pas.
// Unités : V, mA, W, Ω, Hz. vcc : [min, max] conseillés ; vabs : maximum absolu de l'alimentation ; vio : tension
// admise sur une broche de signal, { abs } en volts ou { over } au-dessus de l'alimentation du module ; vih : seuil
// du niveau haut, { k } fois l'alimentation ou { v } en volts ; iout : courant d'une sortie (mA) ; fmax : horloge du bus.
import { PARTS, NPNS, ZENERS } from '../sim/parts.js';

/**
 * Champs exigés par famille. Pour 'module' et 'chip', ratings.test.mjs ajoute selon les broches : vio et vih si la carte
 * pilote une de ses entrées, iout si une broche sort vers la carte, fmax s'il est sur un bus (I2C, SPI, série).
 */
export const CLASS_FIELDS = {
  res: ['p', 'vmax'], pot: ['p', 'vmax'], cap: ['v'], ind: ['i', 'isat'],
  led: ['ifRec', 'ifMax', 'vr', 'pd'], diode: ['ifav', 'ifsm', 'vrrm'], zener: ['p', 'vz'],
  bjt: ['ic', 'vceo', 'vebo', 'p', 'betaSat'], mosfet: ['id', 'vds', 'vgs', 'p', 'vgsth', 'rdson', 'vgsOn'],
  chip: ['vcc', 'vabs'], module: ['vcc', 'vabs', 'ma'],
  motor: ['vnom', 'vmax', 'istall'], stepmotor: ['i', 'r'], coil: ['vnom', 'vmax', 'i'], servo: ['vcc', 'i', 'vih'],
  relay: ['vcc', 'icoil', 'contactI', 'contactV', 'vih'], driver: ['vm', 'vcc', 'iout', 'vih'],
  switch: ['i', 'v'], contact: ['i', 'v'], buzzer: ['v', 'i'], speaker: ['p', 'z'],
  battery: ['v', 'imax', 'mah'], psu: ['v', 'imax'], solar: ['voc', 'imp'],
  linreg: ['vin', 'iout', 'pd'], smps: ['vin', 'iout'], charger: ['vin', 'ichg', 'vbat'], shifter: ['lv', 'hv', 'fmax'],
  virtual: []
};

const NO_DS = 'module générique : aucun fabricant ne publie de fiche';
const MODULE_ONLY = 'module : sa carte (régulateur, adaptateur) n’a pas de fiche du fabricant';
const LM393 = { cls: 'module', vcc: [2, 30], vabs: 36, ma: 5, iout: 20, src: 'tiLm393' }; // modules à comparateur LM393
const I2C = 'nxpUm10204'; // iout 3 mA : courant qu'un appareil I2C doit savoir absorber (Standard et Fast mode)
const RES = { cls: 'res', p: 0.25, vmax: 250, src: 'yageoCfr' };
const LEDK = (ifMax, pd, src) => ({ cls: 'led', ifRec: 20, ifMax, vr: 5, pd, src });

export const RATINGS = {
  dht11: { cls: 'module', vcc: [3.3, 5.5], vabs: 5.5, ma: 2.5, vio: { over: 0.3 }, vih: { k: 0.7 }, iout: 10, src: 'aosongDht11' },
  dht22: { cls: 'module', vcc: [3.3, 6], vabs: null, ma: 2.5, vio: null, vih: null, iout: null, src: 'aosongDht22',
    gap: { vabs: 'fiche sans maxima absolus', vio: 'fiche sans maxima absolus', vih: 'seuils donnés en image seulement', iout: 'non publié' } },
  hcsr04: { cls: 'module', vcc: [4.5, 5.5], vabs: null, ma: 15, vio: null, vih: { v: 2.0 }, iout: null, src: 'elecfreaksHcsr04',
    gap: { vabs: 'fiche sans maxima absolus', vio: 'fiche sans maxima absolus', iout: '« TTL level » sans courant' } },
  pir: { cls: 'module', vcc: [4.5, 20], vabs: null, ma: null, iout: null, src: 'rapidHcsr501',
    gap: { vabs: 'fiche sans maxima absolus', ma: 'non publié par le vendeur du module', iout: 'sortie « TTL 3.3V » sans courant' } },
  ldr: LM393, flame: LM393, rain: LM393, irobst: LM393, line: LM393, shock: LM393, sound: LM393,
  soil: { cls: 'module', vcc: [3.3, 5.5], vabs: null, ma: 5, iout: null, src: 'dfrobotSen0193', gap: { vabs: 'fiche sans maxima absolus', iout: 'sortie analogique sans courant publié' } },
  mq2: { cls: 'module', vcc: [4.8, 5.2], vabs: null, ma: 150, iout: 20, src: ['mq2', 'tiLm393'], gap: { vabs: 'fiche sans maxima absolus' } },
  mq135: { cls: 'module', vcc: [4.9, 5.1], vabs: null, ma: 175, iout: 20, src: ['winsenMq135', 'tiLm393'], gap: { vabs: 'fiche sans maxima absolus' } },
  'tilt-sw': { cls: 'switch', i: 20, v: 12, src: 'bailinSw520d' },
  hall: { cls: 'module', vcc: [4.5, 24], vabs: 28, ma: 9, iout: 25, src: 'allegroA3144' },
  water: { cls: 'module', vcc: null, vabs: null, ma: null, iout: null, src: [], gap: { vcc: NO_DS, vabs: NO_DS, ma: NO_DS, iout: NO_DS } },
  lm35: { cls: 'chip', vcc: [4, 30], vabs: null, ma: 0.06, iout: null, src: 'tiLm35', gap: { vabs: 'maxima absolus non relus', iout: 'maxima absolus non relus' } },
  laser: { cls: 'module', vcc: [3.3, 5], vabs: null, ma: 30, vio: null, vih: null, src: 'protosuppliesKy008',
    gap: { vabs: NO_DS, vio: NO_DS, vih: 'S alimente la diode laser : pas un seuil logique' } },
  traffic: { cls: 'module', vcc: null, vabs: null, ma: null, vio: null, vih: null, src: [],
    gap: { vcc: NO_DS, vabs: NO_DS, ma: 'dépend des résistances soudées, non publiées', vio: NO_DS, vih: 'chaque broche alimente une LED : pas un seuil logique' } },
  ds18b20: { cls: 'chip', vcc: [3, 5.5], vabs: 6, ma: 1.5, vio: { abs: 6 }, vih: { v: 2.2 }, iout: 4, src: 'maximDs18b20' },
  bmp280: { cls: 'module', vcc: [1.8, 3.6], vabs: 4.25, ma: 1.12, vio: { over: 0.3 }, vih: { k: 0.8 }, iout: 3, fmax: 3.4e6, i2c: 10000, src: ['boschBmp280', I2C] },
  bme280: { cls: 'module', vcc: [1.71, 3.6], vabs: 4.25, ma: 0.714, vio: { over: 0.3 }, vih: { k: 0.8 }, iout: 3, fmax: 3.4e6, i2c: 10000, src: ['boschBme280', I2C] },
  bh1750: { cls: 'module', vcc: null, vabs: 4.5, ma: 0.19, vio: null, vih: { v: 2.31 }, iout: 3, fmax: 400e3, src: ['rohmBh1750', I2C],
    gap: { vcc: 'module GY-302 : régulateur 3,3 V, plage non publiée', vio: 'maximum des entrées absent de la fiche' } },
  vl53l0x: { cls: 'module', vcc: [2.6, 5.5], vabs: null, ma: 19, vio: { abs: 3.6 }, vih: { v: 1.12 }, iout: 3, fmax: 400e3, i2c: 10000, src: ['stVl53l0x', 'adafruitLevelShifter', I2C], gap: { vabs: MODULE_ONLY } },
  max30102: { cls: 'module', vcc: [3, 5.5], vabs: null, ma: 20, vio: { abs: 6 }, vih: { v: 1.26 }, iout: 6, fmax: 400e3, src: 'maximMax30102', gap: { vabs: MODULE_ONLY } },
  tcs34725: { cls: 'module', vcc: [3, 5.5], vabs: null, ma: 20, vio: { abs: 3.8 }, vih: { v: 2.31 }, iout: 3, fmax: 400e3, i2c: 10000, src: ['amsTcs34725', I2C], gap: { vabs: MODULE_ONLY } },
  ccs811: { cls: 'module', vcc: [1.8, 3.3], vabs: 3.6, ma: 30, vio: { abs: 3.6 }, vih: { v: 2.7 }, iout: 3, fmax: 400e3, i2c: 10000, src: ['sciosenseCcs811', I2C] },
  bme680: { cls: 'module', vcc: [3, 5.5], vabs: null, ma: 12, vio: { abs: 3.6 }, vih: { v: 2.64 }, iout: 3, fmax: 3.4e6, i2c: 10000, src: ['boschBme680', I2C], gap: { vabs: MODULE_ONLY } },
  hx711: { cls: 'module', vcc: [2.6, 5.5], vabs: null, ma: null, vio: null, vih: null, iout: null, src: 'aviaHx711',
    gap: { vabs: 'fiche sans maxima absolus', ma: 'non relu', vio: 'fiche sans maxima absolus', vih: 'fiche sans VIH', iout: 'non publié' } },
  acs712: { cls: 'module', vcc: [4.5, 5.5], vabs: null, ma: 10, iout: null, src: 'allegroAcs712', gap: { vabs: 'maxima absolus non relus', iout: 'non relu' } },
  ttp223: { cls: 'module', vcc: [2, 5.5], vabs: 5.5, ma: null, iout: 8, src: 'tontekTtp223', gap: { ma: 'non relu' } },
  rcwl0516: { cls: 'module', vcc: [4, 28], vabs: null, ma: null, iout: null, src: 'rcwl0516', gap: { vabs: NO_DS, ma: NO_DS, iout: NO_DS } },
  mpu6050: { cls: 'module', vcc: [3.3, 5], vabs: 6, ma: 3.9, vio: { abs: 3.8 }, vih: { v: 2.31 }, iout: 3, fmax: 400e3, src: ['invensenseMpu6050', I2C] },
  button: { cls: 'switch', i: 50, v: 24, src: 'omronB3f' },
  pot: { cls: 'pot', p: 0.08, vmax: 150, src: 'bournsPdb12' },
  joystick: { cls: 'pot', p: 0.01, vmax: 10, src: 'parallaxJoystick' },
  ir: { cls: 'module', vcc: [2.7, 5.5], vabs: 6, ma: 1.5, iout: null, src: 'vs1838b', gap: { iout: 'étage de sortie non décrit' } },
  keypad: { cls: 'switch', i: 30, v: 24, src: 'parallaxKeypad' },
  ky040: { cls: 'switch', i: 10, v: 5, src: 'bournsPec11r' },
  irremote: { cls: 'virtual', src: [], why: 'télécommande sans fil : aucune broche reliée au montage' },
  oled: { cls: 'module', vcc: [3.3, 5], vabs: null, ma: 20, vio: null, vih: { v: 2.64 }, iout: 3, fmax: 400e3, src: ['adafruitOled', 'solomonSsd1306', I2C],
    gap: { vabs: MODULE_ONLY, vio: 'selon le module : adaptateur de niveau ou non' } },
  lcd1602: { cls: 'module', vcc: [4.5, 5.5], vabs: 6.5, ma: 25, vio: { over: 0.5 }, vih: { k: 0.7 }, iout: 25, fmax: 100e3, src: ['newhavenLcd1602', 'tiPcf8574'] },
  lcd2004: { cls: 'module', vcc: [4.7, 5.5], vabs: 6.5, ma: 18, vio: { over: 0.5 }, vih: { k: 0.7 }, iout: 25, fmax: 100e3, src: ['newhavenLcd2004', 'tiPcf8574'] },
  '7seg': { ...LEDK(30, 0.075, 'kingbrightSc56') },
  ws2812: { cls: 'module', vcc: [3.5, 5.3], vabs: 5.3, ma: 480, vio: { over: 0.5 }, vih: { k: 0.7 }, src: ['worldsemiWs2812b', 'adafruitNeopixel'] },
  'led-red': LEDK(30, 0.075, 'kingbrightWp7113id'),
  'led-green': LEDK(25, 0.0625, 'kingbrightWp7113gd'),
  'led-blue': LEDK(30, 0.12, 'kingbrightWp7113qbcd'),
  'led-yellow': LEDK(30, 0.075, 'kingbrightWp7113yd'),
  'led-white': LEDK(30, 0.12, 'kingbrightWp7113qwcd'),
  // RVB à cathode commune : par couleur (rouge 30 mA, vert 25 mA, bleu 30 mA) ; ifMax est le plus faible.
  'led-rgb': { ...LEDK(25, 0.075, 'kingbrightWp154'), ch: { R: 30, G: 25, B: 30 } },
  buzzer: { cls: 'buzzer', v: [4, 7], i: 30, src: 'sameSkyCmi1295' },
  speaker: { cls: 'speaker', p: 0.5, z: 8, src: 'sameSkyCms40558n' },
  relay: { cls: 'relay', vcc: [4.5, 5.5], icoil: 71.4, contactI: 7000, contactV: 28, vih: null, src: 'songleSrd', gap: { vih: 'entrée du module (transistor, optocoupleur) non publiée' } },
  // Courant d'un SG90 : « about 0.5A – 2A » selon le fabricant ; on retient le bas de la fourchette.
  servo: { cls: 'servo', vcc: [4.8, 6], i: 500, vih: null, src: 'towerproSg90', gap: { vih: 'non publié par TowerPro' } },
  dcmotor: { cls: 'motor', vnom: 6, vmax: 9, istall: 200, src: [], design: 'moteur générique : modèle de 6 V et 30 Ω, courant de blocage 6 V ÷ 30 Ω' },
  fan: { cls: 'motor', vnom: 5, vmax: 6, istall: 100, src: [], design: 'ventilateur générique de 5 V : modèle de 50 Ω' },
  pump: { cls: 'motor', vnom: 5, vmax: 6, istall: 200, src: [], design: 'pompe générique : modèle de 5 V et 25 Ω' },
  vibro: { cls: 'motor', vnom: 3, vmax: 3.8, istall: 100, src: 'adafruitVibro1201' },
  stepper: { cls: 'driver', vm: [4.5, 5.5], vcc: [4.5, 5.5], iout: 500, vih: { v: 2.4 }, src: ['kiatronics28byj48', 'tiUln2003a'] },
  l298n: { cls: 'driver', vm: [5, 35], vcc: [4.5, 7], iout: 2000, vih: { v: 2.3 }, vio: { abs: 7 }, src: ['stL298', 'tiUa78m'] },
  l293d: { cls: 'driver', vm: [4.5, 36], vcc: [4.5, 7], iout: 600, vih: { v: 2.3 }, vio: { abs: 7 }, src: 'tiL293d' },
  tb6612: { cls: 'driver', vm: [2.5, 13.5], vcc: [2.7, 5.5], iout: 1200, vih: { k: 0.7 }, vio: { abs: 6 }, src: ['toshibaTb6612', 'pololuTb6612'] },
  nema17: { cls: 'stepmotor', i: 1700, r: 1.5, src: 'nema17hs4401' },
  a4988: { cls: 'driver', vm: [8, 35], vcc: [3, 5.5], iout: 2000, vih: { k: 0.7 }, vio: { abs: 5.5 }, src: ['allegroA4988', 'pololuA4988'] },
  drv8825: { cls: 'driver', vm: [8.2, 45], vcc: null, iout: 2200, vih: { v: 2.2 }, vio: { abs: 7 }, src: ['tiDrv8825', 'pololuDrv8825'], gap: { vcc: 'pas d’alimentation logique : régulateur interne de 3,3 V' } },
  'res-22': RES, 'res-220': RES, 'res-330': RES, 'res-1k': RES, 'res-4k7': RES, 'res-10k': RES,
  'cap-100n': { cls: 'cap', v: 50, src: 'vishayKSeries' },
  'cap-100u': { cls: 'cap', v: 16, electrolytic: true, src: 'vishay036Rsp' },
  diode: { cls: 'diode', ifav: 1000, ifsm: 30000, vrrm: 1000, src: 'vishay1n4007' },
  npn: { cls: 'bjt', ic: NPNS.npn.ic.max, vceo: 45, vebo: 6, p: 0.5, betaSat: 20, src: 'onsemiBc547' },
  pn2222: { cls: 'bjt', ic: 1000, vceo: 40, vebo: 6, p: 0.625, betaSat: 10, src: 'onsemiPn2222a' },
  pnp: { cls: 'bjt', ic: NPNS.pnp.ic.max, vceo: 45, vebo: 5, p: 0.625, betaSat: 20, src: 'onsemiBc557' },
  pn2907: { cls: 'bjt', ic: 800, vceo: 60, vebo: 5, p: 0.625, betaSat: 10, src: 'onsemiPn2907a' },
  ...Object.fromEntries(Object.entries(ZENERS).map(([k, z]) => [k, { cls: 'zener', p: z.p / 1000, vz: z.vz, src: z.src }])),
  lvlshift: { cls: 'shifter', lv: [1.8, 3.6], hv: [3.3, 5.5], fmax: 400e3, src: ['adafruitLevelShifter', 'onsemiBss138', I2C] },
  hc595: { cls: 'chip', vcc: [2, 6], vabs: 7, vio: null, vih: { k: 0.7 }, iout: 35, fmax: 25e6, src: 'tiHc595', gap: { vio: 'TI ne donne que IIK ±20 mA, sans tension maximale d’entrée' } },
  hc165: { cls: 'chip', vcc: [2, 6], vabs: 7, vio: null, vih: { k: 0.7 }, iout: 25, fmax: 25e6, src: ['tiHc165', 'tiHc595'], gap: { vio: 'TI ne donne que IIK ±20 mA, sans tension maximale d’entrée' } },
  mcp23017: { cls: 'chip', vcc: [1.8, 5.5], vabs: 5.5, vio: { over: 0.6 }, vih: { k: 0.8 }, iout: 25, fmax: 1.7e6, src: 'microchipMcp23017' },
  pcf8574: { cls: 'chip', vcc: [2.5, 6], vabs: 6.5, vio: { over: 0.5 }, vih: { k: 0.7 }, iout: 25, fmax: 100e3, src: ['tiPcf8574', 'nxpPcf8574'] },
  pca9685: { cls: 'chip', vcc: [2.3, 5.5], vabs: 6, vio: { abs: 5.5 }, vih: { k: 0.7 }, iout: 25, fmax: 1e6, src: 'nxpPca9685' },
  max7219m: { cls: 'chip', vcc: [4, 5.5], vabs: 6, ma: 160, vio: { abs: 6 }, vih: { v: 3.5 }, iout: 100, fmax: 10e6, src: 'maximMax7219' },
  max7219s: { cls: 'chip', vcc: [4, 5.5], vabs: 6, ma: 160, vio: { abs: 6 }, vih: { v: 3.5 }, iout: 100, fmax: 10e6, src: 'maximMax7219' },
  tm1637: { cls: 'chip', vcc: [4.5, 5.5], vabs: 7, vio: { over: 0.5 }, vih: { k: 0.7 }, iout: 4, fmax: 500e3, src: 'titanTm1637' },
  st7735: { cls: 'module', vcc: [3.3, 5.5], vabs: null, ma: null, vio: { abs: 3.6 }, vih: { v: 2.31 }, iout: null, fmax: 15e6, src: 'sitronixSt7735', gap: { vabs: MODULE_ONLY, ma: 'rétroéclairage du module non publié', iout: 'non relu' } },
  ili9341: { cls: 'module', vcc: [3.3, 5.5], vabs: null, ma: null, vio: { abs: 3.6 }, vih: { v: 2.31 }, iout: 1, fmax: 10e6, src: 'ilitekIli9341', gap: { vabs: MODULE_ONLY, ma: 'courant de fonctionnement absent de la fiche' } },
  ds3231: { cls: 'chip', vcc: [2.3, 5.5], vabs: 6, ma: 0.2, vio: { abs: 6 }, vih: { k: 0.7 }, iout: 3, fmax: 400e3, i2c: 4700, src: 'maximDs3231' },
  ds1307: { cls: 'chip', vcc: [4.5, 5.5], vabs: 7, ma: 1.5, vio: { abs: 7 }, vih: { v: 2.2 }, iout: 5, fmax: 100e3, src: 'maximDs1307' },
  at24c256: { cls: 'chip', vcc: [1.7, 5.5], vabs: 6.25, ma: 3, vio: { abs: 7 }, vih: { k: 0.7 }, iout: 5, fmax: 400e3, src: 'microchipAt24c256' },
  sdcard: { cls: 'module', vcc: [4.5, 5.5], vabs: null, ma: 100, vio: null, vih: null, iout: null, fmax: null, src: 'sdaPhysical',
    gap: { vabs: MODULE_ONLY, vio: MODULE_ONLY, vih: MODULE_ONLY, iout: MODULE_ONLY, fmax: 'spécification SD non relue (licence)' } },
  bat9v: { cls: 'battery', v: 9, imax: null, mah: 560, src: 'energizer522', gap: { imax: 'Energizer ne publie aucun courant maximal' } },
  bat18650: { cls: 'battery', v: 3.63, imax: 5200, mah: 2550, ichg: 2600, src: 'samsungIcr18650' },
  psu24: { cls: 'psu', v: 24, imax: null, src: [], design: 'alimentation de laboratoire générique de 24 V', gap: { imax: 'alimentation de laboratoire générique' } },
  mb102: { cls: 'psu', v: 5, imax: 700, src: ['mb102', 'ams1117'] },
  lm7805: { cls: 'linreg', vin: [7, 35], iout: 1500, pd: 1.3, src: ['stL78', 'onsemiMc7800'] },
  ams1117: { cls: 'linreg', vin: [4.5, 15], iout: 1000, pd: 0.94, src: 'ams1117' },
  lm2596: { cls: 'smps', vin: [4.5, 40], iout: 3000, src: 'onsemiLm2596' },
  mt3608: { cls: 'smps', vin: [2, 24], iout: 4000, src: 'aerosemiMt3608' },
  tp4056: { cls: 'charger', vin: [4, 8], ichg: 1000, vbat: 4.2, src: 'topPowerTp4056' },
  solar6v: { cls: 'solar', voc: 7.7, imp: 180, src: 'adafruitSolar3809' },
  coil24: { cls: 'coil', vnom: 24, vmax: 26.4, i: 125, src: [], design: 'série AirTAC 4V (DC24V ±10 %, 3,0 W) : catalogue non relu' },
  pressostat: { cls: 'switch', i: null, v: null, src: [], gap: { i: NO_DS, v: NO_DS } },
  cylsensor: { cls: 'switch', i: null, v: null, src: [], gap: { i: NO_DS, v: NO_DS } },
  hc05: { cls: 'module', vcc: [3.6, 6], vabs: null, ma: 40, vio: { abs: 3.6 }, vih: null, iout: null, fmax: null, src: ['hc05Zs040', 'hc05Manual'],
    gap: { vabs: MODULE_ONLY, vih: '« TTL/COMS level » sans seuil chiffré', iout: 'non publié', fmax: 'vitesse série réglable, sans maximum publié' } },
  rc522: { cls: 'module', vcc: [3, 3.6], vabs: 4, ma: 26, vio: { over: 0.5 }, vih: { k: 0.7 }, iout: 4, fmax: null, src: 'nxpMfrc522', gap: { fmax: 'horloge SPI non relue' } },
  nrf24: { cls: 'module', vcc: [1.9, 3.6], vabs: 3.6, ma: 14, vio: { abs: 5.25 }, vih: { k: 0.7 }, iout: null, fmax: null, src: 'nordicNrf24', gap: { iout: 'non relu', fmax: 'horloge SPI non relue' } },
  sx1278: { cls: 'module', vcc: [1.8, 3.7], vabs: 3.9, ma: 120, vio: null, vih: { k: 0.8 }, iout: 1, fmax: 10e6, src: 'semtechSx1278', gap: { vio: 'Table 3 sans tension maximale des broches' } },
  sim800: { cls: 'module', vcc: [3.4, 4.4], vabs: 4.5, ma: 500, vio: { abs: 3.1 }, vih: { v: 2.5 }, iout: 8, fmax: null, src: 'simcomSim800l', gap: { fmax: 'vitesse série réglable' } },
  neo6m: { cls: 'module', vcc: [3, 5.5], vabs: null, ma: 47, vio: { abs: 3.6 }, vih: { v: 2.31 }, iout: 10, fmax: 9600, src: 'neo6mUblox', gap: { vabs: MODULE_ONLY } },
  hc12: { cls: 'module', vcc: [3.2, 5.5], vabs: null, ma: 100, vio: null, vih: null, iout: null, fmax: null, src: 'hc12Manual',
    gap: { vabs: 'manuel sans maxima absolus', vio: 'manuel sans maxima absolus', vih: '« 3.3 V TTL » sans seuil chiffré', iout: 'non publié', fmax: 'vitesse série réglable' } },
  max485: { cls: 'module', vcc: [4.75, 5.25], vabs: 12, ma: 0.9, vio: { over: 0.5 }, vih: { v: 2 }, iout: 4, fmax: 2.5e6, src: 'maximMax485' },
  breadboard: { cls: 'contact', i: 2000, v: 36, src: 'busboardBb830' },
  'breadboard-mini': { cls: 'contact', i: 2000, v: 36, src: 'busboardBb830' },
  ne555: { cls: 'chip', vcc: [4.5, 16], vabs: 18, ma: 3, iout: 225, src: 'tiNe555' },
  lm358: { cls: 'chip', vcc: [3, 30], vabs: 32, ma: 0.7, vio: { abs: 32 }, iout: null, src: 'tiLm358', gap: { iout: 'courant de court-circuit typique (40 mA) seulement' } },
  irlz44n: { cls: 'mosfet', id: 47000, vds: 55, vgs: 16, p: 2.18, vgsth: [1, 2], rdson: 0.035, vgsOn: 4, src: 'infineonIrlz44n' },
  irf9540n: { cls: 'mosfet', id: 23000, vds: 100, vgs: 20, p: 2.18, vgsth: [2, 4], rdson: 0.117, vgsOn: 10, src: 'infineonIrf9540n' },
  'ind-10m': { cls: 'ind', i: 76, isat: 110, src: 'bourns5800' },
  siggen: { cls: 'virtual', src: [], why: 'instrument idéal de la simulation (sortie 50 Ω)' },
  scope: { cls: 'virtual', src: [], why: 'instrument de mesure idéal : il ne prend aucun courant' }
};

/** Valeurs d'un composant (type de la bibliothèque), ou null. */
export const ratingsOf = type => RATINGS[type] || null;
/** Tension maximale admise sur une broche de signal d'un composant alimenté sous vs (V), ou null. */
export function vioMax(r, vs) {
  if (!r || !r.vio) return null;
  return r.vio.abs != null ? r.vio.abs : vs != null ? vs + r.vio.over : null;
}
/** Seuil du niveau haut d'une entrée sous vs (V), ou null. */
export function vihOf(r, vs) {
  if (!r || !r.vih) return null;
  return r.vih.v != null ? r.vih.v : vs != null ? r.vih.k * vs : null;
}
export { PARTS };
