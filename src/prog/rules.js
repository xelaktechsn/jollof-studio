// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Règles de comportement et génération du code Arduino.
// Une règle relie une mesure (capteur, bouton…) à un effecteur (LED, servo, relais…) :
// « Quand BTN1 est appuyé, LED1 s'allume, sinon elle s'éteint ». Les règles ne sont
// jamais exécutées telles quelles : elles produisent un vrai programme Arduino, lisible
// et commenté, que l'élève peut ensuite modifier à la main.
import { boardOf, kindOf, codePin } from '../sim/boards.js';
import { isMotor, motorPins, PARTS, COILS } from '../sim/parts.js';
import { driveOf, driveBoard } from '../sim/drive.js';
import { FN, CONSTS, AVR_INFO, isEsp32 } from './api.js';
import { tl, quote, DEC, isEn, COLON } from '../i18n/index.js';
import { pkgLed, pkgI2c, pkgSpi } from '../sim/pkgparts.js';
import { i2cAddress } from '../sim/pkgbus.js';
import { HX711_PER_G } from '../sim/models.js';
import { netLevel } from '../sim/chips.js';
import { stepperLink, driverInputs, STEPPERS } from '../sim/motordrv.js';
import { PART_SIGNALS, PART_ACTIONS, PART_GEN } from './rules-parts.js';
import { NET, NET_SIG, NET_ACTS, fixNet, netText, netSrcName, netEventText, netActText, netSource, netAct, netFinish, cleanTopic, cleanPath } from './rules-net.js';

export { NET };

/* ---------------- Ce que mesurent les capteurs et entrées ---------------- */
// kind : num (valeur comparable) ou bool (oui / non). range : plage habituelle (pour « fait varier »).
// adc : valeur brute de l'ADC, sa plage dépend de la carte.
export const SIGNALS = {
  dht11: { temp: { label: tl('température'), unit: '°C', def: 30, range: [0, 50], v: 'temperature', type: 'float' }, hum: { label: tl('humidité'), unit: '%', def: 70, range: [20, 90], v: 'humidite', type: 'float' } },
  dht22: { temp: { label: tl('température'), unit: '°C', def: 30, range: [0, 50], v: 'temperature', type: 'float' }, hum: { label: tl('humidité'), unit: '%', def: 70, range: [0, 100], v: 'humidite', type: 'float' } },
  ds18b20: { temp: { label: tl('température'), unit: '°C', def: 30, range: [0, 50], v: 'temperature', type: 'float' } },
  bmp280: { press: { label: 'pression', unit: 'hPa', def: 1000, range: [950, 1050], v: 'pression', type: 'float' }, temp: { label: tl('température'), unit: '°C', def: 30, range: [0, 50], v: 'temperature', type: 'float' } },
  hcsr04: { dist: { label: 'distance', unit: 'cm', def: 20, range: [2, 200], v: 'distance', type: 'float' } },
  pir: { motion: { label: tl('détecte un mouvement'), neg: tl('ne détecte rien'), kind: 'bool', v: 'mouvement', short: tl('Mouvement') } },
  ldr: { light: { label: tl('lumière (valeur lue)'), adc: true, def: 0.5, v: 'lumiere', note: tl('plus de lumière = valeur plus basse') } },
  soil: { soil: { label: tl('sécheresse du sol (valeur lue)'), adc: true, def: 0.55, v: 'secheresse', note: tl('sol plus sec = valeur plus haute') } },
  mq2: { gas: { label: tl('gaz (valeur lue)'), adc: true, def: 0.3, v: 'gaz' } },
  sound: { level: { label: tl('volume (écart lu)'), adc: true, def: 0.1, range01: [0, 0.5], v: 'volume' } },
  mpu6050: { tilt: { label: 'inclinaison', unit: '°', def: 30, range: [-90, 90], v: 'inclinaison', type: 'float' } },
  button: { pressed: { label: tl('est appuyé'), neg: tl('n’est pas appuyé'), kind: 'bool', v: 'appuye', short: tl('Bouton') } },
  cylsensor: { pressed: { label: tl('détecte le piston'), neg: tl('ne détecte pas le piston'), kind: 'bool', v: 'piston', short: tl('Piston') } },
  pressostat: { pressed: { label: tl('détecte la pression'), neg: tl('ne détecte pas la pression'), kind: 'bool', v: 'pression', short: tl('Pression') } },
  pot: { pos: { label: tl('position (valeur lue)'), adc: true, def: 0.5, v: 'position' } },
  joystick: { x: { label: tl('axe X (valeur lue)'), adc: true, def: 0.75, v: 'x' }, y: { label: tl('axe Y (valeur lue)'), adc: true, def: 0.75, v: 'y' }, sw: { label: tl('a son bouton appuyé'), neg: tl('a son bouton relâché'), kind: 'bool', v: 'bouton', short: tl('Bouton du manche') } },
  'tilt-sw': { tilted: { label: tl('est penché'), neg: tl('est droit'), kind: 'bool', v: 'penche', short: tl('Penché') } },
  hall: { magnet: { label: tl('détecte un aimant'), neg: tl('ne détecte pas d’aimant'), kind: 'bool', v: 'aimant', short: 'Hall' } },
  flame: { fire: { label: tl('détecte une flamme'), neg: tl('ne détecte pas de flamme'), kind: 'bool', v: 'flamme', short: tl('Flamme') }, ir: { label: tl('infrarouge (valeur lue)'), adc: true, def: 0.5, v: 'infrarouge', short: 'IR', note: tl('plus de flamme = valeur plus basse') } },
  rain: { raining: { label: tl('détecte la pluie'), neg: tl('reste sec'), kind: 'bool', v: 'pluie', short: tl('Pluie') }, wet: { label: tl('humidité de la plaque (valeur lue)'), adc: true, def: 0.6, v: 'mouille', short: tl('Pluie'), note: tl('plaque plus mouillée = valeur plus basse') } },
  water: { level: { label: tl('niveau d’eau (valeur lue)'), adc: true, def: 0.3, range01: [0, 0.7], v: 'niveau', short: tl('Niveau'), note: tl('plus d’eau = valeur plus haute') } },
  irobst: { obstacle: { label: tl('détecte un obstacle'), neg: tl('ne voit rien devant'), kind: 'bool', v: 'obstacle', short: tl('Obstacle') } },
  line: { black: { label: tl('voit la ligne noire'), neg: tl('voit le fond clair'), kind: 'bool', v: 'surLaLigne', short: tl('Ligne') } },
  lm35: { temp: { label: tl('température'), unit: '°C', def: 30, range: [0, 50], v: 'temperature', type: 'float' } },
  shock: { shaken: { label: tl('détecte une secousse'), neg: tl('est au repos'), kind: 'bool', v: 'secousse', short: tl('Secousse') } },
  bme280: { temp: { label: tl('température'), unit: '°C', def: 30, range: [0, 50], v: 'temperature', type: 'float' }, hum: { label: tl('humidité'), unit: '%', def: 70, range: [0, 100], v: 'humidite', type: 'float' }, press: { label: 'pression', unit: 'hPa', def: 1000, range: [950, 1050], v: 'pression', type: 'float' } },
  bh1750: { lux: { label: tl('éclairement'), unit: 'lx', def: 300, range: [0, 2000], v: 'eclairement', type: 'float', short: tl('Lum') } },
  hx711: { weight: { label: tl('masse'), unit: 'g', def: 500, range: [0, 5000], v: 'masse', type: 'float', short: tl('Poids') } },
  ttp223: { touched: { label: tl('est touché'), neg: tl('n’est pas touché'), kind: 'bool', v: 'doigt', short: tl('Toucher') } },
  rcwl0516: { motion: { label: tl('détecte un mouvement'), neg: tl('ne détecte rien'), kind: 'bool', v: 'mouvement', short: tl('Mouvement') } },
  mq135: { air: { label: tl('pollution de l’air (valeur lue)'), adc: true, def: 0.3, range01: [0.2, 0.39], v: 'pollution', note: tl('air plus pollué = valeur plus haute'), short: tl('Air') } }
};
/* ---------------- Ce que savent faire les effecteurs ---------------- */
// arg : réglage de l'action. follow : l'action peut suivre une mesure (sortie de out[0] à out[1]).
const LED_ACTS = {
  on: { label: tl('s’allume') }, off: { label: tl('s’éteint') },
  blink: { label: 'clignote', arg: { kind: 'num', def: 500, min: 50, max: 5000, step: 50, unit: 'ms' } },
  dim: { label: tl('éclaire à'), arg: { kind: 'num', def: 128, min: 0, max: 255, unit: '/255' }, pwm: true },
  follow: { label: tl('éclaire selon la mesure'), follow: [0, 255], pwm: true }
};
export const ACTIONS = {
  'led-red': LED_ACTS, 'led-green': LED_ACTS, 'led-blue': LED_ACTS, 'led-yellow': LED_ACTS, 'led-white': LED_ACTS,
  'led-rgb': { color: { label: tl('prend la couleur'), arg: { kind: 'color', def: '#ff8800' } }, off: { label: tl('s’éteint') } },
  buzzer: { on: { label: tl('sonne') }, off: { label: tl('se tait') }, beep: { label: tl('bipe'), arg: { kind: 'num', def: 300, min: 50, max: 3000, step: 50, unit: 'ms' } } },
  speaker: { note: { label: tl('joue la note'), arg: { kind: 'num', def: 440, min: 31, max: 4000, unit: 'Hz' } }, off: { label: tl('se tait') }, follow: { label: tl('joue selon la mesure'), follow: [200, 2000] } },
  relay: { on: { label: tl('se ferme (allume l’appareil)') }, off: { label: tl('s’ouvre (éteint l’appareil)') } },
  servo: { angle: { label: tl('tourne à'), arg: { kind: 'num', def: 90, min: 0, max: 180, unit: '°' } }, follow: { label: tl('suit la mesure'), follow: [0, 180] } },
  dcmotor: {
    fwd: { label: tl('tourne en avant à'), arg: { kind: 'num', def: 80, min: 0, max: 100, unit: '%' } },
    back: { label: tl('tourne en arrière à'), arg: { kind: 'num', def: 80, min: 0, max: 100, unit: '%' } },
    stop: { label: tl('s’arrête') }, follow: { label: tl('accélère selon la mesure'), follow: [0, 100] }
  },
  fan: {
    on: { label: tl('tourne') }, speed: { label: tl('tourne à'), arg: { kind: 'num', def: 60, min: 0, max: 100, unit: '%' } },
    stop: { label: tl('s’arrête') }, follow: { label: tl('accélère selon la mesure'), follow: [0, 100] }
  },
  pump: { on: { label: tl('pompe l’eau') }, stop: { label: tl('s’arrête') } },
  coil24: { on: { label: tl('est excitée') }, off: { label: tl('est coupée') } },
  laser: { on: { label: tl('s’allume') }, off: { label: tl('s’éteint') }, blink: { label: 'clignote', arg: { kind: 'num', def: 500, min: 50, max: 5000, step: 50, unit: 'ms' } } },
  traffic: { red: { label: tl('passe au rouge') }, yellow: { label: tl('passe à l’orange') }, green: { label: tl('passe au vert') }, off: { label: tl('s’éteint') } },
  vibro: { on: { label: tl('vibre') }, stop: { label: tl('s’arrête') } },
  stepper: { cw: { label: tl('tourne dans le sens horaire') }, ccw: { label: tl('tourne dans le sens antihoraire') }, stop: { label: tl('s’arrête') } },
  // NEMA 17 derrière un pilote A4988 ou DRV8825 : AccelStepper (rampe d'accélération), en pas entiers du moteur.
  nema17: {
    pos: { label: tl('va à la position'), arg: { kind: 'num', def: 200, min: -100000, max: 100000, step: 50, unit: tl('pas') } },
    speed: { label: tl('tourne en continu à'), arg: { kind: 'num', def: 60, min: -600, max: 600, step: 10, unit: tl('tr/min') } },
    stop: { label: tl('s’arrête') }
  },
  '7seg': { digit: { label: tl('affiche le chiffre'), arg: { kind: 'num', def: 5, min: 0, max: 9 } }, off: { label: tl('s’éteint') }, follow: { label: tl('affiche la mesure (0 à 9)'), follow: [0, 9] } },
  ws2812: { color: { label: tl('s’allume en'), arg: { kind: 'color', def: '#3fb27f' } }, off: { label: tl('s’éteint') }, follow: { label: tl('jauge selon la mesure'), follow: [0, 8], arg: { kind: 'color', def: '#3fb27f' } } },
  lcd1602: { text: { label: tl('affiche le texte'), arg: { kind: 'text', def: tl('Alerte !') } }, value: { label: tl('affiche la mesure') }, clear: { label: tl('s’efface') } },
  lcd2004: { text: { label: tl('affiche le texte'), arg: { kind: 'text', def: tl('Alerte !') } }, value: { label: tl('affiche la mesure') }, clear: { label: tl('s’efface') } },
  oled: { text: { label: tl('affiche le texte'), arg: { kind: 'text', def: tl('Alerte !') } }, value: { label: tl('affiche la mesure') }, clear: { label: tl('s’efface') } }
};
// Composants de la bibliothèque au-delà du jeu de base (rules-parts.js).
for (const [t, s] of Object.entries(PART_SIGNALS)) SIGNALS[t] = { ...s, ...(SIGNALS[t] || {}) };
for (const [t, a] of Object.entries(PART_ACTIONS)) ACTIONS[t] = { ...a, ...(ACTIONS[t] || {}) };
/** Capteurs qui peuvent ne pas répondre (fil coupé, bus muet) : la dernière bonne mesure est gardée, « est en panne » devient vrai. */
const FAILABLE = new Set(['dht11', 'dht22', 'ds18b20', 'bmp280', 'bme280', 'bh1750', 'mpu6050', 'hx711']);
for (const [t, s] of Object.entries(SIGNALS)) if ((FAILABLE.has(t) || Object.values(s).some(x => x.fail)) && !s.fault) s.fault = { label: tl('est en panne'), neg: tl('fonctionne'), kind: 'bool', v: 'enPanne', short: tl('Panne') };
/**
 * Pseudo-composants de la carte elle-même : le moniteur série (« @serial »). Mesure : la ligne reçue (événement) ;
 * actions : écrire un texte, une valeur, tracer une courbe.
 */
export const SERIAL = '@serial';
export const SERIAL_SIG = { line: { label: tl('reçoit une ligne'), kind: 'text', event: true, len: 32, v: 'ligneRecue', short: tl('Série') } };
export const SERIAL_ACTS = {
  print: { label: tl('écrit le texte'), arg: { kind: 'text', def: tl('Bonjour') } },
  show: { label: tl('écrit la valeur de') },
  plot: { label: tl('trace la courbe de') }
};
/** Actions « valeur » qui affichent une mesure ou une variable choisie (it.what). */
export const SHOWS = new Set(['value', 'show', 'plot']);
/**
 * Capteurs simples : pour chaque mesure, la broche lue et le niveau qui veut dire « oui » (tout-ou-rien),
 * ou rien (analogique : analogRead). Partagé par le code des règles et celui des blocs.
 */
/** Broche facultative d'un module (sortie AO à côté de DO) : non câblée, sa mesure est simplement absente. */
const optPin = (c, k) => !!((PARTS[c.type] || {}).pins || []).find(p => p.pin === k && p.opt);
const SIMPLE = {
  'tilt-sw': { tilted: ['S', 'HIGH'] }, hall: { magnet: ['S', 'LOW'] }, flame: { fire: ['DO', 'LOW'], ir: ['AO'] },
  rain: { raining: ['DO', 'LOW'], wet: ['AO'] }, water: { level: ['S'] }, irobst: { obstacle: ['OUT', 'LOW'] },
  line: { black: ['DO', 'HIGH'] }, shock: { shaken: ['DO', 'HIGH'] },
  ttp223: { touched: ['SIG', 'HIGH'] }, rcwl0516: { motion: ['OUT', 'HIGH'] }, mq135: { air: ['AO'] }
};
export const OPS = { '>': tl('dépasse'), '<': tl('est sous'), '>=': tl('atteint au moins'), '<=': tl('vaut au plus'), '==': 'vaut', '!=': tl('ne vaut pas'), follow: tl('fait varier') };
/** Comparaisons d'un texte (ligne série, badge, message radio, touche, variable texte). */
export const TEXT_OPS = { any: tl('reçoit n’importe quoi'), '==': tl('vaut'), '!=': tl('ne vaut pas'), has: tl('contient') };

const adcMax = prof => 2 ** ((prof && (prof.adcRead || prof.adcBits)) || 10) - 1; // ce que rend analogRead() par défaut
/** Mesure d'un capteur, avec seuil et plage exprimés pour cette carte. */
export function signalOf(type, key, prof) {
  const s = type === SERIAL ? SERIAL_SIG[key] : type === NET ? NET_SIG[key] : SIGNALS[type] && SIGNALS[type][key];
  if (!s) return null;
  if (!s.adc) return { kind: 'num', type: s.kind === 'time' ? 'int' : 'float', ...s };
  const max = adcMax(prof), r = s.range01 || [0, 1];
  return { kind: 'num', type: 'int', unit: '', ...s, def: Math.round(s.def * max), range: [Math.round(r[0] * max), Math.round(r[1] * max)], max };
}
/** Variable des règles vue comme une mesure : { kind, label, unit, type }. */
export const varSignal = d => ({ kind: d.type === 'bool' ? 'bool' : d.type === 'text' ? 'text' : 'num', type: d.type === 'dec' ? 'float' : d.type === 'int' ? 'long' : d.type, label: d.name, unit: d.unit || '', len: d.len || 16, var: true });
export const isSensor = c => !!SIGNALS[c.type];
export const isActuator = c => !!ACTIONS[c.type];
/* ---------------- Arbre des règles ----------------
 * Liste du projet (P.rules) : des règles, des variables et des séquences.
 * Règle : { kind: 'rule', id, src, op, v, from: [min, max], then: [éléments], else: [éléments],
 *           vs?, edge?, hold?, hyst?, more?: [conditions], join? }
 *   Condition (la règle elle-même pour la première, puis chaque élément de `more`) :
 *     src : { comp, sig } (mesure ; comp « @serial » : moniteur série) | { var: id } | { seq: id, step: id } (étape active)
 *           | { every: ms } (toutes les…) | { start: true } (au démarrage) | null (toujours)
 *     op : > < >= <= == != follow (nombre), == / any / != / has (texte) ; v : seuil, texte ou 1 / 0
 *     vs : { comp, sig } | { var } — comparée à une autre mesure ou variable au lieu de v
 *     edge : « dès que » (vrai une seule fois, quand la condition le devient ; anti-rebond des contacts)
 *     hold : ms, vraie depuis au moins ce temps ; hyst : hystérésis (« retombe sous v − hyst »)
 *     link : 'and' | 'or' (avec la précédente), not : condition contraire (« sauf si »)
 * Élément : action { kind: 'act', id, comp, act, arg, what?, line? } (what : mesure ou variable affichée),
 *   règle imbriquée, { kind: 'set', id, var, op: '=' | '+' | '-' | 'toggle', v, src? } (variable),
 *   { kind: 'wait', id, ms } (« puis attendre », sans bloquer), { kind: 'goto', id, seq, step } (step null : arrêter).
 * Variable : { kind: 'var', id, name, type: 'int' | 'dec' | 'bool' | 'text', init, len?, persist? }
 * Séquence : { kind: 'seq', id, name, start: 'boot' | 'stopped', steps: [{ kind: 'step', id, name, do: [éléments],
 *   go: [{ kind: 'go', id, after: ms | 0, when: condition | null, to: id d'étape | null (arrêt) }] }] }
 * « Sinon » qui ne contient qu'une condition devient un else if dans le code.
 */
export const uid = p => p + Math.random().toString(36).slice(2, 8);
export const actItem = (c, act, arg) => ({ kind: 'act', id: uid('a'), comp: c ? c.id : null, act, arg: arg === undefined && c ? defArg(c.type, act) : arg });
const actsOfType = type => (type === SERIAL ? SERIAL_ACTS : type === NET ? NET_ACTS : ACTIONS[type]);
export const defArg = (type, act) => { const a = actsOfType(type) && actsOfType(type)[act]; return a && a.arg ? a.arg.def : a && a.follow ? [...a.follow] : null; };
/** Actions permises : « follow » (fait varier), « cond » (sous une mesure), « always » (sans mesure, état par défaut). */
export function actsFor(type, mode) {
  return Object.entries(actsOfType(type) || {}).filter(([k, A]) => (mode === 'follow' ? A.follow || k === 'value' : !A.follow && (k !== 'value' || mode === 'cond' || mode === 'any')));
}
const offAct = type => (ACTIONS[type].off ? 'off' : ACTIONS[type].stop ? 'stop' : null);
/** Ancien format (une action, une alternative) → arbre ; éléments inconnus retirés, champs vérifiés. */
export function migrate(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.kind === 'var') {
    r.id = r.id || uid('v'); r.name = ident(String(r.name || 'variable')) || 'variable';
    if (!['int', 'dec', 'bool', 'text'].includes(r.type)) r.type = 'int';
    if (r.type === 'text') { r.len = Math.max(1, Math.min(64, r.len | 0 || 16)); r.init = String(r.init ?? '').slice(0, r.len); }
    else r.init = r.type === 'bool' ? !!r.init : +r.init || 0;
    r.persist = !!r.persist;
    return r;
  }
  if (r.kind === 'net') return fixNet(r);
  if (r.kind === 'seq') {
    r.id = r.id || uid('s'); r.name = ident(String(r.name || 'sequence')) || 'sequence';
    r.start = r.start === 'stopped' ? 'stopped' : 'boot';
    r.steps = (Array.isArray(r.steps) ? r.steps : []).filter(s => s && typeof s === 'object').map(s => ({
      kind: 'step', id: s.id || uid('e'), name: ident(String(s.name || 'etape')) || 'etape', do: fixList(s.do),
      go: (Array.isArray(s.go) ? s.go : []).filter(Boolean).map(g => ({ kind: 'go', id: g.id || uid('g'), after: Math.max(0, +g.after || 0), when: g.when && g.when.src ? fixTerm({ ...g.when }) : null, to: g.to ?? null }))
    }));
    return r;
  }
  r.kind = 'rule'; r.id = r.id || uid('r');
  if (!Array.isArray(r.from)) r.from = [0, 100];
  if (!Array.isArray(r.then)) {
    r.then = r.dst ? [{ kind: 'act', id: uid('a'), comp: r.dst.comp, act: r.dst.act, arg: r.dst.arg }] : [];
    r.else = r.dst && r.alt ? [{ kind: 'act', id: uid('a'), comp: r.dst.comp, act: r.alt.act, arg: r.alt.arg }] : [];
  }
  delete r.dst; delete r.alt;
  if (!Array.isArray(r.else)) r.else = [];
  fixTerm(r);
  if (Array.isArray(r.more)) r.more = r.more.filter(t => t && t.src).map(t => fixTerm({ ...t, link: t.link === 'or' ? 'or' : 'and' }));
  if (!Array.isArray(r.more) || !r.more.length) delete r.more;
  r.then = fixList(r.then); r.else = fixList(r.else);
  return r;
}
function fixTerm(t) {
  if (t.hold != null) { t.hold = Math.max(0, +t.hold || 0); if (!t.hold) delete t.hold; }
  if (t.hyst != null) { t.hyst = Math.abs(+t.hyst || 0); if (!t.hyst) delete t.hyst; }
  if (t.src && t.src.every != null) t.src.every = Math.max(1, Math.round(+t.src.every || 1000));
  if (!t.edge) delete t.edge; if (!t.not) delete t.not;
  if (t.src && t.src.comp === NET) {
    if (NET_SIG[t.src.sig] && NET_SIG[t.src.sig].topic) t.src.topic = cleanTopic(t.src.topic, false); else delete t.src.topic;
    if (t.src.sig === 'page' && t.op !== 'any' && !t.vs) t.v = cleanPath(t.v);
  }
  return t;
}
function fixList(list) {
  return (Array.isArray(list) ? list : []).map(it => {
    if (!it || typeof it !== 'object') return null;
    if (it.kind === 'rule') return migrate(it);
    if (it.kind === 'act') return it.comp === NET ? { ...it, id: it.id || uid('a'), ...(it.act === 'publish' ? { topic: cleanTopic(it.topic, true) } : {}) } : { ...it, id: it.id || uid('a') };
    if (it.kind === 'set') return { ...it, id: it.id || uid('a'), op: ['=', '+', '-', 'toggle'].includes(it.op) ? it.op : '=' };
    if (it.kind === 'wait') return { ...it, id: it.id || uid('a'), ms: Math.max(1, Math.round(+it.ms || 1000)) };
    if (it.kind === 'goto') return { ...it, id: it.id || uid('a') };
    return null;
  }).filter(Boolean);
}
/** Conditions d'une règle : elle-même, puis ses conditions ajoutées (aucune si elle s'applique toujours). */
export const termsOf = r => (r && r.src ? [r, ...(r.more || [])] : []);
/** Listes d'éléments d'un nœud : branches d'une règle, actions d'une étape. */
const listsOf = x => (x.kind === 'rule' ? ['then', 'else'] : x.kind === 'step' ? ['do'] : []);
/** Visite chaque élément : fn(élément, liste qui le contient, parent) ; séquences : étapes, puis leurs éléments et transitions. */
export function walkRule(r, fn, list = null, parent = null) {
  fn(r, list, parent);
  if (r.kind === 'seq') { for (const s of r.steps || []) walkRule(s, fn, r.steps, r); return; }
  for (const b of listsOf(r)) for (const it of r[b] || []) { if (it.kind === 'rule') walkRule(it, fn, r[b], r); else fn(it, r[b], r); }
  if (r.kind === 'step') for (const g of r.go || []) fn(g, r.go, r);
}
export const walkAll = (rules, fn) => rules.forEach(r => walkRule(r, fn, rules, null));
export function findById(rules, id) { let hit = null; walkAll(rules, (it, list, parent) => { if (!hit && it.id === id) hit = { it, list, parent }; }); return hit; }
export const actsOf = r => { const out = []; walkRule(r, it => { if (it.kind === 'act') out.push(it); }); return out; };
/** Composants cités par un élément (mesures des conditions, effecteurs, mesures affichées ou copiées). */
function compRefs(it) {
  const out = [], src = s => { if (s && s.comp) out.push(s.comp); };
  if (it.kind === 'act') { out.push(it.comp); src(it.what); }
  if (it.kind === 'set') src(it.src);
  if (it.kind === 'rule') for (const t of termsOf(it)) { src(t.src); src(t.vs); }
  if (it.kind === 'go' && it.when) { src(it.when.src); src(it.when.vs); }
  return out;
}
export const involves = (r, id) => { let yes = false; walkRule(r, it => { if (compRefs(it).includes(id)) yes = true; }); return yes; };
/** Numéro de chaque règle imbriquée : 1, 1.1, 1.2, 2… ; dans une séquence : Nom.1, Nom.2… */
export function numberRules(rules) {
  const map = new Map();
  const go = (r, label) => { map.set(r.id, label); let k = 0; for (const b of ['then', 'else']) for (const it of r[b]) if (it.kind === 'rule') go(it, `${label}.${++k}`); };
  let n = 0;
  for (const r of rules) {
    if (r.kind === 'rule') go(r, String(++n));
    else if (r.kind === 'seq') { let k = 0; for (const s of r.steps || []) for (const it of s.do) if (it.kind === 'rule') go(it, `${r.name}.${++k}`); }
  }
  return map;
}
/** Nouvelle règle : mesure → action, avec l'action contraire dans « sinon » quand elle existe. */
export function newRule(src, dst, prof) {
  const r = { kind: 'rule', id: uid('r'), src: null, op: '>', v: 0, from: [0, 100], then: [], else: [] };
  if (src) {
    const key = Object.keys(SIGNALS[src.type])[0], sig = signalOf(src.type, key, prof);
    r.src = { comp: src.id, sig: key };
    Object.assign(r, termDefaults(sig));
    r.from = sig.range ? [...sig.range] : [0, 100];
  }
  if (dst) {
    const [act] = actsFor(dst.type, src ? 'cond' : 'always')[0] || [];
    if (act) r.then.push(actItem(dst, act));
    const off = offAct(dst.type);
    if (src && off && off !== act) r.else.push(actItem(dst, off));
  }
  return r;
}
/** Comparaison et seuil de départ d'une mesure. */
export function termDefaults(sig) {
  if (!sig) return { op: '>', v: 0 };
  if (sig.kind === 'bool') return { op: '==', v: 1 };
  if (sig.kind === 'text') return sig.event ? { op: 'any', v: '' } : { op: '==', v: '' };
  if (sig.event) return { op: 'any', v: sig.def ?? 0 };
  return { op: '>', v: sig.def ?? 0 };
}

const fmtNum = v => String(Math.round(v * 100) / 100).replace('.', DEC);
/** Durée lisible : 500 ms, 2 s, 1,5 s, 2 min. */
export const fmtMs = ms => (ms < 1000 ? `${ms} ms` : ms % 60000 === 0 && ms >= 60000 ? `${ms / 60000} min` : `${fmtNum(ms / 1000)} s`);
/** Heure d'une mesure « time » (minutes depuis minuit) : 07:30. */
export const fmtTime = m => `${String(Math.floor((m | 0) / 60) % 24).padStart(2, '0')}:${String((m | 0) % 60).padStart(2, '0')}`;
/** Nom affiché d'une source (mesure, variable, étape) ; byId trouve composants, variables et séquences. */
export function srcName(src, byId, prof) {
  if (!src) return '?';
  if (src.var) { const d = byId(src.var); return d ? d.name : tl('(variable retirée)'); }
  if (src.comp === SERIAL) return tl('la ligne reçue');
  if (src.comp === NET) return netSrcName(src);
  const s = byId(src.comp), sig = s && signalOf(s.type, src.sig, prof);
  if (!s) return tl('(mesure retirée du montage)');
  return sig ? `${s.name} · ${sig.label.replace(/ \(.*\)$/, '')}` : `${s.name} ?`;
}
/** Mesure ou variable d'une source : { sig, name }. */
export function srcSignal(src, byId, prof) {
  if (!src) return null;
  if (src.var) { const d = byId(src.var); return d && d.kind === 'var' ? varSignal(d) : null; }
  if (src.comp === SERIAL || src.comp === NET) return signalOf(src.comp, src.sig, prof);
  const s = byId(src.comp); return s ? signalOf(s.type, src.sig, prof) : null;
}
const valText = (v, sig) => (sig && sig.kind === 'time' ? fmtTime(v) : sig && sig.kind === 'text' ? quote(String(v ?? '')) : fmtNum(+v || 0) + (sig && sig.unit ? ' ' + sig.unit : ''));
/** Une condition, sans « Quand » : « BTN1 est appuyé », « DHT1 · température dépasse 30 °C depuis 10 s ». */
export function termText(t, byId, prof) {
  const src = t.src;
  if (!src) return tl('toujours');
  if (src.every) return tl('toutes les {0}', fmtMs(src.every));
  if (src.start) return tl('au démarrage');
  if (src.seq) {
    const q = byId(src.seq), st = q && q.steps && q.steps.find(s => s.id === src.step);
    return q ? tl('l’étape {0} › {1} est active', q.name, st ? st.name : '?') : tl('(séquence retirée)');
  }
  const sig = srcSignal(src, byId, prof);
  let text;
  if (src.comp === NET) {
    // Réseau : « un message arrive sur le sujet « x » », « la page web reçoit « /on » », « la carte est connectée au réseau ».
    const rhs = () => (t.vs ? srcName(t.vs, byId, prof) : valText(t.v, sig));
    if (!sig) text = netSrcName(src);
    else if (sig.kind === 'bool') text = t.v ? sig.label : sig.neg;
    else if (t.op === 'any') text = netEventText(src);
    else if (src.sig === 'page' && t.op === '==' && !t.vs) text = tl('la page web reçoit {0}', quote(cleanPath(t.v)));
    else text = `${netSrcName(src)} ${sig.kind === 'text' ? TEXT_OPS[t.op] || TEXT_OPS['=='] : OPS[t.op] || OPS['>']} ${rhs()}`;
  } else if (src.var || src.comp === SERIAL) {
    const name = srcName(src, byId, prof);
    if (!sig) text = name;
    else if (sig.kind === 'bool') text = `${name} ${t.v ? tl('est vraie') : tl('est fausse')}`;
    else if (sig.kind === 'text') text = sig.event ? (t.op === 'any' ? `${name} ${sig.label}` : tl('{0} reçoit {1}', name, quote(String(t.v ?? '')))) : `${name} ${TEXT_OPS[t.op] || TEXT_OPS['==']} ${t.vs ? srcName(t.vs, byId, prof) : quote(String(t.v ?? ''))}`;
    else text = `${name} ${OPS[t.op] || OPS['>']} ${t.vs ? srcName(t.vs, byId, prof) : valText(t.v, sig)}`;
  } else {
    const s = byId(src.comp);
    if (!s) return tl('(mesure retirée du montage)');
    if (!sig) return `${s.name} ?`;
    if (sig.kind === 'bool') text = `${s.name} ${t.v ? sig.label : sig.neg}`;
    else if (sig.event && t.op === 'any') text = `${s.name} ${sig.label}`;
    else if (sig.kind === 'text') text = `${s.name} · ${sig.label} ${TEXT_OPS[t.op] || TEXT_OPS['==']} ${t.vs ? srcName(t.vs, byId, prof) : quote(String(t.v ?? ''))}`;
    else if (t.op === 'follow') text = tl('{0} ({1}) fait varier', s.name, sig.label.replace(/ \(.*\)$/, ''));
    else text = `${srcName(src, byId, prof)} ${OPS[t.op] || OPS['>']} ${t.vs ? srcName(t.vs, byId, prof) : valText(t.v, sig)}`;
  }
  if (t.hyst && sig && sig.kind === 'num' && /[<>]/.test(t.op)) text += t.op[0] === '>' ? tl(' (retombe sous {0})', valText(+t.v - t.hyst, sig)) : tl(' (remonte au-dessus de {0})', valText(+t.v + t.hyst, sig));
  if (t.hold) text += tl(' depuis {0}', fmtMs(t.hold));
  return text;
}
/** « Quand BTN1 est appuyé », « Dès que BTN1 est appuyé et DHT1 · température dépasse 30 °C », « Toujours ». */
export function condText(r, byId, prof) {
  const terms = termsOf(r);
  if (!terms.length) return tl('Toujours');
  if (r.op === 'follow') return termText(r, byId, prof);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  return terms.map((t, i) => {
    const body = termText(t, byId, prof), timed = t.src && (t.src.every || t.src.start);
    if (!i) return timed ? cap(body) : (t.edge ? tl('Dès que ') : tl('Quand ')) + body;
    const link = t.link === 'or' ? (t.not ? tl(' ou si pas : ') : tl(' ou ')) : t.not ? tl(' sauf si ') : tl(' et ');
    return link + (t.edge ? tl('dès que ') : '') + body;
  }).join('');
}
/** « LED1 s'allume », « SERVO1 tourne à 90 ° », « met compteur à 0 », « attend 2 s », « passe à l'étape Feu › Vert ». */
export function actText(it, byId, prof) {
  if (it.kind === 'wait') return tl('attend {0}', fmtMs(it.ms));
  if (it.kind === 'goto') {
    const q = byId(it.seq); if (!q) return tl('(séquence retirée)');
    if (!it.step) return tl('arrête la séquence {0}', q.name);
    const st = q.steps.find(s => s.id === it.step); return tl('passe à l’étape {0} › {1}', q.name, st ? st.name : '?');
  }
  if (it.kind === 'set') {
    const d = byId(it.var); if (!d) return tl('(variable retirée)');
    const val = it.src ? srcName(it.src, byId, prof) : d.type === 'bool' ? (it.v ? tl('vrai') : tl('faux')) : d.type === 'text' ? quote(String(it.v ?? '')) : fmtNum(+it.v || 0);
    if (it.op === 'toggle') return tl('inverse {0}', d.name);
    if (it.op === '+') return tl('ajoute {0} à {1}', val, d.name);
    if (it.op === '-') return tl('retire {0} à {1}', val, d.name);
    return tl('met {0} à {1}', d.name, val);
  }
  if (it.comp === NET) return netActText(it, it.what ? srcName(it.what, byId, prof) : null);
  const ser = it.comp === SERIAL, d = ser ? null : byId(it.comp);
  if (!ser && !d) return it.comp ? tl('(effecteur retiré)') : tl('(choisir un effecteur)');
  const name = ser ? tl('Moniteur série') : d.name, A = actsOfType(ser ? SERIAL : d.type) && actsOfType(ser ? SERIAL : d.type)[it.act];
  if (!A) return `${name} ?`;
  const unit = A.arg && A.arg.unit ? ' ' + A.arg.unit : '';
  const arg = A.arg && it.arg != null && !Array.isArray(it.arg) ? ' ' + (A.arg.kind === 'num' ? fmtNum(it.arg) : A.arg.kind === 'text' ? quote(it.arg) : it.arg) + unit : '';
  const what = (SHOWS.has(it.act) || A.what) && it.what ? ' ' + srcName(it.what, byId, prof) : '';
  const line = it.line ? tl(' (ligne {0})', it.line) : '';
  if (it.act === 'value' && it.what) return `${name} ${tl('affiche')}${what}${line}`;
  return `${name} ${A.label}${arg}${what}${line}`;
}
/** Éléments d'une liste : « LED1 s'allume, attend 2 s, puis LED1 s'éteint », règles imbriquées entre crochets. */
export function itemsText(list, byId, prof) {
  let after = false;
  return list.map(it => { const s = (after ? tl('puis ') : '') + (it.kind === 'rule' ? `[${ruleInner(it, byId, prof)}]` : actText(it, byId, prof)); after = it.kind === 'wait'; return s; }).join(', ') || tl('rien');
}
function ruleInner(x, byId, prof) {
  if (x.src && x.op === 'follow') return condText(x, byId, prof) + COLON + itemsText(x.then.filter(i => i.kind === 'act'), byId, prof);
  return condText(x, byId, prof) + COLON + itemsText(x.then, byId, prof) + (x.src && x.else.length ? tl(' ; sinon {0}', itemsText(x.else, byId, prof)) : '');
}
/** Phrase qui résume une règle et ses règles imbriquées (ou une variable, une séquence). */
export function ruleText(r, byId, prof) {
  if (r.kind === 'var') return varText(r);
  if (r.kind === 'seq') return seqText(r, byId, prof);
  if (r.kind === 'net') return netText(r);
  return ruleInner(r, byId, prof) + '.';
}
const VAR_TYPES = { int: tl('nombre entier'), dec: tl('nombre à virgule'), bool: tl('vrai ou faux'), text: tl('texte') };
export const VAR_TYPE_LABELS = VAR_TYPES;
/** « Variable compteur : nombre entier, 0 au départ, gardée hors tension. » */
export function varText(d) {
  const init = d.type === 'bool' ? (d.init ? tl('vrai') : tl('faux')) : d.type === 'text' ? quote(d.init || '') : fmtNum(+d.init || 0);
  return tl('Variable {0} : {1}{2}, {3} au départ{4}.', d.name, VAR_TYPES[d.type] || d.type, d.type === 'text' ? tl(' ({0} caractères au plus)', d.len || 16) : '', init, d.persist ? tl(', gardée hors tension') : '');
}
/** Transition : « après 5 s → Vert », « quand BTN1 est appuyé → Orange ». */
export function goText(g, q, byId, prof) {
  const to = g.to ? (q.steps.find(s => s.id === g.to) || {}).name || '?' : tl('fin');
  const parts = [];
  if (g.after) parts.push(tl('après {0}', fmtMs(g.after)));
  if (g.when) parts.push((g.when.edge ? tl('dès que ') : tl('quand ')) + termText(g.when, byId, prof));
  return `${parts.join(tl(' et ')) || tl('aussitôt')} → ${to}`;
}
/** « Séquence Feu : Rouge (LED_R s'allume ; après 5 s → Vert) · Vert (…). » */
export function seqText(q, byId, prof) {
  const steps = (q.steps || []).map(s => `${s.name} (${itemsText(s.do, byId, prof)}${(s.go || []).map(g => ' ; ' + goText(g, q, byId, prof)).join('')})`);
  return tl('Séquence {0}{1}{2}.', q.name, q.start === 'stopped' ? tl(' (lancée par une règle)') : '', COLON + (steps.join(' · ') || tl('aucune étape')));
}
/** États par défaut proposés pour un effecteur (sans mesure). */
export const defaultActs = type => actsFor(type, 'always');
export const TIMED = new Set(['blink', 'beep']);
/**
 * Capteurs lents ou bloquants : lus à leur rythme (ms), pas à chaque tour de loop(). La mesure est gardée
 * dans une variable globale entre deux lectures. Les entrées rapides (bouton, potentiomètre…) restent lues à chaque tour.
 */
const SAMPLE = {
  dht11: [1000, () => tl('le rythme du capteur')], dht22: [2000, () => tl('le rythme du capteur')],
  bmp280: [500, () => tl('assez pour la météo')], bme280: [500, () => tl('assez pour la météo')], bh1750: [200, () => tl('il mesure toutes les 120 ms')], hcsr04: [60, () => tl('l’écho précédent doit s’être éteint')], mpu6050: [20, () => tl('50 fois par seconde')]
};

/* ---------------- Génération du code ---------------- */
export const RESERVED = new Set([...Object.keys(FN), ...Object.keys(CONSTS), 'int', 'float', 'long', 'char', 'byte', 'bool', 'void', 'String', 'setup', 'loop', 'Serial', 'Wire', 'SPI', 'Ethernet', 'WiFi', 'IPAddress', 'Client', 'Server', 'EthernetClient', 'EthernetServer', 'WiFiClient', 'WiFiServer', 'PubSubClient', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'LED_BUILTIN']);
/**
 * Noms que le cœur Arduino définit déjà comme macros : B1, B101… (binary.h), registres et bits des AVR (PORTB, PB5, OCR1A…).
 * Un composant nommé ainsi garde son nom suivi de _PIN (sinon le préprocesseur remplacerait le nom par un nombre).
 */
const MACRO_LIKE = /^(B[01]{1,8}|(PORT|DDR|PIN)[A-L]|P[A-L][0-7]|(OCR|TCCR|TCNT|ICR|TIMSK|TIFR)\d\w*|ADC[LH]?|SREG|SP[HL]|SPCR|SPDR|SPSR|UDR\d|EEAR|EEDR|EECR|TWAR|TWDR|TWBR|TWCR|MCUSR|GPIOR\d)$/;
export const ident = s => { let n = s.replace(/[^A-Za-z0-9_]/g, '_'); if (/^\d/.test(n)) n = '_' + n; return n; };
const hex = c => { const n = parseInt(String(c || '#000000').slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const cstr = s => JSON.stringify(String(s ?? '')).replace(/\\u([0-9a-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
const DIGITS = ['0b0111111', '0b0000110', '0b1011011', '0b1001111', '0b1100110', '0b1101101', '0b1111101', '0b0000111', '0b1111111', '0b1101111'];

/**
 * Contexte de génération du programme de la carte `board`, partagé par les règles et les blocs :
 * accumulateurs (inc, glob, setup, pre, body, tail, helpers, notes, printed) et outils (pinConst,
 * objName, uniq, readSignal, sensorExpr, actor…). assemble() écrit le programme complet.
 * cx : { comps, A (analyse), inspect(comp) → ins, rules, states (états par défaut) }.
 */
export function createGenContext(board, cx, opts = {}) {
  const prof = boardOf(board), kind = kindOf(board), robust = !!opts.robust;
  // Règles : 115200 bauds partout (un caractère en 87 µs : loop() n'attend jamais le port série).
  const avr = !!AVR_INFO[kind], baud = avr && !robust ? 9600 : 115200, max = adcMax(prof);
  const byId = id => cx.comps.find(c => c.id === id);
  const inc = new Set(), glob = [], setup = [], pre = [], body = [], tail = [], helpers = [], notes = [], printed = [];
  const declared = new Map(), used = new Set();
  const pinOf = (c, k) => { const ins = cx.inspect(c), g = ins.io[k]; return g && g.comp === board ? codePin(g) : null; };
  const onBoard = c => { const ins = cx.inspect(c); return ins.board === board; };
  /** Bouton : patte reliée à la carte (1, ou 2 s'il est monté dans l'autre sens) et sens de lecture (HIGH quand il est relié à l'alimentation). */
  const button = c => { const ins = cx.inspect(c), key = ins.io['1'] ? '1' : ins.io['2'] ? '2' : null; return key && { key, high: !!(ins.flags && ins.flags.activeHigh) }; };
  const names = new Set();
  const uniq = n => { if (RESERVED.has(n) || MACRO_LIKE.test(n)) n += '_PIN'; let x = n, i = 2; while (names.has(x) || RESERVED.has(x)) x = `${n}_${i++}`; names.add(x); return x; };
  const pinConst = (c, k, label) => {
    const p = pinOf(c, k); if (p == null) return null;
    const id = `${c.id}|${k}`;
    if (!declared.has(id)) {
      // Contacts d'un relais (côté puissance) : ne comptent pas, la commande garde le nom du relais (K1).
      const n0 = Object.keys(c.pins).filter(x => !(c.type === 'relay' && /^(COM|NO|NC)$/.test(x))).length;
      const single = n0 <= 3 && !['dcmotor', 'l298n', 'hcsr04', 'joystick', 'led-rgb', '7seg', 'stepper'].includes(c.type);
      const n = uniq(ident(single ? c.name : `${c.name}_${k.replace(/[^A-Za-z0-9]/g, '')}`));
      glob.push(`constexpr uint8_t ${n} = ${p};${label ? ` // ${label}` : ''}`);
      declared.set(id, n);
    }
    return declared.get(id);
  };
  const objName = c => { const id = c.id + '|obj'; if (!declared.has(id)) declared.set(id, uniq(ident(c.name.toLowerCase()))); return declared.get(id); };
  const missing = (c, what) => { const m = tl('// {0} {1} : utilisez « Câbler automatiquement ».', c.name, what || tl('n’est pas encore câblé(e) à ') + board.name); if (!notes.includes(m)) notes.push(m); return null; };
  const sigVar = new Map(), api = {};
  /** Texte fixe : en mémoire flash avec F() sur les cartes AVR (2 Ko de RAM seulement), tel quel ailleurs. */
  const flash = text => (avr ? `F(${cstr(text)})` : cstr(text));
  /** Lectures à intervalle d'un capteur lent : { period, why, timer, lines }. */
  const timed = new Map(), frames = [];
  let fast = false; // AccelStepper, réception : loop() doit tourner sans cesse, sans pause à la fin
  let nowUsed = false;
  /** Heure du tour de loop() (millis() lu une fois, la même pour toute la boucle). */
  const now = () => { nowUsed = true; return 'maintenant'; };
  const firsts = new Set(), first = c => (firsts.has(c.id) ? false : (firsts.add(c.id), true));
  /** Adresse I2C selon une broche d'adresse : reliée au + (haute) ou non (basse). */
  const i2cAddr = (c, k, low, high) => (cx.A && k && cx.A.net({ comp: c, key: k }).src.length ? high : low);
  function timedOf(c) {
    if (!timed.has(c.id)) {
      const [period, why] = SAMPLE[c.type] || [250, () => tl('assez pour suivre la mesure sans occuper le bus')], timer = uniq(`${objName(c)}_lecture`);
      glob.push(`uint32_t ${timer} = 0;`);
      timed.set(c.id, { c, period, why: why(), timer, lines: [] });
    }
    return timed.get(c.id);
  }

  /**
   * Capteur en paquet (.jpart) sur un bus I2C ou SPI, ou à impulsions : une fonction de lecture écrite pour lui, sans
   * bibliothèque (Wire, SPI, interruption), d'après ses registres, commandes ou trames déclarés. Rend son appel.
   */
  const pkgFns = new Map();
  function pkgRead(c, sig, P) {
    const id = `${c.id}|${sig.v}`;
    if (pkgFns.has(id)) return pkgFns.get(id);
    const o = objName(c), name = uniq(`${o}_${sig.v}`), lines = [];
    const lit = x => (Number.isInteger(x) ? `${x}.0` : String(+(+x).toPrecision(10)));
    const hex = x => `0x${x.toString(16).toUpperCase().padStart(2, '0')}`;
    const size = it => (it.bytes ? it.bytes.length : it.crc ? 1 : (it.bits || 16) / 8);
    const offsetOf = list => { let off = 0; for (const x of list) { if (x.quantity === sig.quantity) return off; off += size(x); } return 0; };
    const once = line => { if (!setup.includes(line)) setup.push(line); };
    // Octets b[off…] → valeur : ordre, signe, décalage, puis (brut − offset) / scale.
    const decode = (it, off) => {
      const n = (it.bits || 16) / 8;
      return [
        `  ${it.bits === 32 && !it.signed ? 'uint32_t' : 'int32_t'} v = 0;`,
        it.endian === 'little' ? `  for (int8_t i = ${n - 1}; i >= 0; i--) v = (v << 8) | b[${off} + i];` : `  for (uint8_t i = 0; i < ${n}; i++) v = (v << 8) | b[${off} + i];`,
        ...(it.signed && it.bits < 32 ? [`  if (v >= ${2 ** (it.bits - 1)}L) v -= ${2 ** it.bits}L;`] : []),
        ...(it.shift ? [`  v >>= ${it.shift};`] : []),
        `  return (v - ${lit(it.offset || 0)}) / ${lit(it.scale ?? 1)};`
      ];
    };
    if (sig.bus === 'i2c') {
      const I = pkgI2c(c.type); if (!I) return null;
      const high = !!I.addressPin && !!cx.A && cx.A.net({ comp: c, key: I.addressPin }).src.length > 0, a = hex(i2cAddress(I, high));
      inc.add('Wire.h'); once('Wire.begin();');
      const reg = (I.registers || []).find(r => r.quantity === sig.quantity);
      if (reg) {
        const n = reg.bits / 8;
        lines.push(tl('// {0} : {1}, registre {2} ({3} bits).', c.name, sig.label, hex(reg.at), reg.bits), `float ${name}() {`, `  Wire.beginTransmission(${a});`,
          ...(I.regBytes === 2 ? [`  Wire.write(${hex(reg.at >> 8)});`] : []), `  Wire.write(${hex(reg.at & 255)});`,
          tl('  if (Wire.endTransmission(false) != 0) return NAN; // départ répété : la lecture suit ; pas de réponse : mesure invalide'),
          tl('  if (Wire.requestFrom({0}, {1}) != {1}) return NAN; // octets manquants : mesure invalide', a, n), `  uint8_t b[${n}];`,
          `  for (uint8_t i = 0; i < ${n}; i++) b[i] = Wire.read();`, ...decode(reg, 0), '}');
      } else {
        const cmd = (I.commands || []).find(k => k.reply.some(x => x.quantity === sig.quantity)); if (!cmd) return null;
        const it = cmd.reply.find(x => x.quantity === sig.quantity), n = cmd.reply.reduce((t, x) => t + size(x), 0);
        lines.push(tl('// {0} : {1}, commande {2} puis {3} octets lus.', c.name, sig.label, cmd.write.map(hex).join(' '), n), `float ${name}() {`,
          `  Wire.beginTransmission(${a});`, ...cmd.write.map(x => `  Wire.write(${hex(x)});`), tl('  if (Wire.endTransmission() != 0) return NAN; // pas de réponse : mesure invalide'), tl('  delay(20); // le temps de la mesure'),
          tl('  if (Wire.requestFrom({0}, {1}) != {1}) return NAN; // octets manquants : mesure invalide', a, n), `  uint8_t b[${n}];`, `  for (uint8_t i = 0; i < ${n}; i++) b[i] = Wire.read();`, ...decode(it, offsetOf(cmd.reply)), '}');
      }
    } else if (sig.bus === 'spi') {
      const S = pkgSpi(c.type); if (!S) return null;
      const cs = P(S.cs); if (!cs) return missing(c);
      inc.add('SPI.h'); once('SPI.begin();'); once(`pinMode(${cs}, OUTPUT);`); once(`digitalWrite(${cs}, HIGH);`);
      if (S.mode === 'frame') {
        const it = S.frame.find(x => x.quantity === sig.quantity), n = S.frame.reduce((t, x) => t + size(x), 0);
        lines.push(tl('// {0} : {1}, trame SPI de {2} octets.', c.name, sig.label, n), `float ${name}() {`, `  digitalWrite(${cs}, LOW);`, `  uint8_t b[${n}];`,
          `  for (uint8_t i = 0; i < ${n}; i++) b[i] = SPI.transfer(0x00);`, `  digitalWrite(${cs}, HIGH);`, ...decode(it, offsetOf(S.frame)), '}');
      } else {
        const reg = S.registers.find(r => r.quantity === sig.quantity), n = reg.bits / 8, base = reg.at & S.addrMask;
        const first = S.readWhenSet ? base | S.readBit : base & ~S.readBit & 255;
        lines.push(tl('// {0} : {1}, registre SPI {2} ({3} bits).', c.name, sig.label, hex(reg.at), reg.bits), `float ${name}() {`, `  digitalWrite(${cs}, LOW);`,
          tl('  SPI.transfer({0}); // adresse, bit de lecture compris', hex(first)), `  uint8_t b[${n}];`, `  for (uint8_t i = 0; i < ${n}; i++) b[i] = SPI.transfer(0x00);`,
          `  digitalWrite(${cs}, HIGH);`, ...decode(reg, 0), '}');
      }
    } else if (sig.pulse) {
      const p = P(sig.pulse.pin); if (!p) return missing(c);
      const cnt = uniq(`${o}_impulsions`), isr = uniq(`${o}_compter`);
      glob.push(`volatile uint32_t ${cnt} = 0;`);
      helpers.push([tl('// {0} : une impulsion de plus, comptée par interruption (aucune n’est perdue).', c.name), `void ${isr}() {`, `  ${cnt}++;`, '}'].join('\n'));
      setup.push(`pinMode(${p}, INPUT);`, `attachInterrupt(digitalPinToInterrupt(${p}), ${isr}, RISING);`);
      lines.push(tl('// {0} : {1}, d’après les impulsions comptées pendant une seconde ({2} Hz par unité).', c.name, sig.label, lit(sig.pulse.hzPer)), `float ${name}() {`,
        '  static uint32_t debut = 0;', '  static float valeur = 0;', '  const uint32_t t = millis();', '  if (t - debut >= 1000UL) {', '    noInterrupts();',
        `    const uint32_t n = ${cnt};`, `    ${cnt} = 0;`, '    interrupts();', `    valeur = n * 1000.0f / (t - debut) / ${lit(sig.pulse.hzPer)};`, '    debut = t;', '  }',
        '  return valeur;', '}');
    } else return null;
    helpers.push(lines.join('\n'));
    const call = `${name}()`;
    pkgFns.set(id, call);
    return call;
  }
  /** BH1750 : bus I2C démarré par le programme (la bibliothèque ne le fait pas), mesure continue en haute résolution. */
  function bh1750Setup(c, o) {
    inc.add('Wire.h'); inc.add('BH1750.h');
    const addr = cx.A && cx.A.net({ comp: c, key: 'ADDR' }).src.length ? '0x5C' : '0x23';
    glob.push(`BH1750 ${o};`);
    if (!setup.includes('Wire.begin();')) setup.push('Wire.begin();');
    setup.push(tl('if (!{0}.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, {1})) Serial.println("{2} introuvable : vérifiez SDA, SCL et l’adresse");', o, addr, c.name));
  }
  /** HX711 : balance étalonnée en grammes, mise à zéro au démarrage. */
  function hx711Setup(o, dt, sck) {
    inc.add('HX711.h');
    glob.push(`HX711 ${o};`);
    setup.push(`${o}.begin(${dt}, ${sck});`, tl('{0}.set_scale({1}); // étalonnage : coups par gramme, à ajuster avec une masse connue', o, HX711_PER_G.toFixed(1)), tl('{0}.tare(); // la balance doit être vide au démarrage', o));
  }
  /** Contacts mécaniques : la mesure est filtrée (anti-rebond de 20 ms) avant d'être utilisée. */
  const DEBOUNCE = { button: ['pressed'], joystick: ['sw'], 'tilt-sw': ['tilted'], cylsensor: ['pressed'], pressostat: ['pressed'] };
  /** Capteur sur un bus ou qui peut ne pas répondre : nombre d'échecs de lecture d'affilée (« en panne » à partir de 3). */
  const failVar = c => { const id = c.id + '|fail'; if (!declared.has(id)) { const n = uniq(`${objName(c)}_echecs`); declared.set(id, n); glob.push(tl('uint8_t {0} = 0; // lectures ratées d’affilée ({1} en panne à partir de 3)', n, c.name)); } return declared.get(id); };
  /**
   * Comment lire une mesure : { expr | lines, every?, why?, bad?, pre?, post? } (voir rules-parts.js), ou null.
   * Écrit au passage les objets, bibliothèques et réglages du composant.
   */
  function readSpec(c, key, sig, o, out) {
    const P = k => pinConst(c, k), f = first(c);
    const begin = (cls, addr, what) => {
      inc.add('Wire.h'); inc.add(`${cls}.h`); glob.push(`${cls} ${o};`);
      setup.push(tl('if (!{0}.begin({1})) { // {2} absent : ses mesures restent « en panne »', o, addr || '', c.name), `  Serial.println(${flash(tl('{0} introuvable : vérifiez {1}', c.name, what))});`, `  ${failVar(c)} = 255;`, '}');
    };
    switch (c.type) {
      case 'dht11': case 'dht22': {
        const p = P('DATA'); if (!p) return missing(c);
        if (f) { inc.add('DHT.h'); glob.push(`DHT ${o}(${p}, ${c.type.toUpperCase()});`); setup.push(`${o}.begin();`); }
        return { expr: key === 'temp' ? `${o}.readTemperature()` : `${o}.readHumidity()`, bad: 'isnan(x)', note: tl('NaN : capteur muet') };
      }
      case 'ds18b20': {
        const p = P('DQ'); if (!p) return missing(c);
        if (f) {
          inc.add('OneWire.h'); inc.add('DallasTemperature.h');
          glob.push(`OneWire ${o}_bus(${p});`, `DallasTemperature ${o}(&${o}_bus);`);
          setup.push(`${o}.begin();`, tl('{0}.setWaitForConversion(false); // la conversion (750 ms) ne bloque pas loop()', o), `${o}.requestTemperatures();`);
        }
        return { expr: `${o}.getTempCByIndex(0)`, post: [tl('{0}.requestTemperatures(); // mesure suivante, prête dans 750 ms', o)], every: 1000, why: tl('le temps d’une conversion'), bad: 'x <= DEVICE_DISCONNECTED_C', note: tl('-127 °C : sonde débranchée') };
      }
      case 'bme280': case 'bmp280': {
        if (f) begin(c.type === 'bme280' ? 'Adafruit_BME280' : 'Adafruit_BMP280', cx.A && cx.A.net({ comp: c, key: 'SDO' }).gnd.length ? '0x76' : '0x77', tl('SDA, SCL et l’adresse'));
        return { expr: key === 'press' ? `${o}.readPressure() / 100.0f` : key === 'hum' ? `${o}.readHumidity()` : `${o}.readTemperature()`, bad: 'isnan(x)' };
      }
      case 'bh1750': {
        if (f) {
          inc.add('Wire.h'); inc.add('BH1750.h'); glob.push(`BH1750 ${o};`); if (!setup.includes('Wire.begin();')) setup.push('Wire.begin();');
          setup.push(tl('if (!{0}.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, {1})) {', o, i2cAddr(c, 'ADDR', '0x23', '0x5C')), `  Serial.println(${flash(tl('{0} introuvable : vérifiez SDA, SCL et l’adresse', c.name))});`, `  ${failVar(c)} = 255;`, '}');
        }
        return { expr: `${o}.readLightLevel()`, bad: 'x < 0', note: tl('valeur négative : pas de réponse') };
      }
      case 'hx711': {
        const dt = P('DT'), sck = P('SCK'); if (!dt || !sck) return missing(c);
        if (f) hx711Setup(o, dt, sck);
        return { lines: [tl('if ({0}.is_ready()) {1} = {0}.get_units(1); // lue dès qu’une mesure est prête (10 par seconde), sans attendre', o, out.v)] };
      }
      case 'mpu6050': {
        if (f) begin('Adafruit_MPU6050', '', tl('SDA et SCL'));
        if (f) inc.add('Adafruit_Sensor.h');
        return { pre: [`sensors_event_t ${o}_a, ${o}_g, ${o}_t;`, `${o}.getEvent(&${o}_a, &${o}_g, &${o}_t);`], expr: `atan2f(${o}_a.acceleration.x, ${o}_a.acceleration.z) * RAD_TO_DEG`, bad: 'isnan(x)' };
      }
      case 'hcsr04': {
        const t = P('TRIG'), e = P('ECHO'); if (!t || !e) return missing(c);
        setup.push(`pinMode(${t}, OUTPUT);`, `pinMode(${e}, INPUT);`);
        if (!helpers.some(h => h.includes('float mesurerDistance('))) helpers.push([
          tl('// Distance en cm : une impulsion de 10 µs sur TRIG, puis la durée de l’écho (aller-retour du son).'),
          tl('// Pas d’écho en 25 ms (rien à moins de 4 m) : 400 cm, « loin », jamais 0 (qui ferait croire à un obstacle).'),
          'float mesurerDistance(uint8_t trig, uint8_t echo) {',
          '  digitalWrite(trig, LOW);', '  delayMicroseconds(2);', '  digitalWrite(trig, HIGH);', '  delayMicroseconds(10);', '  digitalWrite(trig, LOW);',
          '  const uint32_t duree = pulseIn(echo, HIGH, 25000UL);', '  return duree == 0 ? 400.0f : duree / 58.0f;', '}'].join('\n'));
        return { expr: `mesurerDistance(${t}, ${e})` };
      }
      case 'pir': { const p = P('OUT'); if (!p) return missing(c); setup.push(`pinMode(${p}, INPUT);`); return { expr: `digitalRead(${p}) == HIGH` }; }
      case 'button': { const b = button(c), p = b && P(b.key); if (!p) return missing(c); setup.push(b.high ? tl('pinMode({0}, INPUT); // résistance de rappel : relâché LOW, appuyé HIGH', p) : tl('pinMode({0}, INPUT_PULLUP); // relâché : HIGH, appuyé : LOW', p)); return { expr: `digitalRead(${p}) == ${b.high ? 'HIGH' : 'LOW'}` }; }
      case 'cylsensor': { const b = button(c), p = b && P(b.key); if (!p) return missing(c); setup.push(tl('pinMode({0}, INPUT_PULLUP); // piston absent : HIGH, piston devant le capteur : LOW', p)); return { expr: `digitalRead(${p}) == LOW` }; }
      case 'pressostat': { const b = button(c), p = b && P(b.key); if (!p) return missing(c); setup.push(tl('pinMode({0}, INPUT_PULLUP); // sous le seuil : HIGH, pression atteinte : LOW', p)); return { expr: `digitalRead(${p}) == LOW` }; }
      case 'ldr': case 'mq2': { const p = P('AO'); if (!p) return missing(c); return { expr: `analogRead(${p})` }; }
      case 'soil': { const p = P('AOUT'); if (!p) return missing(c); return { expr: `analogRead(${p})` }; }
      case 'pot': { const p = P('W'); if (!p) return missing(c); return { expr: `analogRead(${p})` }; }
      case 'tilt-sw': case 'hall': case 'flame': case 'rain': case 'water': case 'irobst': case 'line': case 'shock': case 'ttp223': case 'rcwl0516': case 'mq135': {
        const [k, on] = SIMPLE[c.type][key], p = P(k); if (!p) return optPin(c, k) ? null : missing(c); // sortie facultative (AO) non câblée : ignorée
        if (on) { setup.push(`pinMode(${p}, INPUT);`); return { expr: `digitalRead(${p}) == ${on}` }; }
        return { expr: `analogRead(${p})` };
      }
      case 'lm35': { const p = P('VOUT'); if (!p) return missing(c); return { expr: `analogRead(${p}) * (${prof.vref.toFixed(1)}f * 100.0f / ${max}.0f)`, note: tl('10 mV par °C') }; }
      case 'sound': { const p = P('AO'); if (!p) return missing(c); return { expr: `abs(analogRead(${p}) - ${Math.round(max / 2)})`, note: tl('écart au silence (moitié de l’échelle)') }; }
      case 'joystick': {
        if (key === 'sw') { const p = P('SW'); if (!p) return missing(c); setup.push(`pinMode(${p}, INPUT_PULLUP);`); return { expr: `digitalRead(${p}) == LOW` }; }
        const p = P(key === 'x' ? 'VRx' : 'VRy'); if (!p) return missing(c); return { expr: `analogRead(${p})` };
      }
      default: {
        if (PART_GEN[c.type] && PART_GEN[c.type].read) return PART_GEN[c.type].read(api, c, key, sig, out);
        // Capteur en paquet (.jpart) : sur un bus ou à impulsions, sa fonction de lecture ; sinon la broche de sa sortie
        // déclarée, lue par analogRead ou digitalRead.
        if (sig.bus || sig.pulse) { const e = pkgRead(c, sig, P); if (!e) return null; return sig.kind === 'bool' ? { expr: `${e} >= 0.5f` } : { expr: e, bad: sig.bus ? 'isnan(x)' : null, every: sig.bus ? 250 : 0 }; }
        if (!sig.pin) return null;
        const p = P(sig.pin); if (!p) return sig.opt ? null : missing(c); // sortie facultative non câblée : ignorée
        if (sig.kind === 'bool') { setup.push(`pinMode(${p}, INPUT);`); return { expr: `digitalRead(${p}) == ${sig.low ? 'LOW' : 'HIGH'}` }; }
        return { expr: `analogRead(${p})` };
      }
    }
  }
  /** Type C++ d'une mesure. */
  const ctypeOf = sig => (sig.kind === 'bool' ? 'bool' : sig.kind === 'text' ? 'char' : sig.type === 'float' ? 'float' : sig.type === 'long' ? 'int32_t' : sig.type === 'u32' ? 'uint32_t' : 'int');
  /** Événements : drapeaux remis à false au début de chaque tour, puis levés par la réception. */
  const events = [];
  /**
   * Déclare un capteur et retourne la variable qui contient sa mesure, lue une fois au début de loop() (ou à son rythme,
   * gardée entre deux lectures). Mesure qui peut échouer : la dernière bonne valeur reste. Événement : rend la variable
   * de la valeur reçue ; eventOf(c, clé) rend son drapeau.
   */
  function readSignal(c, key) {
    const id = `${c === SERIAL ? SERIAL : c.id}|${key}`;
    if (sigVar.has(id)) return sigVar.get(id);
    if (c === SERIAL) return serialLine();
    if (!onBoard(c)) return missing(c);
    const sig = signalOf(c.type, key, prof); if (!sig) return null;
    if (key === 'fault') {
      // Mesure « en panne » : lit les autres mesures du composant (qui comptent les échecs).
      const keys = Object.keys(SIGNALS[c.type]).filter(k => k !== 'fault'), other = keys.find(k => SIGNALS[c.type][k].kind !== 'bool') || keys[0]; if (!other || !readSignal(c, other)) return null;
      const v = `(${failVar(c)} >= 3)`; sigVar.set(id, v); return v;
    }
    const o = objName(c), v = uniq(`${o}_${sig.v}`), type = ctypeOf(sig);
    const out = { v, ev: sig.event ? uniq(`${v}_recu`) : null, type, ok: null };
    const spec = readSpec(c, key, sig, o, out); if (!spec) return null;
    used.add(c.id);
    const note = spec.note ? ` // ${spec.note}` : sig.note ? ` // ${sig.note}` : '';
    const decl = sig.kind === 'text' ? `char ${v}[${(sig.len || 16) + 1}] = "";${note}` : `${type} ${v} = ${type === 'bool' ? 'false' : '0'};${note}`;
    const period = spec.every || (SAMPLE[c.type] && SAMPLE[c.type][0]) || 0;
    // Une mesure fraîche x : gardée si elle est bonne (sinon un échec de plus).
    const take = expr => {
      if (!spec.bad) return [`${v} = ${expr};`];
      const fv = failVar(c);
      return [`const ${type} x = ${expr};`, tl('if ({0}) {', spec.bad), tl('  if ({0} < 255) {0}++; // mesure ratée : la précédente reste', fv), '} else {', `  ${v} = x;`, `  ${fv} = 0;`, '}'];
    };
    const block = [...(spec.pre || []), ...(spec.lines || take(spec.expr)), ...(spec.post || [])];
    if (sig.event) {
      glob.push(decl, tl('bool {0} = false; // vrai pendant le tour de loop() où {1} arrive', out.ev, sig.label));
      events.push({ c, ev: out.ev, lines: block, period });
      sigVar.set(id, v); evVar.set(id, out.ev);
      return v;
    }
    const deb = DEBOUNCE[c.type] && DEBOUNCE[c.type].includes(key) && spec.expr;
    if (period) {
      const t = timedOf(c); if (spec.every) { t.period = spec.every; if (spec.why) t.why = spec.why; }
      glob.push(decl); t.lines.push(...(spec.bad || spec.pre || spec.post || spec.lines ? ['{', ...block.map(l => '  ' + l), '}'] : block));
    } else if (deb) {
      // Anti-rebond : la valeur ne change qu'après 20 ms stables (un contact rebondit pendant quelques ms).
      glob.push(tl('bool {0} = false; // {1}, filtré (anti-rebond)', v, sig.label), `bool ${v}_brut = false;`, `uint32_t ${v}_change = 0;`);
      pre.push('{', `  const bool brut = ${spec.expr};`, `  if (brut != ${v}_brut) {`, `    ${v}_brut = brut;`, `    ${v}_change = ${now()};`, `  } else if (${now()} - ${v}_change >= 20UL) {`, `    ${v} = brut;`, '  }', '}');
    } else if (spec.lines || spec.bad || spec.pre || spec.post) { glob.push(decl); pre.push(...block); }
    else pre.push(`const ${type} ${v} = ${spec.expr};${note}`);
    sigVar.set(id, v);
    if (sig.kind !== 'text') printed.push([`${c.name} ${sig.label}`, v, sig.unit || '', sig.kind === 'bool', c, sig]);
    return v;
  }
  const evVar = new Map();
  /** Drapeau d'événement d'une mesure (vrai le tour où elle arrive), après readSignal. */
  const eventOf = (c, key) => evVar.get(`${c === SERIAL ? SERIAL : c.id}|${key}`) || null;
  /** Moniteur série : une ligne reçue, caractère par caractère, sans jamais attendre (fin de ligne : \n). */
  function serialLine() {
    const id = `${SERIAL}|line`, n = SERIAL_SIG.line.len;
    glob.push(tl('char ligneRecue[{0}] = ""; // dernière ligne reçue du moniteur série ({1} caractères au plus)', n + 1, n), 'uint8_t ligneRecue_n = 0;', tl('bool ligneRecue_recu = false; // vrai pendant le tour de loop() où une ligne arrive'));
    // Pas besoin de tourner sans cesse : un octet qui arrive réveille la carte et attend dans la mémoire du port série.
    events.push({ c: SERIAL, ev: 'ligneRecue_recu', lines: [
      tl('while (Serial.available() > 0) { // moniteur série : on lit ce qui est arrivé, sans attendre la suite'), '  const char car = (char)Serial.read();',
      "  if (car == '\\n') {", '    ligneRecue[ligneRecue_n] = \'\\0\';', '    ligneRecue_n = 0;', '    ligneRecue_recu = true;', tl('    break; // une ligne par tour : la suivante attend le prochain tour'),
      '  }', tl("  if (car != '\\r' && ligneRecue_n < sizeof(ligneRecue) - 1) ligneRecue[ligneRecue_n++] = car; // trop long : la fin est ignorée"), '}'], period: 0 });
    sigVar.set(id, 'ligneRecue'); evVar.set(id, 'ligneRecue_recu');
    return 'ligneRecue';
  }

  /** Déclare un effecteur ; retourne une fonction qui écrit le code d'une action. */
  const actors = new Map();
  function actor(c) {
    if (actors.has(c.id)) return actors.get(c.id);
    let a = null, lcdMemo = null, frame = null;
    const o = objName(c), P = (k, l) => pinConst(c, k, l);
    const pl = pkgLed(c.type); // LED en paquet (.jpart) : commandée par son anode, comme une LED de la bibliothèque
    if (/^led-(red|green|blue|yellow|white)$/.test(c.type) || pl) {
      const p = P(pl ? pl.anode : 'A');
      if (p) {
        setup.push(`pinMode(${p}, OUTPUT);`);
        const pwm = (() => { const g = cx.inspect(c).io[pl ? pl.anode : 'A']; return g && boardOf(g.comp).gpio[g.key] && boardOf(g.comp).gpio[g.key].caps.has('pwm'); })();
        a = (act, arg, x) => {
          if ((act === 'dim' || act === 'follow') && !pwm) notes.push(tl('// {0} est sur une broche sans PWM : analogWrite() n’y donnera que LOW ou HIGH.', c.name));
          if (act === 'on') return [`digitalWrite(${p}, HIGH);`];
          if (act === 'off') return [`digitalWrite(${p}, LOW);`];
          if (act === 'blink') return [tl('digitalWrite({0}, (millis() / {1}) % 2 ? HIGH : LOW); // change d’état toutes les {2} ms', p, Math.max(1, arg | 0), arg | 0)];
          if (act === 'dim') return [`analogWrite(${p}, ${arg | 0});`];
          if (act === 'follow') return [`analogWrite(${p}, ${x});`];
          return [];
        };
      }
    } else if (c.type === 'laser') {
      const p = P('S');
      if (p) {
        setup.push(`pinMode(${p}, OUTPUT);`);
        a = (act, arg) => (act === 'on' ? [`digitalWrite(${p}, HIGH);`] : act === 'off' ? [`digitalWrite(${p}, LOW);`]
          : act === 'blink' ? [tl('digitalWrite({0}, (millis() / {1}) % 2 ? HIGH : LOW); // change d’état toutes les {2} ms', p, Math.max(1, arg | 0), arg | 0)] : []);
      }
    } else if (c.type === 'traffic') {
      const r = P('R'), y = P('Y'), g = P('G');
      if (r && y && g) {
        setup.push(`pinMode(${r}, OUTPUT);`, `pinMode(${y}, OUTPUT);`, `pinMode(${g}, OUTPUT);`);
        a = act => { const on = { red: r, yellow: y, green: g }[act]; return [r, y, g].map(q => `digitalWrite(${q}, ${q === on ? 'HIGH' : 'LOW'});`); }; // une seule couleur à la fois
      }
    } else if (c.type === 'led-rgb') {
      const r = P('R'), g = P('G'), b = P('B');
      if (r && g && b) a = (act, arg) => { const [R, G, B] = act === 'color' ? hex(arg) : [0, 0, 0]; return [`analogWrite(${r}, ${R});`, `analogWrite(${g}, ${G});`, `analogWrite(${b}, ${B});`]; };
    } else if (c.type === 'buzzer') {
      // Directement sur une broche, ou derrière un transistor (+ au 5 V, − au collecteur) : la base est la commande.
      const d = P('+') ? null : driveOf(c, cx.A), p = P('+') || (d && d.kind === 'npn' && d.gpio && d.gpio.comp === board ? pinConst(d.npn, d.base || 'B') : null);
      const ON = d && d.low ? 'LOW' : 'HIGH', OFF = d && d.low ? 'HIGH' : 'LOW'; // PNP côté + : actif à l'état bas
      if (p) { if (d && d.low) setup.push(tl('digitalWrite({0}, HIGH); // {1} bloqué au départ (PNP : LOW le fait conduire)', p, d.npn.name)); setup.push(d ? (d.low ? tl('pinMode({0}, OUTPUT); // base de {1} : LOW, le transistor conduit et {2} sonne', p, d.npn.name, c.name) : tl('pinMode({0}, OUTPUT); // base de {1} : HIGH, le transistor conduit et {2} sonne', p, d.npn.name, c.name)) : `pinMode(${p}, OUTPUT);`); a = (act, arg) => (act === 'on' ? [`digitalWrite(${p}, ${ON});`] : act === 'off' ? [`digitalWrite(${p}, ${OFF});`] : [tl('digitalWrite({0}, (millis() / {1}) % 2 ? HIGH : LOW); // bip toutes les {2} ms', p, Math.max(1, arg | 0), arg | 0)]); }
    } else if (COILS[c.type]) {
      // Bobine d'électrovanne : derrière un transistor (+ au 24 V, − au collecteur), la base est la commande.
      const d = driveOf(c, cx.A), p = d && d.kind === 'npn' && d.gpio && d.gpio.comp === board ? pinConst(d.npn, d.base || 'B') : null;
      if (p) {
        if (d.low) setup.push(tl('digitalWrite({0}, HIGH); // {1} bloqué au départ (PNP : LOW le fait conduire)', p, d.npn.name));
        setup.push(d.low ? tl('pinMode({0}, OUTPUT); // base de {1} : LOW, le transistor conduit et {2} est excitée', p, d.npn.name, c.name) : tl('pinMode({0}, OUTPUT); // base de {1} : HIGH, le transistor conduit et {2} est excitée', p, d.npn.name, c.name));
        a = act => [`digitalWrite(${p}, ${(act === 'on') !== !!d.low ? 'HIGH' : 'LOW'});`];
      }
    } else if (c.type === 'speaker') {
      const p = P('+');
      if (p) a = (act, arg, x) => (act === 'note' ? [`tone(${p}, ${arg | 0});`] : act === 'off' ? [`noTone(${p});`] : [`tone(${p}, ${x});`]);
    } else if (c.type === 'relay') {
      const p = P('IN');
      if (p) { setup.push(tl('digitalWrite({0}, HIGH); // relais au repos (module actif à l’état bas)', p), `pinMode(${p}, OUTPUT);`); a = act => (act === 'on' ? [tl('digitalWrite({0}, LOW); // LOW colle le relais', p)] : [`digitalWrite(${p}, HIGH);`]); }
    } else if (c.type === 'servo') {
      const p = P('SIG');
      if (p) { inc.add(isEsp32(kind) ? 'ESP32Servo.h' : 'Servo.h'); glob.push(`Servo ${o};`); setup.push(`${o}.attach(${p});`); a = (act, arg, x) => [`${o}.write(${act === 'follow' ? x : arg | 0});`]; }
    } else if (isMotor(c)) {
      // Moteur, ventilateur, pompe, vibreur : par un pilote L298N (sens et vitesse), un transistor (marche, vitesse en PWM)
      // ou un relais (tout ou rien) ; alimenté en permanence, il n'y a rien à commander.
      const motion = (act, arg, x) => (act === 'stop' ? { stop: true } : { dir: act === 'back' ? -1 : 1, full: act === 'on' || (act !== 'follow' && (arg | 0) >= 100),
        v: act === 'follow' ? `map(${x}, 0, 100, 0, 255)` : act === 'on' ? 255 : Math.round((arg | 0) * 2.55) });
      const d = driveOf(c, cx.A);
      if (d && d.kind === 'l298n') {
        const drv = d.drv, [k1, k2, ke] = d.keys;
        const ins = cx.inspect(drv);
        if (ins.board === board) {
          const plusFirst = d.plusFirst;
          const i1 = pinConst(drv, k1), i2 = pinConst(drv, k2), en = pinConst(drv, ke), sb = d.stby ? pinConst(drv, d.stby) : null;
          if (i1 && i2) {
            setup.push(`pinMode(${i1}, OUTPUT);`, `pinMode(${i2}, OUTPUT);`);
            // TB6612FNG : STBY sur une broche de la carte, à mettre au niveau haut (sinon tout reste coupé).
            if (sb && !setup.some(l => l.startsWith(`pinMode(${sb},`))) setup.push(`pinMode(${sb}, OUTPUT);`, tl('digitalWrite({0}, HIGH); // {1} sort de veille', sb, drv.name));
            const [fa, fb] = plusFirst ? [i1, i2] : [i2, i1];
            const speed = v => (en ? [tl('analogWrite({0}, {1}); // vitesse 0 à 255', en, v)]
              : drv.type === 'l298n' ? [tl('// {0} n’est pas câblée : le cavalier du L298N donne toujours la pleine vitesse', ke)] : [tl('// {0} n’est pas câblée : la voie reste coupée', ke)]);
            a = (act, arg, x) => {
              const m = motion(act, arg, x);
              if (m.stop) return [`digitalWrite(${i1}, LOW);`, `digitalWrite(${i2}, LOW);`];
              const fwd = m.dir > 0;
              return [`digitalWrite(${fwd ? fa : fb}, HIGH);`, `digitalWrite(${fwd ? fb : fa}, LOW);`, ...speed(m.v)];
            };
          } else missing(drv, tl('n’a pas ses entrées de commande reliées à ') + board.name);
        } else missing(drv);
      } else if (d && d.kind === 'npn') {
        const p = d.gpio && d.gpio.comp === board ? pinConst(d.npn, d.base || 'B') : null;
        if (p) {
          const pwm = d.gpio.g && d.gpio.g.caps.has('pwm');
          if (d.low) setup.push(tl('digitalWrite({0}, HIGH); // {1} bloqué au départ (PNP : LOW le fait conduire)', p, d.npn.name));
          if (d.low) setup.push(d.fet ? tl('pinMode({0}, OUTPUT); // grille de {1} : LOW, le MOSFET canal P conduit et {2} tourne', p, d.npn.name, c.name) : tl('pinMode({0}, OUTPUT); // base de {1} : LOW, le transistor conduit et {2} tourne', p, d.npn.name, c.name));
          else setup.push(d.fet ? tl('pinMode({0}, OUTPUT); // grille de {1} : HIGH, le MOSFET conduit et {2} tourne', p, d.npn.name, c.name) : tl('pinMode({0}, OUTPUT); // base de {1} : HIGH, le transistor conduit et {2} tourne', p, d.npn.name, c.name));
          a = (act, arg, x) => {
            const m = motion(act, arg, x);
            if (m.stop) return [`digitalWrite(${p}, ${d.low ? 'HIGH' : 'LOW'});`];
            const pre = m.dir < 0 ? [tl('// un transistor ne fait tourner que dans un sens : il faut un pont en H (L298N) pour inverser')] : [];
            // Côté + (PNP, canal P) : rapport cyclique inversé, 0 = pleine vitesse.
            return [...pre, m.full || !pwm ? `digitalWrite(${p}, ${d.low ? 'LOW' : 'HIGH'});` : d.low ? tl('analogWrite({0}, 255 - {1}); // vitesse 0 à 255 (actif à l’état bas)', p, m.v) : tl('analogWrite({0}, {1}); // vitesse 0 à 255', p, m.v)];
          };
        } else missing(d.npn, (d.fet ? tl('n’a pas sa grille reliée à ') : tl('n’a pas sa base reliée (par une résistance) à ')) + board.name);
      } else if (d && d.kind === 'relay') {
        const p = d.gpio && d.gpio.comp === board ? pinConst(d.relay, 'IN') : null;
        if (p) {
          // Relais actif à l'état bas : LOW colle le relais ; sur NC, c'est l'inverse qui fait tourner.
          const run = d.contact === 'NO' ? 'LOW' : 'HIGH', rest = d.contact === 'NO' ? 'HIGH' : 'LOW';
          setup.push(tl('digitalWrite({0}, HIGH); // relais au repos (module actif à l’état bas)', p), `pinMode(${p}, OUTPUT);`);
          a = (act, arg, x) => {
            const m = motion(act, arg, x);
            if (m.stop) return [tl('digitalWrite({0}, {1}); // {2} s’arrête', p, rest, c.name)];
            return [tl('digitalWrite({0}, {1}); // {2} tourne (contact {3} fermé)', p, run, c.name, d.contact), ...(m.full ? [] : [tl('// un relais ne règle pas la vitesse : tout ou rien')])];
          };
        } else missing(d.relay, tl('n’a pas son entrée IN reliée à ') + board.name);
      } else {
        const [mp, mm] = motorPins(c), wired = cx.A && (cx.A.deg({ comp: c, key: mp }) || cx.A.deg({ comp: c, key: mm }));
        if (wired) a = () => [tl('// {0} est alimenté en permanence : rien à commander (ajoutez un transistor, un relais ou un pilote)', c.name)];
        else missing(c, tl('n’est pas relié à un pilote L298N'));
      }
      actors.set(c.id, a); return a;
    } else if (c.type === 'stepper') {
      const p = ['IN1', 'IN2', 'IN3', 'IN4'].map(k => P(k));
      if (p.every(Boolean) && robust) {
        // 28BYJ-48 : AccelStepper fait un pas quand il est temps, sans jamais bloquer loop() (Stepper.step() attendrait).
        inc.add('AccelStepper.h'); fast = true;
        glob.push(tl('AccelStepper {0}(AccelStepper::FULL4WIRE, {1}, {2}, {3}, {4}); // ordre IN1-IN3-IN2-IN4, 2048 pas par tour', o, p[0], p[2], p[1], p[3]));
        setup.push(tl('{0}.setMaxSpeed(500); // pas par seconde (≈ 15 tr/min, le plus que tient ce moteur)', o));
        tail.push(tl('// {0} : un pas quand il est temps (à appeler sans cesse)', c.name), `${o}.runSpeed();`);
        a = act => (act === 'cw' ? [tl('{0}.setSpeed(400); // ≈ 12 tr/min, sens horaire', o)] : act === 'ccw' ? [tl('{0}.setSpeed(-400); // sens antihoraire', o)] : [tl('{0}.setSpeed(0); // à l’arrêt', o)]);
        a.guard = true;
      } else if (p.every(Boolean)) {
        inc.add('Stepper.h'); glob.push(tl('Stepper {0}(2048, {1}, {2}, {3}, {4}); // ordre IN1-IN3-IN2-IN4', o, p[0], p[2], p[1], p[3])); setup.push(tl('{0}.setSpeed(12); // tours par minute', o));
        a = act => (act === 'cw' ? [tl('{0}.step(64); // un petit pas à chaque tour de loop()', o)] : act === 'ccw' ? [`${o}.step(-64);`] : [tl('// à l’arrêt')]);
      }
    } else if (STEPPERS[c.type]) {
      // Moteur pas à pas bipolaire : la bibliothèque AccelStepper commande STEP et DIR de son pilote. Position (moveTo,
      // avec rampe, run()) ou vitesse continue (setSpeed, runSpeed()) ; la microrésolution câblée multiplie les pas.
      const L = stepperLink(c, cx.A), drv = L && L.drv;
      const st = drv && cx.inspect(drv).board === board ? pinConst(drv, 'STEP') : null, dr = st ? pinConst(drv, 'DIR') : null;
      if (st && dr) {
        const div = driverInputs(drv, k => (drv.pins[k] ? netLevel(cx.A, { comp: drv, key: k }) : null)).div, per = STEPPERS[c.type].steps * div;
        inc.add('AccelStepper.h'); fast = true;
        glob.push(tl('AccelStepper {0}(AccelStepper::DRIVER, {1}, {2}); // pilote {3} : (STEP, DIR)', o, st, dr, drv.name), tl('bool {0}_continu = false; // true : vitesse continue (runSpeed), false : position (run)', o));
        setup.push(tl('{0}.setMaxSpeed({1}); // pas par seconde ({2} tr/min{3})', o, 1000 * div, 300, div > 1 ? tl(', 1/{0} de pas', div) : ''), tl('{0}.setAcceleration({1}); // rampe : le moteur ne décroche pas', o, 2000 * div));
        if (!L.ok) notes.push(tl('// {0} : bobines mal appariées sur {1}, le moteur vibrera sans tourner.', c.name, drv.name));
        tail.push(tl('// {0} : un pas quand il est temps (à appeler sans cesse, jamais de delay() long)', c.name), `if (${o}_continu) ${o}.runSpeed(); else ${o}.run();`);
        a = (act, arg) => {
          if (act === 'pos') return [`${o}_continu = false;`, tl('{0}.moveTo({1}); // {2} pas du moteur = {3} tour(s)', o, Math.round((+arg || 0) * div), Math.round(+arg || 0), String(Math.round((+arg || 0) / STEPPERS[c.type].steps * 100) / 100).replace('.', DEC))];
          if (act === 'speed') return [`${o}_continu = true;`, tl('{0}.setSpeed({1}); // {2} tr/min', o, Math.round((+arg || 0) * per / 60), Math.round(+arg || 0))];
          return [tl('if ({0}_continu) {0}.setSpeed(0); // s’arrête', o), tl('{0}.moveTo({0}.currentPosition());', o)];
        };
      } else missing(drv || c, drv ? tl('n’a pas STEP et DIR reliées à ') + board.name : tl('n’est pas relié à un pilote A4988 ou DRV8825'));
    } else if (c.type === '7seg') {
      const segs = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(k => P(k));
      if (segs.every(Boolean)) {
        glob.push(`constexpr uint8_t ${o}_segments[7] = {${segs.join(', ')}}; // a, b, c, d, e, f, g`);
        if (!helpers.some(h => h.includes('CHIFFRES'))) helpers.push([
          tl('// Segments allumés pour chaque chiffre (bit 0 = a … bit 6 = g).'),
          `constexpr uint8_t CHIFFRES[10] = {${DIGITS.join(', ')}};`,
          'void afficherChiffre(const uint8_t segments[], int8_t n) {',
          '  for (uint8_t i = 0; i < 7; i++) {',
          '    bool allume = n >= 0 && n <= 9 && bitRead(CHIFFRES[n], i);',
          '    digitalWrite(segments[i], allume ? HIGH : LOW);', '  }', '}'].join('\n'));
        setup.push(`for (uint8_t i = 0; i < 7; i++) pinMode(${o}_segments[i], OUTPUT);`);
        a = (act, arg, x) => [`afficherChiffre(${o}_segments, ${act === 'off' ? -1 : act === 'follow' ? x : arg | 0});`];
        a.guard = true;
      }
    } else if (c.type === 'ws2812') {
      const p = P('DIN');
      if (p) {
        inc.add('Adafruit_NeoPixel.h'); glob.push(`Adafruit_NeoPixel ${o}(8, ${p}, NEO_GRB + NEO_KHZ800);`); setup.push(`${o}.begin();`, `${o}.setBrightness(80);`, `${o}.show();`);
        a = (act, arg, x) => {
          if (act === 'off') return [`${o}.clear();`, `${o}.show();`];
          const [R, G, B] = hex(Array.isArray(arg) ? null : arg || '#3fb27f');
          if (act === 'follow') return [`for (uint8_t i = 0; i < 8; i++) ${o}.setPixelColor(i, i < ${x} ? ${o}.Color(${R}, ${G}, ${B}) : 0);`, `${o}.show();`];
          return [`${o}.fill(${o}.Color(${R}, ${G}, ${B}));`, `${o}.show();`];
        };
        a.guard = true; // show() coupe les interruptions ≈ 0,25 ms : seulement quand les couleurs changent
      }
    } else if (c.type === 'lcd2004' || ((c.type === 'lcd1602' || c.type === 'oled') && robust)) {
      if (onBoard(c)) a = screenActor(c, o);
      else missing(c);
    } else if (c.type === 'lcd1602' || c.type === 'oled') {
      if (onBoard(c)) {
        inc.add('Wire.h');
        if (c.type === 'lcd1602') {
          inc.add('LiquidCrystal_I2C.h'); glob.push(`LiquidCrystal_I2C ${o}(0x27, 16, 2);`); setup.push(`${o}.init();`, `${o}.backlight();`);
          lcdMemo = uniq(`${o}_lignes`); glob.push(tl('String {0}[2]; // ce que montre chaque ligne : on ne réécrit que ce qui change', lcdMemo));
          if (!helpers.some(h => h.includes('void ecrireLigne'))) helpers.push([tl('// Écrit une ligne du LCD si son texte a changé (l’écran est lent), complétée par des espaces pour effacer l’ancien texte.'),
            'void ecrireLigne(LiquidCrystal_I2C &ecran, String lignes[], int ligne, String texte) {', '  if (texte == lignes[ligne]) return;', '  lignes[ligne] = texte;', '  ecran.setCursor(0, ligne);', '  ecran.print(texte);', '  for (int i = texte.length(); i < 16; i++) ecran.print(\' \');', '}'].join('\n'));
        } else {
          inc.add('Adafruit_GFX.h'); inc.add('Adafruit_SSD1306.h'); glob.push(`Adafruit_SSD1306 ${o}(128, 64, &Wire, -1);`);
          setup.push(tl('if (!{0}.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("{1} introuvable : vérifiez SDA et SCL");', o, c.name), `${o}.setTextColor(SSD1306_WHITE);`);
          // Image : dessinée en mémoire à chaque tour et envoyée 5 fois par seconde (assemble), sauf si le programme
          // la dessine et l'envoie lui-même (frame.own : écran qui affiche les mesures, blocs).
          frame = { o, name: c.name, sent: uniq(`${o}_envoi`), own: false, used: false }; frames.push(frame); // minuterie déclarée si elle sert
        }
        let row = 0;
        // label : texte d'une mesure (screenText) ou expression C++ (nom du composant).
        a = (act, arg, x, label) => {
          if (c.type === 'lcd1602') return [`ecrireLigne(${o}, ${a.memo}, ${a.row}, ${act === 'text' ? cstr(arg) : label && label.str ? label.str : label});`];
          if (act === 'text') return [`${o}.println(${flash(arg)});`];
          if (label && label.parts) return label.parts.map(([k, v, d], i) => { const end = i === label.parts.length - 1 ? 'println' : 'print'; return `${o}.${end}(${k === 'lit' ? flash(v) : k === 'bool' ? `${v} ? ${flash(tl('oui'))} : ${flash(tl('non'))}` : d ? `${v}, ${d}` : v});`; });
          return [`${o}.println(${label});`];
        };
        a.nextRow = () => (a.row = row++ % 2);
        a.row = 0; a.memo = lcdMemo; a.frame = frame;
      } else missing(c);
    }
    else if (PART_GEN[c.type] && PART_GEN[c.type].actor) {
      a = PART_GEN[c.type].actor(api, c) || null;
      // Écran d'un composant de rules-parts.js (fn.rows) : lignes numérotées comme les écrans du cœur.
      if (a && a.rows && !a.nextRow) { let row = 0; a.screen = true; a.row = 0; a.nextRow = () => (a.row = row++ % a.rows); }
    }
    if (!a && !actors.has(c.id) && ACTIONS[c.type] && !notes.some(n => n.includes(c.name))) missing(c);
    actors.set(c.id, a);
    return a;
  }
  /**
   * Écran texte des règles (LCD 16×2, LCD 20×4, OLED 128×64) : chaque ligne s'écrit à sa place, complétée d'espaces ou
   * effacée par un rectangle noir, sans String ni image redessinée à chaque tour ; le cœur ne réécrit une ligne que si
   * son contenu change. L'OLED envoie son image au plus 5 fois par seconde, et seulement si elle a changé.
   */
  function screenActor(c, o) {
    const lcd = c.type !== 'oled', rows = c.type === 'lcd2004' ? 4 : lcd ? 2 : 8, cols = c.type === 'lcd2004' ? 20 : lcd ? 16 : 21;
    inc.add('Wire.h');
    let chg = null;
    if (lcd) {
      inc.add('LiquidCrystal_I2C.h'); glob.push(`LiquidCrystal_I2C ${o}(0x27, ${cols}, ${rows});`); setup.push(`${o}.init();`, `${o}.backlight();`);
    } else {
      inc.add('Adafruit_GFX.h'); inc.add('Adafruit_SSD1306.h'); glob.push(`Adafruit_SSD1306 ${o}(128, 64, &Wire, -1);`);
      chg = uniq(`${o}_change`); const sent = uniq(`${o}_envoi`);
      glob.push(tl('bool {0} = false; // l’image en mémoire a changé : à envoyer', chg), `uint32_t ${sent} = 0;`);
      setup.push(tl('if (!{0}.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println({1});', o, flash(tl('{0} introuvable : vérifiez SDA et SCL', c.name))), `${o}.clearDisplay();`, `${o}.setTextColor(SSD1306_WHITE);`, `${o}.display();`);
      tail.push(tl('// {0} : l’image part vers l’écran si elle a changé, 5 fois par seconde au plus (un envoi prend ≈ 25 ms)', c.name),
        `if (${chg} && ${now()} - ${sent} >= 200UL) {`, `  ${sent} = ${now()};`, `  ${chg} = false;`, `  ${o}.display();`, '}');
    }
    const fit = t => String(t ?? '').slice(0, cols);
    const pad = t => fit(t).padEnd(cols, ' ');
    const a = (act, arg, x, label, row) => {
      const r = Math.max(0, Math.min(rows - 1, row | 0));
      if (act === 'clear') return lcd ? [`${o}.clear();`] : [`${o}.clearDisplay();`, `${chg} = true;`];
      const at = lcd ? [`${o}.setCursor(0, ${r});`] : [`${o}.fillRect(0, ${r * 8}, 128, 8, SSD1306_BLACK);`, `${o}.setCursor(0, ${r * 8});`];
      const end = lcd ? [] : [`${chg} = true;`];
      if (act === 'text') return [...at, `${o}.print(${flash(lcd ? pad(arg) : fit(arg))});`, ...end];
      if (!label || typeof label !== 'object') return [...at, `${o}.print(${flash(lcd ? pad(arg ?? '') : fit(arg ?? ''))});`, ...end];
      // Une valeur : nom, nombre (ou oui / non, ou texte), unité, puis des espaces jusqu'au bout de la ligne (LCD).
      const body = [`uint8_t n = ${o}.print(${flash(label.name)});`];
      if (label.kind === 'bool') body.push(`if (${label.v}) n += ${o}.print(${flash(tl('oui'))});`, `else n += ${o}.print(${flash(tl('non'))});`);
      else if (label.kind === 'text') body.push(`n += ${o}.print(${label.v});`);
      else if (label.kind === 'time') body.push(`n += ${o}.print((uint16_t)(${label.v}) / 60);`, `if ((uint16_t)(${label.v}) % 60 < 10) n += ${o}.print(${flash(':0')});`, `else n += ${o}.print(${flash(':')});`, `n += ${o}.print((uint16_t)(${label.v}) % 60);`);
      else body.push(`n += ${o}.print(${label.v}${label.d ? `, ${label.d}` : ''});`);
      if (label.unit) body.push(`n += ${o}.print(${flash(label.unit)});`);
      body.push(lcd ? `while (n++ < ${cols}) ${o}.write(' ');` : '(void)n;');
      return [...at, '{', ...body.map(l => '  ' + l), '}', ...end];
    };
    a.rows = rows; a.screen = true; a.lcd = lcd;
    let row = 0; a.nextRow = () => (a.row = row++ % rows); a.row = 0;
    return a;
  }

  /**
   * Lecture d'une mesure sous forme d'expression, à écrire là où on l'utilise (blocs) : rien n'est lu
   * d'avance dans loop(). Mêmes bibliothèques et réglages que readSignal (à ne pas mélanger pour un même capteur).
   */
  function sensorExpr(c, key) {
    if (!onBoard(c)) return missing(c);
    const sig = signalOf(c.type, key, prof); if (!sig) return null;
    const o = objName(c), P = k => pinConst(c, k), first = !used.has(c.id);
    const fn = (id, name, lines) => { if (!declared.has(id)) { const n = uniq(name); declared.set(id, n); helpers.push(lines(n).join('\n')); } return declared.get(id); };
    used.add(c.id);
    switch (c.type) {
      case 'dht11': case 'dht22': {
        const p = P('DATA'); if (!p) return missing(c);
        if (first) { inc.add('DHT.h'); glob.push(`DHT ${o}(${p}, ${c.type.toUpperCase()});`); setup.push(`${o}.begin();`); }
        return key === 'temp' ? `${o}.readTemperature()` : `${o}.readHumidity()`;
      }
      case 'ds18b20': {
        const p = P('DQ'); if (!p) return missing(c);
        if (first) {
          inc.add('OneWire.h'); inc.add('DallasTemperature.h');
          glob.push(`OneWire ${o}_bus(${p});`, `DallasTemperature ${o}(&${o}_bus);`);
          setup.push(`${o}.begin();`, tl('{0}.requestTemperatures(); // première mesure (750 ms)', o), tl('{0}.setWaitForConversion(false); // les suivantes ne bloquent pas le programme', o));
        }
        return fn(c.id + '|fn', `${o}_temperature`, n => [tl('// {0} : température en °C, mesurée une fois par seconde sans bloquer le programme.', c.name),
          `float ${n}() {`, '  static float t = 0;', '  static unsigned long lecture = 0;', '  if (lecture == 0 || millis() - lecture >= 1000) {',
          `    t = ${o}.getTempCByIndex(0);`, `    ${o}.requestTemperatures();`, '    lecture = millis();', '  }', '  return t;', '}']) + '()';
      }
      case 'bme280': {
        if (first) {
          inc.add('Wire.h'); inc.add('Adafruit_BME280.h');
          const addr = cx.A && cx.A.net({ comp: c, key: 'SDO' }).gnd.length ? '0x76' : '0x77';
          glob.push(`Adafruit_BME280 ${o};`);
          setup.push(tl('if (!{0}.begin({1})) Serial.println("{2} introuvable : vérifiez SDA, SCL et l’adresse");', o, addr, c.name));
        }
        return key === 'press' ? `${o}.readPressure() / 100.0` : key === 'hum' ? `${o}.readHumidity()` : `${o}.readTemperature()`;
      }
      case 'bh1750': {
        if (first) bh1750Setup(c, o);
        return `${o}.readLightLevel()`;
      }
      case 'hx711': {
        const dt = P('DT'), sck = P('SCK'); if (!dt || !sck) return missing(c);
        if (first) hx711Setup(o, dt, sck);
        return fn(c.id + '|fn', `${o}_masse`, n => [tl('// {0} : masse en grammes, lue dès qu’une mesure est prête (10 par seconde), sans bloquer le programme.', c.name),
          `float ${n}() {`, '  static float m = 0;', `  if (${o}.is_ready()) m = ${o}.get_units(1);`, '  return m;', '}']) + '()';
      }
      case 'bmp280': {
        if (first) {
          inc.add('Wire.h'); inc.add('Adafruit_BMP280.h');
          const addr = cx.A && cx.A.net({ comp: c, key: 'SDO' }).gnd.length ? '0x76' : '0x77';
          glob.push(`Adafruit_BMP280 ${o};`);
          setup.push(tl('if (!{0}.begin({1})) Serial.println("{2} introuvable : vérifiez SDA, SCL et l’adresse");', o, addr, c.name));
        }
        return key === 'press' ? `${o}.readPressure() / 100.0` : `${o}.readTemperature()`;
      }
      case 'hcsr04': {
        const t = P('TRIG'), e = P('ECHO'); if (!t || !e) return missing(c);
        setup.push(`pinMode(${t}, OUTPUT);`, `pinMode(${e}, INPUT);`);
        if (!helpers.some(h => h.includes('float mesurerDistance('))) helpers.push([
          tl('// Distance en cm : une impulsion de 10 µs sur TRIG, puis la durée de l’écho (aller-retour du son).'),
          'float mesurerDistance(int trig, int echo) {',
          '  digitalWrite(trig, LOW);', '  delayMicroseconds(2);', '  digitalWrite(trig, HIGH);', '  delayMicroseconds(10);', '  digitalWrite(trig, LOW);',
          tl('  long duree = pulseIn(echo, HIGH, 30000); // 0 si aucun écho'), '  return duree / 58.0;', '}'].join('\n'));
        return `mesurerDistance(${t}, ${e})`;
      }
      case 'pir': { const p = P('OUT'); if (!p) return missing(c); setup.push(`pinMode(${p}, INPUT);`); return `digitalRead(${p}) == HIGH`; }
      case 'button': { const b = button(c), p = b && P(b.key); if (!p) return missing(c); setup.push(b.high ? tl('pinMode({0}, INPUT); // résistance de rappel : relâché LOW, appuyé HIGH', p) : tl('pinMode({0}, INPUT_PULLUP); // relâché : HIGH, appuyé : LOW', p)); return `digitalRead(${p}) == ${b.high ? 'HIGH' : 'LOW'}`; }
      case 'cylsensor': { const b = button(c), p = b && P(b.key); if (!p) return missing(c); setup.push(tl('pinMode({0}, INPUT_PULLUP); // piston absent : HIGH, piston devant le capteur : LOW', p)); return `digitalRead(${p}) == LOW`; }
      case 'pressostat': { const b = button(c), p = b && P(b.key); if (!p) return missing(c); setup.push(tl('pinMode({0}, INPUT_PULLUP); // sous le seuil : HIGH, pression atteinte : LOW', p)); return `digitalRead(${p}) == LOW`; }
      case 'ldr': case 'mq2': case 'soil': case 'pot': case 'sound': {
        const p = P({ soil: 'AOUT', pot: 'W' }[c.type] || 'AO'); if (!p) return missing(c);
        return c.type === 'sound' ? `abs(analogRead(${p}) - ${Math.round(max / 2)})` : `analogRead(${p})`;
      }
      case 'joystick': {
        if (key === 'sw') { const p = P('SW'); if (!p) return missing(c); setup.push(`pinMode(${p}, INPUT_PULLUP);`); return `digitalRead(${p}) == LOW`; }
        const p = P(key === 'x' ? 'VRx' : 'VRy'); if (!p) return missing(c); return `analogRead(${p})`;
      }
      case 'tilt-sw': case 'hall': case 'flame': case 'rain': case 'water': case 'irobst': case 'line': case 'shock': case 'ttp223': case 'rcwl0516': case 'mq135': {
        const [k, on] = SIMPLE[c.type][key], p = P(k); if (!p) return optPin(c, k) ? null : missing(c); // sortie facultative (AO) non câblée : ignorée
        if (on) { setup.push(`pinMode(${p}, INPUT);`); return `digitalRead(${p}) == ${on}`; }
        return `analogRead(${p})`;
      }
      case 'lm35': { const p = P('VOUT'); if (!p) return missing(c); return `analogRead(${p}) * (${prof.vref.toFixed(1)} / ${max}.0) * 100.0`; }
      case 'mpu6050': {
        if (first) {
          inc.add('Wire.h'); inc.add('Adafruit_MPU6050.h'); inc.add('Adafruit_Sensor.h');
          glob.push(`Adafruit_MPU6050 ${o};`);
          setup.push(tl('if (!{0}.begin()) Serial.println("{1} introuvable : vérifiez SDA et SCL");', o, c.name));
        }
        const s = isEn ? 'sensor' : 'capteur';
        return fn('fn|mpu', isEn ? 'tilt' : 'inclinaison', n => [tl('// Inclinaison en degrés, calculée à partir de l’accéléromètre.'), `float ${n}(Adafruit_MPU6050 &${s}) {`,
          '  sensors_event_t a, g, t;', `  ${s}.getEvent(&a, &g, &t);`, '  return atan2(a.acceleration.x, a.acceleration.z) * 180 / PI;', '}']) + `(${o})`;
      }
      default: {
        if (sig.bus || sig.pulse) { const e = pkgRead(c, sig, P); return e && sig.kind === 'bool' ? `${e} >= 0.5` : e; }
        if (!sig.pin) return null; // capteur en paquet (.jpart) : sa sortie déclarée
        const p = P(sig.pin); if (!p) return sig.opt ? null : missing(c);
        if (sig.kind === 'bool') { if (first) setup.push(`pinMode(${p}, INPUT);`); return `digitalRead(${p}) == ${sig.low ? 'LOW' : 'HIGH'}`; }
        return `analogRead(${p})`;
      }
    }
  }

  /**
   * Programme complet. header : lignes d'en-tête (à défaut, celles des règles selon starter) ;
   * loopDelay : delay(10) à la fin de loop() ; setupBody : lignes ajoutées à la fin de setup(), sans
   * dédoublonnage ; keep : identifiants laissés tels quels dans la version anglaise.
   */
  function assemble({ header, starter, loopDelay = true, setupBody = [], keep } = {}) {
    const lines = [], T = robust ? 'uint32_t' : 'unsigned long', clock = () => (robust ? now() : 'millis()');
    for (const f of frames) if (!f.own || f.used) glob.push(`${T} ${f.sent} = 0;`); // minuteries d'envoi des écrans qui en ont une
    if (header) lines.push(...header);
    else {
      lines.push(tl('// Programme de {0} ({1}), généré par Jollof Studio {2}.', board.name, prof.label, starter ? tl('à partir du montage') : tl('à partir des règles')));
      lines.push(tl('// Vous pouvez le modifier librement : il ne sera plus régénéré.'));
    }
    const reads = [...timed.values()].filter(t => t.lines.length).flatMap(t => [
      tl('// {0} : une mesure toutes les {1} ms ({2})', t.c.name, t.period, t.why), `if (${t.timer} == 0 || ${clock()} - ${t.timer} >= ${t.period}${robust ? 'UL' : ''}) {`, `  ${t.timer} = ${clock()};`, ...t.lines.map(l => '  ' + l), '}']);
    // Réception (moniteur série, radio, télécommande…) : drapeaux remis à zéro, puis ce qui est arrivé.
    const recv = events.length ? [tl('// Réception : ce qui arrive pendant ce tour (les drapeaux ne restent vrais qu’un tour)'), ...events.filter(e => e.ev).map(e => `${e.ev} = false;`), ...events.flatMap(e => (e.period
      ? [`if (${clock()} - ${e.ev}_t >= ${e.period}UL) {`, `  ${e.ev}_t = ${clock()};`, ...e.lines.map(l => '  ' + l), '}'] : e.lines))] : [];
    events.filter(e => e.period).forEach(e => glob.push(`uint32_t ${e.ev}_t = 0;`));
    const pause = [];
    if (robust && loopDelay && !fast) {
      // Pause jusqu'à la milliseconde suivante : le processeur se repose au lieu de tourner à vide (et consomme moins).
      if (avr) { inc.add('avr/sleep.h'); setup.push('set_sleep_mode(SLEEP_MODE_IDLE);'); pause.push(tl('  sleep_mode(); // veille légère : la prochaine interruption (horloge, 1 ms ; port série) réveille la carte')); }
      else pause.push(tl('  delay(1); // laisse le processeur se reposer une milliseconde'));
    } else if (!robust && loopDelay && !fast) pause.push(tl('  delay(10); // une centaine de tours par seconde : assez pour réagir, sans calcul inutile'));
    if (printed.length) glob.push(`${T} dernierAffichage = 0;`);
    if (robust && printed.length) now(); // l'affichage des mesures (plus bas) compte avec maintenant
    if (nowUsed) glob.unshift(tl('uint32_t maintenant = 0; // heure de ce tour de loop() (ms), la même pour tout le tour'));
    if (inc.size) lines.push('', ...[...inc].map(i => `#include <${i}>`));
    if (glob.length) lines.push('', ...glob);
    if (notes.length) lines.push('', ...notes);
    if (helpers.length) lines.push('', ...helpers.join('\n\n').split('\n'));
    const seen = new Set(), setupLines = setup.filter(l => l.startsWith('//') || /^[{}]$|^ {2}/.test(l) || (!seen.has(l) && seen.add(l)));
    lines.push('', 'void setup() {', `  Serial.begin(${baud});`, ...setupLines.map(l => '  ' + l), ...setupBody.map(l => (l ? '  ' + l : l)), '}');
    lines.push('', 'void loop() {');
    if (nowUsed) lines.push('  maintenant = millis();');
    for (const f of frames.filter(f => !f.own)) {
      pre.push(`${f.o}.clearDisplay();`, `${f.o}.setTextSize(1);`, `${f.o}.setCursor(0, 0);`);
      tail.push(tl('// {0} : l’image part vers l’écran 5 fois par seconde (chaque envoi prend environ 25 ms)', f.name), `if (millis() - ${f.sent} >= 200) {`, `  ${f.sent} = millis();`, `  ${f.o}.display();`, '}');
    }
    if (recv.length) lines.push(...recv.map(l => '  ' + l));
    if (pre.length || reads.length) lines.push(tl('  // Mesures'), ...[...reads, ...pre].map(l => '  ' + l));
    lines.push(...body.map(l => (l ? '  ' + l : '')));
    if (tail.length) lines.push('', ...tail.map(l => '  ' + l));
    if (printed.length) {
      lines.push('', tl('  // Mesures sur le moniteur série, une fois par seconde'), `  if (${clock()} - dernierAffichage >= 1000${robust ? 'UL' : ''}) {`, `    dernierAffichage = ${clock()};`);
      printed.forEach(([lab, v, unit, bool], i) => {
        const last = i === printed.length - 1, after = (unit ? ' ' + unit : '') + (last ? '' : ' | ');
        lines.push(`    Serial.print(${cstr(lab.replace(/ \(.*\)$/, '') + COLON)});`);
        if (bool && robust) lines.push(`    if (${v}) Serial.print(${cstr(tl('oui'))});`, `    else Serial.print(${cstr(tl('non'))});`);
        else lines.push(`    Serial.print(${bool ? `${v} ? ${cstr(tl('oui'))} : ${cstr(tl('non'))}` : v});`);
        lines.push(`    Serial.${last ? 'println' : 'print'}(${cstr(after)});`);
      });
      lines.push('  }');
    }
    lines.push(...pause, '}', '');
    let code = lines.join('\n').replace(/Serial\.println\(""\);/g, 'Serial.println();');
    // Cartes AVR : un texte fixe imprimé reste en mémoire flash (F), sans prendre de RAM.
    if (avr) code = code.replace(/\.(print|println)\(("(?:[^"\\\n]|\\.)*")\)/g, '.$1(F($2))');
    return isEn ? englishNames(code, keep) : code;
  }
  Object.assign(api, {
    board, cx, prof, kind, avr, baud, max, robust, byId, inc, glob, setup, pre, body, tail, helpers, notes, printed, declared, used, names, actors, events,
    pinOf, onBoard, uniq, pinConst, objName, missing, readSignal, eventOf, sensorExpr, actor, assemble, now, first, flash, cstr, i2cAddr, failVar,
    fast: () => { fast = true; }
  });
  return api;
}

export function boardRules(board, cx) {
  const byId = id => cx.comps.find(c => c.id === id);
  const drvBoard = d => driveBoard(d, cx.A, cx.inspect);
  const boardOfComp = c => (isMotor(c) ? drvBoard(c) : cx.inspect(c).board);
  const mine = cx.comps.filter(c => (isMotor(c) ? drvBoard(c) === board || (!drvBoard(c) && boardsOf(cx) === 1) : cx.inspect(c).board === board));
  // Anciennes règles (sans « kind », ou au format d'avant) : remises au format actuel, sans toucher au projet.
  const single = boardsOf(cx) === 1, all = (cx.rules || []).filter(Boolean).map(r => (r.kind ? r : migrate(JSON.parse(JSON.stringify(r)))));
  /** Carte d'une règle ou d'une séquence : celle de ses effecteurs, sinon de ses mesures, sinon la seule carte. */
  const mineItem = r => {
    if (r.board) return r.board === board.id;
    const acts = actsOf(r).map(a => byId(a.comp)).filter(Boolean);
    if (acts.some(d => boardOfComp(d) === board)) return true;
    if (acts.some(d => boardOfComp(d))) return false; // règle d'une autre carte
    const sens = []; walkRule(r, it => compRefs(it).forEach(id => { const s = byId(id); if (s && !isActuator(s)) sens.push(s); }));
    const sb = sens.map(s => cx.inspect(s).board).find(Boolean);
    return sb ? sb === board : single;
  };
  const picked = all.filter(r => (r.kind === 'rule' || r.kind === 'seq') && mineItem(r));
  // Séquences commandées par une règle de la carte, variables utilisées par ses règles et séquences.
  const refs = new Set();
  const scan = r => walkRule(r, it => {
    if (it.kind === 'goto' && it.seq) refs.add(it.seq);
    if (it.kind === 'set' && it.var) refs.add(it.var);
    for (const t of it.kind === 'rule' ? termsOf(it) : it.kind === 'go' && it.when ? [it.when] : []) for (const s of [t.src, t.vs]) if (s) { if (s.var) refs.add(s.var); if (s.seq) refs.add(s.seq); }
    for (const s of [it.what, it.src]) if (s && s.var) refs.add(s.var);
  });
  picked.forEach(scan);
  for (const r of all) if (r.kind === 'seq' && refs.has(r.id) && !picked.includes(r)) { picked.push(r); scan(r); }
  const vars = all.filter(r => r.kind === 'var' && (r.board ? r.board === board.id : refs.has(r.id) || single));
  const rules = all.filter(r => picked.includes(r) || vars.includes(r));
  return { rules, mine, boardOfComp };
}

/** (a && b) → a && b, si les parenthèses entourent toute l'expression. */
function unwrap(e) {
  if (!e || e[0] !== '(' || e[e.length - 1] !== ')') return e;
  let depth = 0;
  for (let i = 0; i < e.length; i++) { if (e[i] === '(') depth++; else if (e[i] === ')' && --depth === 0 && i < e.length - 1) return e; }
  return e.slice(1, -1);
}
/** Actions qui ne se font qu'une fois quand leur branche devient active (compter, écrire, changer d'étape). */
const onceAct = (it, byId) => { if (it.kind !== 'act') return false; if (it.comp === SERIAL) return it.act !== 'plot'; if (it.comp === NET) return it.act === 'publish' && !it.what; const d = byId(it.comp), A = d && ACTIONS[d.type] && ACTIONS[d.type][it.act]; return !!(A && A.once); };
const isOnce = (it, byId) => (it.kind === 'set' && it.op !== '=') || it.kind === 'goto' || onceAct(it, byId);
/** Condition « instantanée » (vraie un seul tour) : front, minuterie, démarrage, événement reçu. */
const instant = (t, byId, prof) => !!(t.edge || (t.src && (t.src.every || t.src.start)) || ((s => s && s.event)(srcSignal(t.src, byId, prof))));

/**
 * Programme Arduino de la carte `board` : ses règles, variables et séquences, ou à défaut un programme de départ
 * qui lit chaque capteur relié et l'affiche sur le moniteur série et les écrans.
 * cx : { comps, A (analyse), inspect(comp) → ins, rules, states (états par défaut) }.
 * Le code est robuste : aucune allocation dynamique (pas de String), textes fixes en flash (F, PSTR) sur AVR, types de
 * taille fixe, rien de bloquant (millis(), dépassement de 49 jours compris), mesures ratées écartées, sorties coûteuses
 * réécrites seulement quand l'ordre change, réglages bornés à la génération.
 */
export function generate(board, cx) {
  const g = createGenContext(board, cx, { robust: true });
  const { prof, setup, body, glob, helpers, tail, printed, uniq, objName, actor, readSignal, now, avr } = g;
  const { rules: items, mine, boardOfComp } = boardRules(board, cx);
  const decls = new Map(); (cx.rules || []).forEach(r => { if (r.kind === 'var' || r.kind === 'seq') decls.set(r.id, r); });
  const byId = id => (id == null ? null : g.byId(id) || decls.get(id) || null);
  const rules = items.filter(r => r.kind === 'rule'), seqs = items.filter(r => r.kind === 'seq'), vars = items.filter(r => r.kind === 'var');
  const nums = numberRules(items), indent = ls => ls.map(l => (l ? '  ' + l : l));
  const ruledActs = new Set(); [...rules, ...seqs].forEach(r => actsOf(r).forEach(a => ruledActs.add(a.comp)));
  const seqActs = new Set(); seqs.forEach(r => actsOf(r).forEach(a => seqActs.add(a.comp)));
  const states = cx.states || {};
  const condPre = [], chains = [], branchFlags = [], entryResets = [];
  let nTerm = 0, nChain = 0, nBranch = 0;
  const lit = (v, float) => { const n = +v || 0; return Number.isInteger(n) ? (float && Math.abs(n) > 32767 ? `${n}.0f` : String(n)) : `${n}f`; };
  const pstr = s => (avr ? `PSTR(${cstr(s)})` : cstr(s));
  const P_ = name => (avr ? `${name}_P` : name);

  /* --- Variables --- */
  const vName = new Map();
  for (const d of vars) vName.set(d.id, uniq(ident(d.name)));
  const persist = vars.filter(d => d.persist);
  const VT = { int: 'int32_t', dec: 'float', bool: 'bool' };
  if (vars.length) {
    glob.push(tl('// Variables des règles'));
    for (const d of vars) {
      const n = vName.get(d.id);
      if (d.type === 'text') glob.push(tl('char {0}[{1}] = {2}; // texte de {3} caractères au plus', n, d.len + 1, cstr(String(d.init || '').slice(0, d.len)), d.len));
      else glob.push(`${VT[d.type]} ${n} = ${d.type === 'bool' ? (d.init ? 'true' : 'false') : lit(d.init, d.type === 'dec')};${d.persist ? tl(' // gardée hors tension (EEPROM)') : ''}`);
    }
  }
  if (persist.length) {
    // Mémoire non volatile : une signature (qui change avec la liste des variables), puis les valeurs, écrites au plus
    // toutes les 5 s et seulement si une variable a changé (une case d'EEPROM supporte environ 100 000 écritures).
    g.inc.add('EEPROM.h');
    const layout = persist.map(d => `${d.name}:${d.type}:${d.len || 0}`).join(','), sigByte = [...layout].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) & 255, 0x4a);
    let addr = 1; const at = new Map(); for (const d of persist) { at.set(d.id, addr); addr += d.type === 'text' ? d.len + 1 : d.type === 'bool' ? 1 : 4; }
    glob.push(tl('constexpr uint8_t SIGNATURE = {0}; // marque l’EEPROM déjà écrite par ce programme', `0x${sigByte.toString(16).toUpperCase().padStart(2, '0')}`),
      tl('bool sauver = false; // une variable gardée hors tension a changé'), 'uint32_t sauvegarde = 0;');
    if (!avr) setup.push(tl('EEPROM.begin({0}); // mémoire réservée en flash', addr));
    setup.push(tl('if (EEPROM.read(0) == SIGNATURE) { // valeurs gardées du dernier démarrage'), ...persist.flatMap(d => {
      const n = vName.get(d.id);
      return [`  EEPROM.get(${at.get(d.id)}, ${n});`, ...(d.type === 'dec' ? [`  if (isnan(${n})) ${n} = ${lit(d.init, true)};`] : d.type === 'text' ? [`  ${n}[${d.len}] = '\\0';`] : [])];
    }), tl('} else {'), '  sauver = true;', '}');
    tail.push(tl('// Variables gardées hors tension : écrites dans l’EEPROM au plus toutes les 5 s'), `if (sauver && ${now()} - sauvegarde >= 5000UL) {`, '  sauver = false;', `  sauvegarde = ${now()};`,
      '  EEPROM.put(0, SIGNATURE);', ...persist.map(d => `  EEPROM.put(${at.get(d.id)}, ${vName.get(d.id)});`), ...(avr ? [] : ['  EEPROM.commit();']), '}');
  }

  /* --- Séquences --- */
  const seqInfo = new Map();
  for (const q of seqs) {
    const n = uniq(ident(q.name).toLowerCase()), E = uniq(`Etape_${ident(q.name)}`), up = ident(q.name).toUpperCase();
    const stop = uniq(`${up}_ARRET`), st = new Map(q.steps.map(s => [s.id, uniq(`${up}_${ident(s.name).toUpperCase()}`)]));
    const fn = uniq(`${n}_aller`);
    seqInfo.set(q.id, { n, E, stop, st, fn });
    const init = q.start === 'stopped' || !q.steps.length ? stop : st.get(q.steps[0].id);
    glob.push(tl('// Séquence {0} : une seule étape active à la fois', q.name), `enum ${E} : uint8_t { ${[stop, ...st.values()].join(', ')} };`,
      `${E} ${n} = ${init};`, tl('uint32_t {0}_debut = 0; // instant d’entrée dans l’étape', n), tl('bool {0}_entree = true; // actions d’entrée à faire', n));
    helpers.push([tl('// {0} : passe à l’étape e (ses actions d’entrée se font au tour suivant).', q.name), `void ${fn}(${E} e) {`, `  ${n} = e;`, `  ${n}_debut = ${now()};`, `  ${n}_entree = true;`, '}'].join('\n'));
  }
  const stepExpr = src => { const i = seqInfo.get(src.seq); return i && i.st.get(src.step) ? `(${i.n} == ${i.st.get(src.step)})` : null; };

  /* --- Sources : mesure, variable, ligne reçue --- */
  /** Valeur d'une source : { v (expression), sig, ev (drapeau d'événement), label } ou null. */
  function source(src) {
    if (!src) return null;
    if (src.var) {
      const d = byId(src.var); if (!d || !vName.has(d.id)) return null;
      const sig = varSignal(d);
      return { v: vName.get(d.id), sig, label: { name: `${d.name}: `, unit: d.unit || '', kind: sig.kind, d: d.type === 'dec' ? 2 : 0 } };
    }
    if (src.comp === SERIAL) { const v = readSignal(SERIAL, 'line'); return v && { v, sig: SERIAL_SIG.line, ev: g.eventOf(SERIAL, 'line'), label: { name: tl('Recu: '), unit: '', kind: 'text' } }; }
    if (src.comp === NET) return netSource(g, src);
    const s = byId(src.comp); if (!s || !SIGNALS[s.type]) return null;
    const sig = signalOf(s.type, src.sig, prof); if (!sig) return null;
    const v = readSignal(s, src.sig); if (!v) return null;
    const [name, unit] = screenLabel(s, sig);
    return { v, sig, s, key: src.sig, ev: sig.event ? g.eventOf(s, src.sig) : null, label: { name, unit: sig.kind === 'time' ? '' : unit, kind: sig.kind, d: sig.type === 'float' ? 1 : 0 } };
  }

  /* --- Conditions --- */
  /** Expression C++ d'une condition ; ses mémoires (front, durée, hystérésis, minuterie) sont mises à jour à chaque tour. */
  function termExpr(t) {
    const src = t.src; ++nTerm;
    if (!src) return 'true';
    let e;
    if (src.every) {
      const v = uniq(`minuterie${nTerm}`), ms = Math.max(1, Math.round(src.every));
      glob.push(tl('uint32_t {0} = 0; // toutes les {1}', v, fmtMs(ms)));
      condPre.push(tl('// Toutes les {0}', fmtMs(ms)), `const bool ${v}_top = ${now()} - ${v} >= ${ms}UL;`, `if (${v}_top) ${v} = ${now()};`);
      e = `${v}_top`;
    } else if (src.start) e = 'premierTour';
    else if (src.seq) e = stepExpr(src);
    else {
      const x = source(src); if (!x) return null;
      const sig = x.sig;
      if (sig.kind === 'bool') e = t.v ? x.v : `!${x.v}`;
      else if (sig.kind === 'text') {
        const other = t.vs && source(t.vs);
        const tv = x.norm && t.op !== 'has' ? x.norm(t.v) : String(t.v ?? ''); // chemin d'une page : « on » → « /on »
        const cmp = other ? `strcmp(${x.v}, ${other.v})` : `${P_('strcmp')}(${x.v}, ${pstr(tv)})`;
        e = t.op === 'any' ? 'true' : t.op === 'has' ? (other ? `strstr(${x.v}, ${other.v}) != nullptr` : `${P_('strstr')}(${x.v}, ${pstr(tv)}) != nullptr`) : `${cmp} ${t.op === '!=' ? '!=' : '=='} 0`;
      } else {
        const op = ['>', '<', '>=', '<=', '==', '!='].includes(t.op) ? t.op : '>';
        if (sig.event && t.op === 'any') e = 'true';
        else {
          const other = t.vs && source(t.vs), rhs = other ? other.v : lit(t.v, sig.type === 'float');
          if (t.hyst && /[<>]/.test(op) && !other) {
            // Hystérésis : vraie au-delà du seuil, ne redevient fausse qu'après être repassée de l'autre côté de la marge.
            const h = uniq(`hysteresis${nTerm}`), back = op[0] === '>' ? `${x.v} < ${lit(+t.v - t.hyst, sig.type === 'float')}` : `${x.v} > ${lit(+t.v + t.hyst, sig.type === 'float')}`;
            glob.push(`bool ${h} = false;`);
            condPre.push(tl('// {0} (hystérésis)', termText(t, byId, prof)), `if (${x.v} ${op} ${rhs}) ${h} = true;`, `else if (${back}) ${h} = false;`);
            e = h;
          } else e = `${x.v} ${op} ${rhs}`;
        }
      }
      if (x.ev) e = e === 'true' ? x.ev : `(${x.ev} && ${e})`;
    }
    if (!e) return null;
    if (t.hold || (t.edge && !src.every && !src.start && !/_recu\b/.test(e))) condPre.push(tl('// {0}', termText(t, byId, prof)));
    if (t.hold) {
      // Durée : l'instant où la condition était encore fausse ; vraie quand elle l'est restée assez longtemps.
      const d = uniq(`depuis${nTerm}`); glob.push(tl('uint32_t {0} = 0; // dernier instant où la condition était fausse', d));
      condPre.push(`if (!(${e})) ${d} = ${now()};`, `const bool ${d}_ok = ${now()} - ${d} >= ${Math.round(t.hold)}UL;`);
      e = `${d}_ok`;
    }
    if (t.edge && !src.every && !src.start && !/_recu\b/.test(e)) {
      // Front : vraie au seul tour où la condition le devient.
      const f = uniq(`avant${nTerm}`); glob.push(tl('bool {0} = false; // la condition au tour précédent', f));
      condPre.push(`const bool ${f}_maintenant = ${e};`, `const bool ${f}_front = ${f}_maintenant && !${f};`, `${f} = ${f}_maintenant;`);
      e = `${f}_front`;
    }
    return t.not ? `!(${e})` : e;
  }
  /** Condition complète d'une règle (gauche à droite, parenthèses explicites), ou null si une mesure manque. */
  function ruleCond(r) {
    let out = null;
    for (const t of termsOf(r)) {
      const e = termExpr(t); if (e == null) return null;
      out = out == null ? e : `(${out} ${t.link === 'or' ? '||' : '&&'} ${e})`;
    }
    return unwrap(out);
  }

  /* --- Effecteurs --- */
  const blinkers = new Set(), flags = new Map(), guards = new Map(), screens = new Map();
  walkAll(items, it => { if (it.kind === 'act' && TIMED.has(it.act)) blinkers.add(it.comp); });
  Object.entries(states).forEach(([id, st]) => { if (st && TIMED.has(st.act)) blinkers.add(id); });
  const blinkVar = new Map();
  function blinkOf(d) {
    if (blinkVar.has(d.id)) return blinkVar.get(d.id);
    const a = actor(d); if (!a) return null;
    const o = objName(d), b = { per: uniq(`${o}_periode`), t: uniq(`${o}_bascule`), lit: uniq(`${o}_allume`) };
    glob.push(tl('uint16_t {0} = 0; // clignotement : demi-période en ms (0 : ne clignote pas)', b.per), `uint32_t ${b.t} = 0;`, `bool ${b.lit} = false;`);
    const on = a('on', null, null, null) || [], off = a(ACTIONS[d.type].off ? 'off' : 'stop', null, null, null) || [];
    tail.push(tl('// {0} : clignote sans bloquer le programme', d.name), `if (${b.per} != 0 && ${now()} - ${b.t} >= ${b.per}) {`, `  ${b.t} = ${now()};`, `  ${b.lit} = !${b.lit};`,
      `  if (${b.lit}) {`, ...on.map(l => '    ' + l), '  } else {', ...off.map(l => '    ' + l), '  }', '}');
    blinkVar.set(d.id, b); return b;
  }
  /** Ordre d'un effecteur : numéro d'une commande fixe (négatif), pour ne réécrire que ce qui change. */
  const codes = new Map();
  const cmdCode = (d, key) => { if (!codes.has(d.id)) codes.set(d.id, new Map()); const m = codes.get(d.id); if (!m.has(key)) m.set(key, -2 - m.size); return m.get(key); };
  const guardOf = d => { if (!guards.has(d.id)) { const n = uniq(`${objName(d)}_ordre`); glob.push(tl('int32_t {0} = -1; // dernier ordre envoyé à {1} (réécrit seulement s’il change)', n, d.name)); guards.set(d.id, n); } return guards.get(d.id); };
  const costly = (a, lines) => a.guard || lines.some(l => /analogWrite\(|tone\(|noTone\(|\.write\(|ledcWrite\(|\.show\(\)/.test(l));
  /** Réglage borné à ce que l'effecteur accepte (vérifié à la génération). */
  function clampArg(A, arg) {
    if (!A || !A.arg) return arg;
    if (A.arg.kind === 'num') { const v = Number.isFinite(+arg) ? +arg : A.arg.def; return Math.max(A.arg.min ?? -Infinity, Math.min(A.arg.max ?? Infinity, v)); }
    if (A.arg.kind === 'color') return /^#[0-9a-f]{6}$/i.test(arg || '') ? arg : A.arg.def;
    if (A.arg.kind === 'text') return String(arg ?? A.arg.def ?? '').replace(/[\r\n]/g, ' ');
    return arg;
  }
  function screenAct(d, a, it, ctx) {
    const o = objName(d);
    if (!screens.has(d.id)) {
      const s = { quoi: uniq(`${o}_quoi`), val: uniq(`${o}_valeur`), vide: uniq(`${o}_vide`), codes: new Map() };
      glob.push(`uint8_t ${s.quoi}[${a.rows}] = {0};${tl(' // contenu de chaque ligne (0 : rien), pour ne réécrire que ce qui change')}`,
        `int32_t ${s.val}[${a.rows}];`, `bool ${s.vide} = true;`);
      screens.set(d.id, s);
    }
    const s = screens.get(d.id), row = it.line ? Math.max(1, Math.min(a.rows, it.line | 0)) - 1 : (a.nextRow(), a.row);
    if (it.act === 'clear') return [`if (!${s.vide}) {`, ...indent(a('clear')), `  memset(${s.quoi}, 0, sizeof(${s.quoi}));`, `  ${s.vide} = true;`, '}'];
    const code = key => { if (!s.codes.has(key)) s.codes.set(key, Math.min(255, s.codes.size + 1)); return s.codes.get(key); };
    let x = null;
    if (it.act === 'value') x = it.what ? source(it.what) : ctx.src ? ctx.src : null;
    if (it.act === 'text' || !x) {
      const text = it.act === 'text' ? clampArg(ACTIONS[d.type].text, it.arg) : d.name, k = code('t' + text);
      return [`if (${s.quoi}[${row}] != ${k}) {`, `  ${s.quoi}[${row}] = ${k};`, `  ${s.vide} = false;`, ...indent(a('text', text, null, null, row)), '}'];
    }
    const k = code('v' + x.v), lab = x.label, val = lab.kind === 'bool' ? `(${x.v} ? 1 : 0)` : lab.kind === 'text' ? `(int32_t)empreinte(${x.v})` : lab.d ? `(int32_t)lroundf(${x.v} * ${10 ** lab.d})` : `(int32_t)${x.v}`;
    if (lab.kind === 'text' && !helpers.some(h => h.includes('empreinte('))) helpers.push([tl('// Empreinte d’un texte (FNV-1a) : savoir s’il a changé sans en garder une copie.'), 'uint32_t empreinte(const char *s) {', '  uint32_t h = 2166136261UL;', '  for (uint8_t i = 0; s[i] != \'\\0\'; i++) h = (h ^ (uint8_t)s[i]) * 16777619UL;', '  return h;', '}'].join('\n'));
    return ['{', `  const int32_t k = ${val};`, `  if (${s.quoi}[${row}] != ${k} || ${s.val}[${row}] != k) {`, `    ${s.quoi}[${row}] = ${k};`, `    ${s.val}[${row}] = k;`, `    ${s.vide} = false;`,
      ...a('value', null, null, { ...lab, v: x.v }, row).map(l => '    ' + l), '  }', '}'];
  }
  function serialAct(it, ctx) {
    if (it.act === 'print') return [`Serial.println(${cstr(clampArg(SERIAL_ACTS.print, it.arg))});`];
    const x = it.what ? source(it.what) : ctx.src; if (!x) return [tl('// (choisissez la valeur à écrire)')];
    const name = it.what ? srcName(it.what, byId, prof) : x.s ? `${x.s.name} ${x.sig.label}`.replace(/ \(.*\)$/, '') : '';
    const val = x.sig.kind === 'bool' ? null : x.sig.type === 'float' ? `${x.v}, 2` : x.v;
    if (x.sig.kind === 'time' && it.act !== 'plot') return [`Serial.print(${cstr(name + COLON)});`, `Serial.print((uint16_t)(${x.v}) / 60);`, `if ((uint16_t)(${x.v}) % 60 < 10) Serial.print(${cstr(':0')});`, `else Serial.print(${cstr(':')});`, `Serial.println((uint16_t)(${x.v}) % 60);`];
    const out = it.act === 'plot' ? [`Serial.print(${cstr(ident(name.replace(/·/g, '')).replace(/_+/g, '_') + ':')});`] : [`Serial.print(${cstr(name + COLON)});`];
    if (val == null) out.push(`Serial.println(${x.v} ? 1 : 0);`); else out.push(`Serial.println(${val});`);
    if (it.act === 'plot' && ctx.level) {
      // Courbe dans une règle permanente : 20 points par seconde suffisent au traceur.
      const t = uniq(`trace${++nBranch}`); glob.push(`uint32_t ${t} = 0;`);
      return [`if (${now()} - ${t} >= 50UL) {`, `  ${t} = ${now()};`, ...indent(out), '}'];
    }
    return out;
  }
  function emitAct(it, ctx) {
    if (it.comp === SERIAL) return serialAct(it, ctx);
    if (it.comp === NET) {
      // Réseau : publier sur un sujet MQTT, une ligne de la page web (valeur choisie, ou texte fixe).
      const x = it.what ? source(it.what) : null;
      if (it.what && !x) return [tl('// (valeur non câblée : action du réseau ignorée)')];
      return netAct(g, it, ctx, x, it.what ? srcName(it.what, byId, prof) : null);
    }
    const d = byId(it.comp);
    if (!d || !ACTIONS[d.type]) return [it.comp ? tl('// (action ignorée : l’effecteur a été retiré du montage)') : tl('// (action incomplète : choisissez un effecteur)')];
    const db = boardOfComp(d);
    if (db && db !== board) return [tl('// ({0} est relié à {1} : action ignorée ici)', d.name, db.name)];
    const a = actor(d);
    if (!a) return [tl('// ({0} n’est pas câblé : action ignorée)', d.name)];
    const A = ACTIONS[d.type][it.act];
    if (!A) return [tl('// ({0} : action inconnue)', d.name)];
    let lines, key, pre = [];
    if (a.screen) lines = screenAct(d, a, it, ctx);
    else if (ctx.follow && A.follow && ctx.src) {
      const o = Array.isArray(it.arg) ? it.arg : A.follow, lim = A.follow, out = [0, 1].map(i => Math.max(Math.min(...lim), Math.min(Math.max(...lim), +o[i] || 0)));
      let [a0, a1] = (ctx.from || [0, 100]).map(n => +n || 0); if (a0 === a1) a1 = a0 + 1; // plage vide : jamais de division par zéro
      const lo = Math.min(a0, a1), hi = Math.max(a0, a1), x = uniq(`${objName(d)}_consigne`), v = ctx.src.v;
      const expr = ctx.src.sig.type === 'float'
        ? `(int16_t)lroundf(${lit(out[0], true)} + (constrain(${v}, ${lit(lo, true)}, ${lit(hi, true)}) - ${lit(a0, true)}) * ${String(+((out[1] - out[0]) / (a1 - a0)).toPrecision(7))}f)`
        : `(int16_t)map(constrain(${v}, ${lo}, ${hi}), ${a0}, ${a1}, ${out[0]}, ${out[1]})`;
      pre = [`const int16_t ${x} = ${expr};`]; lines = a(it.act, it.arg, x, null);
      key = x;
    } else {
      const arg = clampArg(A, it.arg);
      // Action qui envoie ou affiche une valeur choisie (it.what) : la valeur va en 3e argument { v, sig, label }.
      const x = A.what ? (it.what ? source(it.what) : ctx.src || null) : null;
      if (A.what && !x) return [tl('// ({0} : choisissez la valeur)', d.name)];
      lines = a(it.act, arg, x, x ? x.label : null); key = x ? null : cmdCode(d, `${it.act}|${JSON.stringify(arg)}`);
      if (x && x.sig.kind !== 'text' && costly(a, lines)) key = x.sig.type === 'float' ? `(int32_t)lroundf(${x.v} * 100)` : `(int32_t)${x.v}`;
      if (blinkers.has(d.id)) {
        const b = blinkOf(d);
        if (TIMED.has(it.act)) { lines = [tl('{0} = {1}; // change d’état toutes les {1} ms', b.per, Math.max(1, Math.round(arg)))]; key = null; if (guards.has(d.id)) lines.push(`${guards.get(d.id)} = -1;`); }
        else lines = [`${b.per} = 0;`, ...lines];
      }
    }
    if (key != null && !a.screen && costly(a, lines)) {
      const gv = guardOf(d);
      lines = [`if (${gv} != ${key}) {`, `  ${gv} = ${key};`, ...indent(lines), '}'];
    }
    lines = [...pre, ...lines];
    if (flags.has(d.id)) lines.push(`${flags.get(d.id)} = true;`);
    return lines;
  }

  /* --- Variables : affectations --- */
  function emitSet(it, ctx) {
    const d = byId(it.var); if (!d || !vName.has(d.id)) return [tl('// (variable retirée)')];
    const n = vName.get(d.id), x = it.src ? source(it.src) : null;
    if (it.src && !x) return [tl('// (mesure non câblée : {0} inchangée)', d.name)];
    let out;
    if (d.type === 'bool') out = it.op === 'toggle' ? [`${n} = !${n};`] : [`${n} = ${x ? (x.sig.kind === 'bool' ? x.v : `${x.v} != 0`) : it.v ? 'true' : 'false'};`];
    else if (d.type === 'text') {
      if (x && x.sig.kind === 'text') out = [`strlcpy(${n}, ${x.v}, sizeof(${n}));`];
      else if (x) out = ['{', '  char nombre[16];', `  dtostrf(${x.sig.kind === 'bool' ? `${x.v} ? 1 : 0` : x.v}, 0, ${x.sig.type === 'float' ? 1 : 0}, nombre);`, `  strlcpy(${n}, nombre, sizeof(${n}));`, '}'];
      else out = [`${P_('strcpy')}(${n}, ${pstr(String(it.v ?? '').slice(0, d.len))});`];
    } else {
      const k = x ? (d.type === 'int' ? (x.sig.type === 'float' ? `(int32_t)lroundf(${x.v})` : x.sig.kind === 'bool' ? `(${x.v} ? 1 : 0)` : `(int32_t)${x.v}`) : x.v) : lit(it.v, d.type === 'dec');
      const kNum = x ? null : +it.v || 0;
      if (it.op === 'toggle') out = [`${n} = ${d.type === 'dec' ? '0.0f' : '0'};`];
      else if (it.op === '=') out = [`${n} = ${k};`];
      else if (d.type === 'dec') out = [`${n} ${it.op}= ${k};`];
      else {
        // Entier : ajout saturé (jamais de débordement : il s'arrête à la plus grande valeur possible).
        const add = (it.op === '+') === (kNum >= 0), m = lit(Math.abs(kNum));
        out = kNum == null ? [`${n} = (int32_t)constrain((int64_t)${n} ${it.op} ${k}, (int64_t)INT32_MIN, (int64_t)INT32_MAX);`]
          : add ? [`if (${n} <= INT32_MAX - ${m}) ${n} += ${m};`, `else ${n} = INT32_MAX;`] : [`if (${n} >= INT32_MIN + ${m}) ${n} -= ${m};`, `else ${n} = INT32_MIN;`];
      }
    }
    if (d.persist) out = d.type === 'text' ? [...out, 'sauver = true;'] : [`{`, `  const ${VT[d.type]} avant = ${n};`, ...indent(out), `  if (${n} != avant) sauver = true;`, '}'];
    void ctx;
    return out;
  }
  function emitGoto(it) {
    const i = seqInfo.get(it.seq); if (!i) return [tl('// (séquence retirée)')];
    const to = it.step ? i.st.get(it.step) : i.stop; if (!to) return [tl('// (étape retirée)')];
    return [`${i.fn}(${to});`];
  }

  /* --- Éléments, suites temporisées, règles --- */
  function emitItem(it, ctx) {
    if (it.kind === 'rule') return [tl('// Règle {0} : {1}', nums.get(it.id), ruleText(it, byId, prof)), ...emitRule(it, ctx)];
    if (it.kind === 'set') return emitSet(it, ctx);
    if (it.kind === 'goto') return emitGoto(it);
    if (it.kind === 'act') return emitAct(it, ctx);
    return [];
  }
  /**
   * Liste d'éléments d'une branche. Actions ponctuelles (compter, écrire, changer d'étape) sous une condition qui dure :
   * faites une seule fois, quand la branche devient active. « attend » : la suite devient une petite machine à états
   * (millis()), lancée si elle est à l'arrêt, qui avance à chaque tour sans jamais bloquer loop().
   */
  function emitList(list, ctx) {
    if (list.some(it => it.kind === 'wait')) return emitChain(list, ctx);
    if (ctx.level && list.some(it => isOnce(it, byId))) {
      const f = uniq(`branche${++nBranch}`);
      glob.push(tl('bool {0} = false; // branche active au tour précédent', f)); branchFlags.push(f);
      const once = list.filter(it => isOnce(it, byId)), rest = list.filter(it => !isOnce(it, byId));
      return [...rest.flatMap(it => emitItem(it, ctx)), tl('if (!{0}) { // une seule fois, quand la branche devient active', f), ...indent(once.flatMap(it => emitItem(it, { ...ctx, level: false }))), '}', `${f}_ici = true;`];
    }
    return list.flatMap(it => emitItem(it, ctx));
  }
  function emitChain(list, ctx) {
    const id = uniq(`suite${++nChain}`), segs = [[]], waits = [];
    for (const it of list) { if (it.kind === 'wait') { waits.push(Math.max(1, Math.round(it.ms))); segs.push([]); } else segs[segs.length - 1].push(it); }
    glob.push(tl('uint8_t {0} = 0; // suite d’actions : où elle en est (0 : à l’arrêt)', id), `uint32_t ${id}_t = 0;`);
    const seg = k => emitList(segs[k], { ...ctx, level: false, follow: false });
    const sw = [tl('// Suite {0} : chaque attente se compte avec millis(), loop() continue de tourner', nChain), `switch (${id}) {`];
    waits.forEach((ms, k) => {
      const last = k === waits.length - 1;
      sw.push(`  case ${k + 1}:`, `    if (${now()} - ${id}_t >= ${ms}UL) {`, ...seg(k + 1).map(l => '      ' + l), last ? `      ${id} = 0;` : `      ${id} = ${k + 2};`, ...(last ? [] : [`      ${id}_t = ${now()};`]), '    }', '    break;');
    });
    sw.push('  default:', '    break;', '}');
    chains.push(...sw);
    return [tl('if ({0} == 0) { // la suite démarre si elle ne tourne pas déjà', id), ...indent(seg(0)), `  ${id} = 1;`, `  ${id}_t = ${now()};`, '}'];
  }
  /** Code d'une règle : un if (et ses else / else if), ou ses actions directement. */
  function emitRule(r, ctx) {
    const terms = termsOf(r);
    if (!terms.length) return emitList(r.then, { ...ctx, level: ctx.level !== false });
    if (r.op === 'follow') {
      const x = source(r.src); if (!x) return [tl('// (ignorée : la mesure de cette règle n’est pas câblée)')];
      return emitList(r.then.filter(it => it.kind === 'act'), { ...ctx, src: x, follow: true, from: r.from, level: true });
    }
    const cond = ruleCond(r);
    if (cond == null) return [tl('// (ignorée : une mesure de cette règle n’est pas câblée ou a été retirée)')];
    const first = r.src && !r.src.every && !r.src.start && !r.src.seq ? source(r.src) : null;
    const level = ctx.level !== false && !(r.join === 'or' ? terms.every(t => instant(t, byId, prof)) : terms.some(t => instant(t, byId, prof)));
    const inner = { ...ctx, src: first || ctx.src, follow: false, level };
    const out = [`if (${cond}) {`, ...indent(emitList(r.then, inner))];
    const els = r.else || [];
    if (els.length === 1 && els[0].kind === 'rule' && els[0].src && els[0].op !== 'follow') {
      const chain = emitRule(els[0], { ...ctx });
      if (chain[0].startsWith('if (')) { out.push(tl('} else {0} // Règle {1}', chain[0], nums.get(els[0].id)), ...chain.slice(1)); return out; }
    }
    if (els.length) out.push('} else {', ...indent(emitList(els, { ...inner, level: ctx.level !== false })));
    out.push('}');
    return out;
  }

  /* --- États par défaut des effecteurs : au démarrage, et si demandé quand aucune règle ne les commande --- */
  const fallback = [], defaults = [];
  mine.filter(isActuator).forEach(c => {
    const st = states[c.id];
    if (!st || !st.act || !defaultActs(c.type).some(([k]) => k === st.act)) return;
    if (!actor(c)) return;
    defaults.push([c, st]);
    if (st.mode === 'always' && ruledActs.has(c.id) && !seqActs.has(c.id)) flags.set(c.id, uniq(`${objName(c)}_commande`));
  });
  const startLines = [];
  for (const [c, st] of defaults) {
    const it = { kind: 'act', comp: c.id, act: st.act, arg: st.arg, line: 1 };
    const keep = flags.get(c.id); flags.delete(c.id);
    const lines = emitAct(it, { level: false });
    if (keep) flags.set(c.id, keep);
    startLines.push(tl('// {0} : état par défaut', c.name), ...lines);
    if (st.mode !== 'always') continue;
    if (flags.has(c.id)) fallback.push('', tl('// {0} revient à son état par défaut quand aucune règle ne l’a commandé', c.name), `if (!${flags.get(c.id)}) {`, ...indent(lines), '}');
  }

  /* --- Corps de loop() --- */
  const ruleBody = [];
  rules.forEach(r => ruleBody.push('', tl('// Règle {0} : {1}', nums.get(r.id), ruleText(r, byId, prof)), ...emitRule(r, {})));
  const seqBody = [];
  for (const q of seqs) {
    const i = seqInfo.get(q.id);
    seqBody.push('', tl('// Séquence {0}', q.name), ...(q.steps.length ? [] : [tl('// (aucune étape)')]), `switch (${i.n}) {`);
    for (const s of q.steps) {
      const gos = (s.go || []).map(gg => {
        const parts = [];
        if (gg.after) parts.push(`${now()} - ${i.n}_debut >= ${Math.round(gg.after)}UL`);
        if (gg.when) { const e = termExpr(gg.when); parts.push(e == null ? 'false' : e); }
        return [parts.join(' && ') || 'true', gg.to ? i.st.get(gg.to) || i.stop : i.stop, goText(gg, q, byId, prof)];
      });
      seqBody.push(`  case ${i.st.get(s.id)}:`, `    if (${i.n}_entree) {`, `      ${i.n}_entree = false;`, ...emitList(s.do, { level: false }).map(l => '      ' + l), '    }');
      gos.forEach(([cond, to, text], k) => seqBody.push(`    ${k ? 'else if' : 'if'} (${cond}) ${i.fn}(${to}); // ${text}`));
      seqBody.push('    break;');
    }
    seqBody.push('  default:', tl('    break; // séquence arrêtée'), '}');
  }

  // Chaque capteur câblé est lu ; chaque écran sans règle ni état par défaut affiche les mesures.
  const starter = !rules.length && !seqs.length;
  mine.filter(isSensor).forEach(c => Object.keys(SIGNALS[c.type]).forEach(k => { if (k !== 'fault' && !SIGNALS[c.type][k].event) readSignal(c, k); }));
  const screenBody = [];
  mine.filter(c => ACTIONS[c.type] && ACTIONS[c.type].value && ACTIONS[c.type].text && !ruledActs.has(c.id) && !(states[c.id] && states[c.id].act)).forEach(sc => {
    const a = actor(sc); if (!a || !a.screen) return;
    const list = printed.slice(0, a.rows);
    if (!list.length) return;
    const t = uniq(`${objName(sc)}_mesures`); glob.push(`uint32_t ${t} = 0;`);
    screenBody.push('', tl('// {0} affiche les mesures, 4 fois par seconde (seules les lignes qui changent sont réécrites)', sc.name), `if (${now()} - ${t} >= 250UL) {`, `  ${t} = ${now()};`,
      ...list.flatMap(([, v, , bool, src, sig], k) => { const [name, unit] = screenLabel(src, sig); return indent(screenAct(sc, a, { act: 'value', line: k + 1 }, { src: { v, sig, label: { name, unit, kind: bool ? 'bool' : sig.kind === 'text' ? 'text' : 'num', d: sig.type === 'float' ? 1 : 0 } } })); }), '}');
  });
  if (condPre.length) body.push(tl('// Conditions qui ont une mémoire (front, durée, hystérésis, minuterie) : mises à jour à chaque tour'), ...condPre);
  if (flags.size) body.push('', tl('// Aucun effecteur n’a encore été commandé dans ce tour de boucle'), ...[...flags.values()].map(f => `bool ${f} = false;`));
  if (branchFlags.length) body.push('', tl('// Branches actives pendant ce tour (pour ne faire qu’une fois les actions ponctuelles)'), ...branchFlags.map(f => `bool ${f}_ici = false;`));
  body.push(...ruleBody, ...seqBody);
  if (chains.length) body.push('', ...chains);
  body.push(...fallback, ...screenBody);
  if (branchFlags.length) body.push('', ...branchFlags.map(f => `${f} = ${f}_ici;`));
  if (body.some(l => l.includes('premierTour')) || condPre.some(l => l.includes('premierTour'))) {
    glob.push(tl('bool premierTour = true; // vrai pendant le premier tour de loop() seulement'));
    body.push('', 'premierTour = false;');
  }
  if (startLines.length) setup.push(...startLines);
  if (starter) {
    const outs = mine.filter(c => isActuator(c) && !(actor(c) || {}).screen);
    const ex = outs.map(c => {
      const a = actor(c); if (!a) return null;
      const first = Object.keys(ACTIONS[c.type])[0];
      return `//   ${(a(first, defArg(c.type, first), '0', null) || []).join(' ')}`;
    }).filter(Boolean);
    body.push('', tl('// Écrivez ici ce que la carte doit faire. Par exemple :'), ...(ex.length ? ex : [tl('//   Serial.println("Bonjour");')]));
    body.push(tl('// Ou ajoutez des règles : sélectionnez un composant puis « Programmer ».'));
  }
  if (seqs.length || chains.length || condPre.length) now();
  // Réseau : lignes de chaque tour, rappel MQTT, page web (liens vers les chemins attendus par les règles).
  const links = []; walkAll(items, it => { for (const t of it.kind === 'rule' ? termsOf(it) : it.kind === 'go' && it.when ? [it.when] : []) if (t.src && t.src.comp === NET && t.src.sig === 'page' && t.op === '==' && !t.vs) links.push(String(t.v ?? '')); });
  netFinish(g, { links });
  return g.assemble({ starter });
}

/**
 * Programme de départ pour écrire son code soi-même : bibliothèques, broches et objets des composants de la carte,
 * setup() qui les prépare, loop() vide. Rien n'est lu ni affiché d'avance.
 */
export function skeleton(board, cx) {
  const g = createGenContext(board, cx), { mine } = boardRules(board, cx);
  mine.forEach(c => { if (isActuator(c)) g.actor(c); if (isSensor(c)) Object.keys(SIGNALS[c.type]).forEach(k => g.sensorExpr(c, k)); });
  g.actors.forEach(a => { if (a && a.frame) a.frame.own = true; }); // écrans : le programme les dessine lui-même
  g.body.push(tl('// Écrivez ici ce que la carte doit faire, encore et encore.'));
  return g.assemble({ header: [tl('// Programme de {0} ({1}) : vos composants sont déclarés, à vous d’écrire la suite.', board.name, g.prof.label)], loopDelay: false });
}

/** Interface en anglais : les noms de variables du code généré passent aussi en anglais. */
const ID_EN = { appuye: 'pressed', bouton: 'button', gaz: 'gas', humidite: 'humidity', inclinaison: 'tilt', lumiere: 'light', mouvement: 'motion', pression: 'pressure', secheresse: 'dryness',
  lecture: 'lastRead', envoi: 'lastSend', lignes: 'lines', consigne: 'setpoint', allume: 'lit', chiffre: 'digit', couleur: 'color', dernierAffichage: 'lastPrint', duree: 'duration', ecran: 'screen', ecrireLigne: 'writeLine',
  ligne: 'line', mesurerDistance: 'measureDistance', sens: 'direction', texte: 'text', valeur: 'value', vitesse: 'speed',
  penche: 'tilted', aimant: 'magnet', eclairement: 'illuminance', masse: 'mass', doigt: 'finger', debut: 'start', maintenant: 'now', impulsions: 'pulses', compter: 'count', flamme: 'flame', infrarouge: 'infrared', pluie: 'rain', mouille: 'wetness', niveau: 'level', surLaLigne: 'onLine', secousse: 'shaken',
  ligneRecue: 'lineReceived', recu: 'received', premierTour: 'firstPass', sauver: 'mustSave', sauvegarde: 'lastSave', suite: 'chain', depuis: 'since', avant: 'before', front: 'edge',
  branche: 'branch', ici: 'now', echecs: 'failures', periode: 'period', bascule: 'lastToggle', ordre: 'order', quoi: 'what', vide: 'empty', change: 'changed', brut: 'raw', aller: 'goTo',
  entree: 'entry', empreinte: 'fingerprint', nombre: 'number', enPanne: 'faulty', Etape: 'Step', ARRET: 'STOPPED', mesures: 'readings', trace: 'plot', car: 'ch', hysteresis: 'hysteresis', top: 'tick', ok: 'ok',
  reseauEnLigne: 'networkOnline', reseauVerif: 'networkCheck', reseauMac: 'networkMac', reseauIp: 'networkIp', reseauAdresse: 'networkLease', reseauEssai: 'networkRetry', reseauClient: 'networkClient',
  RESEAU_WIFI: 'WIFI_SSID', RESEAU_CLE: 'WIFI_PASSWORD', MQTT_SERVEUR: 'MQTT_SERVER', mqttEnLigne: 'mqttOnline', mqttAttendre: 'mqttWait', mqttEssai: 'mqttLastTry', mqttRecu: 'mqttReceived',
  mqttCopier: 'mqttCopy', mqttPublier: 'mqttPublish', mqttPublierP: 'mqttPublishP', mqttAbonner: 'mqttSubscribe', sujetVa: 'topicMatches', sujetVaP: 'topicMatchesP', serveurWeb: 'webServer',
  pageLigne: 'pageLine', pageEtape: 'pageStep', pageDebut: 'pageStart', pageChemin: 'pagePath', pageCheminDe: 'pathOf', pageEnvoyer: 'sendPage', pageEcrire: 'pageWrite', pageQuoi: 'pageWhat',
  pageNombre: 'pageNumber', enLigne: 'online', bail: 'lease', sujet: 'topic', contenu: 'payload', taille: 'length', filtre: 'filter', chemin: 'path', fait: 'done', lien: 'link', adresse: 'address' };
export function englishNames(code, keep) {
  return code.replace(/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\/\/[^\n]*|[A-Za-z_][A-Za-z0-9_]*)/g, tok => {
    if (!/^[A-Za-z_]/.test(tok)) return tok; // texte, caractère ou commentaire
    if (keep && keep.has(tok)) return tok; // nom choisi par l'élève (blocs)
    if (ID_EN[tok]) return ID_EN[tok];
    return tok.includes('_') ? tok.split('_').map(p => ID_EN[p] || p).join('_') : tok;
  });
}
const boardsOf = cx => cx.comps.filter(c => boardOf(c)).length;
const SHORT = { temp: tl('Temp'), hum: tl('Hum'), press: tl('Pres'), dist: tl('Dist'), light: tl('Lum'), soil: tl('Sol'), gas: tl('Gaz'), level: tl('Son'), tilt: tl('Incl'), pos: tl('Pos'), x: 'X', y: 'Y' };
/** Texte d'une mesure pour un écran : court et sans accent (les LCD n'en ont pas). */
/** Libellé d'une mesure sur un écran (sans accents, l'écran ne les affiche pas) : [« Temp: », « C »]. */
export function screenLabel(c, sig) {
  const plain = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const key = Object.keys(SIGNALS[c.type]).find(k => SIGNALS[c.type][k].v === sig.v);
  const name = plain(sig.short || SHORT[key] || sig.label);
  return [name + ': ', sig.kind !== 'bool' && sig.unit ? plain(' ' + sig.unit.replace('°C', 'C').replace('°', ' deg')) : ''];
}
/**
 * Texte d'une mesure sur un écran. parts : morceaux imprimés l'un après l'autre (OLED : aucun String à construire) ;
 * str : la ligne entière en String (LCD, qui compare la ligne à celle déjà affichée).
 */
function screenText(c, sig, v) {
  const [name, unit] = screenLabel(c, sig);
  if (sig.kind === 'bool') return { parts: [['lit', name], ['bool', v]], str: `${cstr(name)} + String(${v} ? ${cstr(tl('oui'))} : ${cstr(tl('non'))})` };
  const d = sig.type === 'float' ? 1 : 0;
  return {
    parts: [['lit', name], ['num', v, d], ...(unit ? [['lit', unit]] : [])],
    str: `${cstr(name)} + String(${v}${d ? ', 1' : ''})${unit ? ` + ${cstr(unit)}` : ''}`
  };
}
