// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Projets venus d'ailleurs (fichier reçu, projet de groupe, copie d'élève) : avant d'être
// chargés, leurs libellés sont nettoyés. Noms de composants, de blocs, de nœuds, rôles des fils…
// apparaissent dans l'interface : ils ne gardent ni chevrons, ni guillemets, ni caractères de
// contrôle (aucune balise ne peut s'y glisser), les couleurs doivent être des couleurs, les
// identifiants de simples mots. Deuxième barrière après la politique de sécurité (CSP).
import { normalize as cleanTimeline } from './video/timeline.js';
const BAD = /[<>"'`\u0000-\u001f\u007f\u2028\u2029]/g;
export const cleanText = (s, max = 80) => String(s ?? '').replace(BAD, '').slice(0, max);
export const cleanColor = (c, def = '#f2c94c') => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : def);
export const cleanId = s => (typeof s === 'string' && /^[\w.:-]{1,64}$/.test(s) ? s : null);
const pinKey = k => cleanText(k, 40);
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

/** Copie nettoyée d'un projet .jollof (les champs inconnus sont laissés tels quels). */
export function sanitizeProject(d) {
  if (!d || typeof d !== 'object') return { comps: [], wires: [] };
  const out = { ...d };
  if (out.name != null) out.name = cleanText(out.name, 120);
  out.comps = (Array.isArray(d.comps) ? d.comps : []).filter(c => c && cleanId(c.id) && typeof c.type === 'string' && /^[\w-]{1,40}$/.test(c.type)).map(c => {
    const o = { ...c, name: cleanText(c.name, 40), x: num(c.x), z: num(c.z), r: num(c.r) };
    if (c.custom && typeof c.custom === 'object') {
      o.custom = { ...c.custom, name: cleanText(c.custom.name, 60) };
      if (Array.isArray(c.custom.pins)) o.custom.pins = c.custom.pins.map(p => ({ ...p, name: cleanText(p && p.name, 40), role: cleanText(p && p.role, 20) }));
    }
    return o;
  });
  out.wires = (Array.isArray(d.wires) ? d.wires : []).filter(w => w && Array.isArray(w.a) && Array.isArray(w.b)).map(w => ({
    ...w, a: [cleanId(w.a[0]), pinKey(w.a[1])], b: [cleanId(w.b[0]), pinKey(w.b[1])], color: cleanColor(w.color), role: w.role == null ? w.role : cleanText(w.role, 80)
  })).filter(w => w.a[0] && w.b[0]);
  if (Array.isArray(d.blocks)) out.blocks = d.blocks.map(b => ({ ...b, id: cleanId(b && b.id) || undefined, name: cleanText(b && b.name, 40), color: cleanColor(b && b.color, '#e0703a'), comps: Array.isArray(b && b.comps) ? b.comps.map(cleanId).filter(Boolean) : [] }));
  if (d.settings && typeof d.settings === 'object') {
    out.settings = { ...d.settings };
    const nn = d.settings.netNames;
    if (nn && typeof nn === 'object') out.settings.netNames = Object.fromEntries(Object.entries(nn).slice(0, 2000).map(([k, v]) => [cleanText(k, 200), cleanText(v, 40)]));
    const v3 = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
    if (Array.isArray(d.settings.shots)) out.settings.shots = d.settings.shots.slice(0, 50).filter(s => s && v3(s.p) && v3(s.t)).map(s => ({ ...s, id: cleanId(s.id) || undefined, name: s.name != null ? cleanText(s.name, 40) : s.name }));
    // Timeline de la vidéo : nombres bornés, identifiants vérifiés, légendes nettoyées (null si invalide).
    if (d.settings.timeline != null) out.settings.timeline = cleanTimeline(d.settings.timeline, cleanText);
    // Avertissements acceptés du vérificateur : code J0000, composant et raison nettoyés, au plus 200.
    // Programmes : mémoire des cartes (EEPROM, Preferences) et réseau simulé (Wi-Fi, journal), bornés et typés.
    const pg = d.settings.prog;
    if (pg && typeof pg === 'object') {
      out.settings.prog = { ...pg };
      if (pg.mem != null) out.settings.prog.mem = cleanMem(pg.mem);
      if (pg.net != null) out.settings.prog.net = cleanNet(pg.net);
    }
    const ck = d.settings.check;
    if (ck != null) out.settings.check = { allow: (ck && Array.isArray(ck.allow) ? ck.allow : []).slice(0, 200).filter(x => x && /^J\d{4}$/.test(x.code)).map(x => ({ code: x.code, comp: x.comp == null ? null : cleanId(x.comp) || null, reason: cleanText(x.reason || '', 160) })) };
  }
  return out;
}

/** Types des valeurs de Preferences : entiers, float, booléen, texte (S), octets (B). */
const PREF_TYPES = new Set(['i', 'u', 'l', 'ul', 's', 'us', 'c', 'uc', 'f', 'd', 'b', 'S', 'B']);
const prefValue = (t, v) => {
  if (t === 'b') return !!v;
  if (t === 'S') return String(v ?? '').replace(/\u0000/g, '').slice(0, 4000);
  if (t === 'B') return Array.isArray(v) ? v.slice(0, 512).map(x => num(x) & 255) : [];
  return num(v);
};
/** Mémoire des cartes : EEPROM en hexadécimal (4096 octets au plus), espaces de noms et clés de Preferences (15 caractères). */
function cleanMem(m) {
  if (!m || typeof m !== 'object') return {};
  const out = {};
  for (const [id, v] of Object.entries(m).slice(0, 64)) {
    if (!cleanId(id) || !v || typeof v !== 'object') continue;
    const prefs = {};
    for (const [ns, keys] of Object.entries(v.prefs && typeof v.prefs === 'object' ? v.prefs : {}).slice(0, 32)) {
      if (!ns || ns.length > 15 || !keys || typeof keys !== 'object') continue;
      const kv = {};
      for (const [k, e] of Object.entries(keys).slice(0, 500)) if (k && k.length <= 15 && Array.isArray(e) && PREF_TYPES.has(e[0])) kv[k] = [e[0], prefValue(e[0], e[1])];
      prefs[ns] = kv;
    }
    out[id] = { ee: typeof v.ee === 'string' && /^[0-9a-f]*$/i.test(v.ee) ? v.ee.slice(0, 8192) : '', prefs };
  }
  return out;
}
/** Réseau simulé : quelques réseaux Wi-Fi (nom, mot de passe, signal) et les mesures du journal. */
function cleanNet(n) {
  if (!n || typeof n !== 'object' || !Array.isArray(n.networks)) return null;
  const networks = n.networks.slice(0, 6).filter(x => x && typeof x.ssid === 'string' && x.ssid.trim())
    .map(x => ({ ssid: cleanText(x.ssid, 32), pass: cleanText(x.pass, 63), rssi: Math.max(-100, Math.min(-20, Math.round(num(x.rssi, -60)))) }));
  const journal = (Array.isArray(n.journal) ? n.journal : []).slice(-200).filter(e => e && e.f && typeof e.f === 'object').map(e => ({
    id: Math.max(0, Math.round(num(e.id))), t: num(e.t),
    f: Object.fromEntries(Object.entries(e.f).filter(([k, v]) => /^field[1-8]$/.test(k) && Number.isFinite(+v)).map(([k, v]) => [k, +v]))
  }));
  return { networks: networks.length ? networks : [{ ssid: 'Ecole-WiFi', pass: 'jollof2024', rssi: -52 }], journal };
}
