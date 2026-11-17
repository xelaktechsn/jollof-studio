// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Automate : le GRAFCET du plan pneumatique traduit en Ladder, comme on l'enseigne (mise en équation des étapes) :
// un bit interne par étape (X0, X1…) ; un réseau par transition : les contacts des étapes amont et de la réceptivité
// mettent à 1 (S) les étapes aval et à 0 (R) les étapes amont ; un réseau par action : les étapes qui l'émettent, en
// parallèle, alimentent la bobine. Une temporisation « 5s/X2 » devient une temporisation TON T2 lancée par X2 ; un
// front « ↑dcy » un contact P ; une action mémorisée « Y1:=1 » un S sur le front montant de l'étape. L'initialisation
// (bit système INIT, vrai au premier cycle) met à 1 les étapes initiales.
// Traduit : étapes, transitions, divergences et convergences en OU et en ET, temporisations, fronts, actions
// continues, conditionnelles et mémorisées 0/1. Refusé (le GRAFCET tourne déjà tel quel comme un automate) :
// macro-étapes, encapsulations, GRAFCET partiels, forçages, compteurs.
import { tl } from '../i18n/index.js';
import { compileGrafcet, cmpOf } from '../pneu/grafcet.js';
import { uid } from './ladder.js';

const el = (t, v, more = {}) => ({ t, id: uid(), v, ...more });
const par = branches => ({ t: 'par', id: uid(), branches });
/** Valeur constante d'un calcul (sans variable), sinon null. */
const constOf = e => (e.op === 'num' ? e.v : e.op === 'neg' && e.a && e.a.op === 'num' ? -e.a.v : null);

/**
 * Programme Ladder du GRAFCET g, ou { error }. Rend { plc, notes } ; notes : ce qui mérite d'être dit (une transition
 * jamais franchissable…).
 */
export function ladderFromGrafcet(g) {
  if (!g || !Array.isArray(g.steps) || !g.steps.length) return { error: tl('Écrivez d’abord le GRAFCET.') };
  const C = compileGrafcet(g);
  if (C.errors.length) return { error: tl('Corrigez d’abord le GRAFCET : {0}', C.errors[0].text) };
  const refused = [];
  if (C.macros.size) refused.push(tl('macro-étapes'));
  if (C.enclosures.size) refused.push(tl('encapsulations'));
  if (C.partNames.length > 1) refused.push(tl('GRAFCET partiels'));
  if (C.forcings.length) refused.push(tl('forçages'));
  if (C.counters.size) refused.push(tl('compteurs'));
  if (refused.length) return { error: tl('Pas de traduction en Ladder pour : {0}. Simplifiez le GRAFCET, ou gardez-le : il commande déjà le circuit comme un automate.', refused.join(', ')) };
  const rungs = [], notes = [], timers = new Map(); // nom → réseau de la temporisation (créé une fois)
  const rung = (comment, items) => { const r = { id: uid(), comment, items }; rungs.push(r); return r; };
  const X = n => `X${n}`;
  const fmt = v => String(Math.round(v * 100) / 100).replace('.', ',');
  // Temporisation « d après Xn » : une TON lancée par Xn ; son contact vaut la réceptivité.
  function timerOf(n, ms) {
    const key = `${n}_${ms}`;
    if (!timers.has(key)) {
      const same = [...timers.keys()].filter(k => k.startsWith(`${n}_`)).length, name = same ? `T${n}_${same + 1}` : `T${n}`;
      timers.set(key, name);
      rung(tl('Temporisation : {0} s après X{1}', fmt(ms / 1000), n), [el('no', X(n)), el('ton', name, { pt: ms / 1000 })]);
    }
    return timers.get(key);
  }
  /**
   * Réceptivité → éléments en série (tableau), null si elle n'est jamais vraie, [] si elle l'est toujours.
   * neg : la négation est poussée vers les contacts (De Morgan) ; un front nié n'a pas de contact : refusé.
   */
  function expr(e, neg) {
    switch (e.op) {
      case 'and': case 'or': {
        const isAnd = (e.op === 'and') !== neg; // NON (a ET b) = NON a OU NON b
        const a = expr(e.a, neg), b = expr(e.b, neg);
        if (isAnd) return a === null || b === null ? null : [...a, ...b];
        if (a === null) return b; if (b === null) return a;
        if (!a.length || !b.length) return [];
        return [par([a, b])];
      }
      case 'xor': { // a ⊕ b = a./b + /a.b ; nié : a.b + /a./b
        const p = [...(expr(e.a, false) || []), ...(expr(e.b, !neg) || [])], q = [...(expr(e.a, true) || []), ...(expr(e.b, neg) || [])];
        return [par([p, q])];
      }
      case 'not': return expr(e.a, !neg);
      case 'const': return (!!e.v) !== neg ? [] : null;
      default: {
        const l = e.name.toLowerCase(); let m;
        if ((m = /^x(\d+)$/.exec(l))) return [el(neg ? 'nc' : 'no', X(m[1]))];
        if ((m = /^__t_(\d+)_(\d+)$/.exec(l))) return [el(neg ? 'nc' : 'no', timerOf(+m[1], +m[2]))];
        if ((m = /^__(up|dn)_(.+)$/.exec(l))) { if (neg) throw new Error(tl('un front nié (NON ↑{0}) n’a pas de contact en Ladder', m[2])); return [el(m[1] === 'up' ? 'p' : 'n', m[2])]; }
        if (cmpOf(l)) throw new Error(tl('les comparaisons de compteurs ne sont pas traduites'));
        return [el(neg ? 'nc' : 'no', e.name)];
      }
    }
  }
  try {
    // 1. Initialisation.
    rung(tl('Mise sous tension : étape initiale'), [el('no', 'INIT'), ...(C.init.length === 1 ? [el('set', X(C.init[0]))] : [par(C.init.map(n => [el('set', X(n))]))])]);
    // 2. Transitions, dans l'ordre du GRAFCET.
    for (const t of C.trans) {
      const r = t.expr ? expr(t.expr, false) : null;
      if (r === null) { notes.push(tl('Transition {0} → {1} jamais franchissable ({2}) : non traduite.', t.from.map(X).join('·'), t.to.map(X).join('·'), t.src || '∅')); continue; }
      const outs = [...t.to.map(n => [el('set', X(n))]), ...t.from.filter(n => !t.to.includes(n)).map(n => [el('reset', X(n))])];
      rung(tl('Transition {0} → {1} : {2}', t.from.map(X).join(' · '), t.to.map(X).join(' · '), t.src || '=1'), [...t.from.map(n => el('no', X(n))), ...r, ...(outs.length === 1 ? outs[0] : [par(outs)])]);
    }
    // 3. Actions : continues et conditionnelles (bobine), mémorisées (S/R sur le front de l'étape).
    const byOut = new Map();
    for (const [n, items] of C.acts) for (const a of items) {
      if (a.force) continue;
      if (!byOut.has(a.name)) byOut.set(a.name, []);
      byOut.get(a.name).push({ n, a });
    }
    for (const [name, list] of byOut) {
      const branches = [];
      for (const { n, a } of list) {
        if (a.set) {
          const c = constOf(a.set);
          if (c !== 0 && c !== 1) throw new Error(tl('{0} := … n’est pas traduit (seules les mises à 0 et à 1 le sont)', name));
          rung(tl('Action mémorisée à l’activation de X{0} : {1} := {2}', n, name, c), [el('p', X(n)), el(c ? 'set' : 'reset', name)]);
          continue;
        }
        const cond = a.cond ? expr(a.cond, false) : [];
        if (cond === null) continue;
        branches.push([el('no', X(n)), ...cond]);
      }
      if (branches.length) rung(tl('Action {0}', name), [...(branches.length === 1 ? branches[0] : [par(branches)]), el('coil', name)]);
    }
  } catch (e) { return { error: tl('Pas de traduction en Ladder : {0}.', e.message) }; }
  return { plc: { name: 'API1', drive: true, cycle: 10, inputs: (g.inputs || []).map(x => ({ name: x.name, kind: x.kind === 'switch' ? 'switch' : 'push' })), rungs }, notes };
}
