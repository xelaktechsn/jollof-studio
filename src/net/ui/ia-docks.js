// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Onglets du projet réseau dans le panneau du bas (chargés par ia.js, contenus calculés au premier affichage et tenus à
// jour tant qu'ils sont montrés) : Brassage (tableau de brassage des baies, rack.js patchingSchedule), Câbles (tableau
// des câbles, docs.js cableSchedule), Résultats des tests (rapport de certification, certify.js testState ; en mode
// examen, ni verdict ni marge). Triables, filtrables (« baie:B1 », « vlan:20 »), clic : y aller, menu contextuel, CSV.
import { tl } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { spacesOf } from '../../ui/kind.js';
import { download, toast } from '../../school/ui.js';
import { createTable, ctxMenu } from './kit/index.js';
import { labeler, cableSchedule, toCsv, patchColName } from '../docs.js';
import * as RACK from '../rack.js';
import { testState, linkLabel, defaultLimit, limitInfo, paramName, verdictText } from '../certify.js';
import { isExam } from '../exam.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KINDS = { horizontal: () => tl('lien permanent'), cord: () => tl('cordon'), backbone: () => tl('rocade'), other: () => tl('autre') };
const num1 = (v, en) => (v == null || v === '' ? '' : (en ? String(+(+v).toFixed(1)) : String(+(+v).toFixed(1)).replace('.', ',')));

/** Lignes du tableau de brassage, avec les identifiants des objets (pour y aller). */
export function patchTable(data, lan) {
  const L = labeler(data);
  let rows = [];
  try { rows = RACK.patchingSchedule(data, lan || null) || []; } catch (e) { console.error(e); }
  return rows.map((r, i) => ({
    key: `${r.panelId}|${r.portId}|${i}`,
    rack: r.rackId ? L.rack(r.rackId) || r.rack : r.rack || '', panel: r.panelId ? L.of(r.panelId) || r.panel : r.panel || '',
    port: r.panelId && r.portId ? L.of(r.panelId, r.portId) || r.port : r.port || '', device: r.switch || '', dport: r.switchPort || '',
    vlan: r.vlan ?? '', outlet: r.outletId ? L.of(r.outletId) || r.outlet : r.outlet || '', oport: r.outletPort || '',
    permLen: r.permLen, cordLen: r.cordLen, up: r.up,
    ids: { rack: r.rackId, panel: r.panelId, sw: r.switchId, outlet: r.outletId, cable: r.cableId }
  }));
}

export function installDocks(ctx, { goTo, showIn }) {
  const app = ctx.app; if (!app.dock || !app.dock.addTab) return null;
  const when = () => spacesOf(app.kind ? app.kind() : 'elec').includes('net');
  const en = ctx.isEn;
  const tabs = [];
  const dev = id => ({ kind: 'dev', id });

  /** Onglet : la table se crée au premier affichage ; tenue à jour après chaque changement tant qu'elle est montrée. */
  function addTab(id, label, make) {
    const el = document.createElement('div'); el.className = 'ntDk';
    el.addEventListener('click', e => { const b = e.target.closest('[data-dkdesign]'); if (b) openDesign(b.dataset.dkdesign); });
    const t = { id, el, table: null, shown: false, dirty: true, make };
    t.refresh = () => { if (!t.table) return; t.dirty = false; try { t.table.setRows(t.rows()); } catch (e) { console.error(e); } };
    app.dock.addTab({ id, label, el, when, onShow: () => { t.shown = true; if (!t.table) { const m = make(el); t.table = m.table; t.rows = m.rows; } if (t.dirty) t.refresh(); } });
    tabs.push(t);
    return t;
  }
  let pend = 0;
  ctx.onChange(() => {
    for (const t of tabs) t.dirty = true;
    clearTimeout(pend);
    pend = setTimeout(() => { const cur = app.dock.tab ? app.dock.tab() : ''; for (const t of tabs) if (t.table && cur === t.id) t.refresh(); }, 200);
  });
  // Le tableau complet (éditable, imprimable) est dans la vue Conception ; ici, la même source en vue vivante et compacte.
  const designBtn = tab => `<button type="button" class="tb ntDkCsv" data-dkdesign="${tab}" data-tip="${tl('Ouvrir le tableau complet dans la vue Conception')}">${icon('clipboard')}<span>${tl('Conception')}</span></button>`;
  const openDesign = tab => ctx.openView('design').then(() => { const b = ctx.host.querySelector(`.ntDsTabs [data-tab="${tab}"]`); if (b && b.getAttribute('aria-selected') !== 'true') b.click(); });
  const csvBtn = `<button type="button" class="tb ntDkCsv" data-dkcsv data-tip="${tl('Exporter en CSV (tableur)')}">${icon('download')}<span>CSV</span></button>`;
  const csv = (t, name, cols) => { const rows = t.table ? t.table.rows() : []; download(toCsv(cols, rows), name).catch(e => toast(tl('Enregistrement impossible : {0}', (e && e.message) || e), 'err')); };

  /* ---------- Brassage ---------- */
  const PK = ['rack', 'panel', 'port', 'device', 'dport', 'vlan', 'outlet', 'oport', 'permLen', 'cordLen'];
  const patch = addTab('netPatch', tl('Brassage'), el => {
    const cols = PK.map(k => ({ key: k, label: patchColName(k), num: k === 'permLen' || k === 'cordLen' || k === 'vlan', width: k === 'permLen' || k === 'cordLen' ? '96px' : k === 'vlan' ? '64px' : k === 'dport' || k === 'oport' ? '90px' : 'minmax(100px, 1fr)', text: r => (k.endsWith('Len') ? num1(r[k], en) : r[k]), html: k.endsWith('Len') ? r => esc(num1(r[k], en)) : k === 'device' ? r => `${r.up === true ? '<i class="ntDkUp on"></i>' : r.up === false ? '<i class="ntDkUp"></i>' : ''}${esc(r.device)}` : undefined }));
    const table = createTable(el, {
      columns: cols, rowKey: r => r.key, label: tl('Brassage'), placeholder: tl('Filtrer… ex. : baie:B1 vlan:20'), tools: designBtn('patch') + csvBtn,
      empty: () => tl('Aucun panneau de brassage câblé : rangez des panneaux dans les baies et reliez-les aux prises et aux switchs.'),
      onActivate: r => { if (r.ids.panel) showIn('racks', r.ids.panel); },
      onContext: (r, ev) => ctxMenu(ev, [
        { label: tl('Panneau dans sa baie'), icon: 'rack', disabled: !r.ids.panel, run: () => showIn('racks', r.ids.panel) },
        { label: tl('Switch'), icon: 'switchNet', disabled: !r.ids.sw, run: () => goTo({ ...dev(r.ids.sw) }) },
        { label: tl('Prise sur le plan'), icon: 'outlet', disabled: !r.ids.outlet, run: () => showIn('plan', r.ids.outlet) },
        { label: tl('Cordon de brassage'), icon: 'cable', disabled: !r.ids.cable, run: () => goTo({ kind: 'cable', id: r.ids.cable }) },
        '-',
        { label: tl('Choisir panneau, switch et prise'), icon: 'checklist', run: () => ctx.selectMany([r.ids.panel, r.ids.sw, r.ids.outlet].filter(Boolean).map(dev)) }
      ])
    });
    el.querySelector('[data-dkcsv]').onclick = () => csv(patch, tl('brassage.csv'), PK.map(k => ({ key: k, name: patchColName(k) })));
    return { table, rows: () => patchTable(ctx.data(), ctx.lan()) };
  });

  /* ---------- Câbles ---------- */
  const CC = [
    { key: 'label', label: tl('Identifiant'), width: 'minmax(110px, 1fr)' },
    { key: 'kind', label: tl('Genre'), width: '120px', text: r => (KINDS[r.kind] ? KINDS[r.kind]() : r.kind) },
    { key: 'from', label: tl('De'), width: 'minmax(140px, 1.4fr)' },
    { key: 'to', label: tl('À'), width: 'minmax(140px, 1.4fr)' },
    { key: 'type', label: tl('Type'), width: '90px' },
    { key: 'len', label: tl('Longueur (m)'), width: '100px', num: true, text: r => num1(r.len, en) },
    { key: 'mode', label: tl('Longueur donnée par'), width: '150px', text: r => (r.mode === 'auto' ? (r.fallback ? tl('équerre (sans cheminement)') : tl('cheminements')) : tl('saisie')) },
    { key: 'paths', label: tl('Cheminements'), width: 'minmax(120px, 1fr)', value: r => (r.paths || []).join(' › ') }
  ];
  for (const c of CC) if (c.text && !c.html) c.html = r => esc(c.text(r));
  CC[6].html = r => (r.mode === 'auto' && r.fallback ? `<span class="ntKV warn">${esc(CC[6].text(r))}</span>` : esc(CC[6].text(r)));
  const cables = addTab('netCables', tl('Câbles'), el => {
    const table = createTable(el, {
      columns: CC, rowKey: r => r.id, label: tl('Câbles'), placeholder: tl('Filtrer… ex. : genre:rocade type:6a'), tools: designBtn('cables') + csvBtn,
      empty: () => tl('Aucun câble dans le projet.'),
      onActivate: r => goTo({ kind: 'cable', id: r.id }),
      onContext: (r, ev) => ctxMenu(ev, [
        { label: tl('Voir sur le plan'), icon: 'floorPlan', run: () => showIn('plan', r.id) },
        { label: tl('Voir sur le schéma logique'), icon: 'network', run: () => showIn('logic', r.id) },
        '-',
        { label: tl('Choisir les câbles filtrés ({0})', table.rows().length), icon: 'checklist', run: () => ctx.selectMany(table.rows().map(x => ({ kind: 'cable', id: x.id }))) }
      ])
    });
    el.querySelector('[data-dkcsv]').onclick = () => csv(cables, tl('cables.csv'), CC.map(c => ({ key: c.text || c.value || c.key, name: c.label })));
    return { table, rows: () => cableSchedule(ctx.data()) };
  });

  /* ---------- Résultats des tests ---------- */
  const VCLS = { pass: 'ok', 'pass*': 'warn', 'fail*': 'warn', fail: 'err' };
  const state = r => (!r.stored ? 'none' : r.stale ? 'stale' : 'ok');
  const STATE = { none: () => tl('non testé'), stale: () => tl('à refaire'), ok: () => tl('à jour') };
  const STATE_LONG = { stale: () => tl('à refaire (le lien a changé)') };
  // Mots du verdict dans la langue (filtre « verdict:échec », infobulle).
  const VWORD = { pass: () => tl('réussi'), 'pass*': () => tl('réussi de justesse'), 'fail*': () => tl('échec de justesse'), fail: () => tl('échec') };
  const testRows = () => {
    const d = ctx.data(), exam = isExam(d), { rows } = testState(d);
    return rows.map(r => {
      const s = r.stored, lim = (s && s.limit) || defaultLimit(r.link), li = limitInfo(lim);
      return {
        id: r.link.id, link: r.link, label: linkLabel(d, r.link), kind: r.link.kind === 'pl' ? tl('lien permanent') : tl('canal'),
        limit: li ? li.name : lim, verdict: exam || !s ? null : s.verdict, margin: exam || !s ? null : s.margin,
        param: exam || !s || !s.param ? '' : paramName(s.param), len: s ? s.len : r.link.len, at: s && s.at ? String(s.at).slice(0, 16).replace('T', ' ') : '', state: state(r), exam
      };
    });
  };
  const TC = [
    { key: 'label', label: tl('Lien'), width: 'minmax(150px, 2fr)', title: r => r.label },
    { key: 'limit', label: tl('Limite'), width: '118px', title: r => r.kind },
    { key: 'verdict', label: tl('Verdict'), width: '88px', text: r => (r.exam ? '' : r.verdict ? `${verdictText(r.verdict)} ${VWORD[r.verdict] ? VWORD[r.verdict]() : ''}` : tl('non testé')), title: r => (r.verdict && VWORD[r.verdict] ? VWORD[r.verdict]() : ''), html: r => (r.verdict ? `<span class="ntKV ${VCLS[r.verdict] || 'mut'}">${esc(verdictText(r.verdict))}</span>` : r.exam && r.state !== 'none' ? `<span class="ntKV mut" title="${esc(tl('Mode examen : verdict caché'))}">${icon('lock')}</span>` : `<span class="ntKV mut">${esc(tl('non testé'))}</span>`) },
    { key: 'margin', label: tl('Marge (dB)'), width: '84px', num: true, text: r => (r.margin == null ? '' : num1(r.margin, en)), html: r => (r.margin == null ? '<span class="mut">—</span>' : esc(num1(r.margin, en))) },
    { key: 'param', label: tl('Paramètre limitant'), tip: tl('Paramètre le plus faible'), width: 'minmax(120px, 1fr)' },
    { key: 'len', label: tl('Longueur (m)'), width: '90px', num: true, text: r => num1(r.len, en) },
    { key: 'state', label: tl('État'), width: '104px', text: r => STATE[r.state](), title: r => [STATE_LONG[r.state] ? STATE_LONG[r.state]() : '', r.at ? tl('testé le {0}', r.at) : ''].filter(Boolean).join(' · '), html: r => `<span class="ntKV ${r.state === 'stale' ? 'warn' : 'mut'}">${esc(STATE[r.state]())}</span>` }
  ];
  for (const c of TC) if (c.text && !c.html) c.html = r => esc(c.text(r));
  const tests = addTab('netTests', tl('Résultats des tests'), el => {
    const certBtn = `<button type="button" class="tb ntDkCsv" data-dkcert data-tip="${tl('Certifier tous les liens (testeur simulé)')}">${icon('certifier')}<span>${tl('Certifier tout')}</span></button>`;
    const table = createTable(el, {
      columns: TC, rowKey: r => r.id, label: tl('Résultats des tests'), placeholder: tl('Filtrer… ex. : verdict:échec état:refaire'), tools: certBtn + designBtn('tests') + csvBtn, sortKey: 'state',
      empty: () => tl('Aucun lien cuivre à certifier : il faut des câbles entre prises, panneaux et équipements.'),
      onActivate: r => { const c = r.link.cables[0]; if (c) goTo({ kind: 'cable', id: c.id }); },
      onContext: (r, ev) => ctxMenu(ev, [
        { label: tl('Voir le premier câble'), icon: 'cable', disabled: !r.link.cables[0], run: () => goTo({ kind: 'cable', id: r.link.cables[0].id }) },
        { label: tl('Choisir les câbles du lien ({0})', r.link.cables.length), icon: 'checklist', run: () => ctx.selectMany(r.link.cables.map(c => ({ kind: 'cable', id: c.id }))) },
        { label: tl('Choisir les deux extrémités'), icon: 'desktopPc', run: () => ctx.selectMany(r.link.ends.map(e => dev(e[0]))) }
      ])
    });
    el.querySelector('[data-dkcert]').onclick = () => { if (app.commands && app.commands.run) app.commands.run('net.cert.all'); };
    el.querySelector('[data-dkcsv]').onclick = () => csv(tests, tl('tests.csv'), [...TC.filter(c => !(isExam(ctx.data()) && (c.key === 'verdict' || c.key === 'margin' || c.key === 'param'))).map(c => ({ key: c.key === 'verdict' ? (r => (r.verdict ? verdictText(r.verdict) : '')) : c.text || c.key, name: c.label })), { key: 'kind', name: tl('Configuration') }, { key: 'at', name: tl('Testé le') }]);
    return { table, rows: testRows };
  });

  if (app.commands) {
    const isOn = () => when() && ctx.isOn();
    app.commands.register({ id: 'net.dock.patch', cat: tl('Réseau'), icon: 'patchPanel', label: tl('Réseau : tableau de brassage (panneau du bas)'), when: isOn, run: () => app.dock.show('netPatch') });
    app.commands.register({ id: 'net.dock.cables', cat: tl('Réseau'), icon: 'cable', label: tl('Réseau : tableau des câbles (panneau du bas)'), when: isOn, run: () => app.dock.show('netCables') });
    app.commands.register({ id: 'net.dock.tests', cat: tl('Réseau'), icon: 'certifier', label: tl('Réseau : résultats des tests (panneau du bas)'), when: isOn, run: () => app.dock.show('netTests') });
  }
  /** Montre un onglet, filtré (« Lié à » : la ligne de brassage d'une prise, le test d'un lien). */
  return { show(id, filter) { app.dock.show(id); const t = tabs.find(x => x.id === id); if (t && t.table && filter != null) t.table.setFilter(filter); } };
}
