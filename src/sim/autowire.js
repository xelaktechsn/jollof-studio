// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Câblage automatique et explications. Le planificateur choisit, pour chaque broche
// d'un composant, la broche de la carte qui convient (tension, ADC, bus I2C/SPI, port
// série), ajoute les résistances nécessaires et décrit chaque fil. `explain` relit le
// montage existant et dit, broche par broche, à quoi elle sert et si elle est bien reliée.
import { BOARDS, NEED_CAPS, base, volts, vrange, pickPower, pinName, codePin, boardOf, isGnd } from './boards.js';
import { PARTS, partOf, motorPins, loadPins } from './parts.js';
import { inspect, bbGroups, isBreadboard } from './circuit.js';
import { boardLimits } from '../check/limits.js';
import { tl } from '../i18n/index.js';

const COL = { pwr: '#e5484d', gnd: '#3a3f45', io: '#f2c94c', in: '#f2c94c', out: '#f2c94c', pullup: '#f2c94c', pwm: '#f08a3c', adc: '#3fb27f', sda: '#3b82f6', scl: '#9b7be0', sck: '#f08a3c', mosi: '#3fb27f', miso: '#3b82f6', ss: '#e9e9e6', rx: '#e9e9e6', tx: '#f08a3c', res: '#f08a3c', drv: '#f08a3c' };
const ROLE = { pwr: tl('Alimentation'), ext: tl('Alimentation'), vin: tl('Alimentation'), gnd: tl('Masse'), nc: tl('Libre'), contact: tl('Contact'), drv: tl('Moteur'), io: tl('Données'), in: tl('Signal'), out: tl('Commande'), pullup: tl('Entrée'), pwm: 'PWM', adc: tl('Analogique'), sda: 'I2C SDA', scl: 'I2C SCL', sck: 'SPI SCK', mosi: 'SPI MOSI', miso: 'SPI MISO', ss: 'SPI SS', rx: tl('Série RX'), tx: tl('Série TX') };
const ORDER = { pwr: 0, ext: 0, vin: 0, gnd: 1 };
const BB = new Set(['breadboard', 'breadboard-mini']);
const GND_WHY = tl('Masse : référence commune des tensions. Sans masse commune avec la carte, les signaux n’ont aucun sens.');

export const roleOf = p => p.role || ROLE[p.kind === 'io' ? p.need : p.kind];
const required = (p, comp, A) => {
  if (!comp.pins[p.pin] || p.kind === 'nc' || p.kind === 'contact') return false; // contacts de relais : côté puissance, au choix
  if (p.when) return p.when.some(k => A.deg({ comp, key: k }) > 0);
  return !p.opt;
};
/** Le composant a-t-il encore des broches obligatoires à câbler ? */
export function needsWiring(comp, A) {
  const spec = partOf(comp);
  return !!(spec && spec.pins && spec.pins.some(p => required(p, comp, A) && !A.deg({ comp, key: p.pin })));
}
export const wirable = comp => !!(partOf(comp) && partOf(comp).pins);

/**
 * Routeur « un fil par broche ». Chaque broche (de carte, de module ou de breadboard) ne
 * reçoit qu'un fil, comme un vrai connecteur. Quand plusieurs fils doivent rejoindre le même
 * point (alimentation, masse, bus I2C, jonction d'une résistance de tirage), ils passent par
 * un « hub » de breadboard : un rail pour l'alimentation et la masse, une bande de 5 trous sinon.
 * Si une broche de carte est déjà prise par un fil direct, ce fil est déplacé sur le hub.
 * Les cibles : { type: 'pwr', v, name } · { type: 'gnd' } · { type: 'pin', key }.
 */
function makeRouter(cx, P, anchor) {
  const board = cx.board, A = cx.A, prof = boardOf(board);
  const id = r => `${r.h ? 'h:' + r.h : r.comp.id}|${r.key}`;
  const occ = new Map(), removed = new Set(), claimed = new Set(), hubs = new Map();
  const inc = (r, d) => occ.set(id(r), (occ.get(id(r)) || 0) + d);
  cx.wires.forEach(w => { inc(w.a, 1); inc(w.b, 1); });
  const used = r => (occ.get(id(r)) || 0) > 0;
  const on = k => ({ comp: board, key: k });
  const named = n => Object.keys(board.pins).filter(k => base(k) === n);
  const bbs = cx.comps.filter(isBreadboard);
  const safe = r => (r.h ? anchor : r); // un composant à créer n'a pas encore de position
  const dist = (a, b) => cx.dist(safe(a), safe(b));
  const nearest = (refs, near) => refs.slice().sort((a, b) => dist(a, near) - dist(b, near))[0];
  const wire = (a, b, color, role) => { const w = { a, b, color, role }; P.wires.push(w); inc(a, 1); inc(b, 1); return w; };
  const unwire = w => {
    const i = P.wires.indexOf(w);
    if (i >= 0) P.wires.splice(i, 1); else if (!removed.has(w)) { removed.add(w); P.remove.push(w); } else return;
    inc(w.a, -1); inc(w.b, -1);
  };
  const wiresAt = r => [...cx.wires.filter(w => !removed.has(w)), ...P.wires].filter(w => id(w.a) === id(r) || id(w.b) === id(r));
  // Broche de carte occupée (les alias, comme SDA = A4 sur l'Uno, comptent ensemble).
  const pinUsed = k => used(on(k)) || (prof.alias || []).some(al => al.includes(k) && al.some(x => used(on(x))));
  const tkey = t => (t.type === 'pin' ? 'pin:' + base(t.key) : t.type === 'pwr' ? 'pwr:' + t.v : 'gnd');
  const boardPins = t => (t.type === 'pin' ? [t.key] : t.type === 'gnd' ? Object.keys(board.pins).filter(k => isGnd(prof, base(k))) : named(t.name)).filter(k => board.pins[k]);
  // Un rail ne sert que pour son signe (+ alimentation, − masse), même si un court-circuit relie les deux.
  const matches = (net, t, g) => (g.rail && g.rail !== (t.type === 'pwr' ? '+' : t.type === 'gnd' ? '-' : null) ? false
    : t.type === 'gnd' ? net.gnd.some(x => x.comp === board)
      : t.type === 'pwr' ? net.src.some(x => x.comp === board && x.v === t.v)
        : net.gpio.some(x => x.comp === board && base(x.key) === base(t.key)));
  const HUB_ROLE = t => (t.type === 'pwr' ? tl('Alimentation {0} vers la breadboard', volts(t.v)) : t.type === 'gnd' ? tl('Masse vers la breadboard') : tl('{0} vers la breadboard', base(t.key)));

  /** Hub déjà en place : groupes de la breadboard reliés à la cible par des fils existants. */
  function findHub(t) {
    if (hubs.has(tkey(t))) return hubs.get(tkey(t));
    const groups = [];
    for (const bb of bbs) for (const g of bbGroups(bb)) {
      if (!g.keys.some(h => used({ comp: bb, key: h }))) continue;
      if (matches(A.net({ comp: bb, key: g.keys[0] }), t, g)) { groups.push({ bb, ...g }); claimed.add(bb.id + g.name); }
    }
    if (!groups.length) return null;
    const hub = { t, groups }; hubs.set(tkey(t), hub);
    return hub;
  }
  /** Groupe libre le plus proche : un rail du bon signe pour l'alimentation et la masse, sinon une bande. */
  function pickGroup(t, near) {
    const sign = t.type === 'pwr' ? '+' : t.type === 'gnd' ? '-' : null;
    for (const pass of sign ? ['rail', 'strip'] : ['strip']) {
      let best = null, bd = Infinity;
      for (const bb of bbs) for (const g of bbGroups(bb)) {
        if ((pass === 'rail') !== !!g.rail || (g.rail && g.rail !== sign)) continue;
        if (claimed.has(bb.id + g.name) || g.keys.some(h => used({ comp: bb, key: h }))) continue;
        const d = dist({ comp: bb, key: g.keys[Math.floor(g.keys.length / 2)] }, near);
        if (d < bd) { bd = d; best = { bb, ...g }; }
      }
      if (best) { claimed.add(best.bb.id + best.name); return best; }
    }
    return null;
  }
  const freeHoles = hub => hub.groups.flatMap(g => g.keys.map(key => ({ comp: g.bb, key })).filter(r => !used(r)));
  /** Trou libre le plus proche ; le dernier trou d'un groupe sert à le prolonger vers un groupe neuf. */
  function takeHole(hub, near, color) {
    let free = freeHoles(hub);
    if (free.length === 1) {
      const g = pickGroup(hub.t.type === 'pin' ? { type: 'pin' } : hub.t, near);
      if (g) { hub.groups.push(g); wire(free[0], { comp: g.bb, key: g.keys[0] }, color, tl('Pont entre deux rangées')); free = freeHoles(hub); }
    }
    return free.length ? nearest(free, near) : null;
  }
  function makeHub(t, near, color) {
    if (!bbs.length) { P.needBreadboard = true; return null; }
    const g = pickGroup(t, near);
    if (!g) return null;
    const hub = { t, groups: [g] }; hubs.set(tkey(t), hub);
    const pins = boardPins(t), free = pins.filter(k => !pinUsed(k));
    if (free.length) {
      const k = nearest(free.map(on), { comp: g.bb, key: g.keys[0] }).key;
      wire(on(k), takeHole(hub, on(k), color), color, HUB_ROLE(t));
      return hub;
    }
    // Broches de la carte toutes prises par des fils directs : on en déplace un sur le hub.
    for (const k of pins) {
      const ws = wiresAt(on(k)); if (ws.length !== 1) continue;
      const w = ws[0], other = id(w.a) === id(on(k)) ? w.b : w.a;
      if (other.comp && isBreadboard(other.comp)) continue;
      unwire(w);
      wire(on(k), takeHole(hub, on(k), color), color, HUB_ROLE(t));
      wire(other, takeHole(hub, other, color), w.color, w.role);
      return hub;
    }
    return null;
  }
  /** Relie `from` à la cible : broche libre de la carte, sinon hub de breadboard. */
  function connect(from, t, color, role, near = from) {
    let hub = findHub(t);
    // Avec une breadboard, alimentation et masse passent toujours par ses rails.
    if (!hub && (bbs.length === 0 || t.type === 'pin')) {
      const free = boardPins(t).filter(k => !pinUsed(k));
      if (free.length) { wire(from, nearest(free.map(on), near), color, role); return true; }
    }
    if (!hub || !freeHoles(hub).length) hub = makeHub(t, near, color);
    const h = hub && takeHole(hub, near, color);
    if (!h) { if (!P.needBreadboard) P.warns.push(tl('Plus de place pour « {0} » : ajoutez une breadboard.', role)); return false; }
    wire(from, h, color, role);
    return true;
  }
  /**
   * Point de jonction de plusieurs broches de composants (diode de roue libre, pont diviseur) : une bande libre
   * de la breadboard, un fil par broche. Rend le hub (on peut y prendre d'autres trous) ou null.
   */
  function junction(refs, near, color, role) {
    if (!bbs.length) { P.needBreadboard = true; return null; }
    const g = pickGroup({ type: 'pin' }, near);
    if (!g) { P.warns.push(tl('Plus de place pour « {0} » : ajoutez une breadboard.', role)); return null; }
    const hub = { t: { type: 'pin' }, groups: [g] };
    for (const r of refs) {
      const h = takeHole(hub, r.h ? near : r, color);
      if (!h) { P.warns.push(tl('Plus de place pour « {0} » : ajoutez une breadboard.', role)); return null; }
      wire(r, h, color, role);
    }
    return hub;
  }
  const hole = (hub, near, color) => takeHole(hub, near, color);
  return { connect, wire, unwire, wiresAt, used, pinUsed, nearest, named, on, junction, hole };
}

// Sens d'un signal vu du module (même tableau que circuit.js) : reçu de la carte, ou envoyé vers elle.
const FROM_BOARD = new Set(['out', 'pwm', 'mosi', 'sck', 'ss', 'rx', 'sda', 'scl', 'io']);
const TO_BOARD = new Set(['in', 'adc', 'miso', 'tx', 'sda', 'scl', 'io', 'pullup']);
const BUS_NEED = new Set(['sda', 'scl', 'sck', 'mosi', 'miso', 'ss']);
// Pont diviseur 4,7 kΩ / 10 kΩ : 5 V → 3,40 V (3,18 V derrière la sortie d'un module), dans la plage d'une entrée 3,3 V.
const DIV_TOP = 'res-4k7', DIV_BOT = 'res-10k';
/**
 * Adaptation de niveau qu'il faut pour une broche : 'board' (pont diviseur, point milieu sur la carte : le module
 * sort du 5 V vers une carte 3,3 V), 'module' (pont diviseur côté module : carte 5 V vers un module 3,3 V),
 * 'shift' (bus, dans les deux sens : adaptateur de niveau), ou null.
 */
function levelFix(p, prof, vMod, shiftAll) {
  const down = p.lv5 && TO_BOARD.has(p.need) && vMod > 4 && prof.logic < 4;
  const up = p.lv3 && FROM_BOARD.has(p.need) && prof.logic > 4;
  if (!down && !up) return null;
  if (shiftAll || BUS_NEED.has(p.need)) return 'shift';
  return down ? 'board' : 'module';
}
/** Résistance série d'un haut-parleur : la plus petite qui garde la broche sous ses 95 % conseillés. */
function speakerRes(board, prof) {
  const lim = boardLimits(board), warn = lim && lim.pin ? lim.pin.warn : 20;
  for (const [t, r] of [['res-220', 220], ['res-330', 330], ['res-1k', 1000]]) if (prof.logic / (r + 8 + 25) * 1000 <= 0.95 * warn) return t;
  return 'res-1k';
}

/**
 * Prépare le câblage d'un composant vers une carte.
 * cx = { board, A (analyse), wires, comps, dist(refA, refB) }.
 * Retourne { wires: [{ a, b, color, role }], remove: [fils à retirer], create: [{ id, type }], then: [...], warns: [] },
 * ou { needBreadboard: true } quand il faut une breadboard pour respecter « un fil par broche ».
 * Une référence { h, key } désigne une broche d'un composant à créer (résistance, batterie, pilote).
 */
export function planWiring(comp, cx) {
  const spec = partOf(comp), board = cx.board, prof = boardOf(board), A = cx.A;
  if (!spec || !spec.pins) return { error: tl('{0} : pas de câblage type pour ce composant.', comp.name) };
  const P = { wires: [], remove: [], create: [], then: [], warns: [] };
  const me = k => ({ comp, key: k }), H = (h, key) => ({ h, key });
  const anchor = me(Object.keys(comp.pins)[0]);
  const R = makeRouter(cx, P, anchor), on = R.on;
  const wired = k => A.deg(me(k)) > 0;
  let hn = 0;
  const helper = type => { const id = 'h' + hn++; P.create.push({ id, type }); return id; };
  const taken = new Set();
  // Broches du bus I2C (et leurs alias) : gardées pour les modules I2C tant qu'il reste d'autres broches.
  const i2cPins = new Set([prof.i2c.sda, prof.i2c.scl]);
  (prof.alias || []).forEach(al => { if (al.some(k => i2cPins.has(k))) al.forEach(k => i2cPins.add(k)); });
  // Bus partagé déjà pris par un autre signal (bouton, LED…) : le module ne peut pas s'y ajouter.
  const busTaken = (k, need) => {
    if (!R.pinUsed(k)) return null;
    for (const m of A.members(on(k))) {
      if (m.comp === board || isBreadboard(m.comp) || m.comp.type === 'lvlshift' || /^res-/.test(m.comp.type)) continue;
      const q = partOf(m.comp) && partOf(m.comp).pins && partOf(m.comp).pins.find(x => x.pin === m.key);
      if (!q || q.kind !== 'io' || q.need !== need) return m;
    }
    return null;
  };
  let busErr = null;
  // pull : niveau auquel le montage tirera la broche (1 haut, 0 bas) ; une broche de démarrage qui exige l'autre
  // niveau (boards.js strap) est écartée, sinon la carte ne démarrerait plus.
  const gpio = (need, from, pull = null) => {
    const strap = prof.strap || {};
    const ok = k => board.pins[k] && !R.pinUsed(k) && !taken.has(k) && (pull == null || strap[k] == null || strap[k] === pull);
    if (need === 'sda' || need === 'scl' || need === 'sck' || need === 'mosi' || need === 'miso') {
      const k = (need === 'sda' || need === 'scl' ? prof.i2c : prof.spi)[need], m = busTaken(k, need);
      if (m) { busErr = tl('{0} ({1}) est déjà prise par {2} {3} : libérez-la pour le bus.', k, ROLE[need], m.comp.name, m.key); return null; }
      return k; // bus partagé
    }
    const fixed = need === 'ss' ? prof.spi.ss : need === 'rx' && prof.uart ? prof.uart.tx : need === 'tx' && prof.uart ? prof.uart.rx : null;
    if (fixed && ok(fixed)) { taken.add(fixed); return fixed; }
    const caps = NEED_CAPS[need], list = (need === 'adc' ? prof.adcOrder : prof.order).filter(k => ok(k) && caps.every(c => prof.gpio[k].caps.has(c)))
      .sort((a, b) => i2cPins.has(a) - i2cPins.has(b));
    // Parmi les trois meilleures broches libres, la plus proche : des fils plus courts, sans sacrifier les priorités.
    if (!list.length) return null;
    const k = R.nearest(list.slice(0, 3).map(on), from).key; taken.add(k); return k;
  };
  const power = v => { const c = pickPower(typeof v === 'number' ? [v, v] : v, prof); return c && { type: 'pwr', v: c.v, name: c.name }; };
  const GND = { type: 'gnd' };

  // Charge commutée par un transistor (buzzer, ventilateur, pompe, vibreur) : alimentation au +, − au collecteur,
  // émetteur à la masse, base par sa résistance vers une broche ; diode de roue libre aux bornes d'un moteur.
  if (spec.stage) {
    const st = spec.stage, [lp, lm] = loadPins(comp);
    if (wired(lp) || wired(lm)) return P;
    const sup = power(st.v);
    if (!sup) return { error: tl('{0} : {1} ne fournit pas {2}.', comp.name, board.name, volts(st.v)) };
    const k = gpio(st.need, me(lm));
    if (!k) return { error: busErr || tl('{0} : plus de broche libre adaptée sur {1} ({2}). Câblage annulé : libérez une broche ou prenez une carte qui en a davantage.', comp.name, board.name, ROLE[st.need]) };
    const q = helper(st.q), rb = helper(st.base), sv = tl('Alimentation {0}', volts(sup.v));
    if (st.flyback) {
      const d = helper(st.flyback);
      if (st.series) {
        const rs = helper(st.series);
        if (!R.junction([me(lp), H(d, 'K'), H(rs, '2')], me(lp), COL.pwr, tl('Borne + et cathode de la diode de roue libre'))) return P.needBreadboard ? { needBreadboard: true } : P;
        R.connect(H(rs, '1'), sup, COL.pwr, tl('{0} par la résistance série', sv), me(lp));
      } else {
        R.connect(me(lp), sup, COL.pwr, sv);
        R.connect(H(d, 'K'), sup, COL.pwr, tl('Cathode de la diode de roue libre au +'), me(lp));
      }
      if (!R.junction([me(lm), H(q, 'C'), H(d, 'A')], me(lm), COL.drv, tl('Borne −, collecteur et anode de la diode'))) return P.needBreadboard ? { needBreadboard: true } : P;
    } else {
      R.connect(me(lp), sup, COL.pwr, sv);
      R.wire(me(lm), H(q, 'C'), COL.drv, tl('Vers le collecteur du transistor'));
    }
    R.connect(H(q, 'E'), GND, COL.gnd, tl('Émetteur à la masse'), me(lm));
    R.wire(H(q, 'B'), H(rb, '2'), COL.res, tl('Résistance de base'));
    R.connect(H(rb, '1'), { type: 'pin', key: k }, COL[st.need] || COL.out, tl('Commande du transistor'), me(lm));
    return P.needBreadboard ? { needBreadboard: true } : P;
  }

  // Moteur : passe par un pilote, qui sera câblé à son tour.
  if (spec.driver) {
    const [mp, mm] = motorPins(comp) || ['M+', 'M-'];
    if (wired(mp) || wired(mm)) return P;
    const free = (c, ks) => ks.every(k => !A.deg({ comp: c, key: k }));
    const drv = cx.comps.find(c => c.type === spec.driver && (free(c, ['OUT1', 'OUT2']) || free(c, ['OUT3', 'OUT4'])));
    let D, ch = ['OUT1', 'OUT2'];
    if (drv) { if (!free(drv, ch)) ch = ['OUT3', 'OUT4']; D = k => ({ comp: drv, key: k }); P.then.push({ comp: drv }); }
    else { const id = helper(spec.driver); D = k => H(id, k); P.then.push({ h: id }); }
    R.wire(me(mp), D(ch[0]), COL.drv, tl('Moteur')); R.wire(me(mm), D(ch[1]), COL.drv, tl('Moteur'));
    return P;
  }

  let bat = null;
  const battery = type => {
    if (bat) return bat;
    const c = cx.comps.find(x => x.type === type && !A.deg({ comp: x, key: '+' }) && !A.deg({ comp: x, key: '-' }));
    if (c) bat = k => ({ comp: c, key: k }); else { const id = helper(type); bat = k => H(id, k); }
    return bat;
  };

  const todo = spec.pins.filter(p => required(p, comp, A) && !wired(p.pin)).sort((a, b) => (ORDER[a.kind] ?? 2) - (ORDER[b.kind] ?? 2));
  // Tension des signaux du module : celle de son alimentation.
  const vp = spec.pins.find(p => p.kind === 'pwr'), vMod = vp ? ((power(vp.v) || {}).v ?? prof.logic) : prof.logic;
  // Un module qui a un bus à adapter passe toutes ses broches à adapter par le même adaptateur (4 voies).
  const shiftAll = todo.some(p => p.kind === 'io' && BUS_NEED.has(p.need) && levelFix(p, prof, vMod, false));
  let shiftRef = null;
  const chans = new Set();
  /** Voie libre d'un adaptateur de niveau (alimenté côté LV en 3,3 V, côté HV en 5 V) : fonction côté → broche, ou null. */
  const shifter = () => {
    const freeCh = (S, c) => [1, 2, 3, 4].find(i => !chans.has(`${c ? c.id : 'new'}|${i}`) && (!c || (!A.deg({ comp: c, key: 'LV' + i }) && !A.deg({ comp: c, key: 'HV' + i }))));
    if (!shiftRef) {
      const ex = cx.comps.find(c => c.type === 'lvlshift' && A.net({ comp: c, key: 'LV' }).src.some(x => x.v < 3.7) && A.net({ comp: c, key: 'HV' }).src.some(x => x.v > 4.4) && freeCh(null, c));
      if (ex) shiftRef = { c: ex, S: k => ({ comp: ex, key: k }) };
      else {
        const id = helper('lvlshift'), lv = power(3.3), hv = power(5);
        if (!lv || !hv) return null;
        shiftRef = { c: null, S: k => H(id, k) };
        R.connect(H(id, 'LV'), lv, COL.pwr, tl('Adaptateur de niveau : côté LV en 3,3 V'), anchor);
        R.connect(H(id, 'HV'), hv, COL.pwr, tl('Adaptateur de niveau : côté HV en 5 V'), anchor);
        R.connect(H(id, 'GND'), GND, COL.gnd, tl('Masse de l’adaptateur de niveau'), anchor);
      }
    }
    const i = freeCh(null, shiftRef.c);
    if (!i) return null;
    chans.add(`${shiftRef.c ? shiftRef.c.id : 'new'}|${i}`);
    return side => shiftRef.S(side + i);
  };
  for (const p of todo) {
    const from = me(p.pin), role = roleOf(p);
    if (p.kind === 'pwr') {
      const t = power(p.v);
      if (!t) { const [lo, hi] = vrange(p.v, prof); P.warns.push(tl('{0} {1} : {2} ne fournit rien entre {3} et {4}.', comp.name, p.pin, board.name, volts(lo), volts(hi))); continue; }
      R.connect(from, t, COL.pwr, p.role || tl('Alimentation {0}', volts(t.v)));
    } else if (p.kind === 'ext') {
      const b = battery(p.src);
      R.wire(from, b('+'), COL.pwr, role);
      R.connect(b('-'), GND, COL.gnd, tl('Masse de la batterie'), from);
    } else if (p.kind === 'vin') {
      const vin = prof.vin, free = R.named(vin.pin).filter(k => !R.pinUsed(k));
      if (spec.volts < vin.min || spec.volts > vin.max) return { error: tl('{0} ({1}) ne convient pas à l’entrée {2} de {3}, qui demande {4} à {5}.', comp.name, volts(spec.volts), vin.pin, board.name, volts(vin.min), volts(vin.max)) };
      if (!free.length) return { error: tl('{0} {1} est déjà relié.', board.name, vin.pin) };
      // Entrée déjà alimentée par l'USB à travers une diode (VSYS du Pico) : une source plus basse recevrait ce 5 V
      // (un accu lithium chargé sans contrôle). Une diode en série l'en protège, comme le recommande le constructeur.
      if ((prof.diode || []).includes(vin.pin) && spec.volts < (prof.power[vin.pin] ?? 0) + 0.3) {
        if (spec.volts - 0.7 < vin.min) return { error: tl('{0} ({1}) moins la chute d’une diode ne suffit plus à l’entrée {2} de {3}.', comp.name, volts(spec.volts), vin.pin, board.name) };
        const d = helper('diode');
        R.wire(from, H(d, 'A'), COL.pwr, tl('Diode anti-retour (anode côté batterie)'));
        R.wire(H(d, 'K'), on(free[0]), COL.pwr, tl('Alimentation {0} par la diode anti-retour', vin.pin));
      } else R.wire(from, on(free[0]), COL.pwr, tl('Alimentation {0}', vin.pin));
    } else if (p.kind === 'gnd') {
      if (p.via) { const id = helper(p.via); R.wire(from, H(id, '1'), COL.gnd, role); R.connect(H(id, '2'), GND, COL.gnd, tl('Masse'), from); }
      else R.connect(from, GND, COL.gnd, role);
    } else if (p.kind === 'io') {
      const fix0 = levelFix(p, prof, vMod, shiftAll);
      const pull = p.pull || p.idle === 1 || p.need === 'sda' || p.need === 'scl' || fix0 === 'shift' ? 1 : fix0 === 'board' ? 0 : null;
      const k = gpio(p.need, from, pull);
      if (!k) return { error: busErr || tl('{0} {1} : plus de broche libre adaptée sur {2} ({3}). Câblage annulé : libérez une broche ou prenez une carte qui en a davantage.', comp.name, p.pin, board.name, role) };
      const t = { type: 'pin', key: k }, fix = fix0;
      if (fix === 'shift') {
        const ch = shifter();
        if (!ch) return { error: tl('{0} {1} : plus de voie libre sur l’adaptateur de niveau.', comp.name, p.pin) };
        const mine = prof.logic > 4 ? 'LV' : 'HV', theirs = mine === 'LV' ? 'HV' : 'LV';
        R.wire(from, ch(mine), COL[p.need] || COL.io, tl('{0} par l’adaptateur de niveau', role));
        R.connect(ch(theirs), t, COL[p.need] || COL.io, tl('{0} par l’adaptateur de niveau', role), from);
      } else if (fix) {
        // Pont diviseur : la résistance du haut entre le signal 5 V et le point milieu, celle du bas vers la masse.
        const top = helper(DIV_TOP), bot = helper(DIV_BOT), why = tl('Pont diviseur 4,7 kΩ / 10 kΩ ({0})', role);
        if (fix === 'board') {
          R.wire(from, H(top, '1'), COL[p.need] || COL.io, why);
          const hub = R.junction([H(top, '2'), H(bot, '1')], from, COL.res, why);
          if (!hub) return P.needBreadboard ? { needBreadboard: true } : P;
          R.connect(R.hole(hub, on(k), COL.res), t, COL[p.need] || COL.io, why, from);
        } else {
          R.connect(H(top, '1'), t, COL[p.need] || COL.io, why, from);
          if (!R.junction([H(top, '2'), H(bot, '1'), from], from, COL.res, why)) return P.needBreadboard ? { needBreadboard: true } : P;
        }
        R.connect(H(bot, '2'), GND, COL.gnd, tl('Bas du pont diviseur à la masse'), from);
      } else if (p.via) {
        const id = helper(comp.type === 'speaker' ? speakerRes(board, prof) : p.via);
        R.wire(from, H(id, '2'), COL.res, tl('Résistance série ({0})', role)); R.connect(H(id, '1'), t, COL[p.need], ROLE[p.need], from);
      } else R.connect(from, t, COL[p.need] || COL.io, role);
      if (p.pull) {
        // Jonction DQ + broche + résistance : trois fils au même point, donc une bande de breadboard.
        const id = helper(p.pull), vt = power(spec.pins.find(x => x.pin === spec.pullTo).v);
        R.connect(H(id, '1'), t, COL.res, tl('Résistance de tirage'), from);
        R.connect(H(id, '2'), vt, COL.pwr, tl('Résistance de tirage'), from);
      }
    }
    if (P.needBreadboard) return { needBreadboard: true };
  }
  return P;
}

/** Relie à la masse de la carte une masse isolée (batterie…), en passant par la breadboard si besoin. */
export function planJoinGround(ref, cx) {
  const P = { wires: [], remove: [], create: [], then: [], warns: [] };
  const R = makeRouter(cx, P, ref), GND = { type: 'gnd' };
  for (const w of R.wiresAt(ref)) {
    const other = w.a.comp === ref.comp && w.a.key === ref.key ? w.b : w.a;
    R.unwire(w); R.connect(other, GND, w.color, w.role || tl('Masse'), ref);
  }
  R.connect(ref, GND, COL.gnd, tl('Masse commune'), ref);
  return P.needBreadboard ? { needBreadboard: true } : P;
}

/* ---------- Explications ---------- */
/** Broche de carte la plus parlante pour ce rôle : une masse pour GND, une alimentation pour VCC, un GPIO sinon. */
function boardPin(list, p) {
  const score = m => {
    const prof = boardOf(m.comp), b = base(m.key);
    if (p.kind === 'gnd') return isGnd(prof, b) ? 0 : 1;
    if (p.kind === 'pwr' || p.kind === 'ext') return prof.power[b] != null ? 0 : 1;
    return prof.gpio[b] ? 0 : 1;
  };
  return list.filter(m => boardOf(m.comp)).sort((a, b) => score(a) - score(b))[0];
}
function linkText(comp, p, A) {
  const r = { comp, key: p.pin };
  if (!A.deg(r)) return tl('non reliée');
  const mem = A.members(r).filter(m => m.comp !== comp && !BB.has(m.comp.type));
  const board = boardPin(mem, p), others = mem.filter(m => !boardOf(m.comp)), res = others.find(m => /^res-/.test(m.comp.type));
  if (board) return `→ ${pinName(board)}${res ? `, ${res.comp.name}` : ''}`;
  const far = res && boardPin(A.wmembers(r), p);
  if (far) return `→ ${res.comp.name} → ${pinName(far)}`;
  return others.length ? '→ ' + others.slice(0, 2).map(m => `${m.comp.name} ${m.key}`).join(', ') : tl('→ breadboard seulement');
}
function pinReason(g, need) {
  const out = [];
  if (g.g.note) out.push(g.g.note);
  if (need === 'adc' && g.prof.adcNote) out.push(g.prof.adcNote);
  if ((need === 'sda' || need === 'scl') && base(g.key) === g.prof.i2c[need]) out.push(tl('broche {0} par défaut de la bibliothèque Wire', need.toUpperCase()));
  return out.length ? ' ' + tl('{0} : {1}.', g.key, out.join(tl(' ; ')).replace(/\.$/, '')) : '';
}
function whyText(p, ins) {
  let t = p.why || '';
  if (p.kind === 'gnd' && !p.why) t = GND_WHY;
  if ((p.kind === 'pwr' || p.kind === 'ext') && p.v && !(p.v === 'logic' && p.why)) {
    const [lo, hi] = vrange(p.v, ins.prof);
    t = tl('Alimentation, {0}.{1}', p.v === 'logic' ? tl('à la tension logique de la carte ({0})', volts(hi)) : tl('{0} à {1}', volts(lo), volts(hi)), t ? ' ' + t : '');
  }
  const g = ins.io[p.pin];
  return g ? t + pinReason(g, p.need) : t;
}

/**
 * Explique un composant : rôle de chaque broche, où elle est reliée, ce qui ne va pas,
 * et le code Arduino correspondant aux broches réellement utilisées.
 */
export function explain(comp, A, comps) {
  const prof = boardOf(comp);
  if (prof) {
    const others = comps.filter(c => c !== comp && wirable(c));
    return {
      lead: tl('{0} · logique {1} · ADC {2} bits (0 à {3}).', prof.label, volts(prof.logic), prof.adcBits, 2 ** prof.adcBits - 1),
      rows: [],
      notes: [
        tl('Alimenter les modules : {0} (3,3 V) ou {1} (5 V). Masse : GND.', prof.three, prof.five),
        tl('I2C : SDA {0}, SCL {1}. SPI : SCK {2}, MISO {3}, MOSI {4}, SS {5}.', prof.i2c.sda, prof.i2c.scl, prof.spi.sck, prof.spi.miso, prof.spi.mosi, prof.spi.ss),
        tl('Entrées analogiques : {0}.', prof.adcOrder.join(', ')),
        ...prof.tips
      ],
      canWire: others.length > 0, todo: others.some(c => needsWiring(c, A)), board: true
    };
  }
  const spec = partOf(comp);
  if (!spec) return { lead: comp.type === 'custom' ? tl('Modèle importé : placez ses broches, puis reliez-les à la main.') : tl('Pas de fiche pour ce composant.'), rows: [], notes: [], canWire: false };
  const notes = [...(spec.notes || [])];
  if (!spec.pins) return { lead: spec.what, rows: [], notes, canWire: false };
  const ins = inspect(comp, A, spec);
  let todo = false;
  const rows = spec.pins.filter(p => comp.pins[p.pin]).map(p => {
    const r = { comp, key: p.pin }, linked = A.deg(r) > 0, need = required(p, comp, A), st = ins.pins[p.pin] || { level: 'ok', msgs: [] };
    if (!linked && need) todo = true;
    const level = !linked ? (need ? 'todo' : 'free') : st.level === 'free' ? 'ok' : st.level;
    return { pin: p.pin, role: roleOf(p), to: linked ? linkText(comp, p, A) : need ? tl('à câbler') : 'libre', why: whyText(p, ins), level, msgs: linked ? st.msgs.map(m => m.text) : [] };
  });
  if (spec.tips) notes.push(...spec.tips(ins.prof));
  let code = '';
  if (spec.code) {
    const p = {};
    spec.pins.forEach(x => { p[x.pin] = ins.io[x.pin] ? codePin(ins.io[x.pin]) : '?'; });
    code = spec.code(p, ins.prof);
  }
  const lib = typeof spec.lib === 'function' ? spec.lib(ins.prof) : spec.lib;
  return { lead: spec.what, rows, notes, code, lib, canWire: true, todo, level: ins.level };
}
