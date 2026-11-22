// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Échanges Excel du projet réseau (chargé à la demande) : export du classeur (options : en-têtes, onglets), import d'un
// classeur modifié dans Excel (différences par objet, à accepter ligne par ligne, appliquées en une étape d'annulation) et
// import d'un tarif fournisseur pour la nomenclature (colonnes devinées puis réglables, aperçu). Noms repérés par le shell :
// exportXlsx(ctx), openXlsxImport(ctx), openPriceImport(ctx).
import './xlsxui.css';
import { tl, isEn, CANCEL } from '../../i18n/index.js';
import { fileBase } from './design-util.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PREF = 'jollof-net-xlsx';
const TABLES = [['cables', () => tl('Câbles')], ['patching', () => tl('Brassage')], ['outlets', () => tl('Prises')], ['devices', () => tl('Équipements')], ['bom', () => tl('Nomenclature')], ['ipplan', () => tl('Plan d’adressage')], ['labels', () => tl('Étiquettes')], ['tests', () => tl('Tests')]];
const ui = () => import('../../school/ui.js');
const fmtV = v => (v === '' || v == null ? '—' : typeof v === 'number' ? v.toLocaleString(isEn ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 2 }) : String(v));
function pref() { try { return JSON.parse(localStorage.getItem(PREF) || 'null') || {}; } catch (e) { return {}; } }
function savePref(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch (e) { /* rien */ } }

/** Export du classeur : options (en-têtes, onglets), puis enregistrement (boîte du système ou téléchargement). */
export async function exportXlsx(ctx, o = {}) {
  const P = pref(), headers0 = o.headers || P.headers || ((ctx.data().design || {}).exports || {}).csvHeaders || 'standard', want0 = new Set(o.tables || P.tables || TABLES.map(t => t[0]));
  let choice = o.direct ? { headers: headers0, tables: [...want0] } : null;
  if (!choice) {
    const { dialog } = await ui();
    const body = `<div class="ntXl">
      <p class="ntXlNote">${esc(tl('Un classeur Excel : un onglet par tableau, première ligne figée, filtres, largeurs de colonnes, formules de la nomenclature (quantité × prix, total). La colonne ID permet de réimporter le classeur après l’avoir modifié.'))}</p>
      <fieldset><legend>${esc(tl('En-têtes des colonnes'))}</legend>
        <label class="ntXlRadio"><input type="radio" name="h" value="standard"${headers0 === 'standard' ? ' checked' : ''}><span><b>${esc(tl('Standard (anglais)'))}</b><small>Cable ID, From Device, Part Number, Unit Price…</small></span></label>
        <label class="ntXlRadio"><input type="radio" name="h" value="local"${headers0 === 'local' ? ' checked' : ''}><span><b>${esc(tl('Langue de l’interface'))}</b><small>${esc(tl('Étiquette, De, Référence, Prix unitaire…'))}</small></span></label></fieldset>
      <fieldset><legend>${esc(tl('Onglets'))}</legend><div class="ntXlChecks">${TABLES.map(([k, n]) => `<label><input type="checkbox" name="t" value="${k}"${want0.has(k) ? ' checked' : ''}><span>${esc(n())}</span></label>`).join('')}</div></fieldset></div>`;
    choice = await dialog({ title: tl('Exporter le classeur Excel'), head: { icon: 'download', sub: tl('Un onglet par tableau, première colonne « ID » stable') }, body, width: 560, cls: 'ntXlDlg', actions: [{ label: CANCEL, value: null }, { label: tl('Exporter (.xlsx)'), value: 'ok', kind: 'primary' }],
      onAction: (v, root) => { if (v !== 'ok') return undefined; const tables = [...root.querySelectorAll('[name="t"]:checked')].map(x => x.value); if (!tables.length) return false; return { headers: root.querySelector('[name="h"]:checked').value, tables }; } });
    if (!choice) return null;
  }
  savePref(choice);
  const N = await import('../interop/xlsxnet.js'), data = ctx.data();
  const wb = N.networkWorkbook(data, ctx.lan(), { headers: choice.headers, tables: choice.tables });
  const native = await import('../../native.js');
  try {
    const path = await native.saveFile(new Blob([wb.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileBase(ctx)}.xlsx`, tl('Classeur Excel'), 'xlsx');
    if (path) ctx.status(tl('Classeur enregistré : {0} ({1} onglets).', path, wb.sheets.length), 'ok');
  } catch (e) { ctx.status(tl('Enregistrement impossible : {0}', e.message || e), 'err'); }
  return wb;
}

/** Fichier .xlsx choisi par l'utilisateur (élément input, aussi dans Tauri). */
function pickXlsx() {
  return new Promise(resolve => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    inp.onchange = () => resolve(inp.files && inp.files[0] || null); inp.click();
  });
}
async function readFile(ctx, file) {
  const N = await import('../interop/xlsxnet.js');
  try { return { N, wb: N.readXlsx(new Uint8Array(await file.arrayBuffer())) }; } catch (e) { ctx.status(tl('Classeur illisible : {0}', e.message || e), 'err'); return null; }
}

/**
 * Import d'un classeur : celui du projet (exporté puis modifié dans Excel) → différences à accepter ; un autre classeur →
 * import d'un tarif pour la nomenclature. o.file : fichier déjà choisi (tests).
 */
export async function openXlsxImport(ctx, o = {}) {
  const file = o.file || await pickXlsx(); if (!file) return null;
  const r = await readFile(ctx, file); if (!r) return null;
  const df = r.N.diffWorkbook(ctx.data(), ctx.lan(), r.wb);
  if (!df.ours && !df.tables.length) return priceDialog(ctx, r.N, r.wb, file.name);
  return diffDialog(ctx, r.N, df, file.name);
}
/** Import d'un tarif fournisseur (prix unitaires de la nomenclature). */
export async function openPriceImport(ctx, o = {}) {
  const file = o.file || await pickXlsx(); if (!file) return null;
  const r = await readFile(ctx, file); if (!r) return null;
  return priceDialog(ctx, r.N, r.wb, file.name);
}

/* ---------- Différences ---------- */
async function diffDialog(ctx, N, df, name) {
  const cur0 = ((ctx.data().design || {}).currency) || 'EUR', shown = (c, v) => (c.field === 'price' && typeof v === 'number' && v ? money(v, cur0) : fmtV(v));
  const { dialog } = await ui();
  const T = new Map(TABLES), groups = new Map();
  df.changes.forEach((c, i) => { if (!groups.has(c.table)) groups.set(c.table, []); groups.get(c.table).push([c, i]); });
  const missing = Object.entries(df.missing).map(([k, n]) => `${(T.get(k) || (() => k))()} : ${n}`).join(' · ');
  const notes = [];
  if (df.invalid.length) notes.push(`<p class="ntXlWarn">${esc(tl('{0:# valeur refusée|# valeurs refusées} (format) :', df.invalid.length))} ${df.invalid.slice(0, 6).map(x => `${esc(x.what)} · ${esc(x.header)} “${esc(x.value)}”`).join(' ; ')}${df.invalid.length > 6 ? '…' : ''}</p>`);
  if (df.unknown.length) notes.push(`<p class="ntXlWarn">${esc(tl('{0:# ligne sans objet dans le projet (ID inconnu), ignorée|# lignes sans objet dans le projet (ID inconnu), ignorées} :', df.unknown.length))} ${df.unknown.slice(0, 8).map(u => esc(u.id)).join(', ')}${df.unknown.length > 8 ? '…' : ''}</p>`);
  if (missing) notes.push(`<p class="ntXlNote">${esc(tl('Objets du projet absents du classeur (laissés tels quels) : {0}.', missing))}</p>`);
  if (df.changes.some(c => c.conflict)) notes.push(`<p class="ntXlWarn">${esc(tl('Le même réglage a deux valeurs différentes dans le classeur (lignes marquées) : choisissez celle à garder.'))}</p>`);
  const first = new Map(); df.changes.forEach((c, i) => { if (!first.has(c.target)) first.set(c.target, i); });
  const rows = [...groups].map(([k, list]) => `<tbody><tr class="ntXlGrp"><th colspan="5"><label><input type="checkbox" data-grp="${k}" checked> ${esc((T.get(k) || (() => k))())} <small>(${list.length})</small></label></th></tr>${list.map(([c, i]) => `<tr class="${c.conflict ? 'ntXlConflict' : ''}"><td><input type="checkbox" data-i="${i}" data-g="${k}"${!c.conflict || first.get(c.target) === i ? ' checked' : ''} aria-label="${esc(tl('Appliquer'))}"></td><td>${esc(c.what)}</td><td>${esc(c.header)}</td><td class="ntXlOld">${esc(shown(c, c.from))}</td><td class="ntXlNew">${esc(shown(c, c.to))}</td></tr>`).join('')}</tbody>`).join('');
  const body = `<div class="ntXl"><p class="ntXlNote">${esc(tl('Classeur « {0} » comparé au projet : seules les colonnes modifiables sont lues (étiquettes imposées, longueurs, catégories, VLAN des ports, noms, prix, réseaux des VLAN).', name))}</p>${notes.join('')}
    ${df.changes.length ? `<div class="ntXlTools"><button type="button" class="btn small" data-all="1">${esc(tl('Tout cocher'))}</button><button type="button" class="btn small" data-all="0">${esc(tl('Tout décocher'))}</button><span class="ntXlCount"></span></div>
    <div class="ntXlTbl"><table><thead><tr><th></th><th>${esc(tl('Objet'))}</th><th>${esc(tl('Champ'))}</th><th>${esc(tl('Dans le projet'))}</th><th>${esc(tl('Dans le classeur'))}</th></tr></thead>${rows}</table></div>` : `<p class="ntXlEmpty">${esc(tl('Aucune différence : le classeur et le projet disent la même chose.'))}</p>`}</div>`;
  const count = root => { const n = root.querySelectorAll('[data-i]:checked').length, b = root.closest('.sDialog').querySelector('[data-a="1"]'); const c = root.querySelector('.ntXlCount'); if (c) c.textContent = tl('{0:# changement retenu|# changements retenus}', n); if (b) { b.disabled = !n; b.textContent = tl('Appliquer {0:# changement|# changements}', n); } };
  const res = await dialog({ title: tl('Importer le classeur : différences'), head: { icon: 'upload', sub: tl('Changements à accepter ligne par ligne, une seule étape d’annulation') }, body, width: 860, cls: 'ntXlDlg', actions: [{ label: CANCEL, value: null }, { label: tl('Appliquer'), value: 'ok', kind: 'primary' }],
    onOpen: root => {
      root.addEventListener('change', e => { const g = e.target.closest('[data-grp]'); if (g) root.querySelectorAll(`[data-g="${g.dataset.grp}"]`).forEach(x => { x.checked = g.checked; }); count(root); });
      root.addEventListener('click', e => { const b = e.target.closest('[data-all]'); if (b) { root.querySelectorAll('[data-i], [data-grp]').forEach(x => { x.checked = b.dataset.all === '1'; }); count(root); } });
      count(root);
    },
    onAction: (v, root) => (v === 'ok' ? [...root.querySelectorAll('[data-i]:checked')].map(x => df.changes[+x.dataset.i]) : undefined) });
  if (!Array.isArray(res) || !res.length) return null;
  const n = N.applyChanges(ctx.data(), ctx.lan(), res);
  ctx.commit();
  ctx.status(tl('{0:# changement appliqué|# changements appliqués} depuis le classeur (Ctrl+Z pour annuler).', n), 'ok');
  return n;
}

/* ---------- Tarif ---------- */
/** Montant dans la devise donnée (« 1 890,50 € », « €1,890.50 ») ; code inconnu → nombre suivi du code. */
const money = (v, c) => { try { return new Intl.NumberFormat(isEn ? 'en-GB' : 'fr-FR', { style: 'currency', currency: c || 'EUR' }).format(v); } catch (e) { return `${fmtV(v)} ${c || ''}`.trim(); } };
async function priceDialog(ctx, N, wb, name) {
  const { dialog } = await ui();
  const data = ctx.data(), lan = ctx.lan(), cur = ((data.design || {}).currency) || 'EUR', lines = N.bomLines(data, lan);
  let sheet = 0, mapping = null, list, auto, rows, missed;
  // manual : ligne du tarif → clé de nomenclature choisie à la main ; off : clés décochées (gardées d'un rendu à l'autre)
  const manual = new Map(), off = new Set();
  const load = () => {
    list = N.priceList(wb.sheets[sheet] || { rows: [] }, mapping || undefined); auto = N.matchPrices(data, lan, list);
    const taken = new Set(auto.map(m => m.key));
    for (const [it, key] of manual) if (!list.items.includes(it) || taken.has(key)) manual.delete(it);
    const hand = [...manual].map(([it, key]) => { const l = lines.find(x => x.key === key); return { key, name: l.name, part: l.part, current: l.price, price: it.price, currency: it.currency, by: 'manual', item: it }; });
    rows = [...auto, ...hand];
    missed = N.unmatchedPrices(data, lan, list, rows);
  };
  load();
  const colOpts = (sel, header) => `<option value="-1">${esc(tl('(aucune)'))}</option>${header.map((h, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(h || tl('Colonne {0}', i + 1))}</option>`).join('')}`;
  const BY = { part: () => tl('référence'), key: () => tl('code'), desc: () => tl('désignation'), manual: () => tl('à la main') };
  const WHY = { part: () => tl('Référence inconnue de la nomenclature'), desc: () => tl('Désignation inconnue de la nomenclature'), dup: () => tl('Ligne déjà tarifée par une autre ligne du tarif') };
  const curs = () => [...new Set(list.items.map(x => x.currency).filter(Boolean))];
  const render = root => {
    const m = list.mapping, cs = curs(), free = lines.filter(l => !rows.some(r => r.key === l.key));
    root.innerHTML = `<div class="ntXl"><p class="ntXlNote">${esc(tl('Tarif « {0} » : choisissez l’onglet et les colonnes ; les lignes de la nomenclature sont retrouvées par la référence du fabricant, sinon par la désignation.', name))}</p>
      <div class="ntXlMap">
        ${wb.sheets.length > 1 ? `<label><span>${esc(tl('Onglet'))}</span><select class="sel" data-m="sheet">${wb.sheets.map((s, i) => `<option value="${i}"${i === sheet ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}
        <label><span>${esc(tl('Référence'))}</span><select class="sel" data-m="part">${colOpts(m.part, list.header)}</select></label>
        <label><span>${esc(tl('Désignation'))}</span><select class="sel" data-m="desc">${colOpts(m.desc, list.header)}</select></label>
        <label><span>${esc(tl('Prix unitaire'))}</span><select class="sel" data-m="price">${colOpts(m.price, list.header)}</select></label>
        <label><span>${esc(tl('Devise'))}</span><select class="sel" data-m="currency">${colOpts(m.currency, list.header)}</select></label></div>
      <p class="ntXlNote">${esc(tl('{0} prix lus, {1} lignes de la nomenclature retrouvées.', list.items.length, rows.length))}${cs.length && !cs.includes(cur) ? ' ' + esc(tl('Devise du tarif : {0} ; celle du projet : {1}.', cs.join(', '), cur)) : ''}</p>
      ${rows.length ? `<div class="ntXlTbl"><table><thead><tr><th><input type="checkbox" data-allp${rows.every(r => !off.has(r.key)) ? ' checked' : ''} aria-label="${esc(tl('Tout cocher'))}"></th><th>${esc(tl('Ligne de la nomenclature'))}</th><th>${esc(tl('Trouvée par'))}</th><th class="n">${esc(tl('Prix actuel'))}</th><th class="n">${esc(tl('Nouveau prix'))}</th></tr></thead><tbody>${rows.map((x, i) => `<tr><td><input type="checkbox" data-p="${i}"${off.has(x.key) ? '' : ' checked'}></td><td>${esc(x.name)}${x.part ? `<small>${esc(x.part)}</small>` : ''}</td><td>${esc(BY[x.by]())}</td><td class="ntXlOld n">${esc(x.current ? money(x.current, cur) : tl('à renseigner'))}</td><td class="ntXlNew n">${esc(money(x.price, x.currency || cur))}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="ntXlEmpty">${esc(tl('Aucune ligne de la nomenclature retrouvée : vérifiez les colonnes choisies.'))}</p>`}
      ${missed.length ? `<details class="ntXlMiss" open><summary>${esc(tl('Non retrouvées ({0})', missed.length))}</summary><div class="ntXlTbl"><table><thead><tr><th>${esc(tl('Ligne du tarif'))}</th><th class="n">${esc(tl('Prix'))}</th><th>${esc(tl('Raison'))}</th><th>${esc(tl('Associer à…'))}</th></tr></thead><tbody>${missed.map(({ item, reason }) => { const k = list.items.indexOf(item); return `<tr><td>${esc(item.desc || item.part)}${item.part && item.desc ? `<small>${esc(item.part)}</small>` : ''}</td><td class="n">${esc(money(item.price, item.currency || cur))}</td><td class="ntXlWhy">${esc(WHY[reason]())}</td><td><select class="sel" data-assoc="${k}" aria-label="${esc(tl('Associer à…'))}"><option value="">${esc(tl('(aucune)'))}</option>${free.map(l => `<option value="${esc(l.key)}">${esc(l.name)}${l.part ? ' · ' + esc(l.part) : ''}</option>`).join('')}</select></td></tr>`; }).join('')}</tbody></table></div></details>` : ''}
      ${cs.length === 1 && cs[0] !== cur ? `<label class="ntXlRadio"><input type="checkbox" data-setcur checked><span>${esc(tl('Passer la devise du projet en {0}', cs[0]))}</span></label>` : ''}</div>`;
  };
  const res = await dialog({ title: tl('Importer un tarif'), head: { icon: 'upload', sub: tl('Prix unitaires de la nomenclature, par référence ou désignation') }, body: '<div></div>', width: 860, cls: 'ntXlDlg', actions: [{ label: CANCEL, value: null }, { label: tl('Appliquer les prix'), value: 'ok', kind: 'primary' }],
    onOpen: root => {
      render(root);
      root.addEventListener('change', e => {
        const t = e.target;
        if (t.dataset.m === 'sheet') { sheet = +t.value; mapping = null; manual.clear(); load(); render(root); return; }
        if (t.dataset.m) { mapping = { ...list.mapping, [t.dataset.m]: +t.value }; load(); render(root); return; }
        if (t.dataset.assoc != null) { const it = list.items[+t.dataset.assoc]; if (it && t.value) { manual.set(it, t.value); off.delete(t.value); load(); render(root); } return; }
        if (t.dataset.p != null) { const k = rows[+t.dataset.p].key; if (t.checked) off.delete(k); else off.add(k); return; }
        if (t.hasAttribute('data-allp')) { rows.forEach(r => (t.checked ? off.delete(r.key) : off.add(r.key))); root.querySelectorAll('[data-p]').forEach(x => { x.checked = t.checked; }); }
      });
    },
    onAction: (v, root) => (v === 'ok' ? { rows: rows.filter(r => !off.has(r.key)), cur: root.querySelector('[data-setcur]:checked') ? curs()[0] : null } : undefined) });
  if (!res || !res.rows || !res.rows.length) return null;
  const n = N.applyPrices(ctx.data(), res.rows, res.cur);
  ctx.commit();
  ctx.status(tl('{0:# prix importé|# prix importés} dans la nomenclature (Ctrl+Z pour annuler).', n), 'ok');
  return n;
}
