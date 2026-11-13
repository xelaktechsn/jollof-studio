// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Programme Arduino construit à partir des blocs (JSON de Blockly.serialization.workspaces.save).
// Pur : n'importe pas Blockly et tourne sous Node. Les composants passent par le contexte des
// règles (rules.js) : mêmes bibliothèques, mêmes noms de broches que le reste de l'application.
import { isMotor } from '../../sim/parts.js';
import { driveBoard } from '../../sim/drive.js';
import { createGenContext, ident, cstr, RESERVED, SIGNALS, ACTIONS, signalOf, isSensor, isActuator } from '../rules.js';
import { boardOf, codePin, base } from '../../sim/boards.js';
import { tl, isEn, quote } from '../../i18n/index.js';
import { B, F } from './types.js';
import { isEsp32 } from '../api.js';

const MK = '⁣', MKRX = /⁣(\d+)⁣/g; // repère invisible ligne → bloc, retiré après l'assemblage
// Priorités du C++ (plus petit = plus lié) : décident des parenthèses.
const O = { ATOM: 0, UNARY: 2, MUL: 3, ADD: 4, REL: 6, EQ: 7, AND: 11, OR: 12, COND: 13 };
const RANK = { bool: 0, int: 1, long: 2, ulong: 3, float: 4, String: 5 };
const CTYPE = { bool: 'bool', int: 'int', long: 'long', ulong: 'unsigned long', float: 'float', String: 'String' };
const wider = (a, b) => (!a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b);
const numType = (...ts) => (ts.includes('String') ? 'String' : ts.includes('float') ? 'float' : ts.includes('ulong') ? 'ulong' : ts.includes('long') ? 'long' : 'int');
const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'goto', 'true', 'false', 'new', 'delete',
  'class', 'struct', 'union', 'enum', 'typedef', 'sizeof', 'static', 'const', 'unsigned', 'signed', 'short', 'double', 'auto', 'this', 'public', 'private', 'template',
  'operator', 'namespace', 'using', 'volatile', 'extern', 'register', 'inline', 'boolean', 'word', 'size_t', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'and', 'or', 'not']);
const COUNTERS = ['i', 'j', 'k', 'm', 'n'];
/** Couleurs proposées aux LED RGB et rubans (un menu plutôt qu'un sélecteur, plus simple au collège). */
export const COLORS = [[tl('rouge'), '#ff0000'], [tl('orange'), '#ff8800'], [tl('jaune'), '#ffdd00'], [tl('vert'), '#00ff00'], [tl('cyan'), '#00ffff'],
  [tl('bleu'), '#0000ff'], [tl('violet'), '#8800ff'], [tl('rose'), '#ff3399'], [tl('blanc'), '#ffffff']];

/** Actions d'un effecteur en blocs : celles des règles (sans « suit la mesure »), écrans détaillés. arg : null | { kind: num | text | color, def, unit }. */
export function visualActs(type) {
  const text = def => ({ kind: 'text', def });
  if (type === 'lcd1602') return [{ key: 'line0', label: tl('affiche sur la ligne 1'), arg: text(tl('Bonjour')) }, { key: 'line1', label: tl('affiche sur la ligne 2'), arg: text('') }, { key: 'clear', label: tl('s’efface'), arg: null }];
  if (type === 'oled') return [{ key: 'text', label: tl('affiche la ligne'), arg: text(tl('Bonjour')) }, { key: 'clear', label: tl('s’efface'), arg: null }];
  return Object.entries(ACTIONS[type] || {}).filter(([k, a]) => !a.follow && k !== 'value').map(([k, a]) => ({ key: k, label: a.label, arg: a.arg ? { ...a.arg } : null }));
}

/* ---------- Lecture du montage ---------- */
/** Carte qui commande un composant (un moteur passe par son pilote L298N). */
function compBoard(c, cx) {
  if (isMotor(c)) return driveBoard(c, cx.A, cx.inspect); // moteur, ventilateur… : la carte de son pilote, transistor ou relais
  return cx.inspect(c).board;
}
/** Broche de la carte → broches de composants qui y arrivent. */
function pinUsers(board, cx) {
  const alias = new Map(boardOf(board).alias || []), m = new Map();
  for (const c of cx.comps) {
    if (boardOf(c)) continue;
    const io = (cx.inspect(c) || {}).io || {}, n = Object.keys(io).length;
    for (const [k, g] of Object.entries(io)) {
      if (!g || g.comp !== board) continue;
      const key = alias.get(base(g.key)) || base(g.key);
      if (!m.has(key)) m.set(key, []);
      m.get(key).push({ comp: c, key: k, n });
    }
  }
  return m;
}

/**
 * Ce que l'éditeur de blocs propose pour cette carte (sérialisable, sans Blockly) :
 * broches « D13 (LED1) » et composants reliés, avec leurs actions et leurs mesures.
 * cx : comme pour generate() — { comps, A, inspect }.
 */
export function visualContext(board, cx) {
  const prof = boardOf(board), alias = new Set((prof.alias || []).map(a => a[0])), users = pinUsers(board, cx);
  const pins = Object.entries(prof.gpio).filter(([k, g]) => !g.caps.has('flash') && !alias.has(k)).map(([k, g]) => {
    const u = users.get(k) || [], who = [...new Set(u.map(x => (x.n > 1 ? `${x.comp.name} ${x.key}` : x.comp.name)))].join(', ');
    return { key: k, label: who ? `${k} (${who})` : k, caps: [...g.caps], types: [...new Set(u.map(x => x.comp.type))] };
  });
  const comps = cx.comps.filter(c => (isSensor(c) || isActuator(c)) && compBoard(c, cx) === board).map(c => ({
    id: c.id, name: c.name, type: c.type,
    acts: isActuator(c) ? visualActs(c.type) : [],
    sigs: isSensor(c) ? Object.keys(SIGNALS[c.type]).map(k => { const s = signalOf(c.type, k, prof); return { key: k, label: s.label, kind: s.kind, unit: s.unit || '' }; }) : []
  }));
  return { board: { id: board.id, name: board.name, label: prof.label, adcMax: 2 ** (prof.adcRead || prof.adcBits || 10) - 1 }, pins, comps, colors: COLORS };
}

/* ---------- JSON de Blockly ---------- */
const fieldOf = (b, n) => (b && b.fields ? b.fields[n] : undefined);
const off = b => !b || b.enabled === false || (Array.isArray(b.disabledReasons) && b.disabledReasons.length > 0);
/** Bloc branché sur une entrée de valeur (sinon son ombre). */
const inputOf = (b, n) => { const i = b && b.inputs && b.inputs[n]; return !i ? null : i.block && !off(i.block) ? i.block : i.shadow || null; };
const stmtIn = (b, n) => (b && b.inputs && b.inputs[n] ? b.inputs[n].block || null : null);
function walk(b, fn) {
  if (!b) return;
  fn(b);
  for (const k in b.inputs || {}) { walk(b.inputs[k].block, fn); walk(b.inputs[k].shadow, fn); }
  if (b.next) walk(b.next.block, fn);
}
const commentLines = b => { const t = b && b.icons && b.icons.comment && b.icons.comment.text; return t ? String(t).replace(/⁣/g, '').split('\n').map(l => `// ${l}`.trimEnd()) : []; };
const indent = ls => ls.map(l => (l ? '  ' + l : l));
/** Nom de variable valable en C++ : accents retirés, espaces en _, mots réservés évités. */
function safeName(s) {
  let n = ident(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, '_')) || 'variable';
  if (KEYWORDS.has(n) || RESERVED.has(n)) n += '_v';
  return n;
}

/**
 * Programme de la carte `board` d'après ses blocs.
 * Retourne { code, map: Map<n° de ligne (1…), id du bloc>, warnings: [{ id, text }] }.
 * Les types des variables sont déduits de leurs affectations (quelques passes, jusqu'à stabilité).
 */
export function generateVisual(board, wsJson, cx) {
  let types = new Map(), r = null;
  for (let pass = 0; pass < 6; pass++) {
    r = build(board, wsJson || {}, cx, types);
    const next = new Map(types);
    for (const [id, t] of r.assigned) next.set(id, wider(next.get(id), t));
    if ([...next].every(([id, t]) => types.get(id) === t)) break;
    types = next;
  }
  return { code: r.code, map: r.map, warnings: r.warnings };
}

function build(board, ws, cx, types) {
  const g = createGenContext(board, cx), prof = g.prof, users = pinUsers(board, cx);
  const warnings = [], ids = [], assigned = new Map(), modes = new Map(), servos = new Map();
  const warn = (b, text) => { if (b && !warnings.some(w => w.id === b.id && w.text === text)) warnings.push({ id: b.id, text }); };
  const res = (code, order = O.ATOM, type = 'int', lit = null) => ({ code, order, type, lit });
  const ZERO = res('0', O.ATOM, 'int', 'num'), FALSE = res('false', O.ATOM, 'bool');
  const wrap = (r, max) => (r.order > max ? `(${r.code})` : r.code);
  let pending = []; // commentaires des blocs de valeur, écrits avant leur instruction
  // Écrans OLED dessinés depuis le dernier envoi (objet → minuterie d'envoi) : l'image part une fois, pas à chaque ligne.
  const drawn = new Map();
  const flushNow = () => { const out = [...drawn.keys()].map(o => `${o}.display();`); drawn.clear(); return out; };
  // Mesures lues plusieurs fois dans un même événement : lues une fois, au début (hoist : clé → nom, reads : lignes).
  let hoist = new Map(), reads = [];
  const LOOPY = new Set([B.DELAY, 'controls_repeat_ext', 'controls_repeat', 'controls_whileUntil', 'controls_for']);
  /** Mesures à lire une seule fois dans cet événement ; aucune s'il attend ou boucle (la mesure doit rester fraîche). */
  function plan(first) {
    const n = new Map(); let loopy = false;
    walk(first, b => {
      if (off(b)) return;
      if (LOOPY.has(b.type)) loopy = true;
      if (b.type === B.SIG_NUM || b.type === B.SIG_BOOL) { const k = `${fieldOf(b, F.COMP)}|${fieldOf(b, F.SIG)}`; n.set(k, (n.get(k) || 0) + 1); }
    });
    hoist = loopy ? new Map() : new Map([...n].filter(([, c]) => c > 1).map(([k]) => [k, null])); reads = [];
  }

  // Événements : le premier « au démarrage » et le premier « en boucle » ; autant de « toutes les N ms » qu'on veut.
  const top = ((ws.blocks && ws.blocks.blocks) || []).filter(b => !off(b));
  const setupB = top.find(b => b.type === B.SETUP), loopB = top.find(b => b.type === B.LOOP), every = top.filter(b => b.type === B.EVERY);
  top.forEach(b => {
    if ((b.type === B.SETUP && b !== setupB) || (b.type === B.LOOP && b !== loopB)) warn(b, tl('Un seul bloc {0} est utilisé : celui-ci est ignoré.', quote(b.type === B.SETUP ? tl('au démarrage') : tl('en boucle'))));
  });
  const roots = [setupB, loopB, ...every].filter(Boolean);

  // Variables utilisées : noms C++ réservés d'abord (les noms des broches s'écartent ensuite).
  const named = new Map(((ws.variables) || []).map(v => [v.id, v.name])), vars = new Map(), keep = new Set();
  roots.forEach(r => walk(r, b => {
    const f = fieldOf(b, 'VAR'), id = f && (f.id || f.name);
    if (id && !vars.has(id)) { const label = named.get(id) || f.name || 'variable', n = g.uniq(safeName(label)); vars.set(id, { id, name: n, label }); keep.add(n); }
  }));
  const varOf = b => { const f = fieldOf(b, 'VAR'); return (f && vars.get(f.id || f.name)) || null; };
  const assign = (v, t) => { if (v) assigned.set(v.id, wider(assigned.get(v.id), t)); };
  const conv = (r, t) => (t === 'String' && r.type !== 'String' ? `String(${r.code})` : r.code);

  /** Broche choisie dans le bloc : nom de la constante si un composant y est relié (LED1), sinon son numéro. */
  function pin(b, need) {
    const key = fieldOf(b, F.PIN);
    if (!key || !prof.gpio[key]) { warn(b, tl('Choisissez une broche de {0}.', board.name)); return null; }
    const u = (users.get(key) || [])[0], p = (u && g.pinConst(u.comp, u.key)) || codePin({ comp: board, key });
    if (need === 'out') modes.set(p, 'out');
    else if (need === 'in' && !modes.has(p)) modes.set(p, pullup(key) ? 'pullup' : 'in');
    return p;
  }
  /** Un bouton qui relie la broche à la masse, sans résistance de tirage : il faut INPUT_PULLUP. */
  function pullup(key) {
    if (!cx.A) return false;
    const ref = { comp: board, key }, sw = cx.A.members(ref).find(m => (m.comp.type === 'button' && (m.key === '1' || m.key === '2')) || (m.comp.type === 'joystick' && m.key === 'SW'));
    if (!sw || cx.A.wnet(ref).src.length) return false;
    return sw.comp.type === 'joystick' || cx.A.net({ comp: sw.comp, key: sw.key === '1' ? '2' : '1' }).gnd.length > 0;
  }
  const V = (b, n, def = ZERO) => { const x = inputOf(b, n); return x ? E(x) : def; };

  /* ---------- Expressions : { code, order, type, lit } ---------- */
  function E(b) {
    pending.push(...commentLines(b));
    switch (b.type) {
      case 'math_number': {
        const n = Number(fieldOf(b, 'NUM')), v = Number.isFinite(n) ? n : 0;
        return res(String(v), v < 0 ? O.UNARY : O.ATOM, Number.isInteger(v) ? (Math.abs(v) > 32767 ? 'long' : 'int') : 'float', 'num');
      }
      case 'text': return res(cstr(String(fieldOf(b, 'TEXT') ?? '').replace(/⁣/g, '')), O.ATOM, 'String', 'str');
      case 'text_join': {
        const n = b.extraState && b.extraState.itemCount != null ? b.extraState.itemCount : Object.keys(b.inputs || {}).length, parts = [];
        for (let i = 0; i < n; i++) { const x = inputOf(b, 'ADD' + i); if (x) parts.push(E(x)); }
        if (!parts.length) return res('""', O.ATOM, 'String', 'str');
        if (parts.length === 1) return parts[0].type === 'String' ? parts[0] : res(`String(${parts[0].code})`, O.ATOM, 'String');
        const codes = parts.map(r => (r.type === 'String' ? wrap(r, O.ADD) : `String(${r.code})`));
        if (parts[0].lit === 'str' && parts[1].lit === 'str') codes[0] = `String(${parts[0].code})`; // "a" + "b" ne compile pas en C++
        return res(codes.join(' + '), O.ADD, 'String');
      }
      case 'variables_get': { const v = varOf(b); return v ? res(v.name, O.ATOM, types.get(v.id) || 'int') : ZERO; }
      case 'logic_boolean': return res(fieldOf(b, 'BOOL') === 'FALSE' ? 'false' : 'true', O.ATOM, 'bool');
      case 'logic_negate': return res('!' + wrap(V(b, 'BOOL', FALSE), O.UNARY), O.UNARY, 'bool');
      case 'logic_operation': {
        const and = fieldOf(b, 'OP') !== 'OR', P = and ? O.AND : O.OR;
        const side = r => (r.order > P || (r.order >= O.AND && r.order !== P) ? `(${r.code})` : r.code); // && et || mêlés : parenthèses
        return res(`${side(V(b, 'A', FALSE))} ${and ? '&&' : '||'} ${side(V(b, 'B', FALSE))}`, P, 'bool');
      }
      case 'logic_compare': {
        const op = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' }[fieldOf(b, 'OP')] || '==', P = op === '==' || op === '!=' ? O.EQ : O.REL;
        return res(`${wrap(V(b, 'A'), P - 1)} ${op} ${wrap(V(b, 'B'), P - 1)}`, P, 'bool');
      }
      case 'math_arithmetic': {
        const op = fieldOf(b, 'OP'), a = V(b, 'A'), c = V(b, 'B');
        if (op === 'POWER') return res(`pow(${a.code}, ${c.code})`, O.ATOM, 'float');
        if (op === 'DIVIDE') { // division « vraie », comme dans Scratch : 7 / 2 = 3,5
          if (a.type === 'float' || c.type === 'float') return res(`${wrap(a, O.MUL)} / ${wrap(c, O.MUL - 1)}`, O.MUL, 'float');
          if (c.lit === 'num') return res(`${wrap(a, O.MUL)} / ${Number(c.code).toFixed(1)}`, O.MUL, 'float');
          if (a.lit === 'num') return res(`${Number(a.code).toFixed(1)} / ${wrap(c, O.MUL - 1)}`, O.MUL, 'float');
          return res(`(float) ${wrap(a, O.UNARY)} / ${wrap(c, O.MUL - 1)}`, O.MUL, 'float');
        }
        const sym = { MINUS: '-', MULTIPLY: '*' }[op] || '+', P = sym === '*' ? O.MUL : O.ADD;
        return res(`${wrap(a, P)} ${sym} ${wrap(c, P - 1)}`, P, numType(a.type, c.type));
      }
      case 'math_single': {
        const op = fieldOf(b, 'OP'), x = V(b, 'NUM');
        if (op === 'NEG') { const s = wrap(x, O.UNARY); return res('-' + (s.startsWith('-') ? `(${s})` : s), O.UNARY, numType(x.type)); }
        if (op === 'ABS') return res(`abs(${x.code})`, O.ATOM, numType(x.type));
        if (op === 'POW10') return res(`pow(10, ${x.code})`, O.ATOM, 'float');
        return res(`${{ LN: 'log', LOG10: 'log10', EXP: 'exp' }[op] || 'sqrt'}(${x.code})`, O.ATOM, 'float');
      }
      case 'math_round': { const op = fieldOf(b, 'OP'), x = V(b, 'NUM'); return res(`${op === 'ROUNDUP' ? 'ceil' : op === 'ROUNDDOWN' ? 'floor' : 'round'}(${x.code})`, O.ATOM, op === 'ROUND' ? 'int' : 'float'); }
      case 'math_modulo': {
        const a = V(b, 'DIVIDEND'), c = V(b, 'DIVISOR', res('1', O.ATOM, 'int', 'num'));
        return a.type === 'float' || c.type === 'float' ? res(`fmod(${a.code}, ${c.code})`, O.ATOM, 'float') : res(`${wrap(a, O.MUL)} % ${wrap(c, O.MUL - 1)}`, O.MUL, 'int');
      }
      case 'math_random_int': { // Blockly inclut la borne haute, random() l'exclut
        const a = V(b, 'FROM'), c = V(b, 'TO');
        return res(`random(${a.code}, ${c.lit === 'num' && Number.isInteger(+c.code) ? +c.code + 1 : `${wrap(c, O.ADD)} + 1`})`, O.ATOM, 'int');
      }
      case B.CONSTRAIN: case 'math_constrain': {
        const v = V(b, F.VALUE), lo = V(b, F.LOW), hi = V(b, F.HIGH, res('100', O.ATOM, 'int', 'num'));
        return res(`constrain(${v.code}, ${lo.code}, ${hi.code})`, O.ATOM, numType(v.type, lo.type, hi.type));
      }
      case B.MAP: return res(`map(${[F.VALUE, F.FROM_LOW, F.FROM_HIGH, F.TO_LOW, F.TO_HIGH].map(n => V(b, n).code).join(', ')})`, O.ATOM, 'int');
      case B.MILLIS: return res('millis()', O.ATOM, 'ulong');
      case B.LEVEL: return res(fieldOf(b, F.LEVEL) === 'LOW' ? 'LOW' : 'HIGH');
      case B.DREAD: { const p = pin(b, 'in'); return p ? res(`digitalRead(${p})`) : ZERO; }
      case B.AREAD: { const p = pin(b, null); return p ? res(`analogRead(${p})`) : ZERO; }
      case B.SIG_NUM: case B.SIG_BOOL: {
        const fb = b.type === B.SIG_BOOL ? FALSE : ZERO, c = g.byId(fieldOf(b, F.COMP)), key = fieldOf(b, F.SIG);
        if (!c) { warn(b, tl('Ce composant a été retiré du montage.')); return fb; }
        const sig = SIGNALS[c.type] && SIGNALS[c.type][key] && signalOf(c.type, key, prof);
        if (!sig) { warn(b, tl('{0} ne fournit pas cette mesure.', c.name)); return fb; }
        const x = compBoard(c, cx) === board ? g.sensorExpr(c, key) : g.missing(c);
        if (!x) { warn(b, tl('{0} n’est pas câblé à {1} : utilisez « Câbler automatiquement ».', c.name, board.name)); return fb; }
        const t = sig.kind === 'bool' ? 'bool' : sig.type === 'float' ? 'float' : 'int', k = `${c.id}|${key}`;
        if (hoist.has(k)) { // lue plusieurs fois ici : une seule lecture, en tête de l'événement
          if (!hoist.get(k)) { const v = g.uniq(ident(`${g.objName(c)}_${sig.v}`)); hoist.set(k, v); reads.push(`${t} ${v} = ${x};`); }
          return res(hoist.get(k), O.ATOM, t);
        }
        return res(x, / == /.test(x) ? O.EQ : / \/ /.test(x) ? O.MUL : O.ATOM, t);
      }
      default: warn(b, tl('Bloc non pris en charge : il compte pour 0.')); return ZERO;
    }
  }

  /* ---------- Instructions : lignes de code, la première porte le repère du bloc ---------- */
  function chain(b, depth) {
    const out = [];
    for (; b; b = b.next ? b.next.block : null) if (!off(b)) out.push(...S(b, depth));
    return out;
  }
  function S(b, depth) {
    const saved = pending; pending = [];
    const lines = stmt(b, depth), cm = [...commentLines(b), ...pending];
    pending = saved;
    if (lines.length) { ids.push(b.id); lines[0] = MK + (ids.length - 1) + MK + lines[0]; }
    return [...cm, ...lines];
  }
  const body = (b, n, depth) => indent(chain(stmtIn(b, n), depth + 1));
  function counter(depth) { const free = COUNTERS.filter(n => !keep.has(n) && !g.names.has(n)); return free[depth] || `i${depth + 1}`; }
  function stmt(b, depth) {
    switch (b.type) {
      case 'controls_if': case 'controls_ifelse': {
        const st = b.extraState || {}, n = st.elseIfCount || 0, out = [];
        for (let i = 0; i <= n; i++) out.push(`${i ? '} else if' : 'if'} (${V(b, 'IF' + i, FALSE).code}) {`, ...body(b, 'DO' + i, depth));
        if (st.hasElse || b.type === 'controls_ifelse') out.push('} else {', ...body(b, 'ELSE', depth));
        return [...out, '}'];
      }
      case 'controls_repeat_ext': case 'controls_repeat': {
        const t = b.type === 'controls_repeat' ? res(String(Number(fieldOf(b, 'TIMES')) || 0)) : V(b, 'TIMES', res('10', O.ATOM, 'int', 'num')), i = counter(depth);
        return [`for (int ${i} = 0; ${i} < ${wrap(t, O.REL - 1)}; ${i}++) {`, ...body(b, 'DO', depth), '}'];
      }
      case 'controls_whileUntil': {
        const c = V(b, 'BOOL', FALSE);
        return [`while (${fieldOf(b, 'MODE') === 'UNTIL' ? '!' + wrap(c, O.UNARY) : c.code}) {`, ...body(b, 'DO', depth), '}'];
      }
      case 'controls_for': {
        const v = varOf(b); if (!v) return [];
        const n = v.name, a = V(b, 'FROM', res('1', O.ATOM, 'int', 'num')), z = V(b, 'TO', res('10', O.ATOM, 'int', 'num')), s = V(b, 'BY', res('1', O.ATOM, 'int', 'num'));
        assign(v, numType(a.type, s.type));
        let cond, step;
        if (a.lit === 'num' && z.lit === 'num' && s.lit === 'num') {
          const up = +a.code <= +z.code, by = Math.abs(+s.code) || 1;
          cond = `${n} ${up ? '<=' : '>='} ${z.code}`; step = by === 1 ? `${n}${up ? '++' : '--'}` : `${n} ${up ? '+=' : '-='} ${by}`;
        } else { cond = `${n} <= ${wrap(z, O.REL - 1)}`; step = s.lit === 'num' && +s.code === 1 ? `${n}++` : `${n} += ${s.code}`; }
        return [`for (${n} = ${a.code}; ${cond}; ${step}) {`, ...body(b, 'DO', depth), '}'];
      }
      case 'variables_set': { const v = varOf(b); if (!v) return []; const r = V(b, 'VALUE'); assign(v, r.type); return [`${v.name} = ${conv(r, types.get(v.id) || r.type)};`]; }
      case 'math_change': { const v = varOf(b); if (!v) return []; const r = V(b, 'DELTA', res('1', O.ATOM, 'int', 'num')); assign(v, numType('int', r.type)); return [`${v.name} += ${r.code};`]; }
      case B.DWRITE: {
        const p = pin(b, 'out'), s = V(b, F.STATE, res('LOW'));
        return p ? [`digitalWrite(${p}, ${s.type === 'bool' ? `${wrap(s, O.COND - 1)} ? HIGH : LOW` : s.code});`] : [tl('// (choisissez une broche)')];
      }
      case B.AWRITE: { const p = pin(b, 'out'); return p ? [`analogWrite(${p}, ${V(b, F.VALUE).code});`] : [tl('// (choisissez une broche)')]; }
      case B.DELAY: return [...flushNow(), `delay(${V(b, F.MS, res('1000', O.ATOM, 'int', 'num')).code});`]; // l'écran montre ce qui précède l'attente
      case B.PRINT: case B.PRINTLN: {
        const x = inputOf(b, F.VALUE), ln = b.type === B.PRINTLN;
        return x ? printParts('Serial', x, ln) : ln ? ['Serial.println();'] : [];
      }
      case B.PLOT: { // une ligne « nom:valeur » par mesure : le format du traceur série
        const label = String(fieldOf(b, F.LABEL) || 'valeur').replace(/[\s:,]+/g, '_') || 'valeur';
        return [`Serial.print(${cstr(label + ':')});`, `Serial.println(${V(b, F.VALUE).code});`];
      }
      case B.TONE: { const p = pin(b, 'out'); return p ? [`tone(${p}, ${V(b, F.FREQ, res('440', O.ATOM, 'int', 'num')).code});`] : [tl('// (choisissez une broche)')]; }
      case B.NOTONE: { const p = pin(b, 'out'); return p ? [`noTone(${p});`] : [tl('// (choisissez une broche)')]; }
      case B.SERVO: return servo(b);
      case B.ACT: return compAct(b);
      default: warn(b, tl('Bloc non pris en charge : il est ignoré.')); return [tl('// (bloc ignoré : {0})', b.type)];
    }
  }

  /**
   * Imprime une valeur ; un texte assemblé (« créer un texte avec ») part morceau par morceau : aucun String
   * n'est construit (sur une UNO, sa mémoire se fragmente vite). ln : passer à la ligne après.
   */
  function printParts(target, x, ln) {
    if (x.type !== 'text_join') return [`${target}.${ln ? 'println' : 'print'}(${E(x).code});`];
    const n = x.extraState && x.extraState.itemCount != null ? x.extraState.itemCount : Object.keys(x.inputs || {}).length, parts = [];
    for (let i = 0; i < n; i++) { const p = inputOf(x, 'ADD' + i); if (p) parts.push(E(p).code); }
    if (!parts.length) return ln ? [`${target}.println();`] : [];
    return parts.map((c, i) => `${target}.${ln && i === parts.length - 1 ? 'println' : 'print'}(${c});`);
  }
  /** Servo sur une broche : l'objet du composant SERVO1 s'il y est relié, sinon un objet propre à la broche. */
  function servo(b) {
    const a = V(b, F.ANGLE, res('90', O.ATOM, 'int', 'num')), sc = (users.get(fieldOf(b, F.PIN)) || []).map(u => u.comp).find(c => c.type === 'servo');
    const act = sc && g.actor(sc);
    if (act) return a.lit === 'num' ? act('angle', +a.code) : act('follow', null, a.code);
    const p = pin(b, null); if (!p) return [tl('// (choisissez une broche)')];
    if (!servos.has(p)) {
      const o = g.uniq(ident(`servo_${p}`)); servos.set(p, o);
      g.inc.add(isEsp32(g.kind) ? 'ESP32Servo.h' : 'Servo.h'); g.glob.push(`Servo ${o};`); g.setup.push(`${o}.attach(${p});`);
    }
    return [`${servos.get(p)}.write(${a.code});`];
  }

  /** Action d'un composant : le code des règles quand le réglage est un nombre, sinon son équivalent calculé. */
  function compAct(b) {
    const c = g.byId(fieldOf(b, F.COMP)), act = fieldOf(b, F.ACT);
    if (!c) { warn(b, tl('Ce composant a été retiré du montage.')); g.notes.includes(GONE) || g.notes.push(GONE); return [tl('// (bloc ignoré : composant retiré du montage)')]; }
    const va = visualActs(c.type).find(x => x.key === act);
    if (!va) { warn(b, tl('{0} ne sait pas faire cette action.', c.name)); return [tl('// ({0} : action inconnue)', c.name)]; }
    const unwired = () => { warn(b, tl('{0} n’est pas câblé à {1} : utilisez « Câbler automatiquement ».', c.name, board.name)); return [tl('// ({0} n’est pas câblé : action ignorée)', c.name)]; };
    if (compBoard(c, cx) !== board) { g.missing(c); return unwired(); }
    const kind = va.arg && va.arg.kind;
    let arg = null;
    if (kind === 'color') { const v = fieldOf(b, F.COLOR); arg = /^#[0-9a-f]{6}$/i.test(v || '') ? v : va.arg.def; }
    else if (kind) arg = V(b, F.ARG, kind === 'text' ? res(cstr(va.arg.def), O.ATOM, 'String', 'str') : res(String(va.arg.def), O.ATOM, 'int', 'num'));
    if (c.type === 'oled' && act === 'text' && inputOf(b, F.ARG) && inputOf(b, F.ARG).type === 'text_join' && g.actor(c)) { // morceau par morceau
      const o = g.objName(c), a = g.actor(c); a.frame.own = true; drawn.set(o, a.frame); g.setup.push(`${o}.clearDisplay();`);
      return printParts(o, inputOf(b, F.ARG), true);
    }
    if (c.type === 'lcd1602' || c.type === 'oled') return screen(c, act, arg, unwired);
    const a = g.actor(c);
    if (!a) return unwired();
    if (kind !== 'num') return a(act, arg);
    if (arg.lit === 'num') return a(act, +arg.code);
    // Réglage calculé (mesure convertie…) : nommé avant d'être utilisé, comme dans le code des règles ; une variable reste telle quelle.
    const named = arg.order === O.ATOM && !/\(/.test(arg.code) ? null : g.uniq(`${g.objName(c)}_consigne`);
    const x = named || arg.code, keep = named ? [`int ${named} = ${arg.code};`] : [];
    if (['dim', 'angle', 'note', 'digit', 'fwd', 'speed'].includes(act)) return [...keep, ...a('follow', null, x)];
    if (act === 'back') return [...keep, ...a('back', 0).slice(0, 2), ...a('follow', null, x).slice(2)];
    if (act === 'blink' || act === 'beep') return [...keep, `digitalWrite(${g.pinConst(c, c.type === 'buzzer' ? '+' : c.type === 'laser' ? 'S' : 'A')}, (millis() / ${named || wrap(arg, O.MUL - 1)}) % 2 ? HIGH : LOW);`];
    return a(act, 0);
  }
  /** Écrans : chaque bloc écrit ou efface lui-même (pas d'effacement automatique à chaque tour). */
  /** Écrans : chaque bloc écrit ou efface (pas d'effacement automatique) ; l'image d'un OLED part une fois (flushNow). */
  function screen(c, act, arg, unwired) {
    const a = g.actor(c);
    if (!a) return unwired();
    const o = g.objName(c);
    if (c.type === 'lcd1602') {
      if (act === 'clear') return [`${o}.clear();`, `${a.memo}[0] = "";`, `${a.memo}[1] = "";`];
      return [`ecrireLigne(${o}, ${a.memo}, ${act === 'line1' ? 1 : 0}, ${!arg ? '""' : arg.type === 'String' ? arg.code : `String(${arg.code})`});`];
    }
    a.frame.own = true; drawn.set(o, a.frame);
    g.setup.push(`${o}.clearDisplay();`);
    return act === 'clear' ? [`${o}.clearDisplay();`, `${o}.setCursor(0, 0);`] : [`${o}.println(${arg ? arg.code : '""'});`];
  }

  /* ---------- Programme ---------- */
  /** Corps d'un événement : mesures lues une fois en tête, puis ses blocs. */
  const rootBody = (b, inner) => { plan(stmtIn(b, F.DO)); const lines = inner ? indent(chain(stmtIn(b, F.DO), 1)) : chain(stmtIn(b, F.DO), 0); return [...(inner ? indent(reads) : reads), ...lines]; };
  const setupBody = setupB ? [...commentLines(setupB), ...rootBody(setupB, false), ...flushNow()] : [];
  const loop = loopB ? [...commentLines(loopB), ...rootBody(loopB, false)] : [];
  if (drawn.size) { // fin de loop() : l'image part au plus 10 fois par seconde (chaque envoi prend environ 25 ms)
    loop.push('', tl('// Écran : l’image part au plus 10 fois par seconde (chaque envoi prend environ 25 ms)'));
    for (const [o, f] of drawn) { f.used = true; loop.push(`if (millis() - ${f.sent} >= 100) {`, `  ${f.sent} = millis();`, `  ${o}.display();`, '}'); }
    drawn.clear();
  }
  const timers = [];
  every.forEach((b, i) => {
    const ms = Math.max(1, Math.round(Number(fieldOf(b, F.MS)) || 1000)), t = g.uniq(`${isEn ? 'timer' : 'minuterie'}${i + 1}`);
    timers.push(`unsigned long ${t} = 0;`);
    ids.push(b.id);
    if (loop.length) loop.push('');
    loop.push(...commentLines(b), tl('// Toutes les {0} ms', ms), `${MK}${ids.length - 1}${MK}if (millis() - ${t} >= ${ms}) {`, `  ${t} = millis();`, ...rootBody(b, true), ...indent(flushNow()), '}');
  });
  // pinMode automatiques, en tête de setup() ; les broches déjà réglées par un composant ne sont pas répétées.
  const done = new Set(g.setup.map(l => (/^pinMode\(([^,]+),/.exec(l) || [])[1]).filter(Boolean));
  const auto = [...modes].filter(([p]) => !done.has(p)).map(([p, m]) => (m === 'out' ? `pinMode(${p}, OUTPUT);` : m === 'pullup' ? tl('pinMode({0}, INPUT_PULLUP); // relâché : HIGH, appuyé : LOW', p) : `pinMode(${p}, INPUT);`));
  if (auto.length) g.setup.unshift(tl('// Broches réglées automatiquement d’après les blocs'), ...auto);
  const decl = [...vars.values()].map(v => { const t = types.get(v.id) || 'int'; return `${CTYPE[t]} ${v.name} = ${t === 'String' ? '""' : t === 'bool' ? 'false' : '0'};${v.label !== v.name ? ` // ${quote(v.label)}` : ''}`; });
  if (decl.length || timers.length) g.glob.push(...(g.glob.length ? [''] : []), ...decl, ...timers);
  g.body.push(...loop);
  const header = [tl('// Programme de {0} ({1}), créé avec les blocs de Jollof Studio.', board.name, prof.label), tl('// Il est régénéré à chaque modification des blocs.'),
    ...((ws.workspaceComments || []).flatMap(c => commentLines({ icons: { comment: { text: c.text } } })))];
  const raw = g.assemble({ header, loopDelay: false, setupBody, keep });
  const map = new Map();
  const code = raw.split('\n').map((l, i) => l.replace(MKRX, (m, n) => { if (!map.has(i + 1)) map.set(i + 1, ids[+n]); return ''; })).join('\n');
  return { code, map, warnings, assigned };
}
const GONE = tl('// Un bloc utilise un composant retiré du montage : il est ignoré.');
