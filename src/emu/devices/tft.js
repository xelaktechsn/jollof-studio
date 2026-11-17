// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Écrans TFT ST7735 et ILI9341 vus par un vrai programme (mode fidèle) : chaque octet SPI reçu pendant que CS est à
// l'état bas est une commande (DC à 0) ou une donnée (DC à 1), lue au moment de l'octet ; le contrôleur est celui de
// l'interpréteur (src/sim/tft.js). SPI matériel : octets du bus de la carte. SPI logiciel (Adafruit_ST7735(cs, dc,
// mosi, sclk, rst)) : chaque front montant de SCK, CS bas, lit un bit sur SDA / MOSI, poids fort d'abord. Un front
// descendant de RESET remet le contrôleur à zéro. MISO (ILI9341) rend l'octet des commandes de lecture.
import { tftOf, tftPublish, TFT, TFT_TYPES } from '../../sim/tft.js';

export default {
  types: TFT_TYPES,
  bus: 'spi',
  create(comp, io) {
    const P = TFT[comp.type], key = k => io.pin(k);
    const dcKey = key('DC'), mosiKey = key(P.mosi), sckKey = key('SCK'), rstKey = key('RESET');
    const byte = b => {
      const t = tftOf(comp), dc = dcKey ? io.level(dcKey) : 1;
      if (dc === 0) { t.command(b); return 0; }
      return t.data(b);
    };
    let selected = false, hard = false, bits = 0, n = 0;
    const offs = [];
    // SPI logiciel : ignoré dès que le bus matériel a servi (une carte dont le SPI matériel ferait aussi bouger SCK).
    if (sckKey && mosiKey) offs.push(io.onEdge(sckKey, lv => {
      if (!lv || !selected || hard) return;
      bits = ((bits << 1) | (io.level(mosiKey) ? 1 : 0)) & 0xff;
      if (++n === 8) { n = 0; byte(bits); bits = 0; }
    }));
    if (rstKey) offs.push(io.onEdge(rstKey, lv => { if (!lv) tftOf(comp).reset(); }));
    tftOf(comp);
    return {
      cs: 'CS',
      select() { selected = true; n = 0; bits = 0; },
      deselect() { selected = false; n = 0; },
      transfer(b) { hard = true; return byte(b); },
      frame() { tftPublish(comp); },
      dispose() { offs.forEach(f => f()); }
    };
  }
};
