// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Réglages de l'ATmega2560 (src/emu/avr-chips.js) comparés aux fichiers d'arduino:avr installés par arduino-cli :
// adresses des registres et numéros des vecteurs d'interruption d'avr-libc (iomxx0_1.h), broches Arduino → port et
// bit de la variante « mega » (pins_arduino.h). Sans le cœur arduino:avr sur la machine, le test est ignoré.
// node --test src/emu/avr-chips.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AVR_CHIPS } from './avr-chips.js';
import { BOARDS } from '../sim/boards.js';
import { pinMap } from '../prog/runtime.js';

const DATA = [path.join(os.homedir(), 'Library', 'Arduino15'), path.join(os.homedir(), '.arduino15'), path.join(process.env.LOCALAPPDATA || '', 'Arduino15')];
/** Premier fichier trouvé sous packages/arduino/<sous-dossier>/<version>/<suite>. */
function find(sub, rest) {
  for (const d of DATA) {
    const base = path.join(d, 'packages', 'arduino', sub);
    if (!fs.existsSync(base)) continue;
    for (const v of fs.readdirSync(base).sort().reverse()) { const f = path.join(base, v, rest); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); }
  }
  return null;
}
const IO = find('tools/avr-gcc', 'avr/include/avr/iomxx0_1.h'), PINS = find('hardware/avr', 'variants/mega/pins_arduino.h');
const M = AVR_CHIPS.atmega2560;

/** Adresse en mémoire de données d'un registre d'avr-libc (_SFR_IO8 : + 0x20). */
function reg(name) {
  const m = new RegExp(`#\\s*define\\s+${name}\\s+_SFR_(IO|MEM)(?:8|16)\\((0[xX][0-9a-fA-F]+)\\)`).exec(IO);
  assert.ok(m, `registre ${name} absent d'iomxx0_1.h`);
  return parseInt(m[2], 16) + (m[1] === 'IO' ? 0x20 : 0);
}
/** Adresse (en mots) d'un vecteur : 2 × numéro d'avr-libc. */
function vec(name) {
  const m = new RegExp(`#define\\s+${name}_vect_num\\s+(\\d+)`).exec(IO);
  assert.ok(m, `vecteur ${name} absent d'iomxx0_1.h`);
  return 2 * +m[1];
}

test('ATmega2560 : registres et vecteurs conformes à avr-libc', { skip: !IO && 'cœur arduino:avr absent' }, () => {
  const [t0, t1, t2, t3, t4, t5] = M.timers;
  for (const [t, n] of [[t0, 0], [t2, 2]]) {
    assert.deepEqual([t.TCCRA, t.TCCRB, t.TCNT, t.OCRA, t.OCRB, t.TIFR, t.TIMSK], [`TCCR${n}A`, `TCCR${n}B`, `TCNT${n}`, `OCR${n}A`, `OCR${n}B`, `TIFR${n}`, `TIMSK${n}`].map(reg), `minuterie ${n}`);
    assert.deepEqual([t.compAInterrupt, t.compBInterrupt, t.ovfInterrupt], [`TIMER${n}_COMPA`, `TIMER${n}_COMPB`, `TIMER${n}_OVF`].map(vec), `vecteurs de la minuterie ${n}`);
  }
  for (const [t, n] of [[t1, 1], [t3, 3], [t4, 4], [t5, 5]]) {
    assert.deepEqual([t.TCCRA, t.TCCRB, t.TCCRC, t.TCNT, t.ICR, t.OCRA, t.OCRB, t.OCRC, t.TIFR, t.TIMSK],
      [`TCCR${n}A`, `TCCR${n}B`, `TCCR${n}C`, `TCNT${n}`, `ICR${n}`, `OCR${n}A`, `OCR${n}B`, `OCR${n}C`, `TIFR${n}`, `TIMSK${n}`].map(reg), `minuterie ${n}`);
    assert.deepEqual([t.captureInterrupt, t.compAInterrupt, t.compBInterrupt, t.compCInterrupt, t.ovfInterrupt],
      [`TIMER${n}_CAPT`, `TIMER${n}_COMPA`, `TIMER${n}_COMPB`, `TIMER${n}_COMPC`, `TIMER${n}_OVF`].map(vec), `vecteurs de la minuterie ${n}`);
    const bit = name => 1 << +new RegExp(`#define\\s+${name}\\s+(\\d)`).exec(IO)[1];
    assert.deepEqual([t.TOV, t.OCFA, t.OCFB, t.OCFC], [`TOV${n}`, `OCF${n}A`, `OCF${n}B`, `OCF${n}C`].map(bit), `drapeaux de la minuterie ${n}`);
    assert.deepEqual([t.TOIE, t.OCIEA, t.OCIEB, t.OCIEC], [`TOIE${n}`, `OCIE${n}A`, `OCIE${n}B`, `OCIE${n}C`].map(bit), `interruptions de la minuterie ${n}`);
  }
  M.usarts.forEach(([name, u], n) => {
    assert.deepEqual([u.UCSRA, u.UCSRB, u.UCSRC, u.UBRRL, u.UDR], [`UCSR${n}A`, `UCSR${n}B`, `UCSR${n}C`, `UBRR${n}L`, `UDR${n}`].map(reg), name);
    assert.deepEqual([u.rxCompleteInterrupt, u.dataRegisterEmptyInterrupt, u.txCompleteInterrupt], [`USART${n}_RX`, `USART${n}_UDRE`, `USART${n}_TX`].map(vec), `vecteurs de ${name}`);
  });
  for (const [P, [cfg]] of Object.entries(M.ports)) assert.deepEqual([cfg.PIN, cfg.DDR, cfg.PORT], [`PIN${P}`, `DDR${P}`, `PORT${P}`].map(reg), `port ${P}`);
  const ext = Object.values(M.ports).flatMap(([cfg]) => cfg.externalInterrupts.filter(Boolean));
  assert.equal(ext.length, 8);
  for (const e of ext) {
    assert.equal(e.interrupt, vec(`INT${e.index}`));
    assert.equal(e.EICR, reg(e.index < 4 ? 'EICRA' : 'EICRB'));
    assert.deepEqual([e.EIMSK, e.EIFR], [reg('EIMSK'), reg('EIFR')]);
  }
  const pcs = Object.values(M.ports).map(([cfg]) => cfg.pinChange).filter(Boolean);
  for (const pc of pcs) assert.deepEqual([pc.PCICR, pc.PCIFR, pc.PCMSK, pc.pinChangeInterrupt], [reg('PCICR'), reg('PCIFR'), reg(`PCMSK${pc.PCIE}`), vec(`PCINT${pc.PCIE}`)]);
  assert.deepEqual([M.adc.ADMUX, M.adc.ADCSRA, M.adc.ADCSRB, M.adc.ADCL, M.adc.adcInterrupt], [reg('ADMUX'), reg('ADCSRA'), reg('ADCSRB'), reg('ADCL'), vec('ADC')]);
  assert.deepEqual([M.twi.TWBR, M.twi.TWCR, M.twi.TWDR, M.twi.twiInterrupt], [reg('TWBR'), reg('TWCR'), reg('TWDR'), vec('TWI')]);
  assert.deepEqual([M.spi.SPCR, M.spi.SPDR, M.spi.spiInterrupt], [reg('SPCR'), reg('SPDR'), vec('SPI_STC')]);
  assert.deepEqual([M.eepromCfg.EECR, M.eepromCfg.EEDR, M.eepromCfg.EEARL, M.eepromCfg.eepromReadyInterrupt], [reg('EECR'), reg('EEDR'), reg('EEARL'), vec('EE_READY')]);
  assert.deepEqual([M.watchdog.WDTCSR, M.watchdog.watchdogInterrupt], [reg('WDTCSR'), vec('WDT')]);
  assert.equal(M.clock.CLKPR, reg('CLKPR'));
});

test('ATmega2560 : broches Arduino du Mega (pins_arduino.h) et sorties des minuteries', { skip: !PINS && 'cœur arduino:avr absent' }, () => {
  const grab = n => new RegExp(`${n}\\[\\] = \\{([\\s\\S]*?)\\};`).exec(PINS)[1].split('\n').map(l => l.replace(/\/\/.*$/, '')).join('').split(',').map(x => x.trim()).filter(Boolean);
  const port = grab('digital_pin_to_port_PGM'), bit = grab('digital_pin_to_bit_mask_PGM'), timer = grab('digital_pin_to_timer_PGM');
  assert.equal(port.length, 70);
  const where = new Map();
  for (const [P, [, nums]] of Object.entries(M.ports)) nums.forEach((n, b) => { if (n != null) where.set(n, `P${P}${b}`); });
  for (let n = 0; n < 70; n++) assert.equal(where.get(n), `${port[n]}${/_BV\(\s*(\d)\s*\)/.exec(bit[n])[1]}`, `D${n}`);
  // Chaque sortie de minuterie (TIMER3B…) est sur la broche que dit le cœur Arduino.
  const at = (portAddr, b) => { const P = Object.keys(M.ports).find(k => M.ports[k][0].PORT === portAddr); return M.ports[P][1][b]; };
  const [t0, t1, t2, t3, t4, t5] = M.timers;
  const outs = { 0: t0, 1: t1, 2: t2, 3: t3, 4: t4, 5: t5 };
  timer.forEach((t, n) => {
    const m = /TIMER(\d)([ABC])/.exec(t); if (!m) return;
    const c = outs[m[1]];
    assert.equal(at(c[`compPort${m[2]}`], c[`compPin${m[2]}`]), n, `${t} sur D${n}`);
  });
  // Toutes les broches de la carte (D0 à D53, A0 à A15) ont un port.
  const keys = pinMap(BOARDS.mega, 'mega');
  for (let n = 0; n < 70; n++) assert.ok(keys.get(n), `D${n} sans broche sur la carte`);
});
