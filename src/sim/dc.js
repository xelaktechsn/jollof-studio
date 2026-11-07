// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Point de fonctionnement du montage, pour le multimètre virtuel et la simulation : potentiel de
// chaque nœud par rapport à la masse et courant dans chaque dipôle.
// Analyse nodale modifiée (MNA) : une inconnue par nœud, plus le courant de chaque source de
// tension ; élimination de Gauss avec pivot partiel. LED, diodes et transistors sont linéaires par
// morceaux (seuil + résistance) : on itère sur leur état jusqu'à ce qu'il soit cohérent.
// Condensateurs : en continu (sans ctx.dt), circuits ouverts. Avec ctx.dt, le temps avance par pas
// d'Euler implicite (modèle compagnon : conductance C/h en série avec la tension du pas précédent),
// toujours stable même avec de grands pas. L'état est gardé sur le composant (c.dcS) : la
// topologie est refaite à chaque nouvelle analyse, ses éléments ne durent pas.
// Pensé pour les vieux PC des écoles : la topologie est gardée tant que l'analyse (A) ne change
// pas, et les tampons de calcul servent d'un appel à l'autre.
import { DERIVED, SOURCES, base, boardOf, isGnd } from './boards.js';
import { partOf, MOTORS, NPNS } from './parts.js';
import { pid, ohms } from './circuit.js';

// Valeurs du modèle : assez proches du réel pour ce qu'affiche un multimètre, sans plus.
const GMIN = 1e-9;     // fuite de chaque nœud vers la masse : un composant en l'air reste soluble
const R_PWR = 0.05;    // broches 5V / 3V3 d'une carte : régulateur raide
const R_OR = 0.3;      // VIN / VSYS : le 5 V de l'USB passe par une diode, qui ne fait que fournir
const VIN_USB = 4.5;   // VIN d'un Uno/Nano sur USB : 5 V moins la diode interne du régulateur
const R_OUT = 25;      // étage de sortie d'une broche GPIO
const R_PULL = 35e3;   // tirage interne, 20 à 50 kΩ selon la puce
const R_SENS = 1e3;    // sortie d'un capteur ou d'un module
const R_SW = 0.05;     // contact d'un bouton appuyé
const R_POT = 10e3;
const R_REG = 0.1;     // sortie d'un régulateur (LM7805, 5 V du L298N)
const R_BAT = { bat9v: 1.5, bat18650: 0.05, mb102: 0.1 }; // résistance interne
const LED_VF = { 'led-red': 2.0, 'led-yellow': 2.1, 'led-green': 2.2, 'led-blue': 3.0, 'led-white': 3.0 };
const RGB_VF = { R: 2.0, G: 3.1, B: 3.1 }; // LED RVB : vert et bleu InGaN, ≈ 3,1 V
const SEG = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'];
const R_LED = 15, VF_DIODE = 0.7, R_DIODE = 0.5;
// Effecteurs vus comme des charges : buzzer actif, haut-parleur, bobine de relais, servo (au repos / en
// mouvement), moteur pas à pas (bobines alimentées pendant un pas). Les moteurs CC sont dans MOTORS (parts.js).
const R_BUZZER = 170, R_SPEAKER = 8, R_COIL = 70, R_RELAY_IDLE = 5e3, R_SERVO_IDLE = 500, R_SERVO_RUN = 25, R_STEP = 25;
// Pilote L298N : chute de l'étage de sortie haut (transistors bipolaires), niveau bas, résistance de chaque sortie.
const DRV_DROP = 1.4, DRV_LOW = 0.2, R_DRV = 1;
const LED_SEEN = 0.05; // mA : en dessous, une LED ne se voit pas
// Transistor NPN : base-émetteur = seuil + résistance ; collecteur = β·Ib (linéaire) ou petite
// résistance au-dessus de Vce(sat) (saturé). Assez pour un transistor en commutation. β et la
// résistance de saturation dépendent du modèle (NPNS, parts.js : BC547, PN2222A).
const BETA = 200, VBE = 0.65, G_BE = 1 / 50, VCE_SAT = 0.2, G_SAT = 1 / 2;
// Adaptateur de niveau BSS138 : par voie, un MOSFET (grille au LV, source côté LV, drain côté HV) qui
// conduit dans les deux sens quand Vgs dépasse son seuil, sa diode interne, et 10 kΩ de tirage de chaque côté.
const R_SHIFT = 10e3, VTH_FET = 1.3, R_FET = 6, VF_BODY = 0.7;
const STATE = ['off', 'active', 'sat'];
// Condensateurs : capacité, broche +, broche −.
const CAPS = { 'cap-100n': [100e-9, '1', '2'], 'cap-100u': [100e-6, '+', '-'] };
const H_MAX = 0.002, SUB_MAX = 25; // pas de temps maximal (s) ; sous-pas par appel, au plus
const MAXIT = 20, CALM = 8, TOL = 1e-6;
// Broches qu'un module pilote lui-même (sorties de capteur, lignes de données) : ses VCC et GND
// sont ignorées (haute impédance), sa sortie est une source vue de la masse.
const DRIVEN = new Set(['in', 'adc', 'io', 'tx', 'miso', 'sda']);

// Éléments : résistance, diode, source de tension (branche MNA), source de Norton (GPIO, capteur),
// condensateur, transistor NPN (a = C, b = E, c = B ; on = 0 bloqué, 1 linéaire, 2 saturé),
// MOSFET en interrupteur (a, b : drain et source, interchangeables ; c = grille ; on = 0 ou 1).
const RES = 0, DIO = 1, SRC = 2, NOR = 3, CAP = 4, BJT = 5, FET = 6;
// Sources MNA : raide, « à diode » (ne peut que fournir du courant), régulateur (courant pris sur IN).
const STIFF = 0, OR = 1, REG = 2;

const clamp01 = v => (v > 0 ? (v < 1 ? v : 1) : 0);
const fix = (v, eps) => (Math.abs(v) < eps ? 0 : v);
// Tous les éléments ont la même forme : la boucle de calcul reste rapide (accès monomorphes).
// pa, pb, pc : broches du composant derrière a, b, c (courant de chaque broche, animation du courant).
// load : charge d'effecteur (g fixé à chaque calcul d'après son état) ; motor : moteur CC ; gate : rapport cyclique de
// la broche EN d'un pilote (sortie coupée hors de l'impulsion) ; dis : sortie de pilote désactivée ; off : coupée dans la tranche.
const mk = (k, comp, a, b) => ({ k, comp, a, b, c: -1, g: 0, e: 0, r: 0, on: 0, nq: 0, kind: STIFF, min: 0, br: -1, ia: -1, ib: -1, ic: -1, i: 0,
  cap: 0, vc: 0, live: false, act: false, gnd: false, gpio: false, out: false, pu: false, logic: 0, duty: -1, pot: 0, sw: null, key: null, ch: null,
  pa: null, pb: null, pc: null, load: null, motor: false, gate: -1, dis: false, off: false, beta: BETA, gs: G_SAT });
const keys = (e, pa, pb, pc = null) => { e.pa = pa; e.pb = pb; e.pc = pc; return e; };

/* ---------- Topologie : ne dépend que de l'analyse, gardée tant qu'elle ne change pas ---------- */
const CACHE = new WeakMap();

function topology(comps, A, profOf) {
  const old = CACHE.get(A);
  if (old && old.comps === comps && old.len === comps.length) return old;
  const nets = new Map(), els = [], cands = [], byComp = new Map(), regs = new Map(), leds = [], drivers = [];
  let nn = 0;
  // Nœud d'une broche : les broches reliées (fils, bandes de breadboard) partagent le même tableau A.members.
  const net = (comp, key) => {
    if (!comp.pins || !comp.pins[key]) return -1;
    const m = A.members({ comp, key });
    if (!m.length) return -1;
    let i = nets.get(m);
    if (i === undefined) nets.set(m, (i = nn++));
    return i;
  };
  const push = e => { if (e.a < 0 || (!e.gnd && e.b < 0) || ((e.kind === REG || e.k === BJT || e.k === FET) && e.c < 0)) return null; e.i = els.length; els.push(e); return e; };
  const two = (k, c, ka, kb) => push(keys(mk(k, c, net(c, ka), net(c, kb)), ka, kb));
  const diode = (c, ka, kk, vf, r, ch = null) => { const e = keys(mk(DIO, c, net(c, ka), net(c, kk)), ka, kk); e.g = 1 / r; e.e = vf; e.ch = ch; return push(e); };
  const source = (c, ka, kb, v, r, kind) => { const e = keys(mk(SRC, c, net(c, ka), net(c, kb)), ka, kb); e.e = v; e.r = r; e.kind = kind; e.on = 1; return push(e); };

  function board(c, p) {
    let gnd = -1, gk = null;
    for (const k in c.pins) if (isGnd(p, base(k)) && (gnd = net(c, k)) >= 0) { gk = k; break; }
    if (gnd < 0) return; // sans masse, rien ne se mesure par rapport à cette carte
    cands.push(gnd, 0);
    const done = new Set(), dio = p.diode || [];
    for (const k in c.pins) {
      const b = base(k), v = p.power[b], avrVin = v == null && !!p.vin && p.vin.pin === b;
      if ((v == null && !avrVin) || done.has(b)) continue;
      done.add(b);
      const or = avrVin || dio.includes(b);
      // VIN / VSYS ne reçoit le 5 V de l'USB que si rien d'autre ne l'alimente (sinon la carte est sur pile).
      if (or && A.net({ comp: c, key: k }).src.some(s => s.comp !== c)) continue;
      source(c, k, gk, avrVin ? VIN_USB : v, or ? R_OR : R_PWR, or ? OR : STIFF);
    }
    // Une GPIO par numéro : A4 et SDA d'un Uno sont la même broche, au nom qu'emploie le programme.
    const seen = new Map();
    for (const k in p.gpio) {
      const g = p.gpio[k], i = net(c, k), e = seen.get(g.n);
      if (e) { if (e.a < 0) { e.a = i; e.pa = k; } continue; }
      const x = keys(mk(NOR, c, i, gnd), k, gk);
      x.gpio = true; x.key = k; x.out = g.caps.has('out'); x.pu = g.caps.has('pu'); x.logic = p.logic;
      seen.set(g.n, x);
    }
    for (const x of seen.values()) push(x);
  }

  /** Composants modélisés physiquement ; false : ses sorties de module restent à traiter. */
  function part(c) {
    const t = c.type, r = ohms(t), vf = LED_VF[t], src = SOURCES[t], reg = DERIVED[t], cp = CAPS[t];
    if (r > 0) { const e = two(RES, c, '1', '2'); if (e) { e.g = 1 / r; byComp.set(c, e); } return true; }
    if (vf) { const e = diode(c, 'A', 'K', vf, R_LED); if (e) byComp.set(c, e); leds.push({ comp: c, els: e ? [e] : [], multi: false }); return true; }
    if (t === 'diode') { const e = diode(c, 'A', 'K', VF_DIODE, R_DIODE); if (e) byComp.set(c, e); return true; }
    if (cp) { const e = two(CAP, c, cp[1], cp[2]); if (e) { e.cap = cp[0]; byComp.set(c, e); } return true; }
    if (NPNS[t]) {
      const e = keys(mk(BJT, c, net(c, 'C'), net(c, 'E')), 'C', 'E', 'B');
      e.c = net(c, 'B'); e.beta = NPNS[t].beta; e.gs = 1 / NPNS[t].rsat;
      if (push(e)) byComp.set(c, e);
      return true;
    }
    if (t === 'lvlshift') {
      // Voies câblées seulement : une voie libre n'ajoute que des nœuds inutiles au calcul.
      const lv = net(c, 'LV');
      for (let i = 1; i <= 4; i++) {
        const kl = 'LV' + i, kh = 'HV' + i;
        if (A.members({ comp: c, key: kl }).length < 2 && A.members({ comp: c, key: kh }).length < 2) continue;
        const pl = two(RES, c, kl, 'LV'), ph = two(RES, c, kh, 'HV');
        if (pl) pl.g = 1 / R_SHIFT; if (ph) ph.g = 1 / R_SHIFT;
        const f = keys(mk(FET, c, net(c, kl), net(c, kh)), kl, kh, null);
        f.c = lv; f.g = 1 / R_FET; f.e = VTH_FET; push(f);
        diode(c, kl, kh, VF_BODY, R_DIODE);
      }
      return true;
    }
    if (t === 'led-rgb' || t === '7seg') {
      const list = t === 'led-rgb' ? ['R', 'G', 'B'] : SEG, com = t === 'led-rgb' ? 'GND' : 'COM';
      leds.push({ comp: c, els: list.map(k => diode(c, k, com, t === 'led-rgb' ? RGB_VF[k] : 2.0, R_LED, k)).filter(Boolean), multi: true });
      return true;
    }
    // Le courant d'un bouton n'est pas exposé : appuyé, l'analyse fond déjà ses deux pattes en un seul nœud.
    if (t === 'button') { const e = two(RES, c, '1', '2'); if (e) e.sw = 'pressed'; return true; }
    if (t === 'pot') {
      // Curseur à 100 % : W rejoint la patte 3 (même convention que models.js).
      const lo = two(RES, c, '1', 'W'), hi = two(RES, c, 'W', '3');
      if (lo) lo.pot = 1; if (hi) hi.pot = 2;
      return true;
    }
    if (t === 'joystick') { const e = two(RES, c, 'SW', 'GND'); if (e) e.sw = 'sw'; return false; }
    const mot = MOTORS[t];
    if (mot) { const e = two(RES, c, mot.plus, mot.minus); if (e) { e.g = 1 / mot.r; e.motor = true; byComp.set(c, e); } return true; }
    if (t === 'buzzer' || t === 'speaker') { const e = two(RES, c, '+', '-'); if (e) { e.g = 1 / (t === 'buzzer' ? R_BUZZER : R_SPEAKER); e.load = t; byComp.set(c, e); } return true; }
    if (t === 'servo' || t === 'stepper' || t === 'relay') {
      // Alimentation du module : une charge entre VCC et GND, selon ce qu'il fait (bobine collée, servo qui tourne…).
      const e = two(RES, c, 'VCC', 'GND'); if (e) { e.load = t; byComp.set(c, e); }
      if (t === 'relay' && c.pins.COM) {
        // Contacts du relais : COM–NO fermé quand la bobine est alimentée, COM–NC au repos (comme un bouton).
        const no = two(RES, c, 'COM', 'NO'), nc = two(RES, c, 'COM', 'NC');
        if (no) no.sw = 'relayOn'; if (nc) nc.sw = 'relayOff';
      }
      return false; // leurs entrées de commande restent des entrées (haute impédance)
    }
    if (src) {
      const gk = Object.keys(src).find(k => !src[k]), m = net(c, gk);
      if (m >= 0) cands.push(m, 1);
      for (const k in src) if (src[k]) { const e = source(c, k, gk, src[k], R_BAT[t] ?? 0.1, STIFF); if (e && k === '+') byComp.set(c, e); }
      return true;
    }
    if (reg) {
      // Régulateur linéaire : OUT tenu à v au-dessus de GND, le courant de sortie est pris sur IN.
      const e = keys(mk(SRC, c, net(c, reg.out), net(c, 'GND')), reg.out, 'GND', reg.from);
      e.c = net(c, reg.from); e.e = reg.v; e.r = R_REG; e.kind = REG; e.min = reg.min; e.on = 1;
      if (push(e)) regs.set(c, e);
    }
    if (t === 'l298n') l298n(c);
    return false;
  }

  /**
   * Pilote L298N : chaque sortie reliée est un demi-pont, haut (tension des moteurs moins sa chute, courant pris
   * sur +12V) ou bas (près de GND), selon son entrée IN ; EN coupe les deux sorties de la voie (PWM : vitesse).
   * Les niveaux de IN et EN se lisent à chaque calcul (prepare) : broche de la carte, alimentation ou masse.
   */
  function l298n(c) {
    const g = net(c, 'GND'), vin = net(c, '+12V');
    if (g < 0 || vin < 0) return;
    const vs = Math.max(0, ...A.net({ comp: c, key: '+12V' }).src.map(s => s.v));
    const ctl = key => {
      if (!c.pins[key]) return null;
      const r = { comp: c, key }, n = A.net(r);
      if (n.gpio[0]) return { gpio: n.gpio[0] };
      if (n.src.length) return { fixed: 1 };
      if (n.gnd.length) return { fixed: 0 };
      return A.members(r).length > 1 ? { fixed: 0 } : null; // relié à rien de connu : bas ; non câblé : null
    };
    for (const [o1, o2, i1, i2, en] of [['OUT1', 'OUT2', 'IN1', 'IN2', 'ENA'], ['OUT3', 'OUT4', 'IN3', 'IN4', 'ENB']]) {
      const outs = [];
      for (const [o, i] of [[o1, i1], [o2, i2]]) {
        const n = net(c, o);
        if (n < 0 || A.members({ comp: c, key: o }).length < 2) continue;
        const hi = keys(mk(SRC, c, n, g), o, 'GND', '+12V');
        hi.c = vin; hi.e = Math.max(0, vs - DRV_DROP); hi.r = R_DRV; hi.kind = REG; hi.min = 2; hi.on = 1;
        const lo = source(c, o, 'GND', DRV_LOW, R_DRV, STIFF);
        if (push(hi) && lo) outs.push({ hi, lo, in: ctl(i) });
      }
      // EN non câblé : cavalier en place, voie toujours active.
      if (outs.length) drivers.push({ en: c.pins[en] && A.members({ comp: c, key: en }).length > 1 ? ctl(en) : { fixed: 1 }, outs });
    }
  }

  for (const c of comps) {
    if (!c || !c.pins) continue;
    const p = profOf(c);
    if (p) { if (p.power && p.gpio) board(c, p); continue; }
    const spec = partOf(c);
    // Consommation d'un module sur son alimentation (fiche technique, parts.js ma) : une charge entre VCC et GND,
    // dimensionnée à la tension nominale. Elle compte dans le courant des broches 5V et 3V3 de la carte.
    if (spec && spec.ma > 0 && spec.pins) {
      const vp = spec.pins.find(q => q.kind === 'pwr'), gp = spec.pins.find(q => q.kind === 'gnd');
      if (vp && gp && c.pins[vp.pin] && c.pins[gp.pin]) {
        const vn = Array.isArray(vp.v) ? Math.min(5, vp.v[1]) : 3.3, e = two(RES, c, vp.pin, gp.pin);
        if (e) { e.g = spec.ma / 1000 / vn; e.load = 'supply'; }
      }
    }
    if (part(c)) continue;
    if (spec && spec.pins) for (const q of spec.pins) {
      if (q.kind !== 'io' || !DRIVEN.has(q.need) || (c.type === 'joystick' && q.pin === 'SW')) continue;
      const e = keys(mk(NOR, c, net(c, q.pin), -1), q.pin, null);
      e.gnd = true; e.key = q.pin; e.g = 1 / R_SENS;
      push(e);
    }
  }

  // Îlots du montage (tous les éléments, quel que soit leur état) : chacun prend sa propre référence,
  // masse d'une carte d'abord, sinon le − d'une pile. Un îlot sans source n'est pas calculé.
  const up = new Int32Array(nn);
  for (let i = 0; i < nn; i++) up[i] = i;
  const find = i => { while (up[i] !== i) i = up[i] = up[up[i]]; return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) up[a] = b; };
  for (const e of els) if (!e.gnd) { join(e.a, e.b); if (e.c >= 0) join(e.c, e.b); }
  const best = new Int32Array(nn).fill(-1), pri = new Int8Array(nn), sens = new Uint8Array(nn);
  for (let j = 0; j < cands.length; j += 2) {
    const root = find(cands[j]);
    if (best[root] < 0 || cands[j + 1] < pri[root]) { best[root] = cands[j]; pri[root] = cands[j + 1]; }
  }
  for (const e of els) if (e.gnd) sens[find(e.a)] = 1;
  const isRef = new Uint8Array(nn), solv = new Uint8Array(nn);
  let anyRef = false;
  for (let i = 0; i < nn; i++) {
    const root = find(i);
    if (best[root] >= 0) { solv[i] = 1; anyRef = true; if (best[root] === i) isRef[i] = 1; }
    else if (sens[root]) solv[i] = 1; // capteur seul : sa sortie est donnée par rapport à la masse
  }
  const caps = els.filter(e => e.k === CAP), bjts = els.filter(e => e.k === BJT);
  const T = { comps, len: comps.length, nets, nn, els, byComp, regs, leds, drivers, isRef, solv, anyRef, idx: new Int32Array(nn),
    sw: els.filter(e => e.k === DIO || e.k === BJT || e.k === FET || (e.k === SRC && e.kind !== STIFF)),
    caps, bjts, dyn: caps.length > 0 || bjts.length > 0, duties: [] };
  CACHE.set(A, T);
  return T;
}

/* ---------- Valeurs de l'instant : programme, capteurs, boutons, potentiomètres, état gardé ---------- */
function pinDrive(e, st) {
  if (!st) return; // aucun programme : haute impédance
  const m = st.mode;
  if (m === 1) {
    if (!e.out) return; // entrée seulement (D34 d'un ESP32…) : OUTPUT n'y fait rien
    e.act = true; e.g = 1 / R_OUT;
    // Un multimètre lit la moyenne : tone() est un carré à 50 %, analogWrite() une PWM, un servo une impulsion
    // de 0,544 à 2,4 ms toutes les 20 ms selon l'angle.
    e.duty = st.servo != null ? pulseDuty(st.servo) : st.freq > 0 ? 0.5 : st.pwm != null ? clamp01(+st.pwm || 0) : st.d ? 1 : 0;
  } else if (e.pu && (m === 2 || m === 3 || (m === 0 && st.weak))) {
    // digitalWrite(HIGH) sur une entrée (st.weak) n'active que le tirage, comme sur un AVR.
    e.act = true; e.g = 1 / R_PULL; e.e = m === 3 ? 0 : e.logic;
  }
}

/** Rapport cyclique de l'impulsion d'un servo à l'angle a (période 20 ms). */
export const pulseDuty = a => (0.544 + clamp01(a / 180) * 1.856) / 20;
/** Part du temps à l'état haut d'une broche de carte (programme), 0 si elle n'est pas en sortie. */
const highTime = st => (!st || st.mode !== 1 ? 0 : st.freq > 0 ? 0.5 : st.pwm != null ? clamp01(+st.pwm || 0) : st.d ? 1 : 0);
/** Charge d'un effecteur selon son état du moment. */
function loadG(e) {
  const c = e.comp;
  switch (e.load) {
    case 'relay': return 1 / (c.relayOn ? R_COIL : R_RELAY_IDLE);
    case 'servo': return 1 / (c.servoBusy ? R_SERVO_RUN : R_SERVO_IDLE);
    case 'stepper': return c.stepBusy ? 1 / R_STEP : 0;
    default: return e.g;
  }
}

function prepare(T, ctx) {
  const ps = typeof ctx.pinState === 'function' ? ctx.pinState : null;
  const sv = typeof ctx.sensorVolts === 'function' ? ctx.sensorVolts : null;
  let any = T.anyRef;
  for (const e of T.els) {
    e.off = false;
    if (e.k === RES) {
      const inp = e.comp.inp || {};
      if (e.pot) {
        const p = Number.isFinite(+inp.pos) ? clamp01(+inp.pos / 100) : 0.5;
        e.g = 1 / Math.max(1, R_POT * (e.pot === 1 ? p : 1 - p)); // résistance de butée : jamais 0 Ω
      } else if (e.sw === 'relayOn' || e.sw === 'relayOff') e.g = !!e.comp.relayOn === (e.sw === 'relayOn') ? 1 / R_SW : 0;
      else if (e.sw) e.g = inp[e.sw] ? 1 / R_SW : 0;
      else if (e.load) e.g = loadG(e);
    } else if (e.k === NOR) {
      e.act = false; e.duty = -1;
      if (e.gpio) { if (ps) pinDrive(e, ps(e.comp, e.key)); }
      else if (sv) {
        const v = sv(e.comp, e.key);
        if (typeof v === 'number' && Number.isFinite(v)) { e.act = true; e.e = v; any = true; }
      }
    } else if (e.k === CAP) {
      const s = e.comp.dcS;
      e.vc = s && Number.isFinite(s.v) ? s.v : 0; // condensateur neuf : déchargé
    } else if (e.k === BJT) {
      const s = e.comp.dcS;
      if (s && (s.q === 0 || s.q === 1 || s.q === 2)) e.on = s.q; // départ : l'état du pas précédent
    }
  }
  // Pilotes de moteurs : chaque sortie suit son entrée, EN coupe ou découpe (PWM) la voie.
  const level = (r, def) => (!r ? def : r.fixed != null ? r.fixed : ps ? highTime(ps(r.gpio.comp, r.gpio.key)) : 0);
  for (const d of T.drivers) {
    const en = level(d.en, 1);
    for (const o of d.outs) {
      const high = level(o.in, 0) > 0.5;
      o.hi.dis = !(en > 0 && high); o.lo.dis = !(en > 0 && !high);
      o.hi.gate = o.lo.gate = en > 0 && en < 1 ? en : -1;
      if (!o.hi.dis) o.hi.on = 1;
    }
  }
  return any;
}

/* ---------- Calcul : tampons partagés, agrandis au besoin ---------- */
let SIZE = 0, M = null, X = null, NZ = null, UP = null, VACC = null, DET = null;
function room(N) {
  if (N <= SIZE) return;
  SIZE = Math.max(N, SIZE * 2, 32);
  M = new Float64Array(SIZE * SIZE); X = new Float64Array(SIZE); NZ = new Int32Array(SIZE);
  UP = new Int32Array(SIZE + 1); VACC = new Float64Array(SIZE); DET = new Uint8Array(SIZE);
}
const pv = i => (i >= 0 ? X[i] : 0); // potentiel d'un nœud (-1 : la masse)
const ufind = i => { while (UP[i] !== i) i = UP[i] = UP[UP[i]]; return i; };
const unite = (a, b, n) => { a = ufind(a < 0 ? n : a); b = ufind(b < 0 ? n : b); if (a !== b) UP[a] = b; };

/** Conductance g entre a et b, en série avec une f.é.m. (seuil d'une diode, niveau d'une broche, tension d'un condensateur). */
function cond(N, a, b, g, emf) {
  const ge = g * emf;
  if (a >= 0) { M[a * N + a] += g; X[a] += ge; }
  if (b >= 0) { M[b * N + b] += g; X[b] -= ge; }
  if (a >= 0 && b >= 0) { M[a * N + b] -= g; M[b * N + a] -= g; }
}

function stamp(T, n, N) {
  M.fill(0, 0, N * N); X.fill(0, 0, N);
  for (let i = 0; i < n; i++) M[i * N + i] = GMIN;
  for (const e of T.els) {
    if (!e.live) continue;
    const a = e.ia, b = e.ib;
    if (e.k === SRC) {
      // Courant de branche I sorti par + (ou par OUT) et rentré par − (ou par IN) ; Va − Vb + r·I = v.
      const k = e.br, kk = k * N;
      if (a >= 0) M[a * N + k] -= 1;
      if (e.ic >= 0) M[e.ic * N + k] += 1;
      if (e.on && !e.off) { if (a >= 0) M[kk + a] += 1; if (b >= 0) M[kk + b] -= 1; M[kk + k] = e.r; X[k] = e.e; }
      else M[kk + k] = 1; // bloquée ou coupée par EN : I = 0
      continue;
    }
    if (e.k === BJT) {
      if (!e.on) continue; // bloqué : aucun courant
      const c = e.ic;
      cond(N, c, b, G_BE, VBE); // jonction base-émetteur
      if (e.on === 2) { cond(N, a, b, e.gs, VCE_SAT); continue; }
      // Linéaire : source de courant commandée Ic = β·Ib = k·(Vb − Ve − Vbe), du collecteur vers
      // l'émetteur. La matrice n'est plus symétrique, le pivot partiel de gauss() le supporte.
      const k = e.beta * G_BE, kv = k * VBE;
      if (a >= 0) { if (c >= 0) M[a * N + c] += k; if (b >= 0) M[a * N + b] -= k; X[a] += kv; }
      if (b >= 0) { if (c >= 0) M[b * N + c] -= k; M[b * N + b] += k; X[b] -= kv; }
      continue;
    }
    if (e.k === FET) { if (e.on) cond(N, a, b, e.g, 0); continue; }
    if (e.k === DIO && !e.on) continue;
    cond(N, a, b, e.g, e.e);
  }
}

/** Élimination de Gauss avec pivot partiel, sur place : X reçoit la solution. */
function gauss(N) {
  for (let k = 0; k < N; k++) {
    const kk = k * N;
    let p = k, best = Math.abs(M[kk + k]);
    for (let i = k + 1; i < N; i++) { const a = Math.abs(M[i * N + k]); if (a > best) { best = a; p = i; } }
    if (best < 1e-300) continue; // colonne vide : l'inconnue restera à 0
    if (p !== k) {
      const pp = p * N;
      for (let j = k; j < N; j++) { const t = M[kk + j]; M[kk + j] = M[pp + j]; M[pp + j] = t; }
      const t = X[k]; X[k] = X[p]; X[p] = t;
    }
    // La matrice d'un montage est très creuse : on ne parcourt que les colonnes utiles du pivot.
    let m = 0;
    for (let j = k + 1; j < N; j++) if (M[kk + j] !== 0) NZ[m++] = j;
    const piv = M[kk + k], xk = X[k];
    for (let i = k + 1; i < N; i++) {
      const ik = i * N, f = M[ik + k];
      if (f === 0) continue;
      const r = f / piv;
      M[ik + k] = 0;
      for (let t = 0; t < m; t++) M[ik + NZ[t]] -= r * M[kk + NZ[t]];
      X[i] -= r * xk;
    }
  }
  for (let k = N - 1; k >= 0; k--) {
    const kk = k * N, piv = M[kk + k];
    if (Math.abs(piv) < 1e-300) { X[k] = 0; continue; }
    let s = X[k];
    for (let j = k + 1; j < N; j++) s -= M[kk + j] * X[j];
    X[k] = s / piv;
  }
}

/** Bascule les éléments dont l'état contredit la solution ; au-delà de CALM essais, le pire seul (évite les oscillations). */
function flip(T, worstOnly) {
  let n = 0, wv = 0, we = null;
  for (const e of T.sw) {
    if (!e.live || e.off) continue;
    let d, nq = e.on ^ 1;
    if (e.k === DIO) { d = pv(e.ia) - pv(e.ib) - e.e; if (e.on) d = -d; }
    else if (e.k === BJT) {
      const vbe = pv(e.ic) - pv(e.ib);
      if (!e.on) d = vbe - VBE; // la base conduit : linéaire d'abord, la saturation se voit au tour suivant
      else {
        d = VBE - vbe; nq = 0; // courant de base négatif : bloqué
        const vce = pv(e.ia) - pv(e.ib);
        // Linéaire sous Vce(sat) : saturé. Saturé avec Ic > β·Ib (en mA) : la base ne suffit plus, linéaire.
        const s = e.on === 1 ? VCE_SAT - vce : (e.gs * (vce - VCE_SAT) - e.beta * G_BE * (vbe - VBE)) * 1e3;
        if (s > d) { d = s; nq = e.on === 1 ? 2 : 1; }
      }
    }
    else if (e.k === FET) { d = pv(e.ic) - Math.min(pv(e.ia), pv(e.ib)) - e.e; if (e.on) d = -d; } // Vgs, côté le plus bas = source
    else if (e.kind === OR) d = e.on ? -X[e.br] * 1e3 : e.e - (pv(e.ia) - pv(e.ib));
    else { d = pv(e.ic) - pv(e.ib) - e.min; if (e.on) d = -d; } // régulateur : il lui faut min volts sur IN
    if (d <= TOL) continue;
    n++; e.nq = nq;
    if (!worstOnly) e.on = nq;
    else if (d > wv) { wv = d; we = e; }
  }
  if (we) we.on = we.nq;
  return n;
}

/** Courant de l'élément (A), de a vers b ; sortant par + pour une source ; Ic pour un transistor. */
function amps(e) {
  if (e.k === SRC) return e.on && !e.off ? X[e.br] : 0;
  if (e.k === DIO) return e.on ? Math.max(0, e.g * (pv(e.ia) - pv(e.ib) - e.e)) : 0;
  if (e.k === BJT) return !e.on ? 0 : e.on === 1 ? e.beta * G_BE * (pv(e.ic) - pv(e.ib) - VBE) : e.gs * (pv(e.ia) - pv(e.ib) - VCE_SAT);
  if (e.k === FET) return e.on ? e.g * (pv(e.ia) - pv(e.ib)) : 0;
  // Résistance, condensateur (compagnon), GPIO et capteur (Norton) : g·(Va − Vb − e).
  return e.g * (pv(e.ia) - pv(e.ib) - e.e);
}
const baseAmps = e => (e.on ? G_BE * (pv(e.ic) - pv(e.ib) - VBE) : 0);

/**
 * Une phase (niveaux des broches fixés) : itère jusqu'à des états stables, puis ajoute la solution pondérée par w.
 * I : courants [0, L), courant de base des transistors [L, 2L), état des transistors [2L, 3L) noté si rec.
 */
function phase(T, n, N, w, I, rec) {
  let it = 0;
  for (;;) { it++; stamp(T, n, N); gauss(N); if (it >= MAXIT || !flip(T, it > CALM)) break; }
  // Un nœud n'est « mesurable » que s'il rejoint la masse par des éléments qui conduisent.
  for (let i = 0; i <= n; i++) UP[i] = i;
  for (const e of T.els) {
    if (!e.live) continue;
    if (e.k === BJT) { if (e.on) { unite(e.ic, e.ib, n); if (e.on === 2) unite(e.ia, e.ib, n); } continue; }
    if ((e.k === DIO || e.k === SRC || e.k === FET) && (!e.on || e.off)) continue;
    unite(e.ia, e.ib, n);
  }
  const g = ufind(n), L = T.els.length;
  for (let i = 0; i < n; i++) { VACC[i] += w * X[i]; if (ufind(i) === g) DET[i] = 1; }
  for (const e of T.els) {
    if (!e.live) continue;
    I[e.i] += w * amps(e);
    if (e.k === BJT) { I[L + e.i] += w * baseAmps(e); if (rec) I[2 * L + e.i] = e.on; }
  }
  return it;
}

function run(T, Vn, I, dt, maxSub) {
  const { els, idx, nn, caps, duties } = T, L = els.length;
  for (let i = 0; i < nn; i++) idx[i] = T.isRef[i] ? -1 : T.solv[i] ? -2 : -3;
  // Inconnues de cet instant : seuls les nœuds touchés par un élément actif entrent dans la matrice.
  // En continu, un condensateur est ouvert : il n'entre pas.
  let n = 0;
  for (const e of els) {
    e.live = idx[e.a] !== -3 && !e.dis && (e.k === RES ? e.g > 0 : e.k === NOR ? e.act : e.k === CAP ? dt > 0 : true);
    if (!e.live) continue;
    if (idx[e.a] === -2) idx[e.a] = n++;
    if (!e.gnd && idx[e.b] === -2) idx[e.b] = n++;
    if (e.c >= 0 && idx[e.c] === -2) idx[e.c] = n++;
  }
  let N = n;
  for (const e of els) {
    if (!e.live) continue;
    e.ia = idx[e.a]; e.ib = e.gnd ? -1 : idx[e.b]; e.ic = e.c >= 0 ? idx[e.c] : e.ib;
    if (e.k === SRC) e.br = N++;
  }
  room(N);
  // PWM : les sorties d'une carte montent ensemble en début de période. On découpe la période
  // aux rapports cycliques, on résout chaque tranche et on moyenne, comme l'affiche un multimètre.
  duties.length = 0;
  for (const e of els) if (e.live) for (const x of [e.duty, e.gate]) if (x > 0 && x < 1 && !duties.includes(x)) duties.push(x);
  duties.sort((a, b) => a - b);
  // La tranche la plus longue donne l'état affiché des transistors.
  let rec = 0, wmax = 0, t0 = 0;
  for (let s = 0; s <= duties.length; s++) { const t1 = s < duties.length ? duties[s] : 1; if (t1 - t0 > wmax) { wmax = t1 - t0; rec = s; } t0 = t1; }
  // Transitoire : sous-pas d'au plus H_MAX, bornés par maxSub (sur un vieux PC, la fluidité passe
  // avant la précision ; Euler implicite reste stable avec de grands pas).
  const nsub = dt > 0 && caps.length ? Math.min(maxSub, Math.ceil(dt / H_MAX)) : 1, h = dt / nsub;
  for (const e of caps) if (e.live) e.g = e.cap / h;
  let its = 0;
  for (let sub = 0; sub < nsub; sub++) {
    for (const e of caps) e.e = e.vc;
    VACC.fill(0, 0, n); DET.fill(0, 0, n); I.fill(0);
    let it = 0;
    t0 = 0;
    for (let s = 0; s <= duties.length; s++) {
      const t1 = s < duties.length ? duties[s] : 1;
      if (t1 - t0 > 1e-9) {
        for (const e of els) if (e.live) { if (e.duty >= 0) e.e = e.duty > t0 ? e.logic : 0; if (e.gate >= 0) e.off = !(e.gate > t0); }
        it += phase(T, n, N, t1 - t0, I, s === rec);
      }
      t0 = t1;
    }
    if (it > its) its = it;
    // Le condensateur avance d'un pas : vc = e + I/g, avec le courant moyen du pas (PWM comprise).
    for (const e of caps) if (e.live) e.vc = e.e + I[e.i] / e.g;
  }
  for (const e of caps) I[L + e.i] = dt > 0 ? e.vc : NaN; // NaN : en continu, capV lit les potentiels
  for (let i = 0; i < nn; i++) { const j = idx[i]; if (j === -1) Vn[i] = 0; else if (j >= 0 && DET[j]) Vn[i] = VACC[j]; }
  return its;
}

/** Garde l'état sur le composant, sans allouer une fois créé. */
function save(c, v, q) {
  const s = c.dcS;
  if (s) { s.v = v; s.q = q; } else c.dcS = { v, q };
}
function commit(T, Vn) {
  for (const e of T.caps) save(e.comp, e.vc, 0);
  for (const e of T.bjts) {
    if (!e.live) continue;
    const vce = Vn[e.a] - Vn[e.b];
    save(e.comp, vce === vce ? vce : 0, e.on);
  }
}

/** Courant (mA) que chaque broche envoie dans son nœud : + quand il sort du composant vers les fils. */
function injections(T, I, ok) {
  const m = new Map();
  if (!ok) return m;
  const L = T.els.length;
  const add = (c, k, x) => { if (k === null || x === 0) return; const id = pid(c, k); m.set(id, (m.get(id) || 0) + x); };
  for (const e of T.els) {
    const x = I[e.i] * 1e3, c = e.comp;
    if (e.k === SRC) { add(c, e.pa, x); add(c, e.kind === REG ? e.pc : e.pb, -x); }
    else if (e.k === BJT) { const ib = I[L + e.i] * 1e3; add(c, e.pa, -x); add(c, e.pc, -ib); add(c, e.pb, x + ib); }
    else { add(c, e.pa, -x); add(c, e.pb, x); } // entre par a, ressort par b
  }
  return m;
}

/* ---------- Résultat ---------- */
function result(T, A, ok, Vn, I, its) {
  const L = T.els.length;
  const mA = e => fix(I[e.i] * 1e3, 1e-4); // sous 0,1 µA : fuite gmin, pas une mesure
  const at = i => (ok && i >= 0 && Vn[i] === Vn[i] ? Vn[i] : null);
  const diff = (a, b) => { const x = at(a), y = at(b); return x === null || y === null ? null : fix(x - y, 1e-6); };
  const leds = new Map();
  for (const d of T.leds) {
    if (!d.multi) { const x = d.els[0] ? mA(d.els[0]) : 0; leds.set(d.comp, { on: x >= LED_SEEN, mA: x }); continue; }
    // LED RGB, afficheur 7 segments : une diode par couleur ou segment, détaillée dans ch.
    const ch = {};
    let sum = 0, on = false;
    for (const e of d.els) { const x = mA(e); ch[e.ch] = { on: x >= LED_SEEN, mA: x }; sum += x; on = on || x >= LED_SEEN; }
    leds.set(d.comp, { on, mA: sum, ch });
  }
  // Tension d'un condensateur : son état en transitoire, sinon (continu) la différence des potentiels.
  const capV = comp => {
    const e = T.byComp.get(comp);
    if (!e || e.k !== CAP) return null;
    const v = I[L + e.i];
    return v === v ? fix(v, 1e-6) : diff(e.a, e.b);
  };
  let inj = null;
  return {
    ok,
    dyn: T.dyn,
    volts(ref) {
      if (!ok || !ref || !ref.comp || !ref.comp.pins || !ref.comp.pins[ref.key]) return null;
      const i = T.nets.get(A.members(ref));
      return i === undefined || Vn[i] !== Vn[i] ? null : fix(Vn[i], 1e-6);
    },
    current(comp) { const e = T.byComp.get(comp); return e ? mA(e) : null; },
    capV,
    across(comp) {
      const e = T.byComp.get(comp) || T.regs.get(comp);
      if (!e) { const l = leds.get(comp); return l ? { v: null, mA: l.mA, kind: 'led', extra: { on: l.on, ch: l.ch || null } } : null; }
      const x = mA(e);
      switch (e.k) {
        case RES: return { v: diff(e.a, e.b), mA: x, kind: e.motor ? 'motor' : e.load || 'res', extra: { ohms: e.g > 0 ? 1 / e.g : Infinity } };
        case DIO: { const l = leds.get(comp); return { v: diff(e.a, e.b), mA: x, kind: l ? 'led' : 'diode', extra: l ? { on: l.on } : null }; }
        case CAP: return { v: capV(comp), mA: x, kind: 'cap', extra: { farads: e.cap } };
        case BJT: {
          const vce = diff(e.a, e.b);
          return { v: vce, mA: x, kind: 'npn', extra: { ic: x, ib: fix(I[L + e.i] * 1e3, 1e-4), vce, vbe: diff(e.c, e.b), state: STATE[I[2 * L + e.i]] || 'off' } };
        }
        default: return { v: diff(e.a, e.b), mA: x, kind: e.kind === REG ? 'reg' : 'bat', extra: null };
      }
    },
    injections() { return inj || (inj = injections(T, I, ok)); },
    leds,
    iterations: its
  };
}

const none = () => ({ ok: false, dyn: false, volts: () => null, current: () => null, capV: () => null, across: () => null, injections: () => new Map(), leds: new Map(), iterations: 0 });
let warned = false;

/**
 * Point de fonctionnement du montage.
 * ctx : { prof(comp), pinState(comp, key) → { mode, d, pwm } | null, sensorVolts(comp, key) → volts | null,
 *         dt (s de temps virtuel depuis le calcul précédent ; absent : continu, condensateurs ouverts),
 *         commit (écrit l'état des condensateurs et transistors sur les composants, c.dcS),
 *         maxSub (sous-pas au plus, 25 par défaut) }.
 * Retourne { ok, dyn (condensateur ou transistor présent), volts(ref), current(comp) en mA,
 *            capV(comp) en V, across(comp) → { v, mA, kind, extra }, injections() → Map pid → mA,
 *            leds: Map comp → { on, mA }, iterations }.
 */
export function solveDC(comps, A, ctx) {
  try {
    const c = ctx || {}, T = topology(comps, A, typeof c.prof === 'function' ? c.prof : boardOf);
    const dt = c.dt > 0 ? +c.dt : 0, maxSub = c.maxSub >= 1 ? Math.floor(c.maxSub) : SUB_MAX;
    const ok = prepare(T, c), L = T.els.length, Vn = new Float64Array(T.nn).fill(NaN), I = new Float64Array(3 * L);
    for (const e of T.caps) I[L + e.i] = dt > 0 ? e.vc : NaN;
    const its = ok ? run(T, Vn, I, dt, maxSub) : 0;
    if (ok && dt > 0 && c.commit) commit(T, Vn);
    return result(T, A, ok, Vn, I, its);
  } catch (err) {
    // Appelé à chaque image : un montage inattendu ne doit jamais casser l'affichage.
    if (!warned) { warned = true; console.warn('solveDC :', err); }
    return none();
  }
}

/** Oublie l'état des condensateurs et transistors (arrêt de la simulation, autre projet). */
export function resetDynamic(comps) {
  for (const c of comps || []) if (c && c.dcS) c.dcS = null;
}

/* ---------- Comparaison avec ngspice (src/sim/spice.test.mjs) ---------- */
const VT = 0.025852; // tension thermique à 27 °C
/**
 * Le montage, tel que le voit ce solveur, écrit pour ngspice (analyse .op). mode :
 *   'pwl'  : mêmes modèles par morceaux que le solveur (diodes quasi idéales avec seuil et résistance, transistors
 *            et MOSFET dans l'état trouvé) : ngspice doit retrouver les mêmes tensions, au millivolt près ;
 *   'phys' : modèles physiques de ngspice (diode exponentielle, NPN de Gummel-Poon, MOSFET niveau 1) réglés sur
 *            les mêmes paramètres : l'écart mesure l'erreur des modèles simplifiés.
 * Rend { text, probes: [{ node, ref, members }] } (ref : une broche du nœud, pour solveDC().volts), ou null si une sortie
 * PWM découpe le temps (le solveur moyenne plusieurs états : pas de point de fonctionnement unique).
 */
export function spiceDeck(comps, A, ctx, mode = 'pwl') {
  const c = ctx || {}, T = topology(comps, A, typeof c.prof === 'function' ? c.prof : boardOf);
  if (!prepare(T, c) && !T.els.length) return null;
  const L = T.els.length, Vn = new Float64Array(T.nn).fill(NaN), I = new Float64Array(3 * L);
  run(T, Vn, I, 0, 1);
  if (T.duties.length) return null;
  const name = i => (i < 0 || T.isRef[i] ? '0' : `n${i}`), out = [`* Jollof Studio : point de fonctionnement (${mode})`];
  const used = new Set();
  const line = s => out.push(s);
  for (const e of T.els) {
    if (!e.live || e.off) continue;
    const i = e.i, a = name(e.a), b = e.gnd ? '0' : name(e.b), cc = e.c >= 0 ? name(e.c) : b;
    [e.a, e.gnd ? -1 : e.b, e.c].forEach(n => { if (n >= 0 && !T.isRef[n]) used.add(n); });
    if (e.k === RES) { if (e.g > 0) { if (e.e) { line(`R${i} ${a} x${i} ${1 / e.g}`); line(`V${i} x${i} ${b} DC ${e.e}`); } else line(`R${i} ${a} ${b} ${1 / e.g}`); } }
    else if (e.k === NOR) { line(`R${i} ${a} x${i} ${1 / e.g}`); line(`V${i} x${i} ${b} DC ${e.duty >= 0 ? (e.duty > 0 ? e.logic : 0) : e.e}`); }
    else if (e.k === DIO) {
      if (mode === 'phys') {
        // Exponentielle calée sur le seuil du solveur à 10 mA, sa résistance devient RS.
        const n = 1.8, is = 0.01 / Math.exp(e.e / (n * VT));
        line(`D${i} ${a} ${b} DX${i}`); line(`.model DX${i} D(IS=${is.toExponential(4)} N=${n} RS=${1 / e.g})`);
      } else { line(`D${i} ${a} x${i} DID`); line(`V${i} x${i} y${i} DC ${e.e}`); line(`R${i} y${i} ${b} ${1 / e.g}`); }
    } else if (e.k === SRC) {
      if (e.kind === REG) {
        if (!e.on) continue;
        // Régulateur : la tension de sortie est imposée par rapport à GND, le courant vient de IN (source F).
        line(`R${i} ${a} x${i} ${e.r || 1e-6}`); line(`V${i} x${i} ${b} DC ${e.e}`); line(`F${i} ${b} ${cc} V${i} 1`);
      } else if (e.kind === OR) { line(`V${i} x${i} ${b} DC ${e.e}`); line(`D${i} x${i} y${i} DID`); line(`R${i} y${i} ${a} ${e.r || 1e-6}`); }
      else { line(`V${i} x${i} ${b} DC ${e.e}`); line(`R${i} ${a} x${i} ${e.r || 1e-6}`); }
    } else if (e.k === BJT) {
      if (mode === 'phys') { line(`Q${i} ${a} ${cc} ${b} QX${i}`); line(`.model QX${i} NPN(IS=${(1e-3 / Math.exp(VBE / VT)).toExponential(4)} BF=${e.beta} VAF=100 RB=50)`); continue; }
      if (!e.on) continue;
      line(`R${i}b ${cc} y${i} ${1 / G_BE}`); line(`V${i}b y${i} ${b} DC ${VBE}`);
      if (e.on === 2) { line(`R${i} ${a} z${i} ${1 / e.gs}`); line(`V${i} z${i} ${b} DC ${VCE_SAT}`); }
      else line(`G${i} ${a} ${b} ${cc} y${i} ${e.beta * G_BE}`);
    } else if (e.k === FET) {
      if (mode === 'phys') { line(`M${i} ${a} ${cc} ${b} ${b} MX${i}`); line(`.model MX${i} NMOS(LEVEL=1 VTO=${e.e} KP=${(e.g / Math.max(0.5, 5 - e.e)).toExponential(4)})`); continue; }
      if (e.on) line(`R${i} ${a} ${b} ${1 / e.g}`);
    }
  }
  // Même fuite vers la masse que le solveur (GMIN) : un nœud isolé garde une solution.
  for (const n of used) line(`RG${n} n${n} 0 ${1 / GMIN}`);
  line('.model DID D(IS=1e-9 N=0.005)');
  line('.options gmin=1e-12');
  line('.op');
  line('.end');
  const probes = [];
  for (const [members, i] of T.nets) if (used.has(i) && members.length) probes.push({ node: `n${i}`, ref: members[0], members });
  return { text: out.join('\n') + '\n', probes };
}
