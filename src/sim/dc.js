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
// Composants analogiques (analog-parts.js) : bobine (modèle compagnon d'Euler implicite, comme les condensateurs ;
// en continu, un fil de sa résistance), ampli-op LM358 (idéal, sortie bornée aux rails moins sa marge, entrées
// bornées à leur plage de mode commun), MOSFET IRLZ44N (interrupteur, RDS(on) selon VGS), minuterie NE555
// (comparateurs à 1/3 et 2/3 de VCC lus à chaque pas, bascule gardée d'un pas à l'autre, décharge, étage de
// sortie), générateur de fonctions (source de 50 Ω qui suit le temps virtuel).
import { DERIVED, SOURCES, base, boardOf, isGnd } from './boards.js';
import { partOf, MOTORS, NPNS, COILS, isContact } from './parts.js';
import { pid, ohms } from './circuit.js';
import { TIMERS, OPAMPS, MOSFETS, INDUCTORS, GENERATORS, GEN_DEFAULT, genValue, rdsOn } from './analog-parts.js';
import { pkgLed, pkgLoad } from './pkgparts.js';

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
const R_BAT = { bat9v: 1.5, bat18650: 0.05, mb102: 0.1, psu24: 0.05 }; // résistance interne
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
const DRIVEN = new Set(['in', 'adc', 'irq', 'io', 'tx', 'miso', 'sda']);

// Éléments : résistance, diode, source de tension (branche MNA), source de Norton (GPIO, capteur),
// condensateur, transistor NPN (a = C, b = E, c = B ; on = 0 bloqué, 1 linéaire, 2 saturé),
// MOSFET en interrupteur (a, b : drain et source, interchangeables ; c = grille ; on = 0 ou 1),
// bobine (a, b ; compagnon g·(Va − Vb − e) comme un condensateur), ampli-op (a = sortie, b = masse, c = entrée +,
// d = entrée −, f = VCC ; branche MNA ; on = 0 linéaire, 1 bornée en haut, 2 bornée en bas ; cp, cn : entrée
// bornée à sa plage de mode commun ; ret : courant de sortie pris sur VCC (1) ou rendu à la masse (0)).
const RES = 0, DIO = 1, SRC = 2, NOR = 3, CAP = 4, BJT = 5, FET = 6, IND = 7, OPA = 8;
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
  pa: null, pb: null, pc: null, load: null, motor: false, gate: -1, dis: false, off: false, beta: BETA, gs: G_SAT,
  d: -1, f: -1, idd: -1, iff: -1, pd: null, pf: null, ind: 0, rs: 0, il: 0, A: 0, head: 0, vol: 0, cmr: 0, cp: 0, cn: 0, ret: 0,
  mos: null, gen: null, gt: 0, t5: null });
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
  const push = e => { if (e.a < 0 || (!e.gnd && e.b < 0) || ((e.kind === REG || e.k === BJT || e.k === FET || e.k === OPA) && e.c < 0) || (e.k === OPA && (e.d < 0 || e.f < 0))) return null; e.i = els.length; els.push(e); return e; };
  const inds = [], opas = [], timers = [], gens = [], opaOf = new Map(), timerOf = new Map();
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
    if (analog(c)) return true;
    if (r > 0) { const e = two(RES, c, '1', '2'); if (e) { e.g = 1 / r; byComp.set(c, e); } return true; }
    if (vf) { const e = diode(c, 'A', 'K', vf, R_LED); if (e) byComp.set(c, e); leds.push({ comp: c, els: e ? [e] : [], multi: false }); return true; }
    // Composant en paquet (.jpart) : LED ou charge résistive déclarées (une charge entre 1 et 2 est une résistance, ci-dessus).
    const pl = pkgLed(t), pr = !r && pkgLoad(t);
    if (pl) { const e = diode(c, pl.anode, pl.cathode, pl.vf, R_LED); if (e) byComp.set(c, e); leds.push({ comp: c, els: e ? [e] : [], multi: false }); return true; }
    if (pr) { const e = two(RES, c, pr.pin, pr.to); if (e) { e.g = 1 / pr.ohms; byComp.set(c, e); } }
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
    if (isContact(c)) { const e = two(RES, c, '1', '2'); if (e) e.sw = 'pressed'; return true; }
    // Bobine d'électrovanne : une résistance (la bobine en régime établi).
    if (COILS[t]) { const e = two(RES, c, COILS[t].plus, COILS[t].minus); if (e) { e.g = 1 / COILS[t].r; e.load = 'coil'; byComp.set(c, e); } return true; }
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

  /** Composants analogiques (analog-parts.js) ; false : pas l'un d'eux. */
  function analog(c) {
    const t = c.type;
    if (t === 'scope') return true; // entrées idéales : l'oscilloscope ne prélève rien
    if (INDUCTORS[t]) {
      const m = INDUCTORS[t], e = two(IND, c, '1', '2');
      if (e) { e.ind = m.L; e.rs = m.r || 1e-3; byComp.set(c, e); inds.push(e); }
      return true;
    }
    if (MOSFETS[t]) {
      // Interrupteur drain-source commandé par VGS (source fixée : S), et diode interne de la source vers le drain.
      const m = MOSFETS[t], e = keys(mk(FET, c, net(c, 'D'), net(c, 'S')), 'D', 'S', 'G');
      e.c = net(c, 'G'); e.e = m.vth; e.mos = m; e.g = 1 / rdsOn(m, 5);
      if (push(e)) byComp.set(c, e);
      diode(c, 'S', 'D', m.vfBody, m.rBody);
      return true;
    }
    if (OPAMPS[t]) {
      const m = OPAMPS[t], g = net(c, 'GND'), v = net(c, 'VCC'), list = [];
      for (const [kp, kn, ko] of m.chans) {
        if (![kp, kn, ko].some(k => c.pins[k] && A.members({ comp: c, key: k }).length > 1)) continue; // ampli inutilisé
        const e = keys(mk(OPA, c, net(c, ko), g), ko, 'GND', kp);
        e.c = net(c, kp); e.d = net(c, kn); e.f = v; e.pd = kn; e.pf = 'VCC';
        e.A = m.gain; e.head = m.head; e.vol = m.vol; e.r = m.rOut; e.cmr = m.cmr;
        if (push(e)) { list.push(e); opas.push(e); }
      }
      if (list.length) opaOf.set(c, list);
      return true;
    }
    if (TIMERS[t]) {
      // Pont interne (CONT à 2/3 de VCC), étage de sortie haut et bas, transistor de décharge : des éléments ordinaires
      // que la bascule active ou coupe (off) ; les comparateurs se lisent après chaque pas (timerStep).
      const m = TIMERS[t], top = two(RES, c, 'VCC', 'CV'), bot = two(RES, c, 'CV', 'GND');
      if (top) top.g = 1 / m.rTop; if (bot) bot.g = 1 / m.rBot;
      const hi = diode(c, 'VCC', 'OUT', m.ohDrop, m.rOh), lo = diode(c, 'OUT', 'GND', m.vol, m.rOl), dis = diode(c, 'DIS', 'GND', m.vDis, m.rDis);
      if (hi && lo && dis) {
        const x = { comp: c, m, hi, lo, dis, top, bot, q: 0, trig: net(c, 'TRIG'), thr: net(c, 'THR'), cv: net(c, 'CV'), rst: net(c, 'RESET'), gnd: net(c, 'GND'), vcc: net(c, 'VCC'), out: net(c, 'OUT'), dsn: net(c, 'DIS') };
        for (const e of [hi, lo, dis, top, bot]) if (e) e.t5 = x;
        timers.push(x); timerOf.set(c, x);
      }
      return true;
    }
    if (GENERATORS[t]) {
      // Source de Thévenin entre OUT et GND ; sa masse sert de référence à un montage sans carte.
      const m = GENERATORS[t], o = net(c, 'OUT'), g = net(c, 'GND');
      if (g >= 0) cands.push(g, 1);
      const e = keys(mk(NOR, c, o, g), 'OUT', 'GND');
      e.g = 1 / m.r; e.gen = m; e.key = 'OUT';
      if (push(e)) { byComp.set(c, e); gens.push(e); }
      return true;
    }
    return false;
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
  for (const e of els) if (!e.gnd) { join(e.a, e.b); if (e.c >= 0) join(e.c, e.b); if (e.d >= 0) join(e.d, e.b); if (e.f >= 0) join(e.f, e.b); }
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
    sw: els.filter(e => e.k === DIO || e.k === BJT || e.k === FET || e.k === OPA || (e.k === SRC && e.kind !== STIFF)),
    caps, bjts, inds, opas, timers, gens, opaOf, timerOf,
    dyn: caps.length > 0 || bjts.length > 0 || inds.length > 0 || timers.length > 0 || gens.length > 0, duties: [] };
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
      else if (e.gen) {
        // Générateur : valeur imposée (vérificateur : extrêmes de sa plage) ou celle de l'instant (temps gardé sur le composant).
        const s = e.comp.dcS, v = sv ? sv(e.comp, e.key) : null;
        e.gt = s && Number.isFinite(s.t) ? s.t : 0; e.act = true; any = true;
        // En continu : sa valeur moyenne (le décalage), comme la lirait un multimètre ; pas à pas, run() la fait évoluer.
        e.e = typeof v === 'number' && Number.isFinite(v) ? v : genValue(e.comp.inp, e.gt, 1e9);
        e.fixed = typeof v === 'number' && Number.isFinite(v);
      } else if (sv) {
        const v = sv(e.comp, e.key);
        if (typeof v === 'number' && Number.isFinite(v)) { e.act = true; e.e = v; any = true; }
      }
    } else if (e.k === CAP) {
      const s = e.comp.dcS;
      e.vc = s && Number.isFinite(s.v) ? s.v : 0; // condensateur neuf : déchargé
    } else if (e.k === IND) {
      const s = e.comp.dcS;
      e.il = s && Number.isFinite(s.i) ? s.i : 0; // bobine neuve : aucun courant
    } else if (e.k === BJT) {
      const s = e.comp.dcS;
      if (s && (s.q === 0 || s.q === 1 || s.q === 2)) e.on = s.q; // départ : l'état du pas précédent
    }
  }
  // Minuteries : état de la bascule imposé (vérificateur), sinon celui du pas précédent (sortie basse au départ).
  for (const x of T.timers) {
    const c = x.comp, s = c.dcS, f = sv ? sv(c, 'q') : null;
    x.q = typeof f === 'number' ? (f ? 1 : 0) : c.timerQ != null ? (c.timerQ ? 1 : 0) : s && (s.q === 0 || s.q === 1) ? s.q : 0;
    setTimer(x);
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
    if (e.k === OPA) { stampOpa(e, N); continue; }
    if (e.k === FET) { if (e.on) cond(N, a, b, e.g, 0); continue; }
    if (e.k === DIO && (!e.on || e.off)) continue;
    cond(N, a, b, e.g, e.e);
  }
}

/**
 * Ampli-op : courant de sortie I (branche k) injecté dans la sortie, pris sur VCC ou rendu à la masse.
 * Linéaire : Va − Vb + r·I = A·(xp − xn), xp = V+ ou, hors de la plage de mode commun, VCC − cmr.
 * Borné en haut : Va − Vvcc + r·I = −marge ; en bas : Va − Vb + r·I = vol.
 */
function stampOpa(e, N) {
  const a = e.ia, b = e.ib, p = e.ic, n = e.idd, v = e.iff, k = e.br, kk = k * N, r = e.ret ? v : b;
  if (a >= 0) M[a * N + k] -= 1;
  if (r >= 0) M[r * N + k] += 1;
  M[kk + k] = e.r;
  if (a >= 0) M[kk + a] += 1;
  if (e.on === 1) { if (v >= 0) M[kk + v] -= 1; X[k] = -e.head; return; }
  if (b >= 0) M[kk + b] -= 1;
  if (e.on === 2) { X[k] = e.vol; return; }
  let rhs = 0;
  if (e.cp) { if (v >= 0) M[kk + v] -= e.A; rhs -= e.A * e.cmr; } else if (p >= 0) M[kk + p] -= e.A;
  if (e.cn) { if (v >= 0) M[kk + v] += e.A; rhs += e.A * e.cmr; } else if (n >= 0) M[kk + n] += e.A;
  X[k] = rhs;
}
/** Bascule d'une minuterie : sortie haute (q = 1, décharge ouverte) ou basse (q = 0, décharge fermée). */
function setTimer(x) {
  x.hi.off = !x.q; x.lo.off = !!x.q; x.dis.off = !!x.q;
  for (const e of [x.hi, x.lo, x.dis]) if (e.off) e.on = 0;
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
    else if (e.k === FET) {
      // Vgs : côté le plus bas = source (adaptateur de niveau) ; MOSFET de puissance : la source S.
      const vgs = e.mos ? pv(e.ic) - pv(e.ib) : pv(e.ic) - Math.min(pv(e.ia), pv(e.ib));
      d = vgs - e.e; if (e.on) d = -d;
      // RDS(on) suit VGS (fiche technique) : corrigée sur place, un tour de plus.
      if (e.mos && (e.on ? d <= TOL : d > TOL)) { const g = 1 / rdsOn(e.mos, Math.max(vgs, e.e + 1e-3)); if (Math.abs(g - e.g) > 1e-3 * e.g) { e.g = g; if (e.on) n++; } }
    }
    else if (e.k === OPA) { const r = opaFlip(e); if (!r) continue; d = r[0]; nq = r[1]; }
    else if (e.kind === OR) d = e.on ? -X[e.br] * 1e3 : e.e - (pv(e.ia) - pv(e.ib));
    else { d = pv(e.ic) - pv(e.ib) - e.min; if (e.on) d = -d; } // régulateur : il lui faut min volts sur IN
    if (d <= TOL) continue;
    n++; e.nq = nq;
    if (!worstOnly) applyNq(e);
    else if (d > wv) { wv = d; we = e; }
  }
  if (we) applyNq(we);
  return n;
}
/** Nouvel état d'un élément ; ampli-op : 10 + état de sortie, 20 / 21 entrée + / − bornée ou non, 30 retour du courant. */
function applyNq(e) {
  if (e.k !== OPA) { e.on = e.nq; return; }
  if (e.nq >= 30) e.ret ^= 1;
  else if (e.nq === 20) e.cp ^= 1;
  else if (e.nq === 21) e.cn ^= 1;
  else e.on = e.nq - 10;
}
/** Ampli-op dont l'état contredit la solution : [écart, nouvel état], ou null. */
function opaFlip(e) {
  const vp = pv(e.ic), vn = pv(e.idd), vv = pv(e.iff), vb = pv(e.ib), lim = vv - e.cmr;
  if (!e.cp && vp > lim + TOL) return [vp - lim, 20];
  if (e.cp && vp < lim - TOL) return [lim - vp, 20];
  if (!e.cn && vn > lim + TOL) return [vn - lim, 21];
  if (e.cn && vn < lim - TOL) return [lim - vn, 21];
  const ideal = e.A * ((e.cp ? lim : vp) - (e.cn ? lim : vn)), hi = vv - e.head - vb;
  if (e.on === 0) { if (ideal > hi + TOL) return [ideal - hi, 11]; if (ideal < e.vol - TOL) return [e.vol - ideal, 12]; }
  else if (e.on === 1) { if (ideal < hi - TOL) return [hi - ideal, 10]; }
  else if (ideal > e.vol + TOL) return [ideal - e.vol, 10];
  // Courant de sortie : fourni, il vient de VCC ; absorbé, il part à la masse.
  const I = X[e.br], want = I > 0 ? 1 : 0;
  if (want !== e.ret && Math.abs(I) > 1e-9) return [2 * TOL, 30];
  return null;
}

/** Courant de l'élément (A), de a vers b ; sortant par + pour une source ; Ic pour un transistor. */
function amps(e) {
  if (e.k === SRC) return e.on && !e.off ? X[e.br] : 0;
  if (e.k === OPA) return X[e.br];
  if (e.k === DIO) return e.on && !e.off ? Math.max(0, e.g * (pv(e.ia) - pv(e.ib) - e.e)) : 0;
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

function run(T, Vn, I, dt, maxSub, tap = null) {
  const { els, idx, nn, caps, duties, inds, gens, timers } = T, L = els.length;
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
    if (e.d >= 0 && idx[e.d] === -2) idx[e.d] = n++;
    if (e.f >= 0 && idx[e.f] === -2) idx[e.f] = n++;
  }
  let N = n;
  for (const e of els) {
    if (!e.live) continue;
    e.ia = idx[e.a]; e.ib = e.gnd ? -1 : idx[e.b]; e.ic = e.c >= 0 ? idx[e.c] : e.ib;
    e.idd = e.d >= 0 ? idx[e.d] : -1; e.iff = e.f >= 0 ? idx[e.f] : -1;
    if (e.k === SRC || e.k === OPA) e.br = N++;
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
  const timed = caps.length + inds.length + gens.length + timers.length > 0;
  const nsub = dt > 0 && timed ? Math.min(maxSub, Math.ceil(dt / H_MAX)) : 1, h = dt / nsub;
  for (const e of caps) if (e.live) e.g = e.cap / h;
  // Bobine : en continu, un fil de sa résistance ; en transitoire, compagnon d'Euler implicite (L/h en série).
  for (const e of inds) { e.g = dt > 0 ? 1 / (e.rs + e.ind / h) : 1 / e.rs; e.e = 0; }
  if (tap) { tap.h = h; tap.n = nsub; for (let k = 0; k < tap.nets.length; k++) if (!tap.v[k] || tap.v[k].length < nsub) tap.v[k] = new Float64Array(Math.max(nsub, 32)); }
  let its = 0;
  for (let sub = 0; sub < nsub; sub++) {
    for (const e of caps) e.e = e.vc;
    for (const e of inds) if (dt > 0) e.e = -(e.ind / h) * e.il;
    // Générateur : sa valeur moyenne sur le pas (pas de repliement quand la période est plus courte que le pas).
    for (const e of gens) if (dt > 0 && !e.fixed) e.e = genValue(e.comp.inp, e.gt + sub * h, h);
    let it = 0;
    // Minuterie : les comparateurs se lisent sur la solution du pas ; si la bascule change, le pas est refait.
    for (let pass = 0; ; pass++) {
      VACC.fill(0, 0, n); DET.fill(0, 0, n); I.fill(0);
      t0 = 0;
      for (let s = 0; s <= duties.length; s++) {
        const t1 = s < duties.length ? duties[s] : 1;
        if (t1 - t0 > 1e-9) {
          for (const e of els) if (e.live) { if (e.duty >= 0) e.e = e.duty > t0 ? e.logic : 0; if (e.gate >= 0) e.off = !(e.gate > t0); }
          it += phase(T, n, N, t1 - t0, I, s === rec);
        }
        t0 = t1;
      }
      if (!(dt > 0 && timers.length && pass < 3 && timerStep(T))) break;
    }
    if (it > its) its = it;
    // Le condensateur avance d'un pas : vc = e + I/g, avec le courant moyen du pas (PWM comprise) ; la bobine garde
    // le courant du pas.
    for (const e of caps) if (e.live) e.vc = e.e + I[e.i] / e.g;
    for (const e of inds) if (e.live && dt > 0) e.il = I[e.i];
    if (tap) for (let k = 0; k < tap.nets.length; k++) tap.v[k][sub] = nodeV(T, tap.nets[k], true);
  }
  for (const e of gens) e.gt += dt;
  for (const e of caps) I[L + e.i] = dt > 0 ? e.vc : NaN; // NaN : en continu, capV lit les potentiels
  for (let i = 0; i < nn; i++) { const j = idx[i]; if (j === -1) Vn[i] = 0; else if (j >= 0 && DET[j]) Vn[i] = VACC[j]; }
  return its;
}
/** Potentiel d'un nœud (indice de T.nets) dans la solution en cours (avg : moyenne des tranches PWM), NaN s'il n'est pas calculé. */
function nodeV(T, i, avg) {
  const j = i >= 0 && i < T.nn ? T.idx[i] : -3;
  return j === -1 ? 0 : j >= 0 ? (avg ? (DET[j] ? VACC[j] : NaN) : X[j]) : NaN;
}
/**
 * Comparateurs des minuteries sur la solution du pas : RESET sous son seuil force la sortie basse ; TRIG sous la
 * moitié de CONT (1/3 de VCC) la met haute ; THR au-dessus de CONT (2/3 de VCC) la remet basse. Rend true si une
 * bascule a changé.
 */
function timerStep(T) {
  let changed = false;
  for (const x of T.timers) {
    if (!x.lo.live) continue;
    const v = i => nodeV(T, i, false), g = v(x.gnd), cv = v(x.cv) - g, trig = v(x.trig) - g, thr = v(x.thr) - g, rst = v(x.rst) - g;
    let q = x.q;
    if (rst === rst && rst < x.m.vReset) q = 0;
    else if (trig === trig && cv === cv && trig < cv / 2) q = 1;
    else if (thr === thr && cv === cv && thr > cv) q = 0;
    if (q !== x.q) { x.q = q; setTimer(x); changed = true; }
  }
  return changed;
}

/** Garde l'état sur le composant, sans allouer une fois créé. */
function save(c, v, q) {
  const s = c.dcS;
  if (s) { s.v = v; s.q = q; } else c.dcS = { v, q };
}
const stateOf = c => c.dcS || (c.dcS = { v: 0, q: 0 });
function commit(T, Vn) {
  for (const e of T.caps) save(e.comp, e.vc, 0);
  for (const e of T.inds) stateOf(e.comp).i = e.il;
  for (const x of T.timers) stateOf(x.comp).q = x.q;
  for (const e of T.gens) stateOf(e.comp).t = e.gt;
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
    else if (e.k === OPA) { add(c, e.pa, x); add(c, e.ret ? e.pf : e.pb, -x); }
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
  const OPA_STATE = ['lin', 'high', 'low'];
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
      const t5 = T.timerOf.get(comp);
      if (t5) {
        // Minuteur : courant de sortie (fourni + / absorbé −), tension de sortie, état de la bascule.
        const io = (t5.hi.live ? mA(t5.hi) : 0) - (t5.lo.live ? mA(t5.lo) : 0);
        return { v: diff(t5.out, t5.gnd), mA: io, kind: 'timer', extra: { q: t5.q, out: io, dis: t5.dis.live ? mA(t5.dis) : 0, cv: diff(t5.cv, t5.gnd) } };
      }
      const ops = T.opaOf.get(comp);
      if (ops) {
        const chans = ops.map(e => ({ out: e.pa, v: diff(e.a, e.b), mA: mA(e), state: OPA_STATE[e.on] || 'lin', clip: !!(e.cp || e.cn), vp: diff(e.c, e.b), vn: diff(e.d, e.b) }));
        return { v: chans[0].v, mA: chans[0].mA, kind: 'opamp', extra: { chans } };
      }
      const e = T.byComp.get(comp) || T.regs.get(comp);
      if (!e) { const l = leds.get(comp); return l ? { v: null, mA: l.mA, kind: 'led', extra: { on: l.on, ch: l.ch || null } } : null; }
      const x = mA(e);
      switch (e.k) {
        case RES: return { v: diff(e.a, e.b), mA: x, kind: e.motor ? 'motor' : e.load || 'res', extra: { ohms: e.g > 0 ? 1 / e.g : Infinity } };
        case DIO: { const l = leds.get(comp); return { v: diff(e.a, e.b), mA: x, kind: l ? 'led' : 'diode', extra: l ? { on: l.on } : null }; }
        case CAP: return { v: capV(comp), mA: x, kind: 'cap', extra: { farads: e.cap } };
        case IND: return { v: diff(e.a, e.b), mA: x, kind: 'ind', extra: { henry: e.ind, ohms: e.rs } };
        case FET: {
          const vgs = diff(e.c, e.b), vds = diff(e.a, e.b);
          return { v: vds, mA: x, kind: 'mosfet', extra: { id: x, vgs, vds, rds: e.on && e.g > 0 ? 1 / e.g : Infinity, state: e.on ? 'on' : 'off' } };
        }
        case NOR: return { v: diff(e.a, e.b), mA: -x, kind: e.gen ? 'gen' : 'src', extra: null };
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
    // Simulation en direct (pas validé) : les points suivis par l'oscilloscope sont relevés à chaque sous-pas.
    const tap = ok && dt > 0 && c.commit && TAP && TAP.refs.length ? tapOf(T, A) : null;
    const its = ok ? run(T, Vn, I, dt, maxSub, tap) : 0;
    if (ok && dt > 0 && c.commit) commit(T, Vn);
    if (tap) { try { TAP.push({ h: tap.h, n: tap.n, v: tap.v.map(a => a.slice(0, tap.n)) }); } catch (e) { /* affichage seulement */ } }
    return result(T, A, ok, Vn, I, its);
  } catch (err) {
    // Appelé à chaque image : un montage inattendu ne doit jamais casser l'affichage.
    if (!warned) { warned = true; console.warn('solveDC :', err); }
    return none();
  }
}

/**
 * Suivi par l'oscilloscope (sim/instruments.js) : refs, les broches à relever ; push({ h, n, v: [Float64Array…] }) reçoit
 * à chaque calcul de la simulation en direct la tension de chaque broche à chacun des n sous-pas de h secondes
 * (NaN : point non relié). null : aucun suivi.
 */
let TAP = null;
export function setTap(t) { TAP = t && Array.isArray(t.refs) && typeof t.push === 'function' ? t : null; }
const tapCache = new WeakMap();
function tapOf(T, A) {
  let o = tapCache.get(T);
  if (!o || o.refs !== TAP.refs) {
    const nets = TAP.refs.map(r => (r && r.comp && r.comp.pins && r.comp.pins[r.key] ? T.nets.get(A.members(r)) ?? -1 : -1));
    o = { refs: TAP.refs, nets, v: [], h: 0, n: 0 }; tapCache.set(T, o);
  }
  return o;
}

/** Oublie l'état des condensateurs et transistors (arrêt de la simulation, autre projet). */
export function resetDynamic(comps) {
  for (const c of comps || []) if (c && c.dcS) c.dcS = null;
}

/* ---------- Comparaison avec ngspice (src/sim/spice.test.mjs) ---------- */
/** Source ngspice d'un générateur de fonctions (transitoire, phase 0 au début de la fenêtre). */
function genSpice(inp) {
  const g = { ...GEN_DEFAULT, ...(inp || {}) }, f = +g.freq || 0, A = Math.abs(+g.amp || 0), off = +g.off || 0;
  if (g.wave === 'dc' || !(f > 0) || !A) return `DC ${off}`;
  const P = 1 / f, e = x => x.toExponential(6);
  if (g.wave === 'square') { const tr = Math.min(1e-6, P / 1000); return `PULSE(${off - A} ${off + A} 0 ${e(tr)} ${e(tr)} ${e(P / 2 - tr)} ${e(P)})`; }
  if (g.wave === 'triangle') { const pw = P * 1e-6; return `PULSE(${off - A} ${off + A} 0 ${e((P - pw) / 2)} ${e((P - pw) / 2)} ${e(pw)} ${e(P)})`; }
  return `SIN(${off} ${A} ${f} 0 0 0)`;
}
const VT = 0.025852; // tension thermique à 27 °C
/**
 * Le montage, tel que le voit ce solveur, écrit pour ngspice (analyse .op). mode :
 *   'pwl'  : mêmes modèles par morceaux que le solveur (diodes quasi idéales avec seuil et résistance, transistors
 *            et MOSFET dans l'état trouvé) : ngspice doit retrouver les mêmes tensions, au millivolt près ;
 *   'phys' : modèles physiques de ngspice (diode exponentielle, NPN de Gummel-Poon, MOSFET niveau 1) réglés sur
 *            les mêmes paramètres : l'écart mesure l'erreur des modèles simplifiés.
 *   'tran' : transitoire (.tran) sur opts.tstop secondes (pas opts.tstep), modèles physiques, condensateurs avec leur
 *            charge, sorties PWM en impulsions (opts.freqOf(comp, clé) → Hz) : ce que montre l'oscilloscope.
 * Composants analogiques : bobine (L et sa résistance), MOSFET (niveau 1, KP tiré de RDS(on)), ampli-op ('pwl' : son
 * état ; 'phys' et 'tran' : macro-modèle à sources comportementales, gain, pôle dominant, vitesse de balayage, sortie
 * et entrées bornées), NE555 ('pwl', 'phys' : ses éléments dans l'état de la bascule ; 'tran' : comparateurs et
 * bascule en sources comportementales), générateur (SIN ou PULSE en transitoire, sa valeur moyenne sinon).
 * Rend { text, probes: [{ node, ref, members }] } (ref : une broche du nœud, pour solveDC().volts), ou null si une sortie
 * PWM découpe le temps hors transitoire (le solveur moyenne plusieurs états : pas de point de fonctionnement unique).
 */
export function spiceDeck(comps, A, ctx, mode = 'pwl', opts = {}) {
  const c = ctx || {}, T = topology(comps, A, typeof c.prof === 'function' ? c.prof : boardOf);
  if (!prepare(T, c) && !T.els.length) return null;
  const L = T.els.length, Vn = new Float64Array(T.nn).fill(NaN), I = new Float64Array(3 * L), tran = mode === 'tran';
  // Transitoire : un pas fictif rend les condensateurs actifs ; les sorties PWM deviennent de vraies impulsions.
  run(T, Vn, I, tran ? 1e-6 : 0, 1);
  if (T.duties.length && !tran) return null;
  if (tran) mode = 'phys';
  const name = i => (i < 0 || T.isRef[i] ? '0' : `n${i}`), out = [`* Jollof Studio : ${tran ? 'transitoire' : `point de fonctionnement (${mode})`}`];
  const used = new Set();
  const line = s => out.push(s);
  const use = n => { if (n >= 0 && !T.isRef[n]) used.add(n); };
  const vv = n => (n === '0' ? '0' : `V(${n})`), num = x => +(+x).toPrecision(9);
  for (const e of T.els) {
    if (tran && e.t5) continue; // minuterie : modèle comportemental, plus bas
    if (!e.live || e.off) continue;
    const i = e.i, a = name(e.a), b = e.gnd ? '0' : name(e.b), cc = e.c >= 0 ? name(e.c) : b;
    [e.a, e.gnd ? -1 : e.b, e.c, e.d, e.f].forEach(use);
    if (e.k === RES) { if (e.g > 0) { if (e.e) { line(`R${i} ${a} x${i} ${1 / e.g}`); line(`V${i} x${i} ${b} DC ${e.e}`); } else line(`R${i} ${a} ${b} ${1 / e.g}`); } }
    else if (e.k === NOR) {
      line(`R${i} ${a} x${i} ${1 / e.g}`);
      if (tran && e.gen && !e.fixed) line(`V${i} x${i} ${b} ${genSpice(e.comp.inp)}`);
      else if (tran && e.duty > 0 && e.duty < 1) {
        // PWM, tone(), servo : impulsions à la fréquence de la broche (490 Hz par défaut, celle d'analogWrite sur l'Uno).
        const f = (opts.freqOf && opts.freqOf(e.comp, e.key)) || 490, T0 = 1 / f, rise = Math.min(1e-7, T0 / 1000);
        line(`V${i} x${i} ${b} PULSE(0 ${e.logic} 0 ${rise} ${rise} ${(e.duty * T0 - rise).toExponential(6)} ${T0.toExponential(6)})`);
      } else line(`V${i} x${i} ${b} DC ${e.duty >= 0 ? (e.duty > 0 ? e.logic : 0) : e.e}`);
    } else if (e.k === CAP) {
      // Condensateur : sa charge de départ est celle que garde la simulation (c.dcS), déchargé sinon.
      if (tran) line(`C${i} ${a} ${b} ${e.cap} IC=${e.vc}`);
    } else if (e.k === IND) {
      // Bobine : en continu (.op) un court-circuit, il reste sa résistance ; en transitoire, son courant de départ.
      line(`L${i} ${a} x${i} ${e.ind}${tran ? ` IC=${num(e.il)}` : ''}`); line(`R${i} x${i} ${b} ${e.rs}`);
    } else if (e.k === OPA) {
      const p = name(e.c), n = name(e.d), v = name(e.f), lim = `${vv(v)}-${e.cmr}`;
      if (mode === 'phys') {
        // Macro-modèle : entrées bornées à V+ − cmr, transconductance 1 mS bornée (vitesse de balayage) sur 100 MΩ
        // (gain A) et un condensateur (produit gain-bande), sortie bornée par deux diodes idéales, résistance de sortie.
        const m = OPAMPS[e.comp.type], gm = 1e-3, C = gm / (2 * Math.PI * m.gbw), Is = m.slew * C;
        line(`B${i}p p${i} 0 V = min(${vv(p)}, ${lim})`); line(`B${i}n q${i} 0 V = min(${vv(n)}, ${lim})`);
        line(`B${i}g 0 g${i} I = max(${-Is}, min(${Is}, ${gm}*(V(p${i})-V(q${i}))))`);
        line(`R${i}g g${i} 0 ${e.A / gm}`); line(`C${i}g g${i} 0 ${C.toExponential(4)}${tran ? ` IC=${num(Vn[e.a] - (e.gnd ? 0 : Vn[e.b]) || 0)}` : ''}`);
        line(`B${i}h h${i} 0 V = ${vv(v)}-${vv(b)}-${e.head}`); line(`D${i}h g${i} h${i} DID`);
        line(`V${i}l l${i} 0 DC ${e.vol}`); line(`D${i}l l${i} g${i} DID`);
        line(`E${i} y${i} ${b} g${i} 0 1`); line(`R${i} y${i} ${a} ${e.r}`);
      } else {
        // État trouvé par le solveur : linéaire (source commandée), borné en haut ou en bas.
        const xin = (node, clip, tag) => { if (!clip) return node; line(`B${i}${tag} ${tag}${i} 0 V = ${lim}`); return `${tag}${i}`; };
        if (e.on === 1) line(`B${i} y${i} 0 V = ${vv(v)}-${e.head}`);
        else if (e.on === 2) line(`B${i} y${i} 0 V = ${vv(b)}+${e.vol}`);
        else line(`E${i} y${i} ${b} ${xin(p, e.cp, 'p')} ${xin(n, e.cn, 'q')} ${e.A}`);
        line(`R${i} y${i} ${a} ${e.r}`);
      }
    } else if (e.k === DIO) {
      if (mode === 'phys' && !e.t5) {
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
      // MOSFET de puissance : RDS(on) = k / (VGS − VTO) en zone ohmique, soit KP = 1 / k.
      if (mode === 'phys') { line(`M${i} ${a} ${cc} ${b} ${b} MX${i}`); line(`.model MX${i} NMOS(LEVEL=1 VTO=${e.e} KP=${(e.mos ? 1 / e.mos.k : e.g / Math.max(0.5, 5 - e.e)).toExponential(4)})`); continue; }
      if (e.on) line(`R${i} ${a} ${b} ${1 / e.g}`);
    }
  }
  // NE555 en transitoire : pont interne, comparateurs (rampes de 1 mV), bascule (source qui se maintient à travers un
  // petit filtre RC, RESET prioritaire, puis TRIG, puis THR), étage de sortie et décharge selon la bascule.
  if (tran) for (const x of T.timers) {
    if (!x.lo.live) continue;
    const i = x.lo.i, [vcc, gnd, trig, thr, cv, rst, o, dis] = [x.vcc, x.gnd, x.trig, x.thr, x.cv, x.rst, x.out, x.dsn].map(n => { use(n); return name(n); });
    const G = vv(gnd), step = s => `min(1, max(0, 0.5+(${s})*1000))`, m = x.m;
    line(`* NE555 ${x.comp.name}`);
    line(`R${i}a ${vcc} ${cv} ${m.rTop}`); line(`R${i}b ${cv} ${gnd} ${m.rBot}`);
    line(`B${i}s s${i} 0 V = ${step(`(${vv(cv)}-${G})/2-(${vv(trig)}-${G})`)}`);
    line(`B${i}r r${i} 0 V = ${step(`(${vv(thr)}-${G})-(${vv(cv)}-${G})`)}`);
    line(`B${i}z z${i} 0 V = ${step(`${m.vReset}-(${vv(rst)}-${G})`)}`);
    line(`B${i}q k${i} 0 V = (1-V(z${i}))*max(V(s${i}), (1-V(r${i}))*min(1, max(0, 1.5*V(f${i})-0.25)))`);
    line(`R${i}q k${i} f${i} 1k`); line(`C${i}q f${i} 0 10p IC=${x.q}`);
    line(`B${i}h h${i} 0 V = ${G}+V(f${i})*(${vv(vcc)}-${G}-${m.ohDrop})-(1-V(f${i}))*2`); line(`D${i}h h${i} w${i} DID`); line(`R${i}h w${i} ${o} ${m.rOh}`);
    line(`B${i}l l${i} 0 V = ${G}+${m.vol}+V(f${i})*(${vv(vcc)}-${G}+2)`); line(`R${i}l ${o} u${i} ${m.rOl}`); line(`D${i}l u${i} l${i} DID`);
    line(`B${i}d m${i} 0 V = ${G}+${m.vDis}+V(f${i})*(${vv(vcc)}-${G}+2)`); line(`R${i}d ${dis} y${i} ${m.rDis}`); line(`D${i}d y${i} m${i} DID`);
  }
  // Même fuite vers la masse que le solveur (GMIN) : un nœud isolé garde une solution.
  for (const n of used) line(`RG${n} n${n} 0 ${1 / GMIN}`);
  line('.model DID D(IS=1e-9 N=0.005)');
  line('.options gmin=1e-12');
  if (tran) { const tt = opts.tstop || 0.02, ts = opts.tstep || tt / 1000; line(`.tran ${ts.toExponential(4)} ${tt.toExponential(4)} 0 ${ts.toExponential(4)} uic`); }
  else line('.op');
  line('.end');
  const probes = [];
  for (const [members, i] of T.nets) if (used.has(i) && members.length) probes.push({ node: `n${i}`, ref: members[0], members });
  return { text: out.join('\n') + '\n', probes };
}
