// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Radio LoRa SX1278 (module Ra-02) vue par un vrai programme : la puce de src/sim/lora.js sur le bus SPI de la carte
// émulée (NSS à LOW : adresse de registre, bit 7 à 1 pour écrire, puis données). La fin d'une émission tombe au cycle
// près (temps d'antenne), la broche DIO0 monte quand le drapeau choisi par RegDioMapping1 se lève (RxDone ou TxDone)
// et retombe quand le programme l'efface : attachInterrupt(…, RISING) de la bibliothèque LoRa la voit. RST tenue à
// LOW par la carte (sortie) garde la puce en reset ; une broche RST en entrée ou libre la laisse fonctionner (tirage
// interne de la puce). L'air est partagé avec les autres modules du montage, émulés ou interprétés.
import { loraChip, loraState } from '../../sim/lora.js';

export default {
  types: ['sx1278'],
  bus: 'spi',
  create(comp, io) {
    const rst = io.pin('RST'), dio = io.pin('DIO0');
    let dead = false;
    const chip = loraChip(comp, {
      now: () => io.now() / io.MHZ,
      peers: () => (io.hw.peers ? io.hw.peers(['sx1278']) : []),
      after: (s, fn) => io.after(Math.max(1, Math.round(s * io.MHZ)), () => { if (!dead) fn(); }),
      dio: lv => { if (dio && !dead) io.drive(dio, lv); }
    });
    // Un paquet arrive (déposé par l'émetteur) : DIO0 monte tout de suite, pas à la fin de la tranche.
    const wake = () => { if (!dead) chip.tick(); };
    const s = loraState(comp);
    Object.defineProperty(s, 'wake', { value: wake, enumerable: false, configurable: true, writable: true });
    const held = lv => !!rst && lv === 0 && (io.rec(rst) || {}).mode === 1;
    const off = rst ? io.onEdge(rst, lv => chip.hold(held(lv))) : null;
    if (rst && held(io.level(rst))) chip.hold(true);
    if (dio) io.drive(dio, chip.dio0());
    return {
      cs: 'NSS',
      // RST tenue à LOW par une sortie de la carte (même sans front depuis le démarrage) : la puce reste en reset.
      select: () => { if (rst) chip.hold(held(io.level(rst))); chip.select(); },
      transfer: b => chip.transfer(b),
      deselect: () => chip.deselect(),
      frame: () => chip.tick(),
      dispose() { dead = true; if (off) off(); const st = comp.icState; if (st && st.wake === wake) st.wake = null; if (dio) io.drive(dio, null); }
    };
  }
};
