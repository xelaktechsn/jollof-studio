// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Onglet « Documents » de la vue Conception : renseignements du projet (client, site, auteur, date, révision), rapport
// complet prêt à imprimer (page de garde, synthèse, plans, baies, tableaux, nomenclature, tests), exports SVG (plans
// d'étage avec les identifiants des prises, élévations des baies) et CSV. Le rapport s'imprime en PDF : dans un
// navigateur par une nouvelle fenêtre, dans l'application par la zone d'impression déjà utilisée pour le schéma.
import { tl, isEn } from '../../i18n/index.js';
import { reportHtml, floorSvg, rackSvg, labeler } from '../docs.js';
import { dimension, floorsOf } from '../dimension.js';
import { esc, design, txtField, selField, saveText, saveCsv, fileBase } from './design-util.js';
import { schemeChoices } from '../dxfexport.js';

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
    // Mesures d'un vrai testeur importées (data.measured) : à part des valeurs simulées, nommées comme telles.
    const labels = new Map(st.rows.map(r => [r.link.id, m.linkLabel ? m.linkLabel(ctx.data(), r.link) : r.link.id]));
    const meas = ctx.data().exam === true || !m.measuredHtml ? '' : m.measuredHtml(((ctx.data().measured || {}).results || []).map(r => ({ ...r, label: labels.get(r.link) || '' })), ctx.data().measured);
    // Mode examen (exam.js) : combien de liens sont testés, sans leurs verdicts ni leurs marges.
    if (ctx.data().exam === true) return `<p>${esc(tl('{0} liens testés sur {1}. Mode examen : résultats sans verdict (voir le testeur de certification).', done.length, st.rows.length))}</p>`;
    const cnt = v => done.filter(r => r.stored.verdict === v).length, li = id => (m.limitInfo && m.limitInfo(id) ? m.limitInfo(id).name : id);
    const rows = done.map(r => `<tr><td>${esc(r.stored.label || (m.linkLabel ? m.linkLabel(ctx.data(), r.link) : r.link.id))}</td><td>${esc(li(r.stored.limit))}</td><td>${esc(m.verdictText ? m.verdictText(r.stored.verdict) : r.stored.verdict)}${r.stale ? ' · ' + esc(tl('périmé')) : ''}</td><td class="n">${esc(r.stored.margin ?? '')}</td><td class="n">${esc(r.stored.len ?? '')}</td></tr>`).join('');
    return `<p>${esc(tl('{0} liens testés sur {1} : {2} PASS, {3} PASS*, {4} FAIL*, {5} FAIL. Valeurs simulées par le modèle : ce n’est pas une mesure.', done.length, st.rows.length, cnt('pass'), cnt('pass*'), cnt('fail*'), cnt('fail')))}</p>${done.length ? `<table><thead><tr><th>${esc(tl('Lien'))}</th><th>${esc(tl('Limite'))}</th><th>${esc(tl('Résultat'))}</th><th class="n">${esc(tl('Marge (dB)'))}</th><th class="n">${esc(tl('Longueur (m)'))}</th></tr></thead><tbody>${rows}</tbody></table>` : ''}${meas}`;
  } catch (e) { console.error(e); return ''; }
}
async function buildReport(ctx, o = {}) {
  const data = ctx.data(), v = await extViews();
  return reportHtml(data, { ...o, dim: dimension(data), issues: ctx.issues(), lan: ctx.lan(), cert: await certHtml(ctx), planSvg: v.planSvg, rackSvg: v.rackSvg, en: isEn });
}

/** Schémas de nommage des calques proposés (dxfexport.js). */
const dxfSchemes = () => schemeChoices();

export function renderDocs(ctx) {
  const data = ctx.data(), D = design(ctx), P = D.project, floors = floorsOf(data), L = labeler(data), ic = ctx.icon;
  preloadXlsx();
  const btn = (act, label, i, extra = '', cls = '') => `<button type="button" class="btn small${cls}" data-act="${act}" ${extra}>${ic(i)}<span>${esc(label)}</span></button>`;
  return `<div class="ntDsPage ntDsDocs">
    <section class="ntDsCard"><h3>${esc(tl('Projet'))}</h3><div class="ntDsForm">
      ${txtField(tl('Client'), 'project.client', P.client)}${txtField(tl('Site'), 'project.site', P.site || (data.site && data.site.name) || '')}${txtField(tl('Auteur'), 'project.author', P.author)}
      ${txtField(tl('Date'), 'project.date', P.date, { type: 'date', max: 10 })}${txtField(tl('Révision'), 'project.rev', P.rev, { max: 12 })}</div>
      <p class="ntDsNote">${esc(tl('Ces renseignements figurent sur la page de garde du rapport et sont enregistrés avec le projet.'))}</p></section>
    <section class="ntDsCard ntDsReport"><div><h3>${ic('printer')}${esc(tl('Rapport complet'))}</h3>
      <p>${esc(tl('Page de garde, synthèse du dimensionnement, plans d’étage avec les identifiants des prises, élévations des baies, tableaux des câbles, du brassage et des étiquettes, nomenclature chiffrée, plan d’adressage, tests et problèmes relevés.'))}</p></div>
      <div class="ntDsBtns">${btn('print', tl('Imprimer ou enregistrer en PDF'), 'printer', '', ' primary')}${btn('save-report', tl('Enregistrer le rapport (HTML)'), 'download')}</div></section>
    <section class="ntDsCard ntDsReport"><div><h3>${ic('floorPlan')}${esc(tl('Planches à l’échelle'))}</h3>
      <p>${esc(tl('Une planche par étage (plan à l’échelle, fond de plan importé, prises et leurs identifiants, cheminements, câbles, baies, points d’accès) et les élévations des baies, avec cartouche, légende, nord et échelle graphique. A3 paysage, A2 ou A1 si l’étage est grand.'))}</p></div>
      <div class="ntDsBtns">${btn('sheets-print', tl('Imprimer les planches (PDF)'), 'printer', '', ' primary')}${btn('dxf-all', tl('Exporter en DXF'), 'download')}${has('dwgexport.js') ? btn('dwg-all', tl('Exporter en DWG…'), 'download') + (desktop() ? '' : `<small class="ntDsDesk">${ic('monitor')}${esc(tl('DWG : application de bureau'))}</small>`) : ''}</div></section>
    <section class="ntDsCard"><h3>${esc(tl('Par étage'))}</h3><div class="ntDsFloorRows">${floors.map(({ b, f }) => { const n = (floors.some(x => x.b !== b) ? (b.name || b.id) + ' · ' : '') + (f.name || f.id), ul = data.underlays && data.underlays[f.id]; return `<div class="ntDsFloorRow"><span>${ic('floorPlan')}${esc(n)}${ul ? `<em>${esc(tl('fond DXF : export dans ses coordonnées'))}</em>` : ''}</span>${btn('sheet-svg', tl('Planche SVG'), 'download', `data-id="${esc(f.id)}"`)}${btn('dxf-floor', 'DXF', 'download', `data-id="${esc(f.id)}"`)}${btn('svg-floor', tl('Plan simple SVG'), 'download', `data-id="${esc(f.id)}"`)}</div>`; }).join('') || `<p class="ntDsNote">${esc(tl('Aucun étage : dessinez-les dans la vue Plans.'))}</p>`}</div></section>
    ${exchangeCards(btn, ic)}
    <section class="ntDsCard"><h3>${esc(tl('Échanges avec d’autres outils'))}</h3><div class="ntDsForm">
      ${selField(tl('En-têtes des CSV'), 'exports.csvHeaders', D.exports.csvHeaders, [['standard', tl('Standard (anglais)')], ['local', tl('Langue de l’interface')]], { hint: tl('Standard : Cable ID, From Device, Part Number… comme les outils courants.') })}
      ${selField(tl('Séparateur des champs'), 'exports.csvSep', D.exports.csvSep, [['auto', tl('Automatique')], ['semicolon', tl('Point-virgule ;')], ['comma', tl('Virgule ,')], ['tab', tl('Tabulation')]], { hint: tl('Automatique : point-virgule en français, virgule en anglais.') })}
      ${selField(tl('Séparateur décimal'), 'exports.csvDecimal', D.exports.csvDecimal, [['auto', tl('Automatique')], ['point', tl('Point (1.5)')], ['comma', tl('Virgule (1,5)')]], { hint: tl('Automatique : virgule en français, point en anglais.') })}
      ${selField(tl('Calques du DXF'), 'exports.dxfScheme', D.exports.dxfScheme, dxfSchemes())}</div>
      <p class="ntDsNote">${esc(tl('Fichiers CSV en UTF-8 avec BOM (Excel, LibreOffice), champs entre guillemets au besoin (RFC 4180). Calques du DXF nommés selon le schéma choisi, couleurs et types de ligne par calque.'))}</p>
      <div class="ntDsBtns">${btn('csv-cables', tl('Câbles'), 'cable')}${btn('csv-patch', tl('Brassage'), 'patchPanel')}${btn('csv-bom', tl('Nomenclature'), 'list')}${btn('csv-outlets', tl('Prises'), 'outlet')}${btn('csv-ipplan', tl('Plan d’adressage'), 'network')}${btn('csv-labels', tl('Étiquettes'), 'tag')}${btn('csv-rooms', tl('Pièces et prises'), 'floorPlan')}${btn('csv-trs', tl('Locaux techniques'), 'rack')}</div></section>
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
  printBody(ctx, await buildReport(ctx, { body: true }), '@page { size: A4; margin: 14mm; }');
}
/** Zone d'impression de l'application (#printArea + window.print, comme le schéma) : html, règle @page. */
function printBody(ctx, html, page) {
  const area = document.getElementById('printArea'); if (!area) return;
  area.innerHTML = html;
  let st = document.getElementById('printPageSize'); if (!st) { st = document.createElement('style'); st.id = 'printPageSize'; document.head.appendChild(st); }
  const old = st.textContent; st.textContent = page;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); area.innerHTML = ''; st.textContent = old; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  try { window.print(); } catch (e) { done(); ctx.status(tl('Impression indisponible ici : enregistrez le rapport puis imprimez-le.'), 'warn'); }
  setTimeout(() => { if (document.body.classList.contains('printing') && !matchMedia('print').matches) done(); }, 60000);
}

/** Charge l'import Excel dès l'affichage de l'onglet : le choix du fichier (input.click) doit suivre le clic sans attendre
 *  le chargement du module, sinon le navigateur le refuse (activation utilisateur expirée). */
let xlsxReady = null;
const preloadXlsx = () => { if (!xlsxReady) xlsxReady = import('./xlsxui.js').catch(() => { xlsxReady = null; }); };
/* ---------- Échanges (modules facultatifs détectés à la construction, comme dans shellnet.js) ---------- */
const XMOD = import.meta.glob(['./ifcexport.js', './ifcimport.js', './visioexport.js', './vsdximport.js', './dwgexport.js', './netbox.js']);
const has = (...f) => f.every(x => !!XMOD['./' + x]);
/** Application de bureau (Tauri) : DWG et NetBox n'y sont complets que là ; dans un navigateur, l'entrée reste et explique. */
const desktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const XACT = {
  'ifc-export': ['ifcexport.js', m => m.exportIfc], 'ifc-import': ['ifcimport.js', m => m.openIfcImport],
  'vsdx-export': ['visioexport.js', m => m.exportVsdx], 'drawio-export': ['visioexport.js', m => m.exportDrawio], 'vsdx-import': ['vsdximport.js', m => m.openVsdxImport],
  'dwg-all': ['dwgexport.js', m => m.exportDwg], netbox: ['netbox.js', m => m.openNetbox]
};
/** Cartes du groupe « Échanges » (Excel, IFC, Visio / draw.io, NetBox), chacune seulement si son module est présent. */
function exchangeCards(btn, ic) {
  const desk = desktop() ? '' : `<small class="ntDsDesk">${ic('monitor')}${esc(tl('Application de bureau'))}</small>`;
  const card = (i, title, text, btns) => `<section class="ntDsCard ntDsReport"><div><h3>${ic(i)}${esc(title)}</h3><p>${esc(text)}</p></div><div class="ntDsBtns">${btns}</div></section>`;
  const out = [];
  out.push(card('list', tl('Classeur Excel'), tl('Tous les tableaux dans un classeur .xlsx (câbles, brassage, prises, équipements, nomenclature avec formules, adressage, étiquettes, tests). Modifiez-le dans Excel puis réimportez-le : les différences sont montrées avant d’être appliquées. Un tarif fournisseur peut aussi remplir les prix de la nomenclature.'),
    `${btn('xlsx-export', tl('Exporter (.xlsx)…'), 'download', '', ' primary')}${btn('xlsx-import', tl('Importer un classeur modifié…'), 'upload')}${btn('xlsx-prices', tl('Importer un tarif…'), 'upload')}`));
  if (has('ifcexport.js', 'ifcimport.js')) out.push(card('building', tl('Maquette BIM (IFC)'), tl('Bâtiment, étages, locaux, prises, baies, équipements et câbles dans un fichier IFC4 lisible par les visionneuses BIM ; un modèle IFC d’architecte peut aussi servir de point de départ (étages, pièces, murs, portes).'),
    `${btn('ifc-export', tl('Modèle BIM (IFC)…'), 'download', '', ' primary')}${btn('ifc-import', tl('Importer un modèle IFC…'), 'upload')}`));
  if (has('visioexport.js')) out.push(card('network', tl('Schémas Visio / draw.io'), tl('Vue logique, plans d’étage et élévations des baies en schémas modifiables (.vsdx pour Visio, .drawio pour draw.io) ; un schéma Visio peut aussi être importé.'),
    `${btn('vsdx-export', tl('Schémas Visio (.vsdx)…'), 'download', '', ' primary')}${btn('drawio-export', tl('Schémas draw.io (.drawio)…'), 'download')}${has('vsdximport.js') ? btn('vsdx-import', tl('Importer un schéma Visio (.vsdx)…'), 'upload') : ''}`));
  if (has('netbox.js')) out.push(card('dcimSync', tl('Inventaire NetBox'), tl('Sites, baies, équipements, câbles, VLAN et préfixes comparés à un serveur NetBox, puis envoyés ou repris après votre accord.'),
    btn('netbox', tl('Synchroniser avec NetBox…'), 'dcimSync', '', ' primary') + desk));
  return `<h2 class="ntDsGrpTitle">${esc(tl('Échanges'))}</h2>${out.join('')}`;
}

export async function onAction(ctx, act, b) {
  const data = ctx.data(), base = fileBase(ctx);
  if (act === 'sheets-print') return exportSheetsPdf(ctx);
  if (/^xlsx-/.test(act)) { const X = await import('./xlsxui.js'); return act === 'xlsx-export' ? X.exportXlsx(ctx) : act === 'xlsx-import' ? X.openXlsxImport(ctx) : X.openPriceImport(ctx); }
  if (act === 'dxf-all') return exportDxf(ctx);
  if (XACT[act]) { const [f, get] = XACT[act], load = XMOD['./' + f]; if (!load) return; const fn = get(await load()); return fn && fn(ctx); }
  if (act === 'dxf-floor') return exportDxf(ctx, { floor: b.dataset.id });
  if (act === 'sheet-svg') return exportSheetSvg(ctx, b.dataset.id);
  if (act === 'print') return printReport(ctx);
  if (act === 'save-report') return saveText(ctx, await buildReport(ctx), `${base}-${tl('rapport')}.html`, 'text/html', 'html');
  if (act === 'svg-floor') { const v = await extViews(), s = v.planSvg(data, b.dataset.id, { width: 1400 }); if (!s) return ctx.status(tl('Étage vide : rien à exporter.'), 'warn'); return saveText(ctx, s, `${base}-${b.textContent.trim().replace(/[\\/:*?"<>|\s·]+/g, '-')}.svg`, 'image/svg+xml', 'svg'); }
  if (act === 'svg-rack') { const v = await extViews(), s = v.rackSvg(data, b.dataset.id, { width: 320 }); return saveText(ctx, s, `${base}-${b.textContent.trim().replace(/[\\/:*?"<>|\s]+/g, '-')}.svg`, 'image/svg+xml', 'svg'); }
  if (act === 'csv-rooms') { const r = dimension(data); return saveCsv(ctx, [{ key: 'name', name: tl('Nom de la pièce') }, { key: 'floor', name: tl('Étage') }, { key: 'usage', name: tl('Usage') }, { key: 'area', name: 'm²' }, { key: 'wa', name: tl('Postes de travail') }, { key: 'outlets', name: tl('Prises') }, { key: 'placed', name: tl('Posées') }, { key: 'run', name: tl('Lien (m)') }], r.rooms, tl('pieces')); }
  if (act === 'csv-trs') { const r = dimension(data), L = labeler(data); return saveCsv(ctx, [{ key: x => L.space(x.key) || x.key, name: tl('Local') }, { key: 'floor', name: tl('Étage') }, { key: 'outlets', name: tl('Prises') }, { key: 'ports', name: tl('Ports') }, { key: 'panels', name: tl('Panneaux') }, { key: 'swN', name: tl('Switchs') }, { key: 'uplinks', name: tl('Montantes') }, { key: 'oversub', name: tl('Surréservation') }, { key: x => x.poe.need, name: 'PoE (W)' }, { key: 'u', name: 'U' }, { key: x => x.cable.total, name: tl('Câble (m)') }], r.trs, tl('locaux')); }
  if (/^csv-/.test(act)) { const m = await import('./design-tables.js'); return m.onAction(ctx, act, b, { q: '', kind: '', lkind: '' }); }
}

/* ---------- DXF et planches (aussi appelés par les menus de l'application : noms exportDxf, exportSheetsPdf) ---------- */
const slug = s => String(s || '').replace(/[\\/:*?"<>|\s·]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
/**
 * Export DXF de la conception (sans étage : tous). Un étage qui a un fond importé est écrit dans les coordonnées du dessin
 * d'origine : le fichier se superpose à celui de l'architecte (dxfexport.js).
 */
export async function exportDxf(ctx, o = {}) {
  const data = ctx.data(), { designDxf } = await import('../dxfexport.js');
  if (!floorsOf(data).length) { ctx.status(tl('Aucun étage à exporter : dessinez-les dans la vue Plans.'), 'warn'); return null; }
  const r = designDxf(data, { floors: o.floor ? [o.floor] : undefined });
  const F = o.floor ? floorsOf(data).find(x => x.f.id === o.floor) : null;
  await saveText(ctx, r.text, `${fileBase(ctx)}${F ? '-' + slug(F.f.name || F.f.id) : ''}.dxf`, 'application/dxf', 'dxf');
  ctx.status(r.under ? tl('DXF : {0:# étage|# étages}, dont {1} dans les coordonnées de leur fond de plan ({2}).', r.floors, r.under, r.units) : tl('DXF : {0:# étage|# étages} en mètres du plan.', r.floors), 'ok');
  return r;
}
/** Fonds de plan décodés des étages qui en ont (pour les planches) : { [étage]: paquet }. */
async function underlays(data, ids) {
  const out = {}, want = Object.keys(data.underlays || {}).filter(id => !ids || ids.includes(id));
  if (!want.length) return out;
  try {
    const [U, St] = await Promise.all([import('../cad/underlay.js'), import('../cad/store.js')]);
    for (const id of want) { const u = data.underlays[id], url = (data.blobs || {})[u.id]; if (!url || u.on === false) continue; try { out[id] = U.unpackUnderlay(u.pack || {}, await St.dataUrlToBytes(url)); } catch (e) { console.warn(e); } }
  } catch (e) { console.warn(e); }
  return out;
}
async function buildSheets(ctx, floors) {
  const data = ctx.data(), SH = await import('../sheets.js');
  return { SH, sheets: SH.sheetSet(data, { floors, underlays: await underlays(data, floors) }) };
}
/** Planche SVG d'un étage, à enregistrer. */
export async function exportSheetSvg(ctx, floorId) {
  const data = ctx.data(), SH = await import('../sheets.js'), ul = await underlays(data, [floorId]);
  const s = SH.floorSheet(data, floorId, { paper: 'auto', underlay: ul[floorId], no: 1, count: 1 });
  if (!s) return ctx.status(tl('Étage vide : rien à exporter.'), 'warn');
  return saveText(ctx, '<?xml version="1.0" encoding="UTF-8"?>\n' + s.svg, `${fileBase(ctx)}-${slug(s.title)}.svg`, 'image/svg+xml', 'svg');
}
/**
 * Planches (étages, puis baies) à imprimer ou enregistrer en PDF : nouvelle fenêtre dans un navigateur, zone d'impression
 * de l'application dans Tauri (ou si la fenêtre est bloquée) — le même chemin que le rapport et le schéma.
 */
export async function exportSheetsPdf(ctx, o = {}) {
  const { SH, sheets } = await buildSheets(ctx, o.floors);
  if (!sheets.length) { ctx.status(tl('Aucune planche : dessinez les étages dans la vue Plans ou posez des baies.'), 'warn'); return null; }
  const native = await import('../../native.js');
  if (!native.isTauri()) {
    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(SH.sheetsHtml(sheets, { en: isEn, title: fileBase(ctx) })); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* rien */ } }, 400); ctx.status(tl('{0:# planche|# planches} ouvertes dans une nouvelle fenêtre : imprimez-les ou enregistrez-les en PDF.', sheets.length), 'ok'); return sheets.length; }
  }
  const area = document.getElementById('printArea'); if (!area) { ctx.status(tl('Impression indisponible ici : enregistrez le rapport puis imprimez-le.'), 'warn'); return null; }
  const h = SH.sheetsHtml(sheets, { body: true });
  printBody(ctx, h.body, h.page);
  return sheets.length;
}
