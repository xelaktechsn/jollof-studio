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
  bat18650: { lib: 'Device', part: 'Battery_Cell', fp: PH(2), pads: { '+': '1', '-': '2' }, value: '18650' },
  // Lab analogique : brochage des boîtiers (DIP-8 du NE555 et du LM358, TO-220 G-D-S de l'IRLZ44N).
  ne555: { lib: 'Timer', part: 'NE555P', fp: 'Package_DIP:DIP-8_W7.62mm', pads: { GND: '1', TRIG: '2', OUT: '3', RESET: '4', CV: '5', THR: '6', DIS: '7', VCC: '8' }, value: 'NE555' },
  lm358: { lib: 'Amplifier_Operational', part: 'LM358', fp: 'Package_DIP:DIP-8_W7.62mm', pads: { '1OUT': '1', '1IN-': '2', '1IN+': '3', GND: '4', '2IN+': '5', '2IN-': '6', '2OUT': '7', VCC: '8' }, value: 'LM358' },
  irlz44n: { lib: 'Transistor_FET', part: 'IRLZ44N', fp: 'Package_TO_SOT_THT:TO-220-3_Vertical', pads: { G: '1', D: '2', S: '3' }, value: 'IRLZ44N' },
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
