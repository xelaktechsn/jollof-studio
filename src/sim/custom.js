// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Composants importés (STEP/GLB) rendus « électriques ». Une carte se décrit par sa famille de
// microcontrôleur et les noms de ses broches (GPIO4, IO13, D13, GP15, A0, 3V3, GND...) : on en
// déduit tensions, ADC, bus I2C/SPI et broches délicates. Un module se décrit par le rôle de
// chaque broche. Le résultat a la même forme que les profils et fiches de la bibliothèque.
import { base } from './boards.js';
import { tl, DEC } from '../i18n/index.js';

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const BOOT = tl('broche de démarrage (strapping) : son niveau au démarrage choisit le mode de boot');

/** Familles : règles par numéro de GPIO. */
export const FAMILIES = {
  esp32: {
    label: 'ESP32 (WROOM, WROVER)', logic: 3.3, adcBits: 12, vref: 3.3, fixedBus: false,
    gpios: [...range(0, 5), ...range(12, 19), ...range(21, 23), ...range(25, 27), ...range(32, 39), ...range(6, 11)],
    inOnly: range(34, 39), noPu: range(34, 39), flash: range(6, 11), uart0: [1, 3], usb: [],
    boot: { 0: BOOT, 2: BOOT + tl(' ; souvent reliée à la LED de la carte'), 5: BOOT, 12: tl('tirée au niveau haut au démarrage, elle empêche le démarrage'), 15: BOOT },
    adc: [36, 39, 34, 35, 32, 33], adcNote: tl('ADC1 : reste utilisable quand le Wi-Fi est actif.'),
    i2c: { sda: 21, scl: 22 }, spi: { sck: 18, miso: 19, mosi: 23, ss: 5 }, uart: { rx: 16, tx: 17, port: 'Serial2' },
    vin: { min: 5, max: 12 }
  },
  esp32s3: {
    label: 'ESP32-S3', logic: 3.3, adcBits: 12, vref: 3.3, fixedBus: false,
    gpios: [...range(0, 21), ...range(35, 48), ...range(26, 32)], inOnly: [], noPu: [], flash: range(26, 32), uart0: [43, 44], usb: [19, 20],
    boot: { 0: BOOT, 3: BOOT, 45: BOOT, 46: BOOT },
    adc: range(1, 10), adcNote: tl('ADC1 (GPIO1 à GPIO10) : reste utilisable quand le Wi-Fi est actif.'),
    i2c: { sda: 8, scl: 9 }, spi: { sck: 12, miso: 13, mosi: 11, ss: 10 }, uart: { rx: 18, tx: 17, port: 'Serial1' },
    vin: { min: 4.5, max: 5.5 }
  },
  esp32c3: {
    label: 'ESP32-C3', logic: 3.3, adcBits: 12, vref: 3.3, fixedBus: false,
    gpios: [...range(0, 10), 18, 19, 20, 21, ...range(11, 17)], inOnly: [], noPu: [], flash: range(11, 17), uart0: [20, 21], usb: [18, 19],
    boot: { 2: BOOT, 8: BOOT + tl(' ; souvent reliée à la LED de la carte'), 9: BOOT + tl(' (bouton BOOT)') },
    adc: range(0, 4), adcNote: tl('ADC1 (GPIO0 à GPIO4).'),
    i2c: { sda: 8, scl: 9 }, spi: { sck: 4, miso: 5, mosi: 6, ss: 7 }, uart: null,
    vin: { min: 4.5, max: 5.5 }
  },
  esp8266: {
    label: 'ESP8266', logic: 3.3, adcBits: 10, vref: 3.3, fixedBus: false,
    gpios: [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, ...range(6, 11)], inOnly: [], noPu: [16, 15], noPwm: [16], flash: range(6, 11), uart0: [1, 3], usb: [],
    boot: { 0: BOOT, 2: BOOT, 15: BOOT + tl(', tirée au niveau bas') },
    adc: [], adcPin: 'A0', adcNote: tl('seule entrée analogique de l’ESP8266.'),
    i2c: { sda: 4, scl: 5 }, spi: { sck: 14, miso: 12, mosi: 13, ss: 15 }, uart: null,
    dmap: { D0: 16, D1: 5, D2: 4, D3: 0, D4: 2, D5: 14, D6: 12, D7: 13, D8: 15, RX: 3, TX: 1 },
    vin: { min: 4.5, max: 10 }
  },
  rp2040: {
    label: tl('RP2040 (Pico, Pico W…)'), logic: 3.3, adcBits: 12, vref: 3.3, fixedBus: false,
    gpios: range(0, 29), inOnly: [], noPu: [], flash: [], uart0: [], usb: [], boot: {},
    adc: [26, 27, 28, 29], adcNote: tl('seules GP26 à GP29 sont reliées à l’ADC.'), amap: { A0: 26, A1: 27, A2: 28, A3: 29 },
    i2c: { sda: 4, scl: 5 }, spi: { sck: 18, miso: 16, mosi: 19, ss: 17 }, uart: { rx: 1, tx: 0, port: 'Serial1' },
    vin: { min: 1.8, max: 5.5 }
  },
  atmega328p: {
    label: tl('ATmega328P (Uno, Nano, Pro Mini)'), logic: 5, adcBits: 10, vref: 5, fixedBus: true,
    gpios: range(0, 21), inOnly: [], noPu: [], flash: [], uart0: [0, 1], usb: [], boot: {},
    pwm: [3, 5, 6, 9, 10, 11], adc: [14, 15, 16, 17, 18, 19, 20, 21], analogOnly: [20, 21],
    adcNote: '', amap: { A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, A6: 20, A7: 21 },
    i2c: { sda: 18, scl: 19 }, spi: { sck: 13, miso: 12, mosi: 11, ss: 10 }, uart: null,
    vin: { min: 7, max: 12 }
  }
};

const POWER = [
  [/^(3V3|3\.3V?|3V|\+3V3|VDD|VCC3)$/i, 3.3],
  [/^(5V|\+5V|VBUS|VUSB|USB|5V0)$/i, 5, true],
  [/^VIN$/i, 5, true],
  [/^VSYS$/i, 4.7, true]
];
/** Rôle d'une broche de carte d'après son nom. */
export function parseBoardPin(name, fam) {
  const n = base(name).trim();
  for (const [re, v, diode] of POWER) if (re.test(n)) return { kind: 'pwr', v, diode: !!diode, vin: /^(VIN|VSYS)$/i.test(n) };
  if (/^(GND|G|AGND|VSS|0V)$/i.test(n)) return { kind: 'gnd' };
  const up = n.toUpperCase();
  if (fam.dmap && fam.dmap[up] != null) return { kind: 'gpio', n: fam.dmap[up] };
  if (fam.amap && fam.amap[up] != null) return { kind: 'gpio', n: fam.amap[up] };
  if (up === 'A0' && fam.adcPin) return { kind: 'gpio', n: 'A0' };
  let m = n.match(/^(?:GPIO|IO|GP|P|D)?(\d{1,2})$/i);
  if (m) return { kind: 'gpio', n: +m[1] };
  const named = { SDA: fam.i2c.sda, SCL: fam.i2c.scl, SCK: fam.spi.sck, MOSI: fam.spi.mosi, MISO: fam.spi.miso, SS: fam.spi.ss, CS: fam.spi.ss, TX: fam.uart0[1] ?? fam.uart0[0], RX: fam.uart0[0] };
  if (named[up] != null) return { kind: 'gpio', n: named[up] };
  return { kind: 'other' };
}

/** Profil électrique (même forme que BOARDS) d'une carte importée. */
export function buildBoardProfile(name, familyId, pinNames) {
  const fam = FAMILIES[familyId] || FAMILIES.esp32;
  const prof = {
    label: name, logic: fam.logic, adcBits: fam.adcBits, vref: fam.vref, fixedBus: fam.fixedBus,
    power: {}, diode: [], gpio: {}, order: [], adcOrder: [], i2c: {}, spi: {}, uart: null, alias: [],
    adcNote: fam.adcNote, family: familyId,
    code: (k, g) => (typeof g.n === 'number' ? String(familyId === 'atmega328p' && g.n >= 14 ? 'A' + (g.n - 14) : g.n) : g.n),
    gpioName: (k, g) => (typeof g.n === 'number' && !/^(GPIO|IO|GP)\d/i.test(k) && familyId !== 'atmega328p' ? `GPIO ${g.n}` : '')
  };
  const byN = {};
  for (const raw of new Set(pinNames.map(base))) {
    const r = parseBoardPin(raw, fam);
    if (r.kind === 'pwr') { prof.power[raw] = r.v; if (r.diode) prof.diode.push(raw); if (r.vin) prof.vinPin = raw; }
    if (r.kind !== 'gpio') continue;
    const n = r.n, caps = new Set(), notes = [];
    if (n === 'A0') { caps.add('adc'); notes.push(fam.adcNote); }
    else if (fam.flash.includes(n)) { caps.add('flash'); notes.push(tl('reliée à la mémoire flash : à ne jamais utiliser')); }
    else {
      if (!(fam.analogOnly || []).includes(n)) { caps.add('in'); if (!fam.inOnly.includes(n)) caps.add('out'); }
      if (!fam.noPu.includes(n) && caps.has('in')) caps.add('pu');
      if (caps.has('out') && (fam.pwm ? fam.pwm.includes(n) : !(fam.noPwm || []).includes(n))) caps.add('pwm');
      if (fam.adc.includes(n)) caps.add('adc');
      if (fam.uart0.includes(n)) { caps.add('uart0'); notes.push(tl('port série USB')); }
      if (fam.usb.includes(n)) notes.push(tl('lignes USB natives : à éviter si vous utilisez l’USB'));
      if (fam.inOnly.includes(n)) notes.push(tl('entrée seulement, sans résistance de tirage interne'));
      if (fam.boot[n]) notes.push(fam.boot[n]);
    }
    prof.gpio[raw] = { n, caps, note: notes.join(tl(' ; ')) || undefined };
    if (!(n in byN)) byN[n] = raw;
  }
  prof.gnds = [...new Set(pinNames.map(base))].filter(k => parseBoardPin(k, fam).kind === 'gnd');
  const keys = Object.keys(prof.gpio), g = k => prof.gpio[k];
  const pinFor = n => (n == null ? null : byN[n] || null);
  // Bus par défaut de la famille, s'ils sont sortis sur la carte ; sinon (sauf AVR) deux broches libres.
  const spare = keys.filter(k => g(k).caps.has('out') && !g(k).note && !g(k).caps.has('adc'));
  prof.i2c = { sda: pinFor(fam.i2c.sda) || (!fam.fixedBus ? spare[0] : null), scl: pinFor(fam.i2c.scl) || (!fam.fixedBus ? spare[1] : null) };
  prof.spi = { sck: pinFor(fam.spi.sck), miso: pinFor(fam.spi.miso), mosi: pinFor(fam.spi.mosi), ss: pinFor(fam.spi.ss) };
  if (fam.uart && pinFor(fam.uart.rx) && pinFor(fam.uart.tx)) prof.uart = { rx: pinFor(fam.uart.rx), tx: pinFor(fam.uart.tx), port: fam.uart.port };
  const bus = new Set([...Object.values(prof.i2c), ...Object.values(prof.spi)].filter(Boolean));
  const rank = k => (g(k).note ? 3 : 0) + (bus.has(k) ? 2 : 0) + (g(k).caps.has('adc') ? 1 : 0);
  prof.order = keys.filter(k => g(k).caps.has('out') && !g(k).caps.has('uart0') && !g(k).caps.has('flash')).sort((a, b) => rank(a) - rank(b) || g(a).n - g(b).n);
  prof.order.push(...keys.filter(k => fam.inOnly.includes(g(k).n)));
  prof.adcOrder = keys.filter(k => g(k).caps.has('adc')).sort((a, b) => fam.adc.indexOf(g(a).n) - fam.adc.indexOf(g(b).n));
  const pw = Object.keys(prof.power);
  prof.three = pw.find(k => prof.power[k] === 3.3) || null;
  prof.five = pw.find(k => prof.power[k] >= 4.5 && !/^VSYS$/i.test(k)) || pw.find(k => prof.power[k] >= 4.5) || null;
  prof.vin = { pin: prof.vinPin || prof.five || prof.three || '', ...fam.vin };
  prof.tips = [tl('Carte importée, famille {0} : logique {1} V, ADC {2} bits.', fam.label, String(fam.logic).replace('.', DEC), fam.adcBits),
    tl('Les rôles des broches sont déduits de leur nom (GPIO4, IO4, D4, GP4, A0, 3V3, 5V, GND…). Renommez une broche pour corriger son rôle.')];
  return prof;
}

/** Rôles proposés pour les broches d'un module importé. */
export const MODULE_ROLES = [
  ['pwr', tl('Alimentation 3,3 à 5 V')], ['pwr33', tl('Alimentation 3,3 V')], ['pwr5', tl('Alimentation 5 V')], ['gnd', tl('Masse')],
  ['io', tl('Données (entrée/sortie)')], ['in', tl('Sortie du module → carte')], ['out', tl('Commande carte → module')], ['pwm', tl('Commande PWM')],
  ['adc', tl('Sortie analogique')], ['sda', 'I2C SDA'], ['scl', 'I2C SCL'], ['sck', 'SPI SCK'], ['mosi', 'SPI MOSI'], ['miso', 'SPI MISO'], ['ss', 'SPI CS'],
  ['tx', tl('Série TX du module')], ['rx', tl('Série RX du module')], ['nc', tl('Libre')]
];
/** Rôle probable d'une broche de module d'après son nom. */
export function guessRole(name) {
  const n = base(name).toUpperCase();
  if (/^(VCC|VIN|V\+|\+|PWR|3V3|3\.3V|5V|\+5V|VDD)$/.test(n)) return /3V3|3\.3/.test(n) ? 'pwr33' : /5V/.test(n) ? 'pwr5' : 'pwr';
  if (/^(GND|G|-|V-|VSS)$/.test(n)) return 'gnd';
  if (n === 'SDA') return 'sda'; if (n === 'SCL') return 'scl';
  if (/^(SCK|CLK|SCLK)$/.test(n)) return 'sck'; if (/^(MOSI|SDI)$/.test(n)) return 'mosi'; if (/^(MISO|SDO)$/.test(n)) return 'miso';
  if (/^(CS|SS|CSN|NSS)$/.test(n)) return 'ss';
  if (/^(TX|TXD)$/.test(n)) return 'tx'; if (/^(RX|RXD)$/.test(n)) return 'rx';
  if (/^(AO|A0|AOUT|ANALOG)$/.test(n)) return 'adc';
  if (/^(DO|OUT|DOUT|INT|IRQ|ECHO)$/.test(n)) return 'in';
  if (/^(IN|TRIG|EN|RST|RESET|CE)$/.test(n)) return 'out';
  if (/^(PWM|SIG)$/.test(n)) return 'pwm';
  return 'io';
}
const RV = { pwr: [3, 5.5], pwr33: [3, 3.6], pwr5: [4.5, 5.5] };
/** Fiche de câblage (même forme que PARTS) d'un module importé. */
export function buildModuleSpec(name, pins) {
  const label = Object.fromEntries(MODULE_ROLES);
  return {
    what: tl('Module importé : {0}. Rôles des broches définis à l’import.', name),
    pins: pins.map(p => {
      const role = p.role || guessRole(p.name);
      if (RV[role]) return { pin: p.name, kind: 'pwr', v: RV[role], why: label[role] + '.' };
      if (role === 'gnd') return { pin: p.name, kind: 'gnd' };
      if (role === 'nc') return { pin: p.name, kind: 'nc', why: tl('Laissée libre.') };
      return { pin: p.name, kind: 'io', need: role, role: label[role], why: label[role] + '.' };
    })
  };
}
