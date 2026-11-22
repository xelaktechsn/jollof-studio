// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Import d'un schéma Visio (.vsdx) dans le schéma logique (module pur, sans interface) : formes de base et connecteurs
// collés → équipements et câbles, après un choix de correspondance (type d'équipement par gabarit ou par sorte de
// forme). Lecture par vsdx.js (readVsdx). Ce qui est repris : la position (ramenée au schéma logique), le texte (nom),
// les données de forme « IP » (adresse fixe) et, pour un connecteur, « Category » / « Length » et les ports « PortA » /
// « PortB » quand le fichier les porte (nos exports : rebranché au même port), sinon le premier port libre. Ce qui ne l'est pas :
// groupes (seule la forme du dessus compte), images, conteneurs, géométrie des plans (pour les plans : import DXF ou IFC).
//
// planVsdx(lu) → { pages: [{ index, name, shapes: [{ id, key, text, x, y, w, h, props }], links: [{ id, a, b, text,
//   props }], groups: [{ key, label, count, sample, guess }] }] }
// guessType(clé, textes) → type d'équipement de devices.js ou ''.
// findDuplicates(data, page, mapping) → Map(id de forme → équipement déjà présent) (nom, étiquette, adresse IP).
// applyVsdx(data, page, mapping { clé: type | '' }, deps { newDevice(type, { x, y }), addCable(a, b, o) }, { dup: 'update'|'skip'|'add' })
//   → { devices, cables, updated, matched, existing, skipped: { shapes, links, ports } } (avant l'unique ctx.commit()).
import { DEVICES, specOf } from '../devices.js';
import { CATS } from '../cable.js';
import { labeler } from '../docs.js';

const DEV_TYPES = new Set(Object.keys(DEVICES).filter(t => DEVICES[t].role !== 'mech'));
/** Mots reconnus dans le nom d'un gabarit ou le texte des formes (français et anglais), du plus précis au plus général. */
const WORDS = [
  [/\bl3\b|core|c(œ|oe)ur|niveau 3|layer 3/, 'l3switch'], [/switch|commutateur|\bsw\b/, 'switch24'], [/router|routeur|firewall|pare-feu|\brt\b|gateway|passerelle/, 'routerpro'],
  [/access ?point|point d.acc|\bap\b|wi-?fi|wlan/, 'ap'], [/server|serveur|\bsrv\b/, 'server'], [/\bnas\b|storage|stockage/, 'nas'],
  [/laptop|portable|notebook/, 'laptop'], [/printer|imprim/, 'printer'], [/camera|cam(é|e)ra|\bcam\b|cctv/, 'camera'], [/phone|t(é|e)l(é|e)phone|\btel\b|voip/, 'phone'],
  [/fibre|fiber|\bfo\b|odf/, 'fibrepanel'], [/patch|brassage|\bpb\b/, 'patch24'], [/outlet|prise|\bpr\b|jack|socket/, 'outlet'],
  [/\bpc\b|poste|desktop|workstation|computer|ordinateur|client/, 'pc']
];
export function guessType(key, texts = []) {
  const k = String(key || '');
  if (DEV_TYPES.has(k)) return k; // nos propres fichiers : le gabarit porte le type
  const hay = (k + ' ' + texts.slice(0, 8).join(' ')).toLowerCase();
  for (const [re, t] of WORDS) if (re.test(hay) && DEV_TYPES.has(t)) return t;
  return '';
}

const propVal = (props, ...names) => { for (const [k, o] of Object.entries(props || {})) { const lk = k.toLowerCase(), ll = String(o.label || '').toLowerCase(); if (names.some(n => lk === n || ll === n)) return String(o.value ?? '').trim(); } return ''; };

/** Pages lisibles d'un fichier lu : formes candidates (pas les connecteurs, ni les textes seuls), liens, groupes. */
export function planVsdx(r) {
  return {
    pages: r.pages.map((pg, index) => {
      const top = pg.shapes.filter(s => s.depth === 0), byId = new Map(top.map(s => [s.id, s]));
      const shapes = top.filter(s => !s.oneD && (s.master != null || s.geom.length) && s.w > 0 && s.h > 0).map(s => ({
        id: s.id, key: s.master != null ? s.masterName || 'master:' + s.master : s.geom.some(g => g.ellipse) ? '#ellipse' : '#shape', text: s.text, x: s.x, y: s.y, w: s.w, h: s.h, props: s.props
      }));
      const ok = new Set(shapes.map(s => s.id)), ends = new Map();
      for (const c of pg.connects) {
        const e = ends.get(c.from) || {}; if (c.fromCell === 'BeginX' || c.fromPart === 9) e.a = c.to; else if (c.fromCell === 'EndX' || c.fromPart === 12) e.b = c.to; ends.set(c.from, e);
      }
      // Connecteurs sans élément Connect : formules de collage « Sheet.n! » de BeginX / EndX.
      for (const s of top) if (s.oneD && s.glue && !ends.has(s.id)) { const m = s.glue.map(f => /Sheet\.(\d+)!/.exec(f || '')); if (m[0] && m[1]) ends.set(s.id, { a: +m[0][1], b: +m[1][1] }); }
      const links = [];
      for (const [id, e] of ends) { const s = byId.get(id); if (!s || e.a == null || e.b == null || e.a === e.b || !ok.has(e.a) || !ok.has(e.b)) continue; links.push({ id, a: e.a, b: e.b, text: s.text, props: s.props }); }
      const groups = new Map();
      for (const s of shapes) { const g = groups.get(s.key) || { key: s.key, count: 0, texts: [] }; g.count++; if (s.text && g.texts.length < 8) g.texts.push(s.text); groups.set(s.key, g); }
      return {
        index, name: pg.name, shapes, links,
        groups: [...groups.values()].map(g => ({ key: g.key, label: g.key === '#ellipse' ? 'ellipse' : g.key === '#shape' ? 'shape' : g.key, count: g.count, sample: g.texts.slice(0, 3).join(', '), guess: guessType(g.key.startsWith('#') ? '' : g.key, g.texts) }))
      };
    })
  };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;
const normName = v => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
const ipOfText = v => { const m = IPV4.exec(String(v || '').replace(/\s*\(dhcp\)$/i, '').trim()); return m && m.slice(1, 5).every(n => +n <= 255) ? { ip: m.slice(1, 5).join('.'), prefix: m[5] ? Math.min(32, +m[5]) : null } : null; };
const roleOf = t => (DEVICES[t] || {}).role;
/**
 * Formes qui correspondent à un équipement déjà dans le projet (même rôle : switch, poste, prise…) : par nom, sinon par
 * étiquette (identifiant de prise ou de panneau, étiquette forcée), sinon par adresse IP fixe. → Map(id de forme → équipement).
 */
export function findDuplicates(data, page, mapping) {
  const devs = data.devices || [], out = new Map(); if (!devs.length) return out;
  const L = labeler(data), by = { name: new Map(), label: new Map(), ip: new Map() };
  for (const d of devs) {
    const r = roleOf(d.type), add = (m, k) => { if (k && !m.has(r + '|' + k)) m.set(r + '|' + k, d); };
    add(by.name, normName(d.name)); add(by.label, normName(d.tag)); add(by.label, normName(L.of(d.id)));
    const ip = d.p && d.p.ip && d.p.ip.mode === 'static' ? d.p.ip.ip : ''; add(by.ip, ip);
  }
  const taken = new Set();
  for (const s of page.shapes) {
    const t = mapping[s.key]; if (!DEV_TYPES.has(t || '')) continue;
    const r = roleOf(t), ip = ipOfText(propVal(s.props, 'ip', 'adresse ip', 'ip address'));
    const d = by.name.get(r + '|' + normName(s.text)) || by.label.get(r + '|' + normName(propVal(s.props, 'label', 'étiquette'))) || (ip && by.ip.get(r + '|' + ip.ip));
    if (d && !taken.has(d.id)) { taken.add(d.id); out.set(s.id, d); }
  }
  return out;
}

/**
 * Verse une page dans le projet : équipements aux positions du dessin (schéma logique), câbles entre ports libres.
 * o.dup : que faire des formes qui ont déjà leur équipement (findDuplicates) — 'update' (garder l'équipement, reprendre son
 * adresse IP du fichier, relier les câbles qui manquent), 'skip' (garder l'équipement tel quel, relier les câbles qui
 * manquent), 'add' (tout ajouter en double). Un câble déjà présent entre les mêmes équipements n'est pas refait.
 */
export function applyVsdx(data, page, mapping, deps, o = {}) {
  const out = { devices: 0, cables: 0, updated: 0, matched: 0, existing: 0, skipped: { shapes: 0, links: 0, ports: 0 } }, made = new Map();
  const keep = page.shapes.filter(s => DEV_TYPES.has(mapping[s.key] || '')); out.skipped.shapes = page.shapes.length - keep.length;
  if (!keep.length || !deps || !deps.newDevice) return out;
  const dup = o.dup === 'add' ? new Map() : findDuplicates(data, page, mapping);
  // Repère du dessin (pouces, y vers le haut) → schéma logique (px, y vers le bas), ramené à une largeur raisonnable.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of keep) { x0 = Math.min(x0, s.x - s.w / 2); x1 = Math.max(x1, s.x + s.w / 2); y0 = Math.min(y0, s.y - s.h / 2); y1 = Math.max(y1, s.y + s.h / 2); }
  const k = Math.min(100, 4000 / Math.max(1e-6, x1 - x0, y1 - y0)), ox = 80, oy = 80;
  const used = new Set(), pairs = new Set(), pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  for (const c of data.cables || []) { used.add(c.a.join('|')); used.add(c.b.join('|')); pairs.add(pairKey(c.a[0], c.b[0])); }
  const setIp = (d, s) => { const ip = ipOfText(propVal(s.props, 'ip', 'adresse ip', 'ip address')); if (!ip || !d.p || !d.p.ip) return false; if (d.p.ip.mode === 'static' && d.p.ip.ip === ip.ip && (ip.prefix == null || d.p.ip.prefix === ip.prefix)) return false; d.p.ip = { ...d.p.ip, mode: 'static', ip: ip.ip, prefix: ip.prefix ?? d.p.ip.prefix ?? 24 }; return true; };
  for (const s of keep) {
    const ex = dup.get(s.id);
    if (ex) { made.set(s.id, ex); out.matched++; if (o.dup !== 'skip' && setIp(ex, s)) out.updated++; continue; }
    const type = mapping[s.key], sp = DEVICES[type];
    const cx = ox + (s.x - x0) * k, cy = oy + (y1 - s.y) * k;
    const d = deps.newDevice(type, { x: Math.round(cx - sp.w / 2), y: Math.round(cy - sp.h / 2) }); if (!d) { out.skipped.shapes++; continue; }
    const name = String(s.text || '').replace(/\s+/g, ' ').trim().slice(0, 24); if (name) d.name = name;
    setIp(d, s);
    made.set(s.id, d); out.devices++;
  }
  const freePort = (d, want) => {
    const ports = (specOf(d) || { ports: () => [] }).ports(d.p || {});
    if (want && ports.some(p => p.id === want) && !used.has(d.id + '|' + want)) return want; // port noté dans le fichier (nos exports)
    const pick = ports.find(p => !used.has(d.id + '|' + p.id) && !p.sfp && !/^b/.test(p.passive ? p.id : '')) || ports.find(p => !used.has(d.id + '|' + p.id));
    return pick ? pick.id : null;
  };
  for (const l of page.links) {
    const A = made.get(l.a), B = made.get(l.b); if (!A || !B) { out.skipped.links++; continue; }
    if (dup.size && pairs.has(pairKey(A.id, B.id))) { out.existing++; continue; } // déjà câblés entre eux avant l'import
    const pa = freePort(A, propVal(l.props, 'porta')), pb = freePort(B, propVal(l.props, 'portb')); if (!pa || !pb) { out.skipped.ports++; continue; }
    used.add(A.id + '|' + pa); used.add(B.id + '|' + pb);
    const len = parseFloat(String(propVal(l.props, 'length', 'longueur (m)', 'length (m)', 'longueur')).replace(',', '.'));
    const catTxt = propVal(l.props, 'category', 'catégorie').toLowerCase().replace(/\s|cat(égorie)?/g, ''), cat = Object.keys(CATS).find(c => c.replace('cat', '') === catTxt);
    if (deps.addCable) { deps.addCable([A.id, pa], [B.id, pb], { ...(Number.isFinite(len) && len > 0 ? { len: Math.min(100000, len) } : {}), ...(cat ? { cat } : {}) }); out.cables++; }
  }
  return out;
}
