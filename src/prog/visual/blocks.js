// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Blocs de Jollof Studio pour Blockly : définitions (libellés via tl), boîte à outils, couleurs.
// Blockly est reçu en paramètre (chargé à la demande par load.js) : ce module reste léger.
import { tl } from '../../i18n/index.js';
import { B, F } from './types.js';

/** Couleur de chaque catégorie (lisibles sur le fond sombre, texte blanc). */
export const STYLE = {
  events: '#c9a227', pins: '#2f7ed8', time: '#1f9cad', logic: '#3f9a5c', loops: '#d4782b', math: '#5b63c9',
  text: '#8b5cc4', variables: '#c4506e', serial: '#3e8f8a', sound: '#b2549f', servo: '#6f6ad6', montage: '#e0703a'
};

// Contexte de la carte affichée (visualContext) : les menus le lisent à chaque ouverture.
let CTX = { board: { adcMax: 1023 }, pins: [], comps: [], colors: [] };
const NAMES = new Map(); // libellés déjà vus (composants, actions, mesures) : pour une valeur qui n'existe plus
let defined = null, Menu = null;

function setContext(ctx) {
  if (!ctx) return;
  CTX = ctx;
  ctx.comps.forEach(c => { NAMES.set(c.id, c.name); [...c.acts, ...c.sigs].forEach(x => NAMES.set(x.key, x.label)); });
}
const compById = id => CTX.comps.find(c => c.id === id) || null;
const compOf = field => { const b = field.getSourceBlock(); return b ? compById(b.getFieldValue(F.COMP)) : null; };
/** La valeur choisie reste dans le menu même si elle n'existe plus (le générateur l'explique). */
function keep(field, list) {
  const v = field.getValue();
  if (v && !list.some(o => o[1] === v)) list.push([`⚠ ${NAMES.get(v) || v}`, v]);
  return list.length ? list : [[tl('(aucun)'), '']];
}
const pinMenu = cap => function () { return keep(this, CTX.pins.filter(p => p.caps.includes(cap)).map(p => [p.label, p.key])); };
const compMenu = ok => function () { return keep(this, CTX.comps.filter(ok).map(c => [c.name, c.id])); };
const sigMenu = bool => function () { const c = compOf(this); return keep(this, c ? c.sigs.filter(s => (s.kind === 'bool') === bool).map(s => [s.label, s.key]) : []); };
const MENUS = {
  out: pinMenu('out'), in: pinMenu('in'), adc: pinMenu('adc'), pwm: pinMenu('pwm'),
  compAct: compMenu(c => c.acts.length > 0), compNum: compMenu(c => c.sigs.some(s => s.kind !== 'bool')), compBool: compMenu(c => c.sigs.some(s => s.kind === 'bool')),
  sigNum: sigMenu(false), sigBool: sigMenu(true),
  act() { const c = compOf(this); return keep(this, c ? c.acts.map(a => [a.label, a.key]) : []); },
  color() { return keep(this, CTX.colors.map(([l, v]) => [l, v])); }
};

const menu = (name, m) => ({ type: 'field_jollof_menu', name, menu: m });
const val = (name, check) => ({ type: 'input_value', name, ...(check && { check }) });
const stmt = { previousStatement: null, nextStatement: null, inputsInline: true };
const hat = (type, label, args = []) => ({ type, message0: label, args0: args, message1: '%1', args1: [{ type: 'input_statement', name: F.DO }], style: 'jollof_events' });
function defs() {
  return [
    { ...hat(B.SETUP, tl('au démarrage')), tooltip: tl('Une seule fois, quand la carte démarre : setup().') },
    { ...hat(B.LOOP, tl('en boucle')), tooltip: tl('Sans fin, encore et encore : loop().') },
    { ...hat(B.EVERY, tl('toutes les %1 ms'), [{ type: 'field_number', name: F.MS, value: 1000, min: 1, precision: 1 }]), tooltip: tl('Régulièrement, sans bloquer le reste du programme (millis()).') },
    { type: B.DWRITE, message0: tl('mettre la broche %1 à %2'), args0: [menu(F.PIN, 'out'), val(F.STATE)], ...stmt, style: 'jollof_pins', tooltip: 'digitalWrite()' },
    { type: B.LEVEL, message0: '%1', args0: [{ type: 'field_dropdown', name: F.LEVEL, options: [[tl('HAUT (HIGH)'), 'HIGH'], [tl('BAS (LOW)'), 'LOW']] }], output: 'Number', style: 'jollof_pins', tooltip: tl('HIGH : tension de la carte, LOW : 0 V.') },
    { type: B.DREAD, message0: tl('lire la broche %1'), args0: [menu(F.PIN, 'in')], output: 'Number', style: 'jollof_pins', tooltip: tl('digitalRead() : HIGH ou LOW.') },
    { type: B.AREAD, message0: tl('lire la valeur analogique de %1'), args0: [menu(F.PIN, 'adc')], output: 'Number', style: 'jollof_pins', tooltip: tl('analogRead() : de 0 à 1023 (UNO, Nano, ESP8266, Pico) ou 4095 (ESP32).') },
    { type: B.AWRITE, message0: tl('régler la broche PWM %1 à %2'), args0: [menu(F.PIN, 'pwm'), val(F.VALUE, 'Number')], ...stmt, style: 'jollof_pins', tooltip: tl('analogWrite() : de 0 (éteint) à 255 (au maximum).') },
    { type: B.DELAY, message0: tl('attendre %1 ms'), args0: [val(F.MS, 'Number')], ...stmt, style: 'jollof_time', tooltip: tl('delay() : la carte ne fait rien d’autre pendant ce temps.') },
    { type: B.MILLIS, message0: tl('millisecondes depuis le démarrage'), output: 'Number', style: 'jollof_time', tooltip: 'millis()' },
    { type: B.MAP, message0: tl('convertir %1 de %2 – %3 vers %4 – %5'), args0: [val(F.VALUE, 'Number'), val(F.FROM_LOW, 'Number'), val(F.FROM_HIGH, 'Number'), val(F.TO_LOW, 'Number'), val(F.TO_HIGH, 'Number')], inputsInline: true, output: 'Number', style: 'math_blocks', tooltip: 'map()' },
    { type: B.CONSTRAIN, message0: tl('limiter %1 entre %2 et %3'), args0: [val(F.VALUE, 'Number'), val(F.LOW, 'Number'), val(F.HIGH, 'Number')], inputsInline: true, output: 'Number', style: 'math_blocks', tooltip: 'constrain()' },
    { type: B.PRINT, message0: tl('écrire %1 sur le moniteur série'), args0: [val(F.VALUE)], ...stmt, style: 'jollof_serial', tooltip: 'Serial.print()' },
    { type: B.PRINTLN, message0: tl('écrire %1 et passer à la ligne'), args0: [val(F.VALUE)], ...stmt, style: 'jollof_serial', tooltip: 'Serial.println()' },
    { type: B.PLOT, message0: tl('tracer %1 : %2'), args0: [{ type: 'field_input', name: F.LABEL, text: tl('valeur') }, val(F.VALUE, 'Number')], ...stmt, style: 'jollof_serial', tooltip: tl('Une courbe du traceur série : écrit « nom:valeur ».') },
    { type: B.TONE, message0: tl('jouer %1 Hz sur %2'), args0: [val(F.FREQ, 'Number'), menu(F.PIN, 'out')], ...stmt, style: 'jollof_sound', tooltip: 'tone()' },
    { type: B.NOTONE, message0: tl('arrêter le son sur %1'), args0: [menu(F.PIN, 'out')], ...stmt, style: 'jollof_sound', tooltip: 'noTone()' },
    { type: B.SERVO, message0: tl('servo sur %1 : tourner à %2 °'), args0: [menu(F.PIN, 'out'), val(F.ANGLE, 'Number')], ...stmt, style: 'jollof_servo', tooltip: tl('servo.write() : angle de 0 à 180°.') },
    { type: B.SIG_NUM, message0: '%1 %2', args0: [menu(F.COMP, 'compNum'), menu(F.SIG, 'sigNum')], output: 'Number', style: 'jollof_montage', extensions: ['jollof_sig_sync'], tooltip: tl('Mesure d’un capteur du montage.') },
    { type: B.SIG_BOOL, message0: '%1 %2', args0: [menu(F.COMP, 'compBool'), menu(F.SIG, 'sigBool')], output: 'Boolean', style: 'jollof_montage', extensions: ['jollof_sig_sync'], tooltip: tl('Vrai ou faux, selon le composant.') }
  ];
}

/** Définit les blocs (une fois par instance de Blockly) et retient le contexte de la carte. */
export function defineBlocks(Blockly, ctx) {
  setContext(ctx);
  if (defined === Blockly) return;
  defined = Blockly;
  Menu = class extends Blockly.FieldDropdown {
    doClassValidation_(v) { return v == null ? null : String(v); }
    getOptions() { return super.getOptions(false); } // menu recalculé : le montage a pu changer
    static fromJson(o) { return new this(MENUS[o.menu]); }
  };
  Blockly.fieldRegistry.register('field_jollof_menu', Menu);
  // Changer de composant : la mesure choisie doit exister pour lui.
  Blockly.Extensions.register('jollof_sig_sync', function () {
    const bool = this.type === B.SIG_BOOL;
    this.setOnChange(function (e) {
      if (e.type !== Blockly.Events.BLOCK_CHANGE || e.blockId !== this.id || e.name !== F.COMP) return;
      const c = compById(e.newValue), ok = c ? c.sigs.filter(s => (s.kind === 'bool') === bool) : [];
      if (ok.length && !ok.some(s => s.key === this.getFieldValue(F.SIG))) this.setFieldValue(ok[0].key, F.SIG);
    });
  });
  Blockly.common.defineBlocksWithJsonArray(defs());
  // Action d'un composant : sa forme (réglage nombre, texte ou couleur, unité) dépend de l'action.
  Blockly.Blocks[B.ACT] = {
    init() {
      this.appendDummyInput('HEAD').appendField(new Menu(MENUS.compAct), F.COMP).appendField(new Menu(MENUS.act), F.ACT);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setInputsInline(true);
      this.setStyle('jollof_montage'); this.setTooltip(tl('Action d’un composant relié à la carte.'));
      this.arg_ = null;
      this.setOnChange(function (e) {
        if (e.type !== Blockly.Events.BLOCK_CHANGE || e.blockId !== this.id || e.element !== 'field') return;
        const c = compById(this.getFieldValue(F.COMP)); if (!c) return;
        if (e.name === F.COMP && !c.acts.some(a => a.key === this.getFieldValue(F.ACT))) { this.setFieldValue(c.acts[0].key, F.ACT); return; }
        const a = c.acts.find(x => x.key === this.getFieldValue(F.ACT));
        if (a && (e.name === F.ACT || e.name === F.COMP)) this.shape_(a.arg ? { kind: a.arg.kind, unit: a.arg.unit || '' } : null, e.name === F.ACT && a.arg ? a.arg.def : undefined);
      });
    },
    saveExtraState() { return this.arg_ ? { arg: this.arg_.kind, unit: this.arg_.unit } : null; },
    loadExtraState(s) { this.shape_(s && s.arg ? { kind: s.arg, unit: s.unit || '' } : null); },
    shape_(arg, def) {
      const kind = arg && arg.kind;
      if ((this.arg_ && this.arg_.kind) !== kind) {
        const old = this.getInput(F.ARG), t = old && old.connection.targetBlock();
        if (t && !t.isShadow()) t.unplug(true); // les blocs de l'élève restent sur l'espace de travail
        if (old) this.removeInput(F.ARG);
        if (this.getInput('COLORS')) this.removeInput('COLORS');
        if (kind === 'color') this.appendDummyInput('COLORS').appendField(new Menu(MENUS.color), F.COLOR);
        else if (kind) this.appendValueInput(F.ARG).setCheck(kind === 'num' ? 'Number' : null);
      }
      if (this.getInput('UNIT')) this.removeInput('UNIT');
      if (arg && arg.unit) this.appendDummyInput('UNIT').appendField(arg.unit);
      const inp = this.getInput(F.ARG);
      if (inp && (def !== undefined || (!inp.connection.targetBlock() && !this.isDeadOrDying()))) {
        inp.connection.setShadowState(kind === 'num' ? { type: 'math_number', fields: { NUM: def ?? 0 } } : { type: 'text', fields: { TEXT: def ?? '' } });
      }
      if (kind === 'color' && def) this.setFieldValue(def, F.COLOR);
      this.arg_ = arg ? { kind, unit: arg.unit || '' } : null;
    }
  };
}

/** Recalcule le libellé des menus (« D7 (LED1) ») après un changement du montage. */
export function relabel(Blockly, ws) {
  if (!Menu) return;
  Blockly.Events.disable();
  try {
    for (const b of ws.getAllBlocks(false)) for (const inp of b.inputList) for (const f of inp.fieldRow) {
      if (!(f instanceof Menu)) continue;
      const v = f.getValue(); f.setValue('\u0000'); f.setValue(v);
    }
  } finally { Blockly.Events.enable(); }
}

/** Boîte à outils de la carte : catégories, avec les broches et composants du montage. */
export function toolbox(ctx) {
  // Broche proposée : celle du composant attendu (LED, bouton…), sinon une broche libre.
  const pick = (cap, re) => { const ps = ctx.pins.filter(p => p.caps.includes(cap)); return (ps.find(p => p.types.some(t => re.test(t))) || ps.find(p => !p.types.length && !p.caps.includes('uart0')) || ps[0] || { key: '' }).key; };
  const N = v => ({ shadow: { type: 'math_number', fields: { NUM: v } } });
  const T = v => ({ shadow: { type: 'text', fields: { TEXT: v } } });
  const L = v => ({ shadow: { type: B.LEVEL, fields: { LEVEL: v } } });
  const blk = (type, fields, inputs, extra) => ({ kind: 'block', type, ...(fields && { fields }), ...(inputs && { inputs }), ...extra });
  const cat = (name, style, contents) => ({ kind: 'category', name, categorystyle: style, contents });
  const out = pick('out', /^led|relay|buzzer/), max = ctx.board.adcMax || 1023, colors = ctx.colors.map(c => c[1]);
  const montage = !ctx.comps.length ? [{ kind: 'label', text: tl('Aucun composant relié à cette carte') }] : ctx.comps.flatMap(c => [
    { kind: 'label', text: c.name },
    ...c.acts.map(a => {
      const k = a.arg && a.arg.kind;
      if (k === 'color') return blk(B.ACT, { COMP: c.id, ACT: a.key, COLOR: colors.includes(a.arg.def) ? a.arg.def : colors[0] }, null, { extraState: { arg: 'color', unit: '' } });
      return blk(B.ACT, { COMP: c.id, ACT: a.key }, k ? { ARG: k === 'num' ? N(a.arg.def) : T(a.arg.def) } : null, k ? { extraState: { arg: k, unit: a.arg.unit || '' } } : {});
    }),
    ...c.sigs.map(s => blk(s.kind === 'bool' ? B.SIG_BOOL : B.SIG_NUM, { COMP: c.id, SIG: s.key }))
  ]);
  return {
    kind: 'categoryToolbox',
    contents: [
      cat(tl('Événements'), 'events', [blk(B.SETUP), blk(B.LOOP), blk(B.EVERY, { MS: 1000 })]),
      cat(tl('Broches'), 'pins', [blk(B.DWRITE, { PIN: out }, { STATE: L('HIGH') }), blk(B.DWRITE, { PIN: out }, { STATE: L('LOW') }), blk(B.DREAD, { PIN: pick('in', /button|pir|joystick/) }),
        blk(B.LEVEL, { LEVEL: 'HIGH' }), blk(B.AREAD, { PIN: pick('adc', /pot|ldr|soil|mq2|sound|joystick/) }), blk(B.AWRITE, { PIN: pick('pwm', /^led/) }, { VALUE: N(128) })]),
      cat(tl('Temps'), 'time', [blk(B.DELAY, null, { MS: N(1000) }), blk(B.MILLIS)]),
      cat(tl('Conditions'), 'logic', [blk('controls_if'), blk('controls_if', null, null, { extraState: { hasElse: true } }), blk('logic_compare', { OP: 'EQ' }),
        blk('logic_operation', { OP: 'AND' }), blk('logic_negate'), blk('logic_boolean', { BOOL: 'TRUE' })]),
      cat(tl('Boucles'), 'loops', [blk('controls_repeat_ext', null, { TIMES: N(10) }), blk('controls_whileUntil', { MODE: 'WHILE' }), blk('controls_for', null, { FROM: N(1), TO: N(10), BY: N(1) })]),
      cat(tl('Maths'), 'math', [blk('math_number', { NUM: 0 }), blk('math_arithmetic', { OP: 'ADD' }, { A: N(1), B: N(1) }), blk('math_single', { OP: 'ROOT' }, { NUM: N(9) }),
        blk('math_modulo', null, { DIVIDEND: N(64), DIVISOR: N(10) }), blk('math_random_int', null, { FROM: N(1), TO: N(6) }),
        blk(B.MAP, null, { VALUE: N(512), FROM_LOW: N(0), FROM_HIGH: N(max), TO_LOW: N(0), TO_HIGH: N(255) }), blk(B.CONSTRAIN, null, { VALUE: N(50), LOW: N(0), HIGH: N(100) })]),
      cat(tl('Texte'), 'text', [blk('text', { TEXT: '' }), blk('text_join')]),
      { kind: 'category', name: tl('Variables'), categorystyle: 'variables', custom: 'VARIABLE' },
      cat(tl('Moniteur série'), 'serial', [blk(B.PRINTLN, null, { VALUE: T(tl('Bonjour')) }), blk(B.PRINT, null, { VALUE: T('') }), blk(B.PLOT, { LABEL: tl('valeur') }, { VALUE: N(0) })]),
      cat(tl('Son'), 'sound', [blk(B.TONE, { PIN: pick('out', /speaker|buzzer/) }, { FREQ: N(440) }), blk(B.NOTONE, { PIN: pick('out', /speaker|buzzer/) })]),
      cat(tl('Servo'), 'servo', [blk(B.SERVO, { PIN: pick('out', /servo/) }, { ANGLE: N(90) })]),
      cat(tl('Montage'), 'montage', montage)
    ]
  };
}
