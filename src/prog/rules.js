// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Règles de comportement et génération du code Arduino.
// Une règle relie une mesure (capteur, bouton…) à un effecteur (LED, servo, relais…) :
// « Quand BTN1 est appuyé, LED1 s'allume, sinon elle s'éteint ». Les règles ne sont
// jamais exécutées telles quelles : elles produisent un vrai programme Arduino, lisible
// et commenté, que l'élève peut ensuite modifier à la main.
import { BOARDS, boardOf, codePin } from '../sim/boards.js';
import { isMotor, motorPins } from '../sim/parts.js';
import { driveOf, driveBoard } from '../sim/drive.js';
import { FN, CONSTS } from './api.js';
import { tl, quote, DEC, isEn, COLON } from '../i18n/index.js';

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
  pot: { pos: { label: tl('position (valeur lue)'), adc: true, def: 0.5, v: 'position' } },
  joystick: { x: { label: tl('axe X (valeur lue)'), adc: true, def: 0.75, v: 'x' }, y: { label: tl('axe Y (valeur lue)'), adc: true, def: 0.75, v: 'y' }, sw: { label: tl('a son bouton appuyé'), neg: tl('a son bouton relâché'), kind: 'bool', v: 'bouton', short: tl('Bouton du manche') } }
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
  buzzer: { on: { label: 'sonne' }, off: { label: tl('se tait') }, beep: { label: 'bipe', arg: { kind: 'num', def: 300, min: 50, max: 3000, step: 50, unit: 'ms' } } },
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
  vibro: { on: { label: tl('vibre') }, stop: { label: tl('s’arrête') } },
  stepper: { cw: { label: tl('tourne dans le sens horaire') }, ccw: { label: tl('tourne dans le sens antihoraire') }, stop: { label: tl('s’arrête') } },
  '7seg': { digit: { label: tl('affiche le chiffre'), arg: { kind: 'num', def: 5, min: 0, max: 9 } }, off: { label: tl('s’éteint') }, follow: { label: tl('affiche la mesure (0 à 9)'), follow: [0, 9] } },
  ws2812: { color: { label: tl('s’allume en'), arg: { kind: 'color', def: '#3fb27f' } }, off: { label: tl('s’éteint') }, follow: { label: tl('jauge selon la mesure'), follow: [0, 8], arg: { kind: 'color', def: '#3fb27f' } } },
  lcd1602: { text: { label: tl('affiche le texte'), arg: { kind: 'text', def: tl('Alerte !') } }, value: { label: tl('affiche la mesure') } },
  oled: { text: { label: tl('affiche le texte'), arg: { kind: 'text', def: tl('Alerte !') } }, value: { label: tl('affiche la mesure') } }
};
export const OPS = { '>': tl('dépasse'), '<': tl('est sous'), '>=': tl('atteint au moins'), '<=': tl('vaut au plus'), '==': 'vaut', '!=': tl('ne vaut pas'), follow: tl('fait varier') };

const adcMax = prof => 2 ** ((prof && (prof.adcRead || prof.adcBits)) || 10) - 1; // ce que rend analogRead() par défaut
/** Mesure d'un capteur, avec seuil et plage exprimés pour cette carte. */
export function signalOf(type, key, prof) {
  const s = SIGNALS[type] && SIGNALS[type][key];
  if (!s) return null;
  if (!s.adc) return { kind: 'num', type: 'float', ...s };
  const max = adcMax(prof), r = s.range01 || [0, 1];
  return { kind: 'num', type: 'int', unit: '', ...s, def: Math.round(s.def * max), range: [Math.round(r[0] * max), Math.round(r[1] * max)], max };
}
export const isSensor = c => !!SIGNALS[c.type];
export const isActuator = c => !!ACTIONS[c.type];
/* ---------------- Arbre des règles ----------------
 * Une règle : { kind: 'rule', id, src: { comp, sig } | null (toujours), op, v, from: [min, max],
 *               then: [éléments], else: [éléments] }
 * Un élément : une action { kind: 'act', id, comp, act, arg } ou une règle imbriquée.
 * « Sinon » qui ne contient qu'une condition devient un else if dans le code.
 */
export const uid = p => p + Math.random().toString(36).slice(2, 8);
export const actItem = (c, act, arg) => ({ kind: 'act', id: uid('a'), comp: c ? c.id : null, act, arg: arg === undefined && c ? defArg(c.type, act) : arg });
export const defArg = (type, act) => { const a = ACTIONS[type] && ACTIONS[type][act]; return a && a.arg ? a.arg.def : a && a.follow ? [...a.follow] : null; };
/** Actions permises : « follow » (fait varier), « cond » (sous une mesure), « always » (sans mesure, état par défaut). */
export function actsFor(type, mode) {
  return Object.entries(ACTIONS[type] || {}).filter(([k, A]) => (mode === 'follow' ? A.follow || k === 'value' : !A.follow && (k !== 'value' || mode === 'cond')));
}
const offAct = type => (ACTIONS[type].off ? 'off' : ACTIONS[type].stop ? 'stop' : null);
/** Ancien format (une action, une alternative) → arbre. */
export function migrate(r) {
  if (!r || typeof r !== 'object') return null;
  r.kind = 'rule'; r.id = r.id || uid('r');
  if (!Array.isArray(r.from)) r.from = [0, 100];
  if (!Array.isArray(r.then)) {
    r.then = r.dst ? [{ kind: 'act', id: uid('a'), comp: r.dst.comp, act: r.dst.act, arg: r.dst.arg }] : [];
    r.else = r.dst && r.alt ? [{ kind: 'act', id: uid('a'), comp: r.dst.comp, act: r.alt.act, arg: r.alt.arg }] : [];
  }
  delete r.dst; delete r.alt;
  if (!Array.isArray(r.else)) r.else = [];
  const fix = list => list.map(it => (it && it.kind === 'rule' ? migrate(it) : it && it.kind === 'act' ? { ...it, id: it.id || uid('a') } : null)).filter(Boolean);
  r.then = fix(r.then); r.else = fix(r.else);
  return r;
}
/** Visite chaque règle et chaque action : fn(élément, liste qui le contient, règle parente). */
export function walkRule(r, fn, list = null, parent = null) {
  fn(r, list, parent);
  for (const b of ['then', 'else']) for (const it of r[b] || []) { if (it.kind === 'rule') walkRule(it, fn, r[b], r); else fn(it, r[b], r); }
}
export const walkAll = (rules, fn) => rules.forEach(r => walkRule(r, fn, rules, null));
export function findById(rules, id) { let hit = null; walkAll(rules, (it, list, parent) => { if (!hit && it.id === id) hit = { it, list, parent }; }); return hit; }
export const actsOf = r => { const out = []; walkRule(r, it => { if (it.kind === 'act') out.push(it); }); return out; };
export const involves = (r, id) => { let yes = false; walkRule(r, it => { if ((it.kind === 'act' && it.comp === id) || (it.kind === 'rule' && it.src && it.src.comp === id)) yes = true; }); return yes; };
/** Numéro de chaque règle imbriquée : 1, 1.1, 1.2, 2… */
export function numberRules(rules) {
  const map = new Map();
  const go = (r, label) => { map.set(r.id, label); let k = 0; for (const b of ['then', 'else']) for (const it of r[b]) if (it.kind === 'rule') go(it, `${label}.${++k}`); };
  rules.forEach((r, i) => go(r, String(i + 1)));
  return map;
}
/** Nouvelle règle : mesure → action, avec l'action contraire dans « sinon » quand elle existe. */
export function newRule(src, dst, prof) {
  const r = { kind: 'rule', id: uid('r'), src: null, op: '>', v: 0, from: [0, 100], then: [], else: [] };
  if (src) {
    const key = Object.keys(SIGNALS[src.type])[0], sig = signalOf(src.type, key, prof);
    r.src = { comp: src.id, sig: key };
    r.op = sig.kind === 'bool' ? '==' : '>'; r.v = sig.kind === 'bool' ? 1 : sig.def; r.from = sig.range ? [...sig.range] : [0, 100];
  }
  if (dst) {
    const [act] = actsFor(dst.type, src ? 'cond' : 'always')[0] || [];
    if (act) r.then.push(actItem(dst, act));
    const off = offAct(dst.type);
    if (src && off && off !== act) r.else.push(actItem(dst, off));
  }
  return r;
}

const fmtNum = v => String(Math.round(v * 100) / 100).replace('.', DEC);
/** « Quand BTN1 est appuyé », « Toujours », « POT1 (position) fait varier ». */
export function condText(r, byId, prof) {
  if (!r.src) return tl('Toujours');
  const s = byId(r.src.comp), sig = s && signalOf(s.type, r.src.sig, prof);
  if (!s) return tl('Quand (mesure retirée du montage)');
  if (!sig) return tl('Quand ?');
  if (r.op === 'follow') return tl('{0} ({1}) fait varier', s.name, sig.label.replace(/ \(.*\)$/, ''));
  return tl('Quand ') + (sig.kind === 'bool' ? `${s.name} ${r.v ? sig.label : sig.neg}` : `${s.name} · ${sig.label.replace(/ \(.*\)$/, '')} ${OPS[r.op]} ${fmtNum(r.v)}${sig.unit ? ' ' + sig.unit : ''}`);
}
/** « LED1 s'allume », « SERVO1 tourne à 90 ° ». */
export function actText(it, byId) {
  const d = byId(it.comp); if (!d) return it.comp ? tl('(effecteur retiré)') : tl('(choisir un effecteur)');
  const A = ACTIONS[d.type] && ACTIONS[d.type][it.act]; if (!A) return `${d.name} ?`;
  const unit = A.arg && A.arg.unit ? ' ' + A.arg.unit : '';
  const arg = A.arg && it.arg != null && !Array.isArray(it.arg) ? ' ' + (A.arg.kind === 'num' ? fmtNum(it.arg) : A.arg.kind === 'text' ? quote(it.arg) : it.arg) + unit : '';
  return `${d.name} ${A.label}${arg}`;
}
/** Phrase qui résume la règle et ses règles imbriquées. */
export function ruleText(r, byId, prof) {
  const items = list => list.map(it => (it.kind === 'act' ? actText(it, byId) : `[${inner(it)}]`)).join(', ') || tl('rien');
  const inner = x => {
    if (x.src && x.op === 'follow') return condText(x, byId, prof) + COLON + items(x.then.filter(i => i.kind === 'act'));
    return condText(x, byId, prof) + COLON + items(x.then) + (x.src && x.else.length ? tl(' ; sinon {0}', items(x.else)) : '');
  };
  return inner(r) + '.';
}
/** États par défaut proposés pour un effecteur (sans mesure). */
export const defaultActs = type => actsFor(type, 'always');
const TIMED = new Set(['blink', 'beep']);

/* ---------------- Génération du code ---------------- */
export const RESERVED = new Set([...Object.keys(FN), ...Object.keys(CONSTS), 'int', 'float', 'long', 'char', 'byte', 'bool', 'void', 'String', 'setup', 'loop', 'Serial', 'Wire', 'SPI', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'LED_BUILTIN']);
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
export function createGenContext(board, cx) {
  const prof = boardOf(board), kind = BOARDS[board.type] ? board.type : prof.family === 'atmega328p' ? 'uno' : /^esp32/.test(prof.family || '') ? 'esp32' : prof.family === 'esp8266' ? 'nodemcu' : 'pico';
  const avr = kind === 'uno' || kind === 'nano', baud = avr ? 9600 : 115200, max = adcMax(prof);
  const byId = id => cx.comps.find(c => c.id === id);
  const inc = new Set(), glob = [], setup = [], pre = [], body = [], tail = [], helpers = [], notes = [], printed = [];
  const declared = new Map(), used = new Set();
  const pinOf = (c, k) => { const ins = cx.inspect(c), g = ins.io[k]; return g && g.comp === board ? codePin(g) : null; };
  const onBoard = c => { const ins = cx.inspect(c); return ins.board === board; };
  /** Bouton : patte reliée à la carte (1, ou 2 s'il est monté dans l'autre sens) et sens de lecture (HIGH quand il est relié à l'alimentation). */
  const button = c => { const ins = cx.inspect(c), key = ins.io['1'] ? '1' : ins.io['2'] ? '2' : null; return key && { key, high: !!(ins.flags && ins.flags.activeHigh) }; };
  const names = new Set();
  const uniq = n => { if (RESERVED.has(n)) n += '_PIN'; let x = n, i = 2; while (names.has(x) || RESERVED.has(x)) x = `${n}_${i++}`; names.add(x); return x; };
  const pinConst = (c, k, label) => {
    const p = pinOf(c, k); if (p == null) return null;
    const id = `${c.id}|${k}`;
    if (!declared.has(id)) {
      // Contacts d'un relais (côté puissance) : ne comptent pas, la commande garde le nom du relais (K1).
      const n0 = Object.keys(c.pins).filter(x => !(c.type === 'relay' && /^(COM|NO|NC)$/.test(x))).length;
      const single = n0 <= 3 && !['dcmotor', 'l298n', 'hcsr04', 'joystick', 'led-rgb', '7seg', 'stepper'].includes(c.type);
      const n = uniq(ident(single ? c.name : `${c.name}_${k.replace(/[^A-Za-z0-9]/g, '')}`));
      glob.push(`const int ${n} = ${p};${label ? ` // ${label}` : ''}`);
      declared.set(id, n);
    }
    return declared.get(id);
  };
  const objName = c => { const id = c.id + '|obj'; if (!declared.has(id)) declared.set(id, uniq(ident(c.name.toLowerCase()))); return declared.get(id); };
  const missing = (c, what) => { const m = tl('// {0} {1} : utilisez « Câbler automatiquement ».', c.name, what || tl('n’est pas encore câblé(e) à ') + board.name); if (!notes.includes(m)) notes.push(m); return null; };
  const sigVar = new Map();

  /** Déclare un capteur et retourne la variable qui contient sa mesure (lue au début de loop()). */
  function readSignal(c, key) {
    const id = `${c.id}|${key}`;
    if (sigVar.has(id)) return sigVar.get(id);
    if (!onBoard(c)) return missing(c);
    const sig = signalOf(c.type, key, prof), o = objName(c), v = uniq(`${o}_${sig.v}`);
    let expr = null;
    const P = k => pinConst(c, k);
    switch (c.type) {
      case 'dht11': case 'dht22': {
        const p = P('DATA'); if (!p) return missing(c);
        if (!used.has(c.id)) { inc.add('DHT.h'); glob.push(`DHT ${o}(${p}, ${c.type.toUpperCase()});`); setup.push(`${o}.begin();`); }
        expr = key === 'temp' ? `${o}.readTemperature()` : `${o}.readHumidity()`; break;
      }
      case 'ds18b20': {
        const p = P('DQ'); if (!p) return missing(c);
        if (!used.has(c.id)) {
          inc.add('OneWire.h'); inc.add('DallasTemperature.h');
          glob.push(`OneWire ${o}_bus(${p});`, `DallasTemperature ${o}(&${o}_bus);`, `float ${v} = 0;`, `unsigned long ${o}_lecture = 0;`);
          setup.push(`${o}.begin();`, tl('{0}.setWaitForConversion(false); // la conversion (750 ms) ne bloque pas loop()', o), `${o}.requestTemperatures();`);
          pre.push(tl('if (millis() - {0}_lecture >= 1000) { // une mesure par seconde', o), `  ${v} = ${o}.getTempCByIndex(0);`, `  ${o}.requestTemperatures();`, `  ${o}_lecture = millis();`, '}');
        }
        used.add(c.id); sigVar.set(id, v); printed.push([`${c.name} ${sig.label}`, v, sig.unit, false, c, sig]); return v;
      }
      case 'bmp280': {
        if (!used.has(c.id)) {
          inc.add('Wire.h'); inc.add('Adafruit_BMP280.h');
          const addr = cx.A && cx.A.net({ comp: c, key: 'SDO' }).gnd.length ? '0x76' : '0x77';
          glob.push(`Adafruit_BMP280 ${o};`);
          setup.push(tl('if (!{0}.begin({1})) Serial.println("{2} introuvable : vérifiez SDA, SCL et l’adresse");', o, addr, c.name));
        }
        expr = key === 'press' ? `${o}.readPressure() / 100.0` : `${o}.readTemperature()`; break;
      }
      case 'hcsr04': {
        const t = P('TRIG'), e = P('ECHO'); if (!t || !e) return missing(c);
        setup.push(`pinMode(${t}, OUTPUT);`, `pinMode(${e}, INPUT);`);
        if (!helpers.some(h => h.startsWith('float mesurerDistance'))) helpers.push([
          tl('// Distance en cm : une impulsion de 10 µs sur TRIG, puis la durée de l’écho (aller-retour du son).'),
          'float mesurerDistance(int trig, int echo) {',
          '  digitalWrite(trig, LOW);', '  delayMicroseconds(2);', '  digitalWrite(trig, HIGH);', '  delayMicroseconds(10);', '  digitalWrite(trig, LOW);',
          tl('  long duree = pulseIn(echo, HIGH, 30000); // 0 si aucun écho'), '  return duree / 58.0;', '}'].join('\n'));
        expr = `mesurerDistance(${t}, ${e})`; break;
      }
      case 'pir': { const p = P('OUT'); if (!p) return missing(c); setup.push(`pinMode(${p}, INPUT);`); expr = `digitalRead(${p}) == HIGH`; break; }
      case 'button': { const b = button(c), p = b && P(b.key); if (!p) return missing(c); setup.push(b.high ? tl('pinMode({0}, INPUT); // résistance de rappel : relâché LOW, appuyé HIGH', p) : tl('pinMode({0}, INPUT_PULLUP); // relâché : HIGH, appuyé : LOW', p)); expr = `digitalRead(${p}) == ${b.high ? 'HIGH' : 'LOW'}`; break; }
      case 'ldr': { const p = P('AO'); if (!p) return missing(c); expr = `analogRead(${p})`; break; }
      case 'soil': { const p = P('AOUT'); if (!p) return missing(c); expr = `analogRead(${p})`; break; }
      case 'mq2': { const p = P('AO'); if (!p) return missing(c); expr = `analogRead(${p})`; break; }
      case 'pot': { const p = P('W'); if (!p) return missing(c); expr = `analogRead(${p})`; break; }
      case 'sound': { const p = P('AO'); if (!p) return missing(c); expr = tl('abs(analogRead({0}) - {1}) // écart au silence (moitié de l’échelle)', p, Math.round(max / 2)); break; }
      case 'joystick': {
        if (key === 'sw') { const p = P('SW'); if (!p) return missing(c); setup.push(`pinMode(${p}, INPUT_PULLUP);`); expr = `digitalRead(${p}) == LOW`; }
        else { const p = P(key === 'x' ? 'VRx' : 'VRy'); if (!p) return missing(c); expr = `analogRead(${p})`; }
        break;
      }
      case 'mpu6050': {
        if (!used.has(c.id)) {
          inc.add('Wire.h'); inc.add('Adafruit_MPU6050.h'); inc.add('Adafruit_Sensor.h');
          glob.push(`Adafruit_MPU6050 ${o};`);
          setup.push(tl('if (!{0}.begin()) Serial.println("{1} introuvable : vérifiez SDA et SCL");', o, c.name));
          pre.push(`sensors_event_t ${o}_a, ${o}_g, ${o}_t;`, `${o}.getEvent(&${o}_a, &${o}_g, &${o}_t);`);
        }
        expr = `atan2(${o}_a.acceleration.x, ${o}_a.acceleration.z) * 180 / PI`; break;
      }
      default: return null;
    }
    used.add(c.id);
    const type = sig.kind === 'bool' ? 'bool' : sig.type === 'float' ? 'float' : 'int';
    const [e, comment] = expr.split(' // ');
    pre.push(`${type} ${v} = ${e};${comment ? ' // ' + comment : sig.note ? ' // ' + sig.note : ''}`);
    sigVar.set(id, v);
    printed.push([`${c.name} ${sig.label}`, v, sig.unit || '', sig.kind === 'bool', c, sig]);
    return v;
  }

  /** Déclare un effecteur ; retourne une fonction qui écrit le code d'une action. */
  const actors = new Map();
  function actor(c) {
    if (actors.has(c.id)) return actors.get(c.id);
    let a = null;
    const o = objName(c), P = (k, l) => pinConst(c, k, l);
    if (/^led-(red|green|blue|yellow|white)$/.test(c.type)) {
      const p = P('A');
      if (p) {
        setup.push(`pinMode(${p}, OUTPUT);`);
        const pwm = (() => { const g = cx.inspect(c).io.A; return g && boardOf(g.comp).gpio[g.key] && boardOf(g.comp).gpio[g.key].caps.has('pwm'); })();
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
    } else if (c.type === 'led-rgb') {
      const r = P('R'), g = P('G'), b = P('B');
      if (r && g && b) a = (act, arg) => { const [R, G, B] = act === 'color' ? hex(arg) : [0, 0, 0]; return [`analogWrite(${r}, ${R});`, `analogWrite(${g}, ${G});`, `analogWrite(${b}, ${B});`]; };
    } else if (c.type === 'buzzer') {
      // Directement sur une broche, ou derrière un transistor (+ au 5 V, − au collecteur) : la base est la commande.
      const d = P('+') ? null : driveOf(c, cx.A), p = P('+') || (d && d.kind === 'npn' && d.gpio && d.gpio.comp === board ? pinConst(d.npn, 'B') : null);
      if (p) { setup.push(d ? tl('pinMode({0}, OUTPUT); // base de {1} : HIGH, le transistor conduit et {2} sonne', p, d.npn.name, c.name) : `pinMode(${p}, OUTPUT);`); a = (act, arg) => (act === 'on' ? [`digitalWrite(${p}, HIGH);`] : act === 'off' ? [`digitalWrite(${p}, LOW);`] : [tl('digitalWrite({0}, (millis() / {1}) % 2 ? HIGH : LOW); // bip toutes les {2} ms', p, Math.max(1, arg | 0), arg | 0)]); }
    } else if (c.type === 'speaker') {
      const p = P('+');
      if (p) a = (act, arg, x) => (act === 'note' ? [`tone(${p}, ${arg | 0});`] : act === 'off' ? [`noTone(${p});`] : [`tone(${p}, ${x});`]);
    } else if (c.type === 'relay') {
      const p = P('IN');
      if (p) { setup.push(tl('digitalWrite({0}, HIGH); // relais au repos (module actif à l’état bas)', p), `pinMode(${p}, OUTPUT);`); a = act => (act === 'on' ? [tl('digitalWrite({0}, LOW); // LOW colle le relais', p)] : [`digitalWrite(${p}, HIGH);`]); }
    } else if (c.type === 'servo') {
      const p = P('SIG');
      if (p) { inc.add(kind === 'esp32' ? 'ESP32Servo.h' : 'Servo.h'); glob.push(`Servo ${o};`); setup.push(`${o}.attach(${p});`); a = (act, arg, x) => [`${o}.write(${act === 'follow' ? x : arg | 0});`]; }
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
          const i1 = pinConst(drv, k1), i2 = pinConst(drv, k2), en = pinConst(drv, ke);
          if (i1 && i2) {
            setup.push(`pinMode(${i1}, OUTPUT);`, `pinMode(${i2}, OUTPUT);`);
            const [fa, fb] = plusFirst ? [i1, i2] : [i2, i1];
            const speed = v => (en ? [tl('analogWrite({0}, {1}); // vitesse 0 à 255', en, v)] : [tl('// {0} n’est pas câblée : le cavalier du L298N donne toujours la pleine vitesse', ke)]);
            a = (act, arg, x) => {
              const m = motion(act, arg, x);
              if (m.stop) return [`digitalWrite(${i1}, LOW);`, `digitalWrite(${i2}, LOW);`];
              const fwd = m.dir > 0;
              return [`digitalWrite(${fwd ? fa : fb}, HIGH);`, `digitalWrite(${fwd ? fb : fa}, LOW);`, ...speed(m.v)];
            };
          } else missing(drv, tl('n’a pas ses entrées de commande reliées à ') + board.name);
        } else missing(drv);
      } else if (d && d.kind === 'npn') {
        const p = d.gpio && d.gpio.comp === board ? pinConst(d.npn, 'B') : null;
        if (p) {
          const pwm = d.gpio.g && d.gpio.g.caps.has('pwm');
          setup.push(tl('pinMode({0}, OUTPUT); // base de {1} : HIGH, le transistor conduit et {2} tourne', p, d.npn.name, c.name));
          a = (act, arg, x) => {
            const m = motion(act, arg, x);
            if (m.stop) return [`digitalWrite(${p}, LOW);`];
            const pre = m.dir < 0 ? [tl('// un transistor ne fait tourner que dans un sens : il faut un pont en H (L298N) pour inverser')] : [];
            return [...pre, m.full || !pwm ? `digitalWrite(${p}, HIGH);` : tl('analogWrite({0}, {1}); // vitesse 0 à 255', p, m.v)];
          };
        } else missing(d.npn, tl('n’a pas sa base reliée (par une résistance) à ') + board.name);
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
      if (p.every(Boolean)) {
        inc.add('Stepper.h'); glob.push(tl('Stepper {0}(2048, {1}, {2}, {3}, {4}); // ordre IN1-IN3-IN2-IN4', o, p[0], p[2], p[1], p[3])); setup.push(tl('{0}.setSpeed(12); // tours par minute', o));
        a = act => (act === 'cw' ? [tl('{0}.step(64); // un petit pas à chaque tour de loop()', o)] : act === 'ccw' ? [`${o}.step(-64);`] : [tl('// à l’arrêt')]);
      }
    } else if (c.type === '7seg') {
      const segs = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(k => P(k));
      if (segs.every(Boolean)) {
        glob.push(`const int ${o}_segments[7] = {${segs.join(', ')}}; // a, b, c, d, e, f, g`);
        if (!helpers.some(h => h.includes('CHIFFRES'))) helpers.push([
          tl('// Segments allumés pour chaque chiffre (bit 0 = a … bit 6 = g).'),
          `const byte CHIFFRES[10] = {${DIGITS.join(', ')}};`,
          'void afficherChiffre(const int segments[], int n) {',
          '  for (int i = 0; i < 7; i++) {',
          '    bool allume = n >= 0 && n <= 9 && bitRead(CHIFFRES[n], i);',
          '    digitalWrite(segments[i], allume ? HIGH : LOW);', '  }', '}'].join('\n'));
        setup.push(`for (int i = 0; i < 7; i++) pinMode(${o}_segments[i], OUTPUT);`);
        a = (act, arg, x) => [`afficherChiffre(${o}_segments, ${act === 'off' ? -1 : act === 'follow' ? x : arg | 0});`];
      }
    } else if (c.type === 'ws2812') {
      const p = P('DIN');
      if (p) {
        inc.add('Adafruit_NeoPixel.h'); glob.push(`Adafruit_NeoPixel ${o}(8, ${p}, NEO_GRB + NEO_KHZ800);`); setup.push(`${o}.begin();`, `${o}.setBrightness(80);`, `${o}.show();`);
        a = (act, arg, x) => {
          if (act === 'off') return [`${o}.clear();`, `${o}.show();`];
          const [R, G, B] = hex(Array.isArray(arg) ? null : arg || '#3fb27f');
          if (act === 'follow') return [`for (int i = 0; i < 8; i++) ${o}.setPixelColor(i, i < ${x} ? ${o}.Color(${R}, ${G}, ${B}) : 0);`, `${o}.show();`];
          return [`${o}.fill(${o}.Color(${R}, ${G}, ${B}));`, `${o}.show();`];
        };
      }
    } else if (c.type === 'lcd1602' || c.type === 'oled') {
      if (onBoard(c)) {
        inc.add('Wire.h');
        if (c.type === 'lcd1602') {
          inc.add('LiquidCrystal_I2C.h'); glob.push(`LiquidCrystal_I2C ${o}(0x27, 16, 2);`); setup.push(`${o}.init();`, `${o}.backlight();`);
          if (!helpers.some(h => h.includes('void ecrireLigne'))) helpers.push([tl('// Écrit une ligne entière du LCD, complétée par des espaces pour effacer l’ancien texte.'),
            'void ecrireLigne(LiquidCrystal_I2C &ecran, int ligne, String texte) {', '  ecran.setCursor(0, ligne);', '  ecran.print(texte);', '  for (int i = texte.length(); i < 16; i++) ecran.print(\' \');', '}'].join('\n'));
        } else {
          inc.add('Adafruit_GFX.h'); inc.add('Adafruit_SSD1306.h'); glob.push(`Adafruit_SSD1306 ${o}(128, 64, &Wire, -1);`);
          setup.push(tl('if (!{0}.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("{1} introuvable : vérifiez SDA et SCL");', o, c.name), `${o}.setTextColor(SSD1306_WHITE);`);
          pre.push(`${o}.clearDisplay();`, `${o}.setTextSize(1);`, `${o}.setCursor(0, 0);`);
          tail.push(`${o}.display();`);
        }
        let row = 0;
        a = (act, arg, x, label) => {
          const txt = act === 'text' ? cstr(arg) : label;
          if (c.type === 'lcd1602') return [`ecrireLigne(${o}, ${a.row}, ${txt});`];
          return [`${o}.println(${txt});`];
        };
        a.nextRow = () => (a.row = row++ % 2);
        a.row = 0;
      } else missing(c);
    }
    if (!a && !actors.has(c.id) && ACTIONS[c.type] && !notes.some(n => n.includes(c.name))) missing(c);
    actors.set(c.id, a);
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
        if (!helpers.some(h => h.startsWith('float mesurerDistance'))) helpers.push([
          tl('// Distance en cm : une impulsion de 10 µs sur TRIG, puis la durée de l’écho (aller-retour du son).'),
          'float mesurerDistance(int trig, int echo) {',
          '  digitalWrite(trig, LOW);', '  delayMicroseconds(2);', '  digitalWrite(trig, HIGH);', '  delayMicroseconds(10);', '  digitalWrite(trig, LOW);',
          tl('  long duree = pulseIn(echo, HIGH, 30000); // 0 si aucun écho'), '  return duree / 58.0;', '}'].join('\n'));
        return `mesurerDistance(${t}, ${e})`;
      }
      case 'pir': { const p = P('OUT'); if (!p) return missing(c); setup.push(`pinMode(${p}, INPUT);`); return `digitalRead(${p}) == HIGH`; }
      case 'button': { const b = button(c), p = b && P(b.key); if (!p) return missing(c); setup.push(b.high ? tl('pinMode({0}, INPUT); // résistance de rappel : relâché LOW, appuyé HIGH', p) : tl('pinMode({0}, INPUT_PULLUP); // relâché : HIGH, appuyé : LOW', p)); return `digitalRead(${p}) == ${b.high ? 'HIGH' : 'LOW'}`; }
      case 'ldr': case 'mq2': case 'soil': case 'pot': case 'sound': {
        const p = P({ soil: 'AOUT', pot: 'W' }[c.type] || 'AO'); if (!p) return missing(c);
        return c.type === 'sound' ? `abs(analogRead(${p}) - ${Math.round(max / 2)})` : `analogRead(${p})`;
      }
      case 'joystick': {
        if (key === 'sw') { const p = P('SW'); if (!p) return missing(c); setup.push(`pinMode(${p}, INPUT_PULLUP);`); return `digitalRead(${p}) == LOW`; }
        const p = P(key === 'x' ? 'VRx' : 'VRy'); if (!p) return missing(c); return `analogRead(${p})`;
      }
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
      default: return null;
    }
  }

  /**
   * Programme complet. header : lignes d'en-tête (à défaut, celles des règles selon starter) ;
   * loopDelay : delay(10) à la fin de loop() ; setupBody : lignes ajoutées à la fin de setup(), sans
   * dédoublonnage ; keep : identifiants laissés tels quels dans la version anglaise.
   */
  function assemble({ header, starter, loopDelay = true, setupBody = [], keep } = {}) {
    const lines = [];
    if (header) lines.push(...header);
    else {
      lines.push(tl('// Programme de {0} ({1}), généré par Jollof Studio {2}.', board.name, prof.label, starter ? tl('à partir du montage') : tl('à partir des règles')));
      lines.push(tl('// Vous pouvez le modifier librement : il ne sera plus régénéré.'));
    }
    if (inc.size) lines.push('', ...[...inc].map(i => `#include <${i}>`));
    if (glob.length) lines.push('', ...glob);
    if (printed.length) lines.push('', 'unsigned long dernierAffichage = 0;');
    if (notes.length) lines.push('', ...notes);
    if (helpers.length) lines.push('', ...helpers.join('\n\n').split('\n'));
    const seen = new Set(), setupLines = setup.filter(l => l.startsWith('//') || (!seen.has(l) && seen.add(l)));
    lines.push('', 'void setup() {', `  Serial.begin(${baud});`, ...setupLines.map(l => '  ' + l), ...setupBody.map(l => (l ? '  ' + l : l)), '}');
    lines.push('', 'void loop() {');
    if (pre.length) lines.push(tl('  // Mesures'), ...pre.map(l => '  ' + l));
    lines.push(...body.map(l => (l ? '  ' + l : '')));
    if (tail.length) lines.push('', ...tail.map(l => '  ' + l));
    if (printed.length) {
      lines.push('', tl('  // Mesures sur le moniteur série, une fois par seconde'), '  if (millis() - dernierAffichage >= 1000) {', '    dernierAffichage = millis();');
      printed.forEach(([lab, v, unit, bool], i) => {
        const after = (unit ? ' ' + unit : '') + (i < printed.length - 1 ? ' | ' : '');
        lines.push(`    Serial.print(${cstr(lab.replace(/ \(.*\)$/, '') + COLON)});`, `    Serial.print(${bool ? `${v} ? ${cstr(tl('oui'))} : ${cstr(tl('non'))}` : v});`);
        if (after) lines.push(`    Serial.print(${cstr(after)});`);
      });
      lines.push('    Serial.println();', '  }');
    }
    if (loopDelay) lines.push('  delay(10);');
    lines.push('}', '');
    return isEn ? englishNames(lines.join('\n'), keep) : lines.join('\n');
  }

  return {
    board, cx, prof, kind, avr, baud, max, byId, inc, glob, setup, pre, body, tail, helpers, notes, printed, declared, used, names, actors,
    pinOf, onBoard, uniq, pinConst, objName, missing, readSignal, sensorExpr, actor, assemble
  };
}

/**
 * Programme Arduino de la carte `board` : ses règles, ou à défaut un programme de départ
 * qui lit chaque capteur relié et l'affiche sur le moniteur série et les écrans.
 * cx : { comps, A (analyse), inspect(comp) → ins, rules, states (états par défaut) }.
 */
export function generate(board, cx) {
  const g = createGenContext(board, cx);
  const { prof, byId, setup, body, printed, actors, uniq, objName, actor, readSignal } = g;

  /* --- Règles, états par défaut et montage --- */
  // Moteurs : la carte qui commande leur pilote, transistor ou relais.
  const drvBoard = d => driveBoard(d, cx.A, cx.inspect);
  const boardOfComp = c => (isMotor(c) ? drvBoard(c) : cx.inspect(c).board);
  const mine = cx.comps.filter(c => (isMotor(c) ? drvBoard(c) === board || (!drvBoard(c) && boardsOf(cx) === 1) : cx.inspect(c).board === board));
  const rules = (cx.rules || []).filter(r => {
    const acts = actsOf(r).map(a => byId(a.comp)).filter(Boolean);
    if (acts.some(d => boardOfComp(d) === board)) return true;
    if (acts.some(d => boardOfComp(d))) return false; // règle d'une autre carte
    const s = r.src && byId(r.src.comp), sb = s && cx.inspect(s).board;
    return sb ? sb === board : boardsOf(cx) === 1;
  });
  const nums = numberRules(rules), indent = ls => ls.map(l => (l ? '  ' + l : l));
  const ruledActs = new Set(); rules.forEach(r => actsOf(r).forEach(a => ruledActs.add(a.comp)));

  // États par défaut des effecteurs : appliqués au démarrage, et si demandé chaque fois qu'aucune règle ne les commande.
  const states = cx.states || {}, flags = new Map(), fallback = [];
  const withRow0 = (a, fn) => { const keep = a.row; a.row = 0; const out = fn(); a.row = keep; return out; };
  mine.filter(isActuator).forEach(c => {
    const st = states[c.id];
    if (!st || !st.act || !defaultActs(c.type).some(([k]) => k === st.act)) return;
    const a = actor(c); if (!a) return;
    const lines = withRow0(a, () => a(st.act, st.arg, null, cstr(c.name)));
    setup.push(tl('// {0} : état par défaut', c.name), ...lines);
    if (st.mode !== 'always') return;
    if (ruledActs.has(c.id)) {
      const f = uniq(`${objName(c)}_commande`); flags.set(c.id, f);
      fallback.push('', tl('// {0} revient à son état par défaut quand aucune règle ne l’a commandé', c.name), `if (!${f}) {`, ...indent(lines), '}');
    } else if (TIMED.has(st.act)) fallback.push('', tl('// {0} : état par défaut', c.name), ...lines);
  });

  function emitAct(it, ctx) {
    const d = byId(it.comp);
    if (!d) return [it.comp ? tl('// (action ignorée : l’effecteur a été retiré du montage)') : tl('// (action incomplète : choisissez un effecteur)')];
    const db = boardOfComp(d);
    if (db && db !== board) return [tl('// ({0} est relié à {1} : action ignorée ici)', d.name, db.name)];
    const act = actor(d);
    if (!act) return [tl('// ({0} n’est pas câblé : action ignorée)', d.name)];
    if (act.nextRow) act.nextRow();
    const label = ctx.s ? screenText(ctx.s, ctx.sig, ctx.v) : cstr(d.name);
    let lines;
    const A = ACTIONS[d.type][it.act];
    if (ctx.follow && A && A.follow) {
      const out = Array.isArray(it.arg) ? it.arg : A.follow, [a0, a1] = ctx.from || [0, 100], x = uniq(`${objName(d)}_consigne`);
      lines = [`int ${x} = map(constrain(${ctx.v}, ${a0}, ${a1}), ${a0}, ${a1}, ${out[0]}, ${out[1]});`, ...act(it.act, it.arg, x, label)];
    } else lines = act(it.act, it.arg, null, label);
    if (flags.has(d.id)) lines.push(`${flags.get(d.id)} = true;`);
    return lines;
  }
  function emitItems(list, ctx) {
    const out = [];
    for (const it of list) {
      if (it.kind === 'rule') out.push(tl('// Règle {0} : {1}', nums.get(it.id), ruleText(it, byId, prof)), ...emitRule(it, ctx));
      else out.push(...emitAct(it, ctx));
    }
    return out;
  }
  /** Code d'une règle : un if (et ses else / else if), ou ses actions directement. */
  function emitRule(r, ctx) {
    if (!r.src) return emitItems(r.then, ctx);
    const s = byId(r.src.comp);
    if (!s) return [tl('// (ignorée : le capteur de cette règle a été retiré du montage)')];
    const sig = signalOf(s.type, r.src.sig, prof), v = sig && readSignal(s, r.src.sig);
    if (!v) return [tl('// (ignorée : {0} n’est pas câblé)', s.name)];
    const inner = { s, sig, v, from: r.from };
    if (r.op === 'follow') return emitItems(r.then.filter(it => it.kind === 'act'), { ...inner, follow: true });
    const cond = sig.kind === 'bool' ? (r.v ? v : `!${v}`) : `${v} ${r.op} ${String(+r.v || 0)}`;
    const out = [`if (${cond}) {`, ...indent(emitItems(r.then, inner))];
    const els = r.else || [];
    if (els.length === 1 && els[0].kind === 'rule' && els[0].src && els[0].op !== 'follow') {
      const chain = emitRule(els[0], ctx);
      if (chain[0].startsWith('if (')) { out.push(tl('} else {0} // Règle {1}', chain[0], nums.get(els[0].id)), ...chain.slice(1)); return out; }
    }
    if (els.length) out.push('} else {', ...indent(emitItems(els, inner)));
    out.push('}');
    return out;
  }
  if (flags.size) body.push('', tl('// Aucun effecteur n’a encore été commandé dans ce tour de boucle'), ...[...flags.values()].map(f => `bool ${f} = false;`));
  rules.forEach(r => body.push('', tl('// Règle {0} : {1}', nums.get(r.id), ruleText(r, byId, prof)), ...emitRule(r, {})));
  body.push(...fallback);

  // Chaque capteur câblé est lu ; chaque écran sans règle ni état par défaut affiche les mesures.
  const starter = !rules.length;
  mine.filter(isSensor).forEach(c => Object.keys(SIGNALS[c.type]).forEach(k => readSignal(c, k)));
  mine.filter(c => (c.type === 'lcd1602' || c.type === 'oled') && !ruledActs.has(c.id) && !(states[c.id] && states[c.id].act)).forEach(sc => {
    const a = actor(sc); if (!a) return;
    const list = printed.slice(0, sc.type === 'lcd1602' ? 2 : 6);
    if (list.length) body.push('', tl('// {0} affiche les mesures', sc.name));
    list.forEach(([, v, , , src, sig]) => { a.nextRow(); body.push(...a('value', null, null, screenText(src, sig, v))); });
  });
  if (starter) {
    const outs = mine.filter(c => isActuator(c) && c.type !== 'lcd1602' && c.type !== 'oled');
    outs.forEach(c => actor(c));
    const ex = outs.map(c => {
      const a = actors.get(c.id); if (!a) return null;
      const first = Object.keys(ACTIONS[c.type])[0];
      return `//   ${a(first, defArg(c.type, first), '0', cstr(c.name)).join(' ')}`;
    }).filter(Boolean);
    body.push('', tl('// Écrivez ici ce que la carte doit faire. Par exemple :'), ...(ex.length ? ex : [tl('//   Serial.println("Bonjour");')]));
    body.push(tl('// Ou ajoutez des règles : sélectionnez un composant puis « Programmer ».'));
  }

  return g.assemble({ starter });
}

/** Interface en anglais : les noms de variables du code généré passent aussi en anglais. */
const ID_EN = { appuye: 'pressed', bouton: 'button', gaz: 'gas', humidite: 'humidity', inclinaison: 'tilt', lumiere: 'light', mouvement: 'motion', pression: 'pressure', secheresse: 'dryness',
  lecture: 'lastRead', consigne: 'setpoint', allume: 'lit', chiffre: 'digit', couleur: 'color', dernierAffichage: 'lastPrint', duree: 'duration', ecran: 'screen', ecrireLigne: 'writeLine',
  ligne: 'line', mesurerDistance: 'measureDistance', sens: 'direction', texte: 'text', valeur: 'value', vitesse: 'speed' };
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
function screenText(c, sig, v) {
  const plain = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const key = Object.keys(SIGNALS[c.type]).find(k => SIGNALS[c.type][k].v === sig.v);
  const name = plain(sig.short || SHORT[key] || sig.label);
  if (sig.kind === 'bool') return `${cstr(name + ': ')} + String(${v} ? ${cstr(tl('oui'))} : ${cstr(tl('non'))})`;
  const unit = sig.unit ? plain(' ' + sig.unit.replace('°C', 'C').replace('°', ' deg')) : '';
  return `${cstr(name + ': ')} + String(${v}${sig.type === 'float' ? ', 1' : ''})${unit ? ` + ${cstr(unit)}` : ''}`;
}
