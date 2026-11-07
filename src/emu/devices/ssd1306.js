// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Écran OLED 0,96" et son contrôleur SSD1306, vus par un vrai programme. Chaque écriture I2C commence par un octet
// de contrôle : 0x00 suite de commandes, 0x40 suite d'octets d'image, 0x80 / 0xC0 un seul octet puis un nouvel
// octet de contrôle. Les commandes (et leurs paramètres, qui peuvent arriver dans une écriture suivante) règlent
// l'adressage et l'affichage ; les octets d'image remplissent la mémoire de 128 colonnes × 8 pages, un octet = une
// colonne de 8 pixels, bit 0 en haut. À la mise sous tension l'écran est éteint et sa pompe de charge arrêtée :
// sans 0x8D 0x14 puis 0xAF, rien ne s'allume, comme sur le vrai module.
// L'image publiée (c.progScreen = { bits, w, h, inv, on, ver }) est ce que l'on voit sur la dalle : retournements
// (0xA0/A1, 0xC0/C8), ligne de départ, décalage et câblage des lignes appliqués. Avec l'initialisation habituelle
// (Adafruit_SSD1306), le pixel (0, 0) est le bit 0 de bits[0].

/** Nombre de paramètres de chaque commande qui en a (défilements compris : consommés, non animés). */
const ARGS = { 0x20: 1, 0x21: 2, 0x22: 2, 0x26: 6, 0x27: 6, 0x29: 5, 0x2a: 5, 0x81: 1, 0x8d: 1, 0xa3: 2, 0xa8: 1, 0xad: 1, 0xd3: 1, 0xd5: 1, 0xd9: 1, 0xda: 1, 0xdb: 1 };

export function createSsd1306() {
  const ram = new Uint8Array(128 * 8); // indexée par segment (sortie colonne de la puce), après le retournement A0/A1
  const s = {
    mode: 2, c0: 0, c1: 127, p0: 0, p1: 7, col: 0, page: 0,        // adressage par page au démarrage
    start: 0, offset: 0, mux: 63, remap: 0, dec: false, com: 0x12,  // valeurs de remise à zéro de la fiche technique
    on: false, pump: false, inv: false, all: false, dirty: true
  };
  let cmd = -1, args = [];
  function exec(c, a) {
    if (c < 0x10) s.col = (s.col & 0x70) | c;                       // adressage par page : quartet bas de la colonne
    else if (c < 0x20) s.col = (s.col & 0x0f) | ((c & 7) << 4);     // … et quartet haut
    else if (c === 0x20) s.mode = a[0] & 3;                         // 0 horizontal, 1 vertical, 2 par page
    else if (c === 0x21) { s.c0 = a[0] & 0x7f; s.c1 = a[1] & 0x7f; s.col = s.c0; }
    else if (c === 0x22) { s.p0 = a[0] & 7; s.p1 = a[1] & 7; s.page = s.p0; }
    else if (c >= 0x40 && c < 0x80) s.start = c & 0x3f;
    else if (c === 0x8d) s.pump = !!(a[0] & 4);
    else if (c === 0xa0 || c === 0xa1) s.remap = c & 1;           // ne vaut que pour les octets écrits ensuite
    else if (c === 0xa4 || c === 0xa5) s.all = !!(c & 1);
    else if (c === 0xa6 || c === 0xa7) s.inv = !!(c & 1);
    else if (c === 0xa8) { if ((a[0] & 0x3f) >= 15) s.mux = a[0] & 0x3f; }
    else if (c === 0xae || c === 0xaf) s.on = !!(c & 1);
    else if (c >= 0xb0 && c < 0xb8) s.page = c & 7;
    else if (c >= 0xc0 && c < 0xd0) s.dec = !!(c & 8);              // effet immédiat sur toute l'image
    else if (c === 0xd3) s.offset = a[0] & 0x3f;
    else if (c === 0xda) s.com = a[0];
    s.dirty = true;
  }
  return {
    state: s, ram,
    command(b) {
      if (cmd < 0 && !ARGS[b]) return exec(b, []);
      if (cmd < 0) { cmd = b; args = []; return; }
      args.push(b);
      if (args.length === ARGS[cmd]) { const c = cmd; cmd = -1; exec(c, args); }
    },
    data(b) {
      ram[s.page * 128 + (s.remap ? 127 - s.col : s.col)] = b; s.dirty = true;
      // Le pointeur avance et revient au début de la zone choisie (0x21, 0x22) selon le mode d'adressage.
      if (s.mode === 1) { if (s.page++ >= s.p1) { s.page = s.p0; if (s.col++ >= s.c1) s.col = s.c0; } }
      else if (s.col++ >= s.c1) { s.col = s.c0; if (s.mode === 0 && s.page++ >= s.p1) s.page = s.p0; }
    },
    /** Image de la dalle : 32 lignes si le programme règle 32 lignes multiplexées (module 128×32), sinon 64. */
    image() {
      const N = s.mux + 1, H = N <= 32 ? 32 : 64, bits = new Uint8Array(128 * H / 8);
      // La dalle 128×64 est câblée pour les broches COM alternées (0xDA 0x12), la 128×32 pour les séquentielles
      // (0x02) ; avec l'autre réglage, une ligne sur deux se retrouve ailleurs. COM j allume la ligne H − 1 − P.
      const natAlt = H === 64, alt = !!(s.com & 0x10), lr = !!(s.com & 0x20);
      for (let k = 0; k < N; k++) {
        const j = ((s.dec ? N - 1 - k : k) - s.offset) & 63;
        const P = alt === natAlt ? j ^ (lr ? (alt ? 1 : 32) : 0) : natAlt ? (j < 32 ? 2 * j : 2 * j - 63) : j & 1 ? 32 + (j >> 1) : j >> 1;
        const y = H - 1 - P; if (y < 0) continue;
        const row = (k + s.start) & 63, src = (row >> 3) * 128, sh = row & 7, dst = (y >> 3) * 128, m = 1 << (y & 7);
        // Segment 0 à droite de la dalle : 0xA1 remet la colonne 0 à gauche.
        for (let x = 0; x < 128; x++) if (s.all || (ram[src + 127 - x] >> sh) & 1) bits[dst + x] |= m;
      }
      return { bits, w: 128, h: H, inv: s.inv, on: s.on && s.pump };
    }
  };
}

export default {
  types: ['oled'],
  bus: 'i2c',
  create(comp) {
    const oled = createSsd1306(), s = oled.state;
    let ver = (comp.progScreen && comp.progScreen.ver) || 0, shown = null, ctrl = true, co = false, dc = false;
    const publish = () => {
      const img = oled.image(), p = shown;
      if (p && comp.progScreen && p.h === img.h && p.inv === img.inv && p.on === img.on && p.bits.every((b, i) => b === img.bits[i])) return;
      shown = img;
      comp.progScreen = { ...img, ver: ++ver };
    };
    return {
      start() { ctrl = true; },
      write(b) {
        if (ctrl) { co = !!(b & 0x80); dc = !!(b & 0x40); ctrl = false; return true; }
        if (dc) oled.data(b); else oled.command(b);
        if (co) ctrl = true;
        return true;
      },
      // Lecture : l'octet d'état, bit 6 à 1 quand l'affichage est éteint.
      read() { return s.on ? 0x00 : 0x40; },
      frame() { if (s.dirty || !comp.progScreen) { s.dirty = false; publish(); } },
      dispose() {}
    };
  }
};
