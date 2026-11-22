// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// « Lié à » : ce qui se rattache à un objet du projet réseau, pour y aller en un clic depuis n'importe quelle vue
// (partie pure, testée sous Node ; l'interface est dans ui/ia.js : pastilles de l'inspecteur, menu, touche g puis lettre).
// - prise, panneau, poste : son câblage de bout en bout (cordon, prise, lien permanent et son tracé, port de panneau,
//   cordon de brassage, switch et port), le VLAN du port qui le dessert, son adressage, son résultat de certification ;
// - équipement : son nœud du schéma logique, sa baie et son U, sa place sur le plan, ses réglages (IP, VLAN, DHCP…) ;
// - baie : son élévation, son emprise sur le plan, son contenu, son brassage ; câble : ses deux bouts, son canal, son
//   tracé, son test ; pièce, étage, bâtiment : leur contenu ; cheminement : les câbles qui l'empruntent.
// related(data, sel, o) → [{ key, group, label, sub, icon, letter?, target, hl: [ids à surligner] }]
//   target : { view?: 'logic'|'plan'|'racks'|'design', kind, id, section? } (aller et montrer), { select: [{ kind, id }] }
//   (choisir), { dock: 'netPatch'|'netCables'|'netTests', filter } (ligne d'un tableau du panneau du bas).
//   o : { label(devId, portId?) → étiquette, cableLabel(c), cableKind(c), ipOf(devId) → { ip, prefix, src } | null,
//         tests: [{ link, stored, stale }] (certify.testState().rows), exam (verdicts cachés), max (câblage d'un switch) }.
import { tl, isEn } from '../i18n/index.js';
import { specOf, portsOf } from './devices.js';
import { roomArea, inRoom, bbox, floorOf } from './site.js';
import { MANAGED, portCfg } from './vlan.js';

export const GROUPS = ['place', 'cabling', 'addressing', 'test', 'contents'];
const GROUP_NAME = { place: () => tl('Vues'), cabling: () => tl('Câblage'), addressing: () => tl('Adressage'), test: () => tl('Certification'), contents: () => tl('Contenu') };
export const groupName = g => (GROUP_NAME[g] ? GROUP_NAME[g]() : g);
const f1 = v => { const t = String(Math.round((+v || 0) * 10) / 10); return isEn ? t : t.replace('.', ','); }; // décimale selon la langue
/** Nom d'une baie avec « Baie » devant, sauf s'il y est déjà (« Baie RDC », « Rack B1 », « Coffret 2 »). */
export const rackName = r => (/^(baie|rack|coffret|armoire|cabinet)\b/i.test(r.name || '') ? r.name : tl('Baie {0}', r.name));

/** Index du modèle (une passe) : équipements, câbles par port, ports par équipement (calculés à la demande). */
export function indexOf(data) {
  const devs = new Map((data.devices || []).map(d => [d.id, d])), at = new Map(), byDev = new Map(), pm = new Map();
  for (const c of data.cables || []) {
    if (!c || !c.a || !c.b) continue;
    at.set(c.a[0] + '|' + c.a[1], c); at.set(c.b[0] + '|' + c.b[1], c);
    for (const e of [c.a[0], c.b[0]]) { if (!byDev.has(e)) byDev.set(e, []); byDev.get(e).push(c); }
  }
  const ports = d => { let m = pm.get(d.id); if (!m) { m = new Map(); try { for (const p of portsOf(d)) m.set(p.id, p); } catch (e) { /* type inconnu */ } pm.set(d.id, m); } return m; };
  return { devs, at, byDev, ports, racks: new Map((data.racks || []).map(r => [r.id, r])) };
}
/**
 * Chemin depuis un port : câble après câble, à travers les éléments passifs (prise, panneau : avant ↔ arrière), jusqu'à
 * un port actif ou la fin. Rend [{ cable, from: [dev, port], to: [dev, port], pass: bool (to est passif, on continue) }].
 */
export function walk(ix, dev, port, max = 12) {
  const hops = [], seen = new Set();
  let cur = [dev, port];
  for (let g = 0; g < max; g++) {
    const c = ix.at.get(cur[0] + '|' + cur[1]); if (!c || seen.has(c.id)) break; seen.add(c.id);
    const to = c.a[0] === cur[0] && c.a[1] === cur[1] ? c.b : c.a, td = ix.devs.get(to[0]);
    const tp = td ? ix.ports(td).get(to[1]) : null, pass = !!(tp && tp.passive);
    hops.push({ cable: c, from: cur, to, pass });
    if (!pass) break;
    cur = [to[0], tp.passive];
  }
  return hops;
}
const portName = (ix, d, pid) => { const p = d ? ix.ports(d).get(pid) : null; return p ? p.label || pid : pid; };
const devIcon = d => { const s = d && specOf(d); return s ? s.icon : 'box'; };
const isPanel = d => !!d && (/^patch/.test(d.type) || d.type === 'fibrepanel');
const isOutlet = d => !!d && /^outlet/.test(d.type);

/** Pièce d'un équipement posé (ou de sa baie). */
function roomOfDev(data, ix, d) {
  let f = null, x = 0, y = 0;
  if (d.loc && d.loc.floor) { f = floorOf(data.site, d.loc.floor); x = d.loc.x; y = d.loc.y; }
  else if (d.rack) { const r = ix.racks.get(d.rack.id); if (r && r.floor) { f = floorOf(data.site, r.floor); x = r.x; y = r.y; if (r.room && f) { const rm = f.f.rooms.find(z => z.id === r.room); if (rm) return { f, room: rm }; } } }
  if (!f) return null;
  let best = null, ba = Infinity;
  for (const r of f.f.rooms) { const b = bbox(r.poly); if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue; const a = roomArea(r); if (a < ba && inRoom([x, y], r)) { best = r; ba = a; } }
  return { f, room: best };
}

export function related(data, sel, o = {}) {
  if (!sel || sel.id == null) return [];
  const ix = o.ix || indexOf(data), out = [], keys = new Set();
  const lab = (id, p) => { try { return (o.label && o.label(id, p)) || ''; } catch (e) { return ''; } };
  const cl = c => { try { return (o.cableLabel && o.cableLabel(c)) || c.tag || c.id; } catch (e) { return c.id; } };
  const ck = c => { try { return (o.cableKind && o.cableKind(c)) || ''; } catch (e) { return ''; } };
  const add = (it) => { if (keys.has(it.key)) return; keys.add(it.key); out.push({ hl: [], ...it }); };
  const name = d => (d ? d.name || lab(d.id) || d.id : '?');
  const CK = { horizontal: () => tl('Lien permanent'), cord: () => tl('Cordon'), backbone: () => tl('Rocade') };
  /** À surligner pour un câble : lui, ses deux bouts et leurs baies (sur le plan, un câble se voit par ses bouts). */
  const endsHl = c => { const l = [c.id]; for (const e of [c.a, c.b]) { l.push(e[0]); const d = ix.devs.get(e[0]); if (d && d.rack) l.push(d.rack.id); } return l; };
  const cableItem = (c, extra = {}) => { const k = ck(c); add({ key: 'cable:' + c.id, group: 'cabling', label: `${CK[k] ? CK[k]() : tl('Câble')} ${cl(c)}`, sub: `${c.media === 'fibre' ? String(c.fibre || 'fibre').toUpperCase() : (c.cat || '').replace('cat', 'Cat ')} · ${f1(c.len)} m${k === 'horizontal' ? ' · ' + tl('tracé sur le plan') : ''}`, icon: c.media === 'fibre' ? 'fibre' : 'cable', target: { view: k === 'horizontal' || k === 'backbone' ? 'plan' : null, kind: 'cable', id: c.id }, hl: endsHl(c), ...extra }); };
  const devItem = (d, port, extra = {}) => {
    const pn = port ? portName(ix, d, port) : '', l = port ? lab(d.id, port) : '';
    const view = isPanel(d) ? 'racks' : isOutlet(d) && d.loc ? 'plan' : null;
    add({ key: 'dev:' + d.id + (port ? ':' + port : ''), group: 'cabling', label: `${name(d)}${pn ? ' · ' + tl('port {0}', pn) : ''}`, sub: [l && l !== name(d) ? l : '', specOf(d) ? specOf(d).name() : d.type].filter(Boolean).join(' · '), icon: devIcon(d), target: { view, kind: 'dev', id: d.id }, hl: [d.id], ...extra });
  };
  const vlanItem = (sw, port) => {
    const cfg = portCfg(sw, port), v = cfg.mode === 'trunk' ? null : cfg.vlan, vl = v ? (data.vlans || []).find(x => x.id === v) : null;
    add({ key: 'vlan:' + sw.id + ':' + port, group: 'addressing', letter: 'v', label: cfg.mode === 'trunk' ? tl('Trunk 802.1Q sur {0} · {1}', name(sw), portName(ix, sw, port)) : tl('VLAN {0}{1}', v, vl && vl.name ? ' · ' + vl.name : ''), sub: `${vl && vl.net ? vl.net + ' · ' : ''}${tl('port {0} de {1}', portName(ix, sw, port), name(sw))}`, icon: 'vlanTag', target: { view: 'logic', kind: 'dev', id: sw.id, section: 'vlan' }, hl: [sw.id] });
  };
  /** Câblage d'un port de bout en bout : câbles, passifs traversés, bout actif ; VLAN du switch au bout. */
  const chain = (d, p, full = true) => {
    const hops = walk(ix, d.id, p);
    for (const h of hops) {
      if (full) cableItem(h.cable);
      const td = ix.devs.get(h.to[0]); if (!td) continue;
      if (h.pass || full) devItem(td, h.to[1], h.pass ? {} : { letter: MANAGED.has(td.type) || (specOf(td) || {}).role === 'switch' ? 's' : undefined });
      if (!h.pass && MANAGED.has(td.type)) vlanItem(td, h.to[1]);
    }
    return hops;
  };
  const testItems = cables => {
    if (!o.tests || !cables.length) return;
    const ids = new Set(cables.map(c => c.id));
    for (const r of o.tests) {
      if (!r.link.cables.some(c => ids.has(c.id))) continue;
      const s = r.stored, v = !s ? tl('non testé') : o.exam ? tl('testé (verdict caché en examen)') : `${s.verdict ? String(s.verdict).toUpperCase() : '—'}${s.margin != null ? ' · ' + tl('marge {0} dB', f1(s.margin)) : ''}`;
      add({ key: 'test:' + r.link.id, group: 'test', letter: 't', label: `${r.link.kind === 'pl' ? tl('Test du lien permanent') : tl('Test du canal')} : ${v}`, sub: (r.stale ? tl('à refaire (le lien a changé)') + ' · ' : '') + (r.label || ''), icon: 'certifier', target: { dock: 'netTests', filter: r.label || '', link: r.link.id }, hl: r.link.cables.map(c => c.id) });
      if (out.filter(x => x.group === 'test').length >= 4) break;
    }
  };

  if (sel.kind === 'dev') {
    const d = ix.devs.get(sel.id); if (!d) return [];
    const s = specOf(d) || {}, role = s.role, mech = role === 'mech';
    // Vues : schéma logique, baie, plan.
    if (!mech) add({ key: 'v:logic', group: 'place', letter: 'l', label: tl('Nœud du schéma logique'), sub: name(d), icon: 'network', target: { view: 'logic', kind: 'dev', id: d.id }, hl: [d.id] });
    const rk = d.rack && ix.racks.get(d.rack.id);
    if (rk) add({ key: 'v:rack', group: 'place', letter: 'b', label: `${rackName(rk)} · U${d.rack.u}`, sub: d.rack.face === 'rear' ? tl('face arrière') : tl('face avant'), icon: 'rack', target: { view: 'racks', kind: 'dev', id: d.id }, hl: [d.id, rk.id] });
    const where = roomOfDev(data, ix, d);
    if (d.loc && where) add({ key: 'v:plan', group: 'place', letter: 'p', label: tl('Sur le plan · {0}', where.f.f.name), sub: [where.room ? where.room.name : '', tl('hauteur {0} m', f1(d.loc.h))].filter(Boolean).join(' · '), icon: 'floorPlan', target: { view: 'plan', kind: 'dev', id: d.id }, hl: [d.id] });
    else if (rk && rk.floor && where) add({ key: 'v:plan', group: 'place', letter: 'p', label: tl('Baie sur le plan · {0}', where.f.f.name), sub: where.room ? where.room.name : '', icon: 'floorPlan', target: { view: 'plan', kind: 'rack', id: rk.id }, hl: [rk.id] });
    // Câblage.
    const cabled = [...ix.ports(d).values()].filter(p => ix.at.has(d.id + '|' + p.id));
    const allCables = [];
    if (cabled.length && cabled.length <= 4) {
      // Prise, poste, point d'accès, petit équipement : chaque port de bout en bout (une prise : vers le poste par
      // l'avant, vers le panneau puis le switch par l'arrière).
      for (const p of cabled) allCables.push(...chain(d, p.id).map(h => h.cable));
      const first = out.find(x => x.group === 'cabling' && x.key.startsWith('cable:')); if (first) first.letter = 'c';
    } else if (cabled.length) {
      // Switch, routeur : un élément par port câblé (bout actif au loin), au plus o.max.
      const max = o.max ?? 16, fars = [];
      for (const p of cabled) {
        const hops = walk(ix, d.id, p.id); allCables.push(...hops.map(h => h.cable));
        const end = hops[hops.length - 1], td = end && ix.devs.get(end.to[0]); if (!td) continue;
        fars.push({ kind: 'dev', id: td.id });
        if (fars.length <= max) add({ key: 'port:' + p.id, group: 'cabling', label: `${portName(ix, d, p.id)} → ${name(td)}`, sub: `${hops.length > 1 ? tl('par {0}', hops.filter(h => h.pass).map(h => name(ix.devs.get(h.to[0]))).join(', ')) + ' · ' : ''}${MANAGED.has(d.type) ? (portCfg(d, p.id).mode === 'trunk' ? 'trunk' : 'VLAN ' + portCfg(d, p.id).vlan) : ''}`, icon: devIcon(td), target: { kind: 'dev', id: td.id }, hl: [td.id, ...hops.map(h => h.cable.id)] });
      }
      if (fars.length > max) add({ key: 'port:more', group: 'cabling', label: tl('… {0} ports de plus : choisir tous les équipements reliés', fars.length - max), icon: 'checklist', target: { select: fars } });
    }
    // Adressage.
    const ip = o.ipOf ? o.ipOf(d.id) : null, P = d.p || {};
    if (P.ip && typeof P.ip === 'object') add({ key: 'a:ip', group: 'addressing', letter: 'i', label: ip && ip.ip ? tl('Adresse IP {0}/{1}', ip.ip, ip.prefix) : P.ip.mode === 'dhcp' ? tl('Adresse IP par DHCP (pas encore reçue)') : P.ip.ip ? tl('Adresse IP {0}/{1}', P.ip.ip, P.ip.prefix) : tl('Adresse IP à régler'), sub: P.ip.mode === 'dhcp' ? 'DHCP' : tl('fixe') + (P.ip.gw ? ' · ' + tl('passerelle {0}', P.ip.gw) : ''), icon: 'globe', target: { view: 'logic', kind: 'dev', id: d.id, section: 'ip' }, hl: [d.id] });
    if (MANAGED.has(d.type)) add({ key: 'a:vlan', group: 'addressing', letter: 'v', label: tl('Ports : VLAN et Spanning Tree'), icon: 'vlanTag', target: { view: 'logic', kind: 'dev', id: d.id, section: 'vlan' }, hl: [d.id] });
    if (d.type === 'l3switch') add({ key: 'a:svi', group: 'addressing', letter: 'i', label: tl('Interfaces VLAN (SVI)'), icon: 'globe', target: { view: 'logic', kind: 'dev', id: d.id, section: 'svi' }, hl: [d.id] });
    if (d.type === 'routerpro') add({ key: 'a:ifs', group: 'addressing', letter: 'i', label: tl('Interfaces et sous-interfaces'), icon: 'globe', target: { view: 'logic', kind: 'dev', id: d.id, section: 'ifs' }, hl: [d.id] });
    if (P.lan && typeof P.lan === 'object') add({ key: 'a:lan', group: 'addressing', letter: 'i', label: tl('Réseau local (LAN) {0}/{1}', P.lan.ip, P.lan.prefix), icon: 'globe', target: { view: 'logic', kind: 'dev', id: d.id, section: 'lan' }, hl: [d.id] });
    if ((Array.isArray(P.dhcp) && P.dhcp.length) || (P.dhcp && P.dhcp.on)) add({ key: 'a:dhcp', group: 'addressing', letter: 'd', label: tl('Serveur DHCP'), sub: Array.isArray(P.dhcp) ? tl('{0:# étendue|# étendues}', P.dhcp.length) : '', icon: 'list', target: { view: 'logic', kind: 'dev', id: d.id, section: 'dhcp' }, hl: [d.id] });
    // Certification, brassage.
    testItems(allCables);
    if (isPanel(d)) add({ key: 'patch', group: 'test', letter: 'r', label: tl('Lignes du tableau de brassage'), sub: lab(d.id) || name(d), icon: 'patchPanel', target: { dock: 'netPatch', filter: lab(d.id) || name(d) } });
    else if (isOutlet(d)) { const l = lab(d.id); if (l) add({ key: 'patch', group: 'test', letter: 'r', label: tl('Ligne du tableau de brassage'), sub: l, icon: 'patchPanel', target: { dock: 'netPatch', filter: l } }); }
  } else if (sel.kind === 'cable') {
    const c = (data.cables || []).find(x => x.id === sel.id); if (!c) return [];
    for (const e of [c.a, c.b]) { const d = ix.devs.get(e[0]); if (d) devItem(d, e[1], { group: 'cabling' }); }
    // Canal : jusqu'aux bouts actifs de part et d'autre.
    const ends = [c.a, c.b].map(e => { const d = ix.devs.get(e[0]), p = d && ix.ports(d).get(e[1]); if (!p || !p.passive) return e; const hops = walk(ix, d.id, p.passive); const last = hops[hops.length - 1]; return last ? last.to : e; });
    const ea = ix.devs.get(ends[0][0]), eb = ix.devs.get(ends[1][0]);
    if (ea && eb && (ends[0] !== c.a || ends[1] !== c.b)) add({ key: 'chan', group: 'cabling', letter: 'c', label: tl('Canal : {0} ↔ {1}', name(ea), name(eb)), sub: tl('les deux bouts actifs'), icon: 'link', target: { select: [{ kind: 'dev', id: ea.id }, { kind: 'dev', id: eb.id }] }, hl: [ea.id, eb.id] });
    for (const [d, p] of [[ea, ends[0][1]], [eb, ends[1][1]]]) if (d && MANAGED.has(d.type)) vlanItem(d, p);
    add({ key: 'v:plan', group: 'place', letter: 'p', label: tl('Tracé sur le plan'), sub: c.route && c.route.mode === 'auto' ? tl('suit les cheminements') : tl('saisie à la main'), icon: 'route', target: { view: 'plan', kind: 'cable', id: c.id }, hl: [c.id] });
    add({ key: 'v:logic', group: 'place', letter: 'l', label: tl('Sur le schéma logique'), icon: 'network', target: { view: 'logic', kind: 'cable', id: c.id }, hl: [c.id] });
    const inCh = []; for (const e of [c.a, c.b]) { const d = ix.devs.get(e[0]), p = d && ix.ports(d).get(e[1]); if (p && p.passive) inCh.push(...walk(ix, d.id, p.passive).map(h => h.cable)); }
    testItems([c, ...inCh]);
  } else if (sel.kind === 'rack') {
    const r = ix.racks.get(sel.id); if (!r) return [];
    const devs = (data.devices || []).filter(d => d.rack && d.rack.id === r.id);
    add({ key: 'v:racks', group: 'place', letter: 'b', label: tl('Élévation de la baie'), sub: `${r.u} U`, icon: 'rack', target: { view: 'racks', kind: 'rack', id: r.id }, hl: [r.id] });
    if (r.floor && floorOf(data.site, r.floor)) add({ key: 'v:plan', group: 'place', letter: 'p', label: tl('Emprise sur le plan · {0}', floorOf(data.site, r.floor).f.name), icon: 'floorPlan', target: { view: 'plan', kind: 'rack', id: r.id }, hl: [r.id] });
    if (devs.length) add({ key: 'c:devs', group: 'contents', label: tl('{0:# équipement|# équipements} dans la baie', devs.length), icon: 'checklist', target: { select: devs.map(d => ({ kind: 'dev', id: d.id })) }, hl: devs.map(d => d.id) });
    for (const d of devs.filter(x => (specOf(x) || {}).role === 'switch' || MANAGED.has(x.type) || (specOf(x) || {}).role === 'router').slice(0, 6)) add({ key: 'c:' + d.id, group: 'contents', label: `${name(d)} · U${d.rack.u}`, sub: tl('nœud du schéma logique'), icon: devIcon(d), target: { view: 'logic', kind: 'dev', id: d.id }, hl: [d.id] });
    if (devs.some(isPanel)) add({ key: 'patch', group: 'test', letter: 'r', label: tl('Brassage de la baie'), sub: (o.rackLabel && o.rackLabel(r.id)) || r.name, icon: 'patchPanel', target: { dock: 'netPatch', filter: o.rackLabel ? o.rackLabel(r.id) || r.name : r.name } });
  } else if (['room', 'floor', 'building'].includes(sel.kind)) {
    const fl = []; let room = null;
    for (const b of (data.site && data.site.buildings) || []) for (const f of b.floors || []) {
      if (sel.kind === 'building' && b.id === sel.id) fl.push(f);
      if (sel.kind === 'floor' && f.id === sel.id) fl.push(f);
      if (sel.kind === 'room') { const r = f.rooms.find(x => x.id === sel.id); if (r) { fl.push(f); room = r; } }
    }
    if (!fl.length) return [];
    const fids = new Set(fl.map(f => f.id));
    const inside = d => { const w = roomOfDev(data, ix, d); return !!w && fids.has(w.f.f.id) && (!room || (w.room && w.room.id === room.id)); };
    const devs = (data.devices || []).filter(d => (d.loc || d.rack) && inside(d)), racks = (data.racks || []).filter(r => fids.has(r.floor) && (!room || r.room === room.id || (() => { const w = roomOfDev(data, ix, { rack: { id: r.id } }); return w && w.room && w.room.id === room.id; })()));
    add({ key: 'v:plan', group: 'place', letter: 'p', label: tl('Sur le plan'), icon: 'floorPlan', target: { view: 'plan', kind: sel.kind, id: sel.id }, hl: [sel.id] });
    if (devs.length) add({ key: 'c:devs', group: 'contents', label: tl('{0:# équipement|# équipements}', devs.length), sub: tl('les choisir (modification groupée)'), icon: 'checklist', target: { select: devs.map(d => ({ kind: 'dev', id: d.id })) }, hl: devs.map(d => d.id) });
    const outs = devs.filter(isOutlet), aps = devs.filter(d => (specOf(d) || {}).role === 'ap');
    if (outs.length && outs.length !== devs.length) add({ key: 'c:out', group: 'contents', label: tl('{0:# prise|# prises}', outs.length), icon: 'outlet', target: { select: outs.map(d => ({ kind: 'dev', id: d.id })) }, hl: outs.map(d => d.id) });
    if (aps.length && aps.length !== devs.length) add({ key: 'c:ap', group: 'contents', label: tl('{0:# point|# points} d’accès', aps.length), icon: 'wifi', target: { select: aps.map(d => ({ kind: 'dev', id: d.id })) }, hl: aps.map(d => d.id) });
    for (const r of racks.slice(0, 6)) add({ key: 'c:' + r.id, group: 'contents', letter: racks.length === 1 ? 'b' : undefined, label: rackName(r), sub: tl('élévation'), icon: 'rack', target: { view: 'racks', kind: 'rack', id: r.id }, hl: [r.id] });
  } else if (sel.kind === 'path') {
    const p = (data.paths || []).find(x => x.id === sel.id); if (!p) return [];
    const via = (data.cables || []).filter(c => { const calc = c.route && c.route.calc; const l = calc && (calc.paths || calc.via || calc.ids || calc.segs); return Array.isArray(l) && l.some(x => (typeof x === 'string' ? x : x && (x.path || x.id)) === p.id); });
    add({ key: 'v:plan', group: 'place', letter: 'p', label: tl('Sur le plan'), icon: 'floorPlan', target: { view: 'plan', kind: 'path', id: p.id }, hl: [p.id] });
    if (via.length) add({ key: 'c:cables', group: 'contents', label: tl('{0:# câble|# câbles} l’empruntent', via.length), icon: 'cable', target: { select: via.map(c => ({ kind: 'cable', id: c.id })) }, hl: via.map(c => c.id) });
  }
  // Lettres : la première de chaque lettre seulement.
  const used = new Set();
  for (const it of out) { if (!it.letter) continue; if (used.has(it.letter)) delete it.letter; else used.add(it.letter); }
  out.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
  return out;
}
/** Lettres de la touche g (aide affichée) : g puis la lettre va au premier élément qui la porte. */
export const LETTERS = { l: () => tl('schéma logique'), p: () => tl('plan'), b: () => tl('baie'), c: () => tl('câble'), s: () => tl('switch'), v: () => 'VLAN', i: () => tl('adresse IP'), d: () => 'DHCP', t: () => tl('test'), r: () => tl('brassage') };
