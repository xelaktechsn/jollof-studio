// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Profils électriques des cartes : tensions, masses et capacités de chaque broche.
// La simulation s'en sert pour savoir qui lit quoi, le câblage automatique pour
// choisir une broche adaptée (ADC, I2C, PWM...) en évitant les broches délicates.
import { tl, DEC } from '../i18n/index.js';

export const base = k => k.replace(/ \(\d+\)$/, '');
/** Broche de masse d'une carte (une carte importée peut nommer sa masse G ou VSS). */
export const isGnd = (prof, b) => (prof.gnds ? prof.gnds.includes(b) : b === 'GND' || b === 'AGND');
/** Profil électrique d'une carte : celui de la bibliothèque, ou celui d'une carte importée (c.prof). */
export const boardOf = c => (c && (c.prof || BOARDS[c.type])) || null;
const FAMILY_KIND = { atmega328p: 'uno', esp8266: 'nodemcu', rp2040: 'pico', esp32s3: 'esp32s3', esp32c3: 'esp32c3' };
/**
 * Famille de code d'une carte (uno, nano, mega, esp32, esp32s3, esp32c3, nodemcu ou pico) : constantes, bibliothèques,
 * interpréteur et vérificateur s'en servent. Le Wemos D1 mini se programme comme le NodeMCU, l'ESP32 à 38 broches comme
 * l'ESP32 ; une carte importée, comme sa famille.
 */
export const kindOf = c => { const p = boardOf(c); return (p && p.kind) || (BOARDS[c.type] ? c.type : FAMILY_KIND[p && p.family] || 'esp32'); };
export const volts = v => `${String(Math.round(v * 10) / 10).replace('.', DEC)} V`;

/** Capacités demandées à une broche de la carte selon le besoin du composant. */
export const NEED_CAPS = {
  io: ['in', 'out'], in: ['in'], out: ['out'], pullup: ['in', 'pu'], pwm: ['out', 'pwm'], adc: ['adc'], irq: ['in', 'irq'],
  sda: ['in', 'out'], scl: ['in', 'out'], sck: ['out'], mosi: ['out'], miso: ['in'], ss: ['out'], rx: ['out'], tx: ['in']
};
export const CAP_WORDS = { in: tl('entrée'), out: tl('sortie'), pu: tl('résistance de tirage interne'), pwm: 'PWM', adc: tl('entrée analogique (ADC)'), irq: tl('interruption externe') };

const pins = list => Object.fromEntries(list.map(([k, n, caps, note]) => [k, { n, caps: new Set(caps.split(' ')), note }]));
const range = (pre, a, b) => Array.from({ length: b - a + 1 }, (_, i) => pre + (a + i));

const ESP_BOOT = tl('broche de démarrage (strapping) : son niveau au démarrage choisit le mode de boot, à garder en dernier recours');
const ESP_IN = tl('entrée seulement, sans résistance de tirage interne');
const AVR_PWM = [3, 5, 6, 9, 10, 11];
const avrDigital = (n, note) => [`D${n}`, n, `in out pu${AVR_PWM.includes(n) ? ' pwm' : ''}`, note];
// Mega 2560 : PWM sur D2 à D13 et D44 à D46 ; trois ports série matériels en plus de celui de l'USB.
const MEGA_PWM = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46];
const IRQ = tl('interruption externe');
const MEGA_NOTES = {
  2: IRQ, 3: IRQ, 13: tl('reliée à la LED « L » de la carte'),
  14: tl('TX3 du port série Serial3'), 15: tl('RX3 du port série Serial3'), 16: tl('TX2 du port série Serial2'), 17: tl('RX2 du port série Serial2'),
  18: `${tl('TX1 du port série Serial1')} ; ${IRQ}`, 19: `${tl('RX1 du port série Serial1')} ; ${IRQ}`,
  20: `${tl('SDA du bus I2C')} ; ${IRQ}`, 21: `${tl('SCL du bus I2C')} ; ${IRQ}`,
  50: tl('MISO du bus SPI'), 51: tl('MOSI du bus SPI'), 52: tl('SCK du bus SPI'), 53: tl('SS du bus SPI : à garder en sortie pour que le SPI reste maître')
};
const megaDigital = n => [`D${n}`, n, `in out pu${MEGA_PWM.includes(n) ? ' pwm' : ''}`, MEGA_NOTES[n]];
/** Broches de l'ESP8266 sorties sur le NodeMCU comme sur le Wemos D1 mini (mêmes noms D0 à D8). */
const ESP8266_PINS = [
  ['D0', 16, 'in out', tl('GPIO 16 : ni PWM, ni interruption, ni tirage interne vers le haut')],
  ['D1', 5, 'in out pu pwm'], ['D2', 4, 'in out pu pwm'],
  ['D3', 0, 'in out pu pwm', tl('broche de démarrage tirée au niveau haut : elle ne doit pas être à la masse au démarrage')],
  ['D4', 2, 'in out pu pwm', tl('reliée à la LED de la carte ; broche de démarrage tirée au niveau haut')],
  ['D5', 14, 'in out pu pwm'], ['D6', 12, 'in out pu pwm'], ['D7', 13, 'in out pu pwm'],
  ['D8', 15, 'in out pwm', tl('broche de démarrage tirée au niveau bas')],
  ['A0', 'A0', 'adc', tl('seule entrée analogique, 0 à 3,3 V sur cette carte')],
  ['RX', 3, 'in out uart0', tl('RX du port série USB')], ['TX', 1, 'in out uart0', tl('TX du port série USB')]
];

export const BOARDS = {
  esp32: {
    label: 'ESP32', logic: 3.3, adcBits: 12, vref: 3.3, fixedBus: false,
    power: { '3V3': 3.3, VIN: 5 }, diode: ['VIN'], three: '3V3', five: 'VIN', vin: { pin: 'VIN', min: 5, max: 12 },
    gpio: pins([
      ['VP', 36, 'in adc', ESP_IN], ['VN', 39, 'in adc', ESP_IN], ['D34', 34, 'in adc', ESP_IN], ['D35', 35, 'in adc', ESP_IN],
      ['D32', 32, 'in out pu pwm adc'], ['D33', 33, 'in out pu pwm adc'],
      ['D25', 25, 'in out pu pwm'], ['D26', 26, 'in out pu pwm'], ['D27', 27, 'in out pu pwm'], ['D14', 14, 'in out pu pwm'],
      ['D12', 12, 'in out pu pwm', tl('broche de démarrage : tirée au niveau haut au démarrage, elle empêche l’ESP32 de démarrer')],
      ['D13', 13, 'in out pu pwm'], ['D23', 23, 'in out pu pwm'], ['D22', 22, 'in out pu pwm'], ['D21', 21, 'in out pu pwm'],
      ['D19', 19, 'in out pu pwm'], ['D18', 18, 'in out pu pwm'], ['D5', 5, 'in out pu pwm', ESP_BOOT],
      ['TX2', 17, 'in out pu pwm'], ['RX2', 16, 'in out pu pwm'], ['D4', 4, 'in out pu pwm'],
      ['D2', 2, 'in out pu pwm', tl('reliée à la LED bleue de la carte ; broche de démarrage')], ['D15', 15, 'in out pu pwm', ESP_BOOT],
      ['TX0', 1, 'in out uart0', tl('TX du port série USB')], ['RX0', 3, 'in out uart0', tl('RX du port série USB')]
    ]),
    order: ['D4', 'D13', 'D14', 'D27', 'D26', 'D25', 'D33', 'D32', 'RX2', 'TX2', 'D19', 'D18', 'D23', 'D5', 'D15', 'D2', 'D21', 'D22', 'D12', 'D34', 'D35', 'VP', 'VN'],
    adcOrder: ['D34', 'D35', 'D32', 'D33', 'VP', 'VN'],
    // pins : le port série reçoit ses broches dans begin() (Serial2.begin(9600, SERIAL_8N1, 16, 17)), quelle que soit la
    // version du cœur arduino-esp32 (ses broches par défaut ont changé en 3.0).
    i2c: { sda: 'D21', scl: 'D22' }, spi: { sck: 'D18', miso: 'D19', mosi: 'D23', ss: 'D5' }, uart: { rx: 'RX2', tx: 'TX2', port: 'Serial2', pins: true },
    // Broches lues au démarrage : niveau qu'elles doivent avoir (D12 haut : flash à 1,8 V, la carte ne démarre pas ;
    // D2 haut : le téléversement ne passe plus en mode programmation).
    strap: { D12: 0, D2: 0 },
    adcNote: tl('elle appartient à l’ADC1, qui reste utilisable quand le Wi-Fi est actif (l’ADC2 ne l’est pas).'),
    tips: [tl('À éviter : D12, D2, D5 et D15 (broches de démarrage), TX0 et RX0 (port série USB). D34, D35, VP et VN sont des entrées seulement.'),
      tl('VIN fournit le 5 V de l’USB : pratique pour les modules qui exigent 5 V, mais leurs signaux de sortie doivent rester à 3,3 V.')],
    code: (k, g) => String(g.n), gpioName: (k, g) => `GPIO ${g.n}`
  },
  'esp32-38': {
    // ESP32-DevKitC V4 et NodeMCU-32S : le même ESP32-WROOM-32 que la DevKit V1, sur 2 × 19 broches marquées IO0, IO2…
    label: tl('ESP32 38 broches'), kind: 'esp32', logic: 3.3, adcBits: 12, vref: 3.3, fixedBus: false,
    power: { '3V3': 3.3, '5V': 5 }, diode: ['5V'], three: '3V3', five: '5V', vin: { pin: '5V', min: 4.5, max: 5.5 },
    gpio: pins([
      ['VP', 36, 'in adc', ESP_IN], ['VN', 39, 'in adc', ESP_IN], ['IO34', 34, 'in adc', ESP_IN], ['IO35', 35, 'in adc', ESP_IN],
      ['IO32', 32, 'in out pu pwm adc'], ['IO33', 33, 'in out pu pwm adc'],
      ...[25, 26, 27, 14, 13, 23, 22, 21, 19, 18, 17, 16, 4].map(n => [`IO${n}`, n, 'in out pu pwm']),
      ['IO12', 12, 'in out pu pwm', tl('broche de démarrage : tirée au niveau haut au démarrage, elle empêche l’ESP32 de démarrer')],
      ['IO5', 5, 'in out pu pwm', ESP_BOOT], ['IO15', 15, 'in out pu pwm', ESP_BOOT],
      ['IO0', 0, 'in out pu pwm', tl('reliée au bouton BOOT ; broche de démarrage : un niveau bas au démarrage bloque la carte en mode téléversement')],
      ['IO2', 2, 'in out pu pwm', tl('broche de démarrage ; reliée à la LED bleue sur la NodeMCU-32S')],
      ['TX', 1, 'in out uart0', tl('TX du port série USB')], ['RX', 3, 'in out uart0', tl('RX du port série USB')],
      ...['SD0', 'SD1', 'SD2', 'SD3', 'CMD', 'CLK'].map(k => [k, k, 'flash', tl('reliée à la mémoire flash : à ne jamais utiliser')])
    ]),
    order: ['IO4', 'IO13', 'IO14', 'IO27', 'IO26', 'IO25', 'IO33', 'IO32', 'IO16', 'IO17', 'IO19', 'IO18', 'IO23', 'IO5', 'IO15', 'IO2', 'IO21', 'IO22', 'IO12', 'IO0', 'IO34', 'IO35', 'VP', 'VN'],
    adcOrder: ['IO34', 'IO35', 'IO32', 'IO33', 'VP', 'VN'],
    i2c: { sda: 'IO21', scl: 'IO22' }, spi: { sck: 'IO18', miso: 'IO19', mosi: 'IO23', ss: 'IO5' }, uart: { rx: 'IO16', tx: 'IO17', port: 'Serial2', pins: true },
    strap: { IO12: 0, IO2: 0, IO0: 1 },
    adcNote: tl('elle appartient à l’ADC1, qui reste utilisable quand le Wi-Fi est actif (l’ADC2 ne l’est pas).'),
    tips: [tl('À éviter : IO12, IO0, IO2, IO5 et IO15 (broches de démarrage), TX et RX (port série USB), SD0 à SD3, CMD et CLK (mémoire flash). IO34, IO35, VP et VN sont des entrées seulement.'),
      tl('Carte large : sur une breadboard de 400 points, elle ne laisse qu’une rangée libre d’un côté.')],
    code: (k, g) => String(g.n), gpioName: (k, g) => (typeof g.n === 'number' && !/^IO/.test(k) ? `GPIO ${g.n}` : '')
  },
  esp32s3: {
    // ESP32-S3-DevKitC-1 : broches et rôles d'après le guide d'Espressif (v1.1) et la fiche de l'ESP32-S3.
    label: 'ESP32-S3', logic: 3.3, adcBits: 12, vref: 3.3, fixedBus: false,
    power: { '3V3': 3.3, '5V': 5 }, diode: ['5V'], three: '3V3', five: '5V', vin: { pin: '5V', min: 4.5, max: 5.5 },
    gpio: pins([
      ...range('IO', 1, 10).map(k => [k, +k.slice(2), 'in out pu pwm adc', k === 'IO3' ? tl('broche de démarrage : à garder en dernier recours') : undefined]),
      ...[11, 12, 13, 14, 15, 16, 17, 18, 21, 39, 40, 41, 42, 47].map(n => [`IO${n}`, n, 'in out pu pwm']),
      ['IO0', 0, 'in out pu pwm', tl('reliée au bouton BOOT ; broche de démarrage : un niveau bas au démarrage bloque la carte en mode téléversement')],
      ['IO45', 45, 'in out pu pwm', tl('broche de démarrage : choisit la tension de la mémoire flash, elle doit rester au niveau bas au démarrage')],
      ['IO46', 46, 'in out pu pwm', tl('broche de démarrage (mode de téléversement) : à garder en dernier recours')],
      ['IO19', 19, 'in out pu pwm', tl('USB D− de l’USB natif (prise « USB ») : à éviter si cette prise sert')],
      ['IO20', 20, 'in out pu pwm', tl('USB D+ de l’USB natif (prise « USB ») : à éviter si cette prise sert')],
      ...[35, 36, 37].map(n => [`IO${n}`, n, 'in out pu pwm', tl('utilisée par la PSRAM octale des modules N8R8 et N16R8 : à éviter')]),
      ['IO38', 38, 'in out pu pwm', tl('reliée à la LED RVB de la carte (version 1.1)')],
      ['IO48', 48, 'in out pu pwm', tl('reliée à la LED RVB sur les premières cartes (version 1.0)')],
      ['TX', 43, 'in out uart0', tl('TX du port série USB')], ['RX', 44, 'in out uart0', tl('RX du port série USB')]
    ]),
    // IO3 : broche de démarrage (source du JTAG), gardée pour la fin ; IO19/IO20, IO35-37 et IO46 ne sont jamais choisies.
    order: ['IO15', 'IO16', 'IO17', 'IO18', 'IO21', 'IO47', 'IO14', 'IO13', 'IO12', 'IO11', 'IO42', 'IO41', 'IO40', 'IO39', 'IO10', 'IO9', 'IO8', 'IO7', 'IO6', 'IO5', 'IO4', 'IO2', 'IO1', 'IO38', 'IO48', 'IO3', 'IO45', 'IO0'],
    adcOrder: ['IO1', 'IO2', 'IO4', 'IO5', 'IO6', 'IO7', 'IO10', 'IO3', 'IO8', 'IO9'],
    i2c: { sda: 'IO8', scl: 'IO9' }, spi: { sck: 'IO12', miso: 'IO13', mosi: 'IO11', ss: 'IO10' }, uart: { rx: 'IO15', tx: 'IO16', port: 'Serial1', pins: true },
    strap: { IO0: 1, IO45: 0 },
    adcNote: tl('elle appartient à l’ADC1 (GPIO 1 à 10), qui reste utilisable quand le Wi-Fi est actif.'),
    tips: [tl('À éviter : IO0, IO3, IO45 et IO46 (démarrage), IO19 et IO20 (USB natif), IO35 à IO37 (PSRAM des modules N8R8), TX et RX (port série USB). Entrées analogiques utilisables avec le Wi-Fi : IO1 à IO10.'),
      tl('Deux prises USB : « UART » (puce USB-série : téléversement et moniteur série) et « USB » (USB natif de l’ESP32-S3).')],
    code: (k, g) => String(g.n), gpioName: (k, g) => (/^IO/.test(k) ? '' : `GPIO ${g.n}`)
  },
  esp32c3: {
    // ESP32-C3 SuperMini : 2 × 8 broches. Le moniteur série passe par l'USB natif de la puce (USB CDC au démarrage).
    label: 'ESP32-C3', logic: 3.3, adcBits: 12, vref: 3.3, fixedBus: false,
    power: { '3V3': 3.3, '5V': 5 }, diode: ['5V'], three: '3V3', five: '5V', vin: { pin: '5V', min: 4.5, max: 5.5 },
    gpio: pins([
      ...['IO0', 'IO1', 'IO3', 'IO4'].map(k => [k, +k.slice(2), 'in out pu pwm adc']),
      ['IO2', 2, 'in out pu pwm adc', tl('broche de démarrage : à garder en dernier recours')],
      ...[5, 6, 7, 10].map(n => [`IO${n}`, n, 'in out pu pwm']),
      ['IO8', 8, 'in out pu pwm', tl('reliée à la LED bleue de la carte ; broche de démarrage : elle doit être au niveau haut pour téléverser')],
      ['IO9', 9, 'in out pu pwm', tl('reliée au bouton BOOT ; broche de démarrage : un niveau bas au démarrage bloque la carte en mode téléversement')],
      ['IO20', 20, 'in out pu pwm', tl('RX de l’UART0 : libre pour un module série (Serial1), le moniteur série passant par l’USB')],
      ['IO21', 21, 'in out pu pwm', tl('TX de l’UART0 : la carte y écrit quelques lignes au démarrage')]
    ]),
    order: ['IO5', 'IO6', 'IO7', 'IO10', 'IO4', 'IO3', 'IO1', 'IO0', 'IO20', 'IO21', 'IO2', 'IO8', 'IO9'],
    adcOrder: ['IO0', 'IO1', 'IO3', 'IO4', 'IO2'],
    i2c: { sda: 'IO8', scl: 'IO9' }, spi: { sck: 'IO4', miso: 'IO5', mosi: 'IO6', ss: 'IO7' }, uart: { rx: 'IO20', tx: 'IO21', port: 'Serial1', pins: true },
    strap: { IO9: 1, IO8: 1 },
    adcNote: tl('elle appartient à l’ADC1 (GPIO 0 à 4).'),
    tips: [tl('Entrées analogiques : IO0 à IO4. À éviter : IO2, IO8 et IO9 (démarrage ; IO8 porte la LED, IO9 le bouton BOOT).'),
      tl('Le moniteur série passe par l’USB natif : Serial ne touche aucune broche. IO20 et IO21 restent libres pour un module série (Serial1).')],
    code: (k, g) => String(g.n), gpioName: () => ''
  },
  nodemcu: {
    label: 'NodeMCU', logic: 3.3, adcBits: 10, vref: 3.3, fixedBus: false,
    power: { '3V3': 3.3, VIN: 5 }, diode: ['VIN'], three: '3V3', five: 'VIN', vin: { pin: 'VIN', min: 4.5, max: 10 },
    gpio: pins([
      ...ESP8266_PINS,
      ...['SD0', 'SD1', 'SD2', 'SD3', 'CMD', 'CLK'].map(k => [k, k, 'flash', tl('reliée à la mémoire flash : à ne jamais utiliser')])
    ]),
    order: ['D5', 'D6', 'D7', 'D1', 'D2', 'D0', 'D3', 'D4', 'D8'],
    adcOrder: ['A0'],
    i2c: { sda: 'D2', scl: 'D1' }, spi: { sck: 'D5', miso: 'D6', mosi: 'D7', ss: 'D8' }, uart: null,
    // GPIO0 (D3) et GPIO2 (D4) hauts, GPIO15 (D8) bas au démarrage, sinon l'ESP8266 ne lance pas le programme.
    strap: { D3: 1, D4: 1, D8: 0 },
    adcNote: tl('c’est la seule entrée analogique de l’ESP8266.'),
    tips: [tl('Une seule entrée analogique (A0). D3, D4 et D8 sont des broches de démarrage, D0 n’a ni PWM ni tirage vers le haut.')],
    code: k => k, gpioName: (k, g) => (typeof g.n === 'number' ? `GPIO ${g.n}` : '')
  },
  d1mini: {
    // Même ESP8266 que le NodeMCU, mêmes noms de broches : il se programme comme lui (kind), sans les broches de la flash.
    label: 'Wemos D1 mini', kind: 'nodemcu', logic: 3.3, adcBits: 10, vref: 3.3, fixedBus: false,
    power: { '3V3': 3.3, '5V': 5 }, diode: ['5V'], three: '3V3', five: '5V', vin: { pin: '5V', min: 4.5, max: 6 },
    gpio: pins(ESP8266_PINS),
    order: ['D5', 'D6', 'D7', 'D1', 'D2', 'D0', 'D3', 'D4', 'D8'],
    adcOrder: ['A0'],
    i2c: { sda: 'D2', scl: 'D1' }, spi: { sck: 'D5', miso: 'D6', mosi: 'D7', ss: 'D8' }, uart: null,
    strap: { D3: 1, D4: 1, D8: 0 },
    adcNote: tl('c’est la seule entrée analogique de l’ESP8266.'),
    tips: [tl('Une seule entrée analogique (A0). D3, D4 et D8 sont des broches de démarrage, D0 n’a ni PWM ni tirage vers le haut.'),
      tl('La broche 5V donne le 5 V de l’USB ; on peut aussi alimenter la carte par elle (5 V, 6 V au plus).')],
    code: k => k, gpioName: (k, g) => (typeof g.n === 'number' ? `GPIO ${g.n}` : '')
  },
  uno: {
    label: tl('Arduino Uno'), logic: 5, adcBits: 10, vref: 5, fixedBus: true,
    power: { '5V': 5, '3V3': 3.3 }, diode: [], three: '3V3', five: '5V', vin: { pin: 'VIN', min: 7, max: 12 },
    gpio: pins([
      ['D0', 0, 'in out uart0', tl('RX du port série USB')], ['D1', 1, 'in out uart0', tl('TX du port série USB')],
      avrDigital(2, tl('interruption externe INT0')), avrDigital(3, tl('interruption externe INT1')),
      ...[4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => avrDigital(n)), avrDigital(13, tl('reliée à la LED « L » de la carte')),
      ...[0, 1, 2, 3].map(i => [`A${i}`, `A${i}`, 'in out pu adc']),
      ['A4', 'A4', 'in out pu adc', tl('SDA du bus I2C')], ['A5', 'A5', 'in out pu adc', tl('SCL du bus I2C')],
      ['SDA', 'A4', 'in out pu', tl('même broche que A4')], ['SCL', 'A5', 'in out pu', tl('même broche que A5')]
    ]),
    alias: [['SDA', 'A4'], ['SCL', 'A5']],
    order: ['D2', 'D4', 'D7', 'D8', 'D3', 'D5', 'D6', 'D9', 'D12', 'D13', 'D10', 'D11', 'A0', 'A1', 'A2', 'A3'],
    adcOrder: ['A0', 'A1', 'A2', 'A3'],
    i2c: { sda: 'SDA', scl: 'SCL' }, spi: { sck: 'D13', miso: 'D12', mosi: 'D11', ss: 'D10' }, uart: null,
    adcNote: '', tips: [tl('D0 et D1 servent au téléversement par USB. Le bus I2C matériel est sur SDA/SCL (A4/A5), le SPI sur D10 à D13.'),
      tl('Logique 5 V : les modules prévus pour 3,3 V seulement demandent un adaptateur de niveau.')],
    code: (k, g) => String(g.n), gpioName: () => ''
  },
  nano: {
    label: tl('Arduino Nano'), logic: 5, adcBits: 10, vref: 5, fixedBus: true,
    power: { '5V': 5, '3V3': 3.3 }, diode: [], three: '3V3', five: '5V', vin: { pin: 'VIN', min: 7, max: 12 },
    gpio: pins([
      ['RX0', 0, 'in out uart0', tl('RX du port série USB')], ['TX1', 1, 'in out uart0', tl('TX du port série USB')],
      avrDigital(2, tl('interruption externe INT0')), avrDigital(3, tl('interruption externe INT1')),
      ...[4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => avrDigital(n)), avrDigital(13, tl('reliée à la LED « L » de la carte')),
      ...[0, 1, 2, 3].map(i => [`A${i}`, `A${i}`, 'in out pu adc']),
      ['A4', 'A4', 'in out pu adc', tl('SDA du bus I2C')], ['A5', 'A5', 'in out pu adc', tl('SCL du bus I2C')],
      ['A6', 'A6', 'adc', tl('entrée analogique seulement')], ['A7', 'A7', 'adc', tl('entrée analogique seulement')]
    ]),
    order: ['D2', 'D4', 'D7', 'D8', 'D3', 'D5', 'D6', 'D9', 'D12', 'D13', 'D10', 'D11', 'A0', 'A1', 'A2', 'A3'],
    adcOrder: ['A0', 'A1', 'A2', 'A3', 'A6', 'A7'],
    i2c: { sda: 'A4', scl: 'A5' }, spi: { sck: 'D13', miso: 'D12', mosi: 'D11', ss: 'D10' }, uart: null,
    adcNote: '', tips: [tl('Le bus I2C est sur A4 (SDA) et A5 (SCL), le SPI sur D10 à D13. A6 et A7 sont des entrées analogiques seulement.')],
    code: (k, g) => String(g.n), gpioName: () => ''
  },
  mega: {
    label: tl('Arduino Mega 2560'), logic: 5, adcBits: 10, vref: 5, fixedBus: true,
    power: { '5V': 5, '3V3': 3.3 }, diode: [], three: '3V3', five: '5V', vin: { pin: 'VIN', min: 7, max: 12 },
    gpio: pins([
      ['D0', 0, 'in out uart0', tl('RX du port série USB')], ['D1', 1, 'in out uart0', tl('TX du port série USB')],
      ...range('', 2, 53).map(n => megaDigital(+n)),
      ...range('A', 0, 15).map(k => [k, k, 'in out pu adc']),
      ['SDA', 20, 'in out pu', tl('même broche que D20')], ['SCL', 21, 'in out pu', tl('même broche que D21')]
    ]),
    alias: [['SDA', 'D20'], ['SCL', 'D21']],
    // D2 à D12 d'abord (comme sur l'Uno), puis la double rangée D22 à D49 ; ports série, LED et SPI en dernier.
    order: ['D2', 'D4', 'D7', 'D8', 'D3', 'D5', 'D6', 'D9', 'D12', ...range('D', 22, 43), 'D47', 'D48', 'D49', 'D44', 'D45', 'D46',
      'D13', 'D10', 'D11', 'D14', 'D15', 'D16', 'D17', 'D18', 'D19', 'D53', 'D52', 'D51', 'D50', ...range('A', 0, 15)],
    adcOrder: range('A', 0, 15),
    i2c: { sda: 'D20', scl: 'D21' }, spi: { sck: 'D52', miso: 'D50', mosi: 'D51', ss: 'D53' }, uart: { rx: 'D19', tx: 'D18', port: 'Serial1' },
    adcNote: '', tips: [tl('D0 et D1 servent au téléversement par USB. I2C sur D20 (SDA) et D21 (SCL), SPI sur D50 à D53, ports série Serial1 à Serial3 sur D14 à D19.'),
      tl('Logique 5 V : les modules prévus pour 3,3 V seulement demandent un adaptateur de niveau.')],
    code: (k, g) => String(g.n), gpioName: () => ''
  },
  pico: {
    // ADC 12 bits, mais analogRead() rend 10 bits par défaut dans le cœur arduino-pico (adcRead).
    label: tl('Pico'), logic: 3.3, adcBits: 12, adcRead: 10, vref: 3.3, fixedBus: false,
    power: { '3V3': 3.3, VBUS: 5, VSYS: 4.7 }, diode: ['VSYS'], three: '3V3', five: 'VBUS', vin: { pin: 'VSYS', min: 1.8, max: 5.5 },
    gpio: pins([
      ...range('GP', 0, 22).map(k => [k, +k.slice(2), 'in out pu pwm']),
      ...range('GP', 26, 28).map(k => [k, +k.slice(2), 'in out pu pwm adc'])
    ]),
    order: [...range('GP', 2, 3), ...range('GP', 6, 15), 'GP20', 'GP21', 'GP22', ...range('GP', 16, 19), 'GP0', 'GP1', 'GP4', 'GP5'],
    adcOrder: ['GP26', 'GP27', 'GP28'],
    i2c: { sda: 'GP4', scl: 'GP5' }, spi: { sck: 'GP18', miso: 'GP16', mosi: 'GP19', ss: 'GP17' }, uart: { rx: 'GP1', tx: 'GP0', port: 'Serial1' },
    adcNote: tl('seules GP26 à GP28 sont reliées à l’ADC.'),
    tips: [tl('3V3 sort 3,3 V, VBUS le 5 V de l’USB. Entrées analogiques : GP26 à GP28. Aucune broche n’accepte 5 V.')],
    code: (k, g) => String(g.n), gpioName: () => ''
  }
};

/**
 * Broches à interruption externe (attachInterrupt) : seulement certaines sur les AVR (Uno, Nano : D2 et D3 ; Mega :
 * D2, D3, D18 à D21), toutes les entrées ailleurs, sauf GPIO 16 de l'ESP8266.
 */
export const AVR_IRQ = { uno: [2, 3], nano: [2, 3], mega: [2, 3, 18, 19, 20, 21] };
for (const [type, prof] of Object.entries(BOARDS)) {
  const kind = prof.kind || type, avr = AVR_IRQ[kind];
  for (const g of Object.values(prof.gpio)) if (g.caps.has('in') && (avr ? avr.includes(g.n) : !(kind === 'nodemcu' && g.n === 16))) g.caps.add('irq');
}

/** Autres sources d'énergie : tension par broche, 0 pour la masse. */
// Générateur de fonctions : sa masse est une référence (sa sortie varie, elle n'est pas une source fixe).
export const SOURCES = { bat9v: { '+': 9, '-': 0 }, psu24: { '+': 24, '-': 0 }, bat18650: { '+': 3.7, '-': 0 }, mb102: { '+5V': 5, '+3V3': 3.3, GND: 0 }, siggen: { GND: 0 } };
/** Régulateurs : la sortie existe si l'entrée reçoit assez de tension. */
export const DERIVED = { lm7805: { from: 'IN', out: 'OUT', v: 5, min: 7 }, l298n: { from: '+12V', out: '+5V', v: 5, min: 7 } };

/** Nom lisible d'une broche de carte : « ESP32 D13 (GPIO 13) ». */
export function pinName(ref) {
  const prof = boardOf(ref.comp), g = prof && prof.gpio[base(ref.key)];
  const extra = g ? prof.gpioName(ref.key, g) : '';
  return `${ref.comp.name} ${ref.key}${extra ? ` (${extra})` : ''}`;
}
/** Nom à écrire dans le code Arduino pour cette broche. */
export function codePin(ref) {
  const prof = boardOf(ref.comp), g = prof && prof.gpio[base(ref.key)];
  return g ? prof.code(base(ref.key), g) : ref.key;
}
/** Plage de tension acceptée : [min, max], ou la tension logique de la carte. */
export function vrange(v, prof) { return v === 'logic' ? [1.8, prof ? prof.logic : 5.5] : v; }
/** Choisit l'alimentation de la carte qui convient au module, tension logique d'abord. */
export function pickPower(v, prof) {
  const [lo, hi] = vrange(v, prof);
  const opts = prof.logic > 4 ? [[5, prof.five], [3.3, prof.three]] : [[3.3, prof.three], [5, prof.five]];
  const fit = opts.find(([x, name]) => name && x >= lo - 0.05 && x <= hi + 0.05);
  return fit ? { v: fit[0], name: fit[1] } : null;
}
