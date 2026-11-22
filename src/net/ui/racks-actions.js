// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Actions de la vue Baies : copier, coller, dupliquer (équipements et baies entières, avec leurs cordons internes),
// déplacement groupé, obturateurs et passe-câbles ajoutés d'un geste, et menus contextuels (équipement, port, U libre,
// baie, carte de la vue d'ensemble, liste hors baie) faits avec la trousse (kit/menu.js). Chaque action = un seul commit.
import { DEVICES, specOf, portsOf } from '../devices.js';
import { MOUNT, mountDev, PANELS, RACK_DESIGN, newRack, cleanRacks, canPlaceGroup, findGroupBase, freeFrontU, managerSlots, freePorts, findFree } from '../rack.js';
import { ctxMenu } from './kit/index.js';
import { portLinks, revealLogical, revealCable, revealOnPlan, onPlan } from './racks-nav.js';

/** Presse-papiers de la vue (partagé entre les baies du projet ouvert) : { kind: 'devs' | 'racks', devs, cables, racks }. */
let CLIP = null;
const clone = v => JSON.parse(JSON.stringify(v));
/** Types proposés par « Poser ici » (U libre). */
const QUICK = ['patch24', 'patch48', 'cablemgr', 'blank', 'switch24', 'switch48', 'l3switch', 'routerpro', 'server', 'fibrepanel', 'shelf', 'pdu1u', 'ups'];

/**
 * V : accès à la vue { data(), curRack(), rackById(id), findDev(id), selected() → [{ kind, id }], selectList(list),
 * render(), setCur(id), fit(), openElev(id) }.
 */
export function createRackActions(ctx, V) {
  const { tl } = ctx;
  const devsOf = list => list.filter(x => x.kind === 'dev').map(x => V.findDev(x.id)).filter(Boolean);
  const racksOf = list => list.filter(x => x.kind === 'rack').map(x => V.rackById(x.id)).filter(Boolean);
  const freeCableId = data => { let i = data.cables.length + 1; const used = new Set(data.cables.map(c => c.id)); while (used.has('c' + i)) i++; return 'c' + i; };
  /** Cordons dont les deux bouts sont dans ids. */
  const inner = (data, ids) => data.cables.filter(c => ids.has(c.a[0]) && ids.has(c.b[0]));

  /* ---------- Copier, coller, dupliquer ---------- */
  function copy(list = V.selected()) {
    const data = V.data(), rk = racksOf(list);
    if (rk.length) {
      const ids = new Set(data.devices.filter(d => d.rack && rk.some(r => r.id === d.rack.id)).map(d => d.id));
      CLIP = { kind: 'racks', racks: clone(rk), devs: clone(data.devices.filter(d => ids.has(d.id))), cables: clone(inner(data, ids)) };
      ctx.status(tl('{0:# baie copiée|# baies copiées}.', rk.length), 'ok'); return true;
    }
    const ds = devsOf(list); if (!ds.length) return false;
    const ids = new Set(ds.map(d => d.id));
    CLIP = { kind: 'devs', devs: clone(ds), cables: clone(inner(data, ids)) };
    ctx.status(tl('{0:# équipement copié|# équipements copiés}.', ds.length), 'ok'); return true;
  }
  const canPaste = () => !!CLIP;
  /** Copie des équipements de src (nouveaux ids et noms) ; place : (copies) → rien ; rend la table ancien id → copie. */
  function cloneDevs(src) {
    const map = new Map();
    for (const d of src) {
      const n = ctx.newDevice(d.type, { x: (d.x || 0) + 40, y: (d.y || 0) + 40 });
      n.p = clone(d.p || {}); delete n.rack; map.set(d.id, n);
    }
    return map;
  }
  function cloneCables(cables, map) {
    const data = V.data();
    for (const c of cables) {
      const a = map.get(c.a[0]), b = map.get(c.b[0]); if (!a || !b) continue;
      const o = clone(c); o.id = freeCableId(data); o.a = [a.id, c.a[1]]; o.b = [b.id, c.b[1]]; delete o.tag; data.cables.push(o);
    }
  }
  /** Colle des équipements dans la baie r, groupés comme à la copie, près de near (U) ; les autres restent hors baie. */
  function pasteDevs(src, cables, r, near) {
    const map = cloneDevs(src), placed = [], racked = src.filter(d => d.rack && mountDev(d));
    if (r && racked.length) {
      const base0 = Math.min(...racked.map(d => d.rack.u));
      const items = racked.map(d => ({ dev: map.get(d.id), du: d.rack.u - base0, face: d.rack.face, zero: !mountDev(d).u }));
      const g = items.filter(i => !i.zero), b = findGroupBase(V.data(), r, g, near ?? base0, { block: true }) || findGroupBase(V.data(), r, g, near ?? base0);
      if (b || items.every(i => i.zero)) for (const it of items) { it.dev.rack = { id: r.id, u: it.zero ? 1 : b + it.du, face: it.face }; placed.push(it.dev.id); }
      else for (const it of items) { const u = findFree(V.data(), r, it.dev, it.face); if (u) { it.dev.rack = { id: r.id, u, face: it.face }; placed.push(it.dev.id); } }
    }
    cloneCables(cables, map);
    return { all: [...map.values()], placed };
  }
  function paste(near) {
    if (!CLIP) { ctx.status(tl('Rien à coller : copiez d’abord un équipement ou une baie (Ctrl+C).'), 'warn'); return false; }
    if (CLIP.kind === 'racks') { dupRacks(CLIP.racks, CLIP.devs, CLIP.cables); return true; }
    const r = V.curRack(), out = pasteDevs(CLIP.devs, CLIP.cables, r, near);
    V.selectList(out.all.map(d => ({ kind: 'dev', id: d.id }))); ctx.commit();
    ctx.status(out.placed.length === out.all.length ? tl('{0:# équipement collé|# équipements collés} dans {1}.', out.all.length, r ? r.name : '—') : tl('{0:# équipement collé|# équipements collés}, {1} hors baie faute de place.', out.all.length, out.all.length - out.placed.length), out.placed.length === out.all.length ? 'ok' : 'warn');
    return true;
  }
  function dupRacks(rs, devs, cables) {
    const data = V.data(), made = [];
    for (const r of rs) {
      const n = newRack(data, r.kind), keep = { ...clone(r), id: n.id, name: n.name };
      if (r.floor) { keep.x = (r.x || 0) + (r.w || 600) / 1000 + 0.3; }
      const c = cleanRacks([keep])[0]; data.racks.push(c); made.push(c);
      const src = devs.filter(d => d.rack && d.rack.id === r.id), map = cloneDevs(src);
      for (const d of src) map.get(d.id).rack = { ...clone(d.rack), id: c.id };
      for (const d of src) { const nr = map.get(d.id).rack; if (nr.pdu) nr.pdu = map.get(nr.pdu) ? map.get(nr.pdu).id : undefined; if (!nr.pdu) delete nr.pdu; }
      cloneCables(cables.filter(x => map.has(x.a[0]) && map.has(x.b[0])), map);
    }
    V.setCur(made[made.length - 1].id); V.selectList(made.map(r => ({ kind: 'rack', id: r.id }))); ctx.commit();
    ctx.status(tl('{0:# baie dupliquée|# baies dupliquées} avec leurs équipements.', made.length), 'ok');
  }
  /** Dupliquer (Ctrl+D) : la sélection, sans toucher au presse-papiers ; les équipements juste au-dessus des originaux. */
  function duplicate(list = V.selected()) {
    const data = V.data(), rk = racksOf(list);
    if (rk.length) { const ids = new Set(data.devices.filter(d => d.rack && rk.some(r => r.id === d.rack.id)).map(d => d.id)); dupRacks(rk, data.devices.filter(d => ids.has(d.id)), inner(data, ids)); return true; }
    const ds = devsOf(list); if (!ds.length) return false;
    const r = ds[0].rack && V.rackById(ds[0].rack.id), top = Math.max(...ds.filter(d => d.rack).map(d => d.rack.u + ((mountDev(d) || {}).u || 1)), 1);
    const out = pasteDevs(ds, inner(data, new Set(ds.map(d => d.id))), r, top);
    V.selectList(out.all.map(d => ({ kind: 'dev', id: d.id }))); ctx.commit();
    ctx.status(tl('{0:# équipement dupliqué|# équipements dupliqués}.', out.all.length), out.placed.length === out.all.length ? 'ok' : 'warn');
    return true;
  }

  /* ---------- Déplacer, retirer, supprimer ---------- */
  /** Déplace les équipements choisis de du U (et/ou vers face) ensemble ; refuse tout le geste s'il y a collision. */
  function move(list, du, face) {
    const ds = devsOf(list).filter(d => d.rack && mountDev(d) && mountDev(d).u); if (!ds.length) return false;
    const r = V.rackById(ds[0].rack.id); if (!r) return false;
    const same = ds.filter(d => d.rack.id === r.id), moves = same.map(d => ({ dev: d, u: d.rack.u + du, face: face || d.rack.face }));
    const ok = canPlaceGroup(V.data(), r, moves);
    if (!ok.ok) { ctx.status(ok.why === 'clash' ? tl('Place prise par {0}.', ctx.nameOf(ok.with)) : tl('Hors de la baie.'), 'warn'); return true; }
    for (const m of moves) { m.dev.rack.u = m.u; m.dev.rack.face = m.face; }
    ctx.commit(); return true;
  }
  function unrack(list) {
    const ds = devsOf(list).filter(d => d.rack); if (!ds.length) return false;
    for (const d of ds) delete d.rack;
    ctx.commit(); ctx.status(ds.length === 1 ? tl('{0} retiré de la baie (il reste dans le projet).', ds[0].name) : tl('{0} équipements retirés de la baie (ils restent dans le projet).', ds.length)); return true;
  }
  function remove(list) {
    const data = V.data(), ids = new Set(devsOf(list).map(d => d.id)); if (!ids.size) return false;
    data.devices = data.devices.filter(d => !ids.has(d.id)); data.cables = data.cables.filter(c => !ids.has(c.a[0]) && !ids.has(c.b[0]));
    for (const d of data.devices) if (d.rack && d.rack.pdu && ids.has(d.rack.pdu)) delete d.rack.pdu;
    ctx.select(null); ctx.commit(); ctx.status(tl('{0:# équipement supprimé|# équipements supprimés} du projet.', ids.size)); return true;
  }

  /* ---------- Gestes de conception ---------- */
  function addAt(type, r, u, face) {
    const d = ctx.newDevice(type, { x: 40, y: 600 }), m = MOUNT[type];
    const f = m.u ? face : 'rear', uu = m.u ? (findGroupBase(V.data(), r, [{ dev: d, du: 0, face: f }], u) || 0) : 1;
    if (uu) d.rack = { id: r.id, u: uu, face: f };
    V.selectList([{ kind: 'dev', id: d.id }]); ctx.commit();
    ctx.status(uu ? tl('{0} posé dans {1}, U{2}.', d.name, r.name, uu) : tl('{0} ajouté hors baie : {1} est pleine.', d.name, r.name), uu ? 'ok' : 'warn');
  }
  function fillBlanks(r) {
    const data = V.data(), devs = data.devices.filter(d => d.rack && d.rack.id === r.id), free = freeFrontU(r, devs);
    if (!free.length) { ctx.status(tl('Aucun U libre en façade dans {0}.', r.name)); return; }
    for (const u of free) { const b = ctx.newDevice('blank', { x: 40, y: 700 }); b.rack = { id: r.id, u, face: 'front' }; }
    ctx.commit(); ctx.status(tl('{0:# obturateur posé|# obturateurs posés} dans {1}.', free.length, r.name), 'ok');
  }
  function addManagers(r) {
    const data = V.data(), devs = data.devices.filter(d => d.rack && d.rack.id === r.id), slots = managerSlots(r, devs);
    if (!slots.length) { ctx.status(tl('Chaque panneau de {0} a déjà son passe-câbles, ou il n’y a pas de place à côté.', r.name)); return; }
    for (const s of slots) { const m = ctx.newDevice('cablemgr', { x: 40, y: 700 }); m.rack = { id: r.id, u: s.u, face: s.face }; }
    ctx.commit(); ctx.status(tl('{0:# passe-câbles posé|# passe-câbles posés} dans {1}.', slots.length, r.name), 'ok');
  }
  function patch(a, b) {
    const c = ctx.addCable(a, b, { kind: 'straight', len: RACK_DESIGN.cord }); ctx.commit();
    ctx.status(tl('Cordon de {0} m : {1} → {2}.', RACK_DESIGN.cord, ctx.nameOf(a[0]) + ' · ' + a[1], ctx.nameOf(b[0]) + ' · ' + b[1]), 'ok');
    return c;
  }

  /* ---------- Menus contextuels ---------- */
  const typeItem = t => ({ label: DEVICES[t] ? DEVICES[t].name() : t, icon: DEVICES[t] ? DEVICES[t].icon : 'box', value: t });
  /** Équipement(s) : list = sélection courante (au moins celui cliqué). */
  /** Menu commun de l'application (ia : Aller à, Voir dans…, Lié à, Renommer…, presse-papiers, Dupliquer, Retirer, verbes
   * de la vue, Propriétés) quand il est là ; sinon le menu de la trousse. */
  const common = !!(ctx.objectMenu && ctx.ctxMenu);
  const open = (ev, items) => (common ? ctx.ctxMenu(ev, items) : ctxMenu(ev, items));
  function devMenu(ev, list) {
    const ds = devsOf(list); if (!ds.length) return;
    const one = ds.length === 1 ? ds[0] : null, racked = ds.some(d => d.rack), inU = ds.some(d => d.rack && mountDev(d) && mountDev(d).u);
    if (one && common) {
      const verbs = [
        { label: tl('Monter d’un U'), icon: 'chevUp', keys: '↑', disabled: !inU, run: () => move(list, 1) },
        { label: tl('Descendre d’un U'), icon: 'chevDown', keys: '↓', disabled: !inU, run: () => move(list, -1) },
        { label: tl('Monter à l’avant'), keys: '←', disabled: !inU, ...(one.rack ? { checked: one.rack.face !== 'rear' } : {}), run: () => move(list, 0, 'front') },
        { label: tl('Monter à l’arrière'), keys: '→', disabled: !inU, ...(one.rack ? { checked: one.rack.face === 'rear' } : {}), run: () => move(list, 0, 'rear') },
        { label: tl('Supprimer du projet'), icon: 'trash', keys: 'Shift+' + tl('Suppr'), danger: true, run: () => remove(list) }
      ];
      return open(ev, [{ header: `${one.name} · ${DEVICES[one.type].name()}` }, ...ctx.objectMenu({ kind: 'dev', id: one.id }, {
        clipboard: [{ label: tl('Copier'), icon: 'copy', keys: 'Ctrl+C', run: () => copy(list) }, { label: tl('Coller'), keys: 'Ctrl+V', disabled: !canPaste(), run: () => paste() }],
        // « Retirer » (Suppr), dans la vue Baies : sortir de la baie ; l'équipement reste dans le projet.
        duplicate: () => duplicate(list), remove: () => (racked ? unrack(list) : remove(list)), extra: verbs
      })]);
    }
    const net = one && specOf(one) && specOf(one).role !== 'mech';
    return ctxMenu(ev, [
      { header: one ? `${one.name} · ${DEVICES[one.type].name()}` : tl('{0} équipements', ds.length) },
      { label: tl('Monter d’un U'), icon: 'chevUp', keys: '↑', disabled: !inU, run: () => move(list, 1) },
      { label: tl('Descendre d’un U'), icon: 'chevDown', keys: '↓', disabled: !inU, run: () => move(list, -1) },
      { label: tl('Monter à l’avant'), keys: '←', disabled: !inU, ...(one && one.rack ? { checked: one.rack.face !== 'rear' } : { icon: 'chevLeft' }), run: () => move(list, 0, 'front') },
      { label: tl('Monter à l’arrière'), keys: '→', disabled: !inU, ...(one && one.rack ? { checked: one.rack.face === 'rear' } : { icon: 'chevRight' }), run: () => move(list, 0, 'rear') },
      '-',
      { label: tl('Copier'), icon: 'copy', keys: 'Ctrl+C', run: () => copy(list) },
      { label: tl('Dupliquer'), icon: 'copy', keys: 'Ctrl+D', run: () => duplicate(list) },
      { label: tl('Coller'), keys: 'Ctrl+V', disabled: !canPaste(), run: () => paste() },
      ...(one ? ['-',
        ...(net ? [{ label: tl('Afficher dans la vue logique'), icon: 'network', keys: 'L', run: () => revealLogical(ctx, one.id) }] : []),
        { label: tl('Afficher sur le plan'), icon: 'floorPlan', keys: 'P', disabled: !onPlan(V.data(), one.id), hint: onPlan(V.data(), one.id) ? '' : tl('Ni lui ni sa baie ne sont placés sur un plan d’étage.'), run: () => revealOnPlan(ctx, one.id) }] : []),
      '-',
      { label: tl('Retirer de la baie'), icon: 'x', keys: tl('Suppr'), disabled: !racked, run: () => unrack(list) },
      { label: tl('Supprimer du projet'), icon: 'trash', keys: 'Shift+' + tl('Suppr'), danger: true, run: () => remove(list) }
    ]);
  }
  /** Port d'un panneau ou d'un switch dans l'élévation. */
  function portMenu(ev, d, pid) {
    const data = V.data(), r = d.rack && V.rackById(d.rack.id); if (!r) return;
    const c = data.cables.find(x => (x.a[0] === d.id && x.a[1] === pid) || (x.b[0] === d.id && x.b[1] === pid));
    const p = portsOf(d).find(x => x.id === pid), label = p ? p.label : pid;
    const devs = data.devices.filter(x => x.rack && x.rack.id === r.id && x.id !== d.id);
    let targets = [];
    if (!c) {
      const fromPanel = PANELS.has(d.type);
      const peers = devs.filter(x => (fromPanel ? !PANELS.has(x.type) && specOf(x) && !['passive', 'mech'].includes(specOf(x).role) : PANELS.has(x.type)));
      targets = peers.map(x => {
        const fp = freePorts(data, x, fromPanel ? undefined : 'front').filter(id => fromPanel || /^f\d+$/.test(id)).slice(0, 48);
        return fp.length ? { label: x.name, icon: DEVICES[x.type].icon, items: fp.map(id => ({ label: (portsOf(x).find(q => q.id === id) || {}).label || id, run: () => patch(fromPanel ? [d.id, pid] : [x.id, id], fromPanel ? [x.id, id] : [d.id, pid]) })) } : null;
      }).filter(Boolean);
    }
    const peer = c ? (c.a[0] === d.id ? c.b : c.a) : null, L = portLinks(data, d.id, pid);
    const plabel = ([n, q]) => { const o = V.findDev(n), pp = o && portsOf(o).find(x => x.id === q); return pp ? pp.label : q; };
    // Aller vers : le port du switch (dans la baie s'il y est, sinon le schéma logique), la prise au bout du lien permanent.
    const goDev = id => { const o = V.findDev(id); if (o && o.rack && V.rackById(o.rack.id)) { V.setCur(o.rack.id); V.selectList([{ kind: 'dev', id }]); } else revealLogical(ctx, id); };
    const goOutlet = id => (onPlan(data, id) ? revealOnPlan(ctx, id) : revealLogical(ctx, id));
    const jumps = [
      ...(L.switchPort && L.switchPort[0] !== d.id ? [{ label: tl('Aller au port {0} · {1}', ctx.nameOf(L.switchPort[0]), plabel(L.switchPort)), icon: 'switchNet', run: () => goDev(L.switchPort[0]) }] : []),
      ...(L.panelPort && L.panelPort[0] !== d.id ? [{ label: tl('Aller au panneau {0} · {1}', ctx.nameOf(L.panelPort[0]), String(L.panelPort[1]).replace(/^f/, '')), icon: 'patchPanel', run: () => goDev(L.panelPort[0]) }] : []),
      ...(L.outlet ? [{ label: tl('Aller à la prise {0}', ctx.nameOf(L.outlet[0])), icon: 'outlet', hint: onPlan(data, L.outlet[0]) ? tl('Sur le plan d’étage') : tl('Dans le schéma logique'), run: () => goOutlet(L.outlet[0]) }] : []),
      ...(L.link ? [{ label: tl('Lien permanent ({0} m)', L.link.len), icon: 'cable', run: () => revealCable(ctx, L.link.id) }] : [])
    ];
    return ctxMenu(ev, [
      { header: tl('{0} · port {1}', d.name, label) },
      ...(jumps.length ? [...jumps, '-'] : []),
      ...(c ? [
        { label: tl('Cordon vers {0} · {1}', ctx.nameOf(peer[0]), plabel(peer)), icon: 'cable', run: () => revealCable(ctx, c.id) },
        { label: tl('Retirer le cordon'), icon: 'x', danger: true, run: () => { data.cables = data.cables.filter(x => x !== c); ctx.commit(); } }
      ] : targets.length ? [{ label: tl('Brasser vers'), icon: 'cable', items: targets }] : [{ label: tl('Aucun port libre en face dans cette baie'), disabled: true }])
    ]);
  }
  /** U libre (clic droit dans un emplacement vide). */
  function slotMenu(ev, r, u, face) {
    return ctxMenu(ev, [
      { header: tl('{0} · U{1} · {2}', r.name, u, face === 'rear' ? tl('à l’arrière') : tl('à l’avant')) },
      { label: tl('Poser ici'), icon: 'plus', items: QUICK.filter(t => MOUNT[t] && DEVICES[t]).map(t => ({ ...typeItem(t), run: () => addAt(t, r, u, face) })) },
      { label: tl('Coller ici'), keys: 'Ctrl+V', disabled: !canPaste() || (CLIP && CLIP.kind === 'racks'), run: () => paste(u) },
      '-',
      { label: tl('Obturer tous les U libres'), icon: 'blankPanel', run: () => fillBlanks(r) },
      { label: tl('Ajouter les passe-câbles manquants'), icon: 'cableMgr', run: () => addManagers(r) }
    ]);
  }
  /** Baie (cadre de l'élévation, carte de la vue d'ensemble). */
  function rackMenu(ev, r, o = {}) {
    const list = [{ kind: 'rack', id: r.id }];
    if (common) {
      return open(ev, [{ header: `${r.name} · ${r.u} U` }, ...ctx.objectMenu({ kind: 'rack', id: r.id }, {
        clipboard: [{ label: tl('Copier la baie'), icon: 'copy', keys: 'Ctrl+C', run: () => copy(list) }, { label: tl('Dupliquer la baie'), icon: 'copy', keys: 'Ctrl+D', run: () => duplicate(list) }, { label: tl('Coller'), keys: 'Ctrl+V', disabled: !canPaste(), run: () => paste() }],
        remove: () => V.deleteRack(r.id),
        extra: [
          ...(o.card ? [{ label: tl('Ouvrir l’élévation'), icon: 'rack', keys: ctx.isEn ? 'Enter' : 'Entrée', run: () => V.openElev(r.id) }] : []),
          { label: tl('Tout sélectionner dans la baie'), keys: 'Ctrl+A', run: () => V.selectList(V.data().devices.filter(d => d.rack && d.rack.id === r.id).map(d => ({ kind: 'dev', id: d.id }))) },
          { label: tl('Obturer tous les U libres'), icon: 'blankPanel', run: () => fillBlanks(r) },
          { label: tl('Ajouter les passe-câbles manquants'), icon: 'cableMgr', run: () => addManagers(r) }
        ]
      })]);
    }
    return ctxMenu(ev, [
      { header: `${r.name} · ${r.u} U` },
      { label: tl('Afficher sur le plan'), icon: 'floorPlan', keys: 'P', disabled: !r.floor, hint: r.floor ? '' : tl('La baie n’est pas encore posée sur un plan d’étage.'), run: () => revealOnPlan(ctx, r.id) },
      ...(o.card ? [{ label: tl('Ouvrir l’élévation'), icon: 'rack', keys: ctx.isEn ? 'Enter' : 'Entrée', run: () => V.openElev(r.id) }, '-'] : []),
      { label: tl('Tout sélectionner dans la baie'), keys: 'Ctrl+A', run: () => V.selectList(V.data().devices.filter(d => d.rack && d.rack.id === r.id).map(d => ({ kind: 'dev', id: d.id }))) },
      { label: tl('Obturer tous les U libres'), icon: 'blankPanel', run: () => fillBlanks(r) },
      { label: tl('Ajouter les passe-câbles manquants'), icon: 'cableMgr', run: () => addManagers(r) },
      '-',
      { label: tl('Copier la baie'), icon: 'copy', keys: 'Ctrl+C', run: () => copy(list) },
      { label: tl('Dupliquer la baie'), icon: 'copy', keys: 'Ctrl+D', run: () => duplicate(list) },
      { label: tl('Coller'), keys: 'Ctrl+V', disabled: !canPaste(), run: () => paste() },
      '-',
      { label: tl('Supprimer la baie'), icon: 'trash', danger: true, hint: tl('Ses équipements restent dans le projet, hors baie.'), run: () => V.deleteRack(r.id) }
    ]);
  }
  /** Équipement de la liste « Hors baie ». */
  function looseMenu(ev, d) {
    const r = V.curRack();
    return ctxMenu(ev, [
      { header: d.name },
      { label: r ? tl('Ranger dans {0}', r.name) : tl('Aucune baie'), icon: 'rack', disabled: !r, run: () => { if (r) addExisting(d, r); } },
      { label: tl('Copier'), icon: 'copy', keys: 'Ctrl+C', run: () => copy([{ kind: 'dev', id: d.id }]) },
      '-',
      { label: tl('Supprimer du projet'), icon: 'trash', danger: true, run: () => remove([{ kind: 'dev', id: d.id }]) }
    ]);
  }
  function addExisting(d, r) {
    const m = mountDev(d), face = m.u ? 'front' : 'rear', u = findFree(V.data(), r, d, face);
    if (!u) { ctx.status(tl('Plus de place de {0} U libre dans {1}.', m.u, r.name), 'warn'); return; }
    d.rack = { id: r.id, u, face }; ctx.commit(); ctx.status(tl('{0} en U{1} de {2}.', d.name, u, r.name), 'ok');
  }
  return { copy, paste, canPaste, duplicate, move, unrack, remove, fillBlanks, addManagers, patch, devMenu, portMenu, slotMenu, rackMenu, looseMenu };
}
