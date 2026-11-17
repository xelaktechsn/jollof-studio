// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Automate programmable (API) : le langage à contacts (Ladder, norme IEC 61131-3), compilé puis exécuté par cycles
// comme un vrai automate : lecture des entrées, calcul des réseaux de haut en bas, écriture des sorties.
//
// Un programme : { name, drive, cycle, inputs: [{ name, kind }], rungs: [{ id, comment, items }] }. Un réseau (rung)
// est une suite d'éléments en série, de la barre de gauche à la barre de droite ; le courant passe d'un élément au
// suivant. Éléments :
//   contacts   { t: 'no' | 'nc' | 'p' | 'n', v }   ouvert au repos, fermé au repos, front montant, front descendant
//              { t: 'cmp', a, op, b }             comparaison : valeur courante d'un compteur (ou temps écoulé d'une
//                                                 temporisation) avec un nombre (« C1 >= 3 »)
//   bobines    { t: 'coil' | 'ncoil' | 'set' | 'reset', v }   bobine, bobine inversée, mise à 1 (S), mise à 0 (R)
//   temporisations { t: 'ton' | 'tof' | 'tp', v, pt }   retard à l'enclenchement, retard au déclenchement, impulsion
//                                                  (pt en secondes) ; la sortie Q se lit par un contact du même nom
//   compteurs  { t: 'ctu' | 'ctd', v, pv, r }        comptage, décomptage ; r : entrée de remise à zéro (ou de
//                                                  chargement) ; Q (valeur atteinte) se lit par un contact du même nom
//   parallèle  { t: 'par', branches: [[éléments], …] }   dérivation (OU) : le courant passe si une branche passe
// Chaque élément a un identifiant (id) : mémoire des fronts, courant affiché pendant la simulation.
//
// Variables : les boutons du pupitre de l'automate (inputs), les capteurs du plan pneumatique (a0, B1, S1), les boutons
// et capteurs du montage électronique (par leur nom), les étapes du GRAFCET du plan (X3), le bit système INIT (vrai
// au premier cycle seulement), et tout ce que le programme écrit : les bobines d'électrovannes (Y1) qui font basculer
// les distributeurs, et des mémoires internes (M1, X0 : tout nom qui n'est ni une entrée ni une bobine du circuit).
// Les noms sont lus sans tenir compte de la casse. Adresses d'automate à l'affichage : %I0.0 entrées, %Q0.0 sorties,
// %M0 mémoires, %TM0 temporisations, %C0 compteurs.
//
// Comme un compilateur sérieux, compilePlc et lintPlc refusent ce qui ne peut pas marcher et expliquent pourquoi :
// nom inconnu (avec le nom proche s'il y en a un), entrée écrite par une bobine, temporisation sans durée, deux
// temporisations du même nom, bobine écrite dans deux réseaux (double bobine : seule la dernière compte), réseau qui
// ne commande rien, S sans R. Le cycle (scanPlc) est borné par le nombre d'éléments : il se termine toujours.
import { tl } from '../i18n/index.js';

/** Nom d'une variable : lettres, chiffres ou « _ » (16 au plus), au moins une lettre (1Y1, a0, dcy, M1 ; pas 12). */
export const SYM = /^(?=.*[A-Za-z_])[A-Za-z0-9_]{1,16}$/;
export const CONTACTS = new Set(['no', 'nc', 'p', 'n', 'cmp']);
export const OUTPUTS = new Set(['coil', 'ncoil', 'set', 'reset']);
export const TIMERS = new Set(['ton', 'tof', 'tp']);
export const COUNTERS = new Set(['ctu', 'ctd']);
export const OPS = ['=', '<>', '<', '<=', '>', '>='];
const CMP = { '=': (a, b) => a === b, '<>': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
/** Bornes : réseaux, éléments en tout, profondeur des dérivations, branches d'une dérivation, entrées du pupitre. */
export const MAX = { rungs: 200, items: 600, depth: 6, branches: 8, inputs: 32 };
/** Bit système : vrai pendant le premier cycle seulement (initialisation). */
export const SYS = new Set(['init']);
const low = s => String(s || '').toLowerCase();

/** Programme d'un nouveau circuit : un bouton « départ cycle », aucun réseau. */
export const newPlc = () => ({ name: 'API1', drive: true, cycle: 10, inputs: [{ name: 'dcy', kind: 'push' }], rungs: [] });
let seq = 0;
/** Identifiant d'un nouvel élément ou réseau (unique dans la session ; cleanPlc garantit l'unicité dans un programme). */
export const uid = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;
export const newRung = () => ({ id: uid(), comment: '', items: [] });
/** Parcourt tous les éléments d'un programme : fn(élément, liste, index, dérivation parente ou null). */
export function walkPlc(p, fn) {
  const go = (list, par) => list.forEach((it, j) => { fn(it, list, j, par); if (it.t === 'par') it.branches.forEach(b => go(b, it)); });
  for (const r of (p && p.rungs) || []) go(r.items, null);
}

/* ---------- Nettoyage d'un programme reçu (projet, exemple, assistant IA) ---------- */
/** Programme nettoyé (éléments connus, noms valides, nombres bornés, identifiants uniques), ou null. */
export function cleanPlc(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.rungs)) return null;
  const sym = v => (typeof v === 'string' && SYM.test(v.trim()) ? v.trim() : '');
  const txt = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n) : '');
  const num = (v, d, lo, hi) => (Number.isFinite(+v) && v !== '' && v !== null ? Math.max(lo, Math.min(hi, Math.round(+v * 1000) / 1000)) : d);
  const int = (v, d, lo, hi) => (Number.isFinite(+v) && v !== '' && v !== null ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);
  const used = new Set(); let next = 1;
  const idOf = v => { let id = typeof v === 'string' && /^[\w-]{1,24}$/.test(v) ? v : ''; if (!id || used.has(id)) { do id = `e${next++}`; while (used.has(id)); } used.add(id); return id; };
  let count = 0;
  const node = (it, depth) => {
    if (!it || typeof it !== 'object' || typeof it.t !== 'string') return null;
    const t = it.t;
    if (t === 'par') {
      if (depth >= MAX.depth) return null;
      const id = idOf(it.id), br = (Array.isArray(it.branches) ? it.branches : []).slice(0, MAX.branches).map(b => items(b, depth + 1));
      return br.length ? { t, id, branches: br } : null;
    }
    if (!CONTACTS.has(t) && !OUTPUTS.has(t) && !TIMERS.has(t) && !COUNTERS.has(t)) return null;
    const id = idOf(it.id);
    if (t === 'cmp') return { t, id, a: sym(it.a), op: OPS.includes(it.op) ? it.op : '>=', b: int(it.b, 0, -1e6, 1e6) };
    if (TIMERS.has(t)) return { t, id, v: sym(it.v), pt: num(it.pt, 0, 0, 36000) };
    if (COUNTERS.has(t)) return { t, id, v: sym(it.v), pv: int(it.pv, 0, 0, 32767), r: sym(it.r) };
    return { t, id, v: sym(it.v) };
  };
  const items = (list, depth) => {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const it of list) { if (count >= MAX.items) break; const n = node(it, depth); if (n) { out.push(n); count++; } }
    return out;
  };
  const rungs = p.rungs.slice(0, MAX.rungs).filter(r => r && typeof r === 'object').map(r => ({ id: idOf(r.id), comment: txt(r.comment, 80), items: items(r.items, 0) }));
  const seen = new Set(), inputs = [];
  for (const x of Array.isArray(p.inputs) ? p.inputs.slice(0, MAX.inputs) : []) {
    const name = x && sym(x.name); if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase()); inputs.push({ name, kind: x.kind === 'switch' ? 'switch' : 'push' });
  }
  return { name: sym(p.name) || 'API1', drive: p.drive !== false, cycle: int(p.cycle, 10, 1, 1000), inputs, rungs };
}

/* ---------- Compilation : structure du programme, sans connaître le circuit ---------- */
/**
 * Programme compilé : réseaux, éléments par identifiant, variables écrites (bobines), lues (contacts), temporisations,
 * compteurs, erreurs et avertissements { level, rung, el, text } (rung : index du réseau, el : identifiant ou null).
 * Avec une erreur, l'automate ne commande rien : l'erreur est dite, comme un programme qui ne compile pas.
 */
export function compilePlc(p) {
  const C = {
    name: p.name || 'API1', drive: p.drive !== false, cycle: p.cycle || 10, inputs: new Set((p.inputs || []).map(x => low(x.name))), inputList: p.inputs || [],
    rungs: [], els: new Map(), written: new Map(), reads: new Map(), timers: new Map(), counters: new Map(), errors: [], warnings: []
  };
  const diag = (level, rung, el, text) => (level === 'error' ? C.errors : C.warnings).push({ level, rung, el, text });
  const err = (rung, el, text) => diag('error', rung, el, text), warn = (rung, el, text) => diag('warning', rung, el, text);
  const kindName = t => KIND_NAME[t] ? KIND_NAME[t]() : t;
  const read = (l, name, rung, el, role) => { if (!C.reads.has(l)) C.reads.set(l, { name, uses: [] }); C.reads.get(l).uses.push({ rung, el, role }); };
  const write = (l, name, rung, el, t) => { if (!C.written.has(l)) C.written.set(l, { name, uses: [] }); C.written.get(l).uses.push({ rung, el, t }); };
  (p.rungs || []).forEach((r, i) => {
    let hasOut = false;
    const visit = (list, depth) => list.forEach(it => {
      C.els.set(it.id, { it, rung: i });
      if (it.t === 'par') {
        if (it.branches.length < 2) warn(i, it.id, tl('Dérivation à une seule branche : inutile.'));
        it.branches.forEach(b => { if (!b.length) warn(i, it.id, tl('Une branche de la dérivation est vide : elle laisse toujours passer le courant.')); });
        it.branches.forEach(b => visit(b, depth + 1));
        return;
      }
      const t = it.t, l = low(it.v);
      if (t === 'cmp') {
        if (!it.a) err(i, it.id, tl('Comparaison sans variable : écrivez le nom d’un compteur ou d’une temporisation.'));
        else read(low(it.a), it.a, i, it.id, 'cmp');
        return;
      }
      if (!it.v) { err(i, it.id, tl('{0} sans nom : écrivez le nom de la variable.', kindName(t))); return; }
      if (SYS.has(l) && !CONTACTS.has(t)) { err(i, it.id, tl('{0} est un bit système : il se lit, il ne s’écrit pas.', it.v.toUpperCase())); return; }
      if (CONTACTS.has(t)) { read(l, it.v, i, it.id, t); return; }
      hasOut = true;
      if (OUTPUTS.has(t)) { write(l, it.v, i, it.id, t); return; }
      if (TIMERS.has(t)) {
        if (!(it.pt > 0)) err(i, it.id, tl('{0} : donnez la durée (secondes, plus de 0).', it.v));
        if (C.timers.has(l)) err(i, it.id, tl('Deux temporisations s’appellent {0} : donnez-leur des noms différents.', it.v));
        else C.timers.set(l, { name: it.v, t, pt: it.pt, rung: i, el: it.id });
        return;
      }
      if (COUNTERS.has(t)) {
        if (!(it.pv >= 1)) err(i, it.id, tl('{0} : donnez la valeur de présélection (1 ou plus).', it.v));
        if (C.counters.has(l)) err(i, it.id, tl('Deux compteurs s’appellent {0} : donnez-leur des noms différents.', it.v));
        else C.counters.set(l, { name: it.v, t, pv: it.pv, r: it.r, rung: i, el: it.id });
        if (it.r) read(low(it.r), it.r, i, it.id, t === 'ctu' ? 'reset' : 'load');
      }
    });
    visit(r.items, 0);
    if (!r.items.length) warn(i, null, tl('Réseau vide.'));
    else if (!hasOut) warn(i, null, tl('Ce réseau ne commande rien : mettez une bobine, une temporisation ou un compteur à droite.'));
    C.rungs.push({ id: r.id, comment: r.comment || '', items: r.items, index: i });
  });
  // Une même variable : bobine ou temporisation ou compteur, pas deux à la fois.
  for (const [l, T] of C.timers) {
    if (C.written.has(l)) err(T.rung, T.el, tl('{0} est une temporisation : une bobine ne peut pas l’écrire aussi.', T.name));
    if (C.counters.has(l)) err(T.rung, T.el, tl('{0} est à la fois une temporisation et un compteur.', T.name));
    if (C.inputs.has(l)) err(T.rung, T.el, tl('{0} est une entrée du pupitre : choisissez un autre nom pour la temporisation.', T.name));
  }
  for (const [l, K] of C.counters) {
    if (C.written.has(l)) err(K.rung, K.el, tl('{0} est un compteur : une bobine ne peut pas l’écrire aussi.', K.name));
    if (C.inputs.has(l)) err(K.rung, K.el, tl('{0} est une entrée du pupitre : choisissez un autre nom pour le compteur.', K.name));
  }
  // Double bobine (classique) : seule la dernière écriture compte. S sans R, R sans S.
  for (const [l, w] of C.written) {
    const coils = w.uses.filter(u => u.t === 'coil' || u.t === 'ncoil'), sets = w.uses.filter(u => u.t === 'set'), resets = w.uses.filter(u => u.t === 'reset');
    const rungsOf = list => [...new Set(list.map(u => u.rung + 1))].join(', ');
    if (coils.length > 1) warn(coils[coils.length - 1].rung, coils[coils.length - 1].el, tl('Double bobine : {0} est écrite dans les réseaux {1} ; seule la dernière écriture compte. Mettez les conditions en parallèle dans un seul réseau.', w.name, rungsOf(coils)));
    if (coils.length && (sets.length || resets.length)) warn(coils[0].rung, coils[0].el, tl('{0} est écrite à la fois par une bobine et par S/R : la bobine écrase la mémoire à chaque cycle.', w.name));
    if (sets.length && !resets.length && !coils.length) warn(sets[0].rung, sets[0].el, tl('{0} est mise à 1 (S) mais jamais remise à 0 (R).', w.name));
    if (resets.length && !sets.length && !coils.length) warn(resets[0].rung, resets[0].el, tl('{0} est remise à 0 (R) mais jamais mise à 1 (S).', w.name));
    if (C.inputs.has(l)) err(w.uses[0].rung, w.uses[0].el, tl('{0} est une entrée du pupitre : une bobine ne peut pas l’écrire.', w.name));
  }
  return C;
}
/** Noms des éléments (pour les messages et la palette). */
export const KIND_NAME = {
  no: () => tl('Contact ouvert au repos'), nc: () => tl('Contact fermé au repos'), p: () => tl('Contact à front montant'), n: () => tl('Contact à front descendant'), cmp: () => tl('Comparaison'),
  coil: () => tl('Bobine'), ncoil: () => tl('Bobine inversée'), set: () => tl('Mise à 1 (S)'), reset: () => tl('Mise à 0 (R)'),
  ton: () => tl('Temporisation à l’enclenchement (TON)'), tof: () => tl('Temporisation au déclenchement (TOF)'), tp: () => tl('Impulsion (TP)'),
  ctu: () => tl('Compteur (CTU)'), ctd: () => tl('Décompteur (CTD)'), par: () => tl('Dérivation')
};

/* ---------- Résolution des noms : avec le circuit, le montage et le GRAFCET ---------- */
/** Distance d'édition (pour proposer le nom proche d'un nom inconnu). */
function dist(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
/**
 * known : { inputs: [noms lus : pupitre, capteurs du plan, montage], outputs: [bobines du circuit et du montage],
 * steps: Set des étapes du GRAFCET ou null }. Rend { diags, vars: [{ name, cls, addr }] } : cls = in | out | mem |
 * timer | counter | step | sys ; addr = adresse d'automate. Les diagnostics s'ajoutent à ceux de la compilation.
 */
export function lintPlc(C, known = {}) {
  const inputs = (known.inputs || []).map(String), outputs = (known.outputs || []).map(String), steps = known.steps || null;
  const inSet = new Map(inputs.map(n => [low(n), n])), outSet = new Map(outputs.map(n => [low(n), n]));
  for (const x of C.inputList) if (!inSet.has(low(x.name))) { inSet.set(low(x.name), x.name); inputs.unshift(x.name); }
  const diags = [], vars = new Map();
  const put = (l, name, cls) => { if (!vars.has(l)) vars.set(l, { name, cls }); return vars.get(l); };
  const candidates = () => [...new Set([...inSet.values(), ...outSet.values(), ...[...C.written.values()].map(w => w.name), ...[...C.timers.values()].map(t => t.name), ...[...C.counters.values()].map(k => k.name)])];
  const near = name => { const l = low(name); let best = null, bd = 3; for (const c of candidates()) { const d = dist(l, low(c)); if (d && d < bd) { bd = d; best = c; } } return best; };
  for (const [l, w] of C.written) {
    if (inSet.has(l)) { for (const u of w.uses) diags.push({ level: 'error', rung: u.rung, el: u.el, text: tl('{0} est une entrée (bouton ou capteur) : une bobine ne peut pas l’écrire. Pour une mémoire, choisissez un autre nom (M1…).', w.name) }); continue; }
    if (C.timers.has(l) || C.counters.has(l)) continue; // déjà signalé
    put(l, w.name, outSet.has(l) ? 'out' : 'mem');
  }
  for (const [l, T] of C.timers) put(l, T.name, 'timer');
  for (const [l, K] of C.counters) put(l, K.name, 'counter');
  for (const [l, r] of C.reads) {
    const isCmp = r.uses.some(u => u.role === 'cmp');
    if (isCmp && !C.timers.has(l) && !C.counters.has(l)) { for (const u of r.uses.filter(u => u.role === 'cmp')) diags.push({ level: 'error', rung: u.rung, el: u.el, text: tl('{0} n’est ni un compteur ni une temporisation : une comparaison lit une valeur (C1 >= 3, T1 >= 2).', r.name) }); }
    if (vars.has(l)) continue;
    if (SYS.has(l)) { put(l, r.name.toUpperCase(), 'sys'); continue; }
    if (inSet.has(l)) { put(l, inSet.get(l), 'in'); continue; }
    const m = /^x(\d+)$/.exec(l);
    if (m) {
      if (steps && steps.has(+m[1])) { put(l, 'X' + m[1], 'step'); continue; }
      for (const u of r.uses) diags.push({ level: 'error', rung: u.rung, el: u.el, text: steps ? tl('Le GRAFCET n’a pas d’étape {0}.', m[1]) : tl('{0} : aucune étape de GRAFCET ni mémoire de ce nom. Écrivez le GRAFCET du plan, ou mettez {0} à 1 et à 0 par S et R.', r.name) });
      continue;
    }
    if (outSet.has(l)) { put(l, outSet.get(l), 'out'); for (const u of r.uses) diags.push({ level: 'warning', rung: u.rung, el: u.el, text: tl('{0} est une bobine que ce programme n’écrit jamais : le contact lit toujours 0.', r.name) }); continue; }
    const hint = near(r.name);
    for (const u of r.uses) diags.push({ level: 'error', rung: u.rung, el: u.el, text: hint ? tl('Nom inconnu : {0}. Vouliez-vous dire {1} ?', r.name, hint) : tl('Nom inconnu : {0}. Ni entrée (pupitre, capteur, montage), ni bobine écrite par ce programme, ni temporisation ni compteur.', r.name) });
  }
  // Adresses : entrées dans l'ordre connu, sorties idem, mémoires, temporisations, compteurs dans l'ordre du programme.
  const ins = inputs.filter(n => vars.has(low(n)) && vars.get(low(n)).cls === 'in'), outs = outputs.filter(n => vars.has(low(n)) && vars.get(low(n)).cls === 'out');
  const outsDone = new Set(outs.map(low)), extraOut = [...vars].filter(([l, v]) => v.cls === 'out' && !outsDone.has(l)).map(([, v]) => v.name);
  const addr = new Map(), word = (list, pre, dotted = true) => list.forEach((n, i) => addr.set(low(n), dotted ? `${pre}${Math.floor(i / 8)}.${i % 8}` : `${pre}${i}`));
  word(ins, '%I'); word([...outs, ...extraOut], '%Q'); word([...vars].filter(([, v]) => v.cls === 'mem').map(([, v]) => v.name), '%M', false);
  word([...C.timers.values()].map(t => t.name), '%TM', false); word([...C.counters.values()].map(k => k.name), '%C', false);
  const order = { in: 0, step: 1, out: 2, mem: 3, timer: 4, counter: 5, sys: 6 };
  const list = [...vars.values()].map(v => ({ ...v, addr: addr.get(low(v.name)) || (v.cls === 'step' ? `X${v.name.slice(1)}` : v.cls === 'sys' ? '%S0' : '') })).sort((a, b) => order[a.cls] - order[b.cls] || (a.addr > b.addr ? 1 : -1));
  return { diags, vars: list };
}

/* ---------- Exécution : un cycle d'automate ---------- */
/** État d'exécution vide : temps, numéro de cycle, bits écrits, temporisations, compteurs, mémoire des fronts, courant par élément. */
export const createPlcRun = () => ({ t: 0, scan: 0, bits: new Map(), timers: new Map(), counters: new Map(), edges: new Map(), power: new Map(), halted: false });
/**
 * Un cycle : read(nom en minuscules) → valeur d'une entrée (pupitre, capteur, montage, étape du GRAFCET). Rend
 * { outputs: Set des variables écrites vraies (noms en majuscules : les bobines Y1 font basculer les distributeurs),
 * halted } ; run garde tout l'état. Un programme en erreur ne tourne pas (halted) : rien n'est écrit.
 */
export function scanPlc(C, run, read, dt) {
  run.t += dt; run.scan++;
  if (C.errors.length) { run.halted = true; run.power = new Map(); return { outputs: new Set(), halted: true }; }
  run.halted = false;
  const first = run.scan === 1;
  const get = l => {
    if (l === 'init') return first;
    if (C.timers.has(l)) return !!(run.timers.get(l) || {}).q;
    if (C.counters.has(l)) return !!(run.counters.get(l) || {}).q;
    if (C.written.has(l)) return !!run.bits.get(l);
    return !!read(l);
  };
  const num = l => (C.timers.has(l) ? (run.timers.get(l) || { et: 0 }).et : C.counters.has(l) ? (run.counters.get(l) || { cv: 0 }).cv : 0);
  const power = new Map();
  function timer(it, pin) {
    const l = low(it.v); let T = run.timers.get(l); if (!T) { T = { et: 0, q: false, prev: false, running: false, in: false }; run.timers.set(l, T); }
    const pt = it.pt;
    if (it.t === 'ton') { if (pin) { T.et = Math.min(pt, T.et + dt); T.q = T.et >= pt - 1e-9; } else { T.et = 0; T.q = false; } }
    else if (it.t === 'tof') { if (pin) { T.q = true; T.et = 0; } else if (T.q) { T.et = Math.min(pt, T.et + dt); if (T.et >= pt - 1e-9) T.q = false; } }
    else {
      if (pin && !T.prev && !T.running) { T.running = true; T.et = 0; }
      if (T.running) { T.et = Math.min(pt, T.et + dt); if (T.et >= pt - 1e-9) T.running = false; }
      T.q = T.running;
    }
    T.prev = pin; T.in = pin;
    return T.q;
  }
  function counter(it, pin) {
    const l = low(it.v); let K = run.counters.get(l); if (!K) { K = { cv: 0, q: false, prev: false }; run.counters.set(l, K); }
    const aux = it.r ? get(low(it.r)) : false;
    if (it.t === 'ctu') { if (aux) K.cv = 0; else if (pin && !K.prev) K.cv = Math.min(32767, K.cv + 1); K.q = K.cv >= it.pv; }
    else { if (aux) K.cv = it.pv; else if (pin && !K.prev) K.cv = Math.max(0, K.cv - 1); K.q = K.cv <= 0; }
    K.prev = pin;
    return K.q;
  }
  const series = (items, pin) => { let p = pin; for (const it of items) p = node(it, p); return p; };
  function node(it, pin) {
    let out = pin;
    switch (it.t) {
      case 'par': { out = false; for (const b of it.branches) if (series(b, pin)) out = true; break; } // toutes les branches sont calculées (fronts, bobines)
      case 'no': out = pin && get(low(it.v)); break;
      case 'nc': out = pin && !get(low(it.v)); break;
      case 'p': case 'n': {
        const v = get(low(it.v)), prev = run.edges.has(it.id) ? run.edges.get(it.id) : v; // premier cycle : pas de front
        run.edges.set(it.id, v); out = pin && (it.t === 'p' ? v && !prev : !v && prev); break;
      }
      case 'cmp': out = pin && CMP[it.op](num(low(it.a)), it.b); break;
      case 'coil': run.bits.set(low(it.v), pin); break;
      case 'ncoil': run.bits.set(low(it.v), !pin); break;
      case 'set': if (pin) run.bits.set(low(it.v), true); break;
      case 'reset': if (pin) run.bits.set(low(it.v), false); break;
      case 'ton': case 'tof': case 'tp': out = timer(it, pin); break;
      case 'ctu': case 'ctd': out = counter(it, pin); break;
      default: break;
    }
    power.set(it.id, out);
    return out;
  }
  for (const r of C.rungs) series(r.items, true);
  run.power = power;
  const outputs = new Set();
  for (const [l, v] of run.bits) if (v && C.written.has(l)) outputs.add(C.written.get(l).name.toUpperCase());
  return { outputs, halted: false };
}
