// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Schéma électrique du montage, sur une feuille A4 ou A3 avec cadre et cartouche.
// Symboles dans l'esprit de la norme CEI 60617 (résistance rectangulaire, diode,
// LED, bouton poussoir, potentiomètre, transistor, pile, moteur, buzzer…) ; cartes,
// modules et capteurs en blocs rectangulaires avec le nom de chaque broche.
// Alimentations et masses se dessinent par leurs symboles, une liaison simple entre deux
// broches par un fil, les autres liaisons par une étiquette au nom du nœud.
import { Draw, textWidth } from './draw.js';
import { boardOf, base } from '../sim/boards.js';
import { analyze } from '../sim/circuit.js';
import { tl } from '../i18n/index.js';

const G = 2.54; // pas de la grille (mm)
const snap = v => Math.round(v / G) * G;
const DIR = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };
/** mm de schéma par mm du tapis 3D : la place d'un symbole suit celle de son composant, resserrée. */
export const SHEET_SCALE = 0.55;
const LW = 0.3, WIRE = 0.25;
const isBreadboard = c => /^breadboard/.test(c.type);
const LED_COLOR = { 'led-red': tl('LED rouge'), 'led-green': tl('LED verte'), 'led-blue': tl('LED bleue'), 'led-yellow': tl('LED jaune'), 'led-white': tl('LED blanche') };
// Composants analogiques : symbole et valeur affichée (le NE555 et le LM358 portent leur référence).
const ANALOG_SYMBOL = { 'ind-10m': 'inductor', irlz44n: 'nmos', lm358: 'opamp', ne555: 'ic555', siggen: 'siggen' };
const VALUE = { 'ind-10m': '10 mH', irlz44n: 'IRLZ44N', lm358: 'LM358', ne555: 'NE555', 'res-22': '22 Ω', 'res-220': '220 Ω', 'res-330': '330 Ω', 'res-1k': '1 kΩ', 'res-4k7': tl('4,7 kΩ'), 'res-10k': '10 kΩ', 'cap-100n': '100 nF', 'cap-100u': '100 µF', diode: '1N4007', npn: 'BC547', pn2222: 'PN2222A', bat9v: '9 V', bat18650: tl('3,7 V'), lm7805: 'LM7805', dcmotor: tl('Moteur CC'), buzzer: tl('Buzzer actif'), speaker: '8 Ω', fan: tl('Ventilateur 5 V'), pump: tl('Pompe 5 V'), vibro: tl('Vibreur 3 V') };

/* ---------------- Symboles ----------------
 * Chaque symbole : { box: [x0, y0, x1, y1] (corps et textes), body: [x0, y0, x1, y1] (obstacle pour les fils),
 *                    pins: { clé: { x, y, dir } } (extrémité de la broche, direction vers l'extérieur), draw(d) }.
 * Coordonnées locales en mm ; les extrémités de broches tombent sur la grille de 2,54 mm.
 */
const refText = (d, c, x, y, a = 'm') => d.text(x, y, c.name, { s: 2.1, b: true, a });
const valText = (d, v, x, y, a = 'm') => v && d.text(x, y, v, { s: 1.8, a });
function twoPin(c, value, body, o = {}) {
  const [pa, pb] = o.pins || ['1', '2'];
  return {
    pins: { [pa]: { x: -2 * G, y: 0, dir: 'l' }, [pb]: { x: 2 * G, y: 0, dir: 'r' } },
    spokes: { [pa]: [[-2 * G, 0], [0, 0]], [pb]: [[2 * G, 0], [0, 0]] },
    box: [-2 * G, o.top ?? -3.6, 2 * G, o.bottom ?? 4.2], body: o.body || [-3.6, -1.6, 3.6, 1.6], anim: o.anim || null,
    draw(d, st) { body(d, st); refText(d, c, 0, o.refY ?? -2.6); valText(d, value, 0, o.valY ?? 4.1); }
  };
}
const leads = (d, a, b) => { d.line([[-2 * G, 0], [a, 0]], { w: LW }); d.line([[b, 0], [2 * G, 0]], { w: LW }); };
const arrow = (d, x0, y0, x1, y1, w = LW) => {
  d.line([[x0, y0], [x1, y1]], { w });
  const a = Math.atan2(y1 - y0, x1 - x0), L = 0.9, s = 0.45;
  d.line([[x1, y1], [x1 - L * Math.cos(a - s), y1 - L * Math.sin(a - s)], [x1 - L * Math.cos(a + s), y1 - L * Math.sin(a + s)]], { w: 0.1, close: true, fill: '#000' });
};
/** Ordres de dessin d'une partie « active » (contact fermé, flèche de rotation…) : en couleur dans la vue en direct. */
function act(d, fn) { const n = d.ops.length; fn(); for (let i = n; i < d.ops.length; i++) d.ops[i].act = true; }
/** Arc fléché (a0 → a1, en radians, y vers le bas) : sens de rotation. */
function arcArrow(d, cx, cy, r, a0, a1) {
  const n = 10, pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  d.line(pts.slice(0, -1), { w: 0.22 });
  arrow(d, pts[n - 1][0], pts[n - 1][1], pts[n][0], pts[n][1], 0.22);
}
/** Ondes sonores : deux arcs autour de (cx, cy), du côté de l'angle a. */
function waves(d, cx, cy, a, r = 1.4) {
  [r, r + 1].forEach(R => d.arc(cx, cy, R, a - 0.45, a + 0.45, { w: 0.22 }));
}
function diodeBody(d, led) {
  leads(d, -1.6, 1.6);
  d.line([[-1.6, -1.6], [1.6, 0], [-1.6, 1.6]], { w: LW, close: true, fill: led ? null : null });
  d.line([[1.6, -1.6], [1.6, 1.6]], { w: LW });
  if (led) { arrow(d, -0.2, -2.0, 1.3, -3.5, 0.2); arrow(d, 0.9, -1.6, 2.4, -3.1, 0.2); }
}

const potX = st => -3.2 + 6.4 * Math.min(1, Math.max(0, (st.pos ?? 50) / 100));
const SYMBOLS = {
  resistor: (c, v) => twoPin(c, v, d => { leads(d, -3.6, 3.6); d.rect(-3.6, -1.2, 7.2, 2.4, { w: LW }); }, { body: [-3.6, -1.2, 3.6, 1.2] }),
  cap: (c, v) => twoPin(c, v, d => { leads(d, -0.6, 0.6); d.line([[-0.6, -2.2], [-0.6, 2.2]], { w: 0.45 }); d.line([[0.6, -2.2], [0.6, 2.2]], { w: 0.45 }); }, { body: [-0.8, -2.2, 0.8, 2.2], refY: -3.1, valY: 4.6, top: -4.1 }),
  capPol: (c, v) => twoPin(c, v, d => {
    leads(d, -0.6, 0.6); d.line([[-0.6, -2.2], [-0.6, 2.2]], { w: 0.45 }); d.rect(0.4, -2.2, 0.7, 4.4, { w: 0.2, fill: '#000' });
    d.text(-1.6, -1.2, '+', { s: 1.8, a: 'm' });
  }, { pins: ['+', '-'], body: [-0.8, -2.2, 1.1, 2.2], refY: -3.1, valY: 4.6, top: -4.1 }),
  diode: (c, v) => twoPin(c, v, d => diodeBody(d, false), { pins: ['A', 'K'] }),
  led: (c, v) => twoPin(c, v, d => diodeBody(d, true), { pins: ['A', 'K'], refY: -4.3, top: -5.3 }),
  button: (c, v) => twoPin(c, v, (d, st) => {
    d.line([[-2 * G, 0], [-2.4, 0]], { w: LW }); d.line([[2.4, 0], [2 * G, 0]], { w: LW });
    if (st && st.pressed) {
      // Appuyé : le contact est fermé, le poussoir descendu.
      act(d, () => {
        d.line([[-2.4, 0], [2.4, 0]], { w: LW });
        d.line([[0, -0.2], [0, -2.4]], { w: 0.2, dash: [0.6, 0.4] });
        d.line([[-1.2, -2.4], [1.2, -2.4]], { w: LW }); d.line([[-1.2, -2.4], [-1.2, -1.8]], { w: LW }); d.line([[1.2, -2.4], [1.2, -1.8]], { w: LW });
      });
      [-2.4, 2.4].forEach(x => d.circle(x, 0, 0.35, { fill: '#000', w: 0.1 }));
      return;
    }
    d.line([[-2.4, 0], [2.2, -1.7]], { w: LW });
    d.line([[0, -0.9], [0, -3.4]], { w: 0.2, dash: [0.6, 0.4] });
    d.line([[-1.2, -3.4], [1.2, -3.4]], { w: LW }); d.line([[-1.2, -3.4], [-1.2, -2.8]], { w: LW }); d.line([[1.2, -3.4], [1.2, -2.8]], { w: LW });
    if (st) [-2.4, 2.4].forEach(x => d.circle(x, 0, 0.35, { fill: '#000', w: 0.1 }));
  }, { refY: -4.4, top: -5.4, body: [-2.4, -3.4, 2.4, 0.4] }),
  battery: (c, v) => twoPin(c, v, d => {
    const cells = c.type === 'bat9v' ? 2 : 1, w = cells === 2 ? 3.2 : 0.8;
    d.line([[-2 * G, 0], [-w, 0]], { w: LW }); d.line([[w, 0], [2 * G, 0]], { w: LW });
    for (let i = 0; i < cells; i++) { const x = -w + i * 3.2; d.line([[x, -2.4], [x, 2.4]], { w: 0.25 }); d.line([[x + 1.4, -1.1], [x + 1.4, 1.1]], { w: 0.7 }); }
    if (cells === 2) d.line([[-w + 1.4, 0], [-w + 3.2, 0]], { w: 0.2, dash: [0.4, 0.4] });
    d.text(-w - 1.1, -1.4, '+', { s: 1.8, a: 'm' });
  }, { pins: ['+', '-'], body: [-3.4, -2.4, 3.4, 2.4], refY: -3.3, valY: 4.8, top: -4.4, bottom: 4.9 }),
  motor: (c, v) => twoPin(c, v, (d, st) => {
    leads(d, -3, 3); d.circle(0, 0, 3, { w: LW }); d.text(0, 1.1, 'M', { s: 3, b: true, a: 'm' });
    // En marche : flèche du sens de rotation sous le moteur.
    if (st && st.dir) act(d, () => (st.dir > 0 ? arcArrow(d, 0, 0, 3.6, 2.5, 0.65) : arcArrow(d, 0, 0, 3.6, 0.65, 2.5)));
  }, { pins: ['M+', 'M-'], body: [-3, -3, 3, 3], refY: -4, valY: 5.6, top: -5, bottom: 5.7, anim: { kind: 'rotor', x: 0, y: 0, r: 3 } }),
  // Ventilateur : moteur et hélice (pales tournantes dessinées en direct) ; + à gauche.
  fan: (c, v) => twoPin(c, v, (d, st) => {
    leads(d, -3, 3); d.circle(0, 0, 3, { w: LW }); d.text(-3.9, -0.9, '+', { s: 1.6, a: 'm' });
    if (!st) for (let i = 0; i < 3; i++) { const a = i * 2 * Math.PI / 3; d.arc(1.1 * Math.cos(a), 1.1 * Math.sin(a), 1.1, a, a + Math.PI, { w: 0.22 }); }
    else if (st.on) act(d, () => d.circle(0, 0, 3, { w: LW }));
  }, { pins: ['+', '-'], body: [-3, -3, 3, 3], refY: -4, valY: 5.6, top: -5, bottom: 5.7, anim: { kind: 'fan', x: 0, y: 0, r: 3 } }),
  // Pompe (CEI 60617) : cercle et triangle vers la sortie.
  pump: (c, v) => twoPin(c, v, (d, st) => {
    leads(d, -3, 3); d.circle(0, 0, 3, { w: LW }); d.line([[-1.3, -2.4], [2.9, -0.6], [-1.3, 2.4]], { w: 0.25, close: true }); d.text(-3.9, -0.9, '+', { s: 1.6, a: 'm' });
    if (st && st.on) act(d, () => d.circle(0, 0, 3, { w: LW }));
  }, { pins: ['+', '-'], body: [-3, -3, 3, 3], refY: -4, valY: 5.6, top: -5, bottom: 5.7, anim: { kind: 'pump', x: 0, y: 0, r: 3 } }),
  // Vibreur : moteur et ondes de vibration de part et d'autre.
  vibro: (c, v) => twoPin(c, v, (d, st) => {
    leads(d, -3, 3); d.circle(0, 0, 3, { w: LW }); d.text(0, 1.1, 'M', { s: 3, b: true, a: 'm' }); d.text(-3.9, -0.9, '+', { s: 1.6, a: 'm' });
    if (!st) [[-1, -3.8], [1, -3.8]].forEach(([x, y]) => d.line([[x - 0.5, y + 0.4], [x - 0.17, y - 0.4], [x + 0.17, y + 0.4], [x + 0.5, y - 0.4]], { w: 0.18 }));
    else if (st.on) act(d, () => d.circle(0, 0, 3, { w: LW }));
  }, { pins: ['+', '-'], body: [-3, -3, 3, 3], refY: -4.6, valY: 5.6, top: -5.6, bottom: 5.7, anim: { kind: 'vibro', x: 0, y: 0, r: 3 } }),
  buzzer: (c, v) => twoPin(c, v, (d, st) => {
    leads(d, -2.5, 2.5); d.line([[-2.5, 0], [2.5, 0]], { w: LW }); d.arc(0, 0, 2.5, Math.PI, 2 * Math.PI, { w: LW }); d.text(-3.6, -0.8, '+', { s: 1.6, a: 'm' });
    if (st && st.on) act(d, () => waves(d, 0, 0, -0.55, 3.3));
  }, { pins: ['+', '-'], body: [-2.5, -2.5, 2.5, 0.2], refY: -3.4, top: -4.4, anim: { kind: 'sound', x: 0, y: -0.6, r: 2.5 } }),
  speaker: (c, v) => ({
    pins: { '+': { x: -G, y: 2 * G, dir: 'd' }, '-': { x: G, y: 2 * G, dir: 'd' } },
    spokes: { '+': [[-G, 2 * G], [-G, 3], [0, 3], [0, 0]], '-': [[G, 2 * G], [G, 3], [0, 3], [0, 0]] },
    box: [-4, -6, 9, 2 * G], body: [-1.3, -2, 4.4, 2.2], anim: { kind: 'sound', x: 4.4, y: 0, r: 2.4 },
    draw(d, st) {
      d.rect(-1.3, -2, 2.6, 4.2, { w: LW }); d.line([[1.3, -2], [4.4, -4.6], [4.4, 4.8], [1.3, 2.2]], { w: LW });
      d.line([[-G, 2 * G], [-G, 2.2]], { w: LW }); d.line([[G, 2 * G], [G, 2.2]], { w: LW });
      d.text(-G - 1, 4.4, '+', { s: 1.6, a: 'r' });
      refText(d, c, 5.4, -1.2, 'l'); valText(d, v, 5.4, 1.4, 'l');
      if (st && st.on) act(d, () => waves(d, 4.4, -2.6, -0.75, 1.4));
    }
  }),
  pot: (c, v) => ({
    pins: { 1: { x: -2 * G, y: 0, dir: 'l' }, 3: { x: 2 * G, y: 0, dir: 'r' }, W: { x: 0, y: 2 * G, dir: 'd' } },
    spokes: { 1: [[-2 * G, 0], [0, 0]], 3: [[2 * G, 0], [0, 0]], W: [[0, 2 * G], [0, 0]] },
    // Vue en direct : le curseur est dessiné à sa place (0 % côté 1, 100 % côté 3) et le courant le suit.
    spokesFor(st) { const x = potX(st); return { 1: [[-2 * G, 0], [x, 0]], 3: [[2 * G, 0], [x, 0]], W: [[0, 2 * G], [0, 2.6], [x, 2.6], [x, 0]] }; },
    box: [-2 * G, -3.6, 2 * G + 9, 2 * G], body: [-3.6, -1.2, 3.6, 1.2],
    draw(d, st) {
      leads(d, -3.6, 3.6); d.rect(-3.6, -1.2, 7.2, 2.4, { w: LW });
      if (st) { const x = potX(st); d.line([[0, 2 * G], [0, 2.6], [x, 2.6]], { w: LW }); arrow(d, x, 2.6, x, 1.3); }
      else arrow(d, 0, 2 * G, 0, 1.3);
      refText(d, c, 0, -2.6); valText(d, v, 2.2, 4.4, 'l');
    }
  }),
  npn: (c, v) => ({
    pins: { B: { x: -2 * G, y: 0, dir: 'l' }, C: { x: G, y: -2 * G, dir: 'u' }, E: { x: G, y: 2 * G, dir: 'd' } },
    spokes: { B: [[-2 * G, 0], [-0.6, 0]], C: [[G, -2 * G], [G, -2.6], [-0.6, -0.9], [-0.6, 0]], E: [[G, 2 * G], [G, 2.6], [G - 0.2, 2.5], [-0.6, 0.9], [-0.6, 0]] },
    box: [-2 * G, -2 * G, 13, 2 * G], body: [-2.2, -3.4, 4.6, 3.4],
    draw(d) {
      d.circle(0.8, 0, 3.4, { w: LW });
      d.line([[-2 * G, 0], [-0.6, 0]], { w: LW }); d.line([[-0.6, -1.9], [-0.6, 1.9]], { w: 0.5 });
      d.line([[-0.6, -0.9], [G, -2.6], [G, -2 * G]], { w: LW });
      arrow(d, -0.6, 0.9, G - 0.2, 2.5); d.line([[G - 0.2, 2.5], [G, 2.6], [G, 2 * G]], { w: LW });
      refText(d, c, 5, -0.6, 'l'); valText(d, v, 5, 2, 'l');
    }
  }),
  ledRgb: (c) => ({
    pins: { R: { x: -2 * G, y: -2 * G, dir: 'l' }, G: { x: -2 * G, y: 0, dir: 'l' }, B: { x: -2 * G, y: 2 * G, dir: 'l' }, GND: { x: 3 * G, y: 0, dir: 'r' } },
    spokes: { R: [[-2 * G, -2 * G], [G * 1.6, -2 * G], [G * 1.6, 0]], G: [[-2 * G, 0], [G * 1.6, 0]], B: [[-2 * G, 2 * G], [G * 1.6, 2 * G], [G * 1.6, 0]], GND: [[3 * G, 0], [G * 1.6, 0]] },
    box: [-2 * G, -9.8, 3 * G, 2 * G + 3.6], body: [-1.8, -6.8, 4.8, 6.8],
    draw(d) {
      ['R', 'V', 'B'].forEach((n, i) => {
        const y = (i - 1) * 2 * G;
        d.line([[-2 * G, y], [-1.6, y]], { w: LW }); d.line([[-1.6, y - 1.6], [1.6, y], [-1.6, y + 1.6]], { w: LW, close: true }); d.line([[1.6, y - 1.6], [1.6, y + 1.6]], { w: LW });
        d.line([[1.6, y], [G * 1.6, y]], { w: LW }); d.text(-3, y - 0.6, n, { s: 1.4, a: 'm' });
      });
      d.line([[G * 1.6, -2 * G], [G * 1.6, 2 * G]], { w: LW }); d.line([[G * 1.6, 0], [3 * G, 0]], { w: LW });
      [-2 * G, 2 * G].forEach(y => d.circle(G * 1.6, y, 0.45, { fill: '#000', w: 0.1 }));
      d.circle(G * 1.6, 0, 0.45, { fill: '#000', w: 0.1 });
      refText(d, c, G * 0.4, -7.4); valText(d, 'RVB', G * 0.4, 2 * G + 3.4);
    }
  }),
  // Bobine (CEI 60617) : quatre demi-spires.
  inductor: (c, v) => twoPin(c, v, d => { leads(d, -3.6, 3.6); for (let i = 0; i < 4; i++) d.arc(-2.7 + i * 1.8, 0, 0.9, Math.PI, 2 * Math.PI, { w: LW }); }, { body: [-3.6, -1.2, 3.6, 0.3], refY: -2.6 }),
  // MOSFET canal N à enrichissement : grille isolée, canal en trois traits, flèche vers le canal, source reliée au substrat.
  nmos: (c, v) => ({
    pins: { G: { x: -2 * G, y: 0, dir: 'l' }, D: { x: G, y: -2 * G, dir: 'u' }, S: { x: G, y: 2 * G, dir: 'd' } },
    spokes: { G: [[-2 * G, 0], [-1.2, 0]], D: [[G, -2 * G], [G, -1.5], [-0.4, -1.5]], S: [[G, 2 * G], [G, 1.5], [-0.4, 1.5]] },
    box: [-2 * G, -2 * G, 14, 2 * G], body: [-2.2, -3.4, 4.6, 3.4],
    draw(d) {
      d.circle(0.8, 0, 3.4, { w: LW });
      d.line([[-2 * G, 0], [-1.2, 0]], { w: LW }); d.line([[-1.2, -1.8], [-1.2, 1.8]], { w: LW });
      [[-1.9, -1.1], [-0.4, 0.4], [1.1, 1.9]].forEach(([a, b]) => d.line([[-0.4, a], [-0.4, b]], { w: 0.45 }));
      d.line([[-0.4, -1.5], [G, -1.5], [G, -2 * G]], { w: LW }); d.line([[-0.4, 1.5], [G, 1.5], [G, 2 * G]], { w: LW });
      arrow(d, G, 0, -0.3, 0); d.line([[G, 0], [G, 1.5]], { w: LW });
      refText(d, c, 5, -0.6, 'l'); valText(d, v, 5, 2, 'l');
    }
  }),
  // Double ampli-op : deux triangles (A en haut, B en bas), VCC au-dessus, masse en dessous.
  opamp: (c, v) => {
    const yA = -3 * G, yB = 3 * G, tri = (d, y) => { d.line([[-2 * G, y - 1.8 * G], [-2 * G, y + 1.8 * G], [2 * G, y]], { w: LW, close: true }); d.text(-2 * G + 1.1, y - G + 0.6, '−', { s: 1.9, a: 'm' }); d.text(-2 * G + 1.1, y + G + 0.6, '+', { s: 1.9, a: 'm' }); };
    const ins = (k, y) => ({ [k]: { x: -3 * G, y, dir: 'l' } });
    return {
      pins: { ...ins('1IN-', yA - G), ...ins('1IN+', yA + G), '1OUT': { x: 3 * G, y: yA, dir: 'r' }, ...ins('2IN-', yB - G), ...ins('2IN+', yB + G), '2OUT': { x: 3 * G, y: yB, dir: 'r' }, VCC: { x: 0, y: -6 * G, dir: 'u' }, GND: { x: 0, y: 6 * G, dir: 'd' } },
      spokes: { '1IN-': [[-3 * G, yA - G], [-2 * G, yA - G]], '1IN+': [[-3 * G, yA + G], [-2 * G, yA + G]], '1OUT': [[3 * G, yA], [2 * G, yA]], '2IN-': [[-3 * G, yB - G], [-2 * G, yB - G]], '2IN+': [[-3 * G, yB + G], [-2 * G, yB + G]], '2OUT': [[3 * G, yB], [2 * G, yB]], VCC: [[0, -6 * G], [0, yA - 0.9 * G]], GND: [[0, 6 * G], [0, yB + 0.9 * G]] },
      box: [-3 * G, -6 * G, 3 * G + 12, 6 * G], body: [-2 * G, yA - 1.8 * G, 2 * G, yB + 1.8 * G],
      draw(d) {
        tri(d, yA); tri(d, yB);
        for (const y of [yA, yB]) { d.line([[-3 * G, y - G], [-2 * G, y - G]], { w: LW }); d.line([[-3 * G, y + G], [-2 * G, y + G]], { w: LW }); d.line([[2 * G, y], [3 * G, y]], { w: LW }); }
        d.line([[0, -6 * G], [0, yA - 0.9 * G]], { w: LW }); d.line([[0, 6 * G], [0, yB + 0.9 * G]], { w: LW });
        d.text(0.6, -6 * G + 1.4, 'VCC', { s: 1.4, a: 'l' }); d.text(0.6, 6 * G - 0.6, 'GND', { s: 1.4, a: 'l' });
        d.text(0, yA + 0.5, 'A', { s: 1.4, a: 'm' }); d.text(0, yB + 0.5, 'B', { s: 1.4, a: 'm' });
        refText(d, c, 3 * G + 1, yA - 2.4, 'l'); valText(d, v, 3 * G + 1, yB + 3, 'l');
      }
    };
  },
  // Minuterie NE555 : boîte, broches rangées par rôle (comparateurs à gauche, sortie et décharge à droite).
  ic555: (c, v) => {
    const W = 6 * G, H = 8 * G, x0 = -W / 2, y0 = -H / 2;
    const P = { TRIG: [x0 - G, -2 * G, 'l'], THR: [x0 - G, 0, 'l'], CV: [x0 - G, 2 * G, 'l'], OUT: [-x0 + G, -2 * G, 'r'], DIS: [-x0 + G, 0, 'r'], VCC: [-G, y0 - G, 'u'], RESET: [G, y0 - G, 'u'], GND: [0, -y0 + G, 'd'] };
    const pins = {}, spokes = {};
    for (const [k, [x, y, dir]] of Object.entries(P)) { pins[k] = { x, y, dir }; const [dx, dy] = DIR[dir]; spokes[k] = [[x, y], [x - dx * G, y - dy * G]]; }
    return {
      pins, spokes, box: [x0 - G, y0 - G - 3.6, -x0 + G, -y0 + G + 3.4], body: [x0, y0, -x0, -y0],
      draw(d) {
        d.rect(x0, y0, W, H, { w: LW });
        for (const [k, [x, y, dir]] of Object.entries(P)) {
          const [dx, dy] = DIR[dir]; d.line([[x, y], [x - dx * G, y - dy * G]], { w: LW });
          const tx = x - dx * (G + 0.6), ty = y - dy * (G + 1.6) + (dy ? 0 : 0.55);
          d.text(tx, ty, k, { s: 1.35, a: dir === 'l' ? 'l' : dir === 'r' ? 'r' : 'm' });
        }
        refText(d, c, 0, y0 - G - 2, 'm'); valText(d, v, 0, -y0 - 1.6, 'm');
      }
    };
  },
  // Générateur de fonctions : source de tension alternative (cercle et sinusoïde), OUT en haut, GND en bas.
  siggen: c => {
    const g = c.inp || {}, wave = { sine: '∿', square: '⊓', triangle: '△', dc: '⎓' }[g.wave] || '∿';
    const f = +g.freq || 0, val = g.wave === 'dc' ? `${String(+g.off || 0).replace('.', ',')} V` : `${wave} ${f >= 1000 ? `${String(Math.round(f / 10) / 100).replace('.', ',')} kHz` : `${String(f).replace('.', ',')} Hz`}`;
    return {
      pins: { OUT: { x: 0, y: -2 * G, dir: 'u' }, GND: { x: 0, y: 2 * G, dir: 'd' } },
      spokes: { OUT: [[0, -2 * G], [0, -3]], GND: [[0, 2 * G], [0, 3]] },
      box: [-3.4, -2 * G, 16, 2 * G], body: [-3, -3, 3, 3],
      draw(d) {
        d.circle(0, 0, 3, { w: LW }); d.line([[0, -2 * G], [0, -3]], { w: LW }); d.line([[0, 3], [0, 2 * G]], { w: LW });
        const pts = []; for (let i = 0; i <= 16; i++) pts.push([-1.8 + i * 3.6 / 16, -1.1 * Math.sin(i / 16 * 2 * Math.PI)]); d.line(pts, { w: 0.25 });
        d.text(0.7, -3.6, '+', { s: 1.6, a: 'l' });
        refText(d, c, 4, -0.6, 'l'); valText(d, val, 4, 2, 'l');
      }
    };
  }
};
/**
 * Symboles des composants en paquet (.jpart, library/packages.js) : type → { kind, value } (symbole de la liste
 * ci-dessous, avec sa valeur) ou { make(c) } (dessin du paquet ; null : bloc).
 */
export const PKG_SYMBOLS = {};
const SYMBOL_OF = type => (/^res-/.test(type) ? 'resistor' : type === 'cap-100n' ? 'cap' : type === 'cap-100u' ? 'capPol' : type === 'diode' ? 'diode' : LED_COLOR[type] ? 'led'
  : type === 'led-rgb' ? 'ledRgb' : type === 'button' || type === 'cylsensor' || type === 'pressostat' ? 'button' : type === 'pot' ? 'pot' : type === 'npn' || type === 'pn2222' ? 'npn' : /^bat/.test(type) ? 'battery' : type === 'dcmotor' ? 'motor'
  : type === 'buzzer' ? 'buzzer' : type === 'speaker' ? 'speaker' : type === 'fan' || type === 'pump' || type === 'vibro' ? type : ANALOG_SYMBOL[type] || null);

/** Petits pictogrammes dans les blocs (relais, servo, pas à pas). */
const ICONS = {
  relay(d, x, y, st) {
    d.rect(x - 2.6, y - 1.4, 3.2, 2.8, { w: 0.25 }); d.line([[x - 2.6, y - 1.4], [x + 0.6, y + 1.4]], { w: 0.2 });
    if (!st) { d.line([[x + 1.6, y + 1.6], [x + 3.4, y - 0.6]], { w: 0.25 }); d.line([[x + 0.6, y], [x + 2.4, y]], { w: 0.15, dash: [0.4, 0.3] }); return; }
    // Vue en direct : pivot et contact fixe dessinés ; relais collé = contact fermé.
    d.line([[x + 3.8, y + 0.9], [x + 3.8, y + 2.2]], { w: 0.25 }); d.circle(x + 1.6, y + 1.6, 0.3, { fill: '#000', w: 0.1 });
    if (st.on) act(d, () => { d.rect(x - 2.6, y - 1.4, 3.2, 2.8, { w: 0.25 }); d.line([[x + 1.6, y + 1.6], [x + 3.8, y + 1.6]], { w: 0.3 }); d.line([[x + 0.6, y], [x + 2.6, y], [x + 2.6, y + 1.4]], { w: 0.15, dash: [0.4, 0.3] }); });
    else { d.line([[x + 1.6, y + 1.6], [x + 3.4, y - 0.6]], { w: 0.25 }); d.line([[x + 0.6, y], [x + 2.4, y]], { w: 0.15, dash: [0.4, 0.3] }); }
  },
  servo(d, x, y, st) {
    d.circle(x, y, 2.4, { w: 0.25 }); if (!st || !st.anim) d.text(x, y + 0.9, 'M', { s: 2.4, b: true, a: 'm' }); // en direct : le palonnier à la place
    // Vue en direct : palonnier à l'angle du servo (0° à gauche, 90° en haut, 180° à droite).
    if (st && st.a != null) { const a = Math.PI + st.a * Math.PI / 180; act(d, () => d.line([[x + 2.4 * Math.cos(a), y + 2.4 * Math.sin(a)], [x + 3.9 * Math.cos(a), y + 3.9 * Math.sin(a)]], { w: 0.45 })); }
    // st.anim : vue en direct, le palonnier est animé par-dessus (live.js).
  },
  stepper(d, x, y, st) {
    d.circle(x, y, 2.4, { w: 0.25 }); d.text(x, y + 0.9, 'M', { s: 2.4, b: true, a: 'm' }); d.line([[x - 1.4, y + 3.4], [x - 0.5, y + 3.4], [x - 0.5, y + 2.8], [x + 0.5, y + 2.8], [x + 0.5, y + 3.4], [x + 1.4, y + 3.4]], { w: 0.15 });
    // Vue en direct : un repère tourne sur le bord avec l'axe.
    if (st && st.t != null) { const a = st.t * 2 * Math.PI - Math.PI / 2; act(d, () => d.circle(x + 2.4 * Math.cos(a), y + 2.4 * Math.sin(a), 0.5, { fill: '#000', w: 0.1 })); }
    // st.anim : vue en direct, le repère tourne par-dessus (live.js).
  },
  l298n(d, x, y) { d.circle(x, y, 2.4, { w: 0.25 }); d.text(x, y + 0.9, 'H', { s: 2.4, b: true, a: 'm' }); }
};
const ICON_OF = { relay: 'relay', servo: 'servo', stepper: 'stepper', l298n: 'l298n' };

/** Côtés des broches d'un bloc d'après leur place réelle sur la carte ou le module. */
function physicalSides(c) {
  const keys = Object.keys(c.pins); if (!keys.length) return { l: [], r: [], t: [], b: [] };
  const P = keys.map(k => { const a = c.pins[k].attach; return { k, x: a.x, z: a.z }; });
  const cx = P.reduce((s, p) => s + p.x, 0) / P.length, cz = P.reduce((s, p) => s + p.z, 0) / P.length;
  const sx = Math.max(...P.map(p => Math.abs(p.x - cx))) || 1, sz = Math.max(...P.map(p => Math.abs(p.z - cz))) || 1;
  const S = { l: [], r: [], t: [], b: [] };
  for (const p of P) {
    const nx = (p.x - cx) / sx, nz = (p.z - cz) / sz;
    if (Math.abs(nx) >= Math.abs(nz)) S[nx < 0 ? 'l' : 'r'].push(p); else S[nz < 0 ? 't' : 'b'].push(p);
  }
  return { l: S.l.sort((a, b) => a.z - b.z).map(p => p.k), r: S.r.sort((a, b) => a.z - b.z).map(p => p.k), t: S.t.sort((a, b) => a.x - b.x).map(p => p.k), b: S.b.sort((a, b) => a.x - b.x).map(p => p.k) };
}
/** Bloc rectangulaire : carte, module ou capteur. faceRight : un module dont toutes les broches sont d'un côté les tourne vers la carte. */
function block(c, title, sub, faceRight) {
  let S = physicalSides(c);
  const used = Object.values(S).filter(s => s.length).length;
  if (used === 1) { const all = [...S.l, ...S.r, ...S.t, ...S.b]; S = { l: faceRight ? [] : all, r: faceRight ? all : [], t: [], b: [] }; }
  else {
    // Toujours deux colonnes (aucun nom à la verticale). Carte large aux rangées haut/bas (Uno, L298N) :
    // la rangée du haut à droite, numérotée de haut en bas, celle du bas à gauche. Carte haute (ESP32, Nano) : ses deux colonnes.
    const keys = Object.keys(c.pins), at = k => c.pins[k].attach;
    const xs = keys.map(k => at(k).x), zs = keys.map(k => at(k).z), cx = xs.reduce((a, b) => a + b, 0) / keys.length, cz = zs.reduce((a, b) => a + b, 0) / keys.length;
    // Rangées (peu de valeurs de z distinctes, comme l'Uno) ou colonnes (peu de valeurs de x, comme l'ESP32) ?
    const distinct = v => new Set(v.map(x => Math.round(x))).size, wide = distinct(zs) < distinct(xs);
    S = wide
      ? { l: keys.filter(k => at(k).z >= cz).sort((a, b) => at(a).x - at(b).x), r: keys.filter(k => at(k).z < cz).sort((a, b) => at(b).x - at(a).x), t: [], b: [] }
      : { l: keys.filter(k => at(k).x < cx).sort((a, b) => at(a).z - at(b).z), r: keys.filter(k => at(k).x >= cx).sort((a, b) => at(a).z - at(b).z), t: [], b: [] };
  }
  const fs = 1.55, name = k => base(k);
  const wl = Math.max(0, ...S.l.map(k => textWidth(name(k), fs))), wr = Math.max(0, ...S.r.map(k => textWidth(name(k), fs)));
  const vt = Math.max(0, ...[...S.t, ...S.b].map(k => textWidth(name(k), fs)));
  const icon = ICONS[ICON_OF[c.type]];
  const W = Math.ceil(Math.max(wl + wr + 3 + (icon ? 7 : 0), (Math.max(S.t.length, S.b.length) + 1) * G, textWidth(sub, 1.7) + 2, 4 * G) / G) * G;
  const rows = Math.max(S.l.length, S.r.length, 1);
  const H = Math.ceil(Math.max((rows + 1) * G, vt + 2 * G + (S.t.length && S.b.length ? vt : 0)) / G) * G;
  const pins = {};
  S.l.forEach((k, i) => (pins[k] = { x: -G, y: G * (i + 1), dir: 'l' }));
  S.r.forEach((k, i) => (pins[k] = { x: W + G, y: G * (i + 1), dir: 'r' }));
  S.t.forEach((k, i) => (pins[k] = { x: G * (i + 1), y: -G, dir: 'u' }));
  S.b.forEach((k, i) => (pins[k] = { x: G * (i + 1), y: H + G, dir: 'd' }));
  const top = S.t.length ? -G - 4.2 : -4.2;
  return {
    pins, box: [-G, top, W + G, H + (S.b.length ? G : 0) + 3.4], body: [0, 0, W, H],
    // Pictogramme animé dans la vue en direct (palonnier du servo, repère du pas à pas, contact du relais).
    anim: icon ? { kind: ICON_OF[c.type], x: W / 2 + (wl - wr) / 2 * 0.5, y: H / 2, r: 2.4 } : null,
    draw(d, st) {
      d.rect(0, 0, W, H, { w: 0.35 });
      for (const [k, p] of Object.entries(pins)) {
        const [dx, dy] = DIR[p.dir];
        d.line([[p.x, p.y], [p.x - dx * G, p.y - dy * G]], { w: LW });
        if (p.dir === 'l') d.text(0.8, p.y + 0.55, name(k), { s: fs });
        else if (p.dir === 'r') d.text(W - 0.8, p.y + 0.55, name(k), { s: fs, a: 'r' });
        else if (p.dir === 'u') d.text(p.x + 0.55, 0.8, name(k), { s: fs, rot: -90, a: 'r' });
        else d.text(p.x + 0.55, H - 0.8, name(k), { s: fs, rot: -90 });
      }
      if (icon) icon(d, W / 2 + (wl - wr) / 2 * 0.5, H / 2, st);
      d.text(0, top + 2.4, c.name, { s: 2.1, b: true });
      d.text(0, H + (S.b.length ? G : 0) + 2.9, sub, { s: 1.7 });
    }
  };
}

/* ---------------- Nœuds ---------------- */
/** Nom d'une alimentation : +5V, +3V3, +9V, +3V7. */
const fmtV = v => { const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? `+${r}V` : `+${Math.floor(r)}V${Math.round((r % 1) * 10)}`; };
export function buildNets(comps, A, netNames) {
  const drawn = new Set(comps), pid = r => `${r.comp.id}|${r.key}`, byPin = new Map(), nets = [];
  for (const c of comps) for (const k of Object.keys(c.pins)) {
    const ref = { comp: c, key: k };
    if (!A.deg(ref) || byPin.has(pid(ref))) continue;
    const mem = A.members(ref).filter(m => drawn.has(m.comp) && A.deg(m) > 0);
    const keyPins = A.members(ref).filter(m => !isBreadboard(m.comp) && A.deg(m) > 0);
    const key = keyPins.map(pid).sort()[0];
    const n = A.net(ref), net = { key, pins: mem, kind: n.src.length && n.gnd.length ? 'short' : n.src.length ? 'pwr' : n.gnd.length ? 'gnd' : 'sig', v: n.src.length ? Math.max(...n.src.map(s => s.v)) : 0, gpio: n.gpio[0] || A.wnet(ref).gpio[0] };
    mem.forEach(m => byPin.set(pid(m), net));
    nets.push(net);
  }
  const boards = comps.filter(c => boardOf(c)), seen = new Map();
  let free = 0;
  for (const net of nets) {
    let name = netNames[net.key];
    if (!name) {
      if (net.kind === 'short') name = 'COURT-CIRCUIT';
      else if (net.kind === 'pwr') name = fmtV(net.v);
      else if (net.kind === 'gnd') name = 'GND';
      else if (net.gpio && net.pins.some(p => p.comp === net.gpio.comp)) name = (boards.length > 1 ? net.gpio.comp.name + '.' : '') + base(net.gpio.key);
      else name = `N${++free}`;
    }
    const k = seen.get(name) || 0; seen.set(name, k + 1);
    net.name = k ? `${name}_${k + 1}` : name;
  }
  return { nets, of: r => byPin.get(pid(r)) || null };
}

/* ---------------- Fils ---------------- */
function segHitsBox(a, b, box) {
  const [x0, y0, x1, y1] = box, e = 0.05;
  if (Math.abs(a[1] - b[1]) < 1e-6) { const y = a[1], lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]); return y > y0 + e && y < y1 - e && hi > x0 + e && lo < x1 - e; }
  const x = a[0], lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]); return x > x0 + e && x < x1 - e && hi > y0 + e && lo < y1 - e;
}
function overlaps(a, b, c, d) {
  const h1 = Math.abs(a[1] - b[1]) < 1e-6, h2 = Math.abs(c[1] - d[1]) < 1e-6;
  if (h1 !== h2) return false;
  if (h1) { if (Math.abs(a[1] - c[1]) > 1e-6) return false; return Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) > 0.05; }
  if (Math.abs(a[0] - c[0]) > 1e-6) return false;
  return Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) > 0.05;
}
const onSeg = (p, a, b) => (Math.abs(a[1] - b[1]) < 1e-6 ? Math.abs(p[1] - a[1]) < 0.2 && p[0] > Math.min(a[0], b[0]) - 0.05 && p[0] < Math.max(a[0], b[0]) + 0.05 : Math.abs(p[0] - a[0]) < 0.2 && p[1] > Math.min(a[1], b[1]) - 0.05 && p[1] < Math.max(a[1], b[1]) + 0.05);
/** Tracés orthogonaux triés par coût (longueur + 4 mm par coude), dans un ordre stable. */
function byCost(list, extra = () => ({})) {
  const out = [];
  list.forEach((pts, k) => {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      if (Math.abs(p[0] - q[0]) > 1e-6 && Math.abs(p[1] - q[1]) > 1e-6) return;
      len += Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
    }
    out.push({ pts, cost: len + (pts.length - 2) * 4, ...extra(k) });
  });
  return out.sort((x, y) => x.cost - y.cost);
}
/** Tracé orthogonal entre deux broches, qui évite corps des symboles, autres broches et fils déjà tracés ; null s'il n'y en a pas. */
function route(A, B, bodies, wires, pinEnds) {
  const out = (p, k) => [p.x + DIR[p.dir][0] * G * k, p.y + DIR[p.dir][1] * G * k];
  const a = [A.x, A.y], b = [B.x, B.y], cands = [];
  for (const ka of [1, 2]) for (const kb of [1, 2]) {
    const a0 = out(A, ka), b0 = out(B, kb);
    cands.push([a, a0, [b0[0], a0[1]], b0, b], [a, a0, [a0[0], b0[1]], b0, b]);
    for (let s = -6; s <= 6; s++) {
      const mx = snap((a0[0] + b0[0]) / 2) + s * G, my = snap((a0[1] + b0[1]) / 2) + s * G;
      cands.push([a, a0, [mx, a0[1]], [mx, b0[1]], b0, b], [a, a0, [a0[0], my], [b0[0], my], b0, b]);
    }
  }
  // Essais du moins coûteux au plus coûteux (tri stable : à coût égal, l'ordre ci-dessus) : le premier tracé libre est le bon.
  for (const { pts } of byCost(cands.map(raw => raw.filter((p, i) => i === 0 || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 1e-6)))) {
    let ok = true;
    for (let i = 1; i < pts.length && ok; i++) {
      const p = pts[i - 1], q = pts[i];
      if (bodies.some(bx => segHitsBox(p, q, bx))) ok = false;
      else if (wires.some(w => w.some((u, j) => j && overlaps(p, q, w[j - 1], u)))) ok = false;
      else if (pinEnds.some(e => !(Math.abs(e[0] - a[0]) < 1e-6 && Math.abs(e[1] - a[1]) < 1e-6) && !(Math.abs(e[0] - b[0]) < 1e-6 && Math.abs(e[1] - b[1]) < 1e-6) && onSeg(e, p, q))) ok = false;
    }
    if (ok) return pts;
  }
  return null;
}
/* ---------------- Routage sur grille (vue en direct) ----------------
 * Plus court chemin (Dijkstra) sur la grille de 2,54 mm : coût = longueur + 4 mm par coude + 1,5 mm par croisement.
 * Un fil ne passe ni dans un symbole, ni sur une broche, ne longe pas un autre fil et ne tourne pas sur un fil
 * (ce qui ressemblerait à une jonction) ; il peut en croiser un à angle droit. Il quitte et rejoint chaque
 * broche dans son prolongement. Les nœuds de plus de deux broches deviennent des arbres avec jonctions en T.
 */
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1], DI = { r: 0, d: 1, l: 2, u: 3 };
function makeGrid(boxes, bodies, pinEnds) {
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const b of boxes) { lo = [Math.min(lo[0], b[0]), Math.min(lo[1], b[1])]; hi = [Math.max(hi[0], b[2]), Math.max(hi[1], b[3])]; }
  if (!boxes.length) { lo = [0, 0]; hi = [0, 0]; }
  const x0 = snap(lo[0]) - 12 * G, y0 = snap(lo[1]) - 12 * G;
  const nx = Math.round((snap(hi[0]) + 12 * G - x0) / G) + 1, ny = Math.round((snap(hi[1]) + 12 * G - y0) / G) + 1, N = nx * ny;
  const g = { x0, y0, nx, ny, block: new Uint8Array(N), pin: new Uint8Array(N), H: new Uint8Array(N), V: new Uint8Array(N) };
  g.cell = (x, y) => { const i = Math.round((x - x0) / G), j = Math.round((y - y0) / G); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i; };
  g.pt = c => [x0 + (c % nx) * G, y0 + Math.floor(c / nx) * G];
  const e = 0.05;
  for (const b of bodies) {
    const i0 = Math.max(0, Math.ceil((b[0] - x0) / G)), i1 = Math.min(nx - 1, Math.floor((b[2] - x0) / G));
    const j0 = Math.max(0, Math.ceil((b[1] - y0) / G)), j1 = Math.min(ny - 1, Math.floor((b[3] - y0) / G));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = x0 + i * G, y = y0 + j * G;
      if (x > b[0] + e && x < b[2] - e && y > b[1] + e && y < b[3] - e) g.block[j * nx + i] = 1;
    }
  }
  for (const p of pinEnds) { const c = g.cell(p[0], p[1]); if (c >= 0) g.pin[c] = 1; }
  return g;
}
/** Cellules d'un tracé, marquées dans H (segments horizontaux) et V (verticaux). */
function markPath(g, pts, H = g.H, V = g.V) {
  for (let i = 1; i < pts.length; i++) {
    let c = g.cell(pts[i - 1][0], pts[i - 1][1]); const z = g.cell(pts[i][0], pts[i][1]);
    if (c < 0 || z < 0) continue;
    const horiz = Math.abs(pts[i][1] - pts[i - 1][1]) < 1e-6, step = horiz ? Math.sign(z - c) : Math.sign(z - c) * g.nx;
    for (;;) { (horiz ? H : V)[c] = 1; if (c === z || !step) break; c += step; }
  }
}
/**
 * Chemin depuis la broche « from » ({ x, y, dir }) jusqu'à une cellule cible : la broche « to » (atteinte dans son
 * prolongement) ou, si own est donné, n'importe quel point des fils déjà tracés du nœud (own : { H, V }).
 */
function gridPath(g, from, to, own) {
  const nx = g.nx, N = nx * g.ny, start = g.cell(from.x, from.y), goal = to ? g.cell(to.x, to.y) : -1;
  if (start < 0 || (to && goal < 0)) return null;
  const arrive = to ? (DI[to.dir] + 2) % 4 : -1;
  const isOwn = c => own && (own.H[c] || own.V[c]) && !g.pin[c] && !g.H[c] && !g.V[c]; // jonction : jamais sur le croisement d'un autre fil
  const dist = new Float64Array(N * 4).fill(Infinity), prev = new Int32Array(N * 4).fill(-1);
  const heap = [];
  const push = (cost, s) => { heap.push([cost, s]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const next = (c, d) => { const i = c % nx + DX[d], j = Math.floor(c / nx) + DY[d]; return i < 0 || j < 0 || i >= nx || j >= g.ny ? -1 : j * nx + i; };
  // Passage de c à n dans la direction d : rend le surcoût, ou -1 si interdit.
  const step = (c, n, d) => {
    if (n < 0 || g.block[n]) return -1;
    if (g.pin[n] && n !== goal) return -1;
    if (own && (own.H[n] || own.V[n]) && !isOwn(n)) return -1; // fil du même nœud, hors point d'accroche possible
    const horiz = d % 2 === 0, along = horiz ? g.H : g.V, across = horiz ? g.V : g.H;
    if (along[n] && along[c]) return -1; // le long d'un autre fil
    if (along[n]) return -1; // arrivée en bout ou dans l'angle d'un autre fil
    return across[n] ? 1.5 : 0; // croisement à angle droit
  };
  const sd = DI[from.dir], first = next(start, sd), fc = first < 0 ? -1 : step(start, first, sd);
  if (fc < 0) return null;
  dist[first * 4 + sd] = G + fc; prev[first * 4 + sd] = -2; push(G + fc, first * 4 + sd);
  let end = -1;
  while (heap.length) {
    const [cost, s] = pop();
    if (cost > dist[s]) continue;
    const c = s >> 2, d = s & 3;
    if ((to && c === goal && d === arrive) || (!to && isOwn(c))) { end = s; break; }
    if (c === goal || isOwn(c)) continue; // on n'entre dans une cible que pour s'y arrêter
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue;
      const turn = nd !== d;
      if (turn && (g.H[c] || g.V[c])) continue; // pas de coude sur un autre fil
      const n = next(c, nd), extra = step(c, n, nd);
      if (extra < 0) continue;
      const nc = cost + G + (turn ? 4 : 0) + extra, ns = n * 4 + nd;
      if (nc < dist[ns]) { dist[ns] = nc; prev[ns] = s; push(nc, ns); }
    }
  }
  if (end < 0) return null;
  const cells = [];
  for (let s = end; s >= 0; s = prev[s]) cells.push(s >> 2);
  cells.push(start); cells.reverse();
  const pts = [g.pt(cells[0])];
  for (let i = 1; i < cells.length; i++) {
    const p = g.pt(cells[i]);
    if (i < cells.length - 1) { const q = g.pt(cells[i + 1]), a = pts[pts.length - 1]; if ((Math.abs(a[0] - p[0]) < 1e-6 && Math.abs(p[0] - q[0]) < 1e-6) || (Math.abs(a[1] - p[1]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6)) continue; }
    pts.push(p);
  }
  // Extrémités exactes (les broches ne tombent sur la grille qu'à l'arrondi près).
  pts[0] = [from.x, from.y]; if (to) pts[pts.length - 1] = [to.x, to.y];
  return pts;
}
const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
/** Arbre de fils d'un nœud : la paire de broches la plus proche, puis chaque autre broche branchée en T. Rend { paths, links, junctions } ou null. */
function gridTree(g, ends, tag) {
  const man = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
  let bi = 0, bj = 1, bd = Infinity;
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) { const d = man([ends[i].x, ends[i].y], [ends[j].x, ends[j].y]); if (d < bd) { bd = d; bi = i; bj = j; } }
  const first = gridPath(g, ends[bi], ends[bj]);
  if (!first) return null;
  const own = { H: new Uint8Array(g.H.length), V: new Uint8Array(g.V.length) };
  markPath(g, first, own.H, own.V);
  const paths = [first], links = [{ pts: first, u: ends[bi].id, v: ends[bj].id }], junctions = [];
  const left = ends.filter((_, i) => i !== bi && i !== bj);
  while (left.length) {
    const near = e => Math.min(...paths.flat().map(p => man(p, [e.x, e.y])));
    left.sort((a, b) => near(a) - near(b));
    const e = left.shift(), pts = gridPath(g, e, null, own);
    if (!pts) return null;
    const t = pts[pts.length - 1];
    // Jonction : le fil touché est coupé en deux liaisons au point d'accroche.
    let jid = junctions.find(j => same([j.x, j.y], t))?.id;
    if (!jid) {
      const li = links.findIndex(l => l.pts.some((p, i) => i && onSeg(t, l.pts[i - 1], p)));
      if (li < 0) return null;
      jid = `J${tag}.${junctions.length}`;
      const l = links[li], i = l.pts.findIndex((p, j) => j && onSeg(t, l.pts[j - 1], p));
      const A = [...l.pts.slice(0, i), t], B = [t, ...l.pts.slice(same(l.pts[i], t) ? i + 1 : i)];
      links.splice(li, 1, { pts: A, u: l.u, v: jid }, { pts: B, u: jid, v: l.v });
      junctions.push({ id: jid, x: t[0], y: t[1] });
    }
    paths.push(pts); links.push({ pts, u: e.id, v: jid });
    markPath(g, pts, own.H, own.V);
  }
  return { paths, links, junctions };
}

/* ---------------- Feuille ---------------- */
const FORMATS = { A4: [297, 210], A3: [420, 297] };
const fmtDate = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

/** Cadre avec repères de zones (1, 2, 3… / A, B, C…) et cartouche. */
export function frame(d, W, H, info, sheetNo, sheets) {
  const m = 10;
  d.rect(m, m, W - 2 * m, H - 2 * m, { w: 0.5 }); d.rect(m + 4, m + 4, W - 2 * m - 8, H - 2 * m - 8, { w: 0.25 });
  const nx = Math.round((W - 2 * m) / 50), ny = Math.round((H - 2 * m) / 50);
  for (let i = 0; i <= nx; i++) { const x = m + 4 + (W - 2 * m - 8) * i / nx; d.line([[x, m], [x, m + 4]], { w: 0.2 }); d.line([[x, H - m - 4], [x, H - m]], { w: 0.2 }); if (i < nx) { const cx = x + (W - 2 * m - 8) / nx / 2; d.text(cx, m + 3, String(i + 1), { s: 2, a: 'm' }); d.text(cx, H - m - 1, String(i + 1), { s: 2, a: 'm' }); } }
  for (let j = 0; j <= ny; j++) { const y = m + 4 + (H - 2 * m - 8) * j / ny; d.line([[m, y], [m + 4, y]], { w: 0.2 }); d.line([[W - m - 4, y], [W - m, y]], { w: 0.2 }); if (j < ny) { const cy = y + (H - 2 * m - 8) / ny / 2 + 0.7; const L = String.fromCharCode(65 + j); d.text(m + 2, cy, L, { s: 2, a: 'm' }); d.text(W - m - 2, cy, L, { s: 2, a: 'm' }); } }
  // Cartouche
  const tw = 110, th = 26, x = W - m - 4 - tw, y = H - m - 4 - th;
  d.rect(x, y, tw, th, { w: 0.4, fill: '#fff' });
  d.line([[x, y + 9], [x + tw, y + 9]], { w: 0.25 }); d.line([[x, y + 17.5], [x + tw, y + 17.5]], { w: 0.25 });
  d.line([[x + 70, y + 9], [x + 70, y + th]], { w: 0.25 }); d.line([[x + 42, y + 17.5], [x + 42, y + th]], { w: 0.25 });
  d.text(x + 2, y + 3.4, tl('Projet'), { s: 1.6 }); d.text(x + 2, y + 7.6, info.title, { s: 3.2, b: true });
  d.text(x + 2, y + 11.8, tl('Document'), { s: 1.6 }); d.text(x + 2, y + 15.9, info.doc, { s: 2.6, b: true });
  d.text(x + 72, y + 11.8, 'Date', { s: 1.6 }); d.text(x + 72, y + 15.9, info.date, { s: 2.4 });
  d.text(x + 2, y + 20.4, tl('Format · échelle'), { s: 1.6 }); d.text(x + 2, y + 24.3, info.scale, { s: 2.2 });
  d.text(x + 44, y + 20.4, tl('Cartes'), { s: 1.6 }); d.text(x + 44, y + 24.3, info.boards, { s: 2.2 });
  d.text(x + 72, y + 20.4, tl('Feuille'), { s: 1.6 }); d.text(x + 72, y + 24.3, `${sheetNo} / ${sheets}`, { s: 2.4, b: true });
  d.text(x + tw - 2, y + 24.3, 'Jollof Studio', { s: 2.2, b: true, a: 'r' });
  // Tampon du vérificateur (seulement si l'application le donne) : le document dit s'il décrit un montage sûr.
  if (info.check) {
    d.rect(x, y - 7, tw, 6, { w: info.check.ok ? 0.4 : 0.7, fill: '#fff' });
    d.text(x + 2, y - 2.6, info.check.text, { s: 2.2, b: true });
  }
  return { x0: m + 6, y0: m + 6, x1: W - m - 6, y1: H - m - 6, tb: [x, y - (info.check ? 7 : 0), x + tw, y + th] };
}

/**
 * Disposition du schéma, sans feuille : symboles placés (en mm), nœuds, fils.
 * o : { comps, wires, netNames, describe(c) → { title, ref }, blocks, live: bool }
 * live : la vue en direct relie aussi par des fils, avec des jonctions, les nœuds de signal de plus de
 * deux broches (le schéma imprimé garde leurs étiquettes) ; links, stubs et junctions servent au courant animé.
 */
export function layoutSchematic(o) { return layoutOf(o); }
function layoutOf(o) {
  // Le dessin suit le câblage : un bouton enfoncé ou un relais collé ne fusionne pas les nœuds de part et d'autre
  // de son contact (son symbole montre le contact fermé).
  const A = analyze(o.comps, o.wires, { open: true });
  const comps = o.comps.filter(c => !isBreadboard(c) && Object.keys(c.pins).length);
  const boards = comps.filter(c => boardOf(c));
  const { nets, of } = buildNets(comps, A, o.netNames || {});
  // Disposition du tapis, resserrée : les symboles gardent leur place relative, l'écartement vient des collisions.
  const pos = c => [c.group.position.x * SHEET_SCALE, c.group.position.z * SHEET_SCALE];
  const mainBoard = c => { if (!boards.length) return null; const [x, y] = pos(c); return boards.reduce((a, b) => (Math.hypot(pos(b)[0] - x, pos(b)[1] - y) < Math.hypot(pos(a)[0] - x, pos(a)[1] - y) ? b : a)); };

  // Symbole de chaque composant.
  const syms = new Map();
  for (const c of comps) {
    const desc = o.describe(c), pk = PKG_SYMBOLS[c.type], kind = SYMBOL_OF(c.type) || (pk && pk.kind);
    let s = pk && pk.make ? pk.make(c) : null;
    if (s) { /* symbole dessiné par le paquet */ } else if (kind) s = SYMBOLS[kind](c, LED_COLOR[c.type] || VALUE[c.type] || (pk && pk.value) || '');
    else { const mb = mainBoard(c); s = block(c, c.name, boardOf(c) ? boardOf(c).label : desc.title, mb && mb !== c ? pos(mb)[0] > pos(c)[0] : false); }
    // Place réservée aux étiquettes et symboles d'alimentation, dans le prolongement des broches.
    const box = [...s.box];
    for (const [k, p] of Object.entries(s.pins)) {
      const net = of({ comp: c, key: k });
      const len = !net || net.pins.length < 2 ? 1.5 : net.kind === 'gnd' ? G + 3.6 : net.kind === 'pwr' ? G + 2 + textWidth(net.name, 1.9) : G + 3 + textWidth(net.name, 1.8);
      const [dx, dy] = DIR[p.dir], ex = p.x + dx * len, ey = p.y + dy * len;
      box[0] = Math.min(box[0], ex - (dy ? 2 : 0)); box[2] = Math.max(box[2], ex + (dy ? 2 : 0));
      box[1] = Math.min(box[1], ey - (dx ? 2 : 0)); box[3] = Math.max(box[3], ey + (dx ? 2 : 0));
    }
    syms.set(c, { ...s, lbox: box, ox: 0, oy: 0 });
  }

  // Placement : chaque symbole au plus près de la place du composant sur le tapis, sans chevauchement.
  const placed = [], M = 3;
  const free = (s, ox, oy) => { const b = [s.lbox[0] + ox - M, s.lbox[1] + oy - M, s.lbox[2] + ox + M, s.lbox[3] + oy + M]; return !placed.some(p => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]); };
  const order0 = [...boards, ...comps.filter(c => !boards.includes(c)).sort((a, b) => { const ma = mainBoard(a), mb = mainBoard(b); const da = ma ? Math.hypot(pos(a)[0] - pos(ma)[0], pos(a)[1] - pos(ma)[1]) : 0, db = mb ? Math.hypot(pos(b)[0] - pos(mb)[0], pos(b)[1] - pos(mb)[1]) : 0; return da - db; })];
  // Vue en direct (o.prev) : un symbole dont le composant n'a pas bougé reprend sa place d'avant, et passe en premier ;
  // le composant déplacé ou ajouté se cale autour. Ainsi rien ne saute quand on édite le schéma.
  const prevOf = c => { const p = o.prev && o.prev.get(c); return p && p.x === c.group.position.x && p.z === c.group.position.z ? p : null; };
  const order = o.prev ? [...order0.filter(prevOf), ...order0.filter(c => !prevOf(c))] : order0;
  for (const c of order) {
    const s = syms.get(c), [tx, ty] = pos(c), cx = (s.box[0] + s.box[2]) / 2, cy = (s.box[1] + s.box[3]) / 2;
    const p0 = prevOf(c);
    let best = p0 && free(s, p0.ox, p0.oy) ? [p0.ox, p0.oy] : null;
    for (let i = 0; i < 1200 && !best; i++) {
      const a = i * 0.62, r = i === 0 ? 0 : 2 + i * 0.9;
      const ox = snap(tx - cx + Math.cos(a) * r), oy = snap(ty - cy + Math.sin(a) * r);
      if (free(s, ox, oy)) best = [ox, oy];
    }
    if (!best) best = [snap(tx), snap(ty)];
    [s.ox, s.oy] = best;
    placed.push([s.lbox[0] + s.ox, s.lbox[1] + s.oy, s.lbox[2] + s.ox, s.lbox[3] + s.oy]);
  }

  // Fils des liaisons simples (deux broches, hors alimentations) ; étiquettes pour les autres.
  const abs = (c, k) => { const s = syms.get(c), p = s.pins[k]; return { x: p.x + s.ox, y: p.y + s.oy, dir: p.dir }; };
  // Obstacles : symboles avec leurs textes, et symboles d'alimentation ou de masse au bout des broches.
  const bodies = [...syms.values()].map(s => [s.box[0] + s.ox, s.box[1] + s.oy, s.box[2] + s.ox, s.box[3] + s.oy]);
  const bodyNet = bodies.map(() => null); // nœud dont l'obstacle est l'étiquette (null : symbole)
  for (const [c, s] of syms) for (const k of Object.keys(s.pins)) {
    // Seules les liaisons simples (deux broches) peuvent devenir des fils ; les autres auront symbole ou étiquette.
    const net = of({ comp: c, key: k }); if (!net || net.pins.length < 2 || (net.kind === 'sig' && net.pins.length === 2)) continue;
    const p = s.pins[k], [dx, dy] = DIR[p.dir], len = net.kind === 'gnd' ? G + 1.6 : net.kind === 'pwr' ? G + 1.4 + textWidth(net.name, 1.75) : G + 3.4 + textWidth(net.name, 1.6);
    const x0 = p.x + s.ox + dx * 0.3, y0 = p.y + s.oy + dy * 0.3, x1 = p.x + s.ox + dx * len, y1 = p.y + s.oy + dy * len;
    bodies.push([Math.min(x0, x1) - (dy ? 1.3 : 0), Math.min(y0, y1) - (dx ? 1.3 : 0), Math.max(x0, x1) + (dy ? 1.3 : 0), Math.max(y0, y1) + (dx ? 1.3 : 0)]);
    bodyNet.push(net);
  }
  const pinEnds = []; for (const [c, s] of syms) for (const k of Object.keys(s.pins)) { const p = abs(c, k); pinEnds.push([p.x, p.y]); }
  const wires = [], routed = new Set();
  const sigs = nets.filter(n => n.kind === 'sig' && n.pins.length === 2).sort((a, b) => { const d = n => { const p = abs(n.pins[0].comp, n.pins[0].key), q = abs(n.pins[1].comp, n.pins[1].key); return Math.abs(p.x - q.x) + Math.abs(p.y - q.y); }; return d(a) - d(b); });
  const links = [], junctions = [], ref = p => `${p.comp.id}|${p.key}`;
  for (const n of sigs) {
    const pts = route(abs(n.pins[0].comp, n.pins[0].key), abs(n.pins[1].comp, n.pins[1].key), bodies, wires, pinEnds);
    if (pts) { wires.push(pts); routed.add(n); links.push({ net: n, pts, u: ref(n.pins[0]), v: ref(n.pins[1]) }); }
  }
  if (o.live) {
    // Obstacles : symboles, alimentations et masses ; pas les étiquettes réservées des nœuds de signal (ils deviennent des fils).
    const obst = bodies.filter((_, i) => !bodyNet[i] || bodyNet[i].kind !== 'sig');
    // Un fil du premier passage qui en touche un autre en T (on croirait à une jonction) est retracé sur la grille.
    const bend = (w, i) => i === 0 || i === w.length - 1 || !((Math.abs(w[i - 1][0] - w[i][0]) < 1e-6 && Math.abs(w[i][0] - w[i + 1][0]) < 1e-6) || (Math.abs(w[i - 1][1] - w[i][1]) < 1e-6 && Math.abs(w[i][1] - w[i + 1][1]) < 1e-6));
    const touches = (w, o) => w.some((p, i) => bend(w, i) && o.some((q, j) => j && onSeg(p, o[j - 1], q)));
    for (let i = links.length - 1; i >= 0; i--) {
      const l = links[i];
      if (!links.some(m => m !== l && (touches(l.pts, m.pts) || touches(m.pts, l.pts)))) continue;
      links.splice(i, 1); wires.splice(wires.indexOf(l.pts), 1); routed.delete(l.net);
    }
    const g = makeGrid([...syms.values()].map(s => [s.box[0] + s.ox, s.box[1] + s.oy, s.box[2] + s.ox, s.box[3] + s.oy]), obst, pinEnds);
    wires.forEach(w => markPath(g, w));
    // Liaisons simples que le premier passage n'a pas su tracer.
    for (const n of sigs) {
      if (routed.has(n)) continue;
      const pts = gridPath(g, abs(n.pins[0].comp, n.pins[0].key), abs(n.pins[1].comp, n.pins[1].key));
      if (pts) { wires.push(pts); markPath(g, pts); routed.add(n); links.push({ net: n, pts, u: ref(n.pins[0]), v: ref(n.pins[1]) }); }
    }
    // Nœuds de plus de deux broches : un arbre de fils (le plus petit nœud d'abord), sinon leurs étiquettes.
    const spread = n => { const ps = n.pins.map(p => abs(p.comp, p.key)), xs = ps.map(p => p.x), ys = ps.map(p => p.y); return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys); };
    const multi = nets.filter(n => n.kind === 'sig' && n.pins.length > 2 && n.pins.length <= 16).sort((a, b) => spread(a) - spread(b));
    // Un ordre donné : les arbres tracés (chacun gêne les suivants).
    const attempt = order => {
      const g2 = { ...g, H: g.H.slice(), V: g.V.slice() }, res = [];
      order.forEach((n, i) => {
        const t = gridTree(g2, n.pins.map(p => ({ ...abs(p.comp, p.key), id: ref(p) })), `${i}`);
        if (t) { t.paths.forEach(p => markPath(g2, p)); res.push({ n, t }); }
      });
      return res;
    };
    let best = attempt(multi);
    // Des nœuds restés sans fil : on réessaie en les traçant en premier.
    for (let k = 0; k < 2 && best.length < multi.length; k++) {
      const failed = multi.filter(n => !best.some(r => r.n === n)), other = multi.filter(n => !failed.includes(n));
      const next = attempt(k === 0 ? [...failed, ...other] : [...multi].reverse());
      if (next.length > best.length) best = next;
    }
    for (const { n, t } of best) {
      wires.push(...t.paths); routed.add(n);
      t.links.forEach(l => links.push({ net: n, ...l })); junctions.push(...t.junctions);
    }
  }
  // Bouts de fil vers les symboles d'alimentation, de masse ou les étiquettes : le courant y entre ou en sort.
  const stubs = [];
  for (const [c, s] of syms) for (const k of Object.keys(s.pins)) {
    const net = of({ comp: c, key: k }); if (!net || net.pins.length < 2 || routed.has(net)) continue;
    const p = abs(c, k), [dx, dy] = DIR[p.dir];
    stubs.push({ net, id: ref({ comp: c, key: k }), pin: { comp: c, key: k }, pts: [[p.x, p.y], [p.x + dx * G, p.y + dy * G]] });
  }

  // Blocs du montage : un cadre en tirets autour des symboles de leurs composants.
  const frames = (o.blocks || []).map(b => {
    const ss = b.comps.map(c => syms.get(c)).filter(Boolean);
    if (!ss.length) return null;
    const r = [Math.min(...ss.map(x => x.lbox[0] + x.ox)) - 3, Math.min(...ss.map(x => x.lbox[1] + x.oy)) - 7, Math.max(...ss.map(x => x.lbox[2] + x.ox)) + 3, Math.max(...ss.map(x => x.lbox[3] + x.oy)) + 3];
    return { name: b.name, r };
  }).filter(Boolean);
  return { A, comps, boards, nets, of, syms, abs, wires, routed, links, stubs, junctions, frames, placed };
}

/** Dessine les cadres de blocs, les symboles, les fils et les extrémités de L avec la transformation courante de d. */
export function paintCircuit(d, L, o = {}) {
  const { syms, wires, routed, of, abs, frames, junctions } = L, k = d.k, ox = d.tx, oy = d.ty;
  for (const f of frames) {
    const [x0, y0, x1, y1] = f.r;
    d.rect(x0, y0, x1 - x0, y1 - y0, { w: 0.3, dash: [2, 1.2] });
    d.text(x0 + 1.5, y0 + 3.6, f.name, { s: 2.6, b: true });
  }
  if (o.symbols !== false) for (const [c, s] of syms) {
    const sub = new Draw(); sub.setTransform(k, ox + s.ox * k, oy + s.oy * k); s.draw(sub); d.ops.push(...sub.ops);
  }
  wires.forEach(w => d.line(w, { w: WIRE }));
  junctions.forEach(j => d.circle(j.x, j.y, 0.55, { fill: '#000', w: 0.1 }));
  // Extrémités : symbole d'alimentation, de masse, étiquette ou croix « non connectée ».
  for (const [c, s] of syms) for (const k2 of Object.keys(s.pins)) {
    const p = abs(c, k2), net = of({ comp: c, key: k2 }), [dx, dy] = DIR[p.dir];
    if (!net || net.pins.length < 2) {
      if (!boardOf(c)) { const x = p.x, y = p.y; d.line([[x - 0.8, y - 0.8], [x + 0.8, y + 0.8]], { w: 0.25 }); d.line([[x - 0.8, y + 0.8], [x + 0.8, y - 0.8]], { w: 0.25 }); }
      continue;
    }
    if (routed.has(net)) continue;
    const ex = p.x + dx * G, ey = p.y + dy * G;
    d.line([[p.x, p.y], [ex, ey]], { w: WIRE });
    if (net.kind === 'gnd') {
      // Masse : trois traits décroissants, perpendiculaires au fil.
      const px = -dy, py = dx;
      // Taille limitée à une rangée (2,54 mm) : deux broches voisines ne se chevauchent pas.
      [[1.2, 0], [0.75, 0.55], [0.3, 1.1]].forEach(([h, o2]) => d.line([[ex + dx * o2 + px * h, ey + dy * o2 + py * h], [ex + dx * o2 - px * h, ey + dy * o2 - py * h]], { w: LW }));
      if (net.name !== 'GND') d.text(ex + dx * 1.8 + (dy ? 1.6 : 0), ey + dy * 1.8 + (dx ? 0.55 : 0), net.name, { s: 1.5, a: dx < 0 ? 'r' : 'l' });
    } else if (net.kind === 'pwr') {
      // Alimentation : barre perpendiculaire au fil, tension écrite au-delà.
      const px = -dy, py = dx;
      d.line([[ex + px * 1.15, ey + py * 1.15], [ex - px * 1.15, ey - py * 1.15]], { w: 0.45 });
      if (dx) d.text(ex + dx * 1.0, ey + 0.62, net.name, { s: 1.75, b: true, a: dx < 0 ? 'r' : 'l' });
      else d.text(ex, ey + dy * 1.6 + (dy > 0 ? 1.6 : 0), net.name, { s: 1.9, b: true, a: 'm' });
    } else {
      // Étiquette de nœud : drapeau qui pointe vers la broche.
      const tw = textWidth(net.name, 1.6) + 2, h = 1.1;
      if (dx) {
        const x0 = ex, x1 = ex + dx * (tw + 1.2);
        d.line([[x0, ey], [x0 + dx * 1.2, ey - h], [x1, ey - h], [x1, ey + h], [x0 + dx * 1.2, ey + h]], { w: 0.22, close: true });
        d.text((x0 + dx * 1.2 + x1) / 2, ey + 0.57, net.name, { s: 1.6, a: 'm' });
      } else {
        const y1 = ey + dy * (tw + 1.2);
        d.line([[ex, ey], [ex - h, ey + dy * 1.2], [ex - h, y1], [ex + h, y1], [ex + h, ey + dy * 1.2]], { w: 0.22, close: true });
        d.text(ex + 0.57, (ey + dy * 1.2 + y1) / 2, net.name, { s: 1.6, a: 'm', rot: -90 });
      }
    }
  }
}

/**
 * État d'un composant qui change son symbole dans la vue en direct (null : symbole fixe) : bouton appuyé,
 * curseur du potentiomètre, relais collé, buzzer ou haut-parleur qui sonne, moteur qui tourne, servo, pas à pas.
 * Le schéma imprimé garde les symboles au repos.
 */
export function liveState(c) {
  const i = c.inp || {};
  switch (c.type) {
    case 'button': case 'cylsensor': case 'pressostat': return { pressed: !!i.pressed };
    case 'pot': return { pos: Math.round(i.pos ?? 50) };
    case 'relay': return { on: !!c.relayOn };
    case 'buzzer': case 'speaker': return { on: !!(c.actR && c.actR.live) };
    case 'dcmotor': return { dir: Math.abs(c.motorV || 0) < 0.02 ? 0 : Math.sign(c.motorV) };
    case 'fan': case 'pump': case 'vibro': return { on: Math.abs(c.motorV || 0) >= 0.02 };
    // Servo, pas à pas : leur partie mobile est animée image par image par-dessus le dessin (live.js).
    case 'servo': case 'stepper': return { anim: true };
    default: return null;
  }
}
/** Le composant est « actif » dans cet état (dessiné en couleur dans la vue en direct). */
export const liveActive = st => !!(st && (st.pressed || st.on || st.dir));
/** Ordres de dessin d'un symbole dans l'état donné, en coordonnées de la disposition (mm). */
export function drawSymbol(L, c, st) {
  const s = L.syms.get(c); if (!s) return [];
  const d = new Draw(); d.setTransform(1, s.ox, s.oy); s.draw(d, st || undefined);
  return d.ops;
}

/**
 * Construit les pages du schéma.
 * o : { comps, wires, netNames, title, format: 'auto' | 'A4' | 'A3', describe(c) → { title, ref } , lists: bool }
 */
export function buildSchematic(o) {
  const L = layoutSchematic({ ...o, live: false });
  const { comps, boards, nets, wires, frames, placed } = L;
  // Mise à l'échelle sur la feuille.
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  const grow = (x, y) => { lo = [Math.min(lo[0], x), Math.min(lo[1], y)]; hi = [Math.max(hi[0], x), Math.max(hi[1], y)]; };
  placed.forEach(b => { grow(b[0], b[1]); grow(b[2], b[3]); });
  wires.forEach(w => w.forEach(p => grow(p[0], p[1])));
  frames.forEach(f => { grow(f.r[0], f.r[1]); grow(f.r[2], f.r[3]); });
  if (!placed.length) { lo = [0, 0]; hi = [10, 10]; }
  const bw = hi[0] - lo[0] + 6, bh = hi[1] - lo[1] + 6;
  const fit = f => { const [W, H] = FORMATS[f]; return Math.min(1.5, (W - 32) / bw, (H - 32 - 30) / bh); };
  const format = o.format === 'A4' || o.format === 'A3' ? o.format : fit('A4') >= 0.8 || fit('A3') <= fit('A4') ? 'A4' : 'A3';
  const [W, H] = FORMATS[format], k = fit(format);
  const info = { title: o.title || tl('Sans titre'), date: fmtDate(new Date()), boards: boards.map(b => b.name).join(', ') || '—', check: o.check || null };
  const sheets = o.lists ? 2 : 1;

  /* --- Page 1 : le schéma --- */
  const d = new Draw();
  const area = frame(d, W, H, { ...info, doc: tl('Schéma électrique'), scale: tl('{0} paysage · {1}', format, Math.abs(k - 1) < 0.01 ? '1:1' : tl('{0} à {1} %', k < 1 ? tl('réduit') : tl('agrandi'), Math.round(k * 100))) }, 1, sheets);
  const ox = area.x0 + ((area.x1 - area.x0) - (hi[0] - lo[0]) * k) / 2 - lo[0] * k;
  const oy = area.y0 + Math.max(0, ((area.y1 - 30 - area.y0) - (hi[1] - lo[1]) * k) / 2) - lo[1] * k;
  d.setTransform(k, ox, oy);
  paintCircuit(d, L);
  d.setTransform(1, 0, 0);
  if (!comps.length) d.text(W / 2, H / 2, tl('Aucun composant : ajoutez une carte et des composants au montage.'), { s: 4, a: 'm' });
  else d.text(area.x0, area.y1 - 1, tl('Liaisons de même nom reliées · symboles selon CEI 60617 · généré par Jollof Studio'), { s: 1.8, color: '#555' });
  const pages = [{ w: W, h: H, ops: d.ops }];

  /* --- Page 2 : nomenclature et liste des connexions --- */
  if (o.lists) {
    const named = nets.filter(n => n.pins.length > 1).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'fr', { numeric: true }) : a.kind === 'pwr' ? -1 : b.kind === 'pwr' ? 1 : a.kind === 'gnd' ? -1 : 1));
    const parts = o.comps.filter(c => Object.keys(c.pins).length || c.custom).slice().sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
    const rowsN = parts.map(c => [c.name, o.describe(c).title, o.describe(c).value || VALUE[c.type] || (LED_COLOR[c.type] || '')]);
    const rowsC = named.map(n => [n.name, n.pins.map(p => `${p.comp.name}.${base(p.key)}`).join(', ')]);
    let pageNo = 2, pi = 0, ci = 0;
    const out = [];
    while (pi < rowsN.length || ci < rowsC.length || pageNo === 2) {
      const pd = new Draw(), ar = frame(pd, W, H, { ...info, doc: tl('Nomenclature et connexions'), scale: tl('{0} paysage', format) }, pageNo, 0);
      const colW = (ar.x1 - ar.x0 - 8) / 2, rh = 5, top = ar.y0 + 6, bottom = ar.y1 - 32;
      const table = (x, title, heads, widths, rows, from) => {
        pd.text(x, top, title, { s: 3, b: true });
        let y = top + 4; pd.rect(x, y, colW, rh, { w: 0.25, fill: '#eee' });
        let cx = x; heads.forEach((h, i) => { pd.text(cx + 1.2, y + 3.5, h, { s: 2, b: true }); cx += widths[i]; });
        y += rh; let i = from;
        for (; i < rows.length; i++) {
          // Texte long : coupé sur plusieurs lignes après une virgule (ou une espace).
          const cells = rows[i].map((v, j) => {
            const parts = String(v).split(' ').map((w, k, all) => (k < all.length - 1 ? w + ' ' : w)), out = [''];
            for (const p of parts) { if (out[out.length - 1] && textWidth(out[out.length - 1] + p, 2) > widths[j] - 2.4) out.push(''); out[out.length - 1] += p; }
            return out.map(l => l.trim());
          });
          const h = rh + (Math.max(...cells.map(cl => cl.length)) - 1) * 3.2;
          if (y + h > bottom) break;
          pd.rect(x, y, colW, h, { w: 0.15 });
          let xx = x; cells.forEach((cl, j) => { cl.forEach((t, li) => pd.text(xx + 1.2, y + 3.5 + li * 3.2, t, { s: 2, b: j === 0 })); xx += widths[j]; });
          y += h;
        }
        let xx = x; widths.slice(0, -1).forEach(wd => { xx += wd; pd.line([[xx, top + 4], [xx, y]], { w: 0.15 }); });
        return i;
      };
      pi = table(ar.x0, tl('Nomenclature'), [tl('Repère'), tl('Désignation'), tl('Valeur / type')], [colW * 0.18, colW * 0.52, colW * 0.3], rowsN, pi);
      ci = table(ar.x0 + colW + 8, tl('Connexions'), [tl('Nœud'), tl('Broches reliées')], [colW * 0.22, colW * 0.78], rowsC, ci);
      out.push({ w: W, h: H, ops: pd.ops, pd });
      pageNo++;
      if (pageNo > 12) break;
    }
    // Numérotation définitive des feuilles.
    const total = 1 + out.length;
    const fix = (ops, no) => ops.forEach(op => { if (op.t === 'text' && /^\d+ \/ \d+$/.test(op.str)) op.str = `${no} / ${total}`; });
    fix(pages[0].ops, 1); out.forEach((p, i) => { fix(p.ops, i + 2); pages.push({ w: p.w, h: p.h, ops: p.ops }); });
  }
  return { pages, format, scale: k, stats: { comps: comps.length, nets: nets.filter(n => n.pins.length > 1).length, wires: wires.length } };
}
