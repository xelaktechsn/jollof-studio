// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Onglet « Documents » de la vue Conception : renseignements du projet (client, site, auteur, date, révision), rapport
// complet prêt à imprimer (page de garde, synthèse, plans, baies, tableaux, nomenclature, tests), exports SVG (plans
// d'étage avec les identifiants des prises, élévations des baies) et CSV. Le rapport s'imprime en PDF : dans un
// navigateur par une nouvelle fenêtre, dans l'application par la zone d'impression déjà utilisée pour le schéma.
import { tl, isEn } from '../../i18n/index.js';
import { reportHtml, floorSvg, rackSvg, labeler } from '../docs.js';
import { dimension, floorsOf } from '../dimension.js';
import { esc, design, txtField, saveText, saveCsv, fileBase } from './design-util.js';

/** Vues d'autres modules réutilisées si elles existent : plan d'étage (plans) et élévation (baies) en SVG. */
async function extViews() {
  const out = {};
  for (const [k, load, names] of [['planSvg', () => import('../site.js'), ['planSvg']], ['planSvg', () => import('../route.js'), ['planSvg']], ['rackSvg', () => import('../rack.js'), ['rackSvg', 'elevationSvg']]]) {
    if (out[k]) continue;
    try { const m = await load(); for (const n of names) if (typeof m[n] === 'function') { out[k] = m[n]; break; } } catch (e) { /* module absent */ }
  }
  // Une vue étrangère qui échoue retombe sur la nôtre.
  const safe = (f, mine) => (f ? (data, id, o) => { try { const s = f(data, id, o); return typeof s === 'string' && s.startsWith('<svg') ? s : mine(data, id, o); } catch (e) { return mine(data, id, o); } } : mine);
  return { planSvg: safe(out.planSvg, floorSvg), rackSvg: safe(out.rackSvg, rackSvg) };
}
/** Synthèse des tests de certification enregistrés (certify.js, partie certification) pour le rapport, ou ''. */
async function certHtml(ctx) {
  try {
    const m = await import('../certify.js'); if (typeof m.testState !== 'function') return '';
    const st = m.testState(ctx.data()), done = st.rows.filter(r => r.stored);
    if (!st.rows.length) return '';
    // Mode examen (exam.js) : combien de liens sont testés, sans leurs verdicts ni leurs marges.
    if (ctx.data().exam === true) return `<p>${esc(tl('{0} liens testés sur {1}. Mode examen : résultats sans verdict (voir le testeur de certification).', done.length, st.rows.length))}</p>`;
    const cnt = v => done.filter(r => r.stored.verdict === v).length, li = id => (m.limitInfo && m.limitInfo(id) ? m.limitInfo(id).name : id);
    const rows = done.map(r => `<tr><td>${esc(r.stored.label || (m.linkLabel ? m.linkLabel(ctx.data(), r.link) : r.link.id))}</td><td>${esc(li(r.stored.limit))}</td><td>${esc(m.verdictText ? m.verdictText(r.stored.verdict) : r.stored.verdict)}${r.stale ? ' · ' + esc(tl('périmé')) : ''}</td><td class="n">${esc(r.stored.margin ?? '')}</td><td class="n">${esc(r.stored.len ?? '')}</td></tr>`).join('');
    return `<p>${esc(tl('{0} liens testés sur {1} : {2} PASS, {3} PASS*, {4} FAIL*, {5} FAIL. Valeurs simulées par le modèle : ce n’est pas une mesure.', done.length, st.rows.length, cnt('pass'), cnt('pass*'), cnt('fail*'), cnt('fail')))}</p>${done.length ? `<table><thead><tr><th>${esc(tl('Lien'))}</th><th>${esc(tl('Limite'))}</th><th>${esc(tl('Résultat'))}</th><th class="n">${esc(tl('Marge (dB)'))}</th><th class="n">${esc(tl('Longueur (m)'))}</th></tr></thead><tbody>${rows}</tbody></table>` : ''}`;
  } catch (e) { console.error(e); return ''; }
}
async function buildReport(ctx, o = {}) {
  const data = ctx.data(), v = await extViews();
  return reportHtml(data, { ...o, dim: dimension(data), issues: ctx.issues(), lan: ctx.lan(), cert: await certHtml(ctx), planSvg: v.planSvg, rackSvg: v.rackSvg, en: isEn });
}

export function renderDocs(ctx) {
  const data = ctx.data(), D = design(ctx), P = D.project, floors = floorsOf(data), L = labeler(data), ic = ctx.icon;
  const btn = (act, label, i, extra = '', cls = '') => `<button type="button" class="btn small${cls}" data-act="${act}" ${extra}>${ic(i)}<span>${esc(label)}</span></button>`;
  return `<div class="ntDsPage ntDsDocs">
    <section class="ntDsCard"><h3>${esc(tl('Projet'))}</h3><div class="ntDsForm">
      ${txtField(tl('Client'), 'project.client', P.client)}${txtField(tl('Site'), 'project.site', P.site || (data.site && data.site.name) || '')}${txtField(tl('Auteur'), 'project.author', P.author)}
      ${txtField(tl('Date'), 'project.date', P.date, { type: 'date', max: 10 })}${txtField(tl('Révision'), 'project.rev', P.rev, { max: 12 })}</div>
      <p class="ntDsNote">${esc(tl('Ces renseignements figurent sur la page de garde du rapport et sont enregistrés avec le projet.'))}</p></section>
    <section class="ntDsCard ntDsReport"><div><h3>${ic('printer')}${esc(tl('Rapport complet'))}</h3>
      <p>${esc(tl('Page de garde, synthèse du dimensionnement, plans d’étage avec les identifiants des prises, élévations des baies, tableaux des câbles, du brassage et des étiquettes, nomenclature chiffrée, plan d’adressage, tests et problèmes relevés.'))}</p></div>
      <div class="ntDsBtns">${btn('print', tl('Imprimer ou enregistrer en PDF'), 'printer', '', ' primary')}${btn('save-report', tl('Enregistrer le rapport (HTML)'), 'download')}</div></section>
    <section class="ntDsCard"><h3>${esc(tl('Plans d’étage (SVG)'))}</h3><div class="ntDsBtns">${floors.map(({ b, f }) => btn('svg-floor', (floors.some(x => x.b !== b) ? (b.name || b.id) + ' · ' : '') + (f.name || f.id), 'floorPlan', `data-id="${esc(f.id)}"`)).join('') || `<p class="ntDsNote">${esc(tl('Aucun étage : dessinez-les dans la vue Plans.'))}</p>`}</div></section>
    <section class="ntDsCard"><h3>${esc(tl('Élévations des baies (SVG)'))}</h3><div class="ntDsBtns">${(data.racks || []).map(r => btn('svg-rack', L.rack(r.id), 'rack', `data-id="${esc(r.id)}"`)).join('') || `<p class="ntDsNote">${esc(tl('Aucune baie.'))}</p>`}</div></section>
    <section class="ntDsCard"><h3>${esc(tl('Tableaux (CSV)'))}</h3><div class="ntDsBtns">${btn('csv-labels', tl('Étiquettes'), 'tag')}${btn('csv-cables', tl('Câbles'), 'cable')}${btn('csv-patch', tl('Brassage'), 'patchPanel')}${btn('csv-bom', tl('Nomenclature'), 'list')}${btn('csv-rooms', tl('Pièces et prises'), 'floorPlan')}${btn('csv-trs', tl('Locaux techniques'), 'rack')}</div></section>
  </div>`;
}

/** Impression : nouvelle fenêtre dans un navigateur ; zone d'impression de l'application dans Tauri (ou si la fenêtre est bloquée). */
async function printReport(ctx) {
  const native = await import('../../native.js');
  if (!native.isTauri()) {
    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(await buildReport(ctx)); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* l'utilisateur imprime lui-même */ } }, 400); ctx.status(tl('Rapport ouvert dans une nouvelle fenêtre : imprimez-le ou enregistrez-le en PDF.'), 'ok'); return; }
  }
  const area = document.getElementById('printArea'); if (!area) { ctx.status(tl('Impression indisponible ici : enregistrez le rapport puis imprimez-le.'), 'warn'); return; }
  area.innerHTML = await buildReport(ctx, { body: true });
  let st = document.getElementById('printPageSize'); if (!st) { st = document.createElement('style'); st.id = 'printPageSize'; document.head.appendChild(st); }
  const old = st.textContent; st.textContent = '@page { size: A4; margin: 14mm; }';
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); area.innerHTML = ''; st.textContent = old; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  try { window.print(); } catch (e) { done(); ctx.status(tl('Impression indisponible ici : enregistrez le rapport puis imprimez-le.'), 'warn'); }
  setTimeout(() => { if (document.body.classList.contains('printing') && !matchMedia('print').matches) done(); }, 60000);
}

export async function onAction(ctx, act, b) {
  const data = ctx.data(), base = fileBase(ctx);
  if (act === 'print') return printReport(ctx);
  if (act === 'save-report') return saveText(ctx, await buildReport(ctx), `${base}-${tl('rapport')}.html`, 'text/html', 'html');
  if (act === 'svg-floor') { const v = await extViews(), s = v.planSvg(data, b.dataset.id, { width: 1400 }); if (!s) return ctx.status(tl('Étage vide : rien à exporter.'), 'warn'); return saveText(ctx, s, `${base}-${b.textContent.trim().replace(/[\\/:*?"<>|\s·]+/g, '-')}.svg`, 'image/svg+xml', 'svg'); }
  if (act === 'svg-rack') { const v = await extViews(), s = v.rackSvg(data, b.dataset.id, { width: 320 }); return saveText(ctx, s, `${base}-${b.textContent.trim().replace(/[\\/:*?"<>|\s]+/g, '-')}.svg`, 'image/svg+xml', 'svg'); }
  if (act === 'csv-rooms') { const r = dimension(data); return saveCsv(ctx, [{ key: 'name', name: tl('Nom de la pièce') }, { key: 'floor', name: tl('Étage') }, { key: 'usage', name: tl('Usage') }, { key: 'area', name: 'm²' }, { key: 'wa', name: tl('Postes de travail') }, { key: 'outlets', name: tl('Prises') }, { key: 'placed', name: tl('Posées') }, { key: 'run', name: tl('Lien (m)') }], r.rooms, tl('pieces')); }
  if (act === 'csv-trs') { const r = dimension(data), L = labeler(data); return saveCsv(ctx, [{ key: x => L.space(x.key) || x.key, name: tl('Local') }, { key: 'floor', name: tl('Étage') }, { key: 'outlets', name: tl('Prises') }, { key: 'ports', name: tl('Ports') }, { key: 'panels', name: tl('Panneaux') }, { key: 'swN', name: tl('Switchs') }, { key: 'uplinks', name: tl('Montantes') }, { key: 'oversub', name: tl('Surréservation') }, { key: x => x.poe.need, name: 'PoE (W)' }, { key: 'u', name: 'U' }, { key: x => x.cable.total, name: tl('Câble (m)') }], r.trs, tl('locaux')); }
  if (/^csv-/.test(act)) { const m = await import('./design-tables.js'); return m.onAction(ctx, act, b, { q: '', kind: '', lkind: '' }); }
}
