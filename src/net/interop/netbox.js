// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Adaptateur NetBox (API REST de NetBox 4.x) du module de synchronisation (dcimsync.js) : points d'accès, objets du
// modèle canonique → corps JSON de l'API, objets de l'API → modèle canonique, lecture du serveur pour un site,
// champ personnalisé « jollof_id » et étiquette « jollof-studio » (idempotence). Pur : le transport est un « pont »
// (Rust : nb_get, nb_write ; un faux serveur dans les tests). Nautobot : un second adaptateur de même forme
// (KINDS, endpoint, parse, payload, cfOf, mine, labelOf, order, components, fetch) suffira — statuts et rôles y sont
// des objets, les lieux ont un type (location types) : rien à changer dans dcimsync.js.
//
// Lu dans la documentation publique de NetBox (versions 4.4 à 4.7, NetBox Labs) et dans son code source publié
// (choix et sérialiseurs, branche main, novembre 2026) ; clés de src/check/sources-net.js, bloc @interop :
//   - netboxRestApi : pagination (count/next/results, limit ≤ MAX_PAGE_SIZE 1000), écritures groupées (liste d'objets,
//     « all-or-none »), PATCH groupé avec « id », objets liés par id, en-têtes d'authentification v1/v2 ;
//   - netboxDcimChoices : CableTypeChoices (cat5e, cat6, cat6a, mmf-om3…, smf-os2), CableLengthUnitChoices (m…),
//     LinkStatusChoices (connected…), InterfaceTypeChoices (1000base-t, 2.5gbase-t, 10gbase-t, 100base-tx,
//     1000base-x-sfp, 10gbase-x-sfpp, virtual), InterfaceModeChoices (access, tagged, tagged-all), PortTypeChoices
//     (8p8c, lc), RackFormFactorChoices (4-post-cabinet, wall-cabinet), RackDimensionUnitChoices (mm, in) ;
//   - netboxCableSerializer : a_terminations / b_terminations = listes de { object_type, object_id } ; object_type
//     « app_label.model » (dcim.interface, dcim.frontport, dcim.rearport) ;
//   - netboxPortMappings : NetBox 4.5 remplace rear_port + rear_port_position d'un port avant par une liste rear_ports
//     de { position, rear_port, rear_port_position } (4.4 et avant : champs plats) ;
//   - netboxPrefixScope : depuis 4.2, la portée d'un préfixe est scope_type + scope_id (avant : site) ;
//   - netboxCustomFields : object_types, type, name, ui_editable.
import { NET } from '../limits.js';
import { KINDS, ourModel, match, diff, applyPush, applyPull } from './dcimsync.js';

export const TAG = { name: 'Jollof Studio', slug: 'jollof-studio', color: '3b82f6' };
export const CF = 'jollof_id';
const EP = {
  site: '/api/dcim/sites/', location: '/api/dcim/locations/', manufacturer: '/api/dcim/manufacturers/', role: '/api/dcim/device-roles/',
  dtype: '/api/dcim/device-types/', rack: '/api/dcim/racks/', vlan: '/api/ipam/vlans/', prefix: '/api/ipam/prefixes/', device: '/api/dcim/devices/',
  rearport: '/api/dcim/rear-ports/', frontport: '/api/dcim/front-ports/', interface: '/api/dcim/interfaces/', cable: '/api/dcim/cables/', ip: '/api/ipam/ip-addresses/'
};
/** Types d'objets (« app_label.model ») qui portent le champ personnalisé jollof_id. */
export const CF_TYPES = { site: 'dcim.site', location: 'dcim.location', rack: 'dcim.rack', device: 'dcim.device', rearport: 'dcim.rearport', frontport: 'dcim.frontport', interface: 'dcim.interface', cable: 'dcim.cable', vlan: 'ipam.vlan', prefix: 'ipam.prefix', ip: 'ipam.ipaddress' };
const TERM = { if: 'dcim.interface', fp: 'dcim.frontport', rp: 'dcim.rearport' };
const TERM_KIND = { 'dcim.interface': 'interface', 'dcim.frontport': 'frontport', 'dcim.rearport': 'rearport' };
/** Plus vieille version prise en charge (rôle « role » des équipements, champ object_types) et versions lues. */
export const MIN_VERSION = NET.NB_VERSIONS.v.min;

/** « 4.5.2-Docker-3.4.1 » → { major, minor, text } (null si illisible). */
export function parseVersion(s) {
  const m = /^v?(\d+)\.(\d+)/.exec(String(s || '').trim()); return m ? { major: +m[1], minor: +m[2], text: String(s).trim() } : null;
}
const atLeast = (v, [a, b]) => !!v && (v.major > a || (v.major === a && v.minor >= b));
/** Capacités d'une version : correspondance des ports avant en liste (4.5+), portée des préfixes (4.2+). */
export function capsOf(version) {
  const v = typeof version === 'string' ? parseVersion(version) : version;
  return { version: v, ok: atLeast(v, MIN_VERSION), frontList: atLeast(v, NET.NB_PORT_MAPPINGS.v.since), scope: atLeast(v, NET.NB_PREFIX_SCOPE.v.since), tested: atLeast(v, NET.NB_VERSIONS.v.read[0]) && !atLeast(v, [NET.NB_VERSIONS.v.read[1][0], NET.NB_VERSIONS.v.read[1][1] + 1]) };
}

const val = x => (x && typeof x === 'object' && !Array.isArray(x) && 'value' in x ? x.value : x);
const idOf = x => (x && typeof x === 'object' ? x.id : x);
const num = x => (x == null || x === '' ? null : Number.isFinite(+x) ? +x : null);
const refKeyOf = v => (v && typeof v === 'object' ? v.$ : null);

/** Adaptateur pour une version donnée (caps : capsOf). */
export function createAdapter(caps = capsOf('4.5')) {
  const A = {
    name: 'netbox', KINDS, caps,
    endpoint: kind => EP[kind],
    cfOf: raw => (raw && raw.custom_fields && typeof raw.custom_fields[CF] === 'string' ? raw.custom_fields[CF] : ''),
    mine: raw => !!(raw && Array.isArray(raw.tags) && raw.tags.some(t => t && (t.slug === TAG.slug || t === TAG.slug))),
    labelOf: (kind, raw) => { const own = String(raw.display || raw.name || raw.address || raw.prefix || raw.label || raw.id); const d = ['interface', 'frontport', 'rearport'].includes(kind) && raw.device && typeof raw.device === 'object' ? raw.device.display || raw.device.name : ''; return d && !own.startsWith(d) ? `${d} ${own}` : own; },
    /** Ordre de lecture : lieux parents d'abord, interfaces physiques avant les virtuelles (parent). */
    order(kind, list) {
      if (kind === 'location') { const dep = new Map(), by = new Map(list.map(l => [l.id, l])); const d = l => { if (dep.has(l.id)) return dep.get(l.id); dep.set(l.id, 0); const p = by.get(idOf(l.parent)); const v = l._depth ?? (p ? d(p) + 1 : 0); dep.set(l.id, v); return v; }; return list.slice().sort((a, b) => d(a) - d(b)); }
      if (kind === 'interface') return list.slice().sort((a, b) => (val(a.type) === 'virtual') - (val(b.type) === 'virtual'));
      return list;
    },
    /** Objet de l'API → champs canoniques (références traduites en clés par refKey(kind, id)). */
    parse(kind, raw, refKey) {
      const ref = (k, id) => (id == null ? null : { $: refKey(k, id) });
      const r = raw;
      switch (kind) {
        case 'site': return { f: { name: r.name, slug: r.slug, status: val(r.status) } };
        case 'location': return { f: { name: r.name, slug: r.slug, parent: ref('location', idOf(r.parent)), site: ref('site', idOf(r.site)), status: val(r.status) } };
        case 'manufacturer': return { f: { name: r.name, slug: r.slug } };
        case 'role': return { f: { name: r.name, slug: r.slug, color: r.color } };
        case 'dtype': return { f: { manufacturer: ref('manufacturer', idOf(r.manufacturer)), model: r.model, slug: r.slug, u_height: num(r.u_height), is_full_depth: r.is_full_depth } };
        case 'rack': return { f: { name: r.name, site: ref('site', idOf(r.site)), location: ref('location', idOf(r.location)), u_height: num(r.u_height), width: num(val(r.width)), form_factor: val(r.form_factor) || null, outer_width: num(r.outer_width), outer_depth: num(r.outer_depth), outer_unit: val(r.outer_unit) || null, status: val(r.status) } };
        case 'vlan': return { f: { vid: num(r.vid), name: r.name, site: ref('site', idOf(r.site)), status: val(r.status) } };
        case 'prefix': return { f: { prefix: r.prefix, vlan: ref('vlan', idOf(r.vlan)), scope: r.scope_type === 'dcim.site' ? ref('site', r.scope_id) : r.site ? ref('site', idOf(r.site)) : null, status: val(r.status), description: r.description || '' } };
        case 'device': return { f: { name: r.name || '', device_type: ref('dtype', idOf(r.device_type)), role: ref('role', idOf(r.role || r.device_role)), site: ref('site', idOf(r.site)), location: ref('location', idOf(r.location)), rack: ref('rack', idOf(r.rack)), position: num(r.position), face: val(r.face) || null, status: val(r.status) } };
        case 'rearport': return { f: { device: ref('device', idOf(r.device)), name: r.name, label: r.label || '', type: val(r.type), positions: num(r.positions) } };
        case 'frontport': {
          const m = Array.isArray(r.rear_ports) ? r.rear_ports[0] : null;
          const rp = m ? idOf(m.rear_port) : idOf(r.rear_port), pos = m ? m.rear_port_position : r.rear_port_position;
          return { f: { device: ref('device', idOf(r.device)), name: r.name, label: r.label || '', type: val(r.type), rear_port: ref('rearport', rp), rear_pos: num(pos) } };
        }
        case 'interface': {
          const f = { device: ref('device', idOf(r.device)), name: r.name, label: r.label || '', type: val(r.type), enabled: r.enabled !== false, mode: val(r.mode) || '', untagged_vlan: ref('vlan', idOf(r.untagged_vlan)), tagged_vlans: (r.tagged_vlans || []).map(v => ref('vlan', idOf(v))) };
          if (val(r.type) === 'virtual') f.parent = ref('interface', idOf(r.parent));
          return { f };
        }
        case 'cable': {
          const end = list => { const t = (list || [])[0]; return t && TERM_KIND[t.object_type] ? ref(TERM_KIND[t.object_type], t.object_id) : null; };
          return { f: { ends: [end(r.a_terminations), end(r.b_terminations)].filter(Boolean), type: val(r.type) || '', length: num(r.length), length_unit: val(r.length_unit) || '', color: r.color || '', label: r.label || '', status: val(r.status) } };
        }
        case 'ip': return { f: { address: r.address, iface: r.assigned_object_type === 'dcim.interface' ? ref('interface', r.assigned_object_id) : null, status: val(r.status) } };
        default: return null;
      }
    },
    /**
     * Corps JSON d'un objet canonique. fields : champs à envoyer (mise à jour) ; sinon tous (création, avec le champ
     * personnalisé et l'étiquette si meta les a). Une référence non résolue rend { missing: clé }.
     */
    payload(kind, x, resolve, meta = {}, fields = null) {
      const f = x.f, want = k => !fields || fields.includes(k), body = {};
      let missing = null;
      const id = v => { const k = refKeyOf(v); if (!k) return null; const i = resolve(k); if (i == null && !missing) missing = k; return i ?? null; };
      const put = (k, v, apiKey = k) => { if (!want(k)) return; if (v == null && !fields) return; body[apiKey] = v; };
      const plain = keys => { for (const k of keys) put(k, f[k] === '' && fields ? f[k] : f[k] === '' ? undefined : f[k]); };
      switch (kind) {
        case 'site': plain(['name', 'slug', 'status']); break;
        case 'location': plain(['name', 'slug', 'status']); put('site', id(f.site)); put('parent', id(f.parent)); break;
        case 'manufacturer': plain(['name', 'slug']); break;
        case 'role': plain(['name', 'slug', 'color']); break;
        case 'dtype': plain(['model', 'slug', 'u_height', 'is_full_depth']); put('manufacturer', id(f.manufacturer)); break;
        case 'rack': plain(['name', 'u_height', 'width', 'form_factor', 'outer_width', 'outer_depth', 'outer_unit', 'status']); put('site', id(f.site)); put('location', id(f.location)); break;
        case 'vlan': plain(['vid', 'name', 'status']); put('site', id(f.site)); break;
        case 'prefix': plain(['prefix', 'status', 'description']); put('vlan', id(f.vlan));
          if (want('scope')) { const s = id(f.scope); if (caps.scope) { if (s != null || fields) { body.scope_type = s == null ? null : 'dcim.site'; body.scope_id = s; } } else if (s != null || fields) body.site = s; }
          break;
        case 'device': plain(['name', 'status']); put('device_type', id(f.device_type)); put('role', id(f.role)); put('site', id(f.site)); put('location', id(f.location)); put('rack', id(f.rack));
          if (want('position') || want('face') || want('rack')) { if (f.position != null || fields) body.position = f.position ?? null; if (f.face || fields) body.face = f.face || ''; }
          break;
        case 'rearport': plain(['name', 'label', 'type', 'positions']); put('device', id(f.device)); break;
        case 'frontport': plain(['name', 'label', 'type']); put('device', id(f.device));
          if (want('rear_port') || want('rear_pos')) {
            const rp = id(f.rear_port);
            if (caps.frontList) { body.positions = 1; body.rear_ports = rp == null ? [] : [{ position: 1, rear_port: rp, rear_port_position: f.rear_pos || 1 }]; }
            else { body.rear_port = rp; body.rear_port_position = f.rear_pos || 1; }
          }
          break;
        case 'interface': {
          plain(['name', 'label', 'type', 'enabled']); put('device', id(f.device));
          if ('parent' in f) put('parent', id(f.parent));
          if (want('mode') || want('untagged_vlan') || want('tagged_vlans')) {
            // Le mode décide des VLAN permis : les trois partent ensemble.
            body.mode = f.mode || null;
            body.untagged_vlan = f.mode ? id(f.untagged_vlan) : null;
            body.tagged_vlans = f.mode === 'tagged' ? (f.tagged_vlans || []).map(id).filter(v => v != null) : [];
          }
          break;
        }
        case 'cable': {
          plain(['type', 'length', 'length_unit', 'color', 'label', 'status']);
          if (want('ends')) {
            const t = v => { const k = refKeyOf(v); const i = id(v); return i == null ? [] : [{ object_type: TERM[k.split(':')[0]], object_id: i }]; };
            body.a_terminations = t(f.ends[0]); body.b_terminations = t(f.ends[1]);
          }
          break;
        }
        case 'ip': plain(['address', 'status']); if (want('iface')) { const i = id(f.iface); body.assigned_object_type = i == null ? null : 'dcim.interface'; body.assigned_object_id = i; } break;
        default: break;
      }
      if (missing) return { missing };
      for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
      if (!fields) {
        if (meta.cf && CF_TYPES[kind]) body.custom_fields = { [CF]: x.key };
        if (meta.tagId != null && kind !== 'manufacturer' && kind !== 'role' && kind !== 'dtype') body.tags = [meta.tagId];
      }
      return { body };
    },
    /** Composants d'équipements donnés (créés à l'instant : le serveur a pu en faire d'office d'après le type). */
    async components(bridge, kind, deviceIds) {
      const out = [];
      for (let i = 0; i < deviceIds.length; i += 50) {
        const r = await bridge.get(EP[kind], deviceIds.slice(i, i + 50).map(d => ['device_id', String(d)]));
        out.push(...(r.results || []));
      }
      return out;
    }
  };
  return A;
}

/* ---------- Lecture du serveur ---------- */
const many = async (bridge, path, key, values, extra = []) => {
  const out = [];
  for (let i = 0; i < values.length; i += 40) { const r = await bridge.get(path, [...extra, ...values.slice(i, i + 40).map(v => [key, String(v)])]); out.push(...(r.results || [])); }
  return out;
};
/** Sites du serveur (pour choisir où envoyer, ou quoi importer). */
export async function listSites(bridge) {
  const r = await bridge.get(EP.site, [['brief', 'true']], 5000);
  return (r.results || []).map(s => ({ id: s.id, name: s.name || s.display, slug: s.slug })).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
}
/**
 * Objets du serveur pour le site (o.siteId, sinon le site du même slug que le nôtre) : { raws: { kind: [] }, siteId }.
 * Fabricants, rôles et types : ceux de nos slugs, plus ceux que les équipements lus portent (import).
 */
export async function fetchRemote(bridge, ours, o = {}) {
  const raws = Object.fromEntries(KINDS.map(k => [k, []]));
  const step = (k, i) => { if (o.signal && o.signal.aborted) { const e = new Error('Annulé'); e.name = 'AbortError'; throw e; } if (o.progress) o.progress(i / 16, k); };
  const slugs = kind => [...ours.objs.values()].filter(x => x.kind === kind).map(x => x.f.slug);
  step('site', 0);
  const site = o.siteId != null ? (await bridge.get(EP.site, [['id', String(o.siteId)]])).results || [] : await many(bridge, EP.site, 'slug', [ours.objs.get('site').f.slug]);
  raws.site = site.slice(0, 1);
  step('manufacturer', 1); raws.manufacturer = await many(bridge, EP.manufacturer, 'slug', slugs('manufacturer'));
  step('role', 2); raws.role = await many(bridge, EP.role, 'slug', slugs('role'));
  step('dtype', 3); raws.dtype = await many(bridge, EP.dtype, 'slug', slugs('dtype'));
  const S = raws.site[0] && raws.site[0].id;
  if (S != null) {
    const q = [['site_id', String(S)]];
    let i = 4;
    for (const k of ['location', 'rack', 'vlan', 'prefix', 'device', 'rearport', 'frontport', 'interface', 'cable']) { step(k, i++); raws[k] = (await bridge.get(EP[k], q)).results || []; }
    step('ip', 13);
    raws.ip = await many(bridge, EP.ip, 'device_id', raws.device.map(d => d.id));
    // Types, fabricants, rôles portés par les équipements (objets imbriqués de l'API).
    const seen = k => new Set(raws[k].map(x => x.id));
    const dt = seen('dtype'), mf = seen('manufacturer'), rl = seen('role');
    for (const d of raws.device) {
      const t = d.device_type; if (t && typeof t === 'object' && !dt.has(t.id)) { dt.add(t.id); raws.dtype.push(t); }
      const m = t && t.manufacturer; if (m && typeof m === 'object' && !mf.has(m.id)) { mf.add(m.id); raws.manufacturer.push(m); }
      const r = d.role || d.device_role; if (r && typeof r === 'object' && !rl.has(r.id)) { rl.add(r.id); raws.role.push(r); }
    }
  }
  step('', 16);
  return { raws, siteId: S ?? null };
}

/* ---------- Champ personnalisé et étiquette ---------- */
/** État du champ personnalisé jollof_id et de l'étiquette, sans rien écrire : { tagId, cf, cfTypesMissing }. */
export async function checkMeta(bridge) {
  const out = { tagId: null, cf: false, cfId: null, cfTypesMissing: Object.values(CF_TYPES) };
  try { const t = (await bridge.get('/api/extras/tags/', [['slug', TAG.slug]])).results || []; if (t[0]) out.tagId = t[0].id; } catch (e) { out.tagErr = e; }
  try {
    const c = ((await bridge.get('/api/extras/custom-fields/', [['name', CF]])).results || [])[0];
    if (c) { const have = new Set((c.object_types || c.content_types || []).map(x => (typeof x === 'string' ? x : `${x.app_label}.${x.model}`))); out.cf = true; out.cfId = c.id; out.cfTypesMissing = Object.values(CF_TYPES).filter(t => !have.has(t)); }
  } catch (e) { out.cfErr = e; }
  return out;
}
/**
 * Crée l'étiquette et le champ personnalisé s'il le faut (droits d'administration de NetBox nécessaires). Sans droit :
 * la synchronisation continue, appariée par les noms (notes : 'tagPerm', 'cfPerm'). Rend { tagId, cf, notes }.
 */
export async function ensureMeta(bridge, known = null) {
  const m = known || await checkMeta(bridge), notes = [];
  let tagId = m.tagId, cf = m.cf && !m.cfTypesMissing.length;
  if (tagId == null) {
    try { const r = await bridge.write('POST', '/api/extras/tags/', { ...TAG, description: 'Objets créés ou mis à jour par Jollof Studio' }); tagId = r && r.id; } catch (e) { notes.push({ code: 'tagPerm', message: e && e.message }); }
  }
  try {
    if (!m.cf) {
      await bridge.write('POST', '/api/extras/custom-fields/', { name: CF, label: 'Jollof Studio ID', type: 'text', object_types: Object.values(CF_TYPES), required: false, ui_editable: 'no', description: 'Identifiant stable de l’objet dans le projet Jollof Studio (synchronisation)' });
      cf = true;
    } else if (m.cfTypesMissing.length) {
      const have = Object.values(CF_TYPES).filter(t => !m.cfTypesMissing.includes(t));
      await bridge.write('PATCH', `/api/extras/custom-fields/${m.cfId}/`, { object_types: [...have, ...m.cfTypesMissing] });
      cf = true;
    }
  } catch (e) { notes.push({ code: 'cfPerm', message: e && e.message }); cf = m.cf && !m.cfTypesMissing.length; }
  return { tagId, cf, notes };
}

/* ---------- Parcours complet ---------- */
/** Version du serveur et capacités ; lève une erreur claire si NetBox est trop ancien. */
export async function connect(bridge) {
  const st = await bridge.status();
  const caps = capsOf(st.version);
  if (!caps.ok) { const e = new Error(`NetBox ${st.version || '?'} : version ${MIN_VERSION.join('.')} ou plus récente requise.`); e.kind = 'version'; throw e; }
  return { status: st, caps };
}
/**
 * Plan (aucune écriture) : lit le serveur, apparie, compare. o : { dir 'push'|'pull', siteId, deletes, siteName, caps,
 * signal, progress }. Rend { A, ours, M, rows, meta, siteId, warnings }.
 */
export async function plan(bridge, data, o = {}) {
  const A = createAdapter(o.caps || capsOf('4.5'));
  const ours = ourModel(data, { siteName: o.siteName });
  const { raws, siteId } = await fetchRemote(bridge, ours, o);
  const M = match(A, ours, raws, { siteId });
  const meta = await checkMeta(bridge);
  const rows = diff(ours, M, { dir: o.dir || 'push', deletes: !!o.deletes });
  return { A, ours, M, rows, meta, siteId, warnings: ours.warnings, dir: o.dir || 'push' };
}
/** Envoi des lignes cochées d'un plan : étiquette et champ personnalisé d'abord, puis les objets. */
export async function push(bridge, P, o = {}) {
  const meta = await ensureMeta(bridge, P.meta);
  const r = await applyPush(P.A, bridge, P.rows, P.ours, P.M, { ...o, meta });
  return { ...r, notes: meta.notes };
}
/** Import des lignes cochées d'un plan dans le projet (data muté). */
export const pull = (data, P) => applyPull(data, P.rows, P.ours, P.M);
