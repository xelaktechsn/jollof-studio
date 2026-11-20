// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Règles : mesures, actions et code des composants de la bibliothèque au-delà du jeu de base de rules.js
// (capteurs I2C, entrées à événements, écrans, modules de communication, puces logiques, horloges, mémoires).
// rules.js fusionne PART_SIGNALS et PART_ACTIONS dans SIGNALS et ACTIONS, et appelle PART_GEN pour écrire le code.
//
// PART_SIGNALS[type][clé] : comme SIGNALS de rules.js — { label, neg?, kind: 'num'|'bool'|'text'|'time', unit?, def?,
//   range?, v (nom de variable), type?: 'float'|'int'|'long', short?, note?, event?: true (vrai le seul tour où il arrive :
//   code reçu, touche, badge, message), len?: n (texte : longueur maximale), fail?: true (le capteur peut tomber en panne :
//   une mesure « est en panne » est ajoutée) }.
// PART_ACTIONS[type][clé] : comme ACTIONS de rules.js — { label, arg?: { kind: 'num'|'text'|'color', def, min, max, step?, unit? },
//   follow?: [min, max], what?: true (l'action prend une valeur choisie par l'élève — mesure ou variable : « envoie la valeur de… »),
//   once?: true (action ponctuelle — envoyer un message, enregistrer une ligne : sous une condition qui dure, faite une seule
//   fois quand la condition devient vraie) }. Écrans : actions « text » (texte), « value » (mesure ou variable choisie), « clear ».
//
// PART_GEN[type] = {
//   read(g, c, key, sig, out) → null | {
//     expr?: 'expression C++',     lue à chaque tour de loop() (lecture rapide : digitalRead, analogRead, compteur…)
//     every?: ms, why?: 'texte',    capteur lent ou sur un bus : lu toutes les `every` ms, valeur gardée dans out.v (global)
//     lines?: ['…'],               instructions (au lieu d'expr) qui affectent out.v ; événement : elles mettent out.ev à true
//     bad?: 'condition C++ sur x', mesure fraîche `x` invalide (isnan(x), x < 0…) : la dernière bonne valeur est gardée
//   }
//     out : { v: nom de la variable de la mesure, ev: nom du drapeau d'événement (event), ok: drapeau « fonctionne » (fail),
//             type: type C++ de la variable }.
//   actor(g, c) → null | ((act, arg, x, label, row) → ['lignes C++']) ; arg : réglage déjà borné à [min, max] ; x : sous
//     « fait varier », nom de la variable int16_t de la consigne ; pour une action `what`, { v: expression, sig, label }.
//     fn.guard = true : écriture coûteuse (bus, écran),
//     le code n'est réécrit que si l'ordre change. Écrans : fn.rows = nombre de lignes ; act « text » (arg),
//     « value » (label : { name, v, d, unit, kind }), « clear » ; row : ligne (0…rows-1) à écrire, le cœur ne réécrit
//     une ligne que si son contenu change.
// }
// g : contexte de génération (createGenContext de rules.js) : inc, glob, setup, pre, tail, helpers, notes, pinConst(c, k),
//   objName(c), uniq(n), missing(c, quoi), first(c) (vrai la première fois pour ce composant), flash(texte), cstr(texte),
//   avr, kind, prof, max (ADC), i2cAddr(c, broche, basse, haute), fast() (loop() ne doit jamais dormir), robust.
//
// Règles d'écriture du code produit ici (comme le cœur) : ni String ni allocation (tampons de char de taille fixe, strlcpy),
// textes fixes en flash sur AVR (F(), PSTR), types de taille fixe, rien de bloquant dans loop() (millis(), lectures sans
// attente), erreurs du bus vérifiées (endTransmission(), begin()) : un capteur qui ne répond plus garde sa dernière bonne
// mesure et compte ses échecs (« est en panne »), sorties réécrites seulement quand elles changent (image en mémoire écrite
// en fin de tour, ou fn.guard). Lignes de setup() : le cœur supprime les lignes identiques ; un bloc de plusieurs lignes
// est donc écrit entre { } (ses lignes, indentées, sont gardées telles quelles).
import { tl } from '../i18n/index.js';
import { isEsp32 } from './api.js';
import { SERIAL_PINS } from '../sim/serialmods.js';
import { ACS712, acsRange } from '../sim/parts.js';
import { rOf } from '../sim/circuit.js';
import { isResistor } from '../sim/pkgparts.js';
import { ethRead } from './rules-net.js';

/* ---------------- Outils communs ---------------- */
/** État de génération d'un composant (une fois par programme produit). */
const STATE = new WeakMap();
const st = (g, c) => { let m = STATE.get(g); if (!m) STATE.set(g, (m = new Map())); if (!m.has(c.id)) m.set(c.id, {}); return m.get(c.id); };
/** État commun à toute la carte (ports série déjà pris…). */
const BOARD = { id: '@carte' };
const ind = (lines, n = 1) => lines.map(l => '  '.repeat(n) + l);
/** Remplit {0}, {1}… (lignes de code sans texte à traduire). */
const fmt = (t, ...a) => t.replace(/\{(\d+)\}/g, (m, i) => a[+i]);
const hex2 = n => `0x${(n & 255).toString(16).toUpperCase().padStart(2, '0')}`;
const lit = n => (Number.isInteger(n) ? `${n}.0f` : `${+n.toPrecision(7)}f`);
/** Fonction d'aide ajoutée une seule fois au programme (repérée par sa signature). */
const helper = (g, sig, lines) => { if (!g.helpers.some(h => h.includes(sig))) g.helpers.push(lines.join('\n')); };
/** Bus I2C démarré par le programme (avant les modules). */
const wire = g => { g.inc.add('Wire.h'); if (!g.setup.includes('Wire.begin();')) g.setup.push('Wire.begin();'); };
/** Un module I2C répond-il à son adresse ? (contrôle sans rien lire ni écrire, avant de faire confiance à une lecture) */
function i2cProbe(g) {
  wire(g);
  helper(g, 'bool i2cRepond(', [tl('// Un module I2C répond-il à son adresse ? (rien n’est lu ni écrit : un module débranché est repéré tout de suite)'),
    'bool i2cRepond(uint8_t adresse) {', '  Wire.beginTransmission(adresse);', '  return Wire.endTransmission() == 0;', '}']);
  return 'i2cRepond';
}
/** Lignes de setup() quand un module ne répond pas au démarrage : message, et ses mesures restent « en panne ». */
const absent = (g, c, what, failing = true) => [`  Serial.println(${g.flash(tl('{0} introuvable : vérifiez {1}', c.name, what))});`, ...(failing ? [`  ${g.failVar(c)} = 255;`] : [])];
/** Échec d'une lecture : un de plus (la dernière bonne mesure reste). */
const failInc = (g, c) => tl('if ({0} < 255) {0}++; // mesure ratée : la précédente reste', g.failVar(c));
/** Lignes faites une seule fois par composant (lecture commune à plusieurs mesures), dans la première mesure lue. */
const pollOnce = (g, c, lines) => { const s = st(g, c); if (s.polled) return []; s.polled = true; return lines; };
/** Texte fixe copié dans un tableau de char (depuis la flash sur AVR). */
const copyLit = (g, dst, text) => (g.avr ? `strlcpy_P(${dst}, PSTR(${g.cstr(text)}), sizeof(${dst}));` : `strlcpy(${dst}, ${g.cstr(text)}, sizeof(${dst}));`);
/** La broche k du composant est-elle reliée à quelque chose (autre qu'une plaque d'essai vide) ? */
function wired(g, c, k) {
  const A = g.cx.A; if (!A || !c.pins[k]) return false;
  const n = A.net({ comp: c, key: k });
  return n.src.length > 0 || n.gnd.length > 0 || A.members({ comp: c, key: k }).some(m => m.comp !== c && !/^breadboard/.test(m.comp.type));
}
/** Broche de la carte (constante nommée) si la broche k du module y est reliée, sinon null. */
const optPin = (g, c, k, label) => (g.pinOf(c, k) != null ? g.pinConst(c, k, label) : null);
/**
 * Rapport du pont diviseur entre la sortie k d'un module et la carte (module 5 V sur une carte 3,3 V) : bas / (haut + bas),
 * 1 si la sortie arrive directement sur la broche.
 */
function divider(g, c, k) {
  const A = g.cx.A; if (!A) return 1;
  const outNet = A.members({ comp: c, key: k });
  if (outNet.some(m => m.comp === g.board)) return 1;
  for (const m of outNet) {
    if (!isResistor(m.comp.type)) continue;
    const top = m.comp, other = m.key === '1' ? '2' : '1';
    const mid = A.members({ comp: top, key: other });
    if (!mid.some(x => x.comp === g.board)) continue;
    const bot = mid.find(x => x.comp !== top && isResistor(x.comp.type) && A.net({ comp: x.comp, key: x.key === '1' ? '2' : '1' }).gnd.length);
    if (bot) { const rt = rOf(top), rb = rOf(bot.comp); if (rt > 0 && rb > 0) return rb / (rt + rb); }
  }
  return 1;
}
/** Valeur d'une action `what` sous forme d'entier (nombre arrondi, vrai = 1). */
const intOf = x => (x.sig.kind === 'bool' ? `(${x.v} ? 1 : 0)` : x.sig.type === 'float' ? `lroundf(${x.v})` : `${x.v}`);
/** Écrit la valeur d'une action `what` sur un flux (port série, fichier, paquet radio) : nombre, oui / non, texte. */
const printVal = (port, x, ln = 'println') => (x.sig.kind === 'bool' ? [`${port}.${ln}(${x.v} ? 1 : 0);`] : x.sig.kind === 'text' ? [`${port}.${ln}(${x.v});`]
  : x.sig.type === 'float' ? [`${port}.${ln}(${x.v}, 2);`] : [`${port}.${ln}(${x.v});`]);
/** Une valeur choisie mise en texte dans le tableau dst (radio : paquet de taille fixe). */
const valText = (g, dst, x) => (x.sig.kind === 'text' ? [`strlcpy(${dst}, ${x.v}, sizeof(${dst}));`]
  : x.sig.kind === 'bool' ? [`strlcpy(${dst}, ${x.v} ? "1" : "0", sizeof(${dst}));`] : [`dtostrf(${x.v}, 0, ${x.sig.type === 'float' ? 2 : 0}, ${dst});`]);

/* ---------------- Ports série des modules (HC-05, HC-12, SIM800L, GPS, RS-485) ---------------- */
/** Ports série matériels : [nom, broche RX de la carte, broche TX de la carte]. */
const UARTS = { mega: [['Serial1', '19', '18'], ['Serial2', '17', '16'], ['Serial3', '15', '14']], pico: [['Serial1', '1', '0'], ['Serial2', '9', '8']] };
/** Broches où le SoftwareSerial du Mega peut recevoir (interruptions de changement d'état). */
const MEGA_SS_RX = new Set(['10', '11', '12', '13', '14', '15', '50', '51', '52', '53', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15']);
/**
 * Port série d'un module, choisi d'après son câblage : port matériel quand le module est sur ses broches (Mega, Pico),
 * Serial2 / Serial1 avec les broches choisies (ESP32), sinon SoftwareSerial. Rend le nom de l'objet, ou null.
 */
function serialPort(g, c, baud) {
  const s = st(g, c); if (s.port !== undefined) return s.port;
  const P = SERIAL_PINS[c.type], rxN = g.pinOf(c, P.out), txN = g.pinOf(c, P.in);
  if (rxN == null && (txN == null || !P.oneWay)) { s.port = null; return g.missing(c, tl('n’a pas sa sortie {0} reliée à une broche de {1}', P.out, g.board.name)); }
  const rx = rxN != null ? g.pinConst(c, P.out, tl('reçoit ce qu’envoie {0} (sa sortie {1})', c.name, P.out)) : null;
  const tx = txN != null ? g.pinConst(c, P.in, tl('envoie vers {0} (son entrée {1})', c.name, P.in)) : null;
  const B = st(g, BOARD), used = B.uarts || (B.uarts = new Set()), kind = g.kind;
  let port = null;
  if (isEsp32(kind)) {
    port = (kind === 'esp32c3' ? ['Serial1'] : ['Serial2', 'Serial1']).find(p => !used.has(p)) || null;
    if (!port) { s.port = null; g.notes.push(tl('// {0} : plus de port série libre sur {1}.', c.name, g.board.name)); return null; }
    used.add(port);
    g.setup.push(tx ? tl('{0}.begin({1}, SERIAL_8N1, {2}, {3}); // {4} : port série matériel sur les broches choisies (RX, TX)', port, baud, rx, tx, c.name)
      : tl('{0}.begin({1}, SERIAL_8N1, {2}); // {3} : port série matériel en réception seule (RX)', port, baud, rx, c.name));
  } else {
    const hw = (UARTS[kind] || []).find(([name, r, t]) => !used.has(name) && r === rxN && (txN == null || t === txN));
    if (hw) {
      port = hw[0]; used.add(hw[0]);
      g.setup.push(tl('{0}.begin({1}); // {2} : port série matériel', port, baud, c.name));
    } else {
      port = g.uniq(`${g.objName(c)}_port`);
      g.inc.add('SoftwareSerial.h');
      // Module qui ne fait qu'envoyer (GPS sans fil vers son RX) : pas de broche d'émission (-1) ; sur AVR, SoftwareSerial
      // prendrait -1 pour la broche 255 et écrirait au hasard dans les registres : on lui redonne la broche de réception
      // (réglée en entrée juste après, rien n'y est jamais envoyé).
      const txArg = tx || (g.avr ? rx : '-1');
      g.glob.push(tl('SoftwareSerial {0}({1}, {2}); // {3} : liaison série logicielle (RX, TX)', port, rx, txArg, c.name) + (tx ? '' : g.avr ? tl(' ; réception seule : TX = RX, rien n’est envoyé') : tl(' ; réception seule (-1 : pas de broche TX)')));
      g.setup.push(`${port}.begin(${baud});`);
      if (kind === 'mega' && !MEGA_SS_RX.has(rxN)) g.notes.push(tl('// {0} : sur le Mega, SoftwareSerial ne reçoit que sur les broches 10 à 15, 50 à 53 et A8 à A15 ; ou câblez le module sur Serial1 (RX1 = 19, TX1 = 18).', c.name));
      B.soft = (B.soft || 0) + 1;
      if (B.soft === 2 && g.avr) g.notes.push(tl('// Plusieurs SoftwareSerial : sur les cartes AVR, un seul écoute à la fois (celui dont on a appelé listen() en dernier).'));
    }
  }
  s.port = port;
  return port;
}
/** Réception d'une ligne de texte (jusqu'à \n) sur un port série, sans jamais attendre : lignes d'un événement. */
function lineEvent(g, c, port, out, size) {
  const buf = g.uniq(`${g.objName(c)}_tampon`), n = g.uniq(`${g.objName(c)}_n`);
  g.glob.push(tl('char {0}[{1}] = ""; // ligne en cours de réception', buf, size), `uint8_t ${n} = 0;`);
  return [tl('while ({0}.available() > 0) { // {1} : ce qui est arrivé, sans attendre la suite', port, c.name), `  const char car = (char)${port}.read();`,
    "  if (car == '\\n') {", `    ${buf}[${n}] = '\\0';`, `    ${n} = 0;`, `    strlcpy(${out.v}, ${buf}, sizeof(${out.v}));`, `    ${out.ev} = true;`,
    tl('    break; // une ligne par tour : la suivante attend le prochain tour'), '  }',
    tl("  if (car != '\\r' && {0} < sizeof({1}) - 1) {1}[{0}++] = car; // trop long : la fin est ignorée", n, buf), '}'];
}
const LINE_SIG = { line: { label: tl('reçoit un message'), kind: 'text', event: true, len: 32, v: 'message', short: tl('Message') } };
const SEND_ACTS = {
  send: { label: tl('envoie le texte'), arg: { kind: 'text', def: tl('Bonjour') }, once: true },
  sendValue: { label: tl('envoie la valeur de'), what: true, once: true }
};
/** Module série qui envoie et reçoit des lignes de texte : HC-05, HC-12, SIM800L, RS-485. setupFn : réglages des broches. */
function serialModule(baud, setupFn, wrap = (g, c, l) => l) {
  const port = (g, c) => { const s = st(g, c); if (!s.ready) { s.ready = true; if (setupFn) setupFn(g, c); } return serialPort(g, c, baud); };
  return {
    read(g, c, key, sig, out) { const p = port(g, c); if (!p) return null; return { lines: lineEvent(g, c, p, out, (sig.len || 32) + 1) }; },
    actor(g, c) {
      const p = port(g, c); if (!p) return null;
      return (act, arg, x) => {
        if (act === 'send') return wrap(g, c, [`${p}.println(${g.flash(arg)});`]);
        if (act === 'sendValue' && x && typeof x === 'object') return wrap(g, c, printVal(p, x));
        return [];
      };
    }
  };
}
/** Broche de commande reliée à la carte, mise à un niveau fixe au démarrage (EN du HC-05, SET du HC-12, RST…). */
function fixedPin(g, c, k, level, why) {
  const p = optPin(g, c, k); if (!p) return null;
  g.setup.push(`pinMode(${p}, OUTPUT);`, `digitalWrite(${p}, ${level}); // ${why}`);
  return p;
}

/* ---------------- Puces à sorties : image en mémoire, écrite en fin de tour si elle a changé ---------------- */
/**
 * Masque des broches en sortie d'un extenseur (MCP23017, PCF8574) : constante du programme, mise à jour à chaque nouvelle
 * broche commandée par une règle (la ligne est réécrite, le programme n'est assemblé qu'à la fin).
 */
function outMask(g, c, bits, name) {
  const s = st(g, c);
  if (s.maskAt == null) { s.mask = 0; s.maskName = name; s.maskAt = g.glob.push('') - 1; }
  const write = () => {
    const pins = [...Array(bits).keys()].filter(i => (s.mask >> i) & 1).map(i => (bits === 16 ? `${i < 8 ? 'GPA' : 'GPB'}${i & 7}` : `P${i}`));
    g.glob[s.maskAt] = tl('constexpr uint{0}_t {1} = {2}; // broches en sortie (1) : {3}', bits, s.maskName, `0x${s.mask.toString(16).toUpperCase().padStart(bits / 4, '0')}`, pins.join(', ') || tl('aucune'));
  };
  write();
  return { add: i => { if (!((s.mask >> i) & 1)) { s.mask |= 1 << i; write(); } }, name };
}

/* ---------------- Capteurs ---------------- */
const SENSORS = {
  // ACS712 : sortie VCC/2 à 0 A, plus la sensibilité × le courant ; moyenne de 16 lectures (bruit de quelques dizaines de mV).
  acs712: {
    sig: { amps: { label: tl('courant'), unit: 'A', def: 1, range: [-5, 5], v: 'courant', type: 'float', short: tl('Courant') } },
    read(g, c) {
      const p = g.pinConst(c, 'OUT'); if (!p) return g.missing(c);
      const r = acsRange(c), sens = ACS712[r].sens, ratio = divider(g, c, 'OUT'), vpp = g.prof.vref / g.max / ratio;
      helper(g, 'float lireCourant(', [tl('// ACS712 : courant en A d’après la tension de sa sortie, moyenne de 16 lectures (efface le bruit).'),
        'float lireCourant(uint8_t broche, float voltsParPas, float sensibilite) {', '  uint32_t somme = 0;', '  for (uint8_t i = 0; i < 16; i++) somme += analogRead(broche);',
        tl('  return (somme / 16.0f * voltsParPas - 2.5f) / sensibilite; // 2,5 V : sortie à 0 A (module alimenté en 5 V)'), '}']);
      const why = ratio < 1 ? tl('ACS712-{0}A : {1} V/A ; pont diviseur ({2}) entre la sortie 5 V et la broche 3,3 V', r, sens, ratio.toFixed(3).replace('.', ',')) : tl('ACS712-{0}A : {1} V/A', r, sens);
      return { expr: `lireCourant(${p}, ${lit(+vpp.toPrecision(6))}, ${lit(sens)})`, every: 100, why: tl('16 lectures moyennées'), note: why };
    }
  },
  // VL53L0X (Pololu) : mesures en continu toutes les 50 ms, lues sans attendre ; débranché, il est repéré par le bus.
  vl53l0x: {
    sig: { dist: { label: 'distance', unit: 'mm', def: 200, range: [30, 2000], v: 'distance', type: 'int', short: tl('Dist'), fail: true } },
    read(g, c, key, sig, out) {
      const o = g.objName(c), s = st(g, c), probe = i2cProbe(g), fv = g.failVar(c);
      if (!s.init) {
        s.init = true; g.inc.add('VL53L0X.h'); g.glob.push(`VL53L0X ${o};`);
        g.setup.push(tl('{0}.setTimeout(25); // jamais plus de 25 ms d’attente si le capteur ne répond plus', o), `if (!${o}.init()) {`, ...absent(g, c, tl('SDA et SCL')), '}',
          tl('if ({0} == 0) {1}.startContinuous(50); // une mesure toutes les 50 ms, prête quand on la lit', fv, o));
      }
      return { every: 100, why: tl('deux mesures du capteur'), lines: [`if (!${probe}(0x29)) {`, '  ' + failInc(g, c), '} else {', `  const uint16_t mm = ${o}.readRangeContinuousMillimeters();`,
        `  if (${o}.timeoutOccurred()) {`, '    ' + failInc(g, c), '  } else {', tl('    {0} = mm > 2000 ? 2000 : mm; // au-delà de 2 m : rien devant', out.v), `    ${fv} = 0;`, '  }', '}'] };
    }
  },
  // MAX30102 (SparkFun MAX3010x) : la file du capteur (100 mesures par seconde) est vidée toutes les 20 ms ; un battement est
  // repéré sur la lumière infrarouge renvoyée par le doigt (checkForBeat), le pouls est lissé sur les derniers battements.
  max30102: {
    sig: {
      bpm: { label: tl('pouls'), unit: tl('bpm'), def: 100, range: [40, 180], v: 'pouls', type: 'int', short: tl('Pouls'), fail: true },
      finger: { label: tl('détecte un doigt'), neg: tl('ne détecte pas de doigt'), kind: 'bool', v: 'doigt', short: tl('Doigt') },
      ir: { label: tl('lumière infrarouge (valeur lue)'), def: 50000, range: [0, 200000], v: 'infrarouge', type: 'long', short: 'IR' }
    },
    read(g, c, key, sig, out) {
      const o = g.objName(c), s = st(g, c), probe = i2cProbe(g), fv = g.failVar(c);
      if (!s.init) {
        s.init = true; g.inc.add('MAX30105.h'); g.inc.add('heartRate.h');
        s.ir = g.uniq(`${o}_ir`); s.bpm = g.uniq(`${o}_bpm`); s.last = g.uniq(`${o}_battement`);
        g.glob.push(`MAX30105 ${o};`, tl('uint32_t {0} = 0; // lumière infrarouge renvoyée (un doigt posé : plus de 50 000)', s.ir), tl('uint8_t {0} = 0; // pouls lissé (battements par minute)', s.bpm), `uint32_t ${s.last} = 0;`);
        g.setup.push(`if (!${o}.begin()) {`, ...absent(g, c, tl('SDA et SCL')), '}', tl('{0}.setup(); // réglages de l’exemple SparkFun : 3 LED, moyenne de 4 → 100 mesures par seconde', o), tl('{0}.setPulseAmplitudeRed(0x0A); // LED rouge faible : le pouls se lit sur l’infrarouge', o));
      }
      const poll = pollOnce(g, c, [`if (!${probe}(0x57)) {`, '  ' + failInc(g, c), '} else {', `  ${fv} = 0;`, tl('  {0}.check(); // les nouvelles mesures de la file du capteur, sans attendre', o),
        tl('  while ({0}.available()) { // la file se vide : quelques mesures à chaque passage', o), `    ${s.ir} = ${o}.getFIFOIR();`, `    ${o}.nextSample();`,
        `    if (${s.ir} > 50000UL && checkForBeat((int32_t)${s.ir})) {`, `      const uint32_t ecart = ${g.now()} - ${s.last};`, `      ${s.last} = ${g.now()};`,
        tl('      if (ecart > 300UL && ecart < 2000UL) { // 30 à 200 battements par minute : un vrai battement'), '        const uint8_t b = (uint8_t)(60000UL / ecart);',
        tl('        {0} = {0} == 0 ? b : (uint8_t)((3 * {0} + b) / 4); // lissé', s.bpm), '      }', '    }', '  }', tl('  if ({0} < 50000UL) {1} = 0; // pas de doigt : pas de pouls', s.ir, s.bpm), '}']);
      const val = key === 'bpm' ? s.bpm : key === 'finger' ? `${s.ir} >= 50000UL` : s.ir;
      return { every: 20, why: tl('la file du capteur se remplit de 2 mesures en 20 ms'), lines: [...poll, `${out.v} = ${val};`] };
    }
  },
  // TCS34725 (Adafruit) : registres lus directement (getRawData() attendrait la fin de l'intégration) ; rouge, vert et bleu
  // rapportés à la lumière totale (0 à 255), éclairement en lux, couleur dominante.
  tcs34725: {
    sig: {
      red: { label: tl('rouge (0 à 255)'), def: 150, range: [0, 255], v: 'rouge', type: 'int', short: 'R', fail: true },
      green: { label: tl('vert (0 à 255)'), def: 150, range: [0, 255], v: 'vert', type: 'int', short: tl('V') },
      blue: { label: tl('bleu (0 à 255)'), def: 150, range: [0, 255], v: 'bleu', type: 'int', short: 'B' },
      lux: { label: tl('éclairement'), unit: 'lx', def: 300, range: [0, 2000], v: 'eclairement', type: 'int', short: tl('Lum') },
      color: { label: tl('couleur vue'), kind: 'text', len: 5, v: 'couleur', short: tl('Couleur'), note: tl('rouge, vert, bleu, blanc ou noir') }
    },
    read(g, c, key, sig, out) {
      const o = g.objName(c), s = st(g, c), probe = i2cProbe(g), fv = g.failVar(c);
      if (!s.init) {
        s.init = true; g.inc.add('Adafruit_TCS34725.h');
        s.v = ['r', 'v', 'b', 'c', 'lux'].map(k => g.uniq(`${o}_${k}`));
        g.glob.push(tl('Adafruit_TCS34725 {0}(TCS34725_INTEGRATIONTIME_50MS, TCS34725_GAIN_4X); // une mesure toutes les 50 ms', o), tl('uint8_t {0} = 0, {1} = 0, {2} = 0; // rouge, vert, bleu rapportés à la lumière totale (0 à 255)', s.v[0], s.v[1], s.v[2]), `uint16_t ${s.v[3]} = 0, ${s.v[4]} = 0;`);
        g.setup.push(`if (!${o}.begin()) {`, ...absent(g, c, tl('SDA et SCL')), '}');
        fixedPin(g, c, 'LED', 'HIGH', tl('LED blanche du module allumée : elle éclaire l’objet'));
      }
      const [r, v, b, cl, lx] = s.v;
      const poll = pollOnce(g, c, [`if (!${probe}(0x29)) {`, '  ' + failInc(g, c), tl('} else if ({0}.read8(0x13) & 0x01) { // STATUS, bit AVALID : une mesure complète est prête', o),
        tl('  const uint16_t clair = {0}.read16(0x14), rouge = {0}.read16(0x16), vert = {0}.read16(0x18), bleu = {0}.read16(0x1A); // CDATA, RDATA, GDATA, BDATA', o),
        fmt('  {0} = clair == 0 ? 0 : (uint8_t)min(255UL, rouge * 255UL / clair);', r), fmt('  {0} = clair == 0 ? 0 : (uint8_t)min(255UL, vert * 255UL / clair);', v),
        fmt('  {0} = clair == 0 ? 0 : (uint8_t)min(255UL, bleu * 255UL / clair);', b), `  ${cl} = clair;`, `  ${lx} = ${o}.calculateLux(rouge, vert, bleu);`, `  ${fv} = 0;`, '}']);
      if (key === 'color') {
        return { every: 100, why: tl('deux mesures du capteur'), lines: [...poll, tl('if ({0} < 30) {1} // presque pas de lumière renvoyée', cl, copyLit(g, out.v, tl('noir'))),
          tl('else if ({0} > 60 && {1} > 60 && {2} > 60 && max({0}, max({1}, {2})) - min({0}, min({1}, {2})) < 40) {3} // trois couleurs voisines', r, v, b, copyLit(g, out.v, tl('blanc'))),
          `else if (${r} >= ${v} && ${r} >= ${b}) ${copyLit(g, out.v, tl('rouge'))}`, `else if (${v} >= ${b}) ${copyLit(g, out.v, tl('vert'))}`, `else ${copyLit(g, out.v, tl('bleu'))}`] };
      }
      return { every: 100, why: tl('deux mesures du capteur'), lines: [...poll, `${out.v} = ${{ red: r, green: v, blue: b, lux: lx }[key]};`] };
    }
  },
  // CCS811 (Adafruit) : une mesure par seconde, lue quand le capteur dit qu'elle est prête (available()), erreurs vérifiées.
  ccs811: {
    sig: {
      eco2: { label: tl('CO2 équivalent'), unit: 'ppm', def: 1000, range: [400, 5000], v: 'co2', type: 'int', short: 'CO2', fail: true, note: tl('20 minutes de chauffe avant des valeurs justes') },
      tvoc: { label: tl('composés organiques volatils'), unit: 'ppb', def: 200, range: [0, 1000], v: 'cov', type: 'int', short: 'COV' }
    },
    read(g, c, key, sig, out) {
      const o = g.objName(c), s = st(g, c), probe = i2cProbe(g), fv = g.failVar(c), addr = g.i2cAddr(c, 'ADDR', '0x5A', '0x5B');
      if (!s.init) {
        s.init = true; g.inc.add('Adafruit_CCS811.h');
        s.v = [g.uniq(`${o}_eco2`), g.uniq(`${o}_tvoc`)];
        g.glob.push(`Adafruit_CCS811 ${o};`, tl('uint16_t {0} = 0, {1} = 0; // dernière mesure (ppm, ppb)', s.v[0], s.v[1]));
        fixedPin(g, c, 'WAKE', 'LOW', tl('WAKE à LOW : le capteur écoute le bus I2C'));
        fixedPin(g, c, 'RST', 'HIGH', tl('RST à HIGH : le capteur fonctionne'));
        g.setup.push(`if (!${o}.begin(${addr})) {`, ...absent(g, c, tl('SDA, SCL, WAKE (à GND) et l’adresse')), '}');
      }
      const poll = pollOnce(g, c, [`if (!${probe}(${addr})) {`, '  ' + failInc(g, c), tl('} else if ({0}.available()) { // une nouvelle mesure est prête (une par seconde)', o),
        tl('  if ({0}.readData() == 0) { // 0 : lue sans erreur', o), `    ${s.v[0]} = ${o}.geteCO2();`, `    ${s.v[1]} = ${o}.getTVOC();`, `    ${fv} = 0;`, '  } else {', '    ' + failInc(g, c), '  }', '}']);
      return { every: 500, why: tl('le capteur mesure une fois par seconde'), lines: [...poll, `${out.v} = ${key === 'eco2' ? s.v[0] : s.v[1]};`] };
    }
  },
  // BME680 (Adafruit) : mesure lancée (beginReading), puis lue au passage suivant, une seconde plus tard (endReading n'attend
  // plus) : jamais d'attente des 150 ms de chauffe de la plaque du capteur de gaz.
  bme680: {
    sig: {
      temp: { label: tl('température'), unit: '°C', def: 30, range: [0, 50], v: 'temperature', type: 'float', fail: true },
      hum: { label: tl('humidité'), unit: '%', def: 70, range: [0, 100], v: 'humidite', type: 'float' },
      press: { label: 'pression', unit: 'hPa', def: 1000, range: [950, 1050], v: 'pression', type: 'float' },
      gas: { label: tl('résistance du gaz'), unit: 'kΩ', def: 50, range: [1, 300], v: 'gaz', type: 'float', short: tl('Gaz'), note: tl('air plus pollué = résistance plus basse') }
    },
    read(g, c, key, sig, out) {
      const o = g.objName(c), s = st(g, c), probe = i2cProbe(g), fv = g.failVar(c), addr = g.i2cAddr(c, 'SDO', '0x76', '0x77');
      if (!s.init) {
        s.init = true; g.inc.add('Adafruit_BME680.h');
        s.v = ['t', 'h', 'p', 'g'].map(k => g.uniq(`${o}_${k}`)); s.busy = g.uniq(`${o}_enCours`);
        g.glob.push(`Adafruit_BME680 ${o};`, tl('float {0} = 0, {1} = 0, {2} = 0, {3} = 0; // dernière mesure (°C, %, hPa, kΩ)', ...s.v), tl('bool {0} = false; // une mesure est lancée', s.busy));
        fixedPin(g, c, 'CS', 'HIGH', tl('CS à HIGH : le capteur parle I2C'));
        g.setup.push(`if (!${o}.begin(${addr})) {`, ...absent(g, c, tl('SDA, SCL et l’adresse')), '}', tl('{0}.setGasHeater(320, 150); // plaque chauffée à 320 °C pendant 150 ms pour mesurer le gaz', o));
      }
      const poll = pollOnce(g, c, [`if (!${probe}(${addr})) {`, '  ' + failInc(g, c), `  ${s.busy} = false;`, '} else {',
        tl('  if ({0} && {1}.remainingReadingMillis() == 0) { // la mesure lancée au passage précédent est finie', s.busy, o),
        `    if (${o}.endReading()) {`, `      ${s.v[0]} = ${o}.temperature;`, `      ${s.v[1]} = ${o}.humidity;`, `      ${s.v[2]} = ${o}.pressure / 100.0f;`, `      ${s.v[3]} = ${o}.gas_resistance / 1000.0f;`, `      ${fv} = 0;`,
        '    } else {', '      ' + failInc(g, c), '    }', `    ${s.busy} = false;`, '  }',
        tl('  if (!{0}) {0} = {1}.beginReading() != 0; // la suivante, lue au prochain passage', s.busy, o), '}']);
      return { every: 1000, why: tl('une mesure lancée, lue au passage suivant'), lines: [...poll, `${out.v} = ${s.v[['temp', 'hum', 'press', 'gas'].indexOf(key)]};`] };
    }
  },

  /* ---------------- Entrées ---------------- */
  // Récepteur infrarouge (IRremote 4) : décodé en arrière-plan par interruption ; une touche maintenue n'envoie qu'un code.
  ir: {
    sig: { code: { label: tl('reçoit un code'), kind: 'num', event: true, def: 69, range: [0, 255], v: 'code', type: 'int', short: 'IR', note: tl('numéro de la touche (commande NEC)') } },
    read(g, c, key, sig, out) {
      const p = g.pinConst(c, 'OUT'); if (!p) return g.missing(c);
      g.inc.add('IRremote.hpp');
      g.setup.push(tl('IrReceiver.begin({0}, DISABLE_LED_FEEDBACK); // {1} : décodage en arrière-plan', p, c.name));
      return { lines: [tl('if (IrReceiver.decode()) { // {0} : un code est arrivé', c.name), tl('  if (!(IrReceiver.decodedIRData.flags & IRDATA_FLAGS_IS_REPEAT)) { // touche maintenue : répétitions ignorées'),
        `    ${out.v} = IrReceiver.decodedIRData.command;`, `    ${out.ev} = true;`, '  }', tl('  IrReceiver.resume(); // prêt pour le code suivant'), '}'] };
    }
  },
  // Clavier 4×4 (Keypad) : balayé à chaque tour, getKey() ne rend que les nouvelles touches et n'attend jamais.
  keypad: {
    sig: { key: { label: tl('reçoit une touche'), kind: 'text', event: true, len: 1, v: 'touche', short: tl('Touche'), note: tl('0 à 9, A à D, * ou #') } },
    read(g, c, key, sig, out) {
      const rows = ['R1', 'R2', 'R3', 'R4'].map(k => g.pinConst(c, k)), cols = ['C1', 'C2', 'C3', 'C4'].map(k => g.pinConst(c, k));
      if (![...rows, ...cols].every(Boolean)) return g.missing(c);
      const o = g.objName(c);
      g.inc.add('Keypad.h');
      g.glob.push(tl('char {0}_touches[4][4] = {{\'1\', \'2\', \'3\', \'A\'}, {\'4\', \'5\', \'6\', \'B\'}, {\'7\', \'8\', \'9\', \'C\'}, {\'*\', \'0\', \'#\', \'D\'}}; // disposition des touches', o),
        `uint8_t ${o}_lignes[4] = {${rows.join(', ')}};`, `uint8_t ${o}_colonnes[4] = {${cols.join(', ')}};`,
        `Keypad ${o}(makeKeymap(${o}_touches), ${o}_lignes, ${o}_colonnes, 4, 4);`);
      return { lines: ['{', tl('  const char touche = {0}.getKey(); // NO_KEY si aucune nouvelle touche', o), '  if (touche != NO_KEY) {', `    ${out.v}[0] = touche;`, `    ${out.v}[1] = '\\0';`, `    ${out.ev} = true;`, '  }', '}'] };
    }
  },
  // Encodeur rotatif KY-040 (bibliothèque Encoder : interruptions si les broches en ont, sinon lecture à chaque appel) :
  // 4 fronts par cran ; un cran par tour de loop() au plus, le reste attend le tour suivant (aucun n'est perdu).
  ky040: {
    sig: {
      pos: { label: 'position', unit: tl('crans'), def: 10, range: [-50, 50], v: 'position', type: 'long', short: tl('Pos') },
      right: { label: tl('tourne vers la droite'), neg: tl('ne tourne pas vers la droite'), kind: 'bool', event: true, v: 'droite', short: tl('Droite') },
      left: { label: tl('tourne vers la gauche'), neg: tl('ne tourne pas vers la gauche'), kind: 'bool', event: true, v: 'gauche', short: tl('Gauche') },
      sw: { label: tl('a son bouton appuyé'), neg: tl('a son bouton relâché'), kind: 'bool', v: 'bouton', short: tl('Bouton') }
    },
    read(g, c, key, sig, out) {
      const o = g.objName(c), s = st(g, c);
      if (key === 'sw') {
        const p = optPin(g, c, 'SW'); if (!p) return null; // bouton non câblé : mesure absente
        const raw = g.uniq(`${out.v}_brut`), t = g.uniq(`${out.v}_change`);
        g.setup.push(tl('pinMode({0}, INPUT_PULLUP); // relâché : HIGH, appuyé : LOW', p));
        g.glob.push(`bool ${raw} = false;`, `uint32_t ${t} = 0;`);
        return { lines: [tl('{ // {0} : bouton filtré (anti-rebond de 20 ms)', c.name), `  const bool brut = digitalRead(${p}) == LOW;`, `  if (brut != ${raw}) {`, `    ${raw} = brut;`, `    ${t} = ${g.now()};`,
          `  } else if (${g.now()} - ${t} >= 20UL) {`, `    ${out.v} = brut;`, '  }', '}'] };
      }
      if (!s.init) {
        const clk = g.pinConst(c, 'CLK'), dt = g.pinConst(c, 'DT'); if (!clk || !dt) return g.missing(c);
        s.init = true;
        s.pos = g.uniq(`${o}_crans`); s.edges = g.uniq(`${o}_fronts`); s.step = g.uniq(`${o}_pas`);
        if (g.kind === 'pico') {
          // La bibliothèque Encoder ne connaît pas le RP2040 : deux interruptions (toutes les broches du Pico en ont) et la
          // même table que la bibliothèque (Paul Stoffregen), ancien état (bits 0-1) et nouveau (bits 2-3).
          const cnt = g.uniq(`${o}_compte`), state = g.uniq(`${o}_etat`), isr = g.uniq(`${o}_front`);
          s.read = `${o}_lire()`;
          g.glob.push(tl('volatile int32_t {0} = 0; // fronts comptés par interruption (4 par cran)', cnt), `volatile uint8_t ${state} = 0;`);
          g.helpers.push([tl('// {0} : un front sur CLK ou DT (interruption) ; sens d’après l’état précédent des deux broches.', c.name), `void ${isr}() {`, `  uint8_t s = ${state} & 3;`,
            `  if (digitalRead(${dt})) s |= 4;`, `  if (digitalRead(${clk})) s |= 8;`, `  ${state} = s >> 2;`, '  switch (s) {', `    case 1: case 7: case 8: case 14: ${cnt} = ${cnt} + 1; break;`,
            `    case 2: case 4: case 11: case 13: ${cnt} = ${cnt} - 1; break;`, `    case 3: case 12: ${cnt} = ${cnt} + 2; break;`, `    case 6: case 9: ${cnt} = ${cnt} - 2; break;`, '    default: break;', '  }', '}', '',
            tl('// {0} : fronts comptés depuis le démarrage, lus sans qu’une interruption les change en cours de lecture.', c.name), `int32_t ${o}_lire() {`, '  noInterrupts();', `  const int32_t n = ${cnt};`, '  interrupts();', '  return n;', '}'].join('\n'));
          g.setup.push(`pinMode(${dt}, INPUT_PULLUP);`, `pinMode(${clk}, INPUT_PULLUP);`, `${state} = (digitalRead(${dt}) ? 1 : 0) | (digitalRead(${clk}) ? 2 : 0);`,
            `attachInterrupt(digitalPinToInterrupt(${dt}), ${isr}, CHANGE);`, `attachInterrupt(digitalPinToInterrupt(${clk}), ${isr}, CHANGE);`);
        } else {
          g.inc.add('Encoder.h'); s.read = `${o}.read()`;
          g.glob.push(tl('Encoder {0}({1}, {2}); // {3} : fronts comptés par la bibliothèque', o, dt, clk, c.name));
        }
        g.glob.push(tl('int32_t {0} = 0; // position en crans', s.pos), tl('int32_t {0} = 0; // fronts déjà comptés en crans (4 par cran)', s.edges), tl('int8_t {0} = 0; // cran de ce tour : 1 à droite, -1 à gauche, 0', s.step));
      }
      if (key === 'right') {
        return { lines: [`${s.step} = 0;`, '{', tl('  const int32_t n = {0}; // fronts comptés depuis le démarrage', s.read),
          `  if (n - ${s.edges} >= 4) {`, `    ${s.edges} += 4;`, `    ${s.pos}++;`, `    ${s.step} = 1;`, `  } else if (n - ${s.edges} <= -4) {`, `    ${s.edges} -= 4;`, `    ${s.pos}--;`, `    ${s.step} = -1;`, '  }', '}',
          `if (${s.step} > 0) {`, `  ${out.v} = true;`, `  ${out.ev} = true;`, '}'] };
      }
      if (!g.readSignal(c, 'right')) return null; // la lecture des crans se fait avec l'événement « tourne vers la droite »
      if (key === 'left') return { lines: [`if (${s.step} < 0) {`, `  ${out.v} = true;`, `  ${out.ev} = true;`, '}'] };
      return { expr: s.pos };
    }
  },

  /* ---------------- Logique et horloges ---------------- */
  // 74HC165 : les 8 entrées copiées d'un coup (PL), puis lues bit après bit (shiftIn), 100 fois par seconde.
  hc165: {
    sig: Object.fromEntries([...Array(8).keys()].map(i => [`d${i}`, { label: tl('a l’entrée D{0} à 1', i), neg: tl('a l’entrée D{0} à 0', i), kind: 'bool', v: `d${i}`, short: `D${i}` }])),
    read(g, c, key, sig, out) {
      const i = +key.slice(1);
      if (!wired(g, c, `D${i}`)) return null; // entrée en l'air : rien à lire
      const o = g.objName(c), s = st(g, c);
      if (!s.init) {
        const pl = g.pinConst(c, 'PL'), cp = g.pinConst(c, 'CP'), q7 = g.pinConst(c, 'Q7'); if (!pl || !cp || !q7) return g.missing(c);
        s.init = true; s.v = g.uniq(`${o}_entrees`); s.pins = [pl, cp, q7];
        g.glob.push(tl('uint8_t {0} = 0; // D0 à D7 de {1} (bit 0 = D0)', s.v, c.name));
        g.setup.push(`pinMode(${pl}, OUTPUT);`, `digitalWrite(${pl}, HIGH);`, `pinMode(${cp}, OUTPUT);`, `pinMode(${q7}, INPUT);`);
        fixedPin(g, c, 'CE', 'LOW', tl('CE à LOW : horloge active'));
      }
      const [pl, cp, q7] = s.pins;
      const poll = pollOnce(g, c, [tl('digitalWrite({0}, HIGH); // horloge haute : shiftIn() lit D7 avant le premier décalage', cp), tl('digitalWrite({0}, LOW); // chargement : D0 à D7 copiées dans le registre', pl),
        'delayMicroseconds(5);', `digitalWrite(${pl}, HIGH);`, tl('{0} = shiftIn({1}, {2}, MSBFIRST); // D7 en premier', s.v, q7, cp)]);
      return { every: 10, why: tl('assez pour des boutons'), lines: [...poll, `${out.v} = bitRead(${s.v}, ${i}) == 1;`] };
    }
  },
  // Horloges DS3231 / DS1307 (RTClib) : lues une fois par seconde ; la présence sur le bus est vérifiée avant chaque lecture.
  ds3231: { sig: null, read: (g, c, key, sig, out) => rtcRead(g, c, key, out) },
  ds1307: { sig: null, read: (g, c, key, sig, out) => rtcRead(g, c, key, out) }
};
const RTC_SIG = {
  time: { label: tl('heure (hh:mm)'), kind: 'time', def: 450, range: [0, 1439], v: 'heure', short: tl('Heure'), fail: true },
  hour: { label: tl('heures'), unit: 'h', def: 7, range: [0, 23], v: 'heures', type: 'int', short: 'H' },
  minute: { label: 'minutes', unit: 'min', def: 30, range: [0, 59], v: 'minutes', type: 'int', short: 'Min' },
  second: { label: tl('secondes'), unit: 's', def: 30, range: [0, 59], v: 'secondes', type: 'int', short: 'S' },
  weekday: { label: tl('jour de la semaine'), def: 1, range: [0, 6], v: 'jour', type: 'int', short: tl('Jour'), note: tl('0 = dimanche, 1 = lundi … 6 = samedi') }
};
SENSORS.ds1307.sig = RTC_SIG;
SENSORS.ds3231.sig = { ...RTC_SIG, temp: { label: tl('température'), unit: '°C', def: 30, range: [0, 50], v: 'temperature', type: 'float', note: tl('thermomètre de l’horloge, par pas de 0,25 °C') } };
function rtcRead(g, c, key, out) {
  const o = g.objName(c), s = st(g, c), probe = i2cProbe(g), fv = g.failVar(c), ds3231 = c.type === 'ds3231';
  if (!s.init) {
    s.init = true; g.inc.add('RTClib.h');
    s.v = ['h', 'm', 's', 'j', 't'].map(k => g.uniq(`${o}_${k}`));
    g.glob.push(`${ds3231 ? 'RTC_DS3231' : 'RTC_DS1307'} ${o};`, tl('uint8_t {0} = 0, {1} = 0, {2} = 0, {3} = 0; // heures, minutes, secondes, jour (0 = dimanche)', ...s.v.slice(0, 4)), ...(ds3231 ? [`float ${s.v[4]} = 0;`] : []));
    g.setup.push(`if (!${o}.begin()) {`, ...absent(g, c, tl('SDA et SCL')), '}',
      ds3231 ? tl('if ({0} == 0 && {1}.lostPower()) {1}.adjust(DateTime(F(__DATE__), F(__TIME__))); // pile neuve ou vide : l’heure de la compilation', fv, o)
        : tl('if ({0} == 0 && !{1}.isrunning()) {1}.adjust(DateTime(F(__DATE__), F(__TIME__))); // horloge arrêtée : l’heure de la compilation', fv, o));
  }
  const [h, m, sec, j, t] = s.v;
  const poll = pollOnce(g, c, [`if (!${probe}(0x68)) {`, '  ' + failInc(g, c), '} else {', `  const DateTime t = ${o}.now();`,
    tl('  if (t.hour() > 23 || t.minute() > 59 || t.second() > 59) { // lecture incohérente'), '    ' + failInc(g, c), '  } else {',
    `    ${h} = t.hour();`, `    ${m} = t.minute();`, `    ${sec} = t.second();`, `    ${j} = t.dayOfTheWeek();`, ...(ds3231 ? [`    ${t} = ${o}.getTemperature();`] : []), `    ${fv} = 0;`, '  }', '}']);
  const val = { time: `${h} * 60 + ${m}`, hour: h, minute: m, second: sec, weekday: j, temp: t }[key];
  return { every: 1000, why: tl('l’heure change une fois par seconde'), lines: [...poll, `${out.v} = ${val};`] };
}

/* ---------------- Modules de communication ---------------- */
const COMMS = {
  hc05: { sig: LINE_SIG, acts: SEND_ACTS, gen: serialModule(9600, (g, c) => fixedPin(g, c, 'EN', 'LOW', tl('EN à LOW : mode données (pas de commandes AT)'))) },
  hc12: { sig: LINE_SIG, acts: SEND_ACTS, gen: serialModule(9600, (g, c) => fixedPin(g, c, 'SET', 'HIGH', tl('SET à HIGH : liaison transparente (pas de commandes AT)'))) },
  sim800: { sig: LINE_SIG, acts: { send: { label: tl('envoie la commande'), arg: { kind: 'text', def: 'AT' }, once: true }, sendValue: SEND_ACTS.sendValue }, gen: serialModule(9600, (g, c) => fixedPin(g, c, 'RST', 'HIGH', tl('RST à HIGH : le module fonctionne'))) },
  // RS-485 : DE et RE à HIGH le temps d'envoyer (flush() attend le dernier octet), puis retour à l'écoute.
  max485: {
    sig: LINE_SIG, acts: SEND_ACTS,
    gen: serialModule(9600, (g, c) => {
      const s = st(g, c); s.dir = ['DE', 'RE'].map(k => optPin(g, c, k)).filter(Boolean);
      for (const p of s.dir) g.setup.push(`pinMode(${p}, OUTPUT);`, tl('digitalWrite({0}, LOW); // à l’écoute du bus', p));
    }, (g, c, lines) => {
      const s = st(g, c), p = st(g, c).port;
      return [...s.dir.map(d => tl('digitalWrite({0}, HIGH); // le module prend le bus', d)), ...lines, tl('{0}.flush(); // le dernier octet est parti (quelques ms)', p), ...s.dir.map(d => tl('digitalWrite({0}, LOW); // retour à l’écoute', d))];
    })
  },
  // GPS NEO-6M (TinyGPSPlus) : les caractères arrivés sont donnés au décodeur à chaque tour, sans attendre la suite.
  neo6m: {
    sig: {
      fix: { label: tl('a une position'), neg: tl('cherche sa position'), kind: 'bool', v: 'positionOk', short: tl('Fix') },
      lat: { label: 'latitude', unit: '°', def: 14.69, range: [-90, 90], v: 'latitude', type: 'float', short: 'Lat', fail: true },
      lng: { label: 'longitude', unit: '°', def: -17.44, range: [-180, 180], v: 'longitude', type: 'float', short: 'Lon' },
      speed: { label: tl('vitesse'), unit: 'km/h', def: 30, range: [0, 120], v: 'vitesse', type: 'float', short: tl('Vit') },
      sats: { label: tl('satellites'), def: 4, range: [0, 12], v: 'satellites', type: 'int', short: 'Sat' }
    },
    gen: {
      read(g, c, key, sig, out) {
        const p = serialPort(g, c, 9600); if (!p) return null;
        const o = g.objName(c), s = st(g, c), fv = g.failVar(c);
        if (!s.init) {
          s.init = true; g.inc.add('TinyGPSPlus.h'); s.last = g.uniq(`${o}_dernier`);
          g.glob.push(`TinyGPSPlus ${o};`, tl('uint32_t {0} = 0; // dernier caractère reçu du GPS', s.last));
          helper(g, `void ${o}_suivre(`, [tl('// {0} : les caractères arrivés sont donnés à TinyGPSPlus (rien n’attend la suite) ; muet 3 s : en panne.', c.name), `void ${o}_suivre() {`,
            `  while (${p}.available() > 0) {`, `    ${o}.encode((char)${p}.read());`, `    ${s.last} = millis();`, '  }',
            `  if (millis() - ${s.last} >= 3000UL) {`, `    if (${fv} < 255) ${fv}++;`, '  } else {', `    ${fv} = 0;`, '  }', '}']);
        }
        const val = {
          fix: `${o}.location.isValid() && ${o}.location.age() < 3000UL`, lat: null, lng: null,
          speed: `${o}.speed.isValid() ? ${o}.speed.kmph() : 0.0f`, sats: `${o}.satellites.isValid() ? (int)${o}.satellites.value() : 0`
        }[key];
        const set = key === 'lat' || key === 'lng' ? tl('if ({0}.location.isValid()) {1} = {0}.location.{2}(); // sans position : la dernière connue', o, out.v, key) : `${out.v} = ${val};`;
        return { lines: [...pollOnce(g, c, [`${o}_suivre();`]), set] };
      }
    }
  },
  // RFID RC522 (MFRC522) : un badge cherché toutes les 200 ms (la recherche attend jusqu'à 25 ms la réponse d'un badge) ;
  // son numéro en hexadécimal, « DE AD BE EF » ; le badge lu se tait (HaltA) jusqu'à ce qu'on l'éloigne.
  rc522: {
    sig: { uid: { label: tl('lit un badge'), kind: 'text', event: true, len: 29, v: 'badge', short: tl('Badge'), note: tl('numéro du badge, par exemple DE AD BE EF') } },
    gen: {
      read(g, c, key, sig, out) {
        const ss = g.pinConst(c, 'SDA'), rst = optPin(g, c, 'RST'); if (!ss) return g.missing(c);
        const o = g.objName(c);
        g.inc.add('SPI.h'); g.inc.add('MFRC522.h');
        g.glob.push(tl('MFRC522 {0}({1}, {2}); // SDA (sélection), RST', o, ss, rst || '255'));
        g.setup.push('SPI.begin();', `${o}.PCD_Init();`);
        helper(g, 'char chiffreHexa(', [tl('// Chiffre hexadécimal (0 à F) de x (0 à 15).'), 'char chiffreHexa(uint8_t x) {', "  return (char)(x < 10 ? '0' + x : 'A' - 10 + x);", '}']);
        return { every: 200, why: tl('chaque recherche attend jusqu’à 25 ms un badge'), lines: [tl('if ({0}.PICC_IsNewCardPresent() && {0}.PICC_ReadCardSerial()) { // un nouveau badge', o), '  uint8_t n = 0;',
          `  for (uint8_t i = 0; i < ${o}.uid.size && i < 10; i++) {`, `    if (i > 0) ${out.v}[n++] = ' ';`, `    ${out.v}[n++] = chiffreHexa(${o}.uid.uidByte[i] >> 4);`, `    ${out.v}[n++] = chiffreHexa(${o}.uid.uidByte[i] & 0x0F);`, '  }',
          `  ${out.v}[n] = '\\0';`, tl('  {0}.PICC_HaltA(); // le badge se tait jusqu’à ce qu’on l’éloigne', o), `  ${out.ev} = true;`, '}'] };
      }
    }
  },
  // nRF24L01 (RF24) : paquets de 32 octets (un texte de 31 caractères au plus), même adresse pour envoyer et écouter.
  nrf24: {
    sig: {
      msg: { label: tl('reçoit un message'), kind: 'text', event: true, len: 31, v: 'message', short: tl('Message'), fail: true },
      val: { label: tl('reçoit un nombre'), kind: 'num', event: true, def: 10, range: [0, 100], v: 'nombre', type: 'float', short: tl('Nombre'), note: tl('le nombre écrit dans le message') }
    },
    acts: SEND_ACTS,
    gen: {
      read(g, c, key, sig, out) {
        const o = nrfInit(g, c); if (!o) return null;
        if (key === 'msg') return { lines: [tl('if ({0}.available()) { // un paquet est arrivé', o), `  ${o}.read(${out.v}, sizeof(${out.v}));`, `  ${out.v}[sizeof(${out.v}) - 1] = '\\0';`, `  ${out.ev} = true;`, '}'] };
        const msg = g.readSignal(c, 'msg'), ev = g.eventOf(c, 'msg'); if (!msg || !ev) return null;
        return { lines: [`if (${ev}) {`, tl('  {0} = atof({1}); // 0 si le message n’est pas un nombre', out.v, msg), `  ${out.ev} = true;`, '}'] };
      },
      actor(g, c) {
        const o = nrfInit(g, c); if (!o) return null;
        const pay = g.uniq(`${o}_paquet`), send = `${o}_envoyer`;
        g.glob.push(tl('char {0}[32] = ""; // paquet à envoyer', pay));
        helper(g, `bool ${send}(`, [tl('// {0} : envoie le paquet (accusé de réception attendu 3 fois 1,5 ms au plus), puis se remet à l’écoute.', c.name), `bool ${send}() {`,
          `  ${o}.stopListening();`, `  const bool ok = ${o}.write(${pay}, sizeof(${pay}));`, `  ${o}.startListening();`, '  return ok;', '}']);
        return (act, arg, x) => {
          if (act === 'send') return [copyLit(g, pay, String(arg).slice(0, 31)), tl('if (!{0}()) Serial.println({1});', send, g.flash(tl('{0} : pas d’accusé de réception', c.name)))];
          if (act === 'sendValue' && x && typeof x === 'object') return [...valText(g, pay, x), tl('if (!{0}()) Serial.println({1});', send, g.flash(tl('{0} : pas d’accusé de réception', c.name)))];
          return [];
        };
      }
    }
  },
  // LoRa SX1278 (bibliothèque LoRa) : 433 MHz ; un paquet reçu est lu sans attendre (parsePacket), l'envoi attend la fin
  // de l'émission (endPacket, quelques dizaines de ms pour un texte court).
  sx1278: {
    sig: {
      msg: { label: tl('reçoit un message'), kind: 'text', event: true, len: 32, v: 'message', short: tl('Message'), fail: true },
      rssi: { label: tl('force du dernier message'), unit: 'dBm', def: -80, range: [-140, -20], v: 'rssi', type: 'int', short: 'RSSI', note: tl('plus proche de 0 = signal plus fort') }
    },
    acts: SEND_ACTS,
    gen: {
      read(g, c, key, sig, out) {
        if (!loraInit(g, c)) return null;
        const s = st(g, c);
        if (key === 'msg') return { lines: ['{', tl('  const int taille = LoRa.parsePacket(); // 0 : rien de reçu'), '  if (taille > 0) {', '    uint8_t n = 0;',
          tl('    while (LoRa.available() > 0) { // le paquet est déjà arrivé : on le vide'), '      const int b = LoRa.read();', `      if (n < sizeof(${out.v}) - 1) ${out.v}[n++] = (char)b;`, '    }',
          `    ${out.v}[n] = '\\0';`, `    ${s.rssi} = LoRa.packetRssi();`, `    ${out.ev} = true;`, '  }', '}'] };
        if (!g.readSignal(c, 'msg')) return null; // la réception se fait avec l'événement « reçoit un message »
        return { expr: s.rssi };
      },
      actor(g, c) {
        if (!loraInit(g, c)) return null;
        const end = tl('LoRa.endPacket(); // attend la fin de l’émission');
        return (act, arg, x) => {
          if (act === 'send') return ['LoRa.beginPacket();', `LoRa.print(${g.flash(arg)});`, end];
          if (act === 'sendValue' && x && typeof x === 'object') return ['LoRa.beginPacket();', ...printVal('LoRa', x, 'print'), end];
          return [];
        };
      }
    }
  },
  // Lecteur de carte microSD (SD) : une ligne ajoutée à LOG.CSV à chaque enregistrement (fichier ouvert, écrit, refermé :
  // rien n'est perdu si l'on coupe le courant) ; carte absente ou illisible : « n'a pas de carte prête ».
  sdcard: {
    sig: { ok: { label: tl('a une carte prête'), neg: tl('n’a pas de carte prête'), kind: 'bool', v: 'carteOk', short: tl('Carte') } },
    acts: {
      log: { label: tl('ajoute à LOG.CSV la valeur de'), what: true, once: true },
      logText: { label: tl('ajoute à LOG.CSV le texte'), arg: { kind: 'text', def: tl('Bonjour') }, once: true }
    },
    gen: {
      read(g, c) { const v = sdInit(g, c); return v ? { expr: v } : null; },
      actor(g, c) {
        const ok = sdInit(g, c); if (!ok) return null;
        const esp = isEsp32(g.kind), name = g.avr ? 'LOG.CSV' : '/LOG.CSV';
        const open = tl('  File f = SD.open({0}, {1}); // ajoute à la fin du fichier', g.cstr(name), esp ? '"a"' : 'FILE_WRITE');
        const write = body => ['{', open, '  if (f) {', `    f.print(${g.now()});`, "    f.print(';');", ...ind(body, 2), '    f.close();', `    ${ok} = true;`, '  } else {',
          tl('    {0} = false; // carte absente, pleine ou protégée', ok), '  }', '}'];
        return (act, arg, x) => {
          if (act === 'logText') return write([`f.println(${g.flash(arg)});`]);
          if (act === 'log' && x && typeof x === 'object') return write(printVal('f', x));
          return [];
        };
      }
    }
  },
  // Mémoire I2C AT24C256 : 4 cases de 4 octets (valeur × 100) au début de la mémoire, relues au démarrage ; une case
  // enregistrée est recopiée en fin de tour quand la mémoire est libre (une écriture lui prend 5 ms : on n'attend pas).
  at24c256: {
    sig: Object.fromEntries([0, 1, 2, 3].map(i => [`m${i}`, { label: tl('case {0} (valeur gardée)', i), def: 0, range: [0, 100], v: `case${i}`, type: 'float', short: tl('Case {0}', i), ...(i ? {} : { fail: true }) }])),
    acts: { save: { label: tl('garde dans la case'), arg: { kind: 'num', def: 0, min: 0, max: 3, step: 1 }, what: true, once: true } },
    gen: {
      read(g, c, key) { const s = eeInit(g, c); return s ? { expr: `${s.v}[${+key.slice(1)}] / 100.0f` } : null; },
      actor(g, c) {
        const s = eeInit(g, c); if (!s) return null;
        return (act, arg, x) => {
          if (act !== 'save' || !x || typeof x !== 'object') return [];
          const n = Math.max(0, Math.min(3, arg | 0));
          const v = x.sig.kind === 'bool' ? `(${x.v} ? 100L : 0L)` : x.sig.kind === 'text' ? '0L' : x.sig.type === 'float' ? `lroundf(constrain(${x.v}, -2.0e7f, 2.0e7f) * 100.0f)` : `(int32_t)${x.v} * 100L`;
          return [`${s.v}[${n}] = ${v};`, tl('bitSet({0}, {1}); // à recopier dans la mémoire', s.dirty, n)];
        };
      }
    }
  }
};
// Modules Ethernet W5500 et ENC28J60 : le lien du câble et l'adresse de la carte. Le réseau lui-même (publier sur un
// serveur MQTT, réagir aux messages, page web) passe par le pseudo-composant « Réseau » de rules-net.js.
const ETH_SIG = {
  link: { label: tl('est relié au réseau'), neg: tl('n’est pas relié au réseau'), kind: 'bool', v: 'lien', short: tl('Lien') },
  ip: { label: tl('a une adresse IP'), neg: tl('n’a pas d’adresse IP'), kind: 'bool', v: 'adresse', short: 'IP' }
};
COMMS.w5500 = COMMS.enc28j60 = { sig: ETH_SIG, gen: { read: (g, c, key) => ethRead(g, c, key) } };
/** nRF24L01 : objet, adresse, réglages ; rend le nom de l'objet ou null. */
function nrfInit(g, c) {
  const s = st(g, c); if (s.o !== undefined) return s.o;
  const ce = g.pinConst(c, 'CE'), csn = g.pinConst(c, 'CSN'); if (!ce || !csn) { s.o = null; return g.missing(c); }
  const o = (s.o = g.objName(c)), adr = g.uniq(`${o}_adresse`);
  g.inc.add('SPI.h'); g.inc.add('RF24.h');
  g.glob.push(`RF24 ${o}(${ce}, ${csn});`, tl("const uint8_t {0}[5] = {'J', 'O', 'L', 'L', 'F'}; // adresse commune aux modules qui se parlent", adr));
  g.setup.push(`if (!${o}.begin()) {`, ...absent(g, c, tl('CE, CSN et le bus SPI'), true), '}', tl('{0}.setPALevel(RF24_PA_LOW); // puissance faible : assez dans une salle', o), `${o}.setPayloadSize(32);`,
    tl('{0}.setRetries(3, 3); // 3 essais espacés de 1 ms au plus : un envoi ne bloque jamais longtemps', o), `${o}.openWritingPipe(${adr});`, `${o}.openReadingPipe(1, ${adr});`, `${o}.startListening();`);
  return o;
}
/** LoRa : broches, fréquence ; rend vrai si le module est câblé. */
function loraInit(g, c) {
  const s = st(g, c); if (s.ok !== undefined) return s.ok;
  const nss = g.pinConst(c, 'NSS'); if (!nss) { s.ok = false; g.missing(c); return false; }
  const rst = optPin(g, c, 'RST'), dio0 = optPin(g, c, 'DIO0');
  g.inc.add('SPI.h'); g.inc.add('LoRa.h');
  s.rssi = g.uniq(`${g.objName(c)}_rssi`);
  g.glob.push(tl('int16_t {0} = 0; // force du dernier paquet reçu (dBm)', s.rssi));
  g.setup.push(tl('LoRa.setPins({0}, {1}, {2}); // NSS, RST, DIO0 (-1 : non câblée, la réception se fait sans interruption)', nss, rst || '-1', dio0 || '-1'), 'if (!LoRa.begin(433E6)) {', ...absent(g, c, tl('NSS, le bus SPI et l’alimentation 3,3 V')), '}');
  return (s.ok = true);
}
/** Carte SD : SD.begin() au démarrage ; rend le nom du drapeau « carte prête ». */
function sdInit(g, c) {
  const s = st(g, c); if (s.ok !== undefined) return s.ok;
  const cs = g.pinConst(c, 'CS'); if (!cs) { s.ok = null; return g.missing(c); }
  g.inc.add('SPI.h'); g.inc.add('SD.h');
  s.ok = g.uniq(`${g.objName(c)}_prete`);
  g.glob.push(tl('bool {0} = false; // carte présente et lisible', s.ok));
  g.setup.push(`${s.ok} = SD.begin(${cs});`, `if (!${s.ok}) Serial.println(${g.flash(tl('{0} : carte absente ou illisible (vérifiez la carte et CS)', c.name))});`);
  return s.ok;
}
/** AT24C256 : cases relues au démarrage, recopie des cases changées en fin de tour. */
function eeInit(g, c) {
  const s = st(g, c); if (s.v !== undefined) return s.v ? s : null;
  wire(g);
  const o = g.objName(c), a = 0x50 | (g.i2cAddr(c, 'A2', 0, 1) << 2) | (g.i2cAddr(c, 'A1', 0, 1) << 1) | g.i2cAddr(c, 'A0', 0, 1), addr = hex2(a), fv = g.failVar(c);
  s.v = g.uniq(`${o}_cases`); s.dirty = g.uniq(`${o}_aEcrire`);
  fixedPin(g, c, 'WP', 'LOW', tl('WP à LOW : écriture permise'));
  g.glob.push(tl('int32_t {0}[4] = {0, 0, 0, 0}; // valeurs gardées × 100 (relues au démarrage)', s.v), tl('uint8_t {0} = 0; // cases à recopier dans la mémoire (bit n : case n)', s.dirty));
  g.setup.push(tl('{ // {0} : relit les 4 cases (16 octets à partir de l’adresse 0)', c.name), `  Wire.beginTransmission(${addr});`, '  Wire.write(0);', '  Wire.write(0);',
    `  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(${addr}, 16) != 16) {`, ...ind(absent(g, c, tl('SDA, SCL et l’adresse'))), '  } else {', '    for (uint8_t i = 0; i < 4; i++) {', '      uint32_t v = 0;',
    '      for (uint8_t k = 0; k < 4; k++) v = (v << 8) | (uint8_t)Wire.read();', tl('      {0}[i] = v == 0xFFFFFFFFUL ? 0 : (int32_t)v; // mémoire neuve (FF) : 0', s.v), '    }', '  }', '}');
  g.tail.push(tl('// {0} : une case changée est recopiée quand la mémoire est libre (une écriture lui prend 5 ms)', c.name), `if (${s.dirty} != 0) {`, '  uint8_t n = 0;', `  while (!bitRead(${s.dirty}, n)) n++;`,
    `  const uint32_t v = (uint32_t)${s.v}[n];`, `  Wire.beginTransmission(${addr});`, '  Wire.write(0);', tl('  Wire.write((uint8_t)(n * 4)); // adresse de la case'), '  Wire.write((uint8_t)(v >> 24));', '  Wire.write((uint8_t)(v >> 16));',
    '  Wire.write((uint8_t)(v >> 8));', '  Wire.write((uint8_t)v);', tl('  if (Wire.endTransmission() == 0) { // occupée (écriture précédente) : on réessaiera au prochain tour'), `    bitClear(${s.dirty}, n);`, `    ${fv} = 0;`, '  }', '}');
  return s;
}

/* ---------------- Afficheurs ---------------- */
/** Motifs de la matrice 8×8 : chiffres 0 à 9, cœur, sourire (une ligne par octet, bit 7 à gauche). */
const GLYPHS = [
  [0x3c, 0x66, 0x6e, 0x76, 0x66, 0x66, 0x3c, 0x00], [0x18, 0x38, 0x18, 0x18, 0x18, 0x18, 0x7e, 0x00], [0x3c, 0x66, 0x06, 0x0c, 0x30, 0x60, 0x7e, 0x00],
  [0x3c, 0x66, 0x06, 0x1c, 0x06, 0x66, 0x3c, 0x00], [0x0c, 0x1c, 0x3c, 0x6c, 0x7e, 0x0c, 0x0c, 0x00], [0x7e, 0x60, 0x7c, 0x06, 0x06, 0x66, 0x3c, 0x00],
  [0x3c, 0x60, 0x7c, 0x66, 0x66, 0x66, 0x3c, 0x00], [0x7e, 0x06, 0x0c, 0x18, 0x30, 0x30, 0x30, 0x00], [0x3c, 0x66, 0x66, 0x3c, 0x66, 0x66, 0x3c, 0x00],
  [0x3c, 0x66, 0x66, 0x3e, 0x06, 0x0c, 0x38, 0x00], [0x00, 0x66, 0xff, 0xff, 0xff, 0x7e, 0x3c, 0x18], [0x3c, 0x42, 0xa5, 0x81, 0xa5, 0x99, 0x42, 0x3c]
];
/**
 * Afficheur à MAX7219 (8 chiffres ou matrice 8×8) : LedControl, ou MD_MAX72XX sur l'ESP32 (LedControl n'y compile pas ;
 * module FC-16 : une ligne par registre de la puce, chiffres décodés par la puce en code B). Rend { o, md } ou null.
 */
function maxInit(g, c, digits) {
  const s = st(g, c); if (s.m !== undefined) return s.m;
  const din = g.pinConst(c, 'DIN'), clk = g.pinConst(c, 'CLK'), cs = g.pinConst(c, 'CS'); if (!din || !clk || !cs) { s.m = null; return g.missing(c); }
  const o = g.objName(c), md = isEsp32(g.kind);
  if (md) {
    g.inc.add('MD_MAX72xx.h');
    g.glob.push(tl('MD_MAX72XX {0}(MD_MAX72XX::FC16_HW, {1}, {2}, {3}, 1); // DIN, CLK, CS, un module', o, din, clk, cs));
    g.setup.push(`if (!${o}.begin()) Serial.println(${g.flash(tl('{0} introuvable : vérifiez {1}', c.name, 'DIN, CLK, CS'))});`, tl('{0}.control(MD_MAX72XX::INTENSITY, 4); // luminosité 0 à 15', o),
      ...(digits ? [tl('{0}.control(MD_MAX72XX::DECODE, MD_MAX72XX::ON); // chiffres décodés par la puce (code B)', o), tl('for (uint8_t r = 0; r < 8; r++) {0}.setRow(r, 0x0F); // cases vides', o)] : []));
  } else {
    g.inc.add('LedControl.h');
    g.glob.push(tl('LedControl {0}({1}, {2}, {3}, 1); // DIN, CLK, CS, un module', o, din, clk, cs));
    g.setup.push(tl('{0}.shutdown(0, false); // la puce démarre en veille : on la réveille', o), tl('{0}.setIntensity(0, 4); // luminosité 0 à 15', o), `${o}.clearDisplay(0);`);
  }
  return (s.m = { o, md, cls: md ? 'MD_MAX72XX' : 'LedControl' });
}
/** Écran TFT (ST7735 1,8" ou ILI9341 2,8") en paysage, texte de taille 2 : une ligne de 16 points par rangée. */
function tftActor(g, c) {
  const ili = c.type === 'ili9341', cs = g.pinConst(c, 'CS'), dc = g.pinConst(c, 'DC'); if (!cs || !dc) return g.missing(c);
  const rst = optPin(g, c, 'RESET'), o = g.objName(c), W = ili ? 320 : 160, rows = ili ? 15 : 8, cols = ili ? 26 : 13, black = ili ? 'ILI9341_BLACK' : 'ST77XX_BLACK';
  g.inc.add('SPI.h'); g.inc.add('Adafruit_GFX.h'); g.inc.add(ili ? 'Adafruit_ILI9341.h' : 'Adafruit_ST7735.h');
  g.glob.push(ili && !rst ? tl('Adafruit_ILI9341 {0}({1}, {2}); // CS, DC (RESET non câblée) ; SCK et MOSI sur le bus SPI de la carte', o, cs, dc)
    : tl('{0} {1}({2}, {3}, {4}); // CS, DC, RESET (-1 : non câblée) ; SCK et MOSI sur le bus SPI de la carte', ili ? 'Adafruit_ILI9341' : 'Adafruit_ST7735', o, cs, dc, rst || '-1'));
  fixedPin(g, c, 'LED', 'HIGH', tl('rétroéclairage allumé'));
  g.setup.push(ili ? `${o}.begin();` : tl('{0}.initR(INITR_BLACKTAB); // écran 1,8" à onglet noir', o), tl('{0}.setRotation(1); // paysage : {1} × {2} points', o, W, ili ? 240 : 128), `${o}.fillScreen(${black});`,
    tl('{0}.setTextSize(2); // caractères de 12 × 16 points : {1} lignes de {2} caractères', o, rows, cols), `${o}.setTextColor(${ili ? 'ILI9341_WHITE' : 'ST77XX_WHITE'});`);
  const fit = t => String(t ?? '').slice(0, cols);
  const a = (act, arg, x, label, row) => {
    const r = Math.max(0, Math.min(rows - 1, row | 0));
    if (act === 'clear') return [`${o}.fillScreen(${black});`];
    const at = [tl('{0}.fillRect(0, {1}, {2}, 16, {3}); // efface la ligne', o, r * 16, W, black), `${o}.setCursor(0, ${r * 16});`];
    if (act === 'text' || !label || typeof label !== 'object') return [...at, `${o}.print(${g.flash(fit(arg ?? ''))});`];
    const body = [`${o}.print(${g.flash(label.name)});`];
    if (label.kind === 'bool') body.push(`if (${label.v}) ${o}.print(${g.flash(tl('oui'))});`, `else ${o}.print(${g.flash(tl('non'))});`);
    else if (label.kind === 'text') body.push(`${o}.print(${label.v});`);
    else body.push(`${o}.print(${label.v}${label.d ? `, ${label.d}` : ''});`);
    if (label.unit) body.push(`${o}.print(${g.flash(label.unit)});`);
    return [...at, ...body];
  };
  a.rows = rows;
  return a;
}
const DISPLAYS = {
  // TM1637 (TM1637Display) : 4 chiffres, nombre entier de -999 à 9999.
  tm1637: {
    acts: {
      number: { label: tl('affiche le nombre'), arg: { kind: 'num', def: 1234, min: -999, max: 9999 } },
      value: { label: tl('affiche la valeur de'), what: true },
      clear: { label: tl('s’efface') }
    },
    actor(g, c) {
      const clk = g.pinConst(c, 'CLK'), dio = g.pinConst(c, 'DIO'); if (!clk || !dio) return g.missing(c);
      const o = g.objName(c);
      g.inc.add('TM1637Display.h');
      g.glob.push(tl('TM1637Display {0}({1}, {2}); // CLK, DIO', o, clk, dio));
      g.setup.push(tl('{0}.setBrightness(4); // luminosité 0 à 7', o), `${o}.clear();`);
      const a = (act, arg, x) => {
        if (act === 'clear') return [`${o}.clear();`];
        if (act === 'number') return [`${o}.showNumberDec(${arg | 0});`];
        if (act === 'value' && x && typeof x === 'object') return x.sig.kind === 'text' ? [tl('// {0} : un texte ne s’affiche pas sur 4 chiffres', c.name)] : [tl('{0}.showNumberDec((int)constrain({1}, -999L, 9999L)); // arrondi, borné à 4 chiffres', o, intOf(x))];
        return [];
      };
      a.guard = true;
      return a;
    }
  },
  // MAX7219 à 8 chiffres : nombre signé, à droite, avec ses décimales.
  max7219s: {
    acts: {
      number: { label: tl('affiche le nombre'), arg: { kind: 'num', def: 2026, min: -9999999, max: 99999999 } },
      value: { label: tl('affiche la valeur de'), what: true },
      clear: { label: tl('s’efface') }
    },
    actor(g, c) {
      const m = maxInit(g, c, true); if (!m) return null;
      const o = m.o, put = m.md ? { d: "aff.setRow(pos, (uint8_t)((a % 10) | (dec > 0 && pos == dec ? 0x80 : 0)));", blank: 'aff.setRow(pos, 0x0F);', minus: tl('aff.setRow(pos, 0x0A); // signe moins') }
        : { d: tl('aff.setDigit(0, pos, (uint8_t)(a % 10), dec > 0 && pos == dec); // virgule après ce chiffre'), blank: "aff.setChar(0, pos, ' ', false);", minus: "aff.setChar(0, pos, '-', false);" };
      helper(g, 'void afficherNombre(', [tl('// Nombre n sur les 8 chiffres d’un MAX7219, calé à droite ; virgule avant les dec derniers chiffres (n déjà multiplié par 10^dec).'),
        `void afficherNombre(${m.cls} &aff, int32_t n, uint8_t dec) {`, '  bool negatif = n < 0;',
        tl('  uint32_t a = negatif ? (uint32_t)(-(n + 1)) + 1 : (uint32_t)n; // valeur absolue, sans débordement'),
        tl('  for (uint8_t pos = 0; pos < 8; pos++) { // chiffre 0 : à droite'),
        '    if (a > 0 || pos <= dec) {', `      ${put.d}`, '      a /= 10;', '    } else if (negatif) {', `      ${put.minus}`, '      negatif = false;', '    } else {', `      ${put.blank}`, '    }', '  }', '}']);
      const a = (act, arg, x) => {
        if (act === 'clear') return [m.md ? tl('for (uint8_t r = 0; r < 8; r++) {0}.setRow(r, 0x0F); // cases vides', o) : `${o}.clearDisplay(0);`];
        if (act === 'number') return [`afficherNombre(${o}, ${Math.round(+arg || 0)}L, 0);`];
        if (act === 'value' && x && typeof x === 'object') {
          if (x.sig.kind === 'text') return [tl('// {0} : un texte ne s’affiche pas sur des chiffres', c.name)];
          return x.sig.type === 'float' ? [tl('afficherNombre({0}, lroundf(constrain({1}, -99999.0f, 999999.0f) * 100.0f), 2); // deux décimales', o, x.v)]
            : [`afficherNombre(${o}, (int32_t)constrain(${intOf(x)}, -9999999L, 99999999L), 0);`];
        }
        return [];
      };
      a.guard = true;
      return a;
    }
  },
  // Matrice 8×8 à MAX7219 : chiffres et motifs dessinés ligne par ligne, depuis la flash.
  max7219m: {
    acts: {
      digit: { label: tl('affiche le chiffre'), arg: { kind: 'num', def: 5, min: 0, max: 9 } },
      heart: { label: tl('affiche un cœur') },
      smile: { label: tl('affiche un sourire') },
      fill: { label: tl('s’allume entièrement') },
      clear: { label: tl('s’efface') },
      follow: { label: tl('affiche la mesure (0 à 9)'), follow: [0, 9] }
    },
    actor(g, c) {
      const m = maxInit(g, c, false); if (!m) return null;
      const o = m.o, row = (r, v) => (m.md ? `${o}.setRow(${r}, ${v});` : `${o}.setRow(0, ${r}, ${v});`);
      helper(g, 'const uint8_t MOTIFS[', [tl('// Motifs de la matrice 8×8, ligne par ligne (bit 7 à gauche) : chiffres 0 à 9, cœur, sourire.'),
        'const uint8_t MOTIFS[12 * 8] PROGMEM = {', ...GLYPHS.map((r, i) => `  ${r.map(hex2).join(', ')}${i < GLYPHS.length - 1 ? ',' : ''}`), '};', '',
        tl('// Dessine le motif n (0 à 11) sur la matrice.'), `void afficherMotif(${m.cls} &m, uint8_t n) {`, '  if (n > 11) return;',
        `  for (uint8_t r = 0; r < 8; r++) ${m.md ? 'm.setRow(r, ' : 'm.setRow(0, r, '}pgm_read_byte(&MOTIFS[n * 8 + r]));`, '}']);
      const a = (act, arg, x) => {
        if (act === 'clear') return [m.md ? `${o}.clear();` : `${o}.clearDisplay(0);`];
        if (act === 'fill') return [`for (uint8_t r = 0; r < 8; r++) ${row('r', '0xFF')}`];
        if (act === 'digit') return [`afficherMotif(${o}, ${Math.max(0, Math.min(9, arg | 0))});`];
        if (act === 'heart') return [`afficherMotif(${o}, 10);`];
        if (act === 'smile') return [`afficherMotif(${o}, 11);`];
        if (act === 'follow') return [`afficherMotif(${o}, (uint8_t)${x});`];
        return [];
      };
      a.guard = true;
      return a;
    }
  },
  st7735: { acts: null, actor: tftActor },
  ili9341: { acts: null, actor: tftActor }
};
const SCREEN_ACTS = { text: { label: tl('affiche le texte'), arg: { kind: 'text', def: tl('Alerte !') } }, value: { label: tl('affiche la mesure') }, clear: { label: tl('s’efface') } };
DISPLAYS.st7735.acts = SCREEN_ACTS; DISPLAYS.ili9341.acts = SCREEN_ACTS;

/* ---------------- Puces logiques à sorties ---------------- */
const BIT_ACTS = n => ({
  on: { label: tl('met à 1 la sortie'), arg: { kind: 'num', def: 0, min: 0, max: n - 1, step: 1 } },
  off: { label: tl('met à 0 la sortie'), arg: { kind: 'num', def: 0, min: 0, max: n - 1, step: 1 } }
});
const CHIPS = {
  // 74HC595 : image des 8 sorties en mémoire, envoyée (shiftOut puis verrou) en fin de tour quand elle a changé.
  hc595: {
    acts: { ...BIT_ACTS(8), byte: { label: tl('affiche l’octet'), arg: { kind: 'num', def: 170, min: 0, max: 255 } }, clear: { label: tl('met toutes les sorties à 0') }, follow: { label: tl('allume une jauge selon la mesure'), follow: [0, 8] } },
    actor(g, c) {
      const ds = g.pinConst(c, 'DS'), sh = g.pinConst(c, 'SHCP'), stc = g.pinConst(c, 'STCP'); if (!ds || !sh || !stc) return g.missing(c);
      const o = g.objName(c), img = g.uniq(`${o}_sorties`), sent = g.uniq(`${o}_envoye`);
      g.glob.push(tl('uint8_t {0} = 0; // ce que doivent montrer Q0 à Q7 (bit 0 = Q0)', img), tl('int16_t {0} = -1; // ce qui a été envoyé (-1 : rien encore)', sent));
      g.setup.push(`pinMode(${ds}, OUTPUT);`, `pinMode(${sh}, OUTPUT);`, `pinMode(${stc}, OUTPUT);`);
      fixedPin(g, c, 'OE', 'LOW', tl('OE à LOW : sorties actives'));
      fixedPin(g, c, 'MR', 'HIGH', tl('MR à HIGH : pas de remise à zéro'));
      g.tail.push(tl('// {0} : les sorties ne sont réécrites que si elles changent', c.name), `if (${img} != ${sent}) {`, `  ${sent} = ${img};`, `  digitalWrite(${stc}, LOW);`,
        tl('  shiftOut({0}, {1}, MSBFIRST, {2}); // Q7 en premier', ds, sh, img), tl('  digitalWrite({0}, HIGH); // verrou : les 8 sorties changent ensemble', stc), '}');
      return (act, arg, x) => {
        if (act === 'on') return [`bitSet(${img}, ${arg | 0});`];
        if (act === 'off') return [`bitClear(${img}, ${arg | 0});`];
        if (act === 'byte') return [`${img} = ${arg | 0};`];
        if (act === 'clear') return [`${img} = 0;`];
        if (act === 'follow') return [tl('{0} = (uint8_t)((1 << {1}) - 1); // jauge : les {1} premières sorties', img, x)];
        return [];
      };
    }
  },
  // MCP23017 (Wire, registres de la fiche) : broches commandées par une règle en sortie, les autres en entrée avec tirage ;
  // entrées lues 50 fois par seconde, sorties réécrites en fin de tour quand elles changent.
  mcp23017: {
    sig: Object.fromEntries([...Array(16).keys()].map(i => { const n = `${i < 8 ? 'GPA' : 'GPB'}${i & 7}`; return [`${i < 8 ? 'a' : 'b'}${i & 7}`, { label: tl('a sa broche {0} à 1', n), neg: tl('a sa broche {0} à 0', n), kind: 'bool', v: n.toLowerCase(), short: n }]; })),
    acts: { on: { label: tl('met à 1 la broche n°'), arg: { kind: 'num', def: 0, min: 0, max: 15, step: 1, unit: '' } }, off: { label: tl('met à 0 la broche n°'), arg: { kind: 'num', def: 0, min: 0, max: 15, step: 1, unit: '' } } },
    read(g, c, key, sig, out) {
      const i = (key[0] === 'b' ? 8 : 0) + +key.slice(1);
      if (!wired(g, c, `${key[0] === 'b' ? 'GPB' : 'GPA'}${key.slice(1)}`)) return null; // broche libre : rien à lire
      const s = expander(g, c);
      const poll = pollOnce(g, c, [`Wire.beginTransmission(${s.addr});`, tl('Wire.write(0x12); // GPIOA, puis GPIOB'),
        tl('if (Wire.endTransmission(false) == 0 && Wire.requestFrom({0}, 2) == 2) { // pas de réponse : les entrées gardent leur dernier état', s.addr), `  ${s.in} = (uint8_t)Wire.read();`, `  ${s.in} |= (uint16_t)((uint8_t)Wire.read()) << 8;`, '}']);
      return { every: 20, why: tl('assez pour des boutons'), lines: [...poll, `${out.v} = bitRead(${s.in}, ${i}) == 1;`] };
    },
    actor(g, c) {
      const s = expander(g, c);
      const a = (act, arg, x) => { const n = arg | 0; if (x == null) s.mask.add(n); return act === 'on' ? [`bitSet(${s.out}, ${n});`] : act === 'off' ? [`bitClear(${s.out}, ${n});`] : []; };
      return a;
    }
  },
  // PCF8574 (Wire, un octet) : port quasi bidirectionnel ; une entrée garde son 1 (faible tirage) que le montage peut abaisser.
  pcf8574: {
    sig: Object.fromEntries([...Array(8).keys()].map(i => [`p${i}`, { label: tl('a sa broche {0} à 1', `P${i}`), neg: tl('a sa broche {0} à 0', `P${i}`), kind: 'bool', v: `p${i}`, short: `P${i}` }])),
    acts: BIT_ACTS(8),
    read(g, c, key, sig, out) {
      const i = +key.slice(1);
      if (!wired(g, c, `P${i}`)) return null;
      const s = expander(g, c);
      const poll = pollOnce(g, c, [tl('if (Wire.requestFrom({0}, 1) == 1) {1} = (uint8_t)Wire.read(); // pas de réponse : les entrées gardent leur dernier état', s.addr, s.in)]);
      return { every: 20, why: tl('assez pour des boutons'), lines: [...poll, `${out.v} = bitRead(${s.in}, ${i}) == 1;`] };
    },
    actor(g, c) {
      const s = expander(g, c);
      return (act, arg, x) => { const n = arg | 0; if (x == null) s.mask.add(n); return act === 'on' ? [`bitSet(${s.out}, ${n});`] : act === 'off' ? [`bitClear(${s.out}, ${n});`] : []; };
    }
  },
  // PCA9685 (Wire, registres de la fiche) : servos à 50 Hz, impulsion de 0,544 à 2,4 ms (comme la bibliothèque Servo) ;
  // angle de chaque voie gardé en mémoire, envoyé en fin de tour s'il a changé.
  pca9685: {
    acts: Object.fromEntries([...Array(16).keys()].map(i => [`s${i}`, { label: tl('met la voie {0} à l’angle', i), arg: { kind: 'num', def: 90, min: 0, max: 180, unit: '°' } }])),
    actor(g, c) {
      wire(g);
      const o = g.objName(c), addr = '0x40', ang = g.uniq(`${o}_angles`), sent = g.uniq(`${o}_envoyes`), ff = Array(16).fill(255).join(', ');
      g.glob.push(tl('uint8_t {0}[16] = {{1}}; // angle voulu de chaque voie (255 : aucun)', ang, ff), tl('uint8_t {0}[16] = {{1}}; // angle envoyé', sent, ff));
      helper(g, 'bool pcaEcrire(', [tl('// PCA9685 : écrit les octets d’un registre ; vrai si la puce a répondu.'), 'bool pcaEcrire(uint8_t adresse, uint8_t reg, uint8_t valeur) {', '  Wire.beginTransmission(adresse);', '  Wire.write(reg);', '  Wire.write(valeur);', '  return Wire.endTransmission() == 0;', '}',
        '', tl('// PCA9685 : impulsion de la voie (fin de l’impulsion en pas de 1/4096 de période) ; vrai si la puce a répondu.'), 'bool pcaVoie(uint8_t adresse, uint8_t voie, uint16_t fin) {', '  Wire.beginTransmission(adresse);',
        tl('  Wire.write((uint8_t)(0x06 + 4 * voie)); // LEDn_ON_L, puis ON_H, OFF_L, OFF_H'), '  Wire.write(0);', '  Wire.write(0);', '  Wire.write((uint8_t)(fin & 0xFF));', '  Wire.write((uint8_t)(fin >> 8));', '  return Wire.endTransmission() == 0;', '}']);
      g.setup.push(tl('{ // {0} : 50 Hz pour des servos', c.name), tl('  bool ok = pcaEcrire({0}, 0x00, 0x10); // MODE1 : en sommeil (pour changer la fréquence)', addr), tl('  ok = ok && pcaEcrire({0}, 0xFE, 121); // préréglage : 25 MHz / (4096 × 50 Hz) − 1', addr),
        tl('  ok = ok && pcaEcrire({0}, 0x00, 0x20); // réveil, registres lus et écrits à la suite', addr), '  if (!ok) {', ...ind(absent(g, c, tl('SDA, SCL et l’adresse'), false)), '  }', '}');
      g.tail.push(tl('// {0} : les voies dont l’angle a changé', c.name), 'for (uint8_t i = 0; i < 16; i++) {', `  if (${ang}[i] == ${sent}[i]) continue;`,
        tl('  const uint16_t fin = 111 + (uint16_t)((uint32_t){0}[i] * 381 / 180); // 0,544 ms (0°) à 2,4 ms (180°) sur 20 ms', ang),
        tl('  if (!pcaVoie({0}, i, fin)) break; // pas de réponse : on réessaiera au prochain tour', addr), `  ${sent}[i] = ${ang}[i];`, '}');
      return (act, arg) => { const m = /^s(\d+)$/.exec(act); return m ? [`${ang}[${m[1]}] = ${Math.max(0, Math.min(180, Math.round(+arg || 0)))};`] : []; };
    }
  }
};
/** Extenseur d'E/S (MCP23017, PCF8574) : adresse, image des entrées et des sorties, configuration au démarrage. */
function expander(g, c) {
  const s = st(g, c); if (s.ex) return s.ex;
  wire(g);
  const mcp = c.type === 'mcp23017', o = g.objName(c), bits = mcp ? 16 : 8, T = mcp ? 'uint16_t' : 'uint8_t';
  const a = 0x20 | (g.i2cAddr(c, 'A2', 0, 1) << 2) | (g.i2cAddr(c, 'A1', 0, 1) << 1) | g.i2cAddr(c, 'A0', 0, 1), addr = hex2(a);
  const ex = (s.ex = { addr, in: g.uniq(`${o}_entrees`), out: g.uniq(`${o}_sorties`), sent: g.uniq(`${o}_envoye`) });
  ex.mask = outMask(g, c, bits, g.uniq(`${o.toUpperCase()}_SORTIES`));
  g.glob.push(tl('{0} {1} = 0; // broches lues (bit n : broche n)', T, ex.in), tl('{0} {1} = 0; // niveau voulu des sorties', T, ex.out), tl('int32_t {0} = -1; // ce qui a été écrit (-1 : rien encore)', ex.sent));
  const fail = ind(absent(g, c, tl('SDA, SCL et l’adresse'), false));
  if (mcp) {
    helper(g, 'bool mcpEcrire(', [tl('// MCP23017 : écrit un registre du port A puis celui du port B (deux octets à la suite) ; vrai si la puce a répondu.'),
      'bool mcpEcrire(uint8_t adresse, uint8_t reg, uint16_t valeur) {', '  Wire.beginTransmission(adresse);', '  Wire.write(reg);', '  Wire.write((uint8_t)(valeur & 0xFF));', '  Wire.write((uint8_t)(valeur >> 8));', '  return Wire.endTransmission() == 0;', '}']);
    g.setup.push(tl('{ // {0} : sorties à 0, puis sens des broches (1 = entrée) et tirage des entrées', c.name), `  bool ok = mcpEcrire(${addr}, 0x14, 0); // OLATA, OLATB`,
      tl('  ok = ok && mcpEcrire({0}, 0x00, (uint16_t)~{1}); // IODIRA, IODIRB', addr, ex.mask.name), tl('  ok = ok && mcpEcrire({0}, 0x0C, (uint16_t)~{1}); // GPPUA, GPPUB : tirage au + des entrées', addr, ex.mask.name), '  if (!ok) {', ...ind(fail), '  }', '}');
    g.tail.push(tl('// {0} : sorties réécrites seulement si elles changent', c.name), tl('if ({0} != {1} && mcpEcrire({2}, 0x14, {3})) {1} = {3}; // pas de réponse : on réessaiera au prochain tour', ex.out, ex.sent, addr, ex.out));
  } else {
    helper(g, 'bool pcfEcrire(', [tl('// PCF8574 : écrit l’octet des 8 broches ; vrai si la puce a répondu.'), 'bool pcfEcrire(uint8_t adresse, uint8_t octet) {', '  Wire.beginTransmission(adresse);', '  Wire.write(octet);', '  return Wire.endTransmission() == 0;', '}']);
    g.setup.push(tl('if (!pcfEcrire({0}, (uint8_t)~{1})) { // {2} : sorties à 0, entrées à 1 (faible tirage)', addr, ex.mask.name, c.name), ...fail, '}');
    g.tail.push(tl('// {0} : sorties réécrites seulement si elles changent ; les entrées restent à 1', c.name), `{`, `  const uint8_t octet = (uint8_t)((${ex.out} & ${ex.mask.name}) | (uint8_t)~${ex.mask.name});`,
      tl('  if (octet != {0} && pcfEcrire({1}, octet)) {0} = octet; // pas de réponse : on réessaiera au prochain tour', ex.sent, addr), '}');
  }
  return ex;
}

/* ---------------- Tables publiées ---------------- */
export const PART_SIGNALS = {};
export const PART_ACTIONS = {};
export const PART_GEN = {};
for (const [t, d] of Object.entries(SENSORS)) { PART_SIGNALS[t] = d.sig; PART_GEN[t] = { read: d.read }; }
for (const [t, d] of Object.entries(COMMS)) { if (d.sig) PART_SIGNALS[t] = d.sig; if (d.acts) PART_ACTIONS[t] = d.acts; PART_GEN[t] = d.gen; }
for (const [t, d] of Object.entries(DISPLAYS)) { PART_ACTIONS[t] = d.acts; PART_GEN[t] = { actor: d.actor }; }
for (const [t, d] of Object.entries(CHIPS)) { if (d.sig) PART_SIGNALS[t] = d.sig; PART_ACTIONS[t] = d.acts; PART_GEN[t] = { read: d.read, actor: d.actor }; }
/**
 * Composants sans mesure ni action propres : la télécommande infrarouge (elle n'a pas de broches, elle parle au récepteur
 * IR), l'adaptateur de niveau (un simple passage entre 3,3 V et 5 V) et les pilotes de moteur (commandés à travers le
 * moteur qu'ils alimentent : moteur à courant continu, NEMA 17).
 */
export const PART_EXEMPT = { irremote: tl('télécommande : elle parle au récepteur IR'), lvlshift: tl('adaptateur de niveau : un passage'), l298n: tl('pilote du moteur'), l293d: tl('pilote du moteur'), tb6612: tl('pilote du moteur'), a4988: tl('pilote du moteur pas à pas'), drv8825: tl('pilote du moteur pas à pas') };
