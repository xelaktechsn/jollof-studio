// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : le programme Arduino d'un GRAFCET, pour la carte du montage électronique. Une variable par étape
// (X0, X1…) ; à chaque tour de loop() : lecture des entrées, calcul de toutes les transitions franchissables, puis
// désactivation des étapes amont et activation des étapes aval (franchissement simultané, l'activation l'emporte),
// enfin les sorties : une électrovanne est excitée tant qu'une étape qui la commande est active. C'est la façon
// classique d'écrire un GRAFCET dans un automate ou une carte ; le programme reste lisible et modifiable.
// Les entrées sont les boutons et capteurs du montage qui portent le nom des variables (BTN1, B2…), les sorties les
// électrovannes et effecteurs qui portent le nom des actions (Y1…). Chargé à la demande (bouton du panneau GRAFCET).
import { tl } from '../i18n/index.js';
import { createGenContext } from '../prog/rules.js';
import { compileGrafcet, cmpOf, evalArith } from './grafcet.js';

/** Valeur constante d'un calcul (sans variable), sinon null. */
const constOf = e => (e.op === 'num' ? e.v : e.op === 'neg' && e.a.op === 'num' ? -e.a.v : null);

const INPUTS = new Set(['button', 'cylsensor', 'pressostat']);
const ident = s => String(s).replace(/[^A-Za-z0-9_]/g, '_');

/** Expression C d'une réceptivité compilée ; V(nom) traduit une variable. */
function cExpr(e, V) {
  switch (e.op) {
    case 'or': return `(${cExpr(e.a, V)} || ${cExpr(e.b, V)})`;
    case 'and': return `(${cExpr(e.a, V)} && ${cExpr(e.b, V)})`;
    case 'xor': return `(${cExpr(e.a, V)} != ${cExpr(e.b, V)})`;
    case 'not': return `!${cExpr(e.a, V)}`;
    case 'const': return e.v ? 'true' : 'false';
    default: return V(e.name);
  }
}
const strip = s => (s.startsWith('(') && s.endsWith(')') && !/\)\s*(&&|\|\||!=)\s*\(/.test(s) ? s.slice(1, -1) : s);
/** Variables internes lues par une expression (temporisations, fronts). */
function internals(e, out) { if (!e) return out; if (e.op === 'var') out.add(e.name.toLowerCase()); internals(e.a, out); internals(e.b, out); return out; }

/**
 * Programme de la carte board pour le GRAFCET g. cx : { comps, A, inspect } (comme les règles). Rend { code,
 * missingIn: [variables sans entrée du montage], missingOut: [actions sans effecteur] } ou { error }.
 */
export function grafcetProgram(board, cx, g) {
  const C = compileGrafcet(g);
  if (C.errors.length) return { error: C.errors[0].text };
  if (!C.stepList.length) return { error: tl('Le GRAFCET n’a aucune étape.') };
  const G = createGenContext(board, cx), comp = n => cx.comps.find(c => c.name.toLowerCase() === String(n).toLowerCase());
  const missingIn = [], missingOut = [];
  // Entrées : un bouton ou un capteur du montage par variable, lu au début de loop().
  const inVar = new Map();
  for (const v of C.vars) {
    const c = comp(v), sv = c && INPUTS.has(c.type) ? G.readSignal(c, 'pressed') : null;
    if (sv) inVar.set(v, sv); else { inVar.set(v, 'false'); missingIn.push(v); }
  }
  const all = new Set(); for (const t of C.trans) internals(t.expr, all); for (const [, list] of C.acts) for (const a of list) internals(a.cond, all);
  const timers = new Set(), edges = new Set();
  for (const v of all) { let m; if ((m = /^__t_(\d+)_/.exec(v))) timers.add(+m[1]); if ((m = /^__(?:up|dn)_(.+)$/.exec(v))) edges.add(m[1]); }
  const before = v => `${ident(v)}_avant`, mem = n => `M_${ident(n)}`, cnt = n => `V_${ident(n)}`;
  const OPS = { eq: '==', ne: '!=', lt: '<', le: '<=', gt: '>', ge: '>=' };
  const V = name => {
    const l = name.toLowerCase(); let m;
    if ((m = /^x(\d+)$/.exec(l))) return C.macros.has(+m[1]) ? `(${[...C.macros.get(+m[1]).steps].map(n => `X${n}`).join(' || ')})` : `X${m[1]}`;
    if ((m = /^__t_(\d+)_(\d+)$/.exec(l))) return `(X${m[1]} && millis() - debutX${m[1]} >= ${m[2]}UL)`;
    if ((m = /^__up_(.+)$/.exec(l))) return `(${inVar.get(m[1]) || 'false'} && !${before(m[1])})`;
    if ((m = /^__dn_(.+)$/.exec(l))) return `(!${inVar.get(m[1]) || 'false'} && ${before(m[1])})`;
    const q = cmpOf(l);
    if (q) return `(${C.counters.has(q.name) ? cnt(q.name) : `(${inVar.get(q.name.toLowerCase()) || 'false'} ? 1 : 0)`} ${OPS[q.op]} ${q.v})`;
    return inVar.get(l) || 'false';
  };
  /** Calcul d'une action mémorisée : compteurs, sorties mémorisées (0 ou 1). */
  const A = e => {
    switch (e.op) {
      case 'num': return String(e.v);
      case 'var': return C.counters.has(e.name) ? cnt(e.name) : C.stored.has(e.name) ? `(${mem(e.name)} ? 1 : 0)` : '0';
      case 'neg': return `-${A(e.a)}`;
      default: return `(${A(e.a)} ${e.op} ${A(e.b)})`;
    }
  };
  // Variables d'étape, sorties mémorisées, compteurs, instants d'activation (temporisations), fronts.
  G.glob.push(tl('// GRAFCET : une variable par étape, vraie quand l’étape est active.'));
  for (const s of C.stepList) G.glob.push(`bool X${s.n} = ${s.init ? 'true' : 'false'};`);
  // Valeurs de départ : celles que donnent les actions mémorisées des étapes initiales.
  const start = new Map(), get = v => start.get(v) || 0;
  for (const n of C.init) for (const a of C.acts.get(n) || []) if (a.set) start.set(a.name, evalArith(a.set, get));
  for (const n of C.stored) G.glob.push(tl('bool {0} = {1}; // {2} mémorisée (actions « {2}:=1 » et « {2}:=0 »)', mem(n), start.get(n) ? 'true' : 'false', n));
  for (const n of C.counters) G.glob.push(tl('long {0} = {1}; // compteur {2}', cnt(n), get(n), n));
  // Encapsulations des étapes initiales : actives dès le départ.
  const initEnc = []; const visitInit = n => { const e = C.enclosures.get(n); if (e) for (const m of e.init) { initEnc.push(m); visitInit(m); } }; C.init.forEach(visitInit);
  for (const m of initEnc) G.glob.splice(G.glob.indexOf(`bool X${m} = false;`), 1, `bool X${m} = true;`);
  for (const n of timers) G.glob.push(tl('unsigned long debutX{0} = 0; // instant d’activation de X{0} (temporisation)', n));
  for (const v of edges) G.glob.push(tl('bool {0} = false; // valeur de {1} au tour précédent (front)', before(v), v));
  /** Activation d'une étape : sa variable, son instant, ses actions mémorisées, les étapes initiales de son encapsulation. */
  const on = n => [`X${n} = true;`, ...(timers.has(n) ? [`debutX${n} = millis();`] : []),
    ...(C.acts.get(n) || []).filter(a => a.set).map(a => (C.counters.has(a.name) ? `${cnt(a.name)} = ${A(a.set)};` : `${mem(a.name)} = ${constOf(a.set) != null ? (constOf(a.set) ? 'true' : 'false') : `${A(a.set)} != 0`};`)),
    ...(C.enclosures.has(n) ? C.enclosures.get(n).init.flatMap(on) : [])];
  /** Désactivation : sa variable, et toute son encapsulation. */
  const off = n => [`X${n} = false;`, ...(C.enclosures.has(n) ? [...C.enclosures.get(n).steps].flatMap(off) : [])];
  const body = G.body, tname = t => `t${t.from.join('_')}_${t.to.join('_')}`;
  const seen = new Map(), names = C.trans.map(t => { const b = tname(t); const k = (seen.get(b) || 0) + 1; seen.set(b, k); return k > 1 ? `${b}_${k}` : b; });
  const xs = list => list.map(n => `X${n}`);
  // Forçages : un ordre par étape qui force ; un GRAFCET forcé n'évolue pas.
  const forced = new Map(); for (const f of C.forcings) { if (!forced.has(f.target)) forced.set(f.target, []); forced.get(f.target).push(f); }
  const fname = part => `force_${ident(part)}`;
  if (forced.size) {
    body.push('', tl('// 0. Forçages : émis par les étapes actives, ils passent avant l’évolution du GRAFCET forcé.'));
    for (const [part, list] of forced) body.push(`bool ${fname(part)} = ${list.map(f => `X${f.from}`).join(' || ')};`);
  }
  body.push('', tl('// 1. Transitions franchissables : toutes calculées avant d’évoluer (franchissement simultané).'));
  C.trans.forEach((t, i) => {
    const part = C.partOf.get(t.from[0]), gate = forced.has(part) ? `!${fname(part)} && ` : '';
    body.push(`bool ${names[i]} = ${t.expr ? `${gate}${xs(t.from).join(' && ')} && ${cExpr(t.expr, V)}` : 'false'};${t.src ? ` // ${xs(t.from).join(', ')} → ${xs(t.to).join(', ')} : ${t.src}` : ''}`);
  });
  body.push('', tl('// 2. Évolution : on désactive les étapes amont, puis on active les étapes aval.'));
  C.trans.forEach((t, i) => body.push(`if (${names[i]}) { ${t.from.flatMap(off).join(' ')} }`));
  C.trans.forEach((t, i) => body.push(`if (${names[i]}) { ${t.to.flatMap(on).join(' ')} }`));
  if (forced.size) {
    body.push('', tl('// Situations imposées par les forçages ({*} : figé, rien ne change).'));
    for (const [part, list] of forced) for (const f of list) {
      if (f.sit === '*') { body.push(tl('// X{0} fige {1}.', f.from, part)); continue; }
      const target = new Set(f.sit === 'INIT' ? C.partInit.get(part) || [] : f.sit), steps = C.stepList.map(s => s.n).filter(n => C.partOf.get(n) === part);
      body.push(`if (X${f.from}) { ${[...steps.filter(n => !target.has(n)).flatMap(off), ...[...target].map(n => `if (!X${n}) { ${on(n).join(' ')} }`)].join(' ')} }`);
    }
  }
  if (edges.size) { body.push('', tl('// 3. Fronts : valeur de ce tour, comparée au prochain.')); for (const v of edges) body.push(`${before(v)} = ${inVar.get(v) || 'false'};`); }
  body.push('', tl('// Sorties : chacune est commandée tant qu’une étape qui la porte est active.'));
  for (const out of C.outputs) {
    const c = comp(out), a = c ? G.actor(c) : null;
    const parts = C.stepList.flatMap(s => (C.acts.get(s.n) || []).filter(x => x.name === out && !x.set).map(x => (x.cond ? `(X${s.n} && ${cExpr(x.cond, V)})` : `X${s.n}`)));
    if (C.stored.has(out)) parts.push(mem(out));
    const cond = parts.join(' || ');
    if (!a) { missingOut.push(out); body.push(tl('// {0} : aucun effecteur de ce nom sur la carte (commandé si {1}).', out, cond)); continue; }
    body.push(`if (${strip(cond)}) {`, ...a('on').map(l => '  ' + l), '} else {', ...a('off').map(l => '  ' + l), '}');
  }
  const header = [tl('// Programme de {0}, écrit par Jollof Studio à partir du GRAFCET du plan pneumatique.', board.name), tl('// Une évolution par tour de loop() ; vous pouvez le modifier librement.')];
  return { code: G.assemble({ header }), missingIn, missingOut };
}

/**
 * Pour l'application : le programme du GRAFCET g pour la première carte du montage (comps, wires du montage).
 * Rend { board, code, missingIn, missingOut } ou { error }.
 */
export async function programForBench(comps, wires, g) {
  const [{ BOARDS }, { analyze, inspect }, { partOf }] = await Promise.all([import('../sim/boards.js'), import('../sim/circuit.js'), import('../sim/parts.js')]);
  const board = comps.find(c => BOARDS[c.type]);
  if (!board) return { error: tl('Ajoutez une carte (Arduino Uno…) au montage électronique : le programme est écrit pour elle.') };
  const A = analyze(comps, wires), cache = new Map();
  const cx = { comps, A, inspect: c => { if (!cache.has(c)) cache.set(c, inspect(c, A, partOf(c))); return cache.get(c); } };
  return { board, ...grafcetProgram(board, cx, g) };
}
