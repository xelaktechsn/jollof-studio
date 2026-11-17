// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Les deux AVR du mode fidèle, décrits pour avr8js : ATmega328P (Uno, Nano) et ATmega2560 (Mega 2560).
// avr8js ne fournit que les réglages de l'ATmega328P (adresses des registres et des vecteurs d'interruption) ; ceux de
// l'ATmega2560 sont repris de sa fiche technique (Atmel 2549Q, « Register Summary » et tableau 14-1 des vecteurs),
// vérifiés un à un contre l'en-tête d'avr-libc iomxx0_1.h livré avec avr-gcc (adresses _SFR_IO8 + 0x20 = adresse en
// mémoire de données, numéros *_vect_num). Correspondance broche Arduino → port et bit : variante « mega » du cœur
// arduino:avr (pins_arduino.h, digital_pin_to_port_PGM / digital_pin_to_bit_mask_PGM).
import {
  timer0Config, timer1Config, timer2Config, portAConfig, portBConfig, portCConfig, portDConfig, portEConfig, portFConfig,
  portGConfig, portHConfig, portJConfig, portKConfig, portLConfig, usart0Config, adcConfig, twiConfig, spiConfig,
  eepromConfig, watchdogConfig, clockConfig, ADCMuxInputType, ADCReference
} from 'avr8js';

/** ATmega328P : réglages d'avr8js tels quels. Ports : broche Arduino de chaque bit. Ports série : nom, réglage, broches RX et TX. */
const ATMEGA328P = {
  name: 'ATmega328P', flash: 0x8000, sram: 8192, eeprom: 1024,
  ports: { D: [portDConfig, [0, 1, 2, 3, 4, 5, 6, 7]], B: [portBConfig, [8, 9, 10, 11, 12, 13]], C: [portCConfig, [14, 15, 16, 17, 18, 19]] },
  timers: [timer0Config, timer1Config, timer2Config],
  usarts: [['Serial', usart0Config, 0, 1]],
  adc: adcConfig, adcChannels: 8, twi: twiConfig, spi: spiConfig, eepromCfg: eepromConfig, watchdog: watchdogConfig, clock: clockConfig
};

// ---------- ATmega2560 ----------
// Vecteur n (numérotation d'avr-libc, RESET = 0) : chaque entrée est un JMP de deux mots, à l'adresse 2n (en mots).
const v = n => 2 * n;
// Interruptions externes : INT0 à INT3 sur PD0 à PD3 (EICRA, 0x69), INT4 à INT7 sur PE4 à PE7 (EICRB, 0x6A) ;
// EIMSK 0x3D, EIFR 0x3C ; vecteurs 1 à 8.
const INT = i => ({ EICR: i < 4 ? 0x69 : 0x6a, EIMSK: 0x3d, EIFR: 0x3c, index: i, iscOffset: (i & 3) * 2, interrupt: v(1 + i) });
// Changement d'état : PCINT0 à 7 sur le port B (PCMSK0 0x6B), PCINT8 sur PE0 et PCINT9 à 15 sur PJ0 à PJ6 (PCMSK1 0x6C),
// PCINT16 à 23 sur le port K (PCMSK2 0x6D) ; PCICR 0x68, PCIFR 0x3B ; vecteurs 9 à 11.
const PCI = (k, PCMSK, mask, offset) => ({ PCIE: k, PCICR: 0x68, PCIFR: 0x3b, PCMSK, pinChangeInterrupt: v(9 + k), mask, offset });
const MEGA_PORTS = {
  A: [portAConfig, [22, 23, 24, 25, 26, 27, 28, 29]],
  B: [{ ...portBConfig, pinChange: PCI(0, 0x6b, 0xff, 0) }, [53, 52, 51, 50, 10, 11, 12, 13]],
  C: [{ ...portCConfig, pinChange: null }, [37, 36, 35, 34, 33, 32, 31, 30]],
  D: [{ ...portDConfig, pinChange: null, externalInterrupts: [INT(0), INT(1), INT(2), INT(3)] }, [21, 20, 19, 18, null, null, null, 38]],
  E: [{ ...portEConfig, pinChange: PCI(1, 0x6c, 0x01, 0), externalInterrupts: [null, null, null, null, INT(4), INT(5), INT(6), INT(7)] }, [0, 1, null, 5, 2, 3, null, null]],
  F: [portFConfig, [54, 55, 56, 57, 58, 59, 60, 61]],
  G: [portGConfig, [41, 40, 39, null, null, 4, null, null]],
  H: [portHConfig, [17, 16, null, 6, 7, 8, 9, null]],
  J: [{ ...portJConfig, pinChange: PCI(1, 0x6c, 0x7f, 1) }, [15, 14, null, null, null, null, null, null]],
  K: [{ ...portKConfig, pinChange: PCI(2, 0x6d, 0xff, 0) }, [62, 63, 64, 65, 66, 67, 68, 69]],
  L: [portLConfig, [49, 48, 47, 46, 45, 44, 43, 42]]
};
const PORT = P => MEGA_PORTS[P][0].PORT;
// Minuteries : 0 et 2 sur 8 bits (mêmes registres que l'ATmega328P), 1, 3, 4 et 5 sur 16 bits avec une troisième
// comparaison C (OCFnC et OCIEnC : bit 3 de TIFRn et TIMSKn). Sorties : OC0A PB7 (D13), OC0B PG5 (D4), OC1A/B/C PB5/6/7
// (D11, D12, D13), OC2A PB4 (D10), OC2B PH6 (D9), OC3A/B/C PE3/4/5 (D5, D2, D3), OC4A/B/C PH3/4/5 (D6, D7, D8),
// OC5A/B/C PL3/4/5 (D46, D45, D44). Horloges externes : T0 PD7, T1 PD6, T3 PE6, T4 PH7, T5 PL2.
const C16 = { OCFC: 8, OCIEC: 8 };
const timer16 = (base, TIFR, TIMSK, vec, P, ext) => ({
  ...timer1Config, ...C16,
  TCCRA: base, TCCRB: base + 1, TCCRC: base + 2, TCNT: base + 4, ICR: base + 6, OCRA: base + 8, OCRB: base + 10, OCRC: base + 12, TIFR, TIMSK,
  captureInterrupt: v(vec), compAInterrupt: v(vec + 1), compBInterrupt: v(vec + 2), compCInterrupt: v(vec + 3), ovfInterrupt: v(vec + 4),
  compPortA: PORT(P), compPinA: 3, compPortB: PORT(P), compPinB: 4, compPortC: PORT(P), compPinC: 5,
  externalClockPort: PORT(ext[0]), externalClockPin: ext[1]
});
const MEGA_TIMERS = [
  { ...timer0Config, compAInterrupt: v(21), compBInterrupt: v(22), ovfInterrupt: v(23), compPortA: PORT('B'), compPinA: 7, compPortB: PORT('G'), compPinB: 5, externalClockPort: PORT('D'), externalClockPin: 7 },
  { ...timer1Config, ...C16, OCRC: 0x8c, captureInterrupt: v(16), compAInterrupt: v(17), compBInterrupt: v(18), compCInterrupt: v(19), ovfInterrupt: v(20),
    compPortA: PORT('B'), compPinA: 5, compPortB: PORT('B'), compPinB: 6, compPortC: PORT('B'), compPinC: 7, externalClockPort: PORT('D'), externalClockPin: 6 },
  { ...timer2Config, compAInterrupt: v(13), compBInterrupt: v(14), ovfInterrupt: v(15), compPortA: PORT('B'), compPinA: 4, compPortB: PORT('H'), compPinB: 6 },
  timer16(0x90, 0x38, 0x71, 31, 'E', ['E', 6]),
  timer16(0xa0, 0x39, 0x72, 41, 'H', ['H', 7]),
  timer16(0x120, 0x3a, 0x73, 46, 'L', ['L', 2])
];
// Ports série : UCSRnA, B, C, (réservé), UBRRnL, UBRRnH, UDRn à la suite ; vecteurs RX, UDRE, TX consécutifs.
const usart = (base, vec) => ({ rxCompleteInterrupt: v(vec), dataRegisterEmptyInterrupt: v(vec + 1), txCompleteInterrupt: v(vec + 2), UCSRA: base, UCSRB: base + 1, UCSRC: base + 2, UBRRL: base + 4, UBRRH: base + 5, UDR: base + 6 });
// ADC : 16 entrées. MUX4:0 (ADMUX) et MUX5 (ADCSRB, bit 3) : 0 à 7 → ADC0 à 7, 0x20 à 0x27 → ADC8 à 15, 0x1E → 1,1 V,
// 0x1F → 0 V ; les entrées différentielles ne sont pas modélisées (lues 0 V). REFS1:0 : AREF, AVCC, 1,1 V, 2,56 V.
const SE = ch => ({ type: ADCMuxInputType.SingleEnded, channel: ch });
const megaChannels = {
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, SE(i)])),
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [0x20 + i, SE(8 + i)])),
  0x1e: { type: ADCMuxInputType.Constant, voltage: 1.1 }, 0x1f: { type: ADCMuxInputType.Constant, voltage: 0 }
};
const ATMEGA2560 = {
  // SRAM interne de 8 Ko après 512 octets de registres : la mémoire de données va jusqu'à RAMEND = 0x21FF.
  name: 'ATmega2560', flash: 0x40000, sram: 0x2200 - 0x100, eeprom: 4096,
  ports: MEGA_PORTS,
  timers: MEGA_TIMERS,
  usarts: [['Serial', usart(0xc0, 25), 0, 1], ['Serial1', usart(0xc8, 36), 19, 18], ['Serial2', usart(0xd0, 51), 17, 16], ['Serial3', usart(0x130, 54), 15, 14]],
  adc: { ...adcConfig, adcInterrupt: v(29), numChannels: 16, muxInputMask: 0x3f, muxChannels: megaChannels, adcReferences: [ADCReference.AREF, ADCReference.AVCC, ADCReference.Internal1V1, ADCReference.Internal2V56] },
  adcChannels: 16,
  twi: { ...twiConfig, twiInterrupt: v(39) }, spi: { ...spiConfig, spiInterrupt: v(24) },
  eepromCfg: { ...eepromConfig, eepromReadyInterrupt: v(30) }, watchdog: { ...watchdogConfig, watchdogInterrupt: v(12) }, clock: clockConfig
};

export const AVR_CHIPS = { atmega328p: ATMEGA328P, atmega2560: ATMEGA2560 };
/** Processeur d'une carte AVR du mode fidèle. */
export const chipOfKind = kind => (kind === 'mega' ? ATMEGA2560 : ATMEGA328P);
