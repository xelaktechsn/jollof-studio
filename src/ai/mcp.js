// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Serveur MCP (Model Context Protocol) de Jollof Studio, côté fenêtre : reçoit un message JSON-RPC 2.0 transmis par
// le pont Rust (src-tauri/src/ai.rs) et rend la réponse. Méthodes : initialize, ping, tools/list, tools/call ; les
// notifications ne reçoivent pas de réponse. Chaque message porte sa session (sid) : initialize n'ouvre la session
// qu'avec l'accord de l'utilisateur (approve), et rien d'autre ne passe hors d'une session acceptée. Les outils
// s'exécutent un par un, dans l'ordre d'arrivée (deux assistants ne modifient jamais le montage en même temps).
import { ToolError } from './tools.js';

export const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const INSTRUCTIONS = [
  'Jollof Studio is an electronics workbench: Arduino/ESP32/Pico boards, sensors, displays, motors on a 3D bench, with a circuit checker and a simulator.',
  'Typical flow: get_project → list_parts → add_part (board first, then modules) → auto_wire → check_circuit (fix until 0 errors and 0 warnings) → program it (add_rule for simple behaviours, or set_program with Arduino C++ and fix compile errors) → simulate → set_environment / set_part_input → read_simulation → screenshot.',
  'Pins are written PART.PIN (e.g. "LED1.A", "UNO.D13"); positions are in mm. Use get_part to learn pins, signals and actions of a type. A new kind of part can be created with create_part (read part_format first; search list_parts before: the standard library may already have it). Created parts go to the "My components" category of the user library.',
  'Pneumatics: the Pneumatic workspace holds valves, cylinders, flow controls and pressure switches (pneumatic_get, pneumatic_add, pneumatic_connect, pneumatic_set, pneumatic_press). Sequences: roller valves (v32 act "roller", cam = cylinder label, end "1"/"0") chain the strokes; a GRAFCET (grafcet_get, grafcet_set) can drive the solenoids like a PLC; the observed cycle (A+ B+ …) is in pneumatic_get state. It runs in the same simulation as the boards: a coil24 part on the bench named Y1 switches the valve whose coil tag is Y1; cylsensor parts (B1…) and pressostat parts (S1…) close when the cylinder or pressure switch with that tag says so.',
  'Electropneumatic project (a board drives a pneumatic machine), in this order: 0) new_project with kind "electropneumatic" (kind "pneumatic" for air-only circuits: the bench is then neither shown nor simulated); 1) add_part a board (uno) and a button; 2) pneumatic_add a supply, a valve with a solenoid tag (v52 left "sol", right "spring", coilL "Y1") and a cylinder (cyl2 label "1A", s0 "B1", s1 "B2"), then pneumatic_connect the tubes (supply:1 → valve:1, valve:4 → cylinder:1, valve:2 → cylinder:2); 3) pneumatic_link_bench adds and wires coil24 Y1 and cylsensor B1, B2 (same names as the tags); auto_wire the button; 4) grafcet_set the sequence with bench names (step 0 init r "BTN1 . B1"; step 1 act "Y1" r "B2"), then grafcet_program writes the board program from it; 5) check_circuit until it reports no errors (pneumatic problems included), simulate, set_part_input BTN1 pressed, wait, then pneumatic_get: state.cycle should read "1A+ 1A-". While simulating, the user sees the bench and the pneumatic circuit side by side (split view) with every tag and its board pin.',
  'Every change can be undone by the user (Ctrl+Z) or with undo. Replacing the project (new_project, open_example) asks the user to confirm in the app.'
].join('\n');

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** Vérification légère des arguments d'après inputSchema : champs obligatoires et types simples. */
function checkArgs(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  for (const k of schema.required || []) if (args[k] === undefined || args[k] === null || args[k] === '') return `missing argument "${k}"`;
  for (const [k, v] of Object.entries(args)) {
    const s = schema.properties && schema.properties[k];
    if (!s || v === undefined || v === null || !s.type) continue;
    const t = Array.isArray(v) ? 'array' : typeof v;
    if (s.type === 'number' && t !== 'number' && !(t === 'string' && v.trim() !== '' && Number.isFinite(+v))) return `"${k}" must be a number`;
    if (s.type === 'string' && t !== 'string' && t !== 'number') return `"${k}" must be a string`;
    if (s.type === 'boolean' && t !== 'boolean') return `"${k}" must be true or false`;
    if (s.type === 'object' && t !== 'object') return `"${k}" must be an object`;
    if (s.type === 'array' && t !== 'array') return `"${k}" must be an array`;
  }
  return null;
}
/** Nombres écrits en texte (« 120 ») rendus nombres, pour les champs déclarés number. */
function coerce(schema, args) {
  const out = { ...args };
  for (const [k, s] of Object.entries(schema.properties || {})) if (s.type === 'number' && typeof out[k] === 'string') out[k] = +out[k];
  return out;
}
/** Résultat d'un outil → contenu MCP : une image (capture) ou du JSON lisible. */
function content(out) {
  if (out && typeof out === 'object' && typeof out.image === 'string') {
    return { content: [{ type: 'image', data: out.image, mimeType: out.mimeType || 'image/png' }, ...(out.text ? [{ type: 'text', text: out.text }] : [])] };
  }
  return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }] };
}

/** Clé d'un assistant : son identifiant MCP (clientInfo.name), le même pour toutes ses connexions. */
export const clientKey = c => String((c && c.name) || 'unknown');

/**
 * tools : outils de createTools() ; info : { name, title, version } ; approve(client, { silent }) → accord de
 * l'utilisateur (promesse de booléen) pour un assistant qui ouvre une session ; silent : initialisation rejouée par
 * le relais (ne doit jamais afficher de demande) ; onCall(nom, arguments, résultat, erreur, client) : appelé après
 * chaque outil (journal du panneau, voyant d'activité).
 */
export function createMcp({ tools, info, instructions = INSTRUCTIONS, onCall, approve = async () => false }) {
  let queue = Promise.resolve(), client = null;
  const sessions = new Map(); // sid → { client, seen } (seen : dernier message reçu, pour repérer les relais arrêtés)
  // Un assistant qui ouvre plusieurs connexions à la fois (Claude Desktop : conversation, Cowork, Code) : une seule
  // demande, que toutes attendent.
  const asking = new Map();
  function approveOnce(who, silent) {
    const key = clientKey(who);
    if (!asking.has(key)) asking.set(key, Promise.resolve(approve(who, { silent })).catch(() => false).finally(() => asking.delete(key)));
    return asking.get(key);
  }
  const byName = new Map(tools.map(t => [t.name, t]));
  async function call(name, args) {
    const t = byName.get(name);
    const bad = checkArgs(t.inputSchema || {}, args ?? {});
    if (bad) { if (onCall) onCall(name, args, null, bad, client); return { content: [{ type: 'text', text: `${name}: ${bad}` }], isError: true }; }
    try {
      const out = await t.run(coerce(t.inputSchema || {}, args ?? {}));
      if (onCall) onCall(name, args, out, null, client);
      return content(out);
    } catch (e) {
      const msg = e instanceof ToolError ? e.message : `${name} failed: ${(e && e.message) || e}`;
      if (!(e instanceof ToolError)) console.error(e);
      if (onCall) onCall(name, args, null, msg, client);
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
  }
  const queued = (name, args) => { const run = queue.then(() => call(name, args)); queue = run.catch(() => {}); return run; };
  /**
   * Un message JSON-RPC → sa réponse (null pour une notification ou une réponse du client). sid : session donnée
   * par le pont ; sans sid (appel interne, tests), pas de contrôle d'accord.
   */
  async function handle(msg, sid) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return err(null, -32600, 'Invalid Request');
    const { id, method, params } = msg;
    const notification = id === undefined;
    if (typeof method !== 'string') return notification ? null : err(id ?? null, -32600, 'Invalid Request');
    if (notification) return null; // notifications/initialized, notifications/cancelled…
    if (sid !== undefined && method !== 'initialize' && !sessions.has(sid)) return err(id, -32001, 'session not approved by the user');
    if (sid !== undefined && sessions.has(sid)) { const s = sessions.get(sid); s.seen = Date.now(); client = s.client; }
    switch (method) {
      case 'initialize': {
        const who = (params && params.clientInfo) || { name: 'unknown' };
        if (sid !== undefined) {
          const silent = !!(params && params._meta && params._meta['sn.jollof/silent']);
          if (!(await approveOnce(who, silent))) return err(id, -32001, silent ? 'Not approved yet: the next request will ask the Jollof Studio user.' : 'The Jollof Studio user declined this assistant.');
          sessions.set(sid, { client: who, seen: Date.now() });
        }
        client = who;
        const v = params && PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0];
        return ok(id, { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: info, instructions });
      }
      case 'ping': return ok(id, {});
      case 'tools/list':
        return ok(id, { tools: tools.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, ...(t.annotations ? { annotations: t.annotations } : {}) })) });
      case 'tools/call': {
        const name = params && params.name;
        if (!byName.has(name)) return err(id, -32602, `Unknown tool: ${name}`);
        return ok(id, await queued(name, params.arguments));
      }
      default: return err(id, -32601, `Method not found: ${method}`);
    }
  }
  const drop = test => { const out = []; for (const [sid, s] of sessions) if (test(s)) { sessions.delete(sid); out.push(sid); } return out; };
  return {
    handle, tools, client: () => client,
    /** Sessions acceptées : [{ sid, client, seen }]. */
    sessions: () => [...sessions].map(([sid, s]) => ({ sid, client: s.client, seen: s.seen })),
    /** Assistants connectés, un par assistant quel que soit son nombre de connexions : [{ key, client, count }]. */
    connected() {
      const by = new Map();
      for (const s of sessions.values()) { const k = clientKey(s.client), e = by.get(k); if (e) e.count++; else by.set(k, { key: k, client: s.client, count: 1 }); }
      return [...by.values()];
    },
    /** Sessions sans nouvelles depuis ms (relais arrêté sans prévenir) : retirées ; rend leurs identifiants. */
    prune: (ms, now = Date.now()) => drop(s => now - s.seen > ms),
    /** Toutes les sessions d'un assistant (accès retiré) : retirées ; rend leurs identifiants. */
    endClient: key => drop(s => clientKey(s.client) === key),
    endAll: () => drop(() => true)
  };
}
