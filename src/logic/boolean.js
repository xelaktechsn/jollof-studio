// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique : équations booléennes. Lecture d'une expression écrite par un élève (A.B + /C, A & !B,
// (A+B)', A ⊕ B…), calcul de sa table, comparaison de deux expressions, simplification d'une table
// (méthode de Quine-McCluskey, somme de produits minimale) et disposition d'un tableau de Karnaugh.

/* ---------- Lecture ---------- */
// Grammaire : ou := xor ('+' | '|' | 'OR' xor)* ; xor := et ('^' | '⊕' | 'XOR' et)* ;
// et := non (('.' | '*' | '&' | '·' | 'AND') non)* ; non := ('!' | '~' | '/' | '¬' | 'NOT') non | prim "'"* ;
// prim := nom | 0 | 1 | '(' ou ')'. Un nom : lettre suivie de lettres, chiffres ou « _ ».
const OPS = { '+': 'or', '|': 'or', '∨': 'or', '^': 'xor', '⊕': 'xor', '.': 'and', '*': 'and', '&': 'and', '·': 'and', '∧': 'and', '!': 'not', '~': 'not', '/': 'not', '¬': 'not' };
const WORDS = { OR: 'or', OU: 'or', XOR: 'xor', AND: 'and', ET: 'and', NOT: 'not', NON: 'not' };
function lex(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')' || c === "'" || c === '’') { out.push({ t: c === '’' ? "'" : c, at: i }); i++; continue; }
    if (src.startsWith('&&', i) || src.startsWith('||', i)) { out.push({ t: OPS[c], at: i }); i += 2; continue; }
    if (OPS[c]) { out.push({ t: OPS[c], at: i }); i++; continue; }
    if (c === '0' || c === '1') { out.push({ t: 'num', v: +c, at: i }); i++; continue; }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (m) { const w = m[0]; out.push(WORDS[w.toUpperCase()] ? { t: WORDS[w.toUpperCase()], at: i } : { t: 'id', v: w, at: i }); i += w.length; continue; }
    throw Object.assign(new Error('caractère inattendu'), { at: i, ch: c });
  }
  return out;
}
/** Arbre d'une expression : { op: 'or'|'xor'|'and'|'not'|'var'|'const', a?, b?, name?, v? }. Lève une erreur si illisible. */
export function parse(src) {
  const tk = lex(String(src)); let i = 0;
  const peek = () => tk[i] && tk[i].t, eat = t => (peek() === t ? tk[i++] : null);
  const fail = msg => { throw Object.assign(new Error(msg), { at: tk[i] ? tk[i].at : String(src).length }); };
  function or() { let a = xor(); while (peek() === 'or') { i++; a = { op: 'or', a, b: xor() }; } return a; }
  function xor() { let a = and(); while (peek() === 'xor') { i++; a = { op: 'xor', a, b: and() }; } return a; }
  function and() { let a = not(); while (peek() === 'and') { i++; a = { op: 'and', a, b: not() }; } return a; }
  function not() {
    if (eat('not')) return { op: 'not', a: not() };
    let a = prim(); while (eat("'")) a = { op: 'not', a }; return a;
  }
  function prim() {
    const t = tk[i];
    if (!t) fail('expression incomplète');
    if (t.t === 'id') { i++; return { op: 'var', name: t.v }; }
    if (t.t === 'num') { i++; return { op: 'const', v: t.v }; }
    if (eat('(')) { const e = or(); if (!eat(')')) fail('parenthèse fermante manquante'); return e; }
    return fail('opérande attendu');
  }
  if (!tk.length) fail('expression vide');
  const e = or();
  if (i < tk.length) fail(tk[i].t === 'id' || tk[i].t === 'num' || tk[i].t === '(' ? 'opérateur manquant (écrivez A.B ou A+B)' : 'symbole en trop');
  return e;
}
export function evaluate(e, env) {
  switch (e.op) {
    case 'or': return evaluate(e.a, env) | evaluate(e.b, env);
    case 'xor': return evaluate(e.a, env) ^ evaluate(e.b, env);
    case 'and': return evaluate(e.a, env) & evaluate(e.b, env);
    case 'not': return 1 - evaluate(e.a, env);
    case 'const': return e.v;
    default: return env[e.name] ? 1 : 0;
  }
}
export function varsOf(e, out = new Set()) { if (e.op === 'var') out.add(e.name); if (e.a) varsOf(e.a, out); if (e.b) varsOf(e.b, out); return out; }
/** Colonne de la table d'une expression sur des variables (première = poids fort) : chaîne de 0 et 1. */
export function column(src, vars) {
  const e = typeof src === 'string' ? parse(src) : src;
  let s = '';
  for (let k = 0; k < 1 << vars.length; k++) { const env = {}; vars.forEach((v, i) => (env[v] = (k >> (vars.length - 1 - i)) & 1)); s += evaluate(e, env); }
  return s;
}
/** Une sortie attendue : chaîne de bits (« 0110 ») ou expression (« A^B »). */
export function expected(spec, vars) {
  const s = String(spec).replace(/\s+/g, '');
  if (/^[01xX-]+$/.test(s) && s.length === 1 << vars.length) return s.toLowerCase().replace(/-/g, 'x');
  return column(spec, vars);
}

/* ---------- Simplification (Quine-McCluskey) ---------- */
// Un impliquant : { v: valeurs, m: masque des variables éliminées } sur n bits (bit n−1 = première variable).
const bitsCount = x => { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; };
/** Somme de produits minimale. ones, dc : numéros des lignes à 1 et indifférentes. */
export function minimize(n, ones, dc = []) {
  if (!ones.length) return [];
  if (ones.length + dc.length === 1 << n) return [{ v: 0, m: (1 << n) - 1 }];
  let cur = [...new Set([...ones, ...dc])].map(v => ({ v, m: 0, used: false }));
  const primes = [];
  while (cur.length) {
    const next = new Map();
    for (let i = 0; i < cur.length; i++) for (let j = i + 1; j < cur.length; j++) {
      const a = cur[i], b = cur[j];
      if (a.m !== b.m) continue;
      const d = a.v ^ b.v; if (bitsCount(d) !== 1) continue;
      a.used = b.used = true;
      const k = (a.v & ~d) + ':' + (a.m | d);
      if (!next.has(k)) next.set(k, { v: a.v & ~d, m: a.m | d, used: false });
    }
    cur.forEach(t => { if (!t.used) primes.push(t); });
    cur = [...next.values()];
  }
  const covers = (t, x) => (x & ~t.m) === t.v;
  // Impliquants essentiels, puis couverture gloutonne (exacte par recherche pour les petites tables).
  const need = new Set(ones), chosen = [];
  for (const x of ones) { const c = primes.filter(t => covers(t, x)); if (c.length === 1 && !chosen.includes(c[0])) chosen.push(c[0]); }
  chosen.forEach(t => ones.forEach(x => { if (covers(t, x)) need.delete(x); }));
  const rest = primes.filter(t => !chosen.includes(t));
  if (need.size) {
    const left = [...need], cost = t => n - bitsCount(t.m) + 1;
    let best = null;
    if (rest.length <= 14) { // recherche exhaustive : la plus petite couverture, puis le moins de littéraux
      for (let s = 1; s < 1 << rest.length; s++) {
        const set = rest.filter((t, i) => (s >> i) & 1);
        if (best && set.length > best.length) continue;
        if (!left.every(x => set.some(t => covers(t, x)))) continue;
        const c = set.reduce((a, t) => a + cost(t), 0);
        if (!best || set.length < best.length || c < best.c) { best = set; best.c = c; }
      }
    }
    if (!best) { best = []; const todo = new Set(left); while (todo.size) { const t = rest.reduce((b, t) => { const k = [...todo].filter(x => covers(t, x)).length; return !b || k > b.k ? { t, k } : b; }, null).t; best.push(t); [...todo].forEach(x => { if (covers(t, x)) todo.delete(x); }); } }
    chosen.push(...best);
  }
  return chosen.map(({ v, m }) => ({ v, m })).sort((a, b) => bitsCount(a.m) - bitsCount(b.m) || b.v - a.v);
}
/** Littéraux d'un impliquant : [{ name, neg }]. */
export function literals(t, vars) {
  const n = vars.length, out = [];
  vars.forEach((name, i) => { const b = 1 << (n - 1 - i); if (!(t.m & b)) out.push({ name, neg: !(t.v & b) }); });
  return out;
}
/** Équation en texte (A.B + /C) et en HTML (barres au-dessus). */
export function formatSop(terms, vars) {
  if (!terms.length) return { text: '0', html: '0' };
  if (terms.length === 1 && terms[0].m === (1 << vars.length) - 1) return { text: '1', html: '1' };
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const text = terms.map(t => literals(t, vars).map(l => (l.neg ? '/' : '') + l.name).join('.')).join(' + ');
  const html = terms.map(t => literals(t, vars).map(l => (l.neg ? `<span class="ov">${esc(l.name)}</span>` : esc(l.name))).join('·')).join(' + ');
  return { text, html };
}
/** Équation simplifiée d'une colonne de table (chaîne de 0, 1, x). */
export function simplify(col, vars) {
  const ones = [], dc = [];
  for (let k = 0; k < col.length; k++) { if (col[k] === '1') ones.push(k); else if (col[k] === 'x') dc.push(k); }
  const terms = minimize(vars.length, ones, dc);
  return { terms, ...formatSop(terms, vars) };
}
/** Forme canonique (somme des mintermes). */
export function canonical(col, vars) {
  const terms = []; for (let k = 0; k < col.length; k++) if (col[k] === '1') terms.push({ v: k, m: 0 });
  return formatSop(terms, vars);
}

/* ---------- Tableau de Karnaugh (2 à 4 variables) ---------- */
const GRAY = [[0], [0, 1], [0, 1, 3, 2]];
/**
 * Disposition : lignes = premières variables, colonnes = dernières, ordre de Gray.
 * Rend { rowVars, colVars, rows: [codes], cols: [codes], cell(r, c) → numéro de ligne de la table }.
 */
export function karnaugh(vars) {
  const n = vars.length; if (n < 2 || n > 4) return null;
  const nr = n >> 1, nc = n - nr;
  const rows = GRAY[nr], cols = GRAY[nc];
  return { rowVars: vars.slice(0, nr), colVars: vars.slice(nr), rows, cols, cell: (r, c) => (rows[r] << nc) | cols[c], nr, nc };
}
/** Regroupements d'un impliquant sur le tableau : rectangles [{ r0, c0, r1, c1 }] (plusieurs s'il passe par un bord). */
export function kGroups(K, t) {
  const cellsR = [], cellsC = [], nrB = K.nr, ncB = K.nc;
  K.rows.forEach((code, r) => { const m = t.m >> ncB, v = t.v >> ncB; if ((code & ~m) === (v & ((1 << nrB) - 1) & ~m)) cellsR.push(r); });
  K.cols.forEach((code, c) => { const m = t.m & ((1 << ncB) - 1), v = t.v & ((1 << ncB) - 1); if ((code & ~m) === (v & ~m)) cellsC.push(c); });
  const runs = (idx, len) => { // indices consécutifs, avec retour au début
    if (idx.length === len) return [[0, len - 1]];
    const out = []; let s = idx[0], p = idx[0];
    for (let i = 1; i < idx.length; i++) { if (idx[i] === p + 1) p = idx[i]; else { out.push([s, p]); s = p = idx[i]; } }
    out.push([s, p]); return out;
  };
  const R = runs(cellsR, K.rows.length), Cc = runs(cellsC, K.cols.length), out = [];
  for (const [r0, r1] of R) for (const [c0, c1] of Cc) out.push({ r0, r1, c0, c1 });
  return out;
}
