// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Onglets « tableaux » de la vue Conception : Étiquetage (format TIA-606 réglable, aperçu, doublons), Câbles (tableau
// des câbles avec longueurs et cheminements), Brassage (tableau de brassage de rack.js, sinon le nôtre) et Nomenclature
// (quantités du modèle, prix unitaires modifiables, main-d'œuvre, total). Exports CSV.
import { tl, isEn } from '../../i18n/index.js';
import { labelTable, labelIssues, labelFormats, cableSchedule, patchingRows, patchColName, PATCH_KEYS, bom, money, kindName } from '../docs.js';
import { LABEL_PRESETS, CURRENCIES } from '../dimension.js';
import * as RACK from '../rack.js';
import { esc, fmt, design, selField, txtField, table, kpi, saveCsv, saveTable, setDesign } from './design-util.js';

const MAX_ROWS = 1500;
const match = (q, ...v) => !q || v.join(' ').toLowerCase().includes(q.toLowerCase());
const tools = (ctx, inner, csv) => `<div class="ntDsTools">${inner}<span class="ntDsSp"></span><button type="button" class="btn small" data-act="${csv}">${ctx.icon('download')}<span>CSV</span></button></div>`;
const search = (state, ph) => `<input class="inp ntDsSearch" type="search" data-filter="q" value="${esc(state.q)}" placeholder="${esc(ph)}" aria-label="${esc(ph)}">`;
const more = n => (n > MAX_ROWS ? `<p class="ntDsNote">${esc(tl('{0} lignes : seules les {1} premières sont affichées (l’export CSV les contient toutes).', n, MAX_ROWS))}</p>` : '');
const PRESET_NAME = { auto: () => tl('Automatique'), tia: () => tl('TIA-606 : local-panneau port (1A-B04)'), campus: () => tl('Campus : bâtiment devant (B1-1A-B04)'), rack: () => tl('Position en baie : baie-unité:port (1A.R01-42:04)'), custom: () => tl('Personnalisé') };
const KIND_NAME = { horizontal: () => tl('Lien permanent'), cord: () => tl('Cordon'), backbone: () => tl('Rocade'), other: () => tl('Autre') };

/** Lignes et colonnes de chaque tableau (aussi pour l'export CSV). */
function labelData(ctx, state) {
  const rows = labelTable(ctx.data()).filter(r => r.kind !== 'cable' && (!state.lkind || r.kind === state.lkind) && match(state.q, r.label, r.where));
  return { rows, cols: [{ key: r => kindName(r.kind), name: tl('Objet') }, { key: 'label', name: tl('Étiquette') }, { key: 'where', name: tl('Emplacement') }] };
}
function cableData(ctx, state) {
  const rows = cableSchedule(ctx.data()).filter(r => (!state.kind || r.kind === state.kind) && match(state.q, r.label, r.from, r.to, r.type));
  return { rows, cols: [{ key: 'label', name: tl('Étiquette') }, { key: r => KIND_NAME[r.kind](), name: tl('Genre') }, { key: 'from', name: tl('De') }, { key: 'to', name: tl('Vers') }, { key: 'type', name: tl('Type') }, { key: r => fmt(r.len, 1), name: tl('Longueur (m)'), num: 1 }, { key: r => (r.mode === 'auto' ? (r.fallback ? tl('automatique, en équerre') : tl('automatique')) : r.mode === 'manual' ? tl('manuel') : '—'), name: tl('Tracé') }, { key: r => r.paths.join(' > '), name: tl('Cheminements'), cls: 'w' }] };
}
/** Tableau de brassage : celui de rack.js (partie baies) mis à nos colonnes, sinon le nôtre (docs.js). */
function patchData(ctx, state) {
  const rows = patchingRows(ctx.data(), ctx.lan()).filter(r => match(state.q, ...Object.values(r)));
  return { rows, cols: PATCH_KEYS.map(k => ({ key: r => (/Len$/.test(k) && typeof r[k] === 'number' ? fmt(r[k], 1) : r[k] ?? ''), name: patchColName(k), num: /Len$/.test(k), cls: k === 'outlet' ? 'w' : '' })) };
}

/** Rend l'onglet (labels, cables, patch, bom). */
export function renderTab(ctx, tab, state) {
  if (tab === 'labels') return renderLabels(ctx, state);
  if (tab === 'cables') {
    const { rows, cols } = cableData(ctx, state), all = cableSchedule(ctx.data());
    const tot = k => all.filter(r => r.kind === k).reduce((a, r) => a + r.len, 0);
    return `<div class="ntDsPage"><div class="ntDsKpis">${kpi(tl('Câbles'), fmt(all.length))}${kpi(tl('Liens permanents'), fmt(all.filter(r => r.kind === 'horizontal').length), { sub: fmt(tot('horizontal')) + ' m' })}${kpi(tl('Cordons'), fmt(all.filter(r => r.kind === 'cord').length))}${kpi(tl('Rocades'), fmt(all.filter(r => r.kind === 'backbone').length), { sub: fmt(tot('backbone')) + ' m' })}</div>
      ${tools(ctx, `${search(state, tl('Rechercher une étiquette, un équipement…'))}<select class="sel ntDsKind" data-filter="kind" aria-label="${esc(tl('Genre'))}"><option value="">${esc(tl('Tous les câbles'))}</option>${Object.keys(KIND_NAME).map(k => `<option value="${k}"${state.kind === k ? ' selected' : ''}>${esc(KIND_NAME[k]())}</option>`).join('')}</select>`, 'csv-cables')}
      ${table([{ ...cols[0], key: r => `<button type="button" class="ntDsLink" data-act="reveal" data-id="${esc(r.id)}">${String(r.label).split(/(?<=[/\\])/).map(x => `<span class="ntDsNw">${esc(x)}</span>`).join('<wbr>')}</button>`, html: 1 }, ...cols.slice(1)], rows.slice(0, MAX_ROWS), { empty: tl('Aucun câble.'), cls: 'ntDsWide' })}${more(rows.length)}</div>`;
  }
  if (tab === 'patch') {
    const { rows, cols } = patchData(ctx, state);
    return `<div class="ntDsPage">${tools(ctx, search(state, tl('Rechercher un port, un équipement…')), 'csv-patch')}
      ${table(cols, rows.slice(0, MAX_ROWS), { cls: 'ntDsWide', empty: tl('Aucun cordon de brassage : posez des panneaux et des switchs dans les baies (ou lancez le générateur).') })}${more(rows.length)}
      <p class="ntDsNote">${esc(typeof RACK.patchingSchedule === 'function' ? tl('Tableau fourni par la vue Baies.') : tl('Cordons entre l’avant des panneaux et les ports des équipements, avec la prise au bout du lien permanent.'))}</p></div>`;
  }
  if (tab === 'bom') return renderBom(ctx);
  return '';
}

function renderLabels(ctx, state) {
  const data = ctx.data(), D = design(ctx), F = labelFormats(data), li = labelIssues(data), { rows, cols } = labelData(ctx, state);
  const custom = D.labels.preset === 'custom';
  const tok = [['{b}', tl('bâtiment (B1, B2…)')], ['{f}', tl('étage (niveau ; S1 au sous-sol)')], ['{s}', tl('lettre du local sur l’étage')], ['{fs}', tl('identifiant du local')], ['{r}', tl('numéro de baie dans le local')], ['{u}', tl('unité du panneau dans la baie')], ['{p}', tl('lettre du panneau dans le local')], ['{n}', tl('numéro de port')]];
  const dupList = li.dups.slice(0, 20).map(g => `<li><b>${esc(g.label)}</b> : ${g.items.map(i => `<button type="button" class="ntDsLink" data-act="reveal" data-id="${esc(i.id)}">${esc(kindName(i.kind))}</button>`).join(', ')}</li>`).join('');
  return `<div class="ntDsGrid"><aside class="ntDsSide">
    <section><h3>${esc(tl('Format des identifiants'))}</h3>
      ${selField(tl('Préréglage'), 'labels.preset', D.labels.preset, LABEL_PRESETS.map(k => [k, PRESET_NAME[k]()]), { hint: tl('Automatique : TIA-606 (1A-B04), avec le bâtiment devant (B1-1A-B04) dès qu’il y en a plusieurs.') })}
      ${txtField(tl('Local technique'), 'labels.space', F.space, { disabled: !custom, max: 60 })}
      ${txtField(tl('Port de panneau et prise (lien horizontal)'), 'labels.link', F.link, { disabled: !custom, max: 60 })}
      ${txtField(tl('Panneau'), 'labels.panel', F.panel, { disabled: !custom, max: 60 })}
      ${txtField(tl('Baie'), 'labels.rack', F.rack, { disabled: !custom, max: 60 })}
      ${selField(tl('Chiffres du numéro de port'), 'labels.pad', D.labels.pad, [[1, '1'], [2, '01'], [3, '001'], [4, '0001']], { num: 1 })}
      ${custom ? '' : `<button type="button" class="btn small" data-act="custom-labels">${esc(tl('Modifier les formats'))}</button>`}
    </section>
    <section><h3>${esc(tl('Jetons'))}</h3><dl class="ntDsTok">${tok.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <p class="ntDsNote">${esc(tl('Forme fs-an de TIA-606 (local fs, panneau a, port n) : chaque extrémité d’un lien porte le même identifiant. Une étiquette imposée à une prise ou à un panneau (colonne de droite) remplace le format.'))}</p></section>
  </aside><main class="ntDsMain">
    <div class="ntDsKpis">${kpi(tl('Étiquettes'), fmt(rows.length))}${kpi(tl('En double'), fmt(li.dups.length), { warn: li.dups.length > 0, ok: !li.dups.length })}${kpi(tl('Prises sans identifiant'), fmt(li.empty.length), { warn: li.empty.length > 0, ok: !li.empty.length })}${kpi(tl('Format du lien'), F.link.replace(/\{(\w+)\}/g, '‹$1›'))}</div>
    ${li.dups.length ? `<section class="ntDsWarn"><p>${esc(tl('Identifiants en double :'))}</p><ul>${dupList}</ul></section>` : ''}
    ${tools(ctx, `${search(state, tl('Rechercher une étiquette, une pièce…'))}<select class="sel ntDsKind" data-filter="lkind" aria-label="${esc(tl('Objet'))}"><option value="">${esc(tl('Tous les objets'))}</option>${['space', 'rack', 'panel', 'outlet'].map(k => `<option value="${k}"${state.lkind === k ? ' selected' : ''}>${esc(kindName(k))}</option>`).join('')}</select>`, 'csv-labels')}
    ${table([cols[0], { name: tl('Étiquette'), key: r => `<button type="button" class="ntDsLink ntDsMono" data-act="reveal" data-id="${esc(r.id)}">${esc(r.label || '—')}</button>`, html: 1 }, cols[2], { name: tl('Étiquette imposée'), key: r => (r.kind === 'panel' || (r.kind === 'outlet' && !/2$/.test(r.port || ''))) ? `<input class="inp ntDsTag" data-edit="tag" data-id="${esc(r.id)}" value="${esc(tagOf(data, r.id))}" maxlength="40" placeholder="—" aria-label="${esc(tl('Étiquette imposée'))}">` : '', html: 1 }], rows.slice(0, MAX_ROWS), { empty: tl('Aucun objet à étiqueter : posez des baies, des panneaux et des prises.') })}${more(rows.length)}
  </main></div>`;
}
const tagOf = (data, id) => ((data.devices || []).find(d => d.id === id) || {}).tag || '';

function renderBom(ctx) {
  const data = ctx.data(), D = design(ctx), b = bom(data), cur = b.currency;
  const GROUPS = { active: tl('Équipements actifs'), passive: tl('Câblage passif'), cable: tl('Câbles'), rack: tl('Baies et énergie'), terminal: tl('Terminaux'), labour: tl('Main-d’œuvre') };
  const lines = b.lines.filter(l => l.group !== 'labour');
  const order = ['active', 'passive', 'cable', 'rack', 'terminal'];
  let rowsHtml = '';
  for (const g of order) {
    const ls = lines.filter(l => l.group === g); if (!ls.length) continue;
    rowsHtml += `<tr class="ntDsGrp"><td colspan="5">${esc(GROUPS[g])}</td><td class="n">${esc(money(b.groups[g] || 0, cur, isEn))}</td></tr>`;
    rowsHtml += ls.map(l => `<tr class="${l.price ? '' : 'ntDsUnpriced'}"><td>${esc(l.name)}${l.note ? `<small>${esc(l.note)}</small>` : ''}</td><td class="n">${esc(fmt(l.qty, 2))}</td><td>${esc(l.unit)}</td><td class="n"><input class="inp ntDsPrice" type="number" min="0" step="0.01" data-edit="price" data-key="${esc(l.key)}" value="${l.price || ''}" placeholder="${esc(tl('à renseigner'))}" aria-label="${esc(tl('Prix unitaire de {0}', l.name))}"></td><td class="n ntDsMuted">${esc(cur)}</td><td class="n">${l.price ? esc(money(l.total, cur, isEn)) : `<span class="ntDsToFill">${esc(tl('à renseigner'))}</span>`}</td></tr>`).join('');
  }
  const lab = D.labour.map((l, i) => `<tr><td><input class="inp" data-edit="labour" data-i="${i}" data-f="name" value="${esc(l.name)}" maxlength="80" aria-label="${esc(tl('Désignation'))}"></td><td class="n"><input class="inp ntDsPrice" type="number" min="0" step="0.5" data-edit="labour" data-i="${i}" data-f="qty" value="${l.qty}" aria-label="${esc(tl('Quantité'))}"></td><td><input class="inp ntDsUnit" data-edit="labour" data-i="${i}" data-f="unit" value="${esc(l.unit)}" maxlength="12" aria-label="${esc(tl('Unité'))}"></td><td class="n"><input class="inp ntDsPrice" type="number" min="0" step="0.01" data-edit="labour" data-i="${i}" data-f="price" value="${l.price || ''}" placeholder="${esc(tl('à renseigner'))}" aria-label="${esc(tl('Prix unitaire'))}"></td><td class="n"><button type="button" class="btn small icon" data-act="del-labour" data-i="${i}" aria-label="${esc(tl('Supprimer la ligne'))}" data-tip="${esc(tl('Supprimer la ligne'))}">${ctx.icon('trash')}</button></td><td class="n">${l.price ? esc(money(l.qty * l.price, cur, isEn)) : `<span class="ntDsToFill">${esc(tl('à renseigner'))}</span>`}</td></tr>`).join('');
  const nUn = b.unpriced.length, partial = nUn > 0;
  // module de l'import du tarif chargé d'avance : le choix du fichier doit suivre le clic (activation utilisateur)
  import('./xlsxui.js').catch(() => {});
  const banner = !b.lines.length ? '' : partial ? `<section class="ntDsWarn ntDsPriceNote"><p>${ctx.icon('alert')}<span><b>${esc(tl('Prix unitaires à renseigner.'))}</b> ${esc(tl('Jollof Studio ne fournit aucun prix : saisissez ceux de votre fournisseur dans la colonne « Prix unitaire » (ils sont enregistrés avec le projet). {0:# ligne|# lignes} sans prix : les totaux sont partiels.', nUn))}</span></p></section>` : '';
  return `<div class="ntDsPage">${banner}
    <div class="ntDsKpis">${kpi(partial ? tl('Total partiel') : tl('Total estimé'), money(b.total, cur, isEn), { sub: partial ? tl('incomplet : {0:# ligne|# lignes} à renseigner', nUn) : tl('hors taxes'), warn: partial })}${kpi(tl('Matériel et fournitures'), money(b.total - (b.groups.labour || 0), cur, isEn))}${kpi(tl('Main-d’œuvre'), money(b.groups.labour || 0, cur, isEn))}${kpi(tl('Lignes sans prix'), fmt(b.unpriced.filter(k => !/^labour/.test(k)).length), { warn: b.unpriced.length > 0, ok: !b.unpriced.length })}</div>
    <div class="ntDsTools">${selField(tl('Devise'), 'currency', cur, CURRENCIES.map(c => [c, c]))}<span class="ntDsSp"></span><button type="button" class="btn small" data-act="xlsx-prices">${ctx.icon('upload')}<span>${esc(tl('Importer un tarif…'))}</span></button><button type="button" class="btn small" data-act="csv-bom">${ctx.icon('download')}<span>CSV</span></button></div>
    <div class="ntDsTblWrap"><table class="ntDsTbl ntDsBom"><thead><tr><th>${esc(tl('Désignation'))}</th><th class="n">${esc(tl('Qté'))}</th><th>${esc(tl('Unité'))}</th><th class="n">${esc(tl('Prix unitaire'))}</th><th></th><th class="n">${esc(tl('Total'))}</th></tr></thead>
    <tbody>${rowsHtml || `<tr><td colspan="6" class="ntDsEmpty">${esc(tl('Le modèle est vide : rien à chiffrer.'))}</td></tr>`}
    <tr class="ntDsGrp"><td colspan="5">${esc(GROUPS.labour)}</td><td class="n">${esc(money(b.groups.labour || 0, cur, isEn))}</td></tr>${lab}
    <tr><td colspan="6"><button type="button" class="btn small subtle" data-act="add-labour">${ctx.icon('plus')}<span>${esc(tl('Ajouter une ligne de main-d’œuvre'))}</span></button></td></tr>
    <tr class="ntDsTot"><td colspan="5">${esc(partial ? tl('Total partiel (hors lignes à renseigner)') : tl('Total'))}</td><td class="n">${esc(money(b.total, cur, isEn))}</td></tr></tbody></table></div>
    <p class="ntDsNote">${esc(tl('Quantités tirées du modèle : équipements par type, embases des prises, câble en tourets (liens par touret selon la longueur moyenne et les chutes), cordons, fibre. Les prix sont ceux du projet (à renseigner) : ils sont enregistrés avec lui.'))}</p></div>`;
}

/** Boutons des onglets (data-act). */
export function onAction(ctx, act, b, state, rerender) {
  const data = ctx.data();
  if (act === 'xlsx-prices') return import('./xlsxui.js').then(X => X.openPriceImport(ctx));
  if (act === 'csv-labels') return saveTable(ctx, 'labels', tl('etiquettes'));
  if (act === 'csv-cables') return saveTable(ctx, 'cables', tl('cables'));
  if (act === 'csv-patch') return saveTable(ctx, 'patching', tl('brassage'));
  if (act === 'csv-bom') return saveTable(ctx, 'bom', tl('nomenclature'));
  if (act === 'csv-outlets') return saveTable(ctx, 'outlets', tl('prises'));
  if (act === 'csv-ipplan') return saveTable(ctx, 'ipplan', tl('adressage'));
  if (act === 'custom-labels') { const F = labelFormats(data); const L = design(ctx).labels; Object.assign(L, { space: F.space, link: F.link, panel: F.panel, rack: F.rack }); return setDesign(ctx, 'labels.preset', 'custom'); }
  if (act === 'add-labour') return setDesign(ctx, 'labour', [...design(ctx).labour, { name: tl('Pose et raccordement des prises'), qty: 1, unit: tl('u.'), price: 0 }]);
  if (act === 'del-labour') { const l = design(ctx).labour.slice(); l.splice(+b.dataset.i, 1); return setDesign(ctx, 'labour', l); }
  void state; void rerender;
}
/** Champs modifiables des tableaux (data-edit). */
export function onEdit(ctx, t) {
  const data = ctx.data(), k = t.dataset.edit;
  if (k === 'price') { const v = t.value === '' ? 0 : Math.max(0, +t.value || 0); return setDesign(ctx, 'prices', { ...design(ctx).prices, [t.dataset.key]: v }); }
  if (k === 'labour') { const l = design(ctx).labour.map(x => ({ ...x })), i = +t.dataset.i, f = t.dataset.f; if (!l[i]) return; l[i][f] = f === 'qty' || f === 'price' ? Math.max(0, +t.value || 0) : t.value; return setDesign(ctx, 'labour', l); }
  if (k === 'tag') { const d = (data.devices || []).find(x => x.id === t.dataset.id); if (!d) return; const v = t.value.replace(/[<>"'`]/g, '').trim().slice(0, 40); if (v) d.tag = v; else delete d.tag; ctx.commit(); }
}
