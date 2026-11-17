// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Circuits logiques numériques : registres à décalage 74HC595 (entrée série, sorties parallèles) et 74HC165 (entrées
// parallèles, sortie série), extenseurs d'entrées-sorties I2C MCP23017 et PCF8574, pilote PWM 16 voies PCA9685.
// Un seul modèle par puce, partagé par tous les moteurs : l'interpréteur (src/prog/runtime.js) et les processeurs
// émulés (src/emu/devices/chips.js) le font avancer, le calcul du circuit (src/sim/dc.js) lit ses sorties, les
// effecteurs (src/sim/actuators.js) y lisent l'impulsion d'un servo. L'état vit sur le composant : comp.icState.
//
// Registres à décalage : modèle au niveau des broches. Chaque front écrit par la carte sur une broche reliée à la
// puce (digitalWrite, shiftOut, ou registres du vrai programme) passe par shiftEdges ; les autres entrées (MR à VCC,
// OE à la masse, DS relié au Q7S d'une autre puce) se lisent dans le montage.
// Extenseurs et PCA9685 : modèle au niveau des registres, d'après les fiches techniques (sources.js) ; chipI2c rend
// l'esclave I2C (start, write, read, stop), le même pour Wire de l'interpréteur et pour le TWI d'avr8js / rp2040js.

/** Puces de ce module, par famille. */
export const SHIFT_TYPES = ['hc595', 'hc165'];
export const I2C_CHIPS = ['mcp23017', 'pcf8574', 'pca9685'];
export const CHIP_TYPES = [...SHIFT_TYPES, ...I2C_CHIPS];
export const isChip = t => CHIP_TYPES.includes(t);

const range = (p, n, from = 0) => Array.from({ length: n }, (_, i) => p + (i + from));
const MCP_PINS = [...range('GPA', 8), ...range('GPB', 8)];
/**
 * Étages de sortie (Ω) pour le calcul du circuit : hi vers VCC, lo vers la masse, pull : tirage faible vers VCC.
 * 74HC595 (TI SCLS041J § 6.5, sous 4,5 V) : VOH 4,3 V typ. (3,84 V au pire) à −6 mA, VOL 0,17 V typ. (0,33 V au
 * pire) à 6 mA, soit ≈ 30 Ω typiques et 55 à 110 Ω au pire : 50 Ω. 74HC165 (SCLS116H) : mêmes tensions à ±4 mA.
 * MCP23017 (DS20001952D, table 1-1) : VOL 0,6 V au plus à 8 mA (75 Ω), VOH VDD − 0,7 V à −3 mA (233 Ω au pire) ;
 * tirage interne de 100 kΩ (§ 3.5.7). PCF8574 (TI SCPS068K § 5.5) : IOL 25 mA typ. sous VOL = 1 V (40 Ω) ; un 1 n'est
 * qu'une source de ≈ 100 µA (30 à 300 µA) : 50 kΩ. PCA9685 (NXP rév. 4, table 14) : 25 mA absorbés sous 0,5 V (20 Ω),
 * 10 mA fournis sous 0,5 V (50 Ω), plus les résistances de 220 Ω en série du module (Adafruit 815).
 * outs : broches de sortie (ou d'entrée-sortie) ; oe : broche de validation des sorties.
 */
export const CHIPS = {
  hc595: { outs: [...range('Q', 8), 'Q7S'], hi: 50, lo: 50, oe: 'OE', vmin: 2 },
  hc165: { outs: ['Q7', 'Q7N'], hi: 50, lo: 50, vmin: 2 },
  mcp23017: { outs: MCP_PINS, hi: 100, lo: 50, pull: 100e3, vmin: 1.8 },
  pcf8574: { outs: range('P', 8), hi: 0, lo: 40, pull: 50e3, vmin: 2.5 },
  pca9685: { outs: range('PWM', 16), hi: 270, lo: 240, oe: 'OE', vmin: 2.3 }
};
/** Horloge interne du PCA9685 (Hz) : 25 MHz, celle que suppose la bibliothèque Adafruit_PWMServoDriver. */
export const PCA_OSC = 25e6;

/* ---------- État ---------- */
function fresh(t) {
  switch (t) {
    case 'hc595': return { t, sr: 0, latch: 0, lv: {}, ver: 0 };
    case 'hc165': return { t, sr: 0, lv: {}, ck: 0, ver: 0 };
    case 'mcp23017': { const r = new Uint8Array(0x16); r[0] = r[1] = 0xff; return { t, reg: r, ver: 0 }; }
    case 'pcf8574': return { t, out: 0xff, ver: 0 };
    case 'pca9685': {
      const r = new Uint8Array(256);
      r[0] = 0x11; r[1] = 0x04; r[2] = 0xe2; r[3] = 0xe4; r[4] = 0xe8; r[5] = 0xe0; r[0xfe] = 0x1e;
      for (let n = 0; n < 16; n++) r[9 + 4 * n] = 0x10; // LEDn_OFF_H bit 4 : chaque sortie démarre éteinte
      return { t, reg: r, restart: false, ver: 0 };
    }
    default: return null;
  }
}
/** État de la puce (créé à la première lecture). */
export function chipState(comp) {
  if (!comp || !isChip(comp.type)) return null;
  if (!comp.icState || comp.icState.t !== comp.type) comp.icState = fresh(comp.type);
  return comp.icState;
}
/** Remet les puces à leur état de mise sous tension (arrêt de la simulation). */
export function resetChips(comps) { for (const c of comps || []) if (c && c.icState) c.icState = null; }

/* ---------- Fronts simultanés ---------- */
// Deux registres en cascade sur la même horloge : la seconde puce lit le Q7S de la première tel qu'il était avant le
// front. Chaque front porte un jeton (TOK, le front en cours de traitement, 0 hors d'un front) ; une puce qui a déjà
// décalé pour ce jeton rend son ancien Q7S. Interpréteur : un compteur ; processeur émulé : le cycle du front.
let TOK = 0, SEQ = 0;
export const nextEdge = () => ++SEQ;

/* ---------- Sorties ---------- */
/**
 * Ce que la puce présente sur la broche key : null (haute impédance, ou pas une sortie), sinon
 * { d: 0 | 1, weak (tirage faible seulement), duty (0 à 1, PWM), freq (Hz), servo (angle, impulsion de servo) }.
 * oe : niveau de la broche OE (1 coupe les sorties du 74HC595 et du PCA9685).
 */
export function chipOut(comp, key, oe = 0) {
  const s = chipState(comp); if (!s) return null;
  switch (s.t) {
    case 'hc595': {
      if (key === 'Q7S') { const sr = s.tok === TOK && s.prevSr != null ? s.prevSr : s.sr; return { d: (sr >> 7) & 1 }; }
      const i = /^Q([0-7])$/.exec(key); if (!i) return null;
      return oe ? null : { d: (s.latch >> +i[1]) & 1 };
    }
    case 'hc165': {
      const sr = s.tok === TOK && s.prevSr != null ? s.prevSr : s.sr, q = (sr >> 7) & 1;
      return key === 'Q7' ? { d: q } : key === 'Q7N' ? { d: q ^ 1 } : null;
    }
    case 'mcp23017': {
      const i = MCP_PINS.indexOf(key); if (i < 0) return null;
      const port = i >> 3, bit = i & 7, out = !((s.reg[port] >> bit) & 1);
      if (out) return { d: (s.reg[0x14 + port] >> bit) & 1 };
      return (s.reg[0x0c + port] >> bit) & 1 ? { d: 1, weak: true } : null;
    }
    case 'pcf8574': {
      const i = /^P([0-7])$/.exec(key); if (!i) return null;
      return (s.out >> +i[1]) & 1 ? { d: 1, weak: true } : { d: 0 };
    }
    case 'pca9685': {
      const i = /^PWM(\d+)$/.exec(key); if (!i || +i[1] > 15) return null;
      return pcaChannel(s, +i[1], oe);
    }
  }
  return null;
}
/** Voie n du PCA9685 : rapport cyclique, fréquence et, si l'impulsion en est une, angle d'un servo. */
function pcaChannel(s, n, oe) {
  const r = s.reg, b = 6 + 4 * n, on = r[b] | ((r[b + 1] & 0x0f) << 8), off = r[b + 2] | ((r[b + 3] & 0x0f) << 8);
  const fullOn = r[b + 1] & 0x10, fullOff = r[b + 3] & 0x10, sleep = r[0] & 0x10, m2 = r[1];
  const freq = PCA_OSC / (4096 * (Math.max(3, r[0xfe]) + 1));
  // OE à l'état haut ou oscillateur arrêté (SLEEP) : sorties au repos (OUTNE = 00 : LEDn = 0), comme à la mise sous tension.
  let duty = oe || sleep ? 0 : fullOff ? 0 : fullOn ? 1 : ((off - on) & 0xfff) / 4096;
  if (!(oe || sleep) && m2 & 0x10) duty = 1 - duty; // INVRT
  const od = !(m2 & 0x04); // OUTDRV = 0 : drain ouvert, la sortie ne fait qu'absorber
  const out = { d: duty > 0 ? 1 : 0, duty, freq, od };
  const ms = duty * 1000 / freq;
  if (duty > 0 && duty < 1 && freq >= 40 && freq <= 70 && ms >= 0.4 && ms <= 2.7) out.servo = Math.max(0, Math.min(180, (ms - 0.544) / (2.4 - 0.544) * 180));
  return out;
}
/** Niveau logique d'une sortie de puce (pour une autre puce ou une carte qui la lit), ou null. */
export function outLevel(comp, key, oe = 0) {
  const o = isChip(comp && comp.type) ? chipOut(comp, key, oe) : null;
  return o ? (o.duty != null ? (o.duty >= 0.5 ? 1 : 0) : o.d) : null;
}

/**
 * Niveau du nœud d'une broche d'après l'analyse du montage A : alimentation ou masse directes, sortie d'une puce ou
 * d'une carte (gpio(g) → 0, 1 ou null), puis à travers des résistances (tirage). null : en l'air.
 */
export function netLevel(A, ref, gpio = () => null) {
  if (!A || !ref.comp.pins || !ref.comp.pins[ref.key]) return null;
  const n = A.net(ref);
  if (n.src.length) return 1;
  if (n.gnd.length) return 0;
  for (const m of A.members(ref)) {
    if (m.comp === ref.comp && m.key === ref.key) continue;
    const l = isChip(m.comp.type) ? outLevel(m.comp, m.key, oeLevel(A, m.comp, gpio)) : null;
    if (l != null) return l;
  }
  for (const g of n.gpio) { const l = gpio(g); if (l != null) return l; }
  const w = A.wnet(ref);
  if (w.src.length && !w.gnd.length) return 1;
  if (w.gnd.length && !w.src.length) return 0;
  // Tirage interne ou soudé sur un module (WEAK_PULL), de cette broche ou d'une autre du même nœud : RESET d'un A4988
  // relié à son SLEEP (tiré au niveau haut sur la carte Pololu) se lit à 1.
  for (const m of A.members(ref)) { const p = WEAK_PULL[m.comp.type]; if (p && p[m.key] != null) return p[m.key]; }
  return null;
}
/**
 * Tirages internes (ou soudés sur la carte du module) des entrées laissées en l'air : type → { broche: 0 | 1 }.
 * A4988 (Pololu 1182) : MS1 à MS3 et ENABLE tirées vers la masse (pas entier, pilote actif), SLEEP tirée au niveau haut,
 * RESET en l'air (à relier à SLEEP). DRV8825 (Pololu 2133) : M0 à M2, ENABLE, RESET (100 kΩ) et SLEEP (1 MΩ) tirées
 * vers la masse : RESET et SLEEP doivent être mises au niveau haut. TB6612FNG : STBY (Pololu 713) et les entrées tirées
 * vers la masse (200 kΩ internes).
 */
export const WEAK_PULL = {
  a4988: { ENABLE: 0, MS1: 0, MS2: 0, MS3: 0, SLEEP: 1 },
  drv8825: { ENABLE: 0, M0: 0, M1: 0, M2: 0, RESET: 0, SLEEP: 0 },
  tb6612: { STBY: 0, AIN1: 0, AIN2: 0, PWMA: 0, BIN1: 0, BIN2: 0, PWMB: 0 }
};
/** Niveau de la broche OE d'une puce (0 si elle n'en a pas, ou s'il est inconnu : modules tirés vers la masse). */
function oeLevel(A, comp, gpio) {
  const k = CHIPS[comp.type] && CHIPS[comp.type].oe; if (!k || !comp.pins || !comp.pins[k]) return 0;
  const s = comp.icState && comp.icState.lv && comp.icState.lv[k];
  if (s != null) return s;
  const n = A.net({ comp, key: k });
  if (n.src.length) return 1;
  for (const g of n.gpio) { const l = gpio(g); if (l != null) return l; }
  return 0;
}

/* ---------- Registres à décalage : fronts ---------- */
/**
 * La carte vient d'écrire `level` sur une broche reliée à ces broches de puces ([{ comp, pin }]). read(comp, pin) :
 * niveau d'une autre broche de la puce que la carte ne commande pas (0, 1 ou null). tok : jeton du front (nextEdge).
 * Les entrées sont toutes lues avant que la moindre puce ne décale : cascade sur une horloge commune.
 */
export function shiftEdges(list, level, tok, read = () => null) {
  level = level ? 1 : 0;
  TOK = tok;
  try { edges(list, level, tok, read); } finally { TOK = 0; }
}
function edges(list, level, tok, read) {
  const lvOf = (c, s, p, def) => { const x = s.lv[p] != null ? s.lv[p] : read(c, p); return x == null ? def : x; };
  const acts = [];
  for (const { comp, pin } of list) {
    const s = chipState(comp); if (!s || !SHIFT_TYPES.includes(s.t)) continue;
    const was = s.lv[pin];
    s.lv[pin] = level;
    if (s.t === 'hc595') {
      if (pin === 'MR' && !level) acts.push(() => { s.sr = 0; s.ver++; });
      else if (pin === 'SHCP' && level && was !== 1) {
        const mr = lvOf(comp, s, 'MR', 1), ds = lvOf(comp, s, 'DS', 0);
        acts.push(() => { if (s.tok !== tok) { s.prevSr = s.sr; s.tok = tok; } s.sr = mr ? ((s.sr << 1) | ds) & 0xff : 0; s.ver++; });
      } else if (pin === 'STCP' && level && was !== 1) acts.push(() => { s.latch = s.sr; s.ver++; });
    } else {
      // 74HC165 : PL à l'état bas charge les entrées D0 à D7 (sans horloge) ; l'horloge est CP OU CE (fiche : « The
      // functions of CLK and CLK INH are interchangeable ») : un front montant de l'une, l'autre basse, décale.
      const pl = lvOf(comp, s, 'PL', 1);
      if (pin === 'PL') { if (!level || was === 0) acts.push(() => { s.sr = load165(comp, s, lvOf); s.ver++; }); continue; }
      if (pin !== 'CP' && pin !== 'CE') continue;
      const other = lvOf(comp, s, pin === 'CP' ? 'CE' : 'CP', 0), ck = level || other ? 1 : 0, rise = ck && !s.ck;
      s.ck = ck;
      if (rise && pl) { const ds = lvOf(comp, s, 'DS', 0); acts.push(() => { if (s.tok !== tok) { s.prevSr = s.sr; s.tok = tok; } s.sr = ((s.sr << 1) | ds) & 0xff; s.ver++; }); }
      else if (!pl) acts.push(() => { s.sr = load165(comp, s, lvOf); });
    }
  }
  for (const f of acts) f();
}
/** Entrées parallèles du 74HC165 : D7 sur le bit 7 (le premier qui sort sur Q7). En l'air : lu au niveau haut. */
function load165(comp, s, lvOf) {
  let v = 0;
  for (let i = 0; i < 8; i++) if (lvOf(comp, s, 'D' + i, 1)) v |= 1 << i;
  return v;
}

/* ---------- Esclaves I2C ---------- */
/** Adresses I2C de la puce : A0 à A2 au niveau haut (alimentation) ou non. PCA9685 : 0x40 (cavaliers d'adresse ouverts). */
export function chipAddr(comp, A) {
  const hi = k => (A && comp.pins && comp.pins[k] && A.net({ comp, key: k }).src.length ? 1 : 0);
  if (comp.type === 'pca9685') return [0x40];
  if (comp.type === 'mcp23017' || comp.type === 'pcf8574') return [0x20 | (hi('A2') << 2) | (hi('A1') << 1) | hi('A0')];
  return [];
}

/**
 * Esclave I2C de la puce. env : { node(clé) → 0 | 1 | null } (niveau du montage sur une broche, pour les entrées).
 * Rend { start(écriture), write(octet) → acquitté, read() → octet, stop() } ; le pointeur de registre suit la fiche.
 */
export function chipI2c(comp, env = {}) {
  const node = k => (env.node ? env.node(k) : null);
  let first = false;
  const s = () => chipState(comp);
  if (comp.type === 'pcf8574') return {
    start() {},
    write(b) { const x = s(); x.out = b & 0xff; x.ver++; return true; },
    // Port quasi bidirectionnel : un 0 écrit tire la broche à la masse ; un 1 n'est qu'un faible tirage, que le
    // montage (bouton vers la masse) peut abaisser.
    read() { const x = s(); let v = 0; for (let i = 0; i < 8; i++) { const w = (x.out >> i) & 1; if (w && node('P' + i) !== 0) v |= 1 << i; } return v; },
    stop() {}
  };
  if (comp.type === 'mcp23017') {
    let ptr = 0;
    const adv = x => { ptr = x.reg[0x0a] & 0x20 ? ptr ^ 1 : ptr >= 0x15 ? 0 : ptr + 1; }; // SEQOP = 1 : la paire A/B
    const rd = (x, a) => {
      if (a === 0x12 || a === 0x13) {
        const p = a - 0x12;
        let v = 0;
        for (let i = 0; i < 8; i++) {
          const m = 1 << i;
          if (!(x.reg[p] & m)) { if (x.reg[0x14 + p] & m) v |= m; continue; } // sortie : son verrou
          const n = node(MCP_PINS[p * 8 + i]), lv = n != null ? n : x.reg[0x0c + p] & m ? 1 : 0;
          if (lv ^ ((x.reg[0x02 + p] & m) ? 1 : 0)) v |= m; // IPOL : entrée inversée
        }
        return v;
      }
      if (a === 0x0b) return x.reg[0x0a]; // IOCON : un seul registre, deux adresses
      return x.reg[a] ?? 0;
    };
    const wr = (x, a, b) => {
      if (a === 0x12 || a === 0x13) a += 2; // écrire GPIO écrit le verrou OLAT
      if (a === 0x0b) a = 0x0a;
      if (a === 0x0e || a === 0x0f || a === 0x10 || a === 0x11) return; // INTF, INTCAP : lecture seule
      if (a <= 0x15) { x.reg[a] = b; x.ver++; }
    };
    return {
      start(write) { if (write) first = true; },
      write(b) { const x = s(); if (first) { ptr = b <= 0x15 ? b : 0; first = false; return true; } wr(x, ptr, b & 0xff); adv(x); return true; },
      read() { const x = s(), v = rd(x, ptr); adv(x); return v; },
      stop() { first = false; }
    };
  }
  if (comp.type === 'pca9685') {
    let ptr = 0;
    const adv = x => { if (!(x.reg[0] & 0x20)) return; ptr = ptr === 0x45 || ptr >= 0xfe ? 0 : ptr + 1; }; // AI
    const wr = (x, a, b) => {
      const r = x.reg;
      if (a === 0) {
        if ((b & 0x10) && !(r[0] & 0x10)) x.restart = true; // mise en sommeil : RESTART dira que des sorties tournaient
        if (b & 0x80) x.restart = false; // écrire 1 dans RESTART l'efface et relance les sorties
        r[0] = b & 0x7f;
      } else if (a === 0xfe) { if (r[0] & 0x10) r[0xfe] = Math.max(3, b); } // PRE_SCALE : en sommeil seulement, 3 au moins
      else if (a >= 0xfa && a <= 0xfd) { for (let n = 0; n < 16; n++) r[6 + 4 * n + (a - 0xfa)] = b; }
      else if (a >= 1 && a <= 0x45) r[a] = b;
      x.ver++;
    };
    const rd = (x, a) => (a === 0 ? x.reg[0] | (x.restart ? 0x80 : 0) : a >= 0xfa && a <= 0xfd ? 0 : x.reg[a]);
    return {
      start(write) { if (write) first = true; },
      write(b) { const x = s(); if (first) { ptr = b & 0xff; first = false; return true; } wr(x, ptr, b & 0xff); adv(x); return true; },
      read() { const x = s(), v = rd(x, ptr); adv(x); return v; },
      stop() { first = false; }
    };
  }
  return null;
}

/* ---------- Pour les effecteurs et les lectures de la carte ---------- */
/**
 * Sortie de puce qui pilote le nœud de (comp, key) dans le montage A : { chip, key, out } ou null. Sert au servo
 * branché sur une voie du PCA9685, et à une entrée de la carte reliée au Q7 d'un 74HC165.
 */
export function chipDriver(A, ref) {
  if (!A || !ref.comp.pins || !ref.comp.pins[ref.key]) return null;
  for (const m of A.wmembers ? A.wmembers(ref) : A.members(ref)) {
    if (!isChip(m.comp.type) || !CHIPS[m.comp.type].outs.includes(m.key)) continue;
    const oe = oeLevel(A, m.comp, () => null), out = chipOut(m.comp, m.key, oe);
    if (out) return { chip: m.comp, key: m.key, out };
  }
  return null;
}
