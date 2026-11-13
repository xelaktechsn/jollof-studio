// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : le GRAFCET (norme IEC 60848) qui commande le circuit, comme un automate. Des étapes (X0, X1…), sous
// chacune une transition et sa réceptivité (dcy . a0 . b0), des actions :
// - continues : « 1Y1 », ou conditionnelles « 1Y1 si p » : émises tant que l'étape est active ;
// - mémorisées à l'activation : « 1Y1:=1 », « 1Y1:=0 », compteurs et variables « C:=0 », « C:=C+1 » (lus dans les
//   réceptivités : « C>=3 », « [C=2] ») ;
// - ordres de forçage d'un autre GRAFCET partiel, tant que l'étape est active : « F/G1:{0} » (situation {0}),
//   « F/G1:{} » (vide), « F/G1:{*} » (figé), « F/G1:{INIT} » (situation initiale).
//
// Structures : divergence en OU (transitions « ou aller à » en plus) ; branches parallèles (divergence et
// convergence en ET) ; macro-étapes M5 (l'expansion E … S remplace l'étape) ; étapes encapsulantes (l'étape reste
// active et son encapsulation évolue tant qu'elle l'est : ses étapes « initiales » sont activées avec elle, toutes
// sont désactivées avec elle) ; GRAFCET partiels nommés (G1, GS…), qui peuvent se forcer.
//
// Le GRAFCET : { name: 'G1', steps: [éléments], parts: [{ name, steps }], inputs, drive }. Un élément :
//   étape        { n, init, act, r, to, alt: [{ r, to }], enc?: [éléments] }   (enc : étape encapsulante)
//   parallèle    { par: [[éléments], [éléments]…], r, to }    r : réceptivité de la convergence
//   macro-étape  { n, macro: true, init, exp: [éléments], r, to }
// Le dernier élément d'une liste principale (GRAFCET partiel, encapsulation) revient au premier ; celui d'une branche
// ou d'une expansion n'a pas de transition à lui (c'est la convergence, ou la sortie de la macro-étape).
//
// Réceptivités : l'écriture des équations de la logique (. ET, + OU, / ou ! NON, parenthèses), les variables
// d'étape X3 (X5 d'une macro-étape : une étape de son expansion est active), les temporisations « 3s/X2 » (ou
// « t/X2/3s »), les fronts « ↑dcy » et « ↓a1 », les comparaisons de compteurs « C>=3 ». Les noms sont lus sans tenir
// compte de la casse : entrées du GRAFCET (boutons du pupitre), capteurs des vérins et pressostats (repères du plan
// pneumatique), boutons et capteurs du montage électronique.
//
// Évolution (règles 2 à 5) : les ordres de forçage s'appliquent en priorité (le GRAFCET forcé prend la situation
// imposée et n'évolue pas) ; une transition est franchissable quand toutes ses étapes amont sont actives et sa
// réceptivité vraie ; toutes les transitions franchissables le sont en même temps ; une étape désactivée et réactivée
// au même franchissement reste active. On recommence avec les mêmes entrées tant que le GRAFCET évolue (recherche de
// stabilité) ; les actions mémorisées sont exécutées à chaque activation, même d'une étape instable ; les actions
// continues des étapes actives sont émises une fois le GRAFCET stable.
import { tl } from '../i18n/index.js';
import { parse, evaluate } from '../logic/boolean.js';

/** Nom d'entrée (bouton du pupitre) : une lettre, puis lettres, chiffres ou « _ ». */
export const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,11}$/;
/** Nom d'un GRAFCET partiel (G1, GS, GPN…). */
export const PART_NAME = /^[A-Za-z][A-Za-z0-9_]{0,11}$/;
/** Nom d'action : un repère d'électrovanne (1Y1, Y2…) ou d'effecteur du montage, ou un compteur. */
const ACTION_NAME = /^[A-Za-z0-9_+-]{1,16}$/;

/** GRAFCET d'un nouveau circuit : l'étape initiale 0 et le bouton « départ cycle ». */
export const newGrafcet = () => ({ name: 'G1', drive: true, inputs: [{ name: 'dcy', kind: 'push' }], steps: [{ n: 0, init: true, act: '', r: '', to: null, alt: [] }], parts: [] });
/** Nature d'un élément de la liste. */
export const kindOf = it => (it && Array.isArray(it.par) ? 'par' : it && it.macro ? 'macro' : 'step');
/** Listes principales : le GRAFCET G1, puis les GRAFCET partiels. */
export const rootsOf = g => [(g && g.steps) || [], ...(((g && g.parts) || []).map(p => p.steps))];
/** Parcourt tous les éléments (branches, expansions, encapsulations comprises) : fn(élément, liste, index). */
export function walkItems(list, fn) {
  (list || []).forEach((it, j) => {
    fn(it, list, j);
    if (kindOf(it) === 'par') it.par.forEach(b => walkItems(b, fn));
    if (kindOf(it) === 'macro') walkItems(it.exp, fn);
    if (it.enc) walkItems(it.enc, fn);
  });
}
/** Tous les éléments du GRAFCET, GRAFCET partiels compris. */
export const walkAll = (g, fn) => rootsOf(g).forEach(l => walkItems(l, fn));
/**
 * Élément désigné par un chemin : « 2 » (3e élément), « 2/0/1 » (2e élément de la 1re branche du bloc 2),
 * « 3/e/0 » (1re étape de l'expansion de la macro-étape 3), « 4/c/0 » (1re étape de l'encapsulation de l'étape 4),
 * « P0:1 » (2e élément du premier GRAFCET partiel). Rend { list, j, item }.
 */
export function locate(g, path) {
  const m = /^P(\d+):(.*)$/.exec(String(path)), root = m ? ((g.parts || [])[+m[1]] || { steps: [] }).steps : g.steps;
  const segs = (m ? m[2] : String(path)).split('/');
  let list = root, j = +segs[0], item = list[j];
  for (let k = 1; k + 1 < segs.length; k += 2) {
    list = !item ? undefined : segs[k] === 'e' ? item.exp : segs[k] === 'c' ? item.enc : item.par[+segs[k]];
    j = +segs[k + 1]; item = list ? list[j] : undefined;
  }
  return { list, j, item };
}

/** GRAFCET reçu (projet, exemple, assistant IA) : champs connus et bornés, numéros d'étape uniques. null s'il est illisible. */
export function cleanGrafcet(g) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.steps)) return null;
  const str = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : typeof v === 'number' ? String(v) : '');
  const num = v => (v === '' || v == null ? null : Number.isInteger(+v) && +v >= 0 && +v < 1000 ? +v : null);
  const seen = new Set();
  let count = 0;
  const list = (src, depth) => {
    const out = [];
    for (const s of (Array.isArray(src) ? src : []).slice(0, 100)) {
      if (!s || typeof s !== 'object' || ++count > 400) continue;
      if (Array.isArray(s.par)) {
        if (depth > 3) continue;
        const par = s.par.slice(0, 4).map(b => list(b, depth + 1)).filter(b => b.length);
        if (par.length) out.push({ par, r: str(s.r), to: num(s.to) });
        continue;
      }
      const n = num(s.n); if (n == null || seen.has(n)) continue;
      seen.add(n);
      const alt = (Array.isArray(s.alt) ? s.alt : []).slice(0, 4).map(a => ({ r: str(a && a.r), to: num(a && a.to) })).filter(a => a.to != null);
      if (s.macro && depth <= 3) { const exp = list(s.exp, depth + 1); if (exp.length) { out.push({ n, macro: true, init: !!s.init, exp, r: str(s.r), to: num(s.to), alt }); continue; } }
      const step = { n, init: !!s.init, act: str(s.act), r: str(s.r), to: num(s.to), alt };
      if (Array.isArray(s.enc) && depth <= 3) { const enc = list(s.enc, depth + 1); if (enc.length) step.enc = enc; }
      out.push(step);
    }
    return out;
  };
  const name = PART_NAME.test(String(g.name || '')) ? String(g.name) : 'G1';
  const steps = list(g.steps, 0), partNames = new Set([name.toLowerCase()]), parts = [];
  for (const p of (Array.isArray(g.parts) ? g.parts : []).slice(0, 6)) {
    const pn = String((p && p.name) || '');
    if (!PART_NAME.test(pn) || partNames.has(pn.toLowerCase())) continue;
    const ps = list(p.steps, 0); if (!ps.length) continue;
    partNames.add(pn.toLowerCase()); parts.push({ name: pn, steps: ps });
  }
  const names = new Set(), inputs = [];
  for (const i of (Array.isArray(g.inputs) ? g.inputs : []).slice(0, 12)) {
    const nm = str(i && i.name, 12).trim();
    if (!INPUT_NAME.test(nm) || names.has(nm.toLowerCase())) continue;
    names.add(nm.toLowerCase()); inputs.push({ name: nm, kind: i.kind === 'switch' ? 'switch' : 'push' });
  }
  return { name, drive: g.drive !== false, inputs, steps, parts };
}

/* ---------- Expressions ---------- */
const CMP = { '>=': 'ge', '<=': 'le', '<>': 'ne', '!=': 'ne', '==': 'eq', '=': 'eq', '<': 'lt', '>': 'gt' };
/**
 * Réceptivité écrite par l'élève → texte lisible par le lecteur d'équations : temporisations, fronts et comparaisons
 * deviennent des variables internes (__t_2_3000 : X2 active depuis 3 s ; __up_dcy : front montant de dcy ;
 * __q_C_ge_3 : le compteur C vaut au moins 3).
 */
function prep(src) {
  const ms = (d, u) => Math.round(parseFloat(String(d).replace(',', '.')) * (/^ms$/i.test(u) ? 1 : 1000));
  return String(src)
    .replace(/^\s*=\s*1\s*$/, '1')
    .replace(/\[?\s*([A-Za-z_]\w*)\s*(>=|<=|<>|!=|==|=|<|>)\s*(-?\d+)\s*\]?/g, (_, v, op, n) => ` __q_${v}_${CMP[op]}_${n.replace('-', 'm')} `)
    .replace(/\bt\s*\/\s*X\s*(\d+)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(ms|s)\b/gi, (_, n, d, u) => ` __t_${n}_${ms(d, u)} `)
    .replace(/(^|[^A-Za-z0-9_.,])(\d+(?:[.,]\d+)?)\s*(ms|s)\s*\/\s*X\s*(\d+)/gi, (_, pre, d, u, n) => `${pre} __t_${n}_${ms(d, u)} `)
    .replace(/[↑]\s*([A-Za-z_]\w*)/g, (_, v) => ` __up_${v} `)
    .replace(/[↓]\s*([A-Za-z_]\w*)/g, (_, v) => ` __dn_${v} `);
}
/** Comparaison interne « __q_C_ge_3 » → { name: 'C', op: 'ge', v: 3 }. */
export const cmpOf = l => { const m = /^__q_(.+)_(eq|ne|lt|le|gt|ge)_(m?\d+)$/i.exec(l); return m ? { name: m[1].toUpperCase(), op: m[2].toLowerCase(), v: +m[3].replace(/^m/i, '-') } : null; };
const CMP_FN = { eq: (a, b) => a === b, ne: (a, b) => a !== b, lt: (a, b) => a < b, le: (a, b) => a <= b, gt: (a, b) => a > b, ge: (a, b) => a >= b };
/** Variables lues par une expression (noms en minuscules, sans les variables internes ni les étapes) ; compteurs à part. */
function varsOf(e, out, counters) {
  if (!e) return out;
  if (e.op === 'var') {
    const l = e.name.toLowerCase(), m = /^__(up|dn)_(.+)$/.exec(l), q = cmpOf(l);
    if (q) { if (counters) counters.add(q.name); } else if (m) out.add(m[2]); else if (!/^__t_/.test(l) && !/^x\d+$/.test(l)) out.add(l);
  }
  varsOf(e.a, out, counters); varsOf(e.b, out, counters);
  return out;
}
const edgesOf = (e, out) => { if (!e) return out; if (e.op === 'var') { const m = /^__(up|dn)_(.+)$/.exec(e.name.toLowerCase()); if (m) out.add(m[2]); } edgesOf(e.a, out); edgesOf(e.b, out); return out; };
/** Étapes lues par une expression (X3, temporisations) : pour vérifier qu'elles existent. */
const stepsOf = (e, out) => { if (!e) return out; if (e.op === 'var') { const m = /^x(\d+)$|^__t_(\d+)_/.exec(e.name.toLowerCase()); if (m) out.add(+(m[1] ?? m[2])); } stepsOf(e.a, out); stepsOf(e.b, out); return out; };
/** Expression lue, ou erreur { text } ; un texte vide donne null (transition sans réceptivité : jamais franchie). */
export function parseReceptivity(src) {
  if (!String(src || '').trim()) return { expr: null };
  try { return { expr: parse(prep(src)) }; } catch (e) { return { error: e.message }; }
}
/** Calcul d'une action mémorisée : nombres entiers, compteurs, + − ×, parenthèses (« C+1 », « 2*N », « 0 »). */
export function parseArith(src) {
  const tk = String(src).match(/\d+|[A-Za-z_]\w*|[-+*()]|\S/g) || []; let i = 0;
  const fail = () => { throw new Error(tl('calcul illisible')); };
  function expr() { let a = term(); while (tk[i] === '+' || tk[i] === '-') { const op = tk[i++]; a = { op, a, b: term() }; } return a; }
  function term() { let a = fac(); while (tk[i] === '*') { i++; a = { op: '*', a, b: fac() }; } return a; }
  function fac() {
    const t = tk[i++];
    if (t === undefined) fail();
    if (t === '-') return { op: 'neg', a: fac() };
    if (t === '(') { const e = expr(); if (tk[i++] !== ')') fail(); return e; }
    if (/^\d+$/.test(t)) return { op: 'num', v: +t };
    if (/^[A-Za-z_]\w*$/.test(t)) return { op: 'var', name: t.toUpperCase() };
    return fail();
  }
  const e = expr(); if (i < tk.length) fail();
  return e;
}
export function evalArith(e, get) {
  switch (e.op) {
    case 'num': return e.v;
    case 'var': return get(e.name);
    case 'neg': return -evalArith(e.a, get);
    case '+': return evalArith(e.a, get) + evalArith(e.b, get);
    case '-': return evalArith(e.a, get) - evalArith(e.b, get);
    default: return evalArith(e.a, get) * evalArith(e.b, get);
  }
}
/** Valeur constante d'un calcul (sans variable), sinon null. */
const constOf = e => (e.op === 'num' ? e.v : e.op === 'neg' && e.a.op === 'num' ? -e.a.v : null);
/** Coupe une liste d'actions aux virgules et points-virgules, sauf dans { } (situations de forçage). */
const splitActions = s => { const out = []; let cur = '', depth = 0; for (const c of String(s || '')) { if (c === '{') depth++; if (c === '}') depth = Math.max(0, depth - 1); if ((c === ',' || c === ';') && !depth) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map(t => t.trim()).filter(Boolean); };
/**
 * Actions d'une étape : « 1Y1, 2Y1 si p, H1:=1, C:=C+1, F/G1:{0} » → éléments { name, cond } (continue),
 * { name, set: calcul } (mémorisée à l'activation), { force: 'G1', sit: [0] | 'INIT' | '*' } (forçage) ; erreurs à part.
 */
export function parseActions(src) {
  const items = [], errors = [];
  for (const raw of splitActions(src)) {
    const f = /^F\s*\/\s*([A-Za-z][A-Za-z0-9_]*)\s*:?\s*\{\s*([^}]*)\}$/i.exec(raw);
    if (f) {
      const body = f[2].trim();
      if (body === '*') items.push({ force: f[1], sit: '*' });
      else if (/^init$/i.test(body)) items.push({ force: f[1], sit: 'INIT' });
      else if (/^(\d+(\s*[, ]\s*\d+)*)?$/.test(body)) items.push({ force: f[1], sit: body ? body.split(/[\s,]+/).map(Number) : [] });
      else errors.push(tl('forçage illisible : « {0} »', raw));
      continue;
    }
    const st = /^(\S+?)\s*:=\s*(.+)$/.exec(raw);
    if (st) {
      if (!ACTION_NAME.test(st[1])) { errors.push(tl('action illisible : « {0} »', raw)); continue; }
      try { items.push({ name: st[1].toUpperCase(), cond: null, set: parseArith(st[2]) }); } catch (e) { errors.push(tl('{0} : {1}', raw, e.message)); }
      continue;
    }
    const m = /^(\S+?)(?:\s+(?:si|if)\s+(.+))?$/i.exec(raw);
    if (!m || !ACTION_NAME.test(m[1])) { errors.push(tl('action illisible : « {0} »', raw)); continue; }
    let cond = null;
    if (m[2]) { const r = parseReceptivity(m[2]); if (r.error) { errors.push(tl('condition de {0} : {1}', m[1], r.error)); continue; } cond = r.expr; }
    items.push({ name: m[1].toUpperCase(), cond });
  }
  return { items, errors };
}

/* ---------- Compilation ---------- */
/**
 * GRAFCET prêt à évoluer : transitions { from: [étapes], to: [étapes], expr, src, path (chemin de l'élément), alt
 * (-1 : principale) }, actions par étape, étapes (stepList : { n, init } dans l'ordre), étapes initiales,
 * macro-étapes (numéro → { entry, exit, steps }), étapes encapsulantes (numéro → { init, steps }), GRAFCET partiels
 * (partOf : étape → nom ; partInit : nom → étapes initiales), variables lues, compteurs, sorties (continues et
 * mémorisées tout ou rien), forçages, erreurs { path, alt?, text }.
 */
export function compileGrafcet(g) {
  const errors = [], trans = [], acts = new Map(), vars = new Set(), edges = new Set(), cmpVars = new Set();
  const stepList = [], macros = new Map(), enclosures = new Map(), info = new Map(), init = new Set(), used = new Set();
  const partOf = new Map(), partInit = new Map(), sets = new Map(), conts = new Set(), forcings = [];
  const parts = [{ name: (g && g.name) || 'G1', steps: (g && g.steps) || [], prefix: '' }, ...(((g && g.parts) || []).map((p, k) => ({ name: p.name, steps: p.steps, prefix: `P${k}:` })))];
  for (const p of parts) partInit.set(p.name, []);
  // 1. Entrées et sorties de chaque élément ; étapes de chaque GRAFCET partiel et de chaque encapsulation.
  function scan(list, base, part, owner) {
    const infos = list.map((it, j) => {
      const path = base + j, k = kindOf(it);
      if (k === 'par') {
        if (it.par.length < 2) errors.push({ path, text: tl('Un bloc parallèle demande au moins deux branches.') });
        const br = it.par.map((b, bi) => (b.length ? scan(b, `${path}/${bi}/`, part, owner) : (errors.push({ path, text: tl('Une branche parallèle est vide.') }), { entry: [], exit: [] })));
        const r = { entry: br.flatMap(b => b.entry), exit: br.flatMap(b => b.exit) };
        info.set(it, r); return r;
      }
      if (used.has(it.n)) errors.push({ path, text: tl('Le numéro {0} est utilisé deux fois.', it.n) }); used.add(it.n);
      const isInit = n => { if (owner == null) { init.add(n); partInit.get(part).push(n); } else enclosures.get(owner).init.push(n); };
      if (k === 'macro') {
        const e = it.exp.length ? scan(it.exp, `${path}/e/`, part, owner) : { entry: [], exit: [] }, steps = new Set();
        walkItems(it.exp, x => { if (kindOf(x) === 'step') steps.add(x.n); });
        macros.set(it.n, { entry: e.entry, exit: e.exit, steps });
        if (it.init) e.entry.forEach(isInit);
        info.set(it, e); return e;
      }
      stepList.push({ n: it.n, init: !!it.init && owner == null }); partOf.set(it.n, part);
      if (it.init) isInit(it.n);
      const A = parseActions(it.act);
      for (const t of A.errors) errors.push({ path, text: tl('X{0} : {1}.', it.n, t) });
      for (const a of A.items) {
        if (a.force) { forcings.push({ from: it.n, part, target: a.force, sit: a.sit, path }); continue; }
        if (a.set) { if (!sets.has(a.name)) sets.set(a.name, []); sets.get(a.name).push(a.set); walkArith(a.set, v => cmpVars.add(v)); } else conts.add(a.name);
        if (a.cond) { varsOf(a.cond, vars, cmpVars); edgesOf(a.cond, edges); }
      }
      acts.set(it.n, A.items);
      if (it.enc) {
        // Étape encapsulante : son encapsulation forme un GRAFCET partiel à part (« X5 »), qui n'existe que pendant elle.
        enclosures.set(it.n, { init: [], steps: new Set() });
        scan(it.enc, `${path}/c/`, `X${it.n}`, it.n);
        walkItems(it.enc, x => { if (kindOf(x) === 'step') enclosures.get(it.n).steps.add(x.n); });
        if (!enclosures.get(it.n).init.length) errors.push({ path, text: tl('X{0} : cochez « initiale » sur l’étape de l’encapsulation activée avec elle.', it.n) });
      }
      const r = { entry: [it.n], exit: [it.n] }; info.set(it, r); return r;
    });
    const last = infos[infos.length - 1];
    return { entry: infos.length ? infos[0].entry : [], exit: last ? last.exit : [] };
  }
  for (const p of parts) scan(p.steps, p.prefix, p.name, null);
  const entriesOf = n => (macros.has(n) ? macros.get(n).entry : used.has(n) ? [n] : null);
  const label = it => (kindOf(it) === 'par' ? tl('convergence') : `X${it.n}`);
  // 2. Transitions : sous chaque élément, vers l'élément suivant ou l'étape visée.
  function link(list, base, loop) {
    list.forEach((it, j) => {
      const path = base + j, k = kindOf(it), last = j === list.length - 1;
      if (k === 'par') it.par.forEach((b, bi) => link(b, `${path}/${bi}/`, false));
      if (k === 'macro') link(it.exp, `${path}/e/`, false);
      if (it.enc) link(it.enc, `${path}/c/`, true);
      if (last && !loop) return; // fin de branche ou d'expansion : la transition est celle du parent
      const next = j + 1 < list.length ? info.get(list[j + 1]).entry : info.get(list[0]).entry;
      const add = (src, to, alt) => {
        if (!to) { errors.push({ path, alt, text: tl('{0} : la transition mène à une étape qui n’existe pas.', label(it)) }); return; }
        const r = parseReceptivity(src);
        if (r.error) { errors.push({ path, alt, text: tl('{0} : réceptivité illisible ({1}).', label(it), r.error) }); return; }
        if (r.expr) { varsOf(r.expr, vars, cmpVars); edgesOf(r.expr, edges); for (const n of stepsOf(r.expr, new Set())) if (!used.has(n)) errors.push({ path, alt, text: tl('{0} : la réceptivité lit X{1}, qui n’existe pas.', label(it), n) }); }
        trans.push({ from: info.get(it).exit, to, expr: r.expr, src: String(src || ''), path, alt });
      };
      add(it.r, it.to != null ? entriesOf(it.to) : next, -1);
      (it.alt || []).forEach((a, ai) => add(a.r, entriesOf(a.to), ai));
    });
  }
  for (const p of parts) link(p.steps, p.prefix, true);
  if (stepList.length && !init.size) errors.push({ path: '0', text: tl('Aucune étape initiale : cochez « initiale » sur l’étape de repos.') });
  // Forçages : un GRAFCET partiel existant, des étapes à lui, jamais lui-même.
  const names = new Map(parts.map(p => [p.name.toLowerCase(), p.name]));
  for (const f of forcings) {
    const t = names.get(f.target.toLowerCase());
    if (!t) { errors.push({ path: f.path, text: tl('X{0} : aucun GRAFCET partiel {1} à forcer.', f.from, f.target) }); continue; }
    f.target = t;
    if (t === f.part) errors.push({ path: f.path, text: tl('X{0} : un GRAFCET ne peut pas se forcer lui-même.', f.from) });
    if (Array.isArray(f.sit)) for (const n of f.sit) if (partOf.get(n) !== t) errors.push({ path: f.path, text: tl('X{0} : l’étape {1} n’est pas dans {2}.', f.from, n, t) });
  }
  for (const [n, list] of acts) for (const a of list) if (a.force) { const t = names.get(a.force.toLowerCase()); if (t) a.force = t; }
  // Compteurs : variables calculées ou comparées ; les autres mémorisations (0 ou 1) sont des sorties tout ou rien.
  // Comparaison d'un nom jamais affecté (« a0 = 1 ») : c'est une entrée, lue 0 ou 1.
  const counters = new Set([...sets.keys()].filter(v => cmpVars.has(v) || sets.get(v).some(e => { const c = constOf(e); return c !== 0 && c !== 1; })));
  for (const v of cmpVars) if (!sets.has(v)) vars.add(v.toLowerCase());
  const stored = new Set([...sets.keys()].filter(v => !counters.has(v)));
  const outputs = new Set([...conts, ...stored]);
  const inputNames = new Set(((g && g.inputs) || []).map(x => x.name.toLowerCase()));
  return { trans, acts, init: [...init], vars, edges, outputs, stored, counters, errors, steps: new Set(stepList.map(s => s.n)), stepList, macros, enclosures, partOf, partInit, partNames: parts.map(p => p.name), forcings, inputNames };
}
function walkArith(e, fn) { if (!e) return; if (e.op === 'var') fn(e.name); walkArith(e.a, fn); walkArith(e.b, fn); }

/* ---------- Évolution ---------- */
/** État d'évolution : étapes actives, instant d'activation, mémoires (actions mémorisées, compteurs), temps, valeurs précédentes (fronts). */
export const createGrafRun = () => ({ X: null, since: new Map(), mem: new Map(), t: 0, prev: new Map(), unstable: false, forced: new Map() });

/** Lecteur de variables pour evaluate : étapes (et macro-étapes), temporisations, fronts (au premier tour), compteurs, puis read(nom). */
function reader(C, run, read, first) {
  const isOn = n => (C.macros.has(n) ? [...C.macros.get(n).steps].some(s => run.X.has(s)) : run.X.has(n));
  return new Proxy({}, {
    get(_, key) {
      const l = String(key).toLowerCase(); let m;
      if ((m = /^x(\d+)$/.exec(l))) return isOn(+m[1]);
      if ((m = /^__t_(\d+)_(\d+)$/.exec(l))) return run.X.has(+m[1]) && run.t - (run.since.get(+m[1]) ?? run.t) >= +m[2] / 1000 - 1e-9;
      if ((m = /^__up_(.+)$/.exec(l))) return first.v && !!read(m[1]) && !run.prev.get(m[1]);
      if ((m = /^__dn_(.+)$/.exec(l))) return first.v && !read(m[1]) && !!run.prev.get(m[1]);
      const q = cmpOf(l); if (q) return CMP_FN[q.op](C.counters.has(q.name) ? run.mem.get(q.name) || 0 : read(q.name.toLowerCase()) ? 1 : 0, q.v);
      return !!read(l);
    }
  });
}
/** Étape activée : instant d'activation, actions mémorisées (« := »), étapes initiales de son encapsulation. */
function activate(C, run, n) {
  run.X.add(n); run.since.set(n, run.t);
  for (const a of C.acts.get(n) || []) if (a.set) run.mem.set(a.name, evalArith(a.set, v => run.mem.get(v) || 0));
  const enc = C.enclosures.get(n); if (enc) for (const m of enc.init) if (!run.X.has(m)) activate(C, run, m);
}
/** Étape désactivée, et avec elle toute son encapsulation. */
function deactivate(C, run, n) {
  run.X.delete(n);
  const enc = C.enclosures.get(n); if (enc) for (const m of enc.steps) if (run.X.has(m)) deactivate(C, run, m);
}

/**
 * Un cycle de l'automate : dt s écoulées, read(nom en minuscules) → valeur d'une entrée. Rend { outputs: Set des
 * repères commandés (majuscules), fired: transitions franchies }. run est mis à jour (run.forced : GRAFCET partiels
 * forcés et leur situation imposée).
 */
export function scanGrafcet(C, run, read, dt) {
  run.t += dt;
  if (run.X) for (const n of [...run.X]) if (!C.steps.has(n)) run.X.delete(n); // étape retirée pendant la simulation
  if (!run.X || !run.X.size) { run.X = new Set(); run.mem = new Map(); for (const n of C.init) activate(C, run, n); }
  const first = { v: true }, env = reader(C, run, read, first), fired = [];
  let k = 0, orders = new Map();
  for (; k < 30; k++) {
    // Forçages émis par les étapes actives : priorité sur l'évolution ; le GRAFCET forcé n'évolue pas.
    orders = new Map();
    for (const f of C.forcings) if (run.X.has(f.from)) orders.set(f.target, f.sit);
    let changed = false;
    for (const [part, sit] of orders) {
      if (sit === '*') continue; // figé
      const target = new Set(sit === 'INIT' ? C.partInit.get(part) || [] : sit);
      for (const n of [...run.X]) if (C.partOf.get(n) === part && !target.has(n)) { deactivate(C, run, n); changed = true; }
      for (const n of target) if (!run.X.has(n)) { activate(C, run, n); changed = true; }
    }
    const fire = C.trans.filter(t => t.expr && t.from.length && !orders.has(C.partOf.get(t.from[0])) && t.from.every(n => run.X.has(n)) && evaluate(t.expr, env));
    first.v = false;
    if (fire.length) {
      const off = new Set(fire.flatMap(t => t.from)), on = new Set(fire.flatMap(t => t.to));
      for (const n of off) if (!on.has(n)) deactivate(C, run, n);
      for (const n of on) activate(C, run, n);
      fired.push(...fire);
    }
    // Encapsulations des étapes désactivées : vidées (une étape encapsulée ne vit que pendant son étape encapsulante).
    for (const [n, enc] of C.enclosures) if (!run.X.has(n)) for (const m of enc.steps) if (run.X.has(m)) { run.X.delete(m); changed = true; }
    if (!fire.length && !changed) break;
  }
  run.unstable = k >= 30; // réceptivités toujours vraies en boucle : le GRAFCET ne se stabilise pas
  run.forced = orders;
  for (const v of C.edges) run.prev.set(v, !!read(v));
  const outputs = new Set(), env2 = reader(C, run, read, { v: false });
  for (const n of run.X) for (const a of C.acts.get(n) || []) if (a.name && !a.set && (!a.cond || evaluate(a.cond, env2))) outputs.add(a.name);
  for (const name of C.stored) if (run.mem.get(name)) outputs.add(name);
  return { outputs, fired };
}
/** Valeur actuelle de chaque réceptivité (affichage) : tableau aligné sur C.trans, null sans réceptivité. */
export function receptivities(C, run, read) {
  if (!run.X) return C.trans.map(() => null);
  const env = reader(C, run, read, { v: false });
  return C.trans.map(t => (t.expr ? !!evaluate(t.expr, env) : null));
}
/** Une macro-étape est-elle active (une étape de son expansion l'est) ? */
export const macroOn = (C, run, n) => !!run.X && C.macros.has(n) && [...C.macros.get(n).steps].some(s => run.X.has(s));
