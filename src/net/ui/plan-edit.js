// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vue Plans : édition de la sélection (copier, couper, coller, dupliquer d'un étage à l'autre, aligner, répartir) et
// liens vers les autres vues (câblage, brassage, adressage, certification, baie). Fonctions pures sur le modèle, sauf
// jumpsFor qui prépare des actions de navigation (ctx).
import { tl, isEn } from '../../i18n/index.js';
import { siteIds, uid } from '../site.js';
import { DEVICES } from '../devices.js';

const r3 = v => Math.round(v * 1000) / 1000;
const deep = o => JSON.parse(JSON.stringify(o));

/**
 * Presse-papiers du plan : copie des objets choisis de l'étage (équipements posés, pièces, murs et leurs portes,
 * cheminements). Les câbles ne sont pas copiés (un équipement collé n'est relié à rien : rien n'est relié en silence).
 * Rend { from (étage), items: { devices, rooms, walls, doors, paths }, box: [x0, y0, x1, y1] } ou null.
 */
export function copySel(data, floor, multi) {
  const ids = k => new Set(multi.filter(m => m.kind === k).map(m => m.id));
  const dv = ids('dev'), rm = ids('room'), wl = ids('wall'), pa = ids('path');
  const items = {
    devices: data.devices.filter(d => dv.has(d.id) && d.loc && d.loc.floor === floor.id).map(d => ({ type: d.type, name: d.name, p: deep(d.p), loc: { ...d.loc }, tag: d.tag })),
    rooms: floor.rooms.filter(r => rm.has(r.id)).map(deep),
    walls: floor.walls.filter(w => wl.has(w.id)).map(deep),
    paths: (data.paths || []).filter(p => pa.has(p.id) && p.floor === floor.id && p.kind !== 'outdoor').map(deep)
  };
  items.doors = floor.doors.filter(x => wl.has(x.wall)).map(deep);
  const P = [...items.devices.map(d => [d.loc.x, d.loc.y]), ...items.rooms.flatMap(r => r.poly), ...items.walls.flatMap(w => [w.a, w.b]), ...items.paths.flatMap(p => p.pts)];
  if (!P.length) return null;
  const box = [Math.min(...P.map(q => q[0])), Math.min(...P.map(q => q[1])), Math.max(...P.map(q => q[0])), Math.max(...P.map(q => q[1]))];
  return { from: floor.id, items, box };
}
/**
 * Colle le presse-papiers sur un étage, décalé de (dx, dy) mètres : nouveaux ids partout (site, cheminements,
 * équipements : nom suivant de leur type), portes rattachées aux murs collés. newDevice(type, at) : ctx.newDevice.
 * Rend la nouvelle sélection [{ kind, id }].
 */
export function pasteClip(data, floor, clip, dx, dy, newDevice) {
  if (!clip) return [];
  const sel = [], used = siteIds(data.site), wmap = new Map(), mv = q => [r3(q[0] + dx), r3(q[1] + dy)];
  for (const w of clip.items.walls) { const id = uid('', 'w', used); wmap.set(w.id, id); floor.walls.push({ ...deep(w), id, a: mv(w.a), b: mv(w.b) }); sel.push({ kind: 'wall', id }); }
  for (const d of clip.items.doors) if (wmap.has(d.wall)) floor.doors.push({ ...deep(d), id: uid('', 'dr', used), wall: wmap.get(d.wall) });
  for (const r of clip.items.rooms) { const id = uid('', 'rm', used); floor.rooms.push({ ...deep(r), id, poly: r.poly.map(mv), ...(r.holes ? { holes: r.holes.map(h => h.map(mv)) } : {}) }); delete floor.rooms[floor.rooms.length - 1].src; sel.push({ kind: 'room', id }); }
  data.paths = data.paths || []; const pids = new Set(data.paths.map(p => p.id));
  for (const p of clip.items.paths) {
    let i = 1; while (pids.has('pa' + i)) i++; pids.add('pa' + i);
    const o = { ...deep(p), id: 'pa' + i, floor: floor.id, pts: p.pts.map(mv) }; delete o.src;
    if (o.kind === 'riser' && o.top === p.floor) o.top = floor.id;
    data.paths.push(o); sel.push({ kind: 'path', id: o.id });
  }
  for (const d of clip.items.devices) {
    if (!DEVICES[d.type]) continue;
    const n = newDevice(d.type, { x: Math.round((d.loc.x + dx) * 20), y: Math.round((d.loc.y + dy) * 20) });
    n.p = deep(d.p); n.loc = { ...d.loc, floor: floor.id, x: r3(d.loc.x + dx), y: r3(d.loc.y + dy) };
    sel.push({ kind: 'dev', id: n.id });
  }
  return sel;
}
/** Points d'ancrage d'un objet choisi (pour aligner) : { x, y } (centre de son emprise) et de quoi le déplacer. */
function anchors(data, floor, multi) {
  const out = [];
  for (const m of multi) {
    let P = null, move = null;
    if (m.kind === 'dev') { const d = data.devices.find(x => x.id === m.id); if (d && d.loc) { P = [[d.loc.x, d.loc.y]]; move = (dx, dy) => { d.loc.x = r3(d.loc.x + dx); d.loc.y = r3(d.loc.y + dy); }; } }
    else if (m.kind === 'rack') { const r = (data.racks || []).find(x => x.id === m.id); if (r) { P = [[r.x, r.y]]; move = (dx, dy) => { r.x = r3(r.x + dx); r.y = r3(r.y + dy); }; } }
    else {
      const list = m.kind === 'room' ? (() => { const r = floor.rooms.find(x => x.id === m.id); return r ? [r.poly, ...(r.holes || [])] : null; })() : m.kind === 'wall' ? (() => { const w = floor.walls.find(x => x.id === m.id); return w ? [[w.a, w.b]] : null; })() : m.kind === 'path' ? (() => { const p = (data.paths || []).find(x => x.id === m.id); return p ? [p.pts] : null; })() : null;
      if (list) { P = list.flat(); move = (dx, dy) => { for (const L of list) for (const q of L) { q[0] = r3(q[0] + dx); q[1] = r3(q[1] + dy); } }; }
    }
    if (!P) continue;
    const x0 = Math.min(...P.map(q => q[0])), y0 = Math.min(...P.map(q => q[1])), x1 = Math.max(...P.map(q => q[0])), y1 = Math.max(...P.map(q => q[1]));
    out.push({ m, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, move });
  }
  return out;
}
/**
 * Aligne ou répartit les objets choisis : how = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter' |
 * 'hdist' | 'vdist' (répartition à pas égal des centres). Rend le nombre d'objets déplacés.
 */
export function alignSel(data, floor, multi, how) {
  const A = anchors(data, floor, multi); if (A.length < 2) return 0;
  const min = k => Math.min(...A.map(a => a[k])), max = k => Math.max(...A.map(a => a[k]));
  let n = 0;
  if (how === 'hdist' || how === 'vdist') {
    const k = how === 'hdist' ? 'cx' : 'cy', s = [...A].sort((a, b) => a[k] - b[k]), lo = s[0][k], step = (s[s.length - 1][k] - lo) / (s.length - 1);
    s.forEach((a, i) => { const d = lo + i * step - a[k]; if (Math.abs(d) > 1e-9) { a.move(how === 'hdist' ? d : 0, how === 'vdist' ? d : 0); n++; } });
    return n;
  }
  const tgt = { left: ['x0', min('x0')], right: ['x1', max('x1')], top: ['y0', min('y0')], bottom: ['y1', max('y1')], hcenter: ['cx', (min('x0') + max('x1')) / 2], vcenter: ['cy', (min('y0') + max('y1')) / 2] }[how];
  if (!tgt) return 0;
  const [k, v] = tgt, horiz = k[0] === 'x' || k === 'cx';
  for (const a of A) { const d = v - a[k]; if (Math.abs(d) > 1e-9) { a.move(horiz ? d : 0, horiz ? 0 : d); n++; } }
  return n;
}
/** Change d'étage les objets choisis (équipements posés, baies, pièces, murs et portes, cheminements). Rend leur nombre. */
export function moveToFloor(data, from, to, multi) {
  let n = 0; const ids = k => new Set(multi.filter(m => m.kind === k).map(m => m.id));
  const dv = ids('dev'), rk = ids('rack'), rm = ids('room'), wl = ids('wall'), pa = ids('path');
  for (const d of data.devices) if (dv.has(d.id) && d.loc && d.loc.floor === from.id) { d.loc.floor = to.id; n++; }
  for (const r of data.racks || []) if (rk.has(r.id) && r.floor === from.id) { r.floor = to.id; n++; }
  for (const p of data.paths || []) if (pa.has(p.id) && p.floor === from.id && p.kind !== 'riser' && p.kind !== 'outdoor') { p.floor = to.id; n++; }
  const take = (k, set) => { const keep = [], go = []; for (const x of from[k]) (set(x) ? go : keep).push(x); from[k] = keep; to[k].push(...go); n += go.length; };
  take('rooms', r => rm.has(r.id)); take('walls', w => wl.has(w.id)); take('doors', x => wl.has(x.wall));
  return n;
}

/**
 * Liens vers les autres vues pour un objet du plan (menu contextuel, carte de l'équipement) : [{ label, icon, run }].
 * Câblage : tracé du câble, lien permanent, port du panneau (baie), port du switch (vue logique), ligne de brassage
 * (vue Conception) ; adressage (nœud de la vue logique) ; résultat de certification ; élévation de la baie.
 */
export function jumpsFor(ctx, sel, planReveal) {
  const data = ctx.data(), out = []; if (!sel) return out;
  const logic = id => () => ctx.openView('logic').then(() => ctx.reveal(id));
  const racks = id => () => ctx.openView('racks').then(v => v && v.reveal && v.reveal(id));
  const design = (tab, id) => () => ctx.openView('design').then(v => { if (v && v.tab) v.tab(tab); if (v && v.reveal && id) v.reveal(id); });
  if (sel.kind === 'rack') { out.push({ label: tl('Élévation de la baie'), icon: 'rack', run: racks(sel.id) }); return out; }
  if (sel.kind === 'cable') {
    const c = data.cables.find(x => x.id === sel.id); if (!c) return out;
    out.push({ label: tl('Câble dans la vue logique'), icon: 'network', run: logic(c.id) });
    out.push({ label: tl('Résultat de certification'), icon: 'cableTester', run: design('tests', c.id) });
    return out;
  }
  if (sel.kind !== 'dev') return out;
  const d = data.devices.find(x => x.id === sel.id); if (!d) return out;
  const name = id => ctx.nameOf(id), cs = data.cables.filter(c => c.a[0] === d.id || c.b[0] === d.id);
  const perm = cs.find(c => c.route && c.route.mode === 'auto') || cs.find(c => { const o = c.a[0] === d.id ? c.b[0] : c.a[0]; const x = data.devices.find(z => z.id === o); return x && /^(patch|fibrepanel)/.test(x.type); });
  if (perm) {
    const far = perm.a[0] === d.id ? perm.b : perm.a;
    out.push({ label: tl('Lien permanent ({0} m) sur le plan', String(Math.round(perm.len * 10) / 10).replace('.', isEn ? '.' : ',')), icon: 'route', run: () => planReveal(perm.id) });
    out.push({ label: tl('Port {0} · {1} dans la baie', name(far[0]), far[1]), icon: 'patchPanel', run: racks(far[0]) });
    out.push({ label: tl('Ligne de brassage'), icon: 'list', run: design('patch', perm.id) });
    out.push({ label: tl('Résultat de certification'), icon: 'cableTester', run: design('tests', perm.id) });
  } else for (const c of cs.slice(0, 3)) out.push({ label: tl('Câble {0} ↔ {1}', name(c.a[0]), name(c.b[0])), icon: 'cable', run: () => planReveal(c.id) });
  // Port du switch au bout du canal (à travers prise et panneau).
  try {
    const lan = ctx.lan(), port = cs.length ? (cs[0].a[0] === d.id ? cs[0].a[1] : cs[0].b[1]) : null, ch = port && lan && lan.channel ? lan.channel(d.id, port) : null;
    if (ch && ch.far && ch.far.n !== d.id) out.push({ label: tl('Port {0} · {1} (vue logique)', name(ch.far.n), ch.far.p), icon: 'switchNet', run: logic(ch.far.n) });
  } catch (e) { /* simulation indisponible */ }
  out.push({ label: tl('Adressage dans la vue logique'), icon: 'network', run: logic(d.id) });
  if (d.rack) out.push({ label: tl('Élévation de la baie'), icon: 'rack', run: racks(d.id) });
  return out;
}
