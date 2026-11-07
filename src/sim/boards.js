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
export const volts = v => `${String(Math.round(v * 10) / 10).replace('.', DEC)} V`;

/** Capacités demandées à une broche de la carte selon le besoin du composant. */
export const NEED_CAPS = {
  io: ['in', 'out'], in: ['in'], out: ['out'], pullup: ['in', 'pu'], pwm: ['out', 'pwm'], adc: ['adc'],
  sda: ['in', 'out'], scl: ['in', 'out'], sck: ['out'], mosi: ['out'], miso: ['in'], ss: ['out'], rx: ['out'], tx: ['in']
};
export const CAP_WORDS = { in: tl('entrée'), out: tl('sortie'), pu: tl('résistance de tirage interne'), pwm: 'PWM', adc: tl('entrée analogique (ADC)') };

const pins = list => Object.fromEntries(list.map(([k, n, caps, note]) => [k, { n, caps: new Set(caps.split(' ')), note }]));
const range = (pre, a, b) => Array.from({ length: b - a + 1 }, (_, i) => pre + (a + i));

const ESP_BOOT = tl('broche de démarrage (strapping) : son niveau au démarrage choisit le mode de boot, à garder en dernier recours');
const ESP_IN = tl('entrée seulement, sans résistance de tirage interne');
const AVR_PWM = [3, 5, 6, 9, 10, 11];
const avrDigital = (n, note) => [`D${n}`, n, `in out pu${AVR_PWM.includes(n) ? ' pwm' : ''}`, note];

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
    i2c: { sda: 'D21', scl: 'D22' }, spi: { sck: 'D18', miso: 'D19', mosi: 'D23', ss: 'D5' }, uart: { rx: 'RX2', tx: 'TX2', port: 'Serial2' },
    // Broches lues au démarrage : niveau qu'elles doivent avoir (D12 haut : flash à 1,8 V, la carte ne démarre pas ;
    // D2 haut : le téléversement ne passe plus en mode programmation).
    strap: { D12: 0, D2: 0 },
    adcNote: tl('elle appartient à l’ADC1, qui reste utilisable quand le Wi-Fi est actif (l’ADC2 ne l’est pas).'),
    tips: [tl('À éviter : D12, D2, D5 et D15 (broches de démarrage), TX0 et RX0 (port série USB). D34, D35, VP et VN sont des entrées seulement.'),
      tl('VIN fournit le 5 V de l’USB : pratique pour les modules qui exigent 5 V, mais leurs signaux de sortie doivent rester à 3,3 V.')],
    code: (k, g) => String(g.n), gpioName: (k, g) => `GPIO ${g.n}`
  },
  nodemcu: {
    label: 'NodeMCU', logic: 3.3, adcBits: 10, vref: 3.3, fixedBus: false,
    power: { '3V3': 3.3, VIN: 5 }, diode: ['VIN'], three: '3V3', five: 'VIN', vin: { pin: 'VIN', min: 4.5, max: 10 },
    gpio: pins([
      ['D0', 16, 'in out', tl('GPIO 16 : ni PWM, ni interruption, ni tirage interne vers le haut')],
      ['D1', 5, 'in out pu pwm'], ['D2', 4, 'in out pu pwm'],
      ['D3', 0, 'in out pu pwm', tl('broche de démarrage tirée au niveau haut : elle ne doit pas être à la masse au démarrage')],
      ['D4', 2, 'in out pu pwm', tl('reliée à la LED de la carte ; broche de démarrage tirée au niveau haut')],
      ['D5', 14, 'in out pu pwm'], ['D6', 12, 'in out pu pwm'], ['D7', 13, 'in out pu pwm'],
      ['D8', 15, 'in out pwm', tl('broche de démarrage tirée au niveau bas')],
      ['A0', 'A0', 'adc', tl('seule entrée analogique, 0 à 3,3 V sur cette carte')],
      ['RX', 3, 'in out uart0', tl('RX du port série USB')], ['TX', 1, 'in out uart0', tl('TX du port série USB')],
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

/** Autres sources d'énergie : tension par broche, 0 pour la masse. */
export const SOURCES = { bat9v: { '+': 9, '-': 0 }, bat18650: { '+': 3.7, '-': 0 }, mb102: { '+5V': 5, '+3V3': 3.3, GND: 0 } };
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
