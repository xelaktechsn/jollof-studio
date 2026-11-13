// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Règles → blocs de code. Le programme que les règles écrivent (src/prog/rules.js) est reconstruit
// avec les blocs de l'éditeur visuel, pour que l'élève retrouve sa logique en passant aux blocs :
// - états par défaut → « au démarrage » ;
// - chaque règle → un « si / sinon si / sinon » dans « en boucle », avec sa phrase en commentaire ;
//   « fait varier » → l'action réglée par « convertir (limiter mesure) » (map / constrain) ;
//   un état par défaut « quand aucune règle ne commande » → une variable « … commandé » ;
// - écrans sans règle et mesures sur le moniteur série → « toutes les 1000 ms », comme le code des règles.
// Sans Blockly : rend le JSON de l'espace de travail (Blockly.serialization).
import { tl } from '../../i18n/index.js';
import { ACTIONS, SIGNALS, signalOf, numberRules, ruleText, isSensor, isActuator, defaultActs, boardRules, TIMED, screenLabel } from '../rules.js';
import { boardOf } from '../../sim/boards.js';
import { B, F, emptyWorkspace } from './types.js';
import { visualActs } from './generator.js';

const OP = { '>': 'GT', '<': 'LT', '>=': 'GTE', '<=': 'LTE', '==': 'EQ', '!=': 'NEQ' };
/** Action « fait varier » → action réglable qui prend la valeur calculée (le générateur des blocs écrit le même code). */
const FOLLOW_AS = ['dim', 'note', 'angle', 'fwd', 'speed', 'digit'];

/**
 * Espace de travail équivalent aux règles de la carte. cx : comme generate() — { comps, A, inspect, rules, states }.
 * extras : false → seulement les règles (pas d'états par défaut ni de « toutes les 1000 ms ») : une règle ajoutée
 * à des blocs existants (appendRule).
 * Rend { workspace, stats: { rules, states, blocks }, skipped: [texte] } ; skipped : ce qui n'a pas d'équivalent en blocs.
 */
export function rulesToBlocks(board, cx, { extras = true } = {}) {
  const prof = boardOf(board), byId = id => cx.comps.find(c => c.id === id);
  const { rules, mine, boardOfComp } = boardRules(board, cx);
  const nums = numberRules(rules), skipped = [], variables = [];
  let n = 0, count = 0;
  const tag = Math.random().toString(36).slice(2, 6); // identifiants uniques même ajoutés à des blocs existants
  const id = t => `${t.replace(/^jollof_/, '')}_${tag}${(++n).toString(36)}`;
  /* ---------- Blocs ---------- */
  const blk = (type, fields, inputs, extra) => {
    count++;
    const b = { type, id: id(type) };
    if (fields) b.fields = fields;
    const ins = inputs && Object.entries(inputs).filter(([, v]) => v);
    if (ins && ins.length) b.inputs = Object.fromEntries(ins.map(([k, v]) => [k, v.shadow ? { shadow: v.shadow } : { block: v }]));
    return Object.assign(b, extra);
  };
  const shadowNum = v => ({ shadow: { type: 'math_number', id: id('num'), fields: { NUM: +v || 0 } } });
  const shadowText = v => ({ shadow: { type: 'text', id: id('txt'), fields: { TEXT: String(v ?? '') } } });
  const seq = list => { const bs = list.filter(Boolean); for (let i = 0; i < bs.length - 1; i++) bs[i].next = { block: bs[i + 1] }; return bs[0] || null; };
  const comment = (b, text) => { b.icons = { comment: { text, pinned: false, height: 64, width: 260 } }; return b; };
  const variable = name => { const v = { name, id: `var_${variables.length + 1}` }; variables.push(v); return v; };
  const vset = (v, value) => blk('variables_set', { VAR: { id: v.id } }, { VALUE: value });
  const vget = v => blk('variables_get', { VAR: { id: v.id } });
  const bool = t => blk('logic_boolean', { BOOL: t ? 'TRUE' : 'FALSE' });
  const sigBlock = (s, key, sig) => blk(sig.kind === 'bool' ? B.SIG_BOOL : B.SIG_NUM, { COMP: s.id, SIG: key });
  const join = all => { const parts = all.filter(p => p !== ''); return blk('text_join', null, Object.fromEntries(parts.map((p, i) => [`ADD${i}`, typeof p === 'string' ? shadowText(p) : p])), { extraState: { itemCount: parts.length } }); };

  /** Bloc d'action d'un composant ; arg : nombre, texte, couleur, ou bloc de valeur (calculée). */
  function act(c, key, arg) {
    const va = visualActs(c.type).find(x => x.key === key);
    if (!va) return null;
    const kind = va.arg && va.arg.kind, fields = { COMP: c.id, ACT: key }, extra = kind ? { extraState: { arg: kind, unit: va.arg.unit || '' } } : {};
    if (kind === 'color') return blk(B.ACT, { ...fields, COLOR: /^#[0-9a-f]{6}$/i.test(arg || '') ? arg : va.arg.def }, null, extra);
    if (!kind) return blk(B.ACT, fields, null, extra);
    const value = arg && typeof arg === 'object' && arg.type ? arg : kind === 'num' ? shadowNum(arg ?? va.arg.def) : shadowText(arg ?? va.arg.def);
    return blk(B.ACT, fields, { ARG: value }, extra);
  }

  /* ---------- États par défaut ---------- */
  const states = extras ? cx.states || {} : {}, ruled = new Set(), flags = new Map(), setup = [], fallback = [];
  rules.forEach(r => walkActs(r, a => ruled.add(a.comp)));
  mine.filter(isActuator).forEach(c => {
    const st = states[c.id];
    if (!st || !st.act || !defaultActs(c.type).some(([k]) => k === st.act)) return;
    const b = act(c, st.act, st.arg);
    if (!b) { skipped.push(tl('{0} : état par défaut', c.name)); return; }
    setup.push(comment(b, tl('{0} : état par défaut', c.name)));
    if (st.mode !== 'always') return;
    if (ruled.has(c.id)) {
      const v = variable(tl('{0} commandé', c.name)); flags.set(c.id, v);
      fallback.push(comment(blk('controls_if', null, { IF0: blk('logic_negate', null, { BOOL: vget(v) }), DO0: act(c, st.act, st.arg) }),
        tl('{0} revient à son état par défaut quand aucune règle ne l’a commandé', c.name)));
    } else if (TIMED.has(st.act)) fallback.push(comment(act(c, st.act, st.arg), tl('{0} : état par défaut', c.name)));
  });

  /* ---------- Règles ---------- */
  /** Action d'une règle → blocs (plusieurs pour un écran) ; ctx : mesure de la règle (s, key, sig), « fait varier ». */
  function emitAct(it, ctx) {
    const d = byId(it.comp);
    if (!d) return [];
    const db = boardOfComp(d);
    if (db && db !== board) return [];
    const A = ACTIONS[d.type] && ACTIONS[d.type][it.act];
    if (!A) { skipped.push(tl('{0} : action inconnue', d.name)); return []; }
    let out = [];
    const screen = d.type === 'lcd1602' || d.type === 'oled', line = d.type === 'lcd1602' ? 'line0' : 'text';
    if (screen) {
      let value = null;
      if (it.act === 'value' && ctx.s) { const [name, unit] = screenLabel(ctx.s, ctx.sig); value = join([name, sigBlock(ctx.s, ctx.key, ctx.sig), ...(unit ? [unit] : [])]); }
      else if (it.act === 'text') value = shadowText(it.arg ?? A.arg.def);
      else if (it.act === 'value') value = shadowText(d.name);
      if (!value) { skipped.push(tl('{0} : action sans équivalent en blocs', d.name)); return []; }
      out = d.type === 'oled' ? [act(d, 'clear'), act(d, line, value.shadow ? value.shadow.fields.TEXT : value)] : [act(d, line, value.shadow ? value.shadow.fields.TEXT : value)];
    } else if (ctx.follow && A.follow) {
      const key = FOLLOW_AS.find(k => visualActs(d.type).some(x => x.key === k && x.arg && x.arg.kind === 'num'));
      if (!key) { skipped.push(tl('{0} : « {1} » n’a pas d’équivalent en blocs', d.name, A.label)); return []; }
      const o = Array.isArray(it.arg) ? it.arg : A.follow, [a0, a1] = ctx.from || [0, 100];
      const lim = blk(B.CONSTRAIN, null, { VALUE: sigBlock(ctx.s, ctx.key, ctx.sig), LOW: shadowNum(a0), HIGH: shadowNum(a1) });
      out = [act(d, key, blk(B.MAP, null, { VALUE: lim, FROM_LOW: shadowNum(a0), FROM_HIGH: shadowNum(a1), TO_LOW: shadowNum(o[0]), TO_HIGH: shadowNum(o[1]) }))];
    } else {
      const b = act(d, it.act, it.arg);
      if (!b) { skipped.push(tl('{0} : « {1} » n’a pas d’équivalent en blocs', d.name, A.label)); return []; }
      out = [b];
    }
    if (flags.has(d.id)) out.push(vset(flags.get(d.id), bool(true)));
    return out.filter(Boolean);
  }
  function emitItems(list, ctx) {
    const out = [];
    for (const it of list || []) {
      if (it.kind === 'rule') { const bs = emitRule(it, ctx); if (bs.length) comment(bs[0], tl('Règle {0} : {1}', nums.get(it.id), ruleText(it, byId, prof))); out.push(...bs); }
      else out.push(...emitAct(it, ctx));
    }
    return out;
  }
  /** Condition d'une règle (bloc booléen), ou null si sa mesure manque. */
  function condOf(r) {
    const s = byId(r.src.comp), sig = s && signalOf(s.type, r.src.sig, prof);
    if (!sig) return null;
    const m = sigBlock(s, r.src.sig, sig);
    const cond = sig.kind === 'bool' ? (r.v ? m : blk('logic_negate', null, { BOOL: m })) : blk('logic_compare', { OP: OP[r.op] || 'GT' }, { A: m, B: shadowNum(+r.v || 0) });
    return { cond, ctx: { s, key: r.src.sig, sig, from: r.from } };
  }
  /** Règle → blocs : un « si » (avec ses « sinon si » enchaînés et son « sinon »), ou ses actions directement. */
  function emitRule(r, ctx) {
    if (!r.src) return emitItems(r.then, ctx);
    const c = condOf(r);
    if (!c) { skipped.push(tl('Règle {0} : capteur retiré du montage', nums.get(r.id))); return []; }
    if (r.op === 'follow') return emitItems((r.then || []).filter(it => it.kind === 'act'), { ...c.ctx, follow: true });
    const arms = [[c.cond, emitItems(r.then, c.ctx)]];
    let els = r.else || [], ectx = c.ctx;
    // « Sinon » qui ne contient qu'une autre règle conditionnelle : « sinon si », comme dans le code des règles.
    while (els.length === 1 && els[0].kind === 'rule' && els[0].src && els[0].op !== 'follow') {
      const next = condOf(els[0]); if (!next) break;
      arms.push([next.cond, emitItems(els[0].then, next.ctx)]); ectx = next.ctx; els = els[0].else || [];
    }
    const elseBody = emitItems(els, ectx), inputs = {};
    arms.forEach(([cond, body], i) => { inputs[`IF${i}`] = cond; inputs[`DO${i}`] = seq(body); });
    if (elseBody.length) inputs.ELSE = seq(elseBody);
    const state = {}; if (arms.length > 1) state.elseIfCount = arms.length - 1; if (elseBody.length) state.hasElse = true;
    return [blk('controls_if', null, inputs, Object.keys(state).length ? { extraState: state } : {})];
  }
  const loop = [];
  if (flags.size) loop.push(...[...flags.values()].map((v, i) => { const b = vset(v, bool(false)); return i ? b : comment(b, tl('Aucun effecteur n’a encore été commandé dans ce tour de boucle')); }));
  rules.forEach(r => { const bs = emitRule(r, {}); if (bs.length) comment(bs[0], tl('Règle {0} : {1}', nums.get(r.id), ruleText(r, byId, prof))); loop.push(...bs); });
  loop.push(...fallback);

  /* ---------- Toutes les secondes : écrans sans règle, mesures sur le moniteur série ---------- */
  const measures = !extras ? [] : mine.filter(isSensor).flatMap(c => Object.keys(SIGNALS[c.type]).map(k => ({ c, k, sig: signalOf(c.type, k, prof) })).filter(x => x.sig));
  const every = [];
  mine.filter(c => extras && (c.type === 'lcd1602' || c.type === 'oled') && !ruled.has(c.id) && !(states[c.id] && states[c.id].act)).forEach(sc => {
    const list = measures.slice(0, sc.type === 'lcd1602' ? 2 : 6);
    if (!list.length) return;
    const lines = list.map(({ c, k, sig }, i) => { const [name, unit] = screenLabel(c, sig); return act(sc, sc.type === 'lcd1602' ? `line${i}` : 'text', join([name, sigBlock(c, k, sig), ...(unit ? [unit] : [])])); });
    if (sc.type === 'oled') lines.unshift(act(sc, 'clear'));
    every.push(comment(lines[0], tl('{0} affiche les mesures', sc.name)), ...lines.slice(1));
  });
  measures.forEach(({ c, k, sig }, i) => {
    const label = `${c.name} ${sig.label}`.replace(/ \(.*\)$/, ''), last = i === measures.length - 1;
    const b = blk(last ? B.PRINTLN : B.PRINT, null, { VALUE: join([`${label} : `, sigBlock(c, k, sig), `${sig.unit ? ' ' + sig.unit : ''}${last ? '' : ' | '}`]) });
    every.push(i ? b : comment(b, tl('Mesures sur le moniteur série, une fois par seconde')));
  });

  /* ---------- Espace de travail ---------- */
  const ws = emptyWorkspace(), [setupB, loopB] = ws.blocks.blocks;
  if (setup.length) setupB.inputs = { DO: { block: seq(setup) } };
  if (loop.length) loopB.inputs = { DO: { block: seq(loop) } };
  if (every.length) ws.blocks.blocks.push({ type: B.EVERY, id: id('every'), x: 24, y: 168 + 60 * Math.max(4, count / 2), fields: { MS: 1000 }, inputs: { DO: { block: seq(every) } } });
  if (variables.length) ws.variables = variables;
  return { workspace: ws, stats: { rules: rules.length, states: setup.length, blocks: count }, skipped };
}

/** Chaque action d'une règle, imbriquées comprises. */
function walkActs(r, fn) {
  for (const k of ['then', 'else']) for (const it of r[k] || []) { if (it.kind === 'rule') walkActs(it, fn); else if (it.kind === 'act') fn(it); }
}

/** Une règle ajoutée à un programme en blocs : ses blocs vont à la fin de « en boucle ». Rend le nouvel espace de travail. */
export function appendRule(board, cx, ws, rule) {
  const { workspace } = rulesToBlocks(board, { ...cx, rules: [rule], states: {} }, { extras: false });
  const add = workspace.blocks.blocks[1].inputs && workspace.blocks.blocks[1].inputs.DO.block;
  const out = JSON.parse(JSON.stringify(ws && ws.blocks ? ws : emptyWorkspace()));
  if (!add) return out;
  let loop = out.blocks.blocks.find(b => b.type === B.LOOP);
  if (!loop) { loop = { type: B.LOOP, id: 'loop', x: 24, y: 168 }; out.blocks.blocks.push(loop); }
  if (!loop.inputs || !loop.inputs.DO || !loop.inputs.DO.block) { loop.inputs = { ...(loop.inputs || {}), DO: { block: add } }; return out; }
  let last = loop.inputs.DO.block; while (last.next && last.next.block) last = last.next.block;
  last.next = { block: add };
  return out;
}
/** L'espace de travail contient-il autre chose que « au démarrage » et « en boucle » vides ? */
export const hasBlocks = ws => !!(ws && ws.blocks && Array.isArray(ws.blocks.blocks) && (ws.blocks.blocks.length > 2 || ws.blocks.blocks.some(b => b.inputs && Object.keys(b.inputs).length)));
