// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Import d'un projet Wokwi (diagram.json, sketch.ino, libraries.txt ; seul ou dans le .zip téléchargé depuis
// Wokwi, format que d'autres simulateurs reprennent). Écrit d'après la documentation publique du format
// (docs.wokwi.com/diagram-format et les pages des composants) : aucun code d'un autre simulateur.
//   - chaque composant connu devient un composant de la bibliothèque (table PARTS ci-dessous, broches renommées) ;
//   - les breadboards de Wokwi disparaissent : leurs bandes relient des broches, devenues des fils directs ;
//   - left/top (pixels de l'éditeur Wokwi) deviennent des positions en millimètres, recentrées sur la carte ;
//   - le programme va à la première carte, en mode fidèle s'il dépasse ce que l'interpréteur comprend.
// Ce qui ne se traduit pas (composant inconnu, broche sans équivalent) est listé dans le compte rendu.
import { compile } from '../prog/lang.js';
import { EMULATED } from '../emu/boards.js';
import { tl } from '../i18n/index.js';

const PX = 0.2646; // un pixel de l'éditeur Wokwi (96 ppp), en millimètres
const BOARDS = new Set(['uno', 'nano', 'esp32', 'nodemcu', 'pico']);
const range = (a, b, f) => Object.fromEntries(Array.from({ length: b - a + 1 }, (_, i) => f(a + i)));
const same = names => Object.fromEntries(names.map(n => [n, n]));

/** Valeur d'une résistance Wokwi (« 220 », « 4.7k », « 10000 », « 1M ») en ohms. */
export function ohms(v) {
  const m = /^\s*([\d.]+)\s*([kKmM]?)/.exec(String(v ?? '1000'));
  if (!m) return 1000;
  return +m[1] * ({ k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[m[2]] || 1);
}
const RES = [[22, 'res-22'], [220, 'res-220'], [330, 'res-330'], [1000, 'res-1k'], [4700, 'res-4k7'], [10000, 'res-10k']];
/** Résistance la plus proche dans la bibliothèque (en rapport, pas en écart) ; note si elle diffère de plus de 15 %. */
function resistor(attrs) {
  const r = ohms(attrs.value);
  const [v, type] = RES.reduce((best, x) => (Math.abs(Math.log(x[0] / r)) < Math.abs(Math.log(best[0] / r)) ? x : best));
  return { type, note: Math.abs(v / r - 1) > 0.15 ? tl('résistance de {0} Ω remplacée par {1} Ω (valeur la plus proche de la bibliothèque)', r, v) : null };
}
const LED_COLORS = { red: 'led-red', green: 'led-green', blue: 'led-blue', yellow: 'led-yellow', white: 'led-white', orange: 'led-yellow', limegreen: 'led-green', purple: 'led-blue' };

const UNO_PINS = { ...range(0, 13, n => [String(n), 'D' + n]), ...range(0, 5, n => ['A' + n, 'A' + n]), '5V': '5V', '3.3V': '3V3', VIN: 'VIN', IOREF: 'IOREF', RESET: 'RST', AREF: 'AREF', SDA: 'SDA', SCL: 'SCL', GND: 'GND' };
const NANO_PINS = { ...range(2, 13, n => [String(n), 'D' + n]), ...range(0, 7, n => ['A' + n, 'A' + n]), 0: 'RX0', 1: 'TX1', RX: 'RX0', TX: 'TX1', '5V': '5V', '3.3V': '3V3', VIN: 'VIN', RESET: 'RST', AREF: 'REF', GND: 'GND' };
const PICO_PINS = { ...range(0, 22, n => ['GP' + n, 'GP' + n]), GP26: 'GP26', GP27: 'GP27', GP28: 'GP28', '3V3': '3V3', VBUS: 'VBUS', VSYS: 'VSYS', '3V3_EN': '3V3_EN', RUN: 'RUN', ADC_VREF: 'VREF', AGND: 'AGND', GND: 'GND' };
const ESP_GPIO = { 36: 'VP', 39: 'VN', 34: 'D34', 35: 'D35', 32: 'D32', 33: 'D33', 25: 'D25', 26: 'D26', 27: 'D27', 14: 'D14', 12: 'D12', 13: 'D13', 23: 'D23', 22: 'D22', 21: 'D21', 19: 'D19', 18: 'D18', 5: 'D5', 17: 'TX2', 16: 'RX2', 4: 'D4', 2: 'D2', 15: 'D15', 1: 'TX0', 3: 'RX0' };
const ESP_PINS = {
  ...Object.fromEntries(Object.entries(ESP_GPIO).flatMap(([n, k]) => [[n, k], ['D' + n, k], ['GPIO' + n, k]])),
  VP: 'VP', VN: 'VN', TX: 'TX0', RX: 'RX0', TX0: 'TX0', RX0: 'RX0', TX2: 'TX2', RX2: 'RX2', EN: 'EN', VIN: 'VIN', '5V': 'VIN', '3V3': '3V3', GND: 'GND'
};

/**
 * Composants Wokwi → bibliothèque. type : identifiant (ou fonction des attributs) ; pins : broche Wokwi → broche
 * Jollof (« GND.2 » se ramène à « GND ») ; w, h : taille approximative dans l'éditeur Wokwi (px), pour le centre.
 */
export const PARTS = {
  'wokwi-arduino-uno': { type: 'uno', pins: UNO_PINS, w: 274, h: 202 },
  'wokwi-arduino-nano': { type: 'nano', pins: NANO_PINS, w: 170, h: 70 },
  'wokwi-pi-pico': { type: 'pico', pins: PICO_PINS, w: 75, h: 195 },
  'board-pi-pico-w': { type: 'pico', pins: PICO_PINS, w: 75, h: 195 },
  'wokwi-esp32-devkit-v1': { type: 'esp32', pins: ESP_PINS, w: 107, h: 200 },
  'board-esp32-devkit-c-v4': { type: 'esp32', pins: ESP_PINS, w: 107, h: 220 },
  'wokwi-led': { type: a => LED_COLORS[String(a.color || 'red').toLowerCase()] || 'led-red', pins: { A: 'A', C: 'K' }, w: 40, h: 50 },
  'wokwi-resistor': { type: resistor, pins: { 1: '1', 2: '2' }, w: 60, h: 12 },
  'wokwi-pushbutton': { type: 'button', pins: { '1.l': '1', '1.r': '1', '2.l': '2', '2.r': '2' }, w: 68, h: 45 },
  'wokwi-pushbutton-6mm': { type: 'button', pins: { '1.l': '1', '1.r': '1', '2.l': '2', '2.r': '2' }, w: 30, h: 30 },
  'wokwi-potentiometer': { type: 'pot', pins: { GND: '1', SIG: 'W', VCC: '3' }, w: 75, h: 75 },
  'wokwi-slide-potentiometer': { type: 'pot', pins: { GND: '1', SIG: 'W', VCC: '3' }, w: 220, h: 40 },
  'wokwi-dht22': { type: 'dht22', pins: { VCC: 'VCC', SDA: 'DATA', GND: 'GND' }, w: 60, h: 95 },
  'wokwi-hc-sr04': { type: 'hcsr04', pins: same(['VCC', 'TRIG', 'ECHO', 'GND']), w: 175, h: 80 },
  'wokwi-ds18b20': { type: 'ds18b20', pins: { GND: 'GND', DQ: 'DQ', VCC: 'VDD' }, w: 40, h: 70 },
  'wokwi-lcd1602': { type: a => (String(a.pins || '').toLowerCase() === 'i2c' ? 'lcd1602' : null), pins: same(['GND', 'VCC', 'SDA', 'SCL']), w: 300, h: 135, why: a => (String(a.pins || '').toLowerCase() === 'i2c' ? null : tl('LCD 1602 en câblage parallèle (16 broches) : seule la version I2C existe dans la bibliothèque')) },
  'board-ssd1306': { type: 'oled', pins: same(['GND', 'VCC', 'SCL', 'SDA']), w: 110, h: 80 },
  'wokwi-servo': { type: 'servo', pins: { GND: 'GND', 'V+': 'VCC', PWM: 'SIG' }, w: 170, h: 90 },
  'wokwi-buzzer': { type: 'buzzer', pins: { 1: '-', 2: '+' }, w: 50, h: 60 },
  'wokwi-neopixel': { type: 'ws2812', pins: { VDD: 'VCC', VSS: 'GND', DIN: 'DIN' }, w: 25, h: 25 },
  'wokwi-led-ring': { type: 'ws2812', pins: { VCC: 'VCC', GND: 'GND', DIN: 'DIN' }, w: 180, h: 180 },
  'wokwi-ir-receiver': { type: 'ir', pins: { GND: 'GND', VCC: 'VCC', DAT: 'OUT' }, w: 40, h: 70 },
  'wokwi-membrane-keypad': { type: 'keypad', pins: same(['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4']), w: 280, h: 370 },
  'wokwi-rgb-led': { type: 'led-rgb', pins: { R: 'R', G: 'G', B: 'B', COM: 'GND' }, w: 40, h: 60, why: a => (String(a.common || 'anode').toLowerCase() === 'anode' ? tl('LED RGB à anode commune (réglage par défaut de Wokwi) : la bibliothèque a une LED à cathode commune, COM passe à la masse et la logique du programme s’inverse') : null) },
  'wokwi-7segment': {
    type: a => (+(a.digits || 1) > 1 ? null : '7seg'), pins: { ...same(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP']), COM: 'COM' }, w: 70, h: 100,
    why: a => (+(a.digits || 1) > 1 ? tl('afficheur de {0} chiffres multiplexé : seul l’afficheur d’un chiffre existe dans la bibliothèque', a.digits) : String(a.common || '').toLowerCase() === 'anode' ? tl('afficheur à anode commune : celui de la bibliothèque est à cathode commune') : null)
  },
  'wokwi-led-strip': { type: 'ws2812', pins: { VDD: 'VCC', VSS: 'GND', DIN: 'DIN' }, w: 200, h: 30 },
  'wokwi-relay-module': { type: 'relay', pins: same(['VCC', 'GND', 'IN', 'COM', 'NO', 'NC']), w: 100, h: 60 },
  'wokwi-mpu6050': { type: 'mpu6050', pins: same(['INT', 'AD0', 'XCL', 'XDA', 'SDA', 'SCL', 'GND', 'VCC']), w: 85, h: 60 },
  'wokwi-pir-motion-sensor': { type: 'pir', pins: same(['VCC', 'OUT', 'GND']), w: 90, h: 90 },
  'wokwi-photoresistor-sensor': { type: 'ldr', pins: same(['VCC', 'GND', 'DO', 'AO']), w: 170, h: 60 },
  'wokwi-gas-sensor': { type: 'mq2', pins: { AOUT: 'AO', DOUT: 'DO', GND: 'GND', VCC: 'VCC' }, w: 140, h: 100 },
  'wokwi-small-sound-sensor': { type: 'sound', pins: { AOUT: 'AO', DOUT: 'DO', GND: 'GND', VCC: 'VCC' }, w: 140, h: 55 },
  'wokwi-big-sound-sensor': { type: 'sound', pins: { AOUT: 'AO', DOUT: 'DO', GND: 'GND', VCC: 'VCC' }, w: 180, h: 60 },
  'wokwi-analog-joystick': { type: 'joystick', pins: { VCC: '+5V', VERT: 'VRy', HORZ: 'VRx', SEL: 'SW', GND: 'GND' }, w: 100, h: 120 }
};
/** Composants sans équivalent électrique dans le montage (instruments de Wokwi) : ignorés sans avertissement. */
const SILENT = new Set(['wokwi-logic-analyzer', 'wokwi-ir-remote']);
const NOTE = { 'wokwi-ir-remote': () => tl('télécommande infrarouge : utilisez celle du panneau « Périphériques » de l’onglet Simulation') };

/**
 * Breadboards de Wokwi : quelles broches sont reliées entre elles. Rend la clé de la bande (même clé = même
 * conducteur) ou null pour une broche inconnue. Bandes : « 12t.a » à « 12t.e » (colonne 12, moitié haute),
 * « 12b.f » à « 12b.j » ; rails « tp.1 », « tn.1 », « bp.1 », « bn.1 » (un conducteur par rail).
 */
export function stripOf(type, pin) {
  if (!/breadboard/.test(type)) return null;
  let m = /^(\d+)([tb])\.([a-j])$/.exec(pin);
  if (m) return `${m[1]}${m[2]}`;
  m = /^([tb][pn])\.(\d+)$/.exec(pin);
  if (m) return m[1];
  return null;
}
const COLORS = { red: '#e5484d', black: '#3a3f45', green: '#2fa84f', blue: '#3d7be0', yellow: '#e5c22e', orange: '#f08c2e', white: '#e6eaee', purple: '#8e5cd9', violet: '#8e5cd9', gray: '#8a8f98', grey: '#8a8f98', brown: '#8b5a2b', cyan: '#2ec4d9', magenta: '#c04fd0', pink: '#e86fa8', gold: '#d4a017', limegreen: '#5fd35f' };
const colorOf = c => (typeof c === 'string' ? (COLORS[c.toLowerCase()] || (/^#[0-9a-f]{6}$/i.test(c) ? c : undefined)) : undefined);

/** Une broche « partId:pinName » ; le nom de broche peut contenir « : » ? Non : seul le premier « : » sépare. */
const splitEnd = s => { const i = String(s).indexOf(':'); return i < 0 ? null : [s.slice(0, i), s.slice(i + 1)]; };

/** Broches de masse des cartes (le même conducteur) : autant de fils possibles sans breadboard. */
const GNDS = { uno: 3, nano: 2, pico: 8, esp32: 2, nodemcu: 4 };
const gndKeys = type => Array.from({ length: GNDS[type] || 0 }, (_, i) => (i ? `GND (${i + 1})` : 'GND'));
const POWER = new Set(['5V', '3V3', 'VIN', 'VBUS', 'VSYS']);
/** Broches confondues sur la carte (SDA = A4 sur l'Uno) : une seule broche, donc un seul fil. */
const aliasOf = (comp, key) => (comp && comp.type === 'uno' ? ({ SDA: 'A4', SCL: 'A5' }[key] || key) : key);

/**
 * Fils du montage, « un fil par broche » comme sur un vrai connecteur : un conducteur à deux broches devient un
 * fil ; à plusieurs, la masse prend d'abord les autres broches GND de la carte, sinon tout passe par une
 * breadboard de la bibliothèque (rail − pour la masse, rail + pour une alimentation, bande de 5 trous sinon).
 */
function routeNets(nets, comps) {
  const wires = [], byId = new Map(comps.map(c => [c.id, c]));
  const add = (a, b, color) => wires.push({ id: `w${wires.length + 1}`, a, b, color });
  let bb = null, strip = 0;
  const rails = { '-': ['T-', 'B-'], '+': ['T+', 'B+'] };
  /** Groupe de trous libre : un rail du signe voulu, sinon la bande suivante (colonnes 1 à 30, haut puis bas). */
  function group(sign) {
    if (!bb) {
      const b = comps.find(c => BOARDS.has(c.type));
      bb = { id: 'breadboard_1', type: 'breadboard', x: b ? b.x : 0, z: (b ? b.z : 0) + 75, r: 0 };
      comps.push(bb);
    }
    if (sign && rails[sign].length) { const r = rails[sign].shift(); return Array.from({ length: 25 }, (_, j) => `${r}${j + 1}`); }
    if (strip >= 60) return null;
    const col = (strip >> 1) + 1, rows = strip % 2 ? 'FGHIJ' : 'ABCDE';
    strip++;
    return [...rows].map(r => r + col);
  }
  for (const net of nets) {
    let refs = net.refs;
    if (refs.length < 2) continue;
    const gnd = refs.find(r => /^GND( \(\d+\))?$/.test(r[1]) && BOARDS.has(byId.get(r[0])?.type));
    const pwr = refs.find(r => POWER.has(r[1]) && BOARDS.has(byId.get(r[0])?.type));
    const color = net.color || (gnd ? '#3a3f45' : pwr ? '#e5484d' : undefined);
    if (refs.length === 2) { add(refs[0], refs[1], color); continue; }
    if (gnd) {
      // Autres broches GND de la même carte : un fil chacune tant qu'il en reste.
      const free = gndKeys(byId.get(gnd[0]).type).filter(k => !refs.some(r => r[0] === gnd[0] && r[1] === k));
      const others = refs.filter(r => r !== gnd && !(r[0] === gnd[0] && /^GND/.test(r[1])));
      const mine = refs.filter(r => r[0] === gnd[0] && /^GND/.test(r[1]));
      if (others.length <= mine.length + free.length) {
        const slots = [...mine.map(r => r[1]), ...free];
        others.forEach((r, i) => add(r, [gnd[0], slots[i]], color));
        continue;
      }
    }
    // Jonction sur la breadboard : chaque broche à son trou ; une bande pleine se prolonge par un pont.
    let holes = group(gnd ? '-' : pwr ? '+' : null);
    for (let i = 0; i < refs.length; i++) {
      if (!holes) break;
      const last = holes.length === 1 && i < refs.length - 1;
      if (last) { const more = group(null); if (!more) break; add([bb.id, holes[0]], [bb.id, more[0]], color); holes = more.slice(1); }
      add(refs[i], [bb.id, holes.shift()], color);
    }
  }
  return wires;
}

/**
 * Projet Wokwi → projet Jollof. files : { 'diagram.json': texte, 'sketch.ino': texte, 'libraries.txt': texte, … }
 * (ou diagram : objet déjà lu). Rend { project, report: { parts, wires, unknown: [{ id, type }], dropped: [texte],
 * notes: [texte], engine } }.
 */
export function importWokwi(files, name = 'wokwi') {
  const raw = files['diagram.json'];
  const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!d || !Array.isArray(d.parts)) throw new Error(tl('ce fichier n’est pas un diagram.json de Wokwi (liste « parts » absente)'));
  const report = { parts: 0, wires: 0, unknown: [], dropped: [], notes: [], engine: null };
  const comps = [], byWokwi = new Map(), count = {};
  for (const p of d.parts) {
    if (!p || typeof p.type !== 'string' || typeof p.id !== 'string') continue;
    if (/breadboard/.test(p.type)) { byWokwi.set(p.id, { bb: true, type: p.type }); continue; }
    if (NOTE[p.type]) report.notes.push(NOTE[p.type]());
    if (SILENT.has(p.type)) continue;
    const M = PARTS[p.type], attrs = p.attrs || {};
    let type = M && (typeof M.type === 'function' ? M.type(attrs) : M.type), extra = null;
    if (type && typeof type === 'object') { extra = type.note; type = type.type; }
    const why = M && M.why ? M.why(attrs) : null;
    if (!type) { report.unknown.push({ id: p.id, type: p.type, why }); continue; }
    if (p.hide) continue; // composant masqué dans Wokwi (alimentation virtuelle…)
    if (why) report.notes.push(`${p.id} : ${why}`);
    if (extra) report.notes.push(`${p.id} : ${extra}`);
    count[type] = (count[type] || 0) + 1;
    const id = `${type}_${count[type]}`;
    const r = -((+p.rotate || 0) * Math.PI) / 180;
    const c = { id, type, x: ((+p.left || 0) + (M.w || 40) / 2) * PX, z: ((+p.top || 0) + (M.h || 40) / 2) * PX, r: Math.round(r * 1e4) / 1e4 };
    // Adresse I2C réglée dans Wokwi (écran OLED) : gardée sur le composant.
    if (type === 'oled' && attrs.i2cAddress) { const a = parseInt(attrs.i2cAddress, 16); if (a > 0 && a < 128) c.inp = { addr: a }; }
    comps.push(c);
    byWokwi.set(p.id, { comp: c, M });
  }
  report.parts = comps.length;

  // Conducteurs : une broche de composant, ou une bande de breadboard (qui relie toutes ses broches).
  const parent = new Map();
  const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const node = k => { if (!parent.has(k)) parent.set(k, k); return k; };
  const union = (a, b) => { const x = find(node(a)), y = find(node(b)); if (x !== y) parent.set(x, y); };
  /** Extrémité d'une connexion : { node, ref: [compId, pin] | null, color }. */
  function endOf(s) {
    const e = splitEnd(s); if (!e) return null;
    const [pid, pin] = e, w = byWokwi.get(pid);
    if (!w) return { missing: true, pid, pin };
    if (w.bb) { const st = stripOf(w.type, pin); return { node: `bb:${pid}:${st || pin}` }; }
    const key = w.M.pins[pin] ?? w.M.pins[pin.replace(/\.\d+$/, '')];
    if (!key) return { unmapped: true, pid, pin, comp: w.comp };
    return { node: `p:${w.comp.id}:${aliasOf(w.comp, key)}`, ref: [w.comp.id, key] };
  }
  const refs = new Map(), colors = [];
  for (const conn of Array.isArray(d.connections) ? d.connections : []) {
    if (!Array.isArray(conn) || conn.length < 2) continue;
    const a = endOf(conn[0]), b = endOf(conn[1]);
    const bad = [a, b].find(x => !x || x.unmapped || x.missing);
    if (bad) {
      // Fil vers un composant ignoré : la raison est déjà dans la liste des inconnus.
      if (bad.unmapped) report.dropped.push(tl('{0} : broche « {1} » sans équivalent ({2} — {3})', bad.pid, bad.pin, conn[0], conn[1]));
      continue;
    }
    union(a.node, b.node);
    for (const x of [a, b]) if (x.ref && !refs.has(x.node)) refs.set(x.node, x.ref);
    if (colorOf(conn[2])) colors.push([a.node, colorOf(conn[2])]);
  }
  // Conducteurs complets : broches reliées (directement ou par une breadboard de Wokwi), sans doublon.
  const nets = new Map();
  for (const [n, ref] of refs) {
    const root = find(n);
    if (!nets.has(root)) nets.set(root, []);
    const list = nets.get(root), comp = comps.find(c => c.id === ref[0]), k = aliasOf(comp, ref[1]);
    if (!list.some(r => r[0] === ref[0] && aliasOf(comp, r[1]) === k)) list.push(ref);
  }
  const netColor = new Map();
  for (const [n, col] of colors) if (!netColor.has(find(n))) netColor.set(find(n), col);
  const wires = routeNets([...nets].map(([root, list]) => ({ refs: list, color: netColor.get(root) })), comps);
  report.wires = wires.length;

  // Positions : recentrées sur la première carte (ou sur le montage), sans chevauchement grossier.
  const board = comps.find(c => BOARDS.has(c.type));
  const ox = board ? board.x : comps.reduce((s, c) => s + c.x, 0) / (comps.length || 1), oz = board ? board.z : comps.reduce((s, c) => s + c.z, 0) / (comps.length || 1);
  for (const c of comps) { c.x = Math.round((c.x - ox) * 10) / 10; c.z = Math.round((c.z - oz) * 10) / 10; }
  spread(comps);

  // Programme : à la première carte. Mode fidèle si l'interpréteur ne le comprend pas (Uno, Nano).
  const boards = {};
  const code = files['sketch.ino'] ?? Object.entries(files).find(([k]) => /\.ino$/i.test(k))?.[1];
  if (board && typeof code === 'string') {
    const res = compile(code, { board: board.type });
    const e = { code };
    if (!res.ok) {
      if (EMULATED.has(board.type)) { e.engine = 'firmware'; report.engine = 'firmware'; report.notes.push(tl('programme confié au mode fidèle (vrai compilateur) : l’interpréteur ne le comprend pas ({0})', res.errors[0] ? res.errors[0].msg : '')); }
      else report.notes.push(tl('le programme ne passe pas dans l’interpréteur, ligne {0} : {1}', res.errors[0] ? res.errors[0].line : 0, res.errors[0] ? res.errors[0].msg : ''));
    } else report.engine = 'interp';
    boards[board.id] = e;
  } else if (typeof code === 'string') report.notes.push(tl('programme ignoré : aucune carte reconnue dans le montage'));
  if (files['main.py'] != null) report.notes.push(tl('programme MicroPython (main.py) : pas encore pris en charge, le fichier est ignoré'));
  const extra = Object.keys(files).filter(k => /\.(h|hpp|c|cpp)$/i.test(k));
  if (extra.length) report.notes.push(tl('fichiers du programme ignorés (un seul fichier .ino par carte) : {0}', extra.join(', ')));
  if (files['libraries.txt']) {
    const libs = files['libraries.txt'].split(/\r?\n/).map(l => l.replace(/#.*/, '').trim()).filter(Boolean);
    if (libs.length) report.notes.push(tl('bibliothèques demandées : {0} (installées au premier lancement en mode fidèle si elles sont connues)', libs.join(', ')));
  }
  const project = { app: 'jollof-studio', version: 1, name, comps, wires, settings: { prog: { rules: [], boards } } };
  return { project, report };
}

/** Rayon approximatif d'un composant (mm) pour écarter ceux que la conversion a posés l'un sur l'autre. */
const RADIUS = { breadboard: 45, uno: 36, nano: 24, esp32: 28, nodemcu: 30, pico: 27, keypad: 35, lcd1602: 40, hcsr04: 23, relay: 15, l298n: 22 };
function spread(comps) {
  const rad = c => RADIUS[c.type] || (/^res-|^led-|^cap-|diode|button/.test(c.type) ? 6 : 12);
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let i = 0; i < comps.length; i++) for (let j = i + 1; j < comps.length; j++) {
      const a = comps[i], b = comps[j], dx = b.x - a.x, dz = b.z - a.z, dist = Math.hypot(dx, dz), need = (rad(a) + rad(b)) * 0.8;
      if (dist >= need) continue;
      const ux = dist ? dx / dist : 1, uz = dist ? dz / dist : 0, push = (need - dist) / 2 + 0.1;
      // La carte ne bouge pas : c'est le repère du montage.
      const fa = BOARDS.has(a.type) ? 0 : BOARDS.has(b.type) ? 2 : 1, fb = 2 - fa;
      a.x -= ux * push * fa; a.z -= uz * push * fa; b.x += ux * push * fb; b.z += uz * push * fb;
      moved = true;
    }
    if (!moved) break;
  }
  for (const c of comps) { c.x = Math.round(c.x * 10) / 10; c.z = Math.round(c.z * 10) / 10; }
}

const TEXT = /\.(json|ino|txt|toml|h|hpp|c|cpp|py|md)$/i;
/**
 * Fichiers choisis par l'utilisateur (diagram.json et sketch.ino, ou le .zip de Wokwi) → { nom de base : texte }.
 * Dans un .zip, seuls les fichiers texte du projet sont lus (dossiers ignorés : on garde le nom de base).
 */
export async function readProjectFiles(list) {
  const files = {};
  for (const f of list) {
    if (/\.zip$/i.test(f.name)) {
      const { unzipSync, strFromU8 } = await import('fflate');
      const entries = unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: e => TEXT.test(e.name) && e.originalSize < 2e6 });
      for (const [path, bytes] of Object.entries(entries)) { const base = path.split('/').pop(); if (base && !(base in files)) files[base] = strFromU8(bytes); }
    } else if (TEXT.test(f.name)) files[f.name] = await f.text();
  }
  return files;
}
