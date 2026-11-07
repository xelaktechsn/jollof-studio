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
  button: { lib: 'Switch', part: 'SW_Push', fp: 'Button_Switch_THT:SW_PUSH_6mm', pads: { 1: '1', 2: '2' }, value: 'Bouton' },
  pot: { lib: 'Device', part: 'R_Potentiometer', fp: 'Potentiometer_THT:Potentiometer_Bourns_3386P_Vertical', pads: { 1: '1', W: '2', 3: '3' }, value: '10k' },
  buzzer: { lib: 'Device', part: 'Buzzer', fp: 'Buzzer_Beeper:Buzzer_12x9.5RM7.6', pads: { '+': '1', '-': '2' }, value: 'Buzzer' },
  speaker: { lib: 'Device', part: 'Speaker', fp: PH(2), pads: { '+': '1', '-': '2' }, value: 'HP 8 Ω' },
  lm7805: { lib: 'Regulator_Linear', part: 'L7805', fp: 'Package_TO_SOT_THT:TO-220-3_Vertical', pads: { IN: '1', GND: '2', OUT: '3' }, value: 'LM7805' },
  bat9v: { lib: 'Device', part: 'Battery', fp: PH(2), pads: { '+': '1', '-': '2' }, value: '9V' },
  bat18650: { lib: 'Device', part: 'Battery_Cell', fp: PH(2), pads: { '+': '1', '-': '2' }, value: '18650' }
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
