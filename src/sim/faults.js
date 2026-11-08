// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Erreurs de câblage détectées pendant la simulation. Pour chacune : où elle se
// trouve (broche fautive, broche en cause à l'autre bout, fils du chemin), pourquoi
// c'est un problème dans un vrai montage, comment corriger, et la bonne broche
// quand le câblage automatique sait la trouver.
import { BOARDS, pinName, volts, boardOf } from './boards.js';
import { PARTS, partOf, MOTORS, NPNS } from './parts.js';
import { inspect, pid as pinId } from './circuit.js';
import { planWiring } from './autowire.js';
import { boardLimits } from '../check/limits.js';
import { tl } from '../i18n/index.js';
import { pkgLed } from './pkgparts.js';

const LED = /^led-(red|green|blue|yellow|white)$/, BB = /^breadboard/;
const pid = r => `${r.comp.id}|${r.key}`;
const ref = r => ({ comp: r.comp, key: r.key });
const nm = r => (boardOf(r.comp) ? pinName(r) : `${r.comp.name} ${r.key}`);
const NEED = { io: tl('numérique'), in: tl('d’entrée'), out: tl('de sortie'), pullup: tl('d’entrée avec tirage interne'), pwm: 'PWM', adc: tl('analogique (ADC)'), sda: 'SDA', scl: 'SCL', sck: 'SCK', mosi: 'MOSI', miso: 'MISO', ss: tl('de sortie'), rx: 'TX', tx: 'RX' };
const CAP_WHY = {
  adc: tl('Seules certaines broches sont reliées au convertisseur analogique-numérique (ADC). Ailleurs, analogRead() ne mesure rien d’utile.'),
  out: tl('Cette broche n’a pas d’étage de sortie : elle ne peut rien allumer ni commander. Sur l’ESP32, D34, D35, VP et VN sont des entrées seulement.'),
  pu: tl('Cette broche n’a pas de résistance de tirage interne : au repos, l’entrée « flotte » et lit des 0 et des 1 au hasard, comme si quelqu’un appuyait tout seul.'),
  pwm: tl('Cette broche ne sait pas produire de PWM : impossible de régler une vitesse, une luminosité ou l’angle d’un servo.'),
  in: tl('Cette broche ne peut pas être lue comme entrée numérique.')
};
const NPN_NORES = tl('La jonction base-émetteur se comporte comme une diode : sans résistance, rien ne limite le courant de base. La broche de la carte et le transistor chauffent et peuvent griller.');
const SHORT_FIX = tl('Retirez le fil qui relie ces deux broches : chacune doit aller vers le composant qu’elle alimente, jamais directement l’une vers l’autre.');

/** Titre, explication physique et effet visuel de chaque erreur. */
const TEXT = {
  'short-v': { title: () => tl('Court-circuit entre deux alimentations'), fx: 'short',
    why: tl('Deux sources de tension différentes reliées se battent : la plus forte débite dans la plus faible et rien ne limite le courant. Le régulateur chauffe, le port USB se coupe, ou la carte grille.') },
  'short-g': { title: () => tl('Court-circuit : alimentation reliée à la masse'), fx: 'short',
    why: tl('Le + est relié directement à la masse : rien ne limite le courant. Dans la réalité : étincelle, fil qui chauffe, port USB qui se coupe ou régulateur détruit.') },
  nopower: { title: (c, k) => tl('{0} n’est pas alimenté ({1})', c.name, k),
    why: tl('Sans tension sur cette broche, le composant reste éteint. Il ne répond pas, et la carte lit une valeur vide : NaN pour un DHT, 0 ou −127 pour d’autres capteurs, écran noir.') },
  undervolt: { title: (c, k) => tl('Tension trop faible sur {0} {1}', c.name, k),
    why: tl('Sous sa tension minimale, un module fonctionne mal ou pas du tout : mesures fausses, redémarrages, relais qui ne colle pas, ultrasons sans écho.') },
  overvolt: { title: (c, k) => tl('Surtension sur {0} {1}', c.name, k), fx: 'smoke',
    why: tl('Chaque puce supporte une tension maximale. Au-delà, ses transistors claquent : elle chauffe, peut fumer, et meurt souvent définitivement. Dans la réalité on ne voit parfois rien : le module ne marche simplement plus.') },
  nognd: { title: (c, k) => tl('{0} : masse non reliée ({1})', c.name, k),
    why: tl('Le courant entre par l’alimentation et doit ressortir par la masse. Sans ce chemin de retour, rien ne circule : le module reste éteint, même si VCC est bien branché.') },
  commongnd: { title: c => tl('{0} : masse non commune avec la carte', c.name),
    why: tl('Une tension se mesure toujours par rapport à une référence. Si le module et la carte n’ont pas la même masse, le « 3,3 V » envoyé par l’un ne veut rien dire pour l’autre : signaux illisibles ou aléatoires.') },
  nogpio: { title: (c, k) => tl('{0} {1} n’arrive pas à la carte', c.name, k),
    why: tl('Ce signal n’atteint aucune broche d’entrée/sortie de la carte : le programme ne peut ni le lire ni le commander.') },
  topwr: { title: (c, k) => tl('{0} {1} reliée à l’alimentation', c.name, k),
    why: tl('Une broche de signal reliée directement à l’alimentation est bloquée à l’état haut. Si le programme met la broche de la carte à LOW, le courant traverse la sortie sans limite : elle grille.') },
  togn: { title: (c, k) => tl('{0} {1} reliée à la masse', c.name, k),
    why: tl('Une broche de signal reliée directement à la masse est bloquée à 0 V. Si le programme met la broche de la carte à HIGH, la sortie débite sans limite dans la masse : elle grille.') },
  cap: { title: (c, k, m) => tl('{0} ne convient pas à {1} {2}', m.culprit.key, c.name, k), why: m => CAP_WHY[m.miss[0]] || CAP_WHY.in },
  flash: { title: (c, k, m) => tl('{0} est réservée à la mémoire flash', m.culprit.key),
    why: tl('Ces broches pilotent la mémoire flash qui contient le programme. Y brancher autre chose fait planter la carte dès le démarrage.') },
  uart0: { title: (c, k, m) => tl('{0} est le port série USB', m.culprit.key),
    why: tl('Ces broches servent au téléversement et au moniteur série. Un module branché dessus brouille la liaison : le téléversement échoue et les messages deviennent illisibles.') },
  bus: { title: (c, k, m) => tl('{0} {1} n’est pas sur le bus {2}', c.name, k, m.bus),
    why: m => tl('Le bus {0} de la carte est sur {1}. Sur ESP32 ou Pico, on peut choisir d’autres broches dans le code ; sur Arduino Uno et Nano, le bus matériel est câblé sur des broches fixes, rien d’autre ne marche.', m.bus, m.want) },
  pulldown: { title: c => tl('{0} : résistance de rappel manquante', c.name),
    why: tl('Bouton relié à l’alimentation : appuyé, l’entrée passe à HIGH. Relâché, plus rien ne la relie : elle « flotte » et lit des 0 et des 1 au hasard. Une résistance vers la masse la ramène à LOW au repos.') },
  swshort: { title: c => tl('{0} : court-circuit quand on appuie', c.name),
    why: tl('Le bouton relie directement le + à la masse : appuyer met la pile ou l’alimentation en court-circuit. Rien ne limite le courant : la pile chauffe et se vide, un fil fin peut brûler, un port USB se coupe.') },
  pullup: { title: c => tl('{0} : résistance de tirage manquante', c.name),
    why: tl('Le bus 1-Wire est à « drain ouvert » : la sonde sait seulement tirer la ligne vers 0 V. Sans résistance de 4,7 kΩ vers VDD, la ligne ne remonte jamais au niveau haut et aucune donnée ne passe : la lecture renvoie −127 °C.') },
  nores: { title: (c, k) => tl('{0} {1} sans résistance', c.name, k),
    why: (m, c) => (c && NPNS[c.type] ? NPN_NORES : tl('Une LED n’a presque pas de résistance interne : sans résistance en série, seule la broche limite le courant. La LED et la sortie de la carte chauffent et s’usent vite, parfois instantanément.')) },
  lv5: { title: (c, k) => tl('Signal 5 V vers une carte 3,3 V ({0} {1})', c.name, k),
    why: tl('La carte fonctionne en 3,3 V : ses entrées ne sont pas prévues pour 5 V. Ça marche souvent… jusqu’au jour où la broche lâche.') },
  lv3: { title: (c, k) => tl('{0} {1} reçoit des signaux à 5 V', c.name, k),
    why: tl('Ce module fonctionne en 3,3 V, mais la carte lui envoie des signaux à 5 V, au-delà de ce qu’il tolère.') },
  drvdirect: { title: c => tl('{0} branché directement sur la carte', c.name), fx: 'smoke',
    why: tl('Un moteur tire des centaines de milliampères et renvoie des pointes de tension en s’arrêtant. Une broche de carte fournit au mieux 20 à 40 mA : elle grille, ou la carte redémarre en boucle.') },
  drvmissing: { title: c => tl('{0} n’est pas relié au pilote', c.name),
    why: tl('Le moteur doit être branché sur les sorties de puissance du pilote (OUT1 à OUT4), qui reçoivent le courant de la batterie.') },
  reversed: { title: c => tl('{0} est montée à l’envers', c.name),
    why: tl('Une LED ne laisse passer le courant que de l’anode (patte longue) vers la cathode (patte courte, côté méplat). À l’envers, elle reste éteinte ; à basse tension, elle n’est pas abîmée.') },
  gpioover: { title: (c, k) => tl('{0} {1} surchargée', c.name, k), fx: 'smoke',
    why: tl('Une broche de carte fournit au plus 20 à 40 mA. Un moteur, un ventilateur ou un buzzer en demande bien plus : la sortie chauffe, la tension s’effondre, et la puce peut griller.') },
  motorover: { title: c => tl('{0} reçoit trop de tension', c.name),
    why: tl('Au-delà de sa tension prévue, un moteur tourne trop vite, chauffe et s’use : balais, roulements et bobinage souffrent. Un petit ventilateur ou un vibreur peut griller.') },
  fanrev: { title: c => tl('{0} est branché à l’envers', c.name),
    why: tl('Un ventilateur d’ordinateur contient une petite électronique qui ne fonctionne que dans un sens : branché à l’envers, il ne tourne pas (sans dommage, en général).') },
  servolow: { title: c => tl('{0} manque de tension', c.name),
    why: tl('Un servo demande 4,8 à 6 V et jusqu’à 500 mA quand il bouge. En dessous, il tremble, avance par à-coups ou ne bouge plus, et la carte peut redémarrer.') },
  capreversed: { title: c => tl('{0} est monté à l’envers', c.name), fx: 'smoke',
    why: tl('Un condensateur électrolytique est polarisé : sa borne − (côté bande claire) doit rester au potentiel le plus bas. À l’envers, la fine couche isolante à l’intérieur se dissout : il chauffe, gonfle et peut éclater.') }
};

function fixText(code, k, cul, sug, m, c) {
  const to = sug ? nm(sug) : null;
  switch (code) {
    case 'nopower': case 'nognd': return to ? tl('Reliez {0} à {1}.', k, to) : tl('Reliez {0} à {1}.', k, code === 'nognd' ? tl('GND de la carte') : tl('l’alimentation de la carte'));
    case 'undervolt': case 'overvolt': return tl('Débranchez {0} de {1}{2}.', k, nm(cul), to ? tl(' et reliez-la à {0}', to) : tl(' : il lui faut entre {0} et {1}', volts(m.lo), volts(m.hi)));
    case 'commongnd': return tl('Reliez {0} à GND de la carte : toutes les masses doivent être communes.', nm(cul));
    case 'nogpio': return tl('Reliez {0} à une broche {1} de la carte{2}.', k, NEED[m.need] || '', to ? tl(', par exemple {0}', to) : '');
    case 'topwr': case 'togn': return tl('Retirez le fil entre {0} et {1}{2}.', k, nm(cul), to ? tl(', puis reliez {0} à {1}', k, to) : '');
    case 'cap': case 'flash': case 'uart0': case 'bus': return to ? tl('Déplacez le fil de {0} vers {1}.', nm(cul), to) : tl('Choisissez une autre broche que {0}.', nm(cul));
    case 'pulldown': return tl('Reliez l’autre patte du bouton à la masse au lieu de l’alimentation (l’entrée utilise alors sa résistance de tirage interne, appuyé = LOW), ou ajoutez une résistance de 10 kΩ entre la broche de la carte et la masse. « Relier à la masse » fait le premier pour vous.');
    case 'swshort': return tl('Placez ce que le bouton commande (résistance et LED, moteur…) entre le bouton et la masse : seul, il ne doit jamais relier le + à la masse. « Retirer le fil » débranche d’abord le côté masse.');
    case 'pullup': return tl('Ajoutez une résistance de 4,7 kΩ entre DQ et VDD. « Recâbler » le fait pour vous.');
    case 'nores': return k === 'COM' ? tl('Insérez une résistance de 220 Ω entre le commun et la masse.')
      : c && NPNS[c.type] ? tl('Insérez une résistance de 1 kΩ entre la broche de la carte et la base.') : tl('Insérez une résistance de 220 Ω entre la broche de la carte et l’anode.');
    case 'lv5': if (c && c.type === 'button') return tl('Reliez l’autre patte du bouton au 3V3 de la carte au lieu du 5 V : appuyé, l’entrée recevra 3,3 V. « Brancher sur 3V3 » le fait pour vous.');
      return tl('Passez par un pont diviseur : 4,7 kΩ en série depuis le module, 10 kΩ vers la masse. Le point milieu (5 V × 10/14,7 ≈ 3,4 V) va à la carte. Pour un bus (I2C, SPI), prenez un adaptateur de niveau. « Recâbler » le fait pour vous.');
    case 'lv3': return tl('Ajoutez un adaptateur de niveau logique, ou utilisez une carte en 3,3 V (ESP32, Pico).');
    case 'drvdirect': case 'drvmissing': return tl('Reliez le moteur aux sorties OUT1 et OUT2 d’un pilote L298N, et le pilote à la carte. « Recâbler » le fait pour vous.');
    case 'reversed': return tl('Inversez les deux fils : la patte longue (anode) côté broche de la carte, la patte courte (cathode) côté masse.');
    case 'capreversed': return tl('Inversez les deux fils : la borne + (patte longue) côté tension la plus haute, la borne − (patte courte, bande claire) côté masse.');
    case 'gpioover': return tl('Commandez la charge par un transistor (NPN, résistance de 1 kΩ sur la base) ou un relais, alimentés par une pile ou le 5 V : la broche ne fait plus que donner l’ordre.');
    case 'motorover': return tl('Alimentez-le sous {0} environ (pile de 4,5 V, 4 piles AA, le 5 V), ou baissez sa tension moyenne en PWM.', volts(m.vNom));
    case 'fanrev': return tl('Inversez les deux fils : rouge (+) vers l’alimentation, noir (−) vers la masse ou le transistor.');
    case 'servolow': return tl('Alimentez le servo en 5 V (broche 5V de la carte, ou une alimentation 5 V reliée à la masse de la carte).');
    default: return SHORT_FIX;
  }
}
// Erreurs que le câblage automatique sait réparer (en retirant puis en recâblant la broche).
const REWIRE = new Set(['nopower', 'undervolt', 'overvolt', 'nognd', 'nogpio', 'topwr', 'togn', 'cap', 'flash', 'uart0', 'bus', 'pullup', 'nores', 'drvdirect', 'drvmissing']);
const MISSING = new Set(['nopower', 'nognd', 'nogpio', 'drvmissing']);
const SUGGEST = new Set(['nopower', 'undervolt', 'overvolt', 'nognd', 'nogpio', 'topwr', 'togn', 'cap', 'flash', 'uart0', 'bus']);

/** Bonne broche de la carte pour `key`, d'après le câblage automatique (sans tenir compte du fil fautif). */
function suggest(comp, key, cx) {
  const board = cx.boardFor(comp);
  if (!board) return null;
  const at = w => (w.a.comp === comp && w.a.key === key) || (w.b.comp === comp && w.b.key === key);
  const A = { ...cx.A, deg: r => (r.comp === comp && r.key === key ? 0 : cx.A.deg(r)) };
  const plan = planWiring(comp, { board, A, wires: cx.wires.filter(w => !at(w)), comps: cx.comps, dist: cx.dist });
  for (const s of plan.wires || []) {
    if (!s.a.h && s.a.comp === comp && s.a.key === key && !s.b.h) return ref(s.b);
    if (!s.b.h && s.b.comp === comp && s.b.key === key && !s.a.h) return ref(s.a);
  }
  return null;
}

/**
 * Liste les erreurs de câblage du montage. Un composant sans aucun fil est ignoré :
 * il n'est pas encore câblé, ce n'est pas une erreur.
 * cx = { dist(refA, refB), boardFor(comp) }.
 */
export function collectFaults(comps, wires, A, cx) {
  const ctx = { ...cx, A, wires, comps }, out = [];
  for (const is of A.issues) {
    const T = TEXT[is.code], path = A.path(is.a, is.b);
    // Fil suspect : le seul du chemin, sinon un cavalier entre deux trous de breadboard.
    const cut = path.length === 1 ? path[0] : path.find(w => BB.test(w.a.comp.type) && BB.test(w.b.comp.type));
    out.push({ key: `${is.code}|${pid(is.a)}|${pid(is.b)}`, level: 'err', code: is.code, title: T.title(), where: `${nm(is.a)} ↔ ${nm(is.b)}`,
      why: T.why, fix: cut && path.length > 1 ? tl('{0} Ici, le fil suspect relie {1} {2} à {3} {4}.', SHORT_FIX, cut.a.comp.name, cut.a.key, cut.b.comp.name, cut.b.key) : SHORT_FIX,
      pins: [ref(is.a), ref(is.b)], culprits: [], wires: path, cutWire: cut || null, fx: T.fx, comp: null, suggest: null,
      actions: cut ? ['see', 'cut'] : ['see'] });
  }
  for (const c of comps) {
    const spec = partOf(c);
    if (!spec || !spec.pins || !Object.keys(c.pins).some(k => A.deg({ comp: c, key: k }))) continue;
    // LED de la bibliothèque (A, K) ou LED en paquet (.jpart), à l'anode et à la cathode qu'il déclare.
    const pl = !LED.test(c.type) && pkgLed(c.type), ka = pl ? pl.anode : 'A', kk = pl ? pl.cathode : 'K';
    if (LED.test(c.type) || pl) {
      const a = A.wnet({ comp: c, key: ka }), k = A.wnet({ comp: c, key: kk });
      if (a.gnd.length && (k.gpio.length || k.src.length)) {
        const pins = [{ comp: c, key: ka }, { comp: c, key: kk }];
        out.push({ key: `reversed|${c.id}`, level: 'err', code: 'reversed', title: TEXT.reversed.title(c), where: tl('{0} A → masse, K → {1}', c.name, nm(k.gpio[0] || k.src[0])),
          why: TEXT.reversed.why, fix: fixText('reversed'), pins, culprits: [], wires: pins.flatMap(A.wiresAt), comp: c, suggest: null, actions: ['see', 'swap'], ...(ka !== 'A' || kk !== 'K' ? { swap: [ka, kk] } : {}) });
        continue;
      }
    }
    const ins = inspect(c, A, spec);
    for (const [k, st] of Object.entries(ins.pins)) for (const m of st.msgs) {
      const T = TEXT[m.code]; if (!T) continue;
      const r = { comp: c, key: k }, cul = m.culprit ? ref(m.culprit) : null, wired = A.deg(r) > 0;
      const sug = SUGGEST.has(m.code) ? suggest(c, k, ctx) : null;
      const actions = ['see'];
      if (REWIRE.has(m.code)) actions.push(wired ? 'rewire' : 'wire');
      if (m.code === 'commongnd') actions.push('joingnd');
      // Bouton : l'autre patte change de nœud (masse, 3V3) ou se débranche ; l'entrée de la carte ne bouge pas.
      const other = c.type === 'button' ? { comp: c, key: k === '1' ? '2' : '1' } : null;
      if (other && m.code === 'pulldown') actions.push('tognd');
      if (other && m.code === 'lv5') actions.push('to3v3');
      const cutAt = other && m.code === 'swshort' ? A.wiresAt(other) : null;
      if (cutAt && cutAt.length) actions.push('cut');
      // Une broche simplement pas encore câblée n'est pas une faute : signalée sans alarme.
      const missing = !wired && MISSING.has(m.code);
      out.push({
        key: `${m.code}|${pid(r)}`, level: missing ? 'warn' : m.level, missing, code: m.code, title: T.title(c, k, m),
        where: `${nm(r)} → ${cul ? nm(cul) : ins.io[k] ? nm(ins.io[k]) : wired ? tl('ne mène à rien') : tl('non reliée')}`,
        why: typeof T.why === 'function' ? T.why(m, c) : T.why, fix: fixText(m.code, k, cul, sug, m, c),
        pins: [r], culprits: cul ? [cul] : [], wires: cutAt ? [...A.wiresAt(r), ...cutAt] : cul ? A.path(r, cul) : A.wiresAt(r), fx: T.fx || null,
        comp: c, suggest: sug && { from: r, to: sug }, actions, other, cutWire: cutAt ? cutAt[0] : null
      });
    }
  }
  return out.sort((a, b) => (a.level === 'err' ? 0 : 1) - (b.level === 'err' ? 0 : 1));
}

// Au-delà de cette tension inverse, un électrolytique est en danger (quelques dixièmes passent).
const REV_V = 1;
/**
 * Erreurs que seul le solveur voit (dc = résultat de solveDC) : électrolytique polarisé à l'envers.
 * Même forme que collectFaults ; A (analyse, facultative) retrouve les fils en cause.
 * La correction « swap » inverse les broches de f.swap (+ et −).
 */
export function elecFaults(dc, comps, A) {
  const out = [];
  if (!dc || !dc.ok || typeof dc.capV !== 'function') return out;
  for (const c of comps) {
    if (!c || c.type !== 'cap-100u') continue;
    const v = dc.capV(c);
    if (v == null || v > -REV_V) continue;
    const pins = [{ comp: c, key: '+' }, { comp: c, key: '-' }];
    out.push({ key: `capreversed|${c.id}`, level: 'err', code: 'capreversed', title: TEXT.capreversed.title(c),
      where: tl('{0} : borne − {1} au-dessus de la borne +', c.name, volts(-v)),
      why: TEXT.capreversed.why, fix: fixText('capreversed'), pins, culprits: [], wires: A ? pins.flatMap(A.wiresAt) : [],
      fx: TEXT.capreversed.fx, comp: c, suggest: null, actions: ['see', 'swap'], swap: ['+', '-'] });
  }
  // Effecteurs et broches de carte d'après le calcul : surcharge, surtension, polarité, servo sous-alimenté.
  const make = (code, c, k, level, where, extra = {}) => {
    const pins = k ? [{ comp: c, key: k }] : Object.keys(c.pins).filter(x => A && A.deg({ comp: c, key: x })).map(x => ({ comp: c, key: x }));
    out.push({ key: `${code}|${c.id}${k ? '|' + k : ''}`, level, code, title: TEXT[code].title(c, k), where, why: TEXT[code].why, fix: fixText(code, k, null, null, extra, c),
      pins, culprits: [], wires: A ? pins.flatMap(A.wiresAt) : [], fx: extra.fx || null, comp: c, suggest: null, actions: extra.actions || ['see'], swap: extra.swap });
  };
  const inj = dc.injections();
  for (const c of comps) {
    if (!c) continue;
    const prof = boardOf(c);
    if (prof && prof.gpio) {
      const L = boardLimits(c), maxPin = L && L.pin ? L.pin.max : 40; // 40 mA (ATmega328P), 20 (ESP8266), 16 (RP2040)…
      for (const k in prof.gpio) {
        if (!c.pins[k]) continue;
        const mA = inj.get(pinId(c, k));
        if (mA != null && Math.abs(mA) > maxPin) make('gpioover', c, k, 'err', tl('{0} {1} : {2} mA', c.name, k, Math.round(Math.abs(mA))), { fx: 'smoke' });
      }
      continue;
    }
    const m = MOTORS[c.type], a = (m || c.type === 'servo') && dc.across(c);
    if (!a || a.v == null) continue;
    if (m) {
      if (m.polar && a.v < -m.vStart) make('fanrev', c, null, 'warn', tl('{0} : {1} sur le fil rouge', c.name, volts(a.v)), { actions: ['see', 'swap'], swap: [m.plus, m.minus] });
      else if (Math.abs(a.v) > m.vMax) { const hot = !m.rev && Math.abs(a.v) > 1.6 * m.vNom; make('motorover', c, null, hot ? 'err' : 'warn', tl('{0} : {1} pour {2} prévus', c.name, volts(Math.abs(a.v)), volts(m.vNom)), { vNom: m.vNom, fx: hot ? 'smoke' : null }); }
    } else if (a.v > 0.5 && a.v < 4.2) make('servolow', c, null, 'warn', tl('{0} : {1} entre VCC et GND', c.name, volts(a.v)));
  }
  return out;
}
