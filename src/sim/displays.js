// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Afficheurs à pilote intégré : MAX7219 (matrice de LED 8 × 8, max7219m, et 8 chiffres de 7 segments, max7219s) et
// TM1637 (4 chiffres de 7 segments et deux-points). Un seul modèle par puce, au niveau de ses registres, d'après les
// fiches techniques (check/sources.js) : l'interpréteur (src/prog/runtime.js) et les processeurs émulés
// (src/emu/devices/displays.js) le font avancer, la scène 3D affiche ce qu'il publie sur comp.progScreen.
//
// MAX7219 : registre à décalage de 16 bits (D15 à D12 ignorés, D11 à D8 l'adresse, D7 à D0 la donnée), un bit entré
// sur DIN à chaque front montant de CLK, quel que soit LOAD ; le front montant de LOAD (CS) recopie le mot dans le
// registre adressé. DOUT rend le bit sorti du registre : plusieurs modules se chaînent (DOUT vers DIN du suivant,
// CLK et CS communs) et le premier mot envoyé finit dans le module le plus éloigné. Le module de tête (dont DIN vient
// de la carte) fait avancer toute la chaîne ; les autres ne suivent que lui.
// TM1637 : deux fils (CLK, DIO) tirés au niveau haut sur le module ; départ (DIO descend, CLK haut), octets bit de poids
// faible d'abord lus au front montant de CLK, acquittement de la puce (DIO bas pendant la 9e impulsion), arrêt (DIO
// monte, CLK haut). Commandes : données (0x40 à 0x4F), adresse (0xC0 à 0xC5), affichage (0x80 à 0x8F).
// L'état vit sur comp.icState (remis à zéro à l'arrêt de la simulation, comme celui des puces logiques).

export const MAX_TYPES = ['max7219m', 'max7219s'];
export const isMax = t => MAX_TYPES.includes(t);
export const DISPLAY_CHIPS = [...MAX_TYPES, 'tm1637'];

/* ---------- MAX7219 ---------- */
/**
 * À la mise sous tension (fiche, « Initial Power-Up ») : registres de contrôle à zéro, affichage éteint (arrêt,
 * « shutdown »), limite de balayage 0 (un seul chiffre), intensité minimale, pas de décodage. Chiffres : à zéro.
 */
function freshMax(t) { return { t, sr: 0, digits: new Uint8Array(8), decode: 0, intensity: 0, scan: 0, shutdown: true, test: false, lv: {}, ver: 0, pub: -1 }; }
/** État d'un MAX7219 (créé à la première lecture). */
export function maxState(comp) {
  if (!comp || !isMax(comp.type)) return null;
  if (!comp.icState || comp.icState.t !== comp.type) comp.icState = freshMax(comp.type);
  return comp.icState;
}
/** Mot de 16 bits reçu par la puce au front montant de LOAD. */
export function maxLatch(s, w) {
  const a = (w >> 8) & 15, d = w & 0xff;
  if (a >= 1 && a <= 8) s.digits[a - 1] = d;
  else if (a === 9) s.decode = d;
  else if (a === 10) s.intensity = d & 15;
  else if (a === 11) s.scan = d & 7;
  else if (a === 12) s.shutdown = !(d & 1);
  else if (a === 15) s.test = !!(d & 1);
  else return; // 0 : pas d'opération (sert à atteindre un autre module de la chaîne)
  s.ver++;
}
/**
 * Modules de la chaîne qui commence à head, dans l'ordre (DOUT de l'un vers DIN du suivant). linked(comp, broche) :
 * broches des autres composants reliées à celle-ci ([{ comp, key }], hw.linked).
 */
export function maxChain(head, linked) {
  const chain = [head];
  for (let c = head; chain.length < 32;) {
    const n = (linked ? linked(c, 'DOUT') : []).find(m => m.comp && isMax(m.comp.type) && m.key === 'DIN');
    if (!n || chain.includes(n.comp)) break;
    chain.push(n.comp); c = n.comp;
  }
  return chain;
}
/** Module de tête de la chaîne de comp : en remontant de DIN vers le DOUT du module précédent. */
export function maxHead(comp, linked) {
  let c = comp;
  for (let i = 0; i < 32; i++) {
    const p = (linked ? linked(c, 'DIN') : []).find(m => m.comp && isMax(m.comp.type) && m.key === 'DOUT');
    if (!p || p.comp === comp) break;
    c = p.comp;
  }
  return c;
}
/** Un front montant de CLK : bit entré dans le module de tête, chaque module passe son bit 15 au suivant. */
export function maxClock(chain, bit) {
  let b = bit ? 1 : 0;
  for (const c of chain) { const s = maxState(c), out = (s.sr >> 15) & 1; s.sr = ((s.sr << 1) | b) & 0xffff; b = out; }
}
/** Octets envoyés à la chaîne (bit de poids fort d'abord, SPI matériel ou shiftOut), sans LOAD. */
export function maxBytes(chain, bytes) { for (const v of bytes) for (let i = 7; i >= 0; i--) maxClock(chain, (v >> i) & 1); }
/** Front montant de LOAD (CS) : chaque module de la chaîne prend son mot. */
export function maxLoad(chain) { for (const c of chain) { const s = maxState(c); maxLatch(s, s.sr); } }
/** Bit présenté sur DOUT (le bit 15 du registre à décalage). */
export const maxDout = comp => { const s = maxState(comp); return s ? (s.sr >> 15) & 1 : 0; };

/** Code B (registre de décodage) : 0 à 9, −, E, H, L, P, espace ; en segments (bit 0 = A … bit 6 = G). */
const CODE_B = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x40, 0x79, 0x76, 0x38, 0x73, 0x00];
/** Octet d'un chiffre du MAX7219 sans décodage (D7 = DP, D6 = A … D0 = G) → segments (bit 0 = A … bit 6 = G, bit 7 = DP). */
const maxSegs = d => { let v = d & 0x80; for (let i = 0; i < 7; i++) if (d & (0x40 >> i)) v |= 1 << i; return v; };
/** Rapport cyclique des LED pour l'intensité n (fiche, table 7 : (2n + 1) ÷ 32). */
export const maxDuty = n => (2 * (n & 15) + 1) / 32;

/**
 * Ce que montre le module : matrice { mat: 8 lignes (bit 7 = colonne de gauche), on, level } ou chiffres de 7 segments
 * { seg: 8 octets de gauche à droite (bit 0 = A … bit 6 = G, bit 7 = point), on, level }. Les chiffres au-delà de la
 * limite de balayage restent éteints ; le test d'affichage allume tout, même à l'arrêt.
 */
export function maxImage(comp) {
  const s = maxState(comp); if (!s) return null;
  const on = s.test || !s.shutdown, level = s.test ? 1 : maxDuty(s.intensity) / maxDuty(15);
  const val = i => (s.test ? 0xff : i > s.scan ? 0 : s.digits[i]);
  if (s.t === 'max7219m') return { mat: Array.from({ length: 8 }, (_, r) => val(r)), on, level };
  // 7 segments : DIG0 est le chiffre de droite du module à 8 chiffres.
  const seg = [];
  for (let i = 7; i >= 0; i--) {
    const d = val(i);
    seg.push(s.test ? 0xff : (s.decode >> i) & 1 ? CODE_B[d & 15] | (d & 0x80) : maxSegs(d));
  }
  return { seg, on, level };
}

/* ---------- TM1637 ---------- */
/** Mise sous tension : affichage éteint, adressage automatique, mémoire à zéro. */
function freshTm() { return { t: 'tm1637', mem: new Uint8Array(6), auto: true, addr: 0, ctrl: 0, ver: 0, pub: -1 }; }
export function tmState(comp) {
  if (!comp || comp.type !== 'tm1637') return null;
  if (!comp.icState || comp.icState.t !== 'tm1637') comp.icState = freshTm();
  return comp.icState;
}
/** Une trame complète (du départ à l'arrêt) : premier octet = commande, puis données. Rend true si elle était comprise. */
export function tmFrame(comp, bytes) {
  const s = tmState(comp); if (!s || !bytes.length) return false;
  const c = bytes[0];
  if ((c & 0xc0) === 0x40) { s.auto = !(c & 0x04); return true; } // commande de données : adresse fixe ou automatique
  if ((c & 0xc0) === 0x80) { s.ctrl = c & 0x0f; s.ver++; return true; } // affichage : bit 3 allumé, bits 0 à 2 luminosité
  if ((c & 0xc0) === 0xc0) {
    s.addr = c & 7;
    for (const b of bytes.slice(1)) { if (s.addr < 6) s.mem[s.addr] = b; if (s.auto) s.addr++; }
    s.ver++;
    return true;
  }
  return false;
}
/** Largeur des impulsions selon la luminosité 0 à 7 (fiche, commande d'affichage) : 1/16, 2/16, 4/16, 10/16 … 14/16. */
export const TM_PULSE = [1, 2, 4, 10, 11, 12, 13, 14];
/** Ce que montre le module : 4 chiffres (le bit 7 du deuxième est le deux-points). */
export function tmImage(comp) {
  const s = tmState(comp); if (!s) return null;
  return { seg: Array.from(s.mem.subarray(0, 4)), colon: true, on: !!(s.ctrl & 8), level: TM_PULSE[s.ctrl & 7] / 14 };
}

/** Segments → caractère approché (étiquette de la scène, « ce qu'affiche le module »). */
const GLYPH = { 0x3f: '0', 0x06: '1', 0x5b: '2', 0x4f: '3', 0x66: '4', 0x6d: '5', 0x7d: '6', 0x07: '7', 0x7f: '8', 0x6f: '9', 0x77: 'A', 0x7c: 'b', 0x39: 'C', 0x5e: 'd', 0x79: 'E', 0x71: 'F', 0x40: '-', 0x00: ' ', 0x76: 'H', 0x38: 'L', 0x73: 'P', 0x3e: 'U', 0x1c: 'u', 0x5c: 'o', 0x54: 'n', 0x50: 'r', 0x78: 't', 0x08: '_' };
export function segText(seg, colon) {
  let out = '';
  seg.forEach((v, i) => { out += GLYPH[v & 0x7f] || '?'; if (v & 0x80) out += colon && i === 1 ? ':' : '.'; });
  return out;
}

/**
 * Image publiée pour la scène et le panneau : comp.progScreen = { mat | seg, on, level, text, ver }, réécrite
 * seulement quand l'état a changé.
 */
export function publishDisplay(comp) {
  const s = comp.icState; if (!s || s.pub === s.ver) return;
  s.pub = s.ver;
  const img = comp.type === 'tm1637' ? tmImage(comp) : maxImage(comp); if (!img) return;
  // Texte : les chiffres affichés, ou pour la matrice le nombre de LED allumées sur 64 (« 12/64 »).
  const text = !img.on ? '' : img.mat ? `${img.mat.reduce((n, r) => { let k = 0; for (let b = r; b; b &= b - 1) k++; return n + k; }, 0)}/64` : segText(img.seg, img.colon).trim();
  comp.progScreen = { ...img, text, ver: ((comp.progScreen && comp.progScreen.ver) || 0) + 1 };
}
