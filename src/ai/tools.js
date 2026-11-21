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
import { SIGNALS, ACTIONS, signalOf, uid, defArg, migrate, ident, varText, involves, srcSignal, termDefaults, SERIAL, SERIAL_ACTS } from '../prog/rules.js';
// Plan réseau : ses modules (appareils, câbles, contrôles) se chargent au premier outil net_* (voir netWs).
let NETDEV, makeCable, STD, cleanEnd, analyzeCable, analyzeChain, cleanNet, netIssues, prefixOf, whyText;
async function netLibs() {
  if (NETDEV) return;
  const [d, c, cl, is, ip, lc] = await Promise.all([import('../net/devices.js'), import('../net/cable.js'), import('../net/clean.js'), import('../net/issues.js'), import('../net/ip.js'), import('../net/labcheck.js')]);
  ({ makeCable, STD, cleanEnd, analyzeCable, analyzeChain } = c);
  ({ cleanNet } = cl); ({ netIssues } = is); ({ prefixOf } = ip); ({ whyText } = lc);
  NETDEV = d.DEVICES;
}
import { NET, NET_SIG, NET_ACTS, cleanTopic } from '../prog/rules-net.js';
import { QUANT, ENV, INPUTS, MODELS, encTurn, remotePress } from '../sim/models.js';
import { compile } from '../prog/lang.js';
import * as J from '../library/jpart.js';
import * as P from '../library/packages.js';
import { DEFS as PNEU, props as pneuProps, portsOf as pneuPorts } from '../pneu/elements.js';
import { cylOf } from '../pneu/physics.js';
import { netOnly } from '../ui/kind.js';
import { CATALOG as TWIN, TEMPLATES as TWIN_TEMPLATES, ENUMS as TWIN_ENUMS } from '../twin/model.js';

/** Erreur montrée à l'IA (texte clair, sans pile). */
export class ToolError extends Error {}

/**
 * Outils du montage (cartes, composants, fils, programmes, simulation des cartes, pneumatique) : un projet réseau seul
 * (type « net ») n'en a pas. Ils ne sont pas listés pour lui (mcp.js, tools.visible) et refusent avec une explication.
 */
export const BENCH_TOOLS = new Set(['list_parts', 'get_part', 'add_part', 'remove_part', 'move_part', 'auto_wire', 'connect', 'disconnect', 'get_program', 'set_program',
  'add_rule', 'add_variable', 'add_sequence', 'remove_rules', 'simulate', 'set_environment', 'set_part_input', 'read_simulation', 'serial_send', 'part_format', 'create_part',
  'pneumatic_get', 'pneumatic_add', 'pneumatic_connect', 'pneumatic_remove', 'pneumatic_set', 'grafcet_get', 'grafcet_set', 'dcy', 'plc_get', 'plc_set', 'plc_from_grafcet',
  'pneumatic_link_bench', 'grafcet_program', 'pneumatic_press', 'machine_get', 'machine_set']);
/** L'outil name est-il utilisable dans un projet de ce type ? */
export const toolFits = (name, kind) => !(BENCH_TOOLS.has(name) && netOnly(kind));
/** Explication d'un refus (en anglais : lue par l'assistant). */
export const benchRefusal = name => `${name} acts on the electronics bench (boards, parts, wires, programs, pneumatics), but this is a network project (kind "net"), which has none. Use the net_* tools (and the network design tools) here; to put a board on the network, create a project of kind "iot" with new_project.`;
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
      bench: Pn.bench(), problems: Pn.check().map(i => `${i.level}: ${i.text}`),
      // Machine de la vue 3D (circuit.scene) : ses capteurs, compteurs, alarme et actions quand son procédé est simulé (magasin, embouteillage, barrière).
      ...(Pn.machine && Pn.machine() ? { machine: Pn.machine() } : {})
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
  /* ---------- Règles décrites par l'IA → arbre des règles (src/prog/rules.js) ---------- */
  const declNamed = (kind, name) => H.prog.ai.rules().find(x => x.kind === kind && x.name.toLowerCase() === String(name).toLowerCase()) || fail(`no ${kind === 'var' ? 'variable' : 'sequence'} named "${name}"`);
  /** Source d'une valeur : { part, signal } | { variable } | { serial: true }. */
  function source(x, prof) {
    if (!x || typeof x !== 'object') fail('source expected: {"part","signal"} or {"variable"}');
    if (x.variable) return { var: declNamed('var', x.variable).id };
    if (x.serial) return { comp: SERIAL, sig: 'line' };
    if (x.net) { // réseau (rules-net.js) : message ou nombre reçu sur un sujet MQTT, demande de la page web, connexions
      const sig = { message: 'msg', number: 'num', page: 'page', online: 'online', mqtt: 'mqtt' }[x.net];
      if (!sig) fail('net must be "message", "number", "page", "online" or "mqtt"');
      return NET_SIG[sig].topic ? { comp: NET, sig, topic: cleanTopic(x.topic, false) } : { comp: NET, sig };
    }
    const c = part(x.part), sigs = SIGNALS[c.type];
    if (!sigs) fail(`${c.name} measures nothing (no signals): see get_part`);
    const key = x.signal || Object.keys(sigs)[0];
    if (!sigs[key]) fail(`${c.name} has no signal "${key}". Signals: ${Object.keys(sigs).join(', ')}`);
    void prof;
    return { comp: c.id, sig: key };
  }
  /** Une condition. */
  function term(w, prof) {
    const t = {};
    if (w.every_ms) t.src = { every: Math.max(1, Math.round(+w.every_ms)) };
    else if (w.at_start) t.src = { start: true };
    else if (w.sequence) { const q = declNamed('seq', w.sequence), s = q.steps.find(x => x.name.toLowerCase() === String(w.step).toLowerCase()); if (!s) fail(`no step "${w.step}" in ${q.name}`); t.src = { seq: q.id, step: s.id }; }
    else t.src = source(w, prof);
    if (t.src.every || t.src.start || t.src.seq) { t.op = '=='; t.v = 1; }
    else {
      const sig = srcSignal(t.src, id => H.prog.ai.rules().find(x => x.id === id) || comps().find(c => c.id === id), prof);
      Object.assign(t, termDefaults(sig));
      if (w.op) t.op = w.op;
      const ok = sig.kind === 'text' ? ['==', '!=', 'has', 'any'] : sig.event ? ['==', 'any'] : sig.kind === 'bool' ? ['=='] : OPS_OK;
      if (!ok.includes(t.op)) fail(`op must be one of ${ok.join(' ')}`);
      if (sig.kind === 'bool') t.v = w.value === false || w.value === 0 || w.value === 'false' ? 0 : 1;
      else if (sig.kind === 'text') t.v = String(w.value ?? '');
      else if (sig.kind === 'time' && typeof w.value === 'string' && /^\d{1,2}:\d{2}$/.test(w.value)) { const [h, m] = w.value.split(':'); t.v = +h * 60 + +m; }
      else if (w.value != null) { t.v = +w.value; if (!Number.isFinite(t.v)) fail('value must be a number'); }
      if (sig.range) t.from = [...sig.range];
      if (w.compare_to) t.vs = source(w.compare_to, prof);
      if (w.hysteresis) t.hyst = Math.abs(+w.hysteresis);
    }
    if (w.edge) t.edge = true;
    if (w.hold_ms) t.hold = Math.max(0, Math.round(+w.hold_ms));
    if (w.not) t.not = true;
    return t;
  }
  /** Un élément d'une branche ou d'une étape. */
  function item(it, prof) {
    if (!it || typeof it !== 'object') fail('item expected');
    if (it.rule) return buildRule(it.rule, prof);
    if (it.wait_ms != null) return { kind: 'wait', id: uid('a'), ms: Math.max(1, Math.round(+it.wait_ms)) };
    if (it.sequence) { const q = declNamed('seq', it.sequence), s = it.step == null ? null : q.steps.find(x => x.name.toLowerCase() === String(it.step).toLowerCase()); if (it.step != null && !s) fail(`no step "${it.step}" in ${q.name}`); return { kind: 'goto', id: uid('a'), seq: q.id, step: s ? s.id : null }; }
    if (it.variable) {
      const d = declNamed('var', it.variable), o = { kind: 'set', id: uid('a'), var: d.id };
      if (it.toggle) o.op = 'toggle'; else if (it.add != null) { o.op = '+'; o.v = +it.add; } else if (it.subtract != null) { o.op = '-'; o.v = +it.subtract; }
      else if (it.set_from) { o.op = '='; o.src = source(it.set_from, prof); } else { o.op = '='; o.v = d.type === 'text' ? String(it.set ?? '') : d.type === 'bool' ? !!it.set : +it.set || 0; }
      return o;
    }
    if (it.serial) {
      if (!SERIAL_ACTS[it.serial]) fail('serial must be "print", "show" or "plot"');
      const o = { kind: 'act', id: uid('a'), comp: SERIAL, act: it.serial, arg: it.serial === 'print' ? String(it.value ?? '') : null };
      if (it.show) o.what = source(it.show, prof); else if (it.serial !== 'print') fail('give "show": the value to write');
      return o;
    }
    if (it.net) { // réseau : publier sur un sujet MQTT, une ligne de la page web
      if (!NET_ACTS[it.net]) fail('net must be "publish" or "page"');
      const o = { kind: 'act', id: uid('a'), comp: NET, act: it.net, arg: it.show ? defArg(NET, it.net) : String(it.value ?? defArg(NET, it.net)) };
      if (it.show) o.what = source(it.show, prof);
      if (it.net === 'publish') o.topic = cleanTopic(it.topic, true); else if (it.line) o.line = +it.line;
      return o;
    }
    const c = part(it.part), A = ACTIONS[c.type];
    if (!A) fail(`${c.name} has no actions: see get_part`);
    if (!A[it.action]) fail(`${c.name} has no action "${it.action}". Actions: ${Object.keys(A).join(', ')}`);
    const o = { kind: 'act', id: uid('a'), comp: c.id, act: it.action, arg: it.value !== undefined ? it.value : defArg(c.type, it.action) };
    if (it.show) o.what = source(it.show, prof);
    if (it.line) o.line = +it.line;
    return o;
  }
  function buildRule({ when, then = [], otherwise = [] }, prof) {
    const r = { kind: 'rule', id: uid('r'), src: null, op: '>', v: 0, from: [0, 100], then: [], else: [] };
    if (when) {
      Object.assign(r, term(when, prof));
      const more = [...(when.and || []).map(w => ({ ...term(w, prof), link: 'and' })), ...(when.or || []).map(w => ({ ...term(w, prof), link: 'or' }))];
      if (more.length) r.more = more;
    }
    r.then = then.map(x => item(x, prof)); r.else = otherwise.map(x => item(x, prof));
    return migrate(r);
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

  /* Plan réseau : chargé à la demande ; noms ou identifiants des équipements, « NOM.port » pour un port. */
  async function netWs() {
    if (!H.net) fail('the network workspace is not available');
    const k = H.kind ? H.kind() : 'elec';
    if (!['net', 'iot'].includes(k)) fail('this project has no network workspace: create a project of kind "net" (or "iot" with a board) with new_project');
    const [W] = await Promise.all([H.net.ready(), netLibs()]);
    return W;
  }
  const netNode = (W, ref) => { const st = W.lan().state(), s = norm(ref); const n = st.all.find(x => x.id === ref) || st.all.find(x => norm(x.name || '') === s); if (!n) fail(`no network device "${ref}" (see net_get)`); return n; };
  const netDev = (W, ref) => { const n = netNode(W, ref); const d = W.data().devices.find(x => x.id === n.id); if (!d) fail(`${ref} comes from the electronics bench: change it there`); return d; };
  const netName = (W, id) => { const n = W.lan().state().byId.get(id); return n ? n.name : id; };
  const netPorts = d => NETDEV[d.type] ? NETDEV[d.type].ports(d.p || {}) : [];
  function netPort(W, ref) {
    const s = String(ref ?? ''), i = s.lastIndexOf('.');
    if (i <= 0) fail(`port "${s}" must look like NAME.port, e.g. "PC1.eth0"`);
    const n = netNode(W, s.slice(0, i)), want = s.slice(i + 1), ports = n.ext ? [{ id: n.type === 'wifi' ? '' : 'eth' }] : netPorts(n);
    const p = ports.find(x => x.id === want) || ports.find(x => norm(x.id) === norm(want));
    if (!p || !p.id) fail(`${n.name} has no port "${want}". Ports: ${ports.map(x => x.id).filter(Boolean).join(', ') || '(none: Wi-Fi only)'}`);
    return [n.id, p.id];
  }
  function applyNetSettings(W, d, st) {
    const merged = JSON.parse(JSON.stringify(d.p || {}));
    for (const [k, v] of Object.entries(st || {})) {
      if (k === 'name') { d.name = String(v).slice(0, 24); continue; }
      if (v && typeof v === 'object' && !Array.isArray(v)) merged[k] = { ...(merged[k] || {}), ...v };
      else merged[k] = v;
    }
    if (merged.ip && merged.ip.prefix != null) merged.ip.prefix = prefixOf(merged.ip.prefix) ?? merged.ip.prefix;
    const clean = cleanNet({ devices: [{ ...d, p: merged }], cables: [] }).devices[0];
    if (!clean) fail('invalid settings');
    d.p = clean.p;
  }
  /** Résultat d'un test de câble, en anglais pour l'assistant. */
  const testerSummary = segs => { const r = analyzeChain(segs); return r.kind === 'none' ? 'not crimped' : `${r.kind}${r.faults.length ? ': ' + r.faults.map(f => `${f.type} (pins ${f.pins.join(', ')})`).join('; ') : ' — no fault'}`; };
  // Mode examen du plan réseau (data.exam, réglé par l'enseignant) : l'assistant ne donne pas non plus le verdict d'un câble
  // (genre, défauts, codes J1201/J1202) ; il garde les preuves brutes (voyants du testeur), comme l'élève.
  const EXAM_HIDDEN = new Set(['J1201', 'J1202']);
  const examOf = W => !!(W && W.data && W.data().exam === true);
  const shownIssues = (W, list) => (examOf(W) ? list.filter(i => !EXAM_HIDDEN.has(i.code)) : list);
  function cableInfo(c, exam = false) { const r = analyzeCable(c.wire); return exam ? { id: c.id, category: c.cat, length_m: c.len, crimped: [!!(c.wire.a && c.wire.a.crimped), !!(c.wire.b && c.wire.b.crimped)], exam: true } : { id: c.id, category: c.cat, length_m: c.len, kind: r.kind, faults: r.faults.map(f => `${f.type} ${f.pins.join('-')}`) }; }
  function netSummary(W) {
    const lan = W.lan(), st = lan.state(), data = W.data();
    return {
      devices: st.all.map(n => { const f = lan.ipOf(n.id), pw = lan.power(n.id); return { id: n.id, name: n.name, type: n.type, ...(f && f.ip ? { ip: `${f.ip}/${f.prefix}`, ip_source: f.src, gateway: f.gw || null } : {}), ...(pw && !pw.on ? { powered: false, why: whyText(pw.why) } : {}), ports: (n.ext ? [] : netPorts(n)).map(p => p.id) }; }),
      cables: data.cables.map(c => ({ ...cableInfo(c, examOf(W)), a: `${netName(W, c.a[0])}.${c.a[1]}`, b: `${netName(W, c.b[0])}.${c.b[1]}` })),
      links: [...st.links].filter(([k, l]) => l.up && l.peer && k < l.peer.n + '|' + l.peer.p).map(([k, l]) => ({ a: `${netName(W, k.split('|')[0])}.${k.split('|')[1]}`, b: `${netName(W, l.peer.n)}.${l.peer.p}`, speed_mbps: l.speed, auto_mdix: !!l.mdix, errors: !!l.errors })),
      problems: shownIssues(W, netIssues(lan, data)).map(i => `${i.code} ${i.text}`),
      ...(examOf(W) ? { exam: 'exam mode: cable verdicts are hidden (use the tester wire map)' } : {})
    };
  }

  const tools = [
    {
      name: 'get_project',
      description: 'Read the current circuit: parts (name, type, position in mm, rotation in degrees), wires (PART.PIN to PART.PIN), boards with their programming mode, and whether the simulation runs. Call this first.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run() {
        const ws = H.wires().map(w => ({ from: pinName(w.a), to: pinName(w.b) }));
        return {
          project: H.projectTitle(), kind: { elec: 'electronics', analog: 'analog', pneu: 'pneumatic', epneu: 'electropneumatic', logic: 'logic', net: 'network', iot: 'connected objects' }[H.kind ? H.kind() : 'elec'], simulation: H.simOn() ? 'running' : 'stopped',
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
      description: 'Add a rule "when <conditions> then <items> otherwise <items>" (no "when": always). The board program is then written from its rules (robust Arduino code: no String, non-blocking millis() timing, sensor failures handled). Signals and actions of each part are listed by get_part. '
        + 'Condition: {"part":"DHT1","signal":"temp","op":">","value":28} — or {"variable":"compteur","op":">=","value":10}, {"serial":true,"op":"==","value":"marche"} (a line received on the serial monitor; op "any" for any line), {"every_ms":2000} (true once every period), {"at_start":true} (first loop only), {"sequence":"Feu","step":"Rouge"} (that step is active), network (board with a W5500/ENC28J60 module or Wi-Fi): {"net":"message","topic":"maison/led","op":"==","value":"ON"} (MQTT message received on a topic; op "any" for any message), {"net":"number","topic":"maison/consigne"} (number received), {"net":"page","op":"==","value":"/on"} (web page request), {"net":"online","value":true}, {"net":"mqtt","value":true} (connected). '
        + 'Options on a condition: "edge":true (only the moment it becomes true, debounced: "dès que"), "hold_ms":2000 (true for at least that long), "hysteresis":2 (with > or <: turns false only 2 units back), "compare_to":{"part","signal"}|{"variable"} (instead of value), "not":true. Text signals (received message, RFID tag, key) use op "==", "!=", "has" (contains) or "any". '
        + 'More conditions: "and":[conditions] or "or":[conditions] (evaluated left to right). Use op "follow" to make actions follow a measurement (servo angle follows a potentiometer). '
        + 'Items (then/otherwise): {"part":"FAN1","action":"on","value":…} (displays and comm modules: "show":{"part","signal"}|{"variable"} chooses the value shown or sent, "line":2 the screen line), {"serial":"print","value":"text"} | {"serial":"show","show":{…}} | {"serial":"plot","show":{…}}, {"variable":"compteur","set":0} | {"variable":"compteur","add":1} | {"variable":"compteur","subtract":1} | {"variable":"alarme","toggle":true} | {"variable":"x","set_from":{"part","signal"}}, {"wait_ms":2000} ("then wait 2 s then…", non-blocking), {"net":"publish","topic":"maison/temp","show":{…}} | {"net":"publish","topic":"maison/porte","value":"ouverte"} (MQTT publish: a value when it changes under a lasting condition, at most once per second, or each time on an event/timer), {"net":"page","show":{…}|"value":"text","line":1} (a line of the board web page at http://<board ip>/; network settings default to DHCP, Wi-Fi "Atelier", MQTT broker 192.168.1.10:1883), {"sequence":"Feu","step":"Vert"} (go to that step; "step":null stops it), {"rule":{when,then,otherwise}} (nested). '
        + 'Under a lasting condition, counting, writing to serial, sending and changing step happen once when it becomes true. Example: {"when":{"part":"BTN1","signal":"pressed","edge":true},"then":[{"variable":"compteur","add":1},{"part":"LED1","action":"on"},{"wait_ms":1000},{"part":"LED1","action":"off"}]}.',
      inputSchema: {
        type: 'object',
        properties: {
          when: { type: 'object', description: 'condition (see description); "and"/"or": more conditions' },
          then: { type: 'array', items: { type: 'object' } },
          otherwise: { type: 'array', items: { type: 'object' } },
          use_rules: { type: 'boolean', description: 'if the board is in "code" or "blocks" mode, switch it back to rules (replaces hand-written code)' }
        },
        required: ['then']
      },
      run({ when, then = [], otherwise = [], use_rules }) {
        const sb = boards()[0], prof = sb ? boardOf(sb) : null;
        const r = buildRule({ when, then, otherwise }, prof);
        if (!r.then.length && !r.else.length) fail('give at least one item in "then"');
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
      name: 'add_variable',
      description: 'Declare a variable that rules can set, count with, compare and show: {"name":"compteur","type":"int"|"dec"|"bool"|"text","initial":0,"max_length":16 (text),"persist":true (kept in EEPROM across power cycles, written at most every 5 s)}.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: ['int', 'dec', 'bool', 'text'] }, initial: {}, max_length: { type: 'number' }, persist: { type: 'boolean' } }, required: ['name'] },
      run({ name, type = 'int', initial, max_length, persist }) {
        const n = ident(String(name));
        if (H.prog.ai.rules().some(x => x.kind === 'var' && x.name === n)) fail(`variable ${n} already exists`);
        const d = migrate({ kind: 'var', id: uid('v'), name: n, type, init: initial, len: max_length, persist });
        H.prog.ai.addRule(d);
        return { added: varText(d) };
      }
    },
    {
      name: 'add_sequence',
      description: 'Add a sequence (state machine, like a GRAFCET): one step active at a time; each step does its items when it is entered, then moves on by its transitions. {"name":"Feu","start":"boot"|"stopped","steps":[{"name":"Rouge","do":[items as in add_rule],"next":[{"after_ms":5000,"when":condition (optional),"to":"Vert"|null}]}]}. The first step is active at start ("stopped": until a rule items {"sequence":"Feu","step":"Rouge"}). Rules can test {"sequence":"Feu","step":"Rouge"} in a condition. Timing is non-blocking (millis()).',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, start: { type: 'string', enum: ['boot', 'stopped'] }, steps: { type: 'array', items: { type: 'object' } } }, required: ['name', 'steps'] },
      run({ name, start = 'boot', steps }) {
        const sb = boards()[0], prof = sb ? boardOf(sb) : null;
        const q = { kind: 'seq', id: uid('s'), name: ident(String(name)), start, steps: (steps || []).map(s => ({ kind: 'step', id: uid('e'), name: ident(String(s.name || 'etape')), do: [], go: [] })) };
        if (!q.steps.length) fail('give at least one step');
        H.prog.ai.addRule(q); // présente avant ses étapes : les éléments peuvent la nommer
        try {
          (steps || []).forEach((s, i) => {
            const st = q.steps[i];
            st.do = (s.do || []).map(it => item(it, prof));
            st.go = (s.next || []).map(g => {
              const to = g.to == null ? null : q.steps.find(x => x.name.toLowerCase() === ident(String(g.to)).toLowerCase());
              if (g.to != null && !to) fail(`no step "${g.to}" in ${q.name}`);
              return { kind: 'go', id: uid('g'), after: Math.max(0, +g.after_ms || 0), when: g.when ? term(g.when, prof) : null, to: to ? to.id : null };
            });
          });
        } catch (e) { H.prog.ai.removeRules(x => x === q); throw e; }
        H.prog.ai.addRule(null);
        return { added: H.prog.ai.ruleText(q, boards()[0]) };
      }
    },
    {
      name: 'remove_rules',
      description: 'Remove rules: all of them (variables and sequences too), the ones that use a given part, or a variable / sequence by name.',
      inputSchema: { type: 'object', properties: { part: { type: 'string' }, all: { type: 'boolean' }, variable: { type: 'string' }, sequence: { type: 'string' } } },
      annotations: { destructiveHint: true },
      run({ part: p, all, variable, sequence }) {
        if (!p && !all && !variable && !sequence) fail('give "part", "variable", "sequence", or "all": true');
        const id = p ? part(p).id : null;
        return { removed: H.prog.ai.removeRules(r => all || (id && involves(r, id)) || (variable && r.kind === 'var' && r.name === variable) || (sequence && r.kind === 'seq' && r.name === sequence)) };
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
      description: 'Operate an input part during the simulation: press a button ({"input":"pressed","value":true}), turn a potentiometer ({"input":"pos","value":0..100}), move a joystick ("x"/"y" -100..100, "sw"), turn a KY-040 rotary encoder by detents ({"input":"turn","value":3}, negative = counter-clockwise; "sw" presses its shaft), press a key of an IR remote ({"input":"key","value":"0x45"}: NEC command sent to every IR receiver).',
      inputSchema: { type: 'object', properties: { part: { type: 'string' }, input: { type: 'string' }, value: {} }, required: ['part', 'input', 'value'] },
      run({ part: p, input, value }) {
        const c = part(p), inp = c.inp || {};
        if (c.type === 'ky040' && input === 'turn') {
          const n = Math.trunc(+value); if (!n || !Number.isFinite(n)) fail('non-zero integer expected (detents)');
          encTurn(c, Math.sign(n), Math.abs(n)); return { part: c.name, turned: n, position: c.periph.pos };
        }
        if (c.type === 'irremote' && input === 'key') {
          const cmd = typeof value === 'string' ? parseInt(value, /^0x/i.test(value) ? 16 : 10) : +value; if (!(cmd >= 0 && cmd < 256)) fail('NEC command 0..255 expected');
          return { part: c.name, command: cmd, receivers: remotePress(comps(), cmd) };
        }
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
      description: 'The pneumatic circuit (Pneumatic workspace): model (discrete or physical), elements with their ports and settings, tubes, "machine" (the 3D scene: kind, and for the simulated processes feeder / filler / barrier its sensors such as mag, pp, pb, niv, veh, pass, its counters, alarm and actions; sensors are read by the GRAFCET and the PLC by name, actions are triggered with pneumatic_press {"name": "car"}), the solenoid coils (coil24 parts, tags Y1…) and contacts (cylsensor and pressostat parts, tags B1…, S1…) present on the electronics bench, problems found, and during simulation the state (valve positions, cylinder positions, pressures, forces, leaks). Valves are switched by the coil24 part whose name is the valve’s coil tag; cylinder end sensors and pressure switches close the bench contact with their tag.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run() { return pneuSummary(true); }
    },
    {
      name: 'pneumatic_add',
      description: 'Add a pneumatic element. Types and settings: ' + Object.entries(PNEU).map(([t, d]) => `${t} (${d.name()}; settings ${JSON.stringify(d.props)})`).join('; ') + '. Valve actuators: "sol" (solenoid, set coil/coilL/coilR to a coil24 part name like "Y1"), "push", "pilot", "roller" (v32 limit valve: cam = cylinder label, end "1"/"0"), "tempo" (v32 pneumatic timer: switches once pilot port 12 has been pressurised for delay seconds, resets when it drops); v52 right "spring" = monostable. GRAFCET timers are written in receptivities as "5s/X2" (true 5 s after step 2 became active). Cylinders: s0/s1 = names of cylsensor parts at the retracted/extended ends; physical model: bore, rod, stroke (mm), mass (kg), load (N against extension). pswitch: sensor = pressostat part name, bar = threshold. Position x, y in grid steps (optional).',
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
      name: 'plc_get',
      description: 'The PLC program (Ladder, IEC 61131-3) of the pneumatic circuit: { name, drive, cycle, inputs: operator panel buttons [{ name, kind: "push"|"switch" }], rungs: [{ id, comment, items }] }. A rung is a series of items from the left rail to the right rail: contacts { t: "no"|"nc"|"p"|"n", v } (normally open, normally closed, rising edge, falling edge), comparison { t: "cmp", a, op, b } (a = counter or timer name, op in "=", "<>", "<", "<=", ">", ">=", b integer: counter value or timer elapsed seconds), coils { t: "coil"|"ncoil"|"set"|"reset", v }, timers { t: "ton"|"tof"|"tp", v, pt } (seconds; their Q is read by a contact with the same name), counters { t: "ctu"|"ctd", v, pv, r } (r = reset / load input name), parallel branches { t: "par", branches: [[items], [items]] } (OR). Variables: panel inputs, cylinder sensors and pressure switches of the circuit (a0, a1, B1, S1), bench buttons/sensors by name, GRAFCET steps (X3), the system bit INIT (true on the first scan only), and whatever coils write: valve coil tags (Y1, 1Y1) switch the valves, other names are internal memories (M1). Names are case-insensitive. Rungs run top to bottom each scan; a coil written in two rungs is a double coil (warning). drive: true when the PLC energises the solenoids. With the simulation running: scan count, true bits, timers, counters. problems: compile and name errors (an erroneous program does not run).',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run() { const Pn = pneu(); return { plc: Pn.plc(), state: Pn.plcState(), problems: Pn.check().filter(i => /^Automate/.test(i.text)).map(i => `${i.level}: ${i.text}`) }; }
    },
    {
      name: 'plc_set',
      description: 'Replace the PLC Ladder program of the pneumatic circuit (same format as plc_get; undoable; ids are optional). Example self-holding cylinder, Y1 = (dcy + Y1) . /a1: {"inputs":[{"name":"dcy","kind":"push"}],"rungs":[{"comment":"Y1 holds until a1","items":[{"t":"par","branches":[[{"t":"no","v":"dcy"}],[{"t":"no","v":"Y1"}]]},{"t":"nc","v":"a1"},{"t":"coil","v":"Y1"}]}]}. Give null rungs to remove the program. Returns the problems found: fix every error, the PLC does not run with errors.',
      inputSchema: { type: 'object', properties: { rungs: { type: ['array', 'null'] }, inputs: { type: 'array' }, drive: { type: 'boolean' }, name: { type: 'string' }, cycle: { type: 'number' } }, required: ['rungs'] },
      run({ rungs, inputs, drive, name, cycle }) {
        const Pn = pneu();
        if (!rungs) { Pn.setPlc(null); return { plc: null }; }
        const cur = Pn.plc() || { inputs: [{ name: 'dcy', kind: 'push' }], drive: true, cycle: 10, name: 'API1' };
        Pn.setPlc({ name: name || cur.name, drive: drive ?? cur.drive ?? true, cycle: cycle ?? cur.cycle, inputs: inputs || cur.inputs, rungs });
        Pn.openPlc(); Pn.refresh();
        return { plc: Pn.plc(), problems: Pn.check().filter(i => /^Automate/.test(i.text)).map(i => `${i.level}: ${i.text}`) };
      }
    },
    {
      name: 'plc_from_grafcet',
      description: 'Write the PLC Ladder program from the GRAFCET of the pneumatic circuit, the way it is taught: one internal bit per step (X0, X1…), one rung per transition (upstream step contacts and receptivity → SET downstream steps, RESET upstream steps), a TON timer for each "5s/X2" delay, a P contact for each rising edge, one rung per action (steps that emit it in parallel → coil), INIT sets the initial steps. The GRAFCET then only observes (drive false): the PLC energises the solenoids. Refused with a reason for macro-steps, enclosing steps, partial GRAFCETs, forcing orders and counters. Replaces the current PLC program (undoable).',
      inputSchema: { type: 'object', properties: {} },
      annotations: { destructiveHint: true },
      run() { const Pn = pneu(), r = Pn.plcFromGrafcet(); if (r.error) fail(r.error); Pn.openPlc(); Pn.refresh(); return { rungs: r.rungs, notes: r.notes, plc: Pn.plc(), problems: Pn.check().filter(i => /^Automate/.test(i.text)).map(i => `${i.level}: ${i.text}`) }; }
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
      description: 'During the simulation, hold or release the push button of a pneumatic valve (act/left/right "push"): {"id":"e3","pressed":true}, or a button of the GRAFCET or PLC operator panel by its name ({"id":"dcy","pressed":true}). An action of the 3D machine process (see pneumatic_get.machine.actions: car, bottle, refill) is triggered with {"id":"car","pressed":true}. side "right" is the button on the 12 side of a 5/2 or 5/3 valve whose right is "push"; the default is the 14 side (or the only button of a 3/2).',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, pressed: { type: 'boolean' }, side: { type: 'string', enum: ['left', 'right'] } }, required: ['id', 'pressed'] },
      run({ id, pressed, side }) {
        const Pn = pneu(); if (!H.simOn()) fail('start the simulation first (simulate)');
        const e = Pn.editor.circuit().elements.find(x => x.id === id);
        if (!e && Pn.isGrafcetInput(id)) { Pn.press(id, !!pressed); Pn.refresh(); return { input: id, pressed: !!pressed }; }
        if (!e && Pn.actLabel && Pn.actLabel(id)) { if (pressed !== false) Pn.act(id); return { action: id, label: Pn.actLabel(id), done: pressed !== false }; } // action du procédé de la machine 3D (une voiture, une bouteille, remplir)
        if (!e) fail(`no element or GRAFCET input "${id}"`);
        if (side === 'right' && !(e.type === 'v52' || e.type === 'v53')) fail('only a 5/2 or 5/3 valve has a right-side button');
        Pn.press(side === 'right' ? `${id}:R` : id, !!pressed); Pn.refresh();
        return { id, side: side === 'right' ? 'right' : 'left', pressed: !!pressed };
      }
    },
    {
      name: 'machine_get',
      description: 'The 3D machine built from components (digital twin, circuit.scene of kind "twin"): its parts with position (m, Y up, floor at y = 0), rotation (° about Y), size, settings, bindings and parent, plus the problems found (unbound mover, duplicate signal…) and the component catalog. Components: ' + Object.entries(TWIN).map(([t, K]) => `${t} (${K.cat}; settings ${JSON.stringify(K.props)}; bindings ${K.bind.join('/') || 'none'}${K.sizable ? '; sizable' : ''}${K.mover ? '; moves with a cylinder' : ''})`).join('; ') + '. Choices: ' + JSON.stringify(TWIN_ENUMS) + '. Bindings: cyl = label or id of a circuit cylinder (the part follows its 0…1 position), out = output name read by the part (conveyor, lamp, gripper, dispenser; written by a GRAFCET action, a PLC coil or a bench coil24), signal = sensor name produced for the GRAFCET/PLC (IEC 61131-3 identifier), input = input pressed by a button. parent = id of a moving part that carries this one. Templates: ' + Object.keys(TWIN_TEMPLATES).join(', ') + '.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run() { const Pn = pneu(), s = Pn.scene(); return { scene: s && s.kind === 'twin' ? { ...s, assets: s.assets ? Object.keys(s.assets) : undefined } : null, kind: s ? s.kind : null, problems: Pn.sceneProblems ? Pn.sceneProblems().map(p => `${p.level}: ${p.text}`) : [], templates: Object.keys(TWIN_TEMPLATES) };
      }
    },
    {
      name: 'machine_set',
      description: 'Replace the 3D machine (undoable) with a scene of kind "twin": {"scene": {"name": "…", "parts": [{"id": "conv1", "type": "conveyor", "pos": [0, 0.8, 0], "rot": 0, "size": [2, 0.1, 0.4], "props": {"speed": 0.25}, "bind": {"out": "KM1"}}, …]}} (see machine_get for components, settings and bindings; unknown or out-of-range values are cleaned), or a template: {"template": "sorter"}. The 3D view opens on the machine; its sensors are then read by the GRAFCET and the PLC by name, its moving parts follow the bound cylinders, its outputs are driven by the program. Returns the cleaned scene and its problems.',
      inputSchema: { type: 'object', properties: { scene: { type: 'object' }, template: { type: 'string', enum: Object.keys(TWIN_TEMPLATES) } } },
      run({ scene, template }) {
        const Pn = pneu(); if (!scene && !template) fail('give a scene or a template');
        const cur = Pn.scene();
        const s = template ? TWIN_TEMPLATES[template].scene() : { kind: 'twin', ...scene, assets: (scene && scene.assets) || (cur && cur.kind === 'twin' ? cur.assets : undefined) };
        Pn.setScene(s); Pn.refresh();
        const out = Pn.scene();
        return { scene: { ...out, assets: out.assets ? Object.keys(out.assets) : undefined }, problems: Pn.sceneProblems ? Pn.sceneProblems().map(p => `${p.level}: ${p.text}`) : [] };
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
      description: '"network" (network cabling only: PCs, switches, box, RJ45 cables, IP addresses; tools net_*), "iot" (a board with a W5500 Ethernet module or Wi-Fi, plus the network workspace), Start an empty project of a given kind: "electronics" (a board, sensors, a program; default), "analog" (no board: passives, NE555, op-amps, scope), "pneumatic" (compressed air only, no bench), "electropneumatic" (a board drives a pneumatic circuit: both workspaces), "logic" (gates, flip-flops). The kind decides which workspaces the user sees; it widens by itself when you add parts of another workspace. If the current circuit is not empty, the user is asked to confirm in Jollof Studio.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['electronics', 'analog', 'pneumatic', 'electropneumatic', 'logic', 'network', 'iot'] } } },
      annotations: { destructiveHint: true },
      async run({ name, kind }) {
        if (comps().length && !(await H.confirmReplace(H.projectTitle()))) fail('the user kept the current project');
        await H.newProject({ electronics: 'elec', analog: 'analog', pneumatic: 'pneu', electropneumatic: 'epneu', logic: 'logic', network: 'net', iot: 'iot' }[kind] || 'elec'); if (name) H.setProjectName(String(name).slice(0, 80));
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
    /* ---------- Plan réseau (src/net) : projets Réseau et Objets connectés ---------- */
    {
      name: 'net_get',
      description: 'The network workspace (project kinds "net" and "iot"): devices [{ id, name, type, ip, ip_source, powered, ports }], cables [{ id, a: "NAME.port", b, category, length_m, kind: straight|crossover|fault|none (not crimped), faults }], links up with their speed, and network problems (codes J1201–J1216). Device types: pc, laptop, printer, nas, switch, poeswitch, router (box with DHCP and optional Wi-Fi), ap (Wi-Fi access point, PoE), camera and phone (PoE devices), outlet (wall RJ45: ports front/back), patch (patch panel: f1..f12 front, b1..b12 back), broker (MQTT server, port 1883), plc (Modbus TCP PLC, port 502). In an iot project the bench W5500/ENC28J60 modules appear as nodes "e:<part id>" with port "eth".',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      async run() { const W = await netWs(); return netSummary(W); }
    },
    {
      name: 'net_add',
      description: 'Place a network device (see net_get for the types). Optional name, position x/y (workspace units, about 1 unit = 1 px at 100 %) and settings (same keys as net_set). Returns its id. Undoable.',
      inputSchema: { type: 'object', properties: { type: { type: 'string' }, name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, settings: { type: 'object' } }, required: ['type'] },
      async run({ type, name, x, y, settings }) {
        const W = await netWs();
        if (!NETDEV[type]) fail(`unknown device type "${type}". Types: ${Object.keys(NETDEV).join(', ')}`);
        const d = W.place(type, x ?? 0, y ?? 0);
        if (name) d.name = String(name).slice(0, 24);
        if (settings) applyNetSettings(W, d, settings);
        W.commit();
        return { id: d.id, name: d.name, ports: netPorts(d).map(p => p.id) };
      }
    },
    {
      name: 'net_cable',
      description: 'Lay a cable between two device ports, written "NAME.port" (e.g. "PC1.eth0", "SW1.p3", "BOX1.lan1", "PB1.f1", "PR1.back", "W5500_1.eth" for a bench module). kind: "straight" (T568B both ends, default), "crossover" (T568A–T568B) or "blank" (ends to crimp with net_crimp). category: cat5e | cat6 | cat6a; length_m (default 3). Each port takes one cable. Undoable.',
      inputSchema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' }, kind: { type: 'string', enum: ['straight', 'crossover', 'blank'] }, category: { type: 'string', enum: ['cat5e', 'cat6', 'cat6a'] }, length_m: { type: 'number' } }, required: ['a', 'b'] },
      async run({ a, b, kind, category, length_m }) {
        const W = await netWs(), pa = netPort(W, a), pb = netPort(W, b), data = W.data();
        const used = p => data.cables.some(c => (c.a[0] === p[0] && c.a[1] === p[1]) || (c.b[0] === p[0] && c.b[1] === p[1]));
        if (used(pa)) fail(`${a} already has a cable`); if (used(pb)) fail(`${b} already has a cable`);
        let id = 'c1', i = 1; while (data.cables.some(c => c.id === id)) id = 'c' + ++i;
        data.cables.push({ id, a: pa, b: pb, cat: category || 'cat6', len: Math.max(0.1, Math.min(500, +length_m || 3)), wire: makeCable(kind || 'straight') });
        W.commit();
        const l = W.lan().port(pa[0], pa[1]);
        return { cable: id, link: l ? { up: l.up, speed_mbps: l.speed, why: l.why } : null };
      }
    },
    {
      name: 'net_crimp',
      description: 'Crimp one end ("a" or "b", the order of net_cable) of a cable: either standard "T568A" / "T568B", or order: 8 conductor colours from pin 1 to pin 8, among wo (white-orange), o, wg (white-green), g, wbl (white-blue), bl, wbr (white-brown), br; null for an empty slot (open). Mistakes are allowed and simulated. Returns the cable test result.',
      inputSchema: { type: 'object', properties: { cable: { type: 'string' }, end: { type: 'string', enum: ['a', 'b'] }, standard: { type: 'string', enum: ['T568A', 'T568B'] }, order: { type: 'array' } }, required: ['cable', 'end'] },
      async run({ cable, end, standard, order }) {
        const W = await netWs(), c = W.data().cables.find(x => x.id === cable); if (!c) fail(`no cable "${cable}" (see net_get)`);
        const o = standard ? STD[standard.slice(-1)] : order; if (!Array.isArray(o) || o.length !== 8) fail('give standard "T568A"/"T568B" or order: 8 colours');
        c.wire[end === 'b' ? 'b' : 'a'] = cleanEnd({ order: o, crimped: true, shorts: [] });
        W.commit();
        return examOf(W) ? cableInfo(c, true) : { test: testerSummary([c.wire]), ...cableInfo(c) };
      }
    },
    {
      name: 'net_set',
      description: 'Change the settings of a network device. Keys by type: name; hosts (pc, laptop, printer, nas, camera, phone, broker, plc): ip {mode:"dhcp"|"static", ip, prefix (24 or "255.255.255.0"), gw}, legacy (true: 100 Mb/s and no Auto-MDIX); laptop: wifi {ssid, pass}; router: lan {ip, prefix}, dhcp {on, from, to}, wan {mode:"none"|"dhcp"|"static", ip, prefix, gw}, wifi {on, ssid, pass}; ap: ssid, pass, power ("poe"|"adapter"); camera/phone/ap: poeClass 0–8, power; poeswitch: budget (W), pseType af|at|bt3|bt4; cable: category, length_m (give "cable" instead of "device"). Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, cable: { type: 'string' }, settings: { type: 'object' } }, required: ['settings'] },
      async run({ device, cable, settings }) {
        const W = await netWs();
        if (cable) {
          const c = W.data().cables.find(x => x.id === cable); if (!c) fail(`no cable "${cable}"`);
          if (settings.category) { if (!['cat5e', 'cat6', 'cat6a'].includes(settings.category)) fail('category: cat5e, cat6 or cat6a'); c.cat = settings.category; }
          if (settings.length_m != null) c.len = Math.max(0.1, Math.min(500, +settings.length_m || c.len));
          W.commit(); return cableInfo(c, examOf(W));
        }
        const d = netDev(W, device); applyNetSettings(W, d, settings); W.commit();
        return netSummary(W).devices.find(x => x.id === d.id);
      }
    },
    {
      name: 'net_remove',
      description: 'Remove a network device (and its cables) or a cable. Undoable.',
      inputSchema: { type: 'object', properties: { device: { type: 'string' }, cable: { type: 'string' } } },
      async run({ device, cable }) {
        const W = await netWs(), data = W.data();
        if (cable) { const n = data.cables.length; data.cables = data.cables.filter(c => c.id !== cable); if (n === data.cables.length) fail(`no cable "${cable}"`); }
        else { const d = netDev(W, device); data.devices = data.devices.filter(x => x !== d); data.cables = data.cables.filter(c => c.a[0] !== d.id && c.b[0] !== d.id); }
        W.commit(); return { devices: data.devices.length, cables: data.cables.length };
      }
    },
    {
      name: 'net_ping',
      description: 'Ping from a device (name) to an address or a device name. Returns ok, the address, time, the devices crossed, or why it fails (no link, no IP address, other subnet without gateway, gateway outside the subnet, broadcast storm, split pair errors…). Learns the switches MAC tables like a real ping.',
      inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      annotations: { readOnlyHint: true },
      async run({ from, to }) { const W = await netWs(), d = netNode(W, from), r = W.ping(d.id, to); return { ok: r.ok, ip: r.ip, ms: r.ms ?? null, reason: r.ok ? null : whyText(r.why), crossed: (r.hops || []).map(h => netName(W, h.node)) }; }
    },
    {
      name: 'net_test_cable',
      description: 'Pass a cable (or the whole channel from a port "NAME.port", through wall outlets and patch panels) to the cable tester: wire map pin by pin (which far pins light for each near pin), kind (straight, crossover) and faults (open, short, reversed pair, crossed pairs, split pair).',
      inputSchema: { type: 'object', properties: { cable: { type: 'string' }, port: { type: 'string' } } },
      annotations: { readOnlyHint: true },
      async run({ cable, port }) {
        const W = await netWs();
        let segs;
        if (port) { const p = netPort(W, port), ch = W.lan().channel(p[0], p[1]); if (!ch || !ch.segs.length) fail(`no cable on ${port}`); segs = ch.segs; }
        else { const c = W.data().cables.find(x => x.id === cable); if (!c) fail(`no cable "${cable}"`); segs = [c.wire]; }
        const r = analyzeChain(segs);
        if (examOf(W)) return { exam: true, wire_map: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(p => [p, r.leds[p]])) };
        return { result: testerSummary(segs), kind: r.kind, faults: r.faults, wire_map: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(p => [p, r.leds[p]])) };
      }
    },
    {
      name: 'net_check',
      description: 'The network checker problems (codes J1201–J1216, the same ones as the Problems panel): miswired cables, split pairs, channel over 100 m, category too low, PoE budget, switch loops, two DHCP servers, duplicate IP, wrong subnet or gateway, unconnected devices.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      async run() { const W = await netWs(); return { problems: shownIssues(W, netIssues(W.lan(), W.data())).map(i => ({ code: i.code, level: i.kind === 'err' ? 'error' : 'warning', text: i.text, where: i.id ? netName(W, i.id) : null })) }; }
    },
    {
      name: 'net_browse',
      description: 'Open an http:// address from a PC or laptop of the network (its browser): returns the HTTP code and the page text. Board web servers answer only while the simulation runs.',
      inputSchema: { type: 'object', properties: { from: { type: 'string' }, url: { type: 'string' } }, required: ['from', 'url'] },
      annotations: { readOnlyHint: true },
      async run({ from, url }) { const W = await netWs(), d = netNode(W, from), r = await W.lan().http(d.id, url); return { code: r.code, type: r.type || null, body: String(r.body || '').slice(0, 4000), reason: r.code ? null : whyText(r.why) }; }
    },
    {
      name: 'mqtt_publish',
      description: 'Publish a message on a topic of a « Serveur MQTT » device of the network (like the publish form of its panel), and return the topics it has seen with their last message.',
      inputSchema: { type: 'object', properties: { broker: { type: 'string' }, topic: { type: 'string' }, message: { type: 'string' } }, required: ['topic', 'message'] },
      async run({ broker, topic, message }) {
        const W = await netWs(), d = broker ? netDev(W, broker) : W.data().devices.find(x => x.type === 'broker');
        if (!d) fail('no MQTT server device: add one with net_add type "broker"');
        const b = W.lan().broker(d.id); if (!b) fail('the MQTT server is not running');
        b.publish(String(topic), String(message)); return { topics: b.topics().map(t => ({ topic: t.topic, last: t.text, from: t.from })) };
      }
    },
    {
      name: 'undo',
      description: 'Undo the last change (like Ctrl+Z).',
      inputSchema: { type: 'object', properties: {} },
      async run() { await H.undo(); return { parts: comps().length, wires: H.wires().length }; }
    }
  ];
  const kind = () => (H.kind ? H.kind() : 'elec');
  const out = tools.map(t => ({ ...t, title: t.title || t.name.replace(/_/g, ' '), ...(BENCH_TOOLS.has(t.name) ? { run: a => { if (!toolFits(t.name, kind())) fail(benchRefusal(t.name)); return t.run(a); } } : {}) }));
  /** Outil montré à l'assistant pour le projet en cours (tools/list) : pas d'outil du montage dans un projet réseau seul. */
  out.visible = t => toolFits(t.name, kind());
  /**
   * Outils de la conception réseau professionnelle (tools-net-*.js : plans, baies, VLAN, fibre, Wi-Fi, conception,
   * certification) : chargés à la première demande de la liste ou d'un appel (mcp.js), pas au démarrage. Rend la liste
   * à ajouter.
   */
  out.lazy = () => import('./tools-net.js').then(m => m.netProTools({ netWs, netNode, netDev, netPort, netName, fail, norm }).map(t => ({ ...t, title: t.title || t.name.replace(/_/g, ' ') })));
  return out;
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
