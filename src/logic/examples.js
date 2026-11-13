// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique : circuits d'exemple, prêts à essayer (bibliothèque logique → Exemples).
import { tl } from '../i18n/index.js';

const E = (id, type, x, y, p = {}, r = 0) => ({ id, type, x, y, r, p });
const W = (id, a, pa, b, pb, via) => (via ? { id, a: [a, pa], b: [b, pb], via } : { id, a: [a, pa], b: [b, pb] });
let n = 0; const w = (a, pa, b, pb, via) => W('w' + ++n, a, pa, b, pb, via);

export const LOGIC_EXAMPLES = [
  {
    id: 'half-adder', name: () => tl('Demi-additionneur'), text: () => tl('Additionner deux bits : une porte OU exclusif donne la somme, une porte ET la retenue.'),
    circuit: () => ({
      elements: [E('t', 'text', 4, 1, { text: tl('A + B = C S (en binaire)') }), E('a', 'switch', 4, 4, { label: 'A' }), E('b', 'switch', 4, 13, { label: 'B' }),
        E('x', 'xor', 18, 4), E('g', 'and', 18, 11), E('s', 'led', 32, 5, { label: 'S', color: 'green' }), E('c', 'led', 32, 12, { label: 'C', color: 'yellow' })],
      wires: [w('a', 'Q', 'x', 'A'), w('b', 'Q', 'g', 'B'), w('a', 'Q', 'g', 'A', [[12, 5]]), w('b', 'Q', 'x', 'B', [[14, 14]]), w('x', 'Y', 's', 'A'), w('g', 'Y', 'c', 'A')]
    })
  },
  {
    id: 'rs-latch', name: () => tl('Mémoire : verrou RS'), text: () => tl('Deux portes NON-OU rebouclées retiennent un bit : S met Q à 1, R le remet à 0, et Q garde sa valeur quand S = R = 0.'),
    circuit: () => ({
      elements: [E('r', 'switch', 4, 3, { label: 'R' }), E('s', 'switch', 4, 16, { label: 'S' }), E('n1', 'nor', 18, 3), E('n2', 'nor', 18, 15),
        E('q', 'led', 34, 4, { label: 'Q', color: 'green' }), E('qn', 'led', 34, 16, { label: 'Q̄', color: 'red' })],
      wires: [w('r', 'Q', 'n1', 'A'), w('s', 'Q', 'n2', 'B'), w('n1', 'Y', 'q', 'A'), w('n2', 'Y', 'qn', 'A'),
        w('n1', 'Y', 'n2', 'A', [[26, 5], [26, 10], [15, 10], [15, 16]]), w('n2', 'Y', 'n1', 'B', [[28, 17], [28, 12], [13, 12], [13, 6]])]
    })
  },
  {
    id: 'counter-hex', name: () => tl('Compteur de 0 à 9'), text: () => tl('Une horloge fait avancer un compteur modulo 10 ; un afficheur montre sa valeur. Lancez le temps avec ▶.'),
    circuit: () => ({
      elements: [E('h', 'clock', 4, 3, { label: 'CLK', freq: 2 }), E('r', 'button', 4, 9, { label: 'RAZ' }), E('c', 'counter', 16, 3, { bits: 4, mod: 10 }), E('d', 'hex', 32, 3, { label: 'N' }), E('tc', 'led', 32, 11, { label: 'TC', color: 'yellow' })],
      wires: [w('h', 'Q', 'c', 'CLK'), w('r', 'Q', 'c', 'R'), w('c', 'Q0', 'd', 'D0'), w('c', 'Q1', 'd', 'D1'), w('c', 'Q2', 'd', 'D2'), w('c', 'Q3', 'd', 'D3'), w('c', 'TC', 'tc', 'A')]
    })
  },
  {
    id: 'seven-seg', name: () => tl('Afficheur 7 segments'), text: () => tl('Un nombre de 4 bits, réglé sur les interrupteurs DIP, est décodé en segments a à g.'),
    circuit: () => {
      const ws = [0, 1, 2, 3].map(i => w('n', String(i), 'dec', 'D' + i));
      'abcdefg'.split('').forEach(s => ws.push(w('dec', s, 'aff', s)));
      return { elements: [E('n', 'dip', 4, 3, { label: 'N', bits: 4, value: 5 }), E('dec', 'bcd7', 14, 3), E('aff', 'seg7', 26, 3)], wires: ws };
    }
  },
  {
    id: 'johnson', name: () => tl('Chenillard (compteur Johnson)'), text: () => tl('Un registre à décalage dont la dernière sortie, inversée, revient sur l’entrée : les LED s’allument puis s’éteignent l’une après l’autre.'),
    circuit: () => ({
      elements: [E('h', 'clock', 4, 5, { label: 'CLK', freq: 5 }), E('sr', 'shift', 16, 4, { bits: 4 }), E('inv', 'not', 16, 15, {}, 180),
        E('l0', 'led', 25, 12, { label: 'L0' }, 90), E('l1', 'led', 29, 12, { label: 'L1', color: 'yellow' }, 90), E('l2', 'led', 33, 12, { label: 'L2', color: 'green' }, 90), E('l3', 'led', 37, 12, { label: 'L3', color: 'blue' }, 90)],
      wires: [w('h', 'Q', 'sr', 'CLK'), w('sr', 'Q0', 'l0', 'A'), w('sr', 'Q1', 'l1', 'A'), w('sr', 'Q2', 'l2', 'A'), w('sr', 'Q3', 'l3', 'A'),
        w('sr', 'Q3', 'inv', 'A'), w('inv', 'Y', 'sr', 'DIN', [[2, 16], [2, 3], [15, 3]])]
    })
  },
  {
    id: 'mux4', name: () => tl('Aiguillage : multiplexeur 4 vers 1'), text: () => tl('Le nombre binaire S1 S0 choisit laquelle des quatre entrées est recopiée sur Y.'),
    circuit: () => ({
      elements: [E('i0', 'switch', 4, 2, { label: 'I0' }), E('i1', 'switch', 4, 6, { label: 'I1', value: 1 }), E('i2', 'switch', 4, 10, { label: 'I2' }), E('i3', 'switch', 4, 14, { label: 'I3', value: 1 }),
        E('m', 'mux', 18, 2, { sel: 2 }), E('s0', 'switch', 14, 19, { label: 'S0' }), E('s1', 'switch', 14, 23, { label: 'S1' }), E('y', 'led', 32, 4, { label: 'Y', color: 'green' })],
      wires: [w('i0', 'Q', 'm', 'I0'), w('i1', 'Q', 'm', 'I1', [[15, 7]]), w('i2', 'Q', 'm', 'I2', [[14, 11]]), w('i3', 'Q', 'm', 'I3', [[13, 15]]), w('s0', 'Q', 'm', 'S0'), w('s1', 'Q', 'm', 'S1'), w('m', 'Y', 'y', 'A')]
    })
  },
  {
    id: 'adder-blocks', name: () => tl('Additionneur 4 bits en blocs'), text: () => tl('Un bloc « ADD » (additionneur 1 bit fait de portes) est posé quatre fois, les retenues en chaîne. Les nombres A et B arrivent par des bus. Double-cliquez sur un bloc pour voir son circuit.'),
    circuit: () => {
      // Bloc ADD : S = A ⊕ B ⊕ Ci ; Co = A·B + Ci·(A ⊕ B).
      const add = {
        elements: [E('a', 'switch', 2, 2, { label: 'A' }), E('b', 'switch', 2, 8, { label: 'B' }), E('ci', 'switch', 2, 14, { label: 'Ci' }),
          E('x1', 'xor', 12, 2), E('x2', 'xor', 22, 4), E('a1', 'and', 22, 10), E('a2', 'and', 22, 16), E('o', 'or', 30, 12),
          E('s', 'led', 38, 5, { label: 'S', color: 'green' }), E('co', 'led', 38, 13, { label: 'Co', color: 'yellow' })],
        wires: [w('a', 'Q', 'x1', 'A'), w('b', 'Q', 'x1', 'B'), w('a', 'Q', 'a1', 'A', [[8, 11]]), w('b', 'Q', 'a1', 'B', [[10, 9], [10, 13]]),
          w('x1', 'Y', 'x2', 'A'), w('x1', 'Y', 'a2', 'A', [[19, 4], [19, 17]]), w('ci', 'Q', 'x2', 'B', [[11, 15], [11, 7]]), w('ci', 'Q', 'a2', 'B', [[11, 19]]),
          w('a1', 'Y', 'o', 'A'), w('a2', 'Y', 'o', 'B'), w('x2', 'Y', 's', 'A'), w('o', 'Y', 'co', 'A')]
      };
      const els = [E('t', 'text', 3, -2, { text: tl('A + B : quatre blocs ADD en chaîne') }), E('na', 'numin', 3, 2, { label: 'A', bits: 4, bus: 1, value: 6 }), E('nb', 'numin', 3, 33, { label: 'B', bits: 4, bus: 1, value: 7 }),
        E('sa', 'split', 11, 3, { bits: 4 }), E('sb', 'split', 11, 34, { bits: 4 }), E('z', 'const', 21, 0, { value: 0 }), E('r', 'numout', 40, 13, { label: 'S', bits: 5 })];
      const ws = [w('na', 'Q', 'sa', 'B'), w('nb', 'Q', 'sb', 'B'), w('z', 'Q', 'f0', 'Ci', [[25, 1], [25, 6]])];
      for (let i = 0; i < 4; i++) {
        els.push(E('f' + i, 'block', 26, 2 + 7 * i, { ref: 'add' }));
        ws.push(w('sa', 'b' + i, 'f' + i, 'A', i ? [[14 + i, 4 + i], [14 + i, 4 + 7 * i]] : undefined));
        ws.push(w('sb', 'b' + i, 'f' + i, 'B', [[19 + i, 35 + i], [19 + i, 5 + 7 * i]]));
        if (i < 3) ws.push(w('f' + i, 'Co', 'f' + (i + 1), 'Ci', [[32, 5 + 7 * i], [32, 8 + 7 * i], [24, 8 + 7 * i], [24, 13 + 7 * i]]));
      }
      ws.push(w('f0', 'S', 'r', 'A0', [[37, 4], [37, 14]]), w('f1', 'S', 'r', 'A1', [[36, 11], [36, 15]]), w('f2', 'S', 'r', 'A2', [[36, 18], [36, 16]]), w('f3', 'S', 'r', 'A3', [[37, 25], [37, 17]]), w('f3', 'Co', 'r', 'A4', [[38, 26], [38, 18]]));
      return { blocks: [{ id: 'add', name: 'ADD', circuit: add }], elements: els, wires: ws };
    }
  },
  {
    id: 'rom-message', name: () => tl('Message en ROM'), text: () => tl('Un compteur parcourt les adresses d’une mémoire morte ; chaque mot donne les segments d’une lettre : H, E, L, L, O. Le nombre passe par des bus, un séparateur le redonne segment par segment. Lancez le temps avec ▶.'),
    circuit: () => {
      const ws = [w('h', 'Q', 'c', 'CLK'), w('c', 'Q', 'rom', 'A'), w('c', 'Q', 'n', 'A'), w('rom', 'D', 'sp', 'B')];
      'abcdefg'.split('').forEach((s, i) => ws.push(w('sp', 'b' + i, 'aff', s)));
      return {
        elements: [E('t', 'text', 2, 0, { text: tl('Compteur → ROM → afficheur') }), E('h', 'clock', 2, 3, { label: 'CLK', freq: 2 }), E('c', 'counter', 10, 3, { bits: 3, mod: 6, bus: 1 }),
          E('rom', 'rom', 24, 3, { abits: 3, dbits: 7, bus: 1, data: '76 79 38 38 3F 00' }), E('n', 'numout', 20, 9, { label: 'ADR', bits: 3, bus: 1 }),
          E('sp', 'split', 34, 4, { bits: 7 }), E('aff', 'seg7', 40, 4, { color: 'green' })],
        wires: ws
      };
    }
  }
];
