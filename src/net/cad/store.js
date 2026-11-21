// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fonds de plan vectoriels (DXF/DWG importés) dans le modèle réseau : nettoyage de data.underlays (un fond par étage)
// et de data.blobs (les données binaires compactes, hors historique comme data.images), codage base64.
//
// data.underlays = { [floorId]: {
//   id,                       // clé de data.blobs (les segments compacts, underlay.js packUnderlay)
//   name, on,                 // nom affiché, fond visible ou non
//   source: { file, units, insunits },   // fichier d'origine, unité retenue à l'import
//   origin: [x, y], toMetre, region: [x0, y0, x1, y1],   // repère du dessin (unités du dessin), zone gardée
//   transform: { dx, dy, rot (degrés), scale },   // repère du fond (m) → repère de l'étage (m) : tourner, mettre à
//                                                  // l'échelle autour de (0, 0), puis décaler
//   layers: [{ id (numéro dans le paquet), name, color '#rrggbb', on, dim, lock (ni choix ni aimant), recolor? (couleur
//              choisie par l'utilisateur, gardée d'une version à l'autre) }],
//   rev: { n, file, at (ms), added, removed, changed } | absent : dernière mise à jour depuis une nouvelle version du fichier,
//   mono, opacity,            // monochrome, opacité d'ensemble
//   pack: { … },              // en-tête du paquet (meta de packUnderlay), JSON borné
//   stats: { segs, texts, bytes }
// } }
// data.blobs = { [id]: 'data:application/octet-stream;base64,…' } : seuls ceux d'un fond sont gardés. Une réserve de
// session garde les données retirées par une annulation pour que « rétablir » les retrouve (l'historique ne les porte pas).
import { cleanText } from '../../sanitize.js';

export const UL_MAX = { underlays: 80, layers: 2000, blobs: 80, blobChars: 96e6, pack: 64e3, pool: 24 };
const ID = /^[\w.:-]{1,40}$/;
const PREFIX = 'data:application/octet-stream;base64,';
const UNITS = ['m', 'cm', 'mm', 'in', 'ft', 'unitless'];
const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
const fin = (v, d = 0) => (Number.isFinite(+v) && Math.abs(+v) < 1e12 ? +v : d);
const txt = (v, n) => cleanText(String(v ?? ''), n);
const hex = c => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : '#ffffff');
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Copie JSON bornée d'un en-tête de paquet (nombres finis, textes courts, profondeur 5) ; null si trop gros. */
export function cleanJson(v, depth = 0) {
  if (v == null || typeof v === 'boolean') return v ?? null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') return txt(v, 200);
  if (depth > 5) return null;
  if (Array.isArray(v)) return v.slice(0, 4000).map(x => cleanJson(x, depth + 1));
  if (typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v).slice(0, 200)) if (/^[\w.$-]{1,40}$/.test(k)) o[k] = cleanJson(x, depth + 1); return o; }
  return null;
}

function cleanLayers(raw) {
  const out = [], seen = new Set();
  for (const l of (Array.isArray(raw) ? raw : []).slice(0, UL_MAX.layers)) {
    if (!l || typeof l !== 'object') continue;
    const id = +l.id; if (!Number.isInteger(id) || id < 0 || id > 65535 || seen.has(id)) continue; seen.add(id);
    const o = { id, name: txt(l.name, 120), color: hex(l.color), on: l.on !== false, dim: !!l.dim, lock: !!l.lock };
    if (l.recolor) o.recolor = true;
    out.push(o);
  }
  return out;
}

const cleanRev = r => ({ n: Math.trunc(num(r.n, 1, 1e6, 1)), file: txt(r.file, 160), at: Math.trunc(num(r.at, 0, 1e14, 0)), added: Math.trunc(num(r.added, 0, 1e9, 0)), removed: Math.trunc(num(r.removed, 0, 1e9, 0)), changed: Math.trunc(num(r.changed, 0, 1e9, 0)) });
/** Un fond nettoyé, ou null. */
export function cleanUnderlay(u) {
  if (!u || typeof u !== 'object' || typeof u.id !== 'string' || !ID.test(u.id)) return null;
  const s = obj(u.source), t = obj(u.transform), o = Array.isArray(u.origin) ? u.origin : [], r = Array.isArray(u.region) ? u.region : [];
  let region = [0, 1, 2, 3].map(i => fin(r[i]));
  if (!(region[2] > region[0]) || !(region[3] > region[1])) region = [0, 0, 0, 0];
  let pack = cleanJson(obj(u.pack)); if (JSON.stringify(pack).length > UL_MAX.pack) pack = {};
  const st = obj(u.stats);
  return {
    id: u.id, name: txt(u.name, 120), on: u.on !== false,
    source: { file: txt(s.file, 160), units: UNITS.includes(s.units) ? s.units : 'unitless', insunits: Math.trunc(num(s.insunits, 0, 30, 0)) },
    origin: [fin(o[0]), fin(o[1])], toMetre: num(u.toMetre, 1e-6, 1e4, 1), region,
    transform: { dx: num(t.dx, -1e5, 1e5, 0), dy: num(t.dy, -1e5, 1e5, 0), rot: ((num(t.rot, -1e6, 1e6, 0) % 360) + 360) % 360, scale: num(t.scale, 1e-4, 1e4, 1) },
    layers: cleanLayers(u.layers), mono: !!u.mono, opacity: num(u.opacity, 0.05, 1, 0.8),
    pack, stats: { segs: Math.trunc(num(st.segs, 0, 1e9, 0)), texts: Math.trunc(num(st.texts, 0, 1e9, 0)), bytes: Math.trunc(num(st.bytes, 0, 1e10, 0)) },
    ...(u.rev && typeof u.rev === 'object' ? { rev: cleanRev(u.rev) } : {})
  };
}

/**
 * data.underlays nettoyé. floorIds (Set ou tableau, facultatif) : les fonds des étages disparus sont retirés. Deux étages
 * ne partagent jamais le même paquet (le second est retiré).
 */
export function cleanUnderlays(raw, floorIds) {
  const out = {}, ids = new Set(), fl = floorIds ? new Set(floorIds) : null;
  for (const [k, v] of Object.entries(obj(raw)).slice(0, UL_MAX.underlays)) {
    if (!ID.test(k) || (fl && !fl.has(k))) continue;
    const u = cleanUnderlay(v); if (!u || ids.has(u.id)) continue;
    ids.add(u.id); out[k] = u;
  }
  return out;
}

/* ---------- Données binaires ---------- */
const pool = new Map(); // id → data URL (réserve de session, la plus récente en dernier)
const okCache = new Set(); // textes déjà vérifiés (un long texte n'est parcouru qu'une fois)
function validBlob(v) {
  if (typeof v !== 'string' || v.length > UL_MAX.blobChars || !v.startsWith(PREFIX)) return false;
  if (okCache.has(v)) return true;
  // Base64 : longueur multiple de 4, alphabet seul (recherche d'un caractère interdit, plus rapide qu'un motif complet).
  if ((v.length - PREFIX.length) % 4 || /[^A-Za-z0-9+/=]/.test(v.slice(PREFIX.length))) return false;
  if (okCache.size > 32) okCache.clear(); okCache.add(v);
  return true;
}
function remember(id, v) { pool.delete(id); pool.set(id, v); while (pool.size > UL_MAX.pool) pool.delete(pool.keys().next().value); }

/** data.blobs nettoyé : seuls les paquets des fonds (underlays nettoyés) restent ; un paquet absent revient de la réserve. */
export function cleanBlobs(raw, underlays) {
  const out = {}, r = obj(raw);
  for (const u of Object.values(obj(underlays))) {
    if (!u || Object.keys(out).length >= UL_MAX.blobs) break;
    const v = Object.prototype.hasOwnProperty.call(r, u.id) ? r[u.id] : undefined;
    if (validBlob(v)) { out[u.id] = v; remember(u.id, v); }
    else if (pool.has(u.id)) out[u.id] = pool.get(u.id);
  }
  return out;
}
/** Garde un paquet dans la réserve de session (à l'import, avant un retrait) : « annuler » le retrouvera. */
export function rememberBlob(id, url) { if (typeof id === 'string' && ID.test(id) && validBlob(url)) remember(id, url); }
/** Vide la réserve de session (tests). */
export function clearPool() { pool.clear(); okCache.clear(); }

/** Octets → data URL (navigateur : FileReader natif ; Node : Buffer). */
export function bytesToDataUrl(bytes) {
  if (typeof Buffer !== 'undefined' && typeof window === 'undefined') return Promise.resolve(PREFIX + Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'));
  return new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).replace(/^data:[^,]*,/, PREFIX)); rd.onerror = () => rej(rd.error); rd.readAsDataURL(new Blob([bytes], { type: 'application/octet-stream' })); });
}
/** Data URL → Uint8Array. */
export async function dataUrlToBytes(url) {
  if (typeof url !== 'string' || !url.startsWith(PREFIX)) throw new Error('blob');
  if (typeof Buffer !== 'undefined' && typeof window === 'undefined') return new Uint8Array(Buffer.from(url.slice(PREFIX.length), 'base64'));
  try { return new Uint8Array(await (await fetch(url)).arrayBuffer()); }
  catch (e) { const s = atob(url.slice(PREFIX.length)), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
}
/** Taille en octets des données d'un data URL base64 (sans le décoder). */
export function blobBytes(url) {
  if (typeof url !== 'string') return 0;
  const n = url.length - PREFIX.length; if (n <= 0) return 0;
  return Math.floor(n * 3 / 4) - (url.endsWith('==') ? 2 : url.endsWith('=') ? 1 : 0);
}
/** État de session partagé entre l'assistant et le calque du plan : carte « Et maintenant ? » après un import. */
export const cadSession = { coach: null };
/** Identifiant neuf d'un paquet. */
export const newBlobId = () => 'cad' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
