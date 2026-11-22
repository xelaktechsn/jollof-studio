// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Classeur Excel du projet réseau (module pur, sans interface) : un onglet par tableau (câbles, brassage, prises,
// équipements, nomenclature avec formules, plan d'adressage, étiquettes, tests), en-têtes standard (anglais, comme les
// outils courants) ou dans la langue de l'interface, première colonne « ID » stable. Au retour d'Excel :
// diffWorkbook compare les colonnes modifiables au modèle (par ID) et rend les changements à accepter ou non ; un seul
// enregistrement (ctx.commit) les applique. Import d'un tarif fournisseur pour la nomenclature : priceList (colonnes
// devinées puis réglables) et matchPrices (par référence, sinon par désignation).
import { tl } from '../../i18n/index.js';
import { csvTables, bom, labeler } from '../docs.js';
import { cleanDesign } from '../dimension.js';
import { CATS } from '../cable.js';
import { specOf } from '../devices.js';
import * as VLAN from '../vlan.js';
import { writeXlsx, readXlsx, sheetName, colName } from './xlsx.js';

export const WORKBOOK_TAG = 'Jollof.Network';
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const num = v => (v === '' || v == null ? null : typeof v === 'number' ? v : Number.isFinite(+String(v).replace(',', '.')) ? +String(v).replace(',', '.') : NaN);
const vid = v => { const n = num(v); return n == null ? 0 : Number.isInteger(n) && n >= 0 && n <= 4094 ? n : NaN; };
const str = v => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
const devOf = (data, id) => (data.devices || []).find(d => d.id === id) || null;
const cableOf = (data, id) => (data.cables || []).find(c => c.id === id) || null;
const vlanOf = (data, id) => (data.vlans || []).find(v => String(v.id) === String(id)) || null;
/** Réglage d'un port de switch (vlan.js portCfg, défauts compris) et son écriture. */
const portGet = (d, p) => (VLAN.portCfg ? VLAN.portCfg(d, p) : { ...((d.p && d.p.ports && d.p.ports[p]) || {}) });
const portSet = (d, p, o) => { if (!d.p) d.p = {}; if (!d.p.ports || typeof d.p.ports !== 'object') d.p.ports = {}; d.p.ports[p] = { ...(VLAN.PORT_DEFAULT || {}), ...(d.p.ports[p] || {}), ...o }; };

/**
 * Tableaux du classeur : { clé: { en, fr (noms d'onglet), rows(data, lan, T) → [{ id, … }], cols: [{ k, en, fr, fmt,
 * width, get(row), edit?: { cur(data, id), set(data, id, v), parse(v) → valeur | NaN (refusée), list? } }] } }.
 * T : csvTables du projet (en-têtes standard) ; les ID sont ceux du modèle (câble, appareil:port, VLAN, ligne de
 * nomenclature…), jamais les étiquettes, qui changent avec le schéma.
 */
function tables() {
  return {
    cables: {
      en: 'Cables', fr: 'Câbles', rows: (data, lan, T) => T.cables.rows.map(r => ({ id: r.id, ...r })),
      cols: [
        { k: 'label', en: 'Cable ID', fr: 'Étiquette', get: r => r.label, width: 20 },
        { k: 'from', en: 'From Device', fr: 'De', get: r => r.from.split(' · ')[0] }, { k: 'fromPort', en: 'From Port', fr: 'Port', get: r => r.from.split(' · ').slice(1).join(' · ') },
        { k: 'to', en: 'To Device', fr: 'Vers', get: r => r.to.split(' · ')[0] }, { k: 'toPort', en: 'To Port', fr: 'Port', get: r => r.to.split(' · ').slice(1).join(' · ') },
        { k: 'media', en: 'Type', fr: 'Support', get: r => (r.media === 'fibre' ? 'Fiber' : 'Copper') },
        { k: 'cat', en: 'Category', fr: 'Catégorie', get: r => (r.media === 'fibre' ? r.type : (r.c && r.c.cat) || r.type),
          edit: { list: Object.keys(CATS), cur: (d, id) => { const c = cableOf(d, id); return c && c.media !== 'fibre' ? c.cat : undefined; }, parse: v => { const s = norm(v).replace(/\s|cat/g, ''); const k = Object.keys(CATS).find(x => x.replace('cat', '') === s); return k || NaN; }, set: (d, id, v) => { const c = cableOf(d, id); if (c) c.cat = v; } } },
        { k: 'len', en: 'Length (m)', fr: 'Longueur (m)', fmt: 'dec1', get: r => r.len,
          edit: { cur: (d, id) => { const c = cableOf(d, id); return c ? +(+c.len).toFixed(1) : undefined; }, parse: v => { const n = num(v); return n != null && n > 0 && n <= 100000 ? +n.toFixed(1) : NaN; }, set: (d, id, v) => { const c = cableOf(d, id); if (!c) return; c.len = v; if (c.route && c.route.mode === 'auto') c.route = { mode: 'manual' }; } } },
        { k: 'kind', en: 'Function', fr: 'Genre', get: r => ({ horizontal: 'Permanent link', cord: 'Patch cord', backbone: 'Backbone', other: 'Other' }[r.kind] || r.kind) },
        { k: 'mode', en: 'Routing', fr: 'Tracé', get: r => r.mode || '' }, { k: 'paths', en: 'Pathways', fr: 'Cheminements', get: r => r.paths.join(' > ') },
        { k: 'tag', en: 'Forced Label', fr: 'Étiquette imposée', get: r => (r.c && r.c.tag) || '',
          edit: { cur: (d, id) => { const c = cableOf(d, id); return c ? c.tag || '' : undefined; }, parse: v => str(v).replace(/[<>"'`]/g, '').slice(0, 40), set: (d, id, v) => { const c = cableOf(d, id); if (!c) return; if (v) c.tag = v; else delete c.tag; } } }
      ]
    },
    patching: {
      en: 'Patching', fr: 'Brassage', what: r => `${r.port} · ${r.device} ${r.dport}`, rows: (data, lan, T) => T.patching.rows.filter(r => r._sw && r._swp).map(r => ({ id: `${r._sw}:${r._swp}`, ...r })),
      cols: [
        { k: 'rack', en: 'Rack', fr: 'Baie', get: r => r.rack }, { k: 'panel', en: 'Patch Panel', fr: 'Panneau', get: r => r.panel }, { k: 'port', en: 'Panel Port ID', fr: 'Identifiant', get: r => r.port },
        { k: 'device', en: 'Switch', fr: 'Équipement', get: r => r.device }, { k: 'dport', en: 'Switch Port', fr: 'Port', get: r => r.dport },
        { k: 'vlan', en: 'VLAN', fr: 'VLAN', fmt: 'int', get: r => (r.vlan === '' || r.vlan == null ? '' : +r.vlan), edit: vlanEdit('vlan') },
        { k: 'outlet', en: 'Outlet', fr: 'Prise', get: r => r.outlet }, { k: 'oport', en: 'Outlet Port', fr: 'Port de prise', get: r => r.oport },
        { k: 'permLen', en: 'Permanent Link (m)', fr: 'Lien permanent (m)', fmt: 'dec1', get: r => r.permLen }, { k: 'cordLen', en: 'Patch Cord (m)', fr: 'Cordon (m)', fmt: 'dec1', get: r => r.cordLen }
      ]
    },
    outlets: {
      en: 'Outlets', fr: 'Prises', what: r => [r.oid, r.dev].filter(Boolean).join(' · '), rows: (data, lan, T) => T.outlets.rows.map(r => ({ ...r, oid: r.id, id: `${r._dev}:${r._port}` })),
      cols: [
        { k: 'oid', en: 'Outlet ID', fr: 'Identifiant', get: r => r.oid || '' },
        { k: 'dev', en: 'Faceplate', fr: 'Prise', get: r => r.dev, edit: nameEdit(id => id.split(':')[0]) },
        { k: 'port', en: 'Port', fr: 'Port', get: r => r.port }, { k: 'room', en: 'Room', fr: 'Nom de la pièce', get: r => r.room }, { k: 'floor', en: 'Floor', fr: 'Étage', get: r => r.floor },
        { k: 'panel', en: 'Patch Panel', fr: 'Panneau', get: r => r.panel }, { k: 'sw', en: 'Switch', fr: 'Switch', get: r => r.sw }, { k: 'swport', en: 'Switch Port', fr: 'Port du switch', get: r => r.swport },
        { k: 'vlan', en: 'Data VLAN', fr: 'VLAN de données', fmt: 'int', get: r => (r.vlan === '' ? '' : +r.vlan), edit: vlanEdit('vlan', true) },
        { k: 'voice', en: 'Voice VLAN', fr: 'VLAN voix', fmt: 'int', get: r => (r.voice === '' ? '' : +r.voice), edit: VLAN.PORT_DEFAULT && 'voice' in VLAN.PORT_DEFAULT ? vlanEdit('voice', true) : undefined },
        { k: 'len', en: 'Link Length (m)', fr: 'Longueur du lien (m)', fmt: 'dec1', get: r => (r.len === '' ? '' : r.len) }
      ]
    },
    devices: {
      en: 'Devices', fr: 'Équipements', what: r => r.d.name || r.d.id, rows: data => { const L = labeler(data); return (data.devices || []).filter(d => { const s = specOf(d); return s && s.role !== 'mech'; }).map(d => ({ id: d.id, d, L })); },
      cols: [
        { k: 'name', en: 'Name', fr: 'Nom', get: r => r.d.name, edit: nameEdit(id => id) },
        { k: 'type', en: 'Type', fr: 'Type', get: r => r.d.type }, { k: 'label', en: 'Label', fr: 'Étiquette', get: r => r.L.of(r.d.id) || '' },
        { k: 'rack', en: 'Rack', fr: 'Baie', get: r => (r.d.rack ? r.L.rack(r.d.rack.id) : '') }, { k: 'u', en: 'U', fr: 'U', fmt: 'int', get: r => (r.d.rack ? r.d.rack.u : '') },
        { k: 'ip', en: 'IP Address', fr: 'Adresse IP', get: r => { const ip = r.d.p && r.d.p.ip; return ip ? (ip.mode === 'static' ? `${ip.ip}/${ip.prefix}` : ip.mode === 'dhcp' ? 'DHCP' : '') : ''; } },
        { k: 'tag', en: 'Forced Label', fr: 'Étiquette imposée', get: r => r.d.tag || '',
          edit: { cur: (d, id) => { const x = devOf(d, id); return x ? x.tag || '' : undefined; }, parse: v => str(v).replace(/[<>"'`]/g, '').slice(0, 40), set: (d, id, v) => { const x = devOf(d, id); if (!x) return; if (v) x.tag = v; else delete x.tag; } } }
      ]
    },
    bom: {
      en: 'Bill of Materials', fr: 'Nomenclature', bom: true, what: r => r.name, rows: (data, lan, T) => T.bom.rows.map(r => ({ id: r.key, ...r })),
      cols: [
        { k: 'item', en: 'Item', fr: 'Ligne', fmt: 'int', get: r => r.i }, { k: 'name', en: 'Description', fr: 'Désignation', get: r => r.name, width: 40 },
        { k: 'maker', en: 'Manufacturer', fr: 'Fabricant', get: r => r.maker }, { k: 'part', en: 'Part Number', fr: 'Référence', get: r => r.part, width: 24 },
        { k: 'qty', en: 'Quantity', fr: 'Quantité', fmt: 'dec2', get: r => r.qty }, { k: 'unit', en: 'Unit', fr: 'Unité', get: r => r.unit },
        { k: 'price', en: 'Unit Price', fr: 'Prix unitaire', fmt: 'money', get: r => (r.price ? r.price : ''),
          edit: { cur: (d, id) => priceCur(d, id), parse: v => { const n = num(v); return n == null ? 0 : n >= 0 && n < 1e9 ? n : NaN; }, set: (d, id, v) => priceSet(d, id, v) } },
        { k: 'total', en: 'Total', fr: 'Total', fmt: 'money', width: 14, get: r => (r.price ? r.total : '') }, { k: 'note', en: 'Notes', fr: 'Remarque', get: r => r.note, width: 30 }
      ]
    },
    ipplan: {
      en: 'IP Plan', fr: 'Adressage', rows: (data, lan, T) => T.ipplan.rows.map(r => ({ ...r, id: String(r.id), vid: r.id })),
      cols: [
        { k: 'vid', en: 'VLAN ID', fr: 'VLAN', fmt: 'int', get: r => +r.vid },
        { k: 'name', en: 'Name', fr: 'Nom', get: r => r.name, edit: { cur: (d, id) => { const v = vlanOf(d, id); return v ? v.name : undefined; }, parse: v => str(v).replace(/[<>"'`]/g, '').slice(0, 64) || NaN, set: (d, id, v) => { const x = vlanOf(d, id); if (x) x.name = v; } } },
        { k: 'net', en: 'Network', fr: 'Réseau', get: r => (r.net ? `${r.net}/${r.prefix}` : ''), edit: { cur: (d, id) => { const v = vlanOf(d, id); return v ? v.net || '' : undefined; }, parse: v => { const s = str(v); return s === '' || /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(s) ? s : NaN; }, set: (d, id, v) => { const x = vlanOf(d, id); if (x) x.net = v; } } },
        { k: 'mask', en: 'Subnet Mask', fr: 'Masque', get: r => r.mask },
        { k: 'gw', en: 'Gateway', fr: 'Passerelle', get: r => r.gw, edit: { cur: (d, id) => { const v = vlanOf(d, id); return v ? v.gw || '' : undefined; }, parse: v => { const s = str(v); return s === '' || /^\d{1,3}(\.\d{1,3}){3}$/.test(s) ? s : NaN; }, set: (d, id, v) => { const x = vlanOf(d, id); if (x) x.gw = v; } } },
        { k: 'first', en: 'First Host', fr: 'Première adresse', get: r => r.first }, { k: 'last', en: 'Last Host', fr: 'Dernière adresse', get: r => r.last }, { k: 'bcast', en: 'Broadcast', fr: 'Diffusion', get: r => r.bcast },
        { k: 'hosts', en: 'Planned Hosts', fr: 'Hôtes prévus', fmt: 'int', get: r => (r.hosts === '' ? '' : +r.hosts), edit: { cur: (d, id) => { const v = vlanOf(d, id); return v ? v.hosts ?? '' : undefined; }, parse: v => { const n = num(v); return n == null ? '' : Number.isInteger(n) && n >= 0 ? n : NaN; }, set: (d, id, v) => { const x = vlanOf(d, id); if (!x) return; if (v === '') delete x.hosts; else x.hosts = v; } } }
      ]
    },
    labels: {
      en: 'Labels', fr: 'Étiquettes', rows: (data, lan, T) => T.labels.rows.map((r, i) => ({ ...r, id: `${r.kind}:${r.id}${r.port ? ':' + r.port : ''}`, _i: i })),
      cols: [{ k: 'kind', en: 'Object', fr: 'Objet', get: r => r.kind }, { k: 'label', en: 'Label', fr: 'Étiquette', get: r => r.label }, { k: 'where', en: 'Location', fr: 'Emplacement', get: r => r.where, width: 30 }]
    },
    tests: {
      en: 'Test Results', fr: 'Tests', rows: data => testRows(data),
      cols: [{ k: 'link', en: 'Link', fr: 'Lien', get: r => r.label, width: 28 }, { k: 'limit', en: 'Limit', fr: 'Limite', get: r => r.limit }, { k: 'verdict', en: 'Result', fr: 'Résultat', get: r => r.verdict },
        { k: 'margin', en: 'Margin (dB)', fr: 'Marge (dB)', fmt: 'dec2', get: r => r.margin }, { k: 'len', en: 'Length (m)', fr: 'Longueur (m)', fmt: 'dec1', get: r => r.len }, { k: 'at', en: 'Date', fr: 'Date', fmt: 'date', get: r => r.at }]
    }
  };
}
const nameEdit = devId => ({ target: id => 'dev:' + devId(id) + ':name', cur: (d, id) => { const x = devOf(d, devId(id)); return x ? x.name : undefined; }, parse: v => str(v).replace(/[<>"'`]/g, '').slice(0, 64) || NaN, set: (d, id, v) => { const x = devOf(d, devId(id)); if (x) x.name = v; } });
/** VLAN d'accès (ou voix) du port de switch au bout de la ligne : id « switch:port » (brassage) ou ligne de prise. */
function vlanEdit(field, viaOutlet) {
  const at = (d, id, rows) => { if (!viaOutlet) { const [sw, ...p] = id.split(':'); return [devOf(d, sw), p.join(':')]; } const r = rows && rows.get(id); return r && r._sw ? [devOf(d, r._sw), r._swp] : [null, null]; };
  return {
    needsRows: !!viaOutlet,
    target: (id, rows) => { const r = viaOutlet ? rows && rows.get(id) : null, k = viaOutlet ? (r ? `${r._sw}:${r._swp}` : id) : id; return `port:${k}:${field}`; },
    cur: (d, id, rows) => { const [sw, p] = at(d, id, rows); if (!sw || !p || !specOf(sw) || !specOf(sw).managed) return undefined; const c = portGet(sw, p); return field === 'voice' ? c.voice || '' : c.mode === 'access' ? c.vlan ?? 1 : undefined; },
    parse: v => { const n = vid(v); return Number.isNaN(n) ? NaN : n === 0 && field === 'vlan' ? NaN : n || ''; },
    set: (d, id, v, rows) => { const [sw, p] = at(d, id, rows); if (!sw || !p) return; portSet(sw, p, field === 'voice' ? { voice: v || 0 } : { mode: 'access', vlan: v }); }
  };
}
const priceCur = (d, key) => { if (/^labour\d+$/.test(key)) { const l = cleanDesign(d.design).labour[+key.slice(6)]; return l ? l.price : undefined; } return +(((d.design || {}).prices || {})[key] || 0); };
function priceSet(d, key, v) {
  const D = d.design && d.design.usage ? d.design : (d.design = cleanDesign(d.design));
  if (/^labour\d+$/.test(key)) { const l = D.labour[+key.slice(6)]; if (l) l.price = v; return; }
  D.prices = { ...(D.prices || {}) }; if (v) D.prices[key] = v; else delete D.prices[key];
}
function testRows(data) {
  const res = (data.tests && data.tests.results) || [];
  return res.map(r => ({ id: r.link, label: r.label || r.link, limit: r.limit, verdict: ({ pass: 'PASS', 'pass*': 'PASS*', 'fail*': 'FAIL*', fail: 'FAIL' })[r.verdict] || r.verdict || '', margin: r.margin ?? '', len: r.len ?? '', at: r.at ? new Date(r.at) : '' }));
}

/**
 * Classeur du projet. o : { headers: 'standard'|'local', currency, title, creator, tables: [clés] (défaut : toutes) }.
 * Rend { bytes: Uint8Array, sheets: [noms] }. La nomenclature porte des formules : total = quantité × prix, sommes en bas.
 */
export function networkWorkbook(data, lan, o = {}) {
  const std = o.headers !== 'local', TB = tables(), T = csvTables(data, lan, { headers: 'standard' }), want = o.tables || Object.keys(TB);
  const D = cleanDesign(data.design), sheets = [];
  for (const key of want) {
    const t = TB[key]; if (!t) continue;
    const rows = t.rows(data, lan, T), cols = [{ header: 'ID', width: 14 }, ...t.cols.map(c => ({ header: std ? c.en : tl(c.fr), fmt: c.fmt, width: c.width, list: c.edit && c.edit.list }))];
    const body = rows.map(r => [r.id, ...t.cols.map(c => { const v = c.get(r); return v === undefined ? null : v; })]);
    let totalRows = 0;
    if (t.bom && body.length) {
      // Total = quantité × prix unitaire ; sommes de la colonne Total (et sous-total de la main-d'œuvre).
      const ci = k => 1 + t.cols.findIndex(c => c.k === k), L = colName;
      const q = L(ci('qty')), p = L(ci('price')), tot = ci('total');
      body.forEach((row, i) => { const r = i + 2; row[tot] = { f: `IF(${p}${r}="","",${q}${r}*${p}${r})`, v: typeof row[ci('price')] === 'number' ? +(row[ci('qty')] * row[ci('price')]).toFixed(2) : '' }; });
      const last = body.length + 1, sum = { f: `SUM(${L(tot)}2:${L(tot)}${last})`, v: bom(data).total };
      const totalRow = new Array(cols.length).fill(null); totalRow[0] = 'TOTAL'; totalRow[ci('name')] = std ? 'Total (lines with a price)' : tl('Total (lignes avec un prix)'); totalRow[tot] = sum;
      body.push(totalRow); totalRows = 1;
    }
    sheets.push({ name: sheetName(std ? t.en : tl(t.fr)), cols, rows: body, totalRows, tabSelected: !sheets.length });
  }
  const P = D.project;
  const bytes = writeXlsx({ sheets, currency: o.currency || D.currency, props: { title: o.title || P.site || (data.site && data.site.name) || 'Network', subject: 'Network schedules', creator: o.creator || P.author || '', company: P.client || '', custom: { [WORKBOOK_TAG]: '1', 'Jollof.Headers': std ? 'standard' : 'local' } } });
  return { bytes, sheets: sheets.map(s => s.name) };
}

/* ---------- Import : différences ---------- */
/** Onglet du classeur qui correspond à un tableau (nom anglais ou français, sans accents ni casse). */
const findSheet = (wb, t) => wb.sheets.find(s => [t.en, t.fr, tl(t.fr)].some(n => norm(sheetName(n)) === norm(s.name)));
/** Colonne de chaque champ : par l'en-tête (anglais, français ou langue de l'interface), sinon par la position. */
function colMap(header, t) {
  const H = header.map(norm), out = {};
  t.cols.forEach((c, j) => { const k = H.findIndex((h, i) => i > 0 && [c.en, c.fr, tl(c.fr)].some(n => norm(n) === h)); out[c.k] = k >= 0 ? k : norm(header[j + 1]) === '' ? -1 : j + 1; });
  return out;
}
const same = (a, b) => (typeof a === 'number' || typeof b === 'number' ? Math.abs((+a || 0) - (+b || 0)) < 1e-9 && String(a ?? '') !== '' === (String(b ?? '') !== '') : String(a ?? '').trim() === String(b ?? '').trim());
/**
 * Compare un classeur relu (readXlsx) au modèle. Rend { ours (classeur exporté par Jollof Studio), changes: [{ table,
 * sheet, id, what (objet lisible), field, header, from, to }], invalid: [{ …, value }] (valeurs refusées), unknown: [{
 * table, id }] (lignes sans objet), missing: { table: n } (objets absents du classeur), tables: [clés lues] }.
 */
export function diffWorkbook(data, lan, wb) {
  const TB = tables(), T = csvTables(data, lan, { headers: 'standard' }), out = { ours: wb.props && wb.props.custom && wb.props.custom[WORKBOOK_TAG] === '1', changes: [], invalid: [], unknown: [], missing: {}, tables: [] };
  for (const [key, t] of Object.entries(TB)) {
    if (!t.cols.some(c => c.edit)) continue;
    const sh = findSheet(wb, t); if (!sh || !sh.rows.length) continue;
    out.tables.push(key);
    const map = colMap(sh.rows[0], t), rows = t.rows(data, lan, T), byId = new Map(rows.map(r => [String(r.id), r])), seen = new Set();
    for (const row of sh.rows.slice(1)) {
      const id = str(row[0]); if (!id || id === 'TOTAL') continue;
      const r = byId.get(id); if (!r) { out.unknown.push({ table: key, id }); continue; }
      seen.add(id);
      for (const c of t.cols) {
        if (!c.edit || map[c.k] < 0) continue;
        const raw = row[map[c.k]], cur = c.edit.cur(data, id, byId); if (cur === undefined) continue;
        const v = c.edit.parse(raw);
        const what = `${(t.what ? t.what(r) : t.cols[0].get(r)) || id}`;
        if (typeof v === 'number' && Number.isNaN(v)) { if (str(raw) !== '' || c.k === 'name') out.invalid.push({ table: key, sheet: sh.name, id, what, field: c.k, header: tl(c.fr), value: str(raw) }); continue; }
        if (same(v, cur)) continue;
        const target = c.edit.target ? c.edit.target(id, byId) : `${key}:${id}:${c.k}`;
        out.changes.push({ table: key, sheet: sh.name, id, what, field: c.k, header: tl(c.fr), from: cur, to: v, target });
      }
    }
    const miss = rows.filter(r => !seen.has(String(r.id))).length; if (miss) out.missing[key] = miss;
  }
  // Le même objet modifié à deux endroits (une prise double, le brassage et la liste des prises) avec deux valeurs
  // différentes : conflit, la première est proposée, les autres signalées.
  const byTarget = new Map();
  for (const ch of out.changes) { const p = byTarget.get(ch.target); if (!p) byTarget.set(ch.target, ch); else if (!same(p.to, ch.to)) { ch.conflict = true; p.conflict = true; } else ch.duplicate = true; }
  out.changes = out.changes.filter(c => !c.duplicate);
  return out;
}
/** Applique les changements retenus au modèle (l'appelant fait un seul ctx.commit()). Rend le nombre appliqué. */
export function applyChanges(data, lan, changes) {
  const TB = tables(), T = csvTables(data, lan, { headers: 'standard' }), rowsOf = {};
  let n = 0;
  for (const ch of changes) {
    const t = TB[ch.table], c = t && t.cols.find(x => x.k === ch.field); if (!c || !c.edit) continue;
    if (c.edit.needsRows && !rowsOf[ch.table]) rowsOf[ch.table] = new Map(t.rows(data, lan, T).map(r => [String(r.id), r]));
    c.edit.set(data, ch.id, ch.to, rowsOf[ch.table]); n++;
  }
  return n;
}

/* ---------- Import d'un tarif ---------- */
const GUESS = { part: ['part number', 'part no', 'part', 'reference', 'référence', 'ref', 'sku', 'article', 'code'], desc: ['description', 'désignation', 'designation', 'item', 'libellé', 'libelle', 'name', 'nom', 'product', 'produit'], price: ['unit price', 'prix unitaire', 'price', 'prix', 'pu', 'p.u.', 'cost', 'tarif', 'net price'], currency: ['currency', 'devise', 'cur'] };
/**
 * Tarif lu dans un onglet : ligne d'en-tête (la première avec au moins deux textes), colonnes devinées par leur nom
 * (réglables : mapping { part, desc, price, currency } = indices, -1 si absente). Rend { header, mapping, items: [{ part,
 * desc, price, currency }] }.
 */
export function priceList(sheet, mapping) {
  const rows = sheet.rows || [], hi = Math.max(0, rows.findIndex(r => r.filter(v => typeof v === 'string' && v.trim()).length >= 2)), header = (rows[hi] || []).map(v => str(v));
  const guess = k => { const H = header.map(norm); for (const g of GUESS[k]) { const i = H.findIndex(h => h === norm(g)); if (i >= 0) return i; } for (const g of GUESS[k]) { const i = H.findIndex(h => h.includes(norm(g))); if (i >= 0) return i; } return -1; };
  const m = { part: guess('part'), desc: guess('desc'), price: guess('price'), currency: guess('currency'), ...(mapping || {}) };
  const items = [];
  for (const r of rows.slice(hi + 1)) {
    const price = m.price >= 0 ? num(r[m.price]) : null; if (price == null || Number.isNaN(price) || price < 0) continue;
    const part = m.part >= 0 ? str(r[m.part]) : '', desc = m.desc >= 0 ? str(r[m.desc]) : '';
    if (!part && !desc) continue;
    items.push({ part, desc, price: +price.toFixed(4), currency: m.currency >= 0 ? str(r[m.currency]).toUpperCase().slice(0, 3) : '' });
  }
  return { header, mapping: m, headerRow: hi, items };
}
const compact = s => norm(s).replace(/[^a-z0-9]/g, '');
/**
 * Prix du tarif pour chaque ligne de la nomenclature : par référence fabricant (Part Number, sans ponctuation), sinon
 * par clé interne, sinon par désignation (égale, puis contenue). Rend [{ key, name, part, current, price, currency,
 * by: 'part'|'key'|'desc', item }] (lignes trouvées seulement).
 */
export function matchPrices(data, lan, list) {
  const T = csvTables(data, lan, { headers: 'standard' }), out = [];
  const byPart = new Map(), byDesc = new Map();
  // une référence (ou une désignation) en double dans le tarif : la première ligne compte, les suivantes sont signalées
  for (const it of list.items) { if (it.part && !byPart.has(compact(it.part))) byPart.set(compact(it.part), it); if (it.desc && !byDesc.has(norm(it.desc))) byDesc.set(norm(it.desc), it); }
  for (const r of T.bom.rows) {
    if (/^labour/.test(r.key)) continue;
    let it = null, by = '';
    if (r.part && byPart.has(compact(r.part))) { it = byPart.get(compact(r.part)); by = 'part'; }
    else if (byPart.has(compact(r.key))) { it = byPart.get(compact(r.key)); by = 'key'; }
    else if (byDesc.has(norm(r.name))) { it = byDesc.get(norm(r.name)); by = 'desc'; }
    else { const n = norm(r.name); for (const [d, x] of byDesc) if (d.length >= 6 && (n.includes(d) || d.includes(n))) { it = x; by = 'desc'; break; } }
    if (it) out.push({ key: r.key, name: r.name, part: r.part, current: r.price || 0, price: it.price, currency: it.currency, by, item: it });
  }
  return out;
}
/** Lignes de la nomenclature qu'un tarif peut renseigner (main-d'œuvre exclue) : [{ key, name, part, price }]. */
export const bomLines = (data, lan) => csvTables(data, lan, { headers: 'standard' }).bom.rows.filter(r => !/^labour/.test(r.key)).map(r => ({ key: r.key, name: r.name, part: r.part, price: r.price || 0 }));
/**
 * Lignes du tarif restées sans ligne de nomenclature, avec la raison : 'part' (référence inconnue, désignation non plus),
 * 'desc' (pas de référence, désignation inconnue), 'dup' (la ligne de nomenclature visée a déjà pris un autre prix).
 */
export function unmatchedPrices(data, lan, list, matches) {
  const used = new Set(matches.map(m => m.item)), lines = bomLines(data, lan);
  const byPart = new Set(lines.filter(l => l.part).map(l => compact(l.part))), byKey = new Set(lines.map(l => compact(l.key))), byDesc = new Set(lines.map(l => norm(l.name)));
  return list.items.filter(it => !used.has(it)).map(it => ({ item: it,
    reason: (it.part && (byPart.has(compact(it.part)) || byKey.has(compact(it.part)))) || (it.desc && byDesc.has(norm(it.desc))) ? 'dup' : it.part ? 'part' : 'desc' }));
}
/** Applique des prix (lignes retenues de matchPrices) ; currency : devise du projet à poser (facultatif). */
export function applyPrices(data, rows, currency) {
  const D = data.design && data.design.usage ? data.design : (data.design = cleanDesign(data.design));
  D.prices = { ...(D.prices || {}) };
  for (const r of rows) D.prices[r.key] = r.price;
  if (currency) D.currency = currency;
  data.design = cleanDesign(D);
  return rows.length;
}
export { readXlsx };
