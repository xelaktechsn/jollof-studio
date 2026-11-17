// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Module carte microSD vu par un vrai programme (mode fidèle) : la carte répond sur le bus SPI quand sa broche CS est
// à LOW, avec le protocole des cartes SD (src/sim/sdcard.js). Au démarrage, une image FAT16 est construite à partir
// des fichiers gardés avec le projet ; après les écritures du programme (fichier fermé ou synchronisé par la
// bibliothèque), l'image est relue et les fichiers du projet suivent, au plus quatre fois par seconde.
import { buildImage, createSdCard, readImage, sdStore, replaceStore } from '../../sim/sdcard.js';

/** État de la carte pour cette simulation (comp.icState, remis à zéro à l'arrêt) : image et carte. */
export function cardState(comp, mem) {
  let s = comp.icState;
  if (!s || s.t !== 'sdcard') {
    const st = sdStore(mem), files = new Map([...st.files].map(([p, f]) => [p, f.data.subarray(0, f.len)]));
    const img = buildImage(files, st.dirs);
    s = comp.icState = { t: 'sdcard', img, card: createSdCard(img), ver: 0 };
  }
  return s;
}
/** Relit l'image : les fichiers écrits par le programme rejoignent le projet. Rend true s'ils ont changé. */
export function syncCard(comp, mem, changed) {
  const s = comp.icState;
  if (!s || s.t !== 'sdcard' || !s.img.dirty) return false;
  s.img.dirty = false;
  const { files, dirs } = readImage(s.img), st = sdStore(mem);
  const ok = replaceStore(mem, st, files, dirs);
  if (ok) { s.ver++; if (changed) changed(); }
  return ok;
}

export default {
  types: ['sdcard'],
  bus: 'spi',
  create(comp, io) {
    const mem = io.hw && io.hw.compMem ? io.hw.compMem(comp) : {}, changed = () => { if (io.hw && io.hw.memChanged) io.hw.memChanged(); };
    let last = 0;
    const st = () => cardState(comp, mem);
    st();
    return {
      cs: 'CS',
      select() { st().card.select(); },
      deselect() { st().card.deselect(); },
      transfer(b) { return st().card.transfer(b); },
      frame() {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now - last < 250) return;
        last = now; syncCard(comp, mem, changed);
      },
      dispose() { syncCard(comp, mem, changed); }
    };
  }
};
