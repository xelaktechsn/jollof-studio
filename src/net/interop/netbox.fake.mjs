// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Faux serveur NetBox en mémoire pour les tests (pont de même forme que celui de Rust : status, get, write) : écrit
// d'après la documentation publique de l'API (listes paginées rendues en entier, écritures groupées « tout ou rien »,
// choix rendus en { value, label }, objets liés rendus imbriqués, champ personnalisé inconnu refusé en 400). Ce n'est
// pas NetBox : seuls les filtres et contrôles utilisés par la synchronisation sont imités.
const FK = {
  location: { site: 'site', parent: 'location' }, rack: { site: 'site', location: 'location' }, dtype: { manufacturer: 'manufacturer' },
  vlan: { site: 'site' }, prefix: { vlan: 'vlan', site: 'site' }, device: { device_type: 'dtype', role: 'role', site: 'site', location: 'location', rack: 'rack' },
  rearport: { device: 'device' }, frontport: { device: 'device', rear_port: 'rearport' }, interface: { device: 'device', untagged_vlan: 'vlan', parent: 'interface' }
};
const CHOICE = new Set(['status', 'type', 'mode', 'face', 'form_factor', 'outer_unit', 'length_unit', 'width']);
const EP = {
  '/api/dcim/sites/': 'site', '/api/dcim/locations/': 'location', '/api/dcim/manufacturers/': 'manufacturer', '/api/dcim/device-roles/': 'role', '/api/dcim/device-types/': 'dtype',
  '/api/dcim/racks/': 'rack', '/api/ipam/vlans/': 'vlan', '/api/ipam/prefixes/': 'prefix', '/api/dcim/devices/': 'device', '/api/dcim/rear-ports/': 'rearport',
  '/api/dcim/front-ports/': 'frontport', '/api/dcim/interfaces/': 'interface', '/api/dcim/cables/': 'cable', '/api/ipam/ip-addresses/': 'ip',
  '/api/extras/tags/': 'tag', '/api/extras/custom-fields/': 'cf'
};
const REQUIRED = { site: ['name', 'slug'], location: ['name', 'slug', 'site'], manufacturer: ['name', 'slug'], role: ['name', 'slug'], dtype: ['manufacturer', 'model', 'slug'], rack: ['name', 'site'], vlan: ['vid', 'name'], prefix: ['prefix'], device: ['device_type', 'role', 'site'], rearport: ['device', 'name', 'type'], frontport: ['device', 'name', 'type'], interface: ['device', 'name', 'type'], ip: ['address'] };
const err = (status, body, kind = status === 400 ? 'invalid' : status === 403 ? 'auth' : 'server') => { const e = new Error(`HTTP ${status}`); e.status = status; e.kind = kind; e.fields = Array.isArray(body) ? body.flatMap((b, index) => Object.entries(b).map(([field, m]) => ({ field, msg: [].concat(m)[0], index }))) : typeof body === 'object' ? Object.entries(body).map(([field, m]) => ({ field, msg: [].concat(m)[0] })) : []; e.body = body; return e; };

/** o : { version: '4.5.2', deny: Set(['cf', 'tag']) (droits refusés), calls (journal) }. */
export function fakeNetbox(o = {}) {
  const db = Object.fromEntries(Object.values(EP).map(k => [k, new Map()]));
  let next = 1; const calls = [];
  const version = o.version || '4.5.2', frontList = !/^4\.[0-4]\./.test(version);
  const ref = (k, id) => { const x = db[k].get(id); return x ? { id, display: x.name || x.model || String(id), name: x.name, slug: x.slug, model: x.model, ...(k === 'dtype' ? { manufacturer: ref('manufacturer', idOf(x.manufacturer)) } : {}) } : { id }; };
  const idOf = v => (v && typeof v === 'object' ? v.id : v);
  const show = (kind, x) => {
    const out = { ...x };
    for (const [f, k] of Object.entries(FK[kind] || {})) if (x[f] != null) out[f] = ref(k, x[f]);
    if (kind === 'interface') out.tagged_vlans = (x.tagged_vlans || []).map(v => ref('vlan', v));
    if (kind === 'frontport' && frontList) out.rear_ports = (x.rear_ports || []).map(m => ({ ...m }));
    for (const c of CHOICE) if (out[c] != null && out[c] !== '') out[c] = { value: out[c], label: String(out[c]) };
    out.tags = (x.tags || []).map(t => ({ id: t, slug: db.tag.get(t) && db.tag.get(t).slug }));
    out.display = x.name || x.address || x.prefix || x.label || String(x.id);
    return out;
  };
  const siteOf = (kind, x) => {
    if (!x) return null;
    if (kind === 'device' || kind === 'location' || kind === 'rack' || kind === 'vlan') return x.site;
    if (kind === 'prefix') return x.scope_id ?? x.site;
    if (kind === 'interface' || kind === 'frontport' || kind === 'rearport') return siteOf('device', db.device.get(x.device));
    if (kind === 'cable') { const t = (x.a_terminations || [])[0]; if (!t) return null; const k = { 'dcim.interface': 'interface', 'dcim.frontport': 'frontport', 'dcim.rearport': 'rearport' }[t.object_type]; return siteOf(k, db[k].get(t.object_id)); }
    return null;
  };
  const devOf = (kind, x) => (kind === 'ip' ? (x.assigned_object_id != null ? (db.interface.get(x.assigned_object_id) || {}).device : null) : x.device);
  const validate = (kind, b, isNew) => {
    const e = {};
    if (isNew) for (const f of REQUIRED[kind] || []) if (b[f] == null || b[f] === '') e[f] = ['This field is required.'];
    if (b.custom_fields) for (const k of Object.keys(b.custom_fields)) { const cf = [...db.cf.values()].find(c => c.name === k); if (!cf) e.custom_fields = [`Unknown field name '${k}' in custom field data.`]; }
    if (kind === 'vlan' && b.vid != null && (b.vid < 1 || b.vid > 4094)) e.vid = ['Ensure this value is less than or equal to 4094.'];
    if (kind === 'frontport') { if (frontList && 'rear_port' in b) e.rear_port = ['Unknown field.']; if (!frontList && 'rear_ports' in b) e.rear_ports = ['Unknown field.']; }
    if (kind === 'interface' && b.mode === 'access' && (b.tagged_vlans || []).length) e.tagged_vlans = ['Tagged VLANs cannot be assigned in access mode.'];
    if (o.reject && o.reject(kind, b)) e.name = ['Rejected by test.'];
    for (const [f, k] of Object.entries(FK[kind] || {})) if (b[f] != null && !db[k].has(b[f])) e[f] = [`Related object not found using the provided numeric ID: ${b[f]}`];
    return Object.keys(e).length ? e : null;
  };
  const dup = (kind, b, self) => {
    const all = [...db[kind].values()].filter(x => x.id !== self);
    if (['site', 'manufacturer', 'role', 'dtype', 'tag'].includes(kind) && all.some(x => x.slug === b.slug)) return { slug: [`${kind} with this slug already exists.`] };
    if (kind === 'device' && b.name && all.some(x => x.site === b.site && x.name === b.name)) return { name: ['Device name must be unique per site.'] };
    if (['interface', 'frontport', 'rearport'].includes(kind) && all.some(x => x.device === b.device && x.name === b.name)) return { name: ['Name must be unique per device.'] };
    return null;
  };
  function create(kind, b) {
    if (o.deny && o.deny.has(kind)) throw err(403, { detail: 'You do not have permission to perform this action.' });
    const e = validate(kind, b, true) || dup(kind, b); if (e) return { e };
    const x = { ...b, id: next++ };
    if (kind === 'frontport' && !frontList && b.rear_port != null) { x.rear_port = b.rear_port; }
    return { x };
  }
  const api = {
    db, calls,
    async status() { return { version, full: version, plugins: 0, workers: 1, tls: true }; },
    async get(path, query = []) {
      calls.push(['GET', path, query]);
      const kind = EP[path]; if (!kind) throw err(404, { detail: 'Not found.' }, 'notfound');
      const by = {}; for (const [k, v] of query) (by[k] = by[k] || []).push(v);
      let list = [...db[kind].values()];
      const f = (k, fn) => { if (by[k]) list = list.filter(x => by[k].some(v => fn(x, v))); };
      f('id', (x, v) => x.id === +v); f('slug', (x, v) => x.slug === v); f('name', (x, v) => x.name === v);
      f('site_id', (x, v) => siteOf(kind, x) === +v); f('device_id', (x, v) => devOf(kind, x) === +v);
      return { count: list.length, next: null, results: list.map(x => show(kind, x)) };
    },
    async write(method, path, body) {
      calls.push([method, path, body]);
      const m = /^(\/api\/[a-z-]+\/[a-z-]+\/)(\d+\/)?$/.exec(path); if (!m) throw err(404, { detail: 'Not found.' }, 'notfound');
      const kind = EP[m[1]], one = m[2] ? +m[2] : null; if (!kind) throw err(404, { detail: 'Not found.' }, 'notfound');
      const items = one != null ? [{ ...body, id: one }] : Array.isArray(body) ? body : [body];
      if (method === 'POST') {
        const made = [], errs = []; let bad = false;
        for (const b of items) { const r = create(kind, b); if (r.e) { bad = true; errs.push(r.e); } else { errs.push({}); made.push(r.x); } }
        if (bad) throw err(400, Array.isArray(body) ? errs : errs[0]);
        for (const x of made) db[kind].set(x.id, x);
        const out = made.map(x => show(kind, x));
        return Array.isArray(body) ? out : out[0];
      }
      if (method === 'PATCH') {
        if (o.deny && o.deny.has(kind)) throw err(403, { detail: 'You do not have permission to perform this action.' });
        const errs = []; let bad = false;
        for (const b of items) { const x = db[kind].get(b.id); const e = !x ? { id: ['Not found.'] } : validate(kind, b, false) || dup(kind, { ...x, ...b }, b.id); errs.push(e || {}); if (e) bad = true; }
        if (bad) throw err(400, Array.isArray(body) ? errs : errs[0]);
        const out = items.map(b => { const x = { ...db[kind].get(b.id), ...b }; db[kind].set(b.id, x); return show(kind, x); });
        return Array.isArray(body) && one == null ? out : out[0];
      }
      if (method === 'DELETE') { for (const b of items) db[kind].delete(b.id); return null; }
      throw err(405, { detail: 'Method not allowed.' });
    },
    /** Ajoute un objet comme le ferait un utilisateur (sans passer par la synchronisation). */
    seed(kind, b) { const x = { ...b, id: next++ }; db[kind].set(x.id, x); return x.id; }
  };
  return api;
}
