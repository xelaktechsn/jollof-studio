// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Écran LCD 16×2 et son adaptateur I2C, vus par un vrai programme : l'extenseur PCF8574 reçoit un octet par
// écriture I2C (P0 = RS, P1 = RW, P2 = E, P3 = rétroéclairage, P4 à P7 = D4 à D7), et le contrôleur HD44780
// lit ses quatre bits de données à chaque front descendant de E (mode 4 bits, après l'initialisation en 8 bits).
// Le texte affiché est publié comme le fait la bibliothèque simulée : c.progScreen = { lines, ver }.

/** Caractères de la ROM du HD44780 (A00) qui diffèrent de l'ASCII. */
const ROM = { 0xdf: '°', 0x7e: '→', 0x7f: '←', 0xa5: '·', 0xe4: 'µ', 0xf4: 'Ω', 0xff: '█' };
const show = b => (b < 8 ? '▒' : ROM[b] || (b >= 0x20 && b < 0x7e ? String.fromCharCode(b) : ' '));

export function createHd44780() {
  const s = { ddram: new Uint8Array(128).fill(0x20), addr: 0, cg: false, inc: true, on: false, mode8: true, half: null, dirty: true };
  /** Instruction du contrôleur. */
  function command(c) {
    if (c & 0x80) { s.addr = c & 0x7f; s.cg = false; }
    else if (c & 0x40) { s.cg = true; }
    else if (c & 0x20) { s.mode8 = !!(c & 0x10); }
    else if (c & 0x10) { /* déplacement du curseur ou de l'affichage : non représenté */ }
    else if (c & 0x08) { s.on = !!(c & 0x04); s.dirty = true; }
    else if (c & 0x04) { s.inc = !!(c & 0x02); }
    else if (c & 0x02) { s.addr = 0; }
    else if (c & 0x01) { s.ddram.fill(0x20); s.addr = 0; s.dirty = true; }
  }
  function data(b) {
    if (s.cg) return; // caractères personnalisés (createChar) : gardés de côté, affichés « ▒ »
    s.ddram[s.addr & 0x7f] = b; s.dirty = true;
    s.addr = (s.addr + (s.inc ? 1 : -1)) & 0x7f;
    if (s.addr === 0x28) s.addr = 0x40; else if (s.addr === 0x68) s.addr = 0x00;
  }
  return {
    state: s,
    /** Front descendant de E : quatre bits (D7 à D4) lus, avec RS. */
    latch(nibble, rs) {
      if (s.mode8) { if (!rs) command(nibble << 4); return; }
      if (s.half === null) { s.half = nibble; return; }
      const b = (s.half << 4) | nibble; s.half = null;
      if (rs) data(b); else command(b);
    },
    lines(cols = 16) {
      const row = base => Array.from(s.ddram.subarray(base, base + cols), show).join('');
      return [row(0x00), row(0x40)];
    }
  };
}

export default {
  types: ['lcd1602'],
  bus: 'i2c',
  create(comp) {
    const lcd = createHd44780();
    let last = 0, light = false, ver = (comp.progScreen && comp.progScreen.ver) || 0, shown = '';
    const publish = () => {
      const lines = light && lcd.state.on ? lcd.lines() : [], sig = lines.join('\n');
      if (sig === shown && comp.progScreen) return;
      shown = sig;
      comp.progScreen = { lines, ver: ++ver };
    };
    return {
      write(b) {
        // E retombe : le contrôleur lit les bits de données du dernier octet où E était haut.
        if ((last & 0x04) && !(b & 0x04)) lcd.latch(last >> 4, last & 0x01);
        if (light !== !!(b & 0x08)) { light = !!(b & 0x08); lcd.state.dirty = true; }
        last = b;
        return true;
      },
      read() { return last | 0xf0; },
      frame() { if (lcd.state.dirty || !comp.progScreen) { lcd.state.dirty = false; publish(); } },
      dispose() {}
    };
  }
};
