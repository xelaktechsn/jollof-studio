// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Compilateur du simulateur : un sous-ensemble du C++ d'Arduino traduit en JavaScript.
// Préprocesseur (#define, #include, #ifdef), analyse syntaxique, vérification des noms
// et des types, puis génération de fonctions génératrices : delay() suspend le programme
// sans bloquer l'application, et chaque tour de boucle rend la main de temps en temps,
// si bien qu'une boucle infinie ne fige jamais l'interface.
// Les entiers suivent la carte : int fait 16 bits sur un Uno, 32 bits sur un ESP32.
import { FN, CONSTS, CONST_TYPES, BOARD_CONSTS, INT_BITS, CLASSES, OBJECTS, KNOWN_INCLUDES, UNSUPPORTED_INCLUDES, CLASS_CONSTS, TYPE_ALIASES, BOARD_ONLY, INCLUDE_TWIN } from './api.js';
import { tl, quote } from '../i18n/index.js';

// Une erreur garde un code stable (J1xxx, voir src/check/codes.js), la longueur à souligner, une aide séparée du
// message (le message la contient encore, pour l'affichage d'avant) et son titre sans l'aide.
export class CompileError extends Error {
  constructor(msg, at, x = {}) {
    super(msg); this.line = at ? at.line : 0; this.col = at ? at.col : 0;
    this.code = x.code || null; this.len = x.len || 1; this.help = x.help || null; this.title = x.title || null;
  }
}
const fail = (msg, at, x) => { throw new CompileError(msg, at, x); };
const q = quote;

/* ---------------- Analyse lexicale ---------------- */
const OPS = ['>>=', '<<=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::', ...'+-*/%=<>!&|^~?:;,.()[]{}#'];
const ESC = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, '?': 63 };
const RE_ID = /[A-Za-z_][A-Za-z0-9_]*/y;
const RE_NUM = /(0[xX][0-9a-fA-F]+|0[bB][01]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([uUlLfF]*)/y;

/** Découpe le texte en jetons. Chaque jeton garde sa ligne, sa colonne et sa ligne logique (les \ de fin de ligne prolongent un #define). */
export function lex(src) {
  const toks = [];
  let i = 0, line = 1, col = 1, ll = 0, bol = true, sp = false;
  const n = src.length;
  const adv = k => { i += k; col += k; };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { i++; line++; col = 1; ll++; bol = true; sp = true; continue; }
    if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) { i += src[i + 1] === '\r' ? 3 : 2; line++; col = 1; sp = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ') { adv(1); sp = true; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; sp = true; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const at = { line, col }, end = src.indexOf('*/', i + 2);
      if (end < 0) fail(tl('Commentaire /* jamais refermé par */'), at);
      for (let k = i; k < end; k++) if (src[k] === '\n') { line++; col = 1; ll++; } else col++;
      col += 2; i = end + 2; sp = true; continue;
    }
    const tok = { line, col, ll, bol, sp };
    bol = false; sp = false;
    // Chaîne brute R"delim( … )delim" : le texte tel quel, retours à la ligne compris (pages web des serveurs).
    if (c === 'R' && src[i + 1] === '"') {
      const open = src.indexOf('(', i + 2), delim = open < 0 ? '' : src.slice(i + 2, open);
      if (open < 0 || delim.length > 16 || /[\s\\)"]/.test(delim)) fail(tl('Chaîne brute mal formée : écrivez R"( … )"'), tok);
      const end = src.indexOf(')' + delim + '"', open + 1);
      if (end < 0) fail(tl('Chaîne brute R"( … )" jamais refermée'), tok);
      Object.assign(tok, { t: 'str', v: src.slice(open + 1, end) });
      for (let k = i; k < end; k++) if (src[k] === '\n') { line++; col = 1; ll++; } else col++;
      col += delim.length + 2; i = end + delim.length + 2; toks.push(tok); continue;
    }
    RE_ID.lastIndex = i;
    let m = RE_ID.exec(src);
    if (m) { tok.t = 'id'; tok.v = m[0]; adv(m[0].length); toks.push(tok); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      RE_NUM.lastIndex = i; m = RE_NUM.exec(src);
      const body = m[1], suf = m[2].toLowerCase(), hex = /^0x/i.test(body), bin = /^0b/i.test(body);
      const isFloat = !hex && !bin && (/[.eE]/.test(body) || suf.includes('f'));
      let v;
      if (hex) v = parseInt(body.slice(2), 16);
      else if (bin) v = parseInt(body.slice(2), 2);
      else if (!isFloat && /^0[0-7]+$/.test(body)) v = parseInt(body, 8);
      else v = Number(body);
      if (!isFloat && /^0\d+$/.test(body) && /[89]/.test(body)) fail(tl('Nombre {0} invalide : un 0 au début annonce un nombre en octal (chiffres 0 à 7)', q(body)), tok);
      if (/[A-Za-z_]/.test(src[i + m[0].length] || '')) { RE_ID.lastIndex = i + m[0].length; const bad = RE_ID.exec(src); fail(tl('Suffixe {0} invalide après le nombre {1}', q(bad ? bad[0] : ''), q(body)), tok); }
      Object.assign(tok, { t: 'num', v, float: isFloat, long: suf.includes('l'), unsigned: suf.includes('u'), raw: m[0] });
      adv(m[0].length); toks.push(tok); continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\n') fail(c === '"' ? tl('Chaîne de caractères non fermée : il manque le " de fin') : tl('Caractère non fermé : il manque l’apostrophe de fin'), tok);
        if (src[j] === '\\') {
          const e = src[j + 1];
          if (e === 'x') { const h = /^[0-9a-fA-F]{1,2}/.exec(src.slice(j + 2)); s += String.fromCharCode(parseInt(h ? h[0] : '0', 16)); j += 2 + (h ? h[0].length : 0); continue; }
          s += ESC[e] != null ? String.fromCharCode(ESC[e]) : e; j += 2; continue;
        }
        s += src[j++];
      }
      if (j >= n) fail(c === '"' ? tl('Chaîne de caractères non fermée : il manque le " de fin') : tl('Caractère non fermé'), tok);
      if (c === '"') { tok.t = 'str'; tok.v = s; }
      else {
        if (s.length !== 1) fail(s.length ? tl('{0} contient plusieurs caractères : utilisez des guillemets doubles pour une chaîne', q("'" + s + "'")) : tl('Caractère vide \'\''), tok);
        tok.t = 'chr'; tok.v = s.charCodeAt(0);
      }
      col += j + 1 - i; i = j + 1; toks.push(tok); continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) fail(tl('Caractère {0} inattendu', q(c)), tok);
    tok.t = 'op'; tok.v = op; adv(op.length); toks.push(tok);
  }
  toks.push({ t: 'eof', v: '', line, col, ll: ll + 1, bol: true });
  return toks;
}

/* ---------------- Préprocesseur ---------------- */
function expandList(list, macros, hide) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i], m = t.t === 'id' && !hide.has(t.v) && macros.get(t.v);
    if (!m) { out.push(t); continue; }
    let body = m.body;
    if (m.params) {
      const nx = list[i + 1];
      if (!nx || nx.t !== 'op' || nx.v !== '(') { out.push(t); continue; }
      let depth = 0, j, args = [[]];
      for (j = i + 1; j < list.length; j++) {
        const u = list[j];
        if (u.t === 'op' && u.v === '(') { if (depth++ > 0) args[args.length - 1].push(u); continue; }
        if (u.t === 'op' && u.v === ')') { if (--depth === 0) break; args[args.length - 1].push(u); continue; }
        if (u.t === 'op' && u.v === ',' && depth === 1) { args.push([]); continue; }
        args[args.length - 1].push(u);
      }
      if (j >= list.length) fail(tl('Parenthèse non fermée dans l’appel de la macro {0}', q(t.v)), t);
      if (!m.params.length && args.length === 1 && !args[0].length) args = [];
      if (args.length !== m.params.length) fail(tl('La macro {0} attend {1} argument{2}, {3} donné{4}', q(t.v), m.params.length, m.params.length > 1 ? 's' : '', args.length, args.length > 1 ? 's' : ''), t);
      body = m.body.flatMap(b => { const k = b.t === 'id' ? m.params.indexOf(b.v) : -1; return k >= 0 ? args[k] : [b]; });
      i = j;
    }
    const hid = new Set(hide); hid.add(t.v);
    out.push(...expandList(body.map(b => ({ ...b, line: t.line, col: t.col })), macros, hid));
  }
  return out;
}

/** Applique les directives : retourne les jetons du programme, les bibliothèques incluses et les avertissements. */
export function preprocess(toks) {
  const macros = new Map(), out = [], includes = [], warnings = [], cond = [], incAt = new Map();
  let seg = [];
  const active = () => cond.every(c => c.on);
  const flush = () => { if (seg.length) { out.push(...expandList(seg, macros, new Set())); seg = []; } };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'eof') break;
    if (!(t.t === 'op' && t.v === '#' && t.bol)) { if (active()) seg.push(t); continue; }
    flush();
    const line = [];
    let j = i + 1;
    while (toks[j].t !== 'eof' && toks[j].ll === t.ll) line.push(toks[j++]);
    i = j - 1;
    const d = line[0], name = d && d.v, rest = line.slice(1);
    if (!d) continue;
    if (name === 'ifdef' || name === 'ifndef') { const has = rest[0] && macros.has(rest[0].v); cond.push({ on: name === 'ifdef' ? has : !has, done: false, at: d }); cond[cond.length - 1].done = cond[cond.length - 1].on; continue; }
    if (name === 'if') { const on = evalIf(rest, macros, d); cond.push({ on, done: on, at: d }); continue; }
    if (name === 'elif') { const c = cond[cond.length - 1]; if (!c) fail('#elif sans #if', d); c.on = !c.done && evalIf(rest, macros, d); c.done = c.done || c.on; continue; }
    if (name === 'else') { const c = cond[cond.length - 1]; if (!c) fail('#else sans #if', d); c.on = !c.done; c.done = true; continue; }
    if (name === 'endif') { if (!cond.length) fail('#endif sans #if', d); cond.pop(); continue; }
    if (!active()) continue;
    if (name === 'define') {
      const id = rest[0];
      if (!id || id.t !== 'id') fail(tl('#define attend un nom'), d);
      let body = rest.slice(1), params = null;
      if (body[0] && body[0].t === 'op' && body[0].v === '(' && !body[0].sp) {
        params = []; let k = 1;
        while (k < body.length && !(body[k].t === 'op' && body[k].v === ')')) { if (body[k].t === 'id') params.push(body[k].v); k++; }
        body = body.slice(k + 1);
      }
      if (body.some(b => b.t === 'op' && (b.v === '#'))) fail(tl('Les opérateurs # et ## des macros ne sont pas pris en charge'), d);
      macros.set(id.v, { params, body });
      continue;
    }
    if (name === 'undef') { if (rest[0]) macros.delete(rest[0].v); continue; }
    if (name === 'include') {
      let file = '';
      if (rest[0] && rest[0].t === 'str') file = rest[0].v;
      else if (rest[0] && rest[0].v === '<') { for (let k = 1; k < rest.length && rest[k].v !== '>'; k++) file += rest[k].t === 'op' ? rest[k].v : (rest[k].sp && file ? ' ' : '') + rest[k].v; }
      else fail(tl('#include attend <fichier.h> ou "fichier.h"'), d);
      includes.push(file); if (!incAt.has(file)) incAt.set(file, d);
      if (UNSUPPORTED_INCLUDES[file]) warnings.push({ line: d.line, col: d.col, code: 'J1109', msg: tl('{0} : {1} n’est pas simulé, ces fonctions ne pourront pas s’exécuter', file, UNSUPPORTED_INCLUDES[file]) });
      else if (!KNOWN_INCLUDES.has(file)) warnings.push({ line: d.line, col: d.col, code: 'J1109', msg: tl('{0} : bibliothèque inconnue du simulateur', file) });
      continue;
    }
    if (name === 'error') fail(`#error ${rest.map(r => r.raw || r.v).join(' ')}`, d);
    if (name === 'pragma' || name === 'line' || name === 'warning') continue;
    fail(tl('Directive #{0} inconnue', name), d);
  }
  flush();
  if (cond.length) fail('#if, #ifdef ou #ifndef sans #endif', cond[cond.length - 1].at);
  out.push(toks[toks.length - 1]);
  return { toks: out, includes, warnings, macros, incAt };
}
function evalIf(rest, macros, at) {
  const list = [];
  for (let k = 0; k < rest.length; k++) {
    const r = rest[k];
    if (r.t === 'id' && r.v === 'defined') {
      const par = rest[k + 1] && rest[k + 1].v === '(', id = rest[k + (par ? 2 : 1)];
      list.push({ ...r, t: 'num', v: id && macros.has(id.v) ? 1 : 0 }); k += par ? 3 : 1; continue;
    }
    list.push(r);
  }
  const exp = expandList(list, macros, new Set()).map(r => (r.t === 'id' ? { ...r, t: 'num', v: 0 } : r));
  const p = new Parser([...exp, { t: 'eof', v: '', line: at.line, col: at.col }], { intBits: 32, types: new Set(), classes: new Set() });
  return !!constEval(p.expr());
}
function constEval(e) {
  switch (e.e) {
    case 'num': case 'chr': return e.v;
    case 'bool': return e.v ? 1 : 0;
    case 'un': { const a = constEval(e.a); return e.op === '!' ? +!a : e.op === '-' ? -a : e.op === '~' ? ~a : a; }
    case 'bin': { const a = constEval(e.a), b = constEval(e.b); return { '+': a + b, '-': a - b, '*': a * b, '/': b ? Math.trunc(a / b) : 0, '%': b ? a % b : 0, '<': +(a < b), '>': +(a > b), '<=': +(a <= b), '>=': +(a >= b), '==': +(a === b), '!=': +(a !== b), '&&': +(a && b), '||': +(a || b), '&': a & b, '|': a | b, '^': a ^ b, '<<': a << b, '>>': a >> b }[e.op] ?? 0; }
    case 'cond': return constEval(e.c) ? constEval(e.a) : constEval(e.b);
    default: return 0;
  }
}

/* ---------------- Types ---------------- */
const TYPE_WORDS = new Set(['void', 'bool', 'boolean', 'char', 'short', 'int', 'long', 'float', 'double', 'byte', 'word', 'String', 'size_t',
  'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'uint64_t', 'int64_t', 'unsigned', 'signed', 'auto']);
const QUALS = new Set(['const', 'static', 'volatile', 'constexpr', 'inline', 'extern', 'register', 'PROGMEM']);
const T = { void: { k: 'void' }, bool: { k: 'bool' }, float: { k: 'float' }, str: { k: 'str' }, any: { k: 'any' }, char: { k: 'int', b: 8, u: false, ch: true } };
const I = (b, u) => ({ k: 'int', b, u });
const isNum = t => t.k === 'int' || t.k === 'float' || t.k === 'bool' || t.k === 'any';
const tname = t => (t.k === 'int' ? (t.ch ? 'char' : t.b === 8 && t.u ? 'byte' : t.b > 16 ? (t.u ? 'unsigned long' : 'long') : (t.u ? 'unsigned int' : 'int')) : t.k === 'obj' ? t.c : t.k === 'arr' ? tl('tableau de {0}', tname(t.of)) : { float: 'float', bool: 'bool', str: 'String', void: 'void', any: 'valeur' }[t.k]);
/** Type écrit comme en C++ (int[], char[], auto), pour la fenêtre des variables du débogueur. */
const ctype = (t, sym) => (sym && sym.charArr ? 'char[]' : t.k === 'arr' ? ctype(t.of) + '[]' : t.k === 'any' ? 'auto' : tname(t));

function baseType(words, intBits, at) {
  const s = words.filter(w => w !== 'signed' || words.length === 1).join(' ');
  switch (s) {
    case 'void': return T.void;
    case 'bool': case 'boolean': return T.bool;
    case 'char': return T.char;
    case 'unsigned char': case 'byte': case 'uint8_t': return I(8, true);
    case 'int8_t': return I(8, false);
    case 'short': case 'short int': case 'int16_t': return I(16, false);
    case 'unsigned short': case 'unsigned short int': case 'word': case 'uint16_t': return I(16, true);
    case 'int': case 'signed': return I(intBits, false);
    case 'unsigned': case 'unsigned int': return I(intBits, true);
    case 'long': case 'long int': case 'int32_t': return I(32, false);
    case 'unsigned long': case 'unsigned long int': case 'uint32_t': case 'size_t': return I(32, true);
    case 'long long': case 'long long int': case 'int64_t': return I(64, false);
    case 'unsigned long long': case 'uint64_t': return I(64, true);
    case 'float': case 'double': case 'long double': return T.float;
    case 'String': return T.str;
    case 'auto': return T.any;
  }
  return fail(tl('Type {0} inconnu', q(s)), at, { code: 'J1102', len: String(s).length });
}

/* ---------------- Analyse syntaxique ---------------- */
const PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
const KEYWORDS = new Set(['if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'goto', 'struct', 'class', 'enum', 'union', 'typedef', 'namespace', 'using', 'template', 'new', 'delete', 'this', 'sizeof', 'true', 'false']);
const show = t => (t.t === 'eof' ? tl('la fin du programme') : t.t === 'str' ? tl('une chaîne') : q(t.raw || t.v));

class Parser {
  constructor(toks, o) { this.toks = toks; this.i = 0; this.intBits = o.intBits; this.enums = o.types; this.classes = o.classes; }
  peek(k = 0) { return this.toks[Math.min(this.i + k, this.toks.length - 1)]; }
  next() { return this.toks[this.i++] || this.toks[this.toks.length - 1]; }
  is(v, k = 0) { const t = this.peek(k); return (t.t === 'op' || t.t === 'id') && t.v === v; }
  eat(v) { if (this.is(v)) { this.i++; return true; } return false; }
  expect(v, ctx) {
    if (this.is(v)) return this.next();
    const t = this.peek(), prev = this.toks[this.i - 1];
    // Un ; ou ) oublié en fin de ligne se signale sur la ligne où il manque.
    if ((v === ';' || v === ')') && prev && t.line > prev.line) fail(tl('{0} attendu à la fin de la ligne{1}', q(v), ctx ? ' ' + ctx : ''), { line: prev.line, col: prev.col + String(prev.raw || prev.v).length }, { code: 'J1002', help: tl('ajoutez {0} ici', q(v)) });
    return fail(tl('{0} attendu{1} avant {2}', q(v), ctx ? ' ' + ctx : '', show(t)), t, { code: v === ';' || v === ')' ? 'J1002' : 'J1001', len: String(t.raw || t.v || ' ').length });
  }
  ident(what) { const t = this.peek(); if (t.t !== 'id' || KEYWORDS.has(t.v) || TYPE_WORDS.has(t.v)) fail(tl('{0} attendu avant {1}', what || tl('Nom'), show(t)), t); return this.next(); }
  /** Type propre à une bibliothèque à cette position (DeviceAddress, MFRC522::PICC_Type) : { name, n : nombre de jetons } ou null. */
  aliasAt(k = 0) {
    const t = this.peek(k); if (t.t !== 'id') return null;
    if (this.is('::', k + 1)) { const n = this.peek(k + 2), name = `${t.v}::${n.v}`; return n.t === 'id' && TYPE_ALIASES[name] ? { name, n: 3 } : null; }
    return TYPE_ALIASES[t.v] ? { name: t.v, n: 1 } : null;
  }
  isTypeAt(k = 0) {
    const t = this.peek(k); if (t.t !== 'id') return false;
    // Classe::NOM est une constante ou une méthode de la classe, sauf pour les types déclarés (MFRC522::PICC_Type).
    if (this.is('::', k + 1)) return !!this.aliasAt(k);
    return TYPE_WORDS.has(t.v) || QUALS.has(t.v) || this.classes.has(t.v) || this.enums.has(t.v) || !!this.aliasAt(k);
  }
  type() {
    const at = this.peek(), quals = new Set(), words = [];
    let cls = null, alias = null;
    for (;;) {
      const t = this.peek(); if (t.t !== 'id') break;
      if (QUALS.has(t.v)) { quals.add(t.v); this.next(); continue; }
      if (alias) break;
      if (!words.length && !cls && !alias) { const al = this.aliasAt(); if (al) { alias = TYPE_ALIASES[al.name]; this.i += al.n; continue; } }
      if (!words.length && !cls && (this.classes.has(t.v) || this.enums.has(t.v))) { cls = t.v; this.next(); continue; }
      if (TYPE_WORDS.has(t.v) && !cls) {
        const multi = ['unsigned', 'signed', 'long', 'short', 'int', 'char'];
        if (words.length && !(multi.includes(t.v) && words.every(w => multi.includes(w)))) break;
        words.push(t.v); this.next(); continue;
      }
      break;
    }
    if (!words.length && !cls && !alias) fail(tl('Type attendu avant {0}', show(this.peek())), at);
    let ty = alias ? (alias.c ? { k: 'obj', c: alias.c } : RET(alias.t, this.intBits)) : cls ? (this.enums.has(cls) ? I(this.intBits, false) : { k: 'obj', c: cls }) : baseType(words, this.intBits, at);
    let ptr8 = false, ptr = false;
    while (this.is('*') || this.is('const')) {
      if (this.eat('const')) continue;
      this.next(); ptr = true;
      // byte *tampon : en paramètre, un tableau d'octets (printHex(rfid.uid.uidByte, rfid.uid.size)).
      if (ty === T.char || (ty.k === 'int' && ty.b === 8)) { ptr8 = ty !== T.char; ty = T.str; }
      // const esp_now_recv_info_t *info, TwoWire *bus : un objet de bibliothèque, désigné par l'objet lui-même.
      else if (ty.k !== 'obj') fail(tl('Les pointeurs ne sont pas pris en charge par le simulateur (sauf char* pour du texte)'), at);
    }
    return { ty, quals, at, dims: alias && alias.dims, ptr8, ptr };
  }
  program() {
    const items = [];
    while (this.peek().t !== 'eof') {
      if (this.eat(';')) continue;
      const t = this.peek();
      if (this.is('enum')) { items.push(this.enumDecl()); continue; }
      if (this.is('struct') || this.is('class') || this.is('union')) fail(tl('{0} n’est pas pris en charge par le simulateur : utilisez des variables ou des tableaux', t.v), t);
      if (this.is('typedef') || this.is('namespace') || this.is('using') || this.is('template')) fail(tl('{0} n’est pas pris en charge par le simulateur', q(t.v)), t);
      if (!this.isTypeAt()) {
        if (t.t === 'id' && this.peek(1).v === '(' ) fail(tl('Type de retour attendu avant {0} : écrivez par exemple void {1}()', q(t.v), t.v), t);
        if (t.t === 'id' && !KEYWORDS.has(t.v) && (this.peek(1).t === 'id')) fail(tl('Type {0} inconnu : vérifiez l’orthographe ou le #include de sa bibliothèque', q(t.v)), t, { code: 'J1102', len: t.v.length, help: tl('vérifiez l’orthographe ou le #include de sa bibliothèque') });
        fail(tl('Instruction {0} hors d’une fonction : le code s’écrit dans setup(), loop() ou une autre fonction', show(t)), t);
      }
      const ty = this.type();
      const name = this.ident();
      if (this.is('(') && (this.is(')', 1) ? ty.ty.k !== 'obj' : this.isTypeAt(1) || this.is('void', 1))) { items.push(this.func(ty, name)); continue; }
      items.push(this.declRest(ty, name));
    }
    return items;
  }
  enumDecl() {
    const at = this.next();
    if (this.is('class') || this.is('struct')) fail(tl('enum class n’est pas pris en charge : utilisez un enum simple'), at);
    let name = null;
    if (this.peek().t === 'id' && !this.is('{')) name = this.next().v;
    if (name) this.enums.add(name);
    this.expect('{', tl('pour ouvrir la liste de l’enum'));
    const members = [];
    while (!this.is('}')) {
      const id = this.ident(tl('Nom de valeur'));
      members.push({ name: id.v, value: this.eat('=') ? this.cond() : null, at: id });
      if (!this.eat(',')) break;
    }
    this.expect('}', tl('pour fermer l’enum'));
    this.expect(';', tl('après l’enum'));
    return { kind: 'enum', name, members, at };
  }
  func(ty, name) {
    this.expect('(');
    const params = this.paramList();
    this.expect(')', tl('pour fermer les paramètres de {0}()', name.v));
    if (this.eat(';')) return { kind: 'func', ret: ty.ty, name: name.v, params, body: null, at: name };
    if (!this.is('{')) fail(tl('{0} attendu pour ouvrir le corps de {1}() avant {2}', q('{'), name.v, show(this.peek())), this.peek());
    return { kind: 'func', ret: ty.ty, name: name.v, params, body: this.block(), at: name };
  }
  /** Paramètres d'une fonction ou d'une lambda, jusqu'à la parenthèse fermante (non consommée). */
  paramList() {
    const params = [];
    if (this.is('void') && this.is(')', 1)) this.next();
    while (!this.is(')')) {
      const pt = this.type();
      let ref = false;
      if (this.eat('&')) ref = true;
      const pn = this.peek().t === 'id' && !KEYWORDS.has(this.peek().v) ? this.next() : null;
      let pty = pt.ptr8 ? { k: 'arr', of: I(8, true) } : pt.ty;
      if (pt.dims) pt.dims.forEach(() => { pty = { k: 'arr', of: pty }; });
      while (this.eat('[')) { while (!this.is(']')) this.next(); this.expect(']'); pty = { k: 'arr', of: pty }; }
      if (ref && pty.k !== 'obj' && pty.k !== 'arr') fail(tl('Passage par référence (&) de {0} non pris en charge : renvoyez plutôt la valeur avec return', pn ? q(pn.v) : tl('ce paramètre')), pt.at);
      params.push({ ty: pty, name: pn && pn.v, def: this.eat('=') ? this.assign() : null, at: pn || pt.at });
      if (!this.eat(',')) break;
    }
    return params;
  }
  declRest(ty, first) {
    const decls = [];
    let name = first;
    for (;;) {
      const dims = [];
      while (this.eat('[')) { dims.push(this.is(']') ? null : this.expr()); this.expect(']', tl('pour fermer la taille du tableau')); }
      if (ty.dims) dims.push(...ty.dims.map(v => ({ e: 'num', v, ...pos(name) })));
      while (this.is('PROGMEM')) this.next(); // const unsigned char logo[] PROGMEM = {…} (images des écrans)
      let init = null, ctor = null;
      if (this.eat('=')) init = this.is('{') ? this.initList() : this.assign();
      else if (this.is('(')) { this.next(); ctor = []; while (!this.is(')')) { ctor.push(this.assign()); if (!this.eat(',')) break; } this.expect(')', tl('pour fermer les arguments')); }
      else if (this.is('{')) init = this.initList();
      decls.push({ ty: ty.ty, quals: ty.quals, name: name.v, dims, init, ctor, at: name });
      if (!this.eat(',')) break;
      let t2 = ty.ty;
      while (this.eat('*')) t2 = t2 === T.char || (t2.k === 'int' && t2.b === 8) ? T.str : fail(tl('Les pointeurs ne sont pas pris en charge'), name);
      name = this.ident();
      ty = { ...ty, ty: t2 };
    }
    this.expect(';', tl('après la déclaration'));
    return { kind: 'vars', decls, at: first };
  }
  initList() {
    const at = this.expect('{'), items = [];
    while (!this.is('}')) { items.push(this.is('{') ? this.initList() : this.assign()); if (!this.eat(',')) break; }
    this.expect('}', tl('pour fermer la liste de valeurs'));
    return { e: 'list', items, ...pos(at) };
  }
  block() {
    const at = this.expect('{'), body = [];
    while (!this.is('}')) {
      if (this.peek().t === 'eof') fail(tl('{0} manquante : l’accolade ouverte ligne {1} n’est jamais fermée', q('}'), at.line), at);
      body.push(this.stmt());
    }
    this.next();
    return { s: 'block', body, ...pos(at) };
  }
  stmt() {
    const t = this.peek(), p = pos(t);
    if (t.t === 'op') {
      if (t.v === '{') return this.block();
      if (t.v === ';') { this.next(); return { s: 'empty', ...p }; }
    }
    if (t.t === 'id') switch (t.v) {
      case 'if': {
        this.next(); this.expect('(', tl('après if')); const c = this.expr(); this.expect(')', tl('pour fermer la condition du if'));
        const a = this.stmt(); const b = this.eat('else') ? this.stmt() : null;
        return { s: 'if', c, a, b, ...p };
      }
      case 'else': fail(tl('else sans if : vérifiez les accolades du if qui précède'), t); break;
      case 'while': { this.next(); this.expect('(', tl('après while')); const c = this.expr(); this.expect(')', tl('pour fermer la condition du while')); return { s: 'while', c, body: this.stmt(), ...p }; }
      case 'do': {
        this.next(); const body = this.stmt();
        if (!this.eat('while')) fail(tl('while attendu après le bloc do avant {0}', show(this.peek())), this.peek());
        this.expect('('); const c = this.expr(); this.expect(')'); this.expect(';', tl('après do … while'));
        return { s: 'do', c, body, ...p };
      }
      case 'for': {
        this.next(); this.expect('(', tl('après for'));
        if (this.isTypeAt()) {
          const save = this.i, ty = this.type(), nm = this.ident();
          if (this.eat(':')) { const arr = this.expr(); this.expect(')'); return { s: 'forof', ty: ty.ty, name: nm.v, arr, body: this.stmt(), at: nm, ...p }; }
          this.i = save;
        }
        let init = null;
        if (this.isTypeAt()) { const ty = this.type(); init = this.declRest(ty, this.ident()); init = { s: 'vars', decls: init.decls, ...p }; }
        else if (!this.eat(';')) { init = { s: 'expr', e: this.expr(), ...p }; this.expect(';', tl('dans le for (initialisation ; condition ; pas)')); }
        const c = this.is(';') ? null : this.expr(); this.expect(';', tl('dans le for (initialisation ; condition ; pas)'));
        const u = this.is(')') ? null : this.expr(); this.expect(')', tl('pour fermer le for'));
        return { s: 'for', init, c, u, body: this.stmt(), ...p };
      }
      case 'switch': {
        this.next(); this.expect('(', tl('après switch')); const e = this.expr(); this.expect(')'); this.expect('{', tl('pour ouvrir le switch'));
        const cases = [];
        while (!this.is('}')) {
          const ct = this.peek();
          if (this.eat('case')) { const test = this.cond(); this.expect(':', tl('après case')); cases.push({ test, body: [], ...pos(ct) }); continue; }
          if (this.eat('default')) { this.expect(':', tl('après default')); cases.push({ test: null, body: [], ...pos(ct) }); continue; }
          if (ct.t === 'eof') fail(tl('switch non fermé'), t);
          if (!cases.length) fail(tl('Instruction avant le premier case du switch'), ct);
          cases[cases.length - 1].body.push(this.stmt());
        }
        this.next();
        return { s: 'switch', e, cases, ...p };
      }
      case 'case': case 'default': fail(tl('{0} en dehors d’un switch', t.v), t); break;
      case 'break': this.next(); this.expect(';', tl('après break')); return { s: 'break', ...p };
      case 'continue': this.next(); this.expect(';', tl('après continue')); return { s: 'continue', ...p };
      case 'return': { this.next(); const e = this.is(';') ? null : this.expr(); this.expect(';', tl('après return')); return { s: 'return', e, ...p }; }
      case 'goto': fail(tl('goto n’est pas pris en charge'), t); break;
      case 'struct': case 'class': case 'union': case 'typedef': case 'enum': fail(tl('{0} n’est pas pris en charge à l’intérieur d’une fonction', t.v), t); break;
    }
    if (this.isTypeAt() && !((this.classes.has(t.v) || t.v === 'String') && this.is('(', 1))) {
      const ty = this.type();
      if (this.is('(')) fail(tl('Nom de variable attendu après le type'), this.peek());
      const nm = this.ident(tl('Nom de variable'));
      if (this.is('(') && (this.isTypeAt(1) || (this.is(')', 1) && ty.ty.k !== 'obj'))) fail(tl('Une fonction ne peut pas être définie à l’intérieur d’une autre : sortez {0}() de cette fonction', nm.v), nm);
      const d = this.declRest(ty, nm);
      return { s: 'vars', decls: d.decls, ...p };
    }
    const e = this.expr();
    this.expect(';', tl('après l’instruction'));
    return { s: 'expr', e, ...p };
  }
  expr() {
    const a = this.assign();
    if (!this.is(',')) return a;
    const list = [a];
    while (this.eat(',')) list.push(this.assign());
    return { e: 'seq', list, line: a.line, col: a.col };
  }
  assign() {
    const a = this.cond(), t = this.peek();
    if (t.t === 'op' && ASSIGN.has(t.v)) { this.next(); return { e: 'assign', op: t.v, a, b: this.assign(), ...pos(t) }; }
    return a;
  }
  cond() {
    const c = this.bin(1);
    if (!this.is('?')) return c;
    const t = this.next(), a = this.expr(); this.expect(':', tl('dans l’opérateur ? :'));
    return { e: 'cond', c, a, b: this.assign(), ...pos(t) };
  }
  bin(min) {
    let a = this.unary();
    for (;;) {
      const t = this.peek(), pr = t.t === 'op' && PREC[t.v];
      if (!pr || pr < min) return a;
      this.next();
      a = { e: 'bin', op: t.v, a, b: this.bin(pr + 1), ...pos(t) };
    }
  }
  unary() {
    const t = this.peek(), p = pos(t);
    if (t.t === 'op') {
      if (['!', '~', '-', '+'].includes(t.v)) { this.next(); return { e: 'un', op: t.v, a: this.unary(), ...p }; }
      if (t.v === '++' || t.v === '--') { this.next(); return { e: 'pre', op: t.v, a: this.unary(), ...p }; }
      if (t.v === '&') { this.next(); return { e: 'addr', a: this.unary(), ...p }; }
      if (t.v === '*') { this.next(); this.unary(); fail(tl('Les pointeurs ne sont pas pris en charge par le simulateur'), t); }
      if (t.v === '(' && this.isTypeAt(1)) {
        const save = this.i; this.next();
        const ty = this.type();
        if (this.eat(')')) return { e: 'cast', ty: ty.ty, ptr: ty.ptr, a: this.unary(), ...p };
        this.i = save;
      }
    }
    if (t.t === 'id' && t.v === 'sizeof') {
      this.next();
      if (this.is('(') && this.isTypeAt(1)) { this.next(); const ty = this.type(); this.expect(')'); return { e: 'sizeof', ty: ty.ty, ...p }; }
      return { e: 'sizeof', a: this.unary(), ...p };
    }
    return this.postfix(this.primary());
  }
  postfix(a) {
    for (;;) {
      const t = this.peek(), p = pos(t);
      if (t.t !== 'op') return a;
      if (t.v === '(') {
        this.next(); const args = [];
        while (!this.is(')')) {
          args.push(this.assign());
          if (this.eat(',')) continue;
          const nx = this.peek();
          if (!this.is(')') && nx.t !== 'eof' && nx.line === this.toks[this.i - 1].line && (nx.t !== 'op' || nx.v === '(')) fail(tl('{0} attendue entre les arguments, avant {1}', q(','), show(nx)), nx);
          break;
        }
        this.expect(')', tl('pour fermer l’appel')); a = { e: 'call', f: a, args, ...p }; continue;
      }
      if (t.v === '[') { this.next(); const i = this.expr(); this.expect(']'); a = { e: 'idx', o: a, i, ...p }; continue; }
      if (t.v === '.' || t.v === '->') { this.next(); const n = this.peek(); if (n.t !== 'id') fail(tl('Nom attendu après {0}', q(t.v)), n); this.next(); a = { e: 'mem', o: a, name: n.v, arrow: t.v === '->', ...p }; continue; }
      if (t.v === '++' || t.v === '--') { this.next(); a = { e: 'post', op: t.v, a, ...p }; continue; }
      if (t.v === '::') {
        // Classe::NOM (constante) ou Classe::methode(…) (méthode de la classe).
        if (a.e !== 'id') fail(tl('L’opérateur :: n’est pas pris en charge : appelez la méthode sur un objet (leds.Color(…))'), t);
        this.next(); const n = this.peek(); if (n.t !== 'id') fail(tl('Nom attendu après {0}', q('::')), n); this.next();
        a = { e: 'scope', cls: a.name, name: n.v, line: a.line, col: a.col }; continue;
      }
      return a;
    }
  }
  primary() {
    const t = this.next(), p = pos(t);
    if (t.t === 'num') return { e: 'num', v: t.v, float: t.float, long: t.long, unsigned: t.unsigned, ...p };
    if (t.t === 'str') { let v = t.v; while (this.peek().t === 'str') v += this.next().v; return { e: 'str', v, ...p }; }
    if (t.t === 'chr') return { e: 'chr', v: t.v, ...p };
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') return { e: 'bool', v: t.v === 'true', ...p };
      if (this.classes.has(t.v) && this.is('(')) { this.next(); const args = []; while (!this.is(')')) { args.push(this.assign()); if (!this.eat(',')) break; } this.expect(')'); return { e: 'new', cls: t.v, args, ...p }; }
      if (TYPE_WORDS.has(t.v) && t.v !== 'String' && this.is('(')) { this.i--; const ty = this.type(); this.expect('('); const a = this.expr(); this.expect(')'); return { e: 'cast', ty: ty.ty, a, ...p }; }
      if (['new', 'delete', 'this'].includes(t.v)) fail(tl('{0} n’est pas pris en charge par le simulateur', q(t.v)), t);
      if (KEYWORDS.has(t.v) && t.v !== 'sizeof') fail(tl('{0} inattendu ici', q(t.v)), t);
      return { e: 'id', name: t.v, ...p };
    }
    if (t.t === 'op' && t.v === '(') { const e = this.expr(); this.expect(')', tl('pour fermer la parenthèse')); return e; }
    if (t.t === 'op' && t.v === '{') { this.i--; return this.initList(); }
    if (t.t === 'op' && t.v === '[') {
      // Lambda [](…) { … } : une fonction sans nom (server.on("/", []() { … })). Les variables sont partagées, pas copiées.
      while (!this.is(']')) { if (this.peek().t === 'eof') fail(tl('{0} attendu pour fermer la lambda', q(']')), t); this.next(); }
      this.next();
      let params = [];
      if (this.eat('(')) { params = this.paramList(); this.expect(')', tl('pour fermer les paramètres de la lambda')); }
      this.eat('mutable');
      let ret = T.void;
      if (this.eat('->')) ret = this.type().ty;
      if (!this.is('{')) fail(tl('{0} attendu pour ouvrir le corps de la lambda avant {1}', q('{'), show(this.peek())), this.peek());
      return { e: 'lambda', params, ret, body: this.block(), ...p };
    }
    return fail(t.t === 'eof' ? tl('Le programme se termine trop tôt : une accolade ou une parenthèse n’est pas fermée') : tl('Expression attendue avant {0}', show(t)), t);
  }
}
const pos = t => ({ line: t.line, col: t.col });

/* ---------------- Génération du JavaScript ---------------- */
const BUDGET = 'if(--$.b<0)yield -1;';
const SIZE = t => (t.k === 'int' ? t.b / 8 : t.k === 'float' ? 4 : t.k === 'bool' ? 1 : t.k === 'str' ? 6 : 2);
const RET = (s, bits) => (typeof s === 'string' && s.startsWith('obj:') ? { k: 'obj', c: s.slice(4) } : { void: T.void, bool: T.bool, char: T.char, float: T.float, str: T.str, any: T.any, int: I(bits, false),
  i8: I(8, false), u8: I(8, true), i16: I(16, false), u16: I(16, true), i32: I(32, false), u32: I(32, true), i64: I(64, false) }[s] || T.any);
/** Objet affichable par print() et convertible en texte (IPAddress : toString()). */
const printable = t => t.k === 'obj' && !!CLASSES[t.c] && Object.prototype.hasOwnProperty.call(CLASSES[t.c], 'toString');
// Méthodes de String : celles qui modifient la chaîne sont réécrites en affectation.
const STR_METHODS = {
  length: [0, 'int', o => `${o}.length`], charAt: [1, 'char', (o, a) => `$.charAt(${o},${a[0]})`], substring: [[1, 2], 'str', (o, a) => `$.substring(${o},${a.join(',')})`],
  indexOf: [[1, 2], 'int', (o, a) => `$.indexOf(${o},${a.join(',')})`], lastIndexOf: [[1, 2], 'int', (o, a) => `$.lastIndexOf(${o},${a.join(',')})`],
  toInt: [0, 'i32', o => `$.toInt(${o})`], toFloat: [0, 'float', o => `$.toFloat(${o})`], toDouble: [0, 'float', o => `$.toFloat(${o})`],
  equals: [1, 'bool', (o, a) => `(${o}===${a[0]})`], equalsIgnoreCase: [1, 'bool', (o, a) => `(${o}.toLowerCase()===${a[0]}.toLowerCase())`],
  startsWith: [1, 'bool', (o, a) => `${o}.startsWith(${a[0]})`], endsWith: [1, 'bool', (o, a) => `${o}.endsWith(${a[0]})`],
  compareTo: [1, 'int', (o, a) => `$.compare(${o},${a[0]})`], c_str: [0, 'str', o => o], isEmpty: [0, 'bool', o => `(${o}.length===0)`],
  reserve: [1, 'void', () => '0'],
  trim: [0, 'void', o => `$.trim(${o})`, true], toUpperCase: [0, 'void', o => `${o}.toUpperCase()`, true], toLowerCase: [0, 'void', o => `${o}.toLowerCase()`, true],
  replace: [2, 'void', (o, a) => `$.replace(${o},${a.join(',')})`, true], remove: [[1, 2], 'void', (o, a) => `$.remove(${o},${a.join(',')})`, true],
  concat: [1, 'bool', (o, a) => `(${o}+${a[0]})`, true], setCharAt: [2, 'void', (o, a) => `$.setCharAt(${o},${a.join(',')})`, true]
};
const argCount = (spec, n) => (Array.isArray(spec) ? n >= spec[0] && n <= spec[1] : n === spec);
const argWord = spec => (Array.isArray(spec) ? tl('{0} à {1} arguments', spec[0], spec[1]) : `${spec} argument${spec > 1 ? 's' : ''}`);

class Scope {
  constructor(parent, fn) { this.parent = parent; this.vars = new Map(); this.fn = fn || (parent && parent.fn); }
  get(n) { for (let s = this; s; s = s.parent) if (s.vars.has(n)) return s.vars.get(n); return null; }
  names() { const out = []; for (let s = this; s; s = s.parent) out.push(...s.vars.keys()); return out; }
}

class Gen {
  constructor(ctx) {
    this.intBits = ctx.intBits; this.board = ctx.board; this.boardConsts = BOARD_CONSTS[ctx.board] || {};
    this.boardLabel = ctx.boardLabel || tl('cette carte'); this.statics = []; this.n = 0;
    this.debug = !!ctx.debug; this.hooks = []; this.globals = [];
  }
  /**
   * Mode débogage : arrêt possible à cette ligne. $.D(ligne) décide (point d'arrêt, pas à pas) ;
   * l'arrêt rend la main avec de quoi lire les variables locales visibles. Instruction, ou
   * expression (expr) à placer dans une condition. Rien hors du mode débogage.
   */
  hk(line, sc, expr) {
    if (!this.debug) return '';
    const scopes = [], seen = new Set();
    // Des portées intérieures vers la fonction (la portée globale exclue) : un nom masqué n'apparaît qu'une fois.
    for (let s = sc; s && s.parent; s = s.parent) {
      const vs = [];
      for (const [name, v] of s.vars) if (v.kind === 'var' && !seen.has(name) && /^[A-Za-z_]/.test(v.js)) { seen.add(name); vs.push({ name, v, sw: s.sw }); }
      scopes.unshift(vs);
    }
    const vars = scopes.flat(), h = this.hooks.length;
    this.hooks.push({ line, fn: sc.fn ? sc.fn.name : '', names: vars.map(x => x.name), types: vars.map(x => ctype(x.v.t, x.v)) });
    // Dans un switch, un case peut sauter la déclaration d'une variable d'un autre case : lecture protégée.
    const get = vars.map(x => (x.sw ? `(()=>{try{return ${x.v.js}}catch(e){}})()` : x.v.js)).join(',');
    const y = `yield{h:${h},v:()=>[${get}]}`;
    return expr ? `$.D&&$.D(${line})&&(${y})` : `if($.D&&$.D(${line}))${y};`;
  }
  err(msg, at, x = {}) { fail(msg, at, { code: 'J1199', ...x }); }
  /** Bibliothèque, objet ou fonction propre à certaines cartes (Wi-Fi, Bluetooth) : erreur J1111 sur les autres. */
  onBoard(list, what, at) {
    if (!list || !this.board || list.includes(this.board)) return;
    const help = boardHelp(what, list, this.board);
    this.err(tl('{0} n’existe pas sur {1} : {2}', what, this.boardLabel, help), at, { code: 'J1111', len: String(what).length, help, title: tl('{0} n’existe pas sur {1}', what, this.boardLabel) });
  }
  tag(t) { return t.k === 'float' ? 'f' : t.k === 'bool' ? 'b' : t.k === 'str' ? 's' : t.k === 'int' ? (t.ch ? 'c' : 'i') : '?'; }
  toStr(x, at) {
    const t = x.t;
    if (t.k === 'str') return x.js;
    if (t.k === 'float') return `$.fstr(${x.js})`;
    if (t.k === 'int') return t.ch ? `String.fromCharCode(${x.js})` : `String(${x.js})`;
    if (t.k === 'bool') return `(${x.js}?"1":"0")`;
    if (t.k === 'any') return `$.astr(${x.js})`;
    if (printable(t)) return `${x.js}.toString()`;
    return this.err(tl('Impossible de convertir {0} en texte', tname(t)), at, { code: 'J1104' });
  }
  /** Convertit une valeur vers le type d'une variable, d'un paramètre ou d'un retour. */
  conv(x, to, at) {
    const from = x.t;
    if (to.k === 'any' || to.k === 'void') return x.js;
    if (to.k === 'int' || to.k === 'float' || to.k === 'bool') {
      if (from.k === 'str') this.err(tl('Impossible de mettre une String dans un {0}{1}', tname(to), to.k !== 'bool' ? tl(' : utilisez .toInt() ou .toFloat()') : ''), at, { code: 'J1104', help: to.k !== 'bool' ? tl('utilisez .toInt() ou .toFloat()') : null, title: tl('Impossible de mettre une String dans un {0}', tname(to)) });
      if (from.k === 'obj' || from.k === 'arr' || from.k === 'void') this.err(tl('Impossible de mettre {0} dans un {1}', from.k === 'void' ? tl('le résultat d’une fonction void') : tname(from), tname(to)), at);
      if (to.k === 'bool') return from.k === 'bool' ? x.js : `(!!(${x.js}))`;
      if (to.k === 'float') return from.k === 'bool' ? `(${x.js}?1:0)` : from.k === 'any' ? `(+${x.js})` : x.js;
      if (from.k === 'int' && (from.u === to.u ? from.b <= to.b : from.u && from.b < to.b)) return x.js;
      if (from.k === 'bool') return `(${x.js}?1:0)`;
      return wrapInt(x.js, to);
    }
    if (to.k === 'str') return this.toStr(x, at);
    if (to.k === 'obj') { if (from.k === 'obj' && from.c !== to.c && from.c !== 'sensors_event_t') this.err(tl('Un objet {0} ne peut pas aller dans un {1}', from.c, to.c), at); return x.js; }
    if (to.k === 'arr') { if (from.k !== 'arr' && from.k !== 'any') this.err(tl('Un tableau est attendu ici, pas {0}', tname(from)), at); return x.js; }
    return x.js;
  }
  lookup(name, sc, at) {
    const v = sc.get(name);
    if (v) return v;
    if (this.boardConsts[name] != null) return { kind: 'const', js: String(this.boardConsts[name]), t: I(this.intBits, false) };
    if (CONSTS[name] != null) return { kind: 'const', js: String(CONSTS[name]), t: CONST_TYPES[name] ? T.float : I(this.intBits, false) };
    if (OBJECTS[name]) { this.onBoard(BOARD_ONLY.object[name], name, at); return { kind: 'obj', js: `$.O.${name}`, t: { k: 'obj', c: OBJECTS[name] } }; }
    if (FN[name]) return { kind: 'builtin', name };
    let hint = '';
    if (/^D\d+$/.test(name) && this.board === 'esp32') hint = tl(' : sur l’ESP32, écrivez seulement le numéro de GPIO ({0} pour {1})', name.slice(1), name);
    else if (/^GP\d+$/.test(name) && this.board === 'pico') hint = tl(' : sur le Pico, écrivez seulement le numéro ({0} pour {1})', name.slice(2), name);
    else if (/^A\d+$/.test(name)) hint = tl(' : {0} n’a pas d’entrée {1}', this.boardLabel, name);
    else if (/^(WiFi|WebServer|HTTPClient|SerialBT|client|server|EEPROM|SD)$/.test(name)) hint = tl(' : cette fonction n’est pas simulée');
    else {
      const all = [...Object.keys(FN), 'setup', 'loop'], low = name.toLowerCase(), near = all.find(k => k.toLowerCase() === low), near2 = nearName;
      if (near) hint = tl(' : vouliez-vous écrire {0} ? (les majuscules comptent)', near);
      else { const n = near2(name, [...all, ...sc.names()]); if (n) hint = tl(' : vouliez-vous écrire {0} ?', n); }
    }
    return this.err(tl('{0} n’est pas déclaré{1}', q(name), hint), at, { code: 'J1101', len: name.length, help: hint ? hint.replace(/^ : /, '') : null, title: tl('{0} n’est pas déclaré', q(name)) });
  }
  /* --- Expressions : retourne { js, t, lv } --- */
  x(e, sc) {
    switch (e.e) {
      case 'num': {
        if (e.float) return { js: numJs(e.v), t: T.float };
        const max = this.intBits === 16 ? 32767 : 2147483647;
        return { js: String(e.v), t: e.unsigned ? I(e.long || e.v > 65535 ? 32 : this.intBits, true) : e.long || e.v > max ? I(e.v > 2147483647 ? 64 : 32, false) : I(this.intBits, false) };
      }
      case 'str': return { js: JSON.stringify(e.v), t: T.str };
      case 'chr': return { js: String(e.v), t: T.char };
      case 'bool': return { js: String(e.v), t: T.bool };
      case 'id': {
        const s = this.lookup(e.name, sc, e);
        if (s.kind === 'builtin') this.err(tl('{0} est une fonction : ajoutez les parenthèses, {1}(…)', q(e.name), e.name), e);
        if (s.kind === 'fn') return { js: s.js, t: { k: 'fn', sym: s } };
        return { js: s.js, t: s.t, lv: s.kind === 'var' && !s.konst, sym: s };
      }
      case 'seq': { const xs = e.list.map(a => this.x(a, sc)); return { js: `(${xs.map(a => a.js).join(',')})`, t: xs[xs.length - 1].t }; }
      case 'cond': {
        const c = this.x(e.c, sc), a = this.x(e.a, sc), b = this.x(e.b, sc);
        const t = a.t.k === 'str' || b.t.k === 'str' ? T.str : a.t.k === 'float' || b.t.k === 'float' ? T.float : a.t;
        const side = y => (t === T.str ? this.toStr(y, e) : y.js);
        return { js: `(${this.truth(c, e)}?${side(a)}:${side(b)})`, t };
      }
      case 'un': {
        const a = this.x(e.a, sc);
        if (e.op === '!') return { js: `(!${this.truth(a, e)})`, t: T.bool };
        this.numeric(a, e, e.op);
        if (e.op === '~') return { js: `(~${a.js})`, t: a.t.k === 'int' && a.t.u && a.t.b >= 32 ? I(32, true) : I(Math.max(this.intBits, a.t.b || 0), false) };
        return { js: `(${e.op}${a.js})`, t: a.t.k === 'float' || a.t.k === 'any' ? a.t : I(Math.max(this.intBits, a.t.k === 'int' ? a.t.b : 0), a.t.k === 'int' && a.t.u && a.t.b >= this.intBits) };
      }
      case 'addr': {
        const a = this.x(e.a, sc);
        if (a.t.k === 'obj' || a.t.k === 'arr') return a;
        return this.err(tl('Les pointeurs ne sont pas pris en charge : passez la variable elle-même'), e);
      }
      case 'bin': return this.binary(e, sc);
      case 'assign': return this.assign(e, sc);
      case 'pre': case 'post': {
        const a = this.x(e.a, sc);
        this.lvalue(a, e.a, e.op);
        this.numeric(a, e, e.op);
        const d = e.op === '++' ? '+' : '-';
        if (a.t.k === 'int' && (a.t.b < 32 || a.t.b === 64)) {
          const set = `${a.js}=${wrapInt(`${a.js}${d}1`, a.t)}`;
          return { js: e.e === 'pre' ? `(${set})` : `$.post(${a.js},${set})`, t: a.t };
        }
        if (a.t.k === 'bool') return { js: e.e === 'pre' ? `(${a.js}=true)` : `$.post(${a.js},${a.js}=true)`, t: T.bool };
        return { js: e.e === 'pre' ? `(${e.op}${a.js})` : `(${a.js}${e.op})`, t: a.t };
      }
      case 'cast': { const a = this.x(e.a, sc); return { js: this.conv(a, e.ty, e), t: e.ty }; }
      case 'sizeof': {
        if (e.ty) return { js: String(SIZE(e.ty)), t: I(32, true) };
        const a = this.x(e.a, sc);
        let el = a.t; while (el.k === 'arr') el = el.of;
        if (a.t.k === 'arr') return { js: `$.sizeof(${a.js},${el.k === 'str' && a.sym && a.sym.charArr ? 1 : SIZE(el)})`, t: I(32, true) };
        if (a.t.k === 'str' && a.sym && a.sym.charArr) return { js: a.sym.charLen ? String(a.sym.charLen) : `(${a.js}.length+1)`, t: I(32, true) };
        return { js: String(SIZE(a.t)), t: I(32, true) };
      }
      case 'idx': {
        const o = this.x(e.o, sc), i = this.x(e.i, sc);
        this.numeric(i, e.i, '[ ]');
        if (o.t.k === 'arr') return { js: `${o.js}[$.ck(${o.js},${i.js})]`, t: o.t.of, lv: true, elem: true };
        if (o.t.k === 'str') return { js: `$.charAt(${o.js},${i.js})`, t: T.char, strIdx: o };
        if (o.t.k === 'any') return { js: `${o.js}[${i.js}]`, t: T.any, lv: true };
        return this.err(tl('{0} n’est pas un tableau : impossible d’utiliser [ ]', tname(o.t)), e);
      }
      case 'scope': {
        const cc = CLASS_CONSTS[e.cls], full = `${e.cls}::${e.name}`;
        if (cc && cc[e.name] != null) return { js: String(cc[e.name]), t: I(this.intBits, false), sym: { kind: 'const' } };
        if (CLASSES[e.cls] && CLASSES[e.cls][e.name] && CLASSES[e.cls][e.name].static) this.err(tl('{0} est une fonction : ajoutez les parenthèses, {1}(…)', q(full), full), e);
        return this.err(tl('{0} n’est pas connu du simulateur', q(full)), e, { code: 'J1101', len: full.length });
      }
      case 'mem': {
        const o = this.x(e.o, sc);
        // info->src_addr : un objet de bibliothèque reçu « par pointeur » (rappel ESP-NOW) se lit comme avec le point.
        if (e.arrow && o.t.k !== 'obj') this.err(tl('L’opérateur -> concerne les pointeurs, qui ne sont pas pris en charge : utilisez le point'), e);
        // Champ d'un objet de bibliothèque : IrReceiver.decodedIRData.command, rfid.uid.uidByte[i].
        const fs = o.t.k === 'obj' && CLASSES[o.t.c] && CLASSES[o.t.c][e.name];
        if (fs && fs.field) return { js: `${o.js}.${e.name}`, t: this.fieldType(fs.field), lv: true };
        if (o.t.k === 'str' || (o.t.k === 'obj' && CLASSES[o.t.c] && o.t.c !== 'sensors_event_t')) this.err(tl('{0} est une méthode : ajoutez les parenthèses, .{1}(…)', q(e.name), e.name), e);
        if (o.t.k === 'int' || o.t.k === 'float' || o.t.k === 'bool') this.err(tl('Un nombre n’a pas de champ {0}', q(e.name)), e);
        return { js: `${o.js}.${e.name}`, t: ['x', 'y', 'z', 'temperature', 'roll', 'pitch', 'heading'].includes(e.name) ? T.float : T.any, lv: true };
      }
      case 'call': return this.call(e, sc);
      case 'lambda': {
        const fn = { ret: e.ret, name: 'lambda' }, fs = new Scope(sc, fn);
        const params = e.params.map(p => {
          if (!p.name) this.err(tl('Paramètre sans nom dans la lambda'), p.at);
          fs.vars.set(p.name, { kind: 'var', js: `v_${p.name}`, t: p.ty });
          return `v_${p.name}`;
        });
        const body = e.body.body.map(b => this.s(b, fs)).join('');
        return { js: `(function*(${params.join(',')}){${this.debug ? `$.d++;$.n++;try{${body}}finally{$.d--}` : body}})`, t: { k: 'fn', sym: { kind: 'fn', ret: e.ret, params: e.params } } };
      }
      case 'new': {
        const args = e.args.map(a => this.x(a, sc));
        return { js: `new $.C.${e.cls}(${args.map(a => a.js).join(',')})`, t: { k: 'obj', c: e.cls } };
      }
      case 'list': return this.err(tl('Une liste { … } ne s’utilise que pour initialiser un tableau'), e);
    }
    return this.err(tl('Expression non prise en charge'), e);
  }
  /** Type d'un champ d'objet de bibliothèque : 'u8', 'u8[]' (tableau) ou nom de classe. */
  fieldType(f) {
    if (f.endsWith('[]')) return { k: 'arr', of: RET(f.slice(0, -2), this.intBits) };
    return CLASSES[f] ? { k: 'obj', c: f } : RET(f, this.intBits);
  }
  /**
   * Argument passé par adresse à une méthode de bibliothèque (&valeur, tableau, texte) : un objet { get, set, d }
   * que la méthode lit (radio.write) ou remplit (radio.read, getTextBounds). d décrit le type C++ (taille en octets).
   * Un objet (&Serial, &key) passe tel quel.
   */
  refArg(a, sc) {
    // (uint8_t *) &donnee : le transtypage en pointeur ne change rien à la valeur passée.
    let inner = a;
    while (inner.e === 'cast' && inner.ptr) inner = inner.a;
    if (inner.e === 'addr') inner = inner.a;
    const v = this.x(inner, sc), t = v.t;
    if (t.k === 'obj') return v;
    if (t.k === 'void' || t.k === 'fn') this.err(tl('Une variable est attendue ici'), a);
    const set = v.lv && !(v.sym && v.sym.konst) && t.k !== 'arr'
      ? `v=>{${v.js}=${t.k === 'int' ? wrapInt('v', t) : t.k === 'float' ? '+v' : t.k === 'bool' ? '!!v' : t.k === 'str' ? 'String(v)' : 'v'}}` : 'null';
    return { js: `$.ref(()=>${v.js},${set},${this.desc(t, v.sym)})`, t: T.any };
  }
  /** Description d'un type pour la copie octet par octet : entier (bits, signe), float, texte (taille déclarée), tableau. */
  desc(t, sym, inArr) {
    if (t.k === 'int') return `{k:"i",b:${t.b},u:${!!t.u}}`;
    if (t.k === 'float') return '{k:"f"}';
    if (t.k === 'bool') return '{k:"b"}';
    // Tableau de char : taille déclarée (char texte[32]) ; une String (objet) n'est pas un tableau d'octets.
    if (t.k === 'str') return sym && sym.charArr ? `{k:"s",n:${sym.charLen || 0}}` : sym && sym.kind === 'var' && !inArr ? '{k:"S"}' : '{k:"s",n:0}';
    if (t.k === 'arr') return `{k:"a",of:${this.desc(t.of, sym, true)}}`;
    return '{k:"?"}';
  }
  truth(x, at) { if (x.t.k === 'str') this.err(tl('Une String ne peut pas servir de condition : comparez-la, par exemple texte == "oui" ou texte.length() > 0'), at); if (x.t.k === 'void') this.err(tl('Une fonction void ne renvoie rien à tester'), at); return x.js; }
  numeric(x, at, op) { if (x.t.k === 'str' || x.t.k === 'obj' || x.t.k === 'arr' || x.t.k === 'void') this.err(tl('L’opérateur {0} ne s’applique pas à {1}', q(op), x.t.k === 'void' ? tl('une fonction void') : tname(x.t)), at); }
  lvalue(x, at, op) {
    if (x.strIdx) this.err(tl('Pour changer un caractère d’une String, utilisez texte.setCharAt(i, c)'), at);
    if (x.sym && x.sym.konst) this.err(tl('{0} est une constante : on ne peut pas la modifier', q(at.name || '')), at, { code: 'J1107', len: String(at.name || ' ').length });
    if (x.sym && x.sym.kind === 'const') this.err(tl('{0} est une constante prédéfinie : on ne peut pas la modifier', q(at.name)), at, { code: 'J1107', len: String(at.name || ' ').length });
    if (!x.lv) this.err(tl('Le membre de gauche de {0} doit être une variable', q(op)), at);
  }
  arith(op, a, b, at) {
    const t = a.t.k === 'float' || b.t.k === 'float' ? T.float : a.t.k === 'any' || b.t.k === 'any' ? T.any : promote(a.t, b.t, this.intBits);
    if (op === '/' && t.k === 'int') return { js: `$.div(${a.js},${b.js})`, t };
    if (op === '%' && t.k === 'int') return { js: `$.mod(${a.js},${b.js})`, t };
    if (op === '>>' && a.t.k === 'int' && a.t.u && a.t.b >= 32) return { js: `(${a.js}>>>${b.js})`, t: a.t };
    if (op === '<<' || op === '>>') return { js: `(${a.js}${op}${b.js})`, t: a.t.k === 'int' ? promote(a.t, a.t, this.intBits) : I(this.intBits, false) };
    if ('&|^'.includes(op)) return { js: `(${a.js}${op}${b.js})`, t: t.k === 'float' ? I(32, false) : t };
    return { js: `(${a.js}${op}${b.js})`, t };
  }
  binary(e, sc) {
    const a = this.x(e.a, sc), b = this.x(e.b, sc), op = e.op;
    if (op === '&&' || op === '||') return { js: `(!!${this.truth(a, e.a)}${op}!!${this.truth(b, e.b)})`, t: T.bool };
    if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
      const js = op === '==' ? '===' : op === '!=' ? '!==' : op;
      if ((a.t.k === 'str') !== (b.t.k === 'str') && a.t.k !== 'any' && b.t.k !== 'any') this.err(tl('Comparaison entre une String et {0} : convertissez d’abord, par exemple String(x) ou texte.toInt()', tname(a.t.k === 'str' ? b.t : a.t)), e);
      if (a.t.k === 'obj' || b.t.k === 'obj') this.err(tl('Impossible de comparer des objets'), e);
      return { js: `(${a.js}${js}${b.js})`, t: T.bool };
    }
    if (op === '+' && (a.t.k === 'str' || b.t.k === 'str')) return { js: `(${this.toStr(a, e.a)}+${this.toStr(b, e.b)})`, t: T.str };
    this.numeric(a, e.a, op); this.numeric(b, e.b, op);
    return this.arith(op, a, b, e);
  }
  assign(e, sc) {
    const a = this.x(e.a, sc);
    this.lvalue(a, e.a, e.op);
    if (a.t.k === 'arr') this.err(tl('Un tableau ne s’affecte pas d’un bloc : copiez ses cases une par une'), e);
    if (e.b.e === 'list') this.err(tl('Une liste { … } ne s’utilise qu’à la déclaration du tableau'), e.b);
    let b = this.x(e.b, sc);
    if (e.op !== '=') {
      const op = e.op.slice(0, -1);
      if (op === '+' && a.t.k === 'str') b = { js: `(${a.js}+${this.toStr(b, e.b)})`, t: T.str };
      else { this.numeric(a, e.a, e.op); this.numeric(b, e.b, e.op); b = this.arith(op, a, b, e); }
    }
    if (a.t.k === 'obj' && b.t.k === 'obj' && e.op === '=') return { js: `(${a.js}=${b.js})`, t: a.t };
    return { js: `(${a.js}=${this.conv(b, a.t, e)})`, t: a.t };
  }
  call(e, sc) {
    const f = e.f;
    if (f.e === 'id') {
      if (f.name === 'String') {
        const args = e.args.map(a => this.x(a, sc));
        if (args.length > 2) this.err(tl('String() attend 1 ou 2 arguments'), e);
        return { js: args.length ? `$.String(${args[0].js},${args[1] ? args[1].js : 'undefined'},"${this.tag(args[0].t)}")` : '""', t: T.str };
      }
      const s = this.lookup(f.name, sc, f);
      if (s.kind === 'var' && s.t.k === 'fn') return { js: `(yield* ${s.js}(${e.args.map(a => this.x(a, sc).js).join(',')}))`, t: s.t.sym.ret || T.void };
      if (s.kind === 'fn') {
        const need = s.params.filter(p => !p.def).length;
        if (e.args.length < need || e.args.length > s.params.length) this.err(tl('{0}() attend {1}, {2} donné{3}', f.name, need === s.params.length ? argWord(need) : tl('{0} à {1} arguments', need, s.params.length), e.args.length, e.args.length > 1 ? 's' : ''), e, { code: 'J1103', len: f.name.length });
        const args = e.args.map((a, i) => this.conv(this.x(a, sc), s.params[i].ty, a));
        return { js: `(yield* ${s.js}(${args.join(',')}))`, t: s.ret };
      }
      if (s.kind === 'builtin') return this.builtin(f.name, e, sc);
      if (s.kind === 'var' && s.t.k === 'obj') this.err(tl('{0} est un objet : appelez une de ses méthodes, par exemple {1}.begin()', q(f.name), f.name), e);
      return this.err(tl('{0} n’est pas une fonction', q(f.name)), e);
    }
    if (f.e === 'mem') return this.method(e, f, sc);
    if (f.e === 'scope') {
      // Méthode de la classe : ESP32PWM::allocateTimer(0), DallasTemperature::toFahrenheit(t).
      const mm = CLASSES[f.cls] && CLASSES[f.cls][f.name], full = `${f.cls}::${f.name}`;
      if (!mm || !mm.static) this.err(tl('{0} n’est pas connu du simulateur', q(full)), f, { code: 'J1101', len: full.length });
      const call = `$.C.${f.cls}.${f.name}(${e.args.map(a => this.x(a, sc).js).join(',')})`;
      return { js: mm.block ? `(yield* $.wait(${call}))` : call, t: RET(mm.ret, this.intBits) };
    }
    return this.err(tl('Appel de fonction non pris en charge'), e);
  }
  builtin(name, e, sc) {
    const spec = FN[name];
    if (!argCount(spec.args, e.args.length)) this.err(tl('{0}() attend {1}, {2} donné{3}', name, argWord(spec.args), e.args.length, e.args.length > 1 ? 's' : ''), e, { code: 'J1103', len: name.length });
    if (BOARD_ONLY.fn.test(name)) this.onBoard(['esp32', 'nodemcu'], name + '()', e);
    if (spec.lvalue) {
      const v = this.x(e.args[0], sc); this.lvalue(v, e.args[0], name);
      const rest = e.args.slice(1).map(a => this.x(a, sc).js);
      return { js: `(${v.js}=${wrapInt(`$.${name}(${[v.js, ...rest].join(',')})`, v.t.k === 'int' ? v.t : I(32, false))})`, t: T.void };
    }
    const args = e.args.map((a, i) => (spec.ref && spec.ref.includes(i) ? this.refArg(a, sc) : this.x(a, sc)));
    args.forEach((a, i) => { if (name !== 'F' && name !== 'attachInterrupt' && !spec.raw && (a.t.k === 'str' || a.t.k === 'obj' || a.t.k === 'arr')) this.err(tl('{0}() attend un nombre en argument {1}, pas {2}', name, i + 1, tname(a.t)), e.args[i]); });
    if (name === 'F') return args[0];
    if (name === 'delay') return { js: `(yield $.ms(${args[0].js}))`, t: T.void };
    if (name === 'delayMicroseconds') return { js: `(yield $.ms(${args[0].js}/1000))`, t: T.void };
    if (name === 'yield') return { js: '(yield -1)', t: T.void };
    if (name === 'attachInterrupt' && args[1].t.k !== 'fn') this.err(tl('attachInterrupt() attend le nom d’une fonction en deuxième argument'), e.args[1]);
    let t = RET(spec.ret, this.intBits);
    if (spec.ret === 'arg0') t = args[0].t.k === 'bool' ? I(this.intBits, false) : args[0].t;
    if (spec.ret === 'num') t = args.some(a => a.t.k === 'float') ? T.float : promote(args[0].t, args[1].t, this.intBits);
    const call = `$.${name}(${args.map(a => a.js).join(',')})`;
    return { js: spec.wait ? `(yield* $.wait(${call}))` : call, t };
  }
  method(e, f, sc) {
    const o = this.x(f.o, sc), name = f.name;
    if (o.t.k === 'str') {
      const sm = STR_METHODS[name];
      if (!sm) this.err(tl('Une String n’a pas de méthode {0}', q(name)), f, { code: 'J1110' });
      if (!argCount(sm[0], e.args.length)) this.err(tl('.{0}() attend {1}', name, argWord(sm[0])), e);
      const asText = ['equals', 'equalsIgnoreCase', 'startsWith', 'endsWith', 'compareTo', 'concat'].includes(name);
      const search = ['indexOf', 'lastIndexOf', 'replace'].includes(name);
      const args = e.args.map((a, i) => {
        const v = this.x(a, sc);
        if (asText) return this.toStr(v, a);
        if (search && (i === 0 || name === 'replace')) return v.t.k === 'int' && v.t.ch ? `String.fromCharCode(${v.js})` : v.js;
        return v.js;
      });
      const js = sm[2](o.js, args);
      if (sm[3]) { if (!o.lv) this.err(tl('.{0}() modifie la String : appelez-la sur une variable', name), f); return { js: `(${o.js}=${js})`, t: RET(sm[1], this.intBits) }; }
      return { js, t: RET(sm[1], this.intBits) };
    }
    if (o.t.k === 'obj') {
      const cls = CLASSES[o.t.c], mm = cls && cls[name];
      if (!mm) { const n = near(name, Object.keys(cls || {})); this.err(tl('{0} n’existe pas pour un objet {1}{2}', q(name), o.t.c, n ? tl(' : vouliez-vous écrire {0} ?', n) : ''), f); }
      if (mm.field) this.err(tl('{0} est un champ de {1}, pas une méthode : retirez les parenthèses', q(name), o.t.c), f);
      const args = e.args.map((a, i) => (mm.ref && mm.ref.includes(i) ? this.refArg(a, sc) : this.x(a, sc)));
      if (mm.print) {
        if (args.length > 2) this.err(tl('{0}() attend 0 à 2 arguments', name), e);
        let a0 = args[0];
        if (a0 && printable(a0.t)) a0 = { js: `${a0.js}.toString()`, t: T.str }; // Serial.println(WiFi.localIP())
        if (a0 && (a0.t.k === 'obj' || a0.t.k === 'arr')) this.err(tl('{0}() ne sait pas afficher {1}', name, tname(a0.t)), e.args[0]);
        return { js: `${o.js}.${name}(${a0 ? a0.js : 'undefined'},${args[1] ? args[1].js : 'undefined'},"${a0 ? this.tag(a0.t) : 's'}")`, t: RET(mm.ret, this.intBits) };
      }
      const call = `${o.js}.${name}(${args.map(a => a.js).join(',')})`;
      return { js: mm.block ? `(yield* $.wait(${call}))` : call, t: RET(mm.ret, this.intBits) };
    }
    if (o.t.k === 'any') return { js: `${o.js}.${name}(${e.args.map(a => this.x(a, sc).js).join(',')})`, t: T.any };
    return this.err(tl('{0} n’a pas de méthode {1}', tname(o.t), q(name)), f, { code: 'J1110' });
  }
  /* --- Déclarations --- */
  declType(d) {
    let t = d.ty;
    for (let k = d.dims.length - 1; k >= 0; k--) t = { k: 'arr', of: t };
    return t;
  }
  initValue(d, t, sc) {
    const at = d.at;
    if (t.k === 'arr') {
      const base = baseOf(t);
      // char nom[] = "texte" (ou byte adresse[6] = "00001") : une chaîne, qui garde sa taille déclarée pour sizeof.
      const len = d.dims[0] && d.dims[0].e === 'num' ? d.dims[0].v : 0;
      if ((d.ty === T.char || (d.ty.k === 'int' && d.ty.b === 8)) && d.dims.length === 1 && d.init && d.init.e === 'str') return { js: JSON.stringify(d.init.v), t: T.str, charArr: true, charLen: len };
      if (d.ty === T.char && d.dims.length === 1 && !d.init) return { js: '""', t: T.str, charArr: true, charLen: len };
      const fill = base.k === 'str' ? '""' : base.k === 'obj' ? 'null' : base.k === 'bool' ? 'false' : '0';
      const dims = d.dims.map(x => (x ? this.conv(this.x(x, sc), I(32, false), at) : null));
      if (!d.init) {
        if (dims.some(x => x == null)) this.err(tl('Taille du tableau {0} manquante : indiquez-la entre [ ] ou donnez ses valeurs', q(d.name)), at);
        if (base.k === 'obj') this.err(tl('Les tableaux d’objets ne sont pas pris en charge'), at);
        return { js: `$.arr([${dims.join(',')}],${fill})`, t };
      }
      if (d.init.e !== 'list') this.err(tl('Un tableau s’initialise avec une liste { … }'), d.init);
      const lit = (list, tt, depth) => {
        if (tt.k === 'arr') {
          if (list.e !== 'list') this.err('Liste { … } attendue', list);
          const items = list.items.map(it => lit(it, tt.of, depth + 1));
          return dims[depth] ? `$.pad([${items.join(',')}],${dims[depth]},${tt.of.k === 'arr' ? `()=>$.arr([${dims.slice(depth + 1).join(',')}],${fill})` : `()=>${fill}`})` : `[${items.join(',')}]`;
        }
        if (list.e === 'list') this.err(tl('Trop d’accolades dans la liste de valeurs'), list);
        return this.conv(this.x(list, sc), tt, list);
      };
      return { js: lit(d.init, t, 0), t };
    }
    if (t.k === 'obj') {
      if (d.ctor) return { js: `new $.C.${t.c}(${d.ctor.map(a => this.x(a, sc).js).join(',')})`, t };
      if (d.init) { const v = this.x(d.init, sc); return { js: this.conv(v, t, d.init), t }; }
      return { js: t.c === 'sensors_event_t' ? '$.event()' : `new $.C.${t.c}()`, t };
    }
    let init = d.init || (d.ctor && d.ctor[0]);
    if (d.ctor && d.ctor.length > 1) this.err(tl('Un seul argument attendu entre les parenthèses'), at);
    if (init && init.e === 'list') { if (init.items.length > 1) this.err(tl('{0} n’est pas un tableau : une seule valeur attendue', q(d.name)), init); init = init.items[0]; }
    if (!init) return { js: t.k === 'str' ? '""' : t.k === 'bool' ? 'false' : '0', t };
    const v = this.x(init, sc);
    if (t.k === 'any') { if (v.t.k === 'void') this.err(tl('auto ne peut pas recevoir le résultat d’une fonction void'), init); return { js: v.js, t: v.t }; }
    return { js: this.conv(v, t, init), t };
  }
  vars(decls, sc, mode) {
    const out = [];
    for (let d of decls) {
      // char noms[3][8] = {"…"} : un tableau de chaînes (byte adresses[][6] = {"00001", …} aussi). Mais
      // char touches[4][4] = {{'1', '2', …}} reste un tableau de caractères (clavier matriciel).
      const leaf = it => (it && it.e === 'list' ? leaf(it.items[0]) : it), lf = leaf(d.init);
      if (d.ty.k === 'int' && d.ty.b === 8 && d.dims.length >= 2 && (lf ? lf.e === 'str' : d.ty === T.char)) d = { ...d, ty: T.str, dims: d.dims.slice(0, -1) };
      if (sc.vars.has(d.name)) this.err(tl('{0} est déjà déclaré {1}', q(d.name), sc.parent ? tl('dans ce bloc') : tl('plus haut')), d.at, { code: 'J1106', len: d.name.length });
      if (d.ty.k === 'void') this.err(tl('Une variable ne peut pas être de type void'), d.at);
      if (d.ty.k === 'obj') this.onBoard(BOARD_ONLY.class[d.ty.c], d.ty.c, d.at);
      const t = this.declType(d), isStatic = d.quals.has('static') && sc.fn;
      const js = isStatic ? `s${++this.n}_${d.name}` : `v_${d.name}`;
      const v = this.initValue(d, t, sc);
      const sym = { kind: 'var', js, t: v.t, konst: d.quals.has('const') || d.quals.has('constexpr'), charArr: v.charArr, charLen: v.charLen };
      if (isStatic) { this.statics.push(`$.l=${d.at.line};${js}=${v.js};`); this.staticDecls.push(js); }
      else out.push(`${js}=${v.js}`);
      sc.vars.set(d.name, sym);
    }
    return out;
  }
  /* --- Instructions --- */
  s(st, sc) {
    const L = `$.l=${st.line};`, H = () => this.hk(st.line, sc), top = s => (this.debug ? L + this.hk(st.line, s) : '');
    // Mode débogage : un arrêt avant chaque instruction, et en tête de chaque tour de boucle.
    switch (st.s) {
      case 'block': { const inner = new Scope(sc); return `{${st.body.map(b => this.s(b, inner)).join('')}}`; }
      case 'empty': return ';';
      case 'expr': return `${L}${H()}${this.x(st.e, sc).js};`;
      case 'vars': {
        // L'arrêt se place avant la déclaration : les nouveaux noms n'existent pas encore.
        const h = st.decls.some(d => !(d.quals.has('static') && sc.fn)) ? H() : '', v = this.vars(st.decls, sc);
        return v.length ? `${L}${h}let ${v.join(',')};` : '';
      }
      case 'if': return `${L}${H()}if(${this.truth(this.x(st.c, sc), st.c)})${this.body(st.a, sc)}${st.b ? `else ${this.body(st.b, sc)}` : ''}`;
      case 'while': return `${L}${H()}while(${this.truth(this.x(st.c, sc), st.c)}){${BUDGET}${top(sc)}${this.loopBody(st.body, sc)}}`;
      case 'do': {
        const b = this.loopBody(st.body, sc), c = this.truth(this.x(st.c, sc), st.c), cl = st.c.line || st.line;
        // Débogage : l'arrêt du do … while est sur la ligne de sa condition, évaluée à chaque tour (même après continue).
        return `do{${BUDGET}${b}${L}}while(${this.debug ? `($.l=${cl},${this.hk(cl, sc, true)},${c})` : c});`;
      }
      case 'for': {
        const fs = new Scope(sc, sc.fn);
        let init = '';
        if (st.init && st.init.s === 'vars') init = `let ${this.vars(st.init.decls, fs).join(',')}`;
        else if (st.init) init = this.x(st.init.e, fs).js;
        const c = st.c ? this.truth(this.x(st.c, fs), st.c) : '';
        const u = st.u ? this.x(st.u, fs).js : '';
        return `${L}${H()}for(${init};${c};${u}){${BUDGET}${top(fs)}${this.loopBody(st.body, fs)}}`;
      }
      case 'forof': {
        const arr = this.x(st.arr, sc);
        if (arr.t.k !== 'arr') this.err(tl('La boucle for ( : ) parcourt un tableau'), st.arr);
        const fs = new Scope(sc, sc.fn), t = st.ty.k === 'any' ? arr.t.of : st.ty;
        fs.vars.set(st.name, { kind: 'var', js: `v_${st.name}`, t });
        return `${L}${H()}for(let v_${st.name} of ${arr.js}){${BUDGET}${top(fs)}${this.loopBody(st.body, fs)}}`;
      }
      case 'switch': {
        const e = this.x(st.e, sc);
        if (e.t.k === 'str') this.err(tl('switch ne fonctionne pas avec une String : utilisez if / else if'), st.e);
        const inner = new Scope(sc); inner.sw = true;
        return `${L}${H()}switch(${e.js}){${st.cases.map(c => `${c.test ? `case ${this.x(c.test, inner).js}` : 'default'}:${c.body.map(b => this.s(b, inner)).join('')}`).join('')}}`;
      }
      case 'break': return 'break;';
      case 'continue': return 'continue;';
      case 'return': {
        const fn = sc.fn;
        if (!st.e) { if (fn.ret.k !== 'void') this.err(tl('{0}() doit renvoyer une valeur ({1})', fn.name, tname(fn.ret)), st, { code: 'J1108', len: 6 }); return `${L}${H()}return;`; }
        if (fn.ret.k === 'void') this.err(tl('{0}() est void : elle ne renvoie pas de valeur', fn.name), st, { code: 'J1108', len: 6 });
        return `${L}${H()}return ${this.conv(this.x(st.e, sc), fn.ret, st.e)};`;
      }
    }
    return this.err(tl('Instruction non prise en charge'), st);
  }
  body(st, sc) { return st.s === 'block' ? this.s(st, sc) : `{${this.s(st, new Scope(sc))}}`; }
  loopBody(st, sc) { const inner = new Scope(sc); return st.s === 'block' ? st.body.map(b => this.s(b, inner)).join('') : this.s(st, inner); }
  program(items) {
    const g = new Scope(null), out = ['"use strict";'], inits = [];
    this.staticDecls = [];
    // Valeurs des enum et signatures des fonctions d'abord : on peut appeler une fonction définie plus bas.
    const fns = new Map();
    for (const it of items) {
      if (it.kind !== 'func') continue;
      const prev = fns.get(it.name);
      if (prev && prev.body && it.body) this.err(tl('La fonction {0}() est définie deux fois (la surcharge n’est pas prise en charge)', it.name), it.at, { code: 'J1106', len: it.name.length });
      if (!prev || it.body) fns.set(it.name, it);
    }
    for (const [name, it] of fns) {
      if (!it.body) this.err(tl('La fonction {0}() est déclarée mais jamais écrite', name), it.at);
      g.vars.set(name, { kind: 'fn', js: `f_${name}`, ret: it.ret, params: it.params, name });
    }
    for (const it of items) {
      if (it.kind === 'enum') {
        let v = 0;
        for (const mbr of it.members) {
          if (g.vars.has(mbr.name)) this.err(tl('{0} est déjà déclaré', q(mbr.name)), mbr.at);
          if (mbr.value) v = constEval(mbr.value);
          g.vars.set(mbr.name, { kind: 'var', js: String(v), t: I(this.intBits, false), konst: true }); v++;
        }
      }
      if (it.kind === 'vars') {
        for (const d of it.decls) if (fns.has(d.name)) this.err(tl('{0} est déjà le nom d’une fonction', q(d.name)), d.at);
        const v = this.vars(it.decls, g);
        it.decls.forEach((d, k) => {
          const sym = g.vars.get(d.name);
          out.push(`let ${sym.js};`); inits.push(`$.l=${d.at.line};${v[k]};`);
          this.globals.push({ name: d.name, t: ctype(sym.t, sym), js: sym.js });
        });
      }
    }
    for (const it of items) {
      if (it.kind !== 'func' || !it.body || fns.get(it.name) !== it) continue;
      const fn = { ret: it.ret, name: it.name }, fs = new Scope(g, fn);
      const params = it.params.map(p => {
        if (!p.name) this.err(tl('Paramètre sans nom dans {0}()', it.name), p.at);
        if (fs.vars.has(p.name)) this.err(tl('Paramètre {0} en double', q(p.name)), p.at);
        fs.vars.set(p.name, { kind: 'var', js: `v_${p.name}`, t: p.ty });
        return p.def ? `v_${p.name}=${this.conv(this.x(p.def, g), p.ty, p.def)}` : `v_${p.name}`;
      });
      // Paramètres et corps partagent une portée : redéclarer un paramètre est une erreur, comme en C++.
      const body = it.body.body.map(b => this.s(b, fs)).join('');
      // Débogage : profondeur d'appel ($.d) et nombre d'appels ($.n), pour « pas à pas principal » et « sortir ».
      out.push(`function* f_${it.name}(${params.join(',')}){${this.debug ? `$.d++;$.n++;try{${body}}finally{$.d--}` : body}}`);
    }
    const setup = fns.get('setup'), loop = fns.get('loop');
    if (!setup) this.err(tl('La fonction setup() est absente : elle s’exécute une fois au démarrage'), { line: 1, col: 1 }, { code: 'J1105' });
    if (!loop) this.err(tl('La fonction loop() est absente : elle s’exécute en boucle après setup()'), { line: 1, col: 1 }, { code: 'J1105' });
    [setup, loop].forEach(f => { if (f.ret.k !== 'void' || f.params.length) this.err(tl('{0}() s’écrit void {1}() sans paramètre', f.name, f.name), f.at, { code: 'J1105', len: f.name.length }); });
    out.push(...this.staticDecls.map(s => `let ${s};`));
    out.push(`function* __init(){${inits.join('')}${this.statics.join('')}}`);
    // G : valeurs des variables globales, lues par la fenêtre des variables (débogueur).
    out.push(`return {init:__init,setup:f_setup,loop:f_loop,G:()=>[${this.globals.map(v => v.js).join(',')}]};`);
    return out.join('\n');
  }
}
/** Conseil quand une bibliothèque n'existe pas sur la carte : son équivalent, ou une carte qui l'a. */
function boardHelp(what, list, board) {
  const twin = INCLUDE_TWIN[what];
  if (twin && (BOARD_ONLY.include[twin] || []).includes(board)) return tl('sur cette carte, écrivez #include <{0}>', twin);
  if (/Bluetooth/.test(what)) return tl('seul l’ESP32 a le Bluetooth classique');
  if (/Preferences/.test(what)) return tl('Preferences n’existe que sur l’ESP32 : utilisez EEPROM.h');
  if (list.length === 1 && list[0] === 'nodemcu') return tl('cette bibliothèque est celle de l’ESP8266 (NodeMCU)');
  if (list.length === 1 && list[0] === 'esp32') return board === 'nodemcu' ? tl('cette bibliothèque est celle de l’ESP32') : tl('cette carte n’a pas de Wi-Fi : choisissez un ESP32');
  return tl('cette carte n’a pas de Wi-Fi : choisissez un ESP32 ou un NodeMCU (ESP8266)');
}
/** Nom le plus proche (au plus 2 lettres de différence), pour suggérer une correction. */
function nearName(name, list) {
  const d = (a, b) => {
    const m = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) { let prev = m[0]; m[0] = i; for (let j = 1; j <= b.length; j++) { const t = m[j]; m[j] = Math.min(m[j] + 1, m[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
    return m[b.length];
  };
  let best = null, bd = name.length > 4 ? 3 : 2;
  for (const k of new Set(list)) { if (Math.abs(k.length - name.length) > 2) continue; const v = d(name.toLowerCase(), k.toLowerCase()); if (v < bd) { bd = v; best = k; } }
  return best;
}
const near = nearName;
const baseOf = t => (t.k === 'arr' ? baseOf(t.of) : t);
const numJs = v => (Number.isFinite(v) ? String(v) : 'Infinity');
function promote(a, b, intBits) {
  const bits = Math.max(intBits, a.k === 'int' ? a.b : 0, b.k === 'int' ? b.b : 0);
  const u = (a.k === 'int' && a.u && a.b === bits) || (b.k === 'int' && b.u && b.b === bits);
  return I(bits, u);
}
function wrapInt(js, t) {
  switch (t.b) {
    case 8: return t.u ? `((${js})&255)` : `(((${js})<<24)>>24)`;
    case 16: return t.u ? `((${js})&65535)` : `(((${js})<<16)>>16)`;
    case 32: return t.u ? `((${js})>>>0)` : `((${js})|0)`;
    default: return `$.i64(${js})`;
  }
}

/**
 * Analyse seule (sans génération) : l'arbre du programme, pour les vérifications statiques
 * (quelles broches le programme commande ou lit). Rend { ok, items, includes } ou { ok: false, error }.
 */
export function parse(src, ctx = {}) {
  const intBits = INT_BITS[ctx.board] || 32;
  try {
    const pp = preprocess(lex(src));
    const items = new Parser(pp.toks, { intBits, types: new Set(), classes: new Set(Object.keys(CLASSES)) }).program();
    return { ok: true, items, includes: pp.includes };
  } catch (e) {
    if (!(e instanceof CompileError)) return { ok: false, error: { line: 0, col: 0, msg: e.message } };
    return { ok: false, error: { line: e.line, col: e.col, msg: e.message } };
  }
}

/**
 * Compile un programme Arduino pour une carte.
 * ctx : { board: 'uno' | 'esp32' | …, boardLabel, debug }.
 * Retourne { ok, js, errors: [{ line, col, msg }], warnings, includes, globals: [{ name, t }] }.
 * debug : arrêts possibles à chaque instruction (débogueur), décrits par
 * debug: { hooks: [{ line, fn, names, types }], lines: Set des lignes, globals }.
 */
export function compile(src, ctx = {}) {
  const intBits = INT_BITS[ctx.board] || 32;
  try {
    const pp = preprocess(lex(src));
    const gen = new Gen({ ...ctx, intBits });
    for (const [file, d] of pp.incAt) gen.onBoard(BOARD_ONLY.include[file], file, d);
    const p = new Parser(pp.toks, { intBits, types: new Set(), classes: new Set(Object.keys(CLASSES)) });
    const items = p.program();
    const js = gen.program(items);
    const globals = gen.globals.map(({ name, t }) => ({ name, t }));
    const warnings = pp.warnings.slice(), sv = pp.incAt.get('Servo.h');
    // La bibliothèque Servo d'Arduino ne connaît pas l'ESP32 : ESP32Servo la remplace (mêmes méthodes).
    if (sv && ctx.board === 'esp32') warnings.push({ line: sv.line, col: sv.col, code: 'J1109', msg: tl('Servo.h ne fonctionne pas sur l’ESP32 : installez la bibliothèque ESP32Servo et écrivez #include <ESP32Servo.h>') });
    const res = { ok: true, js, errors: [], warnings, includes: pp.includes, globals };
    if (ctx.debug) res.debug = { hooks: gen.hooks, lines: new Set(gen.hooks.map(h => h.line)), globals };
    return res;
  } catch (e) {
    if (!(e instanceof CompileError)) { console.error(e); return { ok: false, errors: [{ line: 0, col: 0, msg: tl('Erreur interne du compilateur : ') + e.message }], warnings: [] }; }
    return { ok: false, errors: [{ line: e.line, col: e.col, msg: e.message, code: e.code || 'J1001', len: e.len || 1, help: e.help, title: e.title || e.message }], warnings: [] };
  }
}
