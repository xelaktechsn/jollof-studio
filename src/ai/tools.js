// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outils offerts aux assistants IA (protocole MCP, voir mcp.js) : lire le montage, poser et câbler des composants,
// vérifier, programmer (règles ou code), simuler, créer un composant (paquet .jpart, déclaratif), voir la scène.
// Chaque outil passe par les mêmes fonctions que l'interface : historique (Ctrl+Z), vérificateur, enregistrement
// automatique et bibliothèque restent cohérents. Les descriptions sont en anglais (lues par l'IA) ; les messages
// rendus suivent la langue de l'application.
import { LIBRARY, BY_ID, MINE } from '../library/catalog.js';
import { PARTS } from '../sim/parts.js';
import { BOARDS, boardOf, kindOf } from '../sim/boards.js';
import { DOCS } from '../library/docs.js';
import { SIGNALS, ACTIONS, signalOf, uid, defArg } from '../prog/rules.js';
import { QUANT, ENV, INPUTS, MODELS } from '../sim/models.js';
import { compile } from '../prog/lang.js';
import * as J from '../library/jpart.js';
import * as P from '../library/packages.js';
import { DEFS as PNEU, props as pneuProps, portsOf as pneuPorts } from '../pneu/elements.js';
import { cylOf } from '../pneu/physics.js';

/** Erreur montrée à l'IA (texte clair, sans pile). */
export class ToolError extends Error {}
const fail = msg => { throw new ToolError(msg); };
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const r1 = v => Math.round(v * 10) / 10;
const deg = rad => Math.round((rad * 180) / Math.PI) % 360;
const wait = ms => new Promise(r => setTimeout(r, ms));
const OPS_OK = ['>', '<', '>=', '<=', '==', '!=', 'follow'];
/** Mes composants (créés par l'utilisateur ou un assistant), dans les mots d'un assistant. */
const MINE_ALIASES = ['my components', 'my parts', 'mine', 'custom', 'user', 'mes composants'];
const CAT_ALIASES = { sensors: 'Capteurs', sensor: 'Capteurs', inputs: 'Entrées', input: 'Entrées', display: 'Affichage', displays: 'Affichage', outputs: 'Sorties', output: 'Sorties', motors: 'Moteurs', motor: 'Moteurs', passives: 'Passifs', passive: 'Passifs', power: 'Alimentation', communication: 'Communication' };

/** Outils, lus par mcp.js ; H : interface de l'application (main.js). */
export function createTools(H) {
  const pneu = () => { if (!H.pneu) fail('the pneumatic workspace is not available'); return H.pneu; };
  /** Circuit pneumatique pour un assistant ; withState : état de la simulation (positions, pressions, forces). */
  const pneuSummary = withState => {
    const Pn = pneu(), c = Pn.circuit(), st = Pn.state(), physical = c.model === 'physical';
    const out = {
      model: physical ? 'physical' : 'discrete',
      elements: c.elements.map(e => ({ id: e.id, type: e.type, name: PNEU[e.type] ? PNEU[e.type].name() : e.type, x: e.x, y: e.y, props: pneuProps(e), ports: pneuPorts(e).map(p => `${e.id}:${p.id}`) })),
      tubes: (c.tubes || []).map(t => ({ id: t.id, from: `${t.a[0]}:${t.a[1]}`, to: `${t.b[0]}:${t.b[1]}` })),
      bench: Pn.bench(), problems: Pn.check().map(i => `${i.level}: ${i.text}`)
    };
    if (withState && H.simOn() && c.elements.length) {
      const r1 = v => Math.round(v * 100) / 100;
      out.state = {
        valves: Object.fromEntries(c.elements.filter(e => /^v/.test(e.type)).map(e => [e.id, st.pos[e.id] || 0])),
        cylinders: c.elements.filter(e => /^cyl/.test(e.type)).map(e => ({ id: e.id, label: pneuProps(e).label || undefined, extended_pct: Math.round((st.x[e.id] || 0) * 100),
          ...(physical ? { position_mm: Math.round((st.x[e.id] || 0) * cylOf(e).S * 1000), speed_m_s: r1((st.v || {})[e.id] || 0), force_N: Math.round((st.F || {})[e.id] || 0), rear_bar: r1((st.bar || {})[`${e.id}:1`] || 0), front_bar: r1((st.bar || {})[`${e.id}:2`] || 0) } : {}) })),
        leaks: (st.leaks || []).map(l => `${l.el}:${l.port}`),
        // Courses terminées depuis le début de la simulation (A+ tige sortie, A- tige rentrée), dans l'ordre.
        cycle: Pn.moves().slice(-24).map(m => `${m.name}${m.dir}`).join(' '),
        ...(Pn.grafcetState() ? { grafcet: Pn.grafcetState() } : {})
      };
    }
    return out;
  };
  const comps = () => H.comps();
  const boards = () => comps().filter(c => boardOf(c));
  const isBoard = c => !!boardOf(c);
  const label = c => (BY_ID[c.type] ? BY_ID[c.type].name : c.type);
  /** Composant par nom (LED1) ou identifiant, sans tenir compte de la casse. */
  function part(name) {
    if (name == null || name === '') fail('part is required (a name such as "LED1", see get_project)');
    const n = norm(name), all = comps();
    const c = all.find(x => x.id === name) || all.find(x => norm(x.name) === n);
    if (!c) fail(`no part named "${name}". Parts: ${all.map(x => x.name).join(', ') || '(none)'}`);
    return c;
  }
  /** Broche « PART.PIN » (LED1.A, UNO.D13, ESP32.GND) → { comp, key }. */
  function pin(ref) {
    const s = String(ref ?? ''), i = s.lastIndexOf('.');
    if (i <= 0) fail(`pin "${s}" must look like PART.PIN, e.g. "LED1.A" or "UNO.D13"`);
    const c = part(s.slice(0, i)), want = s.slice(i + 1), keys = Object.keys(c.pins);
    const key = keys.find(k => k === want) || keys.find(k => norm(k) === norm(want)) || keys.find(k => norm(k.replace(/ \(\d+\)$/, '')) === norm(want));
    if (!key) fail(`${c.name} has no pin "${want}". Pins: ${keys.join(', ')}`);
    return { comp: c, key };
  }
  const pinName = r => `${r.comp.name}.${r.key}`;
  /** Carte visée : celle nommée, sinon la seule du montage. */
  function board(name) {
    if (name) { const c = part(name); if (!isBoard(c)) fail(`${c.name} is not a board`); return c; }
    const bs = boards();
    if (!bs.length) fail('the circuit has no board: add one first (list_parts category "boards")');
    if (bs.length > 1) fail(`several boards (${bs.map(b => b.name).join(', ')}): give "board"`);
    return bs[0];
  }
  const statusText = () => { const el = typeof document !== 'undefined' && document.getElementById('status'); return el ? el.textContent.trim() : ''; };
  const summary = c => ({ name: c.name, type: c.type, label: label(c), x: r1(c.group.position.x), z: r1(c.group.position.z), rotation: deg(c.group.rotation.y), ...(isBoard(c) ? { board: true } : {}), ...(c.env ? { own_environment: c.env } : {}) });

  /** Description des broches d'un type (composant ou carte), pour get_part. */
  function pinsOf(type) {
    const prof = BOARDS[type];
    if (prof) {
      const out = Object.entries(prof.gpio).map(([k, g]) => ({ name: k, kind: 'gpio', code: prof.code(k, g), caps: [...g.caps].join(' '), ...(g.note ? { note: g.note } : {}) }));
      Object.entries(prof.power).forEach(([k, v]) => out.push({ name: k, kind: 'power', volts: v }));
      out.push({ name: 'GND', kind: 'ground' });
      return out;
    }
    const spec = PARTS[type]; if (!spec) return null;
    return spec.pins.map(p => ({
      name: p.pin, kind: p.kind, ...(p.need ? { need: p.need } : {}), ...(p.role ? { role: p.role } : {}),
      ...(p.v ? { volts: p.v } : {}), ...(p.opt ? { optional: true } : {}), ...(p.why ? { why: p.why } : {})
    }));
  }
  const PH = new Proxy({}, { get: (t, k) => (typeof k === 'string' ? k : undefined) }); // broches de l'exemple : leur nom

  const tools = [
    {
      name: 'get_project',
      description: 'Read the current circuit: parts (name, type, position in mm, rotation in degrees), wires (PART.PIN to PART.PIN), boards with their programming mode, and whether the simulation runs. Call this first.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run() {
        const ws = H.wires().map(w => ({ from: pinName(w.a), to: pinName(w.b) }));
        return {
          project: H.projectTitle(), kind: { elec: 'electronics', analog: 'analog', pneu: 'pneumatic', epneu: 'electropneumatic', logic: 'logic' }[H.kind ? H.kind() : 'elec'], simulation: H.simOn() ? 'running' : 'stopped',
          parts: comps().map(summary), wires: ws,
          boards: boards().map(b => { const st = H.prog.ai.state(b); return { name: b.name, type: b.type, kind: kindOf(b), mode: st.mode, rules: st.rules.length }; }),
          // Projet électropneumatique : le plan pneumatique et ses liaisons avec le montage (repère, composant, broche).
          ...(H.pneu && H.pneu.circuit().elements.length ? { pneumatic: { elements: H.pneu.circuit().elements.length, grafcet: !!(H.pneu.grafcet() && H.pneu.grafcet().steps.length), links: H.pneu.links() } } : {})
        };
      }
    },
    {
      name: 'list_parts',
      description: 'List the part types you can add (boards, sensors, displays, motors, passives…), optionally filtered by a search text or a category. Parts made by the user or by an assistant (create_part) are in the category "My components"/"Mes composants" (custom: true, kind: their own category). Use the "type" with add_part and get_part.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words to search in names, e.g. "temperature", "servo", "esp32"' }, category: { type: 'string', description: 'Category name as returned, e.g. "Boards"/"Cartes", "Sensors"/"Capteurs", "My components"' } } },
      annotations: { readOnlyHint: true },
      run({ query, category }) {
        const q = norm(query).split(/\s+/).filter(Boolean), cat = norm(category), alias = norm(CAT_ALIASES[cat] || (cat === 'boards' ? 'Cartes' : cat));
        const inCat = e => !cat || (MINE_ALIASES.includes(cat) || cat === norm(MINE) ? e.cat === MINE : [norm(e.cat), norm(e.group)].some(c => c === cat || c === alias));
        const list = LIBRARY.filter(e => inCat(e) && q.every(w => norm(`${e.id} ${e.name}`).includes(w)));
        return { count: list.length, parts: list.slice(0, 250).map(e => ({ type: e.id, name: e.name, category: e.cat, ...(e.cat === MINE ? { custom: true, kind: e.group } : {}), ...(BOARDS[e.id] ? { board: true } : {}) })) };
      }
    },
    {
      name: 'get_part',
      description: 'Everything about a part type: its pins (kind, what they need, voltage), what it measures (signals usable in rules) or does (actions), adjustable inputs, environment quantities that drive it, documentation and an Arduino example. For a board: its GPIO pins with capabilities and the number to write in code.',
      inputSchema: { type: 'object', properties: { type: { type: 'string', description: 'Part type from list_parts, e.g. "dht22", "led-red", "uno"' } }, required: ['type'] },
      annotations: { readOnlyHint: true },
      run({ type }) {
        const e = BY_ID[type] || LIBRARY.find(x => norm(x.name) === norm(type));
        if (!e) fail(`unknown part type "${type}" (see list_parts)`);
        const t = e.id, spec = PARTS[t], prof = BOARDS[t], d = DOCS[t];
        const sigs = SIGNALS[t] ? Object.keys(SIGNALS[t]).map(k => { const s = signalOf(t, k, null); return { signal: k, label: s.label, kind: s.kind, ...(s.unit ? { unit: s.unit } : {}), ...(s.range ? { range: s.range } : {}) }; }) : undefined;
        const acts = ACTIONS[t] ? Object.entries(ACTIONS[t]).map(([k, a]) => ({ action: k, label: a.label, ...(a.arg ? { value: a.arg } : {}), ...(a.follow ? { follows_measurement: a.follow } : {}) })) : undefined;
        let example;
        try { if (spec && typeof spec.code === 'function') example = spec.code(PH, null); } catch (err) { example = undefined; }
        return {
          type: t, name: e.name, category: e.cat, ...(prof ? { board: true, logic_volts: prof.logic, i2c: prof.i2c, spi: prof.spi, tips: prof.tips } : {}),
          ...(spec && spec.what ? { what: spec.what } : {}), pins: pinsOf(t), ...(spec && spec.lib ? { library: spec.lib } : {}),
          ...(sigs ? { signals: sigs } : {}), ...(acts ? { actions: acts } : {}),
          ...(INPUTS[t] ? { inputs: INPUTS[t] } : {}),
          ...(MODELS[t] ? { environment: MODELS[t].q.map(q => ({ quantity: q, label: QUANT[q].label, ...(QUANT[q].bool ? { kind: 'bool' } : { unit: QUANT[q].unit, min: QUANT[q].min, max: QUANT[q].max }) })) } : {}),
          ...(d ? { docs: { specs: d.specs, how: d.how, uses: d.uses, mistakes: d.mistakes } } : {}),
          ...(example ? { arduino_example: example } : {}), ...(spec && spec.notes ? { notes: spec.notes } : {})
        };
      }
    },
    {
      name: 'add_part',
      description: 'Add a part to the circuit. Without x/z it is placed on a free spot. Returns its name (LED1, UNO…) used by the other tools. Then wire it with auto_wire (recommended) or connect.',
      inputSchema: { type: 'object', properties: { type: { type: 'string' }, x: { type: 'number', description: 'mm' }, z: { type: 'number', description: 'mm' }, rotation: { type: 'number', description: 'degrees' }, name: { type: 'string', description: 'optional unique name' } }, required: ['type'] },
      run({ type, x, z, rotation, name }) {
        if (!BY_ID[type]) fail(`unknown part type "${type}" (see list_parts)`);
        if (name && comps().some(c => norm(c.name) === norm(name))) fail(`a part is already named ${name}`);
        const c = H.addPart(type, { x, z, r: rotation != null ? (rotation * Math.PI) / 180 : undefined, name });
        const keys = Object.keys(c.pins), bb = /^breadboard/.test(c.type);
        return { added: summary(c), pins: bb ? `${keys.length} holes (A1…J30, rails T+/T-/B+/B-)` : keys.slice(0, 120) };
      }
    },
    {
      name: 'remove_part',
      description: 'Remove a part and its wires.',
      inputSchema: { type: 'object', properties: { part: { type: 'string' } }, required: ['part'] },
      annotations: { destructiveHint: true },
      run({ part: p }) { const c = part(p), n = c.name; H.removePart(c); return { removed: n }; }
    },
    {
      name: 'move_part',
      description: 'Move and/or rotate a part (mm, degrees). Wires follow.',
      inputSchema: { type: 'object', properties: { part: { type: 'string' }, x: { type: 'number' }, z: { type: 'number' }, rotation: { type: 'number' } }, required: ['part'] },
      run({ part: p, x, z, rotation }) { const c = part(p); H.movePart(c, { x, z, r: rotation != null ? (rotation * Math.PI) / 180 : undefined }); return { moved: summary(c) }; }
    },
    {
      name: 'auto_wire',
      description: 'Wire one part (or the whole circuit) to the nearest board automatically: right power voltage, suitable GPIO (ADC, PWM, I2C, SPI…), series resistors, level shifters or drivers when needed, a breadboard for shared nodes. Prefer this to manual connect.',
      inputSchema: { type: 'object', properties: { part: { type: 'string', description: 'omit to wire every unwired part' } } },
      run({ part: p }) {
        const before = H.wires().length;
        H.autoWire(p ? part(p) : null);
        return { wires_added: H.wires().length - before, message: statusText() };
      }
    },
    {
      name: 'connect',
      description: 'Draw one wire between two pins, written PART.PIN (e.g. "LED1.A" to "UNO.D13"). A pin that already has a wire is joined through a breadboard row automatically.',
      inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      run({ from, to }) {
        const a = pin(from), b = pin(to), ok = H.connect(a, b);
        return { connected: !!ok, message: statusText() };
      }
    },
    {
      name: 'disconnect',
      description: 'Remove wires: every wire on one pin ("pin"), or the wire between two pins ("from" and "to").',
      inputSchema: { type: 'object', properties: { pin: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } } },
      annotations: { destructiveHint: true },
      run({ pin: one, from, to }) {
        let ws = [];
        if (from && to) ws = H.analyze().path(pin(from), pin(to)).slice(0, 1);
        else if (one) ws = H.wiresOn(pin(one));
        else fail('give "pin", or "from" and "to"');
        if (!ws.length) fail('no wire there');
        const names = ws.map(w => `${pinName(w.a)} → ${pinName(w.b)}`);
        H.disconnect(ws);
        return { removed: names };
      }
    },
    {
      name: 'check_circuit',
      description: 'Run the project checker (wiring, voltages, currents, I2C addresses, the program against the wiring; in pneumatic and electropneumatic projects also the pneumatic circuit, the GRAFCET and the tags linking both sides, codes J07xx). Returns errors and warnings with explanations. Aim for zero of both: a project is finished only when this reports no error.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      async run() {
        const r = await H.verify(false);
        if (!r) return { errors: [], warnings: [], note: 'nothing to check (empty circuit)' };
        const live = (r.diags || []).filter(d => d.accepted == null);
        const item = d => ({ code: d.code, message: d.msg || d.text || d.title || d.code });
        // Les fautes du plan pneumatique et du GRAFCET (codes J07…) sont dans le même rapport.
        return { errors: live.filter(d => d.level === 'error').map(item), warnings: live.filter(d => d.level !== 'error').map(item) };
      }
    },
    {
      name: 'get_program',
      description: 'Read a board program: how it is programmed ("rules", "blocks", "code" or "python"), the Arduino code (written by rules, blocks or by hand) and the rules.',
      inputSchema: { type: 'object', properties: { board: { type: 'string', description: 'board name; optional with a single board' } } },
      annotations: { readOnlyHint: true },
      run({ board: n }) {
        const b = board(n), st = H.prog.ai.state(b);
        return { board: b.name, kind: kindOf(b), mode: st.mode, code: st.code, rules: st.rules.map(r => ({ id: r.id, text: H.prog.ai.ruleText(r, b) })) };
      }
    },
    {
      name: 'set_program',
      description: 'Write the Arduino C++ program of a board (it becomes "code" mode: rules no longer rewrite it). The code is compiled at once; errors and warnings are returned with line numbers. Pins are written as the board names them in code (see get_part of the board).',
      inputSchema: { type: 'object', properties: { board: { type: 'string' }, code: { type: 'string' } }, required: ['code'] },
      run({ board: n, code }) {
        const b = board(n), res = compile(String(code), { board: kindOf(b), boardLabel: boardOf(b).label });
        H.prog.ai.setCode(b, String(code));
        const item = e => ({ line: e.line, col: e.col, code: e.code, message: e.msg });
        return { board: b.name, compiled: res.ok, errors: (res.errors || []).map(item), warnings: (res.warnings || []).map(item) };
      }
    },
    {
      name: 'add_rule',
      description: 'Add a rule "when <signal> <op> <value> then <actions> otherwise <actions>" (no "when": always). The board program is then written from its rules (clean Arduino code). Signals and actions of each part are listed by get_part. Example: {"when":{"part":"DHT1","signal":"temp","op":">","value":28},"then":[{"part":"FAN1","action":"on"}],"otherwise":[{"part":"FAN1","action":"off"}]}. Use op "follow" to make an action follow a measurement (e.g. servo angle follows a potentiometer).',
      inputSchema: {
        type: 'object',
        properties: {
          when: { type: 'object', properties: { part: { type: 'string' }, signal: { type: 'string' }, op: { type: 'string', enum: OPS_OK }, value: {} }, required: ['part'] },
          then: { type: 'array', items: { type: 'object', properties: { part: { type: 'string' }, action: { type: 'string' }, value: {} }, required: ['part', 'action'] } },
          otherwise: { type: 'array', items: { type: 'object', properties: { part: { type: 'string' }, action: { type: 'string' }, value: {} }, required: ['part', 'action'] } },
          use_rules: { type: 'boolean', description: 'if the board is in "code" or "blocks" mode, switch it back to rules (replaces hand-written code)' }
        },
        required: ['then']
      },
      run({ when, then = [], otherwise = [], use_rules }) {
        const r = { kind: 'rule', id: uid('r'), src: null, op: '>', v: 0, from: [0, 100], then: [], else: [] };
        let prof = null;
        if (when) {
          const c = part(when.part), sigs = SIGNALS[c.type];
          if (!sigs) fail(`${c.name} measures nothing (no signals): see get_part`);
          const key = when.signal || Object.keys(sigs)[0];
          if (!sigs[key]) fail(`${c.name} has no signal "${key}". Signals: ${Object.keys(sigs).join(', ')}`);
          const sb = boards()[0]; prof = sb ? boardOf(sb) : null;
          const sig = signalOf(c.type, key, prof);
          r.src = { comp: c.id, sig: key };
          r.op = when.op || (sig.kind === 'bool' ? '==' : '>');
          if (!OPS_OK.includes(r.op)) fail(`op must be one of ${OPS_OK.join(' ')}`);
          r.v = sig.kind === 'bool' ? (when.value === false || when.value === 0 || when.value === 'false' ? 0 : 1) : when.value != null ? +when.value : sig.def;
          if (!Number.isFinite(r.v)) fail('value must be a number');
          r.from = sig.range ? [...sig.range] : [0, 100];
        }
        const act = it => {
          const c = part(it.part), A = ACTIONS[c.type];
          if (!A) fail(`${c.name} has no actions: see get_part`);
          if (!A[it.action]) fail(`${c.name} has no action "${it.action}". Actions: ${Object.keys(A).join(', ')}`);
          return { kind: 'act', id: uid('a'), comp: c.id, act: it.action, arg: it.value !== undefined ? it.value : defArg(c.type, it.action) };
        };
        r.then = then.map(act); r.else = otherwise.map(act);
        if (!r.then.length && !r.else.length) fail('give at least one action in "then"');
        H.prog.ai.addRule(r);
        const out = { added: H.prog.ai.ruleText(r, boards()[0]) };
        const b = boards().find(x => H.prog.ai.state(x).rules.includes(r)) || boards()[0];
        if (b) {
          const mode = H.prog.ai.state(b).mode;
          if (mode !== 'rules' && use_rules) { H.prog.ai.useRules(b); out.note = `${b.name} is programmed by its rules again`; }
          else if (mode !== 'rules') out.note = `${b.name} is in "${mode}" mode: the rule is saved but its program is not rewritten (pass use_rules: true to switch back)`;
        }
        return out;
      }
    },
    {
      name: 'remove_rules',
      description: 'Remove rules: all of them, or the ones that use a given part.',
      inputSchema: { type: 'object', properties: { part: { type: 'string' }, all: { type: 'boolean' } } },
      annotations: { destructiveHint: true },
      run({ part: p, all }) {
        if (!p && !all) fail('give "part", or "all": true');
        const id = p ? part(p).id : null;
        const uses = r => { let y = false; const walk = x => { if (x.kind === 'act' && x.comp === id) y = true; if (x.kind === 'rule') { if (x.src && x.src.comp === id) y = true; [...x.then, ...x.else].forEach(walk); } }; walk(r); return y; };
        return { removed: H.prog.ai.removeRules(r => all || uses(r)) };
      }
    },
    {
      name: 'simulate',
      description: 'Start or stop the simulation (programs run, sensors respond to the environment, actuators move).',
      inputSchema: { type: 'object', properties: { run: { type: 'boolean' } }, required: ['run'] },
      async run({ run }) { H.setSim(!!run); await wait(run ? 600 : 100); return { simulation: H.simOn() ? 'running' : 'stopped', message: statusText() }; }
    },
    {
      name: 'set_environment',
      description: 'Change the simulated environment, e.g. {"values":{"temp":35,"motion":true,"lux":50}}. With "part", the values apply to that sensor only (its own setting, e.g. two IR sensors at different distances); {"part":"OBS1","shared":true} puts it back on the shared environment. Quantities: ' + Object.entries(QUANT).map(([k, q]) => `${k} (${q.bool ? 'true/false' : `${q.min}…${q.max} ${q.unit}`})`).join(', ') + '.',
      inputSchema: { type: 'object', properties: { values: { type: 'object' }, part: { type: 'string', description: 'Sensor name: set its own values instead of the shared environment' }, shared: { type: 'boolean', description: 'With part: remove its own setting' } } },
      run({ values, part: p, shared }) {
        const c = p ? part(p) : null, qs = c ? (MODELS[c.type] && MODELS[c.type].q) || [] : null;
        if (c && !qs.length) fail(`${c.name} has no environment quantity (it is not a sensor)`);
        if (c && shared) { H.setPartEnv(c, null, null); return { part: c.name, environment: 'shared' }; }
        if (!values || typeof values !== 'object') fail('values expected');
        const out = {};
        for (const [k, v] of Object.entries(values)) {
          const q = QUANT[k]; if (!q) fail(`unknown quantity "${k}". Quantities: ${Object.keys(QUANT).join(', ')}`);
          if (c && !qs.includes(k)) fail(`${c.name} does not sense "${k}". It senses: ${qs.join(', ')}`);
          const x = q.bool ? (v === true || v === 1 || v === 'true' ? 1 : 0) : Math.max(q.min, Math.min(q.max, +v));
          if (!Number.isFinite(x)) fail(`${k}: number expected`);
          if (c) H.setPartEnv(c, k, x); else H.setEnv(k, x);
          out[k] = q.bool ? !!x : x;
        }
        return c ? { part: c.name, own: out } : { environment: out };
      }
    },
    {
      name: 'set_part_input',
      description: 'Operate an input part during the simulation: press a button ({"input":"pressed","value":true}), turn a potentiometer ({"input":"pos","value":0..100}), move a joystick ("x"/"y" -100..100, "sw").',
      inputSchema: { type: 'object', properties: { part: { type: 'string' }, input: { type: 'string' }, value: {} }, required: ['part', 'input', 'value'] },
      run({ part: p, input, value }) {
        const c = part(p), inp = c.inp || {};
        if (!(input in inp)) fail(`${c.name} has no input "${input}". Inputs: ${Object.keys(inp).join(', ') || '(none)'}`);
        const v = typeof inp[input] === 'boolean' ? value === true || value === 1 || value === 'true' : +value;
        if (typeof v === 'number' && !Number.isFinite(v)) fail('number expected');
        H.setInput(c, input, v);
        return { part: c.name, [input]: v };
      }
    },
    {
      name: 'read_simulation',
      description: 'Read the running simulation: each sensor reading, each actuator state, serial monitor output of each board, and electrical faults. Sensors respond with realistic delays (a DHT22 updates every 2 s, a gas sensor heats slowly): after set_environment, pass wait_ms of 3000 or more.',
      inputSchema: { type: 'object', properties: { wait_ms: { type: 'number', description: '0 to 10000' } } },
      annotations: { readOnlyHint: true },
      async run({ wait_ms = 0 }) {
        if (wait_ms > 0) await wait(Math.min(10000, wait_ms));
        const readings = comps().filter(c => c.simR).map(c => ({ part: c.name, value: c.simR.value, ...(c.simR.detail ? { detail: c.simR.detail } : {}), ...(c.simR.level && c.simR.level !== 'ok' ? { level: c.simR.level } : {}) }));
        const actuators = comps().filter(c => c.actR).map(c => ({ part: c.name, state: c.actR.value }));
        const serial = Object.fromEntries(boards().map(b => [b.name, H.prog.ai.serial(b).slice(-1500)]));
        const faults = (H.faults() || []).slice(0, 20).map(f => f.msg || f.text || String(f.code || f));
        const out = { simulation: H.simOn() ? 'running' : 'stopped', readings, actuators, serial, faults };
        if (H.pneu && H.pneu.circuit().elements.length) out.pneumatic = pneuSummary(true).state || null;
        return out;
      }
    },
    /* ---------- Plan de travail pneumatique ---------- */
    {
      name: 'pneumatic_get',
      description: 'The pneumatic circuit (Pneumatic workspace): model (discrete or physical), elements with their ports and settings, tubes, the solenoid coils (coil24 parts, tags Y1…) and contacts (cylsensor and pressostat parts, tags B1…, S1…) present on the electronics bench, problems found, and during simulation the state (valve positions, cylinder positions, pressures, forces, leaks). Valves are switched by the coil24 part whose name is the valve’s coil tag; cylinder end sensors and pressure switches close the bench contact with their tag.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run() { return pneuSummary(true); }
    },
    {
      name: 'pneumatic_add',
      description: 'Add a pneumatic element. Types and settings: ' + Object.entries(PNEU).map(([t, d]) => `${t} (${d.name()}; settings ${JSON.stringify(d.props)})`).join('; ') + '. Valve actuators: "sol" (solenoid, set coil/coilL/coilR to a coil24 part name like "Y1"), "push", "pilot"; v52 right "spring" = monostable. Cylinders: s0/s1 = names of cylsensor parts at the retracted/extended ends; physical model: bore, rod, stroke (mm), mass (kg), load (N against extension). pswitch: sensor = pressostat part name, bar = threshold. Position x, y in grid steps (optional).',
      inputSchema: { type: 'object', properties: { type: { type: 'string', enum: Object.keys(PNEU) }, props: { type: 'object' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['type'] },
      run({ type, props = {}, x, y }) {
        const Pn = pneu(); if (!PNEU[type]) fail(`unknown pneumatic element "${type}"`);
        const e = Pn.editor.addAt(type, x, y, cleanPneuProps(type, props)); Pn.refresh();
        return { id: e.id, type, ports: pneuPorts(e).map(p => `${e.id}:${p.id}`), props: pneuProps(e) };
      }
    },
    {
      name: 'pneumatic_connect',
      description: 'Connect two ports with a tube, e.g. {"from":"e1:1","to":"e2:1"} (element id and ISO port number: 1 supply, 2 and 4 outputs, 3 and 5 exhausts, 12 and 14 pilot ports; cylinders: 1 rear chamber, 2 front chamber). An exhaust port left free vents to the air; any other free port vents too (a leak when pressurised).',
      inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      run({ from, to }) { const Pn = pneu(); try { const id = Pn.editor.connect(String(from), String(to)); Pn.refresh(); return { tube: id }; } catch (e) { fail(e.message); } }
    },
    {
      name: 'pneumatic_remove',
      description: 'Remove a pneumatic element (with its tubes) or a tube, by id.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run({ id }) { const Pn = pneu(); try { Pn.editor.removeId(String(id)); Pn.refresh(); return { removed: id }; } catch (e) { fail(e.message); } }
    },
    {
      name: 'pneumatic_set',
      description: 'Change settings of a pneumatic element ({"id":"e2","props":{"open":30}}), or the simulation model of the circuit ({"model":"physical"} for pressures, flows and forces, {"model":"discrete"} for positions and stroke times).',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, props: { type: 'object' }, model: { type: 'string', enum: ['physical', 'discrete'] } } },
      run({ id, props, model }) {
        const Pn = pneu(), out = {};
        if (model) { Pn.editor.setCircuitProp('model', model === 'physical' ? 'physical' : null); Pn.resetState(); out.model = model; }
        if (id) { const e = Pn.editor.circuit().elements.find(x => x.id === id); if (!e) fail(`no element "${id}"`); try { Pn.editor.setProps(id, cleanPneuProps(e.type, props || {})); } catch (err) { fail(err.message); } out.props = pneuProps(e); }
        if (!model && !id) fail('give an element id with props, or a model');
        Pn.refresh();
        return out;
      }
    },
    {
      name: 'grafcet_get',
      description: 'The GRAFCET (IEC 60848) of the pneumatic circuit: the sequential control part, run like a PLC. Items in order: a step { n, init, act, r, to, alt }: act = actions (solenoid tags: continuous "1Y1, 2Y1" or conditional "1Y1 si p"; stored at activation "1Y1:=1" / "1Y1:=0"), r = receptivity of the transition below (boolean: "." AND, "+" OR, "/" NOT, step variables X3, delays "3s/X2", edges "↑dcy", "=1"), to = target step (null: the next item, the first one after the last), alt = extra transitions [{ r, to }] (OR divergence); a parallel block { par: [[items], [items]…], r, to } (AND divergence into the first step of each branch; r is the AND convergence that waits for the last step of every branch; the last item of a branch has no transition of its own); a macro-step { n, macro: true, exp: [items], r, to } (entering activates the first step of its expansion, r leaves from its last step; X5 is true while any expansion step is active). A step with enc: [items] is an enclosing step: its encapsulation (a looping list whose init steps start with it) runs only while it is active. Actions can also be counters "C:=0", "C:=C+1" (read in receptivities as "C>=3", "[C=2]") and forcing orders on another partial GRAFCET while the step is active: "F/G1:{0}", "F/G1:{}" (empty), "F/G1:{*}" (frozen), "F/G1:{INIT}". name is the name of the main GRAFCET (default G1); parts: [{ name, steps }] are other partial GRAFCETs (e.g. a safety GRAFCET GS that forces production). inputs: operator panel buttons ({ name, kind: "push"|"switch" }). drive: true when it energises the solenoids (false: the board program does). Variables read: panel inputs, cylinder sensor tags (s0/s1, e.g. a0 a1) and pressure switches, bench buttons and sensors by name. With the simulation running: active steps and outputs. Errors are listed in problems.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run() {
        const Pn = pneu(), g = Pn.grafcet();
        return { grafcet: g, state: Pn.grafcetState(), problems: Pn.check().filter(i => /^GRAFCET/.test(i.text)).map(i => `${i.level}: ${i.text}`) };
      }
    },
    {
      name: 'grafcet_set',
      description: 'Replace the GRAFCET of the pneumatic circuit (same format as grafcet_get; undoable). Example A+ B+ B- A- with bistable valves 1Y1/1Y2 and 2Y1/2Y2: {"inputs":[{"name":"dcy","kind":"push"}],"steps":[{"n":0,"init":true,"act":"","r":"dcy . a0 . b0"},{"n":1,"act":"1Y1","r":"a1"},{"n":2,"act":"2Y1","r":"b1"},{"n":3,"act":"2Y2","r":"b0"},{"n":4,"act":"1Y2","r":"a0"}]}. Give null steps to remove it. Returns the problems found.',
      inputSchema: { type: 'object', properties: { steps: { type: ['array', 'null'] }, inputs: { type: 'array' }, drive: { type: 'boolean' }, name: { type: 'string' }, parts: { type: 'array' } }, required: ['steps'] },
      run({ steps, inputs, drive, name, parts }) {
        const Pn = pneu();
        if (!steps) { Pn.setGrafcet(null); return { grafcet: null }; }
        const cur = Pn.grafcet() || { inputs: [{ name: 'dcy', kind: 'push' }] };
        Pn.setGrafcet({ name: name || cur.name, drive: drive ?? cur.drive ?? true, inputs: inputs || cur.inputs, steps, parts: parts || [] });
        Pn.openGrafcet(); Pn.refresh();
        return { grafcet: Pn.grafcet(), problems: Pn.check().map(i => `${i.level}: ${i.text}`) };
      }
    },
    {
      name: 'pneumatic_link_bench',
      description: 'Electropneumatic projects: add to the electronics bench every part the pneumatic circuit names but the bench lacks, each named with its tag: a coil24 solenoid for each valve coil tag (Y1…), a cylsensor for each cylinder sensor tag (s0/s1: B1, B2…), a pressostat for each pressure switch tag (S1…). Each new part is then auto-wired to the board (solenoid: transistor stage, flyback diode and 24 V supply; contacts: INPUT_PULLUP pin and ground). Needs a board on the bench first (add_part uno). Returns the parts added and every link: tag, bench part, board pin.',
      inputSchema: { type: 'object', properties: { wire: { type: 'boolean', description: 'auto-wire the new parts (default true)' } } },
      run({ wire }) {
        const Pn = pneu(), r = Pn.linkBench({ wire: wire !== false, animate: false });
        if (r.error) fail(r.error);
        Pn.refresh();
        return { added: r.added, board: r.board, ...(r.unwired.length ? { not_wired: r.unwired, hint: 'no suitable free pin: free pins or use a bigger board, then auto_wire' } : {}), links: Pn.links(), problems: Pn.check().map(i => `${i.level}: ${i.text}`) };
      }
    },
    {
      name: 'grafcet_program',
      description: 'Write the board program from the GRAFCET of the pneumatic circuit (Arduino C++: one boolean per step, all transitions evaluated before evolving, like a PLC scan) and put it on the first board of the bench. The GRAFCET then only observes (drive false): the board energises the coil24 solenoids. Inputs are read from bench parts with the same names (button, cylsensor, pressostat), actions drive bench parts with the action names. Returns missing_inputs / missing_outputs: names with no bench part (fix with pneumatic_link_bench or add_part, then call again). Replaces the current program of that board.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { destructiveHint: true },
      async run() {
        const r = await pneu().writeProgram({ silent: true });
        if (!r || r.error) fail((r && r.error) || 'no program written');
        return { board: r.board, lines: r.lines, missing_inputs: r.missingIn, missing_outputs: r.missingOut, next: 'check_circuit, then simulate' };
      }
    },
    {
      name: 'pneumatic_press',
      description: 'During the simulation, hold or release the push button of a pneumatic valve (act/left/right "push"): {"id":"e3","pressed":true}, or a button of the GRAFCET operator panel by its name ({"id":"dcy","pressed":true}). side "right" is the button on the 12 side of a 5/2 or 5/3 valve whose right is "push"; the default is the 14 side (or the only button of a 3/2).',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, pressed: { type: 'boolean' }, side: { type: 'string', enum: ['left', 'right'] } }, required: ['id', 'pressed'] },
      run({ id, pressed, side }) {
        const Pn = pneu(); if (!H.simOn()) fail('start the simulation first (simulate)');
        const e = Pn.editor.circuit().elements.find(x => x.id === id);
        if (!e && Pn.isGrafcetInput(id)) { Pn.press(id, !!pressed); Pn.refresh(); return { input: id, pressed: !!pressed }; }
        if (!e) fail(`no element or GRAFCET input "${id}"`);
        if (side === 'right' && !(e.type === 'v52' || e.type === 'v53')) fail('only a 5/2 or 5/3 valve has a right-side button');
        Pn.press(side === 'right' ? `${id}:R` : id, !!pressed); Pn.refresh();
        return { id, side: side === 'right' ? 'right' : 'left', pressed: !!pressed };
      }
    },
    {
      name: 'serial_send',
      description: 'Type a line into a board\'s simulated serial monitor (read by Serial.read / Serial.readString in the program).',
      inputSchema: { type: 'object', properties: { board: { type: 'string' }, text: { type: 'string' } }, required: ['text'] },
      run({ board: n, text }) { const b = board(n); if (!H.simOn()) fail('start the simulation first (simulate)'); return { sent: H.prog.ai.send(b, String(text)) }; }
    },
    {
      name: 'part_format',
      description: 'The format of a new part (manifest for create_part): pin kinds and needs, voltages, simulated behaviour (LED, resistive load, analog or on/off sensor output driven by an environment quantity), look and documentation, with examples. Read it before create_part.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run() { return partFormat(); }
    },
    {
      name: 'create_part',
      description: 'Create a new part type from a declarative manifest (no code runs) and add it to the user library, in the category "My components"; optionally place it. Search list_parts first: the standard library may already have the part. Pins without x/y/z are laid out in a 2.54 mm header row. Validation errors come back with their path (e.g. part.pins[2].need): fix and call again. Read part_format first.',
      inputSchema: { type: 'object', properties: { manifest: { type: 'object' }, place: { type: 'boolean' } }, required: ['manifest'] },
      async run({ manifest, place }) {
        const m = prepareManifest(manifest);
        const v = J.validateManifest(m);
        if (!v.ok) fail(`invalid part manifest:\n- ${v.errors.slice(0, 30).join('\n- ')}`);
        if (P.isStandard(v.manifest.id)) fail(`"${v.manifest.id}" is a standard part of the library (${BY_ID[v.manifest.id].name}): add it with add_part, or give your new part another id or name`);
        const old = P.packageOf(v.manifest.id);
        if (old) v.manifest.version = Math.max(old.manifest.version + 1, v.manifest.version || 1);
        const bytes = J.packJpart({ manifest: v.manifest });
        await P.installBytes(bytes, { saved: true });
        try { await H.native.librarySave({ id: v.manifest.id, kind: 'package', name: v.manifest.name, jpart: J.toB64(bytes) }); P.markSaved(v.manifest.id); } catch (e) { /* bibliothèque indisponible : composant gardé pour la session */ }
        H.renderLibrary();
        const out = { type: v.manifest.id, name: v.manifest.name, category: MINE, version: v.manifest.version, pins: v.manifest.pins.map(p => p.name), updated: !!old };
        if (place) out.added = summary(H.addPart(v.manifest.id, {}));
        return out;
      }
    },
    {
      name: 'screenshot',
      description: 'Picture of the 3D workbench as the user sees it (JPEG). Use it to check the layout or show the result.',
      inputSchema: { type: 'object', properties: { frame: { type: 'boolean', description: 'fit every part in view first (default true)' } } },
      annotations: { readOnlyHint: true },
      run({ frame = true }) {
        if (frame) H.frameAll();
        const url = H.snapshot();
        if (!url) fail('screenshot unavailable');
        return { image: url.split(',')[1], mimeType: url.slice(5, url.indexOf(';')), text: `${comps().length} parts, ${H.wires().length} wires` };
      }
    },
    {
      name: 'new_project',
      description: 'Start an empty project of a given kind: "electronics" (a board, sensors, a program; default), "analog" (no board: passives, NE555, op-amps, scope), "pneumatic" (compressed air only, no bench), "electropneumatic" (a board drives a pneumatic circuit: both workspaces), "logic" (gates, flip-flops). The kind decides which workspaces the user sees; it widens by itself when you add parts of another workspace. If the current circuit is not empty, the user is asked to confirm in Jollof Studio.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['electronics', 'analog', 'pneumatic', 'electropneumatic', 'logic'] } } },
      annotations: { destructiveHint: true },
      async run({ name, kind }) {
        if (comps().length && !(await H.confirmReplace(H.projectTitle()))) fail('the user kept the current project');
        await H.newProject({ electronics: 'elec', analog: 'analog', pneumatic: 'pneu', electropneumatic: 'epneu', logic: 'logic' }[kind] || 'elec'); if (name) H.setProjectName(String(name).slice(0, 80));
        return { project: H.projectTitle(), kind: kind || 'electronics' };
      }
    },
    {
      name: 'list_examples',
      description: 'Ready-made example circuits (one contains mistakes to find).',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run() { return { examples: H.EXAMPLES.map((e, i) => ({ index: i, name: e.data.name, ...(e.data.exercice ? { exercise: true } : {}) })) }; }
    },
    {
      name: 'open_example',
      description: 'Open an example circuit (replaces the current project, after the user confirms in Jollof Studio if it is not empty; its simulation starts).',
      inputSchema: { type: 'object', properties: { example: { type: 'string', description: 'name or index from list_examples' } }, required: ['example'] },
      annotations: { destructiveHint: true },
      async run({ example }) {
        const i = /^\d+$/.test(String(example)) ? +example : H.EXAMPLES.findIndex(e => norm(e.data.name).includes(norm(example)));
        if (!H.EXAMPLES[i]) fail(`no example "${example}" (see list_examples)`);
        if (comps().length && !(await H.confirmReplace(H.projectTitle()))) fail('the user kept the current project');
        await H.loadExample(i);
        return { opened: H.EXAMPLES[i].data.name, parts: comps().length };
      }
    },
    {
      name: 'undo',
      description: 'Undo the last change (like Ctrl+Z).',
      inputSchema: { type: 'object', properties: {} },
      async run() { await H.undo(); return { parts: comps().length, wires: H.wires().length }; }
    }
  ];
  return tools.map(t => ({ ...t, title: t.title || t.name.replace(/_/g, ' ') }));
}

/** Manifeste complété : format, identifiant, préfixe, catégorie (noms anglais acceptés), broches rangées en ligne. */
/** Réglages d'un élément pneumatique reçus d'un assistant : clés connues, nombres, repères en majuscules. */
function cleanPneuProps(type, p) {
  const def = PNEU[type].props || {}, out = {};
  for (const [k, v] of Object.entries(p || {})) {
    if (!(k in def)) fail(`${type} has no setting "${k}". Settings: ${Object.keys(def).join(', ') || '(none)'}`);
    if (typeof def[k] === 'number') { if (!Number.isFinite(+v)) fail(`${k}: number expected`); out[k] = +v; } else if (k === 'label' || k === 'cam') out[k] = String(v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
    else if (k === 'end') out[k] = String(v) === '0' ? '0' : '1';
    else if (['coil', 'coilL', 'coilR', 's0', 's1', 'sensor'].includes(k)) out[k] = String(v).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12); else out[k] = String(v).slice(0, 20);
  }
  return out;
}

export function prepareManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('manifest must be an object');
  const m = JSON.parse(JSON.stringify(raw));
  m.format = m.format ?? J.FORMAT;
  const slug = String(m.name || 'part').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'part';
  if (!m.id) m.id = `pk-${slug}`;
  else if (typeof m.id === 'string' && !m.id.startsWith('pk-')) m.id = `pk-${m.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')}`;
  if (!m.prefix && m.name) m.prefix = String(m.name).normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().replace(/^[0-9]+/, '').slice(0, 6) || 'U';
  if (typeof m.category === 'string' && CAT_ALIASES[norm(m.category)]) m.category = CAT_ALIASES[norm(m.category)];
  if (Array.isArray(m.pins)) {
    const n = m.pins.length, size = m.look && Array.isArray(m.look.size) ? m.look.size : null;
    const z = size ? Math.round((size[2] / 2 - 2.2) * 100) / 100 : 0;
    m.pins = m.pins.map((p, i) => (p && typeof p === 'object' && (p.x == null || p.y == null || p.z == null)
      ? { ...p, x: p.x ?? Math.round((i - (n - 1) / 2) * 254) / 100, y: p.y ?? 8.1, z: p.z ?? z } : p));
  }
  return m;
}

/** Format d'un composant (pour l'IA) : lu dans les tables de jpart.js et models.js, toujours à jour. */
function partFormat() {
  return {
    overview: 'A part is a JSON manifest. Required: name, category, prefix (A-Z, up to 8, used for names like LDR1), pins. Optional: description, behaviour (what the simulator does: LED, load, analog/on-off/pulse outputs, I2C or SPI registers and commands), look (3D shape), docs, ma (current in mA) and sources (datasheets). Rules, blocks and generated code read every declared output, without any library.',
    categories: J.PKG_CATEGORIES.map(c => ({ value: c, english: Object.entries(CAT_ALIASES).find(([, v]) => v === c)?.[0] })),
    pin: {
      fields: 'name (A-Z 0-9 + - _ . / ~, up to 16), kind, need (for kind io), role (short label), why (one sentence), v (for kind pwr), opt (optional pin), x/y/z in mm (omit: header row)',
      kinds: { pwr: 'power input (needs v)', gnd: 'ground', io: 'signal to a board GPIO (needs need)', nc: 'not connected', drv: 'driven by a motor driver/transistor, never a GPIO', contact: 'switch contact', passive: 'passive leg (resistor, capacitor)' },
      needs: { io: 'bidirectional data', in: 'module output read by the board', out: 'board drives the module', pullup: 'input with pull-up', pwm: 'PWM output from the board', adc: 'analog voltage read by analogRead', irq: 'pulse output counted by an interrupt (auto-wiring picks an interrupt-capable pin)', sda: 'I2C data', scl: 'I2C clock', sck: 'SPI clock', mosi: 'SPI MOSI', miso: 'SPI MISO', ss: 'SPI chip select', rx: 'board RX ← module TX', tx: 'board TX → module RX' },
      voltage: 'v: "logic" (powered at the board logic voltage, no datasheet needed) or [min, max] volts, which then requires ds: a key of "sources" (a datasheet citation: title, publisher, url, section)'
    },
    behaviour: {
      led: '{"anode":"A","cathode":"K","vf":2.0,"color":"red|green|blue|yellow|white|orange|#rrggbb"}',
      load: '{"pin":"1","to":"2","ohms":220} (a resistor-like load between two pins)',
      analogOut: '[{"pin":"AO","quantity":"lux","from":[0,2000],"to":[0.1,0.9],"ratio":true,"curve":[[0,0.9],[200,0.5],[2000,0.1]]}] (output voltage: ratio=true gives a fraction of the supply; curve optional, x increasing)',
      digitalOut: '[{"pin":"DO","quantity":"gas","threshold":1000,"activeLow":true}] (on/off output; boolean quantities need no threshold)',
      pulseOut: '[{"pin":"OUT","quantity":"flow","hzPer":7.5}] (square wave whose frequency follows a quantity: flow meters, anemometers, tachometers; or "curve":[[quantity, Hz]…]; the pin needs "irq")',
      i2c: 'I2C sensor answered by the simulator, read by real libraries (Faithful mode) and by generated Wire code. {"address":68,"alt":69,"addressPin":"ADR","regBytes":1,"regSize":1,"registers":[…],"commands":[…]}. registers: {"at":2,"bytes":[…]} constants (IDs, status, config) or {"at":2,"quantity":"voltage","bits":16,"signed":false,"scale":250,"offset":0,"shift":3,"endian":"big"} measured values (raw = round(quantity × scale + offset) << shift). regSize 2 for chips whose registers are 16-bit words (INA219, ADS1115, TMP102). Writes are stored and read back. commands: {"write":[36,0],"reply":[{value}, {"crc":"sensirion"}, {"bytes":[…]}]} for command-based chips (SHT3x, AHT20…). Needs pins with need sda and scl.',
      spi: 'SPI sensor: {"mode":"frame","cs":"CS","frame":[{value}…]} (whole frame clocked out on each selection, e.g. MAX6675) or {"mode":"register","cs":"CS","registers":[…],"readBit":128,"readWhenSet":true,"addrMask":127} (first byte = register address). Needs pins with need sck, miso (mosi for register mode) and the cs pin with need ss.',
      sample: '{"period":0.2,"tau":0.3} (seconds between readings, response time)',
      quantities: Object.fromEntries(Object.entries(QUANT).map(([k, q]) => [k, q.bool ? 'true/false' : `${q.min}…${q.max} ${q.unit}`]))
    },
    look: { kinds: J.LOOKS.filter(k => k !== 'glb' && k !== 'svg'), fields: 'kind, color (#rrggbb), label (printed text), size [w,h,d] mm, bands (resistor colour digits)' },
    docs: '{"text":"…","specs":[["Range","0–100 %"]],"uses":["…"],"mistakes":["…"]}',
    examples: [
      { name: 'Rain sensor module', category: 'Sensors', prefix: 'RAIN', description: 'Board with interleaved traces: wetter, lower voltage.', pins: [{ name: 'VCC', kind: 'pwr', v: 'logic' }, { name: 'GND', kind: 'gnd' }, { name: 'AO', kind: 'io', need: 'adc', role: 'Analog', why: 'Voltage drops as the plate gets wetter.' }, { name: 'DO', kind: 'io', need: 'in', opt: true, role: 'Alarm', why: 'LOW above the threshold.' }], behaviour: { analogOut: [{ pin: 'AO', quantity: 'rain', from: [0, 100], to: [0.95, 0.1], ratio: true }], digitalOut: [{ pin: 'DO', quantity: 'rain', threshold: 25, activeLow: true }] }, look: { kind: 'module', color: '#1b4f8c', label: 'RAIN' } },
      { name: 'Yellow LED 3 mm', category: 'Outputs', prefix: 'LEDY', pins: [{ name: 'A', kind: 'io', need: 'out', via: 'res-220', role: 'Anode' }, { name: 'K', kind: 'gnd', role: 'Cathode' }], behaviour: { led: { anode: 'A', cathode: 'K', vf: 2.1, color: 'yellow' } }, look: { kind: 'led' } },
      { name: 'SHT31 temperature and humidity', category: 'Sensors', prefix: 'SHT', pins: [{ name: 'VIN', kind: 'pwr', v: 'logic' }, { name: 'GND', kind: 'gnd' }, { name: 'SCL', kind: 'io', need: 'scl' }, { name: 'SDA', kind: 'io', need: 'sda' }, { name: 'ADR', kind: 'gnd', role: 'Address' }],
        behaviour: { i2c: { address: 0x44, alt: 0x45, addressPin: 'ADR', commands: [{ write: [0x24, 0x00], reply: [{ quantity: 'temp', bits: 16, scale: 374.4857, offset: 16851.86 }, { crc: 'sensirion' }, { quantity: 'hum', bits: 16, scale: 655.35 }, { crc: 'sensirion' }] }] } } },
      { name: 'INA219 current sensor', category: 'Sensors', prefix: 'INA', pins: [{ name: 'VCC', kind: 'pwr', v: 'logic' }, { name: 'GND', kind: 'gnd' }, { name: 'SCL', kind: 'io', need: 'scl' }, { name: 'SDA', kind: 'io', need: 'sda' }],
        behaviour: { i2c: { address: 0x40, regSize: 2, registers: [{ at: 0, bytes: [0x39, 0x9f] }, { at: 1, quantity: 'current', bits: 16, signed: true, scale: 10000 }, { at: 2, quantity: 'voltage', bits: 16, scale: 250, shift: 3 }] } } },
      { name: 'MAX6675 thermocouple', category: 'Sensors', prefix: 'TC', pins: [{ name: 'GND', kind: 'gnd' }, { name: 'VCC', kind: 'pwr', v: 'logic' }, { name: 'SCK', kind: 'io', need: 'sck' }, { name: 'CS', kind: 'io', need: 'ss' }, { name: 'SO', kind: 'io', need: 'miso' }],
        behaviour: { spi: { mode: 'frame', cs: 'CS', frame: [{ quantity: 'temp', bits: 16, scale: 4, shift: 3 }] } } },
      { name: 'YF-S201 water flow meter', category: 'Sensors', prefix: 'FLOW', pins: [{ name: 'VCC', kind: 'pwr', v: 'logic' }, { name: 'GND', kind: 'gnd' }, { name: 'OUT', kind: 'io', need: 'irq', role: 'Pulses' }], behaviour: { pulseOut: [{ pin: 'OUT', quantity: 'flow', hzPer: 7.5 }] } }
    ]
  };
}
