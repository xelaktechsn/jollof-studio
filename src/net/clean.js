// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Plan réseau lu dans un fichier (.jollof, TP, outil de l'IA) : chaque champ vérifié, rien d'inattendu ne passe.
import { DEVICES, specOf } from './devices.js';
import { cleanCableEnds, CATS } from './cable.js';
import { prefixOf, isIp } from './ip.js';
import { cleanText } from '../sanitize.js';

const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
const ipOr = v => (isIp(v) ? String(v).trim() : '');
const txt = (v, n) => cleanText(String(v ?? ''), n);
function cleanIp(c) {
  const o = c && typeof c === 'object' ? c : {};
  return { mode: ['dhcp', 'static', 'none'].includes(o.mode) ? o.mode : 'dhcp', ip: ipOr(o.ip), prefix: prefixOf(o.prefix) ?? 24, gw: ipOr(o.gw), dns: ipOr(o.dns) };
}
const regs = r => { const o = r && typeof r === 'object' ? r : {}; const t = (a, bit) => Array.from({ length: 16 }, (_, i) => { const v = Array.isArray(a) ? +a[i] || 0 : 0; return bit ? (v ? 1 : 0) : v & 0xffff; }); return { coils: t(o.coils, 1), di: t(o.di, 1), hr: t(o.hr), ir: t(o.ir) }; };
/** Propriétés d'un équipement : celles de son type, valeurs bornées. */
function cleanProps(type, p) {
  const d = DEVICES[type].props(), s = p && typeof p === 'object' ? p : {};
  if ('ip' in d) d.ip = cleanIp(s.ip || d.ip);
  if ('legacy' in d) d.legacy = !!s.legacy;
  if ('wifi' in d && type === 'laptop') d.wifi = { ssid: txt(s.wifi && s.wifi.ssid, 32), pass: txt(s.wifi && s.wifi.pass, 63) };
  if (type === 'router') {
    const l = s.lan || {}, h = s.dhcp || {}, w = s.wifi || {};
    d.lan = { ip: ipOr(l.ip) || '192.168.1.1', prefix: prefixOf(l.prefix) ?? 24 };
    d.dhcp = { on: h.on !== false, from: num(h.from, 1, 254, 100) | 0, to: num(h.to, 1, 254, 199) | 0 };
    d.wan = cleanIp(s.wan || { mode: 'none' });
    d.wifi = { on: !!w.on, ssid: txt(w.ssid ?? 'Box-Jollof', 32), pass: txt(w.pass ?? '', 63) };
  }
  if (type === 'ap') { d.ssid = txt(s.ssid ?? d.ssid, 32); d.pass = txt(s.pass ?? d.pass, 63); }
  if ('power' in d) d.power = s.power === 'adapter' ? 'adapter' : 'poe';
  if ('poeClass' in d) d.poeClass = num(s.poeClass, 0, 8, d.poeClass) | 0;
  if (type === 'poeswitch') { d.budget = num(s.budget, 0, 2000, d.budget); d.pseType = ['af', 'at', 'bt3', 'bt4'].includes(s.pseType) ? s.pseType : d.pseType; d.portW = num(s.portW, 0, 100, d.portW); }
  if (type === 'plc') d.regs = regs(s.regs);
  return d;
}
/** Plan propre : { devices, cables, ext, view } (ids uniques, câbles entre ports existants, un câble par port). */
export function cleanNet(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}, ids = new Set(), devices = [];
  for (const d of Array.isArray(r.devices) ? r.devices.slice(0, 300) : []) {
    if (!d || !DEVICES[d.type]) continue;
    const id = txt(d.id, 40) || 'n' + (devices.length + 1); if (ids.has(id)) continue; ids.add(id);
    devices.push({ id, type: d.type, x: num(d.x, -1e5, 1e5, 0), y: num(d.y, -1e5, 1e5, 0), name: txt(d.name, 24) || id, p: cleanProps(d.type, d.p) });
  }
  const ext = {};
  if (r.ext && typeof r.ext === 'object') for (const [k, v] of Object.entries(r.ext).slice(0, 100)) if (v && typeof v === 'object') ext[txt(k, 60)] = { x: num(v.x, -1e5, 1e5, 0), y: num(v.y, -1e5, 1e5, 0) };
  const portOk = ([n, p]) => { if (String(n).startsWith('e:')) return typeof p === 'string' && p.length < 12; const d = devices.find(x => x.id === n); return !!d && specOf(d).ports(d.p).some(x => x.id === p); };
  const used = new Set(), cables = [], cids = new Set();
  for (const c of Array.isArray(r.cables) ? r.cables.slice(0, 600) : []) {
    if (!c || !Array.isArray(c.a) || !Array.isArray(c.b)) continue;
    const a = [txt(c.a[0], 60), txt(c.a[1], 12)], b = [txt(c.b[0], 60), txt(c.b[1], 12)];
    if (!portOk(a) || !portOk(b) || (a[0] === b[0] && a[1] === b[1])) continue;
    const ka = a.join('|'), kb = b.join('|'); if (used.has(ka) || used.has(kb)) continue; used.add(ka); used.add(kb);
    let id = txt(c.id, 40) || 'c' + (cables.length + 1); while (cids.has(id)) id += '_'; cids.add(id);
    cables.push({ id, a, b, cat: CATS[c.cat] ? c.cat : 'cat6', len: num(c.len, 0.1, 500, 3), wire: cleanCableEnds(c.wire) });
  }
  return { devices, cables, ext, view: r.view === 'net' ? 'net' : 'elec' };
}
