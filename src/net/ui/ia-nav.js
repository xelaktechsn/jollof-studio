// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Navigation entre les vues du projet réseau (chargé avec ia.js) :
// - « Lié à » (relate.js) : pastilles au-dessus de l'inspecteur pour l'objet choisi, menu (Alt+Entrée, sous-menu des menus
//   contextuels), touche g puis une lettre (l logique, p plan, b baie, c câble, s switch, v VLAN, i IP, d DHCP, t test,
//   r brassage) ; survoler un élément le surligne dans la vue montrée ;
// - aller : vue + objet (et section de l'inspecteur : IP, VLAN, DHCP…), choix multiple, ligne d'un tableau du panneau du bas ;
// - historique : chaque vue, étage et sélection visités ; Alt+← / Alt+→, boutons précédent/suivant de la souris, flèches
//   de la barre des vues.
import { tl } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { ctxMenu, notify, scrollWithin } from './kit/index.js';
import { labeler, cableKind } from '../docs.js';
import { testState, linkLabel } from '../certify.js';
import { isExam } from '../exam.js';
import { related as relate, groupName, LETTERS, indexOf } from '../relate.js';
import { renameItem, canRename, canRemove, removeItems, duplicateDevs, resolveSel } from '../browse.js';
import { ask } from '../../school/ui.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const same = (a, b) => (!a && !b) || (!!a && !!b && a.kind === b.kind && a.id === b.id);
/** Titres de l'inspecteur du schéma logique pour chaque section (repérées par leur titre : data-sec en priorité). */
const SECTIONS = { ip: () => [tl('Adresse IP'), tl('Réseau local (LAN)')], lan: () => [tl('Réseau local (LAN)')], vlan: () => [tl('Ports : VLAN et Spanning Tree')], svi: () => [tl('Interfaces VLAN (SVI)')], ifs: () => [tl('Interfaces et sous-interfaces')], dhcp: () => ['DHCP', tl('Serveur DHCP : étendues')] };

export function installNav(ctx, { host, pane, viewBar, docks, onGo }) {
  const app = ctx.app, data = () => ctx.data();

  /* ---------- « Lié à » ---------- */
  let ver = 0, cache = null;
  ctx.onChange(() => { ver++; cache = null; });
  function opts() {
    if (cache && cache.ver === ver) return cache.o;
    const d = data(), L = labeler(d), devs = new Map(d.devices.map(x => [x.id, x]));
    let tests = null;
    const o = {
      ix: indexOf(d), exam: isExam(d),
      label: (id, p) => L.of(id, p), cableLabel: c => L.cable(c), cableKind: c => cableKind(d, c, devs), rackLabel: id => L.rack(id),
      ipOf: id => { try { const f = ctx.lan().state().ifaces.find(x => x.node === id && (x.role === 'host' || x.role === 'lan')); return f && f.ip ? { ip: f.ip, prefix: f.prefix } : null; } catch (e) { return null; } },
      get tests() { if (!tests) { try { tests = testState(d).rows.map(r => ({ ...r, label: linkLabel(d, r.link) })); } catch (e) { tests = []; } } return tests; }
    };
    cache = { ver, o };
    return o;
  }
  function related(sel) { if (!sel) return []; try { return relate(data(), sel, opts()); } catch (e) { console.error(e); return []; } }

  /* ---------- Surlignage croisé ---------- */
  const viewRoot = () => { const v = ctx.view(); return host.querySelector(v === 'logic' ? '.ntLogic' : v === 'plan' ? '.ntVw.ntPl' : v === 'racks' ? '.ntVw.ntRk, .ntVw[class*="ntRk"]' : '.ntVw:not([hidden])'); };
  let lit = [];
  function highlight(ids) {
    for (const e of lit) e.classList.remove('ntRelHi'); lit = [];
    const root = viewRoot(); if (!root || !ids || !ids.length) return;
    for (const id of ids.slice(0, 400)) {
      const q = CSS.escape(id);
      root.querySelectorAll(`[data-id="${q}"], [data-cable="${q}"], [data-dev="${q}"], [data-rack="${q}"]`).forEach(e => { e.classList.add('ntRelHi'); lit.push(e); });
    }
  }

  /* ---------- Aller ---------- */
  async function scrollSection(sec) {
    const names = SECTIONS[sec] ? SECTIONS[sec]() : [];
    for (let k = 0; k < 6; k++) {
      await new Promise(r => requestAnimationFrame(r));
      let el = pane.querySelector(`[data-sec="${CSS.escape(sec)}"]`);
      if (!el) { const h = [...pane.querySelectorAll('section h4')].find(x => names.some(n => x.textContent.trim().startsWith(n))); el = h && h.closest('section'); }
      if (el) { scrollWithin(el); el.classList.remove('ntFlash'); void el.offsetWidth; el.classList.add('ntFlash'); setTimeout(() => el.classList.remove('ntFlash'), 1600); return true; }
    }
    return false;
  }
  /** Va à une cible de relate.js (ou { view?, kind, id }) ; rend une promesse. */
  async function go(t) {
    if (!t) return;
    highlight(null);
    // Une seule entrée d'historique par saut, posée à l'arrivée (vue et sélection finales).
    navigating++;
    try { await go0(t); } finally { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); navigating--; record(true); }
  }
  async function go0(t) {
    if (t.kind === 'vlan') { await ctx.openView('logic'); if (app.commands && app.commands.run) app.commands.run('net.sim.vlans'); return; }
    if (t.select) { const l = t.select.filter(Boolean); if (l.length === 1) ctx.select(l[0]); else ctx.selectMany(l); ctx.status(tl('{0:# objet choisi|# objets choisis}.', l.length), 'ok'); return; }
    if (t.dock) { if (docks) { const d = await docks; if (d) d.show(t.dock, t.filter); } else if (app.dock) app.dock.show(t.dock); return; }
    if (t.id == null) { if (t.view) await ctx.openView(t.view); return; }
    let view = t.view || null;
    if (!view) {
      // Vue montrée d'abord ; sinon celle qui convient : baie pour un équipement rangé, schéma logique pour un équipement ou un câble.
      const cur = ctx.view(); if (cur !== 'logic') { const vw = await ctx.openView(cur); if (vw && vw.reveal && vw.reveal(t.id)) { if (onGo) onGo(); return; } }
      const d = data(), dv = (t.kind === 'dev' || !t.kind) && d.devices.find(x => x.id === t.id);
      view = dv ? (dv.rack && cur === 'racks' ? 'racks' : dv.rack && cur === 'plan' ? 'racks' : 'logic') : t.kind === 'cable' ? 'logic' : null;
      if (cur === 'logic' && (dv || t.kind === 'cable')) view = 'logic';
    }
    if (view === 'logic') { await ctx.openView('logic'); ctx.reveal(t.id); }
    else if (view) { const vw = await ctx.openView(view); if (!(vw && vw.reveal && vw.reveal(t.id))) { ctx.status(tl('Cet objet n’apparaît pas dans cette vue.'), 'warn'); ctx.reveal(t.id); } }
    else ctx.reveal(t.id);
    if (t.section) { app.setTab && app.setTab('nprop'); scrollSection(t.section); }
    if (onGo) onGo();
  }

  /* ---------- Menu « Lié à » ---------- */
  const gKey = l => (l ? `G ${l.toUpperCase()}` : undefined);
  function relatedMenu(sel) {
    const list = related(sel), out = []; let g = null;
    for (const it of list) {
      if (it.group !== g) { g = it.group; out.push({ header: groupName(g) }); }
      out.push({ label: it.label, icon: it.icon, keys: gKey(it.letter), hint: it.sub || undefined, run: () => go(it.target), hover: on => highlight(on ? it.hl : null) });
    }
    return out.length ? out : [{ label: tl('Rien de lié à cet objet.'), disabled: true }];
  }
  function openMenu(at) {
    const s = ctx.selection(); if (!s) { ctx.status(tl('Choisissez d’abord un objet.'), 'warn'); return; }
    ctxMenu(at || viewBar, relatedMenu(s));
  }

  /* ---------- Menu contextuel commun d'un objet (toutes les vues, l'arbre) ----------
   * objectMenu(sel, o) → éléments de kit/menu.js : Aller à, Voir dans… (vues), Lié à (relations), puis Renommer, les verbes
   * de presse-papiers de la vue (o.clipboard : éléments), Dupliquer, Retirer, les verbes propres à la vue (o.extra),
   * Propriétés. o.rename() / o.remove() / o.duplicate() remplacent les actions communes (renommage sur place de l'arbre,
   * suppression propre à une vue). Même ordre et mêmes libellés partout. */
  function objectMenu(sel, o = {}) {
    if (!sel || sel.id == null) return o.extra || [];
    const rel = related(sel), places = rel.filter(x => x.group === 'place'), others = rel.filter(x => x.group !== 'place');
    const item = it => ({ label: it.label, icon: it.icon, keys: gKey(it.letter), hint: it.sub || undefined, run: () => go(it.target), hover: on => highlight(on ? it.hl : null) });
    const out = [{ label: tl('Aller à'), icon: 'focus', keys: '↵', run: () => go({ kind: sel.kind, id: sel.id }) }];
    if (places.length) out.push({ label: tl('Voir dans…'), icon: 'layers', items: places.map(item) });
    if (others.length) { const sub = []; let g = null; for (const it of others) { if (it.group !== g) { g = it.group; sub.push({ header: groupName(g) }); } sub.push(item(it)); } out.push({ label: tl('Lié à'), icon: 'link', keys: 'Alt+↵', items: sub }); }
    out.push('-');
    out.push({ label: tl('Renommer…'), icon: 'edit', keys: 'F2', disabled: !canRename(sel.kind), run: () => (o.rename ? o.rename() : renameDlg(sel)) });
    if (o.clipboard && o.clipboard.length) out.push(...o.clipboard);
    if (sel.kind === 'dev') out.push({ label: tl('Dupliquer'), icon: 'copy', keys: 'Ctrl+D', run: () => (o.duplicate ? o.duplicate() : duplicate([sel])) });
    out.push({ label: tl('Retirer'), icon: 'trash', keys: ctx.isEn ? 'Delete' : 'Suppr', danger: true, disabled: !canRemove(sel.kind) && !o.remove, run: () => (o.remove ? o.remove() : remove([sel])) });
    if (o.extra && o.extra.length) out.push('-', ...o.extra);
    out.push('-', { label: tl('Propriétés'), icon: 'sliders', run: () => { ctx.select(sel); if (app.setTab) app.setTab('nprop'); } });
    return out;
  }
  async function renameDlg(sel) {
    const [it] = resolveSel(data(), [sel]); if (!it) return;
    const cur = sel.kind === 'cable' ? it.o.tag || '' : it.o.name || '';
    const v = await ask(tl('Renommer'), sel.kind === 'cable' ? tl('Étiquette imposée') : tl('Nom'), cur);
    if (v && renameItem(data(), sel, v)) { ctx.commit(); ctx.status(tl('Renommé : {0}', v), 'ok'); }
  }
  function remove(list) {
    const n = removeItems(data(), list); if (!n) return 0;
    ctx.select(null); ctx.commit();
    notify(tl('{0:# objet retiré|# objets retirés}', n), 'ok', { action: { label: tl('Annuler'), run: () => { const u = document.getElementById('undoBtn'); if (u && !u.disabled) u.click(); } } });
    return n;
  }
  function duplicate(list) {
    const ids = list.filter(x => x.kind === 'dev').map(x => x.id); if (!ids.length) return [];
    const made = duplicateDevs(data(), ids, (type, at) => ctx.newDevice(type, at)); if (!made.length) return [];
    ctx.commit(); ctx.selectMany(made.map(d => ({ kind: 'dev', id: d.id })));
    ctx.status(tl('{0:# équipement dupliqué|# équipements dupliqués} (sans leurs câbles).', made.length), 'ok');
    return made;
  }

  /* ---------- Pastilles au-dessus de l'inspecteur ---------- */
  const strip = document.createElement('section'); strip.className = 'ntRel'; strip.hidden = true; strip.setAttribute('aria-label', tl('Lié à'));
  pane.before(strip);
  let stripList = [], stripSig = '';
  function paintStrip() {
    const s = ctx.selection(), show = ctx.isOn() && !!s && ctx.multi().length < 2 && !pane.hidden;
    if (!show) { strip.hidden = true; stripSig = ''; return; }
    const sig = s.kind + ':' + s.id + '#' + ver + ctx.view(); if (sig === stripSig) { strip.hidden = !stripList.length; return; }
    stripSig = sig; stripList = related(s);
    strip.hidden = !stripList.length; if (!stripList.length) return;
    const cur = ctx.view(), top = stripList.filter(x => !(x.target.view === cur && x.group === 'place' && same(x.target, { kind: s.kind, id: s.id })));
    const chips = [...top.filter(x => x.letter), ...top.filter(x => !x.letter)].slice(0, 7);
    strip.innerHTML = `<div class="ntRelHead"><b>${tl('Lié à')}</b><button type="button" class="ntRelAll" data-relall aria-haspopup="menu" data-tip="${esc(tl('Tout ce qui est lié · Alt+Entrée'))}">${tl('Tout ({0})', stripList.length)}${icon('chevDown')}</button></div><div class="ntRelChips">${chips.map(it => `<button type="button" class="ntRelChip g-${it.group}" data-rel="${esc(it.key)}" title="${esc([it.label, it.sub].filter(Boolean).join(' · '))}">${icon(it.icon || 'link')}<span>${esc(it.label)}</span>${it.letter ? `<kbd>${it.letter}</kbd>` : ''}</button>`).join('')}</div>`;
  }
  strip.addEventListener('click', e => {
    if (e.target.closest('[data-relall]')) { openMenu(e.target.closest('[data-relall]')); return; }
    const b = e.target.closest('[data-rel]'); if (!b) return;
    const it = stripList.find(x => x.key === b.dataset.rel); if (it) go(it.target);
  });
  strip.addEventListener('pointerover', e => { const b = e.target.closest('[data-rel]'); const it = b && stripList.find(x => x.key === b.dataset.rel); highlight(it ? it.hl : null); });
  strip.addEventListener('pointerleave', () => highlight(null));
  strip.addEventListener('focusin', e => { const b = e.target.closest('[data-rel]'); const it = b && stripList.find(x => x.key === b.dataset.rel); highlight(it ? it.hl : null); });
  strip.addEventListener('focusout', () => highlight(null));

  /* ---------- Historique ---------- */
  const H = { list: [], i: -1 }; let restoring = false;
  let navigating = 0;
  const here = () => { const v = ctx.view(), s = ctx.selection(); let floor = null; if (v === 'plan' && planVw && planVw.floor) floor = planVw.floor(); return { view: v, sel: s ? { kind: s.kind, id: s.id } : null, floor }; };
  let planVw = null;
  /** force : fin d'un saut (posée même si un autre saut est en cours, sinon des sauts rapprochés n'en laissent qu'un). */
  function record(force = false) {
    if (restoring || (navigating && !force) || !ctx.isOn()) return;
    const e = here(), cur = H.list[H.i]; e.t = Date.now();
    if (cur && cur.view === e.view && same(cur.sel, e.sel) && (cur.floor === e.floor || !e.floor)) return;
    // Même vue, rien de choisi avant : on complète l'entrée plutôt que d'en empiler une vide.
    if (cur && cur.view === e.view && !cur.sel && e.sel) { H.list[H.i] = e; paintArrows(); return; }
    // Choisir puis changer de vue dans le même geste (une vue qui sélectionne avant d'en ouvrir une autre) : une entrée.
    if (cur && same(cur.sel, e.sel) && e.t - cur.t < 700) { H.list[H.i] = e; paintArrows(); return; }
    H.list = H.list.slice(0, H.i + 1); H.list.push(e); if (H.list.length > 100) H.list.shift(); H.i = H.list.length - 1;
    paintArrows();
  }
  async function restore(e) {
    restoring = true;
    try {
      const vw = await ctx.openView(e.view);
      if (e.sel) { if (e.view === 'logic') ctx.reveal(e.sel.id); else if (!(vw && vw.reveal && vw.reveal(e.sel.id))) ctx.select(e.sel); }
      else if (e.floor && vw && vw.reveal) { vw.reveal(e.floor); ctx.select(null); }
      else ctx.select(null);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    } catch (err) { console.error(err); }
    restoring = false; paintArrows();
  }
  const canBack = () => H.i > 0, canForward = () => H.i < H.list.length - 1;
  function back() { if (!canBack()) return false; H.i--; restore(H.list[H.i]); return true; }
  function forward() { if (!canForward()) return false; H.i++; restore(H.list[H.i]); return true; }
  const arrows = document.createElement('div'); arrows.className = 'ntHist'; arrows.setAttribute('role', 'group'); arrows.setAttribute('aria-label', tl('Historique de navigation'));
  arrows.innerHTML = `<button type="button" class="ntHistBtn" data-hist="back" data-tip="${esc(tl('Précédent · Alt+←'))}" aria-label="${esc(tl('Précédent'))}">${icon('chevLeft')}</button><button type="button" class="ntHistBtn" data-hist="fwd" data-tip="${esc(tl('Suivant · Alt+→'))}" aria-label="${esc(tl('Suivant'))}">${icon('chevRight')}</button>`;
  const crumbs = viewBar.querySelector('.ntCrumbs'); if (crumbs) crumbs.before(arrows); else viewBar.appendChild(arrows);
  function paintArrows() { arrows.querySelector('[data-hist="back"]').disabled = !canBack(); arrows.querySelector('[data-hist="fwd"]').disabled = !canForward(); }
  arrows.addEventListener('click', e => { const b = e.target.closest('[data-hist]'); if (b) { if (b.dataset.hist === 'back') back(); else forward(); } });
  // Boutons « précédent / suivant » de la souris (4 et 5 : button 3 et 4).
  const mouse = e => { if (!ctx.isOn() || (e.button !== 3 && e.button !== 4)) return; e.preventDefault(); if (e.type === 'mouseup') { if (e.button === 3) back(); else forward(); } };
  host.addEventListener('mousedown', mouse); host.addEventListener('mouseup', mouse);
  ctx.onSelect(() => { record(); requestAnimationFrame(paintStrip); });
  ctx.onChange(() => requestAnimationFrame(paintStrip));
  new MutationObserver(() => paintStrip()).observe(pane, { attributes: true, attributeFilter: ['hidden'] });

  /* ---------- Clavier : Alt+← / Alt+→, Alt+Entrée, g puis une lettre ---------- */
  let chord = 0, chordToast = null;
  const endChord = () => { clearTimeout(chord); chord = 0; if (chordToast) { chordToast.close(); chordToast = null; } };
  function key(e) {
    if (e.type !== 'keydown') return false;
    const mod = e.ctrlKey || e.metaKey;
    if (e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { if (e.key === 'ArrowLeft') back(); else forward(); return true; }
    if (e.altKey && !mod && e.key === 'Enter') { openMenu(); return true; }
    if (chord) {
      const k = e.key.toLowerCase(); endChord();
      if (k === 'escape') return true;
      const it = related(ctx.selection()).find(x => x.letter === k);
      if (it) go(it.target); else ctx.status(tl('Rien de lié sous la lettre {0}.', k.toUpperCase()), 'warn');
      return true;
    }
    if (!mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'g' && ctx.selection()) {
      const list = related(ctx.selection()).filter(x => x.letter);
      if (!list.length) return false;
      chordToast = notify(`${tl('Aller à :')} ${list.map(x => `${x.letter.toUpperCase()} ${LETTERS[x.letter] ? LETTERS[x.letter]() : x.label}`).join(' · ')}`, 'info', { ms: 2500 });
      chord = setTimeout(endChord, 2500);
      return true;
    }
    return false;
  }

  const setPlan = vw => { planVw = vw; };
  record();
  return { related, relatedMenu, objectMenu, go, back, forward, canBack, canForward, key, highlight, openMenu, setPlan, paintStrip, record, remove, duplicate };
}
