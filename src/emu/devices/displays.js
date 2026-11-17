// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Afficheurs MAX7219 et TM1637 vus par un vrai programme (mode fidèle), sur le modèle commun de src/sim/displays.js.
//   MAX7219 : chaque front de CLK et de CS (LOAD) d'une broche de la carte reliée au module de tête fait avancer toute
//   la chaîne (LedControl, shiftOut, SPI logiciel) ; avec le SPI matériel (MD_MAX72XX, SPI.transfer), les octets
//   arrivent par le bus SPI pendant que CS est bas, et le front montant de CS les verrouille.
//   TM1637 : protocole à deux fils décodé au front près ; la puce acquitte chaque octet en tirant DIO à la masse
//   pendant la 9e impulsion. Les résistances de tirage du module tiennent CLK et DIO au niveau haut quand la carte
//   les relâche (pinMode INPUT), comme sur le vrai module.
import { MAX_TYPES, isMax, maxChain, maxHead, maxClock, maxBytes, maxLoad, maxState, tmState, tmFrame, publishDisplay } from '../../sim/displays.js';

const linkedOf = io => (io.hw && io.hw.linked ? (c, k) => io.hw.linked(c, k) : () => []);

const max7219 = {
  types: MAX_TYPES,
  bus: 'spi',
  create(comp, io) {
    const linked = linkedOf(io);
    let head = null, chain = null;
    // Chaîne relue à chaque rattachement (toutes les 0,5 s : le montage peut changer pendant la simulation).
    const refresh = () => { head = maxHead(comp, linked); chain = head === comp ? maxChain(comp, linked) : null; };
    refresh();
    maxState(comp);
    const keys = { DIN: io.pin('DIN'), CLK: io.pin('CLK'), CS: io.pin('CS') }, offs = [];
    // Seul le module de tête écoute les broches : les autres suivent par la chaîne.
    if (keys.CLK) offs.push(io.onEdge(keys.CLK, lv => { if (lv && chain) maxClock(chain, keys.DIN ? io.level(keys.DIN) : 0); }));
    if (keys.CS) offs.push(io.onEdge(keys.CS, lv => { if (lv && chain) maxLoad(chain); }));
    return {
      cs: 'CS',
      // SPI matériel : le module sélectionné peut ne pas être la tête (CS commun à toute la chaîne) : la tête reçoit.
      transfer(b) { const ch = chain || (isMax(head && head.type) && head !== comp ? maxChain(head, linked) : [comp]); maxBytes(ch, [b]); return 0xff; },
      frame() { refresh(); publishDisplay(comp); },
      dispose() { offs.forEach(f => f()); }
    };
  }
};

const tm1637 = {
  types: ['tm1637'],
  bus: 'pins',
  create(comp, io) {
    const clk = io.pin('CLK'), dio = io.pin('DIO');
    tmState(comp);
    if (!clk || !dio) return { frame() { publishDisplay(comp); } };
    // Tirages de 10 kΩ du module : lignes hautes quand personne ne les tire.
    io.drive(clk, true); io.drive(dio, true);
    let busy = false, bits = 0, cur = 0, bytes = [], ack = false, ck = io.level(clk), da = io.level(dio);
    const offs = [
      io.onEdge(clk, lv => {
        ck = lv;
        if (!busy) return;
        if (lv) { if (bits < 8 && !ack) { if (io.level(dio)) cur |= 1 << bits; bits++; } return; }
        // Front descendant : après le 8e bit, la puce tire DIO (acquittement) jusqu'au front descendant suivant.
        if (ack) { ack = false; io.drive(dio, true); bytes.push(cur); cur = 0; bits = 0; }
        else if (bits === 8) { ack = true; io.drive(dio, false); }
      }),
      io.onEdge(dio, lv => {
        const was = da; da = lv;
        if (!ck || ack || lv === was) return;
        if (!lv) { busy = true; bits = 0; cur = 0; bytes = []; } // départ
        else if (busy) { busy = false; if (bytes.length) tmFrame(comp, bytes); bytes = []; } // arrêt
      })
    ];
    return {
      frame() { publishDisplay(comp); },
      dispose() { offs.forEach(f => f()); io.drive(clk, null); io.drive(dio, null); }
    };
  }
};

export default [max7219, tm1637];
