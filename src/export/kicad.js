// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Export vers KiCad : la netlist du montage (format S-expression « E » de KiCad 6 à 9, que Pcbnew importe par
// Fichier → Importer → Netlist). Chaque composant reçoit une empreinte traversante courante de la bibliothèque
// standard de KiCad ; les cartes et les modules deviennent des connecteurs (une barrette au pas de 2,54 mm, une
// broche par broche du module, dans l'ordre de la fiche) : le circuit imprimé accueille le module enfiché.
// Les nœuds sont ceux du schéma (mêmes noms : GND, 5V, D13…), breadboards et fils de câblage ne comptent pas.
import { analyze } from '../sim/circuit.js';
import { boardOf, base } from '../sim/boards.js';
import { buildNets } from '../schematic/sheet.js';

const PH = n => `Connector_PinHeader_2.54mm:PinHeader_1x${String(n).padStart(2, '0')}_P2.54mm_Vertical`;
const RES = { lib: 'Device', part: 'R', fp: 'Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal', pads: { 1: '1', 2: '2' } };
const LED = { lib: 'Device', part: 'LED', fp: 'LED_THT:LED_D5.0mm', pads: { K: '1', A: '2' } };
/** Pastilles d'un boîtier ou d'une barrette : broches dans l'ordre des numéros. */
const padsOf = keys => Object.fromEntries(keys.map((k, i) => [k, String(i + 1)]));
const conn = (keys, value) => ({ lib: 'Connector', part: `Conn_01x${String(keys.length).padStart(2, '0')}`, fp: PH(keys.length), pads: padsOf(keys), value, connector: true });
const DIP16 = 'Package_DIP:DIP-16_W7.62mm';
const range = (p, n) => Array.from({ length: n }, (_, i) => p + i);
/**
 * Empreintes : bibliothèque et symbole de KiCad, empreinte, et broche → numéro de pastille (convention des
 * symboles de KiCad : cathode 1 pour LED et diode, + en 1 pour un condensateur chimique, E-B-C pour un TO-92).
 */
export const FOOTPRINTS = {
  'res-22': { ...RES, value: '22' }, 'res-220': { ...RES, value: '220' }, 'res-330': { ...RES, value: '330' },
  'res-1k': { ...RES, value: '1k' }, 'res-4k7': { ...RES, value: '4k7' }, 'res-10k': { ...RES, value: '10k' },
  'led-red': { ...LED, value: 'LED rouge' }, 'led-green': { ...LED, value: 'LED verte' }, 'led-blue': { ...LED, value: 'LED bleue' },
  'led-yellow': { ...LED, value: 'LED jaune' }, 'led-white': { ...LED, value: 'LED blanche' },
  'led-rgb': { lib: 'Device', part: 'LED_RGBC', fp: 'LED_THT:LED_D5.0mm-4_RGB', pads: { R: '1', GND: '2', G: '3', B: '4' }, value: 'LED RGB' },
  'cap-100n': { lib: 'Device', part: 'C', fp: 'Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P5.00mm', pads: { 1: '1', 2: '2' }, value: '100n' },
  'cap-100u': { lib: 'Device', part: 'C_Polarized', fp: 'Capacitor_THT:CP_Radial_D6.3mm_P2.50mm', pads: { '+': '1', '-': '2' }, value: '100u' },
  diode: { lib: 'Diode', part: '1N4007', fp: 'Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal', pads: { K: '1', A: '2' }, value: '1N4007' },
  npn: { lib: 'Transistor_BJT', part: '2N3904', fp: 'Package_TO_SOT_THT:TO-92_Inline', pads: { E: '1', B: '2', C: '3' }, value: '2N3904' },
  pn2222: { lib: 'Transistor_BJT', part: 'PN2222A', fp: 'Package_TO_SOT_THT:TO-92_Inline', pads: { E: '1', B: '2', C: '3' }, value: 'PN2222A' },
  // PNP : symbole 2N3906 (E-B-C, comme le 2N3904 du BC547), valeur du composant posé.
  pnp: { lib: 'Transistor_BJT', part: '2N3906', fp: 'Package_TO_SOT_THT:TO-92_Inline', pads: { E: '1', B: '2', C: '3' }, value: 'BC557' },
  pn2907: { lib: 'Transistor_BJT', part: '2N3906', fp: 'Package_TO_SOT_THT:TO-92_Inline', pads: { E: '1', B: '2', C: '3' }, value: 'PN2907A' },
  'zener-3v3': { lib: 'Device', part: 'D_Zener', fp: 'Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal', pads: { K: '1', A: '2' }, value: 'BZX55C3V3' },
  'zener-5v1': { lib: 'Device', part: 'D_Zener', fp: 'Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal', pads: { K: '1', A: '2' }, value: 'BZX55C5V1' },
  'zener-12v': { lib: 'Device', part: 'D_Zener', fp: 'Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal', pads: { K: '1', A: '2' }, value: 'BZX55C12' },
  button: { lib: 'Switch', part: 'SW_Push', fp: 'Button_Switch_THT:SW_PUSH_6mm', pads: { 1: '1', 2: '2' }, value: 'Bouton' },
  // Encodeur KY-040 : module en barrette, dans l'ordre de son connecteur (la télécommande infrarouge n'a rien à câbler).
  ky040: conn(['CLK', 'DT', 'SW', '+', 'GND'], 'KY-040 rotary encoder'),
  pot: { lib: 'Device', part: 'R_Potentiometer', fp: 'Potentiometer_THT:Potentiometer_Bourns_3386P_Vertical', pads: { 1: '1', W: '2', 3: '3' }, value: '10k' },
  buzzer: { lib: 'Device', part: 'Buzzer', fp: 'Buzzer_Beeper:Buzzer_12x9.5RM7.6', pads: { '+': '1', '-': '2' }, value: 'Buzzer' },
  speaker: { lib: 'Device', part: 'Speaker', fp: PH(2), pads: { '+': '1', '-': '2' }, value: 'HP 8 Ω' },
  lm7805: { lib: 'Regulator_Linear', part: 'L7805', fp: 'Package_TO_SOT_THT:TO-220-3_Vertical', pads: { IN: '1', GND: '2', OUT: '3' }, value: 'LM7805' },
  bat9v: { lib: 'Device', part: 'Battery', fp: PH(2), pads: { '+': '1', '-': '2' }, value: '9V' },
  bat18650: { lib: 'Device', part: 'Battery_Cell', fp: PH(2), pads: { '+': '1', '-': '2' }, value: '18650' },
  // Modules d'alimentation : un connecteur (le module s'enfiche ou se soude par ses pastilles), dans l'ordre entrée, sortie.
  ams1117: { lib: 'Connector', part: 'Conn_01x03', fp: PH(3), pads: { IN: '1', GND: '2', OUT: '3' }, value: 'AMS1117-3.3 module', connector: true },
  lm2596: { lib: 'Connector', part: 'Conn_01x04', fp: PH(4), pads: { 'IN+': '1', 'IN-': '2', 'OUT+': '3', 'OUT-': '4' }, value: 'LM2596 module', connector: true },
  mt3608: { lib: 'Connector', part: 'Conn_01x04', fp: PH(4), pads: { 'IN+': '1', 'IN-': '2', 'OUT+': '3', 'OUT-': '4' }, value: 'MT3608 module', connector: true },
  tp4056: { lib: 'Connector', part: 'Conn_01x06', fp: PH(6), pads: { 'IN+': '1', 'IN-': '2', 'B+': '3', 'B-': '4', 'OUT+': '5', 'OUT-': '6' }, value: 'TP4056 module', connector: true },
  solar6v: { lib: 'Device', part: 'Solar_Cell', fp: PH(2), pads: { '+': '1', '-': '2' }, value: 'Solar 6V 1W' },
  // Lab analogique : brochage des boîtiers (DIP-8 du NE555 et du LM358, TO-220 G-D-S de l'IRLZ44N).
  ne555: { lib: 'Timer', part: 'NE555P', fp: 'Package_DIP:DIP-8_W7.62mm', pads: { GND: '1', TRIG: '2', OUT: '3', RESET: '4', CV: '5', THR: '6', DIS: '7', VCC: '8' }, value: 'NE555' },
  lm358: { lib: 'Amplifier_Operational', part: 'LM358', fp: 'Package_DIP:DIP-8_W7.62mm', pads: { '1OUT': '1', '1IN-': '2', '1IN+': '3', GND: '4', '2IN+': '5', '2IN-': '6', '2OUT': '7', VCC: '8' }, value: 'LM358' },
  irlz44n: { lib: 'Transistor_FET', part: 'IRLZ44N', fp: 'Package_TO_SOT_THT:TO-220-3_Vertical', pads: { G: '1', D: '2', S: '3' }, value: 'IRLZ44N' },
  irf9540n: { lib: 'Transistor_FET', part: 'IRF9540N', fp: 'Package_TO_SOT_THT:TO-220-3_Vertical', pads: { G: '1', D: '2', S: '3' }, value: 'IRF9540N' },
  // Circuits logiques : DIP-16 (symboles 74xx de KiCad, brochage standard) ; modules en barrette, dans l'ordre du module.
  hc595: { lib: '74xx', part: '74HC595', fp: DIP16, pads: padsOf(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'GND', 'Q7S', 'MR', 'SHCP', 'STCP', 'OE', 'DS', 'Q0', 'VCC']), value: '74HC595' },
  hc165: { lib: '74xx', part: '74HC165', fp: DIP16, pads: padsOf(['PL', 'CP', 'D4', 'D5', 'D6', 'D7', 'Q7N', 'GND', 'Q7', 'DS', 'D0', 'D1', 'D2', 'D3', 'CE', 'VCC']), value: '74HC165' },
  mcp23017: conn(['VCC', 'GND', 'SCL', 'SDA', 'RST', 'INTA', 'INTB', 'A0', 'A1', 'A2', ...range('GPA', 8), ...range('GPB', 8)], 'MCP23017 module'),
  pcf8574: conn(['GND', 'VCC', 'SDA', 'SCL', 'INT', 'A0', 'A1', 'A2', ...range('P', 8)], 'PCF8574 module'),
  pca9685: conn(['GND', 'OE', 'SCL', 'SDA', 'VCC', 'V+', ...range('PWM', 16)], 'PCA9685 module'),
  // Pilotes de moteurs : L293D en DIP-16 (symbole Driver_Motor de KiCad, brochage TI) ; cartes et moteur en barrette.
  l293d: { lib: 'Driver_Motor', part: 'L293D', fp: DIP16, pads: padsOf(['EN12', 'IN1', 'OUT1', 'GND', 'GND (2)', 'OUT2', 'IN2', 'VCC2', 'EN34', 'IN3', 'OUT3', 'GND (3)', 'GND (4)', 'OUT4', 'IN4', 'VCC1']), value: 'L293D' },
  tb6612: conn(['PWMA', 'AIN2', 'AIN1', 'STBY', 'BIN1', 'BIN2', 'PWMB', 'GND', 'VM', 'VCC', 'GND (2)', 'AO1', 'AO2', 'BO2', 'BO1', 'GND (3)'], 'TB6612FNG module'),
  a4988: conn(['ENABLE', 'MS1', 'MS2', 'MS3', 'RESET', 'SLEEP', 'STEP', 'DIR', 'VMOT', 'GND', '2B', '2A', '1A', '1B', 'VDD', 'GND (2)'], 'A4988 Pololu'),
  drv8825: conn(['ENABLE', 'M0', 'M1', 'M2', 'RESET', 'SLEEP', 'STEP', 'DIR', 'VMOT', 'GND', 'B2', 'B1', 'A1', 'A2', 'FAULT', 'GND (2)'], 'DRV8825 Pololu'),
  nema17: conn(['A+', 'A-', 'B+', 'B-'], 'NEMA17 17HS4401'),
  // Afficheurs, écrans, horloges et mémoires : modules en barrette, dans l'ordre de leurs connecteurs.
  max7219m: conn(['VCC', 'GND', 'DIN', 'CS', 'CLK', 'VCC (2)', 'GND (2)', 'DOUT', 'CS (2)', 'CLK (2)'], 'MAX7219 8x8 matrix module'),
  max7219s: conn(['VCC', 'GND', 'DIN', 'CS', 'CLK', 'VCC (2)', 'GND (2)', 'DOUT', 'CS (2)', 'CLK (2)'], 'MAX7219 8-digit module'),
  tm1637: conn(['CLK', 'DIO', 'VCC', 'GND'], 'TM1637 4-digit module'),
  lcd2004: conn(['GND', 'VCC', 'SDA', 'SCL'], 'LCD 2004 I2C'),
  st7735: conn(['VCC', 'GND', 'CS', 'RESET', 'DC', 'SDA', 'SCK', 'LED'], 'ST7735 1.8in TFT'),
  ili9341: conn(['VCC', 'GND', 'CS', 'RESET', 'DC', 'MOSI', 'SCK', 'LED', 'MISO'], 'ILI9341 2.8in TFT'),
  ds3231: conn(['32K', 'SQW', 'SCL', 'SDA', 'VCC', 'GND'], 'DS3231 ZS-042'),
  ds1307: conn(['SQW', 'DS', 'SCL', 'SDA', 'VCC', 'GND'], 'DS1307 Tiny RTC'),
  at24c256: conn(['VCC', 'GND', 'SCL', 'SDA', 'WP', 'A0', 'A1', 'A2'], 'AT24C256 module'),
  sdcard: conn(['GND', 'VCC', 'MISO', 'MOSI', 'SCK', 'CS'], 'MicroSD SPI module'),
  // Capteurs I2C : modules en barrette, dans l'ordre de leurs connecteurs.
  vl53l0x: conn(['VIN', 'GND', 'SCL', 'SDA', 'GPIO1', 'XSHUT'], 'VL53L0X GY-VL53L0XV2'),
  max30102: conn(['VIN', 'SDA', 'SCL', 'INT', 'IRD', 'RD', 'GND'], 'MAX30102 module'),
  tcs34725: conn(['LED', 'INT', 'SDA', 'SCL', '3V3', 'GND', 'VIN'], 'TCS34725 module'),
  ccs811: conn(['VCC', 'GND', 'SCL', 'SDA', 'WAKE', 'INT', 'RST', 'ADDR'], 'CCS811 CJMCU-811'),
  bme680: conn(['VCC', 'GND', 'SCL', 'SDA', 'SDO', 'CS'], 'BME680 GY-BME680'),
  // Capteur de courant et modules série : connecteur dans l'ordre du module (bornier du primaire compris pour l'ACS712).
  acs712: conn(['VCC', 'OUT', 'GND', 'IP+', 'IP-'], 'ACS712 current sensor module'),
  neo6m: conn(['VCC', 'RX', 'TX', 'GND'], 'GY-NEO6MV2 GPS'),
  hc12: conn(['VCC', 'GND', 'RXD', 'TXD', 'SET'], 'HC-12 433MHz'),
  max485: conn(['RO', 'RE', 'DE', 'DI', 'VCC', 'B', 'A', 'GND'], 'MAX485 RS-485 module'),
  sx1278: conn(['GND', '3.3V', 'RST', 'DIO0', 'NSS', 'MOSI', 'MISO', 'SCK', 'DIO1', 'DIO2'], 'SX1278 Ra-02 LoRa module'),
  'ind-10m': { lib: 'Device', part: 'L', fp: 'Inductor_THT:L_Axial_L9.5mm_D4.0mm_P15.24mm_Horizontal', pads: { 1: '1', 2: '2' }, value: '10m' }
};

const q = s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
/** Horodatage stable d'un composant (KiCad relie schéma et circuit imprimé par lui) : un UUID tiré de son identifiant. */
function uuidOf(id) {
  let h = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  for (const ch of String(id)) h = h.map((x, i) => Math.imul(x ^ ch.charCodeAt(0), 16777619 + i * 2) >>> 0);
  const hex = h.map(x => x.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
/** Repère KiCad : lettres et chiffres, unique (« UNO », « R1 », « LED1 »…). */
function refsOf(comps) {
  const seen = new Set(), out = new Map();
  for (const c of comps) {
    let r = String(c.name || c.id).replace(/[^\w+-]/g, '') || 'U';
    for (let i = 2; seen.has(r); i++) r = `${r.replace(/_\d+$/, '')}_${i}`;
    seen.add(r); out.set(c, r);
  }
  return out;
}
/** Empreinte d'un composant : celle de la table, sinon un connecteur d'autant de broches que le module. */
export function footprintOf(c) {
  const f = FOOTPRINTS[c.type];
  if (f) return f;
  const keys = Object.keys(c.pins || {});
  return { lib: 'Connector', part: `Conn_01x${String(keys.length).padStart(2, '0')}`, fp: PH(keys.length), pads: Object.fromEntries(keys.map((k, i) => [k, String(i + 1)])), connector: true };
}

/**
 * Netlist KiCad du montage. o : { comps, wires, netNames, title, describe(c) → { title }, date }.
 * Rend le texte du fichier .net.
 */
export function kicadNetlist(o) {
  const comps = o.comps.filter(c => !/^breadboard/.test(c.type) && Object.keys(c.pins || {}).length);
  const A = analyze(o.comps, o.wires, { open: true });
  const { nets } = buildNets(comps, A, o.netNames || {});
  const refs = refsOf(comps), title = o.title || 'circuit', date = o.date || new Date().toISOString().slice(0, 10);
  const L = [];
  L.push(`(export (version "E")`);
  L.push(`  (design (source ${q(title + '.jollof')}) (date ${q(date)}) (tool "Jollof Studio")`);
  L.push(`    (sheet (number "1") (name "/") (tstamps "/") (title_block (title ${q(title)}) (company "") (rev "") (date ${q(date)}) (source ${q(title + '.jollof')}))))`);
  L.push('  (components');
  for (const c of comps) {
    const f = footprintOf(c), desc = o.describe ? o.describe(c).title : c.type;
    const value = f.value || (boardOf(c) ? boardOf(c).label : desc);
    L.push(`    (comp (ref ${q(refs.get(c))}) (value ${q(value)}) (footprint ${q(f.fp)}) (description ${q(desc)})`);
    // Connecteur d'un module : la correspondance pastille → broche, pour câbler le module dans le bon sens.
    if (f.connector) L.push(`      (fields (field (name "Brochage") ${q(Object.entries(f.pads).map(([k, n]) => `${n}=${base(k)}`).join(' '))}))`);
    L.push(`      (libsource (lib ${q(f.lib)}) (part ${q(f.part)}) (description ${q(desc)})) (sheetpath (names "/") (tstamps "/")) (tstamps ${q(uuidOf(c.id))}))`);
  }
  L.push('  )');
  L.push('  (nets');
  let code = 0;
  for (const n of nets) {
    const pins = n.pins.filter(p => refs.has(p.comp));
    if (pins.length < 2) continue;
    L.push(`    (net (code ${q(++code)}) (name ${q(n.name === 'COURT-CIRCUIT' ? 'SHORT' : n.name)}) (class "Default")`);
    for (const p of pins) {
      const f = footprintOf(p.comp), pad = f.pads[p.key] || f.pads[base(p.key)];
      if (!pad) continue;
      L.push(`      (node (ref ${q(refs.get(p.comp))}) (pin ${q(pad)}) (pinfunction ${q(base(p.key))}) (pintype "passive"))`);
    }
    L.push('    )');
  }
  L.push('  )');
  L.push(')');
  return L.join('\n') + '\n';
}

/** Lecture d'une S-expression (pour les tests et l'aller-retour) : listes imbriquées de chaînes. */
export function parseSexpr(text) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  function item() {
    ws();
    if (text[i] === '(') {
      i++; const out = [];
      for (;;) { ws(); if (text[i] === ')') { i++; return out; } if (i >= text.length) throw new Error('parenthèse non fermée'); out.push(item()); }
    }
    if (text[i] === '"') {
      i++; let s = '';
      while (text[i] !== '"') { if (i >= text.length) throw new Error('chaîne non fermée'); if (text[i] === '\\') i++; s += text[i++]; }
      i++; return s;
    }
    const m = /^[^\s()"]+/.exec(text.slice(i)); if (!m) throw new Error(`caractère inattendu à ${i}`);
    i += m[0].length; return m[0];
  }
  const r = item(); ws();
  if (i < text.length) throw new Error('texte après la fin');
  return r;
}

/* ---------- Schéma KiCad (.kicad_sch) ---------- */
// Chaque composant devient un bloc rectangulaire (symbole « Jollof:<type> » inclus dans le fichier), broches à
// gauche et à droite, numérotées comme les pastilles de son empreinte : « Mettre à jour le PCB depuis le schéma »
// retrouve la netlist ci-dessus. Les liaisons passent par des étiquettes au nom du nœud (GND, 5V, D13…) posées au
// bout de chaque broche : même nom, même fil pour KiCad. La disposition suit celle du tapis de montage.
const G = 2.54, F = '(effects (font (size 1.27 1.27)))';
const snap = v => Math.round(v / G) * G, mm = v => +v.toFixed(2);
/** Bloc d'un composant : broches réparties à gauche puis à droite, rangées au pas de 2,54 mm. */
function blockOf(c) {
  const f = footprintOf(c), keys = Object.keys(c.pins || {}).filter(k => f.pads[k] || f.pads[base(k)]);
  const half = Math.ceil(keys.length / 2), rows = Math.max(half, 1), w = Math.max(4, Math.ceil(Math.max(...keys.map(k => base(k).length), 1) * 1.6 / G)) * G;
  const pins = keys.map((k, i) => {
    const left = i < half, row = left ? i : i - half;
    return { key: k, num: f.pads[k] || f.pads[base(k)], name: base(k), x: left ? -w / 2 - G : w / 2 + G, y: -((rows - 1) * G) / 2 + row * G, angle: left ? 0 : 180 };
  });
  return { f, pins, w, h: rows * G + G };
}

/**
 * Schéma KiCad du montage. o : comme kicadNetlist. Rend le texte du fichier .kicad_sch (KiCad 8, format 20231120).
 */
export function kicadSchematic(o) {
  const comps = o.comps.filter(c => !/^breadboard/.test(c.type) && Object.keys(c.pins || {}).length);
  const A = analyze(o.comps, o.wires, { open: true });
  const { of } = buildNets(comps, A, o.netNames || {});
  const refs = refsOf(comps), title = o.title || 'circuit', root = uuidOf('root:' + title);
  const blocks = new Map(comps.map(c => [c, blockOf(c)]));
  // Place : celle du tapis (mm), resserrée, puis écartée jusqu'à ce que les blocs (et leurs étiquettes) ne se touchent plus.
  const pos = new Map(comps.map(c => [c, [((c.group && c.group.position.x) || 0) * 0.9, ((c.group && c.group.position.z) || 0) * 0.9]]));
  const box = c => { const b = blocks.get(c), [x, y] = pos.get(c); return [x - b.w / 2 - 16, y - b.h / 2 - 3, x + b.w / 2 + 16, y + b.h / 2 + 3]; };
  for (let it = 0; it < 200; it++) {
    let moved = false;
    for (let i = 0; i < comps.length; i++) for (let j = i + 1; j < comps.length; j++) {
      const a = box(comps[i]), b = box(comps[j]);
      if (a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]) continue;
      const pa = pos.get(comps[i]), pb = pos.get(comps[j]), dx = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), dy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      if (dx < dy) { const s = pa[0] <= pb[0] ? 1 : -1; pa[0] -= s * dx / 2 + s * 0.5; pb[0] += s * dx / 2 + s * 0.5; }
      else { const s = pa[1] <= pb[1] ? 1 : -1; pa[1] -= s * dy / 2 + s * 0.5; pb[1] += s * dy / 2 + s * 0.5; }
      moved = true;
    }
    if (!moved) break;
  }
  // Repère de la feuille A3 paysage : tout ramené dans le cadre, sur la grille.
  const all = comps.map(box), x0 = Math.min(...all.map(b => b[0]), 0), y0 = Math.min(...all.map(b => b[1]), 0);
  for (const c of comps) { const p = pos.get(c); p[0] = snap(p[0] - x0 + 25.4); p[1] = snap(p[1] - y0 + 25.4); }

  const L = [];
  L.push(`(kicad_sch (version 20231120) (generator "jollof_studio") (generator_version "1.0") (uuid ${q(root)}) (paper "A3")`);
  L.push(`  (title_block (title ${q(title)}) (date ${q(o.date || new Date().toISOString().slice(0, 10))}) (comment 1 "Jollof Studio"))`);
  L.push('  (lib_symbols');
  const done = new Set();
  for (const c of comps) {
    const id = `Jollof:${c.type}`; if (done.has(id)) continue; done.add(id);
    const b = blocks.get(c), sym = c.type.replace(/[^\w-]/g, '_');
    L.push(`    (symbol ${q(id)} (pin_names (offset 1.016)) (exclude_from_sim no) (in_bom yes) (on_board yes)`);
    L.push(`      (property "Reference" "U" (at 0 ${mm(-b.h / 2 - 1.27)} 0) ${F})`);
    L.push(`      (property "Value" ${q(c.type)} (at 0 ${mm(b.h / 2 + 1.27)} 0) ${F})`);
    L.push(`      (property "Footprint" ${q(b.f.fp)} (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))`);
    L.push(`      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))`);
    L.push(`      (symbol ${q(sym + '_0_1')} (rectangle (start ${mm(-b.w / 2)} ${mm(-b.h / 2)}) (end ${mm(b.w / 2)} ${mm(b.h / 2)}) (stroke (width 0.254) (type default)) (fill (type background))))`);
    L.push(`      (symbol ${q(sym + '_1_1')}`);
    // Dans la bibliothèque, l'axe Y monte : on retourne les rangées pour garder l'ordre de haut en bas.
    for (const p of b.pins) L.push(`        (pin passive line (at ${mm(p.x)} ${mm(-p.y)} ${p.angle}) (length ${G}) (name ${q(p.name)} ${F}) (number ${q(p.num)} ${F}))`);
    L.push('      )');
    L.push('    )');
  }
  L.push('  )');
  for (const c of comps) {
    const b = blocks.get(c), [x, y] = pos.get(c), ref = refs.get(c), f = b.f;
    const value = f.value || (boardOf(c) ? boardOf(c).label : o.describe ? o.describe(c).title : c.type);
    L.push(`  (symbol (lib_id ${q('Jollof:' + c.type)}) (at ${mm(x)} ${mm(y)} 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid ${q(uuidOf(c.id))})`);
    L.push(`    (property "Reference" ${q(ref)} (at ${mm(x)} ${mm(y - b.h / 2 - 1.27)} 0) ${F})`);
    L.push(`    (property "Value" ${q(value)} (at ${mm(x)} ${mm(y + b.h / 2 + 1.27)} 0) ${F})`);
    L.push(`    (property "Footprint" ${q(f.fp)} (at ${mm(x)} ${mm(y)} 0) (effects (font (size 1.27 1.27)) (hide yes)))`);
    for (const p of b.pins) L.push(`    (pin ${q(p.num)} (uuid ${q(uuidOf(c.id + '#' + p.num))}))`);
    L.push(`    (instances (project ${q(title)} (path ${q('/' + root)} (reference ${q(ref)}) (unit 1))))`);
    L.push('  )');
    // Étiquette au bout de chaque broche reliée ; croix « non connectée » sinon.
    for (const p of b.pins) {
      const ex = mm(x + p.x), ey = mm(y + p.y), net = of({ comp: c, key: p.key });
      if (net && net.pins.length > 1) {
        const name = net.name === 'COURT-CIRCUIT' ? 'SHORT' : net.name;
        L.push(`  (label ${q(name)} (at ${ex} ${ey} 0) (effects (font (size 1.27 1.27)) (justify ${p.angle ? 'left' : 'right'} bottom)) (uuid ${q(uuidOf(c.id + '#L' + p.num))}))`);
      } else L.push(`  (no_connect (at ${ex} ${ey}) (uuid ${q(uuidOf(c.id + '#N' + p.num))}))`);
    }
  }
  L.push('  (sheet_instances (path "/" (page "1")))');
  L.push(')');
  return L.join('\n') + '\n';
}
