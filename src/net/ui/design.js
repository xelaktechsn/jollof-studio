// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vue « Conception » du plan réseau (chargée à la demande par workspace.js) : onglets Dimensionnement (réglages,
// résultats, générateur avec aperçu), Étiquetage, Câbles, Brassage, Nomenclature (design-tables.js), Adressage
// (ipplan.js), Tests (certui.js, partie certification) et Documents (design-docs.js : exports, rapport imprimable).
// Tout vient du même modèle que les vues Logique, Plans et Baies ; chaque modification passe par ctx.commit() (Ctrl+Z).
import './design.css';
import { tl } from '../../i18n/index.js';
import { dimension, previewDesign, applyDesign, USAGE_IDS, floorsOf } from '../dimension.js';
import { labeler } from '../docs.js';
import { CATS, CAT_IDS } from '../cable.js';
import { NET } from '../limits.js';
import { SOURCES } from '../../check/sources.js';
import '../../check/sources-net.js';
import { esc, fmt, design, numField, selField, bindSettings, table, kpi, setDesign } from './design-util.js';

const TABS = [
  { id: 'dim', icon: 'gauge', name: () => tl('Dimensionnement') },
  { id: 'labels', icon: 'tag', name: () => tl('Étiquetage') },
  { id: 'cables', icon: 'cable', name: () => tl('Câbles') },
  { id: 'patch', icon: 'patchPanel', name: () => tl('Brassage') },
  { id: 'bom', icon: 'list', name: () => tl('Nomenclature') },
  { id: 'ip', icon: 'network', name: () => tl('Adressage') },
  { id: 'tests', icon: 'cableTester', name: () => tl('Tests') },
  { id: 'docs', icon: 'printer', name: () => tl('Documents') }
];
const PREF = 'jollof-net-design-tab';
export const USAGE_NAME = { office: () => tl('Bureau'), open: () => tl('Plateau ouvert'), meeting: () => tl('Salle de réunion'), classroom: () => tl('Salle de classe'), lab: () => tl('Laboratoire, atelier'), corridor: () => tl('Circulation'), storage: () => tl('Stockage, sanitaires'), tech: () => tl('Local technique'), other: () => tl('Autre usage') };

/** ctx : voir workspace.js (contrat des vues). Rend { el, show, hide, render, key, fit, reveal, pane, paneEvent, drop }. */
export function createDesignView(ctx) {
  const { icon } = ctx;
  const el = document.createElement('div'); el.className = 'ntVw ntDs'; el.hidden = true;
  let tab = 'dim'; try { const t = localStorage.getItem(PREF); if (TABS.some(x => x.id === t)) tab = t; } catch (e) { /* stockage indisponible */ }
  el.innerHTML = `<nav class="ntDsTabs" role="tablist" aria-label="${esc(tl('Conception'))}">${TABS.map(t => `<button type="button" role="tab" data-tab="${t.id}" data-tip="${esc(t.name())}" aria-label="${esc(t.name())}">${icon(t.icon)}<span>${esc(t.name())}</span></button>`).join('')}</nav><div class="ntDsBody" tabindex="-1"></div>`;
  ctx.host.appendChild(el);
  const body = el.querySelector('.ntDsBody');
  let sub = null, subTab = null, shown = false; // onglet fourni par un autre module (Adressage, Tests) : { render, destroy }
  const paintTabs = () => el.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  el.querySelector('.ntDsTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; try { localStorage.setItem(PREF, tab); } catch (x) { /* rien */ } render('tab'); });
  bindSettings(ctx, body);

  /** Rend l'onglet courant ; garde le défilement quand c'est le même onglet. */
  async function render(why) {
    if (!shown) return;
    paintTabs();
    const top = why === 'tab' ? 0 : body.scrollTop;
    if (subTab && subTab !== tab) { try { sub && sub.destroy && sub.destroy(); } catch (e) { console.error(e); } sub = null; subTab = null; }
    try {
      if (tab === 'dim') body.innerHTML = renderDim(ctx);
      else if (tab === 'ip' || tab === 'tests') return renderSub(why);
      else {
        const m = await import('./design-tables.js'), d = tab === 'docs' ? await import('./design-docs.js') : null;
        if (!shown) return;
        if (tab === 'docs') body.innerHTML = d.renderDocs(ctx);
        else body.innerHTML = m.renderTab(ctx, tab, state);
      }
    } catch (e) { console.error(e); body.innerHTML = `<p class="ntDsEmpty">${esc(tl('Cet onglet n’a pas pu s’afficher.'))}</p>`; }
    body.scrollTop = top;
  }
  const state = { q: '', kind: '', lkind: '' }; // filtres des tableaux
  /** Onglets des autres modules : chargés une fois, rendus dans un sous-élément. */
  async function renderSub() {
    if (sub && subTab === tab) { try { sub.render(); } catch (e) { console.error(e); } return; }
    body.innerHTML = '<div class="ntDsSub"></div>';
    const host = body.firstChild;
    try {
      const m = tab === 'ip' ? await import('./ipplan.js') : await import('./certui.js');
      const f = tab === 'ip' ? m.renderIpPlan : m.renderCertTab;
      if (!shown || !host.isConnected) return;
      sub = f ? f(ctx, host) : null; subTab = tab;
      if (!host.innerHTML.trim()) host.innerHTML = `<p class="ntDsEmpty">${esc(tab === 'tests' ? tl('La certification des liens n’est pas encore disponible dans cette version.') : tl('Cet onglet n’a pas pu s’afficher.'))}</p>`;
    } catch (e) { console.error(e); host.innerHTML = `<p class="ntDsEmpty">${esc(tl('Cet onglet n’a pas pu s’afficher.'))}</p>`; }
  }

  // Actions des onglets (délégation).
  body.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b || !body.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'apply') return doApply();
    if (act === 'plan') return ctx.openView('plan');
    if (act === 'reveal') return ctx.reveal(b.dataset.id);
    if (tab !== 'dim') {
      const m = tab === 'docs' ? await import('./design-docs.js') : await import('./design-tables.js');
      if (m.onAction) m.onAction(ctx, act, b, state, () => render('change'));
    }
  });
  body.addEventListener('input', async e => {
    const t = e.target.closest('[data-filter]'); if (!t) return;
    state[t.dataset.filter] = t.value;
    clearTimeout(body._ft); body._ft = setTimeout(() => render('filter').then(() => { const i = body.querySelector(`[data-filter="${t.dataset.filter}"]`); if (i && t.type !== 'select-one') { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }), 180);
  });
  body.addEventListener('change', async e => {
    const t = e.target;
    if (t.dataset.room != null) { // local technique ou nombre de prises imposé à une pièce
      const D = design(ctx), r = { ...(D.rooms[t.dataset.room] || {}) };
      if (t.dataset.k === 'tr') { if (t.value) r.tr = t.value; else delete r.tr; }
      else { if (t.value === '') delete r.outlets; else r.outlets = +t.value; }
      const rooms = { ...D.rooms }; if (Object.keys(r).length) rooms[t.dataset.room] = r; else delete rooms[t.dataset.room];
      setDesign(ctx, 'rooms', rooms); return;
    }
    if (tab !== 'dim' && t.closest('[data-edit]')) { const m = tab === 'docs' ? await import('./design-docs.js') : await import('./design-tables.js'); if (m.onEdit) m.onEdit(ctx, t, state); }
  });

  function doApply() {
    const data = ctx.data(), res = applyDesign(data);
    if (res.notes.includes('types')) { ctx.status(tl('Les équipements du câblage structuré manquent dans cette version.'), 'err'); return; }
    const c = res.created;
    if (!c.devices && !c.cables && !c.vlans) { ctx.status(tl('Rien à poser : toutes les pièces ont déjà leurs prises.'), 'warn'); return; }
    ctx.commit();
    ctx.status(tl('Posé : {0} prises, {1} panneaux, {2} switchs, {3} câbles, {4} baies, {5} VLAN.', c.outlets, c.panels, c.switches, c.cables, c.racks, c.vlans), 'ok');
  }

  return {
    el,
    show() { el.hidden = false; shown = true; },
    hide() { el.hidden = true; shown = false; },
    render(why) { render(why); },
    key: () => false,
    fit() {},
    reveal(id) { void id; return false; },
    pane: () => null,
    paneEvent: () => false,
    drop() { ctx.status(tl('Posez les équipements dans la vue Plans, Baies ou Logique.'), 'warn'); }
  };
}

/* ---------- Onglet Dimensionnement ---------- */
const srcLine = keys => [...new Set([].concat(...keys.map(k => NET[k] ? [].concat(NET[k].src) : [])))].map(s => SOURCES[s] ? `${SOURCES[s].title} (${SOURCES[s].publisher})` : s).join(' ; ');
function renderDim(ctx) {
  const data = ctx.data(), D = design(ctx), floors = floorsOf(data), nRooms = floors.reduce((a, x) => a + (x.f.rooms || []).length, 0);
  const cls = n => [0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => [k, tl('classe {0} ({1} W)', k, NET.POE_PSE_W.v[k])]);
  const side = `<aside class="ntDsSide">
    <section><h3>${esc(tl('Densité'))}</h3>
      ${numField(tl('Surface par poste de travail'), 'area', D.area, { min: 1, max: 1000, step: 0.5, unit: 'm²', hint: tl('Règle courante : {0} m² (TIA-569).', NET.WA_AREA_M2.v) })}
      ${numField(tl('Prises par poste'), 'outlets', D.outlets, { min: 1, max: 24, hint: tl('Au moins {0} (TIA-568).', NET.WA_OUTLETS.v) })}
      ${numField(tl('Point d’accès estimé tous les'), 'apArea', D.apArea, { min: 0, max: 5000, step: 10, unit: 'm²', hint: tl('Seulement si le plan Wi-Fi n’a pas encore de point d’accès ; 0 : aucun.') })}
      <details class="ntDsUsage"><summary>${esc(tl('Densité par usage de pièce'))}</summary>
        ${table([{ name: tl('Usage'), key: k => USAGE_NAME[k]() }, { name: 'm²', key: k => `<input class="inp" type="number" min="0" max="1000" step="0.5" data-set="usage.${k}.area" value="${D.usage[k].area}">`, html: 1 }, { name: tl('Prises'), key: k => `<input class="inp" type="number" min="0" max="24" data-set="usage.${k}.outlets" value="${D.usage[k].outlets}">`, html: 1 }, { name: tl('Tél.'), key: k => `<input class="inp" type="number" min="0" max="4" step="0.5" data-set="usage.${k}.phones" value="${D.usage[k].phones}">`, html: 1 }, { name: tl('Caméras'), key: k => `<input class="inp" type="number" min="0" max="20" data-set="usage.${k}.cams" value="${D.usage[k].cams}">`, html: 1 }, { name: tl('Min.'), key: k => `<input class="inp" type="number" min="0" max="50" data-set="usage.${k}.min" value="${D.usage[k].min}">`, html: 1 }], USAGE_IDS, { cls: 'ntDsCompact' })}
        <p class="ntDsNote">${esc(tl('m² par poste (0 : pas de poste), prises par poste, téléphones par poste, caméras par pièce, postes au moins par pièce.'))}</p>
      </details></section>
    <section><h3>${esc(tl('Réserve et réseau'))}</h3>
      ${numField(tl('Réserve de ports'), 'spare', D.spare, { min: 0, max: 200, unit: '%' })}
      ${numField(tl('Surréservation visée au plus'), 'oversub', D.oversub, { min: 1, max: 100, unit: ':1', hint: tl('Guide courant : {0}:1 entre accès et distribution.', NET.OVERSUB_ACCESS.v) })}
      ${numField(tl('Liaisons montantes par switch'), 'uplinks', D.uplinks, { min: 1, max: 4 })}
      ${selField(tl('Panneaux de brassage'), 'panel', D.panel, [[24, tl('24 ports')], [48, tl('48 ports')]], { num: 1 })}
      ${selField(tl('Switchs d’accès'), 'sw', D.sw, [['auto', tl('Automatique (48, puis 24)')], [24, tl('24 ports')], [48, tl('48 ports')]])}
    </section>
    <section><h3>PoE</h3>
      ${selField(tl('Téléphones IP'), 'poe.phone', D.poe.phone, cls(), { num: 1 })}
      ${selField(tl('Points d’accès'), 'poe.ap', D.poe.ap, cls(), { num: 1 })}
      ${selField(tl('Caméras'), 'poe.camera', D.poe.camera, cls(), { num: 1 })}
      ${numField(tl('Marge PoE gardée libre'), 'poeMargin', D.poeMargin, { min: 0, max: 90, unit: '%' })}
    </section>
    <section><h3>${esc(tl('Câble'))}</h3>
      ${selField(tl('Catégorie'), 'cat', D.cat, CAT_IDS.map(k => [k, CATS[k].name]))}
      ${numField(tl('Longueur d’un touret'), 'box', D.box, { min: 50, max: 2000, unit: 'm', hint: tl('{0} m (1000 ft) chez les fabricants.', NET.CABLE_BOX_M.v) })}
      ${numField(tl('Chutes'), 'waste', D.waste, { min: 0, max: 100, unit: '%' })}
      ${numField(tl('Mou côté baie'), 'slack.tr', D.slack.tr, { min: 0, max: 20, step: 0.5, unit: 'm' })}
      ${numField(tl('Mou côté prise'), 'slack.wa', D.slack.wa, { min: 0, max: 5, step: 0.1, unit: 'm' })}
      ${numField(tl('Cordon de brassage'), 'cord', D.cord, { min: 0.3, max: 10, step: 0.5, unit: 'm' })}
    </section>
    <section><h3>${esc(tl('Baies et onduleur'))}</h3>
      ${selField(tl('Hauteur des baies créées'), 'rackU', D.rackU, [12, 15, 18, 22, 24, 27, 32, 37, 42, 45, 47, 48].map(u => [u, u + ' U']), { num: 1 })}
      ${numField(tl('Marge de l’onduleur'), 'upsMargin', D.upsMargin, { min: 0, max: 200, unit: '%' })}
    </section>
    <p class="ntDsNote">${esc(tl('Valeurs par défaut modifiables. Chiffres de norme lus dans : {0}.', srcLine(['WA_AREA_M2', 'CABLE_BOX_M', 'OVERSUB_ACCESS'])))}</p>
  </aside>`;
  if (!nRooms) return `<div class="ntDsGrid">${side}<main class="ntDsMain"><div class="ntDsEmptyBig">${ctx.icon('floorPlan')}<h3>${esc(tl('Aucune pièce à dimensionner'))}</h3><p>${esc(tl('Dessinez les bâtiments, les étages et les pièces (avec leur usage) dans la vue Plans : le dimensionnement en déduit les postes de travail, les prises, les switchs, les panneaux et le câble.'))}</p><button type="button" class="btn primary" data-act="plan">${ctx.icon('floorPlan')}<span>${esc(tl('Ouvrir la vue Plans'))}</span></button></div></main></div>`;
  const r = dimension(data), t = r.totals, L = labeler(data), pv = previewDesign(data), c = pv.created;
  const trName = key => { const x = r.trs.find(z => z.key === key); if (!x) return '—'; const s = L.space(key); return (s || (x.level < 0 ? 'S' + -x.level : x.level) + x.letter) + (x.virtual ? ' ' + tl('(à créer)') : ''); };
  const flName = id => { const F = floors.find(x => x.f.id === id); return F ? (floors.some(x => x.b !== F.b) ? (F.b.name || F.b.id) + ' · ' : '') + (F.f.name || F.f.id) : id; };
  const est = r.trs.some(x => x.cable.est && x.outlets);
  const kpis = `<div class="ntDsKpis">
    ${kpi(tl('Postes de travail'), fmt(t.wa), { sub: tl('{0} pièces, {1} m²', t.rooms, fmt(t.area)) })}
    ${kpi(tl('Prises'), fmt(t.outlets), { sub: tl('{0} ports avec la réserve', fmt(t.ports)) })}
    ${kpi(tl('Switchs d’accès'), fmt(t.switches), { sub: [t.sw48 ? t.sw48 + ' × 48' : '', t.sw24 ? t.sw24 + ' × 24' : ''].filter(Boolean).join(' · ') || '—' })}
    ${kpi(tl('Panneaux de brassage'), fmt(t.panels), { sub: tl('{0} ports', D.panel) })}
    ${kpi(tl('Baies'), fmt(t.racks), { sub: t.newRacks ? tl('dont {0} à créer', t.newRacks) : tl('{0} U occupées', t.u) })}
    ${kpi(tl('PoE prévu'), fmt(t.poeW) + ' W', { sub: tl('{0} tél., {1} PA, {2} caméras', t.phones, t.aps, t.cams) })}
    ${kpi(tl('Câble cuivre'), fmt(t.cableM) + ' m', { sub: tl('{0} tourets de {1} m', t.boxes, fmt(D.box)) + (est ? ' · ' + tl('estimé') : '') })}
    ${kpi(tl('Fibre de rocade'), tl('{0} brins', t.fibreStrands), { sub: r.fibre.est ? tl('estimé') : tl('{0} câbles', r.fibre.cables) })}
    ${kpi(tl('Surréservation maximale'), fmt(t.oversubMax, 1) + ':1', { warn: t.oversubMax > D.oversub, ok: t.oversubMax && t.oversubMax <= D.oversub })}
  </div>`;
  const gen = `<section class="ntDsCard ntDsGen"><div><h3>${ctx.icon('wand')}${esc(tl('Générateur'))}</h3>
    <p>${c.devices || c.cables ? esc(tl('Posera dans le modèle (vues Logique, Plans et Baies) : {0} prises, {1} panneaux, {2} switchs, {3} baies, {4} câbles (liens permanents, cordons, liaisons montantes), {5} VLAN.', c.outlets, c.panels, c.switches, c.racks, c.cables, c.vlans)) : esc(tl('Toutes les pièces ont déjà leurs prises : rien à poser.'))}${pv.skipped.length ? ' ' + esc(tl('{0} pièces déjà équipées restent telles quelles.', pv.skipped.length)) : ''}</p>
    <p class="ntDsNote">${esc(tl('Une seule étape d’annulation (Ctrl+Z). Les longueurs des liens permanents suivent ensuite les cheminements tracés (tracé automatique).'))}</p></div>
    <button type="button" class="btn primary" data-act="apply"${c.devices || c.cables ? '' : ' disabled'}>${ctx.icon('wand')}<span>${esc(tl('Appliquer'))}</span></button></section>`;
  const warn = [];
  for (const w of r.warnings) if (w.kind === 'far') warn.push(tl('Local {0} : {1} pièces à plus de {2} m estimés (lien permanent) : ajoutez un local technique plus proche.', trName(w.tr), w.rooms.length, NET.PERMANENT_M.v));
  for (const x of r.trs) { if (!x.oversubOk) warn.push(tl('Local {0} : surréservation {1}:1 au-dessus de la cible.', trName(x.key), fmt(x.oversub, 1))); if (!x.poe.ok && x.poe.need) warn.push(tl('Local {0} : PoE prévu {1} W pour {2} W de budget (marge {3} %).', trName(x.key), fmt(x.poe.need), fmt(x.poe.budget), D.poeMargin)); }
  for (const p of r.cable.per) if (p.tooLong) warn.push(tl('Local {0} : la longueur moyenne d’un lien dépasse un touret.', trName(p.tr)));
  const trTable = table([
    { name: tl('Local'), key: x => trName(x.key) }, { name: tl('Étage'), key: x => flName(x.floor) }, { name: tl('Nombre de pièces'), key: x => x.rooms.length, num: 1 },
    { name: tl('Prises'), key: 'outlets', num: 1 }, { name: tl('Ports'), key: 'ports', num: 1 }, { name: tl('Panneaux'), key: x => x.panels ? `${x.panels} × ${x.panelPorts}` : '—', num: 1 },
    { name: tl('Switchs'), key: x => x.switches.map(s => `${s.n} × ${s.ports}`).join(' + ') || '—', num: 1 }, { name: tl('Montantes'), key: 'uplinks', num: 1 },
    { name: tl('Surréservation'), key: x => x.uplinks ? fmt(x.oversub, 1) + ':1' : '—', num: 1, cls: '' },
    { name: 'PoE (W)', key: x => `${fmt(x.poe.need)} / ${x.poe.budget ? fmt(x.poe.budget) : '—'}`, num: 1 },
    { name: 'U', key: x => `${x.u} (${x.racksNeeded} ${tl('baie(s)')})`, num: 1 }, { name: tl('Onduleur (W)'), key: x => x.ups.known ? fmt(x.ups.sizedW) : (x.poe.need ? '≥ ' + fmt(Math.round(x.poe.need * (1 + D.upsMargin / 100))) : '—'), num: 1 },
    { name: tl('Lien moyen (m)'), key: x => fmt(x.cable.avg, 1) + (x.cable.est ? ' *' : ''), num: 1 }, { name: tl('Câble (m)'), key: x => fmt(x.cable.total), num: 1 }
  ], r.trs.filter(x => x.outlets || !x.virtual), { attrs: x => (x.oversubOk && x.poe.ok ? '' : 'class="warn"') });
  const rackOpts = (data.racks || []).map(k => [k.id, L.rack(k.id) + ' · ' + (k.name || k.id)]);
  const roomTable = table([
    { name: tl('Nom de la pièce'), key: x => `<button type="button" class="ntDsLink" data-act="reveal" data-id="${esc(x.id)}">${esc(x.name)}</button>`, html: 1 }, { name: tl('Étage'), key: x => flName(x.floor) },
    { name: tl('Usage'), key: x => USAGE_NAME[x.usage]() }, { name: 'm²', key: x => fmt(x.area, 1), num: 1 }, { name: tl('Postes de travail'), key: 'wa', num: 1 },
    { name: tl('Prises'), key: x => `<input class="inp ntDsNum" type="number" min="0" max="500" data-room="${esc(x.id)}" data-k="outlets" value="${D.rooms[x.id] && D.rooms[x.id].outlets != null ? D.rooms[x.id].outlets : ''}" placeholder="${x.outlets}" aria-label="${esc(tl('Prises imposées'))}">`, html: 1, num: 1 },
    { name: tl('Posées'), key: x => (x.placed ? `<span class="${x.placed < x.outlets ? 'ntDsBad' : 'ntDsGood'}">${x.placed}</span>` : '—'), html: 1, num: 1 },
    { name: tl('Local'), key: x => `<select class="sel ntDsSel" data-room="${esc(x.id)}" data-k="tr" aria-label="${esc(tl('Local qui dessert la pièce'))}"><option value="">${esc(tl('Le plus proche : {0}', trName(x.tr)))}</option>${rackOpts.map(([k, n]) => `<option value="${esc(k)}"${D.rooms[x.id] && D.rooms[x.id].tr === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`, html: 1 },
    { name: tl('Lien (m)'), key: x => `<span class="${x.run > NET.PERMANENT_M.v ? 'ntDsBad' : ''}">${fmt(x.run, 1)}</span>`, html: 1, num: 1 }
  ], r.rooms);
  const floorTable = table([{ name: tl('Étage'), key: x => (floors.some(z => z.b.id !== x.building) ? x.buildingName + ' · ' : '') + x.name }, { name: tl('Nombre de pièces'), key: 'rooms', num: 1 }, { name: 'm²', key: x => fmt(x.area), num: 1 }, { name: tl('Postes de travail'), key: 'wa', num: 1 }, { name: tl('Prises'), key: 'outlets', num: 1 }, { name: tl('Locaux'), key: x => x.trs.map(trName).join(', ') || '—' }], r.floors);
  return `<div class="ntDsGrid ntDsDim">${side}<div class="ntDsHead">${kpis}${gen}
    ${warn.length ? `<section class="ntDsWarn">${warn.map(w => `<p>${ctx.icon('alert')}${esc(w)}</p>`).join('')}</section>` : ''}</div>
    <main class="ntDsMain ntDsRest"><section class="ntDsCard"><h3>${esc(tl('Locaux techniques'))}</h3>${trTable}${est ? `<p class="ntDsNote">* ${esc(tl('Longueur estimée (modèle simplifié : trajet en L sous le plafond, descentes et mou) tant qu’aucun câble n’est posé.'))}</p>` : ''}</section>
    <section class="ntDsCard"><h3>${esc(tl('Étages'))}</h3>${floorTable}</section>
    <section class="ntDsCard"><h3>${esc(tl('Pièces à équiper'))}</h3>${roomTable}<p class="ntDsNote">${esc(tl('Laissez « Prises » vide pour le calcul par la densité ; choisissez un local pour imposer celui qui dessert la pièce.'))}</p></section>
  </main></div>`;
}
