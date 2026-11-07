// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Noms des blocs et des champs partagés par l'éditeur (blocks.js, avec Blockly) et le
// générateur (generator.js, sans Blockly). Les blocs intégrés de Blockly gardent leurs noms.

/** Types des blocs propres à Jollof Studio. */
export const B = {
  SETUP: 'jollof_setup', LOOP: 'jollof_loop', EVERY: 'jollof_every',
  DWRITE: 'jollof_digital_write', DREAD: 'jollof_digital_read', AREAD: 'jollof_analog_read', AWRITE: 'jollof_analog_write', LEVEL: 'jollof_level',
  DELAY: 'jollof_delay', MILLIS: 'jollof_millis',
  MAP: 'jollof_map', CONSTRAIN: 'jollof_constrain',
  PRINT: 'jollof_print', PRINTLN: 'jollof_println', PLOT: 'jollof_plot',
  TONE: 'jollof_tone', NOTONE: 'jollof_notone', SERVO: 'jollof_servo',
  ACT: 'jollof_comp_act', SIG_NUM: 'jollof_comp_sig_num', SIG_BOOL: 'jollof_comp_sig_bool'
};

/**
 * Champs et entrées. PIN : clé de broche de la carte (« D13 », « GP15 », « A0 »).
 * COMP : id du composant. ACT / SIG : action ou mesure du composant. COLOR : couleur #rrggbb.
 */
export const F = {
  PIN: 'PIN', LEVEL: 'LEVEL', MS: 'MS', DO: 'DO', STATE: 'STATE', VALUE: 'VALUE', LABEL: 'LABEL', FREQ: 'FREQ', ANGLE: 'ANGLE',
  COMP: 'COMP', ACT: 'ACT', SIG: 'SIG', ARG: 'ARG', COLOR: 'COLOR',
  FROM_LOW: 'FROM_LOW', FROM_HIGH: 'FROM_HIGH', TO_LOW: 'TO_LOW', TO_HIGH: 'TO_HIGH', LOW: 'LOW', HIGH: 'HIGH'
};

/** Blocs intégrés de Blockly proposés (et compris par le générateur). */
export const BUILTINS = [
  'controls_if', 'controls_repeat_ext', 'controls_whileUntil', 'controls_for',
  'logic_compare', 'logic_operation', 'logic_negate', 'logic_boolean',
  'math_number', 'math_arithmetic', 'math_single', 'math_modulo', 'math_random_int',
  'text', 'text_join', 'variables_get', 'variables_set', 'math_change'
];

/** Espace de travail de départ : « au démarrage » et « en boucle », vides. */
export const emptyWorkspace = () => ({
  blocks: { languageVersion: 0, blocks: [{ type: B.SETUP, id: 'setup', x: 24, y: 24 }, { type: B.LOOP, id: 'loop', x: 24, y: 168 }] }
});
